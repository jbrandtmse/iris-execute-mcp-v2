/// Unit tests for <class>ExecuteMCPv2.REST.MessageBody</class> (Story 39.5). Data-free: nothing here reads or
/// writes a message header or a stored body; every object is unsaved.
/// <p><method>TestReadsText</method> pins which kinds each <code>bodyRead</code> lets IRIS read, the rule that
/// keeps a body the policy withholds inside IRIS. <method>TestRenderNoRenderer</method> pins the kinds that have
/// no renderer. <method>TestReadStreamText</method> pins the prefix rule and <code>bodyTextComplete</code> of
/// every stream-based kind. <method>TestPropertyDump</method> pins the property dump of a persistent body that has
/// no JSON adaptor.</p>
Class ExecuteMCPv2.Tests.MessageBodyTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// ==================== ReadsText ====================

/// <code>kind</code> reads no body, <code>hl7</code> reads only an HL7 v2 body, and <code>all</code> reads every
/// kind except <code>missing</code>. A <code>bodyRead</code> or a kind that is not in the vocabulary reads nothing.
Method TestReadsText()
{
    Set tKinds = $ListBuild("hl7v2", "xmlvdoc", "vdoc", "stream", "streamContainer", "persistent", "literal", "missing", "other")
    For tI = 1:1:$ListLength(tKinds) {
        Set tKind = $List(tKinds, tI)
        Set tKindReads = ##class(ExecuteMCPv2.REST.MessageBody).ReadsText("kind", tKind)
        Do $$$AssertEquals(tKindReads, 0, "kind reads no " _ tKind _ " body")
        Set tHl7Reads = ##class(ExecuteMCPv2.REST.MessageBody).ReadsText("hl7", tKind)
        Set tHl7Expected = $Select(tKind = "hl7v2": 1, 1: 0)
        Do $$$AssertEquals(tHl7Reads, tHl7Expected, "hl7 reads a " _ tKind _ " body: " _ tHl7Expected)
        Set tAllReads = ##class(ExecuteMCPv2.REST.MessageBody).ReadsText("all", tKind)
        Set tAllExpected = $Select(tKind = "missing": 0, 1: 1)
        Do $$$AssertEquals(tAllReads, tAllExpected, "all reads a " _ tKind _ " body: " _ tAllExpected)
    }
    Set tRaw = ##class(ExecuteMCPv2.REST.MessageBody).ReadsText("raw", "hl7v2")
    Do $$$AssertEquals(tRaw, 0, "a bodyRead outside the vocabulary reads nothing")
    Set tEmpty = ##class(ExecuteMCPv2.REST.MessageBody).ReadsText("", "stream")
    Do $$$AssertEquals(tEmpty, 0, "an empty bodyRead reads nothing")
    Set tUnknownKind = ##class(ExecuteMCPv2.REST.MessageBody).ReadsText("all", "bogus")
    Do $$$AssertEquals(tUnknownKind, 0, "a kind outside the vocabulary is not read, even under all")
}

/// ==================== RenderText ====================

/// <code>vdoc</code> and <code>other</code> give <code>noRenderer</code> without an object, and so does a kind
/// that has no renderer here (HL7 v2 is read by <code>SetBodyDetail</code>, a literal by <code>BodyOne</code>).
/// A kind that has a renderer, given no object, is <code>unreadable</code>.
Method TestRenderNoRenderer()
{
    Set tNoRenderer = $ListBuild("vdoc", "other", "hl7v2", "literal", "missing")
    For tI = 1:1:$ListLength(tNoRenderer) {
        Set tKind = $List(tNoRenderer, tI)
        Set tResult = ##class(ExecuteMCPv2.REST.MessageBody).RenderText(tKind, "", 1000, .tText, .tComplete)
        Do $$$AssertEquals(tResult, "noRenderer", "a " _ tKind _ " body has no renderer")
        Do $$$AssertEquals(tText, "", "and no text")
        Do $$$AssertEquals(tComplete, 0, "and is not complete")
    }
    Set tRenderable = $ListBuild("xmlvdoc", "persistent", "stream", "streamContainer")
    For tI = 1:1:$ListLength(tRenderable) {
        Set tKind = $List(tRenderable, tI)
        Set tResult = ##class(ExecuteMCPv2.REST.MessageBody).RenderText(tKind, "", 1000, .tText, .tComplete)
        Do $$$AssertEquals(tResult, "unreadable", "a " _ tKind _ " body that did not open is unreadable")
        Do $$$AssertEquals(tText, "", "and has no text")
    }
}

/// ==================== ReadStreamText ====================

/// A stream of 30 characters is read in full at caps 30 and 31 and as a 10-character prefix at cap 10; an empty
/// stream is complete with no text; a cap that would split a surrogate pair drops its first half; a value that
/// is not a stream is <code>unreadable</code>. <method>ExecuteMCPv2.REST.MessageBody:CutText</method>, which cuts
/// the text of a literal header and of a property dump, follows the same prefix, completeness and surrogate rules.
Method TestReadStreamText()
{
    Set tSource = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"
    Do $$$AssertEquals($Length(tSource), 30, "the source text has 30 characters")
    Set tStream = ##class(%Stream.TmpCharacter).%New()
    Do tStream.Write(tSource)

    Set tResult = ##class(ExecuteMCPv2.REST.MessageBody).ReadStreamText(tStream, 10, .tText, .tComplete)
    Do $$$AssertEquals(tResult, "", "cap 10: read")
    Do $$$AssertEquals(tText, $Extract(tSource, 1, 10), "cap 10: the first 10 characters")
    Do $$$AssertEquals(tComplete, 0, "cap 10: not complete")

    Set tResult = ##class(ExecuteMCPv2.REST.MessageBody).ReadStreamText(tStream, 30, .tText, .tComplete)
    Do $$$AssertEquals(tResult, "", "cap 30: read")
    Do $$$AssertEquals(tText, tSource, "cap 30: the whole text")
    Do $$$AssertEquals(tComplete, 1, "cap 30: complete, since the stream holds no more")

    Set tResult = ##class(ExecuteMCPv2.REST.MessageBody).ReadStreamText(tStream, 31, .tText, .tComplete)
    Do $$$AssertEquals(tResult, "", "cap 31: read")
    Do $$$AssertEquals(tText, tSource, "cap 31: the whole text")
    Do $$$AssertEquals(tComplete, 1, "cap 31: complete")

    Set tEmpty = ##class(%Stream.TmpCharacter).%New()
    Set tResult = ##class(ExecuteMCPv2.REST.MessageBody).ReadStreamText(tEmpty, 10, .tText, .tComplete)
    Do $$$AssertEquals(tResult, "", "an empty stream: read")
    Do $$$AssertEquals(tText, "", "an empty stream: no text")
    Do $$$AssertEquals(tComplete, 1, "an empty stream: complete")

    Set tPair = ##class(%Stream.TmpCharacter).%New()
    Do tPair.Write("ab" _ $Char(55357, 56832) _ "cd")
    Set tResult = ##class(ExecuteMCPv2.REST.MessageBody).ReadStreamText(tPair, 3, .tText, .tComplete)
    Do $$$AssertEquals(tResult, "", "a cut inside a surrogate pair: read")
    Do $$$AssertEquals(tText, "ab", "a cut inside a surrogate pair drops the first half")
    Do $$$AssertEquals(tComplete, 0, "a cut inside a surrogate pair: not complete")

    Set tResult = ##class(ExecuteMCPv2.REST.MessageBody).ReadStreamText("", 10, .tText, .tComplete)
    Do $$$AssertEquals(tResult, "unreadable", "a value that is not a stream is unreadable")
    Do $$$AssertEquals(tText, "", "and has no text")

    Set tCut = ##class(ExecuteMCPv2.REST.MessageBody).CutText(tSource, 10, .tComplete)
    Do $$$AssertEquals(tCut, $Extract(tSource, 1, 10), "CutText cap 10: the first 10 characters")
    Do $$$AssertEquals(tComplete, 0, "CutText cap 10: not complete")
    Set tCut = ##class(ExecuteMCPv2.REST.MessageBody).CutText(tSource, 30, .tComplete)
    Do $$$AssertEquals(tCut, tSource, "CutText cap 30: the whole text")
    Do $$$AssertEquals(tComplete, 1, "CutText cap 30: complete")
    Set tCut = ##class(ExecuteMCPv2.REST.MessageBody).CutText(tSource, 31, .tComplete)
    Do $$$AssertEquals(tCut, tSource, "CutText cap 31: the whole text")
    Do $$$AssertEquals(tComplete, 1, "CutText cap 31: complete")
    Set tCut = ##class(ExecuteMCPv2.REST.MessageBody).CutText("ab" _ $Char(55357, 56832) _ "cd", 3, .tComplete)
    Do $$$AssertEquals(tCut, "ab", "CutText inside a surrogate pair drops the first half")
    Do $$$AssertEquals(tComplete, 0, "CutText inside a surrogate pair: not complete")
    Set tCut = ##class(ExecuteMCPv2.REST.MessageBody).CutText("", 5, .tComplete)
    Do $$$AssertEquals(tCut, "", "CutText of an empty text is empty")
    Do $$$AssertEquals(tComplete, 1, "CutText of an empty text is complete")
}

/// ==================== PropertyDump ====================

/// An unsaved <class>Ens.StringRequest</class> dumps its one property. An unsaved
/// <class>Ens.StreamContainer</class> dumps its public properties only: not the calculated
/// <code>Stream</code>, none of the internal <code>Stream*</code> properties, and not <code>%%OID</code>. An unsaved
/// <class>Ens.Config.Item</class> leaves out its transient properties. An unsaved <class>Ens.AlarmRequest</class>
/// leaves out <code>Duration</code> and <code>Until</code>, which are calculated and not transient, so only the
/// calculated rule removes them.
Method TestPropertyDump()
{
    Set tString = ##class(Ens.StringRequest).%New("KEEPME-DUMP")
    Set tDump = ##class(ExecuteMCPv2.REST.MessageBody).PropertyDump(tString)
    Do $$$AssertEquals(tDump.%ToJSON(), "{""StringValue"":""KEEPME-DUMP""}", "a string request dumps its StringValue")

    Set tContainer = ##class(Ens.StreamContainer).%New()
    Set tDump = ##class(ExecuteMCPv2.REST.MessageBody).PropertyDump(tContainer)
    Set tExpected = "{""OriginalFilename"":null,""OutputFolder"":null,""OutputFilename"":null,""Type"":null,""Attributes"":{""collection"":""array"",""count"":0}}"
    Do $$$AssertEquals(tDump.%ToJSON(), tExpected, "a stream container dumps its public properties")
    Do $$$AssertEquals(tDump.%IsDefined("Stream"), 0, "the Stream property (calculated and transient) is left out")
    Do $$$AssertEquals(tDump.%IsDefined("StreamGC"), 0, "an internal stream property is left out")
    Do $$$AssertEquals(tDump.%IsDefined("%%OID"), 0, "%%OID (private, internal and transient) is left out")

    Set tAlarm = ##class(Ens.AlarmRequest).%New()
    Set tDump = ##class(ExecuteMCPv2.REST.MessageBody).PropertyDump(tAlarm)
    Do $$$AssertEquals(tDump.%IsDefined("Timeout"), 1, "a public stored property of an alarm request is dumped")
    Do $$$AssertEquals(tDump.%IsDefined("Duration"), 0, "a calculated property that is not transient is left out")
    Do $$$AssertEquals(tDump.%IsDefined("Until"), 0, "and so is another one")

    Set tConfigItem = ##class(Ens.Config.Item).%New()
    Set tDump = ##class(ExecuteMCPv2.REST.MessageBody).PropertyDump(tConfigItem)
    Do $$$AssertEquals(tDump.%IsDefined("Name"), 1, "a public property of a configuration item is dumped")
    Do $$$AssertEquals(tDump.%IsDefined("VirtualSettings"), 0, "a transient property is left out")
    Do $$$AssertEquals(tDump.%IsDefined("ModifiedSettings"), 0, "and so is another transient property")
}

}
