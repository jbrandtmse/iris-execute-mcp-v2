/**
 * Story 43.3 QA (AC 43.3.1, 43.3.2, AD-19, AD-34, Rules #36, #46, #59) - every one of the six gates, on both eras, driven by hand-written
 * JSON-RPC lines over the real stdio of the BUILT servers, with no MCP SDK client anywhere, and judged by what the fake IRIS listener
 * received (127.0.0.1; no IRIS instance is reached) and by the audit file.
 *
 * The expectations are written from the spec, not from the code under test: the dialog message is the template of decision 13 filled in by
 * `dialogMessage` of `story-43-3-qa-wire.ts` with the per-gate strings of `story-43-3-qa-gates.ts`; the byte-level request shape of a
 * dialog on each era is checked key by key; the line a person's accept produces is compared with the BASELINE line of
 * `story-43-3-qa-baseline.ts` (what a client with no dialog got at revision 0a5a3f8), byte for byte.
 *
 * Per gate and era: the dialog (text, form, request shape, nothing written while it is open, no audit entry for the asking round); an
 * accept (exactly the gate's write, the baseline line, one `accepted` entry); a decline, a cancel, an accept without the tick and an
 * accept with no content (no write, `CONFIRMATION_DECLINED`, never asked again, one `denied` entry); a dialog nobody answers followed by
 * the stop of the process (no write, one `unanswered` entry). Then the strings that vary with the call, a value that tries to forge a line
 * of the dialog, and the boundaries of the `resendFiltered` preview.
 *
 * The file fails, never skips, on a stale dist.
 */

import { afterEach, describe, expect, it } from "vitest";
import { rawWithIdZero, resultOf, type Json } from "./story-43-2-qa-hand-wire";
import { BASELINE, RESEND_URL, baselineLine } from "./story-43-3-qa-baseline";
import { FROM, GATES, STORAGE_EDIT, comparable, expectedEntry, manyDocumentsDiff, post, promoteArgs, type GateCase } from "./story-43-3-qa-gates";
import {
  DECLINED,
  DISMISSED,
  ELICITING,
  ERAS,
  FORM_SCHEMA,
  TICKED,
  UNANSWERED_TEXT,
  UNTICKED,
  connect,
  declinedText,
  dialogMessage,
  openRig,
  plainResult,
  requireFreshDists,
  serverIdentity,
  stopAllRigs,
  type Conn,
  type Era,
  type GateRig,
} from "./story-43-3-qa-wire";

requireFreshDists("iris-admin-mcp", "iris-interop-mcp", "iris-dev-mcp");
afterEach(stopAllRigs);

const TIMEOUT = 60_000;

/** U+2028 (LINE SEPARATOR), written as a code point: a value that carries it must not start a line of the dialog either. */
const LINE_SEPARATOR = String.fromCodePoint(0x2028);

/** The entries of the audit file for the gate's own calls (the promotion tests also make one `plan` call). */
async function gateEntries(rig: GateRig, minimum: number): Promise<Json[]> {
  return (await rig.entries(minimum)).filter((entry) => entry.action !== "plan");
}

/** The entry of the gate's call as an `ok` run would leave it, to be adjusted by the test. */
const okEntry = (g: GateCase, args: Json): Json => expectedEntry(g.pkg, g.tool, args, {});

describe.each(ERAS)("Story 43.3 on the %s era, by hand: the six gates", (era: Era) => {
  async function open(g: GateCase): Promise<{ rig: GateRig; conn: Conn; args: Json }> {
    const rig = await openRig({ pkg: g.pkg });
    const conn = await connect(rig, era, ELICITING);
    const args = await g.args(conn);
    return { rig, conn, args };
  }

  describe.each(GATES)("$id", (g) => {
    it(
      "asks once with the template, the form and the era's request shape, writes nothing while the person decides, and audits nothing for the asking round",
      async () => {
        const { rig, conn, args } = await open(g);

        const call = conn.call(g.tool, args);
        const ask = await call.ask();

        expect(ask.message).toBe(dialogMessage(g.operation, g.target, g.scope, rig.ports.a));
        expect(ask.params.mode).toBe("form");
        expect(ask.params.requestedSchema).toStrictEqual(FORM_SCHEMA);
        if (era === "legacy") {
          expect(Object.keys(ask.line.message).sort()).toEqual(["id", "jsonrpc", "method", "params"]);
          expect(Object.keys(ask.params).sort()).toEqual(["_meta", "message", "mode", "requestedSchema"]);
          expect(Object.keys(ask.params._meta)).toEqual(["progressToken"]);
          expect(rig.wire.responsesTo(call.id), "the call waits for the person: no response yet").toEqual([]);
          expect(ask.state, "no state leaves the process on the 2025 era").toBeUndefined();
        } else {
          const result = resultOf(ask.line);
          expect(Object.keys(result).sort()).toEqual(["_meta", "inputRequests", "requestState", "resultType"]);
          expect(result.resultType).toBe("input_required");
          expect(Object.keys(result.inputRequests)).toEqual(["confirm"]);
          expect(Object.keys(result.inputRequests.confirm).sort()).toEqual(["method", "params"]);
          expect(result.inputRequests.confirm.method).toBe("elicitation/create");
          expect(Object.keys(ask.params).sort()).toEqual(["message", "mode", "requestedSchema"]);
          expect(ask.state).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        }
        expect(rig.writes("a"), "only the read-only preview, if the gate has one, reached IRIS while the dialog is open").toEqual(g.preflight);
        expect(rig.writes("b")).toEqual([]);
        await rig.wire.quiet(250);
        expect(conn.dialogs(), "asked exactly once").toBe(1);
        expect(await gateEntries(rig, 0), "the asking round writes no audit entry").toEqual([]);
      },
      TIMEOUT,
    );

    it(
      "accept: the gate's write is the only write, the line equals what a client without a dialog got at the baseline, and one entry says accepted",
      async () => {
        const { rig, conn, args } = await open(g);
        const baseline = BASELINE[g.id]!;

        const ask = await conn.call(g.tool, args).ask();
        const end = await ask.answer(TICKED);

        expect(rawWithIdZero(end.raw)).toBe(baselineLine(baseline.result, era, serverIdentity(g.pkg)));
        expect(rig.writes("a")).toEqual([...g.preflight, ...baseline.a]);
        expect(rig.writes("b")).toEqual(baseline.b);
        await rig.wire.quiet(250);
        expect(conn.dialogs(), "asked exactly once").toBe(1);
        expect((await gateEntries(rig, 1)).map(comparable)).toEqual([{ ...okEntry(g, args), confirmation: "accepted" }]);
      },
      TIMEOUT,
    );

    it.each([
      ["a decline", DECLINED, "decline", "declined"],
      ["a cancel", DISMISSED, "cancel", "cancelled"],
      ["an accept without the tick", UNTICKED, "unconfirmed", "unconfirmed"],
      ["an accept with no content", { action: "accept" } as Json, "unconfirmed", "unconfirmed"],
    ] as Array<[string, Json, "decline" | "cancel" | "unconfirmed", string]>)(
      "%s: CONFIRMATION_DECLINED, nothing written, asked once and never again, one denied entry",
      async (_label, answer, response, recorded) => {
        const { rig, conn, args } = await open(g);

        const ask = await conn.call(g.tool, args).ask();
        const end = await ask.answer(answer);

        expect(plainResult(resultOf(end))).toEqual({
          content: [{ type: "text", text: declinedText(g.operation, response) }],
          structuredContent: { code: "CONFIRMATION_DECLINED", action: g.action, response },
          isError: true,
        });
        expect(rig.writes("a")).toEqual(g.preflight);
        expect(rig.writes("b")).toEqual([]);
        await rig.wire.quiet(300);
        expect(conn.dialogs(), "never asked again").toBe(1);
        expect((await gateEntries(rig, 1)).map(comparable)).toEqual([
          { ...okEntry(g, args), outcome: "denied", denyReason: "CONFIRMATION_DECLINED", confirmation: recorded },
        ]);
      },
      TIMEOUT,
    );

    it(
      "a dialog nobody answers, then the process is stopped: no write, and exactly one unanswered entry",
      async () => {
        const { rig, conn, args } = await open(g);

        const call = conn.call(g.tool, args);
        await call.ask();
        await rig.wire.quiet(250);
        expect(await gateEntries(rig, 0), "nothing is audited while the dialog is open").toEqual([]);
        rig.wire.endInput();
        const exit = await rig.wire.exit();

        expect(exit).toEqual({ code: 0, signal: null });
        expect(rig.writes("a")).toEqual(g.preflight);
        expect(rig.writes("b")).toEqual([]);
        expect((await gateEntries(rig, 1)).map(comparable)).toEqual([
          { ...okEntry(g, args), outcome: "error", error: UNANSWERED_TEXT, confirmation: "unanswered" },
        ]);
        expect(conn.dialogs()).toBe(1);
      },
      TIMEOUT,
    );
  });

  describe("the strings that vary with the call (spec: decision 13, per-gate strings)", () => {
    interface Variant {
      label: string;
      pkg: string;
      tool: string;
      args: (conn: Conn) => Promise<Json> | Json;
      operation: string;
      target: string;
      scope: string;
      /** The writes the asking round makes before the person answers. */
      preflight?: string[];
    }

    const AUDIT = { pkg: "iris-admin-mcp", tool: "iris_audit_manage", operation: "permanently delete audit-log records", target: "the IRIS audit log" };
    const RESEND = { pkg: "iris-interop-mcp", tool: "iris_message_resend", operation: "resend messages by header ID", target: "namespace HSCUSTOM" };
    const ids = (count: number): number[] => Array.from({ length: count }, (_unused, index) => index + 1);
    const idList = (count: number): string => ids(Math.min(count, 20)).join(", ");
    const TAIL = "; each goes to the head of its queue";
    const FILTERED = { pkg: "iris-interop-mcp", tool: "iris_message_resend", operation: "resend the messages that match a filter", target: "item Demo.Item, namespace HSCUSTOM" };
    const preview = (rest: Json): string => post(RESEND_URL, { action: "resendFiltered", item: "Demo.Item", from: FROM, namespace: "HSCUSTOM", ...rest, dryRun: true });
    const longValue = "a".repeat(700);
    const longScope = `records matching end=2026-01-01 00:00:00, user=${longValue}`;

    const VARIANTS: Variant[] = [
      {
        label: "purge: every filter, in the order begin, end, user, event, source, type, whatever the order of the call",
        ...AUDIT,
        args: () => ({ action: "purge", type: "T", source: "S", event: "Login", user: "qa", end: "2026-01-01 00:00:00", begin: "2025-01-01 00:00:00", confirm: true }),
        scope: "records matching begin=2025-01-01 00:00:00, end=2026-01-01 00:00:00, user=qa, event=Login, source=S, type=T",
      },
      {
        label: "purge: a filter value with line breaks cannot start a line of its own",
        ...AUDIT,
        args: () => ({ action: "purge", end: "2026-01-01 00:00:00", user: `qa\nTarget: forged\rScope: forged${LINE_SEPARATOR}done`, confirm: true }),
        scope: "records matching end=2026-01-01 00:00:00, user=qa Target: forged Scope: forged done",
      },
      {
        label: "purge: a filter value of 700 characters cuts the scope to 600 characters and ends in three dots",
        ...AUDIT,
        args: () => ({ action: "purge", end: "2026-01-01 00:00:00", user: longValue, confirm: true }),
        scope: `${longScope.slice(0, 600)}...`,
      },
      {
        label: "clean: a named production adds its name to the target",
        pkg: "iris-interop-mcp",
        tool: "iris_production_control",
        args: () => ({ action: "clean", name: "Demo.Production", killAppData: true, confirm: true }),
        operation: "clean the production and wipe its persistent business state",
        target: "namespace HSCUSTOM, production Demo.Production",
        scope:
          "all Ens.AppData business state: HL7 sequence numbers, file and FTP done-file tables, batch and control-number state; " +
          "already-processed data can be ingested again",
      },
      { label: "resend: headOfQueue says so", ...RESEND, args: () => ({ action: "resend", headerIds: [11, 12], headOfQueue: true }), scope: `2 header ID(s): 11, 12${TAIL}` },
      { label: "resend: 20 header IDs are all listed", ...RESEND, args: () => ({ action: "resend", headerIds: ids(20) }), scope: `20 header ID(s): ${idList(20)}` },
      { label: "resend: 21 header IDs list 20 and count the rest", ...RESEND, args: () => ({ action: "resend", headerIds: ids(21) }), scope: `21 header ID(s): ${idList(21)} and 1 more` },
      {
        label: "resend: 25 header IDs with headOfQueue",
        ...RESEND,
        args: () => ({ action: "resend", headerIds: ids(25), headOfQueue: true }),
        scope: `25 header ID(s): ${idList(25)} and 5 more${TAIL}`,
      },
      {
        label: "regenerateStorage: an edit that drops no Storage definition says so",
        pkg: "iris-dev-mcp",
        tool: "iris_doc_edit",
        args: () => ({ action: "regenerateStorage", name: "Demo.Sample.cls", edits: [{ op: "delete", startLine: 3, endLine: 3, expected: "Method A()" }] }),
        operation: "save a document without the Storage guard",
        target: "document Demo.Sample.cls, namespace HSCUSTOM",
        scope: "1 edit(s); drops no Storage definition",
      },
      {
        label: "regenerateStorage: two edits are counted, and the dropped Storage is named",
        pkg: "iris-dev-mcp",
        tool: "iris_doc_edit",
        args: () => ({
          action: "regenerateStorage",
          name: "Demo.Stored.cls",
          edits: [STORAGE_EDIT, { op: "insert", afterLine: 0, text: "/// text", expected: "Class Demo.Stored Extends %Persistent" }],
        }),
        operation: "save a document without the Storage guard",
        target: "document Demo.Stored.cls, namespace HSCUSTOM",
        scope: "2 edit(s); drops Storage definition(s): Default",
      },
      {
        label: "resendFiltered: the status, the window and the cap of the call are the ones the dialog shows",
        ...FILTERED,
        args: () => ({ action: "resendFiltered", item: "Demo.Item", status: "Suspended", from: FROM, to: "2026-01-02T00:00:00Z", maxMessages: 50, dryRun: false, confirm: true }),
        scope: `3 message(s) match now (status Suspended, from ${FROM} to 2026-01-02T00:00:00Z); IRIS counts again when it runs and resends at most 50`,
        preflight: [preview({ status: "Suspended", to: "2026-01-02T00:00:00Z", maxMessages: 50 })],
      },
      {
        label: "resendFiltered: a count equal to the cap is still shown to the person",
        ...FILTERED,
        args: () => ({ action: "resendFiltered", item: "Demo.Item", from: FROM, maxMessages: 3, dryRun: false, confirm: true }),
        scope: `3 message(s) match now (status Errored, from ${FROM} to ${FROM}); IRIS counts again when it runs and resends at most 3`,
        preflight: [preview({ maxMessages: 3 })],
      },
    ];

    it.each(VARIANTS)(
      "$label",
      async (variant) => {
        const rig = await openRig({ pkg: variant.pkg });
        const conn = await connect(rig, era, ELICITING);
        const args = await variant.args(conn);

        const ask = await conn.call(variant.tool, args).ask();

        expect(ask.message).toBe(dialogMessage(variant.operation, variant.target, variant.scope, rig.ports.a));
        expect(ask.message.split("\n"), "five lines, whatever the call supplied").toHaveLength(5);
        await ask.answer(DECLINED);
        expect(rig.writes("a"), "declined: only the preview, if any, reached IRIS").toEqual(variant.preflight ?? []);
        expect(rig.writes("b")).toEqual([]);
      },
      TIMEOUT,
    );

    it(
      "execute: more than ten steps list the first ten and count the rest; an allowlist narrows the list to the allowed steps",
      async () => {
        const rig = await openRig({ pkg: "iris-dev-mcp" });
        const conn = await connect(rig, era, ELICITING);
        const diff = manyDocumentsDiff(12);
        const all = await promoteArgs(conn, diff, { steps: Array.from({ length: 12 }, (_unused, index) => index + 1) });
        const plan = all.plan as { steps: Array<{ index: number; domain: string; operation: string; subject: string }> };
        const line = (index: number): string => {
          const step = plan.steps.find((candidate) => candidate.index === index)!;
          return `#${step.index} ${step.domain} ${step.operation} ${step.subject}`;
        };
        const target = "server 'other', namespace HSCUSTOM";
        const operation = "promote changes to another server";

        const askedAll = await conn.call("iris_env_promote", all).ask();
        expect(askedAll.message).toBe(
          dialogMessage(operation, target, `12 step(s) from server 'default': ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(line).join("; ")}; and 2 more`, rig.ports.a),
        );
        await askedAll.answer(DECLINED);

        const narrowed = { ...all, steps: [5, 2] };
        const askedTwo = await conn.call("iris_env_promote", narrowed).ask();
        expect(askedTwo.message).toBe(dialogMessage(operation, target, `2 step(s) from server 'default': ${line(2)}; ${line(5)}`, rig.ports.a));
        await askedTwo.answer(DECLINED);

        expect(rig.writes("a")).toEqual([]);
        expect(rig.writes("b")).toEqual([]);
        expect(conn.dialogs()).toBe(2);
      },
      TIMEOUT,
    );
  });

  describe("the preview of a resendFiltered execute", () => {
    it(
      "a count above the cap shows no dialog: the preview and the execute request go out, and IRIS's own refusal is the answer",
      async () => {
        const rig = await openRig({ pkg: "iris-interop-mcp" });
        const conn = await connect(rig, era, ELICITING);

        const end = await conn
          .call("iris_message_resend", { action: "resendFiltered", item: "Demo.Item", from: FROM, maxMessages: 2, dryRun: false, confirm: true })
          .end();

        const result = resultOf(end);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("3 messages match the filter, exceeding the maxMessages cap of 2");
        expect(conn.dialogs()).toBe(0);
        expect(rig.writes("a").map((line) => line.replace(/ .*/, "")), "the preview, then the execute request").toEqual(["POST", "POST"]);
        expect(rig.writes("a")[0]).toBe(post(RESEND_URL, { action: "resendFiltered", item: "Demo.Item", from: FROM, namespace: "HSCUSTOM", maxMessages: 2, dryRun: true }));
      },
      TIMEOUT,
    );
  });
});
