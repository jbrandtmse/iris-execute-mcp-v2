import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  deriveKeysForTool,
  SERVER_PACKAGES,
} from "../governance-baseline-derivation.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";

// ════════════════════════════════════════════════════════════════════
// CR 16.0-1 lock-step: the generator and the shared helper derive the SAME surface.
//
// Story 22.1 extracted `deriveKeysForTool` so that BOTH the baseline generator
// (`scripts/gen-governance-baseline.mjs` → `deriveLiveKeys`) and the in-suite drift guard
// (`governance.test.ts` → `deriveBaselineFromDists`) funnel through ONE derivation and can
// never disagree on a wrapped/edge action shape. The existing tests each prove a SITE works
// in isolation (the derivation unit test uses synthetic tools; the drift guard checks
// foundation ⊆ live; the --check CLI test checks the CLI's OWN internal consistency).
//
// This test adds the missing CROSS-CHECK: derive the live key surface a SECOND, independent
// way — in-process, via the shared `deriveKeysForTool` over the built server dists (exactly
// what the drift guard does) — and assert it agrees with what the REAL generator CLI reports.
// If someone forked the generator's derivation away from the shared helper (or broke the
// helper such that it no longer reproduces the generator's committed foundation), the two
// would diverge and this test fails.
//
// Like the drift guard / --check CLI tests, this imports the BUILT server dists, so it
// assumes `pnpm turbo run build` has run (it has, under the default `pnpm test`).
// ════════════════════════════════════════════════════════════════════

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/shared/src/__tests__/ → repo root is 4 levels up.
const repoRoot = resolve(__dirname, "../../../..");
const scriptPath = resolve(repoRoot, "scripts/gen-governance-baseline.mjs");

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

/**
 * Derive the live governance key set in-process using the SHARED `deriveKeysForTool` over the
 * built server dists — byte-for-byte the derivation the generator's `deriveLiveKeys` and the
 * `governance.test.ts` drift guard both run (CR 16.0-1). The generator additionally throws on
 * a cross-package duplicate key; there are none (the CLI exits 0 below), so a plain Set — which
 * silently dedups — enumerates the identical surface.
 */
async function deriveLiveKeysInProcess(): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const pkg of SERVER_PACKAGES) {
    const distEntry = resolve(repoRoot, `packages/${pkg}/dist/tools/index.js`);
    const mod = await import(pathToFileURL(distEntry).href);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = mod.tools as any[];
    for (const tool of tools) {
      for (const key of deriveKeysForTool(tool, pkg)) keys.add(key);
    }
  }
  return keys;
}

describe("governance derivation lock-step (CR 16.0-1 — helper ↔ generator)", () => {
  it("the shared helper derives the SAME live surface the generator CLI reports", async () => {
    // Independent derivation via the shared helper (the drift-guard path).
    const helperLive = await deriveLiveKeysInProcess();

    // The REAL generator CLI (the --check path uses the generator's own deriveLiveKeys →
    // deriveKeysForTool) reports its enumerated counts. Exit 0 also proves no vanished
    // foundation key and no cross-package duplicate throw.
    const { status, stdout, stderr } = runCli(["--check"]);
    expect(
      status,
      `gen-governance-baseline --check failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    ).toBe(0);

    const committedMatch = stdout.match(
      /frozen foundation keys \(committed\):\s*(\d+)/,
    );
    const liveMatch = stdout.match(/live keys \(derived from dists\):\s*(\d+)/);
    const postMatch = stdout.match(
      /post-foundation new keys \(allowed\):\s*(\d+)/,
    );
    expect(committedMatch, `no committed-count line:\n${stdout}`).not.toBeNull();
    expect(liveMatch, `no live-count line:\n${stdout}`).not.toBeNull();
    expect(postMatch, `no post-foundation line:\n${stdout}`).not.toBeNull();

    const cliCommitted = Number(committedMatch![1]);
    const cliLive = Number(liveMatch![1]);
    const cliPost = Number(postMatch![1]);

    // (1) LOCK-STEP: the helper (drift-guard site) and the generator CLI enumerate the
    //     IDENTICAL live surface size — they cannot have forked their derivation.
    expect(
      helperLive.size,
      "the shared helper's live surface size must equal the generator CLI's reported live count",
    ).toBe(cliLive);

    // (2) The generator's committed frozen foundation is exactly GOVERNANCE_BASELINE.
    expect(cliCommitted).toBe(GOVERNANCE_BASELINE.size);

    // (3) The helper reproduces EVERY committed frozen-foundation key — the generator that
    //     wrote governance-baseline.ts (via --force at Epic 14) used this same helper, so
    //     re-deriving today must still yield all of them (foundation retained, one-directional).
    const missingFromHelper = [...GOVERNANCE_BASELINE].filter(
      (k) => !helperLive.has(k),
    );
    expect(
      missingFromHelper,
      "the shared helper must re-derive every committed frozen-foundation key",
    ).toEqual([]);

    // (4) The post-foundation delta agrees BOTH ways: (helper live − frozen) equals the
    //     generator CLI's reported post-foundation count, which equals (cli live − committed).
    expect(helperLive.size - GOVERNANCE_BASELINE.size).toBe(cliPost);
    expect(cliPost).toBe(cliLive - cliCommitted);
    // 30s: spawns node importing all server dists + in-process dist imports — slow under
    // parallel `pnpm test` load.
  }, 30000);
});
