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
 *    that call's.
 * The file fails, never skips, on a stale dist.
 */

import { afterEach, describe, expect, it } from "vitest";
import { resultOf, type Json } from "./story-43-2-qa-hand-wire";
import { PROMOTE_DIFF, promoteArgs } from "./story-43-3-qa-gates";
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
  stopAllRigs,
  type Conn,
  type Era,
  type GateRig,
} from "./story-43-3-qa-wire";

requireFreshDists("iris-dev-mcp");

afterEach(stopAllRigs);

const TIMEOUT = 60_000;
const TOOL = "iris_env_promote";
const NAME = "Demo.Sample.cls";

/** The target copy of the promoted class once it has gained a Storage definition called `name`. */
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
  rig.setDocumentContent("b", NAME, withStorage("Default"));
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
