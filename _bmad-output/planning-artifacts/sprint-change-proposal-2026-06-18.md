# Sprint Change Proposal — 2026-06-18

**Author:** Mary (Business Analyst) via `bmad-correct-course`
**Trigger:** Server/governance **discovery gap** found during Epic 18 post-merge live tool testing (2026-06-17) — Claude Code could not determine the configured server profiles via any callable surface and fell back to reading `~/.claude.json`.
**Change type:** Additive capability (new stakeholder requirement) adjacent to the Epic 14 governance foundation.
**Path forward:** Option 1 — Direct Adjustment (append one new epic).
**Scope classification:** Moderate (shared-core framework addition; design already settled — quick architect confirm, not a replan).
**Review mode:** Batch.
**New epic:** Epic 19 (single story 19.0).
**New FR:** FR127.
**BOOTSTRAP_VERSION:** unchanged (TypeScript-only, like Epic 14).

---

## 1. Issue Summary

Epic 14 (architecture decision **D6**) exposed the effective governance policy as an **advisory MCP resource** — `iris-governance://default` (static) and `iris-governance://{profile}` (template) at [`server-base.ts:527`](../../packages/shared/src/server-base.ts#L527). That resource is correct for what it does, but it does **not** let an AI client *discover* its operating environment. Three concrete holes:

1. **No profile enumeration.** The per-profile template's `list` is deliberately `undefined` ([`server-base.ts:547`](../../packages/shared/src/server-base.ts#L547)) and the static resource only covers `default`. Nothing — resource or tool — answers *"which profiles are configured?"*
2. **Passive (pull) surface.** Resources are not read by the agent's loop before tool calls; most clients surface them only on explicit user attach. The policy that *is* exposed is never consulted automatically.
3. **No connection metadata.** The policy map shows *enablement keys*, never *"profile `staging` → namespace `HSCUSTOM` on host X"* — the very thing the agent needs to choose a `server` value.

**Evidence.** During the 2026-06-17 testing session, the agent had no callable way to learn the profile roster and grepped the Claude client config file. Source-confirmed at the two line references above.

**Discovery is in use, the design is settled.** From the analyst session preceding this proposal, the stakeholder decisions are locked:
- **Surface:** add a callable read **tool**, AND keep the existing resource (clients that *do* read resources still benefit).
- **Redaction:** expose **full profile config except `password`** (name, host, port, username, namespace, https, timeout, baseUrl, isDefault).
- **Discoverability:** the tool description (reinforced via the MCP server `instructions` field + READMEs) instructs the agent to **call it first** to learn profiles + governance before invoking other tools.

---

## 2. Impact Analysis

### Epic Impact
- **No existing epic invalidated, rolled back, or rescoped.** Epics 1–18 are `done` and remain valid.
- **One new epic appended (Epic 19),** single story (19.0), following the minimal-epic pattern proven by Epic 18.
- **No resequencing.** Epic 14's foundation (profile registry, `getEffectivePolicy`, `resources` capability) already shipped, so Epic 19 builds on it directly with no new prerequisites.

### Story Impact
- **1 new story (19.0).** No existing story is touched.

### Artifact Conflicts
| Artifact | Impact | Nature |
|---|---|---|
| **PRD** | Add FR127; no existing FR changed | Additive |
| **Architecture** | Extend *MCP Server Registration Pattern* + *Authentication & Security*; add an Epic 19 ADR (decision **E1**); no decision reversed | Additive |
| **UX** | N/A — headless MCP server suite | None |
| **`epics.md`** | Add Epic 19 section | Additive |
| **`sprint-status.yaml`** | Add `epic-19` + `19-0-...` as `backlog` | Additive |
| **README + per-package READMEs + `tool_support.md`** | Document the new discovery tool + its "call-first" guidance; bump per-server tool counts | Additive (in-scope deliverable) |
| **`bootstrap-classes.ts` / `BOOTSTRAP_VERSION`** | **No change** — TypeScript-only, no ObjectScript handler | None |
| **CHANGELOG** | New entry | Additive |

### Technical Impact
- **`@iris-mcp/shared` is the only code-touch point.** The discovery tool is **framework-provided** — registered centrally in `server-base.ts` (exactly like the `server`-param injection of D2 and the governance resource of D6), NOT added to any package's `tools/index.ts`. It therefore appears uniformly on all five servers for free and inherits future profiles/governance automatically.
- **Reuses existing primitives:** the profile registry (`profiles.ts`) for the roster + connection metadata, and `getEffectivePolicy` (`governance.ts`) for the policy — so the tool and the D6 resource **cannot drift** (single source of truth).
- **Governance classification:** the new tool is a **read** → `mutates: "read"` → default-enabled (Rule #28; required or `assertGovernanceClassification` throws at registration). It is a new, non-baseline key, so it does **not** alter the frozen 141-key baseline (`1e62c5ad5bf7`, Rules #23/#25).
- **Redaction is the one security-sensitive line:** the tool MUST omit `password` for every profile. Per stakeholder decision, `username` and all other connection fields ARE exposed (acceptable for this self-hosted, operator-configured suite).

---

## 3. Recommended Approach

**Option 1 — Direct Adjustment.** Append one new single-story epic (Epic 19) within the existing plan; no rollback, no MVP reduction.

**Rationale:** The capability is small, fully designed, and strictly additive. It builds on already-shipped Epic 14 primitives and touches exactly one component (`@iris-mcp/shared`). The single-story-epic shape matches Epic 18 and keeps the ledger clean with its own retro.

- **Effort:** Low (one shared-core tool + optional resource-enumeration enhancement + tests + docs; no ObjectScript, no bootstrap bump).
- **Risk:** Low — additive framework tool; the only care-point is the password-redaction contract (covered by an explicit AC + test).
- **Timeline/sequencing:** No dependencies; can run immediately.

**Alternatives considered:**
- *Extend `iris_server_info`* (rejected per stakeholder) — would mix Atelier build-info with profile/governance discovery and is dev-server-only (not present on admin/interop/ops/data), defeating cross-server discoverability.
- *Reopen Epic 14* (rejected) — Epic 14 is `done`; a fresh single-story epic keeps the closed-epic ledger intact.

---

## 4. Detailed Change Proposals

> Additive — new content blocks for `prd.md`, `architecture.md`, `epics.md`, and `sprint-status.yaml`. No before/after diffs (nothing existing is modified).

### 4.1 PRD addition (append to Functional Requirements)

**Epic 19 — Server & Governance Discovery**
- **FR127:** AI client can call a single read tool to discover, for the server it is connected to: (a) the full roster of configured server profiles with each profile's connection metadata **excluding the password** (name, host, port, username, namespace, https, baseUrl, timeout, and which is the default), and (b) the effective governance policy (enabled/disabled action map) for a given profile. The tool is present on every server in the suite, is enabled by default (a `read` action), and its description instructs the client to call it **before** invoking other tools to learn available profiles and governance. With no `IRIS_PROFILES`/`IRIS_GOVERNANCE` set, it reports the single `default` profile and the default-seed policy (today's behavior).

### 4.2 Architecture additions (extend existing sections + new ADR)

- **§ MCP Server Registration Pattern** — add a **framework-provided discovery tool**: registered centrally in the shared server base (alongside the `server`-param injection and the governance resource), not in any package's tool index, so it appears uniformly on all five servers and inherits the live profile/governance state at call time. Classified `mutates: "read"`.
- **§ Authentication & Security** — add the **discovery redaction contract**: the discovery tool returns full per-profile connection metadata **except `password`**, which is never serialized. Credentials-on-the-wire posture is unchanged (the `server` param still carries only a profile name).
- **New ADR — Epic 19 (decision E1).** *Framework-provided discovery tool over per-package tool.* Register `iris_server_profiles` once in `server-base.ts` and reuse `profiles.ts` (roster + metadata) and `getEffectivePolicy` (policy) as the single source of truth, so the tool and the D6 resource never diverge. Reinforce "call-first" via the MCP server `instructions` field. *Rationale:* DRY + uniform cross-server coverage + drift-free, mirroring D2/D6. *Optional companion:* set the per-profile resource template's `list` callback to enumerate configured profile names, closing the same enumeration hole for resource-reading clients at near-zero cost.

### 4.3 New Epic

---

## Epic 19: Server & Governance Discovery

**Goal**: Give an AI client a callable, discover-first way to learn which server profiles are configured (with non-secret connection metadata) and what governance policy is in effect — so it never has to guess or read client config files. Closes the discoverability gap left by the advisory-only Epic 14 governance resource.

**Scope**: TypeScript-only, entirely in `@iris-mcp/shared`. A new **framework-provided** read tool registered centrally in the server base (appears on all five servers), reusing the existing profile registry and `getEffectivePolicy`. **No new ObjectScript — `BOOTSTRAP_VERSION` unchanged.** Built on the Epic 14 foundation. **Strictly additive — absent `IRIS_PROFILES`/`IRIS_GOVERNANCE`, the tool reports the single `default` profile and the default-seed policy; no existing tool, schema, or behavior changes.**

**Functional Requirements (new)**: FR127.

**Stories**:
- 19.0 Server & governance discovery tool (+ optional resource-enumeration enhancement) + docs

**Out of scope (deferred)**:
- Profile/policy **hot-reload** — config is still read at startup (consistent with Epic 14 D7); discovery reports the current in-memory state.
- Returning **secrets** of any kind (passwords, tokens) — never.
- A generalized `ResourceDefinition` framework — still YAGNI (Epic 14 D6 stands).

### Story 19.0: Server & Governance Discovery Tool

**As an** AI client connected to a suite server,
**I want** a single tool that reports the configured server profiles (with non-secret connection metadata) and the effective governance policy,
**so that** I can choose the right `server` profile and avoid blocked actions without reading the client's config files or guessing.

**Acceptance Criteria**:
- **AC 19.0.1** — A new read tool (proposed name `iris_server_profiles`; final name confirmed in dev) is **registered centrally in `@iris-mcp/shared` `server-base.ts`** — framework-provided, NOT added to any package `tools/index.ts` — so it is present on all five servers (dev, admin, interop, ops, data) without per-package wiring.
- **AC 19.0.2** — Output includes a **profile roster**: for each configured profile, `{ name, isDefault, host, port, username, namespace, https, baseUrl, timeout }`. The `password` field is **never** included in the output (verified by an explicit assertion). Roster is built from the profile registry (`profiles.ts`).
- **AC 19.0.3** — Output includes the **effective governance policy** (enabled/disabled action map) computed via the existing `getEffectivePolicy` — the same source the D6 resource uses — so the tool and resource cannot drift. The tool accepts an optional `profile` argument selecting which profile's policy to report (defaults to `default`), and an optional flag to return policy for **all** profiles.
- **AC 19.0.4** — Governance classification: the tool is `mutates: "read"` → **default-enabled**; it is a new non-baseline key and does **not** modify the frozen baseline (`1e62c5ad5bf7`). `assertGovernanceClassification` passes at registration.
- **AC 19.0.5** — The tool **description** instructs the client to call it **first** to discover available profiles and governance before invoking other tools. The MCP server **`instructions`** field (set on the shared server base) reinforces the same guidance so capable clients surface it at connect time.
- **AC 19.0.6** — **Back-compat (mechanical proof, Rule #19):** with neither `IRIS_PROFILES` nor `IRIS_GOVERNANCE` set, the tool reports exactly one profile (`default`, with today's `IRIS_*`-derived connection metadata) and the default-seed policy (every baseline action enabled). A test asserts this "off" state and asserts no existing tool/schema/output changed.
- **AC 19.0.7** — **(Optional companion, recommended)** the per-profile governance resource template's `list` callback enumerates the configured profile names, so resource-reading clients can also discover the roster via `resources/templates/list`. If included, covered by a test; if deferred, recorded as a follow-up.
- **AC 19.0.8** — Unit tests: roster shape + **password-absence assertion**, policy correctness vs `getEffectivePolicy`, optional-`profile` + all-profiles selection, default-only back-compat, presence of the tool on a representative server, governance classification.
- **AC 19.0.9** — Docs rollup: root `README.md` + every per-package README + `tool_support.md` + `iris-mcp-all` document the new tool, its **call-first** guidance, and that it is a **read** (enabled by default) per Rule #30; per-server tool counts bumped; CHANGELOG entry.

**Implementation Notes**:
- Mirror the central-registration mechanics of D2 (`server` injection) / D6 (resource) — the tool is wired once in `server-base.ts`.
- Reuse `profiles.ts` for the roster and `getEffectivePolicy` (`governance.ts`) for policy; do not duplicate either.
- Redaction is the one safety-critical line: construct the output by **allow-listing** non-secret fields, not by deleting `password` from a spread (so a future field addition can't accidentally leak).
- Lead per-story smoke (Rule #22 / #26): drive the built artifact / live server, confirm the roster excludes the password and the policy matches the resource.

### 4.4 sprint-status.yaml addition (applied on approval)

```yaml
  # Epic 19: Server & Governance Discovery
  # Added 2026-06-18 via bmad-correct-course. See sprint-change-proposal-2026-06-18.md.
  # TypeScript-only (shared). No BOOTSTRAP_VERSION bump. Built on Epic 14. Strictly additive.
  epic-19: backlog
  19-0-server-and-governance-discovery-tool: backlog
```

---

## 5. Implementation Handoff

**Scope classification: Moderate** — a shared-core framework addition (every server inherits the tool), but small, fully designed, and strictly additive.

**Routing:**
1. **Architect (Winston)** — quick confirm of decision **E1** (framework-provided tool + reuse of `profiles.ts`/`getEffectivePolicy` + the `instructions`-field approach). This is a sign-off, not a replan.
2. **Scrum Master (Bob)** — run `/epic-cycle 19`: create Story 19.0 from this proposal and drive the cycle (dev → QA → review → retro).
3. **Dev (Amelia)** — implement Story 19.0 per the ACs; honor the redaction allow-list and governance classification.
4. **QA / Review** — verify the password-absence assertion, the tool↔resource non-drift (shared `getEffectivePolicy`), and the default-only back-compat proof.

**Sequencing & dependencies:**
- No prerequisites — Epic 14 foundation is `done`. Epic 19 can start immediately.
- No `BOOTSTRAP_VERSION` bump (no ObjectScript).

**Guardrails (project rules the dev/review agents must apply):**
- **Rule #19 / #23:** strictly additive; mechanical back-compat proof for the "off" (no-config) state; frozen baseline untouched.
- **Rule #28:** the new tool MUST carry `mutates: "read"` or registration throws.
- **Rule #30:** the docs rollup must state the tool is a **read** (enabled by default).
- **Rule #22 / #26:** lead smoke against the built artifact / live server, asserting password absence.
- **No breaking changes (hard constraint):** absent both env vars, behavior is byte-for-byte today's plus the new (optional-to-call) tool.

**Success criteria:**
- FR127 demonstrably satisfied: one call returns the profile roster (no password) + effective governance policy.
- The tool is present on all five servers and is enabled by default.
- Tool output and the D6 resource agree (shared `getEffectivePolicy`).
- Default-only config regression-verified; frozen baseline + `BOOTSTRAP_VERSION` unchanged.
- Docs + CHANGELOG updated; per-server tool counts rolled up.

**Open items carried into implementation (non-blocking):**
- Final tool name (`iris_server_profiles` proposed) — confirm in dev against the `iris_server_*` family.
- Whether to ship the optional resource-enumeration companion (AC 19.0.7) now or defer — dev's call, recorded either way.
