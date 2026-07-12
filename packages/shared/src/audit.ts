/**
 * Opt-in, structured, secrets-free session audit log (`IRIS_AUDIT_LOG`).
 *
 * Story 29.0 (spec `07-observability-audit-log.md` §2-§6) provides the
 * interceptor + writer foundation: config parsing + startup fail-fast,
 * redaction, the JSONL entry shape, an in-process append queue with size-based
 * rotation, and degrade-never-throw semantics. It intentionally ships a BASIC
 * `outcome`/`action` derivation — rigorous outcome fidelity (structured
 * `denyReason`, `presetApplied` attribution, sanitized-error-only, schema-aware
 * `action` extraction, strict per-session monotonic `seq` under concurrency,
 * and shutdown-flush guarantees) is Story 29.1's scope (see the story's Dev
 * Notes "Scope seam" section). Story 29.1 closes that seam: `AuditEntryInput`
 * now carries optional `denyReason`/`presetApplied` (emitted only for a
 * `"denied"` outcome), `deriveAuditAction` (`server-base.ts`) is schema-aware,
 * and `AuditLogger.shutdown()` is wired into `McpServerBase.stop()`. Logging
 * is server CONFIGURATION, not a governed tool — it is deliberately NOT
 * bypassable via `IRIS_GOVERNANCE`.
 */

import { appendFile, rename, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { logger } from "./logger.js";

/** Case-insensitive key-name family redacted per spec §4. */
const REDACT_KEY_PATTERN =
  /password|passwd|secret|token|credential|apikey|api_key|authorization/i;

/** Replacement value for a redacted key. */
const REDACTED_VALUE = "[REDACTED]";

/** Any remaining string value over this many UTF-8 bytes is truncated (spec §4). */
const MAX_STRING_BYTES = 2048;

/** Number of characters kept from a truncated string, before the suffix. */
const TRUNCATED_KEEP_CHARS = 256;

/** Suffix appended to a truncated string value. */
const TRUNCATED_SUFFIX = "[TRUNCATED]";

/** Re-`stat` the audit file's on-disk size at most once every N writes. */
const STAT_REFRESH_INTERVAL = 20;

/** Parsed, enabled audit configuration. `undefined` = auditing is OFF. */
export interface AuditConfig {
  /** Absolute path to the JSONL audit file. */
  path: string;
  /** Rotation threshold in bytes (`IRIS_AUDIT_LOG_MAX_MB * 1024 * 1024`). */
  maxBytes: number;
  /** Whether to include the (redacted) parameter object per entry. */
  includeParams: boolean;
}

/**
 * Parse the audit-log environment variables (spec §2).
 *
 * | Variable                | Default    |
 * |-------------------------|------------|
 * | `IRIS_AUDIT_LOG`        | unset (OFF)|
 * | `IRIS_AUDIT_LOG_MAX_MB` | `50`       |
 * | `IRIS_AUDIT_LOG_PARAMS` | `false`    |
 *
 * Follows the `config.ts` `loadConfig` idiom: read from an injectable `env`,
 * `Number()` + range check, throw an `Error` naming the offending var.
 *
 * @returns `undefined` when `IRIS_AUDIT_LOG` is unset/empty (auditing OFF).
 * @throws {Error} When `IRIS_AUDIT_LOG_MAX_MB` is non-numeric or non-positive.
 */
export function parseAuditConfig(
  env: Record<string, string | undefined> = process.env,
): AuditConfig | undefined {
  const rawPath = env.IRIS_AUDIT_LOG;
  if (!rawPath) return undefined;

  const rawMaxMb = env.IRIS_AUDIT_LOG_MAX_MB ?? "50";
  const maxMb = Number(rawMaxMb);
  if (!Number.isFinite(maxMb) || maxMb <= 0) {
    throw new Error(
      `IRIS_AUDIT_LOG_MAX_MB must be a positive number. Received: "${rawMaxMb}".`,
    );
  }

  const includeParams = env.IRIS_AUDIT_LOG_PARAMS === "true";

  return {
    path: rawPath,
    maxBytes: maxMb * 1024 * 1024,
    includeParams,
  };
}

/**
 * Recursively redact sensitive values from an arbitrary args value (spec §4).
 *
 * Walks objects and arrays (including arrays of objects). Any key matching
 * {@link REDACT_KEY_PATTERN} (case-insensitive) has its VALUE replaced with
 * `"[REDACTED]"` regardless of type. Any remaining string value longer than
 * {@link MAX_STRING_BYTES} (UTF-8 bytes) is truncated to its first
 * {@link TRUNCATED_KEEP_CHARS} characters plus `"[TRUNCATED]"`.
 *
 * Pure function: never mutates the input (always clones objects/arrays it
 * descends into) so the caller's original args object is untouched.
 */
export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (REDACT_KEY_PATTERN.test(key)) {
        result[key] = REDACTED_VALUE;
      } else {
        result[key] = redactValue(source[key]);
      }
    }
    return result;
  }
  if (typeof value === "string" && Buffer.byteLength(value, "utf-8") > MAX_STRING_BYTES) {
    return `${value.slice(0, TRUNCATED_KEEP_CHARS)}${TRUNCATED_SUFFIX}`;
  }
  return value;
}

/** Outcome of a single tool call, as recorded in the audit entry (spec §3). */
export type AuditOutcome = "ok" | "error" | "denied";

/** Input to {@link AuditLogger.log} — the pre-redaction facts of one tool call. */
export interface AuditEntryInput {
  /** The tool name (`ToolDefinition.name`). */
  tool: string;
  /** Extracted `action` value, or `null` when not applicable (basic derivation). */
  action: string | null;
  /** Resolved `server` profile name. */
  profile: string;
  /** Resolved namespace. */
  namespace: string;
  /** Call outcome. */
  outcome: AuditOutcome;
  /** Wall-clock call duration in milliseconds. */
  durationMs: number;
  /** The call's argument key names (minus the framework `server` key). */
  paramKeys: string[];
  /**
   * The RAW (unredacted) argument object. Only ever written to the log when
   * the logger's config has `includeParams: true` — and even then, only
   * after {@link redactValue} has processed it. Never persisted verbatim.
   */
  params?: unknown;
  /** Sanitized error message. Only recorded when `outcome === "error"`. */
  error?: string;
  /**
   * Structured governance denial code (e.g. `"GOVERNANCE_DISABLED"`), read
   * from the denial's `structuredContent.code` (Story 29.1, AC 29.1.1).
   * Only recorded when `outcome === "denied"`.
   */
  denyReason?: string;
  /**
   * The active governance preset name (e.g. `"read-only"`), COPIED from the
   * denial's `structuredContent.presetApplied` — present only when the
   * preset (not an explicit `IRIS_GOVERNANCE` override) caused the denial
   * (mirrors `dispatchToolCall`'s `presetCaused` attribution). Only
   * recorded when `outcome === "denied"` AND the source field was present.
   */
  presetApplied?: string;
}

/** One JSON line written to the audit file (spec §3 entry format). */
interface AuditEntry {
  ts: string;
  session: string;
  seq: number;
  serverPkg: string;
  tool: string;
  action: string | null;
  profile: string;
  namespace: string;
  outcome: AuditOutcome;
  durationMs: number;
  paramKeys: string[];
  params?: unknown;
  error?: string;
  denyReason?: string;
  presetApplied?: string;
}

/**
 * Structured audit writer (spec §5). Owns:
 * - the per-process session UUID + monotonic `seq` counter (basic — a strict
 *   ordering guarantee under concurrency is Story 29.1's scope),
 * - the `sessionStart` header line (written once, on construction),
 * - a serialized in-process append queue (`fs.appendFile`, one line per call),
 * - size-based rotation (`<path>` &rarr; `<path>.1`, single generation), and
 * - degrade-never-throw semantics: a post-startup write failure is swallowed,
 *   logged once per failure, and counted in `droppedEntries`.
 *
 * Construction itself never throws on a write failure — the `sessionStart`
 * write is enqueued through the same degrade-never-throw path as any other
 * entry.
 */
export class AuditLogger {
  /** Session UUID, generated once per `AuditLogger` instance (server process). */
  readonly session: string;
  private seq = 0;
  private droppedEntries = 0;
  private cachedSize = 0;
  /**
   * Writes since the last real `fs.stat`. Seeded to {@link STAT_REFRESH_INTERVAL}
   * so the FIRST write re-stats (picking up a pre-existing file's size), then a
   * real stat runs only once every {@link STAT_REFRESH_INTERVAL} writes.
   */
  private writesSinceStat = STAT_REFRESH_INTERVAL;
  /** Serializes writes so entries append in call order and never interleave. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: AuditConfig,
    private readonly serverPkg: string,
    private readonly version: string,
  ) {
    this.session = randomUUID();
    this.enqueueWrite(
      JSON.stringify({
        type: "sessionStart",
        ts: new Date().toISOString(),
        session: this.session,
        serverPkg: this.serverPkg,
        version: this.version,
      }),
    );
  }

  /**
   * Record one tool-call entry (spec §3). Redaction (spec §4) happens here,
   * BEFORE the entry reaches the write queue. Never throws and never blocks
   * the caller on the actual file write — the write is enqueued and this
   * method returns immediately (fire-and-forget).
   */
  log(input: AuditEntryInput): void {
    this.seq += 1;
    const entry: AuditEntry = {
      ts: new Date().toISOString(),
      session: this.session,
      seq: this.seq,
      serverPkg: this.serverPkg,
      tool: input.tool,
      action: input.action,
      profile: input.profile,
      namespace: input.namespace,
      outcome: input.outcome,
      durationMs: input.durationMs,
      paramKeys: input.paramKeys,
    };
    if (this.config.includeParams && input.params !== undefined) {
      entry.params = redactValue(input.params);
    }
    if (input.outcome === "error" && input.error !== undefined) {
      entry.error = input.error;
    }
    if (input.outcome === "denied" && input.denyReason !== undefined) {
      entry.denyReason = input.denyReason;
    }
    if (input.outcome === "denied" && input.presetApplied !== undefined) {
      entry.presetApplied = input.presetApplied;
    }
    this.enqueueWrite(JSON.stringify(entry));
  }

  /** Current count of entries dropped due to a degraded (unwritable) sink. */
  get droppedEntryCount(): number {
    return this.droppedEntries;
  }

  /**
   * Flush a final line recording {@link droppedEntryCount} and await the
   * write queue draining. Safe to call multiple times.
   */
  async shutdown(): Promise<void> {
    this.enqueueWrite(
      JSON.stringify({
        type: "shutdown",
        ts: new Date().toISOString(),
        session: this.session,
        droppedEntries: this.droppedEntries,
      }),
    );
    await this.writeQueue;
  }

  /**
   * Enqueue a single already-serialized line onto the write queue. Each entry
   * is isolated: a failure writing THIS line is caught and swallowed without
   * poisoning the queue for subsequent entries (the `.catch` below always
   * resolves, so the next `.then` in the chain runs regardless of this
   * entry's outcome).
   */
  private enqueueWrite(line: string): void {
    this.writeQueue = this.writeQueue
      .then(() => this.writeLine(line))
      .catch((error: unknown) => {
        this.droppedEntries += 1;
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Audit log write failed; entry dropped: ${message}`);
      });
  }

  /** Append one line (with a trailing newline) to the audit file, rotating first if needed. */
  private async writeLine(line: string): Promise<void> {
    const bytes = Buffer.byteLength(line, "utf-8") + 1; // +1 for the trailing newline
    await this.maybeRotate(bytes);
    await appendFile(this.config.path, `${line}\n`, "utf-8");
    this.cachedSize += bytes;
  }

  /**
   * Rotate `<path>` &rarr; `<path>.1` (overwriting a prior `.1`) when the
   * cached size plus the about-to-be-written line would exceed
   * `config.maxBytes`. The cached size is refreshed from a real `fs.stat`
   * every {@link STAT_REFRESH_INTERVAL} writes (cheap drift correction — e.g.
   * a pre-existing file from an earlier process run) rather than on every
   * write.
   */
  private async maybeRotate(nextLineBytes: number): Promise<void> {
    this.writesSinceStat += 1;
    if (this.writesSinceStat >= STAT_REFRESH_INTERVAL) {
      this.writesSinceStat = 0;
      try {
        const stats = await stat(this.config.path);
        this.cachedSize = stats.size;
      } catch {
        this.cachedSize = 0;
      }
    }

    if (this.cachedSize + nextLineBytes > this.config.maxBytes) {
      try {
        await rename(this.config.path, `${this.config.path}.1`);
      } catch {
        // Nothing to rotate yet (e.g. the file doesn't exist on the very
        // first write) — proceed to create it fresh below.
      }
      this.cachedSize = 0;
    }
  }
}
