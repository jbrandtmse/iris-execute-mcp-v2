/**
 * Story 15.5 — `iris_resource_manage` SQL-privilege extension: COMPLEMENTARY
 * QA coverage (QA stage).
 *
 * This file deliberately does NOT duplicate the dev's suites:
 *   - `resource.test.ts` (surface: grant/revoke/listPrivileges schema/table/column
 *     POST/GET wire bodies, mutates assertion, AC 15.5.6 back-compat block), or
 *   - `resource-governance.test.ts` (real-gate through `McpServerBase.handleToolCall`:
 *     new writes denied, listPrivileges + create/delete/modify enabled, explicit flip).
 *
 * It fills the gaps those leave, through the REAL surfaces:
 *
 *  A. ENGINE back-compat (governance engine, real tool def) — the brief's
 *     "Engine back-compat" bullet. Driven through the pure engine functions
 *     (`buildMutatesLookup`/`defaultSeed`) over the ACTUAL `resourceManageTool`,
 *     cross-checked against the frozen `GOVERNANCE_BASELINE` (141 keys / hash
 *     `1e62c5ad5bf7`). Proves: the 3 new keys classify correctly and are NOT in
 *     the baseline; the 3 existing keys ARE in the baseline; the default seed
 *     yields grant/revoke=disabled, listPrivileges + create/delete/modify=enabled.
 *
 *  B. SCHEMA validation (the `name`-optional widening, AC 15.5 Task 2) — the
 *     dev's surface tests call `.handler(...)` directly, bypassing
 *     `inputSchema` entirely. These drive `inputSchema.safeParse(...)` as the MCP
 *     SDK would: grant/revoke/listPrivileges validate WITHOUT `name`; the
 *     existing create/delete/modify still validate WITH `name`; the widening did
 *     not make any previously-valid input invalid.
 *
 *  C. SURFACE gaps the dev left: listPrivileges forwards `namespace` in the GET
 *     querystring; the listPrivileges (GET) error path returns `isError`; a
 *     column-level REVOKE forwards its target; and a NEGATIVE leakage proof — a
 *     `create` call carrying stray SQL-priv fields (target/privilege/grantee/
 *     namespace) must NOT leak any of them into the `/security/resource` wire body
 *     (the release-critical AC 15.5.6 guarantee, asserted with fields actually
 *     present rather than merely absent).
 *
 * Plain `*.test.ts` → DEFAULT vitest suite (Rule #8). No live IRIS; mocked HTTP /
 * pure-engine. TypeScript-only — no `BOOTSTRAP_VERSION` impact.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import {
  IrisApiError,
  GOVERNANCE_BASELINE,
  GOVERNANCE_BASELINE_HASH,
  buildMutatesLookup,
  defaultSeed,
} from "@iris-mcp/shared";
import { resourceManageTool } from "../tools/resource.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

const SQLPRIV_PATH = "/api/executemcp/v2/security/sqlprivilege";
const RESOURCE_PATH = "/api/executemcp/v2/security/resource";

// ════════════════════════════════════════════════════════════════════
// A. Governance ENGINE back-compat over the REAL tool definition.
//    (brief: "Engine back-compat" — buildMutatesLookup / defaultSeed /
//     baseline membership / 141 keys / hash 1e62c5ad5bf7.)
// ════════════════════════════════════════════════════════════════════

describe("Story 15.5 engine back-compat — buildMutatesLookup over the real iris_resource_manage", () => {
  // Build the lookup the way a server does: from the actual tool def.
  const lookup = buildMutatesLookup([resourceManageTool]);

  it("classifies exactly the 3 NEW keys: grant=write, revoke=write, listPrivileges=read", () => {
    expect(lookup.get("iris_resource_manage:grant")).toBe("write");
    expect(lookup.get("iris_resource_manage:revoke")).toBe("write");
    expect(lookup.get("iris_resource_manage:listPrivileges")).toBe("read");
  });

  it("does NOT classify the pre-existing baseline actions (they carry no mutates)", () => {
    // create/delete/modify are grandfathered via baseline membership, not mutates.
    expect(lookup.has("iris_resource_manage:create")).toBe(false);
    expect(lookup.has("iris_resource_manage:delete")).toBe(false);
    expect(lookup.has("iris_resource_manage:modify")).toBe(false);
    // The lookup contributes ONLY the 3 new keys for this tool.
    expect(lookup.size).toBe(3);
  });
});

describe("Story 15.5 engine back-compat — frozen baseline membership (AC 15.5.6 / 15.5.9)", () => {
  it("the EXISTING create/delete/modify keys ARE in the frozen GOVERNANCE_BASELINE", () => {
    expect(GOVERNANCE_BASELINE.has("iris_resource_manage:create")).toBe(true);
    expect(GOVERNANCE_BASELINE.has("iris_resource_manage:delete")).toBe(true);
    expect(GOVERNANCE_BASELINE.has("iris_resource_manage:modify")).toBe(true);
    // The read tool is also a baseline member (untouched by 15.5).
    expect(GOVERNANCE_BASELINE.has("iris_resource_list")).toBe(true);
  });

  it("the 3 NEW SQL-privilege keys are NOT in the frozen baseline", () => {
    expect(GOVERNANCE_BASELINE.has("iris_resource_manage:grant")).toBe(false);
    expect(GOVERNANCE_BASELINE.has("iris_resource_manage:revoke")).toBe(false);
    expect(
      GOVERNANCE_BASELINE.has("iris_resource_manage:listPrivileges"),
    ).toBe(false);
  });

  it("the frozen-foundation invariants are intact: 141 keys / hash 1e62c5ad5bf7", () => {
    expect(GOVERNANCE_BASELINE.size).toBe(141);
    expect(GOVERNANCE_BASELINE_HASH).toBe("1e62c5ad5bf7");
  });
});

describe("Story 15.5 engine back-compat — defaultSeed over the real tool (AC 15.5.2)", () => {
  const lookup = buildMutatesLookup([resourceManageTool]);

  it("under the default seed (empty IRIS_GOVERNANCE): new writes DISABLED", () => {
    expect(defaultSeed("iris_resource_manage:grant", lookup)).toBe(false);
    expect(defaultSeed("iris_resource_manage:revoke", lookup)).toBe(false);
  });

  it("under the default seed: the new READ listPrivileges is ENABLED", () => {
    expect(defaultSeed("iris_resource_manage:listPrivileges", lookup)).toBe(
      true,
    );
  });

  it("under the default seed: the baseline create/delete/modify stay ENABLED (grandfathered)", () => {
    // Baseline membership wins in defaultSeed regardless of mutates classification.
    expect(defaultSeed("iris_resource_manage:create", lookup)).toBe(true);
    expect(defaultSeed("iris_resource_manage:delete", lookup)).toBe(true);
    expect(defaultSeed("iris_resource_manage:modify", lookup)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// B. SCHEMA validation — the `name`-optional widening (Task 2).
//    The dev's surface tests bypass inputSchema (they call .handler directly);
//    these drive inputSchema.safeParse the way the MCP SDK validates args.
// ════════════════════════════════════════════════════════════════════

describe("Story 15.5 schema — name-optional widening validates new actions WITHOUT name", () => {
  // The tool's inputSchema is a ZodObject; safeParse is exactly what the SDK runs.
  const schema = resourceManageTool.inputSchema;

  it("grant validates with target/privilege/grantee and NO name", () => {
    const r = schema.safeParse({
      action: "grant",
      target: "Sample.Person",
      privilege: "SELECT",
      grantee: "AppRole",
    });
    expect(r.success).toBe(true);
  });

  it("revoke validates without name", () => {
    const r = schema.safeParse({
      action: "revoke",
      target: "Sample.Person(SSN)",
      privilege: "SELECT",
      grantee: "AppRole",
    });
    expect(r.success).toBe(true);
  });

  it("listPrivileges validates with only action + grantee (no name, no target)", () => {
    const r = schema.safeParse({ action: "listPrivileges", grantee: "AppRole" });
    expect(r.success).toBe(true);
  });

  it("the existing create/delete/modify still validate WITH name (no regression)", () => {
    expect(
      schema.safeParse({ action: "create", name: "MyRes" }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ action: "delete", name: "MyRes" }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        action: "modify",
        name: "MyRes",
        description: "x",
      }).success,
    ).toBe(true);
  });

  it("an unknown action value is still rejected by the enum (widening did not open it up)", () => {
    const r = schema.safeParse({ action: "obliterate", name: "X" });
    expect(r.success).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// C. SURFACE gaps left by the dev's resource.test.ts.
// ════════════════════════════════════════════════════════════════════

describe("Story 15.5 surface gaps — listPrivileges namespace + error path, column revoke", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("listPrivileges forwards `namespace` (and grantee) in the GET querystring", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ grantee: "AppRole", privileges: [], count: 0 }),
    );

    await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "AppRole", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      `${SQLPRIV_PATH}?grantee=AppRole&namespace=HSCUSTOM`,
    );
  });

  it("listPrivileges (GET) surfaces isError + the real error text on IrisApiError", async () => {
    // The dev only exercised the grant (POST) error path; the GET branch has its
    // own try/catch that must also return a structured isError result.
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "SQLCODE -400: no such user" }],
        SQLPRIV_PATH,
        "SQLCODE -400: no such user",
      ),
    );

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "GhostRole" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("listing SQL privileges");
    expect(result.content[0]?.text).toContain("GhostRole");
    expect(result.content[0]?.text).toContain("no such user");
  });

  it("column-level REVOKE forwards the schema.table(col) target unchanged", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "revoke", level: "column", success: true }),
    );

    await resourceManageTool.handler(
      {
        action: "revoke",
        target: "Sample.Person(Name,SSN)",
        privilege: "SELECT",
        grantee: "AppUser",
        namespace: "USER",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(SQLPRIV_PATH, {
      action: "revoke",
      target: "Sample.Person(Name,SSN)",
      privilege: "SELECT",
      grantee: "AppUser",
      namespace: "USER",
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// C (cont). NEGATIVE leakage proof — AC 15.5.6, release-critical.
//   A create call that ALSO carries stray SQL-priv fields must route to
//   /security/resource and leak NONE of target/privilege/grantee/namespace.
//   (The dev's back-compat test passes minimal args; this passes the leak-prone
//   fields and asserts they are dropped — a test that FAILS if a future change
//   forwards them into the resource body.)
// ════════════════════════════════════════════════════════════════════

describe("Story 15.5 AC 15.5.6 — SQL-priv fields never leak into a create/modify/delete wire body", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("create + stray target/privilege/grantee/namespace → /security/resource body is EXACTLY {action,name}", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "LeakProof" }),
    );

    await resourceManageTool.handler(
      {
        action: "create",
        name: "LeakProof",
        // Stray SQL-privilege fields that MUST be ignored by the resource branch.
        target: "Sample.Person",
        privilege: "SELECT",
        grantee: "AppRole",
        namespace: "HSCUSTOM",
      },
      ctx,
    );

    // Routes to the resource endpoint (never the sqlprivilege endpoint)…
    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    const [calledPath, calledBody] = mockHttp.post.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledPath).toBe(RESOURCE_PATH);

    // …and the body is byte-for-byte the pre-15.5 shape — none of the SQL-priv
    // keys leaked in. Exact-equality (not objectContaining) is the load-bearing
    // assertion: it FAILS if any of target/privilege/grantee/namespace appears.
    expect(calledBody).toEqual({ action: "create", name: "LeakProof" });
    expect(calledBody).not.toHaveProperty("target");
    expect(calledBody).not.toHaveProperty("privilege");
    expect(calledBody).not.toHaveProperty("grantee");
    expect(calledBody).not.toHaveProperty("namespace");
  });

  it("modify with description + stray privilege → resource body carries description but NOT privilege", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "modified", name: "LeakProof" }),
    );

    await resourceManageTool.handler(
      {
        action: "modify",
        name: "LeakProof",
        description: "updated",
        privilege: "DELETE",
        grantee: "AppRole",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(RESOURCE_PATH, {
      action: "modify",
      name: "LeakProof",
      description: "updated",
    });
    const [, body] = mockHttp.post.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(body).not.toHaveProperty("privilege");
    expect(body).not.toHaveProperty("grantee");
  });
});
