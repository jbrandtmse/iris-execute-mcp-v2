/// REST handler for IRIS DeepSee analytics operations.
/// <p>Provides endpoints for executing MDX queries and managing
/// DeepSee cubes via the custom REST endpoint
/// <code>/api/executemcp/v2/analytics</code>.</p>
/// <p>Supports three endpoints:</p>
/// <ul>
///   <li><b>POST /analytics/mdx</b> — Execute an MDX query and return
///       structured pivot-table results</li>
///   <li><b>GET /analytics/cubes</b> — List all DeepSee cubes with
///       metadata (source class, fact count, last build time)</li>
///   <li><b>POST /analytics/cubes</b> — Trigger a cube build or
///       incremental synchronization</li>
/// </ul>
/// <p>All operations execute in the <b>target namespace</b> (not %SYS)
/// because DeepSee classes live in application namespaces.</p>
Class ExecuteMCPv2.REST.Analytics Extends ExecuteMCPv2.REST.Base
{

/// Execute an MDX query and return structured pivot-table results.
/// <p>Reads a JSON request body with a <code>query</code> field containing
/// the MDX query string and an optional <code>namespace</code> field.</p>
/// <p>Returns a JSON object with <code>columns</code> (axis labels),
/// <code>rows</code> (each with a label and values array),
/// <code>rowCount</code>, and <code>columnCount</code>.</p>
ClassMethod ExecuteMDX() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body before any namespace switch
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate required query parameter
        Set tQuery = tBody.%Get("query")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tQuery, "query")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch to target namespace if provided
        Set tTargetNS = tBody.%Get("namespace")
        If tTargetNS '= "" {
            Set $NAMESPACE = tTargetNS
        }

        ; Execute MDX query
        Set tRS = ##class(%DeepSee.ResultSet).%ExecuteDirect(tQuery, , .tSC2)
        If $$$ISERR(tSC2) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
            Set tSC = $$$OK
            Quit
        }
        If '$IsObject(tRS) {
            Set $NAMESPACE = tOrigNS
            Set tSC2 = $$$ERROR($$$GeneralError, "MDX query returned no result set")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
            Set tSC = $$$OK
            Quit
        }

        ; Extract row and column counts
        Set tRowCount = tRS.%GetRowCount()
        Set tColCount = tRS.%GetColumnCount()

        ; Get column labels (axis 1 = columns)
        Set tColumns = []
        For i=1:1:tColCount {
            Set tLabelCount = tRS.%GetOrdinalLabel(.tLabel, 1, i)
            Do tColumns.%Push(tLabel)
        }

        ; Get rows with labels and values
        Set tRows = []
        For r=1:1:tRowCount {
            Set tRow = {}
            ; Row label (axis 2 = rows)
            Set tLabelCount = tRS.%GetOrdinalLabel(.tLabel, 2, r)
            Do tRow.%Set("label", tLabel)
            ; Cell values
            Set tValues = []
            For c=1:1:tColCount {
                Set tVal = tRS.%GetValue(r, c)
                Do tValues.%Push(tVal)
            }
            Do tRow.%Set("values", tValues)
            Do tRows.%Push(tRow)
        }

        Set $NAMESPACE = tOrigNS

        ; Build result
        Set tResult = {}
        Do tResult.%Set("columns", tColumns)
        Do tResult.%Set("rows", tRows)
        Do tResult.%Set("rowCount", tRowCount, "number")
        Do tResult.%Set("columnCount", tColCount, "number")
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List all DeepSee cubes with metadata.
/// <p>Uses <code>%DeepSee.Utils:%GetCubeList</code> to enumerate cubes,
/// then retrieves source class, fact count, and last modified date for each.</p>
/// <p>Optional <code>namespace</code> query parameter switches to a target
/// namespace before listing.</p>
ClassMethod CubeList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Switch to target namespace if provided
        Set tTargetNS = $Get(%request.Data("namespace",1))
        If tTargetNS '= "" {
            Set $NAMESPACE = tTargetNS
        }

        ; Get cube list
        Set tSC2 = ##class(%DeepSee.Utils).%GetCubeList(.tList)
        If $$$ISERR(tSC2) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
            Set tSC = $$$OK
            Quit
        }

        ; Build cubes array
        Set tCubes = []
        Set tName = $Order(tList(""))
        While tName '= "" {
            Set tCube = {}
            Do tCube.%Set("name", tName)
            Do tCube.%Set("sourceClass", ##class(%DeepSee.Utils).%GetCubeClass(tName))
            Do tCube.%Set("factCount", ##class(%DeepSee.Utils).%GetCubeFactCount(tName), "number")
            Do tCube.%Set("lastBuildTime", ##class(%DeepSee.Utils).%GetCubeModifiedDate(tName))
            Do tCubes.%Push(tCube)
            Set tName = $Order(tList(tName))
        }

        Set $NAMESPACE = tOrigNS

        Set tResult = {}
        Do tResult.%Set("cubes", tCubes)
        Do tResult.%Set("count", tCubes.%Size(), "number")
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Trigger a cube build or incremental synchronization.
/// <p>Reads a JSON request body with:</p>
/// <ul>
///   <li><code>action</code> — Required: "build" or "sync"</li>
///   <li><code>cube</code> — Required: cube name</li>
///   <li><code>namespace</code> — Optional: target namespace</li>
/// </ul>
/// <p>"build" calls <code>%DeepSee.Utils:%BuildCube</code> synchronously
/// (pAsync=0). "sync" calls <code>%DeepSee.Utils:%SynchronizeCube</code>
/// with pVerbose=0 and returns the updated facts count.</p>
ClassMethod CubeAction() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Set tRedirected = 0
    Try {
        ; Read JSON body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate action
        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "build") && (tAction '= "sync") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: build, sync")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Validate cube name
        Set tCube = tBody.%Get("cube")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tCube, "cube")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch to target namespace if provided
        Set tTargetNS = tBody.%Get("namespace")
        If tTargetNS '= "" {
            Set $NAMESPACE = tTargetNS
        }

        Set tResult = {}
        Do tResult.%Set("cube", tCube)

        If tAction = "build" {
            ; Story 35.2 (AC 35.2.1/35.2.2, ledger 35-SWEEP-2): %DeepSee.Utils:
            ; %BuildCube writes progress/diagnostic text directly to the CURRENT
            ; DEVICE (the HTTP response stream), so it lands ahead of the JSON
            ; envelope and makes the wire body unparseable (observed live:
            ; "\nERROR #20013: Cube 'NOSUCHCUBE' does not exist{"status":...}").
            ; Its pVerbose parameter — 3rd positional; live signature is
            ; pCubeList,pAsync=1,pVerbose=1,... — defaults to 1 and is NOT
            ; overridden below, unlike %SynchronizeCube's explicit pVerbose=0 in
            ; the "sync" branch, which is exactly why "sync" parsed cleanly and
            ; "build" did not. Isolate it with the SAME null-device redirect
            ; discipline already proven in Command.cls (Rule #7): bind the
            ; mnemonic on a throw-away null device — never $IO, see Redirects()'s
            ; banner below for why — restore FULLY before rendering, and render
            ; exactly once via the single If/Else dispatch already in this method.
            ;
            ; DO NOT "optimize" this by silencing the source with pVerbose=0
            ; (i.e. %BuildCube(tCube, 0, 0)). Story 35.2's code review probed
            ; this live and BOTH the progress narration AND the error text are
            ; gated by pVerbose: %BuildCube("NOSUCH",0,1) writes
            ; "\nERROR #20013: Cube ... does not exist" to the device, while
            ; %BuildCube("NOSUCH",0,0) writes NOTHING. (An earlier revision of
            ; this comment asserted the error path wrote unconditionally
            ; regardless of pVerbose — that claim was FALSE and is corrected
            ; here.) Silencing the source would leave the redirect below with
            ; nothing to isolate, and the permanent regression gate at
            ; packages/iris-data-mcp/src/__tests__/analytics-cubes-wire-gate.test.ts
            ; would become structurally INCAPABLE of failing: deleting this
            ; entire redirect block would still yield a clean wire body and a
            ; green gate. That is precisely Rule #59's "an oracle that cannot
            ; vary with the property it claims". The redirect is the mechanism;
            ; pVerbose's default is what keeps the regression detectable.
            Set %ExecuteMCPOutput = ""
            Set %ExecuteMCPTruncated = 0
            Set tInitIO = $IO
            Set tNull = ##class(%Library.Device).GetNullDevice()
            Open tNull:::1
            Use tNull::("^"_$ZNAME)
            Set tRedirected = 1
            Do ##class(%Library.Device).ReDirectIO(1)

            Try {
                Set tSC2 = ##class(%DeepSee.Utils).%BuildCube(tCube, 0)
            } Catch exBuild {
                ; Flag ONLY — do NOT render here. An argumentless Quit inside
                ; Catch exits only the catch body and falls through, so a
                ; render here would be clobbered by the success render below
                ; (Rule #7).
                Set tSC2 = exBuild.AsStatus()
            }

            ; Restore I/O unconditionally, before any render. Bare `Use
            ; tInitIO` (never `Use tInitIO::("")`, a NO-OP) is required to
            ; actually clear the mnemonic bound above.
            Do ##class(%Library.Device).ReDirectIO(0)
            Use tInitIO
            Close tNull
            Set tRedirected = 0
            Set $NAMESPACE = tOrigNS

            ; AC 35.2.3 disposition: the captured text is DISCARDED, not
            ; surfaced. %BuildCube's progress narration is diagnostic noise
            ; from a stock DeepSee API that no caller of this tool has ever
            ; asked for — the same judgment ExecuteMCPv2.REST.UnitTest already
            ; makes for %UnitTest.Manager.RunTest's own narration. Surfacing it
            ; would need its own ApplyOutputCeiling budget and wire-level
            ; truncation coverage for a field with no established consumer; if
            ; a future story needs build diagnostics, add an additive `output`
            ; field here bounded by ExecuteMCPv2.Utils.ApplyOutputCeiling
            ; exactly as Command.cls does for its own captured output.
            Kill %ExecuteMCPOutput
            Kill %ExecuteMCPTruncated

            If $$$ISERR(tSC2) {
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
                Set tSC = $$$OK
                Quit
            }
            Do tResult.%Set("action", "build")
            Do tResult.%Set("status", "completed")
        }
        ElseIf tAction = "sync" {
            ; Incremental synchronization (pVerbose=0) — verified clean of
            ; device output (Story 35.2 AC 35.2.4 audit); no redirect needed.
            Set tSC2 = ##class(%DeepSee.Utils).%SynchronizeCube(tCube, 0, .tFactsUpdated)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC2) {
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
                Set tSC = $$$OK
                Quit
            }
            Do tResult.%Set("action", "sync")
            Do tResult.%Set("status", "completed")
            Do tResult.%Set("factsUpdated", +$Get(tFactsUpdated, 0), "number")
        }

        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        ; Ensure redirection is restored on unexpected error before rendering
        ; (Story 35.2, mirrors Command.cls's own outer-catch belt-and-braces
        ; restore at Command.cls:132-138). Any errors during cleanup are
        ; swallowed so the real exception is still what gets rendered below.
        Try {
            If tRedirected {
                Do ##class(%Library.Device).ReDirectIO(0)
                If $Get(tInitIO) '= "" { Use tInitIO }
                If $Get(tNull) '= "" { Close tNull }
            }
        } Catch {}
        Kill %ExecuteMCPOutput
        Kill %ExecuteMCPTruncated
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// I/O redirect entry points for suppressing <code>%BuildCube</code>'s device
/// output (Story 35.2, AC 35.2.1/35.2.2).
/// <p>These label-based methods are referenced by the mnemonic routine set via
/// <code>Use tNull::("^"_$ZNAME)</code> in <method>CubeAction</method> when I/O
/// redirection is active. Captured output accumulates in the process-private
/// <code>%ExecuteMCPOutput</code> — the SAME global <class>ExecuteMCPv2.REST.
/// Command</class> uses — for consistency, even though this method's caller
/// currently kills it unread (AC 35.2.3: the captured text is discarded, not
/// surfaced). A separate copy of this tag routine is required in THIS class
/// (rather than reusing Command.cls's) because <code>$ZNAME</code> binds the
/// CURRENTLY EXECUTING routine, and the mnemonic entry points must live in
/// that same compiled routine (Story 34.1 Constraint C-2) — copied verbatim
/// from <class>ExecuteMCPv2.REST.Command</class>'s own <method>Redirects</method>
/// (34-2-R1 fix: each label discriminates on <code>&lt;MAXSTRING&gt;</code> so a
/// genuine crash is never mis-reported as a benign truncation).</p>
ClassMethod Redirects() [ Internal, Private, ProcedureBlock = 0 ]
{
    Quit
wstr(s) New mcpex Try { Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ s } Catch mcpex { If mcpex.Name '= "<MAXSTRING>" { Throw mcpex } Set %ExecuteMCPTruncated = 1 } Quit
wchr(a) New mcpex Try { Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ $Char(a) } Catch mcpex { If mcpex.Name '= "<MAXSTRING>" { Throw mcpex } Set %ExecuteMCPTruncated = 1 } Quit
wnl New mcpex Try { Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ $Char(10) } Catch mcpex { If mcpex.Name '= "<MAXSTRING>" { Throw mcpex } Set %ExecuteMCPTruncated = 1 } Quit
wff New mcpex Try { Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ $Char(12) } Catch mcpex { If mcpex.Name '= "<MAXSTRING>" { Throw mcpex } Set %ExecuteMCPTruncated = 1 } Quit
wtab(n) New chars,mcpex Try { Set $Piece(chars, " ", n+1) = "" Set %ExecuteMCPOutput = $Get(%ExecuteMCPOutput, "") _ chars } Catch mcpex { If mcpex.Name '= "<MAXSTRING>" { Throw mcpex } Set %ExecuteMCPTruncated = 1 } Quit
rstr(len,time) Quit ""
rchr(time) Quit ""
}

}
