/**
 * Story 38.5 (AC-6) - governance proof for `iris_sql_query`.
 *
 * `iris_sql_query` adds ONE post-foundation governance key, `iris_sql_query` (a read, so it is enabled
 * by default and stays enabled under the `read-only` preset), absent from the frozen
 * `governance-baseline.ts`, and declares `iris_sql_execute` (a baseline write) as its parent: when an
 * operator explicitly disables `iris_sql_execute`, `iris_sql_query` seeds disabled too. This suite proves
 * it END-TO-END through the REAL `McpServerBase.handleToolCall` gate, with the real `sqlExecuteTool` and
 * `sqlQueryTool` definitions and handler spies, and through the real `iris_server_profiles` discovery tool
 * and governance resource (no mocked policy). Every `IRIS_GOVERNANCE` value uses the documented
 * `{"global":{...}}` / `{"profiles":{...}}` shape.
 *
 * Mirrors `doc-edit-governance.test.ts`. Runs in the DEFAULT vitest suite (Rule #21): no live IRIS, the
 * default profile's startup HEAD/GET are stubbed with a fetch mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GOVERNANCE_BASELINE,
  McpServerBase,
  buildDefaultEnabledWrites,
  buildMutatesLookup,
  buildParentKeys,
} from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { sqlExecuteTool, sqlQueryTool } from "../tools/sql.js";
import { tools } from "../tools/index.js";
import { toolPresets } from "../tools/presets.js";
import { prompts } from "../prompts/index.js";

// -- Harness ---------------------------------------------------------

function versionResponse(): Response {
  return new Response(
    JSON.stringify({ status: { errors: [] }, console: [], result: { version: "8.0.0" } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (server.server as any)._registeredTools[name];
  return (entry.callback ?? entry.handler ?? entry.cb)(args);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readGovernanceResource(server: any): Promise<{ policy: Record<string, boolean>; configSource: Record<string, string> }> {
  const handlers = server.server.server._requestHandlers as Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: any, extra: any) => Promise<any>
  >;
  const handler = handlers.get("resources/read");
  if (!handler) throw new Error("No resources/read handler");
  const extra = { signal: new AbortController().signal, sendNotification: async () => {}, sendRequest: async () => ({}) };
  const result = await handler({ method: "resources/read", params: { uri: "iris-governance://default" } }, extra);
  return JSON.parse(result.contents[0].text);
}

const CLEARED_ENV = [
  "IRIS_SERVER_MANAGER",
  "IRIS_SM_SERVERS",
  "IRIS_SM_SETTINGS_PATHS",
  "IRIS_SM_WORKSPACE",
  "IRIS_CREDENTIAL_HELPER",
  "IRIS_PROFILES",
  "IRIS_GOVERNANCE",
  "IRIS_GOVERNANCE_FILE",
  "IRIS_GOVERNANCE_PRESET",
  "IRIS_TOOLS_DISABLE",
  "IRIS_TOOLS_ENABLE",
  "IRIS_TOOLS_PRESET",
  "IRIS_AUDIT_LOG",
  "IRIS_AUDIT_LOG_MAX_MB",
  "IRIS_AUDIT_LOG_PARAMS",
  "IRIS_SQL_READ_ONLY",
  "IRIS_SQL_MAX_ROWS_AFFECTED",
] as const;

const QUERY_CALL = { query: "SELECT 1" };
const EXECUTE_CALL = { query: "SELECT 1" };

describe("iris_sql_query governance (Story 38.5)", () => {
  const originalFetch = globalThis.fetch;
  const savedEnv: Record<string, string | undefined> = Object.fromEntries(
    [...CLEARED_ENV, "IRIS_USERNAME", "IRIS_PASSWORD", "IRIS_HOST", "IRIS_NAMESPACE"].map((name) => [name, process.env[name]]),
  );
  let fetchMock: ReturnType<typeof vi.fn>;
  let tempDir: string | undefined;

  beforeEach(() => {
    fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());
    globalThis.fetch = fetchMock;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    for (const name of CLEARED_ENV) delete process.env[name];
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  function governanceFile(content: unknown): void {
    tempDir = mkdtempSync(join(tmpdir(), "iris-sql-query-governance-"));
    const path = join(tempDir, "governance.json");
    writeFileSync(path, JSON.stringify(content));
    process.env.IRIS_GOVERNANCE_FILE = path;
  }

  /** A server of the REAL SQL tools with handler spies, so a call that runs is observable. */
  async function start() {
    const querySpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "query ran" }],
      structuredContent: { ok: true },
    }));
    const executeSpy = vi.fn(async () => ({ content: [{ type: "text" as const, text: "execute ran" }] }));
    const spied: ToolDefinition[] = [
      { ...sqlExecuteTool, handler: executeSpy },
      { ...sqlQueryTool, handler: querySpy },
    ];
    const options: McpServerBaseOptions = { name: "@iris-mcp/dev", version: "0.0.0", tools: spied, needsCustomRest: false };
    const server = new McpServerBase(options);
    await server.start("stdio");
    return { server, querySpy, executeSpy };
  }

  const INHERITED_DENIAL: Record<string, unknown> = {
    code: "GOVERNANCE_DISABLED",
    action: "iris_sql_query",
    server: "default",
    inheritedFrom: "iris_sql_execute",
  };

  // -- Defaults ------------------------------------------------------

  describe("defaults", () => {
    it("iris_sql_query runs under an empty IRIS_GOVERNANCE, and iris_server_profiles reports it true from the default seed", async () => {
      const { server, querySpy } = await start();

      const result = await callTool(server, "iris_sql_query", QUERY_CALL);
      const discovery = await callTool(server, "iris_server_profiles", {});

      expect(result.isError).toBeFalsy();
      expect(querySpy).toHaveBeenCalledTimes(1);
      const { policy, configSource } = discovery.structuredContent.governance;
      expect(policy["iris_sql_query"]).toBe(true);
      expect(configSource["iris_sql_query"]).toBe("default");
      expect(policy["iris_sql_execute"]).toBe(true);
      expect(configSource["iris_sql_execute"]).toBe("default");
    });

    it("the key is post-foundation: absent from the frozen baseline, classified as a read, and no default-enabled write", () => {
      expect(GOVERNANCE_BASELINE.has("iris_sql_query")).toBe(false);
      expect(GOVERNANCE_BASELINE.has("iris_sql_execute")).toBe(true);
      expect(buildMutatesLookup(tools).get("iris_sql_query")).toBe("read");
      expect(sqlQueryTool.mutates).toBe("read");
      expect(sqlQueryTool.defaultEnabled).toBeUndefined();
      expect(buildDefaultEnabledWrites(tools).has("iris_sql_query")).toBe(false);
    });

    it("buildParentKeys over the real dev tools maps iris_sql_query to iris_sql_execute, next to the iris_doc_edit keys", () => {
      const parents = new Map(buildParentKeys(tools));
      expect(parents.get("iris_sql_query")).toBe("iris_sql_execute");
      expect(parents.get("iris_doc_edit:apply")).toBe("iris_doc_put");
      expect(parents.size).toBe(3);
    });

    it("iris_sql_execute declares no parent: it owns a baseline key", () => {
      expect(sqlExecuteTool.parent).toBeUndefined();
      expect(sqlQueryTool.parent).toBe("iris_sql_execute");
    });
  });

  describe("construction", () => {
    it("succeeds with the real dev tools, presets and prompts", () => {
      expect(
        () =>
          new McpServerBase({
            name: "@iris-mcp/dev",
            version: "0.0.0",
            tools,
            toolPresets,
            prompts,
            needsCustomRest: false,
          }),
      ).not.toThrow();
    });

    it("succeeds under the core and developer presets and with iris_sql_execute hidden, because the parent is a baseline key", () => {
      for (const env of [{ IRIS_TOOLS_PRESET: "core" }, { IRIS_TOOLS_PRESET: "developer" }, { IRIS_TOOLS_DISABLE: "iris_sql_execute" }]) {
        for (const name of ["IRIS_TOOLS_PRESET", "IRIS_TOOLS_DISABLE"]) delete process.env[name];
        Object.assign(process.env, env);
        expect(
          () => new McpServerBase({ name: "@iris-mcp/dev", version: "0.0.0", tools, toolPresets, needsCustomRest: false }),
          JSON.stringify(env),
        ).not.toThrow();
      }
    });
  });

  // -- The read-only preset ------------------------------------------

  describe("the read-only preset", () => {
    it("iris_sql_query runs and iris_sql_execute is denied with presetApplied", async () => {
      process.env.IRIS_GOVERNANCE_PRESET = "read-only";
      const { server, querySpy, executeSpy } = await start();

      const query = await callTool(server, "iris_sql_query", QUERY_CALL);
      const execute = await callTool(server, "iris_sql_execute", EXECUTE_CALL);

      expect(query.isError).toBeFalsy();
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(execute.isError).toBe(true);
      expect(execute.structuredContent).toEqual({
        code: "GOVERNANCE_DISABLED",
        action: "iris_sql_execute",
        server: "default",
        presetApplied: "read-only",
      });
      expect(executeSpy).not.toHaveBeenCalled();

      const discovery = await callTool(server, "iris_server_profiles", {});
      const { policy } = discovery.structuredContent.governance;
      expect(policy["iris_sql_query"]).toBe(true);
      expect(policy["iris_sql_execute"]).toBe(false);
    });
  });

  // -- Inheritance ---------------------------------------------------

  describe("an explicitly disabled iris_sql_execute", () => {
    const layers: Array<[string, () => void]> = [
      ["env global", () => (process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_sql_execute: false } }))],
      [
        "env profile",
        () => (process.env.IRIS_GOVERNANCE = JSON.stringify({ profiles: { default: { iris_sql_execute: false } } })),
      ],
      ["file global", () => governanceFile({ global: { iris_sql_execute: false } })],
      ["file profile", () => governanceFile({ profiles: { default: { iris_sql_execute: false } } })],
    ];
    for (const [layer, configure] of layers) {
      it(`${layer}: iris_sql_query is denied with inheritedFrom, the handler is not called, and the reports agree`, async () => {
        configure();
        const { server, querySpy } = await start();

        const result = await callTool(server, "iris_sql_query", QUERY_CALL);

        expect(result.isError).toBe(true);
        expect(result.structuredContent).toEqual(INHERITED_DENIAL);
        expect(result.content[0].text).toBe(
          "action 'iris_sql_query' is disabled by governance policy for server 'default' (inherited from 'iris_sql_execute')",
        );
        expect(querySpy).not.toHaveBeenCalled();

        const discovery = await callTool(server, "iris_server_profiles", {});
        const { policy, configSource } = discovery.structuredContent.governance;
        expect(policy["iris_sql_query"]).toBe(false);
        expect(configSource["iris_sql_query"]).toBe("parent");
        expect(configSource["iris_sql_execute"]).toBe(layer.startsWith("env") ? "env" : "file");

        const resource = await readGovernanceResource(server);
        expect(resource.policy["iris_sql_query"]).toBe(false);
        expect(resource.configSource["iris_sql_query"]).toBe("parent");
      });
    }

    it("is profile-scoped: another profile's iris_sql_query still runs", async () => {
      process.env.IRIS_PROFILES = JSON.stringify({ prod: { host: "prod.example.com", namespace: "PRODNS" } });
      process.env.IRIS_GOVERNANCE = JSON.stringify({ profiles: { default: { iris_sql_execute: false } } });
      const { server, querySpy } = await start();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());
      await server.getOrCreateClient("prod", false);

      const onDefault = await callTool(server, "iris_sql_query", QUERY_CALL);
      const onProd = await callTool(server, "iris_sql_query", { ...QUERY_CALL, server: "prod" });

      expect(onDefault.structuredContent).toEqual(INHERITED_DENIAL);
      expect(onProd.isError).toBeFalsy();
      expect(querySpy).toHaveBeenCalledTimes(1);

      const prodDiscovery = await callTool(server, "iris_server_profiles", { profile: "prod" });
      expect(prodDiscovery.structuredContent.governance.configSource["iris_sql_query"]).toBe("default");
    });

    it("iris_server_profiles with allProfiles reports the inherited verdict for the profile that disables the parent only", async () => {
      process.env.IRIS_PROFILES = JSON.stringify({ prod: { host: "prod.example.com", namespace: "PRODNS" } });
      process.env.IRIS_GOVERNANCE = JSON.stringify({ profiles: { default: { iris_sql_execute: false } } });
      const { server } = await start();

      const discovery = await callTool(server, "iris_server_profiles", { allProfiles: true });

      const { policies, configSources } = discovery.structuredContent.governance;
      expect(policies.default["iris_sql_query"]).toBe(false);
      expect(configSources.default["iris_sql_query"]).toBe("parent");
      expect(policies.prod["iris_sql_query"]).toBe(true);
      expect(configSources.prod["iris_sql_query"]).toBe("default");
    });

    it("also holds when iris_sql_execute is hidden by IRIS_TOOLS_DISABLE (construction succeeds, inheritance applies)", async () => {
      process.env.IRIS_TOOLS_DISABLE = "iris_sql_execute";
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_sql_execute: false } });
      const { server, querySpy } = await start();

      const result = await callTool(server, "iris_sql_query", QUERY_CALL);

      expect(result.structuredContent).toEqual(INHERITED_DENIAL);
      expect(querySpy).not.toHaveBeenCalled();
      const discovery = await callTool(server, "iris_server_profiles", {});
      expect(discovery.structuredContent.governance.policy["iris_sql_execute"]).toBeUndefined();
      expect(discovery.structuredContent.governance.configSource["iris_sql_query"]).toBe("parent");
    });

    it("with the read-only preset as well, the denial names the parent and carries no presetApplied", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_sql_execute: false } });
      process.env.IRIS_GOVERNANCE_PRESET = "read-only";
      const { server } = await start();

      const result = await callTool(server, "iris_sql_query", QUERY_CALL);

      expect(result.structuredContent).toEqual(INHERITED_DENIAL);
      expect("presetApplied" in result.structuredContent).toBe(false);
    });

    it("leaves iris_sql_execute's own denial as it was, with no inheritedFrom", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_sql_execute: false } });
      const { server, executeSpy } = await start();

      const result = await callTool(server, "iris_sql_execute", EXECUTE_CALL);

      expect(JSON.stringify(result)).toBe(
        '{"content":[{"type":"text","text":"action \'iris_sql_execute\' is disabled by governance policy for server \'default\'"}],"structuredContent":{"code":"GOVERNANCE_DISABLED","action":"iris_sql_execute","server":"default"},"isError":true}',
      );
      expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  // -- Explicit settings on the child win ----------------------------

  describe("an explicit setting on iris_sql_query wins over the inherited disable", () => {
    const layers: Array<[string, string, () => void]> = [
      [
        "env global",
        "env",
        () => (process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_sql_execute: false, iris_sql_query: true } })),
      ],
      [
        "env profile",
        "env",
        () =>
          (process.env.IRIS_GOVERNANCE = JSON.stringify({
            global: { iris_sql_execute: false },
            profiles: { default: { iris_sql_query: true } },
          })),
      ],
      [
        "file global",
        "file",
        () => {
          process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_sql_execute: false } });
          governanceFile({ global: { iris_sql_query: true } });
        },
      ],
      [
        "file profile",
        "file",
        () => {
          process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_sql_execute: false } });
          governanceFile({ profiles: { default: { iris_sql_query: true } } });
        },
      ],
    ];
    for (const [layer, source, configure] of layers) {
      it(`${layer}: iris_sql_query runs and reports ${source}`, async () => {
        configure();
        const { server, querySpy, executeSpy } = await start();

        const query = await callTool(server, "iris_sql_query", QUERY_CALL);
        const execute = await callTool(server, "iris_sql_execute", EXECUTE_CALL);

        expect(query.isError).toBeFalsy();
        expect(querySpy).toHaveBeenCalledTimes(1);
        expect(execute.isError).toBe(true);
        expect(executeSpy).not.toHaveBeenCalled();
        const discovery = await callTool(server, "iris_server_profiles", {});
        expect(discovery.structuredContent.governance.policy["iris_sql_query"]).toBe(true);
        expect(discovery.structuredContent.governance.configSource["iris_sql_query"]).toBe(source);
      });
    }

    it("an explicit false on iris_sql_query is a plain denial of that key, reported from its own layer", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_sql_query: false } });
      const { server, querySpy, executeSpy } = await start();

      const query = await callTool(server, "iris_sql_query", QUERY_CALL);
      const execute = await callTool(server, "iris_sql_execute", EXECUTE_CALL);

      expect(query.structuredContent).toEqual({ code: "GOVERNANCE_DISABLED", action: "iris_sql_query", server: "default" });
      expect(querySpy).not.toHaveBeenCalled();
      expect(execute.isError).toBeFalsy();
      expect(executeSpy).toHaveBeenCalledTimes(1);
      const discovery = await callTool(server, "iris_server_profiles", {});
      expect(discovery.structuredContent.governance.configSource["iris_sql_query"]).toBe("env");
    });
  });

  describe("only the parent's first explicit verdict counts", () => {
    it("env enables iris_sql_execute and the file disables it: iris_sql_query runs", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_sql_execute: true } });
      governanceFile({ global: { iris_sql_execute: false } });
      const { server, querySpy } = await start();

      const result = await callTool(server, "iris_sql_query", QUERY_CALL);

      expect(result.isError).toBeFalsy();
      expect(querySpy).toHaveBeenCalledTimes(1);
      const discovery = await callTool(server, "iris_server_profiles", {});
      expect(discovery.structuredContent.governance.configSource["iris_sql_query"]).toBe("default");
    });
  });

  describe("back-compat for iris_sql_execute", () => {
    it("runs under every configuration here that does not disable it, with its own defaults", async () => {
      for (const governance of [undefined, { global: { iris_sql_query: false } }, { global: { iris_sql_query: true } }]) {
        fetchMock = vi.fn();
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
        fetchMock.mockResolvedValueOnce(versionResponse());
        globalThis.fetch = fetchMock;
        if (governance === undefined) delete process.env.IRIS_GOVERNANCE;
        else process.env.IRIS_GOVERNANCE = JSON.stringify(governance);
        const { server, executeSpy } = await start();

        const result = await callTool(server, "iris_sql_execute", EXECUTE_CALL);

        expect(result.isError, JSON.stringify(governance)).toBeFalsy();
        expect(executeSpy).toHaveBeenCalledTimes(1);
        const discovery = await callTool(server, "iris_server_profiles", {});
        expect(discovery.structuredContent.governance.configSource["iris_sql_execute"]).toBe("default");
      }
    });
  });

  describe("the operator variables reach the request body through the real server (AC-2, AC-3)", () => {
    /** Starts a server of the REAL SQL tools (no handler spies) whose endpoint answers every request with a SELECT result. */
    async function startReal() {
      fetchMock.mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              status: { errors: [] },
              console: [],
              result: { outcome: "ok", statementType: 1, statementTypeName: "SELECT", content: [{ N: 1 }] },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      );
      const server = new McpServerBase({ name: "@iris-mcp/dev", version: "0.0.0", tools: [sqlExecuteTool, sqlQueryTool], needsCustomRest: false });
      await server.start("stdio");
      return server;
    }

    function sentSqlBody(): Record<string, unknown> {
      const post = fetchMock.mock.calls.find(
        ([url, init]) => String(url).endsWith("/api/executemcp/v2/dev/sql/execute") && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(post, "a POST to /dev/sql/execute").toBeDefined();
      return JSON.parse(String((post?.[1] as RequestInit).body)) as Record<string, unknown>;
    }

    it("IRIS_SQL_READ_ONLY=true and IRIS_SQL_MAX_ROWS_AFFECTED=2 decide readOnly and maxRowsAffected on the wire, whatever the caller passes", async () => {
      process.env.IRIS_SQL_READ_ONLY = "true";
      process.env.IRIS_SQL_MAX_ROWS_AFFECTED = "2";
      const server = await startReal();

      const result = await callTool(server, "iris_sql_execute", { query: "SELECT 1 AS N", readOnly: false, maxRowsAffected: 50 });

      expect(sentSqlBody()).toMatchObject({ readOnly: true, countOnly: false, maxRowsAffected: 2 });
      expect(result.structuredContent).toEqual({ columns: ["N"], rows: [[1]], rowCount: 1, readOnlyForced: true });
    });

    it("with neither variable set the same call sends the explicit defaults", async () => {
      const server = await startReal();

      await callTool(server, "iris_sql_execute", { query: "SELECT 1 AS N" });

      expect(sentSqlBody()).toMatchObject({ readOnly: false, countOnly: false, maxRowsAffected: null });
    });
  });
});
