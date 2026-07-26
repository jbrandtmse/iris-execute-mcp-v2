import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_DIR_NAME, PACKAGE_NPM_NAME, planDefinitions } from "../definitions.js";
import type { LauncherSettings } from "../types.js";

// Repo root — 4 levels up from src/__tests__ (__tests__ -> src ->
// iris-mcp-launcher -> extensions -> repo root), matching the pattern
// `envContract.test.ts` uses to reach `packages/shared/dist`. __dirname (not
// import.meta.url), matching `containment.test.ts`/`packaging.test.ts`, so
// this file type-checks cleanly under the extension's own CommonJS
// tsconfig.json, not just under vitest's transform.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
  return {
    servers: [],
    packages: ["dev"],
    namespace: "HSCUSTOM",
    combineProfiles: false,
    developmentRepoPath: "",
    hadStaleAllPackage: false,
    governance: "",
    governancePreset: "",
    auditLog: "",
    auditLogMaxMb: "",
    auditLogParams: "",
    toolsPreset: "",
    toolsDisable: "",
    toolsEnable: "",
    ...overrides,
  };
}

describe("planDefinitions", () => {
  it("returns one definition per (package, server) pair by default (cross product)", () => {
    const plans = planDefinitions(settings({ packages: ["dev", "admin"] }), ["serverA", "serverB"]);

    expect(plans).toHaveLength(4);
    expect(plans.every((p) => p.serverNames.length === 1)).toBe(true);
    expect(new Set(plans.map((p) => p.label)).size).toBe(4); // labels unique
  });

  it("uses every available server when settings.servers is empty", () => {
    const plans = planDefinitions(settings({ packages: ["dev"] }), ["a", "b", "c"]);
    expect(plans.map((p) => p.serverNames[0]).sort()).toEqual(["a", "b", "c"]);
  });

  it("intersects settings.servers with availableServerNames, silently dropping unknown names", () => {
    const plans = planDefinitions(settings({ packages: ["dev"], servers: ["a", "ghost"] }), [
      "a",
      "b",
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.serverNames).toEqual(["a"]);
  });

  it("returns [] when no servers are available/selected", () => {
    expect(planDefinitions(settings({ packages: ["dev"] }), [])).toEqual([]);
  });

  it("returns [] when no packages are selected", () => {
    expect(planDefinitions(settings({ packages: [] }), ["a"])).toEqual([]);
  });

  it("combineProfiles=true: one definition per package, covering every selected server", () => {
    const plans = planDefinitions(settings({ packages: ["dev", "ops"], combineProfiles: true }), [
      "a",
      "b",
      "c",
    ]);

    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect(plan.serverNames).toEqual(["a", "b", "c"]);
    }
  });

  it("de-duplicates repeated servers/packages so no two plans share a label", () => {
    const plans = planDefinitions(
      settings({ packages: ["dev", "dev", "admin"], servers: ["a", "a", "b"] }),
      ["a", "b"],
    );

    const labels = plans.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
    // 2 unique packages x 2 unique servers
    expect(plans).toHaveLength(4);
  });

  it("de-duplicates repeated servers inside a combineProfiles plan (no redundant credential prompt, no overwritten profile)", () => {
    const plans = planDefinitions(
      settings({ packages: ["dev"], servers: ["a", "a"], combineProfiles: true }),
      ["a"],
    );

    expect(plans).toHaveLength(1);
    expect(plans[0]?.serverNames).toEqual(["a"]);
  });

  it("maps every SuitePackageKey to its documented npm package name (AC 31.6.5: 'all' removed — @iris-mcp/all has no bin and could never be started)", () => {
    expect(PACKAGE_NPM_NAME).toEqual({
      admin: "@iris-mcp/admin",
      data: "@iris-mcp/data",
      dev: "@iris-mcp/dev",
      interop: "@iris-mcp/interop",
      ops: "@iris-mcp/ops",
    });
  });

  it("plan labels are stable/deterministic for the same inputs (used as the resolve-time lookup key)", () => {
    const a = planDefinitions(settings({ packages: ["dev"] }), ["x"]);
    const b = planDefinitions(settings({ packages: ["dev"] }), ["x"]);
    expect(a[0]?.label).toBe(b[0]?.label);
  });
});

/**
 * AC 31.6.2 — the directory-naming trap. `PACKAGE_DIR_NAME` is an EXPLICIT
 * map (never derived from `PACKAGE_NPM_NAME`/`SuitePackageKey`) precisely
 * because a `iris-<key>-mcp` transformation rule LOOKS correct — all five
 * surviving directories follow it, and the one real counterexample
 * (`iris-mcp-all`) was removed in this same story — and would pass a test
 * written against that same rule.
 *
 * Rule #51 ("derive from disk, never a hand-maintained roster asserted
 * against itself"): these tests read the REAL `packages/` tree from disk. The
 * load-bearing one is the CORRESPONDENCE check — an existence-only check
 * ("is this value *a* real directory?") is satisfied by any wrong-but-
 * existing value, so a transposed `data`/`ops` pair would spawn the ops
 * server under an "IRIS Data Tools" label with the whole suite green. Pairing
 * each key against the directory's own `package.json` `name` closes that:
 * the oracle is the package manifest on disk, which nothing in this extension
 * writes or derives.
 */
describe("PACKAGE_DIR_NAME — cross-checked against the real packages/ tree on disk (AC 31.6.2, Rule #51)", () => {
  /** Real `packages/` subdirectory names, read from disk. Guarded so a wrong PACKAGES_DIR reports itself rather than throwing ENOENT out of the suite. */
  function readRealPackageDirectories(): Set<string> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(PACKAGES_DIR, { withFileTypes: true });
    } catch (error) {
      throw new Error(
        `Could not read the monorepo packages/ directory at "${PACKAGES_DIR}" — ` +
          `these AC 31.6.2 cross-checks derive their oracle from it. (${String(error)})`,
      );
    }
    return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  }

  it("every PACKAGE_DIR_NAME value exists as a real directory under packages/", () => {
    const realDirectories = readRealPackageDirectories();

    // Sanity: the disk read actually found something, so a misconfigured
    // PACKAGES_DIR path cannot produce a vacuous "every value passes"
    // false-positive (an empty realDirectories set would make every
    // subsequent .has() check trivially fail, but this makes the failure
    // mode explicit and easy to diagnose).
    expect(realDirectories.size).toBeGreaterThan(0);

    for (const [key, dirName] of Object.entries(PACKAGE_DIR_NAME)) {
      expect(realDirectories.has(dirName), `PACKAGE_DIR_NAME.${key} = "${dirName}" not found under packages/`).toBe(
        true,
      );
    }
  });

  /**
   * The check that actually catches a WRONG mapping, not merely a
   * nonexistent one. Existence alone is vacuous: `ops: "iris-data-mcp"` names
   * a real directory and passes every other assertion in this file, yet
   * silently spawns the data server for a user who selected ops. The oracle
   * is each directory's own `package.json` `name`, which must equal that
   * key's `PACKAGE_NPM_NAME` — both sides read from disk, neither derived
   * from the map under test.
   */
  it("every PACKAGE_DIR_NAME entry points at the directory whose package.json name IS that key's PACKAGE_NPM_NAME — catches a swapped/transposed mapping, which an existence-only check cannot", () => {
    const keys = Object.keys(PACKAGE_DIR_NAME) as (keyof typeof PACKAGE_DIR_NAME)[];
    expect(keys.length).toBeGreaterThan(0);

    const actual: Record<string, string> = {};
    const expected: Record<string, string> = {};
    for (const key of keys) {
      const manifestPath = path.join(PACKAGES_DIR, PACKAGE_DIR_NAME[key], "package.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string };
      actual[key] = manifest.name ?? `(no name field in ${manifestPath})`;
      expected[key] = PACKAGE_NPM_NAME[key];
    }

    // Whole-object, so a transposition fails with both sides printed.
    expect(actual).toEqual(expected);
  });

  /**
   * The entry point `resolveSpawnTargets` builds (`<dir>/dist/index.js`) is
   * an assumption about the packages' build layout, so pin it against each
   * package's declared `bin` target rather than trusting the string.
   */
  it("every mapped package declares a bin whose target is ./dist/index.js — the exact file resolveSpawnTargets spawns", () => {
    for (const [key, dirName] of Object.entries(PACKAGE_DIR_NAME)) {
      const manifest = JSON.parse(
        readFileSync(path.join(PACKAGES_DIR, dirName, "package.json"), "utf8"),
      ) as { bin?: Record<string, string> };
      const binTargets = Object.values(manifest.bin ?? {});
      expect(binTargets, `packages/${dirName} (key "${key}") declares no bin`).not.toHaveLength(0);
      expect(binTargets, `packages/${dirName} (key "${key}") bin does not target ./dist/index.js`).toContain(
        "./dist/index.js",
      );
    }
  });

  it("the map has exactly the five surviving keys, no more, no less, and no entry for the removed 'all' key", () => {
    expect(Object.keys(PACKAGE_DIR_NAME).sort()).toEqual(["admin", "data", "dev", "interop", "ops"]);
    expect("all" in PACKAGE_DIR_NAME).toBe(false);
  });

  it("PACKAGE_DIR_NAME's source declaration is a hand-written string-literal map, not a template-literal derivation (e.g. `iris-${key}-mcp`) — a value-level check cannot distinguish 'five literals that happen to match a rule' from 'a rule', so this greps the SOURCE TEXT of the declaration itself", () => {
    const definitionsSource = readFileSync(path.join(__dirname, "..", "definitions.ts"), "utf8");
    const match = /export const PACKAGE_DIR_NAME[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(definitionsSource);
    expect(match, "PACKAGE_DIR_NAME declaration not found in definitions.ts").not.toBeNull();

    const declarationBody = match![1]!;
    expect(declarationBody).not.toContain("${");
    expect(declarationBody).not.toContain("`");
    // Every value is a plain double-quoted literal (admin: "iris-admin-mcp", ...).
    expect(declarationBody).toMatch(/admin:\s*"iris-admin-mcp"/);
    expect(declarationBody).toMatch(/dev:\s*"iris-dev-mcp"/);
  });
});
