# Story 8.3: Migration Guide (v1 to v2)

Status: done

## Story

As an existing v1 user,
I want a migration guide showing how to move from iris-execute-mcp and mcp-server-iris to v2,
so that I can upgrade without losing functionality.

## Acceptance Criteria

1. **AC1**: A complete tool mapping table shows every v1 tool and its v2 equivalent.
2. **AC2**: Breaking changes are clearly listed: connection change (SuperServer port 1972 to web port 52773), Python to Node.js, tool name changes.
3. **AC3**: Configuration migration steps show how to update MCP client config from v1 to v2.
4. **AC4**: A note about the namespace parameter behavior being preserved.
5. **AC5**: Guidance on uninstalling v1 packages.

## Tasks / Subtasks

- [x] Task 1: Create migration guide document (AC: 1-5)
  - [x] Create `docs/migration-v1-v2.md`
  - [x] Introduction section explaining why v2 exists and what changed
  - [x] Breaking changes section (connection, language, env vars, tool names)
  - [x] Tool mapping table: v1 iris-execute-mcp (8 tools) -> v2 equivalents
  - [x] Tool mapping table: v1 mcp-server-iris (CaretDev) -> v2 equivalents
  - [x] Configuration migration: v1 MCP config JSON -> v2 MCP config JSON (side-by-side)
  - [x] Environment variable mapping (IRIS_HOSTNAME -> IRIS_HOST, IRIS_PORT meaning change: 1972 SuperServer -> 52773 web port)
  - [x] Namespace behavior note (preserved in v2 via `namespace` parameter on all tools)
  - [x] Uninstall guidance for v1 packages
  - [x] FAQ section for common migration questions

## Dev Notes

### v1 iris-execute-mcp Tool Inventory (8 tools)

| v1 Tool | Description |
|---------|-------------|
| execute_command | Direct ObjectScript execution with I/O capture |
| execute_classmethod | Dynamic class method invocation |
| get_global | Global retrieval with complex subscripts |
| set_global | Global setting with verification |
| get_system_info | IRIS system information |
| compile_objectscript_class | Compile one or more classes |
| compile_objectscript_package | Compile package recursively |
| execute_unit_tests | DirectTestRunner for unit tests |

### v1 mcp-server-iris (CaretDev) Tool Inventory

This is a separate project by CaretDev. Refer to its README for tool list. Key point: it also uses SuperServer port 1972 and Python.

### Key Breaking Changes

1. **Connection**: SuperServer port 1972 (native IRIS protocol) -> Web port 52773 (HTTP/HTTPS via Atelier REST API)
2. **Language**: Python (FastMCP) -> Node.js/TypeScript
3. **Environment Variables**:
   - `IRIS_HOSTNAME` -> `IRIS_HOST`
   - `IRIS_PORT` meaning changes: was 1972 (SuperServer), now 52773 (web port)
   - `IRIS_NAMESPACE` -> `IRIS_NAMESPACE` (unchanged)
   - `IRIS_USERNAME` -> `IRIS_USERNAME` (unchanged)
   - `IRIS_PASSWORD` -> `IRIS_PASSWORD` (unchanged)
   - New: `IRIS_HTTPS` (default: false)
4. **Tool names**: `execute_command` -> `iris.execute.command`, `get_global` -> `iris.global.get`, etc.
5. **Architecture**: Single 8-tool server -> 5 specialized servers with 85 tools total
6. **Installation**: `pip install` / venv -> `npm install -g @iris-mcp/<name>`
7. **IRIS classes**: `ExecuteMCP.*` -> `ExecuteMCPv2.*` (auto-bootstrapped, no manual install needed)

### v1 -> v2 Tool Mapping

| v1 Tool | v2 Tool | v2 Package |
|---------|---------|------------|
| execute_command | iris.execute.command | @iris-mcp/dev |
| execute_classmethod | iris.execute.classmethod | @iris-mcp/dev |
| get_global | iris.global.get | @iris-mcp/dev |
| set_global | iris.global.set | @iris-mcp/dev |
| get_system_info | iris.server.info | @iris-mcp/dev |
| compile_objectscript_class | iris.doc.compile | @iris-mcp/dev |
| compile_objectscript_package | iris.doc.compile | @iris-mcp/dev (same tool, pass package name) |
| execute_unit_tests | iris.execute.tests | @iris-mcp/dev |

### v1 Config (iris-execute-mcp)

```json
{
  "iris-execute-mcp": {
    "type": "stdio",
    "command": "C:/iris-execute-mcp/venv/Scripts/python.exe",
    "args": ["C:/iris-execute-mcp/iris_execute_mcp.py"],
    "env": {
      "IRIS_HOSTNAME": "localhost",
      "IRIS_PORT": "1972",
      "IRIS_NAMESPACE": "HSCUSTOM",
      "IRIS_USERNAME": "_SYSTEM",
      "IRIS_PASSWORD": "SYS"
    }
  }
}
```

### v2 Config (iris-dev-mcp)

```json
{
  "iris-dev-mcp": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@iris-mcp/dev"],
    "env": {
      "IRIS_HOST": "localhost",
      "IRIS_PORT": "52773",
      "IRIS_NAMESPACE": "HSCUSTOM",
      "IRIS_USERNAME": "_SYSTEM",
      "IRIS_PASSWORD": "SYS",
      "IRIS_HTTPS": "false"
    }
  }
}
```

### Source Files

| What | Path |
|------|------|
| Migration guide (create) | `docs/migration-v1-v2.md` |
| v1 iris-execute-mcp README | `sources/iris-execute-mcp/README.md` |
| v1 mcp-server-iris README | `sources/mcp-server-iris/README.md` |

### Critical Rules

- Verify tool name mappings by reading `packages/iris-dev-mcp/src/tools/*.ts` for exact `name` fields
- The migration guide should help users of EITHER v1 project migrate
- Don't deprecate v1 — just show the upgrade path
- Emphasize that v2 auto-bootstraps IRIS classes (no manual import/compile needed)
- The `docs/` directory may need to be created

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.3]
- [Source: sources/iris-execute-mcp/README.md — v1 tool list and config]
- [Source: sources/mcp-server-iris/README.md — CaretDev v1 config]
- [Source: packages/iris-dev-mcp/src/tools/*.ts — v2 tool names]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required -- documentation-only story.

### Completion Notes List

- Created `docs/migration-v1-v2.md` with complete migration guide covering all 5 ACs
- Verified all 8 v1 tool names against v1 README and all v2 tool names against actual source code (`packages/*/src/tools/*.ts`)
- Included both v1 projects (iris-execute-mcp and mcp-server-iris/CaretDev) with their actual config formats from source READMEs
- Provided side-by-side config examples for v1 (both projects) and v2 (single server and all-five-servers variants)
- Breaking changes table, env var mapping, namespace behavior note, uninstall steps, and FAQ all included

### Change Log

- 2026-04-07: Created migration guide document (docs/migration-v1-v2.md) covering all acceptance criteria

### File List

- docs/migration-v1-v2.md (created)
