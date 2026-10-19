/**
 * Story 39.6 QA (AC-2, AC-6; project rule #46) -- the `trace-message-flow` and `find-patient-messages` prompts on
 * the real MCP SDK wire. No IRIS and no shared state.
 *
 * The built iris-interop-mcp tools, presets and prompts are registered on the built `McpServerBase`
 * (`packages/shared/dist`), exactly as the package's `index.ts` registers them. Its SDK server is connected to one
 * end of `InMemoryTransport.createLinkedPair()` and a real SDK `Client` to the other, so every request crosses the
 * SDK's JSON-RPC framing, its argument parsing and its result validation, as a connected client's does. (The
 * interop package's `prompts.test.ts` calls the request handlers directly; this file is the one that drives the
 * `Client`.)
 *
 * Pinned here:
 *  - `initialize` advertises `prompts`; `prompts/list` holds the four interop prompts with `find-patient-messages`
 *    last and its five arguments; the `trace-message-flow` entry keeps its name, title and arguments exactly as
 *    first published (AD-15), after the SDK validated the list result.
 *  - `prompts/get` with the optional arguments omitted renders one user message with the steps of each prompt in
 *    order and no unresolved placeholder; with them given, they are passed on.
 *  - `prompts/get` with `arguments` omitted entirely: a prompt with required arguments answers a clean
 *    InvalidParams (-32602) naming the prompt and the connection stays usable, while a prompt whose arguments
 *    are all optional renders from the same omission.
 *  - The patient identifier is written into the lookup's filters as a JSON string whatever characters it holds,
 *    and the text a client receives equals what the dist's `build()` returns for the same arguments.
 *  - Every `iris_*` token the two prompts render is a tool the real `tools/list` returns, and is visible under
 *    the interop `core` preset (`IRIS_TOOLS_PRESET=core`).
 *  - No interop prompt, and neither generated skill body, cites an internal rule number or a repository path.
 *  - Neither prompt tells the agent to loosen the data policy, and `find-patient-messages` is a read-only walk:
 *    no tool that writes is named.
 *
 * Reads the built `shared` and `iris-interop-mcp` dists and the SDK of the monorepo's pnpm store; it fails, never
 * skips, when one is missing (run the package builds first).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAllPrompts } from "../../../../scripts/lib/prompt-catalog.mjs";
import { resolveSdkEsmDir } from "./process-gate-helpers.js";
import { stepsOf, toolTokens } from "./prompt-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const INVALID_PARAMS = -32602;
const TRACE = "trace-message-flow";
const FIND = "find-patient-messages";
const INTEROP_PROMPT_NAMES = [TRACE, "recover-stuck-production", "resend-failed-messages", FIND];

/** The `trace-message-flow` name, title and arguments as first published (Story 25.1); AD-15 keeps them. */
const TRACE_CONTRACT = {
  name: TRACE,
  title: "Trace Message Flow",
  arguments: [
    {
      name: "sessionOrHeaderId",
      description: "A session ID (traces every message in the session) or a specific message header ID.",
      required: true,
    },
    {
      name: "namespace",
      description: "Target namespace (default: the server's configured namespace).",
      required: false,
    },
  ],
};

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

/** One connected pair: a real SDK client and the built interop server it talks to. */
interface Connection {
  client: SdkClient;
  close: () => Promise<void>;
}

interface BuiltPrompt {
  name: string;
  build: (args: Record<string, string | undefined>) => string;
}

const TOOLS_ENV = ["IRIS_TOOLS_PRESET", "IRIS_TOOLS_DISABLE", "IRIS_TOOLS_ENABLE"] as const;

let openConnection: (preset?: "core") => Promise<Connection>;
let builtPrompts: BuiltPrompt[];
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
  const { tools } = await load(path.join(REPO_ROOT, "packages", "iris-interop-mcp", "dist", "tools", "index.js"));
  const { toolPresets } = await load(path.join(REPO_ROOT, "packages", "iris-interop-mcp", "dist", "tools", "presets.js"));
  const { prompts } = (await load(path.join(REPO_ROOT, "packages", "iris-interop-mcp", "dist", "prompts", "index.js"))) as {
    prompts: BuiltPrompt[];
  };
  builtPrompts = prompts;

  openConnection = async (preset) => {
    // The tool visibility preset is read from the environment when the server is constructed.
    const saved = TOOLS_ENV.map((name) => [name, process.env[name]] as const);
    for (const name of TOOLS_ENV) delete process.env[name];
    if (preset !== undefined) process.env.IRIS_TOOLS_PRESET = preset;
    let server: { server: SdkServer };
    try {
      server = new McpServerBase({ name: "@iris-mcp/interop", version: "0.0.0", tools, toolPresets, prompts, needsCustomRest: true });
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "story-39-6-qa-forensics-prompts", version: "0.0.0" });
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

/** The error a request is refused with, or undefined when it succeeds. */
async function refusalOf(call: Promise<unknown>): Promise<{ code?: number; message?: string } | undefined> {
  return call.then(
    () => undefined,
    (error: unknown) => error as { code?: number; message?: string },
  );
}

/** Assert every needle of every step is present, and that the steps are exactly `1..count`. */
function expectSteps(text: string, count: number, expectations: Array<[number, string[]]>): void {
  const steps = stepsOf(text);
  expect([...steps.keys()]).toEqual(Array.from({ length: count }, (_, index) => index + 1));
  for (const [number, needles] of expectations) {
    for (const needle of needles) {
      expect(steps.get(number), `step ${number} contains ${needle}`).toContain(needle);
    }
  }
}

/** The patient identifier of the lookup's filters example, parsed back from the rendered text. */
function filtersValue(text: string): unknown {
  const example = /filters: (\[.*\])`/.exec(text)?.[1];
  expect(example, "the filters example is on one line").toBeDefined();
  return JSON.parse(example as string);
}

const FIND_ALL_ARGS = {
  patientId: "SYNTH-MRN-1",
  from: "2001-02-03T00:00:00Z",
  to: "2001-02-04T00:00:00Z",
  searchTableClass: "Custom.SearchTable",
  namespace: "USER",
};

describe("Story 39.6 QA: the forensic prompts through a real SDK Client over an in-memory transport (rule #46)", () => {
  it("advertises prompts, and lists the four interop prompts with find-patient-messages last and its five arguments", async () => {
    const { client } = await openConnection();

    expect(client.getServerCapabilities()?.prompts).toEqual({ listChanged: true });
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual(INTEROP_PROMPT_NAMES);

    const listed = prompts[prompts.length - 1] as WirePrompt;
    expect(listed.name).toBe(FIND);
    expect(listed.title).toBe("Find Patient Messages");
    expect(listed.description).toContain("iris_message_search");
    expect(listed.description).toContain("iris_message_body");
    expect(listed.arguments?.map((argument) => [argument.name, argument.required === true])).toEqual([
      ["patientId", true],
      ["from", false],
      ["to", false],
      ["searchTableClass", false],
      ["namespace", false],
    ]);
    for (const argument of listed.arguments ?? []) {
      expect(argument.description, `the description of ${argument.name}`).toBeTruthy();
    }
  });

  it("keeps the trace-message-flow name, title and arguments exactly as first published, and names the new tools in its description (AD-15)", async () => {
    const { client } = await openConnection();

    const { prompts } = await client.listPrompts();
    const entry = prompts.find((prompt) => prompt.name === TRACE) as WirePrompt;
    expect({ name: entry.name, title: entry.title, arguments: entry.arguments }).toEqual(TRACE_CONTRACT);
    for (const tool of ["iris_production_messages", "iris_message_search", "iris_message_body", "iris_message_diagram", "iris_production_logs"]) {
      expect(entry.description, `the description names ${tool}`).toContain(tool);
    }
  });

  it("trace-message-flow with namespace omitted renders one user message: the six steps in order, each with its content, on the default namespace", async () => {
    const { client } = await openConnection();

    const text = messageText(await client.getPrompt({ name: TRACE, arguments: { sessionOrHeaderId: "7" } }));

    expect(text).toContain("Session or header ID to trace: `7`");
    expect(text).toContain("No namespace specified");
    expectSteps(text, 6, [
      [1, ["`iris_production_messages`", "`sessionId: 7`", "`headerId: 7`", "earliest and latest"]],
      [2, ["`iris_message_search`", '`action: "headers"`', "`from` and `to`", "at most 7 days", "`nextCursor`", "do not read the headers another way"]],
      [3, ["`iris_message_body`", "up to 20", "`bodyPolicy`", "`redact`", "`block`", "never read it another way"]],
      [4, ["`iris_message_diagram`", "`sessionIds: [7]`", "`block`", "never read the error text another way"]],
      [5, ["`iris_production_logs`", "`itemName`", "`textPolicy`", "never read the log text another way"]],
      [6, ["Summarize the failure point", "give its reason instead of the text", "do NOT execute a recovery action without the user's confirmation"]],
    ]);
    expect(text, "no unresolved placeholder for the omitted argument").not.toMatch(/<namespace>|<sessionOrHeaderId>|undefined/);
  });

  it("trace-message-flow with namespace given passes it on, and the steps stay the same", async () => {
    const { client } = await openConnection();

    const text = messageText(await client.getPrompt({ name: TRACE, arguments: { sessionOrHeaderId: "7", namespace: "USER" } }));

    expect(text).toContain('Target namespace: "USER"');
    expect(text).toContain('pass `namespace: "USER"` on every tool call below');
    expect(text).not.toContain("No namespace specified");
    expect([...stepsOf(text).keys()]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("find-patient-messages with only patientId renders the seven steps in order, asks the user for the period and uses the default Search Table class", async () => {
    const { client } = await openConnection();

    const text = messageText(await client.getPrompt({ name: FIND, arguments: { patientId: "SYNTH-MRN-1" } }));

    expect(text).toContain("Patient identifier: `SYNTH-MRN-1`");
    expect(text).toContain("No start time was given");
    expect(text).toContain("No namespace specified");
    expect(text).toContain("Search Table class: `EnsLib.HL7.SearchTable`");
    expectSteps(text, 7, [
      [1, ["`iris_server_profiles`", "`dataPolicy`", "`block`", "`DATA_POLICY_BLOCKED`", "Do not look the patient up another way"]],
      [2, ["With no `from`, ask the user for the period", "at most 7 days", "never search without a window"]],
      [3, ["`iris_message_search`", '`action: "searchTable"`', '`searchTableClass: "EnsLib.HL7.SearchTable"`', '"property": "PatientID"', "`notApplicable`", "`nextCursor`"]],
      [4, ["`id`", "`sessionId`", "The rows hold no body values"]],
      [5, ["`iris_message_body`", "up to 20", "`redact`", "`block`", "can only tighten", "`dataPolicyClamped`"]],
      [6, ["`iris_message_diagram`", "`sessionIds`", "at most 20"]],
      [7, ["data policy line", "never read a withheld body another way"]],
    ]);
    expect(text, "no unresolved placeholder for an omitted optional argument").not.toMatch(/<from>|<to>|<searchTableClass>|<namespace>|undefined/);
  });

  it("find-patient-messages with all five arguments passes each of them on", async () => {
    const { client } = await openConnection();

    const text = messageText(await client.getPrompt({ name: FIND, arguments: FIND_ALL_ARGS }));

    expect(text).toContain("Search window: from `2001-02-03T00:00:00Z` to `2001-02-04T00:00:00Z`.");
    expect(text).toContain('`searchTableClass: "Custom.SearchTable"`');
    expect(text).toContain('Target namespace: "USER"');
    expect(text).toContain("except `iris_server_profiles`, which takes none");
    expect(text).not.toContain("No start time was given");
    expect(text).not.toContain('Search Table class: `EnsLib.HL7.SearchTable`');
    expect(text).not.toContain('searchTableClass: "EnsLib.HL7.SearchTable"');
    expect([...stepsOf(text).keys()]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("an empty-string optional argument renders like an omitted one, and from alone reads as a window up to now", async () => {
    const { client } = await openConnection();

    const omitted = messageText(await client.getPrompt({ name: FIND, arguments: { patientId: "X" } }));
    const empty = messageText(await client.getPrompt({ name: FIND, arguments: { patientId: "X", from: "", to: "", searchTableClass: "", namespace: "" } }));
    expect(empty).toBe(omitted);

    const fromOnly = messageText(await client.getPrompt({ name: FIND, arguments: { patientId: "X", from: "2001-02-03T00:00:00Z" } }));
    expect(fromOnly).toContain("Search window: from `2001-02-03T00:00:00Z` to now.");
  });

  it("prompts/get without `arguments`: a prompt with required arguments is a clean InvalidParams naming it, the connection stays usable, and a prompt with only optional arguments renders", async () => {
    const { client } = await openConnection();

    for (const name of [TRACE, FIND, "resend-failed-messages"]) {
      const refused = await refusalOf(client.getPrompt({ name }));
      expect(refused, `${name}: the request was refused`).toBeDefined();
      expect(refused?.code, name).toBe(INVALID_PARAMS);
      expect(refused?.message, name).toContain(name);
    }

    const partialTrace = await refusalOf(client.getPrompt({ name: TRACE, arguments: { namespace: "USER" } }));
    expect(partialTrace?.code, "namespace without the required id").toBe(INVALID_PARAMS);
    expect(partialTrace?.message).toContain("sessionOrHeaderId");

    const partialResend = await refusalOf(client.getPrompt({ name: "resend-failed-messages", arguments: { item: "Story.Operation" } }));
    expect(partialResend?.code, "a missing required argument").toBe(INVALID_PARAMS);
    expect(partialResend?.message).toContain("since");

    const unknown = await refusalOf(client.getPrompt({ name: "no-such-prompt" }));
    expect(unknown?.code, "an unknown prompt").toBe(INVALID_PARAMS);
    expect(unknown?.message).toContain("no-such-prompt");

    const stillUsable = messageText(await client.getPrompt({ name: FIND, arguments: { patientId: "X" } }));
    expect(stillUsable).toContain("Patient identifier: `X`");

    // The one interop prompt whose arguments are all optional. With `arguments` omitted entirely it either
    // renders or is refused cleanly (InvalidParams naming it, never an internal error); with an empty
    // `arguments` object it renders with every optional argument absent.
    const omitted = await client
      .getPrompt({ name: "recover-stuck-production" })
      .then((result) => ({ text: messageText(result) }), (error: unknown) => ({ error: error as { code?: number; message?: string } }));
    if ("error" in omitted) {
      expect(omitted.error.code, "an all-optional prompt refuses an omitted `arguments` cleanly").toBe(INVALID_PARAMS);
      expect(omitted.error.message).toContain("recover-stuck-production");
    } else {
      expect(omitted.text).toContain("No production class name given");
    }
    const emptyArguments = messageText(await client.getPrompt({ name: "recover-stuck-production", arguments: {} }));
    expect(emptyArguments).toContain("No production class name given");
    expect(emptyArguments).toContain("No namespace specified");
    expect(emptyArguments).not.toContain("undefined");
    const afterwards = messageText(await client.getPrompt({ name: TRACE, arguments: { sessionOrHeaderId: "7" } }));
    expect(afterwards, "the connection is still usable after the refusals").toContain("Session or header ID to trace: `7`");
  });

  it("writes the patient identifier into the lookup's filters as a JSON string whatever it holds, and serves exactly what the dist's build() returns", async () => {
    const { client } = await openConnection();
    const find = builtPrompts.find((prompt) => prompt.name === FIND) as BuiltPrompt;
    const trace = builtPrompts.find((prompt) => prompt.name === TRACE) as BuiltPrompt;

    const hostile = [
      'A"B\\C\nD',
      "A$&B$1$$C",
      'X"}], "op": "ne", "value": "Y',
      "caf" + String.fromCodePoint(0xe9, 0x20, 0x2014, 0x20, 0x1f600),
      "  padded  ",
    ];
    for (const patientId of hostile) {
      const text = messageText(await client.getPrompt({ name: FIND, arguments: { patientId } }));
      expect(filtersValue(text), JSON.stringify(patientId)).toEqual([{ property: "PatientID", op: "eq", value: patientId }]);
      expect(text, "what a client receives is what build() returns").toBe(find.build({ patientId }));
      expect([...stepsOf(text).keys()], JSON.stringify(patientId)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }

    const args = { sessionOrHeaderId: "396001", namespace: "EXECMCPTMP396A" };
    expect(messageText(await client.getPrompt({ name: TRACE, arguments: args }))).toBe(trace.build(args));
    expect(messageText(await client.getPrompt({ name: FIND, arguments: FIND_ALL_ARGS }))).toBe(find.build(FIND_ALL_ARGS));
  });

  it("every iris_* token of both prompts is a real tool on tools/list, visible under the interop core preset", async () => {
    const full = await openConnection();
    const core = await openConnection("core");
    const fullTools = new Set((await full.client.listTools()).tools.map((tool) => tool.name));
    const coreTools = new Set((await core.client.listTools()).tools.map((tool) => tool.name));
    expect(fullTools.has("iris_credential_list"), "control: iris_credential_list is a real interop tool").toBe(true);
    expect(coreTools.has("iris_credential_list"), "control: the core preset hides iris_credential_list").toBe(false);
    expect(coreTools.has("iris_server_profiles"), "the framework tool is visible under core").toBe(true);

    const rendered = [
      messageText(await full.client.getPrompt({ name: TRACE, arguments: { sessionOrHeaderId: "7" } })),
      messageText(await full.client.getPrompt({ name: TRACE, arguments: { sessionOrHeaderId: "7", namespace: "USER" } })),
      messageText(await full.client.getPrompt({ name: FIND, arguments: { patientId: "X" } })),
      messageText(await full.client.getPrompt({ name: FIND, arguments: FIND_ALL_ARGS })),
    ];
    const tokens = [...new Set(rendered.flatMap(toolTokens))];
    expect(tokens.length).toBeGreaterThanOrEqual(7);
    for (const token of tokens) {
      expect(fullTools.has(token), `${token} is on tools/list`).toBe(true);
      expect(coreTools.has(token), `${token} is visible under the core preset`).toBe(true);
    }
    for (const required of ["iris_message_search", "iris_message_body", "iris_message_diagram", "iris_production_messages", "iris_production_logs", "iris_server_profiles"]) {
      expect(tokens, `the prompts name ${required}`).toContain(required);
    }
  });

  it("no interop prompt cites an internal rule number or a repository path, and neither generated skill body does", async () => {
    const { client } = await openConnection();
    const rendered: Array<{ label: string; text: string }> = [];
    for (const [name, args] of [
      [TRACE, { sessionOrHeaderId: "7" }],
      [TRACE, { sessionOrHeaderId: "7", namespace: "USER" }],
      [FIND, { patientId: "X" }],
      [FIND, FIND_ALL_ARGS],
      ["recover-stuck-production", {}],
      ["resend-failed-messages", { item: "Story.Operation", since: "2001-02-03T00:00:00Z" }],
    ] as Array<[string, Record<string, string>]>) {
      rendered.push({ label: `${name} ${JSON.stringify(args)}`, text: messageText(await client.getPrompt({ name, arguments: args })) });
    }
    for (const name of [TRACE, FIND]) {
      const skill = readFileSync(path.join(REPO_ROOT, "skills", name, "SKILL.md"), "utf8");
      // The generator's comment block precedes the closing `---` of the frontmatter; the agent reads what follows it.
      rendered.push({ label: `skills/${name}/SKILL.md body`, text: skill.slice(skill.indexOf("\n---\n", 4) + 5) });
    }

    for (const { label, text } of rendered) {
      expect(text.length, label).toBeGreaterThan(200);
      expect(text, label).not.toMatch(/Rule\s*#\s*\d/i);
      expect(text, label).not.toMatch(/\b(?:packages|scripts|_bmad-output|_bmad|node_modules)\//);
      expect(text, label).not.toMatch(/(?:^|[\s`"'(])\/(?:Users|home)\//);
      expect(text, label).not.toMatch(/src\/ExecuteMCPv2|\.claude\/|\bAD-\d+|\bDW-\d+|spec-\d|deferred-work|epic-?\d+/i);
    }
  });

  it("the generated skill carries the skill description its definition declares, and the wire serves the unchanged prompt description", async () => {
    const { client } = await openConnection();
    const { prompts } = await client.listPrompts();
    const definitions = (await loadAllPrompts(REPO_ROOT)) as Array<{
      prompt: { name: string; description: string; skill?: { description: string; preset: string } };
    }>;

    for (const name of [TRACE, FIND]) {
      const served = (prompts.find((prompt) => prompt.name === name) as WirePrompt).description as string;
      const definition = definitions.find((entry) => entry.prompt.name === name)?.prompt;
      expect(definition?.skill, `${name}: the definition sets its skill field`).toBeDefined();
      expect(served, `${name}: the wire serves the prompt's own description`).toBe(definition?.description);
      expect(served, `${name}: the wire does not serve the skill description`).not.toBe(definition?.skill?.description);

      const skill = readFileSync(path.join(REPO_ROOT, "skills", name, "SKILL.md"), "utf8");
      expect(skill, `${name}: the skill's frontmatter description`).toContain(
        `\ndescription: ${JSON.stringify(definition?.skill?.description)}\n`,
      );
      expect(skill, `${name}: the skill does not carry the prompt description`).not.toContain(`\ndescription: ${JSON.stringify(served)}\n`);
      expect(skill).toContain(`\nname: ${name}\n`);
    }
  });

  it("neither forensic prompt loosens the data policy or names a tool that writes", async () => {
    const { client } = await openConnection();
    const rendered = [
      messageText(await client.getPrompt({ name: TRACE, arguments: { sessionOrHeaderId: "7" } })),
      messageText(await client.getPrompt({ name: FIND, arguments: { patientId: "X" } })),
      messageText(await client.getPrompt({ name: FIND, arguments: FIND_ALL_ARGS })),
    ];

    for (const text of rendered) {
      expect(text).not.toMatch(/dataPolicy"?\s*[:=]\s*"?allow/i);
      expect(text).not.toMatch(/set\s+`?dataPolicy`?\s+to\s+`?allow/i);
      expect(text).not.toMatch(/IRIS_DATA_POLICY|IRIS_TOOLS_ENABLE|governance/i);
      expect(text).toContain("another way");
    }
    // The lookup walk reads only: the resend and recovery tools appear in neither the lookup nor its report.
    const find = messageText(await client.getPrompt({ name: FIND, arguments: { patientId: "X" } }));
    for (const writer of ["iris_message_resend", "iris_production_control", "iris_production_manage", "iris_doc_put", "iris_sql_execute", "iris_global_set"]) {
      expect(find, `find-patient-messages does not name ${writer}`).not.toContain(writer);
    }
  });
});
