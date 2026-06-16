/**
 * Multi-server profile registry and per-profile connection resolution.
 *
 * Epic 14 (multi-server profiles). A *profile* is a named
 * {@link IrisConnectionConfig} — a distinct host + credentials → a distinct
 * authenticated session (cookie jar, CSRF token, base URL). This is the crux
 * that distinguishes a profile from the existing per-call `namespace` override
 * (a path-only string on the *same* session): a profile cannot reuse a single
 * {@link IrisHttpClient}, so each profile gets its own client instance
 * (architecture decision D1).
 *
 * This module is the foundation for Epic 14:
 * - {@link buildProfileRegistry} synthesizes the reserved `default` profile
 *   from the existing `IRIS_*` vars and parses `IRIS_PROFILES` with field
 *   inheritance and fail-fast on malformed JSON (architecture decision D7).
 * - {@link resolveProfile} resolves a profile by name (or the default when
 *   the name is omitted), throwing a structured {@link ProfileResolutionError}
 *   for an unknown name.
 * - {@link ProfileClientRegistry} is the per-profile `IrisHttpClient` registry
 *   (`Map<profileName, IrisHttpClient>`) that guarantees session isolation by
 *   handing each profile its own client instance, with default-eager /
 *   non-default-lazy creation (architecture decisions D1/D8).
 *
 * Back-compat gate: with no `IRIS_PROFILES` set, the registry contains exactly
 * one profile (`default`) whose connection fields are byte-for-byte today's
 * {@link loadConfig} output.
 *
 * The per-call `server`-parameter selection inside `handleToolCall` and the
 * central schema injection are intentionally NOT part of this module — that is
 * Story 14.2 (architecture decision D2).
 */

import type { IrisConnectionConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { IrisHttpClient } from "./http-client.js";
import { logger } from "./logger.js";

/** Reserved profile name synthesized from the existing `IRIS_*` env vars. */
export const DEFAULT_PROFILE_NAME = "default";

/**
 * A named IRIS connection profile.
 *
 * Structurally a {@link IrisConnectionConfig} plus the profile `name`. Stripping
 * `name` yields an object identical to today's {@link loadConfig} output, which
 * is the basis of the Epic 14 back-compat gate.
 */
export interface IrisProfile extends IrisConnectionConfig {
  /** The profile's registered name (the reserved {@link DEFAULT_PROFILE_NAME} for the default). */
  name: string;
}

/** Registry of profiles keyed by name. Always contains at least `default`. */
export type ProfileRegistry = Map<string, IrisProfile>;

/**
 * Thrown when {@link resolveProfile} is asked for a profile name that is not in
 * the registry. Carries the requested name and the list of valid names so the
 * caller can correct the request.
 *
 * Modelled on the suite's error style (a clear "what + valid options" message).
 * A dedicated class (rather than reusing {@link IrisConnectionError} /
 * {@link IrisApiError}) is used because this is a config/lookup error with no
 * HTTP status or network cause — the existing error types do not fit its shape.
 */
export class ProfileResolutionError extends Error {
  /** The profile name that was requested but not found. */
  readonly requested: string;
  /** The names of all registered (valid) profiles. */
  readonly validProfiles: string[];

  constructor(requested: string, validProfiles: string[]) {
    super(
      `Unknown server profile "${requested}". ` +
        `Valid profiles: ${validProfiles.join(", ")}. ` +
        `Set IRIS_PROFILES to define additional profiles, or omit the server name to use "${DEFAULT_PROFILE_NAME}".`,
    );
    this.name = "ProfileResolutionError";
    this.requested = requested;
    this.validProfiles = validProfiles;
  }
}

/**
 * The subset of {@link IrisConnectionConfig} fields an `IRIS_PROFILES` entry may
 * specify. Any omitted field inherits from the default profile. `timeout` is
 * also inherited (it is not part of the documented per-profile schema but
 * defaults from the `default` profile so each client gets a sane timeout).
 */
interface ProfileOverride {
  host?: unknown;
  port?: unknown;
  username?: unknown;
  password?: unknown;
  namespace?: unknown;
  https?: unknown;
  timeout?: unknown;
}

/** Recompute the base URL from connection parts (mirrors {@link loadConfig}). */
function deriveBaseUrl(host: string, port: number, https: boolean): string {
  const protocol = https ? "https" : "http";
  return `${protocol}://${host}:${port}`;
}

/**
 * Fail-fast helper: throw a clear error naming `IRIS_PROFILES`.
 *
 * Mirrors the fail-fast style of {@link loadConfig} (which names `IRIS_PORT` /
 * `IRIS_TIMEOUT`), so misconfiguration surfaces a clear, actionable startup
 * error rather than a silent or cryptic failure.
 */
function profilesError(detail: string): Error {
  return new Error(`IRIS_PROFILES is invalid: ${detail}`);
}

/**
 * Merge one `IRIS_PROFILES` entry over the default profile to produce a fully
 * populated {@link IrisProfile}. Omitted fields inherit from `base`; `baseUrl`
 * is re-derived from the merged `host`/`port`/`https`.
 *
 * @throws {Error} (naming `IRIS_PROFILES`) when a field has the wrong type.
 */
function mergeProfile(
  name: string,
  base: IrisConnectionConfig,
  override: ProfileOverride,
): IrisProfile {
  // host
  let host = base.host;
  if (override.host !== undefined) {
    if (typeof override.host !== "string" || override.host === "") {
      throw profilesError(`profile "${name}": "host" must be a non-empty string.`);
    }
    host = override.host;
  }

  // port
  let port = base.port;
  if (override.port !== undefined) {
    const p =
      typeof override.port === "number" ? override.port : Number(override.port);
    if (!Number.isInteger(p) || p <= 0 || p > 65535) {
      throw profilesError(
        `profile "${name}": "port" must be an integer 1-65535. Received: ${JSON.stringify(override.port)}.`,
      );
    }
    port = p;
  }

  // username
  let username = base.username;
  if (override.username !== undefined) {
    if (typeof override.username !== "string" || override.username === "") {
      throw profilesError(
        `profile "${name}": "username" must be a non-empty string.`,
      );
    }
    username = override.username;
  }

  // password
  let password = base.password;
  if (override.password !== undefined) {
    if (typeof override.password !== "string") {
      throw profilesError(`profile "${name}": "password" must be a string.`);
    }
    password = override.password;
  }

  // namespace
  let namespace = base.namespace;
  if (override.namespace !== undefined) {
    if (typeof override.namespace !== "string" || override.namespace === "") {
      throw profilesError(
        `profile "${name}": "namespace" must be a non-empty string.`,
      );
    }
    namespace = override.namespace;
  }

  // https
  let https = base.https;
  if (override.https !== undefined) {
    if (typeof override.https !== "boolean") {
      throw profilesError(
        `profile "${name}": "https" must be a boolean (true/false).`,
      );
    }
    https = override.https;
  }

  // timeout (inherited from default unless explicitly overridden)
  let timeout = base.timeout;
  if (override.timeout !== undefined) {
    const t =
      typeof override.timeout === "number"
        ? override.timeout
        : Number(override.timeout);
    if (!Number.isFinite(t) || t <= 0) {
      throw profilesError(
        `profile "${name}": "timeout" must be a positive number of milliseconds. Received: ${JSON.stringify(override.timeout)}.`,
      );
    }
    timeout = t;
  }

  return {
    name,
    host,
    port,
    username,
    password,
    namespace,
    https,
    baseUrl: deriveBaseUrl(host, port, https),
    timeout,
  };
}

/**
 * Build the profile registry from the synthesized default config and the
 * environment.
 *
 * Architecture decision D7:
 * - The reserved `default` profile is synthesized from `defaultConfig` (which
 *   the caller produced via {@link loadConfig} from the `IRIS_*` vars). Its
 *   connection fields are copied verbatim — with no `IRIS_PROFILES`, the
 *   resulting `default` profile is byte-for-byte today's `loadConfig` output
 *   (the back-compat gate).
 * - `IRIS_PROFILES` (a JSON object `{ name: { host, port, ... } }`) is parsed
 *   when present. Each entry is merged over `default` so a profile may omit
 *   fields to inherit them. Malformed JSON (or a non-object shape) fails fast
 *   with an error naming `IRIS_PROFILES`.
 * - If `IRIS_PROFILES` itself defines `default`, that entry overrides the
 *   `IRIS_*`-derived default (still inheriting omitted fields from it) and a
 *   startup warning is logged.
 *
 * @param defaultConfig - Connection config from {@link loadConfig} (the `IRIS_*` vars).
 * @param env           - Environment map (defaults to `process.env`).
 * @returns A registry containing `default` plus every `IRIS_PROFILES` entry.
 * @throws {Error} (naming `IRIS_PROFILES`) on malformed/invalid `IRIS_PROFILES`.
 */
export function buildProfileRegistry(
  defaultConfig: IrisConnectionConfig,
  env: Record<string, string | undefined> = process.env,
): ProfileRegistry {
  const registry: ProfileRegistry = new Map();

  // Reserved `default` profile — copy the loadConfig output verbatim so that,
  // absent IRIS_PROFILES, the profile is byte-for-byte today's behavior.
  registry.set(DEFAULT_PROFILE_NAME, {
    name: DEFAULT_PROFILE_NAME,
    ...defaultConfig,
  });

  const raw = env.IRIS_PROFILES;
  if (raw === undefined || raw === "") {
    return registry;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    throw profilesError(`could not parse JSON (${reason}).`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw profilesError(
      'expected a JSON object of named profiles, e.g. {"prod":{"host":"..."}}.',
    );
  }

  for (const [name, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (name === "") {
      throw profilesError("profile names must be non-empty strings.");
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw profilesError(
        `profile "${name}" must be an object of connection fields (host, port, username, password, namespace, https).`,
      );
    }
    if (name === DEFAULT_PROFILE_NAME) {
      logger.warn(
        `IRIS_PROFILES defines the reserved "${DEFAULT_PROFILE_NAME}" profile; ` +
          `it overrides the IRIS_*-derived default profile.`,
      );
    }
    // Merge over the synthesized default (inherit omitted fields).
    registry.set(name, mergeProfile(name, defaultConfig, entry as ProfileOverride));
  }

  return registry;
}

/**
 * Central startup entry point: load the connection config from the `IRIS_*`
 * vars and build the profile registry from it plus `IRIS_PROFILES`
 * (architecture decision D7 — config parsing in the config layer).
 *
 * Composes {@link loadConfig} (unchanged single-server config) with
 * {@link buildProfileRegistry}. `loadConfig`'s signature/output are left
 * untouched so existing callers are unaffected; this is the additive entry
 * point new (profile-aware) code calls instead.
 *
 * @param env - Environment map (defaults to `process.env`).
 * @returns A {@link ProfileRegistry} containing `default` plus any `IRIS_PROFILES` entries.
 * @throws {Error} from {@link loadConfig} (naming `IRIS_PORT`/`IRIS_TIMEOUT`/`IRIS_USERNAME`/`IRIS_PASSWORD`).
 * @throws {Error} (naming `IRIS_PROFILES`) on malformed/invalid `IRIS_PROFILES`.
 */
export function loadProfileRegistry(
  env: Record<string, string | undefined> = process.env,
): ProfileRegistry {
  const defaultConfig = loadConfig(env);
  return buildProfileRegistry(defaultConfig, env);
}

/**
 * Resolve a profile by name, or the {@link DEFAULT_PROFILE_NAME} profile when
 * `name` is undefined or empty (architecture: `server` omitted → `default`).
 *
 * @param registry - The profile registry from {@link buildProfileRegistry}.
 * @param name     - The requested profile name; omit/empty for the default.
 * @returns The matching {@link IrisProfile}.
 * @throws {ProfileResolutionError} When `name` is not a registered profile.
 */
export function resolveProfile(
  registry: ProfileRegistry,
  name?: string,
): IrisProfile {
  const key = name === undefined || name === "" ? DEFAULT_PROFILE_NAME : name;
  const profile = registry.get(key);
  if (!profile) {
    throw new ProfileResolutionError(key, [...registry.keys()]);
  }
  return profile;
}

/**
 * Per-profile {@link IrisHttpClient} registry — the structural guarantee of
 * session isolation (architecture decisions D1/D8).
 *
 * Each profile gets its OWN client instance. Because {@link IrisHttpClient}
 * holds all session state (cookies, CSRF token, session-established flag,
 * in-flight controllers) as *instance* fields, isolation is achieved simply by
 * never handing the same client to two profiles — there is no shared mutable
 * session state to leak.
 *
 * Creation policy (D1/D8):
 * - The default profile's client may be created eagerly (the caller — the MCP
 *   server base — does this in `start()` to preserve today's health-check /
 *   Atelier-version negotiation / bootstrap behavior).
 * - Non-default profiles' clients are created lazily on first
 *   {@link getOrCreate}, then cached so each profile pays one-time negotiation
 *   latency at most once.
 *
 * This class is intentionally transport-agnostic and side-effect-free on
 * construction (it does not open connections), so per-profile session isolation
 * is provable in a unit test without a running IRIS server.
 */
export class ProfileClientRegistry {
  private readonly registry: ProfileRegistry;
  private readonly clients: Map<string, IrisHttpClient> = new Map();

  constructor(registry: ProfileRegistry) {
    this.registry = registry;
  }

  /**
   * Get the client for a profile, creating and caching it on first use.
   *
   * @param profileName - A registered profile name.
   * @returns The profile's dedicated {@link IrisHttpClient}.
   * @throws {ProfileResolutionError} When `profileName` is not registered.
   */
  getOrCreate(profileName: string): IrisHttpClient {
    const existing = this.clients.get(profileName);
    if (existing) return existing;

    const profile = resolveProfile(this.registry, profileName);
    const client = new IrisHttpClient(profile, profile.timeout);
    this.clients.set(profile.name, client);
    return client;
  }

  /** Whether a client has already been created (and cached) for a profile. */
  has(profileName: string): boolean {
    return this.clients.has(profileName);
  }

  /**
   * Destroy and drop the cached client for a single profile, if one exists.
   *
   * Used when a profile's first-touch establishment fails (e.g. health-check
   * rejection): destroying aborts any in-flight requests and clears session
   * state, and dropping it from the cache makes the next call re-create a fresh
   * client and re-attempt establishment (retryable — no un-established client
   * lingers). A no-op when no client is cached for the profile.
   *
   * @returns `true` if a client was destroyed and removed, `false` otherwise.
   */
  drop(profileName: string): boolean {
    const client = this.clients.get(profileName);
    if (!client) return false;
    client.destroy();
    this.clients.delete(profileName);
    return true;
  }

  /** Destroy all cached clients (aborts in-flight requests, clears sessions). */
  destroyAll(): void {
    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
  }
}
