/**
 * Story 43.3 (AC 43.3.1 to 43.3.5, AD-34, AD-19; Rules #19, #36, #59) - the six gates that ask the person, on both eras, through the real SDK
 * client over stdio. Five of them (purge, clean, resendFiltered, resend, regenerateStorage) share one table of rows; the sixth, the
 * promotion `execute`, writes to a second server and has rows of its own.
 *
 * The BUILT admin, interop and dev servers run against the fake IRIS listener of `scripts/lib/fake-iris-listener.mjs` (a listener on
 * 127.0.0.1 inside this process; no IRIS instance is reached), with auditing on and the gated writes enabled. The SDK client is the
 * legacy one (`{mode: "legacy"}`, the 2025-11-25 handshake plus the SDK's own shim for the dialog) or pinned to 2026-07-28, and it
 * declares form elicitation or nothing. For each gate and era:
 *   - accept, decline, cancel and an accept without the tick: the form request the handler receives (the template and the schema), the
 *     result, the write requests the listener received, and the audit entry;
 *   - a client with no capability: the result, the write requests and the audit entry equal the literals below;
 *   - the calls that an existing check refuses first (and the calls that need no dialog): no form request reaches the client;
 *   - a `resendFiltered` whose read-only preview fails (HTTP 500) ends with that error and never sends the execute request, while one
 *     whose preview IRIS refuses (HTTP 200 with the error in the envelope, as IRIS refuses) sends the execute request as before.
 * A last row per era leaves the dialog unanswered and closes the client: one `unanswered` entry, and no write.
 *
 * The no-capability literals were captured (Rule #36) at baseline revision 0a5a3f8, before any source edit, by running this call list
 * with a scratch driver over the built dists (`capture.mjs`, Node 22, SDK 2.3.1): once with `{mode: "legacy"}` and once with
 * `{mode: {pin: "2026-07-28"}}`. The two captures were equal apart from `_meta` (the 2026-07-28 server identity), which is removed from
 * every modern result here. The stale-edit and the permanent-error rows were captured the same way from the same dists after the edits,
 * on paths that no edit touches. The promotion rows have no baseline literal: their expected result and write requests were captured
 * from the no-capability run of the built dev dist, whose path to the first write is the baseline path, and the accepted run must equal
 * that capture. A "write request" is a POST, PUT or DELETE to the listener other than the startup bootstrap query.
 *
 * The file fails, never skips, when a dist is missing or older than its source.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { startFakeIris } from "../../../../scripts/lib/fake-iris-listener.mjs";
import { normalizeAuditEntry, readBootstrapVersion } from "../../../../scripts/lib/sdk-handler-golden-core.mjs";
import { loadAllTools } from "../../../../scripts/lib/tool-catalog.mjs";
import {
  connectSdkClient,
  distEntry,
  pollAuditEntries,
  resolveSdkEsmDir,
  staleDistReason,
} from "./process-gate-helpers.js";
import type { AuditEntry, ElicitationAnswer, ElicitationRequest, SdkClient, SdkVersionNegotiation, WireToolResult } from "./process-gate-helpers.js";

type Era = "legacy" | "modern";

const ERAS: Array<[Era, SdkVersionNegotiation]> = [
  ["legacy", { mode: "legacy" }],
  ["modern", { mode: { pin: "2026-07-28" } }],
];

const FORM = { elicitation: { form: {} } };
const TICKED: ElicitationAnswer = { action: "accept", content: { confirm: true } };
const UNTICKED: ElicitationAnswer = { action: "accept", content: { confirm: false } };

/** The form every gate sends: one required boolean, unticked by default. */
const SCHEMA = {
  type: "object",
  properties: { confirm: { type: "boolean", title: "Confirm", description: "Tick to confirm this change.", default: false } },
  required: ["confirm"],
};

const TAIL = "Tick Confirm and accept to run it now. Decline or cancel to change nothing.";
const NOT_REPEAT = "Nothing was changed. Do not repeat this call unless the person asks for it again.";

// -- the literals, captured by running the baseline dists with no client capability ----------------------------------------------------

const STORED_LINES = [
  "Class Demo.Stored Extends %Persistent",
  "{",
  "Property A As %String;",
  "Storage Default",
  "{",
  "<DataLocation>^Demo.StoredD</DataLocation>",
  "<Type>%Storage.Persistent</Type>",
  "}",
  "}",
];

const STORAGE_EDIT = {
  op: "delete",
  startLine: 4,
  endLine: 8,
  expected: "Storage Default\n{\n<DataLocation>^Demo.StoredD</DataLocation>\n<Type>%Storage.Persistent</Type>\n}",
};

const RESEND_POST = "POST /api/executemcp/v2/interop/message/resend ";
const FILTERED = (item: string, tail: string): string =>
  `${RESEND_POST}{"action":"resendFiltered","item":"${item}","from":"2026-01-01T00:00:00Z","namespace":"HSCUSTOM"${tail}}`;
const EXECUTE_TAIL = ',"dryRun":false,"confirm":true';
const PREFLIGHT_TAIL = ',"dryRun":true';

const PURGE_ARGS = { action: "purge", end: "2026-01-01 00:00:00", confirm: true };
const CLEAN_ARGS = { action: "clean", killAppData: true, confirm: true };
const FILTERED_ARGS = { action: "resendFiltered", item: "Demo.Item", from: "2026-01-01T00:00:00Z", dryRun: false, confirm: true };
const RESEND_ARGS = { action: "resend", headerIds: [11, 12] };
const REGEN_ARGS = { action: "regenerateStorage", name: "Demo.Stored.cls", edits: [STORAGE_EDIT] };

interface Literal {
  /** What the no-capability client received. */
  result: unknown;
  /** The write requests the listener received for the call. */
  writes: string[];
  /** The audit entry, without `seq`, `ts`, `session` and `durationMs`. */
  audit: Record<string, unknown>;
}

const base = (pkg: string, tool: string, action: string, args: Record<string, unknown>): Record<string, unknown> => ({
  serverPkg: pkg,
  tool,
  action,
  profile: "default",
  namespace: "HSCUSTOM",
  paramKeys: Object.keys(args),
  profileSource: "env",
  params: args,
});

const PURGE_OK: Literal = {
  result: {
    content: [{ type: "text", text: '{\n  "action": "purge",\n  "deleted": 3,\n  "success": 1\n}' }],
    structuredContent: { action: "purge", deleted: 3, success: 1 },
  },
  writes: ['POST /api/executemcp/v2/security/audit {"action":"purge","confirm":true,"end":"2026-01-01 00:00:00"}'],
  audit: { ...base("@iris-mcp/admin", "iris_audit_manage", "purge", PURGE_ARGS), outcome: "ok" },
};

const PURGE_UNCONFIRMED_ARGS = { action: "purge", end: "2026-01-01 00:00:00" };
const PURGE_TEXT = "Error: 'purge' is destructive and requires confirm:true to proceed.";
const PURGE_REFUSED: Literal = {
  result: { content: [{ type: "text", text: PURGE_TEXT }], isError: true },
  writes: [],
  audit: { ...base("@iris-mcp/admin", "iris_audit_manage", "purge", PURGE_UNCONFIRMED_ARGS), outcome: "error", error: PURGE_TEXT },
};

const CLEAN_OK: Literal = {
  result: {
    content: [{ type: "text", text: '{\n  "action": "cleaned",\n  "killAppData": true\n}' }],
    structuredContent: { action: "cleaned", killAppData: true },
  },
  writes: ['POST /api/executemcp/v2/interop/production/control {"action":"clean","namespace":"HSCUSTOM","killAppData":true,"confirm":true}'],
  audit: { ...base("@iris-mcp/interop", "iris_production_control", "clean", CLEAN_ARGS), outcome: "ok" },
};

const CLEAN_UNCONFIRMED_ARGS = { action: "clean", killAppData: true };
const CLEAN_TEXT =
  "Error controlling production: IRIS returned HTTP 400 for POST /api/executemcp/v2/interop/production/control. Check the request parameters and try again. " +
  "Details: ERROR #5001: killAppData wipes the persistent Ens.AppData business state (HL7 sequence numbers, file/FTP done-file tables, batch/control-number state) " +
  "and can cause duplicate re-ingestion of already-processed data; it requires confirm:true. No changes were made.";
const CLEAN_REFUSED: Literal = {
  result: { content: [{ type: "text", text: CLEAN_TEXT }], isError: true },
  writes: ['POST /api/executemcp/v2/interop/production/control {"action":"clean","namespace":"HSCUSTOM","killAppData":true}'],
  audit: { ...base("@iris-mcp/interop", "iris_production_control", "clean", CLEAN_UNCONFIRMED_ARGS), outcome: "error", error: CLEAN_TEXT },
};

const FILTERED_OK: Literal = {
  result: {
    content: [{ type: "text", text: "resendFiltered: 3 matched, 3/3 succeeded, 0 failed" }],
    structuredContent: {
      action: "resendFiltered",
      dryRun: false,
      matchCount: 3,
      results: [],
      summary: { total: 3, succeeded: 3, failed: 0 },
    },
  },
  writes: [FILTERED("Demo.Item", EXECUTE_TAIL)],
  audit: { ...base("@iris-mcp/interop", "iris_message_resend", "resendFiltered", FILTERED_ARGS), outcome: "ok" },
};

const PREVIEW_ARGS = { action: "resendFiltered", item: "Demo.Item", from: "2026-01-01T00:00:00Z", confirm: true };
const FILTERED_PREVIEW: Literal = {
  result: {
    content: [
      {
        type: "text",
        text: "DRY RUN: 3 message(s) match the filter (showing up to 0); resent NOTHING. Pass dryRun:false and confirm:true to execute.",
      },
    ],
    structuredContent: {
      action: "resendFiltered",
      dryRun: true,
      matchCount: 3,
      sample: [],
      item: "Demo.Item",
      status: "Errored",
      from: "2026-01-01T00:00:00Z",
      to: "2026-01-01T00:00:00Z",
      maxMessages: 100,
    },
  },
  writes: [FILTERED("Demo.Item", ',"confirm":true')],
  audit: { ...base("@iris-mcp/interop", "iris_message_resend", "resendFiltered", PREVIEW_ARGS), outcome: "ok" },
};

const MANY_ARGS = { ...FILTERED_ARGS, item: "Demo.Many" };
const MANY_TEXT =
  "Error performing 'resendFiltered' on iris_message_resend: IRIS returned HTTP 400 for POST /api/executemcp/v2/interop/message/resend. " +
  "Check the request parameters and try again. Details: ERROR #5001: 600 messages match the filter, exceeding the maxMessages cap of 100; " +
  "narrow the time window or item filter and retry. No changes were made.";
const FILTERED_OVER_CAP: Literal = {
  result: { content: [{ type: "text", text: MANY_TEXT }], isError: true },
  writes: [FILTERED("Demo.Many", EXECUTE_TAIL)],
  audit: { ...base("@iris-mcp/interop", "iris_message_resend", "resendFiltered", MANY_ARGS), outcome: "error", error: MANY_TEXT },
};

const ZERO_ARGS = { ...FILTERED_ARGS, item: "Demo.Zero" };
const FILTERED_ZERO: Literal = {
  result: {
    content: [{ type: "text", text: "resendFiltered: 0 matched, 0/0 succeeded, 0 failed" }],
    structuredContent: {
      action: "resendFiltered",
      dryRun: false,
      matchCount: 0,
      results: [],
      summary: { total: 0, succeeded: 0, failed: 0 },
    },
  },
  writes: [FILTERED("Demo.Zero", EXECUTE_TAIL)],
  audit: { ...base("@iris-mcp/interop", "iris_message_resend", "resendFiltered", ZERO_ARGS), outcome: "ok" },
};

/** A `resendFiltered` whose preview fails with an HTTP 500 (the fake's `Demo.PreviewDown`); its execute would run. */
const PREVIEW_DOWN_ARGS = { ...FILTERED_ARGS, item: "Demo.PreviewDown" };
const PREVIEW_DOWN_TEXT =
  "Error performing 'resendFiltered' on iris_message_resend: IRIS returned HTTP 500 for POST /api/executemcp/v2/interop/message/resend. " +
  "Check the request parameters and try again. Details: ERROR #5002: the fake IRIS preview failed";

/** A `resendFiltered` that IRIS refuses, preview and execute alike, as the ExecuteMCPv2 handlers refuse: HTTP 200, error in the envelope. */
const REFUSED_ARGS = { ...FILTERED_ARGS, item: "Demo.Refused" };
const REFUSED_TEXT =
  "Error performing 'resendFiltered' on iris_message_resend: IRIS reported errors for POST /api/executemcp/v2/interop/message/resend. " +
  "Review the error details and correct the request. Details: ERROR #5001: The 'from'/'to' window spans approximately 9.00 days, " +
  "exceeding the maximum allowed window of 7 days; narrow the range and retry. No changes were made.";

const RESEND_OK: Literal = {
  result: {
    content: [{ type: "text", text: "Resend: 2/2 succeeded, 0 failed" }],
    structuredContent: { results: [], summary: { total: 2, succeeded: 2, failed: 0 } },
  },
  writes: [`${RESEND_POST}{"action":"resend","headerIds":[11,12],"namespace":"HSCUSTOM"}`],
  audit: { ...base("@iris-mcp/interop", "iris_message_resend", "resend", RESEND_ARGS), outcome: "ok" },
};

const REGEN_NUMBERED = STORED_LINES.map((line, index) => `     ${index + 1}\t${line}`).join("\n");
const REGEN_OK: Literal = {
  result: {
    content: [
      {
        type: "text",
        text:
          "Document 'Demo.Stored.cls' was saved in namespace 'HSCUSTOM', but IRIS stored the text it already had, so nothing changed; it has 9 lines " +
          "(ts 2026-01-01 00:00:00.000). IRIS reformats class source when it saves, so the edit has no effect." +
          `\n\nEdit 1 (delete lines 4-8), now lines 1-9:\n${REGEN_NUMBERED}`,
      },
    ],
    structuredContent: {
      name: "Demo.Stored.cls",
      namespace: "HSCUSTOM",
      ts: "2026-01-01 00:00:00.000",
      totalLines: 9,
      changed: false,
      unifiedDiff: "",
      excerpts: [{ edit: 1, op: "delete", startLine: 1, endLine: 9, lines: STORED_LINES }],
    },
  },
  writes: [
    'PUT /api/atelier/v8/HSCUSTOM/doc/Demo.Stored.cls {"enc":false,"content":["Class Demo.Stored Extends %Persistent","{","Property A As %String;","}"]}',
  ],
  audit: { ...base("@iris-mcp/dev", "iris_doc_edit", "regenerateStorage", REGEN_ARGS), outcome: "ok" },
};

const STALE_ARGS = { ...REGEN_ARGS, edits: [{ ...STORAGE_EDIT, expected: "Storage Other" }] };
const STALE_CURRENT = "     4\tStorage Default\n     5\t{\n     6\t<DataLocation>^Demo.StoredD</DataLocation>\n     7\t<Type>%Storage.Persistent</Type>\n     8\t}";
const STALE_TEXT =
  "Document 'Demo.Stored.cls' was not changed in namespace 'HSCUSTOM': the expected text of edit 1 does not match the document now. " +
  "Nothing was stored. Retry with the current text below as expected, or read the lines again with iris_doc_get." +
  `\n\nEdit 1 (delete lines 4-8), current text:\n${STALE_CURRENT}`;
const REGEN_STALE: Literal = {
  result: {
    content: [{ type: "text", text: STALE_TEXT }],
    structuredContent: {
      code: "STALE_CONTENT",
      name: "Demo.Stored.cls",
      namespace: "HSCUSTOM",
      ts: "2026-01-01 00:00:00.000",
      totalLines: 9,
      mismatches: [
        {
          edit: 1,
          op: "delete",
          startLine: 4,
          endLine: 8,
          current: "Storage Default\n{\n<DataLocation>^Demo.StoredD</DataLocation>\n<Type>%Storage.Persistent</Type>\n}\n",
        },
      ],
    },
    isError: true,
  },
  writes: [],
  audit: { ...base("@iris-mcp/dev", "iris_doc_edit", "regenerateStorage", STALE_ARGS), outcome: "error", error: STALE_TEXT },
};

// -- the gates -------------------------------------------------------------------------------------------------------------------------

interface Gate {
  id: string;
  pkg: string;
  tool: string;
  action: string;
  args: Record<string, unknown>;
  /** The operation phrase, the target and the scope of the dialog. */
  operation: string;
  target: string;
  scope: string;
  ok: Literal;
  /** The write requests an asked call makes before the person answers. */
  preflight: string[];
}

const GATES: Gate[] = [
  {
    id: "purge",
    pkg: "iris-admin-mcp",
    tool: "iris_audit_manage",
    action: "purge",
    args: PURGE_ARGS,
    operation: "permanently delete audit-log records",
    target: "the IRIS audit log",
    scope: "records matching end=2026-01-01 00:00:00",
    ok: PURGE_OK,
    preflight: [],
  },
  {
    id: "clean with killAppData",
    pkg: "iris-interop-mcp",
    tool: "iris_production_control",
    action: "clean",
    args: CLEAN_ARGS,
    operation: "clean the production and wipe its persistent business state",
    target: "namespace HSCUSTOM",
    scope:
      "all Ens.AppData business state: HL7 sequence numbers, file and FTP done-file tables, batch and control-number state; " +
      "already-processed data can be ingested again",
    ok: CLEAN_OK,
    preflight: [],
  },
  {
    id: "resendFiltered",
    pkg: "iris-interop-mcp",
    tool: "iris_message_resend",
    action: "resendFiltered",
    args: FILTERED_ARGS,
    operation: "resend the messages that match a filter",
    target: "item Demo.Item, namespace HSCUSTOM",
    scope:
      "3 message(s) match now (status Errored, from 2026-01-01T00:00:00Z to 2026-01-01T00:00:00Z); " +
      "IRIS counts again when it runs and resends at most 100",
    ok: FILTERED_OK,
    preflight: [FILTERED("Demo.Item", PREFLIGHT_TAIL)],
  },
  {
    id: "resend",
    pkg: "iris-interop-mcp",
    tool: "iris_message_resend",
    action: "resend",
    args: RESEND_ARGS,
    operation: "resend messages by header ID",
    target: "namespace HSCUSTOM",
    scope: "2 header ID(s): 11, 12",
    ok: RESEND_OK,
    preflight: [],
  },
  {
    id: "regenerateStorage",
    pkg: "iris-dev-mcp",
    tool: "iris_doc_edit",
    action: "regenerateStorage",
    args: REGEN_ARGS,
    operation: "save a document without the Storage guard",
    target: "document Demo.Stored.cls, namespace HSCUSTOM",
    scope: "1 edit(s); drops Storage definition(s): Default",
    ok: REGEN_OK,
    preflight: [],
  },
];

const messageOf = (gate: Gate, port: number): string =>
  `Confirm: ${gate.operation}.\nTarget: ${gate.target}\nScope: ${gate.scope}\nServer: default (127.0.0.1:${port})\n${TAIL}`;

const GATE_GOVERNANCE = {
  "iris_audit_manage:purge": true,
  "iris_message_resend:resend": true,
  "iris_message_resend:resendFiltered": true,
  "iris_doc_edit:regenerateStorage": true,
};

/** The governance of a rig: the gated writes enabled, and the promotion `execute` too when the rig has a second server. */
const governanceOf = (promote: boolean): string =>
  JSON.stringify({ global: { ...GATE_GOVERNANCE, ...(promote ? { "iris_env_promote:execute": true } : {}) } });

// -- the rig ---------------------------------------------------------------------------------------------------------------------------

/** What one call did, as the client, the listener and the audit file saw it. */
interface Exchange {
  /** The tool result, without the 2026-07-28 server identity in `_meta`. */
  result: WireToolResult;
  /** The write requests that the call caused. */
  writes: string[];
  /** The dialogs the call put to the client. */
  asks: ElicitationRequest[];
}

interface Rig {
  port: number;
  asked: ElicitationRequest[];
  auditFile: string;
  /** Set how the client answers the next dialogs; `"never"` leaves them unanswered. */
  answer: (answer: ElicitationAnswer | "never") => void;
  call: (tool: string, args: Record<string, unknown>) => Promise<Exchange>;
  /** The normalized tool entries of the audit file once it holds `count` of them, without `seq`. */
  entries: (count: number) => Promise<Array<Record<string, unknown>>>;
  /** All write requests the listener has received. */
  writes: () => string[];
  /** All write requests the second listener (the profile `other`, a promotion's target) has received; empty on a rig without one. */
  otherWrites: () => string[];
  close: () => Promise<void>;
  client: SdkClient;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => undefined);
});

const isWrite = (request: { method: string; url: string }): boolean =>
  ["POST", "PUT", "DELETE"].includes(request.method) && !request.url.endsWith("/action/query");

const writeLine = (request: { method: string; url: string; body: string }): string =>
  `${request.method} ${request.url}${request.body === "" ? "" : ` ${request.body}`}`;

function withoutMeta(result: WireToolResult): WireToolResult {
  const { _meta: _identity, ...rest } = result as WireToolResult & { _meta?: unknown };
  return rest;
}

/** Start `pkg`'s built server against a fake listener and connect a client that declares `capabilities`. */
async function openRig(
  pkg: string,
  negotiation: SdkVersionNegotiation,
  options: { capabilities?: Record<string, unknown>; governed?: boolean; promote?: boolean } = {},
): Promise<Rig> {
  const stale = ["shared", pkg].map((name) => [name, staleDistReason(REPO_ROOT, name)] as const).filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([name, reason]) => `${name}: ${reason}`).join("; ")}`);
  const sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
  if (sdkEsmDir === undefined) throw new Error("The MCP SDK client is not installed.");

  const fake = await startFakeIris({ bootstrapVersion: readBootstrapVersion(REPO_ROOT) });
  const promote = options.promote === true;
  const otherFake = promote ? await startFakeIris({ bootstrapVersion: readBootstrapVersion(REPO_ROOT) }) : undefined;
  const directory = mkdtempSync(path.join(tmpdir(), "story-43-3-"));
  const auditFile = path.join(directory, "audit.jsonl");
  const asked: ElicitationRequest[] = [];
  let next: ElicitationAnswer | "never" = TICKED;
  const client = await connectSdkClient(
    {
      sdkEsmDir,
      entry: distEntry(REPO_ROOT, pkg),
      target: { host: "127.0.0.1", port: String(fake.port), username: "qa", password: "qa", namespace: "HSCUSTOM" },
      clientName: "story-43-3",
      versionNegotiation: negotiation,
      ...(options.capabilities !== undefined ? { clientCapabilities: options.capabilities } : {}),
      onElicitation: (request) => {
        asked.push(request);
        return next === "never" ? new Promise<ElicitationAnswer>(() => undefined) : next;
      },
    },
    {
      IRIS_AUDIT_LOG: auditFile,
      IRIS_AUDIT_LOG_PARAMS: "true",
      ...(options.governed === false ? {} : { IRIS_GOVERNANCE: governanceOf(promote) }),
      ...(otherFake !== undefined
        ? { IRIS_PROFILES: JSON.stringify({ other: { host: "127.0.0.1", port: otherFake.port, username: "qa", password: "qa", namespace: "HSCUSTOM" } }) }
        : {}),
    },
  );
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await client.close().catch(() => undefined);
    await fake.close();
    await otherFake?.close();
    rmSync(directory, { recursive: true, force: true });
  };
  cleanups.push(close);

  return {
    port: fake.port,
    asked,
    auditFile,
    client,
    answer: (answer) => {
      next = answer;
    },
    call: async (tool, args) => {
      const before = fake.requests.length;
      const askedBefore = asked.length;
      const result = await client.callTool({ name: tool, arguments: args });
      return {
        result: withoutMeta(result),
        writes: fake.requests.slice(before).filter(isWrite).map(writeLine),
        asks: asked.slice(askedBefore),
      };
    },
    entries: async (count) => {
      const read = async (): Promise<Array<Record<string, unknown>>> =>
        (
          await pollAuditEntries(auditFile, {
            count,
            isWanted: (entry: AuditEntry) => typeof entry["tool"] === "string",
            returnAll: true,
            intervalMs: 25,
            timeoutMs: 10_000,
            excerpt: 600,
          })
        )
          .filter((entry) => typeof entry["tool"] === "string")
          .map((entry) => {
            const { seq: _seq, ...rest } = normalizeAuditEntry(entry) as Record<string, unknown>;
            return rest;
          });
      // The entries are written after the reply: read again after a pause, so an entry written late is seen too.
      await read();
      await new Promise((resolve) => setTimeout(resolve, 200));
      return read();
    },
    writes: () => fake.requests.filter(isWrite).map(writeLine),
    otherWrites: () => (otherFake?.requests ?? []).filter(isWrite).map(writeLine),
    close,
  };
}

/** The audit entry of a Literal, without `seq`. */
const auditOf = (literal: Literal, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ ...literal.audit, ...extra });

// -- the rows --------------------------------------------------------------------------------------------------------------------------

describe("AC 43.3.1: the gate inventory, exhaustive as of 2026-10-20 (Rule #56)", () => {
  /** The parameters whose presence makes a tool a candidate for the inventory. */
  const GATING_PARAMETERS = ["confirm", "force", "killAppData", "dryRun", "allowStorageRegeneration", "ignoreConflict", "overwrite", "allowWide"];

  /** Every tool with such a parameter, and the verdict of the inventory table for it (the grouped row covers the rest of the destructive tools). */
  const NAMED: Record<string, string> = {
    iris_audit_manage: "gate: purge",
    iris_env_promote: "gate: execute",
    iris_production_control: "gate: clean with killAppData; stop and restart force is not a guard override",
    iris_message_resend: "gate: resendFiltered execute",
    iris_doc_put: "not gated, a candidate: allowStorageRegeneration; ignoreConflict is a version-check override",
    iris_mapping_manage: "not gated, a candidate: force",
    iris_doc_load: "not gated: ignoreConflict is a version-check override",
    iris_doc_export: "not gated: overwrite is a local-disk override",
    iris_env_diff: "not gated: allowWide is a read",
  };

  it("names every tool that carries a gating parameter, and the suite still has 110 package tools of which 36 are destructive", async () => {
    const all = (await loadAllTools(REPO_ROOT)) as Array<{ pkg: string; tool: { name: string; inputSchema?: { shape?: Record<string, unknown> }; annotations?: { destructiveHint?: boolean } } }>;
    const carrying = all
      .filter(({ tool }) => Object.keys(tool.inputSchema?.shape ?? {}).some((key) => GATING_PARAMETERS.includes(key)))
      .map(({ tool }) => tool.name)
      .sort();
    expect(carrying).toEqual(Object.keys(NAMED).sort());
    expect(all).toHaveLength(110);
    expect(all.filter(({ tool }) => tool.annotations?.destructiveHint === true)).toHaveLength(36);
  });

  it("exactly six call sites ask the person: purge, execute, regenerateStorage, clean, resend and resendFiltered, and no other", () => {
    const sites: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(path.join(REPO_ROOT, directory), { withFileTypes: true })) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!["node_modules", "dist", "__tests__"].includes(entry.name)) walk(relative);
        } else if (entry.name.endsWith(".ts")) {
          for (const line of readFileSync(path.join(REPO_ROOT, relative), "utf8").split("\n")) {
            if (/ctx.confirm/.test(line)) sites.push(relative);
          }
        }
      }
    };
    for (const pkg of readdirSync(path.join(REPO_ROOT, "packages")).filter((name) => /^iris-.*-mcp$/.test(name))) walk(`packages/${pkg}/src`);
    expect(sites.sort()).toEqual([
      "packages/iris-admin-mcp/src/tools/audit.ts",
      "packages/iris-dev-mcp/src/tools/doc-edit.ts",
      "packages/iris-dev-mcp/src/tools/env-promote.ts",
      "packages/iris-interop-mcp/src/tools/message-resend.ts",
      "packages/iris-interop-mcp/src/tools/message-resend.ts",
      "packages/iris-interop-mcp/src/tools/production.ts",
    ]);
  });
});

describe.each(ERAS)("Story 43.3 on the %s era: five of the six gates ask the person", (_era, negotiation) => {
  describe.each(GATES)("$id", (gate) => {
    it(
      "accept: one form request with the template and the form, the call runs once and returns what a client without a dialog gets, one entry says accepted",
      async () => {
        const rig = await openRig(gate.pkg, negotiation, { capabilities: FORM });
        rig.answer(TICKED);

        const exchange = await rig.call(gate.tool, gate.args);

        expect(exchange.asks).toHaveLength(1);
        expect(exchange.asks[0]).toMatchObject({ mode: "form", message: messageOf(gate, rig.port) });
        expect(exchange.asks[0]?.requestedSchema).toStrictEqual(SCHEMA);
        expect(exchange.result).toEqual(gate.ok.result);
        expect(exchange.writes).toEqual([...gate.preflight, ...gate.ok.writes]);
        const entries = await rig.entries(1);
        expect(entries).toEqual([auditOf(gate.ok, { confirmation: "accepted" })]);
      },
      60_000,
    );

    it.each([
      ["decline", { action: "decline" } as ElicitationAnswer, "decline", "declined", `The person declined the confirmation for: ${"OPERATION"}. ${NOT_REPEAT}`],
      ["cancel", { action: "cancel" } as ElicitationAnswer, "cancel", "cancelled", `The person dismissed the confirmation dialog for: ${"OPERATION"}. ${NOT_REPEAT}`],
      [
        "an accept without the tick",
        UNTICKED,
        "unconfirmed",
        "unconfirmed",
        `The person accepted the confirmation dialog for: ${"OPERATION"} without ticking Confirm. ${NOT_REPEAT}`,
      ],
    ])(
      "%s: CONFIRMATION_DECLINED, no write, asked once and never again, one denied entry",
      async (_label, answer, response, recorded, template) => {
        const rig = await openRig(gate.pkg, negotiation, { capabilities: FORM });
        rig.answer(answer);

        const exchange = await rig.call(gate.tool, gate.args);

        expect(exchange.asks).toHaveLength(1);
        expect(exchange.result).toEqual({
          content: [{ type: "text", text: template.replace("OPERATION", gate.operation) }],
          structuredContent: { code: "CONFIRMATION_DECLINED", action: gate.action, response },
          isError: true,
        });
        expect(exchange.writes).toEqual(gate.preflight);
        // Nothing the gate writes was sent: the write requests of the executing call are absent from the listener.
        for (const line of gate.ok.writes) expect(rig.writes()).not.toContain(line);
        const entries = await rig.entries(1);
        expect(entries).toEqual([
          {
            ...(gate.ok.audit as Record<string, unknown>),
            outcome: "denied",
            denyReason: "CONFIRMATION_DECLINED",
            confirmation: recorded,
          },
        ]);
      },
      60_000,
    );

    it(
      "no capability: the result, the write requests and the audit entry equal the baseline capture, and no dialog is sent",
      async () => {
        const rig = await openRig(gate.pkg, negotiation);

        const exchange = await rig.call(gate.tool, gate.args);

        expect(exchange.asks).toEqual([]);
        expect(exchange.result).toEqual(gate.ok.result);
        expect(exchange.writes).toEqual(gate.ok.writes);
        expect(await rig.entries(1)).toEqual([auditOf(gate.ok)]);
      },
      60_000,
    );

    it(
      "a client that declares url elicitation alone gets the baseline too",
      async () => {
        const rig = await openRig(gate.pkg, negotiation, { capabilities: { elicitation: { url: {} } } });

        const exchange = await rig.call(gate.tool, gate.args);

        expect(exchange.asks).toEqual([]);
        expect(exchange.result).toEqual(gate.ok.result);
        expect(exchange.writes).toEqual(gate.ok.writes);
      },
      60_000,
    );
  });

  describe("the calls that an existing check refuses, or that need no dialog, ask nothing", () => {
    it(
      "admin: a purge without confirm is today's refusal",
      async () => {
        const rig = await openRig("iris-admin-mcp", negotiation, { capabilities: FORM });
        const exchange = await rig.call("iris_audit_manage", PURGE_UNCONFIRMED_ARGS);
        expect(exchange.asks).toEqual([]);
        expect(exchange.result).toEqual(PURGE_REFUSED.result);
        expect(exchange.writes).toEqual(PURGE_REFUSED.writes);
        expect(await rig.entries(1)).toEqual([auditOf(PURGE_REFUSED)]);
      },
      60_000,
    );

    it(
      "admin: a purge that governance disables is refused before any dialog and audited denied with no confirmation",
      async () => {
        const rig = await openRig("iris-admin-mcp", negotiation, { capabilities: FORM, governed: false });
        const exchange = await rig.call("iris_audit_manage", PURGE_ARGS);
        expect(exchange.asks).toEqual([]);
        expect(exchange.result).toEqual({
          content: [{ type: "text", text: "action 'iris_audit_manage:purge' is disabled by governance policy for server 'default'" }],
          structuredContent: { code: "GOVERNANCE_DISABLED", action: "iris_audit_manage:purge", server: "default" },
          isError: true,
        });
        expect(exchange.writes).toEqual([]);
        expect(await rig.entries(1)).toEqual([
          { ...(PURGE_OK.audit as Record<string, unknown>), outcome: "denied", denyReason: "GOVERNANCE_DISABLED" },
        ]);
      },
      60_000,
    );

    it(
      "interop: clean + killAppData without confirm, and a resendFiltered preview, are today's results, with no dialog",
      async () => {
        const rig = await openRig("iris-interop-mcp", negotiation, { capabilities: FORM });
        const clean = await rig.call("iris_production_control", CLEAN_UNCONFIRMED_ARGS);
        const preview = await rig.call("iris_message_resend", PREVIEW_ARGS);

        expect(clean.asks).toEqual([]);
        expect(clean.result).toEqual(CLEAN_REFUSED.result);
        expect(clean.writes).toEqual(CLEAN_REFUSED.writes);
        expect(preview.asks).toEqual([]);
        expect(preview.result).toEqual(FILTERED_PREVIEW.result);
        expect(preview.writes).toEqual(FILTERED_PREVIEW.writes);
        expect(await rig.entries(2)).toEqual([auditOf(CLEAN_REFUSED), auditOf(FILTERED_PREVIEW)]);
        expect(rig.asked).toEqual([]);
      },
      60_000,
    );

    it(
      "interop: a resendFiltered over the cap asks nothing and returns IRIS's refusal; the execute request is sent after the preview",
      async () => {
        const rig = await openRig("iris-interop-mcp", negotiation, { capabilities: FORM });

        const exchange = await rig.call("iris_message_resend", MANY_ARGS);

        expect(exchange.asks).toEqual([]);
        expect(exchange.result).toEqual(FILTERED_OVER_CAP.result);
        expect(exchange.writes).toEqual([FILTERED("Demo.Many", PREFLIGHT_TAIL), ...FILTERED_OVER_CAP.writes]);
        expect(await rig.entries(1)).toEqual([auditOf(FILTERED_OVER_CAP)]);
      },
      60_000,
    );

    it(
      "interop: a resendFiltered with no match asks nothing and runs as today; the execute request is sent after the preview",
      async () => {
        const rig = await openRig("iris-interop-mcp", negotiation, { capabilities: FORM });

        const exchange = await rig.call("iris_message_resend", ZERO_ARGS);

        expect(exchange.asks).toEqual([]);
        expect(exchange.result).toEqual(FILTERED_ZERO.result);
        expect(exchange.writes).toEqual([FILTERED("Demo.Zero", PREFLIGHT_TAIL), ...FILTERED_ZERO.writes]);
        expect(await rig.entries(1)).toEqual([auditOf(FILTERED_ZERO)]);
      },
      60_000,
    );

    it(
      "interop: a resendFiltered whose preview fails with an HTTP 500 asks nothing, ends with that error and never sends the execute request",
      async () => {
        const rig = await openRig("iris-interop-mcp", negotiation, { capabilities: FORM });

        const exchange = await rig.call("iris_message_resend", PREVIEW_DOWN_ARGS);

        expect(exchange.asks).toEqual([]);
        expect(exchange.result).toEqual({ content: [{ type: "text", text: PREVIEW_DOWN_TEXT }], isError: true });
        expect(exchange.writes).toEqual([FILTERED("Demo.PreviewDown", PREFLIGHT_TAIL)]);
        expect(await rig.entries(1)).toEqual([
          { ...base("@iris-mcp/interop", "iris_message_resend", "resendFiltered", PREVIEW_DOWN_ARGS), outcome: "error", error: PREVIEW_DOWN_TEXT },
        ]);
      },
      60_000,
    );

    it(
      "interop: a resendFiltered whose preview IRIS refuses asks nothing; the execute request is sent as before and IRIS refuses it too",
      async () => {
        const rig = await openRig("iris-interop-mcp", negotiation, { capabilities: FORM });

        const exchange = await rig.call("iris_message_resend", REFUSED_ARGS);

        expect(exchange.asks).toEqual([]);
        expect(exchange.result).toEqual({ content: [{ type: "text", text: REFUSED_TEXT }], isError: true });
        expect(exchange.writes).toEqual([FILTERED("Demo.Refused", PREFLIGHT_TAIL), FILTERED("Demo.Refused", EXECUTE_TAIL)]);
        expect(await rig.entries(1)).toEqual([
          { ...base("@iris-mcp/interop", "iris_message_resend", "resendFiltered", REFUSED_ARGS), outcome: "error", error: REFUSED_TEXT },
        ]);
      },
      60_000,
    );

    it(
      "interop: without a capability a resendFiltered whose preview would fail sends no preview and runs as before",
      async () => {
        const rig = await openRig("iris-interop-mcp", negotiation);

        const exchange = await rig.call("iris_message_resend", PREVIEW_DOWN_ARGS);

        expect(exchange.result).toEqual({
          content: [{ type: "text", text: "resendFiltered: 3 matched, 3/3 succeeded, 0 failed" }],
          structuredContent: { action: "resendFiltered", dryRun: false, matchCount: 3, results: [], summary: { total: 3, succeeded: 3, failed: 0 } },
        });
        expect(exchange.writes).toEqual([FILTERED("Demo.PreviewDown", EXECUTE_TAIL)]);
        expect(await rig.entries(1)).toEqual([
          { ...base("@iris-mcp/interop", "iris_message_resend", "resendFiltered", PREVIEW_DOWN_ARGS), outcome: "ok" },
        ]);
      },
      60_000,
    );

    it(
      "interop: without a capability the over-cap and no-match runs send no preview at all",
      async () => {
        const rig = await openRig("iris-interop-mcp", negotiation);
        const over = await rig.call("iris_message_resend", MANY_ARGS);
        const zero = await rig.call("iris_message_resend", ZERO_ARGS);
        expect(over.result).toEqual(FILTERED_OVER_CAP.result);
        expect(over.writes).toEqual(FILTERED_OVER_CAP.writes);
        expect(zero.result).toEqual(FILTERED_ZERO.result);
        expect(zero.writes).toEqual(FILTERED_ZERO.writes);
        expect(await rig.entries(2)).toEqual([auditOf(FILTERED_OVER_CAP), auditOf(FILTERED_ZERO)]);
      },
      60_000,
    );

    it(
      "dev: a stale regenerateStorage edit is today's refusal with no dialog, and governance refuses a disabled one first",
      async () => {
        const rig = await openRig("iris-dev-mcp", negotiation, { capabilities: FORM });
        const stale = await rig.call("iris_doc_edit", STALE_ARGS);
        expect(stale.asks).toEqual([]);
        expect(stale.result).toEqual(REGEN_STALE.result);
        expect(stale.writes).toEqual([]);
        expect(await rig.entries(1)).toEqual([auditOf(REGEN_STALE)]);

        const ungoverned = await openRig("iris-dev-mcp", negotiation, { capabilities: FORM, governed: false });
        const refused = await ungoverned.call("iris_doc_edit", REGEN_ARGS);
        expect(refused.asks).toEqual([]);
        expect(refused.result).toEqual({
          content: [{ type: "text", text: "action 'iris_doc_edit:regenerateStorage' is disabled by governance policy for server 'default'" }],
          structuredContent: { code: "GOVERNANCE_DISABLED", action: "iris_doc_edit:regenerateStorage", server: "default" },
          isError: true,
        });
        expect(refused.writes).toEqual([]);
      },
      60_000,
    );
  });

  describe("no capability: every call of the capture equals its baseline literals", () => {
    it(
      "admin: purge",
      async () => {
        const rig = await openRig("iris-admin-mcp", negotiation);
        for (const literal of [PURGE_OK, PURGE_REFUSED]) {
          const args = literal === PURGE_OK ? PURGE_ARGS : PURGE_UNCONFIRMED_ARGS;
          const exchange = await rig.call("iris_audit_manage", args);
          expect(exchange.result).toEqual(literal.result);
          expect(exchange.writes).toEqual(literal.writes);
        }
        expect(await rig.entries(2)).toEqual([auditOf(PURGE_OK), auditOf(PURGE_REFUSED)]);
        expect(rig.asked).toEqual([]);
      },
      60_000,
    );

    it(
      "interop: clean, resendFiltered and resend",
      async () => {
        const rig = await openRig("iris-interop-mcp", negotiation);
        const calls: Array<[string, Record<string, unknown>, Literal]> = [
          ["iris_production_control", CLEAN_ARGS, CLEAN_OK],
          ["iris_production_control", CLEAN_UNCONFIRMED_ARGS, CLEAN_REFUSED],
          ["iris_message_resend", FILTERED_ARGS, FILTERED_OK],
          ["iris_message_resend", PREVIEW_ARGS, FILTERED_PREVIEW],
          ["iris_message_resend", MANY_ARGS, FILTERED_OVER_CAP],
          ["iris_message_resend", ZERO_ARGS, FILTERED_ZERO],
          ["iris_message_resend", RESEND_ARGS, RESEND_OK],
        ];
        for (const [tool, args, literal] of calls) {
          const exchange = await rig.call(tool, args);
          expect(exchange.result).toEqual(literal.result);
          expect(exchange.writes).toEqual(literal.writes);
        }
        expect(await rig.entries(calls.length)).toEqual(calls.map(([, , literal]) => auditOf(literal)));
        expect(rig.asked).toEqual([]);
      },
      60_000,
    );

    it(
      "dev: regenerateStorage",
      async () => {
        const rig = await openRig("iris-dev-mcp", negotiation);
        const ok = await rig.call("iris_doc_edit", REGEN_ARGS);
        const stale = await rig.call("iris_doc_edit", STALE_ARGS);
        expect(ok.result).toEqual(REGEN_OK.result);
        expect(ok.writes).toEqual(REGEN_OK.writes);
        expect(stale.result).toEqual(REGEN_STALE.result);
        expect(stale.writes).toEqual(REGEN_STALE.writes);
        expect(await rig.entries(2)).toEqual([auditOf(REGEN_OK), auditOf(REGEN_STALE)]);
        expect(rig.asked).toEqual([]);
      },
      60_000,
    );
  });

  describe("integration: iris_audit_manage purge with one bound", () => {
    it(
      "the client's handler receives one form request naming the purge and the bound; the listener records one purge POST after an accept and none after a decline",
      async () => {
        const rig = await openRig("iris-admin-mcp", negotiation, { capabilities: FORM });
        const purges = (): string[] => rig.writes().filter((line) => line.includes("/security/audit"));

        rig.answer({ action: "decline" });
        await rig.call("iris_audit_manage", PURGE_ARGS);
        expect(rig.asked).toHaveLength(1);
        expect(rig.asked[0]?.message).toContain("Confirm: permanently delete audit-log records.");
        expect(rig.asked[0]?.message).toContain("Scope: records matching end=2026-01-01 00:00:00");
        expect(purges()).toEqual([]);

        rig.answer(TICKED);
        await rig.call("iris_audit_manage", PURGE_ARGS);
        expect(rig.asked).toHaveLength(2);
        expect(purges()).toEqual(PURGE_OK.writes);
        expect(await rig.entries(2)).toHaveLength(2);
      },
      60_000,
    );
  });

  describe("a dialog that nobody answers", () => {
    it(
      "closing the client writes one unanswered entry and no write reaches IRIS",
      async () => {
        const rig = await openRig("iris-admin-mcp", negotiation, { capabilities: FORM });
        rig.answer("never");

        const pending = rig.client.callTool({ name: "iris_audit_manage", arguments: PURGE_ARGS }).catch(() => undefined);
        const deadline = Date.now() + 15_000;
        while (rig.asked.length === 0) {
          if (Date.now() > deadline) throw new Error("the server never asked");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(rig.asked).toHaveLength(1);
        expect(await Promise.race([pending.then(() => "answered"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 300))])).toBe("waiting");

        // On the 2026-07-28 era the client answers the dialog itself, so closing the transport does not settle the call.
        await rig.client.close();
        void pending;

        const entries = await rig.entries(1);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toEqual({
          ...(PURGE_OK.audit as Record<string, unknown>),
          outcome: "error",
          error: "The confirmation dialog was not answered. Nothing was changed.",
          confirmation: "unanswered",
        });
        expect(rig.writes().filter((line) => line.includes("/security/audit"))).toEqual([]);
        // The one entry stays the only one.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(await rig.entries(1)).toHaveLength(1);
      },
      60_000,
    );
  });
});

// -- the sixth gate: the promotion execute, which writes to a second server --------------------------------------------------------------

/** A diff with one document that exists only on the source: `plan` turns it into the one step `putAndCompile Demo.Sample.cls`. */
const PROMOTE_DIFF = {
  source: { profile: "default", namespace: "HSCUSTOM" },
  target: { profile: "other", namespace: "HSCUSTOM" },
  domains: { documents: { onlyInSource: ["Demo.Sample.cls"], onlyInTarget: [], differs: [], identical: 0 } },
  summary: { driftCount: 1, identicalCount: 0 },
};

/** The two writes that the promotion makes to the target: the save of the document, then the compile. */
const PROMOTE_PUT =
  'PUT /api/atelier/v8/HSCUSTOM/doc/Demo.Sample.cls?ignoreConflict=1 {"enc":false,"content":["Class Demo.Sample Extends %RegisteredObject","{","Method A()","{","}","}"]}';
const PROMOTE_COMPILE = 'POST /api/atelier/v8/HSCUSTOM/action/compile?flags=cuk ["Demo.Sample.cls"]';

const PROMOTE_STEP = { index: 1, domain: "documents", operation: "putAndCompile", subject: "Demo.Sample.cls", status: "completed" };

/** The `execute` call for the plan that a real `plan` call returned. */
const promoteArgs = (plan: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: "execute",
  source: "default",
  target: "other",
  diff: PROMOTE_DIFF,
  plan,
  steps: [1],
  confirm: true,
  ...extra,
});

describe.each(ERAS)("Story 43.3 on the %s era: the promotion execute asks the person", (_era, negotiation) => {
  /** A rig with a second server, and the plan that a real `plan` call returns for the diff. */
  async function promoting(capabilities?: Record<string, unknown>): Promise<{ rig: Rig; plan: unknown }> {
    const rig = await openRig("iris-dev-mcp", negotiation, { ...(capabilities !== undefined ? { capabilities } : {}), promote: true });
    const planned = await rig.call("iris_env_promote", { action: "plan", source: "default", target: "other", diff: PROMOTE_DIFF });
    expect(planned.result.isError).toBeUndefined();
    expect(planned.asks).toEqual([]);
    return { rig, plan: planned.result.structuredContent };
  }

  const promotionMessage = (port: number): string =>
    "Confirm: promote changes to another server.\n" +
    "Target: server 'other', namespace HSCUSTOM\n" +
    "Scope: 1 step(s) from server 'default': #1 documents putAndCompile Demo.Sample.cls\n" +
    `Server: default (127.0.0.1:${port})\n${TAIL}`;

  it(
    "no capability: the promotion runs without a dialog, the source is only read and the target gets the save and the compile",
    async () => {
      const { rig, plan } = await promoting();

      const exchange = await rig.call("iris_env_promote", promoteArgs(plan));

      expect(exchange.asks).toEqual([]);
      expect(exchange.result.isError).toBeUndefined();
      expect(exchange.result.structuredContent).toMatchObject({
        source: { profile: "default", namespace: "HSCUSTOM" },
        target: { profile: "other", namespace: "HSCUSTOM" },
        executed: [PROMOTE_STEP],
        summary: { completed: 1, failed: 0, skipped: 0 },
      });
      expect(rig.writes()).toEqual([]);
      expect(rig.otherWrites()).toEqual([PROMOTE_PUT, PROMOTE_COMPILE]);
      const entries = await rig.entries(2);
      expect(entries.at(-1)).toMatchObject({ tool: "iris_env_promote", action: "execute", outcome: "ok" });
      expect(Object.prototype.hasOwnProperty.call(entries.at(-1), "confirmation")).toBe(false);
    },
    60_000,
  );

  it(
    "accept: one form request with the template and the form, the target gets the same two writes once, the result equals the no-capability result, one entry says accepted",
    async () => {
      const { rig, plan } = await promoting(FORM);
      rig.answer(TICKED);

      const exchange = await rig.call("iris_env_promote", promoteArgs(plan));

      expect(exchange.asks).toHaveLength(1);
      expect(exchange.asks[0]).toMatchObject({ mode: "form", message: promotionMessage(rig.port) });
      expect(exchange.asks[0]?.requestedSchema).toStrictEqual(SCHEMA);
      expect(exchange.result.isError).toBeUndefined();
      expect(exchange.result.structuredContent).toMatchObject({
        source: { profile: "default", namespace: "HSCUSTOM" },
        target: { profile: "other", namespace: "HSCUSTOM" },
        executed: [PROMOTE_STEP],
        summary: { completed: 1, failed: 0, skipped: 0 },
      });
      expect(rig.writes()).toEqual([]);
      expect(rig.otherWrites()).toEqual([PROMOTE_PUT, PROMOTE_COMPILE]);
      const entries = await rig.entries(2);
      expect(entries).toHaveLength(2);
      expect(entries.at(-1)).toMatchObject({ tool: "iris_env_promote", action: "execute", outcome: "ok", confirmation: "accepted" });
    },
    60_000,
  );

  it.each([
    ["decline", { action: "decline" } as ElicitationAnswer, "decline", "declined", "The person declined the confirmation for"],
    ["cancel", { action: "cancel" } as ElicitationAnswer, "cancel", "cancelled", "The person dismissed the confirmation dialog for"],
    ["an accept without the tick", UNTICKED, "unconfirmed", "unconfirmed", "The person accepted the confirmation dialog for"],
  ])(
    "%s: CONFIRMATION_DECLINED, neither server is written, asked once, one denied entry",
    async (_label, answer, response, recorded, lead) => {
      const { rig, plan } = await promoting(FORM);
      rig.answer(answer);

      const exchange = await rig.call("iris_env_promote", promoteArgs(plan));

      expect(exchange.asks).toHaveLength(1);
      expect(exchange.result.isError).toBe(true);
      expect(exchange.result.structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: "execute", response });
      expect(exchange.result.content?.[0]?.text).toContain(`${lead}: promote changes to another server`);
      expect(rig.writes()).toEqual([]);
      expect(rig.otherWrites()).toEqual([]);
      const entries = await rig.entries(2);
      expect(entries.at(-1)).toMatchObject({
        tool: "iris_env_promote",
        action: "execute",
        outcome: "denied",
        denyReason: "CONFIRMATION_DECLINED",
        confirmation: recorded,
      });
    },
    60_000,
  );

  it(
    "a call that Gate 1 refuses (no confirm) asks nothing and writes nothing",
    async () => {
      const { rig, plan } = await promoting(FORM);

      const exchange = await rig.call("iris_env_promote", promoteArgs(plan, { confirm: undefined }));

      expect(exchange.asks).toEqual([]);
      expect(exchange.result.isError).toBe(true);
      expect(exchange.result.content?.[0]?.text).toContain("Gate 1 (confirm)");
      expect(rig.writes()).toEqual([]);
      expect(rig.otherWrites()).toEqual([]);
      const entries = await rig.entries(2);
      expect(entries.at(-1)).toMatchObject({ tool: "iris_env_promote", action: "execute", outcome: "error" });
      expect(Object.prototype.hasOwnProperty.call(entries.at(-1), "confirmation")).toBe(false);
    },
    60_000,
  );
});
