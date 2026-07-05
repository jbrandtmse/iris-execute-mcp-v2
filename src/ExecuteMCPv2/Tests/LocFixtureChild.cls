/// <p>Test fixture for Story 22.0 (LOC counter): extends the intermediate
/// <class>ExecuteMCPv2.Tests.LocFixtureBase</class> (NOT
/// <class>%UnitTest.TestCase</class> directly) — the scanner must classify this class
/// as a test class TRANSITIVELY via <code>%IsA</code>.</p>
/// <p>Also carries an embedded-python helper (NOT a Test* method) so the scanner's
/// python-method map (<class>%Dictionary.CompiledMethod</class>.Language) has a
/// compiled fixture to find.</p>
/// <p>Fixture only — no Test* methods, stays OUT of the bootstrap class list.</p>
Class ExecuteMCPv2.Tests.LocFixtureChild Extends ExecuteMCPv2.Tests.LocFixtureBase
{

/// Embedded-python helper — exists so BuildClassMetadata finds Language="python".
ClassMethod PyHelper() As %String [ Language = python ]
{
    # python fixture comment
    return "loc-fixture"
}

}
