/// <p>Test fixture for Story 22.0 (LOC counter): an INTERMEDIATE unit-test base class
/// with NO Test* methods. <class>ExecuteMCPv2.Tests.LocFixtureChild</class> extends
/// this class (not <class>%UnitTest.TestCase</class> directly) so the scanner tests
/// can verify TRANSITIVE <code>%IsA("%UnitTest.TestCase")</code> detection — the
/// reference tool's <code>Extends.*%UnitTest</code> regex would miss such subclasses.</p>
/// <p>Fixture only — stays OUT of the bootstrap class list.</p>
Class ExecuteMCPv2.Tests.LocFixtureBase Extends %UnitTest.TestCase
{

}
