# Test Automation Summary — Story 25.0 Prompts Framework Plumbing

**Date:** 2026-07-08
**Scope:** `@iris-mcp/shared` ONLY — `PromptDefinition` type + `McpServerBase.registerPrompt()` wiring. No leaf-package/tool/ObjectScript/governance changes.

## Pre-existing coverage (dev, upstream)

- `packages/shared/src/tool-types.ts` — `PromptArgumentDefinition` / `PromptDefinition` interfaces.
- `packages/shared/src/server-base.ts` — `McpServerBaseOptions.prompts`, private `registerPrompt()` helper, constructor wiring (kept last, after tools/discovery/governance-resource registration).
- `packages/shared/src/__tests__/prompts.test.ts` (13 tests) — AC 25.0.1 capability snapshot (no-prompts / empty-array / with-prompts delta via `getCapabilities()`), AC 25.0.2 `prompts/list` shape + `prompts/get` render across no-args/required-supplied/optional-omitted/optional-supplied + unknown-name and missing-required-arg error paths (message-regex assertions), AC 25.0.3 per-instance isolation (different single-prompt servers expose only their own prompt; a no-prompts server has no prompt request handler at all).

## Coverage gap filled (QA, this pass)

The dev suite proves the mechanism works but leaves several AC-mandated guarantees unpinned:

1. **AC 25.0.2 "SDK-native InvalidParams" was only regex-matched, never type-checked.** The story text explicitly requires the SDK's own `McpError`/`ErrorCode.InvalidParams` convention, but no test asserted `instanceof McpError` or `.code === ErrorCode.InvalidParams` — a hand-rolled plain `Error` with a similar message would have passed the existing suite.
2. **AC 25.0.1's capability proof only read the internal `getCapabilities()` accessor**, never drove the actual `initialize` request end-to-end (the real protocol entry point a connected client uses).
3. **Nothing proved prompts don't leak into `tools/list`** or perturb the earlier-registered governance `resources/list` surface — registration ordering (prompts last, per Dev Notes) was asserted in a comment, not a test.
4. **The SDK's duplicate-prompt-name guard was never exercised**, and its *scope* (per-`McpServer`-instance vs. global) was unproven — a regression that made it global would silently break multi-server processes.
5. **A real SDK edge case was undiscovered**: the wire schema (`GetPromptRequestParamsSchema`) marks `arguments` optional, so a spec-compliant client may omit it for a no-arg prompt — but `registerPrompt()`'s design choice (always pass a non-`undefined` `argsSchema`, even empty) makes the SDK reject an omitted `arguments` key with `InvalidParams`. Verified by running it (Rule #36 — observe, don't assume), not reasoned about.

New default-suite file: **`packages/shared/src/__tests__/prompts-guardrails.test.ts` — 9 tests**, orthogonal to `prompts.test.ts` (no duplicated assertions):

- **AC 25.0.2 McpError typing (2 tests)** — unknown-name and missing-required-arg rejections asserted `instanceof McpError` + `.code === ErrorCode.InvalidParams`, not just message text.
- **AC 25.0.2 edge case (1 test)** — omitting `arguments` entirely for a no-arg prompt rejects with `InvalidParams`; documents the real (not assumed) SDK behavior from the "always-pass-argsSchema" design choice.
- **AC 25.0.1 protocol-level `initialize` (2 tests)** — drives the actual `initialize` request handler (not the internal `getCapabilities()` peek) for both no-prompts and with-prompts servers; asserts `protocolVersion`, `serverInfo`, and the exact `capabilities` delta.
- **Cross-surface non-interference (2 tests)** — `tools/list` on a with-prompts server contains ONLY the framework discovery tool (no prompt name leaks into the tools surface); `resources/list` still exposes `iris-governance://default` with prompts registered (prompt registration, added last in the constructor, doesn't clobber the earlier resource wiring).
- **AC 25.0.3 duplicate-name guard scope (2 tests)** — two prompts sharing a name on ONE server instance hit the SDK's own `Prompt X is already registered` guard; two DIFFERENT server instances registering a prompt with the SAME name do NOT collide and each renders its own distinct `build()` output — proving the guard is per-instance, not a shared/global registry.

## Result

- `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/prompts-guardrails.test.ts` → **9/9 passed**.
- Full `pnpm --filter @iris-mcp/shared test` → **35 files, 686 tests passed** (was 677 before this pass — the new file is discovered by the default `vitest run`, `*.test.ts` naming, not `*.integration.test.ts`, Rule #21).
- `pnpm turbo run test` (monorepo) → **12/12 tasks passed**: shared 686/686 (+9), dev 365/365, admin 439/439, ops 335/335, interop 270/270 — all four leaf-package counts UNCHANGED, confirming Rule #31 (prompts are not tools; no package tool-array/`getToolNames`/`toHaveLength` assertion moved).
- No existing test modified or perturbed. No ObjectScript, no bootstrap regen, no `governance-baseline.ts` touch — this story adds no tool/governance key.

## Coverage

- Mechanism + fixture-level AC 25.0.1/25.0.2/25.0.3 proof: dev-owned, unchanged.
- SDK-error-type fidelity, protocol-level (not internal-accessor) capability proof, tools/resources cross-surface non-interference, and duplicate-name-guard scope: QA-added, this pass.

## Next steps

- None required for this story — Story 25.1 is the first real content consumer (9 v1 prompts, `gen-skills.mjs`, `validate-prompts.mjs`, and the deferred CR 24.0-1 `readOnlyHint` cross-check). When it lands, its own tests should exercise real prompt content against the per-server `prompts` wiring this story proved.
