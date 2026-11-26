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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  distEntry,
  firstText,
  governanceDenial,
  governanceReport,
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
  { key: "iris_docdb_find", tool: "iris_docdb_find", args: { database: "Story454", filter: {} } },
];

/** The keys the default (redact) dev server lists in its warning: `iris_test_coverage` is a disabled write. */
const DEV_WARNED = DEV_COVERED.map((entry) => entry.key).filter((key) => key !== "iris_test_coverage");

// -- The hand-written warning text (decision #170 item 2; the unit test pins the same wording) ----------------

const WARNING_LEAD =
  '[WARN] Data policy: "redact" covers message bodies only, so these raw-read and code-execution tools are enabled and ' +
  "their results are not redacted or withheld: ";
const WARNING_TAIL =
  ". To turn tools off, set their governance keys to false (IRIS_GOVERNANCE or IRIS_GOVERNANCE_FILE) or set " +
  'IRIS_DATA_POLICY=block. See "PHI data policy" in the README.';
const warningOf = (groups: string): string => `${WARNING_LEAD}${groups}${WARNING_TAIL}`;
const REENABLED = "block, re-enabled by an explicit governance key";

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

  it("interop names iris_transform_test, data names both docdb keys, admin and ops write no line", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("interop", {}, async (served) => {
      expect(warningLines(served)).toEqual([warningOf('profile "default" (redact): iris_transform_test')]);
    });
    await serve("data", {}, async (served) => {
      expect(warningLines(served)).toEqual([warningOf('profile "default" (redact): iris_docdb_document:get, iris_docdb_find')]);
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

  it("interop and data: the covered keys are denied the same way; a docdb write action is not covered", async (ctx) => {
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
      expect(warningLines(served)).toEqual([warningOf(`profile "default" (${REENABLED}): iris_sql_query`)]);
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
      expect(warningLines(served)).toEqual([warningOf(`profile "default" (${REENABLED}): iris_global_get`)]);
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
      expect(warningLines(served)).toEqual([warningOf(`profile "default" (${REENABLED}): iris_sql_execute`)]);
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
        warningOf(
          `profiles "default", "a", "b" (redact): ${DEV_WARNED.join(", ")}; profile "c" (${REENABLED}): iris_sql_query`,
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

  it("an IRIS_GOVERNANCE false on a covered key under redact: that key is not named (it is not enabled)", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    await serve("dev", { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_query: false } }) }, async (served) => {
      const rest = DEV_WARNED.filter((key) => key !== "iris_sql_query");
      expect(warningLines(served)).toEqual([warningOf(`profile "default" (redact): ${rest.join(", ")}`)]);
    });
  });
});
