/// <p>Durable fixture schema for Epic 28 (SQL Performance Advisor), Story 28.2.
/// Design recorded by Story 28.0 (spec §5); BUILT here. A <class>%Persistent</class>
/// class with:</p>
/// <ul>
///   <li><var>IndexedCol</var> — HAS an index (<code>IdxIndexedCol</code>). The
///       negative case for <code>missing-index</code>: a WHERE on this column must
///       yield NO finding (an index map read, not a master-map scan).</li>
///   <li><var>UnindexedCol</var> — has NO index. The positive case for
///       <code>missing-index</code>: a WHERE on this column must yield a
///       <code>full-scan</code> + <code>missing-index</code> finding with a correct
///       suggested <code>CREATE INDEX</code> DDL.</li>
/// </ul>
/// <p>Deliberately carries NO <code>EXTENTSIZE</code> Storage keyword and is never
/// tuned at creation time, so <code>EXPLAIN</code> emits the
/// <code>Warning:\nTable ExecuteMCPv2.Tests.AdvisorFixture is not tuned.</code> block
/// until <method>Populate</method>'s caller separately runs
/// <code>$SYSTEM.SQL.Stats.Table.GatherTableStats(...)</code> (Story 28.2's
/// before-tune/after-tune fixture-capture pair, spec §5 / AC 28.2.2).</p>
/// <p>Fixture-only class (mirrors <class>ExecuteMCPv2.Tests.LocFixtureBase</class>) —
/// deliberately OUT of the bootstrap manifest (Rule #39): NOT added to
/// <code>scripts/gen-bootstrap.mjs</code> <code>classes[]</code> or
/// <code>packages/shared/src/__tests__/bootstrap.test.ts</code>.</p>
Class ExecuteMCPv2.Tests.AdvisorFixture Extends %Persistent
{

/// Column WITHOUT an index (the <code>missing-index</code> positive case).
Property UnindexedCol As %String;

/// Column WITH an index (the <code>missing-index</code> negative case).
Property IndexedCol As %String;

Index IdxIndexedCol On IndexedCol;

/// Seed <var>pRows</var> deterministic rows (<code>UnindexedCol</code>/<code>
/// IndexedCol</code> = <code>"U"_i</code>/<code>"I"_i</code>), mirroring the Story
/// 28.0 disposable probe schema's naming so the reference-captured plan text lines
/// up with the pinned probe findings. Enough rows (default 2000, matching Story
/// 28.0) that the plan/cost output is meaningful.
ClassMethod Populate(pRows As %Integer = 2000) As %Status
{
    Set tSC = $$$OK
    Try {
        For tI = 1:1:pRows {
            Set tObj = ..%New()
            Set tObj.UnindexedCol = "U"_tI
            Set tObj.IndexedCol = "I"_tI
            Set tSC = tObj.%Save()
            If $$$ISERR(tSC) Quit
        }
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

/// Delete all seeded rows (leaves the class/index/extent definition intact —
/// callers needing a fully clean re-tune state should re-run <method>Populate</method>
/// after this).
ClassMethod DeleteAll() As %Status
{
    Set tSC = $$$OK
    Try {
        Set tSC = ..%KillExtent()
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}

}
