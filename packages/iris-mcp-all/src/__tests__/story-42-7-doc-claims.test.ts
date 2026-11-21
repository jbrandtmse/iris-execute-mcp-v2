/**
 * Story 42.7 (AC 42.7.1 to 42.7.3, DW-389, DW-532, DW-663; AD-28, AD-29; project rules #30 and #43) -- the documents say what the
 * extension publish is and how it is run. One claim each, on the pattern of `story-42-6-doc-claims.test.ts`:
 *  - the root README `### Releasing` channel table names each channel, its default state and the story that enables it, matching
 *    `RELEASE_CHANNELS` (both stores enabled, IPM not), and its "Store authentication" paragraph names the publisher, the Marketplace's
 *    trusted publishing, Open VSX's first-publish token, the lookup before each upload and where each credential goes;
 *  - the root CHANGELOG section of Story 42.7 is found by its title, is above Story 42.6's, names no `BOOTSTRAP_VERSION` move and says
 *    that no package, tool, wire or governance change is made;
 *  - the extension README is the store listing: it no longer says "not yet published", it names both stores and the id, it carries the
 *    disclaimer that the project is not made, endorsed or supported by InterSystems, and the publish checklist is gone;
 *  - the extension CHANGELOG has a section headed `## [Unreleased]` (or the version, once the version step renamed it) that records the
 *    publisher, the lockstep and the working directory.
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { RELEASE_CHANNELS } from "../../../../scripts/lib/release-core.mjs";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

/** The text under a `### ` heading of the README, up to the next heading of any level. */
function sectionUnder(document: string, heading: string): string {
  const lines = document.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return "";
  const end = lines.findIndex((line, index) => index > start && /^#{1,6} /.test(line));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join("\n");
}

const rootChangelog = read("CHANGELOG.md");
const sections = rootChangelog.split(/^(?=## \[)/m).slice(1);
const titles = sections.map((section) => section.split("\n")[0] ?? "");

describe("Story 42.7: the root README Releasing subsection", () => {
  const releasing = sectionUnder(read("README.md"), "### Releasing");
  const flat = squash(releasing);

  it("the channel table states each channel's default state and the story that enables it, matching the code", () => {
    const rows = releasing.split("\n").filter((line) => line.startsWith("| ")).slice(2);
    expect(rows).toHaveLength(RELEASE_CHANNELS.length);
    expect(rows.map((row) => squash(row))).toEqual([
      "| npm (`@iris-mcp/*`) | enabled | |",
      "| VS Code Marketplace (the extension's vsix) | disabled: `skipped: not enabled (owner: publisher needs a verified domain (DW-719))` | owner: publisher needs a verified domain (DW-719) |",
      "| Open VSX (the same vsix) | enabled | Story 42.7 |",
      "| IPM (the root `module.xml`; the owner's Open Exchange Release) | manual step | Story 42.8 |",
      "| MCP Registry (the five `server.json` listings), last | enabled | Story 42.8 |",
    ]);
    expect(RELEASE_CHANNELS.map((channel: { id: string; enabled: boolean }) => [channel.id, channel.enabled])).toEqual([
      ["npm", true],
      ["vscode-marketplace", false],
      ["open-vsx", true],
      ["ipm", true],
      ["mcp-registry", true],
    ]);
  });

  it("step 1 says that the version step stamps the extension and renames its changelog heading, and that prepare refuses a mismatch", () => {
    expect(flat).toContain("It also stamps the VS Code extension, which follows the shared version");
    expect(flat).toContain("its `package.json` and `package-lock.json` are set to the new version");
    expect(flat).toContain("the `## [Unreleased]` heading of its `CHANGELOG.md`");
    expect(flat).toContain("`prepare` refuses a release whose extension manifest, lock or changelog heading is not at the release version.");
  });

  it("the jobs paragraph says that rehearse and publish install the store CLIs with no install script, and that rehearse reads each store", () => {
    expect(flat).toContain("`rehearse` installs the store CLIs (`@vscode/vsce` and `ovsx`, exact pins of the extension, with `npm ci --ignore-scripts`)");
    expect(flat).toContain("reads each store, read-only, to say whether the vsix is ready; it has no environment, no OIDC permission and no secret.");
    expect(flat).toContain("then the extension to the VS Code Marketplace and to Open VSX (it installs the same two CLIs first, with no install script)");
  });

  it("the Store authentication paragraph names the publisher, the lookup, each store's route and where each credential goes", () => {
    expect(flat).toContain("**Store authentication.**");
    expect(flat).toContain("the publisher `iris-mcp` on both stores");
    expect(flat).toContain("and the Open VSX namespace, which Open VSX matches case-sensitively");
    expect(flat).toContain("asks the store, read-only, whether it already holds the version");
    expect(flat).toContain("is `already published` and nothing is uploaded");
    expect(flat).toContain("an answer that cannot be judged (an unreadable store, or a 200 that is not the store's own answer) stops the release before that store's upload");
    expect(flat).toContain("The Marketplace uses trusted publishing (`vsce publish --oidc`");
    expect(flat).toContain("Azure DevOps global personal access tokens stop working on 2026-12-01");
    expect(flat).toContain("there is no Marketplace secret");
    expect(flat).toContain("Open VSX needs an access token for the first publish of an extension");
    expect(flat).toContain("the `OVSX_PAT` secret of the `release` environment");
    expect(flat).toContain("`OVSX_PAT=<token> npx ovsx create-namespace iris-mcp`");
    expect(flat, "the token is never in a documented command's arguments").not.toMatch(/create-namespace [^`]*-p <token>/);
    // A `VAR=value cmd` line is saved in the shell history as typed: the README may not promise otherwise.
    expect(flat).not.toContain("not in the shell history");
    expect(flat).toContain("the shell still records the line as typed");
    expect(flat).toContain("The OIDC variables of the job reach only the three publish commands (`npm publish`, `vsce publish`, `ovsx publish`)");
    expect(flat).toContain("`OVSX_PAT` reaches only `ovsx publish` (as an environment variable, never in its arguments)");
    expect(flat).toContain("`VSCE_PAT` is never passed on");
    expect(flat).toContain("The extension's version equals the shared version");
  });

  it("the Continuous Integration section names the launcher job and its three runners", () => {
    const ci = squash(sectionUnder(read("README.md"), "### Continuous Integration"));
    expect(ci).toContain("It has five jobs:");
    expect(ci).toContain("`launcher` runs the launcher extension's whole test suite");
    for (const runner of ["ubuntu-24.04", "macos-15", "windows-2025"]) expect(ci, runner).toContain(`\`${runner}\``);
  });
});

describe("Story 42.7: the root CHANGELOG section", () => {
  const TITLE = /^## \[1\.1\.0 detail\] \u2014 Story 42\.7: VS Code Extension Publish$/;
  const index = titles.findIndex((title) => TITLE.test(title));
  const section = squash(sections[index] ?? "");

  it("is found by its title, and is above Story 42.6's section", () => {
    expect(index, "a section titled `## [1.1.0 detail] \u2014 Story 42.7: VS Code Extension Publish`").toBeGreaterThanOrEqual(0);
    expect(titles.filter((title) => TITLE.test(title))).toHaveLength(1);
    const previous = titles.findIndex((title) => /Story 42\.6: Tarball Smoke and 1\.0\.0 Publish/.test(title));
    expect(previous).toBeGreaterThan(index);
  });

  it("says that nothing but the extension and the release change: no package, no BOOTSTRAP_VERSION move, no tool, wire or governance change", () => {
    expect(section).toContain("No `@iris-mcp/*` package changes, so this story adds no changeset");
    expect(section).toContain("`BOOTSTRAP_VERSION` does not move");
    expect(section).toContain("no tool, prompt, governance or wire change is made");
    expect(section).toContain("`v1.0.0` publishes npm only");
  });

  it("states the default state of each channel, the lookup, the lockstep and the launcher job", () => {
    expect(section).toContain("Both channels are enabled by default; the IPM channel stays disabled until Story 42.8.");
    expect(section).toContain("`vsce publish --oidc`");
    expect(section).toContain("`OVSX_PAT`");
    expect(section).toContain("`@vscode/vsce` `4.1.1`, `ovsx` `1.4.0`");
    expect(section).toContain("`npm ci --ignore-scripts`");
    expect(section).toContain("A read-only store lookup before each upload.");
    expect(section).toContain("`already published`");
    expect(section).toContain("The extension follows the shared version.");
    expect(section).toContain("A `launcher` CI job (DW-532).");
    expect(section).toContain("`ubuntu-24.04`, `macos-15` and `windows-2025`");
    expect(section).toContain('`"private": true` (DW-389)');
    expect(section).toContain("(DW-663)");
  });
});

describe("Story 42.7: the extension README is the store listing", () => {
  const readme = read("extensions/iris-mcp-launcher/README.md");
  // The top of the file is a blockquote: its line prefixes are not part of the sentences.
  const flat = squash(readme.replace(/^> ?/gm, ""));

  it("no longer says that the extension is not yet published; it says it is not on the stores yet (DW-719)", () => {
    expect(flat).not.toMatch(/not yet published/i);
    expect(flat).toContain("It is not on the Visual Studio Marketplace or Open VSX yet.");
    expect(flat).not.toContain("TBD-at-publish-time");
    expect(flat).not.toMatch(/publish checklist/i);
  });

  it("names the extension id and the GitHub Releases vsix route, links no store page while the stores are not set up (DW-719), and keeps the vsix route for development", () => {
    expect(flat).not.toContain("marketplace.visualstudio.com/items?itemName=iris-mcp.iris-mcp-launcher");
    expect(flat).not.toContain("open-vsx.org/extension/iris-mcp/iris-mcp-launcher");
    expect(flat).toContain("[GitHub Releases](https://github.com/jbrandtmse/iris-execute-mcp-v2/releases)");
    expect(flat).toContain("`iris-mcp.iris-mcp-launcher`");
    expect(flat).toContain("code --install-extension iris-mcp-launcher-<version>.vsix");
    expect(flat).toContain("**Extensions: Install from VSIX…**");
    expect(flat).toContain("Updates are manual until the stores are set up");
    expect(flat).toContain("## Installing in development mode");
    expect(flat).toContain("code --uninstall-extension iris-mcp.iris-mcp-launcher");
  });

  it("carries the disclaimer that the project is not made, endorsed or supported by InterSystems (AD-28)", () => {
    expect(flat).toContain("This is an independent community project. It is not made, endorsed or supported by InterSystems.");
  });

  it("has a short Publishing note that points at the root Releasing section", () => {
    const publishing = squash(readme.slice(readme.indexOf("## Publishing"), readme.indexOf("## License")));
    expect(publishing).toContain("[Releasing](../../README.md#releasing)");
    expect(publishing).toContain("the extension's version equals the shared `@iris-mcp/*` version");
    expect(publishing).toContain('The package has `"private": true`, so `npm publish` can never send it to npm');
  });
});

describe("Story 42.7: the extension CHANGELOG", () => {
  const sectionsOfExtension = read("extensions/iris-mcp-launcher/CHANGELOG.md").split(/^(?=## \[)/m).slice(1);
  const current = squash(sectionsOfExtension.find((section) => section.includes("(Story 42.7)")) ?? "");

  it("has no section headed as unpublished 0.1.0, and its first section records the story", () => {
    expect(sectionsOfExtension.map((section) => section.split("\n")[0])).not.toContain("## [0.1.0] \u2014 Unreleased (not yet published)");
    expect(current).not.toBe("");
    expect(sectionsOfExtension[0]?.includes("(Story 42.7)"), "the first section is the one that records the story").toBe(true);
  });

  it("records the publisher and `private`, the lockstep, the working directory and the green suite", () => {
    expect(current).toContain("The extension is ready for the Visual Studio Marketplace and Open VSX, but not on them yet");
    expect(current).toContain("installs from the vsix attached to the `v1.1.0` GitHub Release");
    expect(current).toContain("the publisher is `iris-mcp`");
    expect(current).toContain('`package.json` carries `"private": true`');
    expect(current).toContain("The extension's version equals the shared `@iris-mcp/*` version");
    expect(current).toContain("The clients and governance CLI spawns pass an explicit working directory");
    expect(current).toContain("(Story 42.7, DW-663)");
    expect(current).toContain("passes on macOS, Linux and Windows, and CI runs it on all three");
  });
});
