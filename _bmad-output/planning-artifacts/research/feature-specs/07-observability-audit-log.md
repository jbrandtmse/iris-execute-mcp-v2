# Spec 07 — Tool-Call Observability & Session Audit Log (`IRIS_AUDIT_LOG`)

**Server:** `@iris-mcp/shared` (framework, all 5 servers) | **Priority:** 7 (second wave) | **Effort:** ~3 stories
**Governance:** logging is server **configuration**, not a tool — deliberately NOT bypassable
via `IRIS_GOVERNANCE` (an operator-mandated audit trail an AI client could switch off would be
worthless). No new tool keys in v1.
**Prereqs:** none | **Read first:** [`00-conventions.md`](00-conventions.md),
`packages/shared/src/server-base.ts` (`handleToolCall` — the single choke point where the
governance gate already runs), `packages/shared/src/config.ts`, `packages/shared/src/logger.ts`

## 1. Objective

An opt-in, structured, secrets-free audit trail of every MCP tool call: who-ish (session),
what (tool/action), where (profile + namespace), outcome (ok / error / governance-denied),
duration. This is the PRD's own Post-MVP "tool usage analytics and audit logging" item, the
rarest high-value capability in the MCP market, and the concrete answer to "what did the AI do
to prod last Tuesday?" — decisive in the suite's regulated-industry (healthcare) market. It
also makes the governance layer *visible*: denials become auditable events.

## 2. Configuration

| Env var | Default | Meaning |
|---|---|---|
| `IRIS_AUDIT_LOG` | unset (OFF) | Absolute path to a JSONL audit file. Set = enabled. |
| `IRIS_AUDIT_LOG_MAX_MB` | `50` | Rotate at this size: rename to `<path>.1` (single generation, overwrite prior `.1`). |
| `IRIS_AUDIT_LOG_PARAMS` | `false` | When `true`, include the REDACTED parameter object per entry. When `false`, only parameter key-names are logged (values dropped entirely — safest default). |

Startup behavior: if the path's directory is unwritable, **fail fast at startup** with a clear
message (an operator who configured auditing must not run unaudited silently). Unset ⇒
byte-for-byte today's behavior (Rule #19 mechanical proof).

## 3. Entry format (one JSON object per line)

```json
{ "ts": "2026-07-07T14:03:22.117Z", "session": "<uuid, generated once per server process>",
  "seq": 42, "serverPkg": "iris-ops-mcp", "tool": "iris_database_action", "action": "truncate",
  "profile": "prod", "namespace": "HSCUSTOM", "outcome": "denied",
  "denyReason": "GOVERNANCE_DISABLED", "presetApplied": "read-only",
  "durationMs": 3, "paramKeys": ["action","database","server"],
  "params": { "...only when IRIS_AUDIT_LOG_PARAMS=true, redacted..." },
  "error": "<sanitized message, only when outcome=error>" }
```

- `action` extracted from args when the tool's input schema has an `action` field, else null.
- `outcome`: `ok` | `error` (handler threw/isError) | `denied` (governance gate).
- `seq` monotonic per session (replay ordering).
- `presetApplied` populated when Spec 02 has shipped and applies; otherwise omitted — do not
  create a dependency on Spec 02.

## 4. Redaction (non-negotiable)

Recursive walk of the args object replacing the VALUE of any key matching (case-insensitive)
`password|passwd|secret|token|credential|apikey|api_key|authorization` with `"[REDACTED]"`,
and truncating any remaining string value > 2 KB to its first 256 chars + `"[TRUNCATED]"`.
Redaction applies BEFORE anything touches the write queue. Add fuzz tests: nested objects,
arrays of objects, key-case variants. The `error` field passes through the existing sanitized
message only (never raw exception dumps). **A test asserts a synthetic call containing a
password in three nesting positions produces a log line with zero occurrences of the value.**

## 5. Implementation

- **Interception point:** wrap the existing `handleToolCall` pipeline in `server-base.ts` —
  start timer before governance gate, write entry after resolution (ok/error/denied). ONE
  choke point; no per-tool changes; automatically covers all five servers AND future tools.
- **Writer:** in-process append queue → `fs.appendFile` batched (flush per entry is fine at
  MCP call rates; batch only if trivial), never throwing into the tool path — a failed write
  logs one stderr warning (via the existing `logger.ts`) and drops the entry counterically
  (`droppedEntries` counter included in a final flush line at shutdown). Audit writing must
  NEVER fail or slow a tool call (fire-and-forget with error swallow + counter).
- **Rotation:** size check per write (cheap `stat` cache, re-stat every N writes); rotate as §2.
- Session UUID: `crypto.randomUUID()` at server construction; include server package name and
  version in a `sessionStart` header line written when the log opens (first entry of each process).

## 6. Story breakdown

1. **Story 1 — interceptor + writer (1):** config parsing + fail-fast, entry format, redaction
   + fuzz tests, queue/rotation, back-compat proof (unset ⇒ zero behavioral change: snapshot
   of `handleToolCall` outputs + assert no fs writes attempted), unit tests with a temp-dir log.
2. **Story 2 — denial + outcome fidelity (1):** governance-denied entries (incl. structured
   `denyReason`), error-outcome entries (sanitized), `action` extraction, seq/session
   correctness across concurrent calls (async-ordering test), shutdown flush.
3. **Story 3 — docs + smokes (1):** README (new env vars + a "Compliance & Auditability"
   section — this is a marketing surface, write it well), client-config guides, CHANGELOG.
   Live smoke (Rules #22/#26 shape): built dist with `IRIS_AUDIT_LOG` set; run a real session
   (an ok read, a failing call, a governance-denied write); verify the three entries' fidelity;
   grep the file for the test password used — zero hits; verify rotation by setting
   `IRIS_AUDIT_LOG_MAX_MB` tiny.

## 7. Acceptance criteria

1. Unset `IRIS_AUDIT_LOG` ⇒ mechanically proven no-op (Rule #19).
2. ok / error / denied outcomes all logged with correct fields; denied entries carry
   `denyReason` (+ `presetApplied` when applicable).
3. Zero secret values in the log under fuzz + live smoke (grep assertion).
4. A crashing/full-disk audit sink never fails or blocks a tool call (test with an unwritable
   file mid-session — post-startup failures degrade, only startup fails fast).
5. Rotation works; sessions are reconstructable (session uuid + seq ordering test).
6. `IRIS_AUDIT_LOG_PARAMS` default `false` logs key names only.
7. Concurrent calls produce well-formed, non-interleaved JSONL lines.
8. Docs rollup complete; conventions §6 checklist complete.

## 8. Out of scope (v1 — candidate phase 2)

- `iris_audit_sessions` query/replay TOOL (would be a framework tool with Rule #31 counting
  implications — defer until file-based v1 proves the format).
- IRIS-global sink; OpenTelemetry span export; log shipping.
- Client identity beyond process-session (MCP has no end-user identity in stdio transport).
