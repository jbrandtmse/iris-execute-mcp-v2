/**
 * Story 42.2, AC 42.2.5 (first bullet) -- the hermetic orchestration test of the bootstrap downgrade guard, in the
 * default suite. It drives the REAL built `iris-dev-mcp` (its probe and deploy code in the built shared dist) over the
 * real stdio MCP client against a STATEFUL fake Atelier listener on 127.0.0.1, and checks the matrix rows of the spec:
 *
 * - newer (at startup, and through the lazy `other` profile of DW-518) and foreign (a different hash, `dev`): no PUT and
 *   no compile, every document's content and `ts` and the compiled marker byte-identical, and exactly one `[WARN]` that
 *   names both markers and the remedy;
 * - older (a lower sequence, at startup and through `other`) and legacy (a bare hash): every embedded class is PUT once
 *   with `ignoreConflict=1`, compiled once, and each document ends up equal to a clean deployment of the embed;
 * - current: nothing is written, and a second start right after an upgrade changes nothing;
 * - race: a newer or foreign marker that appears between the uploads and the compile stops the compile.
 *
 * The legs are the ones `story-42-2-bootstrap-guard-live-gate.test.ts` runs against a throwaway IRIS container
 * (`bootstrap-guard-legs.ts`). The older, legacy and current legs are the negative twins of the newer and foreign legs: the
 * same oracles must report the change they are built to report. The oracle self-tests at the end drive the oracles with
 * a real downgrade written to the fake, and with outcomes in which the guard failed.
 *
 * Needs no IRIS and no docker. It requires fresh dists of `@iris-mcp/shared` and `@iris-mcp/dev` and the built MCP
 * client, and FAILS (never skips) without them: this test needs no IRIS, so a skip would only hide a broken guard.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reserveClosedPort, resolveSdkEsmDir, staleDistReason, type IrisTarget } from "./process-gate-helpers.js";
import {
  LEGS,
  REMEDY,
  VERSION_QUERY,
  assertNoExecuteMcpClasses,
  contentDifferences,
  leavingLines,
  loadEmbedded,
  referenceSnapshot,
  runLeg,
  runServer,
  seedInstance,
  snapshotDifferences,
  snapshotInstance,
  stampedEmbedded,
  verifyLeg,
  type EmbeddedBootstrap,
  type Expectation,
  type LegContext,
  type LegOutcome,
  type Snapshot,
} from "./bootstrap-guard-legs.js";
import {
  startStatefulFakeAtelier,
  summarizeRequests,
  type FakeRequest,
  type StatefulFakeAtelier,
} from "./stateful-fake-atelier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const NAMESPACE = "USER";
const TEST_TIMEOUT_MS = 60_000;
const IS_CONFIGURED_QUERY = "SELECT ExecuteMCPv2.Setup_IsConfigured() AS Configured";
const UNIT_TEST_ROOT_QUERY = "SELECT ExecuteMCPv2.Setup_EnsureUnitTestRoot() AS UnitTestRoot";

let embedded: EmbeddedBootstrap;
let sdkEsmDir: string;
/** The state a clean deployment of the embed leaves (content of every document): what an upgraded document must equal. */
let reference: Snapshot;
/** Fakes a test started, closed after the test. */
const openFakes: StatefulFakeAtelier[] = [];

function targetOf(fake: StatefulFakeAtelier): IrisTarget {
  return { host: "127.0.0.1", port: String(fake.port), username: "fake", password: "fake", namespace: NAMESPACE };
}

async function startFake(options: Partial<Parameters<typeof startStatefulFakeAtelier>[0]> = {}): Promise<StatefulFakeAtelier> {
  const fake = await startStatefulFakeAtelier({ namespace: NAMESPACE, ...options });
  openFakes.push(fake);
  return fake;
}

beforeAll(async () => {
  const stale = staleDistReason(REPO_ROOT, "shared") ?? staleDistReason(REPO_ROOT, "iris-dev-mcp");
  if (stale !== undefined) {
    throw new Error(
      `The hermetic bootstrap-guard test runs the built iris-dev-mcp and shared dists and needs no IRIS, so a stale or missing ` +
        `dist fails it instead of skipping it: ${stale}`,
    );
  }
  const found = resolveSdkEsmDir(REPO_ROOT);
  if (found === undefined) {
    throw new Error(
      "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm; run pnpm install from the repo root. " +
        "This test needs no IRIS, so a missing client fails it instead of skipping it.",
    );
  }
  sdkEsmDir = found;
  embedded = await loadEmbedded(REPO_ROOT);
  const referenceFake = await startFake();
  reference = await referenceSnapshot(targetOf(referenceFake), embedded);
});

afterAll(async () => {
  await Promise.all(openFakes.splice(0).map((fake) => fake.close()));
});

/** Check the requests the server itself made in one start (the window between `start` and `stop`). */
function assertServerRequests(expectation: Expectation, window: readonly FakeRequest[], names: readonly string[]): void {
  const summary = summarizeRequests(window);
  const versionReads = summary.queries.filter((query) => query === VERSION_QUERY).length;
  const writes = summary.queries.filter((query) => query !== VERSION_QUERY && query !== IS_CONFIGURED_QUERY && query !== UNIT_TEST_ROOT_QUERY);
  expect(writes, "no Configure or mapping statement is issued: the instance was seeded configured").toEqual([]);
  if (expectation === "newer" || expectation === "foreign") {
    expect(summary.puts, "no PUT").toEqual([]);
    expect(summary.compiles, "no compile").toBe(0);
    expect(summary.queries, "only the one probe query: no IsConfigured, Configure, mapping or ^UnitTestRoot").toEqual([VERSION_QUERY]);
    return;
  }
  if (expectation === "upgraded") {
    expect([...summary.puts].sort(), "every embedded class is PUT exactly once").toEqual([...names].sort());
    expect(
      window.filter((request) => request.method === "PUT").every((request) => request.url.endsWith("?ignoreConflict=1")),
      "every PUT carries ignoreConflict=1",
    ).toBe(true);
    expect(summary.compiles, "one compile of the whole embed").toBe(1);
    expect(versionReads, "the probe, and the re-check before the compile").toBe(2);
    return;
  }
  expect(summary.puts, "no PUT").toEqual([]);
  expect(summary.compiles, "no compile").toBe(0);
  expect(summary.queries, "the probe and the IsConfigured check only").toEqual([VERSION_QUERY, IS_CONFIGURED_QUERY]);
}

describe("Story 42.2 AC 42.2.5: the real built server against a stateful fake Atelier", () => {
  for (const leg of LEGS) {
    it(
      `${leg.id}: ${leg.title}`,
      async () => {
        const fake = await startFake();
        const windows: Array<{ start: number; stop: number }> = [];
        const ctx: LegContext = {
          repoRoot: REPO_ROOT,
          sdkEsmDir,
          target: targetOf(fake),
          embedded,
          reference,
          onServerWindow: (event) => {
            if (event === "start") windows.push({ start: fake.requests.length, stop: -1 });
            else (windows[windows.length - 1] as { stop: number }).stop = fake.requests.length;
          },
        };

        const outcome = await runLeg(leg, ctx);

        expect(verifyLeg(outcome, embedded, reference)).toEqual([]);
        expect(windows).toHaveLength(leg.expect.length);
        const names = [...embedded.classes.keys()];
        leg.expect.forEach((expectation, index) => {
          const window = windows[index] as { start: number; stop: number };
          assertServerRequests(expectation, fake.requests.slice(window.start, window.stop), names);
        });
      },
      TEST_TIMEOUT_MS,
    );
  }
});

describe("Story 42.2 AC 42.2.5: a marker that turns newer or foreign between the uploads and the compile (race)", () => {
  /** An older deployment; the fake changes its compiled marker to `racing` as the server's first upload lands. */
  async function runRace(racing: string): Promise<{ fake: StatefulFakeAtelier; stderr: string; window: FakeRequest[]; seededMarker: string }> {
    let armed = false;
    let raced = false;
    const fake = await startFake({
      onPut: (_name, _count, state) => {
        if (armed && !raced) {
          raced = true;
          state.compiledMarker = racing;
        }
      },
    });
    const leg = LEGS.find((candidate) => candidate.id === "older-sequence");
    if (leg === undefined) throw new Error("the older-sequence leg is missing");
    const target = targetOf(fake);
    const seededMarker = leg.seedMarker(stampedEmbedded(embedded));
    await seedInstance(target, embedded, { marker: seededMarker, perturb: true });
    const start = fake.requests.length;
    armed = true;
    const stderr = await runServer("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target });
    armed = false;
    expect(raced, "the first upload of the server's deploy triggered the race").toBe(true);
    return { fake, stderr, window: fake.requests.slice(start), seededMarker };
  }

  for (const [kind, racing] of [
    ["newer", "99.0.0+1.0123456789ab"],
    ["foreign", "dev"],
  ] as const) {
    it(
      `a ${kind} marker found by the re-check skips the compile and every later step, with one warning naming both markers`,
      async () => {
        const { fake, stderr, window } = await runRace(racing);
        const summary = summarizeRequests(window.filter((request) => !(request.method === "GET" || request.method === "HEAD")));

        expect([...summary.puts].sort(), "the uploads had already landed (the documented residual)").toEqual([...embedded.classes.keys()].sort());
        expect(summary.compiles, "no compile over the racing deployment").toBe(0);
        expect(summary.queries, "the probe and the re-check only: nothing after the skipped compile").toEqual([VERSION_QUERY, VERSION_QUERY]);
        expect(fake.state.compiledMarker, "the compiled marker is still the racing build's").toBe(racing);

        const lines = leavingLines(stderr);
        expect(lines).toHaveLength(1);
        const line = lines[0] as string;
        expect(line.startsWith("[WARN] ")).toBe(true);
        expect(line).toContain("found just before compiling, so nothing was compiled");
        expect(line).toContain(JSON.stringify(racing));
        expect(line).toContain(embedded.marker);
        for (const remedy of REMEDY[kind]) expect(line).toContain(remedy);
      },
      TEST_TIMEOUT_MS,
    );
  }

  it("without a racing build the same deployment compiles once (the negative twin: the race oracle can fail)", async () => {
    const fake = await startFake();
    const leg = LEGS.find((candidate) => candidate.id === "older-sequence");
    if (leg === undefined) throw new Error("the older-sequence leg is missing");
    const target = targetOf(fake);
    await seedInstance(target, embedded, { marker: leg.seedMarker(stampedEmbedded(embedded)), perturb: true });
    const start = fake.requests.length;
    const stderr = await runServer("startup", { repoRoot: REPO_ROOT, sdkEsmDir, target });

    expect(summarizeRequests(fake.requests.slice(start)).compiles).toBe(1);
    expect(fake.state.compiledMarker).toBe(embedded.marker);
    expect(leavingLines(stderr)).toEqual([]);
  }, TEST_TIMEOUT_MS);
});

describe("Story 42.2 AC 42.2.5: the live gate's pre-flight (no ExecuteMCPv2 classes yet), against the stateful fake", () => {
  it("passes on an instance that answers and holds no classes: the version query fails first", async () => {
    const fake = await startFake();

    await expect(assertNoExecuteMcpClasses(targetOf(fake))).resolves.toBeUndefined();
  });

  it("refuses an instance that already holds the classes, naming the deployed marker (it is not a throwaway)", async () => {
    const fake = await startFake();
    await seedInstance(targetOf(fake), embedded, { marker: embedded.marker, perturb: false });

    await expect(assertNoExecuteMcpClasses(targetOf(fake))).rejects.toThrow(
      new RegExp(`already holds ExecuteMCPv2 classes.*${embedded.marker.replace(/[.+]/g, "\\$&")}.*not a throwaway`),
    );
  });

  it("refuses an instance that does not answer, without mistaking the failed query for 'no classes deployed'", async () => {
    const closed = { ...targetOf(await startFake()), port: await reserveClosedPort() };

    await expect(assertNoExecuteMcpClasses(closed)).rejects.toThrow(/does not answer a plain Atelier query/);
  });
});

describe("Story 42.2 AC 42.2.5: the oracles can go red", () => {
  const SEED_NEWER = (): string => {
    const leg = LEGS.find((candidate) => candidate.id === "newer-startup");
    if (leg === undefined) throw new Error("the newer-startup leg is missing");
    return leg.seedMarker(stampedEmbedded(embedded));
  };

  /** An instance seeded newer, with its snapshot, and the number of requests the seed took. */
  async function newerInstance(): Promise<{ fake: StatefulFakeAtelier; target: IrisTarget; seeded: Snapshot; names: string[]; mark: number }> {
    const fake = await startFake();
    const target = targetOf(fake);
    const names = [...embedded.classes.keys()];
    await seedInstance(target, embedded, { marker: SEED_NEWER(), perturb: true });
    const seeded = await snapshotInstance(target, names);
    return { fake, target, seeded, names, mark: fake.requests.length };
  }

  it("the fake keeps what was written: the seed is readable, compiled and distinguishable from the reference", async () => {
    const { fake, seeded, names } = await newerInstance();

    expect(Object.keys(seeded.docs).sort()).toEqual([...names].sort());
    expect(fake.state.docs.size).toBe(embedded.classes.size);
    expect(seeded.compiledMarker).toBe(SEED_NEWER());
    expect(contentDifferences(reference, seeded)).toHaveLength(names.length);
    expect(fake.state.configured).toBe(true);
    expect(fake.state.mapped).toBe(true);
  });

  it("a downgrade written by an equality-probing client turns the snapshot oracle red, and the request log shows its 35 PUTs and compile", async () => {
    const { fake, target, seeded, names, mark } = await newerInstance();

    // What an older server without the guard does to a newer deployment: PUT every class, compile, restamp.
    await seedInstance(target, embedded, { marker: embedded.marker, perturb: false });
    const after = await snapshotInstance(target, names);

    const differences = snapshotDifferences(seeded, after);
    expect(differences).toContain(`compiled marker ${JSON.stringify(SEED_NEWER())} became ${JSON.stringify(embedded.marker)}`);
    for (const name of names) {
      expect(differences, `${name} content`).toContain(`${name}: content changed`);
      expect(differences.some((difference) => difference.startsWith(`${name}: ts `)), `${name} ts`).toBe(true);
    }
    const downgrade = summarizeRequests(fake.requests.slice(mark));
    expect(downgrade.puts).toHaveLength(names.length);
    expect(downgrade.compiles).toBe(1);
  });

  it("snapshotDifferences reports each kind of change on its own: ts only, content only, compiled marker only, a missing document", async () => {
    const { seeded } = await newerInstance();
    const name = embedded.classes.keys().next().value as string;
    const copy = (): Snapshot => JSON.parse(JSON.stringify(seeded)) as Snapshot;

    expect(snapshotDifferences(seeded, copy())).toEqual([]);

    const tsOnly = copy();
    (tsOnly.docs[name] as { ts: string }).ts = "2099-01-01 00:00:00.000";
    expect(snapshotDifferences(seeded, tsOnly)).toEqual([`${name}: ts ${seeded.docs[name]?.ts} became 2099-01-01 00:00:00.000`]);

    const contentOnly = copy();
    (contentOnly.docs[name] as { content: string[] }).content = [...(seeded.docs[name]?.content ?? []), "// edit"];
    expect(snapshotDifferences(seeded, contentOnly)).toEqual([`${name}: content changed`]);

    const markerOnly = copy();
    markerOnly.compiledMarker = embedded.marker;
    expect(snapshotDifferences(seeded, markerOnly)).toHaveLength(1);

    const missing = copy();
    delete missing.docs[name];
    expect(snapshotDifferences(seeded, missing)).toEqual([`${name} is in only the before snapshot`]);
  });

  /** The outcome of a leg whose server did nothing to an instance seeded for `legId`. */
  async function idleOutcome(legId: string, stderr: string): Promise<LegOutcome> {
    const leg = LEGS.find((candidate) => candidate.id === legId);
    if (leg === undefined) throw new Error(`no leg ${legId}`);
    const fake = await startFake();
    const target = targetOf(fake);
    const names = [...embedded.classes.keys()];
    const seedMarker = leg.seedMarker(stampedEmbedded(embedded));
    await seedInstance(target, embedded, { marker: seedMarker, perturb: leg.perturb });
    const seeded = await snapshotInstance(target, names);
    return { leg, seedMarker, seeded, runs: leg.expect.map(() => ({ stderr, after: seeded })) };
  }

  it("verifyLeg: an upgrade leg whose server did nothing is red on the content, the compiled marker and stderr", async () => {
    const problems = verifyLeg(await idleOutcome("older-sequence", ""), embedded, reference);

    expect(problems.some((problem) => problem.includes("documents do not equal the reference"))).toBe(true);
    expect(problems.some((problem) => problem.includes("the compiled marker is"))).toBe(true);
    expect(problems.some((problem) => problem.includes("upgrading REST service"))).toBe(true);
  });

  it("verifyLeg: a newer leg whose server stayed silent is red on the missing warning", async () => {
    const problems = verifyLeg(await idleOutcome("newer-startup", ""), embedded, reference);

    expect(problems).toEqual([expect.stringContaining("expected exactly one")]);
  });

  it("verifyLeg: a newer leg whose warning lacks a marker or the remedy is red on each", async () => {
    const stderr = "[WARN] Bootstrap: leaving the ExecuteMCPv2 classes in 'USER' alone: nothing else.\n";
    const problems = verifyLeg(await idleOutcome("newer-startup", stderr), embedded, reference);

    expect(problems.some((problem) => problem.includes("does not name the deployed marker"))).toBe(true);
    expect(problems.some((problem) => problem.includes("does not name the embedded marker"))).toBe(true);
    for (const remedy of REMEDY.newer) expect(problems.some((problem) => problem.includes(remedy))).toBe(true);
  });

  it("verifyLeg: a warning on a leg that must upgrade, and a second warning on a leg that must warn once, are red", async () => {
    const warning = "[WARN] Bootstrap: leaving the ExecuteMCPv2 classes in 'USER' alone: x\n";

    expect(verifyLeg(await idleOutcome("older-sequence", warning), embedded, reference).some((problem) => problem.includes("left the classes alone"))).toBe(true);
    expect(verifyLeg(await idleOutcome("foreign-dev", warning + warning), embedded, reference).some((problem) => problem.includes("found 2"))).toBe(true);
  });

  it("verifyLeg: a seed that did not perturb every document is red, so an unchanged document cannot pass as an upgraded one", async () => {
    const outcome = await idleOutcome("older-sequence", "");
    const seeded: Snapshot = JSON.parse(JSON.stringify(reference)) as Snapshot;
    seeded.compiledMarker = outcome.seedMarker;
    const problems = verifyLeg({ ...outcome, seeded }, embedded, reference);

    expect(problems.some((problem) => problem.includes("could not be told from a rewritten one"))).toBe(true);
  });
});
