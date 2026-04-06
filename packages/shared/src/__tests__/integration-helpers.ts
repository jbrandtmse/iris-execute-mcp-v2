/**
 * Shared helpers for integration tests that run against a real IRIS instance.
 *
 * Integration tests use env vars (IRIS_HOST, IRIS_PORT, etc.) with sensible
 * defaults for a local development IRIS install.
 */

import { IrisHttpClient } from "../http-client.js";
import { loadConfig, IrisConnectionConfig } from "../config.js";
import { ping } from "../health.js";

/**
 * Build an {@link IrisConnectionConfig} from env vars with local-dev defaults.
 *
 * Falls back to localhost:52773, _SYSTEM / SYS when env vars are not set.
 */
export function getIntegrationConfig(
  overrides?: Partial<Record<string, string>>,
): IrisConnectionConfig {
  return loadConfig({
    IRIS_HOST: process.env.IRIS_HOST ?? "localhost",
    IRIS_PORT: process.env.IRIS_PORT ?? "52773",
    IRIS_USERNAME: process.env.IRIS_USERNAME ?? "_SYSTEM",
    IRIS_PASSWORD: process.env.IRIS_PASSWORD ?? "SYS",
    IRIS_NAMESPACE: process.env.IRIS_NAMESPACE ?? "HSCUSTOM",
    IRIS_HTTPS: process.env.IRIS_HTTPS ?? "false",
    ...overrides,
  });
}

/**
 * Create a fully-configured {@link IrisHttpClient} for integration tests.
 */
export function createIntegrationClient(
  configOverrides?: Partial<Record<string, string>>,
  defaultTimeout?: number,
): IrisHttpClient {
  return new IrisHttpClient(getIntegrationConfig(configOverrides), defaultTimeout);
}

/**
 * Probe whether a local IRIS instance is reachable.
 *
 * Returns `true` when IRIS responds within 3 seconds, `false` otherwise.
 */
export async function isIrisAvailable(): Promise<boolean> {
  const client = createIntegrationClient();
  try {
    return await ping(client, 3000);
  } finally {
    client.destroy();
  }
}

