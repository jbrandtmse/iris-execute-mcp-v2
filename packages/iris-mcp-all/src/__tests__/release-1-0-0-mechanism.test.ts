/**
 * Story 42.1 (AC 42.1.4, DW-394; AD-29, Rule #49, Rule #59) - the mechanism that makes the first release land on
 * exactly `1.0.0`, proven with the repository's REAL `changeset version`.
 *
 * The mechanism is a release changeset that names all eight `@iris-mcp/*` packages as `major`, kept as a template at
 * `scripts/release/changeset-1.0.0.md` (outside `.changeset/`, which Changesets would consume) and applied once by
 * Story 42.6. Because the config's `fixed` group moves every package to the highest bump, one major entry takes the
 * group from `0.0.x` to `1.0.0` whatever the patch/minor entries say.
 *
 * `changeset version` rewrites the files it runs on, so it runs ONLY in a throwaway fixture under `os.tmpdir()`: the
 * root manifest, the workspace file, `.changeset/` (with every pending changeset), and each package's manifest and
 * changelog, plus a `node_modules` link to the repository's. The real tree is never versioned. Nothing is published.
 * The fixture builder is `release-fixture.ts`, which the version-step test (`release-version.test.ts`) shares.
 *
 *  - With the template: all eight packages are exactly `1.0.0`, each changelog's first `## ` is its only `## 1.0.0` and
 *    holds the release line, `workspace:*` is untouched, and the pending files are consumed.
 *  - The red control: the same fixture WITHOUT the template gives `0.1.0` (while a minor is pending), so the template is
 *    what moves the result.
 *  - On the real tree: no pending changeset declares `major` (AD-29: no major before Story 42.6) and no `pre.json` exists.
 *
 * Once the packages are released (every version is at least 1.0.0) the template has been applied: the fixture runs, the
 * template check and the no-major check are skipped (after 1.0.0 a breaking change takes a new major, AD-15); the
 * `pre.json` check keeps running.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./pack-fixture";
import { PACKAGE_DIRS, TEMPLATE, makeFixture, manifestOf, pendingChangesets, removeFixtures } from "./release-fixture";

const RELEASE_LINE = "First public release: every `@iris-mcp/*` package is published at 1.0.0 together.";
const released = PACKAGE_DIRS.every((dir) => Number(manifestOf(REPO_ROOT, dir).version.split(".")[0]) >= 1);

afterAll(removeFixtures);

/** Run the repository's own `changeset version` (the target of `node_modules/.bin/changeset`) in `cwd`. */
function changesetVersion(cwd: string): { status: number | null; stdout: string; stderr: string } {
  const cliPackage = join(REPO_ROOT, "node_modules/@changesets/cli");
  const bin = (JSON.parse(readFileSync(join(cliPackage, "package.json"), "utf8")) as { bin: Record<string, string> }).bin["changeset"] as string;
  const result = spawnSync(process.execPath, [join(cliPackage, bin), "version"], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, CI: "true" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("the real tree (AD-29: no major before Story 42.6)", () => {
  it.skipIf(released)("no pending changeset declares a major bump", () => {
    const offenders: string[] = [];
    for (const name of pendingChangesets(join(REPO_ROOT, ".changeset"))) {
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(REPO_ROOT, ".changeset", name), "utf8"))?.[1] ?? "";
      if (/:\s*["']?major["']?\s*$/m.test(frontmatter)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it("there is no pre-release mode (no .changeset/pre.json)", () => {
    expect(existsSync(join(REPO_ROOT, ".changeset/pre.json"))).toBe(false);
  });

  it.skipIf(released)("the template names all eight packages as major and sits outside .changeset/", () => {
    const template = readFileSync(TEMPLATE, "utf8");
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(template)?.[1] ?? "";
    const entries = frontmatter.split("\n").map((line) => /^"(@iris-mcp\/[a-z-]+)": (\w+)$/.exec(line));
    expect(entries.every((entry) => entry !== null)).toBe(true);
    expect(entries.map((entry) => entry?.[2])).toEqual(Array(8).fill("major"));
    expect(entries.map((entry) => entry?.[1]).sort()).toEqual(PACKAGE_DIRS.map((dir) => manifestOf(REPO_ROOT, dir).name).sort());
    expect(template).toContain(RELEASE_LINE);
    expect(existsSync(join(REPO_ROOT, ".changeset", "changeset-1.0.0.md"))).toBe(false);
  });
});

describe.skipIf(released)("changeset version in a throwaway fixture (AC 42.1.4)", () => {
  it("with the template, all eight packages are exactly 1.0.0 with one 1.0.0 changelog section each", () => {
    const root = makeFixture({ withTemplate: true });
    const run = changesetVersion(root);
    expect(run.status, run.stderr || run.stdout).toBe(0);
    for (const dir of PACKAGE_DIRS) {
      const manifest = manifestOf(root, dir);
      expect(manifest.version, manifest.name).toBe("1.0.0");
      const changelog = readFileSync(join(root, "packages", dir, "CHANGELOG.md"), "utf8");
      const headings = changelog.split("\n").filter((line) => line.startsWith("## "));
      expect(headings[0], `${manifest.name}: first section`).toBe("## 1.0.0");
      expect(headings.filter((heading) => heading === "## 1.0.0"), `${manifest.name}: 1.0.0 sections`).toHaveLength(1);
      const section = changelog.slice(changelog.indexOf("## 1.0.0"), headings[1] === undefined ? undefined : changelog.indexOf(headings[1]));
      expect(section, `${manifest.name}: the release line`).toContain(RELEASE_LINE);
    }
  });

  it("with the template, workspace:* specifiers are untouched and the pending files are consumed", () => {
    const root = makeFixture({ withTemplate: true });
    const before = new Map(PACKAGE_DIRS.map((dir) => [dir, manifestOf(root, dir).dependencies] as const));
    expect(changesetVersion(root).status).toBe(0);
    for (const dir of PACKAGE_DIRS) expect(manifestOf(root, dir).dependencies, dir).toEqual(before.get(dir));
    const internal = PACKAGE_DIRS.flatMap((dir) => Object.entries(manifestOf(root, dir).dependencies ?? {}).filter(([name]) => name.startsWith("@iris-mcp/")));
    expect(internal.length).toBeGreaterThan(0);
    for (const [name, specifier] of internal) expect(specifier, name).toBe("workspace:*");
    expect(pendingChangesets(join(root, ".changeset"))).toEqual([]);
  });

  it("red control: the same fixture WITHOUT the template does not land on 1.0.0 (0.1.0 with the pending minors), so the template is what makes 1.0.0", () => {
    const root = makeFixture({ withTemplate: false });
    const run = changesetVersion(root);
    expect(run.status, run.stderr || run.stdout).toBe(0);
    const bumps = pendingChangesets(join(REPO_ROOT, ".changeset")).map((name) => readFileSync(join(REPO_ROOT, ".changeset", name), "utf8"));
    const frontmatterOf = (text: string): string => /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    const anyMinor = bumps.some((text) => /:\s*["']?minor["']?\s*$/m.test(frontmatterOf(text)));
    const anyPatch = bumps.some((text) => /:\s*["']?patch["']?\s*$/m.test(frontmatterOf(text)));
    for (const dir of PACKAGE_DIRS) {
      const version = manifestOf(root, dir).version;
      expect(version, dir).not.toBe("1.0.0");
      // The fixed group moves every package to the highest current version plus the largest pending bump; with no pending
      // changeset nothing moves at all.
      if (anyMinor) expect(version, dir).toBe("0.1.0");
      else if (anyPatch) expect(version, dir).toBe("0.0.3");
      else expect(version, dir).toBe(manifestOf(REPO_ROOT, dir).version);
    }
  });
});
