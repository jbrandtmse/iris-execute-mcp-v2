/**
 * Story 43.3 QA (DW-642, AD-19, decision 14 / task 6b, Rules #36, #59) - cancellation and the audit trail of the confirmation, over the
 * real stdio of the BUILT servers with hand-written JSON-RPC lines (no SDK client) and a holding proxy between the server and the fake
 * IRIS listener (127.0.0.1; no IRIS instance is reached).
 *
 *  - **Cancelled while the write is held.** The person accepts, the write request is held in the proxy, the client sends
 *    `notifications/cancelled`: the server closes the held connection (so the request never completes), sends no answer, audits the call
 *    `error` with the fixed cancelled text and `confirmation: "accepted"`, logs no failure, and the connection and the gates are intact.
 *    A control without the cancel completes the write.
 *  - **Cancelled while the preview of a `resendFiltered` is held.** The preview's connection is closed, and the execute request is never
 *    sent: a cancel does not fall through into the write.
 *  - **Cancelled before the request is sent.** The call and its cancel arrive in ONE write after a warm-up call: nothing reaches the
 *    listener (not even the CSRF preflight), no answer goes out, one `error` entry with the cancelled text. A client that could be asked
 *    gets no dialog for a call it already cancelled, and that call too is one `error` entry with the cancelled text, written at once.
 *  - **Cancelled while the dialog is open (2025 era), then answered anyway.** The late accept writes nothing; the call ends as one
 *    `unanswered` entry.
 *  - **One entry per logical call, and no argument values.** accept, decline, cancel, an unticked accept and an unanswered dialog on
 *    each era: exactly five entries, none for an asking round, and with the default audit setting no argument value, state or nonce in
 *    the audit file or in stderr. With `IRIS_AUDIT_LOG_PARAMS` the state and the nonce are still absent.
 * The file fails, never skips, on a stale dist.
 */

import { afterEach, describe, expect, it } from "vitest";
import { holdingProxy, resultOf, type HoldingProxy, type Json } from "./story-43-2-qa-hand-wire";
import { post } from "./story-43-3-qa-gates";
import {
  CANCELLED_TEXT,
  DECLINED,
  DISMISSED,
  ELICITING,
  ERAS,
  TICKED,
  UNANSWERED_TEXT,
  UNTICKED,
  connect,
  openRig,
  plainResult,
  requireFreshDists,
  stopAllRigs,
  type Era,
  type GateRig,
} from "./story-43-3-qa-wire";

requireFreshDists("iris-admin-mcp", "iris-interop-mcp");
afterEach(stopAllRigs);

const TIMEOUT = 60_000;
const TOOL = "iris_audit_manage";
const PURGE: Json = { action: "purge", end: "2026-01-01 00:00:00", confirm: true };
const PURGE_PATH = "/api/executemcp/v2/security/audit";
const RESEND_PATH = "/api/executemcp/v2/interop/message/resend";
const FILTERED: Json = { action: "resendFiltered", item: "Demo.Item", from: "2026-01-01T00:00:00Z", dryRun: false, confirm: true };

/** A proxy that holds each POST that `match` accepts until released, and counts the held connections that closed first. */
const holder = (match: (url: string, body: string) => boolean): HoldingProxy =>
  holdingProxy((method, url, body) => method === "POST" && match(url, body));

async function until(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const cancel = (rig: GateRig, requestId: number): void => rig.wire.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId, reason: "story-43-3 qa" } });

const toolEntries = async (rig: GateRig, minimum: number): Promise<Json[]> => (await rig.entries(minimum)).filter((entry) => entry.tool === TOOL || entry.tool === "iris_message_resend");

describe.each(ERAS)("DW-642 on the %s era: what a cancel does to a gated call", (era: Era) => {
  it(
    "a purge the person accepted, held in IRIS and then cancelled: the held connection closes, nothing is answered, one error entry, and the server carries on",
    async () => {
      const proxy = holder((url) => url.includes(PURGE_PATH));
      const rig = await openRig({ pkg: "iris-admin-mcp", interpose: proxy.interpose });
      const conn = await connect(rig, era, ELICITING);
      const ask = await conn.call(TOOL, PURGE).ask();

      const accepted = ask.send(TICKED);
      accepted.response.catch(() => undefined);
      await until(() => proxy.held() === 1, "the write to be held");
      expect(proxy.closedBeforeRelease(), "the connection is open while the write is held").toBe(0);
      cancel(rig, accepted.id);
      await until(() => proxy.closedBeforeRelease() === 1, "the server to close the held connection");
      proxy.release();
      await rig.wire.quiet(400);

      expect(rig.wire.responsesTo(accepted.id), "no answer goes out for a cancelled call").toEqual([]);
      expect(rig.writes("a"), "the held write never reached the listener behind the proxy").toEqual([]);
      const entries = await toolEntries(rig, 1);
      expect(entries).toHaveLength(1);
      // The intended shape: the call was cancelled (`error`, the cancelled text), and the person had accepted.
      expect(entries[0]).toMatchObject({ outcome: "error", error: CANCELLED_TEXT, confirmation: "accepted" });
      expect(rig.wire.stderr(), "a cancelled call is not logged as a failed one").not.toContain("[ERROR]");

      const next = await conn.call(TOOL, { action: "purge", end: "2026-01-01 00:00:00" }).end();
      expect(plainResult(resultOf(next)).content[0].text, "the gates are intact after the cancel").toBe("Error: 'purge' is destructive and requires confirm:true to proceed.");

      rig.wire.endInput();
      await rig.wire.exit();
      expect((await toolEntries(rig, 2)).map((entry) => entry.outcome).sort(), "no later entry for the cancelled call").toEqual(["error", "error"]);
    },
    TIMEOUT,
  );

  it(
    "control: the same accepted purge, not cancelled, completes once the held write is released, and is audited ok",
    async () => {
      const proxy = holder((url) => url.includes(PURGE_PATH));
      const rig = await openRig({ pkg: "iris-admin-mcp", interpose: proxy.interpose });
      const conn = await connect(rig, era, ELICITING);
      const ask = await conn.call(TOOL, PURGE).ask();

      const accepted = ask.send(TICKED);
      await until(() => proxy.held() === 1, "the write to be held");
      await rig.wire.quiet(300);
      expect(rig.wire.responsesTo(accepted.id), "the call waits for IRIS").toEqual([]);
      proxy.release();
      const end = await accepted.response;

      expect(plainResult(resultOf(end)).isError).toBeUndefined();
      expect(proxy.closedBeforeRelease()).toBe(0);
      expect(rig.writes("a")).toEqual([post(PURGE_PATH, { action: "purge", confirm: true, end: "2026-01-01 00:00:00" })]);
      expect(await toolEntries(rig, 1)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    "a resendFiltered cancelled while its preview is held: the preview's connection closes, no dialog is sent, and the execute request is never sent",
    async () => {
      const proxy = holder((url, body) => url.includes(RESEND_PATH) && body.includes('"dryRun":true'));
      const rig = await openRig({ pkg: "iris-interop-mcp", interpose: proxy.interpose });
      const conn = await connect(rig, era, ELICITING);

      const call = conn.call("iris_message_resend", FILTERED);
      call.end().catch(() => undefined);
      await until(() => proxy.held() === 1, "the preview to be held");
      cancel(rig, call.id);
      await until(() => proxy.closedBeforeRelease() === 1, "the server to close the held preview");
      proxy.release();
      await rig.wire.quiet(500);

      expect(conn.dialogs(), "no dialog for a cancelled call").toBe(0);
      expect(rig.wire.responsesTo(call.id)).toEqual([]);
      expect(proxy.seen().filter((line) => line.includes(RESEND_PATH)), "only the preview was ever sent").toHaveLength(1);
      expect(rig.writes("a")).toEqual([]);
      const entries = await toolEntries(rig, 1);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ outcome: "error", error: CANCELLED_TEXT });
    },
    TIMEOUT,
  );

  it(
    "a call cancelled in the same write that carries it reaches the listener not at all, is not answered, and is audited error with the cancelled text",
    async () => {
      const rig = await openRig({ pkg: "iris-admin-mcp" });
      const conn = await connect(rig, era, {});
      const warm = await conn.call(TOOL, PURGE).end();
      expect(plainResult(resultOf(warm)).isError).toBeUndefined();
      const before = rig.requests("a");

      const id = conn.nextId();
      conn.sendBurst([conn.frameOf(id, TOOL, PURGE), { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id } }]);
      await rig.wire.quiet(700);

      expect(rig.requests("a"), "nothing reached the listener: no CSRF preflight, no write").toEqual(before);
      expect(rig.wire.responsesTo(id)).toEqual([]);
      const entries = await toolEntries(rig, 2);
      expect(entries.map((entry) => entry.outcome)).toEqual(["ok", "error"]);
      expect(entries[1]).toMatchObject({ error: CANCELLED_TEXT });
      const next = await conn.call(TOOL, PURGE).end();
      expect(plainResult(resultOf(next)).isError, "the next call is served").toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    "a client that could be asked gets no dialog for a call it cancelled in the same write, and nothing is written",
    async () => {
      const rig = await openRig({ pkg: "iris-admin-mcp" });
      const conn = await connect(rig, era, ELICITING);
      const id = conn.nextId();

      conn.sendBurst([conn.frameOf(id, TOOL, PURGE), { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id } }]);
      await rig.wire.quiet(700);

      expect(conn.dialogs()).toBe(0);
      expect(rig.wire.responsesTo(id)).toEqual([]);
      expect(rig.writes("a")).toEqual([]);
      // The call is audited as the cancelled call it is, at once, not later as a dialog nobody answered.
      const entries = await toolEntries(rig, 1);
      expect(entries, "one logical call, one entry, written before the connection ends").toHaveLength(1);
      expect(entries[0]).toMatchObject({ outcome: "error", error: CANCELLED_TEXT });
      expect(entries[0], "no dialog was shown, so no answer is recorded").not.toHaveProperty("confirmation");
      rig.wire.endInput();
      await rig.wire.exit();
      expect(await toolEntries(rig, 1), "no unanswered entry follows when the connection ends").toHaveLength(1);
      expect(rig.writes("a")).toEqual([]);
    },
    TIMEOUT,
  );
});

describe("the 2025 era: a call cancelled while its dialog is open", () => {
  it(
    "an accept that arrives afterwards writes nothing and is not answered; the call ends as one unanswered entry; the connection carries on",
    async () => {
      const rig = await openRig({ pkg: "iris-admin-mcp" });
      const conn = await connect(rig, "legacy", ELICITING);
      const call = conn.call(TOOL, PURGE);
      const ask = await call.ask();

      cancel(rig, call.id);
      await rig.wire.quiet(300);
      const late = ask.send(TICKED);
      late.response.catch(() => undefined);
      await rig.wire.quiet(700);

      expect(rig.writes("a")).toEqual([]);
      expect(rig.wire.responsesTo(call.id)).toEqual([]);
      const next = await conn.call(TOOL, { action: "purge", end: "2026-01-01 00:00:00" }).end();
      expect(plainResult(resultOf(next)).isError, "the connection carries on").toBe(true);
      rig.wire.endInput();
      await rig.wire.exit();
      const entries = await toolEntries(rig, 2);
      expect(entries.map((entry) => `${entry.outcome}:${entry.confirmation ?? ""}`).sort()).toEqual(["error:", "error:unanswered"]);
      expect(entries.find((entry) => entry.confirmation === "unanswered")?.error).toBe(UNANSWERED_TEXT);
      expect(rig.writes("a")).toEqual([]);
    },
    TIMEOUT,
  );
});

describe.each(ERAS)("AD-19 on the %s era: one entry per logical call, and no argument values", (era: Era) => {
  const CANARY_END = "2031-02-03 04:05:06";
  const CANARY_USER = "canary-user-9f3a";
  const CANARY: Json = { action: "purge", end: CANARY_END, user: CANARY_USER, confirm: true };

  async function fiveCalls(params: boolean): Promise<{ rig: GateRig; secrets: string[]; entries: Json[] }> {
    const rig = await openRig({ pkg: "iris-admin-mcp", params });
    const conn = await connect(rig, era, ELICITING);
    const secrets: string[] = [];
    for (const answer of [TICKED, DECLINED, DISMISSED, UNTICKED]) {
      const ask = await conn.call(TOOL, CANARY).ask();
      if (ask.state !== undefined) {
        secrets.push(ask.state);
        secrets.push(JSON.parse(Buffer.from(ask.state.split(".")[1]!, "base64url").toString("utf8")).p.nonce);
      }
      await ask.answer(answer);
    }
    const open = await conn.call(TOOL, CANARY).ask();
    if (open.state !== undefined) secrets.push(open.state);
    await rig.wire.quiet(300);
    rig.wire.endInput();
    await rig.wire.exit();
    return { rig, secrets, entries: await toolEntries(rig, 5) };
  }

  it(
    "accept, decline, cancel, an unticked accept and an unanswered dialog leave exactly five entries, none for an asking round",
    async () => {
      const { rig, entries } = await fiveCalls(false);

      expect(entries.map((entry) => `${entry.outcome}:${entry.confirmation}`)).toEqual([
        "ok:accepted",
        "denied:declined",
        "denied:cancelled",
        "denied:unconfirmed",
        "error:unanswered",
      ]);
      expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
      expect(rig.writes("a"), "only the accepted call wrote").toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    "with the default audit setting no argument value, state, nonce or answer is in the audit file or in stderr",
    async () => {
      const { rig, secrets, entries } = await fiveCalls(false);
      const audit = rig.auditText();
      const stderr = rig.wire.stderr();

      expect(entries.every((entry) => entry.params === undefined)).toBe(true);
      for (const secret of [CANARY_END, CANARY_USER, "2031-02-03", "inputResponses", "requestState", ...secrets]) {
        expect(audit.includes(secret), `the audit file holds ${secret.slice(0, 24)}`).toBe(false);
        expect(stderr.includes(secret), `stderr holds ${secret.slice(0, 24)}`).toBe(false);
      }
      if (era === "modern") expect(secrets.length, "the states and nonces were collected").toBeGreaterThan(8);
    },
    TIMEOUT,
  );

  it(
    "with IRIS_AUDIT_LOG_PARAMS the call's own arguments are logged as for any entry, but never the state or the nonce",
    async () => {
      const { rig, secrets, entries } = await fiveCalls(true);
      const audit = rig.auditText();

      expect(entries).toHaveLength(5);
      expect(entries.every((entry) => entry.params?.user === CANARY_USER)).toBe(true);
      for (const secret of secrets) expect(audit.includes(secret)).toBe(false);
      expect(audit.includes("inputResponses")).toBe(false);
      expect(audit.includes("requestState")).toBe(false);
    },
    TIMEOUT,
  );
});
