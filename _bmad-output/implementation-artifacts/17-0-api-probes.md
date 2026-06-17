# Story 17.0 — Epic 17 Pre-Spec API Probe Reference

**Purpose:** Live-verified (Rule #16 pre-spec) IRIS API shapes for the three Epic-17 implementation areas, so the 17.1/17.2/17.3 dev agents have copy-paste-ready CRUD/enumeration recipes grounded in real shapes rather than rediscovering them mid-dev.

**Probe date:** 2026-06-16
**Namespace:** HSCUSTOM (interop/production work)
**Method:** READ-ONLY probes via `iris-dev-mcp` (`iris_sql_execute`, `iris_execute_command`, `iris_doc_get`) + cross-check against `irislib/` class sources. No state-changing operations were performed (no DefaultSettings created, no production items added/removed, no SQL writes).
**IRIS build:** IRIS for Windows (x86-64) 2025.1 (Build 230.2U)

> **How to read this doc:** each area gives (a) the verified class/table shape with the live evidence, (b) the copy-paste CRUD/enumeration recipe the story should use, and (c) any DISCREPANCY found vs. the lead's pre-gathered Dev-Notes evidence. **Two material discrepancies were found** — see Area 2 (`AdapterClassName`) and Area 3 (INFORMATION_SCHEMA table names). These are exactly the Rule #16 value and the recommended recipes below are adjusted accordingly.

---

## Area 1 — `Ens.Config.DefaultSettings` (Story 17.1: `iris_default_settings_manage`)

### Verified shape (matches lead evidence — no discrepancy)

Source: `iris_doc_get Ens.Config.DefaultSettings.cls` (HSCUSTOM, ENSLIB db) — confirmed live, identical to `irislib/Ens/Config/DefaultSettings.cls`.

- `Class Ens.Config.DefaultSettings Extends (%Persistent, %XML.Adaptor) [ Final, Inheritance = right, System = 4 ]` ✅
- `Index IdKey On (ProductionName, ItemName, HostClassName, SettingName) [ IdKey ]` ✅
- **IdKey delimiter is `||`** — confirmed by `%Import` (`item.ProductionName_"||"_item.ItemName_"||"_item.HostClassName_"||"_item.SettingName`) and `%OnAfterDelete` (`$piece($$$oidPrimary(oid),"||")`).
- Properties (all `XMLPROJECTION="attribute"`):
  - `ProductionName` %String(MAXLEN=255) `InitialExpression="*"`
  - `ItemName` %String(MAXLEN=255) `InitialExpression="*"`
  - `HostClassName` %String(MAXLEN=255) `InitialExpression="*"`
  - `SettingName` %String(MAXLEN=255) `InitialExpression="*"`
  - `SettingValue` %String(MAXLEN=2000)
  - `Description` %String(MAXLEN=2000)
  - `Deployable` %Boolean `InitialExpression=0`
- `Query EnumerateSettings()` → `SELECT ID,ProductionName,ItemName,HostClassName,SettingName,SettingValue,Deployable FROM DefaultSettings` ✅
- `%OnAfterSave(insert)` → calls `..UpdateProductionModFlags(..ProductionName)` ✅
- `%OnAfterDelete(oid)` → derives production from `$piece(...,"||")` → `..UpdateProductionModFlags(tProduction)` ✅
- `UpdateProductionModFlags(prod)` → `Ens.Config.Production.SetModified(prod)` (or increments the running-production mod counter for `*`). **No manual production recompile required** on set/delete. ✅

### Live confirmation

| Probe | Result |
|---|---|
| `SELECT TOP 5 ID,ProductionName,ItemName,HostClassName,SettingName,SettingValue,Deployable FROM Ens_Config.DefaultSettings` | rowCount 0 — table exists, queryable, currently empty |
| `SELECT COUNT(*) FROM Ens_Config.DefaultSettings` | `Cnt=0` — clean read, table present |

SQL table name: **`Ens_Config.DefaultSettings`** (note underscore in schema). ROWSPEC for list = `ID, ProductionName, ItemName, HostClassName, SettingName, SettingValue, Deployable` (Description is a property but NOT in `EnumerateSettings`; SELECT it explicitly if needed).

### Copy-paste CRUD recipe (Story 17.1)

```objectscript
; --- LIST (all, or filtered) ---
;   SELECT ID,ProductionName,ItemName,HostClassName,SettingName,SettingValue,Deployable,Description
;   FROM Ens_Config.DefaultSettings  [WHERE ProductionName=? AND ...]
; (use parameterized SQL; Description must be named explicitly — not in EnumerateSettings ROWSPEC)

; --- GET (exact tuple) ---
Set tId = tProd_"||"_tItem_"||"_tHostClass_"||"_tSetting   ; "*" for any wildcard slot
Set tObj = ##class(Ens.Config.DefaultSettings).%OpenId(tId)
If $IsObject(tObj) { ; read tObj.SettingValue / .Description / .Deployable }
; (For a wildcard-fallback lookup instead of exact-tuple, use
;  ##class(Ens.Config.DefaultSettings).%GetSetting(prod,item,hostClass,targetType,setting,.value) → %Boolean)

; --- SET (create or update) ---
Set tId = tProd_"||"_tItem_"||"_tHostClass_"||"_tSetting
If ##class(Ens.Config.DefaultSettings).%ExistsId(tId) {
    Set tObj = ##class(Ens.Config.DefaultSettings).%OpenId(tId)
} Else {
    Set tObj = ##class(Ens.Config.DefaultSettings).%New()
    Set tObj.ProductionName = tProd, tObj.ItemName = tItem
    Set tObj.HostClassName = tHostClass, tObj.SettingName = tSetting
}
Set tObj.SettingValue = tValue
Set:tDescriptionProvided tObj.Description = tDescription
Set:tDeployableProvided tObj.Deployable = +tDeployable
Set tSC = tObj.%Save()   ; %OnAfterSave auto-updates production mod flags — NO manual recompile

; --- DELETE ---
Set tSC = ##class(Ens.Config.DefaultSettings).%DeleteId(tId)   ; %OnAfterDelete auto-updates mod flags
```

**Wildcard semantics:** any of the 4 key slots may be `"*"` (the `InitialExpression`). A `"*"` means "applies to all" for that dimension; `%GetSetting` does the most-specific-first fallback. For 17.1's exact-tuple CRUD, always pass the literal 4 values the caller supplied (defaulting omitted slots to `"*"`).

**Governance (Rule #23):** `iris_default_settings_manage` is a NEW key → stays OUT of the frozen baseline `1e62c5ad5bf7`. `set`/`delete` are writes → `mutates:true` (default-disabled); `list`/`get` are reads → default-enabled.

---

## Area 2 — Production item add/remove + arbitrary settings (Story 17.2: `iris_production_item`)

### Verified shape

Sources: `irislib/Ens/Config/{Production,Item,Setting}.cls` + live `iris_execute_command` probes.

**`Ens.Config.Production`** (`Extends Ens.Config.Item`-adjacent persistent; line refs from `irislib/Ens/Config/Production.cls`):
- `Property Items As list Of Ens.Config.Item` (line 52) ✅ — live: `$classname(p.Items)` = `%Collection.ListOfObj`, member class `Ens.Config.Item`.
- `Method SaveToClass(pItem As Ens.Config.Item = {$$$NULLOREF}) As %Status` (line 117) ✅ — persists + recompiles the production class.
- `Method RemoveItem(target As Ens.Config.Item = {$$$NULLOREF})` (line 189) ✅
- `Method FindItemByConfigName(pConfigItemName, Output pStatus, pForceSwizzle=0) As Ens.Config.Item` (line 674) ✅
- `ClassMethod OpenItemByConfigName(pConfigItemName, Output pStatus) As Ens.Config.Item` (line 687) ✅

**`Ens.Config.Item`** (`Extends (%Persistent, %XML.Adaptor)`):
- Required props: `Name` %String(MAXLEN=128) `[Required]` (line 20); `ClassName` %String(MAXLEN=128) `[Required]` (line 27). ✅
- Other props: `Category`(MAXLEN=2500), `PoolSize`(%Integer MINVAL=0), `Enabled`(%Boolean default **1** — live-confirmed), `Foreground`(default 0), `Comment`(MAXLEN=2000), `Schedule`, `LogTraceEvents`(default 0), `DisableErrorTraps`.
- `Property Settings As list Of Ens.Config.Setting` (line 77) ✅ — holds arbitrary host/adapter settings. Live: `$classname(item.Settings)` = `%Collection.ListOfObj`.
- `ClassMethod NameExists(name, .id)` exists ✅ (used by current `set` path).

**`Ens.Config.Setting`** (`Extends (%SerialObject, %XML.Adaptor)` — it is a SERIAL/embedded object, not persistent):
- `Property Target As %String [ InitialExpression = "Adapter" ]` (line 10) — also `"Host"`.
- `Property Name As %String(MAXLEN=128)` (line 12).
- `Property Value As %String(MAXLEN="", XMLPROJECTION="CONTENT")` (line 14).

### ⚠️ DISCREPANCY #1 — `AdapterClassName` is NOT a settable property

The lead Dev-Notes baseline lists `adapterClassName`→`AdapterClassName` as one of the current 6 `set` keys. **Live probes prove `AdapterClassName` is a read-only CALCULATED METHOD, not a property:**

- `irislib/Ens/Config/Item.cls:237` → `Method AdapterClassName() As %String { ... Quit $$$comMemberKeyGet(..ClassName,$$$cCLASSparameter,"ADAPTER",$$$cPARAMdefault) }` — derived from the host class's `ADAPTER` parameter.
- Live: `##class(%Dictionary.CompiledProperty).%ExistsId("Ens.Config.Item||AdapterClassName")` = **0** (not a property).
- Live: `Set it=##class(Ens.Config.Item).%New() Set it.AdapterClassName="Foo.Bar"` → **`<PROPERTY DOES NOT EXIST> ... AdapterClassName,Ens.Config.Item`** (raises an error).

**Consequence for the back-compat baseline (Area 2b below):** the current `set` action's 6th key (`adapterClassName`) does NOT silently set a value — if a caller actually passes `adapterClassName`, the live handler throws `<PROPERTY DOES NOT EXIST>`, which the outer `Catch` converts to an error envelope. So the real current contract is **5 working keys + 1 (`adapterClassName`) that errors at runtime**. The other 5 keys (poolSize/enabled/comment/category/className) map to real `Ens.Config.Item` properties and work.

**Recommendation for 17.2 spec:** the back-compat "mechanical assertion" must capture the ACTUAL behavior, not the aspirational one. Two viable framings — the 17.2 spec author picks one:
- **(A) Preserve-exactly:** keep `adapterClassName` in the recognized-key list with its current throwing behavior. Mechanical assertion: passing the 5 working keys yields the unchanged `{action:"set",itemName,updatedSettings:[...]}` shape; the existing 5-key behavior is byte-for-byte preserved. (Does not assert anything new about `adapterClassName`.)
- **(B) Fix-forward (additive, recommended):** route `adapterClassName` (and any other non-property key) to an `Ens.Config.Setting` with `Target="Adapter"` on `tItem.Settings` instead of throwing. This is ADDITIVE (today it errors; tomorrow it succeeds) and must NOT change the output shape of the 5 working keys. If 17.2 takes this path, the back-compat assertion still pins the 5 working keys' shape; `adapterClassName` moving from "errors" to "succeeds via Setting" is the additive change and should be documented as such (Rule #19 additive proof: the OFF-path = the 5 known property keys, unchanged).

### Area 2a — Add / Remove recipe (Story 17.2, ADDITIVE)

```objectscript
; --- ADD an item ---
Set tProd = ##class(Ens.Config.Production).%OpenId(tProdName)   ; or OpenItemByConfigName context
If '$IsObject(tProd) { ; error: production not found }
Set tItem = ##class(Ens.Config.Item).%New()
Set tItem.Name = tName                 ; Required
Set tItem.ClassName = tClassName       ; Required
Set:tPoolSizeProvided  tItem.PoolSize = +tPoolSize
Set:tEnabledProvided   tItem.Enabled  = +tEnabled     ; default 1
Set:tCommentProvided   tItem.Comment  = tComment
Set:tCategoryProvided  tItem.Category = tCategory
Do tProd.Items.Insert(tItem)
Set tSC = tProd.SaveToClass(tItem)     ; persists + recompiles the production class

; --- REMOVE an item ---
Set tProd = ##class(Ens.Config.Production).%OpenId(tProdName)
Set tItem = tProd.FindItemByConfigName(tName, .tStatus)   ; locate by config name
If '$IsObject(tItem) { ; error: item not found in production }
Do tProd.RemoveItem(tItem)
Set tSC = tProd.SaveToClass()
```

**Live confirmation:** opened `SessionAgent.Sample.Production` read-only → `p.Items.Count()=5`, `$classname(p.Items.GetAt(1))="Ens.Config.Item"`, first item `SessionAgent.Sample.BS.OrderIngest`, `$classname(...Settings)="%Collection.ListOfObj"`. (No add/remove was executed — recipe verified by source + method existence: `SaveToClass`, `RemoveItem`, `FindItemByConfigName`, `OpenItemByConfigName` all `%ExistsId`=1.)

### Area 2b — Arbitrary host/adapter setting recipe (Story 17.2, ADDITIVE)

For a key NOT one of the recognized Item properties, create/update an `Ens.Config.Setting` on `tItem.Settings`:

```objectscript
; locate item
If '##class(Ens.Config.Item).NameExists(tItemName, .tID) { ; not found }
Set tItem = ##class(Ens.Config.Item).%OpenId(tID)
; find existing Setting by (Target,Name) or create a new one
Set tSetting = tItem.FindSettingByName(tSettingName, tTarget)   ; tTarget = "Host" | "Adapter"
If '$IsObject(tSetting) {
    Set tSetting = ##class(Ens.Config.Setting).%New()
    Set tSetting.Target = tTarget        ; default "Adapter"
    Set tSetting.Name = tSettingName
    Do tItem.Settings.Insert(tSetting)
}
Set tSetting.Value = tValue
Set tSC = tItem.%Save()
Do ##class(Ens.Director).UpdateProduction()   ; apply to running production (mirror current set path)
```

`Ens.Config.Item.FindSettingByName(pSettingName, pTarget="")` exists (`irislib/Ens/Config/Item.cls:342`) and returns the `Setting` or `""`.

### Area 2c — CURRENT `ItemManage` back-compat baseline (Task 2 — verbatim from `src/ExecuteMCPv2/REST/Interop.cls:326–475`)

> This is the exact current contract 17.2 MUST preserve. Captured verbatim from the live source.

**ClassMethod:** `ItemManage()` (the `iris_production_item` handler). **Required body params:** `action`, `itemName`; optional `namespace`, `settings` (object, for `set`).

**Actions:** `enable`, `disable`, `get`, `set` (validated — any other value → `ERROR "Parameter 'action' must be one of: enable, disable, get, set"`).

| Action | Mechanism (live code) | Output JSON (on success) |
|---|---|---|
| `enable` | `##class(Ens.Director).EnableConfigItem(itemName, 1, 1)` | `{"action":"enabled","itemName":<name>}` |
| `disable` | `##class(Ens.Director).EnableConfigItem(itemName, 0, 1)` | `{"action":"disabled","itemName":<name>}` |
| `get` | `SELECT Name,ClassName,Enabled,PoolSize,Comment,Category FROM Ens_Config.Item WHERE Name=?` | `{"action":"get","itemName":<Name>,"className":<ClassName>,"enabled":<bool>,"poolSize":<num>,"comment":<str if non-empty>,"category":<str if non-empty>}` (comment/category omitted when empty) |
| `set` | open item via `Ens.Config.Item.NameExists(name,.id)`→`%OpenId(id)`; apply recognized keys; `tItem.%Save()`; then `##class(Ens.Director).UpdateProduction()` | `{"action":"set","itemName":<name>,"updatedSettings":[<keys applied>]}` |

**`set` recognized keys (the "6 keys"):**

| JSON key | Maps to | Status (live-verified) |
|---|---|---|
| `poolSize` | `tItem.PoolSize` | ✅ works (real property) |
| `enabled` | `tItem.Enabled` | ✅ works (real property) |
| `comment` | `tItem.Comment` | ✅ works (real property) |
| `category` | `tItem.Category` | ✅ works (real property) |
| `className` | `tItem.ClassName` | ✅ works (real property) |
| `adapterClassName` | `tItem.AdapterClassName` | ⚠️ **THROWS `<PROPERTY DOES NOT EXIST>`** — `AdapterClassName` is a calculated method, not a settable property (DISCREPANCY #1). |

- **Unknown keys are currently SILENTLY IGNORED** (the `While` loop only pushes recognized keys to `tUpdated`; others fall through with no `ElseIf`).
- **Save mechanism:** `tItem.%Save()` then `##class(Ens.Director).UpdateProduction()`.
- **Namespace handling:** if `namespace` provided, `SwitchNamespace`; restored to `tOrigNS` on every exit path.
- **Error handling:** all error paths render via `ExecuteMCPv2.Utils.SanitizeError`; outer `Catch` restores namespace + renders sanitized error.

**Back-compat gate for 17.2 (Rule #19 — mechanical, not prose):** the assertion must prove that for the existing `enable`/`disable`/`get`/`set` actions with the existing recognized property keys, the output JSON shape (keys, types, omitted-when-empty behavior) is **byte-for-byte unchanged**. New `add`/`remove` actions and arbitrary-`Ens.Config.Setting` routing are ADDITIVE. If 17.2 fixes `adapterClassName` (framing B above), that is an additive improvement (errors→succeeds) and must not alter the 5 working keys' shape.

---

## Area 3 — SQL analysis (Story 17.3: `iris_sql_analyze`)

### ⭐ KEY DETERMINATION (AC 17.0.4): Atelier/SQL-only — NO new ObjectScript handler, NO bootstrap contribution

All four `iris_sql_analyze` actions (`explain`, `stats`, `indexUsage`, `running`) are achievable **purely via SQL through the Atelier query endpoint** (i.e. `iris_sql_execute`). No new `ExecuteMCPv2.*` ObjectScript handler is required, and therefore **17.3 contributes NOTHING to `bootstrap-classes.ts` / `BOOTSTRAP_VERSION`.**

**Consequence for 17.4 scope:** `17.4`'s `BOOTSTRAP_VERSION` bump and `gen:bootstrap` idempotence check cover ONLY the interop ObjectScript from 17.1 (DefaultSettings handler) and 17.2 (Interop.cls enhancement). 17.3 is TypeScript-only (a tool that issues SQL).

### `explain` — `EXPLAIN <query>` works as pure SQL ✅

`$SYSTEM.SQL.Explain` (`irislib/%SYSTEM/SQL.cls:3973`) is a classmethod with an **Output plan** param — NOT directly SQL-callable. **BUT** the SQL statement **`EXPLAIN <query>`** returns a plan result set and IS callable via Atelier `iris_sql_execute`.

Live confirmation:
- `EXPLAIN SELECT TOP 1 * FROM Ens_Config.Item` → returns a single column **`Plan`**, one row containing an XML `<plans><plan>…</plan></plans>` with `SQL:`, `Cost:`, module/loop text, and tuning warnings.
- `EXPLAIN SELECT Name, ClassName FROM Ens_Config.Item WHERE Enabled = 1` → `Plan` column, `Cost: 1020`, full plan text. ✅

**Recipe:** `iris_sql_execute({ query: "EXPLAIN " + userQuery, namespace })` → return the `Plan` column. (Index usage for `indexUsage` is derivable from this same plan text — the plan names the maps/indexes read, e.g. `Read master map Ens_Config.Item.IDKEY`.)

### `running`, `stats`, `indexUsage` — INFORMATION_SCHEMA tables

### ⚠️ DISCREPANCY #2 — INFORMATION_SCHEMA table names use UNDERSCORES

The lead Dev-Notes evidence cited `INFORMATION_SCHEMA.CURRENTSTATEMENTS`, `STATEMENTDAILYSTATS`, `STATEMENTHOURLYSTATS` (no underscores). **Those names do NOT resolve on HSCUSTOM** — `SELECT TOP 1 * FROM INFORMATION_SCHEMA.CURRENTSTATEMENTS` → `SQLCODE -30 Table 'INFORMATION_SCHEMA.CURRENTSTATEMENTS' not found`. The actual queryable SQL table names use **underscores**:

Enumerated live via `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='INFORMATION_SCHEMA' AND (TABLE_NAME [ 'STATEMENT' OR TABLE_NAME [ 'CURRENT')`:

```
CURRENT_CONNECTIONS, CURRENT_STATEMENTS, STATEMENTS, STATEMENT_CHILDREN,
STATEMENT_DAILY_STATS, STATEMENT_HOURLY_STATS, STATEMENT_LOCATIONS,
STATEMENT_PARAMETER_STATS, STATEMENT_PRIV_ACTIONS, STATEMENT_PRIV_OBJECTS,
STATEMENT_RELATIONS
```

| Action | Correct table (verified queryable) | Notable columns (live ROWSPEC) |
|---|---|---|
| `running` | **`INFORMATION_SCHEMA.CURRENT_STATEMENTS`** | `SQLStatementID, Server, ProcessID, StatementIndexHash, UserName, QueryRunType, QueryStmtType, Namespace, CachedQuery, StatementOrder, CurrentWorkerCount, ExecutionStart, ExecutionStartUTC, ExecutionDuration, Status` (… 22 cols) |
| `stats` | **`INFORMATION_SCHEMA.STATEMENTS`** (per-statement cumulative) + **`STATEMENT_DAILY_STATS`** / **`STATEMENT_HOURLY_STATS`** (time-bucketed) | STATEMENTS: `Hash, Statement, Plan, JSONPlan, StatCount, StatTotal, StatVariance, StatRowCount, StatCommands, StatAverage, StatStdDev, Timestamp, Frozen, UserName, …` (33 cols). DAILY: `Statement, Day, StatCount, StatTotal, StatVariance, StatRowCount, StatCommands`. HOURLY: `Day, Hour, StatCount, StatTotal, StatVariance, StatRowCount, StatCommands, Date`. |
| `indexUsage` | derive from the `EXPLAIN` plan text (maps/indexes named in the plan) and/or `INFORMATION_SCHEMA.STATEMENT_RELATIONS` | plan text names indexes (e.g. `…Item.IDKEY`); `STATEMENT_RELATIONS` relates statements to tables/relations |

Live confirmations:
- `SELECT TOP 1 * FROM INFORMATION_SCHEMA.CURRENT_STATEMENTS` → 1 row, 22 columns (e.g. an `Executing` DynamicStatement in HSCUSTOM). ✅
- `SELECT TOP 1 * FROM INFORMATION_SCHEMA.STATEMENTS` → 1 row, 33 columns (full plan/stats). ✅
- `SELECT TOP 1 * FROM INFORMATION_SCHEMA.STATEMENT_DAILY_STATS` → 1 row, 7 columns. ✅
- `SELECT TOP 1 * FROM INFORMATION_SCHEMA.STATEMENT_HOURLY_STATS` → 1 row, 8 columns. ✅

**Recommendation for 17.3 spec:** use the underscore names above. `%SYS.PTools.*` is the collection machinery behind these views; for read-only analysis the `INFORMATION_SCHEMA` views are sufficient and SQL-callable, so no PTools classmethod (and no ObjectScript handler) is needed.

**Governance (Rule #23):** `iris_sql_analyze` is a NEW key → stays OUT of the frozen baseline `1e62c5ad5bf7`. All four actions are READ-ONLY analysis → reads → default-enabled (no `mutates`). (No write action exists in this tool.)

---

## Summary of discrepancies vs. lead pre-gathered evidence (the Rule #16 value)

1. **`Ens.Config.Item.AdapterClassName`** — lead listed it as a settable `set` key; it is a **read-only calculated METHOD**. `Set tItem.AdapterClassName=x` raises `<PROPERTY DOES NOT EXIST>`. The current `ItemManage` "6 keys" = **5 working property keys + 1 (`adapterClassName`) that errors at runtime**. → affects 17.2 back-compat framing (Area 2, DISCREPANCY #1).
2. **INFORMATION_SCHEMA table names** — lead cited `CURRENTSTATEMENTS` / `STATEMENTDAILYSTATS` / `STATEMENTHOURLYSTATS` (no underscores); actual queryable names are **`CURRENT_STATEMENTS` / `STATEMENT_DAILY_STATS` / `STATEMENT_HOURLY_STATS`** (with underscores). The no-underscore names return `SQLCODE -30 table not found`. → affects 17.3 recipe (Area 3, DISCREPANCY #2).

Everything else in the lead's pre-gathered evidence (DefaultSettings full shape + IdKey + mod-flag hooks; Production `.Items`/`SaveToClass`/`RemoveItem`/`FindItemByConfigName`; Item Required props + `Settings`; `Ens.Config.Setting` Target/Name/Value; `EXPLAIN` returns a plan; STATEMENTS table exists) **verified correct live**.

## Determinations settled for downstream stories

- **17.1** — `iris_default_settings_manage`: NEW ObjectScript handler (DefaultSettings CRUD) → contributes to `bootstrap-classes.ts`, moves `BOOTSTRAP_VERSION` IN STORY 17.1 (Rule #24). Governance: new key, `mutates` on set/delete.
- **17.2** — `iris_production_item` add/remove + arbitrary settings: modifies `Interop.cls` (EXISTING handler) → regen `bootstrap-classes.ts`, move `BOOTSTRAP_VERSION` IN STORY 17.2 (Rule #24). Carries a mechanical back-compat assertion pinning the existing 5-property-key `set` + enable/disable/get output shapes (Rule #19). New `add`/`remove` keys → `mutates`.
- **17.3** — `iris_sql_analyze`: **TypeScript/SQL-only, NO ObjectScript handler, NO bootstrap contribution.** Uses `EXPLAIN <query>` + underscore-named INFORMATION_SCHEMA views.
- **17.4** — `BOOTSTRAP_VERSION` is moved incrementally by 17.1 and 17.2; 17.4 VERIFIES `gen:bootstrap` idempotence (no fresh diff) + docs rollup — it is NOT a deferred single bump (Rule #24). The bump covers ONLY interop ObjectScript (17.1 + 17.2); 17.3 adds nothing to bootstrap.
- **Governance baseline** stays frozen at `1e62c5ad5bf7` (141 keys); verify via `pnpm run gen:governance-baseline:check`; NEVER run the bare `gen-governance-baseline.mjs` (Rule #23/#25).
