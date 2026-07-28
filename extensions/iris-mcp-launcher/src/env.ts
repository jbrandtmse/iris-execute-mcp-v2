/**
 * Synthesizes the spawn environment for `npx -y @iris-mcp/<pkg>` (AC 31.4.2,
 * Integration AC 31.4.5).
 *
 * Pure functions only — no `vscode` dependency — so the exact variable names
 * and JSON shape can be pinned against the suite's real, documented env
 * contract without a VS Code host:
 *   - Single profile: `IRIS_HOST`, `IRIS_PORT`, `IRIS_HTTPS`, `IRIS_USERNAME`,
 *     `IRIS_PASSWORD`, `IRIS_NAMESPACE` (`packages/shared/src/config.ts`'s
 *     `loadConfig`).
 *   - Multiple profiles: the above PLUS `IRIS_PROFILES`, a JSON object keyed by
 *     profile name, each value shaped like `ProfileOverride`
 *     (`packages/shared/src/profiles.ts`) — `host`, `port`, `username`,
 *     `password`, `namespace`, `https`.
 *
 * Governance/audit/visibility variables are passed through UNCHANGED from
 * extension settings — this module (and this extension) is a launcher, never
 * a policy authority.
 */
import type { LauncherSettings, ResolvedConnectionProfile } from "./types.js";

/** Options for {@link synthesizeIrisEnv}. */
export interface SynthesizeOptions {
  /**
   * Emit `IRIS_PROFILES` even for a single profile. Set when the caller is in
   * multi-profile (`combineProfiles`) mode: that mode's whole contract is that
   * every covered server is addressable by name through the suite's `server`
   * tool parameter, and a registry built without `IRIS_PROFILES` contains only
   * the reserved `default` entry — so a one-server combined definition would
   * otherwise fail every `server: "<name>"` call. Defaults to
   * `profiles.length > 1`.
   */
  alwaysEmitProfiles?: boolean;
}

/** Build the `IRIS_*` / `IRIS_PROFILES` portion of the spawn env from one or more resolved profiles. */
export function synthesizeIrisEnv(
  profiles: ResolvedConnectionProfile[],
  namespaceDefault: string,
  options: SynthesizeOptions = {},
): Record<string, string> {
  const [first] = profiles;
  if (!first) {
    throw new Error("synthesizeIrisEnv requires at least one resolved profile.");
  }

  const env: Record<string, string> = {
    IRIS_HOST: first.host,
    IRIS_PORT: String(first.port),
    IRIS_HTTPS: first.https ? "true" : "false",
    IRIS_USERNAME: first.username,
    IRIS_PASSWORD: first.password,
    IRIS_NAMESPACE: first.namespace || namespaceDefault,
  };

  if (options.alwaysEmitProfiles === true || profiles.length > 1) {
    const profilesObj: Record<string, unknown> = {};
    for (const profile of profiles) {
      profilesObj[profile.name] = {
        host: profile.host,
        port: profile.port,
        https: profile.https,
        username: profile.username,
        password: profile.password,
        namespace: profile.namespace || namespaceDefault,
      };
    }
    env.IRIS_PROFILES = JSON.stringify(profilesObj);
  }

  return env;
}

/** `LauncherSettings` field -> pass-through env var name, in the exact spelling `packages/shared` reads. */
const GOVERNANCE_PASSTHROUGH: readonly [keyof LauncherSettings, string][] = [
  ["governance", "IRIS_GOVERNANCE"],
  ["governancePreset", "IRIS_GOVERNANCE_PRESET"],
  ["governanceFile", "IRIS_GOVERNANCE_FILE"],
  ["auditLog", "IRIS_AUDIT_LOG"],
  ["auditLogMaxMb", "IRIS_AUDIT_LOG_MAX_MB"],
  ["auditLogParams", "IRIS_AUDIT_LOG_PARAMS"],
  ["toolsPreset", "IRIS_TOOLS_PRESET"],
  ["toolsDisable", "IRIS_TOOLS_DISABLE"],
  ["toolsEnable", "IRIS_TOOLS_ENABLE"],
];

/**
 * Pass through governance/audit/visibility settings UNCHANGED. A "" setting
 * means unset — the var is omitted entirely (matching the suite's own
 * unset-means-default behavior) rather than emitted as an empty string.
 */
export function buildGovernanceEnv(settings: LauncherSettings): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, varName] of GOVERNANCE_PASSTHROUGH) {
    const value = settings[key];
    if (typeof value === "string" && value !== "") {
      env[varName] = value;
    }
  }
  return env;
}

/**
 * Every suite environment variable this launcher OWNS — i.e. every variable
 * whose value is fully determined by a resolved connection or an
 * `irisMcpLauncher.*` setting.
 *
 * `McpStdioServerDefinition.env` is ADDITIVE over the extension host's own
 * environment (`vscode.d.ts`: "Variables in this environment will overwrite or
 * remove (if null) the default environment variables of the editor's extension
 * host"). Without explicit clearing, a developer whose shell exports
 * `IRIS_PROFILES`, `IRIS_GOVERNANCE`, `IRIS_SERVER_MANAGER`, … silently leaks
 * those into every spawned server: extra addressable profiles pointing at
 * hosts with credentials the user never configured here, a governance policy
 * the extension's own settings say is unset, or a Server-Manager import path
 * that competes with the profiles this launcher just synthesized.
 *
 * `IRIS_TIMEOUT` / `IRIS_SQL_*` are deliberately NOT in this set: the
 * extension exposes no setting for them, so an ambient value contradicts
 * nothing the user configured here and stays an intentional escape hatch.
 */
const LAUNCHER_OWNED_VARS: readonly string[] = [
  "IRIS_HOST",
  "IRIS_PORT",
  "IRIS_HTTPS",
  "IRIS_USERNAME",
  "IRIS_PASSWORD",
  "IRIS_NAMESPACE",
  "IRIS_PROFILES",
  "IRIS_GOVERNANCE",
  "IRIS_GOVERNANCE_PRESET",
  "IRIS_GOVERNANCE_FILE",
  "IRIS_AUDIT_LOG",
  "IRIS_AUDIT_LOG_MAX_MB",
  "IRIS_AUDIT_LOG_PARAMS",
  "IRIS_TOOLS_PRESET",
  "IRIS_TOOLS_DISABLE",
  "IRIS_TOOLS_ENABLE",
  // The launcher IS the profile source for the servers it spawns; an ambient
  // Server-Manager import would layer a second, unrelated roster on top.
  "IRIS_SERVER_MANAGER",
  "IRIS_SM_SERVERS",
  "IRIS_SM_SETTINGS_PATHS",
  "IRIS_SM_WORKSPACE",
  "IRIS_CREDENTIAL_HELPER",
];

/**
 * Take the variables this launcher is actually setting and add an explicit
 * `null` for every other launcher-owned variable, so "the extension did not
 * set this" means UNSET in the child rather than "inherited from whatever the
 * extension host happened to have".
 */
export function withOwnedVarsCleared(
  setVars: Record<string, string>,
): Record<string, string | null> {
  const env: Record<string, string | null> = { ...setVars };
  for (const varName of LAUNCHER_OWNED_VARS) {
    if (!(varName in env)) {
      env[varName] = null;
    }
  }
  return env;
}
