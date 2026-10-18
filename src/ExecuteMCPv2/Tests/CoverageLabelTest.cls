/// Unit tests for the preprocessor-line rule and the INT label lines of the class-source map of
/// <class>ExecuteMCPv2.Coverage.Job</class> (Story 40.2). Each map test compiles a disposable class of its own and removes it.
/// <p>No test here starts a Line-by-Line session or terminates a process. The expected values are the live capture of
/// <code>SourceMap</code>, IRIS 2026.2 build 221U, 2026-10-18.</p>
Class ExecuteMCPv2.Tests.CoverageLabelTest Extends %UnitTest.TestCase
{

/// The disposable class with five leading preprocessor lines.
Parameter DIRECTIVECLASS = "ExecuteMCPv2.Temp.Story402Directive";

/// The disposable class with two methods whose names share their first 31 characters.
Parameter SHAREDCLASS = "ExecuteMCPv2.Temp.Story402Shared";

Method OnAfterOneTest(testname As %String) As %Status
{
    Do $System.OBJ.Delete(..#DIRECTIVECLASS, "-d")
    Do $System.OBJ.Delete(..#SHAREDCLASS, "-d")
    Quit $$$OK
}

/// A preprocessor line is one `#` and a letter or a semicolon after the leading blanks; a `##` line is not one.
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

/// Two methods whose names share their first 31 characters get labels the dictionary alone tells apart, so neither has a
/// known label line; a method with a short name does. A leading preprocessor line has no INT line in either case.
Method TestSourceMapOfMethodsThatShareAShortenedName() As %Status
{
    Set tName = ..#SHAREDCLASS
    Set tNL = $Char(10)
    Set tLong = "AVeryLongMethodNameThatExceedsThirtyOneCharacters"
    Set tText = "Class "_tName_tNL_"{"_tNL_tNL
    Set tText = tText_"ClassMethod "_tLong_"One() As %Integer"_tNL_"{"_tNL_"    Set tX = 1"_tNL_"    Quit tX"_tNL_"}"_tNL_tNL
    Set tText = tText_"ClassMethod "_tLong_"Two() As %Integer"_tNL_"{"_tNL_"    #dim tY As %Integer"_tNL_"    Set tY = 2"_tNL_"    Quit tY"_tNL_"}"_tNL_tNL
    Set tText = tText_"ClassMethod Short() As %Integer"_tNL_"{"_tNL_"    Set tZ = 3"_tNL_"    Quit tZ"_tNL_"}"_tNL_tNL_"}"_tNL
    Do $$$AssertStatusOK(##class(%Compiler.UDL.TextServices).SetTextFromString(, tName, tText, tNL), "the class is saved")
    Do $$$AssertStatusOK($System.OBJ.Compile(tName, "cuk-d"), "the class is compiled")
    Set tSC = ##class(ExecuteMCPv2.Coverage.Job).SourceMap("", tName, .tMap)
    Do $$$AssertStatusOK(tSC, "the map is built")
    Do $$$AssertEquals($List(tMap("m", 1), 1), tLong_"One", "the first method")
    Do $$$AssertEquals($List(tMap("m", 1), 5), 0, "it shares its shortened name, so it has no known label")
    Do $$$AssertEquals($List(tMap("m", 2), 1), tLong_"Two", "the second method")
    Do $$$AssertEquals($List(tMap("m", 2), 5), 0, "so does it")
    Do $$$AssertEquals(tMap("m", 2, 1), 0, "its #dim line has no INT line")
    Do $$$AssertTrue(tMap("m", 2, 2) > 0, "its first statement has one")
    Do $$$AssertEquals($List(tMap("m", 3), 1), "Short", "the third method")
    Do $$$AssertTrue($List(tMap("m", 3), 5) > 0, "a method with a short name has its label line")
    Quit $$$OK
}

}
