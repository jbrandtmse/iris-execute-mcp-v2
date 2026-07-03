/// One entry in the ordered render-event stream that flows
/// <class>ExecuteMCPv2.Diagram.Correlator</class> → <class>ExecuteMCPv2.Diagram.Compressor</class>
/// → <class>ExecuteMCPv2.Diagram.Writer</class> (Epic 21, Stories 21.0/21.1).
/// <p><property>Kind</property> discriminates three shapes:</p>
/// <ul>
///   <li><code>"arrow"</code> — one rendered message arrow. Uses <property>Src</property>,
///       <property>Dst</property>, <property>Label</property>, <property>Arrow</property>,
///       <property>IsError</property>, plus the pairing metadata
///       (<property>PairId</property>/<property>Role</property>) the compressor needs.</li>
///   <li><code>"pairloop"</code> — a synthetic pair-level loop block produced by the
///       compressor: <property>Count</property> iterations of the request/response legs
///       referenced by <property>Req</property> and <property>Resp</property>.</li>
///   <li><code>"episodeloop"</code> — a synthetic episode-level loop block (Story 21.1,
///       §6.3): <property>Count</property> iterations of the multi-hop episode whose
///       representative body events live in <property>Body</property>;
///       <property>Label</property> carries the representative loop label.</li>
/// </ul>
/// <p><property>Warnings</property> carries the anomaly texts attached to this event;
/// they are emitted both as <code>%%</code> Mermaid comments and mirrored into the
/// structured <code>warnings[]</code> array (decision G3 best-effort contract). For an
/// episodeloop the list carries the deduped EXTRAS from compressed iterations 2..N —
/// texts not already present on the representative body's events (§6.4 item 8).</p>
Class ExecuteMCPv2.Diagram.RenderEvent Extends %RegisteredObject
{

/// Event shape discriminator: <code>"arrow"</code>, <code>"pairloop"</code>, or <code>"episodeloop"</code>.
Property Kind As %String(MAXLEN = 16) [ InitialExpression = "arrow" ];

/// Source config item name (arrow kind).
Property Src As %String(MAXLEN = "");

/// Destination config item name (arrow kind).
Property Dst As %String(MAXLEN = "");

/// Display label (label mode already applied; <code>"(no body)"</code> for bodyless headers).
/// <p>The <code> [ERROR]</code> suffix is NOT part of the label — the writer appends it
/// from <property>IsError</property> at emission time.</p>
Property Label As %String(MAXLEN = "");

/// Mermaid arrow literal: sync <code>"->>"</code> or async <code>"-->>"</code>.
Property Arrow As %String(MAXLEN = 8) [ InitialExpression = "->>" ];

/// Improvement I1 — errored message flag. Participates in the pair signature so an
/// errored pair never merges into a clean loop.
Property IsError As %Boolean [ InitialExpression = 0 ];

/// Correlation pair identifier; 0 when this arrow is unpaired.
/// <p>The request leg and its response leg share the same positive PairId.</p>
Property PairId As %Integer [ InitialExpression = 0 ];

/// Role of an arrow event, set from the EFFECTIVE type for every correlator-emitted
/// arrow (Story 21.1): <code>"req"</code> or <code>"resp"</code>. Unpairedness is
/// signaled by <property>PairId</property> = 0, NOT by an empty Role — the episode
/// tier's depth stack needs the request/response distinction on unpaired arrows too,
/// while the pair tier gates on <code>PairId &gt; 0</code>. <code>""</code> occurs only
/// on synthetic non-arrow kinds (pairloop/episodeloop).
Property Role As %String(MAXLEN = 8);

/// Trace-utility event flag (Story 21.1, §6.3): true when the ORIGINAL body class starts
/// with <code>HS.Util.Trace.</code>. Trace events are excluded from episode signatures
/// but retained in rendered bodies; between-episode trace events attach to the previous
/// episode (§6.4 item 5).
Property IsTrace As %Boolean [ InitialExpression = 0 ];

/// Iteration count (pairloop and episodeloop kinds).
Property Count As %Integer [ InitialExpression = 0 ];

/// Representative request leg (pairloop kind).
Property Req As ExecuteMCPv2.Diagram.RenderEvent;

/// Representative response leg (pairloop kind).
Property Resp As ExecuteMCPv2.Diagram.RenderEvent;

/// Representative episode body (episodeloop kind): the first compressed iteration's
/// ordered events (arrows and pair-loops — pair-loops render INSIDE episode loops).
Property Body As list Of ExecuteMCPv2.Diagram.RenderEvent;

/// Anomaly/warning texts for this event (deduped merge of all iterations for a pairloop).
Property Warnings As list Of %String(MAXLEN = "");

}
