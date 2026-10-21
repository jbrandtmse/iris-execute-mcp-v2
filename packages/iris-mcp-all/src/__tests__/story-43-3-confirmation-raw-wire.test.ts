/**
 * Story 43.3 (AC 43.3.2 era, 43.3.4, 43.3.5; matrix rows Smuggled capability, Forged accept, Arguments changed, Tampered / replayed state,
 * Valid decline with the capability dropped; AD-34; Rules #36, #46, #59) - the confirmation of `iris_audit_manage` `purge`, driven by hand
 * over raw JSON-RPC lines, which the SDK client cannot do: it never changes the arguments between rounds, forges nothing and declares
 * what it declares.
 *
 * The BUILT admin server runs against two fake IRIS listeners with auditing on and `purge` enabled (127.0.0.1 only; no IRIS instance is
 * reached), and the hand driver of `story-43-2-qa-hand-wire.ts` writes the lines and keeps every line the server writes.
 *
 *  - **A v1.29-era client.** No v1 SDK is installed (Story 43.1 removed it), so the lines are the bytes that `@modelcontextprotocol/sdk@1.29.0`
 *    (zod 3.25.76) sent, captured server-side on 2026-10-20 (Rule #36): `initialize` with `{"elicitation":{}}` and, answering the server's
 *    `elicitation/create` request, an accept, a decline and a cancel. `"capabilities":{}` is the same line without the capability.
 *  - **Legacy.** A 2025 client that declared no elicitation cannot claim one through `_meta`; a plain call carrying an accept and a made-up
 *    state is never honored, by a client that declared elicitation or one that did not.
 *  - **Modern.** Arguments changed between rounds, a tampered state, a replayed state, a forged accept with no state, and a valid decline whose
 *    retry no longer declares the capability.
 *
 * The file fails, never skips, when a dist is missing or older than its source.
 */

import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./pack-fixture";
import { staleDistReason } from "./process-gate-helpers.js";
import {
  CLIENT_CAPABILITIES_KEY,
  EXAMPLE_META,
  MODERN_VERSION,
  modernCall,
  resultOf,
  startRig,
  type HandWire,
  type Json,
  type Rig,
  type WireLine,
} from "./story-43-2-qa-hand-wire";

const stale = ["shared", "iris-admin-mcp"].map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const).filter(([, reason]) => reason !== undefined);
if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);

const GOVERNANCE = JSON.stringify({ global: { "iris_audit_manage:purge": true } });
const TOOL = "iris_audit_manage";
const PURGE = { action: "purge", end: "2026-01-01 00:00:00", confirm: true };
const FORM = { elicitation: { form: {} } };
const SCHEMA = {
  type: "object",
  properties: { confirm: { type: "boolean", title: "Confirm", description: "Tick to confirm this change.", default: false } },
  required: ["confirm"],
};
const PURGE_PATH = "/api/executemcp/v2/security/audit";
const PURGE_RESULT_TEXT = '{\n  "action": "purge",\n  "deleted": 3,\n  "success": 1\n}';
const DECLINE_TEXT =
  "The person declined the confirmation for: permanently delete audit-log records. Nothing was changed. Do not repeat this call unless the person asks for it again.";

/** The lines of the v1.29.0 client, with the member order that client writes. */
const V129 = {
  initialize: (capabilities: string): string =>
    `{"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":${capabilities},"clientInfo":{"name":"v129-oracle","version":"1.29.0"}},"jsonrpc":"2.0","id":0}`,
  initialized: '{"method":"notifications/initialized","jsonrpc":"2.0"}',
  call: (args: Record<string, unknown>): string =>
    `{"method":"tools/call","params":{"name":"${TOOL}","arguments":${JSON.stringify(args)}},"jsonrpc":"2.0","id":1}`,
  accept: (id: unknown): string => `{"result":{"action":"accept","content":{"confirm":true}},"jsonrpc":"2.0","id":${JSON.stringify(id)}}`,
  decline: (id: unknown): string => `{"result":{"action":"decline"},"jsonrpc":"2.0","id":${JSON.stringify(id)}}`,
  cancel: (id: unknown): string => `{"result":{"action":"cancel"},"jsonrpc":"2.0","id":${JSON.stringify(id)}}`,
};

const rigs: Rig[] = [];
/** A rig that this file stops after the test: the admin server with `purge` enabled. */
async function rigOf(): Promise<Rig> {
  const rig = await startRig({ pkg: "iris-admin-mcp", env: { IRIS_GOVERNANCE: GOVERNANCE } });
  rigs.push(rig);
  return rig;
}
afterEach(async () => {
  while (rigs.length > 0) await rigs.pop()!.stop();
});

const purgesOf = (rig: Rig): string[] => rig.requests.a().filter((request) => request.includes(PURGE_PATH));
const isDialog = (line: WireLine): boolean => line.message?.method === "elicitation/create";
const dialogsOf = (wire: HandWire): WireLine[] => wire.stdout().filter(isDialog);

/** The message the dialog of a purge with `end=2026-01-01 00:00:00` shows on `rig`. */
const messageOf = (rig: Rig): string =>
  "Confirm: permanently delete audit-log records.\nTarget: the IRIS audit log\nScope: records matching end=2026-01-01 00:00:00\n" +
  `Server: default (127.0.0.1:${rig.ports.a})\nTick Confirm and accept to run it now. Decline or cancel to change nothing.`;

/** Open a v1.29-era connection that declares `capabilities`, and send the purge call. */
async function v129Connection(rig: Rig, capabilities: string, args: Record<string, unknown> = PURGE): Promise<void> {
  const { wire } = rig;
  wire.sendRaw(V129.initialize(capabilities));
  const initialized = await wire.response(0);
  expect(resultOf(initialized).protocolVersion).toBe("2025-11-25");
  wire.sendRaw(V129.initialized);
  wire.sendRaw(V129.call(args));
}

describe("a v1.29-era client (captured lines)", () => {
  it.each([
    ["an accept", V129.accept, "ok", "accepted"],
    ["a decline", V129.decline, "denied", "declined"],
    ["a cancel", V129.cancel, "denied", "cancelled"],
  ])("answers the server's dialog with %s", async (_label, answer, outcome, confirmation) => {
    const rig = await rigOf();
    await v129Connection(rig, '{"elicitation":{}}');

    const dialog = await rig.wire.untilLine(isDialog);
    expect(Object.keys(dialog.message).sort()).toEqual(["id", "jsonrpc", "method", "params"]);
    expect(dialog.message.params.mode).toBe("form");
    expect(dialog.message.params.message).toBe(messageOf(rig));
    expect(dialog.message.params.requestedSchema).toStrictEqual(SCHEMA);
    expect(Object.keys(dialog.message.params._meta)).toEqual(["progressToken"]);
    expect(purgesOf(rig), "nothing is written while the person is asked").toEqual([]);

    rig.wire.sendRaw(answer(dialog.message.id));
    const result = resultOf(await rig.wire.response(1));

    expect(dialogsOf(rig.wire)).toHaveLength(1);
    if (outcome === "ok") {
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe(PURGE_RESULT_TEXT);
      expect(purgesOf(rig)).toEqual([`POST ${PURGE_PATH}`]);
    } else {
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: "purge", response: confirmation === "declined" ? "decline" : "cancel" });
      expect(purgesOf(rig)).toEqual([]);
    }
    const audit = (await rig.audit(2)).filter((entry) => entry.tool === TOOL);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ outcome, confirmation });
  });

  it("with capabilities {} gets today's contract: no dialog, the call runs", async () => {
    const rig = await rigOf();
    await v129Connection(rig, "{}");

    const result = resultOf(await rig.wire.response(1));

    expect(result.content[0].text).toBe(PURGE_RESULT_TEXT);
    expect(dialogsOf(rig.wire)).toEqual([]);
    expect(purgesOf(rig)).toEqual([`POST ${PURGE_PATH}`]);
    const audit = (await rig.audit(2)).filter((entry) => entry.tool === TOOL);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ outcome: "ok" });
    expect(Object.prototype.hasOwnProperty.call(audit[0], "confirmation")).toBe(false);
  });

  it("with capabilities {} and no confirm gets today's refusal and no dialog", async () => {
    const rig = await rigOf();
    await v129Connection(rig, "{}", { action: "purge", end: "2026-01-01 00:00:00" });

    const result = resultOf(await rig.wire.response(1));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: 'purge' is destructive and requires confirm:true to proceed.");
    expect(dialogsOf(rig.wire)).toEqual([]);
  });

  it("an eliciting client that omits confirm is refused before any dialog", async () => {
    const rig = await rigOf();
    await v129Connection(rig, '{"elicitation":{}}', { action: "purge", end: "2026-01-01 00:00:00" });

    const result = resultOf(await rig.wire.response(1));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: 'purge' is destructive and requires confirm:true to proceed.");
    expect(dialogsOf(rig.wire)).toEqual([]);
  });
});

describe("the 2025 era: what a request can claim", () => {
  it("a client that declared no elicitation cannot claim one through _meta: no dialog, the call runs", async () => {
    const rig = await rigOf();
    const { wire } = rig;
    wire.sendRaw(V129.initialize("{}"));
    await wire.response(0);
    wire.sendRaw(V129.initialized);

    const answer = await wire.request(1, "tools/call", {
      name: TOOL,
      arguments: PURGE,
      _meta: { [CLIENT_CAPABILITIES_KEY]: { elicitation: {} } },
    });

    expect(resultOf(answer).content[0].text).toBe(PURGE_RESULT_TEXT);
    expect(dialogsOf(wire)).toEqual([]);
    expect(purgesOf(rig)).toHaveLength(1);
  });

  it("a plain call that carries an accept and a state that is not a string is refused by the SDK, and nothing runs", async () => {
    const rig = await rigOf();
    const { wire } = rig;
    wire.sendRaw(V129.initialize('{"elicitation":{}}'));
    await wire.response(0);
    wire.sendRaw(V129.initialized);

    const answer = await wire.request(1, "tools/call", {
      name: TOOL,
      arguments: PURGE,
      inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
      requestState: { v: 1 },
    });

    expect(answer.message.error.code).toBe(-32602);
    expect(dialogsOf(wire)).toEqual([]);
    expect(purgesOf(rig)).toEqual([]);
  });

  it.each([
    ["no state", {}],
    ["a made-up state", { requestState: "v1.e30.AAAA" }],
  ])("a plain call that carries an accept and %s is not honored by a client that declared elicitation: it is asked", async (_label, state) => {
    const rig = await rigOf();
    const { wire } = rig;
    wire.sendRaw(V129.initialize('{"elicitation":{}}'));
    await wire.response(0);
    wire.sendRaw(V129.initialized);

    wire.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: TOOL, arguments: PURGE, inputResponses: { confirm: { action: "accept", content: { confirm: true } } }, ...state },
    });
    const dialog = await wire.untilLine(isDialog);
    expect(purgesOf(rig), "the forged accept ran nothing").toEqual([]);

    wire.sendRaw(V129.decline(dialog.message.id));
    const result = resultOf(await wire.response(1));

    expect(result.content[0].text).toBe(DECLINE_TEXT);
    expect(purgesOf(rig)).toEqual([]);
  });

  it("a plain call that carries an accept and a made-up state is not a reason to ask a client that declared nothing: it runs as today", async () => {
    const rig = await rigOf();
    const { wire } = rig;
    wire.sendRaw(V129.initialize("{}"));
    await wire.response(0);
    wire.sendRaw(V129.initialized);

    const answer = await wire.request(1, "tools/call", {
      name: TOOL,
      arguments: PURGE,
      inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
      requestState: "v1.e30.AAAA",
    });

    expect(resultOf(answer).content[0].text).toBe(PURGE_RESULT_TEXT);
    expect(dialogsOf(wire)).toEqual([]);
  });
});

describe("revision 2026-07-28", () => {
  const ACCEPT = { confirm: { action: "accept", content: { confirm: true } } };

  /** A modern connection to a fresh rig, with the helpers for the rounds of one purge. */
  async function modernRig(): Promise<{
    rig: Rig;
    next: () => number;
    round: (args: Record<string, unknown>, retry?: Record<string, unknown>, meta?: Record<string, unknown>) => Promise<Json>;
  }> {
    const rig = await rigOf();
    let id = 1;
    const discovered = await rig.wire.request(id, "server/discover", { _meta: EXAMPLE_META });
    expect(resultOf(discovered).supportedVersions).toContain(MODERN_VERSION);
    return {
      rig,
      next: () => ++id,
      round: async (args, retry = {}, meta = { [CLIENT_CAPABILITIES_KEY]: FORM }) =>
        resultOf(await rig.wire.request(++id, "tools/call", { ...modernCall(TOOL, args, meta), ...retry })),
    };
  }

  const stateOf = (result: Json): string => {
    expect(result.resultType).toBe("input_required");
    return result.requestState;
  };

  it("round one asks with the template and a state, and writes nothing", async () => {
    const { rig, round } = await modernRig();

    const first = await round(PURGE);

    expect(Object.keys(first.inputRequests)).toEqual(["confirm"]);
    expect(first.inputRequests.confirm.method).toBe("elicitation/create");
    expect(first.inputRequests.confirm.params).toStrictEqual({ mode: "form", message: messageOf(rig), requestedSchema: SCHEMA });
    expect(typeof first.requestState).toBe("string");
    expect(purgesOf(rig)).toEqual([]);
  });

  it("round two with the state and an accept runs the call once", async () => {
    const { rig, round } = await modernRig();
    const state = stateOf(await round(PURGE));

    const second = await round(PURGE, { inputResponses: ACCEPT, requestState: state });

    expect(second.resultType).toBe("complete");
    expect(second.content[0].text).toBe(PURGE_RESULT_TEXT);
    expect(purgesOf(rig)).toHaveLength(1);
  });

  it("arguments changed between the rounds: asked again for the new arguments with a new state, and nothing runs", async () => {
    const { rig, round } = await modernRig();
    const state = stateOf(await round(PURGE));

    const changed = await round({ ...PURGE, end: "2026-02-02 00:00:00" }, { inputResponses: ACCEPT, requestState: state });

    const newState = stateOf(changed);
    expect(newState).not.toBe(state);
    expect(changed.inputRequests.confirm.params.message).toContain("Scope: records matching end=2026-02-02 00:00:00");
    expect(purgesOf(rig)).toEqual([]);
  });

  it("a state minted for a call to one server profile is not honored for the same call to another: the server argument is part of what it binds", async () => {
    const { rig, round } = await modernRig();
    const state = stateOf(await round(PURGE));

    const other = await round({ ...PURGE, server: "other" }, { inputResponses: ACCEPT, requestState: state });

    expect(other.resultType).toBe("input_required");
    expect(purgesOf(rig)).toEqual([]);
    expect(rig.requests.b().filter((request) => request.includes(PURGE_PATH)), "nothing reached the profile 'other' either").toEqual([]);
  });

  it("a tampered state is asked again, and never runs", async () => {
    const { rig, round } = await modernRig();
    const state = stateOf(await round(PURGE));
    const dot = state.lastIndexOf(".");
    const flipped = (text: string, at: number): string => `${text.slice(0, at)}${text[at] === "A" ? "B" : "A"}${text.slice(at + 1)}`;

    for (const tampered of [flipped(state, 6), `${state.slice(0, dot + 1)}${flipped(state.slice(dot + 1), 2)}`, `${state}x`, state.slice(0, dot)]) {
      const again = await round(PURGE, { inputResponses: ACCEPT, requestState: tampered });
      expect(again.resultType, tampered).toBe("input_required");
      expect(again.requestState).not.toBe(tampered);
    }
    expect(purgesOf(rig)).toEqual([]);
  });

  it("a state that has decided a call is asked again when it is replayed, and the call does not run twice", async () => {
    const { rig, round } = await modernRig();
    const state = stateOf(await round(PURGE));
    await round(PURGE, { inputResponses: ACCEPT, requestState: state });

    const replay = await round(PURGE, { inputResponses: ACCEPT, requestState: state });

    expect(replay.resultType).toBe("input_required");
    expect(replay.requestState).not.toBe(state);
    expect(purgesOf(rig)).toHaveLength(1);
  });

  it("a state that has decided a decline is asked again when it is replayed", async () => {
    const { rig, round } = await modernRig();
    const state = stateOf(await round(PURGE));
    const declined = await round(PURGE, { inputResponses: { confirm: { action: "decline" } }, requestState: state });
    expect(declined.isError).toBe(true);

    const replay = await round(PURGE, { inputResponses: ACCEPT, requestState: state });

    expect(replay.resultType).toBe("input_required");
    expect(purgesOf(rig)).toEqual([]);
  });

  it("a forged accept with no state, or with a made-up one, is asked and never runs", async () => {
    const { rig, round } = await modernRig();

    const none = await round(PURGE, { inputResponses: ACCEPT });
    const madeUp = await round(PURGE, { inputResponses: ACCEPT, requestState: "v1.e30.AAAA" });

    expect(none.resultType).toBe("input_required");
    expect(madeUp.resultType).toBe("input_required");
    expect(purgesOf(rig)).toEqual([]);
  });

  it("a forged accept from a client whose envelope declares nothing gets today's contract: the call runs", async () => {
    const { rig, round } = await modernRig();

    const result = await round(PURGE, { inputResponses: ACCEPT }, { [CLIENT_CAPABILITIES_KEY]: {} });

    expect(result.resultType).toBe("complete");
    expect(result.content[0].text).toBe(PURGE_RESULT_TEXT);
    expect(purgesOf(rig)).toHaveLength(1);
  });

  it("a valid decline is honored even when the retry no longer declares the capability", async () => {
    const { rig, round } = await modernRig();
    const state = stateOf(await round(PURGE));

    const declined = await round(PURGE, { inputResponses: { confirm: { action: "decline" } }, requestState: state }, { [CLIENT_CAPABILITIES_KEY]: {} });

    expect(declined.isError).toBe(true);
    expect(declined.content[0].text).toBe(DECLINE_TEXT);
    expect(declined.structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: "purge", response: "decline" });
    expect(purgesOf(rig)).toEqual([]);
    const audit = (await rig.audit(2)).filter((entry) => entry.tool === TOOL);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ outcome: "denied", denyReason: "CONFIRMATION_DECLINED", confirmation: "declined" });
  });

  it("round one writes no audit entry, and the deciding round writes the one", async () => {
    const { rig, round } = await modernRig();
    const state = stateOf(await round(PURGE));
    await rig.wire.quiet(300);
    expect((await rig.audit(1)).filter((entry) => entry.tool === TOOL)).toEqual([]);

    await round(PURGE, { inputResponses: ACCEPT, requestState: state });

    const audit = (await rig.audit(2)).filter((entry) => entry.tool === TOOL);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ outcome: "ok", confirmation: "accepted" });
  });
});
