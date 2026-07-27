/**
 * Story 32.2 QA — governance engine subprocess E2E through the REAL built
 * CLI (no mock of the subprocess layer): `governanceEngine.ts`'s own
 * resolution/env/argv/spawn functions drive the BUILT
 * `packages/shared/dist/cli/governance-cli.js` exactly as the panel's
 * extension.ts engine host composes them
 * (`resolveGovernanceCli(developmentRepoPath)` → `buildGovernanceCliEnv` →
 * `runGovernanceCli` with the production spawn).
 *
 * The dev stage's `governanceEngine.test.ts` (17 tests) pins argv/env shapes
 * against INJECTED spawn fakes; nothing there proves the real CLI accepts
 * those argv, that the real subprocess contract (exit codes, single-JSON
 * stdout, stderr error text) matches what `parseCliJson` expects, or that
 * `universe` actually derives the full governed universe from built dist.
 * These tests close that, against expected values CAPTURED FROM THE REAL BIN
 * (Rule #36 — capture commands in each test's comment):
 *
 *   1. `universe --json` returns the FULL governed universe — a strict
 *      superset of the frozen baseline (baseline size derived from the built
 *      `GOVERNANCE_BASELINE`, never a hand-authored count, Rule #51), grouped
 *      per package exactly over the extension's own `PACKAGE_DIR_NAME` roster,
 *      with real `mutates` classifications for every key and the
 *      post-foundation write-seed property `effective --json` cannot render
 *      (`iris_env_promote:execute` seeds DISABLED via the default channel).
 *   2. The ambient-env scrub holds end-to-end: an `IRIS_GOVERNANCE` export in
 *      the extension-host environment NEVER reaches the CLI's cascade render
 *      (credential/governance containment at the real process boundary).
 *   3. `set`/`unset`/`validate`/`diff` round-trip a temp governance file at
 *      BOTH layers (global + profile) — the exact `GovernanceCliCommand`
 *      sequence the panel's Save issues.
 *   4. An invalid file and a missing file surface the ENGINE'S OWN error text
 *      (exit 1 + `{ok:false,error}` JSON) — what the view renders inline.
 *
 * **Never fails on a pristine checkout**: an unbuilt shared CLI or any
 * unbuilt server-package dist SKIPS with a logged reason (mirrors the
 * iris-mcp-all process gates).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildGovernanceCliEnv,
  parseCliJson,
  resolveGovernanceCli,
  runGovernanceCli,
  type GovernanceCliCommand,
  type GovernanceCliTarget,
} from "../governanceEngine.js";
import { PACKAGE_DIR_NAME } from "../definitions.js";
import type { LauncherSettings } from "../types.js";
import type { DiffJson, UniverseJson, ValidateJson } from "../governanceView.js";

// src/__tests__ → repo root is four levels up (the extension sits OUTSIDE the
// pnpm workspace but inside the monorepo).
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const GOVERNANCE_CLI_BIN = path.join(
  REPO_ROOT,
  "packages",
  "shared",
  "dist",
  "cli",
  "governance-cli.js",
);

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
  return {
    servers: [],
    packages: ["dev"],
    namespace: "HSCUSTOM",
    combineProfiles: false,
    developmentRepoPath: REPO_ROOT,
    hadStaleAllPackage: false,
    governance: "",
    governancePreset: "",
    governanceFile: "",
    auditLog: "",
    auditLogMaxMb: "",
    auditLogParams: "",
    toolsPreset: "",
    toolsDisable: "",
    toolsEnable: "",
    ...overrides,
  };
}

let skipReason: string | undefined;
let target: GovernanceCliTarget;
let cliEnv: Record<string, string>;
let fixtureDir: string;

beforeAll(() => {
  if (!existsSync(GOVERNANCE_CLI_BIN)) {
    skipReason = `packages/shared/dist/cli/governance-cli.js is not built (run "pnpm turbo run build" first). Looked at: ${GOVERNANCE_CLI_BIN}`;
    return;
  }
  // `universe` loads every server package's built dist/tools/index.js — check
  // the SAME entries the CLI probes (packages/<dir>/dist/tools/index.js).
  for (const dirName of Object.values(PACKAGE_DIR_NAME)) {
    const toolsEntry = path.join(REPO_ROOT, "packages", dirName, "dist", "tools", "index.js");
    if (!existsSync(toolsEntry)) {
      skipReason = `packages/${dirName}/dist/tools/index.js is not built (run "pnpm turbo run build" first) — the universe command cannot derive the key universe.`;
      return;
    }
  }

  // Resolve through the engine's REAL local-mode path (the extension host's
  // own interpreter + the repo's built CLI), exactly as extension.ts composes
  // it. ELECTRON_RUN_AS_NODE=1 is inert under plain node.
  const resolution = resolveGovernanceCli(settings(), true);
  if (!resolution.ok) {
    skipReason = `the engine's local-mode resolution failed against a built checkout: ${resolution.error}`;
    return;
  }
  expect(resolution.target.mode).toBe("local");
  expect(resolution.target.command).toBe(process.execPath);
  expect(resolution.target.baseArgs).toEqual([GOVERNANCE_CLI_BIN]);
  target = resolution.target;
  cliEnv = buildGovernanceCliEnv(settings(), target.extraEnv);

  fixtureDir = mkdtempSync(path.join(tmpdir(), "iris-gov-engine-e2e-"));
});

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

function skipIf(ctx: { skip: () => void }, label: string): boolean {
  if (!skipReason) return false;
  // eslint-disable-next-line no-console
  console.log(`[SKIP] governance engine real-CLI e2e (${label}): ${skipReason}`);
  ctx.skip();
  return true;
}

/** Run one engine command against the real CLI and require exit 0 + parseable JSON. */
async function runJson<T>(command: GovernanceCliCommand): Promise<T> {
  const result = await runGovernanceCli(target, command, cliEnv);
  expect(result.spawnError, `spawn of the real CLI must not fail for ${command.kind}`).toBeUndefined();
  expect(
    result.status,
    `${command.kind} must exit 0 (stderr: ${result.stderr.trim()})`,
  ).toBe(0);
  const parsed = parseCliJson(result.stdout, result.stderr);
  if (!parsed.ok) throw new Error(`parseCliJson failed for ${command.kind}: ${parsed.error}`);
  return parsed.json as T;
}

describe("Story 32.2 QA — engine subprocess e2e through the REAL built CLI", () => {
  it(
    "universe --json renders the FULL governed universe (baseline-strict-superset, per-package groups, real classifications, post-foundation write seed)",
    async (ctx) => {
      if (skipIf(ctx, "universe render")) return;

      // Captured from the real bin (Rule #36):
      //   node packages/shared/dist/cli/governance-cli.js universe --json --profile default
      const universe = await runJson<UniverseJson>({ kind: "universe", profile: "default" });

      // The frozen baseline is derived from the BUILT shared package (Rule
      // #51 — mechanical, never a hand-authored 141/202).
      const baselineModuleUrl = pathToFileURL(
        path.join(REPO_ROOT, "packages", "shared", "dist", "governance-baseline.js"),
      ).href;
      const { GOVERNANCE_BASELINE } = (await import(baselineModuleUrl)) as {
        GOVERNANCE_BASELINE: ReadonlySet<string>;
      };

      // Strict superset: every frozen-baseline key renders, plus the
      // post-foundation registered keys (the property `effective` cannot
      // reproduce — the whole reason this command exists).
      expect(universe.keys.length).toBeGreaterThan(GOVERNANCE_BASELINE.size);
      for (const key of GOVERNANCE_BASELINE) {
        expect(universe.keys, `universe must contain baseline key ${key}`).toContain(key);
      }
      for (const key of universe.postFoundation) {
        expect(GOVERNANCE_BASELINE.has(key), `post-foundation key ${key} must not be baseline`).toBe(
          false,
        );
      }
      expect(new Set(universe.keys).size).toBe(universe.keys.length);

      // Grouped per server package exactly over the extension's own roster
      // (the same PACKAGE_DIR_NAME the local server-spawn path uses) plus the
      // framework tool.
      expect(universe.packages.map((pkg) => pkg.pkg).sort()).toEqual(
        Object.values(PACKAGE_DIR_NAME).sort(),
      );
      expect(universe.frameworkTool.name).toBe("iris_server_profiles");
      expect(universe.frameworkTool.keys).toEqual(["iris_server_profiles"]);

      // Every key carries a REAL mutates classification (never "unclassified"
      // at the engine level) and a configSource from the documented set.
      expect(Object.keys(universe.mutates).sort()).toEqual([...universe.keys].sort());
      for (const [key, source] of Object.entries(universe.configSource)) {
        expect(["env", "file", "preset", "default"], `configSource[${key}]`).toContain(source);
      }
      expect(universe.defaultEnabledWrites).toContain("iris_production_control:clean");

      // The post-foundation write-seed property (AC 32.2.3's substance): a
      // post-foundation WRITE action seeds DISABLED through the default
      // channel — `effective --json` renders it ENABLED, which is why the UI
      // previews through `universe`.
      expect(universe.mutates["iris_env_promote:execute"]).toBe("write");
      expect(universe.policy["iris_env_promote:execute"]).toBe(false);
      expect(universe.configSource["iris_env_promote:execute"]).toBe("default");
    },
    { timeout: 120000 },
  );

  it(
    "an ambient IRIS_GOVERNANCE export in the extension-host environment NEVER reaches the CLI's cascade render (containment at the real process boundary)",
    async (ctx) => {
      if (skipIf(ctx, "ambient scrub")) return;

      // An ambient governance channel that would disable a baseline read key
      // if it leaked into the subprocess. buildGovernanceCliEnv scrubs EVERY
      // IRIS_* variable — prove it against the real CLI render.
      const ambient = {
        ...process.env,
        IRIS_GOVERNANCE: JSON.stringify({ global: { iris_doc_get: false } }),
      };
      const scrubbed = buildGovernanceCliEnv(settings(), target.extraEnv, ambient);
      expect(scrubbed["IRIS_GOVERNANCE"]).toBeUndefined();

      const result = await runGovernanceCli(
        target,
        { kind: "universe", profile: "default" },
        scrubbed,
      );
      expect(result.status).toBe(0);
      const parsed = parseCliJson(result.stdout, result.stderr);
      if (!parsed.ok) throw new Error(`parseCliJson failed: ${parsed.error}`);
      const universe = parsed.json as UniverseJson;
      expect(universe.policy["iris_doc_get"]).toBe(true);
      expect(universe.configSource["iris_doc_get"]).toBe("default");
    },
    { timeout: 120000 },
  );

  it(
    "set/validate/diff/unset round-trip a temp governance file at BOTH layers — the exact command sequence the panel's Save issues",
    async (ctx) => {
      if (skipIf(ctx, "write round-trip")) return;

      const file = path.join(fixtureDir, "roundtrip.json");
      expect(existsSync(file)).toBe(false);

      // Capture commands (Rule #36):
      //   node .../governance-cli.js set iris_doc_put false --file <f>
      //   node .../governance-cli.js set iris_sql_execute true --file <f> --profile qa32
      //   node .../governance-cli.js diff --json --file <f>
      //   node .../governance-cli.js unset iris_doc_put --file <f>   (exit 0; file keeps "global": {})

      // The GLOBAL tab's Save (profile: undefined) — creates the file.
      const setGlobal = await runGovernanceCli(
        target,
        { kind: "set", file, profile: undefined, key: "iris_doc_put", value: false },
        cliEnv,
      );
      expect(setGlobal.status).toBe(0);
      expect(existsSync(file)).toBe(true);
      const onDisk = JSON.parse(readFileSync(file, "utf8")) as {
        global?: Record<string, boolean>;
      };
      expect(onDisk.global?.["iris_doc_put"]).toBe(false);

      const validation = await runJson<ValidateJson>({ kind: "validate", file });
      expect(validation.ok).toBe(true);

      // A PROFILE tab's Save.
      const setProfile = await runGovernanceCli(
        target,
        { kind: "set", file, profile: "qa32", key: "iris_sql_execute", value: true },
        cliEnv,
      );
      expect(setProfile.status).toBe(0);

      const diff = await runJson<DiffJson>({ kind: "diff", file });
      expect(diff.entries).toHaveLength(2);
      expect(diff.entries).toContainEqual({
        layer: "global",
        key: "iris_doc_put",
        file: false,
        default: true,
        differs: true,
      });
      expect(diff.entries).toContainEqual({
        layer: 'profile "qa32"',
        key: "iris_sql_execute",
        file: true,
        default: true,
        differs: false,
      });

      // The preview render attributes BOTH layers to the file channel.
      const universe = await runJson<UniverseJson>({
        kind: "universe",
        file,
        profile: "qa32",
      });
      expect(universe.policy["iris_doc_put"]).toBe(false);
      expect(universe.configSource["iris_doc_put"]).toBe("file");
      expect(universe.policy["iris_sql_execute"]).toBe(true);
      expect(universe.configSource["iris_sql_execute"]).toBe("file");

      // The Discard-equivalent writes: unset BOTH layers; the file returns to
      // a no-difference state (Save's inverse path).
      const unsetGlobal = await runGovernanceCli(
        target,
        { kind: "unset", file, profile: undefined, key: "iris_doc_put" },
        cliEnv,
      );
      expect(unsetGlobal.status).toBe(0);
      const unsetProfile = await runGovernanceCli(
        target,
        { kind: "unset", file, profile: "qa32", key: "iris_sql_execute" },
        cliEnv,
      );
      expect(unsetProfile.status).toBe(0);

      const restored = await runJson<DiffJson>({ kind: "diff", file });
      expect(restored.entries).toEqual([]);
    },
    { timeout: 120000 },
  );

  it(
    "an invalid file and a missing file surface the ENGINE'S OWN error text (exit 1 + {ok:false,error} JSON) — what the view renders inline",
    async (ctx) => {
      if (skipIf(ctx, "error surfaces")) return;

      // Captured from the real bin (Rule #36):
      //   validate --json --file <malformed>  → exit 1, stdout {"ok":false,"error":"IRIS_GOVERNANCE_FILE is invalid: could not parse JSON (...)"}
      //   validate --json --file <missing>    → exit 1, stdout {"ok":false,"error":"IRIS_GOVERNANCE_FILE is invalid: could not read the file (ENOENT...)"}
      const malformed = path.join(fixtureDir, "malformed.json");
      writeFileSync(malformed, "{ not json", "utf8");

      const invalidResult = await runGovernanceCli(target, { kind: "validate", file: malformed }, cliEnv);
      expect(invalidResult.status).toBe(1);
      const invalidParsed = parseCliJson(invalidResult.stdout, invalidResult.stderr);
      if (!invalidParsed.ok) throw new Error(`expected parseable JSON: ${invalidParsed.error}`);
      const invalidJson = invalidParsed.json as ValidateJson;
      expect(invalidJson.ok).toBe(false);
      expect(invalidJson.error).toContain("could not parse JSON");
      // The SAME engine text is on stderr (the exact server startup failure
      // message the view quotes in its invalid-file banner).
      expect(invalidResult.stderr).toContain("could not parse JSON");

      const missing = path.join(fixtureDir, "does-not-exist.json");
      const missingResult = await runGovernanceCli(target, { kind: "validate", file: missing }, cliEnv);
      expect(missingResult.status).toBe(1);
      const missingParsed = parseCliJson(missingResult.stdout, missingResult.stderr);
      if (!missingParsed.ok) throw new Error(`expected parseable JSON: ${missingParsed.error}`);
      const missingJson = missingParsed.json as ValidateJson;
      expect(missingJson.ok).toBe(false);
      expect(missingJson.error).toContain("could not read the file");
      expect(missingJson.error).toContain(missing);
    },
    { timeout: 120000 },
  );
});
