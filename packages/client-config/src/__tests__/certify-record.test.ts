/**
 * Story 33.5 / AC 33.5.6a-b + 33-5-18 — the certification record-merge and
 * pass-created path logic (scripts/certify-record.mjs), unit-tested
 * directly (staging a full real-config pass in a test is infeasible; the
 * extracted lib makes the behavior genuinely testable).
 */

import { describe, it, expect } from "vitest";

import { mergeCertificationRecord, passCreatedPaths } from "../../scripts/certify-record.mjs";

describe("mergeCertificationRecord (AC 33.5.6a/b)", () => {
  const passingRecord = { disposition: "certified-live", date: "2026-07-28", evidence: ["PASS add"] };
  const failedRecord = { disposition: "certification-failed-see-story", date: "2026-07-29", evidence: ["FAIL add"] };

  it("a failed pass NEVER overwrites a certified-live record (keep-passing guard)", () => {
    const decision = mergeCertificationRecord(passingRecord, failedRecord, false);
    expect(decision.action).toBe("keep");
  });

  it("a failed pass DOES write over a non-passing (or absent) record", () => {
    expect(mergeCertificationRecord(undefined, failedRecord, false).action).toBe("write");
    const existing = { disposition: "certification-failed-see-story", date: "2026-07-28" };
    expect(mergeCertificationRecord(existing, failedRecord, false).action).toBe("write");
    const fixtureOnly = { disposition: "fixture-only-with-residual-risk", date: "2026-07-28", note: "n" };
    expect(mergeCertificationRecord(fixtureOnly, failedRecord, false).action).toBe("write");
  });

  it("a passing re-run replaces a certified-live record", () => {
    const decision = mergeCertificationRecord(passingRecord, { ...passingRecord, date: "2026-07-29" }, true);
    expect(decision.action).toBe("write");
  });

  it("a re-run MERGES over the existing record — hand-authored evidence keys survive", () => {
    const existing = {
      disposition: "certified-live",
      date: "2026-07-28",
      evidence: ["old"],
      sharing: { claim: "hand-authored", verdict: "verified-live" },
      ac3344: { cliTuiHalf: { verdict: "verified-live" } },
      residualRisk: "hand-authored risk note",
    };
    const decision = mergeCertificationRecord(existing, { ...passingRecord, date: "2026-07-29" }, true);
    expect(decision.action).toBe("write");
    if (decision.action !== "write") return;
    expect(decision.merged.date).toBe("2026-07-29"); // new record wins on shared keys
    expect(decision.merged.evidence).toEqual(["PASS add"]);
    expect(decision.merged.sharing).toEqual(existing.sharing); // hand-authored preserved
    expect(decision.merged.ac3344).toEqual(existing.ac3344);
    expect(decision.merged.residualRisk).toBe("hand-authored risk note");
  });
});

describe("passCreatedPaths (33-5-18)", () => {
  it("returns post-only entries, deepest-first", () => {
    const pre = ["claude-code/user/.claude.json.2026-01-01T00-00-00-000Z"];
    const post = [...pre, "cline", "cline/user", "cline/user/settings.json.2026-07-28T00-00-00-000Z"];
    expect(passCreatedPaths(pre, post)).toEqual([
      "cline/user/settings.json.2026-07-28T00-00-00-000Z",
      "cline/user",
      "cline",
    ]);
  });

  it("an unchanged listing yields no cleanup", () => {
    expect(passCreatedPaths(["a", "b"], ["a", "b"])).toEqual([]);
  });
});
