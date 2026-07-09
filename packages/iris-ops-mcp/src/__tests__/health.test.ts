import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { healthCheckTool, evaluate } from "../tools/health.js";
import type { RawAreas } from "../tools/health.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── Fixtures ────────────────────────────────────────────────────
//
// Round-number synthetic fixtures (not the live HSCUSTOM byte-exact values --
// those are cross-checked separately in the live smoke, Rule #26/#34) chosen
// so every expected finding value is trivially hand-verifiable (CR 23.1-2:
// assert deterministic VALUES, not just presence).

/**
 * All 9 areas: a mix of ok + notApplicable, verdict "healthy" (AC 23.2.2 #1/#4).
 * Deliberately NOT annotated `: RawAreas` -- under `exactOptionalPropertyTypes`,
 * annotating would widen every field's access type to `T | undefined` (matching
 * the interface's optional properties), which then fails to assign back into a
 * `RawAreas`-typed slot elsewhere. Leaving this as an inferred literal keeps
 * every field concretely typed; it is still structurally assignable to
 * `RawAreas` wherever it is passed.
 */
const FULL_HEALTHY_RAW = {
  system: {
    globalReferences: 1_640_566_217,
    routineCommands: 5_083_780_047,
    uptimeSeconds: 120_000,
    processCount: 42,
  },
  // maxSize=0 (IRIS's own "unlimited" recommendation) -> notApplicable (CR 23.0-1).
  databases: [
    { name: "USER", directory: "/iris/mgr/user/", size: 100, maxSize: 0, mounted: true, openFailed: false },
  ],
  // total=1,000,000 free=704,000 -> 29.6% full -> ok (< warn 80).
  journal: { volumeFreeBytes: 704_000, volumeTotalBytes: 1_000_000, state: "Open" },
  mirror: { isMember: false },
  // 224/(999776+224)=0.0224% -> ok (< warn 50).
  locks: { available: 999_900, usable: 999_776, used: 224 },
  license: { currentCSPUsers: 0, userLimit: 8, licenseCurrent: 0, licenseCurrentPct: 0 },
  ecp: { configured: false },
  alerts: { state: 0, alertCount: 4, messages: [], lastAlert: "" },
  interop: {
    interopEnabled: true,
    productionName: "My.Production",
    productionStateCode: 2,
    queues: [],
    queueCount: 0,
  },
};

const NO_ERRORS: Record<string, string> = {};

// ── evaluate() -- spec §5 acceptance criteria 1-6 ────────────────

describe("evaluate() -- spec AC 1-6", () => {
  it("AC1: no-arg (all 9 areas) call yields a verdict + >= 8 findings", () => {
    const result = evaluate(FULL_HEALTHY_RAW, NO_ERRORS, {});
    expect(result.findings.length).toBeGreaterThanOrEqual(8);
    expect(result.findings).toHaveLength(9);
    expect(result.verdict).toBe("healthy");
  });

  it("AC1: findings are in canonical area order regardless of raw key order", () => {
    // Build the raw object with keys in a DIFFERENT order than AREA_VALUES.
    const shuffled: RawAreas = {
      interop: FULL_HEALTHY_RAW.interop,
      alerts: FULL_HEALTHY_RAW.alerts,
      system: FULL_HEALTHY_RAW.system,
    };
    const result = evaluate(shuffled, NO_ERRORS, {});
    expect(result.findings.map((f) => f.area)).toEqual(["system", "alerts", "interop"]);
  });

  it("AC2: areas subset (journal, license) checks exactly those two", () => {
    const subset: RawAreas = {
      journal: FULL_HEALTHY_RAW.journal,
      license: FULL_HEALTHY_RAW.license,
    };
    const result = evaluate(subset, NO_ERRORS, {});
    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.area)).toEqual(["journal", "license"]);
  });

  it("AC3: journalPctCrit:1 flips the journal finding AND the overall verdict to critical", () => {
    const result = evaluate(FULL_HEALTHY_RAW, NO_ERRORS, { journalPctCrit: 1 });
    const journal = result.findings.find((f) => f.area === "journal");
    expect(journal).toMatchObject({ level: "critical", value: 29.6, threshold: 1 });
    expect(result.verdict).toBe("critical");
  });

  it("AC4: no mirror + no interop -> notApplicable, verdict unaffected", () => {
    const raw: RawAreas = {
      ...FULL_HEALTHY_RAW,
      mirror: { isMember: false },
      interop: { interopEnabled: false },
    };
    const result = evaluate(raw, NO_ERRORS, {});
    const mirror = result.findings.find((f) => f.area === "mirror");
    const interop = result.findings.find((f) => f.area === "interop");
    expect(mirror).toMatchObject({ level: "notApplicable", value: null, threshold: null });
    expect(interop).toMatchObject({ level: "notApplicable", value: null, threshold: null });
    expect(result.verdict).toBe("healthy");
  });

  it("AC5: a forced probe failure (errors.locks) yields level:error for locks only, other areas intact, verdict <= warning", () => {
    const rawWithoutLocks: RawAreas = { ...FULL_HEALTHY_RAW };
    delete rawWithoutLocks.locks;
    const errors = { locks: "SYS.Lock: lock table probe failed" };

    const result = evaluate(rawWithoutLocks, errors, {});

    const locks = result.findings.find((f) => f.area === "locks");
    expect(locks).toEqual({
      area: "locks",
      level: "error",
      metric: "lockTablePct",
      value: null,
      threshold: null,
      explanation: "SYS.Lock: lock table probe failed",
    });

    // Every other checked area is untouched (still 8 other findings, all ok/notApplicable).
    const others = result.findings.filter((f) => f.area !== "locks");
    expect(others).toHaveLength(8);
    for (const f of others) {
      expect(["ok", "notApplicable"]).toContain(f.level);
    }

    // error counts as warning severity -- never fakes a critical verdict.
    expect(result.verdict).toBe("warning");
  });

  it("AC5: error does not suppress a genuinely critical area elsewhere", () => {
    const raw: RawAreas = { ...FULL_HEALTHY_RAW };
    delete raw.locks;
    const errors = { locks: "probe failed" };
    // Force journal critical via an extreme override alongside the locks error.
    const result = evaluate(raw, errors, { journalPctCrit: 1 });
    expect(result.findings.find((f) => f.area === "locks")?.level).toBe("error");
    expect(result.findings.find((f) => f.area === "journal")?.level).toBe("critical");
    expect(result.verdict).toBe("critical");
  });

  it("AC5 (per-DB error path): a databases openFailed error mixed into an otherwise-healthy instance caps the verdict at warning, not critical", () => {
    // Distinct from the two AC5 tests above: those exercise the endpoint-level
    // `errors[area]` map. This exercises the OTHER error path -- a per-DB
    // `openFailed` flag aggregated by evaluateDatabases()'s own worst-DB
    // reducer into a `databases` finding of level:"error" -- proving that
    // path also honors "error counts as warning" (SEVERITY_RANK) and never
    // escalates the overall verdict to "critical" by itself.
    const raw: RawAreas = {
      ...FULL_HEALTHY_RAW,
      databases: [{ name: "BROKEN", size: 0, maxSize: 1000, mounted: true, openFailed: true }],
    };
    const result = evaluate(raw, NO_ERRORS, {});
    const databases = result.findings.find((f) => f.area === "databases");
    expect(databases).toMatchObject({ level: "error", value: null, threshold: null });
    expect(result.verdict).toBe("warning");
  });

  it("AC6: raw values are always present alongside interpreted findings", () => {
    const result = evaluate(FULL_HEALTHY_RAW, NO_ERRORS, {});
    expect(result.raw).toEqual(FULL_HEALTHY_RAW);
    expect(result.raw.journal).toEqual(FULL_HEALTHY_RAW.journal);
  });

  it("an errored area has no entry in raw (it never had raw values)", () => {
    const rawWithoutLocks: RawAreas = { ...FULL_HEALTHY_RAW };
    delete rawWithoutLocks.locks;
    const result = evaluate(rawWithoutLocks, { locks: "boom" }, {});
    expect(result.raw.locks).toBeUndefined();
  });

  it("a totally empty payload yields zero findings and a healthy verdict (no evidence of a problem)", () => {
    const result = evaluate({}, {}, {});
    expect(result.findings).toHaveLength(0);
    expect(result.verdict).toBe("healthy");
  });

  it("malformed/missing raw for a checked-but-undefined-valued area degrades to a generic error finding, not a crash", () => {
    const raw = { journal: undefined } as unknown as RawAreas;
    const result = evaluate(raw, {}, {});
    expect(result.findings).toEqual([
      {
        area: "journal",
        level: "error",
        metric: "journalSpacePct",
        value: null,
        threshold: null,
        explanation: "No data returned for this area.",
      },
    ]);
    expect(result.verdict).toBe("warning");
  });
});

// ── evaluate() -- per-area deterministic fixtures ────────────────

describe("evaluate() -- system", () => {
  it("is always 'ok' (no threshold in v1) and reports processCount", () => {
    const result = evaluate({ system: FULL_HEALTHY_RAW.system }, {}, {});
    expect(result.findings[0]).toMatchObject({
      area: "system",
      level: "ok",
      metric: "processCount",
      value: 42,
      threshold: null,
    });
  });
});

describe("evaluate() -- databases", () => {
  it("maxSize=0 -> notApplicable", () => {
    const result = evaluate(
      { databases: [{ name: "USER", size: 100, maxSize: 0, mounted: true, openFailed: false }] },
      {},
      {},
    );
    expect(result.findings[0]).toMatchObject({ level: "notApplicable", value: null, threshold: null });
  });

  it("unmounted (mounted=false, maxSize>0) -> notApplicable", () => {
    const result = evaluate(
      { databases: [{ name: "X", size: 100, maxSize: 1000, mounted: false, openFailed: false }] },
      {},
      {},
    );
    expect(result.findings[0]!.level).toBe("notApplicable");
  });

  it("openFailed=true -> error, independent of maxSize/mounted", () => {
    const result = evaluate(
      { databases: [{ name: "BROKEN", size: 0, maxSize: 1000, mounted: true, openFailed: true }] },
      {},
      {},
    );
    expect(result.findings[0]).toMatchObject({ level: "error", value: null, threshold: null });
    expect(result.findings[0]!.explanation).toContain("BROKEN");
  });

  it("freePct exactly at dbFreePctCrit (3%) -> critical (descending, at-or-below triggers)", () => {
    const result = evaluate(
      { databases: [{ name: "DB1", size: 970, maxSize: 1000, mounted: true, openFailed: false }] },
      {},
      {},
    );
    expect(result.findings[0]).toMatchObject({ level: "critical", value: 3, threshold: 3 });
  });

  it("freePct between crit and warn -> warning", () => {
    const result = evaluate(
      { databases: [{ name: "DB1", size: 940, maxSize: 1000, mounted: true, openFailed: false }] },
      {},
      {},
    );
    expect(result.findings[0]).toMatchObject({ level: "warning", value: 6, threshold: 10 });
  });

  it("freePct above warn -> ok", () => {
    const result = evaluate(
      { databases: [{ name: "DB1", size: 800, maxSize: 1000, mounted: true, openFailed: false }] },
      {},
      {},
    );
    expect(result.findings[0]).toMatchObject({ level: "ok", value: 20, threshold: 10 });
  });

  it("worst-DB drives the area level (CR 23.0-4); per-DB detail stays in raw only", () => {
    const raw: RawAreas = {
      databases: [
        { name: "OK_DB", size: 800, maxSize: 1000, mounted: true, openFailed: false }, // ok, 20% free
        { name: "CRIT_DB", size: 970, maxSize: 1000, mounted: true, openFailed: false }, // critical, 3% free
        { name: "NA_DB", size: 100, maxSize: 0, mounted: true, openFailed: false }, // notApplicable
      ],
    };
    const result = evaluate(raw, {}, {});
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      area: "databases",
      level: "critical",
      value: 3,
      threshold: 3,
    });
    expect(result.findings[0]!.explanation).toContain("CRIT_DB");
    // The full per-DB breakdown is preserved in raw, not collapsed.
    expect((result.raw.databases as unknown[]).length).toBe(3);
  });

  it("worst-DB tie-break surfaces an openFailed (error) DB over an equal-rank warning DB regardless of array order (CR 23.0-4 hardening)", () => {
    // error and warning are EQUAL severity rank (both 1). Without a deterministic
    // tie-break, a strict first-wins reducer would surface whichever DB the
    // endpoint happened to list first -- here masking the un-openable DB behind
    // the warning DB. The tie-break must always surface the `error`.
    const raw: RawAreas = {
      databases: [
        { name: "WARN_DB", size: 940, maxSize: 1000, mounted: true, openFailed: false }, // warning, 6% free
        { name: "BROKEN_DB", size: 0, maxSize: 1000, mounted: true, openFailed: true }, // error (openFailed)
      ],
    };
    const result = evaluate(raw, {}, {});
    expect(result.findings[0]).toMatchObject({ area: "databases", level: "error" });
    expect(result.findings[0]!.explanation).toContain("BROKEN_DB");
    // error counts as warning severity -- the verdict is warning, never critical.
    expect(result.verdict).toBe("warning");
  });

  it("worst-DB tie-break names the numerically-worst DB among two same-level criticals", () => {
    const raw: RawAreas = {
      databases: [
        { name: "CRIT_3PCT", size: 970, maxSize: 1000, mounted: true, openFailed: false }, // 3% free
        { name: "CRIT_HALF_PCT", size: 995, maxSize: 1000, mounted: true, openFailed: false }, // 0.5% free
      ],
    };
    const result = evaluate(raw, {}, {});
    expect(result.findings[0]).toMatchObject({ area: "databases", level: "critical", value: 0.5 });
    expect(result.findings[0]!.explanation).toContain("CRIT_HALF_PCT");
  });

  it("empty databases array -> notApplicable", () => {
    const result = evaluate({ databases: [] }, {}, {});
    expect(result.findings[0]!.level).toBe("notApplicable");
  });

  it("all databases notApplicable -> area notApplicable", () => {
    const raw: RawAreas = {
      databases: [
        { name: "A", size: 1, maxSize: 0, mounted: true, openFailed: false },
        { name: "B", size: 1, maxSize: 1000, mounted: false, openFailed: false },
      ],
    };
    const result = evaluate(raw, {}, {});
    expect(result.findings[0]!.level).toBe("notApplicable");
  });
});

describe("evaluate() -- journal", () => {
  it("volumeTotalBytes=0 -> notApplicable", () => {
    const result = evaluate({ journal: { volumeFreeBytes: 0, volumeTotalBytes: 0 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "notApplicable", value: null, threshold: null });
  });

  it("29.6% full -> ok (below default warn 80)", () => {
    const result = evaluate({ journal: { volumeFreeBytes: 704_000, volumeTotalBytes: 1_000_000 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "ok", value: 29.6, threshold: 80 });
  });

  it("85% full -> warning (>= warn 80, < crit 92)", () => {
    const result = evaluate({ journal: { volumeFreeBytes: 150_000, volumeTotalBytes: 1_000_000 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "warning", value: 85, threshold: 80 });
  });

  it("95% full -> critical (>= crit 92)", () => {
    const result = evaluate({ journal: { volumeFreeBytes: 50_000, volumeTotalBytes: 1_000_000 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "critical", value: 95, threshold: 92 });
  });
});

describe("evaluate() -- mirror", () => {
  it("isMember=false -> notApplicable", () => {
    const result = evaluate({ mirror: { isMember: false } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "notApplicable", value: null, threshold: null });
  });

  it("isMember=true -> ok, value carries the status string", () => {
    const result = evaluate(
      { mirror: { isMember: true, memberType: "Failover", isPrimary: true, isBackup: false, status: "Primary, Normal" } },
      {},
      {},
    );
    expect(result.findings[0]).toMatchObject({ level: "ok", value: "Primary, Normal", threshold: null });
  });
});

describe("evaluate() -- locks", () => {
  it("usable+used=0 -> notApplicable", () => {
    const result = evaluate({ locks: { available: 0, usable: 0, used: 0 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "notApplicable", value: null, threshold: null });
  });

  it("55% utilized -> warning (>= warn 50, < crit 85)", () => {
    const result = evaluate({ locks: { available: 1000, usable: 450, used: 550 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "warning", value: 55, threshold: 50 });
  });

  it("90% utilized -> critical (>= crit 85)", () => {
    const result = evaluate({ locks: { available: 1000, usable: 100, used: 900 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "critical", value: 90, threshold: 85 });
  });
});

describe("evaluate() -- license", () => {
  it("prefers licenseCurrentPct when present (CR 23.0-2)", () => {
    const result = evaluate(
      { license: { currentCSPUsers: 999, userLimit: 1000, licenseCurrentPct: 12.5 } },
      {},
      {},
    );
    // currentCSPUsers/userLimit would be 99.9%, but the authoritative figure (12.5%) wins.
    expect(result.findings[0]).toMatchObject({ level: "ok", value: 12.5, threshold: 80 });
  });

  it("falls back to currentCSPUsers/userLimit when licenseCurrentPct is absent", () => {
    const result = evaluate({ license: { currentCSPUsers: 85, userLimit: 100 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "warning", value: 85, threshold: 80 });
  });

  it("userLimit=0 and no licenseCurrentPct -> notApplicable (zero-denominator guard)", () => {
    const result = evaluate({ license: { currentCSPUsers: 0, userLimit: 0 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "notApplicable", value: null, threshold: null });
  });

  it("licenseCurrentPct >= crit -> critical", () => {
    const result = evaluate({ license: { currentCSPUsers: 0, userLimit: 8, licenseCurrentPct: 97 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "critical", value: 97, threshold: 95 });
  });
});

describe("evaluate() -- ecp", () => {
  it("configured=false -> notApplicable", () => {
    const result = evaluate({ ecp: { configured: false } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "notApplicable", value: null, threshold: null });
  });

  it("configured=true -> ok", () => {
    const result = evaluate({ ecp: { configured: true } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "ok", value: 1, threshold: null });
  });
});

describe("evaluate() -- alerts", () => {
  it("state=0 -> ok", () => {
    const result = evaluate({ alerts: { state: 0, alertCount: 0 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "ok", value: 0, threshold: null });
  });

  it("state=1 (Warning) -> warning", () => {
    const result = evaluate({ alerts: { state: 1, alertCount: 1 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "warning", value: 1 });
  });

  it("state=2 (Alert) -> warning", () => {
    const result = evaluate({ alerts: { state: 2, alertCount: 3 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "warning", value: 2 });
  });

  it("state=-1 (Hung) -> critical", () => {
    const result = evaluate({ alerts: { state: -1, alertCount: 1 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "critical", value: -1 });
  });

  it("an unrecognized state defaults to warning (defensive, never silently ok)", () => {
    const result = evaluate({ alerts: { state: 99, alertCount: 0 } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "warning", value: 99 });
  });
});

describe("evaluate() -- interop", () => {
  it("interopEnabled=false -> notApplicable (no Ens classes in this namespace)", () => {
    const result = evaluate({ interop: { interopEnabled: false } }, {}, {});
    expect(result.findings[0]).toMatchObject({ level: "notApplicable", value: null, threshold: null });
  });

  it("interopEnabled=true with queueCount=0 -> ok (applicable, zero queues != notApplicable)", () => {
    const result = evaluate(
      { interop: { interopEnabled: true, productionName: "P", productionStateCode: 2, queueCount: 0 } },
      {},
      {},
    );
    expect(result.findings[0]).toMatchObject({ level: "ok", value: 0, threshold: null });
  });

  it("interopEnabled=true derives queueCount from queues.length when queueCount is absent", () => {
    const result = evaluate(
      { interop: { interopEnabled: true, queues: [{ name: "Q1", count: 2 }, { name: "Q2", count: 0 }] } },
      {},
      {},
    );
    expect(result.findings[0]).toMatchObject({ level: "ok", value: 2 });
  });
});

// ── evaluate() -- defensive non-finite hardening ─────────────────
//
// The co-designed Story 23.1 endpoint always emits every numeric field as a
// real JSON number (explicit "number" type hint + `+` coercion, 0-defaulted) --
// so these malformed inputs are NOT reachable through the live tool->endpoint
// path. They lock the EXPORTED pure evaluate()/mergeThresholds contract: a
// non-finite computed percentage or threshold must degrade to notApplicable /
// be ignored, NEVER silently mis-level a finding as "ok" or downgrade a real
// critical. Each assertion FAILS without its guard.

describe("evaluate() -- non-finite hardening (defensive)", () => {
  it("journal with a non-numeric free-space value -> notApplicable, never a NaN 'ok'", () => {
    const raw = { journal: { volumeFreeBytes: "oops", volumeTotalBytes: 1_000_000 } } as unknown as RawAreas;
    const result = evaluate(raw, {}, {});
    expect(result.findings[0]).toMatchObject({
      area: "journal",
      level: "notApplicable",
      value: null,
      threshold: null,
    });
  });

  it("database with a non-numeric size -> notApplicable, never a false 'ok' hiding a full DB", () => {
    const raw = {
      databases: [{ name: "X", size: "bad", maxSize: 1000, mounted: true, openFailed: false }],
    } as unknown as RawAreas;
    const result = evaluate(raw, {}, {});
    expect(result.findings[0]!.level).toBe("notApplicable");
  });

  it("license with a NaN authoritative pct -> notApplicable (not a false 'ok')", () => {
    // typeof NaN === "number", so a NaN licenseCurrentPct passes the source
    // selection; only the isFinite guard degrades it to notApplicable.
    const raw = { license: { currentCSPUsers: 0, userLimit: 8, licenseCurrentPct: NaN } } as unknown as RawAreas;
    const result = evaluate(raw, {}, {});
    expect(result.findings[0]!.level).toBe("notApplicable");
  });

  it("a non-finite threshold override is ignored (keeps the default), not applied", () => {
    // 95% full journal + a NaN crit override. If NaN were applied, `95 >= NaN`
    // is false and the area would silently downgrade to warning; the guard keeps
    // the default crit (92), so it stays critical.
    const criticalJournal = { journal: { volumeFreeBytes: 50_000, volumeTotalBytes: 1_000_000 } };
    const result = evaluate(criticalJournal as RawAreas, {}, { journalPctCrit: NaN });
    expect(result.findings[0]).toMatchObject({ level: "critical", value: 95, threshold: 92 });
  });
});

// ── Zod input validation (CR 23.0-6 / CR 23.1-1) ─────────────────

describe("iris_health_check inputSchema validation", () => {
  it("accepts an empty object (all params optional)", () => {
    expect(healthCheckTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a valid areas subset", () => {
    expect(
      healthCheckTool.inputSchema.safeParse({ areas: ["journal", "license"] }).success,
    ).toBe(true);
  });

  it("accepts areas: [] (empty array)", () => {
    expect(healthCheckTool.inputSchema.safeParse({ areas: [] }).success).toBe(true);
  });

  it("rejects 'memory' -- removed in Story 23.0, not a valid area", () => {
    const parsed = healthCheckTool.inputSchema.safeParse({ areas: ["memory"] });
    expect(parsed.success).toBe(false);
  });

  it("rejects a mix of a valid area and 'memory'", () => {
    expect(
      healthCheckTool.inputSchema.safeParse({ areas: ["journal", "memory"] }).success,
    ).toBe(false);
  });

  it("rejects an unknown area name that was never valid", () => {
    expect(healthCheckTool.inputSchema.safeParse({ areas: ["cpu"] }).success).toBe(false);
  });

  it("accepts extreme threshold overrides (AC 23.2.2 #3 needs journalPctCrit:1)", () => {
    expect(
      healthCheckTool.inputSchema.safeParse({ thresholds: { journalPctCrit: 1 } }).success,
    ).toBe(true);
    expect(
      healthCheckTool.inputSchema.safeParse({ thresholds: { journalPctWarn: -50, journalPctCrit: 500 } })
        .success,
    ).toBe(true);
  });

  it("rejects a non-number threshold value", () => {
    expect(
      healthCheckTool.inputSchema.safeParse({ thresholds: { journalPctCrit: "92" } }).success,
    ).toBe(false);
  });

  it("rejects NaN threshold values (Zod z.number() guards NaN by default)", () => {
    expect(
      healthCheckTool.inputSchema.safeParse({ thresholds: { journalPctCrit: NaN } }).success,
    ).toBe(false);
  });

  it("accepts a partial thresholds object -- only one field supplied", () => {
    expect(
      healthCheckTool.inputSchema.safeParse({ thresholds: { journalPctCrit: 92 } }).success,
    ).toBe(true);
  });
});

// ── Tool metadata ─────────────────────────────────────────────────

describe("iris_health_check tool metadata", () => {
  it("has scope NONE", () => {
    expect(healthCheckTool.scope).toBe("NONE");
  });

  it("has truthful read-only annotations", () => {
    expect(healthCheckTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("is classified mutates:'read' (scalar -- no action enum, Rule #28)", () => {
    expect(healthCheckTool.mutates).toBe("read");
  });

  it("does not declare a manual 'server' field (framework-injected, D2)", () => {
    expect(Object.prototype.hasOwnProperty.call(healthCheckTool.inputSchema.shape, "server")).toBe(
      false,
    );
  });
});

// ── Handler -- HTTP wiring ─────────────────────────────────────────

describe("iris_health_check handler -- HTTP wiring", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("calls GET /monitor/health with no query string when areas is omitted", async () => {
    mockHttp.get.mockResolvedValue(envelope({ areas: FULL_HEALTHY_RAW, errors: {} }));
    await healthCheckTool.handler({}, ctx);
    expect(mockHttp.get).toHaveBeenCalledWith("/api/executemcp/v2/monitor/health");
  });

  it("calls GET with no query string when areas is an empty array (CR 23.0-6)", async () => {
    mockHttp.get.mockResolvedValue(envelope({ areas: FULL_HEALTHY_RAW, errors: {} }));
    await healthCheckTool.handler({ areas: [] }, ctx);
    expect(mockHttp.get).toHaveBeenCalledWith("/api/executemcp/v2/monitor/health");
  });

  it("calls GET with a URL-encoded comma-separated areas query string for a subset", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ areas: { journal: FULL_HEALTHY_RAW.journal, license: FULL_HEALTHY_RAW.license }, errors: {} }),
    );
    await healthCheckTool.handler({ areas: ["journal", "license"] }, ctx);
    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/monitor/health?areas=journal%2Clicense",
    );
  });

  it("never sends 'thresholds' to the endpoint -- it is purely a local (TS-side) computation", async () => {
    mockHttp.get.mockResolvedValue(envelope({ areas: FULL_HEALTHY_RAW, errors: {} }));
    await healthCheckTool.handler({ thresholds: { journalPctCrit: 1 } }, ctx);
    expect(mockHttp.get).toHaveBeenCalledWith("/api/executemcp/v2/monitor/health");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("applies a thresholds override end-to-end through the handler (flips the verdict)", async () => {
    mockHttp.get.mockResolvedValue(envelope({ areas: FULL_HEALTHY_RAW, errors: {} }));
    const result = await healthCheckTool.handler({ thresholds: { journalPctCrit: 1 } }, ctx);
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { verdict: string };
    expect(sc.verdict).toBe("critical");
  });
});

// ── Handler -- structuredContent + text content shape ──────────────

describe("iris_health_check handler -- response shape", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("structuredContent carries verdict, checkedAt (ISO 8601), findings, and raw", async () => {
    mockHttp.get.mockResolvedValue(envelope({ areas: FULL_HEALTHY_RAW, errors: {} }));
    const result = await healthCheckTool.handler({}, ctx);
    const sc = result.structuredContent as {
      verdict: string;
      checkedAt: string;
      findings: unknown[];
      raw: RawAreas;
    };
    expect(sc.verdict).toBe("healthy");
    expect(() => new Date(sc.checkedAt).toISOString()).not.toThrow();
    expect(sc.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(sc.findings).toHaveLength(9);
    expect(sc.raw).toEqual(FULL_HEALTHY_RAW);
  });

  it("text content starts with the verdict and says 'All N areas healthy' when clean", async () => {
    mockHttp.get.mockResolvedValue(envelope({ areas: FULL_HEALTHY_RAW, errors: {} }));
    const result = await healthCheckTool.handler({}, ctx);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Verdict: HEALTHY");
    expect(text).toContain("All 9 areas healthy");
  });

  it("areas: [] behaves identically to omitting areas end-to-end -- 9 findings, 'All N areas healthy' text (CR 23.0-6)", async () => {
    // The existing HTTP-wiring test for areas:[] only asserts the outbound
    // URL. This asserts the RESPONSE shape too, closing the gap named by the
    // CR: an empty array must be treated as "all", never as "0 areas" (which
    // would otherwise show up here as findings.length === 0 or misleading
    // "All 0 areas healthy" text).
    mockHttp.get.mockResolvedValue(envelope({ areas: FULL_HEALTHY_RAW, errors: {} }));
    const result = await healthCheckTool.handler({ areas: [] }, ctx);
    const sc = result.structuredContent as { verdict: string; findings: unknown[] };
    expect(sc.verdict).toBe("healthy");
    expect(sc.findings).toHaveLength(9);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("All 9 areas healthy");
  });

  it("text content lists one line per non-ok finding when unhealthy", async () => {
    const rawWithoutLocks: RawAreas = { ...FULL_HEALTHY_RAW };
    delete rawWithoutLocks.locks;
    mockHttp.get.mockResolvedValue(
      envelope({ areas: rawWithoutLocks, errors: { locks: "probe failed" } }),
    );
    const result = await healthCheckTool.handler({}, ctx);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Verdict: WARNING");
    expect(text).toContain("[ERROR] locks: probe failed");
    expect(text).not.toContain("All 9 areas healthy");
  });
});

// ── Handler -- error handling ────────────────────────────────────

describe("iris_health_check handler -- error handling", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("returns isError:true on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(new IrisApiError(500, [], "/monitor/health", "boom"));
    const result = await healthCheckTool.handler({}, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error checking IRIS health");
  });

  it("rethrows a non-IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(new Error("network down"));
    await expect(healthCheckTool.handler({}, ctx)).rejects.toThrow("network down");
  });
});
