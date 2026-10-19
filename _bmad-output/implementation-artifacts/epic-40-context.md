# Epic 40 Context: Developer Test Depth

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A developer can measure line-by-line coverage of the classes their tests exercise. Coverage comes as a per-class and per-method summary, and as Cobertura XML with a `minCoverage` verdict. They can also run `%UnitTest.TestProduction` tests without disturbing anything else on a shared instance. This closes competitive gap G23, then G24. The competitor measures `.1` routines only and writes no Cobertura. Story 40.0 first clears the four entries that Epic 39 left in the ledger. This is the last epic of the wave-6 run.

## Stories

- Story 40.0: Epic 39 Deferred Cleanup
- Story 40.1: Line Coverage Probe and Engine
- Story 40.2: Coverage Reports and Targets
- Story 40.3: TestProduction Runs
- Story 40.4: Test Depth Docs, Prompt and Capstone

## Requirements & Constraints

- **Precedence and probing.** The spine binds every story; where a story and the spine disagree, the spine wins and the story is amended in place.
  - Probe each IRIS API and each "reuse X" claim before building on it, and record the earliest version verified. The current version is IRIS 2026.2 build 221U with Atelier v8.
  - `irislib/` holds source for both `%Monitor.System.LineByLine` and `%UnitTest.TestProduction`.
  - The community TestCoverage tool is prior art to evaluate, not to assume. Treat reference code as a functional spec. Any code that is adapted ships with a notice, an adaptation header and a provenance row.
- **Shared instance.**
  - Never stop the instance. Never start a production in HSCUSTOM or read its messages.
  - Coverage oracles come from a disposable namespace whose routines nobody else runs. TestProduction runs are smoked only in a disposable namespace.
  - A disposable namespace is named `EXECMCPTMP<digits><A-Z>`. The story creates it, removes it and asserts nothing is left.
  - Interop comes from mappings only: `Ens`, `EnsLib` and the `Ens*` routines map to ENSLIB. Never call `EnableNamespace`.
  - Story 39.2 started and stopped a synthetic production cleanly in such a namespace (`Story392.Production`). Its teardown asserts that the namespace no longer has a `RunningNamespace` entry.
  - Every call names `server:"default"`, and every fixture is synthetic.
- **Scope.**
  - Coverage covers only the routines of the selected classes, and every INT routine (`.1` … `.N`) generated for a class.
  - Out of scope: performance profiling and G25 (INT-offset mapping as a standalone tool).
  - A `minCoverage` verdict never turns a completed test run into a tool error.
- **Burn-down bar (40.0).**
  - Prove each fix live, or by mutation (revert → red → restore). Pin each value against a live oracle.
  - Behavior changes are sanctioned AD-15 changes and are named in `CHANGELOG.md`. Everything else stays byte-identical.
- **Current counts** (read from source):
  - dev has 31 package tools and 32 advertised;
  - dev `core` has 14 package tools, which is 15 at runtime, and `developer` has 31;
  - the suite has 109 package tools, 114 advertised, and 13 prompts;
  - the governance baseline is `1e62c5ad5bf7`/141, checked with `:check` only;
  - `BOOTSTRAP_VERSION` is `7d12cd8b3a1e`, over 32 classes.
- **Performance budgets.** Reads stay under 2 s, compile and deploy under 10 s, and bootstrap under 60 s. A story that adds a bootstrapped class checks the bootstrap budget.

## Technical Decisions

- **Monitor ownership (AD-27).**
  - One IRIS-side job owns the LineByLine session: it starts the monitor, runs the tests and stops the monitor in its own cleanup. A client budget, a poll or a cancel never starts or stops the monitor directly; a cancel only signals the job.
  - The owner record (job id and start time) is durable. A later run may reclaim a suite-owned session whose job is dead. A session with no suite record is refused and left untouched.
  - The busy check is atomic and runs IRIS-side. Thresholds, aggregation and verdicts live in TypeScript (AD-12).
  - The TestProduction guard refuses a run while a production other than the test's own is running in the namespace. The refusal names that production.
- **Execution path (AC 40.1.2).**
  - Coverage needs a job the suite controls. The Atelier work queue that `iris_execute_tests` uses today is not such a job.
  - The candidate is the custom `POST /tests` route (`ExecuteMCPv2.REST.UnitTest:RunTests`). No TypeScript code calls it today; this was checked.
  - DW-453 (the I/O-redirect mnemonic is bound on `$IO`, `UnitTest.cls:80-96`) is fixed there if that route is chosen. Otherwise it is closed with evidence.
  - Custom routes are additive-only (AD-33): an existing route accepts every older request, returns a superset, and a pin proves both.
- **Governance (AD-4, AC 40.1.3).**
  - Coverage adds an instance-wide monitor and a local file write, so it is a new operation. The default is a new governed tool, `mutates:"write"` and default-disabled, paired with `iris_test_status`.
  - Making coverage an option on `iris_execute_tests` needs a recorded Lead decision. For this unattended run that decision is delegated to the orchestrator; record it in `orchestrator-decisions-wave-6.md`.
  - `iris_execute_tests` is a frozen-baseline key, classified `write`. Never add an `action` enum to it.
  - A new tool needs four things in the same story:
    - all four annotation hints, declared truthfully;
    - an include or exclude row in every preset (AD-7: when in doubt, exclude it from `core`; a pairing that moves a `core` row needs the Lead);
    - its row in `packages/iris-mcp-all/src/__tests__/data-policy-scope.ts`, where both test tools are `residual`;
    - a `tools-list` snapshot regenerated with `pnpm gen:tools-list-snapshot --force`, a CHANGELOG line (decision #29), and README payload rows equal to `measure:tools-payload`.
- **Asynchronous jobs (AD-16).**
  - When the budget expires, the tool returns `isError:false` with `status:"running"`, durable handles and partials labelled as partial.
  - The companion reproduces every completed result from the durable handles alone.
  - A companion that writes a file takes an explicit `outputPath`.
  - Cobertura output reuses `iris_doc_export`'s path-traversal guard. In `packages/iris-dev-mcp/src/tools/export.ts` it is two private helpers, `validateDestinationDir` and `assertInsideRoot`.
- **What exists to build on.**
  - `packages/iris-dev-mcp/src/tools/execute.ts`:
    - `executeTestsTool` and `createExecuteTestsHandler`, on the Atelier `/work` queue;
    - the one shared `testRunEnvelope` builder.
  - `packages/iris-dev-mcp/src/tools/test-status.ts`, which holds `testStatusTool`:
    - `poll` is a read and `cancel` is a default-disabled write;
    - the queue is instance-wide and is consumed by a terminal poll;
    - `%UnitTest_Result` is per-namespace and keyed by `InstanceIndex`.
  - Existing gates: in dev, `execute-tests-running-contract-epic-gate.test.ts` and `test-status-epic-gate.test.ts`; in `@iris-mcp/all`, `test-status-governance-keys.test.ts`.
- **AC 40.4.3 / DW-498.**
  - Every `iris_test_status` path already builds through `testRunEnvelope`, which sets `structuredContent`. Verify the research's claim before "fixing" it.
  - `iris_execute_tests` declares `readOnlyHint:true` and `idempotentHint:true`. Correcting them is a sanctioned AD-15 change, and the divergence pin in `baseline-classifications-safety.test.ts` moves with it.
- **Refusals.**
  - Every refusal code comes from `REFUSAL_CODES` in `packages/shared/src/refusals.ts`, through `refusalResult(code, text, fields)`. There are 8 codes today, including `DATA_POLICY_BLOCKED`.
  - New busy codes are added to that catalog, never written inline.
  - A refusal is `isError:true`, changes nothing, and carries the fields a caller needs to act on it. Verdicts and `notApplicable` are successes.
- **Bootstrap (AD-14).**
  - A new endpoint class joins `scripts/gen-bootstrap.mjs` `classes[]`, with `REST/Dispatch` staying last, and the `bootstrap.test.ts` roster. Fixture and test classes stay out.
  - Run `pnpm gen:bootstrap` in the same story and record `7d12cd8b3a1e` → new.
  - 40.0's fixes to `REST/Monitor.cls`, `REST/Interop.cls` or `Diagram/*.cls` are also changes to bootstrapped classes.
- **Live gates.**
  - A gate is armed by `IRIS_REQUIRE_LIVE` and listed in its package's `scripts/prepublish-gate.mjs` `gateTestFiles`; `live-gate-roster.test.ts` enforces this.
  - Helpers come from `process-gate-helpers.ts`, including `assertDeployedBootstrapVersion`, and copies fail. Interop fixtures extend `interop-namespace-fixture.ts`. Rebuild the dists first.
  - `@iris-mcp/all` runs serially (`fileParallelism:false`), while dev's gates run in parallel. Two gates that each start a LineByLine session must never overlap.
  - IRIS-side tests use `^UnitTestRoot` and `/noload/nodelete`. Run one class per call and compare `total`.
- **Story 40.0 sites.**
  - DW-584 is `iris_metrics_interop` `errorCount24h` (`Monitor.cls` ~579). It uses `Type = 3`, which is Warning, while Error is 2. It also uses a local `$Horolog - 1` cutoff against the UTC `TimeLogged`.
  - DW-585 is `iris_production_logs` `type`, in `Interop.cls` `EventLog`. The display name is bound against an integer `Type`.
  - DW-586 is `Diagram/Generate.cls:258` `Generation failed for session N: <text>`. Story 39.7 withholds diagram and log text in TypeScript (`diagram.ts`, `monitor.ts`) under `block` only, with fixed reasons that carry no input. The other policies stay byte-identical.
  - DW-587 (decision #36) is `packages/iris-interop-mcp/src/prompts/traceMessageFlow.ts`:
    - steps 4–6 get step 3's rule: report the withheld reason and never read the text another way;
    - then regenerate `skills/trace-message-flow/SKILL.md` and run `gen:skills:check` and `validate:prompts`;
    - prompt pins (`prompt-safety-invariants.test.ts`, `docs-prompt-sync.test.ts`) may move.
- **PHI policy state.**
  - `dataPolicy` is `block`, `redact` or `allow`, per profile, with `redact` the default.
  - It governs the resend preview, `iris_message_search` and `iris_message_body`.
  - Since 39.7 it also governs Event Log `Text` and the Correlator `Error on message …` texts, under `block` only.
  - A withheld value is a per-item field inside a successful read. Shared reasons live in `BLOCK_REASONS`, in `packages/shared/src/data-policy.ts`.

## UX & Interaction Patterns

- **Tool descriptions.** A description leads with what the tool does, when to use it and what it returns. It states each governed write's default state, the enable recipe and the operator controls, and never names a REST path.
- **Docs.** Docs record each default at the point of use: the per-server README, `tool_support.md`, `CHANGELOG.md` and a changeset.
- **Results.** Coverage results go in `structuredContent` plus a compact text form.
- **Agent content.** Prompt and skill text never carries internal rule numbers or repository paths, and this is checked mechanically. Every `iris_*` token in it must name a real tool.

## Cross-Story Dependencies

- **40.0 stands alone.** It touches ops, interop, the IRIS-side Monitor, Interop and Diagram classes, and the interop prompt.
- **40.1 → 40.2 is a planned seam.**
  - 40.1 ships per-routine INT-line coverage with the complete response shape.
  - 40.2 owns the mapping to class source (verified on fixtures with generated methods, macros, embedded SQL and multi-line statements), aggregation, Cobertura (validated against the DTD) and targets. It does not reopen 40.1.
- **40.3 shares the busy-guard pattern** and the refusal catalog. It first probes whether `iris_execute_tests` already runs TestProduction subclasses.
- **40.4 builds on 40.1–40.3.**
  - It adds docs and DW-498.
  - It adds an optional coverage step to the `deploy-and-test-class` prompt (`deployAndTestClass.ts`). That prompt already copes with a hidden `iris_test_status`, and the coverage step must equally cope with a hidden or disabled coverage tool.
  - Its capstone runs in `@iris-mcp/all`'s default suite and is listed in the roster: a fixture yields the expected summary and a valid Cobertura file, and a pre-started session is refused. It is proven red by removing the guard.
