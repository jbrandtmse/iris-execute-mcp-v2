# Story 32.0: `IRIS_GOVERNANCE_FILE` Loader (shared)

Status: done

## Story

As an operator running the iris-mcp suite under multiple MCP clients,
I want governance policy to load from a JSON file referenced by `IRIS_GOVERNANCE_FILE`,
so that one policy is portable across every client (any client can pass a plain env string) while the servers remain the sole enforcement authority.

## Acceptance Criteria

1. **AC 32.0.1** — Unset var ⇒ mechanically-proven no-op (Rule #19: existing governance test matrix re-run deep-equal under unset-file config). **Scope of that deep-equal (clarified 2026-07-26): it compares the effective POLICY RESOLUTION — the per-key enabled/disabled map and the denial attribution — NOT the serialized report object.** AC 32.0.3's `configSource` is an ADDITIVE report field emitted unconditionally (with no file set it reports `env`/`preset`/`default`), so a literal deep-equal over the raw report would fail by design; assert over resolved policy instead. Set but missing/unreadable/malformed file ⇒ startup fail-fast naming path, var, and parse error (never silently permissive); valid file parsed by the SAME `parseGovernanceConfig` validation (reserved-key rejection included).
2. **AC 32.0.2** — Per-key cascade with **ALL env layers above ALL file layers** — ordering fixed 2026-07-26 by Project Lead decision on back-compat grounds: no pre-existing `IRIS_GOVERNANCE` setting may be overridden by a governance file introduced later.
   ```
   profile.env ?? global.env ?? profile.file ?? global.file ?? presetSeed ?? defaultSeed
   ```
   Note the existing cascade ([packages/shared/src/governance.ts:655](../../packages/shared/src/governance.ts#L655)) already has TWO explicit layers (profile, then global) — not one. The file adds two more layers strictly BELOW both env layers; it does **not** interleave per scope (i.e. NOT `profile.env ?? profile.file ?? global.env ?? …`). Implemented so explicit `false` at any layer is honored (nullish-coalescing discipline, matching the existing cascade); matrix test covers env×file×preset combinations including env-true/file-false, env-absent/file-false, and the **ordering discriminator**: `global.env=false` + `profile.file=true` ⇒ effective **false** (global env wins; the rejected interleaved ordering would wrongly yield `true`, so this case is the mechanical proof that ordering A shipped).
3. **AC 32.0.3** — `iris_server_profiles` governance view and `iris-governance://` resource report `configSource` per effective key (`env` | `file` | `preset` | `default`); hidden-tool key omission (Epic 30) unchanged.
4. **AC 32.0.4** — Docs rows (Rule #43 minimal-docs-with-story): `IRIS_GOVERNANCE_FILE` env row + one-line capability + default state in root README and per-server READMEs.

## Integration ACs

**AC 32.0.3 IS this story's Integration AC** (consumer reads from the new service and produces an observable effect): the `iris_server_profiles` governance view (consumer: `packages/shared/src/server-discovery.ts`) and the `iris-governance://` resource (consumer: the D6 resource in `server-base.ts`) both read the file-augmented cascade and surface `configSource` per key — verified against a running built server, not only unit tests. Later consumers (32.1 CLI, 32.2 UI) build on the same exported cascade/`configSource` functions; the file-config loading functions exported for them here must be the SAME ones the servers use (single-sourced, Rule #45 spirit).

## Tasks / Subtasks

- [x] Task 1: File loading + validation (AC: 1)
  - [x] `loadGovernanceFile(path)` (or equivalent export in `governance.ts`): read file → parse JSON → validate via the SAME `parseGovernanceConfig` layer validation (reserved-key rejection included); fail-fast error names the PATH, the VAR (`IRIS_GOVERNANCE_FILE`), and the parse/validation error
  - [x] Wire into `McpServerBase.start()` where `parseGovernanceConfig()` is currently called (server-base.ts ~L1898): unset var ⇒ skip entirely (zero filesystem access, matching the 31.0 "off touches ZERO filesystem" precedent); set ⇒ load or throw
  - [x] Fail-fast on ENOENT/EACCES/malformed JSON/invalid shape — never silently permissive
- [x] Task 2: Cascade extension (AC: 2)
  - [x] Extend `effective()` (and any cascade helpers: `hasExplicitOverride`, denial attribution) to the 6-layer ordering `profile.env ?? global.env ?? profile.file ?? global.file ?? presetSeed ?? defaultSeed` — keep `??` nullish discipline and the ownBool/own-property prototype-collision discipline for the two new layers
  - [x] Decide the data shape (e.g. separate `envConfig`/`fileConfig` params vs. a layered structure) — the denial-attribution path must stay able to distinguish "explicit env" from "file" for AC 32.0.1's attribution deep-equal and AC 32.0.3's `configSource`
- [x] Task 3: `configSource` surfacing (AC: 3, Integration)
  - [x] Per-key source resolution (`env` | `file` | `preset` | `default`) single-sourced in `governance.ts`; consumed by `server-discovery.ts` governance view AND the `iris-governance://` resource
  - [x] Hidden-tool key omission (Epic 30) unchanged: `configSource` must NOT leak hidden tool names — same omission set as the policy map
- [x] Task 4: Tests (AC: 1, 2, 3)
  - [x] Rule #19 no-op proof: existing governance matrix re-run deep-equal (resolved policy + denial attribution) under unset-file config
  - [x] env×file×preset matrix incl. env-true/file-false, env-absent/file-false, and the ordering discriminator (global.env=false + profile.file=true ⇒ false)
  - [x] Fail-fast tests: missing file / unreadable / malformed JSON / reserved key in file — each names path + var + error
  - [x] `configSource` in the discovery view + resource; hidden-key omission preserved
- [x] Task 5: Docs (AC: 4)
  - [x] Root README + 5 per-server READMEs + `iris-mcp-all` README: `IRIS_GOVERNANCE_FILE` row with one-line capability + default state (unset ⇒ inert)

## Dev Notes

### Verified current-state pointers (lead-verified 2026-07-26, Rule #47)

- `packages/shared/src/governance.ts` — `parseGovernanceConfig` (L268) with `governanceError` fail-fast helper (L78) naming `IRIS_GOVERNANCE`; `validateLayer` (L222) incl. reserved-key rejection; `defaultSeed` (L574); `presetSeed` (L625); `effective()` (L671, cascade at L655-700: `ownBool(profileLayer,key) ?? ownBool(config.global,key) ?? presetSeed(...) ?? defaultSeed(...)`); `getEffectivePolicy` (L746) — note the `Object.defineProperty` `__proto__`-collision discipline that any new map construction must mirror; `hasExplicitOverride` (just after `effective`) used for denial attribution (audit.ts:185 — "preset (not an explicit `IRIS_GOVERNANCE` override) caused the denial").
- `packages/shared/src/server-base.ts` — `private governanceConfig: GovernanceConfig = {}` (L379); gate at L1350 calls `effective(...)`; L1371 calls `hasExplicitOverride(...)` for attribution; `start()` calls `parseGovernanceConfig()` at ~L1898.
- `packages/shared/src/server-discovery.ts` — governance view built ~L234-253 calling `getEffectivePolicy(...)`; the `iris-governance://` resource (D6) consumes the same function (single-source both surfaces here).
- Binding spec: `_bmad-output/planning-artifacts/research/technical-iris-server-manager-mcp-connections-research-2026-07-25.md` F2-D1 (L341) — merge file config UNDER env config; no hot-reload in v1 (restart semantics, documented).

### Constraints

- **Back-compat is the headline AC.** The clarified AC 32.0.1 scope: deep-equal over RESOLVED POLICY (per-key map) + DENIAL ATTRIBUTION — not the serialized report (`configSource` is additive and unconditional). Decide carefully whether a file-layer explicit value counts as an "explicit override" for audit attribution (`audit.ts:185`); the AC 32.0.1 deep-equal only constrains the unset-file case, but the with-file attribution must be truthful and documented.
- **Prototype-collision discipline**: the codebase guards every governance map lookup with own-property checks (`ownBool`, `hasOwnProperty`, `defineProperty`). The two new file layers get the identical treatment (a profile named `constructor` or a key named `__proto__` must not leak).
- **No governance key / tool changes** (Rules #28/#31/#53 untriggered): the file configures the SAME key universe; `configSource` is a FIELD, not a tool/action. Frozen baseline `1e62c5ad5bf7` stays byte-unchanged (`pnpm gen:governance-baseline:check` — the `:check` ONLY, Rule #25).
- **J1 (architecture.md, Story 32.3)**: new config channels are explicit-path-only — `IRIS_GOVERNANCE_FILE` is a literal path, NO discovery/search. Relative-path semantics: document what the path resolves against (process CWD — the MCP client chooses it; recommend absolute paths in docs). Do not silently `path.resolve` against anything else without documenting it.
- **Error text**: mirrors the `IRIS_GOVERNANCE is invalid: …` / `profilesError` style; the file variant names `IRIS_GOVERNANCE_FILE` and the path. Never echo file CONTENTS in errors (a governance file is not secret, but the discipline is uniform).
- **Rule #55**: file-writing tools only for content generation; no shell heredocs.
- **Rule #54**: test fakes must return shapes the real system can produce; expected values captured from real runs (Rule #36).
- Docs default state: unset ⇒ inert (today's behavior) — mechanical from the AC, state it at the point of use (Rule #30/#43).

### Previous-story intelligence (32.3 burn-down, same package)

- `governance.ts` was NOT touched by 32.3, but `server-manager-source.ts`/`profiles.ts` patterns are fresh: fail-fast error style naming file+server+reason, per-entry containment, `fileLabel` threading for parser diagnostics.
- 32.3's J1 decision (CWD trust) is directly relevant — record the path-resolution choice consistently with it.
- Extension (`extensions/iris-mcp-launcher/`) is out of scope for this story (32.2 owns the UI).

### Project Structure Notes

- Code: `packages/shared/src/governance.ts` (primary), `packages/shared/src/server-base.ts` (wire-in), `packages/shared/src/server-discovery.ts` (surfacing). Tests: `packages/shared/src/__tests__/governance*.test.ts`, `server-discovery*.test.ts`, possibly a cross-package check in `packages/iris-mcp-all/src/__tests__/` (Rule #45) if the resource+tool surfaces need a constructed-server sweep.
- Docs: root `README.md`, `packages/*/README.md` (5 servers + iris-mcp-all).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 32.0 (ACs incl. 2026-07-26 clarifications)]
- [Source: _bmad-output/planning-artifacts/research/technical-iris-server-manager-mcp-connections-research-2026-07-25.md#F2-D1]
- [Source: packages/shared/src/governance.ts#effective / #parseGovernanceConfig / #getEffectivePolicy]
- [Source: .claude/rules/project-rules.md#19 / #25 / #30 / #31 / #43 / #45 / #54]

## Dev Agent Record

### Agent Model Used

k3[1m]

### Debug Log References

(none — no live-IRIS debugging required; the story is pure TS. The Integration smoke drove the built dist over real stdio against live IRIS localhost:52773/HSCUSTOM.)

### Completion Notes List

- **Task 1 (loader).** `loadGovernanceFile(env = process.env)` in `governance.ts`: unset/empty ⇒ `undefined` BEFORE any `fs` call (zero-filesystem proof via a delegating `readFileSync` spy); set ⇒ `readFileSync(path, "utf8")` → `JSON.parse` → shared shape validation. Fail-fast error style mirrors `IRIS_GOVERNANCE is invalid: …`: `IRIS_GOVERNANCE_FILE is invalid: <detail> (path: <path>)` — names var + path + underlying read/parse/validation error, never echoes file contents. Single-sourcing: `validateLayer` gained a `fail` error-builder parameter and the root-object validation was extracted into `parseGovernanceRoot(parsed, fail)`, consumed by BOTH `parseGovernanceConfig` (env channel, error texts byte-identical) and `loadGovernanceFile` (file channel) — the reserved-key rejection is literally the same code. Path semantics (J1-consistent): the literal string is passed to `fs`; Node resolves relatives against `process.cwd()` (the MCP client chooses it) — documented in JSDoc + README, absolute paths recommended. No hot-reload (read once in `McpServerBase.start()`).
- **Task 2 (cascade, AC 32.0.2).** Data shape decision: a SEPARATE trailing optional `fileConfig?: GovernanceConfig` parameter on `effective` / `getEffectivePolicy` / `hasExplicitOverride` (never merged into the env config) — attribution (`hasExplicitOverride`) and `configSource` must distinguish the channels, and a trailing-optional keeps every pre-existing caller byte-identical. The cascade is exactly the binding ordering `env.profile ?? env.global ?? file.profile ?? file.global ?? presetSeed ?? defaultSeed` (NOT interleaved); a shared `ownProfileLayer(config, profile)` helper gives the file layers the identical own-property discipline as the env layers (a `constructor`-named profile / `__proto__` key cannot leak). **Denial-attribution decision (documented per Constraints):** a file-layer explicit value IS an explicit override — a file-caused denial is NOT attributed to the preset (`presetApplied` absent); gate test proves both directions (file-caused ⇒ no `presetApplied`; preset-alone-caused ⇒ `presetApplied: "read-only"`).
- **Task 3 (configSource, AC 32.0.3 + Integration).** `GovernanceConfigSource = "env" | "file" | "preset" | "default"`; `configSource(key, …)` walks the SAME cascade helpers and reports the first layer carrying the key; `getEffectiveConfigSources(profile, …)` mirrors `getEffectivePolicy` incl. the `defineProperty` collision discipline. Consumers: `computeServerDiscovery` (`governance.configSource` single-profile / `governance.configSources` allProfiles — additive fields, unconditional) and the D6 resource, whose payload grew from the bare policy map to `{ policy, configSource }` (the AC-32.0.3-mandated shape; AC 32.0.1's clarified scope explicitly excludes the serialized report from the back-compat deep-equal). Both build the source map over the SAME `visibleGovernedKeys()` filter as the policy map, so the Epic-30 hidden-tool key omission is structural (server-level test: hidden key absent from BOTH fields on BOTH surfaces). Barrel exports added: `loadGovernanceFile`, `hasExplicitOverride`, `configSource`, `getEffectiveConfigSources`, type `GovernanceConfigSource` — the SAME functions Story 32.1's CLI will import (single-sourced, Rule #45 spirit).
- **Scope-additive hardening (flagged):** `iris_env_promote`'s Gate 4 (target-profile governance, `env-promote.ts`) is a SECOND enforcement point that checks the write-family keys the D5 gate never sees (execute re-fetches via profile clients directly). It now loads `loadGovernanceFile()` and threads it into its `effective()` call — otherwise a write-family key disabled ONLY in the file would have been bypassed. +1 regression test (`env-promote-execute.test.ts`: file-only disable of `iris_config_manage:set` ⇒ refusal, zero clients resolved).
- **Pre-existing test fixtures updated (sanctioned, mechanical):** 10 parse sites across 9 test files that read the `iris-governance://` resource payload as a bare `Record<string, boolean>` now unwrap `.policy` from the new `{ policy, configSource }` shape (each a one-line change; downstream assertions untouched). Pitfall hit and fixed: `JSON.parse(x) as { policy: … }.policy` is invalid — the `.policy` must sit OUTSIDE the `as` cast or esbuild strips it with the type.
- **Tests (48 net new, mechanically counted):** new `governance-file.test.ts` (47: loader fail-fast matrix incl. zero-fs spy proof + ENOENT/malformed/non-boolean/reserved-key/reserved-profile-name/valid/empty; 6-layer cascade matrix incl. BOTH directions of the ordering discriminator (unit AND gate level), file-beats-preset both ways, prototype-collision; Rule #19 no-op proof — explicit-`undefined` vs omitted-arg deep-equal over a 6-config × 2-profile matrix for resolved policy AND `hasExplicitOverride`, plus a hand-derived seed oracle; `hasExplicitOverride` file attribution; `configSource` unit resolution incl. defineProperty collision; 11 server-level integration tests — resource payload shape, discovery↔resource agreement, gate discriminator, file-layer enable reaching the gate, denial attribution both directions, hidden-key omission on both surfaces, startup fail-fast missing+malformed, server-level no-file Rule #19) + 1 env-promote Gate-4 file test.
- **Integration AC smoke (running BUILT server, not only unit tests):** disposable `tmp-32-0-smoke.mjs` (SDK `Client` + `StdioClientTransport`, deleted after) drove the BUILT `iris-dev-mcp` over real stdio against LIVE IRIS (localhost:52773, HSCUSTOM): RUN A (env+file) — configSource env/file/default correct on both surfaces, discovery === resource on BOTH maps, `iris_doc_get` call DENIED despite the file's profile-layer re-enable (discriminator at the wire), `iris_sql_execute` DENIED by the file layer alone; RUN B (no file) — configSource present, never `file`, policy unchanged; RUN C — missing file ⇒ startup fail-fast naming var + path. 20/20 PASS. (First run caught a smoke-script bug — `iris_doc_get` requires `name`, Zod fires before the gate — not a product defect.)
- **Docs (AC 32.0.4, Rule #30/#43):** root README — env-table row (`IRIS_GOVERNANCE_FILE`, unset ⇒ inert), the single-server no-changes list, the `IRIS_PROFILES`/`IRIS_GOVERNANCE` intro (no longer "no external files"), the cascade formula updated to the 6-layer form with the all-env-above-all-file guarantee, and a new "Governance file (`IRIS_GOVERNANCE_FILE`)" subsection (capability, default state, env-wins ordering, explicit-path-only + CWD semantics, restart semantics, fail-fast, `configSource` attribution); the 5 per-server READMEs + `iris-mcp-all` README each gained the minimal paragraph (capability + default state + env-wins) after their governance paragraph. Changeset `governance-file-channel.md` added (patch bumps for `@iris-mcp/shared` + `@iris-mcp/dev`, matching repo convention).
- **Gates:** `pnpm turbo run build test lint type-check` 25/25 green [`@iris-mcp/shared` 60 files/1186 tests (+47 net, mechanically derived from the pre-story 59/1139); `@iris-mcp/dev` 37 files/608 (+1)]; `pnpm gen:governance-baseline:check` (`:check` ONLY, Rule #25) exit 0 — frozen `1e62c5ad5bf7` / 141 frozen / 201 live / 60 post-foundation UNCHANGED (no new governance key, no tool/action change — `configSource` is a field, not a tool); NO `bootstrap-classes.ts`/`BOOTSTRAP_VERSION`/`src/ExecuteMCPv2/**` change; no tool count moved (Rule #31); `git diff --stat` text-only, NUL-byte scan clean (Rule #55). Changes left UNCOMMITTED for the lead's per-story smoke gate + commit.

### File List

- `packages/shared/src/governance.ts` (loader, 6-layer cascade, `hasExplicitOverride` file layers, `GovernanceConfigSource`/`configSource`/`getEffectiveConfigSources`, shared `parseGovernanceRoot`/`ownProfileLayer`)
- `packages/shared/src/server-base.ts` (`governanceFileConfig` field, `start()` wire-in, gate + denial-attribution threading, discovery threading, resource payload `{ policy, configSource }`)
- `packages/shared/src/server-discovery.ts` (`configSource`/`configSources` surfacing, `fileConfig` threading, `ServerDiscoveryResult` fields)
- `packages/shared/src/index.ts` (barrel exports: `loadGovernanceFile`, `hasExplicitOverride`, `configSource`, `getEffectiveConfigSources`, `GovernanceConfigSource`)
- `packages/iris-dev-mcp/src/tools/env-promote.ts` (Gate 4 file-channel threading)
- `packages/shared/src/__tests__/governance-file.test.ts` (NEW — 47 tests)
- `packages/iris-dev-mcp/src/__tests__/env-promote-execute.test.ts` (+1 Gate-4 file test)
- `packages/shared/src/__tests__/governance-resource.test.ts` (resource payload `.policy` unwrap ×2)
- `packages/shared/src/__tests__/governance-resource-coverage.test.ts` (payload unwrap)
- `packages/shared/src/__tests__/governance-classification.test.ts` (payload unwrap)
- `packages/shared/src/__tests__/governance-cross-server.test.ts` (payload unwrap)
- `packages/shared/src/__tests__/governance-preset.test.ts` (payload unwrap)
- `packages/shared/src/__tests__/governance-preset-cross-surface.test.ts` (payload unwrap)
- `packages/shared/src/__tests__/server-discovery.e2e.test.ts` (payload unwrap)
- `packages/shared/src/__tests__/tool-visibility.e2e.test.ts` (payload unwrap)
- `packages/iris-interop-mcp/src/__tests__/control-governance-e2e.test.ts` (payload unwrap)
- `packages/iris-mcp-all/src/__tests__/tool-visibility-non-drift.test.ts` (payload unwrap)
- `README.md` (env row, no-changes list, intro line, 6-layer cascade, Governance file subsection)
- `packages/iris-dev-mcp/README.md`, `packages/iris-admin-mcp/README.md`, `packages/iris-ops-mcp/README.md`, `packages/iris-interop-mcp/README.md`, `packages/iris-data-mcp/README.md`, `packages/iris-mcp-all/README.md` (`IRIS_GOVERNANCE_FILE` paragraph)
- `.changeset/governance-file-channel.md` (NEW)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status bookkeeping)

## Change Log

- 2026-07-26: Story 32.0 implemented — `IRIS_GOVERNANCE_FILE` loader (`loadGovernanceFile`, shared validation with `IRIS_GOVERNANCE`), the 6-layer cascade (`env.profile ?? env.global ?? file.profile ?? file.global ?? presetSeed ?? defaultSeed`) on `effective`/`getEffectivePolicy`/`hasExplicitOverride`, `configSource` surfacing on `iris_server_profiles` + the `iris-governance://` resource (payload now `{ policy, configSource }`), Gate-4 file threading in `iris_env_promote`, 48 new tests, README docs on all 7 surfaces + changeset. Frozen baseline `1e62c5ad5bf7` unchanged; 25/25 turbo gates green; built-dist live smoke 20/20.

### Review Findings

Code review 2026-07-26 (diff: uncommitted working tree vs `c4ff9ae`). **All three spawned review layers (blind-hunter, edge-case-hunter, acceptance-auditor) failed to return findings** — their mandates were executed reviewer-direct and verified live, mirroring the Story 32.3 review record:

- **Blind Hunter mandate (diff-only adversarial):** full core diff read (`governance.ts`, `server-base.ts`, `server-discovery.ts`, `index.ts`, `env-promote.ts`, all 10 `.policy` unwrap sites, docs, changeset). Verified: every production caller of `effective`/`getEffectivePolicy`/`hasExplicitOverride`/`computeServerDiscovery` is threaded with the file config (the unthreaded-caller class — env-promote Gate 4 was the one genuine gap and the dev closed it); positional arg alignment at all 9-arg call sites; env-channel error texts byte-identical after the `parseGovernanceRoot`/`validateLayer` refactor (the 1186-test green suite includes the pinned message assertions); `ownProfileLayer`/`ownBool` own-property discipline identical on both new file layers.
- **Edge Case Hunter mandate:** fail-fast matrix complete (missing/ENOENT, malformed JSON, non-object root, non-boolean value, reserved key `__proto__`, reserved profile name `constructor`, empty-object file, set-but-empty var ⇒ inert with zero-fs proof). Directory-as-path / EACCES / trailing-garbage JSON funnel through the same catch ⇒ fail-fast naming var+path (structurally guaranteed; dismissed). BOM'd JSON fails fast — fail-safe direction (dismissed). Empty-string var treated as unset matches the `IRIS_AUDIT_LOG` convention (dismissed).
- **Acceptance Auditor mandate:** AC 32.0.1 (no-op proof at unit + server + process level; fail-fast naming var+path+error; SAME shared validation incl. reserved-key) ✓; AC 32.0.2 (6-layer ordering, discriminator at unit AND gate AND wire) ✓ — **mutation-verified by the reviewer**: flipping `effective()` to the rejected interleaved ordering turns 3 tests red (unit discriminator, gate discriminator, +1), file restored byte-identical and 47/47 green again; AC 32.0.3 (configSource on BOTH surfaces, discovery === resource, hidden-key omission structural) ✓; AC 32.0.4 (7 README surfaces, truthful default states) ✓; Integration AC 32.0.3 honored by real surfacing tests on both surfaces (server-level suite + QA's 5-test process gate over the BUILT dist with a real MCP handshake + live IRIS — re-run by the reviewer, 5/5 green, not skipped). ADR conformance: D4 (cascade semantics preserved, ordering decision recorded), D6 (payload shape change `{ policy, configSource }` is spec-sanctioned by the AC 32.0.1 clarification + AC 32.0.3, epics.md amended 2026-07-26 by the Project Lead), D7 (file parsed by the SAME validation layer), J1 (explicit-path-only, CWD-relative semantics documented). Frozen baseline check exit 0 (`1e62c5ad5bf7` / 141 / 201 / 60); NUL-byte scan clean; tallies mechanically recounted (shared 60 files/1186 = +47, dev 37/608 = +1, iris-mcp-all 15/97 = +5; story's "48 net new" = 47+1 confirmed).

**Outcome: 0 decision-needed · 0 patch · 1 defer (LOW) · 4 dismissed.**

- [x] [Review][Defer] `iris_env_promote` Gate 4 re-reads the governance FILE on every `execute` call while every other surface uses the startup snapshot [packages/iris-dev-mcp/src/tools/env-promote.ts:1106] — deferred, pre-existing-pattern deviation; see deferred-work.md item `32-0-1`.

**Dismissed (not carried):** (1) resource payload shape change — spec-sanctioned (AC 32.0.1 clarification: the serialized report is explicitly excluded from the back-compat deep-equal; all 10 in-repo consumers updated mechanically). (2) Set-but-empty `IRIS_GOVERNANCE_FILE` treated as unset — consistent with the `IRIS_AUDIT_LOG` unset/empty convention, explicitly tested, documented in JSDoc. (3) BOM'd JSON file fails fast — the fail-safe direction for an explicit operator path; consistent with the env channel's strictness. (4) The unit-level Rule #19 explicit-`undefined`-vs-omitted-arg proof being near-tautological in isolation — compensated by the unchanged-and-green 1139-test pre-existing matrix (zero pre-existing assertions modified except the 10 sanctioned `.policy` unwraps), the hand-derived seed oracle, the server-level Rule #19 test, and process-gate Case E.
