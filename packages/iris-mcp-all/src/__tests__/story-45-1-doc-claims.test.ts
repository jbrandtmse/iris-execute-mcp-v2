/**
 * Story 45.1 QA (AC 45.1.7; project rules #30, #43, #45) - the documents say what the SQL route now does, and every claim has an oracle
 * other than the document itself:
 *  - the dev README's "SQL privileges (Story 45.1)" blockquote sits inside the SQL Tools section, between the write-safety and the
 *    resource-caps blockquotes, and carries the claims of AC 45.1.7: the SQL privileges the account needs (administrative ones included),
 *    SQLCODE -99 ahead of the two refusal codes for the privileges IRIS checks at prepare, the minimum account, the residuals and the
 *    default state;
 *  - "ahead of `SQL_READ_ONLY` and `SQL_ROWS_AFFECTED_CAP`" names codes the SQL tool really emits (read from `sql.ts`);
 *  - "always on, with no setting" is derived: the built `iris_sql_execute` / `iris_sql_query` schemas have no privilege field, and the
 *    SQL environment variables `loadConfig` reads are exactly the four documented ones;
 *  - "the minimum account holds the `%Development` resource" is derived from the web application definitions in `Setup.cls`;
 *  - the CHANGELOG section names the sanction id, the ordering change, the Atelier residual and the `BOOTSTRAP_VERSION` move;
 *  - the changeset (asserted only while it exists: `changeset version` consumes it) is a patch bump of `@iris-mcp/dev` and
 *    `@iris-mcp/shared` and nothing else, and names the sanction id.
 * Needs no IRIS. The built dist is read for the tool-shape check; a stale dist fails the gate tests that own it.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { loadAllTools } from "../../../../scripts/lib/tool-catalog.mjs";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

const devReadme = read("packages/iris-dev-mcp/README.md");
const changelog = read("CHANGELOG.md");
const sqlTool = read("packages/iris-dev-mcp/src/tools/sql.ts");
const sharedConfig = read("packages/shared/src/config.ts");
const setupClass = read("src/ExecuteMCPv2/Setup.cls");
const changesetPath = ".changeset/story-45-1-sql-statements-honor-sql-privileges.md";

const BLOCK_START = "> **SQL privileges (Story 45.1):**";

/** The README blockquote paragraph that starts with `prefix` (blockquote paragraphs are single lines in this README). */
function paragraph(prefix: string): string {
  const line = devReadme.split("\n").find((candidate) => candidate.startsWith(prefix));
  expect(line, `a README line starting ${prefix}`).toBeDefined();
  return squash(line as string);
}

describe("Story 45.1: the dev README SQL privileges paragraph", () => {
  const text = paragraph(BLOCK_START);

  it("sits in the SQL Tools section, after the write-safety blockquote and before the resource-caps blockquote", () => {
    const at = devReadme.indexOf(BLOCK_START);
    const safety = devReadme.indexOf("> **SQL write safety (optional, opt-in");
    const caps = devReadme.indexOf("> **SQL resource caps (optional, opt-in)");
    expect(safety).toBeGreaterThan(-1);
    expect(caps).toBeGreaterThan(at);
    expect(at).toBeGreaterThan(safety);
    // Same section: no heading between the section's first blockquote and this one.
    const between = devReadme.slice(safety, at);
    expect(between, "no heading between the write-safety blockquote and the privileges paragraph").not.toMatch(/^#{1,6} /m);
    expect(devReadme.split(BLOCK_START)).toHaveLength(2);
  });

  it("states what the account needs, the error, the ordering, the minimum account, the residual and the default state", () => {
    for (const needle of [
      "both SQL tools prepare each statement with SQL privilege checking on",
      "SELECT (INSERT, UPDATE or DELETE for writes) on each table",
      "EXECUTE on each SqlProc function or procedure it calls",
      "`SQL error` with `SQLCODE: -99`",
      "answers ahead of `SQL_READ_ONLY` and `SQL_ROWS_AFFECTED_CAP`, and nothing runs",
      "each SQL administrative privilege a statement uses (for example `%CREATE_TABLE` for CREATE TABLE, `%NOTRIGGER` for TRUNCATE TABLE, `%NOJOURN` for a statement with `%NOJOURN`",
      "This holds for the privileges IRIS checks at prepare",
      "IRIS checks GRANT and some DDL (for example CREATE INDEX) only at execution",
      "its database resources, not its SQL grants, bound the data",
      "`%Development` resource (`U`) and the namespace's database resource (`R` for reads, `RW` for writes), plus the SQL grants",
      "IRIS's own Atelier `action/query`",
      "prepares with checking off",
      "Default state: always on, with no setting.",
    ]) {
      expect(text, needle).toContain(needle);
    }
  });

  it("names refusal codes the SQL tool really emits", () => {
    for (const code of ["SQL_READ_ONLY", "SQL_ROWS_AFFECTED_CAP"]) {
      expect(text, code).toContain(`\`${code}\``);
      expect(sqlTool, `${code} in sql.ts`).toContain(`REFUSAL_CODES.${code}`);
    }
  });

  it("'always on, with no setting' holds: no privilege field on either tool, and the SQL environment variables are the four documented ones", async () => {
    const all = (await loadAllTools(REPO_ROOT)) as Array<{ tool: { name: string; inputSchema: { shape: Record<string, unknown> } } }>;
    for (const name of ["iris_sql_execute", "iris_sql_query"]) {
      const entry = all.find(({ tool }) => tool.name === name);
      expect(entry, `${name} is in the catalog`).toBeDefined();
      const fields = Object.keys(entry?.tool.inputSchema.shape ?? {});
      expect(fields.filter((field) => /priv|grant|check/i.test(field)), `${name} input fields: ${fields.join(", ")}`).toEqual([]);
    }
    const variables = [...new Set([...sharedConfig.matchAll(/env\.(IRIS_SQL_[A-Z_]+)/g)].map((match) => match[1]))].sort();
    expect(variables).toEqual(["IRIS_SQL_MAX_ROWS", "IRIS_SQL_MAX_ROWS_AFFECTED", "IRIS_SQL_READ_ONLY", "IRIS_SQL_TIMEOUT"]);
  });

  it("'the minimum account holds %Development' holds: both web applications ExecuteMCPv2 deploys carry that resource", () => {
    const resources = [...setupClass.matchAll(/Set tProps\("Resource"\) = "([^"]+)"/g)].map((match) => match[1]);
    expect(resources.length).toBeGreaterThanOrEqual(2);
    expect(new Set(resources)).toEqual(new Set(["%Development"]));
  });

  it("leaves the SQL write-safety blockquote's claims in place (the row is added to, not rewritten)", () => {
    const safety = paragraph("> **SQL write safety (optional, opt-in");
    expect(safety).toContain("`iris_sql_query` always runs read-only");
    expect(safety).toContain("Both tools run through the ExecuteMCPv2 `/dev/sql/execute` endpoint");
  });
});

describe("Story 45.1: the CHANGELOG entry", () => {
  // Found by its title, not its position: a later story's section may sit above it, and the release relabels the heading.
  const section = /^## \[[^\]\n]*\] [-—–] Story 45\.1: SQL Statements Honor SQL Privileges\n[\s\S]*?(?=\n## \[)/m.exec(changelog)?.[0] ?? "";

  it("is a section above the 1.2.0 release's, with the behavior-change, limitation and IRIS-side blocks", () => {
    expect(section, "the Story 45.1 section").not.toBe("");
    expect(changelog.indexOf(section)).toBeLessThan(changelog.indexOf("\n## [1.2.0] — "));
    for (const heading of ["### Behavior changes", "### Known limitation", "### IRIS side"]) expect(section, heading).toContain(heading);
  });

  it("names the sanction id, the error, the ordering change, the grants an account needs and the Atelier residual", () => {
    const text = squash(section);
    for (const needle of [
      "`S-45.1-sql-privileges`",
      "GitHub issue #1 point 4",
      "`SQLCODE: -99`",
      "`User <name> is not privileged for the operation`",
      "SELECT (INSERT, UPDATE or DELETE for writes) on each table and EXECUTE on each SqlProc function or procedure",
      "write and create tables through `iris_sql_execute`",
      "each SQL administrative privilege a statement uses",
      "Nothing turns the check off.",
      "byte-identical requests and responses",
      "`SQL_READ_ONLY`, `SQL_ROWS_AFFECTED_CAP` or the `countOnly` message",
      "IRIS checks GRANT and some DDL (for example CREATE INDEX) only at execution",
      "Atelier `action/query` is unchanged",
      "prepares with privilege checking off",
    ]) {
      expect(text, needle).toContain(needle);
    }
  });

  it("records BOOTSTRAP_VERSION from -> to as two different 1.2.0 content-hash versions", () => {
    const moved = /`BOOTSTRAP_VERSION` moves from `([^`]+)` to `([^`]+)`/.exec(section);
    expect(moved, "the from -> to sentence").not.toBeNull();
    const [, from, to] = moved as RegExpExecArray;
    expect(from).toMatch(/^1\.2\.0\+\d+\.[0-9a-f]{12}$/);
    expect(to).toMatch(/^1\.2\.0\+\d+\.[0-9a-f]{12}$/);
    expect(to).not.toBe(from);
    expect(squash(section)).toContain("`ExecuteMCPv2.REST.Sql` prepares with `%Prepare(.pQuery, 1)`");
  });
});

describe("Story 45.1: the changeset", () => {
  // `changeset version` consumes (deletes) the file and moves its text into the generated package changelogs, so it is checked while it exists.
  const present = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!present)("bumps @iris-mcp/dev and @iris-mcp/shared patch, and nothing else, and names the sanction id and the ordering change", () => {
    const text = read(changesetPath);
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
    expect(front.split("\n").map((line) => line.trim()).sort()).toEqual(['"@iris-mcp/dev": patch', '"@iris-mcp/shared": patch']);
    const body = squash(text);
    for (const needle of [
      "`S-45.1-sql-privileges`",
      "GitHub issue #1 point 4",
      "`SQLCODE: -99`",
      "no setting, request field or environment variable that turns the check off",
      "`SQL_READ_ONLY`, `SQL_ROWS_AFFECTED_CAP`",
      "IRIS checks GRANT and some DDL (for example CREATE INDEX) only at execution",
      "byte-identical",
      "Atelier `action/query`",
    ]) {
      expect(body, needle).toContain(needle);
    }
  });
});
