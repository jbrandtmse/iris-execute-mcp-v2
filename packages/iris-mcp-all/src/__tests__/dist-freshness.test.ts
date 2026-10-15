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
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
  rmSync,
  symlinkSync,
  chmodSync,
} from "node:fs";
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
    // The remedy names the case a plain rebuild cannot clear (no emit on unchanged content).
    expect(result.reason).toContain("tsconfig.tsbuildinfo");
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

// -- Story 38.0 hardening (ledger DW-413..DW-417) ------------------------------------
//
// One case per input of the AC-5 matrix. Every case uses the same disposable-directory
// shape as above and pins `checkDistFresh`'s contract: a `{ ok, reason? }` result, never a
// throw.

/** Write a package.json with the given fields merged over `{ name, files: ["dist"] }`. */
function writePackageJson(pkgDir: string, fields: Record<string, unknown>): void {
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: "@test/pkg", files: ["dist"], ...fields }),
  );
}

/**
 * Lay out a fresh build (`src/index.ts` an hour old, `dist/index.js` just built) under
 * `pkgDir` and return the two file paths so a case can then break one property.
 */
function layOutFreshBuild(pkgDir: string): { srcFile: string; distFile: string; now: number } {
  const srcFile = join(pkgDir, "src", "index.ts");
  const distFile = join(pkgDir, "dist", "index.js");
  mkdirSync(join(pkgDir, "src"), { recursive: true });
  mkdirSync(join(pkgDir, "dist"), { recursive: true });
  writeFileSync(srcFile, "export {};");
  writeFileSync(distFile, "export {};");
  const now = Date.now();
  utimesSync(srcFile, new Date(now - 3_600_000), new Date(now - 3_600_000));
  utimesSync(distFile, new Date(now), new Date(now));
  return { srcFile, distFile, now };
}

describe("checkDistFresh - `files` spellings (Story 38.0, DW-413)", () => {
  for (const files of [
    ["dist"],
    ["dist/"],
    ["./dist"],
    ["dist/**"],
    ["dist/*"],
    ["dist/**/*"],
    ["./dist/**/*"],
    ["dist", "!dist/**/__tests__"],
  ]) {
    it(`treats files ${JSON.stringify(files)} as dist-shipping (checked, not skipped)`, () => {
      writePackageJson(workDir, { files });
      mkdirSync(join(workDir, "src"), { recursive: true });
      writeFileSync(join(workDir, "src", "index.ts"), "export {};");

      // No dist/ at all: a dist-shipping package fails closed; a skipped one would pass.
      const result = checkDistFresh(workDir, "@test/pkg");
      expect(result.ok).toBe(false);
      expect(result.skipped).toBeUndefined();
      expect(result.reason).toContain("no dist/ directory");
    });
  }

  it("ignores a negation-only entry: files [\"src\", \"!dist/**\"] ships no dist", () => {
    writePackageJson(workDir, { files: ["src", "!dist/**"] });
    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result).toEqual({ ok: true, skipped: true });
  });
});

describe("checkDistFresh - manifest and filesystem failures never throw (Story 38.0, DW-414)", () => {
  it("returns ok:false naming the cause for a malformed package.json", () => {
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, "package.json"), "{ not json");
    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("package.json");
    expect(result.reason).toContain("malformed");
  });

  it("returns ok:false for a missing package.json (never skips a package it cannot read)", () => {
    mkdirSync(workDir, { recursive: true });
    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("package.json");
  });

  it("returns ok:false for a package.json that is valid JSON but not an object", () => {
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, "package.json"), "[]");
    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not a JSON object");
  });

  it("returns ok:false when src is not a readable directory", () => {
    writePackageJson(workDir, {});
    mkdirSync(join(workDir, "dist"), { recursive: true });
    writeFileSync(join(workDir, "dist", "index.js"), "export {};");
    writeFileSync(join(workDir, "src"), "a file where the src directory should be");

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("could not be verified");
  });

  it("returns ok:false for an unreadable src subdirectory (permission denied)", (testCtx) => {
    // A privileged user reads any directory, and chmod cannot remove directory read
    // access on Windows, so the case cannot be constructed on either.
    if (process.platform === "win32" || (typeof process.getuid === "function" && process.getuid() === 0)) {
      testCtx.skip();
      return;
    }
    writePackageJson(workDir, {});
    layOutFreshBuild(workDir);
    const locked = join(workDir, "src", "locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "x.ts"), "export {};");
    chmodSync(locked, 0o000);
    try {
      const result = checkDistFresh(workDir, "@test/pkg");
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("could not be verified");
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});

// Creating a symlink needs a privilege a Windows user may not hold, so these cases run elsewhere.
describe.skipIf(process.platform === "win32")("checkDistFresh - symlinks under src/ (Story 38.0, DW-415)", () => {
  it("follows a symlinked file: a newer link target makes the build STALE", () => {
    writePackageJson(workDir, {});
    const { now } = layOutFreshBuild(workDir);
    const target = join(workDir, "shared-source.ts");
    writeFileSync(target, "export {};");
    utimesSync(target, new Date(now + 5_000), new Date(now + 5_000));
    symlinkSync(target, join(workDir, "src", "linked.ts"));

    const result = checkDistFresh(workDir, "@test/pkg", { now: now + 10_000 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("STALE");
  });

  it("passes when a symlinked file is older than dist/", () => {
    writePackageJson(workDir, {});
    const { now } = layOutFreshBuild(workDir);
    const target = join(workDir, "shared-source.ts");
    writeFileSync(target, "export {};");
    utimesSync(target, new Date(now - 7_200_000), new Date(now - 7_200_000));
    symlinkSync(target, join(workDir, "src", "linked.ts"));

    expect(checkDistFresh(workDir, "@test/pkg").ok).toBe(true);
  });

  it("fails closed on a dangling symlink", () => {
    writePackageJson(workDir, {});
    layOutFreshBuild(workDir);
    symlinkSync(join(workDir, "does-not-exist.ts"), join(workDir, "src", "dangling.ts"));

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("dangling symlink");
  });

  it("fails closed on a symlink to a directory", () => {
    writePackageJson(workDir, {});
    layOutFreshBuild(workDir);
    const otherDir = join(workDir, "other");
    mkdirSync(otherDir);
    writeFileSync(join(otherDir, "a.ts"), "export {};");
    symlinkSync(otherDir, join(workDir, "src", "linked-dir"));

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("symlink to a directory");
  });
});

describe("checkDistFresh - future-dated dist (Story 38.0, DW-416)", () => {
  it("fails closed when a dist file is dated more than 60 s after the injected now", () => {
    writePackageJson(workDir, {});
    const { distFile, now } = layOutFreshBuild(workDir);
    utimesSync(distFile, new Date(now + 600_000), new Date(now + 600_000));

    const result = checkDistFresh(workDir, "@test/pkg", { now });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("future");
  });

  it("passes a dist file dated inside the 60 s tolerance", () => {
    writePackageJson(workDir, {});
    const { distFile, now } = layOutFreshBuild(workDir);
    utimesSync(distFile, new Date(now + 59_000), new Date(now + 59_000));

    expect(checkDistFresh(workDir, "@test/pkg", { now }).ok).toBe(true);
  });

  it("passes the same future-dated dist once the injected now catches up (the check is clock-driven)", () => {
    writePackageJson(workDir, {});
    const { distFile, now } = layOutFreshBuild(workDir);
    utimesSync(distFile, new Date(now + 600_000), new Date(now + 600_000));

    expect(checkDistFresh(workDir, "@test/pkg", { now: now + 600_000 }).ok).toBe(true);
  });
});

describe("checkDistFresh - declared dist targets exist (Story 38.0, DW-417)", () => {
  it("fails closed naming `module` when its dist target is missing (while `main` exists)", () => {
    writePackageJson(workDir, { main: "./dist/index.js", module: "./dist/esm/index.js" });
    layOutFreshBuild(workDir);

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("field module points at ./dist/esm/index.js");
    expect(result.reason).toContain("./dist/esm/index.js");
  });

  it("fails closed naming a `bin` map entry whose dist target is missing", () => {
    writePackageJson(workDir, { bin: { "pkg-cli": "./dist/cli/cli.js" } });
    layOutFreshBuild(workDir);

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('field bin["pkg-cli"] points at ./dist/cli/cli.js');
  });

  it("fails closed on a string `bin` whose dist target is missing", () => {
    writePackageJson(workDir, { bin: "./dist/bin.js" });
    layOutFreshBuild(workDir);

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("field bin points at ./dist/bin.js");
  });

  it("fails closed on a nested `exports` condition leaf whose dist target is missing", () => {
    writePackageJson(workDir, {
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    });
    layOutFreshBuild(workDir);

    const result = checkDistFresh(workDir, "@test/pkg");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('field exports["."].types points at ./dist/index.d.ts');
  });

  it("passes when every declared dist target exists", () => {
    writePackageJson(workDir, {
      main: "./dist/index.js",
      bin: { "pkg-cli": "./dist/index.js" },
      exports: { ".": { import: "./dist/index.js" } },
    });
    layOutFreshBuild(workDir);

    expect(checkDistFresh(workDir, "@test/pkg").ok).toBe(true);
  });

  it("ignores an `exports` target outside dist/ (a ./src entry is not this check's concern)", () => {
    writePackageJson(workDir, {
      exports: {
        ".": { import: "./dist/index.js" },
        "./test-helpers": { import: "./src/__tests__/test-helpers.ts" },
      },
    });
    layOutFreshBuild(workDir);

    expect(checkDistFresh(workDir, "@test/pkg").ok).toBe(true);
  });
});
