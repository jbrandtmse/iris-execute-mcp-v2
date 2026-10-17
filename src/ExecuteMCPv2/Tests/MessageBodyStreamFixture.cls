/// Data-free fixture for <class>ExecuteMCPv2.Tests.MessageBodyTest</class> (Story 39.7): an unsaved object with
/// top-level character and binary stream properties, so <method>ExecuteMCPv2.REST.MessageBody:PropertyDump</method>
/// can be driven without a stored message body. Nothing here is persistent and nothing is read from a namespace.
/// This class is a test fixture and is not part of the bootstrapped set.
Class ExecuteMCPv2.Tests.MessageBodyStreamFixture Extends %RegisteredObject
{

/// A plain datatype property, dumped as a string.
Property Name As %String;

/// A character stream: its text is dumped when the dump has a budget.
Property Content As %Stream.GlobalCharacter;

/// A binary stream: only its class and size are dumped.
Property Blob As %Stream.GlobalBinary;

/// A second character stream, which shares the dump's budget with <property>Content</property>.
Property Second As %Stream.GlobalCharacter;

}
