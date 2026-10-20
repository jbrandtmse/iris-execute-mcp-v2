/**
 * Story 41.2 -- the documents state that the `objectscript-review` prompt was retired and that its checklist is now the
 * always-on rule in the skills pack (AC 41.2.2), and nothing still presents the prompt as available (project rules #30
 * and #43).
 *
 * The unit and wire suites pin the behavior; none reads a document. This file asserts:
 *
 *  - the CHANGELOG's Story 41.2 section: its exact title and four headings, the counts that do not move, and a
 *    `### Removed` entry that names the retired prompt, Story 41.2, AD-15 and the reason;
 *  - the changeset's exact bump map (AD-29);
 *  - the root README and the dev README: the retirement sentence, and no table row for the retired prompt;
 *  - `tool_support.md`: the retirement note and the prompt tally;
 *  - a sweep of the documents, `docs/`, `scripts/`, `ipm/`, `extensions/`, the pending changesets, the generated
 *    skills, the pack, the pack sources, and each package's sources, scripts and `package.json` (tests excluded) in
 *    which the prompt's name appears only in those retirement notes. AC 41.2.2 leaves out the older CHANGELOG sections
 *    and `.changeset/epic35-defect-gate.md`; this story's own changeset and CHANGELOG section are retirement notes.
 *
 * Needs no IRIS and no built dist: it reads documents and sources. Cross-package documentation checks live in
 * `@iris-mcp/all` (rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const RETIRED = "objectscript-review";

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const squash = (text: string): string => text.replace(/\s+/g, " ");

/** The sections of a CHANGELOG, each starting at its `## [` heading. */
function sectionsOf(changelog: string): string[] {
  return changelog.split(/^(?=## \[)/m).slice(1);
}

const RETIREMENT_SENTENCE =
  "`objectscript-review` was retired in Story 41.2: its checklist is now the always-on rule in the skills pack, " +
  "which `iris-mcp-clients skills install` puts where each client loads it (`.claude/rules/` for Claude Code, " +
  "`.cursor/rules/` for Cursor, a marked block in `GEMINI.md` for Gemini CLI and in `AGENTS.md` for every other client).";

/** The one place besides the two READMEs that may name the retired prompt: the prompt tally paragraph of tool_support.md. */
const TOOL_SUPPORT_NOTE = "`dev` lost `objectscript-review` in Story 41.2: its checklist is now the always-on rule in the skills pack";

const CHANGELOG_TITLE = /^## \[Pre-release . 2026-10-19\] . Story 41\.2: Always-on ObjectScript pre-write rule$/;

describe("Story 41.2: the CHANGELOG section and the changeset", () => {
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";

  it("the CHANGELOG has the Story 41.2 section above the Story 41.1 one, with Added, Removed, Tests and Known limits headings", () => {
    expect(section, "the CHANGELOG has the Story 41.2 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual([
      "### Added",
      "### Removed",
      "### Tests",
      "### Known limits",
    ]);
    const index = sections.indexOf(section);
    const previous = sections.findIndex((candidate) => (candidate.split("\n")[0] ?? "").includes("Story 41.1:"));
    expect(previous, "the CHANGELOG still has the Story 41.1 section").toBeGreaterThanOrEqual(0);
    expect(index, "newest section first").toBeLessThan(previous);
  });

  it("states that no tool, count, baseline or bootstrap version moves, and that the prompt pack goes from 13 to 12", () => {
    const text = squash(section);
    expect(text).toContain("the suite stays at 110 package tools, 115 advertised");
    expect(text).toContain("hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain("`BOOTSTRAP_VERSION` stays at `5296a1c836f4`");
    expect(text).toContain("The prompt pack goes from 13 prompts to 12 (the Development server from 5 to 4)");
  });

  it("Removed names the retired prompt, Story 41.2, the AD-15 sanction and the reason", () => {
    const removed = squash(/### Removed\n([\s\S]*?)(?=\n### |$)/.exec(section)?.[1] ?? "");
    expect(removed, "the Removed block").not.toBe("");
    expect(removed).toContain("`objectscript-review` prompt");
    expect(removed).toContain("Story 41.2");
    expect(removed).toContain("AD-15");
    expect(removed).toContain("the rule above is the one copy of the checklist");
    expect(removed).toContain("`prompts/get` for it answers InvalidParams (-32602)");
  });

  // `changeset version` consumes (deletes) the file and moves its text into the generated package
  // changelogs, so the bumps are checked while the file exists.
  const changesetPath = ".changeset/story-41-2-objectscript-pre-write-rule.md";
  const changesetPresent = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!changesetPresent)("the changeset bumps exactly dev and client-config minor (AD-29) and says what the story does", () => {
    const changeset = read(changesetPath);
    const frontMatter = /^---\n([\s\S]*?)\n---/.exec(changeset)?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontMatter
        .split("\n")
        .map((line) => /^"([^"]+)":\s*(\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1], match[2]]),
    );
    expect(bumps).toEqual({ "@iris-mcp/dev": "minor", "@iris-mcp/client-config": "minor" });
    expect(frontMatter.split("\n").filter((line) => line.trim() !== "")).toHaveLength(2);
    const text = squash(changeset);
    expect(text).toContain("`@iris-mcp/dev` no longer registers the `objectscript-review` prompt");
    expect(text).toContain("`rules/claude-code/iris-mcp-objectscript-pre-write.md`");
    expect(text).toContain("`rules/agents-md/iris-mcp-objectscript-pre-write.md`");
    expect(text).toContain("No tool, action, governance key, preset, refusal code, route or bootstrapped class changes.");
  });
});

describe("Story 41.2: the retired prompt is documented only as retired", () => {
  const rootReadme = read("README.md");
  const devReadme = read("packages/iris-dev-mcp/README.md");

  it.each([
    ["the root README", rootReadme],
    ["the dev README", devReadme],
  ])("%s carries the retirement sentence and no table row for the retired prompt", (_name, readme) => {
    expect(readme.split("\n"), "the retirement sentence, as a line of its own").toContain(RETIREMENT_SENTENCE);
    const rows = readme.split("\n").filter((line) => line.startsWith("|") && line.includes(RETIRED));
    expect(rows, "a table row that lists the retired prompt").toEqual([]);
  });

  it("tool_support.md records the retirement in its prompt tally paragraph", () => {
    const toolSupport = squash(read("tool_support.md"));
    expect(toolSupport).toContain(TOOL_SUPPORT_NOTE);
    expect(toolSupport).toContain("a pack of 12 **MCP prompts** (`ops` 2, `dev` 4, `interop` 4, `admin` 2; `data` none in v1)");
  });

  it("the prompt's name appears in the documents, the generated skills, the pack and the package sources only in the retirement notes", () => {
    const hits: string[] = [];

    const scan = (relative: string): void => {
      const lines = read(relative).split("\n");
      lines.forEach((line, index) => {
        // The tool_support.md note sits inside a one-line paragraph, so only the note's own text is exempt.
        const rest = line === RETIREMENT_SENTENCE ? "" : relative === "tool_support.md" ? line.replace(TOOL_SUPPORT_NOTE, "") : line;
        if (rest.includes(RETIRED)) hits.push(`${relative}:${index + 1}`);
      });
    };

    const walk = (relativeDir: string, skip: (name: string) => boolean): void => {
      const absolute = path.join(REPO_ROOT, relativeDir);
      if (!existsSync(absolute)) return;
      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist" || skip(entry.name)) continue;
        const relative = `${relativeDir}/${entry.name}`;
        if (entry.isDirectory()) walk(relative, skip);
        else if (entry.isFile() && /\.(md|ts|mts|mjs|json|xml)$/.test(entry.name)) scan(relative);
      }
    };

    for (const file of ["README.md", "tool_support.md", "package.json"]) scan(file);
    const packages = readdirSync(path.join(REPO_ROOT, "packages"), { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const entry of packages) {
      for (const file of ["README.md", "package.json"]) {
        if (existsSync(path.join(REPO_ROOT, "packages", entry.name, file))) scan(`packages/${entry.name}/${file}`);
      }
      walk(`packages/${entry.name}/src`, (name) => name === "__tests__");
      walk(`packages/${entry.name}/scripts`, () => false);
    }
    for (const dir of ["skills", "packages/client-config/skills-pack", "skills-pack-src", "docs", "scripts", "ipm"]) walk(dir, () => false);
    walk("extensions", (name) => name === "__tests__");
    walk(".changeset", (name) => name === "epic35-defect-gate.md" || name === "story-41-2-objectscript-pre-write-rule.md");

    expect(hits, "a place that still names the retired prompt").toEqual([]);
  });
});
