/**
 * Story 43.3 QA (AC 43.3.2 fallback, AC 43.3.3 order, AD-15, Rules #19, #36, #59) - a client that does not ask the person gets exactly the
 * contract of baseline revision 0a5a3f8, byte for byte, and a call that an existing check refuses never shows a dialog.
 *
 * The oracle is `story-43-3-qa-baseline.ts`: the response lines, listener requests and audit shape that the baseline BUILD gave a client
 * with no elicitation capability, captured in a temporary `git worktree` of 0a5a3f8 (not from the code under test, and not through an SDK
 * client: the lines below are compared as the raw text the server wrote, so a key moved, a space added or a field appended fails).
 *
 * The BUILT admin, interop and dev servers run over stdio against the local fake IRIS listener (127.0.0.1; no IRIS instance), driven by the
 * hand driver of `story-43-2-qa-hand-wire.ts`, on the 2025-11-25 handshake and on revision 2026-07-28:
 *  - capabilities `{}` or `{elicitation: {url: {}}}`: every call of the capture, the six gates' executing calls included - no dialog, the
 *    baseline line, the baseline writes, an audit entry without `confirmation`;
 *  - capabilities `{elicitation: {form: {}}}`: every call that an existing check refuses first, and every call that needs no dialog - the
 *    SAME baseline line and writes, no dialog (the extra read-only preview of an over-cap or empty `resendFiltered` is the one addition);
 *  - governance that disables the gated write, with a client that could be asked: `GOVERNANCE_DISABLED`, no dialog.
 * Stderr must hold no log line besides the HTTP request lines on the call path. The file fails, never skips, on a stale dist.
 */

import { afterEach, describe, expect, it } from "vitest";
import { rawWithIdZero, type Json } from "./story-43-2-qa-hand-wire";
import { BASELINE, BASELINE_DENIED, RESEND_URL, baselineLine } from "./story-43-3-qa-baseline";
import { FROM, PROMOTE_DIFF, STORAGE_EDIT, comparable, expectedEntry, post } from "./story-43-3-qa-gates";
import {
  ELICITING,
  ERAS,
  connect,
  openRig,
  requireFreshDists,
  serverIdentity,
  stopAllRigs,
  type Conn,
  type Era,
  type GateRig,
} from "./story-43-3-qa-wire";

requireFreshDists("iris-admin-mcp", "iris-interop-mcp", "iris-dev-mcp");
afterEach(stopAllRigs);

const URL_ONLY: Json = { elicitation: { url: {} } };

/** A call of the capture: `gate` reaches `ctx.confirm`, `plain` is refused first or needs no dialog. */
interface Row {
  key: string;
  tool: string;
  args: (plan: Json) => Json;
  kind: "gate" | "plain";
  /** The preview an asking build sends before the execute request. */
  previewWhenAsking?: string;
}

const PURGE_BOUND = { end: "2026-01-01 00:00:00" };
const FILTERED = { item: "Demo.Item", from: FROM };
const filteredWith = (item: string, rest: Json): Json => ({ action: "resendFiltered", item, from: FROM, ...rest });
const preview = (item: string): string => post(RESEND_URL, { action: "resendFiltered", item, from: FROM, namespace: "HSCUSTOM", dryRun: true });

const executeWith = (plan: Json, extra: Json): Json => ({ action: "execute", source: "default", target: "other", diff: PROMOTE_DIFF, plan, steps: [1], confirm: true, ...extra });

const ADMIN: Row[] = [
  { key: "admin: purge ok", tool: "iris_audit_manage", kind: "gate", args: () => ({ action: "purge", ...PURGE_BOUND, confirm: true }) },
  { key: "admin: purge no confirm", tool: "iris_audit_manage", kind: "plain", args: () => ({ action: "purge", ...PURGE_BOUND }) },
  { key: "admin: purge confirm false", tool: "iris_audit_manage", kind: "plain", args: () => ({ action: "purge", ...PURGE_BOUND, confirm: false }) },
  { key: "admin: purge no bound", tool: "iris_audit_manage", kind: "plain", args: () => ({ action: "purge", confirm: true }) },
  {
    key: "admin: purge many filters",
    tool: "iris_audit_manage",
    kind: "gate",
    args: () => ({ action: "purge", begin: "2025-01-01 00:00:00", end: "2026-01-01 00:00:00", user: "qa", event: "Login", source: "S", type: "T", confirm: true }),
  },
];

const INTEROP: Row[] = [
  { key: "interop: clean ok", tool: "iris_production_control", kind: "gate", args: () => ({ action: "clean", killAppData: true, confirm: true }) },
  { key: "interop: clean no confirm", tool: "iris_production_control", kind: "plain", args: () => ({ action: "clean", killAppData: true }) },
  { key: "interop: clean confirm false", tool: "iris_production_control", kind: "plain", args: () => ({ action: "clean", killAppData: true, confirm: false }) },
  { key: "interop: clean without killAppData", tool: "iris_production_control", kind: "plain", args: () => ({ action: "clean" }) },
  {
    key: "interop: clean named production",
    tool: "iris_production_control",
    kind: "gate",
    args: () => ({ action: "clean", name: "Demo.Production", killAppData: true, confirm: true }),
  },
  { key: "interop: resendFiltered ok", tool: "iris_message_resend", kind: "gate", args: () => filteredWith("Demo.Item", { dryRun: false, confirm: true }) },
  {
    key: "interop: resendFiltered preview (dryRun omitted)",
    tool: "iris_message_resend",
    kind: "plain",
    args: () => ({ action: "resendFiltered", ...FILTERED, confirm: true }),
  },
  { key: "interop: resendFiltered dryRun true", tool: "iris_message_resend", kind: "plain", args: () => ({ action: "resendFiltered", ...FILTERED, dryRun: true }) },
  {
    key: "interop: resendFiltered dryRun false no confirm",
    tool: "iris_message_resend",
    kind: "plain",
    args: () => ({ action: "resendFiltered", ...FILTERED, dryRun: false }),
  },
  {
    key: "interop: resendFiltered over cap",
    tool: "iris_message_resend",
    kind: "plain",
    args: () => filteredWith("Demo.Many", { dryRun: false, confirm: true }),
    previewWhenAsking: preview("Demo.Many"),
  },
  {
    key: "interop: resendFiltered zero",
    tool: "iris_message_resend",
    kind: "plain",
    args: () => filteredWith("Demo.Zero", { dryRun: false, confirm: true }),
    previewWhenAsking: preview("Demo.Zero"),
  },
  { key: "interop: resend ok", tool: "iris_message_resend", kind: "gate", args: () => ({ action: "resend", headerIds: [11, 12] }) },
  { key: "interop: resend head of queue", tool: "iris_message_resend", kind: "gate", args: () => ({ action: "resend", headerIds: [11, 12], headOfQueue: true }) },
  { key: "interop: resend no ids", tool: "iris_message_resend", kind: "plain", args: () => ({ action: "resend" }) },
];

const DEV: Row[] = [
  { key: "dev: regenerateStorage ok", tool: "iris_doc_edit", kind: "gate", args: () => ({ action: "regenerateStorage", name: "Demo.Stored.cls", edits: [STORAGE_EDIT] }) },
  {
    key: "dev: regenerateStorage stale",
    tool: "iris_doc_edit",
    kind: "plain",
    args: () => ({ action: "regenerateStorage", name: "Demo.Stored.cls", edits: [{ ...STORAGE_EDIT, expected: "Storage Other" }] }),
  },
  {
    key: "dev: regenerateStorage no storage dropped",
    tool: "iris_doc_edit",
    kind: "gate",
    args: () => ({ action: "regenerateStorage", name: "Demo.Sample.cls", edits: [{ op: "delete", startLine: 3, endLine: 3, expected: "Method A()" }] }),
  },
  { key: "dev: execute", tool: "iris_env_promote", kind: "gate", args: (plan) => executeWith(plan, {}) },
  { key: "dev: execute no confirm", tool: "iris_env_promote", kind: "plain", args: (plan) => executeWith(plan, { confirm: undefined }) },
  { key: "dev: execute step out of range", tool: "iris_env_promote", kind: "plain", args: (plan) => executeWith(plan, { steps: [7] }) },
  {
    key: "dev: execute stale plan",
    tool: "iris_env_promote",
    kind: "plain",
    args: (plan) => executeWith(plan, { diff: { ...PROMOTE_DIFF, summary: { driftCount: 2, identicalCount: 0 } } }),
  },
  { key: "dev: execute profile mismatch", tool: "iris_env_promote", kind: "plain", args: (plan) => executeWith(plan, { source: "other", target: "default" }) },
];

const GATE4: Row[] = [{ key: "dev-gate4: execute", tool: "iris_env_promote", kind: "plain", args: (plan) => executeWith(plan, {}) }];

const GATE4_GOVERNANCE = JSON.stringify({ global: { "iris_env_promote:execute": true }, profiles: { other: { iris_doc_compile: false } } });

interface Session {
  name: string;
  pkg: string;
  governance?: string | null;
  rows: Row[];
}

const SESSIONS: Session[] = [
  { name: "admin", pkg: "iris-admin-mcp", rows: ADMIN },
  { name: "interop", pkg: "iris-interop-mcp", rows: INTEROP },
  { name: "dev", pkg: "iris-dev-mcp", rows: DEV },
  { name: "dev with the target's iris_doc_compile disabled (Gate 4)", pkg: "iris-dev-mcp", governance: GATE4_GOVERNANCE, rows: GATE4 },
];

/** The lines the server wrote to stderr after it began serving, which must all be HTTP request lines. */
function callPathStderr(rig: GateRig): string[] {
  const lines = rig.wire.stderr().split("\n").filter((line) => line !== "");
  const served = lines.findIndex((line) => line.startsWith("[INFO] Serving "));
  return lines.slice(served + 1);
}

/** An HTTP request line, or one of the lines that the first use of a second profile writes (also at the baseline, 0a5a3f8). */
const HTTP_LINE =
  /^\[INFO\] ((HEAD|GET|POST|PUT|DELETE) \S+ completed in \d+ms|IRIS health check passed|Detected Atelier API v\d+|Bootstrap: REST service is current .*)$/;

async function planOf(conn: Conn): Promise<Json> {
  const planned = JSON.parse((await conn.call("iris_env_promote", { action: "plan", source: "default", target: "other", diff: PROMOTE_DIFF }).end()).raw).result;
  return planned.structuredContent;
}

describe.each(ERAS)("Story 43.3 on the %s era: what a client that cannot be asked gets is the baseline", (era: Era) => {
  const identityOf = (pkg: string) => serverIdentity(pkg);

  async function exercise(session: Session, capabilities: Json, kinds: Array<"gate" | "plain">): Promise<void> {
    const rig = await openRig({ pkg: session.pkg, governance: session.governance });
    const conn = await connect(rig, era, capabilities);
    const needsPlan = session.rows.some((row) => row.key.includes("execute"));
    const plan = needsPlan ? await planOf(conn) : undefined;
    const asking = kinds.length === 1 && kinds[0] === "plain" && JSON.stringify(capabilities) === JSON.stringify(ELICITING);
    const rows = session.rows.filter((row) => kinds.includes(row.kind));
    const sent: Array<{ row: Row; args: Json }> = [];

    for (const row of rows) {
      const baseline = BASELINE[row.key]!;
      const args = row.args(plan);
      const before = { a: rig.writes("a").length, b: rig.writes("b").length };
      const line = await conn.call(row.tool, args).end();
      sent.push({ row, args });

      expect(rawWithIdZero(line.raw), row.key).toBe(baselineLine(baseline.result, era, identityOf(session.pkg)));
      const expectedA = asking && row.previewWhenAsking !== undefined ? [row.previewWhenAsking, ...baseline.a] : baseline.a;
      expect(rig.writes("a").slice(before.a), `${row.key}: the writes listener A received`).toEqual(expectedA);
      expect(rig.writes("b").slice(before.b), `${row.key}: the writes listener B received`).toEqual(baseline.b);
    }
    expect(conn.dialogs(), "no dialog was put to the client").toBe(0);

    await rig.wire.quiet(150);
    for (const line of callPathStderr(rig)) expect(line, "the call path logs nothing but HTTP request lines").toMatch(HTTP_LINE);

    const entries = (await rig.entries(sent.length + (needsPlan ? 1 : 0))).filter((entry) => entry.action !== "plan");
    expect(entries.map(comparable)).toEqual(
      sent.map(({ row, args }) => expectedEntry(session.pkg, row.tool, args, BASELINE[row.key]!.result)),
    );
    for (const entry of entries) expect(Object.prototype.hasOwnProperty.call(entry, "confirmation"), "a call that was not asked has no confirmation field").toBe(false);
  }

  describe.each(SESSIONS)("$name", (session) => {
    it.each([
      ["no capability", {} as Json],
      ["url elicitation alone", URL_ONLY],
    ])(
      "a client with %s: every call of the capture equals the baseline, the gates' executing calls included",
      async (_label, capabilities) => {
        await exercise(session, capabilities, ["gate", "plain"]);
      },
      90_000,
    );

    it(
      "a client that can show a form: the calls that an existing check refuses, and the calls that need no dialog, equal the baseline and ask nothing",
      async () => {
        await exercise(session, ELICITING, ["plain"]);
      },
      90_000,
    );
  });

  describe("governance that disables the gated write", () => {
    const DENIED: Array<[string, string, string, Json]> = [
      ["iris-admin-mcp", "admin: purge ok", "iris_audit_manage", { action: "purge", ...PURGE_BOUND, confirm: true }],
      ["iris-interop-mcp", "interop: resendFiltered ok", "iris_message_resend", filteredWith("Demo.Item", { dryRun: false, confirm: true })],
      ["iris-interop-mcp", "interop: resend ok", "iris_message_resend", { action: "resend", headerIds: [11, 12] }],
      [
        "iris-dev-mcp",
        "dev: regenerateStorage ok",
        "iris_doc_edit",
        { action: "regenerateStorage", name: "Demo.Stored.cls", edits: [STORAGE_EDIT] },
      ],
    ];

    it.each(DENIED)(
      "%s %s: GOVERNANCE_DISABLED to a client that could be asked, byte for byte as at the baseline, and no dialog",
      async (pkg, key, tool, args) => {
        const rig = await openRig({ pkg, governance: null });
        const conn = await connect(rig, era, ELICITING);

        const line = await conn.call(tool, args).end();

        expect(rawWithIdZero(line.raw)).toBe(baselineLine(BASELINE_DENIED[key]!, era, identityOf(pkg)));
        expect(conn.dialogs()).toBe(0);
        expect(rig.writes("a")).toEqual([]);
        const [entry] = await rig.entries(1);
        expect(entry).toMatchObject({ outcome: "denied", denyReason: "GOVERNANCE_DISABLED" });
        expect(Object.prototype.hasOwnProperty.call(entry, "confirmation")).toBe(false);
      },
      60_000,
    );

    it(
      "dev: a promotion execute that governance disables is refused before any dialog, as at the baseline",
      async () => {
        const rig = await openRig({ pkg: "iris-dev-mcp", governance: null });
        const conn = await connect(rig, era, ELICITING);
        const plan = await planOf(conn);

        const line = await conn.call("iris_env_promote", executeWith(plan, {})).end();

        expect(rawWithIdZero(line.raw)).toBe(baselineLine(BASELINE_DENIED["dev: execute"]!, era, identityOf("iris-dev-mcp")));
        expect(conn.dialogs()).toBe(0);
        expect(rig.writes("a")).toEqual([]);
        expect(rig.writes("b")).toEqual([]);
      },
      60_000,
    );
  });
});
