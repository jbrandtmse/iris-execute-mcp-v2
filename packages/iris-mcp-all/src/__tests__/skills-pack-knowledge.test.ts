/**
 * Stories 41.3 and 41.4 (AC 41.3.1 to 41.3.3 and AC 41.4.1 to 41.4.3) - the six knowledge skills, read as a user's agent
 * will read them: the three core skills and the three platform skills.
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
 *  - the shape: the number of fenced code blocks, each of which was compiled as written;
 *  - the provenance: the oracle names the skill that is adapted from another project, the notice holds exactly that
 *    skill's row, and the skill opens with the adaptation header.
 *
 * The adaptation header is the one line the wording and ASCII checks do not read: it names the upstream project and the
 * notice file, and it holds the copyright sign. The exemption covers exactly that line, only as the first body line,
 * and only for a skill whose oracle carries `adaptedFrom`.
 *
 * Every pattern is applied to sample text first, so a pattern that has stopped matching shows up as a failed negative
 * control rather than as a clean skill.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADAPTATION_HEADER,
  hasValidAdaptationHeader,
  parseProvenanceRows,
  PROVENANCE_HEADER_ROW,
  withoutAdaptationHeader,
} from "../../../../scripts/lib/provenance-core.mjs";
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
  /** Present only on an adapted skill: the upstream source path, as the notice's provenance row names it. */
  adaptedFrom?: string;
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
  {
    name: "iris-mcp-objectscript-sql",
    sha256: "135b2a3770f7dfd2676807edc6439f2f93a81c2843721bb0d2e5d28bd571e916",
    description:
      "Running SQL from ObjectScript with embedded SQL and %SQL.Statement: the SQL table name of a class, SQLCODE 0, 100 and negative values, what INTO variables hold when no row is found, errors that appear only when a statement runs or a row is fetched, NULL against the empty string, and what %OpenId and %DeleteId return for a missing ID. Use when writing or reviewing &sql or %SQL.Statement code, or when a query reports SQLCODE -30 or -29, finds no row you expected, or returns an empty value.",
    codeBlocks: 2,
    adaptedFrom: "skills/skills/objectscript-sql-patterns/SKILL.md",
    anchors: [
      "`Ens.Config.Item` is the table `Ens_Config.Item`",
      "`Table 'CONFIG.ITEM' not found`",
      "SELECT SqlSchemaName, SqlTableName FROM %Dictionary.CompiledClass WHERE Name = ?",
      "100 when it found or changed no row",
      "Test `SQLCODE = 100` and `SQLCODE < 0` apart",
      "still holding the text of an earlier error",
      "`%ROWID` holds the new row's ID",
      "`ERROR #5540: SQLCODE: -400 Message: ...`",
      "`Table 'MYAPP_DATA.MISSING' not found compiling embedded cached query`",
      "with `tCode` undefined finds nothing and gives 100",
      'every `INTO` variable is set to `""`',
      "`tCount` is 0 when nothing matches",
      "takes the first one and gives 0",
      "&sql(SELECT Name INTO :tName FROM MyApp_Data.Item WHERE Code = :pCode)",
      "No row and an SQL error, such as a missing table, each end in `tSC`",
      "`Field 'APPLE' not found`",
      "`%ExecDirect` returns a result object even when the statement fails",
      "`%Execute` leaves `%SQLCODE` at 0",
      "`%ROWCOUNT` is the number of rows fetched",
      "the ODBC form, `2024-06-09`",
      "While tRS.%Next(.tFetch) {",
      "No matching row is no error",
      'A saved object whose `Name` is `""` matches `Name IS NULL`',
      "It is stored as `$Char(0)`",
      "A property set to `$Char(0)` matches `Name = ''` too",
      "test `Name IS NULL OR Name = ''`",
      "`ERROR #5809: Object to Load not found, class '...', ID '...'`",
      "`%OpenId(tId).Name` raises `<INVALID OREF>`",
      "`ERROR #5810: Object to Delete not found`",
      "A class of the package `User` is in the schema `SQLUser`, and a class's `SqlTableName`",
      "but an error raised while the statement runs, such as -400, sets `%msg` only when it is empty",
      "A method that holds embedded SQL starts with `%msg` undefined",
    ],
  },
  {
    name: "iris-mcp-system-classes",
    sha256: "f5f22ff75c2c75726c5c4fd8b3098492b735700cf22853c11d37d83092f9b310",
    description:
      "Using the IRIS system classes from ObjectScript: what the Config, SYS and Security classes hold and when one answer needs two of them, class queries with fewer columns than the class, deprecated properties that still read but no longer follow the configuration, switching to %SYS and back safely, and counters of one process against the whole instance. Use when code calls Config, SYS or Security classes, switches $NAMESPACE to %SYS, reports system metrics, or fails with CLASS DOES NOT EXIST or NAMESPACE around a namespace switch.",
    codeBlocks: 1,
    anchors: [
      "`Config.*` classes read and write the instance's configuration file",
      '`##class(%Dictionary.CompiledClass).%ExistsId("Config.Databases")` is 0',
      "calling such a class from outside `%SYS` raises `<CLASS DOES NOT EXIST>`",
      "exists in `USER` too",
      "but no size and no mounted state",
      "gives `Size` in MB, `Mounted` and `ReadOnly`",
      '`props("Globals")`',
      "has no `NamespaceList` method",
      "its `ListAll` query has one",
      "`ERROR #883: Role ... does not exist`",
      "gives it an empty `Resources`",
      "`CRLFile`, `Protocols` and `SNIName`",
      "read empty for each of three TLS configurations",
      "`Get(name, .props)` leaves it out",
      "Set tSC = ##class(Config.Databases).Get(pName, .tProps)",
      "for a missing one with `ERROR #420`",
      "the caller's `Catch` runs in `%SYS`",
      "Local variables keep their values across a switch",
      "raises `<NAMESPACE>` and leaves you where you were",
      "`##class(%SYS.Namespace).Exists(name)`",
      "Killed after the switch, it raised `<CLASS DOES NOT EXIST>`",
      "after the method's own `Catch` had finished",
      "A `%ResultSet` of the same query could be killed after the switch without an error",
      "which could also still be read",
      "a mapped package resolved in `%SYS`, while `Ens.Director` did not",
      "a loop of 100,000 passes added about 200,000 commands",
      "`CommandsExecuted` was 3.5 billion",
      "`RefLocal + RefPrivate + RefRemote`",
      "51 times the worker's",
      "but it returns a `SYS.Stats.Routine`",
      "grew by 200,430 and the process's by 200,488",
    ],
  },
  {
    name: "iris-mcp-interoperability",
    sha256: "f10dec5dcb06dc19900a344f82670637e9d93c8c864a8b5f408b1d56a9682d9c",
    description:
      "Writing IRIS interoperability (Ensemble) components in ObjectScript: business service, process and operation classes and their method signatures, Ens.Request and Ens.Response messages, adapters, settings and message maps, synchronous and asynchronous sends, and why the production class XData, not the configuration tables, defines a production. Use when creating or editing a business host, a message class or a production class, or when a host does not compile, a request is not handled, a setting does not appear, or a configuration change does not last.",
    codeBlocks: 1,
    anchors: [
      "except a business process's `SendRequestAsync`, which declares an `Ens.Request`",
      "as `Ens.Request` and `Ens.Response` are, keeps its data in `^Ens.MessageBodyD`",
      "`ERROR <Ens>ErrGeneral: Ens.StringRequest has no value for parameter RESPONSECLASSNAME`",
      "each carry one `StringValue` property",
      '<MapItem MessageType="Ens.StringRequest">',
      "offers `PutString(filename, data)`, `PutLine` and `PutStream`",
      "A misspelled adapter class still compiles",
      "tests in map order, so the first match wins",
      "goes to `OnMessage`, whose default returns an error",
      "`Method Missing referenced in MessageMap does not exist`",
      "does not check that the method's argument type matches",
      "and so may an override of `OnMessage`",
      "is committed after it returns, with a warning in the event log",
      '`Parameter INVOCATION` is `"Queue"`',
      "work in a business host without an `Include`",
      "`MPP5610 : Referenced macro not defined: 'LOGINFO'`",
      "leaving `Prefix` and 14 inherited ones",
      "come from the adapter class's own list",
      "A narrower type for `pInput`, such as `%Stream.Object`, compiles",
      '`pInput.Attributes("Filename")`',
      "a name the running production does not know returns an error status",
      "The comment on `OnProcessInput` says not to call the send methods from outside it",
      "or the production is quiescent",
      "Typed arguments compile here too",
      "The default `OnResponse` returns an error",
      "`OnComplete` runs when every response is in or the wait has timed out",
      "can deadlock when both share the production's actor pool",
      "Compiling that class deletes the production's row in the configuration tables",
      "does the same reload",
      "but does not compile it",
      "covers the production and the name together and is not unique",
      "applies a changed configuration to the running production",
    ],
  },
];

/** The provenance row the notice must hold for the adapted skill, typed here and not derived from the notice. */
const GOLDEN_ROW = {
  packFile: "skills/iris-mcp-objectscript-sql/SKILL.md",
  source: "skills/skills/objectscript-sql-patterns/SKILL.md",
  adaptation:
    "Rewritten for IRIS 2026.2 and run on it again: kept the table-name, SQLCODE, fetch-time error, double-quote and INTO-variable traps; corrected the NULL and empty-string section; dropped the lock-timeout, ObjectScript-operator and date sections; added first-run compilation of embedded SQL, undefined host variables, %msg, select mode, and the %OpenId and %DeleteId failures",
};

const sourcePath = (name: string): string => join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR, name, "SKILL.md");
const packPath = (name: string): string => join(REPO_ROOT, PACK_DIR, "skills", name, "SKILL.md");
const MAX_LINES = 500;
const MAX_WORDS = 1200;

/** The bytes of a skill source, or none when it is missing, so a missing skill fails its own tests and the directory test, not the whole file. */
const readSourceBytes = (name: string): Buffer => (existsSync(sourcePath(name)) ? readFileSync(sourcePath(name)) : Buffer.alloc(0));

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

/** Whether every byte of the text is LF or printable ASCII. */
function isPrintableAscii(text: string): boolean {
  return Buffer.from(text, "utf8").every((byte) => byte === 0x0a || (byte >= 0x20 && byte <= 0x7e));
}

/**
 * The text the ASCII, wording, tool-name and rule-copy checks read. The adaptation header is the one line they skip,
 * and only the first line that is exactly ADAPTATION_HEADER, only when it is the first body line (the shared
 * `withoutAdaptationHeader`, which `validate:prompts` also uses), and only for a skill whose oracle marks it adapted. Any other copy of the header, a
 * header anywhere else, a header in a skill that is not marked adapted, and a header with a changed character are read
 * like any other line.
 */
function checkedText(text: string, adapted: boolean): string {
  return adapted ? (withoutAdaptationHeader(text) as string) : text;
}

/** Every reason the text is not an acceptable knowledge skill body, or an empty list. */
function textProblems(text: string, names: string[], adapted = false): string[] {
  const read = checkedText(text, adapted);
  const problems = hygieneProblems(read, names);
  if (!isPrintableAscii(read)) problems.push("a character outside printable ASCII");
  const tokens = extractIrisTokens(read) as string[];
  if (tokens.length > 0) problems.push(`a tool name: ${tokens.join(", ")}`);
  if (copiedBullets(read).length > 0) problems.push("a bullet copied from the always-on rule");
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

describe("the knowledge skills, real tree (AC 41.3.1, 41.4.3)", () => {
  it("are exactly the six planned skills, and six is within the 6 to 10 the pack allows", () => {
    const directories = readdirSync(join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directories).toEqual(SKILLS.map((skill) => skill.name).sort());
    expect(directories.length).toBeGreaterThanOrEqual(6);
    expect(directories.length).toBeLessThanOrEqual(10);
    expect(SKILLS).toHaveLength(6);
  });

  describe.each(SKILLS)("$name", (skill) => {
    const bytes = readSourceBytes(skill.name);
    const text = bytes.toString("utf8");
    const adapted = skill.adaptedFrom !== undefined;

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

    it("is ASCII, LF only, and ends in exactly one LF (an adapted skill: outside its header line)", () => {
      expect(isPrintableAscii(checkedText(text, adapted)), "every byte is LF or printable ASCII").toBe(true);
      expect(text.includes("\r"), "no CR").toBe(false);
      expect(text.endsWith("\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
    });

    if (adapted) {
      it("opens with the adaptation header as its first body line, the one line that holds a non-ASCII character", () => {
        expect(hasValidAdaptationHeader(text)).toBe(true);
        expect(text.split("\n")[5], "the header is line 6, after the frontmatter and one blank line").toBe(ADAPTATION_HEADER);
        expect(isPrintableAscii(text), "the header line is what makes the file non-ASCII").toBe(false);
        expect(checkedText(text, true), "the header appears once: no copy is left once its line is exempted").not.toContain(ADAPTATION_HEADER);
      });
    } else {
      it("is not adapted: it carries no mention of the upstream project", () => {
        expect(text).not.toMatch(/iris-agentic-dev/i);
        expect(hasValidAdaptationHeader(text)).toBe(false);
      });
    }

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
      expect(copiedBullets(checkedText(text, adapted))).toEqual([]);
    });

    it("names nothing of this repository, its planning or its tooling, in the source and in the pack copy (AC 41.3.3)", () => {
      const names = packSkillNames();
      for (const copy of [text, readFileSync(packPath(skill.name), "utf8")]) {
        expect(hygieneProblems(checkedText(copy, adapted), names)).toEqual([]);
        expect(textProblems(copy, names, adapted)).toEqual([]);
      }
    });
  });

  it("the probe anchors total 170: 22, 27, 26, 32, 31 and 32", () => {
    expect(SKILLS.map((skill) => skill.anchors.length)).toEqual([22, 27, 26, 32, 31, 32]);
  });

  it("the notice holds exactly the rows of the adapted skills (AC 41.3.1, 41.4.3)", () => {
    const notice = readFileSync(join(REPO_ROOT, PACK_SOURCE_DIR, NOTICE_FILENAME), "utf8");
    expect(notice.split(/\r?\n/).some((line) => line.trim() === PROVENANCE_HEADER_ROW), "the provenance table header row is present").toBe(true);
    const parsed = parseProvenanceRows(notice);
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows.map(({ packFile, source, adaptation }) => ({ packFile, source, adaptation }))).toEqual([GOLDEN_ROW]);
    const byPackFile = (a: { packFile: string }, b: { packFile: string }): number => a.packFile.localeCompare(b.packFile);
    const adaptedSkills = SKILLS.filter((skill) => skill.adaptedFrom !== undefined);
    expect(
      adaptedSkills.map((skill) => ({ packFile: `skills/${skill.name}/SKILL.md`, source: skill.adaptedFrom })).sort(byPackFile),
    ).toEqual(parsed.rows.map(({ packFile, source }) => ({ packFile, source })).sort(byPackFile));
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

describe("the adaptation-header exception is one line and can fail (negative controls)", () => {
  const names = ["iris-mcp-objectscript-sql"];
  const frontmatter = '---\nname: iris-mcp-objectscript-sql\ndescription: "Running SQL from ObjectScript."\n---\n';
  const body = "# SQL in ObjectScript\n\n- A line that is fine.\n";
  /** The header line and what it trips when it is read like any other line. */
  const HEADER_CLASSES = ["a character outside printable ASCII", "a tool or server name", "a repository file"];

  const headerFirst = `${frontmatter}\n${ADAPTATION_HEADER}\n\n${body}`;
  const headerLast = `${frontmatter}\n${body}\n${ADAPTATION_HEADER}\n`;
  const headerTwice = `${frontmatter}\n${ADAPTATION_HEADER}\n\n${body}\n${ADAPTATION_HEADER}\n`;
  const COPYRIGHT_SIGN = String.fromCharCode(0xa9);
  const headerAsciiCopyright = `${frontmatter}\n${ADAPTATION_HEADER.replace(COPYRIGHT_SIGN, "(c)")}\n\n${body}`;
  const headerCrlf = `${frontmatter}\n${ADAPTATION_HEADER}\n\n${body}- See Rule #7: do this.`.replace(/\n/g, "\r\n");

  it("passes an adapted skill whose header is its first body line, and nothing else", () => {
    expect(hasValidAdaptationHeader(headerFirst)).toBe(true);
    expect(textProblems(headerFirst, names, true)).toEqual([]);
  });

  it("flags the same header in a skill that is not marked adapted: non-ASCII, a tool or server name, a repository file", () => {
    expect(hasValidAdaptationHeader(headerFirst)).toBe(true);
    const problems = textProblems(headerFirst, names, false);
    for (const reported of HEADER_CLASSES) expect(problems).toContain(reported);
  });

  it("flags the header at the end of an adapted body: non-ASCII, a tool or server name, a repository file", () => {
    expect(hasValidAdaptationHeader(headerLast)).toBe(false);
    const problems = textProblems(headerLast, names, true);
    for (const reported of HEADER_CLASSES) expect(problems).toContain(reported);
  });

  it("flags a second copy of the header in an adapted body", () => {
    expect(hasValidAdaptationHeader(headerTwice)).toBe(true);
    const problems = textProblems(headerTwice, names, true);
    for (const reported of HEADER_CLASSES) expect(problems).toContain(reported);
  });

  it("fails the header check for a header with (c) in place of the copyright sign, and flags it as wording", () => {
    expect(hasValidAdaptationHeader(headerAsciiCopyright)).toBe(false);
    const problems = textProblems(headerAsciiCopyright, names, true);
    expect(problems).toContain("a tool or server name");
    expect(problems).toContain("a repository file");
    expect(problems).not.toContain("a character outside printable ASCII");
  });

  it("reads an adapted skill with CRLF line endings whole: its header is flagged and no other line is dropped", () => {
    expect(hasValidAdaptationHeader(headerCrlf)).toBe(true);
    const problems = textProblems(headerCrlf, names, true);
    for (const reported of HEADER_CLASSES) expect(problems).toContain(reported);
    expect(problems).toContain("an internal rule number");
  });

  it("an adapted skill without the header fails the header check (its wording is clean, so only that check catches it)", () => {
    expect(hasValidAdaptationHeader(`${frontmatter}\n${body}`)).toBe(false);
    expect(textProblems(`${frontmatter}\n${body}`, names, true)).toEqual([]);
  });
});
