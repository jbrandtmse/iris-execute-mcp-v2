/**
 * Story 39.2 - the data policy's configuration on the BUILT interop server process, where the in-process
 * tests of `data-policy-server.test.ts` stop short (AC-1; AD-8, AD-9).
 *
 * Each bad setting must fail the BUILT server's startup with exit code 1, naming the channel, before the
 * server speaks to IRIS; each valid one must start it and be reported by `iris_server_profiles` over a real MCP
 * handshake. The server is pointed at a local HTTP listener standing in for IRIS, which records every request
 * and answers 503, so "no request was seen" is observable and means something (a valid configuration does reach
 * the listener).
 *
 * Expected texts come from the Story 39.2 intent contract (its I/O matrix), never from the implementation
 * (Rule #36). No IRIS instance is contacted. Placement (Rule #45): `@iris-mcp/all` is the only package that
 * depends on every server's built dist. A missing or stale `shared` or `iris-interop-mcp` dist, or an
 * unresolvable SDK, skips each test with the reason, or fails when `IRIS_REQUIRE_LIVE` is armed (listed in
 * `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectionEnv,
  inheritedEnv,
  resolveSdkEsmDir,
  spawnAndWaitForExit,
  staleDistReason,
  withWireSession,
  type IrisTarget,
  type WireSessionOptions,
} from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const INTEROP_ENTRY = path.join(REPO_ROOT, "packages", "iris-interop-mcp", "dist", "index.js");

const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** A WARN line is not logged under LOG_LEVEL=ERROR, which a developer shell may set. */
const SERVER_LOG_LEVEL = "DEBUG";

/** A value that must never appear in an error: it stands for a submitted setting. */
const SENTINEL = "SYNTHPHI-SUBMITTED-VALUE";

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let fixtureDir = "";

interface Stub {
  port: number;
  requests: string[];
  close: () => Promise<void>;
}

/** A local HTTP listener answering every request with 503 and recording `METHOD path` lines. */
async function startStub(): Promise<Stub> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.statusCode = 503;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function stubTarget(stub: Stub): IrisTarget {
  return { host: "127.0.0.1", port: String(stub.port), username: "story392-gate", password: "not-a-real-password", namespace: "HSCUSTOM" };
}

async function withStub<T>(body: (stub: Stub) => Promise<T>): Promise<T> {
  const stub = await startStub();
  try {
    return await body(stub);
  } finally {
    await stub.close();
  }
}

/** Spawn the built server pointed at `stub` with `extraEnv`, stdin closed, and wait for it to exit. */
function runToExit(stub: Stub, extraEnv: Record<string, string>) {
  return spawnAndWaitForExit(
    INTEROP_ENTRY,
    [],
    { ...inheritedEnv(), ...connectionEnv(stubTarget(stub)), LOG_LEVEL: SERVER_LOG_LEVEL, ...extraEnv },
    45000,
  );
}

let fileCounter = 0;
function writeGovernanceFile(document: unknown): string {
  fileCounter += 1;
  const file = path.join(fixtureDir, `governance-${fileCounter}.json`);
  writeFileSync(file, JSON.stringify(document), "utf8");
  return file;
}

interface RosterEntry {
  name: string;
  dataPolicy: string;
  dataPolicySource: string;
}

/** The roster `iris_server_profiles` reports, and the server's stderr, for the built server started with `extraEnv`. */
async function report(stub: Stub, extraEnv: Record<string, string>): Promise<{ roster: Record<string, RosterEntry>; stderr: string }> {
  let stderr = "";
  const options: WireSessionOptions = {
    sdkEsmDir: sdkEsmDir as string,
    entry: INTEROP_ENTRY,
    target: stubTarget(stub),
    clientName: "story-39-2-data-policy-startup",
    onStderr: (chunk) => {
      stderr += chunk;
    },
  };
  return withWireSession(options, { LOG_LEVEL: SERVER_LOG_LEVEL, ...extraEnv }, async (session) => {
    const result = await session.raw("iris_server_profiles", {});
    expect(result.isError, "iris_server_profiles").toBeFalsy();
    const profiles = (result.structuredContent as { profiles: RosterEntry[] }).profiles;
    return { roster: Object.fromEntries(profiles.map((entry) => [entry.name, entry])), stderr };
  });
}

beforeAll(() => {
  skipReason = staleDistReason(REPO_ROOT, "shared") ?? staleDistReason(REPO_ROOT, "iris-interop-mcp");
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.2 data-policy startup gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) {
    // eslint-disable-next-line no-console
    console.log(`[SKIP] story-39-2-data-policy-startup: ${skipReason}`);
    return;
  }
  fixtureDir = mkdtempSync(path.join(tmpdir(), "story-39-2-startup-"));
});

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

function skipIfNeeded(ctx: { skip: () => void }): boolean {
  if (!skipReason) return false;
  ctx.skip();
  return true;
}

describe("Story 39.2: a bad data-policy setting fails the built server's startup (AC-1, AD-8)", () => {
  it("IRIS_DATA_POLICY that is not a policy: exit 1, naming the variable, before any IRIS traffic", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    await withStub(async (stub) => {
      const result = await runToExit(stub, { IRIS_DATA_POLICY: "open" });
      expect(result.timedOut, result.stderr).toBe(false);
      expect(result.code, result.stderr).toBe(1);
      expect(result.stderr).toContain('IRIS_DATA_POLICY must be "block", "redact" or "allow". Received: "open".');
      expect(stub.requests).toEqual([]);
    });
  });

  it("an IRIS_PROFILES entry whose dataPolicy is not a policy: exit 1, naming the profile and the field", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    await withStub(async (stub) => {
      const result = await runToExit(stub, { IRIS_PROFILES: JSON.stringify({ p: { dataPolicy: 3 } }) });
      expect(result.code, result.stderr).toBe(1);
      expect(result.stderr).toContain('IRIS_PROFILES is invalid: profile "p": "dataPolicy" must be "block", "redact" or "allow".');
      expect(stub.requests).toEqual([]);
    });
  });

  const FILE_ROWS: Array<{ label: string; document: unknown; text: string }> = [
    { label: "a dataPolicy that is a string", document: { dataPolicy: SENTINEL }, text: '"dataPolicy" must be a JSON object' },
    { label: "a dataPolicy that is null", document: { dataPolicy: null }, text: '"dataPolicy" must be a JSON object' },
    { label: "a global that is not a policy", document: { dataPolicy: { global: SENTINEL } }, text: '"dataPolicy.global" must be "block", "redact" or "allow".' },
    { label: "a profile value that is not a policy", document: { dataPolicy: { profiles: { p: SENTINEL } } }, text: '"dataPolicy.profiles.p" must be "block", "redact" or "allow".' },
    { label: "a key beside global and profiles", document: { dataPolicy: { extra: SENTINEL } }, text: '"dataPolicy.extra" is not a recognized key.' },
  ];
  for (const row of FILE_ROWS) {
    it(`IRIS_GOVERNANCE_FILE with ${row.label}: exit 1, naming the key and the path, never the value`, async (ctx) => {
      if (skipIfNeeded(ctx)) return;
      await withStub(async (stub) => {
        const file = writeGovernanceFile(row.document);
        const result = await runToExit(stub, { IRIS_GOVERNANCE_FILE: file });
        expect(result.code, result.stderr).toBe(1);
        expect(result.stderr).toContain("IRIS_GOVERNANCE_FILE is invalid:");
        expect(result.stderr).toContain(row.text);
        expect(result.stderr).toContain(`(path: ${file})`);
        expect(result.stderr).not.toContain(SENTINEL);
        expect(stub.requests).toEqual([]);
      });
    });
  }

  it("IRIS_GOVERNANCE carrying a dataPolicy key: exit 1, pointing to the channels that can carry it", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    await withStub(async (stub) => {
      const result = await runToExit(stub, { IRIS_GOVERNANCE: JSON.stringify({ dataPolicy: {} }) });
      expect(result.code, result.stderr).toBe(1);
      expect(result.stderr).toContain(
        'IRIS_GOVERNANCE is invalid: "dataPolicy" is read only from IRIS_GOVERNANCE_FILE. Set IRIS_DATA_POLICY for every profile, or "dataPolicy" on an IRIS_PROFILES entry for one.',
      );
      expect(stub.requests).toEqual([]);
    });
  });
});

describe("Story 39.2: valid data-policy settings start the built server and are reported (AC-1, AC-7)", () => {
  it("a server with no data-policy setting reports redact from default, and reached the listener", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    await withStub(async (stub) => {
      const { roster } = await report(stub, {});
      expect(roster.default).toMatchObject({ dataPolicy: "redact", dataPolicySource: "default" });
      expect(stub.requests.length, "the server reached the listener, so a zero above means something").toBeGreaterThan(0);
    });
  });

  it("IRIS_DATA_POLICY in any letter case is reported; an empty one is unset", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    await withStub(async (stub) => {
      expect((await report(stub, { IRIS_DATA_POLICY: "BLOCK" })).roster.default).toMatchObject({
        dataPolicy: "block",
        dataPolicySource: "IRIS_DATA_POLICY",
      });
      expect((await report(stub, { IRIS_DATA_POLICY: "" })).roster.default).toMatchObject({
        dataPolicy: "redact",
        dataPolicySource: "default",
      });
    });
  });

  it("walks the precedence across IRIS_PROFILES, IRIS_DATA_POLICY and the governance file", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    await withStub(async (stub) => {
      const file = writeGovernanceFile({ dataPolicy: { global: "allow", profiles: { p: "allow" } } });
      const all = await report(stub, {
        IRIS_PROFILES: JSON.stringify({ p: { dataPolicy: "block" } }),
        IRIS_DATA_POLICY: "allow",
        IRIS_GOVERNANCE_FILE: file,
      });
      expect(all.roster.p).toMatchObject({ dataPolicy: "block", dataPolicySource: "IRIS_PROFILES" });
      expect(all.roster.default).toMatchObject({ dataPolicy: "allow", dataPolicySource: "IRIS_DATA_POLICY" });

      const fileOnly = await report(stub, { IRIS_PROFILES: JSON.stringify({ p: {} }), IRIS_GOVERNANCE_FILE: file });
      expect(fileOnly.roster.p).toMatchObject({ dataPolicy: "allow", dataPolicySource: "IRIS_GOVERNANCE_FILE:profiles" });
      expect(fileOnly.roster.default).toMatchObject({ dataPolicy: "allow", dataPolicySource: "IRIS_GOVERNANCE_FILE:global" });
    });
  });

  it("never inherits the default entry's value", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    await withStub(async (stub) => {
      const { roster } = await report(stub, { IRIS_PROFILES: JSON.stringify({ default: { dataPolicy: "allow" }, p: {} }) });
      expect(roster.default).toMatchObject({ dataPolicy: "allow", dataPolicySource: "IRIS_PROFILES" });
      expect(roster.p).toMatchObject({ dataPolicy: "redact", dataPolicySource: "default" });
    });
  });

  it("an unknown profile name under dataPolicy.profiles warns once and the server starts", async (ctx) => {
    if (skipIfNeeded(ctx)) return;
    await withStub(async (stub) => {
      const file = writeGovernanceFile({ dataPolicy: { profiles: { ghost: "block" } } });
      const { roster, stderr } = await report(stub, { IRIS_GOVERNANCE_FILE: file });
      expect(roster.default).toMatchObject({ dataPolicy: "redact", dataPolicySource: "default" });
      const warnings = stderr.split("\n").filter((line) => line.includes("[WARN]") && line.includes("ghost") && line.includes("dataPolicy.profiles"));
      expect(warnings).toHaveLength(1);
    });
  });
});
