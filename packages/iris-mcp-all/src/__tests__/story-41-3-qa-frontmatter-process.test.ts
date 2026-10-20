/**
 * Story 41.3 QA (DW-613) - the `skill-frontmatter` rule as a real `scripts/check-provenance.mjs` process, one
 * defect at a time, in a SCRATCH COPY of the repository under `os.tmpdir()`.
 *
 * `skills-pack-frontmatter.test.ts` pins the reader on typed text (every row of the story's matrix) and drives the CLI
 * for five defects: a header above the frontmatter, a missing description, a BOM, a name that is not its directory,
 * and the two green controls. This file drives the same CLI for the defects that file only reads through the
 * function: a missing name, an upper-case name, `claude` and `anthropic` in the name, a name over 64 characters, a
 * description over 1,024 characters, an XML tag in the description, an extra or repeated key, a folded value, an empty
 * description, no closing line, and frontmatter that is not on line 1 (a blank line or a title above it). Each row is:
 *  - RED: the defect alone in a knowledge skill, the pack built by the real `gen-pack.mjs`; the process exits 1, every
 *    problem line carries exactly the rule tag `skill-frontmatter`, and the source label and the pack-copy label each
 *    carry exactly the expected problems;
 *  - GREEN: the same scratch copy repaired (the skill rewritten, or its directory removed and the pack rebuilt); the
 *    process exits 0. The repair is the negative control: the red comes from the defect, not from the scratch copy.
 * A second list holds inputs that must stay accepted: CRLF in every form, the 64 and 1,024 character limits, quoted
 * values that hold ': ', ' #' and '->', comment lines inside the block, and a reference file with no frontmatter.
 * Story 41.5 adds the optional `metadata` map: a valid `iris-tools-preset` block is accepted, and an unknown metadata
 * key and a preset outside core, developer and full are each refused.
 *
 * The expected message fragments, the limits and the rule tag are typed here, not read from the module under test.
 * No IRIS and no network; the real tree is never written.
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { KNOWLEDGE_SOURCE_DIR, PACK_DIR } from "../../../../scripts/lib/skills-pack.mjs";
import { put, REPO_ROOT } from "./pack-fixture";
import { makeScratchRepo, problemRules, removeScratchRepo, runScript, toCrlf } from "./story-41-1-qa-fixture";

const CHECK = "scripts/check-provenance.mjs";
const GEN_PACK = "scripts/gen-pack.mjs";
const RULE = "skill-frontmatter";
const OPEN_LINE = "does not open with a --- frontmatter line, so clients read no name or description";

/** A skill file: the given frontmatter lines, then a body. */
const fm = (...lines: string[]): string => `---\n${lines.join("\n")}\n---\n\nBody.\n`;
/** A valid skill for the directory `dir`. */
const good = (dir: string): string => fm(`name: ${dir}`, "description: A skill for the scratch copy.");
const asCrlf = (text: string): string => toCrlf(Buffer.from(text, "utf8")).toString("utf8");

interface BadRow {
  row: string;
  /** The skill's directory name under `skills-pack-src/knowledge/`. */
  dir: string;
  text: string;
  /** One fragment per expected problem; each source and pack-copy label carries exactly these. */
  fragments: string[];
  /** The directory name is itself the defect, so the repair removes the directory instead of rewriting the skill. */
  removeToRepair?: boolean;
}

const BAD: BadRow[] = [
  {
    row: "a missing name",
    dir: "qa-no-name",
    text: fm("description: A skill."),
    fragments: ['has no "name" field in its frontmatter'],
  },
  {
    row: "an upper-case name",
    dir: "Qa-Upper",
    text: fm("name: Qa-Upper", "description: A skill."),
    fragments: ["is not lower-case letters and digits in groups joined by single hyphens"],
    removeToRepair: true,
  },
  {
    row: "the reserved word claude in the name",
    dir: "qa-claude-helper",
    text: fm("name: qa-claude-helper", "description: A skill."),
    fragments: ['contains the reserved word "claude"'],
    removeToRepair: true,
  },
  {
    row: "the reserved word anthropic in the name",
    dir: "qa-anthropic-tool",
    text: fm("name: qa-anthropic-tool", "description: A skill."),
    fragments: ['contains the reserved word "anthropic"'],
    removeToRepair: true,
  },
  {
    row: "a name of 65 characters",
    dir: "a".repeat(65),
    text: fm(`name: ${"a".repeat(65)}`, "description: A skill."),
    fragments: ["the name is 65 characters; the limit is 64"],
    removeToRepair: true,
  },
  {
    row: "a description of 1025 characters",
    dir: "qa-desc-long",
    text: fm("name: qa-desc-long", `description: ${"x".repeat(1025)}`),
    fragments: ["the description is 1025 characters; the limit is 1024"],
  },
  {
    row: "an XML-like tag in the description",
    dir: "qa-desc-tag",
    text: fm("name: qa-desc-tag", `description: ${JSON.stringify("Fails with <UNDEFINED> at run time.")}`),
    fragments: ["the description holds an XML-like tag"],
  },
  {
    row: "a closing tag in the description",
    dir: "qa-desc-close",
    text: fm("name: qa-desc-close", `description: ${JSON.stringify("Ends with </b> here.")}`),
    fragments: ["the description holds an XML-like tag"],
  },
  {
    row: "an extra frontmatter key",
    dir: "qa-extra-key",
    text: fm("name: qa-extra-key", "description: A skill.", "license: MIT"),
    fragments: ['has the field "license"; only name, description and metadata are allowed'],
  },
  {
    row: "an unknown metadata key (Story 41.5)",
    dir: "qa-meta-key",
    text: fm("name: qa-meta-key", "description: A skill.", "metadata:", "  author: me"),
    fragments: ['has the key "author"; only iris-tools-preset is allowed'],
  },
  {
    row: "a preset value that is not core, developer or full (Story 41.5)",
    dir: "qa-meta-preset",
    text: fm("name: qa-meta-preset", "description: A skill.", "metadata:", "  iris-tools-preset: everything"),
    fragments: ['the tool preset "everything" is not one of core, developer and full'],
  },
  {
    row: "a repeated frontmatter key",
    dir: "qa-repeat-key",
    text: fm("name: qa-repeat-key", "name: qa-repeat-key", "description: A skill."),
    fragments: ['repeats the field "name"'],
  },
  {
    row: "a folded multi-line description",
    dir: "qa-folded",
    text: fm("name: qa-folded", "description: >", "  folded text"),
    fragments: ["starts with a YAML indicator character", 'is not "key: value" at column 1'],
  },
  {
    row: "an empty description",
    dir: "qa-empty-desc",
    text: fm("name: qa-empty-desc", 'description: ""'),
    fragments: ["the description is empty"],
  },
  {
    row: "no closing line",
    dir: "qa-no-close",
    text: "---\nname: qa-no-close\ndescription: A skill.\n\nBody.\n",
    fragments: ["has no closing --- line after its frontmatter"],
  },
  {
    row: "a blank line above the frontmatter",
    dir: "qa-blank-above",
    text: `\n${good("qa-blank-above")}`,
    fragments: [OPEN_LINE],
  },
  {
    row: "a title above the frontmatter",
    dir: "qa-title-above",
    text: `# Title\n\n${good("qa-title-above")}`,
    fragments: [OPEN_LINE],
  },
  {
    row: "no frontmatter at all",
    dir: "qa-no-fm",
    text: "# Title\n\nBody.\n",
    fragments: [OPEN_LINE],
  },
  {
    row: "CRLF line endings and no description",
    dir: "qa-crlf-no-desc",
    text: asCrlf(fm("name: qa-crlf-no-desc")),
    fragments: ['has no "description" field in its frontmatter'],
  },
  {
    row: "CRLF line endings and an XML-like tag in the description",
    dir: "qa-crlf-tag",
    text: asCrlf(fm("name: qa-crlf-tag", `description: ${JSON.stringify("Fails with <UNDEFINED> at run time.")}`)),
    fragments: ["the description holds an XML-like tag"],
  },
];

/** Inputs that must stay accepted: [row, directory, SKILL.md text, an extra file beside it, if any]. */
const ACCEPTED: Array<[row: string, dir: string, text: string, extra?: [rel: string, text: string]]> = [
  ["every line CRLF", "qa-ok-crlf", asCrlf(good("qa-ok-crlf"))],
  [
    "CRLF in the frontmatter and LF in the body",
    "qa-ok-mixed",
    asCrlf("---\nname: qa-ok-mixed\ndescription: A skill.\n---\n") + "\nBody.\n",
  ],
  ["a name of exactly 64 characters", "a".repeat(64), fm(`name: ${"a".repeat(64)}`, "description: A skill.")],
  ["a description of exactly 1024 characters", "qa-ok-1024", fm("name: qa-ok-1024", `description: ${"x".repeat(1024)}`)],
  [
    "a double-quoted description holding ': ', ' #' and '->'",
    "qa-ok-quoted",
    fm("name: qa-ok-quoted", `description: ${JSON.stringify("Covers a: b # c -> d. Use when needed.")}`),
  ],
  ["a single-quoted description with a doubled quote", "qa-ok-single", fm("name: qa-ok-single", "description: 'It''s a skill: really'")],
  [
    "comment and blank lines inside the block",
    "qa-ok-comment",
    fm("# DO NOT EDIT", "", "name: qa-ok-comment", "# another comment", "description: A skill."),
  ],
  ["the fields in the other order", "qa-ok-order", fm("description: A skill.", "name: qa-ok-order")],
  [
    "a metadata map that declares a tool preset (Story 41.5)",
    "qa-ok-metadata",
    fm("name: qa-ok-metadata", "description: A skill.", "metadata:", "  iris-tools-preset: developer"),
  ],
  [
    "a reference file with no frontmatter beside a valid skill",
    "qa-ok-reference",
    good("qa-ok-reference"),
    ["references/notes.md", "Plain notes with no frontmatter.\n"],
  ],
];

const scratches: string[] = [];
afterEach(() => {
  for (const root of scratches.splice(0)) removeScratchRepo(root);
});

function scratch(): string {
  const root = makeScratchRepo({ clientConfigManifest: true });
  scratches.push(root);
  return root;
}

function genPack(root: string): void {
  const run = runScript(root, GEN_PACK);
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
}

/** The messages printed for one label under the rule tag: `  - [skill-frontmatter] <label>: <message>`. */
function messagesFor(stderr: string, label: string): string[] {
  const prefix = `  - [${RULE}] ${label}: `;
  return stderr
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
}

describe("check:provenance CLI, scratch copy: each frontmatter defect alone (DW-613)", () => {
  it.each(BAD)("$row: exits 1 with exactly skill-frontmatter for the source and the pack copy, and is green once repaired", (bad) => {
    const root = scratch();
    const skillRel = `${KNOWLEDGE_SOURCE_DIR}/${bad.dir}/SKILL.md`;
    put(root, skillRel, bad.text);
    genPack(root);

    const red = runScript(root, CHECK);
    expect(red.status, `${red.stdout}${red.stderr}`).toBe(1);
    expect(red.stdout).not.toContain("check-provenance: OK");
    expect(problemRules(red.stderr), red.stderr).toEqual([RULE]);
    for (const label of [`knowledge:${bad.dir}/SKILL.md`, `pack:skills/${bad.dir}/SKILL.md`]) {
      const messages = messagesFor(red.stderr, label);
      expect(messages, `${label}\n${red.stderr}`).toHaveLength(bad.fragments.length);
      for (const fragment of bad.fragments) {
        expect(
          messages.some((message) => message.includes(fragment)),
          `${label} should name: ${fragment}\n${red.stderr}`,
        ).toBe(true);
      }
    }
    // Nothing else is flagged: every problem line belongs to this skill.
    const problemLines = red.stderr.split("\n").filter((line) => line.startsWith("  - ["));
    expect(problemLines).toHaveLength(bad.fragments.length * 2);

    // The negative control: the same scratch copy, repaired, passes.
    if (bad.removeToRepair === true) rmSync(join(root, KNOWLEDGE_SOURCE_DIR, bad.dir), { recursive: true });
    else put(root, skillRel, good(bad.dir));
    genPack(root);
    const green = runScript(root, CHECK);
    expect(green.status, `${green.stdout}${green.stderr}`).toBe(0);
    expect(green.stdout).toContain("check-provenance: OK");
    if (bad.removeToRepair === true) {
      expect(existsSync(join(root, PACK_DIR, "skills", bad.dir)), "the pack copy of the removed skill is gone").toBe(false);
    }
  });
});

describe("check:provenance CLI, scratch copy: inputs the rule must keep accepting", () => {
  it.each(ACCEPTED)("accepts %s", (_row, dir, text, extra) => {
    const root = scratch();
    put(root, `${KNOWLEDGE_SOURCE_DIR}/${dir}/SKILL.md`, text);
    if (extra !== undefined) put(root, `${KNOWLEDGE_SOURCE_DIR}/${dir}/${extra[0]}`, extra[1]);
    genPack(root);
    const run = runScript(root, CHECK);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("check-provenance: OK");
    expect(existsSync(join(root, PACK_DIR, "skills", dir, "SKILL.md")), "the skill reached the pack").toBe(true);
  });
});

describe("these rows are hermetic", () => {
  it("none of the scratch skills exists in the real tree", () => {
    const dirs = [...BAD.map((bad) => bad.dir), ...ACCEPTED.map(([, dir]) => dir)];
    for (const dir of dirs) {
      expect(existsSync(join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR, dir)), `${KNOWLEDGE_SOURCE_DIR}/${dir}`).toBe(false);
      expect(existsSync(join(REPO_ROOT, PACK_DIR, "skills", dir)), `${PACK_DIR}/skills/${dir}`).toBe(false);
    }
  });

  it("the rows and the controls are distinct skills", () => {
    const dirs = [...BAD.map((bad) => bad.dir), ...ACCEPTED.map(([, dir]) => dir)];
    expect(new Set(dirs).size).toBe(dirs.length);
    expect(BAD.length).toBeGreaterThanOrEqual(18);
  });
});
