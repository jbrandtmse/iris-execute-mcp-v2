/**
 * Shared helpers for integration tests that run against a real IRIS instance.
 *
 * Integration tests are opt-in: they reach IRIS only when `IRIS_REQUIRE_LIVE` is `1`
 * or `true`, and then at the target named by `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`,
 * `IRIS_PASSWORD` and `IRIS_NAMESPACE` (all required, none defaulted; see
 * `../test-helpers/live-target.ts`). Unarmed, {@link isIrisAvailable} answers `false`
 * without a request and a client built here points at an inert target that is never
 * contacted.
 */

import { IrisHttpClient } from "../http-client.js";
import { ping } from "../health.js";
import { getIntegrationConfig } from "../test-helpers/integration-config.js";
import { isLiveArmed } from "../test-helpers/live-target.js";

/**
 * The integration config for the live target, with `overrides` (`IRIS_*`
 * settings) applied on top: `getIntegrationConfig` of
 * `../test-helpers/integration-config.ts`, re-exported for the integration files
 * of this package.
 *
 * @throws When `IRIS_REQUIRE_LIVE` arms the run and any of the five target
 *   variables is missing.
 */
export { getIntegrationConfig };

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
 * Probe whether the live IRIS instance is reachable.
 *
 * Returns `false` without a request when the run is not armed
 * (`IRIS_REQUIRE_LIVE` is not `1` or `true`). Armed, returns `true` when IRIS
 * responds within 3 seconds, `false` otherwise.
 */
export async function isIrisAvailable(): Promise<boolean> {
  if (!isLiveArmed()) return false;
  const client = createIntegrationClient();
  try {
    return await ping(client, 3000);
  } finally {
    client.destroy();
  }
}
