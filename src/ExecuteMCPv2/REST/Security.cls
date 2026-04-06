/// REST handler for user and password management operations.
/// <p>Provides user account CRUD, role assignment, and password
/// management via the custom REST endpoint
/// <code>/api/executemcp/v2/security/user</code>. All operations
/// execute in the <code>%SYS</code> namespace since <class>Security.Users</class>
/// requires it.</p>
/// <p>Follows the handler pattern established by <class>ExecuteMCPv2.REST.Config</class>:
/// namespace switch/restore, try/catch, input validation, error sanitization,
/// and RenderResponseBody envelope.</p>
/// <p><b>CRITICAL</b>: Password values are NEVER included in response bodies
/// or error messages (NFR6).</p>
Class ExecuteMCPv2.REST.Security Extends %Atelier.REST
{

/// List all user accounts with their properties (excluding passwords).
/// <p>Switches to <code>%SYS</code> and iterates over users via SQL
/// against <class>Security.Users</class>. Returns a JSON array of user
/// objects with <code>Name</code>, <code>FullName</code>, <code>Roles</code>,
/// <code>Enabled</code>, <code>Namespace</code>, and <code>Comment</code>.</p>
ClassMethod UserList() As %Status
{
    Set tSC = $$$OK
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        Set tResult = []

        ; Use SQL to enumerate all users
        Set tRS = ##class(%ResultSet).%New("Security.Users:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        While tRS.Next() {
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.Get("Name"))
            Do tEntry.%Set("fullName", tRS.Get("FullName"))
            Do tEntry.%Set("enabled", tRS.Get("Enabled"), "boolean")
            Do tEntry.%Set("namespace", tRS.Get("NameSpace"))
            Do tEntry.%Set("roles", tRS.Get("Roles"))
            Do tEntry.%Set("comment", tRS.Get("Comment"))
            Do tEntry.%Set("expirationDate", tRS.Get("ExpirationDate"))
            Do tEntry.%Set("changePasswordOnNextLogin", tRS.Get("ChangePassword"), "boolean")
            ; CRITICAL: Never include password values
            Do tResult.%Push(tEntry)
        }
        Do tRS.Close()

        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Get a single user account by name (excluding password).
/// <p>Switches to <code>%SYS</code> and calls <method>Security.Users.Get</method>
/// to retrieve user properties. Returns a JSON object with user details.</p>
ClassMethod UserGet(pName As %String) As %Status
{
    Set tSC = $$$OK
    Try {
        ; Validate name parameter
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(pName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        Set tSC = ##class(Security.Users).Get(pName, .tProps)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tEntry = {}
        Do tEntry.%Set("name", $Get(tProps("Name")))
        Do tEntry.%Set("fullName", $Get(tProps("FullName")))
        Do tEntry.%Set("enabled", +$Get(tProps("Enabled")), "boolean")
        Do tEntry.%Set("namespace", $Get(tProps("Namespace")))
        Do tEntry.%Set("routine", $Get(tProps("Routine")))
        Do tEntry.%Set("roles", $Get(tProps("Roles")))
        Do tEntry.%Set("comment", $Get(tProps("Comment")))
        Do tEntry.%Set("expirationDate", $Get(tProps("ExpirationDate")))
        Do tEntry.%Set("changePasswordOnNextLogin", +$Get(tProps("ChangePassword")), "boolean")
        ; CRITICAL: Never include password values

        Do ..RenderResponseBody($$$OK, , tEntry)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, modify, or delete a user account.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code>, and optional properties. Dispatches to
/// <class>Security.Users</class> in <code>%SYS</code>.</p>
/// <p><b>CRITICAL</b>: Password values are accepted in the request body
/// but NEVER echoed in responses or error messages.</p>
ClassMethod UserManage() As %Status
{
    Set tSC = $$$OK
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

        ; Extract and validate parameters
        Set tAction = tBody.%Get("action")
        Set tName = tBody.%Get("name")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate action value
        If (tAction '= "create") && (tAction '= "modify") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, modify, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Security operations
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            ; Password is required for create
            Set tPassword = tBody.%Get("password")
            If tPassword = "" {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'password' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tProps("Password") = tPassword
            If tBody.%Get("fullName") '= "" Set tProps("FullName") = tBody.%Get("fullName")
            If tBody.%Get("roles") '= "" Set tProps("Roles") = tBody.%Get("roles")
            If tBody.%IsDefined("enabled") Set tProps("Enabled") = +tBody.%Get("enabled")
            If tBody.%Get("namespace") '= "" Set tProps("Namespace") = tBody.%Get("namespace")
            If tBody.%Get("routine") '= "" Set tProps("Routine") = tBody.%Get("routine")
            If tBody.%Get("comment") '= "" Set tProps("Comment") = tBody.%Get("comment")
            If tBody.%Get("expirationDate") '= "" Set tProps("ExpirationDate") = tBody.%Get("expirationDate")
            If tBody.%IsDefined("changePasswordOnNextLogin") Set tProps("ChangePassword") = +tBody.%Get("changePasswordOnNextLogin")

            Set tSC = ##class(Security.Users).Create(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; CRITICAL: Never include password in response
            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            ; Build properties array from provided fields
            If tBody.%Get("fullName") '= "" Set tProps("FullName") = tBody.%Get("fullName")
            If tBody.%Get("roles") '= "" Set tProps("Roles") = tBody.%Get("roles")
            If tBody.%IsDefined("enabled") Set tProps("Enabled") = +tBody.%Get("enabled")
            If tBody.%Get("namespace") '= "" Set tProps("Namespace") = tBody.%Get("namespace")
            If tBody.%Get("routine") '= "" Set tProps("Routine") = tBody.%Get("routine")
            If tBody.%Get("comment") '= "" Set tProps("Comment") = tBody.%Get("comment")
            If tBody.%Get("expirationDate") '= "" Set tProps("ExpirationDate") = tBody.%Get("expirationDate")
            If tBody.%IsDefined("changePasswordOnNextLogin") Set tProps("ChangePassword") = +tBody.%Get("changePasswordOnNextLogin")

            Set tSC = ##class(Security.Users).Modify(tName, .tProps)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; CRITICAL: Never include password in response
            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Users).Delete(tName)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Add or remove roles from a user account.
/// <p>Reads a JSON body with <code>action</code> (add|remove),
/// <code>username</code>, and <code>role</code>. For add, appends the
/// role to the user's existing roles. For remove, strips it from the
/// comma-separated role list.</p>
ClassMethod UserRoles() As %Status
{
    Set tSC = $$$OK
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

        ; Extract and validate parameters
        Set tAction = tBody.%Get("action")
        Set tUsername = tBody.%Get("username")
        Set tRole = tBody.%Get("role")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tUsername, "username")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tRole, "role")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate action value
        If (tAction '= "add") && (tAction '= "remove") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: add, remove")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Security operations
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        ; Get current user properties
        Set tSC = ##class(Security.Users).Get(tUsername, .tProps)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tRoles = $Get(tProps("Roles"))

        If tAction = "add" {
            ; Append role if not already present
            If tRoles = "" {
                Set tNewRoles = tRole
            }
            Else {
                ; Check if role already exists in the list
                Set tFound = 0
                For tI = 1:1:$Length(tRoles, ",") {
                    If $Piece(tRoles, ",", tI) = tRole Set tFound = 1 Quit
                }
                If tFound {
                    ; Role already assigned — return success without modification
                    Set tResult = {"action": "add", "username": (tUsername), "role": (tRole), "message": "Role already assigned"}
                    Do ..RenderResponseBody($$$OK, , tResult)
                    Quit
                }
                Set tNewRoles = tRoles _ "," _ tRole
            }
        }
        ElseIf tAction = "remove" {
            ; Remove role from comma-separated list
            Set tNewRoles = ""
            Set tRemoved = 0
            For tI = 1:1:$Length(tRoles, ",") {
                Set tCurrent = $Piece(tRoles, ",", tI)
                If tCurrent = tRole {
                    Set tRemoved = 1
                }
                Else {
                    If tNewRoles '= "" Set tNewRoles = tNewRoles _ ","
                    Set tNewRoles = tNewRoles _ tCurrent
                }
            }
            If 'tRemoved {
                ; Role was not assigned — return success without modification
                Set tResult = {"action": "remove", "username": (tUsername), "role": (tRole), "message": "Role was not assigned"}
                Do ..RenderResponseBody($$$OK, , tResult)
                Quit
            }
        }

        ; Update user with new role list
        Kill tProps
        Set tProps("Roles") = tNewRoles
        Set tSC = ##class(Security.Users).Modify(tUsername, .tProps)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tResult = {}
        Do tResult.%Set("action", tAction)
        Do tResult.%Set("username", tUsername)
        Do tResult.%Set("role", tRole)
        Do tResult.%Set("roles", tNewRoles)
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Change a user's password or validate a candidate password.
/// <p>Reads a JSON body with <code>action</code> (change|validate),
/// <code>username</code> (required for change), and <code>password</code>.
/// For change, uses <method>Security.Users.Modify</method> with the
/// <code>ChangePassword</code> property. For validate, calls
/// <code>$SYSTEM.Security.ValidatePassword()</code>.</p>
/// <p><b>CRITICAL</b>: Password values are NEVER echoed in responses
/// or error messages. Only success/failure status is returned.</p>
ClassMethod UserPassword() As %Status
{
    Set tSC = $$$OK
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

        ; Extract and validate parameters
        Set tAction = tBody.%Get("action")
        Set tPassword = tBody.%Get("password")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tPassword, "password")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate action value
        If (tAction '= "change") && (tAction '= "validate") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: change, validate")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Security operations
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        If tAction = "change" {
            Set tUsername = tBody.%Get("username")
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tUsername, "username")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; Use ChangePassword property to change password
            Set tProps("ChangePassword") = tPassword
            Set tSC = ##class(Security.Users).Modify(tUsername, .tProps)
            If $$$ISERR(tSC) {
                ; CRITICAL: Sanitize error — do NOT include password in error message
                Set tSC = $$$ERROR($$$GeneralError, "Failed to change password for user '"_tUsername_"'")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; CRITICAL: Never include password in response
            Set tResult = {"action": "changed", "username": (tUsername), "success": true}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "validate" {
            ; Validate password against system password rules
            Set tSC = $SYSTEM.Security.ValidatePassword(tPassword)
            If $$$ISOK(tSC) {
                Set tResult = {"action": "validate", "valid": true}
            }
            Else {
                ; Extract validation message but NEVER include the password itself
                Set tMsg = $System.Status.GetErrorText(tSC)
                ; Remove any potential password values from the message
                Set tMsg = $Replace(tMsg, tPassword, "***")
                Set tResult = {"action": "validate", "valid": false, "message": (tMsg)}
                Set tSC = $$$OK
            }
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

}
