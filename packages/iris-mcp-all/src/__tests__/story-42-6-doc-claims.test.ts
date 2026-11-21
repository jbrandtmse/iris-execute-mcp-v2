/**
 * Story 42.6 (AC 42.6.1 to 42.6.3, DW-47, DW-300, DW-612, DW-637, DW-665, DW-696; AD-29; project rules #30 and #43) -- the documents say
 * what the first release is and how it is run. One claim each, on the pattern of `story-42-5-doc-claims.test.ts`:
 *  - the root CHANGELOG section of 1.0.0 is found by its title, starts with `## [`, and is above Story 42.5's (the relative order, so a
 *    later story's section above it leaves this file true). It names the first public release and the shared version, the
 *    `BOOTSTRAP_VERSION` move as the literal the version step printed, the main rule, the checks `prepare` runs, `verify`, `--keep`, the
 *    CHANGELOG that ships in the tarballs, and the SDK bump;
 *  - the README `### Releasing` subsection names the main rule, the merge before the tag, and `pnpm release verify --version`.
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

const TITLE = /^## \[1\.0\.0\] — \d{4}-\d{2}-\d{2} — Story 42\.6: Tarball Smoke and 1\.0\.0 Publish$/;

const sections = read("CHANGELOG.md").split(/^(?=## \[)/m).slice(1);
const titles = sections.map((section) => section.split("\n")[0] ?? "");

describe("Story 42.6: the CHANGELOG section of 1.0.0", () => {
  const index = titles.findIndex((title) => TITLE.test(title));
  const section = squash(sections[index] ?? "");

  it("is found by its title, starts with `## [`, and is above Story 42.5's section", () => {
    expect(index, "a section titled `## [1.0.0] — <date> — Story 42.6: Tarball Smoke and 1.0.0 Publish`").toBeGreaterThanOrEqual(0);
    expect(titles.filter((title) => TITLE.test(title))).toHaveLength(1);
    const previous = titles.findIndex((title) => /Story 42\.5: Release Workflow/.test(title));
    expect(previous).toBeGreaterThan(index);
  });

  it("is the first public release: one shared version, npm provenance, the pinned major launch, and the Node floor", () => {
    expect(section).toContain("The first public release. All eight `@iris-mcp/*` packages are at `1.0.0`, one shared version.");
    expect(section).toContain("with provenance");
    expect(section).toContain("the five servers launch as `npx -y @iris-mcp/<server>@1`");
    expect(section).toContain("Node `>=22.17.0`");
    expect(section).toContain("The per-story \"Pre-release\" sections below are the history up to `1.0.0`.");
  });

  it("names the BOOTSTRAP_VERSION move that the version step printed, with the class content and sequence unchanged", () => {
    expect(section).toContain("`BOOTSTRAP_VERSION` moves from `0.0.2+2.244fe8623c76` to `1.0.0+2.244fe8623c76`");
    expect(section).toContain("the class content and the sequence are unchanged");
  });

  it("names the main rule, the checks prepare runs, verify, --keep and the CHANGELOG that ships in the tarballs", () => {
    expect(section).toContain("The release refuses a tag that is not on `main`");
    expect(section).toContain("`identical` or `behind`");
    expect(section).toContain("There is no maintenance-branch allowance.");
    expect(section).toContain("`check:provenance` and `validate:prompts` run on the publish path");
    expect(section).toContain("`node scripts/release.mjs verify --version <x.y.z>`");
    expect(section).toContain("`npx -y @iris-mcp/dev@1`");
    expect(section).toContain("`node scripts/ci-package-smoke.mjs --keep <dir>`");
    expect(section).toContain("`<dir>/.mcp.json`");
    expect(section).toContain("`CHANGELOG.md` ships in every tarball");
    expect(section).toContain("`## 1.0.0` section");
  });

  it("names the SDK bump, and says that no tool, prompt, governance or wire change is made and that no changeset is added", () => {
    expect(section).toContain("The MCP SDK is pinned at `2.4.0`");
    expect(section).toContain("fast-uri `3.1.8`");
    expect(section).toContain("every frozen golden is byte-identical");
    expect(section).toContain("No tool, prompt, governance or wire change is made");
    expect(section).toContain("This story adds no changeset");
  });
});

describe("Story 42.6: the README Releasing subsection", () => {
  const readme = read("README.md");
  const start = readme.indexOf("\n### Releasing\n");
  const rest = readme.slice(start + 1);
  const next = rest.slice("### Releasing\n".length).search(/^#{1,3} /m);
  const section = squash(next < 0 ? rest : rest.slice(0, next + "### Releasing\n".length));

  it("is found", () => {
    expect(start).toBeGreaterThan(0);
    expect(section.length).toBeGreaterThan(500);
  });

  it("says to merge to main before tagging, and that ci-gate refuses a tag that main does not contain, before the wait", () => {
    expect(section).toContain("merge it to `main`, and wait for CI to be green on the merged commit");
    expect(section).toContain("`ci-gate` refuses a tag whose commit `main` does not contain");
    expect(section).toContain("GitHub's compare of `main...<sha>` answers `identical` or `behind`");
    expect(section).toContain("The main check comes before the wait, so a refused tag asks for no approval, and there is no maintenance-branch allowance.");
  });

  it("names the verify step with its command, and what prepare runs", () => {
    expect(section).toContain("`pnpm release verify --version <MAJOR.MINOR.PATCH>`");
    expect(section).toContain("`pnpm release verify --version 1.0.0`");
    expect(section).toContain("`npx -y @iris-mcp/dev@1`");
    expect(section).toContain("`prepare` runs every root check script that CI's `gates` job runs");
    expect(section).toContain("`check:provenance`, `validate:prompts`");
    expect(section).toContain("`format:check` is the one exemption");
  });
});
