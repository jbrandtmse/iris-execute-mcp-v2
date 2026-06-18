import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ════════════════════════════════════════════════════════════════════
// gen-governance-baseline.mjs --check / footgun guard (Story 16.0,
// AC 16.0.6, Rule #25).
//
// These tests child-process-invoke the REAL CLI (not an internal
// re-implementation) so the actual `--check` / refusal behavior is exercised:
//
//   - `--check` re-derives the live surface and verifies the FROZEN committed
//     baseline ONE-DIRECTIONALLY → exit 0, writes nothing.
//   - the default write path WITHOUT `--force` REFUSES → exit non-zero,
//     writes nothing.
//
// The generator imports the BUILT server dists, so (like the
// governance.test.ts drift guard) these tests assume `pnpm turbo run build`
// has already run for the server packages — which it has under the default
// `pnpm test` (turbo `test` depends on `build`).
// ════════════════════════════════════════════════════════════════════

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/shared/src/__tests__/ → repo root is 4 levels up.
const repoRoot = resolve(__dirname, "../../../..");
const scriptPath = resolve(repoRoot, "scripts/gen-governance-baseline.mjs");
const baselinePath = resolve(
  repoRoot,
  "packages/shared/src/governance-baseline.ts",
);

/** Run the generator CLI with the given args; return { status, stdout, stderr }. */
function runCli(args: string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync("node", [scriptPath, ...args], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    // execFileSync throws on non-zero exit; the error carries status/stdout/stderr.
    const err = e as {
      status?: number | null;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      status: typeof err.status === "number" ? err.status : 1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

describe("gen-governance-baseline.mjs --check / footgun guard", () => {
  it("--check verifies the frozen baseline against the live surface and exits 0", () => {
    const { status, stdout, stderr } = runCli(["--check"]);
    // Include stderr in the failure diagnostic: the most likely real failure
    // (dists not built → CLI throws the "run pnpm turbo run build first" hint)
    // writes that hint to stderr, not stdout.
    expect(status, `--check failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(
      0,
    );
    // Summary lines (visibility for the maintainer / CI log).
    expect(stdout).toContain("frozen foundation keys (committed): 141");
    expect(stdout).toMatch(/OK — every frozen foundation key still exists/);
  });

  it("--check writes nothing (frozen baseline byte-for-byte unchanged)", () => {
    const before = readFileSync(baselinePath, "utf-8");
    const { status } = runCli(["--check"]);
    expect(status).toBe(0);
    const after = readFileSync(baselinePath, "utf-8");
    expect(after).toBe(before);
    // The committed frozen hash must be untouched.
    expect(after).toContain('GOVERNANCE_BASELINE_HASH = "1e62c5ad5bf7"');
  });

  it("the default write path WITHOUT --force refuses (non-zero exit, no write)", () => {
    const before = readFileSync(baselinePath, "utf-8");
    const { status, stderr } = runCli([]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/REFUSING to overwrite the FROZEN baseline/);
    // Points the maintainer at the safe verification path.
    expect(stderr).toContain("--check");
    expect(stderr).toContain("--force");
    const after = readFileSync(baselinePath, "utf-8");
    expect(after).toBe(before);
  });

  // ── Focus (d): the frozen-foundation contract — post-foundation NEW keys are
  //    EXPECTED and allowed; --check REPORTS them for visibility and still
  //    succeeds (it must NOT fail just because the live surface grew past the
  //    frozen 141). AC 16.0.1 (one-directional drift: report `live \ committed`,
  //    never fail on it). Without this assertion the dev test would still pass
  //    even if a future change wrongly made post-foundation growth a failure.
  it("--check reports post-foundation new keys and still succeeds (growth is allowed)", () => {
    const { status, stdout } = runCli(["--check"]);
    expect(status, `--check stdout:\n${stdout}`).toBe(0);

    // The summary reports the three counts; the post-foundation line is the
    // visibility surface for new (Epic 15+) keys outside the frozen baseline.
    expect(stdout).toMatch(/post-foundation new keys \(allowed\):\s*(\d+)/);
    expect(stdout).toContain("live keys (derived from dists):");

    // The live surface has genuinely grown past the frozen foundation (Epic 15
    // added governed write tools), so the live count > the frozen 141 and the
    // post-foundation count > 0 — yet --check still exits 0. This is the proof
    // that one-directional growth is allowed, not a failure.
    const liveMatch = stdout.match(
      /live keys \(derived from dists\):\s*(\d+)/,
    );
    const postMatch = stdout.match(
      /post-foundation new keys \(allowed\):\s*(\d+)/,
    );
    expect(liveMatch, `expected a live-key count line:\n${stdout}`).not.toBeNull();
    expect(postMatch, `expected a post-foundation count line:\n${stdout}`).not.toBeNull();
    const liveCount = Number(liveMatch![1]);
    const postCount = Number(postMatch![1]);
    // Live surface ≥ frozen foundation, and the reported new-key count equals
    // (live − frozen) — the one-directional `live \ committed` set size.
    expect(liveCount).toBeGreaterThanOrEqual(141);
    expect(postCount).toBe(liveCount - 141);
    // Growth happened post-Epic-14, and it did NOT cause a failure.
    expect(postCount).toBeGreaterThan(0);
  });

  // ── Focus (gap note): a "vanished foundation key" scenario (a frozen key
  //    missing from the live surface → exit 1 with the regression guidance) is
  //    the inverse of the success path above. It is intentionally NOT automated
  //    here: reproducing it would require mutating the real built server dists
  //    (or stubbing the frozen baseline), which the strictly-additive constraint
  //    forbids (cannot touch governance-baseline.ts; cannot perturb dists). The
  //    failure branch IS exercised by the authoritative drift logic mirrored in
  //    governance.test.ts. See the test-summary "Coverage gaps" note.
});
