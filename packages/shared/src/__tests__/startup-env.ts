/**
 * The environment variables the suite's non-test source reads, and the one
 * scrub that keeps a developer's shell out of the default test runs.
 *
 * This file is test-only support: it lives under `__tests__/` (excluded from
 * the published package by `files: ["dist", "!dist/**\/__tests__"]`) and has
 * no `vitest` import, so the cross-package roster guard in `@iris-mcp/all`
 * can load its built form.
 *
 * Exhaustive as of 2026-10-16. Source: every `env.NAME` and `env["NAME"]`
 * read in the non-test `src/**\/*.ts` of `packages/shared` and the five server
 * packages (the servers read none directly; handlers never read the
 * environment). `startup-env-roster.test.ts` (in `@iris-mcp/all`) fails, naming
 * the variable, when a source reads a name that is in none of these lists, or
 * when a listed name is read nowhere. A story that adds an operator variable
 * adds it to {@link STARTUP_ENV_VARS} in the same change.
 */

/** The connection variables. They are the live gates' target, so the harness defaults them per test and the setup scrub leaves them alone. */
export const CONNECTION_ENV_VARS = [
  "IRIS_HOST",
  "IRIS_PORT",
  "IRIS_USERNAME",
  "IRIS_PASSWORD",
  "IRIS_NAMESPACE",
  "IRIS_HTTPS",
] as const;

/** Platform variables read only by Server Manager discovery, which is inert while `IRIS_SERVER_MANAGER` is unset. Never scrubbed. */
export const PLATFORM_ENV_VARS = ["HOME", "APPDATA", "XDG_CONFIG_HOME"] as const;

/** Every operator variable a server reads at startup or call time. All of them are scrubbed. */
export const STARTUP_ENV_VARS = [
  "IRIS_PROFILES",
  "IRIS_TIMEOUT",
  "IRIS_ACCEPT_LANGUAGE",
  "IRIS_GOVERNANCE",
  "IRIS_GOVERNANCE_FILE",
  "IRIS_GOVERNANCE_PRESET",
  "IRIS_TOOLS_PRESET",
  "IRIS_TOOLS_DISABLE",
  "IRIS_TOOLS_ENABLE",
  "IRIS_SERVER_MANAGER",
  "IRIS_SM_SERVERS",
  "IRIS_SM_SETTINGS_PATHS",
  "IRIS_SM_WORKSPACE",
  "IRIS_CREDENTIAL_HELPER",
  "IRIS_SQL_MAX_ROWS",
  "IRIS_SQL_TIMEOUT",
  "IRIS_SQL_READ_ONLY",
  "IRIS_SQL_MAX_ROWS_AFFECTED",
  "IRIS_TEST_TIMEOUT",
  "IRIS_AUDIT_LOG",
  "IRIS_AUDIT_LOG_MAX_MB",
  "IRIS_AUDIT_LOG_PARAMS",
  "LOG_LEVEL",
  "MCP_TRANSPORT",
] as const;

/**
 * Delete every {@link STARTUP_ENV_VARS} entry from `process.env` and return a
 * function that puts each one back exactly as it was (an absent variable
 * stays absent).
 */
export function scrubStartupEnv(): () => void {
  const saved = new Map<string, string | undefined>();
  for (const name of STARTUP_ENV_VARS) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
