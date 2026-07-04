/// <p>Callable facade for the ObjectScript LOC counter library (Epic 22, Story 22.0;
/// decisions D1-D5/D7 in the 2026-07-03 research report). Callable independently of
/// REST — mirrors <class>ExecuteMCPv2.Diagram.Generate</class>.</p>
/// <p>Pipeline per call: <class>ExecuteMCPv2.Loc.Scanner</class> enumeration
/// (StudioOpenDialog, required caller-supplied spec — decision D2) → per-document
/// source retrieval + metadata → <class>ExecuteMCPv2.Loc.Classifier</class> line
/// buckets → aggregate metrics + percentages (D4) + capped top-N largest documents
/// (D5).</p>
/// <p>The aggregation invariant <code>blank + sourceCode + sourceComment + testCode
/// + testComment = totalLines</code> is enforced per document AND in the aggregate as
/// a hard error (the reference tool only warned on stderr).</p>
Class ExecuteMCPv2.Loc.Generate Extends %RegisteredObject
{

/// Count lines of code for every CLS/MAC/INT/INC document matching <var>pSpec</var>.
/// <p><var>pNamespace</var> — target namespace ("" = current). Switched with explicit
/// save/restore (never <code>New $NAMESPACE</code>); the catch path restores first.</p>
/// <p><var>pSpec</var> — REQUIRED document spec (comma-delimited,
/// <code>*</code>/<code>?</code> wildcards; e.g. <code>MyPkg.*.cls,*.mac</code>).
/// Whole-namespace scans require an explicit <code>*</code> (decision D2).</p>
/// <p><var>pOptions</var> — optional <class>%DynamicObject</class>:
/// <code>includeGenerated</code> (boolean, default false — decision D7) and
/// <code>topN</code> (default 20; numeric values are clamped to 1..100 —
/// decision D5; non-numeric junk keeps the default, and the REST layer rejects
/// junk before it reaches this facade).</p>
/// <p><var>pResult</var> — <code>{ filesParsed, totalLines, blankLines, sourceCodeLoc,
/// sourceCommentLoc, testCodeLoc, testCommentLoc, codePct, sourceCodePct, testCodePct,
/// commentPct, whitespacePct, topDocuments: [{name, type, totalLines, codeLoc,
/// commentLoc, isTest}], truncatedTopN }</code>.</p>
ClassMethod Count(pNamespace As %String = "", pSpec As %String = "", pOptions As %DynamicObject = "", Output pResult As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pResult = ""
    Set tOrigNS = $NAMESPACE
    Try {
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(pSpec, "spec")
        If $$$ISERR(tSC) Quit

        ; resolve options (Rule #15: no $Get() around method calls — %IsDefined + %Get)
        Set tIncludeGenerated = 0
        Set tTopN = 20
        If $IsObject(pOptions) {
            If pOptions.%IsDefined("includeGenerated") {
                ; boolean coercion pattern (CR 21.1-A): booleans/numbers coerce; the
                ; "true"/"false"/"0"/"1" strings are accepted; junk keeps the default
                Set tVal = pOptions.%Get("includeGenerated")
                Set tType = pOptions.%GetTypeOf("includeGenerated")
                If (tType = "boolean") || (tType = "number") {
                    Set tIncludeGenerated = ''tVal
                } ElseIf $ZConvert(tVal, "L") = "true" {
                    Set tIncludeGenerated = 1
                } ElseIf $ZConvert(tVal, "L") = "false" {
                    Set tIncludeGenerated = 0
                } ElseIf (tVal = "0") || (tVal = "1") {
                    Set tIncludeGenerated = +tVal
                }
            }
            If pOptions.%IsDefined("topN") {
                ; CR 22.0-2: a present NUMERIC value clamps into 1..100 (matching
                ; the documented contract and the REST layer's 0->1 clamp);
                ; non-numeric junk keeps the default 20
                Set tRawN = pOptions.%Get("topN")
                If (pOptions.%GetTypeOf("topN") = "number") || (tRawN ? 1.N) {
                    Set tN = +tRawN \ 1
                    If tN < 1 Set tN = 1
                    Set tTopN = tN
                }
            }
        }
        If tTopN > 100 Set tTopN = 100

        ; switch to the target namespace (restored below and in the catch path)
        If (pNamespace '= "") && (pNamespace '= tOrigNS) {
            Set $NAMESPACE = pNamespace
        }

        Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).EnumerateDocs(pSpec, tIncludeGenerated, .tDocs)
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Quit
        }

        Set tFiles = 0
        Set tTotal = 0
        Set tBlank = 0
        Set tSrcCode = 0
        Set tSrcComment = 0
        Set tTestCode = 0
        Set tTestComment = 0
        For tI = 1:1:+$Get(tDocs) {
            Set tDocName = tDocs(tI)
            Set tSC = ##class(ExecuteMCPv2.Loc.Scanner).ScanDoc(tDocName, .tCounts, .tIsTest)
            If $$$ISERR(tSC) Quit
            Set tFiles = tFiles + 1
            Set tDocTotal = tCounts("total")
            Set tDocCode = tCounts("sourceCode") + tCounts("testCode")
            Set tDocComment = tCounts("sourceComment") + tCounts("testComment")
            ; per-document bucket-sum invariant (hard error, not a warning)
            Set tDocSum = tCounts("blank") + tDocCode + tDocComment
            If tDocSum '= tDocTotal {
                Set tSC = $$$ERROR($$$GeneralError, "LOC bucket sum ("_tDocSum_") does not equal total lines ("_tDocTotal_") for document '"_tDocName_"'")
                Quit
            }
            Set tTotal = tTotal + tDocTotal
            Set tBlank = tBlank + tCounts("blank")
            Set tSrcCode = tSrcCode + tCounts("sourceCode")
            Set tSrcComment = tSrcComment + tCounts("sourceComment")
            Set tTestCode = tTestCode + tCounts("testCode")
            Set tTestComment = tTestComment + tCounts("testComment")
            ; track per-document data for the top-N list (decision D5): negative
            ; totalLines subscript sorts largest-first; insertion sequence breaks ties
            Set tDocData(tI) = $ListBuild(tDocName, $ZConvert($Piece(tDocName, ".", *), "L"), tDocTotal, tDocCode, tDocComment, +tIsTest)
            Set tSort(-tDocTotal, tI) = ""
        }
        If $$$ISERR(tSC) {
            Set $NAMESPACE = tOrigNS
            Quit
        }

        ; aggregate bucket-sum invariant
        Set tSum = tBlank + tSrcCode + tSrcComment + tTestCode + tTestComment
        If tSum '= tTotal {
            Set tSC = $$$ERROR($$$GeneralError, "LOC aggregate bucket sum ("_tSum_") does not equal total lines ("_tTotal_")")
            Set $NAMESPACE = tOrigNS
            Quit
        }

        ; top-N largest documents (decision D5)
        Set tTopDocs = []
        Set tEmitted = 0
        Set tNegTotal = ""
        For {
            Set tNegTotal = $Order(tSort(tNegTotal))
            Quit:tNegTotal=""
            Set tSeq = ""
            For {
                Set tSeq = $Order(tSort(tNegTotal, tSeq))
                Quit:tSeq=""
                If tEmitted < tTopN {
                    Set tData = tDocData(tSeq)
                    Set tDoc = {}
                    Do tDoc.%Set("name", $List(tData, 1))
                    Do tDoc.%Set("type", $List(tData, 2))
                    Do tDoc.%Set("totalLines", $List(tData, 3), "number")
                    Do tDoc.%Set("codeLoc", $List(tData, 4), "number")
                    Do tDoc.%Set("commentLoc", $List(tData, 5), "number")
                    Do tDoc.%Set("isTest", $List(tData, 6), "boolean")
                    Do tTopDocs.%Push(tDoc)
                    Set tEmitted = tEmitted + 1
                }
            }
            Quit:tEmitted>=tTopN
        }

        Set pResult = {}
        Do pResult.%Set("filesParsed", tFiles, "number")
        Do pResult.%Set("totalLines", tTotal, "number")
        Do pResult.%Set("blankLines", tBlank, "number")
        Do pResult.%Set("sourceCodeLoc", tSrcCode, "number")
        Do pResult.%Set("sourceCommentLoc", tSrcComment, "number")
        Do pResult.%Set("testCodeLoc", tTestCode, "number")
        Do pResult.%Set("testCommentLoc", tTestComment, "number")
        ; percentages (decision D4 — reference CSV keys in camelCase, one decimal)
        Do pResult.%Set("codePct", ..Pct(tSrcCode + tTestCode, tTotal), "number")
        Do pResult.%Set("sourceCodePct", ..Pct(tSrcCode, tTotal), "number")
        Do pResult.%Set("testCodePct", ..Pct(tTestCode, tTotal), "number")
        Do pResult.%Set("commentPct", ..Pct(tSrcComment + tTestComment, tTotal), "number")
        Do pResult.%Set("whitespacePct", ..Pct(tBlank, tTotal), "number")
        Do pResult.%Set("topDocuments", tTopDocs)
        Do pResult.%Set("truncatedTopN", (tFiles > tTopN), "boolean")

        Set $NAMESPACE = tOrigNS
    } Catch ex {
        Set $NAMESPACE = tOrigNS
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// One-decimal percentage: <code>100 * pNum / pDen</code>, 0 when <var>pDen</var> is 0.
ClassMethod Pct(pNum As %Integer, pDen As %Integer) As %Numeric [ Internal ]
{
    If pDen = 0 Quit 0
    Quit +$Justify(100 * pNum / pDen, 0, 1)
}

}
