/// <p>Unit tests for <class>ExecuteMCPv2.Loc.Scanner</class> (Story 22.0,
/// AC 22.0.2/22.0.3/22.0.5/22.0.11). Run against the live HSCUSTOM dictionary using
/// this project's own deployed classes and the LocFixture* fixture classes.</p>
Class ExecuteMCPv2.Tests.LocScannerTest Extends %UnitTest.TestCase
{

/// Constructor must pass initvalue through to the parent (project testing rules).
Method %OnNew(initvalue As %String = "") As %Status
{
    Set tSC = ##super(initvalue)
    If $$$ISERR(tSC) Quit tSC
    Quit $$$OK
}

/// Return 1 when pName is present in the enumerated pDocs array.
Method DocsContain(ByRef pDocs, pName As %String) As %Boolean
{
    Set tFound = 0
    For tI = 1:1:+$Get(pDocs) {
        If pDocs(tI) = pName Set tFound = 1 Quit
    }
    Quit tFound
}

/// AC 22.0.2: spec enumeration is Flat, extension-suffixed, and type-filtered.
Method TestEnumerateSpecShape()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).EnumerateDocs("ExecuteMCPv2.Loc.*.cls", 0, .tDocs)
    Do $$$AssertStatusOK(tSC, "EnumerateDocs succeeds for package spec")
    Do $$$AssertEquals(+$Get(tDocs), 3, "Exactly the three Loc library classes match")
    Do $$$AssertTrue(..DocsContain(.tDocs, "ExecuteMCPv2.Loc.Classifier.cls"), "Classifier.cls enumerated with type suffix")
    Do $$$AssertTrue(..DocsContain(.tDocs, "ExecuteMCPv2.Loc.Scanner.cls"), "Scanner.cls enumerated")
    Do $$$AssertTrue(..DocsContain(.tDocs, "ExecuteMCPv2.Loc.Generate.cls"), "Generate.cls enumerated")
}

/// AC 22.0.2: a multi-part comma-delimited spec unions its parts.
Method TestEnumerateMultiPartSpec()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).EnumerateDocs("ExecuteMCPv2.Loc.*.cls,ExecuteMCPv2.REST.*.cls", 0, .tDocs)
    Do $$$AssertStatusOK(tSC, "EnumerateDocs succeeds for multi-part spec")
    Do $$$AssertTrue(+$Get(tDocs) > 3, "Union yields more than the Loc classes alone")
    Do $$$AssertTrue(..DocsContain(.tDocs, "ExecuteMCPv2.Loc.Classifier.cls"), "First spec part present")
    Do $$$AssertTrue(..DocsContain(.tDocs, "ExecuteMCPv2.REST.Loc.cls"), "Second spec part present")
}

/// AC 22.0.2 / D7: ShowGenerated=0 excludes compiler-generated .int documents;
/// includeGenerated=1 reveals them.
Method TestEnumerateGeneratedToggle()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).EnumerateDocs("ExecuteMCPv2.Loc.*.int", 0, .tDocsOff)
    Do $$$AssertStatusOK(tSC, "EnumerateDocs succeeds with generated excluded")
    Do $$$AssertEquals(+$Get(tDocsOff), 0, "No generated .int visible by default")
    Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).EnumerateDocs("ExecuteMCPv2.Loc.*.int", 1, .tDocsOn)
    Do $$$AssertStatusOK(tSC, "EnumerateDocs succeeds with generated included")
    Do $$$AssertTrue(+$Get(tDocsOn) > 0, "Generated .int documents appear with includeGenerated")
}

/// AC 22.0.5 / D3: transitive %UnitTest.TestCase inheritance through the
/// intermediate LocFixtureBase is detected (the reference regex would miss it).
Method TestTransitiveTestClassDetection()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).BuildClassMetadata("ExecuteMCPv2.Tests.LocFixtureChild", .tIsTest, .tPy)
    Do $$$AssertStatusOK(tSC, "BuildClassMetadata succeeds for fixture child")
    Do $$$AssertEquals(tIsTest, 1, "LocFixtureChild is a test class TRANSITIVELY via the intermediate base")
}

/// Direct %UnitTest.TestCase subclasses are detected too.
Method TestDirectTestClassDetection()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).BuildClassMetadata("ExecuteMCPv2.Tests.LocFixtureBase", .tIsTest, .tPy)
    Do $$$AssertStatusOK(tSC, "BuildClassMetadata succeeds for fixture base")
    Do $$$AssertEquals(tIsTest, 1, "LocFixtureBase is a test class directly")
}

/// Non-test classes report 0; uncompiled/nonexistent classes fall back to
/// not-test WITHOUT an error status (probe-verified <CLASS DOES NOT EXIST> path).
Method TestNonTestAndUncompiledFallback()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).BuildClassMetadata("ExecuteMCPv2.Loc.Classifier", .tIsTest, .tPy)
    Do $$$AssertStatusOK(tSC, "BuildClassMetadata succeeds for non-test class")
    Do $$$AssertEquals(tIsTest, 0, "Library class is not a test class")
    Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).BuildClassMetadata("ExecuteMCPv2.NoSuch.ClassZZ", .tIsTest2, .tPy2)
    Do $$$AssertStatusOK(tSC, "Nonexistent class does not raise an error")
    Do $$$AssertEquals(tIsTest2, 0, "Nonexistent class falls back to not-test")
}

/// AC 22.0.5 / D3: the python-method map is built from
/// %Dictionary.CompiledMethod.Language (not a signature regex).
Method TestPythonMethodMap()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).BuildClassMetadata("ExecuteMCPv2.Tests.LocFixtureChild", .tIsTest, .tPy)
    Do $$$AssertStatusOK(tSC, "BuildClassMetadata succeeds")
    Do $$$AssertEquals(+$Get(tPy("PyHelper")), 1, "PyHelper found as an embedded-python method")
    Do $$$AssertEquals(+$Get(tPy("TestPythonMethodMap")), 0, "ObjectScript methods are not in the python map")
}

/// AC 22.0.3: ScanDoc retrieves a live document and classifies it whole-file as
/// test (fixture child: doc comments -> testComment, python # line included).
Method TestScanDocFixtureChild()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).ScanDoc("ExecuteMCPv2.Tests.LocFixtureChild.cls", .tCounts, .tIsTest)
    Do $$$AssertStatusOK(tSC, "ScanDoc succeeds for fixture child")
    Do $$$AssertEquals(tIsTest, 1, "Fixture child scanned as a test document")
    Do $$$AssertTrue(tCounts("total") > 0, "Fixture child has lines")
    Do $$$AssertTrue(tCounts("testCode") > 0, "Test code counted")
    Do $$$AssertTrue(tCounts("testComment") > 0, "Test comments counted (doc banner + python #)")
    Do $$$AssertEquals(tCounts("sourceCode"), 0, "No source code in a file-level test document")
    Do $$$AssertEquals(tCounts("sourceComment"), 0, "No source comments in a file-level test document")
    Do $$$AssertEquals(tCounts("blank") + tCounts("sourceCode") + tCounts("sourceComment") + tCounts("testCode") + tCounts("testComment"), tCounts("total"), "Bucket-sum invariant on a live document")
}

/// A nonexistent document propagates an error status from source retrieval.
Method TestScanDocMissingDocument()
{
    Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).ScanDoc("ExecuteMCPv2.NoSuch.DocZZ.cls", .tCounts, .tIsTest)
    Do $$$AssertStatusNotOK(tSC, "ScanDoc reports an error for a missing document")
}

}
