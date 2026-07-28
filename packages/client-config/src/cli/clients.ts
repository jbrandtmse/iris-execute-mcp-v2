/**
 * `iris-mcp-clients` — scriptable MCP client wiring CLI (Epic 33, Story
 * 33.2; AC 33.2.1–33.2.4 + Integration ACs 33.2-I1/I2).
 *
 * This module is argv parsing + rendering + confirmation flow ONLY (AC
 * 33.2-I1): every detect/status/diff/apply/enable/disable/remove/restore
 * drives the REAL Story 33.0/33.1 engine functions imported from the
 * package — there is no re-implemented parse/splice/serialize logic here
 * (a source-scan pin in `clients-cli.test.ts` asserts no
 * `jsonc-parser`/`smol-toml`/`yaml` import and no edit mechanics appear in
 * this file; host probing lives in the sibling `host-probes.ts` for the
 * same reason).
 *
 * **Exit codes (mirrors the governance CLI contract, AC 33.2.3).**
 * - `0` success
 * - `1` operational failure (an engine refusal, a write failure, a declined
 *   confirmation, a doctor finding)
 * - `2` usage error (unknown command/option, missing required argument, an
 *   unavailable `--mode` forced anyway, a non-TTY apply without `--yes`)
 *
 * **`--json`:** every command accepts `--json` and answers with ONE stable
 * envelope on stdout: `{ok, command, data, error?}`. Usage errors (exit 2)
 * are plain text on stderr — the flags themselves were not understood
 * (governance CLI discipline). `detect --json`'s `data` additionally carries
 * `dispositions` — the considered-but-dispositioned clients (id, displayName,
 * disposition, reason), the same rows the text render prints under "Other
 * clients:" (Story 33.3, additive). `diff --json`'s per-server `text` is
 * redacted through the same `redactPlanSecrets` gate as the text render — an
 * explicit-mode diff render carries the literal IRIS_PASSWORD and the envelope
 * must never echo it (Story 33.3 QA hardening).
 *
 * **Write discipline.** `apply` prints the pending diff FIRST and requires
 * confirmation: `--yes` skips it; an interactive TTY prompt otherwise; a
 * non-TTY invocation without `--yes` exits 2 with guidance and NEVER
 * writes. `explicit` mode's typed confirmation is `--confirm-secret
 * <entry-name>`; the literal password itself comes from `--password-stdin`
 * or a hidden TTY prompt, NEVER from argv, and is NEVER echoed (errors name
 * the field, not the value). Every successful write prints the adapter's
 * restart hint.
 *
 * **Mode gating (the 33.1 seam).** `server-manager` / `governance-file`
 * modes are host-probed (`host-probes.ts`): unavailable modes are excluded
 * from `--help`'s mode list and refused with an explanatory exit 2 when
 * forced via `--mode`.
 *
 * **Counts (AC 33.2.4).** Every count the CLI prints (clients detected,
 * servers managed, doctor findings) is derived by iterating the underlying
 * data structure — never hand-authored.
 */

import { homedir } from "node:os";
import type { Readable } from "node:stream";

import { ADAPTER_DATA_VERSION, CLIENT_ADAPTERS, CLIENT_DISPOSITIONS } from "../adapters.js";
import { detectClients } from "../detect.js";
import { diff } from "../diff.js";
import {
  apply,
  disable,
  enable,
  ensureInputs,
  presentInputIds,
  remove,
  restore,
  type EngineResult,
} from "../engine.js";
import { resolveScopePath } from "../paths.js";
import {
  diagnoseConfigSurface,
  ownEntry,
  readConfigEntries,
  type ConfigSurfaceDiagnosis,
} from "../readers.js";
import {
  findStash,
  isManagerCreated,
  readState,
  recordManaged,
  resolveStateDir,
  writeState,
  type ManagerState,
} from "../state.js";
import { buildStatusMatrix } from "../status.js";
import {
  synthesizeEntry,
  type EnvMode,
  type SynthesisProfile,
  type SynthesisResult,
} from "../synthesize.js";
import {
  CANONICAL_SERVERS,
  type AdapterPlatform,
  type CanonicalServerName,
  type ClientAdapter,
  type ClientScope,
} from "../types.js";
import { listBackups, REAL_WRITE_FS, type WriteFs } from "../write.js";
import { probeGovernanceFile, probeServerManager } from "./host-probes.js";

// ════════════════════════════════════════════════════════════════════
// CLI dependency injection — production defaults + test seams.
// ════════════════════════════════════════════════════════════════════

/** Minimal writable-stream shape the CLI writes output through. */
export interface CliOutput {
  write(chunk: string): void;
}

export interface CliDeps {
  env?: Record<string, string | undefined>;
  platform?: AdapterPlatform;
  homeDir?: string;
  projectDir?: string;
  stateDir?: string;
  stdout?: CliOutput;
  stderr?: CliOutput;
  /** Interactive-source seam: only `isTTY` is read by the command logic; the
   * default prompt implementations consume the stream itself (Rule #54 —
   * tests inject `promptConfirm`/`promptPassword` instead of faking stream
   * shapes). */
  stdin?: Readable & { isTTY?: boolean };
  fs?: WriteFs;
  now?: () => Date;
  /** Interactive yes/no confirmation (default: TTY line prompt). */
  promptConfirm?: (question: string) => Promise<boolean>;
  /** Secret acquisition (default: hidden TTY prompt / plain stdin read). */
  promptPassword?: (label: string) => Promise<string>;
}

interface ResolvedDeps {
  env: Record<string, string | undefined>;
  platform: AdapterPlatform;
  homeDir: string;
  projectDir: string | undefined;
  stateDir: string | undefined;
  stdout: CliOutput;
  stderr: CliOutput;
  stdin: (Readable & { isTTY?: boolean }) | undefined;
  fs: WriteFs;
  now: () => Date;
  promptConfirm: (question: string) => Promise<boolean>;
  promptPassword: (label: string) => Promise<string>;
}

function normalizePlatform(raw: string): AdapterPlatform {
  return raw === "win32" || raw === "darwin" ? raw : "linux";
}

function resolveDeps(deps: CliDeps): ResolvedDeps {
  const stdin = deps.stdin ?? (typeof process !== "undefined" ? process.stdin : undefined);
  return {
    env: deps.env ?? process.env,
    platform: deps.platform ?? normalizePlatform(process.platform),
    homeDir: deps.homeDir ?? homedir(),
    projectDir: deps.projectDir ?? process.cwd(),
    stateDir: deps.stateDir,
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
    stdin,
    fs: deps.fs ?? REAL_WRITE_FS,
    now: deps.now ?? (() => new Date()),
    promptConfirm: deps.promptConfirm ?? ((question: string) => defaultConfirm(question, stdin)),
    promptPassword: deps.promptPassword ?? ((label: string) => defaultPassword(label, stdin)),
  };
}

/** The engine host context for one invocation. */
function hostContext(deps: ResolvedDeps) {
  return {
    platform: deps.platform,
    env: deps.env,
    homeDir: deps.homeDir,
    ...(deps.projectDir !== undefined ? { projectDir: deps.projectDir } : {}),
    ...(deps.stateDir !== undefined ? { stateDir: deps.stateDir } : {}),
  };
}

// ════════════════════════════════════════════════════════════════════
// Interactive prompt defaults (Rule #54: real Node stream shapes only —
// code-point iteration with data/end/error listeners, the credentials
// CLI's prompt discipline).
// ════════════════════════════════════════════════════════════════════

/** Read one line (code points until \n/\r) from a stream; null on EOF/error before any terminator. */
function readLine(stream: Readable): Promise<string | null> {
  return new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
      if (typeof (stream as { pause?: () => void }).pause === "function") stream.pause();
      resolve(value);
    };
    const onData = (chunk: unknown) => {
      for (const ch of String(chunk)) {
        if (ch === "\n" || ch === "\r") {
          finish(buffer);
          return;
        }
        buffer += ch;
      }
    };
    const onEnd = () => finish(buffer === "" ? null : buffer);
    const onError = () => finish(null);
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
    if (typeof (stream as { resume?: () => void }).resume === "function") stream.resume();
  });
}

/** Default yes/no confirmation: a TTY line prompt; y/yes (case-insensitive) confirms. */
async function defaultConfirm(
  question: string,
  stdin: (Readable & { isTTY?: boolean }) | undefined,
): Promise<boolean> {
  if (stdin === undefined || stdin.isTTY !== true) return false;
  process.stderr.write(`${question} [y/N] `);
  const answer = await readLine(stdin);
  return answer !== null && /^y(es)?$/i.test(answer.trim());
}

/** Read ALL of a stream (for --password-stdin); null on error. */
function readAll(stream: Readable): Promise<string | null> {
  return new Promise((resolve) => {
    let buffer = "";
    stream.on("data", (chunk: unknown) => {
      buffer += String(chunk);
    });
    stream.on("end", () => resolve(buffer));
    stream.on("error", () => resolve(null));
    if (typeof (stream as { resume?: () => void }).resume === "function") stream.resume();
  });
}

/**
 * Default secret prompt: hidden raw-mode read on a TTY (echo suppressed,
 * backspace handled, Ctrl+C aborts), a plain line read otherwise. Never
 * resolves with the empty string on EOF — the caller treats empty as a
 * usage failure (the credentials CLI's silent-zero-exit lesson).
 */
async function defaultPassword(
  label: string,
  stdin: (Readable & { isTTY?: boolean }) | undefined,
): Promise<string> {
  if (stdin === undefined) return "";
  process.stderr.write(`${label}: `);
  if (stdin.isTTY !== true) {
    const line = await readLine(stdin);
    return line ?? "";
  }
  const tty = stdin as Readable & { setRawMode?: (mode: boolean) => void };
  return new Promise((resolve) => {
    let buffer = "";
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      tty.removeListener("data", onData);
      tty.removeListener("end", onEnd);
      tty.removeListener("error", onError);
      tty.setRawMode?.(false);
      if (typeof (tty as { pause?: () => void }).pause === "function") tty.pause();
      process.stderr.write("\n");
      resolve(value);
    };
    const onData = (chunk: unknown) => {
      for (const ch of String(chunk)) {
        if (ch === "\n" || ch === "\r") {
          finish(buffer);
          return;
        }
        if (ch === "\u0003") {
          finish("");
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += ch;
      }
    };
    const onEnd = () => finish(buffer);
    const onError = () => finish(buffer);
    tty.setRawMode?.(true);
    tty.on("data", onData);
    tty.on("end", onEnd);
    tty.on("error", onError);
    if (typeof (tty as { resume?: () => void }).resume === "function") tty.resume();
  });
}

// ════════════════════════════════════════════════════════════════════
// argv parsing — boolean flags + valued options, mirroring the governance
// CLI's no-framework manual style (`--` terminator included).
// ════════════════════════════════════════════════════════════════════

interface ParsedArgs {
  positional: string[];
  flags: Set<string>;
  options: Map<string, string>;
  error?: string;
}

/**
 * Every CLI option that takes a VALUE (as opposed to a boolean flag), as one
 * single-sourced set (the 32-4-R1 lesson, applied from day one): the
 * `helpRequested` pre-scan consumes exactly this set, and a source-scan test
 * in `clients-cli.test.ts` mechanically cross-checks every `parseArgs` call
 * site's options against it.
 */
export const VALUED_OPTIONS: ReadonlySet<string> = new Set([
  "--client",
  "--servers",
  "--server",
  "--scope",
  "--mode",
  "--host",
  "--port",
  "--username",
  "--namespace",
  "--sm-servers",
  "--governance-file",
  "--backup",
  "--confirm-secret",
]);

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

/**
 * Help is honored only where the argv grammar puts it in OPTION position
 * (32-1-R4): mirrors `parseArgs`' state machine — the `--` terminator ends
 * option scanning, and the token following a valued option is its value,
 * never a flag.
 */
function helpRequested(args: string[]): boolean {
  const valuedOptions = VALUED_OPTIONS; // single-sourced (32-4-R1) — see the constant's doc comment
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

// ════════════════════════════════════════════════════════════════════
// Shared helpers.
// ════════════════════════════════════════════════════════════════════

/** Write the stable `--json` envelope (AC 33.2.3): {ok, command, data, error?}. */
function emitJson(
  deps: ResolvedDeps,
  command: string,
  ok: boolean,
  data: unknown,
  error?: string,
): void {
  deps.stdout.write(
    `${JSON.stringify({ ok, command, data, ...(error !== undefined ? { error } : {}) })}\n`,
  );
}

const ALL_MODES: readonly EnvMode[] = ["env-reference", "explicit", "server-manager", "governance-file"];

/** Mode availability on THIS host (the 33.1 seam's host probes). */
function modeAvailability(
  deps: ResolvedDeps,
  governanceFileFlag: string | undefined,
): { available: EnvMode[]; reasons: Record<EnvMode, string> } {
  const sm = probeServerManager({
    env: deps.env,
    platform: deps.platform,
    homeDir: deps.homeDir,
    ...(deps.projectDir !== undefined ? { projectDir: deps.projectDir } : {}),
    fs: deps.fs,
  });
  const gf = probeGovernanceFile(
    { env: deps.env, platform: deps.platform, homeDir: deps.homeDir, fs: deps.fs },
    governanceFileFlag,
  );
  const reasons: Record<EnvMode, string> = {
    "env-reference": "always available",
    explicit: "always available",
    "server-manager": sm.reason,
    "governance-file": gf.reason,
  };
  const available: EnvMode[] = ["env-reference", "explicit"];
  if (sm.available) available.push("server-manager");
  if (gf.available) available.push("governance-file");
  return { available, reasons };
}

function buildHelpText(modes: { available: EnvMode[]; reasons: Record<EnvMode, string> }): string {
  const modeLines: string[] = [];
  const describe: Record<EnvMode, string> = {
    "env-reference": "${VAR} / ${env:VAR} references (VS Code: native inputs for the password)",
    explicit: "literal values; a literal IRIS_PASSWORD needs --confirm-secret <entry-name>",
    "server-manager": "IRIS_SERVER_MANAGER=auto — connections from Server Manager profiles",
    "governance-file": "IRIS_GOVERNANCE_FILE=<path> — governance from a shared file",
  };
  for (const mode of ALL_MODES) {
    if (modes.available.includes(mode)) {
      modeLines.push(`      ${mode.padEnd(16)} ${describe[mode]}`);
    }
  }
  const hiddenCount = ALL_MODES.length - modes.available.length;
  const hiddenNote =
    hiddenCount > 0
      ? `      (${hiddenCount} mode(s) unavailable on this host are hidden; run with the host probe satisfied —\n` +
        `      server-manager: ${modes.reasons["server-manager"]}\n` +
        `      governance-file: ${modes.reasons["governance-file"]})\n`
      : "";
  return `iris-mcp-clients — wire the iris-mcp servers into any supported MCP client

Usage: iris-mcp-clients <command> [options]

Commands:
  detect [--json]
      Probe which MCP clients are installed (config files + app dirs), with
      resolved paths, plus the considered-but-dispositioned clients.
  status [--json]
      The client x iris-mcp-server matrix (present-enabled/present-disabled/
      absent/unparseable). Foreign third-party entries are listed NAMES ONLY.
  diff --client <id> --servers <list> [--scope user|project] [--mode <mode>] [--json]
      Render the pending edits a hypothetical apply would make. Writes NOTHING.
  apply --client <id> --servers <list> [--scope user|project] [--mode <mode>] [--yes] [--json]
      Write (add or update) entries after a diff preview + confirmation
      (--yes skips the prompt; a non-TTY invocation without --yes refuses).
  enable --client <id> --server <name> [--scope user|project] [--json]
  disable --client <id> --server <name> [--scope user|project] [--json]
      Toggle one owned entry (native flag or manager stash).
  remove --client <id> --server <name> [--scope user|project] [--json]
      Purge one owned entry (plus its stash/ownership records).
  restore --client <id> [--scope user|project] [--backup <name>] [--json]
      Restore the latest (or a named) timestamped backup of the config file.
  doctor [--json] [--repair --yes-i-mean-it]
      Diagnose: env-reference resolvability, file parseability, config-surface
      drift (a parseable file whose root key fails the adapter's shape
      expectations), stale backups, orphaned stashes, and present
      non-canonical entries that fail ownership (re-recorded manager-created
      by --repair --yes-i-mean-it).

Options:
  --client <id>         Client id (see "detect" for the roster).
  --servers <list>      Comma-separated canonical server names, or "all":
                        ${CANONICAL_SERVERS.join(", ")}.
  --server <name>       One entry name (enable/disable/remove).
  --scope user|project  Config scope (default: user).
  --mode <mode>         Entry synthesis mode (default: env-reference). Modes
                        available on THIS host:
${modeLines.join("\n")}
${hiddenNote}  --host <host>          Connection literal (env-reference on no-expansion
                        clients, governance-file, explicit).
  --port <port>         Connection literal port.
  --username <name>     Connection literal username.
  --namespace <ns>      Connection literal namespace.
  --https               Connection literal https=true.
  --sm-servers <csv>    server-manager mode: IRIS_SM_SERVERS allow-list
                        (default "default").
  --governance-file <p> governance-file mode: the IRIS_GOVERNANCE_FILE path
                        (wins over the environment variable).
  --password-stdin      explicit mode: read the literal IRIS_PASSWORD from
                        stdin (NEVER pass a password as an argv value).
  --confirm-secret <n>  explicit mode: typed confirmation, exactly the entry
                        name, before any literal password is written.
  --backup <name>       restore: a specific backup basename.
  --yes                 apply: skip the interactive confirmation.
  --repair              doctor: re-record orphaned manager-created entries.
  --yes-i-mean-it       doctor --repair: the typed confirmation (required).
  --json                Machine-readable output: one {ok, command, data,
                        error?} envelope on stdout.
  -h, --help            Show this help and exit.
  --                    End of options: every later argument is positional.

Exit codes:
  0   success
  1   operational failure (engine refusal, write failure, declined
      confirmation, doctor finding)
  2   usage error (unknown command/option, missing argument, unavailable
      mode forced, non-TTY apply without --yes)

Every successful write prints the client's restart hint. Backups live under
~/.iris-mcp/client-manager/backups/<client>/<scope>/; state.json there is
the manager's ownership/stash ledger.
`;
}

// ════════════════════════════════════════════════════════════════════
// Shared argument validation.
// ════════════════════════════════════════════════════════════════════

function adapterFor(client: string | undefined): ClientAdapter | { error: string } {
  if (client === undefined || client === "") {
    return { error: `a --client <id> is required (known clients: ${Object.keys(CLIENT_ADAPTERS).join(", ")})` };
  }
  const adapter = CLIENT_ADAPTERS[client];
  if (!adapter) {
    return { error: `unknown client "${client}" (known clients: ${Object.keys(CLIENT_ADAPTERS).join(", ")})` };
  }
  return adapter;
}

function scopeFor(raw: string | undefined): ClientScope | { error: string } {
  if (raw === undefined) return "user";
  if (raw === "user" || raw === "project") return raw;
  return { error: `invalid --scope "${raw}" (expected: user, project)` };
}

function serversFor(raw: string | undefined): CanonicalServerName[] | { error: string } {
  if (raw === undefined || raw === "") {
    return { error: `--servers <list> is required (comma-separated canonical names, or "all")` };
  }
  const names = raw === "all" ? [...CANONICAL_SERVERS] : raw.split(",").map((name) => name.trim());
  const out: CanonicalServerName[] = [];
  for (const name of names) {
    if (!(CANONICAL_SERVERS as readonly string[]).includes(name)) {
      return { error: `unknown server "${name}" (canonical servers: ${CANONICAL_SERVERS.join(", ")}, or "all")` };
    }
    const canonical = name as CanonicalServerName;
    if (!out.includes(canonical)) out.push(canonical);
  }
  return out;
}

function usageError(deps: ResolvedDeps, message: string, usage: string): number {
  deps.stderr.write(`Error: ${message}\n\nUsage: ${usage}\n`);
  return 2;
}

/** Type guard for the `{error}` failure half of the small validator unions
 * (needed because `ClientScope` is a string union — `"error" in x` only
 * narrows object types). */
function isFailure(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value;
}

// ════════════════════════════════════════════════════════════════════
// detect (AC 33.2.1, counts per AC 33.2.4)
// ════════════════════════════════════════════════════════════════════

const DETECT_USAGE = "iris-mcp-clients detect [--json]";

async function cmdDetect(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, ["--json"], []);
  if (parsed.error) return usageError(deps, parsed.error, DETECT_USAGE);
  if (parsed.positional.length !== 0) return usageError(deps, `"detect" takes no arguments.`, DETECT_USAGE);
  const wantJson = parsed.flags.has("--json");

  const report = detectClients(hostContext(deps), deps.fs);
  // AC 33.2.4: every count is derived by iterating the report/dispositions.
  const detectedClients = report.clients.filter((client) => client.detected);
  const undetectedClients = report.clients.filter((client) => !client.detected);
  const counts = {
    probed: report.clients.length,
    detected: detectedClients.length,
    notDetected: undetectedClients.length,
    dispositioned: CLIENT_DISPOSITIONS.length,
  };

  if (wantJson) {
    // Story 33.3 (sanctioned additive, lead Option-1 decision 2026-07-28):
    // the envelope carries the dispositions too — the SAME CLIENT_DISPOSITIONS
    // rows the text render prints under "Other clients:" — so JSON consumers
    // (the extension's MCP Clients view) never scrape the text render.
    emitJson(deps, "detect", true, { ...report, dispositions: CLIENT_DISPOSITIONS, counts });
    return 0;
  }

  deps.stdout.write(`Client detection (adapter data ${report.adapterDataVersion}):\n\n`);
  for (const client of report.clients) {
    deps.stdout.write(`  ${client.displayName} (${client.client}) — ${client.detected ? "detected" : "not detected"}\n`);
    if (client.detected) {
      for (const probe of client.probes) {
        const label = probe.kind === "config" ? `config ${probe.scope ?? ""}`.trim() : "appDir";
        deps.stdout.write(`      ${label}: ${probe.path} (${probe.exists ? "exists" : "missing"})\n`);
      }
    }
  }
  if (CLIENT_DISPOSITIONS.length > 0) {
    deps.stdout.write(`\nOther clients:\n`);
    for (const disposition of CLIENT_DISPOSITIONS) {
      deps.stdout.write(
        `  ${disposition.displayName} (${disposition.id}) — ${disposition.disposition}: ${disposition.reason}\n`,
      );
    }
  }
  deps.stdout.write(
    `\n${counts.detected} of ${counts.probed} clients detected; ${counts.notDetected} not detected; ` +
      `${counts.dispositioned} other dispositions.\n`,
  );
  return 0;
}

// ════════════════════════════════════════════════════════════════════
// status (AC 33.2.1, counts per AC 33.2.4)
// ════════════════════════════════════════════════════════════════════

const STATUS_USAGE = "iris-mcp-clients status [--json]";

async function cmdStatus(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, ["--json"], []);
  if (parsed.error) return usageError(deps, parsed.error, STATUS_USAGE);
  if (parsed.positional.length !== 0) return usageError(deps, `"status" takes no arguments.`, STATUS_USAGE);
  const wantJson = parsed.flags.has("--json");

  const report = buildStatusMatrix(hostContext(deps), deps.fs);
  // AC 33.2.4: managed-server count derived by iterating the matrix.
  let managedPresent = 0;
  for (const client of report.clients) {
    for (const scope of client.scopes) {
      for (const server of scope.servers) {
        if (server.state !== "absent") managedPresent++;
      }
    }
  }
  const counts = {
    detected: report.clients.length,
    undetected: report.undetected.length,
    managedEntries: managedPresent,
  };

  if (wantJson) {
    emitJson(deps, "status", true, { ...report, counts });
    return 0;
  }

  deps.stdout.write(`Client x iris-mcp-server status (adapter data ${report.adapterDataVersion}):\n\n`);
  for (const client of report.clients) {
    deps.stdout.write(`  ${client.displayName} (${client.client}):\n`);
    for (const scope of client.scopes) {
      if (scope.file === "unresolved") {
        deps.stdout.write(`    ${scope.scope}: unresolved (a project scope needs a project directory)\n`);
        continue;
      }
      if (scope.file === "missing") {
        deps.stdout.write(`    ${scope.scope}: ${scope.path ?? "(no path)"} (no config file)\n`);
        continue;
      }
      if (scope.file === "unparseable") {
        deps.stdout.write(`    ${scope.scope}: ${scope.path ?? "(no path)"} UNPARSEABLE — ${scope.error ?? "unknown"}\n`);
        continue;
      }
      deps.stdout.write(`    ${scope.scope}: ${scope.path ?? "(no path)"}\n`);
      for (const server of scope.servers) {
        deps.stdout.write(`      ${server.server.padEnd(18)} ${server.state}\n`);
      }
      if (scope.foreign.length > 0) {
        deps.stdout.write(`      foreign (names only): ${scope.foreign.join(", ")}\n`);
      }
    }
  }
  if (report.undetected.length > 0) {
    deps.stdout.write(
      `\nNot detected (${report.undetected.length}): ${report.undetected.map((client) => client.client).join(", ")}\n`,
    );
  }
  deps.stdout.write(
    `\n${counts.detected} clients detected; ${counts.managedEntries} managed server entries present.\n`,
  );
  return 0;
}

// ════════════════════════════════════════════════════════════════════
// Synthesis helpers shared by diff/apply.
// ════════════════════════════════════════════════════════════════════

const SYNTH_OPTIONS = [
  "--client",
  "--servers",
  "--scope",
  "--mode",
  "--host",
  "--port",
  "--username",
  "--namespace",
  "--sm-servers",
  "--governance-file",
  "--confirm-secret",
] as const;

function buildProfile(parsed: ParsedArgs): SynthesisProfile | { error: string } {
  const profile: SynthesisProfile = {};
  const host = parsed.options.get("--host");
  if (host !== undefined) profile.host = host;
  const rawPort = parsed.options.get("--port");
  if (rawPort !== undefined) {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return { error: `invalid --port "${rawPort}" (expected an integer 1-65535)` };
    }
    profile.port = port;
  }
  const username = parsed.options.get("--username");
  if (username !== undefined) profile.username = username;
  const namespace = parsed.options.get("--namespace");
  if (namespace !== undefined) profile.namespace = namespace;
  if (parsed.flags.has("--https")) profile.https = true;
  const smServers = parsed.options.get("--sm-servers");
  if (smServers !== undefined) profile.serverManagerNames = smServers;
  const governanceFile = parsed.options.get("--governance-file");
  if (governanceFile !== undefined) profile.governanceFile = governanceFile;
  return profile;
}

/** Acquire the explicit-mode password: --password-stdin, else a hidden TTY
 * prompt, else a usage failure. The VALUE never appears in any output. */
async function acquirePassword(parsed: ParsedArgs, deps: ResolvedDeps): Promise<{ password: string } | { error: string }> {
  if (parsed.flags.has("--password-stdin")) {
    if (deps.stdin === undefined) return { error: "--password-stdin needs a stdin stream" };
    const all = await readAll(deps.stdin);
    const line = all === null ? "" : (all.split(/\r?\n/, 1)[0] ?? "");
    if (line === "") {
      return { error: "explicit mode needs a literal IRIS_PASSWORD: --password-stdin read an empty stdin" };
    }
    return { password: line };
  }
  if (deps.stdin !== undefined && deps.stdin.isTTY === true) {
    const password = await deps.promptPassword("IRIS_PASSWORD (input hidden)");
    if (password === "") {
      return { error: "explicit mode needs a literal IRIS_PASSWORD (empty input)" };
    }
    return { password };
  }
  return {
    error:
      "explicit mode needs a literal IRIS_PASSWORD: re-run with --password-stdin (non-interactive) " +
      "or on a TTY for the hidden prompt",
  };
}

/** The env var names doctor verifies for no-expansion clients. Restricted to
 * the two the runtime genuinely REQUIRES (`loadConfig` throws without them):
 * IRIS_HOST/IRIS_PORT/IRIS_NAMESPACE/IRIS_HTTPS all have runtime defaults
 * (localhost/52773/HSCUSTOM/false), so flagging their absence was a false
 * finding on a healthy config — and contradicted the engine's own
 * doctorNote, which names only IRIS_PASSWORD after a profile-literal apply
 * (33.2 review, probe-verified on cursor). */
const CONNECTION_VARS = ["IRIS_USERNAME", "IRIS_PASSWORD"] as const;

// ════════════════════════════════════════════════════════════════════
// diff + apply (AC 33.2.1, AC 33.2.3)
// ════════════════════════════════════════════════════════════════════

interface SynthPlan {
  server: CanonicalServerName;
  synthesis: Extract<SynthesisResult, { ok: true }>;
  diffText: string;
  mechanism: string;
  /** VS Code env-reference: input descriptors missing from the file. */
  missingInputIds: string[];
}

/** Synthesize + render the pending edit per server (NO writes). Returns the
 * plans, or an exit code to propagate (a message has been printed). */
async function planApply(
  parsed: ParsedArgs,
  deps: ResolvedDeps,
  usage: string,
  adapter: ClientAdapter,
  scope: ClientScope,
  servers: CanonicalServerName[],
  mode: EnvMode,
  profile: SynthesisProfile,
): Promise<{ plans: SynthPlan[] } | { exit: number }> {
  const plans: SynthPlan[] = [];
  const path = resolveScopePath(adapter, scope, hostContext(deps), (p) => deps.fs.exists(p));
  if (path === null) {
    return { exit: usageError(deps, `cannot resolve a ${scope}-scope config path for ${adapter.id} (project scope needs to run from a project directory)`, usage) };
  }
  let content: string | null = null;
  try {
    content = deps.fs.exists(path) ? deps.fs.readFile(path) : null;
  } catch (err) {
    deps.stderr.write(`Error: could not read ${path}: ${err instanceof Error ? err.message : String(err)}\n`);
    return { exit: 1 };
  }
  const inputIds = content === null ? { ok: true as const, ids: [] as string[] } : presentInputIds(content);

  for (const server of servers) {
    const synthesis = synthesizeEntry(server, mode, {
      adapter,
      profile,
      ...(parsed.options.get("--confirm-secret") !== undefined
        ? { confirm: parsed.options.get("--confirm-secret") as string }
        : {}),
    });
    if (!synthesis.ok) {
      return { exit: usageError(deps, synthesis.reason, usage) };
    }
    const rendered = diff(content, synthesis.entry, adapter, scope, "apply");
    if (!rendered.ok) {
      deps.stderr.write(`Error: ${rendered.reason}\n`);
      return { exit: 1 };
    }
    const missingInputIds =
      synthesis.inputs !== undefined && inputIds.ok
        ? synthesis.inputs.filter((input) => !inputIds.ids.includes(input.id)).map((input) => input.id)
        : [];
    plans.push({
      server,
      synthesis,
      diffText: rendered.text,
      mechanism: rendered.mechanism,
      missingInputIds,
    });
  }
  return { plans };
}

function printApplyPreview(deps: ResolvedDeps, adapter: ClientAdapter, scope: ClientScope, mode: EnvMode, plans: SynthPlan[]): void {
  deps.stdout.write(`Pending changes for ${adapter.displayName} (${adapter.id}), ${scope} scope, mode ${mode}:\n\n`);
  for (const plan of plans) {
    deps.stdout.write(`  --- ${plan.server} (${plan.mechanism}) ---\n`);
    deps.stdout.write(
      redactPlanSecrets(plan)
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n") + "\n",
    );
    for (const id of plan.missingInputIds) {
      deps.stdout.write(`  + top-level inputs[] descriptor "${id}" (promptString, password) will be merged\n`);
    }
    deps.stdout.write("\n");
  }
  if (plans.some((plan) => plan.synthesis.doctorNote !== undefined)) {
    for (const plan of plans) {
      if (plan.synthesis.doctorNote !== undefined) deps.stdout.write(`Note (${plan.server}): ${plan.synthesis.doctorNote}\n`);
    }
  }
}

/**
 * The minimum secret length for exact-match redaction (the 32.3 discipline):
 * below it an exact replace could corrupt unrelated text (a 1-char "password"
 * would mangle every occurrence of that letter), so the render is withheld
 * ENTIRELY instead. Anything at or above it is replaced wherever it appears.
 */
const SECRET_MIN_REDACTION_LENGTH = 8;

/**
 * Redact a contains-secret plan's password from its diff render. A
 * contains-secret entry's render carries the literal IRIS_PASSWORD — the
 * preview (stdout, or stderr under --json) must NEVER echo it (the same
 * discipline as the credentials CLI's error surfaces). The synthesis result
 * is the source of truth for what the secret IS; the render is only ever
 * printed through this function.
 *
 * Two withholding gates (33.2 review, both probe-verified against the built
 * dist):
 *
 * 1. **Length gate** — below {@link SECRET_MIN_REDACTION_LENGTH} an exact
 *    replace could corrupt unrelated prose, so the render is withheld.
 * 2. **Verbatim gate** — the render is a SERIALIZED form of the entry
 *    (JSON.stringify for jsonc, TOML/YAML escaping for the others), so a
 *    secret containing characters the serializer escapes (`"`, `\`, control
 *    chars, some YAML cases) does NOT appear verbatim: an exact-raw replace
 *    would find nothing and the escaped secret would print in the clear.
 *    When the raw secret is not a verbatim substring of the render, the
 *    render is withheld rather than partially redacted.
 */
function redactPlanSecrets(plan: SynthPlan): string {
  if (!plan.synthesis.containsSecret) return plan.diffText;
  const secret = plan.synthesis.entry.env?.IRIS_PASSWORD;
  if (secret === undefined) return plan.diffText;
  const withheld =
    `(render withheld — the entry carries a literal IRIS_PASSWORD that cannot be safely masked; ` +
    `the value is never echoed)`;
  if (secret.length < SECRET_MIN_REDACTION_LENGTH) {
    return `(render withheld — the entry carries a literal IRIS_PASSWORD shorter than ${SECRET_MIN_REDACTION_LENGTH} characters; the value is never echoed)`;
  }
  if (!plan.diffText.includes(secret)) {
    return withheld;
  }
  return plan.diffText.split(secret).join("********");
}

const DIFF_USAGE =
  "iris-mcp-clients diff --client <id> --servers <list> [--scope user|project] [--mode <mode>] [--json]";

async function cmdDiff(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, ["--json", "--https", "--password-stdin"], [...SYNTH_OPTIONS]);
  if (parsed.error) return usageError(deps, parsed.error, DIFF_USAGE);
  if (parsed.positional.length !== 0) return usageError(deps, `"diff" takes no positional arguments.`, DIFF_USAGE);
  const wantJson = parsed.flags.has("--json");

  const adapter = adapterFor(parsed.options.get("--client"));
  if ("error" in adapter) return usageError(deps, adapter.error, DIFF_USAGE);
  const scope = scopeFor(parsed.options.get("--scope"));
  if (isFailure(scope)) return usageError(deps, scope.error, DIFF_USAGE);
  const servers = serversFor(parsed.options.get("--servers"));
  if ("error" in servers) return usageError(deps, servers.error, DIFF_USAGE);
  const profile = buildProfile(parsed);
  if ("error" in profile) return usageError(deps, profile.error, DIFF_USAGE);
  const rawMode = parsed.options.get("--mode") ?? "env-reference";
  const modes = modeAvailability(deps, parsed.options.get("--governance-file"));
  if (!(ALL_MODES as readonly string[]).includes(rawMode)) {
    return usageError(deps, `unknown --mode "${rawMode}" (modes: ${ALL_MODES.join(", ")})`, DIFF_USAGE);
  }
  const mode = rawMode as EnvMode;
  if (!modes.available.includes(mode)) {
    return usageError(deps, `mode "${mode}" is not available on this host: ${modes.reasons[mode]}`, DIFF_USAGE);
  }
  if (mode === "explicit" && parsed.options.get("--confirm-secret") === undefined) {
    return usageError(
      deps,
      `explicit mode writes a literal IRIS_PASSWORD; pass --confirm-secret <entry-name> (exactly the entry name) to proceed`,
      DIFF_USAGE,
    );
  }
  // governance-file mode: the env variable is the default path source (the
  // --governance-file flag wins when present — the probe's own precedence).
  if (mode === "governance-file" && profile.governanceFile === undefined) {
    const envPath = deps.env.IRIS_GOVERNANCE_FILE;
    if (envPath !== undefined && envPath !== "") profile.governanceFile = envPath;
  }
  // explicit mode: the hypothetical entry carries the same literal password
  // an apply would write, so it is acquired exactly as apply does — from
  // --password-stdin or a hidden prompt, never argv, never echoed (33.2
  // review: without this the command/mode combination could never succeed
  // and --password-stdin was accepted but ignored).
  if (mode === "explicit") {
    const acquired = await acquirePassword(parsed, deps);
    if ("error" in acquired) return usageError(deps, acquired.error, DIFF_USAGE);
    profile.password = acquired.password;
  }

  const planned = await planApply(parsed, deps, DIFF_USAGE, adapter, scope, servers, mode, profile);
  if ("exit" in planned) {
    if (wantJson) emitJson(deps, "diff", false, null, `see stderr (exit ${planned.exit})`);
    return planned.exit;
  }
  const { plans } = planned;

  if (wantJson) {
    emitJson(deps, "diff", true, {
      client: adapter.id,
      scope,
      mode,
      servers: plans.map((plan) => ({
        server: plan.server,
        mechanism: plan.mechanism,
        // The envelope gets the SAME redaction as the text render — an
        // explicit-mode diffText carries the literal IRIS_PASSWORD (QA 33.3:
        // the JSON path previously emitted it raw).
        text: redactPlanSecrets(plan),
        missingInputIds: plan.missingInputIds,
      })),
    });
    return 0;
  }
  printApplyPreview(deps, adapter, scope, mode, plans);
  deps.stdout.write(`(diff only — nothing was written)\n`);
  return 0;
}

const APPLY_USAGE =
  "iris-mcp-clients apply --client <id> --servers <list> [--scope user|project] [--mode <mode>] [--yes] [--json]";

async function cmdApply(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, ["--json", "--yes", "--https", "--password-stdin"], [...SYNTH_OPTIONS]);
  if (parsed.error) return usageError(deps, parsed.error, APPLY_USAGE);
  if (parsed.positional.length !== 0) return usageError(deps, `"apply" takes no positional arguments.`, APPLY_USAGE);
  const wantJson = parsed.flags.has("--json");

  const adapter = adapterFor(parsed.options.get("--client"));
  if ("error" in adapter) return usageError(deps, adapter.error, APPLY_USAGE);
  const scope = scopeFor(parsed.options.get("--scope"));
  if (isFailure(scope)) return usageError(deps, scope.error, APPLY_USAGE);
  const servers = serversFor(parsed.options.get("--servers"));
  if ("error" in servers) return usageError(deps, servers.error, APPLY_USAGE);
  const profile = buildProfile(parsed);
  if ("error" in profile) return usageError(deps, profile.error, APPLY_USAGE);
  const rawMode = parsed.options.get("--mode") ?? "env-reference";
  const modes = modeAvailability(deps, parsed.options.get("--governance-file"));
  if (!(ALL_MODES as readonly string[]).includes(rawMode)) {
    return usageError(deps, `unknown --mode "${rawMode}" (modes: ${ALL_MODES.join(", ")})`, APPLY_USAGE);
  }
  const mode = rawMode as EnvMode;
  if (!modes.available.includes(mode)) {
    return usageError(deps, `mode "${mode}" is not available on this host: ${modes.reasons[mode]}`, APPLY_USAGE);
  }

  // governance-file mode: the env variable is the default path source (the
  // --governance-file flag wins when present — the probe's own precedence).
  if (mode === "governance-file" && profile.governanceFile === undefined) {
    const envPath = deps.env.IRIS_GOVERNANCE_FILE;
    if (envPath !== undefined && envPath !== "") profile.governanceFile = envPath;
  }

  // explicit mode: the password is acquired BEFORE anything is written, from
  // stdin or a hidden prompt — never argv, never echoed.
  if (mode === "explicit") {
    if (parsed.options.get("--confirm-secret") === undefined) {
      return usageError(
        deps,
        `explicit mode writes a literal IRIS_PASSWORD; pass --confirm-secret <entry-name> (exactly the entry name) to proceed`,
        APPLY_USAGE,
      );
    }
    const acquired = await acquirePassword(parsed, deps);
    if ("error" in acquired) return usageError(deps, acquired.error, APPLY_USAGE);
    profile.password = acquired.password;
  }

  const planned = await planApply(parsed, deps, APPLY_USAGE, adapter, scope, servers, mode, profile);
  if ("exit" in planned) {
    if (wantJson) emitJson(deps, "apply", false, null, `see stderr (exit ${planned.exit})`);
    return planned.exit;
  }
  const { plans } = planned;

  // Diff preview FIRST (stdout, or stderr under --json so stdout stays one
  // parseable envelope), then confirmation.
  if (wantJson) {
    const preview = plans
      .map((plan) => `--- ${plan.server} (${plan.mechanism}) ---\n${redactPlanSecrets(plan)}`)
      .join("\n\n");
    deps.stderr.write(`Pending changes for ${adapter.id} (${scope}, ${mode}):\n${preview}\n`);
  } else {
    printApplyPreview(deps, adapter, scope, mode, plans);
  }

  const wantsWrite = plans.some((plan) => plan.mechanism !== "already-in-state" || plan.missingInputIds.length > 0);
  if (wantsWrite && !parsed.flags.has("--yes")) {
    if (deps.stdin === undefined || deps.stdin.isTTY !== true) {
      return usageError(
        deps,
        `apply needs confirmation before writing and this is not an interactive terminal; re-run with --yes to accept the previewed changes`,
        APPLY_USAGE,
      );
    }
    const confirmed = await deps.promptConfirm(`Apply these changes to ${adapter.displayName}?`);
    if (!confirmed) {
      deps.stderr.write(`Aborted; no changes were written.\n`);
      if (wantJson) emitJson(deps, "apply", false, null, "confirmation declined");
      return 1;
    }
  }

  const ctx = hostContext(deps);
  const results: EngineResult[] = [];
  const inputsMerged: string[] = [];
  for (const plan of plans) {
    const result = apply(ctx, adapter.id, scope, plan.synthesis.entry, {
      fs: deps.fs,
      now: deps.now,
      containsSecret: plan.synthesis.containsSecret,
    });
    if (!result.ok) {
      const appliedSoFar = results.filter((r) => r.ok && r.changed).map((r) => r.path ?? "");
      deps.stderr.write(
        `Error: ${result.reason ?? "apply failed"}\n` +
          (appliedSoFar.length > 0 ? `${appliedSoFar.length} server(s) were already applied before this failure.\n` : ""),
      );
      if (wantJson) emitJson(deps, "apply", false, { results }, result.reason ?? "apply failed");
      return 1;
    }
    results.push(result);
    if (plan.synthesis.inputs !== undefined && plan.synthesis.inputs.length > 0) {
      const merged = ensureInputs(ctx, adapter.id, scope, plan.synthesis.inputs, { fs: deps.fs, now: deps.now });
      if (!merged.ok) {
        deps.stderr.write(`Error: the entry was written but merging the native inputs failed: ${merged.reason ?? "unknown"}\n`);
        if (wantJson) emitJson(deps, "apply", false, { results }, merged.reason ?? "inputs merge failed");
        return 1;
      }
      inputsMerged.push(...merged.added);
    }
  }

  const changedCount = results.filter((result) => result.changed).length;
  if (wantJson) {
    emitJson(deps, "apply", true, {
      client: adapter.id,
      scope,
      mode,
      changed: changedCount,
      inputsMerged,
      results,
      restartHint: adapter.restartHint,
    });
  } else {
    for (let i = 0; i < results.length; i++) {
      const result = results[i] as EngineResult;
      const server = (plans[i] as SynthPlan).server;
      if (result.changed) {
        deps.stdout.write(`applied ${server} -> ${result.path ?? "(unknown path)"}\n`);
      } else {
        deps.stdout.write(`${server}: ${result.note ?? "already in the requested state"}\n`);
      }
    }
    if (inputsMerged.length > 0) {
      deps.stdout.write(`merged native inputs descriptor(s): ${inputsMerged.join(", ")}\n`);
    }
    deps.stdout.write(`${changedCount} of ${results.length} entries changed.\n`);
    deps.stdout.write(`Restart: ${adapter.restartHint}\n`);
  }
  return 0;
}

// ════════════════════════════════════════════════════════════════════
// enable / disable / remove / restore (AC 33.2.1, AC 33.2.3)
// ════════════════════════════════════════════════════════════════════

async function cmdToggle(
  action: "enable" | "disable" | "remove",
  args: string[],
  deps: ResolvedDeps,
): Promise<number> {
  const usage = `iris-mcp-clients ${action} --client <id> --server <name> [--scope user|project] [--json]`;
  const parsed = parseArgs(args, ["--json"], ["--client", "--server", "--scope"]);
  if (parsed.error) return usageError(deps, parsed.error, usage);
  if (parsed.positional.length !== 0) return usageError(deps, `"${action}" takes no positional arguments.`, usage);
  const wantJson = parsed.flags.has("--json");

  const adapter = adapterFor(parsed.options.get("--client"));
  if ("error" in adapter) return usageError(deps, adapter.error, usage);
  const scope = scopeFor(parsed.options.get("--scope"));
  if (isFailure(scope)) return usageError(deps, scope.error, usage);
  const name = parsed.options.get("--server");
  if (name === undefined || name === "") {
    return usageError(deps, `"${action}" requires --server <name>.`, usage);
  }

  const ctx = hostContext(deps);
  const options = { fs: deps.fs, now: deps.now };
  const result =
    action === "enable"
      ? enable(ctx, adapter.id, scope, name, options)
      : action === "disable"
        ? disable(ctx, adapter.id, scope, name, options)
        : remove(ctx, adapter.id, scope, name, options);

  if (!result.ok) {
    // Refusal reasons are printed VERBATIM (they name the entry + why).
    deps.stderr.write(`Error: ${result.reason ?? `${action} failed`}\n`);
    if (wantJson) emitJson(deps, action, false, result, result.reason ?? `${action} failed`);
    return 1;
  }
  if (wantJson) {
    emitJson(deps, action, true, result);
  } else {
    deps.stdout.write(
      result.changed
        ? `${action}d "${name}" in ${result.path ?? "(unknown path)"}\n`
        : `${action} "${name}": ${result.note ?? "no change"}\n`,
    );
    deps.stdout.write(`Restart: ${adapter.restartHint}\n`);
  }
  return 0;
}

const RESTORE_USAGE = "iris-mcp-clients restore --client <id> [--scope user|project] [--backup <name>] [--json]";

async function cmdRestore(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, ["--json"], ["--client", "--scope", "--backup"]);
  if (parsed.error) return usageError(deps, parsed.error, RESTORE_USAGE);
  if (parsed.positional.length !== 0) return usageError(deps, `"restore" takes no positional arguments.`, RESTORE_USAGE);
  const wantJson = parsed.flags.has("--json");

  const adapter = adapterFor(parsed.options.get("--client"));
  if ("error" in adapter) return usageError(deps, adapter.error, RESTORE_USAGE);
  const scope = scopeFor(parsed.options.get("--scope"));
  if (isFailure(scope)) return usageError(deps, scope.error, RESTORE_USAGE);

  const result = restore(hostContext(deps), adapter.id, scope, {
    fs: deps.fs,
    now: deps.now,
    ...(parsed.options.get("--backup") !== undefined ? { backup: parsed.options.get("--backup") as string } : {}),
  });
  if (!result.ok) {
    deps.stderr.write(`Error: ${result.reason ?? "restore failed"}\n`);
    if (wantJson) emitJson(deps, "restore", false, result, result.reason ?? "restore failed");
    return 1;
  }
  if (wantJson) {
    emitJson(deps, "restore", true, result);
  } else {
    deps.stdout.write(`${result.note ?? "restored"} -> ${result.path ?? "(unknown path)"}\n`);
    deps.stdout.write(`Restart: ${adapter.restartHint}\n`);
  }
  return 0;
}

// ════════════════════════════════════════════════════════════════════
// doctor (AC 33.2.1, Integration AC 33.2-I2 — closes deferred item 33-1-R5)
// ════════════════════════════════════════════════════════════════════

const DOCTOR_USAGE = "iris-mcp-clients doctor [--json] [--repair --yes-i-mean-it]";

/** Backups older than this many days are reported stale. */
const STALE_BACKUP_DAYS = 30;

interface DoctorFinding {
  check: string;
  client: string;
  scope: string;
  path: string | null;
  detail: string;
  /** 33-1-R5 repair candidates carry the entry name. */
  entry?: string;
  /** config-drift (Story 33.4): the adapter's shape expectation. */
  expected?: string;
  /** config-drift (Story 33.4): what the file actually holds (type only — never content). */
  found?: string;
  /** config-drift (Story 33.4): the adapter-data vintage the expectation comes from. */
  adapterDataVersion?: string;
}

/** Recursively walk a parsed entry, invoking `onString` for every string
 * value and `onKey` for every object key (owned entries only — foreign
 * entries are never walked; they may hold third-party secrets). */
function walkEntry(value: unknown, onString: (text: string) => void, onKey: (key: string) => void): void {
  if (typeof value === "string") {
    onString(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkEntry(item, onString, onKey);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      onKey(key);
      walkEntry(item, onString, onKey);
    }
  }
}

/** Parse a backup filename's flattened-ISO timestamp back into a Date; null when it does not match. */
function backupTimestamp(path: string): Date | null {
  const base = path.split(/[\\/]/).pop() ?? path;
  const match = /(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(base);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, ms] = match;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms)));
}

async function cmdDoctor(args: string[], deps: ResolvedDeps): Promise<number> {
  const parsed = parseArgs(args, ["--json", "--repair", "--yes-i-mean-it"], []);
  if (parsed.error) return usageError(deps, parsed.error, DOCTOR_USAGE);
  if (parsed.positional.length !== 0) return usageError(deps, `"doctor" takes no arguments.`, DOCTOR_USAGE);
  const wantJson = parsed.flags.has("--json");
  const wantRepair = parsed.flags.has("--repair");
  if (parsed.flags.has("--yes-i-mean-it") && !wantRepair) {
    return usageError(deps, `--yes-i-mean-it only has meaning together with --repair.`, DOCTOR_USAGE);
  }

  const ctx = hostContext(deps);
  const report = buildStatusMatrix(ctx, deps.fs);
  const stateDir = resolveStateDir(ctx);
  const stateResult = readState(deps.fs, stateDir, deps.platform);
  const findings: DoctorFinding[] = [];
  const restartClients = new Set<string>();
  let state: ManagerState | null = null;
  if (stateResult.ok) {
    state = stateResult.state;
  } else {
    findings.push({
      check: "state-ledger",
      client: "(manager)",
      scope: "-",
      path: null,
      detail: `the manager state file is unreadable: ${stateResult.error} (ownership/stash checks are skipped)`,
    });
  }

  // Check 1: file parseability + config-surface drift (Story 33.4, AC
  // 33.4.2 / Integration AC 33.4-I1). The status matrix classifies BOTH a
  // syntax error and a wrong-shaped root key as "unparseable"; the doctor
  // re-diagnoses the file (the same shared parse path the reader uses) to
  // keep the findings DISTINCT: a syntax error is "parseability" (repair or
  // restore the file before any write), while a file that PARSES but fails
  // the adapter's shape expectations is "config-drift" (the client's config
  // surface moved away from the adapter data). The drift rule (documented in
  // the README's drift-fix procedure): drift = the root key is PRESENT with
  // the wrong shape, OR the file parses but its top level isn't the format's
  // object form at all (every expectation fails). An ABSENT root key with
  // other content is a normal no-MCP-section config — never drift; empty or
  // missing files produce no finding.
  let parsedFiles = 0;
  for (const client of report.clients) {
    const adapter = CLIENT_ADAPTERS[client.client];
    for (const scope of client.scopes) {
      if (scope.file === "ok") parsedFiles++;
      if (scope.file === "unparseable") {
        let diagnosis: ConfigSurfaceDiagnosis | null = null;
        if (adapter !== undefined && scope.path !== null) {
          try {
            diagnosis = diagnoseConfigSurface(adapter, deps.fs.readFile(scope.path));
          } catch {
            diagnosis = null; // an unreadable file stays a parseability finding
          }
        }
        if (
          diagnosis !== null &&
          (diagnosis.status === "root-wrong-shape" || diagnosis.status === "top-not-object")
        ) {
          findings.push({
            check: "config-drift",
            client: client.client,
            scope: scope.scope,
            path: scope.path,
            expected: diagnosis.expected,
            found: diagnosis.found,
            adapterDataVersion: ADAPTER_DATA_VERSION,
            detail:
              `config file parses, but expected ${diagnosis.expected} — found ${diagnosis.found} ` +
              `(adapter data ${ADAPTER_DATA_VERSION}; if ${adapter?.displayName ?? client.client} genuinely changed its config surface, ` +
              `the fix is an adapter-data patch + fixture update, never engine code — see the README's drift-fix procedure)`,
          });
          // 33-5-14: NO restart hint for config-drift — a restart does not
          // remedy drift (the fix is an adapter-data patch), so hinting one
          // is a non-remedy that misdirects the user.
        } else {
          findings.push({
            check: "parseability",
            client: client.client,
            scope: scope.scope,
            path: scope.path,
            detail: `config file is unparseable: ${scope.error ?? "unknown"} (every write refuses until it is repaired or restored)`,
          });
          restartClients.add(client.client);
        }
      }
    }
  }

  // Check 2: env-reference resolvability for OWNED entries (canonical or
  // manager-created; foreign entries are never walked).
  for (const client of report.clients) {
    const adapter = CLIENT_ADAPTERS[client.client];
    if (!adapter) continue;
    for (const scope of client.scopes) {
      if (scope.file !== "ok" || scope.path === null) continue;
      let content: string;
      try {
        content = deps.fs.readFile(scope.path);
      } catch {
        continue;
      }
      const entries = readConfigEntries(adapter, content);
      if (!entries.ok) continue;
      const ownedNames = Object.keys(entries.entries).filter(
        (name) =>
          (CANONICAL_SERVERS as readonly string[]).includes(name) ||
          (state !== null && isManagerCreated(state, client.client, scope.scope, name)),
      );
      const inputIds = presentInputIds(content);
      for (const name of ownedNames) {
        const entry = entries.entries[name];
        if (entry === undefined) continue;
        const strings: string[] = [];
        const keys = new Set<string>();
        walkEntry(entry, (text) => strings.push(text), (key) => keys.add(key));
        const unresolved = (variable: string): boolean =>
          deps.env[variable] === undefined || deps.env[variable] === "";
        if (adapter.envExpansion === "claude" || adapter.envExpansion === "shell") {
          const found = new Set<string>();
          for (const text of strings) {
            for (const match of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}/g)) {
              const hasDefault = match[2] !== undefined;
              if (!hasDefault && unresolved(match[1] as string)) found.add(match[1] as string);
            }
            if (adapter.envExpansion === "shell") {
              for (const match of text.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
                if (unresolved(match[1] as string)) found.add(match[1] as string);
              }
            }
          }
          for (const variable of [...found].sort()) {
            findings.push({
              check: "env-references",
              client: client.client,
              scope: scope.scope,
              path: scope.path,
              detail: `entry "${name}" references $${variable} (or \${${variable}}), which is not set in the current environment`,
            });
          }
        } else if (adapter.envExpansion === "vscode") {
          const missingEnv = new Set<string>();
          const missingInputs = new Set<string>();
          for (const text of strings) {
            for (const match of text.matchAll(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
              if (unresolved(match[1] as string)) missingEnv.add(match[1] as string);
            }
            for (const match of text.matchAll(/\$\{input:([^}]+)\}/g)) {
              const id = match[1] as string;
              if (!inputIds.ok || !inputIds.ids.includes(id)) missingInputs.add(id);
            }
          }
          for (const variable of [...missingEnv].sort()) {
            findings.push({
              check: "env-references",
              client: client.client,
              scope: scope.scope,
              path: scope.path,
              detail: `entry "${name}" references \${env:${variable}}, which is not set in the current environment`,
            });
          }
          for (const id of [...missingInputs].sort()) {
            findings.push({
              check: "env-references",
              client: client.client,
              scope: scope.scope,
              path: scope.path,
              detail: `entry "${name}" references \${input:${id}}, but the file's top-level inputs[] has no "${id}" descriptor`,
            });
          }
        } else {
          // No expansion: the entry's literals must be self-contained OR the
          // OS environment must provide the rest (the synthesize doctorNote).
          for (const variable of CONNECTION_VARS) {
            if (!keys.has(variable) && unresolved(variable)) {
              findings.push({
                check: "env-references",
                client: client.client,
                scope: scope.scope,
                path: scope.path,
                detail:
                  `entry "${name}" has no ${variable} literal and ${variable} is not set in the current environment ` +
                  `(${adapter.displayName} does not expand env vars in MCP config; provide it via the OS environment)`,
              });
            }
          }
        }
      }
    }
  }

  // Check 3: stale backups (age derived from the filename timestamps).
  const staleCutoff = deps.now().getTime() - STALE_BACKUP_DAYS * 24 * 60 * 60 * 1000;
  for (const client of report.clients) {
    const adapter = CLIENT_ADAPTERS[client.client];
    if (!adapter) continue;
    for (const scopeDef of adapter.scopes) {
      const path = resolveScopePath(adapter, scopeDef.scope, ctx, (p) => deps.fs.exists(p));
      if (path === null) continue;
      const backups = listBackups(path, {
        adapter,
        client: client.client,
        scope: scopeDef.scope,
        stateDir,
        platform: deps.platform,
        fs: deps.fs,
      });
      const stale = backups.filter((backup) => {
        const stamp = backupTimestamp(backup);
        return stamp !== null && stamp.getTime() < staleCutoff;
      });
      if (stale.length > 0) {
        findings.push({
          check: "stale-backups",
          client: client.client,
          scope: scopeDef.scope,
          path: null,
          detail:
            `${stale.length} backup(s) older than ${STALE_BACKUP_DAYS} days under ${stateDir}/backups/${client.client}/${scopeDef.scope}/ ` +
            `(oldest: ${stale[0]?.split(/[\\/]/).pop() ?? "unknown"}) — prune them when no longer needed`,
        });
      }
    }
  }

  // Check 4: orphaned stashes (a state record whose entry is ALSO
  // present-enabled in the file, or whose client config no longer exists).
  if (state !== null) {
    for (const stash of state.stashes) {
      const adapter = CLIENT_ADAPTERS[stash.client];
      if (!adapter) {
        findings.push({
          check: "orphaned-stashes",
          client: stash.client,
          scope: stash.scope,
          path: null,
          detail: `stash record for "${stash.name}" names an unknown client "${stash.client}"`,
        });
        continue;
      }
      const path = resolveScopePath(adapter, stash.scope, ctx, (p) => deps.fs.exists(p));
      let exists = false;
      try {
        exists = path !== null && deps.fs.exists(path);
      } catch {
        exists = false;
      }
      if (path === null || !exists) {
        findings.push({
          check: "orphaned-stashes",
          client: stash.client,
          scope: stash.scope,
          path,
          detail: `stash record for "${stash.name}" but the client config no longer exists (the entry can never be spliced back)`,
        });
        continue;
      }
      let content: string;
      try {
        content = deps.fs.readFile(path);
      } catch {
        continue;
      }
      const entries = readConfigEntries(adapter, content);
      if (!entries.ok) continue; // unparseable is check 1's finding
      const present = ownEntry(entries.entries, stash.name);
      if (present !== undefined) {
        const flag = adapter.nativeDisableFlag;
        const disabled = flag !== undefined && present[flag.key] === flag.disabledValue;
        if (!disabled) {
          findings.push({
            check: "orphaned-stashes",
            client: stash.client,
            scope: stash.scope,
            path,
            detail: `entry "${stash.name}" is BOTH stashed and present-enabled in the file (a stale stash record; a re-run enable or remove clears it)`,
          });
        }
      }
    }
  }

  // Check 5 (33-1-R5): present non-canonical entries that FAIL ownership —
  // possible manager-created entries orphaned by a state.json loss. The
  // heuristic narrows to the iris- namespace (foreign third-party entries
  // fail ownership BY DESIGN and are never flagged).
  if (state !== null) {
    for (const client of report.clients) {
      const adapter = CLIENT_ADAPTERS[client.client];
      if (!adapter) continue;
      for (const scope of client.scopes) {
        if (scope.file !== "ok" || scope.path === null) continue;
        let content: string;
        try {
          content = deps.fs.readFile(scope.path);
        } catch {
          continue;
        }
        const entries = readConfigEntries(adapter, content);
        if (!entries.ok) continue;
        for (const name of Object.keys(entries.entries)) {
          if (!name.startsWith("iris-")) continue;
          if ((CANONICAL_SERVERS as readonly string[]).includes(name)) continue;
          if (isManagerCreated(state, client.client, scope.scope, name)) continue;
          if (findStash(state, client.client, scope.scope, name)) continue;
          findings.push({
            check: "unrecorded-entries",
            client: client.client,
            scope: scope.scope,
            path: scope.path,
            entry: name,
            detail:
              `entry "${name}" is present but is neither a canonical iris-mcp server nor recorded manager-created ` +
              `(a state.json loss orphans such entries — 33-1-R5); re-record it with: doctor --repair --yes-i-mean-it`,
          });
        }
      }
    }
  }

  // Restart hints: every client with a finding, plus clients with a
  // present-disabled owned entry (a state change pending activation).
  for (const client of report.clients) {
    for (const scope of client.scopes) {
      for (const server of scope.servers) {
        if (server.state === "present-disabled") restartClients.add(client.client);
      }
    }
  }

  // --repair (33-1-R5): re-record the unrecorded-entries findings as
  // manager-created behind the typed --yes-i-mean-it confirmation.
  const repaired: string[] = [];
  if (wantRepair) {
    if (!parsed.flags.has("--yes-i-mean-it")) {
      return usageError(
        deps,
        `--repair re-records the reported entries as manager-created in state.json; re-run with --yes-i-mean-it to confirm`,
        DOCTOR_USAGE,
      );
    }
    if (state === null) {
      deps.stderr.write(`Error: cannot repair — the manager state file is unreadable (see the state-ledger finding).\n`);
      if (wantJson) emitJson(deps, "doctor", false, null, "state unreadable");
      return 1;
    }
    let next = state;
    for (const finding of findings) {
      if (finding.check !== "unrecorded-entries" || finding.entry === undefined) continue;
      next = recordManaged(
        next,
        // Unknown provenance ⇒ containsSecret true (assume the entry may
        // carry a literal secret; the conservative marker).
        { client: finding.client, scope: finding.scope as ClientScope, name: finding.entry, containsSecret: true },
        deps.now(),
      );
      repaired.push(`${finding.client}/${finding.scope}/${finding.entry}`);
    }
    if (repaired.length > 0) {
      try {
        writeState(deps.fs, stateDir, deps.platform, next);
      } catch (err) {
        deps.stderr.write(`Error: could not write the manager state file: ${err instanceof Error ? err.message : String(err)}\n`);
        if (wantJson) emitJson(deps, "doctor", false, null, "state write failed");
        return 1;
      }
    }
  }

  // A repaired unrecorded-entries finding is resolved; everything else stays.
  const activeFindings =
    repaired.length > 0 ? findings.filter((finding) => finding.check !== "unrecorded-entries") : findings;
  const findingCount = activeFindings.length; // AC 33.2.4: derived, never hand-authored

  if (wantJson) {
    emitJson(deps, "doctor", findingCount === 0, {
      findings: activeFindings,
      findingCount,
      repaired,
      staleBackupDays: STALE_BACKUP_DAYS,
      parsedFiles,
      restartHints: [...restartClients].sort().map((client) => ({
        client,
        hint: CLIENT_ADAPTERS[client]?.restartHint ?? "",
      })),
    });
    return findingCount === 0 ? 0 : 1;
  }

  deps.stdout.write(`iris-mcp-clients doctor (state: ${stateDir}):\n\n`);
  if (repaired.length > 0) {
    deps.stdout.write(`  repaired (${repaired.length}) — re-recorded manager-created:\n`);
    for (const item of repaired) deps.stdout.write(`    ${item}\n`);
    deps.stdout.write("\n");
  }
  if (activeFindings.length === 0) {
    deps.stdout.write(`  all checks passed (${parsedFiles} config file(s) parsed)\n`);
  } else {
    const byCheck = new Map<string, DoctorFinding[]>();
    for (const finding of activeFindings) {
      const list = byCheck.get(finding.check) ?? [];
      list.push(finding);
      byCheck.set(finding.check, list);
    }
    for (const [check, list] of byCheck) {
      deps.stdout.write(`  ${check} (${list.length}):\n`);
      for (const finding of list) {
        deps.stdout.write(
          `    [${finding.client}/${finding.scope}] ${finding.detail}\n`,
        );
      }
    }
    deps.stdout.write(`\n  ${findingCount} finding(s).\n`);
  }
  if (restartClients.size > 0) {
    deps.stdout.write(`\nRestart hints:\n`);
    for (const client of [...restartClients].sort()) {
      const adapter = CLIENT_ADAPTERS[client];
      if (adapter) deps.stdout.write(`  ${adapter.displayName}: ${adapter.restartHint}\n`);
    }
  }
  return findingCount === 0 ? 0 : 1;
}

// ════════════════════════════════════════════════════════════════════
// Entry point.
// ════════════════════════════════════════════════════════════════════

/**
 * Run the CLI for one invocation. Pure function of `argv`/`deps` — never
 * calls `process.exit`, so the caller (the sibling `clients-cli.ts` bin
 * entry, or a test) decides what to do with the returned exit code.
 *
 * @param argv - Arguments AFTER the command name (i.e. `process.argv.slice(2)`).
 * @param deps - Injectable streams/env/fs — production callers omit this entirely.
 */
export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const resolved = resolveDeps(deps);

  if (helpRequested(argv)) {
    resolved.stdout.write(buildHelpText(modeAvailability(resolved, undefined)));
    return 0;
  }

  const [command, ...rest] = argv;
  if (command === undefined) {
    resolved.stderr.write(`Error: no command given.\n\n${buildHelpText(modeAvailability(resolved, undefined))}`);
    return 2;
  }

  switch (command) {
    case "detect":
      return cmdDetect(rest, resolved);
    case "status":
      return cmdStatus(rest, resolved);
    case "diff":
      return cmdDiff(rest, resolved);
    case "apply":
      return cmdApply(rest, resolved);
    case "enable":
      return cmdToggle("enable", rest, resolved);
    case "disable":
      return cmdToggle("disable", rest, resolved);
    case "remove":
      return cmdToggle("remove", rest, resolved);
    case "restore":
      return cmdRestore(rest, resolved);
    case "doctor":
      return cmdDoctor(rest, resolved);
    default:
      resolved.stderr.write(
        `Error: unknown command "${command}". Valid commands: detect, status, diff, apply, enable, disable, remove, restore, doctor.\n`,
      );
      return 2;
  }
}
