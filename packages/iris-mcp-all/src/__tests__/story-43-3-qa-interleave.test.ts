/**
 * Story 43.3 QA (AC 43.3.2, 43.3.4, AD-19, AD-34; Rules #36, #59) - what several dialogs and several kinds of client do to each other, over
 * the real stdio of the BUILT servers with hand-written JSON-RPC lines and no SDK client (the fake IRIS listener on 127.0.0.1 is the
 * oracle; no IRIS instance is reached).
 *
 *  - **Two gated calls in flight on one connection, answered out of order.** Each call gets its own answer: the accepted one writes, the
 *    declined one does not, and each ends as one entry. A dialog answered with the state or the answer of the other call decides nothing.
 *  - **A client that fails the form request** (the 2025 era: a JSON-RPC error instead of a result, a malformed result) writes nothing.
 *  - **Which declarations of a client ask.** `{elicitation: {}}`, `{form: {}}`, `{form: {}, url: {}}` and form among other capabilities ask;
 *    no capabilities, `{url: {}}` alone and unrelated capabilities do not, and get the baseline line.
 * The file fails, never skips, on a stale dist.
 */

import { afterEach, describe, expect, it } from "vitest";
import { rawWithIdZero, resultOf, type Json } from "./story-43-2-qa-hand-wire";
import { BASELINE, baselineLine } from "./story-43-3-qa-baseline";
import {
  DECLINED,
  ELICITING,
  ERAS,
  TICKED,
  UNANSWERED_TEXT,
  connect,
  dialogMessage,
  openRig,
  plainResult,
  requireFreshDists,
  serverIdentity,
  stopAllRigs,
  type Era,
} from "./story-43-3-qa-wire";

requireFreshDists("iris-admin-mcp", "iris-interop-mcp");
afterEach(stopAllRigs);

const TIMEOUT = 60_000;
const RESEND: Json = { action: "resend", headerIds: [11, 12] };
const CLEAN: Json = { action: "clean", killAppData: true, confirm: true };
const PURGE: Json = { action: "purge", end: "2026-01-01 00:00:00", confirm: true };
const RESEND_PATH = "/api/executemcp/v2/interop/message/resend";
const CONTROL_PATH = "/api/executemcp/v2/interop/production/control";
const resendWrites = (writes: string[]): string[] => writes.filter((line) => line.includes(RESEND_PATH));
const cleanWrites = (writes: string[]): string[] => writes.filter((line) => line.includes(CONTROL_PATH));

describe.each(ERAS)("two gated calls in flight on one connection, on the %s era", (era: Era) => {
  it(
    "answered out of order, each call gets its own answer: the accepted resend writes, the declined clean does not, and each ends as one entry",
    async () => {
      const rig = await openRig({ pkg: "iris-interop-mcp" });
      const conn = await connect(rig, era, ELICITING);
      const resend = conn.call("iris_message_resend", RESEND);
      const clean = conn.call("iris_production_control", CLEAN);

      const askedClean = await clean.ask((message) => message.includes("clean the production"));
      const askedResend = await resend.ask((message) => message.includes("resend messages by header ID"));
      expect(askedResend.message).toBe(dialogMessage("resend messages by header ID", "namespace HSCUSTOM", "2 header ID(s): 11, 12", rig.ports.a));
      expect(askedClean.message).toContain("Confirm: clean the production and wipe its persistent business state.");
      expect(rig.writes("a"), "two dialogs are open and nothing is written").toEqual([]);
      const accepted = askedResend.send(TICKED);
      const declined = askedClean.send(DECLINED);

      const [resendEnd, cleanEnd] = await Promise.all([accepted.response, declined.response]);

      expect(plainResult(resultOf(resendEnd)).isError).toBeUndefined();
      expect(plainResult(resultOf(cleanEnd)).structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: "clean", response: "decline" });
      expect(resendWrites(rig.writes("a"))).toHaveLength(1);
      expect(cleanWrites(rig.writes("a"))).toEqual([]);
      expect(conn.dialogs()).toBe(2);
      const entries = (await rig.entries(2)).map((entry) => `${entry.tool}:${entry.outcome}:${entry.confirmation}`).sort();
      expect(entries).toEqual(["iris_message_resend:ok:accepted", "iris_production_control:denied:declined"]);
    },
    TIMEOUT,
  );

  it(
    "each call's own answer, given in the other order: the declined resend does not write, the accepted clean does",
    async () => {
      const rig = await openRig({ pkg: "iris-interop-mcp" });
      const conn = await connect(rig, era, ELICITING);
      const resend = conn.call("iris_message_resend", RESEND);
      const clean = conn.call("iris_production_control", CLEAN);
      const askedResend = await resend.ask((message) => message.includes("resend messages by header ID"));
      const askedClean = await clean.ask((message) => message.includes("clean the production"));

      const declined = askedResend.send(DECLINED);
      const accepted = askedClean.send(TICKED);
      const [resendEnd, cleanEnd] = await Promise.all([declined.response, accepted.response]);

      expect(plainResult(resultOf(resendEnd)).structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: "resend", response: "decline" });
      expect(plainResult(resultOf(cleanEnd)).isError).toBeUndefined();
      expect(resendWrites(rig.writes("a"))).toEqual([]);
      expect(cleanWrites(rig.writes("a"))).toHaveLength(1);
    },
    TIMEOUT,
  );
});

describe("the 2025 era: a client that fails the form request", () => {
  const FAILURES: Array<[string, (id: number) => Json]> = [
    ["a JSON-RPC error instead of a result", (id) => ({ error: { code: -32601, message: "Method not found" }, jsonrpc: "2.0", id })],
    ["a result that is not an object", (id) => ({ result: "accept", jsonrpc: "2.0", id })],
    ["a result with an action the protocol does not define", (id) => ({ result: { action: "approve", content: { confirm: true } }, jsonrpc: "2.0", id })],
    ["an empty result", (id) => ({ result: {}, jsonrpc: "2.0", id })],
  ];

  it.each(FAILURES)(
    "%s: nothing is written, the connection carries on, and the call ends as one entry",
    async (_label, failure) => {
      const rig = await openRig({ pkg: "iris-admin-mcp" });
      const conn = await connect(rig, "legacy", ELICITING);
      const call = conn.call("iris_audit_manage", PURGE);
      call.end().catch(() => undefined);
      const ask = await call.ask();

      rig.wire.sendRaw(JSON.stringify(failure(ask.line.message.id)));
      await rig.wire.quiet(800);

      expect(rig.writes("a")).toEqual([]);
      const next = await conn.call("iris_audit_manage", { action: "purge", end: "2026-01-01 00:00:00" }).end();
      expect(plainResult(resultOf(next)).isError, "the next call is served").toBe(true);
      rig.wire.endInput();
      await rig.wire.exit();
      const entries = await rig.entries(2);
      expect(entries.map((entry) => `${entry.outcome}:${entry.confirmation ?? ""}`).sort(), "the refused follow-up call and the failed dialog, one entry each").toEqual([
        "error:",
        "error:unanswered",
      ]);
      expect(entries.find((entry) => entry.confirmation === "unanswered")?.error).toBe(UNANSWERED_TEXT);
      const answers = rig.wire.responsesTo(call.id);
      expect(answers.length, "the call is answered at most once").toBeLessThanOrEqual(1);
      for (const answer of answers) expect(plainResult(resultOf(answer)).isError, "and then with an error").toBe(true);
      expect(rig.writes("a")).toEqual([]);
    },
    TIMEOUT,
  );
});

describe.each(ERAS)("which declarations of a client ask the person, on the %s era", (era: Era) => {
  const ASKS: Array<[string, Json]> = [
    ["elicitation: {} (a declaration with no mode)", { elicitation: {} }],
    ["elicitation: {form: {}}", { elicitation: { form: {} } }],
    ["elicitation: {form: {}, url: {}}", { elicitation: { form: {}, url: {} } }],
    ["form among other capabilities", { sampling: {}, roots: { listChanged: true }, elicitation: { form: {} } }],
  ];
  const SILENT: Array<[string, Json]> = [
    ["no capabilities", {}],
    ["elicitation: {url: {}} alone", { elicitation: { url: {} } }],
    ["only unrelated capabilities", { sampling: {}, roots: { listChanged: true } }],
  ];

  it.each(ASKS)(
    "%s: asks once, and a decline writes nothing",
    async (_label, capabilities) => {
      const rig = await openRig({ pkg: "iris-admin-mcp" });
      const conn = await connect(rig, era, capabilities);

      const ask = await conn.call("iris_audit_manage", PURGE).ask();
      await ask.answer(DECLINED);

      expect(conn.dialogs()).toBe(1);
      expect(rig.writes("a")).toEqual([]);
    },
    TIMEOUT,
  );

  it.each(SILENT)(
    "%s: no dialog, and the call gets the baseline line",
    async (_label, capabilities) => {
      const rig = await openRig({ pkg: "iris-admin-mcp" });
      const conn = await connect(rig, era, capabilities);

      const end = await conn.call("iris_audit_manage", PURGE).end();

      expect(rawWithIdZero(end.raw)).toBe(baselineLine(BASELINE["admin: purge ok"]!.result, era, serverIdentity("iris-admin-mcp")));
      expect(conn.dialogs()).toBe(0);
      expect(rig.writes("a")).toEqual(BASELINE["admin: purge ok"]!.a);
    },
    TIMEOUT,
  );
});
