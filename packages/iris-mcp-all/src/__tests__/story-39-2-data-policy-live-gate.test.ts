/**
 * Story 39.2 live gate: the PHI data policy over the resend preview, driven on the REAL wire against a
 * disposable Interoperability namespace, in the default suite (rule #59: each row names the path it guards).
 *
 * Paths: the BUILT iris-interop-mcp dist, spawned as a child process and driven by the MCP SDK `Client`
 * over stdio, for every `iris_message_resend` and `iris_server_profiles` row; raw HTTP `POST`s to
 * `/api/executemcp/v2` for the route-level rows (past every MCP-layer check, so they exercise the
 * handler's own guards). The oracle for header rows is SQL written by hand and run through the raw
 * Atelier `action/query` route; the oracle for HL7 positions is IRIS's own parser (`Hl7Fields`).
 *
 * Fixtures (`interop-namespace-fixture.ts`): the disposable namespace A holds fixture pi (headers 1 to 9,
 * one body of every kind) and fixture rho (headers 10 to 12). Every identifying value contains
 * `SYNTHPHI`; values that must survive contain `KEEPME`; times fall on 2001-02-03 UTC. `beforeAll`
 * removes leftovers by name and asserts there are none; `afterAll` stops the production, removes the
 * namespace, its database files and the fixture class, and asserts nothing is left.
 *
 * Rows:
 *  1. `capture` (armed only by `STORY_39_2_CAPTURE=1`): the legacy REST preview and the tool preview,
 *     taken on the classes and dists that predate this story, written to
 *     `fixtures/story-39-2-preview-baseline.json`.
 *  2. The rows of the I/O matrix, each below under its own `describe`.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773,
 * `_SYSTEM`, HSCUSTOM). Writes only the `EXECMCPTMP392A` namespace and database, and the HSCUSTOM class
 * `ExecuteMCPv2.Temp.Story391Fixture`. A missing or stale dist, an unresolvable SDK or an unreachable IRIS
 * skips each row with the reason, or fails with "may not be skipped" when `IRIS_REQUIRE_LIVE` is armed
 * (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  allText,
  assertDeployedBootstrapVersion,
  atelierQuery,
  distEntry,
  docFixtures,
  executeMcpPost,
  fixtureDocumentNames,
  irisClassMethod,
  irisTargetFromEnv,
  isIrisReachable,
  openWireSession,
  pollAuditEntries,
  resolveSdkEsmDir,
  shippedBootstrapVersion,
  skipTest,
  staleDistReason,
  teardownRecorder,
  type WireSession,
  type WireSessionOptions,
  type WireToolResult,
} from "./process-gate-helpers.js";
import {
  FIXTURE_DOC,
  STORY392_OPERATION_SOURCE,
  STORY392_PRODUCTION_SOURCE,
  createInteropNamespace,
  hl7Fields,
  leftovers,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
  seedBodies,
} from "./interop-namespace-fixture.js";
import {
  HL7_FIXTURES,
  checkRedactedPositions,
  separatorCharacters,
} from "../../../shared/src/__tests__/hl7-redaction-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const GATE_TAG = "story-39-2-data-policy-live-gate";
const BASELINE_PATH = path.join(__dirname, "fixtures", "story-39-2-preview-baseline.json");

const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";
const CAPTURE = process.env.STORY_39_2_CAPTURE === "1";

/** The gate namespace, and the Task 0 probe namespace whose leftovers the check also covers. */
const NS_A = "EXECMCPTMP392A";
const NS_PROBE = "EXECMCPTMP392P";
const NAMESPACES = [NS_A, NS_PROBE];

/** The `BOOTSTRAP_VERSION` the baseline must have been captured on: the one before this story. */
const PRE_STORY_BOOTSTRAP_VERSION = "6dcdd238c792";

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
/** The built interop server under default configuration (no data-policy setting: `redact`). */
let interop: WireSession;
/** How long the first built-server start took, which includes the bootstrap deployment. */
let firstStartMs = 0;
let tempDir = "";

function wireOptions(pkg: string, extra: Partial<WireSessionOptions> = {}): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: distEntry(REPO_ROOT, pkg),
    target: TARGET,
    clientName: "story-39-2-live-gate",
    ...extra,
  };
}

/** Sessions the rows open, closed in `afterAll`. */
const opened: WireSession[] = [];

/** Whether `Story392.Production` is running in A and `afterAll` must stop it. */
let productionStarted = false;

/** A session on the built interop server with `extraEnv`, and, when given, a receiver for its stderr. */
async function interopSession(
  extraEnv: Record<string, string> = {},
  onStderr?: (chunk: string) => void,
): Promise<WireSession> {
  const session = await openWireSession(wireOptions("iris-interop-mcp", onStderr ? { onStderr } : {}), extraEnv);
  opened.push(session);
  return session;
}

const PI_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// -- Setup and teardown ------------------------------------------------

beforeAll(async () => {
  skipReason = staleDistReason(REPO_ROOT, "shared");
  for (const pkg of ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"]) skipReason ??= staleDistReason(REPO_ROOT, pkg);
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    } else if (!(await isIrisReachable(TARGET.host, TARGET.port))) {
      skipReason = `IRIS is not reachable at http://${TARGET.host}:${TARGET.port}/api/atelier/ (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.2 live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  tempDir = mkdtempSync(path.join(tmpdir(), "story-39-2-gate-"));
  const started = performance.now();
  dev = await openWireSession(wireOptions("iris-dev-mcp"));
  firstStartMs = Math.round(performance.now() - started);
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  interop = await openWireSession(wireOptions("iris-interop-mcp"));
  await putFixtureClass(dev);
  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);

  await createInteropNamespace(admin, dev, NS_A, { interop: true });
  await seedBodies(dev, NS_A);

  // A positive control: the same check that must read empty after the run sees the namespace now.
  expect(await leftovers(dev, NAMESPACES), "the leftovers check sees the namespace while it exists").toEqual(
    expect.arrayContaining([`namespace ${NS_A}`, `database configuration ${NS_A}`]),
  );
}, 300000);

afterAll(async () => {
  if (skipReason) return;
  // Every step runs even when an earlier one failed, so one bad removal cannot leave the others behind.
  const { problems, attempt } = teardownRecorder();
  try {
    await attempt("stopping the production", async () => {
      if (!productionStarted) return;
      const stopped = await interop.call("iris_production_control", { action: "stop", force: true, namespace: NS_A });
      expect(stopped.isError, "stopping Story392.Production").toBeFalsy();
      productionStarted = false;
    });
    for (const name of NAMESPACES) await attempt(`removing ${name}`, () => removeInteropNamespace(admin, dev, name));
    await attempt("the leftovers check", async () => {
      expect(await leftovers(dev, NAMESPACES), "no fixture namespace after the run").toEqual([]);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("removing the temp files", async () => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });
    await attempt("the fixture document listing", async () => {
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story391", "Story392"])) {
        expect(names, `no ${FIXTURE_DOC} or generated ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [...opened, interop, admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- The pre-change capture ---------------------------------------------

interface RestCapture {
  name: string;
  body: Record<string, unknown>;
  status: number;
  text: string;
}

interface ToolCapture {
  name: string;
  args: Record<string, unknown>;
  structuredContent: unknown;
  text: string;
}

interface PreviewBaseline {
  capturedWithBootstrapVersion: string;
  irisVersion: string;
  capturedAt: string;
  command: string;
  rest: RestCapture[];
  tool: ToolCapture[];
}

/** The legacy preview requests: a nine-header set and a set with one header that does not exist. */
const REST_CASES: Array<{ name: string; body: Record<string, unknown> }> = [
  { name: "legacy preview of 1..9", body: { headerIds: PI_IDS, namespace: NS_A } },
  { name: "legacy preview with a missing header", body: { headerIds: [3, 999], namespace: NS_A } },
];

const TOOL_CASES: Array<{ name: string; args: Record<string, unknown> }> = [
  { name: "tool preview of 1..9", args: { action: "preview", headerIds: PI_IDS, namespace: NS_A } },
  { name: "tool preview with a missing header", args: { action: "preview", headerIds: [3, 999], namespace: NS_A } },
];

describe("Story 39.2: the pre-change preview capture (AD-15, AD-33)", () => {
  it.runIf(CAPTURE)("capture: the legacy REST preview and the tool preview, before the change", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const deployed = await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
    expect(deployed, "the capture runs on the classes deployed before this story").toBe(PRE_STORY_BOOTSTRAP_VERSION);

    const info = await dev.call("iris_server_info", { namespace: TARGET.namespace });
    const irisVersion = String(
      (info.structuredContent as { content?: { version?: unknown } } | undefined)?.content?.version ?? "",
    );
    expect(irisVersion, "the IRIS version string").not.toBe("");

    const rest: RestCapture[] = [];
    for (const requestCase of REST_CASES) {
      const answer = await executeMcpPost(TARGET, "/interop/message/resend/preview", requestCase.body);
      rest.push({ ...requestCase, status: answer.status, text: answer.text });
    }
    const tool: ToolCapture[] = [];
    for (const toolCase of TOOL_CASES) {
      const result = await interop.call("iris_message_resend", toolCase.args);
      expect(result.isError, toolCase.name).toBeFalsy();
      tool.push({ ...toolCase, structuredContent: result.structuredContent, text: allText(result) });
    }
    const baseline: PreviewBaseline = {
      capturedWithBootstrapVersion: deployed,
      irisVersion,
      capturedAt: new Date().toISOString(),
      command:
        "STORY_39_2_CAPTURE=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-2-data-policy-live-gate.test.ts -t capture",
      rest,
      tool,
    };
    mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  }, 240000);
});

// -- The preview, per policy ---------------------------------------------

type Item = Record<string, unknown>;

/** The header items of a preview result, in request order. */
const itemsOf = (result: WireToolResult): Item[] => (result.structuredContent as { headers: Item[] }).headers;

/** The preview of `ids` (fixture pi by default) in A, on the default profile or the named one. */
function preview(session: WireSession, ids: number[] = PI_IDS, profile?: string): Promise<WireToolResult> {
  const args = { action: "preview", headerIds: ids, namespace: NS_A };
  return profile === undefined ? session.call("iris_message_resend", args) : session.callOn(profile, "iris_message_resend", args);
}

function readBaseline(): PreviewBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as PreviewBaseline;
}

/** The kinds the bodies of fixture pi have, by header ID, and the reasons a body is withheld. */
const PI_KINDS = ["hl7v2", "hl7v2", "stream", "persistent", "streamContainer", "missing", "literal", "hl7v2", "hl7v2"];
const BLOCK_REASON = "The block data policy withholds every message body.";
const kindReason = (kind: string): string => `A ${kind} body cannot be redacted reliably, so the redact data policy withholds it.`;

// Not in a capture run: there the shipped build is the one the capture is taken on.
describe.skipIf(CAPTURE)("Story 39.2: the baseline predates this story (AD-15)", () => {
  it("was captured on the classes before the change, which differ from the shipped ones", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const baseline = readBaseline();
    expect(baseline.capturedWithBootstrapVersion, "the capture was taken on the classes before this story").toBe(PRE_STORY_BOOTSTRAP_VERSION);
    expect(baseline.capturedWithBootstrapVersion, "the gate runs on a different build than the capture").not.toBe(
      await shippedBootstrapVersion(REPO_ROOT),
    );
    expect(baseline.rest.map((c) => c.name)).toEqual(REST_CASES.map((c) => c.name));
    expect(baseline.tool.map((c) => c.name)).toEqual(TOOL_CASES.map((c) => c.name));
  });
});

describe.skipIf(CAPTURE)("Story 39.2: the preview under redact, block and allow (AC-3, AC-4, AC-7)", () => {
  it("redact (the default, no data-policy setting): HL7 keeps today's class note, the others are withheld with a reason", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const started = performance.now();
    const result = await preview(interop);
    const elapsedMs = Math.round(performance.now() - started);
    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line no-console
    console.log(`[perf] story-39-2: one redact preview of [1..9] took ${elapsedMs} ms (budget 2000 ms)`);
    expect(elapsedMs, "one redact preview of [1..9] stays inside the 2 s read budget").toBeLessThan(2000);

    const allow = readBaseline().tool[0] as ToolCapture;
    const allowItems = (allow.structuredContent as { headers: Item[] }).headers;
    const items = itemsOf(result);
    expect(items.map((item) => item.id)).toEqual(PI_IDS);
    expect(items.map((item) => item.bodyKind)).toEqual(PI_KINDS);

    for (const index of [0, 1, 7, 8]) {
      const item = items[index] as Item;
      expect(item.bodyPolicy, `item ${index + 1}`).toEqual({ outcome: "redacted", redactedFields: 0 });
      expect(item.bodySummary, `item ${index + 1}`).toBe((allowItems[index] as Item).bodySummary);
      expect(item.bodySummary).toBe("(non-stream body; class=EnsLib.HL7.Message)");
    }
    const withheld: Array<[number, string]> = [
      [2, kindReason("stream")],
      [3, kindReason("persistent")],
      [4, kindReason("streamContainer")],
    ];
    for (const [index, reason] of withheld) {
      const item = items[index] as Item;
      expect(item.bodyPolicy, `item ${index + 1}`).toEqual({ outcome: "blocked", reason });
      expect(item.bodySummary, `item ${index + 1}`).toBe("");
    }
    for (const index of [5, 6]) {
      const item = items[index] as Item;
      expect(item.bodyPolicy, `item ${index + 1}`).toEqual({ outcome: "none" });
      expect(item.bodySummary, `item ${index + 1}`).toBe("");
    }

    expect((result.structuredContent as { dataPolicy: unknown }).dataPolicy).toEqual({ policy: "redact", redacted: 4, blocked: 3 });
    const lines = allText(result).split("\n");
    expect(lines[lines.length - 1]).toBe("Data policy redact: 4 redacted, 3 withheld.");
    expect(result.content, "one text block").toHaveLength(1);
    const serialized = JSON.stringify(result);
    for (const key of ["bodyText", "bodyTextOmitted", "bodyAvailable"]) expect(serialized, key).not.toContain(`"${key}"`);
    expect(serialized, "no identifying value reaches the result").not.toContain("SYNTHPHI");
  }, 120000);

  it("block: every readable body is withheld, a body that cannot be read is none, and IRIS sends no body content", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const block = await interopSession({ IRIS_DATA_POLICY: "block" });
    const result = await preview(block);
    expect(result.isError).toBeFalsy();
    const items = itemsOf(result);
    for (const index of [0, 1, 2, 3, 4, 7, 8]) {
      expect((items[index] as Item).bodyPolicy, `item ${index + 1}`).toEqual({ outcome: "blocked", reason: BLOCK_REASON });
      expect((items[index] as Item).bodySummary).toBe("");
    }
    for (const index of [5, 6]) expect((items[index] as Item).bodyPolicy).toEqual({ outcome: "none" });
    expect((result.structuredContent as { dataPolicy: unknown }).dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 7 });
    expect(JSON.stringify(result)).not.toContain("SYNTHPHI");
  }, 120000);

  it("allow: the result equals the capture taken before the change, and the stream summary is the positive control", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const allow = await interopSession({ IRIS_DATA_POLICY: "allow" });
    const baseline = readBaseline();
    for (const captured of baseline.tool) {
      const result = await allow.call("iris_message_resend", captured.args);
      expect(result.isError, captured.name).toBeFalsy();
      expect({ structuredContent: result.structuredContent, text: allText(result) }, captured.name).toEqual({
        structuredContent: captured.structuredContent,
        text: captured.text,
      });
    }
    const full = await preview(allow);
    expect(String((itemsOf(full)[2] as Item).bodySummary), "the stream body shows today's summary").toContain("SYNTHPHI");
    expect((itemsOf(full)[0] as Item).bodySummary).toBe("(non-stream body; class=EnsLib.HL7.Message)");
    for (const key of ["dataPolicy", "bodyPolicy", "bodyKind"]) expect(JSON.stringify(full), key).not.toContain(`"${key}"`);
  }, 120000);

  it("iris_server_profiles reports the policy and its source", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const reported = await interop.raw("iris_server_profiles", {});
    const roster = (reported.structuredContent as { profiles: Array<Item> }).profiles;
    expect(roster.find((entry) => entry.name === "default")).toMatchObject({ dataPolicy: "redact", dataPolicySource: "default" });
    const block = await interopSession({ IRIS_DATA_POLICY: "block" });
    const blockRoster = ((await block.raw("iris_server_profiles", {})).structuredContent as { profiles: Array<Item> }).profiles;
    expect(blockRoster.find((entry) => entry.name === "default")).toMatchObject({ dataPolicy: "block", dataPolicySource: "IRIS_DATA_POLICY" });
  }, 120000);
});

describe.skipIf(CAPTURE)("Story 39.2: the preview route (AD-33, AD-15)", () => {
  const PREVIEW_ROUTE = "/interop/message/resend/preview";
  const post = (body: Record<string, unknown>) => executeMcpPost(TARGET, PREVIEW_ROUTE, body);
  const resultOf = (text: string): { headers: Item[] } => (JSON.parse(text) as { result: { headers: Item[] } }).result;
  const errorOf = (text: string): string => {
    const errors = (JSON.parse(text) as { status: { errors: Array<{ error: string }> } }).status.errors;
    return errors[0]?.error ?? "";
  };

  it("a request without the new fields answers byte for byte as the capture", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const captured of readBaseline().rest) {
      const answer = await post(captured.body);
      expect({ status: answer.status, text: answer.text }, captured.name).toEqual({ status: captured.status, text: captured.text });
    }
  }, 120000);

  it("bodyDetail kind: kind and availability for every found item, and no body content in the raw response", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const answer = await post({ headerIds: PI_IDS, namespace: NS_A, bodyDetail: "kind" });
    expect(answer.status).toBe(200);
    expect(answer.text).not.toContain("SYNTHPHI");
    const items = resultOf(answer.text).headers;
    expect(items.map((item) => item.bodyKind)).toEqual(PI_KINDS);
    expect(items.map((item) => item.bodyAvailable)).toEqual([true, true, true, true, true, false, false, true, true]);
    for (const item of items) {
      for (const key of ["bodySummary", "bodyText", "bodyTextOmitted"]) expect(key in item, `${String(item.id)} ${key}`).toBe(false);
    }
  }, 120000);

  it("bodyDetail text: a body over the cap is omitted, one under it is complete, and the default cap is 65536", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const capped = resultOf((await post({ headerIds: [1], namespace: NS_A, bodyDetail: "text", bodyTextMaxChars: 100 })).text).headers;
    expect(capped[0]).toMatchObject({ bodyKind: "hl7v2", bodyAvailable: true, bodyTextOmitted: "tooLarge" });
    expect("bodyText" in (capped[0] as Item)).toBe(false);

    const uncapped = resultOf((await post({ headerIds: PI_IDS, namespace: NS_A, bodyDetail: "text" })).text).headers;
    const adt = uncapped[0] as Item;
    expect(String(adt.bodyText)).toContain("KEEPME-GLUCOSE");
    expect(String(adt.bodyText).startsWith("MSH|^~\\&|SYNTHPHI-APP|")).toBe(true);
    expect(String(adt.bodyText).endsWith("\r")).toBe(true);
    expect("bodyTextOmitted" in adt).toBe(false);

    // The cap is inclusive: a text of exactly N characters fits N and does not fit N - 1.
    const length = String(adt.bodyText).length;
    const atCap = resultOf((await post({ headerIds: [1], namespace: NS_A, bodyDetail: "text", bodyTextMaxChars: length })).text).headers;
    expect((atCap[0] as Item).bodyText, "the text fits a cap of its own length").toBe(adt.bodyText);
    const underCap = resultOf((await post({ headerIds: [1], namespace: NS_A, bodyDetail: "text", bodyTextMaxChars: length - 1 })).text).headers;
    expect(underCap[0]).toMatchObject({ bodyTextOmitted: "tooLarge" });
    expect("bodyText" in (underCap[0] as Item)).toBe(false);

    expect(uncapped[8]).toMatchObject({ bodyKind: "hl7v2", bodyTextOmitted: "tooLarge" });
    for (const index of [2, 3, 4, 5, 6]) {
      const item = uncapped[index] as Item;
      expect("bodyText" in item, `item ${index + 1}`).toBe(false);
      expect("bodyTextOmitted" in item, `item ${index + 1}`).toBe(false);
    }
  }, 120000);

  it("refuses a bad bodyDetail or bodyTextMaxChars, naming the parameter and never the value, before the namespace switch", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const rows: Array<{ body: Record<string, unknown>; text: string; value: string }> = [
      { body: { bodyDetail: "raw" }, text: "bodyDetail", value: "raw" },
      { body: { bodyDetail: "text", bodyTextMaxChars: 0 }, text: "bodyTextMaxChars", value: "" },
      { body: { bodyDetail: "text", bodyTextMaxChars: 1048577 }, text: "bodyTextMaxChars", value: "1048577" },
      { body: { bodyDetail: "text", bodyTextMaxChars: "x" }, text: "bodyTextMaxChars", value: "'x'" },
    ];
    for (const row of rows) {
      for (const namespace of [NS_A, "EXECMCPTMP392Z"]) {
        const answer = await post({ headerIds: [1], namespace, ...row.body });
        const error = errorOf(answer.text);
        expect(error, JSON.stringify(row.body)).toContain(row.text);
        if (row.value !== "") expect(error, JSON.stringify(row.body)).not.toContain(row.value);
        expect(answer.text, JSON.stringify(row.body)).not.toContain("SYNTHPHI");
      }
    }
  }, 120000);
});

describe.skipIf(CAPTURE)("Story 39.2: the IRIS-side classifier and body checks, called directly (AC-3)", () => {
  it("BodyKind names the kinds fixture pi has no body of; BodyAvailable and Hl7Text refuse a body that does not open", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const search = "ExecuteMCPv2.REST.MessageSearch";
    const resend = "ExecuteMCPv2.REST.MessageResend";
    const kinds: Array<[string, string]> = [
      ["EnsLib.EDI.XML.Document", "xmlvdoc"],
      ["EnsLib.EDI.X12.Document", "vdoc"],
      ["%Library.DynamicObject", "other"],
    ];
    for (const [className, kind] of kinds) expect(await irisClassMethod(dev, NS_A, search, "BodyKind", [className]), className).toBe(kind);
    // No body is read: -1 is never the ID of a stored object, and the other class does not exist.
    expect(await irisClassMethod(dev, NS_A, resend, "BodyAvailable", ["Ens.StringRequest", -1, 1]), "a body whose ID does not open").toBe("0");
    expect(await irisClassMethod(dev, NS_A, resend, "BodyAvailable", ["No.Such.Story392Class", "1", 1]), "a class whose open throws").toBe("0");
    expect(await irisClassMethod(dev, NS_A, search, "Hl7Text", ["No.Such.Story392Class", "1", 1000]), "a class that does not exist").toBe("unreadable");
    expect(await irisClassMethod(dev, NS_A, search, "Hl7Text", ["EnsLib.HL7.Message", "NoSuchStory392Id", 1000]), "an HL7 ID that does not open").toBe(
      "unreadable",
    );
  }, 120000);
});

describe.skipIf(CAPTURE)("Story 39.2: a policy per profile (AC-7)", () => {
  it("a profile with its own value is not changed by the file's global value, and discovery reports both", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const file = path.join(tempDir, "governance-block.json");
    writeFileSync(file, JSON.stringify({ dataPolicy: { global: "block" } }));
    const session = await interopSession({
      IRIS_PROFILES: JSON.stringify({ loose: { dataPolicy: "allow" } }),
      IRIS_GOVERNANCE_FILE: file,
    });
    const baseline = readBaseline();
    const captured = baseline.tool[0] as ToolCapture;

    const loose = await preview(session, PI_IDS, "loose");
    expect({ structuredContent: loose.structuredContent, text: allText(loose) }, "loose is the allow capture").toEqual({
      structuredContent: captured.structuredContent,
      text: captured.text,
    });

    const blocked = await preview(session, PI_IDS);
    expect((blocked.structuredContent as { dataPolicy: unknown }).dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 7 });

    const roster = ((await session.raw("iris_server_profiles", {})).structuredContent as { profiles: Array<Item> }).profiles;
    expect(roster.find((entry) => entry.name === "loose")).toMatchObject({ dataPolicy: "allow", dataPolicySource: "IRIS_PROFILES" });
    expect(roster.find((entry) => entry.name === "default")).toMatchObject({
      dataPolicy: "block",
      dataPolicySource: "IRIS_GOVERNANCE_FILE:global",
    });
  }, 120000);
});

describe.skipIf(CAPTURE)("Story 39.2: the audit log and the console log (AC-5, AD-19)", () => {
  it("records the policy and the counts under redact and allow, and neither the file nor stderr holds an identifying value", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const row of [
      { policy: undefined, expected: { policy: "redact", redacted: 4, blocked: 3 } },
      { policy: "allow", expected: { policy: "allow", redacted: 0, blocked: 0 } },
    ]) {
      const label = row.policy ?? "redact";
      const file = path.join(tempDir, `audit-${label}.jsonl`);
      let stderr = "";
      const session = await interopSession(
        {
          IRIS_AUDIT_LOG: file,
          IRIS_AUDIT_LOG_PARAMS: "true",
          LOG_LEVEL: "DEBUG",
          ...(row.policy ? { IRIS_DATA_POLICY: row.policy } : {}),
        },
        (chunk) => {
          stderr += chunk;
        },
      );
      const result = await preview(session);
      expect(result.isError, label).toBeFalsy();
      if (row.policy === "allow") {
        expect(JSON.stringify(result), "the allow session's response holds the positive control").toContain("SYNTHPHI");
      }

      // Poll (bounded) until the audit file holds a tool-call entry, then take every JSON line.
      const audit = await pollAuditEntries(file, {
        tool: "iris_message_resend",
        returnAll: true,
        intervalMs: 20,
        timeoutMs: 5000,
        excerpt: 500,
      });
      const entry = audit.find((candidate) => candidate.tool === "iris_message_resend") as Item;
      expect(entry, label).toMatchObject({ tool: "iris_message_resend", action: "preview", outcome: "ok", dataPolicy: row.expected });
      const raw = readFileSync(file, "utf8");
      expect(raw, `${label}: the audit file`).not.toContain("SYNTHPHI");
      expect(stderr.length, `${label}: the server logged at DEBUG`).toBeGreaterThan(0);
      expect(stderr, `${label}: the server's stderr`).not.toContain("SYNTHPHI");
    }
  }, 120000);
});

// -- The redaction engine against IRIS's own parser ------------------------

describe.skipIf(CAPTURE)("Story 39.2: the redaction engine, parsed by IRIS before and after (AC-2, Rule #36)", () => {
  it("every non-batch fixture keeps IRIS's value at each kept position and holds only *** and separators at every other", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const engine = (await import(pathToFileURL(path.join(REPO_ROOT, "packages", "shared", "dist", "index.js")).href)) as {
      redactHl7: (text: string) => { ok: boolean; text?: string; redactedFields?: number; reason?: string };
      HL7_SAFE_HARBOR_FIELDS: ReadonlyArray<{ segment: string; field: number; category: string }>;
    };
    const fixtures = HL7_FIXTURES.filter((fixture) => fixture.oracle);
    expect(fixtures.length, "the oracle fixtures").toBeGreaterThanOrEqual(15);
    for (const fixture of fixtures) {
      const result = engine.redactHl7(fixture.text);
      expect(result.ok, fixture.name).toBe(true);
      expect(result.redactedFields, `${fixture.name}: at least one non-empty redacted field`).toBeGreaterThan(0);
      const before = await hl7Fields(dev, NS_A, fixture.text);
      const after = await hl7Fields(dev, NS_A, result.text as string);
      expect(before.length, `${fixture.name}: IRIS parsed the original`).toBeGreaterThan(0);
      expect(checkRedactedPositions(before, after, separatorCharacters(fixture.text)), fixture.name).toEqual([]);

      // Two checks that do not read the keep-list: every identifying value of a fixture is tagged
      // SYNTHPHI, and IRIS must read a position of the Safe Harbor inventory as nothing but ***.
      expect(result.text, `${fixture.name}: no identifying value survives`).not.toContain("SYNTHPHI");
      const separators = separatorCharacters(fixture.text);
      for (const entry of engine.HL7_SAFE_HARBOR_FIELDS) {
        for (const segment of after.filter((candidate) => candidate.name === entry.segment)) {
          const value = segment.fields[entry.field - 1] ?? "";
          const bare = [...value].filter((ch) => !separators.includes(ch)).join("");
          expect(bare, `${fixture.name}: ${entry.segment}-${entry.field} (category ${entry.category})`).toMatch(/^\**$/);
        }
      }
    }
  }, 180000);
});

// -- QA: the text IRIS stores, through the engine, and a header that is not found ----------------------------

describe.skipIf(CAPTURE)("Story 39.2 QA: the complete text IRIS returns goes through the engine and IRIS parses the result alike (AC-2, AD-26; Rule #36)", () => {
  it("headers 1, 2 and 8 (ADT, ACK, non-default separators): redacted without an identifying value, positions as IRIS reads them", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const engine = (await import(pathToFileURL(path.join(REPO_ROOT, "packages", "shared", "dist", "index.js")).href)) as {
      redactHl7: (text: string) => { ok: boolean; text?: string; redactedFields?: number; reason?: string };
    };
    const answer = await executeMcpPost(TARGET, "/interop/message/resend/preview", { headerIds: [1, 2, 8], namespace: NS_A, bodyDetail: "text" });
    expect(answer.status, answer.text).toBe(200);
    const items = (JSON.parse(answer.text) as { result: { headers: Item[] } }).result.headers;
    expect(items.map((item) => item.bodyKind)).toEqual(["hl7v2", "hl7v2", "hl7v2"]);

    for (const item of items) {
      const label = `header ${String(item.id)}`;
      const original = String(item.bodyText);
      expect(original, `${label}: IRIS returned the complete text`).toContain("SYNTHPHI");
      expect(original.endsWith("\r"), `${label}: CR-terminated as IRIS stores it`).toBe(true);
      const result = engine.redactHl7(original);
      expect(result.ok, `${label}: ${String(result.reason)}`).toBe(true);
      expect(result.redactedFields, `${label}: fields were redacted`).toBeGreaterThan(0);
      const redacted = String(result.text);
      expect(redacted, `${label}: no identifying value survives`).not.toContain("SYNTHPHI");
      expect(redacted.endsWith("\r"), `${label}: the terminator is kept`).toBe(true);

      const before = await hl7Fields(dev, NS_A, original);
      const after = await hl7Fields(dev, NS_A, redacted);
      expect(before.length, `${label}: IRIS parsed the original`).toBeGreaterThan(1);
      expect(checkRedactedPositions(before, after, separatorCharacters(original)), label).toEqual([]);
    }
    expect(engine.redactHl7(String(items[0]?.bodyText)).text, "the observation identifier is kept").toContain("KEEPME-GLUCOSE");
    expect(engine.redactHl7(String(items[2]?.bodyText)).text, "the message declares its own separators").toMatch(/^MSH#!@\$%#/);
  }, 120000);

  it("a header that does not exist carries no body field and counts as neither redacted nor withheld, under redact and block", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const baselineLine = (readBaseline().tool[1] as ToolCapture).text.split("\n")[1];
    expect(baselineLine, "the capture's line for the missing header").toContain("NOT FOUND");
    const block = await interopSession({ IRIS_DATA_POLICY: "block" });
    for (const [label, session, policy] of [
      ["redact", interop, "redact"],
      ["block", block, "block"],
    ] as Array<[string, WireSession, string]>) {
      const result = await preview(session, [3, 999]);
      expect(result.isError, label).toBeFalsy();
      const missing = itemsOf(result)[1] as Item;
      expect(missing, label).toMatchObject({ id: 999, found: false });
      for (const key of ["bodySummary", "bodyKind", "bodyPolicy", "bodyAvailable", "bodyText"]) expect(key in missing, `${label}: ${key}`).toBe(false);
      expect((result.structuredContent as { dataPolicy: unknown }).dataPolicy, label).toEqual({ policy, redacted: 0, blocked: 1 });
      expect(allText(result).split("\n")[1], `${label}: the per-item error line is today's`).toBe(baselineLine);
      expect(JSON.stringify(result), label).not.toContain("SYNTHPHI");
    }
  }, 120000);
});

// -- DW-570: the executing path of resendFiltered ---------------------------

describe.skipIf(CAPTURE)("Story 39.2: resendFiltered resends and the fixture leaves nothing behind (DW-570, AC-8)", () => {
  it("resends the three messages of rho in TimeCreated order, then the production, its processes and its state are gone", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const docs = docFixtures(dev, NS_A);
    await docs.putDoc("Story392.Operation.cls", STORY392_OPERATION_SOURCE);
    await docs.putDoc("Story392.Production.cls", STORY392_PRODUCTION_SOURCE);
    await docs.compileDoc("Story392.Operation.cls");
    await docs.compileDoc("Story392.Production.cls");

    // Set before the start: a start that fails part way can leave the production running, and afterAll
    // must stop it then too (a forced stop of a production that never started only adds a teardown note).
    productionStarted = true;
    const started = await interop.call("iris_production_control", { action: "start", name: "Story392.Production", namespace: NS_A });
    expect(started.isError, allText(started)).toBeFalsy();

    const answer = await executeMcpPost(TARGET, "/interop/message/resend", {
      action: "resendFiltered",
      namespace: NS_A,
      item: "Story392.Target",
      status: "Errored",
      from: "2001-02-03T10:00:00Z",
      to: "2001-02-03T10:59:59Z",
      maxMessages: 3,
      dryRun: false,
      confirm: true,
    });
    expect(answer.status, answer.text).toBe(200);
    const result = (
      JSON.parse(answer.text) as {
        status: { errors: unknown[] };
        result: { matchCount: number; results: Array<{ originalId: number; ok: boolean; newHeaderId?: number }>; summary: Item };
      }
    ).result;
    expect(result.matchCount).toBe(3);
    expect(result.results.map((r) => r.originalId)).toEqual([10, 11, 12]);
    expect(result.results.every((r) => r.ok && typeof r.newHeaderId === "number" && r.newHeaderId > 12)).toBe(true);
    expect(result.summary).toEqual({ total: 3, succeeded: 3, failed: 0 });

    const target = { ...TARGET, namespace: NS_A };
    const resent = await atelierQuery(
      target,
      "SELECT ID, Description FROM Ens.MessageHeader WHERE ID > 12 AND TargetConfigName = 'Story392.Target' AND Description LIKE 'Resent %' ORDER BY ID",
    );
    expect(resent.map((row) => Number(row["ID"]))).toEqual(result.results.map((r) => r.newHeaderId));

    // A positive control: while the production runs, the same check that must read empty after the stop
    // sees both a process in A and an Ensemble subscript for A.
    const running = (await leftovers(dev, [NS_A])).filter((entry) => entry.startsWith("process ") || entry.startsWith("^%SYS("));
    expect(running.some((entry) => entry.startsWith("process ")), "the check sees a process in A while the production runs").toBe(true);
    expect(running.some((entry) => entry.startsWith("^%SYS(")), "the check sees an Ensemble subscript for A while the production runs").toBe(true);

    const stopped = await interop.call("iris_production_control", { action: "stop", force: true, namespace: NS_A });
    expect(stopped.isError, allText(stopped)).toBeFalsy();
    productionStarted = false;
    const residue =(await leftovers(dev, [NS_A])).filter((entry) => entry.startsWith("process ") || entry.startsWith("^%SYS("));
    expect(residue, "no process runs in A and no Ensemble state remains for it").toEqual([]);
  }, 240000);
});

describe.skipIf(CAPTURE)("Story 39.2: the first built-server start", () => {
  it("deploys the bootstrap inside its 60 s budget", (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // eslint-disable-next-line no-console
    console.log(`[perf] story-39-2: the first built-server start took ${firstStartMs} ms (budget 60000 ms)`);
    expect(firstStartMs).toBeLessThan(60000);
  });
});
