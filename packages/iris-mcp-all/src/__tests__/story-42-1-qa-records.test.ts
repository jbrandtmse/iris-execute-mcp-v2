/**
 * Story 42.1 QA (AC 42.1.8; Rule #51, Rule #56) - the records the story leaves for Stories 42.5 and 42.6: the CHANGELOG
 * section, the story's changeset and the per-package pack file lists.
 *
 *  - The root CHANGELOG has a "Story 42.1: Pre-Publish Package Fixes" section above Story 43.4's. Its "Changed (AD-15
 *    sanctioned)" subsection names the `@1` pin and the Node floor and says re-apply pins existing managed entries. No `1.0.0`
 *    section exists before the release (Story 42.6 writes it).
 *  - The story's changeset names all eight packages, `@iris-mcp/client-config` as `minor` and the other seven as `patch`. It is
 *    consumed by `changeset version`, so its check skips once the file is gone.
 *  - `42-1-pack-file-lists.md` lists one tarball per package. The counts are derived from the lists themselves: the table, each
 *    heading and the bullets agree, and every list carries `package.json`, `LICENSE` and `README.md` and no test helper, test,
 *    source map or TypeScript source. The lists are a point-in-time record, so they are NOT compared with today's tarballs
 *    (`published-tarballs.test.ts` checks those).
 *
 * A default-suite test (no IRIS, no build).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./pack-fixture";

const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

const PACKAGES = readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(REPO_ROOT, "packages", entry.name, "package.json")))
  .map((entry) => ({
    directory: `packages/${entry.name}`,
    ...(JSON.parse(read(`packages/${entry.name}/package.json`)) as { name: string; version: string }),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
const released = PACKAGES.every((pkg) => Number(pkg.version.split(".")[0]) >= 1);

describe("the root CHANGELOG section of Story 42.1", () => {
  const sections = read("CHANGELOG.md").split(/^(?=## \[)/m).slice(1);
  const own = sections.find((section) => section.startsWith("## [Pre-release") && /Story 42\.1: Pre-Publish Package Fixes/.test(section.split("\n")[0] ?? ""));

  it("exists, above the Story 43.4 section", () => {
    expect(own, "a section titled Story 42.1: Pre-Publish Package Fixes").toBeDefined();
    const titles = sections.map((section) => section.split("\n")[0] ?? "");
    const ownIndex = titles.findIndex((title) => /Story 42\.1:/.test(title));
    const previousIndex = titles.findIndex((title) => /Story 43\.4:/.test(title));
    expect(ownIndex).toBeGreaterThanOrEqual(0);
    expect(previousIndex).toBeGreaterThan(ownIndex);
  });

  it("names the @1 pin and the Node floor under 'Changed (AD-15 sanctioned)' and says re-apply pins existing managed entries", () => {
    const changed = /### Changed \(AD-15 sanctioned\)\n([\s\S]*?)(?=\n### |\n## \[|$)/.exec(own ?? "")?.[1];
    expect(changed, "a '### Changed (AD-15 sanctioned)' subsection").toBeDefined();
    const text = squash(changed ?? "");
    expect(text).toContain("IRIS_MCP_MAJOR");
    expect(text).toContain("`@1`");
    expect(text).toContain("Re-apply pins existing managed entries");
    expect(text).toContain("`engines.node >=22.17.0`");
  });

  it.skipIf(released)("no root 1.0.0 section exists before the release (Story 42.6 writes it)", () => {
    expect(sections.map((section) => section.split("\n")[0] ?? "").filter((title) => /\b1\.0\.0\b/.test(title) && !/Story \d/.test(title))).toEqual([]);
  });
});

describe("the story's changeset", () => {
  const path = ".changeset/story-42-1-pre-publish-package-fixes.md";
  const present = existsSync(join(REPO_ROOT, path));

  it.skipIf(!present)("bumps @iris-mcp/client-config by a minor and the other seven packages by a patch, and no major", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(read(path))?.[1] ?? "";
    const bumps = Object.fromEntries([...frontmatter.matchAll(/^"(@iris-mcp\/[a-z-]+)":\s*(\w+)\s*$/gm)].map((match) => [match[1], match[2]]));
    expect(Object.keys(bumps).sort()).toEqual(PACKAGES.map((pkg) => pkg.name).sort());
    expect(bumps["@iris-mcp/client-config"]).toBe("minor");
    expect(Object.entries(bumps).filter(([name]) => name !== "@iris-mcp/client-config").map(([, bump]) => bump)).toEqual(Array(7).fill("patch"));
  });
});

describe("42-1-pack-file-lists.md (AC 42.1.8)", () => {
  const text = read("_bmad-output/implementation-artifacts/42-1-pack-file-lists.md");
  const tableRows = [...text.matchAll(/^\| `(@iris-mcp\/[a-z-]+)` \| `([^`]+)` \| ([\d.]+) \| (\d+) \| (\d+) \|$/gm)].map((match) => ({
    name: match[1] as string,
    directory: match[2] as string,
    files: Number(match[4]),
    bytes: Number(match[5]),
  }));
  const blocks = text
    .split(/^(?=## )/m)
    .slice(1)
    .map((block) => {
      const heading = /^## (@iris-mcp\/[a-z-]+) \((\d+) files, (\d+) bytes\)/.exec(block);
      return { name: heading?.[1] ?? "", files: Number(heading?.[2]), bytes: Number(heading?.[3]), paths: [...block.matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1] as string) };
    });

  it("has a table row and a list for each of the eight packages, and no other", () => {
    const names = PACKAGES.map((pkg) => pkg.name).sort();
    expect(names).toHaveLength(8);
    expect(tableRows.map((row) => row.name).sort()).toEqual(names);
    expect(blocks.map((block) => block.name).sort()).toEqual(names);
    for (const pkg of PACKAGES) expect(tableRows.find((row) => row.name === pkg.name)?.directory, pkg.name).toBe(pkg.directory);
  });

  it("agrees with itself: the table, each heading and the bullets give the same file count and byte size", () => {
    for (const block of blocks) {
      const row = tableRows.find((candidate) => candidate.name === block.name);
      expect(block.paths.length, `${block.name}: bullets vs heading`).toBe(block.files);
      expect(row?.files, `${block.name}: table vs heading files`).toBe(block.files);
      expect(row?.bytes, `${block.name}: table vs heading bytes`).toBe(block.bytes);
      expect(new Set(block.paths).size, `${block.name}: duplicate paths`).toBe(block.paths.length);
      expect([...block.paths].sort(), `${block.name}: paths are sorted`).toEqual(block.paths);
    }
  });

  it("each list carries package.json, LICENSE and README.md, and no test helper, test, source map or TypeScript source", () => {
    for (const block of blocks) {
      for (const required of ["package.json", "LICENSE", "README.md"]) expect(block.paths, `${block.name} lacks ${required}`).toContain(required);
      const forbidden = block.paths.filter(
        (file) => /(^|\/)dist\/test-helpers(\/|$)/.test(file) || /(^|\/)__tests__(\/|$)/.test(file) || /\.map$/.test(file) || (/\.(ts|mts|cts)$/.test(file) && !/\.d\.(ts|mts|cts)$/.test(file)),
      );
      expect(forbidden, block.name).toEqual([]);
    }
  });
});
