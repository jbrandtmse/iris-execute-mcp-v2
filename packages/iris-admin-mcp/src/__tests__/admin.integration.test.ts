/**
 * Integration tests for iris-admin-mcp tools against a real IRIS instance.
 *
 * These tests exercise every administration tool end-to-end via the custom
 * ExecuteMCPv2 REST service. They run only when armed (`IRIS_REQUIRE_LIVE`
 * plus the five `IRIS_*` target variables) and IRIS is reachable, and skip
 * otherwise (see integration-setup.ts).
 *
 * Resources are created in dependency order and cleaned up in reverse
 * dependency order to avoid conflicts. All test resources use the
 * "MCPAdminTest" prefix for easy identification.
 *
 * NOTE (Story 44.5, DW-684): a create that fails FAILS its test, and a verify
 * test asserts that its create succeeded before it reads the list. An armed CI
 * suite reports a test with no failing assertion as passed, so no test here
 * tolerates a failed create or asserts only when one succeeded
 * (`pnpm check:live-guards` refuses that shape). The four creates that used to
 * fail on the CI image (database, namespace, mapping, OAuth server) had two
 * test defects as their causes: the database create needs a `directory` (the
 * namespace and the mapping need the database), and the OAuth server create
 * needs `customizationRoles`.
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  IrisHttpClient,
  negotiateVersion,
  buildToolContext,
  type ToolContext,
  type ToolResult,
  type IrisConnectionConfig,
} from "@iris-mcp/shared";
import { getIntegrationConfig } from "@iris-mcp/shared/test-helpers/integration-config";

import { databaseManageTool, databaseListTool } from "../tools/database.js";
import { namespaceManageTool, namespaceListTool } from "../tools/namespace.js";
import { mappingManageTool, mappingListTool } from "../tools/mapping.js";
import { resourceManageTool, resourceListTool } from "../tools/resource.js";
import { roleManageTool, roleListTool } from "../tools/role.js";
import {
  userManageTool,
  userGetTool,
  userRolesTool,
  userPasswordTool,
} from "../tools/user.js";
import { permissionCheckTool } from "../tools/permission.js";
import {
  webappManageTool,
  webappGetTool,
  webappListTool,
} from "../tools/webapp.js";
import { sslManageTool, sslListTool } from "../tools/ssl.js";
import { oauthManageTool, oauthListTool } from "../tools/oauth.js";

// ── Globals set by integration-setup.ts ──────────────────────────────

declare global {
  var __IRIS_AVAILABLE__: boolean;
  var __ATELIER_VERSION__: number;
  var __CUSTOM_REST_AVAILABLE__: boolean;
}

const IRIS_OK = globalThis.__IRIS_AVAILABLE__;
const REST_OK = globalThis.__CUSTOM_REST_AVAILABLE__;

// ── Test constants ────────────────────────────────────────────────────

const TEST_DB_NAME = "MCPADMINTEST-DATA";
/**
 * Story 44.7 (DW-757): `delete` keeps the database's `IRIS.DAT` and its directory on disk, so a fixed directory would make
 * the second run on one instance fail its create (#78, file already exists). Each run takes its own leaf.
 */
const TEST_DB_RUN_ID = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const TEST_NS_NAME = "MCPADMINTEST";
const TEST_RESOURCE_NAME = "MCPAdminTestResource";
const TEST_ROLE_NAME = "MCPAdminTestRole";
const TEST_USER_NAME = "MCPAdminTestUser";
const TEST_USER_PASSWORD = "MCPAdm1nT3st!Pwd";
const TEST_WEBAPP_NAME = "/mcpadmintest";
const TEST_SSL_NAME = "MCPAdminTestSSL";
const TEST_MAPPING_NAME = "MCPAdminTestGlobal";

// ── Shared state ──────────────────────────────────────────────────────

let client: IrisHttpClient;
let config: IrisConnectionConfig;
let ctx: ToolContext;
let oauthAvailable = false;

/**
 * Track what was successfully created (isError was NOT set on the response).
 * A verify test asserts its flag, so a failed create fails twice, not silently.
 */
const created = {
  database: false,
  namespace: false,
  mapping: false,
  resource: false,
  role: false,
  user: false,
  webapp: false,
  ssl: false,
  oauth: false,
};

/**
 * Track what was attempted (regardless of success) for cleanup.
 * Cleanup tries to delete anything that was attempted, even if the
 * create returned isError (it may have partially succeeded).
 */
const attempted = {
  database: false,
  namespace: false,
  mapping: false,
  resource: false,
  role: false,
  user: false,
  webapp: false,
  ssl: false,
  oauth: false,
};

// ── Setup / Teardown ─────────────────────────────────────────────────

/** Safely attempt a delete, ignoring errors. */
async function safeDelete(
  tool: { handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown> },
  args: Record<string, unknown>,
  toolCtx: ToolContext,
): Promise<void> {
  try {
    await tool.handler(args, toolCtx);
  } catch {
    // Ignore — resource may not exist
  }
}

/** The most pages {@link listAllNames} follows: a list that never ends fails the test instead of looping. */
const MAX_LIST_PAGES = 200;

/**
 * The first page's result and every row on every page of a paginated list tool. The list tools return one
 * page of 50 rows plus a `nextCursor`, and a fresh IRIS for Health holds more resources and roles than fit on one page,
 * so a row that was just created is on the first page only by chance.
 */
async function listAllRows<Row extends { name: string }>(
  tool: { handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> },
  rowsKey: "resources" | "roles" | "databases",
  toolCtx: ToolContext,
): Promise<{ first: ToolResult; rows: Row[] }> {
  const first = await tool.handler({}, toolCtx);
  const rows: Row[] = [];
  let page = first;
  for (let pages = 1; !page.isError; pages++) {
    const structured = page.structuredContent as Record<string, unknown> & { nextCursor?: string };
    rows.push(...(structured[rowsKey] as Row[]));
    if (structured.nextCursor === undefined) break;
    if (pages >= MAX_LIST_PAGES) throw new Error(`${rowsKey}: still a nextCursor after ${MAX_LIST_PAGES} pages`);
    page = await tool.handler({ cursor: structured.nextCursor }, toolCtx);
    if (page.isError) throw new Error(`${rowsKey}: page ${pages + 1} failed: ${page.content[0]?.text}`);
  }
  return { first, rows };
}

/** The first page's result and the `name` of every row on every page of a paginated list tool. */
async function listAllNames(
  tool: { handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> },
  rowsKey: "resources" | "roles",
  toolCtx: ToolContext,
): Promise<{ first: ToolResult; names: string[] }> {
  const { first, rows } = await listAllRows<{ name: string }>(tool, rowsKey, toolCtx);
  return { first, names: rows.map((row) => row.name) };
}

/**
 * The directory for the test database: a sibling of the `USER` database's directory, with that directory's separator
 * (`<parent of USER's directory>/mcpadmintestdata<run id>/`). The create action requires a `directory`, and a sibling of a
 * directory IRIS already uses is a place the instance can create on any platform. The leaf is unique per run
 * ({@link TEST_DB_RUN_ID}), because `delete` leaves the directory and its `IRIS.DAT` behind.
 */
async function testDatabaseDirectory(toolCtx: ToolContext): Promise<string> {
  const { rows } = await listAllRows<{ name: string; directory: string }>(databaseListTool, "databases", toolCtx);
  const user = rows.find((row) => row.name.toUpperCase() === "USER");
  expect(user?.directory, "database.list must list the USER database with its directory").toBeTruthy();
  const userDirectory = user?.directory ?? "";
  const separator = userDirectory.includes("\\") ? "\\" : "/";
  const trimmed = userDirectory.replace(/[\\/]+$/, "");
  const parent = trimmed.slice(0, trimmed.lastIndexOf(separator));
  return `${parent}${separator}mcpadmintestdata${TEST_DB_RUN_ID}${separator}`;
}

describe.skipIf(!IRIS_OK || !REST_OK)("iris-admin-mcp integration", () => {
  beforeAll(async () => {
    config = getIntegrationConfig();
    client = new IrisHttpClient(config);
    const version = await negotiateVersion(client);
    ctx = buildToolContext("SYS", config, client, version);

    // Probe OAuth2 availability by attempting to list OAuth configs
    try {
      const result = await oauthListTool.handler({}, ctx);
      oauthAvailable = !result.isError;
    } catch {
      oauthAvailable = false;
    }
  });

  afterAll(async () => {
    // Cleanup in reverse dependency order
    if (attempted.webapp) {
      await safeDelete(webappManageTool, { action: "delete", name: TEST_WEBAPP_NAME }, ctx);
    }
    if (attempted.ssl) {
      await safeDelete(sslManageTool, { action: "delete", name: TEST_SSL_NAME }, ctx);
    }
    if (attempted.oauth) {
      await safeDelete(oauthManageTool, { action: "delete", entity: "server", name: "MCPAdminTestOAuth" }, ctx);
    }
    if (attempted.user) {
      try {
        await userRolesTool.handler(
          { action: "remove", username: TEST_USER_NAME, role: TEST_ROLE_NAME },
          ctx,
        );
      } catch {
        // Ignore
      }
      await safeDelete(userManageTool, { action: "delete", name: TEST_USER_NAME }, ctx);
    }
    if (attempted.role) {
      await safeDelete(roleManageTool, { action: "delete", name: TEST_ROLE_NAME }, ctx);
    }
    if (attempted.resource) {
      await safeDelete(resourceManageTool, { action: "delete", name: TEST_RESOURCE_NAME }, ctx);
    }
    if (attempted.mapping) {
      await safeDelete(
        mappingManageTool,
        { action: "delete", type: "global", namespace: TEST_NS_NAME, name: TEST_MAPPING_NAME },
        ctx,
      );
    }
    if (attempted.namespace) {
      await safeDelete(namespaceManageTool, { action: "delete", name: TEST_NS_NAME }, ctx);
    }
    if (attempted.database) {
      await safeDelete(databaseManageTool, { action: "delete", name: TEST_DB_NAME }, ctx);
    }

    client.destroy();
  });

  // ── 1. Database create & verify ──────────────────────────────────

  describe("database management", () => {
    it("creates a test database", async () => {
      attempted.database = true;
      const directory = await testDatabaseDirectory(ctx);
      const result = await databaseManageTool.handler(
        { action: "create", name: TEST_DB_NAME, directory },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      created.database = true;
    });

    it("verifies database in database.list", async () => {
      expect(created.database, "the create test must have created the database").toBe(true);
      const { first: result, rows } = await listAllRows<{ name: string }>(databaseListTool, "databases", ctx);

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const found = rows.some((db) => db.name.toUpperCase() === TEST_DB_NAME.toUpperCase());
      expect(found).toBe(true);
    });
  });

  // ── 1b. Database fields that live on SYS.Database (Story 45.6, DW-765) ──
  //
  // `Config.Databases` has no Resource, ReadOnly or GlobalJournalState, so the list used to report "", false and 0 for
  // every database, create dropped them and modify failed. Self-contained: the disposable database has its own name and
  // directory, and `finally` deletes it.

  describe("database fields on SYS.Database (DW-765)", () => {
    type DatabaseRow = {
      name: string;
      resource: string;
      readOnly: boolean;
      globalJournalState: number;
    };
    const FIELDS_DB_NAME = "MCPADMINTEST-FIELDS";

    it("lists the real resource and read-only flag of the system databases", async () => {
      const { first, rows } = await listAllRows<DatabaseRow>(databaseListTool, "databases", ctx);
      expect(first.isError, first.content[0]?.text).toBeFalsy();
      const byName = (name: string) => rows.find((row) => row.name.toUpperCase() === name);
      expect(byName("USER")?.resource).toBe("%DB_USER");
      expect(byName("IRISLIB")?.resource).toBe("%DB_IRISLIB");
      expect(byName("IRISLIB")?.readOnly, "IRISLIB is mounted read-only").toBe(true);
      expect(byName("USER")?.readOnly).toBe(false);
      expect(byName("USER")?.globalJournalState, "USER journals its globals").toBeGreaterThan(0);
    });

    it("applies resource, readOnly and globalJournalState on create and on modify, read back through the list", async () => {
      const read = async (): Promise<DatabaseRow | undefined> => {
        const { rows } = await listAllRows<DatabaseRow>(databaseListTool, "databases", ctx);
        return rows.find((row) => row.name.toUpperCase() === FIELDS_DB_NAME);
      };
      const baseDirectory = await testDatabaseDirectory(ctx);
      const directory = baseDirectory.replace(/mcpadmintestdata/, "mcpadmintestfields");
      try {
        const create = await databaseManageTool.handler(
          { action: "create", name: FIELDS_DB_NAME, directory, resource: "%DB_USER", globalJournalState: 2, readOnly: true },
          ctx,
        );
        expect(create.isError, create.content[0]?.text).toBeFalsy();
        const afterCreate = await read();
        expect(afterCreate?.resource, "create applied the resource").toBe("%DB_USER");
        expect(afterCreate?.globalJournalState, "create applied the journal state").toBe(2);
        expect(afterCreate?.readOnly, "create applied readOnly").toBe(true);

        // IRIS refuses a change to a read-only database ("the volume is readonly"), so the flags change first.
        const modifyFlags = await databaseManageTool.handler(
          { action: "modify", name: FIELDS_DB_NAME, readOnly: false, globalJournalState: 3 },
          ctx,
        );
        expect(modifyFlags.isError, modifyFlags.content[0]?.text).toBeFalsy();
        const afterFlags = await read();
        expect(afterFlags?.readOnly, "modify applied readOnly").toBe(false);
        expect(afterFlags?.globalJournalState, "modify applied the journal state").toBe(3);
        expect(afterFlags?.resource, "modify of the flags left the resource alone").toBe("%DB_USER");

        const modify = await databaseManageTool.handler(
          { action: "modify", name: FIELDS_DB_NAME, resource: "%DB_IRISLIB" },
          ctx,
        );
        expect(modify.isError, modify.content[0]?.text).toBeFalsy();
        const afterModify = await read();
        expect(afterModify?.resource, "modify applied the resource").toBe("%DB_IRISLIB");
        expect(afterModify?.globalJournalState, "modify left the journal state alone").toBe(3);
        expect(afterModify?.readOnly, "modify left readOnly alone").toBe(false);
      } finally {
        await safeDelete(databaseManageTool, { action: "delete", name: FIELDS_DB_NAME }, ctx);
      }
    });
  });

  // ── 2. Namespace create & verify ─────────────────────────────────

  describe("namespace management", () => {
    it("creates a test namespace using the test database", async () => {
      attempted.namespace = true;
      const result = await namespaceManageTool.handler(
        {
          action: "create",
          name: TEST_NS_NAME,
          codeDatabase: TEST_DB_NAME,
          dataDatabase: TEST_DB_NAME,
        },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      created.namespace = true;
    });

    it("verifies namespace in namespace.list", async () => {
      expect(created.namespace, "the create test must have created the namespace").toBe(true);
      const result = await namespaceListTool.handler({}, ctx);

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const structured = result.structuredContent as {
        namespaces: Array<{ name: string }>;
        count: number;
      };
      const found = structured.namespaces.some(
        (ns) => ns.name.toUpperCase() === TEST_NS_NAME.toUpperCase(),
      );
      expect(found).toBe(true);
    });
  });

  // ── 3. Mapping create & verify ───────────────────────────────────

  describe("mapping management", () => {
    it("creates a global mapping in the test namespace", async () => {
      attempted.mapping = true;
      const result = await mappingManageTool.handler(
        {
          action: "create",
          type: "global",
          namespace: TEST_NS_NAME,
          name: TEST_MAPPING_NAME,
          database: TEST_DB_NAME,
        },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      created.mapping = true;
    });

    it("verifies mapping in mapping.list", async () => {
      expect(created.mapping, "the create test must have created the mapping").toBe(true);
      const result = await mappingListTool.handler(
        { namespace: TEST_NS_NAME, type: "global" },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const structured = result.structuredContent as {
        mappings: Array<{ name: string }>;
        count: number;
      };
      const found = structured.mappings.some(
        (m) => m.name === TEST_MAPPING_NAME,
      );
      expect(found).toBe(true);
    });
  });

  // ── 4. Resource create & verify ──────────────────────────────────

  describe("resource management", () => {
    it("creates a test resource", async () => {
      attempted.resource = true;
      const result = await resourceManageTool.handler(
        {
          action: "create",
          name: TEST_RESOURCE_NAME,
          description: "Integration test resource",
          publicPermission: "",
        },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      created.resource = true;
    });

    it("verifies resource in resource.list", async () => {
      expect(created.resource, "the create test must have created the resource").toBe(true);
      const { first: result, names } = await listAllNames(resourceListTool, "resources", ctx);

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      expect(names).toContain(TEST_RESOURCE_NAME);
    });
  });

  // ── 5. Role create & verify ──────────────────────────────────────

  describe("role management", () => {
    it("creates a test role with test resource grant", async () => {
      attempted.role = true;
      const result = await roleManageTool.handler(
        {
          action: "create",
          name: TEST_ROLE_NAME,
          description: "Integration test role",
          resources: `${TEST_RESOURCE_NAME}:RW`,
        },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      created.role = true;
    });

    it("verifies role in role.list", async () => {
      expect(created.role, "the create test must have created the role").toBe(true);
      const { first: result, names } = await listAllNames(roleListTool, "roles", ctx);

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      expect(names).toContain(TEST_ROLE_NAME);
    });
  });

  // ── 6. User create & verify ──────────────────────────────────────

  describe("user management", () => {
    it("creates a test user with test role", async () => {
      attempted.user = true;
      const result = await userManageTool.handler(
        {
          action: "create",
          name: TEST_USER_NAME,
          password: TEST_USER_PASSWORD,
          fullName: "MCP Admin Integration Test User",
          roles: TEST_ROLE_NAME,
          enabled: true,
          namespace: "USER",
        },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      created.user = true;
    });

    it("verifies user via user.get", async () => {
      expect(created.user, "the create test must have created the user").toBe(true);
      const result = await userGetTool.handler(
        { name: TEST_USER_NAME },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      // The REST response may return username in different fields depending
      // on IRIS version; check the text serialization for the user name or
      // the full name which contains "MCP Admin".
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("MCP Admin");
    });

    it("lists all users and finds test user", async () => {
      expect(created.user, "the create test must have created the user").toBe(true);
      const result = await userGetTool.handler({}, ctx);

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const text = result.content[0]?.text ?? "";
      expect(text).toContain(TEST_USER_NAME);
    });
  });

  // ── 7. User role management ──────────────────────────────────────

  describe("user role management", () => {
    it("removes a role from the test user", async () => {
      const result = await userRolesTool.handler(
        { action: "remove", username: TEST_USER_NAME, role: TEST_ROLE_NAME },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      expect(result.content[0]?.text).toBeDefined();
    });

    it("adds a role back to the test user", async () => {
      const result = await userRolesTool.handler(
        { action: "add", username: TEST_USER_NAME, role: TEST_ROLE_NAME },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      expect(result.content[0]?.text).toBeDefined();
    });

    it("verifies role assignment via user.get", async () => {
      expect(created.user, "the create test must have created the user").toBe(true);
      const result = await userGetTool.handler(
        { name: TEST_USER_NAME },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const text = result.content[0]?.text ?? "";
      expect(text).toContain(TEST_ROLE_NAME);
    });
  });

  // ── 8. Password validation ──────────────────────────────────────

  describe("password management", () => {
    it("validates a password against policy", async () => {
      const result = await userPasswordTool.handler(
        { action: "validate", password: TEST_USER_PASSWORD },
        ctx,
      );

      // Story 44.7 (DW-758): the probed reply is `{valid:true,policy:{…}}`.
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      expect(result.structuredContent, result.content[0]?.text).toMatchObject({ valid: true });
    });

    it("validates a weak password returns result", async () => {
      const result = await userPasswordTool.handler(
        { action: "validate", password: "a" },
        ctx,
      );

      // The probed reply is `{valid:false,message:"ERROR #845: …"}`: a policy
      // verdict, not a tool error.
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const verdict = result.structuredContent as { valid?: boolean; message?: string };
      expect(verdict?.valid, result.content[0]?.text).toBe(false);
      expect(verdict.message ?? "").toContain("845");
    });
  });

  // ── 9. Permission check ─────────────────────────────────────────

  describe("permission management", () => {
    it("checks permission for test user on test resource", async () => {
      const result = await permissionCheckTool.handler(
        {
          target: TEST_USER_NAME,
          resource: TEST_RESOURCE_NAME,
          permission: "RW",
        },
        ctx,
      );

      expect(created.user && created.resource, "the user and the resource creates must have succeeded").toBe(true);
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const structured = result.structuredContent as {
        granted: boolean;
        target: string;
      };
      expect(structured.target).toBe(TEST_USER_NAME);
    });

    it("checks permission for a known system user", async () => {
      const result = await permissionCheckTool.handler(
        {
          target: "_SYSTEM",
          resource: "%DB_USER",
          permission: "R",
        },
        ctx,
      );

      // Story 44.7 (DW-758): the probed reply is
      // `{granted:true,reason:"target holds %All super-role"}` (Rule #6).
      expect(result.isError, result.content[0]?.text).toBeFalsy();
      expect(result.structuredContent, result.content[0]?.text).toMatchObject({ granted: true });
    });
  });

  // ── 10. Web app create & verify ──────────────────────────────────

  describe("webapp management", () => {
    it("creates a test web application", async () => {
      attempted.webapp = true;
      const result = await webappManageTool.handler(
        {
          action: "create",
          name: TEST_WEBAPP_NAME,
          namespace: TEST_NS_NAME,
          description: "Integration test web app",
          enabled: true,
          authEnabled: 32,
        },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      created.webapp = true;
    });

    it("verifies web app via webapp.get", async () => {
      expect(created.webapp, "the create test must have created the web app").toBe(true);
      const result = await webappGetTool.handler(
        { name: TEST_WEBAPP_NAME },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      expect(result.content[0]?.text).toBeDefined();
    });

    it("verifies web app in webapp.list", async () => {
      expect(created.webapp, "the create test must have created the web app").toBe(true);
      const result = await webappListTool.handler({}, ctx);

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const structured = result.structuredContent as {
        webapps: Array<Record<string, unknown>>;
        count: number;
      };
      expect(structured.count).toBeGreaterThan(0);
      const text = result.content[0]?.text ?? "";
      expect(text).toContain(TEST_WEBAPP_NAME);
    });

    it("lists web apps filtered by namespace", async () => {
      expect(created.webapp, "the create test must have created the web app").toBe(true);
      const result = await webappListTool.handler(
        { namespace: TEST_NS_NAME },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const structured = result.structuredContent as {
        webapps: Array<Record<string, unknown>>;
        count: number;
      };
      expect(structured.count).toBeGreaterThanOrEqual(1);
      const text = result.content[0]?.text ?? "";
      expect(text).toContain(TEST_WEBAPP_NAME);
    });
  });

  // ── 11. SSL config create & verify ───────────────────────────────

  describe("ssl management", () => {
    it("creates a test SSL configuration", async () => {
      attempted.ssl = true;
      const result = await sslManageTool.handler(
        {
          action: "create",
          name: TEST_SSL_NAME,
          description: "Integration test SSL config",
          type: 0,
          enabled: true,
        },
        ctx,
      );

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      created.ssl = true;
    });

    it("verifies SSL config in ssl.list", async () => {
      expect(created.ssl, "the create test must have created the SSL configuration").toBe(true);
      const result = await sslListTool.handler({}, ctx);

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      const text = result.content[0]?.text ?? "";
      expect(text).toContain(TEST_SSL_NAME);
    });
  });

  // ── 12. OAuth2 config create & verify (conditional) ──────────────
  //
  // oauthAvailable is set by beforeAll, after the file is collected, so each
  // test reads it when it runs (testContext.skip), never through skipIf.

  describe("oauth management", () => {
    it(
      "creates a test OAuth2 server configuration",
      async (testContext) => {
        if (!oauthAvailable) testContext.skip();
        attempted.oauth = true;
        // customizationRoles is Required by OAuth2.Server.Configuration: the tool sends "" when it is omitted and IRIS refuses.
        const result = await oauthManageTool.handler(
          {
            action: "create",
            entity: "server",
            issuerURL: "https://mcpadmintest.example.com",
            name: "MCPAdminTestOAuth",
            description: "Integration test OAuth2 server",
            supportedScopes: "openid profile",
            customizationRoles: "%DB_IRISSYS,%Manager",
          },
          ctx,
        );

        expect(result.isError, result.content[0]?.text).toBeFalsy();
        created.oauth = true;
      },
    );

    it(
      "verifies OAuth2 config in oauth.list",
      async (testContext) => {
        if (!oauthAvailable) testContext.skip();
        expect(created.oauth, "the create test must have created the OAuth2 server").toBe(true);
        const result = await oauthListTool.handler({}, ctx);

        expect(result.isError, result.content[0]?.text).toBeFalsy();
        const structured = result.structuredContent as {
          servers: Array<Record<string, unknown>>;
          clients: Array<Record<string, unknown>>;
          serverCount: number;
          clientCount: number;
        };
        expect(structured.serverCount).toBeGreaterThanOrEqual(1);
        expect(result.content[0]?.text ?? "").toContain("https://mcpadmintest.example.com");
      },
    );
  });

  // ── 13. Database delete: refused while in use, then dismounted (Story 44.7, DW-757) ──
  //
  // Last, because it takes the namespace and the database away. afterAll's deletes
  // stay as the safety net for a run that failed before this point.

  describe("database delete", () => {
    it("refuses to delete a database a namespace uses, and changes nothing", async () => {
      expect(created.database && created.namespace, "the database and namespace creates must have succeeded").toBe(true);
      const refused = await databaseManageTool.handler({ action: "delete", name: TEST_DB_NAME }, ctx);

      expect(refused.isError, refused.content[0]?.text).toBe(true);
      expect(refused.content[0]?.text ?? "").toContain("in use");
      const { rows } = await listAllRows<{ name: string }>(databaseListTool, "databases", ctx);
      expect(rows.some((db) => db.name.toUpperCase() === TEST_DB_NAME.toUpperCase())).toBe(true);
    });

    it("dismounts the database it deletes", async () => {
      expect(created.database && created.namespace && created.mapping, "the creates must have succeeded").toBe(true);
      const mapping = await mappingManageTool.handler(
        { action: "delete", type: "global", namespace: TEST_NS_NAME, name: TEST_MAPPING_NAME },
        ctx,
      );
      expect(mapping.isError, mapping.content[0]?.text).toBeFalsy();
      const namespace = await namespaceManageTool.handler({ action: "delete", name: TEST_NS_NAME }, ctx);
      expect(namespace.isError, namespace.content[0]?.text).toBeFalsy();

      const result = await databaseManageTool.handler({ action: "delete", name: TEST_DB_NAME }, ctx);

      expect(result.isError, result.content[0]?.text).toBeFalsy();
      expect(result.structuredContent, result.content[0]?.text).toMatchObject({
        action: "deleted",
        name: TEST_DB_NAME,
        dismounted: true,
      });
      const { rows } = await listAllRows<{ name: string }>(databaseListTool, "databases", ctx);
      expect(rows.some((db) => db.name.toUpperCase() === TEST_DB_NAME.toUpperCase())).toBe(false);
    });
  });
});
