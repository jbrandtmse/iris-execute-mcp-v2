/**
 * Story 25.1, AC 25.1.4 — CR 24.0-1 / Rule #44 `readOnlyHint` cross-check.
 *
 * `@iris-mcp/all` is the only package that depends on all five server
 * packages, so it is the only place a test needing every tool's
 * `annotations` can live (mirrors `validate-prompts.test.ts`'s placement
 * rationale). Default suite (Rule #21) — NOT `*.integration.test.ts`.
 *
 * For every key in `BASELINE_ACTION_CLASSIFICATIONS` (`@iris-mcp/shared`)
 * classified `"read"`, this test looks up the owning tool (via the SAME
 * `deriveKeysForTool` derivation the enforcement gate and the baseline
 * generator use — `governance-baseline-derivation.js` — so a key here lines
 * up exactly with `BASELINE_ACTION_CLASSIFICATIONS`'s key space) and asserts
 * the tool's `annotations.readOnlyHint !== false`, UNLESS the key carries an
 * explicit justification in {@link JUSTIFIED_READONLYHINT_DIVERGENCES} below.
 *
 * Fail-safe direction (AC 25.1.4): an unexplained `read` + `readOnlyHint:false`
 * divergence FAILS the test — the intended remediation is to either
 * reclassify the key to `"write"` in `baseline-classifications.ts`, or (if
 * genuinely a false positive) add a reviewed justification entry here.
 *
 * This is a FLAG-FOR-REVIEW oracle (Rule #44), not a full/runtime-complete
 * one: MCP `annotations` are TOOL-scoped, not per-action, so a multi-action
 * tool that ALSO has write actions legitimately shows `readOnlyHint:false`
 * at the tool level even when a SPECIFIC action is genuinely read-only (the
 * tool's own source comments — e.g. `serviceManageTool`'s doc comment — make
 * this explicit: "MCP annotations are tool-scoped; the per-action read/write
 * distinction is realized through `mutates`"). Each justified entry below
 * was verified by reading that action's OWN handler branch (TS + the
 * backing ObjectScript REST handler where the action is dispatched by a
 * body field rather than a distinct HTTP verb), not merely inferred from
 * the tool's write actions existing — this is exactly the discipline that
 * caught the two real CR 24.0-1 misclassifications
 * (`iris_oauth_manage:discover`, `iris_transform_test`), which are NOT in
 * this allowlist because they were reclassified to `"write"` instead.
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAllTools } from "../../../../scripts/lib/tool-catalog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> packages/shared/ is 3 levels up.
const root = resolve(__dirname, "../../../..");
const sharedDist = resolve(root, "packages/shared/dist");

/**
 * Justified `read` + tool-level `readOnlyHint:false` divergences (Rule #44).
 * Every entry was verified live (Story 25.1 dev, cross-referencing the TS
 * handler branch and, for the 7 keys whose tool dispatches all actions
 * through a single `ctx.http.post` distinguished only by an `action` body
 * field, the backing ObjectScript REST handler's `If tAction = "..."`
 * branch) to confirm the SPECIFIC action performs no IRIS-state mutation,
 * even though the owning tool ALSO has other write actions.
 */
const JUSTIFIED_READONLYHINT_DIVERGENCES: Record<string, string> = {
  "iris_analytics_cubes:list":
    "dedicated GET branch (analytics.ts); build/sync use a separate POST.",
  "iris_config_manage:export":
    "POST body action:'export' dispatches to SystemConfig.cls ExportConfig() — reads system info + config only.",
  "iris_config_manage:get":
    "POST body action:'get' dispatches to SystemConfig.cls GetConfig() — reads Config/Startup/Locale only.",
  "iris_doc_xml_export:export":
    "Atelier action/xml/export bulk-export endpoint returns an XML representation; POST is transport for the docs[] array, no doc mutation.",
  "iris_doc_xml_export:list":
    "Atelier action/xml/list parses a CALLER-SUPPLIED XML string; never touches stored documents.",
  "iris_docdb_document:get": "dedicated GET branch (docdb.ts); insert/update/delete use post/put/delete.",
  "iris_docdb_manage:list": "dedicated GET branch (docdb.ts); create/drop use post/delete.",
  "iris_interop_rest:get":
    "POST body action:'get' dispatches to Interop.cls RestManage() action=get — calls %REST.API.GetApplication() (read-only); only create/delete mutate.",
  "iris_lookup_manage:get":
    "POST body action:'get' dispatches to LookupManage() action=get — $Get/$Data on ^Ens.LookupTable, no Set/Kill.",
  "iris_lookup_transfer:export":
    "POST body action:'export' dispatches to LookupTransfer() action=export — walks ^Ens.LookupTable via $Order/$Get, builds an XML string, no global writes.",
  "iris_production_autostart:get":
    "POST body action:'get' dispatches to AutoStart() action=get — a bare $Get(^Ens.AutoStart).",
  "iris_production_item:get":
    "POST body action:'get' dispatches to ItemManage() action=get — a SELECT ... FROM Ens_Config.Item SQL query only.",
  "iris_rest_manage:get": "dedicated GET branch (spec-first) / delete uses ctx.http.delete separately.",
  "iris_rest_manage:list": "all list-scope branches use GET only (mgmnt/v2 + legacy security/webapp fallback).",
  "iris_user_password:validate":
    "POST body action:'validate' dispatches to Security.cls UserPassword() action=validate — Security.System.Get + $SYSTEM.Security.ValidatePassword() only; the write path (Security.Users.Modify) is exclusively under action='change', never reached here.",
};

describe("BASELINE_ACTION_CLASSIFICATIONS readOnlyHint cross-check (CR 24.0-1 / Rule #44)", () => {
  it("every baseline key classified 'read' has an owning tool with readOnlyHint !== false, or a reviewed justification", async () => {
    const { deriveKeysForTool } = await import(
      pathToFileURL(resolve(sharedDist, "governance-baseline-derivation.js")).href
    );
    const { BASELINE_ACTION_CLASSIFICATIONS } = await import(
      pathToFileURL(resolve(sharedDist, "baseline-classifications.js")).href
    );

    const allTools = await loadAllTools(root);

    // key -> tool, built from the SAME derivation the enforcement gate and
    // the baseline generator use, so keys line up exactly with
    // BASELINE_ACTION_CLASSIFICATIONS's key space.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keyToTool = new Map<string, any>();
    for (const { pkg, tool } of allTools) {
      for (const key of deriveKeysForTool(tool, pkg)) {
        keyToTool.set(key, tool);
      }
    }

    const unexplained: string[] = [];
    const readKeys = Object.entries(
      BASELINE_ACTION_CLASSIFICATIONS as Record<string, string>,
    ).filter(([, classification]) => classification === "read");

    // Sanity: this must be a non-trivial slice of the 141-key frozen
    // baseline (a bug that made BASELINE_ACTION_CLASSIFICATIONS import as
    // empty/malformed would otherwise silently pass the loop below).
    expect(readKeys.length).toBeGreaterThan(0);

    for (const [key] of readKeys) {
      const tool = keyToTool.get(key);
      // A baseline key with no owning live tool is a vanished-key
      // regression, already caught by the governance-baseline drift test
      // (Rule #23/#25) — out of scope for this readOnlyHint check.
      if (!tool) continue;
      if (tool.annotations?.readOnlyHint === false && !(key in JUSTIFIED_READONLYHINT_DIVERGENCES)) {
        unexplained.push(key);
      }
    }

    expect(unexplained).toEqual([]);
  });

  it("every justified divergence is still classified 'read' and its owning tool's readOnlyHint is still false (no stale allowlist entries)", async () => {
    const { deriveKeysForTool } = await import(
      pathToFileURL(resolve(sharedDist, "governance-baseline-derivation.js")).href
    );
    const { BASELINE_ACTION_CLASSIFICATIONS } = await import(
      pathToFileURL(resolve(sharedDist, "baseline-classifications.js")).href
    );
    const allTools = await loadAllTools(root);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keyToTool = new Map<string, any>();
    for (const { pkg, tool } of allTools) {
      for (const key of deriveKeysForTool(tool, pkg)) {
        keyToTool.set(key, tool);
      }
    }

    for (const key of Object.keys(JUSTIFIED_READONLYHINT_DIVERGENCES)) {
      expect(
        (BASELINE_ACTION_CLASSIFICATIONS as Record<string, string>)[key],
        `${key} is no longer in BASELINE_ACTION_CLASSIFICATIONS or is no longer classified "read" — remove its stale allowlist entry`,
      ).toBe("read");
      const tool = keyToTool.get(key);
      expect(tool, `${key} has no owning live tool — remove its stale allowlist entry`).toBeDefined();
      // The justification exists ONLY because the owning tool declares a
      // tool-level readOnlyHint:false. If the tool later flips to
      // readOnlyHint:true/undefined the divergence is gone and the entry is
      // stale dead weight — fail so it gets removed (matches this test's title).
      expect(
        tool.annotations?.readOnlyHint,
        `${key}'s owning tool no longer declares readOnlyHint:false — the divergence is gone, remove its stale allowlist entry`,
      ).toBe(false);
    }
  });
});
