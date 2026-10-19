/**
 * Story 41.3 (DW-613) - the frontmatter every pack `SKILL.md` must open with, and the `check:provenance` rule that
 * enforces it.
 *
 * A client reads a skill's name and description only when the file's first line is `---`. The adaptation-header
 * rule skips a leading `---` block and treats a file whose line 1 is anything else as frontmatter-less, so a header
 * placed above the frontmatter passes it while the skill loses its name and description. `readSkillFrontmatter`
 * (scripts/lib/skills-pack.mjs; `skillFrontmatterProblems` is its problems) is the one strict reader, and since Story
 * 41.5 it also reads the optional `metadata` map whose one key is `iris-tools-preset`; `checkProvenance` applies it to
 * every agent file at `skills/<name>/SKILL.md` under the rule tag `skill-frontmatter`. Four layers, none of which needs
 * IRIS or the network:
 *  - the reader on typed text: the good, bad and not-a-skill rows of the story's I/O matrix;
 *  - `checkProvenance` on in-memory inputs: rule tag, labels and the directory name taken from the pack path;
 *  - the real `scripts/check-provenance.mjs` in a scratch copy of the repository, where the pack is built by the
 *    real `gen-pack.mjs`, so the real tree is never written;
 *  - the committed pack: every `skills/<name>/SKILL.md` passes.
 *
 * The oracles (field names, limits, reserved words, the adaptation header) are typed out here, not read from the
 * module under test.
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { hasValidAdaptationHeader, checkProvenance } from "../../../../scripts/lib/provenance-core.mjs";
import {
  KNOWLEDGE_SOURCE_DIR,
  NOTICE_FILENAME,
  PACK_DIR,
  PACK_SOURCE_DIR,
  readSkillFrontmatter,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_FILENAME,
  SKILL_FRONTMATTER_FIELDS,
  SKILL_METADATA_KEYS,
  SKILL_NAME,
  SKILL_NAME_MAX_LENGTH,
  SKILL_OPTIONAL_FRONTMATTER_FIELDS,
  SKILL_PRESET_KEY,
  SKILL_PRESETS,
  skillFrontmatterProblems,
  WORKFLOW_SKILLS_DIR,
} from "../../../../scripts/lib/skills-pack.mjs";
import { committedRowFiles, put, REPO_ROOT } from "./pack-fixture";
import { BOM, makeScratchRepo, problemRules, removeScratchRepo, runScript, toCrlf } from "./story-41-1-qa-fixture";

/** U+00A0 NO-BREAK SPACE, U+00A9 COPYRIGHT SIGN, U+00E9 LATIN SMALL LETTER E WITH ACUTE and U+FEFF BYTE ORDER MARK, from code points (ASCII source). */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);
const COPYRIGHT_SIGN = String.fromCharCode(0xa9);
const E_ACUTE = String.fromCharCode(0xe9);
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const HEADER = `Adapted from intersystems-community/iris-agentic-dev (MIT, ${COPYRIGHT_SIGN} 2025 InterSystems Corporation); see IRIS-MCP-THIRD-PARTY-NOTICES.md`;
const OPEN_LINE_MESSAGE =
  "does not open with a --- frontmatter line, so clients read no name or description; put the frontmatter on line 1";

/** A skill file: the given frontmatter lines, then a body. */
const fm = (...lines: string[]): string => `---\n${lines.join("\n")}\n---\n\nBody.\n`;
const GOOD_LINES = ["name: bad-skill", "description: Covers one thing. Use when you need it."];

// ---------------------------------------------------------------------------------------------------------
// The reader on typed text.
// ---------------------------------------------------------------------------------------------------------

describe("the frontmatter contract constants (typed oracles)", () => {
  it("requires exactly name and description, within the published limits", () => {
    expect([...SKILL_FRONTMATTER_FIELDS]).toEqual(["name", "description"]);
    expect(SKILL_NAME_MAX_LENGTH).toBe(64);
    expect(SKILL_DESCRIPTION_MAX_LENGTH).toBe(1024);
    expect(SKILL_FILENAME).toBe("SKILL.md");
  });

  it("allows one optional field, metadata, whose one key declares the tool preset (Story 41.5)", () => {
    expect([...SKILL_OPTIONAL_FRONTMATTER_FIELDS]).toEqual(["metadata"]);
    expect([...SKILL_METADATA_KEYS]).toEqual(["iris-tools-preset"]);
    expect(SKILL_PRESET_KEY).toBe("iris-tools-preset");
  });

  it("the declarable presets are core, developer and full in that order, and are exactly the names of shared's TOOL_PRESET_NAMES (Rule #44)", async () => {
    expect([...SKILL_PRESETS]).toEqual(["core", "developer", "full"]);
    const shared = (await import(pathToFileURL(join(REPO_ROOT, "packages/shared/dist/index.js")).href)) as { TOOL_PRESET_NAMES: readonly string[] };
    expect([...shared.TOOL_PRESET_NAMES].sort()).toEqual([...SKILL_PRESETS].sort());
  });

  it.each(["a", "a1", "iris-mcp-objectscript-gotchas", "2fa", "a-b-c-1"])("the name pattern accepts %s", (name) => {
    expect(SKILL_NAME.test(name)).toBe(true);
  });

  it.each(["", "A", "a_b", "-a", "a-", "a--b", "a b", "a.b", E_ACUTE])("the name pattern refuses %j", (name) => {
    expect(SKILL_NAME.test(name)).toBe(false);
  });
});

/** Frontmatter that must raise no problem: [row, text, the skill's directory name]. */
const GOOD: Array<[string, string, string]> = [
  ["plain values", fm(...GOOD_LINES), "bad-skill"],
  ["CRLF line endings", toCrlf(Buffer.from(fm(...GOOD_LINES), "utf8")).toString("utf8"), "bad-skill"],
  ["the fields in the other order", fm(GOOD_LINES[1] ?? "", GOOD_LINES[0] ?? ""), "bad-skill"],
  ["a closing line at the end of the file with no final newline", "---\nname: bad-skill\ndescription: d\n---", "bad-skill"],
  ["trailing spaces after a value", fm("name: bad-skill   ", "description: d  "), "bad-skill"],
  ["several spaces after the colon", fm("name:   bad-skill", "description:   d"), "bad-skill"],
  ["a name with digits and single hyphens", fm("name: iris-2fa-skill", "description: d"), "iris-2fa-skill"],
  [
    "a double-quoted (JSON) value that holds ': ', ' #', '->' and an escaped quote",
    fm("name: bad-skill", `description: ${JSON.stringify(`A: b # c -> d "quoted" ${E_ACUTE}`)}`),
    "bad-skill",
  ],
  ["a single-quoted value with a doubled quote", fm("name: bad-skill", "description: 'It''s fine: really # yes'"), "bad-skill"],
  [
    "comment and blank lines inside the block (the workflow banner)",
    fm("# DO NOT EDIT -- generated by a script", "# Regenerate via: pnpm gen:skills", "", "name: bad-skill", "  # an indented comment", "description: d"),
    "bad-skill",
  ],
  ["a description with '->' and angle brackets that are no tag", fm("name: bad-skill", `description: ${JSON.stringify("Move a -> b, then check a < b and b > c.")}`), "bad-skill"],
  ["the longest name", fm(`name: ${"a".repeat(64)}`, "description: d"), "a".repeat(64)],
  ["the longest description", fm("name: bad-skill", `description: ${"x".repeat(1024)}`), "bad-skill"],
  // Story 41.5: the optional metadata map.
  ["a metadata map with the preset", fm(...GOOD_LINES, "metadata:", "  iris-tools-preset: developer"), "bad-skill"],
  ["the metadata map before the fields", fm("metadata:", "  iris-tools-preset: core", ...GOOD_LINES), "bad-skill"],
  ["the metadata map between the fields", fm(GOOD_LINES[0] ?? "", "metadata:", "  iris-tools-preset: core", GOOD_LINES[1] ?? ""), "bad-skill"],
  [
    "a comment, a blank line and an indented comment inside the map",
    fm(...GOOD_LINES, "metadata:", "  # why this preset", "", "  iris-tools-preset: core", "    # more"),
    "bad-skill",
  ],
  ["a double-quoted preset value", fm(...GOOD_LINES, "metadata:", '  iris-tools-preset: "core"'), "bad-skill"],
  ["trailing spaces after metadata: and after the value", fm(...GOOD_LINES, "metadata:  ", "  iris-tools-preset: core  "), "bad-skill"],
  ["the metadata map with CRLF line endings", toCrlf(Buffer.from(fm(...GOOD_LINES, "metadata:", "  iris-tools-preset: core"), "utf8")).toString("utf8"), "bad-skill"],
  [
    "the frontmatter gen:skills writes (one comment line, name, description, the map)",
    fm("# DO NOT EDIT: generated from the MCP prompt of the same name.", "name: bad-skill", 'description: "Covers one thing. Use when asked."', "metadata:", "  iris-tools-preset: developer"),
    "bad-skill",
  ],
];

/** Frontmatter that must raise exactly the listed problems, in order: [row, text, directory name, fragments]. */
const BAD: Array<[string, string, string, string[]]> = [
  ["a BOM before the opening line", `${BYTE_ORDER_MARK}${fm(...GOOD_LINES)}`, "bad-skill", ["begins with a byte-order mark"]],
  ["an adaptation header above the frontmatter", `${HEADER}\n\n${fm(...GOOD_LINES)}`, "bad-skill", [OPEN_LINE_MESSAGE]],
  ["no frontmatter", "# Title\n\nBody.\n", "bad-skill", [OPEN_LINE_MESSAGE]],
  ["an empty file", "", "bad-skill", [OPEN_LINE_MESSAGE]],
  ["a blank line before the opening line", `\n${fm(...GOOD_LINES)}`, "bad-skill", [OPEN_LINE_MESSAGE]],
  ["trailing spaces on the opening line", `--- \n${GOOD_LINES.join("\n")}\n---\n`, "bad-skill", [OPEN_LINE_MESSAGE]],
  ["no closing line", `---\n${GOOD_LINES.join("\n")}\n\nBody.\n`, "bad-skill", ["has no closing --- line"]],
  ["no name", fm("description: d"), "bad-skill", ['has no "name" field']],
  ["no description", fm("name: bad-skill"), "bad-skill", ['has no "description" field']],
  ["an empty block", "---\n---\n", "bad-skill", ['has no "name" field', 'has no "description" field']],
  ["an empty name", fm("name:", "description: d"), "bad-skill", ['the field "name" is empty']],
  ["an empty description", fm("name: bad-skill", 'description: ""'), "bad-skill", ["the description is empty"]],
  ["a blank description", fm("name: bad-skill", 'description: "   "'), "bad-skill", ["the description is empty"]],
  ["a name that is not its directory", fm("name: other-skill", "description: d"), "bad-skill", ['is not its directory name "bad-skill"']],
  ["a name with an upper-case letter", fm("name: Bad-Skill", "description: d"), "Bad-Skill", ["is not lower-case letters and digits"]],
  ["a name with an underscore", fm("name: bad_skill", "description: d"), "bad_skill", ["is not lower-case letters and digits"]],
  ["a name that starts with a hyphen", fm('name: "-bad"', "description: d"), "-bad", ["is not lower-case letters and digits"]],
  ["a name with a doubled hyphen", fm("name: bad--skill", "description: d"), "bad--skill", ["is not lower-case letters and digits"]],
  ["a name that ends in a hyphen", fm('name: "bad-"', "description: d"), "bad-", ["is not lower-case letters and digits"]],
  [
    "a name that ends in a no-break space, which YAML keeps",
    fm(`name: bad-skill${NO_BREAK_SPACE}`, "description: d"),
    "bad-skill",
    ["is not lower-case letters and digits", 'is not its directory name "bad-skill"'],
  ],
  ["a name of 65 characters", fm(`name: ${"a".repeat(65)}`, "description: d"), "a".repeat(65), ["the name is 65 characters; the limit is 64"]],
  ["a name with the reserved word claude", fm("name: claude-helper", "description: d"), "claude-helper", ['contains the reserved word "claude"']],
  ["a name with the reserved word anthropic", fm("name: my-anthropic-tool", "description: d"), "my-anthropic-tool", ['contains the reserved word "anthropic"']],
  [
    "a description of 1025 characters",
    fm("name: bad-skill", `description: ${"x".repeat(1025)}`),
    "bad-skill",
    ["the description is 1025 characters; the limit is 1024"],
  ],
  [
    "a description that holds <UNDEFINED>",
    fm("name: bad-skill", `description: ${JSON.stringify("Fails with <UNDEFINED> at run time.")}`),
    "bad-skill",
    ["the description holds an XML-like tag"],
  ],
  [
    "a description that holds a closing tag",
    fm("name: bad-skill", `description: ${JSON.stringify("Ends with </b> here.")}`),
    "bad-skill",
    ["the description holds an XML-like tag"],
  ],
  ["an unknown field", fm(...GOOD_LINES, "license: MIT"), "bad-skill", ['has the field "license"; only name, description and metadata are allowed']],
  ["a repeated field", fm(GOOD_LINES[0] ?? "", GOOD_LINES[0] ?? "", GOOD_LINES[1] ?? ""), "bad-skill", ['repeats the field "name"']],
  [
    "an indented field",
    fm(GOOD_LINES[0] ?? "", `  ${GOOD_LINES[1] ?? ""}`),
    "bad-skill",
    ['is not "key: value" at column 1', 'has no "description" field'],
  ],
  [
    "a folded multi-line value",
    fm("name: bad-skill", "description: >", "  folded text"),
    "bad-skill",
    ["starts with a YAML indicator character", 'is not "key: value" at column 1'],
  ],
  [
    "a list value",
    fm(...GOOD_LINES, "tags:", "  - a"),
    "bad-skill",
    ['has the field "tags"', 'is not "key: value" at column 1'],
  ],
  ["a key with no space after the colon", fm("name:bad-skill", "description: d"), "bad-skill", ['is not "key: value" at column 1', 'has no "name" field']],
  ["a plain value that holds ': '", fm("name: bad-skill", "description: Use this: now"), "bad-skill", ['holds ": " or " #"']],
  ["a plain value that holds ' #'", fm("name: bad-skill", "description: a # comment"), "bad-skill", ['holds ": " or " #"']],
  ["a plain value that ends in ':'", fm("name: bad-skill", "description: Covers:"), "bad-skill", ['ends in ":"']],
  ["a double-quoted value with an invalid escape", fm("name: bad-skill", 'description: "bad \\q escape"'), "bad-skill", ["not one valid JSON string"]],
  ["a double-quoted value that is not closed", fm("name: bad-skill", 'description: "unterminated'), "bad-skill", ["not one valid JSON string"]],
  ["a double-quoted value followed by text", fm("name: bad-skill", 'description: "a" trailing'), "bad-skill", ["not one valid JSON string"]],
  ["a single-quoted value that is not closed", fm("name: bad-skill", "description: 'unterminated"), "bad-skill", ["not closed or holds a lone quote"]],
  ["a single-quoted value with a lone quote", fm("name: bad-skill", "description: 'it's'"), "bad-skill", ["not closed or holds a lone quote"]],
  // Story 41.5: the optional metadata map (each row alone).
  [
    "an unknown metadata key",
    fm(...GOOD_LINES, "metadata:", "  author: me"),
    "bad-skill",
    ['metadata line 5 has the key "author"; only iris-tools-preset is allowed'],
  ],
  [
    "a preset outside core, developer and full",
    fm(...GOOD_LINES, "metadata:", "  iris-tools-preset: all"),
    "bad-skill",
    ['the tool preset "all" is not one of core, developer and full (frontmatter line 5)'],
  ],
  [
    "metadata with a value instead of a map",
    fm(...GOOD_LINES, "metadata: x"),
    "bad-skill",
    ['the field "metadata" must be a map of two-space indented "key: value" lines, not a value (frontmatter line 4)'],
  ],
  ["a metadata map with no entry, last", fm(...GOOD_LINES, "metadata:"), "bad-skill", ['the field "metadata" holds no entry; add iris-tools-preset or remove it']],
  ["a metadata map with no entry, before a field", fm("metadata:", ...GOOD_LINES), "bad-skill", ['the field "metadata" holds no entry; add iris-tools-preset or remove it']],
  [
    "a metadata map with only comments",
    fm(...GOOD_LINES, "metadata:", "  # nothing here"),
    "bad-skill",
    ['the field "metadata" holds no entry; add iris-tools-preset or remove it'],
  ],
  [
    "a tab-indented metadata entry",
    fm(...GOOD_LINES, "metadata:", "\tiris-tools-preset: core"),
    "bad-skill",
    ['is not "key: value" at column 1', 'the field "metadata" holds no entry'],
  ],
  [
    "a four-space-indented metadata entry",
    fm(...GOOD_LINES, "metadata:", "    iris-tools-preset: core"),
    "bad-skill",
    ['is not "key: value" at column 1', 'the field "metadata" holds no entry'],
  ],
  [
    "a repeated metadata key",
    fm(...GOOD_LINES, "metadata:", "  iris-tools-preset: core", "  iris-tools-preset: full"),
    "bad-skill",
    ['repeats the metadata key "iris-tools-preset"; keep one'],
  ],
  [
    "a repeated metadata field",
    fm(...GOOD_LINES, "metadata:", "  iris-tools-preset: core", "metadata:", "  iris-tools-preset: full"),
    "bad-skill",
    ['repeats the field "metadata"; keep one', 'is not "key: value" at column 1'],
  ],
  ["an indented entry with no map open", fm(...GOOD_LINES, "  iris-tools-preset: core"), "bad-skill", ['is not "key: value" at column 1']],
  [
    "an indented entry after a column-1 key ended the map",
    fm("metadata:", "  iris-tools-preset: core", GOOD_LINES[0] ?? "", "  iris-tools-preset: full", GOOD_LINES[1] ?? ""),
    "bad-skill",
    ['is not "key: value" at column 1'],
  ],
  ["an empty preset value", fm(...GOOD_LINES, "metadata:", "  iris-tools-preset:"), "bad-skill", ['the metadata key "iris-tools-preset" is empty']],
  [
    "a preset value that is an unclosed quote",
    fm(...GOOD_LINES, "metadata:", '  iris-tools-preset: "core'),
    "bad-skill",
    ['the metadata key "iris-tools-preset" is a double-quoted value that is not one valid JSON string'],
  ],
];

function expectProblems(text: string, dirName: string, fragments: string[]): void {
  const problems = skillFrontmatterProblems(text, dirName) as string[];
  expect(problems, JSON.stringify(problems)).toHaveLength(fragments.length);
  fragments.forEach((fragment, index) => expect(problems[index]).toContain(fragment));
}

describe("skillFrontmatterProblems: the good rows", () => {
  it.each(GOOD)("accepts %s", (_row, text, dirName) => {
    expect(skillFrontmatterProblems(text, dirName)).toEqual([]);
  });
});

describe("skillFrontmatterProblems: the bad rows (each one alone)", () => {
  it.each(BAD)("refuses %s", (_row, text, dirName, fragments) => {
    expectProblems(text, dirName, fragments);
  });

  it.each([..."-?:,[]{}#&*!|>%@`"])("refuses a plain value that starts with the indicator %s", (character) => {
    expectProblems(fm("name: bad-skill", `description: ${character}x`), "bad-skill", ["starts with a YAML indicator character"]);
  });

  it("names the problem and the fix in the message for a header above the frontmatter", () => {
    expect(skillFrontmatterProblems(`${HEADER}\n\n${fm(...GOOD_LINES)}`, "bad-skill")).toEqual([OPEN_LINE_MESSAGE]);
  });
});

describe("readSkillFrontmatter: what it reads, with and without the metadata map (Story 41.5)", () => {
  it.each(["core", "developer", "full"])("accepts the preset %s and returns it", (preset) => {
    const read = readSkillFrontmatter(fm(...GOOD_LINES, "metadata:", `  iris-tools-preset: ${preset}`), "bad-skill");
    expect(read).toEqual({
      fields: { name: "bad-skill", description: "Covers one thing. Use when you need it." },
      metadata: { "iris-tools-preset": preset },
      problems: [],
    });
  });

  it("a skill with no metadata map reads no metadata and raises nothing", () => {
    expect(readSkillFrontmatter(fm(...GOOD_LINES), "bad-skill")).toEqual({
      fields: { name: "bad-skill", description: "Covers one thing. Use when you need it." },
      metadata: {},
      problems: [],
    });
  });

  it("records a preset value that is not allowed, so a caller can report what the file declares", () => {
    const read = readSkillFrontmatter(fm(...GOOD_LINES, "metadata:", "  iris-tools-preset: all"), "bad-skill");
    expect(read.metadata).toEqual({ "iris-tools-preset": "all" });
    expect(read.problems).toHaveLength(1);
  });

  it("records nothing for an unknown metadata key or a repeated one beyond the first", () => {
    expect(readSkillFrontmatter(fm(...GOOD_LINES, "metadata:", "  author: me"), "bad-skill").metadata).toEqual({});
    expect(readSkillFrontmatter(fm(...GOOD_LINES, "metadata:", "  iris-tools-preset: core", "  iris-tools-preset: full"), "bad-skill").metadata).toEqual({
      "iris-tools-preset": "core",
    });
  });

  it.each([
    ["a BOM", `${BYTE_ORDER_MARK}${fm(...GOOD_LINES)}`],
    ["no frontmatter", "# Title\n"],
    ["no closing line", `---\n${GOOD_LINES.join("\n")}\n`],
  ])("reads nothing from %s", (_row, text) => {
    const read = readSkillFrontmatter(text, "bad-skill");
    expect(read.fields).toEqual({});
    expect(read.metadata).toEqual({});
    expect(read.problems).toHaveLength(1);
  });

  it("skillFrontmatterProblems is exactly its problems", () => {
    for (const [, text, dirName] of [...GOOD, ...BAD]) {
      expect(skillFrontmatterProblems(text, dirName)).toEqual(readSkillFrontmatter(text, dirName).problems);
    }
  });
});

describe("the DW-613 gap: the adaptation-header rule alone accepts a header above the frontmatter", () => {
  const headerAbove = `${HEADER}\n\n---\nname: bad-skill\ndescription: d\n---\n\nBody.\n`;

  it("hasValidAdaptationHeader returns true for the text that skillFrontmatterProblems refuses", () => {
    expect(hasValidAdaptationHeader(headerAbove)).toBe(true);
    expect(skillFrontmatterProblems(headerAbove, "bad-skill")).toEqual([OPEN_LINE_MESSAGE]);
  });

  it("the header as the first non-blank line after the frontmatter passes both", () => {
    const headerBelow = `---\nname: bad-skill\ndescription: d\n---\n\n${HEADER}\n\nBody.\n`;
    expect(hasValidAdaptationHeader(headerBelow)).toBe(true);
    expect(skillFrontmatterProblems(headerBelow, "bad-skill")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// checkProvenance on in-memory inputs.
// ---------------------------------------------------------------------------------------------------------

interface AgentFile {
  label: string;
  packRel: string;
  text: string;
}

const realNotice = readFileSync(join(REPO_ROOT, PACK_SOURCE_DIR, NOTICE_FILENAME));

/** A consistent input set: the real notice, the committed pack files its rows name, and the given agent files. */
function inputsWith(agentFiles: AgentFile[]) {
  const packFiles = [{ rel: NOTICE_FILENAME, bytes: realNotice }, ...committedRowFiles(realNotice)];
  return {
    sourceNotice: realNotice,
    packNotice: realNotice,
    agentFiles,
    packFiles,
    distributions: [
      { name: "@x/client-config", mustShipPack: true, files: packFiles.map((file) => ({ path: `skills-pack/${file.rel}`, bytes: file.bytes })) },
    ],
  };
}

const SKILL_LABELS: Array<[kind: string, label: string]> = [
  ["a workflow source", "workflow:k/SKILL.md"],
  ["a pack copy", "pack:skills/k/SKILL.md"],
  ["a knowledge source", "knowledge:k/SKILL.md"],
];
const GOOD_K = fm("name: k", "description: d");
const NO_DESCRIPTION_K = fm("name: k");

describe("checkProvenance: the skill-frontmatter rule", () => {
  it("the consistent input set with no agent file passes", () => {
    expect(checkProvenance(inputsWith([]))).toEqual([]);
  });

  it.each(SKILL_LABELS)("%s with valid frontmatter passes", (_kind, label) => {
    expect(checkProvenance(inputsWith([{ label, packRel: "skills/k/SKILL.md", text: GOOD_K }]))).toEqual([]);
  });

  it.each(SKILL_LABELS)("%s with no description is refused under the rule tag, with its own label", (_kind, label) => {
    const problems = checkProvenance(inputsWith([{ label, packRel: "skills/k/SKILL.md", text: NO_DESCRIPTION_K }]));
    expect(problems).toEqual([
      { rule: "skill-frontmatter", label, message: 'has no "description" field in its frontmatter; add it' },
    ]);
  });

  it("takes the directory name from the pack path", () => {
    const problems = checkProvenance(inputsWith([{ label: "pack:skills/other/SKILL.md", packRel: "skills/other/SKILL.md", text: GOOD_K }]));
    expect(problems).toEqual([
      {
        rule: "skill-frontmatter",
        label: "pack:skills/other/SKILL.md",
        message: 'the name "k" is not its directory name "other"; make them equal',
      },
    ]);
  });

  it("reports every file with a problem, one entry per problem", () => {
    const problems = checkProvenance(
      inputsWith([
        { label: "knowledge:k/SKILL.md", packRel: "skills/k/SKILL.md", text: "---\n---\n" },
        { label: "pack:skills/k/SKILL.md", packRel: "skills/k/SKILL.md", text: GOOD_K },
        { label: "pack:skills/m/SKILL.md", packRel: "skills/m/SKILL.md", text: NO_DESCRIPTION_K },
      ]),
    ) as Array<{ rule: string; label: string }>;
    expect(problems.map((problem) => `${problem.rule} ${problem.label}`)).toEqual([
      "skill-frontmatter knowledge:k/SKILL.md",
      "skill-frontmatter knowledge:k/SKILL.md",
      "skill-frontmatter pack:skills/m/SKILL.md",
      "skill-frontmatter pack:skills/m/SKILL.md",
    ]);
  });

  it.each([
    ["a reference file of a skill", "knowledge:k/references/x.md", "skills/k/references/x.md"],
    ["a SKILL.md nested below the skill directory", "pack:skills/k/nested/SKILL.md", "skills/k/nested/SKILL.md"],
    ["a SKILL.md directly in skills/", "pack:skills/SKILL.md", "skills/SKILL.md"],
    ["a rule file", "rule:r.md", "rules/r.md"],
    ["a pack rule form", "pack:rules/claude-code/r.md", "rules/claude-code/r.md"],
  ])("does not apply to %s", (_kind, label, packRel) => {
    expect(checkProvenance(inputsWith([{ label, packRel, text: "Plain text with no frontmatter.\n" }]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The real CLI, in a scratch copy of the repository.
// ---------------------------------------------------------------------------------------------------------

const CHECK = "scripts/check-provenance.mjs";
const GEN_PACK = "scripts/gen-pack.mjs";
const SKILL_DIR = "qa-fm";
const SOURCE_REL = `${KNOWLEDGE_SOURCE_DIR}/${SKILL_DIR}/SKILL.md`;
const PACK_SKILL_REL = `skills/${SKILL_DIR}/SKILL.md`;
const NOTICE_REL = `${PACK_SOURCE_DIR}/${NOTICE_FILENAME}`;
const SEPARATOR_ROW = "| --- | --- | --- |\n";
const GOOD_SOURCE = "skills/skills/objectscript-style/SKILL.md";
const GOOD_SKILL = `---\nname: ${SKILL_DIR}\ndescription: A skill for the scratch copy.\n---\n\nBody.\n`;

const scratches: string[] = [];
afterEach(() => {
  for (const root of scratches.splice(0)) removeScratchRepo(root);
});

/** A scratch copy holding one knowledge skill (and, when asked, its provenance row), with the pack built. */
function scratchWithSkill(text: string | Buffer, withRow: boolean): string {
  const root = makeScratchRepo({ clientConfigManifest: true });
  scratches.push(root);
  put(root, SOURCE_REL, text);
  if (withRow) {
    const noticePath = join(root, NOTICE_REL);
    const row = `| \`${PACK_SKILL_REL}\` | \`${GOOD_SOURCE}\` | adapted for the pack |\n`;
    writeFileSync(noticePath, readFileSync(noticePath, "utf8").replace(SEPARATOR_ROW, () => SEPARATOR_ROW + row));
  }
  const generated = runScript(root, GEN_PACK);
  expect(generated.status, generated.stderr).toBe(0);
  return root;
}

function expectRefused(root: string): string {
  const run = runScript(root, CHECK);
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
  expect(problemRules(run.stderr), run.stderr).toEqual(["skill-frontmatter"]);
  expect(run.stdout).not.toContain("check-provenance: OK");
  return run.stderr;
}

describe("check:provenance CLI, scratch copy: the skill-frontmatter rule (DW-613)", () => {
  it("control: a knowledge skill with valid frontmatter passes, source and pack copy both counted", () => {
    const run = runScript(scratchWithSkill(GOOD_SKILL, false), CHECK);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("1 provenance row(s), 42 agent file(s), 5 distribution(s)");
  });

  it("control: the same skill as CRLF passes", () => {
    const run = runScript(scratchWithSkill(toCrlf(Buffer.from(GOOD_SKILL, "utf8")), false), CHECK);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });

  it("an adapted skill whose adaptation header is above its frontmatter exits 1 with exactly skill-frontmatter, for the source and the pack copy", () => {
    const text = `${HEADER}\n\n${GOOD_SKILL}`;
    expect(hasValidAdaptationHeader(text), "the header rule alone accepts this text").toBe(true);
    const stderr = expectRefused(scratchWithSkill(text, true));
    expect(stderr).toContain(`[skill-frontmatter] knowledge:${SKILL_DIR}/SKILL.md: ${OPEN_LINE_MESSAGE}`);
    expect(stderr).toContain(`[skill-frontmatter] pack:${PACK_SKILL_REL}: ${OPEN_LINE_MESSAGE}`);
    expect(stderr.match(/\[skill-frontmatter\]/g)).toHaveLength(2);
  });

  it("the same skill with the header as the first non-blank line after the frontmatter passes", () => {
    const text = GOOD_SKILL.replace("\n\nBody.\n", `\n\n${HEADER}\n\nBody.\n`);
    const run = runScript(scratchWithSkill(text, true), CHECK);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("2 provenance row(s), 42 agent file(s)");
  });

  it("a skill with no description is refused for the source and the pack copy", () => {
    const stderr = expectRefused(scratchWithSkill(`---\nname: ${SKILL_DIR}\n---\n\nBody.\n`, false));
    expect(stderr).toContain(`[skill-frontmatter] knowledge:${SKILL_DIR}/SKILL.md: has no "description" field`);
    expect(stderr).toContain(`[skill-frontmatter] pack:${PACK_SKILL_REL}: has no "description" field`);
  });

  it("a skill that starts with a BOM is refused for the source and the pack copy", () => {
    const stderr = expectRefused(scratchWithSkill(Buffer.concat([BOM, Buffer.from(GOOD_SKILL, "utf8")]), false));
    expect(stderr).toContain(`[skill-frontmatter] knowledge:${SKILL_DIR}/SKILL.md: begins with a byte-order mark`);
    expect(stderr).toContain(`[skill-frontmatter] pack:${PACK_SKILL_REL}: begins with a byte-order mark`);
  });

  it("a skill whose name is not its directory is refused for the source and the pack copy", () => {
    const stderr = expectRefused(scratchWithSkill(GOOD_SKILL.replace(`name: ${SKILL_DIR}`, "name: other-fm"), false));
    expect(stderr).toContain(`knowledge:${SKILL_DIR}/SKILL.md: the name "other-fm" is not its directory name "${SKILL_DIR}"`);
    expect(stderr).toContain(`pack:${PACK_SKILL_REL}: the name "other-fm" is not its directory name "${SKILL_DIR}"`);
  });

  it("each refusal row ran in a scratch copy: the real tree holds no such skill", () => {
    expect(existsSync(join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR, SKILL_DIR))).toBe(false);
    expect(existsSync(join(REPO_ROOT, PACK_DIR, "skills", SKILL_DIR))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The committed pack.
// ---------------------------------------------------------------------------------------------------------

/** The pack-relative `skills/<name>/SKILL.md` problems of a directory of skills, by directory name. */
function sweep(skillsDir: string, read: (dir: string) => string = (dir) => readFileSync(join(skillsDir, dir, SKILL_FILENAME), "utf8")): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    found[entry.name] = skillFrontmatterProblems(read(entry.name), entry.name) as string[];
  }
  return found;
}

describe("the committed pack: every skills/<name>/SKILL.md opens with valid frontmatter", () => {
  const packSkills = join(REPO_ROOT, PACK_DIR, "skills");
  const workflowNames = readdirSync(join(REPO_ROOT, WORKFLOW_SKILLS_DIR), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const knowledgeNames = readdirSync(join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it("covers the 12 workflow skills and every knowledge skill", () => {
    const names = Object.keys(sweep(packSkills));
    expect(workflowNames).toHaveLength(12);
    expect(knowledgeNames.length).toBeGreaterThanOrEqual(3);
    expect(names).toEqual(expect.arrayContaining([...workflowNames, ...knowledgeNames]));
  });

  it("raises no problem for any of them", () => {
    const withProblems = Object.entries(sweep(packSkills)).filter(([, problems]) => problems.length > 0);
    expect(withProblems).toEqual([]);
  });

  it("each workflow skill declares one tool preset in its metadata, and no knowledge skill declares any (Story 41.5)", () => {
    const metadataOf = (dir: string): Record<string, string> =>
      readSkillFrontmatter(readFileSync(join(packSkills, dir, SKILL_FILENAME), "utf8"), dir).metadata as Record<string, string>;
    for (const name of workflowNames) {
      expect(Object.keys(metadataOf(name)), name).toEqual(["iris-tools-preset"]);
      expect(["core", "developer", "full"], name).toContain(metadataOf(name)["iris-tools-preset"]);
    }
    for (const name of knowledgeNames) expect(metadataOf(name), name).toEqual({});
  });

  it("the sweep can fail: a copy of each pack skill without its description line is refused", () => {
    const stripped = sweep(packSkills, (dir) =>
      readFileSync(join(packSkills, dir, SKILL_FILENAME), "utf8")
        .split("\n")
        .filter((line) => !line.startsWith("description:"))
        .join("\n"),
    );
    for (const [dir, problems] of Object.entries(stripped)) {
      expect(problems, dir).toEqual(['has no "description" field in its frontmatter; add it']);
    }
  });

  it("a generated workflow description holds '->', so a tag rule written as 'no angle brackets' would fail the sweep", () => {
    const text = readFileSync(join(packSkills, "promote-environment-change", SKILL_FILENAME), "utf8");
    const description = text.split("\n").find((line) => line.startsWith("description:")) ?? "";
    expect(description).toContain("->");
    expect(skillFrontmatterProblems(text, "promote-environment-change")).toEqual([]);
  });
});
