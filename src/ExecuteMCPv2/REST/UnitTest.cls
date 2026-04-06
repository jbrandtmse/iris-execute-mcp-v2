/// REST handler for unit test execution.
/// <p>Provides a single endpoint for running ObjectScript unit tests via
/// <code>POST /api/executemcp/v2/tests</code>. Supports three granularity levels:
/// <ul>
///   <li><b>package</b> — Run all test classes in a package</li>
///   <li><b>class</b> — Run a specific test class</li>
///   <li><b>method</b> — Run a specific test class (method filtering applied to results)</li>
/// </ul>
/// Uses the <code>/noload/nodelete</code> qualifiers since test classes are
/// pre-compiled via MCP tools, not loaded from the filesystem.</p>
/// <p>I/O from <code>%UnitTest.Manager.RunTest()</code> is redirected to prevent
/// its progress output from corrupting the HTTP response body.</p>
Class ExecuteMCPv2.REST.UnitTest Extends %Atelier.REST
{

/// Run unit tests for a given target at the specified level.
/// <p>Reads a JSON body with <code>target</code> (required), <code>level</code>
/// (<code>package|class|method</code>), and optional <code>namespace</code>.
/// Ensures the test environment is configured, executes the tests via
/// <class>%UnitTest.Manager</class>, parses results from SQL tables, and
/// returns structured JSON.</p>
ClassMethod RunTests() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = ""
    Set tRedirected = 0
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Extract parameters
        Set tTarget = ""
        Set tLevel = "package"
        Set tNamespace = ""
        If $IsObject(tBody) {
            Set tTarget = tBody.%Get("target")
            If tBody.%Get("level") '= "" Set tLevel = tBody.%Get("level")
            Set tNamespace = tBody.%Get("namespace")
        }

        ; Validate required target
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tTarget, "target")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Validate level
        If (tLevel '= "package") && (tLevel '= "class") && (tLevel '= "method") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'level' must be one of: package, class, method")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Quit
        }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        }

        ; Ensure test environment (^UnitTestRoot guard)
        Set tSC = ..EnsureTestEnvironment()
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }

        ; Build testspec based on level
        Set tTestSpec = ..BuildTestSpec(tTarget, tLevel)

        ; Determine method filter for "method" level
        Set tMethodFilter = ""
        If tLevel = "method" {
            If tTarget [ ":" {
                Set tMethodFilter = $Piece(tTarget, ":", 2)
            }
        }

        ; Redirect I/O to suppress RunTest console output
        ; %UnitTest.Manager.RunTest writes progress/results directly to the
        ; current device, which corrupts the HTTP response. We capture and
        ; discard it using the same redirect pattern from Command.cls.
        Set %ExecuteMCPOutput = ""
        Set tInitIO = $IO
        Set tWasRedirected = ##class(%Library.Device).ReDirectIO()
        Set tOldMnemonic = ##class(%Library.Device).GetMnemonicRoutine()
        Use tInitIO::("^"_$ZNAME)
        Set tRedirected = 1
        Do ##class(%Library.Device).ReDirectIO(1)

        ; Run tests with /noload/nodelete qualifiers
        Try {
            Set tTestSC = ##class(%UnitTest.Manager).RunTest(tTestSpec, "/noload/nodelete/norecursive")
        } Catch exTest {
            Set tTestSC = exTest.AsStatus()
        }

        ; Restore I/O
        Use tInitIO::($Select(tOldMnemonic=""||(tOldMnemonic="%X364"):"", 1:"^"_tOldMnemonic))
        If tWasRedirected '= tRedirected Do ##class(%Library.Device).ReDirectIO(tWasRedirected)
        Set tRedirected = 0
        Kill %ExecuteMCPOutput

        ; Parse results regardless of RunTest status (tests may have failed but ran)
        Set tResult = ..ParseTestResults(tMethodFilter)

        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        ; Ensure redirection is restored on unexpected error
        Try {
            If $Get(tRedirected) {
                If $Get(tInitIO) '= "" {
                    Use tInitIO::($Select($Get(tOldMnemonic)=""||(tOldMnemonic="%X364"):"", 1:"^"_tOldMnemonic))
                }
                Do ##class(%Library.Device).ReDirectIO(0)
            }
        } Catch {}
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
    }
    ; Always restore namespace
    If tOrigNS '= "" Do ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOrigNS)
    Quit tSC
}

/// I/O redirect entry points for suppressing RunTest output.
/// <p>All output from <code>%UnitTest.Manager.RunTest()</code> is captured
/// and discarded to prevent it from corrupting the REST response.</p>
ClassMethod Redirects() [ Internal, Private, ProcedureBlock = 0 ]
{
    Quit
wstr(s) Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ s Quit
wchr(a) Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ $Char(a) Quit
wnl Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ $Char(10) Quit
wff Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ $Char(12) Quit
wtab(n) New chars Set $Piece(chars, " ", n+1) = "" Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ chars Quit
rstr(len,time) Quit ""
rchr(time) Quit ""
}

/// Ensure <code>^UnitTestRoot</code> is set before running tests.
ClassMethod EnsureTestEnvironment() As %Status
{
    Set tSC = $$$OK
    Try {
        ; ^UnitTestRoot must point to a valid directory. When empty,
        ; %UnitTest.Manager.Root() falls back to the IRIS source dir.
        ; We create a temp directory so the framework doesn't error on
        ; directory checks even though /noload skips file loading.
        Set tRoot = $Get(^UnitTestRoot)
        If (tRoot = "") || ('##class(%File).DirectoryExists(tRoot)) {
            Set tDir = ##class(%File).NormalizeDirectory($ZU(12)_"unittest_mcp")
            Do ##class(%File).CreateDirectoryChain(tDir)
            Set ^UnitTestRoot = tDir
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Build the testspec string for <method>%UnitTest.Manager.RunTest</method>.
/// Build testspec for <code>%UnitTest.Manager.RunTest</code> in <code>/noload</code> mode.
/// <p>With /noload, testspec MUST use colon format to specify classes directly.
/// The framework cannot discover classes from directories when ^UnitTestRoot="".</p>
ClassMethod BuildTestSpec(pTarget As %String, pLevel As %String) As %String
{
    If pLevel = "class" {
        Quit ":"_pTarget
    }
    If pLevel = "method" {
        If pTarget [ ":" {
            Set tClass = $Piece(pTarget, ":", 1)
            Set tMethod = $Piece(pTarget, ":", 2)
            Quit ":"_tClass_":"_tMethod
        }
        Quit ":"_pTarget
    }
    If pLevel = "package" {
        ; Query class dictionary for all %UnitTest.TestCase subclasses in the package
        Set tSpec = ""
        Set tSQL = "SELECT Name FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH ? AND Abstract = 0"
        Set tStmt = ##class(%SQL.Statement).%New()
        Set tSC = tStmt.%Prepare(tSQL)
        If $$$ISOK(tSC) {
            Set tRS = tStmt.%Execute(pTarget_".")
            While tRS.%Next() {
                Set tClassName = tRS.%Get("Name")
                Try {
                    If $ClassMethod(tClassName, "%Extends", "%UnitTest.TestCase") {
                        If tSpec '= "" Set tSpec = tSpec _ ";"
                        Set tSpec = tSpec _ ":" _ tClassName
                    }
                } Catch {}
            }
        }
        If tSpec = "" Quit ":"_pTarget
        Quit tSpec
    }
    Quit ":"_pTarget
}

/// Parse test results from the <code>%UnitTest_Result</code> SQL tables.
ClassMethod ParseTestResults(pMethodFilter As %String = "") As %DynamicObject
{
    Set tResult = {}
    Set tDetails = []
    Set tTotal = 0
    Set tPassed = 0
    Set tFailed = 0
    Set tSkipped = 0
    Set tDuration = 0

    Try {
        Set tInstanceId = ""
        Set tStmt = ##class(%SQL.Statement).%New()
        Set tSC = tStmt.%Prepare("SELECT TOP 1 ID, Duration FROM %UnitTest_Result.TestInstance ORDER BY ID DESC")
        If $$$ISERR(tSC) {
            Do tResult.%Set("total", 0, "number")
            Do tResult.%Set("passed", 0, "number")
            Do tResult.%Set("failed", 0, "number")
            Do tResult.%Set("skipped", 0, "number")
            Do tResult.%Set("duration", 0, "number")
            Do tResult.%Set("details", tDetails)
            Do tResult.%Set("error", "Failed to prepare SQL query for test results")
            Quit
        }
        Set tRS = tStmt.%Execute()
        If tRS.%Next() {
            Set tInstanceId = tRS.%Get("ID")
            Set tDuration = +tRS.%Get("Duration")
        }

        If tInstanceId = "" {
            Do tResult.%Set("total", 0, "number")
            Do tResult.%Set("passed", 0, "number")
            Do tResult.%Set("failed", 0, "number")
            Do tResult.%Set("skipped", 0, "number")
            Do tResult.%Set("duration", 0, "number")
            Do tResult.%Set("details", tDetails)
            Quit
        }

        Set tSQL = "SELECT tm.Name AS MethodName, tm.Status AS MethodStatus, tm.Duration AS MethodDuration, "_
                   "tc.Name AS ClassName "_
                   "FROM %UnitTest_Result.TestMethod tm "_
                   "JOIN %UnitTest_Result.TestCase tc ON tm.TestCase = tc.ID "_
                   "JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID "_
                   "WHERE ts.TestInstance = ? "_
                   "ORDER BY tc.Name, tm.Name"
        Set tStmt2 = ##class(%SQL.Statement).%New()
        Set tSC = tStmt2.%Prepare(tSQL)
        If $$$ISERR(tSC) {
            Do tResult.%Set("total", 0, "number")
            Do tResult.%Set("passed", 0, "number")
            Do tResult.%Set("failed", 0, "number")
            Do tResult.%Set("skipped", 0, "number")
            Do tResult.%Set("duration", tDuration, "number")
            Do tResult.%Set("details", tDetails)
            Do tResult.%Set("error", "Failed to prepare SQL query for test methods")
            Quit
        }
        Set tRS2 = tStmt2.%Execute(tInstanceId)

        While tRS2.%Next() {
            Set tMethodName = tRS2.%Get("MethodName")
            Set tClassName = tRS2.%Get("ClassName")
            Set tStatus = tRS2.%Get("MethodStatus")
            Set tMethodDur = +tRS2.%Get("MethodDuration")

            If (pMethodFilter '= "") && (tMethodName '= pMethodFilter) {
                Continue
            }

            Set tDetail = {}
            Do tDetail.%Set("class", tClassName)
            Do tDetail.%Set("method", tMethodName)
            Do tDetail.%Set("duration", tMethodDur, "number")

            If tStatus = 1 {
                Do tDetail.%Set("status", "passed")
                Do tDetail.%Set("message", "")
                Set tPassed = tPassed + 1
            } Else {
                Do tDetail.%Set("status", "failed")
                Set tMsg = ..GetFailureMessage(tInstanceId, tClassName, tMethodName)
                Do tDetail.%Set("message", tMsg)
                Set tFailed = tFailed + 1
            }

            Do tDetails.%Push(tDetail)
            Set tTotal = tTotal + 1
        }
    } Catch ex {
        Do tResult.%Set("error", "Error parsing test results: " _ ex.DisplayString())
    }

    Do tResult.%Set("total", tTotal, "number")
    Do tResult.%Set("passed", tPassed, "number")
    Do tResult.%Set("failed", tFailed, "number")
    Do tResult.%Set("skipped", tSkipped, "number")
    Do tResult.%Set("duration", tDuration, "number")
    Do tResult.%Set("details", tDetails)
    Quit tResult
}

/// Get failure messages for a specific test method from assertion results.
ClassMethod GetFailureMessage(pInstanceId As %String, pClassName As %String, pMethodName As %String) As %String [ Private ]
{
    Set tMsg = ""
    Try {
        Set tSQL = "SELECT ta.Description, ta.Status "_
                   "FROM %UnitTest_Result.TestAssert ta "_
                   "JOIN %UnitTest_Result.TestMethod tm ON ta.TestMethod = tm.ID "_
                   "JOIN %UnitTest_Result.TestCase tc ON tm.TestCase = tc.ID "_
                   "JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID "_
                   "WHERE ts.TestInstance = ? AND tc.Name = ? AND tm.Name = ? AND ta.Status = 0 "_
                   "ORDER BY ta.ID"
        Set tStmt = ##class(%SQL.Statement).%New()
        Set tSC = tStmt.%Prepare(tSQL)
        If $$$ISOK(tSC) {
            Set tRS = tStmt.%Execute(pInstanceId, pClassName, pMethodName)
            While tRS.%Next() {
                Set tDesc = tRS.%Get("Description")
                If tMsg '= "" Set tMsg = tMsg _ "; "
                Set tMsg = tMsg _ tDesc
            }
        }
    } Catch ex {
        Set tMsg = "Error retrieving failure details"
    }
    Quit tMsg
}

}
