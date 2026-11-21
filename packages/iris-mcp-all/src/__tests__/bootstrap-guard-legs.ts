/**
 * The legs of the bootstrap-guard check, shared by its two targets (one set of legs, two targets):
 * `story-42-2-bootstrap-guard-orchestration.test.ts` runs them against a stateful fake Atelier listener in the default
 * suite, and `story-42-2-bootstrap-guard-live-gate.test.ts` runs the SAME legs against a throwaway IRIS container.
 *
 * A leg seeds the instance with the shipped embed (`BOOTSTRAP_CLASSES` of the built shared dist) under a chosen version
 * marker, snapshots it, starts a fresh BUILT `iris-dev-mcp` pointed at it, makes one read call so the bootstrap has run,
 * captures the server's stderr, closes the server, and snapshots the instance again. The oracles are the instance's
 * documents (`ts` and content, read over the raw Atelier route), the compiled marker, and the server's stderr.
 *
 * - A deployment that is newer or foreign must come out byte-identical (every document's `ts` and content, the compiled
 *   marker), with exactly one `[WARN]` line that names both markers and the remedy.
 * - An older or legacy deployment must come out equal to the REFERENCE: the state a clean deployment of the embed leaves
 *   on the same instance, read back through the same route. Comparing with a reference read from the instance, not with
 *   the embed text, keeps the oracle independent of how IRIS re-renders a class on read.
 * - A current deployment must come out byte-identical, with no warning.
 * - An IPM-owned deployment (an older marker and the IPM-only `ExecuteMCPv2.InstallGuard` document, Story 42.4) must come out
 *   byte-identical, the guard document included, with exactly one `[WARN]` line that says IPM installed the classes, names both
 *   markers and the `zpm` commands.
 *
 * Every seed adds a leading `/// seed` line to every document, so a document the server rewrote differs from a document it
 * left alone, whatever IRIS does with a save of identical text.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  atelierDocument,
  atelierQuery,
  distEntry,
  openWireSession,
  type AtelierDocument,
  type IrisTarget,
} from "./process-gate-helpers.js";
import { parseBootstrapMarker, type StampedBootstrapMarker } from "../../../shared/src/bootstrap-version.js";
import { isLiveArmed } from "../../../shared/src/test-helpers/live-target.js";

/** The document that carries the version marker. */
export const SETUP_DOC = "ExecuteMCPv2.Setup.cls";

/**
 * The IPM-only install guard's document: its presence on an instance is the ownership signal (Story 42.4, DW-674). A leg that
 * expects `ipm` seeds a stub of it (a class document, not compiled); every other leg's seed removes it, so the legs stay independent.
 */
export const GUARD_DOC = "ExecuteMCPv2.InstallGuard.cls";

/** The stub the `ipm` leg stores under {@link GUARD_DOC}. */
export const GUARD_STUB_LINES: readonly string[] = ["/// A stub of the IPM install guard, seeded by the bootstrap-guard legs.", "Class ExecuteMCPv2.InstallGuard Extends %RegisteredObject", "{", "}"];

/** The statement the bootstrap probe runs, and the legs use as the compiled-marker oracle. */
export const VERSION_QUERY = "SELECT ExecuteMCPv2.Setup_GetBootstrapVersion() AS Version";

/** The text the seed adds as the first line of every document. */
export const SEED_LINE = "/// seed";

/** The shipped embed: what a built server deploys. */
export interface EmbeddedBootstrap {
  /** `BOOTSTRAP_VERSION` of the built shared dist. */
  marker: string;
  /** `BOOTSTRAP_CLASSES` of the built shared dist: document name to source text. */
  classes: ReadonlyMap<string, string>;
}

/** One document of a snapshot. */
export type SnapshotDocument = AtelierDocument;

/** The observable state of the instance. */
export interface Snapshot {
  /** The marker `ExecuteMCPv2.Setup_GetBootstrapVersion()` reports. */
  compiledMarker: string;
  /** Every embedded document, by name, as the Atelier GET route returns it. */
  docs: Record<string, SnapshotDocument>;
}

/** The embed of the built shared dist. */
export async function loadEmbedded(repoRoot: string): Promise<EmbeddedBootstrap> {
  const file = path.join(repoRoot, "packages", "shared", "dist", "bootstrap-classes.js");
  const loaded = (await import(pathToFileURL(file).href)) as {
    BOOTSTRAP_VERSION?: unknown;
    BOOTSTRAP_CLASSES?: unknown;
  };
  if (typeof loaded.BOOTSTRAP_VERSION !== "string" || !(loaded.BOOTSTRAP_CLASSES instanceof Map)) {
    throw new Error(`${file} does not export a BOOTSTRAP_VERSION string and a BOOTSTRAP_CLASSES map.`);
  }
  const classes = loaded.BOOTSTRAP_CLASSES as Map<string, string>;
  if (!classes.has(SETUP_DOC)) throw new Error(`${file} holds no ${SETUP_DOC}.`);
  return { marker: loaded.BOOTSTRAP_VERSION, classes };
}

/** The embedded marker as a stamped marker; throws when the embed does not carry the current grammar. */
export function stampedEmbedded(embedded: EmbeddedBootstrap): StampedBootstrapMarker {
  const parsed = parseBootstrapMarker(embedded.marker);
  if (parsed.kind !== "stamped") {
    throw new Error(`the shipped BOOTSTRAP_VERSION ${JSON.stringify(embedded.marker)} is not <semver>+<sequence>.<hash>.`);
  }
  return parsed;
}

// -- Seed texts -------------------------------------------------------------------------

/** `setupText` with its `Parameter BOOTSTRAPVERSION = "...";` value replaced; throws unless exactly one such line exists. */
export function replaceMarker(setupText: string, marker: string): string {
  const pattern = /^Parameter BOOTSTRAPVERSION = "[^"]*";$/gm;
  if ((setupText.match(pattern) ?? []).length !== 1) {
    throw new Error("expected exactly one Parameter BOOTSTRAPVERSION line in the Setup class text.");
  }
  return setupText.replace(pattern, () => `Parameter BOOTSTRAPVERSION = "${marker}";`);
}

/** `classText` with {@link SEED_LINE} added as its first line. */
export function addSeedLine(classText: string): string {
  return `${SEED_LINE}\n${classText}`;
}

/** The source the seed stores for one embedded document. */
export function seedText(name: string, embeddedText: string, options: { marker: string; perturb: boolean }): string {
  const withMarker = name === SETUP_DOC ? replaceMarker(embeddedText, options.marker) : embeddedText;
  return options.perturb ? addSeedLine(withMarker) : withMarker;
}

// -- Raw Atelier writes -----------------------------------------------------------------

interface AtelierAnswer {
  status: number;
  json: { status?: { errors?: unknown[] }; console?: unknown[]; result?: unknown } | undefined;
  text: string;
}

async function atelierWrite(target: IrisTarget, method: "PUT" | "POST" | "DELETE", subpath: string, body?: unknown): Promise<AtelierAnswer> {
  const response = await fetch(`http://${target.host}:${target.port}/api/atelier/v8/${target.namespace}/${subpath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${target.username}:${target.password}`).toString("base64")}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const text = await response.text();
  let json: AtelierAnswer["json"];
  try {
    json = JSON.parse(text) as AtelierAnswer["json"];
  } catch {
    json = undefined;
  }
  return { status: response.status, json, text };
}

/** Why an Atelier answer is not a success: its HTTP status, its envelope errors, and console lines that report an error. */
function failureOf(answer: AtelierAnswer, okStatuses: readonly number[]): string | undefined {
  const errors = answer.json?.status?.errors ?? [];
  const consoleErrors = (answer.json?.console ?? []).map(String).filter((line) => /ERROR #\d+/.test(line));
  if (okStatuses.includes(answer.status) && answer.json !== undefined && errors.length === 0 && consoleErrors.length === 0) {
    return undefined;
  }
  return `HTTP ${answer.status}; errors ${JSON.stringify(errors)}; console ${JSON.stringify(consoleErrors)}${
    answer.json === undefined ? `; body ${answer.text.slice(0, 300)}` : ""
  }`;
}

/** The seed's compile reported errors. */
export class SeedCompileError extends Error {}

/**
 * Put the embed on the instance under `options.marker`, compile it, and run `Setup_Configure` and
 * `Setup_ConfigureMapping` for the target's namespace, as an installation does. With `options.perturb` every document
 * also carries {@link SEED_LINE}. With `options.guard` the instance also carries a stub of the IPM install guard
 * ({@link GUARD_DOC}); without it the seed removes that document, so a guard left by an earlier leg never reaches this one.
 *
 * @throws {SeedCompileError} When the compile reports an error; the message carries the compile errors.
 */
export async function seedInstance(
  target: IrisTarget,
  embedded: EmbeddedBootstrap,
  options: { marker: string; perturb: boolean; guard?: boolean },
): Promise<void> {
  if (options.guard === true) {
    const stored = await atelierWrite(target, "PUT", `doc/${encodeURIComponent(GUARD_DOC)}?ignoreConflict=1`, { enc: false, content: [...GUARD_STUB_LINES] });
    const storedFailure = failureOf(stored, [200, 201]);
    if (storedFailure !== undefined) throw new Error(`seeding ${GUARD_DOC}: ${storedFailure}`);
  } else {
    // 200 when the guard was there, 404 when it was not: both leave the instance without it.
    const removed = await atelierWrite(target, "DELETE", `doc/${encodeURIComponent(GUARD_DOC)}`);
    if (removed.status !== 404) {
      const removedFailure = failureOf(removed, [200]);
      if (removedFailure !== undefined) throw new Error(`removing ${GUARD_DOC}: ${removedFailure}`);
    }
  }
  for (const [name, text] of embedded.classes) {
    const answer = await atelierWrite(target, "PUT", `doc/${encodeURIComponent(name)}?ignoreConflict=1`, {
      enc: false,
      content: seedText(name, text, options).split("\n"),
    });
    const failure = failureOf(answer, [200, 201]);
    if (failure !== undefined) throw new Error(`seeding ${name}: ${failure}`);
  }
  const compiled = await atelierWrite(target, "POST", "action/compile", [...embedded.classes.keys()]);
  const compileFailure = failureOf(compiled, [200]);
  if (compileFailure !== undefined) {
    throw new SeedCompileError(`compiling the ${embedded.classes.size} seeded classes in ${target.namespace}: ${compileFailure}`);
  }
  for (const statement of [
    "SELECT ExecuteMCPv2.Setup_Configure(?) AS ConfigureResult",
    "SELECT ExecuteMCPv2.Setup_ConfigureMapping(?) AS MappingResult",
  ]) {
    const answer = await atelierWrite(target, "POST", "action/query", { query: statement, parameters: [target.namespace] });
    const failure = failureOf(answer, [200]);
    if (failure !== undefined) throw new Error(`${statement}: ${failure}`);
  }
  const configured = await atelierQuery(target, "SELECT ExecuteMCPv2.Setup_IsConfigured() AS Configured");
  const flag = String(configured[0]?.["Configured"] ?? "0").toLowerCase();
  if (flag !== "1" && flag !== "true") {
    throw new Error(`Setup_Configure did not register the web application (Setup_IsConfigured answered ${JSON.stringify(flag)}).`);
  }
}

/** Every embedded document's `{ts, content}` and the compiled marker, read over the raw Atelier route. */
export async function snapshotInstance(target: IrisTarget, names: Iterable<string>): Promise<Snapshot> {
  const docs: Record<string, SnapshotDocument> = {};
  for (const name of names) docs[name] = await atelierDocument(target, name);
  const rows = await atelierQuery(target, VERSION_QUERY);
  return { compiledMarker: String(rows[0]?.["Version"] ?? ""), docs };
}

// -- The throwaway gate's arming and pre-flight ------------------------------------------

/** What the throwaway gate does in this environment. */
export type ThrowawayGatePlan = { run: false; reason: string } | { run: true; container: string };

/**
 * The throwaway gate's decision from the environment: it runs only against a container that
 * `scripts/throwaway-iris.mjs` started, named by `IRIS_THROWAWAY`. Without that variable it skips, before any probe,
 * spawn or request. `IRIS_THROWAWAY` set while `IRIS_REQUIRE_LIVE` does not arm the run is a misconfiguration and throws.
 * A set `IRIS_HOST` alone changes nothing.
 */
export function throwawayGatePlan(env: Record<string, string | undefined>): ThrowawayGatePlan {
  const container = env["IRIS_THROWAWAY"];
  if (container === undefined || container === "") {
    return {
      run: false,
      reason: "IRIS_THROWAWAY is not set: this gate runs only against a container that scripts/throwaway-iris.mjs started (pnpm live:bootstrap-guard).",
    };
  }
  if (!isLiveArmed(env)) {
    throw new Error(
      `IRIS_THROWAWAY is set (${container}) but IRIS_REQUIRE_LIVE is not 1 or true, so the run is not armed: this is a misconfiguration. ` +
        "Run the gate through scripts/throwaway-iris.mjs, which sets every IRIS_* variable it needs.",
    );
  }
  return { run: true, container };
}

/**
 * Prove the instance is a throwaway nobody has deployed to: it answers a plain query, and the version query FAILS because
 * no ExecuteMCPv2 classes exist. An instance that already holds them is not a throwaway.
 *
 * @throws When the instance does not answer, or when it reports a deployed version.
 */
export async function assertNoExecuteMcpClasses(target: IrisTarget): Promise<void> {
  try {
    await atelierQuery(target, "SELECT 1 AS One");
  } catch (error) {
    throw new Error(
      `the throwaway instance at ${target.host}:${target.port} does not answer a plain Atelier query, so "no ExecuteMCPv2 classes" cannot be established: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  let deployed: string | undefined;
  try {
    const rows = await atelierQuery(target, VERSION_QUERY);
    deployed = String(rows[0]?.["Version"] ?? "");
  } catch {
    return;
  }
  throw new Error(
    `the instance at ${target.host}:${target.port} already holds ExecuteMCPv2 classes (BOOTSTRAP_VERSION ${JSON.stringify(deployed)}), so it is not a throwaway; ` +
      "this gate seeds and rewrites those classes and must never run against such an instance.",
  );
}

// -- Oracles ----------------------------------------------------------------------------

function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

/** What differs between two snapshots: the compiled marker, and each document's `ts` and content. Empty means identical. */
export function snapshotDifferences(before: Snapshot, after: Snapshot): string[] {
  const differences: string[] = [];
  if (before.compiledMarker !== after.compiledMarker) {
    differences.push(`compiled marker ${JSON.stringify(before.compiledMarker)} became ${JSON.stringify(after.compiledMarker)}`);
  }
  const names = [...new Set([...Object.keys(before.docs), ...Object.keys(after.docs)])].sort();
  for (const name of names) {
    const was = before.docs[name];
    const now = after.docs[name];
    if (was === undefined || now === undefined) {
      differences.push(`${name} is in only the ${was === undefined ? "after" : "before"} snapshot`);
      continue;
    }
    if (was.ts !== now.ts) differences.push(`${name}: ts ${was.ts} became ${now.ts}`);
    if (!sameLines(was.content, now.content)) differences.push(`${name}: content changed`);
  }
  return differences;
}

/** The documents of `actual` whose content differs from the same document of `expected` (or that are missing). */
export function contentDifferences(expected: Snapshot, actual: Snapshot): string[] {
  return Object.keys(expected.docs)
    .filter((name) => {
      const found = actual.docs[name];
      return found === undefined || !sameLines((expected.docs[name] as SnapshotDocument).content, found.content);
    })
    .sort();
}

/** The stderr lines that report the bootstrap leaving a deployment alone. */
export function leavingLines(stderr: string): string[] {
  return stderr.split(/\r?\n/).filter((line) => line.includes("Bootstrap: leaving the ExecuteMCPv2 classes"));
}

/** The remedy texts of the warnings (the strings the spec's I/O matrix and decision #54 name). */
export const REMEDY = {
  newer: ["Upgrade this server to a build at least as new as the deployed one", "every client that shares the instance"],
  foreign: ["Run one build per instance", "delete class ExecuteMCPv2.Setup"],
  unknown: ["Check that the instance answers and that this user can run SQL", "delete class ExecuteMCPv2.Setup"],
  // IPM ownership (Story 42.4, DW-674): the classes were installed by IPM, this server never redeploys them, and the way back.
  ipm: [
    "the classes were installed by IPM (class ExecuteMCPv2.InstallGuard is present)",
    "this server never redeploys an IPM installation",
    'run zpm "install iris-execute-mcp-v2 ',
    'run zpm "uninstall iris-execute-mcp-v2" there and restart this server',
  ],
} as const;

// -- Legs -------------------------------------------------------------------------------

/** What a server start must do to the instance. `ipm`: leave an IPM installation alone and say so (Story 42.4). */
export type Expectation = "newer" | "foreign" | "upgraded" | "current" | "ipm";

/** One leg: a seed, the path the server reaches the instance by, and what each server start must do. */
export interface LegSpec {
  id: string;
  title: string;
  /** `startup`: the instance is the server's `default` profile. `other`: DW-518, `default` is a closed port and the instance is the lazy `other` profile. */
  via: "startup" | "other";
  /** The marker the instance is seeded with, from the embedded marker. */
  seedMarker: (embedded: StampedBootstrapMarker) => string;
  /** Whether the seed adds {@link SEED_LINE} to every document. */
  perturb: boolean;
  /** Whether the instance also carries the IPM install guard document ({@link GUARD_DOC}). */
  guard?: boolean;
  /** One entry per server start of the leg, in order. */
  expect: readonly Expectation[];
}

function render(semver: readonly [bigint, bigint, bigint], sequence: bigint, hash: string): string {
  return `${semver.join(".")}+${sequence}.${hash}`;
}

/** The marker of the same semver with `delta` added to the sequence. */
function sequencePlus(delta: bigint): LegSpec["seedMarker"] {
  return (embedded) => render(embedded.semver, embedded.sequence + delta, embedded.hash);
}

/** The next major version, same sequence and hash. */
function nextMajor(embedded: StampedBootstrapMarker): string {
  return render([embedded.semver[0] + 1n, embedded.semver[1], embedded.semver[2]], embedded.sequence, embedded.hash);
}

/** An older marker: a lower sequence, or (when the sequence is 0) a lower patch version. */
function older(embedded: StampedBootstrapMarker): string {
  if (embedded.sequence > 0n) return render(embedded.semver, embedded.sequence - 1n, embedded.hash);
  if (embedded.semver[2] > 0n) return render([embedded.semver[0], embedded.semver[1], embedded.semver[2] - 1n], embedded.sequence, embedded.hash);
  throw new Error("the embedded marker has sequence 0 and patch 0, so no older marker can be built from it.");
}

/** The same semver and sequence with a different hash. */
function otherHash(embedded: StampedBootstrapMarker): string {
  return render(embedded.semver, embedded.sequence, embedded.hash === "0".repeat(12) ? "f".repeat(12) : "0".repeat(12));
}

/** A bare 12-hex marker, as a build that predates the sequence stamped. */
function legacyHash(embedded: StampedBootstrapMarker): string {
  return embedded.hash === "0123456789ab" ? "ba9876543210" : "0123456789ab";
}

/** The legs, in the order of the spec's I/O matrix; each one seeds its own state and depends on no other. */
export const LEGS: readonly LegSpec[] = [
  { id: "newer-startup", title: "newer at startup: the same semver, sequence + 1", via: "startup", seedMarker: sequencePlus(1n), perturb: true, expect: ["newer"] },
  { id: "newer-lazy-other", title: "newer through the lazy `other` profile (DW-518): semver major + 1", via: "other", seedMarker: nextMajor, perturb: true, expect: ["newer"] },
  { id: "foreign-hash", title: "foreign: the same semver and sequence with a different hash", via: "startup", seedMarker: otherHash, perturb: true, expect: ["foreign"] },
  { id: "foreign-dev", title: "foreign: the literal `dev`", via: "startup", seedMarker: () => "dev", perturb: true, expect: ["foreign"] },
  { id: "older-sequence", title: "older at startup: a lower sequence", via: "startup", seedMarker: older, perturb: true, expect: ["upgraded"] },
  { id: "older-lazy-other", title: "older through the lazy `other` profile: a lower sequence", via: "other", seedMarker: older, perturb: true, expect: ["upgraded"] },
  { id: "legacy-bare-hash", title: "legacy at startup: a bare 12-hex hash", via: "startup", seedMarker: legacyHash, perturb: true, expect: ["upgraded"] },
  { id: "ipm-owned-older", title: "IPM-owned at startup: an older marker and the InstallGuard document (DW-674)", via: "startup", seedMarker: older, perturb: true, guard: true, expect: ["ipm"] },
  { id: "current", title: "current at startup: the embedded marker itself", via: "startup", seedMarker: (embedded) => render(embedded.semver, embedded.sequence, embedded.hash), perturb: false, expect: ["current"] },
  { id: "current-after-upgrade", title: "a second start right after an upgrade changes nothing", via: "startup", seedMarker: older, perturb: true, expect: ["upgraded", "current"] },
];

/** The instance a leg works on and the build it starts. */
export interface LegContext {
  repoRoot: string;
  /** The MCP client's ESM build (`resolveSdkEsmDir`). */
  sdkEsmDir: string;
  /** The instance: seeded, snapshotted, and where the server is pointed. */
  target: IrisTarget;
  embedded: EmbeddedBootstrap;
  /** What a clean deployment of the embed leaves on the instance; see {@link referenceSnapshot}. */
  reference: Snapshot;
  /** Called immediately before a server starts and immediately after it has closed, so a caller can bracket the server's own requests. */
  onServerWindow?: (event: "start" | "stop") => void;
}

/** What one server start produced. */
export interface LegRun {
  /** Everything the server wrote to stderr. */
  stderr: string;
  /** The instance after the server closed. */
  after: Snapshot;
}

/** What a leg produced. */
export interface LegOutcome {
  leg: LegSpec;
  seedMarker: string;
  /** The instance after the seed, before the first server started. */
  seeded: Snapshot;
  runs: LegRun[];
}

/** The target of the `default` profile of a DW-518 leg: a loopback port that nothing listens on. */
function closedDefaultTarget(namespace: string): IrisTarget {
  return { host: "127.0.0.1", port: "9", username: "bootstrapGuardProbe", password: "bootstrapGuardProbe", namespace };
}

/**
 * Start a fresh built `iris-dev-mcp`, make one read call so the bootstrap has run, close it, and return what it wrote to
 * stderr. `startup`: the instance is the `default` profile, which the server bootstraps before it serves. `other`: the
 * `default` profile is a closed port and the instance is `other`, whose first call bootstraps lazily (DW-518).
 * `extraEnv` is added to the server's environment (for example a short `IRIS_TIMEOUT`).
 */
export async function runServer(
  via: LegSpec["via"],
  ctx: Pick<LegContext, "repoRoot" | "sdkEsmDir" | "target">,
  extraEnv: Record<string, string> = {},
): Promise<string> {
  let stderr = "";
  const options = {
    sdkEsmDir: ctx.sdkEsmDir,
    entry: distEntry(ctx.repoRoot, "iris-dev-mcp"),
    clientName: "story-42-2-bootstrap-guard",
    onStderr: (chunk: string): void => {
      stderr += chunk;
    },
  };
  if (via === "startup") {
    const session = await openWireSession({ ...options, target: ctx.target }, extraEnv);
    try {
      const result = await session.raw("iris_server_info", {});
      if (result.isError) throw new Error(`iris_server_info failed: ${JSON.stringify(result.content)}`);
    } finally {
      await session.close();
    }
    return stderr;
  }
  const session = await openWireSession(
    { ...options, target: closedDefaultTarget(ctx.target.namespace) },
    {
      ...extraEnv,
      IRIS_PROFILES: JSON.stringify({
        other: {
          host: ctx.target.host,
          port: Number(ctx.target.port),
          username: ctx.target.username,
          password: ctx.target.password,
          namespace: ctx.target.namespace,
        },
      }),
    },
  );
  try {
    const result = await session.raw("iris_server_info", { server: "other" });
    if (result.isError) throw new Error(`iris_server_info on "other" failed: ${JSON.stringify(result.content)}`);
  } finally {
    await session.close();
  }
  return stderr;
}

/**
 * The reference: seed the embed under its own marker with no seed line, and read the instance back. It is the content every
 * upgraded document must equal, as the same instance renders it.
 */
export async function referenceSnapshot(target: IrisTarget, embedded: EmbeddedBootstrap): Promise<Snapshot> {
  await seedInstance(target, embedded, { marker: embedded.marker, perturb: false });
  return snapshotInstance(target, embedded.classes.keys());
}

/** Seed the instance for `leg`, take the snapshots, and run each server start of the leg. */
export async function runLeg(leg: LegSpec, ctx: LegContext): Promise<LegOutcome> {
  const seedMarker = leg.seedMarker(stampedEmbedded(ctx.embedded));
  await seedInstance(ctx.target, ctx.embedded, { marker: seedMarker, perturb: leg.perturb, guard: leg.guard === true });
  // The guard document is snapshotted with the classes when the leg seeds it: left alone means it too is byte-identical.
  const names = [...ctx.embedded.classes.keys(), ...(leg.guard === true ? [GUARD_DOC] : [])];
  const seeded = await snapshotInstance(ctx.target, names);
  const runs: LegRun[] = [];
  for (let start = 0; start < leg.expect.length; start += 1) {
    ctx.onServerWindow?.("start");
    let stderr: string;
    try {
      stderr = await runServer(leg.via, ctx);
    } finally {
      ctx.onServerWindow?.("stop");
    }
    runs.push({ stderr, after: await snapshotInstance(ctx.target, names) });
  }
  return { leg, seedMarker, seeded, runs };
}

/**
 * What is wrong with a leg's outcome, as sentences; an empty list means the leg held. `reference` is the content an
 * upgraded document must equal.
 */
export function verifyLeg(outcome: LegOutcome, embedded: EmbeddedBootstrap, reference: Snapshot): string[] {
  const problems: string[] = [];
  const names = [...embedded.classes.keys()];
  const { leg } = outcome;

  if (outcome.runs.length !== leg.expect.length) {
    problems.push(`the leg started ${outcome.runs.length} servers, expected ${leg.expect.length}`);
  }
  // The seed must be observable: a perturbed seed differs from the reference in every document, an unperturbed one equals it.
  const seededVsReference = contentDifferences(reference, outcome.seeded);
  if (leg.perturb && seededVsReference.length !== names.length) {
    problems.push(`the seed left ${names.length - seededVsReference.length} documents equal to the reference, so an unchanged document could not be told from a rewritten one`);
  }
  if (!leg.perturb && seededVsReference.length !== 0) {
    problems.push(`the unperturbed seed differs from the reference in ${seededVsReference.join(", ")}`);
  }

  leg.expect.forEach((expectation, index) => {
    const run = outcome.runs[index];
    if (run === undefined) return;
    const before = index === 0 ? outcome.seeded : (outcome.runs[index - 1] as LegRun).after;
    const deployed = index === 0 ? outcome.seedMarker : embedded.marker;
    const label = `start ${index + 1} (${expectation})`;
    const leaving = leavingLines(run.stderr);
    const unchanged = snapshotDifferences(before, run.after);

    if (expectation === "newer" || expectation === "foreign" || expectation === "ipm") {
      if (unchanged.length > 0) problems.push(`${label}: the instance changed: ${unchanged.join("; ")}`);
      if (leaving.length !== 1) {
        problems.push(`${label}: expected exactly one "Bootstrap: leaving the ExecuteMCPv2 classes" line, found ${leaving.length}`);
      } else {
        const line = leaving[0] as string;
        if (!line.startsWith("[WARN] ")) problems.push(`${label}: the line is not a [WARN]: ${line}`);
        if (!line.includes(JSON.stringify(deployed))) problems.push(`${label}: the warning does not name the deployed marker ${JSON.stringify(deployed)}`);
        if (!line.includes(embedded.marker)) problems.push(`${label}: the warning does not name the embedded marker ${embedded.marker}`);
        for (const remedy of REMEDY[expectation]) {
          if (!line.includes(remedy)) problems.push(`${label}: the warning does not carry the remedy text ${JSON.stringify(remedy)}`);
        }
        if (expectation === "ipm") {
          // The zpm command names this build's package version: the semver of the embedded marker.
          const install = `zpm "install iris-execute-mcp-v2 ${embedded.marker.split("+")[0]}"`;
          if (!line.includes(install)) problems.push(`${label}: the warning does not carry the command ${install}`);
          if (line.includes("had already uploaded") || line.includes("found just before compiling")) {
            problems.push(`${label}: the warning is the re-check's, but an IPM installation is found at startup, before anything is uploaded: ${line}`);
          }
        }
      }
      if (run.stderr.includes("Bootstrap: upgrading REST service")) problems.push(`${label}: the server upgraded a deployment it must leave alone`);
      return;
    }

    if (leaving.length > 0) problems.push(`${label}: the server warned that it left the classes alone: ${leaving[0]}`);
    if (expectation === "upgraded") {
      const rewritten = contentDifferences(reference, run.after);
      if (rewritten.length > 0) problems.push(`${label}: ${rewritten.length} documents do not equal the reference: ${rewritten.slice(0, 5).join(", ")}`);
      if (run.after.compiledMarker !== embedded.marker) {
        problems.push(`${label}: the compiled marker is ${JSON.stringify(run.after.compiledMarker)}, expected the shipped ${embedded.marker}`);
      }
      const upgrading = `Bootstrap: upgrading REST service from version ${deployed} to ${embedded.marker}`;
      if (!run.stderr.includes(upgrading)) problems.push(`${label}: stderr does not carry "${upgrading}"`);
      return;
    }
    if (unchanged.length > 0) problems.push(`${label}: the instance changed: ${unchanged.join("; ")}`);
    if (!run.stderr.includes(`Bootstrap: REST service is current (version ${embedded.marker})`)) {
      problems.push(`${label}: stderr does not report the classes current at ${embedded.marker}`);
    }
  });
  return problems;
}
