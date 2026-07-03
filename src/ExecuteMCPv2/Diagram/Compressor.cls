/// Pair-level loop compressor for the message-trace sequence-diagram library
/// (Epic 21, Story 21.0). Pure in-memory — no SQL, no IRIS state.
/// <p>Implements the §6.3 pair tier of sprint-change-proposal-2026-07-02.md: a Request
/// arrow IMMEDIATELY followed by its paired Response arrow forms a pair unit; contiguous
/// pair units with identical signatures and count &gt; 1 collapse to one synthetic
/// <code>pairloop</code> render event carrying the count and both legs.</p>
/// <p>The pair signature is
/// <code>reqSrc|reqDst|reqLabel|reqArrow|reqIsError||respSrc|respDst|respLabel|respArrow|respIsError</code>
/// — arrow inclusion keeps Inproc/Queue pairs distinct, and per improvement I1 BOTH legs'
/// error state joins the signature so an errored pair never merges into a clean loop
/// (§6.4 item 11).</p>
/// <p>Warnings from compressed pairs are deduped (exact text match, first-seen order)
/// and retained on the loop event (§6.4 item 8).</p>
/// <p>Episode-level compression (depth-stack tier) is Story 21.1 — this class is the
/// seam: it consumes and produces the same ordered render-event stream, so the episode
/// tier can slot in after the pair tier without reshaping the pipeline.</p>
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

}
