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
 *
 * Story 44.4 adds the block "the compile check on a throwaway" after the legs: L1 compiles a good class, a class that does not
 * compile and a persistent class whose Storage the compile writes, and expects `compileAndVerify` to name only the broken
 * one; L2 starts the dev server on an instance whose web application is absent while a roster class does not compile, and
 * expects the stderr warning to name the class and nothing to be registered; L3 starts it on a current instance that an
 * earlier compile left with a failed class and expects the same warning. Each test seeds and removes its own state.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atelierQuery, executeMcpPost, irisTargetFromEnv, resolveSdkEsmDir, skipTest, staleDistReason, type IrisTarget } from "./process-gate-helpers.js";
import { compileAndVerify } from "../../../shared/src/bootstrap.js";
import { IrisApiError } from "../../../shared/src/errors.js";
import { IrisHttpClient } from "../../../shared/src/http-client.js";
import { atelierPath } from "../../../shared/src/atelier.js";
import {
  LEGS,
  SeedCompileError,
  assertNoExecuteMcpClasses,
  loadEmbedded,
  referenceSnapshot,
  runLeg,
  runServer,
  seedInstance,
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

/** The Atelier API version of this block's requests (the seed's own). */
const ATELIER_VERSION = 8;
/** A statement that is a method body with a macro IRIS does not define: the class compiles to an error. */
const BROKEN_METHOD = ["ClassMethod Story444Broken() As %String", "{", "    Quit $$$NoSuchMacro444", "}"];
const HEALTH_DOC = "ExecuteMCPv2.REST.Health.cls";
const IS_CONFIGURED = "SELECT ExecuteMCPv2.Setup_IsConfigured() AS Configured";

describe("Story 44.4: the compile check on a throwaway", () => {
  /** A client for the throwaway, which the block closes. */
  function liveClient(): IrisHttpClient {
    return new IrisHttpClient({
      host: target.host,
      port: Number(target.port),
      username: target.username,
      password: target.password,
      namespace: target.namespace,
      https: false,
      baseUrl: `http://${target.host}:${target.port}`,
      timeout: 300_000,
    });
  }

  const docPath = (name: string): string => atelierPath(ATELIER_VERSION, target.namespace, `doc/${encodeURIComponent(name)}`);

  async function putDocument(http: IrisHttpClient, name: string, text: string): Promise<void> {
    await http.put(`${docPath(name)}?ignoreConflict=1`, { enc: false, content: text.split("\n") });
  }

  async function removeDocument(http: IrisHttpClient, name: string): Promise<void> {
    try {
      await http.delete(docPath(name));
    } catch (error) {
      if (!(error instanceof IrisApiError && error.statusCode === 404)) throw error;
    }
  }

  /** The embedded Health class with one appended method whose body uses an undefined macro. */
  function brokenHealth(): string {
    const text = embedded.classes.get(HEALTH_DOC) as string;
    const end = text.lastIndexOf("}");
    return `${text.slice(0, end)}${BROKEN_METHOD.join("\n")}\n${text.slice(end)}`;
  }

  async function isConfigured(): Promise<boolean> {
    const rows = await atelierQuery(target, IS_CONFIGURED);
    const flag = String(rows[0]?.["Configured"] ?? "0").toLowerCase();
    return flag === "1" || flag === "true";
  }

  /** The embed, current and configured, as it was before the block's own changes. */
  const reseed = (): Promise<void> => seedInstance(target, embedded, { marker: embedded.marker, perturb: false });

  it(
    "L1: compileAndVerify names the class that does not compile when the same compile writes another class's Storage (HTTP 200, no status error)",
    async (testCtx) => {
      if (!PLAN.run) {
        skipTest(GATE_TAG, PLAN.reason, testCtx);
        return;
      }
      const http = liveClient();
      const names = ["ExecuteMCPv2.Temp.Story444Good.cls", "ExecuteMCPv2.Temp.Story444Broken.cls", "ExecuteMCPv2.Temp.Story444Store.cls"];
      try {
        await putDocument(http, names[0] as string, ["Class ExecuteMCPv2.Temp.Story444Good Extends %RegisteredObject", "{", "ClassMethod Hi() As %String", "{", '    Quit "hi"', "}", "}"].join("\n"));
        await putDocument(
          http,
          names[1] as string,
          ["Class ExecuteMCPv2.Temp.Story444Broken Extends %RegisteredObject", "{", "ClassMethod Hi() As %String", "{", "    Quit $$$NoSuchMacro444", "}", "}"].join("\n"),
        );
        // A %Persistent class with no Storage section: compiling it writes the Storage, which is what replaces the compile status.
        await putDocument(http, names[2] as string, ["Class ExecuteMCPv2.Temp.Story444Store Extends %Persistent", "{", "Property Name As %String;", "}"].join("\n"));

        const report = await compileAndVerify(http, { namespace: target.namespace }, ATELIER_VERSION, names);

        expect(report.notCompiled).toEqual(["ExecuteMCPv2.Temp.Story444Broken.cls"]);
        expect(report.irisErrors, "IRIS answered without a status error: the failure is only in the console").toEqual([]);
        const content = (report.envelope?.result as { content?: Array<{ name?: string }> } | undefined)?.content ?? [];
        expect(content.map((entry) => entry.name).join(" "), "the answer names the class whose Storage was written").toContain("Story444Store");
      } finally {
        for (const name of names) await removeDocument(http, name);
        http.destroy();
      }
    },
    LEG_TIMEOUT_MS,
  );

  it(
    "L2: a dev server that starts on an instance whose web application is absent and a roster class does not compile names that class and registers nothing",
    async (testCtx) => {
      if (!PLAN.run) {
        skipTest(GATE_TAG, PLAN.reason, testCtx);
        return;
      }
      const http = liveClient();
      try {
        await reseed();
        const deleted = await executeMcpPost(target, "/security/webapp", { action: "delete", name: "/api/executemcp/v2" });
        expect(deleted.status, deleted.text).toBe(200);
        expect(await isConfigured(), "the web application is gone").toBe(false);
        await putDocument(http, HEALTH_DOC, brokenHealth());

        const stderr = await runServer("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target });

        expect(stderr).toContain(`Compile failed: 1 of ${embedded.classes.size} classes did not compile: ExecuteMCPv2.REST.Health`);
        expect(await isConfigured(), "a failed compile stops before the web application is registered").toBe(false);
      } finally {
        http.destroy();
        await reseed();
      }
    },
    LEG_TIMEOUT_MS,
  );

  it(
    "L3 (AC 44.4.7): a start that finds the classes current reports a class that an earlier compile left failed, by name",
    async (testCtx) => {
      if (!PLAN.run) {
        skipTest(GATE_TAG, PLAN.reason, testCtx);
        return;
      }
      const http = liveClient();
      try {
        await reseed();
        await putDocument(http, HEALTH_DOC, brokenHealth());
        // The compile that fails: the earlier start's work. It answers with a status error (a thrown IrisApiError); what it leaves is the oracle.
        await compileAndVerify(http, { namespace: target.namespace }, ATELIER_VERSION, [HEALTH_DOC]);

        const stderr = await runServer("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target });

        expect(stderr).toContain(`Compile failed: 1 of ${embedded.classes.size} classes did not compile: ExecuteMCPv2.REST.Health`);
        expect(stderr, "the probe found the classes current").not.toContain("running full install");
        expect(await isConfigured(), "the web application is still registered").toBe(true);
      } finally {
        http.destroy();
        await reseed();
      }
    },
    LEG_TIMEOUT_MS,
  );
});
