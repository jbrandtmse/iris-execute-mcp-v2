---
title: 'Story 38.1: Reject the Unimplemented HTTP Transport'
type: 'bugfix'
created: '2026-10-15'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
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

## Auto Run Result

Status: ready-for-dev
Blocking condition: none

Plan pass on 2026-10-15, from baseline `3cf6df72999b129b7eda27e91983d1a7e8261a36`:
- The epic context `epic-38-context.md` was reused, as the lead directed. It is older than the spine's AD-15 amendment, so the governing ADs (AD-2, AD-4, AD-5, AD-8, AD-10, AD-14, AD-15, AD-23, AD-29) were read directly from the spine.
- The previous story's continuity came from `spec-38-0-epic-37-deferred-cleanup.md`, which is done.
- The spec was verified against the READY FOR DEVELOPMENT standard and halted after planning, at the caller's request.
