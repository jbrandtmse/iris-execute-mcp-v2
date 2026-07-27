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
import { existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEV_MCP_ENTRY_POINT = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");

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
 */
function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !key.startsWith("IRIS_")) env[key] = value;
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
let sdkEsmDir: string | undefined;
let fixtureDir: string | undefined;
let policyPath: string;
let policyRestorePath: string;
let policyGate4Path: string;
let malformedPath: string;

beforeAll(async () => {
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
    "F: iris_env_promote Gate 4 honors the file channel — a baseline write-family key disabled ONLY in the file refuses execute (other three gates pass)",
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
        },
      );
    },
    { timeout: 60000 },
  );
});
