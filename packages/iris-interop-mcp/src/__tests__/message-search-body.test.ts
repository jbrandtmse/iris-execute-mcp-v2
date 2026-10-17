/**
 * Tests for the `body` action of `iris_message_search` (Story 39.3): mocked-HTTP unit tests of the
 * request it sends, the schema of its `filters`, the data policy (`block` makes no HTTP call, `redact` and
 * `allow` run and report the policy), the result shape, and that no filter value reaches a response.
 *
 * Every fake reply has the shape the live route returns (Rule #54). The live behavior (rows equal a
 * hand-written JOIN oracle, the injection fuzz over the REST route, a second namespace) is pinned by
 * `iris-mcp-all`'s `story-39-3-body-search-live-gate.test.ts`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { BODY_FILTER_OPS, decodeCursor, messageSearchTool, type RawHeaderRow } from "../tools/message-search.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

const ROUTE = "/api/executemcp/v2/interop/message/search";
const WINDOW = { from: "2001-02-03T07:00:00Z", to: "2001-02-03T09:00:00Z" };
const HOSTILE = "x' OR 1=1 --SYNTHPHI393";

/** A header row as the live route returns it. */
function rawRow(overrides: Partial<RawHeaderRow> = {}): RawHeaderRow {
  return {
    id: 1,
    sessionId: 393001,
    type: "Request",
    status: "Completed",
    isError: false,
    sourceItem: "Story393.Source",
    targetItem: "Story393.Target",
    bodyClassName: "Story393.Body",
    bodyId: "1",
    timeCreated: "2001-02-03 08:00:00",
    timeProcessed: "",
    correspondingMessageId: null,
    ...overrides,
  };
}

/** The live route's result for a body search. */
function bodyResult(rows: RawHeaderRow[], extra: Record<string, unknown> = {}) {
  return {
    action: "body",
    limit: 100,
    from: "2001-02-03 07:00:00",
    to: "2001-02-03 09:00:00",
    interopEnabled: true,
    rows,
    hasMore: false,
    ...extra,
  };
}

const BODY_ARGS = {
  action: "body",
  ...WINDOW,
  bodyClass: "Story393.Body",
  filters: [{ property: "Code", op: "eq", value: "K1-alpha" }],
};

describe("iris_message_search body (Story 39.3)", () => {
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
    it("declares body as the governed action and filters as the PHI input", () => {
      expect(messageSearchTool.dataPolicy).toEqual({ actions: ["body"], phiInputs: ["filters"] });
      expect(messageSearchTool.mutates).toEqual({ headers: "read", body: "read", searchTable: "read" });
    });

    it("exports the ten operators in the documented order", () => {
      expect([...BODY_FILTER_OPS]).toEqual([
        "eq", "ne", "lt", "le", "gt", "ge", "contains", "startsWith", "isNull", "notNull",
      ]);
    });

    it("describes the filter grammar, the case rules, the policy, the refusal code and the default state", () => {
      const description = messageSearchTool.description;
      for (const text of [
        "**body** (read, enabled by default)",
        "bodyClass",
        "1 to 10 conditions",
        "case-sensitive substring",
        "ignores case",
        "stream property accepts only isNull and notNull",
        "DATA_POLICY_BLOCKED",
        "IRIS_DATA_POLICY",
        "never contains a body value",
        "iris_message_search:body",
      ]) {
        expect(description, text).toContain(text);
      }
      expect(description).not.toMatch(/\/api\/|\/interop\//);
    });
  });

  // -- schema -------------------------------------------------------------

  describe("filters schema", () => {
    const parse = (filters: unknown) => messageSearchTool.inputSchema.safeParse({ ...BODY_ARGS, filters });
    const ok = { property: "Code", op: "eq", value: "x" };

    it.each(BODY_FILTER_OPS)("accepts the operator %s", (op) => {
      expect(parse([{ property: "Code", op, value: "x" }]).success).toBe(true);
    });

    it("accepts a string, a number and a boolean value, and no value", () => {
      for (const value of ["x", 12.5, 0, true, false, "x".repeat(1024)]) {
        expect(parse([{ property: "Code", op: "eq", value }]).success, JSON.stringify(value).slice(0, 20)).toBe(true);
      }
      expect(parse([{ property: "Code", op: "isNull" }]).success).toBe(true);
    });

    it("accepts 1 to 10 filters and a property of 128 characters", () => {
      expect(parse([ok]).success).toBe(true);
      expect(parse(Array.from({ length: 10 }, () => ok)).success).toBe(true);
      expect(parse([{ property: `A${"x".repeat(127)}`, op: "eq", value: "x" }]).success).toBe(true);
    });

    it.each([
      ["no filters", []],
      ["11 filters", Array.from({ length: 11 }, () => ok)],
      ["a string", "SYNTHPHI393"],
      ["a number in the list", [5]],
      ["a property with a space", [{ property: "Co de", op: "eq", value: "x" }]],
      ["a dotted property", [{ property: "Addr.Street", op: "eq", value: "x" }]],
      ["a property with a double quote", [{ property: 'a"b', op: "eq", value: "x" }]],
      ["a property of 129 characters", [{ property: `A${"x".repeat(128)}`, op: "eq", value: "x" }]],
      ["a property starting with a digit", [{ property: "1a", op: "eq", value: "x" }]],
      ["an empty property", [{ property: "", op: "eq", value: "x" }]],
      ["no property", [{ op: "eq", value: "x" }]],
      ["no op", [{ property: "Code", value: "x" }]],
      ["an op in capitals", [{ property: "Code", op: "EQ", value: "x" }]],
      ["op like", [{ property: "Code", op: "like", value: "x" }]],
      ["op =", [{ property: "Code", op: "=", value: "x" }]],
      ["an empty value", [{ property: "Code", op: "eq", value: "" }]],
      ["a value of 1025 characters", [{ property: "Code", op: "eq", value: "x".repeat(1025) }]],
      ["an object value", [{ property: "Code", op: "eq", value: { a: 1 } }]],
      ["an array value", [{ property: "Code", op: "eq", value: [1] }]],
      ["a null value", [{ property: "Code", op: "eq", value: null }]],
    ])("rejects %s", (_name, filters) => {
      expect(parse(filters).success).toBe(false);
    });

    it("strips a key the filter does not define", () => {
      const parsed = parse([{ ...ok, extra: "SYNTHPHI393" }]);
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.filters).toEqual([ok]);
    });

    it("no issue message echoes the value that was rejected", () => {
      const rejected = [
        [{ property: `Co de ${HOSTILE}`, op: "eq", value: "x" }],
        [{ property: "Code", op: `${HOSTILE}`, value: "x" }],
        [{ property: "Code", op: "eq", value: { a: HOSTILE } }],
        [{ property: "Code", op: "eq", value: HOSTILE.repeat(100) }],
        HOSTILE,
      ];
      for (const filters of rejected) {
        const parsed = parse(filters);
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
          const messages = parsed.error.issues.map((issue) => issue.message).join("\n");
          expect(messages).not.toContain("SYNTHPHI393");
        }
      }
    });

    it("leaves bodyClass and filters optional in the schema, because the handler requires them for body only", () => {
      expect(messageSearchTool.inputSchema.safeParse({ action: "headers", ...WINDOW }).success).toBe(true);
      expect(messageSearchTool.inputSchema.safeParse({ action: "body", ...WINDOW }).success).toBe(true);
    });
  });

  // -- the wire body ----------------------------------------------------------

  describe("the request sent to IRIS", () => {
    it("sends the body action, the class, the filters as given, the window, limit 100 and the namespace", async () => {
      mockHttp.post.mockResolvedValue(envelope(bodyResult([rawRow()])));

      await messageSearchTool.handler(BODY_ARGS, ctx);

      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      expect(mockHttp.post).toHaveBeenCalledWith(ROUTE, {
        action: "body",
        from: "2001-02-03T07:00:00Z",
        to: "2001-02-03T09:00:00Z",
        limit: 100,
        namespace: "USER",
        bodyClass: "Story393.Body",
        filters: [{ property: "Code", op: "eq", value: "K1-alpha" }],
      });
    });

    it("sends the scope filters, the cursor position and every filter of a combined search", async () => {
      mockHttp.post.mockResolvedValue(envelope(bodyResult([])));
      const cursor = Buffer.from(JSON.stringify({ t: "2001-02-03 08:00:01", id: 2 }), "utf8").toString("base64url");
      const filters = [
        { property: "Code", op: "startsWith", value: "K" },
        { property: "Amount", op: "ge", value: -5 },
        { property: "Flag", op: "eq", value: true },
        { property: "Note", op: "notNull" },
      ];

      await messageSearchTool.handler(
        { ...BODY_ARGS, filters, target: "Story393.Other", source: "S", item: "I", errorOnly: true, sessionId: 7, status: "Errored", limit: 2, cursor, namespace: "EXECMCPTMP393A" },
        ctx,
      );

      expect(mockHttp.post.mock.calls[0]?.[1]).toEqual({
        action: "body",
        from: "2001-02-03T07:00:00Z",
        to: "2001-02-03T09:00:00Z",
        limit: 2,
        namespace: "EXECMCPTMP393A",
        item: "I",
        source: "S",
        target: "Story393.Other",
        status: "Errored",
        sessionId: 7,
        bodyClass: "Story393.Body",
        filters,
        errorOnly: true,
        afterTimeCreated: "2001-02-03 08:00:01",
        afterId: 2,
      });
    });

    it("sends no filters key on the headers action, so its wire is what it was", async () => {
      mockHttp.post.mockResolvedValue(envelope({ ...bodyResult([rawRow()]), action: "headers" }));

      await messageSearchTool.handler({ action: "headers", ...WINDOW, bodyClass: "Story393.Body" }, ctx);

      expect(mockHttp.post.mock.calls[0]?.[1]).toEqual({
        action: "headers",
        from: "2001-02-03T07:00:00Z",
        to: "2001-02-03T09:00:00Z",
        limit: 100,
        namespace: "USER",
        bodyClass: "Story393.Body",
      });
    });
  });

  // -- required input ---------------------------------------------------------------

  describe("required input", () => {
    it.each([
      ["bodyClass missing", { ...BODY_ARGS, bodyClass: undefined }, "bodyClass"],
      ["bodyClass empty", { ...BODY_ARGS, bodyClass: "" }, "bodyClass"],
      ["filters missing", { ...BODY_ARGS, filters: undefined }, "filters"],
      ["filters empty", { ...BODY_ARGS, filters: [] }, "filters"],
    ])("%s is a validation error naming the parameter, with no HTTP call", async (_name, args, token) => {
      const result = await messageSearchTool.handler(args, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(`'${token}'`);
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("filters on the headers action is refused, not ignored, with no HTTP call", async () => {
      const result = await messageSearchTool.handler({ action: "headers", ...WINDOW, filters: BODY_ARGS.filters }, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe("'filters' applies only to the body action.");
      expect(result.structuredContent).toBeUndefined();
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("a bad cursor is a validation error with no HTTP call", async () => {
      const result = await messageSearchTool.handler({ ...BODY_ARGS, cursor: "not a cursor" }, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("'cursor'");
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("a bad from is a validation error even under block, because the window is parsed first", async () => {
      const result = await messageSearchTool.handler({ ...BODY_ARGS, from: "x" }, ctxWithPolicy("block"));

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content[0]?.text).toContain("'from'");
    });
  });

  // -- the data policy -------------------------------------------------------

  describe("the data policy (AD-26, AD-9)", () => {
    it("block refuses with DATA_POLICY_BLOCKED and makes no HTTP call", async () => {
      const result = await messageSearchTool.handler(BODY_ARGS, ctxWithPolicy("block"));

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ code: "DATA_POLICY_BLOCKED", action: "body", policy: "block" });
      expect(result.content[0]?.text).toBe(
        "The block data policy withholds message body data, and a body search reveals what bodies hold, so " +
          "the body action is refused. Use the headers action, or ask the operator for a looser IRIS_DATA_POLICY " +
          "for this profile.",
      );
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("block is decided before the body's own input checks and before the cursor", async () => {
      for (const args of [
        { action: "body", ...WINDOW },
        { ...BODY_ARGS, cursor: "not a cursor" },
        { ...BODY_ARGS, bodyClass: "" },
      ]) {
        const result = await messageSearchTool.handler(args, ctxWithPolicy("block"));
        expect(result.structuredContent).toEqual({ code: "DATA_POLICY_BLOCKED", action: "body", policy: "block" });
      }
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("the policy is the call's own profile's: a block profile refuses while a redact profile of the same server runs", async () => {
      mockHttp.post.mockResolvedValue(envelope(bodyResult([rawRow()])));
      const tight = ctxWithPolicy("block");
      const loose = ctxWithPolicy("redact");

      const refused = await messageSearchTool.handler(BODY_ARGS, tight);
      const ran = await messageSearchTool.handler(BODY_ARGS, loose);

      expect(refused.isError).toBe(true);
      expect(ran.isError).toBeFalsy();
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
    });

    it("headers is not under the policy: it runs under block and its result has no dataPolicy", async () => {
      mockHttp.post.mockResolvedValue(envelope({ ...bodyResult([rawRow()]), action: "headers" }));

      const result = await messageSearchTool.handler({ action: "headers", ...WINDOW }, ctxWithPolicy("block"));

      expect(result.isError).toBeFalsy();
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      expect(result.structuredContent).not.toHaveProperty("dataPolicy");
      expect(result.content[0]?.text).not.toContain("Data policy");
    });

    it.each([
      ["no policy on the config (the default)", undefined, "redact"],
      ["redact", "redact", "redact"],
      ["allow", "allow", "allow"],
    ] as const)("%s runs the search and reports dataPolicy with zero counts", async (_name, configured, policy) => {
      mockHttp.post.mockResolvedValue(envelope(bodyResult([rawRow(), rawRow({ id: 2, bodyId: "2" })])));
      const context = configured === undefined ? ctx : ctxWithPolicy(configured);

      const result = await messageSearchTool.handler(BODY_ARGS, context);

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.dataPolicy).toEqual({ policy, redacted: 0, blocked: 0 });
      expect(Object.keys(structured)).toEqual(["action", "rows", "hasMore", "limit", "from", "fromRaw", "to", "toRaw", "dataPolicy"]);
      expect(structured.action).toBe("body");
      const text = result.content[0]?.text as string;
      expect(text.split("\n").at(-1)).toBe(`Data policy ${policy}: header rows only; the body action returns no body content.`);
      expect(text.split("\n")[0]).toBe("2 message header(s) from 2001-02-03T07:00:00.000Z to 2001-02-03T09:00:00.000Z.");
    });
  });

  // -- results --------------------------------------------------------------------

  describe("the result", () => {
    it("maps the rows to the shared header-row shape", async () => {
      mockHttp.post.mockResolvedValue(
        envelope(bodyResult([rawRow({ id: 10, type: "Response", correspondingMessageId: 1, timeCreated: "2001-02-03 08:00:09" })])),
      );

      const result = await messageSearchTool.handler(BODY_ARGS, ctx);

      expect((result.structuredContent as { rows: unknown[] }).rows).toEqual([
        {
          id: 10,
          sessionId: 393001,
          type: "Response",
          status: "Completed",
          isError: false,
          sourceItem: "Story393.Source",
          targetItem: "Story393.Target",
          bodyClassName: "Story393.Body",
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
        envelope(bodyResult([rawRow({ id: 4, timeCreated: "2001-02-03 08:00:03" }), rawRow({ id: 5, timeCreated: "2001-02-03 08:00:03" })], { hasMore: true, limit: 2 })),
      );

      const paged = await messageSearchTool.handler({ ...BODY_ARGS, limit: 2 }, ctx);
      const structured = paged.structuredContent as { hasMore: boolean; nextCursor?: string; dataPolicy: unknown };

      expect(structured.hasMore).toBe(true);
      expect(decodeCursor(structured.nextCursor as string)).toEqual({ t: "2001-02-03 08:00:03", id: 5 });
      expect(paged.content[0]?.text).toContain("pass nextCursor as cursor");

      mockHttp.post.mockResolvedValue(envelope(bodyResult([rawRow()])));
      const last = await messageSearchTool.handler(BODY_ARGS, ctx);
      expect(last.structuredContent).not.toHaveProperty("nextCursor");
    });

    it("an empty page is a plain success that still reports the policy", async () => {
      mockHttp.post.mockResolvedValue(envelope(bodyResult([])));

      const result = await messageSearchTool.handler(BODY_ARGS, ctx);

      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.text).toBe(
        "No message headers matched.\nData policy redact: header rows only; the body action returns no body content.",
      );
      expect((result.structuredContent as { dataPolicy: unknown }).dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
    });

    it("a namespace without Interoperability is notApplicable with the policy, not an error", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({ action: "body", limit: 100, from: "2001-02-03 07:00:00", to: "2001-02-03 09:00:00", interopEnabled: false, rows: [], hasMore: false }),
      );

      const result = await messageSearchTool.handler({ ...BODY_ARGS, namespace: "EXECMCPTMP393C" }, ctxWithPolicy("allow"));

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({
        action: "body",
        notApplicable: true,
        rows: [],
        hasMore: false,
        dataPolicy: { policy: "allow", redacted: 0, blocked: 0 },
      });
      expect(String(structured.reason)).toContain("EXECMCPTMP393C");
      expect(result.content[0]?.text).toContain("Data policy allow:");
    });
  });

  // -- no echo -----------------------------------------------------------------------

  describe("no filter value reaches a response", () => {
    const hostileArgs = { ...BODY_ARGS, filters: [{ property: "Code", op: "eq", value: HOSTILE }] };

    it("a success holds none in its content or its structured content", async () => {
      mockHttp.post.mockResolvedValue(envelope(bodyResult([rawRow()])));

      const result = await messageSearchTool.handler(hostileArgs, ctx);

      expect(JSON.stringify(result)).not.toContain("SYNTHPHI393");
      expect(mockHttp.post.mock.calls[0]?.[1]).toMatchObject({ filters: [{ value: HOSTILE }] });
    });

    it("an IRIS error carries the IRIS text only, which holds none", async () => {
      mockHttp.post.mockRejectedValue(
        new IrisApiError(
          500,
          [{ error: "Parameter 'filters[0].property' is not a searchable property of the body class" }],
          ROUTE,
          "Parameter 'filters[0].property' is not a searchable property of the body class",
        ),
      );

      const result = await messageSearchTool.handler(hostileArgs, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Error performing 'body' on iris_message_search");
      expect(result.content[0]?.text).toContain("filters[0].property");
      expect(JSON.stringify(result)).not.toContain("SYNTHPHI393");
    });

    it("the block refusal and the validation errors hold none", async () => {
      const blocked = await messageSearchTool.handler(hostileArgs, ctxWithPolicy("block"));
      const noClass = await messageSearchTool.handler({ ...hostileArgs, bodyClass: "" }, ctx);
      const withHeaders = await messageSearchTool.handler({ ...hostileArgs, action: "headers" }, ctx);

      for (const result of [blocked, noClass, withHeaders]) {
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).not.toContain("SYNTHPHI393");
      }
      expect(mockHttp.post).not.toHaveBeenCalled();
    });
  });
});
