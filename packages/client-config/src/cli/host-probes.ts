/**
 * `@iris-mcp/client-config` — host probes for CLI mode gating (Epic 33,
 * Story 33.2, Task 3's "mode gating" seam).
 *
 * `server-manager` and `governance-file` synthesis modes are offered only
 * when the HOST can support them:
 *
 * - `server-manager` — `IRIS_SERVER_MANAGER` is already set in the
 *   environment, OR at least one settings file carrying `intersystems.servers`
 *   definitions is found at the standard VS Code settings locations. The
 *   candidate enumeration below MIRRORS the Epic-31 discovery surface in
 *   `packages/shared/src/server-manager-source.ts` (`discoverSettingsFiles`
 *   + `userSettingsPathsFor` + `flatpakSettingsPaths`, verified against that
 *   source 2026-07-27 per Rule #47) — deliberately mirrored, NOT imported:
 *   the story's zero-new-dependency constraint (the CLI mirrors the
 *   governance CLI's zero-dep discipline) rules out a workspace dependency
 *   on `@iris-mcp/shared` (which would drag the MCP SDK + keyring into this
 *   package's install graph). If the shared discovery surface changes, this
 *   mirror must move with it — the citation above is the pointer.
 * - `governance-file` — an existing file at the `--governance-file <path>`
 *   flag or the `IRIS_GOVERNANCE_FILE` environment variable.
 *
 * This module lives OUTSIDE the CLI file so the AC 33.2-I1 source-scan pin
 * (no parser imports in the CLI itself) can hold: probing whether Server
 * Manager definitions exist requires parsing settings files, which is
 * discovery logic, not the CLI's argv/render/confirm surface. It NEVER
 * parses or edits a client MCP config — that is the engine's job alone.
 */

import { parse as parseJsonc, type ParseError } from "jsonc-parser";

import type { AdapterPlatform } from "../types.js";
import type { WriteFs } from "../write.js";

export interface ProbeContext {
  env: Record<string, string | undefined>;
  platform: AdapterPlatform;
  homeDir: string;
  projectDir?: string;
  fs: WriteFs;
}

export interface ServerManagerProbe {
  available: boolean;
  /** Human-readable explanation (why available, or what is missing). */
  reason: string;
  /** Settings files found carrying definitions (paths only — never content). */
  sources: string[];
}

export interface GovernanceFileProbe {
  available: boolean;
  /** The resolved path (flag wins over env), when one was named at all. */
  path?: string;
  reason: string;
}

/** The VS Code product variants whose user settings are probed (mirrors the shared SETTINGS_PRODUCTS). */
const SETTINGS_PRODUCTS = ["Code", "Code - Insiders", "VSCodium", "Cursor"] as const;

/** Flatpak (appId, product) pairs — Linux only (mirrors the shared FLATPAK_USER_SETTINGS; Cursor is not on Flathub). */
const FLATPAK_USER_SETTINGS = [
  { appId: "com.visualstudio.code", product: "Code" },
  { appId: "com.visualstudio.code.insiders", product: "Code - Insiders" },
  { appId: "com.vscodium.codium", product: "VSCodium"},
] as const;

function joinFor(platform: AdapterPlatform, ...segments: string[]): string {
  // Forward-slash join then platform normalize — the paths.ts discipline.
  const joined = segments.join("/");
  return platform === "win32" ? joined.replace(/\//g, "\\") : joined;
}

/**
 * Enumerate the candidate Server Manager settings files, mirroring
 * `discoverSettingsFiles` (packages/shared/src/server-manager-source.ts):
 * `IRIS_SM_SETTINGS_PATHS` replaces discovery entirely; otherwise workspace
 * `.vscode/settings.json` + `*.code-workspace`, then per-product user
 * settings, then (Linux) Flatpak user settings.
 */
function settingsCandidates(ctx: ProbeContext): string[] {
  const explicit = ctx.env.IRIS_SM_SETTINGS_PATHS;
  if (explicit !== undefined && explicit !== "") {
    const delimiter = ctx.platform === "win32" ? ";" : ":";
    return explicit
      .split(delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  const candidates: string[] = [];
  const home = ctx.env.HOME !== undefined && ctx.env.HOME !== "" ? ctx.env.HOME : ctx.homeDir;

  // Workspace scope: IRIS_SM_WORKSPACE if set, else the CLI's project dir.
  const workspaceDir = ctx.env.IRIS_SM_WORKSPACE !== undefined && ctx.env.IRIS_SM_WORKSPACE !== ""
    ? ctx.env.IRIS_SM_WORKSPACE
    : ctx.projectDir;
  if (workspaceDir !== undefined) {
    candidates.push(joinFor(ctx.platform, workspaceDir, ".vscode", "settings.json"));
    let entries: string[] = [];
    try {
      entries = ctx.fs.listDir(workspaceDir);
    } catch {
      entries = [];
    }
    for (const name of entries.filter((entry) => entry.endsWith(".code-workspace")).sort()) {
      candidates.push(joinFor(ctx.platform, workspaceDir, name));
    }
  }

  // Per-product user settings (mirrors userSettingsPathsFor).
  for (const product of SETTINGS_PRODUCTS) {
    if (ctx.platform === "win32") {
      const appData = ctx.env.APPDATA;
      if (appData !== undefined && appData !== "") {
        candidates.push(joinFor(ctx.platform, appData, product, "User", "settings.json"));
      }
    } else if (ctx.platform === "darwin") {
      if (home !== "") {
        candidates.push(joinFor(ctx.platform, home, "Library", "Application Support", product, "User", "settings.json"));
      }
    } else {
      const xdg = ctx.env.XDG_CONFIG_HOME;
      if (xdg !== undefined && xdg !== "") {
        candidates.push(joinFor(ctx.platform, xdg, product, "User", "settings.json"));
      }
      if (home !== "") {
        const defaultPath = joinFor(ctx.platform, home, ".config", product, "User", "settings.json");
        if (!candidates.includes(defaultPath)) candidates.push(defaultPath);
      }
    }
  }

  // Flatpak (Linux only — mirrors flatpakSettingsPaths).
  if (ctx.platform === "linux" && home !== "") {
    for (const { appId, product } of FLATPAK_USER_SETTINGS) {
      candidates.push(joinFor(ctx.platform, home, ".var", "app", appId, "config", product, "User", "settings.json"));
    }
  }

  return candidates;
}

/**
 * True when the file parses (JSONC) and its `intersystems.servers` object
 * carries at least one definition (a key not starting with "/" — the shared
 * parser's own skip rule for Server Manager markers). A malformed or
 * definition-free file simply does not count as a discovery source.
 *
 * Like the shared `parseIntersystemsServers`, BOTH shapes are accepted: a
 * `settings.json` holds `intersystems.servers` at the top level, while a
 * `.code-workspace` file nests every setting under a `settings` key (33.2
 * review: the mirror enumerated `.code-workspace` candidates but recognized
 * only the top-level shape — a probe false-negative for users whose only
 * Server Manager definitions live in a workspace file).
 */
function hasServerDefinitions(ctx: ProbeContext, path: string): boolean {
  let text: string;
  try {
    text = ctx.fs.readFile(path);
  } catch {
    return false;
  }
  const errors: ParseError[] = [];
  let parsed: unknown;
  try {
    parsed = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  } catch {
    return false;
  }
  if (errors.length > 0 || typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return false;
  }
  const root = parsed as Record<string, unknown>;
  let servers = root["intersystems.servers"];
  if (servers === undefined) {
    const nested = root["settings"];
    if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
      servers = (nested as Record<string, unknown>)["intersystems.servers"];
    }
  }
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return false;
  return Object.keys(servers as Record<string, unknown>).some((name) => !name.startsWith("/"));
}

/**
 * Probe whether Server Manager is discoverable on this host:
 * `IRIS_SERVER_MANAGER` set (non-empty) in the environment, OR at least one
 * settings file with `intersystems.servers` definitions at the standard
 * locations. Never throws — an unreadable candidate is skipped.
 */
export function probeServerManager(ctx: ProbeContext): ServerManagerProbe {
  const mode = ctx.env.IRIS_SERVER_MANAGER;
  if (mode !== undefined && mode !== "") {
    return { available: true, reason: `IRIS_SERVER_MANAGER is set ("${mode}")`, sources: [] };
  }
  const sources: string[] = [];
  for (const candidate of settingsCandidates(ctx)) {
    let exists = false;
    try {
      exists = ctx.fs.exists(candidate);
    } catch {
      exists = false;
    }
    if (!exists) continue;
    if (hasServerDefinitions(ctx, candidate)) sources.push(candidate);
  }
  if (sources.length > 0) {
    return {
      available: true,
      reason: `intersystems.servers definitions found in ${sources.length} settings file(s)`,
      sources,
    };
  }
  return {
    available: false,
    reason:
      "IRIS_SERVER_MANAGER is unset and no intersystems.servers definitions were found at the " +
      "standard VS Code settings locations",
    sources: [],
  };
}

/**
 * Probe whether `governance-file` mode is usable: a file path named by the
 * `--governance-file` flag (wins) or `IRIS_GOVERNANCE_FILE` (env), existing
 * on disk. An empty flag/env value is treated as unnamed (mirroring the
 * loader's empty-means-unset rule).
 */
export function probeGovernanceFile(
  ctx: ProbeContext,
  flagPath: string | undefined,
): GovernanceFileProbe {
  const fromFlag = flagPath !== undefined && flagPath !== "" ? flagPath : undefined;
  const envValue = ctx.env.IRIS_GOVERNANCE_FILE;
  const fromEnv = envValue !== undefined && envValue !== "" ? envValue : undefined;
  const resolved = fromFlag ?? fromEnv;
  if (resolved === undefined) {
    return {
      available: false,
      reason:
        "governance-file mode needs an existing governance file: pass --governance-file <path> " +
        "or set IRIS_GOVERNANCE_FILE",
    };
  }
  let exists = false;
  try {
    exists = ctx.fs.exists(resolved);
  } catch {
    exists = false;
  }
  if (!exists) {
    return { available: false, path: resolved, reason: `the governance file does not exist: ${resolved}` };
  }
  return { available: true, path: resolved, reason: `governance file found: ${resolved}` };
}
