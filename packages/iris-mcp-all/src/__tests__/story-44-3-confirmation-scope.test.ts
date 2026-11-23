/**
 * Story 44.3 (AC 44.3.1 to 44.3.5, AD-34, AD-19, DW-670; Rules #19, #36, #54, #59) - the confirmation is bound to the scope the dialog showed,
 * on both eras, through the real SDK client over stdio.
 *
 * The BUILT dev and interop servers run against the fake IRIS listener of `scripts/lib/fake-iris-listener.mjs` (127.0.0.1 inside this
 * process; no IRIS instance is reached), with auditing on and the gated writes enabled. The SDK client is the legacy one (`{mode: "legacy"}`)
 * or pinned to 2026-07-28, and declares form elicitation or nothing. A test changes what a listener answers while the dialog is open, by
 * answering through a function (`SdkRig.answer`) that calls `setDocumentContent` or `setResendPreview` on the rig before it returns the
 * answer, so the change happens between the round that asks and the round that decides.
 *
 * The promotion's target is the profile `other` (the second listener); `Demo.Sample.cls` is the promoted document, which the fake serves to
 * the source and the target alike. A `Storage Default` definition that the target gains drops, because the source copy has none. A "write"
 * is a POST, PUT or DELETE to a listener other than the startup bootstrap query.
 *
 * The AC 44.3.1 row ran red against the build of baseline revision 5717b9f2, before any source edit (the output is in the spec's
 * Verification section). The file fails, never skips, when a dist is missing or older than its source.
 */

import { afterEach, describe, expect, it } from "vitest";
import { closeSdkRigs, openSdkRig } from "./sdk-confirmation-rig.js";
import type { SdkRig } from "./sdk-confirmation-rig.js";
import { FROM, PROMOTE_DIFF } from "./story-43-3-qa-gates";
import { sampleWithStorage } from "./story-43-3-qa-wire";
import type { ElicitationAnswer, SdkVersionNegotiation } from "./process-gate-helpers.js";

type Era = "legacy" | "modern";

const ERAS: Array<[Era, SdkVersionNegotiation]> = [
  ["legacy", { mode: "legacy" }],
  ["modern", { mode: { pin: "2026-07-28" } }],
];

const FORM = { elicitation: { form: {} } };
const TICKED: ElicitationAnswer = { action: "accept", content: { confirm: true } };
const DECLINED: ElicitationAnswer = { action: "decline" };
const UNTICKED: ElicitationAnswer = { action: "accept", content: { confirm: false } };

const TAIL = "Tick Confirm and accept to run it now. Decline or cancel to change nothing.";

afterEach(closeSdkRigs);

// -- the promotion rows ---------------------------------------------------------------------------------------------------------------

/** The class the fake serves for `Demo.Sample.cls`, with a `Storage Default` definition: the target copy once it has gained one. */
const WITH_STORAGE = sampleWithStorage("Default");

/** The two writes that the promotion makes to the target: the save of the document, then the compile. */
const PROMOTE_PUT =
  'PUT /api/atelier/v8/HSCUSTOM/doc/Demo.Sample.cls?ignoreConflict=1 {"enc":false,"content":["Class Demo.Sample Extends %RegisteredObject","{","Method A()","{","}","}"]}';
const PROMOTE_COMPILE = 'POST /api/atelier/v8/HSCUSTOM/action/compile?flags=cuk ["Demo.Sample.cls"]';

/** The dialog message of the promotion, written from the spec; `drops` is the text after `drops Storage definitions: `, when there is any. */
const promotionMessage = (port: number, drops?: string): string =>
  "Confirm: promote changes to another server.\n" +
  "Target: server 'other', namespace HSCUSTOM\n" +
  `Scope: 1 step(s) from server 'default': #1 documents putAndCompile Demo.Sample.cls${drops === undefined ? "" : `; drops Storage definitions: ${drops}`}\n` +
  `Server: default (127.0.0.1:${port})\n${TAIL}`;

const SAMPLE_DROP = "Demo.Sample.cls ('Default')";

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

const withStorage = sampleWithStorage;

describe.each(ERAS)("Story 44.3 on the %s era: a promotion whose Storage drops change while the dialog is open", (_era, negotiation) => {
  /** A rig with a second server, and the plan that a real `plan` call returns for the diff. */
  async function promoting(capabilities?: Record<string, unknown>): Promise<{ rig: SdkRig; plan: unknown }> {
    const rig = await openSdkRig("iris-dev-mcp", negotiation, {
      ...(capabilities !== undefined ? { capabilities } : {}),
      governance: JSON.stringify({ global: { "iris_env_promote:execute": true } }),
      secondListener: true,
      clientName: "story-44-3",
    });
    const planned = await rig.call("iris_env_promote", { action: "plan", source: "default", target: "other", diff: PROMOTE_DIFF });
    expect(planned.result.isError).toBeUndefined();
    expect(planned.asks).toEqual([]);
    return { rig, plan: planned.result.structuredContent };
  }

  /** The audit entry of the `execute` call: the entries are the `plan` call's, then the `execute` call's. */
  const executeEntry = async (rig: SdkRig): Promise<Record<string, unknown>> => {
    const entries = await rig.entries(2);
    expect(entries).toHaveLength(2);
    return entries.at(-1) as Record<string, unknown>;
  };

  it(
    "AC 44.3.1: the person is asked again with the drops the first dialog did not show, and the target is written once, after that dialog",
    async () => {
      const { rig, plan } = await promoting(FORM);
      rig.answer((_request, index) => {
        if (index === 0) rig.setDocumentContent("other", "Demo.Sample.cls", WITH_STORAGE);
        return TICKED;
      });

      const exchange = await rig.call("iris_env_promote", promoteArgs(plan, { allowStorageRegeneration: true }));

      expect(exchange.asks.map((ask) => ask.message)).toEqual([promotionMessage(rig.port), promotionMessage(rig.port, SAMPLE_DROP)]);
      expect(exchange.result.isError).toBeUndefined();
      expect(rig.writes()).toEqual([]);
      expect(rig.otherWrites()).toEqual([PROMOTE_PUT, PROMOTE_COMPILE]);
    },
    60_000,
  );

  it(
    "a changed scope that is asked again and accepted: one entry for the call, accepted, written by the round that ends it",
    async () => {
      const { rig, plan } = await promoting(FORM);
      rig.answer((_request, index) => {
        if (index === 0) rig.setDocumentContent("other", "Demo.Sample.cls", WITH_STORAGE);
        return TICKED;
      });

      const exchange = await rig.call("iris_env_promote", promoteArgs(plan, { allowStorageRegeneration: true }));

      expect(exchange.asks).toHaveLength(2);
      expect(await executeEntry(rig)).toMatchObject({ tool: "iris_env_promote", action: "execute", outcome: "ok", confirmation: "accepted" });
    },
    60_000,
  );

  it(
    "an unchanged scope with drops on both rounds asks once, and the target is written once",
    async () => {
      const { rig, plan } = await promoting(FORM);
      rig.setDocumentContent("other", "Demo.Sample.cls", WITH_STORAGE);
      rig.answer(TICKED);

      const exchange = await rig.call("iris_env_promote", promoteArgs(plan, { allowStorageRegeneration: true }));

      expect(exchange.asks.map((ask) => ask.message)).toEqual([promotionMessage(rig.port, SAMPLE_DROP)]);
      expect(exchange.result.isError).toBeUndefined();
      expect(rig.otherWrites()).toEqual([PROMOTE_PUT, PROMOTE_COMPILE]);
      expect(await executeEntry(rig)).toMatchObject({ tool: "iris_env_promote", action: "execute", outcome: "ok", confirmation: "accepted" });
    },
    60_000,
  );

  it.each([
    ["decline", DECLINED, "decline", "declined"],
    ["an accept without the tick", UNTICKED, "unconfirmed", "unconfirmed"],
  ])(
    "%s of the re-asked dialog: CONFIRMATION_DECLINED, neither server is written, one denied entry",
    async (_label, answer, response, recorded) => {
      const { rig, plan } = await promoting(FORM);
      rig.answer((_request, index) => {
        if (index === 0) {
          rig.setDocumentContent("other", "Demo.Sample.cls", WITH_STORAGE);
          return TICKED;
        }
        return answer;
      });

      const exchange = await rig.call("iris_env_promote", promoteArgs(plan, { allowStorageRegeneration: true }));

      expect(exchange.asks.map((ask) => ask.message)).toEqual([promotionMessage(rig.port), promotionMessage(rig.port, SAMPLE_DROP)]);
      expect(exchange.result.isError).toBe(true);
      expect(exchange.result.structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: "execute", response });
      expect(rig.writes()).toEqual([]);
      expect(rig.otherWrites()).toEqual([]);
      expect(await executeEntry(rig)).toMatchObject({
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
    "a scope that changes on every dialog: two dialogs, then CONFIRMATION_SCOPE_CHANGED, nothing written, one entry",
    async () => {
      const { rig, plan } = await promoting(FORM);
      const names = ["Default", "Alt", "Third", "Fourth"];
      rig.answer((_request, index) => {
        rig.setDocumentContent("other", "Demo.Sample.cls", withStorage(names[index] as string));
        return TICKED;
      });

      const exchange = await rig.call("iris_env_promote", promoteArgs(plan, { allowStorageRegeneration: true }));

      expect(exchange.asks.map((ask) => ask.message)).toEqual([promotionMessage(rig.port), promotionMessage(rig.port, "Demo.Sample.cls ('Default')")]);
      expect(exchange.result.isError).toBe(true);
      expect(exchange.result.structuredContent).toEqual({ code: "CONFIRMATION_SCOPE_CHANGED", action: "execute" });
      expect(exchange.result.content?.[0]?.text).toBe(
        "The scope of promote changes to another server changed again while the person was answering the confirmation dialog, so the call was not run. " +
          "Nothing was changed. Run the call again once what it covers has stopped changing.",
      );
      expect(rig.writes()).toEqual([]);
      expect(rig.otherWrites()).toEqual([]);
      expect(await executeEntry(rig)).toMatchObject({
        tool: "iris_env_promote",
        action: "execute",
        outcome: "denied",
        denyReason: "CONFIRMATION_SCOPE_CHANGED",
        confirmation: "accepted",
      });
    },
    60_000,
  );

  it(
    "a handler that refuses first (drops appear while allowStorageRegeneration is off): STORAGE_DROPPED, one entry, and no unanswered entry when the client closes",
    async () => {
      const { rig, plan } = await promoting(FORM);
      rig.answer((_request, index) => {
        if (index === 0) rig.setDocumentContent("other", "Demo.Sample.cls", WITH_STORAGE);
        return TICKED;
      });

      const exchange = await rig.call("iris_env_promote", promoteArgs(plan));

      expect(exchange.asks.map((ask) => ask.message)).toEqual([promotionMessage(rig.port)]);
      expect(exchange.result.isError).toBe(true);
      expect(exchange.result.structuredContent).toMatchObject({ code: "STORAGE_DROPPED" });
      expect(rig.otherWrites()).toEqual([]);
      expect(await executeEntry(rig)).toMatchObject({ tool: "iris_env_promote", action: "execute", outcome: "error" });

      await rig.client.close();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const after = await rig.entries(2);
      expect(after.map((entry) => entry["confirmation"])).toEqual([undefined, undefined]);
      expect(after).toHaveLength(2);
    },
    60_000,
  );

  it(
    "a client that declares no form elicitation runs the changed-drops promotion with no dialog, and the target is written",
    async () => {
      const { rig, plan } = await promoting();
      rig.setDocumentContent("other", "Demo.Sample.cls", WITH_STORAGE);

      const exchange = await rig.call("iris_env_promote", promoteArgs(plan, { allowStorageRegeneration: true }));

      expect(exchange.asks).toEqual([]);
      expect(exchange.result.isError).toBeUndefined();
      expect(rig.otherWrites()).toEqual([PROMOTE_PUT, PROMOTE_COMPILE]);
      const entry = await executeEntry(rig);
      expect(entry).toMatchObject({ tool: "iris_env_promote", action: "execute", outcome: "ok" });
      expect(Object.prototype.hasOwnProperty.call(entry, "confirmation")).toBe(false);
    },
    60_000,
  );
});

// -- the other gates --------------------------------------------------------------------------------------------------------------------

const RESEND_POST = "POST /api/executemcp/v2/interop/message/resend ";
/** The write-shaped requests of a `resendFiltered` of `Demo.Item` with no `to`: the read-only preview, and the execute. */
const PREVIEW = `${RESEND_POST}{"action":"resendFiltered","item":"Demo.Item","from":"${FROM}","namespace":"HSCUSTOM","dryRun":true}`;
const EXECUTE = `${RESEND_POST}{"action":"resendFiltered","item":"Demo.Item","from":"${FROM}","namespace":"HSCUSTOM","dryRun":false,"confirm":true}`;
const FILTERED_ARGS = { action: "resendFiltered", item: "Demo.Item", from: FROM, dryRun: false, confirm: true };
const filteredMessage = (port: number, count: number, to: string): string =>
  "Confirm: resend the messages that match a filter.\n" +
  "Target: item Demo.Item, namespace HSCUSTOM\n" +
  `Scope: ${count} message(s) match now (status Errored, from ${FROM} to ${to}); IRIS counts again when it runs and resends at most 100\n` +
  `Server: default (127.0.0.1:${port})\n${TAIL}`;

describe.each(ERAS)("Story 44.3 on the %s era: the filter of a resendFiltered is bound, its live count and defaulted `to` are not", (_era, negotiation) => {
  const filteredRig = (capabilities?: Record<string, unknown>): Promise<SdkRig> =>
    openSdkRig("iris-interop-mcp", negotiation, {
      ...(capabilities !== undefined ? { capabilities } : {}),
      governance: JSON.stringify({ global: { "iris_message_resend:resendFiltered": true } }),
      clientName: "story-44-3",
    });

  it(
    "a count that goes from 3 to 4 and a defaulted `to` that moves: asked once, proceeds, and sends two previews and then the execute",
    async () => {
      const rig = await filteredRig(FORM);
      rig.answer((_request, index) => {
        if (index === 0) rig.setResendPreview("default", "Demo.Item", { matchCount: 4, to: "2026-01-01T00:00:05Z" });
        return TICKED;
      });

      const exchange = await rig.call("iris_message_resend", FILTERED_ARGS);

      expect(exchange.asks.map((ask) => ask.message)).toEqual([filteredMessage(rig.port, 3, FROM)]);
      expect(exchange.result.isError).toBeUndefined();
      expect(exchange.result.structuredContent).toMatchObject({ summary: { total: 4, succeeded: 4, failed: 0 } });
      expect(exchange.writes).toEqual([PREVIEW, PREVIEW, EXECUTE]);
      expect(await rig.entries(1)).toEqual([expect.objectContaining({ tool: "iris_message_resend", outcome: "ok", confirmation: "accepted" })]);
    },
    60_000,
  );

  it(
    "a decline sends one preview and no execute",
    async () => {
      const rig = await filteredRig(FORM);
      rig.answer(DECLINED);

      const exchange = await rig.call("iris_message_resend", FILTERED_ARGS);

      expect(exchange.asks).toHaveLength(1);
      expect(exchange.result.structuredContent).toMatchObject({ code: "CONFIRMATION_DECLINED" });
      expect(exchange.writes).toEqual([PREVIEW]);
    },
    60_000,
  );

  it(
    "a count that becomes 0 proceeds without a second dialog, and IRIS answers the execute",
    async () => {
      const rig = await filteredRig(FORM);
      rig.answer((_request, index) => {
        if (index === 0) rig.setResendPreview("default", "Demo.Item", { matchCount: 0 });
        return TICKED;
      });

      const exchange = await rig.call("iris_message_resend", FILTERED_ARGS);

      expect(exchange.asks).toHaveLength(1);
      expect(exchange.result.isError).toBeUndefined();
      expect(exchange.result.structuredContent).toMatchObject({ summary: { total: 0 } });
      expect(exchange.writes).toEqual([PREVIEW, PREVIEW, EXECUTE]);
      expect(await rig.entries(1)).toEqual([expect.objectContaining({ outcome: "ok", confirmation: "accepted" })]);
    },
    60_000,
  );

  it(
    "a count that goes 600 over the cap proceeds without a second dialog, and IRIS refuses the execute",
    async () => {
      const rig = await filteredRig(FORM);
      rig.answer((_request, index) => {
        if (index === 0) rig.setResendPreview("default", "Demo.Item", { matchCount: 600 });
        return TICKED;
      });

      const exchange = await rig.call("iris_message_resend", FILTERED_ARGS);

      expect(exchange.asks).toHaveLength(1);
      expect(exchange.result.isError).toBe(true);
      expect(exchange.result.content?.[0]?.text).toContain("600 messages match the filter, exceeding the maxMessages cap of 100");
      expect(exchange.writes).toEqual([PREVIEW, PREVIEW, EXECUTE]);
      expect(await rig.entries(1)).toEqual([expect.objectContaining({ outcome: "error", confirmation: "accepted" })]);
    },
    60_000,
  );

  it(
    "a preview that fails on the round that carries the accept ends the call with that error: no second dialog, no execute, an error entry that says accepted",
    async () => {
      const rig = await filteredRig(FORM);
      rig.answer((_request, index) => {
        if (index === 0) rig.setResendPreview("default", "Demo.Item", { failPreview: true });
        return TICKED;
      });

      const exchange = await rig.call("iris_message_resend", FILTERED_ARGS);

      expect(exchange.asks.map((ask) => ask.message)).toEqual([filteredMessage(rig.port, 3, FROM)]);
      expect(exchange.result.isError).toBe(true);
      expect(exchange.result.content?.[0]?.text).toContain("the fake IRIS preview failed");
      expect(exchange.writes).toEqual([PREVIEW, PREVIEW]);
      expect(await rig.entries(1)).toEqual([expect.objectContaining({ tool: "iris_message_resend", outcome: "error", confirmation: "accepted" })]);
    },
    60_000,
  );
});

describe.each(ERAS)("Story 44.3 on the %s era: a gate whose scope is a pure function of its arguments", (_era, negotiation) => {
  it(
    "the purge asks once, writes once, and the entry says accepted",
    async () => {
      const rig = await openSdkRig("iris-admin-mcp", negotiation, {
        capabilities: FORM,
        governance: JSON.stringify({ global: { "iris_audit_manage:purge": true } }),
        clientName: "story-44-3",
      });
      rig.answer(TICKED);

      const exchange = await rig.call("iris_audit_manage", { action: "purge", end: "2026-01-01 00:00:00", confirm: true });

      expect(exchange.asks).toHaveLength(1);
      expect(exchange.result.isError).toBeUndefined();
      expect(exchange.writes).toEqual(['POST /api/executemcp/v2/security/audit {"action":"purge","confirm":true,"end":"2026-01-01 00:00:00"}']);
      expect(await rig.entries(1)).toEqual([expect.objectContaining({ tool: "iris_audit_manage", outcome: "ok", confirmation: "accepted" })]);
    },
    60_000,
  );
});
