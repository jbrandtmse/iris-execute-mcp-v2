/**
 * `iris-mcp-credentials` — one-time per-machine OS-keychain setup CLI
 * (Epic 31, Story 31.2).
 *
 * The *writer* half of the OS-keychain link Story 31.1's credential chain
 * (`credential-chain.ts`) *reads*: `set`/`delete`/`list` operate on the
 * keychain directly (service {@link CREDENTIAL_CHAIN_KEYCHAIN_SERVICE},
 * imported — never re-declared — so writer and reader can never drift on the
 * service/account key), while `test` drives the REAL chain
 * ({@link resolveCredential}) so it reports true behavior rather than a
 * reimplementation that could diverge from what the MCP servers actually do.
 *
 * **Keychain-unavailable handling is deliberately the OPPOSITE of the
 * chain's.** `credential-chain.ts`'s OS-keychain link treats a failed
 * `@napi-rs/keyring` import as "skip this link" because it has three other
 * links to fall back to. This CLI's `set`/`delete`/`list` have nothing else
 * to do — the OS keychain IS the point — so a failed import surfaces as a
 * loud, non-zero-exit {@link KeyringUnavailableError} instead. `test` is
 * unaffected by this distinction: it runs the real chain as-is, including
 * the chain's own silent-skip-on-missing-module behavior, because Task 4
 * requires reporting the chain's TRUE behavior, not a CLI-specific override
 * of it.
 *
 * **Secret discipline.** No password is ever written to any output stream
 * (human text, `--json`, `--help`, or an error/failure message) on any code
 * path, including the `--connect` failure surface.
 *
 * This module exports {@link runCli} (pure — argv/deps in, exit code out) so
 * it can be unit-tested with injected fakes (no test may touch the real OS
 * keychain, matching the AC 31.1.2 discipline). The executable entry point
 * is the sibling `credentials-cli.ts` (shebang + `process.exitCode` wiring).
 */

import type { Readable } from "node:stream";

import {
  CREDENTIAL_CHAIN_KEYCHAIN_SERVICE,
  resolveCredential as resolveCredentialDefault,
  type CredentialLinkSource,
} from "../credential-chain.js";
import {
  loadProfileRegistry as loadProfileRegistryDefault,
  resolveProfile,
  type IrisProfile,
  type ProfileRegistry,
  type ProfileSource,
} from "../profiles.js";
import { IrisHttpClient } from "../http-client.js";
import { checkHealth } from "../health.js";

// ════════════════════════════════════════════════════════════════════
// Keyring port — the CLI's OWN direct keychain access (set/delete/list).
// Deliberately distinct from CredentialChainOptions (credential-chain.ts):
// that interface is a lookup-only seam for the chain's OS-keychain LINK;
// this one covers the CLI's write/delete/enumerate surface.
// ════════════════════════════════════════════════════════════════════

/** One entry as returned by the native `findCredentials(service)` call. */
export interface KeyringCredential {
  account: string;
  password: string;
}

/**
 * The CLI's direct keychain operations, all scoped to a single fixed
 * `service` (baked in at construction — always
 * {@link CREDENTIAL_CHAIN_KEYCHAIN_SERVICE} in production).
 */
export interface KeyringPort {
  setPassword(account: string, password: string): void;
  /** `null` when there is no stored password for `account` (verified live — `@napi-rs/keyring` 1.3.0's `Entry.getPassword()` returns `null`, never throws, for a missing entry). */
  getPassword(account: string): string | null;
  /** `false` when there was nothing to delete (verified live — `deleteCredential()` returns `false`, never throws, for a missing entry). */
  deleteCredential(account: string): boolean;
  /**
   * Whether a password EXISTS for `account`, without the value crossing into
   * CLI logic (31-2-4) — used so `set` can report create vs replace. The
   * native API has no exists call, so the production implementation reads
   * the value inside the port and discards it immediately (the lightest
   * available probe — `findCredentials` would pull EVERY stored secret); only
   * the boolean is exposed.
   */
  exists(account: string): boolean;
  /**
   * Enumerate every credential under this port's service.
   *
   * Verified live (2026-07-25) against the real Windows Credential Manager
   * via the installed `@napi-rs/keyring@1.3.0`: `findCredentials(service)`
   * DOES support service-scoped enumeration (contrary to the story's
   * "do not assume enumeration is possible" caution) and returns
   * `Array<{account, password}>`. `list` uses only `.account` from each
   * entry; `.password` is never read further, logged, or serialized — Task
   * 3's "never read a password value in order to list" is honored by
   * discarding it immediately after this one unavoidable native call
   * returns it (the native API bundles both fields; there is no
   * account-only enumeration entry point).
   */
  listCredentials(): KeyringCredential[];
}

/**
 * Thrown by {@link loadRealKeyring} when `@napi-rs/keyring` (an
 * `optionalDependency`) fails to load. Unlike the credential chain's
 * matching failure (which logs at debug and skips the link), this is always
 * fatal for the CLI — see the module doc comment.
 */
export class KeyringUnavailableError extends Error {
  constructor(reason: string) {
    super(
      `The OS keychain is unavailable on this machine (@napi-rs/keyring failed to load: ${reason}). ` +
        `This command needs OS keychain support: verify a prebuilt binary exists for your platform/architecture, ` +
        `or reinstall the "@napi-rs/keyring" optional dependency. Unlike the MCP servers' credential chain, this ` +
        `command has no fallback — storing, deleting, and listing OS-keychain passwords IS its purpose.`,
    );
    this.name = "KeyringUnavailableError";
  }
}

/** Real `@napi-rs/keyring`-backed {@link KeyringPort} (production default). */
async function loadRealKeyring(service: string): Promise<KeyringPort> {
  let keyringModule: typeof import("@napi-rs/keyring");
  try {
    keyringModule = await import("@napi-rs/keyring");
  } catch (e: unknown) {
    throw new KeyringUnavailableError(e instanceof Error ? e.message : String(e));
  }
  return {
    setPassword(account: string, password: string): void {
      new keyringModule.Entry(service, account).setPassword(password);
    },
    getPassword(account: string): string | null {
      return new keyringModule.Entry(service, account).getPassword();
    },
    deleteCredential(account: string): boolean {
      return new keyringModule.Entry(service, account).deleteCredential();
    },
    exists(account: string): boolean {
      // No native exists call (see KeyringPort.exists): read-and-discard is
      // the lightest probe available; the value never leaves this closure.
      return new keyringModule.Entry(service, account).getPassword() !== null;
    },
    listCredentials(): KeyringCredential[] {
      return keyringModule.findCredentials(service);
    },
  };
}

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
  /** Source for `set --stdin`. Defaults to `process.stdin`. */
  stdin?: Readable;
  /** Hidden interactive password prompt for `set` (no `--stdin`). */
  promptPassword?: (serverName: string) => Promise<string>;
  /** Defaults to the real `@napi-rs/keyring`-backed port. */
  loadKeyring?: () => Promise<KeyringPort>;
  /** Defaults to the real Story 31.1 chain (`credential-chain.ts`). */
  resolveCredentialFn?: typeof resolveCredentialDefault;
  /** Defaults to the real `loadProfileRegistry` (`profiles.ts`) — used only by `test --connect`. */
  loadProfileRegistryFn?: typeof loadProfileRegistryDefault;
  /** Defaults to a real Atelier `HEAD /api/atelier/` probe (`health.ts`) — used only by `test --connect`. */
  connectFn?: (profile: IrisProfile) => Promise<void>;
  /** Defaults to `process.platform` — passed through to `loadProfileRegistryFn`. */
  platform?: NodeJS.Platform;
}

async function defaultConnect(profile: IrisProfile): Promise<void> {
  const client = new IrisHttpClient(profile, profile.timeout);
  try {
    await checkHealth(client);
  } finally {
    client.destroy();
  }
}

interface ResolvedDeps {
  env: Record<string, string | undefined>;
  stdout: CliOutput;
  stderr: CliOutput;
  stdin: Readable;
  promptPassword: (serverName: string) => Promise<string>;
  loadKeyring: () => Promise<KeyringPort>;
  resolveCredentialFn: typeof resolveCredentialDefault;
  loadProfileRegistryFn: typeof loadProfileRegistryDefault;
  connectFn: (profile: IrisProfile) => Promise<void>;
  platform: NodeJS.Platform;
}

function resolveDeps(deps: CliDeps): ResolvedDeps {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const stdin = deps.stdin ?? process.stdin;
  return {
    env: deps.env ?? process.env,
    stdout,
    stderr,
    stdin,
    // Bound to the RESOLVED stdin/stderr seams rather than the process
    // globals, so the raw-mode / paste / backspace / EOF behavior of the
    // prompt is directly testable. It previously hard-coded `process.stdin`
    // and `process.stdout`, which meant every `set` test injected
    // `promptPassword` and the real prompt shipped with ZERO coverage —
    // hiding the two defects fixed below (code review 2026-07-25).
    promptPassword:
      deps.promptPassword ?? ((name: string) => promptPasswordFromStream(name, stdin, stderr)),
    loadKeyring: deps.loadKeyring ?? (() => loadRealKeyring(CREDENTIAL_CHAIN_KEYCHAIN_SERVICE)),
    resolveCredentialFn: deps.resolveCredentialFn ?? resolveCredentialDefault,
    loadProfileRegistryFn: deps.loadProfileRegistryFn ?? loadProfileRegistryDefault,
    connectFn: deps.connectFn ?? defaultConnect,
    platform: deps.platform ?? process.platform,
  };
}

// ════════════════════════════════════════════════════════════════════
// Hidden interactive password prompt (no new dependency — raw stdin).
// ════════════════════════════════════════════════════════════════════

/** True when `stream` is an interactive terminal, false for a pipe, file, or test double. */
function isInteractiveTty(stream: Readable): boolean {
  return (stream as NodeJS.ReadStream).isTTY === true;
}

/**
 * Hidden interactive password prompt — reads from `stdin` with echo
 * suppressed and resolves with the typed password. Exported for tests.
 *
 * Input is consumed **one code point at a time**, not one `data` chunk at a
 * time. The original chunk-granular `switch` compared the WHOLE chunk against
 * each terminator, which mishandled every multi-character delivery. Both
 * resulting failures were silent and severe (each reproduced live on Node
 * v24, code review 2026-07-25):
 *
 * 1. **A pasted password was stored corrupted.** A password copied together
 *    with its trailing newline arrives as ONE chunk (`"pw\n"`), which matched
 *    no terminator case and was appended verbatim; the following Enter then
 *    resolved with an embedded newline inside the secret. `set` printed
 *    success and every later authentication failed against a value the user
 *    cannot read back from anywhere.
 * 2. **Non-interactive stdin exited 0 having stored nothing.** With only a
 *    `"data"` listener and no `"end"`, `set <name>` against a piped or closed
 *    stdin never settled its promise; a pending promise does not hold the
 *    event loop open, so Node drained, `process.exitCode` was never assigned,
 *    and the process exited **0** — a false success on the one command whose
 *    entire job is the write.
 *
 * Code-point iteration (`for...of`) additionally makes backspace correct for
 * astral characters, and an `"error"` listener keeps a stream error from
 * surfacing as an uncaught `EventEmitter` exception outside `cmdSet`'s guard.
 */
export function promptPasswordFromStream(
  serverName: string,
  stdin: Readable,
  stderr: CliOutput,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // The prompt goes to STDERR, never stdout: `set <name> > out.log` must
    // still show the prompt on the terminal (otherwise the command merely
    // looks hung), and stdout stays reserved for command output.
    stderr.write(`Password for "${serverName}": `);

    const tty = stdin as NodeJS.ReadStream;
    const interactive = isInteractiveTty(stdin);
    const wasRaw = interactive ? tty.isRaw : undefined;
    if (interactive) tty.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const chars: string[] = [];
    let settled = false;

    const cleanup = (): void => {
      settled = true;
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      stdin.removeListener("error", onError);
      if (interactive && wasRaw !== undefined) tty.setRawMode(wasRaw);
      stdin.pause();
    };
    const finish = (): void => {
      cleanup();
      stderr.write("\n");
      resolve(chars.join(""));
    };
    const abort = (reason: string): void => {
      cleanup();
      stderr.write("\n");
      reject(new Error(reason));
    };

    function onData(chunk: string | Buffer): void {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const ch of text) {
        if (settled) return;
        switch (ch) {
          case "\n":
          case "\r":
          case "\u0004": // Ctrl-D / EOT
            finish();
            return;
          case "\u0003": // Ctrl-C
            abort("Aborted.");
            return;
          case "\u007f": // Backspace (DEL)
          case "\b":
            chars.pop();
            break;
          default:
            chars.push(ch);
            break;
        }
      }
    }
    function onEnd(): void {
      if (!settled) finish();
    }
    function onError(e: unknown): void {
      if (!settled) abort(e instanceof Error ? e.message : String(e));
    }

    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("error", onError);
  });
}

/**
 * Read `set --stdin`'s password: the raw bytes, trimmed of a SINGLE trailing
 * newline only (AC 31.2.1) — not a full `.trim()`, which could silently
 * corrupt a password with meaningful leading/trailing characters.
 *
 * A leading UTF-8 BOM is stripped BEFORE the newline trim. Redirecting a file
 * written by PowerShell's `Out-File`/`Set-Content` (the platform default here)
 * otherwise stored an invisible U+FEFF prefix that `.trim()` in the
 * empty-input guard silently absorbs, so `set` reported success and every
 * later authentication failed against a value differing from what the user
 * typed (code review 2026-07-25, reproduced live).
 *
 * Two input guards (Story 32.3):
 *
 * - **64 KiB cap (31-2-5).** A misdirected pipe (`cat bigfile | \u2026 set x
 *   --stdin`) used to be an unbounded allocation; it now fails naming the
 *   cap and the likely cause. 64 KiB is deliberately generous \u2014 far beyond
 *   any real passphrase \u2014 so it only ever trips on a file piped in by
 *   mistake. 32-3-R13 (Story 32.4): the cap is measured on the PASSWORD
 *   after the single-trailing-newline strip (the stream reader allows the
 *   newline's 1\u20132 bytes of slack), so a boundary-length password with its
 *   newline is accepted, and an over-cap password is rejected with the
 *   accurate cause rather than the file-pipe message.
 * - **NUL rejection (31-2-6).** A decoded password containing U+0000 means
 *   the input was almost certainly UTF-16 (what PowerShell's `Out-File`
 *   produces on some hosts): stored NUL-interleaved, it would "succeed" here
 *   and fail every later authentication with no diagnosable cause. REJECTED
 *   \u2014 never transcoded; encoding-guessing can misfire on a legitimate
 *   password containing the bytes a heuristic keys off.
 */
async function readStdinPassword(stream: Readable): Promise<string> {
  const STDIN_PASSWORD_CAP_BYTES = 64 * 1024;
  // 32-3-R13 (Story 32.4): the stream cap carries +2 bytes of slack so a
  // boundary-length password plus its SINGLE trailing newline (\n or \r\n —
  // stripped below) is not misdiagnosed as a piped-in file. The cap the
  // operator reads about is on the PASSWORD; the newline is framing.
  const STREAM_CAP_BYTES = STDIN_PASSWORD_CAP_BYTES + 2;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : (chunk as Buffer);
    total += buf.length;
    if (total > STREAM_CAP_BYTES) {
      throw new Error(
        // 32.4 review (Edge L1): name BOTH causes \u2014 an over-cap password with
        // its trailing newline also lands here (1\u20132 wire bytes past the
        // slack), and blaming only a piped-in file misdiagnoses it.
        `stdin input exceeds the 64 KiB password limit (even allowing 2 bytes of newline slack) \u2014 ` +
          `the password itself is too long, or a file was piped in by ` +
          `mistake ("cat bigfile | iris-mcp-credentials set <name> --stdin"). Pipe only the password itself.`,
      );
    }
    chunks.push(buf);
  }
  let text = Buffer.concat(chunks).toString("utf8");
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  if (text.includes("\u0000")) {
    throw new Error(
      `the decoded password contains a NUL (U+0000) character \u2014 the input was probably ` +
        `UTF-16-encoded (PowerShell's Out-File writes UTF-16 on some hosts). Re-encode as UTF-8 ` +
        `(e.g. -Encoding utf8) or pipe from printf, and try again.`,
    );
  }
  if (text.endsWith("\r\n")) {
    text = text.slice(0, -2);
  } else if (text.endsWith("\n")) {
    text = text.slice(0, -1);
  }
  // 32-3-R13: after the newline strip, the PASSWORD ITSELF is measured — a
  // boundary-length password with its newline is accepted, an over-cap
  // password is rejected with the ACCURATE cause (never the file-pipe
  // message).
  if (Buffer.byteLength(text, "utf8") > STDIN_PASSWORD_CAP_BYTES) {
    throw new Error(
      `the password exceeds the 64 KiB limit (its trailing newline is not counted). ` +
        `Pipe only the password itself.`,
    );
  }
  return text;
}

// ════════════════════════════════════════════════════════════════════
// Small shared helpers.
// ════════════════════════════════════════════════════════════════════

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Below this length a candidate secret cannot be substring-redacted without
 * corrupting unrelated text (mirrors `credential-chain.ts`'s
 * `SECRET_MIN_REDACTION_LENGTH` — same reasoning, project rule #9).
 */
const SECRET_MIN_REDACTION_LENGTH = 4;

/**
 * Emitted in place of a message body that could contain a too-short
 * credential — mirrors `credential-chain.ts`'s `WITHHELD_SHORT_SECRET`.
 */
const WITHHELD_SHORT_SECRET = "[withheld: may contain a credential too short to redact safely]";

/**
 * Defense-in-depth redaction applied to any error text that could, through a
 * bug in an upstream layer, echo back a known secret (the password just
 * written, the credential just resolved, or a mapped profile's password on
 * the `--connect` failure surface).
 *
 * **This is not hypothetical.** Verified live (Node v24, 2026-07-25): an
 * `IRIS_PROFILES` value whose JSON is malformed near a password makes V8
 * embed a ~20-character SOURCE EXCERPT in the `SyntaxError`
 * (`{"prod":{"password":sup3rs3cret}}` ⇒ `Unexpected token 's',
 * ..."password":sup3rs3cre"... is not valid JSON`), and `buildProfileRegistry`
 * wraps that message verbatim. `test --connect` renders it.
 *
 * A secret shorter than {@link SECRET_MIN_REDACTION_LENGTH} cannot be
 * substring-replaced without corrupting unrelated text, so — exactly as the
 * chain does — the whole body is WITHHELD rather than passed through
 * unredacted (code review 2026-07-25: the CLI mirrored the constant but not
 * the withhold branch, so a 1-3 character password leaked in cleartext).
 */
function redactSecret(text: string, secret: string): string {
  if (secret.length < SECRET_MIN_REDACTION_LENGTH) {
    return text.includes(secret) ? WITHHELD_SHORT_SECRET : text;
  }
  return text.split(secret).join("[REDACTED]");
}

/**
 * Redact `text` against EVERY secret the CLI knows about at that point.
 *
 * The `--connect` catch previously redacted only against `profile.password`,
 * which is `undefined` on the branch that matters most — a throw from
 * `loadProfileRegistryFn`, i.e. the layer that PARSES `IRIS_PROFILES` and is
 * therefore the only one whose message can contain a secret at all (code
 * review 2026-07-25).
 */
function redactKnownSecrets(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret !== undefined && secret !== "") out = redactSecret(out, secret);
  }
  return out;
}

/**
 * Reject a server name that cannot be a usable keychain account before it
 * reaches the keychain (code review 2026-07-25 — all of these were previously
 * accepted with exit 0):
 *
 * - **empty / whitespace-only**: `test ""` resolves through
 *   `resolveProfile` to the RESERVED `default` profile, so `test "" --connect`
 *   silently probed the local default host while reporting `name: ""`; and
 *   `set ""` wrote an entry no Server Manager name can ever match.
 * - **embedded newline / control character**: `list` is line-oriented, so one
 *   such entry silently emits multiple lines and breaks every
 *   `| while read name` consumer.
 */
function serverNameError(serverName: string): string | undefined {
  if (serverName.trim() === "") {
    return `<serverName> must not be empty or whitespace-only.`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(serverName)) {
    return `<serverName> must not contain newline or control characters.`;
  }
  return undefined;
}

/** Remediation text matching the STYLE of `credential-chain.ts`'s own exhaustion message (that function is module-private, so this is written to match, not imported). */
function remediationText(serverName: string): string {
  return (
    `Run "iris-mcp-credentials set ${serverName}" to store a password in the OS keychain, set ` +
    `IRIS_CREDENTIAL_HELPER to a command that can supply one, or define "${serverName}" with its full connection ` +
    `fields (host, port, username, password) via IRIS_PROFILES.`
  );
}

/**
 * Remediation for a `--connect` failure that never reached the network: the
 * name resolved a password but maps to no connection PROFILE in this shell.
 *
 * `resolveProfile`'s own `ProfileResolutionError` advises "Set IRIS_PROFILES",
 * which is the wrong remedy for a keychain-backed Server Manager name — the
 * README is explicit that an `IRIS_PROFILES` entry REPLACES rather than
 * completes a Server Manager definition. `--connect` also needs the CLI's own
 * process env to satisfy `loadConfig` (IRIS_USERNAME/IRIS_PASSWORD for the
 * reserved `default` profile), which is not obvious from the credential-only
 * workflow (code review 2026-07-25).
 */
function connectRemediationText(serverName: string): string {
  return (
    `"--connect" needs "${serverName}" to map to a connection profile in THIS shell: set ` +
    `IRIS_SERVER_MANAGER=auto to import Server Manager definitions (default is off), or define ` +
    `"${serverName}" with its full connection fields via IRIS_PROFILES. IRIS_USERNAME and ` +
    `IRIS_PASSWORD must also be set, because the reserved "default" profile is built from them. ` +
    `The credential check itself already succeeded and is unaffected.`
  );
}

interface ParsedArgs {
  positional: string[];
  flags: Set<string>;
  error?: string;
}

/**
 * Minimal manual argv parser — no CLI-framework dependency (per story
 * constraint). `--` is the conventional end-of-options terminator: everything
 * after it is positional, so a server name that begins with `-` remains
 * addressable (`delete -- --json`). Without it such a name was unreachable on
 * every subcommand (code review 2026-07-25).
 */
function parseArgs(args: string[], allowedFlags: readonly string[]): ParsedArgs {
  const allowed = new Set(allowedFlags);
  const positional: string[] = [];
  const flags = new Set<string>();
  let optionsEnded = false;
  for (const arg of args) {
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
    } else if (!optionsEnded && arg.startsWith("-")) {
      if (!allowed.has(arg)) {
        return { positional, flags, error: `Unknown option "${arg}".` };
      }
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const HELP_TEXT = `iris-mcp-credentials — store, list, test, and remove IRIS passwords in the OS keychain

Usage: iris-mcp-credentials <command> [options]

Commands:
  set <serverName>       Store a password in the OS keychain.
                            Interactive by default (hidden input, echo suppressed).
                            --stdin   read the password from a pipe or file instead of prompting.
                                      Refused when stdin is a terminal (it would echo in cleartext).
  delete <serverName>    Remove the stored password for <serverName>.
  list                   List server names with a stored password (names only, never secrets).
                            --json    machine-readable output.
  test <serverName>      Check whether a password is resolvable via the credential chain
                          (env / OS keychain / credential helper), and report which link resolved it.
                            --connect perform a live Atelier "HEAD /api/atelier/" check against the mapped profile.
                                      Requires the name to map to a profile in THIS shell
                                      (IRIS_SERVER_MANAGER=auto or IRIS_PROFILES, plus IRIS_USERNAME/IRIS_PASSWORD).
                            --json    machine-readable output.

Options:
  -h, --help              Show this help and exit.
  --                      End of options: every later argument is positional, so a
                          server name beginning with "-" stays addressable.

Exit codes:
  0   success
  1   not found / credential unresolved / OS keychain unavailable
      (or, for "test --connect", the connectivity check failed)
  2   usage or input error (unknown command, missing or extra argument, unknown option,
      invalid server name, empty password, aborted prompt)

--json output contract: an OPERATIONAL outcome (exit 0 or 1) always writes exactly one JSON
object to stdout — on failure it is {"error": "..."} for "list" and carries an "error" field
for "test". Usage errors (exit 2) are always plain text on stderr, since the flags themselves
were not understood. Human-readable failures always go to stderr.

Every password is stored under the OS-keychain service "${CREDENTIAL_CHAIN_KEYCHAIN_SERVICE}", account <serverName> —
the same key the MCP servers' credential chain reads (see credential-chain.ts / the README).

Note: "list" enumerates via the native findCredentials(service) call, verified against the
Windows Credential Manager. macOS Keychain and libsecret back-ends may enumerate differently;
"set", "delete" and "test" are unaffected.
`;

// ════════════════════════════════════════════════════════════════════
// Subcommands.
// ════════════════════════════════════════════════════════════════════

async function cmdSet(args: string[], deps: ResolvedDeps): Promise<number> {
  const { positional, flags, error } = parseArgs(args, ["--stdin"]);
  if (error) {
    deps.stderr.write(`Error: ${error}\n\nUsage: iris-mcp-credentials set <serverName> [--stdin]\n`);
    return 2;
  }
  if (positional.length !== 1) {
    deps.stderr.write(
      `Error: "set" requires exactly one argument, <serverName>.\n\nUsage: iris-mcp-credentials set <serverName> [--stdin]\n`,
    );
    return 2;
  }
  const [serverName] = positional as [string];
  const nameError = serverNameError(serverName);
  if (nameError !== undefined) {
    deps.stderr.write(
      `Error: ${nameError}\n\nUsage: iris-mcp-credentials set <serverName> [--stdin]\n`,
    );
    return 2;
  }
  const useStdin = flags.has("--stdin");

  // `--stdin` reads the stream verbatim and does NOT suppress echo — that is
  // the point of the flag (it is the scripted/CI path). On an interactive
  // terminal the line discipline would print the typed password in cleartext
  // into the screen and the shell's scrollback, so refuse and name the
  // hidden-prompt form instead (code review 2026-07-25).
  if (useStdin && isInteractiveTty(deps.stdin)) {
    deps.stderr.write(
      `Error: "--stdin" reads the password from a pipe or file and does not suppress terminal echo, ` +
        `but stdin is an interactive terminal — the password would be shown in cleartext.\n` +
        `Run "iris-mcp-credentials set ${serverName}" (no --stdin) for a hidden prompt, or pipe the ` +
        `password in, e.g. "your-password-source | iris-mcp-credentials set ${serverName} --stdin".\n`,
    );
    return 2;
  }

  // Fail BEFORE asking a human for a secret this command could not store
  // anyway (fail-fast, ADR D7). Previously the prompt came first, so a
  // machine with no keychain support collected the password and only then
  // reported that it had nowhere to put it.
  let keyring: KeyringPort;
  try {
    keyring = await deps.loadKeyring();
  } catch (e: unknown) {
    deps.stderr.write(`Error: ${errorMessage(e)}\n`);
    return 1;
  }

  let password: string;
  try {
    password = useStdin
      ? await readStdinPassword(deps.stdin)
      : await deps.promptPassword(serverName);
  } catch (e: unknown) {
    deps.stderr.write(`Error: could not read the password — ${errorMessage(e)}\n`);
    return 2;
  }
  if (password.trim() === "") {
    deps.stderr.write(`Error: no password was provided (empty input).\n`);
    return 2;
  }

  try {
    // 31-2-4: create vs replace is meaningful information for a tool whose
    // worst failure mode is "the wrong password is stored" — read existence
    // (a boolean, never the value) BEFORE the write.
    //
    // 32-3-R13 (Story 32.4 — recorded decision): the exists()-then-setPassword
    // pair is deliberately NOT made atomic. The keychain write itself is
    // atomic at the OS level and the stored VALUE is correct either way;
    // under a concurrent writer to the same account the only casualty is the
    // human-facing verb ("Stored" vs "Replaced") — message-only. The
    // KeyringPort contract added in 31-2-4 exposes existence as a boolean
    // probe precisely because no check-and-set primitive exists across the
    // supported keychains.
    const replaced = keyring.exists(serverName);
    keyring.setPassword(serverName, password);
    deps.stdout.write(
      replaced
        ? `Replaced the existing password for "${serverName}" in the OS keychain (service "${CREDENTIAL_CHAIN_KEYCHAIN_SERVICE}").\n`
        : `Stored a password for "${serverName}" in the OS keychain (service "${CREDENTIAL_CHAIN_KEYCHAIN_SERVICE}").\n`,
    );
    return 0;
  } catch (e: unknown) {
    deps.stderr.write(
      `Error: could not write to the OS keychain for "${serverName}" — ${redactSecret(errorMessage(e), password)}\n`,
    );
    return 1;
  }
}

async function cmdDelete(args: string[], deps: ResolvedDeps): Promise<number> {
  const { positional, error } = parseArgs(args, []);
  if (error) {
    deps.stderr.write(`Error: ${error}\n\nUsage: iris-mcp-credentials delete <serverName>\n`);
    return 2;
  }
  if (positional.length !== 1) {
    deps.stderr.write(`Error: "delete" requires exactly one argument, <serverName>.\n\nUsage: iris-mcp-credentials delete <serverName>\n`);
    return 2;
  }
  const [serverName] = positional as [string];
  const nameError = serverNameError(serverName);
  if (nameError !== undefined) {
    deps.stderr.write(`Error: ${nameError}\n\nUsage: iris-mcp-credentials delete <serverName>\n`);
    return 2;
  }

  let keyring: KeyringPort;
  try {
    keyring = await deps.loadKeyring();
  } catch (e: unknown) {
    deps.stderr.write(`Error: ${errorMessage(e)}\n`);
    return 1;
  }

  let deleted: boolean;
  try {
    deleted = keyring.deleteCredential(serverName);
  } catch (e: unknown) {
    deps.stderr.write(`Error: could not delete the OS-keychain entry for "${serverName}" — ${errorMessage(e)}\n`);
    return 1;
  }

  if (!deleted) {
    deps.stderr.write(`No stored password found for "${serverName}".\n`);
    return 1;
  }

  deps.stdout.write(`Deleted the stored password for "${serverName}".\n`);
  return 0;
}

async function cmdList(args: string[], deps: ResolvedDeps): Promise<number> {
  const { positional, flags, error } = parseArgs(args, ["--json"]);
  if (error) {
    deps.stderr.write(`Error: ${error}\n\nUsage: iris-mcp-credentials list [--json]\n`);
    return 2;
  }
  if (positional.length !== 0) {
    deps.stderr.write(`Error: "list" takes no arguments.\n\nUsage: iris-mcp-credentials list [--json]\n`);
    return 2;
  }
  const wantJson = flags.has("--json");

  /**
   * Render an OPERATIONAL failure (exit 1) in whichever shape the caller
   * asked for. `list --json` previously returned before ever consulting
   * `--json`, so both its failure paths wrote plain text to stderr and
   * NOTHING to stdout — while `test --json` emits a payload on its failure
   * outcomes too. The rule is now uniform across the CLI and stated in
   * `--help` and the README: **an operational outcome (exit 0 or 1) under
   * `--json` always produces exactly one JSON object on stdout; usage errors
   * (exit 2) are always plain text on stderr**, because a usage error means
   * the flags themselves were not understood.
   */
  const fail = (message: string): number => {
    deps.stderr.write(`Error: ${message}\n`);
    if (wantJson) deps.stdout.write(`${JSON.stringify({ error: message })}\n`);
    return 1;
  };

  let keyring: KeyringPort;
  try {
    keyring = await deps.loadKeyring();
  } catch (e: unknown) {
    return fail(errorMessage(e));
  }

  let names: string[];
  try {
    const credentials: KeyringCredential[] = keyring.listCredentials();
    // Names ONLY — .password is discarded here and never touched again
    // (Task 3: "never print a password value in order to list"; the native
    // API bundles both fields, see KeyringPort.listCredentials).
    //
    // Inside the try, and defensive about the row shape: `findCredentials` is
    // a NATIVE call whose runtime output the TypeScript type does not
    // enforce. A row with a non-string `account` previously threw a TypeError
    // out of `runCli` entirely (`null.localeCompare`), turning a contracted
    // exit-1-with-remediation into a generic "unexpected error" — and, under
    // `--json`, into no JSON at all. A plain `.sort()` is used rather than
    // `localeCompare` so the machine-readable ordering does not depend on the
    // runtime's ICU data or the ambient locale (code review 2026-07-25).
    names = credentials
      .filter((c): c is KeyringCredential => typeof c?.account === "string")
      .map((c) => c.account)
      .sort();
  } catch (e: unknown) {
    return fail(`could not list OS-keychain entries — ${errorMessage(e)}`);
  }

  if (wantJson) {
    deps.stdout.write(`${JSON.stringify({ names })}\n`);
  } else if (names.length === 0) {
    deps.stdout.write("No stored passwords.\n");
  } else {
    for (const name of names) {
      deps.stdout.write(`${name}\n`);
    }
  }
  return 0;
}

interface ConnectOutcome {
  /**
   * Whether the HTTP probe actually ran (31-2-3). `false` BOTH when the
   * credential was unresolved AND when registry mapping failed before any
   * HTTP call — the two "probe never ran" cases — so `attempted`/`ok` read as
   * a pair can always distinguish "the probe failed" from "the probe never
   * ran".
   */
  attempted: boolean;
  /** `null` when `attempted` is `false` (31-2-3): "never ran" is not "failed". */
  ok: boolean | null;
  /**
   * WHICH password the probe exercised (31-2-1): the provenance of the
   * REGISTRY profile whose password `connectFn` authenticated with — which
   * is the credential the servers would actually use, and can differ from
   * the chain-resolved one reported in `source` (e.g. a stale env password
   * resolves link 1 while the registry maps a different keychain password).
   * Absent when no profile was resolved (registry-mapping failure).
   */
  credentialSource?: ProfileSource;
  error?: string;
}

async function cmdTest(args: string[], deps: ResolvedDeps): Promise<number> {
  const { positional, flags, error } = parseArgs(args, ["--connect", "--json"]);
  if (error) {
    deps.stderr.write(`Error: ${error}\n\nUsage: iris-mcp-credentials test <serverName> [--connect] [--json]\n`);
    return 2;
  }
  if (positional.length !== 1) {
    deps.stderr.write(
      `Error: "test" requires exactly one argument, <serverName>.\n\nUsage: iris-mcp-credentials test <serverName> [--connect] [--json]\n`,
    );
    return 2;
  }
  const [serverName] = positional as [string];
  const nameError = serverNameError(serverName);
  if (nameError !== undefined) {
    deps.stderr.write(
      `Error: ${nameError}\n\nUsage: iris-mcp-credentials test <serverName> [--connect] [--json]\n`,
    );
    return 2;
  }
  const wantConnect = flags.has("--connect");
  const wantJson = flags.has("--json");

  // The one env value the CLI can always name as a secret, used as a
  // redaction key on every failure surface below.
  const envPassword = deps.env["IRIS_PASSWORD"];

  // The real chain documents "NEVER throws", but `resolveCredentialFn` is a
  // public seam and the chain's own link 3 shells out to an operator-supplied
  // credential helper. An escape here previously bypassed this command
  // entirely and surfaced as the bin's generic "unexpected error", with no
  // redaction at all (code review 2026-07-25).
  let result: Awaited<ReturnType<typeof resolveCredentialDefault>>;
  try {
    result = await deps.resolveCredentialFn(serverName, { env: deps.env });
  } catch (e: unknown) {
    const message = redactKnownSecrets(errorMessage(e), [envPassword]);
    deps.stderr.write(
      `Error: the credential chain failed while checking "${serverName}" — ${message}\n` +
        `${remediationText(serverName)}\n`,
    );
    if (wantJson) {
      deps.stdout.write(
        `${JSON.stringify({ name: serverName, resolved: false, source: null, error: message })}\n`,
      );
    }
    return 1;
  }
  const resolved = result !== undefined;
  const source: CredentialLinkSource | null = result?.source ?? null;

  let connect: ConnectOutcome | undefined;
  if (wantConnect) {
    if (!resolved) {
      connect = {
        attempted: false,
        ok: null,
        error: "No credential was resolved via the chain; skipping the connectivity check.",
      };
    } else {
      // `profile` is declared OUTSIDE the try (not `const` inside it) so the
      // catch clause can still redact its password, even though
      // `resolveProfile`/`connectFn` are what threw. `stage` distinguishes a
      // registry-mapping failure (no HTTP call was made — the operator needs
      // a DIFFERENT remedy, and 31-2-3 reports attempted:false/ok:null for
      // it) from a genuine connectivity failure (attempted:true/ok:false).
      let profile: IrisProfile | undefined;
      let stage: "registry" | "connect" = "registry";
      try {
        const registry: ProfileRegistry = await deps.loadProfileRegistryFn(deps.env, deps.platform);
        profile = resolveProfile(registry, serverName);
        stage = "connect";
        await deps.connectFn(profile);
        // 31-2-1: record WHICH password the probe exercised — the registry
        // profile's, with its provenance — not necessarily the chain-resolved
        // one reported in `source`.
        connect = { attempted: true, ok: true, credentialSource: profile.source ?? "env" };
      } catch (e: unknown) {
        // Redact against EVERY known secret, not just `profile.password` —
        // which is `undefined` precisely on the branch that matters, a throw
        // from `loadProfileRegistryFn`. That is the layer parsing
        // `IRIS_PROFILES`, and V8 embeds a source excerpt in a JSON
        // `SyntaxError`, so a malformed profiles blob really did print a
        // password verbatim (verified live, code review 2026-07-25).
        const safeMessage = redactKnownSecrets(errorMessage(e), [
          profile?.password,
          result?.password,
          envPassword,
        ]);
        connect = {
          // 31-2-3: a registry-stage failure means the probe never ran —
          // attempted:false/ok:null, indistinguishable from a genuine
          // connectivity failure no longer.
          attempted: stage === "connect",
          ok: stage === "connect" ? false : null,
          ...(profile !== undefined
            ? { credentialSource: profile.source ?? ("env" as ProfileSource) }
            : {}),
          error:
            stage === "registry"
              ? `${safeMessage} ${connectRemediationText(serverName)}`
              : safeMessage,
        };
      }
    }
  }

  const unresolvedMessage =
    `no password resolved — env, OS keychain, and credential helper were all checked. ` +
    `${remediationText(serverName)}`;

  if (wantJson) {
    const payload: Record<string, unknown> = { name: serverName, resolved, source };
    if (connect !== undefined) payload["connect"] = connect;
    // AC 31.2.2 "errors name remediations" must hold in the machine-readable
    // shape too — the remediation used to exist only on the human branch.
    if (!resolved) payload["error"] = unresolvedMessage;
    deps.stdout.write(`${JSON.stringify(payload)}\n`);
  } else if (resolved) {
    deps.stdout.write(`"${serverName}": resolved via ${source} link.\n`);
    if (connect !== undefined) {
      if (connect.ok) {
        // 31-2-1: name WHICH password the probe exercised — the registry
        // profile's, whose provenance can differ from the chain-resolved
        // credential named on the line above.
        deps.stdout.write(
          `"${serverName}": connect OK (HEAD /api/atelier/ succeeded; probed the registry profile's password, source: ${connect.credentialSource ?? "env"}).\n`,
        );
      } else {
        // Failures go to stderr like every other failure in this CLI, so
        // `test <name> --connect > result.txt` does not swallow the
        // diagnostic (code review 2026-07-25). 31-2-3 (Story 32.3 code
        // review): "the probe never ran" (attempted:false/ok:null — a
        // registry-mapping failure) is NOT "connect FAILED"; say SKIPPED,
        // mirroring the unresolved branch below.
        const label = connect.attempted ? "connect FAILED" : "connect SKIPPED";
        deps.stderr.write(`"${serverName}": ${label} — ${connect.error}\n`);
      }
    }
  } else {
    deps.stderr.write(`"${serverName}": ${unresolvedMessage}\n`);
    // A user who passed --connect is told the check was skipped rather than
    // left to infer it from the absence of a line.
    if (connect !== undefined) {
      deps.stderr.write(`"${serverName}": connect SKIPPED — ${connect.error}\n`);
    }
  }

  if (!resolved) return 1;
  if (connect !== undefined && !connect.ok) return 1;
  return 0;
}

// ════════════════════════════════════════════════════════════════════
// Entry point.
// ════════════════════════════════════════════════════════════════════

/**
 * Run the CLI for one invocation. Pure function of `argv`/`deps` — never
 * calls `process.exit`, so the caller (the sibling `credentials-cli.ts` bin
 * entry, or a test) decides what to do with the returned exit code.
 *
 * @param argv - Arguments AFTER the command name (i.e. `process.argv.slice(2)`).
 * @param deps - Injectable seams (AC 31.1.2-style discipline) — production
 *   callers omit this entirely.
 */
export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const resolved = resolveDeps(deps);

  if (argv.includes("-h") || argv.includes("--help")) {
    resolved.stdout.write(HELP_TEXT);
    return 0;
  }

  const [command, ...rest] = argv;
  if (command === undefined) {
    resolved.stderr.write(`Error: no command given.\n\n${HELP_TEXT}`);
    return 2;
  }

  switch (command) {
    case "set":
      return cmdSet(rest, resolved);
    case "delete":
      return cmdDelete(rest, resolved);
    case "list":
      return cmdList(rest, resolved);
    case "test":
      return cmdTest(rest, resolved);
    default:
      resolved.stderr.write(`Error: unknown command "${command}". Valid commands: set, delete, list, test.\n\n${HELP_TEXT}`);
      return 2;
  }
}
