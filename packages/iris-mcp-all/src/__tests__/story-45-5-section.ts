/**
 * Story 45.5 -- the README section "What the safety settings protect" as a test reads it, and the oracles its sentences
 * are checked against. Shared by `story-45-5-doc-claims.test.ts` and `epic45-capstone-gate.test.ts` (one parser, so the
 * two tests cannot disagree about what the section says).
 *
 * Not a test file. The oracles are the BUILT dists of `@iris-mcp/shared` (the declared block keys, the embed, the
 * warning text): a caller makes sure the dist is fresh first (`staleDistReason`).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT } from "./pack-fixture";

/** The section's title: the text the startup warning quotes, and the `## ` heading of the README. */
export const SECTION_TITLE = "What the safety settings protect";

/** The anchor every link to the section uses. */
export const SECTION_SLUG = "what-the-safety-settings-protect";

export const squash = (text: string): string => text.replace(/\s+/g, " ");

export const readRepo = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");

/** The README of the repository root. */
export const README = readRepo("README.md");

/**
 * The text of the section: from its `## ` heading up to the rule that ends it. Empty when the heading is missing, which
 * a caller turns into a failed assertion (an empty section would otherwise pass every `not.toContain`).
 */
export function sectionOf(readme: string = README): string {
  const start = readme.indexOf(`\n## ${SECTION_TITLE}\n`);
  if (start < 0) return "";
  const end = readme.indexOf("\n---\n", start + 1);
  return readme.slice(start + 1, end < 0 ? undefined : end);
}

/** The paragraph (a block between blank lines) that starts with `prefix`, whitespace squashed; `""` when there is none. */
export function paragraphStarting(section: string, prefix: string): string {
  const found = section.split(/\n\s*\n/).find((block) => block.trimStart().startsWith(prefix));
  return found === undefined ? "" : squash(found).trim();
}

/** Every backticked token of `text`, in order. */
export function backtickTokens(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);
}

/** A governance key as the section names it: a tool name, optionally with `:action`. */
const GOVERNANCE_KEY = /^iris_[a-z_]+(?::[a-z]+)?$/;

/** The governance keys the paragraph "What `block` turns off here." names, in order. */
export function blockListInReadme(section: string = sectionOf()): string[] {
  return backtickTokens(paragraphStarting(section, "**What `block` turns off here.**")).filter((token) => GOVERNANCE_KEY.test(token));
}

/** The tool names the paragraph "What the data policy covers." says `redact` does not cover (the Event Log text's tool included). */
export function notCoveredInReadme(section: string = sectionOf()): string[] {
  const paragraph = paragraphStarting(section, "**What the data policy covers.**");
  // The sentence that lists them: "It does not cover, among others, A, B, C or the Event Log text of `D`, ...".
  const sentence = /It does not cover, among others,(.*?)\. The \[scope table\]/.exec(paragraph)?.[1] ?? "";
  return backtickTokens(sentence).filter((token) => GOVERNANCE_KEY.test(token));
}

/** The five methods the paragraph "The five setup procedures." says SQL can call, in order. */
export function proceduresInReadme(section: string = sectionOf()): string[] {
  const paragraph = paragraphStarting(section, "**The five setup procedures.**");
  const sentence = /SQL can call five methods of `ExecuteMCPv2\.Setup`:(.*?)\. `Uninstall`/.exec(paragraph)?.[1] ?? "";
  return backtickTokens(sentence);
}

/** The `[ SqlProc ]` methods of a class document, in source order. */
export function sqlProcMethods(classText: string): string[] {
  const names: string[] = [];
  for (const match of classText.matchAll(/^(?:Class)?Method (\w+)\([^\n]*\[[^\]\n]*\bSqlProc\b[^\]\n]*\]/gm)) names.push(match[1] as string);
  return names;
}

/** The names of the SQL-procedure methods of `ExecuteMCPv2.Setup`, from the embed of the built shared dist. */
export async function embeddedSetupProcedures(): Promise<string[]> {
  const { BOOTSTRAP_CLASSES } = await loadSharedDist<{ BOOTSTRAP_CLASSES: Map<string, string> }>("bootstrap-classes.js");
  const setup = BOOTSTRAP_CLASSES.get("ExecuteMCPv2.Setup.cls");
  if (setup === undefined) throw new Error("the embed holds no ExecuteMCPv2.Setup.cls");
  return sqlProcMethods(setup);
}

/** Import a module of the built shared dist. */
export async function loadSharedDist<T>(file: string): Promise<T> {
  return (await import(pathToFileURL(path.join(REPO_ROOT, "packages", "shared", "dist", file)).href)) as T;
}

/**
 * The names of the first column of the README's variable table: the rows of "### 2. Set Environment Variables" that start
 * with a backticked `IRIS_` or `MCP_` name. (A later table of refusal codes is not a variable table.)
 */
export function variableTableNames(readme: string = README): string[] {
  const names: string[] = [];
  const start = readme.indexOf("\n### 2. Set Environment Variables\n");
  const end = readme.indexOf("\n### 3. Configure Your MCP Client\n");
  if (start < 0 || end < start) return names;
  for (const line of readme.slice(start, end).split("\n")) {
    const match = /^\| `((?:IRIS|MCP)_[A-Z0-9_]+)` \|/.exec(line);
    if (match !== null) names.push(match[1] as string);
  }
  return [...new Set(names)];
}
