# Spec 03 — MCP Prompts Capability + Agent Skills Pack

**Server:** `@iris-mcp/shared` (framework) + per-package prompt content + repo `skills/` dir
**Priority:** 3 (quick win) | **Effort:** ~3 stories | **Governance:** prompts are not tools — no keys
**Prereqs:** none (two prompts are gated: `resend-failed-messages` on Spec 04, `promote-environment-change` on Spec 05 — omit each until its feature ships)
**Read first:** [`00-conventions.md`](00-conventions.md), `packages/shared/src/server-base.ts`
(resources capability wiring — prompts mirror it), MCP SDK prompts docs
(`@modelcontextprotocol/sdk` — the server class used in server-base.ts), `.claude/rules/iris-objectscript-basics.md`
(source material), `tool_support.md` (tool names ground truth)

## 1. Objective

Package the suite's expertise as (a) **MCP prompts** — parameterized, workflow-shaped
instructions served via the protocol's `prompts` capability, discoverable by every MCP client —
and (b) an installable **`skills/` directory** for Claude Code/Copilot skill loaders. This is
the direct answer to iris-agentic-dev's most-praised feature (its ObjectScript skills), and it
multiplies the value of the existing 100 tools by teaching clients the *sequences*.

## 2. Framework work — `prompts` capability

Extend `McpServerBase` (`server-base.ts`) with prompt registration, mirroring how tools and
resources are registered:

```typescript
export interface PromptDefinition {
  name: string;                       // kebab-case, e.g. "diagnose-slow-query"
  title: string;
  description: string;                // when a client should offer this prompt
  arguments: Array<{ name: string; description: string; required: boolean }>;
  build(args: Record<string, string>): string;  // returns the prompt text (user-role message)
}
```

- Constructor accepts an optional `prompts: PromptDefinition[]`; servers advertise the
  `prompts` capability ONLY when the array is non-empty; wire `prompts/list` and `prompts/get`
  through the SDK's registration API (find the SDK's prompt-registration method — it exists in
  the SDK version in use; if the installed SDK predates it, upgrade is out of scope: instead
  implement the two request handlers directly, matching how resources handlers are wired).
- `prompts/get` with unknown name → standard JSON-RPC error matching SDK conventions.
- **Back-compat (Rule #19):** with no prompts registered, capability absent and server
  behavior byte-for-byte unchanged — mechanical snapshot test on the advertised capabilities.
- Counting/docs: prompts do NOT change tool counts anywhere. Document as a framework surface
  (Rule #31 shape): per-server README section "Prompts", suite README section, CHANGELOG.

## 3. Prompt & skill content (the pack)

Each prompt names EXACT tool names/params and safe ordering; every referenced tool must exist
(validated — §4). Ship v1 with these eleven — 9 non-gated + 2 gated (list stakeholder-approved
2026-07-07; the two ops/interop safety additions were approved in the same session):

| Prompt (server) | Arguments | Workflow it encodes |
|---|---|---|
| `check-system-health` (ops) | `server?` | `iris_health_check` (Spec 01; until it ships: metrics→journal→mirror→locks→license sequence) → interpret → name the fixing tool per finding |
| `diagnose-slow-query` (dev) | `query`, `namespace?` | `iris_sql_analyze:explain` → `:indexUsage` → `:stats` → interpretation checklist (full-scan markers, missing-index reasoning) → recommend, never auto-apply |
| `trace-message-flow` (interop) | `sessionOrHeaderId`, `namespace?` | `iris_production_messages` → `iris_message_diagram` → `iris_production_logs` for erroring items → summarize failure point |
| `provision-project-environment` (admin) | `projectName` | `iris_database_manage:create` ×2 → `iris_namespace_manage:create` → `iris_user_manage:create` → `iris_webapp_manage:create` → verify each step before next; rollback notes |
| `audit-security-posture` (admin) | `server?` | `iris_user_get` list → `iris_role_list` → `iris_service_manage:list` → `iris_ssl_list` → `iris_audit_manage:status` → report: default passwords, %All holders, insecure services |
| `objectscript-review` (dev) | none | Distill `.claude/rules/iris-objectscript-basics.md` + testing rules into a ≤300-word pre-write checklist ($$$ macros, Quit-in-try/catch, %OnNew/initvalue, no-underscore names, storage sections untouchable) |
| `deploy-and-test-class` (dev) | `classOrPackage` | `iris_doc_load` (glob-path form!) → compile errors loop → `iris_execute_tests` → **compare returned total vs expected (Rule #35)** → rerun if short |
| `recover-stuck-production` (interop) | `production?`, `namespace?` | `iris_production_status` → `iris_production_summary` + `iris_production_queues` (locate stuck/errored items) → `iris_production_logs` for those items → try `iris_production_control:recover` FIRST → re-check status → only if still wedged: `clean` (clears transient runtime state; refuses while running) → NEVER suggest `killAppData` unless the user explicitly accepts persistent business-state loss (confirm double-gate) → verify healthy restart. Encodes the Epic-20 escalation ladder from the server `instructions` field |
| `run-external-backup` (ops) | `server?` | `iris_journal_info` pre-check → `iris_backup_manage` freeze → verify frozen → PAUSE for the external snapshot (user confirms completion) → `iris_backup_manage` thaw **ALWAYS, even if the snapshot failed** → `iris_journal_info` verify journaling resumed → `iris_backup_manage` history to record the run. Safety notes: freeze suspends writes instance-wide; the workflow must never end with the instance frozen |
| `resend-failed-messages` (interop) | `item`, `since` | **GATED on Spec 04** — omit from registration until `iris_message_resend` ships |
| `promote-environment-change` (dev) | `source`, `target`, `spec?` | **GATED on Spec 05** — omit until `iris_env_diff`/`iris_env_promote` ship. `iris_env_diff` (scoped by `spec`) → review drift report + warnings with the user → `iris_env_promote` `plan` → user selects an explicit step allowlist → `execute` with allowlist + `confirm:true` (note it is default-disabled by governance) → re-diff to verify clean. Never act on `onlyInTarget` warnings (no deletion steps exist) |

Skills mirror: `skills/<name>/SKILL.md` per prompt (Claude Code skill format: YAML frontmatter
`name`, `description`, then the same body). Add `skills/README.md` explaining installation
(copy into `.claude/skills/` or reference via config). Single source of truth: author content
ONCE in `packages/*/src/prompts/*.ts` and generate `skills/` from it via a small script
(`scripts/gen-skills.mjs`) with a DO-NOT-EDIT header on outputs (Rule #18) and a `--check` mode
(Rule #25 shape).

## 4. Validation (rot prevention)

`scripts/validate-prompts.mjs`: extracts every `iris_[a-z0-9_]+` token from all prompt bodies
and asserts each is a real tool name (import the five packages' tool arrays + framework tool
names). Wire it as a vitest test in the default suite so a tool rename breaks CI, not users.
Same script validates skills output is in sync with prompt sources (`gen-skills --check`).

## 5. Story breakdown

1. **Story 1 — Framework plumbing (1):** `PromptDefinition`, registration, capability
   advertisement, `prompts/list`/`get` handlers, back-compat snapshot test, empty-pack no-op.
2. **Story 2 — Content + generators (1):** author the 9 non-gated prompts, `gen-skills.mjs`
   (+`--check`), `validate-prompts.mjs` + default-suite test wiring.
3. **Story 3 — Docs + smoke (0.5–1):** README/per-server README/CHANGELOG rollup; live smoke:
   built dist through a real MCP client — `prompts/list` shows the pack, `prompts/get
   diagnose-slow-query` renders with an argument, and one full workflow (deploy-and-test-class
   against a scratch class on live IRIS) is executed end-to-end following only the prompt text.

## 6. Acceptance criteria

1. All 5 servers advertise `prompts` and serve the pack; per-server prompt sets are correct
   (ops prompts on ops, etc.; `objectscript-review` + `deploy-and-test-class` on dev).
2. Every tool name in every prompt/skill validates against the live catalog (CI test).
3. `skills/` is generated, header-stamped, and `gen-skills --check` passes; hand-editing a
   generated skill fails the check.
4. No-prompts back-compat snapshot green.
5. Live client smoke per Story 3, including one end-to-end workflow execution.
6. Docs rollup complete; tool counts UNCHANGED everywhere (assert package count tests did not move).
7. Conventions §6 checklist complete.

## 7. Out of scope

- Prompts that embed live data (schema-aware context injection — future).
- Copilot-specific skill packaging beyond the generic `skills/` layout.
- The `resend-failed-messages` prompt until Spec 04 lands; the `promote-environment-change` prompt until Spec 05 lands (each ships in its feature's closing docs story).
