# Story 8.2: Per-Package READMEs & Tool References

Status: done

## Story

As a user of a specific MCP server,
I want detailed documentation for that server including every tool with parameters and examples,
so that I can understand and configure the tools available to me.

## Acceptance Criteria

1. **AC1**: Each of the 5 server packages (dev, admin, interop, ops, data) has a README.md with installation instructions (`npm install -g @iris-mcp/<name>`).
2. **AC2**: Each README includes environment variable configuration (IRIS_HOST, IRIS_PORT, IRIS_USERNAME, IRIS_PASSWORD, IRIS_NAMESPACE, IRIS_HTTPS).
3. **AC3**: Each README includes a complete tool reference table listing every tool with: name, description, key parameters, and annotations.
4. **AC4**: At least one JSON example per tool showing input and expected output.
5. **AC5**: Each README includes MCP client configuration snippets for Claude Desktop, Claude Code, and Cursor.
6. **AC6**: Each README includes information about namespace scoping (which tools accept namespace parameter).
7. **AC7**: Each README includes error handling guidance (common errors and how to resolve them).
8. **AC8**: The @iris-mcp/shared package README documents the public API (IrisHttpClient, config types, error classes, McpServerBase) and is clearly marked as an internal dependency.

## Tasks / Subtasks

- [x] Task 1: Create iris-dev-mcp README (AC: 1-7)
  - [x] Install + env vars + MCP client config snippets
  - [x] Tool reference table for all 21 tools with descriptions, parameters, annotations
  - [x] JSON input/output examples for each tool
  - [x] Namespace scoping section
  - [x] Error handling guidance

- [x] Task 2: Create iris-admin-mcp README (AC: 1-7)
  - [x] Install + env vars + MCP client config snippets
  - [x] Tool reference table for all 22 tools
  - [x] JSON examples per tool
  - [x] Namespace scoping + security note (many tools require %SYS)
  - [x] Error handling guidance

- [x] Task 3: Create iris-interop-mcp README (AC: 1-7)
  - [x] Install + env vars + MCP client config snippets
  - [x] Tool reference table for all 19 tools
  - [x] JSON examples per tool
  - [x] Namespace scoping + production context
  - [x] Error handling guidance

- [x] Task 4: Create iris-ops-mcp README (AC: 1-7)
  - [x] Install + env vars + MCP client config snippets
  - [x] Tool reference table for all 16 tools
  - [x] JSON examples per tool
  - [x] Namespace scoping section
  - [x] Error handling guidance

- [x] Task 5: Create iris-data-mcp README (AC: 1-7)
  - [x] Install + env vars + MCP client config snippets
  - [x] Tool reference table for all 7 tools
  - [x] JSON examples per tool
  - [x] Namespace scoping + DocDB service requirement note
  - [x] Error handling guidance

- [x] Task 6: Create shared package README (AC: 8)
  - [x] Mark as internal dependency (not for direct installation)
  - [x] Document public API: IrisHttpClient, IrisConnectionConfig, McpServerBase, ToolDefinition, error classes
  - [x] Brief architecture note about how server packages depend on shared

## Dev Notes

### Tool Inventories

**iris-dev-mcp (21 tools):**
docGetTool, docPutTool, docDeleteTool, docListTool, docCompileTool, docIndexTool, docSearchTool, macroInfoTool, docConvertTool, docXmlExportTool, sqlExecuteTool, serverInfoTool, serverNamespaceTool, globalGetTool, globalSetTool, globalKillTool, globalListTool, executeCommandTool, executeClassMethodTool, executeTestsTool, docLoadTool

**iris-admin-mcp (22 tools):**
namespaceManageTool, namespaceListTool, databaseManageTool, databaseListTool, mappingManageTool, mappingListTool, userManageTool, userGetTool, userRolesTool, userPasswordTool, roleManageTool, roleListTool, resourceManageTool, resourceListTool, permissionCheckTool, webappManageTool, webappGetTool, webappListTool, sslManageTool, sslListTool, oauthManageTool, oauthListTool

**iris-interop-mcp (19 tools):**
productionManageTool, productionControlTool, productionStatusTool, productionSummaryTool, productionItemTool, productionAutostartTool, productionLogsTool, productionQueuesTool, productionMessagesTool, productionAdaptersTool, credentialManageTool, credentialListTool, lookupManageTool, lookupTransferTool, ruleListTool, ruleGetTool, transformListTool, transformTestTool, interopRestTool

**iris-ops-mcp (16 tools):**
metricsSystemTool, metricsAlertsTool, metricsInteropTool, jobsListTool, locksListTool, journalInfoTool, mirrorStatusTool, auditEventsTool, databaseCheckTool, licenseInfoTool, ecpStatusTool, taskManageTool, taskListTool, taskRunTool, taskHistoryTool, configManageTool

**iris-data-mcp (7 tools):**
docdbManageTool, docdbDocumentTool, docdbFindTool, docdbPropertyTool, analyticsMdxTool, analyticsCubesTool, restManageTool

### Where to Find Tool Details

Each tool's name, description, inputSchema (Zod), annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint), and handler are defined in the tool source files:
- `packages/iris-dev-mcp/src/tools/*.ts`
- `packages/iris-admin-mcp/src/tools/*.ts`
- `packages/iris-interop-mcp/src/tools/*.ts`
- `packages/iris-ops-mcp/src/tools/*.ts`
- `packages/iris-data-mcp/src/tools/*.ts`

Read these files to extract accurate tool names (the `name` field in each tool definition), descriptions, parameter schemas, and annotation values. The MCP tool name format is `iris.<domain>.<action>` (e.g., `iris.doc.get`, `iris.namespace.manage`).

### Shared Package Public API

From `packages/shared/src/index.ts`:
- IrisHttpClient, IrisConnectionConfig
- McpServerBase, ToolDefinition, ToolContext, ToolResult, ToolAnnotations
- IrisConnectionError, IrisApiError, McpProtocolError
- config/logger utilities
- getBootstrapClasses (for auto-deployment)

### README Structure Template (per package)

Each README should follow this structure:
1. Package name + one-line description
2. Installation (`npm install -g @iris-mcp/<name>`)
3. Configuration (env vars table)
4. MCP Client Configuration (Claude Desktop JSON, Claude Code, Cursor)
5. Tool Reference (table: Name | Description | Key Parameters | Annotations)
6. Tool Examples (collapsible sections with JSON input/output)
7. Namespace Scoping
8. Error Handling
9. Link back to root README

### Critical Rules

- Read each tool definition file to get ACCURATE names, descriptions, and parameters — do NOT guess
- Tool names in IRIS MCP follow `iris.<domain>.<action>` pattern — use the exact `name` field from each tool definition
- JSON examples should be realistic but not require a specific IRIS state
- For manage tools with multiple actions, show at least one action example
- Note which tools require %SYS namespace (admin security tools)
- Note DocDB tools require `%Service_DocDB` to be enabled
- Keep READMEs consistent in structure across all 5 packages
- MCP client config snippets should match the format used in the root README (Story 8.1)

### Source Files to Create

| What | Path |
|------|------|
| Dev README | `packages/iris-dev-mcp/README.md` |
| Admin README | `packages/iris-admin-mcp/README.md` |
| Interop README | `packages/iris-interop-mcp/README.md` |
| Ops README | `packages/iris-ops-mcp/README.md` |
| Data README | `packages/iris-data-mcp/README.md` |
| Shared README | `packages/shared/README.md` |

### Previous Story Intelligence (Story 8.1)

- Root README.md created with links to `packages/iris-dev-mcp/README.md` etc. — these files must be created at those exact paths
- MCP client config format established in root README — follow the same JSON format
- Architecture diagram in root README shows connection flow — READMEs should reference it

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.2]
- [Source: packages/*/src/tools/*.ts — tool definitions]
- [Source: packages/shared/src/index.ts — public API]
- [Source: README.md — root README for cross-reference]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required -- documentation-only story.

### Completion Notes List

- Created 6 README.md files, one per package, all following consistent structure
- Each server README includes: installation, env vars, MCP client config (Claude Code, Claude Desktop, Cursor), complete tool reference table, JSON examples for every tool, namespace scoping section, error handling guidance
- Tool names, descriptions, parameters, and annotations extracted directly from source tool definition files (not guessed)
- Admin README includes security note about %SYS namespace requirement for most tools
- Interop README notes production context and Ensemble namespace requirement
- Data README notes %Service_DocDB prerequisite for DocDB tools
- Shared README clearly marked as internal dependency with full public API documentation
- All READMEs link back to root README

### File List

- packages/iris-dev-mcp/README.md (new)
- packages/iris-admin-mcp/README.md (new)
- packages/iris-interop-mcp/README.md (new)
- packages/iris-ops-mcp/README.md (new)
- packages/iris-data-mcp/README.md (new)
- packages/shared/README.md (new)

### Review Findings

- [x] [Review][Patch] Shared README missing exported types (PaginateResult, RequestOptions, AtelierEnvelope, HeadResponse, Logger) from Public API documentation [packages/shared/README.md] -- FIXED: Added all 5 missing type descriptions to the shared README.

### Change Log

- 2026-04-07: Created all 6 per-package README files with comprehensive tool references and examples
- 2026-04-07: Code review -- fixed shared README missing exported type documentation
