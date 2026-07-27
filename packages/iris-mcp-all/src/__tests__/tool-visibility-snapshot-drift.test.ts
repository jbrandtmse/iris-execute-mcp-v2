/**
 * Story 32.3 (deferred item 30-0-3) — pre-feature snapshot drift gate.
 *
 * The Epic-30 Rule #19 back-compat capstone
 * (`packages/shared/src/__tests__/tool-visibility-backcompat.test.ts`)
 * protects a snapshot of each package's tool-name roster. That snapshot was
 * originally transcribed by hand from the spec table
 * (`research/feature-specs/11-tool-visibility-presets.md` §2.5) — a
 * hand-maintained copy of exactly the kind Rule #51 exists to catch: a
 * package adding/removing/renaming a tool would update its own
 * `index.test.ts` but nothing would force the snapshot to follow, leaving
 * the capstone proving the filter's no-op property over a STALE roster.
 *
 * `@iris-mcp/all` is the only package that depends on all five server
 * packages (Rule #45), so the drift check lives here: the snapshot
 * (single-sourced from `packages/shared/src/__tests__/pre-feature-tool-snapshot.ts`,
 * imported from its BUILT dist) must deep-equal each package's LIVE
 * built-dist `tools` array (via the SAME `scripts/lib/tool-catalog.mjs`
 * loader the other cross-package gates use). Exact-set equality in BOTH
 * directions: a name in the snapshot but not live, or live but not in the
 * snapshot, fails.
 *
 * Default suite (Rule #21) — NOT `*.integration.test.ts`. Requires a prior
 * `pnpm turbo run build` (mirrors every tool-catalog consumer).
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAllTools, SERVER_PACKAGES } from "../../../../scripts/lib/tool-catalog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const root = resolve(__dirname, "../../../..");

async function loadSnapshot(): Promise<Record<string, string[]>> {
  const snapshotPath = resolve(
    root,
    "packages/shared/dist/__tests__/pre-feature-tool-snapshot.js",
  );
  const mod = (await import(pathToFileURL(snapshotPath).href)) as {
    PRE_FEATURE_SNAPSHOTS: Record<string, string[]>;
  };
  return mod.PRE_FEATURE_SNAPSHOTS;
}

describe("Story 32.3 (30-0-3) — the pre-feature snapshot is SOURCE-DERIVED, not transcribed-and-trusted", () => {
  it("the snapshot deep-equals each package's LIVE built-dist tools array, per package, in both directions", async () => {
    const snapshot = await loadSnapshot();
    const all = await loadAllTools(root);

    const liveByPkg = new Map<string, string[]>();
    for (const { pkg, tool } of all) {
      const names = liveByPkg.get(pkg) ?? [];
      names.push(tool.name as string);
      liveByPkg.set(pkg, names);
    }

    // Coverage: the snapshot names exactly the five server packages — no
    // more, no fewer — and the loader saw all five too.
    expect(Object.keys(snapshot).sort()).toEqual([...SERVER_PACKAGES].sort());
    expect([...liveByPkg.keys()].sort()).toEqual([...SERVER_PACKAGES].sort());

    for (const pkg of SERVER_PACKAGES) {
      const snapshotNames = [...(snapshot[pkg] ?? [])].sort();
      const liveNames = [...(liveByPkg.get(pkg) ?? [])].sort();
      expect(
        snapshotNames,
        `${pkg}: pre-feature snapshot (${snapshotNames.length}) drifted from the live tools array (${liveNames.length}) — ` +
          `update packages/shared/src/__tests__/pre-feature-tool-snapshot.ts in the same change that adds/removes/renames the tool`,
      ).toEqual(liveNames);
    }
  });
});
