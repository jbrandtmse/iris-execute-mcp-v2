/// Callable facade for the message-trace sequence-diagram library (Epic 21, Stories
/// 21.0/21.1; architecture decision G1). Callable independently of REST.
/// <p>For each requested session: <class>ExecuteMCPv2.Diagram.Loader</class> →
/// <class>ExecuteMCPv2.Diagram.Correlator</class> →
/// <class>ExecuteMCPv2.Diagram.Compressor</class> (pair tier, then episode tier) →
/// <class>ExecuteMCPv2.Diagram.Writer</class>, producing
/// <code>{ diagrams: [{ sessionId, mermaid, messageCount, warnings, truncated, dedupOf? }], count }</code>
/// (decision G3 output contract). Sessions are processed one at a time — no
/// cross-session SQL.</p>
/// <p><b>Cross-session dedup</b> (Story 21.1, §6.3 — default ON, disable via the
/// <code>dedup</code> option): after per-session generation, diagrams are compared with
/// the full I2 <code>%% Session …</code> metadata header line normalized (improvement
/// I2 interplay — session id, message count AND time span all differ between
/// otherwise-identical flows) AND per-message row-id tokens in <code>%%</code> warning
/// comments masked (post-epic smoke fix 2026-07-03 — anomaly warnings name each
/// session's own message ids, which otherwise blocked dedup on virtually every real
/// trace); a later session whose normalized text matches an earlier
/// one keeps its own entry (sessionId, mermaid, messageCount, warnings, truncated) and
/// additionally reports <code>dedupOf</code> = the first session id carrying that flow.</p>
/// <p>Best-effort contract: per-session anomalies surface as structured warnings and
/// <code>%%</code> comments; a per-session hard failure (e.g. Ens.MessageHeader absent in
/// a non-interoperability namespace) becomes a comment-only diagram plus a warning rather
/// than failing the call.</p>
Class ExecuteMCPv2.Diagram.Generate Extends %RegisteredObject
{

/// Generate one Mermaid sequence diagram per session id.
/// <p><var>pSessionIds</var> — <class>%Library.ListOfDataTypes</class> of session ids.</p>
/// <p><var>pOptions</var> — optional <class>%DynamicObject</class>:
/// <code>labelMode</code> (<code>"full"</code> default / <code>"short"</code> = last dotted
/// segment), <code>maxRows</code> (default 2000, max 10000), and <code>dedup</code>
/// (boolean, default true — cross-session dedup via <code>dedupOf</code>).</p>
/// <p><var>pResult</var> — <code>{ diagrams: [...], count: n }</code>.</p>
ClassMethod Run(pSessionIds As %Library.ListOfDataTypes, pOptions As %DynamicObject = "", Output pResult As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pResult = ""
    Try {
        ; resolve options (Rule #15: no $Get() around method calls — %IsDefined + %Get)
        Set tLabelMode = "full"
        Set tMaxRows = 2000
        Set tDedup = 1
        If $IsObject(pOptions) {
            If pOptions.%IsDefined("labelMode") {
                Set tMode = pOptions.%Get("labelMode")
                If (tMode = "full") || (tMode = "short") Set tLabelMode = tMode
            }
            If pOptions.%IsDefined("maxRows") {
                Set tMax = +pOptions.%Get("maxRows") \ 1
                If tMax > 0 Set tMaxRows = tMax
            }
            If pOptions.%IsDefined("dedup") {
                ; JSON booleans arrive as 1/0 (%GetTypeOf "boolean"); numbers and the
                ; "true"/"false"/"0"/"1" strings are accepted defensively. Anything else
                ; (JSON null, junk strings like "yes") KEEPS the documented default (ON)
                ; instead of silently disabling dedup via numeric coercion (''"yes" = 0)
                ; — CR 21.1-A review fix.
                Set tVal = pOptions.%Get("dedup")
                Set tType = pOptions.%GetTypeOf("dedup")
                If (tType = "boolean") || (tType = "number") {
                    Set tDedup = ''tVal
                } ElseIf $ZConvert(tVal, "L") = "true" {
                    Set tDedup = 1
                } ElseIf $ZConvert(tVal, "L") = "false" {
                    Set tDedup = 0
                } ElseIf (tVal = "0") || (tVal = "1") {
                    Set tDedup = +tVal
                }
            }
        }
        If tMaxRows > 10000 Set tMaxRows = 10000

        Set tDiagrams = []
        Set tCount = 0
        If $IsObject(pSessionIds) Set tCount = pSessionIds.Count()
        For tI = 1:1:tCount {
            Set tSessionId = pSessionIds.GetAt(tI)
            Set tDiag = ..GenerateOne(tSessionId, tLabelMode, tMaxRows)
            Do tDiagrams.%Push(tDiag)
        }

        ; ── cross-session dedup (Story 21.1, §6.3; §6.4 item 9) ──────────────
        ; Exact full-text comparison of the header-normalized diagrams (request order;
        ; at most 20 sessions per call, so the linear scan is trivial). Empty sessions
        ; normalize identical and DO dedup — an empty/blank key never errors (item 9).
        If tDedup && (tDiagrams.%Size() > 1) {
            Set tKept = 0
            For tI = 0:1:tDiagrams.%Size() - 1 {
                Set tDiag = tDiagrams.%Get(tI)
                Set tNorm = ..NormalizeForDedup(tDiag.%Get("mermaid"))
                Set tFirstId = ""
                For tJ = 1:1:tKept {
                    If tNormText(tJ) = tNorm {
                        Set tFirstId = tNormFirst(tJ)
                        Quit
                    }
                }
                If tFirstId '= "" {
                    Do tDiag.%Set("dedupOf", +tFirstId, "number")
                } Else {
                    Set tKept = tKept + 1
                    Set tNormText(tKept) = tNorm
                    Set tNormFirst(tKept) = tDiag.%Get("sessionId")
                }
            }
        }

        Set pResult = {}
        Do pResult.%Set("diagrams", tDiagrams)
        Do pResult.%Set("count", tDiagrams.%Size(), "number")
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Normalize one diagram text for cross-session comparison (improvement I2 interplay):
/// the ENTIRE <code>%% Session …</code> line-2 header (session id, message count, time
/// span — or the failure-shape header) is replaced with a fixed token, and per-message
/// row-id tokens (<code>message 28</code>) inside <code>%%</code> COMMENT lines are
/// masked to <code>message #</code> — anomaly warnings embed each session's own row ids,
/// which otherwise keeps structurally-identical flows from ever comparing equal (smoke
/// finding 2026-07-03: real Ensemble sessions almost always carry an unpaired-request
/// warning naming their first message, so dedup never fired on live traces).
/// Arrow/participant lines are never touched, and the RENDERED diagrams keep their real
/// ids — masking applies to the comparison only. Everything else must match byte-for-byte.
ClassMethod NormalizeForDedup(pMermaid As %String) As %String [ Internal ]
{
    Set tNL = $Char(10)
    If $Extract($Piece(pMermaid, tNL, 2), 1, 11) = "%% Session " {
        Set $Piece(pMermaid, tNL, 2) = "%% Session #"
    }
    Set tOut = ""
    For tI = 1:1:$Length(pMermaid, tNL) {
        Set tLine = $Piece(pMermaid, tNL, tI)
        If $Extract($ZStrip(tLine, "<W"), 1, 2) = "%%" Set tLine = ..MaskMessageIds(tLine)
        Set tOut = tOut_$Select(tI > 1: tNL, 1: "")_tLine
    }
    Quit tOut
}

/// Replace every <code>message &lt;digits&gt;</code> token in one comment line with
/// <code>message #</code> (dedup-comparison masking — see
/// <method>NormalizeForDedup</method>). Payload text (config names, body classes, error
/// details such as order ids) is deliberately NOT masked: diagrams that differ in real
/// content must never false-dedup.
ClassMethod MaskMessageIds(pLine As %String) As %String [ Internal ]
{
    Set tOut = ""
    Set tPos = 1
    While 1 {
        Set tIdx = $Find(pLine, "message ", tPos)
        If tIdx = 0 {
            Set tOut = tOut_$Extract(pLine, tPos, *)
            Quit
        }
        Set tOut = tOut_$Extract(pLine, tPos, tIdx - 1)
        Set tJ = tIdx
        While $Extract(pLine, tJ) ? 1N {
            Set tJ = tJ + 1
        }
        If tJ > tIdx Set tOut = tOut_"#"
        Set tPos = tJ
    }
    Quit tOut
}

/// Run the Load → Correlate → Compress (pair tier, then episode tier) → Write pipeline
/// for ONE session and return its diagram object. Never throws to the caller: any hard
/// failure is converted into a comment-only diagram + warning (best-effort contract,
/// decision G3).
ClassMethod GenerateOne(pSessionId As %String, pLabelMode As %String = "full", pMaxRows As %Integer = 2000) As %DynamicObject [ Internal ]
{
    Set tDiag = {}
    Try {
        Do tDiag.%Set("sessionId", +pSessionId, "number")

        Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).LoadSession(pSessionId, pMaxRows, .tEvents, .tTruncated)
        If $$$ISOK(tSC) Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, pLabelMode, .tRender)
        If $$$ISOK(tSC) Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tRender, .tPairCompressed)
        If $$$ISOK(tSC) Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).CompressEpisodes(tPairCompressed, .tCompressed)
        If $$$ISOK(tSC) {
            Set tMsgCount = tEvents.Count()
            Set tFirst = ""
            Set tLast = ""
            If tMsgCount > 0 {
                Set tFirst = tEvents.GetAt(1).TimeCreated
                Set tLast = tEvents.GetAt(tMsgCount).TimeCreated
            }
            Set tSC = ##class(ExecuteMCPv2.Diagram.Writer).Write(pSessionId, tMsgCount, tFirst, tLast, tCompressed, .tMermaid)
        }
        If $$$ISERR(tSC) {
            Do ..ApplyFailure(tDiag, pSessionId, tSC)
            Quit
        }

        ; structured warnings = every event's warnings over the compressed stream, in
        ; order (pairloop events already carry the deduped merge of their iterations;
        ; episodeloop events recurse into their body, then contribute their own deduped
        ; extras — §6.4 item 8: warnings survive both compression tiers)
        Set tWarnings = []
        Do ..CollectWarnings(tCompressed, tWarnings)

        Do tDiag.%Set("mermaid", tMermaid)
        Do tDiag.%Set("messageCount", tMsgCount, "number")
        Do tDiag.%Set("warnings", tWarnings)
        Do tDiag.%Set("truncated", ''tTruncated, "boolean")
    } Catch ex {
        Do ..ApplyFailure(tDiag, pSessionId, ex.AsStatus())
    }
    Quit tDiag
}

/// Collect every event's warnings over a render-event list, in order, recursing into
/// episodeloop bodies (Story 21.1). Pairloop events contribute their own deduped merge;
/// an episodeloop contributes its representative body's warnings first (render order)
/// and then its own deduped extras from compressed iterations 2..N (§6.4 item 8).
ClassMethod CollectWarnings(pEvents As %Library.ListOfObjects, pWarnings As %Library.DynamicArray) As %Status [ Internal ]
{
    Set tN = 0
    If $IsObject(pEvents) Set tN = pEvents.Count()
    For tI = 1:1:tN {
        Set tRE = pEvents.GetAt(tI)
        If tRE.Kind = "episodeloop" {
            Do ..CollectWarnings(tRE.Body, pWarnings)
        }
        For tW = 1:1:tRE.Warnings.Count() {
            Do pWarnings.%Push(tRE.Warnings.GetAt(tW))
        }
    }
    Quit $$$OK
}

/// Fill <var>pDiag</var> with the comment-only failure shape for a per-session hard
/// failure. Error text passes through <method>ExecuteMCPv2.Utils:SanitizeError</method>
/// (Rule #33 — no caret-globals or internals leak into comments/warnings).
ClassMethod ApplyFailure(pDiag As %DynamicObject, pSessionId As %String, pStatus As %Status) As %Status [ Internal ]
{
    Set tSC = $$$OK
    Try {
        Set tText = ""
        Try {
            Set tSafe = ##class(ExecuteMCPv2.Utils).SanitizeError(pStatus)
            ; Rule #8 prefix strip + unresolved-message-table boilerplate unwrap —
            ; shared with the I1 per-message summaries (CleanStatusText).
            Set tText = ##class(ExecuteMCPv2.Diagram.Loader).CleanStatusText($System.Status.GetErrorText(tSafe))
        } Catch exInner {
            Set tText = ""
        }
        Set tText = $ZStrip($Translate(tText, $Char(13, 10, 9), "   "), "<>W")
        If tText = "" Set tText = "diagram generation failed"
        Set tNL = $Char(10)
        Set tMermaid = "sequenceDiagram"_tNL_"%% Session "_(+pSessionId)_": generation failed"_tNL_"%% "_tText
        Do pDiag.%Set("sessionId", +pSessionId, "number")
        Do pDiag.%Set("mermaid", tMermaid)
        Do pDiag.%Set("messageCount", 0, "number")
        Set tWarnings = []
        Do tWarnings.%Push("Generation failed for session "_(+pSessionId)_": "_tText)
        Do pDiag.%Set("warnings", tWarnings)
        Do pDiag.%Set("truncated", 0, "boolean")
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

}
