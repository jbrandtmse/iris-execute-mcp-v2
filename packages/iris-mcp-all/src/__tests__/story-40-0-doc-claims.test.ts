/**
 * Story 40.0 -- the documents state the Epic 39 deferred cleanup with its default state at the point of use (project
 * rules #30 and #43), the CHANGELOG and the changeset record it, and no new text claims regulatory compliance (AD-26).
 *
 * The unit and live suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the Operations README: the `iris_metrics_interop` counts sentence;
 *  - the Interoperability README: the real `iris_production_logs` entry shape and the `type` sentence, and the
 *    `trace-message-flow` prompt row; the root README's prompt row;
 *  - `tool_support.md`: the Story 40.0 note after the Story 39.7 note;
 *  - the CHANGELOG section above the Story 39.7 one, its four headings and the bootstrap move, and the changeset's
 *    bump map.
 *
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
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
const opsReadme = read("packages/iris-ops-mcp/README.md");
const toolSupport = read("tool_support.md");

const CHANGELOG_TITLE = /^## \[Pre-release \u2014 2026-10-17\] \u2014 Story 40\.0: Epic 39 deferred cleanup$/;

/** The `BOOTSTRAP_VERSION` values of the Story 40.0 move. */
const BOOTSTRAP_FROM = "7d12cd8b3a1e";
const BOOTSTRAP_TO = "08b8adeaadc6";

/** The `BOOTSTRAP_VERSION` the committed embed carries: the documents below must name it. */
const EMBED_VERSION = /export const BOOTSTRAP_VERSION = "([0-9a-f]{12})"/.exec(read("packages/shared/src/bootstrap-classes.ts"))?.[1] ?? "";

/** The prompt-row sentence both READMEs gain, after "for any erroring items". */
const PROMPT_ROW_ADDITION =
  "for any erroring items (under `block`, the reason for withheld diagram error text and Event Log text is reported the same way, never read another way).";

describe("Story 40.0: the Operations README (DW-584)", () => {
  it("states what errorCount24h and messageCount24h count, in UTC, as a read enabled by default, after the iris_metrics_interop example", () => {
    const text = squash(opsReadme);
    const sentence =
      "`errorCount24h` counts Event Log entries of type Error and `messageCount24h` counts message headers, each over the 24 hours before the call, measured in UTC (a read, enabled by default).";
    expect(text).toContain(sentence);
    expect(text.indexOf("<strong>iris_metrics_interop</strong>"), "the sentence follows the iris_metrics_interop example").toBeLessThan(text.indexOf(sentence));
    expect(text.indexOf(sentence), "and precedes the next tool").toBeLessThan(text.indexOf("<strong>iris_alerts_manage</strong>"));
  });
});

describe("Story 40.0: the Interoperability README and the root README (DW-585, DW-587)", () => {
  it("the iris_production_logs example shows the real entry shape, and the type sentence states the default state", () => {
    const text = squash(interopReadme);
    expect(text).toContain(
      '{ "id": 8, "timestamp": "2026-04-07 10:30:00.123", "type": 2, "itemName": "MyApp.Operation.SendEmail", "text": "SMTP connection timeout" }',
    );
    expect(text).not.toContain('"message": "SMTP connection timeout"');
    expect(text).toContain("`type` takes a display name, so `Error` returns the entries whose `type` is 2 (a read, enabled by default).");
  });

  it("the trace-message-flow prompt row keeps its phrases and adds the block sentence, in both READMEs", () => {
    for (const [name, text, prefix] of [
      ["the Interoperability README", interopReadme, "| `trace-message-flow` |"],
      ["the root README", rootReadme, "| `@iris-mcp/interop` | `trace-message-flow` |"],
    ] as const) {
      const row = lineStarting(text, prefix);
      expect(row, `${name} has the trace-message-flow row`).not.toBe("");
      expect(row, name).toContain(PROMPT_ROW_ADDITION);
      expect(row, name).toContain("`iris_message_search` (`headers`, in a window of at most 7 days) for the header rows");
      expect(row, name).toContain("a withheld body's reason is reported, never read another way");
      expect(row, name).toContain("Its name, title and arguments are unchanged");
      expect(row, name).toContain("each is a read that is enabled by default");
    }
  });
});

describe("Story 40.0: tool_support.md", () => {
  it("has the Story 40.0 note after the Story 39.7 note: no tool, key or count change, the bootstrap move, the four ledger entries and the default states", () => {
    const note = lineStarting(toolSupport, "> **Story 40.0");
    expect(note, "tool_support.md has the Story 40.0 note").not.toBe("");
    expect(note).toContain("> **Story 40.0 (2026-10-17) \u2014 Epic 39 deferred cleanup:**");
    expect(note).toContain("no tool, action or governance key is added, so no default state and no tool count moves (109 package tools, 114 advertised; 13 prompts");
    expect(note).toContain("the frozen baseline stays `1e62c5ad5bf7`, 141 keys");
    expect(note).toContain(`\`BOOTSTRAP_VERSION\` moves \`${BOOTSTRAP_FROM}\` ${ARROW} \`${BOOTSTRAP_TO}\``);
    expect(note).toContain("(1) DW-584:");
    expect(note).toContain("(orchestrator decision OD-1)");
    expect(note).toContain("(2) DW-585:");
    expect(note).toContain("(3) DW-586 is closed with evidence and no code change");
    expect(note).toContain("(4) DW-587:");
    expect(note.match(/\*\*read, enabled by default\*\*/g)?.length, "both fixed reads state their default state").toBe(2);
    expect(toolSupport.indexOf("> **Story 39.7"), "after the Story 39.7 note").toBeLessThan(toolSupport.indexOf("> **Story 40.0"));
  });
});

describe("Story 40.0: the CHANGELOG section and the changeset", () => {
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";

  it("has the Story 40.0 section above the Story 39.7 one, with Changed, Fixed, Documentation and Tests headings", () => {
    expect(section, "the CHANGELOG has the Story 40.0 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual([
      "### Changed",
      "### Fixed",
      "### Documentation",
      "### Tests",
    ]);
    const index = sections.indexOf(section);
    const previous = sections.findIndex((candidate) => (candidate.split("\n")[0] ?? "").includes("Story 39.7:"));
    expect(previous, "the CHANGELOG still has the Story 39.7 section").toBeGreaterThanOrEqual(0);
    expect(index, "newest section first").toBeLessThan(previous);
  });

  it("states that no tool, key, preset row or count moves, and the bootstrap move as literals", () => {
    const text = squash(section);
    expect(text).toContain("No tool, action, governance key, preset row, annotation, input schema or environment variable is added");
    expect(text).toContain("the suite stays at 109 package tools (114 advertised)");
    expect(text).toContain("the prompt pack stays at 13 prompts");
    expect(text).toContain("the Interoperability `core` roster stays at 12 runtime tools");
    expect(text).toContain("the Operations `core` roster stays at 10");
    expect(text).toContain("hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
    expect(EMBED_VERSION, "the committed embed carries the version these documents name").toBe(BOOTSTRAP_TO);
  });

  it("Changed names the prompt change as sanctioned, and Fixed names DW-584 with OD-1, DW-585 and the DW-586 closure, each read enabled by default", () => {
    const text = squash(section);
    expect(text).toContain("**The `trace-message-flow` prompt reports the reason for withheld text under `block` (DW-587).**");
    expect(text).toContain("Sanctioned change (AD-15, orchestrator decision #36).");
    expect(text).toContain("**`iris_metrics_interop` counts Error entries over the last 24 hours in UTC (DW-584).**");
    expect(text).toContain("By orchestrator decision OD-1, `messageCount24h` uses the same cutoff");
    expect(text).toContain("**The `type` filter of `iris_production_logs` maps a display name to its stored number (DW-585).**");
    expect(text).toContain("so an older request (`type=2`) still returns the same entries (AD-33)");
    expect(text).toContain("**DW-586 is closed with evidence and no code change.**");
    expect(text.match(/It is a read, enabled by default\./g)?.length, "both fixed reads state their default state").toBe(2);
  });

  it("Tests names the gate, the OS test class and this file", () => {
    const text = squash(section);
    expect(text).toContain("**`story-40-0-burn-down-live-gate.test.ts`**");
    expect(text).toContain("**`ExecuteMCPv2.Tests.EventLogMetricsTest`**");
    expect(text).toContain("**`story-40-0-doc-claims.test.ts`**");
    expect(text).toContain("`extraDriven`");
    expect(text).toContain("`eventLogOracle` moves from the 39.7 gate to `header-row-oracle.ts`.");
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
  const changesetPath = ".changeset/story-40-0-epic-39-deferred-cleanup.md";

  it("the changeset bumps shared and interop by patch, and nothing else", () => {
    if (!existsSync(path.join(REPO_ROOT, changesetPath))) return;
    const text = read(changesetPath);
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    expect(front.split("\n")).toEqual(['"@iris-mcp/shared": patch', '"@iris-mcp/interop": patch']);
    expect(squash(text)).toContain(`\`BOOTSTRAP_VERSION\` moves \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
  });
});

describe("Story 40.0: no new document text claims regulatory compliance", () => {
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";
  const changesetPath = ".changeset/story-40-0-epic-39-deferred-cleanup.md";

  const documents: Array<[string, string]> = [
    ["README.md", rootReadme],
    ["tool_support.md", toolSupport],
    ["CHANGELOG.md (Story 40.0)", section],
    ["skills/trace-message-flow/SKILL.md", read("skills/trace-message-flow/SKILL.md")],
    ...readdirSync(path.join(REPO_ROOT, "packages"))
      .filter((dir) => existsSync(path.join(REPO_ROOT, "packages", dir, "README.md")))
      .map((dir): [string, string] => [`packages/${dir}/README.md`, read(`packages/${dir}/README.md`)]),
    ...(existsSync(path.join(REPO_ROOT, changesetPath)) ? [["the changeset", read(changesetPath)] as [string, string]] : []),
  ];

  for (const [name, text] of documents) {
    it(`${name} makes no compliance claim`, () => {
      for (const claim of CLAIMS) expect(text.match(claim)?.[0], `${name} matches ${String(claim)}`).toBeUndefined();
    });
  }

  it("the scan reads the documents (an empty list would pass everything above)", () => {
    expect(documents.length).toBeGreaterThanOrEqual(8);
    expect(section, "the CHANGELOG section is found").not.toBe("");
  });
});
