# Test Automation Summary — Story 31.4 Broker Extension MVP (`iris-mcp-launcher`)

**Date:** 2026-07-25
**Scope:** New standalone VS Code extension `extensions/iris-mcp-launcher/` (outside the pnpm
workspace, own vitest config/scripts). Framework: vitest, run from the extension's own directory
(NOT via root turbo). All tests run without a VS Code host by injecting fakes for the `vscode`
and Server Manager APIs, matching the dev stage's existing pattern.

## Baseline (dev stage, verified unchanged)

52 tests across 8 files passing before this pass: `connection.test.ts`, `constants.test.ts`,
`env.test.ts`, `definitions.test.ts`, `settings.test.ts`, `credentials.test.ts`,
`serverDefinitionProvider.test.ts`, `containment.test.ts`.

## Gaps targeted and closed this pass

1. **Integration AC 31.4.5 — env contract.** Read `packages/shared/src/config.ts` (`loadConfig`)
   and `packages/shared/src/profiles.ts` (`mergeProfile`/`buildProfileRegistry`/`ProfileOverride`)
   directly as the oracle (Rule #36). Confirmed the existing `env.test.ts` already pinned the
   six documented `IRIS_*` names, string-encoded port/https, and the `IRIS_PROFILES` field-name
   set. Added two new describe blocks: (a) a typed-JSON contract test asserting `port`/`https`
   inside `IRIS_PROFILES` stay native JSON `number`/`boolean` (not stringified) — load-bearing
   because `mergeProfile` has NO string-coercion fallback for `https` and throws
   `"must be a boolean"` if it were ever stringified; (b) a required-vs-optional contract test
   documenting that `IRIS_USERNAME`/`IRIS_PASSWORD` are always emitted verbatim even when empty
   (no default in `loadConfig`, unlike host/port/namespace).
2. **Credential containment (AC 31.4.3).** Added a new describe block in `containment.test.ts`
   testing three exit-path combinations with a distinctive secret (`DO-NOT-LEAK-CROSS-DEF-*`):
   resolved-then-cancelled (different server), resolved-then-no-spec (server removed from Server
   Manager), and resolved-then-Server-Manager-becomes-unavailable — all on the SAME provider
   instance across sequential `resolveEnvForLabel` calls, so a caching/stateful leak bug would be
   caught. **Verified non-vacuous by mutation**: temporarily added a `lastPasswordForMutationTest`
   instance field to `LauncherProvider` that leaked the previous resolution's password into the
   next cancelled-path warning — the new test failed immediately with the exact secret in the
   diff; reverted the mutation (file confirmed byte-identical afterward) and the suite passed
   clean again.
3. **Cancellation storm prevention.** New describe block calling `resolveEnvForLabel` three times
   in a row on the same never-authenticates definition, asserting warnings grow exactly 1-per-call
   (never a burst) and `getSession` is called exactly 2×-per-call (silent + createIfNone, no extra
   retries).
4. **Username fallback chain degenerate cases.** Added to `credentials.test.ts`: explicit
   empty-string `spec.username` (distinct from `undefined`) falling through to `scopes[1]`;
   explicit empty-string `scopes[1]` (distinct from a missing index) falling through to
   `account.id`; and the all-three-empty degenerate case, which documents (rather than silently
   hides) a real downstream risk — `packages/shared/src/profiles.ts`'s `mergeProfile` rejects an
   empty `username` inside `IRIS_PROFILES`, so an all-empty chain would currently reach a
   downstream startup failure, not a caught error in this extension.
5. **Settings filtering.** Added to `serverDefinitionProvider.test.ts`: explicit
   `settings.servers` selection excludes non-selected Server Manager servers from
   `providePlannedDefinitions()`'s output entirely; `packages: []` yields zero definitions with
   NO warning (a valid "everything disabled" config). Added to `settings.test.ts`: `packages: []`
   read explicitly (not merely unset) yields `[]`, not a silent fallback to the default five —
   guards against a `config.get(key, default) || default`-style falsy-coalescing bug that would
   mask a user's intent to disable everything; likewise for `servers: []`.
6. **Packaging contract.** New `packaging.test.ts` (5 tests) reading `package.json` directly:
   `extensionDependencies` pinned against the SAME `SERVER_MANAGER_EXTENSION_ID` runtime constant
   `credentials.ts`/`extension.ts` use; `main` computed from `tsconfig.json`'s
   `rootDir`/`outDir` (not hand-copied) and verified to exist once a build is present (skipped,
   not failed, on a pristine unbuilt checkout); and — the highest-value check, per Rule #51 —
   `contributes.configuration`'s declared setting keys mechanically extracted-and-compared against
   `settings.ts`'s own `config.get(...)` call sites via a source-text regex, so the two can never
   silently drift. **Verified non-vacuous by mutation**: temporarily deleted
   `irisMcpLauncher.combineProfiles` from `package.json`'s declared properties — the key-match
   test failed immediately listing the missing key; reverted (file restored from a pre-mutation
   copy) and the suite passed clean again.

## Result

**19 new tests added** (71 total, up from 52), across:
- `extensions/iris-mcp-launcher/src/__tests__/credentials.test.ts` (+3)
- `extensions/iris-mcp-launcher/src/__tests__/env.test.ts` (+3, in 2 new describe blocks)
- `extensions/iris-mcp-launcher/src/__tests__/containment.test.ts` (+4, in 2 new describe blocks)
- `extensions/iris-mcp-launcher/src/__tests__/settings.test.ts` (+2)
- `extensions/iris-mcp-launcher/src/__tests__/serverDefinitionProvider.test.ts` (+2)
- `extensions/iris-mcp-launcher/src/__tests__/packaging.test.ts` (new file, 5 tests)

All 71 tests pass (`npx vitest run` from `extensions/iris-mcp-launcher/`, 9 test files). Extension
type-checks clean (`npx tsc --noEmit`, 0 errors) with the new tests included. Two of the
highest-value new tests (cross-definition credential leakage, packaging key cross-check) were
verified non-vacuous via temporary source mutation + revert (see items 2 and 6 above); the file
was confirmed byte-identical to its pre-mutation state after each revert.

No `packages/**`, `pnpm-workspace.yaml`, or `.vscode/settings.json` file was touched. Nothing was
committed.

## Coverage

- Pure logic modules (`env.ts`, `credentials.ts`, `connection.ts`, `definitions.ts`, `settings.ts`,
  `serverDefinitionProvider.ts`, `constants.ts`): comprehensively covered by fake-injected unit
  tests, now including the degenerate/cross-call/packaging-contract gaps identified for this pass.
- `extension.ts` (the one file with a real `vscode` value import): still untested by design — it
  is a thin adapter with no independently-testable logic beyond what `serverDefinitionProvider.ts`
  already covers via injected fakes; exercising it for real requires the VS Code host, which is
  exactly the manual AC 31.4.4 smoke the story already defers to the Project Lead.

## Next steps

- AC 31.4.4's Copilot-chat smoke (real VS Code host, GitHub Copilot, installed VSIX) remains a
  human-verification item per the story's own Dev Notes — out of scope for this automated pass.
- No further automated-test gaps identified against the story's stated ACs at this time.
