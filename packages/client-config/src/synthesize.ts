/**
 * `@iris-mcp/client-config` — canonical entry synthesis (Epic 33, Story
 * 33.1; AC 33.1.5, spec §3.3).
 *
 * Renders a `CanonicalEntry` for one iris-mcp server in one of four env
 * modes, per the adapter's env-expansion capability:
 *
 * 1. `server-manager`  — `IRIS_SERVER_MANAGER=auto` + `IRIS_SM_SERVERS`;
 *    no secrets (connections come from Server Manager profiles).
 * 2. `env-reference`   — `${VAR}` for Claude-convention clients (and for
 *    `shell`-convention clients like Gemini CLI, whose documented `$VAR`/
 *    `${VAR}` substitution accepts the braced form), `${env:VAR}` for VS Code
 *    with the password UPGRADED to native `inputs`
 *    (`${input:iris-password}` + a `promptString`/`password:true` descriptor
 *    the consumer merges into the file's top-level `inputs` array);
 *    no-expansion clients (`none`) get literals for the non-secret
 *    fields and NO password — plus a doctor note instructing OS-env
 *    injection (the 33.2 `doctor` command verifies resolvability).
 * 3. `governance-file` — `IRIS_GOVERNANCE_FILE=<path>`; no secrets.
 * 4. `explicit`        — literal values; a literal `IRIS_PASSWORD` is only
 *    rendered after a typed confirmation (the exact entry name) and the
 *    result is marked `contains-secret`.
 *
 * Epics 31/32 ARE shipped in this repo, so `server-manager`/`governance-
 * file` modes are NOT hidden here. Mode hiding when those features are
 * absent belongs to the 33.2 CLI host probe (documented seam).
 *
 * Non-explicit modes NEVER render a literal password (mechanically tested:
 * no `IRIS_PASSWORD` literal value in any non-explicit render).
 */

import type { CanonicalEntry, CanonicalServerName, ClientAdapter } from "./types.js";

/** Canonical server → npm package (the `npx -y <pkg>` launch target).
 * No `iris-mcp-all` row — the aggregate is unmanaged (see CANONICAL_SERVERS). */
export const PKG_BY_SERVER: Record<CanonicalServerName, string> = {
  "iris-dev-mcp": "@iris-mcp/dev",
  "iris-admin-mcp": "@iris-mcp/admin",
  "iris-ops-mcp": "@iris-mcp/ops",
  "iris-interop-mcp": "@iris-mcp/interop",
  "iris-data-mcp": "@iris-mcp/data",
};

export type EnvMode = "server-manager" | "env-reference" | "governance-file" | "explicit";

/** Optional connection/profile inputs for synthesis. */
export interface SynthesisProfile {
  host?: string;
  port?: number;
  username?: string;
  namespace?: string;
  https?: boolean;
  /** explicit mode only: the literal password. */
  password?: string;
  /** server-manager mode: the `IRIS_SM_SERVERS` allow-list value
   * (comma-separated Server Manager profile names; default "default"). */
  serverManagerNames?: string;
  /** governance-file mode: the `IRIS_GOVERNANCE_FILE` path (required). */
  governanceFile?: string;
}

export interface SynthesisOptions {
  adapter: ClientAdapter;
  profile?: SynthesisProfile;
  /**
   * explicit mode: typed confirmation string — must EXACTLY equal the entry
   * name before any literal `IRIS_PASSWORD` is rendered (AC 33.1.5).
   */
  confirm?: string;
}

/** One VS Code native `inputs` descriptor (spec §3.3's env-reference upgrade). */
export interface VscodeInput {
  id: string;
  type: "promptString";
  description: string;
  password: boolean;
}

/** The id of the VS Code promptString input carrying the IRIS password. */
export const VSCODE_PASSWORD_INPUT_ID = "iris-password";

export type SynthesisResult =
  | {
      ok: true;
      entry: CanonicalEntry;
      /** True only for `explicit` mode (a literal IRIS_PASSWORD is present). */
      containsSecret: boolean;
      /** VS Code `env-reference`: the top-level `inputs` section addition the
       * consumer merges into mcp.json alongside the entry. */
      inputs?: VscodeInput[];
      /** env-reference on a no-expansion client: OS-env injection guidance
       * (the 33.2 `doctor` command verifies resolvability). */
      doctorNote?: string;
      notes: string[];
    }
  | { ok: false; reason: string };

/** The connection env keys and their profile sources. */
const CONNECTION_VARS = ["IRIS_HOST", "IRIS_PORT", "IRIS_USERNAME", "IRIS_NAMESPACE", "IRIS_HTTPS"] as const;

function profileLiteral(profile: SynthesisProfile, key: (typeof CONNECTION_VARS)[number]): string | undefined {
  switch (key) {
    case "IRIS_HOST":
      return profile.host;
    case "IRIS_PORT":
      return profile.port !== undefined ? String(profile.port) : undefined;
    case "IRIS_USERNAME":
      return profile.username;
    case "IRIS_NAMESPACE":
      return profile.namespace;
    case "IRIS_HTTPS":
      return profile.https !== undefined ? String(profile.https) : undefined;
  }
}

/** The env-var reference form for one adapter's expansion convention. */
function referenceForm(adapter: ClientAdapter, variable: string): string {
  // "vscode" uses ${env:VAR}; "claude" and "shell" use ${VAR} (shell also
  // accepts $VAR, but the braced form is valid for both claude and shell
  // conventions and keeps one renderer).
  return adapter.envExpansion === "vscode" ? `\${env:${variable}}` : `\${${variable}}`;
}

function baseEntry(server: CanonicalServerName): CanonicalEntry {
  return { name: server, command: "npx", args: ["-y", PKG_BY_SERVER[server]] };
}

/**
 * Synthesize one canonical entry. Never throws — every refusal is a typed
 * `{ok:false, reason}` (reasons name the mode and missing input, never a
 * submitted secret value).
 */
export function synthesizeEntry(
  server: CanonicalServerName,
  mode: EnvMode,
  options: SynthesisOptions,
): SynthesisResult {
  const { adapter, profile } = options;
  const entry = baseEntry(server);
  const notes: string[] = [];

  switch (mode) {
    case "server-manager": {
      entry.env = {
        IRIS_SERVER_MANAGER: "auto",
        IRIS_SM_SERVERS: profile?.serverManagerNames ?? "default",
      };
      notes.push("connections resolve from Server Manager profiles; no secrets are written");
      return { ok: true, entry, containsSecret: false, notes };
    }

    case "governance-file": {
      if (profile?.governanceFile === undefined || profile.governanceFile === "") {
        return { ok: false, reason: "governance-file mode requires profile.governanceFile (the IRIS_GOVERNANCE_FILE path)" };
      }
      const env: Record<string, string> = {};
      for (const key of CONNECTION_VARS) {
        const literal = profileLiteral(profile, key);
        if (literal !== undefined) env[key] = literal;
      }
      env.IRIS_GOVERNANCE_FILE = profile.governanceFile;
      entry.env = env;
      notes.push("governance resolves from the shared governance file; no secrets are written");
      return { ok: true, entry, containsSecret: false, notes };
    }

    case "env-reference": {
      const env: Record<string, string> = {};
      if (adapter.envExpansion === "none") {
        // No expansion: non-secret literals only, password via the OS env.
        for (const key of CONNECTION_VARS) {
          const literal = profile ? profileLiteral(profile, key) : undefined;
          if (literal !== undefined) env[key] = literal;
        }
        entry.env = env;
        const missing = profile ? "IRIS_PASSWORD" : CONNECTION_VARS.join(", ") + ", IRIS_PASSWORD";
        return {
          ok: true,
          entry,
          containsSecret: false,
          doctorNote:
            `${adapter.displayName} does not expand env vars in MCP config; provide ${missing} ` +
            `via the OS environment (the iris-mcp-clients doctor command verifies resolvability)`,
          notes,
        };
      }
      for (const key of CONNECTION_VARS) {
        const literal = profile ? profileLiteral(profile, key) : undefined;
        env[key] = literal ?? referenceForm(adapter, key);
      }
      if (adapter.envExpansion === "vscode") {
        // Native inputs upgrade (spec §3.3): the password is prompted, never stored.
        env.IRIS_PASSWORD = `\${input:${VSCODE_PASSWORD_INPUT_ID}}`;
        entry.env = env;
        return {
          ok: true,
          entry,
          containsSecret: false,
          inputs: [
            {
              id: VSCODE_PASSWORD_INPUT_ID,
              type: "promptString",
              description: `IRIS password for ${server}`,
              password: true,
            },
          ],
          notes,
        };
      }
      env.IRIS_PASSWORD = referenceForm(adapter, "IRIS_PASSWORD");
      entry.env = env;
      return { ok: true, entry, containsSecret: false, notes };
    }

    case "explicit": {
      if (profile?.password === undefined || profile.password === "") {
        return { ok: false, reason: "explicit mode requires profile.password (a literal IRIS_PASSWORD)" };
      }
      if (options.confirm !== server) {
        return {
          ok: false,
          reason:
            `explicit mode writes a literal IRIS_PASSWORD; pass confirm exactly equal to the entry name ` +
            `("${server}") to proceed`,
        };
      }
      const env: Record<string, string> = {};
      for (const key of CONNECTION_VARS) {
        const literal = profileLiteral(profile, key);
        if (literal !== undefined) env[key] = literal;
      }
      env.IRIS_PASSWORD = profile.password;
      entry.env = env;
      notes.push("the entry carries a literal password and is marked contains-secret in state.json");
      return { ok: true, entry, containsSecret: true, notes };
    }
  }
}
