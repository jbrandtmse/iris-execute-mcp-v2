/**
 * Story 38.0 (ledger DW-413 and DW-417) - two `checkDistFresh` properties that
 * `dist-freshness.test.ts` leaves open.
 *
 *  1. The REAL manifests. The matrix cases use synthetic `files` arrays. What decides whether the
 *     publish gates guard a package is how its own `package.json` spells `files`; if the
 *     normalization stopped recognising the spelling the workspace actually uses
 *     (`["dist", "!dist/**\/__tests__"]`), every gate would report a skipped (passing) result for the
 *     package and verify nothing. So: each publishable workspace package is dist-shipping (never
 *     skipped), and the dependencies-only meta-package `@iris-mcp/all` (`files: []`) is the one
 *     package that is skipped. Freshness itself is not asserted here (it depends on the host's
 *     build state); only that the package is checked.
 *  2. An `exports` subpath pattern (`./features/*`) names no single file, so it is not looked up on
 *     disk. Without that exemption a pattern export would fail closed on a file named `*`, while
 *     every concrete export beside it must still be checked.
 *
 * Uses the same disposable temp-directory shape as `dist-freshness.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES_DIR = path.resolve(__dirname, "..", "..", "..");

const PUBLISHABLE = [
  "shared",
  "iris-dev-mcp",
  "iris-admin-mcp",
  "iris-interop-mcp",
  "iris-ops-mcp",
  "iris-data-mcp",
  "client-config",
];

describe("checkDistFresh against the real workspace manifests (Story 38.0, DW-413)", () => {
  for (const pkg of PUBLISHABLE) {
    it(`${pkg} is dist-shipping: its own files spelling is recognised, so the gate checks it instead of skipping`, () => {
      const pkgDir = path.join(PACKAGES_DIR, pkg);
      const manifest = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
        files?: unknown[];
      };
      // Reality check on the premise: the package really does ship a dist directory.
      expect(manifest.files?.some((entry) => typeof entry === "string" && /^(\.\/)?dist/.test(entry))).toBe(true);

      const result = checkDistFresh(pkgDir, pkg);

      expect(result.skipped, `${pkg} was skipped: ${JSON.stringify(result)}`).toBeUndefined();
    });
  }

  it("iris-mcp-all (files: []) is the dependencies-only meta-package and is skipped", () => {
    const pkgDir = path.join(PACKAGES_DIR, "iris-mcp-all");
    const manifest = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
      files?: unknown[];
    };
    expect(manifest.files).toEqual([]);

    expect(checkDistFresh(pkgDir, "iris-mcp-all")).toEqual({ ok: true, skipped: true });
  });
});

describe("checkDistFresh - exports subpath patterns (Story 38.0, DW-417)", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "dist-freshness-qa-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  /** A fresh build: `src/index.ts` an hour old, `dist/index.js` just built. */
  function layOutFreshBuild(): void {
    mkdirSync(path.join(workDir, "src"), { recursive: true });
    mkdirSync(path.join(workDir, "dist"), { recursive: true });
    const srcFile = path.join(workDir, "src", "index.ts");
    const distFile = path.join(workDir, "dist", "index.js");
    writeFileSync(srcFile, "export {};");
    writeFileSync(distFile, "export {};");
    const now = Date.now();
    utimesSync(srcFile, new Date(now - 3_600_000), new Date(now - 3_600_000));
    utimesSync(distFile, new Date(now), new Date(now));
  }

  function writePackageJson(exportsField: unknown): void {
    writeFileSync(
      path.join(workDir, "package.json"),
      JSON.stringify({ name: "@test/pkg", files: ["dist"], exports: exportsField }),
    );
  }

  it("does not look up a pattern target on disk (a pattern names no single file)", () => {
    layOutFreshBuild();
    writePackageJson({
      ".": { import: "./dist/index.js" },
      "./features/*": { import: "./dist/features/*.js" },
    });

    expect(checkDistFresh(workDir, "@test/pkg")).toEqual({ ok: true });
  });

  it("still fails closed on a concrete export that sits beside a pattern export", () => {
    layOutFreshBuild();
    writePackageJson({
      "./features/*": { import: "./dist/features/*.js" },
      "./cli": { import: "./dist/cli.js" },
    });

    const result = checkDistFresh(workDir, "@test/pkg");

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('exports["./cli"].import points at ./dist/cli.js');
  });
});
