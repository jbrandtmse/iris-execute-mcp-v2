/**
 * `recover-stuck-production` prompt (Epic 25, Story 25.1 — spec
 * `03-skills-prompts-pack.md` §3).
 *
 * Encodes the Epic-20 production-recovery escalation ladder: `recover`
 * FIRST, `clean` only as a last resort, and `killAppData` NEVER without the
 * user's explicit, informed acceptance of persistent business-state loss
 * (a double confirmation gate). Server: iris-interop-mcp.
 */

import type { PromptDefinition } from "@iris-mcp/shared";
import { argOrPlaceholder as arg, isArgProvided } from "@iris-mcp/shared";

export const recoverStuckProductionPrompt: PromptDefinition = {
  name: "recover-stuck-production",
  title: "Recover Stuck Production",
  description:
    "Diagnose and recover a troubled/wedged Interoperability production, following the " +
    "recover-first, clean-last-resort escalation ladder. Never suggests killAppData " +
    "without the user's explicit acceptance of persistent business-state loss.",
  arguments: [
    {
      name: "production",
      description: "Production class name (if known). Omit to discover it via iris_production_status.",
      required: false,
    },
    {
      name: "namespace",
      description: "Target namespace (default: the server's configured namespace).",
      required: false,
    },
  ],
  build: (args) => {
    const production = arg(args.production, "<production>");
    const namespace = arg(args.namespace, "<namespace>");
    const namespaceNote =
      isArgProvided(args.namespace)
        ? `Target namespace: "${namespace}" — pass \`namespace: "${namespace}"\` on every tool call below.`
        : `No namespace specified — omit \`namespace\` to use the server's configured default on every call below.`;
    const productionNote =
      isArgProvided(args.production)
        ? `Production: \`${production}\`.`
        : `No production class name given — discover it from \`iris_production_status\` (its \`name\` field) in step 1.`;

    return `# Recover Stuck Production

${productionNote}
${namespaceNote}

**Escalation ladder — follow IN ORDER, do not skip ahead:**

1. Call \`iris_production_status\` (with \`detail: true\`) to see the current production name and state (Running/Stopped/Suspended/Troubled/NetworkStopped).
2. Call \`iris_production_summary\` (cross-namespace, no namespace param) and \`iris_production_queues\` to locate stuck or backed-up items — queues that are not draining, items reporting errors.
3. For each stuck/errored item, call \`iris_production_logs\` filtered by \`itemName\` and/or \`type: "Error"\` to understand what is actually wrong.
4. **Try \`iris_production_control\` action 'recover' FIRST** (pass \`name: "${production}"\` if known). This attempts to restart a troubled production without touching stored state.
5. Re-check status (\`iris_production_status\`) — if the production is now healthy, STOP here; report success.
6. **Only if still wedged after 'recover'**, call \`iris_production_control\` action 'clean' — this clears STALE TRANSIENT runtime state (queues, job-status, suspended messages) that 'recover' cannot fix. This is a last resort, not a first response.
7. **NEVER suggest \`killAppData: true\`** on the 'clean' action unless the user has EXPLICITLY and knowingly accepted that it wipes PERSISTENT \`Ens.AppData\` business state (HL7 sequence numbers, file/FTP done-file tables — wiping these causes re-ingestion and DUPLICATE messages — and RecordMap/X12 batch/control-number state). If considering it, first explain the consequence to the user IN FULL and require an explicit "yes, I accept the data loss" before passing \`killAppData: true\` AND \`confirm: true\` together (both are required; this is a deliberate double confirmation gate).
8. After any recovery action, re-check \`iris_production_status\` to verify a healthy restart before reporting success.`;
  },
};
