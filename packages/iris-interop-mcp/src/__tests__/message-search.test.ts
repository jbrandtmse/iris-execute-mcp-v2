/**
 * Tests for `iris_message_search` (Story 39.1): mocked-HTTP unit tests of the tool definition, the
 * input schema, the request it sends, the row and timestamp mapping, the cursor, the
 * not-configured result, the unbuilt actions and the IRIS error path.
 *
 * The live behavior (rows equal a hand-written SQL oracle, second namespace, byte-identical
 * `resendFiltered`) is pinned by `iris-mcp-all`'s `story-39-1-message-search-live-gate.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  decodeCursor,
  encodeCursor,
  mapHeaderRow,
  messageSearchTool,
  toCanonicalUtc,
  utcToIso,
  type RawHeaderRow,
} from "../tools/message-search.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

const ROUTE = "/api/executemcp/v2/interop/message/search";

/** A header row as IRIS returns it. */
function rawRow(overrides: Partial<RawHeaderRow> = {}): RawHeaderRow {
  return {
    id: 5,
    sessionId: 300,
    type: "Request",
    status: "Delivered",
    isError: false,
    sourceItem: "Story391.Alpha",
    targetItem: "Story391.Beta",
    bodyClassName: "Story391.Body.A",
    bodyId: "1005",
    timeCreated: "2001-02-03 08:00:00.5",
    timeProcessed: "2001-02-03 08:00:01",
    correspondingMessageId: null,
    ...overrides,
  };
}

/** The IRIS result for a successful search. */
function searchResult(rows: RawHeaderRow[], extra: Record<string, unknown> = {}) {
  return {
    action: "headers",
    interopEnabled: true,
    rows,
    hasMore: false,
    limit: 100,
    from: "2001-02-03 06:00:00",
    to: "2001-02-03 18:00:00",
    ...extra,
  };
}

describe("iris_message_search", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -- definition -----------------------------------------------------

  describe("definition", () => {
    it("has the name, scope and four truthful read-only annotations", () => {
      expect(messageSearchTool.name).toBe("iris_message_search");
      expect(messageSearchTool.scope).toBe("NS");
      expect(messageSearchTool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    });

    it("classifies all three actions as reads and declares no defaultEnabled", () => {
      expect(messageSearchTool.mutates).toEqual({ headers: "read", body: "read", searchTable: "read" });
      expect(messageSearchTool.defaultEnabled).toBeUndefined();
    });

    it("describes the scope, the output cap, the unbuilt actions, notApplicable and the governance keys", () => {
      const description = messageSearchTool.description;
      expect(description).toContain("at most 7 days");
      expect(description).toContain("not the work done");
      expect(description).toContain("60 s Web Gateway timeout");
      expect(description).toContain("NOT_IMPLEMENTED");
      expect(description).toContain("notApplicable: true");
      expect(description).toContain("IRIS_GOVERNANCE");
      expect(description).toContain("iris_message_search:headers");
      expect(description).toContain("enabled by default");
    });

    it("names no REST path", () => {
      expect(messageSearchTool.description).not.toMatch(/\/api\/|\/interop\//);
    });
  });

  // -- schema ---------------------------------------------------------

  describe("input schema", () => {
    const parse = (input: Record<string, unknown>) => messageSearchTool.inputSchema.safeParse(input);

    it("accepts the minimal headers call and every optional field", () => {
      expect(parse({ action: "headers", from: "2001-02-03T06:00:00Z" }).success).toBe(true);
      expect(
        parse({
          action: "headers",
          from: "2001-02-03T06:00:00Z",
          to: "2001-02-03T18:00:00Z",
          item: "A",
          source: "B",
          target: "C",
          status: "Errored",
          sessionId: 7,
          bodyClass: "X.Y",
          errorOnly: true,
          limit: 500,
          cursor: "abc",
          namespace: "USER",
        }).success,
      ).toBe(true);
    });

    it("requires action and from, and accepts only the three actions", () => {
      expect(parse({ from: "2001-02-03T06:00:00Z" }).success).toBe(false);
      expect(parse({ action: "headers" }).success).toBe(false);
      expect(parse({ action: "bogus", from: "2001-02-03T06:00:00Z" }).success).toBe(false);
      for (const action of ["headers", "body", "searchTable"]) {
        expect(parse({ action, from: "2001-02-03T06:00:00Z" }).success, action).toBe(true);
      }
    });

    it.each([0, 501, 2.5, -1])("rejects limit %s", (limit) => {
      expect(parse({ action: "headers", from: "2001-02-03T06:00:00Z", limit }).success).toBe(false);
    });

    it("rejects a non-positive or fractional sessionId and an unknown status", () => {
      expect(parse({ action: "headers", from: "2001-02-03T06:00:00Z", sessionId: 0 }).success).toBe(false);
      expect(parse({ action: "headers", from: "2001-02-03T06:00:00Z", sessionId: 1.5 }).success).toBe(false);
      expect(parse({ action: "headers", from: "2001-02-03T06:00:00Z", status: "Bogus" }).success).toBe(false);
      expect(parse({ action: "headers", from: "2001-02-03T06:00:00Z", errorOnly: "yes" }).success).toBe(false);
    });
  });

  // -- timestamps -----------------------------------------------------

  describe("toCanonicalUtc", () => {
    it.each([
      ["2001-02-03T10:00:00Z", "2001-02-03T10:00:00Z"],
      ["2001-02-03T12:00:00+02:00", "2001-02-03T10:00:00Z"],
      ["2001-02-03T12:00:00+0200", "2001-02-03T10:00:00Z"],
      ["2001-02-03T12:00:00+02", "2001-02-03T10:00:00Z"],
      ["2001-02-03T04:30:00-05:30", "2001-02-03T10:00:00Z"],
      ["2001-02-03T10:00Z", "2001-02-03T10:00:00Z"],
      ["2001-02-03T08:00:00.500Z", "2001-02-03T08:00:00.5Z"],
      ["2001-02-03T08:00:00.000Z", "2001-02-03T08:00:00Z"],
      ["2001-02-03T08:00:00.123456Z", "2001-02-03T08:00:00.123Z"],
      ["2001-02-03T23:30:00-01:00", "2001-02-04T00:30:00Z"],
      ["2001-02-03T00:30:00+01:00", "2001-02-02T23:30:00Z"],
    ])("converts %s to %s", (input, expected) => {
      expect(toCanonicalUtc(input)).toBe(expected);
    });

    it.each([
      "2001-02-03T10:00:00",
      "2001-02-03",
      "2001-02-03 10:00:00Z",
      "garbage",
      "",
      "2001-02-30T10:00:00Z",
      "2001-13-01T10:00:00Z",
      "2001-02-03T24:00:00Z",
      "2001-02-03T10:60:00Z",
      "2001-02-03T10:00:60Z",
      "2001-02-03T10:00:00+24:00",
      "0099-02-03T10:00:00Z",
    ])("refuses %j", (input) => {
      expect(toCanonicalUtc(input)).toBeUndefined();
    });

    it("converts a Date to the canonical form, trimming a zero millisecond part", () => {
      expect(toCanonicalUtc(new Date("2001-02-03T04:05:06.789Z"))).toBe("2001-02-03T04:05:06.789Z");
      expect(toCanonicalUtc(new Date("2001-02-03T04:05:06.000Z"))).toBe("2001-02-03T04:05:06Z");
      expect(toCanonicalUtc(new Date("2001-02-03T04:05:06.120Z"))).toBe("2001-02-03T04:05:06.12Z");
      expect(toCanonicalUtc(new Date(Number.NaN))).toBeUndefined();
    });
  });

  describe("utcToIso", () => {
    it("converts a stored UTC value to toISOString form", () => {
      expect(utcToIso("2001-02-03 08:00:00.5")).toBe("2001-02-03T08:00:00.500Z");
      expect(utcToIso("2001-02-03 08:00:01")).toBe("2001-02-03T08:00:01.000Z");
      expect(utcToIso("2001-02-03 09:15:30.123456")).toBe("2001-02-03T09:15:30.123Z");
    });

    it("round-trips a known value against $ZDATETIME", () => {
      // IRIS 2026.2 (Build 221U), 2026-10-17: $ZDATETIMEH("2001-02-03 12:00:00.123", 3) = "58473,43200.123".
      // $HOROLOG day 0 is 1840-12-31.
      const horologMs = Date.UTC(1840, 11, 31) + 58473 * 86_400_000 + 43_200_123;
      expect(Date.parse(utcToIso("2001-02-03 12:00:00.123"))).toBe(horologMs);
    });

    it.each([undefined, null, "", "garbage", "2001-02-03", "2001-02-30 00:00:00", "2001-02-03 25:00:00", "2001-02-03 08:00:00Z"])(
      "returns the empty string, never a throw, for %j",
      (value) => {
        expect(utcToIso(value as string)).toBe("");
      },
    );
  });

  // -- rows and cursors -------------------------------------------------

  describe("mapHeaderRow", () => {
    it("adds ISO times with Raw siblings and keeps the other fields", () => {
      const mapped = mapHeaderRow(rawRow({ correspondingMessageId: 4 }));
      expect(mapped).toEqual({
        id: 5,
        sessionId: 300,
        type: "Request",
        status: "Delivered",
        isError: false,
        sourceItem: "Story391.Alpha",
        targetItem: "Story391.Beta",
        bodyClassName: "Story391.Body.A",
        bodyId: "1005",
        timeCreated: "2001-02-03T08:00:00.500Z",
        timeCreatedRaw: "2001-02-03 08:00:00.5",
        timeProcessed: "2001-02-03T08:00:01.000Z",
        timeProcessedRaw: "2001-02-03 08:00:01",
        correspondingMessageId: 4,
      });
    });

    it("maps an empty time to empty strings and a missing corresponding message to null", () => {
      const mapped = mapHeaderRow(rawRow({ timeProcessed: "", correspondingMessageId: null }));
      expect(mapped.timeProcessed).toBe("");
      expect(mapped.timeProcessedRaw).toBe("");
      expect(mapped.correspondingMessageId).toBeNull();
    });

    it("keeps a malformed stored time in Raw and empties the ISO form", () => {
      const mapped = mapHeaderRow(rawRow({ timeCreated: "not a time" }));
      expect(mapped.timeCreated).toBe("");
      expect(mapped.timeCreatedRaw).toBe("not a time");
    });

    it("never carries ErrorStatus or Description", () => {
      const mapped = mapHeaderRow({ ...rawRow(), ErrorStatus: "x", Description: "y" } as RawHeaderRow);
      expect(Object.keys(mapped)).not.toContain("ErrorStatus");
      expect(Object.keys(mapped)).not.toContain("Description");
    });
  });

  describe("cursor", () => {
    it("round-trips the stored time and the id as base64url JSON", () => {
      const cursor = { t: "2001-02-03 08:00:00.5", id: 5 };
      const encoded = encodeCursor(cursor);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))).toEqual(cursor);
      expect(decodeCursor(encoded)).toEqual(cursor);
    });

    const encodeJson = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

    it.each([
      ["not base64url", "not base64url!"],
      ["not JSON", Buffer.from("plain text", "utf8").toString("base64url")],
      ["a JSON array", encodeJson([1, 2])],
      ["a missing id", encodeJson({ t: "2001-02-03 08:00:00" })],
      ["an id of 0", encodeJson({ t: "2001-02-03 08:00:00", id: 0 })],
      ["a fractional id", encodeJson({ t: "2001-02-03 08:00:00", id: 1.5 })],
      ["a string id", encodeJson({ t: "2001-02-03 08:00:00", id: "5" })],
      ["a time that is not a stored UTC value", encodeJson({ t: "x' OR 1=1--", id: 5 })],
      ["an impossible date", encodeJson({ t: "2001-02-30 08:00:00", id: 5 })],
      ["the empty string", ""],
    ])("refuses %s", (_name, value) => {
      expect(decodeCursor(value)).toBeUndefined();
    });
  });

  // -- handler: the request -----------------------------------------------

  describe("headers request", () => {
    it("sends to (now, canonical UTC) and limit 100 explicitly when the caller omits them", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2001-02-03T04:05:06.789Z"));
      mockHttp.post.mockResolvedValue(envelope(searchResult([])));

      await messageSearchTool.handler({ action: "headers", from: "2001-02-03T00:00:00Z" }, ctx);

      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      expect(mockHttp.post).toHaveBeenCalledWith(ROUTE, {
        action: "headers",
        from: "2001-02-03T00:00:00Z",
        to: "2001-02-03T04:05:06.789Z",
        limit: 100,
        namespace: "USER",
      });
    });

    it("sends an offset input as canonical UTC and passes the filters through", async () => {
      mockHttp.post.mockResolvedValue(envelope(searchResult([])));

      await messageSearchTool.handler(
        {
          action: "headers",
          from: "2001-02-03T12:00:00+02:00",
          to: "2001-02-03T20:00:00.250+02:00",
          item: "Story391.Alpha",
          source: "S",
          target: "T",
          status: "Errored",
          sessionId: 200,
          bodyClass: "Story391.Body.B",
          errorOnly: true,
          limit: 3,
          namespace: "EXECMCPTMP391A",
        },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(ROUTE, {
        action: "headers",
        from: "2001-02-03T10:00:00Z",
        to: "2001-02-03T18:00:00.25Z",
        limit: 3,
        namespace: "EXECMCPTMP391A",
        item: "Story391.Alpha",
        source: "S",
        target: "T",
        status: "Errored",
        sessionId: 200,
        bodyClass: "Story391.Body.B",
        errorOnly: true,
      });
    });

    it("sends only the keys the caller set", async () => {
      mockHttp.post.mockResolvedValue(envelope(searchResult([])));

      await messageSearchTool.handler(
        { action: "headers", from: "2001-02-03T06:00:00Z", to: "2001-02-03T18:00:00Z" },
        ctx,
      );

      const sent = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(Object.keys(sent).sort()).toEqual(["action", "from", "limit", "namespace", "to"]);
    });

    it("turns a cursor into afterTimeCreated and afterId", async () => {
      mockHttp.post.mockResolvedValue(envelope(searchResult([])));
      const cursor = encodeCursor({ t: "2001-02-03 08:00:00.5", id: 5 });

      await messageSearchTool.handler(
        { action: "headers", from: "2001-02-03T06:00:00Z", to: "2001-02-03T18:00:00Z", cursor },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        ROUTE,
        expect.objectContaining({ afterTimeCreated: "2001-02-03 08:00:00.5", afterId: 5 }),
      );
      const sent = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(sent).not.toHaveProperty("cursor");
    });
  });

  // -- handler: bad input, no call --------------------------------------------

  describe("input the tool refuses before any HTTP call", () => {
    const valid = { action: "headers", from: "2001-02-03T06:00:00Z", to: "2001-02-03T18:00:00Z" };

    it.each([
      ["a naive from", { from: "2001-02-03T06:00:00" }, "'from'"],
      ["a garbage from", { from: "x' OR 1=1--" }, "'from'"],
      ["an impossible from", { from: "2001-02-30T06:00:00Z" }, "'from'"],
      ["a garbage to", { to: "x' OR 1=1--" }, "'to'"],
      ["a naive to", { to: "2001-02-03T18:00:00" }, "'to'"],
      ["a malformed cursor", { cursor: "x' OR 1=1--" }, "'cursor'"],
      ["a cursor that is not ours", { cursor: encodeCursor({ t: "2001-02-03 08:00:00", id: 5 }).slice(2) }, "'cursor'"],
    ])("%s: isError naming the parameter, not the value", async (_name, override, token) => {
      const result = await messageSearchTool.handler({ ...valid, ...override }, ctx);

      expect(result.isError).toBe(true);
      const text = result.content[0]?.text ?? "";
      expect(text).toContain(token);
      expect(text).not.toContain("OR 1=1");
      expect(mockHttp.post).not.toHaveBeenCalled();
    });
  });

  // -- handler: results ----------------------------------------------------

  describe("headers result", () => {
    it("maps the rows, converts the window and omits nextCursor on the last page", async () => {
      mockHttp.post.mockResolvedValue(
        envelope(searchResult([rawRow(), rawRow({ id: 6, timeProcessed: "", correspondingMessageId: 5 })])),
      );

      const result = await messageSearchTool.handler(
        { action: "headers", from: "2001-02-03T06:00:00Z", to: "2001-02-03T18:00:00Z" },
        ctx,
      );

      expect(result.isError).toBeFalsy();
      const content = result.structuredContent as Record<string, unknown>;
      expect(content).toMatchObject({
        action: "headers",
        hasMore: false,
        limit: 100,
        from: "2001-02-03T06:00:00.000Z",
        fromRaw: "2001-02-03 06:00:00",
        to: "2001-02-03T18:00:00.000Z",
        toRaw: "2001-02-03 18:00:00",
      });
      expect(content).not.toHaveProperty("nextCursor");
      const rows = content.rows as Array<Record<string, unknown>>;
      expect(rows.map((row) => row.id)).toEqual([5, 6]);
      expect(rows[0]).toMatchObject({ timeCreated: "2001-02-03T08:00:00.500Z", timeCreatedRaw: "2001-02-03 08:00:00.5" });
      expect(rows[1]).toMatchObject({ timeProcessed: "", timeProcessedRaw: "", correspondingMessageId: 5 });
      expect(result.content[0]?.text).toContain("#5 Request Story391.Alpha -> Story391.Beta (Delivered)");
    });

    it("carries a nextCursor built from the last row only when hasMore is true", async () => {
      mockHttp.post.mockResolvedValue(
        envelope(searchResult([rawRow({ id: 3 }), rawRow({ id: 4, timeCreated: "2001-02-03 07:30:00" })], { hasMore: true, limit: 2 })),
      );

      const result = await messageSearchTool.handler(
        { action: "headers", from: "2001-02-03T06:00:00Z", to: "2001-02-03T18:00:00Z", limit: 2 },
        ctx,
      );

      const content = result.structuredContent as { hasMore: boolean; nextCursor?: string };
      expect(content.hasMore).toBe(true);
      expect(decodeCursor(content.nextCursor as string)).toEqual({ t: "2001-02-03 07:30:00", id: 4 });
      expect(result.content[0]?.text).toContain("pass nextCursor as cursor");
    });

    it("reports an empty page plainly", async () => {
      mockHttp.post.mockResolvedValue(envelope(searchResult([])));

      const result = await messageSearchTool.handler(
        { action: "headers", from: "2001-02-03T06:00:00Z", to: "2001-02-03T18:00:00Z" },
        ctx,
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0]?.text).toBe("No message headers matched.");
      expect((result.structuredContent as { rows: unknown[] }).rows).toEqual([]);
    });
  });

  describe("a namespace without Interoperability", () => {
    it("is a success with notApplicable, a reason, no rows and no more pages", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({ action: "headers", interopEnabled: false, rows: [], hasMore: false, limit: 100, from: "2001-02-03 06:00:00", to: "2001-02-03 18:00:00" }),
      );

      const result = await messageSearchTool.handler(
        { action: "headers", from: "2001-02-03T06:00:00Z", to: "2001-02-03T18:00:00Z", namespace: "EXECMCPTMP391C" },
        ctx,
      );

      expect(result.isError).toBeFalsy();
      const content = result.structuredContent as Record<string, unknown>;
      expect(content).toMatchObject({ notApplicable: true, rows: [], hasMore: false, action: "headers" });
      expect(String(content.reason)).toContain("EXECMCPTMP391C");
      expect(content).not.toHaveProperty("interopEnabled");
    });
  });

  // -- handler: unbuilt actions ------------------------------------------------

  describe("actions that are declared but not built", () => {
    it.each(["body", "searchTable"])("%s returns the NOT_IMPLEMENTED refusal and makes no HTTP call", async (action) => {
      const result = await messageSearchTool.handler(
        { action, from: "2001-02-03T06:00:00Z", to: "2001-02-03T18:00:00Z" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        code: "NOT_IMPLEMENTED",
        action,
        availableActions: ["headers"],
      });
      expect(result.content[0]?.text).toContain(`'${action}'`);
      expect(mockHttp.post).not.toHaveBeenCalled();
    });
  });

  // -- handler: IRIS errors -------------------------------------------------------

  describe("IRIS errors", () => {
    it("surfaces an IrisApiError as isError with the tool and action named", async () => {
      mockHttp.post.mockRejectedValue(
        new IrisApiError(500, [{ error: "Parameter 'limit' must be an integer from 1 to 500" }], ROUTE, "Parameter 'limit' must be an integer from 1 to 500"),
      );

      const result = await messageSearchTool.handler(
        { action: "headers", from: "2001-02-03T06:00:00Z", to: "2001-02-03T18:00:00Z" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Error performing 'headers' on iris_message_search");
      expect(result.content[0]?.text).toContain("Parameter 'limit'");
    });

    it("rethrows an error that is not an IrisApiError", async () => {
      mockHttp.post.mockRejectedValue(new Error("boom"));

      await expect(
        messageSearchTool.handler({ action: "headers", from: "2001-02-03T06:00:00Z", to: "2001-02-03T18:00:00Z" }, ctx),
      ).rejects.toThrow("boom");
    });
  });
});
