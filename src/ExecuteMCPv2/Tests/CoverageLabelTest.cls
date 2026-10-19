/// Unit tests for the preprocessor-line rule, the INT label lines and the class line-map marker of the class-source map of
/// <class>ExecuteMCPv2.Coverage.Job</class> (Stories 40.2 and 40.4). Each map test compiles a disposable class of its own and
/// removes it.
/// <p>No test here starts a Line-by-Line session or terminates a process. The expected values are the live capture of
/// <code>SourceMap</code> on these exact class texts, IRIS 2026.2 build 221U, 2026-10-18: INT line numbers are the compiler's
/// own, so the class texts must not change.</p>
Class ExecuteMCPv2.Tests.CoverageLabelTest Extends %UnitTest.TestCase
{

/// The disposable class with five leading preprocessor lines.
Parameter DIRECTIVECLASS = "ExecuteMCPv2.Temp.Story402Directive";

/// The disposable class whose methods hold every shape of an initializing <code>#dim</code>.
Parameter DIMCLASS = "ExecuteMCPv2.Temp.Story404Dim";

/// The disposable class whose methods hold only preprocessor lines.
Parameter HOOKSCLASS = "ExecuteMCPv2.Temp.Story404Hooks";

/// The disposable class with two methods whose names share their first 31 characters.
Parameter LONGCLASS = "ExecuteMCPv2.Temp.Story404Long";

/// The disposable class with a constant method and a python method.
Parameter CONSTCLASS = "ExecuteMCPv2.Temp.Story404Const";

/// The disposable class with methods whose names begin with a percent sign.
Parameter PCTCLASS = "ExecuteMCPv2.Temp.Story404Pct";

/// The disposable class whose <code>#dim</code> lines carry a comment that holds an equals sign.
Parameter COMMENTCLASS = "ExecuteMCPv2.Temp.Story404Comment";

Method OnAfterOneTest(testname As %String) As %Status
{
    Do $System.OBJ.Delete(..#DIRECTIVECLASS, "-d")
    Do $System.OBJ.Delete(..#DIMCLASS, "-d")
    Do $System.OBJ.Delete(..#HOOKSCLASS, "-d")
    Do $System.OBJ.Delete(..#LONGCLASS, "-d")
    Do $System.OBJ.Delete(..#CONSTCLASS, "-d")
    Do $System.OBJ.Delete(..#PCTCLASS, "-d")
    Do $System.OBJ.Delete(..#COMMENTCLASS, "-d")
    Quit $$$OK
}

/// A preprocessor line is one `#` and a letter or a semicolon after the leading blanks; a `##` line is not one. A `#dim` line
/// that holds an `=` outside parentheses and string literals initializes its variable and is not one either.
Method TestIsDirective() As %Status
{
    Set tJob = "ExecuteMCPv2.Coverage.Job"
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tX As %Integer"), 1, "#dim")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "#define Twice(%x) (%x * 2)"), 1, "#define in column 1")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", $Char(9)_"#sqlcompile select=ODBC"), 1, "#sqlcompile after a tab")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "  #; a comment"), 1, "#;")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    ##class(X).Y(1)"), 0, "##class continues a statement")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    Set tX = 1"), 0, "a statement")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    # note"), 0, "a # and a blank")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #"), 0, "a lone #")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", ""), 0, "an empty line")

    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tO As %DynamicObject"), 1, "#dim with no =")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "#define X(%a) (%a=1)"), 1, "an = in a #define is not an initializer")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tS As %String(MAXLEN=5)"), 1, "an = inside parentheses is not an initializer")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim"), 1, "a bare #dim")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dimension tX = 1"), 1, "only #dim and a blank is a #dim line")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tSC As %Status = $$$OK"), 0, "#dim with an initializer")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "  #DIM tN As %Integer = 7"), 0, "#DIM in capitals")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tA, tB As %Integer = 0"), 0, "several variables")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tN = 5"), 0, "no type")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tQ As %String = ""a=b"""), 0, "an = before a string literal that holds one")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tT As %String(MAXLEN=5) = ""x"""), 0, "an = after parentheses")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tU As %String(MAXLEN=5, "")="")"), 1, "an = inside a string literal inside parentheses is not an initializer")

    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tI As %Integer // sets nothing = 5"), 1, "an = in a // comment is not an initializer")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tN As %Integer ; sets nothing = 13"), 1, "an = in a ; comment is not an initializer")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tA As %Integer /* sets nothing = 1 */"), 1, "an = in a /* */ comment is not an initializer")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tA As %Integer /* not closed = 1"), 1, "an = after a /* that is not closed is not an initializer")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tC /* a comment */ As %Integer = 3"), 0, "an = after a closed /* */ comment initializes")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tG As %Integer = 3 // initializes tG"), 0, "an = before a comment initializes")
    Do $$$AssertEquals($ClassMethod(tJob, "IsDirective", "    #dim tV As %String(VALUELIST="";a//b"") = ""x"""), 0, "a ; or // inside a string literal starts no comment")
    Quit $$$OK
}

/// The compiler maps a leading preprocessor line to INT lines that belong to the method before it or, from the fourth
/// one on, to the method's own first statements. No preprocessor line has an INT line, and the statements keep theirs.
Method TestSourceMapDropsEveryLeadingDirective() As %Status
{
    Set tName = ..#DIRECTIVECLASS
    Set tNL = $Char(10)
    Set tText = "Class "_tName_tNL_"{"_tNL_tNL_"ClassMethod Beta(pN As %Integer) As %Integer"_tNL_"{"_tNL
    For tI = 1:1:5 Set tText = tText_"    #dim t"_tI_" As %Integer"_tNL
    Set tText = tText_"    Set tA = pN"_tNL_"    Set tB = tA"_tNL_"    Quit tB"_tNL_"}"_tNL_tNL_"}"_tNL
    Do $$$AssertStatusOK(##class(%Compiler.UDL.TextServices).SetTextFromString(, tName, tText, tNL), "the class is saved")
    Do $$$AssertStatusOK($System.OBJ.Compile(tName, "cuk-d"), "the class is compiled")
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "the map is built")
    Set tLabelLine = $List(tMap("m", 1), 5)
    Do $$$AssertTrue(tLabelLine > 0, "the method has an INT label")
    For tK = 1:1:5 Do $$$AssertEquals(tMap("m", 1, tK), 0, "preprocessor line "_tK_" has no INT line")
    For tK = 6:1:8 Do $$$AssertTrue(tMap("m", 1, tK) > tLabelLine, "statement line "_tK_" is in the method's own INT block")
    Do $$$AssertTrue((tMap("m", 1, 6) < tMap("m", 1, 7)) && (tMap("m", 1, 7) < tMap("m", 1, 8)), "the statements keep their own INT lines")
    Quit $$$OK
}

/// Two methods whose names share their first 31 characters have the distinct labels the compiler gave them, and each method's
/// label line is found; a method with a short name has its own. A leading preprocessor line has no INT line.
Method TestSourceMapLabelsOfMethodsThatShareAShortenedName() As %Status
{
    Set tName = ..#LONGCLASS
    Set tLong = "AVeryLongMethodNameThatExceedsThirtyOneCharacters"
    Do $$$AssertStatusOK(..CompiledClass(tName, ..LongBody()), "the class is saved and compiled")
    Do $$$AssertEquals($Data(^rMAP(tName)), 10, "the compile wrote the class's line map")
    Set tFirst = $$$comMemberKeyGet(tName, $$$cCLASSmethod, tLong_"One", $$$cMETHrtnlabel)
    Set tSecond = $$$comMemberKeyGet(tName, $$$cCLASSmethod, tLong_"Two", $$$cMETHrtnlabel)
    Do $$$AssertEquals(tFirst, "AVeryLongMethodNameThatExceedsT^"_tName_".1", "the first method's compiled label is the shortened name")
    Do $$$AssertEquals(tSecond, "AVeryLongMethodNameThatExceeds2^"_tName_".1", "the second method's differs")
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "the map is built")
    Do $$$AssertEquals(tMap, $ListBuild(tName, "", 10), "a class with its line map")
    Do ..AssertMapped(.tMap, 1, tLong_"One", 4, tName_".1", 5, "6 7")
    Do ..AssertMapped(.tMap, 2, tLong_"Two", 10, tName_".1", 8, "0 9 10")
    Do ..AssertMapped(.tMap, 3, "Short", 17, tName_".1", 11, "12 13")
    Quit $$$OK
}

/// A fresh class carries <code>lineMap</code> 10. A documentation-only edit saved after the compile leaves
/// <code>$System.OBJ.IsUpToDate</code> true and the INT text and its labels in place, and removes the line map: the head then
/// carries <code>lineMap</code> 0 and no body line maps, but every label line is still known, including those of two methods that
/// share their first 31 characters.
Method TestSourceMapLineMapHead() As %Status
{
    Set tName = ..#LONGCLASS
    Do $$$AssertStatusOK(..CompiledClass(tName, ..LongBody()), "the class is saved and compiled")
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertEquals(tMap, $ListBuild(tName, "", 10), "fresh: lineMap 10")

    Do $$$AssertStatusOK(..CompiledClass(tName, "/// Documentation only."_$Char(10)_..LongBody()), "the documented class is saved and compiled")
    Do $$$AssertEquals($System.OBJ.IsUpToDate(tName), 1, "IRIS still calls the class up to date")
    Do $$$AssertEquals($Data(^rMAP(tName)), 0, "but the documentation edit removed its line map")
    Kill tMap
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "the class is a result, not an error")
    Do $$$AssertEquals(tMap, $ListBuild(tName, "", 0), "documented: lineMap 0")
    Set tLong = "AVeryLongMethodNameThatExceedsThirtyOneCharacters"
    Do ..AssertMapped(.tMap, 1, tLong_"One", 5, "", 5, "0 0")
    Do ..AssertMapped(.tMap, 2, tLong_"Two", 11, "", 8, "0 0 0")
    Do ..AssertMapped(.tMap, 3, "Short", 18, "", 11, "0 0")
    Quit $$$OK
}

/// A class whose methods hold only preprocessor lines compiles with its line map, and each method has a label line and no
/// mapped body line.
Method TestSourceMapOfDirectiveOnlyMethods() As %Status
{
    Set tName = ..#HOOKSCLASS
    Do $$$AssertStatusOK(..CompiledClass(tName, ..HooksBody()), "the class is saved and compiled")
    Do $$$AssertEquals($Data(^rMAP(tName)), 10, "the compile wrote the class's line map")
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "the map is built")
    Do $$$AssertEquals(tMap, $ListBuild(tName, "", 10), "a class with its line map")
    Do ..AssertMapped(.tMap, 1, "OnHook", 4, "", 7, "0")
    Do ..AssertMapped(.tMap, 2, "Declared", 9, "", 5, "0")
    Quit $$$OK
}

/// A method that compiled to no INT code has no label line: an inlined constant has no <code>label^routine</code>, and a python
/// method has no label. The class has no line map.
Method TestSourceMapOfMethodsWithoutALabel() As %Status
{
    Set tName = ..#CONSTCLASS
    Do $$$AssertStatusOK(..CompiledClass(tName, ..ConstBody()), "the class is saved and compiled")
    Set tConstLabel = $$$comMemberKeyGet(tName, $$$cCLASSmethod, "Const", $$$cMETHrtnlabel)
    Set tPyLabel = $$$comMemberKeyGet(tName, $$$cCLASSmethod, "Py", $$$cMETHrtnlabel)
    Do $$$AssertEquals(tConstLabel, "-2:Int:3", "the compiled label of an inlined constant")
    Do $$$AssertEquals(tPyLabel, "", "a python method has none")
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "the map is built")
    Do $$$AssertEquals(tMap, $ListBuild(tName, "", 0), "a class with no INT code has no line map")
    Do ..AssertMapped(.tMap, 1, "Const", 4, "", 0, "0")
    Do $$$AssertEquals($Get(tMap("m", 2)), $ListBuild("Py", 9, "", "not-objectscript"), "the python method has a reason and no label line")
    Quit $$$OK
}

/// A method whose name begins with a percent sign has an empty <code>RtnLabel</code> when its INT label is its name cut to
/// 31 characters, and the second of two such names that share those characters is given a <code>RtnLabel</code> of its own.
/// Each method's label line is found, the INT text holding that label at that line, and after a documentation-only save
/// every label line is still known, so a stale class of such methods shows as stale (<code>lineMap</code> 0, label lines
/// kept).
Method TestSourceMapOfPercentSignMethods() As %Status
{
    Set tName = ..#PCTCLASS
    Set tRoutine = tName_".1"
    Set tLong = "%AVeryLongPercentMethodNameThatExceedsThirtyOne"
    Do $$$AssertStatusOK(..CompiledClass(tName, ..PctBody()), "the class is saved and compiled")
    Do $$$AssertEquals($$$comMemberKeyGet(tName, $$$cCLASSmethod, "%Cm", $$$cMETHrtnlabel), "", "a percent-sign method has no compiled label")
    Do $$$AssertEquals($$$comMemberKeyGet(tName, $$$cCLASSmethod, tLong_"A", $$$cMETHrtnlabel), "", "neither has the first long one")
    Do $$$AssertEquals($$$comMemberKeyGet(tName, $$$cCLASSmethod, tLong_"B", $$$cMETHrtnlabel), "%AVeryLongPercentMethodNameTha2^"_tRoutine, "the second long one has a label of its own")
    Do $$$AssertEquals($$$comMemberKeyGet(tName, $$$cCLASSmethod, "Plain", $$$cMETHrtnlabel), "Plain^"_tRoutine, "an ordinary name has one")
    Do ..AssertIntLabel(tRoutine, 11, "%Cm")
    Do ..AssertIntLabel(tRoutine, 5, "%AVeryLongPercentMethodNameThat")
    Do ..AssertIntLabel(tRoutine, 8, "%AVeryLongPercentMethodNameTha2")
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "the map is built")
    Do $$$AssertEquals(tMap, $ListBuild(tName, "", 10), "a class with its line map")
    Do ..AssertMapped(.tMap, 1, "%Cm", 4, tRoutine, 11, "12 13")
    Do ..AssertMapped(.tMap, 2, "Plain", 10, tRoutine, 14, "15 16")
    Do ..AssertMapped(.tMap, 3, tLong_"A", 16, tRoutine, 5, "6 7")
    Do ..AssertMapped(.tMap, 4, tLong_"B", 22, tRoutine, 8, "9 10")

    Do $$$AssertStatusOK(..CompiledClass(tName, "/// Documentation only."_$Char(10)_..PctBody()), "the documented class is saved and compiled")
    Do $$$AssertEquals($Data(^rMAP(tName)), 0, "the documentation edit removed its line map")
    Kill tMap
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "the stale class is a result, not an error")
    Do $$$AssertEquals(tMap, $ListBuild(tName, "", 0), "documented: lineMap 0")
    Do ..AssertMapped(.tMap, 1, "%Cm", 5, "", 11, "0 0")
    Do ..AssertMapped(.tMap, 2, "Plain", 11, "", 14, "0 0")
    Do ..AssertMapped(.tMap, 3, tLong_"A", 17, "", 5, "0 0")
    Do ..AssertMapped(.tMap, 4, tLong_"B", 23, "", 8, "0 0")
    Quit $$$OK
}

/// A <code>#dim</code> that initializes nothing, whose trailing <code>//</code>, <code>;</code> or <code>/* */</code> comment holds
/// an equals sign, keeps no INT line even after four leading <code>#dim</code> lines (where the compiler maps it onto the
/// method's last statement), so each statement keeps its own INT line; an <code>=</code> before a comment initializes. Each
/// mapped line is checked against the INT text it maps to.
Method TestSourceMapIgnoresAnEqualsSignInAComment() As %Status
{
    Set tName = ..#COMMENTCLASS
    Set tRoutine = tName_".1"
    Do $$$AssertStatusOK(..CompiledClass(tName, ..CommentBody()), "the class is saved and compiled")
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "the map is built")
    Do $$$AssertEquals(tMap, $ListBuild(tName, "", 10), "a class with its line map")
    Do ..AssertMapped(.tMap, 1, "SlashesAfterFour", 4, tRoutine, 14, "0 0 0 0 0 15 16")
    Do ..AssertMapped(.tMap, 2, "SemicolonAfterFour", 15, tRoutine, 11, "0 0 0 0 0 12 13")
    Do ..AssertMapped(.tMap, 3, "BlockAfterFour", 26, tRoutine, 5, "0 0 0 0 0 6 7")
    Do ..AssertMapped(.tMap, 4, "InitWithComment", 37, tRoutine, 8, "9 10")
    For tLine = 6, 12, 15 Do ..AssertIntText(tRoutine, tLine, "Set tL")
    For tLine = 7, 13, 16 Do ..AssertIntText(tRoutine, tLine, "Quit tL")
    Do ..AssertIntText(tRoutine, 9, "Set tG")
    Quit $$$OK
}

/// An initializing <code>#dim</code> compiles to a <code>Set</code> at its own INT line, wherever it stands in the method; the
/// leading <code>#dim</code> lines that initialize nothing keep no INT line.
Method TestSourceMapKeepsEveryInitializingDim() As %Status
{
    Set tName = ..#DIMCLASS
    Set tRoutine = tName_".1"
    Do $$$AssertStatusOK(..CompiledClass(tName, ..DimBody()), "the class is saved and compiled")
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "the map is built")
    Do $$$AssertEquals(tMap, $ListBuild(tName, "", 10), "a class with its line map")
    Do ..AssertMapped(.tMap, 1, "Leading", 4, tRoutine, 14, "15 16")
    Do ..AssertMapped(.tMap, 2, "MidBody", 10, tRoutine, 17, "18 19 20")
    Do ..AssertMapped(.tMap, 3, "Nested", 17, tRoutine, 24, "25 26 27 28 29")
    Do ..AssertMapped(.tMap, 4, "AfterFour", 26, tRoutine, 5, "0 0 0 0 6 7")
    Do ..AssertMapped(.tMap, 5, "AfterSix", 36, tRoutine, 8, "0 0 0 0 0 0 9 10")
    Do ..AssertMapped(.tMap, 6, "Capitals", 48, tRoutine, 11, "12 13")
    Do ..AssertMapped(.tMap, 7, "Multi", 54, tRoutine, 21, "22 23")
    Do ..AssertMapped(.tMap, 8, "NoType", 60, tRoutine, 30, "31 32")
    Do ..AssertMapped(.tMap, 9, "Quoted", 66, tRoutine, 33, "34 35")
    Quit $$$OK
}

/// Assert one method entry of a mapped class: its head (name, declaration line, routine, no reason, label line) and the INT
/// line of each body line (a space-separated list).
Method AssertMapped(ByRef pMap, pIndex As %Integer, pName As %String, pLine As %Integer, pRoutine As %String, pLabelLine As %Integer, pLines As %String)
{
    Do $$$AssertEquals($Get(pMap("m", pIndex)), $ListBuild(pName, pLine, pRoutine, "", pLabelLine), pName_": name, declaration line, routine and label line")
    Set tActual = ""
    Set tK = ""
    For {
        Set tK = $Order(pMap("m", pIndex, tK))
        If tK = "" Quit
        Set tActual = tActual_$Select(tActual = "": "", 1: " ")_pMap("m", pIndex, tK)
    }
    Do $$$AssertEquals(tActual, pLines, pName_": the INT line of each body line")
}

/// Assert that INT line <var>pLine</var> of routine <var>pRoutine</var> is the label <var>pLabel</var> (the text before its
/// parameter list), as <method>IndexLabels</method> reads a label.
Method AssertIntLabel(pRoutine As %String, pLine As %Integer, pLabel As %String)
{
    Do $$$AssertEquals($Piece($Get(^ROUTINE(pRoutine, 0, pLine)), "("), pLabel, "INT line "_pLine_" holds the label "_pLabel)
}

/// Assert that INT line <var>pLine</var> of routine <var>pRoutine</var>, without its leading blanks, begins with
/// <var>pText</var>.
Method AssertIntText(pRoutine As %String, pLine As %Integer, pText As %String)
{
    Set tText = $ZStrip($Get(^ROUTINE(pRoutine, 0, pLine)), "<W")
    Do $$$AssertEquals($Extract(tText, 1, $Length(pText)), pText, "INT line "_pLine_" is "_pText_" ("_tText_")")
}

/// Save class <var>pName</var> with the methods of <var>pBody</var> through the UDL text service, which is what a document save
/// does, then compile it.
ClassMethod CompiledClass(pName As %String, pBody As %String) As %Status
{
    Set tNL = $Char(10)
    Set tText = "Class "_pName_tNL_"{"_tNL_tNL_pBody_"}"_tNL
    Set tSC = ##class(%Compiler.UDL.TextServices).SetTextFromString(, pName, tText, tNL)
    If $$$ISERR(tSC) Quit tSC
    Quit $System.OBJ.Compile(pName, "cuk-d")
}

/// The methods of the directive-only class.
ClassMethod HooksBody() As %String
{
    Set tNL = $Char(10)
    Set tBody = "ClassMethod OnHook()"_tNL_"{"_tNL_"    #; nothing runs here"_tNL_"}"_tNL_tNL
    Quit tBody_"ClassMethod Declared()"_tNL_"{"_tNL_"    #dim tX As %Integer"_tNL_"}"_tNL_tNL
}

/// The methods of the long-name class: two whose names share their first 31 characters, and a short one.
ClassMethod LongBody() As %String
{
    Set tNL = $Char(10)
    Set tLong = "AVeryLongMethodNameThatExceedsThirtyOneCharacters"
    Set tBody = "ClassMethod "_tLong_"One() As %Integer"_tNL_"{"_tNL_"    Set tX = 1"_tNL_"    Quit tX"_tNL_"}"_tNL_tNL
    Set tBody = tBody_"ClassMethod "_tLong_"Two() As %Integer"_tNL_"{"_tNL_"    #dim tY As %Integer"_tNL_"    Set tY = 2"_tNL_"    Quit tY"_tNL_"}"_tNL_tNL
    Quit tBody_"ClassMethod Short() As %Integer"_tNL_"{"_tNL_"    Set tZ = 3"_tNL_"    Quit tZ"_tNL_"}"_tNL_tNL
}

/// The methods of the class with no labels: an inlined constant and a python method.
ClassMethod ConstBody() As %String
{
    Set tNL = $Char(10)
    Set tBody = "ClassMethod Const() As %Integer"_tNL_"{"_tNL_"    Quit 3"_tNL_"}"_tNL_tNL
    Quit tBody_"ClassMethod Py() As %Integer [ Language = python ]"_tNL_"{"_tNL_"    return 7"_tNL_"}"_tNL_tNL
}

/// The methods of the class with percent-sign names: a short one, one with an ordinary name, and two long ones whose names
/// share their first 31 characters.
ClassMethod PctBody() As %String
{
    Set tNL = $Char(10)
    Set tLong = "%AVeryLongPercentMethodNameThatExceedsThirtyOne"
    Set tBody = "ClassMethod %Cm() As %Integer"_tNL_"{"_tNL_"    Set tX = 1"_tNL_"    Quit tX"_tNL_"}"_tNL_tNL
    Set tBody = tBody_"ClassMethod Plain() As %Integer"_tNL_"{"_tNL_"    Set tY = 2"_tNL_"    Quit tY"_tNL_"}"_tNL_tNL
    Set tBody = tBody_"ClassMethod "_tLong_"A() As %Integer"_tNL_"{"_tNL_"    Set tV = 3"_tNL_"    Quit tV"_tNL_"}"_tNL_tNL
    Quit tBody_"ClassMethod "_tLong_"B() As %Integer"_tNL_"{"_tNL_"    Set tW = 4"_tNL_"    Quit tW"_tNL_"}"_tNL_tNL
}

/// The methods of the comment class: a <code>#dim</code> that initializes nothing with an <code>=</code> in a trailing
/// <code>//</code>, <code>;</code> or <code>/* */</code> comment after four leading <code>#dim</code> lines, and an initializer
/// followed by a comment.
ClassMethod CommentBody() As %String
{
    Set tNL = $Char(10)
    Set tBody = ""
    For tComment = "// sets nothing = 8", "; sets nothing = 8", "/* sets nothing = 8 */" {
        Set tMethod = $Select(tComment [ "//": "Slashes", tComment [ "/*": "Block", 1: "Semicolon")
        Set tBody = tBody_"ClassMethod "_tMethod_"AfterFour() As %Integer"_tNL_"{"_tNL
        For tI = 1:1:4 Set tBody = tBody_"    #dim t"_tI_" As %Integer"_tNL
        Set tBody = tBody_"    #dim t5 As %Integer "_tComment_tNL_"    Set tL = 9"_tNL_"    Quit tL"_tNL_"}"_tNL_tNL
    }
    Quit tBody_"ClassMethod InitWithComment() As %Integer"_tNL_"{"_tNL_"    #dim tG As %Integer = 3 // initializes tG"_tNL_"    Quit tG"_tNL_"}"_tNL_tNL
}

/// The methods of the class with every shape of an initializing <code>#dim</code>: leading, mid-body, nested in a block, after
/// four and after six leading <code>#dim</code> lines that initialize nothing, in capitals, with several variables, with no
/// type, and with a value that holds an equals sign.
ClassMethod DimBody() As %String
{
    Set tNL = $Char(10)
    Set tBody = "ClassMethod Leading() As %Integer"_tNL_"{"_tNL_"    #dim tSC As %Status = $$$OK"_tNL_"    Quit tSC"_tNL_"}"_tNL_tNL
    Set tBody = tBody_"ClassMethod MidBody() As %Integer"_tNL_"{"_tNL_"    Set tA = 1"_tNL_"    #dim tB As %Integer = 2"_tNL_"    Quit tA + tB"_tNL_"}"_tNL_tNL
    Set tBody = tBody_"ClassMethod Nested(pN As %Integer) As %Integer"_tNL_"{"_tNL_"    If pN {"_tNL_"        #dim tC As %Integer = 3"_tNL_"        Quit tC"_tNL_"    }"_tNL_"    Quit 0"_tNL_"}"_tNL_tNL
    Set tBody = tBody_"ClassMethod AfterFour() As %Integer"_tNL_"{"_tNL
    For tI = 1:1:4 Set tBody = tBody_"    #dim t"_tI_" As %Integer"_tNL
    Set tBody = tBody_"    #dim tD As %Integer = 4"_tNL_"    Quit tD"_tNL_"}"_tNL_tNL
    Set tBody = tBody_"ClassMethod AfterSix() As %Integer"_tNL_"{"_tNL
    For tI = 1:1:6 Set tBody = tBody_"    #dim t"_tI_" As %Integer"_tNL
    Set tBody = tBody_"    #dim tE As %Integer = 5"_tNL_"    Quit tE"_tNL_"}"_tNL_tNL
    Set tBody = tBody_"ClassMethod Capitals() As %Integer"_tNL_"{"_tNL_"    #DIM tF As %Integer = 7"_tNL_"    Quit tF"_tNL_"}"_tNL_tNL
    Set tBody = tBody_"ClassMethod Multi() As %Integer"_tNL_"{"_tNL_"    #dim tG, tH As %Integer = 0"_tNL_"    Quit tG"_tNL_"}"_tNL_tNL
    Set tBody = tBody_"ClassMethod NoType() As %Integer"_tNL_"{"_tNL_"    #dim tI = 5"_tNL_"    Quit tI"_tNL_"}"_tNL_tNL
    Quit tBody_"ClassMethod Quoted() As %String"_tNL_"{"_tNL_"    #dim tJ As %String = ""a=b"""_tNL_"    Quit tJ"_tNL_"}"_tNL_tNL
}

}
