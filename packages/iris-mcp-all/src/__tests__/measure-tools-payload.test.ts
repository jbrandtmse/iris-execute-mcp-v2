/**
 * Story 30.2, AC 30.2.3 — default-suite vitest sanity check for
 * `scripts/measure-tools-payload.mjs`'s core measurement logic.
 *
 * `@iris-mcp/all` is the only package that depends on all five server
 * packages, so — per Rule #45 — it is the only place a cross-package
 * measurement sanity check can live without `@iris-mcp/shared` importing a
 * leaf package (circular). Mirrors `validate-prompts.test.ts`'s pattern:
 * import the SAME core module the CLI script uses
 * (`scripts/lib/measure-tools-payload-core.mjs`), plus the same
 * `scripts/lib/tool-catalog.mjs` dist loader, so the logic is single-sourced.
 *
 * `pnpm turbo run test` declares `test: { dependsOn: ["build"] }`, and this
 * package's own `build` (phantom, no own build script) still triggers
 * `^build` for its five `dependencies` transitively — so the dists (incl.
 * `@iris-mcp/shared`'s `dist/index.js`, which exports `McpServerBase`) exist
 * by the time this test runs.
 *
 * Cheap on purpose (one server × one preset, per the story's "a tiny sanity
 * test... if cheap" note) — the FULL measurement run across all 5 servers ×
 * 3 presets is `pnpm measure:tools-payload`, run manually and pasted into the
 * story's Completion Notes + the root README (not re-run on every `vitest
 * run`).
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SERVER_PACKAGES } from "../../../../scripts/lib/tool-catalog.mjs";
import {
  measureOne,
  buildMarkdownTable,
} from "../../../../scripts/lib/measure-tools-payload-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const root = resolve(__dirname, "../../../..");

describe("measure-tools-payload core logic (AC 30.2.3)", () => {
  it("measureOne produces a non-empty, well-shaped payload measurement for one real server × preset", async () => {
    const pkg = SERVER_PACKAGES[0]!; // iris-dev-mcp
    const pkgJson = JSON.parse(
      await (await import("node:fs/promises")).readFile(
        resolve(root, `packages/${pkg}/package.json`),
        "utf-8",
      ),
    );
    const toolsMod = await import(
      pathToFileURL(resolve(root, `packages/${pkg}/dist/tools/index.js`)).href
    );
    const presetsMod = await import(
      pathToFileURL(resolve(root, `packages/${pkg}/dist/tools/presets.js`)).href
    );
    const sharedMod = await import(
      pathToFileURL(resolve(root, "packages/shared/dist/index.js")).href
    );
    const { McpServerBase } = sharedMod as { McpServerBase: unknown };
    expect(typeof McpServerBase).toBe("function");

    const measurement = await measureOne(
      McpServerBase,
      { name: pkgJson.name, version: pkgJson.version },
      toolsMod.tools,
      presetsMod.toolPresets,
      "core",
    );

    expect(measurement.count).toBeGreaterThan(0);
    expect(measurement.bytes).toBeGreaterThan(0);
    expect(measurement.tokens).toBe(Math.round(measurement.bytes / 4));

    // buildMarkdownTable renders a non-empty table row for this measurement.
    const table = buildMarkdownTable([
      {
        name: pkgJson.name,
        rows: { full: measurement, core: measurement, developer: measurement },
      },
    ]);
    expect(table).toContain(pkgJson.name);
    expect(table).toContain("Tool Visibility Presets");
    expect(table.length).toBeGreaterThan(0);
  });
});
