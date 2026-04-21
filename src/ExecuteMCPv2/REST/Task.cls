/// REST handler for IRIS Task Scheduling operations.
/// <p>Provides endpoints for listing, creating, modifying, deleting, running,
/// and viewing history of scheduled tasks via the custom REST endpoint
/// <code>/api/executemcp/v2/task</code>.</p>
/// <p>All operations execute in <b>%SYS</b> namespace using the
/// <code>%SYS.Task</code> and <code>%SYS.Task.History</code> classes.</p>
Class ExecuteMCPv2.REST.Task Extends %Atelier.REST
{

/// List all scheduled tasks with details.
/// <p>Queries <code>%SYS.Task:TaskListDetail</code> named query in %SYS
/// namespace to return all scheduled tasks with schedule, status, and
/// configuration information.</p>
ClassMethod TaskList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tResult = {}
        Set tTasks = []

        Set tRS = ##class(%ResultSet).%New("%SYS.Task:TaskListDetail")
        Set tSC2 = tRS.Execute()
        If $$$ISERR(tSC2) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
            Set tSC = $$$OK
            Quit
        }

        While tRS.Next() {
            Set tTask = {}
            Do tTask.%Set("id", tRS.Get("ID"), "number")
            Do tTask.%Set("name", tRS.Get("Task Name"))
            Do tTask.%Set("description", tRS.Get("Description"))
            Do tTask.%Set("taskClass", tRS.Get("TaskClass"))
            Do tTask.%Set("namespace", tRS.Get("Namespace"))
            Do tTask.%Set("suspended", tRS.Get("Suspended"))
            Do tTask.%Set("priority", tRS.Get("Priority"))
            Do tTask.%Set("runInterval", tRS.Get("Run Interval"))
            Do tTask.%Set("nextScheduledDate", tRS.Get("Next Scheduled Date"))
            Do tTask.%Set("nextScheduledTime", tRS.Get("Next Scheduled Time"))
            Do tTask.%Set("lastStarted", tRS.Get("Last Started"))
            Do tTask.%Set("lastFinished", tRS.Get("Last Finished"))
            Do tTask.%Set("lastStatus", tRS.Get("Last Status"))
            Do tTask.%Set("lastResult", tRS.Get("Last Result"))
            Do tTasks.%Push(tTask)
        }
        Do tRS.Close()

        Do tResult.%Set("tasks", tTasks)
        Do tResult.%Set("count", tTasks.%Size(), "number")
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, modify, or delete a scheduled task.
/// <p>Reads a JSON request body with an <code>action</code> field and
/// task properties. Supported actions:</p>
/// <ul>
///   <li><b>create</b> — requires <code>name</code>, <code>taskClass</code>,
///       <code>namespace</code>; optional <code>description</code>,
///       <code>suspended</code></li>
///   <li><b>modify</b> — requires <code>id</code>; updates only provided
///       fields</li>
///   <li><b>delete</b> — requires <code>id</code></li>
/// </ul>
ClassMethod TaskManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body before namespace switch
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate action
        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "create") && (tAction '= "modify") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, modify, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for task operations
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            Set tName = tBody.%Get("name")
            Set tTaskClass = tBody.%Get("taskClass")
            Set tNamespace = tBody.%Get("namespace")

            If tName = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'name' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            If tTaskClass = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'taskClass' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            If tNamespace = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'namespace' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tTask = ##class(%SYS.Task).%New()
            Set tTask.Name = tName
            Set tTask.TaskClass = tTaskClass
            Set tTask.NameSpace = tNamespace
            If tBody.%Get("description") '= "" Set tTask.Description = tBody.%Get("description")
            If tBody.%IsDefined("suspended") Set tTask.Suspended = +tBody.%Get("suspended")

            Set tSC2 = tTask.%Save()
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC2) {
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
                Set tSC = $$$OK
                Quit
            }

            Set tResult = {"action": "created", "id": (tTask.%Id()), "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            Set tId = tBody.%Get("id")
            If tId = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'id' is required for modify action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tTask = ##class(%SYS.Task).%OpenId(tId)
            If '$IsObject(tTask) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Task with ID '"_tId_"' not found")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            If tBody.%IsDefined("name") Set tTask.Name = tBody.%Get("name")
            If tBody.%IsDefined("taskClass") Set tTask.TaskClass = tBody.%Get("taskClass")
            If tBody.%IsDefined("namespace") Set tTask.NameSpace = tBody.%Get("namespace")
            If tBody.%IsDefined("description") Set tTask.Description = tBody.%Get("description")
            If tBody.%IsDefined("suspended") Set tTask.Suspended = +tBody.%Get("suspended")

            Set tSC2 = tTask.%Save()
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC2) {
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
                Set tSC = $$$OK
                Quit
            }

            Set tResult = {"action": "modified", "id": (tId)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tId = tBody.%Get("id")
            If tId = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'id' is required for delete action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tSC2 = ##class(%SYS.Task).%DeleteId(tId)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC2) {
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
                Set tSC = $$$OK
                Quit
            }

            Set tResult = {"action": "deleted", "id": (tId)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Run a task immediately by ID.
/// <p>Calls <code>%SYS.Task:RunNow(taskId)</code> which triggers asynchronous
/// execution of the specified task. The response confirms the task was
/// triggered but does not wait for completion.</p>
ClassMethod TaskRun() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body before namespace switch
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tId = tBody.%Get("id")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tId, "id")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch to %SYS for RunNow
        Set $NAMESPACE = "%SYS"

        Set tSC2 = ##class(%SYS.Task).RunNow(tId)
        Set $NAMESPACE = tOrigNS
        If $$$ISERR(tSC2) {
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
            Set tSC = $$$OK
            Quit
        }

        Set tResult = {"triggered": true, "id": (tId), "message": "Task execution triggered (async)"}
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Return task execution history.
/// <p>Queries <code>%SYS.Task.History:TaskHistoryDetail</code> named query.
/// When a <code>taskId</code> query parameter is provided, filters history
/// to that specific task. Results are capped by <code>maxRows</code>
/// (default 100, max 1000) to keep responses bounded on busy systems.</p>
ClassMethod TaskHistory() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tTaskId = $Get(%request.Data("taskId",1))
        Set tMaxRows = +$Get(%request.Data("maxRows",1))
        If tMaxRows <= 0 Set tMaxRows = 100
        If tMaxRows > 1000 Set tMaxRows = 1000

        Set $NAMESPACE = "%SYS"
        Set tResult = {}
        Set tHistory = []

        If tTaskId '= "" {
            Set tRS = ##class(%ResultSet).%New("%SYS.Task.History:TaskHistoryForTask")
            Set tSC2 = tRS.Execute(+tTaskId)
        }
        Else {
            Set tRS = ##class(%ResultSet).%New("%SYS.Task.History:TaskHistoryDetail")
            Set tSC2 = tRS.Execute()
        }
        If $$$ISERR(tSC2) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
            Set tSC = $$$OK
            Quit
        }

        Set tTotal = 0
        Set tReturned = 0
        While tRS.Next() {
            Set tTotal = tTotal + 1
            If tReturned < tMaxRows {
                Set tEntry = {}
                Do tEntry.%Set("taskName", tRS.Get("Task Name"))
                Do tEntry.%Set("lastStart", tRS.Get("Last Start"))
                Do tEntry.%Set("completed", tRS.Get("Completed"))
                Do tEntry.%Set("status", tRS.Get("Status"))
                Do tEntry.%Set("result", tRS.Get("Result"))
                Do tEntry.%Set("namespace", tRS.Get("NameSpace"))
                Do tEntry.%Set("username", tRS.Get("Username"))
                Do tEntry.%Set("taskId", tRS.Get("Task"))
                Do tHistory.%Push(tEntry)
                Set tReturned = tReturned + 1
            }
        }
        Do tRS.Close()

        Do tResult.%Set("history", tHistory)
        Do tResult.%Set("count", tHistory.%Size(), "number")
        Do tResult.%Set("total", tTotal, "number")
        Do tResult.%Set("maxRows", tMaxRows, "number")
        Do tResult.%Set("truncated", (tTotal > tReturned), "boolean")
        Set $NAMESPACE = tOrigNS
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
