/**
 * Story 38.6 (AC-1) -- every Epic 38 item states its default state on every documentation surface that lists
 * it (project rules #30 and #43), as the Docs table of the Story 38.6 spec requires.
 *
 * The unit suites pin the tools and the live gates pin IRIS; neither reads a document. For each row of that
 * table and each surface listed for it, this file asserts that the anchor row or section carries the
 * default-state phrase. It also pins the three client-config guides and the launcher README (which carry
 * both SQL operator variables), the CHANGELOG's Story 38.6 top section, the changeset's exact bump map, and the
 * `@iris-mcp/all` prepublish gate roster and file-serial run.
 *
 * Needs no IRIS and no built dist: it reads documents and one script. Cross-package documentation checks live
 * in `@iris-mcp/all` (rule #45). The facts the phrases state (defaults, accepted values, refusal codes) are
 * pinned against the built tools and config by `story-38-5-qa-doc-claims.test.ts` and the tool unit suites.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const squash = (text: string): string => text.replace(/\s+/g, " ");

const rootReadme = read("README.md");
const devReadme = read("packages/iris-dev-mcp/README.md");
const toolSupport = read("tool_support.md");
const launcherReadme = read("extensions/iris-mcp-launcher/README.md");
const CLIENT_GUIDES = ["claude-code", "claude-desktop", "cursor"] as const;

/** The first line of `text` that starts with `prefix`; fails the test when there is none. */
function lineStarting(text: string, prefix: string): string {
  const line = text.split("\n").find((candidate) => candidate.startsWith(prefix));
  expect(line, `a line starting ${prefix}`).toBeDefined();
  return line as string;
}

/** The `tool_support.md` table row of the tool numbered `n`. */
const toolSupportRow = (n: number, tool: string): string => squash(lineStarting(toolSupport, `| ${n} | \`${tool}\` |`));

/** The root README's "Agent code editing" section, up to the next `###` heading. */
const editingSection = squash(/^### Agent code editing \(Epic 38\)$[\s\S]*?(?=^### )/m.exec(rootReadme)?.[0] ?? "");

/** The dev README's `iris_doc_edit` details block. */
const devEditDetailsRaw = /<summary><strong>iris_doc_edit<\/strong>[\s\S]*?<\/details>/.exec(devReadme)?.[0] ?? "";
const devEditDetails = squash(devEditDetailsRaw);

/** The dev README's "SQL write safety" governance note. */
const devSqlNote = squash(lineStarting(devReadme, "> **SQL write safety (optional, opt-in"));

/** The `tool_support.md` Story 38.5 governance note. */
const toolSupportSqlNote = squash(lineStarting(toolSupport, "> **Story 38.5 (2026-10-15)"));

/** The "Read-only Mode + SQL Resource Caps" section of a client-config guide, up to the next rule. */
function readOnlySection(guide: string): string {
  const text = read(`docs/client-config/${guide}.md`);
  const section = /^## Read-only Mode \+ SQL Resource Caps \(optional\)$[\s\S]*?(?=^---$)/m.exec(text)?.[0] ?? "";
  expect(section, `${guide}.md has the Read-only Mode + SQL Resource Caps section`).not.toBe("");
  return section;
}

describe("Story 38.6: the Agent code editing section of the root README states each default (Docs table)", () => {
  it("the section exists", () => {
    expect(editingSection, "the root README has the Agent code editing section").not.toBe("");
  });

  it("iris_doc_get startLine/endLine: optional, and the whole document when both are omitted", () => {
    expect(editingSection).toContain("`startLine` and `endLine`");
    expect(editingSection).toContain("Omit both for the whole document");
  });

  it("iris_doc_put: the version-checked save, DOCUMENT_CONFLICT, STORAGE_DROPPED and allowStorageRegeneration default false", () => {
    expect(editingSection).toContain("The save is version-checked");
    expect(editingSection).toContain("`DOCUMENT_CONFLICT`");
    expect(editingSection).toContain("`ignoreConflict` (default **`false`**)");
    expect(editingSection).toContain("`STORAGE_DROPPED`");
    expect(editingSection).toContain("`allowStorageRegeneration` is `true` (default **`false`**)");
  });

  it("iris_doc_edit: apply is enabled by default and how to disable it; regenerateStorage is disabled by default", () => {
    expect(editingSection).toContain("`action: \"apply\"` is a write that is **enabled by default**");
    expect(editingSection).toContain('`{"global":{"iris_doc_edit:apply":false}}`');
    expect(editingSection).toContain("inherits an explicit disable of `iris_doc_put`");
    expect(editingSection).toContain("the `read-only` preset blocks it");
    expect(editingSection).toContain('`action: "regenerateStorage"`');
    expect(editingSection).toContain("**disabled by default**");
  });

  it("STALE_CONTENT and the current retry: the refusal table row says what happened and what to do", () => {
    expect(editingSection).toContain("`mismatches[].current`");
    expect(editingSection).toContain("with one trailing line break");
    const row = squash(lineStarting(rootReadme, "| `STALE_CONTENT` |"));
    expect(row).toContain("Nothing was stored.");
    expect(row).toContain("Pass `mismatches[].current` back as `expected`");
  });

  it("the refusal table lists all five codes, each with a 'what happened' and a 'what to do' cell", () => {
    for (const code of ["STALE_CONTENT", "DOCUMENT_CONFLICT", "STORAGE_DROPPED", "SQL_READ_ONLY", "SQL_ROWS_AFFECTED_CAP"]) {
      const cells = lineStarting(rootReadme, `| \`${code}\` |`).split("|").slice(1, -1).map((cell) => cell.trim());
      expect(cells, `${code} row`).toHaveLength(3);
      expect(cells[1]?.length, `${code} what happened`).toBeGreaterThan(20);
      expect(cells[2]?.length, `${code} what to do`).toBeGreaterThan(20);
    }
  });

  it("the two SQL rows name each refusal variant and its remedy, as the iris_sql_execute refusal texts do", () => {
    const readOnly = squash(lineStarting(rootReadme, "| `SQL_READ_ONLY` |"));
    expect(readOnly).toContain("`iris_sql_execute` with `readOnly: true`");
    expect(readOnly).toContain("From `iris_sql_query`, run the statement with `iris_sql_execute`");
    expect(readOnly).toContain("With `readOnly: true`, run it without `readOnly`.");
    const cap = squash(lineStarting(rootReadme, "| `SQL_ROWS_AFFECTED_CAP` |"));
    expect(cap).toContain("or the statement was not run at all");
    expect(cap).toContain("raise `maxRowsAffected` when the cap is the call's own");
    expect(cap).toContain("Not run: remove `%NOJOURN` from the text, or run the statement without `maxRowsAffected`.");
  });
});

describe("Story 38.6: the dev README states each default", () => {
  it("the iris_doc_get row lists the optional range parameters; the details say the whole document is returned without them", () => {
    const row = lineStarting(devReadme, "| `iris_doc_get` |");
    expect(row).toContain("`startLine?`, `endLine?`");
    expect(squash(devReadme)).toContain("**Without the parameters** the request and the result are unchanged: the whole document, as before.");
  });

  it("the iris_doc_put row states allowStorageRegeneration and ignoreConflict default false", () => {
    const row = lineStarting(devReadme, "| `iris_doc_put` |");
    expect(row).toContain("`ignoreConflict?` (default: **false**");
    expect(row).toContain("`allowStorageRegeneration?` (default: **false**");
  });

  it("the iris_doc_edit row and details: apply enabled by default with the disable snippet, regenerateStorage disabled by default", () => {
    const row = squash(lineStarting(devReadme, "| `iris_doc_edit` |"));
    expect(row).toContain("**`apply` is a write that is enabled by default**");
    expect(row).toContain('{"global": {"iris_doc_edit:apply": false}}');
    expect(row).toContain("**disabled by default**");
    expect(devEditDetails).toContain("`action: \"apply\"` is a **write that is enabled by default**");
    expect(devEditDetails).toContain("**disabled by default**");
  });

  it("the iris_doc_edit details explain the STALE_CONTENT retry with the trailing line break, and the example carries it", () => {
    expect(devEditDetails).toContain("Retrying a `STALE_CONTENT` refusal");
    expect(devEditDetails).toContain("plus one trailing `\\n`");
    expect(devEditDetails).toContain("passing it back unchanged as that edit's `expected` matches");
    expect(devEditDetailsRaw).toContain('"current": "  Quit \\"Hello World\\"\\n" }');
  });

  it("the iris_execute_tests re-attach section sends the manual %UnitTest_Result query to iris_sql_query, never iris_sql_execute (DW-555)", () => {
    const section = squash(
      /^To see the run through, re-attach rather than re-submit[\s\S]*?(?=^- \*\*Easier)/m.exec(devReadme)?.[0] ?? "",
    );
    expect(section, "the dev README has the re-attach section").not.toBe("");
    expect(section).toContain("then `iris_sql_query` (a read tool, so it also runs under the read-only preset)");
    expect(section).toContain("WHERE ti.InstanceIndex = ? -- parameters: [runIndex]");
    expect(section).not.toContain("iris_sql_execute");
  });

  it("the iris_sql_execute row states the three defaults", () => {
    const row = squash(lineStarting(devReadme, "| `iris_sql_execute` |"));
    expect(row).toContain("`readOnly`, default **false**");
    expect(row).toContain("`maxRowsAffected`, default **no cap**; `0` is a dry count");
    expect(row).toContain("`countOnly`, default **false**");
  });

  it("the SQL write safety note states the accepted values, global scope and fail-fast of both operator variables", () => {
    expect(devSqlNote).toContain("`IRIS_SQL_READ_ONLY` accepts `true` or `false` (case-insensitive)");
    expect(devSqlNote).toContain("`IRIS_SQL_MAX_ROWS_AFFECTED` a non-negative integer (`0` is valid)");
    expect(devSqlNote).toContain("an empty value counts as unset, and any other value fails startup, naming the variable");
    expect(devSqlNote).toContain("every profile inherits them, and there is no per-profile key");
    expect(devSqlNote).toContain("(every call read-only; unset by default)");
    expect(devSqlNote).toContain("(a non-negative integer ceiling; unset by default)");
    expect(devSqlNote).toContain("**statement-level read-only, not side-effect-free**");
  });
});

describe("Story 38.6: tool_support.md states each default", () => {
  it("row 3 (iris_doc_get): the range is optional and the whole document is returned when omitted", () => {
    const row = toolSupportRow(3, "iris_doc_get");
    expect(row).toContain("optional `startLine`/`endLine`");
    expect(row).toContain("whole document when omitted");
  });

  it("row 4 (iris_doc_put): the version-checked save, DOCUMENT_CONFLICT, STORAGE_DROPPED and the default of allowStorageRegeneration", () => {
    const row = toolSupportRow(4, "iris_doc_put");
    expect(row).toContain("version-checked save");
    expect(row).toContain("`DOCUMENT_CONFLICT`");
    expect(row).toContain("`ignoreConflict` default **false**");
    expect(row).toContain("`STORAGE_DROPPED`");
    expect(row).toContain("`allowStorageRegeneration` is `true` (default **false**)");
  });

  it("row 14 (iris_sql_execute): the three defaults", () => {
    const row = toolSupportRow(14, "iris_sql_execute");
    expect(row).toContain("`readOnly` (default **false**)");
    expect(row).toContain("`maxRowsAffected` (default **no cap**; `0` is a dry count)");
    expect(row).toContain("`countOnly` (default **false**)");
  });

  it("row 30 (iris_doc_edit): apply enabled by default, how to disable it, STALE_CONTENT with the current retry, DOCUMENT_CONFLICT", () => {
    const row = toolSupportRow(30, "iris_doc_edit");
    expect(row).toContain("`apply` is `write` and **enabled by default**");
    expect(row).toContain("`regenerateStorage` (the Storage-guard override) is `write` and **DEFAULT-DISABLED**");
    expect(row).toContain('Disable `apply` with `{"global":{"iris_doc_edit:apply":false}}`');
    expect(row).toContain("`STALE_CONTENT` refusal");
    expect(row).toContain("`mismatches[].current`, which can be passed back as `expected` unchanged");
    expect(row).toContain("`DOCUMENT_CONFLICT`");
  });

  it("the Story 38.5 note: both variables' accepted values, global scope, fail-fast, and the residual effects", () => {
    expect(toolSupportSqlNote).toContain("`IRIS_SQL_READ_ONLY` (unset by default; `true` or `false`, case-insensitive)");
    expect(toolSupportSqlNote).toContain("`IRIS_SQL_MAX_ROWS_AFFECTED` (unset by default; a non-negative integer, `0` valid)");
    expect(toolSupportSqlNote).toContain("both global (every profile inherits them, no per-profile key)");
    expect(toolSupportSqlNote).toContain("both failing startup on a malformed value");
    expect(toolSupportSqlNote).toContain("**statement-level read-only, not side-effect-free**");
    expect(toolSupportSqlNote).toContain("`$INCREMENT`/`$SEQUENCE` counters");
    expect(toolSupportSqlNote).toContain("`JOB` or device output");
  });
});

describe("Story 38.6: the SQL operator variables are documented in the root README, the three client-config guides and the launcher", () => {
  it("the root env rows say every profile inherits the variable and there is no per-profile key", () => {
    for (const variable of ["IRIS_SQL_READ_ONLY", "IRIS_SQL_MAX_ROWS_AFFECTED"]) {
      const row = lineStarting(rootReadme, `| \`${variable}\` |`);
      expect(row, variable).toContain("Global: every profile inherits it; no per-profile key.");
      expect(row, variable).toContain("A malformed value fails startup.");
    }
  });

  it("the fail-fast list of the root README names both variables before the transport clause", () => {
    const list = /Invalid configuration still fails startup fast\*\* \(([^)]*)\)/.exec(rootReadme)?.[1] ?? "";
    expect(list, "the fail-fast parenthesis").not.toBe("");
    const transport = list.indexOf("an unsupported `MCP_TRANSPORT`/`--transport` value");
    expect(transport, "the transport clause is still in the first parenthesis").toBeGreaterThan(-1);
    for (const variable of ["IRIS_SQL_READ_ONLY", "IRIS_SQL_MAX_ROWS_AFFECTED"]) {
      const at = list.indexOf(`\`${variable}\``);
      expect(at, `${variable} is in the fail-fast list`).toBeGreaterThan(-1);
      expect(at, `${variable} comes before the transport clause`).toBeLessThan(transport);
    }
    expect(list).toContain("a malformed `IRIS_SQL_READ_ONLY` or `IRIS_SQL_MAX_ROWS_AFFECTED`");
  });

  for (const guide of CLIENT_GUIDES) {
    it(`${guide}.md lists both variables with their defaults, covers both SQL tools, and counts the variables right`, () => {
      const section = readOnlySection(guide);
      const flat = squash(section);

      const readOnly = squash(lineStarting(section, "| `IRIS_SQL_READ_ONLY` |"));
      expect(readOnly).toContain("`true` or `false` (case-insensitive)");
      expect(readOnly).toContain("Unset by default (nothing is forced read-only)");
      expect(readOnly).toContain("Global: every profile inherits it; a malformed value fails startup.");
      expect(readOnly).toContain("a call's `readOnly: false` cannot weaken it");

      const affected = squash(lineStarting(section, "| `IRIS_SQL_MAX_ROWS_AFFECTED` |"));
      expect(affected).toContain("non-negative integer (`0` is valid)");
      expect(affected).toContain("Unset by default (no ceiling)");
      expect(affected).toContain("Global: every profile inherits it; a malformed value fails startup.");
      expect(affected).toContain("Under a ceiling only SELECT, INSERT, UPDATE and DELETE run (any other statement, DDL and `CALL` included, is refused before it runs");
      expect(affected).toContain("a call's `maxRowsAffected` can only tighten it");

      for (const variable of ["IRIS_SQL_MAX_ROWS", "IRIS_SQL_TIMEOUT"]) {
        expect(lineStarting(section, `| \`${variable}\` |`), `${variable} row covers both SQL tools`).toContain("`iris_sql_query`");
      }

      expect(flat).toContain("All five are **optional**");
      expect(flat).not.toContain("All three");
      expect(flat).toContain("the four `IRIS_SQL_*` variables govern the SQL tools `iris_sql_execute` and `iris_sql_query`");
      expect(flat).toContain("run queries through `iris_sql_query`");
    });
  }

  it("the launcher README lists both SQL variables and IRIS_TEST_TIMEOUT among the variables it leaves alone", () => {
    const flat = squash(launcherReadme);
    for (const variable of ["IRIS_SQL_READ_ONLY", "IRIS_SQL_MAX_ROWS_AFFECTED", "IRIS_TEST_TIMEOUT"]) {
      expect(flat, variable).toContain(`\`${variable}\``);
    }
    expect(flat).toContain("are deliberately left alone and still inherit");
    expect(flat).toContain("`IRIS_SQL_READ_ONLY`, `IRIS_SQL_MAX_ROWS_AFFECTED` and `IRIS_TEST_TIMEOUT` are unset by default");
    expect(flat).toContain("the two SQL safety variables are global: every profile the launcher writes inherits them");
  });
});

describe("Story 38.6: the edit-and-test-class prompt is documented where the prompts are listed", () => {
  it("the root README heading counts 13 prompts and its table has the dev row", () => {
    expect(rootReadme).toMatch(/^### The v1 pack . 13 prompts, grouped by owning server$/m);
    const row = squash(lineStarting(rootReadme, "| `@iris-mcp/dev` | `edit-and-test-class` |"));
    expect(row).toContain("`iris_doc_edit:apply` is enabled by default");
    expect(row).toContain("dev `core` preset");
  });

  it("the dev README prompts table has the row, with its arguments", () => {
    const row = squash(lineStarting(devReadme, "| `edit-and-test-class` |"));
    expect(row).toContain("`apply`, enabled by default");
    expect(row).toContain("`className`, `change` and an optional `testClass`");
  });

  it("tool_support.md counts 13 prompts with dev 5 and says the prompt adds no tool, key or default", () => {
    const flat = squash(toolSupport);
    expect(flat).toContain("a pack of 13 **MCP prompts** (`ops` 2, `dev` 5, `interop` 4, `admin` 2; `data` none in v1)");
    expect(flat).toContain("`dev` gained `edit-and-test-class` in Story 38.6");
    expect(flat).toContain("adds no tool, key or default");
  });

  it("the payload table names the story that last re-measured it", () => {
    expect(squash(rootReadme)).toMatch(/Last re-measured at Story \d+\.\d+ \(`pnpm measure:tools-payload`/);
  });

  it("the core preset's stated size spans the smallest and largest core roster of the payload table", () => {
    const cores = [...rootReadme.matchAll(/^\| @iris-mcp\/\w+ \| [^|]+ \| (\d+) \//gm)].map((match) => Number(match[1]));
    expect(cores, "the payload table has a core count for each of the five servers").toHaveLength(5);
    const phrase = `${Math.min(...cores)}- to ${Math.max(...cores)}-tool`;
    expect(rootReadme.match(new RegExp(phrase, "g")), "root README core size").toHaveLength(3);
    for (const guide of CLIENT_GUIDES) {
      expect(lineStarting(read(`docs/client-config/${guide}.md`), "| `IRIS_TOOLS_PRESET` |"), guide).toContain(phrase);
    }
  });
});

describe("Story 38.6: the CHANGELOG top section and the changeset", () => {
  const changelog = read("CHANGELOG.md");
  const sections = changelog.split(/^(?=## \[)/m).slice(1);
  const top =
    sections.find((section) =>
      /^## \[Pre-release[^\]]*\] . Story 38\.6: Editing and SQL safety docs, prompt and capstone$/.test(
        section.split("\n")[0] ?? "",
      ),
    ) ?? "";

  it("the CHANGELOG has the Story 38.6 section, with Added, Changed and Documentation headings", () => {
    expect(top, "the CHANGELOG has the Story 38.6 section").not.toBe("");
    const headings = top.split("\n").filter((line) => line.startsWith("### "));
    expect(headings).toEqual(["### Added", "### Changed", "### Documentation"]);
  });

  it("the section records the current change (DW-552), the hint change (DW-555) and the version check (DW-559)", () => {
    const flat = squash(top);
    expect(flat).toContain("`mismatches[].current` gains one trailing line break (DW-552; orchestrator decision #11)");
    expect(flat).toContain("name `iris_sql_query`, not `iris_sql_execute`, for the manual `%UnitTest_Result` query (DW-555)");
    expect(flat).toContain("`edit-and-test-class`");
    expect(flat).toContain("(DW-559)");
    expect(flat).toContain("`--no-file-parallelism`");
  });

  it("the section carries no roster-summary string, which docs-visibility-roster-sync reads from the first match in the file", () => {
    expect(top).not.toMatch(/(?:full|core|developer)\s*`?\s*\d+\/\d+\/\d+\/\d+\/\d+/);
  });

  it("the changeset bumps exactly @iris-mcp/dev, minor (AD-29)", () => {
    const changeset = read(".changeset/story-38-6-editing-and-sql-safety-docs-prompt-and-capstone.md");
    const frontMatter = /^---\n([\s\S]*?)\n---/.exec(changeset)?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontMatter
        .split("\n")
        .map((line) => /^"([^"]+)":\s*(\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1], match[2]]),
    );
    expect(bumps).toEqual({ "@iris-mcp/dev": "minor" });
  });
});

describe("Story 38.6: the @iris-mcp/all prepublish gate runs the capstone, one file at a time", () => {
  const script = read("packages/iris-mcp-all/scripts/prepublish-gate.mjs");

  it("gateTestFiles lists the capstone", () => {
    const literal = /const gateTestFiles = \[([\s\S]*?)\];/.exec(script)?.[1] ?? "";
    const listed = [...literal.replace(/\/\/[^\n]*/g, "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(listed).toContain("src/__tests__/epic38-capstone-gate.test.ts");
  });

  it("vitest runs the gate files with --no-file-parallelism, ahead of the file list", () => {
    expect(script).toContain('const vitestArgs = ["exec", "vitest", "run", "--no-file-parallelism", ...gateTestFiles];');
  });
});
