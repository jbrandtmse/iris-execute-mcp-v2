/**
 * Story 41.3 (AC 41.3.1, 41.3.2 and 41.3.3) - the three core knowledge skills, read as a user's agent will read them.
 *
 * `skills-pack-src/knowledge/<name>/SKILL.md` is the one source of each skill, and `gen:pack` copies it unchanged to
 * `packages/client-config/skills-pack/skills/<name>/SKILL.md`. These tests read the committed sources and pack copies;
 * they need no IRIS and no network. They pin:
 *  - the identity of each skill: the sha256 of its text, its exact name and description (typed out here, not derived
 *    from the file), a description that says when to use the skill, one file per directory, and a pack copy equal to
 *    the source;
 *  - the text: ASCII, LF, one final LF, within the size budget, naming no `iris_*` tool;
 *  - the wording: nothing of this repository, its planning or its tooling (the shared hygiene list, with two
 *    documented overrides), and no bullet copied from the always-on rule;
 *  - the evidence: one anchor phrase per claim that was run on a live instance, so a reworded claim must be run again;
 *  - the shape: the number of fenced code blocks, each of which was compiled as written.
 *
 * Every pattern is applied to sample text first, so a pattern that has stopped matching shows up as a failed negative
 * control rather than as a clean skill.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProvenanceRows, PROVENANCE_HEADER_ROW } from "../../../../scripts/lib/provenance-core.mjs";
import {
  ALWAYS_ON_RULE_FILENAME,
  KNOWLEDGE_SOURCE_DIR,
  NOTICE_FILENAME,
  PACK_DIR,
  PACK_SOURCE_DIR,
  RULES_SOURCE_DIR,
  skillFrontmatterProblems,
} from "../../../../scripts/lib/skills-pack.mjs";
import { extractIrisTokens } from "../../../../scripts/lib/validate-prompts-core.mjs";
import { FORBIDDEN, wordCount } from "./agent-text-hygiene";
import { REPO_ROOT } from "./pack-fixture";

interface Skill {
  name: string;
  /** sha256 of the committed text, captured when the text was last run on a live instance. */
  sha256: string;
  description: string;
  /** The shape of the fenced code blocks: how many the skill holds. */
  codeBlocks: number;
  /** One phrase per probed claim, typed literally. */
  anchors: string[];
}

const SKILLS: Skill[] = [
  {
    name: "iris-mcp-objectscript-gotchas",
    sha256: "9803a88ed4a741cb4e4ee2ef1ec24e0c78c94a55f1823e1774469fbabd9c2ac1",
    description:
      "ObjectScript language traps that compile or run differently from what the code suggests: which macros a class gets without an Include, extra arguments, JSON null against a missing key in a dynamic object, object references inside $List, numeric-looking subscripts, New $NAMESPACE and Catch blocks, missing Ens classes, and Open timeouts. Use when writing, reviewing or debugging ObjectScript, or when IRIS reports MPP5610, PARAMETER, INVALID CLASS, INVALID OREF or CLASS DOES NOT EXIST and the cause is not obvious.",
    codeBlocks: 0,
    anchors: [
      "`$$Name` calls the label",
      "`$$$ThrowStatus` and `$$$QuitOnError`",
      "MPP5610 : Referenced macro not defined: 'GeneralError'",
      "Include %occErrors",
      "MPP5376 : Method or Property 'AssertEqualsViaMacro' does not exist",
      "MPP5377 : You are attempting to call instance method 'AssertEqualsViaMacro' from a class method",
      "MPP5392 : No such method 'AssertEqualsViaMacro' defined in this class",
      "then raises `<PARAMETER>` when it runs",
      "`$Data(pB)` is 0",
      "does not support MultiDimensional operations",
      'returns `""`, not the default',
      '`"unassigned"`, `"null"` and `"string"`',
      '`Set tObj."max_results" = 5`',
      "5143@%Library.ListOfDataTypes",
      "calling a method on it raises `<INVALID OREF>`",
      "`Do tArr.%Push(tObj)`",
      '`tA("1")` and `tA(1)` are one node',
      '`1`, `2`, `10`, `"01"`, `"b"`',
      "not when its `Try` block ends",
      '%ExistsId("Ens.Director")',
      "`Open tFile::5`",
      "In `Open tFile:::1` the `1` is the mnemonic space",
    ],
  },
  {
    name: "iris-mcp-objectscript-error-handling",
    sha256: "779cd9829c4fb65291898b97ef11d8d6cf2cc2334eed1b79dccebf06980e4434",
    description:
      "How %Status values and exceptions work in ObjectScript: making, testing, combining and reading a status, the Try and Catch method shape, ThrowOnError, ThrowStatus and AsStatus, what a runtime error looks like inside a Catch, and reading error text without its translated ERROR #N prefix. Use when writing a method that returns %Status, handling, rethrowing or logging an error, converting between exceptions and statuses, or putting error text that IRIS returned into a new error.",
    codeBlocks: 2,
    anchors: [
      "never with `tSC = 1`",
      '`$$$ISERR("")` and `$$$ISERR("done")` are both 1',
      "`$$$ERRORISTYPE(tSC, $$$GeneralError)`",
      "returns `ERROR #5001: disk full`",
      "separated by CR LF",
      "`  > ERROR #5001: disk full`",
      "`ERREUR #5001: disk full`",
      "`FEHLER #5001: disk full`",
      `If $Piece(tText, tTag) '[ " " Set tText = $Piece(tText, tTag, 2, *)`,
      "`Order #12: `",
      "`ERROR <Ens>ErrGeneral: queue full`",
      "`ERROR #5001: ERROR #5001: file: missing`",
      "`ERROR #5001: Import failed: file: missing`",
      "`%Exception.SystemException` when the status holds an ObjectScript error",
      "`sc` is 1",
      "`ERROR #5001: Called ThrowIfInterrupt with a $$$OK status`",
      "comparing it with `=` to the status that was thrown gives 0",
      "`ex.Code` is 9",
      "`ERROR #5002: ObjectScript error: <UNDEFINED>`",
      "`ERROR #5035: General exception Name '...' Code '...' Data '...'`",
      "with its original `Name` and `Location`",
      "`#1043: QUIT argument not allowed : 'sc'`",
      "Inside a `For` loop it compiles, but an error status then raises `<COMMAND>`",
      "`#1026: Invalid command : 'Finally'`",
      '$$$ThrowStatus($$$ERROR($$$GeneralError, "Nothing to process for "_pId))',
      "`Do ..Save()` throws away",
      "`$$$ThrowOnError(tObj.%Save())`",
    ],
  },
  {
    name: "iris-mcp-objectscript-unit-tests",
    sha256: "448526cbeb36ad7acbb764ac5ed29ec9eea77f379d794539242d06a3767f58e1",
    description:
      "Writing and running %UnitTest tests in ObjectScript: the TestCase class shape and its setup and teardown hooks, which methods run and in what order, the common Assert macros and what they return, skipping a test, what happens when setup or a test fails, and running a class with %UnitTest.Manager and checking its totals. Use when creating or editing a %UnitTest.TestCase class, running IRIS unit tests, or when a run reports fewer tests than expected, zero tests, or a failure you cannot explain.",
    codeBlocks: 1,
    anchors: [
      "While tIter.%GetNext(.tKey, .tItem) {",
      "Tests are instance methods with no arguments",
      "One test-case object serves every test of the class",
      "the first assertion fails with `<INVALID OREF>`",
      "a helper named `TestingHelper`",
      "`testLowerCase` never runs",
      "`Test2` runs before `Test10`",
      "fails when it runs by itself",
      "| `$$$AssertStatusEquals(sc1, sc2, msg)` |",
      "`$$$AssertFilesSame(file1, file2, msg)`",
      "`1 + 1== 2`",
      '`"1.0"` and `1` are not equal',
      `\`If '$$$AssertStatusOK(tSC, "saved") Quit\``,
      "A failed assertion does not end the test",
      "its method does not run, and it is reported skipped",
      "yet it is reported passed",
      "fails that one test without running it",
      "`OnAfterOneTest` is not called for that test",
      "None of its tests runs",
      "the class is reported failed with that error, and it has no `TestMethod` rows",
      "The next test still runs",
      '`":MyApp.Tests.Cart:TestTotal"`',
      '`"/noload/nodelete/norecursive"`',
      "each namespace has its own",
      "`TestMethod.Status` is 1 for passed, 0 for failed and 2 for skipped",
      "a `Duration of execution` row for each test method that runs without a runtime error",
    ],
  },
];

const sourcePath = (name: string): string => join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR, name, "SKILL.md");
const packPath = (name: string): string => join(REPO_ROOT, PACK_DIR, "skills", name, "SKILL.md");
const MAX_LINES = 500;
const MAX_WORDS = 1200;

// ---------------------------------------------------------------------------------------------------------
// The text checks, as functions, so a negative control can prove each one is able to fail.
// ---------------------------------------------------------------------------------------------------------

/** The names of every skill in the pack: the workflow skills and the knowledge skills. */
function packSkillNames(): string[] {
  return readdirSync(join(REPO_ROOT, PACK_DIR, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

const NUMBER_SIGN = "a number sign and digits that are not an IRIS error code";
const PATH = "a path";

/** Escape a string for use inside a regular expression. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every top-level entry of the repository, followed by a slash, with nothing path-like before it. */
function repositoryPathPattern(entries: string[]): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_.-])(?:${entries.map(escapeRegExp).join("|")})/`);
}

/**
 * The shared hygiene list with the two overrides a knowledge skill needs, because IRIS's own syntax is part of the
 * content:
 *  - "a path" becomes "a repository path" plus "an absolute path": the qualifier string
 *    `/noload/nodelete/norecursive` is IRIS syntax, not a path in a repository;
 *  - the number-sign class also accepts `#<n>:`: IRIS compile errors read `#1043: QUIT argument not allowed`, and a
 *    translated error reads `ERREUR #5001: ...`.
 * An internal rule number followed by a colon is the one thing that override would let through, so it has its own entry,
 * and so does a class or helper of this project, which the shared list has no pattern for.
 */
function skillForbidden(repositoryEntries: string[]): Array<[name: string, pattern: RegExp, sample: string]> {
  const list: Array<[name: string, pattern: RegExp, sample: string]> = [];
  for (const entry of FORBIDDEN) {
    if (entry[0] === NUMBER_SIGN) {
      list.push([NUMBER_SIGN, /(?<!ERROR )#\d+(?!\d|:)/, entry[2]]);
      list.push(["an internal rule number", /\bRule #\d+/i, "see Rule #7: do this"]);
    } else if (entry[0] === PATH) {
      list.push(["a repository path", repositoryPathPattern(repositoryEntries), entry[2]]);
      list.push(["an absolute path", /(?<![A-Za-z0-9_.-])\/(?:Users|home|private|tmp|usr|opt|var)\//, "open /Users/someone/file"]);
    } else {
      list.push(entry);
    }
  }
  list.push(["a class or helper of this project", /\bExecuteMCPv2\b|\bSanitizeError\b/, "call ExecuteMCPv2.Utils.SanitizeError"]);
  return list;
}

const REPOSITORY_ENTRIES = readdirSync(REPO_ROOT);
const SKILL_FORBIDDEN = skillForbidden(REPOSITORY_ENTRIES);

/** The text a hygiene scan reads: no frontmatter `name:` line (line 2) and none of the pack's own skill names. */
function scannedText(text: string, names: string[]): string {
  const withoutNameLine = text
    .split("\n")
    .filter((line, index) => !(index === 1 && line.startsWith("name:")))
    .join("\n");
  return [...names].sort((a, b) => b.length - a.length).reduce((rest, name) => rest.split(name).join(""), withoutNameLine);
}

/** The hygiene classes the text trips, after the pack's own skill names are removed. */
function hygieneProblems(text: string, names: string[]): string[] {
  const scanned = scannedText(text, names);
  return SKILL_FORBIDDEN.filter(([, pattern]) => pattern.test(scanned)).map(([name]) => name);
}

/** The bullets of the always-on rule, as whitespace-normalized text without the bullet marker. */
const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();
const ruleBullets = readFileSync(join(REPO_ROOT, RULES_SOURCE_DIR, ALWAYS_ON_RULE_FILENAME), "utf8")
  .split("\n")
  .filter((line) => line.startsWith("- "))
  .map((line) => normalize(line.slice(2)));

/** The rule bullets that appear whole inside the text. */
function copiedBullets(text: string): string[] {
  const normalized = normalize(text);
  return ruleBullets.filter((bullet) => normalized.includes(bullet));
}

/** Every reason the text is not an acceptable knowledge skill body, or an empty list. */
function textProblems(text: string, names: string[]): string[] {
  const problems = hygieneProblems(text, names);
  const tokens = extractIrisTokens(text) as string[];
  if (tokens.length > 0) problems.push(`a tool name: ${tokens.join(", ")}`);
  if (copiedBullets(text).length > 0) problems.push("a bullet copied from the always-on rule");
  return problems;
}

/** The number of fenced code blocks: opening lines of a fence pair. */
function codeBlockCount(text: string): number {
  const fences = text.split("\n").filter((line) => line.startsWith("```")).length;
  expect(fences % 2, "every fence is closed").toBe(0);
  return fences / 2;
}

// ---------------------------------------------------------------------------------------------------------
// The real sources.
// ---------------------------------------------------------------------------------------------------------

describe("the three core knowledge skills, real tree (AC 41.3.1)", () => {
  it("are exactly the three planned skills", () => {
    const directories = readdirSync(join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directories).toEqual(SKILLS.map((skill) => skill.name).sort());
  });

  describe.each(SKILLS)("$name", (skill) => {
    const bytes = readFileSync(sourcePath(skill.name));
    const text = bytes.toString("utf8");

    it("is the text that was run on a live instance: its sha256 equals the recorded one", () => {
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(skill.sha256);
    });

    it("holds exactly its name and description, in that order, as the frontmatter", () => {
      const lines = text.split("\n");
      expect(lines.slice(0, 4)).toEqual(["---", `name: ${skill.name}`, `description: ${JSON.stringify(skill.description)}`, "---"]);
      expect(skillFrontmatterProblems(text, skill.name)).toEqual([]);
    });

    it("has a description that names the content and says when to use the skill", () => {
      expect(skill.description).toContain(" Use when ");
      expect(skill.description.indexOf("Use when")).toBeGreaterThan(40);
      expect(skill.description.length).toBeLessThanOrEqual(1024);
      expect(/<\/?[A-Za-z][^<>]*>/.test(skill.description)).toBe(false);
    });

    it("is the only file in its source directory and in its pack directory", () => {
      expect(readdirSync(join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR, skill.name))).toEqual(["SKILL.md"]);
      expect(readdirSync(join(REPO_ROOT, PACK_DIR, "skills", skill.name))).toEqual(["SKILL.md"]);
    });

    it("has a pack copy equal to the source, byte for byte", () => {
      expect(readFileSync(packPath(skill.name)).equals(bytes)).toBe(true);
    });

    it("is ASCII, LF only, and ends in exactly one LF", () => {
      expect(bytes.every((byte) => byte === 0x0a || (byte >= 0x20 && byte <= 0x7e)), "every byte is LF or printable ASCII").toBe(true);
      expect(text.includes("\r"), "no CR").toBe(false);
      expect(text.endsWith("\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
    });

    it(`is within ${MAX_LINES} lines and ${MAX_WORDS} words`, () => {
      expect(text.split("\n").length - 1).toBeLessThanOrEqual(MAX_LINES);
      expect(wordCount(text)).toBeGreaterThan(0);
      expect(wordCount(text)).toBeLessThanOrEqual(MAX_WORDS);
    });

    it("names no iris_* tool (AC 41.3.3)", () => {
      expect(extractIrisTokens(text)).toEqual([]);
    });

    it(`holds ${skill.codeBlocks} fenced code block(s)`, () => {
      expect(codeBlockCount(text)).toBe(skill.codeBlocks);
    });

    it("carries every probe anchor, one per claim that was run on a live instance (AC 41.3.2)", () => {
      expect(new Set(skill.anchors).size, "no anchor is listed twice").toBe(skill.anchors.length);
      for (const anchor of skill.anchors) expect(text, anchor).toContain(anchor);
    });

    it("goes deeper than the always-on rule: it copies none of the rule's bullets (AC 41.3.3)", () => {
      expect(ruleBullets).toHaveLength(16);
      expect(copiedBullets(text)).toEqual([]);
    });

    it("names nothing of this repository, its planning or its tooling, in the source and in the pack copy (AC 41.3.3)", () => {
      const names = packSkillNames();
      for (const copy of [text, readFileSync(packPath(skill.name), "utf8")]) {
        expect(hygieneProblems(copy, names)).toEqual([]);
        expect(textProblems(copy, names)).toEqual([]);
      }
    });
  });

  it("the probe anchors total 75: 22, 27 and 26", () => {
    expect(SKILLS.map((skill) => skill.anchors.length)).toEqual([22, 27, 26]);
  });

  it("the notice still has no provenance row: nothing is adapted from another project (AC 41.3.1)", () => {
    const notice = readFileSync(join(REPO_ROOT, PACK_SOURCE_DIR, NOTICE_FILENAME), "utf8");
    expect(notice.split(/\r?\n/).some((line) => line.trim() === PROVENANCE_HEADER_ROW), "the provenance table header row is present").toBe(true);
    const parsed = parseProvenanceRows(notice);
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The checks can fail (negative controls).
// ---------------------------------------------------------------------------------------------------------

describe("the knowledge-skill text checks can fail (negative controls)", () => {
  const names = ["iris-mcp-objectscript-gotchas"];
  const body = "- A line that is fine.\n";

  it.each([
    ["an internal rule number", `${body}see Rule #7`, "an internal rule number"],
    ["an internal rule number followed by a colon", `${body}see Rule #7: do this`, "an internal rule number"],
    ["a number sign that is no IRIS error code", `${body}see item #58`, NUMBER_SIGN],
    ["a deferred-work id", `${body}tracked as DW-613`, "a planning or deferred-work id"],
    ["a repository path", `${body}in packages/shared`, "a repository path"],
    ["a repository path under a dotted entry", `${body}in .claude/rules`, "a repository path"],
    ["an absolute path", `${body}open /Users/someone/file`, "an absolute path"],
    ["a repository file", `${body}edit rules.md`, "a repository file"],
    ["a URL", `${body}docs at https://example.com`, "a URL"],
    ["repository tooling", `${body}run pnpm test`, "repository tooling"],
    ["a mention of how the claims were checked", `${body}verified by a probe`, "a mention of how the claims were checked"],
    ["a class of this project", `${body}call ExecuteMCPv2.Utils`, "a class or helper of this project"],
    ["a helper of this project", `${body}wrap it in SanitizeError`, "a class or helper of this project"],
    ["a tool name", `${body}call \`iris_doc_put\``, "a tool name: iris_doc_put"],
    ["a server name", `${body}use iris-dev`, "a tool or server name"],
  ])("flags %s", (_row, text, reported) => {
    expect(textProblems(text, names)).toContain(reported);
  });

  it.each(FORBIDDEN.filter(([name]) => name !== NUMBER_SIGN && name !== PATH))(
    "the skill list still holds the shared class %s, and flags its sample",
    (name, _pattern, sample) => {
      expect(textProblems(`${body}${sample}\n`, names)).toContain(name);
    },
  );

  it("flags a copied bullet of the always-on rule, even with its whitespace changed", () => {
    const bullet = ruleBullets[4] ?? "";
    expect(bullet.length).toBeGreaterThan(40);
    expect(textProblems(`${body}${bullet}\n`, names)).toContain("a bullet copied from the always-on rule");
    expect(textProblems(`${body}${bullet.replace(/ /g, "\n  ")}\n`, names)).toContain("a bullet copied from the always-on rule");
    expect(ruleBullets).toHaveLength(16);
  });

  it("accepts the IRIS syntax the override exists for", () => {
    expect(textProblems("- Pass `/noload/nodelete/norecursive`.\n", names)).toEqual([]);
    expect(textProblems("- The compile fails with `#1043: QUIT argument not allowed`.\n", names)).toEqual([]);
    expect(textProblems("- A translated status reads `ERREUR #5001: disk full`.\n", names)).toEqual([]);
    expect(textProblems("- `ERROR #5001: disk full` is the English text.\n", names)).toEqual([]);
  });

  it("removes the name line and the pack's own skill names before the scan", () => {
    const text = "---\nname: iris-mcp-objectscript-gotchas\n---\n- See `iris-mcp-objectscript-gotchas` for traps.\n";
    expect(textProblems(text, names)).toEqual([]);
    expect(textProblems(text, [])).toContain("a tool or server name");
  });

  it("still scans a body line that starts with name:", () => {
    const text = "---\nname: iris-mcp-objectscript-gotchas\n---\nname: iris-dev\n";
    expect(textProblems(text, names)).toContain("a tool or server name");
  });

  it("the overrides are needed: the unmodified shared list flags the real skills for exactly those two reasons", () => {
    const unmodified = (text: string): string[] =>
      FORBIDDEN.filter(([, pattern]) => pattern.test(scannedText(text, packSkillNames()))).map(([name]) => name);
    const unitTests = readFileSync(sourcePath("iris-mcp-objectscript-unit-tests"), "utf8");
    const errorHandling = readFileSync(sourcePath("iris-mcp-objectscript-error-handling"), "utf8");
    expect(unmodified(unitTests)).toEqual([PATH]);
    expect(unmodified(errorHandling)).toEqual([NUMBER_SIGN]);
  });
});
