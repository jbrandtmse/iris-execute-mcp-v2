/**
 * Story 44.3 QA (AC 44.3.2; AD-19, AD-34; Rules #19, #36, #54, #59) - the audit ledger of a call that is asked again, on both eras, with
 * hand-written JSON-RPC lines and no SDK client, against the BUILT dev server and the fake IRIS listeners (127.0.0.1; no IRIS instance).
 *
 * Rows:
 *  - a call that is asked again and then left unanswered ends, when the process stops, as exactly ONE `unanswered` entry: the ask the
 *    re-ask replaced is gone from the pending map, so no second entry follows;
 *  - a re-asked call whose person then declines ends as one `denied` entry, and the stop of the process adds none (the answer used both
 *    nonces);
 *  - (modern) the state of a call, echoed on a request whose arguments name a profile the server does not have, is not the call's state:
 *    the request is refused before any handler runs and the abandoned ask ends as its own `unanswered` entry. The abandoned ask is a call
 *    of its own (other arguments, other hash), so the two entries are two logical calls, not one call with two entries. This pins the
 *    residual that the build named ("a round that ends before the handler runs leaves its pending ask until the TTL sweep"): the only
 *    way a client can end a round before the handler runs while echoing a state is to change the arguments, and then the state is not
 *    that call's;
 *  - a deciding round whose tool throws before it reaches the dialog (`regenerateStorage`, the document read answers HTTP 500) is one
 *    `error` entry, and the stop of the process adds no `unanswered` entry (the release of the echoed ask runs on the throw path too);
 *  - a `resendFiltered` whose preview fails on the round that carries the accept is one `error` entry with `confirmation: "accepted"`,
 *    and the stop of the process adds no `unanswered` entry (the accept used the nonce and removed its ask before the preview ran).
 * The file fails, never skips, on a stale dist.
 */

import { afterEach, describe, expect, it } from "vitest";
import { resultOf, type Json } from "./story-43-2-qa-hand-wire";
import { FROM, PROMOTE_DIFF, STORAGE_EDIT, promoteArgs } from "./story-43-3-qa-gates";
import {
  DECLINED,
  ELICITING,
  ERAS,
  TICKED,
  UNANSWERED_TEXT,
  connect,
  openRig,
  plainResult,
  requireFreshDists,
  sampleWithStorage,
  stopAllRigs,
  type Conn,
  type Era,
  type GateRig,
} from "./story-43-3-qa-wire";

requireFreshDists("iris-dev-mcp", "iris-interop-mcp");

afterEach(stopAllRigs);

const TIMEOUT = 60_000;
const TOOL = "iris_env_promote";
const NAME = "Demo.Sample.cls";

/** A connection on `era` to a fresh dev server, and the arguments of a real plan's execute. */
async function open(era: Era): Promise<{ rig: GateRig; conn: Conn; args: Json }> {
  const rig = await openRig({ pkg: "iris-dev-mcp" });
  const conn = await connect(rig, era, ELICITING);
  const args = await promoteArgs(conn, PROMOTE_DIFF, { allowStorageRegeneration: true });
  return { rig, conn, args };
}

/**
 * Drive the call to its second dialog: the person ticks the first dialog, the target gains a Storage definition meanwhile, and the server
 * asks again. Resolves with a function that answers the second dialog and resolves with the line that ends the call.
 */
async function reAsked(era: Era, conn: Conn, rig: GateRig, args: Json): Promise<(answer: Json) => Promise<Json>> {
  const call = conn.call(TOOL, args);
  const first = await call.ask();
  rig.setDocumentContent("b", NAME, sampleWithStorage("Default"));
  if (era === "legacy") {
    // The call's own response is awaited by the answer of the second dialog; when nobody answers it the process stops first.
    first.send(TICKED).response.catch(() => undefined);
    const second = await call.ask();
    expect(second.message).toContain("drops Storage definitions: Demo.Sample.cls ('Default')");
    return async (answer) => (await second.answer(answer)).message;
  }
  const again = await first.answer(TICKED);
  expect(again.message?.result?.resultType).toBe("input_required");
  const state = resultOf(again).requestState as string;
  return async (answer) => (await conn.callWith(TOOL, args, { inputResponses: { confirm: answer }, requestState: state })).message;
}

describe.each(ERAS.map((era) => [era] as const))("Story 44.3 QA on the %s era: one entry for a call that is asked again", (era) => {
  it(
    "a re-asked dialog nobody answers ends, when the process stops, as one unanswered entry",
    async () => {
      const { rig, conn, args } = await open(era);
      await reAsked(era, conn, rig, args);
      await rig.wire.quiet(250);

      rig.wire.endInput();
      await rig.wire.exit();

      expect(rig.writes("b")).toEqual([]);
      const entries = await rig.entries(2);
      expect(entries.map((entry) => `${entry.action}:${entry.outcome}:${entry.confirmation ?? ""}`)).toEqual(["plan:ok:", "execute:error:unanswered"]);
      expect(entries.at(-1)?.error).toBe(UNANSWERED_TEXT);
    },
    TIMEOUT,
  );

  it(
    "a re-asked dialog the person declines ends as one denied entry, and the stop of the process adds none",
    async () => {
      const { rig, conn, args } = await open(era);
      const answerSecond = await reAsked(era, conn, rig, args);

      const end = await answerSecond(DECLINED);

      expect(plainResult(end.result).structuredContent).toEqual({ code: "CONFIRMATION_DECLINED", action: "execute", response: "decline" });
      rig.wire.endInput();
      await rig.wire.exit();
      expect(rig.writes("b")).toEqual([]);
      const entries = await rig.entries(2);
      expect(entries.map((entry) => `${entry.action}:${entry.outcome}:${entry.confirmation ?? ""}`)).toEqual(["plan:ok:", "execute:denied:declined"]);
    },
    TIMEOUT,
  );
});

/** The entries of the audit file as `action:outcome:confirmation`. */
const shapes = (entries: Json[]): string[] => entries.map((entry) => `${entry.action}:${entry.outcome}:${entry.confirmation ?? ""}`);

describe.each(ERAS.map((era) => [era] as const))("Story 44.3 review on the %s era: a deciding round that ends in an error is one entry", (era) => {
  it(
    "a deciding round whose tool throws before the dialog (the document read fails) is one error entry, and the stop adds none",
    async () => {
      const rig = await openRig({ pkg: "iris-dev-mcp" });
      const conn = await connect(rig, era, ELICITING);
      const first = await conn.call("iris_doc_edit", { action: "regenerateStorage", name: "Demo.Stored.cls", edits: [STORAGE_EDIT] }).ask();
      rig.setDocumentFailure("a", "Demo.Stored.cls", true);

      const end = await first.answer(TICKED);

      expect(plainResult(resultOf(end)).isError).toBe(true);
      expect(rig.writes("a")).toEqual([]);
      rig.wire.endInput();
      await rig.wire.exit();
      expect(shapes(await rig.entries(1))).toEqual(["regenerateStorage:error:"]);
    },
    TIMEOUT,
  );

  it(
    "a resendFiltered whose preview fails on the round that carries the accept is one error entry, and the stop adds none",
    async () => {
      const rig = await openRig({ pkg: "iris-interop-mcp" });
      const conn = await connect(rig, era, ELICITING);
      const first = await conn.call("iris_message_resend", { action: "resendFiltered", item: "Demo.Item", from: FROM, dryRun: false, confirm: true }).ask();
      rig.setResendPreview("a", "Demo.Item", { failPreview: true });

      const end = await first.answer(TICKED);

      expect(plainResult(resultOf(end)).isError).toBe(true);
      expect(rig.writes("a").filter((line) => line.includes('"dryRun":false'))).toEqual([]);
      rig.wire.endInput();
      await rig.wire.exit();
      expect(shapes(await rig.entries(1))).toEqual(["resendFiltered:error:accepted"]);
    },
    TIMEOUT,
  );
});

describe("Story 44.3 QA on the modern era: a state echoed on a request that ends before the handler runs", () => {
  it(
    "a request that names an unknown profile is refused whatever state it echoes; the abandoned ask is its own unanswered entry",
    async () => {
      const { rig, conn, args } = await open("modern");
      const ask = await conn.call(TOOL, args).ask();

      const refused = await conn.callWith(TOOL, { ...args, server: "nowhere" }, { inputResponses: { confirm: TICKED }, requestState: ask.state });

      const result = plainResult(resultOf(refused));
      expect(result.isError).toBe(true);
      expect(rig.writes("b")).toEqual([]);
      rig.wire.endInput();
      await rig.wire.exit();
      const entries = await rig.entries(3);
      expect(entries.map((entry) => `${entry.action}:${entry.outcome}:${entry.confirmation ?? ""}`).sort()).toEqual([
        "execute:error:",
        "execute:error:unanswered",
        "plan:ok:",
      ]);
    },
    TIMEOUT,
  );
});
