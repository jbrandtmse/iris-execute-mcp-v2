/**
 * Server Manager connection source (Epic 31, Story 31.0 — foundation module).
 *
 * Reads the InterSystems Server Manager VS Code extension's `intersystems.servers`
 * definitions directly from settings files on disk, so iris-mcp servers can reuse
 * an already-curated connection roster instead of duplicating host/port/username
 * into every MCP client's config.
 *
 * **Scope seam (Rule #52) — read this before extending.** This module owns
 * settings-file discovery, JSONC parsing, and `IRIS_SERVER_MANAGER`/`IRIS_SM_*`
 * env parsing ONLY. It does NOT own:
 * - **Credential resolution (Story 31.1 — IMPLEMENTED as of this story).** A
 *   profile lacking a password is tagged
 *   `credentialStatus: "unresolved"` and INCLUDED (not dropped) in
 *   {@link resolveServerManagerProfiles}'s returned {@link ServerManagerProfileResult}
 *   array, with `password` left `""`. This function still does NOT run the
 *   env → keychain → helper chain itself — that lives in the sibling module
 *   `credential-chain.ts` (`resolveCredential`/`resolveServerManagerCredentials`),
 *   invoked by `loadProfileRegistry` (`profiles.ts`) after this function
 *   returns. Only the deprecated inline `password` field (honored with a
 *   warning) yields an already-`"resolved"` entry from THIS function; every
 *   other entry is handed to the chain unresolved.
 *
 *   **Widened return contract (Story 31.1, Task 2 — the seam 31.0 explicitly
 *   assigned here).** {@link resolveServerManagerProfiles} returns
 *   {@link ServerManagerProfileResult}`[]` (an {@link IrisProfile} plus
 *   `credentialStatus`), not `IrisProfile[]` — every unique, structurally-valid
 *   Server-Manager definition is represented exactly once, tagged `"resolved"`
 *   or `"unresolved"`, regardless of whether a password is yet known.
 *
 *   **31-0-1 (`seenNames` shadowing) — resolved.** An unresolved
 *   higher-precedence entry no longer permanently shadows a same-named,
 *   already-resolvable (legacy-password) entry in a lower-precedence file: a
 *   later file's entry for the same name may "rescue" an unresolved slot by
 *   overwriting it, but ONLY when the later entry is itself `"resolved"` (a
 *   later entry that is ALSO unresolved changes nothing — the first,
 *   highest-precedence unresolved candidate remains authoritative). A name
 *   already fully claimed (`"resolved"`) or permanently invalid (failed
 *   {@link mergeProfile} validation) is never reconsidered.
 *
 *   A rescue REPLACES the whole higher-precedence definition (host, port,
 *   username, scheme), not merely its missing password — so it is announced
 *   with a `logger.warn` naming both files' hosts and the remedy
 *   (`iris-mcp-credentials set <name>` makes the higher-precedence definition
 *   win). Code review 2026-07-25 downgraded this from a silent overwrite:
 *   `"resolved"` at THIS layer only means "carries a deprecated inline
 *   password", never "is the only resolvable candidate", so the rescue can
 *   prefer a stale lower-precedence host over one the credential chain would
 *   have completed. Whether a rescue should be allowed to change the
 *   connection TARGET at all is deferred to Story 31.3, which owns collision
 *   precedence and `source` provenance.
 *
 *   **31-0-2 (`username` inheritance) — resolved.** A Server-Manager entry
 *   that does not declare its OWN `username` is NOT IMPORTED: it is skipped
 *   with a warning naming the file and the remedy, regardless of whether it
 *   carries an inline legacy `password`. Silently pairing an inherited local
 *   username with a password destined for a *different* remote host risks
 *   repeated authentication failures that lock out the account on that remote
 *   instance (deferred item `31-0-2`). Add an explicit `"username"` to the
 *   `intersystems.servers` entry to opt back in.
 *
 *   Merely tagging such an entry `"unresolved"` is NOT sufficient and was the
 *   original (defective) implementation: `"unresolved"` is precisely what is
 *   handed to `credential-chain.ts`, which resolves by NAME and would write a
 *   keychain/helper password straight back onto the inherited username. Skip
 *   is the only form of this guard the chain cannot undo. **Behavior change
 *   vs. Story 31.0:** an entry with an inline `password` but no `username`
 *   used to yield a usable profile; it no longer does (see the README and the
 *   changeset).
 * - **Full registry merge semantics (Story 31.3 — IMPLEMENTED).** Collision
 *   precedence (env always wins, with an aggregate log notice) lives in
 *   `loadProfileRegistry` (`profiles.ts`), one layer up. THIS module sets
 *   `source: "server-manager"` and (when applicable) `sourceFile`/`pathPrefix`
 *   on every profile it returns (via `mergeProfile`'s new parameters — see
 *   `profiles.ts`); those are surfaced through the `iris_server_profiles`
 *   allow-list and audit `profileSource` attribution by `server-discovery.ts`
 *   / `server-base.ts` / `audit.ts`. Final unresolved-profile exclusion (AC
 *   31.0.5) happens one layer up, in `credential-chain.ts`, after the chain
 *   has had its shot.
 *
 * **Why passwords are not readable here.** Server-Manager-saved passwords live
 * in VS Code SecretStorage, encrypted via Electron `safeStorage` with an
 * app-bound OS-keychain key — there is no supported CLI or IPC for an external
 * process to read them. This is the load-bearing constraint behind the whole
 * epic; do not attempt SecretStorage/`state.vscdb` extraction.
 *
 * Nothing in this module (or anywhere in the npm packages) imports `vscode` —
 * it reads settings **files**, never the VS Code extension API.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";

import type { IrisConnectionConfig } from "./config.js";
import { loadConfig } from "./config.js";
import type { IrisProfile } from "./profiles.js";
// ⚠️ CIRCULAR IMPORT (accepted, documented — code review 2026-07-25).
// `profiles.ts` imports `resolveServerManagerProfiles` from THIS module while
// this module imports `mergeProfile`/`ProfileOverride` back from it (AC 31.0.2
// mandates reusing that exact validation). The ESM cycle is benign ONLY because
// both directions are referenced from inside hoisted function bodies and never
// during module evaluation. **Do not evaluate an imported binding at module
// scope in either file** (e.g. `const X = mergeProfile;`, a computed default
// derived from an import, or a decorator/initializer touching one) — that turns
// the cycle into a temporal-dead-zone `ReferenceError` thrown at import time,
// before any of this module's never-throw handling can run. If a module-scope
// use becomes necessary, break the cycle first by extracting `mergeProfile` +
// `ProfileOverride` into a leaf module both sides import.
import { mergeProfile, type ProfileOverride } from "./profiles.js";
import { logger } from "./logger.js";

/** The three recognized `IRIS_SERVER_MANAGER` values. `off` (default/unset) means the module is never invoked. */
export const SERVER_MANAGER_MODES = ["off", "auto", "required"] as const;

/** A recognized `IRIS_SERVER_MANAGER` value. */
export type ServerManagerMode = (typeof SERVER_MANAGER_MODES)[number];

/** VS Code product variants whose user settings are searched, in Server Manager's own support matrix. */
const SETTINGS_PRODUCTS = ["Code", "Code - Insiders", "VSCodium", "Cursor"] as const;

/** One parsed `intersystems.servers` entry, mapped to the reusable {@link ProfileOverride} shape. */
export interface ParsedServerManagerEntry {
  /** Field overrides mapped from `webServer`/`username`/(legacy) `password`, validated by {@link mergeProfile}. */
  override: ProfileOverride;
  /**
   * Normalized `webServer.pathPrefix` (leading `/`, no trailing `/`), applied as a
   * post-merge `baseUrl` suffix — never absent/empty (see module docs "pathPrefix trap").
   */
  pathPrefix?: string;
  /** Whether `password` came from the deprecated inline `intersystems.servers[name].password` field. */
  legacyPassword: boolean;
}

/**
 * Whether a {@link ServerManagerProfileResult} already carries a usable
 * password (`"resolved"`, from a legacy inline `password` field) or still
 * needs Story 31.1's credential chain (`"unresolved"`; `password` is `""`).
 */
export type CredentialStatus = "resolved" | "unresolved";

/**
 * One Server-Manager-sourced profile, as returned by
 * {@link resolveServerManagerProfiles} (Story 31.1's widened contract — see
 * the module doc comment). Structurally an {@link IrisProfile} plus
 * {@link credentialStatus}; `password` is `""` when `credentialStatus` is
 * `"unresolved"`.
 */
export interface ServerManagerProfileResult extends IrisProfile {
  credentialStatus: CredentialStatus;
}

/** Fail-fast helper: a clear error naming `IRIS_SERVER_MANAGER` (mirrors `parseGovernancePreset`/`parseToolVisibilityConfig`). */
function serverManagerModeError(detail: string): Error {
  return new Error(`IRIS_SERVER_MANAGER is invalid: ${detail}`);
}

/**
 * Parse the `IRIS_SERVER_MANAGER` environment variable (AC 31.0.3), mirroring
 * `parseGovernancePreset`'s fail-fast style (architecture decision D7).
 *
 * Unset/empty ⇒ `"off"` (Rule #19 back-compat — the module is never invoked).
 * An unrecognized value fails fast, naming the valid set.
 *
 * @param env - Environment map (defaults to `process.env`).
 * @throws {Error} (naming `IRIS_SERVER_MANAGER`) on an unrecognized value.
 */
export function parseServerManagerMode(
  env: Record<string, string | undefined> = process.env,
): ServerManagerMode {
  const raw = env.IRIS_SERVER_MANAGER;
  if (raw === undefined || raw === "") return "off";
  if ((SERVER_MANAGER_MODES as readonly string[]).includes(raw)) {
    return raw as ServerManagerMode;
  }
  throw serverManagerModeError(
    `must be one of: ${SERVER_MANAGER_MODES.join(", ")}. Received: ${JSON.stringify(raw)}.`,
  );
}

/** Parse the `IRIS_SM_SERVERS` comma-separated allow-list. `undefined` when unset/empty (no filtering). */
function parseServerAllowList(
  env: Record<string, string | undefined>,
): string[] | undefined {
  const raw = env.IRIS_SM_SERVERS;
  if (raw === undefined || raw === "") return undefined;
  const names = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return names.length > 0 ? names : undefined;
}

/**
 * Windows/macOS/Linux user-settings path for one VS Code product variant.
 * Returns `undefined` when the platform's home/appdata env var is not set
 * (never throws — a missing env var just means that candidate is skipped).
 */
function userSettingsPathFor(
  product: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform === "win32") {
    const appData = env.APPDATA;
    if (!appData) return undefined;
    return path.win32.join(appData, product, "User", "settings.json");
  }
  const home = env.HOME;
  if (!home) return undefined;
  if (platform === "darwin") {
    return path.posix.join(
      home,
      "Library",
      "Application Support",
      product,
      "User",
      "settings.json",
    );
  }
  // linux and any other posix-like platform.
  return path.posix.join(home, ".config", product, "User", "settings.json");
}

/**
 * Enumerate candidate Server Manager settings files, in precedence order
 * (highest first): AC 31.0.1.
 *
 * `IRIS_SM_SETTINGS_PATHS` (a `path.delimiter`-separated list, using the
 * platform's own delimiter — `;` on win32, `:` elsewhere) REPLACES discovery
 * entirely when set: no workspace/user candidates are appended.
 *
 * Otherwise, in descending precedence (the caller takes the FIRST file that
 * defines a given server name, so this order IS the precedence order, and it
 * mirrors VS Code's own folder > workspace > user scope ranking):
 *
 * 1. workspace `.vscode/settings.json` — folder scope (resolved from
 *    `IRIS_SM_WORKSPACE` if set, else `process.cwd()`)
 * 2. every `*.code-workspace` file directly inside that same directory —
 *    workspace scope, sorted by filename for determinism
 * 3. each product variant's user settings file for the given `platform`
 *
 * Candidates are returned whether or not they exist on disk — existence is
 * checked later, when the file is actually read — so a non-existent path
 * never throws here. The one exception is step 2, which must list the
 * directory to find workspace files at all; that read is fully guarded and
 * degrades to contributing nothing (see {@link workspaceFileCandidates}).
 *
 * @param env      - Environment map (defaults to `process.env`).
 * @param platform - Target platform (defaults to `process.platform`), injectable
 *   so every OS branch is unit-testable on any host OS.
 * @param cwd      - Workspace root used when `IRIS_SM_WORKSPACE` is unset
 *   (defaults to `process.cwd()`). Defaulted at the SIGNATURE, never read from a
 *   global inside the body, so the fallback branch — the one that runs for
 *   virtually every real user — is unit-testable (Task 2).
 */
export function discoverSettingsFiles(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  cwd: string = process.cwd(),
): string[] {
  const explicit = env.IRIS_SM_SETTINGS_PATHS;
  if (explicit !== undefined && explicit !== "") {
    const delimiter = platform === "win32" ? ";" : ":";
    return explicit
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  const p = platform === "win32" ? path.win32 : path.posix;
  const candidates: string[] = [];

  const workspaceDir = env.IRIS_SM_WORKSPACE ?? cwd;
  candidates.push(p.join(workspaceDir, ".vscode", "settings.json"));

  // A `.code-workspace` file is WORKSPACE scope, which VS Code ranks BELOW
  // folder scope (`.vscode/settings.json`) and ABOVE user scope — so it slots
  // exactly here, and the caller's first-file-wins rule then yields VS Code's
  // own precedence for a name defined in more than one place. Multi-root users
  // commonly keep `intersystems.servers` ONLY in this file; without it they
  // silently import nothing, because `auto` does not fail on zero definitions.
  for (const workspaceFile of workspaceFileCandidates(workspaceDir, p)) {
    candidates.push(workspaceFile);
  }

  for (const product of SETTINGS_PRODUCTS) {
    const userSettingsPath = userSettingsPathFor(product, env, platform);
    if (userSettingsPath !== undefined) {
      candidates.push(userSettingsPath);
    }
  }

  return candidates;
}

/**
 * List `*.code-workspace` files directly inside `workspaceDir`, sorted for a
 * deterministic candidate order.
 *
 * Unlike the rest of discovery this MUST touch the filesystem — a VS Code
 * workspace file has no fixed name, so it can only be found by listing the
 * directory. Every failure mode (missing directory, permission error, a path
 * that is not a directory) therefore degrades to an empty list rather than
 * throwing: discovery's contract is that a path which is not there never
 * throws, and `auto` must never crash startup (AC 31.0.2).
 *
 * Not reached when `IRIS_SERVER_MANAGER` is `off` — `resolveServerManagerProfiles`
 * returns before calling discovery, so the "off touches ZERO filesystem" proof
 * (AC 31.0.3) still holds.
 */
function workspaceFileCandidates(
  workspaceDir: string,
  // `typeof path.win32` rather than a named `PlatformPath` type: @types/node
  // does not expose that name under the `path` namespace here, and both
  // `path.win32` and `path.posix` share this exact shape.
  p: typeof path.win32,
): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(workspaceDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".code-workspace"))
    .sort()
    .map((name) => p.join(workspaceDir, name));
}

/** Normalize a `webServer.pathPrefix` value: leading `/`, no trailing `/`. Empty/whitespace-only ⇒ `undefined`. */
function normalizePathPrefix(raw: string): string | undefined {
  let prefix = raw.trim();
  if (prefix === "") return undefined;
  if (!prefix.startsWith("/")) prefix = `/${prefix}`;
  while (prefix.length > 1 && prefix.endsWith("/")) {
    prefix = prefix.slice(0, -1);
  }
  return prefix === "/" ? undefined : prefix;
}

/** JSONC parse options: comments allowed (default), trailing commas allowed (AC 31.0.2), empty content allowed (an empty settings file is not malformed). */
const JSONC_PARSE_OPTIONS = {
  disallowComments: false,
  allowTrailingComma: true,
  allowEmptyContent: true,
};

/**
 * Parse `intersystems.servers` out of a VS Code settings file's raw text
 * (AC 31.0.2).
 *
 * Uses `jsonc-parser` (comments and trailing commas are legal JSONC). `/default`
 * and any other `/`-prefixed key are skipped (Server Manager markers, not server
 * definitions). `superServer` is ignored entirely (this suite is Atelier/web-server
 * only). An inline legacy `password` is honored (flagged via
 * {@link ParsedServerManagerEntry.legacyPassword} so the caller can warn — this
 * function itself never logs, keeping it a pure parser).
 *
 * An absent/non-object `intersystems.servers` key returns an empty object with NO
 * error — a settings file with no IRIS servers is the common case, not a problem.
 *
 * Structurally unusable entries are skipped silently (this function never logs):
 * a non-object entry, an entry with no `webServer` object, an entry whose
 * `webServer.host` is not a non-empty string, and an empty/whitespace-only
 * server name. **`webServer.host` is deliberately mandatory** — Server Manager's
 * own schema requires it, and inheriting the LOCAL default host would point a
 * profile named after a remote server at `localhost` and send that entry's
 * inline password there (the mirror image of the password-inheritance guard in
 * {@link resolveServerManagerProfiles}).
 *
 * @throws {Error} When the JSONC text itself is malformed (non-empty `ParseError[]`
 *   from `jsonc-parser`) — the caller is expected to catch this, warn naming the
 *   offending FILE, and skip just that file (never crashing startup in `auto`/`required`).
 */
export function parseIntersystemsServers(
  text: string,
): Record<string, ParsedServerManagerEntry> {
  const errors: ParseError[] = [];
  // Strip a UTF-8 BOM before parsing: `jsonc-parser` reports it as an
  // `InvalidSymbol` error at offset 0 (while still returning the correct value),
  // which would make a perfectly valid BOM-encoded settings.json — what Windows
  // editors and PowerShell's `Out-File`/`Set-Content -Encoding utf8` produce —
  // look malformed and be discarded whole. VS Code itself strips the BOM.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const root: unknown = parseJsonc(source, errors, JSONC_PARSE_OPTIONS);

  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `malformed JSONC (${errors.length} parse error(s)` +
        (first ? `, first at offset ${first.offset}` : "") +
        `).`,
    );
  }

  const result: Record<string, ParsedServerManagerEntry> = {};

  if (
    root === undefined ||
    root === null ||
    typeof root !== "object" ||
    Array.isArray(root)
  ) {
    return result;
  }

  const rootObj = root as Record<string, unknown>;

  // A `settings.json` holds `intersystems.servers` at the top level; a VS Code
  // `.code-workspace` file nests every setting under a `settings` key. Accept
  // BOTH shapes from the one parser, so a workspace file works whether it was
  // reached through discovery or named explicitly in `IRIS_SM_SETTINGS_PATHS`.
  // The top-level form wins if a file somehow carries both.
  let servers = rootObj["intersystems.servers"];
  if (servers === undefined) {
    const nested = rootObj["settings"];
    if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
      servers = (nested as Record<string, unknown>)["intersystems.servers"];
    }
  }

  if (
    servers === undefined ||
    servers === null ||
    typeof servers !== "object" ||
    Array.isArray(servers)
  ) {
    return result;
  }

  for (const [name, rawEntry] of Object.entries(
    servers as Record<string, unknown>,
  )) {
    // "/default" and any "/"-prefixed key are Server Manager markers, not
    // server definitions (e.g. `"/default": "localIris"`).
    if (name.startsWith("/")) continue;
    // An empty/whitespace-only name cannot be addressed: `resolveProfile` maps
    // "" to the reserved `default` profile, so such an entry would be an
    // unreachable registry row that still shows up (blank) in the valid-profile
    // list. `IRIS_PROFILES` rejects the same shape (`profiles.ts`).
    if (name.trim() === "") continue;
    if (
      rawEntry === null ||
      typeof rawEntry !== "object" ||
      Array.isArray(rawEntry)
    ) {
      continue;
    }

    const entry = rawEntry as Record<string, unknown>;
    const rawWebServer = entry["webServer"];
    if (
      rawWebServer === null ||
      typeof rawWebServer !== "object" ||
      Array.isArray(rawWebServer)
    ) {
      // No webServer block — not a usable connection definition.
      continue;
    }
    const webServer = rawWebServer as Record<string, unknown>;

    // `host` is MANDATORY (see the doc comment): without it the entry would
    // inherit the local default host and quietly aim a remote-named profile —
    // and that entry's own inline password — at localhost.
    const rawHost = webServer["host"];
    if (typeof rawHost !== "string" || rawHost.trim() === "") continue;

    const rawScheme = webServer["scheme"];
    const override: ProfileOverride = {
      // Always explicit: an absent/non-"https" scheme means http (matches the
      // Server Manager reference client's own default). Compared case- and
      // whitespace-insensitively so a hand-edited "HTTPS" cannot silently
      // downgrade the connection to cleartext HTTP (Basic auth in the clear).
      https:
        typeof rawScheme === "string" &&
        rawScheme.trim().toLowerCase() === "https",
    };
    override.host = rawHost;
    if (webServer["port"] !== undefined) override.port = webServer["port"];
    if (entry["username"] !== undefined) override.username = entry["username"];

    let legacyPassword = false;
    const rawPassword = entry["password"];
    // Trimmed: a whitespace-only password is not a credential — treating it as
    // one would admit a profile that 401s at first use instead of surfacing the
    // actionable "no password available yet" startup summary.
    if (typeof rawPassword === "string" && rawPassword.trim() !== "") {
      override.password = rawPassword;
      legacyPassword = true;
    }
    // `superServer` is intentionally never read (ignored entirely — AC 31.0.2).

    let pathPrefix: string | undefined;
    const rawPathPrefix = webServer["pathPrefix"];
    if (typeof rawPathPrefix === "string") {
      pathPrefix = normalizePathPrefix(rawPathPrefix);
    }

    result[name] = {
      override,
      legacyPassword,
      ...(pathPrefix !== undefined ? { pathPrefix } : {}),
    };
  }

  return result;
}

/**
 * Resolve IRIS connection profiles from Server Manager settings files
 * (AC 31.0.1, 31.0.2, 31.0.3, 31.0.5).
 *
 * `off` (unset/default): returns `[]` immediately — the filesystem is never
 * touched (Rule #19 back-compat; provable with a filesystem spy/mock).
 *
 * `auto`/`required`: discovers candidate settings files ({@link discoverSettingsFiles}),
 * reads and parses each ({@link parseIntersystemsServers}; a missing file is
 * silently skipped, an unreadable file and a malformed file each log a warning
 * naming the file and are skipped), and merges each entry over the local default
 * connection config (`loadConfig(env)`) via the SAME field validation
 * `IRIS_PROFILES` uses ({@link mergeProfile}), with the error source label
 * parameterized so a bad Server-Manager definition never blames `IRIS_PROFILES`
 * (the `mergeProfile` trap). The default's `password` is deliberately NOT
 * inherited (it would otherwise silently reuse one host's password against a
 * different host) — a profile with no password of its own (no legacy inline
 * `password`, or no `username` of its own — see 31-0-2 below) is tagged
 * `credentialStatus: "unresolved"` (Story 31.1's widened contract — see the
 * module doc comment) rather than excluded; the returned array always contains
 * exactly one entry per unique, structurally-valid name, `"resolved"` or
 * `"unresolved"`. A name already defined by a higher-precedence file is skipped
 * — UNLESS the higher-precedence entry is still `"unresolved"` and this
 * lower-precedence entry is itself `"resolved"`, in which case it RESCUES the
 * slot (31-0-1; see the module doc comment) — a permanently-invalid
 * (validation-failed) or already-`"resolved"` name is never reconsidered.
 * `IRIS_SM_SERVERS` restricts import to a comma-separated allow-list; a listed
 * name matching nothing WARNs (never fails in `auto`).
 *
 * **Containment (AC 31.0.2 — "never crashes startup in `auto`").** Every
 * per-file AND per-entry failure is contained: an entry whose fields fail
 * {@link mergeProfile}'s validation logs a warning naming the file + server +
 * reason and is skipped, exactly like a malformed file. One stale entry in a
 * VS Code settings file this suite does not own can never take down the server
 * (and with it the perfectly good env-derived `default` profile).
 *
 * `required` fails fast on THREE distinct conditions, each with its own
 * message so the operator is pointed at the right fix: (1) NO server
 * definition was found across all files (counted BEFORE both the
 * `IRIS_SM_SERVERS` allow-list and credential resolution); (2) definitions
 * existed but the `IRIS_SM_SERVERS` allow-list matched none of them; (3)
 * definitions existed and survived the allow-list, but every single one was
 * rejected by field validation or the "own username" check, so NOTHING
 * landed in the returned array (deferred item 31-1-1's resolution — Story
 * 31.0 originally had only checks 1 and 2, so an all-invalid settings file
 * silently started the server with just the `default` profile). A definition
 * that exists, is structurally valid, and merely lacks a password does NOT
 * trip `required` here; that credential-chain-exhaustion escalation is a
 * FOURTH, separate check — AC 31.1.1's, implemented in `credential-chain.ts`
 * (`resolveServerManagerCredentials`), per binding spec F1-D1 vs F1-D2. All
 * these `required` checks are DELIBERATELY kept apart (Story 31.1 Dev Notes)
 * — conflating them would make a passwordless-but-valid definition
 * indistinguishable from a missing or malformed one.
 *
 * @param env      - Environment map (defaults to `process.env`).
 * @param platform - Target platform (defaults to `process.platform`).
 * @param cwd      - Workspace root for discovery when `IRIS_SM_WORKSPACE` is
 *   unset (defaults to `process.cwd()`); passed through to
 *   {@link discoverSettingsFiles}.
 * @throws {Error} (naming `IRIS_SERVER_MANAGER`) on an unrecognized mode.
 * @throws {Error} From `loadConfig` (naming `IRIS_USERNAME`/`IRIS_PASSWORD`/etc.) in `auto`/`required` mode.
 * @throws {Error} `required` mode with zero definitions found, zero definitions surviving `IRIS_SM_SERVERS`, or zero definitions surviving per-entry validation (deferred item 31-1-1).
 */
export function resolveServerManagerProfiles(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  cwd: string = process.cwd(),
): ServerManagerProfileResult[] {
  const mode = parseServerManagerMode(env);
  if (mode === "off") return [];

  // Base for field inheritance mirrors IRIS_PROFILES's own model, EXCEPT the
  // password is deliberately cleared — see the doc comment above.
  const defaultConfig: IrisConnectionConfig = loadConfig(env);
  const smBase: IrisConnectionConfig = { ...defaultConfig, password: "" };

  const allowList = parseServerAllowList(env);
  const matchedAllowNames = new Set<string>();

  const files = discoverSettingsFiles(env, platform, cwd);
  /** Names whose first sighting (any outcome) has already been counted (definitionsFound). */
  const seenNames = new Set<string>();
  /** Names whose first sighting has already been counted toward consideredCount. */
  const consideredNames = new Set<string>();
  /**
   * Per-name terminal/current state (31-0-1 rescue bookkeeping): `"resolved"`
   * and `"invalid"` are terminal (never reconsidered); `"unresolved"` may be
   * overwritten by a later, lower-precedence entry that resolves.
   */
  const nameStates = new Map<string, CredentialStatus | "invalid">();
  /** The current best {@link ServerManagerProfileResult} per name (insertion order = first-successful-sighting order). */
  const resultByName = new Map<string, ServerManagerProfileResult>();
  let unresolvedCount = 0;
  /** Definitions discovered, counted BEFORE the allow-list filter. */
  let definitionsFound = 0;
  /** Definitions surviving the allow-list (i.e. actually considered for import). */
  let consideredCount = 0;

  // Which files were actually consulted is otherwise invisible — and it depends
  // on the process CWD, which the MCP *client* chooses. Log it so an operator
  // can diagnose "why did/didn't my server show up" without guesswork.
  if (files.length === 0) {
    logger.warn(
      `IRIS_SERVER_MANAGER=${mode} but no candidate settings files were derived. ` +
        `Check IRIS_SM_SETTINGS_PATHS (a ${platform === "win32" ? ";" : ":"}-separated ` +
        `list of settings.json paths), IRIS_SM_WORKSPACE, or APPDATA/HOME.`,
    );
  } else {
    logger.debug(
      `IRIS_SERVER_MANAGER=${mode}: candidate settings files (highest precedence first): ${files.join(", ")}`,
    );
  }

  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (e: unknown) {
      // ENOENT is the overwhelmingly common case (a candidate that simply does
      // not exist) and is not worth a word. Anything else — EACCES, EISDIR, a
      // broken symlink — is a real condition the operator must be able to see;
      // silently swallowing it makes `required`'s "zero definitions found"
      // error blame the wrong thing entirely.
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        const reason = e instanceof Error ? e.message : String(e);
        logger.warn(
          `IRIS_SERVER_MANAGER: could not read "${file}" — ${reason}. Skipping this file.`,
        );
      }
      continue;
    }

    let entries: Record<string, ParsedServerManagerEntry>;
    try {
      entries = parseIntersystemsServers(text);
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      logger.warn(`IRIS_SERVER_MANAGER: skipping "${file}" — ${reason}`);
      continue;
    }

    for (const [name, entry] of Object.entries(entries)) {
      const priorState = nameStates.get(name);
      // Terminal states are never reconsidered: "resolved" already has a
      // usable password, "invalid" permanently failed mergeProfile validation
      // on its FIRST sighting (mirrors pre-31.1 per-file containment — a bad
      // field value is not silently "fixed" by a later file without an
      // operator noticing the original warning).
      if (priorState === "resolved" || priorState === "invalid") continue;

      // definitionsFound/consideredCount each count a unique NAME exactly
      // once, at first sighting — regardless of resolution outcome — so the
      // 31-0-1 rescue mechanism below (which DOES re-examine an unresolved
      // name across files) never double-counts.
      if (!seenNames.has(name)) {
        seenNames.add(name);
        definitionsFound++;
      }

      if (allowList !== undefined) {
        if (!allowList.includes(name)) continue;
        matchedAllowNames.add(name);
      }
      if (!consideredNames.has(name)) {
        consideredNames.add(name);
        consideredCount++;
      }

      const sourceLabel = `Server Manager definition "${name}" (${file})`;
      let profile: IrisProfile;
      try {
        // `"server-manager"` provenance (AC 31.3.1) and the pathPrefix
        // (deferred item 31-0-4's resolution) are both applied INSIDE
        // mergeProfile now, so `baseUrl` is derived in the one place that
        // knows the formula. `sourceFile` (deferred item 31-0-3's
        // resolution) is metadata about WHERE this definition came from, not
        // a connection field mergeProfile merges/validates, so it is set
        // here instead.
        const merged = mergeProfile(
          name,
          smBase,
          entry.override,
          sourceLabel,
          "server-manager",
          entry.pathPrefix,
        );
        profile = { ...merged, sourceFile: file };
      } catch (e: unknown) {
        // Containment: a bad FIELD VALUE is skipped exactly like a bad FILE.
        // `mergeProfile`'s message never echoes a password (asserted in tests).
        const reason = e instanceof Error ? e.message : String(e);
        logger.warn(`IRIS_SERVER_MANAGER: skipping ${reason}`);
        // Only claim the name as permanently "invalid" on a genuine FIRST
        // sighting — a lower-precedence entry's own validation failure must
        // never erase a perfectly good (if still password-less)
        // higher-precedence "unresolved" candidate already on file.
        if (priorState === undefined) nameStates.set(name, "invalid");
        continue;
      }

      // 31-0-2: a Server-Manager entry that does not declare its OWN
      // "username" is NOT IMPORTED AT ALL. Checked via entry.override, NOT
      // profile.username, because mergeProfile always fills profile.username
      // from the inherited default when the override omits it, so
      // profile.username is never a reliable "was it explicit" signal.
      //
      // Code review 2026-07-25 (HIGH): the original implementation only
      // CLEARED the password and tagged the entry "unresolved" — but
      // "unresolved" is exactly what gets handed to the credential chain,
      // and the chain resolves by NAME only. A keychain/helper hit was
      // therefore written straight back onto a profile still carrying the
      // inherited LOCAL username, silently recreating the very remote-account
      // lockout this guard exists to prevent (proven live). Worse, the
      // warning was gated on an inline password being present, so the common
      // shape — no username AND no inline password — was completely silent.
      // Skipping the entry outright is the only form of the guard that the
      // chain cannot undo, and it matches this module's existing containment
      // style for a structurally unusable entry (missing host, failed
      // mergeProfile validation): warn naming the file + reason, skip, never
      // fatal. `nameStates` is deliberately NOT set, so a lower-precedence
      // file's entry for the same name that DOES declare a username can still
      // claim the slot.
      if (entry.override.username === undefined) {
        logger.warn(
          `IRIS_SERVER_MANAGER: skipping server "${name}" (${file}) — it declares no ` +
            `"username" of its own. Inheriting the local default username here would pair ` +
            `it with a password destined for a different remote host (repeated failures can ` +
            `lock out the remote account), so this definition is NOT imported and the ` +
            `credential chain is never run for it. Add "username" to ` +
            `intersystems.servers.${name} to enable it.`,
        );
        continue;
      }

      if (entry.legacyPassword) {
        logger.warn(
          `IRIS_SERVER_MANAGER: server "${name}" (${file}) uses a deprecated inline ` +
            `"password" field in intersystems.servers. Prefer the iris-mcp-credentials ` +
            `CLI once available, or supply the password via IRIS_PROFILES.`,
        );
      }

      const credentialStatus: CredentialStatus =
        profile.password.trim() === "" ? "unresolved" : "resolved";

      if (priorState === "unresolved" && credentialStatus === "unresolved") {
        // A lower-precedence entry that is ALSO unresolved adds nothing —
        // keep the existing (higher-precedence) unresolved candidate as
        // authoritative (31-0-1: only a RESOLVED lower-precedence candidate
        // may rescue an unresolved slot).
        continue;
      }

      if (priorState === "unresolved") {
        // 31-0-1 RESCUE. Code review 2026-07-25 (MEDIUM): this replaces the
        // WHOLE higher-precedence definition — host, port, username, scheme —
        // not just its missing password, and it does so on the strength of a
        // DEPRECATED inline password while the higher-precedence entry would
        // very likely have been completed by the credential chain (which
        // resolves by name). Connecting to a different host than the
        // highest-precedence settings file declares is undiagnosable in
        // silence, so say it out loud and name both hosts.
        const shadowed = resultByName.get(name);
        logger.warn(
          `IRIS_SERVER_MANAGER: server "${name}" is defined in more than one settings file. ` +
            `The higher-precedence definition (host ${shadowed?.host ?? "?"}) carries no ` +
            `password of its own, so the lower-precedence definition from "${file}" (host ` +
            `${profile.host}) is imported INSTEAD — including its host, port and username. ` +
            `Store a password for "${name}" (iris-mcp-credentials set ${name}) to make the ` +
            `higher-precedence definition win.`,
        );
      }

      nameStates.set(name, credentialStatus);
      resultByName.set(name, { ...profile, credentialStatus });
    }
  }

  if (allowList !== undefined) {
    for (const wanted of allowList) {
      if (!matchedAllowNames.has(wanted)) {
        logger.warn(
          `IRIS_SM_SERVERS: no Server Manager definition named "${wanted}" was found.`,
        );
      }
    }
  }

  const results = [...resultByName.values()];
  unresolvedCount = results.filter((r) => r.credentialStatus === "unresolved").length;

  if (unresolvedCount > 0) {
    // Informational, not final: Story 31.1's credential chain
    // (`credential-chain.ts`, invoked from `loadProfileRegistry`) still gets a
    // shot at env/keychain/helper resolution for each of these. Only that
    // chain's own per-profile exhaustion log (or the `required` throw) is the
    // terminal word on whether a name actually ends up usable.
    logger.debug(
      `IRIS_SERVER_MANAGER: ${unresolvedCount} server profile(s) have no password yet; ` +
        `the credential chain (env, OS keychain, credential helper) will attempt resolution.`,
    );
  }

  if (mode === "required" && definitionsFound === 0) {
    throw new Error(
      `IRIS_SERVER_MANAGER=required but zero server definitions were found. ` +
        `Checked: ${files.length > 0 ? files.join(", ") : "(no candidate settings files)"}. ` +
        `Set IRIS_SM_SETTINGS_PATHS to a settings file containing an "intersystems.servers" ` +
        `entry, define servers in Server Manager, or set IRIS_SERVER_MANAGER=auto/off.`,
    );
  }

  if (mode === "required" && consideredCount === 0) {
    // definitionsFound > 0 here: the settings files are fine, IRIS_SM_SERVERS is
    // the culprit. Naming the right variable (and the available names) is the
    // whole point — the generic message above would send the user to fix files
    // that are already correct.
    throw new Error(
      `IRIS_SERVER_MANAGER=required but IRIS_SM_SERVERS matched none of the ` +
        `${definitionsFound} server definition(s) found. Requested: ` +
        `${(allowList ?? []).join(", ")}. Available: ${[...seenNames].join(", ")}. ` +
        `Correct IRIS_SM_SERVERS (names are case-sensitive) or unset it to import all.`,
    );
  }

  // Deferred item 31-1-1's resolution — a THIRD, narrower `required` check.
  // definitionsFound/consideredCount both increment at first SIGHTING,
  // before mergeProfile validation and the "own username" check, so a
  // definition that is structurally invalid (e.g. a non-numeric port) or
  // omits its own "username" was counted as "found"/"considered" while never
  // landing in `results` — and neither check above ever tripped: `required`
  // silently started the server with only the `default` profile (reproduced
  // live: a sole definition with `"port": "not-a-port"` threw nothing and
  // yielded an empty registry). By the time control reaches here in
  // `required` mode, both checks above have already passed without throwing,
  // so definitionsFound > 0 and consideredCount > 0 are guaranteed — the only
  // way `results` can still be empty is every considered definition having
  // been REJECTED, each with its own warning already logged above (naming
  // the file + server + reason). This escalates that into a startup failure
  // rather than a silently degraded (default-only) server.
  if (mode === "required" && results.length === 0) {
    throw new Error(
      `IRIS_SERVER_MANAGER=required but ${consideredCount} server definition(s) were ` +
        `considered and NONE could be imported — every one was rejected (an invalid field ` +
        `value, or no "username" of its own; see the warning logged above for the specific ` +
        `reason for each). Fix the offending intersystems.servers entries, or set ` +
        `IRIS_SERVER_MANAGER=auto/off.`,
    );
  }

  return results;
}
