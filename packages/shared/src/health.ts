/**
 * Connection health check and ping utilities for IRIS.
 *
 * Provides startup health verification and lightweight connection
 * probing for use by the server-base monitoring loop.
 */

import { IrisHttpClient } from "./http-client.js";
import { IrisConnectionError } from "./errors.js";
import { logger } from "./logger.js";

/** Default timeout for the startup health check (ms). */
const HEALTH_CHECK_TIMEOUT = 5_000;

/** Default timeout for the lightweight ping (ms) — per NFR17. */
const PING_TIMEOUT = 2_000;

/**
 * Verify that the IRIS instance is reachable by sending
 * `HEAD /api/atelier/` with a short timeout.
 *
 * On success the call resolves silently (logged at INFO).
 * On failure an {@link IrisConnectionError} is thrown with the
 * configured host, port, and a recovery suggestion.
 *
 * @param client - An already-constructed {@link IrisHttpClient}.
 * @throws {IrisConnectionError} When IRIS cannot be reached.
 */
export async function checkHealth(client: IrisHttpClient): Promise<void> {
  try {
    await client.head("/api/atelier/", { timeout: HEALTH_CHECK_TIMEOUT });
    logger.info("IRIS health check passed");
  } catch (error: unknown) {
    if (error instanceof IrisConnectionError) {
      throw error;
    }
    // Wrap unexpected errors — preserve whatever detail we can
    const detail =
      error instanceof Error ? error.message : String(error);
    throw new IrisConnectionError(
      "HEALTH_CHECK_FAILED",
      `IRIS health check failed: ${detail}`,
      "Verify the IRIS web port is accessible and that the server is running",
    );
  }
}

/**
 * Lightweight connectivity probe using `HEAD /api/atelier/`.
 *
 * Returns `true` when IRIS responds within the given timeout,
 * `false` otherwise. Never throws — intended for periodic
 * monitoring by the server-base layer (Story 1.4).
 *
 * @param client  - An already-constructed {@link IrisHttpClient}.
 * @param timeout - Maximum wait in milliseconds (default 2 000, per NFR17).
 */
export async function ping(
  client: IrisHttpClient,
  timeout: number = PING_TIMEOUT,
): Promise<boolean> {
  try {
    await client.head("/api/atelier/", { timeout });
    return true;
  } catch {
    return false;
  }
}
