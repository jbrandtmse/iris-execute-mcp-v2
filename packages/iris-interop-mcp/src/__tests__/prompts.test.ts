/**
 * Story 25.1 QA — per-server prompt advertisement, end-to-end
 * (AC 25.1.1, AC 25.0.3).
 *
 * ORTHOGONAL to `packages/iris-mcp-all/src/__tests__/validate-prompts.test.ts`
 * (which checks that every `iris_*` TOKEN inside a prompt's rendered BODY
 * resolves to a real tool name) and to `readonly-hint-crosscheck.test.ts`
 * (governance classification, unrelated to prompts). Neither of those tests
 * constructs a real `@iris-mcp/interop` server or drives `prompts/list` —
 * they import prompt content directly from built dist output. This test
 * proves the Story 25.1 prompt content is actually WIRED to the real server
 * construction (`src/index.ts`: `new McpServerBase({ ..., prompts })`) by
 * building the real server with this package's own `tools` + `prompts`
 * arrays and driving the REAL MCP SDK `prompts/list` request handler —
 * mirroring the harness `packages/shared/src/__tests__/prompts.test.ts` uses
 * for framework-level fixture prompts, but against this package's actual
 * production content. No live IRIS: prompt/tool registration is fully
 * synchronous and constructor-scoped, so this never calls `start()`.
 *
 * Also confirms the OTHER server's gated v1-omitted prompt
 * (`promote-environment-change`, dev-owned) never leaks onto this server.
 * `resend-failed-messages` was the interop-owned gated prompt (AC 25.1.5) —
 * it un-gated in Epic 26, Story 26.3 once `iris_message_resend` shipped, and
 * is now asserted as OWNED (not absent) below.
 */

import { describe, it, expect } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";
import { prompts } from "../prompts/index.js";
import { recoverStuckProductionPrompt } from "../prompts/recoverStuckProduction.js";
import { traceMessageFlowPrompt } from "../prompts/traceMessageFlow.js";
import { findPatientMessagesPrompt } from "../prompts/findPatientMessages.js";

/** The prompts this package (iris-interop-mcp) owns per Story 25.1 AC 25.1.1, Story 26.3 and Story 39.6. */
const OWN_PROMPT_NAMES = [
  "trace-message-flow",
  "recover-stuck-production",
  "resend-failed-messages",
  "find-patient-messages",
];

/**
 * The `trace-message-flow` name, title and arguments as first published
 * (Story 25.1). Its description and body may change; this contract may not (AD-15).
 */
const TRACE_MESSAGE_FLOW_CONTRACT = {
  name: "trace-message-flow",
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

/** Every prompt name owned by a DIFFERENT package — must never leak here. */
const FOREIGN_PROMPT_NAMES = [
  "check-system-health",
  "run-external-backup",
  "diagnose-slow-query",
  "objectscript-review",
  "deploy-and-test-class",
  "edit-and-test-class",
  "provision-project-environment",
  "audit-security-posture",
];

/**
 * Invoke a request handler registered on the underlying `Server` by method
 * name (e.g. "prompts/list"). Drives the REAL SDK dispatch exactly as a
 * connected client would (mirrors `packages/shared/src/__tests__/prompts.test.ts`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callRequest(server: any, method: string, params: unknown) {
  const innerServer = server.server.server;
  const handlers = innerServer._requestHandlers as Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: any, extra: any) => Promise<any>
  >;
  const handler = handlers.get(method);
  if (!handler) {
    throw new Error(`No request handler registered for "${method}"`);
  }
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return handler({ method, params }, extra);
}

function makeRealServer(): McpServerBase {
  return new McpServerBase({
    name: "@iris-mcp/interop",
    version: "0.0.1",
    tools,
    prompts,
    needsCustomRest: true,
  });
}

describe("iris-interop-mcp real server prompts/list (AC 25.1.1, AC 25.0.3)", () => {
  it("advertises the prompts capability (real server, real prompts array)", () => {
    const server = makeRealServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caps = (server as any).server.server.getCapabilities();
    expect(caps.prompts).toEqual({ listChanged: true });
  });

  it("prompts/list returns EXACTLY this package's 4 owned prompt names, nothing else", async () => {
    const server = makeRealServer();
    const result = await callRequest(server, "prompts/list", {});
    const names = (result.prompts as Array<{ name: string }>).map((p) => p.name).sort();
    expect(names).toEqual([...OWN_PROMPT_NAMES].sort());
  });

  it("never advertises a prompt owned by another server package", async () => {
    const server = makeRealServer();
    const result = await callRequest(server, "prompts/list", {});
    const names = (result.prompts as Array<{ name: string }>).map((p) => p.name);
    for (const foreign of FOREIGN_PROMPT_NAMES) {
      expect(names).not.toContain(foreign);
    }
  });

  it("the previously-gated prompt 'resend-failed-messages' IS now registered (Story 26.3)", async () => {
    const server = makeRealServer();
    const result = await callRequest(server, "prompts/list", {});
    const names = (result.prompts as Array<{ name: string }>).map((p) => p.name);
    expect(names).toContain("resend-failed-messages");
  });

  it("the OTHER server's gated prompt 'promote-environment-change' (dev-owned) is NOT registered here", async () => {
    const server = makeRealServer();
    const result = await callRequest(server, "prompts/list", {});
    const names = (result.prompts as Array<{ name: string }>).map((p) => p.name);
    expect(names).not.toContain("promote-environment-change");
  });
});

// ── CR 25.1-4 (resolved Story 26.4) ──────────────────────────────────
// An explicitly-empty-string optional argument must take the SAME
// "not provided" branch as an omitted one, for BOTH note branches this
// prompt has (namespace AND production).

describe("recover-stuck-production build() — CR 25.1-4 empty-string alignment", () => {
  it("an explicit empty-string namespace renders the SAME as an omitted namespace", () => {
    const omitted = recoverStuckProductionPrompt.build({});
    const explicitEmpty = recoverStuckProductionPrompt.build({ namespace: "" });
    expect(explicitEmpty).toBe(omitted);
    expect(explicitEmpty).toContain("No namespace specified");
  });

  it("an explicit empty-string production renders the SAME as an omitted production", () => {
    const omitted = recoverStuckProductionPrompt.build({});
    const explicitEmpty = recoverStuckProductionPrompt.build({ production: "" });
    expect(explicitEmpty).toBe(omitted);
    expect(explicitEmpty).toContain("No production class name given");
  });

  it("real namespace/production values take the provided branch and are echoed", () => {
    const result = recoverStuckProductionPrompt.build({
      namespace: "USER",
      production: "My.Production",
    });
    expect(result).toContain('Target namespace: "USER"');
    expect(result).toContain("Production: `My.Production`.");
  });
});

// ── Story 39.6: trace-message-flow and find-patient-messages ─────────────

/** `prompts/get` through the real SDK dispatch; `arguments` is left out of the request when `args` is undefined. */
async function getPromptText(name: string, args?: Record<string, string>): Promise<string> {
  const server = makeRealServer();
  const params = args === undefined ? { name } : { name, arguments: args };
  const result = await callRequest(server, "prompts/get", params);
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0].role).toBe("user");
  return result.messages[0].content.text as string;
}

/** Index of each marker in `text`, asserting every one is present and the order is ascending. */
function expectInOrder(text: string, markers: string[]): void {
  const at = markers.map((marker) => text.indexOf(marker));
  markers.forEach((marker, i) => expect(at[i], `"${marker}" missing`).toBeGreaterThan(-1));
  expect([...at].sort((a, b) => a - b)).toEqual(at);
}

describe("trace-message-flow — contract and flow (Story 39.6)", () => {
  it("keeps its name, title and arguments exactly as first published", async () => {
    const server = makeRealServer();
    const result = await callRequest(server, "prompts/list", {});
    const entry = (
      result.prompts as Array<{ name: string; title: string; arguments: unknown[] }>
    ).find((p) => p.name === "trace-message-flow");
    expect({ name: entry?.name, title: entry?.title, arguments: entry?.arguments }).toEqual(
      TRACE_MESSAGE_FLOW_CONTRACT,
    );
  });

  it("names the search, read, diagram and log tools in its description", () => {
    for (const tool of [
      "iris_production_messages",
      "iris_message_search",
      "iris_message_body",
      "iris_message_diagram",
      "iris_production_logs",
    ]) {
      expect(traceMessageFlowPrompt.description).toContain(tool);
    }
    expect(traceMessageFlowPrompt.description).not.toContain("|");
  });

  it("prompts/get with the optional namespace omitted renders the flow in order, on the default namespace", async () => {
    const text = await getPromptText("trace-message-flow", { sessionOrHeaderId: "7" });
    expect(text).toContain("Session or header ID to trace: `7`");
    expect(text).toContain("No namespace specified");
    expectInOrder(text, [
      "1. Call `iris_production_messages`",
      "2. Call `iris_message_search`",
      "3. Call `iris_message_body`",
      "4. Call `iris_message_diagram`",
      "5. For every step flagged as an error",
      "`iris_production_logs`",
      "6. Summarize the failure point",
    ]);
    expect(text).toContain('`action: "headers"`');
    expect(text).toContain("at most 7 days");
    expect(text).toContain("never read it another way");
  });

  it("brackets the whole flow and never sweeps: a header start re-reads the session, `to` rounds up, a longer flow asks the user, a refusal is reported", async () => {
    const text = await getPromptText("trace-message-flow", { sessionOrHeaderId: "7" });
    expect(text).toContain("If you started from a header ID, call it again with that session's `sessionId`");
    expect(text).toContain("with `to` rounded up to the next whole second");
    expect(text).toContain("if the flow spans more, ask the user before searching it window by window, each window at most 7 days.");
    expect(text).not.toContain("split a longer session");
    expect(text).toContain("If the search is refused (for example because an operator restricted it), tell the user and go on with the hops of step 1; do not read the headers another way.");
  });

  it("prompts/get with the namespace given passes it on every call", async () => {
    const text = await getPromptText("trace-message-flow", { sessionOrHeaderId: "7", namespace: "USER" });
    expect(text).toContain('Target namespace: "USER"');
    expect(text).not.toContain("No namespace specified");
  });
});

describe("find-patient-messages — contract and flow (Story 39.6)", () => {
  it("is an interop prompt titled Find Patient Messages with one required argument", async () => {
    const server = makeRealServer();
    const result = await callRequest(server, "prompts/list", {});
    const entry = (
      result.prompts as Array<{
        name: string;
        title: string;
        arguments: Array<{ name: string; required: boolean }>;
      }>
    ).find((p) => p.name === "find-patient-messages");
    expect(entry?.title).toBe("Find Patient Messages");
    expect(entry?.arguments.map((a) => [a.name, a.required])).toEqual([
      ["patientId", true],
      ["from", false],
      ["to", false],
      ["searchTableClass", false],
      ["namespace", false],
    ]);
    expect(findPatientMessagesPrompt.description).not.toContain("|");
  });

  it("is registered last", () => {
    expect(prompts[prompts.length - 1]).toBe(findPatientMessagesPrompt);
  });

  it("prompts/get with only patientId asks the user for the period and uses the default Search Table class", async () => {
    const text = await getPromptText("find-patient-messages", { patientId: "X" });
    expect(text).toContain("Patient identifier: `X`");
    expect(text).toContain("No start time was given");
    expect(text).toContain("ask the user for the period");
    expect(text).toContain('searchTableClass: "EnsLib.HL7.SearchTable"');
    expect(text).toContain("No namespace specified");
    expectInOrder(text, [
      "1. Call `iris_server_profiles`",
      "2. Fix the search window",
      '3. Call `iris_message_search` with `action: "searchTable"`',
      "4. List the matching rows",
      "5. Only when the user wants the content, call `iris_message_body`",
      "6. Optionally call `iris_message_diagram`",
      "7. Report the messages found",
    ]);
  });

  it("prompts/get with all five arguments renders each of them", async () => {
    const text = await getPromptText("find-patient-messages", {
      patientId: "X",
      from: "2001-02-03T00:00:00Z",
      to: "2001-02-04T00:00:00Z",
      searchTableClass: "Custom.SearchTable",
      namespace: "USER",
    });
    expect(text).toContain("Search window: from `2001-02-03T00:00:00Z` to `2001-02-04T00:00:00Z`.");
    expect(text).toContain('searchTableClass: "Custom.SearchTable"');
    expect(text).toContain('Target namespace: "USER"');
    expect(text).not.toContain("No start time was given");
    expect(text).not.toContain('searchTableClass: "EnsLib.HL7.SearchTable"');
  });

  it("an omitted to reads as now, and an empty-string optional renders like an omitted one", () => {
    const fromOnly = findPatientMessagesPrompt.build({ patientId: "X", from: "2001-02-03T00:00:00Z" });
    expect(fromOnly).toContain("Search window: from `2001-02-03T00:00:00Z` to now.");
    expect(findPatientMessagesPrompt.build({ patientId: "X", from: "", searchTableClass: "" })).toBe(
      findPatientMessagesPrompt.build({ patientId: "X" }),
    );
  });

  it("renders the patient identifier as a JSON string in the filters example, whatever characters it holds", () => {
    const hostile = 'A"B\\C\nD';
    const text = findPatientMessagesPrompt.build({ patientId: hostile });
    const example = /filters: (\[.*\])`/.exec(text)?.[1];
    expect(example, "the filters example is on one line").toBeDefined();
    expect(JSON.parse(example as string)).toEqual([{ property: "PatientID", op: "eq", value: hostile }]);
    expect(findPatientMessagesPrompt.build({ patientId: "X" })).toContain('"value": "X"}]');
  });

  it("tells the agent to report a refusal and not to get the data another way, at the search and at the read", () => {
    const text = findPatientMessagesPrompt.build({ patientId: "X" });
    expect(text).toContain("A refusal (`DATA_POLICY_BLOCKED`, or an action an operator disabled) ends the lookup: tell the user, and do not look the patient up another way.");
    expect(text).toContain("A refusal here is reported the same way.");
  });

  it("keeps iris_server_profiles out of the namespace note, because that tool takes no namespace", () => {
    const named = findPatientMessagesPrompt.build({ patientId: "X", namespace: "USER" });
    expect(named).toContain('pass `namespace: "USER"` on every tool call below except `iris_server_profiles`, which takes none.');
  });
});
