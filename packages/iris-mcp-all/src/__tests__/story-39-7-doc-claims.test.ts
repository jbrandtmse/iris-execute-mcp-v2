/**
 * Story 39.7 -- the documents state the five burn-down fixes with their default state at the point of use (project rules
 * #30 and #43), the CHANGELOG and the changeset record them, and no new text claims regulatory compliance (AD-26).
 *
 * The unit and live suites pin the behavior; none reads a document. This file asserts, for each row of the story's
 * Docs table (D1 to D11):
 *
 *  - the root README: the logs and diagram sentence (D1), the window bullet (D2), the "What it governs today"
 *    paragraph (D3), the audit paragraph (D4) and the `IRIS_DATA_POLICY` row;
 *  - the Interoperability README: the `limit` row (D2), the audit paragraph (D4), the PHI data policy section (D5), the
 *    renderer table and the `maxChars` row (D6);
 *  - `tool_support.md`: the two scope rows, the closing sentences and the Story 39.7 note (D7);
 *  - the three client guides' `IRIS_DATA_POLICY` row (D8);
 *  - the descriptions of `iris_message_body` and `iris_message_search` in their sources (D9, D10);
 *  - the CHANGELOG section, its four headings, the four re-pinned snapshot entries and the bootstrap move, and the
 *    changeset's bump map (D11).
 *
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIMS, REDACTED_TEXT_SHOWN } from "./doc-claims-patterns.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const squash = (text: string): string => text.replace(/\s+/g, " ");

/** The right arrow the documents use between two versions, by code point. */
const ARROW = "\u2192";

/** The first line of `text` that starts with `prefix`, whitespace squashed ("" when there is none). */
function lineStarting(text: string, prefix: string): string {
  return squash(text.split("\n").find((line) => line.startsWith(prefix)) ?? "");
}

/** The sections of a CHANGELOG, each starting at its `## [` heading. */
function sectionsOf(changelog: string): string[] {
  return changelog.split(/^(?=## \[)/m).slice(1);
}

const rootReadme = read("README.md");
const interopReadme = read("packages/iris-interop-mcp/README.md");
const toolSupport = read("tool_support.md");

const CHANGELOG_TITLE = /^## \[Pre-release \u2014 2026-10-17\] \u2014 Story 39\.7: Epic 39 burn-down$/;

/** The `BOOTSTRAP_VERSION` the committed embed carries: what the CHANGELOG must name as the new value. */
const BOOTSTRAP_VERSION = /export const BOOTSTRAP_VERSION = "([0-9a-f]{12})"/.exec(read("packages/shared/src/bootstrap-classes.ts"))?.[1] ?? "";

describe("Story 39.7: the CHANGELOG section and the changeset (D11)", () => {
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";

  it("has the Story 39.7 section above the Story 39.6 one, with Changed, Fixed, Documentation and Tests headings", () => {
    expect(section, "the CHANGELOG has the Story 39.7 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual([
      "### Changed",
      "### Fixed",
      "### Documentation",
      "### Tests",
    ]);
    const index = sections.indexOf(section);
    const previous = sections.findIndex((candidate) => (candidate.split("\n")[0] ?? "").includes("Story 39.6:"));
    expect(previous, "the CHANGELOG still has the Story 39.6 section").toBeGreaterThanOrEqual(0);
    expect(index, "newest section first").toBeLessThan(previous);
  });

  it("states that no tool, key, preset row or count moves, and the bootstrap move to the committed embed's version", () => {
    const text = squash(section);
    expect(text).toContain("No tool, action, governance key, preset row, annotation, input schema or environment variable is added");
    expect(text).toContain("the suite stays at 109 package tools (114 advertised)");
    expect(text).toContain("the prompt pack stays at 13 prompts");
    expect(text).toContain("the Interoperability `core` roster stays at 12 runtime tools");
    expect(text).toContain("hash `1e62c5ad5bf7` (141 keys)");
    expect(BOOTSTRAP_VERSION, "the committed embed names its version").toMatch(/^[0-9a-f]{12}$/);
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`2fd17b50a024\` to \`${BOOTSTRAP_VERSION}\``);
  });

  it("Changed names the sanctioned changes of DW-569, DW-576, DW-583 and DW-572, with the default state of the two tools", () => {
    const text = squash(section);
    expect(text).toContain("**Every non-2xx answer from IRIS is an error (DW-569).**");
    expect(text).toContain("`iris_doc_search` with an empty `query`, or with an empty `files` list (`files: \"\"`; an omitted `files` still sends the documented default), was `{matches: []}` and is now an error naming HTTP 400");
    expect(text).toContain("was an empty result in `iris_doc_list`, `iris_package_list` and `iris_doc_export` and is now an error naming HTTP 400");
    expect(text).toContain("`iris_rest_manage` `get` of a spec-first application whose specification IRIS cannot read");
    expect(text).toContain("Under every policy the audit entry of a call to either tool now records `dataPolicy`");
    expect(text).toContain("`iris_macro_info` with no `document` keeps its documented empty result");
    expect(text).toContain("`iris_doc_get`, `iris_doc_put`, `iris_doc_edit` (its read) and `iris_doc_load` read that answer through the new shared `atelierDocRequest`");
    expect(text).toContain("`iris_doc_export`, `iris_doc_convert` and `iris_routine_intermediate` with a document name Atelier refuses, and `iris_macro_info` with a non-empty `document` that Atelier refuses");
    expect(text).toContain("each keeps reporting IRIS's reason (`ERROR #16006: Document '...' name is invalid`) exactly as before");
    expect(text).toContain("**`iris_production_logs` and `iris_message_diagram` withhold message-derived text under `block` (DW-576).** Both are reads, enabled by default.");
    expect(text).toContain("Under `redact` and `allow` both tools are byte-identical to before, with no `dataPolicy` key.");
    expect(text).toContain("**`iris_message_body` shows the text of a character stream under `allow` (DW-583).**");
    expect(text).toContain("**The header reads of `iris_message_search` carry an index hint (DW-572).**");
    expect(text).toContain("It changes the plan only: the rows and their order are unchanged.");
  });

  it("names the four re-pinned snapshot entries", () => {
    const text = squash(section);
    expect(text).toContain("**The `tools/list` snapshot re-pins four entries.**");
    for (const tool of ["iris_production_logs", "iris_message_diagram", "iris_message_body", "iris_message_search"]) {
      expect(text, tool).toContain(`\`${tool}\``);
    }
    expect(text).toContain("`pnpm gen:tools-list-snapshot --force`");
  });

  it("Fixed names DW-571, and Tests names the gate, this file and the unit pins", () => {
    const text = squash(section);
    expect(text).toContain("**DW-571:**");
    expect(text).toContain("**`story-39-7-burn-down-live-gate.test.ts`**");
    expect(text).toContain("**`story-39-7-doc-claims.test.ts`**");
    expect(text).toContain("**`story-39-7-qa-process.test.ts`**");
    expect(text).toContain("`logs-diagram-policy.test.ts`");
    expect(text).toContain("`MessageBodyTest.TestPropertyDumpStreams`");
  });

  it("the section carries no roster-summary string, which docs-visibility-roster-sync reads from the first match in the file", () => {
    expect(section).not.toMatch(/(?:full|core|developer)\s*`?\s*\d+\/\d+\/\d+\/\d+\/\d+/);
  });

  it("the section quotes no other section's title", () => {
    const titles = sections
      .filter((candidate) => candidate !== section)
      .map((candidate) => (candidate.split("\n")[0] ?? "").replace(/^## \[[^\]]*\]\s*\u2014\s*/, ""))
      .filter((title) => title.length > 0);
    expect(titles.length, "the CHANGELOG has other sections").toBeGreaterThan(10);
    for (const title of titles) expect(section.includes(title), `the section quotes "${title}"`).toBe(false);
  });

  // `changeset version` consumes (deletes) the file and moves its text into the generated package
  // changelogs, so the bumps are checked while the file exists.
  const changesetPath = ".changeset/story-39-7-epic-39-burn-down.md";
  const changesetPresent = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!changesetPresent)("the changeset bumps exactly shared minor, dev patch and interop minor (AD-29) and says what the story does", () => {
    const changeset = read(changesetPath);
    const frontMatter = /^---\n([\s\S]*?)\n---/.exec(changeset)?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontMatter
        .split("\n")
        .map((line) => /^"([^"]+)":\s*(\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1], match[2]]),
    );
    expect(bumps).toEqual({ "@iris-mcp/shared": "minor", "@iris-mcp/dev": "patch", "@iris-mcp/interop": "minor" });
    expect(frontMatter.split("\n").filter((line) => line.trim() !== "")).toHaveLength(3);
    const text = squash(changeset);
    expect(text).toContain("Every non-2xx response from IRIS is now an `IrisApiError`");
    expect(text).toContain("both reads that are enabled by default");
    expect(text).toContain("No tool, action, governance key or default is added");
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves \`2fd17b50a024\` to \`${BOOTSTRAP_VERSION}\``);
  });
});

describe("Story 39.7: the root README (D1, D2, D3, D4)", () => {
  it("D1: logs and diagram are under the policy only under block, as reads enabled by default, and sit outside it otherwise", () => {
    const text = squash(rootReadme);
    expect(text).toContain(
      "`iris_message_diagram` and `iris_production_logs` (both reads, enabled by default) are under the data policy only under `block`, which withholds the error text in a diagram and each Event Log entry's text, with a reason; under `redact` and `allow` they sit outside the policy and show that text unchanged",
    );
    expect(text).not.toContain("`iris_message_diagram` and `iris_production_logs` sit outside the data policy:");
  });

  it("D2: the window bullet says a filter narrows the rows returned, not the window scanned", () => {
    const bullet = lineStarting(rootReadme, "- **The window.**");
    expect(bullet).toContain("Narrow the window: a filter narrows the rows returned, not the window scanned.");
    expect(bullet).not.toContain("add filters");
  });

  it("D3: the 'What it governs today' paragraph states logs and diagram under block, and character-stream text under allow", () => {
    const paragraph = lineStarting(rootReadme, "**What it governs today.**");
    expect(paragraph, "the paragraph keeps its start").toContain("**What it governs today.** The `iris_message_body` tool (Story 39.5)");
    expect(paragraph).toContain(
      "Since Story 39.7 the policy also governs `iris_production_logs` and `iris_message_diagram`, under `block` only: they withhold each Event Log entry's text and the text of a diagram's error warnings with a fixed reason, and under `redact` and `allow` they show that text unchanged (both are reads, enabled by default).",
    );
    expect(paragraph).toContain("Under `allow`, `iris_message_body` also shows the text of a character-stream property of a persistent body");
    expect(paragraph).toContain("a binary stream stays its class and size");
    expect(paragraph).not.toContain("tools such as `iris_sql_execute`, `iris_global_get`, `iris_production_logs` and `iris_message_diagram`");
  });

  it("D4: the audit paragraph lists the two tools, governed under block", () => {
    const audit = squash(rootReadme);
    expect(audit).toContain(
      "`iris_production_logs` and `iris_message_diagram`, which are governed under `block`) also carries `dataPolicy`",
    );
  });

  it("the IRIS_DATA_POLICY row says block also withholds Event Log text and diagram error text", () => {
    const row = lineStarting(rootReadme, "| `IRIS_DATA_POLICY` |");
    expect(row).toContain("`block` withholds every body and refuses the `body` and `searchTable` actions of `iris_message_search`, and withholds the Event Log text of `iris_production_logs` and the error text of `iris_message_diagram` (every one of these is a read, enabled by default)");
  });
});

describe("Story 39.7: the Interoperability README (D2, D4, D5, D6)", () => {
  it("D2: the limit row says a filter narrows the rows returned, not the window scanned", () => {
    const row = lineStarting(interopReadme, "| `limit` | `100` |");
    expect(row).toContain("narrow the window: a filter narrows the rows returned, not the window scanned");
    expect(row).not.toContain("add filters");
  });

  it("D4: the audit paragraph keeps its earlier list and adds the two tools, governed under block", () => {
    const paragraph = lineStarting(interopReadme, "A call to a tool under the PHI data policy");
    expect(paragraph).toContain("and the `preview` action of `iris_message_resend`) also records `dataPolicy`");
    expect(paragraph).toContain(
      "So does a call to `iris_production_logs` or `iris_message_diagram`, which are governed under `block`: the entry holds the number of Event Log entries or error warnings withheld under `block`, and 0 counts under `redact` and `allow`.",
    );
  });

  it("D5: the PHI data policy section states logs and diagram under block, as reads enabled by default", () => {
    const section = squash(interopReadme);
    expect(section).toContain(
      "`iris_message_diagram` and `iris_production_logs`, both in this server's `core` preset and both reads, enabled by default, are under it only under `block`",
    );
    expect(section).toContain("under `redact` and `allow` they show that text unchanged");
    expect(section).not.toContain("So are `iris_message_diagram` and `iris_production_logs`");
  });

  it("the iris_message_diagram section states its block form next to its default state", () => {
    const note = lineStarting(interopReadme, "> **PHI data policy:** under `block`, each error warning keeps its `Error on message <id>: ` prefix");
    expect(note, "the note follows the section's governance default").not.toBe("");
    expect(note).toContain("Under `redact` (the default) and `allow` the diagram is shown unchanged.");
  });

  it("D6: the renderer table and the maxChars row state the character-stream rule", () => {
    const text = squash(interopReadme);
    expect(text).toContain("a character stream shows its text and a binary stream its class and size; a list or array is its count");
    expect(text).toContain("An XML body is serialized whole before it is cut, and so is a JSON export, but a character stream in a property dump is read only up to the read limit");
    expect(text).not.toContain("a stream is its class and size, never its content");
  });

  it("the IRIS_DATA_POLICY row says block also withholds Event Log text and diagram error text", () => {
    const row = lineStarting(interopReadme, "| `IRIS_DATA_POLICY` |");
    expect(row).toContain("`block` withholds every body and refuses the `body` and `searchTable` actions, and withholds the Event Log text of `iris_production_logs` and the error text of `iris_message_diagram`. Every one of these is a read, enabled by default.");
  });
});

describe("Story 39.7: tool_support.md (D7)", () => {
  const rows = (name: string): string => lineStarting(toolSupport, `| \`${name}\` |`);

  it("the two scope rows are governed under block only, with the default state", () => {
    for (const name of ["iris_production_logs", "iris_message_diagram"]) {
      const row = rows(name);
      expect(row, `${name} has a scope row`).not.toBe("");
      expect(row, name).toMatch(new RegExp(`^\\| \`${name}\` \\| governed \\|`));
      expect(row, name).toContain("Governed under `block` only (since 2026-10-17)");
      expect(row, name).toContain("Under `redact` and `allow`");
      expect(row, name).toContain("Default state: a read, enabled by default.");
    }
  });

  it("the closing sentences name the two tools and the dedup residual", () => {
    const text = squash(toolSupport);
    expect(text).toContain("reachable only through `iris_message_diagram` (its error warnings, withheld under `block`) and the residual tools above");
    expect(text).toContain("Since Story 39.7 the policy also withholds, under `block` only, the Event Log text of `iris_production_logs` and the error-warning text of `iris_message_diagram`");
    expect(text).toContain("two sessions that differ only in their error text are not marked as duplicates, which tells a caller one bit about the withheld text");
  });

  it("has the Story 39.7 note after the Story 39.6 note: five fixes, no tool, key or count change, and the bootstrap move", () => {
    const note = lineStarting(toolSupport, "> **Story 39.7");
    expect(note, "tool_support.md has the Story 39.7 note").not.toBe("");
    expect(note).toContain("five fixes, and no tool, action or governance key is added, so no default state and no tool count moves (109 package tools, 114 advertised");
    expect(note).toContain("the frozen baseline stays `1e62c5ad5bf7`, 141 keys");
    expect(note).toContain(`\`BOOTSTRAP_VERSION\` moves \`2fd17b50a024\` ${ARROW} \`${BOOTSTRAP_VERSION}\``);
    expect(note).toContain("Both are **reads, enabled by default**");
    expect(toolSupport.indexOf("> **Story 39.6"), "after the Story 39.6 note").toBeLessThan(toolSupport.indexOf("> **Story 39.7"));
  });
});

describe("Story 39.7: the client guides and the source descriptions (D8, D9, D10)", () => {
  for (const guide of ["claude-code", "claude-desktop", "cursor"]) {
    it(`D8: the ${guide} guide's IRIS_DATA_POLICY row says block also withholds Event Log text and diagram error text`, () => {
      const row = lineStarting(read(`docs/client-config/${guide}.md`), "| `IRIS_DATA_POLICY` |");
      expect(row).toContain("and also withholds the Event Log text of `iris_production_logs` and the error text of `iris_message_diagram` (both reads, enabled by default)");
    });
  }

  /** A tool source with its string-literal joints removed, so a description split over lines reads as one text. */
  const joined = (relative: string): string => squash(read(relative)).replace(/"\s*\+\s*"/g, "");

  it("D9: the iris_message_body description states the character-stream rule and the read limit", () => {
    const source = joined("packages/iris-interop-mcp/src/tools/message-body.ts");
    expect(source).toContain("a character stream shows its text and a binary stream its class and size");
    expect(source).toContain("a character stream in a property dump is read only up to the read limit");
    expect(source).not.toContain("where a stream is its class and size only");
  });

  it("D10: the iris_message_search description says a filter narrows the rows returned, not the window scanned", () => {
    const source = joined("packages/iris-interop-mcp/src/tools/message-search.ts");
    expect(source).toContain("so narrow the window: a filter narrows the rows returned, not the window scanned.");
    expect(source).not.toContain("narrow the window or add filters");
  });
});

describe("Story 39.7: no new document text claims regulatory compliance or says a preview shows redacted HL7 text", () => {
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";
  const changesetPath = ".changeset/story-39-7-epic-39-burn-down.md";

  const documents: Array<[string, string]> = [
    ["README.md", rootReadme],
    ["tool_support.md", toolSupport],
    ["CHANGELOG.md (Story 39.7)", section],
    ...["claude-code", "claude-desktop", "cursor"].map((guide): [string, string] => [`docs/client-config/${guide}.md`, read(`docs/client-config/${guide}.md`)]),
    ...readdirSync(path.join(REPO_ROOT, "packages"))
      .filter((dir) => existsSync(path.join(REPO_ROOT, "packages", dir, "README.md")))
      .map((dir): [string, string] => [`packages/${dir}/README.md`, read(`packages/${dir}/README.md`)]),
    ...(existsSync(path.join(REPO_ROOT, changesetPath)) ? [["the changeset", read(changesetPath)] as [string, string]] : []),
  ];

  for (const [name, text] of documents) {
    it(`${name} makes no compliance claim`, () => {
      for (const claim of CLAIMS) expect(text.match(claim)?.[0], `${name} matches ${String(claim)}`).toBeUndefined();
    });

    it(`${name} does not say a preview or reader shows redacted HL7 text`, () => {
      for (const pattern of REDACTED_TEXT_SHOWN) expect(text.match(pattern)?.[0], `${name} matches ${String(pattern)}`).toBeUndefined();
    });
  }

  it("the scan reads the documents (an empty list would pass everything above)", () => {
    expect(documents.length).toBeGreaterThanOrEqual(10);
    expect(section, "the CHANGELOG section is found").not.toBe("");
  });
});
