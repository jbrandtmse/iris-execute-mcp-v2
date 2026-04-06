# Story 3.6: Auto-Bootstrap Flow

Status: done

## Story

As a developer,
I want the MCP server to automatically deploy its IRIS-side components when they're missing,
So that I can start using the server with zero manual IRIS configuration.

## Acceptance Criteria

1. **Given** a fresh IRIS instance with no ExecuteMCPv2 classes installed
   **When** any MCP server that requires the custom REST service starts up
   **Then** the bootstrap flow detects the REST service is missing via a probe request to /api/executemcp/v2/ (FR8)
   **And** ObjectScript classes are deployed to IRIS via the Atelier API PUT /doc endpoint (FR9)
   **And** deployed classes are compiled via the Atelier API POST /action/compile (FR10)
   **And** the Setup.Configure() class method is called to register the /api/executemcp web application (FR11)

2. **Given** a user with %Admin_Manage privileges
   **When** the full bootstrap flow runs
   **Then** all steps complete successfully (deploy, compile, configure web app)
   **And** the entire flow completes within 60 seconds (NFR4)

3. **Given** a user with only %Development privileges (no %Admin_Manage)
   **When** the bootstrap runs
   **Then** class deployment and compilation succeed
   **And** web application registration fails
   **And** the server reports which steps succeeded and which failed (FR12)
   **And** explicit manual instructions are provided (FR13)
   **And** IPM installation is suggested as an alternative (FR14)

4. **Given** a subsequent server connection after successful bootstrap
   **When** the bootstrap check runs
   **Then** completed steps are detected and skipped (FR15)
   **And** the bootstrap is idempotent (NFR19)

5. **And** bootstrap state tracking is implemented in shared/bootstrap.ts
   **And** bootstrap runs only at server startup or reconnection, never during tool execution

## Tasks / Subtasks

- [ ] Task 1: Create shared/bootstrap.ts (AC: #1-5)
  - [ ] 1.1: Create `packages/shared/src/bootstrap.ts` with:
    - `probeCustomRest(http)` — HEAD or GET to /api/executemcp/v2/ to check if REST service exists
    - `deployClasses(http, config)` — read .cls files from embedded content or disk, PUT each via Atelier API
    - `compileClasses(http, config, version)` — POST /action/compile for all deployed classes
    - `configureWebApp(http, config, version)` — call Setup.Configure() via Atelier action/classmethod endpoint
    - `bootstrap(http, config, version)` — orchestrate: probe → deploy → compile → configure, with step-level success/failure tracking
  - [ ] 1.2: Define BootstrapResult type: { probeFound, deployed, compiled, configured, errors[], manualInstructions? }
  - [ ] 1.3: Add manual instruction text for FR13 (Terminal command, SMP path, IPM alternative)
  - [ ] 1.4: Export from shared/index.ts

- [ ] Task 2: Integrate bootstrap into McpServerBase.start() (AC: #5)
  - [ ] 2.1: After health check + version negotiation, call bootstrap() if probeCustomRest returns false
  - [ ] 2.2: Log bootstrap results (which steps succeeded/failed)
  - [ ] 2.3: If configure step fails, log manual instructions but DON'T exit — server can still use Atelier-only tools

- [ ] Task 3: Embed ObjectScript class content (AC: #1)
  - [ ] 3.1: Create `packages/shared/src/bootstrap-classes.ts` with class content as string constants or a map
  - [ ] 3.2: Include all 6 production classes (Utils, Setup, Dispatch, Command, UnitTest, Global) — NOT test classes
  - [ ] 3.3: Read class content from src/ExecuteMCPv2/ files at build time or embed as template literals

- [ ] Task 4: Unit tests (AC: #1-4)
  - [ ] 4.1: Create `packages/shared/src/__tests__/bootstrap.test.ts`
  - [ ] 4.2: Test probe detection (found vs not found)
  - [ ] 4.3: Test deploy step (mock PUT calls)
  - [ ] 4.4: Test compile step (mock compile call)
  - [ ] 4.5: Test configure step (mock classmethod call, success and failure)
  - [ ] 4.6: Test full orchestration (all pass, configure fails with instructions)
  - [ ] 4.7: Test idempotent skip (probe returns found)
  - [ ] 4.8: Run `pnpm test`

## Dev Notes

### Probe Detection (FR8)

Check if the custom REST service is available:
```typescript
async function probeCustomRest(http: IrisHttpClient): Promise<boolean> {
  try {
    // Try to hit the custom REST endpoint
    await http.get('/api/executemcp/v2/global/list');
    return true;
  } catch {
    // 404 or connection error means not installed
    return false;
  }
}
```

Alternative: Try a HEAD request to `/api/executemcp/v2/` — if it returns 404 or CSP error, the web app isn't registered.

### Class Deployment (FR9)

Use existing Atelier PUT /doc endpoint (same as iris.doc.put tool):
```typescript
for (const [name, content] of classMap.entries()) {
  const path = atelierPath(version, namespace, `doc/${name}`);
  await http.put(path, {
    enc: false,
    content: content.split('\n'),
  });
}
```

**Class list to deploy** (production only, no tests):
1. ExecuteMCPv2.Utils.cls
2. ExecuteMCPv2.Setup.cls
3. ExecuteMCPv2.REST.Dispatch.cls
4. ExecuteMCPv2.REST.Command.cls
5. ExecuteMCPv2.REST.UnitTest.cls
6. ExecuteMCPv2.REST.Global.cls

### Compilation (FR10)

```typescript
const docNames = [...classMap.keys()];
const path = atelierPath(version, namespace, 'action/compile');
await http.post(path, docNames);
```

### Web App Registration (FR11)

Call Setup.Configure() via the Atelier classmethod endpoint:
```typescript
const path = atelierPath(version, '%SYS', 'action/classmethod');
// Or use the custom REST's classmethod endpoint if already available
```

**Note:** The Atelier API doesn't have a direct "call classmethod" endpoint. Options:
1. Use `action/query` to execute SQL: `SELECT ExecuteMCPv2.Setup_Configure()` (if available as SQL proc)
2. Use the Execute command approach via Atelier (if available)
3. Actually — after compilation succeeds, the classes exist. We can call Setup.Configure via the Atelier action endpoint or just tell the user to do it manually if the custom REST isn't yet available.

**Recommended approach:** After deploying and compiling, try calling Configure via a simple probe:
- Execute `Do ##class(ExecuteMCPv2.Setup).Configure()` using the newly compiled code
- This requires either the Atelier `action/execute` endpoint or the v1 execute tool pattern
- If it fails (insufficient privileges), provide manual instructions

### Manual Instructions (FR13)

```typescript
const manualInstructions = `
The ExecuteMCPv2 classes have been deployed and compiled, but web application
registration requires %Admin_Manage privileges.

To complete setup manually, choose one of:

1. Terminal: Open an IRIS Terminal in %SYS namespace and run:
   Do ##class(ExecuteMCPv2.Setup).Configure("USER")

2. Management Portal: Navigate to System Administration > Security > Applications > Web Applications
   Create application "/api/executemcp" with DispatchClass "ExecuteMCPv2.REST.Dispatch"

3. IPM: If IPM is installed, run in any namespace:
   zpm "install iris-execute-mcp-v2"
`;
```

### Bootstrap in server-base.ts start()

Insert between step 4 (version negotiation) and step 5 (connect transport):

```typescript
// 4.5. Bootstrap custom REST service if needed
try {
  const result = await bootstrap(this.http, this.config, this.atelierVersion);
  if (result.manualInstructions) {
    logger.warn(result.manualInstructions);
  }
} catch (error) {
  logger.warn(`Bootstrap failed: ${error}. Custom REST tools may not work.`);
}
```

### Embedded Class Content

**Option A (recommended):** Read .cls files from disk at bootstrap time using `fs.readFileSync()`. The files are in `src/ExecuteMCPv2/` relative to the package root. This avoids large string constants and stays in sync.

**Option B:** Embed as string literals in bootstrap-classes.ts. Simpler but content gets stale if classes are updated.

**Decision:** Use Option A with a fallback — read from disk if available (development), embed content as fallback (production/npm install). For MVP, just read from disk since this runs locally.

### Previous Story Intelligence (Story 3.5)

- Setup.cls has Configure(), Uninstall(), IsConfigured() — all verified working on IRIS
- Web app /api/executemcp registered with DispatchClass=ExecuteMCPv2.REST.Dispatch
- server-base.ts start() has clear numbered steps where bootstrap slots in (after step 4)
- Current totals: 291 TypeScript tests + 57 IRIS unit tests

### Project Structure Notes

```
packages/shared/src/
  bootstrap.ts          (new — bootstrap orchestration)
  bootstrap-classes.ts  (new — embedded class content or file reader)
  server-base.ts        (modified — call bootstrap in start())
  index.ts              (modified — export bootstrap types)
packages/shared/src/__tests__/
  bootstrap.test.ts     (new — unit tests)
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 3.6 acceptance criteria]
- [Source: packages/shared/src/server-base.ts#L362-L400 — start() method where bootstrap hooks in]
- [Source: src/ExecuteMCPv2/Setup.cls — Configure() method called by bootstrap]
- [Source: packages/iris-dev-mcp/src/tools/doc.ts — PUT /doc pattern for class deployment]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
