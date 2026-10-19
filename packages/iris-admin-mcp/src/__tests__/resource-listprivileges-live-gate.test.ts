/**
 * Story 38.0 (ledger DW-470 and DW-473, AC-9) - `iris_resource_manage` `listPrivileges` against a
 * REAL IRIS, through the real `IrisHttpClient` and the deployed `ExecuteMCPv2` REST route.
 *
 * The unit tests pin the query string the tool builds and re-pin one error against a mocked
 * `IrisApiError`. The route's `system` handling and its `target` validation live in ObjectScript, so
 * the properties the caller actually sees are proven here, end to end:
 *
 *  - `system` reaches the route as `1` or `0` (the route reads it numerically, so a boolean sent as
 *    the string "true" would silently act as 0): `system: true` lists more rows than `false`, a string
 *    "true" behaves exactly like `true`, and omitting it behaves exactly like `false`;
 *  - a malformed `target` (no dot, empty schema piece, empty table piece) comes back as the
 *    validation message and never as a raw `<SUBSCRIPT>` error, while `A.B.C` keeps its graceful
 *    empty result (captured live 2026-10-15, IRIS 2026.2, grantee `%Developer`, HSCUSTOM).
 *
 * Read-only: the tool only lists privileges; nothing is created or changed. Target:
 * `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`, defaulting to the dev
 * instance at localhost:52773 / HSCUSTOM. Skips when IRIS or the deployed route is unavailable; fails
 * instead when `IRIS_REQUIRE_LIVE` is armed (the arming convention of the other live gates).
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  IrisApiError,
  IrisHttpClient,
  buildToolContext,
  loadConfig,
  negotiateVersion,
  ping,
  type ToolContext,
} from "@iris-mcp/shared";
import { resourceManageTool } from "../tools/resource.js";

const IRIS_HOST = process.env.IRIS_HOST ?? "localhost";
const IRIS_PORT = process.env.IRIS_PORT ?? "52773";
const IRIS_USERNAME = process.env.IRIS_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_NAMESPACE ?? "HSCUSTOM";

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** A grantee whose privilege list is large enough that the system tables change the count. */
const GRANTEE = "%Developer";
const ROUTE = "/api/executemcp/v2/security/sqlprivilege";

let skipReason: string | undefined;
let ctx: ToolContext;

interface Listing {
  isError: boolean;
  text: string;
  count: number;
  level: string | undefined;
  privileges: unknown[];
}

/** Run the real tool handler and reduce its result to what these tests compare. */
async function list(args: Record<string, unknown>): Promise<Listing> {
  const parsed = resourceManageTool.inputSchema.parse({ action: "listPrivileges", grantee: GRANTEE, ...args });
  const result = await resourceManageTool.handler(parsed, ctx);
  const structured = (result.structuredContent ?? {}) as {
    count?: number;
    level?: string;
    privileges?: unknown[];
  };
  return {
    isError: result.isError === true,
    text: result.content[0]?.text ?? "",
    count: structured.count ?? 0,
    level: structured.level,
    privileges: structured.privileges ?? [],
  };
}

beforeAll(async () => {
  try {
    const config = loadConfig({
      IRIS_HOST,
      IRIS_PORT,
      IRIS_USERNAME,
      IRIS_PASSWORD,
      IRIS_NAMESPACE,
      IRIS_HTTPS: "false",
    });
    const client = new IrisHttpClient(config);
    if (!(await ping(client, 3000))) {
      skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT} (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    } else {
      const version = await negotiateVersion(client);
      ctx = buildToolContext("NS", config, client, version);
      try {
        await client.get(`${ROUTE}?grantee=${encodeURIComponent(GRANTEE)}&system=0`);
      } catch (error) {
        if (error instanceof IrisApiError && error.statusCode === 404) {
          skipReason = `The ExecuteMCPv2 REST handlers are not deployed in ${IRIS_NAMESPACE} (${ROUTE} answered 404).`;
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    skipReason = `IRIS availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so this gate may not be skipped: ${skipReason}`);
  }
}, 30000);

describe("iris_resource_manage listPrivileges against live IRIS - system (Story 38.0, DW-470, AC-9)", () => {
  it("system:true lists more rows than system:false (the route received system=1, not 0)", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const off = await list({ system: false });
    const on = await list({ system: true });

    expect(off.isError, off.text).toBe(false);
    expect(on.isError, on.text).toBe(false);
    expect(off.count).toBeGreaterThan(0);
    expect(on.count).toBeGreaterThan(off.count);
  }, 30000);

  it("the string \"true\" behaves exactly like true (it must never reach IRIS as the text \"true\", which reads as 0)", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const asBoolean = await list({ system: true });
    const asString = await list({ system: "true" });
    const off = await list({ system: false });

    expect(asString.isError, asString.text).toBe(false);
    expect(asString.count).toBe(asBoolean.count);
    expect(asString.count).toBeGreaterThan(off.count);
  }, 30000);

  it("omitting system returns exactly what system:false returns (the explicit system=0 itself is pinned by the unit query-string tests)", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const omitted = await list({});
    const off = await list({ system: false });

    expect(omitted.isError, omitted.text).toBe(false);
    expect(off.count, "the comparison is between two non-empty listings").toBeGreaterThan(0);
    expect(omitted.count).toBe(off.count);
    expect(omitted.privileges).toEqual(off.privileges);
  }, 30000);
});

describe("iris_resource_manage listPrivileges against live IRIS - target validation (Story 38.0, DW-473, AC-9)", () => {
  for (const target of ["NoDotHere", "S.", ".T", "."]) {
    it(`a malformed target ${JSON.stringify(target)} returns the validation message, not a raw <SUBSCRIPT> error`, async (testCtx) => {
      if (skipReason) return testCtx.skip();

      const result = await list({ target });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("Error listing SQL privileges");
      expect(result.text).toContain(
        `Parameter 'target' must be 'schema.table' for listPrivileges (got '${target}'). Omit target for an object-level listing.`,
      );
      expect(result.text).not.toContain("SUBSCRIPT");
    }, 30000);
  }

  it("a target with more than one dot (A.B.C) is still valid and returns the graceful empty column-level result", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await list({ target: "A.B.C" });

    expect(result.isError, result.text).toBe(false);
    expect(result.level).toBe("column");
    expect(result.count).toBe(0);
    expect(result.privileges).toEqual([]);
  }, 30000);
});
