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
        ; SQL table is OAuth2_Server.Configuration — the package dots (OAuth2.Server)
        ; collapse to an underscore in the SQL schema name. The two-dot form
        ; "OAuth2.Server.Configuration" is invalid SQL, so %Prepare failed and the
        ; handler silently returned an empty server list (the "table may not exist"
        ; fallback below) — meaning servers were NEVER listed. (Bug fix.)
        Set tSC = tStatement.%Prepare("SELECT ID, IssuerEndpoint, Description, SupportedScopes, AccessTokenInterval, AuthorizationCodeInterval, RefreshTokenInterval, SigningAlgorithm FROM OAuth2_Server.Configuration")
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
                    ; SupportedScopes is an "array Of %String" (Required) keyed by scope
                    ; name with the scope's description as the value. It is a COLLECTION,
                    ; so it must be populated member-by-member — a scalar/array assignment
                    ; (Set tConfig.SupportedScopes = <value>) fails with <METHOD DOES NOT
                    ; EXIST>SupportedScopesSet *GetNext on the collection setter. The MCP TS
                    ; layer sends scopes as a JSON array; a direct REST caller may send a
                    ; space-/comma-separated string. Handle both.
                    Set tScopes = tBody.%Get("supportedScopes")
                    If $IsObject(tScopes) {
                        Set tScopeIter = tScopes.%GetIterator()
                        While tScopeIter.%GetNext(.tScopeKey, .tScopeVal) {
                            Set tScopeVal = $ZStrip(tScopeVal, "<>W")
                            If tScopeVal '= "" Do tConfig.SupportedScopes.SetAt(tScopeVal, tScopeVal)
                        }
                    } ElseIf tScopes '= "" {
                        Set tScopes = $Translate(tScopes, ",", " ")
                        For tScopeIdx = 1:1:$Length(tScopes, " ") {
                            Set tScope = $ZStrip($Piece(tScopes, " ", tScopeIdx), "<>W")
                            If tScope '= "" Do tConfig.SupportedScopes.SetAt(tScope, tScope)
                        }
                    }
                    ; CustomizationNamespace and CustomizationRoles are also Required by
                    ; OAuth2.Server.Configuration but were never set (so %Save always failed
                    ; even once the scopes crash was fixed). Wire them from the body.
                    ; CustomizationNamespace defaults to the request namespace when omitted;
                    ; CustomizationRoles has no safe default (it grants roles to customization
                    ; code), so an omitted/empty value surfaces the clean IRIS "required" error.
                    Set tCustNS = tBody.%Get("customizationNamespace")
                    If tCustNS = "" Set tCustNS = tOrigNS
                    Set tConfig.CustomizationNamespace = tCustNS
                    If (tBody.%Get("customizationRoles") '= "") Set tConfig.CustomizationRoles = tBody.%Get("customizationRoles")
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
                    ; OAuth2.Server.Configuration is a singleton; its Delete() takes NO
                    ; arguments. Passing tName threw <PARAMETER> (server delete was broken).
                    ; The 'name' param is accepted for API symmetry but not needed here.
                    Set tSC = ##class(OAuth2.Server.Configuration).Delete()
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

/// List IRIS services, or get a single service's properties.
/// <p>Backed by <class>Security.Services</class> in <code>%SYS</code>
/// (Story 15.1). With no <code>name</code> query parameter, returns a JSON
/// array of services from the <code>Security.Services:List</code> query
/// (ROWSPEC: Name, Enabled, Public, Description, EnabledBoolean). With a
/// <code>name</code> query parameter, calls
/// <method>Security.Services.Get</method> and returns that service's
/// properties (<code>enabled</code>, <code>description</code>,
/// <code>autheEnabled</code>, <code>clientSystems</code>). Avoids the
/// <code>Capabilities</code>/<code>AutheEnabledCapabilities</code> Internal
/// properties (Rule #4).</p>
ClassMethod ServiceList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Optional ?name= query parameter selects single-service get vs list
        Set tName = $Get(%request.Data("name", 1))

        ; Switch to %SYS for Security.Services operations
        Set $NAMESPACE = "%SYS"

        If tName '= "" {
            ; Single service get
            Kill tProps
            Set tSC = ##class(Security.Services).Get(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tEntry = {}
            ; Security.Services.Get uses pName as the lookup key and does NOT
            ; populate tProps("Name") — echo the input directly.
            Do tEntry.%Set("name", tName)
            Do tEntry.%Set("enabled", +$Get(tProps("Enabled")), "boolean")
            Do tEntry.%Set("description", $Get(tProps("Description")))
            Do tEntry.%Set("autheEnabled", +$Get(tProps("AutheEnabled")))
            Do tEntry.%Set("clientSystems", $Get(tProps("ClientSystems")))
            ; AVOID Capabilities / AutheEnabledCapabilities (Internal — Rule #4)
            Do ..RenderResponseBody($$$OK, , tEntry)
            Quit
        }

        ; List all services
        Set tResult = []
        Set tRS = ##class(%ResultSet).%New("Security.Services:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        While tRS.Next() {
            ; ROWSPEC: Name, Enabled, Public, Description, EnabledBoolean
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.Get("Name"))
            Do tEntry.%Set("enabled", +tRS.Get("EnabledBoolean"), "boolean")
            Do tEntry.%Set("public", tRS.Get("Public"))
            Do tEntry.%Set("description", tRS.Get("Description"))
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

/// Enable, disable, or update settings for an IRIS service.
/// <p>Reads a JSON body with <code>action</code>
/// (enable|disable|set) and <code>name</code> (the service, e.g.
/// <code>%Service_SQL</code>). For <code>enable</code>/<code>disable</code>,
/// sets the <code>Enabled</code> property. For <code>set</code>, applies the
/// provided <code>settings</code> fields (<code>enabled</code>,
/// <code>autheEnabled</code>, <code>description</code>,
/// <code>clientSystems</code>) via <method>Security.Services.Modify</method>.
/// Only provided fields are modified. Avoids the
/// <code>Capabilities</code>/<code>AutheEnabledCapabilities</code> Internal
/// properties (Rule #4). Errors propagate via
/// <method>SanitizeError</method> (Rule #9), preserving the real IRIS error
/// text (e.g. service-does-not-exist).</p>
ClassMethod ServiceManage() As %Status
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
        If (tAction '= "enable") && (tAction '= "disable") && (tAction '= "set") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: enable, disable, set")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Switch to %SYS for Security.Services operations
        Set $NAMESPACE = "%SYS"

        Kill tProps
        If tAction = "enable" {
            Set tProps("Enabled") = 1
        }
        ElseIf tAction = "disable" {
            Set tProps("Enabled") = 0
        }
        Else {
            ; set — apply only provided settings fields
            Set tSettings = tBody.%Get("settings")
            If $IsObject(tSettings) {
                If tSettings.%IsDefined("enabled") Set tProps("Enabled") = +tSettings.%Get("enabled")
                If tSettings.%IsDefined("autheEnabled") Set tProps("AutheEnabled") = +tSettings.%Get("autheEnabled")
                If tSettings.%IsDefined("description") Set tProps("Description") = tSettings.%Get("description")
                If tSettings.%IsDefined("clientSystems") Set tProps("ClientSystems") = tSettings.%Get("clientSystems")
            }
            ; A 'set' with no recognized settings field would issue a no-op Modify
            ; that reports success — reject it so callers are not told a
            ; do-nothing call succeeded. (Defense in depth: a direct REST caller
            ; bypasses the TypeScript-layer guard.)
            If '$Data(tProps) {
                Set $NAMESPACE = tOrigNS
                Set tSC = $$$ERROR($$$GeneralError, "The 'set' action requires at least one settings field: enabled, autheEnabled, description, or clientSystems")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
        }

        Set tSC = ##class(Security.Services).Modify(tName, .tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tResult = {}
        Do tResult.%Set("action", tAction)
        Do tResult.%Set("name", tName)
        Do tResult.%Set("success", 1, "boolean")
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

/// List LDAP configurations, get a single config, or run a config-validity test.
/// <p>Backed by <class>Security.LDAPConfigs</class> in <code>%SYS</code>
/// (Story 15.2). Routing on the GET query parameters:</p>
/// <ul>
///   <li>No <code>name</code> &rarr; list all configs from the
///       <code>Security.LDAPConfigs:List</code> query (ROWSPEC:
///       <code>Name, LDAP Enabled, Description, LDAPCACertFile</code>).</li>
///   <li><code>name</code> only &rarr; single config get via
///       <method>Security.LDAPConfigs.Get</method>, returning the config's
///       properties.</li>
///   <li><code>name</code> + <code>test=1</code> &rarr; a non-mutating
///       <b>config-validity check</b> (AC 15.2.5): the config exists, its
///       required fields (<code>LDAPBaseDN</code>,
///       <code>LDAPBaseDNForGroups</code>, <code>LDAPSearchUsername</code>) are
///       populated, and its host names are syntactically valid. IRIS exposes no
///       high-level LDAP connection-test API (only <class>%SYS.LDAP</class>
///       primitives), so this is NOT a live bind to the LDAP server.</li>
/// </ul>
/// <p><b>CRITICAL</b>: <code>LDAPSearchPassword</code> is NEVER included in any
/// response (NFR6 / Rule #9 / AC 15.2.4) — it is omitted from the property
/// mapping entirely. Avoids the <code>LDAPDomainName</code> Deprecated/Internal
/// property (Rule #4).</p>
ClassMethod LdapList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Optional ?name= selects single-config get; ?test=1 selects validity test
        Set tName = $Get(%request.Data("name", 1))
        Set tIsTest = (+$Get(%request.Data("test", 1)) = 1)

        ; Switch to %SYS for Security.LDAPConfigs operations
        Set $NAMESPACE = "%SYS"

        If tName '= "" {
            ; Single config get / validity test
            Kill tProps
            Set tSC = ##class(Security.LDAPConfigs).Get(tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            If tIsTest {
                ; Config-validity check (AC 15.2.5) — non-mutating, no live bind.
                Set tEntry = ..BuildLdapValidity(tName, .tProps)
                Do ..RenderResponseBody($$$OK, , tEntry)
                Quit
            }

            Set tEntry = ..BuildLdapEntry(tName, .tProps)
            Do ..RenderResponseBody($$$OK, , tEntry)
            Quit
        }

        ; List all LDAP configurations
        Set tResult = []
        Set tRS = ##class(%ResultSet).%New("Security.LDAPConfigs:List")
        Set tSC = tRS.Execute("*")
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        While tRS.Next() {
            ; ROWSPEC: Name, LDAP Enabled, Description, LDAPCACertFile
            ; (no password column — safe to surface directly)
            Set tEntry = {}
            Do tEntry.%Set("name", tRS.Get("Name"))
            Do tEntry.%Set("enabled", +tRS.Get("LDAP Enabled"), "boolean")
            Do tEntry.%Set("description", tRS.Get("Description"))
            Do tEntry.%Set("ldapCACertFile", tRS.Get("LDAPCACertFile"))
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

/// Build a password-redacted JSON object for a single LDAP config from a
/// <method>Security.LDAPConfigs.Get</method> properties array.
/// <p><b>CRITICAL</b>: <code>LDAPSearchPassword</code> is deliberately NOT read
/// from <var>pProps</var> — it is never surfaced (AC 15.2.4). The bind username
/// is non-secret and IS returned.</p>
ClassMethod BuildLdapEntry(pName As %String, ByRef pProps As %String) As %DynamicObject [ Internal ]
{
    Set tEntry = {}
    ; Get() uses pName as the lookup key and does NOT populate tProps("Name").
    Do tEntry.%Set("name", pName)
    Do tEntry.%Set("description", $Get(pProps("Description")))
    Do tEntry.%Set("ldapBaseDN", $Get(pProps("LDAPBaseDN")))
    Do tEntry.%Set("ldapBaseDNForGroups", $Get(pProps("LDAPBaseDNForGroups")))
    Do tEntry.%Set("ldapHostNames", $Get(pProps("LDAPHostNames")))
    Do tEntry.%Set("ldapSearchUsername", $Get(pProps("LDAPSearchUsername")))
    Do tEntry.%Set("ldapClientTimeout", +$Get(pProps("LDAPClientTimeout")))
    Do tEntry.%Set("ldapServerTimeout", +$Get(pProps("LDAPServerTimeout")))
    Do tEntry.%Set("ldapUniqueDNIdentifier", $Get(pProps("LDAPUniqueDNIdentifier")))
    Do tEntry.%Set("ldapFlags", +$Get(pProps("LDAPFlags")))
    Do tEntry.%Set("ldapCACertFile", $Get(pProps("LDAPCACertFile")))
    ; CRITICAL: NEVER include LDAPSearchPassword (AC 15.2.4 / Rule #9).
    ; AVOID LDAPDomainName (Deprecated, Internal — Rule #4).
    Quit tEntry
}

/// Build the config-validity result for the scoped-down <code>test</code>
/// action (AC 15.2.5). Non-mutating; no live LDAP bind. Checks that the config
/// exists (caller already confirmed via a successful Get), its required fields
/// are populated, and host names are syntactically present.
ClassMethod BuildLdapValidity(pName As %String, ByRef pProps As %String) As %DynamicObject [ Internal ]
{
    Set tIssues = []
    Set tBaseDN = $Get(pProps("LDAPBaseDN"))
    Set tBaseDNGroups = $Get(pProps("LDAPBaseDNForGroups"))
    Set tSearchUser = $Get(pProps("LDAPSearchUsername"))
    Set tHosts = $Get(pProps("LDAPHostNames"))

    If tBaseDN = "" Do tIssues.%Push("LDAPBaseDN is not set")
    If tBaseDNGroups = "" Do tIssues.%Push("LDAPBaseDNForGroups is not set")
    If tSearchUser = "" Do tIssues.%Push("LDAPSearchUsername is not set")
    ; Host names: required to reach the server. Each space-separated token may
    ; carry an optional :port suffix; the port (if present) must be numeric.
    If tHosts = "" {
        Do tIssues.%Push("LDAPHostNames is not set")
    } Else {
        For tI = 1:1:$Length(tHosts, " ") {
            Set tHost = $Piece(tHosts, " ", tI)
            If tHost = "" Continue
            If tHost [ ":" {
                Set tPort = $Piece(tHost, ":", 2)
                If (tPort = "") || ('(tPort ? 1.N)) {
                    Do tIssues.%Push("Host '"_tHost_"' has an invalid port")
                }
            }
        }
    }

    Set tValid = (tIssues.%Size() = 0)
    Set tEntry = {}
    Do tEntry.%Set("action", "test")
    Do tEntry.%Set("name", pName)
    Do tEntry.%Set("valid", tValid, "boolean")
    Do tEntry.%Set("checkType", "config-validity")
    Do tEntry.%Set("note", "IRIS exposes no high-level LDAP connection-test API; this is a non-mutating config-validity check, not a live bind.")
    Do tEntry.%Set("issues", tIssues)
    Quit tEntry
}

/// Create, modify, or delete an LDAP configuration.
/// <p>Reads a JSON body with <code>action</code> (create|modify|delete),
/// <code>name</code> (the LDAP config name), and an optional
/// <code>settings</code> object (config fields for create/modify). Dispatches
/// to <class>Security.LDAPConfigs</class> in <code>%SYS</code> via
/// <method>Create</method>/<method>Modify</method>/<method>Delete</method>
/// (each takes a <code>Properties</code> array, except <code>Delete</code>
/// which takes the name).</p>
/// <p><b>CRITICAL</b>: <code>LDAPSearchPassword</code> is accepted in the
/// settings body but NEVER echoed in responses or error messages (AC 15.2.4 /
/// Rule #9). Errors propagate via <method>SanitizeError</method>, preserving the
/// real IRIS error text (e.g. config-does-not-exist).</p>
ClassMethod LdapManage() As %Status
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

        ; Switch to %SYS for Security.LDAPConfigs operations
        Set $NAMESPACE = "%SYS"

        If tAction = "delete" {
            Set tSC = ##class(Security.LDAPConfigs).Delete(tName)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "name": (tName)}
            Do ..RenderResponseBody($$$OK, , tResult)
            Quit
        }

        ; create / modify — build the Properties array from settings fields.
        ; Only provided fields are set; others retain server-side defaults
        ; (create) or existing values (modify).
        Kill tProps
        Set tSettings = tBody.%Get("settings")
        If $IsObject(tSettings) {
            If tSettings.%IsDefined("description") Set tProps("Description") = tSettings.%Get("description")
            If tSettings.%IsDefined("ldapBaseDN") Set tProps("LDAPBaseDN") = tSettings.%Get("ldapBaseDN")
            If tSettings.%IsDefined("ldapBaseDNForGroups") Set tProps("LDAPBaseDNForGroups") = tSettings.%Get("ldapBaseDNForGroups")
            If tSettings.%IsDefined("ldapHostNames") Set tProps("LDAPHostNames") = tSettings.%Get("ldapHostNames")
            If tSettings.%IsDefined("ldapSearchUsername") Set tProps("LDAPSearchUsername") = tSettings.%Get("ldapSearchUsername")
            ; Password is write-only: accepted, applied, never echoed back.
            If tSettings.%IsDefined("ldapSearchPassword") Set tProps("LDAPSearchPassword") = tSettings.%Get("ldapSearchPassword")
            If tSettings.%IsDefined("ldapClientTimeout") Set tProps("LDAPClientTimeout") = +tSettings.%Get("ldapClientTimeout")
            If tSettings.%IsDefined("ldapServerTimeout") Set tProps("LDAPServerTimeout") = +tSettings.%Get("ldapServerTimeout")
            If tSettings.%IsDefined("ldapUniqueDNIdentifier") Set tProps("LDAPUniqueDNIdentifier") = tSettings.%Get("ldapUniqueDNIdentifier")
            If tSettings.%IsDefined("ldapFlags") Set tProps("LDAPFlags") = +tSettings.%Get("ldapFlags")
            If tSettings.%IsDefined("ldapCACertFile") Set tProps("LDAPCACertFile") = tSettings.%Get("ldapCACertFile")
        }

        ; A create/modify with no recognized settings field would be a no-op —
        ; reject so callers are not told a do-nothing call succeeded. (Defense in
        ; depth: a direct REST caller bypasses the TypeScript-layer guard.)
        If '$Data(tProps) {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "The '"_tAction_"' action requires at least one settings field")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        If tAction = "create" {
            Set tSC = ##class(Security.LDAPConfigs).Create(tName, .tProps)
            Set tVerb = "created"
        }
        Else {
            Set tSC = ##class(Security.LDAPConfigs).Modify(tName, .tProps)
            Set tVerb = "modified"
        }
        Set $NAMESPACE = tOrigNS
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; CRITICAL: Never include the search password in the response.
        Set tResult = {}
        Do tResult.%Set("action", tVerb)
        Do tResult.%Set("name", tName)
        Do tResult.%Set("success", 1, "boolean")
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

/// List X.509 certificate credentials, or get one credential's public metadata.
/// <p>Backed by <class>%SYS.X509Credentials</class> in <code>%SYS</code>
/// (Story 15.3). With no <code>alias</code> query parameter, returns a JSON
/// array of credentials (alias + <code>hasPrivateKey</code> + safe public
/// certificate fields). With an <code>alias</code> query parameter, returns
/// that one credential's public metadata.</p>
/// <p><b>SECURITY-CRITICAL (AC 15.3.3)</b>: private-key material is NEVER
/// returned. This handler reads ONLY the safe public properties off the opened
/// object (<code>SubjectDN</code>, <code>IssuerDN</code>,
/// <code>SerialNumber</code>, <code>Thumbprint</code>,
/// <code>SubjectKeyIdentifier</code>, <code>ValidityNotBefore/After</code>) plus
/// the <code>HasPrivateKey</code> presence boolean. It deliberately does NOT
/// call <method>%SYS.X509Credentials.GetProperties</method>, which populates the
/// secret <code>PrivateKey</code> / <code>PrivateKeyPassword</code> entries.</p>
ClassMethod X509List() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Optional ?alias= selects single-credential get
        Set tAlias = $Get(%request.Data("alias", 1))

        ; Switch to %SYS for %SYS.X509Credentials operations
        Set $NAMESPACE = "%SYS"

        If tAlias '= "" {
            ; Single credential get — open and read only safe public fields.
            ; NOTE: %SYS.X509Credentials.Exists returns a truthy %Status (NOT 0)
            ; when the caller lacks %Admin_Secure:USE, and leaves tCred unset. So
            ; do NOT trust the boolean return alone — require BOTH a loaded object
            ; AND an OK status before reading. Otherwise a permission failure would
            ; be misread as "exists" and crash on the unset OREF.
            Set tExists = ##class(%SYS.X509Credentials).Exists(tAlias, .tCred, .tStatus)
            If ('tExists) || $$$ISERR($Get(tStatus, $$$OK)) || '$IsObject($Get(tCred)) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError($Get(tStatus, $$$ERROR($$$GeneralError, "X.509 credential '"_tAlias_"' does not exist"))))
                Set tSC = $$$OK
                Quit
            }
            Set tEntry = ..BuildX509Entry(tCred)
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody($$$OK, , tEntry)
            Quit
        }

        ; List all credentials. Use the ListDetails query for alias +
        ; HasPrivateKey, then open each to read the safe public cert metadata.
        Set tResult = []
        Set tRS = ##class(%ResultSet).%New("%SYS.X509Credentials:ListDetails")
        Set tSC = tRS.Execute()
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        While tRS.Next() {
            ; ListDetails ROWSPEC: Alias, OwnerList, PeerNames, HasPrivateKey, CAFile
            Set tRowAlias = tRS.Get("Alias")
            Set tCred = ##class(%SYS.X509Credentials).%OpenId(tRowAlias)
            If $IsObject(tCred) {
                Set tEntry = ..BuildX509Entry(tCred)
            } Else {
                ; Fall back to the query row's safe fields if open fails.
                Set tEntry = {}
                Do tEntry.%Set("alias", tRowAlias)
                Do tEntry.%Set("hasPrivateKey", +tRS.Get("HasPrivateKey"), "boolean")
            }
            Do tResult.%Push(tEntry)
        }
        Do tRS.Close()

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        ; Close the result set if an exception fired mid-iteration (the success
        ; path closes it; the catch must too, or the cursor leaks per error).
        If $IsObject($Get(tRS)) { Do tRS.Close() }
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Build a private-key-free JSON metadata object for one opened
/// <class>%SYS.X509Credentials</class> object.
/// <p><b>SECURITY-CRITICAL (AC 15.3.3)</b>: reads ONLY safe public properties.
/// It NEVER reads <code>PrivateKey</code>, <code>PrivateKeyPassword</code>,
/// <code>PrivateKeyExport</code>, or <code>PrivateKeyPasswordExport</code> —
/// only the <code>HasPrivateKey</code> presence boolean is surfaced. Binary
/// fields (Thumbprint, SubjectKeyIdentifier) are hex-encoded for safe JSON
/// transport.</p>
ClassMethod BuildX509Entry(pCred As %SYS.X509Credentials) As %DynamicObject [ Internal ]
{
    Set tEntry = {}
    Do tEntry.%Set("alias", pCred.Alias)
    Do tEntry.%Set("hasPrivateKey", +pCred.HasPrivateKey, "boolean")
    Do tEntry.%Set("subjectDN", pCred.SubjectDN)
    Do tEntry.%Set("issuerDN", pCred.IssuerDN)
    Do tEntry.%Set("serialNumber", pCred.SerialNumber)
    ; Binary fields → hex strings (BinaryToHexString is a class method on
    ; %SYS.X509Credentials). Guard empties so we emit "" rather than throwing.
    If pCred.Thumbprint '= "" {
        Do tEntry.%Set("thumbprint", ##class(%SYS.X509Credentials).BinaryToHexString(pCred.Thumbprint))
    } Else {
        Do tEntry.%Set("thumbprint", "")
    }
    If pCred.SubjectKeyIdentifier '= "" {
        Do tEntry.%Set("subjectKeyIdentifier", ##class(%SYS.X509Credentials).BinaryToHexString(pCred.SubjectKeyIdentifier))
    } Else {
        Do tEntry.%Set("subjectKeyIdentifier", "")
    }
    Do tEntry.%Set("notBefore", pCred.ValidityNotBefore)
    Do tEntry.%Set("notAfter", pCred.ValidityNotAfter)
    Do tEntry.%Set("peerNames", pCred.PeerNames)
    Do tEntry.%Set("caFile", pCred.CAFile)
    ; CRITICAL: NEVER read PrivateKey / PrivateKeyPassword / *Export props.
    Quit tEntry
}

/// Import (create) or delete an X.509 certificate credential.
/// <p>Reads a JSON body with <code>action</code> (import|delete) and
/// <code>alias</code> (the unique credential key).</p>
/// <ul>
///   <li><b>import</b>: requires a base64-encoded <code>certificate</code>
///       (DER bytes, or a PEM certificate body). The native file-based
///       <method>%SYS.X509Credentials.Import</method> reads a server-side XML
///       export file (not agent-friendly), so a single credential is created via
///       object-create + <method>Save</method> — base64-decode the certificate
///       into the <code>Certificate</code> property (whose setter auto-derives
///       Thumbprint/Subject/Issuer/Serial/SubjectKeyIdentifier), then save. An
///       OPTIONAL base64 <code>privateKey</code> (+ optional
///       <code>privateKeyPassword</code>) may be supplied write-only.</li>
///   <li><b>delete</b>: removes the credential via
///       <method>%SYS.X509Credentials.Delete</method>.</li>
/// </ul>
/// <p><b>SECURITY-CRITICAL (AC 15.3.3 / AC 15.3.7)</b>: a supplied private key /
/// password is accepted IN only — it is NEVER echoed in the response. Errors
/// propagate via <method>SanitizeError</method> (Rule #9), preserving the real
/// IRIS error text without leaking any key/password material.</p>
ClassMethod X509Manage() As %Status
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
        Set tAlias = tBody.%Get("alias")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAlias, "alias")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        ; Validate action value
        If (tAction '= "import") && (tAction '= "delete") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: import, delete")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; For import, the certificate is required — validate before switching NS.
        If tAction = "import" {
            Set tCertB64 = tBody.%Get("certificate")
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tCertB64, "certificate")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        }

        ; Switch to %SYS for %SYS.X509Credentials operations
        Set $NAMESPACE = "%SYS"

        If tAction = "delete" {
            Set tSC = ##class(%SYS.X509Credentials).Delete(tAlias)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

            Set tResult = {"action": "deleted", "alias": (tAlias)}
            Do ..RenderResponseBody($$$OK, , tResult)
            Quit
        }

        ; import — construct a credential from the base64 certificate + Save.
        ; Alias is the IdKey, so a %New()+Save() targeting an existing alias would
        ; SILENTLY OVERWRITE the existing credential (including its stored private
        ; key) with a success response. Guard against that data-loss: reject an
        ; import onto an alias that already exists, so create-vs-overwrite is
        ; explicit. (Exists also surfaces a permission failure cleanly here.)
        If ##class(%SYS.X509Credentials).Exists(tAlias) {
            Set $NAMESPACE = tOrigNS
            Set tSC = $$$ERROR($$$GeneralError, "X.509 credential '"_tAlias_"' already exists; delete it first to replace it")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        ; The Certificate setter auto-derives Thumbprint/Subject/Issuer/Serial/
        ; SubjectKeyIdentifier. A supplied private key/password is set write-only.
        Set tCred = ##class(%SYS.X509Credentials).%New()
        Set tCred.Alias = tAlias
        ; Accept either raw base64 of DER bytes, or a PEM body — Base64Decode of
        ; the supplied string yields the binary certificate either way (the PEM
        ; armor lines, if present, must be stripped by the caller).
        Set tCred.Certificate = $System.Encryption.Base64Decode(tCertB64)
        Set tPrivKeyB64 = tBody.%Get("privateKey")
        If tPrivKeyB64 '= "" {
            ; PrivateKey is PEM-encoded text; decode the base64 wrapper to it.
            Set tCred.PrivateKey = $System.Encryption.Base64Decode(tPrivKeyB64)
            Set tPwd = tBody.%Get("privateKeyPassword")
            If tPwd '= "" Set tCred.PrivateKeyPassword = tPwd
        }
        Set tSC = tCred.Save()
        Set $NAMESPACE = tOrigNS
        If $$$ISERR(tSC) {
            ; SanitizeError preserves the %Status text. The status text here is
            ; about the certificate/alias, never the private key value (Rule #9).
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; CRITICAL: the response echoes ONLY the alias — never the private key.
        Set tResult = {}
        Do tResult.%Set("action", "imported")
        Do tResult.%Set("alias", tAlias)
        Do tResult.%Set("success", 1, "boolean")
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

/// Audit status (GET) and audit-log view (GET) for <code>iris_audit_manage</code>.
/// <p>Story 15.4. Backed by <class>Security.System</class> /
/// <class>Security.Events</class> (audit configuration) and <class>%SYS.Audit</class>
/// (the audit log), all in <code>%SYS</code>. Routing on the
/// <code>?action=</code> query parameter:</p>
/// <ul>
///   <li>No <code>action</code> (or <code>action=status</code>) &rarr; instance
///       auditing on/off (<method>Security.System.Get</method> &rarr;
///       <code>AuditEnabled</code>) plus a per-event summary from the public
///       <code>Security.Events:List</code> query (ROWSPEC
///       <code>Source,Type,Name,Description,Enabled,Total,Written,Lost</code>).</li>
///   <li><code>action=view</code> &rarr; recent audit-log records via the public
///       <code>%SYS.Audit:List</code> query with optional filters
///       (<code>begin</code>, <code>end</code>, <code>user</code>,
///       <code>event</code>, <code>source</code>, <code>type</code>) and a
///       <code>maxRows</code> cap (default 100, max 1000). This is the same
///       audit-log read offered by the read-only <code>iris_audit_events</code>
///       tool, with richer filters.</li>
/// </ul>
ClassMethod AuditStatus() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tAction = $Get(%request.Data("action", 1), "status")

        If tAction = "view" {
            ; -- audit-log view (filtered) --
            Set tBegin = $Get(%request.Data("begin", 1))
            Set tEnd = $Get(%request.Data("end", 1))
            Set tUser = $Get(%request.Data("user", 1), "*")
            Set tEvent = $Get(%request.Data("event", 1), "*")
            Set tSource = $Get(%request.Data("source", 1), "*")
            Set tType = $Get(%request.Data("type", 1), "*")
            Set tMaxRows = +$Get(%request.Data("maxRows", 1), 100)
            If tMaxRows < 1 Set tMaxRows = 100
            If tMaxRows > 1000 Set tMaxRows = 1000
            If tUser = "" Set tUser = "*"
            If tEvent = "" Set tEvent = "*"
            If tSource = "" Set tSource = "*"
            If tType = "" Set tType = "*"

            Set $NAMESPACE = "%SYS"
            Set tResult = {}
            Set tEvents = []
            Set tRS = ##class(%ResultSet).%New("%SYS.Audit:List")
            If $IsObject(tRS) {
                ; List Execute params: BeginDateTime, EndDateTime, EventSources,
                ; EventTypes, Events, Usernames
                Set tSC2 = tRS.Execute(tBegin, tEnd, tSource, tType, tEvent, tUser)
                If $$$ISOK(tSC2) {
                    Set tRowCount = 0
                    While tRS.Next() && (tRowCount < tMaxRows) {
                        Set tEvt = {}
                        Do tEvt.%Set("timestamp", tRS.Get("TimeStamp"))
                        Do tEvt.%Set("username", tRS.Get("Username"))
                        Do tEvt.%Set("eventSource", tRS.Get("EventSource"))
                        Do tEvt.%Set("eventType", tRS.Get("EventType"))
                        Do tEvt.%Set("event", tRS.Get("Event"))
                        Do tEvt.%Set("description", tRS.Get("Description"))
                        Do tEvt.%Set("clientIPAddress", tRS.Get("ClientIPAddress"))
                        Do tEvt.%Set("namespace", tRS.Get("Namespace"))
                        Do tEvents.%Push(tEvt)
                        Set tRowCount = tRowCount + 1
                    }
                }
                Do tRS.Close()
            }
            Do tResult.%Set("events", tEvents)
            Do tResult.%Set("count", tEvents.%Size(), "number")
            Do tResult.%Set("maxRows", tMaxRows, "number")
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody($$$OK, , tResult)
            Quit
        }

        ; -- status: instance auditing on/off + per-event summary --
        Set $NAMESPACE = "%SYS"
        Set tResult = {}

        Kill tSysProps
        Set tSC2 = ##class(Security.System).Get($$$SystemSecurityName, .tSysProps)
        If $$$ISERR(tSC2) {
            Set $NAMESPACE = tOrigNS
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC2))
            Set tSC = $$$OK
            Quit
        }
        ; AuditEnabled is a BooleanYN ("Yes"/"No" display, 1/0 logical) — coerce.
        Set tEnabledRaw = $Get(tSysProps("AuditEnabled"))
        Set tAuditOn = ((tEnabledRaw = 1) || (tEnabledRaw = "Yes") || (tEnabledRaw = "Y"))
        Do tResult.%Set("auditEnabled", +tAuditOn, "boolean")

        ; Per-event summary via the public Security.Events:List query.
        Set tEventsArr = []
        Set tRS = ##class(%ResultSet).%New("Security.Events:List")
        If $IsObject(tRS) {
            Set tSC2 = tRS.Execute("*", "*", "*")
            If $$$ISOK(tSC2) {
                While tRS.Next() {
                    Set tEvt = {}
                    Do tEvt.%Set("source", tRS.Get("Source"))
                    Do tEvt.%Set("type", tRS.Get("Type"))
                    Do tEvt.%Set("name", tRS.Get("Name"))
                    Do tEvt.%Set("description", tRS.Get("Description"))
                    Do tEvt.%Set("enabled", tRS.Get("Enabled"))
                    Do tEvt.%Set("total", +tRS.Get("Total"), "number")
                    Do tEvt.%Set("written", +tRS.Get("Written"), "number")
                    Do tEvt.%Set("lost", +tRS.Get("Lost"), "number")
                    Do tEventsArr.%Push(tEvt)
                }
            }
            Do tRS.Close()
        }
        Do tResult.%Set("events", tEventsArr)
        Do tResult.%Set("eventCount", tEventsArr.%Size(), "number")

        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        If $IsObject($Get(tRS)) { Do tRS.Close() }
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
        Set tSC = $$$OK
    }
    Quit $$$OK
}

/// Mutating audit actions (POST) for <code>iris_audit_manage</code>: enable,
/// disable, configureEvent, purge, export.
/// <p>Story 15.4. Reads a JSON body with <code>action</code> and per-action
/// parameters. Each mutating action is opt-in under tool governance.</p>
/// <ul>
///   <li><b>enable</b>/<b>disable</b>: turn instance auditing on/off via
///       <method>Security.System.Modify</method> setting
///       <code>AuditEnabled</code>.</li>
///   <li><b>configureEvent</b>: enable/disable one audit event via
///       <method>Security.Events.Modify</method> (requires
///       <code>source</code>, <code>type</code>, <code>name</code>,
///       <code>enabled</code>).</li>
///   <li><b>purge</b>: delete a BOUNDED range of audit-log records via
///       <method>%SYS.Audit.Delete</method>. DESTRUCTIVE — requires
///       <code>confirm=true</code> AND at least one bound
///       (<code>begin</code>/<code>end</code>/<code>user</code>/<code>event</code>/<code>source</code>/<code>type</code>);
///       returns the count deleted. Never an unbounded wipe.</li>
///   <li><b>export</b>: write matching audit-log records to a server-side file
///       via <method>%SYS.Audit.Export</method>. The caller supplies a bare
///       <code>fileName</code> (no path separators / <code>..</code>); the file
///       is written into a fixed audit-export directory under the manager
///       directory. Returns the resolved location + count.</li>
/// </ul>
ClassMethod AuditManage() As %Status
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

        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "enable") && (tAction '= "disable") && (tAction '= "configureEvent") && (tAction '= "purge") && (tAction '= "export") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: enable, disable, configureEvent, purge, export")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; ── enable / disable instance auditing ─────────────────────
        If (tAction = "enable") || (tAction = "disable") {
            Set $NAMESPACE = "%SYS"
            Kill tProps
            Set tProps("AuditEnabled") = $Case(tAction, "enable": 1, : 0)
            Set tSC = ##class(Security.System).Modify($$$SystemSecurityName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tResult = {}
            Do tResult.%Set("action", tAction)
            Do tResult.%Set("auditEnabled", $Case(tAction, "enable": 1, : 0), "boolean")
            Do tResult.%Set("success", 1, "boolean")
            Do ..RenderResponseBody($$$OK, , tResult)
            Quit
        }

        ; ── configureEvent ─────────────────────────────────────────
        If tAction = "configureEvent" {
            Set tSource = tBody.%Get("source")
            Set tType = tBody.%Get("type")
            Set tName = tBody.%Get("name")
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tSource, "source")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tType, "type")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tName, "name")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            If 'tBody.%IsDefined("enabled") {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'enabled' is required for configureEvent")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tEnabled = +tBody.%Get("enabled")

            Set $NAMESPACE = "%SYS"
            Kill tProps
            Set tProps("Enabled") = tEnabled
            Set tSC = ##class(Security.Events).Modify(tSource, tType, tName, .tProps)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tResult = {}
            Do tResult.%Set("action", "configureEvent")
            Do tResult.%Set("source", tSource)
            Do tResult.%Set("type", tType)
            Do tResult.%Set("name", tName)
            Do tResult.%Set("enabled", tEnabled, "boolean")
            Do tResult.%Set("success", 1, "boolean")
            Do ..RenderResponseBody($$$OK, , tResult)
            Quit
        }

        ; ── purge (DESTRUCTIVE, bounded) ───────────────────────────
        If tAction = "purge" {
            ; Confirmation gate (defense in depth — a direct REST caller bypasses
            ; the TypeScript-layer guard).
            If '(tBody.%IsDefined("confirm") && (+tBody.%Get("confirm") = 1)) {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'confirm' must be true to purge audit-log records")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tBegin = tBody.%Get("begin")
            Set tEnd = tBody.%Get("end")
            Set tUser = tBody.%Get("user")
            Set tEvent = tBody.%Get("event")
            Set tSource = tBody.%Get("source")
            Set tType = tBody.%Get("type")
            ; Bounded scope: at least one MEANINGFUL filter, or refuse (no silent
            ; full wipe). A "*" value is the match-all wildcard, NOT a bound — it
            ; must not satisfy the gate, otherwise {confirm:true, source:"*"} (or
            ; any wildcard-only scope) would delete the entire audit log. Empty
            ; begin/end are unbounded on that axis; any non-empty begin/end is a
            ; real (date) bound.
            Set tHasBound = 0
            If (tBegin '= "") Set tHasBound = 1
            If (tEnd '= "") Set tHasBound = 1
            If (tUser '= "") && (tUser '= "*") Set tHasBound = 1
            If (tEvent '= "") && (tEvent '= "*") Set tHasBound = 1
            If (tSource '= "") && (tSource '= "*") Set tHasBound = 1
            If (tType '= "") && (tType '= "*") Set tHasBound = 1
            If 'tHasBound {
                Set tSC = $$$ERROR($$$GeneralError, "Purge requires a bounded scope: supply at least one of begin, end, or a non-wildcard user, event, source, or type")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            ; Map empties to the wildcard the API expects.
            If tUser = "" Set tUser = "*"
            If tEvent = "" Set tEvent = "*"
            If tSource = "" Set tSource = "*"
            If tType = "" Set tType = "*"

            Set $NAMESPACE = "%SYS"
            Set tNumDeleted = 0
            ; Delete(.NumDeleted, Begin, End, EventSources, EventTypes, Events, Usernames, SystemIDs)
            Set tSC = ##class(%SYS.Audit).Delete(.tNumDeleted, tBegin, tEnd, tSource, tType, tEvent, tUser)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tResult = {}
            Do tResult.%Set("action", "purge")
            Do tResult.%Set("deleted", +tNumDeleted, "number")
            Do tResult.%Set("success", 1, "boolean")
            Do ..RenderResponseBody($$$OK, , tResult)
            Quit
        }

        ; ── export (server-side file, path-controlled) ─────────────
        If tAction = "export" {
            Set tFileName = tBody.%Get("fileName")
            Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tFileName, "fileName")
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            ; Path control: the caller supplies a BARE name — reject any path
            ; separator or parent-dir traversal so the write stays inside the
            ; fixed audit-export directory (no arbitrary path from caller input).
            If (tFileName [ "/") || (tFileName [ "\") || (tFileName [ "..") || (tFileName [ ":") {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'fileName' must be a bare file name with no path separators or '..' traversal")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set tBegin = tBody.%Get("begin")
            Set tEnd = tBody.%Get("end")
            Set tUser = tBody.%Get("user")
            Set tEvent = tBody.%Get("event")
            Set tSource = tBody.%Get("source")
            Set tType = tBody.%Get("type")
            If tUser = "" Set tUser = "*"
            If tEvent = "" Set tEvent = "*"
            If tSource = "" Set tSource = "*"
            If tType = "" Set tType = "*"

            ; Build the controlled output path under the manager directory.
            Set tDir = ##class(%File).NormalizeDirectory($System.Util.ManagerDirectory() _ "auditexport")
            Do ##class(%File).CreateDirectoryChain(tDir)
            Set tFullPath = ##class(%File).NormalizeFilename(tFileName, tDir)
            ; Containment re-check (defense in depth): do not trust the character
            ; blacklist alone — confirm the resolved path still lives inside tDir.
            If $Extract(tFullPath, 1, $Length(tDir)) '= tDir {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'fileName' resolved outside the audit-export directory")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }

            Set $NAMESPACE = "%SYS"
            Set tNumExported = 0
            ; Export(FileName, .NumExported, Flags, Begin, End, EventSources, EventTypes, Events, Usernames)
            Set tSC = ##class(%SYS.Audit).Export(tFullPath, .tNumExported, 0, tBegin, tEnd, tSource, tType, tEvent, tUser)
            Set $NAMESPACE = tOrigNS
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
            Set tResult = {}
            Do tResult.%Set("action", "export")
            Do tResult.%Set("location", tFullPath)
            Do tResult.%Set("exported", +tNumExported, "number")
            Do tResult.%Set("success", 1, "boolean")
            Do ..RenderResponseBody($$$OK, , tResult)
            Quit
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

/// Grant or revoke SQL object privileges (schema / table / column level).
/// <p>Reads a JSON body with <code>action</code> (grant|revoke),
/// <code>target</code> (a schema, <code>schema.table</code>, or
/// <code>schema.table(col1,col2)</code>), <code>privilege</code> (one or more
/// of SELECT,INSERT,UPDATE,DELETE,REFERENCES — comma-delimited or "*"),
/// <code>grantee</code> (a SQL user or role, comma-delimited list allowed),
/// and an optional <code>namespace</code> (defaults to the request namespace —
/// SQL privileges are namespace-scoped, NOT %SYS-scoped).</p>
/// <p>Backed by <method>%SQL.Manager.API.SaveObjPriv</method> — the same API
/// the System Management Portal SchemaPriv/ColumnPriv dialogs use. A
/// <code>target</code> of <code>schema.table(cols)</code> maps to a
/// column-level grant by passing the column list as the
/// <code>fields</code> argument; <code>schema.table</code> is a whole-table
/// grant; a bare <code>schema</code> is a schema-level grant (type 5).</p>
/// <p>This is ADDITIVE to the existing resource tool — the
/// <method>ResourceManage</method>/<method>ResourceList</method> handlers are
/// unchanged. Privileges are SQL object permissions, distinct from IRIS
/// security resources.</p>
ClassMethod SqlPrivilegeManage() As %Status
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

        ; Extract and validate parameters
        Set tAction = tBody.%Get("action")
        Set tTarget = tBody.%Get("target")
        Set tPrivilege = tBody.%Get("privilege")
        Set tGrantee = tBody.%Get("grantee")
        Set tReqNS = tBody.%Get("namespace")

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tTarget, "target")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tPrivilege, "privilege")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tGrantee, "grantee")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If (tAction '= "grant") && (tAction '= "revoke") {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'action' must be one of: grant, revoke")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        ; Parse target into objectType + object name + optional column list.
        ;  - "schema"                  -> type 5 (schema)
        ;  - "schema.table"            -> type 1 (table)
        ;  - "schema.table(c1,c2)"     -> type 1 + column fields
        Set tColumns = ""
        Set tObjName = tTarget
        Set tParen = $Find(tTarget, "(")
        If tParen > 0 {
            Set tObjName = $Extract(tTarget, 1, tParen - 2)
            Set tColPart = $Extract(tTarget, tParen, *)
            ; Strip trailing ")"
            If $Extract(tColPart, *) = ")" Set tColPart = $Extract(tColPart, 1, *-1)
            Set tColumns = tColPart
        }
        Set tObjName = $ZStrip(tObjName, "<>W")
        If tObjName = "" {
            Set tSC = $$$ERROR($$$GeneralError, "Parameter 'target' is missing an object name")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        ; A column list is only valid for a table/view target (must contain a ".").
        If (tColumns '= "") && (tObjName '[ ".") {
            Set tSC = $$$ERROR($$$GeneralError, "Column-level privileges require a 'schema.table(columns)' target")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }
        ; Type: schema (no ".") -> 5, else table -> 1.
        Set tType = $Select(tObjName [ ".": 1, 1: 5)

        ; Map privilege keywords to %SQL.Manager.API action letters.
        ; "*" means all actions.
        Set tActs = ""
        If tPrivilege = "*" {
            Set tActs = "*"
        }
        Else {
            For tI = 1:1:$Length(tPrivilege, ",") {
                Set tP = $ZConvert($ZStrip($Piece(tPrivilege, ",", tI), "<>W"), "U")
                If tP = "" Continue
                Set tLetter = $Case(tP, "SELECT":"s", "INSERT":"i", "UPDATE":"u", "DELETE":"d", "REFERENCES":"r", "ALTER":"a", :"")
                If tLetter = "" {
                    Set tSC = $$$ERROR($$$GeneralError, "Invalid privilege '"_tP_"' — expected one or more of SELECT, INSERT, UPDATE, DELETE, REFERENCES (or *)")
                    Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                    ; Leave tSC as the error so the guard below exits the method
                    ; (single response only — do NOT reset to $$$OK here, or a
                    ; valid privilege preceding the invalid one would fall through
                    ; to SaveObjPriv + a second render).
                    Quit
                }
                Set tActs(tLetter) = ""
            }
            If $$$ISERR(tSC) {
                Set tSC = $$$OK
                Quit
            }
            Set tLetter = ""
            For  Set tLetter = $Order(tActs(tLetter)) Quit:tLetter=""  Set tActs = tActs_tLetter
            If tActs = "" {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'privilege' did not resolve to any action")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
        }

        ; Build column fields $LIST (empty for whole-object).
        Set tFields = ""
        If tColumns '= "" {
            Set tFields = ""
            For tI = 1:1:$Length(tColumns, ",") {
                Set tCol = $ZStrip($Piece(tColumns, ",", tI), "<>W")
                If tCol '= "" Set tFields = tFields_$ListBuild(tCol)
            }
        }

        ; SQL privileges are namespace-scoped. Switch to the requested namespace
        ; (default = the request namespace).
        If tReqNS '= "" {
            If '##class(%SYS.Namespace).Exists(tReqNS) {
                Set tSC = $$$ERROR($$$GeneralError, "Namespace '"_tReqNS_"' does not exist")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set $NAMESPACE = tReqNS
        }

        Set tRevoke = $Case(tAction, "grant":0, :1)
        Set SQLCODE = 0
        Set tErrMsg = ""
        ; SaveObjPriv handles only ONE action letter at a time when "*" is not
        ; used; loop the resolved letters. With "*" pass it through directly.
        If tActs = "*" {
            Do ##class(%SQL.Manager.API).SaveObjPriv("*", tType, tObjName, tGrantee, 0, tRevoke, .SQLCODE, .tErrMsg, $Username, .tFields)
        }
        Else {
            For tI = 1:1:$Length(tActs) {
                Set tOneAct = $Extract(tActs, tI)
                Set SQLCODE = 0, tErrMsg = ""
                Do ##class(%SQL.Manager.API).SaveObjPriv(tOneAct, tType, tObjName, tGrantee, 0, tRevoke, .SQLCODE, .tErrMsg, $Username, .tFields)
                If SQLCODE < 0 Quit
            }
        }
        Set $NAMESPACE = tOrigNS

        If SQLCODE < 0 {
            ; Preserve the real SQL error text + SQLCODE (Rule #9).
            Set tDetail = "SQLCODE "_SQLCODE
            If tErrMsg '= "" Set tDetail = tDetail_": "_tErrMsg
            Set tSC = $$$ERROR($$$GeneralError, "SQL privilege "_tAction_" failed ("_tDetail_")")
            Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
            Set tSC = $$$OK
            Quit
        }

        Set tResult = {}
        Do tResult.%Set("action", tAction)
        Do tResult.%Set("target", tTarget)
        Do tResult.%Set("privilege", tPrivilege)
        Do tResult.%Set("grantee", tGrantee)
        Do tResult.%Set("level", $Select(tColumns'="":"column", tType=5:"schema", 1:"table"))
        Do tResult.%Set("success", 1, "boolean")
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

/// List the current SQL privileges granted to a target (user or role).
/// <p>Read action for <code>iris_resource_manage:listPrivileges</code>. Reads
/// query parameters: <code>grantee</code> (required — the user or role),
/// optional <code>target</code> (a <code>schema.table</code> to scope a
/// COLUMN-level listing), <code>system</code> (1 to include system objects),
/// and <code>namespace</code> (defaults to the request namespace).</p>
/// <p>Without <code>target</code>: returns object-level privileges via
/// <query>%SQL.Manager.CatalogPriv:UserPrivs</query> (TYPE, NAME, PRIVILEGE,
/// GRANTED_BY, GRANT_OPTION, GRANTED_VIA, HAS_COLUMN_PRIV). With a
/// <code>schema.table</code> target: returns column-level privileges via
/// <query>%SQL.Manager.CatalogPriv:UserColumnPrivs</query> (COLUMN_NAME,
/// PRIVILEGE, GRANTED_BY, GRANT_OPTION, GRANTED_VIA).</p>
ClassMethod SqlPrivilegeList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tGrantee = $Get(%request.Data("grantee", 1))
        Set tTarget = $Get(%request.Data("target", 1))
        Set tSystem = +$Get(%request.Data("system", 1))
        Set tReqNS = $Get(%request.Data("namespace", 1))

        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tGrantee, "grantee")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }

        If tReqNS '= "" {
            If '##class(%SYS.Namespace).Exists(tReqNS) {
                Set tSC = $$$ERROR($$$GeneralError, "Namespace '"_tReqNS_"' does not exist")
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            Set $NAMESPACE = tReqNS
        }

        Set tResult = {}
        Do tResult.%Set("grantee", tGrantee)
        Set tPrivs = []

        If tTarget '= "" {
            ; Column-level listing for a specific schema.table
            Set tSchema = $Piece(tTarget, ".", 1)
            Set tTable = $Piece(tTarget, ".", 2, *)
            Do tResult.%Set("target", tTarget)
            Do tResult.%Set("level", "column")
            Set tRS = ##class(%ResultSet).%New("%SQL.Manager.CatalogPriv:UserColumnPrivs")
            Set tSC = tRS.Execute(tGrantee, tSchema, tTable, tSystem)
            If $$$ISERR(tSC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            While tRS.Next() {
                Set tRow = {}
                Do tRow.%Set("column", tRS.Get("COLUMN_NAME"))
                Do tRow.%Set("privilege", tRS.Get("PRIVILEGE"))
                Do tRow.%Set("grantedBy", tRS.Get("GRANTED_BY"))
                Do tRow.%Set("grantOption", tRS.Get("GRANT_OPTION"))
                Do tRow.%Set("grantedVia", tRS.Get("GRANTED_VIA"))
                Do tPrivs.%Push(tRow)
            }
            Do tRS.Close()
        }
        Else {
            ; Object-level listing (tables/views/procedures/schemas)
            Do tResult.%Set("level", "object")
            Set tRS = ##class(%ResultSet).%New("%SQL.Manager.CatalogPriv:UserPrivs")
            Set tSC = tRS.Execute(tGrantee, tSystem)
            If $$$ISERR(tSC) {
                Set $NAMESPACE = tOrigNS
                Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
                Set tSC = $$$OK
                Quit
            }
            While tRS.Next() {
                Set tRow = {}
                Do tRow.%Set("type", tRS.Get("TYPE"))
                Do tRow.%Set("name", tRS.Get("NAME"))
                Do tRow.%Set("privilege", tRS.Get("PRIVILEGE"))
                Do tRow.%Set("grantedBy", tRS.Get("GRANTED_BY"))
                Do tRow.%Set("grantOption", tRS.Get("GRANT_OPTION"))
                Do tRow.%Set("grantedVia", tRS.Get("GRANTED_VIA"))
                Do tRow.%Set("hasColumnPriv", +tRS.Get("HAS_COLUMN_PRIV"), "boolean")
                Do tPrivs.%Push(tRow)
            }
            Do tRS.Close()
        }

        Set $NAMESPACE = tOrigNS
        Do tResult.%Set("privileges", tPrivs)
        Do tResult.%Set("count", tPrivs.%Size())
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

}
