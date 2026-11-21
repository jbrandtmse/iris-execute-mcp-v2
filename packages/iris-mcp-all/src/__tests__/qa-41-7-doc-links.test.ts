/**
 * Every relative link and anchor in every reader document resolves (project rules #56 and #59; Story 41.7 QA, widened by Story 42.9, DW-632).
 *
 * `story-41-7-doc-claims.test.ts` pins the links that story ADDED. It does not pin the links the documents rely on that already
 * existed, so renaming a heading breaks every link to it and every suite stays green. This file closes that class: for each reader
 * document (`doc-set.ts`: every tracked or untracked-but-not-ignored `*.md` file outside the planning, agent and IRIS-source
 * folders, 83 files as of 2026-11-21), every `[text](target)` with a relative target must name an existing file or directory, and a
 * `#anchor` into a Markdown file must equal the GitHub-style slug of one of that file's headings. There are no known-broken entries.
 *
 * The checker is pure (text in, problems out) and has its own rows below that make it fail on a broken file link, on a broken
 * anchor and on a percent sign that is not an escape, so a green run means the checker could see a problem and found none. Reads
 * files only; needs no IRIS.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readerDocs } from "./doc-set";
import { markdownHeadingSlugs, REPO_ROOT } from "./pack-fixture";

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

/** A link's path with its percent escapes decoded; a percent sign that is not an escape (`%SYS`) stays as written. */
function decodedPath(filePart: string): string {
  try {
    return decodeURIComponent(filePart);
  } catch {
    return filePart;
  }
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
      const resolved = filePart === "" ? file : path.resolve(path.dirname(file), decodedPath(filePart));
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

describe("every reader document: every relative link and anchor resolves", () => {
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

  it("the checker keeps a percent sign that is not an escape, and finds the file it names", () => {
    const here = path.join(REPO_ROOT, "README.md");
    const { problems, checked } = brokenLinks("[a](irissys/%SYS/no-such.cls) [b](docs/client-config/README.md)", here, slugsOfFile);
    expect(checked).toBe(2);
    expect(problems.map((problem) => problem.target)).toEqual(["irissys/%SYS/no-such.cls"]);
  });

  const docs = readerDocs();

  it("the doc set holds the documents this story widened to", () => {
    expect(docs.length).toBeGreaterThanOrEqual(83);
    for (const rel of ["README.md", "tool_support.md", "docs/client-config/claude-code.md", "packages/shared/README.md", "docs/known-bugs-2026-04-20.md"]) {
      expect(docs, rel).toContain(rel);
    }
  });

  it("the doc set has relative links to check", () => {
    const total = docs.reduce((sum, rel) => sum + checkDoc(rel).checked, 0);
    expect(total).toBeGreaterThan(100);
  });

  for (const rel of docs) {
    it(`${rel}: no relative link is broken`, () => {
      const { problems } = checkDoc(rel);
      expect(
        problems.map((problem) => `${rel}:${problem.line} (${problem.target}) ${problem.problem}`),
        "broken links",
      ).toEqual([]);
    });
  }
});
