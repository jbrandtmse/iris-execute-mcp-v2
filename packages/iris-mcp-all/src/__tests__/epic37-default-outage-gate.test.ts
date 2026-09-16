/**
 * Story 37.1 (AC 37.1.8) — the permanent, DEFAULT-SUITE, live-process gate for
 * architecture record M1 (Epic 37): "a configuration error fails startup
 * fast; an unreachable peer never does." Pins the closed-port-default +
 * reachable-other round trip against the BUILT server dists, over REAL stdio
 * JSON-RPC (the real MCP SDK `Client` + `StdioClientTransport`), so a future
 * regression that reintroduces `process.exit(1)` on an unreachable default
 * profile is caught by the default suite — not only by the unit-level tests
 * in `packages/shared/src/__tests__/server-base-default-outage.test.ts`.
 *
 * PLACEMENT (Rule #45). `@iris-mcp/all` is the only package that depends on
 * all five server packages, so a test spawning a built server dist as a
 * child process lives here — mirrors `host-guard-process-gate.test.ts` and
 * `server-manager-process-gate.test.ts`'s established shape in this same
 * directory (real dist, real SDK Client, real `StdioClientTransport`).
 *
 * ARMING CONVENTION (read `epic35-defect-gate.test.ts` first, per the story's
 * Dev Notes). That gate's `IRIS_REQUIRE_LIVE=1` escalation — skip on a
 * pristine/offline checkout, but HARD FAIL under `IRIS_REQUIRE_LIVE` (set by
 * `scripts/prepublish-gate.mjs` on the packaging path) — is the right arming
 * semantic for a PERMANENT epic-done-style capstone (this gate must not be
 * silently absent from a packaging run). It is layered onto the sibling
 * PROCESS-gates' shape (`host-guard-process-gate.test.ts`) rather than
 * epic35's in-process tool-handler shape, because THIS fix is only provable
 * by spawning a real child process against a real closed port — the defect
 * (`process.exit(1)` before the transport connects) is a property of the
 * `start()` call inside a real process, not of a tool handler.
 *
 * **Never fails on a pristine/offline checkout** (absent an armed
 * `IRIS_REQUIRE_LIVE`): an unbuilt dist, an unresolvable SDK, or an
 * unreachable `other` IRIS instance SKIPS each leg with a logged reason.
 *
 * **The shared instance is never stopped.** `default` is ALWAYS `127.0.0.1:9`
 * (a closed local port — nothing this gate does can reach or affect the real
 * instance through it); `other` is the real instance. Credentials come from
 * `IRIS_TEST_*` env vars with the documented local dev defaults as fallback
 * (the `31-6-5` convention).
 *
 * **What the `other` leg actually does to that instance (corrected by the
 * Story 37.1 code review — this header previously claimed "read-only traffic
 * only", which the code contradicts).** The tool calls themselves
 * (`iris_server_info`, `iris_license_info`) are reads, but they are the FIRST
 * TOUCH of the `other` profile, and `handleToolCall` passes
 * `needsCustomRest` as `needsBootstrap` (`server-base.ts`) — which is `true`
 * on all five servers. So the first `other` call runs the standard one-time
 * custom-REST bootstrap (`establishProfile` → `attemptProfileBootstrap` →
 * `bootstrap()`). On an instance whose deployed `ExecuteMCPv2` matches the
 * embedded `BOOTSTRAP_VERSION`, `bootstrap()` short-circuits at the `current`
 * probe and writes NOTHING; on a `missing`/`stale`/`unconfigured` instance it
 * deploys, compiles and configures — architecture decision D8's documented
 * mutate-on-first-use. That is the same thing any real MCP client does on its
 * first call, and it is unavoidable here because AC 37.1.8 requires proving a
 * `server:"other"` call SERVES while `default` is down (a non-establishing
 * call such as `iris_server_profiles` — what the sibling process-gates use —
 * would not prove that). Point `IRIS_TEST_*` at an instance you are willing
 * to have bootstrapped; see ledger item `37-1-CR-4`.
 *
 * **Keychain note:** no test touches the OS keychain — every profile here is
 * configured entirely via `IRIS_*`/`IRIS_PROFILES` env vars passed to the
 * spawned process.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const IRIS_HOST = process.env.IRIS_TEST_HOST ?? "localhost";
const IRIS_PORT = Number(process.env.IRIS_TEST_PORT ?? 52773);
const IRIS_USERNAME = process.env.IRIS_TEST_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_TEST_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_TEST_NAMESPACE ?? "HSCUSTOM";

/** Opt-in packaging-path escalation: skip -> hard failure (mirrors epic35-defect-gate.test.ts). */
const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

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

/** Mirror of the sibling process-gates' SDK resolution (pnpm store layout, iterated to exhaustion). */
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

interface SdkClient {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  callTool: (params: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<{ isError?: boolean; content?: Array<{ text?: string }> }>;
}

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;

beforeAll(async () => {
  sdkEsmDir = resolveSdkEsmDir();
  if (!sdkEsmDir) {
    skipReason =
      "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm — run pnpm install from the repo root.";
  } else if (!(await isIrisReachable())) {
    skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT}/api/atelier/ (set IRIS_TEST_* to point at a live instance).`;
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(
      `IRIS_REQUIRE_LIVE is set, so the Epic 37 default-outage gate may not be skipped: ${skipReason}`,
    );
  }
});

/**
 * Spawn `pkgDir`'s built dist with `default` pointed at a closed local port
 * (127.0.0.1:9 — never the shared instance) and `other` pointed at the real
 * instance, drive `initialize` (via `client.connect`) + two `tools/call`s
 * over real stdio JSON-RPC, and return both results plus captured stderr.
 */
async function driveOutageRoundTrip(
  pkgDir: string,
  toolName: string,
): Promise<{
  otherResult: { isError?: boolean; content?: Array<{ text?: string }> };
  defaultResult: { isError?: boolean; content?: Array<{ text?: string }> };
  stderr: string;
}> {
  const entryPoint = path.join(REPO_ROOT, "packages", pkgDir, "dist", "index.js");

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

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !key.toUpperCase().startsWith("IRIS_")) env[key] = value;
  }
  env.IRIS_HOST = "127.0.0.1";
  env.IRIS_PORT = "9";
  env.IRIS_USERNAME = "epic37GateProbe";
  env.IRIS_PASSWORD = "epic37GateProbe";
  env.IRIS_PROFILES = JSON.stringify({
    other: {
      host: IRIS_HOST,
      port: IRIS_PORT,
      username: IRIS_USERNAME,
      password: IRIS_PASSWORD,
      namespace: IRIS_NAMESPACE,
    },
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: [entryPoint],
    env,
    stderr: "pipe",
  });
  let stderr = "";
  (transport as { stderr?: Readable | null }).stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const client = new Client({ name: "epic37-default-outage-gate", version: "0.0.0" });
  let otherResult: { isError?: boolean; content?: Array<{ text?: string }> };
  let defaultResult: { isError?: boolean; content?: Array<{ text?: string }> };
  try {
    // The `connect()` completing IS the `initialize` handshake succeeding —
    // a pre-fix server never reaches this point (it exits 1 first).
    await client.connect(transport);
    otherResult = await client.callTool({ name: toolName, arguments: { server: "other" } });
    defaultResult = await client.callTool({ name: toolName, arguments: {} });
  } finally {
    await client.close().catch(() => {});
  }

  return { otherResult, defaultResult, stderr };
}

describe("Epic 37 default-profile-outage gate — closed-port default + reachable other, live process (Story 37.1 AC 37.1.8)", () => {
  it(
    "iris-dev-mcp: initialize succeeds, `other` serves, `default` returns the isError envelope, and startup never exits",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] epic37-default-outage-gate (iris-dev-mcp): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const entryPoint = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");
      if (!existsSync(entryPoint)) {
        const reason = `packages/iris-dev-mcp/dist/index.js is not built (run "pnpm turbo run build" first).`;
        if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set: ${reason}`);
        // eslint-disable-next-line no-console
        console.log(`[SKIP] epic37-default-outage-gate (iris-dev-mcp): ${reason}`);
        testCtx.skip();
        return;
      }

      const { otherResult, defaultResult, stderr } = await driveOutageRoundTrip(
        "iris-dev-mcp",
        "iris_server_info",
      );

      // `other` (the real instance) serves normally — and actually returned a
      // payload, not merely an envelope without `isError` (strengthened by the
      // Story 37.1 code review: `not.toBe(true)` alone also passes on a
      // malformed/empty envelope, so it could not distinguish "served" from
      // "returned something").
      expect(otherResult.isError).not.toBe(true);
      expect(String(otherResult.content?.[0]?.text ?? "").length).toBeGreaterThan(0);

      // `default` (closed port) returns the EXISTING structured isError
      // envelope — never a throw, never a process exit.
      expect(defaultResult.isError).toBe(true);
      expect(String(defaultResult.content?.[0]?.text ?? "")).toContain(
        'Could not connect to server profile "default"',
      );

      // The two ERROR lines carry the reason and the continuation semantics,
      // and BOTH name host:port (the health-check line via its
      // NETWORK_ERROR text, the continuation line explicitly), and startup
      // still reached the transport connect (M1: non-fatal).
      expect(stderr).toContain("IRIS health check failed");
      expect(stderr).toContain("127.0.0.1:9");
      expect(stderr).toContain('Continuing startup without the "default" profile');
      expect(stderr).toContain("recover automatically");
      expect(stderr).toContain("Connected via stdio transport");
    },
    { timeout: 45000 },
  );

  it(
    "iris-ops-mcp (second server package): the same round trip holds through a different tool + REST route",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] epic37-default-outage-gate (iris-ops-mcp): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const entryPoint = path.join(REPO_ROOT, "packages", "iris-ops-mcp", "dist", "index.js");
      if (!existsSync(entryPoint)) {
        const reason = `packages/iris-ops-mcp/dist/index.js is not built (run "pnpm turbo run build" first).`;
        if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set: ${reason}`);
        // eslint-disable-next-line no-console
        console.log(`[SKIP] epic37-default-outage-gate (iris-ops-mcp): ${reason}`);
        testCtx.skip();
        return;
      }

      const { otherResult, defaultResult, stderr } = await driveOutageRoundTrip(
        "iris-ops-mcp",
        "iris_license_info",
      );

      // Assertion-for-assertion identical to the iris-dev-mcp leg above — the
      // header markets this as "the same round trip holds", and the Story 37.1
      // code review found it was a strict SUBSET (it dropped the
      // health-check-failed and recover-automatically stderr pins), so a
      // regression on those two lines was caught on dev and missed on ops.
      expect(otherResult.isError).not.toBe(true);
      expect(String(otherResult.content?.[0]?.text ?? "").length).toBeGreaterThan(0);
      expect(defaultResult.isError).toBe(true);
      expect(String(defaultResult.content?.[0]?.text ?? "")).toContain(
        'Could not connect to server profile "default"',
      );
      expect(stderr).toContain("IRIS health check failed");
      expect(stderr).toContain("127.0.0.1:9");
      expect(stderr).toContain('Continuing startup without the "default" profile');
      expect(stderr).toContain("recover automatically");
      expect(stderr).toContain("Connected via stdio transport");
    },
    { timeout: 45000 },
  );
});
