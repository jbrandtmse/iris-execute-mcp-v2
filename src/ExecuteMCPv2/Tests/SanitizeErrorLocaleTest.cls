/// Pins <method>ExecuteMCPv2.Utils:SanitizeError</method>, <method>ExecuteMCPv2.Utils:StripErrorPrefix</method> and
/// <method>ExecuteMCPv2.Coverage.Job:SafeText</method> for every message language the instance has.
/// <p>The 15 languages and their prefix words are pinned from <code>GetLanguages("%ObjectErrors", "s")</code> and
/// <code>GetErrorText($$$ERROR(5001, "disk full"), L)</code> on IRIS 2026.2 Build 221U, and
/// <method>TestPinnedLanguagesAndRenderingsMatchTheInstance</method> turns red when the instance gains, loses or
/// changes a table. Every language is passed as an argument: no test changes a session, process or NLS locale.
/// Every status is built in memory and no global is written. "Inner" below is
/// <code>$System.Status.GetOneStatusText(status, 1)</code>, the message without domain, code or prefix.</p>
Class ExecuteMCPv2.Tests.SanitizeErrorLocaleTest Extends %UnitTest.TestCase
{

/// The message-table languages of <code>%ObjectErrors</code>, comma-joined, in the order
/// <code>GetLanguages</code> returns them.
ClassMethod PinnedLanguages() As %String
{
    Quit "ar,de,en,en-us,es,es-cl,fr,it,ja,ko,nl,pt-br,ru,uk,zh-cn"
}

/// The word <code>GetErrorText</code> puts before <code> #5001: </code> in language <var>pLang</var>.
ClassMethod PinnedWord(pLang As %String) As %String
{
    Quit $Case(pLang,
        "ar": $Char(1582, 1591, 1571),
        "de": "FEHLER",
        "en": "ERROR",
        "en-us": "ERROR",
        "es": "ERROR",
        "es-cl": "Error",
        "fr": "ERREUR",
        "it": "ERRORE",
        "ja": $Char(12456, 12521, 12540),
        "ko": $Char(50724, 47448),
        "nl": "FOUT",
        "pt-br": "ERRO",
        "ru": $Char(1054, 1064, 1048, 1041, 1050, 1040),
        "uk": $Char(1055, 1054, 1052, 1048, 1051, 1050, 1040),
        "zh-cn": $Char(38169, 35823),
        : "")
}

/// The inner text of <method>ExecuteMCPv2.Utils:SanitizeError</method> for <var>pStatus</var> read in <var>pLang</var>.
ClassMethod Inner(pStatus As %Status, pLang As %String = "") As %String
{
    Quit $System.Status.GetOneStatusText(##class(ExecuteMCPv2.Utils).SanitizeError(pStatus, pLang), 1)
}

/// A runtime-error status: code 5002, <code>&lt;UNDEFINED&gt;</code> in its text.
ClassMethod UndefinedStatus() As %Status
{
    Set tSC = $$$OK
    Try {
        Set tValue = tNeverSet
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Assert that <method>ExecuteMCPv2.Utils:StripErrorPrefix</method> turns <var>pInput</var> into <var>pExpected</var>.
Method CheckStrip(pInput As %String, pExpected As %String, pLabel As %String)
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).StripErrorPrefix(pInput), pExpected, pLabel_": "_pInput)
}

/// Assert that <method>ExecuteMCPv2.Utils:StripErrorPrefix</method> returns <var>pInput</var> unchanged.
Method CheckKept(pInput As %String)
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).StripErrorPrefix(pInput), pInput, "M14 unchanged: "_pInput)
}

/// AC 41.8.6: the live language list equals the pin, and every live rendering equals its pin.
Method TestPinnedLanguagesAndRenderingsMatchTheInstance() As %Status
{
    For tDomain = "%ObjectErrors", "%Utility" {
        Set tLive = ##class(%MessageDictionary).GetLanguages(tDomain, "s")
        Set tJoined = ""
        For tI = 1:1:tLive.Count() {
            Set tJoined = tJoined_$Select(tJoined = "": "", 1: ",")_tLive.GetAt(tI)
        }
        Do $$$AssertEquals(tJoined, ..PinnedLanguages(), "the live languages of "_tDomain_" equal the pin")
    }
    Set tLangs = $ListFromString(..PinnedLanguages(), ",")
    Do $$$AssertEquals($ListLength(tLangs), 15, "the pin holds 15 languages")
    For tI = 1:1:$ListLength(tLangs) {
        Set tLang = $List(tLangs, tI)
        Set tLiveText = $System.Status.GetErrorText($$$ERROR($$$GeneralError, "disk full"), tLang)
        Do $$$AssertEquals(tLiveText, ..PinnedWord(tLang)_" #5001: disk full", "the live rendering in "_tLang_" equals its pin")
    }
    Quit $$$OK
}

/// M1, M2, M9 and M10 (AC 41.8.1): one prefix in every language, and only the status's own.
Method TestEveryLanguageKeepsExactlyOnePrefix() As %Status
{
    Set tLangs = $ListFromString(..PinnedLanguages(), ",")
    For tI = 1:1:$ListLength(tLangs) {
        Set tLang = $List(tLangs, tI)
        Set tSC = $$$ERROR($$$GeneralError, "disk full")
        Do $$$AssertEquals(..Inner(tSC, tLang), "disk full", "M1 one prefix in "_tLang)
        Set tSanitized = ##class(ExecuteMCPv2.Utils).SanitizeError(tSC, tLang)
        Do $$$AssertEquals($System.Status.GetErrorText(tSanitized, tLang), ..PinnedWord(tLang)_" #5001: disk full", "M1 the sanitized status carries its own prefix, once, in "_tLang)
        Set tSC = $$$ERROR($$$GeneralError, "ERREUR #5001: x")
        Do $$$AssertEquals(..Inner(tSC, tLang), "ERREUR #5001: x", "M2 exactly one prefix is removed in "_tLang)
        Set tSC = $$$ERROR($$$GeneralError, "")
        Do $$$AssertEquals(..Inner(tSC, tLang), "", "M10 an empty message in "_tLang)
    }
    Do $$$AssertEquals(..Inner($$$ERROR($$$GeneralError, "disk full"), "zz"), "disk full", "M9 a language with no table reads the English one")
    Quit $$$OK
}

/// M3, M4 and M5 (AC 41.8.2): a look-alike inside the message, a <code>&lt;TOKEN&gt;</code> item and a bracket domain code
/// are kept, in every language.
Method TestLookAlikesTokensAndBracketCodesAreKept() As %Status
{
    Set tUndefined = ..UndefinedStatus()
    Do $$$AssertStatusNotOK(tUndefined, "the runtime-error status is an error")
    Set tLangs = $ListFromString(..PinnedLanguages(), ",")
    For tI = 1:1:$ListLength(tLangs) {
        Set tLang = $List(tLangs, tI)
        Set tSC = $$$ERROR($$$GeneralError, "Order #12: shipped")
        Do $$$AssertEquals(..Inner(tSC, tLang), "Order #12: shipped", "M3 a look-alike inside the message in "_tLang)
        Set tInner = ..Inner(tUndefined, tLang)
        Do $$$AssertTrue(tInner [ "<UNDEFINED>", "M4 the <UNDEFINED> item is kept in "_tLang_": "_tInner)
        Do $$$AssertTrue(tInner '[ "#5002: ", "M4 the prefix of the 5002 status is removed in "_tLang_": "_tInner)
        Set tBracket = $$$ERROR("<Ens>ErrGeneral", "queue full")
        Set tExpected = $System.Status.GetErrorText(tBracket, tLang)
        Do $$$AssertTrue(tExpected [ "<Ens>ErrGeneral: queue full", "M5 the bracket code renders in "_tLang_": "_tExpected)
        Do $$$AssertEquals(..Inner(tBracket, tLang), tExpected, "M5 a bracket domain code is kept as rendered in "_tLang)
    }
    Quit $$$OK
}

/// M6 and M7 (AC 41.8.5): the lines of a combined or an embedded status are separated by a space.
Method TestCombinedAndEmbeddedStatusesJoinWithASpace() As %Status
{
    Set tLangs = $ListFromString(..PinnedLanguages(), ",")
    For tI = 1:1:$ListLength(tLangs) {
        Set tLang = $List(tLangs, tI)
        Set tWord = ..PinnedWord(tLang)
        Set tFirst = $$$ERROR($$$GeneralError, "disk full")
        Set tSecond = $$$ERROR($$$GeneralError, "second")
        Set tCombined = $$$ADDSC(tFirst, tSecond)
        Do $$$AssertEquals(..Inner(tCombined, tLang), "disk full "_tWord_" #5001: second", "M6 a combined status in "_tLang)
        Set tOuter = $$$ERROR($$$GeneralError, "Import failed")
        Set tEmbedded = $System.Status.EmbedStatus(tOuter, tFirst)
        Do $$$AssertEquals(..Inner(tEmbedded, tLang), "Import failed   > "_tWord_" #5001: disk full", "M7 an embedded status in "_tLang)
    }
    Quit $$$OK
}

/// M8 (AC 41.8.3): a call that names no language reads the status exactly as the one-argument
/// <code>GetErrorText</code> does, in the session language.
Method TestOneArgumentCallReadsTheSessionLanguage() As %Status
{
    Set tSession = ##class(%MessageDictionary).GetSessionLanguage()
    Set tPlain = $$$ERROR($$$GeneralError, "disk full")
    Do $$$AssertEquals($System.Status.GetOneStatusText(##class(ExecuteMCPv2.Utils).SanitizeError(tPlain), 1), "disk full", "M8 the one-argument call, a plain message")
    Set tUndefined = ..UndefinedStatus()
    Set tOneArgument = $System.Status.GetOneStatusText(##class(ExecuteMCPv2.Utils).SanitizeError(tUndefined), 1)
    Set tInSession = ..Inner(tUndefined, tSession)
    Do $$$AssertTrue(tOneArgument [ "<UNDEFINED>", "M8 the one-argument text keeps the <UNDEFINED> item: "_tOneArgument)
    Do $$$AssertEquals(tOneArgument, tInSession, "M8 the one-argument call equals the call that names the session language ("_tSession_")")
    Quit $$$OK
}

/// M11 and M12 (AC 41.8.3): a status that is not well formed keeps today's values, and an OK status passes through.
Method TestNotWellFormedAndOkStatusesKeepTheirValues() As %Status
{
    Set tUtils = "ExecuteMCPv2.Utils"
    Do $$$AssertEquals(..Inner("", "en-us"), "(no error description)", "M11 an empty string")
    Do $$$AssertEquals(..Inner(0, "en-us"), "(no error description)", "M11 zero")
    Do $$$AssertEquals(..Inner("0 garbage", "en-us"), "Invalid status code structure (""0 garbage"")", "M11 a status with a bad structure")
    Do $$$AssertEquals($ClassMethod(tUtils, "SanitizeError", $$$OK, "fr"), $$$OK, "M12 an OK status passes through in another language")
    Do $$$AssertEquals($ClassMethod(tUtils, "SanitizeError", $$$OK), $$$OK, "M12 an OK status passes through with no language")
    Quit $$$OK
}

/// M13 (AC 41.8.2): the shapes <method>ExecuteMCPv2.Utils:StripErrorPrefix</method> removes.
Method TestStripErrorPrefixRemovesTheShape() As %Status
{
    Do ..CheckStrip("ERROR #00: (no error description)", "(no error description)", "M13 the empty-status rendering")
    Do ..CheckStrip("ERROR #5001: ", "", "M13 a prefix with no message")
    Do ..CheckStrip("ERROR #5001: ERROR #5001: x", "ERROR #5001: x", "M13 only one prefix of two")
    Do ..CheckStrip("Fehlermeldungtex #5001: x", "x", "M13 a word of 16 characters")
    Do ..CheckStrip("FEHLER #5001: disk full", "disk full", "M13 a German prefix")
    Do ..CheckStrip(..PinnedWord("ja")_" #5001: disk full", "disk full", "M13 a Japanese prefix")
    Quit $$$OK
}

/// M14 (AC 41.8.2): the look-alikes <method>ExecuteMCPv2.Utils:StripErrorPrefix</method> returns unchanged.
Method TestStripErrorPrefixKeepsEveryLookAlike() As %Status
{
    Do ..CheckKept("ERROR #: disk full")
    Do ..CheckKept("ERROR #abc: disk full")
    Do ..CheckKept("ERROR #5001a: disk full")
    Do ..CheckKept("ERROR #5001 disk full")
    Do ..CheckKept("ERROR #5001:disk full")
    Do ..CheckKept("ERROR #5001")
    Do ..CheckKept("see ERROR #5001: here")
    Do ..CheckKept(" ERROR #5001: x")
    Do ..CheckKept("The run stopped at step #5: see the log")
    Do ..CheckKept("<UNDEFINED> #5001: x")
    Do ..CheckKept("ERROR <Ens>ErrGeneral: queue full")
    Do ..CheckKept("Supercalifragilisticexpialidocious #5001: x")
    Do ..CheckKept("Fehlermeldungtext #5001: x")
    Do ..CheckKept("ERR-OR #5001: x")
    Do ..CheckKept("ERROR1 #5001: x")
    Do ..CheckKept("ERROR  #5001: x")
    Do ..CheckKept(" #5001: x")
    Do ..CheckKept("ERROR #5001 #7: x")
    Do ..CheckKept("")
    Quit $$$OK
}

/// M15 (AC 41.8.4): <method>ExecuteMCPv2.Coverage.Job:SafeText</method> keeps the code of recorded text in every
/// language and adds no wrapper prefix.
Method TestSafeTextKeepsItsCodeInEveryLanguage() As %Status
{
    Set tLangs = $ListFromString(..PinnedLanguages(), ",")
    For tI = 1:1:$ListLength(tLangs) {
        Set tLang = $List(tLangs, tI)
        Set tRecorded = ..PinnedWord(tLang)_" #5001: disk full"
        Do $$$AssertEquals(##class(ExecuteMCPv2.Coverage.Job).SafeText(tRecorded, tLang), tRecorded, "M15 recorded text in "_tLang_" keeps its code and gains no prefix")
    }
    Quit $$$OK
}

}
