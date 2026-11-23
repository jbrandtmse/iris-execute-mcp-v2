/**
 * Story 44.4 (DW-685) -- the compile check, against the BUILT `@iris-mcp/shared` dist and the stateful fake Atelier.
 *
 * `bootstrap()` used to call a compile "compiled" when `POST action/compile` did not throw. The planning probe (live, IRIS
 * 2026.2 Build 221U and 2026.1 Build 234U, 2026-11-23) showed that a compile which also writes a class's Storage answers HTTP
 * 200 with no status error, so a failed class went unreported; and that a thrown status names at most one failed class. The
 * check is two Atelier reads after the compile (the dictionary join and `docnames` `upd`), and no localized text decides.
 *
 * - THE ORACLE. Each clean-compile `BootstrapResult` below is the capture of the pre-story build (baseline revision
 *   b2184e1d6bc4e3a2f71908ae811ee6bbeb398cd8, the built shared dist before any source edit) against this fake, taken with a
 *   disposable test that ran `bootstrap(http, config, 8)` on each branch after seeding it with `seedInstance` (`missing`: an
 *   empty fake; `stale`: the older-sequence leg's marker, perturbed; `unconfigured`: the embedded marker with the web
 *   application removed; `current`: the embedded marker). The request counts are the fake's non-HEAD requests of that run
 *   (44, 42, 9 and 2); the check adds exactly two.
 * - THE FAILURE ROWS. The fake answers the probe's captured shapes (`compileFailure`): the Storage-written partial failure
 *   (HTTP 200, no status error, the class only in the console), the single status error, the all-fail case, and the de-DE and
 *   ja-JP consoles. The Storage-written row is the red row: against the baseline dist `compiled` is true.
 *
 * Needs no IRIS and no docker; it requires a fresh `@iris-mcp/shared` dist and FAILS (never skips) without one.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type * as Shared from "../../../shared/src/index.js";
import type { IrisConnectionConfig } from "../../../shared/src/config.js";
import { staleDistReason } from "./process-gate-helpers.js";
import { LEGS, SeedCompileError, loadEmbedded, seedInstance, stampedEmbedded, type EmbeddedBootstrap } from "./bootstrap-guard-legs.js";
import {
  COMPILE_CONSOLE_DE,
  COMPILE_CONSOLE_JA,
  isCompileCheckQuery,
  startStatefulFakeAtelier,
  summarizeRequests,
  type FakeCompileFailure,
  type FakeRequest,
  type StatefulFakeAtelier,
} from "./stateful-fake-atelier.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const NAMESPACE = "USER";
const ATELIER_VERSION = 8;
const TEST_TIMEOUT_MS = 60_000;

const HEALTH = "ExecuteMCPv2.REST.Health.cls";
const BASE = "ExecuteMCPv2.REST.Base.cls";
const PRIVILEGED = /Setup_(Configure|ConfigureMapping|EnsureUnitTestRoot)\(/;

type Branch = "missing" | "stale" | "unconfigured" | "current";
const WRITING_BRANCHES: readonly Branch[] = ["missing", "stale", "unconfigured"];

/** The pre-story captures of a clean compile (see the header). `stale` carries `deployedVersion` of the seeded marker. */
const BASELINE: Record<Branch, { result: Record<string, unknown>; requests: number }> = {
  missing: {
    result: { probeFound: false, probeStatus: "missing", deployed: true, compiled: true, configured: true, mapped: true, unitTestRootEnsured: true, errors: [], unitTestRoot: "/fake/mgr/" },
    requests: 44,
  },
  stale: {
    result: { probeFound: true, probeStatus: "stale", deployed: true, compiled: true, configured: true, mapped: true, unitTestRootEnsured: true, errors: [], unitTestRoot: "/fake/mgr/" },
    requests: 42,
  },
  unconfigured: {
    result: { probeFound: true, probeStatus: "unconfigured", deployed: true, compiled: true, configured: true, mapped: true, unitTestRootEnsured: true, errors: [], unitTestRoot: "/fake/mgr/" },
    requests: 9,
  },
  current: {
    result: { probeFound: true, probeStatus: "current", deployed: true, compiled: true, configured: true, mapped: true, unitTestRootEnsured: true, errors: [] },
    requests: 2,
  },
};

let shared: typeof Shared;
let embedded: EmbeddedBootstrap;
let rosterNames: string[];
const openFakes: StatefulFakeAtelier[] = [];
const openClients: Array<{ destroy: () => void }> = [];

beforeAll(async () => {
  const stale = staleDistReason(REPO_ROOT, "shared");
  if (stale !== undefined) {
    throw new Error(`The compile oracle runs the built shared dist and needs no IRIS, so a stale or missing dist fails it instead of skipping it: ${stale}`);
  }
  shared = (await import(pathToFileURL(path.join(REPO_ROOT, "packages", "shared", "dist", "index.js")).href)) as typeof Shared;
  embedded = await loadEmbedded(REPO_ROOT);
  rosterNames = [...embedded.classes.keys()];
});

afterAll(async () => {
  for (const client of openClients.splice(0)) client.destroy();
  await Promise.all(openFakes.splice(0).map((fake) => fake.close()));
});

function configOf(fake: StatefulFakeAtelier): IrisConnectionConfig {
  return {
    host: "127.0.0.1",
    port: fake.port,
    username: "fake",
    password: "fake",
    namespace: NAMESPACE,
    https: false,
    baseUrl: `http://127.0.0.1:${fake.port}`,
    timeout: 10_000,
  };
}

/** A fake seeded for `branch` (what `bootstrap()` finds on arrival), with a client and config for it. */
async function arrive(branch: Branch): Promise<{
  fake: StatefulFakeAtelier;
  http: InstanceType<typeof Shared.IrisHttpClient>;
  config: IrisConnectionConfig;
  seededMarker: string | undefined;
}> {
  const fake = await startStatefulFakeAtelier({ namespace: NAMESPACE });
  openFakes.push(fake);
  const target = { host: "127.0.0.1", port: String(fake.port), username: "fake", password: "fake", namespace: NAMESPACE };
  let seededMarker: string | undefined;
  if (branch === "stale") {
    const leg = LEGS.find((candidate) => candidate.id === "older-sequence");
    if (leg === undefined) throw new Error("the older-sequence leg is missing");
    seededMarker = leg.seedMarker(stampedEmbedded(embedded));
    await seedInstance(target, embedded, { marker: seededMarker, perturb: true });
  } else if (branch === "unconfigured") {
    await seedInstance(target, embedded, { marker: embedded.marker, perturb: false });
    fake.state.configured = false;
    fake.state.mapped = false;
  } else if (branch === "current") {
    await seedInstance(target, embedded, { marker: embedded.marker, perturb: false });
  }
  const config = configOf(fake);
  const http = new shared.IrisHttpClient(config);
  openClients.push(http);
  return { fake, http, config, seededMarker };
}

/** Run `bootstrap()` once and return its result with the (non-HEAD) requests it made. */
async function runBootstrap(
  fake: StatefulFakeAtelier,
  http: InstanceType<typeof Shared.IrisHttpClient>,
  config: IrisConnectionConfig,
): Promise<{ result: Shared.BootstrapResult; window: FakeRequest[] }> {
  const start = fake.requests.length;
  const result = await shared.bootstrap(http, config, ATELIER_VERSION);
  return { result, window: fake.requests.slice(start).filter((request) => request.method !== "HEAD") };
}

const classNameOf = (documentName: string): string => documentName.replace(/\.cls$/, "");

/** The compile check's requests of a window: its dictionary query and its `docnames` reads. */
function checkRequests(window: readonly FakeRequest[]): { queries: string[]; docnames: string[] } {
  const summary = summarizeRequests(window);
  return {
    queries: summary.queries.filter(isCompileCheckQuery),
    docnames: summary.others.filter((other) => /\/docnames\/CLS$/.test(other)),
  };
}

const privilegedQueries = (window: readonly FakeRequest[]): string[] => summarizeRequests(window).queries.filter((query) => PRIVILEGED.test(query));

describe("Story 44.4 AC 44.4.6: a clean compile is byte-identical to the pre-story capture, and the check costs two requests", () => {
  for (const branch of ["missing", "stale", "unconfigured", "current"] as const) {
    it(
      `${branch}: the result equals the capture, with the dictionary query and one docnames read added`,
      async () => {
        const { fake, http, config, seededMarker } = await arrive(branch);

        const { result, window } = await runBootstrap(fake, http, config);

        const expected = { ...BASELINE[branch].result, ...(seededMarker === undefined ? {} : { deployedVersion: seededMarker }) };
        expect(result).toEqual(expected);
        expect(window.length, "the baseline's requests plus exactly two").toBe(BASELINE[branch].requests + 2);
        const check = checkRequests(window);
        expect(check.queries).toHaveLength(1);
        expect(check.docnames).toHaveLength(1);
      },
      TEST_TIMEOUT_MS,
    );
  }
});

describe("Story 44.4 AC 44.4.2 / 44.4.3 / 44.4.5: a failed class is named from the check, on every writing branch", () => {
  const storageWritten = (failed: FakeCompileFailure["failed"], consoleLines?: readonly string[]): FakeCompileFailure => ({
    failed,
    shape: "storage-written",
    ...(consoleLines === undefined ? {} : { console: consoleLines }),
  });

  for (const branch of WRITING_BRANCHES) {
    it(
      `${branch}, Storage written (HTTP 200, no status error, the failure only in the console): compiled is false, the class is named, no privileged step is sent`,
      async () => {
        const { fake, http, config } = await arrive(branch);
        fake.compileFailure = () => storageWritten([{ name: HEALTH, kind: "routine" }], COMPILE_CONSOLE_DE);

        const { result, window } = await runBootstrap(fake, http, config);

        expect(result.compiled).toBe(false);
        expect(result.errors).toEqual([`Compile failed: 1 of ${embedded.classes.size} classes did not compile: ${classNameOf(HEALTH)}`]);
        expect(result.configured).toBe(false);
        expect(result.mapped).toBe(false);
        expect(result.unitTestRootEnsured).toBe(false);
        expect(privilegedQueries(window), "no Configure, mapping or ^UnitTestRoot request").toEqual([]);
        expect(fake.state.configured, "the web application was not registered by this run").toBe(branch === "stale");
      },
      TEST_TIMEOUT_MS,
    );

    it(
      `${branch}, a status error that names only one class: both are named in list order, then what IRIS reported`,
      async () => {
        const { fake, http, config } = await arrive(branch);
        // IRIS names Base (a class failure, #5373); Health failed in a routine and is flagged.
        fake.compileFailure = () => ({
          failed: [
            { name: BASE, kind: "class" },
            { name: HEALTH, kind: "routine" },
          ],
          shape: "status-errors",
        });

        const { result, window } = await runBootstrap(fake, http, config);

        expect(result.compiled).toBe(false);
        expect(result.errors).toEqual([
          `Compile failed: 2 of ${embedded.classes.size} classes did not compile: ${classNameOf(BASE)}, ${classNameOf(HEALTH)}. ` +
            `IRIS reported: ERROR #5373: Class 'User.NoSuchSuper444', used by '${classNameOf(BASE)}:superclass', does not exist`,
        ]);
        expect(result.configured).toBe(false);
        expect(result.mapped).toBe(false);
        expect(result.unitTestRootEnsured).toBe(false);
        expect(privilegedQueries(window)).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      `${branch}, every class fails: every class is named`,
      async () => {
        const { fake, http, config } = await arrive(branch);
        fake.compileFailure = (names) => ({ failed: names.map((name) => ({ name, kind: "class" as const })), shape: "status-errors" });

        const { result } = await runBootstrap(fake, http, config);

        expect(result.compiled).toBe(false);
        const text = result.errors[0] as string;
        expect(result.errors).toHaveLength(1);
        expect(text.startsWith(`Compile failed: ${embedded.classes.size} of ${embedded.classes.size} classes did not compile: `)).toBe(true);
        for (const name of rosterNames) expect(text, name).toContain(classNameOf(name));
        expect(text).toContain(". IRIS reported: ERROR #5373");
      },
      TEST_TIMEOUT_MS,
    );

    it(
      `${branch}, a compile IRIS answered with a status error while the check is clean: still a failure, with the IRIS text`,
      async () => {
        const { fake, http, config } = await arrive(branch);
        // Not observed live: kept so that no status error is ever read as success.
        fake.compileFailure = () => ({ failed: [{ name: HEALTH, kind: "reported" }], shape: "status-errors" });

        const { result, window } = await runBootstrap(fake, http, config);

        expect(result.compiled).toBe(false);
        expect(result.errors).toEqual([
          `Compile failed: IRIS reported errors: ERROR #5373: Class 'User.NoSuchSuper444', used by '${classNameOf(HEALTH)}:superclass', does not exist`,
        ]);
        expect(result.configured).toBe(false);
        expect(privilegedQueries(window)).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    for (const which of ["query", "docnames"] as const) {
      it(
        `${branch}, the check's ${which} read fails: compiled is false with the could-not-run text, and no privileged step is sent`,
        async () => {
          const { fake, http, config } = await arrive(branch);
          fake.failCompileCheck = which;

          const { result, window } = await runBootstrap(fake, http, config);

          expect(result.compiled).toBe(false);
          expect(result.errors).toHaveLength(1);
          expect(result.errors[0]).toMatch(/^Compile failed: the check that every class compiled could not run: IRIS returned HTTP 500 for /);
          expect(result.configured).toBe(false);
          expect(result.mapped).toBe(false);
          expect(result.unitTestRootEnsured).toBe(false);
          expect(privilegedQueries(window)).toEqual([]);
        },
        TEST_TIMEOUT_MS,
      );
    }

    for (const [label, consoleLines] of [
      ["de-DE", COMPILE_CONSOLE_DE],
      ["ja-JP", COMPILE_CONSOLE_JA],
    ] as const) {
      it(
        `${branch}, a ${label} console: the result depends only on the check (a flagged class is named; a clean compile succeeds)`,
        async () => {
          const flagged = await arrive(branch);
          flagged.fake.compileFailure = () => storageWritten([{ name: HEALTH, kind: "routine" }], consoleLines);
          const failed = await runBootstrap(flagged.fake, flagged.http, flagged.config);
          expect(failed.result.compiled).toBe(false);
          expect(failed.result.errors).toEqual([`Compile failed: 1 of ${embedded.classes.size} classes did not compile: ${classNameOf(HEALTH)}`]);

          const clean = await arrive(branch);
          clean.fake.compileFailure = () => ({ failed: [], shape: "storage-written", console: consoleLines });
          const passed = await runBootstrap(clean.fake, clean.http, clean.config);
          expect(passed.result.compiled).toBe(true);
          expect(passed.result.errors).toEqual([]);
          expect(passed.result.configured).toBe(true);
        },
        TEST_TIMEOUT_MS,
      );
    }
  }

  it("the compile request itself fails (HTTP 500, an unstored class): today's text, no check request, and no privileged step", async () => {
    const { fake, http, config } = await arrive("unconfigured");
    fake.state.docs.delete(HEALTH);

    const { result, window } = await runBootstrap(fake, http, config);

    expect(result.compiled).toBe(false);
    expect(result.errors).toEqual([
      `Compile failed: IRIS returned HTTP 500 for POST /api/atelier/v${ATELIER_VERSION}/${NAMESPACE}/action/compile. Check the request parameters and try again. ` +
        `Details: ERROR #5373: Class '${HEALTH}' does not exist`,
    ]);
    expect(checkRequests(window)).toEqual({ queries: [], docnames: [] });
    expect(result.configured).toBe(false);
    expect(privilegedQueries(window)).toEqual([]);
  });
});

describe("Story 44.4 AC 44.4.7: the next start reports what an earlier start left failed", () => {
  it("a stale upgrade whose compile partly failed is reported again by the NEXT start (current), which skips the privileged steps", async () => {
    const { fake, http, config } = await arrive("stale");
    fake.compileFailure = () => ({ failed: [{ name: HEALTH, kind: "routine" }], shape: "storage-written", console: COMPILE_CONSOLE_DE });
    const first = await runBootstrap(fake, http, config);
    expect(first.result.probeStatus).toBe("stale");
    expect(first.result.compiled).toBe(false);
    fake.compileFailure = undefined;

    const next = await runBootstrap(fake, http, config);

    expect(next.result.probeStatus, "the marker is the embedded one and the web application is registered").toBe("current");
    expect(next.result.compiled).toBe(false);
    expect(next.result.errors).toEqual([`Compile failed: 1 of ${embedded.classes.size} classes did not compile: ${classNameOf(HEALTH)}`]);
    expect(next.result.configured).toBe(false);
    expect(next.result.mapped).toBe(false);
    expect(next.result.unitTestRootEnsured).toBe(false);
    expect(next.window.filter((request) => request.method === "PUT"), "no upload").toEqual([]);
    expect(summarizeRequests(next.window).compiles, "no compile: the check only reads").toBe(0);
    expect(privilegedQueries(next.window)).toEqual([]);
  });

  it("a current start whose check cannot run is reported as such, fail-closed", async () => {
    const { fake, http, config } = await arrive("current");
    fake.failCompileCheck = "docnames";

    const { result } = await runBootstrap(fake, http, config);

    expect(result.compiled).toBe(false);
    expect(result.errors[0]).toMatch(/^Compile failed: the check that every class compiled could not run: /);
  });
});

describe("Story 44.4 AC 44.4.3: the IRIS text in the failure line is one line and at most 300 characters", () => {
  it("a status error whose IRIS text carries CR LF (the captured #5475) reaches the failure line with no line break", async () => {
    const { fake, http, config } = await arrive("unconfigured");
    fake.compileFailure = () => ({ failed: [{ name: HEALTH, kind: "routine" }], shape: "status-errors" });

    const { result } = await runBootstrap(fake, http, config);

    expect(result.compiled).toBe(false);
    const text = result.errors[0] as string;
    expect(text).toContain(`${classNameOf(HEALTH)}. IRIS reported: ERROR #5475: Error compiling routine: ${classNameOf(HEALTH)}.`);
    expect(text).not.toMatch(/[\r\n]/);
  }, TEST_TIMEOUT_MS);

  it("an IRIS text longer than 300 characters is cut as oneLine cuts it: whitespace collapsed, 300 characters, then three dots", async () => {
    const { fake, http, config } = await arrive("unconfigured");
    // The captured #5475 text names the failed class three times, so a long class name makes it longer than 300 characters.
    const longName = `Story444.${"VeryLongClassName".repeat(6)}.cls`;
    fake.compileFailure = () => ({ failed: [{ name: longName, kind: "routine" }], shape: "status-errors" });

    const { result } = await runBootstrap(fake, http, config);

    expect(result.compiled).toBe(false);
    expect(result.errors).toHaveLength(1);
    const prefix = "Compile failed: IRIS reported errors: ";
    const text = result.errors[0] as string;
    expect(text.startsWith(prefix)).toBe(true);
    const reported = text.slice(prefix.length);
    expect(reported).toHaveLength(303);
    expect(reported.endsWith("...")).toBe(true);
    expect(reported.startsWith("ERROR #5475: Error compiling routine: Story444.")).toBe(true);
    expect(reported).not.toMatch(/[\r\n]|\s\s/);
  }, TEST_TIMEOUT_MS);
});

describe("Story 44.4 AC 44.4.4: seedInstance judges its compile by the check", () => {
  async function seeding(): Promise<{ fake: StatefulFakeAtelier; target: { host: string; port: string; username: string; password: string; namespace: string } }> {
    const fake = await startStatefulFakeAtelier({ namespace: NAMESPACE });
    openFakes.push(fake);
    return { fake, target: { host: "127.0.0.1", port: String(fake.port), username: "fake", password: "fake", namespace: NAMESPACE } };
  }

  it("a Storage-written partial failure (HTTP 200, no status error) throws a SeedCompileError that names the class", async () => {
    const { fake, target } = await seeding();
    fake.compileFailure = () => ({ failed: [{ name: HEALTH, kind: "routine" }], shape: "storage-written", console: COMPILE_CONSOLE_DE });

    const seeded = seedInstance(target, embedded, { marker: embedded.marker, perturb: false });

    await expect(seeded).rejects.toBeInstanceOf(SeedCompileError);
    await expect(seeded).rejects.toThrow(`did not compile: ${HEALTH}`);
  }, TEST_TIMEOUT_MS);

  it("a check that cannot run throws a SeedCompileError with the could-not-run text", async () => {
    const { fake, target } = await seeding();
    fake.failCompileCheck = "query";

    const seeded = seedInstance(target, embedded, { marker: embedded.marker, perturb: false });

    await expect(seeded).rejects.toBeInstanceOf(SeedCompileError);
    await expect(seeded).rejects.toThrow("the check that every class compiled could not run");
  }, TEST_TIMEOUT_MS);
});

describe("Story 44.4 AC 44.4.2: verifyCompiled and compileAndVerify decide per class from the row, the error flag and upd", () => {
  /** A fake holding the stored class documents `names`, each compiled clean. */
  async function holding(names: readonly string[]): Promise<{ fake: StatefulFakeAtelier; http: InstanceType<typeof Shared.IrisHttpClient>; config: IrisConnectionConfig }> {
    const fake = await startStatefulFakeAtelier({ namespace: NAMESPACE });
    openFakes.push(fake);
    for (const name of names) {
      fake.state.docs.set(name, { lines: [`Class ${classNameOf(name)} {}`], ts: "2026-11-23 10:00:00.000" });
      fake.state.classes.set(name, { compiledFrom: "2026-11-23 10:00:00.000", error: false, upd: true });
    }
    const config = configOf(fake);
    const http = new shared.IrisHttpClient(config);
    openClients.push(http);
    return { fake, http, config };
  }

  const NAMES = ["Story444.Good.cls", "Story444.Broken.cls", "Story444.Dependant.cls", "Story444.Rolled.cls"];

  it("names exactly the classes without a row, with the error flag, or with upd false, in list order; a rollback to identical content counts as compiled", async () => {
    const { fake, http } = await holding(NAMES);
    // Broken: a routine failure (a row, the error flag, upd true). Dependant: skipped (an old row, no flag, upd false).
    fake.state.classes.set("Story444.Broken.cls", { compiledFrom: "2026-11-23 10:00:00.000", error: true, upd: true });
    fake.state.classes.set("Story444.Dependant.cls", { compiledFrom: "2026-11-23 10:00:00.000", error: false, upd: false });
    // Rolled: compiled from other text than the stored `ts` says (a rollback), but IRIS's own flag holds.
    fake.state.classes.set("Story444.Rolled.cls", { compiledFrom: "2000-01-01 00:00:00.000", error: false, upd: true });

    const notCompiled = await shared.verifyCompiled(http, NAMESPACE, ATELIER_VERSION, NAMES);

    expect(notCompiled).toEqual(["Story444.Broken.cls", "Story444.Dependant.cls"]);
  });

  it("a class with no compiled row (a first compile that failed) and a class with no definition at all are named", async () => {
    const { fake, http } = await holding(["Story444.Good.cls"]);
    fake.state.docs.set("Story444.NoRow.cls", { lines: ["Class Story444.NoRow {}"], ts: "2026-11-23 10:00:00.000" });

    const notCompiled = await shared.verifyCompiled(http, NAMESPACE, ATELIER_VERSION, ["Story444.Good.cls", "Story444.NoRow.cls", "Story444.Absent.cls"]);

    expect(notCompiled).toEqual(["Story444.NoRow.cls", "Story444.Absent.cls"]);
  });

  it("sends one dictionary query and one docnames read per distinct first segment, and refuses a name that is not a .cls document", async () => {
    const { fake, http } = await holding(["Story444.A.cls", "Story444.B.cls", "Other444.C.cls"]);
    const start = fake.requests.length;

    expect(await shared.verifyCompiled(http, NAMESPACE, ATELIER_VERSION, ["Story444.A.cls", "Story444.B.cls", "Other444.C.cls"])).toEqual([]);

    const check = checkRequests(fake.requests.slice(start).filter((request) => request.method !== "HEAD"));
    expect(check.queries).toHaveLength(1);
    expect(check.docnames).toHaveLength(2);
    await expect(shared.verifyCompiled(http, NAMESPACE, ATELIER_VERSION, ["Story444.A.mac"])).rejects.toThrow(/\.cls/);
  });

  it("compileAndVerify compiles, returns the envelope and names the failed class; the compile's status error is kept as context", async () => {
    const { fake, http, config } = await holding([]);
    for (const name of ["Story444.One.cls", "Story444.Two.cls"]) {
      fake.state.docs.set(name, { lines: [`Class ${classNameOf(name)} {}`], ts: "2026-11-23 10:00:00.000" });
    }
    fake.compileFailure = () => ({ failed: [{ name: "Story444.Two.cls", kind: "class" }], shape: "status-errors" });

    const report = await shared.compileAndVerify(http, config, ATELIER_VERSION, ["Story444.One.cls", "Story444.Two.cls"]);

    expect(report.notCompiled).toEqual(["Story444.Two.cls"]);
    expect(report.irisErrors).toHaveLength(1);
    expect(report.irisErrors[0]).toContain("ERROR #5373");
    expect(report.envelope, "no envelope: the client threw on the status error").toBeUndefined();
  });

  it("compileAndVerify of a clean compile reports nothing, and the Storage-written envelope names the written class", async () => {
    const { fake, http, config } = await holding([]);
    fake.state.docs.set("Story444.Store.cls", { lines: ["Class Story444.Store {}"], ts: "2026-11-23 10:00:00.000" });
    fake.compileFailure = () => ({ failed: [], shape: "storage-written" });
    const clean = await shared.compileAndVerify(http, config, ATELIER_VERSION, ["Story444.Store.cls"]);
    expect(clean.notCompiled).toEqual([]);
    expect(clean.irisErrors).toEqual([]);

    fake.state.docs.set("Story444.Bad.cls", { lines: ["Class Story444.Bad {}"], ts: "2026-11-23 10:00:01.000" });
    fake.compileFailure = () => ({ failed: [{ name: "Story444.Bad.cls", kind: "routine" }], shape: "storage-written" });
    const partial = await shared.compileAndVerify(http, config, ATELIER_VERSION, ["Story444.Store.cls", "Story444.Bad.cls"]);

    expect(partial.notCompiled).toEqual(["Story444.Bad.cls"]);
    expect(partial.irisErrors).toEqual([]);
    expect((partial.envelope?.result as { content: Array<{ name: string }> }).content.map((entry) => entry.name)).toEqual(["Story444.Store.cls"]);
  });

  it("a compile request that fails without an Atelier answer is rethrown unchanged, with no check request", async () => {
    const { fake, http, config } = await holding([]);
    const start = fake.requests.length;

    await expect(shared.compileAndVerify(http, config, ATELIER_VERSION, ["Story444.Unstored.cls"])).rejects.toThrow(/IRIS returned HTTP 500/);

    expect(checkRequests(fake.requests.slice(start))).toEqual({ queries: [], docnames: [] });
  });
});
