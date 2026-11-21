/**
 * Story 43.2 QA (AC 43.2.2, 43.2.2a; AD-15, AD-32; Rules #36, #59) - an oracle for the 2026-07-28 wire that is independent of the SDK
 * client AND of the 43.1 golden.
 *
 * The cross-era pin compares the modern wire with the frozen 2025 golden, and its SDK-client rows read what the client's schemas keep.
 * Both are blind to a member the revision does not define, to a member the 2025 golden and the modern wire share but the revision
 * lacks, and to anything that varies between two requests of one connection. Here each BUILT server is driven with requests written
 * out by hand from the revision's text (`basic/index#_meta`, `server/discover`, `server/utilities/caching`, `server/tools`,
 * `basic/versioning`), and every response line is read member by member:
 *  - the frame carries exactly `jsonrpc`, `id` and `result` (or `error`); every result carries `resultType: "complete"` and the server's
 *    own `_meta` `serverInfo` (name and version from the package manifest, not from the golden);
 *  - each result carries only members the revision defines for its method, and the members it requires; the six cacheable methods
 *    carry `ttlMs >= 0` and a `cacheScope` of `public` or `private`, and no other method carries them;
 *  - `server/discover` has neither `protocolVersion` nor a top-level `serverInfo`, no `tasks` capability, and `tools` among its
 *    capabilities; a capability is declared exactly when its list method answers;
 *  - an envelope with only the two required keys is served exactly like the revision's example envelope (`clientInfo` is optional);
 *  - `tools/list` does not change as a side effect of the calls between two listings, and no tool carries `execution`;
 *  - the refusals carry the revision's codes and shapes: -32602 for a missing or incomplete envelope, -32022 with `data.supported` and
 *    `data.requested` for an `initialize`, -32601 for an unknown method;
 *  - every stdout line is a response: the server writes no request and no unsolicited notification on a modern connection.
 * Servers run against 127.0.0.1:1, a closed local port, so no IRIS instance is reached. The file fails, never skips, on a stale dist.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { GOLDEN_PACKAGES, packageVersion } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { distEntry, staleDistReason } from "./process-gate-helpers.js";
import {
  EXAMPLE_META,
  LEGACY_VERSION,
  MINIMAL_META,
  MODERN_VERSION,
  PROTOCOL_VERSION_KEY,
  SERVER_INFO_KEY,
  CLIENT_CAPABILITIES_KEY,
  handEnv,
  legacyInitializeParams,
  modernCall,
  startHandWire,
  type HandWire,
  type Json,
  type WireLine,
} from "./story-43-2-qa-hand-wire";

/** What each server's calls use: a read that reaches the closed port, and a call its validation rejects. */
const CALLS: Record<string, { closedRead: Json; invalid: Json }> = {
  "iris-dev-mcp": {
    closedRead: { name: "iris_doc_list", arguments: {} },
    invalid: { name: "iris_doc_get", arguments: { name: 12345 } },
  },
  "iris-admin-mcp": {
    closedRead: { name: "iris_namespace_list", arguments: {} },
    invalid: { name: "iris_namespace_manage", arguments: { action: "create", name: 12345 } },
  },
  "iris-interop-mcp": {
    closedRead: { name: "iris_production_status", arguments: {} },
    invalid: { name: "iris_production_manage", arguments: { action: "create", name: 12345 } },
  },
  "iris-ops-mcp": {
    closedRead: { name: "iris_metrics_system", arguments: {} },
    invalid: { name: "iris_database_action", arguments: { action: "mount", directory: 12345 } },
  },
  "iris-data-mcp": {
    closedRead: { name: "iris_docdb_find", arguments: { database: "d", filter: {} } },
    invalid: { name: "iris_docdb_document", arguments: { action: "get", database: 12345 } },
  },
};

/** The members the 2026-07-28 revision defines for each result, `_meta` and `resultType` included. */
const RESULT_MEMBERS = {
  discover: { required: ["resultType", "supportedVersions", "capabilities", "ttlMs", "cacheScope", "_meta"], allowed: ["instructions"] },
  toolsList: { required: ["resultType", "tools", "ttlMs", "cacheScope", "_meta"], allowed: ["nextCursor"] },
  promptsList: { required: ["resultType", "prompts", "ttlMs", "cacheScope", "_meta"], allowed: ["nextCursor"] },
  resourcesList: { required: ["resultType", "resources", "ttlMs", "cacheScope", "_meta"], allowed: ["nextCursor"] },
  templatesList: { required: ["resultType", "resourceTemplates", "ttlMs", "cacheScope", "_meta"], allowed: ["nextCursor"] },
  resourcesRead: { required: ["resultType", "contents", "ttlMs", "cacheScope", "_meta"], allowed: [] as string[] },
  toolsCall: { required: ["resultType", "content", "_meta"], allowed: ["structuredContent", "isError"] },
  promptsGet: { required: ["resultType", "messages", "_meta"], allowed: ["description"] },
} as const;

const TOOL_MEMBERS = ["name", "title", "description", "icons", "inputSchema", "outputSchema", "annotations", "_meta"];
const ANNOTATION_MEMBERS = ["title", "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
const IMPLEMENTATION_MEMBERS = ["name", "title", "version", "description", "icons", "websiteUrl"];

interface Observed {
  lines: Map<string, WireLine>;
  stdout: WireLine[];
  promptCall: Json | undefined;
  resourceUri: string;
}

/** Why the dists this file runs cannot be trusted, or `undefined`. */
function staleDists(): string | undefined {
  const stale = ["shared", ...GOLDEN_PACKAGES]
    .map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const)
    .filter(([, reason]) => reason !== undefined);
  return stale.length === 0 ? undefined : stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ");
}

/** The prompt call to make: the prompt with the fewest required arguments, each required argument set to a short string. */
function promptCallOf(list: Json): Json | undefined {
  const prompts: Json[] = list.prompts ?? [];
  const required = (prompt: Json): string[] => (prompt.arguments ?? []).filter((arg: Json) => arg.required === true).map((arg: Json) => arg.name);
  const prompt = [...prompts].sort((a, b) => required(a).length - required(b).length)[0];
  if (prompt === undefined) return undefined;
  const names = required(prompt);
  return names.length === 0 ? { name: prompt.name } : { name: prompt.name, arguments: Object.fromEntries(names.map((name) => [name, "x"])) };
}

/** One session on the modern era, in the fixed order of the ids below; every exchange is kept as the line the server wrote. */
async function runSession(pkg: string): Promise<Observed> {
  const wire: HandWire = startHandWire(distEntry(REPO_ROOT, pkg), handEnv({ LOG_LEVEL: "INFO" }));
  const lines = new Map<string, WireLine>();
  try {
    const ask = async (label: string, id: number, method: string, params?: unknown): Promise<WireLine> => {
      const line = await wire.request(id, method, params);
      lines.set(label, line);
      return line;
    };
    await ask("discover-example", 1, "server/discover", { _meta: EXAMPLE_META });
    await ask("discover-minimal", 2, "server/discover", { _meta: MINIMAL_META });
    await ask("tools-list-1", 3, "tools/list", { _meta: MINIMAL_META });
    await ask("call-profiles", 4, "tools/call", modernCall("iris_server_profiles", {}));
    await ask("call-closed-read", 5, "tools/call", modernCall(CALLS[pkg]!.closedRead.name, CALLS[pkg]!.closedRead.arguments));
    await ask("call-invalid", 6, "tools/call", modernCall(CALLS[pkg]!.invalid.name, CALLS[pkg]!.invalid.arguments));
    await ask("call-unknown", 7, "tools/call", modernCall("no_such_tool", {}));
    await ask("tools-list-2", 8, "tools/list", { _meta: EXAMPLE_META });
    const prompts = await ask("prompts-list", 9, "prompts/list", { _meta: MINIMAL_META });
    const resources = await ask("resources-list", 10, "resources/list", { _meta: MINIMAL_META });
    await ask("templates-list", 11, "resources/templates/list", { _meta: MINIMAL_META });
    const resourceUri = String(resources.message.result.resources[0].uri);
    await ask("resources-read", 12, "resources/read", { uri: resourceUri, _meta: MINIMAL_META });
    const promptCall = prompts.message.result === undefined ? undefined : promptCallOf(prompts.message.result);
    if (promptCall !== undefined) await ask("prompts-get", 13, "prompts/get", { ...promptCall, _meta: MINIMAL_META });
    await ask("err-no-meta", 14, "tools/list", {});
    await ask("err-no-params", 15, "tools/list");
    await ask("err-initialize", 16, "initialize", legacyInitializeParams());
    await ask("err-initialize-modern-version", 17, "initialize", legacyInitializeParams(MODERN_VERSION));
    await ask("err-no-capabilities", 18, "tools/list", { _meta: { [PROTOCOL_VERSION_KEY]: MODERN_VERSION } });
    await ask("err-bad-capabilities", 19, "tools/list", { _meta: { ...MINIMAL_META, [CLIENT_CAPABILITIES_KEY]: "elicitation" } });
    await ask("err-unknown-method", 20, "no/such/method", { _meta: MINIMAL_META });
    return { lines, stdout: wire.stdout(), promptCall, resourceUri };
  } finally {
    await wire.close();
  }
}

/** The `result` members of `line`, checked against what the revision defines for its method. */
function expectMembers(label: string, result: Json, spec: { required: readonly string[]; allowed: readonly string[] }): void {
  const defined = [...spec.required, ...spec.allowed];
  expect(Object.keys(result).filter((key) => !defined.includes(key)), `${label}: members the revision does not define`).toEqual([]);
  expect(spec.required.filter((key) => !(key in result)), `${label}: members the revision requires`).toEqual([]);
}

/** A response line is exactly `jsonrpc`, `id` and one of `result` and `error`; its `result` carries `resultType` and the server's identity. */
function expectResultFrame(label: string, line: WireLine, pkg: string): Json {
  const message = line.message;
  expect(message, `${label}: ${line.raw.slice(0, 200)}`).toBeDefined();
  expect(Object.keys(message).sort(), label).toEqual(["id", "jsonrpc", "result"]);
  expect(message.jsonrpc, label).toBe("2.0");
  expect(message.result.resultType, `${label}: resultType`).toBe("complete");
  const name = (JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", pkg, "package.json"), "utf8")) as { name: string }).name;
  const info = message.result._meta?.[SERVER_INFO_KEY];
  expect(info, `${label}: _meta serverInfo`).toMatchObject({ name, version: packageVersion(REPO_ROOT, pkg) });
  expect(Object.keys(info).filter((key) => !IMPLEMENTATION_MEMBERS.includes(key)), `${label}: serverInfo members`).toEqual([]);
  expect(Object.keys(message.result._meta), `${label}: _meta carries only the server's identity`).toEqual([SERVER_INFO_KEY]);
  return message.result;
}

/** An error frame is exactly `jsonrpc`, `id` and `error`; the error has an integer `code` and a `message`. */
function expectErrorFrame(label: string, line: WireLine, code: number): Json {
  const message = line.message;
  expect(message, `${label}: ${line.raw.slice(0, 200)}`).toBeDefined();
  expect(Object.keys(message).sort(), label).toEqual(["error", "id", "jsonrpc"]);
  expect(Object.keys(message.error).filter((key) => !["code", "message", "data"].includes(key)), `${label}: error members`).toEqual([]);
  expect(Number.isInteger(message.error.code), `${label}: code is an integer`).toBe(true);
  expect(typeof message.error.message === "string" && message.error.message.length > 0, `${label}: message`).toBe(true);
  expect(message.error.code, label).toBe(code);
  return message.error;
}

/** `ttlMs` is an integer of at least 0 and `cacheScope` is `public` or `private`. */
function expectCacheHints(label: string, result: Json): void {
  expect(Number.isInteger(result.ttlMs) && result.ttlMs >= 0, `${label}: ttlMs ${JSON.stringify(result.ttlMs)}`).toBe(true);
  expect(["public", "private"], `${label}: cacheScope`).toContain(result.cacheScope);
}

/** A response line with its id set to 0, for comparing the answers to two requests. */
const idZero = (line: WireLine): string => JSON.stringify({ ...line.message, id: 0 });

let staleReason: string | undefined;
const observed = new Map<string, Observed>();

beforeAll(async () => {
  staleReason = staleDists();
  if (staleReason !== undefined) throw new Error(`Build the packages first: ${staleReason}`);
  for (const pkg of GOLDEN_PACKAGES) observed.set(pkg, await runSession(pkg));
}, 240_000);

afterAll(() => observed.clear());

describe.each(GOLDEN_PACKAGES)("the 2026-07-28 wire of %s, read member by member", (pkg) => {
  const seen = (label: string): WireLine => observed.get(pkg)!.lines.get(label)!;
  const hasPrompts = (): boolean => seen("prompts-list").message.result !== undefined;

  it("writes only responses to stdout: no request, no unsolicited notification, nothing that is not JSON", () => {
    const stdout = observed.get(pkg)!.stdout;
    expect(stdout.length).toBeGreaterThan(0);
    for (const line of stdout) {
      expect(line.message, `not JSON: ${line.raw.slice(0, 200)}`).toBeDefined();
      expect(line.message.method, `a server-initiated message: ${line.raw.slice(0, 200)}`).toBeUndefined();
      expect(line.message.id, line.raw.slice(0, 200)).toBeDefined();
    }
    expect(stdout.length, "one response per request").toBe(observed.get(pkg)!.lines.size);
  });

  it("server/discover: the defined members only, the supported version, the identity in _meta, the capabilities that are served", () => {
    const result = expectResultFrame("discover", seen("discover-example"), pkg);
    expectMembers("discover", result, RESULT_MEMBERS.discover);
    expectCacheHints("discover", result);
    expect(Array.isArray(result.supportedVersions) && result.supportedVersions.every((v: unknown) => typeof v === "string"), "supportedVersions").toBe(true);
    expect(result.supportedVersions).toContain(MODERN_VERSION);
    expect("protocolVersion" in result, "the 2025 handshake's protocolVersion").toBe(false);
    expect("serverInfo" in result, "a top-level serverInfo").toBe(false);
    expect(typeof result.instructions === "string" && result.instructions.length > 0, "instructions").toBe(true);
    expect(result.capabilities.tools, "a server with tools declares the tools capability").toBeDefined();
    expect("tasks" in result.capabilities, "the tasks capability left the core protocol").toBe(false);
    expect("prompts" in result.capabilities, "prompts is declared exactly when prompts/list answers").toBe(hasPrompts());
    expect("resources" in result.capabilities, "resources is declared exactly when resources/list answers").toBe(
      seen("resources-list").message.result !== undefined,
    );
  });

  it("an envelope of the two required keys is served exactly like the revision's example envelope, which adds clientInfo", () => {
    expect(seen("discover-minimal").message.result).toEqual(seen("discover-example").message.result);
    expect(idZero(seen("tools-list-2"))).toBe(idZero(seen("tools-list-1")));
  });

  it("tools/list: the defined members only, no execution, valid names, deterministic and unchanged by the calls between two listings", () => {
    const result = expectResultFrame("tools/list", seen("tools-list-1"), pkg);
    expectMembers("tools/list", result, RESULT_MEMBERS.toolsList);
    expectCacheHints("tools/list", result);
    const tools: Json[] = result.tools;
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(Object.keys(tool).filter((key) => !TOOL_MEMBERS.includes(key)), `${tool.name}: members the revision does not define`).toEqual([]);
      expect(tool.name, "a valid tool name").toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect(tool.inputSchema?.type, `${tool.name}: inputSchema`).toBe("object");
      expect("execution" in tool, `${tool.name}: execution left the core protocol`).toBe(false);
      if (tool.annotations !== undefined) {
        expect(Object.keys(tool.annotations).filter((key) => !ANNOTATION_MEMBERS.includes(key)), `${tool.name}: annotations`).toEqual([]);
      }
    }
    expect(new Set(tools.map((tool) => tool.name)).size, "tool names are unique").toBe(tools.length);
    expect(tools.map((tool) => tool.name), "iris_server_profiles is listed on every server").toContain("iris_server_profiles");
    // Raw bytes: the second listing came after six calls and carried the optional clientInfo.
    expect(seen("tools-list-2").raw.replace(/"id":\d+/, '"id":0')).toBe(seen("tools-list-1").raw.replace(/"id":\d+/, '"id":0'));
  });

  it("tools/call: the defined members only, resultType complete, no caching hints, text content", () => {
    for (const label of ["call-profiles", "call-closed-read", "call-invalid"]) {
      const result = expectResultFrame(label, seen(label), pkg);
      expectMembers(label, result, RESULT_MEMBERS.toolsCall);
      expect("ttlMs" in result || "cacheScope" in result, `${label}: tools/call is not cacheable`).toBe(false);
      expect(Array.isArray(result.content) && result.content.length > 0, `${label}: content`).toBe(true);
      for (const block of result.content) {
        expect(block.type, label).toBe("text");
        expect(typeof block.text, label).toBe("string");
      }
    }
    const profiles = seen("call-profiles").message.result;
    expect(profiles.isError, "the profiles call succeeds").not.toBe(true);
    expect(typeof profiles.structuredContent, "structuredContent of a success").toBe("object");
    for (const label of ["call-closed-read", "call-invalid"]) {
      expect(seen(label).message.result.isError, `${label} is a tool execution error, in-band`).toBe(true);
    }
  });

  it("tools/call of an unknown tool: a refusal that names the tool, as a protocol error or as an in-band error", () => {
    const message = seen("call-unknown").message;
    const text: string = message.error !== undefined ? message.error.message : message.result.content?.[0]?.text;
    expect(message.error !== undefined || message.result.isError === true, seen("call-unknown").raw.slice(0, 300)).toBe(true);
    expect(text).toContain("no_such_tool");
  });

  it("prompts, resources and templates: the defined members only, the cacheable ones with hints, the rest without", () => {
    if (hasPrompts()) {
      const list = expectResultFrame("prompts/list", seen("prompts-list"), pkg);
      expectMembers("prompts/list", list, RESULT_MEMBERS.promptsList);
      expectCacheHints("prompts/list", list);
      for (const prompt of list.prompts as Json[]) {
        expect(Object.keys(prompt).filter((key) => !["name", "title", "description", "arguments", "icons", "_meta"].includes(key)), prompt.name).toEqual([]);
        for (const arg of prompt.arguments ?? []) {
          expect(Object.keys(arg).filter((key) => !["name", "title", "description", "required"].includes(key)), `${prompt.name}: argument members`).toEqual([]);
        }
      }
      const got = expectResultFrame("prompts/get", seen("prompts-get"), pkg);
      expectMembers("prompts/get", got, RESULT_MEMBERS.promptsGet);
      expect("ttlMs" in got || "cacheScope" in got, "prompts/get is not cacheable").toBe(false);
      for (const message of got.messages as Json[]) {
        expect(["user", "assistant"]).toContain(message.role);
        expect(message.content?.type).toBe("text");
      }
    } else {
      expectErrorFrame("prompts/list without the capability", seen("prompts-list"), -32601);
      expect(observed.get(pkg)!.lines.has("prompts-get")).toBe(false);
    }

    const resources = expectResultFrame("resources/list", seen("resources-list"), pkg);
    expectMembers("resources/list", resources, RESULT_MEMBERS.resourcesList);
    expectCacheHints("resources/list", resources);
    for (const resource of resources.resources as Json[]) {
      expect(typeof resource.uri, "uri").toBe("string");
      expect(typeof resource.name, "name").toBe("string");
      expect(Object.keys(resource).filter((key) => !["uri", "name", "title", "description", "mimeType", "size", "annotations", "icons", "_meta"].includes(key)), resource.uri).toEqual([]);
    }
    const templates = expectResultFrame("resources/templates/list", seen("templates-list"), pkg);
    expectMembers("resources/templates/list", templates, RESULT_MEMBERS.templatesList);
    expectCacheHints("resources/templates/list", templates);
    for (const template of templates.resourceTemplates as Json[]) {
      expect(typeof template.uriTemplate, "uriTemplate").toBe("string");
      expect(typeof template.name, "name").toBe("string");
    }
    const read = expectResultFrame("resources/read", seen("resources-read"), pkg);
    expectMembers("resources/read", read, RESULT_MEMBERS.resourcesRead);
    expectCacheHints("resources/read", read);
    expect(read.contents[0].uri).toBe(observed.get(pkg)!.resourceUri);
    expect(typeof read.contents[0].text, "a text resource").toBe("string");
  });

  it("a request without the envelope, or with an incomplete or malformed one, is refused with -32602 and points at _meta", () => {
    for (const label of ["err-no-meta", "err-no-params", "err-no-capabilities", "err-bad-capabilities"]) {
      const error = expectErrorFrame(label, seen(label), -32602);
      expect(error.message, label).toContain("_meta");
    }
  });

  it("an initialize on a modern connection is -32022 and names the versions the server supports and the one requested", () => {
    for (const [label, requested] of [
      ["err-initialize", LEGACY_VERSION],
      ["err-initialize-modern-version", MODERN_VERSION],
    ] as const) {
      const error = expectErrorFrame(label, seen(label), -32022);
      expect(error.data.supported, label).toContain(MODERN_VERSION);
      expect(error.data.requested, label).toBe(requested);
      expect(error.message, label).toContain(requested);
    }
  });

  it("an unknown method with a valid envelope is -32601", () => {
    expectErrorFrame("err-unknown-method", seen("err-unknown-method"), -32601);
  });
});
