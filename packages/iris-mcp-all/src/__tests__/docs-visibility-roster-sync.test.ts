/**
 * Story 30.3 QA — doc-rot guard for the Tool Visibility Presets docs rollup
 * (Epic 30 capstone, AC 30.3.1/30.3.4, Rule #45).
 *
 * Story 30.3 is docs + live-smokes only (no engine/roster/surfacing code
 * change) — the visibility ENGINE, ROSTERS, and SURFACING behaviors already
 * have complete real-runtime coverage from Stories 30.0-30.2's suites
 * (`tool-visibility.test.ts`, `tool-visibility.e2e.test.ts`,
 * `tool-visibility-backcompat.test.ts`, `presets.test.ts` x5,
 * `presets.e2e.test.ts` x5, `tool-visibility-surfacing.test.ts`,
 * `tool-visibility-non-drift.test.ts`, `measure-tools-payload.test.ts`).
 * None of those, however, protect the numbers the docs now HARD-CODE: the
 * root README's "Measured `tools/list` payload" table and "The rosters"
 * summary table both transcribe literal counts (Story 30.2's one-time
 * measurement run, carried verbatim into Story 30.3 per Rule #43/#52 — NOT
 * re-measured). If `presets.ts` ever changes in a future story without a
 * docs update, nothing in the existing suite would fail — every existing
 * roster test derives its OWN "ground truth" from the same `toolPresets`
 * object the docs were transcribed FROM, so it is blind to a docs/code
 * split. This file closes that gap: it re-derives the counts LIVE (the same
 * way `pnpm measure:tools-payload` — the script that produced the README
 * numbers — does) and diffs them against the literal numbers parsed out of
 * README.md.
 *
 * Per Rule #45, cross-package doc-consistency checks live in
 * `@iris-mcp/all` (the only package depending on all five server packages).
 * Requires a prior `pnpm turbo run build` (already a `test` task dependency
 * via `turbo.json`'s `test.dependsOn: ["build"]`).
 *
 * Default suite (`*.test.ts`, not `*.integration.test.ts` — Rule 8): a doc/
 * code drift breaks CI, not just a client mid-workflow.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readFile as readFileAsync } from "node:fs";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SERVER_PACKAGES } from "../../../../scripts/lib/tool-catalog.mjs";
import { measureOne } from "../../../../scripts/lib/measure-tools-payload-core.mjs";

const readFile = promisify(readFileAsync);

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const root = resolve(__dirname, "../../../..");

/** `iris-dev-mcp` -> `dev` (the short name README's tables key rows by). */
function shortNameOf(pkgDir: string): string {
  return pkgDir.replace(/^iris-/, "").replace(/-mcp$/, "");
}

interface PackageFixture {
  name: string;
  version: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolPresets: any;
}

async function loadPackage(pkgDir: string): Promise<PackageFixture> {
  const pkgJsonRaw = await readFile(resolve(root, `packages/${pkgDir}/package.json`), "utf-8");
  const pkgJson = JSON.parse(pkgJsonRaw) as { name: string; version: string };
  const toolsMod = (await import(
    pathToFileURL(resolve(root, `packages/${pkgDir}/dist/tools/index.js`)).href
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  )) as { tools: any[] };
  const presetsMod = (await import(
    pathToFileURL(resolve(root, `packages/${pkgDir}/dist/tools/presets.js`)).href
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  )) as { toolPresets: any };
  return {
    name: pkgJson.name,
    version: pkgJson.version,
    tools: toolsMod.tools,
    toolPresets: presetsMod.toolPresets,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadShared(): Promise<any> {
  return import(pathToFileURL(resolve(root, "packages/shared/dist/index.js")).href);
}

type Preset = "full" | "core" | "developer";

// ════════════════════════════════════════════════════════════════════
// Table 1 — root README's "Measured `tools/list` payload" table: runtime
// counts (package tools + iris_server_profiles) per server x preset.
// ════════════════════════════════════════════════════════════════════

interface PayloadRow {
  shortName: string;
  full: number;
  core: number;
  developer: number;
}

/** Parses `| @iris-mcp/dev | 29 / 53,404 / ~13,351 | 13 / ... | 29 / ... |` rows. */
function parsePayloadTable(readme: string): Map<string, PayloadRow> {
  const rowRe =
    /^\| @iris-mcp\/(\w+) \| (\d+) \/ [\d,]+ \/ ~[\d,]+ \| (\d+) \/ [\d,]+ \/ ~[\d,]+ \| (\d+) \/ [\d,]+ \/ ~[\d,]+ \|$/gm;
  const rows = new Map<string, PayloadRow>();
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = rowRe.exec(readme)) !== null) {
    const [, shortName, full, core, developer] = match;
    rows.set(shortName!, {
      shortName: shortName!,
      full: Number(full),
      core: Number(core),
      developer: Number(developer),
    });
  }
  return rows;
}

// ════════════════════════════════════════════════════════════════════
// Table 2 — root README's "The rosters" summary table: package-only counts
// (no +1 for iris_server_profiles) per preset x server, plus the
// "Package total" / "Runtime total" columns.
// ════════════════════════════════════════════════════════════════════

interface RosterRow {
  preset: Preset;
  dev: number;
  admin: number;
  interop: number;
  ops: number;
  data: number;
  packageTotal: number;
  runtimeTotal: number;
}

/** Parses `| **full** (default) | 28 | 26 | 22 | 21 | 7 | 104 | 109 |` rows. */
function parseRosterTable(readme: string): Map<Preset, RosterRow> {
  const rowRe =
    /^\| \*\*(full|developer|core)\*\*(?: \(default\))? \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/gm;
  const rows = new Map<Preset, RosterRow>();
  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = rowRe.exec(readme)) !== null) {
    const [, preset, dev, admin, interop, ops, data, packageTotal, runtimeTotal] = match;
    rows.set(preset as Preset, {
      preset: preset as Preset,
      dev: Number(dev),
      admin: Number(admin),
      interop: Number(interop),
      ops: Number(ops),
      data: Number(data),
      packageTotal: Number(packageTotal),
      runtimeTotal: Number(runtimeTotal),
    });
  }
  return rows;
}

describe("Tool Visibility Presets docs stay in sync with live rosters (Story 30.3, Rule #45 doc-rot guard)", () => {
  it("README's 'Measured tools/list payload' table parses to a row for every server (table format sanity)", () => {
    const readme = readFileSync(resolve(root, "README.md"), "utf-8");
    const rows = parsePayloadTable(readme);
    for (const pkgDir of SERVER_PACKAGES) {
      expect(rows.has(shortNameOf(pkgDir)), `missing payload-table row for ${pkgDir}`).toBe(true);
    }
    expect(rows.size).toBe(SERVER_PACKAGES.length);
  });

  it.each(SERVER_PACKAGES)(
    "%s: live-measured tools/list count matches the README payload table for full/core/developer",
    async (pkgDir) => {
      const readme = readFileSync(resolve(root, "README.md"), "utf-8");
      const docRow = parsePayloadTable(readme).get(shortNameOf(pkgDir));
      expect(docRow, `README payload table has no row for ${pkgDir}`).toBeDefined();

      const pkg = await loadPackage(pkgDir);
      const shared = await loadShared();

      for (const preset of ["full", "core", "developer"] as const) {
        // eslint-disable-next-line no-await-in-loop
        const measurement = await measureOne(
          shared.McpServerBase,
          { name: pkg.name, version: pkg.version },
          pkg.tools,
          pkg.toolPresets,
          preset,
        );
        expect(
          measurement.count,
          `${pkgDir} live tools/list count under ${preset} preset vs README's documented ` +
            `${docRow![preset]} (README.md "Measured tools/list payload" table) — if this ` +
            `roster genuinely changed, re-run "pnpm measure:tools-payload" and update the README ` +
            `table (and the per-server README's Tool Visibility subsection) in the same story`,
        ).toBe(docRow![preset]);
      }
    },
  );

  it("README's 'The rosters' summary table parses to a row for full/core/developer (table format sanity)", () => {
    const readme = readFileSync(resolve(root, "README.md"), "utf-8");
    const rows = parseRosterTable(readme);
    expect(rows.has("full"), "missing 'full' roster-table row").toBe(true);
    expect(rows.has("core"), "missing 'core' roster-table row").toBe(true);
    expect(rows.has("developer"), "missing 'developer' roster-table row").toBe(true);
  });

  it.each(["full", "core", "developer"] as const)(
    "%s preset: README's package-only roster counts (and totals) match live toolPresets, derived independently of the payload table",
    async (preset) => {
      const readme = readFileSync(resolve(root, "README.md"), "utf-8");
      const docRow = parseRosterTable(readme).get(preset);
      expect(docRow, `README roster table has no row for ${preset}`).toBeDefined();

      const shortNameToCount: Record<string, number> = {};
      let packageTotal = 0;

      for (const pkgDir of SERVER_PACKAGES) {
        // eslint-disable-next-line no-await-in-loop
        const pkg = await loadPackage(pkgDir);
        const packageOnlyCount =
          preset === "full"
            ? pkg.tools.length
            : pkg.tools.length -
              (pkg.toolPresets as Record<string, { exclude: string[] }>)[preset]!.exclude.length;
        shortNameToCount[shortNameOf(pkgDir)] = packageOnlyCount;
        packageTotal += packageOnlyCount;
      }

      expect(shortNameToCount.dev, "dev package-only count").toBe(docRow!.dev);
      expect(shortNameToCount.admin, "admin package-only count").toBe(docRow!.admin);
      expect(shortNameToCount.interop, "interop package-only count").toBe(docRow!.interop);
      expect(shortNameToCount.ops, "ops package-only count").toBe(docRow!.ops);
      expect(shortNameToCount.data, "data package-only count").toBe(docRow!.data);
      expect(packageTotal, "Package total column").toBe(docRow!.packageTotal);
      // Runtime total = package total + one iris_server_profiles per server
      // (the reserved discovery tool, always visible under every preset).
      expect(packageTotal + SERVER_PACKAGES.length, "Runtime total column").toBe(
        docRow!.runtimeTotal,
      );
    },
  );

  // ══════════════════════════════════════════════════════════════════
  // Story 30.3 code-review MED-1 — the root-README guard above left the
  // OTHER doc surfaces that hard-code the same counts unguarded (same
  // doc-rot class this file exists to prevent). These blocks extend the
  // live-derivation guard to: (1) packages/iris-mcp-all/README.md's
  // cross-server summary table, (2) each per-server README's Tool
  // Visibility subsection prose counts, and (3) CHANGELOG.md's Epic 30
  // roster-summary line. `tool_support.md` is intentionally OUT OF SCOPE:
  // it hard-codes NO visibility counts (it states "no tool count in this
  // document moves" and points to the README for the numbers).
  // ══════════════════════════════════════════════════════════════════

  interface LiveCounts {
    short: string;
    pkgOnly: Record<Preset, number>;
    runtime: Record<Preset, number>;
  }

  async function liveCountsFor(pkgDir: string): Promise<LiveCounts> {
    const pkg = await loadPackage(pkgDir);
    const full = pkg.tools.length;
    const presets = pkg.toolPresets as Record<Preset, { exclude: string[] }>;
    const core = full - presets.core.exclude.length;
    const developer = full - presets.developer.exclude.length;
    // Runtime = package-only + one iris_server_profiles per server (always visible).
    return {
      short: shortNameOf(pkgDir),
      pkgOnly: { full, core, developer },
      runtime: { full: full + 1, core: core + 1, developer: developer + 1 },
    };
  }

  it("packages/iris-mcp-all/README.md summary table runtime counts match live rosters", async () => {
    const readme = readFileSync(resolve(root, "packages/iris-mcp-all/README.md"), "utf-8");
    // `| `@iris-mcp/dev` | 29 | 13 | 29 |`
    const rowRe = /^\| `@iris-mcp\/(\w+)` \| (\d+) \| (\d+) \| (\d+) \|$/gm;
    const rows = new Map<string, { full: number; core: number; developer: number }>();
    let match: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((match = rowRe.exec(readme)) !== null) {
      rows.set(match[1]!, {
        full: Number(match[2]),
        core: Number(match[3]),
        developer: Number(match[4]),
      });
    }
    expect(rows.size, "iris-mcp-all summary table should have one row per server").toBe(
      SERVER_PACKAGES.length,
    );
    for (const pkgDir of SERVER_PACKAGES) {
      // eslint-disable-next-line no-await-in-loop
      const live = await liveCountsFor(pkgDir);
      const row = rows.get(live.short);
      expect(row, `iris-mcp-all summary table missing a row for ${live.short}`).toBeDefined();
      expect(row!.full, `${live.short} full runtime (iris-mcp-all table)`).toBe(live.runtime.full);
      expect(row!.core, `${live.short} core runtime (iris-mcp-all table)`).toBe(live.runtime.core);
      expect(row!.developer, `${live.short} developer runtime (iris-mcp-all table)`).toBe(
        live.runtime.developer,
      );
    }
  });

  it("CHANGELOG.md Epic 30 roster-summary line (full/core/developer N/N/N/N/N, dev/admin/interop/ops/data order) matches live rosters", async () => {
    // Collapse hard-wrapping so the `core`\n13/13/... line reads as one string.
    const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf-8").replace(/\s+/g, " ");
    const order = ["dev", "admin", "interop", "ops", "data"] as const;
    const liveByShort: Record<string, LiveCounts> = {};
    for (const pkgDir of SERVER_PACKAGES) {
      // eslint-disable-next-line no-await-in-loop
      const live = await liveCountsFor(pkgDir);
      liveByShort[live.short] = live;
    }
    for (const preset of ["full", "core", "developer"] as const) {
      const re = new RegExp("`" + preset + "` (\\d+)/(\\d+)/(\\d+)/(\\d+)/(\\d+)");
      const m = re.exec(changelog);
      expect(m, `CHANGELOG missing a "\`${preset}\` N/N/N/N/N" runtime-count summary`).not.toBeNull();
      const documented = m!.slice(1, 6).map(Number);
      order.forEach((short, i) => {
        expect(
          documented[i],
          `CHANGELOG ${preset} runtime count for ${short} vs live — re-run "pnpm measure:tools-payload" and update the CHANGELOG line in the same story if the roster changed`,
        ).toBe(liveByShort[short]!.runtime[preset]);
      });
    }
  });

  it.each(SERVER_PACKAGES)(
    "%s: per-server README Tool Visibility subsection's stated runtime/package counts are all live-valid",
    async (pkgDir) => {
      const live = await liveCountsFor(pkgDir);
      const readme = readFileSync(resolve(root, `packages/${pkgDir}/README.md`), "utf-8");
      const sectionStart = readme.indexOf("### Tool Visibility");
      expect(
        sectionStart,
        `${pkgDir} README missing a "### Tool Visibility" subsection`,
      ).toBeGreaterThanOrEqual(0);
      const nextRule = readme.indexOf("\n---", sectionStart);
      const section = readme.slice(sectionStart, nextRule === -1 ? undefined : nextRule);

      const liveRuntime = new Set(Object.values(live.runtime));
      const livePkg = new Set(Object.values(live.pkgOnly));

      // "(12 package tools + `iris_server_profiles`)" / "(10 + `iris_server_profiles`)"
      const pkgRe = /\((\d+)(?: package tools)? \+ `iris_server_profiles`\)/g;
      let m: RegExpExecArray | null;
      let pkgMatches = 0;
      // eslint-disable-next-line no-cond-assign
      while ((m = pkgRe.exec(section)) !== null) {
        pkgMatches += 1;
        const n = Number(m[1]);
        expect(
          livePkg.has(n),
          `${pkgDir} README states "${n} (+iris_server_profiles)" package count, but live package-only counts are {${[...livePkg].join(", ")}}`,
        ).toBe(true);
      }
      expect(
        pkgMatches,
        `${pkgDir} README Tool Visibility subsection had no "(N + \`iris_server_profiles\`)" package count to check`,
      ).toBeGreaterThan(0);

      // "**13-tool runtime roster**" / "**11 runtime tools**"
      const rtRe = /\*\*(\d+)(?:-tool)? runtime (?:roster|tools)\*\*/g;
      let rtMatches = 0;
      // eslint-disable-next-line no-cond-assign
      while ((m = rtRe.exec(section)) !== null) {
        rtMatches += 1;
        const n = Number(m[1]);
        expect(
          liveRuntime.has(n),
          `${pkgDir} README states "**${n} runtime**", but live runtime counts are {${[...liveRuntime].join(", ")}}`,
        ).toBe(true);
      }
      expect(
        rtMatches,
        `${pkgDir} README Tool Visibility subsection had no "**N runtime**" count to check`,
      ).toBeGreaterThan(0);
    },
  );
});
