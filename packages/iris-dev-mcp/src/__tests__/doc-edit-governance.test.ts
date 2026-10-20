/**
 * Story 38.4 (AC-6) - governance proof for `iris_doc_edit`.
 *
 * `iris_doc_edit` adds TWO post-foundation governance keys to the iris-dev-mcp server,
 * `iris_doc_edit:apply` (a write that ships enabled) and `iris_doc_edit:regenerateStorage` (a
 * default-disabled write), both absent from the frozen `governance-baseline.ts`, and declares
 * `iris_doc_put` as its parent: when an operator explicitly disables `iris_doc_put`, both keys seed
 * disabled. This suite proves it END-TO-END through the REAL `McpServerBase.handleToolCall` gate, with
 * the real `docPutTool` and `docEditTool` definitions and handler spies, and through the real
 * `iris_server_profiles` discovery tool and governance resource (no mocked policy).
 *
 * Mirrors `test-status-governance.test.ts`. Runs in the DEFAULT vitest suite (Rule #21): no live IRIS,
 * the default profile's startup HEAD/GET are stubbed with a fetch mock.
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
import { docEditTool } from "../tools/doc-edit.js";
import { docPutTool } from "../tools/doc.js";
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
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
    mcpReq: { requestState: () => undefined },
  };
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
] as const;

/** A valid call of `iris_doc_edit` with the given action. */
function editCall(action: "apply" | "regenerateStorage"): Record<string, unknown> {
  return {
    action,
    name: "Test.Edit.cls",
    edits: [{ op: "delete", startLine: 1, endLine: 1, expected: "Class Test.Edit {" }],
  };
}

const PUT_CALL = { name: "Test.Edit.cls", content: "Class Test.Edit {}" };

describe("iris_doc_edit governance (Story 38.4)", () => {
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
    tempDir = mkdtempSync(join(tmpdir(), "iris-doc-edit-governance-"));
    const path = join(tempDir, "governance.json");
    writeFileSync(path, JSON.stringify(content));
    process.env.IRIS_GOVERNANCE_FILE = path;
  }

  /** A server of the REAL doc tools with handler spies, so a call that runs is observable. */
  async function start() {
    const editSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "edit ran" }],
      structuredContent: { ok: true },
    }));
    const putSpy = vi.fn(async () => ({ content: [{ type: "text" as const, text: "put ran" }] }));
    const spied: ToolDefinition[] = [
      { ...docPutTool, handler: putSpy },
      { ...docEditTool, handler: editSpy },
    ];
    const options: McpServerBaseOptions = { name: "@iris-mcp/dev", version: "0.0.0", tools: spied, needsCustomRest: false };
    const server = new McpServerBase(options);
    await server.start("stdio");
    return { server, editSpy, putSpy };
  }

  const INHERITED_DENIAL = (key: string): Record<string, unknown> => ({
    code: "GOVERNANCE_DISABLED",
    action: key,
    server: "default",
    inheritedFrom: "iris_doc_put",
  });

  // -- Defaults ------------------------------------------------------

  describe("defaults", () => {
    it("apply runs under an empty IRIS_GOVERNANCE (a write that ships enabled)", async () => {
      const { server, editSpy } = await start();

      const result = await callTool(server, "iris_doc_edit", editCall("apply"));

      expect(result.isError).toBeFalsy();
      expect(editSpy).toHaveBeenCalledTimes(1);
    });

    it("regenerateStorage is denied by default with the plain denial: no presetApplied, no inheritedFrom", async () => {
      const { server, editSpy } = await start();
      const callsAfterStart = fetchMock.mock.calls.length;

      const result = await callTool(server, "iris_doc_edit", editCall("regenerateStorage"));

      expect(JSON.stringify(result)).toBe(
        '{"content":[{"type":"text","text":"action \'iris_doc_edit:regenerateStorage\' is disabled by governance policy for server \'default\'"}],"structuredContent":{"code":"GOVERNANCE_DISABLED","action":"iris_doc_edit:regenerateStorage","server":"default"},"isError":true}',
      );
      expect(editSpy).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.length).toBe(callsAfterStart);
    });

    it("iris_server_profiles reports both keys from the default seed", async () => {
      const { server } = await start();

      const discovery = await callTool(server, "iris_server_profiles", {});

      const { policy, configSource } = discovery.structuredContent.governance;
      expect(policy["iris_doc_edit:apply"]).toBe(true);
      expect(policy["iris_doc_edit:regenerateStorage"]).toBe(false);
      expect(configSource["iris_doc_edit:apply"]).toBe("default");
      expect(configSource["iris_doc_edit:regenerateStorage"]).toBe("default");
      expect(policy["iris_doc_put"]).toBe(true);
      expect(configSource["iris_doc_put"]).toBe("default");
    });

    it("the two keys are post-foundation: absent from the frozen baseline, and classified as writes", () => {
      expect(GOVERNANCE_BASELINE.has("iris_doc_edit:apply")).toBe(false);
      expect(GOVERNANCE_BASELINE.has("iris_doc_edit:regenerateStorage")).toBe(false);
      expect(GOVERNANCE_BASELINE.has("iris_doc_edit")).toBe(false);
      expect(GOVERNANCE_BASELINE.has("iris_doc_put")).toBe(true);
      const mutates = buildMutatesLookup(tools);
      expect(mutates.get("iris_doc_edit:apply")).toBe("write");
      expect(mutates.get("iris_doc_edit:regenerateStorage")).toBe("write");
    });

    it("buildDefaultEnabledWrites over the real dev tools holds apply and not regenerateStorage", () => {
      const enabled = buildDefaultEnabledWrites(tools);
      expect(enabled.has("iris_doc_edit:apply")).toBe(true);
      expect(enabled.has("iris_doc_edit:regenerateStorage")).toBe(false);
    });

    it("buildParentKeys over the real dev tools maps both iris_doc_edit keys to iris_doc_put, iris_sql_query to iris_sql_execute (Story 38.5), and nothing else", () => {
      expect([...buildParentKeys(tools)]).toEqual([
        ["iris_doc_edit:apply", "iris_doc_put"],
        ["iris_doc_edit:regenerateStorage", "iris_doc_put"],
        ["iris_sql_query", "iris_sql_execute"],
      ]);
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

    it("succeeds under the core and developer presets and with iris_doc_put hidden, because the parent is a baseline key", () => {
      for (const env of [{ IRIS_TOOLS_PRESET: "core" }, { IRIS_TOOLS_PRESET: "developer" }, { IRIS_TOOLS_DISABLE: "iris_doc_put" }]) {
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
    it("denies apply with presetApplied and no inheritedFrom", async () => {
      process.env.IRIS_GOVERNANCE_PRESET = "read-only";
      const { server, editSpy } = await start();

      const result = await callTool(server, "iris_doc_edit", editCall("apply"));

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        code: "GOVERNANCE_DISABLED",
        action: "iris_doc_edit:apply",
        server: "default",
        presetApplied: "read-only",
      });
      expect(editSpy).not.toHaveBeenCalled();
    });
  });

  // -- Inheritance ---------------------------------------------------

  describe("an explicitly disabled iris_doc_put", () => {
    const layers: Array<[string, () => void]> = [
      ["env global", () => (process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } }))],
      [
        "env profile",
        () => (process.env.IRIS_GOVERNANCE = JSON.stringify({ profiles: { default: { iris_doc_put: false } } })),
      ],
      ["file global", () => governanceFile({ global: { iris_doc_put: false } })],
      ["file profile", () => governanceFile({ profiles: { default: { iris_doc_put: false } } })],
    ];
    for (const [layer, configure] of layers) {
      it(`${layer}: both keys are denied with inheritedFrom, the handler is not called, and the reports agree`, async () => {
        configure();
        const { server, editSpy } = await start();

        for (const action of ["apply", "regenerateStorage"] as const) {
          const result = await callTool(server, "iris_doc_edit", editCall(action));
          expect(result.isError, action).toBe(true);
          expect(result.structuredContent, action).toEqual(INHERITED_DENIAL(`iris_doc_edit:${action}`));
          expect(result.content[0].text, action).toBe(
            `action 'iris_doc_edit:${action}' is disabled by governance policy for server 'default' (inherited from 'iris_doc_put')`,
          );
        }
        expect(editSpy).not.toHaveBeenCalled();

        const discovery = await callTool(server, "iris_server_profiles", {});
        const { policy, configSource } = discovery.structuredContent.governance;
        for (const action of ["apply", "regenerateStorage"]) {
          expect(policy[`iris_doc_edit:${action}`], action).toBe(false);
          expect(configSource[`iris_doc_edit:${action}`], action).toBe("parent");
        }
        expect(configSource["iris_doc_put"]).toBe(layer.startsWith("env") ? "env" : "file");

        const resource = await readGovernanceResource(server);
        expect(resource.policy["iris_doc_edit:apply"]).toBe(false);
        expect(resource.configSource["iris_doc_edit:apply"]).toBe("parent");
        expect(resource.configSource["iris_doc_edit:regenerateStorage"]).toBe("parent");
      });
    }

    it("is profile-scoped: another profile's apply still runs", async () => {
      process.env.IRIS_PROFILES = JSON.stringify({ prod: { host: "prod.example.com", namespace: "PRODNS" } });
      process.env.IRIS_GOVERNANCE = JSON.stringify({ profiles: { default: { iris_doc_put: false } } });
      const { server, editSpy } = await start();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());
      await server.getOrCreateClient("prod", false);

      const onDefault = await callTool(server, "iris_doc_edit", editCall("apply"));
      const onProd = await callTool(server, "iris_doc_edit", { ...editCall("apply"), server: "prod" });

      expect(onDefault.structuredContent).toEqual(INHERITED_DENIAL("iris_doc_edit:apply"));
      expect(onProd.isError).toBeFalsy();
      expect(editSpy).toHaveBeenCalledTimes(1);

      const prodDiscovery = await callTool(server, "iris_server_profiles", { profile: "prod" });
      expect(prodDiscovery.structuredContent.governance.configSource["iris_doc_edit:apply"]).toBe("default");
    });

    it("iris_server_profiles with allProfiles reports the inherited verdict for the profile that disables the parent only", async () => {
      process.env.IRIS_PROFILES = JSON.stringify({ prod: { host: "prod.example.com", namespace: "PRODNS" } });
      process.env.IRIS_GOVERNANCE = JSON.stringify({ profiles: { default: { iris_doc_put: false } } });
      const { server } = await start();

      const discovery = await callTool(server, "iris_server_profiles", { allProfiles: true });

      const { policies, configSources } = discovery.structuredContent.governance;
      for (const action of ["apply", "regenerateStorage"]) {
        expect(policies.default[`iris_doc_edit:${action}`], action).toBe(false);
        expect(configSources.default[`iris_doc_edit:${action}`], action).toBe("parent");
      }
      expect(policies.prod["iris_doc_edit:apply"]).toBe(true);
      expect(configSources.prod["iris_doc_edit:apply"]).toBe("default");
    });

    it("also holds when iris_doc_put is hidden by IRIS_TOOLS_DISABLE (construction succeeds, inheritance applies)", async () => {
      process.env.IRIS_TOOLS_DISABLE = "iris_doc_put";
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } });
      const { server, editSpy } = await start();

      const result = await callTool(server, "iris_doc_edit", editCall("apply"));

      expect(result.structuredContent).toEqual(INHERITED_DENIAL("iris_doc_edit:apply"));
      expect(editSpy).not.toHaveBeenCalled();
      // The hidden tool's key is absent from the report, and the child's inherited verdict is not.
      const discovery = await callTool(server, "iris_server_profiles", {});
      expect(discovery.structuredContent.governance.policy["iris_doc_put"]).toBeUndefined();
      expect(discovery.structuredContent.governance.configSource["iris_doc_edit:apply"]).toBe("parent");
    });

    it("with the read-only preset as well, the denial names the parent and carries no presetApplied", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } });
      process.env.IRIS_GOVERNANCE_PRESET = "read-only";
      const { server } = await start();

      const result = await callTool(server, "iris_doc_edit", editCall("apply"));

      expect(result.structuredContent).toEqual(INHERITED_DENIAL("iris_doc_edit:apply"));
      expect("presetApplied" in result.structuredContent).toBe(false);
    });

    it("leaves iris_doc_put's own denial as it was, with no inheritedFrom", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } });
      const { server, putSpy } = await start();

      const result = await callTool(server, "iris_doc_put", PUT_CALL);

      expect(JSON.stringify(result)).toBe(
        '{"content":[{"type":"text","text":"action \'iris_doc_put\' is disabled by governance policy for server \'default\'"}],"structuredContent":{"code":"GOVERNANCE_DISABLED","action":"iris_doc_put","server":"default"},"isError":true}',
      );
      expect(putSpy).not.toHaveBeenCalled();
    });
  });

  // -- Explicit settings on the child win ----------------------------

  describe("an explicit setting on iris_doc_edit:apply wins over the inherited disable", () => {
    const layers: Array<[string, string, () => void]> = [
      [
        "env global",
        "env",
        () => (process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false, "iris_doc_edit:apply": true } })),
      ],
      [
        "env profile",
        "env",
        () =>
          (process.env.IRIS_GOVERNANCE = JSON.stringify({
            global: { iris_doc_put: false },
            profiles: { default: { "iris_doc_edit:apply": true } },
          })),
      ],
      [
        "file global",
        "file",
        () => {
          process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } });
          governanceFile({ global: { "iris_doc_edit:apply": true } });
        },
      ],
      [
        "file profile",
        "file",
        () => {
          process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false } });
          governanceFile({ profiles: { default: { "iris_doc_edit:apply": true } } });
        },
      ],
    ];
    for (const [layer, source, configure] of layers) {
      it(`${layer}: apply runs and reports ${source}; regenerateStorage still inherits`, async () => {
        configure();
        const { server, editSpy } = await start();

        const applied = await callTool(server, "iris_doc_edit", editCall("apply"));
        const regenerate = await callTool(server, "iris_doc_edit", editCall("regenerateStorage"));

        expect(applied.isError).toBeFalsy();
        expect(editSpy).toHaveBeenCalledTimes(1);
        expect(regenerate.structuredContent).toEqual(INHERITED_DENIAL("iris_doc_edit:regenerateStorage"));

        const discovery = await callTool(server, "iris_server_profiles", {});
        expect(discovery.structuredContent.governance.policy["iris_doc_edit:apply"]).toBe(true);
        expect(discovery.structuredContent.governance.configSource["iris_doc_edit:apply"]).toBe(source);
      });
    }

    it("an explicit false on apply is a plain denial of that key, reported from its own layer", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { "iris_doc_edit:apply": false } });
      const { server, editSpy } = await start();

      const result = await callTool(server, "iris_doc_edit", editCall("apply"));

      expect(result.structuredContent).toEqual({ code: "GOVERNANCE_DISABLED", action: "iris_doc_edit:apply", server: "default" });
      expect(editSpy).not.toHaveBeenCalled();
      const discovery = await callTool(server, "iris_server_profiles", {});
      expect(discovery.structuredContent.governance.configSource["iris_doc_edit:apply"]).toBe("env");
    });

    it("an explicit false on apply while iris_doc_put is also disabled is the key's own denial, with no inheritedFrom", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: false, "iris_doc_edit:apply": false } });
      const { server, editSpy } = await start();

      const applied = await callTool(server, "iris_doc_edit", editCall("apply"));
      const regenerate = await callTool(server, "iris_doc_edit", editCall("regenerateStorage"));

      expect(applied.structuredContent).toEqual({ code: "GOVERNANCE_DISABLED", action: "iris_doc_edit:apply", server: "default" });
      expect(applied.content[0].text).toBe("action 'iris_doc_edit:apply' is disabled by governance policy for server 'default'");
      // regenerateStorage has no setting of its own, so it still inherits.
      expect(regenerate.structuredContent).toEqual(INHERITED_DENIAL("iris_doc_edit:regenerateStorage"));
      expect(editSpy).not.toHaveBeenCalled();
      const discovery = await callTool(server, "iris_server_profiles", {});
      expect(discovery.structuredContent.governance.configSource["iris_doc_edit:apply"]).toBe("env");
      expect(discovery.structuredContent.governance.configSource["iris_doc_edit:regenerateStorage"]).toBe("parent");
    });
  });

  describe("only the parent's first explicit verdict counts", () => {
    it("env enables iris_doc_put and the file disables it: apply runs", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_put: true } });
      governanceFile({ global: { iris_doc_put: false } });
      const { server, editSpy } = await start();

      const result = await callTool(server, "iris_doc_edit", editCall("apply"));

      expect(result.isError).toBeFalsy();
      expect(editSpy).toHaveBeenCalledTimes(1);
      const discovery = await callTool(server, "iris_server_profiles", {});
      expect(discovery.structuredContent.governance.configSource["iris_doc_edit:apply"]).toBe("default");
    });
  });

  describe("regenerateStorage enabled explicitly", () => {
    it("runs the regenerateStorage handler, and leaves apply as it was", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { "iris_doc_edit:regenerateStorage": true } });
      const { server, editSpy } = await start();

      const result = await callTool(server, "iris_doc_edit", editCall("regenerateStorage"));

      expect(result.isError).toBeFalsy();
      expect(editSpy).toHaveBeenCalledTimes(1);
      const applied = await callTool(server, "iris_doc_edit", editCall("apply"));
      expect(applied.isError).toBeFalsy();
      expect(editSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("back-compat for the existing document tools (AC-9)", () => {
    it("iris_doc_put runs under every configuration here that does not disable it, with its own defaults", async () => {
      for (const governance of [undefined, { global: { "iris_doc_edit:apply": false } }, { global: { "iris_doc_edit:regenerateStorage": true } }]) {
        fetchMock = vi.fn();
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
        fetchMock.mockResolvedValueOnce(versionResponse());
        globalThis.fetch = fetchMock;
        if (governance === undefined) delete process.env.IRIS_GOVERNANCE;
        else process.env.IRIS_GOVERNANCE = JSON.stringify(governance);
        const { server, putSpy } = await start();

        const result = await callTool(server, "iris_doc_put", PUT_CALL);

        expect(result.isError, JSON.stringify(governance)).toBeFalsy();
        expect(putSpy).toHaveBeenCalledTimes(1);
        const discovery = await callTool(server, "iris_server_profiles", {});
        expect(discovery.structuredContent.governance.configSource["iris_doc_put"]).toBe("default");
      }
    });
  });
});
