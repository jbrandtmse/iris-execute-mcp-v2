/**
 * `iris-mcp-governance` — scriptable governance-FILE management CLI
 * (Epic 32, Story 32.1; binding spec F2-D2).
 *
 * Validates, inspects, and edits the JSON policy file that
 * `IRIS_GOVERNANCE_FILE` points the five servers at (Story 32.0), using the
 * SAME engine the servers enforce with: every parse/validation goes through
 * {@link loadGovernanceFile} (so `validate` prints the exact error text a
 * server would fail startup with), and the `effective`/`diff` renders compose
 * the shared {@link effective}/{@link configSource}/{@link defaultSeed}
 * cascade functions directly — NOTHING about the cascade is reimplemented
 * here (single-sourcing is the point of this CLI; a reimplemented cascade
 * would drift from the servers the first time the engine changes).
 *
 * **Command families.**
 * - File-editing: `get` / `set` / `unset` read and write the FILE's explicit
 *   layers (`global`, or `profiles.<name>` with `--profile`). `get` is
 *   deliberately the file's OWN value, not the cascade — the cascade view is
 *   `effective`.
 * - Analysis: `validate` (fail-fast parity with server startup), `effective`
 *   (the full 6-layer cascade for the CLI's own environment + the resolved
 *   file), `diff` (every file-layer entry compared against the default seed),
 *   `universe` (Story 32.2 — the FULL governed-key universe render: baseline ∪
 *   the five server packages' registered keys derived from built dist ∪ the
 *   framework discovery tool, with the REAL mutates/default-enabled
 *   classifications — the render `iris_server_profiles` computes on a running
 *   server over its own registered subset).
 * - `preset` is guidance-only: the preset is sourced EXCLUSIVELY from the
 *   `IRIS_GOVERNANCE_PRESET` environment variable by the servers, so writing
 *   it into the file would be inert-and-confusing. The command prints the
 *   env-level wiring and writes NOTHING (recorded decision, Story 32.1).
 *
 * **Default file resolution (architecture decision J1):** `--file <path>`
 * wins; otherwise `IRIS_GOVERNANCE_FILE` from the environment. The CLI NEVER
 * discovers or searches for a file — explicit path only, mirroring the
 * server-side contract. Stated in `--help`.
 *
 * **Write discipline (AC 32.1.2).** `set`/`unset` write atomically — temp
 * file in the SAME directory (rename is only atomic same-volume) +
 * `fs.renameSync`, with the temp removed in `finally` on every path (no
 * stray `.tmp`, the CR 10.2 lesson) — re-`validate` the written file with
 * the real loader, and roll the original bytes back on failure. Key order is
 * preserved where feasible: existing keys keep their position, new keys
 * append (JSON round-trips insertion order for own string keys; the loader's
 * null-prototype layers preserve it too). Reserved keys (`__proto__` etc.)
 * are rejected BEFORE any mutation, and every write goes through
 * `Object.defineProperty` — never `obj[key] =` with an arbitrary key
 * (mirroring governance.ts's own discipline).
 *
 * **Post-foundation-key caveat.** The full governance-key universe is
 * baseline ∪ each server's registered tool keys; a standalone CLI in
 * `@iris-mcp/shared` cannot enumerate the registered half (importing a
 * server package would be a circular dependency, Rule #45). So:
 * - `set` WARNS (stderr, non-fatal) when the key is not in the frozen
 *   baseline — post-foundation keys (e.g. `iris_env_promote:execute`) are
 *   legitimate and still written, but a typo gets a signal (recorded
 *   decision: warn-not-reject, because rejecting would block real keys the
 *   CLI cannot see).
 * - `effective`/`diff` render over baseline ∪ keys mentioned in any config
 *   layer. A post-foundation key mentioned NOWHERE renders with the
 *   read-default seed (`true`), which can differ from a real server's
 *   write-default — the caveat is stated in `--help`, the text/JSON output
 *   `note`, and the READMEs. `iris_server_profiles` on a running server is
 *   the authoritative full-universe render.
 *
 * This module exports {@link runCli} (pure — argv/deps in, exit code out) so
 * it can be unit-tested with injected streams/env (filesystem operations use
 * real temp files in tests, matching `governance-file.test.ts`'s hermetic
 * style). The executable entry point is the sibling `governance-cli.ts`
 * (shebang + `process.exitCode` wiring), mirroring `credentials-cli.ts`.
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  loadGovernanceFile,
  parseGovernanceFileText,
  parseGovernanceConfig,
  parseGovernancePreset,
  effective,
  configSource,
  defaultSeed,
  buildMutatesLookup,
  buildDefaultEnabledWrites,
  getEffectivePolicy,
  getEffectiveConfigSources,
  RESERVED_KEYS,
  type GovernanceConfig,
  type GovernanceConfigSource,
  type GovernanceLayer,
  type MutationClass,
} from "../governance.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import { BASELINE_ACTION_CLASSIFICATIONS } from "../baseline-classifications.js";
import { DEFAULT_PROFILE_NAME } from "../profiles.js";
import { deriveKeysForTool, SERVER_PACKAGES } from "../governance-baseline-derivation.js";
import { SERVER_DISCOVERY_TOOL_NAME, serverDiscoveryTool } from "../server-discovery.js";
import type { ToolDefinition } from "../tool-types.js";

// ════════════════════════════════════════════════════════════════════
// CLI dependency injection — production defaults + test seams.
// ════════════════════════════════════════════════════════════════════

/** Minimal writable-stream shape the CLI writes output through. */
export interface CliOutput {
  write(chunk: string): void;
}

export interface CliDeps {
  env?: Record<string, string | undefined>;
  stdout?: CliOutput;
  stderr?: CliOutput;
  /**
   * `universe` only: how the five server packages' built tool surfaces are
   * loaded. Production callers omit this (the real dist loader); tests inject
   * a fake to exercise the duplicate-key and derivation guards without
   * fabricating on-disk dist trees.
   */
  loadPackageTools?: PackageToolsLoader;
}

/** One server package's built tool surface, as loaded by {@link PackageToolsLoader}. */
export interface LoadedPackage {
  /** The package label from `SERVER_PACKAGES` (the monorepo directory name). */
  pkg: string;
  /** The package's raw built-dist tool definitions. */
  tools: ToolDefinition[];
}

/**
 * Loads every server package's `dist/tools/index.js` from a container
 * directory (a monorepo `packages/` dir, or an npm scope dir such as
 * `node_modules/@iris-mcp`). Injectable for tests (Story 32.2).
 */
export type PackageToolsLoader = (containerDir: string) => Promise<LoadedPackage[]>;

interface ResolvedDeps {
  env: Record<string, string | undefined>;
  stdout: CliOutput;
  stderr: CliOutput;
  loadPackageTools: PackageToolsLoader;
}

function resolveDeps(deps: CliDeps): ResolvedDeps {
  return {
    env: deps.env ?? process.env,
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
    loadPackageTools: deps.loadPackageTools ?? defaultLoadPackageTools,
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ════════════════════════════════════════════════════════════════════
// argv parsing — boolean flags + valued options, mirroring the
// credentials CLI's no-framework manual style (`--` terminator included).
// ════════════════════════════════════════════════════════════════════

interface ParsedArgs {
  positional: string[];
  flags: Set<string>;
  options: Map<string, string>;
  error?: string;
}

/**
 * Minimal manual argv parser. `--` is the conventional end-of-options
 * terminator: everything after it is positional, so a governance key that
 * begins with `-` remains addressable. Valued options (`--file`, `--profile`)
 * take the NEXT token verbatim as their value (even one starting with `-` —
 * a file path may legitimately begin with a dash).
 */
function parseArgs(
  args: string[],
  allowedFlags: readonly string[],
  allowedOptions: readonly string[],
): ParsedArgs {
  const flagSet = new Set(allowedFlags);
  const optionSet = new Set(allowedOptions);
  const positional: string[] = [];
  const flags = new Set<string>();
  const options = new Map<string, string>();
  let optionsEnded = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
    } else if (!optionsEnded && arg.startsWith("-")) {
      if (flagSet.has(arg)) {
        flags.add(arg);
      } else if (optionSet.has(arg)) {
        const value = args[i + 1];
        if (value === undefined) {
          return { positional, flags, options, error: `Option "${arg}" requires a value.` };
        }
        options.set(arg, value);
        i++;
      } else {
        return { positional, flags, options, error: `Unknown option "${arg}".` };
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags, options };
}

// ════════════════════════════════════════════════════════════════════
// Shared command helpers.
// ════════════════════════════════════════════════════════════════════

/**
 * Resolve the governance file path for one invocation (J1: explicit path
 * only, never discovered): `--file` wins over `IRIS_GOVERNANCE_FILE`; an
 * empty-string env value is treated as unset (mirroring the loader).
 * Returns `undefined` when neither source names a path.
 */
function resolveFilePath(parsed: ParsedArgs, env: Record<string, string | undefined>): string | undefined {
  const fromFlag = parsed.options.get("--file");
  // An empty-string value is treated as unset from EITHER source (mirroring
  // the loader) — otherwise `--file ""` would fall through to the loader's
  // own empty-means-unset rule and "validate" would report a phantom-valid
  // empty path instead of the usage error.
  if (fromFlag !== undefined && fromFlag !== "") return fromFlag;
  const fromEnv = env.IRIS_GOVERNANCE_FILE;
  return fromEnv === undefined || fromEnv === "" ? undefined : fromEnv;
}

/**
 * Parse a resolved file through the REAL loader ({@link loadGovernanceFile})
 * so every consumer — CLI and all five servers — validates identically and
 * the CLI's error text is the server's exact startup-failure text.
 */
function loadFileOrThrow(file: string): GovernanceConfig {
  // The loader reads the path from the env map; passing a single-entry map
  // keeps the call single-sourced (no duplicated read/parse logic here).
  return loadGovernanceFile({ IRIS_GOVERNANCE_FILE: file }) ?? {};
}

/** Exit-2 usage error for a command that cannot resolve a governance file. */
function noFileError(command: string, deps: ResolvedDeps, usage: string): number {
  deps.stderr.write(
    `Error: "${command}" needs a governance file: pass --file <path> or set IRIS_GOVERNANCE_FILE.\n\nUsage: ${usage}\n`,
  );
  return 2;
}

/**
 * Validate a governance key or profile name for WRITE commands: non-empty
 * and not a reserved prototype-chain key (the SAME rule the parser enforces
 * on file contents — a CLI that wrote `__proto__` would create a file the
 * servers then refuse to start with). Returns the error detail, or
 * `undefined` when valid.
 */
function keyNameError(what: string, name: string): string | undefined {
  if (name === "") return `${what} must be a non-empty string.`;
  if (RESERVED_KEYS.has(name)) {
    return `"${name}" is a reserved key and cannot be used as ${what === "a profile name" ? "a profile name" : "a governance key"}.`;
  }
  return undefined;
}

/** Read `key` from a parsed layer as an OWN boolean only (mirrors the cascade's ownBool discipline). */
function ownFileValue(layer: GovernanceLayer | undefined, key: string): boolean | undefined {
  if (layer === undefined) return undefined;
  if (!Object.prototype.hasOwnProperty.call(layer, key)) return undefined;
  const value = (layer as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

/** Resolve the file layer a `--profile`-scoped command addresses. */
function layerFor(config: GovernanceConfig, profile: string | undefined): GovernanceLayer | undefined {
  if (profile === undefined) return config.global;
  if (config.profiles === undefined) return undefined;
  if (!Object.prototype.hasOwnProperty.call(config.profiles, profile)) return undefined;
  return config.profiles[profile];
}

function layerLabel(profile: string | undefined): string {
  return profile === undefined ? "global" : `profile "${profile}"`;
}

/**
 * Write `content` to `path` atomically: temp file in the SAME directory
 * (rename is only atomic same-volume) + `fs.renameSync`, temp removed in
 * `finally` on EVERY path — success, failure, or throw (no stray `.tmp`,
 * the CR 10.2 `.manifest.json.tmp` lesson).
 */
function writeFileAtomic(path: string, content: string): void {
  const temp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    writeFileSync(temp, content, "utf8");
    renameSync(temp, path);
  } finally {
    // Idempotent cleanup: after a successful rename the temp no longer
    // exists; after a failed write/rename it must not be left behind.
    if (existsSync(temp)) rmSync(temp, { force: true });
  }
}

/**
 * 32-1-R6 (Story 32.4): when `path` is a SYMLINK, return the link's real
 * target so the temp+rename lands NEXT TO THE TARGET (rename is only atomic
 * same-volume) and the link itself survives — a naive temp+rename over the
 * LINK path would replace the symlink with a regular file, silently
 * severing a nix/etckeeper-style config-managed link on the first
 * `set`/`unset`. A non-symlink (or a path that cannot be lstat'd, e.g. one
 * about to be created) returns unchanged. The realpath is only taken when
 * the path IS a link — an unconditional realpath would rewrite ordinary
 * paths on Windows (extended-length `\\?\` prefixes).
 *
 * BROKEN-link disposition (32.4 review, recorded): `realpathSync` throws on
 * a link whose target does not exist, so a broken symlink falls through to
 * the `return path` case and the temp+rename REPLACES THE LINK with a
 * regular file at the link's own path — the pre-Story-32.4 behavior for
 * every path, kept deliberately: the alternative (readlink + write through
 * to a moved-away target) silently recreates a file somewhere the operator
 * abandoned, which is the bigger surprise, and a broken link has no working
 * indirection left to preserve. Rollback stays consistent with that choice:
 * the create-case `rmSync(writeTarget)` removes exactly the file the write
 * created (at the link's path) — rename never writes THROUGH a link, so no
 * target can leak.
 */
function resolveWriteTarget(path: string): string {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      return realpathSync(path);
    }
  } catch {
    // Not present / unreadable — write the path itself (the create case).
  }
  return path;
}

/**
 * Atomically replace `path` with `content`, then re-validate the WRITTEN
 * file with the real loader; on validation failure roll the original bytes
 * back (or remove the file when it did not pre-exist) and rethrow. Exported
 * for the rollback-contract unit tests; `validate` defaults to the
 * production loader-based check and is the ONLY injectable point (the
 * rollback contract is what the tests pin — a separate round-trip test
 * proves the production validator passes on CLI-serialized content).
 *
 * @returns The loader-validated config of the file just written.
 */
export function writeGovernanceFileAtomic(
  path: string,
  content: string,
  preexisting: string | undefined,
  validate: (path: string) => GovernanceConfig = loadFileOrThrow,
): GovernanceConfig {
  // 32-1-R6: write (and roll back) THROUGH a symlink — the temp+rename must
  // land beside the link's TARGET, never replace the link itself.
  const writeTarget = resolveWriteTarget(path);
  writeFileAtomic(writeTarget, content);
  try {
    return validate(path);
  } catch (e: unknown) {
    // Rollback: restore the pre-write state byte-for-byte. A rollback
    // failure is surfaced with BOTH messages so nothing fails silently.
    try {
      if (preexisting === undefined) {
        rmSync(writeTarget, { force: true });
      } else {
        writeFileAtomic(writeTarget, preexisting);
      }
    } catch (rollbackError: unknown) {
      throw new Error(
        `${errorMessage(e)} — and the rollback to the pre-write content ALSO failed: ${errorMessage(rollbackError)}`,
      );
    }
    throw e;
  }
}

/**
 * Serialize a parsed config for writing: 2-space JSON + trailing newline.
 * Key order is whatever the object carries — `JSON.parse`/`Object.entries`
 * round-trip insertion order for own string keys, and every mutation below
 * goes through `Object.defineProperty` (existing keys keep position, new
 * keys append; never `obj[key] =` with an arbitrary key — the
 * `__proto__`-safe discipline mirroring governance.ts).
 */
function serializeConfig(config: GovernanceConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * 32-1-R3 (Story 32.4): serialize the mutated config WITHOUT dropping
 * unknown top-level keys. `parseGovernanceRoot` reads only `global` and
 * `profiles`, so re-serializing the parsed config alone VANISHED any other
 * top-level key on the first write — a `"comment"`/`"version"` annotation
 * (silent data loss by re-serialization) or a typo'd layer name like
 * `"globals"` (which also never took effect). `rawRoot` is the raw JSON
 * root parsed from the SAME pre-image bytes the config was validated from;
 * every key it carries is preserved verbatim at its original position, with
 * the mutated `global`/`profiles` layers written back at THEIR original
 * positions (or appended when the file had no such layer).
 */
function serializeConfigPreservingUnknown(
  config: GovernanceConfig,
  rawRoot: Record<string, unknown>,
): string {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const define = (key: string, value: unknown): void => {
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  };
  const rootKeys = Object.keys(rawRoot);
  for (const key of rootKeys) {
    if (key === "global") {
      if (config.global !== undefined) define(key, config.global);
    } else if (key === "profiles") {
      if (config.profiles !== undefined) define(key, config.profiles);
    } else {
      define(key, rawRoot[key]);
    }
  }
  if (config.global !== undefined && !rootKeys.includes("global")) define("global", config.global);
  if (config.profiles !== undefined && !rootKeys.includes("profiles")) {
    define("profiles", config.profiles);
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * 32-1-R3 (Story 32.4): the recognized top-level layer names, and a
 * layer-SHAPED detector for the typo class a validation CLI exists to catch
 * (`"globals"`, `"profile"`, `"Global"`, …). Unknown keys that are NOT
 * layer-shaped (annotations like `"comment"`/`"version"`) are preserved
 * silently; a layer-shaped one additionally earns a stderr warning because
 * it LOOKS like policy that has no effect.
 */
const LAYER_SHAPED_KEY = /^(globals?|profiles?)$/i;

/** Warn (non-fatal) on unknown top-level keys that look like a misspelled layer name. */
function warnOnLayerShapedUnknownKeys(
  file: string,
  rawRoot: Record<string, unknown>,
  deps: ResolvedDeps,
): void {
  for (const key of Object.keys(rawRoot)) {
    if (key === "global" || key === "profiles") continue;
    if (LAYER_SHAPED_KEY.test(key)) {
      deps.stderr.write(
        `Warning: ${file} has an unrecognized top-level key "${key}" — it has NO effect ` +
          `(the recognized layers are "global" and "profiles"; is it a typo?). The key is ` +
          `preserved as-is on write.\n`,
      );
    }
  }
}

/** Set `key = value` on `layer`, preserving existing key order (defineProperty, never bare assignment). */
function defineLayerValue(layer: GovernanceLayer, key: string, value: boolean): void {
  Object.defineProperty(layer, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * Non-fatal stderr warning when a written key is not in the frozen baseline
 * (recorded decision: WARN, never reject — post-foundation keys like
 * `iris_env_promote:execute` are legitimate but invisible to a standalone
 * CLI; rejecting would block real keys, while silence would hide typos).
 */
function warnIfNotBaseline(key: string, deps: ResolvedDeps): void {
  if (!GOVERNANCE_BASELINE.has(key)) {
    deps.stderr.write(
      `Warning: "${key}" is not a pre-foundation (baseline) governance key. It will take effect only if it ` +
        `names a real post-foundation tool action (e.g. iris_env_promote:execute); check for typos.\n`,
    );
  }
}

/** The post-foundation caveat note, emitted in `effective`/`diff` output. */
const POST_FOUNDATION_NOTE =
  "keys not in the frozen baseline and not mentioned in any config layer render with the read-default seed " +
  "(enabled); a real server may seed a post-foundation write key disabled. iris_server_profiles is the " +
  "authoritative full-universe render.";

// ════════════════════════════════════════════════════════════════════
// Help text.
// ════════════════════════════════════════════════════════════════════

const HELP_TEXT = `iris-mcp-governance — validate, inspect, and edit an IRIS MCP governance policy file

Usage: iris-mcp-governance <command> [options]

The file is the JSON policy the five servers read via IRIS_GOVERNANCE_FILE
({"global": {...}, "profiles": {...}}, booleans only). Every parse and every
cascade render uses the SAME shared engine the servers enforce with — this
CLI reimplements none of it.

Default file resolution (explicit path only — never discovered/searched for):
  --file <path>   wins when present
  otherwise       the IRIS_GOVERNANCE_FILE environment variable

Commands:
  validate [--file <path>] [--json]
      Parse and validate the file with the same loader the servers use at
      startup. Exit 1 (printing the server's exact error text) when invalid.
  get <key> [--profile <name>] [--file <path>] [--json]
      Print the key's explicit value IN THE FILE (true/false/unset) — the
      file's own global layer, or profiles.<name> with --profile. This is
      NOT the cascade; use "effective" for the resolved policy.
  set <key> true|false [--profile <name>] [--file <path>]
      Write the key into the file (creating the file when missing). Atomic
      write (temp + rename in the same directory), existing key order
      preserved, and the written file is re-validated automatically with
      rollback on failure. Reserved keys (__proto__ etc.) are rejected.
  unset <key> [--profile <name>] [--file <path>]
      Remove the key from the file. Exit 1 when the key is not set (mirrors
      the iris-mcp-credentials "delete" not-found convention).
  preset read-only|full
      Print the env-level wiring for IRIS_GOVERNANCE_PRESET. Writes NOTHING:
      the servers source the preset from their process environment only,
      never from a governance file.
  effective [--profile <name>] [--file <path>] [--json]
      Render the SAME cascade the servers compute — env.profile ??
      env.global ?? file.profile ?? file.global ?? presetSeed ?? defaultSeed —
      for the CLI's own environment plus the resolved file, with the per-key
      configSource (env|file|preset|default). Profile defaults to "default".
  diff [--file <path>] [--json]
      Compare every key the file sets against its default-seed value.
  universe [--profile <name>] [--file <path>] [--root <path>] [--json]
      Render the FULL governance-key universe — the frozen baseline ∪ the
      five server packages' registered tool keys (derived from their built
      dist, the same derivation the iris-mcp-all cross-package tests and the
      baseline generator use) ∪ the framework iris_server_profiles tool —
      with the REAL mutates/default-enabled classifications, grouped per
      package, with each key's effective value and configSource. This is the
      render iris_server_profiles computes on a running server over its own
      registered subset (post-foundation write keys seed default-DISABLED
      here, unlike "effective"/"diff", which stay baseline-scoped). The
      packages' built dist must be locatable: --root <path> (a monorepo
      root, or a directory containing the package folders) wins; otherwise
      the CLI auto-detects from its own install location.

Options:
  --file <path>       Governance file path (see resolution order above).
  --profile <name>    Profile layer for get/set/unset/effective/universe.
  --root <path>       Package-dist location for "universe" (see above).
  --json              Machine-readable output on read commands
                      (validate, get, effective, diff, universe).
  -h, --help          Show this help and exit.
  --                  End of options: every later argument is positional.

Exit codes:
  0   success
  1   operational failure (file unreadable/invalid per the server loader,
      a key not set for "unset")
  2   usage or input error (unknown command/option, missing or extra
      argument, invalid key/value, no governance file resolvable)

--json output contract: an OPERATIONAL outcome (exit 0 or 1) on a read command
always writes exactly one JSON object to stdout — on failure it is
{"ok": false, "error": "..."} for "validate" and carries an "error" field for
"get". Usage errors (exit 2) are always plain text on stderr, since the flags
themselves were not understood. Human-readable failures always go to stderr.

Caveat — post-foundation keys: the full governance-key universe is the frozen
baseline plus each server's registered tool keys, which "validate"/"get"/"set"/
"unset"/"effective"/"diff" cannot enumerate (importing a server package would be
a circular dependency). "set" warns (but writes) for non-baseline keys;
"effective"/"diff" render over the baseline plus keys mentioned in any config
layer, so a post-foundation key mentioned nowhere renders with the read-default
seed (enabled) even when a real server would seed it disabled. The "universe"
command closes that gap by deriving the registered half from built dist, and
iris_server_profiles on a running server is the authoritative render.
`;

// ════════════════════════════════════════════════════════════════════
// Subcommands.
// ════════════════════════════════════════════════════════════════════

const VALIDATE_USAGE = "iris-mcp-governance validate [--file <path>] [--json]";

async function cmdValidate(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, ["--json"], ["--file"]);
  if (parsed.error) {
    deps.stderr.write(`Error: ${parsed.error}\n\nUsage: ${VALIDATE_USAGE}\n`);
    return 2;
  }
  if (parsed.positional.length !== 0) {
    deps.stderr.write(`Error: "validate" takes no arguments.\n\nUsage: ${VALIDATE_USAGE}\n`);
    return 2;
  }
  const wantJson = parsed.flags.has("--json");
  const file = resolveFilePath(parsed, deps.env);
  if (file === undefined) return noFileError("validate", deps, VALIDATE_USAGE);

  try {
    const config = loadFileOrThrow(file);
    const globalKeys = config.global === undefined ? 0 : Object.keys(config.global).length;
    const profiles = config.profiles === undefined ? 0 : Object.keys(config.profiles).length;
    if (wantJson) {
      deps.stdout.write(`${JSON.stringify({ ok: true, file, globalKeys, profiles })}\n`);
    } else {
      deps.stdout.write(
        `OK: ${file} is a valid governance file (${globalKeys} global key(s), ${profiles} profile(s)).\n`,
      );
    }
    return 0;
  } catch (e: unknown) {
    const message = errorMessage(e);
    deps.stderr.write(`Error: ${message}\n`);
    if (wantJson) deps.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    return 1;
  }
}

const GET_USAGE = "iris-mcp-governance get <key> [--profile <name>] [--file <path>] [--json]";

async function cmdGet(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, ["--json"], ["--file", "--profile"]);
  if (parsed.error) {
    deps.stderr.write(`Error: ${parsed.error}\n\nUsage: ${GET_USAGE}\n`);
    return 2;
  }
  if (parsed.positional.length !== 1) {
    deps.stderr.write(
      `Error: "get" requires exactly one argument, <key>.\n\nUsage: ${GET_USAGE}\n`,
    );
    return 2;
  }
  const [key] = parsed.positional as [string];
  const keyError = keyNameError("a governance key", key);
  if (keyError !== undefined) {
    deps.stderr.write(`Error: ${keyError}\n\nUsage: ${GET_USAGE}\n`);
    return 2;
  }
  const profile = parsed.options.get("--profile");
  if (profile !== undefined) {
    const profileError = keyNameError("a profile name", profile);
    if (profileError !== undefined) {
      deps.stderr.write(`Error: ${profileError}\n\nUsage: ${GET_USAGE}\n`);
      return 2;
    }
  }
  const wantJson = parsed.flags.has("--json");
  const file = resolveFilePath(parsed, deps.env);
  if (file === undefined) return noFileError("get", deps, GET_USAGE);

  let config: GovernanceConfig;
  try {
    config = loadFileOrThrow(file);
  } catch (e: unknown) {
    const message = errorMessage(e);
    deps.stderr.write(`Error: ${message}\n`);
    if (wantJson) {
      deps.stdout.write(
        `${JSON.stringify({ key, profile: profile ?? null, value: null, error: message })}\n`,
      );
    }
    return 1;
  }

  const value = ownFileValue(layerFor(config, profile), key) ?? null;
  if (wantJson) {
    deps.stdout.write(
      `${JSON.stringify({ key, profile: profile ?? null, value, layer: layerLabel(profile) })}\n`,
    );
  } else if (value === null) {
    deps.stdout.write(`"${key}" is not set in ${file} (${layerLabel(profile)} layer).\n`);
  } else {
    deps.stdout.write(`"${key}" = ${value}  (${file}, ${layerLabel(profile)} layer)\n`);
  }
  return 0;
}

const SET_USAGE = "iris-mcp-governance set <key> true|false [--profile <name>] [--file <path>]";

async function cmdSet(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, [], ["--file", "--profile"]);
  if (parsed.error) {
    deps.stderr.write(`Error: ${parsed.error}\n\nUsage: ${SET_USAGE}\n`);
    return 2;
  }
  if (parsed.positional.length !== 2) {
    deps.stderr.write(
      `Error: "set" requires exactly two arguments, <key> and true|false.\n\nUsage: ${SET_USAGE}\n`,
    );
    return 2;
  }
  const [key, rawValue] = parsed.positional as [string, string];
  const keyError = keyNameError("a governance key", key);
  if (keyError !== undefined) {
    deps.stderr.write(`Error: ${keyError}\n\nUsage: ${SET_USAGE}\n`);
    return 2;
  }
  if (rawValue !== "true" && rawValue !== "false") {
    deps.stderr.write(
      `Error: the value must be exactly "true" or "false". Received: ${JSON.stringify(rawValue)}.\n\nUsage: ${SET_USAGE}\n`,
    );
    return 2;
  }
  const value = rawValue === "true";
  const profile = parsed.options.get("--profile");
  if (profile !== undefined) {
    const profileError = keyNameError("a profile name", profile);
    if (profileError !== undefined) {
      deps.stderr.write(`Error: ${profileError}\n\nUsage: ${SET_USAGE}\n`);
      return 2;
    }
  }
  const file = resolveFilePath(parsed, deps.env);
  if (file === undefined) return noFileError("set", deps, SET_USAGE);

  // Missing file ⇒ `set` CREATES it (the "create file" smoke step of AC
  // 32.1.3); a missing PARENT directory is an operational failure, named.
  let preexisting: string | undefined;
  let config: GovernanceConfig;
  let rawRoot: Record<string, unknown> | undefined;
  if (existsSync(file)) {
    try {
      // 32-1-R7 (Story 32.4): the pre-image is read ONCE and used for BOTH
      // the parse and a potential rollback — two separate reads could
      // observe different content under concurrent modification, restoring
      // bytes the CLI never validated.
      preexisting = readFileSync(file, "utf8");
    } catch {
      // A raw READ failure (e.g. a DIRECTORY as --file → EISDIR) carries no
      // loader framing; re-run it through the real loader so the CLI prints
      // the server's exact read-error text (naming IRIS_GOVERNANCE_FILE +
      // path), never a bare OS error.
      try {
        loadGovernanceFile({ IRIS_GOVERNANCE_FILE: file });
      } catch (loaderError: unknown) {
        deps.stderr.write(`Error: ${errorMessage(loaderError)}\n`);
        return 1;
      }
      deps.stderr.write(`Error: could not read ${file}.\n`);
      return 1;
    }
    try {
      // The text-level validator is the SAME engine the servers load with
      // (parseGovernanceFileText is loadGovernanceFile's parse half), so
      // error text stays identical.
      config = parseGovernanceFileText(preexisting, file);
      // Safe: parseGovernanceFileText already proved this text parses to a
      // JSON object root (non-objects fail fast there). 32-1-R3: the raw
      // root feeds unknown-top-level-key preservation on write.
      rawRoot = JSON.parse(preexisting) as Record<string, unknown>;
    } catch (e: unknown) {
      deps.stderr.write(`Error: ${errorMessage(e)}\n`);
      return 1;
    }
  } else {
    const parent = dirname(file);
    if (!existsSync(parent)) {
      deps.stderr.write(
        `Error: cannot create ${file} — the directory ${parent} does not exist.\n`,
      );
      return 1;
    }
    config = {};
  }

  if (rawRoot !== undefined) warnOnLayerShapedUnknownKeys(file, rawRoot, deps);

  // Mutate the loader-parsed config (its null-prototype layers preserve key
  // insertion order): create the addressed layer on demand, then define the
  // key — existing keys keep position, new keys append.
  let layer: GovernanceLayer;
  if (profile === undefined) {
    if (config.global === undefined) {
      config.global = Object.create(null) as GovernanceLayer;
    }
    layer = config.global;
  } else {
    if (config.profiles === undefined) {
      config.profiles = Object.create(null) as Record<string, GovernanceLayer>;
    }
    if (!Object.prototype.hasOwnProperty.call(config.profiles, profile)) {
      Object.defineProperty(config.profiles, profile, {
        value: Object.create(null) as GovernanceLayer,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    layer = config.profiles[profile] as GovernanceLayer;
  }
  defineLayerValue(layer, key, value);

  warnIfNotBaseline(key, deps);

  try {
    const content =
      rawRoot === undefined
        ? serializeConfig(config)
        : serializeConfigPreservingUnknown(config, rawRoot);
    writeGovernanceFileAtomic(file, content, preexisting);
  } catch (e: unknown) {
    deps.stderr.write(`Error: could not write ${file} — ${errorMessage(e)}\n`);
    return 1;
  }

  deps.stdout.write(
    `${preexisting === undefined ? `Created ${file} and set` : "Set"} "${key}" = ${value} (${layerLabel(profile)} layer).\n`,
  );
  return 0;
}

const UNSET_USAGE = "iris-mcp-governance unset <key> [--profile <name>] [--file <path>]";

async function cmdUnset(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, [], ["--file", "--profile"]);
  if (parsed.error) {
    deps.stderr.write(`Error: ${parsed.error}\n\nUsage: ${UNSET_USAGE}\n`);
    return 2;
  }
  if (parsed.positional.length !== 1) {
    deps.stderr.write(
      `Error: "unset" requires exactly one argument, <key>.\n\nUsage: ${UNSET_USAGE}\n`,
    );
    return 2;
  }
  const [key] = parsed.positional as [string];
  const keyError = keyNameError("a governance key", key);
  if (keyError !== undefined) {
    deps.stderr.write(`Error: ${keyError}\n\nUsage: ${UNSET_USAGE}\n`);
    return 2;
  }
  const profile = parsed.options.get("--profile");
  if (profile !== undefined) {
    const profileError = keyNameError("a profile name", profile);
    if (profileError !== undefined) {
      deps.stderr.write(`Error: ${profileError}\n\nUsage: ${UNSET_USAGE}\n`);
      return 2;
    }
  }
  const file = resolveFilePath(parsed, deps.env);
  if (file === undefined) return noFileError("unset", deps, UNSET_USAGE);

  let preexisting: string;
  try {
    preexisting = readFileSync(file, "utf8");
  } catch {
    // A raw READ failure (ENOENT — unset never creates) carries no loader
    // framing; re-run it through the real loader so the CLI prints the
    // server's exact read-error text (naming IRIS_GOVERNANCE_FILE + path).
    try {
      loadGovernanceFile({ IRIS_GOVERNANCE_FILE: file });
    } catch (loaderError: unknown) {
      deps.stderr.write(`Error: ${errorMessage(loaderError)}\n`);
      return 1;
    }
    deps.stderr.write(`Error: could not read ${file}.\n`);
    return 1;
  }
  let config: GovernanceConfig;
  let rawRoot: Record<string, unknown>;
  try {
    // 32-1-R7 (Story 32.4): the pre-image is read ONCE and used for BOTH
    // the parse and a potential rollback (same rationale as `set`). The
    // text-level validator IS the loader's parse half, so an invalid file
    // fails with the server's exact error text.
    config = parseGovernanceFileText(preexisting, file);
    rawRoot = JSON.parse(preexisting) as Record<string, unknown>;
  } catch (e: unknown) {
    deps.stderr.write(`Error: ${errorMessage(e)}\n`);
    return 1;
  }

  warnOnLayerShapedUnknownKeys(file, rawRoot, deps);

  const layer = layerFor(config, profile);
  if (ownFileValue(layer, key) === undefined) {
    deps.stderr.write(
      `"${key}" is not set in ${file} (${layerLabel(profile)} layer) — nothing to unset.\n`,
    );
    return 1;
  }
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete (layer as Record<string, unknown>)[key];

  try {
    writeGovernanceFileAtomic(file, serializeConfigPreservingUnknown(config, rawRoot), preexisting);
  } catch (e: unknown) {
    deps.stderr.write(`Error: could not write ${file} — ${errorMessage(e)}\n`);
    return 1;
  }

  deps.stdout.write(`Unset "${key}" in ${file} (${layerLabel(profile)} layer).\n`);
  return 0;
}

const PRESET_USAGE = "iris-mcp-governance preset read-only|full";

async function cmdPreset(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, [], []);
  if (parsed.error) {
    deps.stderr.write(`Error: ${parsed.error}\n\nUsage: ${PRESET_USAGE}\n`);
    return 2;
  }
  if (parsed.positional.length !== 1) {
    deps.stderr.write(
      `Error: "preset" requires exactly one argument, read-only|full.\n\nUsage: ${PRESET_USAGE}\n`,
    );
    return 2;
  }
  const [preset] = parsed.positional as [string];
  if (preset !== "read-only" && preset !== "full") {
    deps.stderr.write(
      `Error: the preset must be one of: read-only, full. Received: ${JSON.stringify(preset)}.\n\nUsage: ${PRESET_USAGE}\n`,
    );
    return 2;
  }

  // Recorded decision (Story 32.1, AC 32.1.1): the preset is sourced
  // EXCLUSIVELY from IRIS_GOVERNANCE_PRESET by the servers (parseGovernancePreset
  // reads only the env — the file channel has no preset slot in the cascade),
  // so this command prints the env-level wiring and writes NOTHING. A
  // --file-default form was considered and rejected: writing a value the
  // servers never read would be inert-and-confusing.
  deps.stdout.write(
    `Preset "${preset}" is an ENVIRONMENT-level setting (IRIS_GOVERNANCE_PRESET): the servers read it ` +
      `from their process environment only, never from a governance file — this command writes nothing.\n\n` +
      `Wire it into each MCP client's env block, alongside IRIS_GOVERNANCE_FILE:\n` +
      `  "env": { "IRIS_GOVERNANCE_PRESET": "${preset}" }\n\n` +
      `Or set it in the shell before launching a server:\n` +
      `  PowerShell:  $env:IRIS_GOVERNANCE_PRESET = "${preset}"\n` +
      `  bash/zsh:    export IRIS_GOVERNANCE_PRESET=${preset}\n`,
  );
  return 0;
}

const EFFECTIVE_USAGE = "iris-mcp-governance effective [--profile <name>] [--file <path>] [--json]";

/** Collect every key mentioned in any layer of a config (global + all profiles). */
function mentionedKeys(config: GovernanceConfig | undefined, into: Set<string>): void {
  if (config === undefined) return;
  for (const key of Object.keys(config.global ?? {})) into.add(key);
  for (const layer of Object.values(config.profiles ?? {})) {
    for (const key of Object.keys(layer)) into.add(key);
  }
}

async function cmdEffective(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, ["--json"], ["--file", "--profile"]);
  if (parsed.error) {
    deps.stderr.write(`Error: ${parsed.error}\n\nUsage: ${EFFECTIVE_USAGE}\n`);
    return 2;
  }
  if (parsed.positional.length !== 0) {
    deps.stderr.write(`Error: "effective" takes no arguments.\n\nUsage: ${EFFECTIVE_USAGE}\n`);
    return 2;
  }
  const profile = parsed.options.get("--profile") ?? DEFAULT_PROFILE_NAME;
  const profileError = keyNameError("a profile name", profile);
  if (profileError !== undefined) {
    deps.stderr.write(`Error: ${profileError}\n\nUsage: ${EFFECTIVE_USAGE}\n`);
    return 2;
  }
  const wantJson = parsed.flags.has("--json");
  const file = resolveFilePath(parsed, deps.env);

  // The SAME inputs the server computes at startup, read from the CLI's own
  // environment: env channel, preset, and the resolved file channel. Env/preset
  // parse errors surface with the servers' exact fail-fast text.
  let envConfig: GovernanceConfig;
  let preset: ReturnType<typeof parseGovernancePreset>;
  let fileConfig: GovernanceConfig | undefined;
  try {
    envConfig = parseGovernanceConfig(deps.env);
    preset = parseGovernancePreset(deps.env);
    fileConfig = file === undefined ? undefined : loadFileOrThrow(file);
  } catch (e: unknown) {
    const message = errorMessage(e);
    deps.stderr.write(`Error: ${message}\n`);
    if (wantJson) {
      deps.stdout.write(`${JSON.stringify({ profile, error: message })}\n`);
    }
    return 1;
  }

  // Key universe: frozen baseline ∪ keys mentioned in any config layer. The
  // servers ALSO union each registered tool's keys; a standalone CLI cannot
  // (Rule #45) — the post-foundation caveat is carried in the output `note`.
  const keys = new Set<string>(GOVERNANCE_BASELINE);
  mentionedKeys(envConfig, keys);
  mentionedKeys(fileConfig, keys);
  const sortedKeys = [...keys].sort();

  // SINGLE-SOURCED cascade render: the shared effective()/configSource()
  // with an empty mutatesLookup (no registered tools visible) and the real
  // baseline classifications — the identical functions the servers call.
  const emptyLookup = new Map<string, never>();
  const policy: Record<string, boolean> = {};
  const sources: Record<string, GovernanceConfigSource> = {};
  for (const key of sortedKeys) {
    defineLayerValue(
      policy as GovernanceLayer,
      key,
      effective(
        key,
        profile,
        envConfig,
        emptyLookup,
        GOVERNANCE_BASELINE,
        new Set<string>(),
        preset,
        BASELINE_ACTION_CLASSIFICATIONS,
        fileConfig,
      ),
    );
    Object.defineProperty(sources, key, {
      value: configSource(
        key,
        profile,
        envConfig,
        emptyLookup,
        preset,
        BASELINE_ACTION_CLASSIFICATIONS,
        fileConfig,
      ),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  if (wantJson) {
    deps.stdout.write(
      `${JSON.stringify({
        profile,
        file: file ?? null,
        preset: preset ?? null,
        policy,
        configSource: sources,
        note: POST_FOUNDATION_NOTE,
      })}\n`,
    );
  } else {
    deps.stdout.write(
      `Effective governance policy for profile "${profile}"` +
        `${file === undefined ? "" : ` (file: ${file})`}` +
        `${preset === undefined ? "" : ` (preset: ${preset})`}:\n`,
    );
    for (const key of sortedKeys) {
      deps.stdout.write(`  ${key} = ${policy[key]}   (source: ${sources[key]})\n`);
    }
    deps.stdout.write(`Note: ${POST_FOUNDATION_NOTE}\n`);
  }
  return 0;
}

const DIFF_USAGE = "iris-mcp-governance diff [--file <path>] [--json]";

interface DiffEntry {
  layer: string;
  key: string;
  file: boolean;
  default: boolean;
  differs: boolean;
}

async function cmdDiff(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, ["--json"], ["--file"]);
  if (parsed.error) {
    deps.stderr.write(`Error: ${parsed.error}\n\nUsage: ${DIFF_USAGE}\n`);
    return 2;
  }
  if (parsed.positional.length !== 0) {
    deps.stderr.write(`Error: "diff" takes no arguments.\n\nUsage: ${DIFF_USAGE}\n`);
    return 2;
  }
  const wantJson = parsed.flags.has("--json");
  const file = resolveFilePath(parsed, deps.env);
  if (file === undefined) return noFileError("diff", deps, DIFF_USAGE);

  let config: GovernanceConfig;
  try {
    config = loadFileOrThrow(file);
  } catch (e: unknown) {
    const message = errorMessage(e);
    deps.stderr.write(`Error: ${message}\n`);
    if (wantJson) deps.stdout.write(`${JSON.stringify({ file, error: message })}\n`);
    return 1;
  }

  // Every file-layer entry vs the default seed (empty mutatesLookup — the
  // same post-foundation caveat as "effective", carried in the note). The
  // seed is the SHARED defaultSeed, not a local re-derivation.
  const emptyLookup = new Map<string, never>();
  const entries: DiffEntry[] = [];
  const pushEntries = (label: string, layer: GovernanceLayer | undefined): void => {
    for (const [key, value] of Object.entries(layer ?? {})) {
      const seeded = defaultSeed(key, emptyLookup, GOVERNANCE_BASELINE, new Set<string>());
      entries.push({ layer: label, key, file: value, default: seeded, differs: value !== seeded });
    }
  };
  pushEntries("global", config.global);
  for (const [name, layer] of Object.entries(config.profiles ?? {})) {
    pushEntries(`profile "${name}"`, layer);
  }

  if (wantJson) {
    deps.stdout.write(`${JSON.stringify({ file, entries, note: POST_FOUNDATION_NOTE })}\n`);
  } else if (entries.length === 0) {
    deps.stdout.write(`${file} sets no keys — the defaults govern everything.\n`);
  } else {
    deps.stdout.write(`${file} vs the default seed:\n`);
    for (const entry of entries) {
      deps.stdout.write(
        `  ${entry.differs ? "~" : "="} [${entry.layer}] ${entry.key}: file=${entry.file}, default=${entry.default}` +
          `${entry.differs ? "  (differs)" : ""}\n`,
      );
    }
    deps.stdout.write(`Note: ${POST_FOUNDATION_NOTE}\n`);
  }
  return 0;
}

// ════════════════════════════════════════════════════════════════════
// universe — the FULL governed-key universe render (Story 32.2).
//
// `effective`/`diff` render over the frozen baseline ∪ mentioned keys
// because a standalone CLI cannot enumerate each server's registered tool
// keys (importing a server package would be a circular dependency — Rule
// #45). `universe` closes that gap WITHOUT the import: it loads each server
// package's BUILT `dist/tools/index.js` from the filesystem — the exact
// derivation `iris-mcp-all`'s cross-package tests and the baseline
// generator use (SERVER_PACKAGES + deriveKeysForTool over built dist) —
// then renders the SAME cascade with the REAL mutates/default-enabled
// classifications, i.e. the render a running server's iris_server_profiles
// computes over its own registered subset.
// ════════════════════════════════════════════════════════════════════

const UNIVERSE_USAGE =
  "iris-mcp-governance universe [--profile <name>] [--file <path>] [--root <path>] [--json]";

/** The full-universe render note, emitted in `universe` output. */
const UNIVERSE_NOTE =
  "universe renders the FULL governance-key universe (the frozen baseline ∪ the five server packages' " +
  "registered tool keys, derived from their built dist, ∪ the framework iris_server_profiles tool) with the " +
  "REAL mutates/default-enabled classifications — the same render iris_server_profiles computes on a running " +
  "server over its own registered subset. effective/diff stay baseline-scoped (they never touch dist).";

/**
 * Resolve the directory that CONTAINS the server-package folders (a monorepo
 * `packages/` dir, or an npm scope dir like `node_modules/@iris-mcp`).
 *
 * `--root` wins when present: a monorepo ROOT (has a `packages/` subdir) or
 * the container dir itself. Otherwise auto-detect from this module's own
 * file location — `<container>/shared/{src|dist}/cli/governance.{ts,js}` in
 * the monorepo, `<container>/shared/dist/cli/…` under an npm `@iris-mcp`
 * scope dir — both exactly three levels below the container.
 */
function resolveContainerDir(root: string | undefined): string {
  if (root !== undefined && root !== "") {
    const packagesSubdir = join(root, "packages");
    try {
      if (statSync(packagesSubdir).isDirectory()) return packagesSubdir;
    } catch {
      // No packages/ subdir — `root` IS the container dir.
    }
    return root;
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/**
 * Candidate `dist/tools/index.js` paths for one package inside a container
 * dir, most-likely first: the monorepo dir name (`iris-dev-mcp`), then the
 * npm scope layout (`@iris-mcp/dev` → the short name). The short name is
 * derived, never mapped (this derivation can only pick an EXISTING path —
 * the load below fails loudly when neither candidate exists, so a pattern-
 * breaking future package degrades to an actionable error, never a silently
 * wrong target).
 */
function candidateToolEntries(containerDir: string, pkg: string): string[] {
  const entries = [join(containerDir, pkg, "dist", "tools", "index.js")];
  const short = pkg.replace(/^iris-/, "").replace(/-mcp$/, "");
  if (short !== pkg) {
    entries.push(join(containerDir, short, "dist", "tools", "index.js"));
  }
  return entries;
}

/**
 * The production {@link PackageToolsLoader}: load every SERVER_PACKAGES
 * entry's built `dist/tools/index.js` via a direct `file://` import (which
 * bypasses each package's restrictive `exports` map — the same approach as
 * `scripts/lib/tool-catalog.mjs` and the baseline generator). Throws an
 * actionable error naming every probed path when a package's dist cannot be
 * located.
 */
async function defaultLoadPackageTools(containerDir: string): Promise<LoadedPackage[]> {
  const loaded: LoadedPackage[] = [];
  for (const pkg of SERVER_PACKAGES) {
    const candidates = candidateToolEntries(containerDir, pkg);
    const entry = candidates.find((candidate) => existsSync(candidate));
    if (entry === undefined) {
      throw new Error(
        `universe: could not locate built tools for package "${pkg}" under "${containerDir}" — probed:\n` +
          candidates.map((candidate) => `  ${candidate}`).join("\n") +
          `\nRun the CLI from a monorepo checkout (with the packages built), or with every @iris-mcp/* ` +
          `package installed alongside @iris-mcp/shared, or pass --root <path> naming the monorepo root ` +
          `(or the directory containing the package folders).`,
      );
    }
    let mod: { tools?: unknown };
    try {
      mod = (await import(pathToFileURL(entry).href)) as { tools?: unknown };
    } catch (e: unknown) {
      throw new Error(
        `universe: could not import built tools from ${entry}. Did you run "pnpm turbo run build" first? ` +
          `Underlying error: ${errorMessage(e)}`,
      );
    }
    if (!Array.isArray(mod.tools)) {
      throw new Error(`universe: ${entry} does not export a "tools" array.`);
    }
    loaded.push({ pkg, tools: mod.tools as ToolDefinition[] });
  }
  return loaded;
}

interface UniverseToolOut {
  name: string;
  keys: string[];
}

interface UniversePackageOut {
  pkg: string;
  tools: UniverseToolOut[];
}

async function cmdUniverse(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, ["--json"], ["--file", "--profile", "--root"]);
  if (parsed.error) {
    deps.stderr.write(`Error: ${parsed.error}\n\nUsage: ${UNIVERSE_USAGE}\n`);
    return 2;
  }
  if (parsed.positional.length !== 0) {
    deps.stderr.write(`Error: "universe" takes no arguments.\n\nUsage: ${UNIVERSE_USAGE}\n`);
    return 2;
  }
  const profile = parsed.options.get("--profile") ?? DEFAULT_PROFILE_NAME;
  const profileError = keyNameError("a profile name", profile);
  if (profileError !== undefined) {
    deps.stderr.write(`Error: ${profileError}\n\nUsage: ${UNIVERSE_USAGE}\n`);
    return 2;
  }
  // `--root ""` is a usage error, not a silent auto-detect — the same
  // discipline the 32.1 review applied to `--file ""` (an empty flag value
  // is a typo, never an intentional value).
  const root = parsed.options.get("--root");
  if (root !== undefined && root === "") {
    deps.stderr.write(`Error: --root requires a non-empty path.\n\nUsage: ${UNIVERSE_USAGE}\n`);
    return 2;
  }
  const wantJson = parsed.flags.has("--json");
  const file = resolveFilePath(parsed, deps.env);

  const failOperational = (message: string): number => {
    deps.stderr.write(`Error: ${message}\n`);
    if (wantJson) deps.stdout.write(`${JSON.stringify({ profile, error: message })}\n`);
    return 1;
  };

  // The SAME cascade inputs as `effective`, read from the CLI's own
  // environment plus the resolved file — env/preset parse errors surface
  // with the servers' exact fail-fast text.
  let envConfig: GovernanceConfig;
  let preset: ReturnType<typeof parseGovernancePreset>;
  let fileConfig: GovernanceConfig | undefined;
  try {
    envConfig = parseGovernanceConfig(deps.env);
    preset = parseGovernancePreset(deps.env);
    fileConfig = file === undefined ? undefined : loadFileOrThrow(file);
  } catch (e: unknown) {
    return failOperational(errorMessage(e));
  }

  // Load the registered half of the universe from built dist.
  const containerDir = resolveContainerDir(parsed.options.get("--root"));
  let loaded: LoadedPackage[];
  try {
    loaded = await deps.loadPackageTools(containerDir);
  } catch (e: unknown) {
    return failOperational(errorMessage(e));
  }

  // Derive keys the iris-mcp-all way (SERVER_PACKAGES + deriveKeysForTool),
  // with the baseline generator's cross-package duplicate guard: one key
  // produced by two tools is a build-integrity error, never a silent merge.
  const originByKey = new Map<string, string>();
  const packagesOut: UniversePackageOut[] = [];
  const allTools: ToolDefinition[] = [];
  const deriveError = (e: unknown): number => failOperational(errorMessage(e));
  let frameworkKeys: string[];
  try {
    for (const { pkg, tools } of loaded) {
      const toolOut: UniverseToolOut[] = [];
      for (const tool of tools) {
        const keys = deriveKeysForTool(tool, pkg);
        for (const key of keys) {
          const origin = `${pkg}/${tool.name}`;
          const prior = originByKey.get(key);
          if (prior !== undefined && prior !== origin) {
            throw new Error(
              `universe: duplicate governance key "${key}" — produced by ${prior} and again by ${origin}. ` +
                `Tool names (and tool:action keys) must be unique across all server packages.`,
            );
          }
          originByKey.set(key, origin);
        }
        toolOut.push({ name: tool.name, keys });
      }
      packagesOut.push({ pkg, tools: toolOut });
      allTools.push(...tools);
    }
    // The framework discovery tool is registered centrally on every server
    // (Epic 19, decision E1) — it is in NO package's tools array, so add it
    // explicitly, derived with the SAME helper. The derived keys are reused
    // for the JSON output below so the two can never drift apart (32.2
    // review: the guard derived while the output hardcoded).
    frameworkKeys = deriveKeysForTool(serverDiscoveryTool, "framework");
    for (const key of frameworkKeys) {
      const prior = originByKey.get(key);
      if (prior !== undefined) {
        throw new Error(
          `universe: duplicate governance key "${key}" — produced by ${prior} and again by ` +
            `framework/${SERVER_DISCOVERY_TOOL_NAME}. The framework tool name is reserved.`,
        );
      }
      originByKey.set(key, `framework/${SERVER_DISCOVERY_TOOL_NAME}`);
    }
    allTools.push(serverDiscoveryTool);
  } catch (e: unknown) {
    return deriveError(e);
  }

  const universe = new Set<string>(GOVERNANCE_BASELINE);
  for (const key of originByKey.keys()) universe.add(key);
  const sortedKeys = [...universe].sort();

  // The REAL classifications — what a running server computes (as opposed to
  // `effective`'s empty lookup, which is why post-foundation write keys seed
  // correctly here: default-disabled unless F2 default-enabled).
  let mutatesLookup: Map<string, MutationClass>;
  let defaultEnabledWrites: ReadonlySet<string>;
  try {
    mutatesLookup = new Map(buildMutatesLookup(allTools));
    defaultEnabledWrites = buildDefaultEnabledWrites(allTools);
  } catch (e: unknown) {
    return failOperational(errorMessage(e));
  }

  // SINGLE-SOURCED cascade render over the full universe — the identical
  // functions the servers call, with the same argument order.
  const policy = getEffectivePolicy(
    profile,
    envConfig,
    sortedKeys,
    mutatesLookup,
    GOVERNANCE_BASELINE,
    defaultEnabledWrites,
    preset,
    BASELINE_ACTION_CLASSIFICATIONS,
    fileConfig,
  );
  const sources = getEffectiveConfigSources(
    profile,
    envConfig,
    sortedKeys,
    mutatesLookup,
    preset,
    BASELINE_ACTION_CLASSIFICATIONS,
    fileConfig,
  );

  // Per-key mutates classification for display (baseline classifications win,
  // mirroring presetSeed's own precedence); own-property read only.
  const mutatesOut: Record<string, MutationClass> = {};
  for (const key of sortedKeys) {
    const cls = Object.prototype.hasOwnProperty.call(BASELINE_ACTION_CLASSIFICATIONS, key)
      ? BASELINE_ACTION_CLASSIFICATIONS[key]
      : mutatesLookup.get(key);
    if (cls !== undefined) {
      Object.defineProperty(mutatesOut, key, {
        value: cls,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  const postFoundation = sortedKeys.filter((key) => !GOVERNANCE_BASELINE.has(key));

  if (wantJson) {
    deps.stdout.write(
      `${JSON.stringify({
        profile,
        file: file ?? null,
        preset: preset ?? null,
        universeSource: containerDir,
        packages: packagesOut,
        frameworkTool: { name: SERVER_DISCOVERY_TOOL_NAME, keys: frameworkKeys },
        keys: sortedKeys,
        postFoundation,
        mutates: mutatesOut,
        defaultEnabledWrites: [...defaultEnabledWrites].sort(),
        policy,
        configSource: sources,
        note: UNIVERSE_NOTE,
      })}\n`,
    );
  } else {
    deps.stdout.write(
      `Governance universe for profile "${profile}"` +
        `${file === undefined ? "" : ` (file: ${file})`}` +
        `${preset === undefined ? "" : ` (preset: ${preset})`}:\n` +
        `  derived from: ${containerDir} (${loaded.length} server packages + the framework tool)\n`,
    );
    const emitKey = (key: string): void => {
      const cls = mutatesOut[key] ?? "unclassified";
      deps.stdout.write(`    ${key} = ${policy[key]}   (source: ${sources[key]}, mutates: ${cls})\n`);
    };
    for (const pkgOut of packagesOut) {
      const keyCount = pkgOut.tools.reduce((count, tool) => count + tool.keys.length, 0);
      deps.stdout.write(`  ${pkgOut.pkg} (${pkgOut.tools.length} tools, ${keyCount} keys):\n`);
      for (const tool of pkgOut.tools) {
        for (const key of tool.keys) emitKey(key);
      }
    }
    deps.stdout.write(`  framework (1 tool, 1 key):\n`);
    emitKey(SERVER_DISCOVERY_TOOL_NAME);
    const unowned = sortedKeys.filter((key) => !originByKey.has(key));
    if (unowned.length > 0) {
      deps.stdout.write(`  baseline-only (no current package tool; ${unowned.length} keys):\n`);
      for (const key of unowned) emitKey(key);
    }
    deps.stdout.write(`Note: ${UNIVERSE_NOTE}\n`);
  }
  return 0;
}

// ════════════════════════════════════════════════════════════════════
// Entry point.
// ════════════════════════════════════════════════════════════════════

/**
 * 32-1-R4 (Story 32.4): help is honored only where the argv grammar puts it
 * in OPTION position. A pre-dispatch `argv.includes("-h"/"--help")` broke
 * the parser's own dash-value contract: `get -- -h` (a positional after the
 * `--` terminator), `validate --file --help` (a valued option's VALUE), and
 * `--profile -h` could never be addressed — help printed and the process
 * exited 0, the exact opposite of the documented `--`/dash-value guarantee.
 * This scanner mirrors `parseArgs`' state machine: the `--` terminator ends
 * option scanning, and the token following a valued option is its value,
 * never a flag.
 */
function helpRequested(args: string[]): boolean {
  const valuedOptions = new Set(["--file", "--profile", "--root"]);
  let optionsEnded = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (optionsEnded) continue;
    if (arg === "--") {
      optionsEnded = true;
      continue;
    }
    if (valuedOptions.has(arg)) {
      i++; // the next token is this option's VALUE, even one starting with "-"
      continue;
    }
    if (arg === "-h" || arg === "--help") return true;
  }
  return false;
}

/**
 * Run the CLI for one invocation. Pure function of `argv`/`deps` — never
 * calls `process.exit`, so the caller (the sibling `governance-cli.ts` bin
 * entry, or a test) decides what to do with the returned exit code.
 *
 * @param argv - Arguments AFTER the command name (i.e. `process.argv.slice(2)`).
 * @param deps - Injectable streams/env — production callers omit this entirely.
 */
export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const resolved = resolveDeps(deps);

  if (helpRequested(argv)) {
    resolved.stdout.write(HELP_TEXT);
    return 0;
  }

  const [command, ...rest] = argv;
  if (command === undefined) {
    resolved.stderr.write(`Error: no command given.\n\n${HELP_TEXT}`);
    return 2;
  }

  switch (command) {
    case "validate":
      return cmdValidate(rest, resolved);
    case "get":
      return cmdGet(rest, resolved);
    case "set":
      return cmdSet(rest, resolved);
    case "unset":
      return cmdUnset(rest, resolved);
    case "preset":
      return cmdPreset(rest, resolved);
    case "effective":
      return cmdEffective(rest, resolved);
    case "diff":
      return cmdDiff(rest, resolved);
    case "universe":
      return cmdUniverse(rest, resolved);
    default:
      resolved.stderr.write(
        `Error: unknown command "${command}". Valid commands: validate, get, set, unset, preset, effective, diff, universe.\n\n${HELP_TEXT}`,
      );
      return 2;
  }
}
