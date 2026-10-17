/**
 * Tests for the `searchTable` action of `iris_message_search` (Story 39.4): mocked-HTTP unit tests of the
 * request it sends, its required input, the data policy (`block` makes no HTTP call, `redact` and `allow` run
 * and report the policy), the two `notApplicable` states, the result shape, and that no filter value reaches
 * a response.
 *
 * Every fake reply has the shape the live route returns (Rule #54): `searchTablesConfigured` is present on a
 * searchTable result that got as far as the Search Table check, and absent from the `interopEnabled: false`
 * one. The live behavior (rows equal a hand-written `IN` / `NOT IN` oracle, the injection fuzz over the REST
 * route, a second namespace, a namespace with no Search Table) is pinned by `iris-mcp-all`'s
 * `story-39-4-search-table-live-gate.test.ts`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { decodeCursor, messageSearchTool, type RawHeaderRow } from "../tools/message-search.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

const ROUTE = "/api/executemcp/v2/interop/message/search";
const WINDOW = { from: "2001-02-03T07:00:00Z", to: "2001-02-03T09:00:00Z" };
const HOSTILE = "x' OR 1=1 --SYNTHPHI394";
const NO_MATCH_NOTE =
  "A Search Table holds only the messages indexed when they were processed (or by BuildIndex), so no match " +
  "does not prove that no message holds the value.";

/** A header row as the live route returns it. */
function rawRow(overrides: Partial<RawHeaderRow> = {}): RawHeaderRow {
  return {
    id: 1,
    sessionId: 394001,
    type: "Request",
    status: "Completed",
    isError: false,
    sourceItem: "Story394.Source",
    targetItem: "Story394.Target",
    bodyClassName: "EnsLib.HL7.Message",
    bodyId: "1",
    timeCreated: "2001-02-03 08:00:00",
    timeProcessed: "",
    correspondingMessageId: null,
    ...overrides,
  };
}

/** The live route's result for a Search Table lookup in a namespace that has Search Tables. */
function tableResult(rows: RawHeaderRow[], extra: Record<string, unknown> = {}) {
  return {
    action: "searchTable",
    limit: 100,
    from: "2001-02-03 07:00:00",
    to: "2001-02-03 09:00:00",
    interopEnabled: true,
    searchTablesConfigured: true,
    rows,
    hasMore: false,
    ...extra,
  };
}

const TABLE_ARGS = {
  action: "searchTable",
  ...WINDOW,
  searchTableClass: "EnsLib.HL7.SearchTable",
  filters: [{ property: "PatientID", op: "eq", value: "SYNTHPHI394-MRN-1" }],
};

const BLOCKED = { code: "DATA_POLICY_BLOCKED", action: "searchTable", policy: "block" };

describe("iris_message_search searchTable (Story 39.4)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  /** A context whose profile resolved the given data policy, as the framework builds it per call. */
  function ctxWithPolicy(policy: "block" | "redact" | "allow"): ToolContext {
    return { ...ctx, config: { ...ctx.config, dataPolicy: policy } };
  }

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // -- definition ---------------------------------------------------------

  describe("definition", () => {
    it("declares searchTable next to body as a governed action, with filters as the PHI input", () => {
      expect(messageSearchTool.dataPolicy).toEqual({ actions: ["body", "searchTable"], phiInputs: ["filters"] });
      expect(messageSearchTool.mutates).toEqual({ headers: "read", body: "read", searchTable: "read" });
      expect(messageSearchTool.defaultEnabled).toBeUndefined();
    });

    it("describes the inputs, the clause semantics, the case rules, the limits, the policy and the default state", () => {
      const description = messageSearchTool.description;
      for (const text of [
        "**searchTable** (read, enabled by default)",
        "searchTableClass",
        "EnsLib.HL7.SearchTable",
        "PatientID (PID-2, every PID-3 repetition and PID-4",
        "medical record number",
        "at least one non-empty entry",
        "ne matches when the message has no entry equal to the value",
        "isNull matches when it has no non-empty entry",
        "String:CaseSensitive",
        "Integer, Numeric or Boolean property takes only eq, ne, isNull and notNull",
        "truncated to 256 characters",
        "document class",
        "Ens.CustomSearchTable",
        "lists the class's configured property names",
        "notApplicable: true",
        "DATA_POLICY_BLOCKED",
        "iris_message_search:searchTable",
      ]) {
        expect(description, text).toContain(text);
      }
      expect(description).not.toMatch(/\/api\/|\/interop\//);
      expect(description).not.toContain("NOT_IMPLEMENTED");
    });

    it("declares the searchTableClass input as an optional string of at most 220 characters", () => {
      const parse = (searchTableClass: unknown) => messageSearchTool.inputSchema.safeParse({ ...TABLE_ARGS, searchTableClass });
      expect(parse("EnsLib.HL7.SearchTable").success).toBe(true);
      expect(parse("x".repeat(220)).success).toBe(true);
      expect(parse("x".repeat(221)).success).toBe(false);
      expect(parse(5).success).toBe(false);
      expect(messageSearchTool.inputSchema.safeParse({ action: "searchTable", ...WINDOW }).success).toBe(true);
    });
  });

  // -- the wire body ----------------------------------------------------------

  describe("the request sent to IRIS", () => {
    it("sends the searchTable action, the class, the filters as given, the window, limit 100 and the namespace", async () => {
      mockHttp.post.mockResolvedValue(envelope(tableResult([rawRow()])));

      await messageSearchTool.handler(TABLE_ARGS, ctx);

      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      expect(mockHttp.post).toHaveBeenCalledWith(ROUTE, {
        action: "searchTable",
        from: "2001-02-03T07:00:00Z",
        to: "2001-02-03T09:00:00Z",
        limit: 100,
        namespace: "USER",
        searchTableClass: "EnsLib.HL7.SearchTable",
        filters: [{ property: "PatientID", op: "eq", value: "SYNTHPHI394-MRN-1" }],
      });
    });

    it("sends bodyClass, the scope filters, the cursor position and every filter of a combined lookup", async () => {
      mockHttp.post.mockResolvedValue(envelope(tableResult([])));
      const cursor = Buffer.from(JSON.stringify({ t: "2001-02-03 08:00:01", id: 2 }), "utf8").toString("base64url");
      const filters = [
        { property: "PatientID", op: "startsWith", value: "synthphi394-mrn" },
        { property: "Story394Int", op: "ne", value: 12 },
        { property: "MSHControlID", op: "eq", value: true },
        { property: "Story394Empty", op: "notNull" },
      ];

      await messageSearchTool.handler(
        {
          ...TABLE_ARGS,
          searchTableClass: "Story394.SearchTable",
          filters,
          bodyClass: "EnsLib.HL7.Message",
          target: "Story394.Other",
          source: "S",
          item: "I",
          errorOnly: true,
          sessionId: 7,
          status: "Errored",
          limit: 2,
          cursor,
          namespace: "EXECMCPTMP394A",
        },
        ctx,
      );

      expect(mockHttp.post.mock.calls[0]?.[1]).toEqual({
        action: "searchTable",
        from: "2001-02-03T07:00:00Z",
        to: "2001-02-03T09:00:00Z",
        limit: 2,
        namespace: "EXECMCPTMP394A",
        item: "I",
        source: "S",
        target: "Story394.Other",
        status: "Errored",
        sessionId: 7,
        bodyClass: "EnsLib.HL7.Message",
        searchTableClass: "Story394.SearchTable",
        filters,
        errorOnly: true,
        afterTimeCreated: "2001-02-03 08:00:01",
        afterId: 2,
      });
    });

    it("sends no searchTableClass key on the headers and body actions, so their wire is what it was", async () => {
      mockHttp.post.mockResolvedValue(envelope({ ...tableResult([rawRow()]), action: "headers" }));
      await messageSearchTool.handler({ action: "headers", ...WINDOW }, ctx);
      mockHttp.post.mockResolvedValue(envelope({ ...tableResult([rawRow()]), action: "body" }));
      await messageSearchTool.handler(
        { action: "body", ...WINDOW, bodyClass: "Story393.Body", filters: TABLE_ARGS.filters },
        ctx,
      );

      expect(mockHttp.post, "both actions posted").toHaveBeenCalledTimes(2);
      for (const call of mockHttp.post.mock.calls) {
        expect(call[1], "the wire body").not.toHaveProperty("searchTableClass");
      }
    });
  });

  // -- required input ---------------------------------------------------------------

  describe("required input", () => {
    it.each([
      [
        "searchTableClass missing",
        { ...TABLE_ARGS, searchTableClass: undefined },
        "'searchTableClass' is required for the searchTable action: the exact name of a Search Table class, such as EnsLib.HL7.SearchTable.",
      ],
      [
        "searchTableClass empty",
        { ...TABLE_ARGS, searchTableClass: "" },
        "'searchTableClass' is required for the searchTable action: the exact name of a Search Table class, such as EnsLib.HL7.SearchTable.",
      ],
      [
        "filters missing",
        { ...TABLE_ARGS, filters: undefined },
        "'filters' is required for the searchTable action: 1 to 10 {property, op, value} conditions on its Search Table properties.",
      ],
      [
        "filters empty",
        { ...TABLE_ARGS, filters: [] },
        "'filters' is required for the searchTable action: 1 to 10 {property, op, value} conditions on its Search Table properties.",
      ],
    ])("%s is a validation error naming the parameter, with no HTTP call", async (_name, args, text) => {
      const result = await messageSearchTool.handler(args, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(text);
      expect(result.structuredContent).toBeUndefined();
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it.each(["headers", "body"])("searchTableClass on the %s action is refused, not ignored, with no HTTP call", async (action) => {
      const result = await messageSearchTool.handler(
        { action, ...WINDOW, bodyClass: "Story393.Body", filters: action === "body" ? TABLE_ARGS.filters : undefined, searchTableClass: "EnsLib.HL7.SearchTable" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe("'searchTableClass' applies only to the searchTable action.");
      expect(result.structuredContent).toBeUndefined();
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("filters on the headers action is refused naming both actions, with no HTTP call", async () => {
      const result = await messageSearchTool.handler({ action: "headers", ...WINDOW, filters: TABLE_ARGS.filters }, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe("'filters' applies only to the body and searchTable actions.");
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("a bad cursor is a validation error with no HTTP call", async () => {
      const result = await messageSearchTool.handler({ ...TABLE_ARGS, cursor: "not a cursor" }, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("'cursor'");
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("a bad from is a validation error even under block, because the window is parsed first", async () => {
      const result = await messageSearchTool.handler({ ...TABLE_ARGS, from: "x" }, ctxWithPolicy("block"));

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content[0]?.text).toContain("'from'");
    });
  });

  // -- the data policy -------------------------------------------------------

  describe("the data policy (AD-26, AD-9)", () => {
    it("block refuses with DATA_POLICY_BLOCKED and the fixed text, and makes no HTTP call", async () => {
      const result = await messageSearchTool.handler(TABLE_ARGS, ctxWithPolicy("block"));

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual(BLOCKED);
      expect(result.content[0]?.text).toBe(
        "The block data policy withholds message body data, and a Search Table lookup reveals values taken from " +
          "message bodies, so the searchTable action is refused. Use the headers action, or ask the operator for a " +
          "looser IRIS_DATA_POLICY for this profile.",
      );
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("block is decided before the lookup's own input checks and before the cursor", async () => {
      for (const args of [
        { action: "searchTable", ...WINDOW },
        { ...TABLE_ARGS, cursor: "not a cursor" },
        { ...TABLE_ARGS, searchTableClass: "" },
        { ...TABLE_ARGS, filters: [] },
      ]) {
        const result = await messageSearchTool.handler(args, ctxWithPolicy("block"));
        expect(result.structuredContent).toEqual(BLOCKED);
      }
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("block still checks the misplaced searchTableClass and filters first, which are action-key checks", async () => {
      const result = await messageSearchTool.handler(
        { action: "headers", ...WINDOW, searchTableClass: "EnsLib.HL7.SearchTable" },
        ctxWithPolicy("block"),
      );

      expect(result.structuredContent).toBeUndefined();
      expect(result.content[0]?.text).toBe("'searchTableClass' applies only to the searchTable action.");
    });

    it("the policy is the call's own profile's: a block profile refuses while a redact profile of the same server runs", async () => {
      mockHttp.post.mockResolvedValue(envelope(tableResult([rawRow()])));

      const refused = await messageSearchTool.handler(TABLE_ARGS, ctxWithPolicy("block"));
      const ran = await messageSearchTool.handler(TABLE_ARGS, ctxWithPolicy("redact"));

      expect(refused.structuredContent).toEqual(BLOCKED);
      expect(ran.isError).toBeFalsy();
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
    });

    it("headers is not under the policy: it runs under block and its result has no dataPolicy", async () => {
      mockHttp.post.mockResolvedValue(envelope({ ...tableResult([rawRow()]), action: "headers" }));

      const result = await messageSearchTool.handler({ action: "headers", ...WINDOW }, ctxWithPolicy("block"));

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).not.toHaveProperty("dataPolicy");
      expect(result.content[0]?.text).not.toContain("Data policy");
    });

    it.each([
      ["no policy on the config (the default)", undefined, "redact"],
      ["redact", "redact", "redact"],
      ["allow", "allow", "allow"],
    ] as const)("%s runs the lookup and reports dataPolicy with zero counts", async (_name, configured, policy) => {
      mockHttp.post.mockResolvedValue(envelope(tableResult([rawRow(), rawRow({ id: 2, bodyId: "2" })])));
      const context = configured === undefined ? ctx : ctxWithPolicy(configured);

      const result = await messageSearchTool.handler(TABLE_ARGS, context);

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.dataPolicy).toEqual({ policy, redacted: 0, blocked: 0 });
      expect(Object.keys(structured)).toEqual(["action", "rows", "hasMore", "limit", "from", "fromRaw", "to", "toRaw", "dataPolicy"]);
      expect(structured.action).toBe("searchTable");
      const lines = (result.content[0]?.text as string).split("\n");
      expect(lines.at(-1)).toBe(
        `Data policy ${policy}: header rows only; the searchTable action returns no Search Table or body values.`,
      );
      expect(lines.filter((line) => line.startsWith("Data policy")), "one policy line").toHaveLength(1);
      expect(lines[0]).toBe("2 message header(s) from 2001-02-03T07:00:00.000Z to 2001-02-03T09:00:00.000Z.");
    });
  });

  // -- results --------------------------------------------------------------------

  describe("the result", () => {
    it("maps the rows to the shared header-row shape", async () => {
      mockHttp.post.mockResolvedValue(
        envelope(tableResult([rawRow({ id: 10, type: "Response", correspondingMessageId: 1, timeCreated: "2001-02-03 08:00:09" })])),
      );

      const result = await messageSearchTool.handler(TABLE_ARGS, ctx);

      expect((result.structuredContent as { rows: unknown[] }).rows).toEqual([
        {
          id: 10,
          sessionId: 394001,
          type: "Response",
          status: "Completed",
          isError: false,
          sourceItem: "Story394.Source",
          targetItem: "Story394.Target",
          bodyClassName: "EnsLib.HL7.Message",
          bodyId: "1",
          timeCreated: "2001-02-03T08:00:09.000Z",
          timeCreatedRaw: "2001-02-03 08:00:09",
          timeProcessed: "",
          timeProcessedRaw: "",
          correspondingMessageId: 1,
        },
      ]);
    });

    it("pages by the same cursor as headers: nextCursor only when more are available", async () => {
      mockHttp.post.mockResolvedValue(
        envelope(tableResult([rawRow({ id: 4, timeCreated: "2001-02-03 08:00:03" }), rawRow({ id: 5, timeCreated: "2001-02-03 08:00:03" })], { hasMore: true, limit: 2 })),
      );

      const paged = await messageSearchTool.handler({ ...TABLE_ARGS, limit: 2 }, ctx);
      const structured = paged.structuredContent as { hasMore: boolean; nextCursor?: string };

      expect(structured.hasMore).toBe(true);
      expect(decodeCursor(structured.nextCursor as string)).toEqual({ t: "2001-02-03 08:00:03", id: 5 });
      expect(paged.content[0]?.text).toContain("pass nextCursor as cursor");

      mockHttp.post.mockResolvedValue(envelope(tableResult([rawRow()])));
      const last = await messageSearchTool.handler(TABLE_ARGS, ctx);
      expect(last.structuredContent).not.toHaveProperty("nextCursor");
    });

    it("an empty page is a plain success that reports the policy and says an index proves nothing about absence", async () => {
      mockHttp.post.mockResolvedValue(envelope(tableResult([])));

      const result = await messageSearchTool.handler(TABLE_ARGS, ctx);

      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.text).toBe(
        `No message headers matched. ${NO_MATCH_NOTE}\nData policy redact: header rows only; the searchTable action returns no Search Table or body values.`,
      );
      expect((result.structuredContent as { dataPolicy: unknown }).dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
    });

    it("the no-match note belongs to searchTable: a body and a headers page that matched nothing do not carry it", async () => {
      mockHttp.post.mockResolvedValue(envelope({ ...tableResult([]), action: "body" }));
      const body = await messageSearchTool.handler(
        { action: "body", ...WINDOW, bodyClass: "Story393.Body", filters: TABLE_ARGS.filters },
        ctx,
      );
      mockHttp.post.mockResolvedValue(envelope({ ...tableResult([]), action: "headers" }));
      const headers = await messageSearchTool.handler({ action: "headers", ...WINDOW }, ctx);

      expect(body.content[0]?.text).not.toContain("BuildIndex");
      expect(headers.content[0]?.text).toBe("No message headers matched.");
    });

    it("a namespace without Interoperability is notApplicable with the policy, not an error", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({ action: "searchTable", limit: 100, from: "2001-02-03 07:00:00", to: "2001-02-03 09:00:00", interopEnabled: false, rows: [], hasMore: false }),
      );

      const result = await messageSearchTool.handler({ ...TABLE_ARGS, namespace: "EXECMCPTMP394X" }, ctxWithPolicy("allow"));

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({
        action: "searchTable",
        notApplicable: true,
        rows: [],
        hasMore: false,
        dataPolicy: { policy: "allow", redacted: 0, blocked: 0 },
      });
      expect(String(structured.reason)).toContain("Interoperability is not configured in namespace 'EXECMCPTMP394X'");
      expect(result.content[0]?.text).toContain("Data policy allow:");
    });

    it("a namespace with no Search Table property is notApplicable with its own reason and the policy, not an error", async () => {
      mockHttp.post.mockResolvedValue(envelope(tableResult([], { searchTablesConfigured: false })));

      const result = await messageSearchTool.handler({ ...TABLE_ARGS, namespace: "EXECMCPTMP394C" }, ctx);

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({
        action: "searchTable",
        notApplicable: true,
        rows: [],
        hasMore: false,
        dataPolicy: { policy: "redact", redacted: 0, blocked: 0 },
      });
      expect(structured.reason).toBe(
        "No Search Table is configured in namespace 'EXECMCPTMP394C': it has no Search Table properties " +
          "(Ens.Config.SearchTableProp is empty), so there is nothing to look up. Compile or deploy a Search Table " +
          "class there, or use the headers or body action.",
      );
      expect(result.content[0]?.text).toContain("Data policy redact:");
      expect(structured).not.toHaveProperty("nextCursor");
    });
  });

  // -- no echo -----------------------------------------------------------------------

  describe("no filter value reaches a response", () => {
    const hostileArgs = { ...TABLE_ARGS, filters: [{ property: "PatientID", op: "eq", value: HOSTILE }] };

    it("a success holds none in its content or its structured content", async () => {
      mockHttp.post.mockResolvedValue(envelope(tableResult([rawRow()])));

      const result = await messageSearchTool.handler(hostileArgs, ctx);

      expect(JSON.stringify(result)).not.toContain("SYNTHPHI394");
      expect(mockHttp.post.mock.calls[0]?.[1]).toMatchObject({ filters: [{ value: HOSTILE }] });
    });

    it("an IRIS error carries the IRIS text only, which holds none", async () => {
      const text = "Parameter 'filters[0].property' is not a property of this Search Table class. Use one of: MSHControlID, MSHTypeName";
      mockHttp.post.mockRejectedValue(new IrisApiError(500, [{ error: text }], ROUTE, text));

      const result = await messageSearchTool.handler(hostileArgs, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Error performing 'searchTable' on iris_message_search");
      expect(result.content[0]?.text).toContain("filters[0].property");
      expect(JSON.stringify(result)).not.toContain("SYNTHPHI394");
    });

    it("the block refusal and the validation errors hold none", async () => {
      const blocked = await messageSearchTool.handler(hostileArgs, ctxWithPolicy("block"));
      const noClass = await messageSearchTool.handler({ ...hostileArgs, searchTableClass: "" }, ctx);
      const withHeaders = await messageSearchTool.handler({ ...hostileArgs, action: "headers" }, ctx);
      const misplaced = await messageSearchTool.handler(
        { action: "headers", ...WINDOW, searchTableClass: HOSTILE },
        ctx,
      );

      for (const result of [blocked, noClass, withHeaders, misplaced]) {
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).not.toContain("SYNTHPHI394");
      }
      expect(mockHttp.post).not.toHaveBeenCalled();
    });
  });
});
