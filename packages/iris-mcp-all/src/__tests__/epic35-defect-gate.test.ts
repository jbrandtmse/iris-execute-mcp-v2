/**
 * Story 35.8 (AC 35.8.4) — the Epic 35 defect gate: ONE consolidated,
 * DEFAULT-SUITE, live-IRIS exercise of all nine Epic 35 corrected contracts
 * (F1-F9), each leg naming the path it guards (Rule #59).
 *
 * PLACEMENT (Rule #45). The nine fixes span four leaf packages (interop, data,
 * admin, dev) plus `@iris-mcp/shared`. `iris-mcp-all` is the only package that
 * depends on all five servers, and its `__tests__` already hosts the
 * process-gate pattern (`host-guard-process-gate.test.ts` et al.) — so the
 * cross-package gate lives here, mirroring `packages/iris-dev-mcp/src/
 * __tests__/execute-classmethod-epic-gate.test.ts`'s shape: a `beforeAll`
 * availability probe + per-test `ctx.skip()` on a pristine/offline checkout,
 * with `IRIS_REQUIRE_LIVE=1` (set by this package's
 * `scripts/prepublish-gate.mjs` on the packaging path) flipping a skip into a
 * hard failure.
 *
 * WHAT THE LEGS DRIVE. Tool fixes F3/F5/F7/F8/F9 live in the TS tool layer, so
 * raw curl cannot see them (35.4 lesson) — every leg calls the tool's
 * `handler(args, ctx)` against a REAL `ToolContext` (`buildToolContext` +
 * `IrisHttpClient`). The tool definitions come from each leaf package's BUILT
 * `dist/tools/index.js` via dynamic `import()` (the established iris-mcp-all
 * cross-package pattern — `tool-visibility-non-drift.test.ts` et al.): the
 * gate exercises the code that SHIPS, and `prepublish-gate.mjs`'s
 * dist-freshness check (which runs first, fail-closed) guarantees that dist is
 * current on the packaging path. F2 alone deliberately bypasses the tool layer
 * with a raw `fetch` — its defect is IN the wire bytes (device text prepended
 * to the JSON body), which any JSON-parsing client masks (see the 35.2 gate's
 * own header for why no other shape can see it).
 *
 * DEGRADATION CONTRACT. No IRIS / no ExecuteMCPv2 REST app / missing dists →
 * every leg skips with a logged reason (never fails a pristine checkout);
 * `IRIS_REQUIRE_LIVE=1` (the armed packaging path) throws in `beforeAll`
 * instead. Two legs carry per-leg degradation of their own, documented inline:
 * F1 needs the Story 35.1 fixture production deployed (a publish-path failure
 * if absent — the fixtures ship in `src/ExecuteMCPv2/Tests/`), and F5 can only
 * exhibit its contract while `%Service_DocDB` is DISABLED (an operator-enabled
 * instance skips that leg with a recorded reason even under IRIS_REQUIRE_LIVE —
 * the gate must never toggle an operator's service).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const IRIS_HOST = process.env.IRIS_HOST ?? "localhost";
const IRIS_PORT = process.env.IRIS_PORT ?? "52773";
const IRIS_USERNAME = process.env.IRIS_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_NAMESPACE ?? "HSCUSTOM";

const BASE_URL = "/api/executemcp/v2";

/**
 * Opt-in CI/packaging switch: when set, an unavailable environment is a hard
 * FAILURE rather than a skip. `scripts/prepublish-gate.mjs` sets it (in Node,
 * inherited by the spawned vitest — POSIX env-prefix syntax silently fails on
 * Windows, so it is deliberately NOT set in package.json).
 */
const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The leaf packages whose BUILT `dist/tools/index.js` this gate drives. */
const LEAF_PACKAGES = [
  "iris-dev-mcp",
  "iris-admin-mcp",
  "iris-data-mcp",
  "iris-interop-mcp",
] as const;

// Populated in beforeAll. Typed loosely: the dists are imported dynamically,
// so no static type surface crosses the package boundary here.
/* eslint-disable @typescript-eslint/no-explicit-any */
let shared: any;
let ctx: any;
let client: any;
const toolsByName = new Map<string, any>();
/* eslint-enable @typescript-eslint/no-explicit-any */

let skipReason: string | undefined;
/** F1-only degradation: the Story 35.1 fixture production is not deployed. */
let f1FixtureSkip: string | undefined;

/** The Story 35.1 durable fixture production + item (never started). */
const F1_PRODUCTION = "ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd";
const F1_ITEM = "FixtureOp";
const F1_MARKER = "epic35-gate-marker";

/** F8's imported-then-deleted fixture classes (created and cleaned up by the leg). */
const F8_COMPILED = "ExecuteMCPv2.Tests.Epic35GateXmlCompiled";
const F8_NOCOMPILE = "ExecuteMCPv2.Tests.Epic35GateXmlNoCompile";
const F8_MARKER = "epic35-gate-xml-ok";

function getConfig() {
  return shared.loadConfig({
    IRIS_HOST,
    IRIS_PORT,
    IRIS_USERNAME,
    IRIS_PASSWORD,
    IRIS_NAMESPACE,
    IRIS_HTTPS: "false",
  });
}

/**
 * Is the custom ExecuteMCPv2 REST service deployed? Mirrors the 35.2 wire
 * gate's probe: any HTTP response (even an error) proves deployment; only a
 * 404 means the endpoint itself is absent.
 */
async function customRestIsDeployed(): Promise<boolean> {
  try {
    await client.get(
      `${BASE_URL}/analytics/cubes?namespace=${encodeURIComponent(IRIS_NAMESPACE)}`,
    );
    return true;
  } catch (error: any) {
    if (error instanceof shared.IrisApiError) {
      return error.statusCode !== 404;
    }
    throw error;
  }
}

/**
 * Is the Story 35.1 fixture production deployed? Probed through the STOCK
 * Atelier `/doc/` surface, never through the endpoints under test (a gate must
 * not let a regression in the endpoint disguise itself as "fixture absent").
 * A genuine 404 is the ONLY legitimate "not deployed" signal; anything else
 * re-throws so `beforeAll` reports the real cause (Story 34.6 AC 34.6.3
 * discipline, ledger 34-4-R3).
 */
async function f1FixtureIsDeployed(version: number, ns: string): Promise<boolean> {
  try {
    await client.get(
      shared.atelierPath(
        version,
        ns,
        `doc/${encodeURIComponent(`${F1_PRODUCTION}.cls`)}`,
      ),
    );
    return true;
  } catch (error: any) {
    if (error instanceof shared.IrisApiError && error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

/** Per-test skip helper: log the reason, then mark the test skipped. */
function skip(testCtx: { skip: () => void }, leg: string, reason: string) {
  // eslint-disable-next-line no-console
  console.log(`[SKIP] epic35-defect-gate (${leg}): ${reason}`);
  testCtx.skip();
}

beforeAll(async () => {
  try {
    // 1. The shared dist — the gate drives IrisHttpClient/buildToolContext from
    //    the code that ships. iris-mcp-all has no direct @iris-mcp/shared
    //    dependency (pnpm strict resolution), so import by relative file URL,
    //    the same pattern scripts/lib/tool-catalog.mjs established.
    const sharedDist = path.join(REPO_ROOT, "packages", "shared", "dist", "index.js");
    if (!existsSync(sharedDist)) {
      skipReason =
        "@iris-mcp/shared is not built (packages/shared/dist/index.js absent). " +
        "Run `pnpm turbo run build` first.";
      throw new Error("__handled__");
    }
    shared = await import(pathToFileURL(sharedDist).href);

    // 2. The four leaf dists carrying the tools under test.
    for (const pkg of LEAF_PACKAGES) {
      const toolsDist = path.join(REPO_ROOT, "packages", pkg, "dist", "tools", "index.js");
      if (!existsSync(toolsDist)) {
        skipReason =
          `${pkg} is not built (${path.relative(REPO_ROOT, toolsDist)} absent). ` +
          "Run `pnpm turbo run build` first.";
        throw new Error("__handled__");
      }
      const mod = await import(pathToFileURL(toolsDist).href);
      for (const t of mod.tools ?? []) toolsByName.set(t.name, t);
    }

    // 3. IRIS reachability + version + tool context.
    const config = getConfig();
    client = new shared.IrisHttpClient(config);
    const available = await shared.ping(client, 3000);
    if (!available) {
      skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT} (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
      throw new Error("__handled__");
    }
    const version = await shared.negotiateVersion(client);
    ctx = shared.buildToolContext("NS", config, client, version);

    // 4. The custom REST app every leg drives.
    if (!(await customRestIsDeployed())) {
      skipReason =
        `ExecuteMCPv2's custom REST service is not deployed in ${IRIS_NAMESPACE} ` +
        `(404 from ${BASE_URL}/analytics/cubes). Load src/ExecuteMCPv2/ to run this gate.`;
      throw new Error("__handled__");
    }

    // 5. F1's fixture (per-leg degradation — the other legs do not need it).
    if (!(await f1FixtureIsDeployed(version, ctx.resolveNamespace()))) {
      f1FixtureSkip =
        `The Story 35.1 fixture production is not deployed in ${ctx.resolveNamespace()} ` +
        `(${F1_PRODUCTION} not found via the Atelier API). Load src/ExecuteMCPv2/Tests/ ` +
        "to run the F1 leg. The gate never creates production fixtures itself.";
    }
  } catch (error: any) {
    if (error?.message !== "__handled__") {
      skipReason = `Epic 35 gate availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(
      `IRIS_REQUIRE_LIVE is set, so the Epic 35 defect gate may not be skipped: ${skipReason}`,
    );
  }
}, 30000);

/** Resolve a tool from the leaf dists, failing the leg (never skipping) if absent. */
function gateTool(name: string): any {
  const t = toolsByName.get(name);
  if (!t) throw new Error(`gate setup error: tool ${name} not found in any leaf dist`);
  return t;
}

describe("Epic 35 defect gate — all nine corrected contracts, live (Story 35.8 AC 35.8.4)", () => {
  // ── F1 (Story 35.1, 35-SWEEP-1 HIGH) ──────────────────────────────────────
  // Guards: the Interop.cls composite-key path (`set` keyed by
  // (production, name), not name alone) + the durable `%Save()` + `SaveToClass`
  // dual-write — driven THROUGH the tool layer's `production` parameter. The
  // pre-fix `set` wrote whichever row a name-only lookup found first, so on a
  // fixture production that is NOT the namespace's active production the write
  // either failed or landed on the wrong row. RED proof: deployed-class revert
  // of Interop.cls to the pre-35.1 shape (see the story's Dev Agent Record).
  it("F1 — production_item get→set→get readback on the fixture production, with restore", async (testCtx) => {
    if (skipReason) return skip(testCtx, "F1", skipReason);
    if (f1FixtureSkip) {
      // A publish-gate run (IRIS_REQUIRE_LIVE=1) MUST have the test fixtures
      // deployed — a missing fixture there is a broken gate environment, not a
      // pass.
      if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set: ${f1FixtureSkip}`);
      return skip(testCtx, "F1", f1FixtureSkip);
    }
    const item = gateTool("iris_production_item");

    const before = await item.handler(
      { action: "get", itemName: F1_ITEM, production: F1_PRODUCTION },
      ctx,
    );
    expect(before.isError).toBeUndefined();
    const beforeSc = before.structuredContent as Record<string, unknown>;
    expect(beforeSc.itemName).toBe(F1_ITEM);
    expect(beforeSc.className).toBe("EnsLib.File.PassthroughOperation");
    const originalComment = (beforeSc.comment as string | undefined) ?? "";

    try {
      const set = await item.handler(
        {
          action: "set",
          itemName: F1_ITEM,
          production: F1_PRODUCTION,
          settings: { comment: F1_MARKER },
        },
        ctx,
      );
      expect(set.isError).toBeUndefined();
      const setSc = set.structuredContent as Record<string, unknown>;
      expect(setSc.production).toBe(F1_PRODUCTION);
      expect(setSc.updatedSettings).toEqual(["comment"]);

      // The readback is the composite-key proof: `get` with the SAME explicit
      // production must see the write.
      const after = await item.handler(
        { action: "get", itemName: F1_ITEM, production: F1_PRODUCTION },
        ctx,
      );
      expect(after.isError).toBeUndefined();
      expect((after.structuredContent as Record<string, unknown>).comment).toBe(F1_MARKER);
    } finally {
      // Always restore the fixture's baseline (empty comment), even on failure —
      // and fail LOUDLY if the restore itself fails (35.8 review, Blind B1): a
      // discarded restore result would leave the shared fixture mutated while
      // the leg reports GREEN, and the next run would then read the marker as
      // the "original" value and self-perpetuate the pollution.
      const restore = await item.handler(
        {
          action: "set",
          itemName: F1_ITEM,
          production: F1_PRODUCTION,
          settings: { comment: originalComment },
        },
        ctx,
      );
      if (restore.isError) {
        throw new Error(
          `F1 fixture restore FAILED — ${F1_PRODUCTION}/${F1_ITEM} comment may be ` +
            `polluted with the gate marker; restore it manually. Restore result: ` +
            JSON.stringify(restore.content),
        );
      }
    }
  }, 30000);

  // ── F2 (Story 35.2, 35-SWEEP-2 HIGH) ──────────────────────────────────────
  // Guards: the RAW wire body of Analytics.cls's build branch — the null-device
  // redirect around %DeepSee.Utils:%BuildCube. Deliberately a raw `fetch`
  // reading `arrayBuffer()`: the defect is prepended device bytes on the HTTP
  // stream, which any JSON-parsing client (and the tool handler) would mask.
  // RED proof: deployed-class revert of Analytics.cls (story Dev Agent Record).
  it("F2 — analytics_cubes:build on a nonexistent cube returns a raw wire body that parses as JSON (no prepended device text)", async (testCtx) => {
    if (skipReason) return skip(testCtx, "F2", skipReason);
    const config = getConfig();
    const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    const response = await fetch(`${config.baseUrl}${BASE_URL}/analytics/cubes`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        action: "build",
        cube: "ZZ_EPIC35_GATE_NO_SUCH_CUBE",
        namespace: IRIS_NAMESPACE,
      }),
    });
    expect(response.status).toBe(200);
    const text = new TextDecoder("utf-8").decode(
      new Uint8Array(await response.arrayBuffer()),
    );
    // The very first byte must be the envelope's opening brace — pre-fix the
    // body began "\r\nERROR #20013: ..." (device text prepended to the JSON).
    expect(text.charAt(0)).toBe("{");
    let envelope: any;
    expect(() => {
      envelope = JSON.parse(text);
    }).not.toThrow();
    // Sanity check: this must be the genuine "cube does not exist" error, not
    // some other parseable failure. Asserted on the cube NAME + the
    // untranslated substring, never on the locale-dependent prefix (Rule #13).
    expect(envelope.status.errors[0]?.error).toContain("ZZ_EPIC35_GATE_NO_SUCH_CUBE");
    expect(envelope.status.errors[0]?.error).toContain("does not exist");
  }, 30000);

  // ── F3 (Story 35.3, 35-SWEEP-3 MEDIUM) ────────────────────────────────────
  // Guards: the Accept-Language pin in packages/shared/src/http-client.ts —
  // Node's undici injects `Accept-Language: *` when the caller sets nothing,
  // and IRIS resolves `*` to the alphabetically-first locale (araw), so a
  // pre-fix tool-layer error renders a LOCALIZED prefix (live-captured:
  // "خطأ #5001") while a header-less curl got English. The fix pins
  // "en-US,en;q=0.9" by default. This leg drives an error through the tool
  // layer (the only surface carrying the header) and asserts the English
  // "ERROR #" prefix. RED proof: delete the header assignment in shared's
  // http-client.ts, rebuild shared, leg renders "خطأ #5001" → RED; restore →
  // GREEN (story Dev Agent Record).
  it("F3 — an erroring tool call renders the English `ERROR #` prefix through the tool layer (locale pinned)", async (testCtx) => {
    if (skipReason) return skip(testCtx, "F3", skipReason);
    const executeCommand = gateTool("iris_execute_command");
    const result = await executeCommand.handler({ command: "Set x = 1/0" }, ctx);
    expect(result.isError).toBe(true);
    const text = String(
      (result.content as Array<{ text: string }>)[0]?.text ?? "",
    );
    expect(text).toContain("ERROR #5001");
    // The pre-fix shape on this exact instance (undici's `Accept-Language: *`
    // resolving to the araw message table).
    expect(text).not.toContain("خطأ");
  }, 30000);

  // ── F4 (Story 35.4, 35-SWEEP-4 MEDIUM) ────────────────────────────────────
  // Guards: Security.cls's SqlPrivilegeList server-side cap + %All cross-product
  // collapse, driven through the tool layer's maxRows forwarding. _SYSTEM holds
  // %All, which pre-fix drew ~15,341 derived rows / ~2.9M chars (over the client
  // transport limit); post-fix the derived rows are omitted with a reason +
  // count, and maxRows bounds the real rows. RED proof: deployed-class revert
  // of Security.cls (story Dev Agent Record).
  it("F4 — listPrivileges with grantee=_SYSTEM and maxRows=5 returns 5 rows with rowsCapped and the %All omission note", async (testCtx) => {
    if (skipReason) return skip(testCtx, "F4", skipReason);
    const resourceManage = gateTool("iris_resource_manage");
    const result = await resourceManage.handler(
      { action: "listPrivileges", grantee: "_SYSTEM", maxRows: 5 },
      ctx,
    );
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as {
      privileges: Array<Record<string, unknown>>;
      rowsCapped?: boolean;
      superUserPrivilegesOmitted?: number;
      reason?: string;
    };
    expect(sc.privileges).toHaveLength(5);
    expect(sc.rowsCapped).toBe(true);
    expect(typeof sc.superUserPrivilegesOmitted).toBe("number");
    expect(sc.superUserPrivilegesOmitted).toBeGreaterThan(0);
    expect(sc.reason).toContain("%All");
  }, 30000);

  // ── F5 (Story 35.7, 35-SWEEP-5 MEDIUM) ────────────────────────────────────
  // Guards: docdb.ts's catch-path translation — a code-822 failure with a live
  // confirmation that %Service_DocDB is DISABLED becomes the actionable error
  // naming the service, the Management Portal path, iris_service_manage, and
  // the IRIS_GOVERNANCE override. The leg FIRST asserts the service is
  // disabled; if an operator has enabled it, the leg skips with a recorded
  // reason (even under IRIS_REQUIRE_LIVE — the contract under test is the
  // DISABLED-state translation, and the gate must never toggle an operator's
  // service). The skip is logged loudly so an always-enabled instance is
  // visible in the transcript. RED proof: source revert of the docdb.ts
  // translation + rebuild of @iris-mcp/data (story Dev Agent Record).
  it("F5 — docdb_manage:list on a disabled %Service_DocDB renders the actionable error", async (testCtx) => {
    if (skipReason) return skip(testCtx, "F5", skipReason);
    // Precondition, read live through the same route the translation consults.
    const svc = await client.get(
      `${BASE_URL}/security/service?name=${encodeURIComponent("%Service_DocDB")}`,
    );
    const enabled = (svc as any).result?.enabled;
    if (enabled === true) {
      return skip(
        testCtx,
        "F5",
        `%Service_DocDB is ENABLED on this instance (operator-enabled) — the disabled-service contract cannot be exhibited without toggling it, which this gate deliberately never does (Story 35.8 leg F5 rule).`,
      );
    }
    if (enabled !== false) {
      // Fail closed (35.8 review, Blind B2): an unreadable precondition shape
      // must never collapse into the operator-enabled skip — that would let a
      // broken /security/service route mask the very contract this leg guards,
      // even under IRIS_REQUIRE_LIVE.
      throw new Error(
        `F5 precondition unreadable: /security/service returned an unexpected ` +
          `shape for %Service_DocDB (enabled=${JSON.stringify(enabled)}). ` +
          "Refusing to guess — fix the route or the probe.",
      );
    }
    const docdbManage = gateTool("iris_docdb_manage");
    const result = await docdbManage.handler({ action: "list" }, ctx);
    expect(result.isError).toBe(true);
    const text = String(
      (result.content as Array<{ text: string }>)[0]?.text ?? "",
    );
    expect(text).toContain("ERROR #822");
    expect(text).toContain("%Service_DocDB");
    expect(text).toContain("Management Portal");
    expect(text).toContain("iris_service_manage");
    expect(text).toContain("IRIS_GOVERNANCE");
    expect(text).toContain("currently DISABLED");
  }, 30000);

  // ── F6 (Story 35.5, 35-SWEEP-6 MEDIUM) ────────────────────────────────────
  // Guards: Security.cls's validate-before-delegating precondition chain for
  // OAuth client create — a nonexistent serverName must fail with the clean
  // "No OAuth2 server definition exists for issuer ..." precondition error,
  // never IRIS's raw <PARAMETER>/<METHOD DOES NOT EXIST> from delegating
  // blindly. RED proof: deployed-class revert of Security.cls (story Dev Agent
  // Record).
  it("F6 — oauth_manage create-client with a nonexistent serverName fails with a clean precondition error (no <PARAMETER>)", async (testCtx) => {
    if (skipReason) return skip(testCtx, "F6", skipReason);
    const oauthManage = gateTool("iris_oauth_manage");
    const result = await oauthManage.handler(
      {
        action: "create",
        entity: "client",
        serverName: "https://no-such-issuer-epic35-gate.example.com/oauth2",
        clientName: "Epic35GateClient",
      },
      ctx,
    );
    expect(result.isError).toBe(true);
    const text = String(
      (result.content as Array<{ text: string }>)[0]?.text ?? "",
    );
    expect(text).toContain("No OAuth2 server definition exists for issuer");
    expect(text).toContain("no-such-issuer-epic35-gate.example.com");
    expect(text).not.toContain("<PARAMETER>");
    expect(text).not.toContain("<METHOD DOES NOT EXIST>");
  }, 30000);

  // ── F7 (Story 35.5, 35-SWEEP-7 MEDIUM) ────────────────────────────────────
  // Guards: interop rest.ts's `name` contract — the description must state the
  // package-name rule (the pre-fix description's own example used the REJECTED
  // `/myapi` path form), and the live rejected form must surface IRIS's clean
  // $ZNAME rejection verbatim. The description assertion drives the BUILT dist
  // (the text that ships). RED proof: source revert of the description in
  // interop rest.ts + rebuild of @iris-mcp/interop (story Dev Agent Record).
  it("F7 — interop_rest's name parameter documents the package-name contract, and the path form is rejected cleanly", async (testCtx) => {
    if (skipReason) return skip(testCtx, "F7", skipReason);
    const interopRest = gateTool("iris_interop_rest");
    const nameDescribe: string =
      interopRest.inputSchema.shape.name.description ?? "";
    expect(nameDescribe).toContain("package name");
    expect(nameDescribe).toContain("/myapi");
    expect(nameDescribe).toContain("rejected");

    const result = await interopRest.handler(
      {
        action: "create",
        name: "/epic35-gate-trap",
        spec: { swagger: "2.0", info: { title: "trap", version: "1" }, paths: {} },
      },
      ctx,
    );
    expect(result.isError).toBe(true);
    const text = String(
      (result.content as Array<{ text: string }>)[0]?.text ?? "",
    );
    expect(text).toContain("not a valid package name");
    expect(text).toContain("/epic35-gate-trap");
  }, 30000);

  // ── F8 (Story 35.6, 35-SWEEP-8 MEDIUM) ────────────────────────────────────
  // Guards: format.ts's compile parity for `iris_doc_xml_export:import` — the
  // `compile: true` fold of the `c` qualifier into the native Atelier `flags`
  // param. The leg imports a minimal class twice: compile omitted ⇒ the
  // "NOT compiled" note AND the class is genuinely NOT callable; compile:true
  // ⇒ callable through the classmethod route. Both fixture classes are deleted
  // in afterAll (and pre-deleted at leg start for crash residue). RED proof:
  // source revert of the flags forwarding in dev format.ts + rebuild of
  // @iris-mcp/dev (story Dev Agent Record).
  it("F8 — doc_xml_export import with compile:true produces a callable class; compile omitted states the NOT-compiled note", async (testCtx) => {
    if (skipReason) return skip(testCtx, "F8", skipReason);
    const xmlExport = gateTool("iris_doc_xml_export");
    const executeClassMethod = gateTool("iris_execute_classmethod");
    const docDelete = gateTool("iris_doc_delete");

    const mkXml = (cls: string) =>
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<Export generator="IRIS" version="26">\n` +
      `<Class name="${cls}">\n` +
      `<Super>%RegisteredObject</Super>\n` +
      `<Method name="GateMarker">\n` +
      `<ClassMethod>1</ClassMethod>\n` +
      `<ReturnType>%String</ReturnType>\n` +
      `<Implementation><![CDATA[ Quit "${F8_MARKER}" ]]></Implementation>\n` +
      `</Method>\n</Class>\n</Export>\n`;

    // Pre-clean any residue from a previous crashed run (both are gate-owned
    // names, created only by this leg).
    for (const cls of [F8_NOCOMPILE, F8_COMPILED]) {
      try {
        await docDelete.handler({ name: `${cls}.cls` }, ctx);
      } catch {
        /* absent is fine */
      }
    }

    // (1) compile omitted → the NOT-compiled note, and the class is genuinely
    //     NOT callable (the note must be TRUE, not just present).
    const noCompile = await xmlExport.handler(
      { action: "import", content: mkXml(F8_NOCOMPILE) },
      ctx,
    );
    expect(noCompile.isError).toBeUndefined();
    const blocks = (noCompile.content as Array<{ text: string }>).map((b) => b.text);
    expect(blocks.some((t) => t.includes("NOT compiled"))).toBe(true);
    const callUncompiled = await executeClassMethod.handler(
      { className: F8_NOCOMPILE, methodName: "GateMarker" },
      ctx,
    );
    expect(callUncompiled.isError).toBe(true);
    expect(String((callUncompiled.content as Array<{ text: string }>)[0]?.text ?? "")).toContain(
      "CLASS DOES NOT EXIST",
    );

    // (2) compile:true → the SAME import is callable through the classmethod
    //     route immediately.
    const compiled = await xmlExport.handler(
      { action: "import", content: mkXml(F8_COMPILED), compile: true },
      ctx,
    );
    expect(compiled.isError).toBeUndefined();
    const callCompiled = await executeClassMethod.handler(
      { className: F8_COMPILED, methodName: "GateMarker" },
      ctx,
    );
    expect(callCompiled.isError).toBeUndefined();
    expect(
      (callCompiled.structuredContent as { returnValue: string }).returnValue,
    ).toBe(F8_MARKER);
  }, 60000);

  // ── F9 (Story 35.6, 35-SWEEP-9 MEDIUM) ────────────────────────────────────
  // Guards: data rest.ts's legacy routing for `iris_rest_manage:get` — a legacy
  // %CSP.REST name (the Mgmnt API 404s it) must resolve to the legacy detail
  // shape with swaggerSpec:null, and the gateway's misleading "Check the IRIS
  // web server configuration" text must never surface. RED proof: source
  // revert of the legacy fallback in data rest.ts + rebuild of @iris-mcp/data
  // (story Dev Agent Record).
  it("F9 — rest_manage:get on the legacy /api/executemcp/v2 app returns the legacy detail shape with swaggerSpec null", async (testCtx) => {
    if (skipReason) return skip(testCtx, "F9", skipReason);
    const restManage = gateTool("iris_rest_manage");
    const result = await restManage.handler(
      { action: "get", application: "/api/executemcp/v2" },
      ctx,
    );
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as {
      name: string;
      dispatchClass: string;
      namespace: string;
      swaggerSpec: unknown;
      explanation?: string;
    };
    expect(sc.name).toBe("/api/executemcp/v2");
    expect(sc.dispatchClass).toBe("ExecuteMCPv2.REST.Dispatch");
    expect(sc.swaggerSpec).toBeNull();
    const allText = JSON.stringify(sc) +
      (result.content as Array<{ text: string }>).map((b) => b.text).join("\n");
    expect(allText).not.toContain("web server configuration");
  }, 30000);
});

afterAll(async () => {
  // F8 cleanup: delete both gate-owned fixture classes. Runs even when legs
  // were skipped (the deletes are harmless no-ops on absent docs) but NOT when
  // IRIS was never reachable (no client exists).
  if (skipReason || !ctx) return;
  try {
    const docDelete = gateTool("iris_doc_delete");
    for (const cls of [F8_NOCOMPILE, F8_COMPILED]) {
      try {
        await docDelete.handler({ name: `${cls}.cls` }, ctx);
      } catch {
        /* absent is fine */
      }
    }
  } catch {
    // Cleanup must never mask a leg result.
  }
});
