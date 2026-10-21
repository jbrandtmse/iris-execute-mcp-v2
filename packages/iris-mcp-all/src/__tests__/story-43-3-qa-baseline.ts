/**
 * Story 43.3 QA (AD-15, Rules #19 and #36) - what the BUILT servers answered a client with NO elicitation capability at baseline revision
 * 0a5a3f8 (the last commit before Story 43.3), for the calls of the six confirmation gates and for the calls that an existing check refuses
 * first. Data only; `story-43-3-qa-fallback.test.ts` and `story-43-3-qa-hand-gates.test.ts` compare the 43.3 build with it.
 *
 * Capture (Rule #36), 2026-10-20, Node 26:
 *   1. `git worktree add --detach <OS temp>/qa43-3-baseline 0a5a3f8`, `pnpm install --offline --frozen-lockfile --ignore-scripts`, then
 *      `pnpm --filter <shared|admin|interop|dev> build` there (the worktree was removed afterwards).
 *   2. A scratch driver wrote hand JSON-RPC lines to each built server over stdio (`initialize`, or `server/discover` with an envelope that
 *      declares `clientCapabilities: {}`), against the local fake listener of `scripts/lib/fake-iris-listener.mjs` (127.0.0.1; no IRIS
 *      instance), with auditing on: 120 calls in 14 sessions, once per era, and with the gated writes enabled or not.
 *   3. The same driver ran against the 43.3 dists. The raw response lines, the requests each listener received, the audit entries, stderr
 *      (apart from request timings) and the exit codes were equal, call for call.
 *
 * A row holds the `result` member of the response line as the server wrote it, with its member order. The 2025-11-25 line is
 * `{"result":<result>,"jsonrpc":"2.0","id":<n>}`; the 2026-07-28 line has `"resultType":"complete"` and the server identity in `_meta`
 * appended to the result (checked against all 60 captured pairs). `a` and `b` are the write requests (POST, PUT or DELETE, apart from the
 * startup query) that listener A (the `default` profile) and listener B (the profile `other`) received for the call.
 */

export interface BaselineRow {
  result: Record<string, unknown>;
  a: string[];
  b: string[];
}

const text = (content: string, rest: Record<string, unknown> = {}): Record<string, unknown> => ({ content: [{ type: "text", text: content }], ...rest });
const post = (url: string, body: unknown): string => `POST ${url} ${JSON.stringify(body)}`;
const put = (url: string, body: unknown): string => `PUT ${url} ${JSON.stringify(body)}`;
const row = (result: Record<string, unknown>, a: string[] = [], b: string[] = []): BaselineRow => ({ result, a, b });

export const AUDIT_URL = "/api/executemcp/v2/security/audit";
export const CONTROL_URL = "/api/executemcp/v2/interop/production/control";
export const RESEND_URL = "/api/executemcp/v2/interop/message/resend";

const FROM = "2026-01-01T00:00:00Z";
/** U+2014, which the purge bound refusal contains (a code point, never a literal character: Rule 14). */
const EM_DASH = String.fromCodePoint(0x2014);
const NO_CHANGES = "No changes were made.";

const PURGE_OK = text('{\n  "action": "purge",\n  "deleted": 3,\n  "success": 1\n}', { structuredContent: { action: "purge", deleted: 3, success: 1 } });
const PURGE_CONFIRM = text("Error: 'purge' is destructive and requires confirm:true to proceed.", { isError: true });

const CLEAN_TRUE = text('{\n  "action": "cleaned",\n  "killAppData": true\n}', { structuredContent: { action: "cleaned", killAppData: true } });
const CLEAN_REFUSAL = text(
  "Error controlling production: IRIS returned HTTP 400 for POST /api/executemcp/v2/interop/production/control. " +
    "Check the request parameters and try again. Details: ERROR #5001: killAppData wipes the persistent Ens.AppData business state " +
    "(HL7 sequence numbers, file/FTP done-file tables, batch/control-number state) and can cause duplicate re-ingestion of " +
    "already-processed data; it requires confirm:true. No changes were made.",
  { isError: true },
);

const PREVIEW = text("DRY RUN: 3 message(s) match the filter (showing up to 0); resent NOTHING. Pass dryRun:false and confirm:true to execute.", {
  structuredContent: { action: "resendFiltered", dryRun: true, matchCount: 3, sample: [], item: "Demo.Item", status: "Errored", from: FROM, to: FROM, maxMessages: 100 },
});
const FILTERED_PREFIX =
  "Error performing 'resendFiltered' on iris_message_resend: IRIS returned HTTP 400 for POST /api/executemcp/v2/interop/message/resend. " +
  "Check the request parameters and try again. Details: ERROR #5001: ";
const filtered = (item: string, rest: Record<string, unknown>): string => post(RESEND_URL, { action: "resendFiltered", item, from: FROM, namespace: "HSCUSTOM", ...rest });
const FILTERED_RESULT = (matched: number): Record<string, unknown> =>
  text(`resendFiltered: ${matched} matched, ${matched}/${matched} succeeded, 0 failed`, {
    structuredContent: { action: "resendFiltered", dryRun: false, matchCount: matched, results: [], summary: { total: matched, succeeded: matched, failed: 0 } },
  });
const RESEND_RESULT = text("Resend: 2/2 succeeded, 0 failed", { structuredContent: { results: [], summary: { total: 2, succeeded: 2, failed: 0 } } });

const REGEN_LINES = [
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
const SAMPLE_LINES = ["Class Demo.Sample Extends %RegisteredObject", "{", "Method A()", "{", "}", "}"];
const numbered = (lines: string[], first = 1): string => lines.map((line, index) => `     ${index + first}\t${line}`).join("\n");
const SAVED_NOTHING = (name: string, count: number): string =>
  `Document '${name}' was saved in namespace 'HSCUSTOM', but IRIS stored the text it already had, so nothing changed; it has ${count} lines ` +
  "(ts 2026-01-01 00:00:00.000). IRIS reformats class source when it saves, so the edit has no effect.";

const PLAN_HASH = "84635666607df6e9c6b197b98bf9e65c337461daa7bf9c6d9aa53556f712f95d";
const PROMOTE_STEP = "Demo.Sample.cls";

/** The calls that ran with the gated writes enabled, keyed by `<server>: <call>`. */
export const BASELINE: Record<string, BaselineRow> = {
  "admin: purge ok": row(PURGE_OK, [post(AUDIT_URL, { action: "purge", confirm: true, end: "2026-01-01 00:00:00" })]),
  "admin: purge no confirm": row(PURGE_CONFIRM),
  "admin: purge confirm false": row(PURGE_CONFIRM),
  "admin: purge no bound": row(
    text(`Error: 'purge' requires a bounded scope ${EM_DASH} supply at least one of begin, end, or a non-wildcard user, event, source, or type.`, { isError: true }),
  ),
  "admin: purge many filters": row(PURGE_OK, [
    post(AUDIT_URL, { action: "purge", confirm: true, begin: "2025-01-01 00:00:00", end: "2026-01-01 00:00:00", user: "qa", event: "Login", source: "S", type: "T" }),
  ]),

  "interop: clean ok": row(CLEAN_TRUE, [post(CONTROL_URL, { action: "clean", namespace: "HSCUSTOM", killAppData: true, confirm: true })]),
  "interop: clean no confirm": row(CLEAN_REFUSAL, [post(CONTROL_URL, { action: "clean", namespace: "HSCUSTOM", killAppData: true })]),
  "interop: clean confirm false": row(CLEAN_REFUSAL, [post(CONTROL_URL, { action: "clean", namespace: "HSCUSTOM", killAppData: true, confirm: false })]),
  "interop: clean without killAppData": row(
    text('{\n  "action": "cleaned",\n  "killAppData": false\n}', { structuredContent: { action: "cleaned", killAppData: false } }),
    [post(CONTROL_URL, { action: "clean", namespace: "HSCUSTOM" })],
  ),
  "interop: clean named production": row(CLEAN_TRUE, [
    post(CONTROL_URL, { action: "clean", namespace: "HSCUSTOM", name: "Demo.Production", killAppData: true, confirm: true }),
  ]),
  "interop: resendFiltered ok": row(FILTERED_RESULT(3), [filtered("Demo.Item", { dryRun: false, confirm: true })]),
  "interop: resendFiltered preview (dryRun omitted)": row(PREVIEW, [filtered("Demo.Item", { confirm: true })]),
  "interop: resendFiltered dryRun true": row(PREVIEW, [filtered("Demo.Item", { dryRun: true })]),
  "interop: resendFiltered dryRun false no confirm": row(
    text(
      `${FILTERED_PREFIX}resendFiltered execution requires dryRun:false and confirm:true; by default dryRun is true and only previews matching messages ` +
        `without resending. ${NO_CHANGES}`,
      { isError: true },
    ),
    [filtered("Demo.Item", { dryRun: false })],
  ),
  "interop: resendFiltered over cap": row(
    text(
      `${FILTERED_PREFIX}600 messages match the filter, exceeding the maxMessages cap of 100; narrow the time window or item filter and retry. ${NO_CHANGES}`,
      { isError: true },
    ),
    [filtered("Demo.Many", { dryRun: false, confirm: true })],
  ),
  "interop: resendFiltered zero": row(FILTERED_RESULT(0), [filtered("Demo.Zero", { dryRun: false, confirm: true })]),
  "interop: resend ok": row(RESEND_RESULT, [post(RESEND_URL, { action: "resend", headerIds: [11, 12], namespace: "HSCUSTOM" })]),
  "interop: resend head of queue": row(RESEND_RESULT, [post(RESEND_URL, { action: "resend", headerIds: [11, 12], namespace: "HSCUSTOM", headOfQueue: true })]),
  "interop: resend no ids": row(text("'headerIds' is required for action 'resend' (1-100 numeric header IDs).", { isError: true })),

  "dev: regenerateStorage ok": row(
    text(`${SAVED_NOTHING("Demo.Stored.cls", 9)}\n\nEdit 1 (delete lines 4-8), now lines 1-9:\n${numbered(REGEN_LINES)}`, {
      structuredContent: {
        name: "Demo.Stored.cls",
        namespace: "HSCUSTOM",
        ts: "2026-01-01 00:00:00.000",
        totalLines: 9,
        changed: false,
        unifiedDiff: "",
        excerpts: [{ edit: 1, op: "delete", startLine: 1, endLine: 9, lines: REGEN_LINES }],
      },
    }),
    [put("/api/atelier/v8/HSCUSTOM/doc/Demo.Stored.cls", { enc: false, content: ["Class Demo.Stored Extends %Persistent", "{", "Property A As %String;", "}"] })],
  ),
  "dev: regenerateStorage stale": row(
    text(
      "Document 'Demo.Stored.cls' was not changed in namespace 'HSCUSTOM': the expected text of edit 1 does not match the document now. " +
        "Nothing was stored. Retry with the current text below as expected, or read the lines again with iris_doc_get." +
        `\n\nEdit 1 (delete lines 4-8), current text:\n${numbered(REGEN_LINES.slice(3, 8), 4)}`,
      {
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
    ),
  ),
  "dev: regenerateStorage no storage dropped": row(
    text(`${SAVED_NOTHING("Demo.Sample.cls", 6)}\n\nEdit 1 (delete lines 3-3), now lines 1-6:\n${numbered(SAMPLE_LINES)}`, {
      structuredContent: {
        name: "Demo.Sample.cls",
        namespace: "HSCUSTOM",
        ts: "2026-01-01 00:00:00.000",
        totalLines: 6,
        changed: false,
        unifiedDiff: "",
        excerpts: [{ edit: 1, op: "delete", startLine: 1, endLine: 6, lines: SAMPLE_LINES }],
      },
    }),
    [put("/api/atelier/v8/HSCUSTOM/doc/Demo.Sample.cls", { enc: false, content: ["Class Demo.Sample Extends %RegisteredObject", "{", "{", "}", "}"] })],
  ),
  "dev: execute": row(
    text(
      "Promotion execute: source='default' (HSCUSTOM) -> target='other' (HSCUSTOM)\n" +
        `Plan hash: ${PLAN_HASH}\n\nExecuted steps (1):\n  1. [documents] putAndCompile ${PROMOTE_STEP} -- COMPLETED\n\n` +
        "Summary: 1 completed, 0 failed, 0 skipped. No item that exists only on the target was ever removed.",
      {
        structuredContent: {
          source: { profile: "default", namespace: "HSCUSTOM" },
          target: { profile: "other", namespace: "HSCUSTOM" },
          planHash: PLAN_HASH,
          executed: [{ index: 1, domain: "documents", operation: "putAndCompile", subject: PROMOTE_STEP, status: "completed" }],
          summary: { completed: 1, failed: 0, skipped: 0 },
        },
      },
    ),
    [],
    [
      put("/api/atelier/v8/HSCUSTOM/doc/Demo.Sample.cls?ignoreConflict=1", { enc: false, content: SAMPLE_LINES }),
      'POST /api/atelier/v8/HSCUSTOM/action/compile?flags=cuk ["Demo.Sample.cls"]',
    ],
  ),
  "dev: execute no confirm": row(text(`Gate 1 (confirm): 'confirm' must be true to execute. ${NO_CHANGES}`, { isError: true })),
  "dev: execute step out of range": row(
    text(`Gate 2 (steps allowlist): 'steps' contains index/indices not present in 'plan.steps': 7. ${NO_CHANGES}`, { isError: true }),
  ),
  "dev: execute stale plan": row(
    text(
      "Gate 3 (plan-hash freshness): stale plan -- regenerate the plan from the current diff ('diff' no longer matches 'plan.planHash'). " + NO_CHANGES,
      { isError: true },
    ),
  ),
  "dev: execute profile mismatch": row(
    text(
      "Gate 3 (diff/profile match): 'diff' was generated for source 'default', but 'source' is 'other'. " +
        `Regenerate the diff/plan for the intended source. ${NO_CHANGES}`,
      { isError: true },
    ),
  ),
  "dev-gate4: execute": row(
    text(
      "Gate 4 (target-profile governance): target profile 'other' governance disables iris_doc_compile -- execution refused. " + NO_CHANGES,
      { isError: true },
    ),
  ),
};

/** `GOVERNANCE_DISABLED` for a gate called with the write not enabled, keyed by `<server>: <call>`. */
const denied = (action: string): Record<string, unknown> =>
  text(`action '${action}' is disabled by governance policy for server 'default'`, {
    structuredContent: { code: "GOVERNANCE_DISABLED", action, server: "default" },
    isError: true,
  });

export const BASELINE_DENIED: Record<string, Record<string, unknown>> = {
  "admin: purge ok": denied("iris_audit_manage:purge"),
  "interop: resendFiltered ok": denied("iris_message_resend:resendFiltered"),
  "interop: resend ok": denied("iris_message_resend:resend"),
  "dev: regenerateStorage ok": denied("iris_doc_edit:regenerateStorage"),
  "dev: execute": denied("iris_env_promote:execute"),
};

/** The response line of a no-capability call on `era`, with the id `id`. */
export function baselineLine(result: Record<string, unknown>, era: "legacy" | "modern", server: { name: string; version: string }, id = 0): string {
  const complete =
    era === "legacy"
      ? result
      : { ...result, resultType: "complete", _meta: { "io.modelcontextprotocol/serverInfo": { name: server.name, version: server.version } } };
  return JSON.stringify({ result: complete, jsonrpc: "2.0", id });
}
