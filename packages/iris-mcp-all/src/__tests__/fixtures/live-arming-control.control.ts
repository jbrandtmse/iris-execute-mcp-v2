/**
 * The control of `live-arming-guard.test.ts`: one test that makes one connect to a stand-in listener from the test
 * worker, and one from a child process started with `inheritedEnv()` (the environment every gate hands the servers it
 * starts), and reports whether each was reached or refused. It is not a `*.test.ts` file, so no suite picks it up; the
 * guard runs it in a child vitest with a config that names it, once under the connection-refusing preload and once
 * without it.
 */

import { spawnSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { inheritedEnv } from "../process-gate-helpers.js";

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

  it("connects once from a child started with inheritedEnv() to the second stand-in listener and reports the outcome", () => {
    const standIn = process.env["LIVE_ARMING_CONTROL_CHILD_PORT"] ?? "";
    expect(standIn, "the guard names the second stand-in listener's port").not.toBe("");

    const script =
      `fetch("http://127.0.0.1:${Number(standIn)}/", { signal: AbortSignal.timeout(10000) })` +
      `.then(() => console.log("reached"), () => console.log("refused"));`;
    const child = spawnSync(process.execPath, ["-e", script], { env: inheritedEnv(), encoding: "utf8", timeout: 20000 });

    console.error(`LIVE_ARMING_CONTROL child ${child.stdout.trim() || `no-outcome ${child.stderr.trim()}`}`);
  });
});
