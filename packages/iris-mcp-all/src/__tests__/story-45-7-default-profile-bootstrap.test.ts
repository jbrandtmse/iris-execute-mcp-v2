/**
 * Story 45.7 (DW-767; `S-45.7-default-profile-bootstrap`; AD-8, AD-9, AD-14; Rules #19, #36, #59) -- the startup bootstrap follows the
 * `default` profile of the registry.
 *
 * The default profile's HTTP client, credentials, namespace for tools and `autoInstall` already followed an `IRIS_PROFILES` `default`
 * entry, but the startup bootstrap took its namespace, and every message its host:port, from `IRIS_*` (plan probe P-767, 2026-11-26: two
 * IRIS Community throwaways; with `IRIS_PROFILES` `{"default":{host B, port B, namespace "PROBEX"}}` over `IRIS_*` = host A / `USER`, the 35
 * PUTs went to B in `USER`, and the warning and the refusal named A).
 *
 * This test drives the REAL built `iris-dev-mcp` (its bootstrap, gateway and framework in the built shared dist) over the real stdio MCP
 * client against the STATEFUL fake Atelier listener, with `IRIS_*` pointing at a closed port (127.0.0.1:1, namespace `USER`) and the
 * `default` entry of `IRIS_PROFILES` pointing at the fake (namespace `PROBEX`). The fake serves ONLY `PROBEX` (it answers any other
 * namespace with HTTP 404), so a bootstrap that used `IRIS_NAMESPACE` would not install anything.
 *
 * Rows: the install on installs under `/PROBEX/` and nothing else; the install off on a `missing` side writes nothing and the warning and the
 * refusal name the entry's host:port and `PROBEX` and never the `IRIS_*` closed port; with no `default` entry the requests are those of
 * today's `IRIS_*` start, and equal those of an entry that repeats the `IRIS_*` fields.
 *
 * Mutation (Rule #59): `bootstrapConfig` back to `this.config` in `McpServerBase.start`, rebuild shared -> the first two tests are red (the
 * built dev `McpServerBase.start` -> `bootstrap` -> the stateful fake). Needs no IRIS and no docker; it FAILS (never skips) on a stale dist.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { distEntry, openWireSession, resolveSdkEsmDir, staleDistReason, type IrisTarget } from "./process-gate-helpers.js";
import { loadEmbedded, type EmbeddedBootstrap } from "./bootstrap-guard-legs.js";
import { startStatefulFakeAtelier, summarizeRequests, type FakeRequest, type StatefulFakeAtelier } from "./stateful-fake-atelier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const ENTRY_NAMESPACE = "PROBEX";
const ENV_NAMESPACE = "USER";
const PASSWORD = "Pw-45-7-never-logged";
const TEST_TIMEOUT_MS = 90_000;

let embedded: EmbeddedBootstrap;
let sdkEsmDir: string;
const openFakes: StatefulFakeAtelier[] = [];

/** `IRIS_*` -> a closed port, namespace `USER`: the instance the default profile must NOT bootstrap. */
const CLOSED_IRIS_ENV: IrisTarget = { host: "127.0.0.1", port: "1", username: "fake", password: PASSWORD, namespace: ENV_NAMESPACE };

async function startFake(namespace: string): Promise<StatefulFakeAtelier> {
  const fake = await startStatefulFakeAtelier({ namespace });
  openFakes.push(fake);
  return fake;
}

beforeAll(async () => {
  const stale = staleDistReason(REPO_ROOT, "shared") ?? staleDistReason(REPO_ROOT, "iris-dev-mcp");
  if (stale !== undefined) {
    throw new Error(`The hermetic default-profile bootstrap test runs the built iris-dev-mcp and shared dists and needs no IRIS, so a stale or missing dist fails it instead of skipping it: ${stale}`);
  }
  const found = resolveSdkEsmDir(REPO_ROOT);
  if (found === undefined) {
    throw new Error("Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm; run pnpm install from the repo root.");
  }
  sdkEsmDir = found;
  embedded = await loadEmbedded(REPO_ROOT);
});

afterAll(async () => {
  await Promise.all(openFakes.splice(0).map((fake) => fake.close()));
});

interface Served {
  stderr: string;
  results: Array<{ isError?: boolean; structuredContent?: Record<string, unknown>; content?: Array<{ text?: string }> }>;
}

/** Start the built dev server with `env` over the target `IRIS_*` names, make `calls`, close it, and return its stderr and results. */
async function serve(target: IrisTarget, env: Record<string, string>, calls: ReadonlyArray<{ tool: string; args: Record<string, unknown> }>): Promise<Served> {
  let stderr = "";
  const results: Served["results"] = [];
  const session = await openWireSession(
    {
      sdkEsmDir,
      entry: distEntry(REPO_ROOT, "iris-dev-mcp"),
      clientName: "story-45-7-default-profile-bootstrap",
      onStderr: (chunk: string): void => {
        stderr += chunk;
      },
      target,
    },
    env,
  );
  try {
    for (const call of calls) results.push((await session.raw(call.tool, call.args)) as Served["results"][number]);
  } finally {
    await session.close();
  }
  return { stderr, results };
}

/** The Atelier requests of a window that carry a namespace (`/api/atelier/v<N>/<ns>/...`): the bootstrap's own. */
function namespacedRequests(window: readonly FakeRequest[]): string[] {
  return window.filter((request) => /^\/api\/atelier\/v\d+\/[^/]+\//.test(request.url)).map((request) => `${request.method} ${request.url}`);
}

function warnLines(stderr: string): string[] {
  return stderr.split(/\r?\n/).filter((line) => line.startsWith("[WARN] Bootstrap:"));
}

/** `IRIS_PROFILES` with a `default` entry pointing at the fake in `PROBEX`. */
function defaultEntry(fake: StatefulFakeAtelier, extra: Record<string, unknown> = {}): Record<string, string> {
  return {
    IRIS_PROFILES: JSON.stringify({
      default: { host: "127.0.0.1", port: fake.port, namespace: ENTRY_NAMESPACE, username: "fake", password: PASSWORD, ...extra },
    }),
  };
}

describe("Story 45.7: the startup bootstrap of the default profile follows the IRIS_PROFILES `default` entry (DW-767)", () => {
  it("install on: every bootstrap request goes to the entry's instance under /PROBEX/, and nothing under USER (the IRIS_* instance is never contacted)", async () => {
    const fake = await startFake(ENTRY_NAMESPACE);
    const start = fake.requests.length;

    const run = await serve(CLOSED_IRIS_ENV, defaultEntry(fake), [{ tool: "iris_server_info", args: {} }]);
    const window = fake.requests.slice(start);
    const namespaced = namespacedRequests(window);

    expect(namespaced.length, "the bootstrap sent requests").toBeGreaterThan(embedded.classes.size);
    for (const request of namespaced) expect(request, "under the entry's namespace").toContain(`/${ENTRY_NAMESPACE}/`);
    expect(summarizeRequests(window).puts, "every embedded class was stored").toEqual([...embedded.classes.keys()]);
    expect(fake.state.compiledMarker, "and compiled").toBe(embedded.marker);
    expect(fake.state.configured, "and the web application registered").toBe(true);
    expect(run.stderr, "the IRIS_* closed port is never named").not.toMatch(/127\.0\.0\.1:1(?!\d)/);
    expect(run.stderr).not.toContain(PASSWORD);
    // mutation: `bootstrapConfig` back to `this.config` -> the requests go to /USER/, the fake answers 404 for it, and nothing is stored.
  }, TEST_TIMEOUT_MS);

  it("install off on a missing side: no write, and the warning and the refusal name the entry's host:port and PROBEX, never the IRIS_* instance", async () => {
    const fake = await startFake(ENTRY_NAMESPACE);
    const start = fake.requests.length;

    const run = await serve(CLOSED_IRIS_ENV, defaultEntry(fake, { autoInstall: false }), [{ tool: "iris_global_get", args: { global: "Story457Probe" } }]);
    const window = fake.requests.slice(start);

    expect(summarizeRequests(window).puts, "nothing was stored").toEqual([]);
    expect(summarizeRequests(window).compiles).toBe(0);
    expect(fake.state.docs.size).toBe(0);
    for (const request of namespacedRequests(window)) expect(request).toContain(`/${ENTRY_NAMESPACE}/`);

    const warnings = warnLines(run.stderr);
    expect(warnings, "exactly one bootstrap warning").toHaveLength(1);
    expect(warnings[0]).toContain(`the ExecuteMCPv2 classes are not installed in '${ENTRY_NAMESPACE}'`);
    expect(warnings[0]).toContain(`start one server against 127.0.0.1:${fake.port} `);
    expect(warnings[0]).not.toMatch(/127\.0\.0\.1:1(?!\d)/);
    expect(warnings[0]).not.toContain(`'${ENV_NAMESPACE}'`);

    const refusal = run.results[0];
    expect(refusal?.isError).toBe(true);
    expect(refusal?.structuredContent).toMatchObject({ code: "IRIS_SIDE_NOT_INSTALLED", profile: "default", namespace: ENTRY_NAMESPACE, found: "missing" });
    const text = refusal?.content?.[0]?.text ?? "";
    expect(text).toContain(`start one server against 127.0.0.1:${fake.port} `);
    expect(text).toContain(`in '${ENTRY_NAMESPACE}'`);
    expect(text).not.toMatch(/127\.0\.0\.1:1(?!\d)/);
    expect(run.stderr).not.toContain(PASSWORD);
  }, TEST_TIMEOUT_MS);

  it("the health-check continuation line names the default profile's host:port (a closed entry port), not IRIS_*", async () => {
    const run = await serve(
      { ...CLOSED_IRIS_ENV, host: "127.0.0.2", port: "3" },
      { IRIS_PROFILES: JSON.stringify({ default: { host: "127.0.0.1", port: 1, namespace: ENTRY_NAMESPACE } }) },
      [],
    );

    expect(run.stderr).toContain('Continuing startup without the "default" profile (127.0.0.1:1)');
    expect(run.stderr).not.toContain("127.0.0.2:3");
    // mutation: the line back to `this.config.host`/`this.config.port` -> it names 127.0.0.2:3.
  }, TEST_TIMEOUT_MS);

  it("an account whose filtered document list is empty (no SQL privileges) logs no Compile failed line: the unlisted classes are confirmed through action/index (DW-788)", async () => {
    const fake = await startFake(ENTRY_NAMESPACE);
    fake.docnamesEmpty = true;
    const start = fake.requests.length;

    const run = await serve(CLOSED_IRIS_ENV, defaultEntry(fake), [{ tool: "iris_server_info", args: {} }]);
    const window = fake.requests.slice(start);

    expect(fake.state.compiledMarker, "the side was installed and compiled").toBe(embedded.marker);
    expect(window.some((request) => request.method === "POST" && request.url.includes("/action/index")), "the fallback read ran").toBe(true);
    expect(run.stderr).not.toContain("Compile failed");
    expect(run.stderr).not.toContain("Bootstrap completed with errors");
    // mutation: the `action/index` fallback removed from `upToDateDocuments` -> `Compile failed: 35 of 35 classes did not compile` (the unit
    // pins are in verify-routines-compiled.test.ts; this leg runs it through the built server).
  }, TEST_TIMEOUT_MS);

  it("a refused Configure (the status row carries IRIS's text) is reported as Configure failed with that text, and the web application stays unregistered (DW-790)", async () => {
    const fake = await startFake(ENTRY_NAMESPACE);
    fake.configureRowText = "ERROR #5002: ObjectScript error: <PROTECT>Configure+9^ExecuteMCPv2.Setup.1";

    const run = await serve(CLOSED_IRIS_ENV, defaultEntry(fake), [{ tool: "iris_server_info", args: {} }]);

    expect(run.stderr).toContain("Configure failed: ERROR #5002: ObjectScript error: <PROTECT>Configure+9^ExecuteMCPv2.Setup.1");
    // The server's own verdict, as it logs it: no success line for the web application, and the manual instructions follow.
    expect(run.stderr, "a refused call never reads as configured").not.toContain("Bootstrap: web application configured successfully");
    expect(run.stderr, "the manual instructions are set").toContain("registration requires %Admin_Manage privileges");
    // mutation: the status row ignored (the code before this story) -> no `Configure failed` line, the success line is logged and
    // no manual instructions follow.
  }, TEST_TIMEOUT_MS);

  it("no default entry: the bootstrap is today's IRIS_* start, and it equals the start of an entry that repeats the IRIS_* fields", async () => {
    const plainFake = await startFake(ENV_NAMESPACE);
    const plainStart = plainFake.requests.length;
    const plain = await serve({ ...CLOSED_IRIS_ENV, port: String(plainFake.port) }, {}, [{ tool: "iris_server_info", args: {} }]);
    const plainWindow = plainFake.requests.slice(plainStart);

    const repeatFake = await startFake(ENV_NAMESPACE);
    const repeatStart = repeatFake.requests.length;
    const repeated = await serve(CLOSED_IRIS_ENV, { IRIS_PROFILES: JSON.stringify({ default: { host: "127.0.0.1", port: repeatFake.port, namespace: ENV_NAMESPACE } }) }, [
      { tool: "iris_server_info", args: {} },
    ]);
    const repeatWindow = repeatFake.requests.slice(repeatStart);

    const shape = (window: readonly FakeRequest[]) => {
      const summary = summarizeRequests(window);
      return { puts: summary.puts, compiles: summary.compiles, queries: summary.queries, others: summary.others };
    };
    expect(shape(plainWindow).puts, "the install stored every embedded class").toEqual([...embedded.classes.keys()]);
    for (const request of namespacedRequests(plainWindow)) expect(request).toContain(`/${ENV_NAMESPACE}/`);
    expect(shape(repeatWindow), "the same requests, in the same order").toEqual(shape(plainWindow));
    // The install-on run logs the same Bootstrap lines (apart from the request timings and ports).
    const lines = (stderr: string): string[] => stderr.split(/\r?\n/).filter((line) => line.startsWith("[INFO] Bootstrap:") || line.startsWith("[WARN] Bootstrap:"));
    expect(lines(repeated.stderr)).toEqual(lines(plain.stderr));
    expect(plainFake.state.compiledMarker).toBe(embedded.marker);
  }, TEST_TIMEOUT_MS);
});
