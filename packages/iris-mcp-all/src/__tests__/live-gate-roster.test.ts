/**
 * Every live gate armed by `IRIS_REQUIRE_LIVE` is run by its owning package's publish gate (the
 * "Live gates" convention). A test file that compares the `IRIS_REQUIRE_LIVE` environment variable
 * refuses to skip only when something sets it, and the one thing that sets it is the package's
 * `scripts/prepublish-gate.mjs` (its `gateTestFiles` list), reached through `prepublishOnly`. An
 * armed file missing from that list is an arming variable nothing sets: on the publish path it
 * skips green.
 *
 * Reads each workspace package's own test directory, gate script and manifest from disk (Rule #45:
 * cross-package checks live in `@iris-mcp/all`).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES_DIR = path.resolve(__dirname, "..", "..", "..");

/** The quoted entries of a gate script's `const gateTestFiles = [ ... ];` literal, comments removed. */
function listedGateFiles(scriptSource: string): string[] {
  const literal = /const gateTestFiles = \[([\s\S]*?)\];/.exec(scriptSource)?.[1] ?? "";
  const withoutComments = literal.replace(/\/\/[^\n]*/g, "");
  return [...withoutComments.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
}

/** The package's test files that compare the arming variable (`... IRIS_REQUIRE_LIVE === ...`), as `src/__tests__/<name>`. */
function armedTestFiles(pkgDir: string): string[] {
  const testsDir = path.join(pkgDir, "src", "__tests__");
  if (!existsSync(testsDir)) return [];
  return readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.ts"))
    .filter((name) => /process\.env\.IRIS_REQUIRE_LIVE\s*===/.test(readFileSync(path.join(testsDir, name), "utf8")))
    .map((name) => `src/__tests__/${name}`);
}

const packages = readdirSync(PACKAGES_DIR).filter((name) => existsSync(path.join(PACKAGES_DIR, name, "package.json")));
const armed = packages
  .map((pkg) => ({ pkg, files: armedTestFiles(path.join(PACKAGES_DIR, pkg)) }))
  .filter(({ files }) => files.length > 0);

describe("armed live gates are run by their package's prepublish gate", () => {
  it("the scan finds the armed gates at all (an empty scan would pass every case below vacuously)", () => {
    expect(armed.map(({ pkg }) => pkg)).toEqual(
      expect.arrayContaining(["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-mcp-all"]),
    );
  });

  for (const { pkg, files } of armed) {
    it(`${pkg}: every armed test file is in scripts/prepublish-gate.mjs gateTestFiles, and prepublishOnly runs that script`, () => {
      const pkgDir = path.join(PACKAGES_DIR, pkg);
      const script = path.join(pkgDir, "scripts", "prepublish-gate.mjs");
      expect(existsSync(script), `${pkg} has armed live gates but no scripts/prepublish-gate.mjs`).toBe(true);

      const listed = listedGateFiles(readFileSync(script, "utf8"));
      expect(files.filter((file) => !listed.includes(file)), `${pkg} armed files missing from gateTestFiles`).toEqual([]);

      const manifest = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      expect(manifest.scripts?.prepublishOnly ?? "").toContain("scripts/prepublish-gate.mjs");
    });
  }
});
