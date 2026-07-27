/**
 * Story 32.0 QA — `IRIS_GOVERNANCE_FILE` channel as a PROCESS-LEVEL gate in
 * the DEFAULT suite (Rule #21 shape, Rule #45 placement), complementing the
 * dev stage's 47 unit tests (`packages/shared/src/__tests__/governance-file.test.ts`)
 * and its one-time, since-deleted stdio smoke.
 *
 * The unit layer proves the loader, the 6-layer cascade, and `configSource`
 * in-process. This gate proves the SAME properties end-to-end against the
 * BUILT `iris-dev-mcp` dist with real governance fixture FILES on disk and a
 * real MCP handshake — the layer unit tests do not cover:
 *
 *   A. **File attribution at the wire (AC 32.0.3, the story's Integration
 *      AC).** `iris_server_profiles` reports a file-layer-disabled key with
 *      `configSource: "file"`, and the `iris-governance://default` RESOURCE
 *      (a separate wire surface from the tool) returns `{ policy,
 *      configSource }` with the same attribution — discovery === resource.
 *   B. **The ordering discriminator end-to-end (AC 32.0.2).** `IRIS_GOVERNANCE`
 *      global `false` + file profile-layer `true` ⇒ the key stays DISABLED
 *      with `configSource: "env"` (all env layers sit above all file layers;
 *      the rejected interleaved ordering would wrongly yield `true`), and a
 *      call to that tool is denied at the wire.
 *   C. **The F2 success-metric round-trip.** A write tool disabled ONLY in
 *      the file returns the `GOVERNANCE_DISABLED` structured envelope (the
 *      handler never runs — the call never reaches IRIS).
 *   D. **Fail-fast startup (AC 32.0.1).** A set-but-missing file and a
 *      malformed-JSON file each fail startup naming `IRIS_GOVERNANCE_FILE` +
 *      the path — the server never starts permissively (dist-only cases: the
 *      throw precedes the IRIS health check, so no live IRIS is needed).
 *   E. **Unset-file back-compat at process level (AC 32.0.1 / Rule #19).**
 *      With the var scrubbed, no key reports `configSource: "file"`, baseline
 *      keys resolve enabled, and a live read-only call passes the gate.
 *   F. **`iris_env_promote` Gate 4 (the second enforcement point).** A
 *      write-family key (`iris_config_manage:set`, a frozen-baseline key
 *      grandfathered ENABLED) disabled ONLY in the file refuses `execute`
 *      even when `iris_env_promote:execute` itself is enabled in env and the
 *      other three gates pass — the file channel reaches Gate 4, not just the
 *      D5 gate.
 *   G. **CLI → file → server round-trip (Story 32.1, AC 32.1.3 durable
 *      form).** The BUILT `iris-mcp-governance` bin (spawned via
 *      `spawnSync`, the 31-2 lesson) CREATES a policy file and `set`s a
 *      write-tool key `false`; the CLI's own `effective --json` then renders
 *      it disabled with `configSource: "file"`; and the BUILT server —
 *      launched with `IRIS_GOVERNANCE_FILE` pointing at that CLI-written
 *      file — reports the IDENTICAL policy via `iris_server_profiles` over a
 *      real MCP handshake. The CLI and the server provably share one engine.
 *   H. **Startup-snapshot semantics at process level (Story 32.1 QA; the
 *      32-0-1 restart-only contract made uniform).** A server launched with
 *      a file that disables a key KEEPS reporting and enforcing the STARTUP
 *      value after the file is rewritten mid-session — `iris_server_profiles`
 *      still reports the old verdict AND the call-time gate still denies,
 *      proving no surface re-reads the file after startup (restart-only).
 *   I. **CLI ↔ server agreement, key-for-key (Story 32.1 QA; single-sourcing
 *      at the wire).** `effective --json` from the BUILT bin and
 *      `iris_server_profiles` from a server launched with the SAME file
 *      agree on EVERY key the CLI renders (policy value AND configSource) —
 *      the CLI's key universe is exactly the frozen baseline ∪ mentioned
 *      keys (asserted against the built `GOVERNANCE_BASELINE`), and the
 *      server's universe is a superset. One engine, two processes, no drift.
 *   J. **32-1-R3 (Story 32.4) unknown top-level keys survive a write, through
 *      the REAL bin.** A policy file carrying a `"comment"` annotation and a
 *      typo'd layer (`"globals"`) round-trips through `set` AND `unset`:
 *      both unknown keys are preserved VERBATIM at their original positions
 *      (pre-Story-32.4 the first write silently dropped them), stderr warns
 *      on the layer-shaped typo, and `validate` still passes. Dist-only —
 *      no live IRIS needed.
 *
 * **Keychain note:** no test touches the OS keychain — the default profile is
 * configured entirely from `IRIS_*` env vars, and every denied call is refused
 * BEFORE any IRIS connection is made.
 *
 * **Never fails on a pristine/offline checkout** (mirrors the existing
 * process gates): an unbuilt dist, an unresolvable SDK, or an unreachable
 * IRIS SKIPS with a logged reason (cases A/B/C/E/F need the startup health
 * check → live IRIS; case D is dist-only). Credentials come from
 * `IRIS_TEST_*` env vars with the documented local dev defaults as fallback
 * (the `31-6-5` convention).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEV_MCP_ENTRY_POINT = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");
const GOVERNANCE_CLI_BIN = path.join(REPO_ROOT, "packages", "shared", "dist", "cli", "governance-cli.js");

const IRIS_HOST = process.env.IRIS_TEST_HOST ?? "localhost";
const IRIS_PORT = Number(process.env.IRIS_TEST_PORT ?? 52773);
const IRIS_USERNAME = process.env.IRIS_TEST_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_TEST_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_TEST_NAMESPACE ?? "HSCUSTOM";

const GOVERNANCE_RESOURCE_URI = "iris-governance://default";

/** Any HTTP response — even a 401 — proves the IRIS Web Gateway is reachable. A network error/timeout does not. */
async function isIrisReachable(): Promise<boolean> {
  try {
    const response = await fetch(`http://${IRIS_HOST}:${IRIS_PORT}/api/atelier/`, {
      signal: AbortSignal.timeout(3000),
    });
    return typeof response.status === "number";
  } catch {
    return false;
  }
}

/** Mirror of `server-manager-process-gate.test.ts`'s SDK resolution (pnpm store layout, iterated to exhaustion). */
function resolveSdkEsmDir(): string | undefined {
  const pnpmDir = path.join(REPO_ROOT, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return undefined;
  let entries: string[];
  try {
    entries = readdirSync(pnpmDir);
  } catch {
    return undefined;
  }
  const candidates = entries
    .filter((name) => name.startsWith("@modelcontextprotocol+sdk@"))
    .sort();
  for (const candidate of candidates) {
    const esmDir = path.join(
      pnpmDir,
      candidate,
      "node_modules",
      "@modelcontextprotocol",
      "sdk",
      "dist",
      "esm",
    );
    if (existsSync(esmDir)) return esmDir;
  }
  return undefined;
}

interface CallToolResult {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

interface SdkClient {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  callTool: (params: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<CallToolResult>;
  readResource: (params: {
    uri: string;
  }) => Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string }> }>;
}

interface DiscoveryGovernance {
  policy?: Record<string, boolean>;
  configSource?: Record<string, string>;
}

/**
 * Child-process env: inherit the ambient process env (PATH etc.) but scrub
 * EVERY IRIS_* variable first, so a developer shell's own suite configuration
 * (in particular a real `IRIS_GOVERNANCE` / `IRIS_GOVERNANCE_FILE`) can never
 * leak into a spawned gate server, then layer the test's explicit IRIS_*
 * values on top. (Mirrors `server-manager-precedence-gate.test.ts`.)
 *
 * 32-3-R9 (Story 32.4): the scrub is CASE-INSENSITIVE — Windows environment
 * variables are case-insensitive, so an ambient lowercase `iris_governance`
 * would otherwise survive the scrub and still be seen by the child.
 */
function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !key.toUpperCase().startsWith("IRIS_")) env[key] = value;
  }
  return {
    ...env,
    IRIS_HOST,
    IRIS_PORT: String(IRIS_PORT),
    IRIS_USERNAME,
    IRIS_PASSWORD,
    IRIS_NAMESPACE,
    ...extra,
  };
}

let distSkipReason: string | undefined;
let liveSkipReason: string | undefined;
let cliSkipReason: string | undefined;
let cliDistSkipReason: string | undefined;
let sdkEsmDir: string | undefined;
let fixtureDir: string | undefined;
let policyPath: string;
let policyRestorePath: string;
let policyGate4Path: string;
let malformedPath: string;

beforeAll(async () => {
  // Dist-only CLI gate (Case J — 32-1-R3): needs the BUILT bin, never a live
  // IRIS. Computed FIRST so the early return below cannot leave it unset.
  if (!existsSync(GOVERNANCE_CLI_BIN)) {
    cliDistSkipReason = `packages/shared/dist/cli/governance-cli.js is not built (run "pnpm turbo run build" first). Looked at: ${GOVERNANCE_CLI_BIN}`;
  }
  if (!existsSync(DEV_MCP_ENTRY_POINT)) {
    distSkipReason = `packages/iris-dev-mcp/dist/index.js is not built (run "pnpm turbo run build" first). Looked at: ${DEV_MCP_ENTRY_POINT}`;
    liveSkipReason = distSkipReason;
    return;
  }
  sdkEsmDir = resolveSdkEsmDir();
  if (!sdkEsmDir) {
    liveSkipReason =
      "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm — run pnpm install from the repo root.";
  } else if (!(await isIrisReachable())) {
    liveSkipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT}/api/atelier/ (set IRIS_TEST_* to point at a live instance).`;
  }

  // Case G additionally needs the BUILT governance CLI bin, and (like the
  // other live cases) the SDK + a reachable IRIS for its server half.
  if (!existsSync(GOVERNANCE_CLI_BIN)) {
    cliSkipReason = `packages/shared/dist/cli/governance-cli.js is not built (run "pnpm turbo run build" first). Looked at: ${GOVERNANCE_CLI_BIN}`;
  } else if (liveSkipReason) {
    cliSkipReason = liveSkipReason;
  }

  fixtureDir = mkdtempSync(path.join(tmpdir(), "iris-gov-file-gate-"));

  // Case A fixture — a file-layer GLOBAL disable (a WRITE tool, so its denial
  // proves enforcement without the handler ever running) plus a file-layer
  // PROFILE disable on the reserved default profile.
  policyPath = path.join(fixtureDir, "governance.json");
  writeFileSync(
    policyPath,
    JSON.stringify({
      global: { iris_doc_put: false },
      profiles: { default: { iris_sql_execute: false } },
    }),
    "utf8",
  );

  // Case B fixture — the file tries to RE-ENABLE a key the env disables
  // (the AC 32.0.2 ordering discriminator: env must win).
  policyRestorePath = path.join(fixtureDir, "governance-restore.json");
  writeFileSync(
    policyRestorePath,
    JSON.stringify({
      profiles: { default: { iris_doc_get: true } },
    }),
    "utf8",
  );

  // Case F fixture — `iris_config_manage:set` is a frozen-baseline key
  // (grandfathered ENABLED), so only THIS file can be the cause of a Gate-4
  // refusal.
  policyGate4Path = path.join(fixtureDir, "governance-gate4.json");
  writeFileSync(
    policyGate4Path,
    JSON.stringify({
      profiles: { default: { "iris_config_manage:set": false } },
    }),
    "utf8",
  );

  // Case D fixture — malformed JSON (fail-fast must name var + path).
  malformedPath = path.join(fixtureDir, "governance-malformed.json");
  writeFileSync(malformedPath, "{ not json", "utf8");
});

afterAll(() => {
  if (fixtureDir) {
    rmSync(fixtureDir, { recursive: true, force: true });
    fixtureDir = undefined;
  }
});

/** Spawn the built server with the given extra env, complete a real MCP handshake, run `fn`, and always close. */
async function withServer(
  extraEnv: Record<string, string>,
  fn: (client: SdkClient) => Promise<void>,
): Promise<void> {
  const sdkClientIndex = pathToFileURL(path.join(sdkEsmDir!, "client", "index.js")).href;
  const sdkClientStdio = pathToFileURL(path.join(sdkEsmDir!, "client", "stdio.js")).href;
  const { Client } = (await import(sdkClientIndex)) as {
    Client: new (info: { name: string; version: string }) => SdkClient;
  };
  const { StdioClientTransport } = (await import(sdkClientStdio)) as {
    StdioClientTransport: new (params: {
      command: string;
      args: string[];
      env: Record<string, string>;
      stderr: string;
    }) => unknown;
  };

  const transport = new StdioClientTransport({
    command: "node",
    args: [DEV_MCP_ENTRY_POINT],
    env: childEnv(extraEnv),
    stderr: "ignore",
  });
  const client = new Client({ name: "iris-mcp-all-gov-file-gate", version: "0.0.0" });
  try {
    await client.connect(transport);
    await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Call `iris_server_profiles` (single-profile view) and return its governance block. */
async function discoveryGovernance(client: SdkClient): Promise<DiscoveryGovernance> {
  const result = await client.callTool({ name: "iris_server_profiles", arguments: {} });
  expect(result.isError).not.toBe(true);
  return (result.structuredContent?.governance ?? {}) as DiscoveryGovernance;
}

/** Read the `iris-governance://default` resource and return its parsed `{ policy, configSource }` payload. */
async function resourcePayload(client: SdkClient): Promise<{
  policy: Record<string, boolean>;
  configSource: Record<string, string>;
}> {
  const result = await client.readResource({ uri: GOVERNANCE_RESOURCE_URI });
  const text = result.contents[0]?.text;
  expect(typeof text).toBe("string");
  return JSON.parse(text!) as {
    policy: Record<string, boolean>;
    configSource: Record<string, string>;
  };
}

interface SpawnOutcome {
  code: number | null;
  stderr: string;
  timedOut: boolean;
}

/**
 * Spawn the built server directly (no MCP handshake) and wait for it to EXIT
 * on its own — the shape of a startup fail-fast (`server.start()`'s catch
 * prints "Fatal:" + the error and exits 1). A server still alive at the
 * timeout is killed and reported `timedOut`, which the assertions treat as
 * failure — a fail-fast violation that does NOT stop startup (silently
 * permissive) is exactly the regression these cases pin.
 */
function spawnAndWaitForExit(
  env: Record<string, string>,
  timeoutMs: number,
): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DEV_MCP_ENTRY_POINT], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, stderr, timedOut: true });
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, timedOut: false });
    });
  });
}

function skipIf(ctx: { skip: () => void }, reason: string | undefined, label: string): boolean {
  if (!reason) return false;
  // eslint-disable-next-line no-console
  console.log(`[SKIP] governance-file process gate (${label}): ${reason}`);
  ctx.skip();
  return true;
}

describe("Story 32.0 QA — IRIS_GOVERNANCE_FILE process-level gate (built server, real handshake)", () => {
  it(
    "A: file-layer disables report configSource 'file' on BOTH the discovery tool and the iris-governance:// resource; a file-disabled write tool returns GOVERNANCE_DISABLED",
    async (ctx) => {
      if (skipIf(ctx, liveSkipReason, "file attribution + denial")) return;

      await withServer({ IRIS_GOVERNANCE_FILE: policyPath }, async (client) => {
        // ── Discovery tool surface (AC 32.0.3) ─────────────────────────
        const governance = await discoveryGovernance(client);
        expect(governance.policy?.["iris_doc_put"]).toBe(false);
        expect(governance.configSource?.["iris_doc_put"]).toBe("file");
        expect(governance.policy?.["iris_sql_execute"]).toBe(false);
        expect(governance.configSource?.["iris_sql_execute"]).toBe("file");
        // Control: an untouched baseline key stays enabled via the default seed.
        expect(governance.policy?.["iris_doc_get"]).toBe(true);
        expect(governance.configSource?.["iris_doc_get"]).toBe("default");

        // ── Resource surface (the SECOND wire surface for the same data) ──
        const resource = await resourcePayload(client);
        expect(resource.policy["iris_doc_put"]).toBe(false);
        expect(resource.configSource["iris_doc_put"]).toBe("file");
        expect(resource.policy["iris_sql_execute"]).toBe(false);
        expect(resource.configSource["iris_sql_execute"]).toBe("file");
        // Discovery === resource on BOTH maps (single-sourced surfaces cannot drift).
        expect(resource.policy).toEqual(governance.policy);
        expect(resource.configSource).toEqual(governance.configSource);

        // ── The F2 round-trip: a file-disabled WRITE tool is denied with the
        // structured envelope; the handler never runs (nothing reaches IRIS).
        const deniedWrite = await client.callTool({
          name: "iris_doc_put",
          arguments: { name: "QaGate32.Denied.cls", content: "Class QaGate32.Denied {}" },
        });
        expect(deniedWrite.isError).toBe(true);
        expect(deniedWrite.structuredContent?.code).toBe("GOVERNANCE_DISABLED");
        expect(deniedWrite.structuredContent?.action).toBe("iris_doc_put");
        // An explicit file-layer denial is NOT attributed to the preset.
        expect(deniedWrite.structuredContent?.presetApplied).toBeUndefined();

        // ── The file PROFILE layer denies too (same file, profile slot). ──
        const deniedRead = await client.callTool({
          name: "iris_sql_execute",
          arguments: { query: "SELECT 1" },
        });
        expect(deniedRead.isError).toBe(true);
        expect(deniedRead.structuredContent?.code).toBe("GOVERNANCE_DISABLED");
        expect(deniedRead.structuredContent?.action).toBe("iris_sql_execute");
      });
    },
    { timeout: 60000 },
  );

  it(
    "B: ordering discriminator at the wire — env global false + file profile true ⇒ still DISABLED with configSource 'env'",
    async (ctx) => {
      if (skipIf(ctx, liveSkipReason, "ordering discriminator")) return;

      await withServer(
        {
          IRIS_GOVERNANCE: JSON.stringify({ global: { iris_doc_get: false } }),
          IRIS_GOVERNANCE_FILE: policyRestorePath,
        },
        async (client) => {
          const governance = await discoveryGovernance(client);
          // All env layers sit ABOVE all file layers (AC 32.0.2, ordering A):
          // the file's profile-layer re-enable LOSES. The rejected interleaved
          // ordering (profile.env ?? profile.file ?? global.env …) would
          // wrongly report enabled — this is the mechanical proof ordering A
          // shipped, at the process level.
          expect(governance.policy?.["iris_doc_get"]).toBe(false);
          expect(governance.configSource?.["iris_doc_get"]).toBe("env");

          const resource = await resourcePayload(client);
          expect(resource.policy["iris_doc_get"]).toBe(false);
          expect(resource.configSource["iris_doc_get"]).toBe("env");

          // …and the gate enforces it at call time (the discriminator is not
          // just a reporting artifact).
          const denied = await client.callTool({
            name: "iris_doc_get",
            arguments: { name: "Ens.Director.cls" },
          });
          expect(denied.isError).toBe(true);
          expect(denied.structuredContent?.code).toBe("GOVERNANCE_DISABLED");
          expect(denied.structuredContent?.action).toBe("iris_doc_get");
        },
      );
    },
    { timeout: 60000 },
  );

  it(
    "E: unset IRIS_GOVERNANCE_FILE ⇒ pre-feature behavior at process level — no 'file' configSource anywhere, baseline keys enabled, a live read-only call passes the gate",
    async (ctx) => {
      if (skipIf(ctx, liveSkipReason, "unset-file back-compat")) return;

      // childEnv scrubs EVERY ambient IRIS_* var; adding none of the
      // governance vars reproduces the pre-feature environment exactly.
      await withServer({}, async (client) => {
        const governance = await discoveryGovernance(client);
        expect(governance.configSource).toBeDefined();
        // Rule #19 at process level: the additive configSource field never
        // reports "file" when no file is configured…
        for (const [key, source] of Object.entries(governance.configSource!)) {
          expect(source, `configSource[${key}]`).not.toBe("file");
        }
        // …and the keys Case A disabled resolve to their pre-feature state.
        expect(governance.policy?.["iris_doc_put"]).toBe(true);
        expect(governance.configSource?.["iris_doc_put"]).toBe("default");
        expect(governance.policy?.["iris_sql_execute"]).toBe(true);
        expect(governance.configSource?.["iris_sql_execute"]).toBe("default");

        const resource = await resourcePayload(client);
        expect(resource.policy).toEqual(governance.policy);
        expect(resource.configSource).toEqual(governance.configSource);

        // The gate is a pass-through: the SAME call Case A saw denied now
        // executes (read-only, no IRIS mutation) — proving the denial above
        // was caused by the file, not by the tool being broken.
        const allowed = await client.callTool({
          name: "iris_sql_execute",
          arguments: { query: "SELECT 1" },
        });
        expect(allowed.structuredContent?.code).not.toBe("GOVERNANCE_DISABLED");
        expect(allowed.isError).not.toBe(true);
      });
    },
    { timeout: 60000 },
  );

  it(
    "D: a set-but-missing file FAILS startup naming IRIS_GOVERNANCE_FILE + the path; malformed JSON likewise (never silently permissive)",
    async (ctx) => {
      if (skipIf(ctx, distSkipReason, "startup fail-fast")) return;

      // Dist-only: loadGovernanceFile throws in start() BEFORE the IRIS
      // health check, so these need no live IRIS.
      const missingPath = path.join(fixtureDir!, "does-not-exist.json");
      const missing = await spawnAndWaitForExit(
        childEnv({ IRIS_GOVERNANCE_FILE: missingPath }),
        45000,
      );
      expect(missing.timedOut).toBe(false);
      expect(missing.code).not.toBe(0);
      expect(missing.stderr).toContain("IRIS_GOVERNANCE_FILE");
      expect(missing.stderr).toContain(missingPath);

      const malformed = await spawnAndWaitForExit(
        childEnv({ IRIS_GOVERNANCE_FILE: malformedPath }),
        45000,
      );
      expect(malformed.timedOut).toBe(false);
      expect(malformed.code).not.toBe(0);
      expect(malformed.stderr).toContain("IRIS_GOVERNANCE_FILE");
      expect(malformed.stderr).toContain(malformedPath);
      expect(malformed.stderr).toContain("could not parse JSON");
    },
    { timeout: 120000 },
  );

  it(
    "F: iris_env_promote Gate 4 honors the file channel — a baseline write-family key disabled ONLY in the file refuses execute (other three gates pass), AND keeps refusing after the file is rewritten mid-session (the process-level startup-snapshot proof for Gate 4 — 32-1-R5)",
    async (ctx) => {
      if (skipIf(ctx, liveSkipReason, "env_promote Gate 4")) return;

      await withServer(
        {
          // `iris_env_promote:execute` is a post-foundation WRITE action
          // (default-disabled at the D5 gate) — enable it in env so the call
          // REACHES the handler's Gate 4. `iris_config_manage:set` is a
          // frozen-baseline key (grandfathered ENABLED) mentioned by NO env
          // layer, so only the file can cause its Gate-4 refusal.
          IRIS_GOVERNANCE: JSON.stringify({ global: { "iris_env_promote:execute": true } }),
          IRIS_GOVERNANCE_FILE: policyGate4Path,
        },
        async (client) => {
          // A diff with exactly one `onlyInSource` entry per non-documents
          // domain (shape mirrors the real iris_env_diff structuredContent —
          // pinned by `fourStepDiff()` in env-promote-execute.test.ts).
          const diff = {
            source: { profile: "default", namespace: IRIS_NAMESPACE },
            target: { profile: "default", namespace: IRIS_NAMESPACE },
            domains: {
              mappings: { onlyInSource: ["global::NewGlobal"], onlyInTarget: [], differs: [], identical: 0 },
              defaultSettings: {
                onlyInSource: [
                  { production: "MyProd", item: "MyItem", hostClass: "MyHost", setting: "Timeout", value: "30" },
                ],
                onlyInTarget: [],
                differs: [],
                identical: 0,
              },
              webapps: { onlyInSource: ["/api/new"], onlyInTarget: [], differs: [], identical: 0 },
              config: { onlyInSource: ["Maxprocesses"], onlyInTarget: [], differs: [], identical: 0 },
            },
            summary: { driftCount: 4, identicalCount: 0 },
          };

          // `plan` is a pure transform (read → default-enabled): produce a
          // REAL plan (steps + planHash) from the server's own action so Gate
          // 3 (plan-hash freshness) genuinely passes — never hand-computed.
          const planResult = await client.callTool({
            name: "iris_env_promote",
            arguments: { action: "plan", source: "default", target: "default", diff },
          });
          expect(planResult.isError).not.toBe(true);
          const plan = planResult.structuredContent as unknown as {
            planHash: string;
            steps: Array<{ index: number; domain: string; operation: string; subject: string }>;
          };
          const configStep = plan.steps.find((step) => step.operation === "setConfig");
          expect(configStep).toBeDefined();

          const executeResult = await client.callTool({
            name: "iris_env_promote",
            arguments: {
              action: "execute",
              source: "default",
              target: "default",
              diff,
              plan,
              steps: [configStep!.index],
              confirm: true,
            },
          });
          expect(executeResult.isError).toBe(true);
          const text = executeResult.content?.[0]?.text ?? "";
          expect(text).toContain("Gate 4");
          expect(text).toContain("iris_config_manage:set");
          // Refused BEFORE any profile client is resolved — nothing was
          // fetched and nothing was written (the refusal names it).
          expect(text).toContain("No changes were made");

          // 32-1-R5 (Story 32.4): the process-level Gate-4 MID-SESSION proof
          // Case H could not give (Case H's surfaces never re-read by design).
          // Rewrite the file mid-session to RE-ENABLE iris_config_manage:set;
          // if Gate 4 re-read the file, the re-execute below would now PASS
          // the gate — and (source == target == default here) attempt a
          // same-value config write on this dev instance. The startup
          // snapshot must keep refusing. The plan stays valid: planHash is a
          // function of the diff alone, and the diff is unchanged.
          writeFileSync(policyGate4Path, "{}\n", "utf8");
          expect(readFileSync(policyGate4Path, "utf8")).toBe("{}\n");

          const executeAfter = await client.callTool({
            name: "iris_env_promote",
            arguments: {
              action: "execute",
              source: "default",
              target: "default",
              diff,
              plan,
              steps: [configStep!.index],
              confirm: true,
            },
          });
          expect(executeAfter.isError).toBe(true);
          const textAfter = executeAfter.content?.[0]?.text ?? "";
          expect(textAfter).toContain("Gate 4");
          expect(textAfter).toContain("iris_config_manage:set");
          expect(textAfter).toContain("No changes were made");
        },
      );
    },
    { timeout: 60000 },
  );

  it(
    "G: CLI -> file -> server round-trip (Story 32.1, AC 32.1.3 durable form) — the BUILT iris-mcp-governance bin writes a policy the BUILT server then reports identically",
    async (ctx) => {
      if (skipIf(ctx, cliSkipReason, "CLI round-trip")) return;

      // 1. The BUILT bin CREATES the file and sets a write-tool key false
      //    (spawnSync against dist — the 31-2 review lesson; expected values
      //    here are the CLI's REAL output contract, pinned by the shared
      //    package's own bin-packaging tests). 32-1-R1 (Story 32.4): the CLI
      //    spawns use the SAME case-insensitively-scrubbed childEnv as Case I
      //    — an ambient IRIS_GOVERNANCE / IRIS_GOVERNANCE_PRESET in the
      //    developer shell must never flip the asserted render or fail the
      //    CLI outright (environment-dependent false failure).
      const cliFile = path.join(fixtureDir!, "governance-cli-roundtrip.json");
      const setResult = spawnSync(
        process.execPath,
        [GOVERNANCE_CLI_BIN, "set", "iris_doc_put", "false", "--file", cliFile],
        { encoding: "utf8", env: childEnv({}) },
      );
      expect(setResult.error).toBeUndefined();
      expect(setResult.status).toBe(0);
      expect(existsSync(cliFile)).toBe(true);

      // 2. The CLI's own validate + effective agree on what it wrote.
      const validateResult = spawnSync(
        process.execPath,
        [GOVERNANCE_CLI_BIN, "validate", "--file", cliFile],
        { encoding: "utf8", env: childEnv({}) },
      );
      expect(validateResult.status).toBe(0);

      const effectiveResult = spawnSync(
        process.execPath,
        [GOVERNANCE_CLI_BIN, "effective", "--file", cliFile, "--json"],
        { encoding: "utf8", env: childEnv({}) },
      );
      expect(effectiveResult.status).toBe(0);
      const cliRender = JSON.parse(effectiveResult.stdout) as {
        policy: Record<string, boolean>;
        configSource: Record<string, string>;
      };
      expect(cliRender.policy["iris_doc_put"]).toBe(false);
      expect(cliRender.configSource["iris_doc_put"]).toBe("file");

      // 3. The BUILT server, launched with IRIS_GOVERNANCE_FILE pointing at
      //    the CLI-written file, reports the IDENTICAL policy over a real
      //    MCP handshake — one engine, two surfaces, no drift.
      await withServer({ IRIS_GOVERNANCE_FILE: cliFile }, async (client) => {
        const governance = await discoveryGovernance(client);
        expect(governance.policy?.["iris_doc_put"]).toBe(cliRender.policy["iris_doc_put"]);
        expect(governance.configSource?.["iris_doc_put"]).toBe(cliRender.configSource["iris_doc_put"]);
      });
    },
    { timeout: 60000 },
  );

  it(
    "H: startup snapshot at process level (32-0-1 restart-only contract) — rewriting the file mid-session changes NEITHER iris_server_profiles NOR the D5 dispatch gate (the two surfaces this case exercises; env_promote's Gate-4 mid-session proof is Case F — 32-1-R5)",
    async (ctx) => {
      if (skipIf(ctx, liveSkipReason, "startup snapshot")) return;

      // Dedicated fixture (this test deliberately REWRITES it mid-session).
      // The disable lives in the profile layer so the denial is attributable
      // to the file alone; `iris_sql_execute` is a READ tool, so the denied
      // call mutates nothing on IRIS even if the gate regressed open.
      const snapshotPath = path.join(fixtureDir!, "governance-snapshot.json");
      writeFileSync(
        snapshotPath,
        JSON.stringify({ profiles: { default: { iris_sql_execute: false } } }),
        "utf8",
      );

      await withServer({ IRIS_GOVERNANCE_FILE: snapshotPath }, async (client) => {
        // ── Baseline: the startup file is reported AND enforced. ─────────
        const before = await discoveryGovernance(client);
        expect(before.policy?.["iris_sql_execute"]).toBe(false);
        expect(before.configSource?.["iris_sql_execute"]).toBe("file");

        const deniedBefore = await client.callTool({
          name: "iris_sql_execute",
          arguments: { query: "SELECT 1" },
        });
        expect(deniedBefore.isError).toBe(true);
        expect(deniedBefore.structuredContent?.code).toBe("GOVERNANCE_DISABLED");

        // ── Rewrite the file mid-session: every layer removed, so a server
        //    that re-read the file would now resolve iris_sql_execute to the
        //    default seed (enabled). Confirm the rewrite actually landed, so
        //    the test can never pass on a failed write. ────────────────────
        writeFileSync(snapshotPath, "{}\n", "utf8");
        expect(readFileSync(snapshotPath, "utf8")).toBe("{}\n");

        // ── Restart-only contract: the REPORTING surface keeps the startup
        //    snapshot… ─────────────────────────────────────────────────────
        const after = await discoveryGovernance(client);
        expect(after.policy?.["iris_sql_execute"]).toBe(false);
        expect(after.configSource?.["iris_sql_execute"]).toBe("file");

        // ── …and so does the ENFORCEMENT surface (the gate still denies —
        //    a re-read anywhere would flip this to a live query). ──────────
        const deniedAfter = await client.callTool({
          name: "iris_sql_execute",
          arguments: { query: "SELECT 1" },
        });
        expect(deniedAfter.isError).toBe(true);
        expect(deniedAfter.structuredContent?.code).toBe("GOVERNANCE_DISABLED");
      });
    },
    { timeout: 60000 },
  );

  it(
    "I: CLI <-> server agreement key-for-key — the built bin's `effective --json` and the built server's iris_server_profiles render the SAME policy for the SAME file",
    async (ctx) => {
      if (skipIf(ctx, cliSkipReason, "CLI-server agreement")) return;

      // Reuse the Case A fixture (baseline keys flipped at both layers). The
      // CLI spawns with the SAME scrubbed env shape as a gate server (childEnv
      // adds only the base connection vars, which the CLI ignores), so its
      // env channel is empty — matching the server launched below.
      const effectiveResult = spawnSync(
        process.execPath,
        [GOVERNANCE_CLI_BIN, "effective", "--file", policyPath, "--json"],
        { encoding: "utf8", env: childEnv({}) },
      );
      expect(effectiveResult.error).toBeUndefined();
      expect(effectiveResult.status).toBe(0);
      const cliRender = JSON.parse(effectiveResult.stdout) as {
        profile: string;
        policy: Record<string, boolean>;
        configSource: Record<string, string>;
      };
      expect(cliRender.profile).toBe("default");

      // The CLI's key universe is EXACTLY the frozen baseline ∪ keys
      // mentioned in the fixture (here: two baseline members, so the union
      // is the baseline itself) — pinned against the BUILT shared package's
      // own GOVERNANCE_BASELINE (mechanical count, Rule #51; never a
      // hand-authored number).
      const baselineModuleUrl = pathToFileURL(
        path.join(REPO_ROOT, "packages", "shared", "dist", "governance-baseline.js"),
      ).href;
      const { GOVERNANCE_BASELINE } = (await import(baselineModuleUrl)) as {
        GOVERNANCE_BASELINE: ReadonlySet<string>;
      };
      expect(new Set(Object.keys(cliRender.policy))).toEqual(new Set(GOVERNANCE_BASELINE));
      expect(new Set(Object.keys(cliRender.configSource))).toEqual(new Set(GOVERNANCE_BASELINE));

      await withServer({ IRIS_GOVERNANCE_FILE: policyPath }, async (client) => {
        const governance = await discoveryGovernance(client);
        expect(governance.policy).toBeDefined();
        expect(governance.configSource).toBeDefined();

        // The server renders a SUPERSET (its universe adds this server's
        // registered post-foundation keys) — every key the CLI knows about
        // must be present on the server…
        for (const key of Object.keys(cliRender.policy)) {
          expect(governance.policy, `server policy missing CLI key ${key}`).toHaveProperty(key);
          expect(governance.configSource, `server configSource missing CLI key ${key}`).toHaveProperty(key);
        }
        // …and the two processes agree on value AND attribution for ALL of
        // them — ~141 keys, one engine, zero drift (the single-sourcing
        // proof at the wire, not just unit level).
        for (const [key, value] of Object.entries(cliRender.policy)) {
          expect(governance.policy![key], `policy[${key}]`).toBe(value);
        }
        for (const [key, source] of Object.entries(cliRender.configSource)) {
          expect(governance.configSource![key], `configSource[${key}]`).toBe(source);
        }

        // Spot-pin the fixture's own flips so the agreement is over a
        // NON-trivial render (file attribution at both layers present).
        expect(cliRender.policy["iris_doc_put"]).toBe(false);
        expect(cliRender.configSource["iris_doc_put"]).toBe("file");
        expect(cliRender.policy["iris_sql_execute"]).toBe(false);
        expect(cliRender.configSource["iris_sql_execute"]).toBe("file");
      });
    },
    { timeout: 60000 },
  );

  it(
    "J: 32-1-R3 through the REAL bin — set/unset preserve unknown top-level keys verbatim (comment + typo'd layer), warn on the layer-shaped typo, and validate still passes",
    async (ctx) => {
      // Dist-only: fixtureDir is created whenever the dev-mcp dist exists, so
      // distSkipReason also covers the fixture-dir-unavailable case.
      if (skipIf(ctx, cliDistSkipReason ?? distSkipReason, "32-1-R3 unknown-key preservation")) return;

      const r3File = path.join(fixtureDir!, "governance-r3-unknown-keys.json");
      const commentValue = "operator annotation — must survive CLI writes";
      const typoLayer = { "iris_doc_put": false };
      writeFileSync(
        r3File,
        `${JSON.stringify(
          { comment: commentValue, globals: typoLayer, global: { "iris_doc_compile": false } },
          null,
          2,
        )}\n`,
        "utf8",
      );

      // `set` via the BUILT bin (scrubbed env — 32-1-R1's lesson: an ambient
      // IRIS_GOVERNANCE* in the developer shell must never leak in).
      // iris_global_get is a frozen-baseline key, so no not-baseline warning
      // confounds the typo-warning assertion.
      const setResult = spawnSync(
        process.execPath,
        [GOVERNANCE_CLI_BIN, "set", "iris_global_get", "false", "--file", r3File],
        { encoding: "utf8", env: childEnv({}) },
      );
      expect(setResult.error).toBeUndefined();
      expect(setResult.status).toBe(0);
      // The layer-shaped typo earns ONE stderr warning naming the key and the
      // two recognized layers…
      expect(setResult.stderr).toContain('unrecognized top-level key "globals"');
      expect(setResult.stderr).toContain('the recognized layers are "global" and "profiles"');
      expect(setResult.stderr).toContain("preserved as-is on write");
      // …and nothing else warns (baseline key, valid file).
      expect(setResult.stderr).not.toContain("is not a pre-foundation");

      // BOTH unknown keys survive the write VERBATIM, at their original
      // positions; the mutation lands in the real layer only. Pre-Story-32.4
      // the first write re-serialized the parsed config alone and VANISHED
      // "comment" and "globals" (silent data loss).
      const afterSet = JSON.parse(readFileSync(r3File, "utf8")) as Record<string, unknown>;
      expect(Object.keys(afterSet)).toEqual(["comment", "globals", "global"]);
      expect(afterSet.comment).toBe(commentValue);
      expect(afterSet.globals).toEqual(typoLayer);
      expect(afterSet.global).toEqual({ "iris_doc_compile": false, "iris_global_get": false });

      // `validate` still passes on the preserved-shape file — unknown keys
      // are not policy, and not errors.
      const validateResult = spawnSync(
        process.execPath,
        [GOVERNANCE_CLI_BIN, "validate", "--file", r3File],
        { encoding: "utf8", env: childEnv({}) },
      );
      expect(validateResult.error).toBeUndefined();
      expect(validateResult.status).toBe(0);
      expect(validateResult.stdout).toContain("OK:");

      // `unset` round-trips through the SAME preservation path (32-1-R3's fix
      // covers both write commands, not just set).
      const unsetResult = spawnSync(
        process.execPath,
        [GOVERNANCE_CLI_BIN, "unset", "iris_global_get", "--file", r3File],
        { encoding: "utf8", env: childEnv({}) },
      );
      expect(unsetResult.error).toBeUndefined();
      expect(unsetResult.status).toBe(0);
      expect(unsetResult.stderr).toContain('unrecognized top-level key "globals"');
      const afterUnset = JSON.parse(readFileSync(r3File, "utf8")) as Record<string, unknown>;
      expect(Object.keys(afterUnset)).toEqual(["comment", "globals", "global"]);
      expect(afterUnset.comment).toBe(commentValue);
      expect(afterUnset.globals).toEqual(typoLayer);
      expect(afterUnset.global).toEqual({ "iris_doc_compile": false });
    },
    { timeout: 60000 },
  );
});
