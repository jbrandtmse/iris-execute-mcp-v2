/// Unit tests for the Story 39.2 additions to <class>ExecuteMCPv2.REST.MessageSearch</class> and
/// <class>ExecuteMCPv2.REST.MessageResend</class>. Data-free: nothing here reads or writes a message
/// header.
/// <p><method>TestBodyKindEveryKind</method> pins <method>ExecuteMCPv2.REST.MessageSearch.BodyKind</method>,
/// the one classifier the PHI data policy relies on, for a class of every kind.</p>
/// <p><method>TestBodyAvailable</method> and <method>TestHl7TextUnreadable</method> pin the unavailable and
/// unreadable outcomes of <method>ExecuteMCPv2.REST.MessageResend:BodyAvailable</method> and
/// <method>ExecuteMCPv2.REST.MessageSearch:Hl7Text</method>, which the policy maps to <code>none</code>.</p>
/// <p><method>TestHttpPreviewBodyDetailRefusals</method> drives the refusals of the
/// <code>POST /interop/message/resend/preview</code> route's optional <code>bodyDetail</code> and
/// <code>bodyTextMaxChars</code> over real HTTP (<code>%Net.HttpRequest</code>, the pattern of
/// <class>ExecuteMCPv2.Tests.MessageSearchTest</class>). Each refusal names the parameter, never echoes
/// the value sent, and is decided before the handler switches namespace, so no header data is involved.</p>
Class ExecuteMCPv2.Tests.MessagePreviewPolicyTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// ==================== BodyKind ====================

/// A class of every kind, in the classifier's own order. <code>EnsLib.HTTP.GenericMessage</code> extends
/// <class>Ens.StreamContainer</class>, and <class>%Library.DynamicObject</class> is the <code>other</code>
/// kind.
Method TestBodyKindEveryKind()
{
    Do ..AssertKind("", "literal")
    Do ..AssertKind("No.Such.Story392Class", "missing")
    Do ..AssertKind("EnsLib.HL7.Message", "hl7v2")
    Do ..AssertKind("EnsLib.EDI.XML.Document", "xmlvdoc")
    Do ..AssertKind("EnsLib.EDI.X12.Document", "vdoc")
    Do ..AssertKind("%Stream.GlobalCharacter", "stream")
    Do ..AssertKind("Ens.StreamContainer", "streamContainer")
    Do ..AssertKind("EnsLib.HTTP.GenericMessage", "streamContainer")
    Do ..AssertKind("Ens.StringRequest", "persistent")
    Do ..AssertKind("Ens.StringContainer", "persistent")
    Do ..AssertKind("%Library.DynamicObject", "other")
}

/// Assert the kind <var>pExpected</var> for the class <var>pClass</var>.
Method AssertKind(pClass As %String, pExpected As %String)
{
    Set tKind = ##class(ExecuteMCPv2.REST.MessageSearch).BodyKind(pClass)
    Do $$$AssertEquals(tKind, pExpected, "BodyKind of '" _ pClass _ "' is " _ pExpected)
}

/// ==================== BodyAvailable ====================

/// A body is available only when its class is compiled and its ID opens. No header or body is read: the
/// IDs used cannot name a stored object.
Method TestBodyAvailable()
{
    Set tNoSuchId = -1
    Do ..AssertAvailable("Ens.StringRequest", tNoSuchId, 1, 0, "a body whose ID does not open")
    Do ..AssertAvailable("Ens.StringRequest", "NoSuchStory392Id", 1, 0, "a body whose ID is not an ID at all")
    Do ..AssertAvailable("Ens.StringRequest", "", 1, 0, "an empty body ID")
    Do ..AssertAvailable("", tNoSuchId, 0, 0, "an empty class")
    Do ..AssertAvailable("No.Such.Story392Class", "1", 0, 0, "a class that is not compiled")
    Do ..AssertAvailable("No.Such.Story392Class", "1", 1, 0, "a class whose open throws")
}

/// Assert the availability <var>pExpected</var> of the body (<var>pClass</var>, <var>pId</var>), where
/// <var>pClassExists</var> is the flag the preview passes.
Method AssertAvailable(pClass As %String, pId As %String, pClassExists As %Boolean, pExpected As %Boolean, pLabel As %String)
{
    Set tAvailable = ##class(ExecuteMCPv2.REST.MessageResend).BodyAvailable(pClass, pId, pClassExists)
    Do $$$AssertEquals(tAvailable, pExpected, pLabel _ ": BodyAvailable is " _ pExpected)
}

/// ==================== Hl7Text ====================

/// An HL7 text that cannot be read gives the fixed token <code>unreadable</code> and an empty text, and
/// never exception text: a class that does not exist throws inside the method, and an ID that does not
/// open returns no object.
Method TestHl7TextUnreadable()
{
    Set tResult = ##class(ExecuteMCPv2.REST.MessageSearch).Hl7Text("No.Such.Story392Class", "1", 1000, .tText)
    Do $$$AssertEquals(tResult, "unreadable", "a class that does not exist gives the fixed token, not exception text")
    Do $$$AssertEquals(tText, "", "and no text")

    Set tResult = ##class(ExecuteMCPv2.REST.MessageSearch).Hl7Text("EnsLib.HL7.Message", "NoSuchStory392Id", 1000, .tText)
    Do $$$AssertEquals(tResult, "unreadable", "an HL7 body whose ID does not open gives the fixed token")
    Do $$$AssertEquals(tText, "", "and no text")

    Set tResult = ##class(ExecuteMCPv2.REST.MessageSearch).Hl7Text("", "", 1000, .tText)
    Do $$$AssertEquals(tResult, "unreadable", "an empty class gives the fixed token")
    Do $$$AssertEquals(tText, "", "and no text")
}

/// ==================== The preview route's refusals over real HTTP ====================

/// Resolve the local web server port (mirrors MessageSearchTest); override via
/// <code>^UnitTestConfig("MessagePreviewPolicy",...)</code>.
Method ResolvePort() As %Integer
{
    Set tPort = +$Get(^UnitTestConfig("MessagePreviewPolicy", "Port"))
    If tPort > 0 Quit tPort
    Set tPort = 52773
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tSC = ##class(Config.Startup).Get(.tProps)
        Set $NAMESPACE = tOrigNS
        If $$$ISOK(tSC) && (+$Get(tProps("WebServerPort")) > 0) { Set tPort = +tProps("WebServerPort") }
    } Catch ex {
        Set $NAMESPACE = tOrigNS
    }
    Quit tPort
}

/// POST a JSON body to the preview route; returns the HTTP status and the parsed envelope.
Method PostPreview(pBody As %DynamicObject, Output pHttpStatus As %Integer, Output pEnvelope As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pHttpStatus = 0
    Set pEnvelope = ""
    Try {
        Set tRequest = ##class(%Net.HttpRequest).%New()
        Set tRequest.Server = "127.0.0.1"
        Set tRequest.Port = ..ResolvePort()
        Set tRequest.Https = 0
        Set tRequest.Username = $Get(^UnitTestConfig("MessagePreviewPolicy", "Username"), "_SYSTEM")
        Set tRequest.Password = $Get(^UnitTestConfig("MessagePreviewPolicy", "Password"), "SYS")
        Set tRequest.Timeout = 60
        Set tRequest.ContentType = "application/json"
        Do tRequest.EntityBody.Write(pBody.%ToJSON())
        Set tSC = tRequest.Post("/api/executemcp/v2/interop/message/resend/preview")
        If $$$ISERR(tSC) Quit
        Set pHttpStatus = tRequest.HttpResponse.StatusCode
        Set pEnvelope = ##class(%DynamicObject).%FromJSON(tRequest.HttpResponse.Data)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// A request body that is valid but for what a row changes: one header ID, aimed at a namespace that
/// does not exist, so a guard that stopped refusing fails on the namespace switch instead of reading
/// this namespace's headers.
Method ValidBody() As %DynamicObject
{
    Set tBody = {}
    Do tBody.%Set("headerIds", [1])
    Do tBody.%Set("namespace", "EXECMCPTMP392Z")
    Quit tBody
}

/// POST <var>pBody</var> and assert the refusal: HTTP 200 with an envelope, at least one error whose text
/// contains <var>pToken</var> and does not contain <var>pHostile</var>, and an empty result.
Method AssertRefused(pBody As %DynamicObject, pToken As %String, pHostile As %String, pLabel As %String)
{
    Set tSC = ..PostPreview(pBody, .tHttp, .tEnv)
    Do $$$AssertStatusOK(tSC, pLabel _ ": HTTP round trip and envelope parse")
    If $$$ISERR(tSC) Quit
    Do $$$AssertEquals(tHttp, 200, pLabel _ ": a refusal is an HTTP 200 envelope")
    Set tErrors = tEnv.%Get("status").%Get("errors")
    Do $$$AssertTrue(tErrors.%Size() >= 1, pLabel _ ": the envelope carries an error")
    If tErrors.%Size() < 1 Quit
    Set tText = tErrors.%Get(0).%Get("error")
    Do $$$AssertTrue(tText [ pToken, pLabel _ ": the error names '" _ pToken _ "' (got: " _ tText _ ")")
    If pHostile '= "" {
        Do $$$AssertTrue(tText '[ pHostile, pLabel _ ": the error does not echo the value sent")
    }
    Set tIter = tEnv.%Get("result").%GetIterator()
    Do $$$AssertTrue('tIter.%GetNext(.tKey, .tValue), pLabel _ ": the result is empty")
}

/// Every refusal of the optional preview fields: the text names the parameter and never the value, and
/// the namespace that does not exist is never reached.
Method TestHttpPreviewBodyDetailRefusals()
{
    Set tHostile = "ZZhostile'--OR 1=1"

    Set tBody = ..ValidBody()
    Do tBody.%Set("bodyDetail", "raw")
    Do ..AssertRefused(tBody, "bodyDetail", "raw", "bodyDetail raw")

    Set tBody = ..ValidBody()
    Do tBody.%Set("bodyDetail", tHostile)
    Do ..AssertRefused(tBody, "bodyDetail", tHostile, "bodyDetail hostile")

    Set tBody = ..ValidBody()
    Do tBody.%Set("bodyDetail", "")
    Do ..AssertRefused(tBody, "bodyDetail", "", "bodyDetail empty")

    Set tBody = ..ValidBody()
    Do tBody.%Set("bodyDetail", 5, "number")
    Do ..AssertRefused(tBody, "bodyDetail", "", "bodyDetail that is not a string")

    Set tBody = ..ValidBody()
    Do tBody.%Set("bodyDetail", "text")
    Do tBody.%Set("bodyTextMaxChars", 0, "number")
    Do ..AssertRefused(tBody, "bodyTextMaxChars", "", "bodyTextMaxChars 0")

    Set tBody = ..ValidBody()
    Do tBody.%Set("bodyDetail", "text")
    Do tBody.%Set("bodyTextMaxChars", 1048577, "number")
    Do ..AssertRefused(tBody, "bodyTextMaxChars", "1048577", "bodyTextMaxChars 1048577")

    Set tBody = ..ValidBody()
    Do tBody.%Set("bodyDetail", "text")
    Do tBody.%Set("bodyTextMaxChars", "x")
    Do ..AssertRefused(tBody, "bodyTextMaxChars", "'x'", "bodyTextMaxChars x")

    Set tBody = ..ValidBody()
    Do tBody.%Set("bodyDetail", "text")
    Do tBody.%Set("bodyTextMaxChars", tHostile)
    Do ..AssertRefused(tBody, "bodyTextMaxChars", tHostile, "bodyTextMaxChars hostile")

    Set tBody = ..ValidBody()
    Do tBody.%Set("bodyTextMaxChars", 2.5, "number")
    Do ..AssertRefused(tBody, "bodyTextMaxChars", "", "bodyTextMaxChars 2.5 without bodyDetail")
}

}
