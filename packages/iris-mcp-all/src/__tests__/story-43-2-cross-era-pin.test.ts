/**
 * Story 43.2 (AC 43.2.1, 43.2.2, 43.2.2a; AD-15, AD-32; Rules #10, #19, #36, #46, #59) - every surface of the five BUILT servers is the
 * same on the 2025-11-25 era and on revision 2026-07-28, apart from the fields the revision mandates.
 *
 * The 2025-11-25 era is the frozen golden of Story 43.1 (`fixtures/sdk-wire-golden.json`, captured from the SDK v1 build and never edited).
 * The 2026-07-28 era is observed three ways against the same built server entry points, all started against 127.0.0.1:1, a closed local
 * port, so no IRIS instance is reached:
 *  - (a) the raw driver (`scripts/lib/sdk-wire-golden-core.mjs`) opens each golden session with `server/discover`, sends each golden
 *    request with the per-request envelope, and compares each response LINE with the golden's, byte for byte, once
 *    `withoutMandatedFields` has removed the live line's mandated fields and `withoutExecution` the golden's `execution`, with the
 *    JSON-RPC `id` substituted. Those six differences are the whole ignore list (wave-8 decision #7, `MANDATED_MODERN_FIELDS`);
 *  - (b) the values of the fields that the revision adds are pinned separately, so ignoring them in (a) hides nothing;
 *  - (c) `server/discover` carries the golden `initialize` result's `capabilities` and `instructions`;
 *  - (d) a `server/discover` probe followed by an `initialize` on one connection discards the probe, and the instance the factory builds
 *    next answers the golden `main` and `newer-era` rows byte for byte;
 *  - (e) real SDK v2 clients on `{ pin: "2026-07-28" }` and on `auto` make the golden `main` calls (`getPrompt({ name })` with no
 *    `arguments` key, Rule #46), and what they see equals what a legacy client sees once `_meta`, `ttlMs`, `cacheScope` and the legacy
 *    `execution` are removed;
 *  - (f) the SDK's own refusals on the modern era carry their codes, and (g) a modern session ends when its stdin does.
 *
 * The file fails, never skips, when the client is not installed or a dist is missing or older than its source (Rule #59).
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import {
  CLOSED_PORT_ENV,
  GOLDEN_PACKAGES,
  GOLDEN_RELATIVE_PATH,
  MODERN_ERA,
  NEWER_ERA_REQUEST,
  SERVER_INFO_META_KEY,
  WIRE_ERA,
  discoverHandshake,
  goldenSessions,
  inheritedGoldenEnv,
  mandatedFieldProblems,
  modernEnvelope,
  openRawWire,
  packageVersion,
  runModernGoldenSession,
  runProbeDiscardSession,
  withEnvelope,
  withoutExecution,
  withoutMandatedFields,
} from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { connectSdkClient, distEntry, resolveSdkEsmDir, staleDistReason, type IrisTarget, type SdkClient, type SdkVersionNegotiation } from "./process-gate-helpers.js";

interface GoldenRow {
  label: string;
  method: string;
  params?: Record<string, unknown>;
  dw617Of?: string;
  line: string;
}

interface Golden {
  servers: Record<string, { sessions: Record<string, { rows: GoldenRow[] }> }>;
}

interface LiveRow {
  label: string;
  method: string;
  params?: Record<string, unknown>;
  dw617Of?: string;
  line: string;
}

/** What a client call came to: the parsed result, or the error code and message the rejection carries. */
type Outcome = { kind: "result"; value: unknown } | { kind: "error"; code: unknown; message: string };

/** Everything one SDK client session observed. */
interface ClientView {
  era: string | undefined;
  negotiated: string | undefined;
  hasDiscoverResult: boolean;
  instructions: string | undefined;
  capabilities: unknown;
  serverVersion: unknown;
  outcomes: Map<string, Outcome>;
  stderr: string;
}

const golden = JSON.parse(readFileSync(path.join(REPO_ROOT, GOLDEN_RELATIVE_PATH), "utf8")) as Golden;
const CLOSED_TARGET: IrisTarget = { host: "127.0.0.1", port: "1", username: "qa", password: "qa", namespace: "HSCUSTOM" };

const MODERN_ERA_LINE = "[INFO] Serving MCP protocol revision 2026-07-28 (server/discover)";
const LEGACY_ERA_LINE = "[INFO] Serving the 2025-era MCP handshake (initialize)";
const EXIT_WITHIN_MS = 3_000;

const manifestVersion = (pkg: string): string => packageVersion(REPO_ROOT, pkg);
const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

/** A response line re-serialized with its JSON-RPC `id` set to 0, for comparing two responses to different requests. */
const withIdZero = (message: unknown): string => JSON.stringify({ ...(message as Record<string, unknown>), id: 0 });

/**
 * A response line with its JSON-RPC `id` set to 0 and every other byte as written. The id follows `jsonrpc` at the start of an error frame
 * and ends a result frame.
 */
const rawWithIdZero = (line: string): string =>
  line.replace(/^\{"jsonrpc":"2\.0","id":\d+,/, '{"jsonrpc":"2.0","id":0,').replace(/"id":\d+\}$/, '"id":0}');

/** The server's log level in every child: the era line is an INFO line, and a developer shell may set a stricter `LOG_LEVEL`. */
const SERVER_LOG_LEVEL = "INFO";

/** An `initialize` line with its `serverInfo.version` set to the manifest's version and every other byte as captured. */
function withManifestVersion(pkg: string, line: string): string {
  return line.replace(/("serverInfo":\{"name":"[^"]*","version":")[^"]*(")/, `$1${manifestVersion(pkg)}$2`);
}

/** The rows of a recorded golden session. */
function goldenRows(pkg: string, session: string): GoldenRow[] {
  return golden.servers[pkg]?.sessions[session]?.rows ?? [];
}

/** The `serverInfo` of the golden `initialize` result, with the version a release changes set to the manifest's. */
function goldenServerInfo(pkg: string): unknown {
  const init = JSON.parse(goldenRows(pkg, "main")[0]!.line) as { result: { serverInfo: Record<string, unknown> } };
  return { ...init.result.serverInfo, version: manifestVersion(pkg) };
}

/** Fail, rather than skip, when the client is not installed or a dist the gate runs is missing or stale. */
function prerequisites(): string {
  const sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
  if (!sdkEsmDir) throw new Error("Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install.");
  const stale = ["shared", ...GOLDEN_PACKAGES]
    .map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const)
    .filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);
  return sdkEsmDir;
}

/** Make one call of a golden row through the SDK client, as a client of that method would. */
async function callThroughClient(client: SdkClient, row: GoldenRow): Promise<Outcome> {
  try {
    const params = (row.params ?? {}) as Record<string, unknown>;
    switch (row.method) {
      case "tools/list":
        return { kind: "result", value: await client.listTools() };
      case "tools/call":
        return { kind: "result", value: await client.callTool(params as { name: string; arguments?: Record<string, unknown> }) };
      case "prompts/list":
        return { kind: "result", value: await client.listPrompts() };
      case "prompts/get":
        return { kind: "result", value: await client.getPrompt(params as { name: string; arguments?: Record<string, string> }) };
      case "resources/list":
        return { kind: "result", value: await client.listResources() };
      case "resources/templates/list":
        return { kind: "result", value: await client.listResourceTemplates() };
      case "resources/read":
        return { kind: "result", value: await client.readResource(params as { uri: string }) };
      default:
        throw new Error(`no client call is mapped to ${row.method}`);
    }
  } catch (error) {
    const failure = error as { code?: unknown; message?: string };
    return { kind: "error", code: failure.code, message: String(failure.message) };
  }
}

/**
 * A client outcome without what the 2026-07-28 revision mandates at the top of a result (`_meta`, `ttlMs`, `cacheScope`) and without the
 * `execution` of a legacy tool entry, so a legacy and a modern view of the same surface compare with `toEqual`.
 */
function comparable(outcome: Outcome): Outcome {
  if (outcome.kind === "error" || outcome.value === null || typeof outcome.value !== "object") return outcome;
  const value = { ...(outcome.value as Record<string, unknown>) };
  delete value._meta;
  delete value.ttlMs;
  delete value.cacheScope;
  if (Array.isArray(value.tools)) {
    value.tools = (value.tools as Array<Record<string, unknown>>).map((tool) => {
      const copy = { ...tool };
      delete copy.execution;
      return copy;
    });
  }
  return { kind: "result", value };
}

/** Connect an SDK client in `versionNegotiation`, make every golden `main` call through it, and record what it saw. */
async function viewThroughClient(sdkEsmDir: string, pkg: string, versionNegotiation: SdkVersionNegotiation): Promise<ClientView> {
  let stderr = "";
  const client = await connectSdkClient(
    {
      sdkEsmDir,
      entry: distEntry(REPO_ROOT, pkg),
      target: CLOSED_TARGET,
      clientName: "story-43-2-cross-era-pin",
      versionNegotiation,
      onStderr: (chunk) => {
        stderr += chunk;
      },
    },
    { LOG_LEVEL: SERVER_LOG_LEVEL },
  );
  try {
    const outcomes = new Map<string, Outcome>();
    for (const row of goldenRows(pkg, "main")) {
      if (row.label === "initialize") continue;
      outcomes.set(row.label, await callThroughClient(client, row));
    }
    return {
      era: client.getProtocolEra(),
      negotiated: client.getNegotiatedProtocolVersion(),
      hasDiscoverResult: client.getDiscoverResult() !== undefined,
      instructions: client.getInstructions(),
      capabilities: client.getServerCapabilities(),
      serverVersion: client.getServerVersion(),
      outcomes,
      stderr,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

describe.each(GOLDEN_PACKAGES)("cross-era pin: %s", (pkg) => {
  const baseEnv = { ...inheritedGoldenEnv(process.env), LOG_LEVEL: SERVER_LOG_LEVEL };
  const sessions = goldenSessions(pkg);
  const modern = new Map<string, { rows: LiveRow[]; stderr: string }>();
  const discarded = new Map<string, { rows: LiveRow[]; stderr: string }>();
  const views = new Map<string, ClientView>();
  let missingEnvelope: { code?: number; message?: string } | undefined;
  let legacyOnModern: { code?: number; message?: string } | undefined;
  let modernExit: { code: number | null; signal: string | null } | "still running" | undefined;
  let modernExitStderr = "";

  beforeAll(async () => {
    const sdkEsmDir = prerequisites();
    const entry = distEntry(REPO_ROOT, pkg);

    for (const session of sessions) {
      if (session.exchanges.length > 0) modern.set(session.id, await runModernGoldenSession({ entry, baseEnv, session }));
      if (session.id === "main" || session.id === "newer-era") {
        discarded.set(session.id, await runProbeDiscardSession({ entry, baseEnv, session }));
      }
    }

    views.set("legacy", await viewThroughClient(sdkEsmDir, pkg, { mode: "legacy" }));
    views.set("pin", await viewThroughClient(sdkEsmDir, pkg, { mode: { pin: MODERN_ERA } }));
    views.set("auto", await viewThroughClient(sdkEsmDir, pkg, { mode: "auto" }));

    const envelope = modernEnvelope("story-43-2-cross-era-pin");
    const refusals = openRawWire({ entry, env: { ...baseEnv, ...CLOSED_PORT_ENV } });
    try {
      await discoverHandshake(refusals, "story-43-2-cross-era-pin");
      // A first request that is not `server/discover` pins the connection to the modern era.
      await refusals.request("tools/list", withEnvelope({}, envelope));
      missingEnvelope = (await refusals.requestFrame({ method: "tools/list" })).message.error;
      legacyOnModern = (
        await refusals.request("initialize", { protocolVersion: WIRE_ERA, capabilities: {}, clientInfo: { name: "story-43-2-cross-era-pin", version: "0.0.0" } })
      ).message.error;
    } finally {
      await refusals.close();
    }

    const lifecycle = openRawWire({ entry, env: { ...baseEnv, ...CLOSED_PORT_ENV } });
    try {
      await discoverHandshake(lifecycle, "story-43-2-cross-era-pin");
      await lifecycle.request("tools/list", withEnvelope({}, envelope));
      lifecycle.endInput();
      modernExit = await Promise.race([
        lifecycle.exit(),
        new Promise<"still running">((resolve) => setTimeout(() => resolve("still running"), EXIT_WITHIN_MS)),
      ]);
      modernExitStderr = lifecycle.stderr();
    } finally {
      await lifecycle.close();
    }
  }, 300_000);

  describe("(a) the modern wire is the frozen golden plus the mandated fields", () => {
    const sessionIds = goldenSessions(pkg)
      .filter((session) => session.exchanges.length > 0)
      .map((session) => session.id);

    for (const sessionId of sessionIds) {
      it(`session ${sessionId}: every response line equals the golden's once the mandated fields are removed`, () => {
        const live = modern.get(sessionId)?.rows ?? [];
        const recorded = goldenRows(pkg, sessionId).filter((row) => row.label !== "initialize");
        expect(live.slice(1).map((row) => row.label)).toEqual(recorded.map((row) => row.label));
        for (const row of recorded) {
          const seen = live.find((candidate) => candidate.label === row.label)!;
          const expectedLine = row.dw617Of ? recorded.find((candidate) => candidate.label === row.dw617Of)!.line : row.line;
          const now = withoutMandatedFields(row.method, JSON.parse(seen.line));
          const then = withoutExecution(JSON.parse(expectedLine));
          expect(withIdZero(now), `${sessionId}/${row.label}`).toBe(withIdZero(then));
        }
      });
    }

    it("tools/list entries have lost exactly their execution member, and the order of tools and of members is the golden's", () => {
      const live = JSON.parse(modern.get("main")!.rows.find((row) => row.label === "tools-list")!.line) as { result: { tools: Array<Record<string, unknown>> } };
      const recorded = JSON.parse(goldenRows(pkg, "main").find((row) => row.label === "tools-list")!.line) as { result: { tools: Array<Record<string, unknown>> } };
      expect(live.result.tools.map((tool) => tool.name)).toEqual(recorded.result.tools.map((tool) => tool.name));
      for (const [index, tool] of live.result.tools.entries()) {
        expect(Object.keys(tool), String(tool.name)).toEqual(Object.keys(recorded.result.tools[index]!).filter((key) => key !== "execution"));
      }
      expect(recorded.result.tools.every((tool) => tool.execution !== undefined)).toBe(true);
    });
  });

  describe("(b) the mandated fields carry their pinned values", () => {
    for (const sessionId of goldenSessions(pkg).filter((session) => session.exchanges.length > 0).map((session) => session.id)) {
      it(`session ${sessionId}: every result carries resultType, the cache hints of a cacheable method, and the initialize serverInfo`, () => {
        const rows = modern.get(sessionId)?.rows ?? [];
        let results = 0;
        for (const row of rows) {
          const parsed = JSON.parse(row.line) as { result?: unknown; error?: unknown };
          if (parsed.result !== undefined) results += 1;
          expect(mandatedFieldProblems(row.method, parsed, goldenServerInfo(pkg)), `${sessionId}/${row.label}`).toEqual([]);
        }
        expect(results, "the session holds results to check").toBeGreaterThanOrEqual(3);
      });
    }

    it("a tools/call result carries resultType and the serverInfo stamp but no cache hints", () => {
      const calls = (modern.get("main")?.rows ?? []).filter((row) => row.method === "tools/call");
      expect(calls.length).toBeGreaterThan(0);
      const answered = calls.map((row) => (JSON.parse(row.line) as { result?: Record<string, unknown> }).result).filter((result) => result !== undefined);
      expect(answered.length).toBeGreaterThan(0);
      for (const result of answered) {
        expect(result!.resultType).toBe("complete");
        expect("ttlMs" in result! || "cacheScope" in result!).toBe(false);
        expect((result!._meta as Record<string, unknown>)[SERVER_INFO_META_KEY]).toEqual(goldenServerInfo(pkg));
      }
    });
  });

  describe("(c) server/discover carries what initialize did", () => {
    it("has the golden capabilities and instructions, supportedVersions in place of protocolVersion, and no top-level serverInfo", () => {
      const discovered = JSON.parse(modern.get("main")!.rows[0]!.line) as { result: Record<string, unknown> };
      const init = JSON.parse(goldenRows(pkg, "main")[0]!.line) as { result: { capabilities: unknown; instructions: string } };
      expect(discovered.result.supportedVersions).toEqual([MODERN_ERA]);
      expect(JSON.stringify(discovered.result.capabilities)).toBe(JSON.stringify(init.result.capabilities));
      expect(discovered.result.instructions).toBe(init.result.instructions);
      expect(discovered.result.protocolVersion).toBeUndefined();
      expect(discovered.result.serverInfo).toBeUndefined();
      const stripped = withoutMandatedFields("server/discover", discovered) as { result: Record<string, unknown> };
      expect(Object.keys(stripped.result).sort()).toEqual(["capabilities", "instructions", "supportedVersions"]);
      expect((discovered.result._meta as Record<string, unknown>)[SERVER_INFO_META_KEY]).toEqual(goldenServerInfo(pkg));
    });
  });

  describe("(d) a discarded probe leaves the 2025 era byte-identical", () => {
    it("main: after a server/discover opening, initialize and every golden exchange answer the golden lines", () => {
      const live = discarded.get("main")?.rows ?? [];
      const recorded = goldenRows(pkg, "main");
      expect(live.map((row) => row.label)).toEqual(recorded.map((row) => row.label));
      for (const row of recorded) {
        const seen = live.find((candidate) => candidate.label === row.label)!;
        const goldenLine = row.dw617Of ? recorded.find((candidate) => candidate.label === row.dw617Of)!.line : row.line;
        const expectedLine = row.label === "initialize" ? withManifestVersion(pkg, goldenLine) : goldenLine;
        expect(rawWithIdZero(seen.line), row.label).toBe(rawWithIdZero(expectedLine));
      }
    });

    it("newer-era: after a server/discover opening, an initialize asking 2026-07-28 without the envelope is answered with 2025-11-25, as the golden says", () => {
      const live = discarded.get("newer-era")?.rows ?? [];
      const recorded = goldenRows(pkg, "newer-era");
      expect(live).toHaveLength(1);
      expect(rawWithIdZero(live[0]!.line)).toBe(rawWithIdZero(withManifestVersion(pkg, recorded[0]!.line)));
      expect((JSON.parse(live[0]!.line) as { result: { protocolVersion: string } }).result.protocolVersion).toBe(WIRE_ERA);
      expect(NEWER_ERA_REQUEST).toBe(MODERN_ERA);
    });

    it("the factory runs twice on that path, once for the probe and once for the 2025 instance, and the era lines say so", () => {
      for (const sessionId of ["main", "newer-era"]) {
        const stderr = discarded.get(sessionId)?.stderr ?? "";
        expect(countOf(stderr, MODERN_ERA_LINE), sessionId).toBe(1);
        expect(countOf(stderr, LEGACY_ERA_LINE), sessionId).toBe(1);
        expect(stderr.indexOf(MODERN_ERA_LINE), sessionId).toBeLessThan(stderr.indexOf(LEGACY_ERA_LINE));
      }
    });

    it("a plain modern session runs the factory once", () => {
      const modernStderr = modern.get("main")?.stderr ?? "";
      expect(countOf(modernStderr, MODERN_ERA_LINE)).toBe(1);
      expect(countOf(modernStderr, LEGACY_ERA_LINE)).toBe(0);
    });
  });

  describe("(e) SDK clients on the modern era see what a legacy client sees", () => {
    it.each(["pin", "auto"])("%s: negotiates 2026-07-28 with a discover result, and one factory call writes one era line", (mode) => {
      const view = views.get(mode)!;
      expect(view.era).toBe("modern");
      expect(view.negotiated).toBe(MODERN_ERA);
      expect(view.hasDiscoverResult).toBe(true);
      expect(countOf(view.stderr, MODERN_ERA_LINE)).toBe(1);
      expect(countOf(view.stderr, LEGACY_ERA_LINE)).toBe(0);
    });

    it("legacy: negotiates 2025-11-25 and writes the 2025 era line", () => {
      const view = views.get("legacy")!;
      expect(view.era).toBe("legacy");
      expect(view.negotiated).toBe(WIRE_ERA);
      expect(view.hasDiscoverResult).toBe(false);
      expect(countOf(view.stderr, LEGACY_ERA_LINE)).toBe(1);
      expect(countOf(view.stderr, MODERN_ERA_LINE)).toBe(0);
    });

    it.each(["pin", "auto"])("%s: instructions, capabilities and server version equal the legacy client's", (mode) => {
      const legacy = views.get("legacy")!;
      const view = views.get(mode)!;
      expect(view.instructions).toBe(legacy.instructions);
      expect(view.capabilities).toEqual(legacy.capabilities);
      expect(view.serverVersion).toEqual(legacy.serverVersion);
      expect(view.serverVersion).toEqual(goldenServerInfo(pkg));
    });

    it.each(["pin", "auto"])("%s: every golden main call comes to what the legacy client saw", (mode) => {
      const legacy = views.get("legacy")!;
      const view = views.get(mode)!;
      expect([...view.outcomes.keys()]).toEqual([...legacy.outcomes.keys()]);
      for (const [label, outcome] of legacy.outcomes) {
        expect(comparable(view.outcomes.get(label)!), label).toEqual(comparable(outcome));
      }
    });

    it("the legacy client's calls reach the server: the tools list is the golden's, the profiles call is not an error, and no call is left unmapped", () => {
      const legacy = views.get("legacy")!;
      const listed = legacy.outcomes.get("tools-list");
      expect(listed?.kind).toBe("result");
      const goldenTools = (JSON.parse(goldenRows(pkg, "main").find((row) => row.label === "tools-list")!.line) as { result: { tools: unknown[] } }).result.tools;
      expect((listed as { value: { tools: unknown[] } }).value.tools).toHaveLength(goldenTools.length);
      const profiles = legacy.outcomes.get("call:server-profiles");
      expect(profiles?.kind).toBe("result");
      expect((profiles as { value: { isError?: boolean } }).value.isError).not.toBe(true);
      for (const [label, outcome] of legacy.outcomes) {
        if (outcome.kind === "error") expect(outcome.message, label).not.toMatch(/no client call is mapped/);
      }
    });

    it("the calls cover profiles, an unknown tool, a schema-invalid call, the closed read, prompts, a prompt with no arguments key, and resources", () => {
      const labels = [...views.get("legacy")!.outcomes.keys()];
      for (const wanted of ["call:server-profiles", "call:unknown-tool", "call:invalid-type", "call:closed-read", "prompts-list", "resources-list", "resources-templates-list", "resources-read:default"]) {
        expect(labels, wanted).toContain(wanted);
      }
      expect(labels.some((label) => label.startsWith("prompts-get:omitted:")) || pkg === "iris-data-mcp").toBe(true);
    });
  });

  describe("(f) the SDK's own refusals on the modern era", () => {
    it("a request without the envelope on a modern connection is -32602", () => {
      expect(missingEnvelope?.code).toBe(-32602);
      expect(missingEnvelope?.message).toMatch(/^Request is missing the required _meta envelope/);
    });

    it("a 2025 initialize on a modern connection is -32022", () => {
      expect(legacyOnModern?.code).toBe(-32022);
      expect(legacyOnModern?.message).toBe(`Unsupported protocol version: ${WIRE_ERA}`);
    });
  });

  describe("(g) the modern era ends with the client's stdin", () => {
    it("exits with code 0 by itself within 3 s of the close, after serving a modern call", () => {
      expect(modernExit, `still running ${EXIT_WITHIN_MS} ms after its stdin was closed; stderr: ${modernExitStderr.slice(-400)}`).toEqual({ code: 0, signal: null });
      expect(modernExitStderr).not.toContain("Fatal");
    });
  });
});
