/**
 * Auto-bootstrap orchestration for the ExecuteMCPv2 REST service.
 *
 * Detects whether the custom REST service is deployed on IRIS, and if
 * not, deploys the ObjectScript classes, compiles them, and registers
 * the web application -- all via the Atelier REST API.
 *
 * The bootstrap is idempotent: if the service is already configured,
 * all steps are skipped. It never downgrades: the deployed version marker is
 * ordered against this build's marker (see `bootstrap-version.ts`), and only a
 * provably absent or an older deployment is (re)deployed. A marker that cannot
 * be read while the `ExecuteMCPv2.Setup` class is not provably absent is
 * `unknown`, and nothing is deployed over it.
 *
 * It never redeploys an IPM installation either: when the IPM-only
 * `ExecuteMCPv2.InstallGuard` class is present, IPM owns the classes, and a
 * deployment that would write (`stale`, `unconfigured`, `missing`) writes nothing
 * and logs one warning naming the `zpm` command.
 */

import { IrisHttpClient, type AtelierEnvelope } from "./http-client.js";
import type { IrisConnectionConfig } from "./config.js";
import { atelierPath } from "./atelier.js";
import { IrisApiError } from "./errors.js";
import { logger } from "./logger.js";
import { BOOTSTRAP_CLASSES, BOOTSTRAP_VERSION, IPM_INSTALL_GUARD, IPM_MODULE_NAME } from "./bootstrap-classes.js";
import { classifyDeployedMarker, parseBootstrapMarker } from "./bootstrap-version.js";
import type { AutoInstallSource } from "./auto-install.js";
import type { IrisSideRefusal } from "./errors.js";

/** The Atelier document that carries the version marker. */
const SETUP_DOCUMENT = "ExecuteMCPv2.Setup.cls";

/** The semver of this build's marker: the version of `@iris-mcp/shared`, and the version of the IPM package. */
const PACKAGE_SEMVER = BOOTSTRAP_VERSION.split("+")[0] as string;

/**
 * Probe result.
 *
 * - `missing`: the REST service is provably not deployed: the version query
 *    returned no marker AND the Atelier document route answers HTTP 404 for
 *    `ExecuteMCPv2.Setup.cls` (the class does not exist). Bootstrap runs the
 *    full deploy + compile + configure + mapping flow.
 *
 * - `unknown`: the version query failed or returned no marker (an HTTP error,
 *    a timeout, a privilege error, an empty value, or a `Setup` class from
 *    before the version stamp that has no `GetBootstrapVersion` method), and
 *    the `Setup` class is NOT provably absent (the document route found it, or
 *    could not be asked). The deployment may be newer than this build, so
 *    bootstrap changes nothing and warns, naming the failure and the remedy.
 *
 * - `current`: the deployed classes carry the embedded marker AND the web
 *    application is registered. Bootstrap skips the deploy, and runs the
 *    compile check ({@link verifyCompiled}) so that a class an earlier start
 *    failed to compile is reported again.
 *
 * - `unconfigured`: the deployed classes carry the embedded marker, but the
 *    `/api/executemcp/v2` web application is NOT registered. The version
 *    stamp lives inside the Setup class and is present the moment
 *    deploy+compile succeed — independent of the separate, %Admin_Manage-
 *    gated `Configure` step. This divergence happens whenever %SYS state and
 *    the code-bearing database part ways: a container migration or %SYS
 *    restore that keeps a persisted code DB, a first install where Configure
 *    failed (e.g. missing privileges), etc. Bootstrap does NOT redeploy (the
 *    source is current); it recompiles, checks that every class compiled, and
 *    only then re-runs the privileged one-time steps (web app registration +
 *    package mapping + ^UnitTestRoot). A failed compile stops before them. This
 *    is the self-healing path.
 *
 * - `stale`: the REST service is deployed from an OLDER build than this one
 *    (a lower semver, the same semver with a lower sequence, or a legacy bare
 *    hash). Bootstrap redeploys and recompiles the classes, but skips the
 *    one-time privileged steps (web app registration + package mapping),
 *    because those aren't affected by class-content drift.
 *
 * - `newer`: the REST service is deployed from a NEWER build than this one.
 *    Bootstrap changes nothing and warns, so an older server on a shared
 *    instance can never downgrade the classes.
 *
 * - `foreign`: the deployed marker cannot be ordered against this build's:
 *    the same semver and sequence with a different hash, the `dev`
 *    placeholder, or an unparseable value. Bootstrap changes nothing and warns.
 */
export type ProbeResult =
  | { status: "missing" }
  | { status: "current" }
  | { status: "unconfigured" }
  | { status: "stale"; deployedVersion: string }
  | { status: "newer"; deployedVersion: string }
  | { status: "foreign"; deployedVersion: string }
  | { status: "unknown"; reason: string };

/** Result of a full bootstrap run. */
export interface BootstrapResult {
  /** Whether the probe detected the REST service is already configured. */
  probeFound: boolean;
  /**
   * The probe result — lets callers distinguish first-time install from
   * auto-upgrade. When the marker re-read just before a compile finds a newer
   * or foreign deployment, or cannot read the marker, this names that finding
   * instead.
   */
  probeStatus: "missing" | "current" | "unconfigured" | "stale" | "newer" | "foreign" | "unknown";
  /** The marker found on the instance, when it was `stale`, `newer` or `foreign`. */
  deployedVersion?: string;
  /**
   * Why the deployed marker could not be read, or why the IPM ownership of the
   * classes could not be checked, when `probeStatus` is `unknown`.
   */
  readFailure?: string;
  /**
   * `true` when the IPM-only `ExecuteMCPv2.InstallGuard` class is present: IPM
   * installed the classes there, so a deployment that would write left them
   * alone. Present only when `true`.
   */
  ipmOwned?: boolean;
  /**
   * The channel that turned the automatic install off for this profile (Story 45.2). Present only when it
   * is off: bootstrap then sent reads only, on every branch.
   */
  autoInstallOff?: AutoInstallSource;
  /**
   * `true` when the install is off and the IRIS side is `missing`, `stale` or `unconfigured` (and not
   * IPM-owned): the profile's client must refuse every request to the custom REST service
   * ({@link buildIrisSideRefusal}). Present only when `true`.
   */
  customRestRefused?: true;
  /** Whether class deployment succeeded. */
  deployed: boolean;
  /** Whether class compilation succeeded. */
  compiled: boolean;
  /** Whether web application registration succeeded. */
  configured: boolean;
  /** Whether package mapping to %All was created. */
  mapped: boolean;
  /** Whether ^UnitTestRoot was ensured in the configured namespace. */
  unitTestRootEnsured: boolean;
  /** The resulting ^UnitTestRoot value in the configured namespace, if ensured. */
  unitTestRoot?: string;
  /** Errors encountered during bootstrap steps. */
  errors: string[];
  /** Manual instructions when configure step fails. */
  manualInstructions?: string;
}

/** Manual instructions shown when the configure step fails. */
export const MANUAL_INSTRUCTIONS = `The ExecuteMCPv2 classes have been deployed and compiled, but web application
registration requires %Admin_Manage privileges.

To complete setup manually, choose one of:

1. Terminal: Open an IRIS Terminal in %SYS namespace and run:
   Do ##class(ExecuteMCPv2.Setup).Configure("NAMESPACE")
   (Replace NAMESPACE with your target namespace, e.g. "HSCUSTOM")

2. Management Portal: Navigate to System Administration > Security > Applications > Web Applications
   Create application "/api/executemcp/v2" with:
   - Namespace: your target namespace (e.g. HSCUSTOM)
   - Enable: REST, Dispatch Class: ExecuteMCPv2.REST.Dispatch
   - Allowed Authentication: Password
   - Resource Required: %Development

3. IPM (InterSystems Package Manager 0.10 or later, installed in the target namespace): in the target
   namespace, as a user with %Admin_Manage, run:
   zpm "install ${IPM_MODULE_NAME} ${PACKAGE_SEMVER}"
   If zpm "repo -list" shows no registry, run this first:
   zpm "repo -r -n registry -reset-defaults"
   IPM then owns the classes there, and this server never redeploys them.`;

/** What reading the deployed marker produced: the marker, or why none was read. */
type MarkerRead = { kind: "marker"; marker: string } | { kind: "unread"; reason: string };

/** `text` on one line, cut at `limit` characters, for a log line. */
function oneLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}...` : flat;
}

/** A failed request as one short line. */
function describeFailure(error: unknown): string {
  return oneLine(error instanceof Error ? error.message : String(error), 200);
}

/**
 * Read the version marker stamped into the deployed `ExecuteMCPv2.Setup`
 * class by calling `ExecuteMCPv2.Setup_GetBootstrapVersion()` via the
 * Atelier SQL endpoint.
 *
 * Returns `unread` with the reason when no marker can be read: the query
 * fails (for any reason, whatever HTTP status or error text IRIS answers
 * with), or it returns no row or an empty value. Never throws. A failed read
 * says nothing about whether a deployment exists; {@link documentAbsence}
 * decides that.
 */
async function readDeployedVersion(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
): Promise<MarkerRead> {
  try {
    const path = atelierPath(version, config.namespace, "action/query");
    const body = {
      query: "SELECT ExecuteMCPv2.Setup_GetBootstrapVersion() AS Version",
    };
    const response = await http.post(path, body);
    const content = (
      response.result as { content?: Record<string, unknown>[] }
    )?.content;
    if (Array.isArray(content) && content.length > 0) {
      const row = content[0] as Record<string, unknown>;
      const marker = String(row["Version"] ?? "");
      if (marker !== "") return { kind: "marker", marker };
    }
    return { kind: "unread", reason: "the version query returned no marker" };
  } catch (error: unknown) {
    return { kind: "unread", reason: `the version query failed: ${describeFailure(error)}` };
  }
}

/**
 * What the Atelier document route says about one class document: `absent` when
 * it is provably missing, `found` when it exists, `unreadable` when the request
 * failed some other way.
 */
type DocumentAbsence =
  | { absent: true }
  | { absent: false; found: true; reason: string }
  | { absent: false; found: false; reason: string };

/**
 * Whether a class document is provably absent: the Atelier document route
 * answers HTTP 404 for it (Atelier's `GetDoc` answers 404 exactly when the
 * document does not exist). Any other answer is not a positive absence: a
 * found document, or a request that failed some other way, which `reason`
 * names. Never throws.
 */
async function documentAbsence(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
  document: string,
): Promise<DocumentAbsence> {
  const subject = `the ${document.replace(/\.cls$/, "")} class`;
  try {
    await http.get(atelierPath(version, config.namespace, `doc/${document}`));
    return { absent: false, found: true, reason: `${subject} exists` };
  } catch (error: unknown) {
    if (error instanceof IrisApiError && error.statusCode === 404) return { absent: true };
    return {
      absent: false,
      found: false,
      reason: `whether ${subject} exists could not be checked: ${describeFailure(error)}`,
    };
  }
}

/** Who owns the classes on an instance: IPM (the install guard is present), nobody in particular, or not known. */
type IpmOwnership = { owner: "ipm" } | { owner: "none" } | { owner: "unknown"; reason: string };

/**
 * Whether IPM installed the classes: the IPM-only `ExecuteMCPv2.InstallGuard`
 * document answers 200 (`ipm`) or is provably absent with a 404 (`none`). Any
 * other failure is `unknown`, with the reason. Never throws.
 */
async function ipmOwnership(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
): Promise<IpmOwnership> {
  const guard = await documentAbsence(http, config, version, IPM_INSTALL_GUARD.name);
  if (guard.absent) return { owner: "none" };
  return guard.found ? { owner: "ipm" } : { owner: "unknown", reason: guard.reason };
}

/**
 * Probe the custom REST service deployment status on IRIS.
 *
 * Reads the marker stamped into the deployed Setup class
 * (`ExecuteMCPv2.Setup_GetBootstrapVersion()` via the Atelier SQL endpoint)
 * and orders it against the embedded {@link BOOTSTRAP_VERSION} with
 * `classifyDeployedMarker`.
 *
 * Outcomes:
 *
 * - No marker can be read (the SQL query fails for any reason, or returns no
 *   row or an empty value). The probe then asks whether the `Setup` class is
 *   provably absent ({@link documentAbsence}):
 *   - the document route answers 404 → `{ status: "missing" }`, the full
 *     install. This is a first-time install where nothing has been deployed.
 *   - anything else → `{ status: "unknown", reason }`. The class exists (or
 *     its existence could not be checked), so the failed read may be a
 *     transient 5xx, a timeout or a privilege error over a newer deployment,
 *     and bootstrap leaves it alone. A deployment from before the version
 *     stamp (a `Setup` class with no `GetBootstrapVersion()` method) lands
 *     here too; deleting the class `ExecuteMCPv2.Setup` makes it absent.
 *
 * - Returned marker equals `BOOTSTRAP_VERSION` → the classes are current,
 *   but a matching version does NOT prove the web application is
 *   registered (the version stamp lives in the Setup class and is present
 *   the moment deploy+compile succeed, independent of the privileged
 *   `Configure` step). We therefore call `ExecuteMCPv2.Setup_IsConfigured()`
 *   to verify the actual `/api/executemcp/v2` registration:
 *   - registered → `{ status: "current" }` (skip the deploy; `bootstrap()`
 *     still runs the read-only compile check).
 *   - not registered → `{ status: "unconfigured" }` (re-run the privileged
 *     steps only — self-heal). This covers the %SYS-refreshed-but-code-DB-
 *     persisted case (container migration, %SYS restore) and a first install
 *     whose `Configure` failed.
 *   - If the `IsConfigured()` query itself fails on a version-matched
 *     deployment (the proc cannot be missing at a matching version, so this
 *     is essentially unreachable), we conservatively fall back to
 *     `{ status: "current" }` rather than spam privileged Configure attempts
 *     for an indeterminate state.
 *
 * - Returned marker is OLDER (a legacy bare hash, a lower semver, or the same
 *   semver with a lower sequence) → `{ status: "stale", deployedVersion }`.
 *   An older build ran bootstrap; we need to redeploy and recompile but the
 *   webapp registration and package mapping (privileged, one-time
 *   operations) can be skipped.
 *
 * - Returned marker is NEWER → `{ status: "newer", deployedVersion }`, and
 *   FOREIGN (same semver and sequence with another hash, `dev`, anything
 *   unparseable) → `{ status: "foreign", deployedVersion }`. Neither makes an
 *   `IsConfigured()` call: bootstrap leaves the deployment alone.
 */
export async function probeCustomRest(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
): Promise<ProbeResult> {
  // Only a positive absence installs: a read that fails while the Setup class
  // exists (or cannot be checked) is `unknown`, never `missing`.
  const read = await readDeployedVersion(http, config, version);
  if (read.kind === "unread") {
    const absence = await documentAbsence(http, config, version, SETUP_DOCUMENT);
    if (absence.absent) return { status: "missing" };
    return { status: "unknown", reason: `${read.reason}, and ${absence.reason}` };
  }
  const deployedVersion = read.marker;
  const classification = classifyDeployedMarker(deployedVersion, BOOTSTRAP_VERSION);
  if (classification === "older") {
    return { status: "stale", deployedVersion };
  }
  if (classification === "newer" || classification === "foreign") {
    return { status: classification, deployedVersion };
  }
  // The marker matches, but that only proves the classes are present —
  // not that the privileged web-app registration ever completed.
  // Verify the actual configured state before declaring "current".
  let configured: boolean;
  try {
    configured = await isConfigured(http, config, version);
  } catch {
    // IsConfigured() cannot be missing on a version-matched
    // deployment, so a throw here means an indeterminate SQL/infra
    // failure — not evidence the web app is absent. Preserve the
    // fast skip path rather than re-attempting privileged steps.
    return { status: "current" };
  }
  return configured ? { status: "current" } : { status: "unconfigured" };
}

/**
 * Check whether the `/api/executemcp/v2` web application is actually
 * registered on IRIS.
 *
 * Calls `ExecuteMCPv2.Setup_IsConfigured()` via the Atelier SQL endpoint,
 * which checks `Security.Applications.Exists("/api/executemcp/v2")` in the
 * `%SYS` namespace. This is the authoritative test for the privileged
 * `Configure` step — separate from, and not implied by, the class version
 * stamp checked in {@link probeCustomRest}.
 *
 * Returns `true` only when the query succeeds AND reports the web app
 * exists. Returns `false` when the query reports it does not exist (or
 * returns no row). **Throws** when the SQL call itself fails (proc missing
 * / privilege / infra error) — the caller decides how to treat an
 * indeterminate result.
 */
export async function isConfigured(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
): Promise<boolean> {
  const path = atelierPath(version, config.namespace, "action/query");
  const body = {
    query: "SELECT ExecuteMCPv2.Setup_IsConfigured() AS Configured",
  };
  const response = await http.post(path, body);
  const content = (response.result as { content?: Record<string, unknown>[] })
    ?.content;
  if (Array.isArray(content) && content.length > 0) {
    const row = content[0] as Record<string, unknown>;
    // IRIS renders a %Boolean SqlProc result as 1/0; tolerate the numeric,
    // string, and boolean JSON encodings.
    const configured = String(row["Configured"] ?? "0").toLowerCase();
    return configured === "1" || configured === "true";
  }
  return false;
}

/**
 * Deploy all embedded ObjectScript classes to IRIS via the Atelier PUT /doc endpoint.
 *
 * Each class is sent as a separate PUT request with `{ enc: false, content: lines[] }`.
 *
 * The `?ignoreConflict=1` query parameter tells Atelier to force-overwrite
 * existing documents regardless of their server-side timestamps. Without
 * this flag, Atelier performs a concurrency check and returns HTTP 409 when
 * the server copy is considered newer than the incoming upload — which is
 * always the case on an auto-upgrade because the server has an older
 * compiled class with an updated modification timestamp relative to the
 * embedded content. The old binary probe ("is anything deployed?") hid
 * this issue because it skipped deploy entirely for existing installs; the
 * tri-state probe exposed it because stale upgrades always land on
 * already-present documents.
 *
 * `classes` (document name to source text) defaults to the embedded
 * bootstrap classes; a caller that deploys other documents (the CI seed's
 * test fixtures) passes its own map.
 */
export async function deployClasses(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
  classes: ReadonlyMap<string, string> = BOOTSTRAP_CLASSES,
): Promise<void> {
  for (const [name, content] of classes.entries()) {
    const path =
      atelierPath(version, config.namespace, `doc/${name}`) +
      "?ignoreConflict=1";
    await http.put(path, {
      enc: false,
      content: content.split("\n"),
    });
  }
}

/**
 * Compile deployed classes via the Atelier POST /action/compile endpoint.
 *
 * `names` defaults to every embedded bootstrap class. The Atelier response
 * is returned, so a caller that compiles other documents can read the
 * compile output. A compile that answered is not thereby a compile that
 * succeeded: IRIS answers HTTP 200 with no status error when only some classes
 * failed (a compile that also writes a class's Storage replaces the compile
 * status), and the console is localized text. Use {@link compileAndVerify} to
 * judge it.
 */
export async function compileClasses(
  http: IrisHttpClient,
  config: Pick<IrisConnectionConfig, "namespace">,
  version: number,
  names: readonly string[] = [...BOOTSTRAP_CLASSES.keys()],
): Promise<AtelierEnvelope<unknown>> {
  const path = atelierPath(version, config.namespace, "action/compile");
  return http.post(path, [...names]);
}

/** What {@link compileAndVerify} found out about one compile. */
export interface CompileReport {
  /**
   * The documents (`Pkg.Name.cls`), in the order of the list that was compiled, that the check does not confirm as
   * compiled: no compiled class, a compile error on it, or IRIS's own up-to-date flag false.
   */
  notCompiled: string[];
  /**
   * The `errors[].error` texts of a compile that IRIS answered with a status error; empty when IRIS answered without one.
   * A non-empty list makes the compile a failure even when `notCompiled` is empty. The texts are context for a person:
   * IRIS names at most one failed class there, so they never decide which classes failed.
   */
  irisErrors: string[];
  /** The compile's response envelope, when IRIS answered it without a status error; absent when it answered with one. */
  envelope?: AtelierEnvelope<unknown>;
}

/** The SQL of the compile check: one row per class definition among the `count` names, with whether it compiled and whether it carries a compile error. */
/**
 * The most class names one compile-check query carries. Atelier's query handler fails with `<STACK>` (#5002) on an `IN` list of
 * about 400 parameters (probe 2026-11-23, irishealth-community 2026.2: 375 names answered, 400 failed), so a larger check is
 * sent in batches of this size.
 */
export const COMPILE_CHECK_BATCH = 100;

function compileCheckQuery(count: number): string {
  return (
    "SELECT d.ID AS ID, CASE WHEN c.ID IS NULL THEN 0 ELSE 1 END AS Compiled, " +
    "CASE WHEN c.ClassCompileError IS NULL OR c.ClassCompileError = '' THEN 0 ELSE 1 END AS CompileError " +
    "FROM %Dictionary.ClassDefinition d LEFT JOIN %Dictionary.CompiledClass c ON c.ID = d.ID " +
    `WHERE d.ID IN (${Array.from({ length: count }, () => "?").join(", ")})`
  );
}

/** Refuse a document name that is not a class (`Pkg.Name.cls`): the check reads the class dictionary. */
function assertClassDocuments(names: readonly string[]): void {
  const other = names.find((name) => !name.endsWith(".cls") || name.length <= ".cls".length);
  if (other !== undefined) {
    throw new Error(`the compile check reads the class dictionary, so it takes class documents ending in .cls; ${JSON.stringify(other)} is not one.`);
  }
}

/**
 * Decide, for each class in `names`, whether it is compiled. The decision reads no localized text and never trusts the
 * answer of the compile request. A class counts as compiled only when all three hold:
 *
 * - the class dictionary has a compiled class for it (`%Dictionary.CompiledClass`);
 * - that compiled class carries no compile error (`ClassCompileError`);
 * - Atelier's `docnames` lists the class with `upd` true, which is IRIS's own up-to-date judgment (it also holds for a
 *   rollback to identical content, and is false for a class skipped because a dependency failed).
 *
 * The reads: one `action/query` over the dictionary per {@link COMPILE_CHECK_BATCH} names, and one `docnames/CLS?filter=` GET
 * per distinct first name segment (the package root) of `names`. Returns the documents that are not confirmed, in the order of
 * `names`.
 *
 * @throws {Error} When a name does not end in `.cls`, and whatever the two requests throw: a check that cannot run is never
 *   a pass.
 */
export async function verifyCompiled(
  http: IrisHttpClient,
  namespace: string,
  version: number,
  names: readonly string[],
): Promise<string[]> {
  assertClassDocuments(names);
  if (names.length === 0) return [];
  const ids = names.map((name) => name.slice(0, -".cls".length));

  // The dictionary query matches IDs exactly, while the docnames filter ignores case, and IRIS refuses a class whose name
  // differs from an existing one only in case. So keying the verdicts by the lowercase name never merges two classes, and a
  // name asked in another case than the class's own gets no row and is named.
  const clean = new Set<string>();
  for (let start = 0; start < ids.length; start += COMPILE_CHECK_BATCH) {
    const batch = ids.slice(start, start + COMPILE_CHECK_BATCH);
    const rows = await http.post(atelierPath(version, namespace, "action/query"), {
      query: compileCheckQuery(batch.length),
      parameters: batch,
    });
    const content = (rows.result as { content?: Array<Record<string, unknown>> } | undefined)?.content;
    for (const row of Array.isArray(content) ? content : []) {
      if (Number(row["Compiled"]) === 1 && Number(row["CompileError"]) === 0) clean.add(String(row["ID"]).toLowerCase());
    }
  }

  const updated = await upToDateDocuments(http, namespace, version, "CLS", ids);

  return names.filter((name, index) => !(clean.has((ids[index] as string).toLowerCase()) && updated.has(name.toLowerCase())));
}

/**
 * The lower-cased names of the documents of `category` that IRIS lists as up to date (`upd: true`): one
 * `docnames/<category>?filter=` GET per distinct first name segment (the package root) of `stems` (document names without
 * their extension). The filter is a "name contains" read, so the entries of other packages come back too; the callers match by name.
 */
async function upToDateDocuments(
  http: IrisHttpClient,
  namespace: string,
  version: number,
  category: "CLS" | "RTN",
  stems: readonly string[],
): Promise<Set<string>> {
  const updated = new Set<string>();
  const roots = [...new Set(stems.map((stem) => stem.split(".")[0] as string))];
  for (const root of roots) {
    const listed = await http.get(
      atelierPath(version, namespace, `docnames/${category}?filter=${encodeURIComponent(`${root}.`)}`),
    );
    const entries = (listed.result as { content?: Array<Record<string, unknown>> } | undefined)?.content;
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry["upd"] === true) updated.add(String(entry["name"]).toLowerCase());
    }
  }
  return updated;
}

/**
 * Decide, for each routine document in `names` (`Pkg.Name.mac`), whether the compile that covered it confirmed it (Story 44.7,
 * DW-759). IRIS answers a compile with HTTP 200, no status error and no per-document error when a routine fails in a compile
 * that also writes a persistent class's Storage, so the answer proves nothing. Atelier's `docnames/RTN` lists each routine
 * with IRIS's own up-to-date flag (`upd`), which is false for a routine that did not compile and true once it did (probe
 * 2026-11-23, irishealth-community 2026.2: failing `.mac` false, clean `.mac` true, an uncompiled one false). The decision reads no
 * localized text.
 *
 * Only `.mac` documents are judged. The flag of an include file (`.inc`) is true whether or not anything compiled it, and the
 * flag of an `.int` is true after a failed compile too (same probe), so neither can be decided from it.
 *
 * One `docnames/RTN?filter=` GET per distinct first name segment. Returns the unconfirmed documents in the order of `names`.
 *
 * @throws {Error} When a name does not end in `.mac`, and whatever the requests throw: a check that cannot run is never a pass.
 */
export async function verifyRoutinesCompiled(
  http: IrisHttpClient,
  namespace: string,
  version: number,
  names: readonly string[],
): Promise<string[]> {
  const other = names.find((name) => !name.endsWith(".mac") || name.length <= ".mac".length);
  if (other !== undefined) {
    throw new Error(`the routine compile check reads the up-to-date flag of .mac routines, so it takes documents ending in .mac; ${JSON.stringify(other)} is not one.`);
  }
  if (names.length === 0) return [];
  const updated = await upToDateDocuments(http, namespace, version, "RTN", names.map((name) => name.slice(0, -".mac".length)));
  return names.filter((name) => !updated.has(name.toLowerCase()));
}

/** What one compile and its check came to: a report, or which of the two stages failed to answer. */
type CompileOutcome =
  | { kind: "report"; report: CompileReport }
  | { kind: "compile-failed"; error: unknown }
  | { kind: "check-failed"; error: unknown };

/** The text of one Atelier status error entry. */
function statusErrorText(entry: unknown): string {
  if (entry !== null && typeof entry === "object" && typeof (entry as { error?: unknown }).error === "string") {
    return (entry as { error: string }).error;
  }
  return typeof entry === "string" ? entry : JSON.stringify(entry);
}

/** Compile `names`, then check them; the stage that did not answer is named, never confused with a verdict. */
async function compileWithCheck(
  http: IrisHttpClient,
  config: Pick<IrisConnectionConfig, "namespace">,
  version: number,
  names: readonly string[],
): Promise<CompileOutcome> {
  assertClassDocuments(names);
  let envelope: AtelierEnvelope<unknown> | undefined;
  let irisErrors: string[] = [];
  try {
    envelope = await compileClasses(http, config, version, names);
  } catch (error: unknown) {
    // A status error with HTTP 2xx is a compile IRIS answered: keep its texts and check what compiled. Anything else is a
    // compile request that got no Atelier answer, and there is nothing to check.
    if (!(error instanceof IrisApiError) || error.statusCode < 200 || error.statusCode >= 300) {
      return { kind: "compile-failed", error };
    }
    irisErrors = error.errors.map(statusErrorText);
  }
  let notCompiled: string[];
  try {
    notCompiled = await verifyCompiled(http, config.namespace, version, names);
  } catch (error: unknown) {
    return { kind: "check-failed", error };
  }
  return { kind: "report", report: { notCompiled, irisErrors, ...(envelope === undefined ? {} : { envelope }) } };
}

/**
 * Compile `names` (default: every embedded bootstrap class) and check that each one compiled ({@link verifyCompiled}).
 * This, and nothing in the compile's own answer, is how a caller judges a compile.
 *
 * A compile that IRIS answers with a status error (HTTP 2xx) is not thrown: its texts are in `irisErrors`, and the check
 * still names every class that did not compile.
 *
 * @throws The error of a compile request that got no Atelier answer (a transport error, a non-2xx status), unchanged and
 *   with no check request sent; and an `Error` ("the check that every class compiled could not run: ...") when the check's
 *   own requests fail.
 */
export async function compileAndVerify(
  http: IrisHttpClient,
  config: Pick<IrisConnectionConfig, "namespace">,
  version: number,
  names: readonly string[] = [...BOOTSTRAP_CLASSES.keys()],
): Promise<CompileReport> {
  const outcome = await compileWithCheck(http, config, version, names);
  if (outcome.kind === "report") return outcome.report;
  if (outcome.kind === "check-failed") {
    throw new Error(`the check that every class compiled could not run: ${describeFailure(outcome.error)}`);
  }
  throw outcome.error;
}

/**
 * The `Compile failed: ...` error text of a report (one line, no localized text), or `undefined` when the report is clean.
 * `total` is the number of classes that were compiled.
 */
function compileFailureText(report: CompileReport, total: number): string | undefined {
  const reported = oneLine(report.irisErrors.join(" | "), 300);
  if (report.notCompiled.length > 0) {
    const names = report.notCompiled.map((name) => name.replace(/\.cls$/, "")).join(", ");
    const context = report.irisErrors.length > 0 ? `. IRIS reported: ${reported}` : "";
    return `Compile failed: ${report.notCompiled.length} of ${total} classes did not compile: ${names}${context}`;
  }
  if (report.irisErrors.length > 0) return `Compile failed: IRIS reported errors: ${reported}`;
  return undefined;
}

/** The text for a check whose own requests failed. */
function checkCouldNotRunText(error: unknown): string {
  return `Compile failed: the check that every class compiled could not run: ${describeFailure(error)}`;
}

/**
 * Compile the embedded classes and confirm that every one compiled. Records the verdict in `result` (`compiled`, and the
 * `Compile failed: ...` text in `errors`), logs `success` only for a confirmed compile, and returns whether the compile is
 * confirmed. A failed or unverifiable compile returns `false`: the caller then runs none of the privileged steps.
 */
async function compileEmbedded(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
  result: BootstrapResult,
  success: string,
): Promise<boolean> {
  const outcome = await compileWithCheck(http, config, version, [...BOOTSTRAP_CLASSES.keys()]);
  if (outcome.kind === "compile-failed") {
    const msg = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    result.errors.push(`Compile failed: ${msg}`);
    return false;
  }
  if (outcome.kind === "check-failed") {
    result.errors.push(checkCouldNotRunText(outcome.error));
    return false;
  }
  const failure = compileFailureText(outcome.report, BOOTSTRAP_CLASSES.size);
  if (failure !== undefined) {
    result.errors.push(failure);
    return false;
  }
  result.compiled = true;
  logger.info(success);
  return true;
}

/**
 * Register the web application by calling `ExecuteMCPv2.Setup_Configure()`
 * via the Atelier SQL endpoint.
 */
export async function configureWebApp(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
): Promise<void> {
  const path = atelierPath(version, config.namespace, "action/query");
  const body = {
    query: "SELECT ExecuteMCPv2.Setup_Configure(?) AS ConfigureResult",
    parameters: [config.namespace],
  };
  await http.post(path, body);
}

/**
 * Ensure `^UnitTestRoot` is defined in the target namespace.
 *
 * `%UnitTest.Manager.RunTest` (used by the Atelier `/work` endpoint with
 * `request: "unittest"`) requires this global to exist and be non-empty,
 * even when the `/noload` qualifier is set. When undefined it errors at an
 * internal "Finding directories" step and writes a partial result that
 * crashes `%Api.Atelier.v8::UnitTestResultToJSON` with a cryptic
 * `<SUBSCRIPT>` error.
 *
 * Calls `ExecuteMCPv2.Setup_EnsureUnitTestRoot()` via the Atelier SQL
 * endpoint against the supplied namespace. The classmethod is idempotent —
 * it sets `^UnitTestRoot = $System.Util.ManagerDirectory()` only when the
 * global is undefined or empty. Returns the resulting value.
 *
 * Used by both the bootstrap flow (one-time setup of the configured
 * namespace) and the `iris_execute_tests` handler (per-call coverage of
 * whatever target namespace the tool was invoked against).
 */
export async function ensureUnitTestRoot(
  http: IrisHttpClient,
  namespace: string,
  version: number,
): Promise<string> {
  const path = atelierPath(version, namespace, "action/query");
  const body = {
    query: "SELECT ExecuteMCPv2.Setup_EnsureUnitTestRoot() AS UnitTestRoot",
  };
  const response = await http.post(path, body);
  const content = (response.result as { content?: Record<string, unknown>[] })
    ?.content;
  if (Array.isArray(content) && content.length > 0) {
    const row = content[0] as Record<string, unknown>;
    return String(row["UnitTestRoot"] ?? "");
  }
  return "";
}

/**
 * Map the ExecuteMCPv2 package to %All namespace so compiled routines
 * (including I/O redirect mnemonic labels) are available in every namespace.
 * This enables cross-namespace `iris_execute_command` with I/O capture.
 */
export async function configurePackageMapping(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
): Promise<void> {
  const path = atelierPath(version, config.namespace, "action/query");
  const body = {
    query: "SELECT ExecuteMCPv2.Setup_ConfigureMapping(?) AS MappingResult",
    parameters: [config.namespace],
  };
  await http.post(path, body);
}

/**
 * Run the privileged one-time steps: web app registration + package mapping.
 *
 * Shared by every path that needs to create/repair the web application:
 * `missing` (first install), `unconfigured` (self-heal), and `stale` when the
 * web app is found to be absent. Mutates `result` in place — sets
 * `configured`/`mapped`, accumulates errors, and populates
 * `manualInstructions` if the (privileged) Configure step fails. Never throws:
 * a Configure failure is recorded so the caller can surface a partial install
 * and the next privileged launch self-heals.
 */
async function runPrivilegedSteps(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
  result: BootstrapResult,
): Promise<void> {
  // Web app registration (requires %Admin_Manage).
  try {
    await configureWebApp(http, config, version);
    result.configured = true;
    logger.info("Bootstrap: web application configured successfully");
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Configure failed: ${msg}`);
    result.manualInstructions = MANUAL_INSTRUCTIONS.replace(
      "NAMESPACE",
      config.namespace,
    );
  }

  // Package mapping to %All (non-fatal: only calls that name a namespace other
  // than the web app's depend on it: command exec and SQL).
  try {
    await configurePackageMapping(http, config, version);
    result.mapped = true;
    logger.info(
      "Bootstrap: ExecuteMCPv2 package mapped to %All namespace for cross-namespace support",
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Package mapping failed: ${msg}`);
    // Non-fatal: calls that name another namespace (iris_execute_command, iris_sql_execute, iris_sql_query) won't work but everything else will
  }
}

/**
 * Ensure `^UnitTestRoot` in the configured namespace. Independent step with its
 * own try/catch so a failure here never masks earlier successes. Mutates
 * `result` in place. iris_execute_tests re-ensures the global per-call in
 * whatever target namespace it was invoked against, so this only covers the
 * common case of tests against the configured namespace.
 */
async function ensureUnitTestRootStep(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
  result: BootstrapResult,
): Promise<void> {
  try {
    result.unitTestRoot = await ensureUnitTestRoot(
      http,
      config.namespace,
      version,
    );
    result.unitTestRootEnsured = true;
    logger.info(
      `Bootstrap: ^UnitTestRoot ensured in '${config.namespace}' (value: ${result.unitTestRoot})`,
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`EnsureUnitTestRoot failed: ${msg}`);
    // Non-fatal: iris_execute_tests will re-try per-call in the target namespace
  }
}

/** Render a marker read from the instance for a log line: quoted, escaped and at most 80 characters. */
function describeMarker(marker: string): string {
  return JSON.stringify(marker.length > 80 ? `${marker.slice(0, 80)}...` : marker);
}

/** An older marker found while the automatic install is off: what the `unknown` warning adds to its wording (Story 45.2). */
interface OlderWhileOff {
  /** The marker on the instance. */
  deployed: string;
  /** The channel that turned the install off. */
  source: AutoInstallSource;
}

/** How the channel that turned the automatic install off is named in a message. */
function autoInstallLabel(source: AutoInstallSource): string {
  if (source === "IRIS_GOVERNANCE_PRESET") return "IRIS_GOVERNANCE_PRESET=read-only";
  if (source === "IRIS_PROFILES") return "autoInstall: false in IRIS_PROFILES";
  return "IRIS_AUTO_INSTALL=false";
}

/** The way out of an install that one channel turned off, ending a sentence like "start one server against host:port ...". */
function autoInstallWayOut(source: AutoInstallSource): string {
  if (source === "IRIS_GOVERNANCE_PRESET") return "without the read-only preset";
  if (source === "IRIS_PROFILES") return "with the profile's autoInstall removed or true";
  return "with IRIS_AUTO_INSTALL unset or true";
}

/** The profile name a connection config carries (a profile has one; the startup config of `default` does not). */
function profileNameOf(config: IrisConnectionConfig): string {
  const name = (config as { name?: unknown }).name;
  return typeof name === "string" && name !== "" ? name : "default";
}

/** What the probe found, for a profile that cannot use the custom REST service: the sentence part naming the problem. */
function notInstalledFinding(
  found: "missing" | "stale" | "unconfigured",
  namespace: string,
  deployed: string | undefined,
): string {
  if (found === "missing") return `the ExecuteMCPv2 classes are not installed in '${namespace}'`;
  if (found === "stale") {
    return (
      `the ExecuteMCPv2 classes in '${namespace}' are from an older build (${deployed ?? "unknown marker"}; ` +
      `this server needs ${BOOTSTRAP_VERSION})`
    );
  }
  return (
    `the ExecuteMCPv2 classes in '${namespace}' are current, but the /api/executemcp/v2 web application is not registered ` +
    `(Do ##class(ExecuteMCPv2.Setup).Configure("${namespace}") as a user with %Admin_Manage also fixes this)`
  );
}

/**
 * The refusal a profile's client carries after a bootstrap that left the custom REST service unavailable (Story 45.2):
 * the text and the `structuredContent` fields of `IRIS_SIDE_NOT_INSTALLED`. `result` is the bootstrap's result with
 * `customRestRefused` set; its `probeStatus` (`missing`, `stale` or `unconfigured`) is the finding.
 *
 * Neither the text nor the fields carry a credential.
 *
 * @param config - The profile's connection config (host, port, namespace, name, `autoInstallSource`).
 * @param result - The result of {@link bootstrap} for that profile.
 */
export function buildIrisSideRefusal(config: IrisConnectionConfig, result: BootstrapResult): IrisSideRefusal {
  const found = result.probeStatus as "missing" | "stale" | "unconfigured";
  const source = result.autoInstallOff ?? config.autoInstallSource ?? "IRIS_AUTO_INSTALL";
  const profile = profileNameOf(config);
  const namespace = config.namespace;
  const deployed = found === "stale" ? result.deployedVersion : undefined;
  const text =
    `The ExecuteMCPv2 service on IRIS is not available to server profile "${profile}": ` +
    `${notInstalledFinding(found, namespace, deployed)}. ` +
    `The automatic install is off for this profile (${autoInstallLabel(source)}), so this server installs, upgrades and repairs ` +
    "nothing on IRIS; tools that use only the Atelier API keep working. " +
    `To use this tool, an operator installs or upgrades the IRIS side once: start one server against ${config.host}:${config.port} ` +
    `${autoInstallWayOut(source)}, or run zpm "install ${IPM_MODULE_NAME} ${PACKAGE_SEMVER}" in '${namespace}' as a user with %Admin_Manage. ` +
    "Then restart this server: the refusal is decided when the profile connects. " +
    "After every upgrade of the servers (each release stamps its version into the IRIS-side classes), an instance that only " +
    "read-only servers, or servers with the automatic install off, connect to needs this once: upgrading the IRIS side is a " +
    "deliberate admin step.";
  return {
    text,
    fields: {
      profile,
      namespace,
      found,
      ...(deployed !== undefined ? { deployedVersion: deployed } : {}),
      requiredVersion: BOOTSTRAP_VERSION,
      autoInstallSource: source,
    },
  };
}

/** The one startup warning of a profile whose custom REST service is not available and whose install is off. */
function warnCustomRestRefused(config: IrisConnectionConfig, result: BootstrapResult, source: AutoInstallSource): void {
  const found = result.probeStatus as "missing" | "stale" | "unconfigured";
  const deployed = found === "stale" ? result.deployedVersion : undefined;
  logger.warn(
    `Bootstrap: the automatic install is off for profile "${profileNameOf(config)}" (${autoInstallLabel(source)}): ` +
      `${notInstalledFinding(found, config.namespace, deployed)}. ` +
      "This server installs, upgrades and repairs nothing on IRIS, so its custom-REST tools refuse with IRIS_SIDE_NOT_INSTALLED " +
      "for this profile; tools that use only the Atelier API keep working. " +
      `To install or upgrade the IRIS side once, start one server against ${config.host}:${config.port} ${autoInstallWayOut(source)}, ` +
      `or run zpm "install ${IPM_MODULE_NAME} ${PACKAGE_SEMVER}" in '${config.namespace}' as a user with %Admin_Manage, ` +
      "then restart this server.",
  );
}

/** The one startup line of a profile whose install is off and whose deployment is left as today (nothing to refuse). */
function logAutoInstallOff(config: IrisConnectionConfig, source: AutoInstallSource, found: string): void {
  logger.info(
    `Bootstrap: the automatic install is off for profile "${profileNameOf(config)}" (${autoInstallLabel(source)}); ` +
      `found ${found}, nothing to install.`,
  );
}

/**
 * A deployment that bootstrap leaves alone: a newer or foreign marker, a marker
 * (or an ownership) that could not be read, or an IPM installation. For `ipm`,
 * `state` is what the probe found (the path that would have written) and
 * `deployed` is the marker on the instance, absent when no `Setup` class exists.
 */
type LeftAlone =
  | { kind: "newer"; deployed: string }
  | { kind: "foreign"; deployed: string }
  | { kind: "unknown"; reason: string; olderOff?: OlderWhileOff }
  | { kind: "ipm"; state: "stale" | "unconfigured" | "missing"; deployed: string | undefined };

/**
 * Log the one warning for a deployment that bootstrap leaves alone. It names
 * the namespace and instance, the deployed marker (or why none was read), this
 * build's marker and the remedy. `beforeCompile` marks a finding of the
 * re-check that precedes each compile; `uploaded` says this server had already
 * uploaded its class documents, which stay in place.
 */
function warnDeploymentLeftAlone(
  found: LeftAlone,
  config: IrisConnectionConfig,
  beforeCompile: boolean,
  uploaded: boolean,
): void {
  const namespace = config.namespace;
  const where = beforeCompile ? " (found just before compiling, so nothing was compiled)" : "";
  const subject = `Bootstrap: leaving the ExecuteMCPv2 classes in '${namespace}' on ${config.host}:${config.port} alone${where}: `;
  const deliberate =
    `To install this server's classes deliberately, delete class ExecuteMCPv2.Setup in '${namespace}' and restart this server.`;
  const afterUpload = uploaded
    ? found.kind === "ipm"
      ? " This server had already uploaded its class documents, which stay in place until the package is reinstalled with zpm."
      : " This server had already uploaded its class documents, so the namespace can hold its source under the deployed compiled " +
        `classes; to reinstall cleanly, delete class ExecuteMCPv2.Setup in '${namespace}' and restart the build that should own this instance.`
    : "";
  let finding: string;
  if (found.kind === "ipm") {
    const remedy =
      found.state === "stale"
        ? `To bring '${namespace}' up to this server's build, run zpm "install ${IPM_MODULE_NAME} ${PACKAGE_SEMVER}" there as a user with %Admin_Manage.`
        : found.state === "unconfigured"
          ? `To register the web application, run Do ##class(ExecuteMCPv2.Setup).Configure("${namespace}") as a user with %Admin_Manage.`
          : `The installation holds no ExecuteMCPv2.Setup class, so uninstall and reinstall the package with zpm: run zpm "uninstall ${IPM_MODULE_NAME}" and then zpm "install ${IPM_MODULE_NAME} ${PACKAGE_SEMVER}" there as a user with %Admin_Manage.`;
    finding =
      `the classes were installed by IPM (class ${IPM_INSTALL_GUARD.name.replace(/\.cls$/, "")} is present), ` +
      "and this server never redeploys an IPM installation. " +
      `The deployed marker is ${found.deployed === undefined ? "absent" : describeMarker(found.deployed)}; this server's is ${BOOTSTRAP_VERSION}. ` +
      `${remedy} To hand '${namespace}' back to this server, run zpm "uninstall ${IPM_MODULE_NAME}" there and restart this server.`;
  } else if (found.kind === "newer") {
    const parsed = parseBootstrapMarker(found.deployed);
    const order =
      parsed.kind === "stamped"
        ? ` (semver ${parsed.semver.join(".")}, sequence ${parsed.sequence})`
        : "";
    finding =
      `the deployed marker ${describeMarker(found.deployed)} is newer than this server's ${BOOTSTRAP_VERSION}. ` +
      `Upgrade this server to a build at least as new as the deployed one${order}, ` +
      "and run the same or a newer build on every client that shares the instance.";
  } else if (found.kind === "foreign") {
    finding =
      `the deployed marker ${describeMarker(found.deployed)} cannot be ordered against this server's ${BOOTSTRAP_VERSION}. ` +
      `Run one build per instance. ${deliberate}`;
  } else if (found.olderOff !== undefined) {
    // The automatic install is off and the marker read older; only the ownership read failed (Story 45.2). The classes stay
    // in place and the tools go on, so the warning says what that means and how to bring them up to date.
    finding =
      `the ownership of the classes could not be read (${found.reason}), so nothing is changed. ` +
      `The ExecuteMCPv2 classes in '${namespace}' are older than this server (the deployed marker is ${describeMarker(found.olderOff.deployed)}; ` +
      `this server's is ${BOOTSTRAP_VERSION}) and may behave differently from what this server expects. ` +
      `The automatic install is off for this profile (${autoInstallLabel(found.olderOff.source)}), so they are not upgraded. ` +
      `To bring them up to date, start one server against ${config.host}:${config.port} ${autoInstallWayOut(found.olderOff.source)}, ` +
      `or run zpm "install ${IPM_MODULE_NAME} ${PACKAGE_SEMVER}" in '${namespace}' as a user with %Admin_Manage.`;
  } else {
    finding =
      `the deployed marker could not be read (${found.reason}), so it cannot be ordered against this server's ${BOOTSTRAP_VERSION}. ` +
      `Check that the instance answers and that this user can run SQL in '${namespace}', then restart this server. ${deliberate}`;
  }
  logger.warn(subject + finding + afterUpload);
}

/**
 * Re-read the deployed marker immediately before a compile. Another build may
 * have compiled a newer deployment since the probe, and compiling over it would
 * downgrade it. A newer or foreign reading, or a read that fails, logs the
 * warning, records it in `result` and returns `false`; an older, current or
 * absent reading returns `true`.
 *
 * After a `missing` probe a failed read is the expected state, not a failure:
 * the probe proved the `Setup` class absent, and the classes this server has
 * just uploaded are not compiled yet, so no marker exists to read. After a
 * `stale` or `unconfigured` probe a marker was readable moments earlier, so a
 * failed read is `unknown`.
 *
 * A reading that allows the compile is followed by the same ownership check as
 * at startup: IPM may have installed the classes since the probe, and compiling
 * over them would take them from IPM. An IPM installation records `ipmOwned`
 * and returns `false`; an ownership that cannot be read is `unknown`.
 *
 * The check cannot undo source documents that two builds uploaded interleaved:
 * it stops this server compiling over a deployment that compiled first.
 */
async function markerAllowsCompile(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
  result: BootstrapResult,
  probeStatus: "missing" | "stale" | "unconfigured",
  uploaded: boolean,
): Promise<boolean> {
  const read = await readDeployedVersion(http, config, version);
  if (read.kind === "unread") {
    if (probeStatus !== "missing") {
      result.probeStatus = "unknown";
      result.probeFound = true;
      result.readFailure = read.reason;
      delete result.deployedVersion;
      warnDeploymentLeftAlone({ kind: "unknown", reason: read.reason }, config, true, uploaded);
      return false;
    }
  } else {
    const classification = classifyDeployedMarker(read.marker, BOOTSTRAP_VERSION);
    if (classification === "newer" || classification === "foreign") {
      result.probeStatus = classification;
      result.probeFound = true;
      result.deployedVersion = read.marker;
      warnDeploymentLeftAlone({ kind: classification, deployed: read.marker }, config, true, uploaded);
      return false;
    }
  }
  return !(await leftToIpm(http, config, version, result, probeStatus, read.kind === "marker" ? read.marker : undefined, true, uploaded));
}

/**
 * Check who owns the classes before a write. When IPM does (the install guard
 * is present), record `ipmOwned` and `probeFound`, log the one warning and
 * return `true`; when the ownership cannot be read, record `unknown` with the
 * reason, log the existing unknown warning and return `true`. `false` means no
 * IPM ownership was found and the write may go on. `deployed` is the marker on
 * the instance, when one was read.
 */
async function leftToIpm(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
  result: BootstrapResult,
  state: "stale" | "unconfigured" | "missing",
  deployed: string | undefined,
  beforeCompile: boolean,
  uploaded: boolean,
  olderOff?: OlderWhileOff,
): Promise<boolean> {
  const ownership = await ipmOwnership(http, config, version);
  if (ownership.owner === "none") return false;
  result.probeFound = true;
  if (ownership.owner === "ipm") {
    result.ipmOwned = true;
    warnDeploymentLeftAlone({ kind: "ipm", state, deployed }, config, beforeCompile, uploaded);
    return true;
  }
  result.probeStatus = "unknown";
  result.readFailure = ownership.reason;
  delete result.deployedVersion;
  warnDeploymentLeftAlone(
    { kind: "unknown", reason: ownership.reason, ...(olderOff !== undefined ? { olderOff } : {}) },
    config,
    beforeCompile,
    uploaded,
  );
  return true;
}

/**
 * Full bootstrap orchestration.
 *
 * 1. Probe deployment + configuration state.
 * 2. `current` (classes match AND web app registered) - skip the deploy and the
 *    privileged steps, but run the compile check (two reads, no compile): a
 *    class that an earlier start failed to compile is reported again, with
 *    `compiled: false`, until it is fixed.
 * 3. `unconfigured` (classes match but web app absent) → skip deploy (source is
 *    current) but RECOMPILE, then run the privileged steps (configure + mapping
 *    + UnitTestRoot) to self-heal. The recompile matters: the web app being
 *    absent means %SYS diverged from the code DB (migration / %SYS reset), which
 *    can also leave stale or version-incompatible compiled objects even though
 *    the source hash matches — verified live, the dispatch 500s until recompiled.
 *    A compile that is not confirmed class by class ({@link compileAndVerify})
 *    stops the flow before the privileged steps, here as on every branch.
 * 4. `stale` (an OLDER deployment) → redeploy + recompile. The privileged steps
 *    are normally already done, so they're skipped — BUT we verify the web app
 *    is actually registered first (same root cause as the reported bug); if it's
 *    absent, we run the privileged steps too, so a divergent instance self-heals
 *    in one restart instead of two.
 * 5. `missing` (the `Setup` class is provably absent) → full install (deploy +
 *    compile + configure + mapping + UnitTestRoot).
 * 6. `newer` or `foreign` → change nothing, make no further request, log one
 *    warning naming both markers and the remedy. Every step flag stays false
 *    and `probeFound` is true.
 * 7. `unknown` (no marker could be read, and the `Setup` class is not provably
 *    absent) → change nothing, log one warning naming the failure and the
 *    remedy; the server goes on with what is deployed. Every step flag stays
 *    false and `probeFound` is true.
 * 8. Before each compile the marker is re-read; a newer or foreign reading, or
 *    (after a `stale` or `unconfigured` probe) a failed read, skips the compile
 *    and every later step, with the same warning.
 * 9. Before any write (on `stale`, `unconfigured` and `missing`, and again at
 *    the re-check before compile) the IPM-only `ExecuteMCPv2.InstallGuard`
 *    document is asked for: present → IPM owns the classes, change nothing and
 *    log one warning naming the `zpm` command (`ipmOwned: true`, `probeFound:
 *    true`, every step flag false); a 404 → carry on; any other failure → change
 *    nothing, `probeStatus: "unknown"` with the reason in `readFailure`. The
 *    guard found only at the re-check comes after the class documents were
 *    uploaded: those stay (`deployed` true), and the compile and every later step
 *    are skipped.
 * 10. Return result with step-level tracking.
 * 11. With the profile's automatic install off (`config.autoInstall === false`; Story 45.2) every branch
 *    sends reads only. `current`, `newer`, `foreign`, `unknown` and an IPM installation behave as above
 *    plus one `[INFO]` line. On `missing`, `stale` and `unconfigured` (after the ownership read of step 9) nothing
 *    is uploaded, compiled or configured; the result carries `customRestRefused: true`, one `[WARN]` is logged,
 *    and the caller arms the client's refusal ({@link buildIrisSideRefusal}). `autoInstallOff` names the
 *    channel; both fields are absent with the install on.
 *
 * If the configure step fails (e.g. insufficient privileges), the result
 * includes manual instructions but does not throw. Because the probe checks
 * the web app registration directly (not just the class version), a later
 * launch by a privileged user self-heals rather than reporting `current`.
 */
export async function bootstrap(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
): Promise<BootstrapResult> {
  const result: BootstrapResult = {
    probeFound: false,
    probeStatus: "missing",
    deployed: false,
    compiled: false,
    configured: false,
    mapped: false,
    unitTestRootEnsured: false,
    errors: [],
  };

  // Step 1: Probe — distinguishes missing, current, unconfigured, stale, newer, foreign and unknown deployments.
  // `probeCustomRest` catches its own request failures; a throw that still escapes is not a positive absence.
  let probe: ProbeResult;
  try {
    probe = await probeCustomRest(http, config, version);
  } catch (error: unknown) {
    probe = { status: "unknown", reason: `the probe failed: ${describeFailure(error)}` };
  }

  result.probeStatus = probe.status;
  result.probeFound = probe.status !== "missing";

  // The automatic install (Story 45.2): off means every branch below sends reads only. `autoInstall` is absent on a
  // config that never went through the profile resolution, which counts as on (today's behavior).
  const off: AutoInstallSource | undefined =
    config.autoInstall === false ? (config.autoInstallSource ?? "IRIS_AUTO_INSTALL") : undefined;
  if (off !== undefined) result.autoInstallOff = off;

  // A newer or foreign deployment is never replaced: change nothing, say why once.
  if (probe.status === "newer" || probe.status === "foreign") {
    result.deployedVersion = probe.deployedVersion;
    warnDeploymentLeftAlone({ kind: probe.status, deployed: probe.deployedVersion }, config, false, false);
    if (off !== undefined) logAutoInstallOff(config, off, probe.status);
    return result;
  }
  // Nor is a deployment whose marker cannot be read: it may be newer.
  if (probe.status === "unknown") {
    result.readFailure = probe.reason;
    warnDeploymentLeftAlone({ kind: "unknown", reason: probe.reason }, config, false, false);
    if (off !== undefined) logAutoInstallOff(config, off, probe.status);
    return result;
  }
  if (probe.status === "stale") {
    result.deployedVersion = probe.deployedVersion;
  }

  // If already current (deployed version matches embedded version), skip the deploy. The marker and the web application
  // prove neither that an earlier start's compile finished nor that every class compiled, so the same check that follows
  // a compile runs here too (two reads, no compile): a partial failure is reported again until it is fixed.
  if (probe.status === "current") {
    // `current` already sends reads only, so the install being off changes nothing here but one line.
    if (off !== undefined) logAutoInstallOff(config, off, probe.status);
    result.deployed = true;
    const names = [...BOOTSTRAP_CLASSES.keys()];
    let notCompiled: string[];
    try {
      notCompiled = await verifyCompiled(http, config.namespace, version, names);
    } catch (error: unknown) {
      result.errors.push(checkCouldNotRunText(error));
      return result;
    }
    const failure = compileFailureText({ notCompiled, irisErrors: [] }, names.length);
    if (failure !== undefined) {
      result.errors.push(failure);
      return result;
    }
    result.compiled = true;
    result.configured = true;
    result.mapped = true;
    result.unitTestRootEnsured = true;
    logger.info(
      `Bootstrap: REST service is current (version ${BOOTSTRAP_VERSION}), skipping deploy`,
    );
    return result;
  }

  // Every path below writes. An IPM installation owns its classes, so it is never written over; an
  // ownership that cannot be read is not a licence to write either.
  const probedMarker =
    probe.status === "stale" ? probe.deployedVersion : probe.status === "unconfigured" ? BOOTSTRAP_VERSION : undefined;

  // Install off (Story 45.2): the ownership read runs where the write paths run it, and nothing is written whatever it
  // finds. An IPM installation, or an ownership that cannot be read, is left as today (one warning, the tools go on).
  // Otherwise the custom REST service is not available to this profile: the caller arms the client's refusal.
  if (off !== undefined) {
    const olderOff = probe.status === "stale" ? { deployed: probe.deployedVersion, source: off } : undefined;
    if (await leftToIpm(http, config, version, result, probe.status, probedMarker, false, false, olderOff)) {
      logAutoInstallOff(config, off, result.probeStatus);
      return result;
    }
    result.customRestRefused = true;
    warnCustomRestRefused(config, result, off);
    return result;
  }

  if (await leftToIpm(http, config, version, result, probe.status, probedMarker, false, false)) {
    return result;
  }

  // Deploy + compile are needed for `missing` (first install) and `stale`
  // (class-content upgrade). `unconfigured` skips them entirely: the classes
  // are already at the right version on disk — only the privileged web-app
  // registration is missing — so redeploying would be wasted work.
  if (probe.status === "unconfigured") {
    // Source is already at the right version (hash matched) — no redeploy.
    // But the web app being absent means %SYS diverged from the code DB
    // (container migration, %SYS restore/reset). That same divergence can
    // leave STALE or version-incompatible compiled objects behind even though
    // the source hash matches — verified live: a migrated code DB dispatches
    // <NULL VALUE> 500s until recompiled. So recompile (cheap, idempotent)
    // before the privileged steps; skip deploy since the source is current.
    if (!(await markerAllowsCompile(http, config, version, result, "unconfigured", false))) {
      return result;
    }
    result.deployed = true;
    logger.info(
      `Bootstrap: REST classes present at version ${BOOTSTRAP_VERSION} but web application not registered — recompiling and running configuration steps`,
    );
    // A failed or unverifiable compile stops here: registering the web application over classes that did not compile
    // would leave the instance reporting `current` on the next start with the failure never mentioned again. Left
    // unconfigured, every start recompiles and reports it until it is fixed.
    if (!(await compileEmbedded(http, config, version, result, "Bootstrap: classes recompiled successfully"))) {
      return result;
    }
  } else {
    // Log the transition so operators can see in logs what is happening.
    if (probe.status === "stale") {
      logger.info(
        `Bootstrap: upgrading REST service from version ${probe.deployedVersion} to ${BOOTSTRAP_VERSION}`,
      );
    } else {
      logger.info(
        `Bootstrap: REST service not found, running full install (version ${BOOTSTRAP_VERSION})`,
      );
    }

    // Step 2: Deploy — required for both `missing` and `stale` cases.
    try {
      await deployClasses(http, config, version);
      result.deployed = true;
      logger.info(
        `Bootstrap: deployed ${BOOTSTRAP_CLASSES.size} classes to ${config.namespace}`,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Deploy failed: ${msg}`);
      // Cannot continue without deployment
      return result;
    }

    // Step 3: Compile — required for both `missing` and `stale` cases. A newer
    // build may have compiled since the probe: re-read the marker first.
    if (!(await markerAllowsCompile(http, config, version, result, probe.status, true))) {
      return result;
    }
    // Cannot continue without a compile that is confirmed class by class.
    if (!(await compileEmbedded(http, config, version, result, "Bootstrap: classes compiled successfully"))) {
      return result;
    }
  }

  // Privileged one-time operations (web app registration + package mapping),
  // followed by ^UnitTestRoot. `missing` (first install) and `unconfigured`
  // (self-heal) always run them. A `stale` upgrade normally skips them — the
  // webapp + mapping already exist from the original install, so the upgrade
  // works even when the running user no longer has %Admin_Manage. But verify
  // that assumption instead of asserting it (the reported bug's root cause):
  // if %SYS diverged from the code DB, the web app can be absent even on a
  // version-mismatch upgrade, so self-heal when it's found missing.
  if (probe.status === "stale") {
    let staleConfigured: boolean;
    try {
      staleConfigured = await isConfigured(http, config, version);
    } catch {
      // Indeterminate — preserve the privilege-free upgrade path rather than
      // forcing a Configure attempt that may need privileges the upgrader lacks.
      staleConfigured = true;
    }

    if (staleConfigured) {
      result.configured = true;
      result.mapped = true;
      logger.info(
        "Bootstrap: upgrade complete — webapp registration and package mapping already exist, skipped",
      );
    } else {
      logger.info(
        "Bootstrap: upgraded classes but the web application is not registered — running configuration steps to self-heal",
      );
      await runPrivilegedSteps(http, config, version, result);
    }
  } else {
    // `missing` and `unconfigured`: (re)create the web app + package mapping.
    await runPrivilegedSteps(http, config, version, result);
  }

  // ^UnitTestRoot for every non-current path.
  await ensureUnitTestRootStep(http, config, version, result);

  return result;
}
