/**
 * Story 39.1 -- the documents state `iris_message_search` and its default state (project rules #30 and #43).
 *
 * The unit suites pin the tool, the governance keys and the rosters; none reads a document. This file
 * asserts, for the change that alters what a reader sees:
 *
 *  - the CHANGELOG's Story 39.1 section: its title and headings, the counts it states, the `BOOTSTRAP_VERSION`
 *    move this story made (pinned as history), and that it holds no roster-summary string (the roster
 *    guard reads the first match in the file, which is the Epic 30 section);
 *  - the changeset's exact bump map (AD-29);
 *  - `tool_support.md`: the tool's row, the section's tool count and the Story 39.1 note with the default
 *    state of the three keys;
 *  - the root README and the interop README: the governance row and subsection with the default state, the
 *    refusal-code row, and the payload table's re-measure marker.
 *
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in
 * `@iris-mcp/all` (rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const squash = (text: string): string => text.replace(/\s+/g, " ");

/** The sections of a CHANGELOG, each starting at its `## [` heading. */
function sectionsOf(changelog: string): string[] {
  return changelog.split(/^(?=## \[)/m).slice(1);
}

/**
 * The `BOOTSTRAP_VERSION` move this story recorded: the version before it, and the one it left. Both are
 * history, pinned as literals (a later story moves the embed's version without touching this section).
 */
const PREVIOUS_BOOTSTRAP_VERSION = "089f8f0a62b2";
const STORY_BOOTSTRAP_VERSION = "6dcdd238c792";

describe("Story 39.1: the CHANGELOG section and the changeset", () => {
  const section =
    sectionsOf(read("CHANGELOG.md")).find((candidate) =>
      /^## \[Pre-release[^\]]*\] . Story 39\.1: Message header search$/.test(candidate.split("\n")[0] ?? ""),
    ) ?? "";

  it("the CHANGELOG has the Story 39.1 section, with Added, Changed and Tests headings", () => {
    expect(section, "the CHANGELOG has the Story 39.1 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual(["### Added", "### Changed", "### Tests"]);
  });

  it("states the new counts, the default state of the keys and that the baseline stays", () => {
    const text = squash(section);
    expect(text).toContain("`iris_message_search`");
    expect(text).toContain("from 22 to 23 package tools (24 advertised)");
    expect(text).toContain("from 107 to 108 package tools (113 advertised)");
    expect(text).toContain("are reads and are enabled by default");
    expect(text).toContain("`1e62c5ad5bf7`");
    expect(text).toContain("(141 keys)");
  });

  it("states the interop core move and the new refusal code", () => {
    const text = squash(section);
    expect(text).toContain("(10 to 11 runtime tools)");
    expect(text).toContain("`NOT_IMPLEMENTED`");
  });

  it("states the BOOTSTRAP_VERSION move from the version before this story to the version it left", () => {
    const text = squash(section);
    expect(text).toContain(`\`${PREVIOUS_BOOTSTRAP_VERSION}\` to \`${STORY_BOOTSTRAP_VERSION}\``);
    expect(text).toContain("31 classes instead of 30");
  });

  it("the section carries no roster-summary string, which docs-visibility-roster-sync reads from the first match in the file", () => {
    expect(section).not.toMatch(/(?:full|core|developer)\s*`?\s*\d+\/\d+\/\d+\/\d+\/\d+/);
  });

  // `changeset version` consumes (deletes) the file and moves its text into the generated package
  // changelogs, so the bumps are checked while the file exists.
  const changesetPath = ".changeset/story-39-1-message-header-search.md";
  const changesetPresent = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!changesetPresent)("the changeset bumps exactly shared minor and interop minor (AD-29)", () => {
    const changeset = read(changesetPath);
    const frontMatter = /^---\n([\s\S]*?)\n---/.exec(changeset)?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontMatter
        .split("\n")
        .map((line) => /^"([^"]+)":\s*(\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1], match[2]]),
    );
    expect(bumps).toEqual({ "@iris-mcp/shared": "minor", "@iris-mcp/interop": "minor" });
  });
});

describe("Story 39.1: tool_support.md states the tool and the default state", () => {
  const toolSupport = read("tool_support.md");

  it("lists the tool as row 23 of the interop section, which counts 23", () => {
    // The characters the document uses, by code point: U+2014 em dash, U+1F7E5 large red square, U+00B7 middle dot.
    const emDash = String.fromCodePoint(0x2014);
    const redSquare = String.fromCodePoint(0x1f7e5);
    const middleDot = String.fromCodePoint(0xb7);
    expect(toolSupport).toContain(`## \`@iris-mcp/interop\` ${emDash} Interoperability (23)`);
    expect(toolSupport).toContain(`| 23 | \`iris_message_search\` | ${redSquare} ExecuteMCPv2 | \`/interop/message/search\` |`);
    expect(toolSupport).toContain(`**Mix:** 0 Atelier ${middleDot} 23 ExecuteMCPv2 ${middleDot} 0 other`);
  });

  it("the Story 39.1 note says all three keys are reads, enabled by default, and how to restrict one", () => {
    const note = squash(toolSupport.split("\n").find((line) => line.startsWith("> **Story 39.1")) ?? "");
    expect(note, "tool_support.md has the Story 39.1 note").not.toBe("");
    expect(note).toContain("All three keys are truthfully `read` and are **enabled by default**");
    expect(note).toContain("stay enabled under the `read-only` preset");
    expect(note).toContain('{"global":{"iris_message_search:headers":false}}');
    expect(note).toContain("`NOT_IMPLEMENTED`");
    expect(note).toContain("the `resendFiltered` dry-run and refusal wire is byte-identical");
    expect(note).toContain("`MessageResendLiveTest` only");
  });

  it("counts the suite at 108 tools, 83 of them on the custom handlers, and the interop row at 23 / 24", () => {
    expect(toolSupport).toContain("| `@iris-mcp/interop` | 0 | 23 | 0 | **23** | **24** |");
    expect(toolSupport).toContain("| **Total** | **20** | **83** | **5** | **108** | **113** |");
  });
});

describe("Story 39.1: the READMEs state the tool, its default state and the refusal code", () => {
  const rootReadme = read("README.md");
  const interopReadme = read("packages/iris-interop-mcp/README.md");

  it("the root governance-defaults table has the iris_message_search row: all reads, enabled by default", () => {
    const row = squash(rootReadme.split("\n").find((line) => line.startsWith("| interop | `iris_message_search` |")) ?? "");
    expect(row, "the governance-defaults row").not.toBe("");
    expect(row).toContain("all three actions are reads");
    expect(row).toContain("`headers`, `body`, `searchTable`");
    expect(row).toContain("all enabled by default");
    expect(row).toContain("still enabled under the read-only preset");
  });

  it("the root refusal table has the NOT_IMPLEMENTED row", () => {
    const row = squash(rootReadme.split("\n").find((line) => line.startsWith("| `NOT_IMPLEMENTED` |")) ?? "");
    expect(row, "the refusal-code row").not.toBe("");
    expect(row).toContain("No IRIS call was made.");
    expect(row).toContain("`availableActions`");
  });

  it("the root README says the payload table was last re-measured at Story 39.1", () => {
    expect(squash(rootReadme)).toContain("Last re-measured at Story 39.1 (`pnpm measure:tools-payload`");
  });

  it("the interop README has a subsection for the tool with the governance default and the 7-day window", () => {
    const start = interopReadme.indexOf("#### `iris_message_search`");
    expect(start, "the interop README has the iris_message_search subsection").toBeGreaterThanOrEqual(0);
    const next = interopReadme.indexOf("\n#### ", start + 1);
    const text = squash(interopReadme.slice(start, next === -1 ? undefined : next));
    expect(text).toContain("> **Governance default:** all three actions (`headers`, `body`, `searchTable`) are pure **reads**");
    expect(text).toContain("are **enabled by default**");
    expect(text).toContain("including under the `read-only` preset");
    expect(text).toContain("at most **7 days**");
    expect(text).toContain("An **output cap**, not timeout protection");
    expect(text).toContain("`notApplicable: true`");
  });

  it("the interop README lists the tool in the Production Monitoring table and counts 23 tools", () => {
    expect(interopReadme).toContain("| `iris_message_search` |");
    expect(interopReadme).toContain("All 23 interoperability tools operate in the context");
    expect(interopReadme).toContain("**11-tool runtime roster** (10 package tools + `iris_server_profiles`)");
    expect(interopReadme).toContain("**24 runtime tools** (23 + `iris_server_profiles`)");
  });
});
