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
 * Probe result tri-state.
 *
 * - `missing`: the REST service is not deployed (probe query failed —
 *    either the class does not exist or the web application isn't
 *    registered yet). Bootstrap runs the full deploy + compile + configure
 *    + mapping flow.
 *
 * - `current`: the deployed classes match the embedded classes exactly
 *    (version hash matches). Bootstrap skips everything.
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
  | { status: "stale"; deployedVersion: string };

/** Result of a full bootstrap run. */
export interface BootstrapResult {
  /** Whether the probe detected the REST service is already configured. */
  probeFound: boolean;
  /** The probe result — lets callers distinguish first-time install from auto-upgrade. */
  probeStatus: "missing" | "current" | "stale";
  /** Whether class deployment succeeded. */
  deployed: boolean;
  /** Whether class compilation succeeded. */
  compiled: boolean;
  /** Whether web application registration succeeded. */
  configured: boolean;
  /** Whether package mapping to %All was created. */
  mapped: boolean;
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
 * - Returned hash matches `BOOTSTRAP_VERSION` → `{ status: "current" }`.
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
        return { status: "current" };
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
 * Full bootstrap orchestration.
 *
 * 1. Probe whether the REST service is already configured.
 * 2. If found, return a skip result.
 * 3. Deploy all ObjectScript classes.
 * 4. Compile all classes.
 * 5. Configure the web application.
 * 6. Return result with step-level tracking.
 *
 * If the configure step fails (e.g. insufficient privileges), the result
 * includes manual instructions but does not throw.
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
    errors: [],
  };

  // Step 1: Probe — distinguishes missing, current, and stale deployments.
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
    logger.info(
      `Bootstrap: REST service is current (version ${BOOTSTRAP_VERSION}), skipping deploy`,
    );
    return result;
  }

  // If stale (deployed but different version), log the upgrade transition
  // so operators can see in logs which version replaced which.
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

  // Steps 4 and 5 are one-time privileged operations that only need to run
  // on a fresh install. On a stale upgrade the webapp is already registered
  // and the package mapping already exists, so we skip them — this means
  // an upgrade works even when the running user no longer has %Admin_Manage.
  if (probe.status === "stale") {
    result.configured = true;
    result.mapped = true;
    logger.info(
      "Bootstrap: upgrade complete — webapp registration and package mapping already exist, skipped",
    );
    return result;
  }

  // Step 4: Configure web app (first-time install only).
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

  // Step 5: Map ExecuteMCPv2 package to %All namespace (first-time install only).
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

  return result;
}
