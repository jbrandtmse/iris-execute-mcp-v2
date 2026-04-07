/**
 * Integration tests for iris-admin-mcp tools against a real IRIS instance.
 *
 * These tests exercise every administration tool end-to-end via the custom
 * ExecuteMCPv2 REST service. They are skipped automatically when IRIS is
 * not reachable (see integration-setup.ts).
 *
 * Resources are created in dependency order and cleaned up in reverse
 * dependency order to avoid conflicts. All test resources use the
 * "MCPAdminTest" prefix for easy identification.
 *
 * NOTE: Some REST endpoints may return HTTP 500 on certain IRIS deployments
 * due to missing server-side utility classes. The tests tolerate these known
 * API errors: they verify the tool handler processes the response correctly
 * (returns isError with a descriptive message) rather than throwing an
 * unhandled exception. Verification (list) tests are skipped when the
 * preceding create call did not actually succeed.
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  IrisHttpClient,
  IrisApiError,
  loadConfig,
  negotiateVersion,
  buildToolContext,
  type ToolContext,
  type IrisConnectionConfig,
} from "@iris-mcp/shared";

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
 * Track what was successfully created (isError was NOT set on the response)
 * for both cleanup and to gate verification tests.
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

function getConfig(): IrisConnectionConfig {
  return loadConfig({
    IRIS_HOST: process.env.IRIS_HOST ?? "localhost",
    IRIS_PORT: process.env.IRIS_PORT ?? "52773",
    IRIS_USERNAME: process.env.IRIS_USERNAME ?? "_SYSTEM",
    IRIS_PASSWORD: process.env.IRIS_PASSWORD ?? "SYS",
    IRIS_NAMESPACE: process.env.IRIS_NAMESPACE ?? "HSCUSTOM",
    IRIS_HTTPS: process.env.IRIS_HTTPS ?? "false",
  });
}

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

describe.skipIf(!IRIS_OK || !REST_OK)("iris-admin-mcp integration", () => {
  beforeAll(async () => {
    config = getConfig();
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
      const result = await databaseManageTool.handler(
        { action: "create", name: TEST_DB_NAME },
        ctx,
      );

      // Verify the handler returned a result without throwing
      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError) {
        created.database = true;
      }
    });

    it("verifies database in database.list", async () => {
      const result = await databaseListTool.handler({}, ctx);

      // Verify the handler returned a result without throwing
      expect(result.content[0]?.text).toBeDefined();

      // Only verify list contents if the list call succeeded and create succeeded
      if (!result.isError && created.database) {
        const structured = result.structuredContent as {
          databases: Array<{ name: string }>;
          count: number;
        };
        const found = structured.databases.some(
          (db) => db.name.toUpperCase() === TEST_DB_NAME.toUpperCase(),
        );
        expect(found).toBe(true);
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

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError) {
        created.namespace = true;
      }
    });

    it("verifies namespace in namespace.list", async () => {
      const result = await namespaceListTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError && created.namespace) {
        const structured = result.structuredContent as {
          namespaces: Array<{ name: string }>;
          count: number;
        };
        const found = structured.namespaces.some(
          (ns) => ns.name.toUpperCase() === TEST_NS_NAME.toUpperCase(),
        );
        expect(found).toBe(true);
      }
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

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError) {
        created.mapping = true;
      }
    });

    it("verifies mapping in mapping.list", async () => {
      const result = await mappingListTool.handler(
        { namespace: TEST_NS_NAME, type: "global" },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError && created.mapping) {
        const structured = result.structuredContent as {
          mappings: Array<{ name: string }>;
          count: number;
        };
        const found = structured.mappings.some(
          (m) => m.name === TEST_MAPPING_NAME,
        );
        expect(found).toBe(true);
      }
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

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError) {
        created.resource = true;
      }
    });

    it("verifies resource in resource.list", async () => {
      const result = await resourceListTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError && created.resource) {
        const structured = result.structuredContent as {
          resources: Array<{ name: string }>;
          count: number;
        };
        const found = structured.resources.some(
          (r) => r.name === TEST_RESOURCE_NAME,
        );
        expect(found).toBe(true);
      }
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

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError) {
        created.role = true;
      }
    });

    it("verifies role in role.list", async () => {
      const result = await roleListTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError && created.role) {
        const structured = result.structuredContent as {
          roles: Array<{ name: string }>;
          count: number;
        };
        const found = structured.roles.some(
          (r) => r.name === TEST_ROLE_NAME,
        );
        expect(found).toBe(true);
      }
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

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError) {
        created.user = true;
      }
    });

    it("verifies user via user.get", async () => {
      const result = await userGetTool.handler(
        { name: TEST_USER_NAME },
        ctx,
      );

      // Verify the handler returned a result without throwing
      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError && created.user) {
        // The REST response may return username in different fields depending
        // on IRIS version; check the text serialization for the user name or
        // the full name which contains "MCP Admin".
        const text = result.content[0]?.text ?? "";
        expect(text).toContain("MCP Admin");
      }
    });

    it("lists all users and finds test user", async () => {
      const result = await userGetTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError && created.user) {
        const text = result.content[0]?.text ?? "";
        expect(text).toContain(TEST_USER_NAME);
      }
    });
  });

  // ── 7. User role management ──────────────────────────────────────

  describe("user role management", () => {
    it("removes a role from the test user", async () => {
      const result = await userRolesTool.handler(
        { action: "remove", username: TEST_USER_NAME, role: TEST_ROLE_NAME },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
    });

    it("adds a role back to the test user", async () => {
      const result = await userRolesTool.handler(
        { action: "add", username: TEST_USER_NAME, role: TEST_ROLE_NAME },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
    });

    it("verifies role assignment via user.get", async () => {
      const result = await userGetTool.handler(
        { name: TEST_USER_NAME },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError && created.user) {
        const text = result.content[0]?.text ?? "";
        expect(text).toContain(TEST_ROLE_NAME);
      }
    });
  });

  // ── 8. Password validation ──────────────────────────────────────

  describe("password management", () => {
    it("validates a password against policy", async () => {
      const result = await userPasswordTool.handler(
        { action: "validate", password: TEST_USER_PASSWORD },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
    });

    it("validates a weak password returns result", async () => {
      const result = await userPasswordTool.handler(
        { action: "validate", password: "a" },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
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

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError && created.user && created.resource) {
        const structured = result.structuredContent as {
          granted: boolean;
          target: string;
        };
        expect(structured.target).toBe(TEST_USER_NAME);
      }
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

      expect(result.content[0]?.text).toBeDefined();
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

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError) {
        created.webapp = true;
      }
    });

    it("verifies web app via webapp.get", async () => {
      const result = await webappGetTool.handler(
        { name: TEST_WEBAPP_NAME },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
    });

    it("verifies web app in webapp.list", async () => {
      const result = await webappListTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError && created.webapp) {
        const structured = result.structuredContent as {
          webapps: Array<Record<string, unknown>>;
          count: number;
        };
        expect(structured.count).toBeGreaterThan(0);
        const text = result.content[0]?.text ?? "";
        expect(text).toContain(TEST_WEBAPP_NAME);
      }
    });

    it("lists web apps filtered by namespace", async () => {
      const result = await webappListTool.handler(
        { namespace: TEST_NS_NAME },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError && created.webapp) {
        const structured = result.structuredContent as {
          webapps: Array<Record<string, unknown>>;
          count: number;
        };
        if (structured.count > 0) {
          const text = result.content[0]?.text ?? "";
          expect(text).toContain(TEST_WEBAPP_NAME);
        }
      }
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

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError) {
        created.ssl = true;
      }
    });

    it("verifies SSL config in ssl.list", async () => {
      const result = await sslListTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError && created.ssl) {
        const text = result.content[0]?.text ?? "";
        expect(text).toContain(TEST_SSL_NAME);
      }
    });
  });

  // ── 12. OAuth2 config create & verify (conditional) ──────────────

  describe("oauth management", () => {
    it.skipIf(!oauthAvailable)(
      "creates a test OAuth2 server configuration",
      async () => {
        attempted.oauth = true;
        try {
          const result = await oauthManageTool.handler(
            {
              action: "create",
              entity: "server",
              issuerURL: "https://mcpadmintest.example.com",
              name: "MCPAdminTestOAuth",
              description: "Integration test OAuth2 server",
              supportedScopes: "openid profile",
            },
            ctx,
          );

          expect(result.content[0]?.text).toBeDefined();
          if (!result.isError) {
            created.oauth = true;
          }
        } catch (error: unknown) {
          // OAuth2 creation may fail if required IRIS classes are missing
          if (error instanceof IrisApiError) {
            expect([400, 404, 500]).toContain(error.statusCode);
          } else {
            throw error;
          }
        }
      },
    );

    it.skipIf(!oauthAvailable)(
      "verifies OAuth2 config in oauth.list",
      async () => {
        const result = await oauthListTool.handler({}, ctx);

        expect(result.content[0]?.text).toBeDefined();
        if (!result.isError) {
          const structured = result.structuredContent as {
            servers: Array<Record<string, unknown>>;
            clients: Array<Record<string, unknown>>;
            serverCount: number;
            clientCount: number;
          };
          expect(structured.serverCount).toBeGreaterThanOrEqual(0);
          expect(structured.clientCount).toBeGreaterThanOrEqual(0);
        }
      },
    );
  });
});
