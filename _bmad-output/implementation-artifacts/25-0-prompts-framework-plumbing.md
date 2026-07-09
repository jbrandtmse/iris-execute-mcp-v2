# Story 25.0: Framework `prompts` Capability (Plumbing + Back-Compat)

Status: done

## Story

As an MCP client of any of the five IRIS servers,
I want the servers to advertise and serve the MCP `prompts` capability (protocol-discoverable, parameterized workflow instructions),
so that later stories can ship a pack of workflow prompts that teach clients the correct tool *sequences* — while servers with no prompts registered stay byte-for-byte unchanged.

This is the **framework-plumbing** story of Epic 25. It adds the `PromptDefinition` type and registration wiring to `@iris-mcp/shared` ONLY. It ships **no real prompt content** — that is Story 25.1. Tests here use small fixture prompts.

## Acceptance Criteria

- **AC 25.0.1** — `PromptDefinition` interface + optional `prompts?: PromptDefinition[]` on `McpServerBaseOptions`, registered in the `McpServerBase` constructor (per spec §2). A server constructed with an **empty/absent** prompts array advertises **NO** `prompts` capability and behaves byte-for-byte unchanged — proven by a **mechanical capability-snapshot test** (Rule #19): the advertised `initialize` capabilities for a no-prompts server deep-equal today's `{ tools:{listChanged:true}, resources:{listChanged:true} }` (no `prompts` key), and a server WITH ≥1 prompt additionally advertises `prompts:{listChanged:true}`.
- **AC 25.0.2** — `prompts/list` returns each registered prompt with `name`, `title`, `description`, and its `arguments` array; `prompts/get` with valid args renders the `build(args)` output as a single user-role text message (`{ messages: [{ role:"user", content:{ type:"text", text: <build output> } }] }`). `prompts/get` with an **unknown name** → standard JSON-RPC error matching SDK conventions (`McpError` / `ErrorCode.InvalidParams`); a `prompts/get` **missing a required argument** → the SDK's argument-validation `InvalidParams` error.
- **AC 25.0.3** — Per-server prompt assignment is supported: each server package passes its own `prompts` array through to `McpServerBase` (ops prompts on ops, dev on dev, etc.), and shared/framework prompts are possible via the same array. (Story 25.0 wires the mechanism and proves it with fixtures; real per-server content is Story 25.1.)

### Integration ACs

Story 25.0 introduces the `PromptDefinition` framework surface on `McpServerBase`. Its first **content** consumer is **Story 25.1** (which authors the 9 v1 prompts and passes them per-server). No consumer ships in this story; AC 25.0.2/25.0.3 exercise the framework end-to-end with **fixture** `PromptDefinition`s (register → `prompts/list` → `prompts/get` → assert rendered text) so the producer is proven wired even before real content exists. This satisfies the Rule #1 "no consumers yet" escape clause: **the first consumer will be Story 25.1.**

## Tasks / Subtasks

- [x] **Task 1 — `PromptDefinition` type + options wiring** (AC: 25.0.1, 25.0.3)
  - [x] Add the `PromptDefinition` interface to `@iris-mcp/shared` (export it from `index.ts`). Fields exactly per spec §2: `name` (kebab-case), `title`, `description`, `arguments: Array<{ name; description; required }>`, `build(args: Record<string,string>): string`. Consider co-locating it with `ToolDefinition` in `tool-types.ts` (its natural sibling) or a new `prompt-types.ts` — follow whichever matches how `ToolDefinition` is organized.
  - [x] Add optional `prompts?: PromptDefinition[]` to `McpServerBaseOptions` (after `tools`), documented like the sibling `tools` field.
- [x] **Task 2 — Register prompts in the constructor** (AC: 25.0.1, 25.0.2)
  - [x] After the existing tool/resource registration in the `McpServerBase` constructor, iterate `options.prompts ?? []` and register each via the SDK's `this.mcpServer.registerPrompt(name, config, cb)` (see Dev Notes for the exact v1.29.0 signature). Do this through a private `registerPrompt(def)` helper mirroring the existing `registerTool`/`registerGovernanceResource` shape.
  - [x] **Critical back-compat:** do NOT add `prompts` to the constructor's static `capabilities: {...}` object. The SDK advertises `prompts:{listChanged:true}` automatically (via `registerCapabilities`) the first time `registerPrompt` runs — so when `options.prompts` is empty/absent, `registerPrompt` is never called and the capability never appears. This is the mechanism AC 25.0.1 rests on.
  - [x] Map `PromptDefinition` → SDK registration: build the `argsSchema` (a Zod **raw shape**, i.e. a plain object of Zod types) from `def.arguments` — each arg → `z.string().describe(arg.description)`, `.optional()` when `required:false`. Pass `{ title: def.title, description: def.description, argsSchema }` as the config. The callback returns `{ messages: [{ role:"user", content:{ type:"text", text: def.build(args) } }] }`. When `def.arguments` is empty, pass no `argsSchema` (or an empty shape) so the SDK invokes the no-args callback form — verify which the SDK expects (Dev Notes).
  - [x] Guard duplicate prompt names with a clear error (the SDK already throws `Prompt X is already registered`; a friendlier framework-level message is optional).
- [x] **Task 3 — Back-compat capability snapshot test** (AC: 25.0.1)
  - [x] In `packages/shared/src/__tests__/`, add a test that constructs a `McpServerBase` with **no** prompts and asserts the advertised capabilities deep-equal the current baseline (no `prompts` key). Find how the existing suite reads advertised capabilities (grep the tests for how the `resources`/`tools` capability snapshot is asserted — reuse that exact mechanism so the proof is mechanical, not prose). Add a second case: construct WITH ≥1 fixture prompt and assert `prompts:{listChanged:true}` now appears AND `tools`/`resources` are unchanged.
- [x] **Task 4 — `prompts/list` + `prompts/get` behavior tests** (AC: 25.0.2, 25.0.3)
  - [x] With ≥2 fixture prompts (one with a required arg, one with an optional arg, one with no args), drive `prompts/list` and assert each returned entry's `name/title/description/arguments`. Drive `prompts/get` and assert the rendered `messages[0].content.text` equals the fixture's `build(args)` output for representative args.
  - [x] Assert the error paths: unknown name → `InvalidParams`; missing required arg → the SDK validation `InvalidParams`. Use the project's established way of invoking a server request in tests (look at how resource-read / tool-call tests exercise the `McpServer` — reuse it).
  - [x] Prove per-server assignment (AC 25.0.3) at the framework level: a fixture-prompts server exposes exactly those prompts and a no-prompts server exposes none — no cross-contamination (prompts are per-instance, not global).
- [x] **Task 5 — Build + full suite green**
  - [x] `pnpm --filter @iris-mcp/shared build` clean; `pnpm turbo run test` green across the monorepo (no leaf-package count/shape test should move — prompts are not tools; Rule #31). `gen:governance-baseline:check` exits 0 (baseline untouched — this story adds no tool/governance key).

## Dev Notes

### Scope guardrails (read first)
- **`@iris-mcp/shared` ONLY.** No leaf-package tool changes, no ObjectScript, no bootstrap regen, no `governance-baseline.ts` touch, no new tool or governance key. Prompts are NOT tools — they carry no `mutates`, no governance keys, and must not change any tool-count/`getToolNames`/`toHaveLength` assertion anywhere (Rule #31 shape; the counting rollup is Story 25.2's concern and must stay UNCHANGED).
- **No real prompt content here.** The 9 v1 prompts + `gen-skills.mjs` + `validate-prompts.mjs` are Story 25.1. Story 25.0 ships the mechanism and fixture-only tests.
- **CR 24.0-1 (readOnlyHint cross-check) is NOT in this story.** It was routed here by the Epic 24 retro, but the cross-check needs leaf-package tool annotations and `@iris-mcp/shared` cannot import the leaf packages (circular). It is folded into **Story 25.1** (alongside `validate-prompts.mjs`, which aggregates all five packages). See `deferred-work.md` Epic 25 triage.

### SDK prompt API (pinned — `@modelcontextprotocol/sdk@1.29.0`, verified in `node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.3.6/.../server/mcp.js`)
- `McpServer.registerPrompt(name, config, cb)` where `config = { title, description, argsSchema }`. `argsSchema` is a **Zod raw shape** (a plain object whose values are Zod types), NOT a `z.object(...)`. Internally the SDK derives the `arguments` list via `promptArgumentsFromSchema(argsSchema)` for `prompts/list`, and validates/parses `request.params.arguments` via `normalizeObjectSchema(argsSchema)` for `prompts/get`.
- Registration side effects (all desirable here): `setPromptRequestHandlers()` wires `ListPromptsRequestSchema` + `GetPromptRequestSchema` handlers, calls `registerCapabilities({ prompts:{ listChanged:true } })`, and `sendPromptListChanged()` (a no-op until a transport is connected). Handlers are installed once (idempotent `_promptHandlersInitialized`).
- `prompts/get` handler behavior (already implemented by the SDK — you just supply the callback):
  - unknown name → `throw new McpError(ErrorCode.InvalidParams, \`Prompt ${name} not found\`)` — this IS the "standard JSON-RPC error matching SDK conventions" AC 25.0.2 asks for; do NOT hand-roll a different error.
  - when `argsSchema` present: parses args, on failure → `McpError(InvalidParams, "Invalid arguments for prompt ...")`; on success invokes `cb(args, extra)`.
  - when `argsSchema` absent: invokes `cb(extra)` (no args object). Decide the empty-arguments handling: simplest is to always pass an `argsSchema` built from `def.arguments` (an empty shape when there are no arguments) so the callback signature is uniform `(args, extra)`; confirm an empty raw shape `{}` is accepted by `registerPrompt` (it should be — `normalizeObjectSchema({})` yields an empty object schema). If an empty shape misbehaves, branch: pass `argsSchema` only when `def.arguments.length > 0`.
- Callback return type is the MCP `GetPromptResult`: `{ messages: Array<{ role: "user"|"assistant", content: { type:"text", text:string } }> }`. Spec §2 says the prompt text is a **user-role** message → `role:"user"`.

### Mirror the resources wiring (the spec's stated model)
- The governance **resource** wiring in `server-base.ts` is the exact template to follow for structure: capability declared/auto-advertised, registered in the constructor after tools, handler closes over `this`. See `registerGovernanceResource()` (`server-base.ts:601`) and the constructor block (`server-base.ts:385-459`). Differences for prompts: (a) prompts are per-instance content passed via options (like `tools`), not a single framework-provided resource; (b) do NOT pre-declare `prompts` in the constructor `capabilities` object (unlike `resources`, which IS pre-declared per D6) — pre-declaring would break the empty-pack back-compat AC. The SDK's own `registerPrompt`→`registerCapabilities` is what advertises it, only when a prompt exists.
- Registration ordering in the constructor: register tools → discovery tool → rebuild lookups/keys → `registerGovernanceResource()` → **then** register prompts. Prompts are independent of the governance machinery; keep them last so they don't perturb the governed-key rebuilds.

### Back-compat proof shape (Rule #19)
- The single most important assertion: **no-prompts server advertised capabilities == today's, exactly.** Grep the existing shared tests for how advertised capabilities are read (the Epic 14 D6 work added a `resources`-capability assertion; reuse the same access path — likely constructing the base and reading `mcpServer.server`'s capabilities, or via an in-memory transport `initialize`). If the suite already has a "capabilities snapshot" helper, extend it; otherwise add the minimal read that the resources test uses. Prose ("it's unchanged") is not acceptable — the test must fail if a stray `prompts` key leaks in.

### Per-server assignment (AC 25.0.3)
- The mechanism is: each leaf `index.ts` constructs its `McpServerBase` with `{ ..., prompts: [...] }`. Story 25.0 does NOT edit the leaf `index.ts` files with real content (that's 25.1) — it only proves the `McpServerBase` honors a passed array and isolates prompts per instance. If a fixture-level demonstration needs a constructed base, do it in the shared test with fixture prompts; do not wire real per-server arrays yet.

### Testing standards
- Default vitest suite (mocked HTTP; no live IRIS). Do NOT name any must-run test `*.integration.test.ts` (excluded from the default run, Rule #21). Cover: empty-pack capability snapshot, non-empty capability delta, `prompts/list` shape, `prompts/get` render, unknown-name error, missing-required-arg error, per-instance isolation.
- Reuse existing shared test-helpers (`packages/shared/src/test-helpers`, `__tests__`) for constructing a base and driving requests — match the resources/tools test patterns rather than inventing a new harness.

### Project Structure Notes
- Files expected to change: `packages/shared/src/tool-types.ts` (or a new `prompt-types.ts`), `packages/shared/src/server-base.ts`, `packages/shared/src/index.ts` (export `PromptDefinition`), and a new `packages/shared/src/__tests__/prompts*.test.ts`. No leaf-package files, no scripts, no docs (docs are Story 25.2).

### References
- [Source: _bmad-output/planning-artifacts/research/feature-specs/03-skills-prompts-pack.md#2 Framework work] — `PromptDefinition` shape, capability-only-when-non-empty, back-compat.
- [Source: _bmad-output/planning-artifacts/research/feature-specs/00-conventions.md#4 Testing] — default-suite rules, Rule #19 back-compat proof, Rule #21 no `.integration` suffix.
- [Source: _bmad-output/planning-artifacts/epics.md#Story 25.0] — AC 25.0.1/2/3.
- [Source: packages/shared/src/server-base.ts:385-459, 601-660] — constructor + resources wiring to mirror.
- [Source: node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0.../server/mcp.js:397-470, 706-740] — `registerPrompt` signature + `prompts/list`/`prompts/get` handler behavior.
- [Source: .claude/rules/project-rules.md#31] — framework-surface counting shape (package tool-array counts unchanged).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via bmad-dev-story.

### Debug Log References

- Pinned the exact SDK v1.29.0 `registerPrompt`/`prompts/list`/`prompts/get` handler behavior by reading
  `node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.3.6/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js`
  (lines ~397–446 `setPromptRequestHandlers`, ~706–736 `prompt`/`registerPrompt`, ~563–597
  `_createRegisteredPrompt`, ~873–888 `promptArgumentsFromSchema`) and `zod-compat.js`
  (`getSchemaDescription`, `isSchemaOptional`, `ShapeOutput`) before writing the registration
  helper — confirmed `registerPrompt(name, {title,description,argsSchema}, cb)`, that an
  ALWAYS-present `argsSchema` (even an empty raw shape `{}`) keeps the callback signature
  uniform `(args, extra)`, and that unknown-name/missing-required-arg errors are the SDK's own
  `McpError(InvalidParams, ...)` — no hand-rolled error path needed.
- First test run surfaced two real bugs, both fixed before proceeding:
  1. `prompts/list`'s `arguments[].description` was `undefined` for the OPTIONAL fixture prompt.
     Root cause: `z.string().describe(x).optional()` — Zod v4's `.optional()` wrapper returns a
     NEW schema object whose own `.description` is empty even though the inner `z.string()` was
     described first; the SDK's `getSchemaDescription` reads `schema.description` off the schema
     it was actually given. Fix: build the optional/required base FIRST, then call `.describe()`
     on the outermost wrapper (`(required ? z.string() : z.string().optional()).describe(desc)`).
  2. Two draft tests assumed a no-prompts server would still route `prompts/list`/`prompts/get`
     (returning empty results). That is wrong: `setPromptRequestHandlers()` — which wires those
     two request handlers — is only called from inside `registerPrompt`/`prompt`, so a server that
     never registers a prompt has NO handler for either method at all. Rewrote those two
     assertions to expect the "No request handler registered" condition instead, which is in fact
     the STRONGER proof of AC 25.0.3 isolation (the whole prompts surface doesn't exist on that
     instance, not merely an empty list).

### Completion Notes List

- Added `PromptDefinition`/`PromptArgumentDefinition` to `packages/shared/src/tool-types.ts`
  (co-located with `ToolDefinition`, its natural sibling per the Dev Notes) and re-exported both
  from `packages/shared/src/index.ts`.
- Added `prompts?: PromptDefinition[]` to `McpServerBaseOptions` in `server-base.ts` and a new
  private `registerPrompt(def)` helper (mirrors the `registerTool`/`registerGovernanceResource`
  shape). Wired into the constructor as the LAST step (after tool/discovery registration and
  `registerGovernanceResource()`), iterating `options.prompts ?? []` — prompts carry no `mutates`
  classification and must not perturb the governed-key rebuilds that precede them.
- **Back-compat mechanism (AC 25.0.1):** `prompts` is deliberately NOT added to the constructor's
  static `capabilities: {...}` object (unlike `resources`, which IS pre-declared per D6). The
  SDK's own `registerPrompt` → `registerCapabilities({prompts:{listChanged:true}})` call is the
  ONLY thing that ever advertises the `prompts` capability, and it runs only when `registerPrompt`
  is actually invoked — so an empty/absent `options.prompts` never triggers it. Proven mechanically
  (not prose) by a `toEqual` deep-equality snapshot against today's exact `{tools, resources}`
  capability object.
- `prompts/get`'s callback renders `def.build(args)` as a single `role:"user"` text message,
  exactly per spec §2. Unknown-name and missing-required-argument errors are the SDK's own
  `McpError(ErrorCode.InvalidParams, ...)` paths — not hand-rolled, per AC 25.0.2's explicit
  instruction to match SDK conventions.
- Shipped **zero real prompt content** — only three small fixture `PromptDefinition`s in the test
  file (no-args, one-required-arg, one-optional-arg), per the story's explicit scope guardrail
  (Story 25.1 owns the 9 v1 prompts). CR 24.0-1 (readOnlyHint cross-check) was intentionally NOT
  implemented here — the story's own Dev Notes route it to Story 25.1 for a dependency-direction
  reason (`@iris-mcp/shared` cannot import leaf-package tool annotations without a circular
  dependency), consistent with `deferred-work.md`'s Epic 25 retro-review gate triage.
- New `packages/shared/src/__tests__/prompts.test.ts` (13 tests, self-contained — no env vars, no
  fetch/bootstrap mocking needed, since prompt registration is fully synchronous and
  constructor-scoped, so none of these tests call `start()`): AC 25.0.1 capability snapshot (3
  tests: no-prompts, empty-array, and >=1-prompt delta), AC 25.0.2 `prompts/list` shape (2 tests)
  and `prompts/get` render + error paths (6 tests: no-args/required-supplied/optional-omitted/
  optional-supplied renders, unknown-name error, missing-required-arg error), AC 25.0.3 per-instance
  isolation (2 tests).
- Verified: `pnpm --filter @iris-mcp/shared build` clean; `pnpm turbo run build` 6/6 packages green;
  `pnpm turbo run test` 12/12 tasks green across the monorepo (shared 677/677 [+13 new], dev
  365/365, admin 439/439, ops 335/335, interop 270/270 — all pre-existing counts unchanged, no
  leaf-package tool-count/shape assertion moved, confirming Rule #31: prompts are not tools);
  `pnpm run gen:governance-baseline:check` exits 0 (194 live keys unchanged, frozen baseline
  `1e62c5ad5bf7` untouched — no new tool/governance key). `git diff --stat` confirms only
  `packages/shared/**` source/test files changed (plus this story file + sprint-status.yaml +
  deferred-work.md bookkeeping).

### File List

- `packages/shared/src/tool-types.ts` (modified — added `PromptArgumentDefinition` + `PromptDefinition` interfaces)
- `packages/shared/src/index.ts` (modified — exported the two new prompt types)
- `packages/shared/src/server-base.ts` (modified — `McpServerBaseOptions.prompts`, `registerPrompt()` helper, constructor wiring, `GetPromptResult` import)
- `packages/shared/src/__tests__/prompts.test.ts` (new — 13 tests covering AC 25.0.1/25.0.2/25.0.3)
- `packages/shared/src/__tests__/prompts-guardrails.test.ts` (new, QA — 9 orthogonal guardrail tests: real `McpError`/`InvalidParams` typing, protocol-level `initialize` handshake, prompts-don't-leak-into-tools/resources, per-instance duplicate-name-guard scope, no-arg-omitted-`arguments` behavior)

## Review Findings (bmad-code-review, 2026-07-08)

Adversarial three-layer review (Blind Hunter / Edge Case Hunter / Acceptance Auditor) + independent verification. All three ACs (25.0.1/25.0.2/25.0.3), the Integration AC, and the Rule #31 / `@iris-mcp/shared`-only scope constraint verified SATISFIED with mechanical (not prose) proofs. Baseline `1e62c5ad5bf7` untouched, `gen:governance-baseline:check` exit 0, no leaf-package/ObjectScript/tool-count change.

**Patched inline (2 MEDIUM + 1 doc):**
- **CR 25.0-1 (MEDIUM, blind+edge+auditor) — no-arg prompt rejected an omitted `arguments`.** `registerPrompt` unconditionally passed `argsSchema: {}` for a no-argument prompt, so the SDK ran `safeParseAsync(z.object({}), undefined)` and refused a spec-compliant client that omits `arguments` (the MCP wire schema marks it optional) with `InvalidParams`. Fix: register no-arg prompts WITHOUT an `argsSchema` (the Dev-Notes fallback branch) → SDK uses the no-args callback form and skips validation, so omitted `arguments` renders. Matters because Story 25.1 ships a real no-arg prompt (`objectscript-review`). The QA guardrail test that had *pinned the rejection* was flipped to assert successful render.
- **CR 25.0-2 (MEDIUM, blind+edge) — `build(args)` type unsound for omitted optionals.** `PromptDefinition.build(args: Record<string, string>)` promised every value is `string`, but an omitted optional argument is absent (`undefined`) — a latent runtime crash for Story 25.1 content authors writing `args.foo.trim()`. Fix: typed as `Record<string, string | undefined>`, forcing defensive handling.
- **CR 25.0-3 (LOW, auditor) — File List omitted `prompts-guardrails.test.ts`.** Added above.

**Deferred to `deferred-work.md` (§ story-25.0):**
- **CR 25.0-4 (LOW) — prompt callback lacks error containment** (a throwing `build` surfaces as an opaque JSON-RPC -32603, unlike the tool path's `try/catch`). Primary trigger (dereferencing an omitted optional) is defanged by CR 25.0-2; deferred as forward-looking hardening.
- **CR 25.0-5 (LOW) — duplicate argument names within one prompt silently collapse** (last-wins in the shape object; no registration guard). Author-side, low-probability; a `validate-prompts.mjs` check (Story 25.1) is the natural home.

**Dismissed:** non-iterable `def.arguments` throwing at construction (TS-enforced `PromptArgumentDefinition[]`; the codebase does not defensively guard other TS-typed fields); dev's own error-path tests being message-only regex (compensated by the guardrails file's `instanceof McpError` + `.code` assertions).
