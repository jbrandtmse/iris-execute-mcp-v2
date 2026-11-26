/**
 * Story 45.5 QA (Rules #19, #21, #59; decision #166) - the armed leg of `epic45-capstone-gate.test.ts` keeps its contract on its own
 * real path: unarmed it skips before any request, armed against a target that is not throwaway-shaped it throws before any write, and
 * armed against a throwaway-shaped target that nothing listens on it fails instead of skipping.
 *
 * The capstone's own "arming contract" test only restates the helper's logic (`LIVE.skipReason === undefined` equals the arming
 * variable). This file runs the capstone's armed leg (`-t "LP-armed"`) in a child `vitest run` of its own, under the connection-refusing
 * preload (`scripts/lib/no-live-iris-preload.mjs`) with a target at a local port nothing listens on, and reads what the child did:
 *
 *  - UNARMED (the five target variables, no arming variable): exit 0, no failed suite, and the preload logged NO connect, so the leg
 *    skipped before any request;
 *  - ARMED, NOT THROWAWAY-SHAPED (no `IRIS_THROWAWAY`; a throwaway name with the shared instance's port 52773; a throwaway name with a
 *    host other than 127.0.0.1): exit non-zero, the failure says the leg may not be skipped and names what is wrong, and the preload
 *    logged NO connect, so it threw before any request and so before any write (the leg creates nothing until a request is sent);
 *  - ARMED, THROWAWAY-SHAPED, NOTHING LISTENING (the negative twin): exit non-zero and the preload DID log the connect to the closed port.
 *    The twin makes the two oracles above able to vary: the shape check is what stops the first three, and a run that gets past it
 *    would show a connect.
 *
 * MUTATIONS: in `epic45-capstone-gate.test.ts`, (a) make the armed `beforeAll` not return when
 * unarmed, and (b) delete the `throwawayEnvProblems` check. (a) turns the unarmed run red (the leg runs unarmed and throws); (b) turns the
 * three shape cases red (a connect to the closed port is logged and the failure no longer names the harness). Path: the capstone's real
 * `beforeAll`, executed by a real vitest process.
 *
 * No IRIS and no docker: the preload refuses every connect to the watched ports, 52773 and 1972 included. This file never reads the
 * arming variable of the parent run, and it does not itself reach IRIS (it is not a live-capable file).
 */

import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runVitestUnderPreload, type PreloadedRun } from "./live-gate-child-run.js";
import { reserveClosedPort } from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(__dirname, "..", "..");

const CAPSTONE = "src/__tests__/epic45-capstone-gate.test.ts";
const CHILD_TIMEOUT_MS = 90_000;
/** A name of the shape `scripts/throwaway-iris.mjs` generates (`iris-mcp-throwaway-` plus 12 hex digits). */
const THROWAWAY_SHAPED = "iris-mcp-throwaway-0123456789ab";

/** The five target variables a child gets, at `port`, with `extra` added. */
const target = (port: string, extra: Record<string, string>): Record<string, string> => ({
  IRIS_HOST: "127.0.0.1",
  IRIS_PORT: port,
  IRIS_USERNAME: "qa-45-5",
  IRIS_PASSWORD: "qa-45-5-never-used",
  IRIS_NAMESPACE: "QAARMING",
  IRIS_HTTPS: "false",
  ...extra,
});

/** Run the capstone's armed leg only, in its own vitest process, with the preload watching `port`. */
function runArmedLeg(env: Record<string, string>, port: string): Promise<PreloadedRun> {
  return runVitestUnderPreload({ packageDir: PACKAGE_DIR, args: [CAPSTONE, "-t", "LP-armed"], env, watchPorts: [port], timeoutMs: CHILD_TIMEOUT_MS });
}

/** The connects the preload logged to `port`. */
const connectsTo = (run: PreloadedRun, port: string): string[] => run.connects.filter((line) => line.endsWith(`:${port}`));

describe("Story 45.5 QA: the capstone's armed leg keeps its arming contract on its own path", () => {
  it(
    "unarmed (the target set, no arming variable): the leg skips, the child exits 0, and no connect is attempted",
    async () => {
      const port = await reserveClosedPort();
      const run = await runArmedLeg(target(port, {}), port);
      expect(run.status, run.output).toBe(0);
      expect(run.connects, "unarmed: no request of any kind").toEqual([]);
      expect(run.output).not.toMatch(/\bFAIL\b|may not be skipped/);
    },
    CHILD_TIMEOUT_MS + 30_000,
  );

  const SHAPE_CASES: Array<{ name: string; env: (port: string) => Record<string, string>; says: RegExp }> = [
    {
      name: "armed, no IRIS_THROWAWAY",
      env: (port) => target(port, { IRIS_REQUIRE_LIVE: "1" }),
      says: /IRIS_THROWAWAY/,
    },
    {
      name: "armed, a throwaway name but the shared instance's port 52773",
      env: () => target("52773", { IRIS_REQUIRE_LIVE: "1", IRIS_THROWAWAY: THROWAWAY_SHAPED }),
      says: /52773/,
    },
    {
      name: "armed, a throwaway name but a host that is not 127.0.0.1",
      env: (port) => target(port, { IRIS_REQUIRE_LIVE: "1", IRIS_THROWAWAY: THROWAWAY_SHAPED, IRIS_HOST: "localhost" }),
      says: /IRIS_HOST/,
    },
  ];

  for (const shape of SHAPE_CASES) {
    it(
      `${shape.name}: the leg throws (it does not skip) naming the harness, and no connect is attempted before it throws`,
      async () => {
        const port = await reserveClosedPort();
        const run = await runArmedLeg(shape.env(port), port);
        expect(run.status, "the armed leg fails the child").not.toBe(0);
        expect(run.output).toContain("may not be skipped");
        expect(run.output).toContain("scripts/throwaway-iris.mjs");
        expect(run.output).toMatch(shape.says);
        // Before any request: nothing reached the closed port, the shared instance's ports or any other watched port.
        expect(run.connects, "armed but not throwaway-shaped: refused before any request").toEqual([]);
      },
      CHILD_TIMEOUT_MS + 30_000,
    );
  }

  it(
    "the negative twin: armed, throwaway-shaped, nothing listening: the leg FAILS (never skips) and the connect to the closed port is logged",
    async () => {
      const port = await reserveClosedPort();
      const run = await runArmedLeg(target(port, { IRIS_REQUIRE_LIVE: "1", IRIS_THROWAWAY: THROWAWAY_SHAPED }), port);
      expect(run.status, "an unreachable armed target fails the child").not.toBe(0);
      // It got past the shape check: the harness refusal is not what stopped it, and the oracle above can see a connect.
      expect(run.output).not.toContain("so it runs only against a throwaway IRIS");
      expect(connectsTo(run, port).length, "the first request went to the closed port").toBeGreaterThan(0);
    },
    CHILD_TIMEOUT_MS + 30_000,
  );
});
