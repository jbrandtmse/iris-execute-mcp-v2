/**
 * Story 41.2 QA (AC 41.2.1) - the wording of the always-on rule, read as a user's agent will read it.
 *
 * `skills-pack-rule.test.ts` scans the rule source for the internal references the spec lists (a rule number, a DW or
 * AD id, a few paths, the project class and helper) and for `iris_*` tool names. This file is the wider net for the
 * same promise - the rule names nothing of this repository, its tooling, its planning or its tools - and applies it
 * to all three committed copies of the text: the source, the `claude-code` form and the `agents-md` form (whose two
 * marker lines are the only lines allowed to name the suite).
 *
 * Each pattern is checked against sample text first, so a pattern that has stopped matching shows up as a failed
 * negative control rather than as a clean rule. IRIS's own error code `ERROR #5001` is no internal reference.
 *
 * No IRIS and no network; it reads three committed files.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALWAYS_ON_RULE_FILENAME,
  PACK_DIR,
  RULE_FORM_DIRS,
  RULES_SOURCE_DIR,
} from "../../../../scripts/lib/skills-pack.mjs";
import { FORBIDDEN, problemsOf } from "./agent-text-hygiene";
import { REPO_ROOT } from "./pack-fixture";

/** The text of a copy without the two marker lines of the `agents-md` form and the frontmatter of the `cursor` form. */
function withoutMarkerLines(text: string): string {
  return text
    .replace(/^---\nalwaysApply: true\n---\n\n/, "")
    .split("\n")
    .filter((line) => !/^<!-- IRIS-MCP-RULE:[a-z0-9-]+:(?:BEGIN|END) -->$/.test(line))
    .join("\n");
}

const COPIES: Array<[label: string, rel: string]> = [
  ["the rule source", `${RULES_SOURCE_DIR}/${ALWAYS_ON_RULE_FILENAME}`],
  ["the claude-code form", `${PACK_DIR}/${RULE_FORM_DIRS.claudeCode}/${ALWAYS_ON_RULE_FILENAME}`],
  ["the cursor form", `${PACK_DIR}/${RULE_FORM_DIRS.cursor}/${ALWAYS_ON_RULE_FILENAME.replace(/\.md$/, ".mdc")}`],
  ["the agents-md form", `${PACK_DIR}/${RULE_FORM_DIRS.agentsMd}/${ALWAYS_ON_RULE_FILENAME}`],
];

describe("the rule text names nothing of this repository (AC 41.2.1)", () => {
  it.each(COPIES)("%s has no forbidden reference", (_label, rel) => {
    const text = withoutMarkerLines(readFileSync(join(REPO_ROOT, rel), "utf8"));
    expect(text.length).toBeGreaterThan(1000);
    expect(problemsOf(text)).toEqual([]);
  });

});

describe("the forbidden-reference patterns can fail (negative controls)", () => {
  it.each(FORBIDDEN)("flags %s", (name, _pattern, sample) => {
    expect(problemsOf(sample)).toContain(name);
  });

  it("accepts the IRIS error code ERROR #5001 and plain advice", () => {
    expect(problemsOf("`$System.Status.GetErrorText(tSC)` starts with `ERROR #5001: `. Strip it first.")).toEqual([]);
    expect(problemsOf("Indent every command in a method; a command in column 1 is read as a label.")).toEqual([]);
  });

  it("does not take the ObjectScript status variable tSC for the TypeScript compiler", () => {
    expect(problemsOf("Set tSC = $$$OK")).toEqual([]);
  });

  it("the marker-line filter removes exactly the two marker lines", () => {
    const wrapped = "<!-- IRIS-MCP-RULE:x-y:BEGIN -->\nbody line\n<!-- IRIS-MCP-RULE:x-y:END -->\n";
    expect(withoutMarkerLines(wrapped)).toBe("body line\n");
    expect(withoutMarkerLines("  <!-- IRIS-MCP-RULE:x-y:BEGIN -->\n")).toContain("IRIS-MCP-RULE");
  });
});
