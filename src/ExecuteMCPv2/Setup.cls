/// Setup and configuration class for the ExecuteMCPv2 REST service.
/// <p>Provides methods to register and unregister the <code>/api/executemcp/v2</code>
/// web application on IRIS. This class is called by the auto-bootstrap flow
/// (Story 3.6) and can also be invoked manually from the Terminal:</p>
/// <example>
/// Do ##class(ExecuteMCPv2.Setup).Configure()
/// </example>
/// <p>The Configure method must be run by a user with <code>%Admin_Manage</code>
/// privileges, as it creates/modifies web applications in the <code>%SYS</code> namespace.</p>
/// <p>The install records what it created in the global
/// <code>^ExecuteMCPv2.InstallRecord</code> of each namespace where one of its steps ran,
/// so <method>Uninstall</method> can take away only what the install added:</p>
/// <example>
/// Do ##class(ExecuteMCPv2.Setup).Uninstall()
/// </example>
/// <p><method>Configure</method> and <method>ConfigureMapping</method> are SQL procedures, so a
/// read-only <code>SELECT</code> over the web can reach them. They refuse, and change nothing,
/// when called inside a transaction (<code>$TLEVEL</code> above 0) during a web request (a
/// <code>%request</code> object exists), which is how <code>iris_sql_query</code> runs a SELECT.
/// The automatic install (Atelier, no transaction), an IPM install (a transaction, no
/// <code>%request</code>) and a terminal call run as before. Inside an IPM install's transaction,
/// <method>ConfigureMapping</method> keeps the <code>%ALL</code> namespace, the mapping and their
/// install record out of the transaction's rollback, so an install that fails later leaves them in
/// place, consistent, for <method>Uninstall</method> to remove.</p>
Class ExecuteMCPv2.Setup Extends %RegisteredObject
{

/// Default web application name for the ExecuteMCPv2 REST service.
Parameter WEBAPP = "/api/executemcp/v2";

/// IRIS status codes that mean "does not exist" (<code>$$$ApplicationDoesNotExist</code>,
/// <code>$$$CPFNameDoesNotExist</code>, <code>$$$CPFMapDoesNotExist</code>): the uninstall
/// reads any other failure of an existence check as a failed step, never as "absent".
Parameter APPNOTFOUNDCODE = 869;

Parameter NAMENOTFOUNDCODE = 420;

Parameter MAPNOTFOUNDCODE = 421;

/// The name, inside the <code>ExecuteMCPv2</code> package, of the class only IPM installs.
/// The embed never names it in full: that class is not a bootstrapped class.
Parameter GUARDCLASS = "InstallGuard";

/// The rest of the refusal text of <method>Configure</method> and <method>ConfigureMapping</method>
/// (each puts its own name in front) when either is called inside a transaction during a web
/// request, as <code>iris_sql_query</code> runs a SELECT.
Parameter GUARDTEXT = "changed nothing: it was called inside a transaction during a web request, as iris_sql_query runs a SELECT. Run it in an IRIS terminal, or let the automatic install or IPM run it.";

/// Bootstrap version marker, injected by <code>scripts/gen-bootstrap.mjs</code>
/// at generation time. The marker is
/// <code>&lt;semver&gt;+&lt;sequence&gt;.&lt;hash&gt;</code>: the version of
/// <code>@iris-mcp/shared</code>, a sequence that rises by one whenever the
/// hash changes, and a short SHA-256 hash of the concatenated content of all
/// embedded ObjectScript classes.
/// <p>The value on disk is <code>"dev"</code> (a placeholder for local
/// development). The bootstrap generator replaces it with the real marker
/// before embedding the class source into
/// <code>packages/shared/src/bootstrap-classes.ts</code>.</p>
/// <p>Used by the auto-bootstrap flow to order the deployed classes against
/// the embedded ones: semver first, then sequence. A bare 12-hex marker
/// (written by a build that predates the sequence) is older. The bootstrap
/// redeploys the classes only over an absent or older deployment (skipping the
/// one-time web application registration and package mapping steps). A newer
/// deployment, an equal semver and sequence with a different hash, the
/// <code>"dev"</code> placeholder and any unparseable value are left in place
/// with a warning.</p>
Parameter BOOTSTRAPVERSION = "dev";

/// Register the <code>/api/executemcp/v2</code> web application.
/// <p>Creates or updates the web application to route requests to
/// <class>ExecuteMCPv2.REST.Dispatch</class>. The operation is idempotent —
/// calling Configure() multiple times has no side effects.</p>
/// <p>Must be called from, or will switch to, the <code>%SYS</code> namespace
/// since <class>Security.Applications</class> requires it.</p>
/// @param pNamespace The namespace where ExecuteMCPv2 classes are installed.
///        Defaults to the current namespace before switching to %SYS.
ClassMethod Configure(pNamespace As %String = "") As %Status [ SqlProc ]
{
    ; The transaction guard (see the class doc): refuse inside a transaction during a web request
    If ($TLevel > 0) && $IsObject($Get(%request)) Quit $$$ERROR($$$GeneralError, "Configure " _ ..#GUARDTEXT)
    Set tSC = $$$OK
    Try {
        ; Capture the target namespace before switching to %SYS
        If pNamespace = "" Set pNamespace = $NAMESPACE

        ; Switch to %SYS to manage web applications
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        Set tAppName = ..#WEBAPP

        ; Check if the web application already exists
        Set tExists = ##class(Security.Applications).Exists(tAppName)

        If tExists {
            ; Update existing web application
            Set tSC = ##class(Security.Applications).Get(tAppName, .tProps)
            If $$$ISERR(tSC) Quit

            Set tProps("NameSpace") = pNamespace
            Set tProps("DispatchClass") = "ExecuteMCPv2.REST.Dispatch"
            Set tProps("Enabled") = 1
            Set tProps("AutheEnabled") = 32
            Set tProps("Type") = 2
            Set tProps("CSPZENEnabled") = 1
            Set tProps("InbndWebServicesEnabled") = 0
            Set tProps("CookiePath") = "/api/executemcp/v2/"
            Set tProps("Resource") = "%Development"

            Set tSC = ##class(Security.Applications).Modify(tAppName, .tProps)
            If $$$ISERR(tSC) Quit
        } Else {
            ; Create new web application
            Kill tProps
            Set tProps("NameSpace") = pNamespace
            Set tProps("DispatchClass") = "ExecuteMCPv2.REST.Dispatch"
            Set tProps("Description") = "ExecuteMCPv2 REST Service for MCP Tool Execution"
            Set tProps("Enabled") = 1
            Set tProps("AutheEnabled") = 32
            Set tProps("Type") = 2
            Set tProps("CSPZENEnabled") = 1
            Set tProps("InbndWebServicesEnabled") = 0
            Set tProps("CookiePath") = "/api/executemcp/v2/"
            Set tProps("Resource") = "%Development"

            Set tSC = ##class(Security.Applications).Create(tAppName, .tProps)
            If $$$ISERR(tSC) Quit
        }

        ; The step succeeded: record the namespace it deployed to
        Do ..WriteRecord(pNamespace, "deployed", ..#BOOTSTRAPVERSION)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Remove the IRIS side of the suite: what the install created, and nothing else.
/// <p>Run it in an IRIS terminal, in any namespace that sees this class, as a user
/// with <code>%Admin_Manage</code> and write access to the databases of the
/// namespaces involved. It is deliberately not an SQL procedure.</p>
/// <example>
/// Do ##class(ExecuteMCPv2.Setup).Uninstall()
/// </example>
/// <p>In this order it removes: (1) the <code>/api/executemcp/v2</code> web application;
/// (2) the <code>ExecuteMCPv2</code> package mapping in <code>%ALL</code>; (3) the
/// <code>%ALL</code> namespace, only when an install record says the install created it
/// and nothing else is mapped in it; (4) <code>^UnitTestRoot</code> of each namespace
/// whose record says the install set it, only while its value is unchanged; (5) the
/// <code>ExecuteMCPv2</code> classes of every namespace that holds a copy the install
/// deployed (shadowed copies included; a copy owned by IPM or not deployed by this
/// install is left and named), only when no earlier step failed; (6) the install
/// records, only when no step failed. A failed step therefore leaves this class and the
/// records in place, and the command can run again once the cause is fixed.
/// Without any install record (an install by 1.2.0 or earlier) <code>%ALL</code> and
/// <code>^UnitTestRoot</code> are never removed and the report gives the commands. The same
/// holds for a <code>%ALL</code> that every record says the install found, and for the
/// <code>^UnitTestRoot</code> of a namespace that holds no record of its own.
/// If the web application, the mapping or the namespace list cannot be read or removed,
/// <code>%ALL</code>, <code>^UnitTestRoot</code>, the classes and the records are left
/// alone.</p>
/// <p>A repeat run removes nothing more and returns <code>$$$OK</code> while a copy of this
/// class remains; after a full removal the class is gone, so the call raises
/// <code>&lt;CLASS DOES NOT EXIST&gt;</code> and there is nothing left to do.
/// <var>pReport</var> is a <class>%DynamicObject</class>
/// <code>{removed:[], left:[], failed:[], namespaces:[]}</code>; each entry is
/// <code>{item, namespace?, detail|reason|error, manual?}</code>. With
/// <var>pVerbose</var> one line per entry is written to the current device. The status
/// is an error when an item failed.</p>
/// @param pVerbose 1 to write the report on the current device.
/// @param pReport Output: the report object.
ClassMethod Uninstall(pVerbose As %Boolean = 1, Output pReport As %DynamicObject) As %Status
{
    Set tOrigNS = $NAMESPACE
    Set pReport = {"removed":[], "left":[], "failed":[], "namespaces":[]}
    Set tSysOK = 0, tSysText = "", tListOK = 0, tCfgFailed = 0, tAllExists = 0, tStep2OK = 1
    Set tMapStatus = $$$OK, tMapText = ""
    Kill tNS, tScan, tDel, tUsed

    ; Steps 1 and 2 and the namespace list run in %SYS
    Try {
        Set $NAMESPACE = "%SYS"
        Set tSysOK = 1
    } Catch ex {
        Set tSysText = $System.Status.GetErrorText(ex.AsStatus())
    }
    If 'tSysOK {
        Do ..AddEntry(pReport, "failed", "web application " _ ..#WEBAPP, "", "error", tSysText)
        Do ..AddEntry(pReport, "failed", "package mapping ExecuteMCPv2 in %ALL", "", "error", tSysText)
        Do ..AddEntry(pReport, "failed", "namespace list", "", "error", tSysText)
        Set tCfgFailed = 1
    } Else {
        ; Step 1: the web application
        Try {
            Set tFound = ##class(Security.Applications).Exists(..#WEBAPP, .tObj, .tSC)
            If tFound {
                Set tSC = ##class(Security.Applications).Delete(..#WEBAPP)
                If $$$ISOK(tSC) {
                    Do ..AddEntry(pReport, "removed", "web application " _ ..#WEBAPP, "", "detail", "")
                } Else {
                    Set tCfgFailed = 1
                    Do ..AddEntry(pReport, "failed", "web application " _ ..#WEBAPP, "", "error", $System.Status.GetErrorText(tSC))
                }
            } ElseIf $$$ISERR(tSC) && ('$System.Status.Equals(tSC, ..#APPNOTFOUNDCODE)) {
                Set tCfgFailed = 1
                Do ..AddEntry(pReport, "failed", "web application " _ ..#WEBAPP, "", "error", $System.Status.GetErrorText(tSC))
            }
        } Catch ex {
            Set tCfgFailed = 1
            Do ..AddEntry(pReport, "failed", "web application " _ ..#WEBAPP, "", "error", $System.Status.GetErrorText(ex.AsStatus()))
        }

        ; Step 2: the %ALL package mapping
        Try {
            Set tAllExists = ##class(Config.Namespaces).Exists("%ALL", .tObj, .tSC)
            If 'tAllExists {
                If $$$ISERR(tSC) && ('$System.Status.Equals(tSC, ..#NAMENOTFOUNDCODE)) {
                    Set tStep2OK = 0, tCfgFailed = 1
                    Do ..AddEntry(pReport, "failed", "package mapping ExecuteMCPv2 in %ALL", "", "error", $System.Status.GetErrorText(tSC))
                }
            } Else {
                Set tMapped = ##class(Config.MapPackages).Exists("%ALL", "ExecuteMCPv2", .tObj, .tSC)
                If tMapped {
                    Set tSC = ##class(Config.MapPackages).Delete("%ALL", "ExecuteMCPv2")
                    If $$$ISOK(tSC) {
                        Do ..AddEntry(pReport, "removed", "package mapping ExecuteMCPv2 in %ALL", "", "detail", "")
                    } Else {
                        Set tStep2OK = 0, tCfgFailed = 1
                        Do ..AddEntry(pReport, "failed", "package mapping ExecuteMCPv2 in %ALL", "", "error", $System.Status.GetErrorText(tSC))
                    }
                } ElseIf $$$ISERR(tSC) && ('$System.Status.Equals(tSC, ..#MAPNOTFOUNDCODE)) {
                    Set tStep2OK = 0, tCfgFailed = 1
                    Do ..AddEntry(pReport, "failed", "package mapping ExecuteMCPv2 in %ALL", "", "error", $System.Status.GetErrorText(tSC))
                }
            }
        } Catch ex {
            Set tStep2OK = 0, tCfgFailed = 1
            Do ..AddEntry(pReport, "failed", "package mapping ExecuteMCPv2 in %ALL", "", "error", $System.Status.GetErrorText(ex.AsStatus()))
        }

        ; What is still mapped in %ALL (the :List queries, never the SQL projections)
        If tAllExists && tStep2OK {
            Set tMapStatus = ..MappingText("%ALL", .tMapText)
            If $$$ISERR(tMapStatus) {
                Do ..AddEntry(pReport, "failed", "%ALL mappings", "", "error", $System.Status.GetErrorText(tMapStatus))
            }
        }

        ; The namespaces to look at
        Try {
            Set tRS = ##class(%ResultSet).%New("Config.Namespaces:List")
            Set tSC = tRS.Execute("*")
            If $$$ISERR(tSC) {
                Set tCfgFailed = 1
                Do ..AddEntry(pReport, "failed", "namespace list", "", "error", $System.Status.GetErrorText(tSC))
            } Else {
                While tRS.Next() {
                    Set tName = tRS.GetData(1)
                    If tName '= "%ALL" Set tNS(tName) = ""
                }
                Do tRS.Close()
                Set tListOK = 1
            }
        } Catch ex {
            Set tCfgFailed = 1
            Do ..AddEntry(pReport, "failed", "namespace list", "", "error", $System.Status.GetErrorText(ex.AsStatus()))
        }
        Try { Set $NAMESPACE = tOrigNS } Catch ex { }
    }

    Try {
        If tCfgFailed {
            Do ..AddEntry(pReport, "left", "%ALL, ^UnitTestRoot, classes and the install records", "", "reason", "an earlier step failed, so none of them was touched and the command can run again once it is fixed")
        } ElseIf tListOK {
            ; Read every namespace once, while nothing is deleted. Nothing below calls a
            ; helper from inside another namespace: the classes may be gone there.
            Set tN = ""
            For {
                Set tN = $Order(tNS(tN))
                If tN = "" Quit
                Try {
                    Set $NAMESPACE = tN
                    Kill tItems
                    Do $System.OBJ.GetPackageList(.tItems, "ExecuteMCPv2", "/includesubpackages")
                    Set tCount = 0, tK = ""
                    For {
                        Set tK = $Order(tItems(tK))
                        If tK = "" Quit
                        Set tCount = tCount + 1
                    }
                    Set tGuard = 0, tMarker = ""
                    If tCount > 0 {
                        Set tGuard = ##class(%Dictionary.ClassDefinition).%ExistsId("ExecuteMCPv2." _ ..#GUARDCLASS)
                        Set tPD = ##class(%Dictionary.CompiledParameter).%OpenId("ExecuteMCPv2.Setup||BOOTSTRAPVERSION")
                        If $IsObject(tPD) Set tMarker = tPD.Default
                    }
                    Set tScan(tN, "count") = tCount
                    Set tScan(tN, "guard") = +tGuard
                    Set tScan(tN, "marker") = tMarker
                    Set tScan(tN, "hasRecord") = ($Data(^ExecuteMCPv2.InstallRecord) > 0)
                    Set tScan(tN, "deployed") = $Get(^ExecuteMCPv2.InstallRecord("deployed"))
                    Set tScan(tN, "all") = $Get(^ExecuteMCPv2.InstallRecord("all"))
                    Set tScan(tN, "recUTR") = $Get(^ExecuteMCPv2.InstallRecord("unitTestRoot"))
                    Set tScan(tN, "utrCurrent") = $Get(^UnitTestRoot)
                    Set $NAMESPACE = tOrigNS
                } Catch exScan {
                    Try { Set $NAMESPACE = tOrigNS } Catch exBack { }
                    Set tScan(tN, "error") = $System.Status.GetErrorText(exScan.AsStatus())
                }
            }

            ; The namespaces that used the suite, the current one first
            Set tN = ""
            For {
                Set tN = $Order(tScan(tN))
                If tN = "" Quit
                If $Data(tScan(tN, "error")) {
                    Do ..AddEntry(pReport, "failed", "namespace", tN, "error", tScan(tN, "error"))
                } Else {
                    If (tScan(tN, "count") > 0) || (tScan(tN, "deployed") '= "") Set tUsed(tN) = 1
                    Set tAnyRecord = $Get(tAnyRecord) || tScan(tN, "hasRecord")
                    Set tAnyAll = $Get(tAnyAll) || (tScan(tN, "all") '= "")
                    Set tAnyCreated = $Get(tAnyCreated) || (tScan(tN, "all") = "created")
                }
            }
            If $Data(tUsed(tOrigNS)) Do pReport.namespaces.%Push(tOrigNS)
            Set tN = ""
            For {
                Set tN = $Order(tUsed(tN))
                If tN = "" Quit
                If tN '= tOrigNS Do pReport.namespaces.%Push(tN)
            }

            ; Step 3: the %ALL namespace
            If tAllExists && ($$$ISOK(tMapStatus)) {
                Set tCode = ..DecideAll(tAllExists, $Get(tAnyAll), $Get(tAnyCreated), tStep2OK, tMapText, .tWhy, .tManual)
                If tCode = "remove" {
                    Try {
                        Set $NAMESPACE = "%SYS"
                        Set tSC = ##class(Config.Namespaces).Delete("%ALL")
                    } Catch exAll {
                        Set tSC = exAll.AsStatus()
                    }
                    Try { Set $NAMESPACE = tOrigNS } Catch exBack { }
                    If $$$ISOK(tSC) {
                        Do ..AddEntry(pReport, "removed", "%ALL", "", "detail", "")
                    } Else {
                        Do ..AddEntry(pReport, "failed", "%ALL", "", "error", $System.Status.GetErrorText(tSC))
                    }
                } ElseIf tCode '= "none" {
                    Do ..AddEntry(pReport, "left", "%ALL", "", "reason", tWhy, tManual)
                }
            }

            ; Step 4: ^UnitTestRoot
            Set tN = ""
            For {
                Set tN = $Order(tScan(tN))
                If tN = "" Quit
                If '$Data(tScan(tN, "error")) {
                    Set tCode = ..DecideUnitTestRoot(tScan(tN, "recUTR"), tScan(tN, "utrCurrent"), tScan(tN, "hasRecord"))
                    If tCode = "remove" {
                        Try {
                            Kill ^|tN|UnitTestRoot
                            Do ..AddEntry(pReport, "removed", "^UnitTestRoot", tN, "detail", "")
                        } Catch exUTR {
                            Do ..AddEntry(pReport, "failed", "^UnitTestRoot", tN, "error", $System.Status.GetErrorText(exUTR.AsStatus()))
                        }
                    } ElseIf tCode = "changed" {
                        Do ..AddEntry(pReport, "left", "^UnitTestRoot", tN, "reason", "it changed since the install set it", "in " _ tN _ ": Kill ^UnitTestRoot")
                    } ElseIf tCode = "norecord" {
                        Set tWhyUTR = $Select($Get(tAnyRecord): "no install record in " _ tN _ " says the install set it", 1: "no install record says the install set it")
                        Do ..AddEntry(pReport, "left", "^UnitTestRoot", tN, "reason", tWhyUTR _ " (an install by 1.2.0 or earlier writes none)", "in " _ tN _ ": Kill ^UnitTestRoot")
                    }
                }
            }

            ; Step 5: the classes, namespace by namespace. They go only when no earlier step
            ; failed: this class is among them, and a re-run needs it to finish the job.
            Set tN = ""
            For {
                Set tN = $Order(tScan(tN))
                If tN = "" Quit
                If '$Data(tScan(tN, "error")) {
                    Set tCode = ..DecideClasses(tScan(tN, "count"), tScan(tN, "guard"), tScan(tN, "marker"), .tWhy)
                    If tCode = "delete" {
                        Set tDel(tN) = tScan(tN, "count")
                    } ElseIf tCode = "ipm" {
                        Do ..AddEntry(pReport, "left", "classes", tN, "reason", tWhy, "in " _ tN _ ": zpm ""uninstall iris-execute-mcp-v2""")
                    } ElseIf tCode = "foreign" {
                        Do ..AddEntry(pReport, "left", "classes", tN, "reason", tWhy, "in " _ tN _ ": Do $System.OBJ.DeletePackage(""ExecuteMCPv2"")")
                    }
                }
            }
            If ..DecideRecords(pReport.failed.%Size()) = "remove" {
                Set tN = ""
                For {
                    Set tN = $Order(tDel(tN))
                    If tN = "" Quit
                    If tN '= tOrigNS Do ..RemoveClasses(pReport, tN, tDel(tN))
                }
                If $Data(tDel(tOrigNS)) Do ..RemoveClasses(pReport, tOrigNS, tDel(tOrigNS))
            } Else {
                Set tN = ""
                For {
                    Set tN = $Order(tDel(tN))
                    If tN = "" Quit
                    Do ..AddEntry(pReport, "left", "classes", tN, "reason", "an earlier step failed, so the classes stay and the command can run again once it is fixed")
                }
            }

            ; Step 6: the records go last, and only when nothing failed
            If ..DecideRecords(pReport.failed.%Size()) = "remove" {
                Set tN = ""
                For {
                    Set tN = $Order(tScan(tN))
                    If tN = "" Quit
                    If tScan(tN, "hasRecord") {
                        Try {
                            Kill ^|tN|ExecuteMCPv2.InstallRecord
                            Do ..AddEntry(pReport, "removed", "install record", tN, "detail", "")
                        } Catch exRec {
                            Do ..AddEntry(pReport, "failed", "install record", tN, "error", $System.Status.GetErrorText(exRec.AsStatus()))
                        }
                    }
                }
            } Else {
                Do ..AddEntry(pReport, "left", "install records", "", "reason", "a step failed, so the records stay and the command can run again")
            }
        }
    } Catch exAll2 {
        Try { Set $NAMESPACE = tOrigNS } Catch exBack2 { }
        Do ..AddEntry(pReport, "failed", "uninstall", "", "error", $System.Status.GetErrorText(exAll2.AsStatus()))
    }

    If pVerbose Do ..PrintReport(pReport)

    Set tSC = $$$OK
    If pReport.failed.%Size() > 0 {
        Set tNames = ""
        Set tIter = pReport.failed.%GetIterator()
        While tIter.%GetNext(.tKey, .tEntry) {
            Set tNames = tNames _ $Select(tNames = "": "", 1: ", ") _ tEntry.%Get("item") _ $Select(tEntry.%Get("namespace") '= "": " (" _ tEntry.%Get("namespace") _ ")", 1: "")
        }
        Set tSC = $$$ERROR($$$GeneralError, "Uninstall did not finish: " _ tNames _ ". See the report.")
    }
    Quit tSC
}

/// Decide what the uninstall does with the <code>ExecuteMCPv2</code> classes of one
/// namespace. Returns <code>none</code> (no classes), <code>delete</code>,
/// <code>ipm</code> (the IPM install guard class is present, so IPM owns them)
/// or <code>foreign</code> (the copy is not shown to be this install's). A copy is ours
/// only when the namespace's own <code>Setup</code> class carries a release marker, which
/// only the bootstrap and IPM write. The namespace's install record never overrides the
/// copy itself: a <code>Setup</code> class with the <code>dev</code> marker, an
/// unparseable marker or none (no <code>Setup</code> class) is foreign even where a record
/// exists, because the copy may have been replaced after the install wrote the record.
/// @param pClassCount Classes of the package held by the namespace itself.
/// @param pHasGuard 1 when the IPM install guard class exists there.
/// @param pMarker The <code>BOOTSTRAPVERSION</code> of the namespace's own Setup class, or "".
/// @param pReason Output: why the classes are left.
ClassMethod DecideClasses(pClassCount As %Integer, pHasGuard As %Boolean, pMarker As %String, Output pReason As %String) As %String
{
    Set pReason = ""
    If +pClassCount = 0 Quit "none"
    If pHasGuard {
        Set pReason = "IPM owns them"
        Quit "ipm"
    }
    If ..IsReleaseMarker(pMarker) Quit "delete"
    If pMarker = "dev" {
        Set pReason = "its Setup class carries the dev marker, so it is not a copy this install deployed"
    } ElseIf pMarker = "" {
        Set pReason = "it has no release marker (no Setup class, or none on it), so it is not shown to be a copy this install deployed"
    } Else {
        Set pReason = "its marker " _ pMarker _ " is not a release marker, so it is not shown to be a copy this install deployed"
    }
    Quit "foreign"
}

/// Whether <var>pMarker</var> is a release marker written by the bootstrap or IPM:
/// <code>&lt;semver&gt;+&lt;sequence&gt;.&lt;hash&gt;</code>, or a bare 12-hex hash from
/// a build that predates the sequence.
ClassMethod IsReleaseMarker(pMarker As %String) As %Boolean
{
    Quit $Match(pMarker, "^[0-9]+\.[0-9]+\.[0-9]+\+[0-9]+\.[0-9a-f]{12}$") || $Match(pMarker, "^[0-9a-f]{12}$")
}

/// Decide what the uninstall does with the <code>%ALL</code> namespace. Returns
/// <code>none</code> (absent), <code>remove</code>, or <code>left</code> with
/// <var>pReason</var> (and, when no record says the install created it, the commands in
/// <var>pManual</var>).
/// @param pExists 1 when <code>%ALL</code> exists.
/// @param pAnyRecord 1 when some namespace's record holds an <code>("all")</code> node.
/// @param pAnyCreated 1 when some namespace's record says <code>created</code>.
/// @param pStep2OK 0 when removing the package mapping failed.
/// @param pMappings The mappings still in <code>%ALL</code> ("" when none), from the three <code>:List</code> queries.
ClassMethod DecideAll(pExists As %Boolean, pAnyRecord As %Boolean, pAnyCreated As %Boolean, pStep2OK As %Boolean, pMappings As %String, Output pReason As %String, Output pManual As %String) As %String
{
    Set pReason = "", pManual = ""
    If 'pExists Quit "none"
    If 'pStep2OK {
        Set pReason = "removing the ExecuteMCPv2 mapping failed, so what else is mapped there was not checked"
        Quit "left"
    }
    If 'pAnyRecord {
        Set pReason = "no install record says the install created it (an install by 1.2.0 or earlier writes none)"
        Set pManual = "in %SYS: Do ##class(Config.Namespaces).Delete(""%ALL""). This deletes %ALL together with every mapping in it, so check what else is mapped there first"
        Quit "left"
    }
    If 'pAnyCreated {
        Set pReason = "the install found it already there; an install by 1.2.0 or earlier that created it writes no record"
        Set pManual = "in %SYS: Do ##class(Config.Namespaces).Delete(""%ALL""). This deletes %ALL together with every mapping in it, so check what else is mapped there first"
        Quit "left"
    }
    If pMappings '= "" {
        Set pReason = "it still holds mappings: " _ pMappings
        Quit "left"
    }
    Quit "remove"
}

/// Decide what the uninstall does with <code>^UnitTestRoot</code> of one namespace.
/// Returns <code>remove</code> (the install set it and the value is unchanged),
/// <code>changed</code> (it differs from what the install set), <code>norecord</code>
/// (the namespace holds no install record and the global is defined), or <code>none</code>
/// (nothing to do, nothing to report). A namespace whose own record has no
/// <code>unitTestRoot</code> node is left alone: the global was there before that install.
/// @param pRecorded The record's <code>("unitTestRoot")</code> value, or "".
/// @param pCurrent The current value of <code>^UnitTestRoot</code>, or "".
/// @param pHasRecord 1 when this namespace holds an install record.
ClassMethod DecideUnitTestRoot(pRecorded As %String, pCurrent As %String, pHasRecord As %Boolean) As %String
{
    If pRecorded '= "" {
        If pCurrent = "" Quit "none"
        If pCurrent = pRecorded Quit "remove"
        Quit "changed"
    }
    If 'pHasRecord && (pCurrent '= "") Quit "norecord"
    Quit "none"
}

/// Decide whether the classes, and after them the install records, go: <code>remove</code>
/// only when no step before them failed, otherwise <code>keep</code>, so this class and the
/// records stay and a re-run can finish what a failed step left.
/// @param pFailedCount How many items the report holds under <code>failed</code>.
ClassMethod DecideRecords(pFailedCount As %Integer) As %String
{
    If +pFailedCount = 0 Quit "remove"
    Quit "keep"
}

/// The value to store in an install record node that is merged: <code>created</code>
/// is never overwritten by <code>found</code>.
/// @param pExisting The node's current value, or "" when undefined.
/// @param pNew The value the step wants to write.
ClassMethod MergeRecordValue(pExisting As %String, pNew As %String) As %String
{
    If (pNew = "found") && (pExisting '= "") Quit pExisting
    Quit pNew
}

/// Write one node of the install record of <var>pNamespace</var>. Each node is written
/// only after its step succeeded; a failure here is swallowed and never changes what the
/// caller returns.
/// @param pNamespace The namespace whose record is written.
/// @param pNode One of <code>deployed</code>, <code>all</code>, <code>mapping</code>, <code>unitTestRoot</code>.
/// @param pValue The value (<code>created</code> or <code>found</code> for <code>all</code> and <code>mapping</code>).
/// @param pDatabase For <code>mapping</code>: the database the mapping points to.
ClassMethod WriteRecord(pNamespace As %String, pNode As %String, pValue As %String, pDatabase As %String = "") As %Boolean
{
    Set tOK = 0
    Try {
        Set ^|pNamespace|ExecuteMCPv2.InstallRecord("format") = 1
        If (pNode = "all") || (pNode = "mapping") {
            Set tOld = $Get(^|pNamespace|ExecuteMCPv2.InstallRecord(pNode))
            Set ^|pNamespace|ExecuteMCPv2.InstallRecord(pNode) = ..MergeRecordValue(tOld, pValue)
            If (pNode = "mapping") && (pDatabase '= "") {
                If (pValue = "created") || ($Get(^|pNamespace|ExecuteMCPv2.InstallRecord("mapping", "database")) = "") {
                    Set ^|pNamespace|ExecuteMCPv2.InstallRecord("mapping", "database") = pDatabase
                }
            }
        } Else {
            Set ^|pNamespace|ExecuteMCPv2.InstallRecord(pNode) = pValue
        }
        Set tOK = 1
    } Catch ex {
        Set tOK = 0
    }
    Quit tOK
}

/// The mappings of the namespace <var>pNamespace</var> as text (<code>package X, global Y,
/// routine Z</code>), read with the <code>Config.MapPackages</code>,
/// <code>Config.MapGlobals</code> and <code>Config.MapRoutines</code> <code>:List</code>
/// queries (their SQL projections return the package row under all three). Runs in
/// <code>%SYS</code>.
ClassMethod MappingText(pNamespace As %String, Output pText As %String) As %Status
{
    Set pText = ""
    Set tSC = $$$OK
    Try {
        For tKind = "package", "global", "routine" {
            Set tRS = ##class(%ResultSet).%New($Case(tKind, "package": "Config.MapPackages:List", "global": "Config.MapGlobals:List", : "Config.MapRoutines:List"))
            Set tSC = tRS.Execute(pNamespace)
            If $$$ISERR(tSC) Quit
            While tRS.Next() {
                Set pText = pText _ $Select(pText = "": "", 1: ", ") _ tKind _ " " _ tRS.GetData(2)
            }
            Do tRS.Close()
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Delete the <code>ExecuteMCPv2</code> package of one namespace and record the outcome
/// in <var>pReport</var>.
ClassMethod RemoveClasses(pReport As %DynamicObject, pNamespace As %String, pCount As %Integer)
{
    Set tOrig = $NAMESPACE
    Set tSC = $$$OK, tLeft = 0
    Try {
        Set $NAMESPACE = pNamespace
        Set tSC = $System.OBJ.DeletePackage("ExecuteMCPv2", "-d")
        Kill tItems
        Do $System.OBJ.GetPackageList(.tItems, "ExecuteMCPv2", "/includesubpackages")
        Set tK = ""
        For {
            Set tK = $Order(tItems(tK))
            If tK = "" Quit
            Set tLeft = tLeft + 1
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Try { Set $NAMESPACE = tOrig } Catch exBack { }
    If $$$ISERR(tSC) {
        Do ..AddEntry(pReport, "failed", "classes", pNamespace, "error", $System.Status.GetErrorText(tSC))
    } ElseIf tLeft > 0 {
        Do ..AddEntry(pReport, "failed", "classes", pNamespace, "error", tLeft _ " classes could not be deleted")
    } Else {
        Do ..AddEntry(pReport, "removed", "classes", pNamespace, "detail", pCount _ " classes")
    }
    Quit
}

/// Append one entry to a list of the report (<code>removed</code>, <code>left</code> or
/// <code>failed</code>). <var>pKey</var> names the text property: <code>detail</code>,
/// <code>reason</code> or <code>error</code>.
ClassMethod AddEntry(pReport As %DynamicObject, pKind As %String, pItem As %String, pNamespace As %String, pKey As %String, pText As %String, pManual As %String = "")
{
    Set tEntry = {}
    Do tEntry.%Set("item", pItem)
    If pNamespace '= "" Do tEntry.%Set("namespace", pNamespace)
    If pText '= "" Do tEntry.%Set(pKey, pText)
    If pManual '= "" Do tEntry.%Set("manual", pManual)
    Do pReport.%Get(pKind).%Push(tEntry)
    Quit
}

/// The report line of one entry of <var>pKind</var> (<code>removed</code>,
/// <code>left</code> or <code>failed</code>).
ClassMethod FormatEntry(pKind As %String, pEntry As %DynamicObject) As %String
{
    Set tWho = pEntry.%Get("item")
    If pEntry.%Get("namespace") '= "" Set tWho = tWho _ " (" _ pEntry.%Get("namespace") _ ")"
    If pKind = "removed" {
        Quit "Removed: " _ tWho _ $Select(pEntry.%Get("detail") '= "": ": " _ pEntry.%Get("detail"), 1: "")
    }
    If pKind = "left" {
        Quit "Left: " _ tWho _ " (" _ pEntry.%Get("reason") _ ")" _ $Select(pEntry.%Get("manual") '= "": ". To remove it by hand: " _ pEntry.%Get("manual"), 1: "")
    }
    Quit "Failed: " _ tWho _ ": " _ pEntry.%Get("error")
}

/// The line that names the namespaces of a report that holds more than one, with what
/// happened to each namespace's own classes, read from the report's <code>classes</code>
/// entries.
ClassMethod NamespacesLine(pReport As %DynamicObject) As %String
{
    Set tList = "", tFates = ""
    Set tIter = pReport.%Get("namespaces").%GetIterator()
    While tIter.%GetNext(.tKey, .tName) {
        Set tList = tList _ $Select(tList = "": "", 1: ", ") _ tName
        Set tFate = tName _ " held no classes of its own"
        For tKind = "removed", "left", "failed" {
            Set tEntries = pReport.%Get(tKind).%GetIterator()
            While tEntries.%GetNext(.tK, .tEntry) {
                If (tEntry.%Get("item") = "classes") && (tEntry.%Get("namespace") = tName) {
                    Set tFate = tName _ $Case(tKind, "removed": " lost its classes", "left": " kept its classes (see its Left: line)", : " still holds classes that could not be removed (see its Failed: line)")
                }
            }
        }
        Set tFates = tFates _ $Select(tFates = "": "", 1: "; ") _ tFate
    }
    Quit "Namespaces " _ tList _ " used the suite: the instance has one web application and one %ALL mapping, so none of them has either now; " _ tFates _ "."
}

/// The line printed on every run about a server that is still running.
ClassMethod ServerLine() As %String
{
    Quit "A server with the automatic install on puts the IRIS side back the next time it starts or first uses this instance: stop it, or set IRIS_AUTO_INSTALL=false (or remove it from the client configuration) before removing the IRIS side."
}

/// The lines a report prints, as a <class>%DynamicArray</class> of strings: one per
/// entry (removed, left, failed), the namespaces line when more than one namespace used
/// the suite, the nothing-found line when the report is empty, and the server line last.
ClassMethod ReportLines(pReport As %DynamicObject) As %DynamicArray
{
    Set tLines = []
    For tKind = "removed", "left", "failed" {
        Set tIter = pReport.%Get(tKind).%GetIterator()
        While tIter.%GetNext(.tKey, .tEntry) {
            Do tLines.%Push(..FormatEntry(tKind, tEntry))
        }
    }
    If pReport.%Get("namespaces").%Size() > 1 Do tLines.%Push(..NamespacesLine(pReport))
    If (pReport.%Get("removed").%Size() = 0) && (pReport.%Get("left").%Size() = 0) && (pReport.%Get("failed").%Size() = 0) {
        Do tLines.%Push("Nothing was removed: no part of the IRIS side was found.")
    }
    Do tLines.%Push(..ServerLine())
    Quit tLines
}

/// Write a report on the current device, one line per entry of <method>ReportLines</method>.
ClassMethod PrintReport(pReport As %DynamicObject)
{
    Set tLines = ..ReportLines(pReport)
    Set tIter = tLines.%GetIterator()
    While tIter.%GetNext(.tKey, .tLine) {
        Write tLine, !
    }
    Quit
}

/// Map the <code>ExecuteMCPv2</code> package to the <code>%All</code> namespace.
/// <p>This makes ExecuteMCPv2 classes (including compiled routines used for
/// I/O redirect mnemonic labels) available in every namespace. Without this
/// mapping, cross-namespace <code>iris_execute_command</code> fails with
/// <code>&lt;NOROUTINE&gt;</code> because the mnemonic labels are resolved in
/// the current namespace at call time.</p>
/// <p>The mapping points to the database where ExecuteMCPv2 classes are
/// compiled (determined by the routines database of <code>pNamespace</code>).</p>
/// <p>Inside a transaction with no web request (an IPM install), the creation of <code>%ALL</code>
/// and of the mapping, and their install-record entries, are made with transactions suspended, so a
/// later failure of the install and its rollback leave them in place: <code>%ALL</code>, the mapping
/// and the record stay consistent, and <method>Uninstall</method> removes them. A rolled-back
/// <code>%ALL</code> would leave the namespace table refusing every new namespace. The previous
/// suspension state is restored before the method returns, on every path. With no transaction (the
/// automatic install, a terminal call) nothing is suspended.</p>
/// @param pNamespace The namespace where ExecuteMCPv2 is installed (e.g., HSCUSTOM).
ClassMethod ConfigureMapping(pNamespace As %String = "") As %Status [ SqlProc ]
{
    ; The transaction guard (see the class doc): refuse inside a transaction during a web request
    If ($TLevel > 0) && $IsObject($Get(%request)) Quit $$$ERROR($$$GeneralError, "ConfigureMapping " _ ..#GUARDTEXT)
    Set tSC = $$$OK
    Set tSuspendedHere = 0
    Set tPreviousSuspended = 0
    Try {
        If pNamespace = "" Set pNamespace = $NAMESPACE

        New $NAMESPACE
        Set $NAMESPACE = "%SYS"

        ; Get the routines database for the source namespace
        Set tSC = ##class(Config.Namespaces).Get(pNamespace, .tNSProps)
        If $$$ISERR(tSC) Quit
        Set tDatabase = tNSProps("Routines")

        ; Check if mapping already exists
        If ##class(Config.MapPackages).Exists("%ALL", "ExecuteMCPv2") {
            ; Already mapped: nothing was created here, so only a "found" is recorded
            Kill tExistingProps
            Set tExistingDB = ""
            If $$$ISOK(##class(Config.MapPackages).Get("%ALL", "ExecuteMCPv2", .tExistingProps)) Set tExistingDB = $Get(tExistingProps("Database"))
            Do ..WriteRecord(pNamespace, "all", "found")
            Do ..WriteRecord(pNamespace, "mapping", "found", tExistingDB)
            Quit  ; Already mapped
        }

        ; Inside a transaction (an IPM install), keep %ALL, the mapping and their record out of its rollback
        If $TLevel > 0 {
            Set tPreviousSuspended = ##class(%SYSTEM.Process).TransactionsSuspended(1)
            Set tSuspendedHere = 1
        }

        ; %ALL is a virtual namespace that must exist before creating mappings.
        ; Create it if it doesn't exist yet (uses same databases as %SYS).
        If '##class(Config.Namespaces).Exists("%ALL") {
            Kill tALLProps
            Set tALLProps("Globals") = "%DEFAULTDB"
            Set tALLProps("Routines") = "%DEFAULTDB"
            Set tALLProps("Library") = "IRISLIB"
            Set tALLProps("TempGlobals") = "IRISTEMP"
            Set tSC = ##class(Config.Namespaces).Create("%ALL", .tALLProps)
            If $$$ISERR(tSC) Quit
            Do ..WriteRecord(pNamespace, "all", "created")
        } Else {
            Do ..WriteRecord(pNamespace, "all", "found")
        }

        ; Now create the package mapping: ExecuteMCPv2 -> source database in %ALL
        Kill tMapProps
        Set tMapProps("Database") = tDatabase
        Set tSC = ##class(Config.MapPackages).Create("%ALL", "ExecuteMCPv2", .tMapProps)
        If $$$ISOK(tSC) Do ..WriteRecord(pNamespace, "mapping", "created", tDatabase)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    ; Restore the suspension state this call found, on every path, before the method returns
    If tSuspendedHere Do ##class(%SYSTEM.Process).TransactionsSuspended(tPreviousSuspended)
    Quit tSC
}

/// Check whether the <code>/api/executemcp/v2</code> web application exists.
/// <p>Returns 1 if registered, 0 if not. An account that cannot read the application's
/// definition in <code>%SYS</code> gets the answer from <method>WebAppRegistered</method>
/// instead of 0: one that cannot switch to <code>%SYS</code> (the switch throws), and one that
/// can but may not read <code>Security.Applications</code> (<code>Exists</code> then returns 0
/// with an access-denied status instead of throwing). The fallback runs in the caller's
/// namespace.</p>
ClassMethod IsConfigured() As %Boolean [ SqlProc ]
{
    Set tResult = 0
    Set tOrigNS = $NAMESPACE
    Try {
        New $NAMESPACE
        Set $NAMESPACE = "%SYS"
        Set tResult = +##class(Security.Applications).Exists(..#WEBAPP)
        Set $NAMESPACE = tOrigNS
    } Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tResult = 0
    }
    If 'tResult Set tResult = ..WebAppRegistered()
    Quit tResult
}

/// Whether the CSP application lookup finds the <code>/api/executemcp/v2</code> web
/// application. The lookup needs no privilege on <code>%SYS</code>, so it answers for an
/// account that cannot read <code>Security.Applications</code>. Returns 0 when the lookup fails.
ClassMethod WebAppRegistered() As %Boolean
{
    Set tResult = 0
    Try {
        Set tResult = ($System.CSP.GetAppName(..#WEBAPP _ "/") = (..#WEBAPP _ "/"))
    } Catch ex {
        Set tResult = 0
    }
    Quit tResult
}

/// Ensure <code>^UnitTestRoot</code> is defined in the current namespace.
/// <p>InterSystems <class>%UnitTest.Manager</class>.RunTest requires this global
/// to be defined and non-empty. The Atelier <code>/work</code> endpoint with
/// <code>request: "unittest"</code> (which the <code>iris_execute_tests</code> tool
/// uses) sets the <code>/noload</code> qualifier internally, which means the
/// path value does not need to point to a real directory — but the global must
/// still exist. When undefined, RunTest fails at an internal "Finding
/// directories" step and writes a partial result that crashes the response
/// serializer (<code>%Api.Atelier.v8::UnitTestResultToJSON</code>) with a
/// cryptic <code>&lt;SUBSCRIPT&gt;</code> error.</p>
/// <p>This method is idempotent — it sets <code>^UnitTestRoot</code> only when
/// undefined or empty. The chosen value is <code>$System.Util.ManagerDirectory()</code>,
/// which is always a real directory on the IRIS install and therefore safe even
/// if a future IRIS version starts validating the path.</p>
/// <p>The bootstrap calls this method via the Atelier SQL endpoint after the
/// REST classes are deployed and the web application is configured. It is wrapped
/// in its own try/catch on the client side so a failure here (e.g., insufficient
/// privileges) does not abort the rest of the bootstrap.</p>
/// <p>Returns the current value of <code>^UnitTestRoot</code> after the
/// idempotent set, so the caller can verify the global was successfully
/// populated.</p>
ClassMethod EnsureUnitTestRoot() As %String [ SqlProc ]
{
    If $Get(^UnitTestRoot) = "" {
        Set ^UnitTestRoot = $System.Util.ManagerDirectory()
        ; Only a value this call set is recorded, so the uninstall never removes a pre-existing one
        Do ..WriteRecord($NAMESPACE, "unitTestRoot", ^UnitTestRoot)
    }
    Quit ^UnitTestRoot
}

/// Return the bootstrap version marker baked into this class at embed time.
/// <p>The auto-bootstrap flow calls this via the Atelier SQL endpoint to
/// order the classes deployed on IRIS against the classes embedded in the
/// currently-running MCP server. An older deployment triggers an automatic
/// redeploy of every embedded class; a newer or foreign one is left in
/// place.</p>
/// <p>If this method does not exist on the deployed Setup class (because
/// the user is running an older version that predates the version-stamp
/// mechanism), the SQL query throws and the bootstrap treats the
/// deployment as "missing", triggering a full bootstrap. This is the
/// one-shot upgrade path from pre-version-stamp deployments.</p>
ClassMethod GetBootstrapVersion() As %String [ SqlProc ]
{
    Quit ..#BOOTSTRAPVERSION
}

}
