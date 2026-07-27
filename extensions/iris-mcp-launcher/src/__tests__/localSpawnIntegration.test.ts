/**
 * Integration AC 31.6.8 — the FIRST real-runtime evidence in this extension's
 * suite. Every other test in `src/__tests__/` exercises pure logic against
 * fakes (Dev Notes: "keep unit tests runnable without a VS Code host"); none
 * of them prove a `PlannedDefinition` this extension produces can actually be
 * spawned and speak MCP. This file does exactly that:
 *
 *   1. Uses the REAL `LauncherProvider` (Task 2's local-spawn logic) with
 *      `developmentRepoPath` pointed at THIS repo, so `providePlannedDefinitions()`
 *      returns a REAL `command: "node"` / `args: [".../dist/index.js"]` pair —
 *      not a hand-built literal.
 *   2. Uses the REAL `resolveEnvForLabel()` — the REAL `synthesizeIrisEnv` +
 *      `withOwnedVarsCleared` — to produce the REAL spawn env for a live IRIS
 *      connection.
 *   3. Spawns that command/args/env as a genuine child process via the real
 *      `@modelcontextprotocol/sdk` `StdioClientTransport`, completes a real
 *      `initialize` handshake with the real SDK `Client`, calls `listTools()`,
 *      and calls one read-only tool (`iris_server_info`, zero required args —
 *      `packages/iris-dev-mcp/src/tools/server.ts`) that reaches live IRIS
 *      over the Atelier REST API.
 *
 * This narrows deferred item `31-5-1` (the Story 31.5 review's "no
 * Extension-Host / real-runtime test tier" gap) for the ONE path this story
 * adds — it does not close the gap for the `npx`/credential-prompt path,
 * which still has no automated real-runtime coverage.
 *
 * **Never fails on a pristine/offline checkout.** `packages/iris-dev-mcp/dist/`
 * may not be built yet, the pnpm SDK store layout may differ, or IRIS may not
 * be running — any of those SKIPS (with a logged reason) rather than failing,
 * so this suite stays green without a live IRIS instance. Verified locally
 * against `localhost:52773`, `_SYSTEM`/`SYS`, namespace `HSCUSTOM` (story Dev
 * Notes).
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { LauncherProvider } from "../serverDefinitionProvider.js";
import type { AuthApi, LauncherSettings, ServerManagerApi } from "../types.js";

// Repo root — 4 levels up from src/__tests__ (__tests__ -> src ->
// iris-mcp-launcher -> extensions -> repo root), matching the pattern
// `envContract.test.ts` and `definitions.test.ts` use to reach monorepo
// paths. __dirname (not import.meta.url) so this file type-checks cleanly
// under the extension's own CommonJS tsconfig.json.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEV_MCP_ENTRY_POINT = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");

// 31-6-5 (Story 32.3): credentials come from IRIS_TEST_* env vars with the
// documented local dev defaults as fallback — a failure prints the fallback,
// not an operator's real credential, and CI can point at a different instance
// without editing a committed file.
// REPO-WIDE DECISION (recorded in deferred-work.md, 31-6-5): `__tests__/`
// stays OUT of containment.test.ts's credential-grep roster — test fixtures
// are not shipped code, and env-with-fallback (not grep enforcement) is the
// containment mechanism for test-tier credentials.
const IRIS_HOST = process.env.IRIS_TEST_HOST ?? "localhost";
const IRIS_PORT = Number(process.env.IRIS_TEST_PORT ?? 52773);
const IRIS_USERNAME = process.env.IRIS_TEST_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_TEST_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_TEST_NAMESPACE ?? "HSCUSTOM";

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
  return {
    servers: [],
    packages: ["dev"],
    namespace: IRIS_NAMESPACE,
    combineProfiles: false,
    developmentRepoPath: "",
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

/**
 * Resolve the ESM entry points of the installed `@modelcontextprotocol/sdk`
 * WITHOUT hardcoding a version-pinned path (story Dev Notes: "resolve it
 * dynamically; do not hardcode a version-pinned path that will rot"). It
 * lives under the pnpm STORE layout —
 * `node_modules/.pnpm/@modelcontextprotocol+sdk@<version>_<peer-hash>/node_modules/@modelcontextprotocol/sdk/dist/esm/`
 * — not the flat `node_modules/@modelcontextprotocol/sdk` this extension's
 * OWN `node_modules` would use (it has no such dependency at all; this SDK
 * is only ever a transitive dependency of the monorepo's own packages).
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

  // Sorted for determinism and iterated to exhaustion: pnpm's store holds one
  // directory per (version, peer-hash) pair, so a version bump or a peer-dep
  // split routinely yields several `@modelcontextprotocol+sdk@…` entries in
  // readdir order. Taking `find()`'s first hit and giving up if ITS dist/esm is
  // absent would silently skip this whole test — and a skip is indistinguishable
  // from "IRIS is not running", so the rot would never be noticed.
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
 * `withOwnedVarsCleared()`'s `null` entries mean "remove this variable" in
 * VS Code's `McpStdioServerDefinition.env` contract — but the real SDK
 * `StdioClientTransport` has no such convention; it merges `{
 * ...getDefaultEnvironment(), ...server.env }` verbatim (`client/stdio.js`),
 * so a `null` value would reach `cross-spawn` and get coerced to the literal
 * string `"null"`. Deleting the null-valued keys (never stringifying them)
 * is the correct real-process equivalent (story Dev Notes).
 */
function toSpawnEnv(env: Record<string, string | null>): Record<string, string> {
  const spawnEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== null) spawnEnv[key] = value;
  }
  return spawnEnv;
}

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;

beforeAll(async () => {
  if (!existsSync(DEV_MCP_ENTRY_POINT)) {
    skipReason = `packages/iris-dev-mcp/dist/index.js is not built (run "pnpm --filter @iris-mcp/dev build" from the repo root). Looked at: ${DEV_MCP_ENTRY_POINT}`;
    return;
  }

  sdkEsmDir = resolveSdkEsmDir();
  if (!sdkEsmDir) {
    skipReason =
      "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm — " +
      "run pnpm install from the repo root.";
    return;
  }

  if (!(await isIrisReachable())) {
    skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT}/api/atelier/ (expected the local dev instance from the story's Dev Notes).`;
    return;
  }
});

describe("Integration AC 31.6.8 — a local-path definition actually starts and speaks MCP", () => {
  let activeClient: { close: () => Promise<void> } | undefined;

  afterEach(async () => {
    if (activeClient) {
      await activeClient.close().catch(() => {});
      activeClient = undefined;
    }
  });

  it(
    "spawns the REAL planned node+dist/index.js command with the REAL synthesized env, completes a real MCP initialize handshake, lists tools, and calls iris_server_info against live IRIS",
    async (ctx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] Integration AC 31.6.8: ${skipReason}`);
        ctx.skip();
        return;
      }

      // ── 1. REAL planned command/args, via the REAL LauncherProvider ──
      const api: ServerManagerApi = {
        getServerNames: () => [{ name: "local-iris", description: "", detail: "" }],
        getServerSpec: async () => ({
          name: "local-iris",
          webServer: { host: IRIS_HOST, port: IRIS_PORT, scheme: "http" },
          username: IRIS_USERNAME,
          password: IRIS_PASSWORD, // pre-supplied, so no credential prompt is exercised here
        }),
        getAccount: () => ({ id: "acct-1", label: "Account One" }),
      };
      const authApi: AuthApi = {
        getSession: async () => {
          throw new Error("must not be called — the spec already carries a password");
        },
      };

      const providerWarnings: string[] = [];
      const provider = new LauncherProvider({
        getServerManagerApi: async () => api,
        authApi,
        getSettings: () =>
          settings({
            packages: ["dev"],
            servers: ["local-iris"],
            developmentRepoPath: REPO_ROOT,
          }),
        showWarning: (message) => providerWarnings.push(message),
      });

      const planned = await provider.providePlannedDefinitions();
      expect(providerWarnings).toEqual([]); // the real dev-mcp package IS built (guarded by skipReason above)
      // 31-6-3 (Story 32.3): the planned command is the extension host's own
      // interpreter (process.execPath + ELECTRON_RUN_AS_NODE=1 in the env),
      // never a bare "node" resolved from the host's PATH. In THIS process
      // (vitest, plain Node) execPath IS node, and ELECTRON_RUN_AS_NODE is
      // inert — the real spawn below is unaffected.
      expect(planned).toEqual([
        { label: "IRIS Dev Tools — local-iris", command: process.execPath, args: [DEV_MCP_ENTRY_POINT] },
      ]);

      // ── 2. REAL synthesized env, via the REAL resolveEnvForLabel ──
      const env = await provider.resolveEnvForLabel(planned[0]!.label);
      expect(env).toBeDefined();
      expect(env?.IRIS_HOST).toBe(IRIS_HOST);
      expect(env?.IRIS_PORT).toBe(String(IRIS_PORT));
      expect(env?.IRIS_USERNAME).toBe(IRIS_USERNAME);
      expect(env?.IRIS_PASSWORD).toBe(IRIS_PASSWORD);
      expect(env?.IRIS_NAMESPACE).toBe(IRIS_NAMESPACE);
      expect(env?.ELECTRON_RUN_AS_NODE).toBe("1"); // 31-6-3

      const spawnEnv = toSpawnEnv(env!);

      // ── 3. Genuine child process + real MCP handshake ──
      const sdkClientIndex = pathToFileURL(path.join(sdkEsmDir!, "client", "index.js")).href;
      const sdkClientStdio = pathToFileURL(path.join(sdkEsmDir!, "client", "stdio.js")).href;
      const { Client } = (await import(sdkClientIndex)) as {
        Client: new (info: { name: string; version: string }) => {
          connect: (transport: unknown) => Promise<void>;
          close: () => Promise<void>;
          listTools: () => Promise<{ tools: { name: string }[] }>;
          callTool: (params: {
            name: string;
            arguments: Record<string, unknown>;
          }) => Promise<{ isError?: boolean; content: unknown[]; structuredContent?: unknown }>;
        };
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
        command: planned[0]!.command,
        args: planned[0]!.args,
        env: spawnEnv,
        stderr: "ignore",
      });

      const client = new Client({ name: "iris-mcp-launcher-integration-test", version: "0.0.0" });
      activeClient = client;

      await client.connect(transport);

      const { tools } = await client.listTools();
      // Deliberately NOT an exact count. `iris_dev` advertised 29 tools when
      // this was written (28 package-defined + the framework-provided
      // `iris_server_profiles` from `packages/shared/src/server-base.ts`), but
      // pinning that number here would couple this extension's suite to another
      // package's tool roster — and project rule #31 says a single new
      // FRAMEWORK tool moves the advertised count on EVERY server. This
      // extension is documented as depending on nothing in `packages/**`; a
      // `packages/**`-only change must not turn it red. What Integration AC
      // 31.6.8 actually requires is that `tools/list` works over the real
      // handshake and that the tool we go on to call is really advertised.
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((tool) => tool.name === "iris_server_info")).toBe(true);

      const result = await client.callTool({ name: "iris_server_info", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.structuredContent).toBeDefined();
    },
    { timeout: 30000 },
  );
});
