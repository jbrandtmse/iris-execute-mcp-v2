/// Regression coverage for Story 35.5 — <method>ExecuteMCPv2.REST.Security:OAuthManage</method>'s
/// client-create precondition validation and discover SSL guidance.
/// <p><b>Why this class exists (Rule #59).</b> The 35.5 behavior change is entirely
/// ObjectScript, but the TypeScript suites mock the HTTP layer and hand-write the very
/// response fields under test — they stay green if the validation is deleted from
/// <class>ExecuteMCPv2.REST.Security</class> outright. This class drives the DEPLOYED
/// <code>/api/executemcp/v2/security/oauth</code> route with <class>%Net.HttpRequest</class>
/// (mirroring <class>ExecuteMCPv2.Tests.SqlPrivilegeBoundTest</class>) so the guards are
/// exercised on the path they actually guard.</p>
/// <p><b>What is pinned.</b> (a) client-create with a never-discovered
/// <code>serverName</code> yields the clean precondition error naming the discover-first and
/// SSL/TLS prerequisite chain — never a raw <code>&lt;PARAMETER&gt;</code> (the pre-fix
/// behavior: <code>%SYS.OAuth2.Registration.RegisterClient</code> is 1-arg on this instance,
/// so the old 2-arg call died on arity before any lookup). (b) https discover with no
/// <code>sslConfiguration</code> yields actionable SSL guidance, not the bare native
/// ERROR #6159. (c) with a fixture <class>OAuth2.ServerDefinition</class> present, the
/// client record is created and the flow reaches the CLEAN
/// <code>OAuth2NoRegistrationEndpoint</code>-class error (the fixture issuer publishes no
/// registration endpoint), again never <code>&lt;PARAMETER&gt;</code>. (d) client delete
/// (AC 35.5.6) works through the route via <code>OAuth2.Client.DeleteId</code> — the
/// pre-fix call to the nonexistent <code>OAuth2.Client.Delete</code> threw
/// <code>&lt;METHOD DOES NOT EXIST&gt;</code> — and a nonexistent name yields a clean
/// not-found.</p>
/// <p><b>What is deliberately NOT pinned here.</b> The discover SUCCESS leg needs outbound
/// internet; it was proven live during the story (curl capture in the story record) but is
/// not automated — a test that depends on external reachability cannot fail for the right
/// reason (Rule #59).</p>
/// <p><b>Fixtures are disposable OAuth2 rows</b> and are removed in BOTH
/// <method>OnBeforeOneTest</method> and <method>OnAfterOneTest</method> — teardown is not
/// guaranteed to run, so setup-side cleanup makes every test order-independent and
/// self-healing after a killed run. The fixture SSL configuration name is a placeholder:
/// nothing in the pinned flows dereferences it (registration fails fast on the missing
/// registration endpoint before any HTTP), so the class travels to instances without the
/// dev box's real configuration.</p>
Class ExecuteMCPv2.Tests.OAuthClientValidationTest Extends %UnitTest.TestCase
{

Parameter FIXTUREISSUER = "https://story355-fixture-issuer.example.com";

Parameter FIXTURECLIENT = "Story355FixtureClient";

Parameter UNKNOWNISSUER = "https://never-discovered-3555.example.com";

Parameter SSLPLACEHOLDER = "Story355SSLPlaceholder";

/// Remove any fixture left behind by an aborted run, then build the fixture fresh.
/// Propagate fixture setup failures so they surface as the CAUSE, not as confusing
/// downstream assertion failures.
Method OnBeforeOneTest() As %Status
{
    Set tSC = ..DropFixture()
    If $$$ISOK(tSC) Set tSC = ..BuildFixture()
    Quit tSC
}

Method OnAfterOneTest() As %Status
{
    Quit ..DropFixture()
}

/// A throwaway OAuth2.ServerDefinition keyed by FIXTUREISSUER. The Metadata
/// authorization/token endpoints are Required for %Save (ERROR #8875 otherwise);
/// no registration_endpoint is set ON PURPOSE — that is what makes the pinned
/// registration failure the clean OAuth2NoRegistrationEndpoint class.
Method BuildFixture() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tSD = ##class(OAuth2.ServerDefinition).%New()
        Set tSD.IssuerEndpoint = ..#FIXTUREISSUER
        Set tSD.SSLConfiguration = ..#SSLPLACEHOLDER
        Set tSD.AuthorizationEndpoint = ..#FIXTUREISSUER _ "/authorize"
        Set tSD.TokenEndpoint = ..#FIXTUREISSUER _ "/token"
        Set tSC = tSD.%Save()
        Set $NAMESPACE = tOrigNS
        Quit
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

Method DropFixture() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        ; Every client name any test in this class might persist — including the
        ; names designed NEVER to save (a validation-order regression would leave
        ; them behind, and self-healing must cover exactly that case).
        For tClientName = ..#FIXTURECLIENT, "Story355BadType", "Story355NeverCreated", "Story355NeverExisted", "Story355BadRedirect" {
            If ##class(OAuth2.Client).%ExistsId(tClientName) {
                Do ##class(OAuth2.Client).DeleteId(tClientName)
            }
        }
        For tIssuer = ..#FIXTUREISSUER, ..#UNKNOWNISSUER {
            Set tOpenSC = $$$OK
            Set tSD = ##class(OAuth2.ServerDefinition).OpenByIssuer(tIssuer, .tOpenSC)
            If $$$ISOK(tOpenSC) && $IsObject(tSD) {
                Do ##class(OAuth2.ServerDefinition).DeleteId(tSD.%Id())
            }
        }
        Set $NAMESPACE = tOrigNS
        Quit
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

Method ResolvePort() As %Integer
{
    Set tPort = +$Get(^UnitTestConfig("OAuth", "Port"))
    If tPort > 0 Quit tPort
    Set tPort = 52773
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Config.Startup).Get(.tProps)
        If $$$ISOK(tSC) && (+$Get(tProps("WebServerPort")) > 0) { Set tPort = +tProps("WebServerPort") }
        Set $NAMESPACE = tOrigNS
        Quit
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
    }
    Quit tPort
}

/// POST a body to the deployed oauth route; returns the response envelope object.
Method PostOAuth(pBody As %DynamicObject) As %DynamicObject
{
    Set tResult = ""
    Try {
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Username = $Get(^UnitTestConfig("OAuth", "Username"), "_SYSTEM")
        Set tRequest.Password = $Get(^UnitTestConfig("OAuth", "Password"), "SYS")
        Set tRequest.Timeout = 120
        Set tRequest.ContentType = "application/json"
        Do tRequest.EntityBody.Write(pBody.%ToJSON())
        Set tSC = tRequest.Post("/api/executemcp/v2/security/oauth")
        If $$$ISERR(tSC) Quit
        Set tResult = ##class(%DynamicObject).%FromJSON(tRequest.HttpResponse.Data)
        Quit
    }
    Catch ex {
        Set tResult = ""
    }
    Quit tResult
}

/// First error text from an envelope's status.errors array ("" when none).
Method FirstErrorText(pEnvelope As %DynamicObject) As %String
{
    If '$IsObject(pEnvelope) Quit ""
    Set tStatus = pEnvelope.%Get("status")
    If '$IsObject(tStatus) Quit ""
    Set tErrors = tStatus.%Get("errors")
    If '$IsObject(tErrors) || (tErrors.%Size() = 0) Quit ""
    Quit tErrors.%Get(0).%Get("error")
}

/// AC 35.5.1 — client-create against a never-discovered issuer must name the real
/// precondition chain (discover first; discover of an https issuer needs an SSL/TLS
/// configuration) instead of the pre-fix raw <PARAMETER> arity error.
Method TestClientCreateUnknownIssuerGivesPreconditionError()
{
    Set tBody = {"action":"create","entity":"client"}
    Do tBody.%Set("serverName", ..#UNKNOWNISSUER)
    Do tBody.%Set("clientName", "Story355NeverCreated")
    Set tEnvelope = ..PostOAuth(tBody)
    Do $$$AssertTrue($IsObject(tEnvelope), "route returned a parseable envelope")
    Set tErr = ..FirstErrorText(tEnvelope)
    Do $$$AssertTrue(tErr [ "No OAuth2 server definition exists", "error names the missing server definition (got: "_tErr_")")
    Do $$$AssertTrue(tErr [ "discover", "error names the discover-first precondition")
    Do $$$AssertTrue(tErr [ "iris_ssl_manage", "error names the SSL/TLS prerequisite path")
    Do $$$AssertTrue(tErr '[ "<PARAMETER>", "no raw ObjectScript <PARAMETER> reaches the wire")
}

/// AC 35.5.2 — https discover with no sslConfiguration is validated BEFORE delegating
/// and returns actionable guidance, not the bare native ERROR #6159.
Method TestHttpsDiscoverWithoutSslConfigGivesActionableError()
{
    Set tBody = {"action":"discover","issuerURL":"https://accounts.google.com"}
    Set tEnvelope = ..PostOAuth(tBody)
    Do $$$AssertTrue($IsObject(tEnvelope), "route returned a parseable envelope")
    Set tErr = ..FirstErrorText(tEnvelope)
    Do $$$AssertTrue(tErr [ "SSL/TLS client configuration", "error names the SSL/TLS prerequisite (got: "_tErr_")")
    Do $$$AssertTrue(tErr [ "sslConfiguration", "error names the parameter to pass")
    Do $$$AssertTrue(tErr [ "iris_ssl_manage", "error names the tool that creates the configuration")
    Do $$$AssertTrue(tErr '[ "<PARAMETER>", "no raw ObjectScript <PARAMETER> reaches the wire")
}

/// AC 35.5.1/35.5.5 — with a discovered (fixture) server definition present, the flow
/// creates the OAuth2.Client record and reaches the CLEAN no-registration-endpoint
/// error (the fixture issuer publishes none) — never <PARAMETER>. The record stays
/// saved, matching the Management Portal's configure-then-register semantics.
/// This leg also drives the JSON-ARRAY forms of redirectURIs and grantTypes (the
/// string forms are covered by the other legs) and asserts the saved record's
/// content — the grant_types $list on Metadata and the parsed RedirectionEndpoint —
/// so those new code paths are proven on the wire, not assumed.
Method TestFixtureBackedClientCreateReachesCleanRegistrationError()
{
    Set tBody = {"action":"create","entity":"client"}
    Do tBody.%Set("serverName", ..#FIXTUREISSUER)
    Do tBody.%Set("clientName", ..#FIXTURECLIENT)
    Set tRedirects = ##class(%DynamicArray).%New()
    Do tRedirects.%Push("http://localhost:52773/csp/sys/oauth2/OAuth2.Response.cls")
    Do tBody.%Set("redirectURIs", tRedirects)
    Set tGrants = ##class(%DynamicArray).%New()
    Do tGrants.%Push("authorization_code")
    Do tGrants.%Push("refresh_token")
    Do tBody.%Set("grantTypes", tGrants)
    Set tEnvelope = ..PostOAuth(tBody)
    Do $$$AssertTrue($IsObject(tEnvelope), "route returned a parseable envelope")
    Set tErr = ..FirstErrorText(tEnvelope)
    Do $$$AssertTrue(tErr [ "registration endpoint", "error is the clean OAuth2NoRegistrationEndpoint class (got: "_tErr_")")
    Do $$$AssertTrue(tErr [ "remains saved", "error states the local record was kept")
    Do $$$AssertTrue(tErr '[ "<PARAMETER>", "no raw ObjectScript <PARAMETER> reaches the wire")

    ; The client record must exist (created before registration was attempted),
    ; with the array-form inputs materialized onto it
    Set tExists = 0
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tExists = ##class(OAuth2.Client).%ExistsId(..#FIXTURECLIENT)
        If tExists {
            Set tOpenSC = $$$OK
            Set tClient = ##class(OAuth2.Client).Open(..#FIXTURECLIENT, .tOpenSC)
            If $$$ISOK(tOpenSC) && $IsObject(tClient) {
                Do $$$AssertEquals(tClient.RedirectionEndpoint.Host, "localhost", "array-form redirectURIs[0] parsed onto RedirectionEndpoint.Host")
                Do $$$AssertEquals(+tClient.RedirectionEndpoint.UseSSL, 0, "http redirect URI yields UseSSL=0")
                Do $$$AssertTrue($ListFind(tClient.Metadata."grant_types", "authorization_code") > 0, "grant_types $list carries authorization_code")
                Do $$$AssertTrue($ListFind(tClient.Metadata."grant_types", "refresh_token") > 0, "grant_types $list carries refresh_token")
            } Else {
                Do $$$AssertTrue(0, "client record opened for content assertions (status: "_$System.Status.GetErrorText(tOpenSC)_")")
            }
        }
        Set $NAMESPACE = tOrigNS
        Quit
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
    }
    Do $$$AssertTrue(tExists, "the OAuth2.Client record was created and remains saved")
}

/// QA addition (Story 35.5 review) — a degenerate input named in the story's
/// Previous-story-intelligence: an invalid clientType must surface the clean IRIS
/// VALUELIST validation error (never <PARAMETER>), and the failed %Save must leave
/// NO client record behind.
Method TestInvalidClientTypeGivesCleanValidationError()
{
    Set tBody = {"action":"create","entity":"client"}
    Do tBody.%Set("serverName", ..#FIXTUREISSUER)
    Do tBody.%Set("clientName", "Story355BadType")
    Do tBody.%Set("clientType", "bogus")
    Do tBody.%Set("redirectURIs", "http://localhost:52773/csp/sys/oauth2/OAuth2.Response.cls")
    Set tEnvelope = ..PostOAuth(tBody)
    Do $$$AssertTrue($IsObject(tEnvelope), "route returned a parseable envelope")
    Set tErr = ..FirstErrorText(tEnvelope)
    Do $$$AssertTrue(tErr [ "VALUELIST", "error is the clean ClientType VALUELIST validation (got: "_tErr_")")
    Do $$$AssertTrue(tErr '[ "<PARAMETER>", "no raw ObjectScript <PARAMETER> reaches the wire")

    ; The rejected record must not persist
    Set tExists = 1
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tExists = ##class(OAuth2.Client).%ExistsId("Story355BadType")
        Set $NAMESPACE = tOrigNS
        Quit
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
    }
    Do $$$AssertTrue('tExists, "no client record persists after the rejected %Save")
}

/// Review addition (Story 35.5 code review) — a supplied-but-malformed redirectURI
/// must be named as malformed (QA/review found it misreported as the misleading
/// "RedirectionEndpoint required" because %Net.URLParser.Decompose yields an empty
/// host on garbage without ever erroring). No record may persist.
Method TestMalformedRedirectUriGivesCleanError()
{
    Set tBody = {"action":"create","entity":"client"}
    Do tBody.%Set("serverName", ..#FIXTUREISSUER)
    Do tBody.%Set("clientName", "Story355BadRedirect")
    Do tBody.%Set("redirectURIs", "not a url at all")
    Set tEnvelope = ..PostOAuth(tBody)
    Do $$$AssertTrue($IsObject(tEnvelope), "route returned a parseable envelope")
    Set tErr = ..FirstErrorText(tEnvelope)
    Do $$$AssertTrue(tErr [ "not a parseable absolute URL", "malformed redirectURI is named as malformed (got: "_tErr_")")
    Do $$$AssertTrue(tErr '[ "<PARAMETER>", "no raw ObjectScript <PARAMETER> reaches the wire")

    ; The rejected record must not persist
    Set tExists = 1
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tExists = ##class(OAuth2.Client).%ExistsId("Story355BadRedirect")
        Set $NAMESPACE = tOrigNS
        Quit
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
    }
    Do $$$AssertTrue('tExists, "no client record persists after the rejected redirectURI")
}

/// AC 35.5.6 — client delete goes through OAuth2.Client.DeleteId (the only delete the
/// class has; the pre-fix call to a nonexistent OAuth2.Client.Delete threw
/// <METHOD DOES NOT EXIST>). A fixture client created via the route is deleted via the
/// route and verified gone; a nonexistent name yields a clean not-found error.
Method TestClientDeleteWorksAndNotFoundIsClean()
{
    ; Create the fixture client through the route (registration fails cleanly with no
    ; registration endpoint — the record remains saved, which is what this leg needs)
    Set tCreate = {"action":"create","entity":"client"}
    Do tCreate.%Set("serverName", ..#FIXTUREISSUER)
    Do tCreate.%Set("clientName", ..#FIXTURECLIENT)
    Do tCreate.%Set("redirectURIs", "http://localhost:52773/csp/sys/oauth2/OAuth2.Response.cls")
    Do ..PostOAuth(tCreate)

    ; Delete it through the route
    Set tDelete = {"action":"delete","entity":"client"}
    Do tDelete.%Set("name", ..#FIXTURECLIENT)
    Set tEnvelope = ..PostOAuth(tDelete)
    Do $$$AssertTrue($IsObject(tEnvelope), "delete returned a parseable envelope")
    Set tErr = ..FirstErrorText(tEnvelope)
    Do $$$AssertEquals(tErr, "", "delete of an existing client succeeds (got: "_tErr_")")
    Do $$$AssertTrue(tErr '[ "<METHOD DOES NOT EXIST>", "no <METHOD DOES NOT EXIST> on the wire")
    If $IsObject(tEnvelope) {
        Set tRes = tEnvelope.%Get("result")
        Do $$$AssertEquals(tRes.%Get("action"), "deleted", "result action is 'deleted'")
        Do $$$AssertEquals(tRes.%Get("name"), ..#FIXTURECLIENT, "result names the deleted client")
    }

    ; Verified gone in %SYS
    Set tExists = 1
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tExists = ##class(OAuth2.Client).%ExistsId(..#FIXTURECLIENT)
        Set $NAMESPACE = tOrigNS
        Quit
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
    }
    Do $$$AssertTrue('tExists, "the client record is gone after route delete")

    ; Deleting a nonexistent name is a clean not-found, never <METHOD DOES NOT EXIST>
    Set tDelete2 = {"action":"delete","entity":"client"}
    Do tDelete2.%Set("name", "Story355NeverExisted")
    Set tEnvelope2 = ..PostOAuth(tDelete2)
    Set tErr2 = ..FirstErrorText(tEnvelope2)
    Do $$$AssertTrue(tErr2 [ "No OAuth2 client named", "nonexistent client delete names the not-found (got: "_tErr2_")")
    Do $$$AssertTrue(tErr2 '[ "<METHOD DOES NOT EXIST>", "no <METHOD DOES NOT EXIST> on the wire")
}

}
