# Spec 02 — Governance Safety Presets (`IRIS_GOVERNANCE_PRESET`) + SQL Resource Caps

**Server:** `@iris-mcp/shared` (framework, affects all 5 servers) | **Priority:** 2 (quick win) | **Effort:** ~3 stories
**Governance:** framework change, no new tool keys | **Prereqs:** none
**Read first:** [`00-conventions.md`](00-conventions.md), `packages/shared/src/governance.ts`,
`packages/shared/src/governance-baseline.ts` (READ ONLY — frozen), `packages/shared/src/governance-baseline-derivation.ts`,
`packages/shared/src/server-discovery.ts`, `packages/shared/src/config.ts`, root `README.md` §"Multiple Servers & Governance"

## 1. Objective

Read-only-by-default is the #1 trust feature in the database-MCP market. The governance engine
can already express "block every write" — but only via a hand-written `IRIS_GOVERNANCE` JSON
naming 141+ keys. This spec adds **one-word safety presets**:

```
IRIS_GOVERNANCE_PRESET=read-only   # every write-classified action blocked, every read allowed
IRIS_GOVERNANCE_PRESET=full        # explicit alias for today's default behavior
```

plus SQL resource caps (`IRIS_SQL_MAX_ROWS`, `IRIS_SQL_TIMEOUT`). Headline README line this
enables: *"Point it at production in read-only mode with one environment variable."*

## 2. Design

### 2.1 The classification problem

`read-only` needs a read/write verdict for EVERY governance key. New (post-governance) keys
carry `mutates`. The 141 frozen-baseline keys do NOT (they're grandfathered — conventions §2).
Therefore:

- **New artifact:** `packages/shared/src/baseline-classifications.ts` — a hand-curated map
  `BASELINE_ACTION_CLASSIFICATIONS: Record<string, "read" | "write">` covering **every key in
  the frozen baseline** (import `GOVERNANCE_BASELINE` and enumerate; do NOT copy the key list
  by hand). Curate from each tool's action semantics: anything that creates/modifies/deletes
  IRIS state is `write` (e.g., `iris_doc_put`, `iris_global_set`, `iris_global_kill`,
  `iris_namespace_manage:create|modify|delete`, `iris_execute_command`, `iris_execute_classmethod`
  — execution is `write`; `*_list`/`*_get`/`status`/`view`/`check` are `read`).
  When in doubt, classify `write` (fail safe).
- **Completeness is test-enforced:** a unit test asserts the classification map's key set
  EQUALS the frozen baseline key set exactly (missing or extra keys fail with the key named).
  This is the Rule #20 mechanical-proof pattern; the frozen `governance-baseline.ts` itself is
  NEVER modified (Rule #23).
- The map has a `DO NOT hand-sync with governance-baseline.ts; the completeness test enforces
  parity` header comment.

### 2.2 Preset resolution — cascade extension

Current cascade (README): `effective = profile.explicit(key) ?? global.explicit(key) ?? defaultSeed(key)`.

New cascade: `effective = profile.explicit(key) ?? global.explicit(key) ?? presetSeed(key) ?? defaultSeed(key)`

- `presetSeed` for `read-only`: key classified `read` (via `mutates` for new keys, via
  `BASELINE_ACTION_CLASSIFICATIONS` for baseline keys) → `true`; classified `write` → `false`.
  **`defaultEnabled` writes are also `false` under `read-only`** (read-only means read-only;
  the Epic-20 `clean` action is blocked). Framework read tools (`iris_server_profiles`) stay enabled.
- `presetSeed` for `full` (or unset): pass-through (`undefined` → falls to `defaultSeed`).
- Explicit `IRIS_GOVERNANCE` keys ALWAYS override the preset (both layers) — an operator can
  re-enable one specific write under `read-only`.
- Unknown preset value → **fail fast at startup** with the allowed values named (matching the
  existing malformed-`IRIS_PROFILES` startup behavior; find and mirror it in `config.ts`).

Implementation: thread the preset through the same functions that gained `defaultEnabledWrites`
in Epic 20 (`defaultSeed` / `effective` / `getEffectivePolicy` — see the F2 pattern in
`governance.ts`). It must be an optional, default-`undefined` parameter so an unset preset is
**byte-for-byte** today's behavior (Rule #19 mechanical proof required).

### 2.3 Surfacing

- `iris_server_profiles` output gains `preset: "read-only" | "full" | null` and the effective
  policy it already reports reflects the preset (it must — it uses the same engine; add a test).
- The governance resource (`iris-governance://{profile}`) automatically reflects presets for
  the same reason; add one assertion.
- A blocked call's `GOVERNANCE_DISABLED` structured error gains optional `"presetApplied":
  "read-only"` when the preset (not an explicit key) caused the denial — operators need to
  know WHY it was blocked (wargame finding: explainable policy decisions).

### 2.4 SQL resource caps

- New env vars (all optional): `IRIS_SQL_MAX_ROWS` (hard cap on `iris_sql_execute` row limit —
  caller's `maxRows`/limit param is clamped, response notes `"rowsCapped": true` when clamping
  occurred), `IRIS_SQL_TIMEOUT` (seconds, forwarded to the existing HTTP/handler timeout
  plumbing for that tool — locate how `iris_sql_execute` currently passes timeout before
  wiring; `[PROBE the TS path, not IRIS]`).
- Caps apply regardless of preset; unset = today's behavior (back-compat proof).
- Document in README env-var table + client-config guides.

## 3. Story breakdown

1. **Story 1 — Baseline classifications (1):** `baseline-classifications.ts` + completeness
   test + review pass over every `write` classification (the review checklist: name each key
   classified `read` that contains a verb other than list/get/view/status/check/history/
   listHistory/explain/stats — each such key needs a justification comment).
2. **Story 2 — Preset engine (1):** cascade extension + `presetSeed` + startup validation +
   back-compat capstone (unset preset ⇒ `getEffectivePolicy` output deep-equals pre-change
   snapshot for all keys on a constructed server) + read-only capstone (every write key
   `false`, every read key `true`, `defaultEnabled` write `false`, explicit override wins) —
   both in the DEFAULT suite (Rule #21). `iris_server_profiles` + resource surfacing + denial
   `presetApplied` field.
3. **Story 3 — SQL caps + docs + smokes (1):** caps wiring + unit tests; docs rollup: README
   env table + governance section, all three `docs/client-config/*.md`, CHANGELOG. Live
   smokes (Rules #22/#26): built dist with `IRIS_GOVERNANCE_PRESET=read-only` → a real
   `iris_global_set` call REFUSED with `GOVERNANCE_DISABLED` + `presetApplied`, a real
   `iris_global_get` succeeds; explicit `IRIS_GOVERNANCE` re-enable of one write verified live.

## 4. Acceptance criteria

1. Unset preset ⇒ byte-for-byte current effective policy (mechanical snapshot test).
2. `read-only` blocks 100% of write-classified keys (baseline + new + `defaultEnabled`) and
   enables 100% of read-classified keys — asserted over the full key universe, not samples.
3. Classification map covers exactly the frozen baseline key set (completeness test).
4. Explicit `IRIS_GOVERNANCE` overrides beat the preset at both global and profile layers.
5. Invalid preset value crashes at startup with a clear message naming valid values.
6. `iris_server_profiles` reports the active preset; denial errors carry `presetApplied`.
7. SQL caps clamp and annotate; unset caps are a no-op (snapshot test).
8. `gen:governance-baseline:check` exits 0; frozen baseline file untouched (`git diff` clean).
9. Live rejection + re-enable smokes recorded. Conventions §6 checklist complete.

## 5. Out of scope

- A `standard` preset (reads + non-destructive writes) — needs a destructiveness taxonomy;
  defer until read-only ships and demand is proven.
- Per-preset caps bundles; time-boxed write elevation ("write access for this task only").
- Any change to the frozen baseline or its generator.
