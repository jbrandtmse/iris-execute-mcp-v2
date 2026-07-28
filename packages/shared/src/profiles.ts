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
import { parseServerManagerMode, resolveServerManagerProfiles } from "./server-manager-source.js";
import type { CredentialChainOptions } from "./credential-chain.js";
import { resolveServerManagerCredentials } from "./credential-chain.js";

/** Reserved profile name synthesized from the existing `IRIS_*` env vars. */
export const DEFAULT_PROFILE_NAME = "default";

/**
 * Where a profile's connection fields came from (Story 31.3, AC 31.3.1).
 * `"env"` — synthesized from `IRIS_*`/`IRIS_PROFILES`. `"server-manager"` —
 * imported from an `intersystems.servers` settings-file definition
 * ({@link import("./server-manager-source.js").resolveServerManagerProfiles}).
 * Attribution only — see the module doc comment on why this must never feed a
 * governance decision.
 */
export type ProfileSource = "env" | "server-manager";

/**
 * A named IRIS connection profile.
 *
 * Structurally a {@link IrisConnectionConfig} plus the profile `name`. Stripping
 * `name` (and, since Story 31.3, `source`/`sourceFile`/`pathPrefix`) yields an
 * object identical to today's {@link loadConfig} output, which is the basis of
 * the Epic 14 back-compat gate.
 */
export interface IrisProfile extends IrisConnectionConfig {
  /** The profile's registered name (the reserved {@link DEFAULT_PROFILE_NAME} for the default). */
  name: string;
  /**
   * Provenance (Story 31.3, AC 31.3.1). Optional so hand-built {@link IrisProfile}
   * literals elsewhere (tests, ad-hoc registries) keep compiling unchanged
   * (Rule #19 conditional-spread idiom) — every profile built by
   * {@link mergeProfile}/{@link buildProfileRegistry}/
   * {@link import("./server-manager-source.js").resolveServerManagerProfiles}
   * always sets it explicitly (`"env"` or `"server-manager"`), never leaves it
   * `undefined`.
   */
  source?: ProfileSource;
  /**
   * The settings FILE a `"server-manager"`-sourced profile was imported from
   * (deferred item 31-0-3's resolution). `undefined` for `"env"`-sourced
   * profiles (there is no file). Lets an operator see exactly where a
   * Server-Manager profile came from, e.g. via the `iris_server_profiles`
   * roster.
   *
   * The path is recorded exactly as discovery produced it — normally absolute,
   * but RELATIVE when the operator gave a relative `IRIS_SM_SETTINGS_PATHS`
   * entry or `IRIS_SM_WORKSPACE` (nothing calls `path.resolve`), in which case
   * it resolves against the server process's CWD.
   *
   * **Never a secret, but not free of information.** No password, token or
   * other credential can reach this field (it is a filesystem path chosen by
   * `discoverSettingsFiles`, swept by tests). It IS, however, a real local
   * filesystem path: on a USER-scope discovery hit it is composed from
   * `APPDATA`/`HOME` and therefore embeds the OS account name
   * (`C:\Users\<account>\AppData\Roaming\Code\User\settings.json`), and on a
   * workspace hit it embeds the workspace directory. Since Story 31.3 surfaces
   * it through the `iris_server_profiles` roster, that path is visible to the
   * connected MCP client (i.e. to the model). This was a deliberate,
   * reviewed trade-off (code review 2026-07-25): a basename would be useless —
   * every candidate is literally named `settings.json`, so the directory IS
   * the information — and the disclosure is non-credential. Operators who do
   * not want local paths disclosed should define connections at workspace
   * scope (`IRIS_SM_WORKSPACE`) or leave `IRIS_SERVER_MANAGER` off. Documented
   * for users in the README's Server Manager connections section.
   */
  sourceFile?: string;
  /**
   * Normalized `webServer.pathPrefix` applied as a `baseUrl` suffix (deferred
   * item 31-0-4's resolution). Structured so `baseUrl` is always recoverable
   * as `deriveBaseUrl(host, port, https) + (pathPrefix ?? "")` — restoring the
   * invariant for `"server-manager"`-sourced profiles without changing
   * `deriveBaseUrl`'s behavior for `"env"`-sourced ones. `undefined` when no
   * prefix applies (the overwhelmingly common case).
   */
  pathPrefix?: string;
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
 *
 * Exported (Story 31.0, AC 31.0.2) so {@link import("./server-manager-source.js")}
 * can map `intersystems.servers` entries onto this same shape and reuse
 * {@link mergeProfile}'s field validation instead of duplicating it.
 */
export interface ProfileOverride {
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
 * Fail-fast helper: throw a clear error naming the source (`IRIS_PROFILES` by
 * default).
 *
 * Mirrors the fail-fast style of {@link loadConfig} (which names `IRIS_PORT` /
 * `IRIS_TIMEOUT`), so misconfiguration surfaces a clear, actionable startup
 * error rather than a silent or cryptic failure.
 *
 * @param detail     - The specific validation problem.
 * @param sourceLabel - What to blame in the message (default `IRIS_PROFILES`,
 *   preserving today's byte-identical error text). Story 31.0's
 *   `server-manager-source.ts` passes a label naming the settings file/server
 *   instead, so a malformed Server-Manager definition never blames a variable
 *   the user may not have set (the "mergeProfile trap").
 */
function profilesError(detail: string, sourceLabel = "IRIS_PROFILES"): Error {
  return new Error(`${sourceLabel} is invalid: ${detail}`);
}

/**
 * Merge one `IRIS_PROFILES` (or Story 31.0 Server-Manager) entry over a base
 * profile to produce a fully populated {@link IrisProfile}. Omitted fields
 * inherit from `base`; `baseUrl` is re-derived from the merged
 * `host`/`port`/`https`.
 *
 * Exported (Story 31.0, AC 31.0.2) so `server-manager-source.ts` can reuse this
 * SAME field validation for `intersystems.servers` entries rather than
 * duplicating it — see `sourceLabel` below for how it avoids mis-blaming
 * `IRIS_PROFILES` for a Server-Manager-sourced error.
 *
 * @param sourceLabel - Passed through to {@link profilesError} (default
 *   `IRIS_PROFILES`, so existing `IRIS_PROFILES` error text stays byte-identical).
 * @param source - Provenance tag (Story 31.3, AC 31.3.1); default `"env"` so
 *   the two pre-existing call sites in THIS file (the reserved default's
 *   `IRIS_PROFILES` override and every other `IRIS_PROFILES` entry) need no
 *   change. `server-manager-source.ts` passes `"server-manager"` explicitly.
 * @param pathPrefix - Normalized `webServer.pathPrefix` (deferred item
 *   31-0-4's resolution), applied as a `baseUrl` suffix and carried through
 *   verbatim on the returned profile so the derivation stays recoverable.
 *   `undefined` for every `IRIS_PROFILES` entry (no Server-Manager concept of
 *   a path prefix exists there).
 * @throws {Error} (naming `sourceLabel`) when a field has the wrong type.
 */
export function mergeProfile(
  name: string,
  base: IrisConnectionConfig,
  override: ProfileOverride,
  sourceLabel = "IRIS_PROFILES",
  source: ProfileSource = "env",
  pathPrefix?: string,
): IrisProfile {
  // host
  let host = base.host;
  if (override.host !== undefined) {
    if (typeof override.host !== "string" || override.host === "") {
      throw profilesError(
        `profile "${name}": "host" must be a non-empty string.`,
        sourceLabel,
      );
    }
    host = override.host;
  }
  // 31-3-7 (Story 32.3): a host is not a URL. URL userinfo
  // (`admin:hunter2@host`), a scheme/slash, or whitespace would land
  // verbatim in `baseUrl` — hence in the `iris_server_profiles` roster,
  // which the docs describe as never containing a password. Reject it. The
  // message deliberately does NOT echo the received value: a userinfo host
  // can embed a credential, and this error must not become the leak it
  // prevents (asserted in tests).
  //
  // 32-3-R6 (Story 32.4): the guard now runs on the FINAL host — the
  // override's when present, else the INHERITED default (`base.host`, i.e.
  // `IRIS_HOST`) — and additionally rejects `\` and `:`. Pre-Story-32.4 only
  // the override was checked, so a userinfo-carrying `IRIS_HOST` landed
  // verbatim in the reserved default profile's `baseUrl` and in every
  // host-less `IRIS_PROFILES` entry — the same roster-leak class via the
  // inherited path. `:` is rejected because a host is not host:port
  // (`host: "example.com:8080"` composed `http://example.com:8080:52773`)
  // EXCEPT inside a bracketed IPv6 literal (`[::1]`), which composes a valid
  // baseUrl and worked before this guard existed (Rule #19 — a bare `::1`
  // never worked: `deriveBaseUrl` does not bracket it). `?`/`#` are rejected
  // too (32.4 review): they compose a baseUrl whose query/fragment swallows
  // the port and every request path, so no working configuration used them.
  const isBracketedIpv6 = /^\[[0-9a-fA-F:]+\]$/.test(host);
  if (/[@/\s\\?#]/.test(host) || (!isBracketedIpv6 && host.includes(":"))) {
    const origin =
      override.host !== undefined ? `"host"` : `the inherited default host (from IRIS_HOST)`;
    throw profilesError(
      `profile "${name}": ${origin} must be a bare hostname — it must not contain ` +
        `"@", "/", "\\", "?", "#", or whitespace, and no ":" outside a bracketed IPv6 ` +
        `literal like "[::1]" (URL userinfo, a scheme, or an inline port is not ` +
        `a host; use "port" for the port).`,
      sourceLabel,
    );
  }

  // port
  let port = base.port;
  if (override.port !== undefined) {
    const p =
      typeof override.port === "number" ? override.port : Number(override.port);
    if (!Number.isInteger(p) || p <= 0 || p > 65535) {
      throw profilesError(
        `profile "${name}": "port" must be an integer 1-65535. Received: ${JSON.stringify(override.port)}.`,
        sourceLabel,
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
        sourceLabel,
      );
    }
    username = override.username;
  }

  // password
  let password = base.password;
  if (override.password !== undefined) {
    if (typeof override.password !== "string") {
      throw profilesError(
        `profile "${name}": "password" must be a string.`,
        sourceLabel,
      );
    }
    password = override.password;
  }

  // namespace
  let namespace = base.namespace;
  if (override.namespace !== undefined) {
    if (typeof override.namespace !== "string" || override.namespace === "") {
      throw profilesError(
        `profile "${name}": "namespace" must be a non-empty string.`,
        sourceLabel,
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
        sourceLabel,
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
        sourceLabel,
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
    // Deferred item 31-0-4's resolution: the prefix is appended here, in the
    // ONE place baseUrl is derived, and also carried through as a structured
    // field below — so `baseUrl === deriveBaseUrl(host, port, https) +
    // (pathPrefix ?? "")` always holds, recoverable from the returned object.
    // `deriveBaseUrl` itself is untouched (Rule #19 — env profiles never pass
    // a pathPrefix, so their baseUrl derivation is byte-identical to before).
    baseUrl: `${deriveBaseUrl(host, port, https)}${pathPrefix ?? ""}`,
    timeout,
    // SQL resource caps (Story 24.2) are operator-set, suite-wide safety
    // controls read from IRIS_SQL_MAX_ROWS/IRIS_SQL_TIMEOUT into the default
    // config; inherit them into every named profile (like `timeout`) so a
    // call resolving to a non-default profile is capped too. Conditional
    // spread preserves the "unset -> field absent" shape (Rule #19).
    ...(base.sqlMaxRows !== undefined ? { sqlMaxRows: base.sqlMaxRows } : {}),
    ...(base.sqlTimeoutMs !== undefined ? { sqlTimeoutMs: base.sqlTimeoutMs } : {}),
    // Provenance (Story 31.3, AC 31.3.1) — always set, never left `undefined`,
    // for every profile this function builds.
    source,
    ...(pathPrefix !== undefined ? { pathPrefix } : {}),
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
  // absent IRIS_PROFILES, the profile's CONNECTION fields are byte-for-byte
  // today's behavior. `source: "env"` is Story 31.3's addition (AC 31.3.1) —
  // deliberately, reviewed: it widens the shape existing `toEqual` fixtures
  // pinned, and those fixtures were updated in the same story (see
  // profiles.test.ts / profiles-resolution.test.ts).
  registry.set(DEFAULT_PROFILE_NAME, {
    name: DEFAULT_PROFILE_NAME,
    ...defaultConfig,
    source: "env",
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
 * **Story 31.0 minimal wire-in + Story 31.1 credential chain + Story 31.3 full
 * merge semantics (Rule #52 seam, closed).** After the existing default +
 * `IRIS_PROFILES` merge, Server-Manager-sourced profiles
 * ({@link resolveServerManagerProfiles}) are resolved for any name not
 * already present in the registry — a name already defined by
 * `IRIS_*`/`IRIS_PROFILES` always wins (AC 31.3.1). Every colliding name is
 * filtered out BEFORE the credential chain runs, so a shadowed name never
 * triggers a real keychain/helper lookup for a profile that would be
 * discarded anyway; collisions are collected and reported as ONE aggregate
 * `logger.warn` naming both provenance sources (`"env"` wins over
 * `"server-manager"`) and every colliding name — not one line per collision
 * (Task 1). A consequence worth knowing: the chain's link 1
 * (`IRIS_PROFILES.<name>.password` / `IRIS_PASSWORD`) can never fire through
 * THIS entry point, since every name it could match is already in the
 * registry; it is live only for direct `resolveCredential` callers such as
 * Story 31.2's CLI. Surviving entries are then completed via
 * {@link resolveServerManagerCredentials} (env → OS keychain → credential
 * helper; AC 31.1.1) and appended — each already carrying
 * `source: "server-manager"` and, when applicable, `sourceFile`/`pathPrefix`
 * (set by {@link resolveServerManagerProfiles}, unchanged by the credential
 * chain, which only ever touches `password`). With `IRIS_SERVER_MANAGER`
 * unset/`off` (the default), `resolveServerManagerProfiles` returns `[]` with
 * ZERO filesystem access, the credential chain therefore has nothing to
 * resolve, and the returned registry stays byte-for-byte today's output
 * PLUS the additive `source: "env"` field on every profile (AC 31.0.4 / Rule
 * #19 — see the Dev Notes on the `source` field's deliberate, reviewed
 * fixture update) — provable synchronously in spirit even though the
 * function is now `async` (unavoidable: the OS-keychain link loads its
 * native module via a guarded dynamic `import()`, which is inherently
 * asynchronous — see `credential-chain.ts`'s module doc comment).
 *
 * @param env - Environment map (defaults to `process.env`).
 * @param platform - Target platform for Server-Manager settings-file discovery
 *   (defaults to `process.platform`); irrelevant when `IRIS_SERVER_MANAGER` is
 *   unset/`off`.
 * @param credentialChainDeps - Injectable OS-keychain/credential-helper seams
 *   (AC 31.1.2/31.1.5) — tests drive the credential chain through this REAL
 *   entry point without ever touching a real keychain or spawning a real
 *   helper process. Production callers omit this (real `@napi-rs/keyring` +
 *   `child_process` implementations).
 * @returns A {@link ProfileRegistry} containing `default`, any `IRIS_PROFILES`
 *   entries, and (when opted in) any credential-chain-completed Server-Manager
 *   profiles.
 * @throws {Error} from {@link loadConfig} (naming `IRIS_PORT`/`IRIS_TIMEOUT`/`IRIS_USERNAME`/`IRIS_PASSWORD`).
 * @throws {Error} (naming `IRIS_PROFILES`) on malformed/invalid `IRIS_PROFILES`.
 * @throws {Error} (naming `IRIS_SERVER_MANAGER`) on an unrecognized mode, or (in `required` mode) zero definitions found, or zero definitions surviving `IRIS_SM_SERVERS`.
 * @throws {Error} (naming `IRIS_SERVER_MANAGER=required`) when at least one Server-Manager profile's credential chain is exhausted (Story 31.1, AC 31.1.1 — a check deliberately distinct from the zero-definitions-found one above).
 */
export async function loadProfileRegistry(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  credentialChainDeps?: Pick<CredentialChainOptions, "getKeychainPassword" | "runCredentialHelper">,
): Promise<ProfileRegistry> {
  const defaultConfig = loadConfig(env);
  const registry = buildProfileRegistry(defaultConfig, env);

  const mode = parseServerManagerMode(env);
  // AC 31.3.1: collisions are COLLECTED here (never logged per-entry) so a
  // settings file shadowing several env-defined names produces ONE aggregate
  // notice below, not one near-duplicate warning line per collision (Task 1
  // — code review 2026-07-25 originally added the minimal per-entry warning
  // that this replaces).
  const collisions: { name: string; host: string }[] = [];
  const smEntries = resolveServerManagerProfiles(env, platform).filter((entry) => {
    if (!registry.has(entry.name)) return true;
    // This discard would otherwise be silent, while the credential chain's
    // own exhaustion message tells the operator to "add a password via
    // IRIS_PROFILES". Following that advice does NOT complete the
    // Server-Manager definition — it REPLACES it with an env profile that
    // inherits the LOCAL host/port/username, so a remote credential ends up
    // aimed at the local instance with no diagnostic at all.
    collisions.push({ name: entry.name, host: entry.host });
    return false;
  });
  if (collisions.length > 0) {
    const named = collisions
      .map((c) => `"${c.name}" (Server Manager host ${c.host})`)
      .join(", ");
    // Code review 2026-07-25 (LOW, found by two independent review layers):
    // the reserved `default` profile is ALWAYS in the registry, so a Server
    // Manager server literally named "default" collides unconditionally — and
    // the generic remedy ("remove the IRIS_PROFILES entry") names a config
    // entry that operator may not even have. Call that case out separately
    // with the only remedy that actually works: rename the definition.
    const reservedCollision = collisions.some((c) => c.name === DEFAULT_PROFILE_NAME);
    const reservedNote = reservedCollision
      ? ` NOTE: "${DEFAULT_PROFILE_NAME}" is the RESERVED profile name, always synthesized from ` +
        `the IRIS_* environment variables, so a Server Manager server with that name can never ` +
        `be imported no matter how you configure IRIS_PROFILES — rename it in ` +
        `intersystems.servers to import it.`
      : "";
    logger.warn(
      `IRIS_SERVER_MANAGER: ${collisions.length} definition(s) collided with an existing ` +
        `profile name already defined by IRIS_*/IRIS_PROFILES — the "env" definition always ` +
        `wins over the "server-manager" one, which is discarded ENTIRELY (host, port and ` +
        `username included): ${named}. An IRIS_PROFILES entry supplying only a password does ` +
        `NOT complete a Server Manager definition: give it the full connection fields, or ` +
        `store the password with "iris-mcp-credentials set <name>" and remove the ` +
        `IRIS_PROFILES entry.${reservedNote}`,
    );
    // 31-3-1 (Story 32.3, PAIRED DECISION with extension item 31-4-4 — AC
    // 32.3.4): under `required`, a settings source whose EVERY definition was
    // discarded by a collision is a startup FAILURE, not a degraded
    // (default-only) start. `required` means "at least one Server-Manager
    // profile must reach the registry" — collision-discard is a fourth
    // rejection class, and the three `required` checks inside
    // `resolveServerManagerProfiles` all passed before this filter ran.
    if (mode === "required" && smEntries.length === 0) {
      throw new Error(
        `IRIS_SERVER_MANAGER=required but every Server Manager definition collided with an ` +
          `existing profile name and was discarded (the "env" definition always wins): ${named}. ` +
          `Rename the colliding intersystems.servers definition(s), or remove/rename the ` +
          `conflicting IRIS_PROFILES entry, or set IRIS_SERVER_MANAGER=auto/off.${reservedNote}`,
      );
    }
  }
  // 31-1-5 (Story 32.3): the pending-resolution summary lives HERE — post
  // collision-filter, immediately before the chain runs — so it counts only
  // the profiles that will actually be attempted. (Pre-Story-32.3 it was
  // emitted inside `resolveServerManagerProfiles`, which cannot see the
  // shadow filter above and over-counted.)
  const pendingCount = smEntries.filter(
    (entry) => entry.credentialStatus === "unresolved",
  ).length;
  if (pendingCount > 0) {
    logger.debug(
      `IRIS_SERVER_MANAGER: ${pendingCount} server profile(s) have no password yet; ` +
        `the credential chain (env, OS keychain, credential helper) will attempt resolution.`,
    );
  }
  const smProfiles = await resolveServerManagerCredentials(smEntries, {
    env,
    mode,
    ...credentialChainDeps,
  });

  for (const profile of smProfiles) {
    registry.set(profile.name, profile);
  }

  return registry;
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
