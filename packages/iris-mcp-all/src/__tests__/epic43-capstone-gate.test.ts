/**
 * Epic 43 capstone gate (AC 43.4.2; Rule #21, Rule #59; AD-15, AD-19, AD-32, AD-34) - the epic's whole promise, walked in ONE session
 * per negotiation mode on the same BUILT admin server, through the real SDK client over stdio, in the default suite.
 *
 * The server runs against a fake IRIS listener (`scripts/lib/fake-iris-listener.mjs`, on 127.0.0.1 inside this process; no IRIS
 * instance is reached) with auditing on and `iris_audit_manage:purge` enabled. The client declares form elicitation and negotiates as
 * `legacy` (the 2025-11-25 `initialize` handshake plus the SDK shim for the dialog), as a pinned `2026-07-28`, or as `auto` (Claude
 * Code's default: it must land on 2026-07-28). Each mode is one `it`, and each step names itself in its assertion message:
 *   1. Era: the client's era and negotiated version are the mode's, and the server's stderr holds exactly one era line, of that era.
 *   2. Listing: `tools/list`, `prompts/list`, `resources/list` and `prompts/get` (with NO `arguments` key, Rule #46) equal the sanctioned
 *      wire golden's admin `main` rows.
 *   3. Read: `iris_namespace_list` equals the handler golden's `namespace-list` result, and asks IRIS what that row says it asked.
 *   4. Denial: `iris_resource_manage` `grant` equals the golden's `call:denial`; no dialog, no write.
 *   5. Validation: `iris_namespace_manage` with a numeric name equals the golden's `call:invalid-type`; no dialog, no write.
 *   6. Accept: the purge asks once, with the dialog template and the form schema, and runs once, returning the 43.3 baseline's purge result.
 *   7. Decline: the same purge asks once, is declined, returns `CONFIRMATION_DECLINED` and writes nothing.
 *   8. Audit: exactly five tool entries, in call order, with the outcomes and the confirmation answers of the walk.
 *
 * Oracles: the golden is the frozen SDK v1 capture plus the sanctioned changes of `fixtures/sdk-golden-sanctioned-changes.json`; the
 * purge success and its write are `BASELINE["admin: purge ok"]` of `story-43-3-qa-baseline.ts` (captured before Story 43.3); the dialog
 * template and the decline text are written here from the spec, not read from the code under test. Every live answer goes through
 * `withoutMandatedFields` and every golden frame through `withoutExecution`, so the only differences ignored are those 2026-07-28 mandates.
 *
 * How it differs from its siblings: 43.1 pins the 2025-11-25 bytes on a closed port; 43.2 pins era equivalence on a closed port, without a
 * write path; 43.3 pins each gate in isolation, on `legacy` and a pinned revision only. This is the one test that walks the promise end
 * to end on one built server per mode, adds `auto`, asserts the era it landed on, and is the named epic-done gate.
 *
 * Proven red (Rule #59), each mutated in source, rebuilt, run, reverted and rebuilt:
 *   - M1 `legacy: "serve"` -> `"reject"` in `McpServerBase.start()`'s `serveStdio` call: `legacy` fails at connect, `pinned` and `auto` pass.
 *     Path: `serveStdio` in the admin server process, over real stdio, under the client's `{mode: "legacy"}` handshake.
 *   - M2 the `serveStdio(...)` statement replaced by a plain `connect(new StdioServerTransport())`, which serves 2025 only: `pinned` fails at
 *     connect, `auto` fails at step 1 (it fell back to legacy), and `legacy` fails at step 1 as well, because a plain connect never builds
 *     an instance through the factory and so writes no era line. Same path.
 *   - M3 `classifyConfirmationResponse` returning `"accepted"` for a decline: step 7 fails on all three modes (a purge POST is sent). Path:
 *     `confirmOnWire` -> `classifyConfirmationResponse` in the shared dist the admin process loads, reached on 2025-11-25 through the SDK
 *     shim and on 2026-07-28 through the client's retry.
 *   - M4 a source file of `@iris-mcp/shared` touched without a rebuild: the file fails with "Build the packages first" and skips nothing.
 *
 * Not pinned here: how many times the server starts per connect. A probe copy is ended by SIGTERM, so its lines race; the live smoke records it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./pack-fixture";
import { withoutExecution, withoutMandatedFields } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { readSanctionedGolden } from "../../../../scripts/lib/golden-sanctioned-changes.mjs";
import { closeSdkRigs, openSdkRig } from "./sdk-confirmation-rig.js";
import type { SdkRig } from "./sdk-confirmation-rig.js";
import type { SdkVersionNegotiation } from "./process-gate-helpers.js";
import { BASELINE } from "./story-43-3-qa-baseline";

const PKG = "iris-admin-mcp";
const LEGACY_ERA_LINE = "[INFO] Serving the 2025-era MCP handshake (initialize)";
const MODERN_ERA_LINE = "[INFO] Serving MCP protocol revision 2026-07-28 (server/discover)";

interface Mode {
  name: string;
  negotiation: SdkVersionNegotiation;
  era: "legacy" | "modern";
  version: string;
}

const MODES: Mode[] = [
  { name: "legacy", negotiation: { mode: "legacy" }, era: "legacy", version: "2025-11-25" },
  { name: "pinned", negotiation: { mode: { pin: "2026-07-28" } }, era: "modern", version: "2026-07-28" },
  { name: "auto", negotiation: { mode: "auto" }, era: "modern", version: "2026-07-28" },
];

/** What a client that can show a form declares. */
const FORM = { elicitation: { form: {} } };

/** The one gated write the walk enables. */
const GOVERNANCE = '{"global":{"iris_audit_manage:purge":true}}';

const PURGE_ARGS = { action: "purge", end: "2026-01-01 00:00:00", confirm: true };
const TICKED = { action: "accept", content: { confirm: true } } as const;
const DECLINED = { action: "decline" } as const;

/** The form every gate sends: one required boolean, unticked by default. */
const SCHEMA = {
  type: "object",
  properties: { confirm: { type: "boolean", title: "Confirm", description: "Tick to confirm this change.", default: false } },
  required: ["confirm"],
};

/** The dialog of the purge, written from the spec (wave-8 decision #13). */
const dialogOf = (port: number): string =>
  [
    "Confirm: permanently delete audit-log records.",
    "Target: the IRIS audit log",
    "Scope: records matching end=2026-01-01 00:00:00",
    `Server: default (127.0.0.1:${port})`,
    "Tick Confirm and accept to run it now. Decline or cancel to change nothing.",
  ].join("\n");

const DECLINE_TEXT =
  "The person declined the confirmation for: permanently delete audit-log records. Nothing was changed. Do not repeat this call unless the person asks for it again.";

interface Row {
  label: string;
  line: string;
  upstream?: Array<{ method: string; url: string; body: string }>;
}

const wireGolden = readSanctionedGolden(REPO_ROOT, "wire") as { servers: Record<string, { sessions: Record<string, { rows: Row[] }> }> };
const handlerGolden = readSanctionedGolden(REPO_ROOT, "handler") as { servers: Record<string, { rows: Row[] }> };

/** The row `label` of a golden section; fails the test, naming it, when the golden has none. */
function rowOf(rows: Row[], label: string): Row {
  const row = rows.find((candidate) => candidate.label === label);
  if (row === undefined) throw new Error(`the golden has no row ${label}`);
  return row;
}

const wireRow = (label: string): Row => rowOf(wireGolden.servers[PKG]!.sessions["main"]!.rows, label);
const handlerRow = (label: string): Row => rowOf(handlerGolden.servers[PKG]!.rows, label);

/** The `result` of a golden frame without `execution`. */
const frozenResult = (row: Row): unknown => (withoutExecution(JSON.parse(row.line)) as { result: unknown }).result;

/** A live result without the fields the 2026-07-28 revision mandates. */
const liveResult = (method: string, result: unknown): unknown => (withoutMandatedFields(method, { result }) as { result: unknown }).result;

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

/**
 * The server's stderr once it holds `line`, or what it holds when `timeoutMs` has passed. The reply to a request and the server's
 * stderr travel on separate pipes, so the reply can arrive before the line the server wrote first.
 */
async function stderrWith(rig: SdkRig, line: string, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (!rig.stderr().includes(line) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  return rig.stderr();
}

/** The members of an audit entry that the walk asserts. */
function asserted(entry: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(["tool", "outcome", "denyReason", "confirmation"].filter((key) => key in entry).map((key) => [key, entry[key]]));
}

afterEach(closeSdkRigs);

/** Walk the epic's promise on `mode`, one step at a time. */
async function walk(mode: Mode): Promise<void> {
  const rig: SdkRig = await openSdkRig(PKG, mode.negotiation, {
    capabilities: FORM,
    governance: GOVERNANCE,
    clientName: "epic43-capstone",
    env: { LOG_LEVEL: "INFO" },
  });
  const { client } = rig;

  // 1. Era. The serving process names its era when its first message arrives, which on a probing mode is the first request.
  expect(client.getProtocolEra(), `${mode.name} step 1: the client's era`).toBe(mode.era);
  expect(client.getNegotiatedProtocolVersion(), `${mode.name} step 1: the negotiated version`).toBe(mode.version);
  const tools = await client.listTools();
  const eraLine = mode.era === "modern" ? MODERN_ERA_LINE : LEGACY_ERA_LINE;
  const otherLine = mode.era === "modern" ? LEGACY_ERA_LINE : MODERN_ERA_LINE;
  const stderr = await stderrWith(rig, eraLine);
  expect(countOf(stderr, eraLine), `${mode.name} step 1: one ${mode.era} era line on stderr`).toBe(1);
  expect(countOf(stderr, otherLine), `${mode.name} step 1: no line of the other era`).toBe(0);

  // 2. Listing.
  expect(liveResult("tools/list", tools), `${mode.name} step 2: tools/list is the sanctioned golden's`).toEqual(frozenResult(wireRow("tools-list")));
  expect(liveResult("prompts/list", await client.listPrompts()), `${mode.name} step 2: prompts/list is the golden's`).toEqual(frozenResult(wireRow("prompts-list")));
  expect(liveResult("resources/list", await client.listResources()), `${mode.name} step 2: resources/list is the sanctioned golden's`).toEqual(
    frozenResult(wireRow("resources-list")),
  );
  expect(
    liveResult("prompts/get", await client.getPrompt({ name: "audit-security-posture" })),
    `${mode.name} step 2: prompts/get with no arguments key is the golden's {} row`,
  ).toEqual(frozenResult(wireRow("prompts-get:empty:audit-security-posture")));

  // 3. Read.
  const requestsBeforeRead = rig.requests().length;
  const read = await rig.call("iris_namespace_list", {});
  expect(liveResult("tools/call", read.result), `${mode.name} step 3: iris_namespace_list is the handler golden's result`).toEqual(
    (JSON.parse(handlerRow("namespace-list").line) as { result: unknown }).result,
  );
  expect(rig.requests().slice(requestsBeforeRead), `${mode.name} step 3: what IRIS was asked`).toEqual(handlerRow("namespace-list").upstream);
  expect(read.asks, `${mode.name} step 3: a read asks nothing`).toEqual([]);

  // 4. Denial.
  const denied = await rig.call("iris_resource_manage", { action: "grant" });
  expect(liveResult("tools/call", denied.result), `${mode.name} step 4: the governance denial is the golden's`).toEqual(frozenResult(wireRow("call:denial")));
  expect(denied.asks, `${mode.name} step 4: a denial asks nothing`).toEqual([]);
  expect(denied.writes, `${mode.name} step 4: a denial writes nothing`).toEqual([]);

  // 5. Validation.
  const invalid = await rig.call("iris_namespace_manage", { action: "create", name: 12345 });
  expect(liveResult("tools/call", invalid.result), `${mode.name} step 5: the validation error is the golden's`).toEqual(frozenResult(wireRow("call:invalid-type")));
  expect(invalid.asks, `${mode.name} step 5: a validation error asks nothing`).toEqual([]);
  expect(invalid.writes, `${mode.name} step 5: a validation error writes nothing`).toEqual([]);
  expect(rig.writes(), `${mode.name}: nothing has been written before the purge`).toEqual([]);

  // 6. Accept.
  rig.answer(TICKED);
  const accepted = await rig.call("iris_audit_manage", PURGE_ARGS);
  expect(accepted.asks, `${mode.name} step 6: the accepted purge asks once`).toHaveLength(1);
  expect(accepted.asks[0], `${mode.name} step 6: the dialog`).toMatchObject({ mode: "form", message: dialogOf(rig.port) });
  expect(accepted.asks[0]?.requestedSchema, `${mode.name} step 6: the form`).toStrictEqual(SCHEMA);
  expect(liveResult("tools/call", accepted.result), `${mode.name} step 6: the purge result is the baseline's`).toEqual(BASELINE["admin: purge ok"]!.result);
  expect(accepted.writes, `${mode.name} step 6: one purge POST`).toEqual(BASELINE["admin: purge ok"]!.a);

  // 7. Decline.
  rig.answer(DECLINED);
  const declined = await rig.call("iris_audit_manage", PURGE_ARGS);
  expect(declined.asks, `${mode.name} step 7: the declined purge asks once and is not asked again`).toHaveLength(1);
  expect(liveResult("tools/call", declined.result), `${mode.name} step 7: the decline result`).toEqual({
    content: [{ type: "text", text: DECLINE_TEXT }],
    structuredContent: { code: "CONFIRMATION_DECLINED", action: "purge", response: "decline" },
    isError: true,
  });
  expect(declined.writes, `${mode.name} step 7: a declined purge writes nothing`).toEqual([]);
  expect(rig.writes(), `${mode.name}: the walk wrote exactly the accepted purge`).toEqual(BASELINE["admin: purge ok"]!.a);

  // 8. Audit.
  const entries = await rig.entries(5);
  expect(entries.map(asserted), `${mode.name} step 8: five tool entries, in call order`).toEqual([
    { tool: "iris_namespace_list", outcome: "ok" },
    { tool: "iris_resource_manage", outcome: "denied", denyReason: "GOVERNANCE_DISABLED" },
    { tool: "iris_namespace_manage", outcome: "error" },
    { tool: "iris_audit_manage", outcome: "ok", confirmation: "accepted" },
    { tool: "iris_audit_manage", outcome: "denied", denyReason: "CONFIRMATION_DECLINED", confirmation: "declined" },
  ]);
}

describe("Epic 43 capstone: the built admin server, through the real SDK client, on every negotiation mode", () => {
  it.each(MODES)("$name: era, listing, read, denial, validation, accept, decline and audit in one session", async (mode) => {
    await walk(mode);
  }, 180_000);
});
