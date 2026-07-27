/**
 * Story 32.2 QA — the UI→file→server→gate ROUND-TRIP at the wire (AC
 * 32.2.2/32.2.3 e2e), in the DEFAULT suite (Rule #21 shape).
 *
 * The iris-mcp-all `governance-file-process-gate.test.ts` (Story 32.0 QA)
 * already proves CLI→file→server agreement using hand-built `spawnSync`
 * argv. What NO existing test proves is that the EXTENSION's own engine
 * layer — the exact `GovernanceCliCommand` sequence `governancePanel.ts`'s
 * Save issues, run through `resolveGovernanceCli` → `buildGovernanceCliEnv`
 * → `runGovernanceCli` with the production spawn — writes a file the BUILT
 * `iris-dev-mcp` then ENFORCES over a real MCP handshake. That is the F2
 * success-metric round-trip with the extension in the loop:
 *
 *   1. The engine's GLOBAL-tab Save command (`set` with `profile: undefined`)
 *      writes a write-tool key `false` to a fresh governance file — the UI
 *      edits the FILE only (asserted on disk).
 *   2. The BUILT `iris-dev-mcp`, launched with `IRIS_GOVERNANCE_FILE`
 *      pointing at that engine-written file, reports the key disabled with
 *      `configSource: "file"` on `iris_server_profiles` (the AC 32.2.3
 *      preview-vs-server agreement at the wire).
 *   3. Calling the disabled tool returns the `GOVERNANCE_DISABLED` structured
 *      envelope — the handler never runs.
 *   4. The engine's unstage path (`unset`) restores the file to a
 *      no-difference state (`diff --json` entries empty).
 *
 * Server half follows the iris-mcp-all process-gate pattern: real MCP
 * handshake over stdio against the built dist; a hung server fails via the
 * test timeout (never a silent pass); ambient `IRIS_*` scrubbed
 * CASE-INSENSITIVELY from the child env. **Keychain note:** no test touches
 * the OS keychain — the default profile is configured entirely from `IRIS_*`
 * env vars and the denied call is refused BEFORE any IRIS connection.
 *
 * **Never fails on a pristine/offline checkout**: unbuilt dist, an
 * unresolvable SDK, or an unreachable IRIS SKIPS with a logged reason.
 * Credentials come from `IRIS_TEST_*` env vars with the documented local dev
 * defaults (the 31-6-5 convention).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildGovernanceCliEnv,
  resolveGovernanceCli,
  runGovernanceCli,
  type GovernanceCliTarget,
} from "../governanceEngine.js";
import type { DiffJson } from "../governanceView.js";
import type { LauncherSettings } from "../types.js";

// src/__tests__ → repo root is four levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEV_MCP_ENTRY_POINT = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");
const GOVERNANCE_CLI_BIN = path.join(
  REPO_ROOT,
  "packages",
  "shared",
  "dist",
  "cli",
  "governance-cli.js",
);

const IRIS_HOST = process.env.IRIS_TEST_HOST ?? "localhost";
const IRIS_PORT = Number(process.env.IRIS_TEST_PORT ?? 52773);
const IRIS_USERNAME = process.env.IRIS_TEST_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_TEST_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_TEST_NAMESPACE ?? "HSCUSTOM";

/** Any HTTP response — even a 401 — proves the IRIS Web Gateway is reachable. */
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

/** Mirror of the iris-mcp-all process gates' SDK resolution (pnpm store layout, iterated to exhaustion). */
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
}

/**
 * Child-process env: inherit the ambient env (PATH etc.) but scrub EVERY
 * IRIS_* variable CASE-INSENSITIVELY first, so a developer shell's own suite
 * configuration (in particular a real `IRIS_GOVERNANCE_FILE`) can never leak
 * into the spawned gate server, then layer the test's explicit values on top.
 */
function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !/^iris_/i.test(key)) env[key] = value;
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
let sdkEsmDir: string | undefined;
let fixtureDir: string;
let policyPath: string;
let engineTarget: GovernanceCliTarget;
let engineEnv: Record<string, string>;

beforeAll(async () => {
  if (!existsSync(DEV_MCP_ENTRY_POINT)) {
    skipReason = `packages/iris-dev-mcp/dist/index.js is not built (run "pnpm turbo run build" first). Looked at: ${DEV_MCP_ENTRY_POINT}`;
    return;
  }
  if (!existsSync(GOVERNANCE_CLI_BIN)) {
    skipReason = `packages/shared/dist/cli/governance-cli.js is not built (run "pnpm turbo run build" first). Looked at: ${GOVERNANCE_CLI_BIN}`;
    return;
  }
  sdkEsmDir = resolveSdkEsmDir();
  if (!sdkEsmDir) {
    skipReason =
      "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm — run pnpm install from the repo root.";
    return;
  }
  if (!(await isIrisReachable())) {
    skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT}/api/atelier/ (set IRIS_TEST_* to point at a live instance).`;
    return;
  }

  // The extension's REAL local-mode engine resolution against this checkout.
  const resolution = resolveGovernanceCli(settings(), false);
  if (!resolution.ok) {
    skipReason = `the engine's local-mode resolution failed against a built checkout: ${resolution.error}`;
    return;
  }
  engineTarget = resolution.target;
  engineEnv = buildGovernanceCliEnv(settings(), engineTarget.extraEnv);

  fixtureDir = mkdtempSync(path.join(tmpdir(), "iris-gov-ui-roundtrip-"));
  policyPath = path.join(fixtureDir, "governance.json");
});

afterAll(() => {
  if (fixtureDir) {
    rmSync(fixtureDir, { recursive: true, force: true });
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
    command: process.execPath,
    args: [DEV_MCP_ENTRY_POINT],
    env: childEnv(extraEnv),
    stderr: "ignore",
  });
  const client = new Client({ name: "iris-mcp-launcher-qa-32-2", version: "0.0.0" });
  try {
    await client.connect(transport);
    await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

describe("Story 32.2 QA — UI→file→server→gate round-trip at the wire (engine-driven CLI, built server, real handshake)", () => {
  it(
    "the panel's exact Save command sequence writes a file the BUILT iris-dev-mcp enforces: configSource 'file' on iris_server_profiles, GOVERNANCE_DISABLED at call time, and the engine's unset restores",
    async (ctx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] governance UI round-trip: ${skipReason}`);
        ctx.skip();
        return;
      }

      // ── 1. The UI's Save (AC 32.2.2): the GLOBAL tab stages
      //    iris_doc_put → disabled, and Save maps it to EXACTLY this
      //    GovernanceCliCommand (governanceView.stagedCliCommands — profile
      //    undefined for the global layer). The engine runs it against the
      //    real CLI. The file does not exist yet — Save creates it.
      expect(existsSync(policyPath)).toBe(false);
      const setResult = await runGovernanceCli(
        engineTarget,
        { kind: "set", file: policyPath, profile: undefined, key: "iris_doc_put", value: false },
        engineEnv,
      );
      expect(setResult.spawnError).toBeUndefined();
      expect(setResult.status, `set must exit 0 (stderr: ${setResult.stderr.trim()})`).toBe(0);

      // The UI edits the FILE only — the policy landed on disk exactly as the
      // CLI's documented shape, with no client config or env touched.
      const onDisk = JSON.parse(readFileSync(policyPath, "utf8")) as {
        global?: Record<string, boolean>;
      };
      expect(onDisk.global).toEqual({ iris_doc_put: false });

      // ── 2+3. The server half (AC 32.2.3/32.2.4's automated core): the
      //    BUILT iris-dev-mcp launched with IRIS_GOVERNANCE_FILE pointing at
      //    the engine-written file reports the key disabled with
      //    configSource "file", and a call to the disabled WRITE tool returns
      //    the GOVERNANCE_DISABLED structured envelope (the handler never
      //    runs — nothing reaches IRIS).
      await withServer({ IRIS_GOVERNANCE_FILE: policyPath }, async (client) => {
        const discovery = await client.callTool({ name: "iris_server_profiles", arguments: {} });
        expect(discovery.isError).not.toBe(true);
        const governance = (discovery.structuredContent?.governance ?? {}) as {
          policy?: Record<string, boolean>;
          configSource?: Record<string, string>;
        };
        expect(governance.policy?.["iris_doc_put"]).toBe(false);
        expect(governance.configSource?.["iris_doc_put"]).toBe("file");
        // Control: an untouched baseline key stays enabled via the default seed.
        expect(governance.policy?.["iris_doc_get"]).toBe(true);
        expect(governance.configSource?.["iris_doc_get"]).toBe("default");

        const denied = await client.callTool({
          name: "iris_doc_put",
          arguments: { name: "QaGate32_2.Denied.cls", content: "Class QaGate32_2.Denied {}" },
        });
        expect(denied.isError).toBe(true);
        expect(denied.structuredContent?.code).toBe("GOVERNANCE_DISABLED");
        expect(denied.structuredContent?.action).toBe("iris_doc_put");
      });

      // ── 4. The UI's unstage path: toggling back to inherit maps to `unset`
      //    through the same engine — the file returns to a no-difference
      //    state (the cleanup half of the F2 round-trip).
      const unsetResult = await runGovernanceCli(
        engineTarget,
        { kind: "unset", file: policyPath, profile: undefined, key: "iris_doc_put" },
        engineEnv,
      );
      expect(unsetResult.status).toBe(0);
      const diffResult = await runGovernanceCli(
        engineTarget,
        { kind: "diff", file: policyPath },
        engineEnv,
      );
      expect(diffResult.status).toBe(0);
      const diff = JSON.parse(diffResult.stdout) as DiffJson;
      expect(diff.entries).toEqual([]);
    },
    { timeout: 120000 },
  );
});
