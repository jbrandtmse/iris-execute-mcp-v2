/// REST handler for the Interoperability message body reader (Story 39.5).
/// <p>Provides <method>MessageBody</method>, a read-only route that returns the body of 1 to
/// <parameter>MAXIDS</parameter> message headers, rendered by kind as text. The kinds are those of
/// <method>ExecuteMCPv2.REST.MessageSearch:BodyKind</method>:</p>
/// <ul>
/// <li><code>hl7v2</code>: the complete ER7 text, through
/// <method>ExecuteMCPv2.REST.MessageResend:SetBodyDetail</method>, or <code>tooLarge</code> /
/// <code>unreadable</code>. An HL7 v2 body is never cut, because a redaction engine needs it whole.</li>
/// <li><code>xmlvdoc</code>: the XML text. <code>persistent</code>: JSON, from <code>%JSONExportToStream</code>
/// when the class extends <class>%JSON.Adaptor</class>, otherwise a dump of its dictionary properties
/// (<method>PropertyDump</method>). <code>stream</code> and <code>streamContainer</code>: the stream text.
/// <code>literal</code> (an empty body class): the header's body ID. These are read as a prefix of
/// <code>bodyTextMaxChars</code> characters.</li>
/// <li><code>vdoc</code> and <code>other</code>: no renderer (<code>noRenderer</code>); <code>missing</code>:
/// not read.</li>
/// </ul>
/// <p>The request's <code>bodyRead</code> says which bodies IRIS may read at all, so that a body the caller
/// may not see never leaves IRIS: <code>kind</code> reads none, <code>hl7</code> reads only HL7 v2 bodies, and
/// <code>all</code> reads every kind above. The data policy is applied by the caller of this route (the MCP
/// tool); this class returns raw data and decides nothing about what is allowed.</p>
/// <p>Like <class>ExecuteMCPv2.REST.MessageResend</class>, the work runs in the <b>target namespace</b>.</p>
Class ExecuteMCPv2.REST.MessageBody Extends ExecuteMCPv2.REST.Base
{

/// The most header IDs one request may name.
Parameter MAXIDS As %Integer = 20;

/// Whether a request with <code>bodyRead</code> <var>pBodyRead</var> lets IRIS read the text of an available
/// body of kind <var>pKind</var>: <code>kind</code> reads none, <code>hl7</code> reads only
/// <code>hl7v2</code>, and <code>all</code> reads every kind except <code>missing</code> (a class that is not
/// compiled has no body to read).
ClassMethod ReadsText(pBodyRead As %String, pKind As %String) As %Boolean
{
    If pBodyRead = "hl7" Quit (pKind = "hl7v2")
    If pBodyRead = "all" Quit ($ListFind($ListBuild("hl7v2", "xmlvdoc", "vdoc", "stream", "streamContainer", "persistent", "literal", "other"), pKind) > 0)
    Quit 0
}

/// The first <var>pMaxChars</var> characters of <var>pText</var>. <var>pComplete</var> is 1 when that is the
/// whole text. A cut never ends inside a UTF-16 surrogate pair: a dangling high surrogate is dropped.
ClassMethod CutText(pText As %String, pMaxChars As %Integer, Output pComplete As %Boolean) As %String
{
    If $Length(pText) <= pMaxChars {
        Set pComplete = 1
        Quit pText
    }
    Set pComplete = 0
    Quit ..TrimSplitPair($Extract(pText, 1, pMaxChars))
}

/// <var>pText</var> without its last character when that is a high surrogate, the first half of a pair
/// that a cut separated from its second half (<method>ExecuteMCPv2.Utils:SurrogateSafeCutLength</method>).
ClassMethod TrimSplitPair(pText As %String) As %String
{
    Quit $Extract(pText, 1, ##class(ExecuteMCPv2.Utils).SurrogateSafeCutLength(pText, $Length(pText)))
}

/// Read the text of the stream <var>pStream</var> from its start, at most <var>pMaxChars</var> characters, into
/// <var>pText</var>. <var>pComplete</var> is 1 when the stream holds no more. Returns <code>""</code> on
/// success, or <code>unreadable</code> (empty <var>pText</var>) when the stream is not a stream or cannot be
/// read. Never throws.
ClassMethod ReadStreamText(pStream As %Stream.Object, pMaxChars As %Integer, Output pText As %String, Output pComplete As %Boolean) As %String
{
    Set pText = ""
    Set pComplete = 0
    Set tResult = "unreadable"
    Try {
        If '$IsObject(pStream) { Quit }
        Set tSC = pStream.Rewind()
        If $$$ISERR(tSC) { Quit }
        Set tText = ""
        Set tRemaining = pMaxChars
        While (tRemaining > 0) && 'pStream.AtEnd {
            Set tLen = $Select(tRemaining > 32000: 32000, 1: tRemaining)
            Set tChunk = pStream.Read(.tLen, .tSC)
            If $$$ISERR(tSC) { Quit }
            If tChunk = "" { Quit }
            Set tText = tText _ tChunk
            Set tRemaining = tRemaining - $Length(tChunk)
        }
        If $$$ISERR(tSC) { Quit }
        Set tComplete = 1
        If 'pStream.AtEnd {
            Set tLen = 1
            Set tMore = pStream.Read(.tLen, .tSC)
            If $$$ISERR(tSC) { Quit }
            Set tComplete = (tMore = "")
        }
        If 'tComplete { Set tText = ..TrimSplitPair(tText) }
        Set pText = tText
        Set pComplete = tComplete
        Set tResult = ""
    }
    Catch {
        Set pText = ""
        Set pComplete = 0
        Set tResult = "unreadable"
    }
    Quit tResult
}

/// Read the XML text of the <class>EnsLib.EDI.XML.Document</class> <var>pDoc</var> (its whole serialization,
/// then the first <var>pMaxChars</var> characters of it). Returns <code>""</code> or <code>unreadable</code>,
/// as <method>ReadStreamText</method> does.
ClassMethod XmlText(pDoc As %RegisteredObject, pMaxChars As %Integer, Output pText As %String, Output pComplete As %Boolean) As %String
{
    Set pText = ""
    Set pComplete = 0
    Set tResult = "unreadable"
    Try {
        Set tStream = ##class(%Stream.TmpCharacter).%New()
        Set tSC = pDoc.OutputToLibraryStream(tStream)
        If $$$ISERR(tSC) { Quit }
        Set tResult = ..ReadStreamText(tStream, pMaxChars, .pText, .pComplete)
    }
    Catch {
        Set pText = ""
        Set pComplete = 0
        Set tResult = "unreadable"
    }
    Quit tResult
}

/// Read the JSON text of the persistent object <var>pObj</var>: <code>%JSONExportToStream</code> when its class
/// extends <class>%JSON.Adaptor</class>, otherwise the <method>PropertyDump</method>. The whole text is built,
/// then its first <var>pMaxChars</var> characters are returned. Returns <code>""</code> or
/// <code>unreadable</code>, as <method>ReadStreamText</method> does.
ClassMethod JsonText(pObj As %RegisteredObject, pMaxChars As %Integer, Output pText As %String, Output pComplete As %Boolean) As %String
{
    Set pText = ""
    Set pComplete = 0
    Set tResult = "unreadable"
    Try {
        If pObj.%Extends("%JSON.Adaptor") {
            Set tStream = ##class(%Stream.TmpCharacter).%New()
            Set tSC = pObj.%JSONExportToStream(tStream)
            If $$$ISERR(tSC) { Quit }
            Set tResult = ..ReadStreamText(tStream, pMaxChars, .pText, .pComplete)
        }
        Else {
            Set tJson = ..PropertyDump(pObj).%ToJSON()
            Set pText = ..CutText(tJson, pMaxChars, .pComplete)
            Set tResult = ""
        }
    }
    Catch {
        Set pText = ""
        Set pComplete = 0
        Set tResult = "unreadable"
    }
    Quit tResult
}

/// A JSON object of the properties of <var>pObj</var>, from the compiled dictionary of its class, in
/// <code>SequenceNumber</code> then <code>Name</code> order. A property is left out when it is private, internal,
/// calculated, transient or multidimensional, or its name starts with <code>%</code>, or its value cannot be read.
/// Each value is:
/// <ul>
/// <li>a datatype: its logical value as a JSON string, <code>null</code> when it is empty;</li>
/// <li>a stream: <code>{"stream": class, "size": Size}</code>, never its content;</li>
/// <li>an object: <code>{"class": class, "id": %Id}</code> when it is persistent, <code>{"class": class}</code>
/// otherwise, and <code>null</code> when it is not set;</li>
/// <li>a list or array collection: <code>{"collection": "list"|"array", "count": Count()}</code>.</li>
/// </ul>
ClassMethod PropertyDump(pObj As %RegisteredObject) As %DynamicObject
{
    Set tOut = {}
    Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT Name, Collection, Private, Internal, Calculated, Transient, MultiDimensional FROM %Dictionary.CompiledProperty WHERE parent = ? ORDER BY SequenceNumber, Name", $ClassName(pObj))
    If '$IsObject(tRS) || (tRS.%SQLCODE < 0) Quit tOut
    While tRS.%Next() {
        Set tName = tRS.%Get("Name")
        If $Extract(tName) = "%" { Continue }
        If +tRS.%Get("Private") || +tRS.%Get("Internal") || +tRS.%Get("Calculated") || +tRS.%Get("Transient") || +tRS.%Get("MultiDimensional") { Continue }
        Set tCollection = tRS.%Get("Collection")
        Try {
            Set tValue = $Property(pObj, tName)
            If (tCollection = "list") || (tCollection = "array") {
                Set tEntry = {}
                Do tEntry.%Set("collection", tCollection, "string")
                Do tEntry.%Set("count", tValue.Count(), "number")
                Do tOut.%Set(tName, tEntry)
            }
            ElseIf $IsObject(tValue) {
                Set tEntry = {}
                If tValue.%Extends("%Stream.Object") {
                    Do tEntry.%Set("stream", $ClassName(tValue), "string")
                    Do tEntry.%Set("size", tValue.Size, "number")
                }
                ElseIf tValue.%Extends("%Library.Persistent") {
                    Do tEntry.%Set("class", $ClassName(tValue), "string")
                    Do tEntry.%Set("id", tValue.%Id(), "string")
                }
                Else {
                    Do tEntry.%Set("class", $ClassName(tValue), "string")
                }
                Do tOut.%Set(tName, tEntry)
            }
            ElseIf tValue = "" {
                Do tOut.%Set(tName, "", "null")
            }
            Else {
                Do tOut.%Set(tName, tValue, "string")
            }
        }
        Catch {
        }
    }
    Quit tOut
}

/// Render the text of one non-HL7 body of kind <var>pKind</var> from the opened object <var>pObj</var>, at most
/// <var>pMaxChars</var> characters, into <var>pText</var>; <var>pComplete</var> is 1 when that is the whole
/// text. Returns <code>""</code> when <var>pText</var> holds the text, or the token that says why it does not:
/// <code>noRenderer</code> (kinds <code>vdoc</code> and <code>other</code>, and any kind not listed below,
/// whatever <var>pObj</var> is) or <code>unreadable</code> (the object is missing or a read failed). The kinds
/// read are <code>xmlvdoc</code> (<method>XmlText</method>), <code>persistent</code> (<method>JsonText</method>),
/// <code>stream</code> and <code>streamContainer</code> (<method>ReadStreamText</method>). Never throws.
ClassMethod RenderText(pKind As %String, pObj As %RegisteredObject, pMaxChars As %Integer, Output pText As %String, Output pComplete As %Boolean) As %String
{
    Set pText = ""
    Set pComplete = 0
    Set tResult = "unreadable"
    Try {
        If $ListFind($ListBuild("xmlvdoc", "persistent", "stream", "streamContainer"), pKind) < 1 {
            Set tResult = "noRenderer"
            Quit
        }
        If '$IsObject(pObj) { Quit }
        If pKind = "xmlvdoc" { Set tResult = ..XmlText(pObj, pMaxChars, .pText, .pComplete) }
        ElseIf pKind = "persistent" { Set tResult = ..JsonText(pObj, pMaxChars, .pText, .pComplete) }
        ElseIf pKind = "stream" { Set tResult = ..ReadStreamText(pObj, pMaxChars, .pText, .pComplete) }
        Else { Set tResult = ..ReadStreamText(pObj.Stream, pMaxChars, .pText, .pComplete) }
    }
    Catch {
        Set pText = ""
        Set pComplete = 0
        Set tResult = "unreadable"
    }
    Quit tResult
}

/// Build the item for one header ID: <code>{id, found: false, error}</code> when the header does not exist or
/// cannot be queried, otherwise <code>{id, found, bodyClassName, bodyId, bodyKind, bodyAvailable}</code> plus
/// either <code>bodyText</code> and <code>bodyTextComplete</code>, or <code>bodyTextOmitted</code>
/// (<code>tooLarge</code>, <code>unreadable</code> or <code>noRenderer</code>). <code>bodyId</code> is left out
/// for a <code>literal</code> header that holds a value unless <var>pBodyRead</var> is <code>all</code>; a
/// <code>literal</code> header with an empty body ID (a message sent with no body object) carries
/// <code>bodyId</code> <code>""</code> in every mode, which says it has no body and holds no value. What is read follows
/// <method>ReadsText</method>: <code>kind</code> reads nothing, <code>hl7</code> the text of an available HL7 v2
/// body (<method>ExecuteMCPv2.REST.MessageResend:SetBodyDetail</method>, <var>pMaxChars</var> being its limit),
/// <code>all</code> that and every other kind (<method>RenderText</method>) and the value of a literal header.
/// An item never carries exception text; the caller wraps this call in a Try/Catch for the unexpected.
ClassMethod BodyOne(pId As %Integer, pBodyRead As %String, pMaxChars As %Integer) As %DynamicObject
{
    Set tItem = {}
    Set tRS = ##class(%SQL.Statement).%ExecDirect(, "SELECT ID, MessageBodyClassName, MessageBodyId FROM Ens.MessageHeader WHERE ID = ?", pId)
    If '$IsObject(tRS) || (tRS.%SQLCODE < 0) {
        Do tItem.%Set("id", pId, "number")
        Do tItem.%Set("found", 0, "boolean")
        Do tItem.%Set("error", "Header " _ pId _ " could not be read.")
        Quit tItem
    }
    If 'tRS.%Next() {
        Do tItem.%Set("id", pId, "number")
        Do tItem.%Set("found", 0, "boolean")
        Do tItem.%Set("error", "Header " _ pId _ " not found")
        Quit tItem
    }

    Set tClass = tRS.MessageBodyClassName
    Set tBodyId = tRS.MessageBodyId
    Set tClassExists = 0
    If tClass '= "" { Set tClassExists = ##class(%Dictionary.CompiledClass).%ExistsId(tClass) }
    Set tKind = ##class(ExecuteMCPv2.REST.MessageSearch).BodyKind(tClass)

    Do tItem.%Set("id", pId, "number")
    Do tItem.%Set("found", 1, "boolean")
    Do tItem.%Set("bodyClassName", tClass, "string")
    If (tKind '= "literal") || (pBodyRead = "all") || (tBodyId = "") { Do tItem.%Set("bodyId", tBodyId, "string") }
    Set tReads = ..ReadsText(pBodyRead, tKind)
    Do ##class(ExecuteMCPv2.REST.MessageResend).SetBodyDetail(tItem, $Select(tReads: "text", 1: "kind"), pMaxChars, tClass, tBodyId, tClassExists)
    If tItem.%IsDefined("bodyText") { Do tItem.%Set("bodyTextComplete", 1, "boolean") }

    If tReads && (tKind '= "hl7v2") {
        If tKind = "literal" {
            Set tText = ..CutText(tBodyId, pMaxChars, .tComplete)
            Do tItem.%Set("bodyText", tText, "string")
            Do tItem.%Set("bodyTextComplete", tComplete, "boolean")
        }
        ElseIf tItem.%Get("bodyAvailable") {
            Set tObj = ""
            If (tKind '= "vdoc") && (tKind '= "other") { Set tObj = $ClassMethod(tClass, "%OpenId", tBodyId) }
            Set tOmitted = ..RenderText(tKind, tObj, pMaxChars, .tText, .tComplete)
            If tOmitted = "" {
                Do tItem.%Set("bodyText", tText, "string")
                Do tItem.%Set("bodyTextComplete", tComplete, "boolean")
            }
            Else {
                Do tItem.%Set("bodyTextOmitted", tOmitted, "string")
            }
        }
    }
    Quit tItem
}

/// Read message bodies. The JSON body holds <code>headerIds</code> (an array of 1 to
/// <parameter>MAXIDS</parameter> numeric header IDs, required), optional <code>namespace</code>, optional
/// <code>bodyRead</code> (<code>kind</code>, the default, <code>hl7</code> or <code>all</code>: which bodies IRIS
/// may read, see <method>ReadsText</method>) and optional <code>bodyTextMaxChars</code> (an integer from 1 to
/// <parameter>BODYTEXTMAX</parameter> of <class>ExecuteMCPv2.REST.MessageResend</class>, default
/// <parameter>BODYTEXTDEFAULT</parameter> of that class: the limit of an HL7 v2 body and the longest prefix of
/// any other kind).
/// <p>The result is <code>{interopEnabled, items, count}</code>, one item per ID in request order, duplicates
/// included (see <method>BodyOne</method>). <code>interopEnabled</code> is false, with no items, when the
/// namespace has no <code>Ens.MessageHeader</code>. Every check of the input runs before the namespace switch and
/// its text names the parameter. A header that fails to read is
/// <code>{id, found: false, error}</code> with a fixed text, so no exception text is returned. Never writes.</p>
ClassMethod MessageBody() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Set tResult = ""
    Try {
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) Quit
        If '$IsObject(tBody) {
            Set tSC = $$$ERROR($$$GeneralError, "Request body is required")
            Quit
        }

        Set tHeaderIdsArr = ""
        If tBody.%IsDefined("headerIds") { Set tHeaderIdsArr = tBody.%Get("headerIds") }
        Set tSC = ##class(ExecuteMCPv2.REST.MessageResend).ValidateHeaderIds(tHeaderIdsArr, .tIds, ..#MAXIDS)
        If $$$ISERR(tSC) Quit

        Set tBodyRead = "kind"
        If tBody.%IsDefined("bodyRead") && (tBody.%GetTypeOf("bodyRead") '= "null") {
            Set tBodyRead = tBody.%Get("bodyRead")
            If (tBody.%GetTypeOf("bodyRead") '= "string") || ((tBodyRead '= "kind") && (tBodyRead '= "hl7") && (tBodyRead '= "all")) {
                Set tSC = $$$ERROR($$$GeneralError, "Parameter 'bodyRead' must be kind, hl7 or all")
                Quit
            }
        }

        Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).ReadInteger(tBody, "bodyTextMaxChars", ##class(ExecuteMCPv2.REST.MessageResend).#BODYTEXTDEFAULT, 1, ##class(ExecuteMCPv2.REST.MessageResend).#BODYTEXTMAX, .tMax)
        If $$$ISERR(tSC) Quit
        Set tSC = ##class(ExecuteMCPv2.REST.MessageSearch).ReadString(tBody, "namespace", 256, .tNamespace)
        If $$$ISERR(tSC) Quit

        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) Quit
        }

        Set tResult = {}
        If '##class(%Dictionary.CompiledClass).%ExistsId("Ens.MessageHeader") {
            Do tResult.%Set("interopEnabled", 0, "boolean")
            Do tResult.%Set("items", [])
            Do tResult.%Set("count", 0, "number")
            Quit
        }

        Set tItems = []
        For tI = 1:1:tIds(0) {
            Set tId = tIds(tI)
            Try {
                Set tItem = ..BodyOne(tId, tBodyRead, tMax)
            }
            Catch exItem {
                Set tItem = {}
                Do tItem.%Set("id", tId, "number")
                Do tItem.%Set("found", 0, "boolean")
                Do tItem.%Set("error", "Header " _ tId _ " could not be read.")
            }
            Do tItems.%Push(tItem)
        }
        Do tResult.%Set("interopEnabled", 1, "boolean")
        Do tResult.%Set("items", tItems)
        Do tResult.%Set("count", tItems.%Size(), "number")
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
    }
    Set $NAMESPACE = tOrigNS
    If $$$ISERR(tSC) {
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
    }
    Else {
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Quit $$$OK
}

}
