/// Mermaid emitter for the message-trace sequence-diagram library (Epic 21, Story 21.0).
/// <p>Emits ONLY the decision-G3 Mermaid subset: <code>sequenceDiagram</code>,
/// <code>participant &lt;id&gt; [as &lt;label&gt;]</code>, sync <code>-&gt;&gt;</code> /
/// async <code>--&gt;&gt;</code> arrows, <code>loop N times … end</code> blocks, and
/// <code>%%</code> comments. No autonumber, activate, Note, or alt/opt.</p>
/// <p>Per §6.2 of sprint-change-proposal-2026-07-02.md:</p>
/// <ul>
///   <li><b>I2</b> — each diagram opens with <code>%% Session &lt;id&gt;: &lt;n&gt; messages,
///       &lt;first TimeCreated&gt; .. &lt;last TimeCreated&gt;</code>; an empty session yields a
///       minimal valid diagram plus <code>%% No data available</code>.</li>
///   <li><b>Participants</b> — first-appearance order over the COMPRESSED stream; IDs keep
///       <code>[A-Za-z0-9_.]</code> (other characters become <code>_</code>, empty becomes
///       <code>P</code>); collisions get <code>_2</code>/<code>_3</code>… suffixes; the
///       <code>as &lt;label&gt;</code> clause is emitted only when the label differs from the
///       id (every participant is still declared so Mermaid preserves first-appearance
///       column order).</li>
///   <li><b>I1</b> — an errored arrow's label gets an <code> [ERROR]</code> suffix and its
///       warnings render as <code>%%</code> comments after the arrow line.</li>
///   <li><b>Single-line discipline</b> — every emitted label/comment has CR/LF/TAB
///       collapsed to spaces (a newline inside a label or comment breaks Mermaid).</li>
///   <li><b>Nesting (Story 21.1)</b> — episode loops render as
///       <code>loop N times &lt;representative label&gt;</code> blocks whose bodies are
///       indented 2 spaces per nesting level; pair-loops render INSIDE episode loops;
///       <code>end</code> lines close blocks at their opening depth.</li>
/// </ul>
Class ExecuteMCPv2.Diagram.Writer Extends %RegisteredObject
{

/// Render the compressed render-event stream as one Mermaid <code>sequenceDiagram</code>.
/// <p><var>pFirstTime</var>/<var>pLastTime</var> feed the I2 metadata header and are the
/// TimeCreated values of the first/last LOADED message (pre-compression);
/// <var>pMessageCount</var> is the loaded (post-filter, post-truncation) row count.</p>
ClassMethod Write(pSessionId As %String, pMessageCount As %Integer, pFirstTime As %String, pLastTime As %String, pRenderEvents As %Library.ListOfObjects, Output pMermaid As %String) As %Status
{
    Set tSC = $$$OK
    Set pMermaid = ""
    Try {
        Set tNL = $Char(10)
        Set tOut = "sequenceDiagram"_tNL

        ; I2 session metadata header
        Set tHeader = "%% Session "_(+pSessionId)_": "_(+pMessageCount)_" messages"
        If (+pMessageCount > 0) && (pFirstTime '= "") {
            Set tHeader = tHeader_", "_..SingleLine(pFirstTime)_" .. "_..SingleLine(pLastTime)
        }
        Set tOut = tOut_tHeader_tNL

        Set tN = 0
        If $IsObject(pRenderEvents) Set tN = pRenderEvents.Count()
        If tN = 0 {
            Set tOut = tOut_"%% No data available"
            Set pMermaid = tOut
            Quit
        }

        ; ── participant registry: first-appearance order over the compressed stream ──
        ; (recurses into episodeloop bodies — Story 21.1 nesting)
        Set tPartCount = 0
        Do ..RegisterFromEvents(pRenderEvents, .tIdOf, .tTaken, .tOrder, .tPartCount)
        For tI = 1:1:tPartCount {
            Set tName = tOrder(tI)
            Set tId = tIdOf("n"_tName)
            Set tLabel = ..SingleLine(tName)
            If (tLabel = tId) || (tLabel = "") {
                Set tOut = tOut_"participant "_tId_tNL
            } Else {
                Set tOut = tOut_"participant "_tId_" as "_tLabel_tNL
            }
        }

        ; ── body (recursive: episode loops nest pair loops, 2 spaces per level) ──
        Set tOut = tOut_..RenderBody(pRenderEvents, 0, .tIdOf)

        ; drop the final trailing newline for a tidy payload
        If $Extract(tOut, *) = tNL Set tOut = $Extract(tOut, 1, *-1)
        Set pMermaid = tOut
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Walk a render-event list (recursing into episodeloop bodies) and register every
/// participant in first-appearance order (Story 21.1 — the registry must see names
/// nested inside episode loops exactly where they first render).
ClassMethod RegisterFromEvents(pEvents As %Library.ListOfObjects, ByRef pIdOf, ByRef pTaken, ByRef pOrder, ByRef pCount) As %Status [ Internal ]
{
    Set tN = 0
    If $IsObject(pEvents) Set tN = pEvents.Count()
    For tI = 1:1:tN {
        Set tEv = pEvents.GetAt(tI)
        If tEv.Kind = "arrow" {
            Do ..RegisterParticipant(tEv.Src, .pIdOf, .pTaken, .pOrder, .pCount)
            Do ..RegisterParticipant(tEv.Dst, .pIdOf, .pTaken, .pOrder, .pCount)
        } ElseIf tEv.Kind = "pairloop" {
            Do ..RegisterParticipant(tEv.Req.Src, .pIdOf, .pTaken, .pOrder, .pCount)
            Do ..RegisterParticipant(tEv.Req.Dst, .pIdOf, .pTaken, .pOrder, .pCount)
            Do ..RegisterParticipant(tEv.Resp.Src, .pIdOf, .pTaken, .pOrder, .pCount)
            Do ..RegisterParticipant(tEv.Resp.Dst, .pIdOf, .pTaken, .pOrder, .pCount)
        } ElseIf tEv.Kind = "episodeloop" {
            Do ..RegisterFromEvents(tEv.Body, .pIdOf, .pTaken, .pOrder, .pCount)
        }
    }
    Quit $$$OK
}

/// Render a render-event list at the given nesting depth (indent = 2 spaces per level).
/// <p>Arrows render at the current depth with their warnings as <code>%%</code> comments
/// at the same depth. A pairloop opens <code>loop N times</code> at the current depth
/// with its legs and deduped warnings one level deeper. An episodeloop (Story 21.1)
/// opens <code>loop N times &lt;representative label&gt;</code> at the current depth,
/// recursively renders its body one level deeper (pair-loops render INSIDE episode
/// loops), then emits the loop-level warning EXTRAS (deduped from compressed iterations
/// 2..N — §6.4 item 8) before the closing <code>end</code>.</p>
/// <p>Every emitted chunk ends with a newline; the caller trims the final one.</p>
ClassMethod RenderBody(pEvents As %Library.ListOfObjects, pDepth As %Integer, ByRef pIdOf) As %String [ Internal ]
{
    Set tNL = $Char(10)
    Set tIndent = $Justify("", pDepth * 2)
    Set tInner = $Justify("", (pDepth + 1) * 2)
    Set tOut = ""
    Set tN = 0
    If $IsObject(pEvents) Set tN = pEvents.Count()
    For tI = 1:1:tN {
        Set tEv = pEvents.GetAt(tI)
        If tEv.Kind = "arrow" {
            Set tOut = tOut_..ArrowLine(tEv, .pIdOf, tIndent)_tNL
            For tW = 1:1:tEv.Warnings.Count() {
                Set tOut = tOut_tIndent_"%% "_..SingleLine(tEv.Warnings.GetAt(tW))_tNL
            }
        } ElseIf tEv.Kind = "pairloop" {
            Set tOut = tOut_tIndent_"loop "_(+tEv.Count)_" times"_tNL
            Set tOut = tOut_..ArrowLine(tEv.Req, .pIdOf, tInner)_tNL
            Set tOut = tOut_..ArrowLine(tEv.Resp, .pIdOf, tInner)_tNL
            ; loop-level warnings are the deduped merge of all compressed iterations;
            ; the leg events' own warning lists are NOT re-rendered (they were merged)
            For tW = 1:1:tEv.Warnings.Count() {
                Set tOut = tOut_tInner_"%% "_..SingleLine(tEv.Warnings.GetAt(tW))_tNL
            }
            Set tOut = tOut_tIndent_"end"_tNL
        } ElseIf tEv.Kind = "episodeloop" {
            Set tLabel = ..SingleLine(tEv.Label)
            Set tOut = tOut_tIndent_"loop "_(+tEv.Count)_" times"_$Select(tLabel = "": "", 1: " "_tLabel)_tNL
            Set tOut = tOut_..RenderBody(tEv.Body, pDepth + 1, .pIdOf)
            For tW = 1:1:tEv.Warnings.Count() {
                Set tOut = tOut_tInner_"%% "_..SingleLine(tEv.Warnings.GetAt(tW))_tNL
            }
            Set tOut = tOut_tIndent_"end"_tNL
        }
    }
    Quit tOut
}

/// Register a participant name (first-appearance order, collision-suffixed ids).
/// <p><var>pIdOf</var> maps <code>"n"_name</code> → id (the "n" prefix keeps an empty
/// participant name from becoming an illegal empty subscript); <var>pTaken</var> tracks
/// claimed ids; <var>pOrder(seq)</var> records first-appearance order.</p>
ClassMethod RegisterParticipant(pName As %String, ByRef pIdOf, ByRef pTaken, ByRef pOrder, ByRef pCount) As %Status [ Internal ]
{
    If $Data(pIdOf("n"_pName)) Quit $$$OK
    Set tBase = ..SanitizeId(pName)
    Set tId = tBase
    Set tSuffix = 2
    While $Data(pTaken(tId)) {
        Set tId = tBase_"_"_tSuffix
        Set tSuffix = tSuffix + 1
    }
    Set pTaken(tId) = 1
    Set pIdOf("n"_pName) = tId
    Set pCount = pCount + 1
    Set pOrder(pCount) = pName
    Quit $$$OK
}

/// Format one arrow line: <code>&lt;srcId&gt;-&gt;&gt;&lt;dstId&gt;: &lt;label&gt;</code>,
/// with the improvement-I1 <code> [ERROR]</code> suffix when the event is errored.
/// <p>A label that collapses to empty after single-line stripping (e.g. whitespace-only
/// body class, or a short-mode segment that reduced to "") falls back to the
/// <code>(no body)</code> placeholder so the emitted arrow always carries a label
/// (CR 21.0 review — the G3 grammar requires a non-empty arrow label).</p>
ClassMethod ArrowLine(pEv As ExecuteMCPv2.Diagram.RenderEvent, ByRef pIdOf, pIndent As %String = "") As %String [ Internal ]
{
    Set tLabel = ..SingleLine(pEv.Label)
    If tLabel = "" Set tLabel = "(no body)"
    If pEv.IsError Set tLabel = tLabel_" [ERROR]"
    Quit pIndent_$Get(pIdOf("n"_pEv.Src))_pEv.Arrow_$Get(pIdOf("n"_pEv.Dst))_": "_tLabel
}

/// Sanitize a participant name into a Mermaid-safe id: keep <code>[A-Za-z0-9_.]</code>
/// (strict ASCII), replace anything else with <code>_</code>; an empty result becomes
/// <code>P</code> (§6.2).
ClassMethod SanitizeId(pName As %String) As %String [ Internal ]
{
    Set tId = ""
    For tJ = 1:1:$Length(pName) {
        Set tCode = $Ascii(pName, tJ)
        If ((tCode >= 65) && (tCode <= 90)) || ((tCode >= 97) && (tCode <= 122)) || ((tCode >= 48) && (tCode <= 57)) || (tCode = 95) || (tCode = 46) {
            Set tId = tId_$Char(tCode)
        } Else {
            Set tId = tId_"_"
        }
    }
    If tId = "" Set tId = "P"
    ; Mermaid sequenceDiagram statement keywords cannot serve as bare participant ids:
    ; a config item literally named "end" (or "loop", "alt", ...) would terminate the
    ; emitted loop blocks or be lexed as a statement keyword at line start, breaking the
    ; whole diagram. Suffix such ids with "_" — the original name still displays via the
    ; as-label because id != label then forces the as clause (CR 21.0 review).
    If $ListFind($ListFromString("end,loop,alt,opt,par,and,else,rect,break,critical,option,box,participant,actor,activate,deactivate,note,over,autonumber,title,sequencediagram,create,destroy,links,link,properties,details"), $ZConvert(tId, "L")) {
        Set tId = tId_"_"
    }
    Quit tId
}

/// Collapse CR/LF/TAB to single spaces, trim outer whitespace, and escape semicolons —
/// a newline inside a label or <code>%%</code> comment breaks Mermaid (single-line
/// discipline), and Mermaid sequenceDiagram treats a raw <code>;</code> as a statement
/// separator ("use #59; to include a semicolon" per the Mermaid docs), so a config name
/// or error text containing <code>;</code> would split the line into junk statements
/// (CR 21.0 review). <code>#59;</code> renders back as <code>;</code>.
ClassMethod SingleLine(pText As %String) As %String [ Internal ]
{
    Quit $Replace($ZStrip($Translate(pText, $Char(13, 10, 9), "   "), "<>W"), ";", "#59;")
}

}
