# Story 2.6: Document Format & XML Tools

Status: done

## Story

As a developer,
I want to convert documents between formats and import/export XML,
So that I can work with legacy XML-based workflows and convert between UDL and XML representations.

## Acceptance Criteria

1. **Given** a document in UDL format **When** `iris.doc.convert` is called with target format XML **Then** the document is converted and returned in XML format
2. **Given** a document in XML format **When** `iris.doc.convert` is called with target format UDL **Then** the document is converted and returned in UDL format
3. **Given** one or more document names **When** `iris.doc.xml_export` is called with action "export" **Then** the documents are exported to legacy XML format and the XML content is returned
4. **Given** XML content containing ObjectScript documents **When** `iris.doc.xml_export` is called with action "import" **Then** the documents are imported into IRIS from the provided XML content
5. **Given** XML content **When** `iris.doc.xml_export` is called with action "list" **Then** a list of documents contained in the XML is returned without importing them
6. **And** FR29-FR31 are handled as action parameters on `iris.doc.xml_export` — no separate tools, keeping iris-dev-mcp at exactly 20 tools per PRD
7. **And** iris.doc.xml_export with action "export"/"list" is annotated as `readOnlyHint: true`
8. **And** iris.doc.xml_export with action "import" is annotated as `destructiveHint: true`
9. **And** iris.doc.convert is annotated as `readOnlyHint: true`

## Tasks / Subtasks

- [x] Task 1: Implement iris.doc.convert tool (AC: #1, #2, #9)
  - [x] Create `packages/iris-dev-mcp/src/tools/format.ts`
  - [x] iris.doc.convert definition:
    - inputSchema: `{ name: string, targetFormat: "udl" | "xml", namespace?: string }`
    - scope: "NS", annotations: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
    - Handler: Retrieve document via `iris.doc.get` pattern then request conversion
    - Research Atelier API for format conversion — may use GET with format param or a dedicated endpoint
    - Alternative: GET `/api/atelier/v{N}/{ns}/doc/{name}` with `?format=xml` or `?format=udl` already supports this (check if Story 2.2's format param covers this)
- [x] Task 2: Implement iris.doc.xml_export tool (AC: #3, #4, #5, #6, #7, #8)
  - [x] iris.doc.xml_export definition:
    - inputSchema: `{ action: "export" | "import" | "list", docs?: string[], content?: string, namespace?: string }`
    - scope: "NS"
    - annotations vary by action:
      - export/list: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
      - import: `{ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }`
    - Since annotations are per-tool not per-action, use the most restrictive: `{ readOnlyHint: false, destructiveHint: true }`
  - [x] Export handler: Research Atelier XML export endpoint (check vscode-objectscript for `cvs_export` or XML export methods)
  - [x] Import handler: Research Atelier XML import endpoint
  - [x] List handler: Parse XML content to extract document names without importing
- [x] Task 3: Wire tools into tools/index.ts
  - [x] Import both tools and add to exported array (total: 10 tools)
- [x] Task 4: Add unit tests
  - [x] Create `packages/iris-dev-mcp/src/__tests__/format.test.ts`
  - [x] Test: iris.doc.convert to XML returns XML content
  - [x] Test: iris.doc.convert to UDL returns UDL content
  - [x] Test: iris.doc.xml_export action=export sends correct request
  - [x] Test: iris.doc.xml_export action=import sends XML content to IRIS
  - [x] Test: iris.doc.xml_export action=list parses without importing
  - [x] Test: annotations are correct for each tool
- [x] Task 5: Validate
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass
  - [x] Run `turbo lint` — no lint errors

## Dev Notes

### Atelier API for Format Conversion

The iris.doc.get tool from Story 2.2 already supports a `format` parameter. The `iris.doc.convert` tool may simply be a wrapper that:
1. Fetches the document in the target format via GET with `?format=xml` or default UDL
2. Returns the converted content

Research in `sources/vscode-objectscript/src/api/index.ts` for any dedicated conversion endpoints.

### Atelier XML Export/Import

From vscode-objectscript reference, look for:
- `cvs_export` or `xml_export` endpoints
- XML import via PUT with XML content type
- The `/action/` namespace for batch operations

If no dedicated Atelier endpoint exists for XML export/import, the tool may need to:
- Export: GET each doc in XML format, wrap in a container XML
- Import: Parse XML, PUT each document
- List: Parse XML document structure

### Key Files

| File | Action |
|------|--------|
| `packages/iris-dev-mcp/src/tools/format.ts` | Create — 2 tool definitions |
| `packages/iris-dev-mcp/src/tools/index.ts` | Modify — add format tools |
| `packages/iris-dev-mcp/src/__tests__/format.test.ts` | Create — unit tests |

### Previous Story Intelligence

- Story 2.2 iris.doc.get already has format param (udl/xml) — iris.doc.convert may reuse this
- Story 2.5 added 3 tools, total now 8 — this story adds 2 more for 10 total
- 184 tests currently passing (119 shared + 65 dev)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 2.6 lines 648-680]
- [Source: sources/vscode-objectscript/src/api/index.ts — XML export/import methods]
- [Source: packages/iris-dev-mcp/src/tools/doc.ts — format param pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None needed — all tests passed on first run.

### Completion Notes List
- iris.doc.convert implemented as a thin wrapper around the existing Atelier doc GET endpoint with `?format=` query parameter, reusing the same pattern from iris.doc.get (Story 2.2)
- iris.doc.xml_export implemented with three actions (export/import/list) mapped to Atelier v7+ endpoints:
  - export: POST to `/action/xml/export` with array of document names
  - import: POST to `/action/xml/load` with file/content payload (splits string content into lines array)
  - list: POST to `/action/xml/list` with file/content payload
- Both tools require Atelier v7+ (xml_export enforced via requireMinVersion; convert works with any version via the doc endpoint)
- Annotations set per AC: convert is readOnlyHint:true; xml_export uses most restrictive (destructiveHint:true) since import action is destructive
- 15 new tests added (5 for convert, 10 for xml_export), total dev package tests: 80
- Updated index.test.ts to expect 10 tools (was 8)
- All validation passed: turbo build, turbo test (dev+shared), turbo lint

### File List
- `packages/iris-dev-mcp/src/tools/format.ts` (created)
- `packages/iris-dev-mcp/src/tools/index.ts` (modified)
- `packages/iris-dev-mcp/src/__tests__/format.test.ts` (created)
- `packages/iris-dev-mcp/src/__tests__/index.test.ts` (modified)

### Review Findings

- [x] [Review][Patch] Missing exhaustive default branch in switch statement [format.ts:123] — FIXED: added `default` case with `never` type guard
- [x] [Review][Defer] Duplicated import/list body construction logic [format.ts:164,191] — deferred, minor duplication
- [x] [Review][Defer] Missing error propagation test for docXmlExportTool [format.test.ts] — deferred, test coverage consistency

## Change Log
- 2026-04-05: Implemented iris.doc.convert and iris.doc.xml_export tools with full test coverage (Story 2.6)
