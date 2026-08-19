/// Second durable fixture production for Story 35.1 — carries a config item with the
/// SAME name (<var>FixtureOp</var>) as <class>ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd</class>,
/// in a DIFFERENT production, so <class>ExecuteMCPv2.Tests.InteropItemCompositeKeyTest</class>
/// can prove the composite-key fix never lets a write to one production's item land on
/// the other production's same-named item (#29/#50 — never a silent wrong-row write).
/// Never started. Fixture-only class, deliberately OUT of the bootstrap manifest (Rule #39).
Class ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd2 Extends Ens.Production
{

XData ProductionDefinition
{
<Production Name="ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd2" LogGeneralTraceEvents="false">
  <Description>Second durable fixture production (same item name, different production) for Story 35.1 cross-production no-silent-wrong-row-write regression coverage. Never started.</Description>
  <ActorPoolSize>2</ActorPoolSize>
  <Item Name="FixtureOp" Category="" ClassName="EnsLib.File.PassthroughOperation" PoolSize="1" Enabled="false" Foreground="false" Comment="fixture2-baseline" LogTraceEvents="false" Schedule="">
  </Item>
</Production>
}

}
