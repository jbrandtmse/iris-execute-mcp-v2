/**
 * Story 32.3 (deferred item 31-3-8) — Server Manager process-level gate in
 * the DEFAULT suite (Rule #21 shape, Rule #45 placement).
 *
 * The Epic 31 capstone (Story 31.3) proved the Server Manager wire-up end to
 * end with a one-time, human-run, since-deleted script. This gate makes the
 * capstone's CONTROL property re-runnable in CI: launch the BUILT
 * `iris-dev-mcp` as a real child process with a real settings fixture on
 * disk, complete a real MCP handshake, and assert the roster GAINS the
 * Server-Manager profile with `IRIS_SERVER_MANAGER=auto` and LOSES it with
 * the switch unset — Run A/Run B, keychain-free (the fixture carries a
 * deprecated inline password, so the credential chain never needs the OS
 * keychain, which no test may touch).
 *
 * `@iris-mcp/all` is the only package that depends on all five server
 * packages (Rule #45), so a test spawning a built server dist lives here.
 *
 * **Never fails on a pristine/offline checkout** (mirrors the extension's
 * Integration AC 31.6.8 contract): an unbuilt dist, an unresolvable SDK, or
 * an unreachable IRIS SKIPS with a logged reason. Credentials come from
 * `IRIS_TEST_*` env vars with the documented local dev defaults as fallback
 * (the `31-6-5` convention, Story 32.3).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

const SM_PROFILE_NAME = "smGate";

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

/**
 * Resolve the ESM build of the installed `@modelcontextprotocol/sdk` under
 * the pnpm store (mirrors the extension's `resolveSdkEsmDir` — this package
 * declares no SDK dependency of its own, so a bare-specifier import would not
 * resolve; iterated to exhaustion so a version-bumped first candidate cannot
 * silently skip the gate).
 */
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

interface RosterEntry {
  name: string;
  source?: string;
  sourceFile?: string;
}

interface SdkClient {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  callTool: (params: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<{ isError?: boolean; structuredContent?: { profiles?: RosterEntry[] } }>;
}

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let fixtureDir: string | undefined;
let fixtureSettingsPath: string | undefined;

beforeAll(async () => {
  if (!existsSync(DEV_MCP_ENTRY_POINT)) {
    skipReason = `packages/iris-dev-mcp/dist/index.js is not built (run "pnpm turbo run build" first). Looked at: ${DEV_MCP_ENTRY_POINT}`;
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

  // Real settings fixture on disk: one Server Manager server carrying a
  // deprecated inline password, so the profile resolves WITHOUT the OS
  // keychain (which no test may touch) and the roster assertion is about the
  // discovery/merge wire-up alone.
  fixtureDir = mkdtempSync(path.join(tmpdir(), "iris-sm-gate-"));
  mkdirSync(path.join(fixtureDir, ".vscode"), { recursive: true });
  fixtureSettingsPath = path.join(fixtureDir, ".vscode", "settings.json");
  writeFileSync(
    fixtureSettingsPath,
    JSON.stringify({
      "intersystems.servers": {
        [SM_PROFILE_NAME]: {
          webServer: { scheme: "http", host: IRIS_HOST, port: IRIS_PORT },
          username: IRIS_USERNAME,
          password: IRIS_PASSWORD,
        },
      },
    }),
    "utf8",
  );
});

/** Spawn the built server with the given IRIS_SERVER_MANAGER setting and return its iris_server_profiles roster. */
async function rosterWithSwitch(serverManager: "auto" | "unset"): Promise<RosterEntry[]> {
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

  // 32-3-R9 (Story 32.4): inherit the ambient env (PATH, and SystemRoot on
  // Windows) with EVERY IRIS_* variable scrubbed CASE-INSENSITIVELY, then
  // layer the test's explicit values. The pre-Story-32.4 fresh-built env had
  // NO PATH at all — resolving the spawned `node` (and any credential
  // helper) survived only via a Windows CreateProcess quirk and broke on
  // POSIX/nvm — and an uppercase-only scrub missed lowercase ambient IRIS_*
  // vars on Windows's case-insensitive environment.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !key.toUpperCase().startsWith("IRIS_")) env[key] = value;
  }
  Object.assign(env, {
    IRIS_HOST,
    IRIS_PORT: String(IRIS_PORT),
    IRIS_USERNAME,
    IRIS_PASSWORD,
    IRIS_NAMESPACE,
    IRIS_SM_WORKSPACE: fixtureDir!,
    ...(serverManager === "auto" ? { IRIS_SERVER_MANAGER: "auto" } : {}),
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: [DEV_MCP_ENTRY_POINT],
    env,
    stderr: "ignore",
  });
  const client = new Client({ name: "iris-mcp-all-sm-gate", version: "0.0.0" });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "iris_server_profiles", arguments: {} });
    expect(result.isError).not.toBe(true);
    return result.structuredContent?.profiles ?? [];
  } finally {
    await client.close().catch(() => {});
  }
}

describe("Story 32.3 (31-3-8) — Server Manager process-level gate (built server, real handshake)", () => {
  it(
    "the roster GAINS the Server-Manager profile with IRIS_SERVER_MANAGER=auto (Run A) and LOSES it with the switch unset (Run B)",
    async (ctx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] 31-3-8 process gate: ${skipReason}`);
        ctx.skip();
        return;
      }
      try {
        // Run A — the switch ON: the fixture's profile is discovered,
        // credential-completed from its inline password (never the keychain),
        // and reported with server-manager provenance.
        const rosterA = await rosterWithSwitch("auto");
        const smEntry = rosterA.find((entry) => entry.name === SM_PROFILE_NAME);
        expect(smEntry).toBeDefined();
        expect(smEntry?.source).toBe("server-manager");
        expect(smEntry?.sourceFile).toBe(fixtureSettingsPath);

        // Run B — the switch OFF (unset): the SAME fixture on disk
        // contributes NOTHING (the control: the delta is the switch alone).
        const rosterB = await rosterWithSwitch("unset");
        expect(rosterB.find((entry) => entry.name === SM_PROFILE_NAME)).toBeUndefined();
      } finally {
        if (fixtureDir) {
          rmSync(fixtureDir, { recursive: true, force: true });
          fixtureDir = undefined;
        }
      }
    },
    { timeout: 60000 },
  );
});
