/// Two-tier loop compressor for the message-trace sequence-diagram library
/// (Epic 21, Stories 21.0/21.1). Pure in-memory — no SQL, no IRIS state.
/// <p><b>Pair tier</b> (<method>Compress</method>, Story 21.0 — §6.3 of
/// sprint-change-proposal-2026-07-02.md): a Request arrow IMMEDIATELY followed by its
/// paired Response arrow forms a pair unit; contiguous pair units with identical
/// signatures and count &gt; 1 collapse to one synthetic <code>pairloop</code> render
/// event carrying the count and both legs. The pair signature is
/// <code>reqSrc|reqDst|reqLabel|reqArrow|reqIsError||respSrc|respDst|respLabel|respArrow|respIsError</code>
/// — arrow inclusion keeps Inproc/Queue pairs distinct, and per improvement I1 BOTH legs'
/// error state joins the signature so an errored pair never merges into a clean loop
/// (§6.4 item 11). Warnings from compressed pairs are deduped (exact text match,
/// first-seen order) and retained on the loop event (§6.4 item 8).</p>
/// <p><b>Episode tier</b> (<method>CompressEpisodes</method>, Story 21.1 — §6.3): groups
/// the pair-compressed stream into multi-hop "episodes" via a depth stack over sync
/// calls (a sync request pushes a frame, its response pops it; a paired async request
/// opens a queue-rooted frame — §6.4 item 6). Abandoned frames are unwound per §6.4
/// item 4: a new request whose source is not the top sync frame's destination pops it,
/// and a response answering a deeper frame unwinds to it. Episode signatures are built
/// from business events only (trace-utility events are excluded from signatures but
/// retained in bodies, and between-episode trace events attach to the previous episode —
/// §6.4 item 5); a pair-loop contributes its fragments plus <code>LOOPCOUNT=N</code>
/// (§6.4 item 3) and error state joins the signature (I1). Contiguous identical-signature
/// episodes with count &gt; 1 collapse to one <code>episodeloop</code> event wrapping the
/// representative body. Envelope-wrapper flows (§6.4 item 7) are handled by peeling an
/// outer sync wrapper pair whose response is the final event. When no repetition exists
/// the tier is a pure pass-through — the emitted stream (and therefore the diagram text)
/// is unchanged (Story 21.1 byte-for-byte gate).</p>
Class ExecuteMCPv2.Diagram.Compressor Extends %RegisteredObject
{

/// Compress contiguous identical request/response pairs in the ordered render-event
/// stream into <code>pairloop</code> events. Events that are not part of an adjacent
/// pair (unpaired arrows, pairs whose response does not immediately follow) pass
/// through unchanged.
ClassMethod Compress(pRenderEvents As %Library.ListOfObjects, Output pCompressed As %Library.ListOfObjects) As %Status
{
    Set tSC = $$$OK
    Set pCompressed = ##class(%Library.ListOfObjects).%New()
    Try {
        Set tN = 0
        If $IsObject(pRenderEvents) Set tN = pRenderEvents.Count()
        Set tI = 1
        While tI <= tN {
            Set tEv = pRenderEvents.GetAt(tI)

            ; a pair unit is a req-role arrow immediately followed by its resp-role arrow
            Set tIsPairStart = 0
            If (tEv.Kind = "arrow") && (tEv.Role = "req") && (tEv.PairId > 0) && (tI < tN) {
                Set tNext = pRenderEvents.GetAt(tI + 1)
                If (tNext.Kind = "arrow") && (tNext.PairId = tEv.PairId) {
                    Set tIsPairStart = 1
                }
            }
            If 'tIsPairStart {
                Do pCompressed.Insert(tEv)
                Set tI = tI + 1
                Continue
            }

            ; count contiguous pair units with an identical signature
            Set tSig = ..PairSignature(tEv, tNext)
            Set tCount = 1
            Set tK = tI + 2
            While tK < tN {
                Set tR1 = pRenderEvents.GetAt(tK)
                Quit:'((tR1.Kind = "arrow") && (tR1.Role = "req") && (tR1.PairId > 0))
                Set tR2 = pRenderEvents.GetAt(tK + 1)
                Quit:'((tR2.Kind = "arrow") && (tR2.PairId = tR1.PairId))
                Quit:(..PairSignature(tR1, tR2) '= tSig)
                Set tCount = tCount + 1
                Set tK = tK + 2
            }

            If tCount = 1 {
                Do pCompressed.Insert(tEv)
                Do pCompressed.Insert(tNext)
                Set tI = tI + 2
                Continue
            }

            ; collapse to a synthetic loop event; merge + dedupe warnings from ALL iterations
            Set tLoop = ##class(ExecuteMCPv2.Diagram.RenderEvent).%New()
            Set tLoop.Kind = "pairloop"
            Set tLoop.Count = tCount
            Set tLoop.Req = tEv
            Set tLoop.Resp = tNext
            Kill tSeen
            For tP = 0:1:(tCount - 1) {
                Set tReqEv = pRenderEvents.GetAt(tI + (tP * 2))
                Set tRespEv = pRenderEvents.GetAt(tI + (tP * 2) + 1)
                For tW = 1:1:tReqEv.Warnings.Count() {
                    Set tText = tReqEv.Warnings.GetAt(tW)
                    If '$Data(tSeen(tText)) {
                        Set tSeen(tText) = 1
                        Do tLoop.Warnings.Insert(tText)
                    }
                }
                For tW = 1:1:tRespEv.Warnings.Count() {
                    Set tText = tRespEv.Warnings.GetAt(tW)
                    If '$Data(tSeen(tText)) {
                        Set tSeen(tText) = 1
                        Do tLoop.Warnings.Insert(tText)
                    }
                }
            }
            Do pCompressed.Insert(tLoop)
            Set tI = tI + (tCount * 2)
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Build the pair signature for one request/response pair unit (§6.3 + improvement I1:
/// both legs' error state participates so an errored pair never merges into a clean loop).
ClassMethod PairSignature(pReq As ExecuteMCPv2.Diagram.RenderEvent, pResp As ExecuteMCPv2.Diagram.RenderEvent) As %String
{
    Quit pReq.Src_"|"_pReq.Dst_"|"_pReq.Label_"|"_pReq.Arrow_"|"_(''pReq.IsError)_"||"_pResp.Src_"|"_pResp.Dst_"|"_pResp.Label_"|"_pResp.Arrow_"|"_(''pResp.IsError)
}

/// Episode-level compression (Story 21.1, §6.3): compress contiguous identical-signature
/// multi-hop episodes in the PAIR-COMPRESSED render-event stream into
/// <code>episodeloop</code> events. A stream with no repeating episodes passes through
/// UNCHANGED (the Story 21.1 byte-for-byte back-compat gate).
/// <p>§6.4 item 7 — envelope-wrapper flows: an outer sync wrapper request whose response
/// arrives at the very end would keep the depth stack non-empty for the whole stream
/// (one giant episode, no repetition detected). Simplified general rule (dev decision,
/// recorded in the Story 21.1 Dev Agent Record — the reference used a domain naming
/// heuristic): when the FIRST event is a paired sync request arrow AND the LAST event is
/// its paired response, peel the wrapper pair and run episode detection on the events
/// between them (equivalent to starting episode detection at depth 2). Applied once —
/// no recursive peeling.</p>
ClassMethod CompressEpisodes(pRenderEvents As %Library.ListOfObjects, Output pCompressed As %Library.ListOfObjects) As %Status
{
    Set tSC = $$$OK
    Set pCompressed = ##class(%Library.ListOfObjects).%New()
    Try {
        Set tN = 0
        If $IsObject(pRenderEvents) Set tN = pRenderEvents.Count()
        If tN = 0 Quit

        ; §6.4 item 7: envelope-wrapper peel (see class comment above)
        Set tWrapped = 0
        Set tFirst = pRenderEvents.GetAt(1)
        If (tN >= 4) && (tFirst.Kind = "arrow") && (tFirst.Role = "req") && (tFirst.Arrow = "->>") && (tFirst.PairId > 0) {
            Set tLast = pRenderEvents.GetAt(tN)
            If (tLast.Kind = "arrow") && (tLast.Role = "resp") && (tLast.PairId = tFirst.PairId) {
                Set tWrapped = 1
            }
        }
        If tWrapped {
            Set tMiddle = ##class(%Library.ListOfObjects).%New()
            For tI = 2:1:tN - 1 {
                Do tMiddle.Insert(pRenderEvents.GetAt(tI))
            }
            Set tSC = ..EpisodeCore(tMiddle, .tInner)
            If $$$ISERR(tSC) Quit
            Do pCompressed.Insert(tFirst)
            For tI = 1:1:tInner.Count() {
                Do pCompressed.Insert(tInner.GetAt(tI))
            }
            Do pCompressed.Insert(pRenderEvents.GetAt(tN))
        } Else {
            Set tSC = ..EpisodeCore(pRenderEvents, .pCompressed)
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Core episode detection + collapse over one render-event stream (no wrapper peel).
/// <p>Phase 1 groups events into episodes with a depth stack over sync calls: a sync
/// request pushes a frame (destination + PairId), its response pops it; a PAIRED async
/// request opens a queue-rooted frame (§6.4 item 6 — its known response closes it).
/// Unwind rules (§6.4 item 4): a new request whose source is not the top SYNC frame's
/// destination pops abandoned sync frames (known-paired queue frames are never unwound
/// this way); a response answering a deeper frame unwinds to that frame. A new episode
/// roots whenever a request-shaped event (request arrow or pair-loop) arrives at depth 0;
/// responses and trace-utility events never open a boundary — they attach to the current
/// episode (§6.4 item 5 keeps between-episode trace events from breaking contiguity).</p>
/// <p>Phase 2 collapses contiguous runs of identical-signature episodes (count &gt; 1,
/// non-empty signature) into one <code>episodeloop</code> event: the FIRST iteration is
/// the representative body; warning texts from iterations 2..N that are not already on
/// the representative body are deduped onto the loop event (§6.4 item 8).</p>
ClassMethod EpisodeCore(pRenderEvents As %Library.ListOfObjects, Output pCompressed As %Library.ListOfObjects) As %Status [ Internal ]
{
    Set tSC = $$$OK
    Set pCompressed = ##class(%Library.ListOfObjects).%New()
    Try {
        Set tN = 0
        If $IsObject(pRenderEvents) Set tN = pRenderEvents.Count()

        ; ── Phase 1: group events into episodes via the sync-call depth stack ──
        ; tFrame(level) = $LB(destination, pairId, isSync); tEp(i) = event list
        Set tEpCount = 0
        Set tCur = 0
        Set tDepth = 0
        For tI = 1:1:tN {
            Set tEv = pRenderEvents.GetAt(tI)

            ; trace-utility events: attach to the current/previous episode — no episode
            ; boundary, no stack effect (§6.4 item 5)
            If ..IsTraceEvent(tEv) {
                If tCur = 0 {
                    Set tEpCount = tEpCount + 1
                    Set tEp(tEpCount) = ##class(%Library.ListOfObjects).%New()
                    Set tCur = tEpCount
                }
                Do tEp(tCur).Insert(tEv)
                Continue
            }

            ; response arrows: pop the frame they answer (unwinding deeper-frame answers,
            ; §6.4 item 4); unmatched responses attach without a depth change. A response
            ; never opens an episode boundary.
            If (tEv.Kind = "arrow") && (tEv.Role = "resp") {
                If tEv.PairId > 0 {
                    Set tFound = 0
                    For tK = tDepth:-1:1 {
                        If $List(tFrame(tK), 2) = tEv.PairId {
                            Set tFound = tK
                            Quit
                        }
                    }
                    If tFound > 0 Set tDepth = tFound - 1
                }
                If tCur = 0 {
                    Set tEpCount = tEpCount + 1
                    Set tEp(tEpCount) = ##class(%Library.ListOfObjects).%New()
                    Set tCur = tEpCount
                }
                Do tEp(tCur).Insert(tEv)
                Continue
            }

            ; request-shaped event: a request arrow or a self-contained pair-loop.
            ; §6.4 item 4 rule A: unwind abandoned SYNC frames whose destination is not
            ; this request's source (a known-paired queue frame is never unwound — its
            ; response is coming, §6.4 item 6).
            If tEv.Kind = "arrow" {
                While (tDepth > 0) && ($List(tFrame(tDepth), 3) = 1) && (tEv.Src '= $List(tFrame(tDepth), 1)) {
                    Set tDepth = tDepth - 1
                }
            }
            If (tDepth = 0) || (tCur = 0) {
                Set tEpCount = tEpCount + 1
                Set tEp(tEpCount) = ##class(%Library.ListOfObjects).%New()
                Set tCur = tEpCount
            }
            Do tEp(tCur).Insert(tEv)
            If tEv.Kind = "arrow" {
                If tEv.Arrow = "->>" {
                    ; a sync request pushes (paired or not — abandonment is unwound later)
                    Set tDepth = tDepth + 1
                    Set tFrame(tDepth) = $ListBuild(tEv.Dst, +tEv.PairId, 1)
                } ElseIf tEv.PairId > 0 {
                    ; §6.4 item 6: an async request with a KNOWN paired response opens a
                    ; queue-rooted frame that closes when that response is consumed
                    Set tDepth = tDepth + 1
                    Set tFrame(tDepth) = $ListBuild(tEv.Dst, +tEv.PairId, 0)
                }
            }
        }

        ; ── Phase 2: collapse contiguous identical-signature episodes (§6.3) ──
        For tI = 1:1:tEpCount {
            Set tSig(tI) = ..EpisodeSignature(tEp(tI))
        }
        Set tI = 1
        While tI <= tEpCount {
            Set tRun = 1
            If tSig(tI) '= "" {
                While ((tI + tRun) <= tEpCount) && (tSig(tI + tRun) = tSig(tI)) {
                    Set tRun = tRun + 1
                }
            }
            If tRun = 1 {
                ; non-repeating episode: pure pass-through, original order preserved
                For tJ = 1:1:tEp(tI).Count() {
                    Do pCompressed.Insert(tEp(tI).GetAt(tJ))
                }
                Set tI = tI + 1
                Continue
            }
            ; collapse the run: first iteration = representative body; deduped warning
            ; EXTRAS from iterations 2..N ride the loop event (§6.4 item 8)
            Set tLoop = ##class(ExecuteMCPv2.Diagram.RenderEvent).%New()
            Set tLoop.Kind = "episodeloop"
            Set tLoop.Count = tRun
            Set tLoop.Label = ..RepresentativeLabel(tEp(tI))
            Kill tSeen
            For tJ = 1:1:tEp(tI).Count() {
                Set tBodyEv = tEp(tI).GetAt(tJ)
                Do tLoop.Body.Insert(tBodyEv)
                For tW = 1:1:tBodyEv.Warnings.Count() {
                    Set tSeen(tBodyEv.Warnings.GetAt(tW)) = 1
                }
            }
            For tP = tI + 1:1:tI + tRun - 1 {
                For tJ = 1:1:tEp(tP).Count() {
                    Set tBodyEv = tEp(tP).GetAt(tJ)
                    For tW = 1:1:tBodyEv.Warnings.Count() {
                        Set tText = tBodyEv.Warnings.GetAt(tW)
                        If '$Data(tSeen(tText)) {
                            Set tSeen(tText) = 1
                            Do tLoop.Warnings.Insert(tText)
                        }
                    }
                }
            }
            Do pCompressed.Insert(tLoop)
            Set tI = tI + tRun
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Build the episode signature from BUSINESS events only (§6.3): trace-utility events
/// are skipped; an arrow contributes <code>A(src|dst|label|arrow|isError)</code> — the
/// arrow style stands in for the raw Invocation value (§6.3: invocation excluded, arrow
/// substitutes) and the I1 error state is included; a pair-loop contributes its full
/// pair signature plus <code>LOOPCOUNT=N</code> so different iteration counts never
/// merge (§6.4 item 3). An all-trace (or empty) episode yields "" and is never merged.
ClassMethod EpisodeSignature(pEvents As %Library.ListOfObjects) As %String [ Internal ]
{
    Set tSig = ""
    Set tN = 0
    If $IsObject(pEvents) Set tN = pEvents.Count()
    For tI = 1:1:tN {
        Set tEv = pEvents.GetAt(tI)
        If ..IsTraceEvent(tEv) Continue
        If tEv.Kind = "pairloop" {
            Set tFrag = "L("_..PairSignature(tEv.Req, tEv.Resp)_"|LOOPCOUNT="_(+tEv.Count)_")"
        } Else {
            Set tFrag = "A("_tEv.Src_"|"_tEv.Dst_"|"_tEv.Label_"|"_tEv.Arrow_"|"_(''tEv.IsError)_")"
        }
        Set tSig = tSig_$Select(tSig = "": "", 1: "##")_tFrag
    }
    Quit tSig
}

/// True when the event is a trace-utility event: an arrow flagged by the correlator's
/// <code>HS.Util.Trace.</code> body-class prefix classifier, or a pair-loop whose BOTH
/// legs are trace events.
ClassMethod IsTraceEvent(pEv As ExecuteMCPv2.Diagram.RenderEvent) As %Boolean [ Internal ]
{
    If pEv.Kind = "pairloop" {
        Quit ($IsObject(pEv.Req) && pEv.Req.IsTrace && $IsObject(pEv.Resp) && pEv.Resp.IsTrace)
    }
    Quit ''pEv.IsTrace
}

/// Representative label for an episode loop (dev decision, recorded in the Story 21.1
/// Dev Agent Record): the label of the episode's FIRST business event — the opening
/// request's label (a pair-loop contributes its request leg's label). Falls back to
/// "episode" when the episode has no business events.
ClassMethod RepresentativeLabel(pEvents As %Library.ListOfObjects) As %String [ Internal ]
{
    Set tLabel = ""
    Set tN = 0
    If $IsObject(pEvents) Set tN = pEvents.Count()
    For tI = 1:1:tN {
        Set tEv = pEvents.GetAt(tI)
        If ..IsTraceEvent(tEv) Continue
        If tEv.Kind = "pairloop" {
            Set tLabel = tEv.Req.Label
        } Else {
            Set tLabel = tEv.Label
        }
        Quit
    }
    If tLabel = "" Set tLabel = "episode"
    Quit tLabel
}

}
