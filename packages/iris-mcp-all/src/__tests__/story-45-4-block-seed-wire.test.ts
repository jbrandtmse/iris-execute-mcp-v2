/**
 * Story 45.4 - `IRIS_DATA_POLICY=block` turns off the raw-read and code-execution tools, over the BUILT servers
 * (AC 45.4.2, AC 45.4.4, AC 45.4.5; `S-45.4-block-raw-tools`; Rules #19, #36, #59; decisions #169 and #170).
 *
 * The real SDK client talks stdio to the built dev, interop, data, admin and ops servers, each pointed at a local
 * listener that answers 503 and records every request, so "no request reached IRIS" is observable and means
 * something (a call that passes the gate does reach the listener). No IRIS instance is contacted. The path this
 * guards is the stdio `tools/call` through `handleToolCall`, plus `iris_server_profiles` and the startup log.
 *
 * Expected values come from the Story 45.4 intent contract's I/O matrix and decision #170, never from the
 * implementation (Rule #36): the denial `structuredContent` is deep-equal to a hand-written object, and the warning
 * lines are hand-written texts. Rows: default, `block`, re-enable (env, then file), parent enable, parent disable,
 * `block` + read-only, per profile, `allow`, hidden tool, `IRIS_TOOLS_ENABLE`, and a call's own arguments.
 *
 * Placement (Rule #45): `@iris-mcp/all` is the only package that depends on every server's built dist. A stale or
 * missing dist, or an unresolvable SDK, skips each test with the reason, or fails it when `IRIS_REQUIRE_LIVE` is armed.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  distEntry,
  firstText,
  governanceDenial,
  governanceReport,
  inheritedEnv,
  openAuditedSession,
  pollAuditEntries,
  resolveSdkEsmDir,
  skipIfReason,
  staleDistReason,
  start503Stub,
  stubTarget,
  writeJson,
  type AuditedSession,
  type Stub503,
  type WireToolResult,
} from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const PACKAGES = {
  dev: "iris-dev-mcp",
  interop: "iris-interop-mcp",
  data: "iris-data-mcp",
  admin: "iris-admin-mcp",
  ops: "iris-ops-mcp",
} as const;
type Server = keyof typeof PACKAGES;

let skipReason: string | undefined;
let sdkEsmDir = "";
let fixtureDir = "";

beforeAll(() => {
  skipReason = ["shared", ...Object.values(PACKAGES)]
    .map((pkg) => staleDistReason(REPO_ROOT, pkg))
    .find((reason) => reason !== undefined);
  if (!skipReason) {
    const resolved = resolveSdkEsmDir(REPO_ROOT);
    if (resolved === undefined) {
      skipReason = "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    } else {
      sdkEsmDir = resolved;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 45.4 block-seed wire gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) {
    // eslint-disable-next-line no-console
    console.log(`[SKIP] story-45-4-block-seed-wire: ${skipReason}`);
    return;
  }
  fixtureDir = mkdtempSync(path.join(tmpdir(), "story-45-4-wire-"));
});

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

// -- The covered keys, as the intent contract names them, with arguments that pass each tool's schema --------

interface Covered {
  key: string;
  tool: string;
  args: Record<string, unknown>;
}

const DEV_COVERED: Covered[] = [
  { key: "iris_sql_query", tool: "iris_sql_query", args: { query: "SELECT 1" } },
  { key: "iris_sql_execute", tool: "iris_sql_execute", args: { query: "SELECT 1" } },
  { key: "iris_global_get", tool: "iris_global_get", args: { global: "Story454Probe" } },
  { key: "iris_global_list", tool: "iris_global_list", args: {} },
  { key: "iris_execute_command", tool: "iris_execute_command", args: { command: 'Write "x"' } },
  { key: "iris_execute_classmethod", tool: "iris_execute_classmethod", args: { className: "Story454.Probe", methodName: "Run" } },
  { key: "iris_execute_tests", tool: "iris_execute_tests", args: { target: "Story454.Tests", level: "package" } },
  {
    key: "iris_test_coverage",
    tool: "iris_test_coverage",
    args: { target: "Story454.Tests", level: "package", classes: ["Story454.Probe"] },
  },
];
const INTEROP_COVERED: Covered[] = [
  { key: "iris_transform_test", tool: "iris_transform_test", args: { className: "Story454.Dtl", sourceClass: "Story454.Source" } },
];
const DATA_COVERED: Covered[] = [
  { key: "iris_docdb_document:get", tool: "iris_docdb_document", args: { action: "get", database: "Story454", id: "1" } },
  // Decision #172 (DW-782): delete returns the document it deletes, so block covers it with get.
  { key: "iris_docdb_document:delete", tool: "iris_docdb_document", args: { action: "delete", database: "Story454", id: "1" } },
  { key: "iris_docdb_find", tool: "iris_docdb_find", args: { database: "Story454", filter: {} } },
];

/** The keys the default (redact) dev server lists in its warning: `iris_test_coverage` is a disabled write. */
const DEV_WARNED = DEV_COVERED.map((entry) => entry.key).filter((key) => key !== "iris_test_coverage");

// -- The hand-written warning text (decision #170 item 2, amended for #172: one wording per policy mix; the unit
// -- test pins the same three variants) -------------------------------------------------------------------------

const WARNING_LEAD =
  '[WARN] Data policy: "redact" covers message bodies only, so these raw-read and code-execution tools are enabled and ' +
  "their results are not redacted or withheld: ";
const WARNING_TAIL =
  ". To turn tools off, set their governance keys to false (IRIS_GOVERNANCE or IRIS_GOVERNANCE_FILE) or set " +
  'IRIS_DATA_POLICY=block. See "What the safety settings protect" in the README.';
/** Only `redact` groups. */
const warningOf = (groups: string): string => `${WARNING_LEAD}${groups}${WARNING_TAIL}`;
/** Only `block` groups: no `redact` sentence and no `block` offer. */
const blockWarningOf = (groups: string): string =>
  '[WARN] Data policy: an explicit governance key re-enabled these raw-read and code-execution tools under "block", ' +
  `so their results are not withheld: ${groups}. To turn them off again, remove those keys or set them to false in ` +
  'the setting named. See "What the safety settings protect" in the README.';
/** Both: each group carries its own reason. */
const mixedWarningOf = (groups: string): string =>
  "[WARN] Data policy: these raw-read and code-execution tools are enabled, so their results are not redacted or " +
  `withheld: ${groups}${WARNING_TAIL}`;
const REENABLED = "block, re-enabled by an explicit governance key";
const REDACT_MIXED = "redact, which covers message bodies only";
/** How the line names the setting behind a re-enabled key, by its `configSource`. */
const FROM = { env: "from IRIS_GOVERNANCE", file: "from IRIS_GOVERNANCE_FILE" } as const;

// -- The harness -------------------------------------------------------------------------------------------

interface Served extends AuditedSession {
  stub: Stub503;
}

/** Start the built `server` against a fresh 503 listener with `env`, run `body`, and always tear both down. */
async function serve<T>(server: Server, env: Record<string, string>, body: (served: Served) => Promise<T>): Promise<T> {
  const stub = await start503Stub();
  try {
    const auditFile = path.join(fixtureDir, `audit-${server}-${Math.random().toString(36).slice(2)}.jsonl`);
    const audited = await openAuditedSession(
      {
        sdkEsmDir,
        entry: distEntry(REPO_ROOT, PACKAGES[server]),
        target: stubTarget(stub.port, "story454-wire"),
        clientName: "story-45-4-block-seed-wire",
        auditFile,
      },
      env,
    );
    try {
      return await body({ ...audited, stub });
    } finally {
      await audited.session.close();
    }
  } finally {
    await stub.close();
  }
}

/** The data-policy warning lines the server wrote to stderr so far. */
function warningLines(served: Served): string[] {
  return served.stderr().split("\n").filter((line) => line.includes("Data policy:"));
}

/** Whether a result is the governance denial. */
function isDenied(result: WireToolResult): boolean {
  return (result.structuredContent as { code?: string } | undefined)?.code === "GOVERNANCE_DISABLED";
}

/** Call `entry` on `profile` and report its result and how many requests the listener saw because of it. */
async function callCounted(
  served: Served,
  entry: Covered,
  profile = "default",
  extra: Record<string, unknown> = {},
): Promise<{ result: WireToolResult; requests: number }> {
  const before = served.stub.requests.length;
  const result = await served.session.callOn(profile, entry.tool, { ...entry.args, ...extra });
  return { result, requests: served.stub.requests.length - before };
}

/** The `iris-governance://<profile>` resource of the server: the policy and where each verdict came from. */
async function readGovernanceResource(
  served: Served,
  profile: string,
): Promise<{ policy: Record<string, boolean>; configSource: Record<string, string> }> {
  const answer = (await served.session.request("resources/read", { uri: `iris-governance://${profile}` })) as {
    contents: Array<{ text?: string }>;
  };
  return JSON.parse(answer.contents[0]?.text ?? "{}") as { policy: Record<string, boolean>; configSource: Record<string, string> };
}

/** The denial text of a `block`-seeded refusal. */
const blockText = (key: string, server = "default"): string =>
  `action '${key}' is disabled by governance policy for server '${server}' (data policy 'block')`;

describe("Story 45.4: the default install (redact) keeps every tool and names the open ones once (AC 45.4.4)", () => {
  it("dev: one warning naming the 7 enabled covered keys, not the disabled iris_test_coverage; every call reaches IRIS", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("dev", {}, async (served) => {
      expect(warningLines(served)).toEqual([warningOf(`profile "default" (redact): ${DEV_WARNED.join(", ")}`)]);
      const report = await governanceReport(served.session);
      for (const entry of DEV_COVERED) {
        expect(report.policy[entry.key], entry.key).toBe(entry.key !== "iris_test_coverage");
        expect(report.configSource[entry.key], entry.key).toBe("default");
      }
      for (const entry of DEV_COVERED.filter((candidate) => candidate.key !== "iris_test_coverage")) {
        const { result, requests } = await callCounted(served, entry);
        expect(isDenied(result), entry.key).toBe(false);
        expect(requests, `${entry.key} reached the listener`).toBeGreaterThan(0);
      }
    });
  });

  it("interop names iris_transform_test, data names the three docdb keys, admin and ops write no line", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("interop", {}, async (served) => {
      expect(warningLines(served)).toEqual([warningOf('profile "default" (redact): iris_transform_test')]);
    });
    await serve("data", {}, async (served) => {
      expect(warningLines(served)).toEqual([
        warningOf('profile "default" (redact): iris_docdb_document:get, iris_docdb_document:delete, iris_docdb_find'),
      ]);
    });
    for (const server of ["admin", "ops"] as const) {
      await serve(server, {}, async (served) => {
        expect(warningLines(served), server).toEqual([]);
      });
    }
  });
});

describe("Story 45.4: block denies every covered key before IRIS (AC 45.4.2, AC 45.4.5)", () => {
  it("dev: each covered key is GOVERNANCE_DISABLED with dataPolicyApplied, no request reaches IRIS, discovery agrees, the audit entry copies it, and no warning is written", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("dev", { IRIS_DATA_POLICY: "block" }, async (served) => {
      expect(warningLines(served)).toEqual([]);
      for (const entry of DEV_COVERED) {
        const { result, requests } = await callCounted(served, entry);
        expect(result.isError, entry.key).toBe(true);
        expect(result.structuredContent, entry.key).toEqual(governanceDenial(entry.key, { dataPolicyApplied: "block" }));
        expect(firstText(result), entry.key).toBe(blockText(entry.key));
        expect(requests, `${entry.key}: a denied call sends nothing to IRIS`).toBe(0);
      }
      const report = await governanceReport(served.session);
      for (const entry of DEV_COVERED) {
        expect(report.policy[entry.key], entry.key).toBe(false);
        expect(report.configSource[entry.key], entry.key).toBe("dataPolicy");
      }
      // A tool outside the set is as it was.
      expect(report.policy["iris_doc_get"]).toBe(true);
      expect(report.configSource["iris_doc_get"]).toBe("default");
      // The governance resource reads the same engine.
      const resource = await readGovernanceResource(served, "default");
      for (const entry of DEV_COVERED) {
        expect(resource.policy[entry.key], `resource ${entry.key}`).toBe(false);
        expect(resource.configSource[entry.key], `resource ${entry.key}`).toBe("dataPolicy");
      }
      expect(resource.policy["iris_doc_get"]).toBe(true);
      for (const entry of DEV_COVERED) {
        const [audit] = await pollAuditEntries(served.auditFile, { tool: entry.tool, count: 1, intervalMs: 50, timeoutMs: 15000, excerpt: 300 });
        expect(audit, entry.key).toMatchObject({
          outcome: "denied",
          denyReason: "GOVERNANCE_DISABLED",
          dataPolicyApplied: "block",
        });
        expect(audit, entry.key).not.toHaveProperty("presetApplied");
      }
    });
  });

  it("interop and data: the covered keys (docdb delete included) are denied the same way; the docdb insert action is not covered", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("interop", { IRIS_DATA_POLICY: "block" }, async (served) => {
      expect(warningLines(served)).toEqual([]);
      for (const entry of INTEROP_COVERED) {
        const { result, requests } = await callCounted(served, entry);
        expect(result.structuredContent, entry.key).toEqual(governanceDenial(entry.key, { dataPolicyApplied: "block" }));
        expect(requests, entry.key).toBe(0);
      }
    });
    await serve("data", { IRIS_DATA_POLICY: "block" }, async (served) => {
      expect(warningLines(served)).toEqual([]);
      for (const entry of DATA_COVERED) {
        const { result, requests } = await callCounted(served, entry);
        expect(result.structuredContent, entry.key).toEqual(governanceDenial(entry.key, { dataPolicyApplied: "block" }));
        expect(firstText(result), entry.key).toBe(blockText(entry.key));
        expect(requests, entry.key).toBe(0);
      }
      // insert is a key of its own (iris_docdb_document:insert): the gate lets it through to IRIS.
      const insert = await callCounted(served, { key: "iris_docdb_document:insert", tool: "iris_docdb_document", args: { action: "insert", database: "Story454", document: {} } });
      expect(isDenied(insert.result)).toBe(false);
      expect(insert.requests).toBeGreaterThan(0);
    });
  });
});

describe("Story 45.4: an explicit governance key re-enables a covered key, and it stays visible (decision #170 item 1)", () => {
  it("IRIS_GOVERNANCE true: that key runs (configSource env), the other 7 are denied, the warning names it as re-enabled", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const env = { IRIS_DATA_POLICY: "block", IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_query: true } }) };
    await serve("dev", env, async (served) => {
      expect(warningLines(served)).toEqual([blockWarningOf(`profile "default" (${REENABLED}): iris_sql_query ${FROM.env}`)]);
      const report = await governanceReport(served.session);
      expect(report.policy["iris_sql_query"]).toBe(true);
      expect(report.configSource["iris_sql_query"]).toBe("env");
      const run = await callCounted(served, DEV_COVERED[0] as Covered);
      expect(isDenied(run.result)).toBe(false);
      expect(run.requests, "the re-enabled call reached IRIS").toBeGreaterThan(0);
      for (const entry of DEV_COVERED.slice(1)) {
        const { result, requests } = await callCounted(served, entry);
        expect(result.structuredContent, entry.key).toEqual(governanceDenial(entry.key, { dataPolicyApplied: "block" }));
        expect(requests, entry.key).toBe(0);
      }
    });
  });

  it("a governance file layer re-enables too, reported as file", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const governanceFile = writeJson(fixtureDir, "governance.json", { profiles: { default: { iris_global_get: true } } });
    await serve("dev", { IRIS_DATA_POLICY: "block", IRIS_GOVERNANCE_FILE: governanceFile }, async (served) => {
      expect(warningLines(served)).toEqual([blockWarningOf(`profile "default" (${REENABLED}): iris_global_get ${FROM.file}`)]);
      const report = await governanceReport(served.session);
      expect(report.configSource["iris_global_get"]).toBe("file");
      expect(report.policy["iris_global_get"]).toBe(true);
      const run = await callCounted(served, DEV_COVERED[2] as Covered);
      expect(isDenied(run.result)).toBe(false);
    });
  });

  it("IRIS_TOOLS_ENABLE only shows a tool: a covered tool it makes visible is still denied under block", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const env = { IRIS_DATA_POLICY: "block", IRIS_TOOLS_PRESET: "core", IRIS_TOOLS_ENABLE: "iris_global_list" };
    await serve("dev", env, async (served) => {
      const names = (await served.session.listTools()).map((tool) => tool.name);
      expect(names, "the tool is visible").toContain("iris_global_list");
      const entry = DEV_COVERED.find((candidate) => candidate.key === "iris_global_list") as Covered;
      const { result, requests } = await callCounted(served, entry);
      expect(result.structuredContent).toEqual(governanceDenial("iris_global_list", { dataPolicyApplied: "block" }));
      expect(requests).toBe(0);
      const report = await governanceReport(served.session);
      expect(report.policy["iris_global_list"]).toBe(false);
      expect(report.configSource["iris_global_list"]).toBe("dataPolicy");
      expect(warningLines(served)).toEqual([]);
    });
  });

  it("a call's own arguments never re-enable a covered tool", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("dev", { IRIS_DATA_POLICY: "block" }, async (served) => {
      const entry = DEV_COVERED[0] as Covered;
      const extras: Array<Record<string, unknown>> = [
        { dataPolicy: "allow", enabled: true, governance: { global: { iris_sql_query: true } } },
        { IRIS_DATA_POLICY: "allow", policy: "allow", presetApplied: "full" },
        { server: "default", profile: "default", allProfiles: true },
      ];
      for (const extra of extras) {
        const { result, requests } = await callCounted(served, entry, "default", extra);
        expect(result.structuredContent, JSON.stringify(extra)).toEqual(governanceDenial("iris_sql_query", { dataPolicyApplied: "block" }));
        expect(requests, JSON.stringify(extra)).toBe(0);
      }
    });
  });
});

describe("Story 45.4: the block seed and the parent keys (AD-6)", () => {
  it("a parent enable is not inherited: iris_sql_execute runs, iris_sql_query is still denied with dataPolicyApplied", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const env = { IRIS_DATA_POLICY: "block", IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_execute: true } }) };
    await serve("dev", env, async (served) => {
      const execute = await callCounted(served, DEV_COVERED[1] as Covered);
      expect(isDenied(execute.result)).toBe(false);
      expect(execute.requests).toBeGreaterThan(0);
      const query = await callCounted(served, DEV_COVERED[0] as Covered);
      expect(query.result.structuredContent).toEqual(governanceDenial("iris_sql_query", { dataPolicyApplied: "block" }));
      expect(query.requests).toBe(0);
      expect(warningLines(served)).toEqual([blockWarningOf(`profile "default" (${REENABLED}): iris_sql_execute ${FROM.env}`)]);
    });
  });

  it("a parent disable is inherited and keeps its own attribution: no dataPolicyApplied", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const env = { IRIS_DATA_POLICY: "block", IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_execute: false } }) };
    await serve("dev", env, async (served) => {
      const query = await callCounted(served, DEV_COVERED[0] as Covered);
      expect(query.result.structuredContent).toEqual(governanceDenial("iris_sql_query", { inheritedFrom: "iris_sql_execute" }));
      expect(firstText(query.result)).toBe("action 'iris_sql_query' is disabled by governance policy for server 'default' (inherited from 'iris_sql_execute')");
      const execute = await callCounted(served, DEV_COVERED[1] as Covered);
      expect(execute.result.structuredContent).toEqual(governanceDenial("iris_sql_execute"));
      const report = await governanceReport(served.session);
      expect(report.configSource["iris_sql_query"]).toBe("parent");
      expect(report.configSource["iris_sql_execute"]).toBe("env");
      const [audit] = await pollAuditEntries(served.auditFile, { tool: "iris_sql_query", count: 1, intervalMs: 50, timeoutMs: 15000, excerpt: 300 });
      expect(audit).not.toHaveProperty("dataPolicyApplied");
    });
  });
});

describe("Story 45.4: block together with the read-only preset", () => {
  it("a covered key carries dataPolicyApplied, a non-covered write keeps presetApplied, an explicit true beats both", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const env = {
      IRIS_DATA_POLICY: "block",
      IRIS_GOVERNANCE_PRESET: "read-only",
      IRIS_GOVERNANCE: JSON.stringify({ global: { iris_execute_command: true } }),
    };
    await serve("dev", env, async (served) => {
      const covered = await callCounted(served, DEV_COVERED[0] as Covered);
      expect(covered.result.structuredContent).toEqual(governanceDenial("iris_sql_query", { dataPolicyApplied: "block" }));
      const write = await callCounted(served, { key: "iris_global_set", tool: "iris_global_set", args: { global: "Story454Probe", value: "x" } });
      expect(write.result.structuredContent).toEqual(governanceDenial("iris_global_set", { presetApplied: "read-only" }));
      const both = await callCounted(served, DEV_COVERED[4] as Covered);
      expect(isDenied(both.result)).toBe(false);
      const report = await governanceReport(served.session);
      expect(report.configSource["iris_sql_query"]).toBe("dataPolicy");
      expect(report.configSource["iris_global_set"]).toBe("preset");
      expect(report.configSource["iris_execute_command"]).toBe("env");
      const [audit] = await pollAuditEntries(served.auditFile, { tool: "iris_sql_query", count: 1, intervalMs: 50, timeoutMs: 15000, excerpt: 300 });
      expect(audit).toMatchObject({ outcome: "denied", dataPolicyApplied: "block" });
      expect(audit).not.toHaveProperty("presetApplied");
      // A covered WRITE is one the preset would deny too: the seed decides first, so presetApplied never joins it.
      const coveredWrite = await callCounted(served, DEV_COVERED[1] as Covered);
      expect(coveredWrite.result.structuredContent).toEqual(governanceDenial("iris_sql_execute", { dataPolicyApplied: "block" }));
      expect(coveredWrite.requests).toBe(0);
      expect(report.configSource["iris_sql_execute"]).toBe("dataPolicy");
      const [writeAudit] = await pollAuditEntries(served.auditFile, { tool: "iris_sql_execute", count: 1, intervalMs: 50, timeoutMs: 15000, excerpt: 300 });
      expect(writeAudit).toMatchObject({ outcome: "denied", dataPolicyApplied: "block" });
      expect(writeAudit).not.toHaveProperty("presetApplied");
    });
  });
});

describe("Story 45.4: the policy is per profile", () => {
  it("prod (block) is denied, default (redact) runs; the warning has a default group only; discovery shows both", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const env = { IRIS_PROFILES: JSON.stringify({ prod: { dataPolicy: "block" } }) };
    await serve("dev", env, async (served) => {
      expect(warningLines(served)).toEqual([warningOf(`profile "default" (redact): ${DEV_WARNED.join(", ")}`)]);
      const entry = DEV_COVERED[0] as Covered;
      const prod = await callCounted(served, entry, "prod");
      expect(prod.result.structuredContent).toEqual(governanceDenial("iris_sql_query", { server: "prod", dataPolicyApplied: "block" }));
      expect(firstText(prod.result)).toBe(blockText("iris_sql_query", "prod"));
      expect(prod.requests).toBe(0);
      const other = await callCounted(served, entry, "default");
      expect(isDenied(other.result)).toBe(false);
      expect(other.requests).toBeGreaterThan(0);
      const all = await served.session.raw("iris_server_profiles", { allProfiles: true });
      const governance = (all.structuredContent as { governance: { policies: Record<string, Record<string, boolean>>; configSources: Record<string, Record<string, string>> } }).governance;
      expect(governance.policies["prod"]?.["iris_sql_query"]).toBe(false);
      expect(governance.configSources["prod"]?.["iris_sql_query"]).toBe("dataPolicy");
      expect(governance.policies["default"]?.["iris_sql_query"]).toBe(true);
      expect(governance.configSources["default"]?.["iris_sql_query"]).toBe("default");
      // The resource of each profile reads that profile's own policy.
      const prodResource = await readGovernanceResource(served, "prod");
      expect(prodResource.policy["iris_sql_query"]).toBe(false);
      expect(prodResource.configSource["iris_sql_query"]).toBe("dataPolicy");
      const defaultResource = await readGovernanceResource(served, "default");
      expect(defaultResource.policy["iris_sql_query"]).toBe(true);
      expect(defaultResource.configSource["iris_sql_query"]).toBe("default");
    });
  });

  it("two redact profiles with the same list share a group; a re-enabling block profile is its own group (the Grouping row)", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const env = {
      IRIS_PROFILES: JSON.stringify({ a: {}, b: {}, c: { dataPolicy: "block" } }),
      IRIS_GOVERNANCE: JSON.stringify({ profiles: { c: { iris_sql_query: true } } }),
    };
    await serve("dev", env, async (served) => {
      expect(warningLines(served)).toEqual([
        mixedWarningOf(
          `profiles "default", "a", "b" (${REDACT_MIXED}): ${DEV_WARNED.join(", ")}; profile "c" (${REENABLED}): iris_sql_query ${FROM.env}`,
        ),
      ]);
    });
  });
});

describe("Story 45.4: allow, and a hidden tool, write no warning for what is not open", () => {
  it("allow everywhere: no line, and the covered calls run", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("dev", { IRIS_DATA_POLICY: "allow" }, async (served) => {
      expect(warningLines(served)).toEqual([]);
      const { result, requests } = await callCounted(served, DEV_COVERED[0] as Covered);
      expect(isDenied(result)).toBe(false);
      expect(requests).toBeGreaterThan(0);
    });
  });

  it("a tool hidden by IRIS_TOOLS_DISABLE or the core preset is never named; nothing left means no line", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("dev", { IRIS_TOOLS_DISABLE: "iris_global_get,iris_sql_execute" }, async (served) => {
      const rest = DEV_WARNED.filter((key) => key !== "iris_global_get" && key !== "iris_sql_execute");
      expect(warningLines(served)).toEqual([warningOf(`profile "default" (redact): ${rest.join(", ")}`)]);
    });
    await serve("dev", { IRIS_TOOLS_PRESET: "core" }, async (served) => {
      const rest = DEV_WARNED.filter((key) => key !== "iris_global_list");
      expect(warningLines(served)).toEqual([warningOf(`profile "default" (redact): ${rest.join(", ")}`)]);
    });
    await serve("interop", { IRIS_TOOLS_DISABLE: "iris_transform_test" }, async (served) => {
      expect(warningLines(served)).toEqual([]);
    });
  });

  it("the line follows the preset and the parent keys: read-only leaves only the covered reads, a parent false drops its child", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("dev", { IRIS_GOVERNANCE_PRESET: "read-only" }, async (served) => {
      expect(warningLines(served)).toEqual([warningOf('profile "default" (redact): iris_sql_query, iris_global_get, iris_global_list')]);
    });
    await serve("dev", { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_execute: false } }) }, async (served) => {
      const rest = DEV_WARNED.filter((key) => key !== "iris_sql_query" && key !== "iris_sql_execute");
      expect(warningLines(served)).toEqual([warningOf(`profile "default" (redact): ${rest.join(", ")}`)]);
    });
  });

  it("an IRIS_GOVERNANCE false on a covered key under redact: that key is not named (it is not enabled)", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("dev", { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_query: false } }) }, async (served) => {
      const rest = DEV_WARNED.filter((key) => key !== "iris_sql_query");
      expect(warningLines(served)).toEqual([warningOf(`profile "default" (redact): ${rest.join(", ")}`)]);
    });
  });
});

// =====================================================================================================================
// QA pass (Story 45.4, Rule #19 gaps): precedence per layer, the CLI agreement, the parent keys, the warning's edge
// rows and a zero-request check for EVERY covered key. Each block names the mutation that turns it red.
// =====================================================================================================================

const SHARED_DIST = path.join(REPO_ROOT, "packages", "shared", "dist");
const GOVERNANCE_CLI = path.join(SHARED_DIST, "cli", "governance-cli.js");
const ALL_COVERED: Covered[] = [...DEV_COVERED, ...INTEROP_COVERED, ...DATA_COVERED];

/** The declaration, from the BUILT shared package (the declaration site, not a copy). */
async function declaredBlockKeys(): Promise<string[]> {
  const shared = (await import(pathToFileURL(path.join(SHARED_DIST, "index.js")).href)) as { DATA_POLICY_BLOCK_KEYS: readonly string[] };
  return [...shared.DATA_POLICY_BLOCK_KEYS];
}

/** Run the built `iris-mcp-governance` bin outside the repository with the scrubbed environment plus `env`; parse its JSON. */
function governanceCli(args: string[], env: Record<string, string>): { policy: Record<string, boolean>; configSource: Record<string, string> } {
  const outcome = spawnSync(process.execPath, [GOVERNANCE_CLI, ...args, "--json"], {
    encoding: "utf8",
    cwd: fixtureDir,
    env: { ...inheritedEnv(), ...env },
    timeout: 60000,
  });
  expect(outcome.error, "the bin started").toBeUndefined();
  expect(outcome.status, `iris-mcp-governance ${args.join(" ")}: ${outcome.stderr}`).toBe(0);
  return JSON.parse(outcome.stdout) as { policy: Record<string, boolean>; configSource: Record<string, string> };
}

/** The per-profile governance maps of `iris_server_profiles` (all profiles). */
async function allProfilesGovernance(served: Served): Promise<{ policies: Record<string, Record<string, boolean>>; configSources: Record<string, Record<string, string>> }> {
  const all = await served.session.raw("iris_server_profiles", { allProfiles: true });
  return (all.structuredContent as { governance: { policies: Record<string, Record<string, boolean>>; configSources: Record<string, Record<string, string>> } }).governance;
}

describe("QA 45.4: the wire cases cover the whole declaration, and a request recorder sees every covered key (decision #170 item 4)", () => {
  it("the covered keys the wire test calls are exactly DATA_POLICY_BLOCK_KEYS (a new key needs a wire case)", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    expect(ALL_COVERED.map((entry) => entry.key).sort()).toEqual([...(await declaredBlockKeys())].sort());
  });

  it("positive control: under allow each of the 12 covered keys reaches the listener, so a zero count under block means something", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const env = { IRIS_DATA_POLICY: "allow", IRIS_GOVERNANCE: JSON.stringify({ global: { iris_test_coverage: true } }) };
    for (const [server, entries] of [["dev", DEV_COVERED], ["interop", INTEROP_COVERED], ["data", DATA_COVERED]] as const) {
      await serve(server, env, async (served) => {
        for (const entry of entries) {
          const { result, requests } = await callCounted(served, entry);
          expect(isDenied(result), entry.key).toBe(false);
          expect(requests, `${entry.key} reaches the listener when nothing denies it`).toBeGreaterThan(0);
        }
      });
    }
  });

  it("block on a NON-default profile: every covered key of every server is denied with zero requests, and the default profile still runs", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const env = { IRIS_PROFILES: JSON.stringify({ prod: { dataPolicy: "block" } }) };
    for (const [server, entries] of [["dev", DEV_COVERED], ["interop", INTEROP_COVERED], ["data", DATA_COVERED]] as const) {
      await serve(server, env, async (served) => {
        for (const entry of entries) {
          const denied = await callCounted(served, entry, "prod");
          expect(denied.result.structuredContent, entry.key).toEqual(governanceDenial(entry.key, { server: "prod", dataPolicyApplied: "block" }));
          expect(denied.requests, `${entry.key}: a denied call on prod sends nothing to IRIS`).toBe(0);
        }
        const open = await callCounted(served, entries[0] as Covered, "default");
        expect(isDenied(open.result)).toBe(false);
        expect(open.requests).toBeGreaterThan(0);
      });
    }
  });
});

describe("QA 45.4: each explicit layer re-enables a covered key, and nothing else does (decision #170 item 1 (a)-(d))", () => {
  it("(a) a per-PROFILE true in IRIS_GOVERNANCE beats the seed for that profile only", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const env = {
      IRIS_DATA_POLICY: "block",
      IRIS_PROFILES: JSON.stringify({ prod: {} }),
      IRIS_GOVERNANCE: JSON.stringify({ profiles: { prod: { iris_global_get: true } } }),
    };
    await serve("dev", env, async (served) => {
      expect(warningLines(served)).toEqual([blockWarningOf(`profile "prod" (${REENABLED}): iris_global_get ${FROM.env}`)]);
      const run = await callCounted(served, DEV_COVERED[2] as Covered, "prod");
      expect(isDenied(run.result)).toBe(false);
      expect(run.requests, "the re-enabled call on prod reached IRIS").toBeGreaterThan(0);
      // The default profile has no such layer: the same key stays seeded off there, and so does every other key on prod.
      const other = await callCounted(served, DEV_COVERED[2] as Covered, "default");
      expect(other.result.structuredContent).toEqual(governanceDenial("iris_global_get", { dataPolicyApplied: "block" }));
      expect(other.requests).toBe(0);
      const sibling = await callCounted(served, DEV_COVERED[0] as Covered, "prod");
      expect(sibling.result.structuredContent).toEqual(governanceDenial("iris_sql_query", { server: "prod", dataPolicyApplied: "block" }));
      expect(sibling.requests).toBe(0);
      const governance = await allProfilesGovernance(served);
      expect(governance.policies["prod"]?.["iris_global_get"]).toBe(true);
      expect(governance.configSources["prod"]?.["iris_global_get"]).toBe("env");
      expect(governance.policies["default"]?.["iris_global_get"]).toBe(false);
      expect(governance.configSources["default"]?.["iris_global_get"]).toBe("dataPolicy");
    });
  });

  it("(b) a GLOBAL true in the governance FILE beats the seed, reported as file", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const governanceFile = writeJson(fixtureDir, "governance-global.json", { global: { iris_execute_command: true } });
    await serve("dev", { IRIS_DATA_POLICY: "block", IRIS_GOVERNANCE_FILE: governanceFile }, async (served) => {
      expect(warningLines(served)).toEqual([blockWarningOf(`profile "default" (${REENABLED}): iris_execute_command ${FROM.file}`)]);
      const run = await callCounted(served, DEV_COVERED[4] as Covered);
      expect(isDenied(run.result)).toBe(false);
      expect(run.requests, "the re-enabled call reached IRIS").toBeGreaterThan(0);
      const report = await governanceReport(served.session);
      expect(report.policy["iris_execute_command"]).toBe(true);
      expect(report.configSource["iris_execute_command"]).toBe("file");
      for (const entry of DEV_COVERED.filter((candidate) => candidate.key !== "iris_execute_command")) {
        const { result, requests } = await callCounted(served, entry);
        expect(result.structuredContent, entry.key).toEqual(governanceDenial(entry.key, { dataPolicyApplied: "block" }));
        expect(requests, entry.key).toBe(0);
      }
    });
  });

  it("(c) IRIS_TOOLS_ENABLE shows EVERY covered tool of every server and re-enables none of them", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    for (const [server, entries] of [["dev", DEV_COVERED], ["interop", INTEROP_COVERED], ["data", DATA_COVERED]] as const) {
      const tools = [...new Set(entries.map((entry) => entry.tool))];
      const env = { IRIS_DATA_POLICY: "block", IRIS_TOOLS_PRESET: "core", IRIS_TOOLS_ENABLE: tools.join(",") };
      await serve(server, env, async (served) => {
        const names = (await served.session.listTools()).map((tool) => tool.name);
        for (const tool of tools) expect(names, `${tool} is visible`).toContain(tool);
        for (const entry of entries) {
          const { result, requests } = await callCounted(served, entry);
          expect(result.structuredContent, entry.key).toEqual(governanceDenial(entry.key, { dataPolicyApplied: "block" }));
          expect(requests, entry.key).toBe(0);
        }
        expect(warningLines(served), "nothing is enabled, so there is nothing to warn about").toEqual([]);
      });
    }
  });

  it("(d) a call's arguments naming another profile, or an allow policy, never lift the block profile's denial; an allow profile's run leaves it denied", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const env = { IRIS_PROFILES: JSON.stringify({ prod: { dataPolicy: "block" }, open: { dataPolicy: "allow" } }) };
    await serve("dev", env, async (served) => {
      const entry = DEV_COVERED[0] as Covered;
      const prodDenial = governanceDenial("iris_sql_query", { server: "prod", dataPolicyApplied: "block" });
      const extras: Array<Record<string, unknown>> = [
        {},
        { profile: "open", sourceServer: "open", targetServer: "open", servers: ["open"] },
        { dataPolicy: "allow", policy: "allow", IRIS_DATA_POLICY: "allow", dataPolicyApplied: "allow" },
      ];
      for (const extra of extras) {
        const denied = await callCounted(served, entry, "prod", extra);
        expect(denied.result.structuredContent, JSON.stringify(extra)).toEqual(prodDenial);
        expect(denied.requests, JSON.stringify(extra)).toBe(0);
        // Between two denials, the allow profile runs the same call: its policy is its own.
        const open = await callCounted(served, entry, "open", extra);
        expect(isDenied(open.result), `open ${JSON.stringify(extra)}`).toBe(false);
        expect(open.requests, "the allow profile's call reached IRIS").toBeGreaterThan(0);
      }
      const governance = await allProfilesGovernance(served);
      expect(governance.policies["prod"]?.["iris_sql_query"]).toBe(false);
      expect(governance.configSources["prod"]?.["iris_sql_query"]).toBe("dataPolicy");
      expect(governance.policies["open"]?.["iris_sql_query"]).toBe(true);
      expect(governance.configSources["open"]?.["iris_sql_query"]).toBe("default");
    });
  });
});

describe("QA 45.4 (e): after a re-enable, the warning, iris_server_profiles, the resource and the CLI agree", () => {
  interface Scenario {
    title: string;
    server: Server;
    entries: Covered[];
    profile: string;
    key: string;
    source: "env" | "file";
    /** The groups the warning is expected to hold, when profiles other than the re-enabling one are named too. */
    groups?: string;
    /** Builds the environment (the governance file is written first when it needs one). */
    env: () => Record<string, string>;
  }
  const scenarios: Scenario[] = [
    {
      title: "dev, IRIS_GOVERNANCE global",
      server: "dev",
      entries: DEV_COVERED,
      profile: "default",
      key: "iris_sql_query",
      source: "env",
      env: () => ({ IRIS_DATA_POLICY: "block", IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_query: true } }) }),
    },
    {
      title: "dev, IRIS_GOVERNANCE profile layer of prod",
      server: "dev",
      entries: DEV_COVERED,
      profile: "prod",
      key: "iris_global_get",
      source: "env",
      env: () => ({
        IRIS_DATA_POLICY: "block",
        IRIS_PROFILES: JSON.stringify({ prod: {} }),
        IRIS_GOVERNANCE: JSON.stringify({ profiles: { prod: { iris_global_get: true } } }),
      }),
    },
    {
      title: "dev, governance file global",
      server: "dev",
      entries: DEV_COVERED,
      profile: "default",
      key: "iris_execute_command",
      source: "file",
      env: () => ({
        IRIS_DATA_POLICY: "block",
        IRIS_GOVERNANCE_FILE: writeJson(fixtureDir, "agree-file-global.json", { global: { iris_execute_command: true } }),
      }),
    },
    {
      title: "dev, governance file profile layer of prod",
      server: "dev",
      entries: DEV_COVERED,
      profile: "prod",
      key: "iris_global_list",
      source: "file",
      // Only prod is block; the default profile stays redact and is named in its own group.
      groups: `profile "default" (${REDACT_MIXED}): ${DEV_WARNED.join(", ")}; profile "prod" (${REENABLED}): iris_global_list ${FROM.file}`,
      env: () => ({
        IRIS_PROFILES: JSON.stringify({ prod: { dataPolicy: "block" } }),
        IRIS_GOVERNANCE_FILE: writeJson(fixtureDir, "agree-file-profile.json", { profiles: { prod: { iris_global_list: true } } }),
      }),
    },
    {
      title: "interop, IRIS_GOVERNANCE global",
      server: "interop",
      entries: INTEROP_COVERED,
      profile: "default",
      key: "iris_transform_test",
      source: "env",
      env: () => ({ IRIS_DATA_POLICY: "block", IRIS_GOVERNANCE: JSON.stringify({ global: { iris_transform_test: true } }) }),
    },
    {
      title: "data, governance file global",
      server: "data",
      entries: DATA_COVERED,
      profile: "default",
      key: "iris_docdb_find",
      source: "file",
      env: () => ({
        IRIS_DATA_POLICY: "block",
        IRIS_GOVERNANCE_FILE: writeJson(fixtureDir, "agree-data-file.json", { global: { iris_docdb_find: true } }),
      }),
    },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.title}: one key is on everywhere, the rest are off everywhere`, async (ctx) => {
      if (skipIfReason(skipReason, ctx)) return;
      const env = scenario.env();
      await serve(scenario.server, env, async (served) => {
        // 1. The warning names the re-enabled key, for the re-enabling profile only.
        expect(warningLines(served)).toEqual([
          scenario.groups !== undefined
            ? mixedWarningOf(scenario.groups)
            : blockWarningOf(`profile "${scenario.profile}" (${REENABLED}): ${scenario.key} ${FROM[scenario.source]}`),
        ]);

        // 2. iris_server_profiles (both branches) and the resource.
        const governance = await allProfilesGovernance(served);
        const policy = governance.policies[scenario.profile] as Record<string, boolean>;
        const sources = governance.configSources[scenario.profile] as Record<string, string>;
        const resource = await readGovernanceResource(served, scenario.profile);
        expect(resource.policy).toEqual(policy);
        expect(resource.configSource).toEqual(sources);
        if (scenario.profile === "default") {
          const single = await governanceReport(served.session);
          expect(single.policy).toEqual(policy);
          expect(single.configSource).toEqual(sources);
        }
        for (const entry of scenario.entries) {
          const reEnabled = entry.key === scenario.key;
          expect(policy[entry.key], entry.key).toBe(reEnabled);
          expect(sources[entry.key], entry.key).toBe(reEnabled ? scenario.source : "dataPolicy");
        }

        // 3. The CLI, `universe` and `effective`, on the same environment, reads the same verdicts for every key the server reports.
        const universe = governanceCli(["universe", "--profile", scenario.profile], env);
        for (const [key, value] of Object.entries(policy)) {
          expect(universe.policy[key], `universe ${key}`).toBe(value);
          expect(universe.configSource[key], `universe ${key}`).toBe(sources[key]);
        }
        const effectiveView = governanceCli(["effective", "--profile", scenario.profile], env);
        for (const entry of scenario.entries) {
          expect(effectiveView.policy[entry.key], `effective ${entry.key}`).toBe(policy[entry.key]);
          expect(effectiveView.configSource[entry.key], `effective ${entry.key}`).toBe(sources[entry.key]);
        }

        // 4. The warning lists exactly the covered keys the CLI says are on (the CLI is the independent reader).
        const onPerCli = scenario.entries.map((entry) => entry.key).filter((key) => universe.policy[key] === true);
        expect(onPerCli).toEqual([scenario.key]);

        // 5. And the gate agrees: the re-enabled key runs, the others are denied before IRIS.
        for (const entry of scenario.entries) {
          const { result, requests } = await callCounted(served, entry, scenario.profile);
          if (entry.key === scenario.key) {
            expect(isDenied(result), entry.key).toBe(false);
            expect(requests, `${entry.key} reached IRIS`).toBeGreaterThan(0);
          } else {
            expect(isDenied(result), entry.key).toBe(true);
            expect(requests, entry.key).toBe(0);
          }
        }
      });
    });
  }
});

describe("QA 45.4: parent keys (AD-6) on the wire", () => {
  it("decision #172 (DW-782): under block the docdb delete action is denied before IRIS, and insert and update stay on and reach IRIS", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("data", { IRIS_DATA_POLICY: "block" }, async (served) => {
      const deleteEntry = DATA_COVERED.find((entry) => entry.key === "iris_docdb_document:delete") as Covered;
      const deleted = await callCounted(served, deleteEntry);
      expect(deleted.result.isError).toBe(true);
      expect(deleted.result.structuredContent).toEqual(governanceDenial("iris_docdb_document:delete", { dataPolicyApplied: "block" }));
      expect(firstText(deleted.result)).toBe(blockText("iris_docdb_document:delete"));
      expect(deleted.requests, "a denied delete sends nothing to IRIS").toBe(0);
      const [audit] = await pollAuditEntries(served.auditFile, { tool: "iris_docdb_document", count: 1, intervalMs: 50, timeoutMs: 15000, excerpt: 300 });
      expect(audit).toMatchObject({ outcome: "denied", denyReason: "GOVERNANCE_DISABLED", dataPolicyApplied: "block" });
      for (const args of [
        { action: "insert", database: "Story454", document: { a: 1 } },
        { action: "update", database: "Story454", id: "1", document: { a: 2 } },
      ]) {
        const { result, requests } = await callCounted(served, { key: `iris_docdb_document:${args.action}`, tool: "iris_docdb_document", args });
        expect(isDenied(result), args.action).toBe(false);
        expect(requests, `${args.action} reached the listener`).toBeGreaterThan(0);
      }
      const report = await governanceReport(served.session);
      expect(report.policy["iris_docdb_document:insert"]).toBe(true);
      expect(report.policy["iris_docdb_document:update"]).toBe(true);
      expect(report.configSource["iris_docdb_document:insert"]).toBe("default");
      expect(report.configSource["iris_docdb_document:update"]).toBe("default");
      expect(report.policy["iris_docdb_document:delete"]).toBe(false);
      expect(report.configSource["iris_docdb_document:delete"]).toBe("dataPolicy");
    });
  });

  it("a seeded parent is not an inherited disable: iris_sql_query reports dataPolicy, never parent, and its denial has no inheritedFrom", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("dev", { IRIS_DATA_POLICY: "block" }, async (served) => {
      const report = await governanceReport(served.session);
      expect(report.configSource["iris_sql_execute"]).toBe("dataPolicy");
      expect(report.configSource["iris_sql_query"]).toBe("dataPolicy");
      const { result } = await callCounted(served, DEV_COVERED[0] as Covered);
      expect(result.structuredContent).toEqual(governanceDenial("iris_sql_query", { dataPolicyApplied: "block" }));
      expect(result.structuredContent).not.toHaveProperty("inheritedFrom");
    });
  });

  it("an explicit child true wins over a seeded parent; an explicit parent true does not enable the child, in both orders and in the file", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const fileEnablesParent = writeJson(fixtureDir, "governance-parent.json", { global: { iris_sql_execute: true } });
    await serve("dev", { IRIS_DATA_POLICY: "block", IRIS_GOVERNANCE: JSON.stringify({ profiles: { default: { iris_sql_query: true } } }) }, async (served) => {
      const query = await callCounted(served, DEV_COVERED[0] as Covered);
      expect(isDenied(query.result)).toBe(false);
      expect(query.requests).toBeGreaterThan(0);
      const execute = await callCounted(served, DEV_COVERED[1] as Covered);
      expect(execute.result.structuredContent).toEqual(governanceDenial("iris_sql_execute", { dataPolicyApplied: "block" }));
      expect(execute.requests).toBe(0);
    });
    await serve("dev", { IRIS_DATA_POLICY: "block", IRIS_GOVERNANCE_FILE: fileEnablesParent }, async (served) => {
      const execute = await callCounted(served, DEV_COVERED[1] as Covered);
      expect(isDenied(execute.result)).toBe(false);
      const query = await callCounted(served, DEV_COVERED[0] as Covered);
      expect(query.result.structuredContent).toEqual(governanceDenial("iris_sql_query", { dataPolicyApplied: "block" }));
      expect(query.requests).toBe(0);
      const report = await governanceReport(served.session);
      expect(report.configSource["iris_sql_execute"]).toBe("file");
      expect(report.configSource["iris_sql_query"]).toBe("dataPolicy");
    });
  });
});

describe("QA 45.4: the warning's edge rows on the wire (AC 45.4.4)", () => {
  it("redact, block and allow profiles together: ONE line, the allow profile is not named, and the text never mentions allow", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const env = {
      IRIS_PROFILES: JSON.stringify({ c: { dataPolicy: "block" }, open: { dataPolicy: "allow" } }),
      IRIS_GOVERNANCE: JSON.stringify({ profiles: { c: { iris_sql_query: true } } }),
    };
    await serve("dev", env, async (served) => {
      const lines = warningLines(served);
      expect(lines).toEqual([
        mixedWarningOf(`profile "default" (${REDACT_MIXED}): ${DEV_WARNED.join(", ")}; profile "c" (${REENABLED}): iris_sql_query ${FROM.env}`),
      ]);
      expect(lines[0]).not.toContain('"open"');
      expect(lines[0]?.replace(/IRIS_DATA_POLICY=block/g, "")).not.toMatch(/allow/i);
      expect(served.stderr().split("\n").filter((line) => line.includes("[WARN]") && line.includes("Data policy:"))).toHaveLength(1);
    });
  });

  it("several profiles that share one list share one line and one group (three redact profiles)", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("dev", { IRIS_PROFILES: JSON.stringify({ a: {}, b: {}, c: {} }) }, async (served) => {
      expect(warningLines(served)).toEqual([warningOf(`profiles "default", "a", "b", "c" (redact): ${DEV_WARNED.join(", ")}`)]);
    });
  });

  it("every enabled covered tool disabled by governance: no line; every one hidden by IRIS_TOOLS_DISABLE: no line", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const off = Object.fromEntries(DEV_WARNED.map((key) => [key, false]));
    await serve("dev", { IRIS_GOVERNANCE: JSON.stringify({ global: off }) }, async (served) => {
      expect(warningLines(served)).toEqual([]);
    });
    const tools = [...new Set(DEV_COVERED.map((entry) => entry.tool))];
    await serve("dev", { IRIS_TOOLS_DISABLE: tools.join(",") }, async (served) => {
      expect(warningLines(served)).toEqual([]);
    });
    await serve("data", { IRIS_TOOLS_DISABLE: "iris_docdb_document,iris_docdb_find" }, async (served) => {
      expect(warningLines(served)).toEqual([]);
    });
  });

  it("the line is the same with IRIS unreachable (a closed port): it comes from configuration alone", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const audited = await openAuditedSession(
      {
        sdkEsmDir,
        entry: distEntry(REPO_ROOT, PACKAGES.dev),
        target: stubTarget(1, "story454-wire"),
        clientName: "story-45-4-block-seed-wire",
        auditFile: path.join(fixtureDir, `audit-closed-${Math.random().toString(36).slice(2)}.jsonl`),
      },
      {},
    );
    try {
      const lines = audited.stderr().split("\n").filter((line) => line.includes("Data policy:"));
      expect(lines).toEqual([warningOf(`profile "default" (redact): ${DEV_WARNED.join(", ")}`)]);
    } finally {
      await audited.session.close();
    }
  });

  it("under block with no re-enable no profile has a line, however many profiles there are", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("dev", { IRIS_DATA_POLICY: "block", IRIS_PROFILES: JSON.stringify({ a: {}, b: {} }) }, async (served) => {
      expect(warningLines(served)).toEqual([]);
    });
  });
});
