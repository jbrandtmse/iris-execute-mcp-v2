/**
 * Story 32.4 QA — 32-3-R6 host-guard (`IRIS_HOST` / `IRIS_PROFILES` bare-host
 * validation) as a PROCESS-LEVEL gate in the DEFAULT suite (Rule #21 shape,
 * Rule #45 placement).
 *
 * The unit layer (`profiles.test.ts` R6 fixtures, `config.test.ts`) proves
 * `loadConfig`/`mergeProfile` reject a userinfo/scheme/inline-port host
 * in-process. This gate proves the SAME dispositions end-to-end against the
 * BUILT `iris-dev-mcp` dist — the layer unit tests do not cover:
 *
 *   A. **`IRIS_HOST` carrying URL userinfo fails startup FAST, naming
 *      `IRIS_HOST`, and never echoes the credential half.** Pre-Story-32.4
 *      the value landed verbatim in `baseUrl` — hence in the
 *      `iris_server_profiles` roster, which the docs describe as never
 *      containing a password. Dist-only: `loadConfig` throws in `start()`
 *      BEFORE the IRIS health check, so no live IRIS is needed.
 *   B. **An `IRIS_PROFILES` entry whose `host` carries userinfo fails naming
 *      `IRIS_PROFILES` (the source label — the "mergeProfile trap" guard) —
 *      again without echoing the embedded credential.** Dist-only.
 *   C. **An inline-port host (`db.example.com:8080`) is rejected by the R6
 *      `:` extension** — a host is not host:port; pre-Story-32.4 this
 *      composed `http://db.example.com:8080:52773`. Dist-only.
 *   D. **A CLEAN `IRIS_HOST` still starts (no over-trigger), and a host-less
 *      `IRIS_PROFILES` entry inherits it verbatim** — the guard runs on the
 *      final (inherited) host without rejecting legitimate configuration.
 *      Live: real SDK handshake against live IRIS; the roster's `baseUrl`
 *      values are asserted byte-exact (no userinfo composition).
 *
 * **Keychain note:** no test touches the OS keychain — every profile is
 * configured entirely from `IRIS_*`/`IRIS_PROFILES` env vars.
 *
 * **Never fails on a pristine/offline checkout** (mirrors the existing
 * process gates): an unbuilt dist, an unresolvable SDK, or an unreachable
 * IRIS SKIPS with a logged reason (cases A/B/C are dist-only; case D needs
 * the startup health check → live IRIS). Credentials come from `IRIS_TEST_*`
 * env vars with the documented local dev defaults as fallback (the `31-6-5`
 * convention).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEV_MCP_ENTRY_POINT = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");

const IRIS_HOST = process.env.IRIS_TEST_HOST ?? "localhost";
const IRIS_PORT = Number(process.env.IRIS_TEST_PORT ?? 52773);
const IRIS_USERNAME = process.env.IRIS_TEST_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_TEST_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_TEST_NAMESPACE ?? "HSCUSTOM";

/** Deliberately unique marker credentials that must NEVER be echoed into any error output. */
const HOST_USERINFO_SECRET = "hunter2qaMarker";
const PROFILE_USERINFO_SECRET = "s3cretQaMarker";

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

/** Mirror of the sibling gates' SDK resolution (pnpm store layout, iterated to exhaustion). */
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
  host?: string;
  baseUrl?: string;
}

interface SdkClient {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  callTool: (params: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<{ isError?: boolean; structuredContent?: { profiles?: RosterEntry[] } }>;
}

/**
 * Child-process env: inherit the ambient process env (PATH etc.) but scrub
 * EVERY IRIS_* variable first (CASE-INSENSITIVELY — 32-3-R9), then layer the
 * test's explicit IRIS_* values on top — `extra` is spread LAST, so an
 * `IRIS_HOST` entry there replaces the clean default (the userinfo case).
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

interface SpawnOutcome {
  code: number | null;
  stderr: string;
  timedOut: boolean;
}

/**
 * Spawn the built server directly (no MCP handshake) and wait for it to EXIT
 * on its own — the shape of a startup config failure (`server.start()`'s
 * catch prints "Fatal:" + the error and exits 1). A server still alive at the
 * timeout is killed and reported as `timedOut`, which the assertions treat as
 * failure (a host-guard violation that does NOT fail startup is exactly the
 * regression these cases pin).
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

let distSkipReason: string | undefined;
let liveSkipReason: string | undefined;
let sdkEsmDir: string | undefined;

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
});

describe("Story 32.4 QA — 32-3-R6 host-guard process gate (built server)", () => {
  it(
    "A: IRIS_HOST with URL userinfo FAILS startup fast naming IRIS_HOST — and never echoes the embedded credential",
    async (ctx) => {
      if (distSkipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] host-guard gate (IRIS_HOST userinfo): ${distSkipReason}`);
        ctx.skip();
        return;
      }
      const outcome = await spawnAndWaitForExit(
        childEnv({ IRIS_HOST: `admin:${HOST_USERINFO_SECRET}@${IRIS_HOST}` }),
        45000,
      );
      expect(outcome.timedOut).toBe(false);
      expect(outcome.code).not.toBe(0);
      expect(outcome.stderr).toContain("Fatal:");
      expect(outcome.stderr).toContain("IRIS_HOST must be a bare hostname");
      // The guard's message must not become the leak it prevents: the
      // userinfo secret is never echoed into the error output.
      expect(outcome.stderr).not.toContain(HOST_USERINFO_SECRET);
    },
    { timeout: 60000 },
  );

  it(
    "B: an IRIS_PROFILES entry whose host carries userinfo FAILS startup naming IRIS_PROFILES (the source label), never the credential",
    async (ctx) => {
      if (distSkipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] host-guard gate (IRIS_PROFILES userinfo): ${distSkipReason}`);
        ctx.skip();
        return;
      }
      const profiles = JSON.stringify({
        qaBadHostUserinfo: {
          host: `root:${PROFILE_USERINFO_SECRET}@db.example.com`,
          username: IRIS_USERNAME,
          password: IRIS_PASSWORD,
        },
      });
      const outcome = await spawnAndWaitForExit(
        childEnv({ IRIS_PROFILES: profiles }),
        45000,
      );
      expect(outcome.timedOut).toBe(false);
      expect(outcome.code).not.toBe(0);
      // The error blames the variable the operator actually set (the
      // "mergeProfile trap" guard) — never a different source.
      expect(outcome.stderr).toContain("IRIS_PROFILES is invalid");
      expect(outcome.stderr).toContain("must be a bare hostname");
      expect(outcome.stderr).not.toContain(PROFILE_USERINFO_SECRET);
    },
    { timeout: 60000 },
  );

  it(
    "C: an inline-port IRIS_PROFILES host (db.example.com:8080) is rejected by the R6 colon extension — never silently composed into baseUrl",
    async (ctx) => {
      if (distSkipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] host-guard gate (inline port): ${distSkipReason}`);
        ctx.skip();
        return;
      }
      const profiles = JSON.stringify({
        qaInlinePort: {
          host: "db.example.com:8080",
          username: IRIS_USERNAME,
          password: IRIS_PASSWORD,
        },
      });
      const outcome = await spawnAndWaitForExit(
        childEnv({ IRIS_PROFILES: profiles }),
        45000,
      );
      expect(outcome.timedOut).toBe(false);
      expect(outcome.code).not.toBe(0);
      expect(outcome.stderr).toContain("IRIS_PROFILES is invalid");
      expect(outcome.stderr).toContain("must be a bare hostname");
      expect(outcome.stderr).toContain("inline port");
    },
    { timeout: 60000 },
  );

  it(
    "D: a CLEAN IRIS_HOST still starts (no over-trigger) — the default and a host-less IRIS_PROFILES entry report byte-exact baseUrls over a real handshake",
    async (ctx) => {
      if (liveSkipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] host-guard gate (clean start): ${liveSkipReason}`);
        ctx.skip();
        return;
      }

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

      // A host-less entry inherits the FINAL default host — the R6 guard runs
      // on that inherited value and must NOT reject a clean one.
      const profiles = JSON.stringify({
        qaInheritHost: { username: IRIS_USERNAME, password: IRIS_PASSWORD },
      });
      const env: Record<string, string> = childEnv({ IRIS_PROFILES: profiles });

      const transport = new StdioClientTransport({
        command: "node",
        args: [DEV_MCP_ENTRY_POINT],
        env,
        stderr: "pipe",
      });
      let stderr = "";
      (transport as { stderr?: Readable | null }).stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      const client = new Client({ name: "iris-mcp-all-host-guard-gate", version: "0.0.0" });
      let roster: RosterEntry[] = [];
      try {
        await client.connect(transport);
        const result = await client.callTool({ name: "iris_server_profiles", arguments: {} });
        expect(result.isError).not.toBe(true);
        roster = result.structuredContent?.profiles ?? [];
      } finally {
        await client.close().catch(() => {});
      }

      // Byte-exact baseUrl composition: protocol://host:port, nothing else —
      // no userinfo, no inline port, on BOTH the default profile and the
      // inherited-host entry.
      const expectedBaseUrl = `http://${IRIS_HOST}:${IRIS_PORT}`;
      const defaultProfile = roster.find((entry) => entry.name === "default");
      expect(defaultProfile).toBeDefined();
      expect(defaultProfile?.host).toBe(IRIS_HOST);
      expect(defaultProfile?.baseUrl).toBe(expectedBaseUrl);
      const inherited = roster.find((entry) => entry.name === "qaInheritHost");
      expect(inherited).toBeDefined();
      expect(inherited?.host).toBe(IRIS_HOST);
      expect(inherited?.baseUrl).toBe(expectedBaseUrl);
      // No guard warning fired for the legitimate configuration.
      expect(stderr).not.toContain("must be a bare hostname");
    },
    { timeout: 60000 },
  );
});
