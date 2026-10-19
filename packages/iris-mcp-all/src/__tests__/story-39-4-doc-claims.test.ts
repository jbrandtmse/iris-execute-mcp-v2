/**
 * Story 39.4 -- the documents state the `searchTable` action of `iris_message_search`, its default state and
 * its data-policy behavior (project rules #30 and #43), and make no compliance claim (AD-26).
 *
 * The unit and live suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the CHANGELOG's Story 39.4 section: its title and headings, that no count or baseline moves, the
 *    `BOOTSTRAP_VERSION` move this story made (pinned as history), that `NOT_IMPLEMENTED` is no longer returned, and
 *    that it holds no roster-summary string (the roster guard reads the first match in the file);
 *  - the changeset's exact bump map (AD-29);
 *  - the root README's `NOT_IMPLEMENTED`, `DATA_POLICY_BLOCKED` and governance-defaults rows and its policy section;
 *  - the interop README's Search Table subsection and policy line;
 *  - `tool_support.md`: the Story 39.4 note and the scope row;
 *  - that no document claims regulatory compliance.
 *
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in
 * `@iris-mcp/all` (rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIMS } from "./doc-claims-patterns.js";

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

/** The `BOOTSTRAP_VERSION` move this story recorded, pinned as history. */
const PREVIOUS_BOOTSTRAP_VERSION = "f7b0868c95d0";
const STORY_BOOTSTRAP_VERSION = "b6ec56073e29";

/** The right arrow the documents use, by code point. */
const RIGHT_ARROW = String.fromCodePoint(0x2192);

describe("Story 39.4: the CHANGELOG section and the changeset", () => {
  const section =
    sectionsOf(read("CHANGELOG.md")).find((candidate) =>
      /^## \[Pre-release[^\]]*\] . Story 39\.4: Search Table lookup$/.test(candidate.split("\n")[0] ?? ""),
    ) ?? "";

  it("the CHANGELOG has the Story 39.4 section, with Added, Changed and Tests headings", () => {
    expect(section, "the CHANGELOG has the Story 39.4 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual(["### Added", "### Changed", "### Tests"]);
  });

  it("names the action, its default state, the policy refusal and the audit redaction", () => {
    const text = squash(section);
    expect(text).toContain("The `searchTable` action of `iris_message_search` finds messages by an indexed Search Table value");
    expect(text).toContain("it is a read, enabled by default");
    expect(text).toContain('{code: "DATA_POLICY_BLOCKED", action: "searchTable", policy: "block"}');
    expect(text).toContain('`"[REDACTED]"` in the audit log under `redact` and `block`');
    expect(text).toContain("No caller text becomes SQL");
  });

  it("names the changes: the route's action text, filters refused naming both actions, searchTableClass refused off its action, NOT_IMPLEMENTED gone", () => {
    const text = squash(section);
    expect(text).toContain("`Parameter 'action' must be one of: headers, body, searchTable`");
    expect(text).toContain("`'filters' applies only to the body and searchTable actions.`");
    expect(text).toContain("`searchTableClass` is refused on `headers` and `body`");
    expect(text).toContain("`searchTable` no longer answers `NOT_IMPLEMENTED`");
    expect(text).toContain('`dataPolicy.actions` becomes `["body", "searchTable"]`');
  });

  it("states that no tool count or governance baseline moves", () => {
    const text = squash(section);
    expect(text).toContain("no tool count moves");
    expect(text).toContain("`1e62c5ad5bf7`");
    expect(text).toContain("(141 keys)");
    expect(text).toContain("108 package tools");
  });

  it("states the BOOTSTRAP_VERSION move from the version before this story to the version it left", () => {
    const text = squash(section);
    expect(text).toContain(`\`${PREVIOUS_BOOTSTRAP_VERSION}\` to \`${STORY_BOOTSTRAP_VERSION}\``);
    expect(text).toContain("still embeds 31 classes");
  });

  it("the section carries no roster-summary string, which docs-visibility-roster-sync reads from the first match in the file", () => {
    expect(section).not.toMatch(/(?:full|core|developer)\s*`?\s*\d+\/\d+\/\d+\/\d+\/\d+/);
  });

  // `changeset version` consumes (deletes) the file and moves its text into the generated package
  // changelogs, so the bumps are checked while the file exists.
  const changesetPath = ".changeset/story-39-4-search-table-lookup.md";
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

describe("Story 39.4: the root README names the searchTable action, its default state and the refusal", () => {
  const readme = read("README.md");

  it("the DATA_POLICY_BLOCKED row says the searchTable action returns it under block too, as a read enabled by default, with no IRIS call", () => {
    const row = squash(readme.split("\n").find((line) => line.startsWith("| `DATA_POLICY_BLOCKED` |")) ?? "");
    expect(row, "the refusal-code row").not.toBe("");
    expect(row).toContain("from Story 39.4 on by the `searchTable` action of the same tool (also a read, enabled by default)");
    expect(row).toContain("No IRIS call was made.");
  });

  it("the NOT_IMPLEMENTED row says no tool returns it as of Story 39.4, and keeps its no-IRIS-call statement", () => {
    const row = squash(readme.split("\n").find((line) => line.startsWith("| `NOT_IMPLEMENTED` |")) ?? "");
    expect(row).toContain("No tool returns it as of Story 39.4");
    expect(row).toContain("No IRIS call was made.");
    expect(row).toContain("`availableActions`");
  });

  it("the governance-defaults row says all three actions are enabled by default reads and searchTable is refused under block", () => {
    const row = squash(readme.split("\n").find((line) => line.startsWith("| interop | `iris_message_search` |")) ?? "");
    expect(row, "the governance-defaults row").not.toBe("");
    expect(row).toContain("all three actions are reads");
    expect(row).toContain("all enabled by default");
    expect(row).toContain("`searchTable` finds messages by an indexed Search Table value and is refused under the `block` data policy too, Story 39.4");
  });

  it("the PHI data policy section lists the searchTable action among what the policy governs", () => {
    const start = readme.indexOf("**What it governs today.**");
    expect(start, "the README has the 'What it governs today' paragraph").toBeGreaterThanOrEqual(0);
    const paragraph = squash(readme.slice(start, readme.indexOf("\n\n", start)));
    expect(paragraph).toContain("The `searchTable` action of the same tool (Story 39.4)");
    expect(paragraph).toContain("refused with `DATA_POLICY_BLOCKED` and no IRIS call under `block`");
    expect(paragraph).toContain("a read, enabled by default");
  });

  it("the payload table says it was last re-measured at a Story 39.x or 40.x, no earlier than the story that moved its bytes", () => {
    const match = /Last re-measured at Story (39|40)\.(\d+) \(`pnpm measure:tools-payload`/.exec(squash(readme));
    expect(match, "the re-measured sentence").not.toBeNull();
    expect(match?.[1] === "40" || Number(match?.[2]) >= 4).toBe(true);
  });
});

describe("Story 39.4: the interop README documents the Search Table lookup", () => {
  const interopReadme = read("packages/iris-interop-mcp/README.md");
  const start = interopReadme.indexOf("#### `iris_message_search`");
  const next = interopReadme.indexOf("\n#### ", start + 1);
  const subsection = squash(interopReadme.slice(start, next === -1 ? undefined : next));
  // The Search Table part alone, so a sentence of the body search above it cannot satisfy a pin below.
  const text = subsection.slice(Math.max(0, subsection.indexOf("**Search Table lookup (`searchTable`):**")));

  it("has the subsection, the option table and the filter grammar", () => {
    expect(start, "the interop README has the iris_message_search subsection").toBeGreaterThanOrEqual(0);
    expect(text.startsWith("**Search Table lookup (`searchTable`):**"), "the Search Table part exists").toBe(true);
    expect(text).toContain("It is a read, **enabled by default**.");
    expect(text).toContain("| `searchTableClass` | **Required.** The exact name of a compiled virtual-document Search Table class");
    expect(text).toContain("| `filters` | **Required.** 1 to 10 conditions combined with AND");
    expect(text).toContain("a value is at most 256 characters here");
    expect(text).toContain("| `bodyClass` | Optional.");
    expect(text).toContain("never returns a Search Table or body value");
  });

  it("states the stock HL7 properties, the clause semantics and the case rules", () => {
    expect(text).toContain("`PatientID` (PID-2, every PID-3 repetition and PID-4: use it for a medical record number)");
    expect(text).toContain("`ne` matches when the message has no entry equal to the value (not when some entry differs), a message that was never indexed included");
    expect(text).toContain("`isNull` when it has no non-empty entry (a message that was never indexed included)");
    expect(text).toContain("a `String:CaseSensitive` property such as `MSHControlID` compares exactly");
    expect(text).toContain("an Integer, Numeric or Boolean property accepts only `eq`, `ne`, `isNull` and `notNull`");
    expect(text).toContain("no match does not prove that no message holds the value");
    expect(text).toContain("A namespace with no Search Table property returns `notApplicable: true`");
    expect(text).toContain("lists the class's configured property names");
  });

  it("states the policy line: a read, enabled by default, refused under block, redact and allow run", () => {
    expect(text).toContain("> **Data policy:** the `searchTable` action is under the PHI data policy");
    expect(text).toContain("is a read, **enabled by default**");
    expect(text).toContain("Under `block` it is refused with `DATA_POLICY_BLOCKED` and no IRIS call");
    expect(text).toContain("Under `redact` and `allow` it runs");
    expect(text).toContain("restrict `iris_message_search:searchTable` with its governance key");
    expect(text).toContain('writes `filters` as `"[REDACTED]"` under `redact` and `block`');
    expect(text).toContain("it is not a compliance certification");
  });

  it("no longer says searchTable is declared for a later release or answers NOT_IMPLEMENTED", () => {
    expect(subsection).not.toContain("declared for a later release");
    expect(subsection).not.toContain("NOT_IMPLEMENTED");
  });
});

describe("Story 39.4: tool_support.md states the note, the scope row and the counts that do not move", () => {
  const toolSupport = read("tool_support.md");

  it("has the Story 39.4 note: no count, key or default moves, and the BOOTSTRAP_VERSION move", () => {
    const note = squash(toolSupport.split("\n").find((line) => line.startsWith("> **Story 39.4")) ?? "");
    expect(note, "tool_support.md has the Story 39.4 note").not.toBe("");
    expect(note).toContain("No tool, action or governance key is added, so no default state and no tool count moves");
    expect(note).toContain("`searchTable` stays an enabled-by-default read");
    expect(note).toContain("`DATA_POLICY_BLOCKED`");
    expect(note).toContain("No tool returns `NOT_IMPLEMENTED` any more");
    expect(note).toContain(`\`${PREVIOUS_BOOTSTRAP_VERSION}\` ${RIGHT_ARROW} \`${STORY_BOOTSTRAP_VERSION}\``);
    expect(note).toContain("(still 31 classes)");
  });

  it("the scope table lists iris_message_search as governed for body and searchTable, with their default state", () => {
    const row = squash(toolSupport.split("\n").find((line) => line.startsWith("| `iris_message_search` | governed |")) ?? "");
    expect(row, "the governed row").not.toBe("");
    expect(row).toContain("The `body` and `searchTable` actions are under the policy");
    expect(row).toContain("`DATA_POLICY_BLOCKED` under `block`");
    expect(row).toContain("a read, enabled by default");
    expect(row).toContain("restrict `iris_message_search:headers` with its governance key");
    expect(row).not.toContain("arrives in Story 39.4");
    expect(toolSupport.split("\n").filter((line) => line.startsWith("| `iris_message_search` |"))).toHaveLength(1);
  });

  it("counts the suite at 110 package tools and 115 advertised (Story 39.5 added one; Story 40.1 added iris_test_coverage)", () => {
    expect(toolSupport).toContain("| **Total** | **20** | **85** | **5** | **110** | **115** |");
  });
});

describe("Story 39.4: no new document text claims regulatory compliance", () => {
  const documents: Array<[string, string]> = [
    ["README.md", read("README.md")],
    ["tool_support.md", read("tool_support.md")],
    ["CHANGELOG.md (Story 39.4)", sectionsOf(read("CHANGELOG.md")).find((s) => s.includes("Story 39.4: Search Table lookup")) ?? ""],
    ...readdirSync(path.join(REPO_ROOT, "packages"))
      .filter((dir) => existsSync(path.join(REPO_ROOT, "packages", dir, "README.md")))
      .map((dir): [string, string] => [`packages/${dir}/README.md`, read(`packages/${dir}/README.md`)]),
    ...(existsSync(path.join(REPO_ROOT, ".changeset", "story-39-4-search-table-lookup.md"))
      ? [["the changeset", read(".changeset/story-39-4-search-table-lookup.md")] as [string, string]]
      : []),
  ];

  for (const [name, text] of documents) {
    it(`${name} makes no compliance claim`, () => {
      for (const claim of CLAIMS) expect(text.match(claim)?.[0], `${name} matches ${String(claim)}`).toBeUndefined();
    });
  }

  it("the scan reads the documents (an empty list would pass everything above)", () => {
    expect(documents.length).toBeGreaterThanOrEqual(8);
    for (const [name, text] of documents) expect(text.length, name).toBeGreaterThan(0);
  });
});
