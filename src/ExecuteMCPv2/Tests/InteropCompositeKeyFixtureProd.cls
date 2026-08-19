/// Durable fixture production for Story 35.1 (composite-key resolution) regression
/// coverage. One config item (<var>FixtureOp</var>), never started (Enabled="false"
/// on the item; the production itself is also never started by the test suite —
/// see <class>ExecuteMCPv2.Tests.InteropItemCompositeKeyTest</class>). Fixture-only
/// class (mirrors <class>ExecuteMCPv2.Tests.AdvisorFixture</class>) — deliberately
/// OUT of the bootstrap manifest (Rule #39).
Class ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd Extends Ens.Production
{

XData ProductionDefinition
{
<Production Name="ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd" LogGeneralTraceEvents="false">
  <Description>Durable fixture production for Story 35.1 composite-key regression coverage. Never started.</Description>
  <ActorPoolSize>2</ActorPoolSize>
  <Item Name="FixtureOp" Category="" ClassName="EnsLib.File.PassthroughOperation" PoolSize="1" Enabled="false" Foreground="false" Comment="" LogTraceEvents="false" Schedule="">
  </Item>
</Production>
}

}
