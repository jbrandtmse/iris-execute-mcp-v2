# 00 — Shared Implementation Conventions

**Read this file completely before starting any spec in this folder.** Every spec assumes these
conventions and does not repeat them. The project's `.claude/rules/*.md` files (auto-loaded in
Claude Code sessions) are the authoritative source; this file is the condensed operational subset.
Rule numbers (e.g., "Rule #16") refer to `.claude/rules/project-rules.md`.

## 1. Repository layout

```
packages/
  shared/src/            @iris-mcp/shared — framework: server-base.ts (registration,
                         handleToolCall, governance gate), governance.ts, profiles.ts,
                         tool-types.ts, http-client.ts, bootstrap.ts, bootstrap-classes.ts
                         (GENERATED), governance-baseline.ts (FROZEN)
  iris-dev-mcp/src/      dev server: index.ts + tools/*.ts + __tests__/
  iris-admin-mcp/src/    admin server (same shape)
  iris-interop-mcp/src/  interop server (same shape)
  iris-ops-mcp/src/      ops server (same shape)
  iris-data-mcp/src/     data server (same shape)
src/ExecuteMCPv2/REST/   ObjectScript handlers: Dispatch.cls (UrlMap routes), Utils.cls,
                         Command.cls, Global.cls, Security.cls, Config.cls, Interop.cls,
                         Monitor.cls, Task.cls, SystemConfig.cls, Analytics.cls, Loc.cls,
                         UnitTest.cls
scripts/                 gen-bootstrap.mjs, gen-governance-baseline.mjs (DO NOT run bare —
                         it would regrow the frozen baseline; only `:check` mode, Rule #25)
tool_support.md          authoritative per-tool catalog (update on every new tool/action)
```

Build: `pnpm install`, `pnpm turbo run build`. Tests: `pnpm turbo run test` (vitest, mocked
HTTP — no live IRIS needed for the default suite). Live IRIS instance: HSCUSTOM namespace on
`localhost:52773` via the `iris-execute-mcp` MCP tools available in the dev session
(`iris_doc_load`, `iris_execute_classmethod`, `iris_execute_tests`, `get_global`, etc.).

## 2. Adding a TypeScript tool

A tool is a `ToolDefinition` object (see `packages/shared/src/tool-types.ts` — read it first):

```typescript
export const myTool: ToolDefinition = {
  name: "iris_my_tool",
  title: "Human Title",
  description: "LLM-optimised description. For multi-action tools, document EVERY action, " +
    "its parameters, and its governance default state (default-disabled writes MUST say so).",
  inputSchema: z.object({ /* zod; include optional namespace for NS/BOTH scope */ }),
  annotations: { readOnlyHint, destructiveHint, idempotentHint, openWorldHint }, // truthful!
  scope: "NS" | "SYS" | "BOTH" | "NONE",
  mutates: "read" | "write" | { action1: "read", action2: "write" },  // REQUIRED for new tools
  handler: async (args, ctx) => { /* ctx.http.get/post; return ToolResult */ },
};
```

Registration checklist:
1. Create `packages/<pkg>/src/tools/<feature>.ts` following an existing sibling
   (e.g., `packages/iris-ops-mcp/src/tools/alerts.ts` is a clean minimal example).
2. Add to the tool array in `packages/<pkg>/src/tools/index.ts`.
3. Update the package's `index.test.ts` count assertions (`toHaveLength`, `getToolNames`).
4. Cross-server/advertised-count tests may also move — see Rule #31 if the tool is
   framework-level (registered in `server-base.ts` for ALL servers) vs. package-level.
5. Custom REST calls go to `const BASE_URL = "/api/executemcp/v2"`; Atelier calls use
   `ctx.http` Atelier helpers (see `packages/shared/src/atelier.ts`).
6. Errors: catch `IrisApiError` → return `{ isError: true, content: [...] }`; rethrow others.

**Governance rules (mandatory):**
- Every NEW tool/action key MUST carry a `mutates` classification — reads too (Rule #28).
  Registration throws (`assertGovernanceClassification`) if you forget.
- New `write` actions are **default-disabled**. Do NOT work around this by mislabelling a
  write as a read. If a write genuinely must ship enabled, use `defaultEnabled: ["action"]`
  with per-action-map `mutates` (Rule #32) — only when the spec explicitly says so.
- NEVER edit `governance-baseline.ts` (frozen at hash `1e62c5ad5bf7`, Rule #23). NEVER run
  `scripts/gen-governance-baseline.mjs` without `--check` (Rule #25).

## 3. Adding/changing an ObjectScript handler

- Read `.claude/rules/iris-objectscript-basics.md` and Rules #7/#8/#9/#15/#29/#33 before writing.
- Routes live in `src/ExecuteMCPv2/REST/Dispatch.cls` UrlMap; handlers delegate to the
  domain class (e.g., `Monitor.cls`). Follow an existing route end-to-end as a template.
- Handler skeleton (non-negotiable patterns):
  - `Set tSC = $$$OK`, Try/Catch, argumentless `Quit` inside Try/Catch, result variable
    initialized before Try.
  - Namespace: `Set tOrigNS = $NAMESPACE` / `Set $NAMESPACE = "%SYS"` / restore before ANY
    error handling or render — never `New $NAMESPACE` (basics rule). Validate inputs BEFORE
    switching namespace.
  - Exactly ONE `RenderResponseBody` per request; error flag + single dispatch after
    Try/Catch (Rule #7). If using I/O redirect, fully restore before render.
  - Error text through `##class(ExecuteMCPv2.Utils).SanitizeError(tSC)` (Rule #9). No `^`
    caret-global names inside error strings — SanitizeError strips them (Rule #33).
  - Never wrap a method call in `$Get()` (Rule #15). Use `%IsDefined`/`%Get` + default.
  - Reject the `||` delimiter in caller-supplied slots of composite IdKeys (Rule #29).
  - Before calling ANY IRIS system class: open its source in `irislib/` / `irissys/` and
    verify method existence, signature, query ROWSPEC, `[Deprecated]` flags (Rules #2/#4/#16).
    For uncertain APIs, build a disposable `ExecuteMCPv2.Temp.*` probe class, compile, invoke
    via `iris_execute_classmethod`, inspect, then DELETE the probe class.
- Deploy loop (every ObjectScript edit):
  1. `iris_doc_load path="c:/git/iris-execute-mcp-v2/src/**/*.cls" compile=true namespace=HSCUSTOM`
     — the glob-prefixed path is REQUIRED (a bare file path mis-maps the class name, Rule #17).
  2. Run ObjectScript unit tests via `iris_execute_tests`. **Compare returned `total` against
     expected test count — partial snapshots happen (Rule #35); rerun if short.**
  3. Regenerate the embedded bootstrap: `pnpm run gen:bootstrap`. NEVER hand-edit
     `packages/shared/src/bootstrap-classes.ts` (Rules #18/#24). `BOOTSTRAP_VERSION` moves —
     that is correct and expected; record from→to hash in your story notes.
- ObjectScript unit tests: extend `%UnitTest.TestCase` under the existing test package (find
  it with `iris_doc_list` filter `ExecuteMCPv2.Test*`). Follow
  `.claude/rules/object-script-testing.md` (assertion macros, %OnNew/initvalue, ≤500 lines/class,
  no underscores in method names).

## 4. Testing & verification requirements (every spec)

1. **Unit tests (default vitest suite):** mocked HTTP; cover happy path, error envelope,
   input validation, and governance-relevant shapes. Do NOT name a must-run test
   `*.integration.test.ts` (that suffix is excluded from the default run — Rule #21).
2. **Back-compat proof (Rule #19):** any change to shared framework or an existing tool needs
   a mechanical assertion that the "feature off / param omitted" path is byte-for-byte
   unchanged (snapshot equality, not prose).
3. **Live smoke (lead-style, Rules #22/#26/#34):**
   - Drive the BUILT `dist/` output in a real Node process (rebuild first), not vitest.
   - For endpoint-backed features: curl/call the LIVE deployed REST route.
   - Every guarded/destructive path: send the forbidden request and assert it is REFUSED
     with the documented error AND changed nothing.
   - Namespace-sensitive tools: smoke a SECOND namespace (e.g., SADEMO) or record the gap
     as explicit residual risk.
   - Delete disposable smoke scripts before staging.
4. **Enumeration-heavy tools (Rule #38):** require a scope filter param; document the ~60s
   Web Gateway timeout risk for wide scopes in the tool description; an output cap (topN)
   is NOT a scan cap — say so.

## 5. Documentation rollup (every spec, Rule #30)

Update ALL of: root `README.md` (tool counts + any new capability section),
`tool_support.md` (catalog row with endpoint + governance note), the per-server
`packages/<pkg>/README.md` (tool reference section), and `CHANGELOG.md`. For every new
tool/action, STATE which actions are default-disabled (writes) vs enabled (reads). Framework
capabilities (registered on all servers) follow Rule #31: package tool-array counts stay
unchanged; advertised/suite counts move +1 per server; document as a framework surface.

## 6. Definition of done (every spec)

- [ ] All acceptance criteria in the spec pass.
- [ ] `pnpm turbo run build` and `pnpm turbo run test` green.
- [ ] ObjectScript compiled clean on live IRIS; `%UnitTest` suite green with full count.
- [ ] `pnpm run gen:bootstrap` run (if ObjectScript touched) and idempotent on rerun.
- [ ] `gen:governance-baseline:check` exits 0 (baseline untouched).
- [ ] Live smokes done, including rejection paths; results recorded in the story file.
- [ ] Docs rollup complete (all four surfaces + default-state callouts).
- [ ] All `ExecuteMCPv2.Temp.*` probe classes and disposable smoke scripts deleted.
