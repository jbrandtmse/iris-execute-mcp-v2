---
title: 'Story 38.1: Reject the Unimplemented HTTP Transport'
type: 'bugfix'
created: '2026-10-15'
status: 'done'
baseline_revision: 'e25f1e79b90c286467b0f1e1e12933ed96cfaed4'
baseline_commit: 'e25f1e79b90c286467b0f1e1e12933ed96cfaed4'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** The suite advertises and accepts a transport it cannot run (G48). `resolveTransport()` returns `http` from `MCP_TRANSPORT` or `--transport`, and `McpServerBase.start()` then loads configuration, health-checks, negotiates and bootstraps against IRIS before it throws "HTTP transport not yet implemented". An unknown `MCP_TRANSPORT` value falls back to stdio with a warning, and an unknown `--transport` value is silently ignored.

**Approach:** Make every configured transport value other than `stdio` a configuration error thrown by `resolveTransport()`. Each entry point routes it into its existing `Fatal:` handler, so the process exits 1 before any IRIS traffic. Remove the dead HTTP branch and narrow `start()` to `"stdio"`. Pin startup with no transport or `stdio` as byte-identical. Prove the rejection on all five built entry points. Correct the docs, record the change, and file the real HTTP transport as a human decision.

## Boundaries & Constraints

**Always:**
- Only the effective startup path changes. With no transport configured, or `stdio`, nothing new is logged, and the fetch sequence and log lines are identical to the baseline `3cf6df72999b129b7eda27e91983d1a7e8261a36`.
- The rejection happens inside `resolveTransport()` and is evaluated before `server.start()` runs. A rejected process makes no IRIS connection.
- The error text follows the `<what happened>. <what to do about it>.` convention and names both the value and its source (`MCP_TRANSPORT` or `--transport`). Logging goes to stderr only, because stdout carries MCP.
- Non-ASCII characters in source are written as escapes (skill Rule 14). Comments state the contract, never the history.
- `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141, checked with `pnpm gen:governance-baseline:check` only. Tool, action and key counts do not move.

**Never:**
- Never touch `packages/shared/src/bootstrap-classes.ts`, any `src/ExecuteMCPv2/**` class, or any governance or preset file.
- Never implement Streamable HTTP or any part of it: no new dependency, no `http` module server, no SDK HTTP transport import.
- Never add a runtime guard for a non-`stdio` value inside `start()`. `resolveTransport()` is the single producer, and the type narrows the parameter, so such a branch could never be reached (Rule #54).
- Never rename `MCP_TRANSPORT`. It predates the `IRIS_` convention, and a rename would be breaking.
- Neither the story's code nor its new tests may make any IRIS call; none is needed. Never edit any of the 38 `stageDefaultStartup` test files.
- No `changeset version`, no publish, no CI wiring (AD-29).

## I/O & Edge-Case Matrix

The message templates are exact (`<v>` is `JSON.stringify(value)`):
- **E** (environment): `Unsupported transport <v> from MCP_TRANSPORT: stdio is the only supported transport. Unset MCP_TRANSPORT or set it to "stdio".`
- **F** (flag): `Unsupported transport <v> from --transport: stdio is the only supported transport. Remove --transport or pass --transport stdio.`

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Not configured | no `--transport`; `MCP_TRANSPORT` unset or `""` | returns `"stdio"`; writes nothing | No error expected |
| Explicit stdio | `--transport stdio`, `--transport=stdio`, or `MCP_TRANSPORT=stdio` | returns `"stdio"`; writes nothing | No error expected |
| http, environment | `MCP_TRANSPORT=http` | throws E with `"http"` | the entry prints `Fatal: Error: <E>`, exits 1, no connection |
| http, flag | `--transport http` or `--transport=http` | throws F with `"http"` | same as above |
| Unknown value | `MCP_TRANSPORT=websocket` / `STDIO`; `--transport=websocket` | throws E or F with that value (the match is exact and case-sensitive) | same as above |
| Flag without a value | `--transport` as the last argument, or `--transport=` | throws F with `""` | same as above |
| Both channels | `--transport stdio` + `MCP_TRANSPORT=http` | throws E: every configured value is checked | same as above |
| Both channels, flag bad | `--transport=http` + `MCP_TRANSPORT=stdio` | throws F: flags are checked first, in argv order | same as above |

</intent-contract>

## Code Map

- `packages/shared/src/transport.ts:1-34` -- `resolveTransport(): "stdio" | "http"`.
  - Flag forms are read at :11-22. `--transport <v>` is honored only when the next argument is truthy, and an unknown flag value is skipped.
  - `MCP_TRANSPORT` is read at :25-26. An unknown value triggers the `Warning: unrecognised ...` fallback at :27-31.
  - Default `"stdio"` at :33. The function is rewritten in place.
- `packages/shared/src/server-base.ts` -- class JSDoc bullet :323 "stdio and HTTP transport setup"; `start()` JSDoc `@param` :1960 and signature :1962 `start(transport: "stdio" | "http" = "stdio")`; step 5 at :2165-2180 (the `else` branch :2170-2180 is the dead HTTP branch). Steps 1-4.5 (:1963-2163) all run before step 5 today.
- `packages/shared/src/index.ts:63` -- re-exports `resolveTransport`; unchanged.
- The entry points:
  - `packages/iris-{dev,admin,interop,ops}-mcp/src/index.ts:30-35`, and `packages/iris-data-mcp/src/index.ts:28-33`. Each calls `const transport = resolveTransport();` at the top level, outside the `server.start(transport).catch(... "Fatal:" ... exit(1))` handler.
  - The header comments at :3-9 say "connects the configured transport (stdio by default)".
  - `McpServerBase` is constructed before the call. Construction logs `[INFO] Tool visibility: ...` and makes no network call.
- `packages/shared/src/__tests__/transport.test.ts` (62 lines) -- unit tests of the old contract, to be rewritten.
- `packages/shared/src/__tests__/server-base.test.ts` -- `makeConfig` :27 and `makeServerOpts` :85 (no `needsCustomRest`, so no bootstrap). The `start() method` describe at :538 uses `fetchMock`, `exitMock` and `console.error`, mocked at :103. The http case at :596-623 is removed.
- `packages/shared/src/__tests__/server-base-default-outage-coverage.test.ts` -- describe "Gap 1" :301-324 calls `start("http")` and is deleted; the header references at :11-16, :46 and :56 lose it.
- `packages/iris-{admin,ops,interop,data}-mcp/src/__tests__/index.test.ts` -- their `resolveTransport()` blocks (admin :119-173, ops :118-160, interop :148-190, data :113-155) expect `"http"` or a fallback. They import the shared dist. `iris-dev-mcp`'s `index.test.ts` has no such block.
- `packages/iris-mcp-all/src/__tests__/{host-guard-process-gate.test.ts:139-180, governance-file-process-gate.test.ts:333-373, server-manager-precedence-gate.test.ts:176-213}` -- three identical copies of `SpawnOutcome` and `spawnAndWaitForExit(env, timeoutMs)`. Each is hard-wired to `DEV_MCP_ENTRY_POINT` and uses stdio `["ignore","ignore","pipe"]`. Host-guard and governance-file are byte-identical; server-manager differs only in its doc comment.
- `scripts/lib/dist-freshness.mjs` -- `checkDistFresh(pkgDir, pkgName)` returns `{ok, reason?, skipped?}` and never throws. The import pattern is at `epic37-default-outage-gate.test.ts:68`.
- Docs:
  - `README.md:71-90` (env-var table), `:541` (the "Invalid configuration still fails startup fast" list) and `:698` (the stdio-or-Streamable-HTTP claim);
  - `packages/shared/README.md:29,39,150`;
  - `packages/iris-data-mcp/src/tools/debug.ts:8` (a comment).
- `CHANGELOG.md` top section, newest first, as `## [Pre-release — <date>] — Story X.Y: ...` with `### Changed — ...`. `.changeset/config.json` uses the fixed `@iris-mcp/*` group with double-quoted frontmatter (see `.changeset/story-38-0-epic-37-deferred-cleanup.md`).
- `_bmad/scripts/ledger.sh` -- `new "<summary>" "<source>" "<severity>" "<fix-risk>" "<footprint>" "<evidence>" "<status>" "<owner>" "<by>" "<note>"` prints `DW-<n>`. The `owner` is validated against `sprint-status.yaml`.
- Read-only: `packages/shared/src/bootstrap-classes.ts` (`BOOTSTRAP_VERSION` stays `3af8ca401e7c`), `packages/shared/src/governance-baseline.ts`, every `presets.ts`, and the 38 files that `git grep -l stageDefaultStartup -- 'packages/*/src/__tests__/*.ts'` lists.

## Tasks & Acceptance

**Execution:**
- `packages/shared/src/__tests__/server-base.test.ts` -- FIRST, before any source edit, add a back-compat case to the `start() method` describe. It sets `process.argv` and `MCP_TRANSPORT` for each of the 5 not-configured/explicit-stdio inputs of the matrix (unset, `MCP_TRANSPORT=""`, `--transport stdio`, `--transport=stdio`, `MCP_TRANSPORT=stdio`) (restoring both afterwards). For each input it stages HEAD 200 plus the version response, calls `await server.start(resolveTransport())` on `makeServerOpts([], makeConfig())`, and pins with `toEqual`:
  - the fetch calls as `[method, url]`;
  - every `console.error` line written from the `resolveTransport()` call to the resolved `start()`, with `[DEBUG]` lines excluded only if two baseline runs show them varying.

  Run it green on the unmodified baseline and paste the captured arrays as literals, citing the capture command in the test header (Rule #36). Then delete the http case at :596-623. -- AC-3.
- `packages/shared/src/transport.ts` -- rewrite `resolveTransport(): "stdio"`.
  - It walks `process.argv.slice(2)` in order: `--transport` takes the next argument (`""` when absent, and the value is consumed), and `--transport=<v>` takes the suffix.
  - Each value must equal `stdio`, else it throws F.
  - Then a non-empty `MCP_TRANSPORT` must equal `stdio`, else it throws E. It returns `"stdio"`.
  - It writes nothing on any path; the old warning is removed. The JSDoc states the contract and AD-23.
  - AC-2.
- `packages/shared/src/server-base.ts` -- remove the `else` branch (:2170-2180) so step 5 always connects `StdioServerTransport`. Change the signature to `start(transport: "stdio" = "stdio")`, the `@param` to `"stdio"` (the only supported transport; `resolveTransport` rejects every other value), and the class bullet :323 to "stdio transport setup". -- AC-2.
- `packages/iris-{dev,admin,interop,ops,data}-mcp/src/index.ts` -- replace the `resolveTransport()` call and the `.catch` chain with the same top-level `try { await server.start(resolveTransport()); } catch (err: unknown) { console.error("Fatal:", err); process.exit(1); }` in all five files, and change the header to "connects the stdio transport, the only supported transport; any other configured transport is a fatal configuration error". Construction stays first. -- AC-2, AC-4.
- `packages/shared/src/__tests__/transport.test.ts` -- rewrite it as unit tests over every matrix row: return value, the exact E or F text through `toThrow(<literal>)`, and `console.error`, `console.warn` and `process.stdout.write` spies left uncalled on every path. Save and restore `process.argv` and the environment. -- AC-2.
- `packages/iris-{admin,ops,interop,data}-mcp/src/__tests__/index.test.ts` -- in each `resolveTransport()` block, keep the stdio cases and turn the `http`, unrecognised and precedence cases into `toThrow` assertions on the exact E or F text. -- shared-surface update.
- `packages/shared/src/__tests__/server-base-default-outage-coverage.test.ts` -- delete describe "Gap 1" (it drives only the removed branch), and rewrite the header list (:11-16, :46, :56) without it. -- shared-surface update.
- `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts` (new) -- export `SpawnOutcome` and `spawnAndWaitForExit(entryPoint, args, env, timeoutMs, cwd?)`. They are the three identical copies with the entry point, the arguments and the working directory as parameters, stdio `["ignore","ignore","pipe"]`, and kill-and-`timedOut` at the timeout. Replace the local copies in `host-guard-process-gate.test.ts`, `governance-file-process-gate.test.ts` and `server-manager-precedence-gate.test.ts` with imports, so each call passes `DEV_MCP_ENTRY_POINT, []`, and drop any import that becomes unused. -- Rule 2.
- `packages/iris-mcp-all/src/__tests__/transport-rejection-gate.test.ts` (new, default suite, unarmed) -- AC-4 and AC-6.
  - **`beforeAll`.** It runs `checkDistFresh` for `shared` and the five server packages. A missing or stale dist FAILS with the reason and the rebuild command. It never skips, because the gate needs no IRIS and a skip would leave it a dead check (Rule #59).
  - **The process gate.** For each of `iris-dev-mcp`, `iris-admin-mcp`, `iris-interop-mcp`, `iris-ops-mcp` and `iris-data-mcp`:
    - **Setup.** Start a `net.createServer` listener on `127.0.0.1:0`; it counts each connection, then destroys the socket.
    - **Child environment.** Take `process.env`, minus every key that upper-cases to `IRIS_*`, `MCP_TRANSPORT` or `LOG_LEVEL`. Add `IRIS_HOST=127.0.0.1`, `IRIS_PORT=<listener port>`, `IRIS_USERNAME`/`IRIS_PASSWORD` set to the synthetic `transport-gate`, `IRIS_NAMESPACE=USER` and `IRIS_TIMEOUT=2000`.
    - **Working directory.** A fresh `mkdtemp` under `realpathSync(tmpdir())`.
    - **The four rejection forms.** Spawn `packages/<pkg>/dist/index.js` concurrently with `MCP_TRANSPORT=http`, `--transport http`, `--transport=http` and `MCP_TRANSPORT=websocket`. Each must:
      - not time out, and exit with code 1;
      - have stderr that contains `Fatal: Error: ` followed by the exact E or F text;
      - have stderr that contains neither `IRIS health check` nor `Connected via stdio transport`.
    - **The connection count.** Then assert that the listener counted 0 connections.
    - **The control.** Spawn once with no transport configured. It must show at least 1 connection and `Connected via stdio transport` on stderr. This proves that the oracle can see a connection. Its exit code is not asserted: stdin at EOF ends it, as the baseline capture shows, and a 10 s timeout kills it otherwise.
    - **Cleanup.** Every listener is closed, and every temporary directory removed, in `finally` or `afterAll`.
  - **The doc-claims case.** Read `README.md`, `packages/{shared,iris-dev-mcp,iris-admin-mcp,iris-interop-mcp,iris-ops-mcp,iris-data-mcp}/README.md` and every `docs/client-config/*.md`. None may match `/stdio\W*(or|vs|\/)\W*(\*\*)?Streamable HTTP/i`, `--transport[ =]http` or `MCP_TRANSPORT=http`. `README.md` must carry the new `MCP_TRANSPORT` table row.
- `README.md` -- :698 becomes the stdio-only statement: any other `MCP_TRANSPORT` or `--transport` value, `http` included, is a startup configuration error, and Streamable HTTP is not offered because it needs an authentication, bind-address and session design. :541 adds "an unsupported `MCP_TRANSPORT`/`--transport` value" to the fail-fast list. Add the env-table row `MCP_TRANSPORT` | `stdio` | **Optional.** Only `stdio` is supported (`--transport` is equivalent); any other value fails startup naming it. -- AC-6.
- `packages/shared/README.md` -- :29 "stdio transport setup"; :39 `resolveTransport()` returns `stdio` from `--transport`/`MCP_TRANSPORT` and throws a configuration error for any other value; :150 "(stdio)". `packages/iris-data-mcp/src/tools/debug.ts:8` becomes "(not available over the stdio transport)". -- AC-6.
- `CHANGELOG.md`, `.changeset/story-38-1-reject-http-transport.md` (new) -- AC-6, AD-15, AD-29.
  - The CHANGELOG gets a new top section, `## [Pre-release — 2026-10-15] — Story 38.1: Reject the unimplemented HTTP transport`. Under it goes one `### Changed — an MCP transport other than stdio is a startup configuration error (@iris-mcp/shared, all five servers; G48)`, which states:
    - the before behavior (the health check, negotiation and bootstrap ran before the throw; the unknown-value fallback);
    - the after behavior (the exact E and F texts, exit 1, no IRIS traffic, startup unchanged for unset or `stdio`, `start()` accepting only `"stdio"`);
    - and the filed DW id.
  - The changeset is `"@iris-mcp/shared": minor` and `"@iris-mcp/dev"`, `"@iris-mcp/admin"`, `"@iris-mcp/interop"`, `"@iris-mcp/ops"`, `"@iris-mcp/data"`: patch.
- Ledger (no file edit) -- run `bash _bmad/scripts/ledger.sh _bmad-output/implementation-artifacts/deferred-work.md new "Streamable HTTP transport is not offered: a real MCP HTTP transport needs an authentication, bind-address and session design first" "spec-38-1-reject-the-unimplemented-http-transport.md" "med" "high" "out-of-footprint" "G48/S-2: Story 38.1 makes every non-stdio transport a startup configuration error; AD-23 and the spine Deferred list allow an HTTP transport only with an auth, bind-address and session design and a confirmed remote-access use case" "decision-pending" "burndown" "implement" "human=decide the auth, bind-address and session design (and the use case) for Streamable HTTP; AD-23"`. Then record the printed `DW-<n>` under Auto Run Result and in the CHANGELOG line, and confirm it with `ledger.sh ... show DW-<n>`. -- AC-6.

**Acceptance Criteria:**
- AC-1 (38.1.1): Given baseline `3cf6df7`, when `transport.ts` and `server-base.ts` are read, then the root cause under Design Notes holds (variable `MCP_TRANSPORT`, flags `--transport <v>` and `--transport=<v>`, with the anchors), and the implement stage re-confirms it under Auto Run Result before editing.
- AC-2 (38.1.2): Given any configured transport value other than `stdio`, when a server starts, then `resolveTransport()` throws the exact matrix text before `start()` runs, and the entry prints `Fatal: Error: <text>` and exits 1 with no IRIS connection; and `start()` has no HTTP branch and accepts only `"stdio"`.
- AC-3 (38.1.3): Given no transport configured, or `stdio` in any form, when `start(resolveTransport())` runs, then the fetch sequence and stderr lines equal the baseline capture (`toEqual`), and the 38 `stageDefaultStartup` files pass with no diff against `3cf6df7`.
- AC-4 (38.1.4): Given each built server entry, when it is launched with `MCP_TRANSPORT=http`, `--transport http`, `--transport=http` or `MCP_TRANSPORT=websocket`, then it exits 1 with the exact `Fatal:` message and the listener counts 0 connections, while the no-transport control connects; and restoring the baseline `resolveTransport` turns every rejection case red.
- AC-5 (38.1.5): Given the built `iris-dev-mcp` dist, a fresh Node process, `IRIS_HOST=127.0.0.1` and `IRIS_PORT=9`, when it is launched with `MCP_TRANSPORT=http` and again with `--transport http`, then each exits 1 with the message and logs no `IRIS health check` line (on this host any connection attempt to `:9` logs one, per the baseline capture).
- AC-6 (38.1.6): Given the Design Notes verdict table, when the docs are edited, then every row is applied and the doc-claims case passes; `CHANGELOG.md` and the changeset exist; and the ledger shows a `decision-pending owner=burndown` entry whose note starts `human=` and names the auth design.
- AC-7 (38.1.7): Given the finished tree, when the gates run, then every per-package build, test, lint and type-check passes, governance `:check` exits 0 at `1e62c5ad5bf7`/141, tool counts are unchanged, and `bootstrap-classes.ts` has no diff.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass
- verdicts: 23 findings — high 0, medium 4, low 15, false 4, maybe-false 0
- findings:
  - `[low]` `patch` (blind-hunter) `transport.test.ts` `afterEach` asserted the three writes-nothing spies before restoring argv, the environment and the mocks — verified at the hook: a failing assertion throws before the restore, so the next test starts with a mutated argv and live spies and fails with wrong attribution. Fixed: the hook counts the writes, restores, then asserts one `writes` object.
  - `[medium]` `patch` (blind-hunter) The AC-3 pin in `server-base.test.ts` depends on ambient `LOG_LEVEL` and `IRIS_*` — verified live: with `LOG_LEVEL=WARN` the pin is red (`expected [] to deeply equal [ ...(6) ]`) and seven pre-existing logger-level tests are red with it. Fixed: `env: { LOG_LEVEL: "DEBUG" }` in `packages/shared/vitest.config.ts`, and the case clears and restores every `IRIS_*` variable; green under `LOG_LEVEL=WARN` (1380/1380) and under hostile `IRIS_*`.
  - `[low]` `patch` (blind-hunter) The `start()` JSDoc kept "with the specified transport" and the new `@param` said "step 5" while the JSDoc's own list numbers the transport step 6 — verified at `server-base.ts:1930-1962`. Fixed: summary line and `@param` reworded without a step number.
  - `[low]` `patch` (blind-hunter) The CHANGELOG and changeset said `start()` "accepts only `"stdio"`", which holds only at compile time — verified: the body ignores `_transport`. The runtime guard is forbidden by the spec's Never list (Rule #54), so only the wording is fixed: both now say the parameter type is narrowed to `"stdio"`.
  - `[low]` `patch` (blind-hunter) The gate kept its own hand-written server roster although `scripts/lib/tool-catalog.mjs` exports `SERVER_PACKAGES` (Rule #45) — verified. A sixth server would be silently uncovered. Fixed: directories come from `SERVER_PACKAGES`, names from each `package.json`, and a roster case asserts the five known servers.
  - `[low]` `patch` (blind-hunter) The doc-claims scan was a hand-listed set of 8 docs (Rule #56) — verified: it omitted `packages/iris-mcp-all/README.md`, `packages/client-config/README.md`, `tool_support.md` and `docs/*.md`, none of which matches the three patterns today. Fixed: root `README.md`, `tool_support.md`, every `packages/*/README.md`, `docs/*.md` and `docs/client-config/*.md` are enumerated mechanically (23 docs).
  - `[low]` `patch` (edge-case-hunter) `process-gate-helpers.ts` resolved on the child's `exit` event, which can fire before the stderr pipe is drained, so the positive `Fatal:` and `Connected` assertions could flake — verified against Node's `exit` versus `close` semantics. Fixed: it resolves on `close`; the four process gates stay green. All three old gate copies had the same shape.
  - `[medium]` `patch` (edge-case-hunter) Same root cause as the ambient `LOG_LEVEL` / `IRIS_*` finding above: the pin depends on environment it did not create — verified by the same live `LOG_LEVEL=WARN` run. Fixed by the same patch.
  - `[low]` `patch` (edge-case-hunter) Same root cause as the `afterEach` ordering finding above — verified at the same hook. Fixed by the same patch.
  - `[low]` `reject` (edge-case-hunter) The doc scan misses a reversed "Streamable HTTP or stdio" order, a JSON env form and extra spacing — the three patterns are the spec's own (Tasks, doc-claims case), no doc matches any such phrasing today (`git grep`), and the file-roster half is closed by the roster patch above. Not worth more patterns.
  - `[low]` `reject` (edge-case-hunter) `mkdtempSync` runs after the listener starts and outside the `try`, so a throw would leak the listener — real only if the OS temp directory is unwritable, and the fix adds a conditional in `finally`; not met in everyday use.
  - `[low]` `reject` (edge-case-hunter) `start(_transport)` ignores its argument, so a JS or cast caller passing `"http"` silently gets stdio — real, but the spec's Never list forbids a runtime guard (Rule #54: `resolveTransport()` is the single producer); fixing it would alter specified behavior. The wording half is closed above.
  - `[medium]` `patch` (verification-gap) The AC-3 pin goes red under an ambient `LOG_LEVEL` — pre-verified by the layer (ran `LOG_LEVEL=WARN`), reproduced here. Same root cause and fix as the first `medium` row.
  - `[medium]` `patch` (verification-gap) The doc-claims coverage assertion `expect(DOCS.length).toBe(1 + SERVER_READMES.length + CLIENT_CONFIG_DOCS.length)` is true by construction (Rule 19) — pre-verified. Fixed: it is replaced by an `arrayContaining` over an independently listed set of 14 known docs; mutation (skip `cursor.md`) turns exactly that case red.
  - `[low]` `reject` (verification-gap) No `mutation:` line covers the four `index.test.ts` blocks or the README env-row case — Rule 19 asks one demonstrated mutation per AC, not per assertion; AC-2 and AC-6 each have one, and the index blocks are shared-surface updates rather than an AC's pinning test.
  - `[low]` `reject` (verification-gap) The four `index.test.ts` blocks import the built `@iris-mcp/shared` dist, so they go red until shared is rebuilt — a pre-existing pattern those files already had, the `(loop)` order builds shared first, and a stale dist fails loudly rather than passing wrongly.
  - `[low]` `patch` (verification-gap) The doc-scan roster is hand-listed (Rule #56) — same root cause and fix as the roster finding above.
  - `[low]` `reject` (verification-gap) Gate setup order, `mkdtempSync` outside the `try` — the same claim as the edge-case row above, rejected for the same reason.
  - `[low]` `reject` (intent-alignment) Stdout silence is observed only in-process; the process gate pipes stdout to `ignore` — the helper's stdio is spec-pinned, `transport.test.ts` spies `process.stdout.write`, and a live capture of the rejected dev entry showed 0 stdout bytes on both AC-5 forms.
  - `[false]` `reject` (intent-alignment) Startup byte-identity is pinned in-process for five forms, while the process gate launches only the no-transport control — AC-3 names this surface and plan-time interpretation 6 records it; the 38 `stageDefaultStartup` files (no diff against `3cf6df7`) are the wider net. No bad outcome.
  - `[false]` `reject` (intent-alignment) A rejected process still constructs `McpServerBase` and logs `Tool visibility` before `Fatal:` — the spec states "Construction stays first" and that it makes no network call; the gate's listener counted 0 connections and no `IRIS health check` line appeared.
  - `[false]` `reject` (intent-alignment) A bad transport now surfaces before `start()` step-1 configuration errors — this is AD-23 and the intent ("evaluated before `server.start()` runs"), not a defect.
  - `[false]` `reject` (intent-alignment) Edits beyond the listed boundaries (Gap 1 and http-case deletions, helper extraction, the DW entry) — each is a named task in the spec's Execution list.

## Design Notes

**Governing architecture decisions:**
- AD-23: stdio only; rejection in `resolveTransport` before IRIS traffic; HTTP only with an auth, bind-address and session design.
- AD-8: invalid configuration fails fast naming the variable; an unreachable instance never exits the process.
- AD-15: the transport rejection is a sanctioned change (S-2), and unset or `stdio` startup is pinned mechanically.
- AD-2: the cross-package gate lives in `iris-mcp-all` and reads built dists.
- AD-4, AD-5 and AD-10: no key; the baseline stays frozen; counts are unchanged.
- AD-14: no bootstrap change.
- AD-29: patch/minor changesets only.
- Conventions: Error text; Logging (stderr only); Configuration variables (`MCP_TRANSPORT` is grandfathered without the `IRIS_` prefix); Live testing on a shared instance (no IRIS traffic, only a closed port and a local listener).

**Root cause (AC-1).**
- **Read at plan time from `3cf6df7`.** `transport.ts:9-34` returns `http` from `MCP_TRANSPORT` (:25-26) and from `--transport http` / `--transport=http` (:14-21). `start()` (`server-base.ts:1962`) runs the following before the step-5 `else` (:2170-2180) throws `HTTP transport not yet implemented`:
  - `loadConfig`;
  - the governance, preset and audit parses;
  - the `default` health check;
  - version negotiation and bootstrap.
- **Live baseline capture on 2026-10-15** (dist built at `3cf6df7`): `env -i PATH HOME MCP_TRANSPORT=http IRIS_HOST=127.0.0.1 IRIS_PORT=9 IRIS_USERNAME=probe IRIS_PASSWORD=probe node packages/iris-dev-mcp/dist/index.js </dev/null`.
  - It logged `[ERROR] IRIS health check failed: Failed to connect to IRIS at 127.0.0.1:9...` (the connection attempt) and the continuation lines.
  - Then it logged `Fatal: Error: HTTP transport not yet implemented`, exit 1.
  - With `MCP_TRANSPORT=websocket`, it logged `Warning: unrecognised MCP_TRANSPORT "websocket", falling back to stdio`, then the same health-check lines, then `Connected via stdio transport`, exit 0 (stdin at EOF).

**Plan-time interpretations (apply-and-report, Rule 5).**
1. **Every configured value is checked.** AC 38.1.2 says "any value other than `stdio`". So a flag no longer hides a bad `MCP_TRANSPORT`, and every `--transport` occurrence counts.
2. **Empty values.**
   - An empty `MCP_TRANSPORT` means "not configured". This is the codebase convention: empty `IRIS_GOVERNANCE` and `IRIS_GOVERNANCE_PRESET` mean unset, and today's code treats it the same way.
   - A `--transport` flag with no value is present but malformed, so it is rejected with `""`.
3. **The match is exact and case-sensitive.** `STDIO` is rejected (today it fell back with a warning).
4. **How the process exits.** `resolveTransport()` throws, the same as `loadConfig`. Each entry point catches the throw in its existing `Fatal:` handler through a top-level `await` (`module` is `Node16`, `type: module`, target `ES2022`), so the process exits 1 like every other configuration error. Today a top-level throw would escape that handler.
5. **Where AC 38.1.4's "message, exit, and no fetch" is pinned.** Exit and network activity are observable only at the process. They are pinned by the default-suite gate that launches each built `index.js`, which is the real entry path (Rule #59, Rule 3). `transport.test.ts` pins the pure contract. A fetch spy around a pure function would be structurally unfalsifiable (Rule 19).
6. **The AC-3 pin omits bootstrap.** It uses the harness's no-bootstrap server. Bootstrap runs downstream of, and independently of, transport resolution, and the 38 `stageDefaultStartup` files remain the wider net.
7. **AC 38.1.5's "opens no connection".** Nothing listens on port 9, so the check is that no `IRIS health check` line appears. The gate's listener counter is the direct observation.
8. **Two tests are deleted.** `server-base.test.ts:596-623` and outage-coverage Gap 1 exist only to drive the removed branch.

**Integration ACs and linkage.**
- `resolveTransport()` has a changed contract. Consumed-by: the five `index.ts` entry points, exercised through their built bins by AC-4.
- `process-gate-helpers.ts` (new, test-only). Consumed-by: `transport-rejection-gate`, `host-guard-process-gate`, `governance-file-process-gate` and `server-manager-precedence-gate`. Consumes: none.

**Extend, don't copy (Rule 2).**
- `spawnAndWaitForExit` is extracted from its three identical copies, and all three callers move to it.
- The AC-3 pin extends `server-base.test.ts`'s `start()` harness.
- The gate calls the shared `checkDistFresh` directly. It does not copy epic37's `staleDistReason` wrapper.

**Docs verdicts (Rule #56).** These are exhaustive as of 2026-10-15. The source is `git grep -n -i -E "streamable|--transport|MCP_TRANSPORT|http transport|transport http|stdio/http|stdio or http" -- . ':(exclude)_bmad-output/**' ':(exclude)_bmad/**' ':(exclude).claude/**'` plus a scan of every `IRIS_NAMESPACE` env table.

| Mention | Verdict |
|---|---|
| `README.md:698` "stdio or Streamable HTTP" | rewrite: stdio only |
| `README.md:541` fail-fast list; `:71-90` env table | extend: add a transport bullet; add the `MCP_TRANSPORT` row |
| `packages/shared/README.md:29`, `:39`, `:150` | rewrite: stdio only |
| `packages/iris-data-mcp/src/tools/debug.ts:8` "stdio/HTTP transports" | rewrite |
| `transport.ts`; `server-base.ts:323,1960,2171-2179` | rewritten by the code tasks |
| `README.md:755`, `CHANGELOG.md:333`, `.changeset/execute-response-ceiling-and-gate-hardening.md:16`, `packages/iris-dev-mcp/README.md:1037`, `bootstrap-classes.ts:241`, `Utils.cls:207` "CSP Gateway/HTTP transport" | keep: these describe IRIS web-gateway HTTP, not the MCP transport |
| `packages/iris-admin-mcp/README.md:216`, `tool_support.md:110` "client transport limit"; `packages/iris-dev-mcp/README.md:1073`, `README.md:785` | keep: generic transport wording |
| The five server READMEs, `packages/iris-mcp-all/README.md`, `docs/client-config/{README,claude-code,claude-desktop,cursor}.md` | no MCP-transport mention; their env tables list connection variables only, so they are unchanged |
| `_bmad-output/**` planning and historical artifacts | keep: PRD FR7 and architecture N1 already say stdio only; specs are records |

**Ledger inbox:** none was routed to this story. It files one entry itself (AC-6), and the implement stage writes it at the lead's instruction.

**Lead notes (Rule 20).** After this story lands, the third Rule bullet of AD-23 ("Until Story 38.1 lands, ...") is history. The spine's `## Deferred` bullet "Streamable HTTP transport" should carry the new DW id, because it is a decision-pending entry with architectural weight. No orchestrator decision is needed.

## Verification

Every command runs in the foreground with `timeout: 600000` from `/Users/jbrandt/git/iris-execute-mcp-v2`. No new test or check calls IRIS, and no IRIS fixture is created. The shared instance (`localhost:52773`, `HSCUSTOM`) is reached only by the pre-existing live legs inside the migrated gates and the full suites, which are read-only or governance-denied. The new child processes target a local listener or the closed port 9. No `ExecuteMCPv2.Temp.*` fixture is needed, and no OS %UnitTest class runs, because no ObjectScript changes.

**Shared surfaces:** these are the surfaces this story changes that other tests assert on.
- The `resolveTransport()` contract and the `McpServerBase.start()` parameter type: `transport.test.ts`, `server-base.test.ts`, `server-base-default-outage-coverage.test.ts`, and the four `index.test.ts` `resolveTransport()` blocks. The 38 `stageDefaultStartup` files call `start("stdio")` and stay unmodified.
- `spawnAndWaitForExit`, in the three migrated gates.
- The root `CHANGELOG.md` top section. `story-38-0-qa-doc-claims.test.ts` locates its section by a Story 38.0 regex, so a new section above it is safe.
- The `README.md` env table and line 698, which are read by the `docs-*-sync` tests.

Standing criterion: every test added or changed passes on a fresh environment, in either order.

**Commands:**
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/transport.test.ts src/__tests__/server-base.test.ts src/__tests__/server-base-default-outage-coverage.test.ts` -- expected: all pass.
- `(loop)` `pnpm --filter @iris-mcp/admin exec vitest run src/__tests__/index.test.ts && pnpm --filter @iris-mcp/ops exec vitest run src/__tests__/index.test.ts && pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/index.test.ts && pnpm --filter @iris-mcp/data exec vitest run src/__tests__/index.test.ts` -- expected: all pass.
- `(loop)` `pnpm --filter @iris-mcp/dev build && pnpm --filter @iris-mcp/admin build && pnpm --filter @iris-mcp/interop build && pnpm --filter @iris-mcp/ops build && pnpm --filter @iris-mcp/data build && pnpm --filter @iris-mcp/all exec vitest run src/__tests__/transport-rejection-gate.test.ts src/__tests__/host-guard-process-gate.test.ts src/__tests__/governance-file-process-gate.test.ts src/__tests__/server-manager-precedence-gate.test.ts` -- expected: all pass (the pre-existing live legs may skip with a stated reason).
- `(once)` AC-5: `perl -e 'alarm 30; exec @ARGV' -- env -i PATH="$PATH" HOME="$HOME" MCP_TRANSPORT=http IRIS_HOST=127.0.0.1 IRIS_PORT=9 IRIS_USERNAME=probe IRIS_PASSWORD=probe node packages/iris-dev-mcp/dist/index.js </dev/null; echo "exit=$?"`, then again with `MCP_TRANSPORT` removed and `--transport http` appended -- expected: `Fatal: Error: Unsupported transport "http" from MCP_TRANSPORT: ...` (or `from --transport`), no `IRIS health check` line, `exit=1`. Record both outputs under Auto Run Result.
- `(once)` For each package, one command per package: `pnpm --filter @iris-mcp/<pkg> build`, then `test`, `lint` and `type-check` where defined. The packages are shared, dev, admin, interop, ops, data and client-config, followed by `pnpm --filter @iris-mcp/all test` -- expected: green. This is the per-package substitute for the flaky parallel turbo run (35-1-DEV-1).
- `(once)` `pnpm gen:governance-baseline:check` -- expected: exit 0 at `1e62c5ad5bf7`/141.
- `(once)` `git diff --stat 3cf6df72999b129b7eda27e91983d1a7e8261a36 -- packages/shared/src/bootstrap-classes.ts src/` -- expected: empty. Also `git diff --quiet 3cf6df72999b129b7eda27e91983d1a7e8261a36 -- $(git grep -l stageDefaultStartup -- 'packages/*/src/__tests__/*.ts')` -- expected: exit 0 over 38 files.
- `(once)` the docs-verdict `git grep` above -- expected: only the rows marked `keep` remain. Also `bash _bmad/scripts/ledger.sh _bmad-output/implementation-artifacts/deferred-work.md show DW-<n>` -- expected: `status=decision-pending owner=burndown by=implement note=human=...`.

**Planned mutations (Rule 19; record each as `mutation: ... -> ...` here when it is run).** Revert each mutation, rebuild any dist it touched, and confirm that `git status --short` and `git diff --stat` are unchanged.

| AC | Mutation | Expected red |
|---|---|---|
| AC-2 | `resolveTransport` returns `"stdio"` for `http` instead of throwing | the `transport.test` http cases |
| AC-2 | dev `index.ts` calls `resolveTransport()` at the top level outside the `try` (the baseline shape); rebuild dev | the gate's dev cases (no `Fatal:` prefix) |
| AC-3 | `resolveTransport` writes `console.error("[INFO] transport stdio")` on the stdio path | the back-compat pin's stderr `toEqual` |
| AC-4 | the body of `resolveTransport` replaced by the baseline body from `git show 3cf6df7:packages/shared/src/transport.ts` (accept `http`; warn and fall back on an unknown value), returned `as "stdio"` so that shared, whose build also compiles `src/__tests__`, stays type-clean; rebuild shared only (the path the gate guards, Rule #59) | all five packages' rejection cases (exit code, message and connection count) |
| AC-6 | restore the `README.md:698` sentence | the doc-claims case |

AC-1 is a recorded reading, AC-5 is a recorded live run, and AC-7 is a roll-up of gate commands. None of the three has its own mutation.

Mutations run on 2026-10-15 (each applied, observed red, reverted; the sha256 of every changed file and `git status --short` / `git diff --stat` were byte-identical to a pre-mutation snapshot afterwards, and the touched dists were rebuilt):
- mutation: `resolveTransport` lets `"http"` through on both channels (`value !== "stdio" && value !== "http"`, and the same for `MCP_TRANSPORT`) -> `transport.test.ts` red, 7 of 23 cases (`MCP_TRANSPORT=http`, `--transport http`, `--transport=http`, and the four both-channel cases that carry http); reverted, 23 of 23 green.
- mutation: dev `index.ts` restored to the baseline shape (`const transport = resolveTransport();` at the top level, outside the `try`, then `server.start(transport).catch(...)`); dev rebuilt -> `transport-rejection-gate` red for `@iris-mcp/dev` only (`MCP_TRANSPORT=http`: stderr lacks `Fatal: Error: Unsupported transport "http" ...`), the other four packages stayed green; reverted, dev rebuilt, 18 of 18 green.
- mutation: `resolveTransport` writes `console.error("[INFO] transport stdio")` on the stdio path -> the `server-base.test.ts` back-compat case red (`stderr lines for unset: expected [ '[INFO] transport stdio', ...(6) ] to deeply equal [ ...(6) ]`); reverted.
- mutation: the whole `resolveTransport` body replaced by the baseline body from `git show 3cf6df7:packages/shared/src/transport.ts` (accepts `http`, warns and falls back on an unknown value), returned `as "stdio"`; shared rebuilt in that state, no server package rebuilt -> `transport-rejection-gate` red for all 5 packages (the first failing assertion per package is the exit code of `MCP_TRANSPORT=http`: the process started and ended with its stdin at EOF instead of exiting 1 with the message); reverted, shared rebuilt, 18 of 18 green.
- mutation: the `README.md` stdio-only sentence (line 699) restored to the baseline wording "using either **stdio** or **Streamable HTTP** transport" -> the doc-claims case `README.md offers no HTTP transport` red (`README.md contains a stdio-or-Streamable-HTTP claim`); reverted.

Mutations and perturbations run in the review pass on 2026-10-15, for the tests the review patches touched (each reverted; `shasum -a 256` of the two mutated files, `git status --short` and `git diff --stat` were identical to the pre-mutation snapshot; shared dist rebuilt and its mtime refreshed afterwards):
- mutation: `resolveTransport` writes `console.error("MUTATION stray write")` as its first statement -> `transport.test.ts` red, 23 of 23 cases, each on the `afterEach` writes-nothing assertion (`expected { error: 1, ... } to deeply equal { error: 0, ... }`); reverted. This pins the `afterEach` that now restores argv, the environment and the spies before it asserts.
- mutation: the new gate's server roster drops `iris-data-mcp` (`SERVER_PACKAGE_DIRS.filter((dir) => dir !== "iris-data-mcp")`) -> `transport-rejection-gate` red on `the gate covers all five servers` only (1 failed, 29 passed); reverted. During the run, editing shared `src/` made the gate fail for the whole file with `@iris-mcp/shared's src/ has been modified more recently than its dist/`, which is the stale-dist FAIL (never skip) behaving as specified.
- mutation: the gate's `markdownIn` skips `cursor.md` -> `transport-rejection-gate` red on `the scan covers the docs a reader configures a server from` only (1 failed, 29 passed); reverted. It replaces a length assertion that was true by construction.
- perturbation (AC-3 pin hermeticity): before the patch, `LOG_LEVEL=WARN pnpm --filter @iris-mcp/shared exec vitest run` was red on the back-compat pin (`stderr lines for unset: expected [] to deeply equal [ ...(6) ]`) plus seven pre-existing logger-level tests (8 failed of 1380). After the patch (`env: { LOG_LEVEL: "DEBUG" }` in `packages/shared/vitest.config.ts`, and the case clearing and restoring every `IRIS_*` variable), the same command is 1380 of 1380 green, and the pin alone passes under `LOG_LEVEL=ERROR IRIS_PROFILES=garbage IRIS_GOVERNANCE_PRESET=bogus IRIS_AUDIT_LOG=/nonexistent/dir/x.log`.
- no mutation line: the `close` (was `exit`) event in `process-gate-helpers.ts` is a stderr-drain race that no deterministic test can force; the four process gates are green on it.

## Auto Run Result

Status: done
Blocking condition: none

Plan pass on 2026-10-15, from baseline `3cf6df72999b129b7eda27e91983d1a7e8261a36`:
- The epic context `epic-38-context.md` was reused, as the lead directed. It is older than the spine's AD-15 amendment, so the governing ADs (AD-2, AD-4, AD-5, AD-8, AD-10, AD-14, AD-15, AD-23, AD-29) were read directly from the spine.
- The previous story's continuity came from `spec-38-0-epic-37-deferred-cleanup.md`, which is done.
- The spec was verified against the READY FOR DEVELOPMENT standard and halted after planning, at the caller's request.

Implement pass on 2026-10-15, `baseline_revision` `e25f1e79b90c286467b0f1e1e12933ed96cfaed4`:
- **AC-1 root-cause re-confirmation (before any edit).** `git diff --stat 3cf6df72999b129b7eda27e91983d1a7e8261a36 HEAD` lists only `cycle-log-epic-38.md`, the story spec and `sprint-status.yaml`, so no source moved since plan time. `packages/shared/src/transport.ts` still returns `http` from `--transport <v>` (requires a truthy next argument; an unknown flag value is skipped), `--transport=<v>` and `MCP_TRANSPORT`; an unknown `MCP_TRANSPORT` value writes `Warning: unrecognised MCP_TRANSPORT ... falling back to stdio` and returns `stdio`. `packages/shared/src/server-base.ts` still declares `start(transport: "stdio" | "http" = "stdio")` (:1962), documents it at :1960, and its step-5 `else` branch (:2170-2180) throws `HTTP transport not yet implemented` only after steps 1-4.5 (config load, parses, health check, negotiation, bootstrap) have run. The class bullet at :323 still says "stdio and HTTP transport setup". The root cause under Design Notes holds.
- **Execution list done** (every item under `## Tasks & Acceptance`), in this order: the AC-3 back-compat case was added to `server-base.test.ts` and run green on the unmodified baseline twice BEFORE any source edit, then the http case was deleted; then `transport.ts`, `server-base.ts`, the five entry points, the rewritten `transport.test.ts`, the four `index.test.ts` blocks, outage-coverage Gap 1 and its header, `process-gate-helpers.ts` with the three migrated gates, the new `transport-rejection-gate.test.ts`, the docs (`README.md`, `packages/shared/README.md`, `debug.ts` comment), `CHANGELOG.md` and `.changeset/story-38-1-reject-http-transport.md`.
- **Ledger (AC 38.1.6):** the one `ledger.sh ... new` command ran once and printed `DW-538`. `ledger.sh ... show DW-538` confirms `status=decision-pending owner=burndown by=implement note=human=decide the auth, bind-address and session design (and the use case) for Streamable HTTP; AD-23`. `DW-538` is named in the CHANGELOG line. Per Design Notes "Lead notes", the spine's `## Deferred` bullet "Streamable HTTP transport" and AD-23's third Rule bullet are the lead's to update; nothing under `_bmad-output/planning-artifacts` was touched.
- **Apply-and-report deviations the lead should know:**
  1. `start(_transport: "stdio" = "stdio")` -- the spec says `start(transport: "stdio" = "stdio")`, but once the dead branch is removed the parameter is unused and `@typescript-eslint/no-unused-vars` fails `pnpm --filter @iris-mcp/shared lint` (allowed unused args must match `/^_/`). The parameter is renamed `_transport` (JSDoc `@param _transport` says why it stays); the positional call shape `start(resolveTransport())` / `start("stdio")` is unchanged, and no runtime guard was added (Rule #54 / the spec's Never list).
  2. The back-compat pin normalizes the wall-clock duration inside two baseline log lines (`[INFO] HEAD /api/atelier/ completed in <N>ms`, `[INFO] GET /api/atelier/ completed in <N>ms`) -- that text varies run to run. No `[DEBUG]` line is logged on this path, so none is excluded. All five inputs produce the identical fetch sequence (`HEAD` then `GET`, both `http://localhost:52773/api/atelier/`) and the identical six stderr lines. The captured arrays are the literals in `server-base.test.ts`, with the capture command in the case's header comment.
  3. `iris-{ops,interop,data}-mcp` `index.test.ts` had no "stdio from `MCP_TRANSPORT`" or "unrecognised value" case; both are added there for parity with admin's block (admin's two existing cases are converted as the spec says).
  4. One in-place string replace on `server-base.test.ts` (filling the captured literals) went through a Python heredoc; `file` reports UTF-8 text, `git diff --stat` showed the intended insertions only, and the case runs green, so Rule #55's verification holds.
- **Verification run in this pass:** the three `(loop)` commands are green at the final tree (shared build + `transport.test.ts` + `server-base.test.ts` + outage-coverage: 86 passed; the four `index.test.ts` files: 15, 15, 16, 16 passed; all six dists rebuilt, then `transport-rejection-gate` 18 passed, `host-guard-process-gate` 4, `governance-file-process-gate` 9, `server-manager-precedence-gate` 5 -- each gate file in its own call, no `[SKIP]` line printed). Also run: the full `@iris-mcp/shared` suite (69 files, 1380 tests passed), `lint` and `type-check` for shared, dev, admin, interop, ops and data (clean; the only message is the pre-existing `cli/governance.ts:909` unused-disable warning), the doc-sync tests in `@iris-mcp/all` (docs-governance-cli-recipes, docs-prompt-sync, docs-visibility-roster-sync, story-38-0-qa-doc-claims, live-gate-roster: 46 passed), `pnpm gen:governance-baseline:check` (OK, 62 post-foundation keys allowed), `git diff --stat 3cf6df7 -- packages/shared/src/bootstrap-classes.ts src/` (empty), and `git diff --quiet 3cf6df7 -- <the 38 stageDefaultStartup files>` (exit 0). The docs-verdict `git grep` now lists only the `keep` rows, the new CHANGELOG/changeset/README text, and tests/source of this story.
- **Not run (the lead's `(once)` items):** the AC-5 live `env -i` runs against `127.0.0.1:9`, the per-package `build`/`test`/`lint`/`type-check` roll-up for admin, interop, ops, data, dev, client-config and `@iris-mcp/all`, and the final `ledger.sh show DW-538` check after any later change. The gate is a default-suite test that depends on a fresh dist: after any further `src/` edit in `shared` or a server package, rebuild that package before running `@iris-mcp/all` tests (a revert that restores byte-identical content leaves tsc emitting nothing, so `touch packages/<pkg>/dist/<file>.js` if `checkDistFresh` still reports stale).
- **Lead verification pass (after the handoff returned; one in-pass patch: the outage-coverage `describe("Gap 2 ...")` title had lost the space before its em dash, restored byte-identical to baseline).** `(loop)` commands re-run green at the final tree (86; 15/15/16/16; gates 18, 4, 9, 5). `(once)` commands:
  - **AC-5 live runs** (fresh `env -i` Node process on the built dev dist, `IRIS_HOST=127.0.0.1 IRIS_PORT=9`, stdin `/dev/null`): `MCP_TRANSPORT=http` printed `[INFO] Tool visibility: preset="full" visible=30 hidden=0` then `Fatal: Error: Unsupported transport "http" from MCP_TRANSPORT: stdio is the only supported transport. Unset MCP_TRANSPORT or set it to "stdio".` and `exit=1`; `--transport http` printed the same Tool visibility line then `Fatal: Error: Unsupported transport "http" from --transport: stdio is the only supported transport. Remove --transport or pass --transport stdio.` and `exit=1`. Neither run logged an `IRIS health check` line.
  - **Per-package roll-up** (build, test, lint, type-check, one package per call): shared 69 files / 1380 tests; dev 46 / 823; admin 35 / 498; interop 22 / 343; ops 20 / 350; data 9 / 165; client-config 21 / 514; `@iris-mcp/all` test 27 files / 239 tests. All green; the only lint message is the pre-existing `cli/governance.ts:909` unused-disable warning.
  - `pnpm gen:governance-baseline:check` exit 0 (141 frozen keys all present, 62 post-foundation keys allowed); `git diff --stat 3cf6df7 -- packages/shared/src/bootstrap-classes.ts src/` empty; `git diff --quiet 3cf6df7` over the 38 `stageDefaultStartup` files exit 0; `BOOTSTRAP_VERSION` `3af8ca401e7c` unchanged.
  - **Docs-verdict `git grep`:** only the `keep` rows (CSP Gateway/HTTP transport wording in `.changeset/execute-response-ceiling-and-gate-hardening.md`, `CHANGELOG.md:356`, `README.md:756`, `packages/iris-dev-mcp/README.md:1037`, `bootstrap-classes.ts:241`, `Utils.cls:207`), this story's own CHANGELOG/README/shared README text, and `transport.ts`/test files remain.
  - **Ledger:** `ledger.sh ... show DW-538` shows `status=decision-pending owner=burndown by=implement note=human=decide the auth, bind-address and session design (and the use case) for Streamable HTTP; AD-23`.
- `BOOTSTRAP_VERSION` is unchanged at `3af8ca401e7c` (`bootstrap-classes.ts` has no diff, no `src/ExecuteMCPv2` change).

Review and finalize pass on 2026-10-15:
- **Summary of the implemented change.** `resolveTransport()` now returns `"stdio"` and throws the exact E or F text for any configured value other than `stdio` (flags first, in argv order, then a non-empty `MCP_TRANSPORT`; exact and case-sensitive; a value-less `--transport` is `""`). All five entry points evaluate it inside their `Fatal:` handler via a top-level `try { await server.start(resolveTransport()) }`, so a rejected process prints `Fatal: Error: <text>` and exits 1 before any IRIS call. `McpServerBase.start()` lost its dead HTTP branch and takes `"stdio"` only (parameter named `_transport`, no runtime guard). Startup with no transport or `stdio` is pinned by a `toEqual` case captured on the unmodified baseline. A default-suite gate launches all five built entries (four rejection forms each, plus a no-transport control that proves the connection counter can see a connection). The docs, CHANGELOG and changeset are corrected, and DW-538 files the real HTTP transport as a human decision.
- **Files changed.**
  - `packages/shared/src/transport.ts`: the new `resolveTransport(): "stdio"` contract.
  - `packages/shared/src/server-base.ts`: HTTP branch removed, `start()` narrowed, JSDoc corrected.
  - `packages/shared/vitest.config.ts`: `env: { LOG_LEVEL: "DEBUG" }` (review patch).
  - `packages/iris-{dev,admin,interop,ops,data}-mcp/src/index.ts`: the top-level `try`/`await` with the existing `Fatal:` handler.
  - `packages/shared/src/__tests__/{transport,server-base,server-base-default-outage-coverage}.test.ts` and `packages/iris-{admin,ops,interop,data}-mcp/src/__tests__/index.test.ts`: the old contract rewritten, the AC-3 pin added, the http case and Gap 1 deleted.
  - `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts` (new), the three migrated process gates, and `transport-rejection-gate.test.ts` (new, 31 cases).
  - `README.md`, `packages/shared/README.md`, `packages/iris-data-mcp/src/tools/debug.ts`, `CHANGELOG.md`, `.changeset/story-38-1-reject-http-transport.md`.
  - `_bmad-output/implementation-artifacts/deferred-work.md` (the DW-538 entry, written through `ledger.sh new`).
- **Review findings breakdown.** 23 findings across the four layers: 8 triaged `patch` (grouped into 8 root causes: 2 medium, 6 low), 0 deferred, 15 rejected. Patches applied: the AC-3 pin made hermetic against ambient `LOG_LEVEL` and `IRIS_*` (medium); the unfalsifiable doc-scan coverage assertion replaced (medium); `afterEach` restore-before-assert; the doc scan enumerated mechanically; the gate roster derived from `SERVER_PACKAGES`; the helper resolving on `close`; the `start()` JSDoc; the CHANGELOG and changeset wording. Rejected, with the reasons recorded row by row in the triage log: the broader doc phrasings (spec-pinned patterns), the `mkdtempSync`-outside-`try` leak (twice), the runtime guard in `start()` (spec Never, Rule #54), the missing mutation lines for the index blocks (one per AC), the index tests' built-dist dependency (pre-existing), the in-process-only stdout and byte-identity pins (spec-pinned surfaces), construction-before-Fatal, ordering against other startup errors, and the named-task scope edits.
- **Follow-up review recommendation: `true`.** Two `medium` entries were patched on this first pass. The specific unverified risk: the patched gate file (a roster derived from `tool-catalog.mjs` plus a 23-doc mechanical scan over `docs/*.md`, `tool_support.md` and `packages/*/README.md`) and the `LOG_LEVEL` pin in the shared vitest config were verified by mutation and by hostile-environment runs, but no independent layer has re-read them. Patched counts by verdict: medium 2, low 6.
- **Verification performed at the final tree.** `(loop)`: shared build and `transport.test.ts` + `server-base.test.ts` + outage-coverage 86 passed; the four `index.test.ts` files 15/15/16/16; all five server dists rebuilt; the four gate files in one call each: `transport-rejection-gate` 31, host-guard 4, governance-file 9, server-manager 5. `(once)` after the last patch: the AC-5 live runs (both `exit=1`, 0 stdout bytes, 0 `IRIS health check` lines); the per-package roll-up with build, test, lint and type-check one package per call (shared 69 files / 1380 tests, dev 823, admin 498, interop 343, ops 350, data 165, client-config 514, all 27 files / 252 tests, all green, only the pre-existing `cli/governance.ts:909` lint warning); `pnpm gen:governance-baseline:check` exit 0 (141 frozen keys present, 62 post-foundation allowed); `git diff --stat 3cf6df7` over `bootstrap-classes.ts` and `src/` empty; `git diff --quiet 3cf6df7` over the 38 `stageDefaultStartup` files exit 0; the docs-verdict `git grep` leaves only the `keep` rows and this story's own text; `ledger.sh show DW-538` is `decision-pending owner=burndown by=implement note=human=...`. Mutation evidence is in `## Verification`.
- **Residual risks.**
  - `start()` ignores its parameter at runtime, so a JS or cast caller passing `"http"` gets stdio silently; this is the spec's decision (Never list) and the CHANGELOG states the narrowing at the type level only.
  - `BOOTSTRAP_VERSION` is unchanged at `3af8ca401e7c`.
  - Spine edits for the lead (Rule 20), not made here: AD-23's third Rule bullet ("Until Story 38.1 lands, ...") is now history, and the spine's `## Deferred` bullet "Streamable HTTP transport" should carry DW-538.
  - The new gate is a default-suite test that FAILS on a stale dist: after any further `src/` edit in `shared` or a server package, rebuild that package first (and `touch` a dist file if tsc emits nothing after a byte-identical revert).
