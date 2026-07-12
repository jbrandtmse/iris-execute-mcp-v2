/**
 * Story 29.3 (deferred-work burn-down) — CR 29.1-1.
 *
 * `deriveAuditAction` (`packages/shared/src/server-base.ts`) reads PRE-Zod
 * `rawArgs.action` while `computeGovernanceKey` reads POST-Zod
 * `validatedArgs.action`. For every SHIPPED tool's `action` field (a
 * required `z.enum([...])`, never `.default(...)`) the two agree — but a
 * FUTURE tool declaring `action: z.enum([...]).default("x")` would silently
 * diverge: an omitted `action` call would govern on the Zod-filled default
 * (`tool:x`) while the audit log would record `action: null`.
 *
 * `.default()`-wrapped action enums are a DELIBERATELY-supported shape in the
 * governance layer itself (`unwrapActionOptions` peels through
 * `.optional()`/`.default()`/`.nullable()`, exercised by Story 15.0's
 * `iris_wrapped_manage` synthetic test fixture) — so a registration-time ban
 * on the pattern would be wrong (and was rejected; see the sibling unit test
 * `packages/shared/src/__tests__/action-default-registration-guard.test.ts`).
 * The correct, additive guard is this MECHANICAL pin: no REAL, shipped tool's
 * `action` field carries a `.default(...)` today. `@iris-mcp/all` is the
 * only package depending on all five server packages (Rule #45), so this
 * cross-package check lives here, enumerating the live tool surface via the
 * SAME `loadAllTools` loader `readonly-hint-crosscheck.test.ts` /
 * `docs-prompt-sync.test.ts` use. Default suite (Rule #21) — NOT
 * `*.integration.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAllTools } from "../../../../scripts/lib/tool-catalog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> packages/shared/ is 3 levels up.
const root = resolve(__dirname, "../../../..");
const sharedDist = resolve(root, "packages/shared/dist");

describe("CR 29.1-1: no shipped tool's 'action' field carries a .default(...) (Story 29.3 burn-down)", () => {
  it("actionFieldHasDefault is false for every registered tool's 'action' field across all 5 server packages", async () => {
    const { actionFieldHasDefault } = await import(
      pathToFileURL(resolve(sharedDist, "governance.js")).href
    );

    const allTools = await loadAllTools(root);
    expect(allTools.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const { pkg, tool } of allTools) {
      const actionField = (tool.inputSchema as { shape?: Record<string, unknown> })?.shape
        ?.action;
      if (actionFieldHasDefault(actionField)) {
        offenders.push(`${pkg}:${tool.name}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
