/**
 * Governance engine access layer (Story 32.2, Task 1): the ONLY way the
 * extension reaches the governance engine — by SUBPROCESS, running the
 * `iris-mcp-governance` CLI shipped by Story 32.1
 * (`packages/shared/dist/cli/governance-cli.js`, published as the
 * `iris-mcp-governance` bin of `@iris-mcp/shared`).
 *
 * **Self-contained VSIX is invariant.** `@iris-mcp/shared` is never bundled
 * into this extension (it pulls the native `@napi-rs/keyring` dependency,
 * which would break the zero-runtime-dependency `dist/*.js`-only package).
 * Every cascade computation, validation, and file write happens inside the
 * CLI process — the UI never reimplements engine logic (AC 32.2.2), and the
 * `universe` command derives the governed-key universe from built dist the
 * same way the `iris-mcp-all` cross-package tests do (never a
 * hand-maintained list).
 *
 * **Resolution order (mirrors Story 31.6's spawn resolution).**
 * - `irisMcpLauncher.developmentRepoPath` set → run
 *   `<repo>/packages/shared/dist/cli/governance-cli.js` with the extension
 *   host's own interpreter (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`).
 *   Fail-closed with an actionable error when the path is relative or the
 *   CLI is not built — never fall back silently to npx, exactly the 31.6
 *   discipline (a guessed fallback would run a DIFFERENT engine version than
 *   the user pinned).
 * - Otherwise → `npx -y -p @iris-mcp/shared iris-mcp-governance`. The
 *   `universe` command additionally `-p`-installs the five server packages,
 *   because it derives the full key universe from their built dist and npm
 *   lays sibling packages out side-by-side under the same `node_modules/@iris-mcp/`.
 *
 * **Credential containment.** The CLI needs only the governance file path —
 * it never touches IRIS. The spawned environment therefore scrubs EVERY
 * `IRIS_*` variable from the ambient extension-host environment (so no
 * `IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_PROFILES` credential material, and no
 * ambient `IRIS_GOVERNANCE`/`IRIS_GOVERNANCE_PRESET`/`IRIS_GOVERNANCE_FILE`,
 * can ever reach the subprocess), then re-adds exactly the two cascade
 * inputs the extension itself owns — `IRIS_GOVERNANCE`/`IRIS_GOVERNANCE_PRESET`
 * from this extension's own settings — so the CLI's `universe`/`effective`
 * render computes the SAME env channel the spawned servers will see. The
 * file is always passed explicitly via `--file` (J1: explicit path only).
 *
 * Deliberately has NO value-level dependency on the `vscode` module — see the
 * "one vscode import" rule in `extension.ts`'s doc comment. Process spawning
 * is injected ({@link SpawnImpl}) so the whole module is unit-testable in a
 * plain Node process.
 */
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { PACKAGE_NPM_NAME } from "./definitions.js";
import type { LauncherSettings, SuitePackageKey } from "./types.js";

/** Repo-relative path of the built governance CLI inside a monorepo checkout. */
export const GOVERNANCE_CLI_REPO_PATH = join(
  "packages",
  "shared",
  "dist",
  "cli",
  "governance-cli.js",
);

/** The npm package that ships the `iris-mcp-governance` bin. */
export const GOVERNANCE_CLI_NPM_PACKAGE = "@iris-mcp/shared";
/** The bin name inside that package. */
export const GOVERNANCE_CLI_BIN_NAME = "iris-mcp-governance";

/** A resolved CLI invocation target: what to spawn and with which base argv/env. */
export interface GovernanceCliTarget {
  /** `process.execPath` (local mode) or `npx` (published mode). */
  command: string;
  /**
   * Base argv the per-command argv is appended to: `[cliPath]` in local
   * mode, the `npx -y -p … iris-mcp-governance` prefix in published mode.
   */
  baseArgs: string[];
  /** Extra env to merge over the scrubbed env (local mode's ELECTRON_RUN_AS_NODE). */
  extraEnv: Record<string, string>;
  /** Which resolution mode produced this target (surfaced in the view for transparency). */
  mode: "local" | "npx";
}

/** A failed resolution — the view renders `error`; nothing is ever spawned. */
export type GovernanceCliResolution =
  | { ok: true; target: GovernanceCliTarget }
  | { ok: false; error: string };

/** Injectable filesystem probe — ASYNC (32-2-R1, the 31-6-2 discipline: no synchronous stat on the extension host, where a UNC/network path stalls the single-threaded host). */
export type FileExistsProbe = (path: string) => Promise<boolean>;

const defaultFileExists: FileExistsProbe = async (candidatePath) => {
  try {
    return (await stat(candidatePath)).isFile();
  } catch {
    return false;
  }
};

/**
 * Resolve how to spawn the governance CLI for the current settings
 * (resolution order documented in the module banner). `fileExists` is
 * injectable for tests; the production default is a guarded
 * `fs/promises.stat` (32-2-R1 — the same fs/promises conversion 31-6-2 made
 * for the spawn-validation stats; a UNC `developmentRepoPath` must never
 * stall the extension host on panel open/refresh).
 */
export async function resolveGovernanceCli(
  settings: LauncherSettings,
  forUniverse: boolean,
  fileExists: FileExistsProbe = defaultFileExists,
): Promise<GovernanceCliResolution> {
  if (settings.developmentRepoPath !== "") {
    if (!isAbsolute(settings.developmentRepoPath)) {
      return {
        ok: false,
        error:
          `irisMcpLauncher.developmentRepoPath is set to "${settings.developmentRepoPath}", which is not an ` +
          `absolute path, so the governance CLI cannot be located. Point it at a local monorepo checkout of the ` +
          `IRIS MCP suite, or clear it to use the published @iris-mcp/shared package via npx.`,
      };
    }
    const cliPath = join(settings.developmentRepoPath, GOVERNANCE_CLI_REPO_PATH);
    if (!(await fileExists(cliPath))) {
      return {
        ok: false,
        error:
          `The governance CLI is not built at "${cliPath}". Run "pnpm --filter @iris-mcp/shared build" in the ` +
          `checkout irisMcpLauncher.developmentRepoPath points at, or clear that setting to use the published ` +
          `@iris-mcp/shared package via npx.`,
      };
    }
    return {
      ok: true,
      target: {
        command: process.execPath,
        baseArgs: [cliPath],
        extraEnv: { ELECTRON_RUN_AS_NODE: "1" },
        mode: "local",
      },
    };
  }

  const packages = [GOVERNANCE_CLI_NPM_PACKAGE];
  if (forUniverse) {
    // `universe` derives the full key universe from the five server packages'
    // built dist; under npm those must be installed alongside @iris-mcp/shared
    // (npx lays all `-p` packages out under one node_modules/@iris-mcp/). The
    // package list is DERIVED from the same PACKAGE_NPM_NAME map the server
    // spawn path uses — never a hand-maintained duplicate roster.
    for (const key of Object.keys(PACKAGE_NPM_NAME) as SuitePackageKey[]) {
      packages.push(PACKAGE_NPM_NAME[key]);
    }
  }
  const baseArgs = ["-y"];
  for (const pkg of packages) {
    baseArgs.push("-p", pkg);
  }
  baseArgs.push(GOVERNANCE_CLI_BIN_NAME);
  return {
    ok: true,
    target: { command: "npx", baseArgs, extraEnv: {}, mode: "npx" },
  };
}

/**
 * Build the spawned CLI's environment: the ambient extension-host environment
 * with EVERY `IRIS_*` variable scrubbed (credential containment — the CLI
 * never receives credential material, and no ambient governance channel can
 * leak into its cascade render), then exactly the two governance cascade
 * inputs this extension owns re-added from settings. Any additional
 * invocation env (local mode's `ELECTRON_RUN_AS_NODE=1`) is merged last.
 */
export function buildGovernanceCliEnv(
  settings: LauncherSettings,
  extraEnv: Record<string, string> = {},
  ambient: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(ambient)) {
    if (value === undefined) continue;
    // Case-INsensitive: Windows environment lookup is case-insensitive, so an
    // ambient `iris_password` / `iris_governance` would be honored by the
    // spawned CLI exactly like its uppercase spelling — the scrub must cover
    // every case variant or the containment boundary leaks (the 32-3-R9
    // lesson, applied to the production engine at the 32.2 review).
    if (name.toUpperCase().startsWith("IRIS_")) continue;
    env[name] = value;
  }
  if (settings.governance !== "") {
    env["IRIS_GOVERNANCE"] = settings.governance;
  }
  if (settings.governancePreset !== "") {
    env["IRIS_GOVERNANCE_PRESET"] = settings.governancePreset;
  }
  for (const [name, value] of Object.entries(extraEnv)) {
    env[name] = value;
  }
  return env;
}

/**
 * One CLI command the view can request. `profile === undefined` addresses the
 * file's GLOBAL layer for set/unset; `universe` always renders per-profile.
 * `universe`'s `file` is OPTIONAL: the CLI renders the env/preset/seed
 * cascade without one — how the view renders a governance file that does not
 * exist yet (the CLI's file-reading commands fail on a missing file by
 * design, since a server fails startup on one).
 */
export type GovernanceCliCommand =
  | { kind: "validate"; file: string }
  | { kind: "diff"; file: string }
  | { kind: "universe"; file?: string; profile: string }
  | { kind: "set"; file: string; profile: string | undefined; key: string; value: boolean }
  | { kind: "unset"; file: string; profile: string | undefined; key: string };

/**
 * Map a {@link GovernanceCliCommand} to the CLI's argv (after the target's
 * base args). Single-sourced here so the view-model's tests pin the exact
 * wire shape against the CLI's documented contract.
 */
export function governanceCliArgv(command: GovernanceCliCommand): string[] {
  switch (command.kind) {
    case "validate":
      return ["validate", "--json", "--file", command.file];
    case "diff":
      return ["diff", "--json", "--file", command.file];
    case "universe": {
      const args = ["universe", "--json"];
      if (command.file !== undefined) args.push("--file", command.file);
      args.push("--profile", command.profile);
      return args;
    }
    case "set": {
      const args = ["set", command.key, command.value ? "true" : "false", "--file", command.file];
      if (command.profile !== undefined) args.push("--profile", command.profile);
      return args;
    }
    case "unset": {
      const args = ["unset", command.key, "--file", command.file];
      if (command.profile !== undefined) args.push("--profile", command.profile);
      return args;
    }
  }
}

/** The captured result of one CLI invocation. */
export interface GovernanceCliResult {
  /** Process exit status, or `null` when the process could not be spawned at all. */
  status: number | null;
  stdout: string;
  stderr: string;
  /** Spawn-level failure message (e.g. ENOENT on npx) — never third-party text we fabricated. */
  spawnError?: string;
}

/** Injectable spawn seam — production uses `node:child_process.spawn`; tests inject a fake. */
export type SpawnImpl = (
  command: string,
  args: string[],
  options: { env: Record<string, string> },
) => {
  stdout: { on: (event: "data", listener: (chunk: Buffer | string) => void) => void };
  stderr: { on: (event: "data", listener: (chunk: Buffer | string) => void) => void };
  on: (event: "close" | "error", listener: (arg: unknown) => void) => void;
  /** Terminate the child (used by the spawn timeout). Optional for test fakes. */
  kill?: () => void;
};

const realSpawn: SpawnImpl = (command, args, options) => spawn(command, args, options);

/**
 * The default ceiling on one CLI invocation (2 minutes — local mode answers
 * in milliseconds; first-run npx downloads dominate). Injectable so tests can
 * pin the timeout without waiting.
 */
export const DEFAULT_CLI_TIMEOUT_MS = 120_000;

/**
 * Resolve the REAL command/argv to spawn for the current platform. On Windows
 * `npx` is a `.cmd` shim, and `child_process.spawn` without `shell: true`
 * cannot execute batch files (ENOENT pre-Node-20.12, EINVAL since the
 * CVE-2024-27980 hardening) — verified empirically at the 32.2 review
 * (`spawn("npx", …)` → `error` ENOENT on win32). Routing through
 * `cmd.exe /d /s /c` keeps the args array intact: libuv quotes spaced
 * arguments onto the `cmd.exe` command line and `cmd` re-parses them with the
 * quotes honored (verified with a spaced path). `shell: true` was rejected —
 * it concatenates args UNESCAPED (DEP0190), breaking governance file paths
 * containing spaces.
 */
export function resolveSpawnCommand(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  comSpec: string = process.env.ComSpec ?? "cmd.exe",
): { command: string; args: string[] } {
  if (platform === "win32" && !/\.exe$/i.test(command)) {
    return { command: comSpec, args: ["/d", "/s", "/c", command, ...args] };
  }
  return { command, args };
}

/**
 * Run one CLI command against a resolved target and capture its output.
 * Never throws: a spawn failure (npx not on PATH, etc.) comes back as
 * `spawnError` so the view can render it inline — one clear message, no
 * unhandled rejection out of a UI surface (the AC 31.5.5 bar).
 *
 * A child that never settles (a stalled first-run npx download is the
 * realistic case) is killed after `timeoutMs` and resolved as a `spawnError`
 * — otherwise the panel's busy guard would wedge for the whole session
 * (32.2 review: hung child + no timeout + busy surviving panel dispose).
 */
export function runGovernanceCli(
  target: GovernanceCliTarget,
  command: GovernanceCliCommand,
  env: Record<string, string>,
  spawnImpl: SpawnImpl = realSpawn,
  timeoutMs: number = DEFAULT_CLI_TIMEOUT_MS,
  platform: NodeJS.Platform = process.platform,
): Promise<GovernanceCliResult> {
  const argv = [...target.baseArgs, ...governanceCliArgv(command)];
  const resolved = resolveSpawnCommand(target.command, argv, platform);
  return new Promise((resolvePromise) => {
    let child: ReturnType<SpawnImpl>;
    try {
      child = spawnImpl(resolved.command, resolved.args, { env });
    } catch (error: unknown) {
      resolvePromise({
        status: null,
        stdout: "",
        stderr: "",
        spawnError: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: GovernanceCliResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill?.();
      } catch {
        // A kill failure must not mask the timeout itself.
      }
      finish({
        status: null,
        stdout,
        stderr,
        spawnError: `iris-mcp-governance ${command.kind} timed out after ${Math.round(timeoutMs / 1000)}s — the CLI process never settled (a stalled npx download?). Retry, or point irisMcpLauncher.developmentRepoPath at a built checkout.`,
      });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (arg: unknown) => {
      finish({
        status: null,
        stdout,
        stderr,
        spawnError: arg instanceof Error ? arg.message : String(arg),
      });
    });
    child.on("close", (arg: unknown) => {
      finish({ status: typeof arg === "number" ? arg : null, stdout, stderr });
    });
  });
}

/**
 * Parse a read command's single-JSON-object stdout (the CLI's documented
 * `--json` contract). Returns the parsed object, or an error string that
 * prefers the CLI's own stderr text (the engine's own messages — the UI's
 * inline validation errors) over a bare parse failure.
 */
export function parseCliJson(stdout: string, stderr: string): { ok: true; json: unknown } | { ok: false; error: string } {
  const trimmed = stdout.trim();
  if (trimmed !== "") {
    try {
      return { ok: true, json: JSON.parse(trimmed) };
    } catch {
      // Fall through to the stderr-based error below.
    }
  }
  const detail = stderr.trim();
  return {
    ok: false,
    error:
      detail !== ""
        ? detail
        : "the governance CLI produced no parseable JSON output",
  };
}
