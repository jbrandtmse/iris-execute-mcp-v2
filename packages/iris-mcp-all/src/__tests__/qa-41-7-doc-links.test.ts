/**
 * Story 41.7 QA - every relative link and anchor in the documents this story changed resolves (project rules #56 and #59).
 *
 * `story-41-7-doc-claims.test.ts` pins the links the story ADDED (the `#the-skills-pack` links, the client-config
 * anchors, the catalog and the pointer). It does not pin the links the story relies on that already existed: the root
 * README's four links to `#workflow-prompts--agent-skills` (the spec says "keep that heading") are checked by no other
 * test, so renaming that heading breaks four links and every suite stays green. This file closes that class: for each
 * document in the list below, every `[text](target)` with a relative target must name an existing file or directory, and
 * a `#anchor` into a Markdown file must equal the GitHub-style slug of one of that file's headings.
 *
 * The list is exhaustive as of 2026-10-19: the documents in `git diff --name-only 49244c3..4046924` (Story 41.7's
 * baseline to its build commit) that are Markdown and carry a relative link. The other changed Markdown files carry none
 * (the generated catalog `packages/client-config/skills-pack/README.md` and the changeset). A document that a later story
 * changes, and that carries relative links, is added here by that story.
 *
 * The checker is pure (text in, problems out) and has its own rows below that make it fail on a broken file link and on a
 * broken anchor, so a green run means the checker could see a problem and found none. Reads files only; needs no IRIS.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { markdownHeadingSlugs, REPO_ROOT } from "./pack-fixture";

/** The documents Story 41.7 changed, relative to the repository root. */
const CHANGED_DOCS = [
  "README.md",
  "tool_support.md",
  "CHANGELOG.md",
  "skills/README.md",
  "packages/client-config/README.md",
  "packages/iris-admin-mcp/README.md",
  "packages/iris-dev-mcp/README.md",
  "packages/iris-interop-mcp/README.md",
  "packages/iris-ops-mcp/README.md",
  // Story 43.4 added the protocol-revision sections, which link to each other and to the root README.
  "docs/client-config/README.md",
  "docs/client-config/claude-code.md",
] as const;

/**
 * Broken links that a deferred-work entry owns, by document. The row of a document fails when one of these is fixed, so an entry cannot
 * outlive its defect. DW-631 (routed to Story 42.9): the anchor of the em-dash heading is `#read-only-mode--point-...`, with two hyphens.
 */
const KNOWN_BROKEN: Record<string, string[]> = {
  "docs/client-config/claude-code.md": ["../../README.md#read-only-mode-point-it-at-production-with-one-environment-variable"],
};

interface LinkProblem {
  line: number;
  target: string;
  problem: string;
}

const slugCache = new Map<string, Set<string>>();
function slugsOfFile(file: string): Set<string> {
  let slugs = slugCache.get(file);
  if (slugs === undefined) {
    slugs = markdownHeadingSlugs(readFileSync(file, "utf8"));
    slugCache.set(file, slugs);
  }
  return slugs;
}

/** Every relative `[text](target)` of `text` (a document at `file`) that names nothing real. */
function brokenLinks(text: string, file: string, slugsFor: (target: string) => Set<string>): { problems: LinkProblem[]; checked: number } {
  const problems: LinkProblem[] = [];
  let checked = 0;
  let fenced = false;
  text.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return;
    const visible = line.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));
    for (const match of visible.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1] as string;
      if (/^(https?:|mailto:)/i.test(target)) continue;
      checked += 1;
      const hash = target.indexOf("#");
      const filePart = hash < 0 ? target : target.slice(0, hash);
      const anchor = hash < 0 ? "" : target.slice(hash + 1);
      const resolved = filePart === "" ? file : path.resolve(path.dirname(file), decodeURIComponent(filePart));
      let problem: string | null = null;
      if (!existsSync(resolved)) problem = "no such file or directory";
      else if (anchor !== "") {
        if (statSync(resolved).isDirectory() || !/\.md$/i.test(resolved)) problem = "an anchor into something that is not a Markdown file";
        else if (!slugsFor(resolved).has(anchor)) problem = "no heading has this slug";
      }
      if (problem !== null) problems.push({ line: index + 1, target, problem });
    }
  });
  return { problems, checked };
}

function checkDoc(rel: string): { problems: LinkProblem[]; checked: number } {
  const file = path.join(REPO_ROOT, ...rel.split("/"));
  return brokenLinks(readFileSync(file, "utf8"), file, slugsOfFile);
}

describe("the documents Story 41.7 changed: every relative link and anchor resolves", () => {
  it("the checker sees a missing file and a missing anchor (it can fail)", () => {
    const here = path.join(REPO_ROOT, "README.md");
    const text = [
      "[ok](README.md) [file](no-such-file.md) [anchor](README.md#no-such-heading-anywhere) [web](https://example.com/x)",
      "`[ignored](also-missing.md)` in a code span",
      "```",
      "[ignored](also-missing.md) in a fence",
      "```",
    ].join("\n");
    const { problems, checked } = brokenLinks(text, here, slugsOfFile);
    expect(checked).toBe(3);
    expect(problems.map((problem) => problem.target)).toEqual(["no-such-file.md", "README.md#no-such-heading-anywhere"]);
    expect(slugsOfFile(here).has("workflow-prompts--agent-skills"), "the slug of 'Workflow Prompts & Agent Skills'").toBe(true);
    expect(
      slugsOfFile(here).has("read-only-mode--point-it-at-production-with-one-environment-variable"),
      "the slug of 'Read-only mode — point it at production ...' keeps two hyphens where the dash was",
    ).toBe(true);
  });

  for (const rel of CHANGED_DOCS) {
    it(`${rel}: no relative link is broken`, () => {
      const { problems, checked } = checkDoc(rel);
      const known = KNOWN_BROKEN[rel] ?? [];
      expect(checked, `${rel} has relative links to check`).toBeGreaterThan(0);
      expect(
        problems.filter((problem) => !known.includes(problem.target)).map((problem) => `${rel}:${problem.line} (${problem.target}) ${problem.problem}`),
        "broken links",
      ).toEqual([]);
      expect(
        problems.filter((problem) => known.includes(problem.target)).map((problem) => problem.target).sort(),
        "the known broken links are still broken; remove an entry of KNOWN_BROKEN once its link is fixed",
      ).toEqual([...known].sort());
    });
  }
});
