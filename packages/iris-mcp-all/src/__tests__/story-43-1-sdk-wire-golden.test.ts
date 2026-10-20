/**
 * Story 43.1 (AC 43.1.3, AD-15, AD-32; Rules #19, #36, #46, #59) - the 2025-11-25 wire of the five BUILT servers,
 * pinned to the golden that `scripts/capture-sdk-wire-golden.mjs` captured from the SDK v1 build before the migration.
 *
 * Each server's sessions run twice, each view independent of the other:
 *  - the raw driver (`scripts/lib/sdk-wire-golden-core.mjs`, no SDK) writes the golden's requests and compares each
 *    response LINE byte for byte, so key order, spacing and error text are all pinned;
 *  - a real SDK v2 `Client` (legacy negotiation) makes the same calls over stdio, and its parsed results and errors
 *    must equal the golden's. `getPrompt({ name })` is sent with NO `arguments` key (Rule #46).
 *
 * The DW-617 rows are the one sanctioned exception: an omitted-`arguments` `prompts/get` must equal the same prompt's
 * `arguments: {}` response (ids aside), where the v1 build refused it. The `initialize` rows compare `serverInfo.version`
 * with the package manifest's version, which a release changes; every other byte of them is as captured.
 *
 * The file fails, never skips, when the client is not installed or a dist is missing or older than its source (Rule #59).
 * Every server is started against 127.0.0.1:1, a closed local port, so no IRIS instance is reached. The golden is the
 * v1 capture; it is never edited to match a newer build.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import {
  CLOSED_PORT_ENV,
  GOLDEN_PACKAGES,
  GOLDEN_RELATIVE_PATH,
  goldenLabels,
  goldenSessions,
  inheritedGoldenEnv,
  packageVersion,
  runGoldenSession,
} from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { connectSdkClient, distEntry, resolveSdkEsmDir, staleDistReason, type IrisTarget, type SdkClient } from "./process-gate-helpers.js";

interface GoldenRow {
  label: string;
  method: string;
  params?: Record<string, unknown>;
  dw617Of?: string;
  line: string;
}

interface GoldenSession {
  protocolVersion: string;
  env: Record<string, string>;
  rows: GoldenRow[];
}

interface Golden {
  baselineRevision: string;
  sdkPackage: string;
  sdkVersion: string;
  closedPortEnv: Record<string, string>;
  servers: Record<string, { sessions: Record<string, GoldenSession> }>;
}

interface Frame {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** What a client call came to: the parsed result, or the error code and message the rejection carries. */
type Outcome = { kind: "result"; value: unknown } | { kind: "error"; code: unknown; message: string };

const golden = JSON.parse(readFileSync(path.join(REPO_ROOT, GOLDEN_RELATIVE_PATH), "utf8")) as Golden;

const CLOSED_TARGET: IrisTarget = { host: "127.0.0.1", port: "1", username: "qa", password: "qa", namespace: "HSCUSTOM" };
const METHOD_NOT_FOUND = -32601;

const frameOf = (line: string): Frame => JSON.parse(line) as Frame;

/** The response line with its JSON-RPC `id` removed, for comparing two responses to different requests. */
const withoutId = (line: string): string => {
  const frame = JSON.parse(line) as Record<string, unknown>;
  delete frame.id;
  return JSON.stringify(frame);
};

/** The version a built server reports in `serverInfo`: its package manifest's, which a release changes. */
const manifestVersion = (pkg: string): string => packageVersion(REPO_ROOT, pkg);

/** An `initialize` line with its `serverInfo.version` set to the manifest's version and every other byte as captured. */
function withManifestVersion(pkg: string, line: string): string {
  return line.replace(/("serverInfo":\{"name":"[^"]*","version":")[^"]*(")/, `$1${manifestVersion(pkg)}$2`);
}

/** What the golden says a client sees for a row: the result, or the error code and message. */
function expectedOutcome(row: GoldenRow): Outcome {
  const frame = frameOf(row.line);
  if (frame.error) return { kind: "error", code: frame.error.code, message: frame.error.message };
  return { kind: "result", value: frame.result };
}

/** Make one call of a row through the SDK client, as a client of that method would. */
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

describe("the golden fixture", () => {
  it("is the capture of the SDK v1 build, with the closed-port environment", () => {
    // The header names the v1 package (its last path segment is `sdk`) and version that the oracle build ran on.
    expect(golden.sdkPackage.endsWith("/sdk")).toBe(true);
    expect(golden.sdkVersion).toBe("1.29.0");
    expect(golden.baselineRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(golden.closedPortEnv).toEqual(CLOSED_PORT_ENV);
  });

  it("covers the five servers", () => {
    expect(Object.keys(golden.servers)).toEqual([...GOLDEN_PACKAGES]);
  });

  it("holds the v1 answers that the migration changed: every omitted-arguments prompts/get row is the -32602 refusal, unlike its {} row", () => {
    // A capture of a later build would hold equal lines here (DW-617), so these rows tell a v1 capture from any other by content.
    let dw617Rows = 0;
    for (const pkg of GOLDEN_PACKAGES) {
      const rows = Object.values(golden.servers[pkg]?.sessions ?? {}).flatMap((session) => session.rows);
      for (const row of rows.filter((candidate) => candidate.dw617Of !== undefined)) {
        dw617Rows += 1;
        const empty = rows.find((candidate) => candidate.label === row.dw617Of);
        expect(frameOf(row.line).error?.code, `${pkg} ${row.label}`).toBe(-32602);
        expect(frameOf(row.line).error?.message, `${pkg} ${row.label}`).toMatch(/^MCP error -32602: Invalid arguments for prompt /);
        expect(withoutId(row.line), `${pkg} ${row.label}`).not.toBe(withoutId(empty!.line));
      }
    }
    expect(dw617Rows, "the golden holds the seven omitted-arguments rows").toBe(7);
  });

  it.each(GOLDEN_PACKAGES)("%s: its rows are the exchange list of the core, request for request", (pkg) => {
    const recorded = golden.servers[pkg]?.sessions ?? {};
    const sessions = goldenSessions(pkg);
    expect(Object.keys(recorded)).toEqual(sessions.map((session) => session.id));
    const labels = Object.entries(recorded).flatMap(([id, session]) => session.rows.map((row) => `${id}/${row.label}`));
    expect(labels).toEqual(goldenLabels(pkg));
    for (const session of sessions) {
      const rows = recorded[session.id]?.rows ?? [];
      expect(rows[0]).toMatchObject({ label: "initialize", method: "initialize", params: { protocolVersion: session.protocolVersion } });
      const asked = (row: { label: string; method: string; params?: Record<string, unknown>; dw617Of?: string }) => ({
        label: row.label,
        method: row.method,
        params: row.params,
        dw617Of: row.dw617Of,
      });
      expect(rows.slice(1).map(asked)).toEqual(session.exchanges.map(asked));
      expect(recorded[session.id]?.protocolVersion).toBe(session.protocolVersion);
      expect(recorded[session.id]?.env).toEqual(session.env);
    }
  });
});

describe.each(GOLDEN_PACKAGES)("sdk wire golden: %s", (pkg) => {
  const recorded = golden.servers[pkg]?.sessions ?? {};
  const raw = new Map<string, GoldenRow[]>();
  const viaClient = new Map<string, Map<string, Outcome>>();
  const clientHandshake = new Map<string, { capabilities: unknown; serverInfo: unknown; instructions: unknown; protocolVersion: unknown }>();

  beforeAll(async () => {
    const sdkEsmDir = prerequisites();
    const entry = distEntry(REPO_ROOT, pkg);
    const baseEnv = inheritedGoldenEnv(process.env);
    for (const session of goldenSessions(pkg)) {
      raw.set(session.id, await runGoldenSession({ entry, baseEnv, session }));

      const client = await connectSdkClient({ sdkEsmDir, entry, target: CLOSED_TARGET, clientName: "story-43-1-sdk-wire-golden" }, session.env);
      try {
        clientHandshake.set(session.id, {
          capabilities: client.getServerCapabilities(),
          serverInfo: client.getServerVersion(),
          instructions: client.getInstructions(),
          protocolVersion: client.getNegotiatedProtocolVersion(),
        });
        const outcomes = new Map<string, Outcome>();
        for (const row of recorded[session.id]?.rows ?? []) {
          if (row.label === "initialize") continue;
          outcomes.set(row.label, await callThroughClient(client, row));
        }
        viaClient.set(session.id, outcomes);
      } finally {
        await client.close().catch(() => {});
      }
    }
  }, 240_000);

  for (const [sessionId, session] of Object.entries(recorded)) {
    describe(`session ${sessionId}`, () => {
      for (const row of session.rows) {
        const sameAs = row.dw617Of;
        const goldenFrame = frameOf(row.line);

        it(`${row.label}: the raw response line ${sameAs ? `equals the '${sameAs}' line (DW-617)` : "is byte-identical to the golden"}`, () => {
          const rows = raw.get(sessionId) ?? [];
          const live = rows.find((candidate) => candidate.label === row.label);
          expect(live, `the session ran ${row.label}`).toBeDefined();
          if (sameAs) {
            const empty = rows.find((candidate) => candidate.label === sameAs);
            expect(empty, `the session ran ${sameAs}`).toBeDefined();
            expect(withoutId(live!.line)).toBe(withoutId(empty!.line));
          } else {
            expect(live!.line).toBe(row.label === "initialize" ? withManifestVersion(pkg, row.line) : row.line);
          }
        });

        it(`${row.label}: the v2 client ${sameAs ? `sees the same as for '${sameAs}' (DW-617)` : "sees the golden result or error"}`, () => {
          if (row.label === "initialize") {
            const result = goldenFrame.result as { protocolVersion: string; capabilities: unknown; serverInfo: unknown; instructions: unknown };
            expect(clientHandshake.get(sessionId)).toEqual({
              capabilities: result.capabilities,
              serverInfo: { ...(result.serverInfo as object), version: manifestVersion(pkg) },
              instructions: result.instructions,
              protocolVersion: result.protocolVersion,
            });
            return;
          }
          const outcomes = viaClient.get(sessionId);
          const seen = outcomes?.get(row.label);
          expect(seen, `the client ran ${row.label}`).toBeDefined();
          if (sameAs) {
            expect(seen).toEqual(outcomes?.get(sameAs));
            return;
          }
          if (goldenFrame.error?.code === METHOD_NOT_FOUND && row.method === "prompts/list") {
            // The client sends no list request to a server that never advertised the capability: it answers with an empty list.
            const advertised = (frameOf(session.rows[0]!.line).result as { capabilities: Record<string, unknown> }).capabilities;
            expect(advertised.prompts, "the golden server advertises no prompts capability").toBeUndefined();
            expect(seen).toEqual({ kind: "result", value: { prompts: [] } });
            return;
          }
          expect(seen).toEqual(expectedOutcome(row));
        });
      }
    });
  }
});
