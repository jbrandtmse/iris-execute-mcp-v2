/**
 * Story 40.5 -- the documents state what the burn-down changed where it is used (project rules #30 and #43): the three prompt
 * rows of the READMEs, the `clearedAt` sentence of the Operations README, the CHANGELOG section and the changeset; and no new
 * text claims regulatory compliance.
 *
 * The unit, OS and live suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the root README: the `edit-and-test-class` and `recover-stuck-production` rows;
 *  - the Development README: the `deploy-and-test-class` and `edit-and-test-class` rows;
 *  - the Interoperability README: the `recover-stuck-production` row;
 *  - the Operations README: the sentence after the `iris_alerts_manage` reset output;
 *  - the CHANGELOG section above the Story 40.4 one, and the changeset's bump map;
 *  - that the three regenerated skills and the new texts claim no compliance.
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

/** The em dash the documents use in headings and notes, by code point. */
const EM_DASH = "\u{2014}";

/** The first line of `text` that starts with `prefix`, whitespace squashed ("" when there is none). */
function lineStarting(text: string, prefix: string): string {
  return squash(text.split("\n").find((line) => line.startsWith(prefix)) ?? "");
}

/** The sections of a CHANGELOG, each starting at its `## [` heading. */
function sectionsOf(changelog: string): string[] {
  return changelog.split(/^(?=## \[)/m).slice(1);
}

const rootReadme = read("README.md");
const devReadme = read("packages/iris-dev-mcp/README.md");
const interopReadme = read("packages/iris-interop-mcp/README.md");
const opsReadme = read("packages/iris-ops-mcp/README.md");

const CHANGELOG_TITLE = new RegExp(`^## \\[Pre-release ${EM_DASH} 2026-10-19\\] ${EM_DASH} Story 40\\.5: Epic 40 burn-down$`);

/**
 * The `BOOTSTRAP_VERSION` values of the Story 40.5 move, as history literals: `changelog-bootstrap-move.test.ts` ties the newest
 * documented move to the committed embed, so a later move leaves this file true.
 */
const BOOTSTRAP_FROM = "5024e4623f1d";
const BOOTSTRAP_TO = "5296a1c836f4";

/** The clause the two test prompts' rows add, and the clause the recover rows add. */
const BUSY_CLAUSE =
  "It tells the model what a `PRODUCTION_BUSY` refusal means (a production other than the tests' own is running, or the production state could not be read)";
const BLOCK_CLAUSE = "Under the `block` data policy it reports the reason for withheld Event Log text and never reads that text another way.";

describe("Story 40.5: the READMEs state the prompt changes on the prompt rows", () => {
  it("the root README edit row ends with the PRODUCTION_BUSY clause and the no-stop rule", () => {
    const row = lineStarting(rootReadme, "| `@iris-mcp/dev` | `edit-and-test-class`");
    expect(row).toContain("`iris_doc_edit:apply` is enabled by default.");
    expect(row).toContain(`${BUSY_CLAUSE} and not to stop a production without the user's confirmation. |`);
  });

  it("the Development README edit row ends with the same clause", () => {
    const row = lineStarting(devReadme, "| `edit-and-test-class`");
    expect(row).toContain("every tool on its main path is in the `core` preset.");
    expect(row).toContain(`${BUSY_CLAUSE} and not to stop a production without the user's confirmation. |`);
  });

  it("the Development README deploy row names both causes of a PRODUCTION_BUSY refusal and keeps its coverage clause", () => {
    const row = lineStarting(devReadme, "| `deploy-and-test-class`");
    expect(row).toContain(`${BUSY_CLAUSE}, and, only when the user asks for coverage, adds an optional last step that runs \`iris_test_coverage\``);
    expect(row).toContain("a hidden tool (outside `core`), a `GOVERNANCE_DISABLED` or `MONITOR_BUSY` refusal and a `running` result (Story 40.4)");
  });

  it("the recover rows of the root and Interoperability READMEs end with the block rule", () => {
    for (const [name, row] of [
      ["README.md", lineStarting(rootReadme, "| `@iris-mcp/interop` | `recover-stuck-production`")],
      ["packages/iris-interop-mcp/README.md", lineStarting(interopReadme, "| `recover-stuck-production`")],
    ] as const) {
      expect(row, `${name} has the row`).not.toBe("");
      expect(row, name).toContain("never suggests `killAppData` without the user's explicit acceptance of persistent business-state loss. ");
      expect(row, name).toContain(`${BLOCK_CLAUSE} |`);
    }
  });

  it("the Operations README says clearedAt is the time of the reset in UTC, after the reset output", () => {
    const output = opsReadme.indexOf('"clearedAt": "2026-04-22T10:50:00Z"');
    const sentence = opsReadme.indexOf("`clearedAt` is the time of the reset in UTC (ISO 8601, to the second).");
    expect(output, "the reset output block exists").toBeGreaterThan(-1);
    expect(sentence, "the sentence exists").toBeGreaterThan(output);
    expect(sentence - output, "the sentence follows the output block directly").toBeLessThan(60);
  });
});

describe("Story 40.5: the CHANGELOG section and the changeset", () => {
  const changelog = read("CHANGELOG.md");
  const sections = sectionsOf(changelog);
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";

  it("has the Story 40.5 section above the Story 40.4 one, with Changed, Fixed and Tests headings", () => {
    expect(section, "the CHANGELOG has the Story 40.5 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual(["### Changed", "### Fixed", "### Tests"]);
    const index = sections.indexOf(section);
    const previous = sections.findIndex((candidate) => (candidate.split("\n")[0] ?? "").includes("Story 40.4:"));
    expect(previous, "the CHANGELOG still has the Story 40.4 section").toBeGreaterThanOrEqual(0);
    expect(index, "newest section first").toBeLessThan(previous);
  });

  it("states the unchanged counts and the bootstrap move as literals", () => {
    const text = squash(section);
    expect(text).toContain("no count moves (the Development server stays at 32 package tools, 33 advertised; the suite at 110 package tools, 115 advertised)");
    expect(text).toContain("The prompt pack stays at 13 prompts (5 on the Development server), the `core` preset at 14 package tools (15 runtime tools), the `developer` preset at 32 package tools (33 advertised), the refusal-code catalog at 10 codes");
    expect(text).toContain("hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
    expect(text).toContain("`REST/Monitor.cls`, `REST/UnitTest.cls` and `REST/Coverage.cls` changed (the bootstrapped service stays at 35 classes)");
  });

  it("Changed records the three prompt changes with their decisions and as sanctioned AD-15 changes, and what stays unchanged", () => {
    const text = squash(section);
    expect(text).toContain("(DW-590; orchestrator decision #65, a sanctioned AD-15 change)");
    expect(text).toContain("(DW-609; orchestrator decision #66, a sanctioned AD-15 change)");
    expect(text).toContain("(DW-610; orchestrator decision #67, a sanctioned AD-15 change)");
    expect(text).toContain("under the `block` data policy each entry's `text` is withheld and its `textPolicy` gives the reason");
    expect(text).toContain("The prompt keeps its 8 steps.");
    expect(text).toContain("The prompt keeps its 12 steps");
    expect(text).toContain("The prompt keeps its 9 steps.");
    expect(text).toContain("The names, titles, arguments and descriptions of the three prompts are unchanged, and the three generated skills are regenerated");
  });

  it("Fixed records DW-589, DW-597 and DW-591 with what stays unchanged", () => {
    const text = squash(section);
    expect(text).toContain("`iris_alerts_manage` `reset` stamps `clearedAt` in UTC (DW-589).");
    expect(text).toContain("in the same format (`YYYY-MM-DDThh:mm:ssZ`, to the second, a fraction truncated)");
    expect(text).toContain("A process at time zone 0 got the same value before");
    expect(text).toContain("`POST /tests` at the package level runs the package's test classes (DW-597).");
    expect(text).toContain("It is now `:A;B;C`.");
    expect(text).toContain("No tool calls the route (orchestrator decision #40), and `iris_test_coverage` package runs are unchanged");
    expect(text).toContain("The class level, the method level and the response keys are unchanged (AD-33).");
    expect(text).toContain("`pnpm gen:bootstrap` writes the embed only when its content changes (DW-591).");
    expect(text).toContain("the hash and the content are unchanged");
  });

  it("Tests records DW-603, DW-607, the Story 40.5 gate and the IRIS version", () => {
    const text = squash(section);
    expect(text).toContain("One monitor helper module for the live gates (DW-603).");
    expect(text).toContain("`gate-helper-copies.test.ts` fails, naming the gate and the name, when a gate declares one of the moved names again.");
    expect(text).toContain("The class-name check is compared with the compiler (DW-607).");
    expect(text).toContain("`$System.OBJ.IsValidClassname`");
    expect(text).toContain("The Story 40.5 gate (`story-40-5-burn-down-live-gate.test.ts`).");
    expect(text).toContain("It starts no Line-by-Line session and no production.");
    expect(text).toContain("Earliest IRIS version verified for `$System.OBJ.IsValidClassname` and the truncation of `$ZTimeStamp`: 2026.2 build 221U.");
  });

  it("holds no roster-summary string and quotes no other section's title", () => {
    const text = squash(section);
    expect(text).not.toMatch(/`(?:full|core|developer)` \d+\/\d+\/\d+\/\d+\/\d+/);
    for (const other of sections) {
      const title = (other.split("\n")[0] ?? "").trim();
      if (CHANGELOG_TITLE.test(title)) continue;
      expect(text, `the section quotes the title "${title}"`).not.toContain(title);
    }
  });

  it("the changeset bumps @iris-mcp/shared, dev and interop by a patch and records the bootstrap move", () => {
    const dir = path.join(REPO_ROOT, ".changeset");
    expect(existsSync(dir)).toBe(true);
    const file = readdirSync(dir).find((name) => name === "story-40-5-epic-40-burn-down.md");
    expect(file, "the changeset exists").toBeDefined();
    const text = readFileSync(path.join(dir, file as string), "utf8");
    expect(text.startsWith('---\n"@iris-mcp/shared": patch\n"@iris-mcp/dev": patch\n"@iris-mcp/interop": patch\n---\n')).toBe(true);
    expect(text).toContain("`iris_alerts_manage` `reset` stamps `clearedAt` in UTC");
    expect(text).toContain("`POST /tests` at the package level runs the package's test classes");
    expect(text).toContain("`pnpm gen:bootstrap` writes the embed only when its content changes");
    expect(text).toContain("The names, titles, arguments and descriptions of the three prompts are unchanged.");
    expect(text).toContain("No tool, action, governance key or default is added, so no tool count moves.");
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
  });
});

describe("Story 40.5: no new text claims regulatory compliance", () => {
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";

  for (const [name, text] of [
    ["the CHANGELOG section", section],
    ["the changeset", read(".changeset/story-40-5-epic-40-burn-down.md")],
    ["skills/recover-stuck-production/SKILL.md", read("skills/recover-stuck-production/SKILL.md")],
    ["skills/edit-and-test-class/SKILL.md", read("skills/edit-and-test-class/SKILL.md")],
    ["skills/deploy-and-test-class/SKILL.md", read("skills/deploy-and-test-class/SKILL.md")],
  ] as const) {
    it(`${name} makes no compliance claim`, () => {
      expect(text.length, `${name} is not empty`).toBeGreaterThan(0);
      for (const claim of CLAIMS) expect(text.match(claim)?.[0], `${name} matches ${String(claim)}`).toBeUndefined();
    });
  }
});
