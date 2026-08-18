/**
 * Story 35.4 — `iris_resource_manage:listPrivileges` bounding.
 *
 * `listPrivileges` was unbounded: grantee `_SYSTEM` (holds `%All`) returns
 * 15,341 rows / 2,900,478 characters live-measured 2026-08-17/18, which
 * exceeds the client transport limit and diverts the response to a file
 * (ledger `35-SWEEP-4`). This story adds two additive parameters (`maxRows`,
 * `cursor` — E-1: no new tool, no new action key) to the EXISTING
 * `iris_resource_manage` tool's `listPrivileges` action.
 *
 * The ObjectScript-level fixes (server-side `maxRows` fetch-loop cap in
 * `ExecuteMCPv2.REST.Security:SqlPrivilegeList`, and the `%All` short-circuit
 * that omits `GRANTED_VIA=SuperUser` rows while preserving real non-derived
 * grants) were proven LIVE against HSCUSTOM during dev (Rule #59 — a real
 * over-limit grantee, `_SYSTEM`, and a real column-level grant to a
 * disposable test role, since revoked/deleted):
 *   - `_SYSTEM`, maxRows=5           -> count=5, rowsCapped=true,
 *     superUserPrivilegesOmitted=10959
 *   - `_SYSTEM`, no maxRows          -> count=8, superUserPrivilegesOmitted=
 *     15333 (exact match to the lead's probe), NO rowsCapped field
 *   - `%Developer` control           -> count=11, NO new fields at all
 *     (byte-for-byte pre-35.4 shape — the AC 35.4.5 oracle)
 *   - disposable test role with 5 real column-level grants, maxRows=3 ->
 *     count=3, rowsCapped=true (proves the SECOND/column-level loop too)
 *
 * This suite covers what live curl calls cannot: the TOOL LAYER's schema
 * validation, wire forwarding, and — the part `audit.ts`'s `view` action gets
 * wrong (it rebuilds its result from only `events`/`count`/`nextCursor`,
 * silently dropping every other wire field) — that `rowsCapped` / `reason` /
 * `superUserPrivilegesOmitted` actually SURVIVE from the wire response into
 * the tool's `structuredContent` rather than being computed server-side and
 * thrown away here. Also covers the mechanical AC 35.4.5 back-compat proof
 * and a full cursor round-trip using the REAL `ctx.paginate` (the shared
 * mock `paginate` is a pass-through no-op).
 *
 * Plain `*.test.ts` -> DEFAULT vitest suite (Rule #8). No live IRIS here;
 * mocked HTTP. TypeScript-only — no `BOOTSTRAP_VERSION` impact (that came
 * from the ObjectScript change, recorded separately).
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext, PaginateResult } from "@iris-mcp/shared";
import { encodeCursor, decodeCursor } from "@iris-mcp/shared";
import { resourceManageTool } from "../tools/resource.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

const SQLPRIV_PATH = "/api/executemcp/v2/security/sqlprivilege";

// ── Real-paginate context (mirrors audit-coverage.test.ts / x509-coverage.test.ts) ──

function ctxWithRealPaginate(
  http: ReturnType<typeof createMockHttp>,
  pageSize: number,
): ToolContext {
  const base = createMockCtx(http);
  return {
    ...base,
    paginate<T>(items: T[], cursor?: string): PaginateResult<T> {
      const offset = decodeCursor(cursor);
      if (cursor && offset >= items.length && items.length > 0) {
        return { page: [], nextCursor: undefined };
      }
      const page = items.slice(offset, offset + pageSize);
      const nextOffset = offset + pageSize;
      const nextCursor =
        nextOffset < items.length ? encodeCursor(nextOffset) : undefined;
      return { page, nextCursor };
    },
  };
}

/** A synthetic object-level privilege row. */
function priv(i: number): Record<string, unknown> {
  return {
    type: "TABLE",
    name: `Sample.Table${i}`,
    privilege: "SELECT",
    grantedBy: "_SYSTEM",
    grantOption: "No",
    grantedVia: "Owner Privilege",
    hasColumnPriv: false,
  };
}

function makePrivs(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => priv(i));
}

// ════════════════════════════════════════════════════════════════════
// A. Schema validation — maxRows / cursor edge cases.
// ════════════════════════════════════════════════════════════════════

describe("iris_resource_manage listPrivileges — maxRows/cursor schema", () => {
  const schema = resourceManageTool.inputSchema;

  it("maxRows accepts a plain positive integer", () => {
    const r = schema.safeParse({
      action: "listPrivileges",
      grantee: "AppRole",
      maxRows: 250,
    });
    expect(r.success).toBe(true);
  });

  it("maxRows rejects 0 (not positive)", () => {
    const r = schema.safeParse({
      action: "listPrivileges",
      grantee: "AppRole",
      maxRows: 0,
    });
    expect(r.success).toBe(false);
  });

  it("maxRows rejects a negative value", () => {
    const r = schema.safeParse({
      action: "listPrivileges",
      grantee: "AppRole",
      maxRows: -5,
    });
    expect(r.success).toBe(false);
  });

  it("maxRows rejects a non-integer", () => {
    const r = schema.safeParse({
      action: "listPrivileges",
      grantee: "AppRole",
      maxRows: 10.5,
    });
    expect(r.success).toBe(false);
  });

  it("maxRows accepts an absurdly large value (the tool forwards verbatim; the server clamps to 1000)", () => {
    const r = schema.safeParse({
      action: "listPrivileges",
      grantee: "AppRole",
      maxRows: 999999999,
    });
    expect(r.success).toBe(true);
  });

  it("maxRows and cursor are both optional (omitted entirely still validates)", () => {
    const r = schema.safeParse({ action: "listPrivileges", grantee: "AppRole" });
    expect(r.success).toBe(true);
  });

  it("cursor accepts any string, including a malformed/non-base64 one (decodeCursor treats it as offset 0)", () => {
    const r = schema.safeParse({
      action: "listPrivileges",
      grantee: "AppRole",
      cursor: "not-a-real-cursor!!",
    });
    expect(r.success).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// B. Wire forwarding — maxRows on the GET querystring.
// ════════════════════════════════════════════════════════════════════

describe("iris_resource_manage listPrivileges — maxRows wire forwarding", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("forwards maxRows in the GET querystring when provided", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ grantee: "AppRole", level: "object", privileges: [], count: 0 }),
    );

    await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "AppRole", maxRows: 250 },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      `${SQLPRIV_PATH}?grantee=AppRole&maxRows=250`,
    );
  });

  it("omits maxRows from the querystring entirely when not provided (no '=undefined')", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ grantee: "AppRole", level: "object", privileges: [], count: 0 }),
    );

    await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "AppRole" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(`${SQLPRIV_PATH}?grantee=AppRole`);
  });

  it("forwards maxRows together with target for the column-level path (second loop)", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "AppRole",
        level: "column",
        target: "Sample.Person",
        privileges: [],
        count: 0,
      }),
    );

    await resourceManageTool.handler(
      {
        action: "listPrivileges",
        grantee: "AppRole",
        target: "Sample.Person",
        maxRows: 3,
      },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      `${SQLPRIV_PATH}?grantee=AppRole&target=Sample.Person&maxRows=3`,
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// C. AC 35.4.5 — mechanical back-compat proof (omitted maxRows, under-cap).
// ════════════════════════════════════════════════════════════════════

describe("iris_resource_manage listPrivileges — AC 35.4.5 back-compat", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("an omitted maxRows + an under-cap, non-%All server response yields the EXACT pre-35.4 shape (fails on drift)", async () => {
    // Pre-35.4 wire shape: no rowsCapped, no reason, no superUserPrivilegesOmitted
    // — exactly what the live %Developer control returned (count=11, no new
    // fields) before and after this story's ObjectScript change.
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "%Developer",
        level: "object",
        privileges: [
          { type: "TABLE", name: "Sample.Person", privilege: "SELECT" },
        ],
        count: 1,
      }),
    );

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "%Developer" },
      ctx,
    );

    // Pinned exact expected shape — a `toEqual`, not a subset/partial match,
    // so any accidental new unconditional field fails this test immediately.
    expect(result.structuredContent).toEqual({
      grantee: "%Developer",
      level: "object",
      privileges: [
        { type: "TABLE", name: "Sample.Person", privilege: "SELECT" },
      ],
      count: 1,
    });
    expect(result.structuredContent).not.toHaveProperty("rowsCapped");
    expect(result.structuredContent).not.toHaveProperty("reason");
    expect(result.structuredContent).not.toHaveProperty(
      "superUserPrivilegesOmitted",
    );
    expect(result.structuredContent).not.toHaveProperty("nextCursor");
  });

  // ── The pin above is necessary but NOT sufficient, and the code review
  // found out why: it runs against `createMockCtx`, whose `paginate` is a
  // pass-through no-op, with a ONE-row fixture. Both the `toEqual` and the
  // `not.toHaveProperty("nextCursor")` assertion therefore hold structurally,
  // no matter what the real `ctx.paginate` does — the drift they exist to
  // catch is invisible to them (Rule #59: "would this still pass if the
  // behavior never fired?").
  //
  // The drift was real. `ctx.paginate` slices at DEFAULT_PAGE_SIZE = 50
  // (`server-base.ts:83`) unconditionally, so before the review's fix a
  // caller who passed NO new parameters and whose grantee holds 51-100
  // privileges — comfortably under the server's 100-row default cap, i.e.
  // exactly the population AC 35.4.5 protects — silently received 50 rows,
  // `count: 50`, and a `nextCursor` they never asked for. Pagination is now
  // OPT-IN (see the handler in `resource.ts`).
  //
  // This test uses the REAL paginate semantics at the REAL default page size
  // and a fixture LARGER than that page size, so it fails if pagination ever
  // becomes unconditional again. Verified to fail against the pre-fix
  // handler.
  it("60 rows, maxRows and cursor BOTH omitted: every row is returned unpaged, with no nextCursor and no count rewrite (AC 35.4.5 — fails if pagination becomes unconditional)", async () => {
    const sixty = makePrivs(60);
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "BigRole",
        level: "object",
        privileges: sixty,
        count: 60,
      }),
    );
    // Real DEFAULT_PAGE_SIZE, not the shrunken size the round-trip tests use.
    const realCtx = ctxWithRealPaginate(mockHttp, 50);

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "BigRole" },
      realCtx,
    );

    const structured = result.structuredContent as {
      privileges: Array<{ name: string }>;
      count: number;
      nextCursor?: string;
    };
    expect(structured.privileges).toHaveLength(60);
    expect(structured.count).toBe(60);
    expect(structured.privileges[59]?.name).toBe("Sample.Table59");
    expect(structured).not.toHaveProperty("nextCursor");
  });

  it("60 rows with maxRows supplied: the caller HAS opted in, so the sibling 50-row pagination convention applies (AC 35.4.1)", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "BigRole",
        level: "object",
        privileges: makePrivs(60),
        count: 60,
      }),
    );
    const realCtx = ctxWithRealPaginate(mockHttp, 50);

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "BigRole", maxRows: 100 },
      realCtx,
    );

    const structured = result.structuredContent as {
      privileges: unknown[];
      count: number;
      nextCursor?: string;
    };
    expect(structured.privileges).toHaveLength(50);
    expect(structured.count).toBe(50);
    expect(structured.nextCursor).toBe(encodeCursor(50));
  });
});

// ════════════════════════════════════════════════════════════════════
// D. Truncation signal + %All short-circuit signal SURVIVE into the tool
//    response (the audit.ts field-dropping trap this story deliberately
//    avoids — see the module doc comment in resource.ts).
// ════════════════════════════════════════════════════════════════════

describe("iris_resource_manage listPrivileges — signal forwarding", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("rowsCapped: true from the wire survives into structuredContent (real over-limit shape, live-proven server-side)", async () => {
    // Mirrors the LIVE response captured for _SYSTEM + maxRows=5 during dev:
    // count=5, rowsCapped=true, superUserPrivilegesOmitted=10959.
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "_SYSTEM",
        level: "object",
        privileges: makePrivs(5),
        count: 5,
        rowsCapped: true,
        superUserPrivilegesOmitted: 10959,
        reason:
          "grantee holds %All super-role; privileges derived purely from %All (GRANTED_VIA=SuperUser) are omitted from enumeration - only directly-granted (non-derived) privileges are listed",
      }),
    );

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "_SYSTEM", maxRows: 5 },
      ctx,
    );

    const structured = result.structuredContent as {
      rowsCapped?: boolean;
      reason?: string;
      superUserPrivilegesOmitted?: number;
      count: number;
    };
    expect(structured.rowsCapped).toBe(true);
    expect(structured.superUserPrivilegesOmitted).toBe(10959);
    expect(structured.reason).toContain("%All");
    expect(structured.count).toBe(5);
  });

  it("the %All reason + omitted-count fields survive with NO maxRows involved (default-cap, real 8-row shape)", async () => {
    // Mirrors the LIVE default-maxRows response for _SYSTEM: count=8,
    // superUserPrivilegesOmitted=15333, NO rowsCapped (8 < the 100 default cap).
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "_SYSTEM",
        level: "object",
        privileges: makePrivs(8),
        count: 8,
        superUserPrivilegesOmitted: 15333,
        reason: "grantee holds %All super-role; ...",
      }),
    );

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "_SYSTEM" },
      ctx,
    );

    const structured = result.structuredContent as {
      rowsCapped?: boolean;
      reason?: string;
      superUserPrivilegesOmitted?: number;
      count: number;
    };
    expect(structured.superUserPrivilegesOmitted).toBe(15333);
    expect(structured.reason).toBeDefined();
    expect(structured.rowsCapped).toBeUndefined();
    expect(structured.count).toBe(8);
  });
});

// ════════════════════════════════════════════════════════════════════
// E. Cursor round-trip over the (already server-bounded) `privileges` array,
//    using the REAL paginate implementation.
// ════════════════════════════════════════════════════════════════════

describe("iris_resource_manage listPrivileges — cursor round-trip (real paginate)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;

  beforeEach(() => {
    mockHttp = createMockHttp();
  });

  it("page 1: returns the first page and a nextCursor when more rows remain", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "AppRole",
        level: "object",
        privileges: makePrivs(5),
        count: 5,
      }),
    );
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    // `maxRows` opts into pagination — page 1 is how a caller obtains the
    // first `nextCursor`. Without either parameter the response is unpaged
    // (AC 35.4.5); see the back-compat section above.
    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "AppRole", maxRows: 100 },
      ctx,
    );

    const structured = result.structuredContent as {
      privileges: Array<{ name: string }>;
      count: number;
      nextCursor?: string;
    };
    expect(structured.count).toBe(2);
    expect(structured.privileges).toHaveLength(2);
    expect(structured.privileges[0]?.name).toBe("Sample.Table0");
    expect(structured.privileges[1]?.name).toBe("Sample.Table1");
    expect(structured.nextCursor).toBe(encodeCursor(2));
  });

  it("page 2: a supplied cursor advances with no overlap and no gap", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "AppRole",
        level: "object",
        privileges: makePrivs(5),
        count: 5,
      }),
    );
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "AppRole", cursor: encodeCursor(2) },
      ctx,
    );

    const structured = result.structuredContent as {
      privileges: Array<{ name: string }>;
      count: number;
      nextCursor?: string;
    };
    expect(structured.privileges[0]?.name).toBe("Sample.Table2");
    expect(structured.privileges[1]?.name).toBe("Sample.Table3");
    expect(structured.count).toBe(2);
    expect(structured.nextCursor).toBe(encodeCursor(4));
  });

  it("terminal page: the last row is returned with NO nextCursor", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "AppRole",
        level: "object",
        privileges: makePrivs(5),
        count: 5,
      }),
    );
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "AppRole", cursor: encodeCursor(4) },
      ctx,
    );

    const structured = result.structuredContent as {
      privileges: Array<{ name: string }>;
      count: number;
      nextCursor?: string;
    };
    expect(structured.privileges).toHaveLength(1);
    expect(structured.privileges[0]?.name).toBe("Sample.Table4");
    expect(structured.count).toBe(1);
    expect(structured).not.toHaveProperty("nextCursor");
  });

  it("a non-array server `privileges` payload is handled as empty (no throw) — mirrors audit.ts's events guard", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ grantee: "AppRole", level: "object", privileges: null, count: 0 }),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "AppRole" },
      ctx,
    );

    const structured = result.structuredContent as {
      privileges: unknown[];
      count: number;
    };
    expect(structured.privileges).toEqual([]);
    expect(structured.count).toBe(0);
  });
});
