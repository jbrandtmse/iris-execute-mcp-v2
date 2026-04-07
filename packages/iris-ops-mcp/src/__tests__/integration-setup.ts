/**
 * Vitest setupFile for iris-ops-mcp integration tests.
 *
 * Runs before any test file is loaded, probes whether IRIS is reachable,
 * negotiates the Atelier API version, and checks whether the custom REST
 * service (ExecuteMCPv2) is available. Results are stored on `globalThis`
 * so that `describe.skipIf()` and `it.skipIf()` can reference them
 * synchronously at module load time.
 */

import { IrisHttpClient, loadConfig, ping, negotiateVersion } from "@iris-mcp/shared";

declare global {
  var __IRIS_AVAILABLE__: boolean;
  var __ATELIER_VERSION__: number;
  var __CUSTOM_REST_AVAILABLE__: boolean;
}

function getConfig() {
  return loadConfig({
    IRIS_HOST: process.env.IRIS_HOST ?? "localhost",
    IRIS_PORT: process.env.IRIS_PORT ?? "52773",
    IRIS_USERNAME: process.env.IRIS_USERNAME ?? "_SYSTEM",
    IRIS_PASSWORD: process.env.IRIS_PASSWORD ?? "SYS",
    IRIS_NAMESPACE: process.env.IRIS_NAMESPACE ?? "HSCUSTOM",
    IRIS_HTTPS: process.env.IRIS_HTTPS ?? "false",
  });
}

async function probeIris(): Promise<{ available: boolean; version: number }> {
  const config = getConfig();
  const client = new IrisHttpClient(config);
  try {
    const available = await ping(client, 3000);
    if (!available) return { available: false, version: 0 };
    const version = await negotiateVersion(client);
    return { available: true, version };
  } catch {
    return { available: false, version: 0 };
  } finally {
    client.destroy();
  }
}

/**
 * Probe whether the custom ExecuteMCPv2 REST service is deployed and
 * responding. Sends a lightweight GET to the monitor/system endpoint.
 * A 500 from the REST service still indicates it is deployed (the endpoint
 * exists but may require specific context). Only connection failures
 * or 404 indicate the service is not available.
 */
async function probeCustomRest(): Promise<boolean> {
  const config = getConfig();
  const client = new IrisHttpClient(config);
  try {
    await client.get("/api/executemcp/v2/monitor/system");
    return true;
  } catch (error: unknown) {
    // If we got an HTTP response (even an error), the REST service is deployed
    if (error && typeof error === "object" && "statusCode" in error) {
      const statusCode = (error as { statusCode: number }).statusCode;
      // 404 means the REST service is not deployed; other errors mean it is
      return statusCode !== 404;
    }
    return false;
  } finally {
    client.destroy();
  }
}

const probe = await probeIris();
globalThis.__IRIS_AVAILABLE__ = probe.available;
globalThis.__ATELIER_VERSION__ = probe.version;
globalThis.__CUSTOM_REST_AVAILABLE__ = probe.available ? await probeCustomRest() : false;
