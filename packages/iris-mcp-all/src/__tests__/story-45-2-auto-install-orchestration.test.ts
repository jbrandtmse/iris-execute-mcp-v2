/**
 * Story 45.2 -- the hermetic orchestration test of the automatic-install setting, in the default suite. It drives the REAL built
 * `iris-dev-mcp` (its bootstrap, gateway and framework in the built shared dist) over the real stdio MCP client against the
 * STATEFUL fake Atelier listener of the 42.2 test, and pins the matrix rows of the spec:
 *
 * - the install off from each of the three channels (the read-only preset, `IRIS_AUTO_INSTALL=false`, the profile's own
 *   `autoInstall: false`), through startup and through the lazy `other` profile, on a `missing` and on a `stale` IRIS side:
 *   the server sends no write (PUT, DELETE, compile, `Setup_Configure`, `Setup_ConfigureMapping`,
 *   `Setup_EnsureUnitTestRoot`) and no request to `/api/executemcp/` at all, `iris_global_get` answers
 *   `IRIS_SIDE_NOT_INSTALLED` with the fields of the spec, `iris_server_info` (Atelier only) works, and exactly one `[WARN]` is logged;
 * - `unconfigured` (DW-772, decision #165) is NOT refused up front: one `[WARN]`, no write, the tool runs and its request is sent, and
 *   only the Web Gateway's HTML 404 of an absent web application answers `IRIS_SIDE_NOT_INSTALLED` (`found: "unconfigured"`), while a
 *   least-privilege account (`IsConfigured` answers `{Configured: false}`, the web application exists) just works;
 *   `current` is not refused (the custom REST call reaches the instance); and an
 *   `unknown` side (the version read fails over an existing `Setup` class) is not refused either: no write, one warning, the
 *   custom REST call runs (Planner ruling on decision #158);
 * - the setting is per profile: the `default` profile off beside a `p2` that installs;
 * - a conflict with the read-only preset, a malformed `IRIS_AUTO_INSTALL` and a non-boolean `autoInstall` end the process
 *   non-zero with `Fatal:` and a message naming the setting, before any request reaches IRIS;
 * - the password never appears in stderr or in a result.
 *
 * Needs no IRIS and no docker. It requires fresh dists of `@iris-mcp/shared` and `@iris-mcp/dev` and the built MCP client, and
 * FAILS (never skips) without them: a skip would only hide a broken gateway.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectionEnv,
  distEntry,
  inheritedEnv,
  openWireSession,
  resolveSdkEsmDir,
  spawnAndWaitForExit,
  staleDistReason,
  type IrisTarget,
} from "./process-gate-helpers.js";
import {
  loadEmbedded,
  runServerCalls,
  seedInstance,
  stampedEmbedded,
  type EmbeddedBootstrap,
  type ExtraCall,
  type ServerRun,
} from "./bootstrap-guard-legs.js";
import { startStatefulFakeAtelier, summarizeRequests, type FakeRequest, type StatefulFakeAtelier } from "./stateful-fake-atelier.js";
import { errorEnvelope } from "../../../../scripts/lib/fake-iris-listener.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const NAMESPACE = "USER";
const PASSWORD = "Pw-45-2-never-logged";
const TEST_TIMEOUT_MS = 90_000;

let embedded: EmbeddedBootstrap;
let sdkEsmDir: string;
const openFakes: StatefulFakeAtelier[] = [];

function targetOf(fake: StatefulFakeAtelier): IrisTarget {
  return { host: "127.0.0.1", port: String(fake.port), username: "fake", password: PASSWORD, namespace: NAMESPACE };
}

async function startFake(): Promise<StatefulFakeAtelier> {
  const fake = await startStatefulFakeAtelier({ namespace: NAMESPACE });
  openFakes.push(fake);
  return fake;
}

beforeAll(async () => {
  const stale = staleDistReason(REPO_ROOT, "shared") ?? staleDistReason(REPO_ROOT, "iris-dev-mcp");
  if (stale !== undefined) {
    throw new Error(
      `The hermetic automatic-install test runs the built iris-dev-mcp and shared dists and needs no IRIS, so a stale or missing ` +
        `dist fails it instead of skipping it: ${stale}`,
    );
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

// -- Oracles ------------------------------------------------------------------------------

/** The statements the spec counts as writes besides PUT, DELETE and a compile. */
const WRITING_STATEMENT = /Setup_(Configure|ConfigureMapping|EnsureUnitTestRoot)\(/;

/** Every write of a window: PUT, DELETE, a compile, or a query naming one of the three `Setup_*` configuration calls. */
function writesIn(window: readonly FakeRequest[]): string[] {
  return window
    .filter((request) => {
      if (request.method === "PUT" || request.method === "DELETE") return true;
      const pathname = new URL(request.url, "http://fake.invalid").pathname;
      if (request.method === "POST" && pathname.endsWith("/action/compile")) return true;
      return request.method === "POST" && pathname.endsWith("/action/query") && WRITING_STATEMENT.test(request.body);
    })
    .map((request) => `${request.method} ${request.url}`);
}

/** The requests of a window to the custom REST service. */
function customRestIn(window: readonly FakeRequest[]): string[] {
  return window.filter((request) => request.url.toLowerCase().startsWith("/api/executemcp/")).map((request) => `${request.method} ${request.url}`);
}

/** The requests of a window that reach the Atelier work queue, or run `Setup_EnsureUnitTestRoot` (which `iris_execute_tests` sends after its guard read). */
function workIn(window: readonly FakeRequest[]): string[] {
  return window
    .filter((request) => /\/work(\/|\?|$)/.test(new URL(request.url, "http://fake.invalid").pathname) || request.body.includes("Setup_EnsureUnitTestRoot"))
    .map((request) => `${request.method} ${request.url}`);
}

function warnLines(stderr: string): string[] {
  return stderr.split(/\r?\n/).filter((line) => line.startsWith("[WARN] Bootstrap:"));
}

const GLOBAL_GET: ExtraCall = { tool: "iris_global_get", args: { global: "Story452" } };
const SERVER_INFO: ExtraCall = { tool: "iris_server_info", args: {} };
/** The two real handlers that read the production guard on the custom REST service and then use the Atelier API (`/work`, `Setup_EnsureUnitTestRoot`). */
const EXECUTE_TESTS: ExtraCall = { tool: "iris_execute_tests", args: { target: "Story452.Tests.OrdersTest", level: "class" } };
const TEST_COVERAGE: ExtraCall = { tool: "iris_test_coverage", args: { target: "Story452.Tests.OrdersTest", level: "class", classes: ["Story452.Orders"] } };
/** `iris_execute_tests` and `iris_test_coverage` are writes that ship disabled: an explicit `true` enables each, over the read-only preset too (the cascade puts explicit settings first). */
const ENABLE_TEST_TOOLS = { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_execute_tests: true, iris_test_coverage: true } }) };

type Channel = "preset" | "variable" | "profile";

/** The way each channel turns the install off, for the server started `via` startup or the lazy `other` profile. */
const CHANNELS: ReadonlyArray<{
  channel: Channel;
  source: string;
  label: string;
  env: (via: "startup" | "other") => Record<string, string>;
  otherFields: Record<string, unknown>;
}> = [
  { channel: "preset", source: "IRIS_GOVERNANCE_PRESET", label: "IRIS_GOVERNANCE_PRESET=read-only", env: () => ({ IRIS_GOVERNANCE_PRESET: "read-only" }), otherFields: {} },
  { channel: "variable", source: "IRIS_AUTO_INSTALL", label: "IRIS_AUTO_INSTALL=false", env: () => ({ IRIS_AUTO_INSTALL: "false" }), otherFields: {} },
  {
    channel: "profile",
    source: "IRIS_PROFILES",
    label: "autoInstall: false in IRIS_PROFILES",
    // On the startup path the instance is `default`, whose entry carries the field; on the lazy path it is the `other` entry's.
    env: (via) => (via === "startup" ? { IRIS_PROFILES: JSON.stringify({ default: { autoInstall: false } }) } : {}),
    otherFields: { autoInstall: false },
  },
];

async function runOff(
  fake: StatefulFakeAtelier,
  via: "startup" | "other",
  channel: (typeof CHANNELS)[number],
  calls: readonly ExtraCall[] = [GLOBAL_GET, SERVER_INFO],
  extraEnv: Record<string, string> = {},
): Promise<{ run: ServerRun; window: FakeRequest[] }> {
  const start = fake.requests.length;
  const run = await runServerCalls(via, { repoRoot: REPO_ROOT, sdkEsmDir, target: targetOf(fake) }, { ...channel.env(via), ...extraEnv }, calls, channel.otherFields);
  return { run, window: fake.requests.slice(start) };
}

/** The oracles every run holds: the password is never written to stderr or returned. */
function assertNoPassword(run: ServerRun): void {
  expect(run.stderr).not.toContain(PASSWORD);
  expect(JSON.stringify(run.results)).not.toContain(PASSWORD);
}

// -- missing and stale, from each channel, through each path --------------------------------

describe("Story 45.2: the install off, on a missing and on a stale IRIS side", () => {
  for (const channel of CHANNELS) {
    for (const via of ["startup", "other"] as const) {
      for (const side of ["missing", "stale"] as const) {
        it(
          `${channel.channel} via ${via}, ${side}: no write, no custom-REST request, IRIS_SIDE_NOT_INSTALLED, iris_server_info works, one warning`,
          async () => {
            const fake = await startFake();
            let seededMarker: string | undefined;
            if (side === "stale") {
              const parsed = stampedEmbedded(embedded);
              seededMarker = `${parsed.semver.join(".")}+${parsed.sequence - 1n}.${parsed.hash}`;
              await seedInstance(targetOf(fake), embedded, { marker: seededMarker, perturb: true });
            }
            const docsBefore = new Map([...fake.state.docs].map(([name, doc]) => [name, doc.lines.join("\n")]));
            const markerBefore = fake.state.compiledMarker;

            const { run, window } = await runOff(fake, via, channel, [GLOBAL_GET, SERVER_INFO, EXECUTE_TESTS, TEST_COVERAGE], ENABLE_TEST_TOOLS);

            // Zero writes, and zero requests to the custom REST service, for the whole start and both calls.
            expect(writesIn(window)).toEqual([]);
            expect(customRestIn(window), "the refused call sent nothing to /api/executemcp/").toEqual([]);
            expect(workIn(window), "no /work request and no Setup_EnsureUnitTestRoot query reached the instance").toEqual([]);
            // The instance is byte-identical: nothing was stored, compiled or configured.
            expect(new Map([...fake.state.docs].map(([name, doc]) => [name, doc.lines.join("\n")]))).toEqual(docsBefore);
            expect(fake.state.compiledMarker).toBe(markerBefore);
            if (side === "missing") {
              expect(fake.state.docs.size).toBe(0);
              expect(fake.state.configured).toBe(false);
              expect(fake.state.mapped).toBe(false);
            }

            const [globalGet, serverInfo, executeTests, testCoverage] = run.results;
            expect(globalGet?.isError).toBe(true);
            expect(globalGet?.structuredContent).toEqual({
              code: "IRIS_SIDE_NOT_INSTALLED",
              profile: via === "startup" ? "default" : "other",
              namespace: NAMESPACE,
              found: side,
              ...(side === "stale" ? { deployedVersion: seededMarker } : {}),
              requiredVersion: embedded.marker,
              autoInstallSource: channel.source,
            });
            expect(globalGet?.content?.[0]?.text).toContain(`The automatic install is off for this profile (${channel.label})`);
            expect(serverInfo?.isError, "an Atelier-only tool works on a refused profile").toBeFalsy();
            // The real handlers: refused at the production guard read, with the same refusal, and nothing after it was sent.
            for (const real of [executeTests, testCoverage]) {
              expect(real?.isError).toBe(true);
              expect(real?.structuredContent).toEqual(globalGet?.structuredContent);
            }

            const warnings = warnLines(run.stderr);
            expect(warnings, "exactly one warning").toHaveLength(1);
            expect(warnings[0]).toContain(`the automatic install is off for profile "${via === "startup" ? "default" : "other"}" (${channel.label})`);
            expect(run.stderr).not.toContain("Bootstrap: upgrading REST service");
            expect(run.stderr).not.toContain("Bootstrap: REST service not found, running full install");
            assertNoPassword(run);
          },
          TEST_TIMEOUT_MS,
        );
      }
    }
  }

  it("the install ON installs the same missing side (the negative twin: the oracles can see a write)", async () => {
    const fake = await startFake();
    const start = fake.requests.length;
    const run = await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target: targetOf(fake) }, {}, [SERVER_INFO]);
    const window = fake.requests.slice(start);
    expect(writesIn(window).length).toBeGreaterThan(embedded.classes.size);
    expect(summarizeRequests(window).puts).toHaveLength(embedded.classes.size);
    expect(fake.state.compiledMarker).toBe(embedded.marker);
    expect(warnLines(run.stderr)).toEqual([]);
    expect(run.stderr, "the install on says nothing about the setting").not.toContain("automatic install");
  }, TEST_TIMEOUT_MS);

  it("the install ON (unset, and IRIS_AUTO_INSTALL=true) on a current side: no refusal, no line about the automatic install, no write", async () => {
    for (const env of [{}, { IRIS_AUTO_INSTALL: "true" }]) {
      const fake = await startFake();
      await seedInstance(targetOf(fake), embedded, { marker: embedded.marker, perturb: false });
      const start = fake.requests.length;
      const run = await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target: targetOf(fake) }, env, [GLOBAL_GET]);
      const window = fake.requests.slice(start);
      expect(writesIn(window), JSON.stringify(env)).toEqual([]);
      expect(run.stderr, JSON.stringify(env)).not.toContain("automatic install");
      expect(run.stderr, JSON.stringify(env)).not.toContain("IRIS_SIDE_NOT_INSTALLED");
      expect(run.results[0]?.structuredContent?.["code"]).not.toBe("IRIS_SIDE_NOT_INSTALLED");
      expect(customRestIn(window).length, "the custom-REST call went out").toBeGreaterThan(0);
    }
  }, TEST_TIMEOUT_MS);
});

// -- unconfigured, current, unknown -----------------------------------------------------------

describe("Story 45.2: the other branches with the install off", () => {
  const preset = CHANNELS[0] as (typeof CHANNELS)[number];

  // DW-772 (decision #165): an `unconfigured` reading with the install off warns once and lets the tools go on; a call refuses
  // only when the web application then answers the Web Gateway's HTML 404 of an absent application.
  for (const channel of CHANNELS) {
    for (const via of ["startup", "other"] as const) {
      it(
        `${channel.channel} via ${via}, unconfigured and the web application REALLY absent: the tool runs, its request is sent, the HTML 404 answers IRIS_SIDE_NOT_INSTALLED (found: unconfigured), nothing written, one warning`,
        async () => {
          const fake = await startFake();
          await seedInstance(targetOf(fake), embedded, { marker: embedded.marker, perturb: false });
          fake.state.configured = false;
          fake.state.mapped = false;
          fake.webAppAbsent = true;

          const { run, window } = await runOff(fake, via, channel);

          expect(writesIn(window)).toEqual([]);
          expect(fake.state.configured).toBe(false);
          expect(customRestIn(window).length, "the request was SENT: no up-front refusal").toBeGreaterThan(0);
          expect(run.results[0]?.structuredContent).toMatchObject({ code: "IRIS_SIDE_NOT_INSTALLED", found: "unconfigured" });
          expect(run.results[0]?.content?.[0]?.text).toContain(`Do ##class(ExecuteMCPv2.Setup).Configure("${NAMESPACE}") as a user with %Admin_Manage also fixes this`);
          expect(run.results[1]?.isError, "iris_server_info (Atelier only) works").toBeFalsy();
          const warnings = warnLines(run.stderr);
          expect(warnings, "exactly one warning").toHaveLength(1);
          expect(warnings[0]).toContain("could not confirm that the /api/executemcp/v2 web application is registered");
          expect(warnings[0]).toContain(`Do ##class(ExecuteMCPv2.Setup).Configure("${NAMESPACE}") as a user with %Admin_Manage`);
          assertNoPassword(run);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        `${channel.channel} via ${via}, a least-privilege account (IsConfigured answers {Configured:false}, the web application exists): the custom-REST tool runs, one warning, nothing written`,
        async () => {
          const fake = await startFake();
          await seedInstance(targetOf(fake), embedded, { marker: embedded.marker, perturb: false });
          fake.isConfiguredReadsFalse = true;

          const { run, window } = await runOff(fake, via, channel);

          expect(writesIn(window)).toEqual([]);
          expect(customRestIn(window).length, "the custom-REST call went out").toBeGreaterThan(0);
          // The fake's installed web application answers an unknown route with the JSON envelope: the tool's own 404, not a refusal.
          expect(run.results[0]?.structuredContent?.["code"]).not.toBe("IRIS_SIDE_NOT_INSTALLED");
          expect(run.results[1]?.isError, "iris_server_info works").toBeFalsy();
          const warnings = warnLines(run.stderr);
          expect(warnings, "exactly one warning").toHaveLength(1);
          expect(warnings[0]).toContain("could not confirm that the /api/executemcp/v2 web application is registered");
          expect(warnings[0]).toContain("The account may not be able to read %SYS, or the web application is not registered.");
          expect(run.stderr).not.toContain("IRIS_SIDE_NOT_INSTALLED");
          assertNoPassword(run);
        },
        TEST_TIMEOUT_MS,
      );
    }
  }

  it("current: not refused (the custom REST call reaches the instance), the compile check still runs, one INFO line, no warning", async () => {
    const fake = await startFake();
    await seedInstance(targetOf(fake), embedded, { marker: embedded.marker, perturb: false });

    const { run, window } = await runOff(fake, "startup", preset);

    expect(writesIn(window)).toEqual([]);
    expect(customRestIn(window).length, "the call went out").toBeGreaterThan(0);
    expect(run.results[0]?.structuredContent?.["code"]).not.toBe("IRIS_SIDE_NOT_INSTALLED");
    expect(summarizeRequests(window).queries.some((query) => query.includes("%Dictionary.ClassDefinition")), "the compile check ran").toBe(true);
    expect(run.stderr).toContain('Bootstrap: the automatic install is off for profile "default" (IRIS_GOVERNANCE_PRESET=read-only); found current, nothing to install.');
    expect(warnLines(run.stderr)).toEqual([]);
  }, TEST_TIMEOUT_MS);

  it("unknown (the version read fails over an existing Setup class): no write, exactly one warning, and a custom-REST call is NOT refused", async () => {
    const fake = await startFake();
    await seedInstance(targetOf(fake), embedded, { marker: embedded.marker, perturb: true });
    fake.failVersionQuery = () => ({ kind: "reply", status: 500, body: errorEnvelope("ERROR #5002: ObjectScript error: <STORE>", 5002) });

    const { run, window } = await runOff(fake, "startup", preset);

    expect(writesIn(window)).toEqual([]);
    const warnings = warnLines(run.stderr);
    expect(warnings, "exactly one warning").toHaveLength(1);
    expect(warnings[0]).toContain("Bootstrap: leaving the ExecuteMCPv2 classes");
    expect(warnings[0]).toContain("the deployed marker could not be read");
    expect(customRestIn(window).length, "the custom-REST call ran: it reached the instance").toBeGreaterThan(0);
    expect(run.results[0]?.structuredContent?.["code"]).not.toBe("IRIS_SIDE_NOT_INSTALLED");
    expect(run.stderr).toContain("found unknown, nothing to install.");
  }, TEST_TIMEOUT_MS);
});

// -- unknown, an older marker whose ownership cannot be read (Planner ruling on decision #158, 3a) ---------------------

describe("Story 45.2: an older marker whose ownership read fails, with the install off (QA, on the built server)", () => {
  /** What each channel's warning gives as the way out. */
  const WAY_OUT: Record<Channel, string> = {
    preset: "without the read-only preset",
    variable: "with IRIS_AUTO_INSTALL unset or true",
    profile: "with the profile's autoInstall removed or true",
  };

  for (const channel of CHANNELS) {
    for (const via of ["startup", "other"] as const) {
      it(
        `${channel.channel} via ${via}: no write, exactly one warning that says the classes are older and gives the way out, tools go on unrefused`,
        async () => {
          const fake = await startFake();
          const parsed = stampedEmbedded(embedded);
          const seededMarker = `${parsed.semver.join(".")}+${parsed.sequence - 1n}.${parsed.hash}`;
          await seedInstance(targetOf(fake), embedded, { marker: seededMarker, perturb: true });
          fake.failGuardRead = true;
          const docsBefore = new Map([...fake.state.docs].map(([name, doc]) => [name, doc.lines.join("\n")]));

          const { run, window } = await runOff(fake, via, channel);

          expect(writesIn(window)).toEqual([]);
          expect(new Map([...fake.state.docs].map(([name, doc]) => [name, doc.lines.join("\n")]))).toEqual(docsBefore);
          expect(fake.state.compiledMarker).toBe(seededMarker);

          // Every warning of the run, apart from the unrelated notice that IRIS_PROFILES defines the reserved `default` profile.
          const warnings = run.stderr
            .split(/\r?\n/)
            .filter((line) => line.startsWith("[WARN]") && !line.includes('IRIS_PROFILES defines the reserved "default" profile'));
          expect(warnings, "exactly one warning").toHaveLength(1);
          expect(warnings[0]).toContain("[WARN] Bootstrap:");
          const warning = warnings[0] as string;
          expect(warning).toContain("older than this server");
          expect(warning).toContain("may behave differently");
          expect(warning).toContain(JSON.stringify(seededMarker));
          expect(warning).toContain(`(${channel.label})`);
          expect(warning).toContain(`start one server against 127.0.0.1:${fake.port} ${WAY_OUT[channel.channel]}`);
          expect(warning).toContain("zpm \"install ");

          const [globalGet, serverInfo] = run.results;
          expect(customRestIn(window).length, "the custom-REST call ran: it reached the instance").toBeGreaterThan(0);
          expect(globalGet?.structuredContent?.["code"]).not.toBe("IRIS_SIDE_NOT_INSTALLED");
          expect(serverInfo?.isError).toBeFalsy();
          assertNoPassword(run);
        },
        TEST_TIMEOUT_MS,
      );
    }
  }
});

// -- per profile ---------------------------------------------------------------------------

describe("Story 45.2: the setting is per profile", () => {
  it("default off (IRIS_PROFILES) refuses and sends no write; p2, which does not inherit it, installs on its own instance", async () => {
    const defaultFake = await startFake();
    const p2Fake = await startFake();
    const p2 = targetOf(p2Fake);
    let stderr = "";
    const session = await openWireSession(
      {
        sdkEsmDir,
        entry: distEntry(REPO_ROOT, "iris-dev-mcp"),
        target: targetOf(defaultFake),
        clientName: "story-45-2-per-profile",
        onStderr: (chunk) => {
          stderr += chunk;
        },
      },
      {
        IRIS_PROFILES: JSON.stringify({
          default: { autoInstall: false },
          p2: { host: p2.host, port: Number(p2.port), username: p2.username, password: p2.password, namespace: p2.namespace },
        }),
      },
    );
    try {
      const own = (await session.raw("iris_global_get", { global: "Story452" })) as ServerRun["results"][number];
      const info = (await session.raw("iris_server_info", { server: "p2" })) as ServerRun["results"][number];
      const other = (await session.raw("iris_global_get", { global: "Story452", server: "p2" })) as ServerRun["results"][number];

      expect(own.structuredContent).toMatchObject({ code: "IRIS_SIDE_NOT_INSTALLED", profile: "default", autoInstallSource: "IRIS_PROFILES" });
      expect(writesIn(defaultFake.requests), "the refused profile's instance received no write").toEqual([]);
      expect(customRestIn(defaultFake.requests)).toEqual([]);

      expect(info.isError).toBeFalsy();
      expect(summarizeRequests(p2Fake.requests).puts, "p2 installed its classes").toHaveLength(embedded.classes.size);
      expect(p2Fake.state.compiledMarker).toBe(embedded.marker);
      expect(customRestIn(p2Fake.requests).length, "p2's custom-REST call went out").toBeGreaterThan(0);
      expect(other.structuredContent?.["code"]).not.toBe("IRIS_SIDE_NOT_INSTALLED");
      expect(stderr).not.toContain(PASSWORD);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT_MS);
});

// -- startup failures ---------------------------------------------------------------------

describe("Story 45.2: a conflict or a malformed value ends startup, before any request", () => {
  const CASES: ReadonlyArray<{ label: string; env: Record<string, string>; message: string[] }> = [
    {
      label: "IRIS_AUTO_INSTALL=true with the read-only preset",
      env: { IRIS_AUTO_INSTALL: "true", IRIS_GOVERNANCE_PRESET: "read-only" },
      message: ["IRIS_AUTO_INSTALL=true", "IRIS_GOVERNANCE_PRESET=read-only", "Unset IRIS_AUTO_INSTALL"],
    },
    {
      label: "a profile's autoInstall: true with the read-only preset",
      env: { IRIS_PROFILES: JSON.stringify({ p2: { autoInstall: true } }), IRIS_GOVERNANCE_PRESET: "read-only" },
      message: ["IRIS_PROFILES", 'profile "p2"', "autoInstall", "IRIS_GOVERNANCE_PRESET=read-only"],
    },
    { label: "IRIS_AUTO_INSTALL=yes", env: { IRIS_AUTO_INSTALL: "yes" }, message: ['IRIS_AUTO_INSTALL must be "true" or "false"'] },
    {
      label: 'autoInstall: "true" (a string)',
      env: { IRIS_PROFILES: JSON.stringify({ p2: { autoInstall: "true" } }) },
      message: ["IRIS_PROFILES", 'profile "p2": "autoInstall" must be a boolean (true/false).'],
    },
  ];

  for (const { label, env, message } of CASES) {
    it(
      `${label}: exit non-zero with Fatal:, the message, and nothing sent to IRIS`,
      async () => {
        const fake = await startFake();
        const outcome = await spawnAndWaitForExit(
          distEntry(REPO_ROOT, "iris-dev-mcp"),
          [],
          { ...inheritedEnv(), ...connectionEnv(targetOf(fake)), ...env },
          45_000,
        );
        expect(outcome.timedOut).toBe(false);
        expect(outcome.code).not.toBe(0);
        expect(outcome.stderr).toContain("Fatal:");
        for (const part of message) expect(outcome.stderr).toContain(part);
        expect(outcome.stderr).not.toContain(PASSWORD);
        expect(fake.requests, "no request reached IRIS").toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );
  }

  it("an empty IRIS_AUTO_INSTALL is unset: the server starts and installs", async () => {
    const fake = await startFake();
    await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target: targetOf(fake) }, { IRIS_AUTO_INSTALL: "" }, [SERVER_INFO]);
    expect(fake.state.compiledMarker).toBe(embedded.marker);
  }, TEST_TIMEOUT_MS);
});
