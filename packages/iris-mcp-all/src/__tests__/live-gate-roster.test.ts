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

/**
 * What marks a test file as an armed live gate: it compares the arming variable (`... IRIS_REQUIRE_LIVE === ...`), or its
 * import-time constants come from the throwaway plan (a `const` at the start of a line), the arming of the throwaway
 * bootstrap-guard gate through `IRIS_THROWAWAY`.
 */
const ARMED_GATE = /process\.env\.IRIS_REQUIRE_LIVE\s*===|^const \w+ = throwawayGatePlan\(/m;

/**
 * Armed live gates that are off every roster by design. Each is armed by something a package's prepublish run does not
 * set, so listing it in `gateTestFiles` would run it where it can only fail or skip.
 */
const NAMED_EXEMPTIONS: ReadonlyArray<{ pkg: string; file: string; reason: string }> = [
  {
    pkg: "iris-mcp-all",
    file: "src/__tests__/story-42-2-bootstrap-guard-live-gate.test.ts",
    reason:
      "armed by IRIS_THROWAWAY, which only scripts/throwaway-iris.mjs sets (pnpm live:bootstrap-guard, Story 42.3's CI); it refuses any target that already holds ExecuteMCPv2 classes, so a prepublish run against a real instance could never pass it",
  },
];

const isExempt = (pkg: string, file: string): boolean =>
  NAMED_EXEMPTIONS.some((exemption) => exemption.pkg === pkg && exemption.file === file);

/** The package's test files that are armed live gates (see {@link ARMED_GATE}), as `src/__tests__/<name>`. */
function armedTestFiles(pkgDir: string): string[] {
  const testsDir = path.join(pkgDir, "src", "__tests__");
  if (!existsSync(testsDir)) return [];
  return readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.ts"))
    .filter((name) => ARMED_GATE.test(readFileSync(path.join(testsDir, name), "utf8")))
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
    expect(armed.flatMap(({ files }) => files).length, "the armed gates of the workspace").toBeGreaterThan(40);
  });

  for (const { pkg, files } of armed) {
    it(`${pkg}: every armed test file is in scripts/prepublish-gate.mjs gateTestFiles, and prepublishOnly runs that script`, () => {
      const pkgDir = path.join(PACKAGES_DIR, pkg);
      const script = path.join(pkgDir, "scripts", "prepublish-gate.mjs");
      const rostered = files.filter((file) => !isExempt(pkg, file));
      expect(existsSync(script) || rostered.length === 0, `${pkg} has armed live gates but no scripts/prepublish-gate.mjs`).toBe(true);
      if (rostered.length === 0) return;

      const listed = listedGateFiles(readFileSync(script, "utf8"));
      expect(rostered.filter((file) => !listed.includes(file)), `${pkg} armed files missing from gateTestFiles`).toEqual([]);

      const manifest = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      };
      expect(manifest.scripts?.prepublishOnly ?? "").toContain("scripts/prepublish-gate.mjs");
    });
  }

  it("the detector finds a gate that compares the arming variable or arms through IRIS_THROWAWAY, and nothing else", () => {
    // The samples are assembled, so that this file does not itself contain what the detector looks for.
    const comparison = ["const REQUIRE_LIVE = process.env.IRIS_REQUIRE_", 'LIVE === "1";'].join("");
    const plan = ["const PLAN = throwaway", "GatePlan(process.env);"].join("");
    expect(ARMED_GATE.test(comparison)).toBe(true);
    expect(ARMED_GATE.test(`import x;\n${plan}\n`)).toBe(true);
    expect(ARMED_GATE.test(`  ${plan}`), "an indented call is a test of the plan, not a gate").toBe(false);
    expect(ARMED_GATE.test("const reason = liveArmingSkipReason();")).toBe(false);
    expect(ARMED_GATE.test("process.env.IRIS_REQUIRE_LIVE = '1'")).toBe(false);
  });
});

describe("the named exemptions: armed live gates that are off every roster", () => {
  for (const { pkg, file, reason } of NAMED_EXEMPTIONS) {
    it(`${pkg}/${file}: exists, is detected as an armed gate (so the exemption is needed), is listed in no gateTestFiles, and says why`, () => {
      const source = path.join(PACKAGES_DIR, pkg, file);
      expect(existsSync(source), `${source} no longer exists: remove the exemption`).toBe(true);
      expect(ARMED_GATE.test(readFileSync(source, "utf8")), `${file} is no longer detected as an armed gate: remove the exemption`).toBe(true);
      expect(reason.length).toBeGreaterThan(40);

      for (const other of packages) {
        const script = path.join(PACKAGES_DIR, other, "scripts", "prepublish-gate.mjs");
        if (!existsSync(script)) continue;
        expect(listedGateFiles(readFileSync(script, "utf8")), `${other}'s gateTestFiles must not list ${file}`).not.toContain(file);
      }
    });
  }
});
