# Sprint Change Proposal — 2026-04-06

**Project:** iris-execute-mcp-v2
**Requested by:** Developer
**Date:** 2026-04-06
**Change Scope:** Minor — Direct Adjustment

---

## 1. Issue Summary

Two gaps were identified during analysis of the iris-dev-mcp server's runtime behavior while Epic 3 is in-progress:

1. **Premature HTTP timeout** — The `IrisHttpClient` hardcodes a 30-second default timeout, which is shorter than both the CSP Gateway (60s) and Claude Code's MCP SDK timeout (60s). Long-running operations like package compilation and full unit test suite execution can be aborted prematurely by our own client before IRIS finishes processing.

2. **No bulk file loading capability** — There is no tool to upload multiple ObjectScript files from a local directory to IRIS in a single tool call. Developers must make individual `iris.doc.put` calls for each file, which is inefficient for project setup and large deployments.

**Discovery context:** Surfaced during a technical analysis session reviewing the timeout chain (Claude Code → our HTTP client → CSP Gateway → IRIS) and tool capability gaps.

**Evidence:**
- `IrisHttpClient` constructor at `packages/shared/src/http-client.ts:52`: `defaultTimeout = 30_000` hardcoded
- No `IRIS_TIMEOUT` env var in `packages/shared/src/config.ts`
- CSP Gateway default is 60s (`%CSP.Request.GatewayTimeout`, InitialExpression = 60)
- MCP SDK enforces 60s client-side timeout
- No file-loading tool exists in the current 20-tool iris-dev-mcp set

---

## 2. Impact Analysis

### Epic Impact
- **Epic 3 (in-progress):** Two new stories appended (3.8 and 3.9). No existing stories modified.
- **Epics 4-7 (backlog):** Benefit passively from the timeout fix — all servers share the same HTTP client.
- **Epic 8 (documentation):** README.md web server timeout documentation is handled within Story 3.8, not deferred to Epic 8.

### Artifact Conflicts
- **PRD NFR14:** Currently specifies "default 30s" — update to "default 60s"
- **PRD tool count:** iris-dev-mcp specified as 20 tools — update to 21 (still under 25-tool threshold)
- **Architecture:** `IrisConnectionConfig` interface needs `timeout` field; env var list needs `IRIS_TIMEOUT`
- **Story 1.2 AC:** References "default 30s" — historical, no retroactive change needed (already implemented)

### Technical Impact
- `packages/shared/src/config.ts` — Add `timeout` to `IrisConnectionConfig`, read `IRIS_TIMEOUT` env var
- `packages/shared/src/server-base.ts` — Pass config timeout to `IrisHttpClient` constructor
- `packages/shared/src/http-client.ts` — Default changes from 30_000 to 60_000
- `.env.example` — Add `IRIS_TIMEOUT` documentation
- `README.md` — Web server gateway timeout section
- `packages/iris-dev-mcp/src/tools/compile.ts` — Extract compile result parsing to shared helper
- `packages/iris-dev-mcp/src/tools/load.ts` — New tool file
- `packages/iris-dev-mcp/src/tools/index.ts` — Register new tool

---

## 3. Recommended Approach

**Selected:** Direct Adjustment — add two new stories to Epic 3.

**Rationale:**
- Both changes are additive — no existing stories need modification or rollback
- Epic 3 is the natural home: it owns iris-dev-mcp custom tooling and shared infrastructure enhancements
- Timeout change is low-risk (default value change with env var override)
- Bulk load follows established Atelier doc/PUT patterns already proven in Story 2.2
- Neither change affects MVP scope — tool count stays within the 25-tool threshold
- Effort: Low for both stories combined
- Risk: Low — no breaking changes, backward-compatible defaults

**Alternatives considered:**
- Rollback: Not applicable — no completed work conflicts
- MVP Review: Not needed — scope unchanged

---

## 4. Detailed Change Proposals

### 4.1 PRD Updates

**NFR14:**

OLD:
> NFR14: HTTP client must handle IRIS session cookies, CSRF tokens, and connection timeouts (configurable, default 30s)

NEW:
> NFR14: HTTP client must handle IRIS session cookies, CSRF tokens, and connection timeouts (configurable via IRIS_TIMEOUT env var, default 60s)

**Rationale:** Aligns client default with CSP Gateway default; prevents premature abort.

---

**Epic 2 tool count (line 203):**

OLD:
> `@iris-mcp/dev` — Development tools (20 tools)

NEW:
> `@iris-mcp/dev` — Development tools (21 tools)

**Rationale:** Addition of `iris.doc.load` tool.

---

**Epic 2 MVP Feature Set (line 341):**

OLD:
> **Epic 2: iris-dev-mcp (20 tools)**

NEW:
> **Epic 2: iris-dev-mcp (21 tools)**

---

### 4.2 Architecture Updates

**Environment Variables section — add to the env var list:**

NEW entry:
> `IRIS_TIMEOUT` (default: `60000`) — per-server HTTP request timeout in milliseconds

---

### 4.3 Epics Updates

**New Story 3.8: Configurable HTTP Client Timeout**

```
### Story 3.8: Configurable HTTP Client Timeout

As a developer,
I want the HTTP client timeout to be configurable via an IRIS_TIMEOUT environment variable with a 60-second default,
So that long-running operations like package compilation and unit test execution don't prematurely abort.

Acceptance Criteria:

Given no IRIS_TIMEOUT environment variable is set
When the MCP server starts
Then the IrisHttpClient uses a 60,000ms default timeout (up from 30,000ms)

Given IRIS_TIMEOUT=120000 is set in the environment
When the MCP server starts
Then the IrisHttpClient uses 120,000ms as the default timeout

Given a tool handler that passes a per-request timeout via RequestOptions.timeout
When the request is made
Then the per-request timeout overrides the server-level default

Given the health check and ping functions
When they execute
Then they continue to use their own independent timeouts (5s and 2s respectively)

Given the .env.example file
When a developer reviews configuration options
Then IRIS_TIMEOUT is documented with its default value and purpose

Given the README.md
When a developer is configuring for long-running operations (large compiles, full test suites)
Then documentation explains the web server gateway timeout (Apache default ~60s, IIS equivalent) as a separate layer that may need adjustment, with specific instructions for both web servers

Technical scope:
- Update IrisConnectionConfig in config.ts to include optional timeout field
- Update loadConfig() to read IRIS_TIMEOUT from environment (default 60000)
- Update McpServerBase.start() in server-base.ts to pass config timeout to IrisHttpClient constructor
- Update .env.example with IRIS_TIMEOUT documentation
- Add web server gateway timeout section to README.md
- Update unit tests for config loading and timeout behavior
```

**New Story 3.9: Bulk Document Load from Disk (iris.doc.load)**

```
### Story 3.9: Bulk Document Load from Disk (iris.doc.load)

As a developer,
I want to load multiple ObjectScript files from a local directory into IRIS in a single tool call,
So that I can efficiently deploy entire packages or project directories without making individual iris.doc.put calls.

Acceptance Criteria:

Given a directory path with a glob pattern (e.g., "c:/projects/myapp/src/**/*.cls")
When iris.doc.load is called with the path pattern
Then all matching files are read from disk and uploaded to IRIS one by one via the Atelier doc/PUT endpoint

Given uploaded files and compile: true specified
When all uploads complete successfully
Then all uploaded documents are compiled via the Atelier action/compile endpoint
And compilation results including any errors are returned

Given compile: true and a flags parameter (e.g., "ck")
When compilation runs
Then the specified compilation flags are passed to the compile endpoint

Given a file that fails to upload
When the error occurs
Then the tool continues uploading remaining files and reports all failures at the end (continue-on-error behavior)

Given the ignoreConflict parameter is set to true (default)
When files are uploaded
Then server-side versions are overwritten without conflict checking

Given uploaded files
When document names are derived from file paths
Then the tool maps filesystem paths to IRIS document names correctly (e.g., MyPackage/MyClass.cls -> MyPackage.MyClass.cls)

Given the tool completes
When results are returned
Then the response includes: total files found, files uploaded successfully, files failed, and if compilation was requested, compilation results with any errors

Technical scope:
- New tool definition in packages/iris-dev-mcp/src/tools/ (new file, e.g., load.ts)
- Extract compile result parsing from compile.ts into a shared helper function
- Register tool in tools/index.ts
- Supported file types: .cls, .mac, .inc, .int
- Tool annotations: readOnlyHint: false, destructiveHint: false, idempotentHint: true
- Unit tests with mocked filesystem and HTTP responses
- iris-dev-mcp tool count increases from 20 to 21
```

---

## 5. Implementation Handoff

**Change scope:** Minor — Direct implementation by development team.

**Sequencing:**
1. **Story 3.8** (Timeout) can be implemented at any point — it modifies the shared package only. Recommended: implement before Story 3.7 (integration tests) so tests benefit from the new default.
2. **Story 3.9** (Bulk Load) depends on the existing Atelier doc/PUT and compile patterns. Can be implemented after Story 3.4. Should be covered in Story 3.7's integration test scope.

**Handoff recipients:**
- **Development team (Amelia):** Implement both stories following existing patterns
- **Scrum Master (Bob):** Update sprint-status.yaml with new story entries (done as part of this proposal)

**Success criteria:**
- `IRIS_TIMEOUT` env var is respected by all MCP servers
- Default timeout is 60s, not 30s
- README.md documents web server gateway timeout with Apache/IIS instructions
- `iris.doc.load` successfully uploads a directory of `.cls` files and optionally compiles them
- All existing tests continue to pass
- New unit tests cover both stories
