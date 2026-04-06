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
import { BOOTSTRAP_CLASSES } from "./bootstrap-classes.js";

/** Result of a full bootstrap run. */
export interface BootstrapResult {
  /** Whether the probe detected the REST service is already configured. */
  probeFound: boolean;
  /** Whether class deployment succeeded. */
  deployed: boolean;
  /** Whether class compilation succeeded. */
  compiled: boolean;
  /** Whether web application registration succeeded. */
  configured: boolean;
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
 * Probe whether the custom REST service is already configured on IRIS.
 *
 * Uses the Atelier SQL endpoint to call `ExecuteMCPv2.Setup_IsConfigured()`.
 * If the class does not exist (SQL fails), returns `false`.
 */
export async function probeCustomRest(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
): Promise<boolean> {
  try {
    const path = atelierPath(version, config.namespace, "action/query");
    const body = {
      query: "SELECT ExecuteMCPv2.Setup_IsConfigured() AS IsConfigured",
    };
    const response = await http.post(path, body);
    const content = (
      response.result as { content?: Record<string, unknown>[] }
    )?.content;
    if (Array.isArray(content) && content.length > 0) {
      const row = content[0] as Record<string, unknown>;
      return row["IsConfigured"] === 1 || row["IsConfigured"] === true;
    }
    return false;
  } catch {
    // SQL failure means class doesn't exist or other issue
    return false;
  }
}

/**
 * Deploy all embedded ObjectScript classes to IRIS via the Atelier PUT /doc endpoint.
 *
 * Each class is sent as a separate PUT request with `{ enc: false, content: lines[] }`.
 */
export async function deployClasses(
  http: IrisHttpClient,
  config: IrisConnectionConfig,
  version: number,
): Promise<void> {
  for (const [name, content] of BOOTSTRAP_CLASSES.entries()) {
    const path = atelierPath(version, config.namespace, `doc/${name}`);
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
    query: `SELECT ExecuteMCPv2.Setup_Configure('${config.namespace}') AS ConfigureResult`,
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
    deployed: false,
    compiled: false,
    configured: false,
    errors: [],
  };

  // Step 1: Probe
  try {
    result.probeFound = await probeCustomRest(http, config, version);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Probe failed: ${msg}`);
  }

  // If already configured, skip everything
  if (result.probeFound) {
    result.deployed = true;
    result.compiled = true;
    result.configured = true;
    logger.info("Bootstrap: REST service already configured, skipping");
    return result;
  }

  // Step 2: Deploy
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

  // Step 3: Compile
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

  // Step 4: Configure web app
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

  return result;
}
