/**
 * Atelier API version negotiation and path construction.
 *
 * Detects the highest supported Atelier REST API version on the
 * connected IRIS instance and provides helpers for building
 * version-prefixed API paths.
 *
 * ## Atelier REST API Parameter Conventions
 *
 * When building requests against the Atelier API, observe these rules:
 *
 * - **Boolean query parameters** must be sent as numeric `1` or `0`,
 *   not string `"true"` / `"false"`. The IRIS Atelier endpoint returns
 *   HTTP 400 for non-numeric boolean flags.
 *
 * - **Document names** containing `%` (e.g., `%UnitTest.TestCase.cls`)
 *   must be URL-encoded via `encodeURIComponent()` before embedding in
 *   a path segment. A bare `%` is interpreted as a percent-encoding
 *   prefix and causes HTTP 400 or garbled lookups.
 *
 * - **Namespace endpoint** (`/api/atelier/v{n}/{ns}`) must NOT have a
 *   trailing slash. Use the path directly without an action suffix;
 *   `atelierPath(v, ns, "")` produces a trailing slash that causes 404.
 *
 * - **SQL query responses** (`POST /action/query`) return rows as an
 *   array of key-value objects at `result.content`, **not** a
 *   `{ columns, rows }` structure. Each element is one row with column
 *   names as keys.
 */

import { IrisHttpClient, type AtelierEnvelope } from "./http-client.js";
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
 * The Atelier root endpoint wraps server details inside a `content` object.
 * The `api` field is the numeric Atelier API version (e.g. 8).
 * The `version` field is the human-readable IRIS build string.
 */
interface AtelierServerInfo {
  content?: {
    api?: number;
    version?: string;
  };
  /** Legacy: some older IRIS versions may expose version at the top level. */
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

    if (result && typeof result === "object") {
      // Prefer the numeric `api` field inside `content` (modern IRIS)
      const apiVersion =
        result.content && typeof result.content === "object"
          ? result.content.api
          : undefined;

      if (typeof apiVersion === "number" && apiVersion > 0) {
        version = Math.min(apiVersion, MAX_VERSION);
      } else if ("version" in result) {
        // Fallback: parse semver-ish string from legacy responses
        const parsed = parseVersionString(result.version);
        if (parsed !== undefined) {
          version = Math.min(parsed, MAX_VERSION);
        }
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
 * The namespace is URL-encoded so that `%`-prefixed system namespaces
 * like `%SYS` and `%ALL` become `%25SYS` / `%25ALL` and are not
 * misinterpreted by the HTTP stack as incomplete percent-encoding.
 *
 * @example
 * atelierPath(7, "HSCUSTOM", "doc/MyClass.cls")
 * // → "/api/atelier/v7/HSCUSTOM/doc/MyClass.cls"
 * atelierPath(8, "%SYS", "docnames/CLS/cls")
 * // → "/api/atelier/v8/%25SYS/docnames/CLS/cls"
 *
 * @throws {Error} When version is not a positive integer, namespace is
 *   empty, or action is empty.
 */
export function atelierPath(
  version: number,
  namespace: string,
  action: string,
): string {
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error(`atelierPath: version must be a positive integer, got ${version}`);
  }
  if (!namespace) {
    throw new Error("atelierPath: namespace must not be empty");
  }
  if (!action) {
    throw new Error("atelierPath: action must not be empty");
  }
  return `/api/atelier/v${version}/${encodeURIComponent(namespace)}/${action}`;
}

/**
 * Read the per-document failure text out of an Atelier `/doc` result (a
 * `PUT /doc` refusal or a `GET /doc` soft error).
 *
 * A request can return HTTP 200 with an empty `status.errors` envelope and
 * still fail for that document: IRIS reports the failure (for example
 * `ERROR #16021: Illegal Header Line: ...` on a PUT, which stores nothing) only
 * as a string-typed `result.status`, which the shared HTTP client does not throw
 * on. A document name Atelier refuses is answered the same way with HTTP 400
 * (see {@link atelierDocRequest}). A successful `/doc` result carries
 * `result.status === ""` (or no status).
 *
 * @param result - The `result` member of the `/doc` response envelope.
 * @returns The status text when it is a non-empty string; `undefined` when
 *   the request succeeded (empty or absent status) or `result` has no string
 *   status.
 */
export function atelierDocStatusError(result: unknown): string | undefined {
  if (result === null || typeof result !== "object") return undefined;
  const status = (result as { status?: unknown }).status;
  return typeof status === "string" && status !== "" ? status : undefined;
}

/**
 * Run an Atelier `/doc` request and return its envelope, keeping one answer readable: a document name that
 * Atelier refuses (for example a name with no document type) is answered HTTP 400 with an EMPTY `status.errors`
 * and the reason only in the string `result.status` (`ERROR #16006: Document 'X' name is invalid`). The shared
 * HTTP client throws on every non-2xx response, so that answer arrives as an {@link IrisApiError} that carries
 * the envelope's `result`; this returns it as an envelope with that `result`, so the caller reads the per-document
 * reason with {@link atelierDocStatusError} exactly as it reads the soft error of a 2xx answer. Every other failure
 * (a 404, a 409, a 400 that lists errors or carries no status text, a connection failure) still throws.
 *
 * @param call - The request, such as `() => ctx.http.get(path)`.
 */
export async function atelierDocRequest<T = unknown>(call: () => Promise<AtelierEnvelope<T>>): Promise<AtelierEnvelope<T>> {
  try {
    return await call();
  } catch (error: unknown) {
    if (
      error instanceof IrisApiError &&
      error.statusCode === 400 &&
      error.errors.length === 0 &&
      atelierDocStatusError(error.result) !== undefined
    ) {
      return { status: { errors: [], summary: "" }, console: [], result: error.result as T };
    }
    throw error;
  }
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
