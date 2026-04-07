# Story 5.4: Production Monitoring Tools

Status: done

## Story

As an integration engineer,
I want to query production logs, check queue status, trace messages, and list adapters,
so that I can troubleshoot production issues through my AI assistant.

## Acceptance Criteria

1. **AC1**: `iris.production.logs` returns event log entries filtered by type, item name, and count (FR70).
2. **AC2**: Log entries include timestamp, type (Info/Warning/Error), item name, and message text.
3. **AC3**: `iris.production.queues` returns queue status for all production items including queue count (FR71).
4. **AC4**: `iris.production.messages` traces message flow by session ID or header ID (FR72).
5. **AC5**: Each message step includes source item, target item, message class, timestamp, and status.
6. **AC6**: `iris.production.adapters` returns available adapter types grouped by category (FR73).
7. **AC7**: All four tools annotated as `readOnlyHint: true`.
8. **AC8**: All tools have scope NS.
9. **AC9**: New routes added to Dispatch UrlMap and Interop.cls compiles.
10. **AC10**: Unit tests verify parameter validation, response parsing, and error handling.
11. **AC11**: `turbo build` succeeds and all tests pass.

## Tasks / Subtasks

- [x] Task 1: Add ObjectScript methods to Interop.cls (AC: 1-6, 9)
  - [x] Implement `EventLog()` class method — query Ens.Util.Log via SQL with filters
  - [x] Implement `QueueStatus()` class method — query Ens.Queue via SQL or API
  - [x] Implement `MessageTrace()` class method — query Ens.MessageHeader by session/header ID
  - [x] Implement `AdapterList()` class method — list adapter classes by category
  - [x] Add GET routes to Dispatch.cls:
    - `GET /interop/production/logs` → `ExecuteMCPv2.REST.Interop:EventLog`
    - `GET /interop/production/queues` → `ExecuteMCPv2.REST.Interop:QueueStatus`
    - `GET /interop/production/messages` → `ExecuteMCPv2.REST.Interop:MessageTrace`
    - `GET /interop/production/adapters` → `ExecuteMCPv2.REST.Interop:AdapterList`

- [x] Task 2: Create TypeScript monitoring tools (AC: 1-8)
  - [x] Create `packages/iris-interop-mcp/src/tools/monitor.ts`
  - [x] Implement `productionLogsTool` — readOnlyHint: true, scope: NS
  - [x] Implement `productionQueuesTool` — readOnlyHint: true, scope: NS
  - [x] Implement `productionMessagesTool` — readOnlyHint: true, scope: NS
  - [x] Implement `productionAdaptersTool` — readOnlyHint: true, scope: NS
  - [x] Update `src/tools/index.ts` to export all monitoring tools

- [x] Task 3: Create unit tests (AC: 10)
  - [x] Create `packages/iris-interop-mcp/src/__tests__/monitor.test.ts`
  - [x] Test each tool's parameter validation and response parsing
  - [x] Test error handling

- [x] Task 4: Final validation (AC: 11)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass

## Dev Notes

### ObjectScript IRIS API Reference

**Event Log (FR70) — `Ens.Util.Log`:**
- SQL: `SELECT TimeLogged, Type, ConfigName, Text, SourceClass, SourceMethod, SessionId FROM Ens_Util.Log WHERE ... ORDER BY TimeLogged DESC`
- Type column values: "Info" (1), "Warning" (2), "Error" (3), "Trace" (4), "Assert" (5), "Alert" (6)
- Filter by: Type (column), ConfigName (item name), TOP n for count limit
- Example: `SELECT TOP 100 * FROM Ens_Util.Log WHERE Type = 'Error' AND ConfigName = 'MyService' ORDER BY ID DESC`

**Queue Status (FR71) — `Ens.Queue`:**
- SQL: `SELECT Name, Count FROM Ens.Queue` or use `##class(Ens.Queue).GetCount(pQueueName)`
- Alternative: `SELECT Name, Count(*) as QueueCount FROM Ens_Enterprise_MsgBank.MessageHeader WHERE ... GROUP BY TargetConfigName`
- For running production items, query `Ens_Config.Item` joined with queue counts

**Message Trace (FR72) — `Ens.MessageHeader`:**
- SQL: `SELECT ID, MessageBodyClassName, MessageBodyId, SourceConfigName, TargetConfigName, TimeCreated, TimeProcessed, Status, SessionId, CorrespondingMessageId FROM Ens.MessageHeader WHERE SessionId = ? ORDER BY TimeCreated`
- For header ID lookup: `WHERE ID = ?`
- Status values: "Completed", "Error", "Discarded", etc.
- Join with `Ens.MessageBody` for content if needed (but avoid for large messages)

**Adapter List (FR73):**
- SQL: `SELECT Name, Description FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH 'EnsLib.' AND Abstract = 0`
- Category detection: Check class hierarchy:
  - Inbound: subclasses of `Ens.InboundAdapter`
  - Outbound: subclasses of `Ens.OutboundAdapter`
  - Process: subclasses of `Ens.BusinessProcess` (not an adapter, but may be relevant)
- Alternative: Use `$ClassMethod(className, "%GetParameter", "ADAPTER")` or check `$$$defClassKeyGet`
- Simpler approach: Query class definitions that extend adapter base classes

**CRITICAL: All monitoring tools are read-only (GET endpoints).**
- Use query parameters (not JSON body) for GET requests
- Namespace via `?namespace=X` query parameter
- Follow the pattern from ProductionStatus/ProductionSummary GET endpoints in Interop.cls

### TypeScript Tool Pattern

All tools are GET-based (readOnly). Follow `productionStatusTool` pattern:
```typescript
handler: async (args, ctx) => {
  const ns = ctx.resolveNamespace(args.namespace);
  const params = new URLSearchParams();
  if (ns) params.set("namespace", ns);
  // Add tool-specific params...
  const url = `${BASE_URL}/interop/production/logs?${params}`;
  const response = await ctx.http.get(url);
  return { content: [{ type: "text", text: JSON.stringify(response.result, null, 2) }] };
},
```

### File Locations

| What | Path |
|------|------|
| Interop handler (extend) | `src/ExecuteMCPv2/REST/Interop.cls` |
| Dispatch (add routes) | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| New monitoring tools | `packages/iris-interop-mcp/src/tools/monitor.ts` |
| Tools index (update) | `packages/iris-interop-mcp/src/tools/index.ts` |
| New unit tests | `packages/iris-interop-mcp/src/__tests__/monitor.test.ts` |
| Reference: production.ts | `packages/iris-interop-mcp/src/tools/production.ts` |

### Previous Story Intelligence (Story 5.3)

- Interop.cls now has 6 methods (ProductionManage, ProductionControl, ProductionStatus, ProductionSummary, ItemManage, AutoStart)
- Dispatch has 6 interop routes under `/interop/production/*`
- GET endpoints use query params; POST endpoints use JSON body
- Auto-start reads `^Ens.AutoStart` global (no GetAutoStart class method)
- SQL queries need explicit error checking (`tRS.%SQLCODE < 0`)
- 67 interop tests passing

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.4]
- [Source: src/ExecuteMCPv2/REST/Interop.cls]
- [Source: packages/iris-interop-mcp/src/tools/production.ts]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None needed — all code compiled and tests passed on first attempt.

### Completion Notes List

- Implemented 4 ObjectScript class methods in Interop.cls: EventLog, QueueStatus, MessageTrace, AdapterList
- All methods follow the existing GET endpoint pattern (query params, namespace switching, safe restore)
- EventLog queries Ens_Util.Log with dynamic WHERE clause for type/itemName filters and configurable count (max 10000)
- QueueStatus queries Ens.Queue for name/count of all queues
- MessageTrace queries Ens.MessageHeader by sessionId or headerId, requires at least one parameter
- AdapterList queries %Dictionary.ClassDefinition for non-abstract classes extending Ens.InboundAdapter/Ens.OutboundAdapter, grouping by category
- Added 4 GET routes to Dispatch.cls under /interop/production/{logs,queues,messages,adapters}
- Created monitor.ts with 4 TypeScript tool definitions, all with readOnlyHint: true and scope: NS
- Updated tools/index.ts to export all 10 tools (6 existing + 4 new)
- Created 30 new unit tests in monitor.test.ts covering parameter passing, namespace resolution, error handling, annotations, scope
- Updated index.test.ts to reflect new tool count (6 -> 10) and added assertions for new tool names
- All 97 interop tests pass, 672 total tests across all packages with zero regressions
- turbo build succeeds across all 7 packages

### Change Log

- 2026-04-06: Implemented Story 5.4 — 4 production monitoring tools (logs, queues, messages, adapters)

### File List

- src/ExecuteMCPv2/REST/Interop.cls (modified — added EventLog, QueueStatus, MessageTrace, AdapterList methods)
- src/ExecuteMCPv2/REST/Dispatch.cls (modified — added 4 GET routes)
- packages/iris-interop-mcp/src/tools/monitor.ts (new — 4 monitoring tool definitions)
- packages/iris-interop-mcp/src/tools/index.ts (modified — export monitoring tools)
- packages/iris-interop-mcp/src/__tests__/monitor.test.ts (new — 30 unit tests)
- packages/iris-interop-mcp/src/__tests__/index.test.ts (modified — updated tool counts from 6 to 10)
