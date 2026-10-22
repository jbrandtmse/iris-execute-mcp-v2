/**
 * Story 41.5 (AC 41.5.4, DW-623; project rule #59) - the two new `validate:prompts` checks, proven red through the real
 * CLI (`scripts/validate-prompts.mjs`) in SCRATCH COPIES of the repository under `os.tmpdir()`.
 *
 * `validate-prompts.test.ts` pins the check functions on typed fixtures and the real tree. This file proves that each
 * check can fail on the path it guards: a skill file and its pack copy edited on disk, the real script reading the real
 * built tool catalog (the scratch links the five server packages' `dist/`), and the process exit code and the `[kind]
 * label` lines a contributor sees. Every row is:
 *  - RED: one defect in a scratch copy; the process exits 1, and the `[preset]` or `[internal-reference]` lines name
 *    exactly the expected labels (a source and its pack copy alike);
 *  - GREEN: the same scratch copy repaired (the original bytes written back, the pack rebuilt where the source changed);
 *    the process exits 0. The repair is the negative control: the red comes from the defect, not from the copy.
 *
 * The rows: the preset narrowed, widened and undeclared; a real tool named in the rule (which cannot declare a preset);
 * a skill that names an ops tool and admin's `iris_database_manage`, each visible under its own server's `core`, so the
 * per-server lookup gives `core` where a lookup in one server's roster would not; the old three-line generated header
 * written into a workflow skill; an internal reference written into the rule source; and the three DW-623 controls (a
 * second copy of the adaptation header in the adapted skill, the header in a skill no provenance row names, and the
 * adapted skill's row removed from the notice). A last group drives `gen:skills` and `validate:prompts` over a prompt
 * without a valid `skill` field and over prompts with an internal reference in the title, the description, the body, an
 * argument description or the skill description: the scratch copy's ops package is a real directory with a stub
 * `dist/prompts/index.js` and a link to the real built tools. The expected messages, classes and labels are typed here,
 * not read from the check.
 * No IRIS and no network. The real tree is never written: the trees the rows copy, and the real ops prompts module, are
 * fingerprinted before the first row and compared after the last.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWLEDGE_SOURCE_DIR, NOTICE_FILENAME, PACK_DIR, PACK_SOURCE_DIR, RULES_SOURCE_DIR } from "../../../../scripts/lib/skills-pack.mjs";
import { ADAPTATION_HEADER } from "../../../../scripts/lib/provenance-core.mjs";
import { removeLink, REPO_ROOT } from "./pack-fixture";
import { makeScratchRepo, problemPairs, removeScratchRepo, runScript, sha256, treeLines } from "./story-41-1-qa-fixture";
import { stubPromptSource, VALID_STUB_SKILL } from "./story-41-5-qa-fixture";

const VALIDATE = "scripts/validate-prompts.mjs";
const GEN_PACK = "scripts/gen-pack.mjs";
const GEN_SKILLS = "scripts/gen-skills.mjs";
const OPS_PACKAGE = join("packages", "iris-ops-mcp");

const DEPLOY = "deploy-and-test-class";
const EDIT = "edit-and-test-class";
const SQL = "iris-mcp-objectscript-sql";
const GOTCHAS = "iris-mcp-objectscript-gotchas";
const RULE = "iris-mcp-objectscript-pre-write";

const GOLDEN_LINE_2 =
  "validate-prompts: OK \u2014 tool presets: 24 file(s) declare one (12 core, 6 developer, 6 full) and 16 tool-free file(s) declare none; no internal reference in 52 source(s), 2 adaptation header line(s) exempted.";

/** A fingerprint of everything in the real tree that a row's scratch copy is made from or stands in for. */
function realTreeFingerprint(): string[] {
  return [
    ...["skills", PACK_SOURCE_DIR, PACK_DIR].flatMap((rel) => treeLines(join(REPO_ROOT, rel)).map((line) => `${rel}: ${line}`)),
    `ops prompts module ${sha256(readFileSync(join(REPO_ROOT, "packages", "iris-ops-mcp", "dist", "prompts", "index.js")))}`,
  ];
}
let realTreeBefore: string[] = [];
beforeAll(() => {
  realTreeBefore = realTreeFingerprint();
});
afterAll(() => {
  expect(realTreeFingerprint(), "no row wrote to the real tree").toEqual(realTreeBefore);
});

const scratches: string[] = [];
/** The scratch roots whose ops package was replaced by a real directory that links the real built tools (`stubOpsPrompts`). */
const stubbed = new Set<string>();
function scratch(): string {
  const root = makeScratchRepo({ serverPackages: true });
  scratches.push(root);
  return root;
}
afterEach(() => {
  for (const root of scratches.splice(0)) {
    // Unlink the stub's link to the real built tools first; the recursive removal then never meets it.
    if (stubbed.has(root)) removeLink(join(root, OPS_PACKAGE, "dist", "tools"));
    removeScratchRepo(root);
  }
  stubbed.clear();
});

const read = (root: string, rel: string): string => readFileSync(join(root, rel), "utf8");
const write = (root: string, rel: string, text: string): void => writeFileSync(join(root, rel), text);

/** The paths of one skill's four files: the workflow source, its pack copy, and a knowledge source with its pack copy. */
const workflowRel = (name: string): string => `skills/${name}/SKILL.md`;
const packSkillRel = (name: string): string => `${PACK_DIR}/skills/${name}/SKILL.md`;
const knowledgeRel = (name: string): string => `${KNOWLEDGE_SOURCE_DIR}/${name}/SKILL.md`;

/** Edit the same text change into every file of a list, returning the originals so a repair can write them back. */
function editAll(root: string, rels: string[], change: (text: string) => string): Map<string, string> {
  const originals = new Map<string, string>();
  for (const rel of rels) {
    const before = read(root, rel);
    const after = change(before);
    expect(after, `${rel} changed`).not.toBe(before);
    originals.set(rel, before);
    write(root, rel, after);
  }
  return originals;
}

function repair(root: string, originals: Map<string, string>): void {
  for (const [rel, text] of originals) write(root, rel, text);
}

/** Run the validator and require exit 1; returns stderr. */
function red(root: string): string {
  const run = runScript(root, VALIDATE);
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
  expect(run.stdout, "no OK line on a failed run").not.toContain("validate-prompts: OK");
  return run.stderr;
}

/** Run the validator and require exit 0 with the golden second line. */
function green(root: string): void {
  const run = runScript(root, VALIDATE);
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  expect(run.stdout.split("\n")).toContain(GOLDEN_LINE_2);
}

/** The new problem lines never end in a double quote: the legacy tool-name lines (`  - <label>: "<token>"`) stay distinguishable. */
function expectNoLegacyShape(stderr: string): void {
  for (const line of stderr.split("\n").filter((candidate) => /^ {2}- \[/.test(candidate))) {
    expect(/^ {2}- (.+): "(.+)"$/.test(line), line).toBe(false);
  }
}

describe("validate:prompts CLI, scratch copy: the green control (AC 41.5.3)", () => {
  it("the unmodified copy exits 0 with the golden second line, 2 adaptation header lines exempted", () => {
    green(scratch());
  });
});

describe("validate:prompts CLI, scratch copy: the tool preset check (AC 41.5.4)", () => {
  const BOTH = [workflowRel(DEPLOY), packSkillRel(DEPLOY)];
  const LABELS = [`pack:skills/${DEPLOY}/SKILL.md`, `workflow:${DEPLOY}/SKILL.md`];

  it("a workflow skill and its pack copy narrowed to core name the tools that core hides", () => {
    const root = scratch();
    const originals = editAll(root, BOTH, (text) => text.replace("  iris-tools-preset: developer", "  iris-tools-preset: core"));
    const stderr = red(root);
    expect(problemPairs(stderr)).toEqual(LABELS.map((label) => `preset ${label}`));
    for (const label of LABELS) {
      expect(stderr).toContain(
        `  - [preset] ${label}: declares the core tool preset, which hides iris_test_status (iris-dev-mcp), iris_test_coverage (iris-dev-mcp); declare developer\n`,
      );
    }
    expect(stderr).toContain("validate-prompts: found tool-preset problems:");
    expectNoLegacyShape(stderr);
    repair(root, originals);
    green(root);
  });

  it("a developer skill and its pack copy widened to full say that developer already shows every tool", () => {
    const root = scratch();
    const originals = editAll(root, BOTH, (text) => text.replace("  iris-tools-preset: developer", "  iris-tools-preset: full"));
    const stderr = red(root);
    expect(problemPairs(stderr)).toEqual(LABELS.map((label) => `preset ${label}`));
    for (const label of LABELS) {
      expect(stderr).toContain(
        `  - [preset] ${label}: declares the full tool preset, but every tool it names is visible under developer; declare developer\n`,
      );
    }
    repair(root, originals);
    green(root);
  });

  it("a workflow skill and its pack copy with the declaration removed are told which preset to declare", () => {
    const root = scratch();
    const originals = editAll(root, BOTH, (text) => text.replace("metadata:\n  iris-tools-preset: developer\n", ""));
    const stderr = red(root);
    expect(problemPairs(stderr)).toEqual(LABELS.map((label) => `preset ${label}`));
    for (const label of LABELS) {
      // The tools are listed in the order the skill first names them: its first step loads the source.
      expect(stderr).toContain(`  - [preset] ${label}: names iris_doc_load, iris_doc_get, `);
      expect(stderr).toContain(` but declares no tool preset; declare metadata iris-tools-preset: developer\n`);
    }
    repair(root, originals);
    green(root);
  });

  it("a real tool named in the always-on rule is refused for the source and all three pack forms: a rule cannot declare a preset", () => {
    const root = scratch();
    const sourceRel = `${RULES_SOURCE_DIR}/${RULE}.md`;
    const originals = editAll(root, [sourceRel], (text) => `${text.trimEnd()}\n- Search first with iris_doc_search.\n`);
    expect(runScript(root, GEN_PACK).status).toBe(0);
    const stderr = red(root);
    expect(problemPairs(stderr)).toEqual([
      `preset pack:rules/agents-md/${RULE}.md`,
      `preset pack:rules/claude-code/${RULE}.md`,
      `preset pack:rules/cursor/${RULE}.mdc`,
      `preset rule:${RULE}.md`,
    ]);
    for (const label of [`pack:rules/agents-md/${RULE}.md`, `pack:rules/claude-code/${RULE}.md`, `pack:rules/cursor/${RULE}.mdc`, `rule:${RULE}.md`]) {
      expect(stderr).toContain(`  - [preset] ${label}: names iris_doc_search but declares no tool preset; only a SKILL.md can declare one, so name no tool here\n`);
    }
    repair(root, originals);
    expect(runScript(root, GEN_PACK).status).toBe(0);
    green(root);
  });

  it("a real tool named in a knowledge skill is refused for the source and the pack copy", () => {
    const root = scratch();
    const originals = editAll(root, [knowledgeRel(GOTCHAS), packSkillRel(GOTCHAS)], (text) => `${text.trimEnd()}\n\n- Call iris_doc_put to store it.\n`);
    const stderr = red(root);
    expect(problemPairs(stderr)).toEqual([`preset knowledge:${GOTCHAS}/SKILL.md`, `preset pack:skills/${GOTCHAS}/SKILL.md`]);
    expect(stderr).toContain(`  - [preset] knowledge:${GOTCHAS}/SKILL.md: names iris_doc_put but declares no tool preset; declare metadata iris-tools-preset: core\n`);
    repair(root, originals);
    green(root);
  });

  it("check-system-health (ops tools and admin's iris_database_manage) needs full under the real rosters, so core and developer are refused", () => {
    for (const declared of ["core", "developer"]) {
      const root = scratch();
      const rels = [workflowRel("check-system-health"), packSkillRel("check-system-health")];
      const originals = editAll(root, rels, (text) => text.replace("  iris-tools-preset: full", `  iris-tools-preset: ${declared}`));
      const stderr = red(root);
      expect(problemPairs(stderr)).toEqual(["preset pack:skills/check-system-health/SKILL.md", "preset workflow:check-system-health/SKILL.md"]);
      expect(stderr).toContain(`declares the ${declared} tool preset, which hides `);
      expect(stderr).toContain("; declare full\n");
      repair(root, originals);
      green(root);
    }
  });

  it("each tool is looked up on the server that owns it: an ops tool and admin's iris_database_manage, each in its own server's core, need core", () => {
    const root = scratch();
    const rels = [workflowRel("check-system-health"), packSkillRel("check-system-health")];
    /** The skill's own frontmatter with the given preset, over a body that names one ops tool and then one admin tool. */
    const crossServer = (preset: string) => (text: string): string => {
      const end = text.indexOf("\n---\n", 4) + "\n---\n".length;
      const frontmatter = text.slice(0, end).replace("  iris-tools-preset: full\n", `  iris-tools-preset: ${preset}\n`);
      return `${frontmatter}\nCall iris_health_check, then iris_database_manage on the admin server.\n`;
    };
    const originals = editAll(root, rels, crossServer("core"));
    const run = runScript(root, VALIDATE);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    // The two copies move from full to core: 14 core, 6 developer, 4 full.
    expect(run.stdout.split("\n")).toContain(GOLDEN_LINE_2.replace("(12 core, 6 developer, 6 full)", "(14 core, 6 developer, 4 full)"));
    repair(root, originals);
    editAll(root, rels, crossServer("full"));
    const stderr = red(root);
    expect(problemPairs(stderr)).toEqual(["preset pack:skills/check-system-health/SKILL.md", "preset workflow:check-system-health/SKILL.md"]);
    expect(stderr).toContain(
      "  - [preset] workflow:check-system-health/SKILL.md: declares the full tool preset, but every tool it names is visible under core; declare core\n",
    );
    repair(root, originals);
    green(root);
  });
});

describe("validate:prompts CLI, scratch copy: no internal references (AC 41.5.4)", () => {
  /** The three-line header `gen:skills` wrote before Story 41.5: it names a repository path, a repository file and repository tooling. */
  const OLD_HEADER =
    "# DO NOT EDIT \u2014 generated by scripts/gen-skills.mjs from\n" +
    `# packages/iris-dev-mcp/src/prompts/*.ts (source prompt: "${EDIT}").\n` +
    "# Regenerate via: pnpm gen:skills\n";
  const NEW_COMMENT = "# DO NOT EDIT: generated from the MCP prompt of the same name.\n";

  it("the old three-line header in one workflow skill and its pack copy is refused, by class, for each file", () => {
    const root = scratch();
    const originals = editAll(root, [workflowRel(EDIT), packSkillRel(EDIT)], (text) => text.replace(NEW_COMMENT, OLD_HEADER));
    const stderr = red(root);
    const labels = [`pack:skills/${EDIT}/SKILL.md`, `workflow:${EDIT}/SKILL.md`];
    expect(problemPairs(stderr)).toEqual(labels.map((label) => `internal-reference ${label}`));
    // One line per class and file: three classes each, so six problem lines in all.
    expect(stderr.split("\n").filter((line) => line.startsWith("  - [internal-reference] "))).toHaveLength(6);
    for (const label of labels) {
      expect(stderr).toContain(`  - [internal-reference] ${label}: a repository path (scripts/)\n`);
      expect(stderr).toContain(`  - [internal-reference] ${label}: a repository file (gen-skills.mjs)\n`);
      expect(stderr).toContain(`  - [internal-reference] ${label}: repository tooling (pnpm)\n`);
    }
    expect(stderr).toContain("validate-prompts: found internal references in agent content:");
    expectNoLegacyShape(stderr);
    repair(root, originals);
    green(root);
  });

  it("an internal reference in the always-on rule is refused for the source and all three pack forms", () => {
    const root = scratch();
    const sourceRel = `${RULES_SOURCE_DIR}/${RULE}.md`;
    const originals = editAll(root, [sourceRel], (text) => `${text.trimEnd()}\n- Read the irislib copy of the class first.\n`);
    expect(runScript(root, GEN_PACK).status).toBe(0);
    const stderr = red(root);
    const labels = [`pack:rules/agents-md/${RULE}.md`, `pack:rules/claude-code/${RULE}.md`, `pack:rules/cursor/${RULE}.mdc`, `rule:${RULE}.md`];
    expect(problemPairs(stderr)).toEqual(labels.map((label) => `internal-reference ${label}`));
    for (const label of labels) {
      expect(stderr).toContain(`  - [internal-reference] ${label}: a snapshot folder (irislib)\n`);
    }
    repair(root, originals);
    expect(runScript(root, GEN_PACK).status).toBe(0);
    green(root);
  });
});

describe("validate:prompts CLI, scratch copy: the DW-623 controls (AC 41.5.4)", () => {
  const FLAGGED = "a repository file (IRIS-MCP-THIRD-PARTY-NOTICES.md)";
  const SQL_FILES = [knowledgeRel(SQL), packSkillRel(SQL)];

  it("a second exact copy of the header in the adapted skill, source and pack copy, is refused; the first stays exempt", () => {
    const root = scratch();
    const originals = editAll(root, SQL_FILES, (text) => `${text.trimEnd()}\n\n${ADAPTATION_HEADER}\n`);
    const stderr = red(root);
    expect(problemPairs(stderr)).toEqual([`internal-reference knowledge:${SQL}/SKILL.md`, `internal-reference pack:skills/${SQL}/SKILL.md`]);
    for (const label of [`knowledge:${SQL}/SKILL.md`, `pack:skills/${SQL}/SKILL.md`]) {
      expect(stderr).toContain(`  - [internal-reference] ${label}: ${FLAGGED}\n`);
    }
    repair(root, originals);
    green(root);
  });

  it("the header added to a skill no provenance row names (iris-mcp-objectscript-gotchas), source and pack copy, is refused", () => {
    const root = scratch();
    const originals = editAll(root, [knowledgeRel(GOTCHAS), packSkillRel(GOTCHAS)], (text) => text.replace("\n---\n\n", `\n---\n\n${ADAPTATION_HEADER}\n\n`));
    const stderr = red(root);
    expect(problemPairs(stderr)).toEqual([`internal-reference knowledge:${GOTCHAS}/SKILL.md`, `internal-reference pack:skills/${GOTCHAS}/SKILL.md`]);
    for (const label of [`knowledge:${GOTCHAS}/SKILL.md`, `pack:skills/${GOTCHAS}/SKILL.md`]) {
      expect(stderr).toContain(`  - [internal-reference] ${label}: ${FLAGGED}\n`);
    }
    repair(root, originals);
    green(root);
  });

  it("the adapted skill's row removed from the notice makes its own header line an internal reference, for the source and the pack copy", () => {
    const root = scratch();
    const noticeRel = `${PACK_SOURCE_DIR}/${NOTICE_FILENAME}`;
    const originals = editAll(root, [noticeRel], (text) =>
      text
        .split("\n")
        .filter((line) => !line.startsWith(`| \`skills/${SQL}/SKILL.md\``))
        .join("\n"),
    );
    const stderr = red(root);
    expect(problemPairs(stderr)).toEqual([`internal-reference knowledge:${SQL}/SKILL.md`, `internal-reference pack:skills/${SQL}/SKILL.md`]);
    for (const label of [`knowledge:${SQL}/SKILL.md`, `pack:skills/${SQL}/SKILL.md`]) {
      expect(stderr).toContain(`  - [internal-reference] ${label}: ${FLAGGED}\n`);
    }
    repair(root, originals);
    green(root);
  });
});

describe("gen:skills and validate:prompts CLI, scratch copy: the prompts themselves (AC 41.5.1, AC 41.5.4)", () => {
  const stubPrompt = stubPromptSource;
  const VALID_SKILL = VALID_STUB_SKILL;
  const BROKEN = [
    stubPrompt("zz-no-skill", null),
    stubPrompt("zz-empty", '{ description: "  ", preset: "core" }'),
    stubPrompt("zz-bad-preset", '{ description: "A stub. Use when testing.", preset: "huge" }'),
  ];
  const BROKEN_MESSAGES: Array<[string, string]> = [
    ["zz-no-skill", "has no skill field; give its prompt definition a skill with a description and a preset"],
    ["zz-empty", "has an empty skill description"],
    ["zz-bad-preset", 'has the skill preset "huge", which is not one of core, developer and full'],
  ];

  /** Make the scratch copy's ops package a real directory: its prompts are the stub source, its `dist/tools` still links to the real built tools. */
  function stubOpsPrompts(root: string, prompts: string[]): void {
    const dir = join(root, OPS_PACKAGE);
    if (!stubbed.has(root)) {
      expect(lstatSync(dir).isSymbolicLink(), "the scratch link to the real ops package, unlinked and never followed").toBe(true);
      removeLink(dir);
      mkdirSync(join(dir, "dist", "prompts"), { recursive: true });
      symlinkSync(join(REPO_ROOT, OPS_PACKAGE, "dist", "tools"), join(dir, "dist", "tools"), "junction");
      stubbed.add(root);
    }
    writeFileSync(join(dir, "dist", "prompts", "index.js"), `export const prompts = [${prompts.join(",")}];\n`);
  }

  // The write-mode leg leaves an up-to-date tree as it was; story-41-5-qa-gen-skills-refusal.test.ts proves on a stale tree
  // that nothing is written before the refusal.
  it("gen:skills exits 1, in write mode and in --check mode, naming each prompt and problem, and leaves an up-to-date tree as it was", () => {
    const root = scratch();
    stubOpsPrompts(root, BROKEN);
    const before = treeLines(join(root, "skills"));
    for (const args of [[], ["--check"]]) {
      const run = runScript(root, GEN_SKILLS, args);
      expect(run.status, `${args.join(" ")}\n${run.stdout}${run.stderr}`).toBe(1);
      expect(run.stderr.split("\n").filter((line) => line.startsWith("gen-skills: prompt "))).toEqual(
        BROKEN_MESSAGES.map(([name, message]) => `gen-skills: prompt iris-ops-mcp/${name} ${message}`),
      );
      expect(run.stdout, "no success line").not.toContain("Generated");
      expect(treeLines(join(root, "skills")), `nothing written (${args.join(" ") || "write mode"})`).toEqual(before);
    }
  });

  it("validate:prompts names each prompt without a valid skill field and exits 1; the repaired stubs exit 0", () => {
    const root = scratch();
    stubOpsPrompts(root, BROKEN);
    const stderr = red(root);
    expect(problemPairs(stderr)).toEqual(BROKEN_MESSAGES.map(([name]) => `skill-field prompt:iris-ops-mcp/${name}`).sort());
    expect(stderr).toContain("validate-prompts: found prompts without a valid skill field:");
    for (const [name, message] of BROKEN_MESSAGES) {
      expect(stderr).toContain(`  - [skill-field] prompt:iris-ops-mcp/${name}: ${message}\n`);
    }
    expect(stderr, "no other problem section").not.toContain("found tool-preset problems");
    expectNoLegacyShape(stderr);
    stubOpsPrompts(root, BROKEN.map((_, index) => stubPrompt(BROKEN_MESSAGES[index]?.[0] ?? "", VALID_SKILL)));
    const repaired = runScript(root, VALIDATE);
    expect(repaired.status, `${repaired.stdout}${repaired.stderr}`).toBe(0);
    expect(repaired.stdout).toContain("validate-prompts: OK");
  });

  it("an internal reference in a prompt's skill description is refused for that prompt, by class: the skill description is scanned", () => {
    const root = scratch();
    stubOpsPrompts(root, [stubPrompt("zz-ref", '{ description: "A stub. Use when you read Rule #7.", preset: "core" }')]);
    const stderr = red(root);
    expect(problemPairs(stderr)).toEqual(["internal-reference prompt:iris-ops-mcp/zz-ref"]);
    expect(stderr).toContain("  - [internal-reference] prompt:iris-ops-mcp/zz-ref: an internal rule number (Rule #7)\n");
    expect(stderr).toContain("  - [internal-reference] prompt:iris-ops-mcp/zz-ref: a number sign and digits that are not an IRIS error code (#7)\n");
    stubOpsPrompts(root, [stubPrompt("zz-ref", VALID_SKILL)]);
    const repaired = runScript(root, VALIDATE);
    expect(repaired.status, `${repaired.stdout}${repaired.stderr}`).toBe(0);
  });

  it("an internal reference in a prompt's title, description, body or argument description is refused for that prompt, and an unknown tool in an argument description is a tool-name problem", () => {
    const root = scratch();
    const argumentsWith = (description: string): string => `[{ name: "target", description: ${JSON.stringify(description)}, required: false }]`;
    const defects: Array<[name: string, fields: Parameters<typeof stubPromptSource>[2], line: string]> = [
      ["zz-title", { title: "Stub from Story 41.2" }, "a story or epic number (Story 4)"],
      ["zz-description", { description: "A stub prompt; run pnpm first." }, "repository tooling (pnpm)"],
      ["zz-body", { body: "A stub body, tracked as DW-615." }, "a planning or deferred-work id (DW-615)"],
      ["zz-argument", { arguments: argumentsWith("Read packages/shared first, then call iris_not_a_real_tool.") }, "a repository path (packages/)"],
    ];
    stubOpsPrompts(root, defects.map(([name, fields]) => stubPrompt(name, VALID_SKILL, fields)));
    const stderr = red(root);
    expect(problemPairs(stderr)).toEqual(defects.map(([name]) => `internal-reference prompt:iris-ops-mcp/${name}`).sort());
    for (const [name, , line] of defects) {
      expect(stderr).toContain(`  - [internal-reference] prompt:iris-ops-mcp/${name}: ${line}\n`);
    }
    expect(stderr).toContain("validate-prompts: found tool-name references that do not match any real tool:");
    expect(stderr).toContain('  - prompt:iris-ops-mcp/zz-argument: "iris_not_a_real_tool"\n');
    // The same prompts with clean text, the argument kept and naming a real tool.
    stubOpsPrompts(root, [
      ...defects.slice(0, 3).map(([name]) => stubPrompt(name, VALID_SKILL)),
      stubPrompt("zz-argument", VALID_SKILL, { arguments: argumentsWith("The profile to read; see iris_server_profiles.") }),
    ]);
    const repaired = runScript(root, VALIDATE);
    expect(repaired.status, `${repaired.stdout}${repaired.stderr}`).toBe(0);
  });
});
