/**
 * Story 41.1 (AC 41.1.1) - the skills pack build: `scripts/lib/skills-pack.mjs` assembles
 * `packages/client-config/skills-pack/` from `skills/` (generated) and `skills-pack-src/` (hand-authored),
 * `scripts/lib/generated-tree.mjs` synchronises the tree, and `scripts/gen-pack.mjs` is the CLI over both.
 *
 * Three layers, none of which needs IRIS or the network:
 *  - fixture roots under the OS temp directory (the layout rules, the failure rows, byte preservation);
 *  - the real CLI run from a copy of the scripts inside such a root (write mode, idempotence, refusals);
 *  - the real tree: the committed pack equals what its sources produce, and the real CLIs react to a
 *    temporary stray file and a temporary hand-authored knowledge skill (both removed in `finally`).
 *
 * The real-tree probes are placed through the layout constants, never through literal paths.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { diffTree, listFilesRecursive, writeTree } from "../../../../scripts/lib/generated-tree.mjs";
import {
  assemblePack,
  KNOWLEDGE_SOURCE_DIR,
  NOTICE_FILENAME,
  PACK_DIR,
  PACK_SOURCE_DIR,
  RULE_FORM_DIRS,
  RULES_SOURCE_DIR,
  WORKFLOW_SKILLS_DIR,
} from "../../../../scripts/lib/skills-pack.mjs";
import { makeTempRoot, put, removeTempRoot, REPO_ROOT, runNode } from "./pack-fixture";

const NOTICE_TEXT = "# notice\n";

/** The minimum a root needs for `assemblePack` to succeed: the notice. */
function seedMinimalRoot(root: string): void {
  put(root, `${PACK_SOURCE_DIR}/${NOTICE_FILENAME}`, NOTICE_TEXT);
}

const roots: string[] = [];
function tempRoot(): string {
  const root = makeTempRoot("skills-pack-test");
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) removeTempRoot(root);
});

describe("assemblePack layout (fixture roots)", () => {
  it("maps workflow skills, knowledge skills, rules and the notice into the plugin layout", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    put(root, `${WORKFLOW_SKILLS_DIR}/README.md`, "not part of the pack\n");
    put(root, `${WORKFLOW_SKILLS_DIR}/wf/SKILL.md`, "workflow skill\n");
    put(root, `${WORKFLOW_SKILLS_DIR}/wf/extra.md`, "workflow extra\n");
    put(root, `${KNOWLEDGE_SOURCE_DIR}/k1/SKILL.md`, "knowledge skill\n");
    put(root, `${KNOWLEDGE_SOURCE_DIR}/k1/references/x.md`, "reference\n");
    put(root, `${RULES_SOURCE_DIR}/always.md`, "rule\n");
    put(root, `${PACK_SOURCE_DIR}/README.md`, "contributor doc, never copied\n");

    const pack = assemblePack(root) as Map<string, Buffer>;

    expect([...pack.keys()].sort()).toEqual([
      NOTICE_FILENAME,
      "README.md",
      `${RULE_FORM_DIRS.claudeCode}/always.md`,
      `${RULE_FORM_DIRS.agentsMd}/always.md`,
      "skills/k1/SKILL.md",
      "skills/k1/references/x.md",
      "skills/wf/SKILL.md",
      "skills/wf/extra.md",
    ].sort());
    expect(pack.get(NOTICE_FILENAME)?.toString("utf8")).toBe(NOTICE_TEXT);
    expect(pack.get(`${RULE_FORM_DIRS.claudeCode}/always.md`)?.toString("utf8")).toBe("rule\n");
    expect(pack.get(`${RULE_FORM_DIRS.agentsMd}/always.md`)?.toString("utf8")).toBe(
      "<!-- IRIS-MCP-RULE:always:BEGIN -->\nrule\n<!-- IRIS-MCP-RULE:always:END -->\n",
    );
    const readme = pack.get("README.md")?.toString("utf8") ?? "";
    expect(readme.startsWith("<!-- DO NOT EDIT")).toBe(true);
    expect(readme).toContain("pnpm gen:pack");
    expect(readme).toContain(NOTICE_FILENAME);
    expect(readme).not.toContain("contributor doc");
  });

  it("counts a missing knowledge/ or rules/ directory as empty", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    expect([...(assemblePack(root) as Map<string, Buffer>).keys()].sort()).toEqual([NOTICE_FILENAME, "README.md"].sort());
  });

  it("fails when a skill name is defined in both sources, naming both", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    put(root, `${WORKFLOW_SKILLS_DIR}/dup/SKILL.md`, "workflow\n");
    put(root, `${KNOWLEDGE_SOURCE_DIR}/dup/SKILL.md`, "knowledge\n");
    expect(() => assemblePack(root)).toThrowError(
      new RegExp(`skill name collision.*${WORKFLOW_SKILLS_DIR}/dup/.*${KNOWLEDGE_SOURCE_DIR}/dup/`),
    );
  });

  it.each([
    ["a file at the top level", () => ({ rel: `${PACK_SOURCE_DIR}/NOTES.md`, content: "x" }), "NOTES.md"],
    ["a directory at the top level", () => ({ rel: `${PACK_SOURCE_DIR}/extras/a.md`, content: "x" }), "extras"],
    ["a knowledge directory without SKILL.md", () => ({ rel: `${KNOWLEDGE_SOURCE_DIR}/k2/other.md`, content: "x" }), "k2"],
    ["a knowledge directory whose skill file is skill.md, not SKILL.md", () => ({ rel: `${KNOWLEDGE_SOURCE_DIR}/k3/skill.md`, content: "x" }), "k3"],
    ["a file directly in knowledge/", () => ({ rel: `${KNOWLEDGE_SOURCE_DIR}/stray.md`, content: "x" }), "stray.md"],
    ["a directory in rules/", () => ({ rel: `${RULES_SOURCE_DIR}/nested/form.md`, content: "x\n" }), "nested"],
    ["a non-Markdown file in rules/", () => ({ rel: `${RULES_SOURCE_DIR}/notes.txt`, content: "x\n" }), "notes.txt"],
    ["a rule whose name is not lower-case letters and digits joined by single hyphens", () => ({ rel: `${RULES_SOURCE_DIR}/Bad_Name.md`, content: "x\n" }), "Bad_Name.md"],
  ])("fails on an unknown entry: %s", (_name, probe, entry) => {
    const root = tempRoot();
    seedMinimalRoot(root);
    const { rel, content } = probe();
    put(root, rel, content);
    expect(() => assemblePack(root)).toThrowError(entry);
  });

  it("fails when the notice is missing", () => {
    const root = tempRoot();
    put(root, `${RULES_SOURCE_DIR}/r.md`, "rule\n");
    expect(() => assemblePack(root)).toThrowError(NOTICE_FILENAME);
  });
});

// The pieces of the pack README, typed out here (Story 41.5, AC 41.5.2): they are the oracle, not read from the module under test.
const README_BANNER =
  "<!-- DO NOT EDIT. This directory is generated by `pnpm gen:pack` from the pack sources. Edit the sources, then regenerate. -->";
const README_INTRO =
  "Agent skills and the always-on rule for working with the IRIS MCP Server Suite. A skill that names the suite's tools shows its tool preset: the first of `core`, `developer` and `full` (the values of `IRIS_TOOLS_PRESET`) under which every tool it names is visible. `full`, the default, shows every tool.";
const KNOWLEDGE_INTRO = "An agent loads a knowledge skill when its task matches the skill's description.";
const WORKFLOW_INTRO = "Each is generated from the MCP prompt of the same name and walks an agent through one task with the suite's tools.";
const NO_DESCRIPTION = "(no description could be read from its frontmatter)";
const README_LAYOUT = [
  "## Layout",
  "",
  "- `skills/<name>/SKILL.md`: one directory per skill, in the standard plugin layout.",
  "- `rules/claude-code/<name>.md`: the always-on rule as a Claude Code rule file.",
  "- `rules/agents-md/<name>.md`: the same rule as an `AGENTS.md` section, between the lines `<!-- IRIS-MCP-RULE:<name>:BEGIN -->` and `<!-- IRIS-MCP-RULE:<name>:END -->`.",
  "- `IRIS-MCP-THIRD-PARTY-NOTICES.md`: third-party notices and licence texts for adapted content.",
  "",
  "## Third-party content",
  "",
  "Content adapted from another project carries a header line as its first non-blank line after any frontmatter, and a row in the provenance table of `IRIS-MCP-THIRD-PARTY-NOTICES.md`. Read that file before redistributing the pack.",
  "",
].join("\n");

/** The rule line of the catalog for a rule stem and title. */
const ruleLine = (stem: string, title: string): string =>
  `- \`${stem}\`: ${title}. Its Claude Code form, \`rules/claude-code/${stem}.md\`, has no \`paths:\` scope, so it loads in every session of a project that installs it. \`rules/agents-md/${stem}.md\` holds the same text for \`AGENTS.md\`, between two marker lines.`;

/** A README from its three lists, each already rendered as lines (an empty list renders `None.`). */
function expectedReadme(knowledge: string[], workflow: string[], rules: string[]): string {
  const list = (lines: string[]): string => (lines.length === 0 ? "None." : lines.join("\n"));
  return [
    README_BANNER,
    "",
    "# IRIS MCP skills pack",
    "",
    README_INTRO,
    "",
    "## Knowledge skills",
    "",
    KNOWLEDGE_INTRO,
    "",
    list(knowledge),
    "",
    "## Workflow skills",
    "",
    WORKFLOW_INTRO,
    "",
    list(workflow),
    "",
    "## Always-on rules",
    "",
    list(rules),
    "",
    README_LAYOUT,
  ].join("\n");
}

const readmeOf = (root: string): string => ((assemblePack(root) as Map<string, Buffer>).get("README.md") as Buffer).toString("utf8");

describe("the pack README is a catalog (fixture roots, AC 41.5.2)", () => {
  it("lists the knowledge skills, the workflow skills and the rules in that order, each sorted by name, with each skill's description and declared preset", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    // Written out of name order, so the sort is what orders the lists.
    put(root, `${WORKFLOW_SKILLS_DIR}/wf-b/SKILL.md`, '---\nname: wf-b\ndescription: "Does B. Use when b."\nmetadata:\n  iris-tools-preset: developer\n---\n\nBody.\n');
    put(root, `${WORKFLOW_SKILLS_DIR}/wf-a/SKILL.md`, "---\nname: wf-a\ndescription: Does A. Use when a.\n---\n\nBody.\n");
    put(root, `${KNOWLEDGE_SOURCE_DIR}/kn-z/SKILL.md`, '---\nname: kn-z\ndescription: "Covers z. Use when z."\n---\n\nBody.\n');
    put(root, `${KNOWLEDGE_SOURCE_DIR}/kn-plain/SKILL.md`, "No frontmatter at all.\n");
    put(root, `${RULES_SOURCE_DIR}/b-rule.md`, "No heading here.\n");
    put(root, `${RULES_SOURCE_DIR}/a-rule.md`, "Intro line.\n\n## Heading one  \n\nBody.\n# Later heading\n");

    expect(readmeOf(root)).toBe(
      expectedReadme(
        ["- `kn-plain`: " + NO_DESCRIPTION, "- `kn-z`: Covers z. Use when z."],
        ["- `wf-a`: Does A. Use when a.", "- `wf-b` (tool preset `developer`): Does B. Use when b."],
        [ruleLine("a-rule", "Heading one"), ruleLine("b-rule", "b-rule")],
      ),
    );
  });

  it("an empty section reads None.", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    expect(readmeOf(root)).toBe(expectedReadme([], [], []));
  });

  it("a SKILL.md whose description cannot be read renders the fallback text and never throws: no file, no frontmatter, a BOM, a missing description, an unclosed block", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    put(root, `${WORKFLOW_SKILLS_DIR}/w1/extra.md`, "a skill directory with no SKILL.md\n");
    put(root, `${WORKFLOW_SKILLS_DIR}/w2/SKILL.md`, "# no frontmatter\n");
    put(root, `${WORKFLOW_SKILLS_DIR}/w3/SKILL.md`, "\ufeff---\nname: w3\ndescription: BOM.\n---\n");
    put(root, `${WORKFLOW_SKILLS_DIR}/w4/SKILL.md`, "---\nname: w4\n---\n");
    put(root, `${WORKFLOW_SKILLS_DIR}/w5/SKILL.md`, "---\nname: w5\ndescription: never closed\n");
    put(root, `${WORKFLOW_SKILLS_DIR}/w6/SKILL.md`, '---\nname: w6\ndescription: ""\n---\n');

    expect(readmeOf(root)).toBe(
      expectedReadme([], ["w1", "w2", "w3", "w4", "w5", "w6"].map((name) => `- \`${name}\`: ${NO_DESCRIPTION}`), []),
    );
  });

  it("a preset renders only when it is declared and valid; a readable description renders even beside other frontmatter problems", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    put(root, `${WORKFLOW_SKILLS_DIR}/p-bad/SKILL.md`, '---\nname: p-bad\ndescription: "Bad preset."\nmetadata:\n  iris-tools-preset: everything\n---\n');
    put(root, `${WORKFLOW_SKILLS_DIR}/p-core/SKILL.md`, '---\nname: p-core\ndescription: "Core."\nmetadata:\n  iris-tools-preset: core\n---\n');
    put(root, `${WORKFLOW_SKILLS_DIR}/p-full/SKILL.md`, '---\nname: p-full\ndescription: "Full."\nextra: field\nmetadata:\n  iris-tools-preset: "full"\n---\n');
    put(root, `${WORKFLOW_SKILLS_DIR}/p-none/SKILL.md`, '---\nname: p-none\ndescription: "None."\n---\n');

    expect(readmeOf(root)).toBe(
      expectedReadme(
        [],
        ["- `p-bad`: Bad preset.", "- `p-core` (tool preset `core`): Core.", "- `p-full` (tool preset `full`): Full.", "- `p-none`: None."],
        [],
      ),
    );
  });

  it("a rule's title is its first heading of any level, with a trailing CR removed, or else its stem", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    put(root, `${RULES_SOURCE_DIR}/crlf.md`, "Text.\r\n###\tDeep heading   \r\n");
    put(root, `${RULES_SOURCE_DIR}/hash.md`, "#no space is not a heading\n####### seven is not one\n");
    expect(readmeOf(root)).toBe(expectedReadme([], [], [ruleLine("crlf", "Deep heading"), ruleLine("hash", "hash")]));
  });

  it("rules are sorted by name, not by file name: a rule precedes its hyphenated extension although `a-b.md` sorts before `a.md`", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    put(root, `${RULES_SOURCE_DIR}/a-b.md`, "Extension.\n");
    put(root, `${RULES_SOURCE_DIR}/a.md`, "Base.\n");
    expect(readmeOf(root)).toBe(expectedReadme([], [], [ruleLine("a", "a"), ruleLine("a-b", "a-b")]));
  });
});

describe("byte preservation (fixture roots)", () => {
  // Non-canonical variants: CRLF, a BOM, no trailing newline, non-ASCII UTF-8 (bytes, not escapes), and a
  // byte sequence that is not valid UTF-8 at all. A copy that decodes and re-encodes changes the last two.
  // These are the skills' byte variants; the rule forms' byte variants are pinned in skills-pack-rule.test.ts.
  const variants: Record<string, Buffer> = {
    crlf: Buffer.from("---\r\nname: crlf\r\n---\r\n\r\nline one\r\nline two\r\n", "utf8"),
    bom: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("---\nname: bom\n---\nbody\n", "utf8")]),
    noTrailingNewline: Buffer.from("no trailing newline", "utf8"),
    nonAscii: Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9, 0x20, 0xe2, 0x80, 0x94, 0x20, 0xc2, 0xa9, 0x20, 0xf0, 0x9f, 0x98, 0x80, 0x0a]),
    invalidUtf8: Buffer.from([0x61, 0xff, 0xfe, 0x62, 0x0a]),
  };

  it("copies every source byte for byte into the assembled pack and onto disk", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    const expectedBytes = new Map<string, Buffer>();
    for (const [key, bytes] of Object.entries(variants)) {
      put(root, `${WORKFLOW_SKILLS_DIR}/wf/${key}.md`, bytes);
      put(root, `${KNOWLEDGE_SOURCE_DIR}/kn/${key}.md`, bytes);
      expectedBytes.set(`skills/wf/${key}.md`, bytes);
      expectedBytes.set(`skills/kn/${key}.md`, bytes);
    }
    put(root, `${WORKFLOW_SKILLS_DIR}/wf/SKILL.md`, "wf\n");
    put(root, `${KNOWLEDGE_SOURCE_DIR}/kn/SKILL.md`, "kn\n");

    const pack = assemblePack(root) as Map<string, Buffer>;
    for (const [rel, bytes] of expectedBytes) {
      const copy = pack.get(rel);
      expect(Buffer.isBuffer(copy), `${rel} is a Buffer`).toBe(true);
      expect(copy?.equals(bytes), `${rel} is byte-identical in the assembled pack`).toBe(true);
    }

    const packDir = join(root, PACK_DIR);
    writeTree(pack, packDir);
    for (const [rel, bytes] of expectedBytes) {
      expect(readFileSync(join(packDir, rel)).equals(bytes), `${rel} is byte-identical on disk`).toBe(true);
    }
    expect(diffTree(pack, packDir)).toEqual({ missing: [], drift: [], stray: [] });
  });
});

describe("tree synchronisation (fixture roots)", () => {
  it("diffTree reports missing, drifted and stray files; writeTree repairs all three and prunes empty directories", () => {
    const root = tempRoot();
    const dir = join(root, "tree");
    const expected = new Map<string, Buffer | string>([
      ["a.md", "alpha\n"],
      ["sub/b.md", Buffer.from("beta\n")],
      ["sub/c.md", "gamma\n"],
    ]);
    put(dir, "a.md", "alpha\n");
    put(dir, "sub/b.md", "changed\n");
    put(dir, "stray/deep/z.md", "stray\n");

    expect(diffTree(expected, dir)).toEqual({ missing: ["sub/c.md"], drift: ["sub/b.md"], stray: ["stray/deep/z.md"] });

    expect(writeTree(expected, dir)).toEqual(["stray/deep/z.md"]);
    expect(existsSync(join(dir, "stray"))).toBe(false);
    expect(existsSync(dir)).toBe(true);
    expect(diffTree(expected, dir)).toEqual({ missing: [], drift: [], stray: [] });
    expect(listFilesRecursive(dir)).toEqual(["a.md", "sub/b.md", "sub/c.md"]);
  });

  it("writeTree leaves an up-to-date file untouched", () => {
    const root = tempRoot();
    const dir = join(root, "tree");
    const abs = put(dir, "a.md", "alpha\n");
    utimesSync(abs, 1, 1);
    writeTree(new Map([["a.md", "alpha\n"]]), dir);
    expect(statSync(abs).mtimeMs).toBe(1000);
  });

  it("listFilesRecursive of a missing directory is empty", () => {
    expect(listFilesRecursive(join(tempRoot(), "nope"))).toEqual([]);
  });
});

describe("gen-pack CLI (a copy of the scripts inside a fixture root)", () => {
  const SCRIPT_FILES = ["scripts/gen-pack.mjs", "scripts/lib/generated-tree.mjs", "scripts/lib/skills-pack.mjs"];

  function cliRoot(): string {
    const root = tempRoot();
    for (const rel of SCRIPT_FILES) put(root, rel, readFileSync(join(REPO_ROOT, rel)));
    seedMinimalRoot(root);
    put(root, `${WORKFLOW_SKILLS_DIR}/wf/SKILL.md`, "workflow\n");
    put(root, `${KNOWLEDGE_SOURCE_DIR}/kn/SKILL.md`, "knowledge\n");
    put(root, `${RULES_SOURCE_DIR}/rule.md`, "rule\n");
    return root;
  }

  it("write mode builds the pack, and a second run changes nothing", () => {
    const root = cliRoot();
    const first = runNode(root, "scripts/gen-pack.mjs");
    expect(first.status, first.stderr).toBe(0);
    const packDir = join(root, PACK_DIR);
    // These SKILL.md files have no frontmatter: the catalog falls back and the build still succeeds (AC 41.5.2).
    const catalog = readFileSync(join(packDir, "README.md"), "utf8");
    expect(catalog).toContain(`- \`kn\`: ${NO_DESCRIPTION}`);
    expect(catalog).toContain(`- \`wf\`: ${NO_DESCRIPTION}`);
    expect(listFilesRecursive(packDir)).toEqual(
      [
        NOTICE_FILENAME,
        "README.md",
        `${RULE_FORM_DIRS.agentsMd}/rule.md`,
        `${RULE_FORM_DIRS.claudeCode}/rule.md`,
        "skills/kn/SKILL.md",
        "skills/wf/SKILL.md",
      ].sort(),
    );

    const files = listFilesRecursive(packDir);
    for (const rel of files) utimesSync(join(packDir, rel), 1, 1);
    const second = runNode(root, "scripts/gen-pack.mjs");
    expect(second.status, second.stderr).toBe(0);
    for (const rel of files) {
      expect(statSync(join(packDir, rel)).mtimeMs, `${rel} was not rewritten`).toBe(1000);
    }

    const check = runNode(root, "scripts/gen-pack.mjs", ["--check"]);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain("OK");
  });

  it("--check names DRIFT and STRAY and exits 1; write mode restores the file and removes the stray", () => {
    const root = cliRoot();
    expect(runNode(root, "scripts/gen-pack.mjs").status).toBe(0);
    const packDir = join(root, PACK_DIR);
    put(packDir, "skills/kn/SKILL.md", "hand edited\n");
    put(packDir, "skills/kn/NOTES.md", "stray\n");

    const check = runNode(root, "scripts/gen-pack.mjs", ["--check"]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("DRIFT");
    expect(check.stderr).toContain("skills/kn/SKILL.md");
    expect(check.stderr).toContain("STRAY");
    expect(check.stderr).toContain("skills/kn/NOTES.md");
    expect(readFileSync(join(packDir, "skills/kn/SKILL.md"), "utf8")).toBe("hand edited\n");

    expect(runNode(root, "scripts/gen-pack.mjs").status).toBe(0);
    expect(readFileSync(join(packDir, "skills/kn/SKILL.md"), "utf8")).toBe("knowledge\n");
    expect(existsSync(join(packDir, "skills/kn/NOTES.md"))).toBe(false);
  });

  it("--check names MISSING for an absent pack file", () => {
    const root = cliRoot();
    const check = runNode(root, "scripts/gen-pack.mjs", ["--check"]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("MISSING");
    expect(check.stderr).toContain("skills/kn/SKILL.md");
  });

  it("exits 1 on a name collision, naming both sources, and writes nothing", () => {
    const root = cliRoot();
    put(root, `${KNOWLEDGE_SOURCE_DIR}/wf/SKILL.md`, "collides with the workflow skill\n");
    const run = runNode(root, "scripts/gen-pack.mjs");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${WORKFLOW_SKILLS_DIR}/wf/`);
    expect(run.stderr).toContain(`${KNOWLEDGE_SOURCE_DIR}/wf/`);
    expect(existsSync(join(root, PACK_DIR))).toBe(false);
  });

  it("exits 1 on an unknown source entry, naming it, and writes nothing", () => {
    const root = cliRoot();
    put(root, `${PACK_SOURCE_DIR}/NOTES.md`, "x\n");
    const run = runNode(root, "scripts/gen-pack.mjs");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("NOTES.md");
    expect(existsSync(join(root, PACK_DIR))).toBe(false);
  });
});

describe("the committed pack (real tree)", () => {
  const packDir = join(REPO_ROOT, PACK_DIR);

  it("committed pack matches its sources: no missing, drifted or stray file", () => {
    const diff = diffTree(assemblePack(REPO_ROOT), packDir);
    expect(diff).toEqual({ missing: [], drift: [], stray: [] });
  });

  it("holds the notice, the README and one SKILL.md per workflow skill", () => {
    const files = new Set(listFilesRecursive(packDir));
    expect(files.has(NOTICE_FILENAME)).toBe(true);
    expect(files.has("README.md")).toBe(true);
    const workflowSkills = listFilesRecursive(join(REPO_ROOT, WORKFLOW_SKILLS_DIR)).filter((rel) => rel.endsWith("/SKILL.md"));
    expect(workflowSkills).toHaveLength(12);
    for (const rel of workflowSkills) {
      expect(files.has(`skills/${rel}`), `skills/${rel}`).toBe(true);
    }
  });

  it("gen-pack --check passes on the committed tree", () => {
    const run = runNode(REPO_ROOT, "scripts/gen-pack.mjs", ["--check"]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("22 pack file(s)");
  });

  describe("the README catalog (AC 41.5.2)", () => {
    const readme = readFileSync(join(packDir, "README.md"));
    const text = readme.toString("utf8");

    /** Each skill directory's frontmatter, read by a small independent parse (the quoted description and the preset line). */
    function frontmatterOf(skillFile: string): { description: string; preset: string | null } {
      const lines = readFileSync(skillFile, "utf8").split("\n");
      const description = lines.find((line) => line.startsWith("description: ")) ?? "";
      const preset = lines.find((line) => line.startsWith("  iris-tools-preset: "));
      return { description: JSON.parse(description.slice("description: ".length)) as string, preset: preset === undefined ? null : preset.slice("  iris-tools-preset: ".length) };
    }
    const namesIn = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    const skillLine = (name: string, skillFile: string): string => {
      const { description, preset } = frontmatterOf(skillFile);
      return `- \`${name}\`${preset === null ? "" : ` (tool preset \`${preset}\`)`}: ${description}`;
    };

    it("is the golden file: 11611 bytes, 48 lines, sha256 4806e801...", () => {
      expect(readme.length).toBe(11611);
      expect(text.split("\n").length - 1, "48 lines").toBe(48);
      expect(createHash("sha256").update(readme).digest("hex")).toBe("4806e801f7a9dff2eae1d4099a6dc481d5d2ea410407584fca76e22e85c99b82");
      expect(/^[\x0a\x20-\x7e]+$/.test(text), "ASCII").toBe(true);
    });

    it("lists the 6 knowledge skills, then the 12 workflow skills, then the 1 rule, each section sorted by name, each skill with its frontmatter description and declared preset", () => {
      const knowledge = namesIn(join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR));
      const workflow = namesIn(join(REPO_ROOT, WORKFLOW_SKILLS_DIR));
      const rules = readdirSync(join(REPO_ROOT, RULES_SOURCE_DIR)).sort();
      expect([knowledge.length, workflow.length, rules.length]).toEqual([6, 12, 1]);

      const expected = [
        ...knowledge.map((name) => skillLine(name, join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR, name, "SKILL.md"))),
        ...workflow.map((name) => skillLine(name, join(REPO_ROOT, WORKFLOW_SKILLS_DIR, name, "SKILL.md"))),
      ];
      const entries = text.split("\n").filter((line) => /^- `[a-z0-9-]+`( \(tool preset `[a-z]+`\))?: /.test(line) && !line.startsWith("- `skills/") && !line.startsWith("- `rules/"));
      const ruleEntries = entries.filter((line) => line.includes("Its Claude Code form"));
      expect(entries.filter((line) => !line.includes("Its Claude Code form"))).toEqual(expected);
      expect(ruleEntries).toHaveLength(1);
      expect(ruleEntries[0]?.startsWith(`- \`${rules[0]?.replace(/\.md$/, "")}\`: `)).toBe(true);

      // The sections come in the order of the acceptance criterion.
      const positions = ["## Knowledge skills", "## Workflow skills", "## Always-on rules", "## Layout", "## Third-party content"].map((heading) => text.indexOf(heading));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      // Every workflow skill shows a declared preset, and no knowledge skill does.
      expect(workflow.filter((name) => skillLine(name, join(REPO_ROOT, WORKFLOW_SKILLS_DIR, name, "SKILL.md")).includes("(tool preset")).length).toBe(12);
      expect(knowledge.filter((name) => skillLine(name, join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR, name, "SKILL.md")).includes("(tool preset")).length).toBe(0);
    });
  });

  it("gen-pack --check fails on a temporary stray pack file, naming it", () => {
    const stray = join(packDir, "zz-stray-probe.md");
    put(packDir, "zz-stray-probe.md", "not a generated file\n");
    try {
      const run = runNode(REPO_ROOT, "scripts/gen-pack.mjs", ["--check"]);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("STRAY");
      expect(run.stderr).toContain("zz-stray-probe.md");
    } finally {
      rmSync(stray, { force: true });
    }
  });

  describe("with a temporary hand-authored knowledge skill", () => {
    const knowledgeDir = join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR);
    const probeName = "zz-probe-skill";

    /** Place the probe skill through the layout constant; returns the cleanup. */
    function placeProbe(): () => void {
      const existed = existsSync(knowledgeDir);
      put(REPO_ROOT, `${KNOWLEDGE_SOURCE_DIR}/${probeName}/SKILL.md`, '---\nname: zz-probe-skill\ndescription: "Probe."\n---\n\nProbe.\n');
      return () => rmSync(existed ? join(knowledgeDir, probeName) : knowledgeDir, { recursive: true, force: true });
    }

    it("gen:skills --check still passes: skills/ is gen:skills output and never sees a hand-authored skill", () => {
      const cleanup = placeProbe();
      try {
        const run = runNode(REPO_ROOT, "scripts/gen-skills.mjs", ["--check"]);
        expect(run.status, `${run.stderr}${run.stdout}`).toBe(0);
      } finally {
        cleanup();
      }
    });

    it("gen:pack --check fails on it until the pack is regenerated, naming the missing pack file", () => {
      const cleanup = placeProbe();
      try {
        const run = runNode(REPO_ROOT, "scripts/gen-pack.mjs", ["--check"]);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("MISSING");
        expect(run.stderr).toContain(`skills/${probeName}/SKILL.md`);
      } finally {
        cleanup();
      }
      expect(existsSync(join(knowledgeDir, probeName))).toBe(false);
    });
  });
});
