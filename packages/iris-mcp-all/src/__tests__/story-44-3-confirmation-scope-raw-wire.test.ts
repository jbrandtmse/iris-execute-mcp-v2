/**
 * Story 44.3 (AC 44.3.2, AC 44.3.4; AD-34, AD-19; Rules #46, #54, #59) - the scope digest of a confirmation state, on 2026-07-28 with
 * hand-written JSON-RPC lines and no SDK client. The state leaves the server only on this era (on 2025-11-25 the SDK's shim keeps it
 * on the server), so the rows that echo, replay, forge or strip a state can be driven only here. The BUILT dev and interop servers
 * run against the fake IRIS listeners of `scripts/lib/fake-iris-listener.mjs` (127.0.0.1; no IRIS instance), and a test changes a
 * listener between two rounds with `setDocumentContent`.
 *
 * Rows:
 *  - the decoded state payload is `v: 2` with the call's tool and hash, a `digest` and `reasks: 0`;
 *  - a state minted before a change of the target, echoed with an accept, is asked again with a new state (`reasks: 1`, another nonce, the
 *    digest of the new scope) and the new scope in the message, and the target is not written;
 *  - that re-asked state, echoed again with an accept after a second change, ends the call with `CONFIRMATION_SCOPE_CHANGED` and one
 *    `denied` entry; nothing is written;
 *  - the old state, replayed after the re-ask, is not honored: it is asked again from `reasks: 0`;
 *  - a changed scope whose retry no longer declares form elicitation is refused, never run;
 *  - a retry with no answer carries the count of re-asks forward, so the next change after it is refused;
 *  - a decline on the re-asked state ends the call with `CONFIRMATION_DECLINED` and writes nothing, and a decline of a `resendFiltered`
 *    sends no second preview;
 *  - a state signed with a guessed key is never honored, whatever shape its payload has (`v: 1` included; the HMAC is checked before the
 *    shape, so the shape check itself is pinned by `confirmation.test.ts`).
 * The file fails, never skips, on a stale dist.
 */

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resultOf, type Json } from "./story-43-2-qa-hand-wire";
import { FROM, PROMOTE_DIFF, promoteArgs } from "./story-43-3-qa-gates";
import { DECLINED, ELICITING, TICKED, connect, dialogMessage, openRig, plainResult, requireFreshDists, stopAllRigs, type Conn, type GateRig } from "./story-43-3-qa-wire";

requireFreshDists("iris-dev-mcp", "iris-interop-mcp");

afterEach(stopAllRigs);

const TIMEOUT = 60_000;
const TOOL = "iris_env_promote";
const NAME = "Demo.Sample.cls";

/** The promoted class with a Storage definition called `name`: the target copy once it has gained one. */
const withStorage = (name: string): string[] => [
  "Class Demo.Sample Extends %RegisteredObject",
  "{",
  "Method A()",
  "{",
  "}",
  `Storage ${name}`,
  "{",
  "<Type>%Storage.Persistent</Type>",
  "}",
  "}",
];

const ACCEPT = { confirm: TICKED };
const kindOf = (line: { message: Json }): string => line.message?.result?.resultType ?? (line.message?.error ? "error" : "?");
const PUT_OF_TARGET = (rig: GateRig): string[] => rig.writes("b");

/** The payload of a `requestState`: `v1.<base64url body>.<signature>`, the body being `{p: <state>, exp}`. */
function stateOf(requestState: string): Json {
  const [, body] = requestState.split(".");
  return JSON.parse(Buffer.from(body!, "base64url").toString("utf8")).p;
}

/** A state signed by whoever holds `key`: the recipe is `v1.<base64url body>.<base64url HMAC-SHA256 of "v1." + body>`. */
function signedState(payload: Json, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `v1.${body}.${createHmac("sha256", key).update(`v1.${body}`).digest("base64url")}`;
}

/** The dialog message of the promotion; `drops` is the text after `drops Storage definitions: `, when there is any. */
const promotionMessage = (rig: GateRig, drops?: string): string =>
  dialogMessage(
    "promote changes to another server",
    "server 'other', namespace HSCUSTOM",
    `1 step(s) from server 'default': #1 documents putAndCompile ${NAME}${drops === undefined ? "" : `; drops Storage definitions: ${drops}`}`,
    rig.ports.a,
  );

/** A modern connection to a fresh dev process, the `execute` arguments of a real plan, and the first round: the asked promotion. */
async function asked(): Promise<{ rig: GateRig; conn: Conn; args: Json; first: { state: string; message: string } }> {
  const rig = await openRig({ pkg: "iris-dev-mcp" });
  const conn = await connect(rig, "modern", ELICITING);
  const args = await promoteArgs(conn, PROMOTE_DIFF, { allowStorageRegeneration: true });
  const ask = await conn.call(TOOL, args).ask();
  return { rig, conn, args, first: { state: ask.state!, message: ask.message } };
}

/** The answer of a retry: the accept (or `answer`) and the echoed state. */
const retry = (state: string, answer: Json = TICKED): Json => ({ inputResponses: { confirm: answer }, requestState: state });

describe("the state of a confirmation carries the digest of the scope the dialog showed", () => {
  it(
    "the decoded payload is v 2 with the tool, the hash, a SHA-256 digest and no re-asks",
    async () => {
      const { first } = await asked();

      const state = stateOf(first.state);

      expect(Object.keys(state).sort()).toEqual(["digest", "hash", "nonce", "reasks", "tool", "v"]);
      expect(state).toMatchObject({ v: 2, tool: TOOL, reasks: 0 });
      expect(state.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(state.hash).toMatch(/^[0-9a-f]{64}$/);
    },
    TIMEOUT,
  );

  it(
    "a state minted before a change, echoed with an accept, is asked again with the new scope, a new state and nonce, and nothing is written",
    async () => {
      const { rig, conn, args, first } = await asked();
      rig.setDocumentContent("b", NAME, withStorage("Default"));

      const again = await conn.callWith(TOOL, args, retry(first.state));

      expect(kindOf(again)).toBe("input_required");
      const result = resultOf(again);
      expect(result.inputRequests.confirm.params.message).toBe(promotionMessage(rig, "Demo.Sample.cls ('Default')"));
      const before = stateOf(first.state);
      const after = stateOf(result.requestState);
      expect(after).toMatchObject({ v: 2, tool: TOOL, hash: before.hash, reasks: 1 });
      expect(after.digest).not.toBe(before.digest);
      expect(after.nonce).not.toBe(before.nonce);
      expect(PUT_OF_TARGET(rig)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "an unchanged scope is not asked again: the accept runs the call once",
    async () => {
      const { rig, conn, args, first } = await asked();

      const decided = await conn.callWith(TOOL, args, retry(first.state));

      expect(kindOf(decided)).toBe("complete");
      expect(resultOf(decided).isError).toBeUndefined();
      expect(PUT_OF_TARGET(rig)).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    "the re-asked state, echoed with an accept after a second change, ends the call with CONFIRMATION_SCOPE_CHANGED, one denied entry and no write",
    async () => {
      const { rig, conn, args, first } = await asked();
      rig.setDocumentContent("b", NAME, withStorage("Default"));
      const second = resultOf(await conn.callWith(TOOL, args, retry(first.state)));
      rig.setDocumentContent("b", NAME, withStorage("Alt"));

      const refused = await conn.callWith(TOOL, args, retry(second.requestState));

      expect(kindOf(refused)).toBe("complete");
      const result = plainResult(resultOf(refused));
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ code: "CONFIRMATION_SCOPE_CHANGED", action: "execute" });
      expect(PUT_OF_TARGET(rig)).toEqual([]);
      const entries = await rig.entries(2);
      expect(entries).toHaveLength(2);
      expect(entries.at(-1)).toMatchObject({ tool: TOOL, action: "execute", outcome: "denied", denyReason: "CONFIRMATION_SCOPE_CHANGED", confirmation: "accepted" });
    },
    TIMEOUT,
  );

  it(
    "the old state, replayed after the re-ask, is not honored: it is asked again from no re-asks, and nothing is written",
    async () => {
      const { rig, conn, args, first } = await asked();
      rig.setDocumentContent("b", NAME, withStorage("Default"));
      await conn.callWith(TOOL, args, retry(first.state));

      const replayed = await conn.callWith(TOOL, args, retry(first.state));

      expect(kindOf(replayed)).toBe("input_required");
      expect(stateOf(resultOf(replayed).requestState)).toMatchObject({ v: 2, reasks: 0 });
      expect(resultOf(replayed).requestState).not.toBe(first.state);
      expect(PUT_OF_TARGET(rig)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "a changed scope whose retry no longer declares form elicitation is refused, never run",
    async () => {
      const { rig, conn, args, first } = await asked();
      rig.setDocumentContent("b", NAME, withStorage("Default"));

      const refused = await conn.callWith(TOOL, args, retry(first.state), {});

      expect(kindOf(refused)).toBe("complete");
      const result = plainResult(resultOf(refused));
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ code: "CONFIRMATION_SCOPE_CHANGED", action: "execute" });
      expect(PUT_OF_TARGET(rig)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "an unchanged scope whose retry no longer declares form elicitation still decides the call, as before",
    async () => {
      const { rig, conn, args, first } = await asked();

      const decided = await conn.callWith(TOOL, args, retry(first.state), {});

      expect(kindOf(decided)).toBe("complete");
      expect(resultOf(decided).isError).toBeUndefined();
      expect(PUT_OF_TARGET(rig)).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    "a retry with no answer carries the count of re-asks forward, so the next change is refused",
    async () => {
      const { rig, conn, args, first } = await asked();
      rig.setDocumentContent("b", NAME, withStorage("Default"));
      const reasked = resultOf(await conn.callWith(TOOL, args, retry(first.state)));
      expect(stateOf(reasked.requestState).reasks).toBe(1);

      const unanswered = await conn.callWith(TOOL, args, { requestState: reasked.requestState });

      expect(kindOf(unanswered)).toBe("input_required");
      const carried = resultOf(unanswered);
      expect(stateOf(carried.requestState)).toMatchObject({ v: 2, reasks: 1 });
      rig.setDocumentContent("b", NAME, withStorage("Alt"));

      const refused = await conn.callWith(TOOL, args, retry(carried.requestState));

      expect(plainResult(resultOf(refused)).structuredContent).toEqual({ code: "CONFIRMATION_SCOPE_CHANGED", action: "execute" });
      expect(PUT_OF_TARGET(rig)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "a decline on the re-asked state ends the call with CONFIRMATION_DECLINED and writes nothing",
    async () => {
      const { rig, conn, args, first } = await asked();
      rig.setDocumentContent("b", NAME, withStorage("Default"));
      const reasked = resultOf(await conn.callWith(TOOL, args, retry(first.state)));

      const declined = await conn.callWith(TOOL, args, retry(reasked.requestState, DECLINED));

      expect(kindOf(declined)).toBe("complete");
      expect(plainResult(resultOf(declined)).structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: "execute", response: "decline" });
      expect(PUT_OF_TARGET(rig)).toEqual([]);
      const entries = await rig.entries(2);
      expect(entries.at(-1)).toMatchObject({ outcome: "denied", denyReason: "CONFIRMATION_DECLINED", confirmation: "declined" });
    },
    TIMEOUT,
  );

  it(
    "a state signed with a guessed key is never honored, whatever shape its payload has: it is asked again and nothing is written",
    async () => {
      const { rig, conn, args, first } = await asked();
      const body = JSON.parse(Buffer.from(first.state.split(".")[1]!, "base64url").toString("utf8"));
      const { digest: _digest, reasks: _reasks, ...v1 } = body.p;
      const forged = [
        signedState({ ...body, p: { ...v1, v: 1 } }, Buffer.alloc(32)),
        signedState({ ...body, p: { ...body.p, v: 1 } }, Buffer.alloc(32)),
        signedState(body, Buffer.alloc(32)),
      ];

      for (const candidate of forged) {
        const again = await conn.callWith(TOOL, args, retry(candidate));
        expect(kindOf(again)).toBe("input_required");
        expect(resultOf(again).requestState).not.toBe(candidate);
        expect(stateOf(resultOf(again).requestState)).toMatchObject({ v: 2, reasks: 0 });
      }
      expect(PUT_OF_TARGET(rig)).toEqual([]);
    },
    TIMEOUT,
  );
});

describe("a resendFiltered whose count and defaulted `to` move asks once", () => {
  const ARGS: Json = { action: "resendFiltered", item: "Demo.Item", from: FROM, dryRun: false, confirm: true };
  const previews = (rig: GateRig): string[] => rig.writes("a").filter((line) => line.includes('"dryRun":true'));

  it(
    "the state of the asked call has the same digest after the count and `to` move, so the accept runs the call; a decline sends no second preview",
    async () => {
      const rig = await openRig({ pkg: "iris-interop-mcp" });
      const conn = await connect(rig, "modern", ELICITING);
      const ask = await conn.call("iris_message_resend", ARGS).ask();
      expect(previews(rig)).toHaveLength(1);
      expect(stateOf(ask.state!)).toMatchObject({ v: 2, reasks: 0 });
      rig.setResendPreview("a", "Demo.Item", { matchCount: 4, to: "2026-01-01T00:00:05Z" });

      const declined = await conn.callWith("iris_message_resend", ARGS, retry(ask.state!, DECLINED));

      expect(plainResult(resultOf(declined)).structuredContent).toMatchObject({ code: "CONFIRMATION_DECLINED" });
      expect(previews(rig)).toHaveLength(1);

      const second = await conn.call("iris_message_resend", ARGS).ask();
      expect(second.message).toContain("4 message(s) match now");
      rig.setResendPreview("a", "Demo.Item", { matchCount: 5, to: "2026-01-01T00:00:09Z" });

      const decided = await conn.callWith("iris_message_resend", ARGS, retry(second.state!));

      expect(kindOf(decided)).toBe("complete");
      expect(resultOf(decided).isError).toBeUndefined();
      expect(rig.writes("a").filter((line) => line.includes('"dryRun":false'))).toHaveLength(1);
    },
    TIMEOUT,
  );
});
