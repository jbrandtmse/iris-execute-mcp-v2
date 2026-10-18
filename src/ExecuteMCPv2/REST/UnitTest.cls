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
/// <p>No MCP tool calls <code>POST /tests</code>. <code>iris_execute_tests</code> runs tests through the Atelier
/// work queue, and <code>iris_test_coverage</code> runs them in its own job through the coverage routes
/// (<class>ExecuteMCPv2.REST.Coverage</class>), which never call <method>RunTests</method>. The route stays
/// for direct REST callers. <method>RunTests</method> is not guarded by the production guard below.</p>
/// <p><b>The TestProduction guard (Story 40.3).</b> <class>%UnitTest.TestProduction</class> stops (and, when it will
/// not stop, force-stops and cleans) any production that is not stopped before it starts its own. So a run that
/// includes a TestProduction test is decided here before it starts: <method>ProductionGuard</method> says
/// <code>proceed</code> when the namespace's production is stopped or is one of the production(s) those tests
/// declare, and <code>busy</code> otherwise, including when the production state cannot be read. It is the one
/// decision both test-running tools use: <code>GET /dev/test/production</code> (<method>ProductionCheck</method>)
/// serves <code>iris_execute_tests</code>, and <class>ExecuteMCPv2.REST.Coverage</class> calls it in its own start.
/// A run with no TestProduction test is <code>proceed</code> without any <code>Ens.*</code> call or lock. The
/// decision is taken under Ens's own production lifecycle lock (<code>^Ens.Runtime</code>), so no production start,
/// stop or update interleaves with the read; the window between the decision and the test's own start in another
/// process is a known residual. The guard only reads: it never starts, stops or cleans a production.</p>
Class ExecuteMCPv2.REST.UnitTest Extends ExecuteMCPv2.REST.Base
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
    Set tOrigNS = $NAMESPACE
    Set tRedirected = 0
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

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
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate level
        If (tLevel '= "package") && (tLevel '= "class") && (tLevel '= "method") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'level' must be one of: package, class, method")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Ensure test environment (^UnitTestRoot guard)
        Set tSC = ..EnsureTestEnvironment()
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

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

        ; Restore namespace before rendering response
        Set $NAMESPACE = tOrigNS

        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        ; Ensure redirection is restored on unexpected error
        Try {
            If $Get(tRedirected) {
                If $Get(tInitIO) '= "" {
                    Use tInitIO::($Select($Get(tOldMnemonic)=""||(tOldMnemonic="%X364"):"", 1:"^"_tOldMnemonic))
                }
                Do ##class(%Library.Device).ReDirectIO(0)
            }
        } Catch {}
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
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

/// HTTP entry point of <code>GET /dev/test/production?target=&amp;level=&amp;namespace=</code>: may a run of the tests
/// <var>target</var> at <var>level</var> (<code>package|class|method</code>) go ahead in <var>namespace</var>?
/// <p>Validates <code>target</code> and <code>level</code> before any namespace switch, switches to the namespace,
/// asks <method>ProductionGuard</method> (the run compiles its test classes, so a class definition answers when the
/// compiled class is not up to date) and renders one envelope. A namespace that cannot be switched to answers
/// <code>proceed</code> with no TestProduction tests: nothing can run there, so the run then fails as it does today.
/// So does a namespace whose class dictionary lacks the classes the guard calls, or holds a copy of
/// <class>ExecuteMCPv2.REST.UnitTest</class> without <method>ProductionGuard</method> (no <code>%ALL</code> package
/// mapping of <code>ExecuteMCPv2</code>, or a copy of an earlier build): the guard cannot run there, so the run goes
/// ahead unguarded, as it did before the guard.
/// The namespace is restored on every exit path.</p>
ClassMethod ProductionCheck() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Set tResult = ""
    Set tErrored = 0
    Set tCmdStatus = $$$OK
    Try {
        Set tTarget = $ZStrip($Get(%request.Data("target", 1)), "<>W")
        Set tLevel = $ZStrip($Get(%request.Data("level", 1)), "<>W")
        Set tNamespace = $ZStrip($Get(%request.Data("namespace", 1)), "<>W")

        Set tCmdStatus = ##class(ExecuteMCPv2.Utils).ValidateRequired(tTarget, "target")
        If $$$ISERR(tCmdStatus) {
            Set tErrored = 1
            Quit
        }
        If (tLevel '= "package") && (tLevel '= "class") && (tLevel '= "method") {
            Set tCmdStatus = $$$ERROR($$$GeneralError, "Parameter 'level' must be one of: package, class, method")
            Set tErrored = 1
            Quit
        }

        Set tSwitched = 1
        If tNamespace '= "" {
            Set tSwitchSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSwitchSC) Set tSwitched = 0
        }
        ; The guard calls these classes in the target namespace, which sees them only through a package mapping or a copy
        ; of its own; a copy of an earlier build has the classes but lacks ProductionGuard, so the method is checked too.
        Set tGuarded = tSwitched && $$$comClassDefined("ExecuteMCPv2.REST.UnitTest") && $$$comClassDefined("ExecuteMCPv2.Coverage.Job") && $$$comClassDefined("ExecuteMCPv2.REST.Interop") && $$$comClassDefined("ExecuteMCPv2.Utils") && $$$comMemberDefined("ExecuteMCPv2.REST.UnitTest",$$$cCLASSmethod,"ProductionGuard")
        If tGuarded {
            Set tCmdStatus = ..ProductionGuard(tTarget, tLevel, 1, .tResult)
            If $$$ISERR(tCmdStatus) Set tErrored = 1
        } Else {
            Set tResult = {}
            Do tResult.%Set("decision", "proceed")
            Do tResult.%Set("namespace", $Select(tSwitched: $NAMESPACE, 1: tNamespace))
            Do tResult.%Set("testProductions", [])
        }
        Set $NAMESPACE = tOrigNS
    } Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tErrored = 1
        Set tCmdStatus = ex.AsStatus()
    }
    Set $NAMESPACE = tOrigNS

    If tErrored {
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tCmdStatus))
    } Else {
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Quit tSC
}

/// The TestProduction decision for a run of <var>pTarget</var> at <var>pLevel</var>, taken in the current namespace.
/// <var>pCompiles</var> is 1 when the run compiles its test classes first (the Atelier work queue, behind
/// <code>iris_execute_tests</code>) and 0 when it runs the compiled classes as they are (the coverage runner).
/// <p><var>pResult</var> is <code>{decision, namespace, testProductions:[{class, production}], production?, state?,
/// stateCode?, error?}</code>. <code>decision</code> is <code>proceed</code> or <code>busy</code>
/// (<method>GuardOutcome</method>). <code>production</code>, <code>state</code> and <code>stateCode</code> are present
/// exactly when the production state was read; <code>error</code> is the sanitized reason when it could not be.</p>
/// <p>A run with no TestProduction test is <code>proceed</code> and calls nothing in <code>Ens.*</code>. Otherwise
/// the state is read with <code>Ens.Director:GetProductionStatus</code> while holding Ens's own lifecycle lock
/// <code>^Ens.Runtime</code> (five seconds to take it), which is released before the decision is rendered. Nothing
/// here starts, stops or cleans a production.</p>
ClassMethod ProductionGuard(pTarget As %String, pLevel As %String, pCompiles As %Boolean = 1, Output pResult As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pResult = ""
    Try {
        Set tTests = ..TestProductions(pTarget, pLevel, pCompiles)
        Set tRead = 0
        Set tName = ""
        Set tState = ""
        Set tError = ""
        If tTests '= "" {
            Set tLocked = 0
            Set tEnsSC = $$$OK
            Try {
                Lock +^Ens.Runtime:5 Set tLocked = $Test
                If tLocked {
                    Set tEnsSC = ##class(Ens.Director).GetProductionStatus(.tName, .tState, 2)
                    If $$$ISOK(tEnsSC) Set tRead = 1
                } Else {
                    Set tError = "The Ens runtime lock (Ens.Runtime) was not acquired within 5 seconds"
                }
            } Catch exEns {
                Set tRead = 0
                Set tEnsSC = exEns.AsStatus()
            }
            ; Released before anything else runs, so no later error can keep it.
            If tLocked {
                Lock -^Ens.Runtime
                Set tLocked = 0
            }
            If $$$ISERR(tEnsSC) Set tError = ..StatusText(tEnsSC)
        }

        Set pResult = {}
        Do pResult.%Set("decision", ..GuardOutcome(tTests, tRead, tState, tName))
        Do pResult.%Set("namespace", $NAMESPACE)
        Set tArray = []
        For tI = 1:1:$ListLength(tTests) {
            Set tItem = {}
            Do tItem.%Set("class", $List($List(tTests, tI), 1))
            Do tItem.%Set("production", $List($List(tTests, tI), 2))
            Do tArray.%Push(tItem)
        }
        Do pResult.%Set("testProductions", tArray)
        If tRead {
            Do pResult.%Set("production", tName)
            Do pResult.%Set("state", ##class(ExecuteMCPv2.REST.Interop).StateName(tState))
            Do pResult.%Set("stateCode", tState, "number")
        }
        If tError '= "" Do pResult.%Set("error", tError)
    } Catch ex {
        If $Get(tLocked) Lock -^Ens.Runtime
        Set pResult = ""
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Pure decision of the TestProduction guard: <code>proceed</code> or <code>busy</code>.
/// <var>pTestProductions</var> is the run's <method>TestProductions</method> list; <var>pStateRead</var> is whether the
/// production state was read, and <var>pState</var> and <var>pName</var> are the state code and production name read.
/// <table border="1">
/// <tr><th>TestProduction tests</th><th>State read</th><th>State</th><th>Name in the tests' own productions</th><th>Outcome</th></tr>
/// <tr><td>none</td><td>not asked</td><td>-</td><td>-</td><td>proceed</td></tr>
/// <tr><td>some</td><td>no (lock, error, exception)</td><td>Unknown</td><td>-</td><td>busy</td></tr>
/// <tr><td>some</td><td>yes</td><td>Stopped (2, or -2 on a mirror backup member)</td><td>any</td><td>proceed</td></tr>
/// <tr><td>some</td><td>yes</td><td>any other</td><td>yes</td><td>proceed</td></tr>
/// <tr><td>some</td><td>yes</td><td>any other</td><td>no (an empty name never matches)</td><td>busy</td></tr>
/// </table>
/// A sibling of <method>ExecuteMCPv2.REST.Interop:DeleteBlockedByState</method>: the same Stopped rule, a different
/// question.
ClassMethod GuardOutcome(pTestProductions As %List, pStateRead As %Boolean, pState As %Integer, pName As %String) As %String
{
    If pTestProductions = "" Quit "proceed"
    If 'pStateRead Quit "busy"
    If $ZAbs(pState) = 2 Quit "proceed"
    Set tOwn = 0
    If pName '= "" {
        For tI = 1:1:$ListLength(pTestProductions) {
            If $List($List(pTestProductions, tI), 2) = pName {
                Set tOwn = 1
                Quit
            }
        }
    }
    Quit $Select(tOwn: "proceed", 1: "busy")
}

/// The TestProduction tests of a run, as a <class>%List</class> of <code>$ListBuild(class, production)</code> items
/// sorted by class, in the current namespace; empty when the run has none.
/// <p>The classes are the class of <var>pTarget</var> (the part before a colon, trimmed) at the class and method
/// levels. At the package level they are the non-abstract classes under <code>&lt;package&gt;.</code> that the run
/// will run: when it compiles first (<var>pCompiles</var>), those the class dictionary lists as a subclass of
/// <class>%UnitTest.TestProduction</class> (the predicates of the tool's own package discovery, with the
/// TestProduction root; the list follows the class definitions, which is what the run compiles); when it does not,
/// every one of them, as <method>BuildTestSpec</method> lists them, because the runner runs the compiled class
/// whatever the definition now says. <method>ResolveTest</method> decides each class. A method-level run is guarded
/// whatever the method: a subclass method can call the private <code>StartProduction</code>.</p>
ClassMethod TestProductions(pTarget As %String, pLevel As %String, pCompiles As %Boolean = 1) As %List
{
    Set tResult = ""
    If pLevel = "package" {
        Set tQuery = "SELECT Name FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH ? AND Abstract = 0"
        If pCompiles Set tQuery = tQuery_" AND Name IN (SELECT Name FROM %Dictionary.ClassDefinitionQuery_SubclassOf('%UnitTest.TestProduction'))"
        Set tStmt = ##class(%SQL.Statement).%New()
        Set tSC = tStmt.%Prepare(tQuery)
        If $$$ISERR(tSC) Throw ##class(%Exception.StatusException).CreateFromStatus(tSC)
        Set tRS = tStmt.%Execute(pTarget_".")
        If tRS.%SQLCODE < 0 Throw ##class(%Exception.SQL).CreateFromSQLCODE(tRS.%SQLCODE, tRS.%Message)
        While tRS.%Next(.tNextSC) {
            Set tClasses(tRS.%Get("Name")) = ""
        }
        If $$$ISERR(tNextSC) Throw ##class(%Exception.StatusException).CreateFromStatus(tNextSC)
    } Else {
        Set tOne = $ZStrip($Piece(pTarget, ":", 1), "<>W")
        If tOne '= "" Set tClasses(tOne) = ""
    }

    Set tClass = ""
    For {
        Set tClass = $Order(tClasses(tClass))
        If tClass = "" Quit
        Kill tSeen
        Set tCount = 0
        If ..ResolveTest(tClass, pCompiles, .tSeen, .tCount, .tProduction) {
            Set tResult = tResult_$ListBuild($ListBuild(tClass, tProduction))
        }
    }
    Quit tResult
}

/// Is the class <var>pClass</var> a <class>%UnitTest.TestProduction</class> test, and what production does it declare?
/// <var>pProduction</var> is its <code>PRODUCTION</code> default.
/// <ul>
/// <li>When the class is compiled and, if the run compiles first (<var>pCompiles</var>), up to date
/// (<code>$System.OBJ.IsUpToDate</code>), the compiled class answers: <code>%Extends</code> and
/// <code>$parameter</code>. A run that does not compile (<var>pCompiles</var> 0) is answered by the compiled class
/// alone, and a class that is not compiled is not a test.</li>
/// <li>Otherwise the definition answers, because the Atelier work queue compiles the definition before it runs. The
/// superclasses are followed through their definitions (each normalized against the class that names it), or
/// through a superclass's compiled class when that is compiled and up to date. The class is a test when the chain
/// reaches <class>%UnitTest.TestProduction</class>, and its production is the <code>PRODUCTION</code> default of the
/// nearest class on that path whose definition sets one. At most 32 classes are visited, each once
/// (<var>pSeen</var> and <var>pCount</var> carry that across the recursion).</li>
/// <li>A class that is neither compiled nor defined is not a test.</li>
/// </ul>
ClassMethod ResolveTest(pClass As %String, pCompiles As %Boolean, ByRef pSeen, ByRef pCount As %Integer, Output pProduction As %String) As %Boolean
{
    Set pProduction = ""
    If '##class(ExecuteMCPv2.Coverage.Job).IsClassName(pClass) Quit 0
    If pClass = "%UnitTest.TestProduction" Quit 1
    If $Data(pSeen(pClass)) || (pCount >= 32) Quit 0
    Set pSeen(pClass) = ""
    Set pCount = pCount + 1

    Set tCompiled = $$$comClassDefined(pClass)
    Set tDefined = $$$defClassDefined(pClass)
    Set tUseCompiled = 0
    If tCompiled {
        If 'pCompiles || 'tDefined {
            Set tUseCompiled = 1
        } Else {
            Set tUseCompiled = ..IsUpToDate(pClass)
        }
    }
    If tUseCompiled {
        Set tIs = ..CompiledAnswer(pClass, .pProduction, .tAnswered)
        If tAnswered Quit tIs
    }
    If 'pCompiles || 'tDefined Quit 0

    Set tSuper = $$$defClassKeyGet(pClass, $$$cCLASSsuper)
    $$$NormalizeClassnameByDef(tSuper, pClass)
    Set tFound = 0
    Set tSuperProduction = ""
    For tI = 1:1:$Length(tSuper, ",") {
        Set tName = $ZStrip($Piece(tSuper, ",", tI), "<>W")
        If tName = "" Continue
        If ..ResolveTest(tName, pCompiles, .pSeen, .pCount, .tSuperProduction) {
            Set tFound = 1
            Quit
        }
    }
    If 'tFound Quit 0
    Set pProduction = tSuperProduction
    If $$$defMemberKeyDefined(pClass, $$$cCLASSparameter, "PRODUCTION", $$$cPARAMdefault)#2 {
        Set pProduction = $$$defMemberKeyGet(pClass, $$$cCLASSparameter, "PRODUCTION", $$$cPARAMdefault)
    }
    Quit 1
}

/// The compiled class <var>pClass</var>'s own answer to <method>ResolveTest</method>. <var>pAnswered</var> is 0 when the
/// class cannot be loaded, so the caller can fall back to the definition.
ClassMethod CompiledAnswer(pClass As %String, Output pProduction As %String, Output pAnswered As %Boolean) As %Boolean [ Private ]
{
    Set pProduction = ""
    Set pAnswered = 0
    Set tIs = 0
    Try {
        ; $classmethod throws for a class that cannot be loaded; the Catch leaves the class unanswered
        Set tIs = +$ClassMethod(pClass, "%Extends", "%UnitTest.TestProduction")
        If tIs Set pProduction = $Parameter(pClass, "PRODUCTION")
        Set pAnswered = 1
    } Catch {
        Set tIs = 0
        Set pProduction = ""
        Set pAnswered = 0
    }
    Quit tIs
}

/// Is the compiled class <var>pClass</var> up to date with its definition? An error is a no.
ClassMethod IsUpToDate(pClass As %String) As %Boolean [ Private ]
{
    Set tUpToDate = 0
    Try {
        Set tUpToDate = +$System.OBJ.IsUpToDate(pClass)
    } Catch {
        Set tUpToDate = 0
    }
    Quit tUpToDate
}

/// The sanitized text of an error status, without its leading <code>ERROR #N:</code> prefix (English or localized).
ClassMethod StatusText(pStatus As %Status) As %String [ Private ]
{
    Set tText = $System.Status.GetErrorText(##class(ExecuteMCPv2.Utils).SanitizeError(pStatus))
    Set tColon = $Find(tText, ": ")
    If (tColon > 0) && (tColon <= 24) {
        Set tHead = $Extract(tText, 1, tColon - 3)
        If ($Length(tHead, "#") = 2) && ($Piece(tHead, "#", 2) ? 1.N) Set tText = $Extract(tText, tColon, *)
    }
    Quit tText
}

}
