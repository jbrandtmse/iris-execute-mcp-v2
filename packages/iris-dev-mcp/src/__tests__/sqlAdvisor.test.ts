import { describe, it, expect } from "vitest";
import { analyzeAdviceData, type AdvisorFinding } from "../tools/sqlAdvisor.js";
import {
  ADVISE_DATA_UNINDEXED_BEFORE_TUNE,
  ADVISE_DATA_INDEXED_BEFORE_TUNE,
  ADVISE_DATA_GROUPBY_TEMPFILE_BEFORE_TUNE,
  ADVISE_DATA_UNINDEXED_AFTER_TUNE,
  ADVISE_DATA_SYSTEM_SCHEMA_QUERY,
  ADVISE_DATA_RANGE_PREDICATE_AFTER_TUNE,
  ADVISE_DATA_ENDPOINT_ERROR_RESULT,
  ADVISE_DATA_LIKE_PREDICATE_AFTER_TUNE,
} from "./sqlAdvisor.fixtures.js";

/** Every finding must carry a non-empty citation (AC 28.2.3: "Zero findings
 *  are ever emitted without a cited evidence + planExcerpt"). */
function expectValidFinding(finding: AdvisorFinding): void {
  expect(finding.evidence).toBeTruthy();
  expect(finding.planExcerpt).toBeTruthy();
  expect(finding.recommendation).toBeTruthy();
  expect(["high", "medium", "low"]).toContain(finding.confidence);
}

function findingTypes(findings: AdvisorFinding[]): string[] {
  return findings.map((f) => f.type).sort();
}

describe("analyzeAdviceData", () => {
  // ── full-scan ─────────────────────────────────────────────────────

  describe("full-scan", () => {
    it("fires: WHERE on the unindexed column (reference-captured, before tune)", () => {
      const result = analyzeAdviceData(ADVISE_DATA_UNINDEXED_BEFORE_TUNE);
      const finding = result.findings.find((f) => f.type === "full-scan");
      expect(finding).toBeDefined();
      expectValidFinding(finding!);
      expect(finding!.evidence).toContain("ExecuteMCPv2_Tests.AdvisorFixture");
      expect(finding!.planExcerpt).toContain("Read master map");
    });

    it("does NOT fire: WHERE on the indexed column (index map read, not a master-map scan)", () => {
      const result = analyzeAdviceData(ADVISE_DATA_INDEXED_BEFORE_TUNE);
      expect(result.findings.some((f) => f.type === "full-scan")).toBe(false);
    });

    it("does NOT fire: master-map read present but NO WHERE/JOIN predicate (GROUP BY/ORDER BY)", () => {
      // The plan DOES contain "Read master map ...IDKEY, looping on ID." inside
      // Module-B, but with no per-row "Test the ... condition on" line at all —
      // proving the engine requires a predicate, not just the marker.
      const result = analyzeAdviceData(ADVISE_DATA_GROUPBY_TEMPFILE_BEFORE_TUNE);
      expect(result.findings.some((f) => f.type === "full-scan")).toBe(false);
    });

    it("fires even on a system-schema table (the exclusion is missing-index-only)", () => {
      const result = analyzeAdviceData(ADVISE_DATA_SYSTEM_SCHEMA_QUERY);
      const finding = result.findings.find((f) => f.type === "full-scan");
      expect(finding).toBeDefined();
      expectValidFinding(finding!);
    });

    it("tolerates a master-map suffix other than IDKEY (live-captured: '...Master')", () => {
      // %Dictionary.CompiledClass.Master, NOT %Dictionary.CompiledClass.IDKEY —
      // a real captured variance (see fixtures file header).
      const result = analyzeAdviceData(ADVISE_DATA_SYSTEM_SCHEMA_QUERY);
      expect(result.findings.some((f) => f.type === "full-scan")).toBe(true);
    });
  });

  // ── missing-index ─────────────────────────────────────────────────

  describe("missing-index", () => {
    it("fires HIGH: single-column equality predicate on the unindexed column, before tune", () => {
      const result = analyzeAdviceData(ADVISE_DATA_UNINDEXED_BEFORE_TUNE);
      const finding = result.findings.find((f) => f.type === "missing-index");
      expect(finding).toBeDefined();
      expectValidFinding(finding!);
      expect(finding!.confidence).toBe("high");
      expect(finding!.suggestedDdl).toBe(
        "CREATE INDEX IdxUnindexedCol ON ExecuteMCPv2_Tests.AdvisorFixture (UnindexedCol). " +
          "Verify with EXPLAIN after creation.",
      );
      expect(finding!.evidence).toContain("UnindexedCol");
      expect(finding!.evidence).toContain("IdxIndexedCol"); // existing-index list consulted
    });

    it("fires HIGH again after tune (missing-index is independent of stale-stats)", () => {
      const result = analyzeAdviceData(ADVISE_DATA_UNINDEXED_AFTER_TUNE);
      const finding = result.findings.find((f) => f.type === "missing-index");
      expect(finding).toBeDefined();
      expect(finding!.confidence).toBe("high");
      expect(finding!.suggestedDdl).toContain("CREATE INDEX IdxUnindexedCol");
    });

    it("fires MEDIUM: a range predicate (not equality) on the unindexed column", () => {
      const result = analyzeAdviceData(ADVISE_DATA_RANGE_PREDICATE_AFTER_TUNE);
      const finding = result.findings.find((f) => f.type === "missing-index");
      expect(finding).toBeDefined();
      expectValidFinding(finding!);
      expect(finding!.confidence).toBe("medium");
      expect(finding!.suggestedDdl).toContain("CREATE INDEX IdxUnindexedCol ON ExecuteMCPv2_Tests.AdvisorFixture (UnindexedCol)");
    });

    it("does NOT fire: WHERE on the properly-indexed column", () => {
      const result = analyzeAdviceData(ADVISE_DATA_INDEXED_BEFORE_TUNE);
      expect(result.findings.some((f) => f.type === "missing-index")).toBe(false);
    });

    it("does NOT fire (QA gap): a LIKE-only predicate has no equality/range op, though full-scan fires", () => {
      // Reference-captured: the predicate line carries only %PATTERN /
      // %STARTSWITH / NOT NULL ops. A WHERE predicate IS present (full-scan
      // fires), but none is an equality/range op, so missing-index must NOT
      // fire — this exercises the `missingPredicates.length === 0 -> continue`
      // path (predicate-exists-but-no-equality/range).
      const result = analyzeAdviceData(ADVISE_DATA_LIKE_PREDICATE_AFTER_TUNE);
      expect(result.findings.some((f) => f.type === "full-scan")).toBe(true);
      expect(result.findings.some((f) => f.type === "missing-index")).toBe(false);
    });

    it("NEVER fires against a system schema (%Dictionary), even though full-scan fires", () => {
      const result = analyzeAdviceData(ADVISE_DATA_SYSTEM_SCHEMA_QUERY);
      expect(result.findings.some((f) => f.type === "full-scan")).toBe(true);
      expect(result.findings.some((f) => f.type === "missing-index")).toBe(false);
    });

    it("does NOT fire (CR 28.1-1): full-scan table has no matching indexes group (unresolved class)", () => {
      // Same plan as the fires-case, but `indexes` is empty — mirrors the
      // endpoint's ResolveClassForTable failing to resolve a class for the
      // table. Must degrade to "index list unknown", never a false positive.
      const result = analyzeAdviceData({
        plan: ADVISE_DATA_UNINDEXED_BEFORE_TUNE.plan!,
        tables: ADVISE_DATA_UNINDEXED_BEFORE_TUNE.tables!,
        indexes: [],
      });
      expect(result.findings.some((f) => f.type === "full-scan")).toBe(true);
      expect(result.findings.some((f) => f.type === "missing-index")).toBe(false);
    });

    it("does NOT fire (CR 28.1-2): endpoint returned empty tables AND empty indexes", () => {
      const result = analyzeAdviceData({
        plan: ADVISE_DATA_UNINDEXED_BEFORE_TUNE.plan!,
        tables: [],
        indexes: [],
      });
      expect(result.findings.some((f) => f.type === "full-scan")).toBe(true);
      expect(result.findings.some((f) => f.type === "missing-index")).toBe(false);
    });

    // ── order-preserving leading-subscript rule (AC 28.2.1, Rule #50) ────
    // These two tests exercise a code path no captured fixture reaches: a
    // COMPOSITE index over the predicate column. They reuse the real,
    // reference-captured full-scan/predicate plan text from
    // ADVISE_DATA_UNINDEXED_BEFORE_TUNE verbatim (Rule #36 — the plan text
    // that drives the finding is untouched) and vary ONLY the synthetic
    // index-dictionary metadata to prove the engine derives "leading
    // subscript" from the FIRST entry of the order-preserving `Prop:Collation`
    // string, not merely "is this column present anywhere in the index" —
    // this is deterministic parser logic over given data, not a claim about
    // what live IRIS would produce, so it does not need a new live capture.

    it("does NOT fire: a composite index has the predicate column as its LEADING subscript", () => {
      const result = analyzeAdviceData({
        ...ADVISE_DATA_UNINDEXED_BEFORE_TUNE,
        indexes: [
          {
            className: "ExecuteMCPv2.Tests.AdvisorFixture",
            schema: "ExecuteMCPv2_Tests",
            table: "AdvisorFixture",
            rows: [
              { indexName: "IDKEY", properties: "", primaryKey: false, isUnique: false, type: "key", data: "" },
              {
                indexName: "IdxComposite",
                properties: "UnindexedCol:5,IndexedCol:5",
                primaryKey: false,
                isUnique: false,
                type: "index",
                data: "",
              },
            ],
          },
        ],
      });
      expect(result.findings.some((f) => f.type === "full-scan")).toBe(true);
      expect(result.findings.some((f) => f.type === "missing-index")).toBe(false);
    });

    it("fires: a composite index has the predicate column only as a TRAILING subscript", () => {
      const result = analyzeAdviceData({
        ...ADVISE_DATA_UNINDEXED_BEFORE_TUNE,
        indexes: [
          {
            className: "ExecuteMCPv2.Tests.AdvisorFixture",
            schema: "ExecuteMCPv2_Tests",
            table: "AdvisorFixture",
            rows: [
              { indexName: "IDKEY", properties: "", primaryKey: false, isUnique: false, type: "key", data: "" },
              {
                indexName: "IdxComposite",
                properties: "IndexedCol:5,UnindexedCol:5",
                primaryKey: false,
                isUnique: false,
                type: "index",
                data: "",
              },
            ],
          },
        ],
      });
      const finding = result.findings.find((f) => f.type === "missing-index");
      expect(finding).toBeDefined();
      expectValidFinding(finding!);
      // Single missing column, equality predicate -> still HIGH confidence.
      expect(finding!.confidence).toBe("high");
    });
  });

  // ── stale-stats ───────────────────────────────────────────────────

  describe("stale-stats", () => {
    it("fires: before $SYSTEM.SQL.Stats.Table.GatherTableStats has run", () => {
      const result = analyzeAdviceData(ADVISE_DATA_UNINDEXED_BEFORE_TUNE);
      const finding = result.findings.find((f) => f.type === "stale-stats");
      expect(finding).toBeDefined();
      expectValidFinding(finding!);
      expect(finding!.planExcerpt).toContain("is not tuned.");
      expect(finding!.evidence).toContain("ExecuteMCPv2_Tests.AdvisorFixture");
    });

    it("does NOT fire: the SAME query, after GatherTableStats ran (warning block absent)", () => {
      const result = analyzeAdviceData(ADVISE_DATA_UNINDEXED_AFTER_TUNE);
      expect(result.findings.some((f) => f.type === "stale-stats")).toBe(false);
    });

    it("fires on a standalone (non-predicate) query too — GROUP BY fixture", () => {
      const result = analyzeAdviceData(ADVISE_DATA_GROUPBY_TEMPFILE_BEFORE_TUNE);
      expect(result.findings.some((f) => f.type === "stale-stats")).toBe(true);
    });
  });

  // ── plan-anomaly ──────────────────────────────────────────────────

  describe("plan-anomaly", () => {
    it("fires: GROUP BY/ORDER BY on the unindexed column (temp-file build)", () => {
      const result = analyzeAdviceData(ADVISE_DATA_GROUPBY_TEMPFILE_BEFORE_TUNE);
      const finding = result.findings.find((f) => f.type === "plan-anomaly");
      expect(finding).toBeDefined();
      expectValidFinding(finding!);
      expect(finding!.confidence).toBe("low");
      expect(finding!.planExcerpt).toContain("temp-file");
    });

    it("does NOT fire: a plain single-table scan/index-read plan (no temp-file markers)", () => {
      expect(
        analyzeAdviceData(ADVISE_DATA_UNINDEXED_BEFORE_TUNE).findings.some((f) => f.type === "plan-anomaly"),
      ).toBe(false);
      expect(
        analyzeAdviceData(ADVISE_DATA_INDEXED_BEFORE_TUNE).findings.some((f) => f.type === "plan-anomaly"),
      ).toBe(false);
    });
  });

  // ── unused-index ──────────────────────────────────────────────────

  describe("unused-index", () => {
    it("fires: IdxIndexedCol is never referenced when the WHERE targets UnindexedCol", () => {
      const result = analyzeAdviceData(ADVISE_DATA_UNINDEXED_BEFORE_TUNE);
      const finding = result.findings.find((f) => f.type === "unused-index");
      expect(finding).toBeDefined();
      expectValidFinding(finding!);
      expect(finding!.confidence).toBe("low");
      expect(finding!.evidence).toContain("IdxIndexedCol");
    });

    it("does NOT fire: WHERE on IndexedCol references BOTH IDKEY and IdxIndexedCol", () => {
      const result = analyzeAdviceData(ADVISE_DATA_INDEXED_BEFORE_TUNE);
      expect(result.findings.some((f) => f.type === "unused-index")).toBe(false);
    });

    it("fires: the GROUP BY/temp-file plan never references IdxIndexedCol either", () => {
      const result = analyzeAdviceData(ADVISE_DATA_GROUPBY_TEMPFILE_BEFORE_TUNE);
      expect(result.findings.some((f) => f.type === "unused-index")).toBe(true);
    });

    it("does NOT fire for the primary/master (key-type IDKEY) map — never a droppable index", () => {
      // The IDKEY row (type "key") whose plan display name varies
      // (`...IDKEY` / `...Master` / `...Map1`) must never be reported as an
      // unused index: the master map is the row storage, dropping it is
      // nonsensical, and the name variance would otherwise produce a harmful
      // "drop your primary key" false positive.
      const result = analyzeAdviceData(ADVISE_DATA_UNINDEXED_BEFORE_TUNE);
      const unused = result.findings.filter((f) => f.type === "unused-index");
      // Each unused-index evidence begins `Index <name> on ...`; assert none is
      // ABOUT IDKEY (the referenced-index list further in the string legitimately
      // mentions IDKEY, so match only the finding's subject).
      expect(unused.some((f) => f.evidence.startsWith("Index IDKEY "))).toBe(false);
      expect(unused.every((f) => f.evidence.startsWith("Index IdxIndexedCol "))).toBe(true);
    });

    it("does NOT fire on a system schema (%Dictionary) — never recommend dropping a system-table index", () => {
      // %Dictionary.CompiledClass reads its master map as `...Master` (a live
      // variance). Without the system-schema + key-type exclusions, IDKEY
      // would be mis-correlated and flagged unused. The exclusion suppresses it.
      const result = analyzeAdviceData(ADVISE_DATA_SYSTEM_SCHEMA_QUERY);
      expect(result.findings.some((f) => f.type === "unused-index")).toBe(false);
    });
  });

  // ── aggregate finding-set sanity per fixture ─────────────────────

  describe("aggregate finding set per fixture", () => {
    it("unindexed-before-tune: full-scan + missing-index + stale-stats + unused-index, no plan-anomaly", () => {
      const result = analyzeAdviceData(ADVISE_DATA_UNINDEXED_BEFORE_TUNE);
      expect(findingTypes(result.findings)).toEqual(
        ["full-scan", "missing-index", "stale-stats", "unused-index"].sort(),
      );
    });

    it("indexed-before-tune: ONLY stale-stats", () => {
      const result = analyzeAdviceData(ADVISE_DATA_INDEXED_BEFORE_TUNE);
      expect(findingTypes(result.findings)).toEqual(["stale-stats"]);
    });

    it("groupby-temp-file-before-tune: plan-anomaly + stale-stats + unused-index, no full-scan/missing-index", () => {
      const result = analyzeAdviceData(ADVISE_DATA_GROUPBY_TEMPFILE_BEFORE_TUNE);
      expect(findingTypes(result.findings)).toEqual(["plan-anomaly", "stale-stats", "unused-index"].sort());
    });

    it("unindexed-after-tune: full-scan + missing-index + unused-index, no stale-stats", () => {
      const result = analyzeAdviceData(ADVISE_DATA_UNINDEXED_AFTER_TUNE);
      expect(findingTypes(result.findings)).toEqual(["full-scan", "missing-index", "unused-index"].sort());
    });

    it("range-predicate-after-tune: full-scan + missing-index + unused-index, no stale-stats/plan-anomaly", () => {
      const result = analyzeAdviceData(ADVISE_DATA_RANGE_PREDICATE_AFTER_TUNE);
      expect(findingTypes(result.findings)).toEqual(["full-scan", "missing-index", "unused-index"].sort());
    });

    it("system-schema (%Dictionary): full-scan + stale-stats ONLY — no missing-index, no unused-index", () => {
      // Locks the whole finding set for the system-schema fixture (previously
      // only full-scan/missing-index were asserted). Proves BOTH exclusions do
      // real work: missing-index suppressed (system schema) AND unused-index
      // suppressed (system schema + key-type IDKEY, whose plan name is `Master`).
      const result = analyzeAdviceData(ADVISE_DATA_SYSTEM_SCHEMA_QUERY);
      expect(findingTypes(result.findings)).toEqual(["full-scan", "stale-stats"].sort());
    });

    it("like-predicate-after-tune: full-scan + unused-index ONLY — no missing-index (no equality/range op)", () => {
      const result = analyzeAdviceData(ADVISE_DATA_LIKE_PREDICATE_AFTER_TUNE);
      expect(findingTypes(result.findings)).toEqual(["full-scan", "unused-index"].sort());
    });

    it("every finding produced across all fixtures carries a full citation", () => {
      for (const data of [
        ADVISE_DATA_UNINDEXED_BEFORE_TUNE,
        ADVISE_DATA_INDEXED_BEFORE_TUNE,
        ADVISE_DATA_GROUPBY_TEMPFILE_BEFORE_TUNE,
        ADVISE_DATA_UNINDEXED_AFTER_TUNE,
        ADVISE_DATA_SYSTEM_SCHEMA_QUERY,
        ADVISE_DATA_RANGE_PREDICATE_AFTER_TUNE,
        ADVISE_DATA_LIKE_PREDICATE_AFTER_TUNE,
      ]) {
        const result = analyzeAdviceData(data);
        for (const finding of result.findings) {
          expectValidFinding(finding);
        }
      }
    });

    it("suggestedDdl is present if-and-only-if the finding type is missing-index", () => {
      for (const data of [
        ADVISE_DATA_UNINDEXED_BEFORE_TUNE,
        ADVISE_DATA_INDEXED_BEFORE_TUNE,
        ADVISE_DATA_GROUPBY_TEMPFILE_BEFORE_TUNE,
        ADVISE_DATA_UNINDEXED_AFTER_TUNE,
        ADVISE_DATA_SYSTEM_SCHEMA_QUERY,
        ADVISE_DATA_RANGE_PREDICATE_AFTER_TUNE,
        ADVISE_DATA_LIKE_PREDICATE_AFTER_TUNE,
      ]) {
        const result = analyzeAdviceData(data);
        for (const finding of result.findings) {
          if (finding.type === "missing-index") {
            expect(finding.suggestedDdl).toBeTruthy();
          } else {
            expect(finding.suggestedDdl).toBeUndefined();
          }
        }
      }
    });
  });

  // ── graceful unknown-plan handling (AC 28.2.3) ───────────────────

  describe("graceful degradation on unrecognized/garbage input", () => {
    it("garbage string plan -> findings:[] + 'plan format not recognized'", () => {
      const result = analyzeAdviceData({ plan: "asdkfjalskdjf 12345 !!! not a plan", tables: [], indexes: [] });
      expect(result.findings).toEqual([]);
      expect(result.notes).toEqual(["plan format not recognized"]);
    });

    it("empty plan string -> findings:[] + note", () => {
      const result = analyzeAdviceData({ plan: "", tables: [], indexes: [] });
      expect(result.findings).toEqual([]);
      expect(result.notes).toEqual(["plan format not recognized"]);
    });

    it("plausible-but-alien plan shape (none of the known markers) -> findings:[] + note", () => {
      const alienPlan = [
        "<plan-v3>",
        "  Access-Path: vectorized-bulk-scan(TableX)",
        "  Estimated-Rows: 42",
        "  Strategy: columnar-projection",
        "</plan-v3>",
      ].join("\n");
      const result = analyzeAdviceData({ plan: alienPlan, tables: [], indexes: [] });
      expect(result.findings).toEqual([]);
      expect(result.notes).toEqual(["plan format not recognized"]);
    });

    it("null raw -> findings:[] + note, never throws", () => {
      expect(() => analyzeAdviceData(null)).not.toThrow();
      const result = analyzeAdviceData(null);
      expect(result.findings).toEqual([]);
      expect(result.notes).toEqual(["plan format not recognized"]);
    });

    it("undefined raw -> findings:[] + note, never throws", () => {
      expect(() => analyzeAdviceData(undefined)).not.toThrow();
      const result = analyzeAdviceData(undefined);
      expect(result.findings).toEqual([]);
      expect(result.notes).toEqual(["plan format not recognized"]);
    });

    it("live-captured endpoint error-result shape ({} — a genuinely unparseable query) -> findings:[] + note", () => {
      const result = analyzeAdviceData(ADVISE_DATA_ENDPOINT_ERROR_RESULT);
      expect(result.findings).toEqual([]);
      expect(result.notes).toEqual(["plan format not recognized"]);
    });

    it("malformed non-object inputs never throw (fuzz)", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fuzzInputs: any[] = [42, "just a string", [], true, { plan: 12345 }, { plan: null }, { indexes: "nope" }];
      for (const input of fuzzInputs) {
        expect(() => analyzeAdviceData(input)).not.toThrow();
        const result = analyzeAdviceData(input);
        expect(Array.isArray(result.findings)).toBe(true);
      }
    });

    it("an index group missing its `rows` array never throws (guards the group, not just the outer indexes array)", () => {
      // The outer `indexes` is a valid array, but a group object lacks `rows`
      // entirely -- both the missing-index `.map` and the unused-index
      // `for...of` would throw without a per-group guard. Must degrade to no
      // false missing-index (index list unknown) and never crash (AC 28.2.3).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input: any = {
        plan: ADVISE_DATA_UNINDEXED_BEFORE_TUNE.plan,
        tables: ADVISE_DATA_UNINDEXED_BEFORE_TUNE.tables,
        indexes: [{ className: "X", schema: "ExecuteMCPv2_Tests", table: "AdvisorFixture" }],
      };
      expect(() => analyzeAdviceData(input)).not.toThrow();
      const result = analyzeAdviceData(input);
      expect(result.findings.some((f) => f.type === "full-scan")).toBe(true);
      expect(result.findings.some((f) => f.type === "missing-index")).toBe(false);
    });

    it("a null group entry and a null row entry never throw", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nullGroup: any = { plan: ADVISE_DATA_UNINDEXED_BEFORE_TUNE.plan, indexes: [null] };
      expect(() => analyzeAdviceData(nullGroup)).not.toThrow();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nullRow: any = {
        plan: ADVISE_DATA_UNINDEXED_BEFORE_TUNE.plan,
        indexes: [{ schema: "ExecuteMCPv2_Tests", table: "AdvisorFixture", rows: [null] }],
      };
      expect(() => analyzeAdviceData(nullRow)).not.toThrow();
    });

    it("a real, reference-captured plan paired with a malformed `indexes` field never throws and degrades to no false missing-index", () => {
      // Real plan text (unchanged, reference-captured) but `indexes` is not
      // an array at all -- the Array.isArray guard must treat this exactly
      // like the CR 28.1-2 empty-indexes case, never crash on `.find`/`.map`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const input: any = { plan: ADVISE_DATA_UNINDEXED_BEFORE_TUNE.plan, tables: undefined, indexes: "not-an-array" };
      expect(() => analyzeAdviceData(input)).not.toThrow();
      const result = analyzeAdviceData(input);
      expect(result.findings.some((f) => f.type === "full-scan")).toBe(true);
      expect(result.findings.some((f) => f.type === "missing-index")).toBe(false);
    });
  });

  // ── statement / ctx plumbing ──────────────────────────────────────

  describe("AdvisorContext.query plumbing", () => {
    it("defaults `statement` to empty string when ctx is omitted", () => {
      const result = analyzeAdviceData(ADVISE_DATA_UNINDEXED_BEFORE_TUNE);
      expect(result.findings.length).toBeGreaterThan(0);
      for (const finding of result.findings) {
        expect(finding.statement).toBe("");
      }
    });

    it("propagates ctx.query into every finding's `statement`", () => {
      const sql = "SELECT ID, UnindexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture WHERE UnindexedCol = 'U7'";
      const result = analyzeAdviceData(ADVISE_DATA_UNINDEXED_BEFORE_TUNE, { query: sql });
      expect(result.findings.length).toBeGreaterThan(0);
      for (const finding of result.findings) {
        expect(finding.statement).toBe(sql);
      }
    });
  });
});
