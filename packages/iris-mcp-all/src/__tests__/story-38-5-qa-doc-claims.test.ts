/**
 * Story 38.5 (AC-4, AC-5, AC-6, AD-29) -- the documentation claims about SQL write safety, held against
 * the thing each one describes.
 *
 * The unit suites pin the tools against mock HTTP and the live gates pin them against IRIS; neither reads
 * a document. This file pins what they leave open, in the default suite:
 *
 *  - Each operator variable's documented default and accepted values (`unset`, `true`/`false` in any letter
 *    case, `0` valid, a malformed value fails startup) are what the BUILT `loadConfig` does, and the tool
 *    descriptions repeat the defaults.
 *  - The dev README's tool-table rows list exactly the tools' schema parameters, with `?` on the optional
 *    ones, and the annotation column matches the tools' annotation hints.
 *  - The README's examples are EXECUTED: the built `iris_sql_execute` and `iris_sql_query` are fed the shape
 *    the endpoint returns, given the README's own input, and their results must equal the README's output
 *    blocks and inline literals.
 *  - The CHANGELOG quotes the refusal `structuredContent` field lists and the order of the additive result
 *    fields (`rowsAffected`, `totalCount`, `readOnlyForced`, `maxRowsAffectedCapped`); each is compared with
 *    the key order the built tool really produces. The unit suites compare these with `toEqual`, which
 *    ignores key order, so a reordered result passes them.
 *  - The route, the default state of `iris_sql_query` (a `read`, enabled by default) and the changeset bumps
 *    (AD-29) are what the docs and the source say.
 *
 * Needs no IRIS. It reads the built shared and dev dists and FAILS (never skips) when either is missing or
 * stale, because a skip would leave every check here a dead one. Cross-package documentation checks live in
 * `@iris-mcp/all` (Rule #45). The endpoint shapes the fakes return were captured from the live route on
 * 2026-10-16 (`{outcome, statementType, statementTypeName, content, totalCount?}`), never invented (Rule #54).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

interface BuiltToolResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface BuiltSqlTool {
  name: string;
  description: string;
  mutates?: string;
  parent?: string;
  annotations: Record<string, boolean>;
  inputSchema: { shape: Record<string, { isOptional: () => boolean }> };
  handler: (args: unknown, ctx: unknown) => Promise<BuiltToolResult>;
}

interface BuiltShared {
  loadConfig: (env: Record<string, string | undefined>) => Record<string, unknown>;
  REFUSAL_CODES: Record<string, string>;
}

let builtPromise: Promise<{ execute: BuiltSqlTool; query: BuiltSqlTool; shared: BuiltShared }> | undefined;

/** The built dev SQL tools and the built shared barrel; throws when either dist is missing or stale. */
function built(): Promise<{ execute: BuiltSqlTool; query: BuiltSqlTool; shared: BuiltShared }> {
  builtPromise ??= (async () => {
    for (const [dir, label] of [
      ["shared", "@iris-mcp/shared"],
      ["iris-dev-mcp", "@iris-mcp/dev"],
    ] as const) {
      const fresh = checkDistFresh(path.join(REPO_ROOT, "packages", dir), label);
      if (!fresh.ok || fresh.skipped) {
        throw new Error(`${fresh.reason ?? `${label} declares no dist/ build output.`} Rebuild: pnpm --filter ${label} build`);
      }
    }
    const shared = (await import(pathToFileURL(path.join(REPO_ROOT, "packages", "shared", "dist", "index.js")).href)) as BuiltShared;
    const dev = (await import(pathToFileURL(path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "tools", "sql.js")).href)) as {
      sqlExecuteTool: BuiltSqlTool;
      sqlQueryTool: BuiltSqlTool;
    };
    return { execute: dev.sqlExecuteTool, query: dev.sqlQueryTool, shared };
  })();
  return builtPromise;
}

/** What the `/dev/sql/execute` route puts in `result` (captured live; see the header). */
type EndpointResult = Record<string, unknown>;

/** A tool context whose POST to the SQL route answers `endpoint`; `posts` records what was sent. */
function fakeCtx(endpoint: EndpointResult, config: Record<string, unknown> = {}): { ctx: unknown; posts: Array<{ path: string; body: Record<string, unknown> }> } {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const ctx = {
    atelierVersion: 8,
    config,
    resolveNamespace: (namespace?: string) => namespace ?? "USER",
    http: {
      post: async (postPath: string, body: Record<string, unknown>) => {
        posts.push({ path: postPath, body });
        return { status: { errors: [] }, console: [], result: endpoint };
      },
    },
  };
  return { ctx, posts };
}

/** The bodies of the ```json fences in `section`, in order. */
function jsonBlocks(section: string): string[] {
  return [...section.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1] ?? "");
}

/** The inline-code JSON objects of `section` that start with `{"columns"`, parsed, in order. */
function inlineResults(section: string): Array<Record<string, unknown>> {
  return [...section.matchAll(/`(\{"columns"[^`]*\})`/g)].map((match) => JSON.parse(match[1] ?? "") as Record<string, unknown>);
}

const SELECT_ROWS: EndpointResult = {
  outcome: "ok",
  statementType: 1,
  statementTypeName: "SELECT",
  content: [
    { Name: "MyApp.Service", Super: "%RegisteredObject" },
    { Name: "MyApp.Utils", Super: "" },
  ],
};

const rootReadme = read("README.md");
const devReadme = read("packages/iris-dev-mcp/README.md");
const toolSupport = read("tool_support.md");
const changelogSection =
  /^## \[Pre-release[^\]]*\] . Story 38\.5: SQL write safety$[\s\S]*?(?=\n## \[)/m.exec(read("CHANGELOG.md"))?.[0] ?? "";
const changeset = read(".changeset/story-38-5-sql-write-safety.md");
const squash = (text: string): string => text.replace(/\s+/g, " ");

/** The cells of the markdown table row of `table` that starts with `startsWith`. */
function rowCells(table: string, startsWith: string): string[] {
  const line = table.split("\n").find((candidate) => candidate.startsWith(startsWith));
  expect(line, `a table row starting ${startsWith}`).toBeDefined();
  return (line as string).split("|").slice(1, -1).map((cell) => cell.trim());
}

const BASE_ENV = {
  IRIS_HOST: "localhost",
  IRIS_PORT: "52773",
  IRIS_USERNAME: "u",
  IRIS_PASSWORD: "p",
  IRIS_NAMESPACE: "USER",
  IRIS_HTTPS: "false",
};

describe("Story 38.5: the operator variables are documented as the built loadConfig treats them", () => {
  it("each variable has an env-table row whose default is 'unset', and unset leaves the config field absent", async () => {
    const { shared } = await built();
    for (const [variable, field] of [
      ["IRIS_SQL_READ_ONLY", "sqlReadOnly"],
      ["IRIS_SQL_MAX_ROWS_AFFECTED", "sqlMaxRowsAffected"],
    ] as const) {
      const cells = rowCells(rootReadme, `| \`${variable}\` |`);
      expect(cells[1], `${variable} default cell`).toMatch(/^\*\(unset/);
      expect(cells[2], `${variable} says a malformed value fails startup`).toContain("A malformed value fails startup.");

      const config = shared.loadConfig({ ...BASE_ENV });
      expect(Object.prototype.hasOwnProperty.call(config, field), `${field} absent when ${variable} is unset`).toBe(false);
      const empty = shared.loadConfig({ ...BASE_ENV, [variable]: "" });
      expect(Object.prototype.hasOwnProperty.call(empty, field), `${field} absent when ${variable} is empty`).toBe(false);
    }
  });

  it("IRIS_SQL_READ_ONLY: 'true' or 'false' in any letter case; anything else throws naming the variable", async () => {
    const { shared } = await built();
    const cells = rowCells(rootReadme, "| `IRIS_SQL_READ_ONLY` |");
    expect(cells[2]).toContain("`true` or `false` (case-insensitive)");

    expect(shared.loadConfig({ ...BASE_ENV, IRIS_SQL_READ_ONLY: "TRUE" }).sqlReadOnly).toBe(true);
    expect(shared.loadConfig({ ...BASE_ENV, IRIS_SQL_READ_ONLY: "False" }).sqlReadOnly).toBe(false);
    expect(() => shared.loadConfig({ ...BASE_ENV, IRIS_SQL_READ_ONLY: "yes" })).toThrow(
      'IRIS_SQL_READ_ONLY must be "true" or "false". Received: "yes".',
    );
  });

  it("IRIS_SQL_MAX_ROWS_AFFECTED: a non-negative integer, 0 valid; anything else throws naming the variable", async () => {
    const { shared } = await built();
    const cells = rowCells(rootReadme, "| `IRIS_SQL_MAX_ROWS_AFFECTED` |");
    expect(cells[2]).toContain("Non-negative integer ceiling (`0` is valid)");

    expect(shared.loadConfig({ ...BASE_ENV, IRIS_SQL_MAX_ROWS_AFFECTED: "0" }).sqlMaxRowsAffected).toBe(0);
    expect(shared.loadConfig({ ...BASE_ENV, IRIS_SQL_MAX_ROWS_AFFECTED: "25" }).sqlMaxRowsAffected).toBe(25);
    for (const bad of ["-1", "2.5", "many"]) {
      expect(() => shared.loadConfig({ ...BASE_ENV, IRIS_SQL_MAX_ROWS_AFFECTED: bad }), bad).toThrow(
        `IRIS_SQL_MAX_ROWS_AFFECTED must be a non-negative integer. Received: "${bad}".`,
      );
    }
  });

  it("the 'single-server installs' sentence, the dev README and the tool descriptions all say unset is the default", async () => {
    const { execute, query } = await built();
    expect(rootReadme).toContain("`IRIS_SQL_READ_ONLY` (unset: nothing forced read-only), `IRIS_SQL_MAX_ROWS_AFFECTED` (unset: no ceiling)");
    expect(devReadme).toContain("`IRIS_SQL_READ_ONLY=true` (every call read-only; unset by default)");
    expect(devReadme).toContain("`IRIS_SQL_MAX_ROWS_AFFECTED` (a non-negative integer ceiling; unset by default)");
    expect(execute.description).toContain("IRIS_SQL_READ_ONLY=true (every call is read-only; unset by default)");
    expect(execute.description).toContain("(a non-negative integer ceiling no call can raise; unset by default)");
    expect(execute.description).toContain("readOnly (default: false)");
    expect(execute.description).toContain("maxRowsAffected (default: no cap)");
    expect(execute.description).toContain("countOnly (default: false)");
    expect(query.description).toContain("IRIS_SQL_MAX_ROWS");
    expect(query.description).toContain("IRIS_SQL_TIMEOUT");
  });
});

describe("Story 38.5: the dev README's SQL rows list the tools' real parameters and annotations", () => {
  it("each row's Key Parameters cell is the schema's parameter names in order, '?' on the optional ones", async () => {
    const built_ = await built();
    for (const tool of [built_.execute, built_.query]) {
      const cells = rowCells(devReadme, `| \`${tool.name}\` |`);
      const documented = (cells[2] ?? "").split(", ").map((cell) => cell.replace(/`/g, ""));
      const actual = Object.entries(tool.inputSchema.shape).map(([name, field]) => (field.isOptional() ? `${name}?` : name));
      expect(documented, `${tool.name} parameters`).toEqual(actual);
    }
  });

  it("each row's Annotations cell names the hints the tool really sets ('--' for none)", async () => {
    const built_ = await built();
    const tokens: Array<[string, string]> = [
      ["readOnlyHint", "readOnly"],
      ["destructiveHint", "destructive"],
      ["idempotentHint", "idempotent"],
      ["openWorldHint", "openWorld"],
    ];
    for (const tool of [built_.execute, built_.query]) {
      const cells = rowCells(devReadme, `| \`${tool.name}\` |`);
      const set = tokens.filter(([hint]) => tool.annotations[hint] === true).map(([, name]) => name);
      expect(cells[3], `${tool.name} annotations`).toBe(set.length > 0 ? set.join(", ") : "--");
    }
  });
});

describe("Story 38.5: the dev README's examples are what the built tools return", () => {
  const executeSection = /<summary><strong>iris_sql_execute<\/strong>[\s\S]*?<\/details>/.exec(devReadme)?.[0] ?? "";
  const querySection = /<summary><strong>iris_sql_query<\/strong>[\s\S]*?<\/details>/.exec(devReadme)?.[0] ?? "";

  it("iris_sql_execute: the input block yields the output block", async () => {
    const { execute } = await built();
    expect(executeSection, "README has the iris_sql_execute example").not.toBe("");
    const [input, output] = jsonBlocks(executeSection);
    expect(output, "an output block was parsed").toBeDefined();

    const { ctx } = fakeCtx(SELECT_ROWS);
    const result = await execute.handler(JSON.parse(input ?? ""), ctx);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(JSON.parse(output ?? ""));
  });

  it("iris_sql_execute: the capped DELETE example is refused with exactly the documented structuredContent, in the documented key order", async () => {
    const { execute } = await built();
    const blocks = jsonBlocks(executeSection);
    const input = JSON.parse(blocks[2] ?? "") as Record<string, unknown>;
    const documented = JSON.parse(blocks[3] ?? "") as { isError: boolean; structuredContent: Record<string, unknown> };
    expect(documented.structuredContent.code).toBe("SQL_ROWS_AFFECTED_CAP");

    const { ctx, posts } = fakeCtx({ outcome: "overCap", statementType: 4, statementTypeName: "DELETE", rowsAffected: 3 });
    const result = await execute.handler(input, ctx);

    expect(posts[0]?.body.maxRowsAffected, "the README's maxRowsAffected reaches the endpoint").toBe(2);
    expect(result.isError).toBe(documented.isError);
    expect(result.structuredContent).toEqual(documented.structuredContent);
    expect(Object.keys(result.structuredContent as object)).toEqual(Object.keys(documented.structuredContent));
  });

  it("iris_sql_execute: the inline results (a DML within the cap, a countOnly SELECT) are what the built tool returns", async () => {
    const { execute } = await built();
    const literals = inlineResults(executeSection);
    const dml = literals.find((literal) => "rowsAffected" in literal);
    const counted = literals.find((literal) => "totalCount" in literal);
    expect(dml, "README has the within-the-cap result").toBeDefined();
    expect(counted, "README has the countOnly result").toBeDefined();

    const within = await execute.handler(
      { query: "DELETE FROM Sample.Person WHERE Age > 90", maxRowsAffected: 5 },
      fakeCtx({ outcome: "ok", statementType: 4, statementTypeName: "DELETE", content: [], rowsAffected: dml?.rowsAffected }).ctx,
    );
    expect(within.structuredContent).toEqual(dml);

    const count = await execute.handler(
      { query: "SELECT Name FROM Sample.Person", countOnly: true },
      fakeCtx({ outcome: "ok", statementType: 1, statementTypeName: "SELECT", content: [], totalCount: counted?.totalCount }).ctx,
    );
    expect(count.structuredContent).toEqual(counted);
  });

  it("iris_sql_query: the input block yields the documented output, and countOnly yields the documented count", async () => {
    const { query } = await built();
    expect(querySection, "README has the iris_sql_query example").not.toBe("");
    const input = JSON.parse(jsonBlocks(querySection)[0] ?? "") as Record<string, unknown>;
    const [rows, counted] = inlineResults(querySection);
    expect(rows, "README has the query output").toBeDefined();
    expect(counted, "README has the countOnly output").toBeDefined();

    const read = await query.handler(
      input,
      fakeCtx({
        outcome: "ok",
        statementType: 1,
        statementTypeName: "SELECT",
        content: [{ Name: "MyApp.Service" }, { Name: "MyApp.Utils" }],
      }).ctx,
    );
    expect(read.structuredContent).toEqual(rows);

    const count = await query.handler(
      { ...input, countOnly: true },
      fakeCtx({ outcome: "ok", statementType: 1, statementTypeName: "SELECT", content: [], totalCount: counted?.totalCount }).ctx,
    );
    expect(count.structuredContent).toEqual(counted);
  });

  it("iris_sql_query: a CALL is refused with SQL_READ_ONLY and readOnlySource 'tool', as the README says", async () => {
    const { query } = await built();
    expect(querySection).toContain('`SQL_READ_ONLY` and `readOnlySource: "tool"`');

    const result = await query.handler(
      { query: "CALL Sample.Proc()" },
      fakeCtx({ outcome: "readOnly", statementType: 45, statementTypeName: "CALL" }).ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ code: "SQL_READ_ONLY", namespace: "USER", statementType: "CALL", readOnlySource: "tool" });
  });
});

describe("Story 38.5: the CHANGELOG's shape claims are what the built tool produces", () => {
  const flat = squash(changelogSection);

  /** The names inside the first `{...}` that follows `marker` in the squashed section. */
  function fieldList(marker: string): string[] {
    const start = flat.indexOf(marker);
    expect(start, `the CHANGELOG has ${marker}`).toBeGreaterThanOrEqual(0);
    const open = flat.indexOf("{", start);
    const close = flat.indexOf("}", open);
    return flat
      .slice(open + 1, close)
      .split(",")
      .map((name) => name.trim());
  }

  it("the section exists and names the two codes in the REFUSAL_CODES catalog", async () => {
    const { shared } = await built();
    expect(changelogSection, "the Story 38.5 CHANGELOG section").not.toBe("");
    for (const code of ["SQL_READ_ONLY", "SQL_ROWS_AFFECTED_CAP"]) {
      expect(shared.REFUSAL_CODES[code], `${code} in REFUSAL_CODES`).toBe(code);
      expect(changelogSection, `CHANGELOG names ${code}`).toContain(`\`${code}\``);
      expect(devReadme, `dev README names ${code}`).toContain(`\`${code}\``);
      expect(toolSupport, `tool_support.md names ${code}`).toContain(`\`${code}\``);
    }
  });

  it("the documented refusal field lists are the key order of the built refusals", async () => {
    const { execute } = await built();
    const readOnlyDoc = fieldList("`SQL_READ_ONLY`: `");
    const notRunDoc = fieldList("`SQL_ROWS_AFFECTED_CAP`: `");
    expect(flat).toContain("and the same plus `rowsAffected` (after `statementType`) when it was rolled back");

    const readOnly = await execute.handler(
      { query: "UPDATE T SET A = 1", readOnly: true },
      fakeCtx({ outcome: "readOnly", statementType: 3, statementTypeName: "UPDATE" }).ctx,
    );
    expect(Object.keys(readOnly.structuredContent as object)).toEqual(readOnlyDoc);

    const notRun = await execute.handler(
      { query: "CALL P()", maxRowsAffected: 3 },
      fakeCtx({ outcome: "capNotCountable", statementType: 45, statementTypeName: "CALL" }).ctx,
    );
    expect(Object.keys(notRun.structuredContent as object)).toEqual(notRunDoc);

    const rolledBack = await execute.handler(
      { query: "DELETE FROM T", maxRowsAffected: 1 },
      fakeCtx({ outcome: "overCap", statementType: 4, statementTypeName: "DELETE", rowsAffected: 2 }).ctx,
    );
    const after = [...notRunDoc];
    after.splice(after.indexOf("statementType") + 1, 0, "rowsAffected");
    expect(Object.keys(rolledBack.structuredContent as object)).toEqual(after);
  });

  it("the additive result fields come in the documented order: rowsAffected, totalCount, readOnlyForced, maxRowsAffectedCapped", async () => {
    const { execute } = await built();
    const paragraph = /\*\*Result fields\.\*\*[^]*?Every pre-existing field is unchanged\./.exec(changelogSection)?.[0] ?? "";
    const documentedOrder = ["rowsAffected", "totalCount", "readOnlyForced", "maxRowsAffectedCapped"].sort(
      (a, b) => paragraph.indexOf(a) - paragraph.indexOf(b),
    );
    expect(paragraph, "the Result fields paragraph").not.toBe("");
    expect(documentedOrder, "the CHANGELOG lists them in this order").toEqual([
      "rowsAffected",
      "totalCount",
      "readOnlyForced",
      "maxRowsAffectedCapped",
    ]);

    // An INSERT/UPDATE/DELETE under the operator's ceiling carries rowsAffected, then maxRowsAffectedCapped.
    const capped = await execute.handler(
      { query: "UPDATE T SET A = 1" },
      fakeCtx({ outcome: "ok", statementType: 3, statementTypeName: "UPDATE", content: [], rowsAffected: 1 }, { sqlMaxRowsAffected: 5 }).ctx,
    );
    expect(Object.keys(capped.structuredContent as object)).toEqual(["columns", "rows", "rowCount", "rowsAffected", "maxRowsAffectedCapped"]);

    // A countOnly SELECT forced read-only by the operator carries totalCount, then readOnlyForced.
    const forced = await execute.handler(
      { query: "SELECT A FROM T", countOnly: true },
      fakeCtx({ outcome: "ok", statementType: 1, statementTypeName: "SELECT", content: [], totalCount: 4 }, { sqlReadOnly: true }).ctx,
    );
    expect(Object.keys(forced.structuredContent as object)).toEqual(["columns", "rows", "rowCount", "totalCount", "readOnlyForced"]);
    expect(forced.content[0]?.text).toBe(JSON.stringify(forced.structuredContent, null, 2));
  });
});

describe("Story 38.5: the route, the default state and the release bumps", () => {
  it("both tools post to the route tool_support.md names, and the Dispatch UrlMap serves it", async () => {
    const { execute, query } = await built();
    const route = "/dev/sql/execute";

    for (const tool of [execute, query]) {
      const { ctx, posts } = fakeCtx(SELECT_ROWS);
      await tool.handler({ query: "SELECT 1" }, ctx);
      expect(posts[0]?.path, `${tool.name} posts to the ExecuteMCPv2 route`).toBe(`/api/executemcp/v2${route}`);
    }
    // tool_support.md rows: | # | tool | type | route and notes |
    const executeRow = rowCells(toolSupport, "| 14 | `iris_sql_execute` |");
    const queryRow = rowCells(toolSupport, "| 31 | `iris_sql_query` |");
    expect(executeRow[2], "iris_sql_execute is an ExecuteMCPv2-backed tool").toContain("ExecuteMCPv2");
    expect(queryRow[2], "iris_sql_query is an ExecuteMCPv2-backed tool").toContain("ExecuteMCPv2");
    expect(squash(executeRow[3] ?? "")).toContain(`POST ${route}`);
    expect(squash(queryRow[3] ?? "")).toContain(`POST ${route}`);

    const dispatch = read("src/ExecuteMCPv2/REST/Dispatch.cls");
    expect(dispatch).toContain(`<Route Url="${route}" Method="POST" Call="ExecuteMCPv2.REST.Sql:Execute" />`);
    expect(existsSync(path.join(REPO_ROOT, "src", "ExecuteMCPv2", "REST", "Sql.cls"))).toBe(true);
  });

  it("iris_sql_query is a read with the parent iris_sql_execute, and every doc surface says it is enabled by default", async () => {
    const { query, execute } = await built();
    expect(query.mutates).toBe("read");
    expect(query.parent).toBe("iris_sql_execute");
    expect(execute.parent, "the frozen tool declares no parent").toBeUndefined();

    expect(rowCells(devReadme, "| `iris_sql_query` |")[1]).toContain("read, enabled by default, available under the read-only preset");
    expect(squash(rowCells(toolSupport, "| 31 | `iris_sql_query` |")[3] ?? "")).toContain("`read` and **enabled by default**");
    expect(squash(changelogSection)).toContain("is a `read`, **enabled by default**");
    expect(squash(devReadme)).toContain("`iris_sql_query` (Story 38.5) is classified `read` and is therefore **enabled by default**");
    expect(squash(rootReadme)).toContain("`iris_sql_query` declares the parent `iris_sql_execute` (Story 38.5)");
    expect(query.description).toContain("this tool is enabled by default");
  });

  it("the changeset bumps exactly @iris-mcp/shared and @iris-mcp/dev, both minor (AD-29)", () => {
    const frontMatter = /^---\n([\s\S]*?)\n---/.exec(changeset)?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontMatter
        .split("\n")
        .map((line) => /^"([^"]+)":\s*(\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1], match[2]]),
    );
    expect(bumps).toEqual({ "@iris-mcp/shared": "minor", "@iris-mcp/dev": "minor" });
  });
});
