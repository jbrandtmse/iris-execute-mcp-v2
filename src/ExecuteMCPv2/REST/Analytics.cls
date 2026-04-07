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
Class ExecuteMCPv2.REST.Analytics Extends %Atelier.REST
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
            ; Synchronous build (pAsync=0)
            Set tSC2 = ##class(%DeepSee.Utils).%BuildCube(tCube, 0)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC2) {
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
                Set tSC = $$$OK
                Quit
            }
            Do tResult.%Set("action", "build")
            Do tResult.%Set("status", "completed")
        }
        ElseIf tAction = "sync" {
            ; Incremental synchronization (pVerbose=0)
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
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

}
