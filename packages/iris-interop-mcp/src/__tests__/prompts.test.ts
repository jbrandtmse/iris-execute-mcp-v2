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

/** The prompts this package (iris-interop-mcp) owns per Story 25.1 AC 25.1.1 + Story 26.3. */
const OWN_PROMPT_NAMES = ["trace-message-flow", "recover-stuck-production", "resend-failed-messages"];

/** Every prompt name owned by a DIFFERENT package — must never leak here. */
const FOREIGN_PROMPT_NAMES = [
  "check-system-health",
  "run-external-backup",
  "diagnose-slow-query",
  "objectscript-review",
  "deploy-and-test-class",
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

  it("prompts/list returns EXACTLY this package's 3 owned prompt names, nothing else", async () => {
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
