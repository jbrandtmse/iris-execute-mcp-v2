/**
 * Story 41.2 (AC 41.2.1, 41.2.2, 41.2.3) - the always-on ObjectScript pre-write rule and its two pack forms.
 *
 * `skills-pack-src/rules/iris-mcp-objectscript-pre-write.md` is the one source of the checklist.
 * `scripts/lib/skills-pack.mjs` renders it twice: `rules/claude-code/<name>.md` holds the source bytes, and
 * `rules/agents-md/<name>.md` holds the same bytes between two marker lines. Three layers, none of which needs
 * IRIS or the network:
 *  - the real tree: both committed forms against the source, and the source's own content (size, no internal
 *    reference, no tool name, one probe anchor per bullet);
 *  - fixture roots: the section form, the missing final newline, the byte variants (project rule #58), the
 *    frontmatter refusal and the unknown-entry refusal, through `assemblePack`;
 *  - the same rows through the real `scripts/gen-pack.mjs` CLI, in a scratch copy of the repository, so the
 *    real tree is never written.
 *
 * The marker lines in the oracles are typed out here, not built from the module under test.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { extractIrisTokens } from "../../../../scripts/lib/validate-prompts-core.mjs";
import {
  agentsMdMarkers,
  ALWAYS_ON_RULE_FILENAME,
  assemblePack,
  PACK_DIR,
  PACK_SOURCE_DIR,
  NOTICE_FILENAME,
  renderAgentsMdSection,
  RULE_FORM_DIRS,
  RULE_SOURCE_NAME,
  RULES_SOURCE_DIR,
  WORKFLOW_SKILLS_DIR,
} from "../../../../scripts/lib/skills-pack.mjs";
import { makeTempRoot, put, removeTempRoot, REPO_ROOT } from "./pack-fixture";
import { BOM, makeScratchRepo, removeScratchRepo, runScript, toCrlf, treeLines } from "./story-41-1-qa-fixture";

const GEN_PACK = "scripts/gen-pack.mjs";
const BEGIN_LINE = "<!-- IRIS-MCP-RULE:iris-mcp-objectscript-pre-write:BEGIN -->";
const END_LINE = "<!-- IRIS-MCP-RULE:iris-mcp-objectscript-pre-write:END -->";

// ---------------------------------------------------------------------------------------------------------
// The rule text's own checks, as functions, so a negative control can prove each one is able to fail.
// ---------------------------------------------------------------------------------------------------------

/** Whitespace-separated tokens that hold at least one letter or digit (a bare "-" bullet marker is no word). */
function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => /[A-Za-z0-9]/.test(word)).length;
}

/** The internal references an agent-facing rule must never carry, by the name each one is reported under. */
const INTERNAL_REFERENCES: Array<[string, RegExp]> = [
  ["an internal rule number", /\bRule #\d+/i],
  ["a deferred-work id", /\bDW-\d+/],
  ["an architecture-decision id", /\bAD-\d+/],
  ["a packages/ path", /packages\//],
  ["a src/ path", /src\//],
  ["a .claude/ path", /\.claude\//],
  ["a _bmad path", /_bmad/],
  ["a project class", /ExecuteMCPv2/],
  ["a project helper", /SanitizeError/],
];

function internalReferences(text: string): string[] {
  return INTERNAL_REFERENCES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

/** Every reason the text is not an acceptable rule body, or an empty list. */
function contentProblems(text: string): string[] {
  const problems = internalReferences(text);
  const tokens = extractIrisTokens(text) as string[];
  if (tokens.length > 0) problems.push(`a tool name: ${tokens.join(", ")}`);
  const words = wordCount(text);
  if (words > 300) problems.push(`${words} words, over the 300-word budget`);
  return problems;
}

/** One anchor per bullet, in bullet order: the phrase that ties the bullet to its row of the probe log. */
const PROBE_ANCHORS = [
  "`$$OK` calls a label",
  "column 1",
  "concatenation operator",
  '"max_results"',
  "`Return value`",
  "leaves only the `Catch` block",
  "`ERROR #5001: `",
  "<INVALID CLASS>",
  "<CLASS DOES NOT EXIST>",
  "ReDirectIO(0)",
  "`Storage` block",
  "`{ }` body",
  "$$$AssertNotTrue",
  "start with `Test`",
  "##super(initvalue)",
  "reports 0",
];

// ---------------------------------------------------------------------------------------------------------
// The real tree.
// ---------------------------------------------------------------------------------------------------------

describe("the always-on rule, real tree: the committed forms against the source (AC 41.2.3)", () => {
  const source = readFileSync(join(REPO_ROOT, RULES_SOURCE_DIR, ALWAYS_ON_RULE_FILENAME));
  const claudeCode = readFileSync(join(REPO_ROOT, PACK_DIR, RULE_FORM_DIRS.claudeCode, ALWAYS_ON_RULE_FILENAME));
  const agentsMd = readFileSync(join(REPO_ROOT, PACK_DIR, RULE_FORM_DIRS.agentsMd, ALWAYS_ON_RULE_FILENAME));

  it("the claude-code form equals the source bytes", () => {
    expect(claudeCode.equals(source)).toBe(true);
  });

  it("the agents-md form is the BEGIN line, the source bytes and the END line, each line ending in LF", () => {
    const expected = Buffer.concat([Buffer.from(`${BEGIN_LINE}\n`, "utf8"), source, Buffer.from(`${END_LINE}\n`, "utf8")]);
    expect(agentsMd.equals(expected)).toBe(true);
    const lines = agentsMd.toString("utf8").split("\n");
    expect(lines[0]).toBe(BEGIN_LINE);
    expect(lines[lines.length - 2]).toBe(END_LINE);
    expect(lines[lines.length - 1]).toBe("");
  });

  it("neither form starts with frontmatter, and no line of either is a paths: key", () => {
    // The agents-md form opens with its BEGIN marker line, so its frontmatter would follow that line.
    for (const [label, bytes, markerLines] of [
      ["source", source, 0],
      ["claude-code", claudeCode, 0],
      ["agents-md", agentsMd, 1],
    ] as const) {
      const text = bytes.toString("utf8").split("\n").slice(markerLines).join("\n");
      expect(text.startsWith("---"), `${label} starts with ---`).toBe(false);
      expect(/^paths\s*:/m.test(text), `${label} holds a paths: key`).toBe(false);
    }
  });

  it("assemblePack renders exactly these two forms from the source", () => {
    const root = makeTempRoot("rule-real-tree");
    try {
      put(root, `${PACK_SOURCE_DIR}/${NOTICE_FILENAME}`, "# notice\n");
      put(root, `${RULES_SOURCE_DIR}/${ALWAYS_ON_RULE_FILENAME}`, source);
      const pack = assemblePack(root) as Map<string, Buffer>;
      expect((pack.get(`${RULE_FORM_DIRS.claudeCode}/${ALWAYS_ON_RULE_FILENAME}`) as Buffer).equals(claudeCode)).toBe(true);
      expect((pack.get(`${RULE_FORM_DIRS.agentsMd}/${ALWAYS_ON_RULE_FILENAME}`) as Buffer).equals(agentsMd)).toBe(true);
    } finally {
      removeTempRoot(root);
    }
  });
});

describe("the always-on rule, real tree: the checklist content (AC 41.2.1)", () => {
  const sourceBytes = readFileSync(join(REPO_ROOT, RULES_SOURCE_DIR, ALWAYS_ON_RULE_FILENAME));
  const text = sourceBytes.toString("utf8");
  const bullets = text.split("\n").filter((line) => line.startsWith("- "));

  it("is ASCII, LF only, and ends in exactly one LF", () => {
    expect(sourceBytes.every((byte) => byte < 0x80), "every byte is ASCII").toBe(true);
    expect(text.includes("\r"), "no CR").toBe(false);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("has no problem a reader of the text would meet: within 300 words, no internal reference, no tool name", () => {
    expect(wordCount(text)).toBeGreaterThan(0);
    expect(contentProblems(text)).toEqual([]);
  });

  it("has exactly 16 bullets, and bullet n carries probe anchor n", () => {
    expect(bullets).toHaveLength(16);
    expect(PROBE_ANCHORS).toHaveLength(16);
    PROBE_ANCHORS.forEach((anchor, index) => {
      expect(bullets[index], `bullet ${index + 1} holds ${anchor}`).toContain(anchor);
    });
  });

  it("keeps the IRIS error code ERROR #5001, which is no internal rule number", () => {
    expect(text).toContain("ERROR #5001");
    expect(internalReferences(text)).toEqual([]);
  });
});

describe("the content checks can fail (negative controls)", () => {
  const body = "- A bullet that is fine.\n";

  it.each([
    ["an internal rule number", "see Rule #7", "an internal rule number"],
    ["a lower-case rule number", "see rule #12", "an internal rule number"],
    ["a deferred-work id", "tracked as DW-1", "a deferred-work id"],
    ["an architecture-decision id", "see AD-28", "an architecture-decision id"],
    ["a packages/ path", "in packages/shared", "a packages/ path"],
    ["a src/ path", "in src/prompts", "a src/ path"],
    ["a .claude/ path", "in .claude/rules", "a .claude/ path"],
    ["a _bmad path", "in _bmad/custom", "a _bmad path"],
    ["a project class", "call ExecuteMCPv2.Utils", "a project class"],
    ["a project helper", "use SanitizeError", "a project helper"],
    ["a tool name", "call `iris_doc_put`", "a tool name: iris_doc_put"],
  ])("flags %s", (_name, addition, reported) => {
    expect(contentProblems(`${body}${addition}\n`)).toContain(reported);
  });

  it("flags a text of 301 words and accepts one of 300", () => {
    const words = (count: number): string => Array.from({ length: count }, () => "word").join(" ");
    expect(contentProblems(words(300))).toEqual([]);
    expect(contentProblems(words(301))).toEqual(["301 words, over the 300-word budget"]);
  });

  it("does not count a bare bullet marker as a word", () => {
    expect(wordCount("- one\n- two\n")).toBe(2);
  });

  it("accepts the IRIS error code ERROR #5001", () => {
    expect(contentProblems("- Strip `ERROR #5001: ` first.\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Fixture roots, through assemblePack.
// ---------------------------------------------------------------------------------------------------------

const roots: string[] = [];
function tempRoot(): string {
  const root = makeTempRoot("skills-pack-rule");
  roots.push(root);
  put(root, `${PACK_SOURCE_DIR}/${NOTICE_FILENAME}`, "# notice\n");
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) removeTempRoot(root);
});

/** The section the source bytes must produce, built here from typed-out marker lines. */
function sectionOf(stem: string, source: Buffer): Buffer {
  const endsInLineFeed = source.length > 0 && source[source.length - 1] === 0x0a;
  return Buffer.concat([
    Buffer.from(`<!-- IRIS-MCP-RULE:${stem}:BEGIN -->\n`, "utf8"),
    source,
    Buffer.from(`${endsInLineFeed ? "" : "\n"}<!-- IRIS-MCP-RULE:${stem}:END -->\n`, "utf8"),
  ]);
}

/** Frontmatter-free byte variants (project rule #58): none is canonical LF text except the first. */
const BYTE_VARIANTS: Array<[string, Buffer]> = [
  ["lf", Buffer.from("## Title\n\n- one\n", "utf8")],
  ["no-final-newline", Buffer.from("no final newline", "utf8")],
  ["crlf", Buffer.from("line one\r\nline two\r\n", "utf8")],
  ["crlf-without-final-lf", Buffer.from("line one\r\nline two\r", "utf8")],
  ["bom", Buffer.concat([BOM, Buffer.from("body\n", "utf8")])],
  ["comment-inside", Buffer.from("<!-- a note -->\ntext\n<!-- another -->\n", "utf8")],
  // "cafe" with the precomposed e-acute, an em dash, a copyright sign and an emoji, as raw UTF-8 bytes.
  ["non-ascii", Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9, 0x20, 0xe2, 0x80, 0x94, 0x20, 0xc2, 0xa9, 0x20, 0xf0, 0x9f, 0x98, 0x80, 0x0a])],
  ["invalid-utf8", Buffer.from([0x61, 0xff, 0xfe, 0x62, 0x0a])],
];

describe("the section form (fixture roots)", () => {
  it("wraps the source in the two marker lines, with the rule's stem inside them", () => {
    expect(agentsMdMarkers("my-rule")).toEqual({
      begin: "<!-- IRIS-MCP-RULE:my-rule:BEGIN -->",
      end: "<!-- IRIS-MCP-RULE:my-rule:END -->",
    });
    expect(renderAgentsMdSection("r", Buffer.from("one\ntwo\n")).toString("utf8")).toBe(
      "<!-- IRIS-MCP-RULE:r:BEGIN -->\none\ntwo\n<!-- IRIS-MCP-RULE:r:END -->\n",
    );
  });

  it("puts one LF between a source without a final LF and the END line", () => {
    expect(renderAgentsMdSection("r", Buffer.from("one")).toString("utf8")).toBe(
      "<!-- IRIS-MCP-RULE:r:BEGIN -->\none\n<!-- IRIS-MCP-RULE:r:END -->\n",
    );
  });

  it("assemblePack emits the typed-out section and the source bytes for a plain rule and for one without a final LF", () => {
    const root = tempRoot();
    put(root, `${RULES_SOURCE_DIR}/plain.md`, "one\ntwo\n");
    put(root, `${RULES_SOURCE_DIR}/bare.md`, "one");
    const pack = assemblePack(root) as Map<string, Buffer>;
    expect(pack.get(`${RULE_FORM_DIRS.claudeCode}/plain.md`)?.toString("utf8")).toBe("one\ntwo\n");
    expect(pack.get(`${RULE_FORM_DIRS.agentsMd}/plain.md`)?.toString("utf8")).toBe(
      "<!-- IRIS-MCP-RULE:plain:BEGIN -->\none\ntwo\n<!-- IRIS-MCP-RULE:plain:END -->\n",
    );
    expect(pack.get(`${RULE_FORM_DIRS.claudeCode}/bare.md`)?.toString("utf8")).toBe("one");
    expect(pack.get(`${RULE_FORM_DIRS.agentsMd}/bare.md`)?.toString("utf8")).toBe(
      "<!-- IRIS-MCP-RULE:bare:BEGIN -->\none\n<!-- IRIS-MCP-RULE:bare:END -->\n",
    );
  });

  it.each(BYTE_VARIANTS)("keeps the %s variant byte for byte in both forms", (key, bytes) => {
    const root = tempRoot();
    put(root, `${RULES_SOURCE_DIR}/${key}.md`, bytes);
    const pack = assemblePack(root) as Map<string, Buffer>;
    const claudeCode = pack.get(`${RULE_FORM_DIRS.claudeCode}/${key}.md`);
    const agentsMd = pack.get(`${RULE_FORM_DIRS.agentsMd}/${key}.md`);
    expect(Buffer.isBuffer(claudeCode) && claudeCode.equals(bytes), "the claude-code form is the source bytes").toBe(true);
    expect(Buffer.isBuffer(agentsMd) && agentsMd.equals(sectionOf(key, bytes)), "the agents-md form wraps the source bytes").toBe(true);
  });

  it("a CRLF source keeps its CRLF line endings between the marker lines, which end in LF", () => {
    const root = tempRoot();
    const crlf = toCrlf(Buffer.from("line one\nline two\n", "utf8"));
    put(root, `${RULES_SOURCE_DIR}/crlf-rule.md`, crlf);
    const section = (assemblePack(root) as Map<string, Buffer>).get(`${RULE_FORM_DIRS.agentsMd}/crlf-rule.md`) as Buffer;
    expect(section.toString("utf8")).toBe(
      "<!-- IRIS-MCP-RULE:crlf-rule:BEGIN -->\nline one\r\nline two\r\n<!-- IRIS-MCP-RULE:crlf-rule:END -->\n",
    );
  });
});

/** Rule sources that open with frontmatter, in the spellings a hand edit or an editor can produce. */
const FRONTMATTER_SOURCES: Array<[string, Buffer]> = [
  ["a paths: block", Buffer.from('---\npaths:\n  - "**/*.cls"\n---\nbody\n', "utf8")],
  ["an inline paths: list", Buffer.from('---\npaths: ["**/*.cls"]\n---\nbody\n', "utf8")],
  ["CRLF line endings", Buffer.from("---\r\nname: x\r\n---\r\nbody\r\n", "utf8")],
  ["a BOM before the opener", Buffer.concat([BOM, Buffer.from("---\nname: x\n---\nbody\n", "utf8")])],
  ["trailing blanks after the opener", Buffer.from("---  \t\nname: x\n---\nbody\n", "utf8")],
  ["an unterminated opener", Buffer.from("---\nbody without a closing line\n", "utf8")],
  ["an opener and nothing else", Buffer.from("---", "utf8")],
];

/** Sources that merely look like frontmatter and must pass. */
const NOT_FRONTMATTER_SOURCES: Array<[string, Buffer]> = [
  ["a four-dash line", Buffer.from("----\nbody\n", "utf8")],
  ["a dash line with text after it", Buffer.from("--- not a delimiter\nbody\n", "utf8")],
  ["an indented dash line", Buffer.from(" ---\nbody\n", "utf8")],
  ["a horizontal rule after the first line", Buffer.from("title\n---\nbody\n", "utf8")],
];

describe("the frontmatter refusal (fixture roots)", () => {
  it.each(FRONTMATTER_SOURCES)("refuses a rule source with %s, naming the file and the reason", (_name, bytes) => {
    const root = tempRoot();
    put(root, `${RULES_SOURCE_DIR}/scoped.md`, bytes);
    expect(() => assemblePack(root)).toThrowError(
      `${RULES_SOURCE_DIR}/scoped.md has frontmatter; an always-on rule takes none (no paths:)`,
    );
  });

  it.each(NOT_FRONTMATTER_SOURCES)("accepts a rule source with %s", (_name, bytes) => {
    const root = tempRoot();
    put(root, `${RULES_SOURCE_DIR}/plain.md`, bytes);
    const pack = assemblePack(root) as Map<string, Buffer>;
    expect((pack.get(`${RULE_FORM_DIRS.claudeCode}/plain.md`) as Buffer).equals(bytes)).toBe(true);
  });
});

/** Entries of `rules/` that are not flat `<name>.md` files, with the name the refusal must report. */
const UNKNOWN_ENTRIES: Array<[string, string, string | Buffer, string]> = [
  ["a subdirectory", "nested/form.md", "rule\n", "nested"],
  ["a non-Markdown file", "notes.txt", "x\n", "notes.txt"],
  ["a name with upper-case letters", "Upper.md", "x\n", "Upper.md"],
  ["a name with an underscore", "snake_case.md", "x\n", "snake_case.md"],
  ["a name with a doubled hyphen", "double--hyphen.md", "x\n", "double--hyphen.md"],
  ["a name that starts with a hyphen", "-lead.md", "x\n", "-lead.md"],
  ["a name that ends with a hyphen", "trail-.md", "x\n", "trail-.md"],
  ["an upper-case extension", "shout.MD", "x\n", "shout.MD"],
  ["a hidden file", ".DS_Store", "x", ".DS_Store"],
];

describe("the unknown-entry refusal (fixture roots)", () => {
  it.each(UNKNOWN_ENTRIES)("refuses %s, naming it", (_name, rel, content, reported) => {
    const root = tempRoot();
    put(root, `${RULES_SOURCE_DIR}/good-rule.md`, "rule\n");
    put(root, `${RULES_SOURCE_DIR}/${rel}`, content);
    expect(() => assemblePack(root)).toThrowError(reported);
  });

  it.each([
    "a.md",
    "iris-mcp-objectscript-pre-write.md",
    "rule-2.md",
    "2fa.md",
  ])("accepts the rule name %s", (name) => {
    expect(RULE_SOURCE_NAME.test(name)).toBe(true);
    const root = tempRoot();
    put(root, `${RULES_SOURCE_DIR}/${name}`, "rule\n");
    expect((assemblePack(root) as Map<string, Buffer>).has(`${RULE_FORM_DIRS.claudeCode}/${name}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The real CLI, in a scratch copy of the repository.
// ---------------------------------------------------------------------------------------------------------

describe("gen:pack, the rule rows through the real CLI (scratch copy)", () => {
  let scratch = "";
  beforeAll(() => {
    scratch = makeScratchRepo();
  });
  afterAll(() => {
    removeScratchRepo(scratch);
  });

  const ruleSource = (name: string): string => join(scratch, RULES_SOURCE_DIR, name);
  const packed = (form: string, name: string): string => join(scratch, PACK_DIR, form, name);

  it("a second run of the real tree changes nothing, and --check reports every pack file", () => {
    const before = treeLines(scratch);
    const run = runScript(scratch, GEN_PACK);
    expect(run.status, run.stderr).toBe(0);
    expect(treeLines(scratch)).toEqual(before);
    const check = runScript(scratch, GEN_PACK, ["--check"]);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain("16 pack file(s) match their sources");
  });

  it("writes both forms of every byte variant, byte for byte, and a second run changes nothing", () => {
    for (const [key, bytes] of BYTE_VARIANTS) put(scratch, `${RULES_SOURCE_DIR}/cli-${key}.md`, bytes);
    try {
      const first = runScript(scratch, GEN_PACK);
      expect(first.status, first.stderr).toBe(0);
      for (const [key, bytes] of BYTE_VARIANTS) {
        const name = `cli-${key}.md`;
        expect(readFileSync(packed(RULE_FORM_DIRS.claudeCode, name)).equals(bytes), `${key}: claude-code form`).toBe(true);
        expect(readFileSync(packed(RULE_FORM_DIRS.agentsMd, name)).equals(sectionOf(`cli-${key}`, bytes)), `${key}: agents-md form`).toBe(
          true,
        );
      }
      const written = treeLines(scratch);
      const second = runScript(scratch, GEN_PACK);
      expect(second.status, second.stderr).toBe(0);
      expect(treeLines(scratch), "the second run changed nothing").toEqual(written);
      expect(runScript(scratch, GEN_PACK, ["--check"]).status).toBe(0);
    } finally {
      for (const [key] of BYTE_VARIANTS) rmSync(ruleSource(`cli-${key}.md`), { force: true });
      expect(runScript(scratch, GEN_PACK).status).toBe(0);
    }
  });

  it("a CRLF copy of the real rule keeps its line endings in both forms", () => {
    const real = readFileSync(join(REPO_ROOT, RULES_SOURCE_DIR, ALWAYS_ON_RULE_FILENAME));
    const crlf = toCrlf(real);
    put(scratch, `${RULES_SOURCE_DIR}/cli-crlf-copy.md`, crlf);
    try {
      expect(runScript(scratch, GEN_PACK).status).toBe(0);
      expect(readFileSync(packed(RULE_FORM_DIRS.claudeCode, "cli-crlf-copy.md")).equals(crlf)).toBe(true);
      expect(readFileSync(packed(RULE_FORM_DIRS.agentsMd, "cli-crlf-copy.md")).equals(sectionOf("cli-crlf-copy", crlf))).toBe(true);
    } finally {
      rmSync(ruleSource("cli-crlf-copy.md"), { force: true });
      expect(runScript(scratch, GEN_PACK).status).toBe(0);
    }
  });

  it.each(FRONTMATTER_SOURCES)("exits 1 on a rule source with %s, names the file, and writes nothing", (_name, bytes) => {
    put(scratch, `${RULES_SOURCE_DIR}/cli-scoped.md`, bytes);
    try {
      const before = treeLines(scratch);
      for (const args of [[], ["--check"]]) {
        const run = runScript(scratch, GEN_PACK, args);
        expect(run.status, `gen-pack ${args.join(" ")}`).toBe(1);
        expect(run.stderr).toContain(`${RULES_SOURCE_DIR}/cli-scoped.md has frontmatter; an always-on rule takes none (no paths:)`);
      }
      expect(treeLines(scratch), "nothing was written").toEqual(before);
    } finally {
      rmSync(ruleSource("cli-scoped.md"), { force: true });
    }
  });

  it.each(UNKNOWN_ENTRIES)("exits 1 on %s in rules/, names it, and writes nothing", (_name, rel, content, reported) => {
    put(scratch, `${RULES_SOURCE_DIR}/${rel}`, content);
    try {
      const before = treeLines(scratch);
      for (const args of [[], ["--check"]]) {
        const run = runScript(scratch, GEN_PACK, args);
        expect(run.status, `gen-pack ${args.join(" ")}`).toBe(1);
        expect(run.stderr).toContain(reported);
      }
      expect(treeLines(scratch), "nothing was written").toEqual(before);
    } finally {
      rmSync(ruleSource(rel.split("/")[0] ?? rel), { recursive: true, force: true });
    }
  });

  it("is clean again after the refusals: the scratch tree equals the committed pack", () => {
    expect(runScript(scratch, GEN_PACK, ["--check"]).status).toBe(0);
    expect(existsSync(ruleSource(ALWAYS_ON_RULE_FILENAME))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The retirement of the prompt whose checklist this rule replaces (AC 41.2.2).
// ---------------------------------------------------------------------------------------------------------

describe("the retired objectscript-review prompt leaves no generated copy behind (AC 41.2.2)", () => {
  it("neither generated skill directory exists", () => {
    expect(existsSync(join(REPO_ROOT, WORKFLOW_SKILLS_DIR, "objectscript-review"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, PACK_DIR, "skills", "objectscript-review"))).toBe(false);
  });

  it("skills/README.md lists 12 skills and none is the retired one", () => {
    const readme = readFileSync(join(REPO_ROOT, WORKFLOW_SKILLS_DIR, "README.md"), "utf8");
    const rows = readme.split("\n").filter((line) => /^\| `[a-z0-9-]+` \|/.test(line));
    expect(rows).toHaveLength(12);
    expect(readme).not.toContain("objectscript-review");
  });

  it("the dev package has neither the prompt source nor a built file of it", () => {
    expect(existsSync(join(REPO_ROOT, "packages", "iris-dev-mcp", "src", "prompts", "objectscriptReview.ts"))).toBe(false);
    const built = readdirSync(join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "prompts")).filter((file) =>
      file.startsWith("objectscriptReview"),
    );
    expect(built, "a stale build output would ship in the npm tarball").toEqual([]);
  });
});
