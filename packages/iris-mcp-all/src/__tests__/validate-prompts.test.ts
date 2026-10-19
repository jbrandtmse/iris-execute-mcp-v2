/**
 * Story 25.1, AC 25.1.3 — default-suite vitest wiring for
 * `scripts/validate-prompts.mjs`'s validation logic.
 *
 * `@iris-mcp/all` is the only package that depends on all five server
 * packages (`@iris-mcp/dev`/`admin`/`interop`/`ops`/`data`), so it is the
 * only place a cross-package "every iris_* token in a prompt/skill body is a
 * real tool name" test can live without `@iris-mcp/shared` importing a leaf
 * package (which would be circular).
 *
 * This test imports the SAME core validation module the CLI script
 * (`scripts/validate-prompts.mjs`) uses — `scripts/lib/validate-prompts-core.mjs`
 * — so the logic is single-sourced (the story's Task 3 requirement), plus
 * the SAME catalog loaders (`scripts/lib/prompt-catalog.mjs`,
 * `scripts/lib/tool-catalog.mjs`) that import the BUILT dist output of every
 * package. `pnpm turbo run test` declares `test: { dependsOn: ["build"] }`,
 * and `@iris-mcp/all`'s own `build` (a phantom/no-op task, since this
 * package has no own build script) still triggers `^build` for its five
 * `dependencies` transitively — so the dists exist by the time this test
 * runs.
 *
 * Story 41.1 (AC 41.1.5) widens the scanned text from the generated
 * `skills/<name>/SKILL.md` files to every Markdown file of agent content,
 * enumerated by `scripts/lib/skills-pack.mjs` `listAgentContentFiles`: the
 * workflow skills, the skills pack (`pack:`), and the hand-authored knowledge
 * skill (`knowledge:`) and rule (`rule:`) sources.
 *
 * Story 41.5 (AC 41.5.4, DW-623) adds two checks to the same core: that a skill declares the tool preset under which
 * every tool it names is visible (`presetProblems`), and that no prompt or agent content holds an internal reference
 * (`internalReferenceProblems`, nine classes, with the one adaptation-header exemption). This file pins both on typed
 * fixtures and on the real tree; `validate-prompts-pack-checks.test.ts` proves each red through the real CLI.
 *
 * NOT an `*.integration.test.ts` (Rule #21) — this MUST run in the default
 * suite so a renamed/removed tool breaks CI, not a client mid-workflow.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadAllPrompts } from "../../../../scripts/lib/prompt-catalog.mjs";
import { loadAllToolNames, loadToolPresetCatalog } from "../../../../scripts/lib/tool-catalog.mjs";
import { ADAPTATION_HEADER, parseProvenanceRows } from "../../../../scripts/lib/provenance-core.mjs";
import {
  KNOWLEDGE_SOURCE_DIR,
  listAgentContentFiles,
  NOTICE_FILENAME,
  PACK_DIR,
  PACK_SOURCE_DIR,
  RULES_SOURCE_DIR,
  WORKFLOW_SKILLS_DIR,
} from "../../../../scripts/lib/skills-pack.mjs";
import {
  declaredToolPreset,
  INTERNAL_REFERENCE_CLASSES,
  internalReferenceProblems,
  presetProblems,
  promptSourceText,
  validateSources,
  extractIrisTokens,
} from "../../../../scripts/lib/validate-prompts-core.mjs";
import { makeTempRoot, put, removeTempRoot, REPO_ROOT, runNode } from "./pack-fixture";

const root = REPO_ROOT;

interface ContentFile {
  label: string;
  packRel: string;
  absPath: string;
}

/** The labeled text of every collected content file. */
function contentSources(files: ContentFile[]): Array<{ label: string; text: string }> {
  return files.map(({ label, absPath }) => ({ label, text: readFileSync(absPath, "utf-8") }));
}

const BAD_TOKEN = "iris_not_a_real_tool";

const tempRoots: string[] = [];
afterEach(() => {
  for (const dir of tempRoots.splice(0)) removeTempRoot(dir);
});

describe("validate-prompts core logic (AC 25.1.3)", () => {
  it("extractIrisTokens finds every iris_* token, de-duplicated, in first-seen order", () => {
    const text =
      "Call `iris_health_check` then `iris_journal_info`, then `iris_health_check` again. Not a tool: iris_.";
    expect(extractIrisTokens(text)).toEqual(["iris_health_check", "iris_journal_info"]);
  });

  it("validateSources flags a token that is not in the known-tool set", () => {
    const problems = validateSources(
      [{ label: "fixture", text: "Call `iris_totally_made_up_tool` first." }],
      new Set(["iris_health_check"]),
    );
    expect(problems).toEqual([{ label: "fixture", token: "iris_totally_made_up_tool" }]);
  });

  it("validateSources reports nothing when every token is a known tool", () => {
    const problems = validateSources(
      [{ label: "fixture", text: "Call `iris_health_check` then `iris_journal_info`." }],
      new Set(["iris_health_check", "iris_journal_info"]),
    );
    expect(problems).toEqual([]);
  });
});

describe("every registered prompt references only real, live tool names (AC 25.1.3)", () => {
  it("all iris_* tokens across all 12 registered prompts resolve to a real tool", async () => {
    const [prompts, toolNames] = await Promise.all([
      loadAllPrompts(root),
      loadAllToolNames(root),
    ]);

    // Sanity: the pack is exactly 12 registered prompts across 4 packages —
    // the 9 v1 stakeholder-approved prompts (AC 25.1.5) minus
    // `objectscript-review` (retired in Story 41.2) plus
    // `resend-failed-messages`, un-gated in Story 26.3 once
    // `iris_message_resend` shipped (Story 26.2), plus
    // `promote-environment-change`, un-gated in Story 27.4 once
    // `iris_env_diff`/`iris_env_promote` shipped (Stories 27.0-27.3), plus
    // `edit-and-test-class`, added in Story 38.6. Both
    // gated prompts from the original pack are now registered — none remain, and
    // `find-patient-messages` was added in Story 39.6.
    expect(prompts).toHaveLength(12);

    const sources = prompts.map(({ pkg, prompt }) => ({
      label: `prompt:${pkg}/${prompt.name}`,
      text: promptSourceText(prompt),
    }));

    const problems = validateSources(sources, toolNames);
    expect(problems).toEqual([]);
  });

  it("a prompt's source text is its title, description, body, each argument's name and description, then its skill description", () => {
    const prompt = {
      title: "T-title",
      description: "T-description",
      arguments: [
        { name: "first", description: "Names iris_doc_get." },
        { name: "second", description: "The second." },
      ],
      build: () => "T-body",
      skill: { description: "T-skill", preset: "core" },
    };
    expect(promptSourceText(prompt)).toBe("T-title\nT-description\nT-body\nfirst: Names iris_doc_get.\nsecond: The second.\nT-skill");
    expect(promptSourceText({ ...prompt, arguments: [], skill: undefined })).toBe("T-title\nT-description\nT-body\n\n");
    expect(extractIrisTokens(promptSourceText(prompt))).toEqual(["iris_doc_get"]);
  });

  it("each prompt's own skill.preset is the first preset that shows every tool its source text names, its argument descriptions included", async () => {
    const [prompts, catalog] = await Promise.all([loadAllPrompts(root), loadToolPresetCatalog(root)]);
    const sources = (prompts as Array<{ pkg: string; prompt: Parameters<typeof promptSourceText>[0] & { name: string; skill: { preset: string } } }>).map(
      ({ pkg, prompt }) => ({ label: `prompt:${pkg}/${prompt.name}`, text: promptSourceText(prompt), packRel: `skills/${prompt.name}/SKILL.md`, preset: prompt.skill.preset }),
    );
    // Three argument descriptions name a tool: promote-environment-change (iris_env_promote, iris_env_diff) and recover-stuck-production (iris_production_status).
    const argumentTools = (prompts as Array<{ prompt: { arguments: Array<{ description: string }> } }>).flatMap(({ prompt }) =>
      prompt.arguments.flatMap((argument) => extractIrisTokens(argument.description)),
    );
    expect(argumentTools.sort()).toEqual(["iris_env_diff", "iris_env_promote", "iris_production_status"]);
    const result = presetProblems(sources, catalog) as { problems: unknown[]; declared: Record<string, number> };
    expect(result.problems).toEqual([]);
    expect(result.declared).toEqual({ core: 6, developer: 3, full: 3 });
  });

  it("resend-failed-messages (Story 26.3) AND promote-environment-change (Story 27.4) are BOTH registered — no gated prompt remains", async () => {
    const prompts = await loadAllPrompts(root);
    const names = prompts.map(({ prompt }) => prompt.name);
    expect(names).toContain("resend-failed-messages");
    expect(names).toContain("promote-environment-change");
  });
});

describe("agent content collection (fixture root, AC 41.1.5)", () => {
  function fixtureRoot(): string {
    const dir = makeTempRoot("validate-prompts-test");
    tempRoots.push(dir);
    return dir;
  }

  it("collects workflow, pack, knowledge and rule Markdown with their labels, and a bad token is flagged in each", () => {
    const dir = fixtureRoot();
    const text = `Call \`${BAD_TOKEN}\` first.\n`;
    // Collected.
    put(dir, `${WORKFLOW_SKILLS_DIR}/wf/SKILL.md`, text);
    put(dir, `${WORKFLOW_SKILLS_DIR}/wf/references/notes.md`, text);
    put(dir, `${PACK_DIR}/skills/wf/SKILL.md`, text);
    put(dir, `${PACK_DIR}/rules/r.md`, text);
    put(dir, `${KNOWLEDGE_SOURCE_DIR}/k/SKILL.md`, text);
    put(dir, `${KNOWLEDGE_SOURCE_DIR}/k/references/x.md`, text);
    put(dir, `${RULES_SOURCE_DIR}/r.md`, text);
    // Not agent content: the indexes, and a file that is not Markdown.
    put(dir, `${WORKFLOW_SKILLS_DIR}/README.md`, text);
    put(dir, `${PACK_DIR}/README.md`, text);
    put(dir, `${PACK_SOURCE_DIR}/README.md`, text);
    put(dir, `${KNOWLEDGE_SOURCE_DIR}/k/data.json`, text);

    const files = listAgentContentFiles(dir) as ContentFile[];
    const labels = [
      "workflow:wf/SKILL.md",
      "workflow:wf/references/notes.md",
      "pack:skills/wf/SKILL.md",
      "pack:rules/r.md",
      "knowledge:k/SKILL.md",
      "knowledge:k/references/x.md",
      "rule:r.md",
    ];
    expect(files.map((file) => file.label).sort()).toEqual([...labels].sort());
    expect(files.find((file) => file.label === "knowledge:k/references/x.md")?.packRel).toBe("skills/k/references/x.md");
    expect(files.find((file) => file.label === "rule:r.md")?.packRel).toBe("rules/r.md");
    expect(files.find((file) => file.label === "workflow:wf/SKILL.md")?.packRel).toBe("skills/wf/SKILL.md");

    const problems = validateSources(contentSources(files), new Set(["iris_health_check"]));
    expect(problems.map((problem: { label: string }) => problem.label).sort()).toEqual([...labels].sort());
    expect(new Set(problems.map((problem: { token: string }) => problem.token))).toEqual(new Set([BAD_TOKEN]));
  });

  it("a root with none of the source directories collects nothing", () => {
    expect(listAgentContentFiles(fixtureRoot())).toEqual([]);
  });
});

describe("every pack and source content file names only real tools (AC 41.1.5)", () => {
  it("every pack and source content file resolves to a real tool", async () => {
    const [prompts, toolNames] = await Promise.all([loadAllPrompts(root), loadAllToolNames(root)]);
    const files = listAgentContentFiles(root) as ContentFile[];
    const count = (kind: string): number => files.filter((file) => file.label.startsWith(`${kind}:`)).length;

    // The scan reaches the workflow skills and the pack copies; an empty scan would pass vacuously.
    expect(count("workflow")).toBe(prompts.length);
    expect(count("pack")).toBeGreaterThanOrEqual(count("workflow"));

    const problems = validateSources(contentSources(files), toolNames);
    expect(problems).toEqual([]);
  });

  it("the validate:prompts CLI exits 0 and counts the content files by kind", () => {
    const run = runNode(root, "scripts/validate-prompts.mjs");
    expect(run.status, run.stderr).toBe(0);
    const counts = /(\d+) source\(s\) checked \((\d+) prompt\(s\) \+ (\d+) content file\(s\): (\d+) workflow, (\d+) pack, (\d+) knowledge, (\d+) rule\)/.exec(
      run.stdout,
    );
    expect(counts, run.stdout).not.toBeNull();
    const [sources, prompts, content, workflow, pack, knowledge, rule] = (counts ?? []).slice(1).map(Number);
    expect(prompts).toBe(12);
    expect(workflow).toBe(12);
    expect(pack, "the committed pack copies are scanned").toBeGreaterThanOrEqual(workflow ?? 0);
    expect(content).toBe((workflow ?? 0) + (pack ?? 0) + (knowledge ?? 0) + (rule ?? 0));
    expect(sources).toBe((prompts ?? 0) + (content ?? 0));
  });

  it("the validate:prompts CLI exits 1 and names a temporary rule file holding a bad token", () => {
    const ruleName = "zz-probe-rule.md";
    const rulesDir = join(root, RULES_SOURCE_DIR);
    const rulesDirExisted = existsSync(rulesDir);
    put(root, `${RULES_SOURCE_DIR}/${ruleName}`, `Call \`${BAD_TOKEN}\`.\n`);
    try {
      const run = runNode(root, "scripts/validate-prompts.mjs");
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`rule:${ruleName}`);
      expect(run.stderr).toContain(BAD_TOKEN);
      // An unknown token is reported once, by the tool-name check, in its legacy line: the preset check ignores it.
      expect(run.stderr).toContain(`  - rule:${ruleName}: "${BAD_TOKEN}"\n`);
      expect(run.stderr).not.toContain("[preset]");
      expect(run.stderr).not.toContain("[internal-reference]");
    } finally {
      rmSync(rulesDirExisted ? join(rulesDir, ruleName) : rulesDir, { recursive: true, force: true });
    }
  });
});

// ----------------------------------------------------------------------------
// Story 41.5 - internal references (AC 41.5.4) and the DW-623 exemption.
// ----------------------------------------------------------------------------

/** The top-level entries of a repository, as the class samples need them. */
const REPOSITORY_ENTRIES = ["packages", "scripts", "skills", "README.md", ".claude"];
const NO_ADAPTED = new Set<string>();

type Problem = { label: string; className: string; match: string };

/** Run the internal-reference check on one text, as one source. */
function referencesIn(text: string, options: { packRel?: string | null; adapted?: string[]; label?: string } = {}): { problems: Problem[]; exempted: number } {
  return internalReferenceProblems([{ label: options.label ?? "fixture", text, packRel: options.packRel ?? null }], {
    repositoryEntries: REPOSITORY_ENTRIES,
    adaptedPackFiles: new Set(options.adapted ?? []),
  });
}

/** The nine classes with their names and samples, typed out here: the oracle is not read from the module under test. */
const CLASS_ORACLE: Array<[name: string, sample: string, match: string]> = [
  ["an internal rule number", "see Rule #7", "Rule #7"],
  ["a number sign and digits that are not an IRIS error code", "item #58", "#58"],
  ["a planning or deferred-work id", "tracked as DW-615", "DW-615"],
  ["a story or epic number", "added in Story 41.2", "Story 4"],
  ["a repository path", "see packages/shared", "packages/"],
  ["an absolute path", "open /Users/someone/file", "/Users/"],
  ["a repository file", "edit rules.md", "rules.md"],
  ["repository tooling", "run pnpm test", "pnpm"],
  ["a snapshot folder", "read irislib", "irislib"],
];

describe("internal references: the nine classes (AC 41.5.4)", () => {
  it("are nine, in the order of the story, each with a sample that the class flags", () => {
    const classes = INTERNAL_REFERENCE_CLASSES(REPOSITORY_ENTRIES) as Array<[string, RegExp, string]>;
    expect(classes.map(([name]) => name)).toEqual(CLASS_ORACLE.map(([name]) => name));
    expect(classes.map(([, , sample]) => sample)).toEqual(CLASS_ORACLE.map(([, sample]) => sample));
  });

  it.each(CLASS_ORACLE)("%s: its sample is flagged, naming the file and the class", (name, sample, match) => {
    const { problems } = referencesIn(sample);
    expect(problems.filter((problem) => problem.className === name)).toEqual([{ label: "fixture", className: name, match }]);
  });

  it("a source is reported once per class, with the first match of that class", () => {
    const { problems } = referencesIn("Rule #7 first, then Rule #9; Story 41.2 and Story 41.3.");
    expect(problems.filter((problem) => problem.className === "an internal rule number")).toEqual([
      { label: "fixture", className: "an internal rule number", match: "Rule #7" },
    ]);
    expect(problems.filter((problem) => problem.className === "a story or epic number")).toHaveLength(1);
  });

  it.each([
    ["an IRIS error code", "ERROR #5001: the class does not exist"],
    ["a number sign and digits followed by a colon, as an error code is written", "#5001: x"],
    ["the user's own path under a directory the repository does not hold", "load c:/path/to/src/** into IRIS"],
    ["a relative path that merely contains a repository name", "see ./packages-old and mypackages/x"],
    ["a user URL", "see https://example.com/docs/page"],
    ["an install command", "run npm install and npx create-thing"],
    ["the IRIS package that ships into the user's instance", "the ExecuteMCPv2 package"],
    ["a plain sentence", "Run the tests and compare the total with the number of test methods."],
    ["an ObjectScript modulo expression", 'If i#2=0 { Write "even" }'],
    ["an ObjectScript read with a length", "Read x#5"],
    ["an IRIS error code in lower case", "the save failed with error #5659"],
    ["an HTML entity", "&#169; 2026"],
    ["a numbered rule of a routing rule set, with no number sign", "rule 2 of the routing rule set sends it to the operation"],
    ["the namespace and the web port of a local instance", "connect to localhost:52773 in the HSCUSTOM namespace"],
  ])("accepts %s", (_row, text) => {
    expect(referencesIn(text).problems).toEqual([]);
  });

  /** The other spellings each class covers, typed out here: sample, class, first match. */
  const SPELLING_ORACLE: Array<[sample: string, name: string, match: string]> = [
    ["per Rule#16", "an internal rule number", "Rule#16"],
    ["see AC 41.5.1", "a planning or deferred-work id", "AC 41"],
    ["see DW 615 and AD28", "a planning or deferred-work id", "DW 615"],
    ["see NFR12", "a planning or deferred-work id", "NFR12"],
    ["added in Stories 41.2 and 41.3", "a story or epic number", "Stories 4"],
    ["from story-41-5", "a story or epic number", "story-4"],
    ["planned in Epic41", "a story or epic number", "Epic4"],
    ["run ./scripts/helper", "a repository path", "./scripts/"],
    ["read ../packages/shared", "a repository path", "../packages/"],
    ["edit ci.yml", "a repository file", "ci.yml"],
    ["run validate:prompts", "repository tooling", "validate:p"],
    ["run check:provenance", "repository tooling", "check:p"],
  ];

  it.each(SPELLING_ORACLE)("flags %j as %s", (sample, name, match) => {
    const { problems } = referencesIn(sample);
    expect(problems.filter((problem) => problem.className === name)).toEqual([{ label: "fixture", className: name, match }]);
  });

  it("a number sign after a word character is left to the rule-number class, which still flags Rule#7", () => {
    const names = referencesIn("see Rule#7").problems.map((problem) => problem.className);
    expect(names).toEqual(["an internal rule number"]);
  });

  it("an empty list of repository entries never makes the path class match", () => {
    const { problems } = internalReferenceProblems([{ label: "fixture", text: "see packages/shared and /", packRel: null }], {
      repositoryEntries: [],
      adaptedPackFiles: NO_ADAPTED,
    });
    expect(problems.map((problem: Problem) => problem.className)).not.toContain("a repository path");
  });

  it("a regular-expression character in an entry name is matched literally", () => {
    const { problems } = internalReferenceProblems([{ label: "fixture", text: "see a+b/x and aab/x", packRel: null }], {
      repositoryEntries: ["a+b"],
      adaptedPackFiles: NO_ADAPTED,
    });
    expect(problems.filter((problem: Problem) => problem.className === "a repository path").map((problem: Problem) => problem.match)).toEqual(["a+b/"]);
  });
});

describe("internal references: the real tree is clean (AC 41.5.4)", () => {
  it("none of the 51 sources, the prompts' arguments and skill descriptions included, holds one", async () => {
    const prompts = (await loadAllPrompts(root)) as Array<{
      pkg: string;
      prompt: Parameters<typeof promptSourceText>[0] & { name: string };
    }>;
    const sources: Array<{ label: string; text: string; packRel: string | null }> = prompts.map(({ pkg, prompt }) => ({
      label: `prompt:${pkg}/${prompt.name}`,
      text: promptSourceText(prompt),
      packRel: null,
    }));
    for (const { label, packRel, absPath } of listAgentContentFiles(root) as ContentFile[]) {
      sources.push({ label, packRel, text: readFileSync(absPath, "utf-8") });
    }
    expect(sources).toHaveLength(51);

    const notice = readFileSync(join(root, PACK_SOURCE_DIR, NOTICE_FILENAME), "utf-8");
    const adapted = new Set<string>((parseProvenanceRows(notice).rows as Array<{ packFile: string }>).map((row) => row.packFile));
    expect([...adapted]).toEqual(["skills/iris-mcp-objectscript-sql/SKILL.md"]);

    const result = internalReferenceProblems(sources, { repositoryEntries: readdirSync(root), adaptedPackFiles: adapted });
    expect(result.problems).toEqual([]);
    expect(result.exempted, "the SQL skill's knowledge: and pack: copies").toBe(2);
  });
});

// -- DW-623: exactly one header line, and only where a provenance row names the file ----------------------------

/** The shipped adapted skill's source text and the pack-relative path its provenance row names. */
const SQL_REL = "skills/iris-mcp-objectscript-sql/SKILL.md";
const sqlText = readFileSync(join(root, KNOWLEDGE_SOURCE_DIR, "iris-mcp-objectscript-sql", "SKILL.md"), "utf-8");
const ROW = [SQL_REL];

describe("DW-623: the adaptation header is exempt from the internal-reference check only as one exact line (core)", () => {
  const FLAGGED = { className: "a repository file", match: NOTICE_FILENAME };

  it("accepted: the real adapted skill, its row naming it, has no problem and one line exempted", () => {
    expect(sqlText).toContain(ADAPTATION_HEADER);
    const result = referencesIn(sqlText, { packRel: SQL_REL, adapted: ROW });
    expect(result).toEqual({ problems: [], exempted: 1 });
  });

  it("control: with no exemption the same text is flagged (the header is what the file-name class catches)", () => {
    expect(referencesIn(sqlText, { packRel: SQL_REL, adapted: [] })).toEqual({
      problems: [{ label: "fixture", ...FLAGGED }],
      exempted: 0,
    });
  });

  it("a second exact copy of the header in the adapted skill is flagged; the first is still exempt", () => {
    const twice = `${sqlText.trimEnd()}\n\n${ADAPTATION_HEADER}\n`;
    expect(referencesIn(twice, { packRel: SQL_REL, adapted: ROW })).toEqual({ problems: [{ label: "fixture", ...FLAGGED }], exempted: 1 });
  });

  it("the header as the first body line of a skill no provenance row names is flagged", () => {
    const gotchas = sqlText.replace(/^name: .*$/m, "name: iris-mcp-objectscript-gotchas");
    expect(referencesIn(gotchas, { packRel: "skills/iris-mcp-objectscript-gotchas/SKILL.md", adapted: ROW })).toEqual({
      problems: [{ label: "fixture", ...FLAGGED }],
      exempted: 0,
    });
  });

  it("the header that is not the first body line is flagged", () => {
    const moved = sqlText.replace(`\n${ADAPTATION_HEADER}\n`, `\nA line before the header.\n\n${ADAPTATION_HEADER}\n`);
    expect(moved).not.toBe(sqlText);
    expect(referencesIn(moved, { packRel: SQL_REL, adapted: ROW })).toEqual({ problems: [{ label: "fixture", ...FLAGGED }], exempted: 0 });
  });

  it("the header with CRLF line endings is flagged", () => {
    const crlf = sqlText.replace(/\n/g, "\r\n");
    expect(referencesIn(crlf, { packRel: SQL_REL, adapted: ROW })).toEqual({ problems: [{ label: "fixture", ...FLAGGED }], exempted: 0 });
  });

  it("the header with (c) in place of the copyright sign is flagged", () => {
    const ascii = sqlText.replace(ADAPTATION_HEADER, ADAPTATION_HEADER.replace(String.fromCharCode(0xa9), "(c)"));
    expect(ascii).not.toBe(sqlText);
    expect(referencesIn(ascii, { packRel: SQL_REL, adapted: ROW })).toEqual({ problems: [{ label: "fixture", ...FLAGGED }], exempted: 0 });
  });

  it("the header in a prompt source (no pack path) is flagged", () => {
    expect(referencesIn(`Intro.\n${ADAPTATION_HEADER}\n`, { label: "prompt:iris-dev-mcp/x", packRel: null, adapted: ROW })).toEqual({
      problems: [{ label: "prompt:iris-dev-mcp/x", ...FLAGGED }],
      exempted: 0,
    });
  });

  it("only the header line is skipped: another reference in the adapted skill is still flagged", () => {
    const result = referencesIn(`${sqlText}\nSee Rule #7.\n`, { packRel: SQL_REL, adapted: ROW });
    // "Rule #7" is both an internal rule number and a number sign with digits.
    expect(result.problems.map((problem) => problem.className)).toEqual([
      "an internal rule number",
      "a number sign and digits that are not an IRIS error code",
    ]);
    expect(result.exempted).toBe(1);
  });
});

// ----------------------------------------------------------------------------
// Story 41.5 - tool presets (AC 41.5.4).
// ----------------------------------------------------------------------------

/**
 * A typed catalog of two servers: `iris_a` is visible under every preset on `pkg-x`; `iris_b` only under developer;
 * `iris_p` only under core on `pkg-x`; `iris_q` only under developer on `pkg-y`; `iris_c` and `iris_r` under both
 * presets on `pkg-y`; `iris_only_full` under neither; `iris_d` is owned by both servers and listed by `pkg-y` only.
 */
const CATALOG = {
  owners: new Map<string, string[]>([
    ["iris_a", ["pkg-x"]],
    ["iris_b", ["pkg-x"]],
    ["iris_p", ["pkg-x"]],
    ["iris_q", ["pkg-y"]],
    ["iris_c", ["pkg-y"]],
    ["iris_r", ["pkg-y"]],
    ["iris_only_full", ["pkg-x"]],
    ["iris_d", ["pkg-x", "pkg-y"]],
  ]),
  rosters: {
    "pkg-x": {
      core: { include: ["iris_a", "iris_p"], exclude: ["iris_b", "iris_only_full", "iris_d"] },
      developer: { include: ["iris_a", "iris_b"], exclude: ["iris_p", "iris_only_full", "iris_d"] },
    },
    "pkg-y": {
      core: { include: ["iris_c", "iris_r", "iris_d"], exclude: ["iris_q"] },
      developer: { include: ["iris_c", "iris_r", "iris_q", "iris_d"], exclude: [] },
    },
  },
};

const SKILL_REL = "skills/s/SKILL.md";

/** One content source for the preset check. */
const skillSource = (text: string, preset: string | null, packRel = SKILL_REL, label = "workflow:s/SKILL.md") => ({ label, text, packRel, preset });

const presetMessages = (sources: ReturnType<typeof skillSource>[]): Array<{ label: string; message: string }> =>
  (presetProblems(sources, CATALOG) as { problems: Array<{ label: string; message: string }> }).problems;

describe("presetProblems: the first preset that shows every tool a skill names (AC 41.5.4)", () => {
  it.each([
    ["core", "Call iris_a.", "core"],
    ["developer", "Call iris_a then iris_b.", "developer"],
    ["developer", "Call iris_c and iris_q.", "developer"],
    ["full", "Call iris_only_full.", "full"],
    ["core", "Call iris_server_profiles first.", "core"],
  ])("a skill that needs %s and declares it has no problem (%s)", (_needs, text, preset) => {
    expect(presetMessages([skillSource(text, preset)])).toEqual([]);
  });

  it("too narrow: a core declaration that hides tools names each, with its server, in first-seen order, and the preset to declare", () => {
    expect(presetMessages([skillSource("Call iris_b, then iris_a, then iris_q.", "core")])).toEqual([
      {
        label: "workflow:s/SKILL.md",
        message: "declares the core tool preset, which hides iris_b (pkg-x), iris_q (pkg-y); declare developer",
      },
    ]);
  });

  it("wider than needed: a full declaration where developer shows everything", () => {
    expect(presetMessages([skillSource("Call iris_a and iris_b.", "full")])).toEqual([
      {
        label: "workflow:s/SKILL.md",
        message: "declares the full tool preset, but every tool it names is visible under developer; declare developer",
      },
    ]);
  });

  it("wider than needed: developer where core shows everything", () => {
    expect(presetMessages([skillSource("Call iris_a.", "developer")])).toEqual([
      {
        label: "workflow:s/SKILL.md",
        message: "declares the developer tool preset, but every tool it names is visible under core; declare core",
      },
    ]);
  });

  it("undeclared: a SKILL.md that names a tool but declares nothing is told what to declare", () => {
    expect(presetMessages([skillSource("Call iris_b and iris_a.", null)])).toEqual([
      {
        label: "workflow:s/SKILL.md",
        message: "names iris_b, iris_a but declares no tool preset; declare metadata iris-tools-preset: developer",
      },
    ]);
  });

  it("undeclared: a file that is not a SKILL.md cannot declare one, so it is told to name no tool", () => {
    expect(presetMessages([skillSource("Call iris_b.", null, "rules/claude-code/r.md", "pack:rules/claude-code/r.md")])).toEqual([
      {
        label: "pack:rules/claude-code/r.md",
        message: "names iris_b but declares no tool preset; only a SKILL.md can declare one, so name no tool here",
      },
    ]);
    expect(presetMessages([skillSource("Call iris_b.", null, "skills/s/references/x.md", "pack:skills/s/references/x.md")])).toHaveLength(1);
  });

  it("a declaration with no tool is refused", () => {
    expect(presetMessages([skillSource("A tool-free skill.", "core")])).toEqual([
      { label: "workflow:s/SKILL.md", message: "declares the core tool preset but names no tool; remove the declaration" },
    ]);
  });

  it("a value outside core, developer and full is refused by name, whatever the text names", () => {
    expect(presetMessages([skillSource("Call iris_a.", "everything")])).toEqual([
      { label: "workflow:s/SKILL.md", message: 'declares the tool preset "everything", which is not one of core, developer and full' },
    ]);
  });

  it("an unknown iris_* token is not this check's: it counts for nothing, so a skill with only that token is tool-free", () => {
    const result = presetProblems([skillSource("Call iris_not_a_real_tool.", null)], CATALOG);
    expect(result).toEqual({ problems: [], declared: { core: 0, developer: 0, full: 0 }, toolFree: 1 });
    expect(presetMessages([skillSource("Call iris_a and iris_not_a_real_tool.", "core")])).toEqual([]);
  });

  it("two servers: each token is checked against its own owner's roster, not the first token's", () => {
    // iris_a (pkg-x) and iris_r (pkg-y) are each visible under core on their own server.
    expect(presetMessages([skillSource("Call iris_a then iris_r.", "core")])).toEqual([]);
    // iris_p is visible only under core on pkg-x and iris_q only under developer on pkg-y: only full shows both.
    expect(presetMessages([skillSource("Call iris_p then iris_q.", "full")])).toEqual([]);
    expect(presetMessages([skillSource("Call iris_p then iris_q.", "developer")])).toEqual([
      {
        label: "workflow:s/SKILL.md",
        message: "declares the developer tool preset, which hides iris_p (pkg-x); declare full",
      },
    ]);
  });

  it("a tool owned by two servers is visible when either owner lists it", () => {
    expect(presetMessages([skillSource("Call iris_d.", "core")])).toEqual([]);
  });

  it("counts the declared presets and the tool-free files", () => {
    const result = presetProblems(
      [
        skillSource("Call iris_a.", "core", "skills/a/SKILL.md", "workflow:a/SKILL.md"),
        skillSource("Call iris_a and iris_b.", "developer", "skills/b/SKILL.md", "workflow:b/SKILL.md"),
        skillSource("Call iris_only_full.", "full", "skills/c/SKILL.md", "workflow:c/SKILL.md"),
        skillSource("Call iris_a.", "core", "skills/d/SKILL.md", "pack:skills/d/SKILL.md"),
        skillSource("No tool here.", null, "skills/e/SKILL.md", "knowledge:e/SKILL.md"),
        skillSource("None either.", null, "rules/r.md", "rule:r.md"),
      ],
      CATALOG,
    );
    expect(result).toEqual({ problems: [], declared: { core: 2, developer: 1, full: 1 }, toolFree: 2 });
  });
});

describe("tool presets, real tree (AC 41.5.4)", () => {
  it("every content file declares the preset it needs: 24 declare one (12 core, 6 developer, 6 full) and 15 are tool-free", async () => {
    const catalog = await loadToolPresetCatalog(root);
    const files = listAgentContentFiles(root) as ContentFile[];
    const sources = files.map(({ label, packRel, absPath }) => {
      const text = readFileSync(absPath, "utf-8");
      return { label, text, packRel, preset: declaredToolPreset(text, packRel) as string | null };
    });
    expect(sources).toHaveLength(39);
    const result = presetProblems(sources, catalog) as { problems: unknown[]; declared: Record<string, number>; toolFree: number };
    expect(result.problems).toEqual([]);
    expect(result.declared).toEqual({ core: 12, developer: 6, full: 6 });
    expect(result.toolFree).toBe(15);
  });

  it("the catalog loader maps each tool to its owning server, the framework tool to none, and carries each server's rosters", async () => {
    const catalog = (await loadToolPresetCatalog(root)) as { owners: Map<string, string[]>; rosters: Record<string, { core: { include: string[] }; developer: { include: string[] } }> };
    expect(catalog.owners.get("iris_test_status")).toEqual(["iris-dev-mcp"]);
    expect(catalog.owners.get("iris_database_manage")).toEqual(["iris-admin-mcp"]);
    expect(catalog.owners.has("iris_server_profiles")).toBe(false);
    expect(Object.keys(catalog.rosters).sort()).toEqual(["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"]);
    expect(catalog.rosters["iris-dev-mcp"]?.core.include).not.toContain("iris_test_status");
    expect(catalog.rosters["iris-dev-mcp"]?.developer.include).toContain("iris_test_status");
  });
});

describe("validate:prompts CLI on the real tree (AC 41.5.3)", () => {
  it("exits 0 with the unchanged first line and the golden second line", () => {
    const run = runNode(root, "scripts/validate-prompts.mjs");
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.split("\n").filter((line: string) => line !== "")).toEqual([
      "validate-prompts: OK \u2014 51 source(s) checked (12 prompt(s) + 39 content file(s): 12 workflow, 20 pack, 6 knowledge, 1 rule), 111 known tool name(s).",
      "validate-prompts: OK \u2014 tool presets: 24 file(s) declare one (12 core, 6 developer, 6 full) and 15 tool-free file(s) declare none; no internal reference in 51 source(s), 2 adaptation header line(s) exempted.",
    ]);
  });
});
