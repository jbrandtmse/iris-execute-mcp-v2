/**
 * Story 43.3 QA (AC 43.3.4 binding, AC 43.3.2 era, matrix rows Forged accept, Smuggled capability, Arguments changed, Tampered / replayed /
 * expired state; AD-34; Rules #36, #46, #59) - an attacker's view of the confirmation, over the real stdio of the BUILT servers with
 * hand-written JSON-RPC lines and no SDK client. Everything here must END without a write that the person did not authorise, and with a
 * fresh dialog where the matrix says "asked again". The oracle is the write log of the fake IRIS listener (127.0.0.1; no IRIS instance).
 *
 * Rows:
 *  - **A state from another process.** Process A mints a state; process B (modern, then legacy) is sent it with an accept. B asks again.
 *  - **A state forged with the recipe in view.** The state is signed, not encrypted: its payload is readable. A copy with a fresh nonce
 *    and expiry, re-signed with a guessed key (32 zero bytes), is not honored; nor is the original payload under another signature, nor a
 *    body whose nonce was changed under the original signature.
 *  - **Expired.** A clock preload (`--require`, a file holds the offset in milliseconds; only the server process under test loads it)
 *    moves `Date.now()` of the server: 601 seconds on is past the 600 second life of a state, 590 is not. A state past its life asks again
 *    and a state minted after the jump is honored (so the jump itself breaks nothing).
 *  - **Replayed concurrently.** Three retries with the same state in ONE write: exactly one runs.
 *  - **Changed arguments.** A valid state with an accept or a decline for other arguments decides nothing; the new arguments are asked.
 *  - **Another tool or action.** A state minted for one call in a server is not honored for another call of that server.
 *  - **Odd answers and garbage states.** Whatever the retry carries, only an accept with `confirm: true` under a valid, unused state
 *    writes; the server answers the next request after every one of them.
 *  - **Smuggling into a plain 2025 call**, for every gate: an accept and a made-up state get a dialog (client that declared elicitation)
 *    and never a write; `_meta` that claims elicitation on a connection whose client declared none gets the baseline line, no dialog.
 * The file fails, never skips, on a stale dist.
 */

import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLIENT_CAPABILITIES_KEY, rawWithIdZero, resultOf, tempDirectory, type Json } from "./story-43-2-qa-hand-wire";
import { BASELINE, baselineLine } from "./story-43-3-qa-baseline";
import { GATES, manyDocumentsDiff, promoteArgs } from "./story-43-3-qa-gates";
import {
  DECLINED,
  ELICITING,
  ERAS,
  TICKED,
  connect,
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

const cleanups: Array<() => void> = [];
afterEach(async () => {
  await stopAllRigs();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const TIMEOUT = 60_000;
const TOOL = "iris_audit_manage";
const PURGE: Json = { action: "purge", end: "2026-01-01 00:00:00", confirm: true };
const OTHER_PURGE: Json = { ...PURGE, end: "2026-02-02 00:00:00" };
const PURGE_PATH = "/api/executemcp/v2/security/audit";
const purgesOf = (rig: GateRig): string[] => rig.writes("a").filter((line) => line.includes(PURGE_PATH));
const kindOf = (line: { message: Json }): string => line.message?.result?.resultType ?? (line.message?.error ? "error" : "?");

/** A modern connection to a fresh admin process, and its first round: the state of the asked purge. */
async function modernAsk(args: Json = PURGE, rig?: GateRig): Promise<{ rig: GateRig; conn: Conn; state: string }> {
  const opened = rig ?? (await openRig({ pkg: "iris-admin-mcp" }));
  const conn = await connect(opened, "modern", ELICITING);
  const ask = await conn.call(TOOL, args).ask();
  return { rig: opened, conn, state: ask.state! };
}

/** The `requestState` as its three parts: the prefix, the base64url body and the signature. */
function partsOf(state: string): { body: string; payload: Json } {
  const [, body] = state.split(".");
  return { body: body!, payload: JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) };
}

/** A state signed by whoever holds `key`: the recipe is `v1.<base64url body>.<base64url HMAC-SHA256 of "v1." + body>`. */
function signedState(payload: Json, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `v1.${body}.${createHmac("sha256", key).update(`v1.${body}`).digest("base64url")}`;
}

const ACCEPT_ANSWER = { confirm: TICKED };

describe("a state is bound to the process that minted it", () => {
  it(
    "process B never honors a state of process A: modern, it asks again; legacy, it sends a dialog; neither writes",
    async () => {
      const { rig: a, state } = await modernAsk();
      const b = await openRig({ pkg: "iris-admin-mcp" });
      const modern = await connect(b, "modern", ELICITING);

      const again = await modern.callWith(TOOL, PURGE, { inputResponses: ACCEPT_ANSWER, requestState: state });

      expect(kindOf(again)).toBe("input_required");
      expect(resultOf(again).requestState).not.toBe(state);
      expect(purgesOf(b)).toEqual([]);

      const legacyRig = await openRig({ pkg: "iris-admin-mcp" });
      const legacy = await connect(legacyRig, "legacy", ELICITING);
      const smuggled = legacy.callWith(TOOL, PURGE, { inputResponses: ACCEPT_ANSWER, requestState: state });
      const dialog = await legacyRig.wire.untilLine((line) => line.message?.method === "elicitation/create");
      expect(purgesOf(legacyRig), "the smuggled accept ran nothing").toEqual([]);
      legacyRig.wire.sendRaw(JSON.stringify({ result: DECLINED, jsonrpc: "2.0", id: dialog.message.id }));
      expect(plainResult(resultOf(await smuggled)).structuredContent.response).toBe("decline");
      expect(purgesOf(a), "process A, which minted the state, was not used either").toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "a state forged with the recipe in view is not honored: re-signed with a guessed key, the original payload under another signature, or a changed body under the original signature",
    async () => {
      const { rig, conn, state } = await modernAsk();
      const { payload, body } = partsOf(state);
      const signature = state.slice(state.lastIndexOf(".") + 1);
      const zeroKey = Buffer.alloc(32);
      const forged: Array<[string, string]> = [
        ["a fresh nonce and expiry, re-signed with 32 zero bytes", signedState({ p: { ...payload.p, nonce: "00000000-0000-4000-8000-000000000000" }, exp: payload.exp + 60 }, zeroKey)],
        ["the original payload, signed with 32 zero bytes", signedState(payload, zeroKey)],
        ["the original payload, signed with the key 'a'x32", signedState(payload, Buffer.from("a".repeat(32)))],
        [
          "a changed nonce under the original signature",
          `v1.${Buffer.from(JSON.stringify({ ...payload, p: { ...payload.p, nonce: "11111111-1111-4111-8111-111111111111" } }), "utf8").toString("base64url")}.${signature}`,
        ],
        ["an extended expiry under the original signature", `v1.${Buffer.from(JSON.stringify({ ...payload, exp: payload.exp + 86400 }), "utf8").toString("base64url")}.${signature}`],
        ["the original body with no signature", `v1.${body}.`],
      ];

      for (const [label, candidate] of forged) {
        const again = await conn.callWith(TOOL, PURGE, { inputResponses: ACCEPT_ANSWER, requestState: candidate });
        expect(kindOf(again), label).toBe("input_required");
        expect(resultOf(again).requestState, label).not.toBe(candidate);
      }
      expect(purgesOf(rig)).toEqual([]);

      const honest = await conn.callWith(TOOL, PURGE, { inputResponses: ACCEPT_ANSWER, requestState: state });
      expect(kindOf(honest), "control: the original state, untouched, still decides the call").toBe("complete");
      expect(purgesOf(rig)).toHaveLength(1);
    },
    TIMEOUT,
  );
});

describe("a state has a life of 600 seconds (a clock preload moves the server's Date.now)", () => {
  /** An admin process whose `Date.now()` is the real clock plus the number in a file; `setOffset` moves it. */
  async function clocked(): Promise<{ rig: GateRig; setOffset: (milliseconds: number) => Promise<void> }> {
    const scratch = tempDirectory("story-43-3-qa-clock-");
    cleanups.push(scratch.remove);
    const offsetFile = path.join(scratch.dir, "offset.txt");
    const preload = path.join(scratch.dir, "clock.cjs");
    writeFileSync(offsetFile, "0");
    writeFileSync(
      preload,
      [
        'const fs = require("node:fs");',
        "const file = process.env.QA_CLOCK_OFFSET_FILE;",
        "const real = Date.now.bind(Date);",
        "let cached = 0;",
        "let readAt = 0;",
        "Date.now = function () {",
        "  const now = real();",
        "  if (now - readAt > 1) {",
        "    readAt = now;",
        '    try { cached = Number(fs.readFileSync(file, "utf8")) || 0; } catch { cached = 0; }',
        "  }",
        "  return now + cached;",
        "};",
        "",
      ].join("\n"),
    );
    const rig = await openRig({ pkg: "iris-admin-mcp", env: { NODE_OPTIONS: `--require ${JSON.stringify(preload)}`, QA_CLOCK_OFFSET_FILE: offsetFile } });
    return {
      rig,
      setOffset: async (milliseconds) => {
        writeFileSync(offsetFile, String(milliseconds));
        await rig.wire.quiet(30);
      },
    };
  }

  it(
    "a state asked 601 seconds ago is not honored: the call asks again and writes nothing; a state minted after the jump is honored",
    async () => {
      const { rig, setOffset } = await clocked();
      const conn = await connect(rig, "modern", ELICITING);
      const first = await conn.call(TOOL, PURGE).ask();

      await setOffset(601_000);
      const again = await conn.callWith(TOOL, PURGE, { inputResponses: ACCEPT_ANSWER, requestState: first.state });

      expect(kindOf(again), "an expired state decides nothing").toBe("input_required");
      expect(purgesOf(rig)).toEqual([]);
      const second = resultOf(again).requestState as string;
      expect(second).not.toBe(first.state);
      expect(partsOf(second).payload.exp, "the new state's life starts at the server's clock").toBeGreaterThan(partsOf(first.state!).payload.exp + 590);

      const honored = await conn.callWith(TOOL, PURGE, { inputResponses: ACCEPT_ANSWER, requestState: second });
      expect(kindOf(honored), "control: a state minted under the moved clock is honored").toBe("complete");
      expect(purgesOf(rig)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    "control: a state asked 590 seconds ago is still honored",
    async () => {
      const { rig, setOffset } = await clocked();
      const conn = await connect(rig, "modern", ELICITING);
      const first = await conn.call(TOOL, PURGE).ask();

      await setOffset(590_000);
      const honored = await conn.callWith(TOOL, PURGE, { inputResponses: ACCEPT_ANSWER, requestState: first.state });

      expect(kindOf(honored)).toBe("complete");
      expect(purgesOf(rig)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    "an expired state does not carry a decline either: the call is asked again and nothing is decided",
    async () => {
      const { rig, setOffset } = await clocked();
      const conn = await connect(rig, "modern", ELICITING);
      const first = await conn.call(TOOL, PURGE).ask();

      await setOffset(700_000);
      const again = await conn.callWith(TOOL, PURGE, { inputResponses: { confirm: DECLINED }, requestState: first.state });

      expect(kindOf(again)).toBe("input_required");
      expect(purgesOf(rig)).toEqual([]);
    },
    TIMEOUT,
  );
});

describe("a state decides at most one call", () => {
  it(
    "three retries with the same state and an accept, written in ONE chunk: exactly one runs, the others are asked again",
    async () => {
      const { rig, conn, state } = await modernAsk();
      const ids = [conn.nextId(), conn.nextId(), conn.nextId()];

      conn.sendBurst(ids.map((id) => conn.frameOf(id, TOOL, PURGE, { inputResponses: ACCEPT_ANSWER, requestState: state })));
      const lines = await Promise.all(ids.map((id) => rig.wire.response(id)));

      expect(lines.map(kindOf).sort()).toEqual(["complete", "input_required", "input_required"]);
      expect(purgesOf(rig)).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    "an accept and a decline racing on one state: one decides, the other is asked again, and a write happens only if the accept won",
    async () => {
      const { rig, conn, state } = await modernAsk();
      const [accept, decline] = [conn.nextId(), conn.nextId()];

      conn.sendBurst([
        conn.frameOf(accept, TOOL, PURGE, { inputResponses: ACCEPT_ANSWER, requestState: state }),
        conn.frameOf(decline, TOOL, PURGE, { inputResponses: { confirm: DECLINED }, requestState: state }),
      ]);
      const [first, second] = await Promise.all([rig.wire.response(accept), rig.wire.response(decline)]);

      expect([kindOf(first), kindOf(second)].filter((kind) => kind === "input_required")).toHaveLength(1);
      const acceptWon = kindOf(first) === "complete";
      expect(plainResult(resultOf(acceptWon ? first : second)).isError === true, "the call that won is the accept (it ran) or the decline (refused)").toBe(!acceptWon);
      expect(purgesOf(rig)).toHaveLength(acceptWon ? 1 : 0);
    },
    TIMEOUT,
  );

  it(
    "a decline decided by a state cannot be undone by an accept of the same state afterwards",
    async () => {
      const { rig, conn, state } = await modernAsk();
      const declined = await conn.callWith(TOOL, PURGE, { inputResponses: { confirm: DECLINED }, requestState: state });
      expect(plainResult(resultOf(declined)).structuredContent.response).toBe("decline");

      const retry = await conn.callWith(TOOL, PURGE, { inputResponses: ACCEPT_ANSWER, requestState: state });

      expect(kindOf(retry)).toBe("input_required");
      expect(purgesOf(rig)).toEqual([]);
    },
    TIMEOUT,
  );
});

describe("a state is bound to the call it was minted for", () => {
  it(
    "changed arguments: a valid state with an accept, or with a decline, decides nothing; the new arguments are asked and run once; each asked dialog ends as one entry",
    async () => {
      const { rig, conn, state } = await modernAsk(PURGE);

      const accepted = await conn.callWith(TOOL, OTHER_PURGE, { inputResponses: ACCEPT_ANSWER, requestState: state });
      const declined = await conn.callWith(TOOL, OTHER_PURGE, { inputResponses: { confirm: DECLINED }, requestState: state });

      for (const line of [accepted, declined]) {
        expect(kindOf(line)).toBe("input_required");
        expect(resultOf(line).inputRequests.confirm.params.message).toBe(
          dialogMessage("permanently delete audit-log records", "the IRIS audit log", "records matching end=2026-02-02 00:00:00", rig.ports.a),
        );
      }
      expect(purgesOf(rig)).toEqual([]);

      const run = await conn.callWith(TOOL, OTHER_PURGE, { inputResponses: ACCEPT_ANSWER, requestState: resultOf(accepted).requestState });
      expect(kindOf(run)).toBe("complete");
      expect(rig.writes("a")).toEqual([`POST ${PURGE_PATH} {"action":"purge","confirm":true,"end":"2026-02-02 00:00:00"}`]);

      // Three dialogs were put: one for the first arguments and two for the new ones (after the accept and after the decline above); the
      // state of the first of those two then ran. The two that nobody answered each end as one entry when the process stops (AD-19, task 6b).
      rig.wire.endInput();
      await rig.wire.exit();
      const entries = (await rig.entries(3)).map((entry) => `${entry.outcome}:${entry.confirmation}`).sort();
      expect(entries).toEqual(["error:unanswered", "error:unanswered", "ok:accepted"]);
    },
    TIMEOUT,
  );

  it(
    "another profile: the same call with server 'other' needs its own dialog",
    async () => {
      const { rig, conn, state } = await modernAsk(PURGE);

      const other = await conn.callWith(TOOL, { ...PURGE, server: "other" }, { inputResponses: ACCEPT_ANSWER, requestState: state });

      expect(kindOf(other)).toBe("input_required");
      expect(resultOf(other).inputRequests.confirm.params.message).toContain("Server: other (127.0.0.1:");
      expect(rig.writes("a")).toEqual([]);
      expect(rig.writes("b")).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "another tool, and another action of the same tool, in one server: a state of resend decides neither clean nor resendFiltered, and the reverse",
    async () => {
      const rig = await openRig({ pkg: "iris-interop-mcp" });
      const conn = await connect(rig, "modern", ELICITING);
      const resend: Json = { action: "resend", headerIds: [11, 12] };
      const clean: Json = { action: "clean", killAppData: true, confirm: true };
      const filtered: Json = { action: "resendFiltered", item: "Demo.Item", from: "2026-01-01T00:00:00Z", dryRun: false, confirm: true };
      const resendState = (await conn.call("iris_message_resend", resend).ask()).state!;
      const cleanState = (await conn.call("iris_production_control", clean).ask()).state!;

      const attempts: Array<[string, Promise<{ raw: string; message: Json }>]> = [
        ["resend's state on clean", conn.callWith("iris_production_control", clean, { inputResponses: ACCEPT_ANSWER, requestState: resendState })],
        ["resend's state on resendFiltered", conn.callWith("iris_message_resend", filtered, { inputResponses: ACCEPT_ANSWER, requestState: resendState })],
        ["clean's state on resend", conn.callWith("iris_message_resend", resend, { inputResponses: ACCEPT_ANSWER, requestState: cleanState })],
      ];
      for (const [label, attempt] of attempts) expect(kindOf(await attempt), label).toBe("input_required");

      expect(rig.writes("a").filter((line) => !line.includes('"dryRun":true')), "nothing but the read-only preview of resendFiltered was sent").toEqual([]);
      const honest = await conn.callWith("iris_message_resend", resend, { inputResponses: ACCEPT_ANSWER, requestState: resendState });
      expect(kindOf(honest), "control: resend's own state still decides resend").toBe("complete");
    },
    TIMEOUT,
  );
});

describe("whatever a retry carries, only an accept with confirm true under a valid, unused state writes", () => {
  type Outcome = "asked again" | "declined unconfirmed" | "ran";
  const ODD: Array<[string, Json, Outcome]> = [
    ["a string", "accept", "asked again"],
    ["null", null, "asked again"],
    ["a number", 1, "asked again"],
    ["an array", [], "asked again"],
    ["an accept with no content", { action: "accept" }, "declined unconfirmed"],
    ["an accept whose confirm is the string true", { action: "accept", content: { confirm: "true" } }, "declined unconfirmed"],
    ["an accept whose confirm is 1", { action: "accept", content: { confirm: 1 } }, "declined unconfirmed"],
    ["an accept whose content is an array", { action: "accept", content: [true] }, "declined unconfirmed"],
    ["an action in upper case", { action: "ACCEPT", content: { confirm: true } }, "asked again"],
    ["an action the protocol does not define", { action: "maybe", content: { confirm: true } }, "asked again"],
    ["a sampling answer", { role: "assistant", content: { type: "text", text: "yes" }, model: "x" }, "asked again"],
    ["an accept with other content keys as well", { action: "accept", content: { confirm: true, extra: 1 }, _meta: {} }, "ran"],
  ];

  it.each(ODD)(
    "%s",
    async (_label, value, outcome) => {
      const { rig, conn, state } = await modernAsk();

      const line = await conn.callWith(TOOL, PURGE, { inputResponses: { confirm: value }, requestState: state });

      if (outcome === "asked again") expect(kindOf(line)).toBe("input_required");
      else if (outcome === "ran") expect(plainResult(resultOf(line)).isError).toBeUndefined();
      else expect(plainResult(resultOf(line)).structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: "purge", response: "unconfirmed" });
      expect(purgesOf(rig)).toHaveLength(outcome === "ran" ? 1 : 0);
      const next = await conn.callWith(TOOL, { action: "purge", end: "2026-01-01 00:00:00" }, {});
      expect(plainResult(resultOf(next)).isError, "the server still answers the next request").toBe(true);
    },
    TIMEOUT,
  );

  it(
    "an answer under another key, an inputResponses array, and an empty requestState are all asked again",
    async () => {
      const { rig, conn, state } = await modernAsk();

      const lines = [
        await conn.callWith(TOOL, PURGE, { inputResponses: { other: TICKED }, requestState: state }),
        await conn.callWith(TOOL, PURGE, { inputResponses: [], requestState: state }),
        await conn.callWith(TOOL, PURGE, { inputResponses: ACCEPT_ANSWER, requestState: "" }),
        await conn.callWith(TOOL, PURGE, { requestState: state }),
      ];

      expect(lines.map(kindOf)).toEqual(["input_required", "input_required", "input_required", "input_required"]);
      expect(purgesOf(rig)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "garbage states (empty, truncated, wrong prefix, a megabyte, non-ASCII) are asked again; the server stays up",
    async () => {
      const { rig, conn } = await modernAsk();
      const garbage = ["", "v1.", "v1..", "v1.x.", "v1.!!!.???", "nope", "v1.e30.", `v1.${"A".repeat(1_000_000)}.${"B".repeat(100)}`, `v1.${String.fromCodePoint(0xe9, 0x4e2d)}.${String.fromCodePoint(0x2603)}`];

      for (const requestState of garbage) {
        const line = await conn.callWith(TOOL, PURGE, { inputResponses: ACCEPT_ANSWER, requestState });
        expect(kindOf(line), requestState.slice(0, 20)).toBe("input_required");
      }
      expect(purgesOf(rig)).toEqual([]);
      expect(await Promise.race([rig.wire.exit(), rig.wire.quiet(50).then(() => "running")])).toBe("running");
    },
    TIMEOUT,
  );
});

describe.each(ERAS)("what a request can claim, on the %s era, for every gate", (era: Era) => {
  const WITHOUT_PROMOTE = GATES.filter((gate) => gate.id !== "dev: execute");

  async function open(pkg: string, capabilities: Json): Promise<{ rig: GateRig; conn: Conn }> {
    const rig = await openRig({ pkg });
    return { rig, conn: await connect(rig, era, capabilities) };
  }

  if (era === "legacy") {
    describe.each(GATES)("$id", (gate) => {
      it(
        "a plain call carrying an accept and a made-up state, from a client that declared elicitation, is asked and never runs",
        async () => {
          const { rig, conn } = await open(gate.pkg, ELICITING);
          const args = await gate.args(conn);

          const pending = conn.callWith(gate.tool, args, { inputResponses: ACCEPT_ANSWER, requestState: "v1.e30.AAAA" });
          const dialog = await rig.wire.untilLine((line) => line.message?.method === "elicitation/create");
          expect(dialog.message.params.message).toContain(`Confirm: ${gate.operation}.`);
          expect(rig.writes("a"), "the smuggled accept ran nothing").toEqual(gate.preflight);
          expect(rig.writes("b")).toEqual([]);
          rig.wire.sendRaw(JSON.stringify({ result: DECLINED, jsonrpc: "2.0", id: dialog.message.id }));
          expect(plainResult(resultOf(await pending)).structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: gate.action, response: "decline" });
          expect(rig.writes("a")).toEqual(gate.preflight);
          expect(rig.writes("b")).toEqual([]);
        },
        TIMEOUT,
      );

      it(
        "_meta that claims elicitation, on a connection whose client declared none, gets the baseline line and no dialog",
        async () => {
          const { rig, conn } = await open(gate.pkg, {});
          const args = await gate.args(conn);

          const line = await conn.callWith(gate.tool, args, { _meta: { [CLIENT_CAPABILITIES_KEY]: ELICITING } });

          expect(rawWithIdZero(line.raw)).toBe(baselineLine(BASELINE[gate.id]!.result, era, serverIdentity(gate.pkg)));
          expect(conn.dialogs()).toBe(0);
          expect(rig.writes("a")).toEqual(BASELINE[gate.id]!.a);
          expect(rig.writes("b")).toEqual(BASELINE[gate.id]!.b);
        },
        TIMEOUT,
      );
    });
  } else {
    describe.each(WITHOUT_PROMOTE)("$id", (gate) => {
      it(
        "a forged accept with no state, or a made-up one, asks; the envelope that declares nothing gets the baseline line with the same forged accept",
        async () => {
          const { rig, conn } = await open(gate.pkg, ELICITING);
          const args = await gate.args(conn);

          const none = await conn.callWith(gate.tool, args, { inputResponses: ACCEPT_ANSWER });
          const madeUp = await conn.callWith(gate.tool, args, { inputResponses: ACCEPT_ANSWER, requestState: "v1.e30.AAAA" });

          expect(kindOf(none)).toBe("input_required");
          expect(kindOf(madeUp)).toBe("input_required");
          expect(rig.writes(gate.side).filter((line) => !gate.preflight.includes(line))).toEqual([]);

          const silent = await conn.callWith(gate.tool, args, { inputResponses: ACCEPT_ANSWER }, {});
          expect(rawWithIdZero(silent.raw)).toBe(baselineLine(BASELINE[gate.id]!.result, "modern", serverIdentity(gate.pkg)));
        },
        TIMEOUT,
      );
    });

    it(
      "the promotion execute: a forged accept asks, and the state of one promotion decides nothing for another (other steps)",
      async () => {
        const { rig, conn } = await open("iris-dev-mcp", ELICITING);
        const args = await promoteArgs(conn, manyDocumentsDiff(2), { steps: [1] });

        const forged = await conn.callWith("iris_env_promote", args, { inputResponses: ACCEPT_ANSWER, requestState: "v1.e30.AAAA" });
        expect(kindOf(forged)).toBe("input_required");

        const state = (await conn.call("iris_env_promote", args).ask()).state!;
        const changed = await conn.callWith("iris_env_promote", { ...args, steps: [1, 2] }, { inputResponses: ACCEPT_ANSWER, requestState: state });

        expect(kindOf(changed), "other steps are other arguments: asked again").toBe("input_required");
        expect(resultOf(changed).inputRequests.confirm.params.message).toContain("2 step(s) from server 'default'");
        expect(rig.writes("a")).toEqual([]);
        expect(rig.writes("b")).toEqual([]);
      },
      TIMEOUT,
    );
  }
});
