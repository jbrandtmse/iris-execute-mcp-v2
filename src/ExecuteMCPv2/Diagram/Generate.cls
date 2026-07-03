/// Callable facade for the message-trace sequence-diagram library (Epic 21, Story 21.0;
/// architecture decision G1). Callable independently of REST.
/// <p>For each requested session: <class>ExecuteMCPv2.Diagram.Loader</class> →
/// <class>ExecuteMCPv2.Diagram.Correlator</class> →
/// <class>ExecuteMCPv2.Diagram.Compressor</class> →
/// <class>ExecuteMCPv2.Diagram.Writer</class>, producing
/// <code>{ diagrams: [{ sessionId, mermaid, messageCount, warnings, truncated }], count }</code>
/// (decision G3 output contract). Sessions are processed one at a time — no
/// cross-session SQL.</p>
/// <p>Best-effort contract: per-session anomalies surface as structured warnings and
/// <code>%%</code> comments; a per-session hard failure (e.g. Ens.MessageHeader absent in
/// a non-interoperability namespace) becomes a comment-only diagram plus a warning rather
/// than failing the call.</p>
/// <p>NOTE for Story 21.1: keep this class/method name stable — episode-level compression
/// and cross-session dedup slot into the per-session pipeline below.</p>
Class ExecuteMCPv2.Diagram.Generate Extends %RegisteredObject
{

/// Generate one Mermaid sequence diagram per session id.
/// <p><var>pSessionIds</var> — <class>%Library.ListOfDataTypes</class> of session ids.</p>
/// <p><var>pOptions</var> — optional <class>%DynamicObject</class>:
/// <code>labelMode</code> (<code>"full"</code> default / <code>"short"</code> = last dotted
/// segment) and <code>maxRows</code> (default 2000, max 10000).</p>
/// <p><var>pResult</var> — <code>{ diagrams: [...], count: n }</code>.</p>
ClassMethod Run(pSessionIds As %Library.ListOfDataTypes, pOptions As %DynamicObject = "", Output pResult As %DynamicObject) As %Status
{
    Set tSC = $$$OK
    Set pResult = ""
    Try {
        ; resolve options (Rule #15: no $Get() around method calls — %IsDefined + %Get)
        Set tLabelMode = "full"
        Set tMaxRows = 2000
        If $IsObject(pOptions) {
            If pOptions.%IsDefined("labelMode") {
                Set tMode = pOptions.%Get("labelMode")
                If (tMode = "full") || (tMode = "short") Set tLabelMode = tMode
            }
            If pOptions.%IsDefined("maxRows") {
                Set tMax = +pOptions.%Get("maxRows") \ 1
                If tMax > 0 Set tMaxRows = tMax
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

        Set pResult = {}
        Do pResult.%Set("diagrams", tDiagrams)
        Do pResult.%Set("count", tDiagrams.%Size(), "number")
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Run the Load → Correlate → Compress → Write pipeline for ONE session and return its
/// diagram object. Never throws to the caller: any hard failure is converted into a
/// comment-only diagram + warning (best-effort contract, decision G3).
ClassMethod GenerateOne(pSessionId As %String, pLabelMode As %String = "full", pMaxRows As %Integer = 2000) As %DynamicObject [ Internal ]
{
    Set tDiag = {}
    Try {
        Do tDiag.%Set("sessionId", +pSessionId, "number")

        Set tSC = ##class(ExecuteMCPv2.Diagram.Loader).LoadSession(pSessionId, pMaxRows, .tEvents, .tTruncated)
        If $$$ISOK(tSC) Set tSC = ##class(ExecuteMCPv2.Diagram.Correlator).Correlate(tEvents, pLabelMode, .tRender)
        If $$$ISOK(tSC) Set tSC = ##class(ExecuteMCPv2.Diagram.Compressor).Compress(tRender, .tCompressed)
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
        ; order (pairloop events already carry the deduped merge of their iterations)
        Set tWarnings = []
        For tI = 1:1:tCompressed.Count() {
            Set tRE = tCompressed.GetAt(tI)
            For tW = 1:1:tRE.Warnings.Count() {
                Do tWarnings.%Push(tRE.Warnings.GetAt(tW))
            }
        }

        Do tDiag.%Set("mermaid", tMermaid)
        Do tDiag.%Set("messageCount", tMsgCount, "number")
        Do tDiag.%Set("warnings", tWarnings)
        Do tDiag.%Set("truncated", ''tTruncated, "boolean")
    } Catch ex {
        Do ..ApplyFailure(tDiag, pSessionId, ex.AsStatus())
    }
    Quit tDiag
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
            Set tText = $System.Status.GetErrorText(tSafe)
            ; Rule #8: strip the single "ERROR #N: " (or locale-variant) prefix
            ; GetErrorText re-adds on the re-wrapped status (CR 21.0 review).
            Set tColon = $Find(tText, ": ")
            If (tColon > 0) && ($Extract(tText, 1, tColon - 3) ? .E1"#"1.N) {
                Set tText = $Extract(tText, tColon, *)
            }
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
