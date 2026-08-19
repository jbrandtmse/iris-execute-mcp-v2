# Story 35.4: MEDIUM - Bound `iris_resource_manage:listPrivileges`

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator or AI client calling `iris_resource_manage:listPrivileges`**,
I want **the listing to be bounded, with an honest statement of what the bound actually protects**,
so that **a privileged grantee does not return a multi-megabyte payload that overruns the client limit and diverts to a file**.

## Context — why this story exists

`listPrivileges` is unbounded. There is no `maxRows`, no `cursor`, and no output ceiling anywhere on the path. Grantee `_SYSTEM` (which holds `%All`) returns **15,341 rows / 2,900,478 characters**, which exceeds the client limit and diverts the result to a file — the tool is effectively unusable for exactly the grantees an operator most wants to inspect.

Ledger item: **`35-SWEEP-4`** (MEDIUM), `deferred-work.md` line 2355. Root cause recorded there: *"Predates the Rule #38 codification being applied to this surface; the action was added as a read and reads were not swept for output bounds."*

This story is **not** one of Epic 35's two raw-wire-body stories (35.1 / 35.2 were). Normal live proof against the real endpoint is sufficient — but see **Proof path** below, because Rule #59 still binds.

## Acceptance Criteria

Sourced verbatim from `_bmad-output/planning-artifacts/epics.md`, "### Story 35.4".

1. **AC 35.4.1** - The action accepts `maxRows` and returns a `cursor`/`nextCursor` for pagination, matching the pagination convention already used by sibling admin list tools.
2. **AC 35.4.2** - Measured baseline to beat, captured live 2026-08-17: grantee `_SYSTEM` (holds `%All`) returns **15,341 rows / 2,900,478 characters**, exceeding the client limit and diverting to a file.
3. **AC 35.4.3** - Rule #38 stated honestly in the tool description: a `maxRows`/topN cap truncates OUTPUT only - the scan work has already happened. If the scan itself cannot be bounded, say so explicitly rather than implying timeout protection. Prefer pushing the limit into the SQL (`TOP`) so the scan is genuinely bounded, and state which was done.
4. **AC 35.4.4** - `%All` short-circuit consistency (#6): a grantee holding `%All` holds every privilege via `SuperUser` with no explicit rows. Consider returning the short-circuit verdict with a reason field - as `iris_permission_check` already does ("target holds %All super-role") - instead of enumerating 15,341 derived rows. If enumeration is kept, justify it in the description.
5. **AC 35.4.5** - Rule #19 back-compat: an omitted `maxRows` must not silently change the result shape for callers who fit under the cap. Proven mechanically.

## Lead pre-story probe — findings you may build on

Run live against HSCUSTOM on 2026-08-18 via a disposable `ExecuteMCPv2.Temp.SqlPrivProbe` class (since deleted from both IRIS and disk). These are **empirical**, not inherited claims. Re-probe anything you extend, per Rule #16.

**1. AC 35.4.2's baseline reproduces EXACTLY.** `_SYSTEM`, `system=0`: **15,341 rows**, and the current handler's response shape serializes to **2,900,478 characters** — matching the captured figure to the character. The baseline is a sound oracle; use it.

**2. The 15,341 rows are almost entirely DERIVED from `%All`.** Breakdown of `GRANTED_VIA` over all 15,341 rows:

| `GRANTED_VIA` | Rows | Meaning |
|---|---:|---|
| `SuperUser` | **15,333** | Derived purely from the `%All` super-role — the cross-product of every SQL object × every applicable privilege |
| `Owner Privilege` | **8** | **Real, non-derived** grants |

Distinct `TYPE`: `TABLE` 8,910 / `STORED PROCEDURE` 6,428 / `ML CONFIGURATION` 3. Distinct `PRIVILEGE`: `%ALTER`/`DELETE`/`INSERT`/`REFERENCES`/`SELECT`/`UPDATE` 1,485 each (= 1,485 tables × 6), `EXECUTE` 6,428, `USE` 3. `GRANTED_BY` is `_SYSTEM` on every row.

**3. Control — a non-`%All` grantee behaves completely differently.** `%Developer`, `system=0`: **11 rows**, `GRANTED_VIA` = `Owner Privilege` on **all 11**, zero `SuperUser` rows. So `SuperUser` rows appear **only** for `%All` holders. This is your discriminating oracle for AC 35.4.4 — a change that alters `%Developer`'s result is wrong.

**4. ⚠️ The naive short-circuit LOSES information.** AC 35.4.4 invites returning a verdict "instead of enumerating 15,341 derived rows" — but 8 of those rows are `Owner Privilege`, i.e. genuine grants that exist independently of `%All`. A short-circuit that returns only a verdict silently discards them. **Recommended design: short-circuit the `SuperUser`-derived rows behind a reason field while still returning the non-derived rows.** That is information-preserving and still collapses 15,341 → 8. If you choose differently, justify it explicitly.

## Tasks / Subtasks

- [x] **Task 1 — Re-probe and confirm the ground truth (AC 35.4.2, AC 35.4.4)**
  - [x] Reproduce the `_SYSTEM` baseline (rows + serialized characters) and the `%Developer` control yourself. Do not rely solely on the lead's figures.
  - [x] Establish what bounding the class query actually supports (Task 2) *before* writing the tool description (Task 4) — the description must state what you achieved, not what you hoped.
  - [x] Probes are disposable: `ExecuteMCPv2.Temp.*`, deleted from IRIS **and** disk before commit (Rule #16).

- [x] **Task 2 — Server-side bound in the handler (AC 35.4.1, AC 35.4.3)**
  - [x] `SqlPrivilegeList()` in `src/ExecuteMCPv2/REST/Security.cls` — read `maxRows` and bound **both** materialization loops (object-level *and* column-level).
  - [x] Mirror the in-file precedent exactly (see Dev Notes → *The idiom to copy*).
  - [x] Determine empirically whether stopping `tRS.Next()` stops the underlying work, and record the finding — this is what AC 35.4.3 turns on.
  - [x] Emit a truncation signal so a capped caller can tell rows were dropped (see Dev Notes → *Truncation signal*).

- [x] **Task 3 — `%All` disposition (AC 35.4.4)**
  - [x] Decide short-circuit vs. enumeration, informed by finding #4 above. Either is acceptable; an **unjustified** choice is not.
  - [x] If short-circuiting: match `iris_permission_check`'s shape — `Security.cls:917-951` — including a `reason` field.
  - [x] Rule #6: match `%All` by **exact `$Piece` equality** over the comma list. Never substring `[` (false-positives on `%AllCustom`).
  - [x] Preserve the `%Developer` control result byte-for-byte.

- [x] **Task 4 — Tool layer: `maxRows` + `cursor` (AC 35.4.1, AC 35.4.3)**
  - [x] `packages/iris-admin-mcp/src/tools/resource.ts`, the `action === "listPrivileges"` branch at line 175.
  - [x] Add `maxRows` and `cursor` zod fields following `audit.ts` (see Dev Notes → *The convention to follow*).
  - [x] Forward `maxRows` on the wire; apply `ctx.paginate` for cursoring.
  - [x] Resolve the `maxRows` × `pageSize` interaction and document it (Dev Notes → *The trap*).
  - [x] Write the Rule #38 sentence honestly into the description.

- [x] **Task 5 — Tests (AC 35.4.5 + Rule #59)**
  - [x] Mechanical back-compat proof: omitted `maxRows`, under-cap grantee ⇒ result shape unchanged, asserted so it **fails on drift**.
  - [x] Prove the cap actually **fires** on the path it guards — a real over-limit case, not merely that the parameter parses.
  - [x] Cursor round-trip: page 1 → `nextCursor` → page 2, no overlap, no gap, terminal page yields no `nextCursor`.
  - [x] Column-level path (`target` = `schema.table`) bounded too — do not leave the second loop untested.

- [x] **Task 6 — Docs at point of use (Rule #30/#43, #56)**
  - [x] Update every surface listed in Dev Notes → *Doc surfaces*. Enumerate exhaustively; do not defer to Story 35.8.

- [x] **Task 7 — Constraints and gates**
  - [x] E-1: no new tool, no new action key. Confirm tool/action counts unmoved.
  - [x] E-2: `pnpm gen:governance-baseline:check` only. Never the bare generator.
  - [x] ObjectScript changed ⇒ **regenerate bootstrap** (`pnpm run gen:bootstrap`) and record `BOOTSTRAP_VERSION` from→to (Rule #24).
  - [x] Verify per-package standalone, not via a full parallel `turbo run` (see *Known environment issue*).

## Dev Notes

### The idiom to copy — a server-side cap already exists in this very file

`AuditStatus()` in the same `Security.cls` (lines ~2577-2612) already caps a `%ResultSet`-over-class-query read. Copy this shape rather than inventing one:

```objectscript
Set tMaxRows = +$Get(%request.Data("maxRows", 1), 100)
If tMaxRows < 1 Set tMaxRows = 100
If tMaxRows > 1000 Set tMaxRows = 1000
...
Set tRowCount = 0
While tRS.Next() && (tRowCount < tMaxRows) {
    ; ... materialize row ...
    Set tRowCount = tRowCount + 1
}
```

It also echoes the effective cap back: `Do tResult.%Set("maxRows", tMaxRows, "number")`.

**Note what this does and does not do.** It is *not* an output-only cap — it stops pumping the cursor, so rows past the cap are never fetched or materialized. That is materially stronger than client-side slicing. Whether it also bounds the *underlying scan* depends on how `%SQL.Manager.CatalogPriv:UserPrivs` is implemented, which you must establish rather than assume. Say precisely what you proved.

### The convention to follow — `audit.ts` does both halves

`packages/iris-admin-mcp/src/tools/audit.ts` action `view` is the closest sibling and does exactly the two-layer thing this story needs:

- **Server-side `maxRows`** — zod `number().int().positive().optional()` at line 128, described as "default 100, max 1000"; forwarded on the wire at line 249 via `qs.set("maxRows", String(maxRows))`.
- **Client-side cursoring** — `cursor` zod field at line 157; `const { page, nextCursor } = ctx.paginate(allEvents, cursor)` at line 257; spread conditionally at line 261 as `...(nextCursor ? { nextCursor } : {})`.

Sibling tools `database.ts:157`, `ldap.ts:135`, `mapping.ts:158` use the same `cursor` + `ctx.paginate` shape. Follow it; do not invent a different pagination contract.

### ⚠️ The crux for AC 35.4.3 — `ctx.paginate` is output-only

`ctx.paginate` (`packages/shared/src/server-base.ts:287`, class method at `:1901`) is:

```ts
const page = items.slice(offset, offset + pageSize);
```

It slices an **already-materialized array**. By the time it runs, the full 2.9 MB has *already* been fetched by IRIS, serialized, and crossed the wire. **A cursor-only fix is exactly the Rule #38 trap** — an output cap advertised as protection. `DEFAULT_PAGE_SIZE` is `50` (`server-base.ts:83`).

The server-side `maxRows` is the half that actually reduces work. Be precise about which you achieved, in both the tool description and your completion notes. Do not claim scan bounding you did not demonstrate.

Good precedent for honest phrasing — `iris_sql_execute`'s own description already says it plainly:

> "the response carries `rowsCapped: true` when it clamps the caller's request; it bounds the returned row count post-fetch, not the server-side result set or transfer"

### ⚠️ The trap — `maxRows` × `pageSize` interact

With a server-side cap of 100 and a client page size of 50, cursoring can only ever reach page 2 — everything past the server cap is invisible to the cursor no matter how many times the caller pages. `audit.ts` has this same latent interaction and does not document it.

Do not replicate the omission. Decide the semantics deliberately, and state them: `maxRows` is the ceiling on what the server will return at all, and the cursor pages *within* that ceiling. A caller who needs more must raise `maxRows`, not page further.

### Truncation signal

A capped response that looks identical to a complete one is a correctness hazard — the caller cannot distinguish "8 privileges" from "8 of 15,341". Emit an explicit signal when the cap engages (`rowsCapped`-style, matching the `iris_sql_execute` idiom above).

**This is in direct tension with AC 35.4.5** — see below. Resolve it deliberately.

### ⚠️ Sharpest back-compat question (AC 35.4.5)

AC 35.4.5: *an omitted `maxRows` must not silently change the result shape for callers who fit under the cap.*

- Adding cap-signal fields **unconditionally** (as `audit.ts` does with its always-present `maxRows` echo) changes the shape for **every** caller, including under-cap ones. That reads as an AC 35.4.5 violation.
- Safest resolution: **emit the cap-signal fields only when the cap actually engaged.** Under-cap callers then see a byte-identical response.
- Prove it mechanically — a `toEqual` against pre-feature output that would **fail on drift**, not a prose claim.

**Separate, deliberate decision — the default cap value.** If you default `maxRows`, an over-cap caller who previously received 15,341 rows now receives fewer. That is a behavior change. It is defensible *because the uncapped path is already broken* (it overruns the client limit and diverts to a file), but the project treats back-compat as a release gate, so state the choice and its justification explicitly rather than letting it pass silently. AC 35.4.5 protects **under-cap** callers only — over-cap callers are the ones this story is fixing.

### Rule #10 observation — `system` is read but never sent

The handler reads `system` (`+$Get(%request.Data("system", 1))`, gating whether system objects are included) but `resource.ts` **never sends it** — there is no `system` zod field and no `qs.set("system", …)`. The handler therefore always sees `0`.

Note this in your Dev Notes either way. Fix it **only** if genuinely trivial and covered by a test; otherwise ledger it as a separate finding. Do not let it expand this story's scope.

### `%All` short-circuit reference implementation

`Security.cls:917-951` (`iris_permission_check`). Note the comment block at 917-923 recording that `Security.Roles.Get("%All", .tProps)` returns **empty** `Resources` even though the role grants everything — verified empirically 2026-04-21. The exact-equality loop is at 927-935; the response shape with `reason` is at 939-951.

### Constraints

- **E-1** — NO new tool, NO new action key. `maxRows` and `cursor` are additive **parameters**, which is permitted. Tool counts must not move (#31).
- **E-2** — `GOVERNANCE_BASELINE` frozen at `1e62c5ad5bf7`/141/201/60. `pnpm gen:governance-baseline:check` **only**; never the bare generator (#23/#25). If tripped, `git checkout --` the file immediately.
- **Governance** — `listPrivileges` is already classified `mutates: "read"` (`resource.ts:119`) and is a pre-existing key. No new classification (#28) and no preset disposition (#53) expected. **Verify; do not assume.**
- **Rule #24** — ObjectScript changes ⇒ regenerate bootstrap in this same story; record `BOOTSTRAP_VERSION` from→to.
- **Rule #55** — never generate file content through a shell heredoc.

### Testing

- Existing coverage to extend, not duplicate: `packages/iris-admin-mcp/src/__tests__/resource.test.ts` (598 lines), `resource-sqlpriv-coverage.test.ts` (346 lines, `listPrivileges` querystring forwarding at ~line 200 and the `isError` path at ~215), `resource-governance.test.ts`.
- Tests must be discoverable by the default suite (Rule 8) — correct naming, not excluded, not opt-out tagged.
- **Rule #59** — the cap must be proven to fire **on the path it guards**. `_SYSTEM` is the natural over-limit fixture. "The parameter parses" is not evidence.
- **Rule #34** — this surface is namespace-scoped; consider a second namespace or record an explicit residual risk.
- **Known environment issue (`35-1-DEV-1`, MEDIUM, ledgered):** the full parallel `turbo run` is not reliably green in this environment **independent of any diff** (A/B `git stash`-proven). Every package is clean **standalone**. Verify per-package; do not chase it, and do not normalize it either.

### Doc surfaces — enumerate exhaustively (#56)

Known `listPrivileges` mentions:

| File | Lines |
|---|---|
| `tool_support.md` | 88, 105 |
| `packages/iris-admin-mcp/README.md` | 167, 206, 208, 980 |
| `packages/iris-admin-mcp/src/tools/resource.ts` | tool `description` (lines ~36-47) + the new zod `.describe()` text |

**Check `packages/iris-mcp-all/README.md` specifically.** The Story 35.2 **and** Story 35.3 reviews *each* found a "one package over" README omission — a seventh README in `iris-mcp-all` carrying the same table. That is now a twice-repeated miss; treat it as a known blind spot rather than rediscovering it a third time. There are 8 package READMEs total.

### Project Structure Notes

- ObjectScript handler: `src/ExecuteMCPv2/REST/Security.cls` → `SqlPrivilegeList()`, banner at 3083, body from ~3095. Two materialization loops: column-level (when `target` is set) and object-level (else).
- Tool layer: `packages/iris-admin-mcp/src/tools/resource.ts`, `listPrivileges` branch at line 175.
- Handler reads: `grantee` (required), `target`, `system`, `namespace`. Tool sends: `grantee`, `target`, `namespace`.
- The handler switches namespace via explicit save/restore into `tOrigNS` — preserve that discipline on every new early-exit path you add, including the short-circuit.

### Proof path

Live proof against the **real endpoint** is sufficient here (this is not one of the raw-wire-body stories). But Rule #59 binds regardless: **any gate or cap you add must be demonstrated actually firing on the path it guards**, with a real over-limit grantee. A test proving the parameter validates is not proof the cap engages.

### References

- Ledger: `_bmad-output/implementation-artifacts/deferred-work.md` line 2355 (`35-SWEEP-4`)
- Epic + ACs: `_bmad-output/planning-artifacts/epics.md`, "## Epic 35" (constraints E-1/E-2) and "### Story 35.4"
- Rules: `.claude/rules/project-rules.md` — #6 (`%All`), #10 (defaults on the wire), #16 (probe-first), #19 (additive back-compat proof), #24 (bootstrap), #30/#43 (docs at point of use), #34 (second namespace), #38 (scope filter; output caps are not scan caps), #55 (no heredoc), #56 (enumeration completeness), #59 (gate proven red on the guarded path)
- Prior story: `35-3-pin-request-locale-error-text.md` (status done)

### Previous story intelligence — Story 35.3

- **The dev pass's causal story was wrong and a probe caught it.** 35.3 initially rested on a curl-vs-MCP comparison that was confounded (different endpoints ⇒ different worker processes ⇒ Rule #13's independent locale mechanism). The real mechanism — undici injects `Accept-Language: *` when the caller sets none — was only found by isolating the variable at the socket. **Applies directly here:** do not infer *why* 15,341 rows appear from plausibility. The lead's probe already isolated it (`GRANTED_VIA`); extend that method rather than reasoning from the shape of the number.
- **Review found four genuine defects the dev pass missed**, all in the same family: the *empty/degenerate* input case (empty env var ⇒ empty header on the wire), the *malformed* input case (CRLF ⇒ every request failed, misreported as a network error), and a test that **passed vacuously** (drove only one of four verbs, no call-count guard). Anticipate the analogues here: `maxRows=0`, negative, non-integer, absurdly large; `cursor` malformed, stale, or past the end; and a cap test that would pass even if the cap never fired.
- **Rule #56 blind spot is now twice-confirmed** — the seventh README. See *Doc surfaces*.
- Recent commits `a43cad7` → `5ba75ca` establish the epic's commit-message convention: state what was proven, how, and what was deliberately *not* claimed.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), bmad-dev-story workflow.

### Debug Log References

- Probe class `ExecuteMCPv2.Temp.SqlPrivProbe2` (disk: `src/ExecuteMCPv2/Temp/SqlPrivProbe2.cls`; loaded via `iris_doc_load` glob-prefixed path, compiled clean) — re-probed AC 35.4.2's baseline (`rows=15341 SuperUser=15333 OwnerPriv=8 Other=0`, `jsonChars=2900478`, exact match to the lead's figures), the `%Developer` control (`rows=11 SuperUser=0 OwnerPriv=11 Other=0`), timing comparisons (`Execute()` alone ~181ms vs full 15,341-row fetch ~97ms; SQL `TOP` via `%SQL.Statement` at TOP 10/100/5000 all landed in a flat ~223-260ms band vs ~485ms uncapped — establishing that `TOP` does NOT genuinely bound the `Execute()`-phase privilege enumeration for this stored procedure), and confirmed `_SYSTEM`'s `Roles="%All"` / `%Developer` is a role not a user. Deleted from IRIS (`iris_doc_delete`) and disk after use; `src/ExecuteMCPv2/Temp/` removed (empty).
- Live curl verification against the real `/api/executemcp/v2/security/sqlprivilege` endpoint (HSCUSTOM, `_SYSTEM`/`SYS`) after the ObjectScript change compiled: `_SYSTEM maxRows=5` → `count=5, rowsCapped=true, superUserPrivilegesOmitted=10959`; `_SYSTEM` no `maxRows` → `count=8, superUserPrivilegesOmitted=15333`, no `rowsCapped` (response body 1,856 bytes, down from 2,900,478 characters); `%Developer` control → `count=11`, zero new fields (byte-for-byte pre-35.4 shape). Column-level (second loop) proof: created disposable role `Story354TestRole`, granted column-level `SELECT` on 5 columns of `%Dictionary.ClassDefinition`, `maxRows=3` → `count=3, rowsCapped=true`; uncapped → `count=5`, no `rowsCapped`; revoked the grant and deleted the role immediately after, confirmed gone via `GET /security/role`.

### Completion Notes List

- **AC 35.4.1 (maxRows + cursor):** `maxRows` (default 100, max 1000, mirroring `AuditStatus`) added server-side in `SqlPrivilegeList()`; `cursor` added tool-side in `resource.ts`'s `listPrivileges` branch via `ctx.paginate` over the (already server-bounded) `privileges` array, following the `audit.ts`/`database.ts`/`ldap.ts`/`mapping.ts` convention.
- **AC 35.4.2 (baseline):** reproduced exactly and independently (see Debug Log) — the lead's figures are a sound oracle.
- **AC 35.4.3 (honest scan-vs-output bounding):** empirically established that `maxRows` is an OUTPUT bound, not a scan bound. Live timing showed `%SQL.Manager.CatalogPriv:UserPrivs`'s `Execute()` phase costs a near-flat ~180-260ms regardless of how many rows are ultimately fetched (tested a SQL `TOP` rewrite via `%SQL.Statement` at TOP 10/100/5000 — all landed in the same band; only the fully uncapped 15,341-row fetch reached ~485ms). Since `TOP` provided no genuine scan-bounding advantage over the existing `%ResultSet` class-query idiom (and would add `%Prepare` overhead plus a new dynamic-SQL surface), the fetch-loop cap (mirroring `AuditStatus`) was kept, and the class-doc comment + tool description state this precisely rather than claiming scan protection the story does not deliver. A `rowsCapped: true` truncation signal (mirroring `iris_sql_execute`'s `rowsCapped` idiom) is emitted only when the cap engages.
- **AC 35.4.4 (%All disposition):** implemented the Dev Notes' recommended hybrid — `GRANTED_VIA=SuperUser` rows are omitted for a grantee holding `%All` (matched by exact `$Piece` equality per Rule #6, mirroring `PermissionCheck` at `Security.cls:917-935`; both the literal `%All` role name and a user whose Roles list contains it), while any real non-derived grant (`Owner Privilege`, etc.) is still enumerated — collapsing 15,341 rows to 8 for `_SYSTEM` without losing information. A `reason` string and a `superUserPrivilegesOmitted` count are added only when the short-circuit engages; applied to BOTH the object-level and column-level loops (the story's Task 3 didn't explicitly call out the column-level loop, but the same finding applies there and was live-verified: `_SYSTEM` against `%Dictionary.ClassDefinition` omitted 224 `SuperUser` column-level rows, 0 real ones). Because finding a genuine non-derived row requires walking past any `SuperUser` rows that sort before it, the `%All`-branch loop scans to completion rather than early-exiting at `maxRows` (live-probed at ~97ms for the full 15,341-row scan — cheap relative to the ~180ms `Execute()` already costs); `maxRows` still caps the MATERIALIZED (non-derived) count for defense-in-depth.
- **AC 35.4.5 (back-compat):** resolved the tension Dev Notes flagged (truncation-signal fields vs. an unconditional echo) by making `rowsCapped`/`reason`/`superUserPrivilegesOmitted` present ONLY when triggered — proven both live (`%Developer` control: zero new fields) and mechanically (`resource-listprivileges-bound.test.ts`'s `toEqual` pin against the exact pre-35.4 shape). The separate, deliberate decision Dev Notes calls out — that an over-cap `%All` caller's response shape DOES change (15,341 rows → 8) — is intentional and is exactly the defect this story fixes; AC 35.4.5 protects under-cap callers only, as the story states explicitly.
- **Tool-layer signal forwarding:** unlike `audit.ts`'s `view` action (which rebuilds its result from only `events`/`count`/`nextCursor`, silently dropping every other wire field), `resource.ts`'s `listPrivileges` branch SPREADS the raw wire result before overriding `privileges`/`count`/`nextCursor`, so the new `rowsCapped`/`reason`/`superUserPrivilegesOmitted` signals survive into the MCP response instead of being computed server-side and discarded at the tool layer. Documented as a deliberate deviation from the `audit.ts` precedent in `resource.ts`'s module doc comment.
- **Rule #59 (cap proven on the guarded path):** both loops proven live against real over-limit data — `_SYSTEM` (object-level, the natural over-limit fixture) and a disposable test role with 5 real column-level grants (column-level, since `_SYSTEM` itself had zero real column-level grants on the tables probed). Not merely "the parameter parses."
- **Rule #10 finding (NOT fixed — ledgered):** confirmed `system` is read by the handler but never sent by `resource.ts` (no zod field, no `qs.set`). Out of this story's scope per the Dev Notes' explicit instruction; ledgered as `35-4-DEV-1` (LOW) in `deferred-work.md`.
- **Ledger closure:** `35-SWEEP-4` (MEDIUM) moved open → terminal in `deferred-work.md` with a RESOLVED disposition row and a mechanically-derived tally (Rule #51): 0 HIGH / 30 MEDIUM / 86 LOW = 116 open / 186 distinct / 70 terminal (includes the new `35-4-DEV-1` LOW).
- **Bootstrap (Rule #24):** `Security.cls` changed ⇒ regenerated. `BOOTSTRAP_VERSION` `2742ce31228a` → `87d04d52e988`. Re-run confirmed idempotent (same hash, no diff on the second `gen:bootstrap`). Roster unchanged at 29 classes, `REST/Dispatch.cls` last.
- **Governance (E-2):** `pnpm gen:governance-baseline:check` only, exit 0, frozen baseline unchanged (`1e62c5ad5bf7` / 141 frozen / 201 live / 60 new). `listPrivileges` remains classified `mutates: "read"`, verified (not assumed) — no classification or preset-disposition change needed (it was already a pre-existing key before this story).
- **Docs (Rule #30/#43/#56):** updated `tool_support.md` (new Story 35.4 note after the Epic 15 note), `packages/iris-admin-mcp/README.md` (the `listPrivileges` table row + a new bounding callout, action-level description, zod `.describe()` text). Checked `packages/iris-mcp-all/README.md`, the root `README.md`, `docs/migration-v1-v2.md`, `docs/epic-summary.md`, and `CHANGELOG.md` explicitly (the "one package over" blind spot from 35.2/35.3) — none needed a change: they operate at tool-count/package-summary granularity (e.g. "resource (incl. SQL privileges)", admin tool count 26) that this purely-additive-parameter story does not move. `iris-mcp-all`'s per-tool table stays unchanged deliberately, not by omission.
- **E-1 verified:** `@iris-mcp/all` cross-package suite 120/120 (tool/action counts unmoved), governance baseline live-key count unchanged at 201/60.
- **Full suite state:** `@iris-mcp/admin` 468/468 (451 pre-existing + 17 new in `resource-listprivileges-bound.test.ts`), `@iris-mcp/shared` 1326/1326, `@iris-mcp/all` 120/120; `tsc --noEmit` and `eslint` clean on both touched packages. Verified per-package standalone per the `35-1-DEV-1` environmental caveat, not via a full parallel `turbo run`.

### File List

- `src/ExecuteMCPv2/REST/Security.cls` (modified — `SqlPrivilegeList()` bounded + `%All` short-circuit; class-doc comment expanded)
- `packages/iris-admin-mcp/src/tools/resource.ts` (modified — `maxRows`/`cursor` zod fields, wire forwarding, signal-preserving pagination, module doc comment + action description)
- `packages/iris-admin-mcp/src/__tests__/resource-listprivileges-bound.test.ts` (new — 19 tests: schema edge cases, wire forwarding, AC 35.4.5 back-compat pins, signal forwarding, cursor round-trip, non-array defensive guard)
- `packages/iris-admin-mcp/src/__tests__/resource-listprivileges-superuser-coverage.test.ts` (new, QA stage — 10 tests: `%All`-holder cap boundaries, indirect-chain short-circuit, boundary/degenerate inputs, column-level signal forwarding)
- `src/ExecuteMCPv2/Tests/SqlPrivilegeBoundTest.cls` (new, code-review stage — 5 tests driving the DEPLOYED REST route; the only coverage that can fail if the server-side guards regress)
- `packages/shared/src/bootstrap-classes.ts` (regenerated — `BOOTSTRAP_VERSION` `2742ce31228a` → `87d04d52e988` → `18e23e867553` → `b353ec0ab2e7` after the code-review ObjectScript fixes and rework iteration 1)
- `tool_support.md` (modified — Story 35.4 note)
- `packages/iris-admin-mcp/README.md` (modified — `listPrivileges` row + bounding callout)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — `35-SWEEP-4` terminal disposition; new `35-4-DEV-1` LOW finding)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story status `ready-for-dev` → `in-progress`, workflow-managed)

### Review Findings

Code review 2026-08-18. All three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) DELIVERED findings payloads within the 20-minute bounded-close window — `review_degraded = false`, close kind CLEAN (Rule #57). Frozen-diff snapshot was captured at review start and disposed at close. 28 findings after dedup: **16 resolved** (15 patched at review + `35-4-CR-1` resolved in rework iteration 1), 6 deferred (all LOW), 6 dismissed, 0 decision-needed. No HIGH or MEDIUM remains open.

**Patched (all fixed in-story, live- or mutation-verified):**

- [x] [Review][Patch] HIGH — `superUserPrivilegesOmitted` reported a PARTIAL count once the cap engaged, and a genuine non-derived grant was dropped, both contradicting the class-doc's "scans the full result set" guarantee [src/ExecuteMCPv2/REST/Security.cls:~3215,~3252]. Derived rows never consume the cap, so the loop now keeps scanning on the `%All` path instead of quitting; the count is the exact total regardless of `maxRows`. Live re-verified: `_SYSTEM&maxRows=7` → `superUserPrivilegesOmitted: 15333` (was `10961`). The class-doc was rewritten to state the honest residual limit (real rows past `maxRows` ARE dropped, signalled by `rowsCapped`).
- [x] [Review][Patch] HIGH — a two-level-or-deeper indirect `%All` chain bypassed the short-circuit entirely; the handler decided whether to omit by resolving the GRANTEE's roles, and `Security.Users`'s `Roles` property is DIRECT-only. Reviewer probe on a **3-level** chain (user → roleB → roleC → `%All`) drew **15,333** `SuperUser` rows — identical to `_SYSTEM`, worse than the 2-level case QA reported. **Resolved in rework iteration 1 (lead policy call) by deleting the grantee-resolution mechanism entirely** rather than making it transitive: the omission is now decided per-ROW on the `GRANTED_VIA` value the query already computes [src/ExecuteMCPv2/REST/Security.cls:~3195,~3230]. This is structurally stronger — there is no role graph left to walk incompletely at any depth, no `%AllCustom` substring hazard, and no principal-name matching at all. Live re-verified: the 3-level chain grantee returns 5 real rows, `superUserPrivilegesOmitted: 15333`, zero `SuperUser` rows.
- [x] [Review][Patch] HIGH — **AC 35.4.5 was violated at the tool layer**: `ctx.paginate` sliced unconditionally at `DEFAULT_PAGE_SIZE` 50, so a caller passing NO new parameters whose grantee holds 51–100 privileges (under the 100-row server cap — exactly the population AC 35.4.5 protects) silently received 50 rows, a rewritten `count`, and an unrequested `nextCursor` [packages/iris-admin-mcp/src/tools/resource.ts:~254]. Pagination is now OPT-IN: passing neither `maxRows` nor `cursor` returns the raw wire result untouched; passing either opts into the sibling 50-row convention (which is also how a caller obtains the first `nextCursor`, preserving AC 35.4.1).
- [x] [Review][Patch] HIGH — the AC 35.4.5 back-compat pin was **vacuous**: it ran against `createMockCtx`'s pass-through no-op `paginate` with a 1-row fixture, so `not.toHaveProperty("nextCursor")` held structurally regardless of the code [packages/iris-admin-mcp/src/__tests__/resource-listprivileges-bound.test.ts:§C]. Added a 60-row fixture under the REAL default page size (50); mutation-verified RED against the pre-fix handler (`expected length 60, got 50`).
- [x] [Review][Patch] HIGH (skill Rule 3 / Rule #59) — **no test in the suite could fail if the ObjectScript guards were deleted.** Both TS suites mock HTTP and hand-write the very fields under test; they prove the tool layer FORWARDS a signal, never that the server PRODUCES one. Added `src/ExecuteMCPv2/Tests/SqlPrivilegeBoundTest.cls` (5 tests) driving the DEPLOYED REST route with `%Net.HttpRequest`, following the `AdvisorDataTest`/`InteropItemCompositeKeyTest` precedent. Mutation-verified RED on BOTH guarded paths: reverting the cap fix failed `TestOmittedCountStaysExactWhenCapped`; reverting the transitive walk failed `TestIndirectAllChainIsShortCircuited`. Disposable security-principal fixtures are dropped in both setup and teardown.
- [x] [Review][Patch] MEDIUM — QA's two characterization tests pinned the DEFECTIVE behavior as expected (`superUserPrivilegesOmitted` `toBe(10961)` + `toBeLessThan(15333)`; "SuperUser rows are NOT short-circuited"), so fixing the code would have turned the suite red and invited a revert [resource-listprivileges-superuser-coverage.test.ts:§A,§B]. Both rewritten to assert the fixed behavior, re-captured live, with the pre-fix values retained in comments as the "before" half.
- [x] [Review][Patch] MEDIUM — the `maxRows` × `pageSize` interaction Task 4 required to be "resolved and documented" never stated the actual page size (50), and the shipped advice ("raise `maxRows` rather than paging further") was wrong in the 51–100 band. Corrected across the tool description, both zod `.describe()` texts, the module doc, the README callout, and `tool_support.md`.
- [x] [Review][Patch] MEDIUM — `maxRows` is clamped at 1000 and the cursor cannot cross that ceiling, so a grantee with >1000 REAL grants cannot be fully enumerated. Previously undocumented; now stated plainly on every surface as an accepted limit (Rule #38 honesty).
- [x] [Review][Patch] MEDIUM — each cursor page re-runs the server query and the offset is positional, so omitting `maxRows` on page 2 silently skips or duplicates rows. Now documented on the `cursor` field and in the action description ("resend the same `maxRows` with each `cursor`").
- [x] [Review][Patch] MEDIUM — review Findings A and B were recorded ONLY inside a test file's header comment while `deferred-work.md` declared `35-SWEEP-4` RESOLVED and cited the defective `10959` figure as success evidence. Ledger corrected with a code-review addendum.
- [x] [Review][Patch] LOW — `reason` + `superUserPrivilegesOmitted` were emitted whenever the grantee held `%All`, even with zero rows omitted, producing `superUserPrivilegesOmitted: 0` beside prose asserting privileges WERE omitted [Security.cls:~3271]. Gate changed to `tSuperUserOmitted > 0`.
- [x] [Review][Patch] LOW — enumerated doc surface `packages/iris-admin-mcp/README.md:167` (listed in Dev Notes → *Doc surfaces*) was not updated; `maxRows?`/`cursor?` added to the tool's Key Parameters cell (Rule #56).
- [x] [Review][Patch] LOW — `tool_support.md` said "both new fields" where three were added; corrected to name all three.
- [x] [Review][Patch] LOW — the tool description understated the cap mechanism ("rows the server has already fetched past the cap are dropped"); the handler stops pumping the cursor, so those rows are never fetched. Corrected.
- [x] [Review][Patch] LOW — story File List omitted the QA test file and claimed `468/468 (451 + 17 new)`; the tree actually carries two TS suites plus the new ObjectScript suite. File List and counts corrected.

**Deferred (ledgered — see `deferred-work.md`, code-review addendum):**

- [x] [Review][Resolved] MEDIUM — `35-4-CR-1`: the `%SYS` excursion added a privilege requirement `listPrivileges` never had, and a swallowed `Security.Users.Get` error status could silently disable the `%All` guard. **Resolved in rework iteration 1, not deferred:** the lead's policy call was to delete the excursion outright rather than choose between degrading and failing. Both halves dissolve — no `%SYS` switch means no added privilege requirement, and no lookup means no status to swallow. Roughly 45 lines of security-sensitive code removed.
- [x] [Review][Defer] LOW — `tRS` is not closed when an exception escapes either fetch loop [Security.cls:~3213,~3244] — deferred, pre-existing pattern across this file's handlers
- [x] [Review][Defer] LOW — on the raw REST path `maxRows` of `abc`/`0`/`-1`/`1.5` is silently coerced rather than rejected, and the effective value is not echoed [Security.cls:~3147] — deferred, mirrors the `AuditStatus` precedent; changing it is a cross-handler decision
- [x] [Review][Defer] LOW — a malformed `target` (`NoDotHere`, `Sample.`, `.Person`) reaches `UserColumnPrivs` unvalidated and surfaces a raw `<SUBSCRIPT>` 500 [Security.cls:~3200] — deferred, pre-existing and predates this story
- [x] [Review][Defer] LOW — whether the underlying stored procedure resolves GRANTEE names case-insensitively is unverified — deferred, needs its own probe. (The `%All`-name-matching half of this item was dissolved by the rework: no name matching remains in the handler.)
- [x] [Review][Defer] LOW — the signal fields repeat on every page including an empty past-the-end page, so summing `superUserPrivilegesOmitted` across pages yields nonsense — deferred, a consequence of the sibling spread convention
- [x] [Review][Defer] LOW — Rule #34's second-namespace smoke was neither performed nor recorded as a residual risk — deferred, residual risk now recorded

**Dismissed as noise (6):** `$NAMESPACE` allegedly left as `%SYS` on the exception path (false positive — the `Catch` block's first line is `Set $NAMESPACE = tOrigNS`, verified in source); a stale server-sent `nextCursor` surviving the spread (the handler never sends one — Rule #54); `maxRows`/`cursor` accepted on non-`listPrivileges` actions (pre-existing flat-schema pattern shared by `target`/`privilege`/`grantee`); non-array `privileges` coerced to `[]` (deliberate guard mirroring `audit.ts`, already covered); Rule #10 "default 100 not sent on the wire" (handler default matches and mirrors the `audit.ts` precedent — no live divergence); sprint-status `backlog`→`review` vs the story's claimed from-state (workflow bookkeeping, superseded by this review's own status write).

**Judgment call recorded for the lead's smoke gate:** ACs 35.4.1 (match the sibling pagination convention) and 35.4.5 (no shape change for under-cap callers) are in direct tension, which the story's Dev Notes resolved only for the signal fields and not for pagination itself. Opt-in pagination was chosen as the one resolution satisfying both — back-compat is a release gate on this project, and the cursor remains obtainable — but it is a deliberate, documented deviation from the always-paginate sibling convention and is flagged here rather than passed silently.

### Rework iteration 1 — lead policy call on `35-4-CR-1` (2026-08-18)

The lead reviewed the deferred MEDIUM and directed a third option: delete the `%SYS` excursion entirely rather than choose between degrading and failing, since IRIS already stamps the `%All` answer on every row as `GRANTED_VIA`. **Verified independently before implementing** — the lead's probe was explicitly not taken on faith.

**Probe 1 — the biconditional, swept instance-wide.** Rather than re-checking two rows, the reviewer swept **all 46 users and roles** on the instance, comparing "does `UserPrivs` emit any `SuperUser` row?" against "does this principal effectively hold `%All`?" (transitive role closure). Exactly four principals emit `SuperUser` rows — `_SYSTEM`, `SuperUser`, `_Ensemble`, `Josh` — and all four hold `%All`. **Zero counterexamples.** The sharpest control the lead asked for, `Admin` (holding `%Manager` + `%EnsRole_Administrator` + `%EnsRole_Developer`, powerful but not `%All`), returns 11 rows / 0 derived. The claim holds.

**Probe 2 — the column-level query, as required.** `UserColumnPrivs` **does** emit `GRANTED_VIA = SuperUser`: `_SYSTEM` against `%Dictionary.ClassDefinition` returns 224 rows, all derived; the `Admin` control returns 0. So the column loop's filter is doing real work and is **not** inert — stated explicitly here as the lead asked, rather than left implying something it does not do.

**One asymmetry found and documented.** The sweep's only mismatch is the reverse direction: the literal `%All` role AS a grantee emits ZERO `SuperUser` rows (as does a role holding `%All` via `GrantedRoles`). This is harmless and needs no special handling — nothing is omitted, and the response fields are gated on a non-zero omitted count, so those grantees correctly receive the untouched pre-35.4 shape. Live-confirmed: `?grantee=%All` returns the 4-key shape.

**Implementation.** The `tIsSuperUser` detection block, the `%SYS` switch, the `Security.Users.Exists`/`.Get`, the frontier walk, the visited set, the 50-hop guard, and the now-unused `tQueryNS` variable are all deleted. Both loops omit on `GRANTED_VIA = "SuperUser"` directly. The cap's exact-count rule is re-expressed without the flag: keep scanning past the cap only once at least one derived row has been omitted, so an ordinary grantee keeps the original early exit and pays nothing for the guarantee. The class-doc's Rule #54 / transitive-walk commentary is replaced with the row-signal rationale and the sweep evidence (no stale commentary left — that was Finding A's other half).

**Rule #59 re-verified against the NEW implementation** — not assumed from the tests staying green across the reimplementation, which the lead correctly flagged as non-evidence. Three mutations, each RED then restored GREEN: disabling the row filter (`If 0 && …`) failed `TestIndirectAllChainIsShortCircuited` on all three assertions AND `TestOmittedCountStaysExactWhenCapped`; reverting the exact-count `Continue` to a bare `Quit` failed `TestOmittedCountStaysExactWhenCapped` on its exact assertion; widening the zero-omitted gate to `>= 0` failed `TestNonSuperUserResponseShapeIsUnchanged` on all three (AC 35.4.5 pin confirmed drift-sensitive, per the lead's requirement 4).

**Live behavior is identical to the pre-rework implementation on every control:** `_SYSTEM` uncapped → 8 real / 15,333 omitted; `_SYSTEM` `maxRows=7` → 7 real / **15,333** omitted (exact) / `rowsCapped`; `Admin`, `%Developer`, and `%All` → the 4-key pre-35.4 shape with no new fields; column-level `_SYSTEM` → 224 omitted.

**Scope held.** The other four HIGH fixes were not re-opened; `35-4-CR-2` through `CR-7` remain deferred as ledgered, with `CR-5` narrowed to its surviving half.

**Verification after patching (final):** `@iris-mcp/admin` 480/480, `@iris-mcp/shared` 1326/1326, `@iris-mcp/all` 120/120 (E-1: tool/action counts unmoved), all per-package standalone per the `35-1-DEV-1` environment caveat. `ExecuteMCPv2.Tests.SqlPrivilegeBoundTest` 5/5 (total matches the 5 `Test*` methods, Rule #35). `tsc --noEmit` and `eslint` clean. `pnpm gen:governance-baseline:check` exit 0 (`:check` only, never the bare generator), frozen baseline unchanged (`1e62c5ad5bf7` / 141 / 201 / 60 — E-2 holds). Bootstrap regenerated after each ObjectScript change and re-run idempotent: `BOOTSTRAP_VERSION` `2742ce31228a` → `87d04d52e988` → `18e23e867553` → **`b353ec0ab2e7`**, roster unchanged at 29 classes with `REST/Dispatch.cls` last (Rule #24/#39; the new `ExecuteMCPv2.Tests.*` class is correctly OUT of the manifest). Review probe classes `ExecuteMCPv2.Temp.PrivProbe354`/`PrivProbe354b` and every disposable security principal deleted from IRIS and disk, verified by query; `src/ExecuteMCPv2/Temp/` removed.

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-08-18 | Story created; lead pre-story live probe established the `GRANTED_VIA` breakdown (15,333 `SuperUser` / 8 `Owner Privilege`), reproduced the 15,341-row / 2,900,478-character baseline exactly, and captured a `%Developer` control (11 rows, zero `SuperUser`) | Lead (claude-opus-5) |
| 2026-08-18 | Implemented: `maxRows` fetch-loop cap (both loops) + `%All`/`SuperUser` short-circuit in `Security.cls:SqlPrivilegeList`, live-proven on both the object- and column-level paths against real over-limit data (Rule #59); `maxRows`/`cursor` added to `iris_resource_manage`'s `listPrivileges` action with signal-preserving pagination; established empirically that a SQL `TOP` rewrite would not genuinely bound the scan any better than the existing fetch-loop idiom, so kept the latter and documented the distinction honestly (Rule #38). AC 35.4.5 back-compat proven mechanically. Docs updated at point of use; `35-SWEEP-4` closed in the ledger; one new LOW finding (`35-4-DEV-1`, the `system` param) ledgered rather than fixed, out of scope. `BOOTSTRAP_VERSION` `2742ce31228a` → `87d04d52e988`. Governance baseline unchanged. Status → review. | Dev (claude-sonnet-5) |
