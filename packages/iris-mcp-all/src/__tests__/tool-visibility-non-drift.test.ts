/**
 * Story 30.2 QA e2e coverage (Epic 30, architecture decision I1) — cross-
 * package non-drift + defense-in-depth guarantees over REAL server
 * packages' tool/preset rosters. Complements
 * `packages/shared/src/__tests__/tool-visibility-surfacing.test.ts`, which
 * proves the same ACs with SYNTHETIC fixture tools; this file re-proves the
 * load-bearing guarantees against the ACTUAL built dist tool/preset rosters
 * (`iris-ops-mcp`, `iris-dev-mcp`) so a roster/registration bug in a real
 * package — invisible to synthetic fixtures — cannot slip through.
 *
 * `@iris-mcp/all` is the only package depending on all five server packages
 * (Rule #45), so real per-package tool/preset rosters can only be exercised
 * together with `@iris-mcp/shared`'s `McpServerBase` here, without
 * `@iris-mcp/shared` importing a leaf package (circular).
 *
 * Constructs a REAL `McpServerBase` from `@iris-mcp/shared`'s built dist per
 * {package × preset}, using each package's OWN built `tools`/`toolPresets`
 * (mirrors `measure-tools-payload.test.ts`'s dist-loading pattern). Requires
 * a prior `pnpm turbo run build`. `needsCustomRest` is omitted so `start()`
 * never calls `bootstrap()` — only the health-check (`HEAD`) + version-
 * negotiation (`GET`) fetch calls need mocking (mirrors
 * `tool-visibility-surfacing.test.ts`'s two-call `stageDefaultStartup`).
 *
 * No live IRIS. Default suite (`*.test.ts`, not `*.integration.test.ts` —
 * Rule 8 / the package's `vitest.config.ts` exclude).
 *
 * Covers:
 *   - No hidden-tool-NAME leak (AC 30.2.1) in the discovery tool's FULL
 *     serialized `CallToolResult` (not just `toolVisibility`'s counts) —
 *     under a real `core` preset AND a real `IRIS_TOOLS_DISABLE` config.
 *   - Tool↔resource non-drift invariant (AC 30.2.2, Dev Notes "one filter
 *     helper, both surfaces"): the governance key SET the discovery tool
 *     reports equals the key set the `iris-governance://{profile}` resource
 *     reports, for the same real package + preset.
 *   - Baseline-key omission (AC 30.2.2, the subtle union-survival case): a
 *     hidden tool's FROZEN BASELINE key (`iris_alerts_manage:reset`, real
 *     `GOVERNANCE_BASELINE` member) is absent from BOTH surfaces under
 *     `core` and present under `full`.
 *   - Counts correctness (Rule #34 second-package analog): `visibleTools +
 *     hiddenTools === package tool total + 1` (the reserved discovery
 *     tool) under every preset, for two different real packages.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const root = resolve(__dirname, "../../../..");

// ── Real built-dist loaders ─────────────────────────────────────────

interface ToolLike {
  name: string;
}

interface PackageFixture {
  name: string;
  version: string;
  tools: ToolLike[];
  toolPresets: unknown;
}

async function loadPackage(pkgDir: string): Promise<PackageFixture> {
  const pkgJsonRaw = await readFile(
    resolve(root, `packages/${pkgDir}/package.json`),
    "utf-8",
  );
  const pkgJson = JSON.parse(pkgJsonRaw) as { name: string; version: string };
  const toolsMod = (await import(
    pathToFileURL(resolve(root, `packages/${pkgDir}/dist/tools/index.js`)).href
  )) as { tools: ToolLike[] };
  const presetsMod = (await import(
    pathToFileURL(resolve(root, `packages/${pkgDir}/dist/tools/presets.js`)).href
  )) as { toolPresets: unknown };
  return {
    name: pkgJson.name,
    version: pkgJson.version,
    tools: toolsMod.tools,
    toolPresets: presetsMod.toolPresets,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadShared(): Promise<any> {
  return import(
    pathToFileURL(resolve(root, "packages/shared/dist/index.js")).href
  );
}

// ── Mocked-startup harness (mirrors tool-visibility-surfacing.test.ts) ──

function versionResponse(): Response {
  return new Response(
    JSON.stringify({
      status: { errors: [] },
      console: [],
      result: { version: "8.0.0" },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const ENV_KEYS = [
  "IRIS_USERNAME",
  "IRIS_PASSWORD",
  "IRIS_HOST",
  "IRIS_NAMESPACE",
  "IRIS_PROFILES",
  "IRIS_GOVERNANCE",
  "IRIS_TOOLS_PRESET",
  "IRIS_TOOLS_DISABLE",
  "IRIS_TOOLS_ENABLE",
] as const;

let savedEnv: Record<string, string | undefined> = {};
let originalFetch: typeof fetch;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createdServers: any[] = [];

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.IRIS_USERNAME = "u";
  process.env.IRIS_PASSWORD = "supersecret";
  process.env.IRIS_HOST = "default.example.com";
  process.env.IRIS_NAMESPACE = "DEFAULTNS";
  originalFetch = globalThis.fetch;
  createdServers = [];
});

afterEach(async () => {
  // Close every server's transport started by this test (hygiene: avoids
  // accumulating stdio listeners across the ~11 servers this file starts,
  // which otherwise trips Node's MaxListenersExceededWarning noise).
  for (const server of createdServers) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (server as any).stop?.();
  }
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

/** `full`, `core`, or `developer` — mirrors measure-tools-payload-core.mjs's env convention. */
function setPreset(preset: "full" | "core" | "developer"): void {
  if (preset === "full") delete process.env.IRIS_TOOLS_PRESET;
  else process.env.IRIS_TOOLS_PRESET = preset;
}

/**
 * Construct a REAL `McpServerBase` (from the built shared dist) for the given
 * package fixture and start it — mocking only the two fetch calls `start()`
 * makes for the default profile (`needsCustomRest` is omitted, so
 * `bootstrap()` is never invoked). No live IRIS required.
 */
async function startRealServer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  McpServerBaseCtor: any,
  pkg: PackageFixture,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  let call = 0;
  const fetchMock = vi.fn(async () => {
    call += 1;
    return call === 1 ? new Response(null, { status: 200 }) : versionResponse();
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const server = new McpServerBaseCtor({
    name: pkg.name,
    version: pkg.version,
    tools: pkg.tools,
    toolPresets: pkg.toolPresets,
  });
  await server.start("stdio");
  createdServers.push(server);
  return server;
}

/** Invoke a tool through the SDK-registered callback (mirrors the shared harness). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  const entry = sdkTools[name];
  const callback = entry.callback ?? entry.handler ?? entry.cb;
  return callback(args);
}

/** Invoke a request handler on the underlying Server by method name (real wire). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callRequest(server: any, method: string, params: unknown) {
  const innerServer = server.server.server;
  const handlers = innerServer._requestHandlers as Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: any, extra: any) => Promise<any>
  >;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`No request handler for "${method}"`);
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return handler({ method, params }, extra);
}

/** Count the tools actually advertised on the REAL `tools/list` wire (follows pagination). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function wireToolCount(server: any): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  do {
    // eslint-disable-next-line no-await-in-loop
    const result = await callRequest(server, "tools/list", cursor ? { cursor } : {});
    count += (result.tools as unknown[]).length;
    cursor = result.nextCursor as string | undefined;
  } while (cursor);
  return count;
}

/** Read a governance resource URI and parse its flat JSON policy map. */
async function readGovernancePolicy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any,
  profile = "default",
): Promise<Record<string, boolean>> {
  const result = await callRequest(server, "resources/read", {
    uri: `iris-governance://${profile}`,
  });
  const contents = result.contents as Array<{ text: string }>;
  return JSON.parse(contents[0]!.text) as Record<string, boolean>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function discoveryOf(result: any): {
  toolVisibility: { preset: string; visibleTools: number; hiddenTools: number };
  governance: { policy?: Record<string, boolean> };
} {
  return result.structuredContent;
}

// ════════════════════════════════════════════════════════════════════
// No hidden-tool-NAME leak, over a REAL package's core roster + a REAL
// IRIS_TOOLS_DISABLE config (AC 30.2.1 defense-in-depth).
// ════════════════════════════════════════════════════════════════════

describe("QA e2e — no hidden tool name leaks anywhere in the discovery result (real iris-ops-mcp roster)", () => {
  it("under the real core preset: every excluded tool's NAME is absent from the full serialized discovery CallToolResult", async () => {
    const pkg = await loadPackage("iris-ops-mcp");
    const shared = await loadShared();
    const rosters = pkg.toolPresets as {
      core: { include: string[]; exclude: string[] };
    };
    // Ground truth for "hidden under core" comes from the package's OWN real
    // roster — not a hand-copied list — so this test tracks the roster if it
    // ever changes.
    const hiddenNames = rosters.core.exclude;
    expect(hiddenNames.length).toBeGreaterThan(0); // sanity: core really hides something

    setPreset("core");
    const server = await startRealServer(shared.McpServerBase, pkg);
    const result = await callTool(server, shared.SERVER_DISCOVERY_TOOL_NAME);
    const discovery = discoveryOf(result);

    // Counts must reflect the real roster...
    expect(discovery.toolVisibility.preset).toBe("core");
    expect(discovery.toolVisibility.hiddenTools).toBe(hiddenNames.length);

    // ...but the FULL serialized CallToolResult (content + structuredContent
    // together) must never mention any hidden tool's NAME anywhere — not
    // just absent from a "names" field, but absent as a substring anywhere
    // in the payload (profile roster, governance policy keys, counts JSON).
    const fullSerialized = JSON.stringify(result);
    for (const hiddenName of hiddenNames) {
      expect(fullSerialized).not.toContain(hiddenName);
    }
  });

  it("under a real IRIS_TOOLS_DISABLE config (no named preset): the disabled tool's NAME is absent from the full serialized discovery CallToolResult", async () => {
    const pkg = await loadPackage("iris-ops-mcp");
    const shared = await loadShared();
    const disabledTool = "iris_alerts_manage"; // a real, real-hidden-under-core ops tool

    process.env.IRIS_TOOLS_DISABLE = disabledTool;
    const server = await startRealServer(shared.McpServerBase, pkg);
    const result = await callTool(server, shared.SERVER_DISCOVERY_TOOL_NAME);
    const discovery = discoveryOf(result);

    expect(discovery.toolVisibility.preset).toBe("full");
    expect(discovery.toolVisibility.hiddenTools).toBe(1);

    const fullSerialized = JSON.stringify(result);
    expect(fullSerialized).not.toContain(disabledTool);
  });
});

// ════════════════════════════════════════════════════════════════════
// Tool ↔ resource non-drift invariant (AC 30.2.2).
// ════════════════════════════════════════════════════════════════════

describe("QA e2e — discovery tool and iris-governance:// resource report the IDENTICAL governance key set (real rosters)", () => {
  it.each([
    { pkgDir: "iris-ops-mcp", preset: "core" as const },
    { pkgDir: "iris-dev-mcp", preset: "core" as const },
    { pkgDir: "iris-ops-mcp", preset: "developer" as const },
  ])(
    "$pkgDir under $preset: discovery governance.policy keys === resource policy keys",
    async ({ pkgDir, preset }) => {
      const pkg = await loadPackage(pkgDir);
      const shared = await loadShared();

      setPreset(preset);
      const server = await startRealServer(shared.McpServerBase, pkg);

      const discoveryResult = await callTool(server, shared.SERVER_DISCOVERY_TOOL_NAME);
      const discovery = discoveryOf(discoveryResult);
      const discoveryKeys = new Set(Object.keys(discovery.governance.policy ?? {}));

      const resourcePolicy = await readGovernancePolicy(server, "default");
      const resourceKeys = new Set(Object.keys(resourcePolicy));

      // A test that would FAIL the moment the two surfaces ever diverged: not
      // merely "same size" (which a swapped-but-same-count key pair would
      // pass) but the exact same MEMBER set, both directions.
      expect(discoveryKeys.size).toBeGreaterThan(0); // sanity: non-trivial key universe
      for (const key of discoveryKeys) expect(resourceKeys.has(key)).toBe(true);
      for (const key of resourceKeys) expect(discoveryKeys.has(key)).toBe(true);
      expect(discoveryKeys.size).toBe(resourceKeys.size);
    },
  );
});

// ════════════════════════════════════════════════════════════════════
// Baseline-key omission — the subtle union-survival case (AC 30.2.2).
// ════════════════════════════════════════════════════════════════════

describe("QA e2e — a hidden tool's FROZEN BASELINE key is omitted from both surfaces under core, present under full (real iris-ops-mcp)", () => {
  const HIDDEN_TOOL = "iris_alerts_manage"; // real ops tool, excluded from BOTH core and developer rosters
  const HIDDEN_KEY = "iris_alerts_manage:reset"; // real GOVERNANCE_BASELINE member

  it("baseline sanity: the key really is a frozen GOVERNANCE_BASELINE member, and the tool really is excluded from core", async () => {
    const shared = await loadShared();
    const pkg = await loadPackage("iris-ops-mcp");
    const rosters = pkg.toolPresets as { core: { exclude: string[] } };
    expect(shared.GOVERNANCE_BASELINE.has(HIDDEN_KEY)).toBe(true);
    expect(rosters.core.exclude).toContain(HIDDEN_TOOL);
  });

  it("absent from both the discovery report and the resource under core; present under full", async () => {
    const pkg = await loadPackage("iris-ops-mcp");
    const shared = await loadShared();

    // core: hidden.
    setPreset("core");
    const coreServer = await startRealServer(shared.McpServerBase, pkg);
    const coreDiscovery = discoveryOf(
      await callTool(coreServer, shared.SERVER_DISCOVERY_TOOL_NAME),
    );
    expect(
      Object.prototype.hasOwnProperty.call(coreDiscovery.governance.policy, HIDDEN_KEY),
    ).toBe(false);
    const corePolicy = await readGovernancePolicy(coreServer, "default");
    expect(Object.prototype.hasOwnProperty.call(corePolicy, HIDDEN_KEY)).toBe(false);

    // full (same package, same tool, default preset): present in both.
    setPreset("full");
    const fullServer = await startRealServer(shared.McpServerBase, pkg);
    const fullDiscovery = discoveryOf(
      await callTool(fullServer, shared.SERVER_DISCOVERY_TOOL_NAME),
    );
    expect(
      Object.prototype.hasOwnProperty.call(fullDiscovery.governance.policy, HIDDEN_KEY),
    ).toBe(true);
    const fullPolicy = await readGovernancePolicy(fullServer, "default");
    expect(Object.prototype.hasOwnProperty.call(fullPolicy, HIDDEN_KEY)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// Counts correctness across two real packages × every preset (Rule #34
// second-config analog).
// ════════════════════════════════════════════════════════════════════

describe("QA e2e — visibleTools + hiddenTools === package tool total + 1 (reserved), every preset, two real packages", () => {
  it.each([
    { pkgDir: "iris-ops-mcp", preset: "full" as const },
    { pkgDir: "iris-ops-mcp", preset: "core" as const },
    { pkgDir: "iris-ops-mcp", preset: "developer" as const },
    { pkgDir: "iris-dev-mcp", preset: "full" as const },
    { pkgDir: "iris-dev-mcp", preset: "core" as const },
    { pkgDir: "iris-dev-mcp", preset: "developer" as const },
  ])("$pkgDir under $preset", async ({ pkgDir, preset }) => {
    const pkg = await loadPackage(pkgDir);
    const shared = await loadShared();

    setPreset(preset);
    const server = await startRealServer(shared.McpServerBase, pkg);
    const discovery = discoveryOf(await callTool(server, shared.SERVER_DISCOVERY_TOOL_NAME));

    // Reality oracle (Rule #36): visibleTools must equal what the server
    // ACTUALLY advertises on the real tools/list wire — an INDEPENDENT code
    // path (the SDK registry) from the constructor's count. This is the check
    // that actually catches a wrong visible/hidden SPLIT; the sum invariant
    // below is algebraically guaranteed by the constructor and would pass even
    // if every tool were mis-hidden.
    const advertised = await wireToolCount(server);

    // Expected hidden count derived from the package's OWN real roster (ground
    // truth, not a hand-copied number): 0 under `full`; the preset's `exclude`
    // list size under a named preset (no DISABLE/ENABLE env is set here, so the
    // roster is the sole source of hiding).
    const rosters = pkg.toolPresets as Record<string, { exclude: string[] }>;
    const expectedHidden = preset === "full" ? 0 : rosters[preset]!.exclude.length;

    expect(discovery.toolVisibility.preset).toBe(preset);
    // The split is genuinely verified against two independent sources of truth.
    expect(discovery.toolVisibility.visibleTools).toBe(advertised);
    expect(discovery.toolVisibility.hiddenTools).toBe(expectedHidden);
    // Secondary invariant (kept for documentation; guaranteed by construction).
    expect(
      discovery.toolVisibility.visibleTools + discovery.toolVisibility.hiddenTools,
    ).toBe(pkg.tools.length + 1);
  });
});
