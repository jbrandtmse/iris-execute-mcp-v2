/**
 * Vitest setupFile for iris-data-mcp integration tests.
 *
 * Runs before any test file is loaded. The integration run is opt-in: unless
 * `IRIS_REQUIRE_LIVE` is `1` or `true`, it sets every availability flag to
 * `false` without making a request, so every integration test skips. Armed, the
 * target is the five `IRIS_*` variables (all required, none defaulted; a missing
 * one fails the run naming it), and the setup probes whether IRIS is reachable,
 * negotiates the Atelier API version, and checks whether the custom REST
 * service (ExecuteMCPv2) and the DocDB API are available. Results are
 * stored on `globalThis` so that `describe.skipIf()` and `it.skipIf()`
 * can reference them synchronously at module load time.
 */

import { IrisHttpClient, ping, negotiateVersion } from "@iris-mcp/shared";
import { getIntegrationConfig } from "@iris-mcp/shared/test-helpers/integration-config";
import { isLiveArmed } from "@iris-mcp/shared/test-helpers/live-target";

declare global {
  var __IRIS_AVAILABLE__: boolean;
  var __ATELIER_VERSION__: number;
  var __CUSTOM_REST_AVAILABLE__: boolean;
  var __DOCDB_AVAILABLE__: boolean;
}

async function probeIris(): Promise<{ available: boolean; version: number }> {
  if (!isLiveArmed()) return { available: false, version: 0 };
  const config = getIntegrationConfig();
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
 * responding. Sends a lightweight GET to the analytics/cubes endpoint.
 * A 500 from the REST service still indicates it is deployed (the endpoint
 * exists but may require specific context). Only connection failures
 * or 404 indicate the service is not available.
 */
async function probeCustomRest(): Promise<boolean> {
  const config = getIntegrationConfig();
  const client = new IrisHttpClient(config);
  try {
    await client.get("/api/executemcp/v2/analytics/cubes");
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

/**
 * Probe whether the IRIS DocDB REST API is available.
 * Sends a GET to `/api/docdb/v1/{namespace}`. A successful response
 * indicates the API is available. A 403 means %Service_DocDB is
 * disabled; a 404 means the web app is not deployed. Both indicate
 * the DocDB API is not usable. IRIS 2026.2 answers a disabled service
 * with HTTP 200 and `ERROR #822: Access Denied` in the body, which the
 * HTTP client raises as an error that carries that code; the code is
 * matched without its prefix, which a localized instance words differently.
 */
async function probeDocDb(): Promise<boolean> {
  const config = getIntegrationConfig();
  const client = new IrisHttpClient(config);
  const ns = config.namespace;
  try {
    await client.get(`/api/docdb/v1/${encodeURIComponent(ns)}`);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && /#822\b/.test(error.message)) return false;
    if (error && typeof error === "object" && "statusCode" in error) {
      const statusCode = (error as { statusCode: number }).statusCode;
      // 404 = web app not deployed; 403 = %Service_DocDB disabled
      if (statusCode === 404 || statusCode === 403) return false;
      // Other errors (e.g., 500) suggest the API is deployed but erroring
      return true;
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
globalThis.__DOCDB_AVAILABLE__ = probe.available ? await probeDocDb() : false;
