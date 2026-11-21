/// In-memory model of one loaded <class>Ens.MessageHeader</class> row for the
/// message-trace sequence-diagram library (Epic 21, Story 21.0).
/// <p>Instances are produced by <class>ExecuteMCPv2.Diagram.Loader</class> with all
/// values NORMALIZED at load time:</p>
/// <ul>
///   <li><property>Type</property> — logical <code>"Request"</code> / <code>"Response"</code> / <code>""</code> (unknown, e.g. Terminate)</li>
///   <li><property>Invocation</property> — logical <code>"Inproc"</code> / <code>"Queue"</code> / <code>""</code> (unknown)</li>
///   <li><property>ErrorText</property> — pre-sanitized one-line error summary (never raw <code>%Status</code> internals)</li>
/// </ul>
/// <p>Clean-room implementation per architecture decision G2 — written fresh against
/// sprint-change-proposal-2026-07-02.md §6; no reference-tool code consulted.</p>
Class ExecuteMCPv2.Diagram.Event Extends %RegisteredObject
{

/// <class>Ens.MessageHeader</class> row ID.
Property Id As %Integer;

/// Normalized invocation style: <code>"Inproc"</code>, <code>"Queue"</code>, or <code>""</code> when unknown.
Property Invocation As %String(MAXLEN = 16);

/// Message body class name (<code>MessageBodyClassName</code>); <code>""</code> when the header is bodyless (NULL).
Property BodyClass As %String(MAXLEN = "");

/// Session this message belongs to.
Property SessionId As %Integer;

/// Source config item name (<code>SourceConfigName</code>).
Property Source As %String(MAXLEN = "");

/// Target config item name (<code>TargetConfigName</code>).
Property Target As %String(MAXLEN = "");

/// Queue name where responses should be sent (<code>ReturnQueueName</code>) — async correlation fallback.
Property ReturnQueue As %String(MAXLEN = "");

/// Corresponding request/response ID; <code>""</code> when not set.
Property CorrId As %String(MAXLEN = 32);

/// UTC timestamp string (logical <code>Ens.DataType.UTC</code> value) — ordering + metadata header only.
Property TimeCreated As %String(MAXLEN = 64);

/// Normalized message type: <code>"Request"</code>, <code>"Response"</code>, or <code>""</code> when unknown.
Property Type As %String(MAXLEN = 16);

/// Whether the message reported an error (<code>IsError</code>) — improvement I1.
Property IsError As %Boolean [ InitialExpression = 0 ];

/// Sanitized one-line error summary derived from <code>ErrorStatus</code> at load time.
/// <p>Empty when <property>IsError</property> is 0. Never contains raw IRIS internals,
/// caret-global references, or line breaks (Rule #33 discipline applied by the loader).</p>
Property ErrorText As %String(MAXLEN = "");

}
