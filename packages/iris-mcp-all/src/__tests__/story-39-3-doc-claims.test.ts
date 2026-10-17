/**
 * Story 39.3 -- the documents state the `body` action of `iris_message_search`, its default state and its
 * data-policy behavior (project rules #30 and #43), and make no compliance claim (AD-26).
 *
 * The unit and live suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the CHANGELOG's Story 39.3 section: its title and headings, that no count or baseline moves, the
 *    `BOOTSTRAP_VERSION` move this story made (pinned as history), the first use of `DATA_POLICY_BLOCKED`, and
 *    that it holds no roster-summary string (the roster guard reads the first match in the file);
 *  - the changeset's exact bump map (AD-29);
 *  - the root README's `DATA_POLICY_BLOCKED` and governance-defaults rows and its policy section;
 *  - the interop README's body-search subsection and policy line;
 *  - `tool_support.md`: the Story 39.3 note and the scope row;
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
const PREVIOUS_BOOTSTRAP_VERSION = "d440a659ba1e";
const STORY_BOOTSTRAP_VERSION = "f7b0868c95d0";

/** The right arrow the documents use, by code point. */
const RIGHT_ARROW = String.fromCodePoint(0x2192);

describe("Story 39.3: the CHANGELOG section and the changeset", () => {
  const section =
    sectionsOf(read("CHANGELOG.md")).find((candidate) =>
      /^## \[Pre-release[^\]]*\] . Story 39\.3: Message body content search$/.test(candidate.split("\n")[0] ?? ""),
    ) ?? "";

  it("the CHANGELOG has the Story 39.3 section, with Added, Changed and Tests headings", () => {
    expect(section, "the CHANGELOG has the Story 39.3 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual(["### Added", "### Changed", "### Tests"]);
  });

  it("names the action, its default state, the first use of DATA_POLICY_BLOCKED and the audit redaction", () => {
    const text = squash(section);
    expect(text).toContain("The `body` action of `iris_message_search` finds messages by what their bodies hold");
    expect(text).toContain("it is a read, enabled by default");
    expect(text).toContain("`DATA_POLICY_BLOCKED` is returned for the first time");
    expect(text).toContain('{code: "DATA_POLICY_BLOCKED", action: "body", policy: "block"}');
    expect(text).toContain('it as `"[REDACTED]"` under `redact` and `block`');
    expect(text).toContain("No caller text becomes SQL");
  });

  it("names the changes: the route's action text, filters refused on headers, searchTable's availableActions", () => {
    const text = squash(section);
    expect(text).toContain("`Parameter 'action' must be one of: headers, body`");
    expect(text).toContain("`filters` on the `headers` action is refused, on the tool and on the route");
    expect(text).toContain('`availableActions: ["headers","body"]`');
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
  const changesetPath = ".changeset/story-39-3-message-body-content-search.md";
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

describe("Story 39.3: the root README names the body action, its default state and the refusal", () => {
  const readme = read("README.md");

  it("the DATA_POLICY_BLOCKED row says the body action returns it under block, and that no IRIS call is made", () => {
    const row = squash(readme.split("\n").find((line) => line.startsWith("| `DATA_POLICY_BLOCKED` |")) ?? "");
    expect(row, "the refusal-code row").not.toBe("");
    expect(row).toContain("Returned from Story 39.3 on, by the `body` action of `iris_message_search` under the `block` policy");
    expect(row).toContain("a read, enabled by default");
    expect(row).toContain("No IRIS call was made.");
    expect(row).not.toContain("no tool returns it yet");
  });

  it("the NOT_IMPLEMENTED row names searchTable only, with headers and body available", () => {
    const row = squash(readme.split("\n").find((line) => line.startsWith("| `NOT_IMPLEMENTED` |")) ?? "");
    expect(row).toContain("action `searchTable`");
    expect(row).toContain("(`headers`, `body`)");
  });

  it("the governance-defaults row says body searches by body content, is refused under block, and searchTable is not implemented", () => {
    const row = squash(readme.split("\n").find((line) => line.startsWith("| interop | `iris_message_search` |")) ?? "");
    expect(row, "the governance-defaults row").not.toBe("");
    expect(row).toContain("all enabled by default");
    expect(row).toContain("`body` searches by body content and is refused under the `block` data policy");
    expect(row).toContain("`searchTable` answers `NOT_IMPLEMENTED` until Story 39.4");
  });

  it("the policy table and the IRIS_DATA_POLICY row name the body action under block and its residual under redact", () => {
    const table = squash(readme.slice(readme.indexOf("| Value | Effect |"), readme.indexOf("**Where to set it.**")));
    expect(table, "the policy value table").toContain("| `block` |");
    expect(table).toContain("The `body` action of `iris_message_search` is refused.");
    expect(table).toContain("which headers match still shows what the bodies hold");
    expect(table).toContain("restrict `iris_message_search:body` with its governance key");

    const row = squash(readme.split("\n").find((line) => line.startsWith("| `IRIS_DATA_POLICY` |")) ?? "");
    expect(row, "the IRIS_DATA_POLICY row").not.toBe("");
    expect(row).toContain("`block` withholds every body and refuses the `body` action of `iris_message_search`");
  });

  it("the aggregate package README names the body content search and its policy refusal", () => {
    const aggregate = squash(read("packages/iris-mcp-all/README.md"));
    expect(aggregate).toContain("message header and body content search (`iris_message_search`, read-only; the body action is refused under the `block` data policy)");
  });

  it("the PHI data policy section lists the body action first among what the policy governs", () => {
    const start = readme.indexOf("**What it governs today.**");
    expect(start, "the README has the 'What it governs today' paragraph").toBeGreaterThanOrEqual(0);
    const paragraph = squash(readme.slice(start, readme.indexOf("\n\n", start)));
    expect(paragraph).toContain("The `body` action of `iris_message_search` (Story 39.3)");
    expect(paragraph).toContain("refused with `DATA_POLICY_BLOCKED` and no IRIS call");
    expect(paragraph).toContain("it is a read, enabled by default");
    expect(paragraph).toContain("no tool returns HL7 body text yet");
  });
});

describe("Story 39.3: the interop README documents the body search", () => {
  const interopReadme = read("packages/iris-interop-mcp/README.md");
  const start = interopReadme.indexOf("#### `iris_message_search`");
  const next = interopReadme.indexOf("\n#### ", start + 1);
  const text = squash(interopReadme.slice(start, next === -1 ? undefined : next));

  it("has the subsection, the body option table and the filter grammar", () => {
    expect(start, "the interop README has the iris_message_search subsection").toBeGreaterThanOrEqual(0);
    expect(text).toContain("**Body search (`body`):**");
    expect(text).toContain("| `bodyClass` | **Required.** The exact name of a persistent body class");
    expect(text).toContain("| `filters` | **Required.** 1 to 10 conditions combined with AND");
    expect(text).toContain("`op` is `eq`, `ne`, `lt`, `le`, `gt`, `ge`, `contains`, `startsWith`, `isNull` or `notNull`");
    expect(text).toContain("`contains` is a case-sensitive substring test");
    expect(text).toContain("A stream property accepts only `isNull` and `notNull`");
    expect(text).toContain("never the value");
  });

  it("states the value forms and the dangling-body rule", () => {
    expect(text).toContain("Values are compared in IRIS logical form: a date property takes its day number");
    expect(text).toContain("a timestamp property takes its stored text, such as `2001-02-03 08:00:00`, not an ISO 8601 `T` form");
    expect(text).toContain("a number is sent in IRIS canonical form (`0.5` becomes `.5`), so give a text property a string");
    expect(text).toContain("A header whose body no longer exists never matches");
  });

  it("states the policy line: a read, enabled by default, refused under block, redact and allow run", () => {
    expect(text).toContain("> **Data policy:** the `body` action is under the PHI data policy");
    expect(text).toContain("is a read, **enabled by default**");
    expect(text).toContain("Under `block` it is refused with `DATA_POLICY_BLOCKED` and no IRIS call");
    expect(text).toContain("Under `redact` and `allow` it runs");
    expect(text).toContain("which headers match still shows what the bodies hold");
    expect(text).toContain('writes `filters` as `"[REDACTED]"` under `redact` and `block`');
    expect(text).toContain("it is not a compliance certification");
  });

  it("keeps the Story 39.1 governance sentence and now says searchTable is the one not-yet-available action", () => {
    expect(text).toContain("> **Governance default:** all three actions (`headers`, `body`, `searchTable`) are pure **reads**");
    expect(text).toContain("`searchTable` is declared for a later release");
  });
});

describe("Story 39.3: tool_support.md states the note, the scope row and the counts that do not move", () => {
  const toolSupport = read("tool_support.md");

  it("has the Story 39.3 note: no count, key or default moves, and the BOOTSTRAP_VERSION move", () => {
    const note = squash(toolSupport.split("\n").find((line) => line.startsWith("> **Story 39.3")) ?? "");
    expect(note, "tool_support.md has the Story 39.3 note").not.toBe("");
    expect(note).toContain("No tool, action or governance key is added, so no default state and no tool count moves");
    expect(note).toContain("`body` stays an enabled-by-default read");
    expect(note).toContain("`DATA_POLICY_BLOCKED`");
    expect(note).toContain(`\`${PREVIOUS_BOOTSTRAP_VERSION}\` ${RIGHT_ARROW} \`${STORY_BOOTSTRAP_VERSION}\``);
    expect(note).toContain("(still 31 classes)");
  });

  it("the scope table lists iris_message_search as governed, with the body action's default state", () => {
    const row = squash(toolSupport.split("\n").find((line) => line.startsWith("| `iris_message_search` | governed |")) ?? "");
    expect(row, "the governed row").not.toBe("");
    expect(row).toContain("The `body` action is under the policy");
    expect(row).toContain("`DATA_POLICY_BLOCKED` under `block`");
    expect(row).toContain("a read, enabled by default");
    expect(row).toContain("restrict `iris_message_search:headers` with its governance key");
    expect(toolSupport.split("\n").filter((line) => line.startsWith("| `iris_message_search` |"))).toHaveLength(1);
  });

  it("keeps the suite at 108 package tools and 113 advertised", () => {
    expect(toolSupport).toContain("| **Total** | **20** | **83** | **5** | **108** | **113** |");
  });
});

describe("Story 39.3: no new document text claims regulatory compliance", () => {
  const documents: Array<[string, string]> = [
    ["README.md", read("README.md")],
    ["tool_support.md", read("tool_support.md")],
    ["CHANGELOG.md (Story 39.3)", sectionsOf(read("CHANGELOG.md")).find((s) => s.includes("Story 39.3: Message body content search")) ?? ""],
    ...readdirSync(path.join(REPO_ROOT, "packages"))
      .filter((dir) => existsSync(path.join(REPO_ROOT, "packages", dir, "README.md")))
      .map((dir): [string, string] => [`packages/${dir}/README.md`, read(`packages/${dir}/README.md`)]),
    ...(existsSync(path.join(REPO_ROOT, ".changeset", "story-39-3-message-body-content-search.md"))
      ? [["the changeset", read(".changeset/story-39-3-message-body-content-search.md")] as [string, string]]
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
