# Confirmed Bug — 2026-05-29

`iris_mapping_manage` ignores the `subscript` parameter for global mappings (create **and** delete).

> **Framing**: this is a defect in **our** REST handler code ([`ExecuteMCPv2.REST.Config.MappingManage`](../src/ExecuteMCPv2/REST/Config.cls)), not in InterSystems IRIS. The handler misuses the `Config.MapGlobals` API: it tries to pass the subscript as a separate `Subscript` property, but `Config.MapGlobals` has no such property — a subscript-level mapping must encode the subscript **inside the mapped global name** (e.g. `%SYS("HealthShare")`). The IRIS API contract is correct as documented; our handler calls it with the wrong shape.

Reported by FHIR Bridge dev (CPPCON-381, Epic 1). Confirmed by Quinn (QA) via live reproduction.

---

## Environment (where this was reproduced)

| | |
|---|---|
| IRIS version | `IRIS for Windows (x86-64) 2025.1 (Build 230.2U) Wed Jun 4 2025 18:53:21 EDT` |
| Namespace | `HSCUSTOM` (reproduced with a throwaway fake global; reporter hit it in `FHIRBRIDGE`) |
| `BOOTSTRAP_VERSION` (source) | `425c4448677c` |
| Tool | `iris-admin-mcp` → `iris_mapping_manage` (`type: "global"`) |
| Reproduced | 2026-05-29 |
| Status | **RESOLVED 2026-05-29** — fix in `Config.cls` (`BuildMappingName` + `IsGuardedBaseMapping`) + `mapping.ts` (`force` param). A follow-up code review added a live round-trip regression test (`ExecuteMCPv2.Tests.MappingRoundTripTest`) and threaded collation through the delete path (so a range mapping created under a non-default collation can be deleted via the tool). Verified via `ExecuteMCPv2.Tests.MappingTest` (9), `ExecuteMCPv2.Tests.MappingRoundTripTest` (1), `mapping.test.ts` (+4), and live REST round-trip. `BOOTSTRAP_VERSION` → `8f0cf75be984`. See CHANGELOG 2026-05-29. |

---

## Severity — HIGH

Silently mis-maps a **base** global instead of the intended subscript node. When the base global already has a meaningful default (e.g. `%SYS → IRISSYS`), the create call **overwrites that base mapping** (`%SYS → HSSYS` in the reporter's case), silently redirecting all system-config reads. There is no error at create time and the resulting mapping looks plausible, so it ships unnoticed; the failure surfaces far downstream and is hard to trace back (reporter saw a `#5911 'Character Set UTF-8 not installed'` compile failure days later, caused by `^%SYS(...)` NLS tables being redirected).

---

## Root cause (verified against IRIS source)

`Config.MapGlobals` ([`Config.MapGlobals.cls`](../irislib/) — read live from `IRISSYS`) documents the correct API in its own class comment:

```
; Now add a SLM mapping for a global XYZ(100). Note that two mappings will actually
; get created, a mapping of XYZ to namespace USER, and XYZ(100) to SAMPLES.
%SYS>s Name="XYZ(100)"
%SYS>s Properties("Database")="SAMPLES"
%SYS>s Status=##Class(Config.MapGlobals).Create(Namespace,Name,.Properties)
```

The subscript is part of **`Name`**, not a property. `Config.MapGlobals` persisted properties are only: `Collation`, `Database`, `LockDatabase`, `Description`, `Comments` — **there is no `Subscript` property.** So the handler's `Set tProps("Subscript") = ...` writes to a property the class silently discards, and `Create`/`Delete` operate on the bare base `Name`.

### Defective lines — [`src/ExecuteMCPv2/REST/Config.cls`](../src/ExecuteMCPv2/REST/Config.cls)

- **Create**, [Config.cls:581](../src/ExecuteMCPv2/REST/Config.cls#L581): `If tBody.%Get("subscript") '= "" Set tProps("Subscript") = tBody.%Get("subscript")` — sets a non-existent property.
- **Create**, [Config.cls:584](../src/ExecuteMCPv2/REST/Config.cls#L584): `$ClassMethod(tClassName, "Create", tNamespace, tName, .tProps)` — passes the **base** `tName`, not `tName_subscript`.
- **Delete**, [Config.cls:592](../src/ExecuteMCPv2/REST/Config.cls#L592): `$ClassMethod(tClassName, "Delete", tNamespace, tName)` — passes the **base** `tName`, ignoring `subscript` entirely.

Why `iris_mapping_list` still renders subscripts correctly (and the manage path doesn't): the `Config.MapGlobals:List` query returns each subscript mapping as its own row whose `Name` column already contains the full `%SYS("HealthShare")`. The list handler reads `tRS.Get("Name")`, so the subscript rides along in the name. The manage path never builds that full name. This is consistent with the reporter's observation that read works but create/delete don't.

---

## Reproduction (live, this session)

**1. Create a subscript mapping via the tool** (fake global, no existing base to clobber, mapped to existing `IRISSYS`):

```
iris_mapping_manage(action="create", type="global", namespace="HSCUSTOM",
                    name="QUINNSLMTEST", subscript="(\"ABC\")",
                    database="IRISSYS", collation=5)
```
Returned: `{"action":"created","type":"global","namespace":"HSCUSTOM","name":"QUINNSLMTEST"}`
→ echoed `name` is the **base** `QUINNSLMTEST`, not `QUINNSLMTEST("ABC")`.

**2. Inspect persisted state** (`Config.MapGlobals:List` for `QUINNSLMTEST*`):
```
Global=[QUINNSLMTEST] Subscript=[] Database=[IRISSYS]
```
→ **`Subscript` is empty.** A base mapping was created; the `("ABC")` subscript was dropped.

**3. Delete by subscript** (asked to remove the `("ABC")` node):
```
iris_mapping_manage(action="delete", type="global", namespace="HSCUSTOM",
                    name="QUINNSLMTEST", subscript="(\"ABC\")")
```
Returned: `{"action":"deleted",...,"name":"QUINNSLMTEST"}` and removed the **base** mapping (verified `Remaining=0`).
→ delete also ignored `subscript` and targeted the base — matching the reporter's `ERROR #451` (which fired because in their namespace a child subscript node existed under the base they were unintentionally deleting).

### Expected vs Actual

| | Expected | Actual |
|---|---|---|
| Create | row `Global=QUINNSLMTEST, Subscript=("ABC"), Database=IRISSYS`; base untouched | row `Global=QUINNSLMTEST, Subscript=(empty)`; **base remapped** |
| Delete (by subscript) | removes only the `("ABC")` node | removes the **base** mapping |

---

## Suggested fix

1. **Thread the subscript into the global name** before calling `Config.MapGlobals`. Build the effective name as `tName_tSubscript` (producing `%SYS("HealthShare")`) and pass that to both `Create` and `Delete`. Drop the bogus `tProps("Subscript")` assignment (Config.cls:581) — it has no effect.
   - Validate the subscript shape first; `Config.MapGlobals.IsValidSubscript(sub, collation)` exists for this.
2. **Safety guard** (per reporter): refuse to create/overwrite an existing **base** mapping for a `%`-prefixed system global (especially `%SYS`) unless an explicit `force` flag is set — silently remapping `%SYS` is almost never intended and is the high-severity failure mode here.
3. **Regression tests** (see below).
4. **Bootstrap**: this fix touches an embedded class, so regenerate `bootstrap-classes.ts` (`pnpm run gen:bootstrap`) and bump `BOOTSTRAP_VERSION` in the same change. Do **not** hand-edit the generated file (project Rule #18).
5. **Documentation**: if the fix changes the tool's interface in any way — e.g. the `subscript` parameter's accepted format/semantics, a new `force` flag, the shape of the returned `name` (which should now echo `%SYS("HealthShare")` rather than the base), or error behavior — update **all** documentation that describes this feature to match. This includes the `iris_mapping_manage` tool description / Zod schema (`packages/`), the per-package tool docs, and any usage examples or rollup docs that reference global mapping behavior. Interface changes that ship without doc updates leave callers working from a stale contract — the same trap that contributed to this bug (the schema advertised a `subscript` field the handler never honored).

---

## Regression tests to add

1. **Create subscript-level mapping**: create `name=GTEST subscript=("ABC") database=<DB>`; assert via `Config.MapGlobals:List` that a row exists with `Global=GTEST, Subscript=("ABC"), Database=<DB>` AND (if a base `GTEST` mapping pre-existed) that the base mapping is **unchanged**.
2. **Delete by subscript**: delete `name=GTEST subscript=("ABC")`; assert the `("ABC")` row is gone and the base `GTEST` row (if any) remains.
3. **System-global guard** (if guard implemented): attempt to overwrite base `%SYS` without `force` → expect refusal/error; with `force` → expect success.

---

## Reporter's workaround (already applied in their namespace)

Use `Config.MapGlobals` directly with the subscript embedded in the name:
```objectscript
Do ##class(Config.MapGlobals).Delete("FHIRBRIDGE","%SYS(""HealthShare"")")
Do ##class(Config.MapGlobals).Delete("FHIRBRIDGE","%SYS")
Set p("Database")="IRISSYS", p("Collation")=5, p("LockDatabase")="IRISSYS"
Do ##class(Config.MapGlobals).Create("FHIRBRIDGE","%SYS",.p)
Set q("Database")="HSSYS", q("Collation")=5
Do ##class(Config.MapGlobals).Create("FHIRBRIDGE","%SYS(""HealthShare"")",.q)
```

---

## Cleanup note

Reproduction used a throwaway fake global `QUINNSLMTEST` in `HSCUSTOM` mapped to `IRISSYS` (harmless — no real global affected). It was deleted; `Config.MapGlobals:List` for `QUINNSLMTEST*` returns `Remaining=0`. No test residue left.
