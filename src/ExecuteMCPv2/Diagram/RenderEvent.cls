/// One entry in the ordered render-event stream that flows
/// <class>ExecuteMCPv2.Diagram.Correlator</class> → <class>ExecuteMCPv2.Diagram.Compressor</class>
/// → <class>ExecuteMCPv2.Diagram.Writer</class> (Epic 21, Story 21.0).
/// <p><property>Kind</property> discriminates two shapes:</p>
/// <ul>
///   <li><code>"arrow"</code> — one rendered message arrow. Uses <property>Src</property>,
///       <property>Dst</property>, <property>Label</property>, <property>Arrow</property>,
///       <property>IsError</property>, plus the pairing metadata
///       (<property>PairId</property>/<property>Role</property>) the compressor needs.</li>
///   <li><code>"pairloop"</code> — a synthetic pair-level loop block produced by the
///       compressor: <property>Count</property> iterations of the request/response legs
///       referenced by <property>Req</property> and <property>Resp</property>.</li>
/// </ul>
/// <p><property>Warnings</property> carries the anomaly texts attached to this event;
/// they are emitted both as <code>%%</code> Mermaid comments and mirrored into the
/// structured <code>warnings[]</code> array (decision G3 best-effort contract).</p>
Class ExecuteMCPv2.Diagram.RenderEvent Extends %RegisteredObject
{

/// Event shape discriminator: <code>"arrow"</code> or <code>"pairloop"</code>.
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

/// Pairing role of an arrow event: <code>"req"</code>, <code>"resp"</code>, or <code>""</code> (unpaired).
Property Role As %String(MAXLEN = 8);

/// Iteration count (pairloop kind).
Property Count As %Integer [ InitialExpression = 0 ];

/// Representative request leg (pairloop kind).
Property Req As ExecuteMCPv2.Diagram.RenderEvent;

/// Representative response leg (pairloop kind).
Property Resp As ExecuteMCPv2.Diagram.RenderEvent;

/// Anomaly/warning texts for this event (deduped merge of all iterations for a pairloop).
Property Warnings As list Of %String(MAXLEN = "");

}
