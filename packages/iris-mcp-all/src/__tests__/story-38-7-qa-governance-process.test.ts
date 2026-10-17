/**
 * Story 38.7 (QA, DW-554) - the governance document shape on the BUILT server process, where the story's
 * unit tests and process-gate cases J and K stop short.
 *
 * `governance-edge`, `governance-file`, `governance-cli` and `governance-enforcement` pin the parser, the CLI
 * and `start()` in-process, and case K of `governance-file-process-gate.test.ts` shows two rejections on the
 * built dist. None of them can tell whether the server rejects BEFORE it speaks to IRIS (case K points at a
 * live IRIS and only looks at stderr), whether the same holds for every governance-shaped key in both channels,
 * or whether a valid configuration and an unknown profile name really start the built server the way they did
 * before. This gate spawns the BUILT iris-dev-mcp dist against a local HTTP listener standing in for IRIS, which
 * records every request it receives, so each property is observed where it happens:
 *
 *  - every governance-shaped top-level key (flat tool key in either letter case, with a boolean, a string or a
 *    number, a top-level profile layer, an object-valued `globals` typo, a plain boolean key) fails startup with
 *    exit code 1, in `IRIS_GOVERNANCE` and in `IRIS_GOVERNANCE_FILE`, with the matrix text (the file form carrying
 *    the path), never echoing a submitted value, and the listener has seen NO request;
 *  - the listener can see traffic (a valid configuration makes the server reach it), so the zero above means
 *    something; `{}`, `global`, `profiles`, both, and scalar metadata (`comment`, `version`, `$schema`) all start,
 *    in both channels;
 *  - over a real MCP handshake, `iris_server_profiles` reports the same policy and attribution for a document
 *    with scalar metadata as for the same document without it, and the only key that differs from a server with no
 *    governance is the one the document disables;
 *  - an unknown profile name under `profiles` starts the server with the policy of no governance at all, logging
 *    one `[WARN]` line with the matrix text (the file form naming the path), while a configured name logs none.
 *
 * Expected texts come from the Story 38.7 intent contract (its I/O and edge-case matrix), never from the
 * implementation (Rule #36).
 *
 * No IRIS instance is contacted: the listener answers every request with HTTP 503, and the server starts without
 * its `default` profile established (Epic 37). Placement (Rule #45): `@iris-mcp/all` is the only package that
 * depends on every server's built dist. A missing or stale `shared` or `iris-dev-mcp` dist, or an unresolvable SDK,
 * skips each test with the reason; a missing or stale `iris-interop-mcp` dist skips only the interop row. Either
 * fails when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const DEV_ENTRY = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");
const INTEROP_ENTRY = path.join(REPO_ROOT, "packages", "iris-interop-mcp", "dist", "index.js");

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The server's log level in every child: a WARN line is not logged under LOG_LEVEL=ERROR, which a developer shell may set. */
const SERVER_LOG_LEVEL = "DEBUG";

/** A value that must never appear in an error: it stands for a submitted setting. */
const SENTINEL = "QA387-SUBMITTED-VALUE";

const SHAPE = '{"global":{"<tool|tool:action>":true|false},"profiles":{"<profile>":{...}}}';

/** The matrix detail for a governance-shaped top-level key outside `global` and `profiles`, behind `prefix`. */
function unrecognizedKeyText(prefix: string, key: string): string {
  return (
    `${prefix} is invalid: "${key}" is not a recognized top-level key, so it would be ignored. ` +
    `Use the documented shape ${SHAPE}: put the key under "global" to apply it to every profile, or under "profiles" for one profile.`
  );
}

let skipReason: string | undefined;
/** A stale `iris-interop-mcp` dist skips only the row that starts the interop server. */
let interopSkipReason: string | undefined;
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

/** The target a server is pointed at: the stub, with throwaway credentials. */
function stubTarget(stub: Stub): IrisTarget {
  return { host: "127.0.0.1", port: String(stub.port), username: "story387-qa", password: "not-a-real-password", namespace: "HSCUSTOM" };
}

/** Run `body` with a fresh stub, and always close it. */
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
    DEV_ENTRY,
    [],
    { ...inheritedEnv(), ...connectionEnv(stubTarget(stub)), LOG_LEVEL: SERVER_LOG_LEVEL, ...extraEnv },
    45000,
  );
}

/** Write `document` as a governance file in the fixture directory and return its path. */
let fileCounter = 0;
function writeGovernanceFile(document: unknown): string {
  fileCounter += 1;
  const file = path.join(fixtureDir, `governance-${fileCounter}.json`);
  writeFileSync(file, JSON.stringify(document), "utf8");
  return file;
}

/**
 * The policy and attribution `iris_server_profiles` reports, the names `tools/list` advertises, and the
 * server's stderr, for the built server at `entry` (the dev server by default) started with `extraEnv`.
 */
async function governanceReport(
  stub: Stub,
  extraEnv: Record<string, string>,
  entry: string = DEV_ENTRY,
): Promise<{ policy: Record<string, boolean>; configSource: Record<string, string>; stderr: string; toolNames: string[] }> {
  let stderr = "";
  const options: WireSessionOptions = {
    sdkEsmDir: sdkEsmDir as string,
    entry,
    target: stubTarget(stub),
    clientName: "story-38-7-qa-governance-process",
    onStderr: (chunk) => {
      stderr += chunk;
    },
  };
  return withWireSession(options, { LOG_LEVEL: SERVER_LOG_LEVEL, ...extraEnv }, async (session) => {
    const result = await session.raw("iris_server_profiles", {});
    expect(result.isError, "iris_server_profiles").toBeFalsy();
    const governance = (result.structuredContent as {
      governance: { policy: Record<string, boolean>; configSource: Record<string, string> };
    }).governance;
    const toolNames = (await session.listTools()).map((tool) => tool.name);
    return { policy: governance.policy, configSource: governance.configSource, stderr, toolNames };
  });
}

/** The keys whose verdict differs between two reports. */
function differingKeys(left: Record<string, boolean>, right: Record<string, boolean>): string[] {
  return Object.keys({ ...left, ...right })
    .filter((key) => left[key] !== right[key])
    .sort();
}

beforeAll(() => {
  skipReason = staleDistReason(REPO_ROOT, "shared") ?? staleDistReason(REPO_ROOT, "iris-dev-mcp");
  interopSkipReason = staleDistReason(REPO_ROOT, "iris-interop-mcp");
  if (interopSkipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 38.7 governance process gate may not be skipped: ${interopSkipReason}`);
  }
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 38.7 governance process gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) {
    // eslint-disable-next-line no-console
    console.log(`[SKIP] story-38-7-qa-governance-process: ${skipReason}`);
    return;
  }
  if (interopSkipReason) {
    // eslint-disable-next-line no-console
    console.log(`[SKIP] story-38-7-qa-governance-process, the interop row: ${interopSkipReason}`);
  }
  fixtureDir = mkdtempSync(path.join(tmpdir(), "story-38-7-gov-"));
});

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

// -- The rejection matrix ----------------------------------------------

const REJECTED: Array<[label: string, document: Record<string, unknown>, key: string]> = [
  ["a flat tool key with a boolean", { iris_doc_put: false }, "iris_doc_put"],
  ["a flat tool key with a string value", { iris_doc_put: SENTINEL }, "iris_doc_put"],
  ["a flat tool key with a number value", { iris_doc_put: 1 }, "iris_doc_put"],
  ["an upper-case flat tool key", { IRIS_DOC_PUT: false }, "IRIS_DOC_PUT"],
  ["a top-level profile layer", { prod: { iris_doc_put: SENTINEL } }, "prod"],
  ["an object-valued `globals` typo beside a valid `global`", { globals: { iris_doc_put: false }, global: { iris_sql_execute: true } }, "globals"],
  ["a plain key with a boolean", { strict: true }, "strict"],
];

describe("a governance-shaped key outside global and profiles stops the built server before it speaks to IRIS (Story 38.7, DW-554, AC-1)", () => {
  for (const [label, document, key] of REJECTED) {
    it(`IRIS_GOVERNANCE with ${label}: exit 1 naming the variable and the key, no value echoed, no request sent`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      await withStub(async (stub) => {
        const outcome = await runToExit(stub, { IRIS_GOVERNANCE: JSON.stringify(document) });

        expect(outcome.timedOut, outcome.stderr).toBe(false);
        expect(outcome.code, outcome.stderr).toBe(1);
        expect(outcome.stderr).toContain(`Fatal: Error: ${unrecognizedKeyText("IRIS_GOVERNANCE", key)}\n`);
        expect(outcome.stderr, "a submitted value is never echoed").not.toContain(SENTINEL);
        expect(stub.requests, "the server rejected before it made any request").toEqual([]);
      });
    }, 60000);

    it(`IRIS_GOVERNANCE_FILE with ${label}: exit 1 naming the variable, the key and the path, no value echoed, no request sent`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const file = writeGovernanceFile(document);
      await withStub(async (stub) => {
        const outcome = await runToExit(stub, { IRIS_GOVERNANCE_FILE: file });

        expect(outcome.timedOut, outcome.stderr).toBe(false);
        expect(outcome.code, outcome.stderr).toBe(1);
        expect(outcome.stderr).toContain(`Fatal: Error: ${unrecognizedKeyText("IRIS_GOVERNANCE_FILE", key)} (path: ${file})\n`);
        expect(outcome.stderr, "a submitted value is never echoed").not.toContain(SENTINEL);
        expect(stub.requests, "the server rejected before it made any request").toEqual([]);
      });
    }, 60000);
  }
});

// -- Valid documents still start the server ------------------------------

const LAYERS = { global: { iris_doc_put: false }, profiles: { default: { iris_sql_execute: false } } };
const METADATA = { comment: "team policy", version: 1, $schema: "https://example.invalid/governance.json" };

const STARTING: Array<[label: string, document: Record<string, unknown>]> = [
  ["an empty document", {}],
  ["a `global` layer", { global: LAYERS.global }],
  ["a `profiles` layer", { profiles: LAYERS.profiles }],
  ["both layers", LAYERS],
  ["both layers beside scalar metadata (comment, version, $schema)", { ...METADATA, ...LAYERS }],
  ["per-action keys of a multi-action tool in both layers", { global: { "iris_doc_edit:apply": false }, profiles: { default: { "iris_doc_edit:regenerateStorage": true } } }],
];

describe("every valid document still starts the built server, and the listener sees it reach IRIS (Story 38.7, DW-554, AC-1 back-compat)", () => {
  for (const [label, document] of STARTING) {
    for (const channel of ["IRIS_GOVERNANCE", "IRIS_GOVERNANCE_FILE"] as const) {
      it(`${channel} with ${label}: the server starts, makes its health-check request, and logs no governance error`, async (testCtx) => {
        if (skipReason) return testCtx.skip();
        const value = channel === "IRIS_GOVERNANCE" ? JSON.stringify(document) : writeGovernanceFile(document);
        await withStub(async (stub) => {
          const outcome = await runToExit(stub, { [channel]: value });

          expect(outcome.timedOut, outcome.stderr).toBe(false);
          expect(outcome.code, outcome.stderr).toBe(0);
          expect(outcome.stderr).not.toContain("is invalid:");
          expect(outcome.stderr).not.toContain("Fatal:");
          expect(outcome.stderr, "a valid key is never reported as dead (Story 39.0)").not.toContain("has no effect");
          expect(stub.requests.length, "the oracle can see traffic: the server reached the listener").toBeGreaterThan(0);
        });
      }, 60000);
    }
  }
});

// -- The same policy, with and without scalar metadata -----------------

describe("scalar metadata changes nothing about the policy the built server reports (Story 38.7, DW-554, AC-1 back-compat)", () => {
  for (const channel of ["IRIS_GOVERNANCE", "IRIS_GOVERNANCE_FILE"] as const) {
    it(`${channel}: the report of a document with comment, version and $schema equals the report of the same layers alone, and only the disabled keys differ from no governance`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const value = (document: Record<string, unknown>): string =>
        channel === "IRIS_GOVERNANCE" ? JSON.stringify(document) : writeGovernanceFile(document);
      await withStub(async (stub) => {
        const none = await governanceReport(stub, {});
        const plain = await governanceReport(stub, { [channel]: value(LAYERS) });
        const withMetadata = await governanceReport(stub, { [channel]: value({ ...METADATA, ...LAYERS }) });

        expect({ policy: withMetadata.policy, configSource: withMetadata.configSource }).toEqual({
          policy: plain.policy,
          configSource: plain.configSource,
        });
        const source = channel === "IRIS_GOVERNANCE" ? "env" : "file";
        expect(withMetadata.policy["iris_doc_put"]).toBe(false);
        expect(withMetadata.configSource["iris_doc_put"]).toBe(source);
        expect(withMetadata.policy["iris_sql_execute"]).toBe(false);
        expect(withMetadata.configSource["iris_sql_execute"]).toBe(source);
        // A disabled parent key also disables the keys that inherit from it (iris_doc_edit:apply, iris_sql_query), so the
        // changed set is not hard-coded: it must be the same set without the metadata, hold the two keys, and only disable.
        const changed = differingKeys(withMetadata.policy, none.policy);
        expect(changed, "the same keys differ from no governance with and without the metadata").toEqual(
          differingKeys(plain.policy, none.policy),
        );
        expect(changed).toEqual(expect.arrayContaining(["iris_doc_put", "iris_sql_execute"]));
        for (const key of changed) {
          expect(none.policy[key], `${key} is enabled on a server with no governance`).toBe(true);
          expect(withMetadata.policy[key], `${key} is disabled by the document`).toBe(false);
        }
      });
    }, 90000);
  }
});

// -- An unknown profile name only warns ----------------------------------

describe("an unknown profile name under profiles only warns on the built server (Story 38.7, DW-554, D2)", () => {
  const OVERRIDES = { profiles: { prdo: { iris_doc_put: false } } };

  /** The `[WARN]` lines about a profile name that no configured profile carries. */
  function profileWarnings(stderr: string): string[] {
    return stderr.split("\n").filter((line) => line.includes("is not a configured profile"));
  }

  it("IRIS_GOVERNANCE: the policy equals the one with no governance, and exactly one WARN names the profile and the configured profiles", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await withStub(async (stub) => {
      const none = await governanceReport(stub, {});
      const typo = await governanceReport(stub, { IRIS_GOVERNANCE: JSON.stringify(OVERRIDES) });

      expect({ policy: typo.policy, configSource: typo.configSource }).toEqual({ policy: none.policy, configSource: none.configSource });
      expect(profileWarnings(typo.stderr)).toEqual([
        '[WARN] IRIS_GOVERNANCE: profile "prdo" under "profiles" is not a configured profile, so its overrides apply to no connection. ' +
          "Check the name against the configured profiles: default.",
      ]);
      expect(profileWarnings(none.stderr), "a server with no governance logs none").toEqual([]);
    });
  }, 90000);

  it("IRIS_GOVERNANCE_FILE: the policy equals the one with no governance, and exactly one WARN names the path, the profile and the configured profiles", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const file = writeGovernanceFile(OVERRIDES);
    await withStub(async (stub) => {
      const none = await governanceReport(stub, {});
      const typo = await governanceReport(stub, { IRIS_GOVERNANCE_FILE: file });

      expect({ policy: typo.policy, configSource: typo.configSource }).toEqual({ policy: none.policy, configSource: none.configSource });
      expect(profileWarnings(typo.stderr)).toEqual([
        `[WARN] IRIS_GOVERNANCE_FILE (path: ${file}): profile "prdo" under "profiles" is not a configured profile, so its overrides apply to no connection. ` +
          "Check the name against the configured profiles: default.",
      ]);
    });
  }, 90000);

  it("with a second configured profile, the WARN lists every configured profile and a name that matches one of them logs nothing", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await withStub(async (stub) => {
      const profiles = {
        prod: { host: "127.0.0.1", port: stub.port, username: "story387-prod", password: "not-a-real-password", namespace: "HSCUSTOM", https: false },
      };
      const document = { profiles: { prod: { iris_doc_put: false }, prdo: { iris_sql_execute: false } } };

      const report = await governanceReport(stub, {
        IRIS_PROFILES: JSON.stringify(profiles),
        IRIS_GOVERNANCE: JSON.stringify(document),
      });

      expect(profileWarnings(report.stderr)).toEqual([
        '[WARN] IRIS_GOVERNANCE: profile "prdo" under "profiles" is not a configured profile, so its overrides apply to no connection. ' +
          "Check the name against the configured profiles: default, prod.",
      ]);
      expect(report.policy["iris_doc_put"], "the default profile is not governed by the prod override").toBe(true);
    });
  }, 90000);

  it("a configured name logs no warning and its override applies, and a second typo in the same document is warned about separately", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await withStub(async (stub) => {
      const document = { profiles: { default: { iris_doc_put: false }, prdo: { iris_sql_execute: false }, stagng: { iris_doc_compile: false } } };
      const report = await governanceReport(stub, { IRIS_GOVERNANCE: JSON.stringify(document) });

      expect(report.policy["iris_doc_put"], "the configured profile's override applies").toBe(false);
      expect(report.policy["iris_sql_execute"], "the typo's override applies to nothing").toBe(true);
      expect(report.policy["iris_doc_compile"], "the second typo's override applies to nothing").toBe(true);
      expect(profileWarnings(report.stderr).map((line) => /profile "([^"]+)"/.exec(line)?.[1])).toEqual(["prdo", "stagng"]);
    });
  }, 90000);
});

// -- A key that names nothing only warns (Story 39.0, DW-565) -------------

describe("a governance key that names nothing only warns on the built server (Story 39.0, DW-565, AC-1 and AC-3)", () => {
  /** The `[WARN]` lines about a key that has no effect. */
  function deadKeyWarnings(stderr: string): string[] {
    return stderr.split("\n").filter((line) => line.includes("has no effect"));
  }

  const BARE = { global: { iris_doc_edit: false } };
  const ACTION_ON_SINGLE = { global: { "iris_doc_put:apply": false } };
  const NOT_THIS_SERVER = { global: { iris_production_control: false, iris_doc_putt: false } };

  /** The channel's value and the `[WARN]` prefix it logs under. */
  function channel(name: "IRIS_GOVERNANCE" | "IRIS_GOVERNANCE_FILE", document: Record<string, unknown>): { value: string; source: string } {
    if (name === "IRIS_GOVERNANCE") return { value: JSON.stringify(document), source: "IRIS_GOVERNANCE" };
    const file = writeGovernanceFile(document);
    return { value: file, source: `IRIS_GOVERNANCE_FILE (path: ${file})` };
  }

  for (const name of ["IRIS_GOVERNANCE", "IRIS_GOVERNANCE_FILE"] as const) {
    it(`${name}: a bare per-action tool name logs one form (a) WARN, and the reported policy equals the one with no governance`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const { value, source } = channel(name, BARE);
      await withStub(async (stub) => {
        const none = await governanceReport(stub, {});
        const bare = await governanceReport(stub, { [name]: value });

        expect({ policy: bare.policy, configSource: bare.configSource }).toEqual({ policy: none.policy, configSource: none.configSource });
        expect(deadKeyWarnings(bare.stderr)).toEqual([
          `[WARN] ${source}: "iris_doc_edit" under "global" has no effect, because iris_doc_edit is governed per action. ` +
            "Set the actions you mean instead: iris_doc_edit:apply, iris_doc_edit:regenerateStorage.",
        ]);
        expect(deadKeyWarnings(none.stderr), "a server with no governance logs none").toEqual([]);
        expect(bare.policy["iris_doc_edit:apply"], "the default-enabled write stays enabled: the bare key governed nothing").toBe(true);
      });
    }, 90000);

    it(`${name}: an action on a single-operation tool logs one form (b) WARN`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const { value, source } = channel(name, ACTION_ON_SINGLE);
      await withStub(async (stub) => {
        const none = await governanceReport(stub, {});
        const report = await governanceReport(stub, { [name]: value });

        expect({ policy: report.policy, configSource: report.configSource }).toEqual({ policy: none.policy, configSource: none.configSource });
        expect(deadKeyWarnings(report.stderr)).toEqual([
          `[WARN] ${source}: "iris_doc_put:apply" under "global" has no effect, because iris_doc_put takes no action. Use "iris_doc_put" instead.`,
        ]);
      });
    }, 90000);

    it(`${name}: a key of a tool this server does not register, and a key no tool of the suite has, log nothing`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const { value } = channel(name, NOT_THIS_SERVER);
      await withStub(async (stub) => {
        const none = await governanceReport(stub, {});
        const report = await governanceReport(stub, { [name]: value });

        expect({ policy: report.policy, configSource: report.configSource }).toEqual({ policy: none.policy, configSource: none.configSource });
        expect(deadKeyWarnings(report.stderr)).toEqual([]);
      });
    }, 90000);
  }

  it("a document holding every key of the universe logs no such line, on both channels, and the reported policy is the engine's own render", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const cliOutput = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, "packages", "shared", "dist", "cli", "governance-cli.js"), "universe", "--root", REPO_ROOT, "--json"],
      { encoding: "utf8", env: inheritedEnv(), maxBuffer: 16 * 1024 * 1024 },
    );
    const universeKeys = (JSON.parse(cliOutput) as { keys: string[] }).keys;
    // Two thirds enabled, the rest disabled, so the render has both verdicts; the discovery tool stays enabled.
    const everything: Record<string, boolean> = Object.fromEntries(
      universeKeys.map((key, index) => [key, key === "iris_server_profiles" || index % 3 !== 0]),
    );
    const document = { global: everything, profiles: { default: everything } };

    // The oracle: the engine's functions from the BUILT shared dist, over the dev package's built tools.
    const sharedDist = async (file: string): Promise<Record<string, unknown>> =>
      (await import(pathToFileURL(path.join(REPO_ROOT, "packages", "shared", "dist", file)).href)) as Record<string, unknown>;
    const engine = await sharedDist("governance.js");
    const call = <T>(fn: string, ...args: unknown[]): T => (engine[fn] as (...a: unknown[]) => T)(...args);
    const { GOVERNANCE_BASELINE } = await sharedDist("governance-baseline.js");
    const { BASELINE_ACTION_CLASSIFICATIONS } = await sharedDist("baseline-classifications.js");
    const { serverDiscoveryTool } = await sharedDist("server-discovery.js");
    const devEntry = pathToFileURL(path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "tools", "index.js")).href;
    const tools = [...((await import(devEntry)) as { tools: unknown[] }).tools, serverDiscoveryTool];

    for (const name of ["IRIS_GOVERNANCE", "IRIS_GOVERNANCE_FILE"] as const) {
      const { value } = channel(name, document);
      await withStub(async (stub) => {
        const report = await governanceReport(stub, { [name]: value });
        expect(deadKeyWarnings(report.stderr), `${name}: every key of the universe is a key of some tool`).toEqual([]);

        const reported = Object.keys(report.policy);
        expect(reported.length, "the dev server reports its own keys").toBeGreaterThan(20);
        const mutatesLookup = new Map(call<Iterable<[string, string]>>("buildMutatesLookup", tools));
        const envConfig = name === "IRIS_GOVERNANCE" ? document : {};
        const fileConfig = name === "IRIS_GOVERNANCE_FILE" ? document : undefined;
        const parentKeys = call("buildParentKeys", tools);
        const policy = call<Record<string, boolean>>(
          "getEffectivePolicy",
          "default", envConfig, reported, mutatesLookup, GOVERNANCE_BASELINE, call("buildDefaultEnabledWrites", tools),
          undefined, BASELINE_ACTION_CLASSIFICATIONS, fileConfig, parentKeys,
        );
        const configSource = call<Record<string, string>>(
          "getEffectiveConfigSources",
          "default", envConfig, reported, mutatesLookup, undefined, BASELINE_ACTION_CLASSIFICATIONS, fileConfig, parentKeys,
        );
        expect({ policy: report.policy, configSource: report.configSource }, name).toEqual({ policy, configSource });
      });
    }
  }, 120000);

  // -- Story 39.0 QA: several dead keys, both layers, a hidden tool, both channels, another server --------

  /** The `[WARN]` line a dead key of the dev server logs; `layer` is `"global"` or `profile "default"`. */
  function warnLine(source: string, key: string, layer: string, reason: string): string {
    return `[WARN] ${source}: "${key}" under ${layer} has no effect, because ${reason}`;
  }
  const EDIT_ACTIONS = "iris_doc_edit:apply, iris_doc_edit:regenerateStorage";
  const BARE_EDIT = `iris_doc_edit is governed per action. Set the actions you mean instead: ${EDIT_ACTIONS}.`;
  const ACTION_ON_PUT = 'iris_doc_put takes no action. Use "iris_doc_put" instead.';
  const MANY = {
    global: { iris_global_set: false, iris_doc_edit: false, "iris_doc_put:apply": false, "iris_doc_edit:aply": true },
    profiles: { default: { iris_doc_edit: true, "iris_doc_put:apply": true } },
  };

  for (const name of ["IRIS_GOVERNANCE", "IRIS_GOVERNANCE_FILE"] as const) {
    it(`${name}: five dead keys across both layers log exactly five WARN lines, one per key in document order, and the live key beside them still governs`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const { value, source } = channel(name, MANY);
      const validOnly = channel(name, { global: { iris_global_set: false } });
      await withStub(async (stub) => {
        const none = await governanceReport(stub, {});
        const live = await governanceReport(stub, { [name]: validOnly.value });
        const report = await governanceReport(stub, { [name]: value });

        expect(report.toolNames.length, "the server is up and answers tools/list").toBeGreaterThan(10);
        expect(deadKeyWarnings(live.stderr), "the live key alone logs nothing").toEqual([]);
        expect(deadKeyWarnings(report.stderr)).toEqual([
          warnLine(source, "iris_doc_edit", '"global"', BARE_EDIT),
          warnLine(source, "iris_doc_put:apply", '"global"', ACTION_ON_PUT),
          warnLine(source, "iris_doc_edit:aply", '"global"', `iris_doc_edit has no action "aply". Use one of: ${EDIT_ACTIONS}.`),
          warnLine(source, "iris_doc_edit", 'profile "default"', BARE_EDIT),
          warnLine(source, "iris_doc_put:apply", 'profile "default"', ACTION_ON_PUT),
        ]);
        expect(report.policy["iris_global_set"], "no dead key re-enabled the tool the live key disabled").toBe(false);
        expect(differingKeys(none.policy, report.policy), "only the live key changes the policy").toEqual(["iris_global_set"]);
        expect(report.policy).toEqual(live.policy);
      });
    }, 120000);
  }

  it("a tool hidden by IRIS_TOOLS_DISABLE still counts as registered: its bare key logs one form (a) WARN, as when it is visible, and its action key logs none", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const { value, source } = channel("IRIS_GOVERNANCE_FILE", { global: { iris_doc_edit: false, "iris_doc_edit:apply": false } });
    await withStub(async (stub) => {
      const visible = await governanceReport(stub, { IRIS_GOVERNANCE_FILE: value });
      const hidden = await governanceReport(stub, { IRIS_GOVERNANCE_FILE: value, IRIS_TOOLS_DISABLE: "iris_doc_edit" });

      expect(visible.toolNames, "the oracle: the tool is advertised when it is not hidden").toContain("iris_doc_edit");
      expect(hidden.toolNames, "the tool is hidden from tools/list").not.toContain("iris_doc_edit");
      expect(hidden.toolNames, "the rest of the dev tools are still advertised").toContain("iris_doc_put");
      const expected = [warnLine(source, "iris_doc_edit", '"global"', BARE_EDIT)];
      expect(deadKeyWarnings(visible.stderr)).toEqual(expected);
      expect(deadKeyWarnings(hidden.stderr)).toEqual(expected);
    });
  }, 120000);

  it("both channels at once: each logs the dead key of its own document, labelled by its own source, and nothing else", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const file = writeGovernanceFile({ global: { "iris_doc_put:apply": false } });
    const envDocument = JSON.stringify({ global: { iris_doc_edit: false } });
    await withStub(async (stub) => {
      const report = await governanceReport(stub, { IRIS_GOVERNANCE: envDocument, IRIS_GOVERNANCE_FILE: file });

      const expected = [
        warnLine("IRIS_GOVERNANCE", "iris_doc_edit", '"global"', BARE_EDIT),
        warnLine(`IRIS_GOVERNANCE_FILE (path: ${file})`, "iris_doc_put:apply", '"global"', ACTION_ON_PUT),
      ];
      expect([...deadKeyWarnings(report.stderr)].sort()).toEqual([...expected].sort());
    });
  }, 120000);

  it("the built interop server warns as well: a mistyped action of its tool logs one form (c) WARN, and a key of another server or of no tool logs nothing", async (testCtx) => {
    if (skipReason || interopSkipReason) return testCtx.skip();
    const document = { profiles: { default: { "iris_production_control:strat": false, iris_doc_put: false, iris_doc_putt: false } } };
    const { value, source } = channel("IRIS_GOVERNANCE_FILE", document);
    await withStub(async (stub) => {
      const none = await governanceReport(stub, {}, INTEROP_ENTRY);
      const report = await governanceReport(stub, { IRIS_GOVERNANCE_FILE: value }, INTEROP_ENTRY);

      expect(report.toolNames, "this is the interop server").toContain("iris_production_control");
      expect(report.toolNames, "the dev tool named in the document is not registered here").not.toContain("iris_doc_put");
      const controlKeys = Object.keys(none.policy).filter((key) => key.startsWith("iris_production_control"));
      expect(controlKeys.length, "the interop server reports the keys of the tool the document mistypes").toBeGreaterThan(1);
      expect(Object.fromEntries(controlKeys.map((key) => [key, report.policy[key]]))).toEqual(
        Object.fromEntries(controlKeys.map((key) => [key, none.policy[key]])),
      );
      expect(deadKeyWarnings(report.stderr)).toEqual([
        warnLine(
          source,
          "iris_production_control:strat",
          'profile "default"',
          'iris_production_control has no action "strat". Use one of: iris_production_control:start, iris_production_control:stop, ' +
            "iris_production_control:restart, iris_production_control:update, iris_production_control:recover, iris_production_control:clean.",
        ),
      ]);
    });
  }, 120000);
});
