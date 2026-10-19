/**
 * Story 38.6 QA (AC-2, AC-5; project rule #46) -- the `edit-and-test-class` prompt and the updated
 * `deploy-and-test-class` prompt on the real MCP SDK wire. No IRIS and no shared state.
 *
 * The built iris-dev-mcp tools, presets and prompts are registered on the built `McpServerBase`
 * (`packages/shared/dist`). Its SDK server is connected to one end of `InMemoryTransport.createLinkedPair()`
 * and a real SDK `Client` to the other, so every request crosses the SDK's JSON-RPC framing, its argument
 * parsing and its result validation, as a connected client's does. (`prompts.test.ts` of the dev package
 * calls the request handlers directly; this file is the one that drives the `Client`.)
 *
 * Pinned here:
 *  - `initialize` advertises `prompts`; `prompts/list` holds the five dev prompts with `edit-and-test-class`
 *    last, and its three arguments (`className` and `change` required, `testClass` optional).
 *  - `prompts/get` with `testClass` omitted renders one user message, its twelve steps in order, with the
 *    test step telling the model to find the test class or ask; with `testClass` given, the test step names it.
 *  - `prompts/get` with `arguments` omitted entirely: a prompt that has required arguments answers a clean
 *    InvalidParams (-32602) naming the prompt and the connection stays usable, while a prompt with no
 *    arguments renders from the same omission.
 *  - `deploy-and-test-class` names the in-place route and sends the manual `%UnitTest_Result` query to
 *    `iris_sql_query`, never `iris_sql_execute`.
 *  - Every `iris_*` token the two prompts render is a tool the real `tools/list` returns; the tokens of
 *    `edit-and-test-class` are all visible to a client under the `core` preset (`IRIS_TOOLS_PRESET=core`).
 *  - `tools/list` serves the `iris_doc_edit` sentence that `mismatches[].current` can be passed back as
 *    `expected` (DW-552), and an `iris_execute_tests` description that names `iris_sql_query` for the manual
 *    `%UnitTest_Result` query and never `iris_sql_execute` (DW-555).
 *  - Neither prompt cites an internal rule number or a repository path.
 *
 * Reads the built `shared` and `iris-dev-mcp` dists and the SDK of the monorepo's pnpm store; it fails, never
 * skips, when one is missing (run the package builds first).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveSdkEsmDir } from "./process-gate-helpers.js";
import { stepsOf, toolTokens } from "./prompt-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const INVALID_PARAMS = -32602;
const DEV_PROMPT_NAMES = [
  "diagnose-slow-query",
  "objectscript-review",
  "deploy-and-test-class",
  "promote-environment-change",
  "edit-and-test-class",
];
const EDIT_PROMPT = "edit-and-test-class";
const DEPLOY_PROMPT = "deploy-and-test-class";

interface WirePromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

interface WirePrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: WirePromptArgument[];
}

interface WirePromptResult {
  messages: Array<{ role: string; content: { type: string; text?: string } }>;
}

/** The slice of the SDK `Client` this file uses. */
interface SdkClient {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  getServerCapabilities: () => { prompts?: unknown } | undefined;
  listPrompts: () => Promise<{ prompts: WirePrompt[] }>;
  getPrompt: (params: { name: string; arguments?: Record<string, string> }) => Promise<WirePromptResult>;
  listTools: () => Promise<{ tools: Array<{ name: string; description?: string }> }>;
}

interface SdkServer {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
}

/** One connected pair: a real SDK client and the built dev server it talks to. */
interface Connection {
  client: SdkClient;
  close: () => Promise<void>;
}

const TOOLS_ENV = ["IRIS_TOOLS_PRESET", "IRIS_TOOLS_DISABLE", "IRIS_TOOLS_ENABLE"] as const;

let openConnection: (preset?: "core") => Promise<Connection>;
const opened: Connection[] = [];

beforeAll(async () => {
  const sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
  if (!sdkEsmDir) {
    throw new Error("Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm - run pnpm install.");
  }
  const load = async (file: string): Promise<Record<string, unknown>> => {
    try {
      return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    } catch (error: unknown) {
      throw new Error(`Could not import ${file} (build the packages first): ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const { Client } = (await load(path.join(sdkEsmDir, "client", "index.js"))) as {
    Client: new (info: { name: string; version: string }) => SdkClient;
  };
  const { InMemoryTransport } = (await load(path.join(sdkEsmDir, "inMemory.js"))) as {
    InMemoryTransport: { createLinkedPair: () => [unknown, unknown] };
  };
  const { McpServerBase } = (await load(path.join(REPO_ROOT, "packages", "shared", "dist", "index.js"))) as {
    McpServerBase: new (options: Record<string, unknown>) => { server: SdkServer };
  };
  const { tools } = await load(path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "tools", "index.js"));
  const { toolPresets } = await load(path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "tools", "presets.js"));
  const { prompts } = await load(path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "prompts", "index.js"));

  openConnection = async (preset) => {
    // The tool visibility preset is read from the environment when the server is constructed.
    const saved = TOOLS_ENV.map((name) => [name, process.env[name]] as const);
    for (const name of TOOLS_ENV) delete process.env[name];
    if (preset !== undefined) process.env.IRIS_TOOLS_PRESET = preset;
    let server: { server: SdkServer };
    try {
      server = new McpServerBase({ name: "@iris-mcp/dev", version: "0.0.0", tools, toolPresets, prompts, needsCustomRest: true });
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "story-38-6-qa-edit-prompt", version: "0.0.0" });
    await Promise.all([server.server.connect(serverTransport), client.connect(clientTransport)]);
    const connection: Connection = {
      client,
      close: async () => {
        await client.close().catch(() => {});
        await server.server.close().catch(() => {});
      },
    };
    opened.push(connection);
    return connection;
  };
});

afterAll(async () => {
  await Promise.all(opened.map((connection) => connection.close()));
});

/** The text of the single user message a `prompts/get` answers. */
function messageText(result: WirePromptResult): string {
  expect(result.messages).toHaveLength(1);
  const message = result.messages[0] as WirePromptResult["messages"][number];
  expect(message.role).toBe("user");
  expect(message.content.type).toBe("text");
  expect(typeof message.content.text).toBe("string");
  return message.content.text as string;
}

describe("Story 38.6 QA: the dev prompts through a real SDK Client over an in-memory transport (rule #46)", () => {
  it("advertises prompts, and lists the five dev prompts with edit-and-test-class last and its three arguments", async () => {
    const { client } = await openConnection();

    expect(client.getServerCapabilities()?.prompts).toEqual({ listChanged: true });
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual(DEV_PROMPT_NAMES);

    const listed = prompts[prompts.length - 1] as WirePrompt;
    expect(listed.name).toBe(EDIT_PROMPT);
    expect(listed.title).toBe("Edit And Test Class");
    expect(listed.description).toContain("iris_doc_edit");
    expect(listed.arguments?.map((argument) => [argument.name, argument.required === true])).toEqual([
      ["className", true],
      ["change", true],
      ["testClass", false],
    ]);
    for (const argument of listed.arguments ?? []) {
      expect(argument.description, `the description of ${argument.name}`).toBeTruthy();
    }
    const deploy = prompts.find((prompt) => prompt.name === DEPLOY_PROMPT) as WirePrompt;
    expect(deploy.arguments?.map((argument) => [argument.name, argument.required === true])).toEqual([["classOrPackage", true]]);
  });

  it("renders one user message with testClass omitted: the twelve steps in order, each with its content, and the test step finds the class or asks", async () => {
    const { client } = await openConnection();

    const text = messageText(
      await client.getPrompt({ name: EDIT_PROMPT, arguments: { className: "MyApp.Orders", change: "Rename the Total property to Amount" } }),
    );

    expect(text).toContain("Class: `MyApp.Orders`");
    expect(text).toContain("Change to make: Rename the Total property to Amount");
    const steps = stepsOf(text);
    expect([...steps.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const expectations: Array<[number, string[]]> = [
      [1, ["`iris_doc_get`", 'name: "MyApp.Orders.cls"', "`startLine`", "`ts`"]],
      [2, ["`iris_doc_edit`", 'action: "apply"', "`expected`", "line break"]],
      [3, ["`STALE_CONTENT`", "`mismatches[].current`", "`expected`", "unchanged"]],
      [4, ["`DOCUMENT_CONFLICT`", "read the lines again"]],
      [5, ["`STORAGE_DROPPED`", "`regenerateStorage`", "unless the user explicitly asks"]],
      [6, ["`GOVERNANCE_DISABLED`", "stop and tell the user"]],
      [7, ["reformats", "fresh ranged"]],
      [8, ["`iris_doc_compile`", 'doc: "MyApp.Orders.cls"']],
      [9, ["`iris_execute_tests`", "find the test class that covers `MyApp.Orders`", "ask the user", 'status: "running"', "never re-submit"]],
      [10, ["`total`", "`Test*` methods", "rerun"]],
      [11, ["local source file", "overwrite the edit"]],
      [12, ["`unifiedDiff`", "the compile result"]],
    ];
    for (const [number, needles] of expectations) {
      for (const needle of needles) {
        expect(steps.get(number), `step ${number} contains ${needle}`).toContain(needle);
      }
    }
    expect(text, "no unresolved placeholder for the omitted argument").not.toMatch(/<testClass>|undefined/);
  });

  it("names the test class in the test step when testClass is given", async () => {
    const { client } = await openConnection();

    const text = messageText(
      await client.getPrompt({
        name: EDIT_PROMPT,
        arguments: { className: "MyApp.Orders", change: "Rename the Total property to Amount", testClass: "MyApp.Tests.OrdersTest" },
      }),
    );

    const testStep = stepsOf(text).get(9) as string;
    expect(testStep).toContain('`iris_execute_tests` with `target: "MyApp.Tests.OrdersTest"` and `level: "class"`');
    expect(testStep).not.toContain("find the test class that covers");
  });

  it("prompts/get without `arguments`: a prompt with required arguments is a clean InvalidParams naming it, the connection stays usable, and a prompt with no arguments renders", async () => {
    const { client } = await openConnection();

    const refused = await client.getPrompt({ name: EDIT_PROMPT }).then(
      () => undefined,
      (error: unknown) => error as { code?: number; message?: string },
    );
    expect(refused, "the request was refused").toBeDefined();
    expect(refused?.code).toBe(INVALID_PARAMS);
    expect(refused?.message).toContain(EDIT_PROMPT);

    const partial = await client.getPrompt({ name: EDIT_PROMPT, arguments: { className: "MyApp.Orders" } }).then(
      () => undefined,
      (error: unknown) => error as { code?: number; message?: string },
    );
    expect(partial?.code, "a missing required argument").toBe(INVALID_PARAMS);
    expect(partial?.message).toContain("change");

    const unknown = await client.getPrompt({ name: "no-such-prompt" }).then(
      () => undefined,
      (error: unknown) => error as { code?: number; message?: string },
    );
    expect(unknown?.code, "an unknown prompt").toBe(INVALID_PARAMS);
    expect(unknown?.message).toContain("no-such-prompt");

    const stillUsable = messageText(await client.getPrompt({ name: EDIT_PROMPT, arguments: { className: "MyApp.Orders", change: "x" } }));
    expect(stillUsable).toContain("Class: `MyApp.Orders`");

    const noArguments = messageText(await client.getPrompt({ name: "objectscript-review" }));
    expect(noArguments.length).toBeGreaterThan(0);
  });

  it("deploy-and-test-class names the in-place route and the iris_sql_query manual query, never iris_sql_execute", async () => {
    const { client } = await openConnection();

    const text = messageText(await client.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "MyApp.Orders" } }));

    const stepTwo = stepsOf(text).get(2) as string;
    expect(stepTwo).toContain("no local source file");
    expect(stepTwo).toContain("ranged `iris_doc_get`");
    expect(stepTwo).toContain("`iris_doc_edit`");
    expect(stepTwo).toContain("`iris_doc_compile`");
    expect(stepTwo).toContain("`edit-and-test-class`");
    expect(text).toContain("`iris_sql_query` (with `parameters: [<runIndex>]`)");
    expect(text).toContain("`WHERE ti.InstanceIndex = ?`");
    expect(text).not.toContain("iris_sql_execute");
  });

  it("tools/list serves the DW-552 sentence on iris_doc_edit, and iris_execute_tests names iris_sql_query, never iris_sql_execute, for its manual query (DW-555)", async () => {
    const { client } = await openConnection();
    const described = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool.description ?? ""]));

    const edit = described.get("iris_doc_edit") as string;
    expect(edit).toContain("`current` of a STALE_CONTENT mismatch can be passed back as `expected` unchanged");
    expect(edit).toContain("ends every line, the last included, with a line break");

    const tests = described.get("iris_execute_tests") as string;
    expect(tests).toContain("`iris_sql_query` over `%UnitTest_Result`");
    expect(tests).not.toContain("iris_sql_execute");
  });

  it("neither prompt cites an internal rule number or a repository path", async () => {
    const { client } = await openConnection();
    const rendered = [
      messageText(await client.getPrompt({ name: EDIT_PROMPT, arguments: { className: "MyApp.Orders", change: "x", testClass: "MyApp.Tests.T" } })),
      messageText(await client.getPrompt({ name: EDIT_PROMPT, arguments: { className: "MyApp.Orders", change: "x" } })),
      messageText(await client.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "MyApp.Orders" } })),
    ];

    for (const text of rendered) {
      expect(text).not.toMatch(/Rule\s*#\s*\d/i);
      expect(text).not.toMatch(/\b(?:packages|scripts|_bmad-output|_bmad)\//);
      expect(text).not.toMatch(/(?:^|[\s`"'(])\/(?:Users|home)\//);
      expect(text).not.toMatch(/src\/ExecuteMCPv2|\.claude\/|AD-\d+/);
    }
  });

  it("every iris_* token of the rendered prompts is a real tool on tools/list, and those of edit-and-test-class are visible under the core preset", async () => {
    const full = await openConnection();
    const core = await openConnection("core");
    const fullTools = new Set((await full.client.listTools()).tools.map((tool) => tool.name));
    const coreTools = new Set((await core.client.listTools()).tools.map((tool) => tool.name));
    expect(fullTools.has("iris_test_status"), "control: iris_test_status is a real tool").toBe(true);
    expect(coreTools.has("iris_test_status"), "control: the core preset hides iris_test_status").toBe(false);
    expect(coreTools.has("iris_doc_edit")).toBe(true);

    const edit = messageText(await full.client.getPrompt({ name: EDIT_PROMPT, arguments: { className: "MyApp.Orders", change: "x" } }));
    const deploy = messageText(await full.client.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "MyApp.Orders" } }));

    const editTokens = toolTokens(edit);
    expect(editTokens.length).toBeGreaterThanOrEqual(5);
    for (const token of [...editTokens, ...toolTokens(deploy)]) {
      expect(fullTools.has(token), `${token} is on tools/list`).toBe(true);
    }
    for (const token of editTokens) {
      expect(coreTools.has(token), `${token} is visible under the core preset`).toBe(true);
    }
  });
});
