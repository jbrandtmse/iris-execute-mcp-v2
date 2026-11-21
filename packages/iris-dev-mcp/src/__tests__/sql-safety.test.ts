/**
 * Story 38.5 (AC-2 to AC-6) - the SQL write-safety matrix for `iris_sql_execute` and `iris_sql_query`
 * against mocked HTTP.
 *
 * Every fake returns a shape the `/dev/sql/execute` endpoint can return (`ExecuteMCPv2.REST.Sql`, Rule
 * #54): a statement type and name IRIS reports, the outcome that type can produce, and the fields that
 * outcome carries. The refusal and error texts below are literals typed from the spec's I/O matrix, not
 * built from the implementation's templates, so a changed word fails here. The IRIS side of each row (the
 * transaction, the rollback, the counts) is proven live in `sql-safety-live-gate.test.ts`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { sqlExecuteTool, sqlQueryTool } from "../tools/sql.js";
import { createMockHttp, createMockCtx } from "./test-helpers.js";
import {
  SQL_PATH,
  declined,
  endpointBody,
  executed,
  executedDml,
  executedOther,
  fromNewerEndpoint,
} from "./sql-test-support.js";

type Tool = typeof sqlExecuteTool;

describe("SQL write safety (Story 38.5)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  /** A context whose config carries the given operator settings. */
  function withConfig(config: Record<string, unknown>): void {
    ctx = { ...ctx, config: { ...ctx.config, ...config } };
  }

  function call(tool: Tool, args: Record<string, unknown>) {
    return tool.handler(args, ctx);
  }

  function sentBody(): Record<string, unknown> {
    return mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
  }

  const DELETE_QUERY = "DELETE FROM Sample.Person WHERE Age > 90";
  const UPDATE_QUERY = "UPDATE Sample.Person SET Age = 0";

  // -- Default paths ---------------------------------------------------

  describe("default paths (no control in force)", () => {
    it("a SELECT sends the explicit defaults and returns today's object", async () => {
      mockHttp.post.mockResolvedValue(executed([{ ID: 1, Name: "A" }]));

      const result = await call(sqlExecuteTool, { query: "SELECT ID, Name FROM T" });

      expect(sentBody()).toEqual({
        query: "SELECT ID, Name FROM T",
        namespace: "USER",
        readOnly: false,
        countOnly: false,
        maxRowsAffected: null,
      });
      expect(result.structuredContent).toEqual({ columns: ["ID", "Name"], rows: [[1, "A"]], rowCount: 1 });
    });

    it("a DELETE that changed 3 rows returns rowsAffected 3 and nothing else new", async () => {
      mockHttp.post.mockResolvedValue(executedDml(4, "DELETE", 3));

      const result = await call(sqlExecuteTool, { query: DELETE_QUERY });

      expect(sentBody()).toEqual(endpointBody(DELETE_QUERY));
      expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: 3 });
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify({ columns: [], rows: [], rowCount: 0, rowsAffected: 3 }, null, 2) },
      ]);
      expect(result.isError).toBeUndefined();
    });

    it("an INSERT and an UPDATE carry rowsAffected too, including 0 and IRIS's -1 for TRUNCATE TABLE", async () => {
      for (const [type, name, affected] of [
        [2, "INSERT", 1],
        [3, "UPDATE", 0],
        [4, "DELETE", -1],
      ] as const) {
        mockHttp.post.mockResolvedValueOnce(executedDml(type, name, affected));
        const result = await call(sqlExecuteTool, { query: "STATEMENT" });
        expect(result.structuredContent, name).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: affected });
      }
    });

    it("DDL runs as today: no rows, and no rowsAffected", async () => {
      mockHttp.post.mockResolvedValue(
        executedOther(9, "CREATE TABLE", []),
      );

      const result = await call(sqlExecuteTool, { query: "CREATE TABLE T (A INT)" });

      expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0 });
      expect(result.isError).toBeUndefined();
    });

    it("a CALL returns the rows of every result set in order, with columns from the first row, and no rowsAffected", async () => {
      mockHttp.post.mockResolvedValue(
        executedOther(45, "CALL", [{ ID: "1", Name: "A" }, { ID: "2", Name: "B" }, { N: "2" }]),
      );

      const result = await call(sqlExecuteTool, { query: "CALL Sample.TwoSets()" });

      expect(result.structuredContent).toEqual({
        columns: ["ID", "Name"],
        rows: [["1", "A"], ["2", "B"], [undefined, undefined]],
        rowCount: 3,
      });
      expect(result.structuredContent).not.toHaveProperty("rowsAffected");
    });
  });

  // -- Read-only mode (AC-2) -------------------------------------------

  describe("read-only mode (AC-2)", () => {
    it("readOnly:true sends readOnly true and returns the rows with no readOnlyForced", async () => {
      mockHttp.post.mockResolvedValue(executed([{ N: 1 }]));

      const result = await call(sqlExecuteTool, { query: "SELECT 1 AS N", readOnly: true });

      expect(sentBody()).toEqual(endpointBody("SELECT 1 AS N", { readOnly: true }));
      expect(result.structuredContent).toEqual({ columns: ["N"], rows: [[1]], rowCount: 1 });
    });

    it("a refused non-query by parameter is SQL_READ_ONLY with the parameter remedy, and isError", async () => {
      mockHttp.post.mockResolvedValue(declined("readOnly", 4, "DELETE"));

      const result = await call(sqlExecuteTool, { query: DELETE_QUERY, readOnly: true });

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text:
              "Statement was not run in namespace 'USER': it is a DELETE statement, and read-only mode runs only queries (SELECT). " +
              "Nothing was changed. Run it without readOnly to execute it.",
          },
        ],
        structuredContent: { code: "SQL_READ_ONLY", namespace: "USER", statementType: "DELETE", readOnlySource: "parameter" },
        isError: true,
      });
    });

    it("IRIS_SQL_READ_ONLY forces read-only when readOnly is omitted or false, and a SELECT result adds readOnlyForced", async () => {
      withConfig({ sqlReadOnly: true });
      for (const args of [{ query: "SELECT 1 AS N" }, { query: "SELECT 1 AS N", readOnly: false }]) {
        mockHttp.post.mockResolvedValueOnce(executed([{ N: 1 }]));

        const result = await call(sqlExecuteTool, args);

        expect(mockHttp.post.mock.calls.at(-1)?.[1], JSON.stringify(args)).toEqual(endpointBody("SELECT 1 AS N", { readOnly: true }));
        expect(result.structuredContent, JSON.stringify(args)).toEqual({
          columns: ["N"],
          rows: [[1]],
          rowCount: 1,
          readOnlyForced: true,
        });
      }
    });

    it("readOnly:true under IRIS_SQL_READ_ONLY is not forced: no readOnlyForced", async () => {
      withConfig({ sqlReadOnly: true });
      mockHttp.post.mockResolvedValue(executed([{ N: 1 }]));

      const result = await call(sqlExecuteTool, { query: "SELECT 1 AS N", readOnly: true });

      expect(result.structuredContent).toEqual({ columns: ["N"], rows: [[1]], rowCount: 1 });
    });

    it("a refusal under IRIS_SQL_READ_ONLY has readOnlySource operator and the operator remedy, even when readOnly:false was passed", async () => {
      withConfig({ sqlReadOnly: true });
      mockHttp.post.mockResolvedValue(declined("readOnly", 3, "UPDATE"));

      const result = await call(sqlExecuteTool, { query: UPDATE_QUERY, readOnly: false });

      expect(sentBody().readOnly).toBe(true);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(
        "Statement was not run in namespace 'USER': it is a UPDATE statement, and read-only mode runs only queries (SELECT). " +
          "Nothing was changed. The operator's IRIS_SQL_READ_ONLY setting makes every call read-only; run a SELECT instead.",
      );
      expect(result.structuredContent).toEqual({
        code: "SQL_READ_ONLY",
        namespace: "USER",
        statementType: "UPDATE",
        readOnlySource: "operator",
      });
    });

    it("a refusal with readOnly:true and IRIS_SQL_READ_ONLY both in force names the operator as the source", async () => {
      withConfig({ sqlReadOnly: true });
      mockHttp.post.mockResolvedValue(declined("readOnly", 3, "UPDATE"));

      const result = await call(sqlExecuteTool, { query: UPDATE_QUERY, readOnly: true });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(
        "Statement was not run in namespace 'USER': it is a UPDATE statement, and read-only mode runs only queries (SELECT). " +
          "Nothing was changed. The operator's IRIS_SQL_READ_ONLY setting makes every call read-only; run a SELECT instead.",
      );
      expect(result.structuredContent).toEqual({
        code: "SQL_READ_ONLY",
        namespace: "USER",
        statementType: "UPDATE",
        readOnlySource: "operator",
      });
    });

    it("an explicit IRIS_SQL_READ_ONLY=false forces nothing", async () => {
      withConfig({ sqlReadOnly: false });
      mockHttp.post.mockResolvedValue(executedDml(4, "DELETE", 2));

      const result = await call(sqlExecuteTool, { query: DELETE_QUERY });

      expect(sentBody().readOnly).toBe(false);
      expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: 2 });
    });

    it("a CALL, DDL and COMMIT refusal each name their own statement type", async () => {
      for (const [type, name] of [[45, "CALL"], [9, "CREATE TABLE"], [5, "COMMIT"]] as const) {
        mockHttp.post.mockResolvedValueOnce(declined("readOnly", type, name));
        const result = await call(sqlExecuteTool, { query: "STATEMENT", readOnly: true });
        expect(result.content[0]?.text, name).toContain(`it is a ${name} statement, and read-only mode runs only queries`);
        expect((result.structuredContent as { statementType: string }).statementType, name).toBe(name);
      }
    });
  });

  // -- iris_sql_query (AC-2, AC-6) -------------------------------------

  describe("iris_sql_query", () => {
    it("is always read-only: it sends readOnly true, countOnly false and maxRowsAffected null", async () => {
      mockHttp.post.mockResolvedValue(executed([{ N: 1 }]));

      const result = await call(sqlQueryTool, { query: "SELECT 1 AS N" });

      expect(sentBody()).toEqual(endpointBody("SELECT 1 AS N", { readOnly: true }));
      expect(result.structuredContent).toEqual({ columns: ["N"], rows: [[1]], rowCount: 1 });
    });

    it("a refusal has readOnlySource tool and names iris_sql_execute", async () => {
      mockHttp.post.mockResolvedValue(declined("readOnly", 45, "CALL"));

      const result = await call(sqlQueryTool, { query: "CALL Sample.P()" });

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text:
              "Statement was not run in namespace 'USER': it is a CALL statement, and read-only mode runs only queries (SELECT). " +
              "Nothing was changed. iris_sql_query runs only queries; run other statements with iris_sql_execute.",
          },
        ],
        structuredContent: { code: "SQL_READ_ONLY", namespace: "USER", statementType: "CALL", readOnlySource: "tool" },
        isError: true,
      });
    });

    it("never reports readOnlyForced and never sends a cap, whatever the operator set", async () => {
      withConfig({ sqlReadOnly: true, sqlMaxRowsAffected: 2 });
      mockHttp.post.mockResolvedValue(executed([{ N: 1 }]));

      const result = await call(sqlQueryTool, { query: "SELECT 1 AS N" });

      expect(sentBody().maxRowsAffected).toBeNull();
      expect(result.structuredContent).toEqual({ columns: ["N"], rows: [[1]], rowCount: 1 });
    });

    it("applies IRIS_SQL_MAX_ROWS (rowsCapped) and IRIS_SQL_TIMEOUT exactly as iris_sql_execute does", async () => {
      withConfig({ sqlMaxRows: 2, sqlTimeoutMs: 9000 });
      const rows = Array.from({ length: 5 }, (_, i) => ({ ID: i }));
      mockHttp.post.mockResolvedValue(executed(rows));

      const query = await call(sqlQueryTool, { query: "SELECT ID FROM T", maxRows: 4 });
      mockHttp.post.mockResolvedValue(executed(rows));
      const execute = await call(sqlExecuteTool, { query: "SELECT ID FROM T", maxRows: 4 });

      expect(query.structuredContent).toEqual({
        columns: ["ID"],
        rows: [[0], [1]],
        rowCount: 2,
        truncated: true,
        totalAvailable: 5,
        rowsCapped: true,
      });
      expect(query.structuredContent).toEqual(execute.structuredContent);
      expect(mockHttp.post.mock.calls[0]?.[2]).toEqual({ timeout: 9000 });
    });

    it("has no readOnly or maxRowsAffected parameter, and rejects a negative or fractional value for the ones it has", () => {
      const shape = (sqlQueryTool.inputSchema as unknown as { shape: Record<string, unknown> }).shape;
      expect(Object.keys(shape).sort()).toEqual(["countOnly", "maxRows", "namespace", "parameters", "query"]);
      expect(sqlQueryTool.inputSchema.safeParse({ query: "SELECT 1", maxRows: 0 }).success).toBe(false);
      expect(sqlQueryTool.inputSchema.safeParse({ query: "SELECT 1", countOnly: "yes" }).success).toBe(false);
    });

    it("is a read tool with truthful annotations, scope NS, and iris_sql_execute as its parent", () => {
      expect(sqlQueryTool.name).toBe("iris_sql_query");
      expect(sqlQueryTool.mutates).toBe("read");
      expect(sqlQueryTool.parent).toBe("iris_sql_execute");
      expect(sqlQueryTool.scope).toBe("NS");
      expect(sqlQueryTool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    });
  });

  // -- Rows-affected cap (AC-3) ----------------------------------------

  describe("rows-affected cap (AC-3)", () => {
    it("a DELETE within the cap sends the cap and returns rowsAffected, with no cap flag", async () => {
      mockHttp.post.mockResolvedValue(executedDml(4, "DELETE", 3));

      const result = await call(sqlExecuteTool, { query: DELETE_QUERY, maxRowsAffected: 5 });

      expect(sentBody()).toEqual(endpointBody(DELETE_QUERY, { maxRowsAffected: 5 }));
      expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: 3 });
    });

    it("a DELETE over the cap is rolled back: SQL_ROWS_AFFECTED_CAP with rowsAffected, and isError", async () => {
      mockHttp.post.mockResolvedValue(declined("overCap", 4, "DELETE", { rowsAffected: 3 }));

      const result = await call(sqlExecuteTool, { query: DELETE_QUERY, maxRowsAffected: 2 });

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text:
              "Statement was rolled back in namespace 'USER': the DELETE affected 3 rows, more than the cap of 2 (from maxRowsAffected). " +
              "Its row changes were undone, except in storage that is not journaled, such as a table stored in IRISTEMP. Narrow the statement to at most 2 rows, or raise maxRowsAffected.",
          },
        ],
        structuredContent: {
          code: "SQL_ROWS_AFFECTED_CAP",
          namespace: "USER",
          statementType: "DELETE",
          rowsAffected: 3,
          maxRowsAffected: 2,
          capSource: "parameter",
        },
        isError: true,
      });
      expect(Object.keys(result.structuredContent as object)).toEqual([
        "code",
        "namespace",
        "statementType",
        "rowsAffected",
        "maxRowsAffected",
        "capSource",
      ]);
    });

    it("maxRowsAffected 0 is a valid cap: an UPDATE of 3 rows is rolled back and the count is reported", async () => {
      mockHttp.post.mockResolvedValue(declined("overCap", 3, "UPDATE", { rowsAffected: 3 }));

      const result = await call(sqlExecuteTool, { query: UPDATE_QUERY, maxRowsAffected: 0 });

      expect(sentBody().maxRowsAffected).toBe(0);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(
        "Statement was rolled back in namespace 'USER': the UPDATE affected 3 rows, more than the cap of 0 (from maxRowsAffected). " +
          "Its row changes were undone, except in storage that is not journaled, such as a table stored in IRISTEMP. Narrow the statement to at most 0 rows, or raise maxRowsAffected.",
      );
    });

    it("an unknown count (TRUNCATE TABLE reports -1) is rolled back and says so", async () => {
      mockHttp.post.mockResolvedValue(declined("overCap", 4, "DELETE", { rowsAffected: -1 }));

      const result = await call(sqlExecuteTool, { query: "TRUNCATE TABLE Sample.Person", maxRowsAffected: 1000 });

      expect(result.content[0]?.text).toBe(
        "Statement was rolled back in namespace 'USER': the DELETE affected an unknown number of rows " +
          "(IRIS reports -1, as it does for TRUNCATE TABLE), more than the cap of 1000 (from maxRowsAffected). " +
          "Its row changes were undone, except in storage that is not journaled, such as a table stored in IRISTEMP. Narrow the statement to at most 1000 rows, or raise maxRowsAffected.",
      );
      expect((result.structuredContent as { rowsAffected: number }).rowsAffected).toBe(-1);
    });

    it("a statement type the cap cannot count is refused before it runs, with the parameter remedy", async () => {
      mockHttp.post.mockResolvedValue(declined("capNotCountable", 45, "CALL"));

      const result = await call(sqlExecuteTool, { query: "CALL Sample.P()", maxRowsAffected: 10 });

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text:
              "Statement was not run in namespace 'USER': it is a CALL statement, and under a rows-affected cap (10, from maxRowsAffected) " +
              "only SELECT, INSERT, UPDATE and DELETE run, because those are the statements whose affected rows IRIS counts. " +
              "Nothing was changed. Run it without maxRowsAffected.",
          },
        ],
        structuredContent: {
          code: "SQL_ROWS_AFFECTED_CAP",
          namespace: "USER",
          statementType: "CALL",
          maxRowsAffected: 10,
          capSource: "parameter",
        },
        isError: true,
      });
    });

    it("a statement whose text contains %NOJOURN is refused before it runs, with the parameter remedy and no rowsAffected", async () => {
      mockHttp.post.mockResolvedValue(declined("noJournal", 4, "DELETE"));

      const result = await call(sqlExecuteTool, { query: "DELETE %NOJOURN FROM Sample.Person", maxRowsAffected: 10 });

      expect(sentBody()).toEqual(endpointBody("DELETE %NOJOURN FROM Sample.Person", { maxRowsAffected: 10 }));
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text:
              "Statement was not run in namespace 'USER': it is a DELETE statement whose text contains %NOJOURN, the keyword that turns journaling off, " +
              "so a rows-affected cap (10, from maxRowsAffected) could not undo its writes. " +
              "Nothing was changed. Remove %NOJOURN from the statement text, a comment or a string included " +
              "(a value passed in parameters is not checked), or run it without maxRowsAffected.",
          },
        ],
        structuredContent: {
          code: "SQL_ROWS_AFFECTED_CAP",
          namespace: "USER",
          statementType: "DELETE",
          maxRowsAffected: 10,
          capSource: "parameter",
        },
        isError: true,
      });
      expect(Object.keys(result.structuredContent as object)).toEqual([
        "code",
        "namespace",
        "statementType",
        "maxRowsAffected",
        "capSource",
      ]);
    });

    it("a SELECT under any cap runs as it would without one, with no cap flag", async () => {
      withConfig({ sqlMaxRowsAffected: 0 });
      mockHttp.post.mockResolvedValue(executed([{ N: 1 }]));

      const result = await call(sqlExecuteTool, { query: "SELECT 1 AS N", maxRowsAffected: 0 });

      expect(sentBody().maxRowsAffected).toBe(0);
      expect(result.structuredContent).toEqual({ columns: ["N"], rows: [[1]], rowCount: 1 });
    });
  });

  describe("the operator ceiling IRIS_SQL_MAX_ROWS_AFFECTED (AC-3)", () => {
    it("applies when maxRowsAffected is omitted, and a DML result adds maxRowsAffectedCapped", async () => {
      withConfig({ sqlMaxRowsAffected: 2 });
      mockHttp.post.mockResolvedValue(executedDml(4, "DELETE", 1));

      const result = await call(sqlExecuteTool, { query: DELETE_QUERY });

      expect(sentBody().maxRowsAffected).toBe(2);
      expect(result.structuredContent).toEqual({
        columns: [],
        rows: [],
        rowCount: 0,
        rowsAffected: 1,
        maxRowsAffectedCapped: true,
      });
    });

    it("a larger maxRowsAffected cannot raise it: the endpoint receives the ceiling", async () => {
      withConfig({ sqlMaxRowsAffected: 2 });
      mockHttp.post.mockResolvedValue(executedDml(3, "UPDATE", 2));

      const result = await call(sqlExecuteTool, { query: UPDATE_QUERY, maxRowsAffected: 10 });

      expect(sentBody().maxRowsAffected).toBe(2);
      expect((result.structuredContent as Record<string, unknown>).maxRowsAffectedCapped).toBe(true);
    });

    it("over the ceiling, the refusal has capSource operator and the operator remedy", async () => {
      withConfig({ sqlMaxRowsAffected: 2 });
      mockHttp.post.mockResolvedValue(declined("overCap", 4, "DELETE", { rowsAffected: 3 }));

      const result = await call(sqlExecuteTool, { query: DELETE_QUERY, maxRowsAffected: 10 });

      expect(result.content[0]?.text).toBe(
        "Statement was rolled back in namespace 'USER': the DELETE affected 3 rows, more than the cap of 2 (from IRIS_SQL_MAX_ROWS_AFFECTED). " +
          "Its row changes were undone, except in storage that is not journaled, such as a table stored in IRISTEMP. Narrow the statement to at most 2 rows; a call cannot raise the operator's IRIS_SQL_MAX_ROWS_AFFECTED ceiling.",
      );
      expect(result.structuredContent).toEqual({
        code: "SQL_ROWS_AFFECTED_CAP",
        namespace: "USER",
        statementType: "DELETE",
        rowsAffected: 3,
        maxRowsAffected: 2,
        capSource: "operator",
      });
    });

    it("a statement the cap cannot count is refused with the operator remedy", async () => {
      withConfig({ sqlMaxRowsAffected: 5 });
      mockHttp.post.mockResolvedValue(declined("capNotCountable", 9, "CREATE TABLE"));

      const result = await call(sqlExecuteTool, { query: "CREATE TABLE T (A INT)" });

      expect(result.content[0]?.text).toBe(
        "Statement was not run in namespace 'USER': it is a CREATE TABLE statement, and under a rows-affected cap (5, from IRIS_SQL_MAX_ROWS_AFFECTED) " +
          "only SELECT, INSERT, UPDATE and DELETE run, because those are the statements whose affected rows IRIS counts. " +
          "Nothing was changed. The operator's IRIS_SQL_MAX_ROWS_AFFECTED ceiling applies to every call, so this statement cannot run through iris_sql_execute here.",
      );
      expect((result.structuredContent as { capSource: string }).capSource).toBe("operator");
    });

    it("a statement whose text contains %NOJOURN is refused with the operator remedy, whatever the caller passes", async () => {
      withConfig({ sqlMaxRowsAffected: 5 });
      mockHttp.post.mockResolvedValue(declined("noJournal", 3, "UPDATE"));

      const result = await call(sqlExecuteTool, { query: "UPDATE %NOJOURN Sample.Person SET Age = 0", maxRowsAffected: 50 });

      expect(sentBody().maxRowsAffected).toBe(5);
      expect(result.content[0]?.text).toBe(
        "Statement was not run in namespace 'USER': it is a UPDATE statement whose text contains %NOJOURN, the keyword that turns journaling off, " +
          "so a rows-affected cap (5, from IRIS_SQL_MAX_ROWS_AFFECTED) could not undo its writes. " +
          "Nothing was changed. Remove %NOJOURN from the statement text, a comment or a string included " +
          "(a value passed in parameters is not checked); " +
          "the operator's IRIS_SQL_MAX_ROWS_AFFECTED ceiling applies to every call.",
      );
      expect(result.structuredContent).toEqual({
        code: "SQL_ROWS_AFFECTED_CAP",
        namespace: "USER",
        statementType: "UPDATE",
        maxRowsAffected: 5,
        capSource: "operator",
      });
    });

    it("a refused %NOJOURN statement under a caller cap tighter than the ceiling still gets the operator remedy: dropping maxRowsAffected would not lift the cap", async () => {
      withConfig({ sqlMaxRowsAffected: 10 });
      mockHttp.post.mockResolvedValue(declined("noJournal", 2, "INSERT"));

      const result = await call(sqlExecuteTool, { query: "INSERT %NOJOURN INTO Sample.Person (Name) VALUES ('A')", maxRowsAffected: 2 });

      expect((result.structuredContent as { capSource: string }).capSource).toBe("parameter");
      expect(result.content[0]?.text).toContain("(2, from maxRowsAffected)");
      expect(result.content[0]?.text).toContain("the operator's IRIS_SQL_MAX_ROWS_AFFECTED ceiling applies to every call.");
      expect(result.content[0]?.text).not.toContain("run it without maxRowsAffected");
    });

    it("a tighter caller value wins: capSource parameter and no flag", async () => {
      withConfig({ sqlMaxRowsAffected: 10 });
      mockHttp.post.mockResolvedValue(executedDml(4, "DELETE", 1));

      const result = await call(sqlExecuteTool, { query: DELETE_QUERY, maxRowsAffected: 2 });

      expect(sentBody().maxRowsAffected).toBe(2);
      expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: 1 });
    });

    it("a caller value equal to the ceiling is the caller's: capSource parameter", async () => {
      withConfig({ sqlMaxRowsAffected: 4 });
      mockHttp.post.mockResolvedValue(declined("overCap", 4, "DELETE", { rowsAffected: 9 }));

      const result = await call(sqlExecuteTool, { query: DELETE_QUERY, maxRowsAffected: 4 });

      expect((result.structuredContent as { capSource: string }).capSource).toBe("parameter");
      expect(result.content[0]?.text).toContain("(from maxRowsAffected)");
    });

    it("a ceiling of 0 is a valid ceiling", async () => {
      withConfig({ sqlMaxRowsAffected: 0 });
      mockHttp.post.mockResolvedValue(declined("overCap", 3, "UPDATE", { rowsAffected: 1 }));

      const result = await call(sqlExecuteTool, { query: UPDATE_QUERY, maxRowsAffected: 5 });

      expect(sentBody().maxRowsAffected).toBe(0);
      expect((result.structuredContent as { maxRowsAffected: number }).maxRowsAffected).toBe(0);
    });

    it("an INSERT, UPDATE or DELETE under a caller cap has no maxRowsAffectedCapped, and a SELECT under the ceiling has none either", async () => {
      mockHttp.post.mockResolvedValueOnce(executedDml(4, "DELETE", 2));
      const dml = await call(sqlExecuteTool, { query: DELETE_QUERY, maxRowsAffected: 5 });
      expect(dml.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: 2 });

      withConfig({ sqlMaxRowsAffected: 7 });
      mockHttp.post.mockResolvedValueOnce(executed([{ N: 1 }]));

      const select = await call(sqlExecuteTool, { query: "SELECT 1 AS N" });

      expect(select.structuredContent).toEqual({ columns: ["N"], rows: [[1]], rowCount: 1 });
    });
  });

  describe("read-only and a cap together (AC-2, AC-3)", () => {
    it("send both controls; the endpoint's read-only refusal governs", async () => {
      withConfig({ sqlMaxRowsAffected: 5 });
      mockHttp.post.mockResolvedValue(declined("readOnly", 3, "UPDATE"));

      const result = await call(sqlExecuteTool, { query: UPDATE_QUERY, readOnly: true, maxRowsAffected: 2 });

      expect(sentBody()).toEqual(endpointBody(UPDATE_QUERY, { readOnly: true, maxRowsAffected: 2 }));
      expect((result.structuredContent as { code: string }).code).toBe("SQL_READ_ONLY");
    });
  });

  // -- countOnly (AC-4) ------------------------------------------------

  describe("countOnly (AC-4)", () => {
    it("returns totalCount with no rows, and neither maxRows nor IRIS_SQL_MAX_ROWS applies", async () => {
      withConfig({ sqlMaxRows: 1 });
      mockHttp.post.mockResolvedValue(executed([], { totalCount: 42 }));

      for (const tool of [sqlExecuteTool, sqlQueryTool]) {
        const result = await call(tool, { query: "SELECT ID FROM T", countOnly: true, maxRows: 5 });

        expect(sentBody().countOnly, tool.name).toBe(true);
        expect(result.structuredContent, tool.name).toEqual({ columns: [], rows: [], rowCount: 0, totalCount: 42 });
        expect(result.structuredContent, tool.name).not.toHaveProperty("rowsCapped");
        expect(result.structuredContent, tool.name).not.toHaveProperty("truncated");
        mockHttp.post.mockClear();
        mockHttp.post.mockResolvedValue(executed([], { totalCount: 42 }));
      }
    });

    it("a count of 0 is reported", async () => {
      mockHttp.post.mockResolvedValue(executed([], { totalCount: 0 }));

      const result = await call(sqlQueryTool, { query: "SELECT ID FROM T WHERE 1=0", countOnly: true });

      expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, totalCount: 0 });
    });

    it("on a non-query is an error with no code and no structuredContent", async () => {
      mockHttp.post.mockResolvedValue(declined("countOnly", 4, "DELETE"));

      const result = await call(sqlExecuteTool, { query: DELETE_QUERY, countOnly: true });

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text:
              "countOnly counts the rows a query returns, and this is a DELETE statement, so nothing was run. " +
              "Remove countOnly, or pass a SELECT.",
          },
        ],
        isError: true,
      });
      expect(result).not.toHaveProperty("structuredContent");
    });

    it("with read-only mode as well, the endpoint's read-only refusal wins", async () => {
      mockHttp.post.mockResolvedValue(declined("readOnly", 4, "DELETE"));

      const result = await call(sqlExecuteTool, { query: DELETE_QUERY, countOnly: true, readOnly: true });

      expect(sentBody()).toEqual(endpointBody(DELETE_QUERY, { readOnly: true, countOnly: true }));
      expect((result.structuredContent as { code: string }).code).toBe("SQL_READ_ONLY");
    });
  });

  // -- A changed transaction -------------------------------------------

  describe("a statement that changed the tool's transaction", () => {
    it("is an error with no code and no structuredContent, whether read-only or capped", async () => {
      for (const args of [{ readOnly: true }, { maxRowsAffected: 5 }]) {
        mockHttp.post.mockResolvedValueOnce(declined("transactionEnded", args.readOnly ? 1 : 4, args.readOnly ? "SELECT" : "DELETE"));

        const result = await call(sqlExecuteTool, { query: "STATEMENT", ...args });

        expect(result).toEqual({
          content: [
            {
              type: "text",
              text:
                "Statement changed the transaction this tool opened in namespace 'USER': a function, procedure or trigger it ran " +
                "started, committed or rolled back a transaction, so the tool could not check or undo its effects reliably and " +
                "some changes may be saved. Check the data the statement touches before running it again.",
            },
          ],
          isError: true,
        });
        expect(result).not.toHaveProperty("structuredContent");
      }
    });

    it("names the namespace the call resolved to", async () => {
      mockHttp.post.mockResolvedValue(declined("transactionEnded", 1, "SELECT"));

      const result = await call(sqlQueryTool, { query: "SELECT F()", namespace: "HSCUSTOM" });

      expect(result.content[0]?.text).toContain("in namespace 'HSCUSTOM':");
      expect(sentBody().namespace).toBe("HSCUSTOM");
    });
  });

  // -- Errors and transport --------------------------------------------

  describe("errors and transport", () => {
    it("an outcome this tool does not know (a newer deployed endpoint) is an error, never a successful empty result", async () => {
      mockHttp.post.mockResolvedValue(fromNewerEndpoint("someLaterOutcome", 4, "DELETE"));

      const result = await call(sqlExecuteTool, { query: DELETE_QUERY, maxRowsAffected: 10 });

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text:
              "The SQL endpoint in namespace 'USER' returned an outcome this tool does not know ('someLaterOutcome'), " +
              "so the tool cannot tell whether the statement ran or what it changed. Use the @iris-mcp/dev version that matches " +
              "the ExecuteMCPv2 classes deployed on this server, and check the data the statement touches before running it again.",
          },
        ],
        isError: true,
      });
    });

    it("a multi-statement query is an IRIS prepare error (SQLCODE -25): SQL error, nothing runs", async () => {
      const error = new IrisApiError(
        200,
        [{ error: "ERROR #5001: SQLCODE: -25 Message:  Input (;) encountered after end of query" }],
        SQL_PATH,
        `IRIS reported errors for POST ${SQL_PATH}. Review the error details and correct the request.`,
      );
      mockHttp.post.mockRejectedValue(error);

      const result = await call(sqlExecuteTool, { query: "SELECT 1; DELETE FROM T" });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(`SQL error: ${error.message}`);
      expect(result.content[0]?.text).toContain("SQLCODE: -25");
    });

    it("an endpoint that is not deployed (HTTP 404) is a SQL error naming the route", async () => {
      const error = new IrisApiError(
        404,
        [],
        SQL_PATH,
        `IRIS returned HTTP 404 for POST ${SQL_PATH}. Check the request parameters and try again.`,
      );
      mockHttp.post.mockRejectedValue(error);

      for (const tool of [sqlExecuteTool, sqlQueryTool]) {
        const result = await call(tool, { query: "SELECT 1" });
        expect(result.isError, tool.name).toBe(true);
        expect(result.content[0]?.text, tool.name).toBe(`SQL error: ${error.message}`);
      }
    });

    it("a network failure propagates", async () => {
      mockHttp.post.mockRejectedValue(new Error("ECONNRESET"));

      await expect(call(sqlQueryTool, { query: "SELECT 1" })).rejects.toThrow("ECONNRESET");
    });

    it("forwards IRIS_SQL_TIMEOUT only when it is set", async () => {
      mockHttp.post.mockResolvedValue(executed([]));
      await call(sqlQueryTool, { query: "SELECT 1" });
      expect(mockHttp.post.mock.calls[0]).toHaveLength(2);

      mockHttp.post.mockClear();
      withConfig({ sqlTimeoutMs: 3000 });
      await call(sqlQueryTool, { query: "SELECT 1" });
      expect(mockHttp.post.mock.calls[0]?.[2]).toEqual({ timeout: 3000 });
    });

    it("sends parameters only when there are some", async () => {
      mockHttp.post.mockResolvedValue(executed([]));
      await call(sqlQueryTool, { query: "SELECT ?", parameters: ["a"] });
      expect(sentBody().parameters).toEqual(["a"]);

      mockHttp.post.mockClear();
      await call(sqlQueryTool, { query: "SELECT 1", parameters: [] });
      expect(sentBody()).not.toHaveProperty("parameters");
    });
  });

  // -- Descriptions and parameters (AC-2, AC-3, AC-4, AC-5, AC-6) ------

  describe("descriptions and parameters", () => {
    it("both descriptions say statement-level read-only, not side-effect-free, and list what a rollback does not undo", () => {
      for (const tool of [sqlExecuteTool, sqlQueryTool]) {
        expect(tool.description, tool.name).toContain("statement-level read-only, not side-effect-free");
        expect(tool.description, tool.name).toContain("$INCREMENT/$SEQUENCE counters (row ID counters included)");
        expect(tool.description, tool.name).toContain("process-private or IRISTEMP globals");
        expect(tool.description, tool.name).toContain("changes made with %NOJOURN by a function, procedure or trigger the statement runs");
        expect(tool.description, tool.name).toContain("work that parallel query worker processes do (%PARALLEL)");
        expect(tool.description, tool.name).toContain("JOB or device output, other external effects");
        expect(tool.description, tool.name).toContain("a function, procedure or trigger that starts, commits or rolls back a transaction");
        expect(tool.description, tool.name).toContain("which a commit followed by a new TSTART does not show");
        expect(tool.description, tool.name).toContain("SQL_READ_ONLY");
      }
    });

    it("the iris_sql_execute description states the three controls and both variables with their defaults", () => {
      const description = sqlExecuteTool.description;
      expect(description).toContain("readOnly (default: false)");
      expect(description).toContain("maxRowsAffected (default: no cap)");
      expect(description).toContain("countOnly (default: false)");
      expect(description).toContain("IRIS_SQL_READ_ONLY=true");
      expect(description).toContain("IRIS_SQL_MAX_ROWS_AFFECTED");
      expect(description).toContain("unset by default");
      expect(description).toContain("only SELECT, INSERT, UPDATE and DELETE run");
      expect(description).toContain("SQL_ROWS_AFFECTED_CAP");
      expect(description).toContain("A capped statement that is rolled back leaves the same effects.");
      expect(description).toContain(
        "an INSERT, UPDATE or DELETE whose text contains the %NOJOURN token (a comment or a string counts) is refused with SQL_ROWS_AFFECTED_CAP before it runs under a cap, because it turns journaling off and the rollback could not undo it",
      );
      expect(description).toContain("rowsAffected");
      expect(description).toContain("readOnlyForced or maxRowsAffectedCapped");
      expect(description).toContain("use iris_sql_query to run queries");
    });

    it("the iris_sql_query description leads with its purpose, then states its governance, and names no REST path", () => {
      const description = sqlQueryTool.description;
      expect(description.startsWith("Run a SQL query (SELECT) against an IRIS namespace")).toBe(true);
      expect(description).toContain("including under the read-only governance preset");
      expect(description).toContain("enabled by default");
      expect(description).toContain("disabled when an operator explicitly disables iris_sql_execute");
      expect(description).toContain("unless iris_sql_query is set explicitly");
      expect(description).toContain("IRIS_SQL_MAX_ROWS");
      expect(description).toContain("IRIS_SQL_TIMEOUT");
      expect(description).not.toContain("/api/");
      expect(description).not.toContain("executemcp");
    });

    it("iris_sql_execute accepts the three new parameters and rejects a malformed one", () => {
      const schema = sqlExecuteTool.inputSchema;
      expect(schema.safeParse({ query: "SELECT 1", readOnly: true, maxRowsAffected: 0, countOnly: false }).success).toBe(true);
      expect(schema.safeParse({ query: "SELECT 1", maxRowsAffected: -1 }).success).toBe(false);
      expect(schema.safeParse({ query: "SELECT 1", maxRowsAffected: 1.5 }).success).toBe(false);
      expect(schema.safeParse({ query: "SELECT 1", readOnly: "true" }).success).toBe(false);
      const shape = (schema as unknown as { shape: Record<string, { description?: string }> }).shape;
      expect(shape.readOnly?.description).toContain("default: false");
      expect(shape.maxRowsAffected?.description).toContain("default: no cap");
      expect(shape.maxRowsAffected?.description).toContain(
        "and an INSERT, UPDATE or DELETE whose text contains the %NOJOURN token is refused",
      );
      expect(shape.countOnly?.description).toContain("default: false");
    });

    it("iris_sql_execute declares destructiveHint true (Story 42.10, DW-560), keeps its other hints and has no parent", () => {
      expect(sqlExecuteTool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      });
      expect(sqlExecuteTool.parent).toBeUndefined();
      expect(sqlExecuteTool.mutates).toBeUndefined();
    });
  });
});
