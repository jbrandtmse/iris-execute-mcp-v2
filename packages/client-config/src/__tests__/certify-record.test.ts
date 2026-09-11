/**
 * Story 33.5 / AC 33.5.6a-b + 33-5-18 — the certification record-merge and
 * pass-created path logic (scripts/certify-record.mjs), unit-tested
 * directly (staging a full real-config pass in a test is infeasible; the
 * extracted lib makes the behavior genuinely testable).
 */

import { describe, it, expect } from "vitest";

import { decideRestoreRung, excerpt, mergeCertificationRecord, parseCertifyArgs, passCreatedPaths, timeoutSuffix } from "../../scripts/certify-record.mjs";

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

describe("decideRestoreRung (36.3, 33-5-L9 leg a — the restore ladder's rung 2, previously untested)", () => {
  it("already byte-exact ⇒ no restore rung needed", () => {
    expect(decideRestoreRung({ configMatches: true, availableBackups: ["a"], engineRestoreAttempted: false })).toEqual({
      rung: "none",
    });
  });

  it("mismatch + a pass-created backup ⇒ engine-restore, with the EARLIEST (sorted) backup", () => {
    const decision = decideRestoreRung({
      configMatches: false,
      availableBackups: ["config.toml.2026-01-02T00-00-00-000Z", "config.toml.2026-01-01T00-00-00-000Z"],
      engineRestoreAttempted: false,
    });
    expect(decision).toEqual({ rung: "engine-restore", backup: "config.toml.2026-01-01T00-00-00-000Z" });
  });

  it("mismatch + NO pass-created backup ⇒ escalates straight to raw-restore (nothing to engine-restore from)", () => {
    expect(decideRestoreRung({ configMatches: false, availableBackups: [], engineRestoreAttempted: false })).toEqual({
      rung: "raw-restore",
    });
  });

  it("STILL mismatched after an engine-restore attempt ⇒ raw-restore — never retries the same engine restore", () => {
    expect(
      decideRestoreRung({ configMatches: false, availableBackups: ["config.toml.2026-01-01T00-00-00-000Z"], engineRestoreAttempted: true }),
    ).toEqual({ rung: "raw-restore" });
  });
});

describe("excerpt (36.3, 33-5-L9 leg c — word-boundary truncation, never mid-token)", () => {
  it("short text passes through untouched", () => {
    expect(excerpt("a short line")).toBe("a short line");
  });

  it("long text truncates on the LAST space at-or-before max, never mid-word", () => {
    const word = "abcdefgh"; // 8 chars + 1 space = 9 chars/word
    const text = Array.from({ length: 20 }, () => word).join(" "); // 179 chars
    const cut = excerpt(text, 50);
    expect(cut.endsWith("…")).toBe(true);
    const withoutEllipsis = cut.slice(0, -1);
    // A hard slice at exactly 50 chars lands mid-word ("...abcde", a
    // PARTIAL word) — the fix backs off to the last space instead, so the
    // text before the ellipsis ends with a COMPLETE word, never a partial one.
    expect(withoutEllipsis.endsWith(word)).toBe(true);
    expect(withoutEllipsis.length).toBeLessThanOrEqual(50);
  });

  it("a single token far longer than max hard-cuts (no boundary to back off to)", () => {
    const oneWord = "x".repeat(500);
    const cut = excerpt(oneWord, 50);
    expect(cut).toBe(`${"x".repeat(50)}…`);
  });

  it("collapses internal whitespace runs to single spaces before measuring", () => {
    expect(excerpt("a   b\n\nc\t\td")).toBe("a b c d");
  });
});

describe("timeoutSuffix (36.3, 33-5-L9 leg b — timedOut surfaced, not silently dropped)", () => {
  it("empty string when not timed out", () => {
    expect(timeoutSuffix({ timedOut: false })).toBe("");
    expect(timeoutSuffix({})).toBe("");
  });

  it("a visible marker when timed out", () => {
    expect(timeoutSuffix({ timedOut: true })).toBe(" [TIMED OUT]");
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

describe("parseCertifyArgs (33-5-L9 Set-vs-Map leg, extracted + pinned at the Story 36.3 code review)", () => {
  it("boolean switches go to `flags`, valued options to `options`, the rest is positional", () => {
    const parsed = parseCertifyArgs(["run", "claude-code", "--real-config", "--server", "iris-ops-mcp", "--skip-agent", "--residual-risk", "manual smoke only"]);
    expect(parsed.subcommand).toBe("run");
    expect(parsed.positional).toEqual(["claude-code"]);
    expect([...parsed.flags].sort()).toEqual(["--real-config", "--skip-agent"]);
    expect(parsed.options.get("--server")).toBe("iris-ops-mcp");
    expect(parsed.options.get("--residual-risk")).toBe("manual smoke only");
    expect(parsed.flags.has("iris-ops-mcp")).toBe(false); // a value is never mistaken for a switch
  });

  it("a trailing `--residual-risk` with NO value sets nothing (the dev-stage refactor stored undefined and the merge then overwrote a hand-set residual risk)", () => {
    const parsed = parseCertifyArgs(["run", "claude-code", "--real-config", "--residual-risk"]);
    expect(parsed.options.has("--residual-risk")).toBe(false);
  });

  it("an empty or `--`-prefixed next token is not a value — and the `--` token stays the switch it is", () => {
    expect(parseCertifyArgs(["run", "x", "--residual-risk", ""]).options.has("--residual-risk")).toBe(false);
    const parsed = parseCertifyArgs(["run", "x", "--residual-risk", "--skip-agent", "--real-config"]);
    expect(parsed.options.has("--residual-risk")).toBe(false);
    expect(parsed.flags.has("--skip-agent")).toBe(true);
    expect(parsed.flags.has("--real-config")).toBe(true);
  });

  it("no arguments at all: no subcommand, nothing parsed", () => {
    const parsed = parseCertifyArgs([]);
    expect(parsed.subcommand).toBeUndefined();
    expect(parsed.positional).toEqual([]);
    expect(parsed.flags.size).toBe(0);
    expect(parsed.options.size).toBe(0);
  });
});
