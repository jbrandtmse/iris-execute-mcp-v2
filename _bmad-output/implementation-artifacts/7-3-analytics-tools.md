# Story 7.3: Analytics Tools

Status: done

## Story

As an analyst,
I want to execute MDX queries and manage DeepSee cubes through MCP tools,
so that I can run analytics and maintain BI infrastructure without the Management Portal.

## Acceptance Criteria

1. **AC1 (FR104)**: `iris.analytics.mdx` executes an MDX query and returns results as a structured pivot table with axis labels, measure values, and dimension members. Invalid MDX returns an MCP tool error.
2. **AC2 (FR105)**: `iris.analytics.cubes` with action "list" returns all cubes in the namespace with name, source class, last build time, and record count. Action "build" triggers a full rebuild. Action "sync" triggers incremental synchronization.
3. **AC3**: `ExecuteMCPv2.REST.Analytics` handler class is created and compiles on IRIS.
4. **AC4**: Routes added to `ExecuteMCPv2.REST.Dispatch` for analytics endpoints.
5. **AC5**: `iris.analytics.mdx` annotated as readOnlyHint: true. `iris.analytics.cubes` annotated as destructiveHint: false. All tools have scope NS.
6. **AC6**: Unit tests with mocked HTTP verify parameter validation, response parsing, and error handling.
7. **AC7**: `turbo build` and `turbo test` pass. Handler compiles on IRIS.

## Tasks / Subtasks

- [x] Task 1: Create ExecuteMCPv2.REST.Analytics ObjectScript handler (AC: 3)
  - [x] Create `src/ExecuteMCPv2/REST/Analytics.cls` extending `%Atelier.REST`
  - [x] Implement `ExecuteMDX` class method:
    - Read JSON body with `query` field
    - Use `##class(%DeepSee.ResultSet).%ExecuteDirect(query, , .tSC)` to execute MDX
    - Iterate result set: get axis count, row count, column count
    - Get axis labels via `%GetOrdinalLabel`
    - Get cell values via `%GetValue`
    - Return structured JSON with columns, rows, axisLabels
  - [x] Implement `CubeList` class method:
    - Use `##class(%DeepSee.Utils).%GetCubeList(.tList)` to get cube names
    - For each cube, get details via `%GetCubeClass`, `%GetCubeFactCount`, `%GetCubeModifiedDate`
    - Return array of cube objects
  - [x] Implement `CubeAction` class method:
    - Read JSON body with `action` ("build" or "sync") and `cube` name
    - "build": `##class(%DeepSee.Utils).%BuildCube(cube, 0)` (synchronous, pAsync=0)
    - "sync": `##class(%DeepSee.Utils).%SynchronizeCube(cube, 0)` (pVerbose=0)
    - Return status and affected facts count
  - [x] Follow save/restore namespace pattern from Task.cls
  - [x] Use Utils.ValidateRequired for input validation

- [x] Task 2: Add routes to Dispatch.cls (AC: 4)
  - [x] Add `POST /analytics/mdx` → `ExecuteMCPv2.REST.Analytics:ExecuteMDX`
  - [x] Add `GET /analytics/cubes` → `ExecuteMCPv2.REST.Analytics:CubeList`
  - [x] Add `POST /analytics/cubes` → `ExecuteMCPv2.REST.Analytics:CubeAction`

- [x] Task 3: Update ipm/module.xml (AC: 3)
  - [x] Add `Analytics.cls` resource entry

- [x] Task 4: Create analytics.ts TypeScript tools (AC: 1, 2, 5)
  - [x] Create `packages/iris-data-mcp/src/tools/analytics.ts`
  - [x] Define `analyticsMdxTool`:
    - Input: query (string, required), namespace (optional)
    - POST `/api/executemcp/v2/analytics/mdx` with { query, namespace }
    - Annotations: readOnlyHint: true, scope: NS
  - [x] Define `analyticsCubesTool`:
    - Input: action (enum: list/build/sync), cube (optional for list), namespace (optional)
    - "list": GET `/api/executemcp/v2/analytics/cubes?namespace={ns}`
    - "build"/"sync": POST `/api/executemcp/v2/analytics/cubes` with { action, cube, namespace }
    - Annotations: destructiveHint: false, scope: NS

- [x] Task 5: Wire tools into tools/index.ts (AC: 5)
  - [x] Import analyticsMdxTool, analyticsCubesTool from `./analytics.js`
  - [x] Add to tools array (now 6 total: 4 docdb + 2 analytics)
  - [x] Update index.test.ts tool count and name checks

- [x] Task 6: Create unit tests (AC: 6)
  - [x] Create `packages/iris-data-mcp/src/__tests__/analytics.test.ts`
  - [x] Test MDX tool handler with mocked response (structured result)
  - [x] Test MDX error handling (invalid query returns error)
  - [x] Test cubes list handler with mocked response
  - [x] Test cubes build/sync actions
  - [x] Test Zod validation (missing query, invalid action)
  - [x] Test namespace resolution

- [x] Task 7: Validate (AC: 7)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests must pass

## Dev Notes

### VERIFIED IRIS DeepSee APIs

All methods verified via `%Dictionary.MethodDefinition` query on live IRIS instance.

**MDX Execution:**
```
##class(%DeepSee.ResultSet).%ExecuteDirect(pMDX, &pParms, *pSC)
  Returns: %DeepSee.ResultSet (class method)
  pMDX: MDX query string
  pParms: parameter array (pass empty)
  pSC: output %Status
```

**Result Set Methods (instance methods):**
```
%GetAxisCount(*pInfo) → %Integer
%GetAxisSize(pAxis) → %Integer  
%GetRowCount() → %Integer
%GetColumnCount() → %Integer
%GetOrdinalLabel(*pLabel, pAxis, pPosition, *pFormat) → %Integer
%GetValue(pNode...) → %String
```

**Cube Management:**
```
##class(%DeepSee.Utils).%GetCubeList(*pList, pType, pNonAbstract, pBaseCube)
  Returns: %Status; pList is output array subscripted by cube name

##class(%DeepSee.Utils).%GetCubeClass(pCubeName, *pStatus) → %String
##class(%DeepSee.Utils).%GetCubeFactCount(pCubeName, *pStatus) → %Integer
##class(%DeepSee.Utils).%GetCubeModifiedDate(pCubeName, *pStatus) → %DeepSee.Datatype.dateTime

##class(%DeepSee.Utils).%BuildCube(pCubeList, pAsync=1, pVerbose=1, ...)
  Returns: %Status; set pAsync=0 for synchronous

##class(%DeepSee.Utils).%SynchronizeCube(pCubeList, pVerbose=1, *pFactsUpdated)
  Returns: %Status; pFactsUpdated is output integer
```

### ObjectScript Handler Pattern

Follow `src/ExecuteMCPv2/REST/Task.cls` pattern exactly:
- Extend `%Atelier.REST`
- Save/restore namespace: `Set tOrigNS = $NAMESPACE` / `Set $NAMESPACE = tOrigNS`
- Use `..RenderResponseBody()` for JSON response
- Use `ExecuteMCPv2.Utils` for validation and error sanitization
- Try/catch with namespace restore in both success and error paths

### MDX Result Extraction Pattern

```objectscript
Set tRS = ##class(%DeepSee.ResultSet).%ExecuteDirect(tQuery, , .tSC)
If $$$ISERR(tSC) { /* return error */ }

Set tRowCount = tRS.%GetRowCount()
Set tColCount = tRS.%GetColumnCount()

; Get column labels (axis 1 = columns)
Set tColumns = []
For i=1:1:tColCount {
    Set tLabelCount = tRS.%GetOrdinalLabel(.tLabel, 1, i)
    Do tColumns.%Push(tLabel)
}

; Get rows with values
Set tRows = []
For r=1:1:tRowCount {
    Set tRow = {}
    ; Row label (axis 2 = rows)
    Set tLabelCount = tRS.%GetOrdinalLabel(.tLabel, 2, r)
    Do tRow.%Set("label", tLabel)
    ; Cell values
    Set tValues = []
    For c=1:1:tColCount {
        Set tVal = tRS.%GetValue(r, c)
        Do tValues.%Push(tVal)
    }
    Do tRow.%Set("values", tValues)
    Do tRows.%Push(tRow)
}
```

### Cube List Extraction Pattern

```objectscript
Set tSC = ##class(%DeepSee.Utils).%GetCubeList(.tList)
; tList is subscripted by cube name: tList("CubeName") = ""
Set tCubes = []
Set tName = $Order(tList(""))
While tName '= "" {
    Set tCube = {}
    Do tCube.%Set("name", tName)
    Do tCube.%Set("sourceClass", ##class(%DeepSee.Utils).%GetCubeClass(tName))
    Do tCube.%Set("factCount", ##class(%DeepSee.Utils).%GetCubeFactCount(tName), "number")
    Do tCube.%Set("lastBuildTime", ##class(%DeepSee.Utils).%GetCubeModifiedDate(tName))
    Do tCubes.%Push(tCube)
    Set tName = $Order(tList(tName))
}
```

### TypeScript Tool Pattern

```typescript
const BASE_URL = "/api/executemcp/v2";

handler: async (args, ctx) => {
  const { query, namespace } = args as { query: string; namespace?: string };
  const ns = ctx.resolveNamespace(namespace);
  const path = `${BASE_URL}/analytics/mdx`;
  const response = await ctx.http.post(path, { query, namespace: ns });
  const result = response.result;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
};
```

### File Locations

| What | Path |
|------|------|
| New ObjectScript handler | `src/ExecuteMCPv2/REST/Analytics.cls` |
| Dispatch (add routes) | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| IPM module | `ipm/module.xml` |
| New TypeScript tools | `packages/iris-data-mcp/src/tools/analytics.ts` |
| New tests | `packages/iris-data-mcp/src/__tests__/analytics.test.ts` |
| Wire into | `packages/iris-data-mcp/src/tools/index.ts` |
| Update | `packages/iris-data-mcp/src/__tests__/index.test.ts` |
| Reference handler | `src/ExecuteMCPv2/REST/Task.cls` (pattern template) |

### Critical Rules

- DeepSee classes run in the **target namespace** (like Ensemble classes), NOT %SYS
- Use `ctx.resolveNamespace()` and pass namespace in the request body to the custom REST handler
- The handler receives namespace from the request body and switches to it
- `%BuildCube` with pAsync=0 runs synchronously — may take time for large cubes
- `%GetCubeList` returns a subscripted array, NOT a $ListBuild list — iterate with $Order
- `%ExecuteDirect` is a CLASS METHOD on `%DeepSee.ResultSet`, NOT an instance method
- `%GetValue`, `%GetOrdinalLabel` etc. are INSTANCE METHODS on the result set object
- Update `ipm/module.xml` to include Analytics.cls

### Previous Story Intelligence (Story 7.2)

- DocDB tools used IRIS built-in REST API directly (no handler needed)
- Analytics tools need a custom handler because DeepSee has no built-in REST API with the needed granularity
- extractResult() helper from docdb.ts can be referenced for response handling pattern
- 4 DocDB tools + 2 analytics tools = 6 total tools in iris-data-mcp after this story

### References

- [Source: %Dictionary.MethodDefinition queries on live IRIS — verified signatures]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.3]
- [Source: _bmad-output/planning-artifacts/architecture.md lines 252, 740, 808]
- [Source: src/ExecuteMCPv2/REST/Task.cls (handler pattern)]
- [Source: packages/iris-ops-mcp/src/tools/task.ts (TypeScript tool pattern)]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None required - all tasks completed without debugging issues.

### Completion Notes List
- Created Analytics.cls handler with 3 class methods (ExecuteMDX, CubeList, CubeAction) following Task.cls pattern
- Added 3 routes to Dispatch.cls for analytics endpoints
- Added Analytics.cls resource to ipm/module.xml
- Created analytics.ts with 2 tool definitions (analyticsMdxTool, analyticsCubesTool) with proper annotations
- Wired tools into index.ts (6 total tools now)
- Created 23 unit tests covering MDX execution, cube operations, error handling, namespace resolution
- Updated index.test.ts tool counts from 4 to 6
- turbo build passes, all 84 iris-data-mcp tests pass
- Handler compiled successfully on IRIS
- Fixed TypeScript type error with AtelierEnvelope by using extractResult helper function pattern (same as docdb.ts)

### Review Findings
- [x] [Review][Patch] Duplicate `extractResult` function in analytics.ts and docdb.ts — resolved: exported from docdb.ts, imported in analytics.ts
- [x] [Review][Defer] No timeout protection for synchronous `%BuildCube` (pAsync=0) — deferred, by-design per story spec
- [x] [Review][Dismiss] Zod schema allows build/sync without cube at schema level — dismissed, runtime check is adequate

### Change Log
- 2026-04-07: Story 7.3 implementation complete - analytics MDX and cubes tools

### File List
- src/ExecuteMCPv2/REST/Analytics.cls (new)
- src/ExecuteMCPv2/REST/Dispatch.cls (modified - added analytics routes)
- ipm/module.xml (modified - added Analytics.cls resource)
- packages/iris-data-mcp/src/tools/analytics.ts (new)
- packages/iris-data-mcp/src/tools/index.ts (modified - added analytics imports)
- packages/iris-data-mcp/src/__tests__/analytics.test.ts (new)
- packages/iris-data-mcp/src/__tests__/index.test.ts (modified - updated tool counts)
