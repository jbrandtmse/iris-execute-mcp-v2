/// Durable fixture production for Story 35.1 Task 7 (AC 35.1.7) regression coverage. Both
/// config items carry a ClassName that is compiled but does NOT extend any recognized Ens
/// business host type (<code>%Stream.GlobalCharacter</code> — live-probed via
/// <code>Ens.Config.Item:GetBusinessType</code> to return <code>$$$eHostTypeUnknown</code>,
/// Story 35.1 Dev Notes), so <code>Ens.Config.Production:findItemIdByName</code> skips them
/// (irislib/Ens/Config/Production.cls:739) and <code>FindItemByConfigName</code> returns
/// <code>$$$NULLOREF</code> — while raw-SQL <code>get</code> still resolves them. Reproduces
/// a real-world unrepairable item: a deleted/renamed/uncompiled host class, or one created
/// before this story's <code>ValidateHostClassName</code> guard existed. Never started.
/// Fixture-only class (mirrors <class>ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd</class>),
/// deliberately OUT of the bootstrap manifest (Rule #39).
/// <p><var>UnresolvableSetOp</var> — used by <method>TestSetReachesUnresolvableHostItemAndRepairPersists</method>
/// to prove <code>set</code> can reach and repair the item.</p>
/// <p><var>UnresolvableRemoveOp</var> — used by <method>TestRemoveReachesUnresolvableHostItem</method>;
/// removal is destructive, so the test's teardown re-creates it directly (mirrors the
/// pre-existing className-repair the item itself represents — see the test class doc comment).</p>
/// <p><var>DeletedHostOp</var> (added at the Task 7 code review, CR 35.1-14/15) — its
/// <var>ClassName</var> names a class that does NOT EXIST on the system at all, which is a
/// DIFFERENT shape from the two items above: both are skipped identically by
/// <code>findItemIdByName</code> (<code>GetBusinessType</code> returns
/// <code>$$$eHostTypeUnknown</code> for each — live-probed), but they diverge inside
/// <code>Ens.Config.Production:SaveToClass</code>, whose Catch swallows ONLY
/// <code>&lt;METHOD DOES NOT EXIST&gt;</code> (Production.cls:148-157). A compiled non-host class
/// raises exactly that and is swallowed; a MISSING class raises
/// <code>&lt;CLASS DOES NOT EXIST&gt;</code> and becomes <code>$$$EnsSystemError</code> — AFTER the
/// class XData write has already committed. This item pins that path, which is the
/// deleted/renamed host class the fallback's own rationale names as its primary real-world
/// cause and which the other two items cannot reach (Rule #54/#58 — fixture diversity).</p>
Class ExecuteMCPv2.Tests.InteropUnresolvableHostFixtureProd Extends Ens.Production
{

XData ProductionDefinition
{
<Production Name="ExecuteMCPv2.Tests.InteropUnresolvableHostFixtureProd" LogGeneralTraceEvents="false">
  <Description>Durable fixture production for Story 35.1 Task 7 (AC 35.1.7) unresolvable-host-class regression coverage. Never started.</Description>
  <ActorPoolSize>2</ActorPoolSize>
  <Item Name="UnresolvableSetOp" Category="" ClassName="%Stream.GlobalCharacter" PoolSize="1" Enabled="false" Foreground="false" Comment="unresolvable-set-baseline" LogTraceEvents="false" Schedule="">
  </Item>
  <Item Name="UnresolvableRemoveOp" Category="" ClassName="%Stream.GlobalCharacter" PoolSize="1" Enabled="false" Foreground="false" Comment="unresolvable-remove-baseline" LogTraceEvents="false" Schedule="">
  </Item>
  <Item Name="DeletedHostOp" Category="" ClassName="ExecuteMCPv2.Tests.NoSuchHostClassDoesNotExist" PoolSize="1" Enabled="false" Foreground="false" Comment="deleted-host-baseline" LogTraceEvents="false" Schedule="">
  </Item>
</Production>
}

}
