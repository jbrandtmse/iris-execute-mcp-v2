/**
 * `@iris-mcp/client-config` — declarative ClientAdapter types (Epic 33, Story 33.0).
 *
 * Binding spec: `_bmad-output/planning-artifacts/research/
 * technical-iris-server-manager-mcp-connections-research-2026-07-25.md`
 * Feature 3 addendum §3.2 (the `ClientAdapter` interface is transcribed from
 * there; §3.2 is authoritative on any conflict).
 *
 * The design rule (spec §3.2): everything is data — code handles formats,
 * data handles clients. Adding a client never touches engine code.
 */

/** Platforms the adapter path templates are keyed by (matches process.platform values we support). */
export type AdapterPlatform = "win32" | "darwin" | "linux";

/** Config file scope: user-private vs project (shareable/committable). */
export type ClientScope = "user" | "project";

/** Native config file format of a client. */
export type ConfigFormat = "json" | "jsonc" | "toml" | "yaml";

/**
 * Per-OS path templates. Templates are forward-slash, env-var based:
 * - `%VAR%` (Windows style) and `${VAR}` are expanded from the injected env.
 * - A leading `~` expands to the injected homeDir.
 * - Project-scope templates are relative to the injected projectDir.
 * Unresolved placeholders are left verbatim (a probe against such a path
 * simply reports not-exists; resolution never invents values).
 */
export interface PlatformPaths {
  win32: string;
  darwin: string;
  linux: string;
}

/** One supported scope of a client config surface. */
export interface ScopeDef {
  scope: ClientScope;
  paths: PlatformPaths;
  /** True when this file is safe to commit/share (project files); user files are private. */
  shareable: boolean;
  /**
   * Optional environment-variable override for this scope's location
   * (e.g. Kimi Code honors `$KIMI_CODE_HOME`). When the named variable is
   * set to a non-empty value in the injected env, the resolved path is
   * `<env value>/<pathSuffix>` and the `paths` templates are bypassed.
   */
  envOverride?: { var: string; pathSuffix: string };
  /**
   * Additional candidate locations consulted (in order) when the primary
   * template's file does not exist. Generic machinery, currently unused by
   * the v1 roster: kimi-code's `.mcp.json` fallback (the one consumer) was
   * removed in Story 33.4 after a live probe falsified the client's support
   * for it — only re-add a fallback with certification evidence.
   */
  fallbacks?: PlatformPaths[];
}

/** Shape of one MCP server entry inside the client config (spec §3.2). */
export type EntryShape =
  | "standard" // {command,args,env}
  | "zed" // context_servers command-object variant
  | "goose" // extensions {type:"stdio",cmd,args,envs,...}
  | "codex-toml"; // [mcp_servers.<name>] tables

/**
 * Client-side environment-variable expansion convention inside entry values.
 * Spec §3.2 defines "claude" (`${VAR}`, `${VAR:-def}`), "vscode"
 * (`${input:id}`, `${env:VAR}`) and "none" (literals only); "shell" extends
 * the union for Gemini CLI's documented `$VAR`/`${VAR}` shell convention
 * (spec §3.2 table row "Gemini CLI") — recorded deviation, Story 33.0.
 */
export type EnvExpansion = "claude" | "vscode" | "none" | "shell";

/**
 * How the manager disables an entry for this client (spec §3.4):
 * - "native": the client has a real disabled/enabled flag on entries.
 * - "stash": manager stash-and-remove (the entry is removed from the file and
 *   byte-preserved in the manager's own state — the state file is Story
 *   33.1's write-side concern; this story only REPORTS the mechanism).
 */
export type DisableSupport = "native" | "stash";

/** The file-level flag a "native" disable mechanism toggles. */
export interface NativeDisableFlag {
  key: string;
  enabledValue: unknown;
  disabledValue: unknown;
}

/** One detection probe (spec §3.2 `detection: DetectionRule[]`). */
export type DetectionRule =
  /** Probe the resolved config-file path for the named scope. */
  | { kind: "config"; scope: ClientScope }
  /** Probe an application/extension data directory (per-OS templates). */
  | { kind: "appDir"; paths: PlatformPaths };

/** Declarative description of one MCP client's config surface (spec §3.2). */
export interface ClientAdapter {
  id: string; // "claude-code", "cursor", "kimi-code", ...
  displayName: string;
  format: ConfigFormat;
  rootKey: string; // "mcpServers" | "servers" | "mcp_servers" | "context_servers" | "extensions"
  scopes: ScopeDef[];
  entryShape: EntryShape;
  envExpansion: EnvExpansion;
  disableSupport: DisableSupport;
  nativeDisableFlag?: NativeDisableFlag;
  restartHint: string;
  detection: DetectionRule[];
  docsUrl: string;
}

/** A client that was considered and dispositioned out of the adapter roster. */
export interface ClientDisposition {
  id: string;
  displayName: string;
  disposition: "excluded-not-mcp-capable" | "roadmap";
  reason: string;
}

/** The canonical iris-mcp server set (spec §3.3) — the rows of the status matrix.
 * `iris-mcp-all` is deliberately EXCLUDED (Project Lead decision 2026-07-28,
 * epics.md AC 33.3.2 amendment): it is a real aggregate stdio server, but as a
 * peer row it invites applying all 5 servers AND the aggregate, double-
 * registering every tool in the client. An `iris-mcp-all` entry in a client
 * config is therefore FOREIGN to the manager (surfaced read-only, never
 * modified) — users who want the aggregate hand-write it. */
export const CANONICAL_SERVERS = [
  "iris-dev-mcp",
  "iris-admin-mcp",
  "iris-ops-mcp",
  "iris-interop-mcp",
  "iris-data-mcp",
] as const;

export type CanonicalServerName = (typeof CANONICAL_SERVERS)[number];

/**
 * The canonical internal server-entry model (spec §3.3). Story 33.1 owns
 * synthesizing these in the four env modes; this story's diff renderer only
 * needs the SHAPE to render a native entry from it.
 */
export interface CanonicalEntry {
  name: CanonicalServerName;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Injectable host environment — the resolution/detection core NEVER reads
 * process.env/process.platform/os.homedir() directly (story constraint; the
 * 33.2 CLI wires the real ones at the package boundary). */
export interface HostContext {
  platform: AdapterPlatform;
  env: Record<string, string | undefined>;
  homeDir: string;
  /** Required to resolve/probe project-scope paths; omit to skip project scopes. */
  projectDir?: string;
}
