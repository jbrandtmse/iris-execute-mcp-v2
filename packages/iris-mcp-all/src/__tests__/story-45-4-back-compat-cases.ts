/**
 * Story 45.4 - the back-compat cases (`S-45.4-block-raw-tools`, Rule #19, Rule #36).
 *
 * Under the data policies `redact`, `allow` and unset, nothing the story adds may change what the built servers
 * report or refuse. {@link captureBackCompat} drives the BUILT servers over the real SDK client against a local
 * 503 listener (no IRIS) and returns what they said: the `iris_server_profiles` report (single profile and
 * `allProfiles`), the `iris-governance://` resource, the refusals of a few calls and their audit entries, and the
 * server's `[WARN]` lines.
 *
 * `story-45-4-back-compat.test.ts` replays these cases on the current dists and deep-equals the result against
 * `fixtures/story-45-4-back-compat-baseline.json`, which was captured by this module BEFORE any Story 45.4 code
 * change, from dists built at baseline revision 8e7aad87 (the test header records the command).
 *
 * Nothing here reads the Story 45.4 declarations: the module is the same on both sides of the change.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  distEntry,
  openAuditedSession,
  pollAuditEntries,
  start503Stub,
  stubTarget,
  type AuditEntry,
  type WireSession,
} from "./process-gate-helpers.js";

/** The five servers of the suite, by package directory. */
export const BACK_COMPAT_SERVERS = {
  dev: "iris-dev-mcp",
  admin: "iris-admin-mcp",
  interop: "iris-interop-mcp",
  ops: "iris-ops-mcp",
  data: "iris-data-mcp",
} as const;

/** A server of the suite. */
export type BackCompatServer = keyof typeof BACK_COMPAT_SERVERS;

/** The data policies the story must leave alone: `unset` is no `IRIS_DATA_POLICY` at all. */
export const BACK_COMPAT_POLICIES = ["unset", "redact", "allow"] as const;

/** One call a case makes: a tool of the dev server, with arguments that pass its schema. */
export interface BackCompatCall {
  tool: string;
  args: Record<string, unknown>;
}

/** One case: the server, the environment it starts with, and what is asked of it. */
export interface BackCompatCase {
  id: string;
  server: BackCompatServer;
  env: Record<string, string>;
  /** Tool calls (on the `default` profile) whose gate verdict and audit entry are recorded. */
  calls: BackCompatCall[];
}

/** What one case recorded. */
export interface BackCompatRecord {
  id: string;
  profiles: unknown;
  profilesAll: unknown;
  resources: Record<string, unknown>;
  calls: Array<{ tool: string; gate: "denied" | "passed"; denial?: unknown }>;
  audit: Array<Record<string, unknown>>;
  warnLines: string[];
}

/** The calls of the dev-server cases: three covered tools and one write that is not covered. */
const DEV_CALLS: BackCompatCall[] = [
  { tool: "iris_sql_query", args: { query: "SELECT 1" } },
  { tool: "iris_sql_execute", args: { query: "SELECT 1" } },
  { tool: "iris_global_get", args: { global: "Story454Probe" } },
  { tool: "iris_execute_command", args: { command: 'Write "x"' } },
  { tool: "iris_global_set", args: { global: "Story454Probe", value: "x" } },
];

/** The explicit governance configs of the matrix rows (re-enable, parent enable, parent disable). */
const EXPLICIT_ROWS: Array<{ label: string; governance?: string }> = [
  { label: "none" },
  { label: "enable-query", governance: JSON.stringify({ global: { iris_sql_query: true } }) },
  { label: "enable-execute", governance: JSON.stringify({ global: { iris_sql_execute: true } }) },
  { label: "disable-execute", governance: JSON.stringify({ global: { iris_sql_execute: false } }) },
];

function policyEnv(policy: (typeof BACK_COMPAT_POLICIES)[number]): Record<string, string> {
  return policy === "unset" ? {} : { IRIS_DATA_POLICY: policy };
}

/** Every case of the back-compat replay. */
export function backCompatCases(): BackCompatCase[] {
  const cases: BackCompatCase[] = [];
  // The all-keys sweep (decision #170, item 3): every server, every policy, with and without the preset.
  for (const server of Object.keys(BACK_COMPAT_SERVERS) as BackCompatServer[]) {
    for (const policy of BACK_COMPAT_POLICIES) {
      for (const preset of ["none", "read-only"]) {
        cases.push({
          id: `sweep/${server}/${policy}/${preset}`,
          server,
          env: {
            ...policyEnv(policy),
            ...(preset === "read-only" ? { IRIS_GOVERNANCE_PRESET: "read-only" } : {}),
            IRIS_PROFILES: JSON.stringify({ other: {} }),
          },
          calls: [],
        });
      }
    }
  }
  // The dev server with the explicit rows, the refusals and their audit entries.
  for (const row of EXPLICIT_ROWS) {
    for (const policy of BACK_COMPAT_POLICIES) {
      for (const preset of ["none", "read-only"]) {
        cases.push({
          id: `dev/${row.label}/${policy}/${preset}`,
          server: "dev",
          env: {
            ...policyEnv(policy),
            ...(preset === "read-only" ? { IRIS_GOVERNANCE_PRESET: "read-only" } : {}),
            ...(row.governance !== undefined ? { IRIS_GOVERNANCE: row.governance } : {}),
          },
          calls: DEV_CALLS,
        });
      }
    }
  }
  return cases;
}

/** An audit entry without the fields that differ on every run, and without error text. */
function normalizeAudit(entry: AuditEntry): Record<string, unknown> {
  const { ts: _ts, session: _session, seq: _seq, durationMs: _durationMs, error: _error, ...rest } = entry;
  void _ts;
  void _session;
  void _seq;
  void _durationMs;
  void _error;
  return rest;
}

/**
 * Wait until `read()` contains every one of `needles` (each at least as many times as it is listed), polling every
 * 20 ms, for at most `timeoutMs`. On timeout it returns without throwing: the record then shows what arrived, and
 * the comparison against the baseline names the case.
 */
async function waitForStderrLines(read: () => string, needles: string[], timeoutMs: number): Promise<void> {
  const counts = new Map<string, number>();
  for (const needle of needles) counts.set(needle, (counts.get(needle) ?? 0) + 1);
  const satisfied = (): boolean => {
    const text = read();
    for (const [needle, count] of counts) {
      if (text.split(needle).length - 1 < count) return false;
    }
    return true;
  };
  const deadline = Date.now() + timeoutMs;
  while (!satisfied() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Replace the stub's port wherever it appears, so a record does not depend on the port the run drew. */
function maskPort(value: unknown, port: number): unknown {
  const text = JSON.stringify(value) ?? "null";
  const bare = text.replace(new RegExp(`("port":)${port}\\b`, "g"), '$1"<PORT>"');
  return JSON.parse(bare.replace(new RegExp(`\\b${port}\\b`, "g"), "<PORT>")) as unknown;
}

/** What a governance view says, in a form small enough to keep and read: a digest of the whole, and its summary. */
interface GovernanceSummary {
  digest: string;
  keys: number;
  disabled: string[];
  sourceCounts: Record<string, number>;
  explicit: Record<string, string>;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Summarize one `policy` map and its `configSource` map. */
function summarizePolicy(policy: Record<string, boolean>, configSource: Record<string, string>): Omit<GovernanceSummary, "digest"> {
  const sourceCounts: Record<string, number> = {};
  const explicit: Record<string, string> = {};
  for (const [key, source] of Object.entries(configSource)) {
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
    if (source !== "default" && source !== "preset") explicit[key] = source;
  }
  return {
    keys: Object.keys(policy).length,
    disabled: Object.keys(policy).filter((key) => policy[key] === false),
    sourceCounts,
    explicit,
  };
}

/**
 * The record of a `governance` view (`iris_server_profiles` or the resource): a digest of the exact view and its summary,
 * per profile when the view holds several.
 */
function summarizeGovernance(view: Record<string, unknown>): unknown {
  const digest = sha256(JSON.stringify(view));
  if (view.policies !== undefined) {
    const policies = view.policies as Record<string, Record<string, boolean>>;
    const sources = view.configSources as Record<string, Record<string, string>>;
    return {
      digest,
      profiles: Object.fromEntries(Object.keys(policies).map((name) => [name, summarizePolicy(policies[name] ?? {}, sources[name] ?? {})])),
    };
  }
  return {
    digest,
    ...(view.profile !== undefined ? { profile: view.profile } : {}),
    ...summarizePolicy((view.policy ?? {}) as Record<string, boolean>, (view.configSource ?? {}) as Record<string, string>),
  };
}

/** The discovery answer: its roster in full (it is small), its governance view summarized, everything else in full. */
function summarizeDiscovery(result: { isError?: boolean; structuredContent?: Record<string, unknown> }): unknown {
  const { governance, ...rest } = result.structuredContent ?? {};
  return { isError: result.isError, ...rest, governance: summarizeGovernance((governance ?? {}) as Record<string, unknown>) };
}

async function resourceText(session: WireSession, uri: string): Promise<unknown> {
  const answer = (await session.request("resources/read", { uri })) as { contents: Array<{ text?: string }> };
  const view = JSON.parse(answer.contents[0]?.text ?? "{}") as { policy?: unknown; configSource?: unknown };
  return summarizeGovernance({ policy: view.policy, configSource: view.configSource });
}

/** Run one case against the built server of `spec.server`, pointed at a fresh 503 listener. */
async function runCase(spec: BackCompatCase, repoRoot: string, sdkEsmDir: string, tempDir: string): Promise<BackCompatRecord> {
  const stub = await start503Stub();
  const auditFile = path.join(tempDir, `${spec.id.replace(/[^A-Za-z0-9]/g, "-")}.jsonl`);
  let stderr = "";
  const audited = await openAuditedSession(
    {
      sdkEsmDir,
      entry: distEntry(repoRoot, BACK_COMPAT_SERVERS[spec.server]),
      target: stubTarget(stub.port, "story454-backcompat"),
      clientName: "story-45-4-back-compat",
      auditFile,
      onStderr: (chunk) => {
        stderr += chunk;
      },
    },
    spec.env,
  );
  try {
    const { session } = audited;
    const single = await session.raw("iris_server_profiles", {});
    const all = await session.raw("iris_server_profiles", { allProfiles: true });
    const resources: Record<string, unknown> = { "iris-governance://default": await resourceText(session, "iris-governance://default") };
    if (spec.env.IRIS_PROFILES !== undefined) {
      resources["iris-governance://other"] = await resourceText(session, "iris-governance://other");
    }
    const calls: BackCompatRecord["calls"] = [];
    for (const call of spec.calls) {
      const result = await session.call(call.tool, call.args);
      const denied = (result.structuredContent as { code?: string } | undefined)?.code === "GOVERNANCE_DISABLED";
      calls.push(
        denied
          ? { tool: call.tool, gate: "denied", denial: { isError: result.isError, structuredContent: result.structuredContent, content: result.content } }
          : { tool: call.tool, gate: "passed" },
      );
    }
    const audit: Array<Record<string, unknown>> = [];
    for (const call of spec.calls) {
      const entries = await pollAuditEntries(auditFile, { tool: call.tool, count: 1, intervalMs: 50, timeoutMs: 15000, excerpt: 300 });
      audit.push(normalizeAudit(entries[0] as AuditEntry));
    }
    // Every denied call writes one `[WARN] Tool <name>: … denied …` line on stderr, but stderr and the stdio result are
    // two pipes with no order between them: the line for the last call can land after its result (and after the
    // audit entries, which are often already on disk). Reading stderr then would miss it under CI load (main CI
    // 45899784897, `dev/enable-query/redact/read-only`). So wait until every denied call's line has arrived; the
    // set of lines read is then the same on every run.
    const deniedTools = calls.filter((call) => call.gate === "denied").map((call) => call.tool);
    await waitForStderrLines(() => stderr, deniedTools.map((tool) => `[WARN] Tool ${tool}:`), 15000);
    const warnLines = stderr
      .split("\n")
      .filter((line) => line.includes("[WARN]"))
      .sort();
    return maskPort(
      {
        id: spec.id,
        profiles: summarizeDiscovery(single),
        profilesAll: summarizeDiscovery(all),
        resources,
        calls,
        audit,
        warnLines,
      },
      stub.port,
    ) as BackCompatRecord;
  } finally {
    await audited.session.close();
    await stub.close();
  }
}

/**
 * Run every case on the built dists of the repository at `repoRoot` and return the records, in case order.
 *
 * @param repoRoot - The monorepo root.
 * @param sdkEsmDir - The SDK client's ESM directory (`resolveSdkEsmDir`).
 */
export async function captureBackCompat(repoRoot: string, sdkEsmDir: string): Promise<BackCompatRecord[]> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "story-45-4-back-compat-"));
  try {
    const records: BackCompatRecord[] = [];
    for (const spec of backCompatCases()) {
      records.push(await runCase(spec, repoRoot, sdkEsmDir, tempDir));
    }
    return records;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
