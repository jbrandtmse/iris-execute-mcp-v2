/**
 * Epic 45 capstone gate (Story 45.5; Rules #21 and #59; decision #166): the four points of GitHub issue #1 through the REAL surfaces.
 * It is the epic-done gate and runs in the DEFAULT suite. The hermetic legs drive the BUILT dists over stdio with the real SDK client
 * against a local 503 listener or the stateful fake Atelier; they need no IRIS, and they FAIL (never skip) on a stale or missing dist,
 * because a skip would only hide a broken gate. The armed leg runs against a throwaway IRIS only.
 *
 * Each point names its oracle, the mutation that turns it red and the PATH that mutation runs on (Rule #59: "it passes" and "it would
 * fail if broken" are different claims, and only the second is evidence). The mutations are recorded in the story spec under
 * `## Verification`; each one is a temporary edit that is restored, with the tree byte-identical afterwards.
 *
 *  P1  issue point 1: `IRIS_DATA_POLICY=block` turns off the 12 declared raw-read and code-execution keys.
 *      Oracle: the denial of each key (`GOVERNANCE_DISABLED` + `dataPolicyApplied: "block"`), the 503 listener's request count (0), the
 *      hand-written startup warning text and its pointer, and the declaration `DATA_POLICY_BLOCK_KEYS` of the built shared dist.
 *      Mutation: delete the `dataPolicySeed(...)` term of the cascade (`governance.ts`, the `effective` function) and rebuild shared.
 *      Path: stdio `tools/call` -> `handleToolCall`'s gate in the shared dist that each built server loads.
 *  P2  issue point 2: the README section says what the code does. Oracle: the section's `block` list against `DATA_POLICY_BLOCK_KEYS`
 *      (built shared dist), its not-covered list against `DATA_POLICY_SCOPE`, its five procedures against the `[ SqlProc ]` methods of the
 *      embed, and the SqlProc-in-SELECT and account-boundary sentences. Mutation: drop `iris_docdb_find` from `DATA_POLICY_BLOCK_KEYS` and
 *      rebuild (P2 and P1 go red), then delete the README's SqlProc-in-SELECT sentence (P2 goes red). Path: README text against the built
 *      shared dist.
 *  P3  issue point 3: a read-only connection installs nothing. Oracle: the stateful fake's recorded requests (no PUT, DELETE, compile,
 *      `Setup_Configure`, `Setup_ConfigureMapping` or `Setup_EnsureUnitTestRoot`) and `IRIS_SIDE_NOT_INSTALLED` from the custom-REST tool.
 *      Mutation: return `{autoInstall: true}` instead of false for the read-only preset (`auto-install.ts`, `resolveAutoInstall`) and rebuild
 *      shared. Path: `McpServerBase.start` -> `bootstrap` in the built dev process.
 *  P4  issue point 4: the SQL route prepares with SQL privilege checking on. Oracle: the document the built server uploads, `ExecuteMCPv2.REST.Sql`
 *      (exactly one `%Prepare(`, and its second argument is 1), and the `iris_sql_query` body the server sends to `/dev/sql/execute`
 *      (only the route's own control keys, no privilege field). Mutation: `%Prepare(.pQuery, 0)` (checking off) in `Sql.cls`,
 *      `pnpm run gen:bootstrap`, rebuild shared (the files are restored byte for byte afterwards). Path: the built server's Atelier PUT.
 *      This leg is a text pin: `%Prepare(.pQuery)` also turns it red but changes no behavior, because `checkPriv` defaults to 1
 *      (`%SQL.Statement.%Prepare`); the behavior twin is P5 below.
 *  LP-hermetic (install off, an `IsConfigured` that cannot see the web application): read-only, a current side, `IsConfigured`
 *      answering `{Configured: false}`. From Story 45.6 a least-privilege account reads the web application through the CSP application
 *      lookup, so this state stands for a lookup that fails, not for every such account.
 *      Oracle: no write, one could-not-confirm `[WARN]`, and the custom-REST call is sent and answered. Mutation (P6): make the install-off
 *      `unconfigured` branch refuse up front (45.2's state before decision #165) in `bootstrap.ts` and rebuild shared. Path: the built dev gateway.
 *  LP-armed (`IRIS_REQUIRE_LIVE`, a throwaway-shaped target): a disposable account with `%Development:U` and `R` on the namespace's database
 *      resource(s), the read-only preset. Oracle: `_SYSTEM`'s own Atelier rows and document reads, never the code under test. Mutation (P5, the
 *      lead's smoke on a local throwaway): P4's `Sql.cls` mutation, `%Prepare(.pQuery, 0)`, deployed; the ungranted-SELECT and
 *      `Setup_ConfigureMapping` legs go red (`SQLCODE -99` is gone). Path: the real `/dev/sql/execute` through the built server. CI runs
 *      this leg in `suite prepublish-all` (it is in `gateTestFiles`).
 *      Two of its checks are preconditions, not oracles: the `%ALL` mapping is already in place (the `_SYSTEM` start maps it), so
 *      `ConfigureMapping` would leave it as it is even if it ran, and the account holds only `R`, so IRIS would refuse a class write even
 *      with the install on. The `SQLCODE -99` answers and the start's lack of a could-not-confirm warning (Story 45.6, DW-773: the
 *      account reads the installed side as `current`) are the oracles; the install-off behavior itself is proven hermetically by P3
 *      and LP-hermetic.
 *
 * Needs no IRIS except the armed leg. Cross-package checks live in `@iris-mcp/all` (rule #45).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDeployedBootstrapVersion,
  atelierDocument,
  atelierQuery,
  distEntry,
  firstText,
  governanceDenial,
  governanceReport,
  irisTargetFromEnv,
  openWireSession,
  postEnvelope,
  rawIrisRequest,
  resolveSdkEsmDir,
  skipIfReason,
  staleDistReason,
  start503Stub,
  stubTarget,
  teardownRecorder,
  type IrisTarget,
  type Stub503,
  type WireSession,
  type WireToolResult,
} from "./process-gate-helpers.js";
import {
  customRestIn,
  loadEmbedded,
  runServerCalls,
  seedInstance,
  writesIn,
  type EmbeddedBootstrap,
  type ExtraCall,
} from "./bootstrap-guard-legs.js";
import { startStatefulFakeAtelier, summarizeRequests, type StatefulFakeAtelier } from "./stateful-fake-atelier.js";
import { markdownHeadingSlugs } from "./pack-fixture.js";
import { DATA_POLICY_SCOPE } from "./data-policy-scope.js";
import {
  README,
  SECTION_SLUG,
  SECTION_TITLE,
  blockListInReadme,
  embeddedSetupProcedures,
  loadSharedDist,
  notCoveredInReadme,
  proceduresInReadme,
  sectionOf,
  squash,
} from "./story-45-5-section.js";
import { liveGateTarget } from "../../../shared/src/test-helpers/live-target.js";
import { throwawayEnvProblems } from "../../../../scripts/throwaway-iris.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** The armed leg's contract: unarmed it skips before any request; armed it never skips. */
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";
const LIVE = liveGateTarget();

const PACKAGES = { dev: "iris-dev-mcp", interop: "iris-interop-mcp", data: "iris-data-mcp" } as const;
type Server = keyof typeof PACKAGES;

const TEST_TIMEOUT_MS = 120_000;
const FAKE_NAMESPACE = "USER";

// -- The hermetic preparation: a stale or missing dist FAILS ---------------------------------------------

interface Hermetic {
  sdkEsmDir: string;
  embedded: EmbeddedBootstrap;
  blockKeys: readonly string[];
}

let hermeticPromise: Promise<Hermetic> | undefined;

/** Check the built dists and the SDK once; throws (so the leg fails) when one is stale or missing. */
function hermetic(): Promise<Hermetic> {
  hermeticPromise ??= (async () => {
    const stale = ["shared", ...Object.values(PACKAGES)].map((pkg) => staleDistReason(REPO_ROOT, pkg)).find((reason) => reason !== undefined);
    if (stale !== undefined) {
      throw new Error(
        `The Epic 45 capstone drives the built dists and needs no IRIS for its hermetic legs, so a stale or missing dist FAILS it instead of skipping it: ${stale}`,
      );
    }
    const sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (sdkEsmDir === undefined) {
      throw new Error("Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm; run pnpm install from the repo root.");
    }
    const embedded = await loadEmbedded(REPO_ROOT);
    const { DATA_POLICY_BLOCK_KEYS } = await loadSharedDist<{ DATA_POLICY_BLOCK_KEYS: readonly string[] }>("data-policy.js");
    return { sdkEsmDir, embedded, blockKeys: DATA_POLICY_BLOCK_KEYS };
  })();
  return hermeticPromise;
}

// -- P1: the covered keys ----------------------------------------------------------------------------------

interface Covered {
  key: string;
  tool: string;
  args: Record<string, unknown>;
}

/** The declared keys with arguments that pass each tool's schema, by the server that registers them. */
const COVERED: Record<Server, Covered[]> = {
  dev: [
    { key: "iris_sql_query", tool: "iris_sql_query", args: { query: "SELECT 1" } },
    { key: "iris_sql_execute", tool: "iris_sql_execute", args: { query: "SELECT 1" } },
    { key: "iris_global_get", tool: "iris_global_get", args: { global: "Epic45Probe" } },
    { key: "iris_global_list", tool: "iris_global_list", args: {} },
    { key: "iris_execute_command", tool: "iris_execute_command", args: { command: 'Write "x"' } },
    { key: "iris_execute_classmethod", tool: "iris_execute_classmethod", args: { className: "Epic45.Probe", methodName: "Run" } },
    { key: "iris_execute_tests", tool: "iris_execute_tests", args: { target: "Epic45.Tests", level: "package" } },
    { key: "iris_test_coverage", tool: "iris_test_coverage", args: { target: "Epic45.Tests", level: "package", classes: ["Epic45.Probe"] } },
  ],
  interop: [{ key: "iris_transform_test", tool: "iris_transform_test", args: { className: "Epic45.Dtl", sourceClass: "Epic45.Source" } }],
  data: [
    { key: "iris_docdb_document:get", tool: "iris_docdb_document", args: { action: "get", database: "Epic45", id: "1" } },
    { key: "iris_docdb_document:delete", tool: "iris_docdb_document", args: { action: "delete", database: "Epic45", id: "1" } },
    { key: "iris_docdb_find", tool: "iris_docdb_find", args: { database: "Epic45", filter: {} } },
  ],
};

/** The keys each default (`redact`) server names in its warning: a dev `iris_test_coverage` is a disabled write, so it is not named. */
const WARNED: Record<Server, string[]> = {
  dev: COVERED.dev.map((entry) => entry.key).filter((key) => key !== "iris_test_coverage"),
  interop: ["iris_transform_test"],
  data: ["iris_docdb_document:get", "iris_docdb_document:delete", "iris_docdb_find"],
};

/** The pointer the warning ends with (decision #170): the title of the README section. */
const POINTER = `See "${SECTION_TITLE}" in the README.`;

/** The hand-written text of the `redact`-only warning (decision #170 item 2, amended for #172). */
const redactWarning = (groups: string): string =>
  '[WARN] Data policy: "redact" covers message bodies only, so these raw-read and code-execution tools are enabled and their results are ' +
  `not redacted or withheld: ${groups}. To turn tools off, set their governance keys to false (IRIS_GOVERNANCE or IRIS_GOVERNANCE_FILE) ` +
  `or set IRIS_DATA_POLICY=block. ${POINTER}`;

/** The hand-written text of the `block`-only warning: an explicit key re-enabled these tools. */
const blockWarning = (groups: string): string =>
  '[WARN] Data policy: an explicit governance key re-enabled these raw-read and code-execution tools under "block", so their results are ' +
  `not withheld: ${groups}. To turn them off again, remove those keys or set them to false in the setting named. ${POINTER}`;

interface Served {
  session: WireSession;
  stub: Stub503;
  stderr: () => string;
}

/** Start the built `server` against a fresh 503 listener with `env`, run `body`, and always tear both down. */
async function serve<T>(sdkEsmDir: string, server: Server, env: Record<string, string>, body: (served: Served) => Promise<T>): Promise<T> {
  const stub = await start503Stub();
  let stderr = "";
  try {
    const session = await openWireSession(
      {
        sdkEsmDir,
        entry: distEntry(REPO_ROOT, PACKAGES[server]),
        target: stubTarget(stub.port, "epic45-capstone"),
        clientName: "epic45-capstone-gate",
        onStderr: (chunk) => {
          stderr += chunk;
        },
      },
      env,
    );
    try {
      return await body({ session, stub, stderr: () => stderr });
    } finally {
      await session.close();
    }
  } finally {
    await stub.close();
  }
}

/** The data-policy warning lines the server wrote to stderr so far. */
const warningLines = (served: Served): string[] => served.stderr().split("\n").filter((line) => line.includes("Data policy:"));

/** Call `entry` and report its result and how many requests the listener saw because of the call. */
async function callCounted(served: Served, entry: Covered): Promise<{ result: WireToolResult; requests: number }> {
  const before = served.stub.requests.length;
  const result = await served.session.callOn("default", entry.tool, entry.args);
  return { result, requests: served.stub.requests.length - before };
}

const isDenied = (result: WireToolResult): boolean => (result.structuredContent as { code?: string } | undefined)?.code === "GOVERNANCE_DISABLED";

describe("Epic 45 capstone P1 (issue point 1): block turns off the declared raw-read and code-execution keys, on the built servers", () => {
  let prepared: Hermetic;
  beforeAll(async () => {
    prepared = await hermetic();
  });

  it("the keys this gate drives are exactly the declaration of the built shared dist (12 keys)", () => {
    const driven = Object.values(COVERED).flat().map((entry) => entry.key);
    expect(prepared.blockKeys).toHaveLength(12);
    expect([...driven].sort()).toEqual([...prepared.blockKeys].sort());
    expect(new Set(driven).size).toBe(driven.length);
  });

  for (const server of ["dev", "interop", "data"] as const) {
    it(
      `${server}: under block each declared key answers GOVERNANCE_DISABLED with dataPolicyApplied, the listener sees no request, and no data-policy warning is written`,
      async () => {
        await serve(prepared.sdkEsmDir, server, { IRIS_DATA_POLICY: "block" }, async (served) => {
          for (const entry of COVERED[server]) {
            const { result, requests } = await callCounted(served, entry);
            expect(result.isError, entry.key).toBe(true);
            expect(result.structuredContent, entry.key).toEqual(governanceDenial(entry.key, { dataPolicyApplied: "block" }));
            expect(firstText(result), entry.key).toBe(`action '${entry.key}' is disabled by governance policy for server 'default' (data policy 'block')`);
            expect(requests, `${entry.key}: a denied call sends nothing to IRIS`).toBe(0);
          }
          const report = await governanceReport(served.session);
          for (const entry of COVERED[server]) {
            expect(report.policy[entry.key], entry.key).toBe(false);
            expect(report.configSource[entry.key], entry.key).toBe("dataPolicy");
          }
          // Read after every call and the report, so the startup stderr has long arrived: an empty list here is a real absence.
          expect(warningLines(served), "block names nothing: no tool is open").toEqual([]);
        });
      },
      TEST_TIMEOUT_MS,
    );
  }

  it(
    "an explicit governance key re-enables iris_sql_query: the call reaches IRIS, and the one warning names exactly that key and ends with the pointer",
    async () => {
      const env = { IRIS_DATA_POLICY: "block", IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_query: true } }) };
      await serve(prepared.sdkEsmDir, "dev", env, async (served) => {
        expect(warningLines(served)).toEqual([blockWarning('profile "default" (block, re-enabled by an explicit governance key): iris_sql_query from IRIS_GOVERNANCE')]);
        expect(warningLines(served)[0]?.endsWith(POINTER)).toBe(true);
        const query = COVERED.dev[0] as Covered;
        const reached = await callCounted(served, query);
        expect(isDenied(reached.result), "the re-enabled key is not denied").toBe(false);
        expect(reached.requests, "the re-enabled call reached the listener").toBeGreaterThan(0);
        const other = await callCounted(served, COVERED.dev[1] as Covered);
        expect(other.result.structuredContent).toEqual(governanceDenial("iris_sql_execute", { dataPolicyApplied: "block" }));
        expect(other.requests).toBe(0);
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the default policy (redact) keeps every tool and names the open ones: dev 7, interop 1 and data 3 keys, each enabled in iris_server_profiles, and the pointer resolves in the README",
    async () => {
      for (const server of ["dev", "interop", "data"] as const) {
        await serve(prepared.sdkEsmDir, server, {}, async (served) => {
          const lines = warningLines(served);
          expect(lines, server).toEqual([redactWarning(`profile "default" (redact): ${WARNED[server].join(", ")}`)]);
          const report = await governanceReport(served.session);
          for (const key of WARNED[server]) expect(report.policy[key], `${server}: ${key} is enabled`).toBe(true);
          // Every call of a named key passes the gate and reaches the listener.
          for (const entry of COVERED[server].filter((candidate) => WARNED[server].includes(candidate.key))) {
            const { result, requests } = await callCounted(served, entry);
            expect(isDenied(result), `${server}: ${entry.key}`).toBe(false);
            expect(requests, `${server}: ${entry.key} reached the listener`).toBeGreaterThan(0);
          }
          const title = /See "([^"]+)" in the README\.$/.exec(lines[0] ?? "")?.[1];
          expect(title, `${server}: the warning quotes a title`).toBe(SECTION_TITLE);
          expect(README, "a `## ` heading of the README carries the quoted title").toMatch(new RegExp(`^## ${title}$`, "m"));
          expect(markdownHeadingSlugs(README).has(SECTION_SLUG)).toBe(true);
        });
      }
    },
    TEST_TIMEOUT_MS * 2,
  );
});

// -- P2: the README section against the built dists --------------------------------------------------------

describe("Epic 45 capstone P2 (issue point 2): the README section matches the built dists", () => {
  let prepared: Hermetic;
  beforeAll(async () => {
    prepared = await hermetic();
  });

  const section = sectionOf();
  const flat = squash(section);

  it("the section exists", () => {
    expect(section, "the README has the section").not.toBe("");
  });

  it("its block list equals DATA_POLICY_BLOCK_KEYS of the built shared dist, in order", () => {
    expect(blockListInReadme(section)).toEqual([...prepared.blockKeys]);
  });

  it("its not-covered list names residual rows of the scope table (and the Event Log text, governed under block only)", () => {
    const listed = notCoveredInReadme(section);
    expect(listed.length).toBeGreaterThan(0);
    for (const tool of listed) {
      const row = DATA_POLICY_SCOPE[tool];
      expect(row, `${tool} has a row in the scope table`).toBeDefined();
      if (tool === "iris_production_logs") expect(row?.reason).toContain("Governed under block only");
      else expect(row?.scope, `${tool} is residual`).toBe("residual");
    }
  });

  it("its five procedures equal the [ SqlProc ] methods of ExecuteMCPv2.Setup in the embed, and Uninstall is not one of them", async () => {
    const fromEmbed = await embeddedSetupProcedures();
    expect(fromEmbed).toHaveLength(5);
    expect(proceduresInReadme(section).slice().sort()).toEqual(fromEmbed.slice().sort());
    expect(fromEmbed).not.toContain("Uninstall");
  });

  it("it says a SELECT can call a SqlProc method and that the account's privileges are the boundary", () => {
    expect(flat).toContain("A `SELECT` can call a `SqlProc` method, which runs with the account's privileges.");
    expect(flat).toContain("Anyone who holds the same account can call `/api/executemcp/v2`, the Atelier API or a terminal directly, and none of these settings applies to that call.");
    expect(flat).toContain("The account's own privileges are the boundary");
  });
});

// -- P3 and the least-privilege leg: a read-only connection installs nothing --------------------------------

/** A fake Atelier listener per leg, closed in afterAll. */
const openFakes: StatefulFakeAtelier[] = [];
const PASSWORD = "Pw-epic45-never-logged";
const GLOBAL_GET: ExtraCall = { tool: "iris_global_get", args: { global: "Epic45" } };
const SERVER_INFO: ExtraCall = { tool: "iris_server_info", args: {} };

function targetOf(fake: StatefulFakeAtelier): IrisTarget {
  return { host: "127.0.0.1", port: String(fake.port), username: "fake", password: PASSWORD, namespace: FAKE_NAMESPACE };
}

async function startFake(): Promise<StatefulFakeAtelier> {
  const fake = await startStatefulFakeAtelier({ namespace: FAKE_NAMESPACE });
  openFakes.push(fake);
  return fake;
}

afterAll(async () => {
  await Promise.all(openFakes.splice(0).map((fake) => fake.close()));
});

const bootstrapWarnings = (stderr: string): string[] => stderr.split(/\r?\n/).filter((line) => line.startsWith("[WARN] Bootstrap:"));

describe("Epic 45 capstone P3 (issue point 3): a read-only connection installs nothing", () => {
  let prepared: Hermetic;
  beforeAll(async () => {
    prepared = await hermetic();
  });

  it(
    "read-only preset on a server with no IRIS side: no write, no custom-REST request, iris_global_get answers IRIS_SIDE_NOT_INSTALLED, iris_server_info works",
    async () => {
      const fake = await startFake();
      const start = fake.requests.length;
      const run = await runServerCalls(
        "startup",
        { repoRoot: REPO_ROOT, sdkEsmDir: prepared.sdkEsmDir, target: targetOf(fake) },
        { IRIS_GOVERNANCE_PRESET: "read-only" },
        [GLOBAL_GET, SERVER_INFO],
      );
      const window = fake.requests.slice(start);
      expect(writesIn(window), "no PUT, DELETE, compile, Setup_Configure, Setup_ConfigureMapping or Setup_EnsureUnitTestRoot").toEqual([]);
      expect(customRestIn(window), "the refused call sent nothing to /api/executemcp/").toEqual([]);
      expect(fake.state.docs.size, "nothing was stored").toBe(0);
      expect(fake.state.configured).toBe(false);
      expect(fake.state.mapped).toBe(false);
      const [globalGet, serverInfo] = run.results;
      expect(globalGet?.isError).toBe(true);
      expect(globalGet?.structuredContent).toMatchObject({ code: "IRIS_SIDE_NOT_INSTALLED", found: "missing", namespace: FAKE_NAMESPACE, autoInstallSource: "IRIS_GOVERNANCE_PRESET" });
      expect(serverInfo?.isError, "an Atelier-only tool works on a refused profile").toBeFalsy();
      expect(bootstrapWarnings(run.stderr), "exactly one bootstrap warning").toHaveLength(1);
      expect(run.stderr).not.toContain(PASSWORD);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the negative twin: the same server without the preset installs the missing side, so the write oracle can see a write",
    async () => {
      const fake = await startFake();
      const start = fake.requests.length;
      const run = await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir: prepared.sdkEsmDir, target: targetOf(fake) }, {}, [SERVER_INFO]);
      const window = fake.requests.slice(start);
      expect(writesIn(window).length).toBeGreaterThan(prepared.embedded.classes.size);
      expect(summarizeRequests(window).puts).toHaveLength(prepared.embedded.classes.size);
      expect(fake.state.compiledMarker).toBe(prepared.embedded.marker);
      expect(run.stderr).not.toContain("IRIS_SIDE_NOT_INSTALLED");
    },
    TEST_TIMEOUT_MS,
  );
});

describe("Epic 45 capstone LP-hermetic (issue point 3, DW-772): the install off and an IsConfigured that cannot see the web application", () => {
  let prepared: Hermetic;
  beforeAll(async () => {
    prepared = await hermetic();
  });

  it(
    "read-only, a current side, IsConfigured answering {Configured: false}: no write, one could-not-confirm warning, and the custom-REST call is sent and answered",
    async () => {
      const fake = await startFake();
      await seedInstance(targetOf(fake), prepared.embedded, { marker: prepared.embedded.marker, perturb: false });
      fake.isConfiguredReadsFalse = true;
      const start = fake.requests.length;
      const run = await runServerCalls(
        "startup",
        { repoRoot: REPO_ROOT, sdkEsmDir: prepared.sdkEsmDir, target: targetOf(fake) },
        { IRIS_GOVERNANCE_PRESET: "read-only" },
        [GLOBAL_GET, SERVER_INFO],
      );
      const window = fake.requests.slice(start);
      expect(writesIn(window), "nothing was written").toEqual([]);
      const warnings = bootstrapWarnings(run.stderr);
      expect(warnings, "exactly one warning").toHaveLength(1);
      expect(warnings[0]).toContain("could not confirm that the /api/executemcp/v2 web application is registered");
      expect(customRestIn(window).length, "the custom-REST call was sent").toBeGreaterThan(0);
      // The fake serves no custom-REST route: its web application answers an unknown route with the JSON error envelope, so the tool's own
      // error comes back. It is an answer, and it is not the refusal.
      expect(run.results[0], "the call was answered").toBeDefined();
      expect(run.results[0]?.isError).toBe(true);
      expect(run.results[0]?.structuredContent?.["code"]).not.toBe("IRIS_SIDE_NOT_INSTALLED");
      expect(run.results[1]?.isError, "iris_server_info works").toBeFalsy();
      expect(run.stderr).not.toContain("IRIS_SIDE_NOT_INSTALLED");
      expect(run.stderr).not.toContain(PASSWORD);
    },
    TEST_TIMEOUT_MS,
  );
});

// -- P4: the SQL route prepares with privilege checking on --------------------------------------------------

/** The keys the route's `ReadControls` (and `ReadFlag`) read, from the class text the server uploads. */
function routeControlKeys(sqlClass: string): string[] {
  const start = sqlClass.indexOf("ClassMethod ReadControls(");
  const end = sqlClass.indexOf("ClassMethod Perform(");
  if (start < 0 || end < start) throw new Error("ExecuteMCPv2.REST.Sql has no ReadControls ahead of Perform");
  const body = sqlClass.slice(start, end);
  const keys = new Set<string>();
  for (const match of body.matchAll(/%IsDefined\("(\w+)"\)/g)) keys.add(match[1] as string);
  for (const match of body.matchAll(/ReadFlag\(pBody, "(\w+)"/g)) keys.add(match[1] as string);
  return [...keys];
}

describe("Epic 45 capstone P4 (issue point 4): the SQL route the built server uploads prepares with privilege checking on", () => {
  let prepared: Hermetic;
  beforeAll(async () => {
    prepared = await hermetic();
  });

  it(
    "the PUT of ExecuteMCPv2.REST.Sql.cls holds exactly one %Prepare( and it is %Prepare(.pQuery, 1); the iris_sql_query body has only the route's control keys and no privilege field",
    async () => {
      const fake = await startFake();
      const start = fake.requests.length;
      const query: ExtraCall = { tool: "iris_sql_query", args: { query: "SELECT 1 AS One", namespace: FAKE_NAMESPACE } };
      await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir: prepared.sdkEsmDir, target: targetOf(fake) }, {}, [query]);
      const window = fake.requests.slice(start);

      const put = window.find((request) => request.method === "PUT" && request.url.includes("/doc/ExecuteMCPv2.REST.Sql.cls"));
      expect(put, "the server uploaded ExecuteMCPv2.REST.Sql.cls").toBeDefined();
      const uploaded = ((JSON.parse(put?.body ?? "{}") as { content?: unknown }).content ?? []) as string[];
      const sqlClass = uploaded.join("\n");
      expect(sqlClass).toContain("Class ExecuteMCPv2.REST.Sql");
      expect(sqlClass.match(/%Prepare\(/g)?.length, "exactly one %Prepare( in the uploaded class").toBe(1);
      expect(sqlClass).toContain("%Prepare(.pQuery, 1)");

      const sent = window.find((request) => request.method === "POST" && request.url.endsWith("/dev/sql/execute"));
      expect(sent, "iris_sql_query posted to /dev/sql/execute").toBeDefined();
      const body = JSON.parse(sent?.body ?? "{}") as Record<string, unknown>;
      const controls = routeControlKeys(sqlClass);
      expect(controls.slice().sort(), "the route's own controls").toEqual(["countOnly", "maxRowsAffected", "namespace", "parameters", "query", "readOnly"]);
      for (const key of Object.keys(body)) expect(controls, `the body key ${key} is one of the route's controls`).toContain(key);
      expect(Object.keys(body).filter((key) => /priv|check|grant/i.test(key)), "no privilege field").toEqual([]);
      expect(body["query"]).toBe("SELECT 1 AS One");
    },
    TEST_TIMEOUT_MS,
  );
});

// -- The armed least-privilege leg --------------------------------------------------------------------------

const STEM = "QaEpic45Cap";
const ROLE = `${STEM}Role`;
const USER = `${STEM}Lp`;
const TABLE_SCHEMA = "ExecuteMCPv2_Temp";
const GRANTED = `${TABLE_SCHEMA}.${STEM}Granted`;
const DENIED = `${TABLE_SCHEMA}.${STEM}Denied`;
const SETUP_DOCUMENT = "ExecuteMCPv2.Setup.cls";
const COULD_NOT_CONFIRM = "could not confirm that the /api/executemcp/v2 web application is registered";

let armedSkip: string | undefined = LIVE.skipReason;
let sysTarget: IrisTarget;
let lpTarget: IrisTarget;
let armedSdkDir = "";
let readOnlySession: WireSession | undefined;
let blockSession: WireSession | undefined;
let readOnlyStderr = "";
let setupBefore: { ts: string; content: string[] } | undefined;
let setupAfter: { ts: string; content: string[] } | undefined;
let mappingBefore = "";

/**
 * A %SYS read as `_SYSTEM`: the oracle for the configuration and the principals. The helper puts the namespace into the Atelier URL as
 * given, so the percent sign of `%SYS` is written already encoded.
 */
const sysQuery = (statement: string) => atelierQuery({ ...sysTarget, namespace: "%25SYS" }, statement);

/** The `%ALL` package mapping of `ExecuteMCPv2`, as `_SYSTEM` reads it (`Config.MapPackages`), as one comparable string. */
async function allMapping(): Promise<string> {
  const rows = await sysQuery("SELECT Namespace, Name, Database FROM Config.MapPackages WHERE Namespace = '%ALL' AND Name = 'ExecuteMCPv2'");
  return JSON.stringify(rows);
}

/** The resources that protect the databases of the namespace: its Globals and Routines databases, derived from the live configuration. */
async function namespaceDatabaseResources(namespace: string): Promise<string[]> {
  // The suite's own config route lists each namespace with its Globals and Routines databases (the `Config.Namespaces` SQL projection
  // returns one row per CPF section, so it is not a usable oracle here).
  const answer = await rawIrisRequest(sysTarget, "/api/executemcp/v2/config/namespace", { method: "GET" });
  expect(answer.status, "the namespace list answered").toBe(200);
  const listed = ((answer.json as { result?: Array<{ name?: string; globals?: string; routines?: string }> } | undefined)?.result ?? []) as Array<{
    name?: string;
    globals?: string;
    routines?: string;
  }>;
  const row = listed.find((entry) => entry.name?.toUpperCase() === namespace.toUpperCase());
  if (row === undefined) throw new Error(`the live configuration lists no namespace ${namespace}`);
  const databases = [...new Set([row.globals, row.routines].map((value) => String(value ?? "")).filter((value) => value !== ""))];
  // The resource of a database is `%DB_<NAME>` unless it was changed; the seeded throwaway uses the convention. A wrong guess fails closed:
  // the account's login or its granted SELECT goes red, never a false pass.
  return databases.map((name) => `%DB_${name.toUpperCase()}`);
}

async function countOf(statement: string): Promise<number> {
  const rows = await atelierQuery(sysTarget, statement);
  return Number(Object.values(rows[0] ?? {})[0]);
}

async function principalCount(): Promise<number> {
  const users = Number(Object.values((await sysQuery(`SELECT COUNT(*) FROM Security.Users WHERE Name LIKE '${STEM}%'`))[0] ?? {})[0]);
  const roles = Number(Object.values((await sysQuery(`SELECT COUNT(*) FROM Security.Roles WHERE Name LIKE '${STEM}%'`))[0] ?? {})[0]);
  return users + roles;
}

/** What is left of the fixtures: the tables, their generated classes, the user and the role. */
async function leftovers(): Promise<{ tables: number; classes: number; principals: number }> {
  return {
    tables: await countOf(`SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '${TABLE_SCHEMA}' AND TABLE_NAME LIKE '${STEM}%'`),
    classes: await countOf(`SELECT COUNT(*) FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH 'ExecuteMCPv2.Temp.${STEM}'`),
    principals: await principalCount(),
  };
}

/** Remove the user, the role and the tables if they exist. */
async function removeFixtures(): Promise<void> {
  const recorder = teardownRecorder();
  for (const table of [GRANTED, DENIED]) {
    await recorder.attempt(`drop ${table}`, async () => {
      await atelierQuery(sysTarget, `DROP TABLE IF EXISTS ${table}`);
    });
  }
  await recorder.attempt(`delete user ${USER}`, async () => {
    if (Number(Object.values((await sysQuery(`SELECT COUNT(*) FROM Security.Users WHERE Name = '${USER}'`))[0] ?? {})[0]) > 0) {
      const answer = await postEnvelope(sysTarget, "/security/user", { action: "delete", name: USER });
      if (answer.errors.length > 0) throw new Error(answer.errors.join("; "));
    }
  });
  await recorder.attempt(`delete role ${ROLE}`, async () => {
    if (Number(Object.values((await sysQuery(`SELECT COUNT(*) FROM Security.Roles WHERE Name = '${ROLE}'`))[0] ?? {})[0]) > 0) {
      const answer = await postEnvelope(sysTarget, "/security/role", { action: "delete", name: ROLE });
      if (answer.errors.length > 0) throw new Error(answer.errors.join("; "));
    }
  });
  if (recorder.problems.length > 0) throw new Error(`removing the ${STEM} fixtures failed: ${recorder.problems.join(" | ")}`);
}

/** `_SYSTEM`'s rows of `statement`, in the shape `iris_sql_query` returns them: `{columns, rows, rowCount}`. */
async function systemResult(statement: string): Promise<{ columns: string[]; rows: unknown[][]; rowCount: number }> {
  const rows = await atelierQuery(sysTarget, statement);
  const columns = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [];
  return { columns, rows: rows.map((row) => columns.map((column) => row[column])), rowCount: rows.length };
}

/** Start the built dev server as the least-privilege account with `env`, keeping what it writes to stderr. */
async function startAs(env: Record<string, string>, sink: (chunk: string) => void): Promise<WireSession> {
  return openWireSession(
    { sdkEsmDir: armedSdkDir, entry: distEntry(REPO_ROOT, "iris-dev-mcp"), target: lpTarget, clientName: "epic45-capstone-gate-lp", onStderr: sink },
    env,
  );
}

describe("Epic 45 capstone LP-armed (issue points 3 and 4): a least-privilege account on a throwaway IRIS", () => {
  beforeAll(async () => {
    if (armedSkip !== undefined) return;
    // Armed: it runs only against a throwaway the harness started, and it never skips from here on. The checks come before anything is written.
    const problems = throwawayEnvProblems(process.env);
    if (problems.length > 0) {
      throw new Error(
        "IRIS_REQUIRE_LIVE is set, so the Epic 45 capstone's armed leg may not be skipped, but it creates a user, a role, tables and SQL grants, " +
          `so it runs only against a throwaway IRIS that scripts/throwaway-iris.mjs started (node scripts/throwaway-iris.mjs exec ...): ${problems.join(" ")}`,
      );
    }
    const stale = ["shared", "iris-dev-mcp"].map((pkg) => staleDistReason(REPO_ROOT, pkg)).find((reason) => reason !== undefined);
    if (stale !== undefined) throw new Error(`the armed leg drives the built iris-dev-mcp, and a stale or missing dist fails it: ${stale}`);
    const sdk = resolveSdkEsmDir(REPO_ROOT);
    if (sdk === undefined) throw new Error("Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm; run pnpm install from the repo root.");
    armedSdkDir = sdk;
    sysTarget = irisTargetFromEnv();

    // An armed run with an unreachable target FAILS: this throws.
    await atelierQuery(sysTarget, "SELECT 1 AS One");

    // The IRIS side must be the shipped one before the account starts, so that "no class changes" means something: a built server started as
    // `_SYSTEM` (the automatic install on) installs or upgrades it, and the deployed marker is checked against the shipped embed.
    await runServerCalls("startup", { repoRoot: REPO_ROOT, sdkEsmDir: armedSdkDir, target: sysTarget }, {}, []);
    await assertDeployedBootstrapVersion(REPO_ROOT, sysTarget);

    await removeFixtures();

    const resources = await namespaceDatabaseResources(sysTarget.namespace);
    expect(resources.length, "the namespace has a Globals and a Routines database").toBeGreaterThan(0);

    await atelierQuery(sysTarget, `CREATE TABLE ${GRANTED} (Name VARCHAR(30), Qty INTEGER)`);
    await atelierQuery(sysTarget, `INSERT INTO ${GRANTED} (Name, Qty) VALUES ('alpha', 1)`);
    await atelierQuery(sysTarget, `INSERT INTO ${GRANTED} (Name, Qty) VALUES ('beta', 2)`);
    await atelierQuery(sysTarget, `CREATE TABLE ${DENIED} (Name VARCHAR(30), Qty INTEGER)`);
    await atelierQuery(sysTarget, `INSERT INTO ${DENIED} (Name, Qty) VALUES ('hidden', 9)`);

    const password = randomBytes(12).toString("hex");
    const role = await postEnvelope(sysTarget, "/security/role", {
      action: "create",
      name: ROLE,
      description: "Epic 45 capstone least-privilege leg (disposable)",
      resources: `%Development:U,${resources.map((resource) => `${resource}:R`).join(",")}`,
    });
    expect(role.errors, "the role was created").toEqual([]);
    const user = await postEnvelope(sysTarget, "/security/user", { action: "create", name: USER, password, roles: ROLE });
    expect(user.errors, "the user was created").toEqual([]);
    await atelierQuery(sysTarget, `GRANT SELECT ON ${GRANTED} TO ${USER}`);

    lpTarget = { ...sysTarget, username: USER, password };
    mappingBefore = await allMapping();
    setupBefore = await atelierDocument(sysTarget, SETUP_DOCUMENT);

    readOnlySession = await startAs({ IRIS_GOVERNANCE_PRESET: "read-only" }, (chunk) => {
      readOnlyStderr += chunk;
    });
    setupAfter = await atelierDocument(sysTarget, SETUP_DOCUMENT);
    blockSession = await startAs({ IRIS_DATA_POLICY: "block", IRIS_AUTO_INSTALL: "false" }, () => {});
  }, 600_000);

  afterAll(async () => {
    if (armedSkip !== undefined || sysTarget === undefined) return;
    const recorder = teardownRecorder();
    await recorder.attempt("close the read-only session", async () => void (await readOnlySession?.close()));
    await recorder.attempt("close the block session", async () => void (await blockSession?.close()));
    await recorder.attempt("remove the fixtures", removeFixtures);
    expect(recorder.problems, "the teardown ran clean").toEqual([]);
    expect(await leftovers(), `nothing named ${STEM} is left`).toEqual({ tables: 0, classes: 0, principals: 0 });
  }, 300_000);

  it("start: the account's server changed no class and reads the installed side as current, with no could-not-confirm warning (Story 45.6, DW-773)", async (ctx) => {
    if (skipIfReason(armedSkip, ctx)) return;
    expect(setupBefore, "the Setup document was read before the start").toBeDefined();
    expect(setupAfter, "the Setup document was read after the start").toBeDefined();
    // Preconditions (the account holds only R, so IRIS refuses its class writes either way); the warning check below is the oracle.
    expect(setupAfter?.ts, "precondition: the Setup document's timestamp is unchanged").toBe(setupBefore?.ts);
    expect(setupAfter?.content, "precondition: the Setup document's content is unchanged").toEqual(setupBefore?.content);
    expect(await allMapping(), "precondition: the %ALL mapping is unchanged").toBe(mappingBefore);
    // IsConfigured answers from the CSP application lookup for an account that cannot read %SYS, so the probe reads `current`.
    const couldNotConfirm = readOnlyStderr.split(/\r?\n/).filter((line) => line.includes(COULD_NOT_CONFIRM));
    expect(couldNotConfirm, "no could-not-confirm warning: the account reads the registered web application").toEqual([]);
    expect(readOnlyStderr).not.toContain("IRIS_SIDE_NOT_INSTALLED");
  });

  it("a granted SELECT through iris_sql_query returns the rows that _SYSTEM's Atelier route returns (the one-database minimum, checked live)", async (ctx) => {
    if (skipIfReason(armedSkip, ctx)) return;
    const statement = `SELECT ID, Name, Qty FROM ${GRANTED} ORDER BY ID`;
    const expected = await systemResult(statement);
    expect(expected.rowCount, "the oracle has the two seeded rows").toBe(2);
    const result = await (readOnlySession as WireSession).call("iris_sql_query", { query: statement });
    expect(result.isError, firstText(result)).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ columns: expected.columns, rowCount: 2 });
    expect((result.structuredContent as { rows: unknown[][] }).rows.map((row) => row.map(String))).toEqual(expected.rows.map((row) => row.map(String)));
  });

  it("an ungranted SELECT answers SQLCODE -99 and returns no rows", async (ctx) => {
    if (skipIfReason(armedSkip, ctx)) return;
    const result = await (readOnlySession as WireSession).call("iris_sql_query", { query: `SELECT ID, Name FROM ${DENIED} ORDER BY ID` });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("SQLCODE: -99");
    expect(result.structuredContent?.["rows"]).toBeUndefined();
  });

  it("SELECT ExecuteMCPv2.Setup_ConfigureMapping(...) answers SQLCODE -99 and the %ALL mapping is unchanged", async (ctx) => {
    if (skipIfReason(armedSkip, ctx)) return;
    const result = await (readOnlySession as WireSession).call("iris_sql_query", {
      query: `SELECT ExecuteMCPv2.Setup_ConfigureMapping('${sysTarget.namespace}') AS Mapped`,
    });
    expect(result.isError).toBe(true);
    expect(firstText(result), "the oracle: the call is refused at prepare").toContain("SQLCODE: -99");
    // Precondition, not an oracle: the mapping is in place before the call, so ConfigureMapping would leave it unchanged even if it ran.
    expect(await allMapping(), "precondition: the %ALL mapping is unchanged").toBe(mappingBefore);
    expect(mappingBefore, "precondition: the mapping is in place").toContain("ExecuteMCPv2");
  });

  it("under block, iris_sql_query is denied by governance with dataPolicyApplied (P1 counts the requests hermetically)", async (ctx) => {
    if (skipIfReason(armedSkip, ctx)) return;
    const result = await (blockSession as WireSession).call("iris_sql_query", { query: `SELECT ID, Name, Qty FROM ${GRANTED}` });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(governanceDenial("iris_sql_query", { dataPolicyApplied: "block" }));
  });
});

// The armed leg's contract, stated where a reader looks: unarmed it skips before any request, armed it never skips.
describe("Epic 45 capstone: the armed leg's arming contract", () => {
  it("is armed exactly when IRIS_REQUIRE_LIVE is 1 or true, and an armed run never holds a skip reason", () => {
    expect(LIVE.skipReason === undefined).toBe(REQUIRE_LIVE);
  });
});
