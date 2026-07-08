# Spec 09 — `iris_semantic_index` / `iris_semantic_search`: Semantic Code & Schema Search

**Server:** `@iris-mcp/dev` | **Priority:** 9 — **GATED, do not start until gates pass** | **Effort:** ~1.5 epics
**Gates:** (a) Spec 08 shipped (embedded Python is the embedding runtime), (b) test instance is
IRIS ≥ 2024.1 (VECTOR type), (c) an embedding model validated per §2.
**Governance:** `iris_semantic_index` → `mutates: { build: "write", clear: "write", status: "read" }`
(writes **default-disabled**); `iris_semantic_search` → `mutates: "read"` (enabled)
**Read first:** [`00-conventions.md`](00-conventions.md), Spec 08, project memory on vector
datatype pitfalls (`.claude/rules/iris-objectscript-basics.md` §"IRIS Vector Search" — SQL error
-259 datatype-mismatch lesson), `packages/iris-dev-mcp/src/tools/` (doc search tool, for UX parity)

## 1. Objective

Natural-language search over ObjectScript code and class/schema structure in a LIVE namespace —
"where is patient address validation handled?" — without knowing class names, using IRIS's own
native VECTOR search (a dogfooding story: *we search IRIS with IRIS*). Differentiator vs.
client-side code search: works on live namespaces without exporting source.

## 2. MANDATORY Story 0 — feasibility probes (Rule #16; go/no-go)

1. **Version/feature gate:** pin the detection mechanism — attempt
   `SELECT TO_VECTOR('1,2,3', DOUBLE, 3)` (or the platform-correct signature `[PROBE]`) and
   catch; plus `$SYSTEM.Version` parse as fallback. The tools must return a crisp
   "requires IRIS 2024.1+" capability error on older instances.
2. **Embedding runtime:** via Spec 08's plumbing, probe `sentence-transformers` (or the
   stakeholder-approved local model) importability, model download policy (air-gapped
   instances CANNOT download — the model path must be configurable and documented), embedding
   dimensionality, and per-chunk latency on the live instance. **No external embedding APIs —
   code never leaves the instance (healthcare constraint, non-negotiable).**
3. **Vector SQL:** pin exact DDL for the index table (VECTOR(DOUBLE, <dim>) column), insert
   path (TO_VECTOR with matching datatype — the project's recorded -259 lesson: query and
   stored embeddings MUST be produced identically), and similarity query
   (`VECTOR_COSINE`/`VECTOR_DOT_PRODUCT` — pin names/signatures on the installed version).
4. Deliverable: go/no-go memo + amended spec. If any gate fails, STOP and report.

## 3. Design

### 3.1 Index model

Persistent class `ExecuteMCPv2.Semantic.Chunk` (namespace-local storage, compiler-managed
storage section — never hand-written):
`Namespace, DocName, ChunkType (classDoc|methodDoc|methodImpl|propertySet|sqlTable), MemberName,
Text (source excerpt ≤ ~1500 chars), Embedding (VECTOR per probe), SourceHash, IndexedAt`.

Chunking: one chunk per class-level doc comment + per method (signature + doc comment + first
N lines of implementation) + per property block + per SQL-projected table (table name +
column list). Chunker runs ObjectScript-side walking `%Dictionary` — reuse enumeration
patterns from the existing doc-index handler.

### 3.2 `iris_semantic_index`

Actions: `build` (`spec` REQUIRED — package scope, Rule #38: no whole-namespace default;
`maxDocs?` default 500 hard-cap guidance; description documents the ~60s gateway timeout risk
and recommends package-sized specs), `status` (chunk/doc counts, model, dimensions, staleness
summary via SourceHash comparison), `clear` (drop the namespace's index; requires `confirm:true`).
Incremental build: skip chunks whose SourceHash is unchanged. v1 is synchronous; if Story-0
latency measurements show >30s for a 200-class package, split build into TS-driven batches
(multiple HTTP calls over the doc list) rather than one long request — decide from probe data.

### 3.3 `iris_semantic_search`

Input: `query: string`, `topK?` (default 10, max 50), `types?: ChunkType[]`, `spec?` (filter),
`namespace?`. The query is embedded **via the identical Python path used at index time**
(the -259 lesson: same model, same datatype, same TO_VECTOR construction). Output: ranked
`{docName, memberName, chunkType, score, excerpt}` + an `indexInfo` staleness warning when the
index predates recent doc modifications. Empty index → actionable "run iris_semantic_index"
error, not empty results.

## 4. Story breakdown

1. **Story 0 — gates/probes (1):** §2; go/no-go.
2. **Story 1 — chunk model + chunker (1):** persistent class + dictionary walker + unit tests
   on fixture classes; deploy/bootstrap.
3. **Story 2 — embed + build pipeline (1.5):** Python embedding bridge, build/status/clear
   handlers + routes, incremental hashing, batching decision per probe data.
4. **Story 3 — search (1):** vector query handler + TS tools (both) + governance wiring/tests.
5. **Story 4 — docs + smokes (1):** docs rollup (default-disabled writes stated; version gate
   prominent; air-gapped model-path setup guide); live smokes: index `ExecuteMCPv2.*` on the
   live instance, semantic query returns a plausibly-relevant handler for "where are messages
   resent" style queries; rejection smokes: build-without-spec refused, clear-without-confirm
   refused, older-IRIS capability error (if such an instance exists — else residual risk note);
   second namespace (Rule #34).

## 5. Acceptance criteria

1. Story-0 go/no-go documented; every vector/embedding API pinned from live probes.
2. Build is incremental (unchanged SourceHash skipped — timed proof), scoped (spec required),
   and cap-guarded; wide-scope timeout risk documented (Rule #38 — topK caps output, NOT scan).
3. Search returns relevant results on the seeded fixture set with identical-embedding-path
   discipline (a regression test asserts index-time and query-time embeddings of the same
   string are byte-identical — the -259 guard).
4. All three governance classifications enforced + tested; writes default-disabled, refusals live.
5. Version gate + Python-absent gate return capability errors, never crashes.
6. No code content leaves the instance (no external network calls — assert none in the TS path).
7. Conventions §6 checklist complete.

## 6. Out of scope (v1)

- Auto-reindex on compile (staleness surfaced via `status`/search warnings instead).
- Embedding data/row content (schema + code only — PHI risk).
- Cross-namespace federated search; hybrid keyword+vector ranking (v2 candidates).
