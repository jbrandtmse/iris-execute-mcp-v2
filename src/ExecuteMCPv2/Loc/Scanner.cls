/// <p>Document enumeration + source retrieval for the ObjectScript LOC counter
/// (Epic 22, Story 22.0; decisions D1/D2/D7). Enumerates the CURRENT namespace's
/// document dictionary via the <code>%RoutineMgr:StudioOpenDialog</code> query and
/// retrieves source text via
/// <method>%Atelier.v1.Utils.TextServices:GetTextAsArray</method> (pFlags=0 = UDL
/// text — probe-verified; pFlags=1 returns the XML export format).</p>
/// <p>Only CLS/MAC/INT/INC documents are scanned; other document types matched by a
/// broad spec (CSP, HL7 schemas, ...) are skipped. Generated documents (e.g. the
/// <code>.int</code> code produced by class compilation) are excluded unless
/// <var>pIncludeGenerated</var> is set (decision D7 — they would double-count their
/// source class/routine).</p>
Class ExecuteMCPv2.Loc.Scanner Extends %RegisteredObject
{

/// Enumerate documents in the current namespace matching <var>pSpec</var>
/// (comma-delimited, <code>*</code>/<code>?</code> wildcards — e.g.
/// <code>MyPkg.*.cls,*.mac</code>), filtered to CLS/MAC/INT/INC.
/// <p>Positional query args (probe-verified against the irislib signature):
/// <code>Execute(Spec, Dir=1, OrderBy=1, SystemFiles=0, Flat=1, NotStudio=0,
/// ShowGenerated)</code>.</p>
/// <p><var>pDocs</var> — output: <code>pDocs</code> = count, <code>pDocs(1..n)</code>
/// = full document names including the type suffix (e.g. <code>Pkg.Cls.cls</code>).</p>
ClassMethod EnumerateDocs(pSpec As %String, pIncludeGenerated As %Boolean = 0, Output pDocs) As %Status
{
    Set tSC = $$$OK
    Try {
        Kill pDocs
        Set pDocs = 0
        Set tRS = ##class(%ResultSet).%New("%RoutineMgr:StudioOpenDialog")
        Set tSC = tRS.Execute(pSpec, 1, 1, 0, 1, 0, +pIncludeGenerated)
        If $$$ISERR(tSC) Quit
        ; CR 22.0-5: capture Next's status — a mid-stream query error must
        ; propagate, not read as a silent end-of-results undercount
        Set tSCNext = $$$OK
        While tRS.Next(.tSCNext) {
            Set tName = tRS.Get("Name")
            Set tExt = $ZConvert($Piece(tName, ".", *), "L")
            If (tExt '= "cls") && (tExt '= "mac") && (tExt '= "int") && (tExt '= "inc") Continue
            Set pDocs = pDocs + 1
            Set pDocs(pDocs) = tName
        }
        If $$$ISERR(tSCNext) Set tSC = tSCNext
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Build the per-class metadata for one CLS document (decision D3):
/// <p><var>pIsTest</var> — 1 when the compiled class is a transitive
/// <class>%UnitTest.TestCase</class> subclass (via <code>$CLASSMETHOD %IsA</code>;
/// probe-verified to throw <CLASS DOES NOT EXIST> for saved-but-uncompiled or
/// nonexistent classes — those fall back to not-test).</p>
/// <p><var>pPyMethods</var> — set of embedded-python method names
/// (<code>pPyMethods(name)=1</code>), built by iterating
/// <class>%Dictionary.CompiledClass</class>.Methods (flattened, includes inherited);
/// empty when the class is not compiled.</p>
ClassMethod BuildClassMetadata(pClassName As %String, Output pIsTest As %Boolean, ByRef pPyMethods) As %Status
{
    Set tSC = $$$OK
    Set pIsTest = 0
    ; CR 22.0-3: reset the accumulator — a caller reusing one ByRef array across
    ; documents must not inherit the previous class's python-method names
    Kill pPyMethods
    Try {
        Try {
            Set pIsTest = +$CLASSMETHOD(pClassName, "%IsA", "%UnitTest.TestCase")
        } Catch exIsA {
            ; uncompiled or nonexistent class — fall back to not-test
            Set pIsTest = 0
        }
        Set tCC = ##class(%Dictionary.CompiledClass).%OpenId(pClassName)
        If $IsObject(tCC) {
            For tI = 1:1:tCC.Methods.Count() {
                Set tMethod = tCC.Methods.GetAt(tI)
                If tMethod.Language = "python" Set pPyMethods(tMethod.Name) = 1
            }
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Scan ONE document: retrieve its source lines, resolve per-document metadata
/// (CLS only — routines/includes are never file-level test and have no python map;
/// documented delta from the reference tool's <code>/tests/</code>-directory rule,
/// which has no namespace equivalent), and classify every line.
/// <p><var>pCounts</var> — the five buckets + total (see
/// <method>ExecuteMCPv2.Loc.Classifier:ClassifyDoc</method>).</p>
/// <p><var>pIsTest</var> — the file-level test flag resolved for this document.</p>
ClassMethod ScanDoc(pDocName As %String, Output pCounts, Output pIsTest As %Boolean) As %Status
{
    Set tSC = $$$OK
    Set pIsTest = 0
    Try {
        Set tSC = ##class(%Atelier.v1.Utils.TextServices).GetTextAsArray(pDocName, 0, .tLines)
        If $$$ISERR(tSC) Quit
        Set tExt = $ZConvert($Piece(pDocName, ".", *), "L")
        If tExt = "cls" {
            Set tClassName = $Piece(pDocName, ".", 1, $Length(pDocName, ".") - 1)
            Set tSC = ..BuildClassMetadata(tClassName, .pIsTest, .tPyMethods)
            If $$$ISERR(tSC) Quit
        }
        Set tSC = ##class(ExecuteMCPv2.Loc.Classifier).ClassifyDoc(.tLines, pIsTest, .tPyMethods, .pCounts)
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

}
