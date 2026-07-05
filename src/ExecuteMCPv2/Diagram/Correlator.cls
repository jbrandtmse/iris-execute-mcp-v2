/// Request/response correlator for the message-trace sequence-diagram library
/// (Epic 21, Story 21.0). Pure in-memory — no SQL, no IRIS state.
/// <p>Implements the §6.2 correlation and rendering rules of
/// sprint-change-proposal-2026-07-02.md:</p>
/// <ul>
///   <li><b>Type resolution</b> — normalized <code>Type</code> wins; otherwise a row with
///       <code>CorrespondingMessageId</code> set is a Response, else a Request (Terminate
///       and other unknown types flow through this heuristic — never dropped).</li>
///   <li><b>Inproc pairing</b> — forward-only scan: for each Request, the first unused
///       Response with REVERSED endpoints. <code>CorrespondingMessageId</code> confirms —
///       a mismatch emits a conflict warning but still pairs by order. The response arrow
///       is FORCED sync.</li>
///   <li><b>Queue pairing</b> — primary: the Response whose CorrespondingMessageId equals
///       the request ID; fallback: equal <b>non-empty</b> ReturnQueueName + reversed
///       endpoints + empty CorrId (improvement I3, Story 21.1 — empty==empty does NOT
///       pair, so a one-way async request stays unpaired-with-warning instead of silently
///       false-pairing with a later CorrId-less response-typed row). Both legs render
///       async; a queued pair is NEVER reclassified to sync.</li>
///   <li><b>Unpaired</b> requests warn; unpaired responses are emitted standalone (own
///       Src→Dst direction) with a warning — never dropped.</li>
///   <li><b>Arrows</b> — Inproc → sync <code>-&gt;&gt;</code>, Queue → async
///       <code>--&gt;&gt;</code>, unknown → warning + default sync.</li>
///   <li><b>Labels</b> — full body class name by default; <code>short</code> mode keeps the
///       last dotted segment; bodyless headers render <code>(no body)</code>.</li>
///   <li><b>I1</b> — an errored message attaches a sanitized one-line error warning.</li>
/// </ul>
/// <p>Best-effort contract: anomalies become warnings on the render events; this method
/// never fails a generation because of trace-shape anomalies.</p>
/// <p><b>Pairing cost (CR 21.0-2, measured live 2026-07-04).</b> Pairing is an order-based
/// forward scan (§6.2): each Request scans forward to end-of-list for its Response, and an
/// unmatched Queue request scans TWICE (CorrId primary + non-empty-ReturnQueue fallback) —
/// O(n²) with no iteration bound. Measured worst case (all-unpaired Queue requests — the
/// pathological wedged-production shape): default <code>maxRows=2000</code> &rarr; ~0.14 s
/// (fast, acceptable); the <code>10000</code> hard cap &rarr; ~4.6 s (opt-in extreme; it
/// completes with no crash, honoring the best-effort contract). The default keeps realistic
/// traces fast, so the cap is documented rather than re-architected. If the extreme cap ever
/// becomes a reported problem, replace the forward scans with index maps (CorrId&rarr;position,
/// per-endpoint-pair response queues) preserving §6.2 semantics.</p>
Class ExecuteMCPv2.Diagram.Correlator Extends %RegisteredObject
{

/// Correlate an ordered <class>ExecuteMCPv2.Diagram.Event</class> list into the ordered
/// arrow render-event stream (one arrow per message, original row order preserved), with
/// pairing metadata (<property>PairId</property>/<property>Role</property>) for the
/// compressor and anomaly warnings attached per event.
ClassMethod Correlate(pEvents As %Library.ListOfObjects, pLabelMode As %String = "full", Output pRenderEvents As %Library.ListOfObjects) As %Status
{
    Set tSC = $$$OK
    Set pRenderEvents = ##class(%Library.ListOfObjects).%New()
    Try {
        Set tN = 0
        If $IsObject(pEvents) Set tN = pEvents.Count()

        ; ── Phase 1: effective type resolution (§6.2) ───────────────────────
        For tI = 1:1:tN {
            Set tEv = pEvents.GetAt(tI)
            If (tEv.Type = "Request") || (tEv.Type = "Response") {
                Set tEffType(tI) = tEv.Type
            } ElseIf tEv.CorrId '= "" {
                Set tEffType(tI) = "Response"
            } Else {
                Set tEffType(tI) = "Request"
            }
        }

        ; ── Phase 2: forward-only pairing ───────────────────────────────────
        Set tPairCount = 0
        For tI = 1:1:tN {
            If tEffType(tI) '= "Request" Continue
            Set tReq = pEvents.GetAt(tI)
            Set tMatch = 0
            If tReq.Invocation = "Queue" {
                ; Queue primary: Response whose CorrId = request ID
                For tJ = tI + 1:1:tN {
                    If tEffType(tJ) '= "Response" Continue
                    If $Get(tUsed(tJ)) Continue
                    Set tResp = pEvents.GetAt(tJ)
                    If (tResp.CorrId '= "") && (+tResp.CorrId = +tReq.Id) {
                        Set tMatch = tJ
                        Quit
                    }
                }
                ; Queue fallback: equal NON-EMPTY ReturnQueueName + reversed endpoints +
                ; empty CorrId. I3 (Story 21.1, resolves CR 21.0-1, proposal §6.2 [I3]):
                ; the fallback fires only when BOTH ReturnQueueName values are non-empty
                ; and equal — ""=="" trivially satisfied equality and silently false-paired
                ; a one-way async request with a later CorrId-less response-typed row.
                If (tMatch = 0) && (tReq.ReturnQueue '= "") {
                    For tJ = tI + 1:1:tN {
                        If tEffType(tJ) '= "Response" Continue
                        If $Get(tUsed(tJ)) Continue
                        Set tResp = pEvents.GetAt(tJ)
                        If (tResp.CorrId = "") && (tResp.ReturnQueue = tReq.ReturnQueue) && (tResp.Source = tReq.Target) && (tResp.Target = tReq.Source) {
                            Set tMatch = tJ
                            Quit
                        }
                    }
                }
                If tMatch > 0 {
                    Set tUsed(tMatch) = 1
                    Set tPairCount = tPairCount + 1
                    Set tPairIdOf(tI) = tPairCount
                    Set tPairIdOf(tMatch) = tPairCount
                    Set tRoleOf(tI) = "req"
                    Set tRoleOf(tMatch) = "resp"
                    ; a queued pair is never reclassified to sync (§6.2)
                    Set tRespStyle(tMatch) = "-->>"
                } Else {
                    Set tUnpairedReq(tI) = "Unpaired request: message "_tReq.Id_" ("_tReq.Source_" -> "_tReq.Target_") has no matching response"
                }
            } Else {
                ; Inproc (and unknown-invocation) pairing: first unused Response with reversed endpoints
                For tJ = tI + 1:1:tN {
                    If tEffType(tJ) '= "Response" Continue
                    If $Get(tUsed(tJ)) Continue
                    Set tResp = pEvents.GetAt(tJ)
                    If (tResp.Source = tReq.Target) && (tResp.Target = tReq.Source) {
                        Set tMatch = tJ
                        Quit
                    }
                }
                If tMatch > 0 {
                    Set tResp = pEvents.GetAt(tMatch)
                    Set tUsed(tMatch) = 1
                    Set tPairCount = tPairCount + 1
                    Set tPairIdOf(tI) = tPairCount
                    Set tPairIdOf(tMatch) = tPairCount
                    Set tRoleOf(tI) = "req"
                    Set tRoleOf(tMatch) = "resp"
                    ; the response arrow of an Inproc pair is forced sync (§6.2)
                    Set tRespStyle(tMatch) = "->>"
                    ; CorrespondingMessageId confirms; mismatch warns but still pairs by order
                    If (tResp.CorrId '= "") && (+tResp.CorrId '= +tReq.Id) {
                        Set tConflictWarn(tMatch) = "Correlation conflict: response "_tResp.Id_" paired with request "_tReq.Id_" by order, but its CorrespondingMessageId is "_tResp.CorrId
                    }
                } Else {
                    Set tUnpairedReq(tI) = "Unpaired request: message "_tReq.Id_" ("_tReq.Source_" -> "_tReq.Target_") has no matching response"
                }
            }
        }

        ; ── Phase 3: emit one arrow render event per message, original order ─
        For tI = 1:1:tN {
            Set tEv = pEvents.GetAt(tI)
            Set tRE = ##class(ExecuteMCPv2.Diagram.RenderEvent).%New()
            Set tRE.Kind = "arrow"
            Set tRE.Src = tEv.Source
            Set tRE.Dst = tEv.Target
            Set tRE.IsError = ''tEv.IsError
            Set tRE.PairId = +$Get(tPairIdOf(tI))
            ; Role reflects the EFFECTIVE type for every arrow — paired legs keep their
            ; pairing role; unpaired arrows carry "req"/"resp" too (PairId=0 still marks
            ; them unpaired). The Story 21.1 episode tier needs the request/response
            ; distinction for its depth stack; the pair tier gates on PairId>0 so this
            ; is invisible to it.
            Set tRE.Role = $Select(tEffType(tI) = "Response": "resp", 1: "req")
            ; Trace-utility classifier (Story 21.1, §6.3): prefix match on the ORIGINAL
            ; body class (label mode cannot break it). The loader already excludes the
            ; exact HS.Util.Trace.Request class at SQL level; this catches sibling
            ; trace-utility classes that ARE loaded. Trace events are excluded from
            ; episode signatures but retained in rendered bodies.
            Set tRE.IsTrace = ($Extract(tEv.BodyClass, 1, 14) = "HS.Util.Trace.")

            ; label (mode applied here so compression signatures see the rendered label)
            Set tLabel = tEv.BodyClass
            If tLabel = "" {
                Set tLabel = "(no body)"
            } ElseIf pLabelMode = "short" {
                Set tLabel = $Piece(tLabel, ".", $Length(tLabel, "."))
            }
            Set tRE.Label = tLabel

            ; arrow style: paired responses use the pair-forced style; everything else
            ; renders per its own Invocation (unknown -> warn + default sync)
            If (tEffType(tI) = "Response") && ($Get(tRespStyle(tI)) '= "") {
                Set tRE.Arrow = tRespStyle(tI)
            } ElseIf tEv.Invocation = "Inproc" {
                Set tRE.Arrow = "->>"
            } ElseIf tEv.Invocation = "Queue" {
                Set tRE.Arrow = "-->>"
            } Else {
                Set tRE.Arrow = "->>"
                Do tRE.Warnings.Insert("Unknown invocation on message "_tEv.Id_"; defaulting to sync arrow")
            }

            ; unpaired response emitted standalone (own Src->Dst), never dropped (§6.2)
            If (tEffType(tI) = "Response") && (tRE.PairId = 0) {
                Do tRE.Warnings.Insert("Unpaired response: message "_tEv.Id_" ("_tEv.Source_" -> "_tEv.Target_") emitted standalone")
            }
            ; unpaired request warning
            If $Get(tUnpairedReq(tI)) '= "" Do tRE.Warnings.Insert(tUnpairedReq(tI))
            ; correlation-conflict warning (attached to the response leg)
            If $Get(tConflictWarn(tI)) '= "" Do tRE.Warnings.Insert(tConflictWarn(tI))
            ; improvement I1: errored message -> sanitized one-line error warning
            If tRE.IsError {
                Set tErrText = tEv.ErrorText
                If tErrText = "" Set tErrText = "message reported error"
                Do tRE.Warnings.Insert("Error on message "_tEv.Id_": "_tErrText)
            }

            Do pRenderEvents.Insert(tRE)
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

}
