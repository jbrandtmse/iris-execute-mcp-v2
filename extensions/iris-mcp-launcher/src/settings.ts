/**
 * Reads `irisMcpLauncher.*` extension settings into a validated
 * {@link LauncherSettings}. Accepts an injected config reader so this stays
 * unit-testable without a VS Code host (Task 7) — `extension.ts` supplies the
 * real `vscode.workspace.getConfiguration` at activation.
 */
import type { LauncherSettings, SuitePackageKey } from "./types.js";

export const CONFIG_SECTION = "irisMcpLauncher";

const ALL_PACKAGE_KEYS: readonly SuitePackageKey[] = [
  "admin",
  "data",
  "dev",
  "interop",
  "ops",
  "all",
];

/** Default `irisMcpLauncher.packages` — every individual suite package, matching the root README's "install one or all" guidance. Excludes the `all` meta-package (opt-in, heavier). */
export const DEFAULT_PACKAGES: readonly SuitePackageKey[] = [
  "admin",
  "data",
  "dev",
  "interop",
  "ops",
];

const DEFAULT_NAMESPACE = "HSCUSTOM";

/** Minimal shape of `vscode.WorkspaceConfiguration` this module reads. */
export interface ConfigReader {
  get<T>(section: string, defaultValue: T): T;
}

function isSuitePackageKey(value: string): value is SuitePackageKey {
  return (ALL_PACKAGE_KEYS as readonly string[]).includes(value);
}

/**
 * Coerce a raw settings value to a string array.
 *
 * `WorkspaceConfiguration.get` returns whatever is literally in
 * `settings.json` — the contributed JSON schema only drives a squiggle in the
 * settings EDITOR, it never rejects or coerces a hand-written value. So
 * `"irisMcpLauncher.servers": "prod"` (a bare string, an easy mistake) would
 * otherwise reach `.filter(...)` and throw a `TypeError` out of the provider,
 * registering zero servers with no message. Non-arrays and non-string members
 * are dropped, falling back to the declared default.
 */
function toStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Coerce a raw settings value to a string, tolerating a JSON number/boolean written where a string was declared. */
function toSettingString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

/** Read and validate `irisMcpLauncher.*` settings. `getConfig` defaults to a real `vscode.workspace.getConfiguration` call — pass a fake in tests. */
export function readSettings(getConfig: (section: string) => ConfigReader): LauncherSettings {
  const config = getConfig(CONFIG_SECTION);

  const rawPackages = toStringArray(config.get<unknown>("packages", [...DEFAULT_PACKAGES]), [
    ...DEFAULT_PACKAGES,
  ]);
  const packages = rawPackages.filter(isSuitePackageKey);

  // A whitespace-only namespace passes a plain falsy check but is accepted
  // verbatim by both consumers (`loadConfig` and `mergeProfile` only reject
  // `""`), so every request would target a nonexistent namespace.
  const rawNamespace = toSettingString(config.get<unknown>("namespace", DEFAULT_NAMESPACE), "");

  return {
    servers: toStringArray(config.get<unknown>("servers", []), []),
    packages,
    namespace: rawNamespace.trim() || DEFAULT_NAMESPACE,
    combineProfiles: config.get<boolean>("combineProfiles", false) === true,
    governance: toSettingString(config.get<unknown>("governance", ""), ""),
    governancePreset: toSettingString(config.get<unknown>("governancePreset", ""), ""),
    auditLog: toSettingString(config.get<unknown>("auditLog", ""), ""),
    auditLogMaxMb: toSettingString(config.get<unknown>("auditLogMaxMb", ""), ""),
    auditLogParams: toSettingString(config.get<unknown>("auditLogParams", ""), ""),
    toolsPreset: toSettingString(config.get<unknown>("toolsPreset", ""), ""),
    toolsDisable: toSettingString(config.get<unknown>("toolsDisable", ""), ""),
    toolsEnable: toSettingString(config.get<unknown>("toolsEnable", ""), ""),
  };
}
