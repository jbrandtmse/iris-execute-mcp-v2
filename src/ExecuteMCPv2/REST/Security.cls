/// REST handler for security management operations.
/// <p>Provides user account CRUD, role assignment, password
/// management, role management, resource management, and permission
/// checking via the custom REST endpoint
/// <code>/api/executemcp/v2/security/</code>. All operations
/// execute in the <code>%SYS</code> namespace since <class>Security.Users</class>,
/// <class>Security.Roles</class>, and <class>Security.Resources</class>
/// require it.</p>
/// <p>Follows the handler pattern established by <class>ExecuteMCPv2.REST.Config</class>:
/// namespace switch/restore, try/catch, input validation, error sanitization,
/// and RenderResponseBody envelope.</p>
/// <p><b>CRITICAL</b>: Namespace switching uses <code>Set tOrigNS = $NAMESPACE</code>
/// and manual restore (never <code>New $NAMESPACE</code>) so that
/// <class>ExecuteMCPv2.Utils</class> remains visible in catch blocks.</p>
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
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"

        Set tResult = []

        ; Use SQL to enumerate all users
        Set tRS = ##class(%ResultSet).%New("Security.Users:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        While tRS.Next() {
            ; Security.Users:List ROWSPEC is Name, Enabled, Roles,
            ; LastLoginTime, Flags — it does NOT expose FullName,
            ; Namespace, Comment, ExpirationDate, or ChangePassword.
            ; Backfill via per-row Security.Users.Get() to return
            ; the full set the schema advertises. Bug #4.
            Set tName = tRS.Get("Name")
            Set tGetSC = ##class(Security.Users).Get(tName, .tProps)
            Set tEntry = {}
            Do tEntry.%Set("name", tName)
            If $$$ISOK(tGetSC) {
                Do tEntry.%Set("fullName", $Get(tProps("FullName")))
                Do tEntry.%Set("enabled", +$Get(tProps("Enabled")), "boolean")
                Do tEntry.%Set("namespace", $Get(tProps("Namespace")))
                Do tEntry.%Set("roles", $Get(tProps("Roles")))
                Do tEntry.%Set("comment", $Get(tProps("Comment")))
                Do tEntry.%Set("expirationDate", $Get(tProps("ExpirationDate")))
                Do tEntry.%Set("changePasswordOnNextLogin", +$Get(tProps("ChangePassword")), "boolean")
            }
            Else {
                ; Fall back to ROWSPEC-exposed fields only so a single
                ; unreadable user does not drop the entire list.
                Do tEntry.%Set("enabled", +tRS.Get("Enabled"), "boolean")
                Do tEntry.%Set("roles", tRS.Get("Roles"))
            }
            ; CRITICAL: Never include password values
            Do tResult.%Push(tEntry)
        }
        Do tRS.Close()

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
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
    Set tOrigNS = $NAMESPACE
    Try {
        ; Validate name parameter (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(pName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        Set tSC = ##class(Security.Users).Get(pName, .tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tEntry = {}
        ; Security.Users.Get uses the pName argument as the lookup key
        ; and does NOT populate tProps("Name") — echo the input directly
        ; (authoritative because the lookup succeeded). Bug #5.
        Do tEntry.%Set("name", pName)
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
        Set $NAMESPACE = tOrigNS
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
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate parameters (before namespace switch)
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
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            ; Password is required for create
            Set tPassword = tBody.%Get("password")
            If tPassword = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'password' is required for create action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; Security.Users.Create takes positional scalars:
            ; (Username, UserRoles, Password, FullName, NameSpace, Routine, ExpirationDate,
            ;  ChangePassword, Enabled, Comment, Flags = 1, PhoneNumber, PhoneProvider,
            ;  ByRef Attributes, AccountNeverExpires, PasswordNeverExpires, ...)
            Set tUserRoles = ""
            Set tFullName = ""
            Set tUserNamespace = ""
            Set tRoutine = ""
            Set tExpirationDate = ""
            Set tChangePassword = 0
            ; Match IRIS Security.Users.Create default when Enabled is not in Properties: enabled = 1
            Set tEnabled = 1
            Set tComment = ""
            If tBody.%Get("roles") '= "" Set tUserRoles = tBody.%Get("roles")
            If tBody.%Get("fullName") '= "" Set tFullName = tBody.%Get("fullName")
            If tBody.%Get("namespace") '= "" Set tUserNamespace = tBody.%Get("namespace")
            If tBody.%Get("routine") '= "" Set tRoutine = tBody.%Get("routine")
            If tBody.%Get("expirationDate") '= "" Set tExpirationDate = tBody.%Get("expirationDate")
            If tBody.%IsDefined("changePasswordOnNextLogin") Set tChangePassword = +tBody.%Get("changePasswordOnNextLogin")
            If tBody.%IsDefined("enabled") Set tEnabled = +tBody.%Get("enabled")
            If tBody.%Get("comment") '= "" Set tComment = tBody.%Get("comment")

            Set tSC = ##class(Security.Users).Create(tName, tUserRoles, tPassword, tFullName, tUserNamespace, tRoutine, tExpirationDate, tChangePassword, tEnabled, tComment)
            Set $NAMESPACE = tOrigNS
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
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; CRITICAL: Never include password in response
            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Users).Delete(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
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
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate parameters (before namespace switch)
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
        Set $NAMESPACE = "%SYS"

        ; Get current user properties
        Set tSC = ##class(Security.Users).Get(tUsername, .tProps)
        Set $NAMESPACE = tOrigNS
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

        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Security.Users).Modify(tUsername, .tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tResult = {}
        Do tResult.%Set("action", tAction)
        Do tResult.%Set("username", tUsername)
        Do tResult.%Set("role", tRole)
        Do tResult.%Set("roles", tNewRoles)
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
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
/// <code>Password</code> property (the write-only password setter).
/// Optional <code>changePasswordOnNextLogin</code> boolean sets the
/// <code>ChangePassword</code> flag (force-change-on-next-login) alongside
/// the new password in the same Modify call. For validate, calls
/// <code>$SYSTEM.Security.ValidatePassword()</code> and returns the active
/// password policy from <code>Security.System.Get()</code>.</p>
/// <p><b>CRITICAL</b>: Password values are NEVER echoed in responses
/// or error messages. Only success/failure status is returned.</p>
ClassMethod UserPassword() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate parameters (before namespace switch)
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

        If tAction = "change" {
            Set tUsername = tBody.%Get("username")
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tUsername, "username")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            ; Switch to %SYS for Security operations
            Set $NAMESPACE = "%SYS"

            ; Password is the write-only setter for the actual password value.
            ; ChangePassword is a boolean flag (force-change-on-next-login) — NOT the password setter.
            ; Bug #1 (Story 12.1): original code set tProps("ChangePassword") = tPassword which triggered
            ; "Datatype value 'X' is not a valid boolean" on every password change attempt.
            Set tProps("Password") = tPassword
            ; If caller explicitly provides changePasswordOnNextLogin, set the force-change flag
            ; in the same Modify() call. Default (omitted) leaves the existing flag untouched.
            If tBody.%IsDefined("changePasswordOnNextLogin") {
                Set tProps("ChangePassword") = +tBody.%Get("changePasswordOnNextLogin")
            }
            Set tSC = ##class(Security.Users).Modify(tUsername, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) {
                ; Bug #12 — propagate the real IRIS error text (sanitized)
                ; so callers see policy violations, missing-user errors,
                ; etc. Security.Users.Modify() with tProps("Password")
                ; does NOT embed the password in its %Status text, so the
                ; generic wrap that used to be here removed diagnostic
                ; signal for no security gain.
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            ; CRITICAL: Never include password in response
            Set tResult = {"action": "changed", "username": (tUsername), "success": true}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "validate" {
            ; Read active password policy from Security.System (in %SYS).
            ; PasswordPattern is an ObjectScript match-pattern string (e.g. "3.128ANP")
            ; where the leading N.M quantifier encodes the min-length (N) and max-length (M).
            ; Policy fields are system-level — they do NOT leak the candidate password.
            Set tPolicyMinLength = 0
            Set tPolicyPattern = ""
            Set tPolicyComment = ""
            Set $NAMESPACE = "%SYS"
            Kill tSysProps
            Set tSysGetSC = ##class(Security.System).Get("SYSTEM", .tSysProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISOK(tSysGetSC) {
                Set tRawPattern = $Get(tSysProps("PasswordPattern"))
                ; "No rules" sentinel values: empty string, or a very loose "1." pattern (1+ chars, any type).
                ; Any other pattern (including the IRIS install default "3.128ANP") IS a real policy and is parsed.
                ; Extract min-length from leading quantifier: N.M or N at start of pattern.
                If tRawPattern = "" {
                    Set tPolicyComment = "No password policy configured on this instance"
                } ElseIf $Extract(tRawPattern, 1, 2) = "1." && ($Length(tRawPattern) <= 4) {
                    ; Matches very loose patterns like "1." which means "1 or more of any type" — effectively no rules
                    Set tPolicyComment = "No password policy configured on this instance"
                } Else {
                    ; Parse leading quantifier N.M or N from the pattern string
                    Set tPolicyPattern = tRawPattern
                    Set tDotPos = $Find(tRawPattern, ".")
                    If tDotPos > 1 {
                        ; N.M form — min-length is the part before the dot
                        Set tMinPart = $Extract(tRawPattern, 1, tDotPos - 2)
                        If tMinPart ? 1.N {
                            Set tPolicyMinLength = +tMinPart
                        }
                    } Else {
                        ; N form — exact length
                        Set tSingleNum = ""
                        For tCI = 1:1:$Length(tRawPattern) {
                            Set tChar = $Extract(tRawPattern, tCI)
                            If tChar ? 1N { Set tSingleNum = tSingleNum _ tChar }
                            Else { Quit }
                        }
                        If tSingleNum '= "" { Set tPolicyMinLength = +tSingleNum }
                    }
                }
            } Else {
                Set tPolicyComment = "Could not read password policy"
            }

            ; Validate password against system password rules
            Set $NAMESPACE = "%SYS"
            Set tSC = $SYSTEM.Security.ValidatePassword(tPassword)
            Set $NAMESPACE = tOrigNS

            ; Build policy sub-object (system-level only — never includes candidate password)
            ; When pattern is empty (no rules), set the JSON "pattern" key to JSON null.
            Set tPolicyObj = {"minLength": (tPolicyMinLength)}
            If tPolicyPattern = "" {
                Do tPolicyObj.%Set("pattern", "", "null")
            } Else {
                Do tPolicyObj.%Set("pattern", tPolicyPattern)
            }
            If tPolicyComment '= "" {
                Do tPolicyObj.%Set("comment", tPolicyComment)
            }

            If $$$ISOK(tSC) {
                Set tResult = {"action": "validate", "valid": true}
            }
            Else {
                ; Extract validation message but NEVER include the password itself
                ; Use a generic message to avoid any risk of password leakage
                ; through IRIS-reformatted or truncated error text
                Set tMsg = $System.Status.GetErrorText(tSC)
                ; Strip the password only when it is long enough to make unconditional
                ; $Replace safe. Short candidates (e.g. "a") would otherwise corrupt
                ; the generic IRIS validation message — which never embeds the
                ; candidate password in the first place (Bug #8).
                If $Length(tPassword) >= 8 {
                    Set tMsg = $Replace(tMsg, tPassword, "***")
                }
                If $Length(tPassword) >= 3 {
                    ; Also strip partial matches (IRIS may truncate or reformat)
                    Set tPwdLen = $Length(tPassword)
                    For tK = tPwdLen:-1:3 {
                        Set tFragment = $Extract(tPassword, 1, tK)
                        Set tMsg = $Replace(tMsg, tFragment, "***")
                    }
                }
                Set tResult = {"action": "validate", "valid": false, "message": (tMsg)}
                Set tSC = $$$OK
            }
            ; Attach active password policy (safe — system-level, no candidate password)
            Do tResult.%Set("policy", tPolicyObj)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List all security roles.
/// <p>Switches to <code>%SYS</code> and iterates over roles via the
/// <class>Security.Roles</class> SQL query. Returns a JSON array of role
/// objects with <code>name</code>, <code>description</code>,
/// <code>resources</code>, and <code>grantedRoles</code>.</p>
ClassMethod RoleList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"

        Set tResult = []

        ; Use SQL to enumerate all roles.
        ; Use ListAll (ROWSPEC: Name, Description, GrantedRoles, Resources,
        ; EscalationOnly) instead of List (no Resources column). Bug #3.
        Set tRS = ##class(%ResultSet).%New("Security.Roles:ListAll")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        While tRS.Next() {
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.Get("Name"))
            Do tEntry.%Set("description", tRS.Get("Description"))
            Do tEntry.%Set("resources", tRS.Get("Resources"))
            Do tEntry.%Set("grantedRoles", tRS.Get("GrantedRoles"))
            Do tResult.%Push(tEntry)
        }
        Do tRS.Close()

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, modify, or delete a security role.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code>, and optional properties (<code>description</code>,
/// <code>resources</code>, <code>grantedRoles</code>). Dispatches to
/// <class>Security.Roles</class> in <code>%SYS</code>.</p>
ClassMethod RoleManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate parameters (before namespace switch)
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
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            ; Security.Roles.Create takes positional scalars: (Name, Description, Resources, GrantedRoles, EscalationOnly = 0)
            Set tDescription = ""
            Set tResources = ""
            Set tGrantedRoles = ""
            If tBody.%IsDefined("description") Set tDescription = tBody.%Get("description")
            If tBody.%IsDefined("resources") Set tResources = tBody.%Get("resources")
            If tBody.%IsDefined("grantedRoles") Set tGrantedRoles = tBody.%Get("grantedRoles")

            Set tSC = ##class(Security.Roles).Create(tName, tDescription, tResources, tGrantedRoles)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("resources") Set tProps("Resources") = tBody.%Get("resources")
            If tBody.%IsDefined("grantedRoles") Set tProps("GrantedRoles") = tBody.%Get("grantedRoles")

            Set tSC = ##class(Security.Roles).Modify(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Roles).Delete(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List all security resources.
/// <p>Switches to <code>%SYS</code> and iterates over resources via the
/// <class>Security.Resources</class> SQL query. Returns a JSON array of
/// resource objects with <code>name</code>, <code>description</code>,
/// <code>publicPermission</code>, and <code>type</code>.</p>
ClassMethod ResourceList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"

        Set tResult = []

        ; Use SQL to enumerate all resources
        Set tRS = ##class(%ResultSet).%New("Security.Resources:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        While tRS.Next() {
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.Get("Name"))
            Do tEntry.%Set("description", tRS.Get("Description"))
            Do tEntry.%Set("publicPermission", tRS.Get("PublicPermission"))
            Do tEntry.%Set("type", tRS.Get("Type"))
            Do tResult.%Push(tEntry)
        }
        Do tRS.Close()

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, modify, or delete a security resource.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code>, and optional properties (<code>description</code>,
/// <code>publicPermission</code>). Dispatches to
/// <class>Security.Resources</class> in <code>%SYS</code>.</p>
ClassMethod ResourceManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate parameters (before namespace switch)
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
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            ; Security.Resources.Create takes positional scalars: (Name, Description, PublicPermission, Type)
            ; Type is "Internal use only" per IRIS docs and is omitted.
            Set tDescription = ""
            Set tPublicPermission = ""
            If tBody.%IsDefined("description") Set tDescription = tBody.%Get("description")
            If tBody.%IsDefined("publicPermission") Set tPublicPermission = tBody.%Get("publicPermission")

            Set tSC = ##class(Security.Resources).Create(tName, tDescription, tPublicPermission)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "created", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("publicPermission") Set tProps("PublicPermission") = tBody.%Get("publicPermission")

            Set tSC = ##class(Security.Resources).Modify(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Resources).Delete(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Check whether a user or role has a specific permission on a resource.
/// <p>Reads a JSON body with <code>target</code> (username or role name),
/// <code>resource</code>, and <code>permission</code> (R, W, U, or combination).
/// Looks up the target's assigned resources (via <class>Security.Users</class>
/// or <class>Security.Roles</class>) and checks if the requested permission
/// is granted on the specified resource.</p>
ClassMethod PermissionCheck() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate parameters (before namespace switch)
        Set tTarget = tBody.%Get("target")
        Set tResource = tBody.%Get("resource")
        Set tPermission = tBody.%Get("permission")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tTarget, "target")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tResource, "resource")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tPermission, "permission")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        ; Determine if target is a user or role by checking existence
        Set tIsUser = ##class(Security.Users).Exists(tTarget)
        Set tIsRole = ##class(Security.Roles).Exists(tTarget)

        If 'tIsUser && 'tIsRole {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "Target '"_tTarget_"' is not a known user or role")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Get the resources string for the target
        Set tGrantedResources = ""
        Set tTargetType = ""

        If tIsUser {
            Set tTargetType = "user"
            ; Get user's roles, then collect all resources from those roles
            Set tSC = ##class(Security.Users).Get(tTarget, .tUserProps)
            If $$$ISERR(tSC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            ; Check user's directly-assigned resources first
            Set tDirectResources = $Get(tUserProps("Resources"))
            If tDirectResources '= "" {
                Set tGrantedResources = tDirectResources
            }
            Set tUserRoles = $Get(tUserProps("Roles"))
            ; Collect resources from all assigned roles
            For tI = 1:1:$Length(tUserRoles, ",") {
                Set tRoleName = $Piece(tUserRoles, ",", tI)
                If tRoleName = "" Continue
                Set tRoleSC = ##class(Security.Roles).Get(tRoleName, .tRoleProps)
                If $$$ISOK(tRoleSC) {
                    Set tRoleRes = $Get(tRoleProps("Resources"))
                    If tRoleRes '= "" {
                        If tGrantedResources '= "" Set tGrantedResources = tGrantedResources _ ","
                        Set tGrantedResources = tGrantedResources _ tRoleRes
                    }
                }
            }
        }
        Else {
            Set tTargetType = "role"
            Set tSC = ##class(Security.Roles).Get(tTarget, .tRoleProps)
            If $$$ISERR(tSC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tGrantedResources = $Get(tRoleProps("Resources"))
        }

        ; Bug #10 — %All super-role short-circuit. %All is special-cased by
        ; the IRIS security subsystem: Security.Roles.Get("%All", .tProps)
        ; returns empty Resources even though the role grants everything.
        ; Any handler walking the resources list must special-case it —
        ; otherwise %All holders (including _SYSTEM) test as granted:false
        ; on every resource. Verified empirically 2026-04-21.
        Set tIsSuperUser = 0
        If tTarget = "%All" {
            Set tIsSuperUser = 1
        }
        ElseIf tIsUser {
            Set tRolesList = $Get(tUserRoles)
            For tI = 1:1:$Length(tRolesList, ",") {
                If $Piece(tRolesList, ",", tI) = "%All" {
                    Set tIsSuperUser = 1
                    Quit
                }
            }
        }

        ; Done with %SYS — restore namespace for response rendering
        Set $NAMESPACE = tOrigNS

        If tIsSuperUser {
            Set tResult = {}
            Do tResult.%Set("target", tTarget)
            Do tResult.%Set("targetType", tTargetType)
            Do tResult.%Set("resource", tResource)
            Do tResult.%Set("permission", tPermission)
            Do tResult.%Set("granted", 1, "boolean")
            Do tResult.%Set("grantedPermission", "RWU")
            Do tResult.%Set("reason", "target holds %All super-role")
            Do ..RenderResponseBody($$$OK, , tResult)
            Quit
        }

        ; Parse the resources string to check if the requested permission is granted
        ; Resources format: "ResName:RWU,ResName2:R"
        Set tHasPermission = 0
        Set tFoundResource = 0
        Set tGrantedPermission = ""
        For tI = 1:1:$Length(tGrantedResources, ",") {
            Set tPair = $Piece(tGrantedResources, ",", tI)
            Set tResName = $Piece(tPair, ":", 1)
            Set tResPerm = $Piece(tPair, ":", 2)
            If tResName = tResource {
                Set tFoundResource = 1
                Set tGrantedPermission = tResPerm
                ; Check each character of requested permission exists in granted
                Set tHasPermission = 1
                For tJ = 1:1:$Length(tPermission) {
                    Set tChar = $Extract(tPermission, tJ)
                    If tResPerm '[ tChar {
                        Set tHasPermission = 0
                        Quit
                    }
                }
                Quit
            }
        }

        Set tResult = {}
        Do tResult.%Set("target", tTarget)
        Do tResult.%Set("targetType", tTargetType)
        Do tResult.%Set("resource", tResource)
        Do tResult.%Set("permission", tPermission)
        Do tResult.%Set("granted", tHasPermission, "boolean")
        If tFoundResource Do tResult.%Set("grantedPermission", tGrantedPermission)

        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List all web applications, optionally filtered by namespace.
/// <p>Switches to <code>%SYS</code> and queries <class>Security.Applications</class>
/// via SQL. If a <code>namespace</code> query parameter is provided, only web
/// applications targeting that namespace are returned. Returns a JSON array
/// of web application objects.</p>
ClassMethod WebAppList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {

        ; Check for optional namespace filter from query parameter
        Set tNamespaceFilter = $Get(%request.Data("namespace", 1))

        Set tResult = []

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        ; Use SQL to enumerate web applications
        If tNamespaceFilter '= "" {
            Set tStatement = ##class(%SQL.Statement).%New()
            Set tSC = tStatement.%Prepare("SELECT Name, NameSpace, DispatchClass, Description, Enabled, AutheEnabled, IsNameSpaceDefault, CSPZENEnabled, Recurse, MatchRoles, CookiePath FROM Security.Applications WHERE NameSpace = ?")
            If $$$ISERR(tSC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tRS = tStatement.%Execute(tNamespaceFilter)
        }
        Else {
            Set tStatement = ##class(%SQL.Statement).%New()
            Set tSC = tStatement.%Prepare("SELECT Name, NameSpace, DispatchClass, Description, Enabled, AutheEnabled, IsNameSpaceDefault, CSPZENEnabled, Recurse, MatchRoles, CookiePath FROM Security.Applications")
            If $$$ISERR(tSC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tRS = tStatement.%Execute()
        }

        If tRS.%SQLCODE < 0 {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "SQL error listing web applications: " _ tRS.%Message)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        While tRS.%Next() {
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.%Get("Name"))
            Do tEntry.%Set("namespace", tRS.%Get("NameSpace"))
            Do tEntry.%Set("dispatchClass", tRS.%Get("DispatchClass"))
            Do tEntry.%Set("description", tRS.%Get("Description"))
            Do tEntry.%Set("enabled", +tRS.%Get("Enabled"), "boolean")
            Do tEntry.%Set("authEnabled", +tRS.%Get("AutheEnabled"), "number")
            Do tEntry.%Set("isNameSpaceDefault", +tRS.%Get("IsNameSpaceDefault"), "boolean")
            Do tEntry.%Set("cspZenEnabled", +tRS.%Get("CSPZENEnabled"), "boolean")
            Do tEntry.%Set("recurse", +tRS.%Get("Recurse"), "boolean")
            Do tEntry.%Set("matchRoles", tRS.%Get("MatchRoles"))
            ; Resource column omitted — reserved word conflict in SQL projection
            Do tEntry.%Set("cookiePath", tRS.%Get("CookiePath"))
            Do tResult.%Push(tEntry)
        }

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Get a single web application by name.
/// <p>Switches to <code>%SYS</code> and calls <method>Security.Applications.Get</method>
/// to retrieve web application properties. The <var>pName</var> parameter should
/// be URL-decoded by the dispatch framework (web app names start with <code>/</code>).</p>
ClassMethod WebAppGet(pName As %String) As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Validate name parameter (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(pName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; URL-decode the name (webapp names contain '/')
        Set pName = $ZCONVERT(pName, "I", "URL")

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        ; Distinguish "not found" from other errors: check existence first
        ; so callers can differentiate a missing webapp (normal) from a real
        ; failure (abnormal). Returning {exists: false} mirrors the pattern
        ; used by iris_doc_get metadataOnly for missing documents.
        If '##class(Security.Applications).Exists(pName) {
            Set $NAMESPACE = tOrigNS
            Set tEntry = {}
            Do tEntry.%Set("exists", 0, "boolean")
            Do tEntry.%Set("name", pName)
            Do ..RenderResponseBody($$$OK, , tEntry)
            Quit
        }

        Set tSC = ##class(Security.Applications).Get(pName, .tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tEntry = {}
        Do tEntry.%Set("exists", 1, "boolean")
        Do tEntry.%Set("name", $Get(tProps("Name")))
        Do tEntry.%Set("namespace", $Get(tProps("NameSpace")))
        Do tEntry.%Set("dispatchClass", $Get(tProps("DispatchClass")))
        Do tEntry.%Set("description", $Get(tProps("Description")))
        Do tEntry.%Set("enabled", +$Get(tProps("Enabled")), "boolean")
        Do tEntry.%Set("authEnabled", +$Get(tProps("AutheEnabled")), "number")
        Do tEntry.%Set("isNameSpaceDefault", +$Get(tProps("IsNameSpaceDefault")), "boolean")
        Do tEntry.%Set("cspZenEnabled", +$Get(tProps("CSPZENEnabled")), "boolean")
        Do tEntry.%Set("recurse", +$Get(tProps("Recurse")), "boolean")
        Do tEntry.%Set("matchRoles", $Get(tProps("MatchRoles")))
        Do tEntry.%Set("resource", $Get(tProps("Resource")))
        Do tEntry.%Set("cookiePath", $Get(tProps("CookiePath")))

        Do ..RenderResponseBody($$$OK, , tEntry)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Get a single web application by name (POST variant).
/// <p>Reads the web application name from the JSON request body to avoid
/// URL-encoding issues with forward slashes in application paths.
/// This is the preferred endpoint for <code>iris_webapp_get</code>.</p>
ClassMethod WebAppGetByPost() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read name from request body
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tName = tBody.%Get("name")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Switch to %SYS for Security operations
        Set $NAMESPACE = "%SYS"

        ; Distinguish "not found" from other errors: check existence first
        ; so callers can differentiate a missing webapp (normal) from a real
        ; failure (abnormal). Returning {exists: false} mirrors the pattern
        ; used by iris_doc_get metadataOnly for missing documents.
        If '##class(Security.Applications).Exists(tName) {
            Set $NAMESPACE = tOrigNS
            Set tEntry = {}
            Do tEntry.%Set("exists", 0, "boolean")
            Do tEntry.%Set("name", tName)
            Do ..RenderResponseBody($$$OK, , tEntry)
            Quit
        }

        Set tSC = ##class(Security.Applications).Get(tName, .tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tEntry = {}
        Do tEntry.%Set("exists", 1, "boolean")
        Do tEntry.%Set("name", $Get(tProps("Name")))
        Do tEntry.%Set("namespace", $Get(tProps("NameSpace")))
        Do tEntry.%Set("dispatchClass", $Get(tProps("DispatchClass")))
        Do tEntry.%Set("description", $Get(tProps("Description")))
        Do tEntry.%Set("enabled", +$Get(tProps("Enabled")), "boolean")
        Do tEntry.%Set("authEnabled", +$Get(tProps("AutheEnabled")), "number")
        Do tEntry.%Set("isNameSpaceDefault", +$Get(tProps("IsNameSpaceDefault")), "boolean")
        Do tEntry.%Set("cspZenEnabled", +$Get(tProps("CSPZENEnabled")), "boolean")
        Do tEntry.%Set("recurse", +$Get(tProps("Recurse")), "boolean")
        Do tEntry.%Set("matchRoles", $Get(tProps("MatchRoles")))
        Do tEntry.%Set("resource", $Get(tProps("Resource")))
        Do tEntry.%Set("cookiePath", $Get(tProps("CookiePath")))

        Do ..RenderResponseBody($$$OK, , tEntry)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Build the tProps array for web application create/modify from a JSON body.
/// <p>Reads standard web application properties from the JSON body and
/// populates the <var>pProps</var> array suitable for passing to
/// <method>Security.Applications.Create</method> or
/// <method>Security.Applications.Modify</method>.</p>
ClassMethod BuildWebAppProps(pBody As %DynamicObject, Output pProps) [ Private ]
{
    If pBody.%IsDefined("namespace") Set pProps("NameSpace") = pBody.%Get("namespace")
    If pBody.%IsDefined("dispatchClass") Set pProps("DispatchClass") = pBody.%Get("dispatchClass")
    If pBody.%IsDefined("description") Set pProps("Description") = pBody.%Get("description")
    If pBody.%IsDefined("enabled") Set pProps("Enabled") = +pBody.%Get("enabled")
    If pBody.%IsDefined("authEnabled") Set pProps("AutheEnabled") = +pBody.%Get("authEnabled")
    If pBody.%IsDefined("isNameSpaceDefault") Set pProps("IsNameSpaceDefault") = +pBody.%Get("isNameSpaceDefault")
    If pBody.%IsDefined("cspZenEnabled") Set pProps("CSPZENEnabled") = +pBody.%Get("cspZenEnabled")
    If pBody.%IsDefined("recurse") Set pProps("Recurse") = +pBody.%Get("recurse")
    If pBody.%IsDefined("matchRoles") Set pProps("MatchRoles") = pBody.%Get("matchRoles")
    If pBody.%IsDefined("resource") Set pProps("Resource") = pBody.%Get("resource")
    If pBody.%IsDefined("cookiePath") Set pProps("CookiePath") = pBody.%Get("cookiePath")
}

/// Create, modify, or delete a web application.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code> (web app path, e.g. "/api/myapp"), and optional properties.
/// Dispatches to <class>Security.Applications</class> in <code>%SYS</code>.</p>
/// <p><b>NOTE</b>: <method>Security.Applications.Create</method> does NOT notify
/// the CSP gateway. Newly created web apps require either saving through the
/// Management Portal or restarting the CSP gateway to become active.</p>
ClassMethod WebAppManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate parameters (before namespace switch)
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
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            Do ..BuildWebAppProps(tBody, .tProps)

            Set tSC = ##class(Security.Applications).Create(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {}
            Do tResult.%Set("action", "created")
            Do tResult.%Set("name", tName)
            Do tResult.%Set("caveat", "CSP gateway was NOT notified. Save through the Management Portal or restart the CSP gateway to activate this web application.")
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            Do ..BuildWebAppProps(tBody, .tProps)

            Set tSC = ##class(Security.Applications).Modify(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.Applications).Delete(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List all SSL/TLS configurations.
/// <p>Switches to <code>%SYS</code> and queries <class>Security.SSLConfigs</class>
/// via SQL. Returns a JSON array of SSL configuration objects with
/// <code>name</code>, <code>description</code>, <code>type</code>,
/// <code>enabled</code>, <code>certFile</code>, <code>keyFile</code>,
/// <code>caFile</code>, <code>protocols</code>, <code>verifyPeer</code>,
/// and other TLS settings.</p>
ClassMethod SSLList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"

        Set tResult = []

        ; Use SQL to enumerate all SSL/TLS configurations
        Set tStatement = ##class(%SQL.Statement).%New()
        ; Security.SSLConfigs.Protocols is Deprecated; the real TLS
        ; version fields are TLSMinVersion and TLSMaxVersion
        ; (VALUELIST: 2=SSLv3, 4=TLS1.0, 8=TLS1.1, 16=TLS1.2, 32=TLS1.3).
        ; Bug #6 — pre-release BREAKING change.
        Set tSC = tStatement.%Prepare("SELECT Name, Description, CertificateFile, PrivateKeyFile, CAFile, CAPath, CipherList, TLSMinVersion, TLSMaxVersion, VerifyPeer, VerifyDepth, Type, Enabled FROM Security.SSLConfigs")
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        Set tRS = tStatement.%Execute()

        If tRS.%SQLCODE < 0 {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "SQL error listing SSL/TLS configurations: " _ tRS.%Message)
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        While tRS.%Next() {
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.%Get("Name"))
            Do tEntry.%Set("description", tRS.%Get("Description"))
            Do tEntry.%Set("certFile", tRS.%Get("CertificateFile"))
            Do tEntry.%Set("keyFile", tRS.%Get("PrivateKeyFile"))
            Do tEntry.%Set("caFile", tRS.%Get("CAFile"))
            Do tEntry.%Set("caPath", tRS.%Get("CAPath"))
            Do tEntry.%Set("cipherList", tRS.%Get("CipherList"))
            Do tEntry.%Set("tlsMinVersion", +tRS.%Get("TLSMinVersion"), "number")
            Do tEntry.%Set("tlsMaxVersion", +tRS.%Get("TLSMaxVersion"), "number")
            Do tEntry.%Set("verifyPeer", +tRS.%Get("VerifyPeer"), "number")
            Do tEntry.%Set("verifyDepth", +tRS.%Get("VerifyDepth"), "number")
            Do tEntry.%Set("type", +tRS.%Get("Type"), "number")
            Do tEntry.%Set("enabled", +tRS.%Get("Enabled"), "boolean")
            Do tResult.%Push(tEntry)
        }

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, modify, or delete an SSL/TLS configuration.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code> (configuration name), and optional properties such as
/// <code>certFile</code>, <code>keyFile</code>, <code>caFile</code>,
/// <code>protocols</code>, <code>verifyPeer</code>, etc.
/// Dispatches to <class>Security.SSLConfigs</class> in <code>%SYS</code>.</p>
ClassMethod SSLManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate parameters (before namespace switch)
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
        Set $NAMESPACE = "%SYS"

        If tAction = "create" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("certFile") Set tProps("CertificateFile") = tBody.%Get("certFile")
            If tBody.%IsDefined("keyFile") Set tProps("PrivateKeyFile") = tBody.%Get("keyFile")
            If tBody.%IsDefined("caFile") Set tProps("CAFile") = tBody.%Get("caFile")
            If tBody.%IsDefined("caPath") Set tProps("CAPath") = tBody.%Get("caPath")
            If tBody.%IsDefined("cipherList") Set tProps("CipherList") = tBody.%Get("cipherList")
            ; Bug #6 (pre-release BREAKING): schema changed from the
            ; Deprecated Protocols bitmask to tlsMinVersion/tlsMaxVersion.
            ; Values are %Integer codes: 2=SSLv3, 4=TLS1.0, 8=TLS1.1,
            ; 16=TLS1.2, 32=TLS1.3 (enforced by Security.Datatype.TLSVersion).
            If tBody.%IsDefined("tlsMinVersion") Set tProps("TLSMinVersion") = +tBody.%Get("tlsMinVersion")
            If tBody.%IsDefined("tlsMaxVersion") Set tProps("TLSMaxVersion") = +tBody.%Get("tlsMaxVersion")
            If tBody.%IsDefined("verifyPeer") Set tProps("VerifyPeer") = +tBody.%Get("verifyPeer")
            If tBody.%IsDefined("verifyDepth") Set tProps("VerifyDepth") = +tBody.%Get("verifyDepth")
            If tBody.%IsDefined("type") Set tProps("Type") = +tBody.%Get("type")
            If tBody.%IsDefined("enabled") Set tProps("Enabled") = +tBody.%Get("enabled")

            Set tSC = ##class(Security.SSLConfigs).Create(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {}
            Do tResult.%Set("action", "created")
            Do tResult.%Set("name", tName)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "modify" {
            If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
            If tBody.%IsDefined("certFile") Set tProps("CertificateFile") = tBody.%Get("certFile")
            If tBody.%IsDefined("keyFile") Set tProps("PrivateKeyFile") = tBody.%Get("keyFile")
            If tBody.%IsDefined("caFile") Set tProps("CAFile") = tBody.%Get("caFile")
            If tBody.%IsDefined("caPath") Set tProps("CAPath") = tBody.%Get("caPath")
            If tBody.%IsDefined("cipherList") Set tProps("CipherList") = tBody.%Get("cipherList")
            ; Bug #6 (pre-release BREAKING): schema changed from the
            ; Deprecated Protocols bitmask to tlsMinVersion/tlsMaxVersion.
            ; Values are %Integer codes: 2=SSLv3, 4=TLS1.0, 8=TLS1.1,
            ; 16=TLS1.2, 32=TLS1.3 (enforced by Security.Datatype.TLSVersion).
            If tBody.%IsDefined("tlsMinVersion") Set tProps("TLSMinVersion") = +tBody.%Get("tlsMinVersion")
            If tBody.%IsDefined("tlsMaxVersion") Set tProps("TLSMaxVersion") = +tBody.%Get("tlsMaxVersion")
            If tBody.%IsDefined("verifyPeer") Set tProps("VerifyPeer") = +tBody.%Get("verifyPeer")
            If tBody.%IsDefined("verifyDepth") Set tProps("VerifyDepth") = +tBody.%Get("verifyDepth")
            If tBody.%IsDefined("type") Set tProps("Type") = +tBody.%Get("type")
            If tBody.%IsDefined("enabled") Set tProps("Enabled") = +tBody.%Get("enabled")

            Set tSC = ##class(Security.SSLConfigs).Modify(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "modified", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "delete" {
            Set tSC = ##class(Security.SSLConfigs).Delete(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// List all OAuth2 server definitions and their registered clients.
/// <p>Switches to <code>%SYS</code> and queries
/// <class>OAuth2.Server.Configuration</class> for server definitions,
/// then <class>OAuth2.Client</class> for registered clients.
/// Returns a JSON object with <code>servers</code> and <code>clients</code>
/// arrays.</p>
/// <p><b>CRITICAL</b>: Client secrets are NEVER included in response bodies
/// (NFR6).</p>
ClassMethod OAuthList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"

        Set tServers = []
        Set tClients = []

        ; List OAuth2 server definitions via SQL
        Set tStatement = ##class(%SQL.Statement).%New()
        Set tSC = tStatement.%Prepare("SELECT ID, IssuerEndpoint, Description, SupportedScopes, AccessTokenInterval, AuthorizationCodeInterval, RefreshTokenInterval, SigningAlgorithm FROM OAuth2.Server.Configuration")
        If $$$ISERR(tSC) {
            ; Table may not exist - return empty results
            Set $NAMESPACE = tOrigNS
            Set tResult = {}
            Do tResult.%Set("servers", [])
            Do tResult.%Set("clients", [])
            Do tResult.%Set("serverCount", 0, "number")
            Do tResult.%Set("clientCount", 0, "number")
            Do ..RenderResponseBody($$$OK, , tResult)
            Set tSC = $$$OK
            Quit
        }
        Set tRS = tStatement.%Execute()

        If tRS.%SQLCODE '< 0 {
            While tRS.%Next() {
                Set tEntry = {}
                Do tEntry.%Set("id", tRS.%Get("ID"))
                Do tEntry.%Set("issuerEndpoint", tRS.%Get("IssuerEndpoint"))
                Do tEntry.%Set("description", tRS.%Get("Description"))
                Do tEntry.%Set("supportedScopes", tRS.%Get("SupportedScopes"))
                Do tEntry.%Set("accessTokenInterval", +tRS.%Get("AccessTokenInterval"), "number")
                Do tEntry.%Set("authorizationCodeInterval", +tRS.%Get("AuthorizationCodeInterval"), "number")
                Do tEntry.%Set("refreshTokenInterval", +tRS.%Get("RefreshTokenInterval"), "number")
                Do tEntry.%Set("signingAlgorithm", tRS.%Get("SigningAlgorithm"))
                Do tServers.%Push(tEntry)
            }
        }

        ; List OAuth2 client registrations via SQL
        Set tStatement2 = ##class(%SQL.Statement).%New()
        Set tSC2 = tStatement2.%Prepare("SELECT ApplicationName, ServerDefinition, ClientId, ClientType, RedirectURL, Description, Enabled FROM OAuth2.Client")
        If '$$$ISERR(tSC2) {
            Set tRS2 = tStatement2.%Execute()
            If tRS2.%SQLCODE '< 0 {
                While tRS2.%Next() {
                    Set tEntry = {}
                    Do tEntry.%Set("applicationName", tRS2.%Get("ApplicationName"))
                    Do tEntry.%Set("serverDefinition", tRS2.%Get("ServerDefinition"))
                    Do tEntry.%Set("clientId", tRS2.%Get("ClientId"))
                    ; CRITICAL: Never include clientSecret (NFR6)
                    Do tEntry.%Set("clientType", tRS2.%Get("ClientType"))
                    Do tEntry.%Set("redirectURL", tRS2.%Get("RedirectURL"))
                    Do tEntry.%Set("description", tRS2.%Get("Description"))
                    Do tEntry.%Set("enabled", +tRS2.%Get("Enabled"), "boolean")
                    Do tClients.%Push(tEntry)
                }
            }
        }

        Set $NAMESPACE = tOrigNS

        Set tResult = {}
        Do tResult.%Set("servers", tServers)
        Do tResult.%Set("clients", tClients)
        Do tResult.%Set("serverCount", tServers.%Size(), "number")
        Do tResult.%Set("clientCount", tClients.%Size(), "number")
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Create, delete, or discover OAuth2 server definitions and client registrations.
/// <p>Reads a JSON body with <code>action</code> (create|delete|discover),
/// <code>entity</code> (server|client for create/delete), and action-specific
/// parameters. Dispatches to the appropriate OAuth2 classes in <code>%SYS</code>.</p>
/// <p><b>CRITICAL</b>: Client secrets are NEVER included in response bodies
/// or error messages (NFR6).</p>
ClassMethod OAuthManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body (before namespace switch — Utils is in HSCUSTOM)
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Extract and validate action (before namespace switch)
        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate action value
        If (tAction '= "create") && (tAction '= "delete") && (tAction '= "discover") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: create, delete, discover")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for OAuth2 operations
        Set $NAMESPACE = "%SYS"

        If tAction = "discover" {
            ; OIDC Discovery from issuer URL
            Set tIssuerURL = tBody.%Get("issuerURL")
            If tIssuerURL = "" {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'issuerURL' is required for discover action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set tSC = ##class(%SYS.OAuth2.Registration).Discover(tIssuerURL, .tConfig)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {}
            Do tResult.%Set("action", "discovered")
            Do tResult.%Set("issuerURL", tIssuerURL)
            ; Return discovered configuration as a nested object
            Set tDiscovered = {}
            If $IsObject(tConfig) {
                If tConfig.%IsA("%DynamicObject") {
                    Set tDiscovered = tConfig
                }
                Else {
                    ; Convert discovered config properties to JSON
                    If $Property(tConfig, "IssuerEndpoint") '= "" Do tDiscovered.%Set("issuerEndpoint", $Property(tConfig, "IssuerEndpoint"))
                    If $Property(tConfig, "AuthorizationEndpoint") '= "" Do tDiscovered.%Set("authorizationEndpoint", $Property(tConfig, "AuthorizationEndpoint"))
                    If $Property(tConfig, "TokenEndpoint") '= "" Do tDiscovered.%Set("tokenEndpoint", $Property(tConfig, "TokenEndpoint"))
                    If $Property(tConfig, "UserinfoEndpoint") '= "" Do tDiscovered.%Set("userinfoEndpoint", $Property(tConfig, "UserinfoEndpoint"))
                    If $Property(tConfig, "RevocationEndpoint") '= "" Do tDiscovered.%Set("revocationEndpoint", $Property(tConfig, "RevocationEndpoint"))
                    If $Property(tConfig, "IntrospectionEndpoint") '= "" Do tDiscovered.%Set("introspectionEndpoint", $Property(tConfig, "IntrospectionEndpoint"))
                    If $Property(tConfig, "JWKSEndpoint") '= "" Do tDiscovered.%Set("jwksEndpoint", $Property(tConfig, "JWKSEndpoint"))
                }
            }
            Do tResult.%Set("configuration", tDiscovered)
            Do ..RenderResponseBody($$$OK, , tResult)
        }
        ElseIf tAction = "create" || (tAction = "delete") {
            ; Entity type required for create/delete
            Set tEntity = tBody.%Get("entity")
            If (tEntity '= "server") && (tEntity '= "client") {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'entity' must be 'server' or 'client' for " _ tAction _ " action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            If tAction = "create" {
                If tEntity = "server" {
                    ; Create OAuth2 server definition
                    Set tIssuerURL = tBody.%Get("issuerURL")
                    If tIssuerURL = "" {
                        Set $NAMESPACE = tOrigNS
                        Set tSC = $$$ERROR($$$GeneralError, "Parameter 'issuerURL' is required for server creation")
                        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                        Set tSC = $$$OK
                        Quit
                    }

                    Set tConfig = ##class(OAuth2.Server.Configuration).%New()
                    Set tConfig.IssuerEndpoint = tIssuerURL
                    If tBody.%IsDefined("description") Set tConfig.Description = tBody.%Get("description")
                    If tBody.%IsDefined("supportedScopes") Set tConfig.SupportedScopes = tBody.%Get("supportedScopes")
                    If tBody.%IsDefined("accessTokenInterval") Set tConfig.AccessTokenInterval = +tBody.%Get("accessTokenInterval")
                    If tBody.%IsDefined("authorizationCodeInterval") Set tConfig.AuthorizationCodeInterval = +tBody.%Get("authorizationCodeInterval")
                    If tBody.%IsDefined("refreshTokenInterval") Set tConfig.RefreshTokenInterval = +tBody.%Get("refreshTokenInterval")
                    If tBody.%IsDefined("signingAlgorithm") Set tConfig.SigningAlgorithm = tBody.%Get("signingAlgorithm")

                    Set tSC = tConfig.%Save()
                    Set $NAMESPACE = tOrigNS
                    If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

                    Set tResult = {}
                    Do tResult.%Set("action", "created")
                    Do tResult.%Set("entity", "server")
                    Do tResult.%Set("issuerEndpoint", tIssuerURL)
                    Do ..RenderResponseBody($$$OK, , tResult)
                }
                ElseIf tEntity = "client" {
                    ; Register OAuth2 client application
                    Set tServerName = tBody.%Get("serverName")
                    Set tClientName = tBody.%Get("clientName")
                    If tServerName = "" {
                        Set $NAMESPACE = tOrigNS
                        Set tSC = $$$ERROR($$$GeneralError, "Parameter 'serverName' is required for client registration")
                        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                        Set tSC = $$$OK
                        Quit
                    }
                    If tClientName = "" {
                        Set $NAMESPACE = tOrigNS
                        Set tSC = $$$ERROR($$$GeneralError, "Parameter 'clientName' is required for client registration")
                        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                        Set tSC = $$$OK
                        Quit
                    }

                    Set tProps("ApplicationName") = tClientName
                    Set tProps("ServerDefinition") = tServerName
                    If tBody.%IsDefined("redirectURIs") Set tProps("RedirectURL") = tBody.%Get("redirectURIs")
                    If tBody.%IsDefined("grantTypes") Set tProps("GrantTypes") = tBody.%Get("grantTypes")
                    If tBody.%IsDefined("clientType") Set tProps("ClientType") = tBody.%Get("clientType")
                    If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")

                    Set tSC = ##class(%SYS.OAuth2.Registration).RegisterClient(tServerName, .tProps)
                    Set $NAMESPACE = tOrigNS
                    If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

                    ; Return client ID but NEVER the client secret (NFR6)
                    Set tResult = {}
                    Do tResult.%Set("action", "created")
                    Do tResult.%Set("entity", "client")
                    Do tResult.%Set("clientName", tClientName)
                    Do tResult.%Set("serverName", tServerName)
                    If $Data(tProps("ClientId")) Do tResult.%Set("clientId", tProps("ClientId"))
                    ; CRITICAL: Never include clientSecret in response
                    Do ..RenderResponseBody($$$OK, , tResult)
                }
            }
            ElseIf tAction = "delete" {
                Set tName = tBody.%Get("name")
                If tName = "" {
                    Set $NAMESPACE = tOrigNS
                    Set tSC = $$$ERROR($$$GeneralError, "Parameter 'name' is required for " _ tEntity _ " deletion")
                    Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                    Set tSC = $$$OK
                    Quit
                }

                If tEntity = "server" {
                    Set tSC = ##class(OAuth2.Server.Configuration).Delete(tName)
                }
                ElseIf tEntity = "client" {
                    Set tSC = ##class(OAuth2.Client).Delete(tName)
                }
                Set $NAMESPACE = tOrigNS
                If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

                Set tResult = {}
                Do tResult.%Set("action", "deleted")
                Do tResult.%Set("entity", tEntity)
                Do tResult.%Set("name", tName)
                Do ..RenderResponseBody($$$OK, , tResult)
            }
        }
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
        ; CRITICAL: Sanitize error to avoid leaking secrets
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

}
