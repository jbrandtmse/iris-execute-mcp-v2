/**
 * Story 43.3 QA - the six confirmation gates as the spec states them (Design Notes, decision 13, "Per-gate strings"), written out by hand:
 * the call that reaches the dialog, the dialog's operation, target and scope, and the writes the call makes. Nothing here is read from the
 * code under test.
 */

import { AUDIT_URL, CONTROL_URL, RESEND_URL } from "./story-43-3-qa-baseline";
import { resultOf, type Json } from "./story-43-2-qa-hand-wire";
import { serverIdentity, type Conn } from "./story-43-3-qa-wire";

export const FROM = "2026-01-01T00:00:00Z";

export const STORAGE_EDIT: Json = {
  op: "delete",
  startLine: 4,
  endLine: 8,
  expected: "Storage Default\n{\n<DataLocation>^Demo.StoredD</DataLocation>\n<Type>%Storage.Persistent</Type>\n}",
};

/** A diff with one document that exists only on the source: `plan` turns it into the one step `putAndCompile Demo.Sample.cls`. */
export const PROMOTE_DIFF: Json = {
  source: { profile: "default", namespace: "HSCUSTOM" },
  target: { profile: "other", namespace: "HSCUSTOM" },
  domains: { documents: { onlyInSource: ["Demo.Sample.cls"], onlyInTarget: [], differs: [], identical: 0 } },
  summary: { driftCount: 1, identicalCount: 0 },
};

/** A diff with `count` documents that exist only on the source. */
export function manyDocumentsDiff(count: number): Json {
  const names = Array.from({ length: count }, (_unused, index) => `Demo.D${String(index + 1).padStart(2, "0")}.cls`);
  return {
    ...PROMOTE_DIFF,
    domains: { documents: { onlyInSource: names, onlyInTarget: [], differs: [], identical: 0 } },
    summary: { driftCount: count, identicalCount: 0 },
  };
}

export const post = (url: string, body: unknown): string => `POST ${url} ${JSON.stringify(body)}`;

/** The audit entry (without `seq`) that a call must leave when auditing logs no argument values: derived from what was sent and what came back. */
export function expectedEntry(pkg: string, tool: string, args: Json, result: Json): Json {
  const base = {
    serverPkg: serverIdentity(pkg).name,
    tool,
    action: args.action,
    profile: "default",
    namespace: "HSCUSTOM",
    paramKeys: Object.keys(JSON.parse(JSON.stringify(args))).sort(),
    profileSource: "env",
  };
  if (result.structuredContent?.code === "GOVERNANCE_DISABLED") return { ...base, outcome: "denied", denyReason: "GOVERNANCE_DISABLED" };
  if (result.isError === true) return { ...base, outcome: "error", error: result.content[0].text };
  return { ...base, outcome: "ok" };
}

/** An audit entry without `seq`, with its `paramKeys` sorted (the audit lists them in the order the schema parsed them). */
export function comparable(entry: Json): Json {
  const copy = { ...entry, paramKeys: [...entry.paramKeys].sort() };
  delete copy.seq;
  return copy;
}

export interface GateCase {
  /** The key of the gate's executing call in `BASELINE`. */
  id: string;
  pkg: string;
  tool: string;
  /** The `action` of the refusal's payload. */
  action: string;
  /** Build the arguments (the promotion needs a plan from the same connection). */
  args: (conn: Conn) => Promise<Json>;
  operation: string;
  target: string;
  scope: string;
  /** The writes listener A receives for the asking round, before the person answers. */
  preflight: string[];
  /** Where the gate's writes land. */
  side: "a" | "b";
}

const planArgs = (diff: Json): Json => ({ action: "plan", source: "default", target: "other", diff });

/** The `execute` arguments for a plan that a real `plan` call returned on `conn`. */
export async function promoteArgs(conn: Conn, diff: Json = PROMOTE_DIFF, extra: Json = {}): Promise<Json> {
  const planned = resultOf(await conn.call("iris_env_promote", planArgs(diff)).end());
  if (planned.isError === true) throw new Error(`the plan call was refused: ${JSON.stringify(planned).slice(0, 300)}`);
  return { action: "execute", source: "default", target: "other", diff, plan: planned.structuredContent, steps: [1], confirm: true, ...extra };
}

const fixed = (value: Json) => async (): Promise<Json> => value;

export const GATES: GateCase[] = [
  {
    id: "admin: purge ok",
    pkg: "iris-admin-mcp",
    tool: "iris_audit_manage",
    action: "purge",
    args: fixed({ action: "purge", end: "2026-01-01 00:00:00", confirm: true }),
    operation: "permanently delete audit-log records",
    target: "the IRIS audit log",
    scope: "records matching end=2026-01-01 00:00:00",
    preflight: [],
    side: "a",
  },
  {
    id: "interop: clean ok",
    pkg: "iris-interop-mcp",
    tool: "iris_production_control",
    action: "clean",
    args: fixed({ action: "clean", killAppData: true, confirm: true }),
    operation: "clean the production and wipe its persistent business state",
    target: "namespace HSCUSTOM",
    scope:
      "all Ens.AppData business state: HL7 sequence numbers, file and FTP done-file tables, batch and control-number state; " +
      "already-processed data can be ingested again",
    preflight: [],
    side: "a",
  },
  {
    id: "interop: resendFiltered ok",
    pkg: "iris-interop-mcp",
    tool: "iris_message_resend",
    action: "resendFiltered",
    args: fixed({ action: "resendFiltered", item: "Demo.Item", from: FROM, dryRun: false, confirm: true }),
    operation: "resend the messages that match a filter",
    target: "item Demo.Item, namespace HSCUSTOM",
    scope: `3 message(s) match now (status Errored, from ${FROM} to ${FROM}); IRIS counts again when it runs and resends at most 100`,
    preflight: [post(RESEND_URL, { action: "resendFiltered", item: "Demo.Item", from: FROM, namespace: "HSCUSTOM", dryRun: true })],
    side: "a",
  },
  {
    id: "interop: resend ok",
    pkg: "iris-interop-mcp",
    tool: "iris_message_resend",
    action: "resend",
    args: fixed({ action: "resend", headerIds: [11, 12] }),
    operation: "resend messages by header ID",
    target: "namespace HSCUSTOM",
    scope: "2 header ID(s): 11, 12",
    preflight: [],
    side: "a",
  },
  {
    id: "dev: regenerateStorage ok",
    pkg: "iris-dev-mcp",
    tool: "iris_doc_edit",
    action: "regenerateStorage",
    args: fixed({ action: "regenerateStorage", name: "Demo.Stored.cls", edits: [STORAGE_EDIT] }),
    operation: "save a document without the Storage guard",
    target: "document Demo.Stored.cls, namespace HSCUSTOM",
    scope: "1 edit(s); drops Storage definition(s): Default",
    preflight: [],
    side: "a",
  },
  {
    id: "dev: execute",
    pkg: "iris-dev-mcp",
    tool: "iris_env_promote",
    action: "execute",
    args: (conn) => promoteArgs(conn),
    operation: "promote changes to another server",
    target: "server 'other', namespace HSCUSTOM",
    scope: "1 step(s) from server 'default': #1 documents putAndCompile Demo.Sample.cls",
    preflight: [],
    side: "b",
  },
];

export { AUDIT_URL, CONTROL_URL, RESEND_URL };
