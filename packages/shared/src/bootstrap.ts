/**
 * Auto-bootstrap orchestration for the ExecuteMCPv2 REST service.
 *
 * Detects whether the custom REST service is deployed on IRIS, and if
 * not, deploys the ObjectScript classes, compiles them, and registers
 * the web application -- all via the Atelier REST API.
 *
 * The bootstrap is idempotent: if the service is already configured,
 * all steps are skipped.
 */

import { IrisHttpClient } from "./http-client.js";
import type { IrisConnectionConfig } from "./config.js";
import { atelierPath } from "./atelier.js";
import { logger } from "./logger.js";
import { BOOTSTRAP_CLASSES, BOOTSTRAP_VERSION } from "./bootstrap-classes.js";

/**
 * Probe result quad-state.
 *
 * - `missing`: the REST service is not deployed (probe query failed —
 *    either the class does not exist or the web application isn't
 *    registered yet). Bootstrap runs the full deploy + compile + configure
 *    + mapping flow.
 *
 * - `current`: the deployed classes match the embedded classes exactly
 *    (version hash matches) AND the web application is registered. Bootstrap
 *    skips everything.
 *
 * - `unconfigured`: the deployed classes match the embedded version, but the
 *    `/api/executemcp/v2` web application is NOT registered. The version
 *    stamp lives inside the Setup class and is present the moment
 *    deploy+compile succeed — independent of the separate, %Admin_Manage-
 *    gated `Configure` step. This divergence happens whenever %SYS state and
 *    the code-bearing database part ways: a container migration or %SYS
 *    restore that keeps a persisted code DB, a first install where Configure
 *    failed (e.g. missing privileges), etc. Bootstrap re-runs ONLY the
 *    privileged one-time steps (web app registration + package mapping +
 *    ^UnitTestRoot) — it does NOT redeploy or recompile, since the classes
 *    are already current. This is the self-healing path.
 *
 * - `stale`: the REST service is deployed but the classes don't match
 *    what's embedded in this MCP server build. Bootstrap redeploys and
 *    recompiles the classes, but skips the one-time privileged steps
 *    (web app registration + package mapping), because those aren't
 *    affected by class-content drift.
 */
export type ProbeResult =
  | { status: "missing" }
  | { status: "current" }
  | { status: "unconfigured" }
  | { status: "stale"; deployedVersion: string };

/** Result of a full bootstrap run. */
export interface BootstrapResult {
  /** Whether the probe detected the REST service is already configured. */
  probeFound: boolean;
  /** The probe result — lets callers distinguish first-time install from auto-upgrade. */
  probeStatus: "missing" | "current" | "unconfigured" | "stale";
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

3. IPM: If IPM is installed, run in any namespace:
   zpm "install iris-execute-mcp-v2"`;

/**
 * Probe the custom REST service deployment status on IRIS.
 *
 * Calls `ExecuteMCPv2.Setup_GetBootstrapVersion()` via the Atelier SQL
 * endpoint, which returns the short SHA-256 hash baked into the deployed
 * Setup class at generation time. The hash is compared against the
 * embedded {@link BOOTSTRAP_VERSION} constant to determine whether the
 * IRIS-side classes match the classes embedded in this MCP server.
 *
 * Three outcomes:
 *
 * - SQL query throws (class doesn't exist, method doesn't exist, or any
 *   other error) → `{ status: "missing" }`. The most common cause is a
 *   first-time install where nothing has been deployed yet. A less
 *   common but important case: an existing deployment from a
 *   pre-version-stamp commit that lacks `GetBootstrapVersion()` — the
 *   SQL call fails with "no such method" and we treat it as missing,
 *   which triggers a full bootstrap that upgrades the stale classes.
 *   This is the one-shot upgrade path for existing beta users.
 *
 * - Returned hash matches `BOOTSTRAP_VERSION` → the classes are current,
 *   but a matching version does NOT prove the web application is
 *   registered (the version stamp lives in the Setup class and is present
 *   the moment deploy+compile succeed, independent of the privileged
 *   `Configure` step). We therefore call `ExecuteMCPv2.Setup_IsConfigured()`
 *   to verify the actual `/api/executemcp/v2` registration:
 *   - registered → `{ status: "current" }` (skip everything).
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
 * - Returned hash differs from `BOOTSTRAP_VERSION` → `{ status: "stale", deployedVersion }`.
 *   Someone already ran bootstrap with a different class version; we
 *   need to redeploy and recompile but the webapp registration and
 *   package mapping (privileged, one-time operations) can be skipped.
 */
export async function probeCustomRest(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
): Promise<ProbeResult> {
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
      const deployedVersion = String(row["Version"] ?? "");
      if (deployedVersion === "") {
        // SQL succeeded but no row / empty version — treat as missing
        return { status: "missing" };
      }
      if (deployedVersion === BOOTSTRAP_VERSION) {
        // Version matches, but that only proves the classes are present —
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
      return { status: "stale", deployedVersion };
    }
    return { status: "missing" };
  } catch {
    // SQL failure usually means the class or method doesn't exist.
    // For users upgrading from a pre-version-stamp deployment, this is
    // the entry point — their old Setup.cls has IsConfigured but not
    // GetBootstrapVersion, the query throws, and we fall back to a full
    // bootstrap that replaces their stale classes.
    return { status: "missing" };
  }
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
 */
export async function deployClasses(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
): Promise<void> {
  for (const [name, content] of BOOTSTRAP_CLASSES.entries()) {
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
 * Compile all deployed classes via the Atelier POST /action/compile endpoint.
 */
export async function compileClasses(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
): Promise<void> {
  const docNames = [...BOOTSTRAP_CLASSES.keys()];
  const path = atelierPath(version, config.namespace, "action/compile");
  await http.post(path, docNames);
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

  // Package mapping to %All (non-fatal — only cross-namespace command exec
  // depends on it).
  try {
    await configurePackageMapping(http, config, version);
    result.mapped = true;
    logger.info(
      "Bootstrap: ExecuteMCPv2 package mapped to %All namespace for cross-namespace support",
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Package mapping failed: ${msg}`);
    // Non-fatal: cross-namespace iris_execute_command won't work but everything else will
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

/**
 * Full bootstrap orchestration.
 *
 * 1. Probe deployment + configuration state.
 * 2. `current` (classes match AND web app registered) → skip everything.
 * 3. `unconfigured` (classes match but web app absent) → skip deploy (source is
 *    current) but RECOMPILE, then run the privileged steps (configure + mapping
 *    + UnitTestRoot) to self-heal. The recompile matters: the web app being
 *    absent means %SYS diverged from the code DB (migration / %SYS reset), which
 *    can also leave stale or version-incompatible compiled objects even though
 *    the source hash matches — verified live, the dispatch 500s until recompiled.
 * 4. `stale` → redeploy + recompile. The privileged steps are normally
 *    already done, so they're skipped — BUT we verify the web app is actually
 *    registered first (same root cause as the reported bug); if it's absent,
 *    we run the privileged steps too, so a divergent instance self-heals in
 *    one restart instead of two.
 * 5. `missing` → full install (deploy + compile + configure + mapping + UnitTestRoot).
 * 6. Return result with step-level tracking.
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

  // Step 1: Probe — distinguishes missing, current, unconfigured, and stale deployments.
  let probe: ProbeResult;
  try {
    probe = await probeCustomRest(http, config, version);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Probe failed: ${msg}`);
    probe = { status: "missing" };
  }

  result.probeStatus = probe.status;
  result.probeFound = probe.status !== "missing";

  // If already current (deployed version matches embedded version), skip everything.
  if (probe.status === "current") {
    result.deployed = true;
    result.compiled = true;
    result.configured = true;
    result.mapped = true;
    result.unitTestRootEnsured = true;
    logger.info(
      `Bootstrap: REST service is current (version ${BOOTSTRAP_VERSION}), skipping deploy`,
    );
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
    result.deployed = true;
    logger.info(
      `Bootstrap: REST classes present at version ${BOOTSTRAP_VERSION} but web application not registered — recompiling and running configuration steps`,
    );
    try {
      await compileClasses(http, config, version);
      result.compiled = true;
      logger.info("Bootstrap: classes recompiled successfully");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Compile failed: ${msg}`);
      // Continue to Configure anyway — creating the web app is the primary
      // self-heal and is independent of compilation. The compile failure is
      // surfaced via errors[] and compiled=false for the caller to see.
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

    // Step 3: Compile — required for both `missing` and `stale` cases.
    try {
      await compileClasses(http, config, version);
      result.compiled = true;
      logger.info("Bootstrap: classes compiled successfully");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Compile failed: ${msg}`);
      // Cannot continue without compilation
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
