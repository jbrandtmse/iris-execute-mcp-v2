/**
 * Plans which MCP server definitions to register from extension settings plus
 * the Server Manager server roster (Task 1/4). Pure — no `vscode` dependency.
 */
import type { LauncherSettings, SuitePackageKey } from "./types.js";

/** npm package name for each suite package key (Task 1 Project Structure Notes). */
export const PACKAGE_NPM_NAME: Record<SuitePackageKey, string> = {
  admin: "@iris-mcp/admin",
  data: "@iris-mcp/data",
  dev: "@iris-mcp/dev",
  interop: "@iris-mcp/interop",
  ops: "@iris-mcp/ops",
};

/** Human-readable label prefix for each suite package key. */
export const PACKAGE_LABEL: Record<SuitePackageKey, string> = {
  admin: "IRIS Admin Tools",
  data: "IRIS Data Tools",
  dev: "IRIS Dev Tools",
  interop: "IRIS Interop Tools",
  ops: "IRIS Ops Tools",
};

/**
 * Directory name under a monorepo checkout's `packages/` for each suite
 * package key (Story 31.6, AC 31.6.2) — used ONLY for
 * `irisMcpLauncher.developmentRepoPath` (local `node <path>/dist/index.js`
 * spawn), never for the published `npx -y @iris-mcp/<pkg>` path above.
 *
 * **Deliberately an EXPLICIT map, never derived from {@link PACKAGE_NPM_NAME}
 * or `SuitePackageKey`.** All five surviving keys DO happen to follow the
 * `iris-<key>-mcp` pattern today — which is exactly what makes a derivation
 * rule tempting and dangerous. The counterexample is recent, not
 * hypothetical: the `all` meta-package's directory is `iris-mcp-all`, NOT the
 * `iris-all-mcp` that rule would have produced, and it was removed in this
 * same story (AC 31.6.5) only because it never had a `dist/index.js` to
 * target. A transformation rule here would look correct, pass any test
 * written against that same rule, and — the moment the next package breaks
 * the pattern, as one already has — silently produce a directory that does
 * not exist. Verified against the real `packages/` directory listing on disk
 * 2026-07-26 (story Dev Notes); `definitions.test.ts` cross-checks every
 * value here against that listing mechanically (Rule #51), pairing each key
 * with its directory's own `package.json` `name` rather than re-deriving it.
 */
export const PACKAGE_DIR_NAME: Record<SuitePackageKey, string> = {
  admin: "iris-admin-mcp",
  data: "iris-data-mcp",
  dev: "iris-dev-mcp",
  interop: "iris-interop-mcp",
  ops: "iris-ops-mcp",
};

/** One planned MCP server definition: which package it spawns and which Server Manager server(s) it covers. */
export interface DefinitionPlan {
  /** Unique across the whole plan; doubles as the definition's `label` (the only field VS Code round-trips through resolve). */
  label: string;
  packageKey: SuitePackageKey;
  /** Exactly one entry unless `combineProfiles` is on, in which case every selected server. */
  serverNames: string[];
}

/**
 * Plan the definitions to register.
 *
 * `settings.servers` (if non-empty) is intersected with `availableServerNames`
 * — a configured name Server Manager no longer reports is silently dropped
 * (it simply cannot be resolved; the extension has no error surface to report
 * it against until `provideMcpServerDefinitions` runs again).
 *
 * `combineProfiles` false (default): one definition per (package, server) pair
 * — the cross product — each single-profile. `combineProfiles` true: one
 * definition per package, covering every selected server via the multi-profile
 * `IRIS_PROFILES` path.
 */
export function planDefinitions(
  settings: LauncherSettings,
  availableServerNames: string[],
): DefinitionPlan[] {
  // De-duplicate both axes. Neither `irisMcpLauncher.servers` nor
  // `.packages` is uniqueness-enforced by VS Code beyond the JSON schema's
  // `uniqueItems` hint (which the settings editor surfaces as a warning but
  // does not reject), so a hand-edited settings.json can repeat an entry. A
  // duplicate would otherwise produce two plans with the SAME label — VS Code
  // receives two indistinguishable definitions while the provider's
  // label->plan map silently keeps only the last — and, under
  // `combineProfiles`, a redundant credential prompt for the same server.
  const uniqueSelected =
    settings.servers.length > 0
      ? settings.servers.filter((name) => availableServerNames.includes(name))
      : availableServerNames;
  const selectedServers = [...new Set(uniqueSelected)];
  const selectedPackages = [...new Set(settings.packages)];

  if (selectedServers.length === 0 || selectedPackages.length === 0) {
    return [];
  }

  const plans: DefinitionPlan[] = [];

  for (const packageKey of selectedPackages) {
    if (settings.combineProfiles) {
      plans.push({
        label: `${PACKAGE_LABEL[packageKey]} (${selectedServers.join(", ")})`,
        packageKey,
        serverNames: [...selectedServers],
      });
    } else {
      for (const serverName of selectedServers) {
        plans.push({
          label: `${PACKAGE_LABEL[packageKey]} — ${serverName}`,
          packageKey,
          serverNames: [serverName],
        });
      }
    }
  }

  return plans;
}
