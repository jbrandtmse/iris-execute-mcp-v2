/// <p>Stateful line classifier for the ObjectScript LOC counter (Epic 22, Story 22.0;
/// decisions D3/D4 in the 2026-07-03 research report). A <b>pure function of
/// (line array + per-document metadata)</b> — no REST, no live document access —
/// so synthetic fixtures can drive it directly.</p>
/// <p>Faithful port of the reference <code>cos_loc_counter.sh</code> AWK state machine:
/// every raw line lands in exactly ONE of five buckets (blank / sourceCode /
/// sourceComment / testCode / testComment). Comment syntaxes: leading <code>//</code>
/// (covers <code>///</code>), <code>;</code>, <code>#;</code>, <code>##;</code>,
/// stateful <code>/* ... */</code> blocks, and leading <code>#</code> inside embedded
/// python method bodies. Preprocessor directives (<code>#Define</code>/<code>#Dim</code>/
/// <code>#Include</code>/<code>#If...</code>) are CODE. String literals are masked
/// before any marker detection (<code>""</code> escapes honored). XData/Storage block
/// lines count as code (deliberate, documented carry-over from the reference tool).</p>
/// <p>Test bucketing (decision D3 — hybrid): the caller supplies the file-level
/// <var>pIsTest</var> flag (resolved via <code>%IsA</code> upstream) and a
/// method-name→python map (resolved via <class>%Dictionary.CompiledMethod</class>
/// upstream); this class keeps the reference tool's <code>Test*</code>/lifecycle
/// method-name detection and brace-depth scoping over the masked line.</p>
Class ExecuteMCPv2.Loc.Classifier Extends %RegisteredObject
{

/// Classify one document's lines into the five buckets.
/// <p><var>pLines</var> — integer-subscripted line array: <code>pLines(0)</code> = line
/// count, <code>pLines(1..n)</code> = raw lines (the shape returned by
/// <method>%Atelier.v1.Utils.TextServices:GetTextAsArray</method>).</p>
/// <p><var>pIsTest</var> — file-level test flag: when 1 the ENTIRE document is
/// test-bucketed (including <code>///</code> doc lines above the Class line).</p>
/// <p><var>pPyMethods</var> — set of embedded-python method names:
/// <code>pPyMethods(name)=1</code> (built from <class>%Dictionary.CompiledMethod</class>
/// by the scanner; empty for routines/includes or uncompiled classes).</p>
/// <p><var>pCounts</var> — output buckets: <code>pCounts("blank")</code>,
/// <code>("sourceCode")</code>, <code>("sourceComment")</code>, <code>("testCode")</code>,
/// <code>("testComment")</code>, <code>("total")</code>.</p>
ClassMethod ClassifyDoc(ByRef pLines, pIsTest As %Boolean = 0, ByRef pPyMethods, Output pCounts) As %Status
{
    Set tSC = $$$OK
    Try {
        Kill pCounts
        Set pCounts("blank") = 0
        Set pCounts("sourceCode") = 0
        Set pCounts("sourceComment") = 0
        Set pCounts("testCode") = 0
        Set pCounts("testComment") = 0
        Set pCounts("total") = 0

        ; per-document state (mirrors the reference AWK FNR==1 reset)
        Set tInBlock = 0    ; inside a /* ... */ block comment spanning lines
        Set tMActive = 0    ; inside a method-scoped state (test method or python)
        Set tMTest = 0      ; ...that method is a Test*/lifecycle method
        Set tMPy = 0        ; ...that method is [ Language = python ]
        Set tMStarted = 0   ; method opening brace has been seen
        Set tMDepth = 0     ; current brace depth within the tracked method

        Set tTab = $Char(9)
        Set tTotal = +$Get(pLines(0))
        For tI = 1:1:tTotal {
            Set pCounts("total") = pCounts("total") + 1
            Set tLine = $Get(pLines(tI))
            ; tolerate CRLF line endings (strip one trailing CR)
            If $Extract(tLine, *) = $Char(13) Set tLine = $Extract(tLine, 1, *-1)

            ; -- 1. Blank line: empty or whitespace-only ------------------------
            If $Translate(tLine, " "_tTab) = "" {
                Set pCounts("blank") = pCounts("blank") + 1
                Continue
            }

            ; -- 2. Continuation of a multi-line /* ... */ block comment --------
            If tInBlock {
                Set tP = $Find(tLine, "*/")
                If tP = 0 {
                    ; still inside the block
                    Do ..AddComment(.pCounts, pIsTest || tMTest)
                    Continue
                }
                Set tInBlock = 0
                Set tLine = $Extract(tLine, tP, *)
                If $Translate(tLine, " "_tTab) = "" {
                    Do ..AddComment(.pCounts, pIsTest || tMTest)
                    Continue
                }
                ; non-blank remainder after */ — fall through and classify it as a
                ; fresh line (it may be code, another comment, or open a new block)
            }

            ; -- 3. Neutralize string literals ----------------------------------
            Set tS = ..MaskStrings(tLine)

            ; -- 4. Leading single-line comment check ---------------------------
            ; // (covers ///), ; (legacy MUMPS), #; and ##; (preprocessor comments
            ; — but NOT #Define/#Dim/...), # only inside a python method body
            Set tT = ..StripLeading(tS)
            If ($Extract(tT, 1, 2) = "//") || ($Extract(tT, 1) = ";") || ($Extract(tT, 1, 2) = "#;") || ($Extract(tT, 1, 3) = "##;") || (tMPy && ($Extract(tT, 1) = "#")) {
                Do ..AddComment(.pCounts, pIsTest || tMTest)
                Continue
            }

            ; -- 5. Method-scoped state detection (only outside an active method)
            ; The signature line itself is classified under the NEW state, so a
            ; "Method TestFoo()" line counts as test code.
            If 'tMActive {
                Set tName = ..MethodSignatureName(tS, .tAfterName)
                If tName '= "" {
                    Set tIsTm = 0
                    If 'pIsTest && ..IsTestMethodName(tName) {
                        ; the name must be followed by optional spaces/tabs then "("
                        If $Extract(..StripLeading(tAfterName), 1) = "(" Set tIsTm = 1
                    }
                    ; decision D3: python resolved via the dictionary-built map, not
                    ; a signature regex — the signature line still triggers scope entry
                    Set tIsPm = ($Get(pPyMethods(tName)) = 1)
                    If tIsTm || tIsPm {
                        Set tMActive = 1
                        Set tMTest = tIsTm
                        Set tMPy = tIsPm
                        Set tMStarted = 0
                        Set tMDepth = 0
                    }
                }
            }

            ; -- 6. Strip inline comments, scanning left-to-right ---------------
            ; A // encountered first comments out any /* after it (and vice versa:
            ; a /* ... */ pair may hide a //), so the scan must respect order.
            Set tEntering = 0
            While 1 {
                Set tPs = $Find(tS, "//")
                Set tPb = $Find(tS, "/*")
                If (tPb > 0) && ((tPs = 0) || (tPb < tPs)) {
                    Set tRest = $Extract(tS, tPb, *)
                    Set tQ = $Find(tRest, "*/")
                    If tQ > 0 {
                        ; complete inline /* ... */ — excise and keep scanning
                        Set tS = $Extract(tS, 1, tPb - 3)_" "_$Extract(tRest, tQ, *)
                        Continue
                    }
                    ; unterminated /* — block comment begins on this line
                    Set tS = $Extract(tS, 1, tPb - 3)
                    Set tEntering = 1
                    Quit
                } ElseIf tPs > 0 {
                    ; trailing // comment — everything after it is dead
                    Set tS = $Extract(tS, 1, tPs - 3)
                    Quit
                } Else {
                    Quit
                }
            }
            Set tInBlock = tEntering

            ; -- 7. Final classification ----------------------------------------
            If $Translate(tS, " "_tTab) = "" {
                ; nothing but comment text remained (e.g. a line that is only
                ; "/* opening" or "/* a */ // b") — comment line
                Do ..AddComment(.pCounts, pIsTest || tMTest)
            } Else {
                Do ..AddCode(.pCounts, pIsTest || tMTest)
            }

            ; -- 8. Update method-scope brace depth (comments/strings already gone)
            If tMActive {
                Set tOpen = $Length(tS) - $Length($Translate(tS, "{"))
                If tOpen > 0 {
                    Set tMDepth = tMDepth + tOpen
                    Set tMStarted = 1
                }
                Set tClose = $Length(tS) - $Length($Translate(tS, "}"))
                Set tMDepth = tMDepth - tClose
                ; Method ends when we have seen the opening brace and depth returns
                ; to 0. The closing-brace line itself was already classified (as
                ; test/python), which is the desired behavior: the brace belongs to
                ; the method.
                If tMStarted && (tMDepth <= 0) {
                    Set tMActive = 0
                    Set tMTest = 0
                    Set tMPy = 0
                }
            }
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Route one CODE line to the test or source tally (reference <code>add_code()</code>).
ClassMethod AddCode(ByRef pCounts, pIsTestScope As %Boolean) [ Internal ]
{
    Set tKey = $Select(pIsTestScope: "testCode", 1: "sourceCode")
    Set pCounts(tKey) = pCounts(tKey) + 1
}

/// Route one COMMENT line to the test or source tally (reference <code>add_comment()</code>).
ClassMethod AddComment(ByRef pCounts, pIsTestScope As %Boolean) [ Internal ]
{
    Set tKey = $Select(pIsTestScope: "testComment", 1: "sourceComment")
    Set pCounts(tKey) = pCounts(tKey) + 1
}

/// Mask every complete ObjectScript string literal (<code>"..."</code> with
/// <code>""</code> as the escaped-quote sequence) with an empty-string token
/// <code>""</code>, so comment markers and braces inside literals never match.
/// A manual character scan mirrors the reference tool's
/// <code>gsub(/"([^"]|"")*"/, "\"\"", s)</code> with POSIX leftmost-LONGEST
/// semantics (CR 22.0-1): when the greedy escape-pair scan runs off the end of
/// the line, the literal is re-closed at the LAST quote that yields a valid
/// parse — the regex backtracks, so <code>"x""</code> masks as the literal
/// <code>"x"</code> plus a dangling quote. Only a literal with NO valid close
/// at all (a truly unterminated <code>"abc</code>) is left untouched, matching
/// the regex's no-match behavior (reference-verified fixtures).
ClassMethod MaskStrings(pLine As %String) As %String
{
    Set tOut = ""
    Set tLen = $Length(pLine)
    Set tI = 1
    While tI <= tLen {
        Set tCh = $Extract(pLine, tI)
        If tCh '= """" {
            Set tOut = tOut_tCh
            Set tI = tI + 1
            Continue
        }
        ; opening quote — find the literal's end, honoring "" escapes; remember
        ; the last quote where a "" pair could instead CLOSE the literal
        Set tJ = tI + 1
        Set tClosed = 0
        Set tLastPairClose = 0
        While tJ <= tLen {
            If $Extract(pLine, tJ) = """" {
                If $Extract(pLine, tJ + 1) = """" {
                    Set tLastPairClose = tJ
                    Set tJ = tJ + 2
                } Else {
                    Set tClosed = 1
                    Quit
                }
            } Else {
                Set tJ = tJ + 1
            }
        }
        If 'tClosed && (tLastPairClose > 0) {
            ; greedy scan ran off the line — backtrack: the regex's longest
            ; valid match closes at the last pair-start quote
            Set tClosed = 1
            Set tJ = tLastPairClose
        }
        If tClosed {
            Set tOut = tOut_""""""
            Set tI = tJ + 1
        } Else {
            ; no valid close anywhere — leave the remainder untouched (regex
            ; no-match parity)
            Set tOut = tOut_$Extract(pLine, tI, *)
            Set tI = tLen + 1
        }
    }
    Quit tOut
}

/// Strip leading spaces and tabs (exact parity with the reference tool's
/// <code>sub(/^[ \t]+/, "", t)</code> — no other whitespace classes).
ClassMethod StripLeading(pS As %String) As %String
{
    Set tI = 1
    Set tTab = $Char(9)
    While ($Extract(pS, tI) = " ") || ($Extract(pS, tI) = tTab) {
        Set tI = tI + 1
    }
    Quit $Extract(pS, tI, *)
}

/// If the masked line is a method signature (<code>^[ \t]*(ClassMethod|Method)[ \t]+</code>),
/// return the method name (maximal run of <code>[A-Za-z0-9_%]</code> after the keyword)
/// and set <var>pAfterName</var> to the text following the name. Returns "" when the
/// line is not a method signature.
ClassMethod MethodSignatureName(pS As %String, Output pAfterName As %String) As %String
{
    Set pAfterName = ""
    Set tT = ..StripLeading(pS)
    Set tTab = $Char(9)
    Set tRest = ""
    If ($Extract(tT, 1, 11) = "ClassMethod") && (($Extract(tT, 12) = " ") || ($Extract(tT, 12) = tTab)) {
        Set tRest = $Extract(tT, 12, *)
    } ElseIf ($Extract(tT, 1, 6) = "Method") && (($Extract(tT, 7) = " ") || ($Extract(tT, 7) = tTab)) {
        Set tRest = $Extract(tT, 7, *)
    } Else {
        Quit ""
    }
    Set tRest = ..StripLeading(tRest)
    ; extract the maximal run of name characters ([A-Za-z0-9_%])
    Set tName = ""
    Set tI = 1
    While tI <= $Length(tRest) {
        Set tC = $Ascii(tRest, tI)
        If ((tC >= 48) && (tC <= 57)) || ((tC >= 65) && (tC <= 90)) || ((tC >= 97) && (tC <= 122)) || (tC = 95) || (tC = 37) {
            Set tName = tName_$Char(tC)
            Set tI = tI + 1
        } Else {
            Quit
        }
    }
    If tName = "" Quit ""
    Set pAfterName = $Extract(tRest, $Length(tName) + 1, *)
    Quit tName
}

/// True when <var>pName</var> matches the reference tool's test-method name pattern:
/// <code>Test[A-Za-z0-9_]*</code> or a %UnitTest lifecycle method name.
ClassMethod IsTestMethodName(pName As %String) As %Boolean
{
    If (pName = "OnBeforeAllTests") || (pName = "OnAfterAllTests") || (pName = "OnBeforeOneTest") || (pName = "OnAfterOneTest") Quit 1
    If $Extract(pName, 1, 4) '= "Test" Quit 0
    ; the tail must be [A-Za-z0-9_]* (no % — parity with the reference regex)
    Set tTail = $Extract(pName, 5, *)
    Set tOk = 1
    For tI = 1:1:$Length(tTail) {
        Set tC = $Ascii(tTail, tI)
        If ((tC >= 48) && (tC <= 57)) || ((tC >= 65) && (tC <= 90)) || ((tC >= 97) && (tC <= 122)) || (tC = 95) {
            Continue
        }
        Set tOk = 0
        Quit
    }
    Quit tOk
}

}
