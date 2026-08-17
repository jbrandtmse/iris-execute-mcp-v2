/**
 * Story 34.7 AC 34.7.5 / 34.7.7 (ledger `34-6-CR-11`) — default-suite unit coverage for
 * `scripts/lib/dist-freshness.mjs`'s `checkDistFresh`, the packaging-boundary
 * build-freshness check wired into both `scripts/verify-iris-reachable.mjs` (7
 * packages) and `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` (`@iris-mcp/dev`).
 *
 * `@iris-mcp/all` is the only package that depends on all five server packages, so —
 * per Rule #45 — it is the natural home for a check that is otherwise invoked only from
 * plain `.mjs` scripts with no test runner of their own. Mirrors
 * `measure-tools-payload.test.ts`'s pattern: import the SAME core module the scripts
 * use, so the logic is single-sourced (never re-implemented for the test).
 *
 * Uses disposable, isolated temp directories (never the real workspace packages) with
 * explicitly controlled file mtimes via `utimesSync` — filesystem mtime behavior varies
 * enough across platforms/filesystems that asserting on REAL package dist/src timing
 * would be flaky; controlling it directly makes every case deterministic.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "dist-freshness-test-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** Write `pkg/package.json` declaring `files: ["dist"]`, matching every real publishable package. */
function writePublishablePackageJson(pkgDir: string): void {
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: "@test/pkg", files: ["dist"] }),
  );
}

describe("checkDistFresh (Story 34.7 AC 34.7.5, ledger 34-6-CR-11)", () => {
  it("fails closed when dist/ does not exist at all", () => {
    writePublishablePackageJson(workDir);
    mkdirSync(join(workDir, "src"), { recursive: true });
    writeFileSync(join(workDir, "src", "index.ts"), "export {};");

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no dist/ directory");
  });

  it("fails closed when dist/ exists but is completely empty", () => {
    writePublishablePackageJson(workDir);
    mkdirSync(join(workDir, "dist"), { recursive: true });
    mkdirSync(join(workDir, "src"), { recursive: true });
    writeFileSync(join(workDir, "src", "index.ts"), "export {};");

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("contains no files");
  });

  it("fails closed when src/ has been modified more recently than dist/ (a stale build)", () => {
    writePublishablePackageJson(workDir);
    const distDir = join(workDir, "dist");
    const srcDir = join(workDir, "src");
    mkdirSync(distDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    const distFile = join(distDir, "index.js");
    const srcFile = join(srcDir, "index.ts");
    writeFileSync(distFile, "export {};");
    writeFileSync(srcFile, "export {};");

    // dist/ built an hour ago; src/ edited just now — a genuinely stale build.
    const now = Date.now();
    utimesSync(distFile, new Date(now - 3_600_000), new Date(now - 3_600_000));
    utimesSync(srcFile, new Date(now), new Date(now));

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("STALE");
  });

  it("passes when dist/ is present, non-empty, and newer than src/ (a fresh build)", () => {
    writePublishablePackageJson(workDir);
    const distDir = join(workDir, "dist");
    const srcDir = join(workDir, "src");
    mkdirSync(distDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    const distFile = join(distDir, "index.js");
    const srcFile = join(srcDir, "index.ts");
    writeFileSync(srcFile, "export {};");
    writeFileSync(distFile, "export {};");

    // src/ written an hour ago; dist/ built just now — a genuinely fresh build.
    const now = Date.now();
    utimesSync(srcFile, new Date(now - 3_600_000), new Date(now - 3_600_000));
    utimesSync(distFile, new Date(now), new Date(now));

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(true);
  });

  it("passes when dist/ mtime exactly equals src/ mtime (permissive tie-break, avoids flaky coarse-mtime false positives)", () => {
    writePublishablePackageJson(workDir);
    const distDir = join(workDir, "dist");
    const srcDir = join(workDir, "src");
    mkdirSync(distDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    const distFile = join(distDir, "index.js");
    const srcFile = join(srcDir, "index.ts");
    writeFileSync(srcFile, "export {};");
    writeFileSync(distFile, "export {};");

    const same = new Date();
    utimesSync(srcFile, same, same);
    utimesSync(distFile, same, same);

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(true);
  });

  it("recurses into nested dist/ subdirectories (e.g. dist/tools/index.js) when comparing mtimes", () => {
    writePublishablePackageJson(workDir);
    const distDir = join(workDir, "dist");
    const distToolsDir = join(distDir, "tools");
    const srcDir = join(workDir, "src");
    mkdirSync(distToolsDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    const nestedDistFile = join(distToolsDir, "index.js");
    const srcFile = join(srcDir, "index.ts");
    writeFileSync(srcFile, "export {};");
    writeFileSync(nestedDistFile, "export {};");

    // The only dist file is nested two levels deep and is STALE relative to src/ — if
    // the check only looked at dist/'s top level (not recursing), it would find no
    // files there and misreport "contains no files" instead of "STALE".
    const now = Date.now();
    utimesSync(nestedDistFile, new Date(now - 3_600_000), new Date(now - 3_600_000));
    utimesSync(srcFile, new Date(now), new Date(now));

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("STALE");
  });

  it("skips (passes) a package whose package.json declares no files:[\"dist\"] — e.g. @iris-mcp/all itself, which has no build step of its own", () => {
    mkdirSync(workDir, { recursive: true });
    writeFileSync(
      join(workDir, "package.json"),
      JSON.stringify({ name: "@test/meta-pkg", dependencies: {} }),
    );
    // Deliberately no dist/ and no src/ at all — a package this check was never
    // designed to judge must not be failed closed on that basis.

    const result = checkDistFresh(workDir, "@test/meta-pkg");
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("Rule #48 mutation sanity: the SAME staled dist/ that fails closed above passes again once rebuilt (proves the check is genuinely mtime-driven, not a fixed verdict)", () => {
    writePublishablePackageJson(workDir);
    const distDir = join(workDir, "dist");
    const srcDir = join(workDir, "src");
    mkdirSync(distDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    const distFile = join(distDir, "index.js");
    const srcFile = join(srcDir, "index.ts");
    writeFileSync(srcFile, "export {};");
    writeFileSync(distFile, "export {};");

    const t0 = Date.now();
    utimesSync(distFile, new Date(t0 - 3_600_000), new Date(t0 - 3_600_000));
    utimesSync(srcFile, new Date(t0), new Date(t0));
    expect(checkDistFresh(workDir, "@test/pkg").ok).toBe(false);

    // "Rebuild": touch dist/ to now, strictly after src/'s mtime.
    utimesSync(distFile, new Date(t0 + 1000), new Date(t0 + 1000));
    expect(checkDistFresh(workDir, "@test/pkg").ok).toBe(true);
  });
});
