/**
 * Clients engine access layer (Story 33.3, Task 1): the ONLY way the
 * extension reaches the client-config engine — by SUBPROCESS, running the
 * `iris-mcp-clients` CLI shipped by Story 33.2
 * (`packages/client-config/dist/cli/clients-cli.js`, published as the
 * `iris-mcp-clients` bin of `@iris-mcp/client-config`).
 *
 * Mirrors `governanceEngine.ts` (the Story 32.2 layering precedent, mirrored
 * exactly per the story Dev Notes):
 *
 * **Self-contained VSIX is invariant.** `@iris-mcp/client-config` is never
 * bundled into this extension — every detection probe, config parse, and
 * client-config write happens inside the CLI process. The UI never
 * reimplements engine logic and never touches a client config file itself
 * (Integration AC 33.3-I1).
 *
 * **Resolution order (mirrors Story 31.6's spawn resolution).**
 * - `irisMcpLauncher.developmentRepoPath` set → run
 *   `<repo>/packages/client-config/dist/cli/clients-cli.js` with the
 *   extension host's own interpreter (`process.execPath` +
 *   `ELECTRON_RUN_AS_NODE=1`). Fail-closed with an actionable error when the
 *   path is relative or the CLI is not built — never fall back silently to
 *   npx (a guessed fallback would run a DIFFERENT engine version than the
 *   user pinned).
 * - Otherwise → `npx -y -p @iris-mcp/client-config iris-mcp-clients`.
 *
 * **Credential containment (the governanceEngine discipline, Integration AC
 * 33.3-I1).** The spawned environment scrubs EVERY `IRIS_*` variable from the
 * ambient extension-host environment (case-insensitively — the 32-3-R9
 * lesson), so no `IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_PROFILES` credential
 * material and no ambient `IRIS_SERVER_MANAGER`/`IRIS_GOVERNANCE` channel can
 * ever reach the subprocess. Exactly ONE extension-owned variable is then
 * re-added from this extension's own settings: `IRIS_GOVERNANCE_FILE` (from
 * `irisMcpLauncher.governanceFile`) — the same passthrough every spawned
 * server receives, so the CLI's `governance-file` mode gating computes
 * against the SAME channel the user's servers will see (the governanceEngine
 * precedent of re-adding only the extension-owned cascade inputs).
 * `IRIS_SERVER_MANAGER` is deliberately NOT re-added: the extension never
 * owns that channel, and the CLI's server-manager host probe works from
 * settings-file discovery regardless.
 *
 * **Explicit-mode secret handling.** `diff`/`apply` in `explicit` mode carry
 * the literal password ONLY on the child's stdin (`--password-stdin`), never
 * in argv and never in this module's logs/results. The explicit-mode PREVIEW
 * uses the CLI's text render rather than `diff --json`: the CLI redacts both
 * surfaces through its `redactPlanSecrets` gate (Story 33.3 QA found the JSON
 * diff envelope emitting the raw render — fixed CLI-side and regression-pinned
 * in clients-cli.test.ts), and the text render stays the preview channel as
 * belt-and-braces (the gate withholds the render entirely when a secret
 * survives serialization non-verbatim, which the text surface displays
 * directly).
 *
 * Deliberately has NO value-level dependency on the `vscode` module — see the
 * "one vscode import" rule in `extension.ts`'s doc comment. Process spawning
 * is injected ({@link ClientsSpawnImpl}) so the whole module is unit-testable
 * in a plain Node process.
 */
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  DEFAULT_CLI_TIMEOUT_MS,
  resolveSpawnCommand,
  type FileExistsProbe,
} from "./governanceEngine.js";
import type { LauncherSettings } from "./types.js";

/** Repo-relative path of the built clients CLI inside a monorepo checkout. */
export const CLIENTS_CLI_REPO_PATH = join(
  "packages",
  "client-config",
  "dist",
  "cli",
  "clients-cli.js",
);

/** The npm package that ships the `iris-mcp-clients` bin. */
export const CLIENTS_CLI_NPM_PACKAGE = "@iris-mcp/client-config";
/** The bin name inside that package. */
export const CLIENTS_CLI_BIN_NAME = "iris-mcp-clients";

/** The env modes the CLI's `--mode` accepts (mirrors the CLI's ALL_MODES). */
export type CliEnvMode = "env-reference" | "explicit" | "server-manager" | "governance-file";

/** A resolved CLI invocation target: what to spawn and with which base argv/env. */
export interface ClientsCliTarget {
  /** `process.execPath` (local mode) or `npx` (published mode). */
  command: string;
  /** Base argv the per-command argv is appended to. */
  baseArgs: string[];
  /** Extra env to merge over the scrubbed env (local mode's ELECTRON_RUN_AS_NODE). */
  extraEnv: Record<string, string>;
  /** Which resolution mode produced this target (surfaced in the view for transparency). */
  mode: "local" | "npx";
}

/** A failed resolution — the view renders `error`; nothing is ever spawned. */
export type ClientsCliResolution =
  | { ok: true; target: ClientsCliTarget }
  | { ok: false; error: string };

/** Default filesystem probe — ASYNC (32-2-R1: no synchronous stat on the extension host). */
const defaultFileExists: FileExistsProbe = async (candidatePath) => {
  try {
    return (await stat(candidatePath)).isFile();
  } catch {
    return false;
  }
};

/**
 * Resolve how to spawn the clients CLI for the current settings (resolution
 * order documented in the module banner). `fileExists` is injectable for
 * tests; the production default is a guarded `fs/promises.stat`.
 */
export async function resolveClientsCli(
  settings: LauncherSettings,
  fileExists: FileExistsProbe = defaultFileExists,
): Promise<ClientsCliResolution> {
  if (settings.developmentRepoPath !== "") {
    if (!isAbsolute(settings.developmentRepoPath)) {
      return {
        ok: false,
        error:
          `irisMcpLauncher.developmentRepoPath is set to "${settings.developmentRepoPath}", which is not an ` +
          `absolute path, so the clients CLI cannot be located. Point it at a local monorepo checkout of the ` +
          `IRIS MCP suite, or clear it to use the published @iris-mcp/client-config package via npx.`,
      };
    }
    const cliPath = join(settings.developmentRepoPath, CLIENTS_CLI_REPO_PATH);
    if (!(await fileExists(cliPath))) {
      return {
        ok: false,
        error:
          `The clients CLI is not built at "${cliPath}". Run "pnpm --filter @iris-mcp/client-config build" in the ` +
          `checkout irisMcpLauncher.developmentRepoPath points at, or clear that setting to use the published ` +
          `@iris-mcp/client-config package via npx.`,
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

  return {
    ok: true,
    target: {
      command: "npx",
      baseArgs: ["-y", "-p", CLIENTS_CLI_NPM_PACKAGE, CLIENTS_CLI_BIN_NAME],
      extraEnv: {},
      mode: "npx",
    },
  };
}

/**
 * Build the spawned CLI's environment: the ambient extension-host environment
 * with EVERY `IRIS_*` variable scrubbed (case-insensitively — Windows
 * environment lookup is case-insensitive), then exactly the ONE extension-
 * owned channel re-added (`IRIS_GOVERNANCE_FILE` from
 * `irisMcpLauncher.governanceFile`; see the module banner). Any additional
 * invocation env (local mode's `ELECTRON_RUN_AS_NODE=1`) is merged last.
 */
export function buildClientsCliEnv(
  settings: LauncherSettings,
  extraEnv: Record<string, string> = {},
  ambient: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(ambient)) {
    if (value === undefined) continue;
    if (name.toUpperCase().startsWith("IRIS_")) continue;
    env[name] = value;
  }
  if (settings.governanceFile !== "") {
    env["IRIS_GOVERNANCE_FILE"] = settings.governanceFile;
  }
  for (const [name, value] of Object.entries(extraEnv)) {
    env[name] = value;
  }
  return env;
}

/**
 * One CLI command the view can request. Single-sourced here so the view-
 * model's tests pin the exact wire shape against the CLI's documented
 * contract (the GovernanceCliCommand discipline).
 */
export type ClientsCliCommand =
  | { kind: "detect" }
  | { kind: "status" }
  | { kind: "doctor" }
  /** The `--help` render, probed for the host-available env modes (the CLI's own mode-gating surface). */
  | { kind: "modesHelp" }
  | {
      kind: "diff";
      client: string;
      scope: "user" | "project";
      servers: string[];
      mode: CliEnvMode;
      /** explicit mode only: the typed confirmation (exactly the entry name) + the stdin password. */
      confirmSecret?: string;
      passwordStdin?: string;
    }
  | {
      kind: "apply";
      client: string;
      scope: "user" | "project";
      servers: string[];
      mode: CliEnvMode;
      confirmSecret?: string;
      passwordStdin?: string;
    }
  | { kind: "enable" | "disable" | "remove"; client: string; scope: "user" | "project"; server: string }
  | { kind: "restore"; client: string; scope: "user" | "project" };

/**
 * Map a {@link ClientsCliCommand} to the CLI's argv (after the target's base
 * args). Wire contract notes:
 * - read commands always take `--json` (the stable envelope);
 * - `diff` takes `--json` EXCEPT in explicit mode, where the CLI's redacted
 *   TEXT render is used instead (see the module banner);
 * - `apply` always takes `--yes` (the panel's own explicit-confirm button is
 *   the confirmation; a non-TTY spawn without it would exit 2) and `--json`;
 * - explicit mode adds `--confirm-secret <entry-name>` and `--password-stdin`
 *   (the password itself travels on the child's stdin, never in argv).
 */
export function clientsCliArgv(command: ClientsCliCommand): string[] {
  switch (command.kind) {
    case "detect":
      return ["detect", "--json"];
    case "status":
      return ["status", "--json"];
    case "doctor":
      return ["doctor", "--json"];
    case "modesHelp":
      return ["--help"];
    case "diff": {
      const args = [
        "diff",
        "--client", command.client,
        "--servers", command.servers.join(","),
        "--scope", command.scope,
        "--mode", command.mode,
      ];
      if (command.mode === "explicit") {
        args.push("--confirm-secret", command.confirmSecret ?? "", "--password-stdin");
      } else {
        args.push("--json");
      }
      return args;
    }
    case "apply": {
      const args = [
        "apply",
        "--client", command.client,
        "--servers", command.servers.join(","),
        "--scope", command.scope,
        "--mode", command.mode,
        "--yes",
        "--json",
      ];
      if (command.mode === "explicit") {
        args.push("--confirm-secret", command.confirmSecret ?? "", "--password-stdin");
      }
      return args;
    }
    case "enable":
    case "disable":
    case "remove":
      return [command.kind, "--client", command.client, "--server", command.server, "--scope", command.scope, "--json"];
    case "restore":
      return ["restore", "--client", command.client, "--scope", command.scope, "--json"];
  }
}

/** The captured result of one CLI invocation. */
export interface ClientsCliResult {
  /** Process exit status, or `null` when the process could not be spawned at all. */
  status: number | null;
  stdout: string;
  stderr: string;
  /** Spawn-level failure message (e.g. ENOENT on npx) — never third-party text we fabricated. */
  spawnError?: string;
}

/**
 * Injectable spawn seam — production uses `node:child_process.spawn`; tests
 * inject a fake. Extends the governance `SpawnImpl` shape with an OPTIONAL
 * writable stdin (a real `ChildProcess`'s `stdin` is a `Writable` — Rule #54;
 * only the explicit-mode password path writes to it).
 */
export type ClientsSpawnImpl = (
  command: string,
  args: string[],
  options: { env: Record<string, string> },
) => {
  stdin?: { write(chunk: string): void; end(): void };
  stdout: { on: (event: "data", listener: (chunk: Buffer | string) => void) => void };
  stderr: { on: (event: "data", listener: (chunk: Buffer | string) => void) => void };
  on: (event: "close" | "error", listener: (arg: unknown) => void) => void;
  kill?: () => void;
};

const realSpawn: ClientsSpawnImpl = (command, args, options) => spawn(command, args, options);

/**
 * Run one CLI command against a resolved target and capture its output.
 * Never throws: a spawn failure comes back as `spawnError` so the view can
 * render it inline — one clear message, no unhandled rejection out of a UI
 * surface (the AC 31.5.5 bar). A child that never settles is killed after
 * `timeoutMs` and resolved as a `spawnError` (the 32.2 hung-CLI lesson).
 *
 * When the command carries `passwordStdin` (explicit mode), the password is
 * written to the child's stdin and the stream closed immediately — it is
 * never logged, never echoed into argv, and never retained here.
 */
export function runClientsCli(
  target: ClientsCliTarget,
  command: ClientsCliCommand,
  env: Record<string, string>,
  spawnImpl: ClientsSpawnImpl = realSpawn,
  timeoutMs: number = DEFAULT_CLI_TIMEOUT_MS,
  platform: NodeJS.Platform = process.platform,
): Promise<ClientsCliResult> {
  const argv = [...target.baseArgs, ...clientsCliArgv(command)];
  const resolved = resolveSpawnCommand(target.command, argv, platform);
  const stdinText =
    (command.kind === "apply" || command.kind === "diff") && command.passwordStdin !== undefined
      ? `${command.passwordStdin}\n`
      : undefined;
  return new Promise((resolvePromise) => {
    let child: ReturnType<ClientsSpawnImpl>;
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
    const finish = (result: ClientsCliResult): void => {
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
        spawnError: `iris-mcp-clients ${command.kind} timed out after ${Math.round(timeoutMs / 1000)}s — the CLI process never settled (a stalled npx download?). Retry, or point irisMcpLauncher.developmentRepoPath at a built checkout.`,
      });
    }, timeoutMs);
    if (stdinText !== undefined && child.stdin !== undefined) {
      try {
        child.stdin.write(stdinText);
        child.stdin.end();
      } catch {
        // A broken stdin surfaces as the child's own error/close below.
      }
    }
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

// ════════════════════════════════════════════════════════════════════
// CLI `--json` data shapes (captured from the real built bin 2026-07-28,
// Rule #36 — capture commands in clientsView.test.ts's header).
// ════════════════════════════════════════════════════════════════════

/** The stable `--json` envelope every command answers on stdout. */
export interface CliEnvelope {
  ok: boolean;
  command: string;
  data: unknown;
  error?: string;
}

export interface DetectProbeJson {
  kind: "config" | "appDir";
  scope?: "user" | "project";
  path: string;
  exists: boolean;
}

export interface DetectClientJson {
  client: string;
  displayName: string;
  detected: boolean;
  probes: DetectProbeJson[];
}

/** One considered-but-dispositioned client (the text render's "Other clients:" rows, Story 33.3 additive). */
export interface DispositionJson {
  id: string;
  displayName: string;
  disposition: string;
  reason: string;
}

/** `iris-mcp-clients detect --json` data. */
export interface DetectData {
  adapterDataVersion: string;
  clients: DetectClientJson[];
  /** Story-33.3 additive key — OPTIONAL because an older CLI (npx version skew, stale developmentRepoPath) omits it; consumers must tolerate its absence. */
  dispositions?: DispositionJson[];
  counts: { probed: number; detected: number; notDetected: number; dispositioned: number };
}

export interface StatusServerJson {
  server: string;
  state: "present-enabled" | "present-disabled" | "absent";
}

export interface StatusScopeJson {
  scope: "user" | "project";
  path: string | null;
  file: "ok" | "missing" | "unparseable" | "unresolved";
  error?: string;
  servers: StatusServerJson[];
  /** Foreign third-party entry NAMES (sorted). Names only — never values. */
  foreign: string[];
}

export interface StatusClientJson {
  client: string;
  displayName: string;
  scopes: StatusScopeJson[];
}

/** `iris-mcp-clients status --json` data. */
export interface StatusData {
  adapterDataVersion: string;
  clients: StatusClientJson[];
  undetected: { client: string; displayName: string }[];
  counts: { detected: number; undetected: number; managedEntries: number };
}

export interface DiffServerJson {
  server: string;
  mechanism: string;
  /** The pending-edit render (redacted secret-free in EVERY mode — the CLI's redactPlanSecrets gate applies to the envelope too, Story 33.3 QA hardening). */
  text: string;
  missingInputIds: string[];
}

/** `iris-mcp-clients diff --json` data (non-explicit modes only — see the module banner). */
export interface DiffApplyData {
  client: string;
  scope: string;
  mode: string;
  servers: DiffServerJson[];
}

/** One engine result row (the enable/disable/remove/restore `--json` data; also apply's per-server rows). */
export interface EngineResultJson {
  ok: boolean;
  client: string;
  scope: string;
  action: string;
  path: string | null;
  mechanism?: string;
  changed: boolean;
  backupPath?: string;
  restored?: boolean;
  restartHint?: string;
  reason?: string;
  note?: string;
  warnings?: string[];
}

/** `iris-mcp-clients apply --json` data. */
export interface ApplyData {
  client: string;
  scope: string;
  mode: string;
  changed: number;
  inputsMerged: string[];
  results: EngineResultJson[];
  restartHint?: string;
}

export interface DoctorFindingJson {
  check: string;
  client: string;
  scope: string;
  path: string | null;
  detail: string;
  entry?: string;
}

/** `iris-mcp-clients doctor --json` data (present on BOTH the clean and the findings outcome). */
export interface DoctorData {
  findings: DoctorFindingJson[];
  findingCount: number;
  repaired: string[];
  staleBackupDays: number;
  parsedFiles: number;
  restartHints: { client: string; hint: string }[];
}

// ════════════════════════════════════════════════════════════════════
// Typed per-command wrappers (Task 1): run + envelope handling in one place,
// returning the CLI's `--json` data or one clear error string. Never throw.
// ════════════════════════════════════════════════════════════════════

/** A typed wrapper outcome: the CLI's data, or one clear failure string to render inline. */
export type CliDataResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** The low-level run seam the wrappers compose (extension.ts builds it from resolve+env+spawn). */
export type ClientsCliRunFn = (command: ClientsCliCommand) => Promise<ClientsCliResult>;

/**
 * Parse a `--json` envelope out of one invocation's stdout, tolerating the
 * CLI's trailing newline. Returns the envelope, or an error string preferring
 * the CLI's own stderr text (its own messages — what the UI renders inline).
 */
export function parseEnvelope(stdout: string, stderr: string): { ok: true; envelope: CliEnvelope } | { ok: false; error: string } {
  const trimmed = stdout.trim();
  if (trimmed !== "") {
    try {
      const parsed = JSON.parse(trimmed) as CliEnvelope;
      if (typeof parsed === "object" && parsed !== null && typeof parsed.ok === "boolean" && typeof parsed.command === "string") {
        return { ok: true, envelope: parsed };
      }
    } catch {
      // Fall through to the stderr-based error below.
    }
  }
  const detail = stderr.trim();
  return {
    ok: false,
    error: detail !== "" ? detail : "the clients CLI produced no parseable JSON output",
  };
}

/**
 * Shared envelope/exit-code mapping for the JSON commands (the exit-code
 * contract: 0 success / 1 operational failure WITH an envelope / 2 usage
 * error as plain text on stderr). Never throws.
 */
function mapJsonResult<T>(commandLabel: string, result: ClientsCliResult): CliDataResult<T> {
  if (result.spawnError !== undefined) {
    return { ok: false, error: result.spawnError };
  }
  const parsed = parseEnvelope(result.stdout, result.stderr);
  if (!parsed.ok) {
    // Exit 2 (usage) and any non-envelope failure: the stderr text IS the CLI's message.
    return { ok: false, error: `iris-mcp-clients ${commandLabel}: ${parsed.error}` };
  }
  const { envelope } = parsed;
  if (result.status !== 0 || !envelope.ok) {
    const detail =
      typeof envelope.error === "string" && envelope.error !== ""
        ? envelope.error
        : result.stderr.trim() !== ""
          ? result.stderr.trim()
          : `exit ${result.status ?? "unknown"}`;
    return { ok: false, error: `iris-mcp-clients ${commandLabel} failed: ${detail}` };
  }
  return { ok: true, data: envelope.data as T };
}

/** `detect --json` — the client roster + dispositions (AC 33.3.1). */
export async function detectClientsJson(run: ClientsCliRunFn): Promise<CliDataResult<DetectData>> {
  return mapJsonResult<DetectData>("detect", await run({ kind: "detect" }));
}

/** `status --json` — the client × iris-mcp-server matrix (AC 33.3.2). */
export async function statusMatrixJson(run: ClientsCliRunFn): Promise<CliDataResult<StatusData>> {
  return mapJsonResult<StatusData>("status", await run({ kind: "status" }));
}

/**
 * The host-available env modes, probed through the CLI's OWN mode-gating
 * surface (Task 2's Rule #47 instruction: the UI asks the CLI, never
 * re-probes the host itself). The `--help` render lists exactly the available
 * modes under "Modes available on THIS host:" — one line per mode, six-space
 * indent, the mode id padded out to its description (verified against the
 * built bin 2026-07-28). Unavailable modes are simply absent (the CLI hides
 * them); the CLI's own write-time gate stays the enforcement point.
 */
export function parseAvailableModes(helpText: string): CliEnvMode[] {
  const modes: CliEnvMode[] = [];
  const known: readonly CliEnvMode[] = ["env-reference", "explicit", "server-manager", "governance-file"];
  for (const line of helpText.split("\n")) {
    const match = /^ {6}(env-reference|explicit|server-manager|governance-file) {2,}/.exec(line);
    if (match !== null) {
      modes.push(match[1] as CliEnvMode);
    }
  }
  // env-reference and explicit are always available per the CLI contract; if
  // a skewed/truncated render lost them, treat the probe as failed-open on
  // those two (the CLI's own gate would still refuse anything genuinely
  // unavailable, with its reason rendered inline).
  for (const always of ["env-reference", "explicit"] as const) {
    if (!modes.includes(always)) modes.push(always);
  }
  return known.filter((mode) => modes.includes(mode));
}

/** The modes probe as a wrapper (`--help`, exit 0, text — never JSON). */
export async function availableModes(run: ClientsCliRunFn): Promise<CliDataResult<CliEnvMode[]>> {
  const result = await run({ kind: "modesHelp" });
  if (result.spawnError !== undefined) return { ok: false, error: result.spawnError };
  if (result.status !== 0) {
    const detail = result.stderr.trim() !== "" ? result.stderr.trim() : `exit ${result.status ?? "unknown"}`;
    return { ok: false, error: `iris-mcp-clients --help failed: ${detail}` };
  }
  return { ok: true, data: parseAvailableModes(result.stdout) };
}

export interface ApplyPlanArgs {
  client: string;
  scope: "user" | "project";
  servers: string[];
  mode: CliEnvMode;
  /** explicit mode only: typed confirmation (exactly the entry name) + stdin password. */
  confirmSecret?: string;
  passwordStdin?: string;
}

/**
 * The apply preview. Non-explicit modes return the structured `diff --json`
 * data; explicit mode returns the CLI's redacted TEXT render (the JSON diff
 * envelope would carry the literal password — the module banner).
 */
export async function diffApplyJson(
  run: ClientsCliRunFn,
  args: ApplyPlanArgs,
): Promise<CliDataResult<DiffApplyData>> {
  return mapJsonResult<DiffApplyData>("diff", await run({ kind: "diff", ...args }));
}

/** The explicit-mode preview: the CLI's own redacted text render. */
export async function diffApplyText(
  run: ClientsCliRunFn,
  args: ApplyPlanArgs,
): Promise<CliDataResult<string>> {
  const result = await run({ kind: "diff", ...args });
  if (result.spawnError !== undefined) return { ok: false, error: result.spawnError };
  if (result.status !== 0) {
    const detail = result.stderr.trim() !== "" ? result.stderr.trim() : `exit ${result.status ?? "unknown"}`;
    return { ok: false, error: `iris-mcp-clients diff failed: ${detail}` };
  }
  return { ok: true, data: result.stdout };
}

/** `apply --yes --json` — the panel's explicit-confirm button IS the confirmation (a non-TTY spawn without --yes would exit 2). */
export async function applyJson(
  run: ClientsCliRunFn,
  args: ApplyPlanArgs,
): Promise<CliDataResult<ApplyData>> {
  return mapJsonResult<ApplyData>("apply", await run({ kind: "apply", ...args }));
}

/** `enable|disable|remove --json` — one owned entry's toggle/purge. */
export async function toggleJson(
  run: ClientsCliRunFn,
  action: "enable" | "disable" | "remove",
  args: { client: string; scope: "user" | "project"; server: string },
): Promise<CliDataResult<EngineResultJson>> {
  return mapJsonResult<EngineResultJson>(action, await run({ kind: action, ...args }));
}

/** `restore --json` — roll back to the latest timestamped backup. */
export async function restoreJson(
  run: ClientsCliRunFn,
  args: { client: string; scope: "user" | "project" },
): Promise<CliDataResult<EngineResultJson>> {
  return mapJsonResult<EngineResultJson>("restore", await run({ kind: "restore", ...args }));
}

/**
 * `doctor --json` — SPECIAL outcome mapping (mirrors governancePanel's
 * `validate` special case): exit 1 with findings is a LEGITIMATE outcome (the
 * view lists them), not a load failure, and the data envelope is present on
 * BOTH outcomes. `findingsOk` distinguishes clean (exit 0) from findings
 * (exit 1); only a spawn/parse/usage failure is `ok:false`.
 */
export type DoctorResult =
  | { ok: true; findingsOk: boolean; data: DoctorData }
  | { ok: false; error: string };

export async function doctorJson(run: ClientsCliRunFn): Promise<DoctorResult> {
  const result = await run({ kind: "doctor" });
  if (result.spawnError !== undefined) return { ok: false, error: result.spawnError };
  const parsed = parseEnvelope(result.stdout, result.stderr);
  if (!parsed.ok) {
    return { ok: false, error: `iris-mcp-clients doctor: ${parsed.error}` };
  }
  const data = parsed.envelope.data as DoctorData;
  if (!Array.isArray(data?.findings) || typeof data?.findingCount !== "number") {
    return { ok: false, error: "iris-mcp-clients doctor produced an unexpected output shape" };
  }
  return { ok: true, findingsOk: result.status === 0 && parsed.envelope.ok, data };
}
