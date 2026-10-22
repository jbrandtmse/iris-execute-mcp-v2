/**
 * Story 42.2, AC 42.2.5 -- the live gate of the bootstrap downgrade guard, run against a THROWAWAY IRIS container.
 * `pnpm live:bootstrap-guard` runs it through `scripts/throwaway-iris.mjs`, which starts a labelled container on a dynamic
 * loopback port, sets the arming and target variables and `IRIS_THROWAWAY=<container name>`, and removes the container on
 * every exit. Only that script runs this gate: Story 42.3's CI job, or the Lead on a development machine when authorized
 * (wave-8 decisions #49 and #55).
 *
 * It runs the SAME legs as `story-42-2-bootstrap-guard-orchestration.test.ts` (`bootstrap-guard-legs.ts`), against the real
 * instance instead of the fake: each leg seeds the embed under a chosen marker, starts a fresh BUILT `iris-dev-mcp`,
 * and compares the instance before and after. Newer and foreign legs (including the lazy `other` profile of DW-518) must
 * leave every document's content and `ts` and the compiled marker byte-identical and print one warning; older and legacy
 * legs must end with every document equal to a clean deployment of the embed; a second start after an upgrade changes nothing.
 *
 * ARMING. The gate skips, before any probe, spawn or request, unless `IRIS_THROWAWAY` is set. It is armed only through the
 * harness: a set `IRIS_THROWAWAY` without `IRIS_REQUIRE_LIVE` is a misconfiguration and throws, and an armed run with one
 * of `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD` or `IRIS_NAMESPACE` missing throws, naming it. The file is on
 * no prepublish roster: a roster run targets an instance that may hold the classes, which this gate refuses.
 *
 * FAIL CLOSED, before any write: the port is not 52773 or 1972; the host is 127.0.0.1; `docker inspect $IRIS_THROWAWAY`
 * (the only docker call, and only here) shows a running container of that name that publishes that port on the loopback
 * address and carries the label `iris-mcp.owner=throwaway`; a plain query answers and the version query FAILS (no
 * ExecuteMCPv2 classes are deployed: an instance that holds them is not a throwaway); and the shared and dev dists are fresh
 * (armed, a stale dist fails instead of skipping). The first seed compile shows whether the classes compile in plain-IRIS
 * `USER`; a compile error fails the gate with the compile errors in its message.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { irisTargetFromEnv, resolveSdkEsmDir, skipTest, staleDistReason, type IrisTarget } from "./process-gate-helpers.js";
import {
  LEGS,
  SeedCompileError,
  assertNoExecuteMcpClasses,
  loadEmbedded,
  referenceSnapshot,
  runLeg,
  throwawayGatePlan,
  verifyLeg,
  type EmbeddedBootstrap,
  type Snapshot,
} from "./bootstrap-guard-legs.js";
import {
  LOOPBACK_HOST,
  assertThrowawayInspect,
  validateContainerName,
  validateHostPort,
} from "../../../../scripts/throwaway-iris.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-42-2-bootstrap-guard-live-gate";
/** The first seed compiles every embedded class once; a leg adds a seed, a server start and snapshots on top. */
const SETUP_TIMEOUT_MS = 900_000;
const LEG_TIMEOUT_MS = 600_000;

const PLAN = throwawayGatePlan(process.env);

let target: IrisTarget;
let sdkEsmDir: string;
let embedded: EmbeddedBootstrap;
let reference: Snapshot;

/** The container's `docker inspect` as parsed JSON. This is the gate's only docker call. */
function inspectContainer(name: string): unknown {
  const inspected = spawnSync("docker", ["inspect", name], { encoding: "utf8", timeout: 30_000 });
  if (inspected.status !== 0) {
    throw new Error(`docker inspect ${name} failed (${inspected.error?.message ?? `exit ${inspected.status}`}): ${inspected.stderr.trim()}`);
  }
  return JSON.parse(inspected.stdout) as unknown;
}

beforeAll(async () => {
  if (!PLAN.run) return;

  // Armed: all five target variables are required (a missing one throws, naming it).
  target = irisTargetFromEnv();
  validateHostPort(target.port);
  if (target.host !== LOOPBACK_HOST) {
    throw new Error(`the throwaway gate only targets ${LOOPBACK_HOST}, not ${target.host}.`);
  }
  validateContainerName(PLAN.container);

  const stale = staleDistReason(REPO_ROOT, "shared") ?? staleDistReason(REPO_ROOT, "iris-dev-mcp");
  if (stale !== undefined) throw new Error(`The throwaway gate runs the built iris-dev-mcp and shared dists, and a stale dist fails it: ${stale}`);
  const found = resolveSdkEsmDir(REPO_ROOT);
  if (found === undefined) {
    throw new Error("Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm; run pnpm install from the repo root.");
  }
  sdkEsmDir = found;

  assertThrowawayInspect(inspectContainer(PLAN.container), { name: PLAN.container, port: target.port });
  await assertNoExecuteMcpClasses(target);

  // The first write of the gate: the reference deployment, whose compile is also the plain-IRIS compile probe.
  embedded = await loadEmbedded(REPO_ROOT);
  try {
    reference = await referenceSnapshot(target, embedded);
  } catch (error) {
    if (error instanceof SeedCompileError) {
      throw new Error(
        `The ${embedded.classes.size} ExecuteMCPv2 classes did not compile in ${target.namespace} on the throwaway container: ${error.message}`,
      );
    }
    throw error;
  }
}, SETUP_TIMEOUT_MS);

describe("Story 42.2 AC 42.2.5: the bootstrap guard on a throwaway IRIS container", () => {
  for (const leg of LEGS) {
    it(
      `${leg.id}: ${leg.title}`,
      async (testCtx) => {
        if (!PLAN.run) {
          skipTest(GATE_TAG, PLAN.reason, testCtx);
          return;
        }
        const outcome = await runLeg(leg, { repoRoot: REPO_ROOT, sdkEsmDir, target, embedded, reference });

        expect(verifyLeg(outcome, embedded, reference)).toEqual([]);
      },
      LEG_TIMEOUT_MS,
    );
  }
});
