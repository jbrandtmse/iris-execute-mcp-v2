/**
 * The control of `live-arming-guard.test.ts`: one test that makes one connect to a stand-in listener and reports
 * whether it was reached or refused. It is not a `*.test.ts` file, so no suite picks it up; the guard runs it in a
 * child vitest with a config that names it, once under the connection-refusing preload and once without it.
 */

import { describe, it, expect } from "vitest";

describe("live-arming control", () => {
  it("connects once to the stand-in listener and reports the outcome", async () => {
    const standIn = process.env["LIVE_ARMING_CONTROL_PORT"] ?? "";
    expect(standIn, "the guard names the stand-in listener's port").not.toBe("");

    const outcome = await fetch(`http://127.0.0.1:${standIn}/`, { signal: AbortSignal.timeout(10000) }).then(
      () => "reached",
      () => "refused",
    );

    console.error(`LIVE_ARMING_CONTROL ${outcome}`);
  });
});
