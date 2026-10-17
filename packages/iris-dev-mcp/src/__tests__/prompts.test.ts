/**
 * Story 25.1 QA — per-server prompt advertisement, end-to-end
 * (AC 25.1.1, AC 25.0.3).
 *
 * ORTHOGONAL to `packages/iris-mcp-all/src/__tests__/validate-prompts.test.ts`
 * (which checks that every `iris_*` TOKEN inside a prompt's rendered BODY
 * resolves to a real tool name) and to `readonly-hint-crosscheck.test.ts`
 * (governance classification, unrelated to prompts). Neither of those tests
 * constructs a real `@iris-mcp/dev` server or drives `prompts/list` — they
 * import prompt content directly from built dist output. This test proves
 * the Story 25.1 prompt content is actually WIRED to the real server
 * construction (`src/index.ts`: `new McpServerBase({ ..., prompts })`) by
 * building the real server with this package's own `tools` + `prompts`
 * arrays and driving the REAL MCP SDK `prompts/list` request handler —
 * mirroring the harness `packages/shared/src/__tests__/prompts.test.ts` uses
 * for framework-level fixture prompts, but against this package's actual
 * production content. No live IRIS: prompt/tool registration is fully
 * synchronous and constructor-scoped, so this never calls `start()`.
 */

import { describe, it, expect } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import { tools } from "../tools/index.js";
import { prompts } from "../prompts/index.js";
import { diagnoseSlowQueryPrompt } from "../prompts/diagnoseSlowQuery.js";

/**
 * The prompts this package (iris-dev-mcp) owns per Story 25.1 AC 25.1.1, plus
 * `promote-environment-change` (un-gated in Story 27.4 once `iris_env_diff`/
 * `iris_env_promote` shipped — mirrors the Epic 26 `resend-failed-messages`
 * un-gate precedent), and `edit-and-test-class` (Story 38.6).
 */
const OWN_PROMPT_NAMES = [
  "diagnose-slow-query",
  "objectscript-review",
  "deploy-and-test-class",
  "promote-environment-change",
  "edit-and-test-class",
];

/** Every prompt name owned by a DIFFERENT package — must never leak here. */
const FOREIGN_PROMPT_NAMES = [
  "check-system-health",
  "run-external-backup",
  "trace-message-flow",
  "recover-stuck-production",
  "find-patient-messages",
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
    name: "@iris-mcp/dev",
    version: "0.0.1",
    tools,
    prompts,
    needsCustomRest: true,
  });
}

describe("iris-dev-mcp real server prompts/list (AC 25.1.1, AC 25.0.3)", () => {
  it("advertises the prompts capability (real server, real prompts array)", () => {
    const server = makeRealServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caps = (server as any).server.server.getCapabilities();
    expect(caps.prompts).toEqual({ listChanged: true });
  });

  it("prompts/list returns EXACTLY this package's 5 owned prompt names, nothing else", async () => {
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
});

describe("edit-and-test-class over the real prompts/list and prompts/get (Story 38.6)", () => {
  /** The rendered text of the single user message `prompts/get` returns. */
  async function getBody(args: Record<string, string>): Promise<string> {
    const server = makeRealServer();
    const result = await callRequest(server, "prompts/get", { name: "edit-and-test-class", arguments: args });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content.type).toBe("text");
    return result.messages[0].content.text as string;
  }

  it("is advertised with className and change required, testClass optional, and a title", async () => {
    const server = makeRealServer();
    const result = await callRequest(server, "prompts/list", {});
    const listed = (
      result.prompts as Array<{
        name: string;
        title?: string;
        arguments?: Array<{ name: string; required?: boolean }>;
      }>
    ).find((p) => p.name === "edit-and-test-class");
    expect(listed?.title).toBe("Edit And Test Class");
    expect(listed?.arguments?.map((a) => [a.name, a.required === true])).toEqual([
      ["className", true],
      ["change", true],
      ["testClass", false],
    ]);
  });

  it("renders one user message with the steps in order when testClass is omitted, telling the model to find the test class or ask", async () => {
    const body = await getBody({ className: "MyApp.Orders", change: "Rename the Total property to Amount" });

    expect(body).toContain("`MyApp.Orders`");
    expect(body).toContain("Rename the Total property to Amount");
    const order = [
      "`iris_doc_get` with `name: \"MyApp.Orders.cls\"`",
      "`iris_doc_edit` with `action: \"apply\"`",
      "`STALE_CONTENT`",
      "`DOCUMENT_CONFLICT`",
      "`STORAGE_DROPPED`",
      "`GOVERNANCE_DISABLED`",
      "`iris_doc_compile`",
      "`iris_execute_tests`",
      "`Test*` methods",
      "`unifiedDiff`",
    ].map((needle) => body.indexOf(needle));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toContain("find the test class that covers `MyApp.Orders`");
    expect(body).toContain("or ask the user");
  });

  it("names the test class in the test step when testClass is given", async () => {
    const body = await getBody({
      className: "MyApp.Orders",
      change: "Rename the Total property to Amount",
      testClass: "MyApp.Tests.OrdersTest",
    });

    expect(body).toContain('`iris_execute_tests` with `target: "MyApp.Tests.OrdersTest"` and `level: "class"`');
    expect(body).not.toContain("find the test class that covers");
  });

  it("an explicitly empty testClass renders like an omitted one", async () => {
    const omitted = await getBody({ className: "MyApp.Orders", change: "x" });
    const empty = await getBody({ className: "MyApp.Orders", change: "x", testClass: "" });
    expect(empty).toBe(omitted);
  });
});

// ── CR 25.1-4 (resolved Story 26.4) ──────────────────────────────────
// An explicitly-empty-string optional argument must take the SAME
// "not provided" branch as an omitted one (previously it took the
// "provided" wording yet still rendered the placeholder).

describe("diagnose-slow-query build() — CR 25.1-4 empty-string alignment", () => {
  it("an explicit empty-string namespace renders the SAME as an omitted namespace", () => {
    const omitted = diagnoseSlowQueryPrompt.build({ query: "SELECT 1" });
    const explicitEmpty = diagnoseSlowQueryPrompt.build({ query: "SELECT 1", namespace: "" });
    expect(explicitEmpty).toBe(omitted);
    expect(explicitEmpty).toContain("No namespace specified");
    expect(explicitEmpty).not.toContain('namespace: "<namespace>"');
  });

  it("a real namespace value takes the provided branch and is echoed", () => {
    const result = diagnoseSlowQueryPrompt.build({ query: "SELECT 1", namespace: "USER" });
    expect(result).toContain('Target namespace: "USER"');
  });
});
