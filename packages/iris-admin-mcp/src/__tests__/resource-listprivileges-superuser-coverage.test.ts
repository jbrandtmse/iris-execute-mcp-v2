/**
 * Story 35.4 — `iris_resource_manage:listPrivileges` bounding: QA-stage
 * COMPLEMENTARY coverage.
 *
 * This file does NOT duplicate `resource-listprivileges-bound.test.ts` (the
 * dev's suite — schema edge cases, wire forwarding, the AC 35.4.5 pin, signal
 * forwarding for the happy-path `_SYSTEM` shape, and a clean cursor
 * round-trip). It exists because two live probes run during the QA pass
 * against real HSCUSTOM (2026-08-18, `_SYSTEM`/`SYS`, localhost:52773)
 * surfaced behavior the dev's suite does not pin.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ STATUS: both findings below were CONFIRMED and FIXED during the code  │
 * │ review (same day). The tests in sections A and B now assert the       │
 * │ FIXED behavior, re-captured live after the fix — they are no longer   │
 * │ characterization pins of a defect. The original defect descriptions   │
 * │ are kept as the "before" half of each pin so a regression stays       │
 * │ recognizable.                                                         │
 * │                                                                       │
 * │ Note these mocked tests cannot themselves fail if the ObjectScript    │
 * │ guards are deleted — they prove the TOOL layer forwards the signals.  │
 * │ The server-side guards are pinned by the ObjectScript suite           │
 * │ `ExecuteMCPv2.Tests.SqlPrivilegeBoundTest`, which drives the deployed │
 * │ REST route and was mutation-verified RED on both paths (Rule #59).    │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * FINDING A (FIXED) — the class-doc comment on `SqlPrivilegeList()` (Security.cls
 * ~3095-3117) claims the fetch loop "scans the full result set ... rather
 * than stopping at maxRows, so a genuine non-derived grant that sorts after
 * the derived rows is never silently dropped." Live-reproduced: `_SYSTEM`
 * has exactly 8 real (`GRANTED_VIA=Owner Privilege`) object-level rows.
 *   - `maxRows=8` (>= the real count): count=8, superUserPrivilegesOmitted=
 *     15333 (the FULL derived-row count), no `rowsCapped`.
 *   - `maxRows=7` (< the real count): count=7, rowsCapped=true,
 *     superUserPrivilegesOmitted=10961 — NOT 15333. The scan stopped as soon
 *     as 7 real rows were materialized (the `tRowCount >= tMaxRows` Quit in
 *     the object-level loop fires on REAL rows exactly like it does on any
 *     other row — the SuperUser-Continue only exempts derived rows from
 *     *counting toward* the cap, it does not exempt the loop from stopping
 *     once the cap is reached). The 8th real row (a genuine, non-derived
 *     grant) is silently dropped — the exact failure the doc comment says
 *     cannot happen. This is reachable with any `maxRows` value below a
 *     `%All` holder's real-grant count, not a manufactured/impossible state.
 *   - FIX (code review): derived rows never consume the cap, so on the `%All`
 *     path the loop now keeps scanning past `maxRows` instead of quitting,
 *     and `superUserPrivilegesOmitted` is the exact total regardless of the
 *     cap. Re-captured live: `maxRows=7` -> count=7, rowsCapped=true,
 *     superUserPrivilegesOmitted=**15333**. The class-doc was also corrected
 *     to state the honest residual limit (real rows past `maxRows` ARE
 *     dropped, signalled by `rowsCapped`).
 *
 * FINDING B (FIXED) — the `%All` short-circuit only recognized `grantee = "%All"`
 * literally, or a USER whose direct `Roles` list contains `%All` (Rule #6
 * exact `$Piece` match). It does NOT walk indirect membership: a ROLE that
 * holds `%All` only via `GrantedRoles`, or a USER whose role holds `%All`
 * that way. Probed live (disposable `Story354ProbeRole` with
 * `grantedRoles=%All`, and `Story354ProbeUser` with `roles=Story354ProbeRole`
 * — both created via `iris_role_manage`/`iris_user_manage` and deleted
 * immediately after capture, per Rule #16):
 *   - `Story354ProbeRole` (a ROLE, %All only via GrantedRoles) as grantee:
 *     `%SQL.Manager.CatalogPriv:UserPrivs` emitted ZERO `GRANTED_VIA=
 *     SuperUser` rows for it (364 rows total across two probe calls, all
 *     `Owner Privilege`) — the underlying SQL engine does not resolve %All
 *     through a role-to-role grant for THIS grantee shape. Per Rule #54, the
 *     coverage gap for "grantee IS a role that itself holds %All" is
 *     confirmed UNREACHABLE by this probe — not tested here as a defect.
 *   - `Story354ProbeUser` (a USER whose only role is `Story354ProbeRole`,
 *     i.e. %All two levels away: user -> role -> %All) as grantee: the SAME
 *     query DID emit `GRANTED_VIA=SuperUser` rows — 999 of the first 1000
 *     fetched (`maxRows=1000`, `rowsCapped=true`), with NO `reason` and NO
 *     `superUserPrivilegesOmitted` field, proving the handler's short-circuit
 *     did NOT engage even though the underlying data has the same shape as
 *     `_SYSTEM`'s. This IS a confirmed, live-reproducible gap: any user whose
 *     privilege derives from `%All` through an indirect role chain gets the
 *     pre-Story-35.4 unbounded-enumeration shape (though still row-capped by
 *     `maxRows` generically, since that cap is grantee-shape-agnostic) rather
 *     than the collapsed, information-preserving short-circuit shape AC
 *     35.4.4 designed. Flagged for the lead/dev — QA does not fix ObjectScript.
 *   - FIX (code review, revised after the lead's policy call): the handler no
 *     longer resolves the grantee's roles AT ALL. It omits per-ROW on
 *     `GRANTED_VIA = "SuperUser"` — a value the query has already computed —
 *     so the defect is structurally impossible at any chain depth, and the
 *     `%SYS` excursion the role walk required is gone with it. Validated by
 *     an instance-wide sweep of all 46 users and roles: `SuperUser` rows are
 *     emitted if and only if the principal effectively holds `%All`, with
 *     zero counterexamples and powerful non-`%All` controls (`Admin`) at 0
 *     derived rows. Re-probed on a THREE-level chain (user -> roleB -> roleC
 *     -> %All), which emits the identical 15,333 derived rows as `_SYSTEM`:
 *     that grantee now returns count=5, superUserPrivilegesOmitted=15333,
 *     zero SuperUser rows. The role-as-grantee variant needs no special
 *     handling — it emits ZERO SuperUser rows, so nothing is omitted and the
 *     zero-omitted gate leaves its response untouched.
 *
 * Also covers boundary/degenerate inputs live-verified during the same pass
 * (malformed `target`, a nonexistent `grantee`, and cursor edge cases with
 * the REAL `ctx.paginate`), and the column-level loop's signal-forwarding
 * (rowsCapped/reason/superUserPrivilegesOmitted), which the dev's column-level
 * test exercises for wire-forwarding but not for these fields.
 *
 * Plain `*.test.ts` -> DEFAULT vitest suite (Rule #8). No live IRIS here;
 * mocked HTTP with response bodies pinned from the live captures above
 * (Rule #36 — oracle from the real system, not hand-reasoned).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IrisApiError, encodeCursor, decodeCursor } from "@iris-mcp/shared";
import type { ToolContext, PaginateResult } from "@iris-mcp/shared";
import { resourceManageTool } from "../tools/resource.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

const SQLPRIV_PATH = "/api/executemcp/v2/security/sqlprivilege";

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

/** A synthetic real (non-derived) object-level privilege row. */
function realRow(i: number): Record<string, unknown> {
  return {
    type: "STORED PROCEDURE",
    name: `Sample.Proc${i}`,
    privilege: "EXECUTE",
    grantedBy: "_SYSTEM",
    grantOption: "Yes",
    grantedVia: "Owner Privilege",
    hasColumnPriv: false,
  };
}

// ════════════════════════════════════════════════════════════════════
// A. Finding A — maxRows below the real-grant count for a %All holder:
//    the doc-comment's "scans the full result set" claim does not hold.
// ════════════════════════════════════════════════════════════════════

describe("iris_resource_manage listPrivileges — maxRows below a %All holder's real-row count", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("at the exact real-row boundary (maxRows=8, _SYSTEM has 8 real rows): full scan, no cap, superUserPrivilegesOmitted=15333", async () => {
    // Live-captured 2026-08-18: GET .../sqlprivilege?grantee=_SYSTEM&maxRows=8
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "_SYSTEM",
        level: "object",
        privileges: Array.from({ length: 8 }, (_, i) => realRow(i)),
        count: 8,
        superUserPrivilegesOmitted: 15333,
        reason:
          "grantee holds %All super-role; privileges derived purely from %All (GRANTED_VIA=SuperUser) are omitted from enumeration - only directly-granted (non-derived) privileges are listed",
      }),
    );

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "_SYSTEM", maxRows: 8 },
      ctx,
    );

    const structured = result.structuredContent as {
      count: number;
      rowsCapped?: boolean;
      superUserPrivilegesOmitted?: number;
    };
    expect(structured.count).toBe(8);
    expect(structured.rowsCapped).toBeUndefined();
    expect(structured.superUserPrivilegesOmitted).toBe(15333);
  });

  it("one below the real-row boundary (maxRows=7): the cap engages but the omitted-count stays EXACT (Finding A, fixed in code review)", async () => {
    // Re-captured live 2026-08-18 AFTER the code-review fix:
    // GET .../sqlprivilege?grantee=_SYSTEM&maxRows=7 -> count=7,
    // rowsCapped=true, superUserPrivilegesOmitted=15333.
    //
    // BEFORE the fix this same call returned superUserPrivilegesOmitted=10961
    // — a partial figure reported as though it were the total, because the
    // cap's `Quit` ended the scan and froze the counter mid-result-set. The
    // handler now keeps scanning on the %All path (derived rows never consume
    // the cap), so the count is the true total regardless of maxRows.
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "_SYSTEM",
        level: "object",
        privileges: Array.from({ length: 7 }, (_, i) => realRow(i)),
        count: 7,
        rowsCapped: true,
        superUserPrivilegesOmitted: 15333,
        reason:
          "grantee holds %All super-role; privileges derived purely from %All (GRANTED_VIA=SuperUser) are omitted from enumeration - only directly-granted (non-derived) privileges are listed",
      }),
    );

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "_SYSTEM", maxRows: 7 },
      ctx,
    );

    const structured = result.structuredContent as {
      count: number;
      rowsCapped?: boolean;
      superUserPrivilegesOmitted?: number;
    };
    expect(structured.count).toBe(7);
    expect(structured.rowsCapped).toBe(true);
    // The invariant that matters: the omitted-count does NOT vary with
    // maxRows. It is identical to the uncapped call in the test above.
    expect(structured.superUserPrivilegesOmitted).toBe(15333);
  });
});

// ════════════════════════════════════════════════════════════════════
// B. Finding B — %All held only via indirect/nested role membership is not
//    short-circuited (probed live; the underlying query DOES emit SuperUser
//    rows for this grantee shape, so this is a reachable gap, not dead code).
// ════════════════════════════════════════════════════════════════════

describe("iris_resource_manage listPrivileges — %All held via an indirect role chain", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("a user reaching %All through a nested role chain IS short-circuited — reason + omitted-count present, zero derived rows pass through (Finding B, fixed in code review)", async () => {
    // Re-captured live 2026-08-18 AFTER the code-review fix, against a
    // disposable 3-level chain (Rev354User -> Rev354RoleB -> Rev354RoleC ->
    // %All; all three deleted immediately after capture):
    // GET .../sqlprivilege?grantee=Rev354User -> count=5,
    // superUserPrivilegesOmitted=15333, reason present, and ZERO rows with
    // grantedVia="SuperUser" in `privileges`.
    //
    // BEFORE the fix the same grantee returned the full derived
    // cross-product (15,338 rows, 15,333 of them SuperUser) with NO reason
    // and NO superUserPrivilegesOmitted, because the handler decided whether
    // to omit by resolving the GRANTEE's roles and `Security.Users.Get`'s
    // `Roles` property is DIRECT-only. The handler now omits per-ROW on
    // GRANTED_VIA, which the query already computed — so there is no role
    // graph left to walk incompletely, at any chain depth.
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "Rev354User",
        level: "object",
        privileges: Array.from({ length: 5 }, (_, i) => realRow(i)),
        count: 5,
        superUserPrivilegesOmitted: 15333,
        reason:
          "grantee holds %All super-role; privileges derived purely from %All (GRANTED_VIA=SuperUser) are omitted from enumeration - only directly-granted (non-derived) privileges are listed",
      }),
    );

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "Rev354User", maxRows: 1000 },
      ctx,
    );

    const structured = result.structuredContent as {
      count: number;
      rowsCapped?: boolean;
      reason?: string;
      superUserPrivilegesOmitted?: number;
      privileges: Array<{ grantedVia: string }>;
    };
    // Indirect holders now get the SAME collapsed shape as _SYSTEM: the
    // derived cross-product is counted, not enumerated, and nothing derived
    // survives into `privileges`.
    expect(structured.reason).toContain("%All");
    expect(structured.superUserPrivilegesOmitted).toBe(15333);
    expect(structured.count).toBe(5);
    expect(
      structured.privileges.some((p) => p.grantedVia === "SuperUser"),
    ).toBe(false);
    // 5 real rows are far under the 1000 ceiling, so nothing was truncated.
    expect(structured.rowsCapped).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// C. Boundary / degenerate inputs — live-verified 2026-08-18.
// ════════════════════════════════════════════════════════════════════

describe("iris_resource_manage listPrivileges — boundary and degenerate inputs", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("a nonexistent grantee returns an empty privileges array with no error (live-verified: the handler does not pre-validate grantee existence)", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "NoSuchGranteeXYZ123",
        level: "object",
        privileges: [],
        count: 0,
      }),
    );

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "NoSuchGranteeXYZ123" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      privileges: unknown[];
      count: number;
    };
    expect(structured.privileges).toEqual([]);
    expect(structured.count).toBe(0);
  });

  it("a malformed target (no '.') surfaces the real sanitized IRIS SUBSCRIPT error via isError, not a hard crash (live-verified error text)", async () => {
    // Live-captured 2026-08-18: GET .../sqlprivilege?grantee=%25Developer&
    // target=NoDotHere -> ERROR #5001: ObjectScript error:
    // <SUBSCRIPT>SQLUserColumnPrivsExecute — the handler does not validate
    // `target`'s schema.table shape before calling UserColumnPrivs with an
    // empty table piece.
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [
          {
            error:
              "ERROR #5001: ObjectScript error: <SUBSCRIPT>SQLUserColumnPrivsExecute ",
          },
        ],
        SQLPRIV_PATH,
        "ERROR #5001: ObjectScript error: <SUBSCRIPT>SQLUserColumnPrivsExecute ",
      ),
    );

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "%Developer", target: "NoDotHere" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("listing SQL privileges");
    expect(result.content[0]?.text).toContain("SUBSCRIPT");
  });

  it("a target with multiple dots (schema.table.extra) is handled gracefully server-side — no error, just an (empty) result for the resolved schema/table (live-verified)", async () => {
    // Live-captured: target=A.B.C -> $Piece(tTarget,".",1)="A",
    // $Piece(tTarget,".",2,*)="B.C" — no crash, empty privileges.
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "%Developer",
        level: "column",
        target: "A.B.C",
        privileges: [],
        count: 0,
      }),
    );

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "%Developer", target: "A.B.C" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as { count: number };
    expect(structured.count).toBe(0);
  });

  it("a cursor pointing past the end of the (already server-bounded) privileges array yields an empty page and no nextCursor", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "AppRole",
        level: "object",
        privileges: [realRow(0), realRow(1), realRow(2)],
        count: 3,
      }),
    );
    const realCtx = ctxWithRealPaginate(mockHttp, 2);

    const result = await resourceManageTool.handler(
      {
        action: "listPrivileges",
        grantee: "AppRole",
        cursor: encodeCursor(999),
      },
      realCtx,
    );

    const structured = result.structuredContent as {
      privileges: unknown[];
      count: number;
      nextCursor?: string;
    };
    expect(structured.privileges).toEqual([]);
    expect(structured.count).toBe(0);
    expect(structured).not.toHaveProperty("nextCursor");
  });

  it("a malformed (non-base64/non-JSON) cursor is treated as offset 0 — first page, no throw", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "AppRole",
        level: "object",
        privileges: [realRow(0), realRow(1), realRow(2)],
        count: 3,
      }),
    );
    const realCtx = ctxWithRealPaginate(mockHttp, 2);

    const result = await resourceManageTool.handler(
      {
        action: "listPrivileges",
        grantee: "AppRole",
        cursor: "not-a-real-cursor!!",
      },
      realCtx,
    );

    const structured = result.structuredContent as {
      privileges: Array<{ name: string }>;
      count: number;
    };
    expect(structured.count).toBe(2);
    expect(structured.privileges[0]?.name).toBe("Sample.Proc0");
  });
});

// ════════════════════════════════════════════════════════════════════
// D. Column-level loop — the truncation/short-circuit SIGNAL fields survive,
//    not just wire-forwarding of grantee/target/level (which the dev's
//    resource-listprivileges-bound.test.ts already covers).
// ════════════════════════════════════════════════════════════════════

describe("iris_resource_manage listPrivileges — column-level loop signal forwarding", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("rowsCapped + reason + superUserPrivilegesOmitted survive for the column-level (target=schema.table) response, same as the object-level path", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "_SYSTEM",
        level: "column",
        target: "%Dictionary.ClassDefinition",
        privileges: [
          {
            column: "Name",
            privilege: "SELECT",
            grantedBy: "_SYSTEM",
            grantOption: "No",
            grantedVia: "Owner Privilege",
          },
        ],
        count: 1,
        superUserPrivilegesOmitted: 224,
        reason:
          "grantee holds %All super-role; privileges derived purely from %All (GRANTED_VIA=SuperUser) are omitted from enumeration - only directly-granted (non-derived) privileges are listed",
      }),
    );

    const result = await resourceManageTool.handler(
      {
        action: "listPrivileges",
        grantee: "_SYSTEM",
        target: "%Dictionary.ClassDefinition",
      },
      ctx,
    );

    const structured = result.structuredContent as {
      level: string;
      superUserPrivilegesOmitted?: number;
      reason?: string;
      count: number;
    };
    expect(structured.level).toBe("column");
    expect(structured.superUserPrivilegesOmitted).toBe(224);
    expect(structured.reason).toContain("%All");
    expect(structured.count).toBe(1);
  });

  it("a capped column-level response (rowsCapped: true, non-%All grantee) forwards the signal with no reason/superUserPrivilegesOmitted", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "Story354TestRole",
        level: "column",
        target: "%Dictionary.ClassDefinition",
        privileges: [
          { column: "Name", privilege: "SELECT", grantedBy: "_SYSTEM", grantOption: "No", grantedVia: "Explicit Grant" },
          { column: "Owner", privilege: "SELECT", grantedBy: "_SYSTEM", grantOption: "No", grantedVia: "Explicit Grant" },
          { column: "NameSpace", privilege: "SELECT", grantedBy: "_SYSTEM", grantOption: "No", grantedVia: "Explicit Grant" },
        ],
        count: 3,
        rowsCapped: true,
      }),
    );

    const result = await resourceManageTool.handler(
      {
        action: "listPrivileges",
        grantee: "Story354TestRole",
        target: "%Dictionary.ClassDefinition",
        maxRows: 3,
      },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      `${SQLPRIV_PATH}?grantee=Story354TestRole&target=%25Dictionary.ClassDefinition&maxRows=3`,
    );
    const structured = result.structuredContent as {
      rowsCapped?: boolean;
      reason?: string;
      superUserPrivilegesOmitted?: number;
      count: number;
    };
    expect(structured.rowsCapped).toBe(true);
    expect(structured.reason).toBeUndefined();
    expect(structured.superUserPrivilegesOmitted).toBeUndefined();
    expect(structured.count).toBe(3);
  });
});
