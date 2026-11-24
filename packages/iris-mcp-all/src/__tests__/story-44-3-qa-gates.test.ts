/**
 * Story 44.3 QA (AC 44.3.2, 44.3.3, 44.3.4; AD-34, AD-19; Rules #19, #36, #54, #58, #59) - the gaps that `story-44-3-confirmation-scope.test.ts`
 * leaves against the matrix and the gate table, on both eras, through the real SDK client over stdio against the fake IRIS listeners.
 *
 * Rows:
 *  - the gates the first file runs only for one outcome: `iris_message_resend:resend`, `iris_production_control:clean` with `killAppData`
 *    and `iris_audit_manage:purge` (whole-text bindings) ask once and run once on an accept, and write nothing and leave one `denied`
 *    entry on a decline;
 *  - `iris_doc_edit:regenerateStorage` (the binding is every dropped name): one ask, one save; a change of the document outside the edited
 *    lines changes no dropped name, so it asks once; a change inside the edited lines is refused by the handler (STALE_CONTENT) before it
 *    reaches the helper, which ends the call as one entry with no `unanswered` entry after the client closes (matrix "Handler refuses first");
 *  - `iris_env_promote:execute`, drops beyond the cut of the dialog: a drop past the tenth, and the tail of a name longer than the dialog
 *    allows, are in the text neither shown nor bound by the dialog, yet a change of either asks again (decision: promote binds every drop);
 *  - the bound is per logical call: after `CONFIRMATION_SCOPE_CHANGED` a new call asks again from no re-asks;
 *  - `iris_message_resend:resendFiltered`: a dismissed dialog and an accept without the tick send no second preview (no extra request on any
 *    decline path).
 * Every fake answer is a shape the real IRIS returns (Rule #54): a document served with other content, a preview with another count. The
 * file fails, never skips, on a stale dist.
 */

import { afterEach, describe, expect, it } from "vitest";
import { closeSdkRigs, openSdkRig } from "./sdk-confirmation-rig.js";
import type { SdkRig } from "./sdk-confirmation-rig.js";
import { FROM, PROMOTE_DIFF, STORAGE_EDIT, manyDocumentsDiff } from "./story-43-3-qa-gates";
import type { ElicitationAnswer, SdkVersionNegotiation } from "./process-gate-helpers.js";

type Era = "legacy" | "modern";

const ERAS: Array<[Era, SdkVersionNegotiation]> = [
  ["legacy", { mode: "legacy" }],
  ["modern", { mode: { pin: "2026-07-28" } }],
];

const FORM = { elicitation: { form: {} } };
const TICKED: ElicitationAnswer = { action: "accept", content: { confirm: true } };
const DECLINED: ElicitationAnswer = { action: "decline" };
const DISMISSED: ElicitationAnswer = { action: "cancel" };
const UNTICKED: ElicitationAnswer = { action: "accept", content: { confirm: false } };

afterEach(closeSdkRigs);

const ALL_GATES = JSON.stringify({
  global: {
    "iris_audit_manage:purge": true,
    "iris_message_resend:resend": true,
    "iris_message_resend:resendFiltered": true,
    "iris_doc_edit:regenerateStorage": true,
    "iris_env_promote:execute": true,
  },
});

const RESEND_URL = "/api/executemcp/v2/interop/message/resend";
const CONTROL_URL = "/api/executemcp/v2/interop/production/control";
const AUDIT_URL = "/api/executemcp/v2/security/audit";

// -- the gates that bind their whole text ---------------------------------------------------------------------------------------------

interface WholeTextGate {
  id: string;
  pkg: string;
  tool: string;
  action: string;
  args: Record<string, unknown>;
  /** The one write that the accepted call makes. */
  write: string;
  /** The dialog's scope line. */
  scope: string;
}

const WHOLE_TEXT_GATES: WholeTextGate[] = [
  {
    id: "iris_message_resend:resend",
    pkg: "iris-interop-mcp",
    tool: "iris_message_resend",
    action: "resend",
    args: { action: "resend", headerIds: [11, 12] },
    write: `POST ${RESEND_URL} {"action":"resend","headerIds":[11,12],"namespace":"HSCUSTOM"}`,
    scope: "2 header ID(s): 11, 12",
  },
  {
    id: "iris_production_control:clean with killAppData",
    pkg: "iris-interop-mcp",
    tool: "iris_production_control",
    action: "clean",
    args: { action: "clean", killAppData: true, confirm: true },
    write: `POST ${CONTROL_URL} {"action":"clean","namespace":"HSCUSTOM","killAppData":true,"confirm":true}`,
    scope:
      "all Ens.AppData business state: HL7 sequence numbers, file and FTP done-file tables, batch and control-number state; " +
      "already-processed data can be ingested again",
  },
  {
    id: "iris_audit_manage:purge",
    pkg: "iris-admin-mcp",
    tool: "iris_audit_manage",
    action: "purge",
    args: { action: "purge", end: "2026-01-01 00:00:00", confirm: true },
    write: `POST ${AUDIT_URL} {"action":"purge","confirm":true,"end":"2026-01-01 00:00:00"}`,
    scope: "records matching end=2026-01-01 00:00:00",
  },
];

describe.each(ERAS)("Story 44.3 QA on the %s era: the gates that bind their whole text", (_era, negotiation) => {
  const open = (gate: WholeTextGate, answer: ElicitationAnswer): Promise<SdkRig> =>
    openSdkRig(gate.pkg, negotiation, { capabilities: FORM, governance: ALL_GATES, clientName: "story-44-3-qa", firstAnswer: answer });

  it.each(WHOLE_TEXT_GATES)(
    "$id: an accept asks once, writes once, and the entry says accepted",
    async (gate) => {
      const rig = await open(gate, TICKED);

      const exchange = await rig.call(gate.tool, gate.args);

      expect(exchange.asks).toHaveLength(1);
      expect(exchange.asks[0]?.message).toContain(`Scope: ${gate.scope}\n`);
      expect(exchange.result.isError).toBeUndefined();
      expect(exchange.writes).toEqual([gate.write]);
      expect(await rig.entries(1)).toEqual([expect.objectContaining({ tool: gate.tool, action: gate.action, outcome: "ok", confirmation: "accepted" })]);
    },
    60_000,
  );

  it.each(WHOLE_TEXT_GATES)(
    "$id: a decline writes nothing and leaves one denied entry",
    async (gate) => {
      const rig = await open(gate, DECLINED);

      const exchange = await rig.call(gate.tool, gate.args);

      expect(exchange.asks).toHaveLength(1);
      expect(exchange.result.isError).toBe(true);
      expect(exchange.result.structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: gate.action, response: "decline" });
      expect(exchange.writes).toEqual([]);
      expect(await rig.entries(1)).toEqual([
        expect.objectContaining({ tool: gate.tool, outcome: "denied", denyReason: "CONFIRMATION_DECLINED", confirmation: "declined" }),
      ]);
    },
    60_000,
  );
});

// -- iris_doc_edit:regenerateStorage --------------------------------------------------------------------------------------------------

/** What `Demo.Stored.cls` has on the source listener (the fake's own content), as the edit's `expected` text was written. */
const STORED = [
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

const REGEN_ARGS = { action: "regenerateStorage", name: "Demo.Stored.cls", edits: [STORAGE_EDIT] };
const REGEN_PUT = 'PUT /api/atelier/v8/HSCUSTOM/doc/Demo.Stored.cls {"enc":false,"content":["Class Demo.Stored Extends %Persistent","{","Property A As %String;","}"]}';

describe.each(ERAS)("Story 44.3 QA on the %s era: iris_doc_edit regenerateStorage binds the names it drops", (_era, negotiation) => {
  const open = (): Promise<SdkRig> => openSdkRig("iris-dev-mcp", negotiation, { capabilities: FORM, governance: ALL_GATES, clientName: "story-44-3-qa" });

  it(
    "an accept asks once and saves once; the entry says accepted",
    async () => {
      const rig = await open();
      rig.answer(TICKED);

      const exchange = await rig.call("iris_doc_edit", REGEN_ARGS);

      expect(exchange.asks).toHaveLength(1);
      expect(exchange.asks[0]?.message).toContain("Scope: 1 edit(s); drops Storage definition(s): Default\n");
      expect(exchange.result.isError).toBeUndefined();
      expect(exchange.writes).toEqual([REGEN_PUT]);
      expect(await rig.entries(1)).toEqual([expect.objectContaining({ tool: "iris_doc_edit", action: "regenerateStorage", outcome: "ok", confirmation: "accepted" })]);
    },
    60_000,
  );

  it(
    "a decline saves nothing and leaves one denied entry",
    async () => {
      const rig = await open();
      rig.answer(DECLINED);

      const exchange = await rig.call("iris_doc_edit", REGEN_ARGS);

      expect(exchange.result.structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: "regenerateStorage", response: "decline" });
      expect(exchange.writes).toEqual([]);
      expect(await rig.entries(1)).toEqual([expect.objectContaining({ outcome: "denied", denyReason: "CONFIRMATION_DECLINED", confirmation: "declined" })]);
    },
    60_000,
  );

  it(
    "a change of the document outside the edited lines drops the same names: one dialog, one save",
    async () => {
      const rig = await open();
      rig.answer((_request, index) => {
        if (index === 0) rig.setDocumentContent("default", "Demo.Stored.cls", STORED.map((line) => (line === "Property A As %String;" ? "Property B As %String;" : line)));
        return TICKED;
      });

      const exchange = await rig.call("iris_doc_edit", REGEN_ARGS);

      expect(exchange.asks).toHaveLength(1);
      expect(exchange.result.isError).toBeUndefined();
      expect(exchange.writes).toHaveLength(1);
      expect(exchange.writes[0]).toContain('"Property B As %String;"');
      expect(await rig.entries(1)).toEqual([expect.objectContaining({ outcome: "ok", confirmation: "accepted" })]);
    },
    60_000,
  );

  it(
    "a change inside the edited lines is refused by the handler before it asks again: STALE_CONTENT, no save, one entry, and no unanswered entry when the client closes",
    async () => {
      const rig = await open();
      rig.answer((_request, index) => {
        if (index === 0) rig.setDocumentContent("default", "Demo.Stored.cls", STORED.map((line) => (line.startsWith("<DataLocation>") ? "<DataLocation>^Demo.ChangedD</DataLocation>" : line)));
        return TICKED;
      });

      const exchange = await rig.call("iris_doc_edit", REGEN_ARGS);

      expect(exchange.asks).toHaveLength(1);
      expect(exchange.result.isError).toBe(true);
      expect(exchange.result.structuredContent).toMatchObject({ code: "STALE_CONTENT" });
      expect(exchange.writes).toEqual([]);
      const entries = await rig.entries(1);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ tool: "iris_doc_edit", action: "regenerateStorage", outcome: "error" });

      await rig.client.close();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const after = await rig.entries(1);
      expect(after.map((entry) => entry["confirmation"])).toEqual([undefined]);
    },
    60_000,
  );
});

// -- iris_env_promote: drops beyond the cut of the dialog -----------------------------------------------------------------------------

/** A class with no Storage definition: the source copy. */
const sourceClass = (name: string): string[] => [`Class ${name} Extends %RegisteredObject`, "{", "Method A()", "{", "}", "}"];

/** The same class with a Storage definition called `storage`: the target copy. */
const targetClass = (name: string, storage: string): string[] => [
  `Class ${name} Extends %RegisteredObject`,
  "{",
  "Method A()",
  "{",
  "}",
  `Storage ${storage}`,
  "{",
  "<Type>%Storage.Persistent</Type>",
  "}",
  "}",
];

describe.each(ERAS)("Story 44.3 QA on the %s era: a promotion binds every drop, including the ones the dialog does not show", (_era, negotiation) => {
  const executeAfterPlan = async (rig: SdkRig, diff: unknown, steps: number[]): Promise<Record<string, unknown>> => {
    const planned = await rig.call("iris_env_promote", { action: "plan", source: "default", target: "other", diff });
    expect(planned.result.isError).toBeUndefined();
    return { action: "execute", source: "default", target: "other", diff, plan: planned.result.structuredContent, steps, confirm: true, allowStorageRegeneration: true };
  };
  const open = (): Promise<SdkRig> =>
    openSdkRig("iris-dev-mcp", negotiation, { capabilities: FORM, governance: ALL_GATES, secondListener: true, clientName: "story-44-3-qa" });
  const names = (count: number): string[] => Array.from({ length: count }, (_unused, index) => `Demo.D${String(index + 1).padStart(2, "0")}.cls`);
  const puts = (rig: SdkRig): string[] => rig.otherWrites().filter((line) => line.startsWith("PUT "));

  it(
    "the twelfth drop changes while the dialog lists ten: the same text is asked again, and the target is written only after the second answer",
    async () => {
      const rig = await open();
      const documents = names(12);
      for (const name of documents) {
        rig.setDocumentContent("default", name, sourceClass(name.replace(".cls", "")));
        rig.setDocumentContent("other", name, targetClass(name.replace(".cls", ""), "Default"));
      }
      const args = await executeAfterPlan(rig, manyDocumentsDiff(12), Array.from({ length: 12 }, (_unused, index) => index + 1));
      const writesAtAsk: number[] = [];
      rig.answer((_request, index) => {
        writesAtAsk.push(puts(rig).length);
        if (index === 0) rig.setDocumentContent("other", documents[11] as string, targetClass("Demo.D12", "Changed"));
        return TICKED;
      });

      const exchange = await rig.call("iris_env_promote", args);

      expect(exchange.asks).toHaveLength(2);
      expect(exchange.asks[0]?.message).toContain("and 2 more");
      expect(exchange.asks[1]?.message).toBe(exchange.asks[0]?.message);
      expect(writesAtAsk).toEqual([0, 0]);
      // The fake saves only Demo.Sample.cls and Demo.Stored.cls: the first save of a Demo.Dnn.cls step is its 404 and the batch halts, so
      // the row pins that the write came after the second dialog (no save at either ask), not that all twelve saved.
      expect(puts(rig)).toHaveLength(1);
      expect(puts(rig)[0]).toContain("/doc/Demo.D01.cls");
    },
    120_000,
  );

  it(
    "the same twelve drops on both rounds ask once",
    async () => {
      const rig = await open();
      const documents = names(12);
      for (const name of documents) {
        rig.setDocumentContent("default", name, sourceClass(name.replace(".cls", "")));
        rig.setDocumentContent("other", name, targetClass(name.replace(".cls", ""), "Default"));
      }
      const args = await executeAfterPlan(rig, manyDocumentsDiff(12), Array.from({ length: 12 }, (_unused, index) => index + 1));
      rig.answer(TICKED);

      const exchange = await rig.call("iris_env_promote", args);

      expect(exchange.asks).toHaveLength(1);
      // The fake saves only Demo.Sample.cls and Demo.Stored.cls, so the first save of a Demo.Dnn.cls step is its 404 and the batch halts: the
      // row pins that the accepted call went on to write, after one dialog.
      expect(puts(rig)).toHaveLength(1);
      expect(puts(rig)[0]).toContain("/doc/Demo.D01.cls");
    },
    120_000,
  );

  it(
    "the tail of a Storage name longer than the dialog allows changes: asked again, written once, after the second answer",
    async () => {
      const rig = await open();
      const longName = "N".repeat(700);
      rig.setDocumentContent("default", "Demo.Sample.cls", sourceClass("Demo.Sample"));
      rig.setDocumentContent("other", "Demo.Sample.cls", targetClass("Demo.Sample", longName));
      const args = await executeAfterPlan(rig, PROMOTE_DIFF, [1]);
      const writesAtAsk: number[] = [];
      rig.answer((_request, index) => {
        writesAtAsk.push(puts(rig).length);
        if (index === 0) rig.setDocumentContent("other", "Demo.Sample.cls", targetClass("Demo.Sample", `${"N".repeat(699)}X`));
        return TICKED;
      });

      const exchange = await rig.call("iris_env_promote", args);

      expect(exchange.asks).toHaveLength(2);
      expect(writesAtAsk).toEqual([0, 0]);
      expect(exchange.result.isError).toBeUndefined();
      expect(puts(rig)).toHaveLength(1);
    },
    120_000,
  );

  it(
    "the bound is per logical call: after CONFIRMATION_SCOPE_CHANGED a new call asks again from no re-asks",
    async () => {
      const rig = await open();
      const args = await executeAfterPlan(rig, PROMOTE_DIFF, [1]);
      let counter = 0;
      rig.answer(() => {
        counter += 1;
        rig.setDocumentContent("other", "Demo.Sample.cls", targetClass("Demo.Sample", `Variant${counter}`));
        return TICKED;
      });

      const first = await rig.call("iris_env_promote", args);
      const second = await rig.call("iris_env_promote", args);

      expect(first.asks).toHaveLength(2);
      expect(first.result.structuredContent).toEqual({ code: "CONFIRMATION_SCOPE_CHANGED", action: "execute" });
      expect(second.asks).toHaveLength(2);
      expect(second.result.structuredContent).toEqual({ code: "CONFIRMATION_SCOPE_CHANGED", action: "execute" });
      expect(rig.otherWrites()).toEqual([]);
      const entries = await rig.entries(3);
      expect(entries.map((entry) => `${entry["outcome"]}:${entry["denyReason"] ?? ""}:${entry["confirmation"] ?? ""}`)).toEqual([
        "ok::",
        "denied:CONFIRMATION_SCOPE_CHANGED:accepted",
        "denied:CONFIRMATION_SCOPE_CHANGED:accepted",
      ]);
    },
    120_000,
  );
});

// -- resendFiltered: the other decline paths ------------------------------------------------------------------------------------------

describe.each(ERAS)("Story 44.3 QA on the %s era: a resendFiltered dialog that is not accepted sends no second preview", (_era, negotiation) => {
  const preview = `POST ${RESEND_URL} {"action":"resendFiltered","item":"Demo.Item","from":"${FROM}","namespace":"HSCUSTOM","dryRun":true}`;

  it.each([
    ["a dismissed dialog", DISMISSED, "cancel", "cancelled"],
    ["an accept without the tick", UNTICKED, "unconfirmed", "unconfirmed"],
  ])(
    "%s: CONFIRMATION_DECLINED, one preview, no execute, one denied entry",
    async (_label, answer, response, recorded) => {
      const rig = await openSdkRig("iris-interop-mcp", negotiation, { capabilities: FORM, governance: ALL_GATES, clientName: "story-44-3-qa", firstAnswer: answer });

      const exchange = await rig.call("iris_message_resend", { action: "resendFiltered", item: "Demo.Item", from: FROM, dryRun: false, confirm: true });

      expect(exchange.asks).toHaveLength(1);
      expect(exchange.result.structuredContent).toMatchObject({ code: "CONFIRMATION_DECLINED", response });
      expect(exchange.writes).toEqual([preview]);
      expect(await rig.entries(1)).toEqual([expect.objectContaining({ outcome: "denied", denyReason: "CONFIRMATION_DECLINED", confirmation: recorded })]);
    },
    60_000,
  );
});
