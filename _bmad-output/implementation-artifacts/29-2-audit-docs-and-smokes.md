# Story 29.2: Audit Docs + Smokes

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **prospective adopter (esp. in a regulated/healthcare shop) evaluating the suite**,
I want **clear, well-written documentation of the audit-log feature and a proven live smoke of a real session**,
so that **I can turn on a compliant, secrets-free tool-call audit trail with confidence it works end-to-end and leaks no secrets.**

## Acceptance Criteria

(From epics.md Epic 29 / binding spec `research/feature-specs/07-observability-audit-log.md` §6 story 3 + §7. Closing story of Epic 29's feature set. Consumes the Story 29.0/29.1 interceptor.)

- **AC 29.2.1 — Docs rollup (all surfaces + default-state callouts).**
  - **Root `README.md`**: add `IRIS_AUDIT_LOG` / `IRIS_AUDIT_LOG_MAX_MB` / `IRIS_AUDIT_LOG_PARAMS` rows to the env-var table (§2, near the `IRIS_GOVERNANCE` rows), each marked **Optional** with its default (`unset = OFF`, `50`, `false`); update the "single-server installs need no changes" additive note to include them. Add a **"Compliance & Auditability"** section (a MARKETING surface — write it well): what the audit log is, the JSONL entry shape, the secrets-free/redaction guarantee, the params-off-by-default posture, rotation, and — crucially — that **logging is server CONFIGURATION, deliberately NOT bypassable via `IRIS_GOVERNANCE`** (an AI client cannot switch off its own audit trail).
  - **Disambiguation (required):** explicitly distinguish this MCP **tool-call** audit log (`IRIS_AUDIT_LOG`, a framework feature across all five servers) from the existing IRIS **server-side security** audit tools `iris_audit_manage` (admin, `%SYS.Audit*`) and `iris_audit_events` (ops) — a reader must not conflate them.
  - **`docs/client-config/claude-code.md`, `claude-desktop.md`, `cursor.md`**: add the three optional audit vars to the shared env-var table (all Optional; brief meaning).
  - **`packages/shared/README.md`**: document the audit logger as a FRAMEWORK surface (Rule #31 — provided centrally in `server-base.ts`, appears on all five servers, in no package tool array).
  - **`CHANGELOG.md`**: an Epic 29 "Added — Tool-Call Observability & Session Audit Log (`IRIS_AUDIT_LOG`)" entry; state the default-OFF/no-op posture, no new tool/governance key, no bootstrap bump.
  - **`tool_support.md`**: a note that audit logging is server CONFIG (not a governed tool; not `IRIS_GOVERNANCE`-bypassable); default state OFF when unset. Tool count UNCHANGED (Rule #31 — no new tool).
  - **Default-state callouts** at each point of use (Rule #30): `IRIS_AUDIT_LOG` unset ⇒ OFF ⇒ mechanical no-op; `IRIS_AUDIT_LOG_PARAMS` default `false` ⇒ key-names only.
- **AC 29.2.2 — Live smoke (Rules #22/#26 shape; results recorded in this story file).** Against the BUILT dist with `IRIS_AUDIT_LOG` set and connected to live IRIS: run a real session covering **(a) an ok read, (b) a failing call, (c) a governance-denied write** (set `IRIS_GOVERNANCE`/`IRIS_GOVERNANCE_PRESET=read-only` to force the denial). Verify the three entries' fidelity (outcomes `ok`/`error`/`denied`; the denied entry carries `denyReason`; the error entry carries the sanitized message only). **Grep the log file for the test password used in a call's args → ZERO hits.** Verify rotation by setting `IRIS_AUDIT_LOG_MAX_MB` tiny and confirming a `<path>.1` generation appears. Record the exact commands + outputs in this story's Dev Agent Record. Delete any disposable smoke script afterward (conventions §6).
- **AC 29.2.3 — Spec §7 ACs 1–8 + conventions §6.** Confirm spec §7 ACs 1–8 all hold (1 no-op proof, 2 outcome fields, 3 zero-secret, 4 sink-failure-never-blocks, 5 rotation+seq-reconstructable, 6 params-off-by-default, 7 concurrency, 8 docs) — cite where each is proven (29.0/29.1 tests + this story's smoke). Complete the conventions §6 Definition-of-Done checklist for spec 07 (note the ObjectScript/`gen:bootstrap` lines are N/A — TS-only epic — and say so explicitly).

### Integration ACs

Story 29.2 is a docs + verification story — NOT service-introducing (no new module/service). It CONSUMES the Story 29.0/29.1 interceptor via the live smoke (a real MCP session through the built dist). No new producer wiring. Rule 1 satisfied by declaration: the audit interceptor's only consumer (`handleToolCall`) was wired in Story 29.0; this story adds no new surface.

## Tasks / Subtasks

- [x] **Task 1 — README rollup (AC 29.2.1)**
  - [x] Add the three `IRIS_AUDIT_LOG*` rows to the root README env-var table; update the additive "single-server needs no changes" note.
  - [x] Write the "Compliance & Auditability" section (marketing-quality prose): purpose, entry shape (one JSONL example), redaction/secrets-free guarantee, params-off-by-default, rotation, and the config-not-governance-bypassable point.
  - [x] Add the disambiguation vs `iris_audit_manage` / `iris_audit_events`.
- [x] **Task 2 — client-config guides + shared README + CHANGELOG + tool_support (AC 29.2.1)**
  - [x] Add the three optional audit vars to `docs/client-config/{claude-code,claude-desktop,cursor}.md` env tables.
  - [x] Document the framework audit surface in `packages/shared/README.md` (Rule #31 — no home package).
  - [x] CHANGELOG.md Epic 29 entry (default-OFF, no new tool/key/bootstrap).
  - [x] tool_support.md config-not-tool note + default state OFF; confirm tool count text unchanged.
- [x] **Task 3 — live smoke (AC 29.2.2) — dev authors the smoke + records evidence**
  - [x] Build the dist (`pnpm --filter @iris-mcp/shared build`; and the specific server package used for the smoke, e.g. `@iris-mcp/dev` or `@iris-mcp/ops`).
  - [x] Drive a real session (built server against live IRIS) with `IRIS_AUDIT_LOG` set: an ok read, a failing call, and a governance-denied write (force via `IRIS_GOVERNANCE_PRESET=read-only`). Include a call whose args carry a known test password.
  - [x] Assert the three outcomes/fidelity + `grep <password>` = 0 hits + rotation `<path>.1` with tiny `IRIS_AUDIT_LOG_MAX_MB`. Record commands + observed output in the Dev Agent Record. Delete the disposable script.
- [x] **Task 4 — spec §7 + conventions §6 (AC 29.2.3)**
  - [x] Map each spec §7 AC 1–8 to its proof (test file / smoke step). Complete conventions §6 checklist (mark ObjectScript/bootstrap lines N/A with reason).
  - [x] Full regression: `pnpm turbo run test` green; `pnpm gen:governance-baseline:check` exit 0; frozen baseline `1e62c5ad5bf7` + `BOOTSTRAP_VERSION` unchanged.

## Dev Notes

**Closing story — docs + verification, minimal/no production code.** The interceptor + writer (29.0) and fidelity (29.1) are done and green. This story is primarily DOCS + a live smoke. If a doc-driven review of the running behavior surfaces a genuine small defect, fix it here (with a test), but do NOT re-open 29.0/29.1 scope.

**Doc pattern to follow.** The root README already documents optional/additive env vars (`IRIS_GOVERNANCE`, `IRIS_GOVERNANCE_PRESET`, `IRIS_SQL_MAX_ROWS`) in the §2 env-var table (`README.md:77-83`) and a "Multiple Servers & Governance" section with default-state callouts. Mirror that exact style for the audit vars — Optional, default stated, "unset ⇒ today's behavior." The `IRIS_GOVERNANCE_PRESET=read-only` "Read-only mode" section (`README.md:247`) is the marketing-quality prose bar to match for the new "Compliance & Auditability" section.

**Disambiguation is REQUIRED (not optional polish).** `iris_audit_manage` (admin, `%SYS.Audit*` server-side security audit) and `iris_audit_events` (ops) already exist and are prominent in the README tool tables. `IRIS_AUDIT_LOG` is a completely different thing — the MCP process's own tool-call trail. A regulated-industry reader WILL conflate them unless the docs draw the line explicitly.

**Live smoke — real IRIS is available** (local IRISHealth on `localhost:52773`, `_SYSTEM`/`SYS`, HSCUSTOM). The governance-denied write is easiest forced with `IRIS_GOVERNANCE_PRESET=read-only` (blocks every write action suite-wide) — pick a write tool/action for the denied call and a read tool for the ok call. The failing call: an argument that makes the handler return `isError:true` (e.g. a bad namespace or malformed query). Redaction check: put a known password in a call's args with `IRIS_AUDIT_LOG_PARAMS=true`, then grep the file for it → 0 hits. This mirrors the Epic 26/27/28 built-dist live smokes (Rules #22/#26). Record everything in the story file; delete the script (conventions §6).

**Rule #30/#31/#43 (docs discipline).** Audit logging is a FRAMEWORK feature (all five servers, registered centrally, in no package tool array) — document it as such: root README + shared README + client-config guides + CHANGELOG + tool_support.md. Tool counts DO NOT move (no new tool). Default-state callout (write⇒disabled / read⇒enabled is N/A here — this isn't a governed action at all; the callout is "unset ⇒ OFF ⇒ no-op").

**Additive / Rule #19.** No production behavior change from docs. If any code touch is needed, keep the frozen baseline `1e62c5ad5bf7` + `BOOTSTRAP_VERSION` unchanged; no new tool/governance key/bootstrap bump.

### Project Structure Notes

- Docs only (+ possibly a tiny test if the smoke surfaces something): `README.md`, `docs/client-config/{claude-code,claude-desktop,cursor}.md`, `packages/shared/README.md`, `CHANGELOG.md`, `tool_support.md`.
- Any smoke test that ships stays `*.test.ts` and discoverable; a throwaway smoke SCRIPT is deleted after evidence capture (conventions §6). Do NOT commit disposable smoke scripts.

### References

- [Source: research/feature-specs/07-observability-audit-log.md#6-story-breakdown] — story 3 (docs + smokes)
- [Source: research/feature-specs/07-observability-audit-log.md#7-acceptance-criteria] — spec §7 ACs 1–8 to map
- [Source: research/feature-specs/00-conventions.md#6-definition-of-done-every-spec] — the DoD checklist to complete
- [Source: README.md#L77] — env-var table + additive note pattern
- [Source: README.md#L247] — "Read-only mode" marketing-prose bar for the new Compliance section
- [Source: README.md#L319] — existing `iris_audit_manage` table row (disambiguate from)
- [Source: docs/client-config/claude-code.md#L22] — shared env-var table to extend
- [Source: CHANGELOG.md] — `[Unreleased]` section to add the Epic 29 entry
- [Source: _bmad-output/implementation-artifacts/29-0-audit-interceptor-and-writer.md, 29-1-audit-outcome-fidelity.md] — the feature being documented + smoked

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story`.

### Debug Log References

None — no debugger/global-based debugging was needed. All evidence for AC 29.2.2 was captured by
driving the BUILT `dist/` output of `@iris-mcp/dev` and `@iris-mcp/admin` over real stdio against
live IRIS (`localhost:52773`, `_SYSTEM`/`SYS`, `HSCUSTOM`) with two disposable smoke scripts
(`packages/iris-dev-mcp/tmp-audit-smoke.mjs`, `packages/iris-admin-mcp/tmp-audit-smoke.mjs`), both
deleted after evidence capture per conventions §6. Full commands and observed output below.

**Build (prereq for the smoke):**
```
pnpm --filter @iris-mcp/shared build   # tsc clean
pnpm --filter @iris-mcp/dev build      # tsc clean
pnpm --filter @iris-mcp/admin build    # tsc clean
```

**Run 1 — fidelity (`@iris-mcp/dev`, default `IRIS_AUDIT_LOG_MAX_MB`, no rotation).** A real
`@modelcontextprotocol/sdk` `Client` + `StdioClientTransport` spawned `node dist/index.js` with
`IRIS_GOVERNANCE_PRESET=read-only`, `IRIS_AUDIT_LOG=<tmp>/audit.jsonl`, `IRIS_AUDIT_LOG_PARAMS=true`.
Three calls: `iris_global_list` (ok read), `iris_doc_get` on a nonexistent class (genuine
Atelier-404 error, with an undeclared `password` field in the raw call args as an initial redaction
probe), `iris_global_set` (write, blocked by the preset). Observed:
```
1) ok read  -> isError: false
2) failing call -> isError: true
3) denied write -> isError: true {"code":"GOVERNANCE_DISABLED","action":"iris_global_set","server":"default","presetApplied":"read-only"}
```
Resulting `audit.jsonl` (4 lines: header + 3 entries):
```json
{"type":"sessionStart","ts":"2026-07-12T05:03:34.728Z","session":"2a5575f8-...","serverPkg":"@iris-mcp/dev","version":"0.0.2"}
{"ts":"...","seq":1,"tool":"iris_global_list","action":null,"profile":"default","namespace":"HSCUSTOM","outcome":"ok","durationMs":8005,"paramKeys":["caseSensitive","namespace"],"params":{"caseSensitive":false,"namespace":"HSCUSTOM"}}
{"ts":"...","seq":2,"tool":"iris_doc_get","action":null,"profile":"default","namespace":"HSCUSTOM","outcome":"error","durationMs":8,"paramKeys":["name","namespace"],"params":{"name":"NonExistentClassForAuditSmoke9x7z.cls","namespace":"HSCUSTOM"},"error":"Document 'NonExistentClassForAuditSmoke9x7z.cls' not found in namespace 'HSCUSTOM'"}
{"ts":"...","seq":3,"tool":"iris_global_set","action":null,"profile":"default","namespace":"HSCUSTOM","outcome":"denied","durationMs":1,"paramKeys":["global","value","namespace"],"params":{"global":"AuditSmokeTemp9x7z","value":"x","namespace":"HSCUSTOM"},"denyReason":"GOVERNANCE_DISABLED","presetApplied":"read-only"}
```
Fidelity confirmed: `ok` carries neither `error`/`denyReason`/`presetApplied`; `error` carries the
sanitized single-line message only (no stack, no caret-global); `denied` carries both `denyReason`
and `presetApplied` (a preset-caused denial). **Finding:** the `password` field on call 2 does
**not** appear in `paramKeys`/`params` at all — not even redacted. Root-caused: the MCP SDK's
`McpServer.registerTool()` (`server-base.ts:911`) validates/parses incoming args against the
tool's Zod shape *before* invoking our callback, so an undeclared key is stripped by the SDK itself
prior to `handleToolCall` ever seeing `rawArgs` — the redaction guarantee (spec §4) applies to
*declared* schema fields whose name matches the credential family, not to arbitrary extra keys a
caller might smuggle in (those never reach the log at all, which is strictly safer, just a
different mechanism than a same-tool redaction test can exercise). This is a genuine, useful smoke
finding (not a defect — no code change needed) — recorded here per Dev Notes ("if a doc-driven
review... surfaces a genuine small defect, fix it... but do NOT re-open 29.0/29.1 scope"; this is
an observation, not a defect).

**Run 2 — denied write + password redaction on a genuine schema field (`@iris-mcp/admin`).**
Same env shape, one call: `iris_user_manage` `{action:"create", name:"AuditSmokeTempUser9x7z",
password:"Sm0keTestP@ss_9x7z_ADMIN"}` — `password` IS declared on this tool's schema. Blocked by
the read-only preset (denied, never reaches IRIS). Observed:
```
denied write (with password field) -> isError: true {"code":"GOVERNANCE_DISABLED","action":"iris_user_manage:create","server":"default","presetApplied":"read-only"}
```
Resulting entry:
```json
{"ts":"2026-07-12T05:05:20.410Z","seq":1,"serverPkg":"@iris-mcp/admin","tool":"iris_user_manage","action":"create","profile":"default","namespace":"HSCUSTOM","outcome":"denied","durationMs":0,"paramKeys":["action","name","password"],"params":{"action":"create","name":"AuditSmokeTempUser9x7z","password":"[REDACTED]"},"denyReason":"GOVERNANCE_DISABLED","presetApplied":"read-only"}
```
`action:"create"` correctly schema-extracted (multi-action tool); `password` correctly redacted to
`"[REDACTED]"`. `grep -c "Sm0keTestP@ss_9x7z_ADMIN" audit.jsonl` → `0`.

**Run 3 — rotation (`@iris-mcp/dev`, `IRIS_AUDIT_LOG_MAX_MB=0.001` ≈ 1048 bytes).** 4 padding
`iris_global_list` calls. Result: `audit.jsonl.1` (header + seq 1–2, 899 bytes) and `audit.jsonl`
(seq 3–4, 748 bytes) — confirming `<path>` → `<path>.1` rotation fired exactly once, with
contiguous `seq` (1,2,3,4) spanning the rotation boundary and a single shared `session` UUID across
both files (sessions are reconstructable by concatenating `<path>.1` + `<path>` in that order).
*(Note: an earlier throwaway run with 20 padding calls under the same tiny threshold triggered
MULTIPLE rotations — since only a single `.1` generation is kept by design (spec §2), that run's
early entries were legitimately overwritten by later rotations before inspection; re-run with a
short, deliberate padding count of 4 to observe exactly one clean rotation instead.)*

**Cross-run redaction verification.** `node -e` script parsed every line of all four log files
(`audit-smoke-fidelity/audit.jsonl`, `audit-smoke-admin/audit.jsonl`,
`audit-smoke-rotation/audit.jsonl[.1]`) confirming 100% valid JSON (no truncated/interleaved
lines), and grepped both test secrets (`Sm0keTestP@ss_9f3e1c7d`, `Sm0keTestP@ss_9x7z_ADMIN`) across
all six files → **0 occurrences in every file.**

Both `tmp-audit-smoke.mjs` scripts deleted after evidence capture; `git status` confirms no
disposable script remains.

### Completion Notes List

- **Task 1/2 (docs rollup, AC 29.2.1):** Added `IRIS_AUDIT_LOG` / `IRIS_AUDIT_LOG_MAX_MB` /
  `IRIS_AUDIT_LOG_PARAMS` rows to the root README env-var table (next to the `IRIS_GOVERNANCE*`
  rows) and extended the "single-server installs need no changes" additive note. Added a new
  `## Compliance & Auditability` top-level section (README.md, between "Multiple Servers &
  Governance" and "Workflow Prompts & Agent Skills") matching the "Read-only mode" marketing-prose
  bar: what gets recorded (with a JSONL example), the secrets-free-by-construction redaction
  guarantee, the degrade-never-throw + startup-fail-fast posture, the "governance cannot turn this
  off" point, and a REQUIRED disambiguation paragraph distinguishing `IRIS_AUDIT_LOG` from the
  pre-existing IRIS-native `iris_audit_manage`/`iris_audit_events` security-audit tools. Added a
  matching Backward-Compatibility bullet (`IRIS_AUDIT_LOG` unset ⇒ mechanical no-op). Mirrored an
  "Audit Log (optional)" section into all three `docs/client-config/{claude-code,claude-desktop,
  cursor}.md` guides (identical shape to their existing "Read-only Mode + SQL Resource Caps"
  section). `packages/shared/README.md` documents `audit.ts`'s exports in a NEW section explicitly
  separate from "Public API" — verified live that `AuditLogger`/`parseAuditConfig`/`redactValue`
  are NOT re-exported from `packages/shared/src/index.ts` (internal-only, consumed solely by
  `server-base.ts`), so the doc says so explicitly rather than misrepresenting them as barrel
  exports; states the Rule #31 framework-surface/no-tool-array/no-governance-key posture.
  `CHANGELOG.md` gained a new `[Unreleased] — Epic 29` entry (default-OFF, no new tool/governance
  key, no bootstrap bump, frozen baseline unchanged) inserted above the existing (still-open)
  Epic 28 unreleased entry. `tool_support.md` gained a callout note (below the Legend, before the
  per-server tables) stating audit logging is server CONFIG, not a tool, with zero tool-count
  impact and the same disambiguation.
- **Task 3 (live smoke, AC 29.2.2):** See Debug Log References above for full commands/output.
  Three real sessions against the BUILT dist (two servers: `@iris-mcp/dev`, `@iris-mcp/admin`)
  proved all three outcomes (`ok`/`error`/`denied`) with correct field shapes, the zero-secret
  redaction guarantee (both on an undeclared key, which the SDK strips before the framework ever
  sees it, and — more meaningfully — on a genuine schema-declared `password` field, which the
  framework redacts to `"[REDACTED]"`), and rotation (`<path>.1` appears, contiguous `seq` across
  the boundary, single session UUID). Both disposable scripts deleted.
- **Task 4 (spec §7 + conventions §6, AC 29.2.3):** See the "Spec §7 Acceptance Criteria — proof
  map" and "Conventions §6 Definition-of-Done" subsections below. Full regression:
  `pnpm turbo run build` (6/6 buildable packages green, full-turbo cache), `pnpm turbo run test`
  (13/13 tasks green: shared 755, dev 576, admin 443, interop 323, ops 340 — no regressions),
  `pnpm gen:governance-baseline:check` exits 0 (141 frozen / 201 live / 60 post-foundation — frozen
  baseline `1e62c5ad5bf7` byte-for-byte unchanged; `BOOTSTRAP_VERSION` untouched, TS-docs-only
  story, zero ObjectScript touched).

#### Spec §7 Acceptance Criteria — proof map

1. **Unset `IRIS_AUDIT_LOG` ⇒ mechanical no-op (Rule #19).** Proven in `audit-interceptor.test.ts`
   ("AC 29.0.4 (negative): IRIS_AUDIT_LOG unset -> pure pass-through, zero fs writes") — Story
   29.0. Documented as a Backward-Compatibility bullet in README.md (this story).
2. **ok/error/denied outcomes + fields; denied carries `denyReason` (+`presetApplied`).** Proven in
   `audit-outcome-derivation.test.ts` (basic derivation, 29.0) and `audit-outcome-fidelity.test.ts`
   ("a preset-caused denial carries denyReason AND presetApplied", "an explicit-override denial
   does NOT carry presetApplied", "an ok outcome carries neither...", 29.1). Live-confirmed in this
   story's Run 1/Run 2 smoke (see Debug Log References) — both a preset-caused denial
   (`presetApplied:"read-only"`) and the ok/error shapes observed against a real built server.
3. **Zero secret values under fuzz + live smoke.** Proven in `audit.test.ts` ("produces zero
   occurrences of a password value nested in three positions", 29.0). Live-confirmed in this
   story's Run 2 + cross-run grep (0 occurrences of both test secrets across all 6 log files
   produced by the 3 smoke runs).
4. **Sink failure never blocks a tool call.** Proven in `audit.test.ts` ("degrades without
   throwing when the sink becomes unwritable post-startup, then records droppedEntries at
   shutdown", 29.0). Not independently re-verified live in this story (would require killing a
   live file mid-session — out of this docs+smoke story's scope; the unit test is the authoritative
   proof per 29.0's Dev Notes).
5. **Rotation works; sessions reconstructable (uuid + seq).** Proven in `audit.test.ts` ("rotates
   the file at the configured size threshold", 29.0) and `audit-concurrency-shutdown.test.ts`
   (contiguous seq under concurrency, 29.1). Live-confirmed in this story's Run 3: `<path>.1`
   appeared after exactly one rotation, `seq` 1–4 contiguous across the `.1`/current boundary, one
   shared `session` UUID.
6. **`IRIS_AUDIT_LOG_PARAMS` default `false` ⇒ key names only.** Proven in `audit.test.ts`
   ("omits params when includeParams is false, even if provided", "defaults IRIS_AUDIT_LOG_MAX_MB
   to 50 and IRIS_AUDIT_LOG_PARAMS to false", 29.0). Documented as a default-state callout in
   README.md/client-config guides/tool_support.md (this story).
7. **Concurrent calls produce well-formed, non-interleaved JSONL.** Proven in
   `audit-concurrency-shutdown.test.ts` ("N (>=20) concurrent handleToolCalls produce well-formed,
   non-interleaved JSONL with contiguous seq 1..N...") and `audit-mixed-outcome-concurrency.test.ts`
   ("a mixed concurrent batch (ok + denied + error) produces contiguous seq with each entry's
   fields belonging ONLY to its own outcome") — both Story 29.1.
8. **Docs rollup complete; conventions §6 checklist complete.** This story's Tasks 1/2 (docs) and
   the checklist immediately below.

#### Conventions §6 Definition-of-Done (spec 07)

- [x] All acceptance criteria in the spec pass — see proof map above.
- [x] `pnpm turbo run build` and `pnpm turbo run test` green — 6/6 build tasks, 13/13 test tasks.
- [ ] N/A — ObjectScript compiled clean on live IRIS; `%UnitTest` suite green. **Reason:** Epic 29
      is TS-only (`@iris-mcp/shared` framework interceptor); no ObjectScript class was created or
      modified across Stories 29.0/29.1/29.2.
- [ ] N/A — `pnpm run gen:bootstrap` run and idempotent on rerun. **Reason:** no ObjectScript
      touched; `BOOTSTRAP_VERSION` is unchanged (verified: no `bootstrap-classes.ts` diff, no
      story in this epic altered the bootstrap manifest).
- [x] `gen:governance-baseline:check` exits 0 (baseline untouched) — 141 frozen / 201 live / 60
      post-foundation, frozen hash `1e62c5ad5bf7` byte-for-byte unchanged.
- [x] Live smokes done, including rejection paths; results recorded in the story file — Task 3
      above (3 runs, including the governance-denied rejection path in Run 1 and Run 2).
- [x] Docs rollup complete (all surfaces + default-state callouts) — Tasks 1/2 above.
- [x] All `ExecuteMCPv2.Temp.*` probe classes and disposable smoke scripts deleted — no ObjectScript
      probes were created this story; both `tmp-audit-smoke.mjs` scripts deleted after evidence
      capture (verified via `git status`).

### File List

- `README.md` (modified — env-var table rows, Backward Compatibility bullet, new "Compliance &
  Auditability" section)
- `docs/client-config/claude-code.md` (modified — new "Audit Log (optional)" section)
- `docs/client-config/claude-desktop.md` (modified — new "Audit Log (optional)" section)
- `docs/client-config/cursor.md` (modified — new "Audit Log (optional)" section)
- `packages/shared/README.md` (modified — new "Audit Logging (framework surface, not part of the
  public barrel)" section)
- `CHANGELOG.md` (modified — new `[Unreleased] — Epic 29` entry)
- `tool_support.md` (modified — new callout note below the Legend)
- `_bmad-output/implementation-artifacts/29-2-audit-docs-and-smokes.md` (this file — Tasks,
  Dev Agent Record, Status)
- `packages/shared/src/__tests__/audit-redaction-interceptor.test.ts` (added — QA: codifies the
  live-smoke redaction guarantee through the REAL `McpServerBase.handleToolCall` interceptor with a
  Zod-declared `password` field, on both the `ok` and governance-`denied` paths and under both
  `IRIS_AUDIT_LOG_PARAMS` settings — closes the coverage seam Run 2 of the smoke surfaced)

No production source files were modified — this is a docs + live-smoke story consuming the
already-shipped Story 29.0/29.1 interceptor unchanged; the one added test file above is
regression coverage, not a behavior change. Two disposable smoke scripts
(`packages/iris-dev-mcp/tmp-audit-smoke.mjs`, `packages/iris-admin-mcp/tmp-audit-smoke.mjs`) were
created and deleted within this session — never committed.

## Change Log

- 2026-07-12 — Story 29.2 implemented: docs rollup across 7 surfaces (README env-var table +
  Backward Compatibility + new "Compliance & Auditability" marketing section with required
  disambiguation vs `iris_audit_manage`/`iris_audit_events`; 3 client-config guides;
  `packages/shared/README.md` framework-surface note; `CHANGELOG.md` Epic 29 entry;
  `tool_support.md` config-not-tool callout) plus a 3-run live smoke against the BUILT
  `@iris-mcp/dev`/`@iris-mcp/admin` dist proving ok/error/denied fidelity, zero-secret redaction
  (including on a genuine schema `password` field), and single-rotation `<path>.1` mechanics with
  contiguous `seq` across the boundary. Spec §7 ACs 1–8 mapped to their proofs; conventions §6
  checklist completed (ObjectScript/bootstrap lines marked N/A — TS-docs-only epic). All 4 tasks
  complete; `ready-for-dev` → `review`.
