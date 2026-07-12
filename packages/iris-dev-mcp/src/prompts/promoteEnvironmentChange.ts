/**
 * `promote-environment-change` prompt (Epic 27, Story 27.4 — spec
 * `03-skills-prompts-pack.md` §3, previously **gated** on Spec 05 until
 * `iris_env_diff`/`iris_env_promote` shipped in Stories 27.0-27.3).
 *
 * Encodes the review-before-write `iris_env_diff` → `iris_env_promote`
 * workflow: a scoped diff, review of the drift + `onlyInTarget` warnings
 * WITH the user, a generated plan, an explicit user-selected step allowlist,
 * a confirmed execute, and a re-diff to verify the promotion actually took.
 * States the no-deletions guarantee, the credential-redaction/secrets-
 * exclusion promise, and that `execute` is governance-default-disabled (a
 * calling-profile tool-governance key; the TARGET profile SEPARATELY gates
 * the underlying write families). Server: iris-dev-mcp.
 *
 * **Rule #47 divergence note:** the binding spec's §3 table entry describes
 * this prompt as "`iris_env_diff` (scoped by `spec`)", implying `spec` is
 * always part of the call. The SHIPPED tool's actual default `domains`
 * (Story 27.1 cycle-2 rework, `env-diff.ts` `DEFAULT_DIFF_DOMAINS`) is the
 * FOUR no-`spec` config domains — `mappings`, `defaultSettings`, `webapps`,
 * `config`; `documents` (the only domain that needs `spec`) is OPT-IN only,
 * specifically so a bare `iris_env_diff(source, target)` call never fails
 * for omitting one. This prompt is written against the SHIPPED behavior —
 * `spec` is an OPTIONAL argument here, meaningful only when the workflow
 * also adds `"documents"` to `domains`.
 */

import type { PromptDefinition } from "@iris-mcp/shared";
import { argOrPlaceholder as arg, isArgProvided } from "@iris-mcp/shared";

export const promoteEnvironmentChangePrompt: PromptDefinition = {
  name: "promote-environment-change",
  title: "Promote Environment Change",
  description:
    "Review and promote configuration/code drift from a source IRIS environment to a target " +
    "using the review-before-write iris_env_diff -> iris_env_promote workflow (scoped diff, " +
    "plan, an explicit user-selected step allowlist, confirmed execute, re-diff verify). Never " +
    "acts on onlyInTarget warnings -- never deletes a target-only item, in any action.",
  arguments: [
    {
      name: "source",
      description:
        "Source profile name (from IRIS_PROFILES, or 'default') -- the environment to promote FROM.",
      required: true,
    },
    {
      name: "target",
      description:
        "Target profile name (from IRIS_PROFILES, or 'default') -- the environment to promote TO. " +
        "iris_env_promote's execute action ADDITIONALLY requires the TARGET profile's own governance " +
        "to permit the underlying write families it uses (a separate gate from the execute key itself).",
      required: true,
    },
    {
      name: "spec",
      description:
        "Document spec for the 'documents' domain (e.g. 'MyPkg.*.cls,*.mac'). Only meaningful if " +
        "the workflow should ALSO diff ObjectScript source -- omit to compare just " +
        "mappings/defaultSettings/webapps/config (iris_env_diff's default, no spec needed).",
      required: false,
    },
  ],
  build: (args) => {
    const source = arg(args.source, "<source>");
    const target = arg(args.target, "<target>");
    const spec = arg(args.spec, "<spec>");
    const specGuidance = isArgProvided(args.spec)
      ? `To ALSO compare ObjectScript source, add \`"documents"\` to \`domains\` and pass ` +
        `\`spec: "${spec}"\` — required only for the \`documents\` domain (a bare \`*\` is refused ` +
        `unless \`allowWide: true\` is also passed).`
      : `To ALSO compare ObjectScript source, add \`"documents"\` to \`domains\` and pass a \`spec\` ` +
        `(e.g. \`"MyPkg.*.cls,*.mac"\`) — required only for the \`documents\` domain; a bare \`*\` is ` +
        `refused unless \`allowWide: true\`. No \`spec\` is needed for the four domains listed above.`;

    return `# Promote Environment Change

Source profile: \`${source}\`
Target profile: \`${target}\`

GOVERNANCE: \`iris_env_promote\`'s \`execute\` action is a write and is **DEFAULT-DISABLED** under tool governance (its sibling \`plan\`, and \`iris_env_diff\` itself, are reads and enabled by default). This tool-governance key is checked on the CALLING profile, so enable it with \`global\` scope. If \`execute\` is refused with \`GOVERNANCE_DISABLED\`, tell the user it must be explicitly enabled via \`IRIS_GOVERNANCE\`, e.g.:
\`{"global": {"iris_env_promote:execute": true}}\`
Separately, \`execute\` ALSO requires the TARGET profile's own governance to permit the underlying write families the promotion uses — that is a DISTINCT gate with its own refusal message (not \`GOVERNANCE_DISABLED\`); if you hit it, the target profile must enable the named write family. Do NOT attempt a workaround — surface the refusal and the enable snippet to the user.

SAFETY: \`iris_env_promote\` never deletes a TARGET-ONLY item — anything that exists only on the target is never removed, in any action, in any version. Items that exist on the target only (\`onlyInTarget\` entries in the diff, carried into the plan as \`warnings\`) are INFORMATIONAL ONLY — never propose or attempt to remove them. System Default Settings values that look like credentials (setting name contains password/secret/key/token/pwd/passphrase/credential/cert/private/salt) are REDACTED in both diff and plan output — their plaintext never appears in any tool result. Credentials/users/roles promotion is out of scope entirely — this workflow only ever touches mappings, ObjectScript source, System Default Settings, web applications, and the ~11 supported CPF config properties.

**REVIEW-BEFORE-WRITE workflow — follow IN ORDER, do not skip ahead:**

1. Call \`iris_env_diff\` with \`source: "${source}"\`, \`target: "${target}"\`. Omitting \`domains\` compares the FOUR no-spec config domains (\`mappings\`, \`defaultSettings\`, \`webapps\`, \`config\`) — no \`spec\` needed for these. ${specGuidance}
2. Review the diff report WITH the user: how many items drifted per domain, are the \`onlyInSource\`/\`differs\` entries genuine promotion candidates, and note (never act on) any \`onlyInTarget\` entries. If the diff's \`errors\` field names a domain that failed, the rest of the diff is still usable — the failure is isolated to that one domain. Re-run step 1 with a different \`domains\` list if the scope looks wrong.
3. Only after the user has reviewed the diff: call \`iris_env_promote\` with \`action: "plan"\`, the SAME \`source\`/\`target\`, and \`diff\` set to the FULL \`structuredContent\` from step 1. This returns an ordered, numbered step list (grouped mappings → documents → defaultSettings → webapps → config) plus a \`planHash\`. Review the steps with the user and have them pick an EXPLICIT list of step indices to promote — never assume "all of them" without asking.
4. Only after the user EXPLICITLY approves: call \`iris_env_promote\` again with \`action: "execute"\`, the SAME \`source\`/\`target\`/\`diff\`, the \`plan\` from step 3, \`steps\` set to the user's chosen index list, and \`confirm: true\` (\`steps\` and \`confirm\` are both required — omitting either, an out-of-range step index, or a stale \`diff\`/\`plan\` pair, is refused with no changes made). Execution halts on the first failed step and reports completed/failed/skipped per step — a partial apply is always visible, never hidden.
5. Re-run \`iris_env_diff\` from step 1 (same \`source\`/\`target\`/\`domains\`) to verify the promoted items are no longer reported as drifted — a promoted item drops out of \`onlyInSource\`/\`differs\` and rolls into the domain's \`identical\` count. Confirm the drift you promoted is actually gone before telling the user the promotion succeeded. Report any items that are still drifted (e.g. a step that failed in step 4) rather than assuming success.`;
  },
};
