# Story 3.9: Bulk Document Load from Disk

**Status:** done

## Summary

Added `iris.doc.load` tool that uploads multiple ObjectScript files from a local directory into IRIS via the Atelier PUT /doc endpoint, with optional compilation.

## Acceptance Criteria

- [x] Given a directory path with glob pattern, all matching files are uploaded via Atelier PUT /doc
- [x] If compile: true, all uploaded docs are compiled via Atelier POST /action/compile
- [x] Compilation flags parameter supported
- [x] Continue-on-error: if a file fails upload, remaining files continue; all failures reported at end
- [x] ignoreConflict parameter (default true) overwrites server versions
- [x] Filesystem paths mapped to IRIS document names (MyPackage/MyClass.cls -> MyPackage.MyClass.cls)
- [x] Response includes: total found, uploaded, failed, and compilation results if requested

## Implementation Details

### Files Created
- `packages/iris-dev-mcp/src/tools/load.ts` - New `iris.doc.load` tool with `filePathToDocName` and `extractBaseDir` helper functions
- `packages/iris-dev-mcp/src/__tests__/load.test.ts` - 24 unit tests covering all acceptance criteria

### Files Modified
- `packages/iris-dev-mcp/src/tools/index.ts` - Registered docLoadTool (tool count 20 -> 21)
- `packages/iris-dev-mcp/src/__tests__/index.test.ts` - Updated tool count assertions to 21

### Key Decisions
- Used Node.js built-in `fs.globSync` (available in Node 22+) instead of adding a dependency
- Exported `filePathToDocName` and `extractBaseDir` helpers for direct unit testing
- ignoreConflict defaults to `true` (consistent with typical bulk load behavior)
- Compilation errors from the compile step are captured but do not mark the overall result as isError (consistent with docCompileTool pattern)
- When all uploads fail and compile=true, the compile step is skipped

### Tool Schema
- **name:** `iris.doc.load`
- **scope:** NS
- **annotations:** readOnlyHint: false, destructiveHint: false, idempotentHint: true
- **inputSchema:** path (string, required), compile (boolean, optional), flags (string, optional), namespace (string, optional), ignoreConflict (boolean, optional)
