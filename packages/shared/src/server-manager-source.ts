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
 *   **31-0-1 (`seenNames` shadowing) / 31-1-2 (rescue changes the target) /
 *   31-3-3 (terminal-invalid never reconsidered) — PAIRED DECISION, recorded
 *   2026-07-26 in Story 32.3 (AC 32.3.4): FIRST-FILE-WINS, always.** A name's
 *   fate is decided at its FIRST sighting across the precedence-ordered files
 *   and is never reconsidered — whether that first sighting resolved, is
 *   still unresolved, or failed validation. The Story-31.1 "rescue" (a
 *   lower-precedence RESOLVED entry overwriting an UNRESOLVED
 *   higher-precedence slot — host, port and username included, on the
 *   strength of a deprecated inline password) is REMOVED: the credential
 *   chain resolves by NAME, so an unresolved higher-precedence entry is the
 *   RECOMMENDED shape (password in the OS keychain via
 *   `iris-mcp-credentials set <name>`), not a dead one, and the rescue
 *   silently overrode the documented discovery precedence (VS Code's own
 *   folder > workspace > user ranking) and could move the connection TARGET
 *   to a stale lower-precedence host. Skipping a password-bearing
 *   lower-precedence definition is never silent: one `logger.warn` names
 *   both files' hosts and the remedy.
 *
 *   **32-3-R1 (Story 32.4) — PD-1 covers PARSER-LEVEL drops too.** A name
 *   whose first sighting is a structurally unusable entry (non-object, no
 *   `webServer`, blank host — reported via
 *   {@link ParseIntersystemsServersOptions.dropped}) is marked terminal
 *   `"invalid"` exactly like a mergeProfile-invalid first sighting: a
 *   lower-precedence file's VALID definition of the same name is NOT
 *   imported. The one deliberate exception remains 31-0-2 below (an entry
 *   skipped ONLY for lacking its own `"username"` sets no state, so a
 *   lower-precedence entry that declares one can still claim the slot) — the
 *   `required` check-3 message states both halves.
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
function userSettingsPathsFor(
  product: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string[] {
  if (platform === "win32") {
    const appData = env.APPDATA;
    if (!appData) return [];
    return [path.win32.join(appData, product, "User", "settings.json")];
  }

  const home = env.HOME;

  if (platform === "darwin") {
    if (!home) return [];
    return [
      path.posix.join(home, "Library", "Application Support", product, "User", "settings.json"),
    ];
  }

  // linux and any other posix-like platform.
  //
  // VS Code is Electron, and Electron's `app.getPath("appData")` on Linux is
  // documented as `$XDG_CONFIG_HOME` OR `~/.config` — it is not hard-wired to
  // `~/.config`. The Flatpak packaging docs confirm the mechanism from the
  // other side: Flatpak sandboxes an Electron app's config precisely BY
  // redirecting `$XDG_CONFIG_HOME` into `~/.var/app/<id>/config`, which only
  // works because Electron honors that variable. So when `XDG_CONFIG_HOME` is
  // set we must look there.
  //
  // Both are emitted (XDG first) rather than either/or: candidates need not
  // exist, so the extra path costs one already-guarded failed read, and it
  // keeps working for someone who set `XDG_CONFIG_HOME` after VS Code had
  // already written to `~/.config`.
  const paths: string[] = [];
  const xdgConfigHome = env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    paths.push(path.posix.join(xdgConfigHome, product, "User", "settings.json"));
  }
  if (home) {
    const defaultPath = path.posix.join(home, ".config", product, "User", "settings.json");
    // Deduplicate the common case XDG_CONFIG_HOME="$HOME/.config".
    if (!paths.includes(defaultPath)) paths.push(defaultPath);
  }
  return paths;
}

/**
 * Flatpak-sandboxed user-settings paths (Linux only).
 *
 * A Flatpak install cannot write `~/.config` at all — Flatpak redirects the
 * app's `$XDG_CONFIG_HOME` into `~/.var/app/<app-id>/config`, so the settings
 * file lands at `~/.var/app/<app-id>/config/<Product>/User/settings.json`.
 * Without these candidates a Flatpak user (common on Fedora/Silverblue)
 * imports nothing at all, silently, since `auto` does not fail on zero.
 *
 * The `(appId, product)` pairs are fixed, not a cross product: each Flathub
 * app carries exactly one Electron product directory. Verified against
 * Flathub 2026-07-26. **Cursor is deliberately absent — it is not published
 * on Flathub**; a third-party Cursor Flatpak would have an unknowable app id,
 * and `IRIS_SM_SETTINGS_PATHS` is the escape hatch for anything unlisted here.
 */
const FLATPAK_USER_SETTINGS = [
  { appId: "com.visualstudio.code", product: "Code" },
  { appId: "com.visualstudio.code.insiders", product: "Code - Insiders" },
  { appId: "com.vscodium.codium", product: "VSCodium" },
] as const;

/** Flatpak user-settings candidates for `platform`; empty on win32/darwin (Flatpak is Linux-only). */
function flatpakSettingsPaths(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string[] {
  if (platform === "win32" || platform === "darwin") return [];
  const home = env.HOME;
  if (!home) return [];
  return FLATPAK_USER_SETTINGS.map(({ appId, product }) =>
    path.posix.join(home, ".var", "app", appId, "config", product, "User", "settings.json"),
  );
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
 * Every candidate is ABSOLUTE (31-3-5): a relative `IRIS_SM_SETTINGS_PATHS`
 * entry or `IRIS_SM_WORKSPACE` is resolved with the platform path module's
 * `resolve` (against the server process's CWD), so the `sourceFile` a
 * profile later reports is never a relative path meaningful only to the CWD
 * the MCP *client* happened to choose.
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
  const p = platform === "win32" ? path.win32 : path.posix;
  // 31-3-5: resolve candidates to ABSOLUTE so `sourceFile` is never a
  // relative path meaningful only against the server process's CWD. A
  // candidate already absolute under EITHER path convention (a win32 drive
  // path or a posix root path) is kept verbatim — in production the platform
  // and every path share one convention, and the other-convention-absolute
  // case only arises when a test simulates a foreign platform against real
  // host temp directories (which must stay openable). 32-3-R2 (Story 32.4):
  // the posix disjunct is spelled out EXPLICITLY rather than relying on the
  // subtlety that `path.win32.isAbsolute("/x")` is true (win32 treats a
  // leading slash as rooted) — the either-convention guarantee is now stated
  // in the code, and a passthrough test pins it on every host OS.
  const toAbsolute = (candidate: string): string =>
    p.isAbsolute(candidate) || path.win32.isAbsolute(candidate) || path.posix.isAbsolute(candidate)
      ? candidate
      : p.resolve(candidate);
  const explicit = env.IRIS_SM_SETTINGS_PATHS;
  if (explicit !== undefined && explicit !== "") {
    const delimiter = platform === "win32" ? ";" : ":";
    return explicit
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map(toAbsolute);
  }

  const candidates: string[] = [];

  const workspaceDir = toAbsolute(env.IRIS_SM_WORKSPACE ?? cwd);
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
    for (const userSettingsPath of userSettingsPathsFor(product, env, platform)) {
      candidates.push(toAbsolute(userSettingsPath));
    }
  }

  // Flatpak installs last within user scope: a native install is the more
  // common case, so it wins a same-name collision against a Flatpak one.
  for (const flatpakPath of flatpakSettingsPaths(env, platform)) {
    candidates.push(toAbsolute(flatpakPath));
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

/**
 * A normalized prefix that still contains `?`, `#`, `//`, or `:` is invalid
 * (31-0-5): it composes a malformed `baseUrl` authority — e.g. `?debug=1`
 * normalizes to `/?debug=1`, and `http://h:52773/?debug=1/api/atelier/…`
 * lets the query string swallow the entire path so every call 404s with
 * nothing pointing at `pathPrefix` as the cause. The prefix is IGNORED (the
 * entry survives), never applied.
 */
function isInvalidPathPrefix(prefix: string): boolean {
  return (
    prefix.includes("?") ||
    prefix.includes("#") ||
    prefix.includes("//") ||
    prefix.includes(":")
  );
}

/** JSONC parse options: comments allowed (default), trailing commas allowed (AC 31.0.2), empty content allowed (an empty settings file is not malformed). */
const JSONC_PARSE_OPTIONS = {
  disallowComments: false,
  allowTrailingComma: true,
  allowEmptyContent: true,
};

/** Options accepted by {@link parseIntersystemsServers} (31-3-2). */
export interface ParseIntersystemsServersOptions {
  /**
   * The settings file being parsed, used ONLY to name it in the per-entry
   * drop warnings. When omitted the parser stays the pure, never-logging
   * parser Story 31.0 shipped (back-compat); `resolveServerManagerProfiles`
   * always passes it.
   */
  fileLabel?: string;
  /**
   * Out-param: every structurally-unusable entry dropped during the parse,
   * with the specific reason. Filled whether or not `fileLabel` is set, so
   * the caller can COUNT the drops (a parser-level drop must not masquerade
   * as "zero definitions found" under `required` — it is a rejected
   * definition, and the third `required` check is the one that should fire).
   */
  dropped?: { name: string; reason: string }[];
}

/**
 * Parse `intersystems.servers` out of a VS Code settings file's raw text
 * (AC 31.0.2).
 *
 * Uses `jsonc-parser` (comments and trailing commas are legal JSONC). `/default`
 * and any other `/`-prefixed key are skipped (Server Manager markers, not server
 * definitions). `superServer` is ignored entirely (this suite is Atelier/web-server
 * only). An inline legacy `password` is honored (flagged via
 * {@link ParsedServerManagerEntry.legacyPassword} so the caller can warn).
 *
 * An absent/non-object `intersystems.servers` key returns an empty object with NO
 * error — a settings file with no IRIS servers is the common case, not a problem.
 *
 * Structurally unusable entries are dropped: a non-object entry, an entry with
 * no `webServer` object, an entry whose `webServer.host` is not a non-empty
 * string, and an empty/whitespace-only server name. **`webServer.host` is
 * deliberately mandatory** — Server Manager's own schema requires it, and
 * inheriting the LOCAL default host would point a profile named after a remote
 * server at `localhost` and send that entry's inline password there (the mirror
 * image of the password-inheritance guard in {@link resolveServerManagerProfiles}).
 * Each drop is reported via {@link ParseIntersystemsServersOptions.dropped} and,
 * when {@link ParseIntersystemsServersOptions.fileLabel} is set, announced with
 * ONE `logger.warn` per entry naming file + server + the specific reason
 * (31-3-2 — pre-Story-32.3 these drops were completely silent, so under
 * `required` the misleading "zero definitions found" check fired against the
 * very file that defined the server). A `/`-prefixed marker key and an
 * empty/whitespace-only NAME are NOT reported (markers are not definitions,
 * and a blank name has nothing actionable to name).
 *
 * A `webServer.pathPrefix` that is still invalid after normalization
 * (`?`/`#`/`//`/`:` — 31-0-5) is IGNORED with a warning (when `fileLabel` is
 * set); the entry itself survives with no prefix.
 *
 * @throws {Error} When the JSONC text itself is malformed (non-empty `ParseError[]`
 *   from `jsonc-parser`) — the caller is expected to catch this, warn naming the
 *   offending FILE, and skip just that file (never crashing startup in `auto`/`required`).
 */
export function parseIntersystemsServers(
  text: string,
  options?: ParseIntersystemsServersOptions,
): Record<string, ParsedServerManagerEntry> {
  const fileLabel = options?.fileLabel;
  /** Report one dropped entry: out-param always, warning only with a fileLabel. */
  const reportDrop = (name: string, reason: string): void => {
    options?.dropped?.push({ name, reason });
    if (fileLabel !== undefined) {
      logger.warn(
        `IRIS_SERVER_MANAGER: skipping server "${name}" (${fileLabel}) — ${reason}.`,
      );
    }
  };
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
      reportDrop(name, "the entry is not an object");
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
      reportDrop(name, "it has no \"webServer\" block");
      continue;
    }
    const webServer = rawWebServer as Record<string, unknown>;

    // `host` is MANDATORY (see the doc comment): without it the entry would
    // inherit the local default host and quietly aim a remote-named profile —
    // and that entry's own inline password — at localhost.
    const rawHost = webServer["host"];
    if (typeof rawHost !== "string" || rawHost.trim() === "") {
      reportDrop(name, "its \"webServer.host\" is missing or blank");
      continue;
    }

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
      // 31-0-5: an invalid prefix is IGNORED (never applied) with a warning —
      // the entry itself survives with no prefix.
      if (pathPrefix !== undefined && isInvalidPathPrefix(pathPrefix)) {
        if (fileLabel !== undefined) {
          logger.warn(
            `IRIS_SERVER_MANAGER: ignoring "webServer.pathPrefix" ${JSON.stringify(rawPathPrefix)} ` +
              `for server "${name}" (${fileLabel}) — a path prefix must not contain "?", "#", ` +
              `"//" or ":" (it would compose a malformed base URL). The server is imported ` +
              `without a path prefix.`,
          );
        }
        pathPrefix = undefined;
      }
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
 * `"unresolved"`. A name already seen by a higher-precedence file is skipped
 * — FIRST-FILE-WINS, always (the 31-1-2/31-3-3 paired decision, Story 32.3 —
 * see the module doc comment): a later file's entry never replaces an earlier
 * sighting, whether that sighting resolved, is still unresolved, failed
 * validation, or was dropped by the parser as structurally unusable
 * (32-3-R1 — parser drops are terminal too; the sole exception is 31-0-2's
 * no-own-username skip, which yields to a lower-precedence entry that
 * declares one). A password-bearing skipped definition is announced with a
 * `logger.warn` naming both files' hosts and the remedy.
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
 * `IRIS_SM_SERVERS` allow-list and credential resolution, and INCLUDING
 * parser-level drops — 31-3-2, so a file whose only definition is
 * structurally unusable does not masquerade as "zero found"); (2) definitions
 * existed but the `IRIS_SM_SERVERS` allow-list matched none of them; (3)
 * definitions existed and survived the allow-list, but every single one was
 * rejected — by the parser (no usable `webServer.host`), by field validation,
 * or by the "own username" check — so NOTHING landed in the returned array
 * (deferred item 31-1-1's resolution — Story 31.0 originally had only checks
 * 1 and 2, so an all-invalid settings file silently started the server with
 * just the `default` profile). A definition that exists, is structurally
 * valid, and merely lacks a password does NOT trip `required` here; that
 * credential-chain-exhaustion escalation is a FOURTH, separate check — AC
 * 31.1.1's, implemented in `credential-chain.ts`
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
   * Per-name terminal/current state (31-0-1 bookkeeping): `"resolved"` and
   * `"invalid"` are terminal (never reconsidered — and since Story 32.4 /
   * 32-3-R1 a PARSER-LEVEL drop also lands here as terminal `"invalid"`); under
   * the 31-1-2/31-3-3 FIRST-FILE-WINS decision (Story 32.3) `"unresolved"` is
   * terminal too in effect — a later sighting of ANY outcome keeps the
   * higher-precedence candidate (with one warning when the skipped entry bore
   * a password). The single documented exception is 31-0-2 (an entry skipped
   * ONLY for lacking its own `"username"`), which deliberately sets no state
   * so a lower-precedence entry that declares one can still claim the slot.
   */
  const nameStates = new Map<string, CredentialStatus | "invalid">();
  /** The current best {@link ServerManagerProfileResult} per name (insertion order = first-successful-sighting order). */
  const resultByName = new Map<string, ServerManagerProfileResult>();
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
    const parserDropped: { name: string; reason: string }[] = [];
    try {
      entries = parseIntersystemsServers(text, { fileLabel: file, dropped: parserDropped });
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      logger.warn(`IRIS_SERVER_MANAGER: skipping "${file}" — ${reason}`);
      continue;
    }

    // 31-3-2: parser-level drops COUNT as found/considered definitions (each
    // already produced its own per-entry warning above naming file + server +
    // reason). Without this, a settings file whose only definition is
    // structurally unusable makes `required`'s FIRST check throw "zero server
    // definitions were found. Checked: <the very file that defines prod>" —
    // blaming the file instead of the entry — when the THIRD check ("every
    // considered definition was rejected") is the honest one.
    for (const drop of parserDropped) {
      if (!seenNames.has(drop.name)) {
        seenNames.add(drop.name);
        definitionsFound++;
        // 32-3-R1 (Story 32.4 — PD-1 alignment, recorded decision): a
        // parser-level drop is a TERMINAL first sighting, exactly like a
        // mergeProfile-invalid one. Pre-Story-32.4 the drop claimed
        // `seenNames` (counting) but never `nameStates`, so a lower-precedence
        // file's VALID definition of the same name was still imported —
        // contradicting PD-1's "a name's fate is decided at its first
        // sighting" and the check-3 message's "NOT reconsidered" note. The
        // per-drop warning above already names the file + reason; the fix is
        // to repair the rejected entry in the file that OWNS the first
        // sighting, never to shadow it from a lower-precedence file.
        nameStates.set(drop.name, "invalid");
      }
      if (allowList !== undefined) {
        if (!allowList.includes(drop.name)) continue;
        matchedAllowNames.add(drop.name);
      }
      if (!consideredNames.has(drop.name)) {
        consideredNames.add(drop.name);
        consideredCount++;
      }
    }

    for (const [name, entry] of Object.entries(entries)) {
      const priorState = nameStates.get(name);
      // Terminal states are never reconsidered: "resolved" already has a
      // usable password, "invalid" permanently failed on its FIRST sighting —
      // either mergeProfile field validation or (32-3-R1) a parser-level drop
      // in a higher-precedence file (mirrors pre-31.1 per-file containment —
      // a bad definition is not silently "fixed" by a later file without an
      // operator noticing the original warning).
      if (priorState === "resolved" || priorState === "invalid") continue;

      // definitionsFound/consideredCount each count a unique NAME exactly
      // once, at first sighting — regardless of resolution outcome — so a
      // name re-examined across files (a lower-precedence sighting skipped
      // under FIRST-FILE-WINS) never double-counts.
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
        // authoritative.
        continue;
      }

      if (priorState === "unresolved") {
        // 31-1-2 + 31-3-3 PAIRED DECISION (Story 32.3, AC 32.3.4 — recorded
        // 2026-07-26): FIRST-FILE-WINS, always. The 31-0-1 "rescue" (a
        // lower-precedence RESOLVED entry overwriting the unresolved
        // higher-precedence slot — host, port and username included, on the
        // strength of a DEPRECATED inline password) is REMOVED. The
        // credential chain resolves by NAME, so an unresolved
        // higher-precedence entry is the RECOMMENDED shape (password in the
        // OS keychain via `iris-mcp-credentials set <name>`), not a dead
        // one; the rescue silently overrode the documented discovery
        // precedence (VS Code's own folder > workspace > user ranking) and
        // could move the connection TARGET to a stale lower-precedence host.
        //
        // The skip must still never be silent: a password-bearing definition
        // was IGNORED, and the operator very likely does not know. One
        // warning names both hosts and the remedy that completes the WINNING
        // definition.
        const shadowed = resultByName.get(name);
        logger.warn(
          `IRIS_SERVER_MANAGER: server "${name}" is defined in more than one settings file. ` +
            `First-file-wins: the higher-precedence definition (host ${shadowed?.host ?? "?"}) ` +
            `stays authoritative, and the lower-precedence definition from "${file}" (host ` +
            `${profile.host}) — including its inline password — is IGNORED. Store a password ` +
            `for "${name}" (iris-mcp-credentials set ${name}) to complete the higher-precedence ` +
            `definition, or remove that definition to import this one.`,
        );
        continue;
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
  // 31-1-5 (Story 32.3): no pending-resolution summary is emitted HERE — this
  // layer cannot see loadProfileRegistry's registry-shadow filter, so its
  // count included entries discarded one call later that never reached the
  // chain. The (post-filter) summary now lives in loadProfileRegistry
  // (`profiles.ts`), immediately before the chain actually runs.

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
        `considered and NONE could be imported — every one was rejected (a structurally ` +
        `unusable entry, an invalid field value, or no "username" of its own; see the warning ` +
        `logged above for the specific reason for each). Note: a name whose first sighting was ` +
        `structurally unusable or failed field validation is NOT reconsidered in lower-precedence ` +
        `files (32-3-R1); only an entry skipped solely for lacking its own "username" yields to ` +
        `a lower-precedence entry that declares one. Fix the offending ` +
        `intersystems.servers entries, or set IRIS_SERVER_MANAGER=auto/off.`,
    );
  }

  return results;
}
