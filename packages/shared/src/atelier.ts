/**
 * Atelier API version negotiation and path construction.
 *
 * Detects the highest supported Atelier REST API version on the
 * connected IRIS instance and provides helpers for building
 * version-prefixed API paths.
 */

import { IrisHttpClient } from "./http-client.js";
import { IrisApiError } from "./errors.js";
import { logger } from "./logger.js";

/** Maximum Atelier API version this client will request. */
const MAX_VERSION = 8;

/** Recommended minimum version — a warning is logged below this. */
const RECOMMENDED_MIN_VERSION = 7;

/** Fallback version when the server provides no version info. */
const DEFAULT_VERSION = 1;

/**
 * Shape of the server information returned by `GET /api/atelier/`.
 *
 * The full response contains more fields; we only extract what we need.
 */
interface AtelierServerInfo {
  version?: string;
}

/**
 * Negotiate the best Atelier API version with the connected IRIS instance.
 *
 * Sends `GET /api/atelier/` and inspects the response to determine
 * the highest version the server supports (capped at {@link MAX_VERSION}).
 *
 * If no version information is available the function defaults to
 * {@link DEFAULT_VERSION} (v1).
 *
 * @param client - An already-constructed {@link IrisHttpClient}.
 * @returns The negotiated Atelier API version number.
 */
export async function negotiateVersion(
  client: IrisHttpClient,
): Promise<number> {
  let version = DEFAULT_VERSION;

  try {
    const envelope = await client.get<AtelierServerInfo>("/api/atelier/");
    const result = envelope.result;

    if (result && typeof result === "object" && "version" in result) {
      const parsed = parseVersionString(result.version);
      if (parsed !== undefined) {
        version = Math.min(parsed, MAX_VERSION);
      }
    }
  } catch {
    logger.warn(
      "Could not retrieve Atelier version info — defaulting to v1",
    );
    return DEFAULT_VERSION;
  }

  if (version < RECOMMENDED_MIN_VERSION) {
    logger.warn(
      `Detected Atelier API v${version}; recommended minimum is v${RECOMMENDED_MIN_VERSION}`,
    );
  } else {
    logger.info(`Detected Atelier API v${version}`);
  }

  return version;
}

/**
 * Guard that throws when the detected version is below the minimum
 * required for a given feature.
 *
 * @param detected    - Version returned by {@link negotiateVersion}.
 * @param required    - Minimum version the feature needs.
 * @param featureName - Human-readable name used in the error message.
 * @throws {IrisApiError} When `detected < required`.
 */
export function requireMinVersion(
  detected: number,
  required: number,
  featureName: string,
): void {
  if (detected < required) {
    throw new IrisApiError(
      0,
      [],
      "",
      `Feature "${featureName}" requires Atelier API v${required} but the server only supports v${detected}. Upgrade IRIS or use a compatible feature set.`,
    );
  }
}

/**
 * Build a full Atelier API path.
 *
 * @example
 * atelierPath(7, "HSCUSTOM", "doc/MyClass.cls")
 * // → "/api/atelier/v7/HSCUSTOM/doc/MyClass.cls"
 */
export function atelierPath(
  version: number,
  namespace: string,
  action: string,
): string {
  return `/api/atelier/v${version}/${namespace}/${action}`;
}

// ── Internal helpers ────────────────────────────────────────────────

/**
 * Extract a major version number from a semver-ish string.
 *
 * The Atelier API version string from IRIS looks like `"8.0.0"` or
 * similar.  We only care about the major component.
 */
function parseVersionString(raw: unknown): number | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;

  const major = Number.parseInt(raw.split(".")[0] ?? "", 10);
  if (Number.isNaN(major) || major <= 0) return undefined;
  return major;
}
