# Story 17.0: Epic 16 Deferred Cleanup + Epic 17 Pre-Spec API Probes

**Status:** review

**Epic:** 17 — Interop & Dev Tools (`iris-interop-mcp` + `iris-dev-mcp`)

## Story

**As the** Project Lead preparing Epic 17, **I want** the Epic 16 retrospective's carry-forward items triaged and the three Epic-17 IRIS API areas probed and verified live BEFORE the 17.1–17.3 specs are finalized, **so that** the implementation stories are grounded in real API shapes (Rule #16 pre-spec) and the additive/back-compat/bootstrap discipline (Rules #19/#23/#24) is operationalized from the first story rather than rediscovered mid-dev.

## Context — Epic 16 Retro Review Gate

The Epic 16 retrospective (`epic-16-retro-2026-06-16.md`) routed BOTH of its Epic-17 prep items into this Story 17.0 (per Lead decision, retro §"Next Epic Preview" + Action Items #1/#3):
- **Apply Rule #24 NOW** — Epic 17 inherits the same "one bump at the closing story" language. Reinterpret at story creation: regenerate `bootstrap-classes.ts` + move `BOOTSTRAP_VERSION` per ObjectScript story; 17.4 VERIFIES idempotence (it is NOT a deferred single bump).
- **Flag the `iris_production_item` back-compat gate (Rule #19)** — Story 17.2 modifies an EXISTING live tool. Its AC must carry a **mechanical** back-compat proof (existing `enable`/`disable`/`get`/`set` + the 6 known setting keys + output shape byte-for-byte unchanged) — a failing-if-drift assertion, not a prose claim.
- **Apply Rule #23/#25** — new interop/dev governance keys stay OUT of the frozen baseline (`1e62c5ad5bf7`, 141 keys), governed by `mutates`; verify with `gen:governance-baseline:check`; never run the bare generator.
- **Apply Rule #16 pre-spec** — probe `Ens.Config.DefaultSettings`, `Ens.Config.Production`/`Item`/`Setting`, and `$SYSTEM.SQL.Explain`/PTools/`INFORMATION_SCHEMA` at story-creation time. This story is where that probe is done and recorded.

This story is **strictly additive** and touches **no** production source/ObjectScript and **no** `BOOTSTRAP_VERSION` — its deliverable is a verified reference document.

## Acceptance Criteria

- **AC 17.0.1** — A pre-spec API probe reference is produced at `_bmad-output/implementation-artifacts/17-0-api-probes.md`, covering all three Epic-17 API areas with the verified shapes from IRIS class sources AND a live read-only confirmation on HSCUSTOM.
- **AC 17.0.2** — **DefaultSettings (Story 17.1)**: confirm `Ens.Config.DefaultSettings` is a `%Persistent` class with `IdKey On (ProductionName, ItemName, HostClassName, SettingName)`; confirm the SQL table is `Ens_Config.DefaultSettings` (ROWSPEC: ID, ProductionName, ItemName, HostClassName, SettingName, SettingValue, Deployable; + `Description`); confirm CRUD path (list via SQL; get via `%OpenId(id)` or `%GetSetting`; set via `%New()`/`%OpenId` → set 4-tuple + `SettingValue` → `%Save()`; delete via `%DeleteId(id)`); confirm `%OnAfterSave`/`%OnAfterDelete` auto-update production mod flags (no manual recompile).
- **AC 17.0.3** — **Production item add/remove (Story 17.2)**: confirm `Ens.Config.Production.Items` is `list Of Ens.Config.Item`; confirm add = `%OpenId(prod)` → `Ens.Config.Item.%New()` (Required: `Name`, `ClassName`) → `Insert` into `.Items` → `tProd.SaveToClass()`; confirm remove = `tProd.RemoveItem(tItem)` → `SaveToClass()`; confirm arbitrary host/adapter settings = `Ens.Config.Setting` (`Target` Host/Adapter, `Name`, `Value`) entries on `tItem.Settings` (distinct from the 6 current keys, which map to Item **properties**); record the current `ItemManage` behavior (the 6 keys: poolSize/enabled/comment/category/className/adapterClassName) for the back-compat gate.
- **AC 17.0.4** — **SQL analysis (Story 17.3)**: determine whether each action (`explain`/`stats`/`indexUsage`/`running`) is achievable Atelier/SQL-only (no new handler, no bootstrap contribution) vs needs an ObjectScript handler. Confirm `EXPLAIN <query>` SQL statement returns a plan; confirm `INFORMATION_SCHEMA.CURRENTSTATEMENTS` (running), `INFORMATION_SCHEMA.STATEMENTS` + `STATEMENTDAILYSTATS`/`STATEMENTHOURLYSTATS` (stats) exist; record the determination that drives whether 17.4's bootstrap bump must cover dev ObjectScript.
- **AC 17.0.5** — The Epic 16 → Epic 17 retro/deferred-work triage table (below) is complete: every retro action item + relevant `deferred-work.md` item is INCLUDED / PROCESS / DEFERRED / DROPPED with rationale.
- **AC 17.0.6** — Reaffirm in writing (this story + sprint-status note) that 17.1/17.2 regenerate `bootstrap-classes.ts` + move `BOOTSTRAP_VERSION` per-story (Rule #24), the frozen governance baseline stays `1e62c5ad5bf7` (Rule #23/#25), and 17.2 carries a mechanical back-compat assertion (Rule #19).

## Tasks / Subtasks

- [x] **Task 1 (AC 17.0.1–17.0.4)** — Write `17-0-api-probes.md`. For each area: (a) cite the IRIS source class + line evidence already gathered in Dev Notes; (b) live read-only confirm on HSCUSTOM (e.g. `SELECT TOP 5 * FROM Ens_Config.DefaultSettings`; `SELECT * FROM INFORMATION_SCHEMA.CURRENTSTATEMENTS`; open a known production and enumerate `.Items`; run `EXPLAIN SELECT TOP 1 * FROM Ens_Config.Item`); (c) record the verified CRUD/enumeration recipe each story will use.
- [x] **Task 2 (AC 17.0.3)** — Record the EXACT current `ItemManage` contract (actions, the 6 keys, save mechanism, output shapes) verbatim from `src/ExecuteMCPv2/REST/Interop.cls:326–475` as the back-compat baseline 17.2 must preserve.
- [x] **Task 3 (AC 17.0.4)** — Make + record the Atelier-vs-handler determination for `iris_sql_analyze` so 17.4 scope (bootstrap coverage) is settled.
- [x] **Task 4 (AC 17.0.5–17.0.6)** — Finalize the triage table; add the Rule #24/#23/#19 standing-guidance note to `sprint-status.yaml` Epic 17 block.

## Dev Notes

### Pre-gathered probe evidence (lead, from `irislib/` sources — VERIFY live, don't rediscover)

**`Ens.Config.DefaultSettings`** (`irislib/Ens/Config/DefaultSettings.cls`):
- `Class … Extends (%Persistent, %XML.Adaptor) [ Final ]`; `Index IdKey On (ProductionName, ItemName, HostClassName, SettingName) [ IdKey ]` (line 17). IdKey delimiter is `||`.
- Props: `ProductionName`/`ItemName`/`HostClassName`/`SettingName` (all `InitialExpression "*"`, MAXLEN 255), `SettingValue` (MAXLEN 2000), `Description` (MAXLEN 2000), `Deployable` (%Boolean, default 0).
- `Query EnumerateSettings()` → `SELECT ID,ProductionName,ItemName,HostClassName,SettingName,SettingValue,Deployable FROM DefaultSettings` (line 252). SQL table: `Ens_Config.DefaultSettings`.
- `%GetSetting(prod,item,hostClass,targetType,setting,.value)` → %Boolean with wildcard-fallback lookup (line 198). For an EXACT-tuple get, prefer `%OpenId(id)`.
- `%OnAfterSave` (line 265) and `%OnAfterDelete` (line 288) call `UpdateProductionModFlags(prod)` — **no manual production recompile required** on set/delete.
- CRUD recipe: list→SQL; get→`%OpenId("prod||item||class||setting")` or `%GetSetting`; set→`%New()` (or `%OpenId` to update) → set 4 keys + `SettingValue`/`Description`/`Deployable` → `%Save()`; delete→`%DeleteId(id)`.

**`Ens.Config.Production` / `Item` / `Setting`** (`irislib/Ens/Config/{Production,Item,Setting}.cls`):
- `Production.Items As list Of Ens.Config.Item` (Production.cls:52). `Method SaveToClass(pItem)` (117) persists+recompiles the production class. `Method RemoveItem(target As Ens.Config.Item)` (189). `Method FindItemByConfigName(name,.status)` (674) / `ClassMethod OpenItemByConfigName(name,.status)` (687) to locate an item.
- `Item`: Required props `Name` (MAXLEN 128, ATTRIBUTE) + `ClassName` (MAXLEN 128). Other props: `Category`, `PoolSize`, `Enabled` (default 1), `Foreground`, `Comment`, `Schedule`, `LogTraceEvents`. `Settings As list Of Ens.Config.Setting` (Item.cls:77) holds arbitrary host/adapter settings.
- `Setting`: `Target` (default "Adapter"; also "Host"), `Name` (MAXLEN 128), `Value` (MAXLEN unlimited, CONTENT projection).
- **Add recipe**: `set p=##class(Ens.Config.Production).%OpenId(prodName)` → `set it=##class(Ens.Config.Item).%New()` → set `it.Name`,`it.ClassName`(+optional) → `do p.Items.Insert(it)` → `set sc=p.SaveToClass(it)`. **Remove**: `do p.RemoveItem(it)` → `p.SaveToClass()`.
- **Arbitrary setting set**: locate item, for a key NOT in the 6 known props, create/update an `Ens.Config.Setting` (`Target`,`Name`,`Value`) on `it.Settings`, then `it.%Save()` + `##class(Ens.Director).UpdateProduction()` (mirror current set path).

**Current `ItemManage` (back-compat baseline — `src/ExecuteMCPv2/REST/Interop.cls:326–475`)**:
- Actions: `enable`, `disable`, `get`, `set`. `enable`/`disable` → `Ens.Director.EnableConfigItem(name,0/1,1)`. `get` → SQL `SELECT Name,ClassName,Enabled,PoolSize,Comment,Category FROM Ens_Config.Item WHERE Name=?` → output `{action:"get",itemName,className,enabled(bool),poolSize(num),comment?,category?}`.
- `set` known keys (6): `poolSize`→`PoolSize`, `enabled`→`Enabled`, `comment`→`Comment`, `category`→`Category`, `className`→`ClassName`, `adapterClassName`→`AdapterClassName`; unknown keys currently **silently ignored**. Save: `tItem.%Save()` then `Ens.Director.UpdateProduction()`. Output: `{action:"set",itemName,updatedSettings:[...keys...]}`.
- 17.2 MUST preserve all the above. New `add`/`remove` actions + arbitrary-setting handling are ADDITIVE; unknown keys that today are ignored may, under 17.2, route to `Ens.Config.Setting` — confirm this does not change the existing 6-key output shape.

**SQL analysis (`iris_sql_analyze`, Story 17.3)** — `$SYSTEM.SQL.Explain` (`irislib/%SYSTEM/SQL.cls:3973`) is a classmethod (`ByRef sql, qualifiers, .dynArgs, Output plan`) — Output-param, not directly SQL-callable. BUT the SQL **`EXPLAIN <query>`** statement returns a plan result set (pure SQL via Atelier). Running statements: `INFORMATION_SCHEMA.CURRENTSTATEMENTS`. Stats: `INFORMATION_SCHEMA.STATEMENTS` + `STATEMENTDAILYSTATS`/`STATEMENTHOURLYSTATS` (+ `%SYS.PTools.*` for collection). Index usage: derivable from the plan / `INFORMATION_SCHEMA` relations.
- **Provisional determination (verify live):** all four actions appear achievable **Atelier/SQL-only** (no new ObjectScript handler, no bootstrap contribution). If live verification confirms, **17.4's `BOOTSTRAP_VERSION` bump covers ONLY interop ObjectScript** (DefaultSettings handler + production-item enhancement). If `EXPLAIN` or an INFORMATION_SCHEMA table is unavailable on HSCUSTOM and a handler is required, record it so 17.4 scope expands.

### Bootstrap / governance discipline (standing for Epic 17)
- Rule #24: 17.1 (DefaultSettings handler) and 17.2 (Interop.cls enhancement) each regenerate `bootstrap-classes.ts` (`pnpm run gen:bootstrap`) and move `BOOTSTRAP_VERSION` in the SAME story; do NOT defer to 17.4. 17.4 verifies `gen:bootstrap` is idempotent (no diff) + docs rollup.
- Rule #23/#25: governance baseline stays frozen at `1e62c5ad5bf7` (141 keys). New keys (`iris_default_settings_manage` set/delete; `iris_production_item` add/remove; `iris_sql_analyze` actions) are classified via `mutates` (writes default-disabled, reads default-enabled), NOT added to the baseline. Verify with `pnpm run gen:governance-baseline:check`; NEVER run the bare `gen-governance-baseline.mjs` (footgun — regrows the frozen file).
- Rule #19: 17.2 carries a mechanical back-compat assertion (existing actions/keys/output shape unchanged), not prose.

### Testing standards
Doc-only story (no production code). No new automated tests required; the deliverable is verified by the lead smoke (live read-only probes) + code review reading the doc against `irislib/` sources. If the QA stage finds no testable surface, that is the correct outcome for a prep/reference story — record it.

### References
- `epic-16-retro-2026-06-16.md` §"Next Epic Preview — Epic 17" + Action Items #1/#3
- `_bmad-output/planning-artifacts/epics.md:3577–3633` (Epic 17 + Stories 17.1–17.4)
- `.claude/rules/project-rules.md` Rules #2, #16, #18, #19, #23, #24, #25
- IRIS sources: `irislib/Ens/Config/{DefaultSettings,Production,Item,Setting}.cls`, `irislib/%SYSTEM/SQL.cls`, `irislib/%SYSTEM/SQL/PTools.cls`, `irislib/INFORMATION/SCHEMA/{CURRENTSTATEMENTS,STATEMENTS}.cls`

## Epic 16 → Epic 17 Retro-Review Triage

Covers Epic 16 retrospective (`epic-16-retro-2026-06-16.md`, 2026-06-16) Action Items + relevant `deferred-work.md`. Triage date: 2026-06-16.

| Item | Source | Triage Decision |
|---|---|---|
| AI#1 — Story 17.0: reinterpret "one bump at closer" (Rule #24) AND flag `iris_production_item` back-compat gate (Rule #19) at story creation | Epic 16 retro | **INCLUDE** — this story (AC 17.0.6) + Dev Notes "Bootstrap/governance discipline"; operationalized in 17.1/17.2/17.4 specs. |
| AI#2 — Harden pipeline spawn-prompts: dev/CR sub-agents must NOT `git add` `.vscode/settings.json`; lead unstages the toggle before commit | Epic 16 retro | **PROCESS (standing safety check)** — CORRECTION (CR 17.0): `.vscode/settings.json` DOES exist at the repo root and DOES contain `objectscript.conn` with `active: false` (sync currently off). The earlier "N/A — file does not exist" rationale was factually wrong. The bulk-export VSCode toggle (user global CLAUDE.md rule) therefore CAN apply if a future op flips `active` to `true`. Not an Epic-17 *feature* (it is pipeline hygiene, so it stays OUT of 17.1–17.3 story scope), but it is a LIVE standing safety practice, not N/A: the lead asserts `.vscode/settings.json` is never staged at each per-story commit, and any dev/CR agent that flips the toggle for a bulk export MUST restore it (and never `git add` it). |
| AI#3 — Epic 17 IRIS-API stories: probe `Ens.Config.DefaultSettings`/`Production`/`Item`/`$SYSTEM.SQL.Explain`+PTools at STORY-CREATION time (Rule #16 pre-spec) | Epic 16 retro | **INCLUDE** — this story (AC 17.0.1–17.0.4); evidence pre-gathered in Dev Notes, live-verified in Task 1. |
| AI#4 — `iris_backup_manage restore`: scriptable restore path if demand materializes | Epic 16 retro | **DEFER (future, no demand)** — interactive `^DBREST`/`CLUMENU^JRNRESTO` only; out of Epic 17 (interop/dev) scope. Carry in deferred-work. |
| Apply Rule #23/#25: new interop/dev keys stay out of frozen baseline `1e62c5ad5bf7`, governed by `mutates`; verify via `gen:governance-baseline:check`; never run bare generator | Epic 16 retro (Epic 17 prep) | **PROCESS** — standing guidance for 17.1–17.3; recorded AC 17.0.6 + Dev Notes + sprint-status note. |
| list-`Close`-in-catch codebase-wide `Security.cls` hardening (CR 15.x) | deferred-work.md | **DEFER** — admin-server `Security.cls` cross-cutting pass; no Epic 17 (interop/dev) intersection. New Epic-17 list methods adopt the correct `Close`-in-catch pattern from the start (note to 17.1/17.2 devs). |
| Connection/profile-layer items (CR 14.1/14.2 — concurrency race, health-check meta, port/timeout coercion, etc.) | deferred-work.md | **DEFER** — Epic 17 adds tools, not new connection/profile callers. No intersection. |
| `namespace` schema field declared-but-not-forwarded (suite-wide, CR 15.3-6) | deferred-work.md | **DEFER + guidance** — cross-tool consistency pass; new Epic-17 tools follow the prevailing forward-`namespace` pattern (DefaultSettings/production-item/sql-analyze all take `namespace`); not a 17.0 fix. |
| URL-encoded profile name not decoded (CR 14.5); admin-tool specifics (X.509/audit/LDAP/SSL, CR 15.2–15.4) | deferred-work.md | **DEFER** — admin-server refinements; no `iris-interop`/`iris-dev` intersection. |
| All Epic 5–12 retained-open + Epic 8.x legacy + docdb typed-property population | deferred-work.md | **DEFER** — re-affirmed; no Epic 17 intersection. |

## Dev Agent Record

### Agent Model Used
claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References
Live read-only probes on HSCUSTOM (no state-changing ops):
- `SELECT TOP 5 ... FROM Ens_Config.DefaultSettings` → rowCount 0 (table exists, empty); `SELECT COUNT(*)` → 0.
- `iris_doc_get Ens.Config.DefaultSettings.cls` → confirmed `[Final]` %Persistent, IdKey `||`, props, EnumerateSettings, %OnAfterSave/%OnAfterDelete mod-flag hooks.
- Opened `SessionAgent.Sample.Production` read-only → `Items.Count()=5`, member class `Ens.Config.Item`, `Settings` = `%Collection.ListOfObj`.
- `%ExistsId` checks: `Ens.Config.Production||{SaveToClass,RemoveItem}`=1, `Ens.Config.Item||NameExists`=1, `Ens.Director||{EnableConfigItem,UpdateProduction}`=1; **`Ens.Config.Item||AdapterClassName` CompiledProperty = 0** (it is a Method).
- `Set it.AdapterClassName="Foo.Bar"` → `<PROPERTY DOES NOT EXIST> ... AdapterClassName,Ens.Config.Item` (DISCREPANCY #1).
- `EXPLAIN SELECT TOP 1 * FROM Ens_Config.Item` and `EXPLAIN SELECT ... WHERE Enabled=1` → both return a `Plan` column with XML plan (Atelier/SQL-only confirmed).
- `INFORMATION_SCHEMA.CURRENTSTATEMENTS` → SQLCODE -30 not found; enumerated `INFORMATION_SCHEMA.TABLES` → actual names use UNDERSCORES: `CURRENT_STATEMENTS`, `STATEMENTS`, `STATEMENT_DAILY_STATS`, `STATEMENT_HOURLY_STATS` (all `SELECT TOP 1` confirmed queryable) (DISCREPANCY #2).

### Completion Notes List
- Produced `_bmad-output/implementation-artifacts/17-0-api-probes.md` — live-verified pre-spec probe reference for all 3 Epic-17 areas (AC 17.0.1–17.0.4).
- AC 17.0.2 (DefaultSettings): verified — class/IdKey/props/query/mod-flag hooks all match lead evidence. CRUD recipe recorded.
- AC 17.0.3 (Production item): add/remove + arbitrary-Setting recipes recorded; current `ItemManage` contract captured verbatim (Task 2). **Rule #16 DISCREPANCY #1**: `AdapterClassName` is a read-only calculated method, not a settable property — current "6 keys" = 5 working + `adapterClassName` which THROWS. 17.2 back-compat framing adjusted in doc.
- AC 17.0.4 (SQL analysis): **Determination settled — `iris_sql_analyze` is Atelier/SQL-only (NO ObjectScript handler, NO bootstrap contribution).** `EXPLAIN <query>` works as SQL. **Rule #16 DISCREPANCY #2**: INFORMATION_SCHEMA names use underscores on HSCUSTOM; recipe corrected.
- AC 17.0.5 (triage): table in story body already complete (every retro AI + deferred-work item triaged INCLUDE/PROCESS/DEFER/DROP with rationale).
- AC 17.0.6 (discipline reaffirmation): Rule #24 (per-story bootstrap regen) / Rule #23+#25 (frozen baseline `1e62c5ad5bf7`) / Rule #19 (17.2 mechanical back-compat) reaffirmed in this story + `sprint-status.yaml` Epic 17 block (augmented with the two probe discrepancies + the SQL-only determination for spec authors).
- No production ObjectScript/TypeScript touched; `BOOTSTRAP_VERSION`, `bootstrap-classes.ts`, `governance-baseline.ts` untouched. Doc-only story. No automated tests (correct outcome per Testing standards — no testable surface; verified by lead live-probe smoke + CR reading the doc against `irislib/`).

### File List
- `_bmad-output/implementation-artifacts/17-0-api-probes.md` (new — deliverable)
- `_bmad-output/implementation-artifacts/17-0-epic-16-deferred-cleanup.md` (modified — task checkboxes, Dev Agent Record, Change Log, Status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — 17.0 → in-progress→review; Epic 17 block augmented with probe-discrepancy + SQL-only determination note)

## Review Findings (Code Review 17.0 — 2026-06-16)

Doc-only prep story. The review's heart was verifying the probe doc's API claims against `irislib/` sources (Rules #2/#16) and the `ItemManage` back-compat baseline against live source (Rule #19). **All API claims and both dev-recorded discrepancies verified CORRECT against `irislib/` source.** One MED documentation-accuracy finding in the triage table was auto-fixed inline.

### Verified accurate (no change needed)
- **Area 1 (DefaultSettings)** — `irislib/Ens/Config/DefaultSettings.cls`: `[Final, Inheritance=right, System=4]` %Persistent (L10); IdKey 4-tuple (L17); `||` delimiter (L103 `%Import`, L291 `%OnAfterDelete`); all 7 props + MAXLENs + `InitialExpression="*"` (L20–38); `EnumerateSettings` ROWSPEC (L252–254, Description correctly noted as NOT in ROWSPEC); `%OnAfterSave` (L265) / `%OnAfterDelete` (L288) → `UpdateProductionModFlags` (L336). ✅
- **Area 2 baseline (`ItemManage`)** — `src/ExecuteMCPv2/REST/Interop.cls:326–475`: actions/validation msg (L352–353), enable/disable/get/set mechanisms + output shapes, get SQL string (L383), comment/category omit-when-empty (L407–412), the 6 `set` keys incl. `adapterClassName`→`tItem.AdapterClassName` (L449–454), unknown-keys-silently-ignored (no `ElseIf`), `%Save()`+`UpdateProduction()` (L457–461). Doc captured verbatim. ✅
- **Area 2 (Production/Item/Setting)** — Production.cls line refs exact (Items:52, SaveToClass:117, RemoveItem:189, FindItemByConfigName:674, OpenItemByConfigName:687); Item.cls Required `Name`(L20)/`ClassName`(L27), `Settings` list (L77), `FindSettingByName` (L342); Setting.cls `%SerialObject` (L5, doc correctly flags it serial not persistent), Target/Name/Value (L10–14). ✅
- **DISCREPANCY #1 (`AdapterClassName`)** — CONFIRMED: `irislib/Ens/Config/Item.cls:237` `Method AdapterClassName() As %String` (calculated from ADAPTER param, L241). It is a Method, not a settable Property — `Set tItem.AdapterClassName=x` raises `<PROPERTY DOES NOT EXIST>`. The dev's discrepancy finding is itself correct (would otherwise have been a HIGH per the review brief). ✅
- **DISCREPANCY #2 (INFORMATION_SCHEMA underscores)** — CONFIRMED against `irislib/INFORMATION/SCHEMA/` `SqlTableName` mappings: `CURRENTSTATEMENTS.cls`→`SqlTableName=CURRENT_STATEMENTS`, `STATEMENTDAILYSTATS.cls`→`STATEMENT_DAILY_STATS`, `STATEMENTHOURLYSTATS.cls`→`STATEMENT_HOURLY_STATS`, `STATEMENTS.cls`→`STATEMENTS` (no extra underscore — doc correct), plus `STATEMENT_RELATIONS`/`STATEMENT_CHILDREN`/etc. The lead's no-underscore names were the CLASS names, not the SQL table names. Dev finding correct. ✅
- **AC 17.0.4 (SQL-only determination)** — `$SYSTEM.SQL.Explain` at `irislib/%SYSTEM/SQL.cls:3973` has signature `(ByRef sql, qualifiers, ByRef dynArgs, Output plan)` — `Output plan` param confirms it is not directly SQL-callable, so the doc's pivot to the SQL `EXPLAIN <query>` statement (live-confirmed `Plan` column) is sound. The four INFORMATION_SCHEMA views all exist + are queryable. Determination (no handler, no bootstrap contribution → 17.4 covers only 17.1+17.2) is well-grounded. ✅
- **Governance/bootstrap discipline** — frozen baseline `1e62c5ad5bf7` / 141 keys confirmed against live test assertions (`audit-governance-coverage.test.ts:296`, `resource-sqlpriv-coverage.test.ts:104`, `ldap-governance-coverage.test.ts:243`). sprint-status.yaml Epic 17 block (L237–245) correctly records Rules #24/#23/#25/#19 + both discrepancies + the SQL-only determination. ✅
- **Triage DEFER targets** — backup-restore (deferred-work.md L464), namespace-not-forwarded pattern (CR 16.1-1/16.2-1/16.3), list-`Close`-in-catch hardening (CR 15.x) all genuinely tracked in `deferred-work.md`. ✅

### Auto-fixed inline
- **[CR 17.0-1 / MED — RESOLVED]** Triage table AI#2 rationale was factually wrong: it claimed "no `.vscode/settings.json` with `objectscript.conn.active` exists in this repo." The repo root `.vscode/settings.json` DOES exist and DOES contain `objectscript.conn` with `active: false` (sync currently off). The bulk-export VSCode toggle (user global CLAUDE.md rule) therefore CAN apply if a future op flips `active` to `true` — so AI#2 is NOT N/A; it is a live standing safety practice. Reclassified DROP→**PROCESS** with the corrected rationale (still OUT of 17.1–17.3 story scope as pipeline hygiene, not an Epic-17 feature). The triage *outcome* (no Epic-17 story added for it) is unchanged; only the rationale and classification were corrected.

### Deferred
- None new. (No HIGH findings; the single MED was auto-resolved inline.)

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Code review (CR 17.0): verified all probe-doc API claims + both dev discrepancies against `irislib/` sources — all CORRECT. Verified `ItemManage` back-compat baseline matches `Interop.cls:326–475` verbatim, frozen governance baseline `1e62c5ad5bf7`, triage DEFER targets tracked in deferred-work.md. Auto-fixed one MED: triage AI#2 rationale was factually wrong (`.vscode/settings.json` with `objectscript.conn.active:false` DOES exist) → reclassified DROP→PROCESS with corrected rationale; outcome unchanged. No HIGH findings. Status remains review (lead per-story smoke gate next). |
| 2026-06-16 | Story 17.0 created (Epic 16 retro review gate). Lead pre-gathered `Ens.Config.DefaultSettings`/`Production`/`Item`/`Setting` + `$SYSTEM.SQL.Explain`/PTools/`INFORMATION_SCHEMA` probe evidence from `irislib/` sources and the current `ItemManage` back-compat baseline. Deliverable: `17-0-api-probes.md` (live-verified). Triage of Epic 16 retro AIs + deferred-work complete. Status → ready-for-dev. |
| 2026-06-16 | Dev: live read-only probes on HSCUSTOM complete; produced `17-0-api-probes.md`. Verified DefaultSettings/Production/Item/Setting shapes + `EXPLAIN` SQL + INFORMATION_SCHEMA views. **Two Rule #16 discrepancies found & recorded**: (1) `Ens.Config.Item.AdapterClassName` is a read-only calculated method (not a settable property — throws `<PROPERTY DOES NOT EXIST>`), so the current 6-key `set` = 5 working + 1 erroring; (2) INFORMATION_SCHEMA tables use underscores (`CURRENT_STATEMENTS`/`STATEMENT_DAILY_STATS`/`STATEMENT_HOURLY_STATS`), lead's no-underscore names returned SQLCODE -30. Determination: `iris_sql_analyze` is Atelier/SQL-only (no handler/bootstrap). `sprint-status.yaml` Epic 17 block augmented. All 4 tasks complete. Status → review. |
