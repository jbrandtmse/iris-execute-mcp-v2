# Known Bugs — 2026-04-20

Two confirmed defects in `ExecuteMCPv2.REST.*` REST handlers, surfaced during the 2026-04-19 manual MCP suite retest pass. Both have been deferred from the immediate fix queue but are documented here for the next maintenance pass.

> **Important framing**: both bugs are in **our** REST handler code, not in InterSystems IRIS. Each handler misuses an IRIS API — the `%SYS.Task.History:TaskHistoryDetail` named query and the `Security.Resources.Create` / `Security.Roles.Create` class methods. The IRIS API contracts are correct as documented; our handlers call them with the wrong signatures.

## Environment (where these were reproduced)

| | |
|---|---|
| IRIS version | `IRIS for Windows (x86-64) 2025.1 (Build 230.2U) Wed Jun 4 2025 18:53:21 EDT` (per `iris_server_info.content.version`; equivalent to `WRITE $ZV`) |
| IRIS instance ID | `4D014938-EDEA-4522-81F8-03C1B706230C` |
| Atelier API version | `8` |
| Features enabled | DEEPSEE, ENSEMBLE, HEALTHSHARE |
| MCP suite commit at time of reproduction | `a813685` (Epic 10 retro) — both bugs were present pre-Epic 10 and are unaffected by Epic 10 changes |
| `BOOTSTRAP_VERSION` deployed | `5ffd4dee0649` |

---

## Bug 1 — `iris_task_history` `taskId` parameter is silently ignored

### Summary

Passing `taskId: <number>` to `iris_task_history` (any non-empty value) does not filter the result set. The endpoint returns rows for every scheduled task in the system, identical to calling without `taskId`. The cap (`maxRows`, default 100) works correctly; only the filter is broken.

### Severity

**MEDIUM** — the API contract documented in the tool's zod schema (`taskId?: string | number — Task ID to filter history (omit for all tasks)`) is not honored. Any caller writing tooling that depends on per-task history filtering gets misleading results without any error signal.

### Steps to reproduce

```
mcp__iris-ops-mcp__iris_task_history({ taskId: 1000, maxRows: 10 })
```

Expected: 10 rows for task ID 1000 (a known existing task ID — substitute any from `iris_task_list`).

Actual: 10 rows with mixed task IDs. Reproduced 2026-04-20 17:35 UTC, returned this representative sample:

```json
{
  "history": [
    {"taskName": "TASKMGR Parameter (Version) set to 3.1", "taskId": ""},
    {"taskName": "TASKMGR Resumed", "taskId": ""},
    {"taskName": "TASKMGR Set Purge 7", "taskId": ""},
    {"taskName": "TASKMGR Set Job Timeout 30", "taskId": ""},
    {"taskName": "TASKMGR Set MailServer ()", "taskId": ""},
    {"taskName": "TASKMGR Set MailTimeZone ()", "taskId": ""},
    {"taskName": "TASKMGR Set MailReplyTo ()", "taskId": ""},
    {"taskName": "Switch Journal", "taskId": "1"},
    {"taskName": "Purge Journal", "taskId": "2"},
    {"taskName": "Purge Tasks", "taskId": "3"}
  ],
  "count": 10,
  "total": 112,
  "maxRows": 10,
  "truncated": true
}
```

Notice: zero rows for `taskId: 1000`. The `total: 112` is the **unfiltered** count of all task history entries in the system, confirming the parameter was discarded server-side.

### Root cause

In [src/ExecuteMCPv2/REST/Task.cls](../src/ExecuteMCPv2/REST/Task.cls), the `TaskHistory()` classmethod calls:

```objectscript
Set tRS = ##class(%ResultSet).%New("%SYS.Task.History:TaskHistoryDetail")
If tTaskId '= "" {
    Set tSC2 = tRS.Execute(tTaskId)
}
Else {
    Set tSC2 = tRS.Execute("")
}
```

The `TaskHistoryDetail` named query in `%SYS.Task.History.cls` line 170 is declared as:

```objectscript
Query TaskHistoryDetail(NULL) As %SQLQuery(ROWSPEC = "...")
```

The `(NULL)` in the parameter list means **the query takes no input parameters**. Passing `tTaskId` to `Execute()` against this query is a no-op — IRIS silently ignores the unused argument and returns every history row.

The right query for filtering by task ID is **`TaskHistoryForTask(Task As %Integer)`** at line 148 of `%SYS.Task.History.cls`:

```objectscript
Query TaskHistoryForTask(Task As %Integer) As %SQLQuery(ROWSPEC = "...")
```

Note: the ROWSPEC for `TaskHistoryForTask` uses a slightly different column order (Task is column #5 vs #11 in `TaskHistoryDetail`). The handler's row-extraction code already references columns by name (`tRS.Get("Task Name")`, `tRS.Get("Task")`, etc.), so column-order differences will not break it — but the field-name list should be reverified against `TaskHistoryForTask`'s ROWSPEC to confirm every requested column exists in both queries.

### Recommended fix

Modify `TaskHistory()` in [src/ExecuteMCPv2/REST/Task.cls](../src/ExecuteMCPv2/REST/Task.cls) to pick the correct query based on whether `tTaskId` is set:

```objectscript
If tTaskId '= "" {
    Set tRS = ##class(%ResultSet).%New("%SYS.Task.History:TaskHistoryForTask")
    Set tSC2 = tRS.Execute(+tTaskId)
} Else {
    Set tRS = ##class(%ResultSet).%New("%SYS.Task.History:TaskHistoryDetail")
    Set tSC2 = tRS.Execute()
}
```

Plus a unit test that asserts the call with `taskId` returns only matching rows.

### Why it was missed

Unit tests for `iris_task_history` mock `IrisHttpClient` and verify the URL (`?taskId=1000`) is sent correctly. They don't simulate IRIS's query-parameter-binding behavior, so the silent ignore was invisible at the test layer. Live retest pass 2 (2026-04-20) was the first to verify the actual filter behavior end-to-end — and surfaced the issue.

### Workarounds for callers (until fixed)

- **Client-side filter**: pass no `taskId`, scan the returned `history[]` array, filter by `entry.taskId === <wanted-id>` in client code.
- **Don't use `taskId` in the response cap calculation**: the unfiltered query may return many more rows than expected. Use `maxRows: 1000` (the documented max) and filter client-side, accepting the larger payload.

---

## Bug 2 — `iris_resource_manage` and `iris_role_manage` create with `description` crashes

### Summary

Passing a `description` argument to either tool's `create` action throws an `<UNDEFINED>` ObjectScript error. Create without `description` works fine. The bug is symmetric across both tools because they share the same calling pattern into the IRIS `Security.*` API.

### Severity

**MEDIUM** — the description field is a documented input on both tools (the tool's `description` zod schema field, separate from the resource/role description, is independently broken). Resources and roles created via these MCP tools cannot carry descriptive metadata at creation time. Workaround exists (create without description, then set via `modify` if `modify` works — needs verification).

### Steps to reproduce

#### Resource

```
mcp__iris-admin-mcp__iris_resource_manage({
  action: "create",
  name: "MCPTestBugReportResource",
  description: "Test description to reproduce upstream Description bug"
})
```

Expected: success result `{"action":"created","name":"MCPTestBugReportResource"}`.

Actual: error response, captured 2026-04-20 17:35 UTC:

```
Error managing resource 'MCPTestBugReportResource': IRIS reported errors for POST /api/executemcp/v2/security/resource. Review the error details and correct the request. Details: خطأ #5001: خطأ #5002: ObjectScript error: <UNDEFINED>Create *Description
```

(The Arabic "خطأ" is "error" — there's an unrelated locale-leak in the IRIS `%Status` formatter that has been observed since the 2026-04-19 retest. Cosmetic, not part of this bug.)

#### Role

```
mcp__iris-admin-mcp__iris_role_manage({
  action: "create",
  name: "MCPTestBugReportRole",
  description: "Test description to reproduce upstream Description bug"
})
```

Same error pattern: `<UNDEFINED>Create *Description`, this time against `/api/executemcp/v2/security/role`.

#### Confirmation that `description` is the trigger

Same call to `iris_resource_manage` with `description` omitted **succeeds**:

```
mcp__iris-admin-mcp__iris_resource_manage({
  action: "create",
  name: "MCPTestBugReportResource"
})
→ {"action":"created","name":"MCPTestBugReportResource"}
```

(Cleanup: `iris_resource_manage({ action: "delete", name: "MCPTestBugReportResource" })` returned `{"action":"deleted","name":"MCPTestBugReportResource"}`.)

### Root cause

In [src/ExecuteMCPv2/REST/Security.cls](../src/ExecuteMCPv2/REST/Security.cls), the `ResourceManage()` and `RoleManage()` classmethods both build a `tProps()` array and pass it byref into `Security.Resources.Create` / `Security.Roles.Create`:

```objectscript
If tBody.%IsDefined("description") Set tProps("Description") = tBody.%Get("description")
If tBody.%IsDefined("publicPermission") Set tProps("PublicPermission") = tBody.%Get("publicPermission")

Set tSC = ##class(Security.Resources).Create(tName, .tProps)
```

But `Security.Resources.Create` has the following signature (per `%SYS:Security.Resources.cls` line ~90):

```objectscript
ClassMethod Create(
    Name As %String,
    Description As %String,
    PublicPermission As Security.Datatype.Permission,
    Type As %Integer
) As %Status
```

The 2nd argument is **`Description As %String`** — a positional scalar, not a `ByRef Properties` array. When the handler calls `Create(tName, .tProps)`, the IRIS method receives `Description` as the array reference's root value (which is undefined since only subscripted nodes were set). At the first reference to `Description` inside the method body, IRIS throws `<UNDEFINED>` and the error format reports the local variable name as `*Description`.

The byref-array calling convention used by our handler is correct for `Security.Resources.Modify(Name, ByRef Properties)` and `Security.Resources.Get(Name, ByRef Properties)` — both of which DO accept byref arrays. The asymmetry between `Create` (positional scalars) and `Modify`/`Get` (byref array) is the trap. There is also an `Internal` `CreateOne(ByRef Properties)` method that DOES take a byref array, intended for internal callers — but it's marked Internal and we shouldn't rely on it.

### Recommended fix

Modify both `ResourceManage()` and `RoleManage()` in [src/ExecuteMCPv2/REST/Security.cls](../src/ExecuteMCPv2/REST/Security.cls) to call `Create` with positional arguments:

```objectscript
; For resource:
Set tDescription = $Get(tProps("Description"))
Set tPublicPermission = $Get(tProps("PublicPermission"))
Set tSC = ##class(Security.Resources).Create(tName, tDescription, tPublicPermission)

; For role:
Set tDescription = $Get(tProps("Description"))
Set tResources = $Get(tProps("Resources"))
Set tGrantedRoles = $Get(tProps("GrantedRoles"))
Set tSC = ##class(Security.Roles).Create(tName, tDescription, tResources, tGrantedRoles)
```

(Verify `Security.Roles.Create` signature against `%SYS:Security.Roles.cls` for the exact positional argument order and any additional parameters.)

Plus a unit test that asserts both `iris_resource_manage create` and `iris_role_manage create` succeed when called with a `description`. (The existing tests pass without `description` — they didn't catch this.)

### Why it was missed

Same as Bug 1: the unit-test layer mocks the HTTP client and verifies the request body shape, not the IRIS-side behavior. The bug is in how the OBJECTSCRIPT handler invokes the IRIS API, two layers below the test harness. It was first surfaced live during retest pass 2 of the admin MCP server when an agent attempted a `MCPTestResource` round-trip with a description argument.

The bug only became *visible* (vs. just "IRIS reported errors") after the 2026-04-19 `IrisApiError.message` enhancement that surfaces `status.errors[]` detail. Before that fix, the error message was a generic `"IRIS reported errors for POST /api/executemcp/v2/security/resource"` with no hint of `<UNDEFINED>` or `Description`, so the underlying bug was indistinguishable from any other failure.

### Workarounds for callers (until fixed)

- **Omit `description` on create**, then call `modify` to set it after the fact. (Modify uses the byref array signature correctly per `Security.Resources.Modify(Name, ByRef Properties)` — this should work but is not yet verified in this codebase.)
- **Set description via SMP** after creating in the API.

### Related observations

- The Arabic locale leak in IRIS's `%Status` text formatter (`خطأ` instead of `Error`) appears in the error response. This is an InterSystems locale-handling anomaly observed on this Windows install of IRIS 2025.1 — separate from the bug above. Worth noting for any user running `[ Locale ]` settings other than American English. Not investigated here.

---

## Recommended priority

If addressing both: a single small ObjectScript-only story (~50 LOC, 4 unit tests) covers both. They live in different REST handler files (`Task.cls` and `Security.cls`) but share the same shape: misuse of an IRIS API contract. A `BOOTSTRAP_VERSION` bump rolls both fixes to existing installs automatically per the auto-upgrade flow.

Estimated effort: comparable to Story 10.4 (which was a similar scope). The reproductions above can serve as the new tests.

## References

- [src/ExecuteMCPv2/REST/Task.cls](../src/ExecuteMCPv2/REST/Task.cls) — `TaskHistory()` classmethod
- [src/ExecuteMCPv2/REST/Security.cls](../src/ExecuteMCPv2/REST/Security.cls) — `ResourceManage()` and `RoleManage()` classmethods
- `%SYS:Security.Resources.cls` — IRIS `Create` / `Modify` / `Get` API signatures (currently exported in this repo at [irissys/%SYS/Security/Resources.cls](../irissys/%SYS/Security/Resources.cls) thanks to the Story 10.2 stress-test export)
- `%SYS:Security.Roles.cls` — same, for the role variant
- `%SYS:Security.Roles.cls`, `%SYS:Security.Resources.cls` — verify `Create` argument order and types before fixing
- [irissys/%SYS/Task/History.cls](../irissys/%SYS/Task/History.cls) — `TaskHistoryDetail` (line 170) vs `TaskHistoryForTask(Task)` (line 148) named queries
- [_bmad-output/implementation-artifacts/epic-10-retro-2026-04-20.md](../_bmad-output/implementation-artifacts/epic-10-retro-2026-04-20.md) — Epic 10 retrospective, Action Items #1 and #2
