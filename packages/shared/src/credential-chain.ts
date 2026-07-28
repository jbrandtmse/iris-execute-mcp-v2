/**
 * Credential chain for Server-Manager-sourced profiles (Epic 31, Story 31.1).
 *
 * Completes a Server-Manager profile that {@link resolveServerManagerProfiles}
 * (`server-manager-source.ts`) tagged `credentialStatus: "unresolved"` — i.e.
 * one lacking a usable inline legacy `password` — by trying, in order (AC
 * 31.1.1):
 *
 * 1. **Explicit env** — `IRIS_PROFILES.<name>.password`, or `IRIS_PASSWORD`
 *    for the reserved `default` name. **Never fires through
 *    `loadProfileRegistry`** (every `IRIS_PROFILES` name, and `default`, is
 *    already in the registry and is therefore filtered out before the chain
 *    runs — environment definitions always win); it is live for direct
 *    {@link resolveCredential} callers such as Story 31.2's CLI. See
 *    {@link resolveEnvPassword}.
 * 2. **OS keychain** — service `iris-mcp`, account `<serverName>`, via
 *    `@napi-rs/keyring` (an `optionalDependency` — see `package.json`).
 *    Loaded behind a guarded dynamic `import()`; a native-module load failure
 *    (missing prebuilt binary, unsupported platform/CI image) logs at debug
 *    and SKIPS this link — it never crashes the chain.
 * 3. **Credential helper** — `IRIS_CREDENTIAL_HELPER`, an operator-configured
 *    command run with the server name as `argv[1]` (via `argv`, never
 *    shell-interpolated — no injection risk from a server name containing
 *    shell metacharacters). Trimmed stdout is the password; a non-zero exit
 *    or a 10s timeout skips the link (never fatal); stderr is passed through
 *    to the logs but SCRUBBED first (a naive helper may echo the password to
 *    stderr) — and WITHHELD entirely when the helper produced no stdout to
 *    scrub against, see {@link scrubHelperStderr}.
 *
 *    **Cost note.** `spawnSync` is synchronous, and profiles are completed
 *    sequentially, so a configured-but-unreachable helper costs up to
 *    10s × (password-less profiles) of BLOCKED event loop inside
 *    `McpServerBase.start()`. Keep `IRIS_SM_SERVERS` tight when using a
 *    helper against a large roster.
 * 4. **Exhausted** — {@link resolveServerManagerCredentials} excludes the
 *    profile with a `logger.warn` naming ALL THREE remediations verbatim
 *    (`iris-mcp-credentials set <name>`, `IRIS_CREDENTIAL_HELPER`,
 *    `IRIS_PROFILES`); under `IRIS_SERVER_MANAGER=required` this escalates to
 *    a thrown startup failure — see the Dev Notes on `server-manager-source.ts`
 *    for why this is a SEPARATE `required` check from the zero-definitions-
 *    found one.
 *
 * **Secret discipline.** No resolved password is ever logged or thrown in an
 * error message from any link. {@link resolveCredential} never throws — every
 * link degrades independently (a link's own failure just advances to the
 * next); only {@link resolveServerManagerCredentials}'s caller-controlled
 * `required` escalation throws, and that message never contains a password.
 *
 * **Sibling module, not a deepened cycle (Rule #52 / project-rules #52).**
 * This module imports the `ServerManagerProfileResult` TYPE from
 * `server-manager-source.ts` (erased at compile time — no runtime import) but
 * deliberately does NOT import anything (type or value) from `profiles.ts`,
 * even though `profiles.ts` imports FROM this module (`loadProfileRegistry`
 * calls {@link resolveServerManagerCredentials}). Importing back from
 * `profiles.ts` (e.g. for the `DEFAULT_PROFILE_NAME` constant) would open a
 * NEW two-way cycle beyond the existing documented `profiles.ts` ↔
 * `server-manager-source.ts` one; the reserved default-profile name is
 * duplicated locally instead ({@link RESERVED_DEFAULT_PROFILE_NAME}).
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import type {
  ServerManagerMode,
  ServerManagerProfileResult,
} from "./server-manager-source.js";
import type { IrisProfile } from "./profiles.js";
import { logger } from "./logger.js";

/** Mirrors `DEFAULT_PROFILE_NAME` in `profiles.ts` — not imported (see module doc comment: avoids a new import cycle). */
const RESERVED_DEFAULT_PROFILE_NAME = "default";

/** OS-keychain service name every profile's credential is stored under (AC 31.1.1 link 2). */
export const CREDENTIAL_CHAIN_KEYCHAIN_SERVICE = "iris-mcp";

/** Hard timeout for `IRIS_CREDENTIAL_HELPER` (AC 31.1.1 link 3). */
export const CREDENTIAL_HELPER_TIMEOUT_MS = 10_000;

/** Which link resolved a password — useful for `iris-mcp-credentials test` (Story 31.2) and for chain tests. */
export type CredentialLinkSource = "env" | "keychain" | "helper";

/** The outcome of a successful {@link resolveCredential} call. */
export interface CredentialLinkResult {
  password: string;
  source: CredentialLinkSource;
}

/**
 * Injectable seams + environment for {@link resolveCredential} /
 * {@link resolveServerManagerCredentials}. Production code omits
 * `getKeychainPassword`/`runCredentialHelper` (falling back to the real
 * `@napi-rs/keyring` / `child_process` implementations); tests inject fakes so
 * **no test ever touches a real keychain or spawns the configured helper**
 * (AC 31.1.2).
 */
export interface CredentialChainOptions {
  /** Environment map (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
  /**
   * Injectable OS-keychain lookup. Must never throw (a rejection is treated
   * the same as "no password from this link", but the default implementation
   * never rejects either). Defaults to the guarded `@napi-rs/keyring` import.
   */
  getKeychainPassword?: (serverName: string) => Promise<string | undefined>;
  /**
   * Injectable credential-helper runner. `command` is the raw
   * `IRIS_CREDENTIAL_HELPER` string; `serverName` is appended as the final
   * argv entry by the caller's chosen invocation strategy. Defaults to the
   * real `spawnSync`-based implementation (argv-based, 10s timeout).
   */
  runCredentialHelper?: (command: string, serverName: string) => Promise<string | undefined>;
}

/**
 * Split a command line into argv tokens, honoring simple single/double-quoted
 * segments (so a helper path containing spaces, e.g. a quoted Windows path,
 * survives). Not a full shell-grammar parser — `IRIS_CREDENTIAL_HELPER` is an
 * operator-authored config value, never untrusted input; the server NAME
 * (which IS caller/settings-file-sourced) is always appended as its own argv
 * entry afterward, never through this tokenizer, so it can never be
 * mis-parsed into multiple arguments or interpreted as a flag.
 */
function splitCommandLine(raw: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const token = match[1] ?? match[2] ?? match[3] ?? "";
    if (token !== "") tokens.push(token);
  }
  return tokens;
}

/**
 * Below this length a candidate secret cannot be substring-redacted without
 * corrupting unrelated text (project rule #9) — the whole body is withheld
 * instead of partially redacted.
 */
const SECRET_MIN_REDACTION_LENGTH = 4;

/** Emitted in place of stderr whose text could contain a too-short credential. */
const WITHHELD_SHORT_SECRET = "[withheld: may contain the resolved credential]";

/**
 * Build the loggable form of a credential helper's stderr (AC 31.1.1 link 3
 * "stderr passed through to logs", reconciled with Task 7 "no resolved
 * password may appear in any log line"). A naive helper may echo the secret
 * to stderr, so the text is only ever logged after redaction against every
 * value the chain could treat as the password:
 *
 * - the whole trimmed stdout (what {@link runCredentialHelperDefault} returns
 *   as the password), AND
 * - each individual non-empty LINE of stdout — a helper such as
 *   `pass show …` prints the password on line 1 followed by metadata, so the
 *   whole-blob key alone would not match the secret as it appears in stderr
 *   (code review 2026-07-25).
 *
 * **No stdout at all ⇒ the body is WITHHELD.** When the helper failed before
 * writing anything to stdout there is no candidate to redact against, so the
 * text cannot be shown to be secret-free — a wrapper running under `set -x`,
 * or one that prints a decrypted value on a diagnostic channel before
 * exiting non-zero, would otherwise leak in cleartext. Only the byte count
 * and an instruction to run the command manually are logged; the interactive
 * diagnostic surface for a misbehaving helper is `iris-mcp-credentials test`
 * (Story 31.2).
 */
function scrubHelperStderr(rawStderr: string, stdoutCandidate: string): string {
  if (rawStderr.trim() === "") return "";

  const candidates = [
    ...new Set(
      [stdoutCandidate, ...stdoutCandidate.split(/\r?\n/)]
        .map((candidate) => candidate.trim())
        .filter((candidate) => candidate !== ""),
    ),
  ];

  if (candidates.length === 0) {
    return (
      `[withheld: ${rawStderr.length} byte(s) of stderr — the helper produced no stdout, so ` +
      `this text cannot be checked for a credential. Run the IRIS_CREDENTIAL_HELPER command ` +
      `manually to inspect it.]`
    );
  }

  if (
    candidates.some(
      (candidate) =>
        candidate.length < SECRET_MIN_REDACTION_LENGTH && rawStderr.includes(candidate),
    )
  ) {
    return WITHHELD_SHORT_SECRET;
  }

  let scrubbed = rawStderr;
  for (const candidate of candidates) {
    if (candidate.length < SECRET_MIN_REDACTION_LENGTH) continue;
    scrubbed = scrubbed.split(candidate).join("[REDACTED]");
  }
  return scrubbed;
}

/**
 * Normalize whatever a chain link produced into a usable password, or
 * `undefined`. Deliberately tolerant of a NON-STRING value (`null`,
 * `undefined`, a number, a Buffer): {@link CredentialChainOptions} is public
 * API and `@napi-rs/keyring`'s `getPassword()` is itself typed
 * `string | null`, so a consumer passing that through directly must not be
 * able to crash the chain (code review 2026-07-25).
 */
function usablePassword(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Read `IRIS_PROFILES.<name>.password` out of the env map. Never throws: a
 * malformed `IRIS_PROFILES` would already have failed fast earlier in
 * `loadProfileRegistry` (`buildProfileRegistry`); this is a defensive
 * best-effort re-parse for callers (including direct unit tests and Story
 * 31.2's CLI) that invoke {@link resolveCredential} outside that guarded path.
 */
function readProfilesEnvPassword(
  serverName: string,
  env: Record<string, string | undefined>,
): string | undefined {
  const raw = env.IRIS_PROFILES;
  if (raw === undefined || raw === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const entry = (parsed as Record<string, unknown>)[serverName];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    return usablePassword((entry as Record<string, unknown>)["password"]);
  } catch {
    return undefined;
  }
}

/**
 * Link 1 — explicit env (AC 31.1.1). `IRIS_PROFILES.<name>.password` for any
 * name, plus `IRIS_PASSWORD` as the fallback for the reserved `default` name.
 *
 * **`IRIS_PROFILES.default.password` beats `IRIS_PASSWORD`**, matching
 * `buildProfileRegistry`'s own documented precedence for the reserved name
 * (`profiles.ts` warns that an `IRIS_PROFILES` `default` entry "overrides the
 * `IRIS_*`-derived default profile"). Checking only `IRIS_PASSWORD` for
 * `default` inverted that, which would make Story 31.2's
 * `iris-mcp-credentials test default` report a credential the server would
 * not actually use (code review 2026-07-25).
 *
 * **Reachability note.** Through the production entry point
 * (`loadProfileRegistry`) this link never fires: every `IRIS_PROFILES` key —
 * and `default` — is already in the registry, and a Server-Manager name
 * already present in the registry is filtered out BEFORE the chain runs
 * (environment definitions always win). The link is live for direct
 * {@link resolveCredential} callers, which is what Story 31.2's CLI is. See
 * `profiles.ts` and the README for the precedence rule an operator actually
 * needs.
 */
function resolveEnvPassword(
  serverName: string,
  env: Record<string, string | undefined>,
): string | undefined {
  const fromProfiles = readProfilesEnvPassword(serverName, env);
  if (fromProfiles !== undefined) return fromProfiles;
  if (serverName === RESERVED_DEFAULT_PROFILE_NAME) {
    return usablePassword(env.IRIS_PASSWORD);
  }
  return undefined;
}

/**
 * Link 2 — OS keychain default implementation (AC 31.1.1). Guarded dynamic
 * `import()`: a native-module load failure (missing prebuilt binary,
 * unsupported platform) logs at debug and resolves `undefined` — NEVER
 * throws. `Entry.getPassword()` itself is synchronous per the installed
 * `@napi-rs/keyring` `.d.ts` (verified against `node_modules/@napi-rs/keyring/
 * index.d.ts`, Rule #16); any NoEntry/Ambiguous error it throws is likewise
 * caught and treated as "no password from this link".
 */
let keyringLoadFailureLogged = false;

async function getKeychainPasswordDefault(serverName: string): Promise<string | undefined> {
  let keyringModule: typeof import("@napi-rs/keyring");
  try {
    keyringModule = await import("@napi-rs/keyring");
  } catch (e: unknown) {
    // Node does NOT cache a failed module resolution, so this runs once per
    // profile. Log the (identical) diagnostic only the first time — N
    // password-less profiles on a platform with no prebuilt binary otherwise
    // emit N copies of the same line (code review 2026-07-25).
    if (!keyringLoadFailureLogged) {
      keyringLoadFailureLogged = true;
      logger.debug(
        `IRIS credential chain: OS keychain link unavailable (@napi-rs/keyring failed to ` +
          `load — ${e instanceof Error ? e.message : String(e)}). Skipping this link ` +
          `for every profile in this process.`,
      );
    }
    return undefined;
  }

  try {
    const entry = new keyringModule.Entry(CREDENTIAL_CHAIN_KEYCHAIN_SERVICE, serverName);
    // `getPassword()` is typed `string | null` in the installed .d.ts
    // (verified, Rule #16); `usablePassword` also absorbs whitespace-only.
    return usablePassword(entry.getPassword());
  } catch (e: unknown) {
    logger.debug(
      `IRIS credential chain: OS keychain lookup for "${serverName}" failed — ` +
        `${e instanceof Error ? e.message : String(e)}. Skipping this link.`,
    );
    return undefined;
  }
}

/**
 * Link 3 — credential helper default implementation (AC 31.1.1). Runs
 * `command`'s first token as the executable and the rest as base args, with
 * `serverName` appended as the FINAL argv entry — always via the `args` array
 * of `spawnSync`, never a shell string, so a server name containing shell
 * metacharacters cannot be interpreted (no injection risk). 10s timeout;
 * non-zero exit or a timeout-induced signal SKIPS the link (never throws);
 * stderr is scrubbed for the resolved stdout password before being logged (a
 * naive helper may echo the secret to stderr).
 */
function runCredentialHelperDefault(
  command: string,
  serverName: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const tokens = splitCommandLine(command);
    const executable = tokens[0];
    if (executable === undefined) {
      // e.g. IRIS_CREDENTIAL_HELPER='""' — non-empty, so the caller's
      // configured-check passed, but it tokenizes to nothing. Warn rather
      // than resolve silently: an operator who set the variable is entitled
      // to know it produced no runnable command. The raw value is NOT echoed
      // (an operator may have embedded a secret in it).
      logger.warn(
        `IRIS credential chain: IRIS_CREDENTIAL_HELPER is set but contains no runnable ` +
          `command (it tokenized to zero arguments). Skipping this link.`,
      );
      resolve(undefined);
      return;
    }
    const args = [...tokens.slice(1), serverName];

    let result: SpawnSyncReturns<string>;
    try {
      result = spawnSync(executable, args, {
        timeout: CREDENTIAL_HELPER_TIMEOUT_MS,
        encoding: "utf8",
        windowsHide: true,
      });
    } catch (e: unknown) {
      logger.warn(
        `IRIS credential chain: could not spawn IRIS_CREDENTIAL_HELPER ("${executable}") — ` +
          `${e instanceof Error ? e.message : String(e)}. Skipping this link.`,
      );
      resolve(undefined);
      return;
    }

    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const rawStderr = typeof result.stderr === "string" ? result.stderr : "";
    const loggableStderr = scrubHelperStderr(rawStderr, stdout);
    const logStderrIfAny = (): void => {
      if (loggableStderr.trim() !== "") {
        logger.debug(`IRIS_CREDENTIAL_HELPER stderr (server "${serverName}"): ${loggableStderr}`);
      }
    };

    // `result.error` MUST be examined before `result.signal`: a real
    // `spawnSync` timeout populates BOTH (`error.code === "ETIMEDOUT"` and
    // `signal === "SIGTERM"` — verified live on this machine, code review
    // 2026-07-25), so the timeout case is distinguished HERE by error code
    // rather than by the signal branch below (which then covers only a child
    // killed by something other than our own timeout).
    if (result.error) {
      const errorCode = (result.error as NodeJS.ErrnoException).code;
      if (errorCode === "ETIMEDOUT") {
        logger.warn(
          `IRIS credential chain: IRIS_CREDENTIAL_HELPER for "${serverName}" did not finish ` +
            `within ${CREDENTIAL_HELPER_TIMEOUT_MS / 1000}s and was terminated` +
            `${result.signal ? ` (signal ${result.signal})` : ""}. Skipping this link.`,
        );
      } else {
        logger.warn(
          `IRIS credential chain: IRIS_CREDENTIAL_HELPER ("${executable}") could not be run — ` +
            `${result.error.message}. Skipping this link.` +
            // A spawn failure is the single most actionable helper
            // misconfiguration, so it warns (never debug-only). EINVAL is
            // almost always a Windows .cmd/.bat shim: since Node's
            // CVE-2024-27980 hardening those cannot be executed without a
            // shell, and this chain deliberately never uses one (the server
            // name must never reach a shell parser).
            (errorCode === "EINVAL"
              ? ` (On Windows, Node cannot execute a .cmd/.bat file directly — point ` +
                `IRIS_CREDENTIAL_HELPER at the real executable, or at ` +
                `"cmd /c <your-helper.cmd>".)`
              : ""),
        );
      }
      logStderrIfAny();
      resolve(undefined);
      return;
    }

    if (result.signal) {
      logger.warn(
        `IRIS credential chain: IRIS_CREDENTIAL_HELPER for "${serverName}" was terminated ` +
          `(signal ${result.signal}). Skipping this link.`,
      );
      logStderrIfAny();
      resolve(undefined);
      return;
    }

    if (result.status !== 0) {
      logger.warn(
        `IRIS credential chain: IRIS_CREDENTIAL_HELPER for "${serverName}" exited with code ` +
          `${result.status}. Skipping this link.`,
      );
      logStderrIfAny();
      resolve(undefined);
      return;
    }

    logStderrIfAny();
    resolve(stdout !== "" ? stdout : undefined);
  });
}

/**
 * Attempt to resolve a password for `serverName` via the ordered chain
 * (links 1-3 of AC 31.1.1). Returns `undefined` when every link is exhausted
 * — the caller ({@link resolveServerManagerCredentials}) owns link 4
 * (exclusion + remediation logging + `required` escalation). NEVER throws: a
 * link's own failure (including one from an injected test double) is caught
 * and treated as "skip to the next link".
 *
 * @param serverName - The Server-Manager profile name (also the OS-keychain
 *   account and the credential-helper's `argv[1]`).
 * @param options    - Injectable deps for tests (AC 31.1.2); production
 *   callers omit `getKeychainPassword`/`runCredentialHelper`.
 */
export async function resolveCredential(
  serverName: string,
  options: CredentialChainOptions = {},
): Promise<CredentialLinkResult | undefined> {
  const env = options.env ?? process.env;

  // Link 1 — explicit env.
  const envPassword = resolveEnvPassword(serverName, env);
  if (envPassword !== undefined) {
    return { password: envPassword, source: "env" };
  }

  // Link 2 — OS keychain.
  const getKeychainPassword = options.getKeychainPassword ?? getKeychainPasswordDefault;
  let keychainPassword: string | undefined;
  try {
    // `usablePassword` is applied INSIDE the try (code review 2026-07-25):
    // `CredentialChainOptions` is public API and `@napi-rs/keyring`'s own
    // `getPassword()` is typed `string | null`, so the most natural consumer
    // wiring is a direct passthrough that can hand back `null`. Calling
    // `.trim()` on that outside the guard threw a TypeError which escaped
    // this function, `resolveServerManagerCredentials`, `loadProfileRegistry`
    // and `McpServerBase.start()` — breaking this module's "NEVER throws"
    // contract and failing server startup.
    keychainPassword = usablePassword(await getKeychainPassword(serverName));
  } catch (e: unknown) {
    // Belt-and-braces: the default implementation above never throws, but an
    // injected test double (or a future native-module edge case) might. A
    // keychain failure must never abort the chain.
    logger.debug(
      `IRIS credential chain: keychain link error for "${serverName}" — ` +
        `${e instanceof Error ? e.message : String(e)}. Skipping this link.`,
    );
    keychainPassword = undefined;
  }
  if (keychainPassword !== undefined) {
    return { password: keychainPassword, source: "keychain" };
  }

  // Link 3 — credential helper (only attempted when configured).
  const helperCommand = env.IRIS_CREDENTIAL_HELPER;
  if (helperCommand !== undefined && helperCommand.trim() !== "") {
    const runCredentialHelper = options.runCredentialHelper ?? runCredentialHelperDefault;
    let helperPassword: string | undefined;
    try {
      // `usablePassword` inside the try — same never-throws reasoning as the
      // keychain link above.
      helperPassword = usablePassword(await runCredentialHelper(helperCommand, serverName));
    } catch (e: unknown) {
      logger.debug(
        `IRIS credential chain: credential-helper link error for "${serverName}" — ` +
          `${e instanceof Error ? e.message : String(e)}. Skipping this link.`,
      );
      helperPassword = undefined;
    }
    if (helperPassword !== undefined) {
      return { password: helperPassword, source: "helper" };
    }
  }

  return undefined;
}

/** {@link resolveServerManagerCredentials} options: the chain deps plus the active `IRIS_SERVER_MANAGER` mode (for the `required` escalation). */
export interface ResolveServerManagerCredentialsOptions extends CredentialChainOptions {
  mode: ServerManagerMode;
}

/**
 * The three remediations named verbatim in every exhaustion message
 * (AC 31.1.1 link 4).
 *
 * The `IRIS_PROFILES` remediation is deliberately qualified with "with its
 * full connection fields": an `IRIS_PROFILES` entry does NOT complete a
 * Server-Manager definition, it REPLACES it (environment names always win —
 * see `loadProfileRegistry`), so a password-only stanza silently produces a
 * profile that inherits the LOCAL host/port/username. The unqualified wording
 * walked operators straight into pointing a remote credential at their local
 * instance (code review 2026-07-25).
 */
function remediationText(serverName: string): string {
  return (
    `run "iris-mcp-credentials set ${serverName}" (OS keychain), set IRIS_CREDENTIAL_HELPER ` +
    `to a command that can supply it, or define "${serverName}" with its full connection ` +
    `fields (host, port, username, password) via IRIS_PROFILES.`
  );
}

/**
 * Complete every `entries` item (Story 31.0's widened
 * {@link ServerManagerProfileResult}`[]`) into a final `IrisProfile[]`:
 * already-`"resolved"` entries pass through unchanged (`credentialStatus` is
 * stripped — it plays no further role once a profile is in the registry);
 * `"unresolved"` entries are run through {@link resolveCredential}.
 *
 * **Link 4 (exhausted).** An entry the chain could not complete is EXCLUDED
 * from the returned array, with a `logger.warn` naming ALL THREE remediations
 * verbatim (AC 31.1.1). **`required`-mode escalation** (Task 4 — deliberately
 * a SEPARATE check from `resolveServerManagerProfiles`'s own zero-definitions
 * `required` check): if `mode === "required"` and at least one entry was
 * exhausted, throws a single aggregate `Error` naming every exhausted profile
 * — after every entry has had its chance (never short-circuits on the first
 * failure), so one profile's exhaustion never hides another's.
 *
 * @param entries - {@link resolveServerManagerProfiles}'s output.
 * @param options - Chain deps (AC 31.1.2 injection) + the active mode.
 * @throws {Error} When `options.mode === "required"` and the chain could not
 *   resolve a password for at least one entry. The message never contains a
 *   password.
 */
export async function resolveServerManagerCredentials(
  entries: ServerManagerProfileResult[],
  options: ResolveServerManagerCredentialsOptions,
): Promise<IrisProfile[]> {
  const resolvedProfiles: IrisProfile[] = [];
  const exhaustedNames: string[] = [];

  for (const entry of entries) {
    const { credentialStatus, ...profile } = entry;

    if (credentialStatus === "resolved") {
      resolvedProfiles.push(profile);
      continue;
    }

    const result = await resolveCredential(entry.name, options);
    if (result !== undefined) {
      resolvedProfiles.push({ ...profile, password: result.password });
    } else {
      exhaustedNames.push(entry.name);
      logger.warn(
        `IRIS_SERVER_MANAGER: server "${entry.name}" has no password available — the ` +
          `credential chain (env, OS keychain, credential helper) was exhausted. ` +
          `Remediation: ${remediationText(entry.name)}`,
      );
    }
  }

  if (options.mode === "required" && exhaustedNames.length > 0) {
    throw new Error(
      `IRIS_SERVER_MANAGER=required but the credential chain could not resolve a password ` +
        `for: ${exhaustedNames.join(", ")}. Remediation per profile: run ` +
        `"iris-mcp-credentials set <name>" (OS keychain), set IRIS_CREDENTIAL_HELPER, or ` +
        `define the profile with its full connection fields via IRIS_PROFILES.`,
    );
  }

  return resolvedProfiles;
}
