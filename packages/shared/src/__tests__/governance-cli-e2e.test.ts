/**
 * Story 32.1 QA — `iris-mcp-governance` CLI ERROR-PATH e2e through the BUILT
 * bin (`packages/shared/dist/cli/governance-cli.js`), complementing the dev
 * stage's 52 in-process unit tests (`governance-cli.test.ts`, which drive
 * `runCli` with injected streams) and its 5 packaging tests
 * (`governance-cli-dist-packaging.test.ts`, which cover the happy paths:
 * `--help`, unknown command, `validate` on a missing file).
 *
 * This layer pins what only a real spawned process can prove about the
 * FAILURE contract (AC 32.1.2):
 *
 *   1. Reserved-key rejection — exit 2 with the parser's exact text, no file
 *      created, no temp file left behind.
 *   2. `unset` — a missing KEY (exit 1, "nothing to unset", file untouched)
 *      is a DIFFERENT failure from a missing FILE (exit 1, the server
 *      loader's exact text naming `IRIS_GOVERNANCE_FILE` + path).
 *   3. Atomic-write failure modes — a target whose parent path component is
 *      a FILE (rename/temp-create must fail) exits 1 with "could not write",
 *      the pre-existing content is byte-for-byte untouched, and NO stray
 *      `.tmp-` file survives (the CR 10.2 `.manifest.json.tmp` lesson,
 *      asserted at the directory level for EVERY failure case).
 *   4. `--json` on an INVALID file still emits exactly one parseable JSON
 *      object to stdout with exit 1 — for ALL FOUR read commands
 *      (`validate`, `get`, `effective`, `diff`), the 31-2 review lesson
 *      pinned at the process boundary (stdout wiring, not just `runCli`'s
 *      return value).
 *   5. `set` on an invalid EXISTING file refuses with the loader text and
 *      leaves the file byte-for-byte untouched.
 *
 * Every expected string below was captured by RUNNING the built bin
 * (Rule #36/#54 — the real CLI's actual output is the oracle, never a
 * hand-reasoned one).
 *
 * Reads only already-built `dist/` output — no build is triggered here.
 * `pnpm turbo run build test lint type-check` (and turbo.json's `test` task,
 * which declares `dependsOn: ["build"]`) always builds this package before
 * running its tests, so `dist/` is present by the time this file executes in
 * that flow (mirrors `governance-cli-dist-packaging.test.ts`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";

// This file lives at packages/shared/src/__tests__/ — two levels up is the
// package root (packages/shared/), where dist/ lives.
const packageRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const BIN = path.join(packageRoot, "dist", "cli", "governance-cli.js");

/**
 * Child-process env: inherit the ambient env (PATH etc.) but scrub EVERY
 * IRIS_* variable first (CASE-INSENSITIVELY — the 32-3-R9 lesson), so a
 * developer shell's own `IRIS_GOVERNANCE` / `IRIS_GOVERNANCE_FILE` /
 * `IRIS_GOVERNANCE_PRESET` can never leak into a spawned CLI and change what
 * `effective` renders or which file a command resolves.
 */
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !key.toUpperCase().startsWith("IRIS_")) env[key] = value;
  }
  return env;
}

function runBin(args: string[]): SpawnSyncReturns<string> {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: childEnv(),
  });
  expect(result.error).toBeUndefined();
  return result;
}

/** Names of any stray atomic-write temp files in `dir` (the CR 10.2 lesson). */
function strayTemps(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes(".tmp-"));
}

let scratch: string;

beforeAll(() => {
  // turbo's `test` task builds first; a bare `vitest run` on an unbuilt
  // checkout fails here with a clear pointer rather than a spawn ENOENT.
  if (!existsSync(BIN)) {
    throw new Error(
      `packages/shared/dist/cli/governance-cli.js is not built (run "pnpm turbo run build" first). Looked at: ${BIN}`,
    );
  }
  scratch = mkdtempSync(path.join(tmpdir(), "iris-gov-cli-e2e-"));
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("iris-mcp-governance bin — error-path e2e (built dist, spawned process)", () => {
  it("set with a reserved key exits 2 with the parser's exact text, creates no file, leaves no temp", () => {
    const target = path.join(scratch, "reserved.json");
    const result = runBin(["set", "__proto__", "true", "--file", target]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      '"__proto__" is a reserved key and cannot be used as a governance key.',
    );
    expect(existsSync(target)).toBe(false);
    expect(strayTemps(scratch)).toEqual([]);
  });

  it("unset of a key that is NOT SET exits 1 ('nothing to unset') and leaves the file byte-for-byte untouched", () => {
    const target = path.join(scratch, "unset-missing-key.json");
    const original = JSON.stringify({ global: { iris_doc_put: false } }, null, 2) + "\n";
    writeFileSync(target, original, "utf8");

    const result = runBin(["unset", "iris_sql_execute", "--file", target]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("nothing to unset");
    expect(result.stderr).toContain("iris_sql_execute");
    expect(readFileSync(target, "utf8")).toBe(original);
    expect(strayTemps(scratch)).toEqual([]);
  });

  it("unset on a MISSING FILE is a different failure: exit 1 with the server loader's exact text (names var + path)", () => {
    const missing = path.join(scratch, "definitely-not-there.json");
    const result = runBin(["unset", "iris_doc_put", "--file", missing]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("IRIS_GOVERNANCE_FILE is invalid");
    expect(result.stderr).toContain(missing);
    // The two unset failures must not collapse into one message class.
    expect(result.stderr).not.toContain("nothing to unset");
  });

  it("set whose parent path component is a FILE fails the atomic write (exit 1 'could not write'), pre-existing content untouched, no stray temp", () => {
    // <scratch>/blocker is a regular file, so <scratch>/blocker/policy.json
    // can never be created — the temp write itself fails. This exercises the
    // writeFileAtomic failure path through the real bin.
    const blocker = path.join(scratch, "blocker");
    const blockerContent = "I am a file, not a directory\n";
    writeFileSync(blocker, blockerContent, "utf8");
    const target = path.join(blocker, "policy.json");

    const result = runBin(["set", "iris_doc_put", "false", "--file", target]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not write");
    expect(readFileSync(blocker, "utf8")).toBe(blockerContent);
    expect(strayTemps(scratch)).toEqual([]);
  });

  it("set --file pointing at an existing DIRECTORY exits 1 with the loader's clean text (not a raw EISDIR) without mutating it or leaving a temp", () => {
    // Story 32.1 review patch: cmdSet previously read the raw bytes BEFORE
    // the loader, so a directory surfaced as "unexpected error — EISDIR"
    // from the bin's catch-all. Now the loader runs first and its wrapped
    // "could not read the file" text is the contract.
    const dirTarget = path.join(scratch, "a-directory");
    mkdirSync(dirTarget);
    const before = readdirSync(dirTarget);

    const result = runBin(["set", "iris_doc_put", "false", "--file", dirTarget]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("IRIS_GOVERNANCE_FILE is invalid");
    expect(result.stderr).toContain("could not read the file");
    expect(result.stderr).not.toContain("unexpected error");
    expect(readdirSync(dirTarget)).toEqual(before);
    expect(strayTemps(scratch)).toEqual([]);
  });

  it("set on an invalid EXISTING file exits 1 with the loader text and leaves the file byte-for-byte untouched", () => {
    const target = path.join(scratch, "invalid-existing.json");
    const garbage = "{ not json";
    writeFileSync(target, garbage, "utf8");

    const result = runBin(["set", "iris_doc_put", "false", "--file", target]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("IRIS_GOVERNANCE_FILE is invalid");
    expect(result.stderr).toContain("could not parse JSON");
    expect(readFileSync(target, "utf8")).toBe(garbage);
    expect(strayTemps(scratch)).toEqual([]);
  });

  it("--json on an invalid file still emits exactly one parseable JSON object to stdout with exit 1 — for ALL FIVE read commands", () => {
    const badFile = path.join(scratch, "bad.json");
    writeFileSync(badFile, "{ not json", "utf8");

    const cases: Array<{ args: string[]; assertShape: (parsed: Record<string, unknown>) => void }> = [
      {
        args: ["validate", "--json", "--file", badFile],
        assertShape: (parsed) => {
          expect(parsed.ok).toBe(false);
          expect(typeof parsed.error).toBe("string");
        },
      },
      {
        args: ["get", "iris_doc_put", "--json", "--file", badFile],
        assertShape: (parsed) => {
          expect(parsed.key).toBe("iris_doc_put");
          expect(typeof parsed.error).toBe("string");
        },
      },
      {
        args: ["effective", "--json", "--file", badFile],
        assertShape: (parsed) => {
          expect(parsed.profile).toBe("default");
          expect(typeof parsed.error).toBe("string");
        },
      },
      {
        args: ["diff", "--json", "--file", badFile],
        assertShape: (parsed) => {
          expect(typeof parsed.error).toBe("string");
        },
      },
      {
        // Story 32.2: universe fails on the file BEFORE it ever needs the
        // dist packages, so the error path holds even in this e2e's bare
        // scratch environment.
        args: ["universe", "--json", "--file", badFile],
        assertShape: (parsed) => {
          expect(parsed.profile).toBe("default");
          expect(typeof parsed.error).toBe("string");
        },
      },
    ];

    for (const { args, assertShape } of cases) {
      const result = runBin(args);
      expect(result.status, `${args[0]} exit code`).toBe(1);
      // Exactly ONE JSON object on stdout (a single line) — the 31-2 lesson:
      // a failure that prints prose to stdout would break machine consumers.
      const stdout = result.stdout.trim();
      expect(stdout.split(/\r?\n/), `${args[0]} stdout line count`).toHaveLength(1);
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      assertShape(parsed);
      expect(String(parsed.error)).toContain("IRIS_GOVERNANCE_FILE is invalid");
      // The human-readable copy goes to stderr, never mixed into stdout.
      expect(result.stderr).toContain("IRIS_GOVERNANCE_FILE is invalid");
    }
  });
});
