/**
 * Story 38.7 (QA) - the production-delete class check, and the document tools' burn-down changes, on the
 * REAL wire: a client, the BUILT server process, real HTTP, and the live IRIS.
 *
 * `InteropProductionDeleteTest` (IRIS-side) posts to the deployed route with `%Net.HttpRequest`, and
 * `production.test.ts` maps an invented error envelope to `isError`. Neither follows a call the way a client
 * makes it: an SDK `Client`, the built iris-interop-mcp server, its governance gate, its HTTP client, the
 * deployed `ExecuteMCPv2.REST.Interop` route, and back. This gate spawns the BUILT iris-interop-mcp and
 * iris-dev-mcp dists as child processes, connects the real MCP SDK `Client` over stdio to each, and proves:
 *
 *  - DW-533 (AC-2): `iris_production_manage` delete of a compiled class that is not a production is refused
 *    with `isError` and the matrix text, and the class still exists (read back over the raw Atelier route, not
 *    through the tools under test); a class saved but never compiled whose Super is `Ens.Production` is deleted
 *    and is gone; a name with neither a class nor a row keeps today's "does not exist" refusal. No production
 *    is ever started, and no `Ens.Config.Production` row is written.
 *  - DW-528 (AC-7): the three tools' `modifiedSince` parameter descriptions say it is refused and the tool
 *    descriptions no longer promise a filter, a call that sets it is the matrix refusal as a client sees it
 *    (`isError`, no structured content, no code), and an empty `modifiedSince` lists as before.
 *  - DW-542 (AC-5): a no-range `iris_doc_get` of a name IRIS answers with a soft error is `isError` carrying
 *    IRIS's reason, as a client sees it.
 *  - DW-549 (AC-6): `ignoreConflict: false` survives the MCP argument parsing and replaces an existing
 *    document (the stored text is the file's).
 *
 * Expected values come from the Story 38.7 intent contract (the texts and shapes) and from the live Atelier
 * route, never from the implementation (Rule #36). Before any test it asserts that the deployed `ExecuteMCPv2`
 * classes carry the `BOOTSTRAP_VERSION` of the built shared dist.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`, all required and none
 * defaulted, and only when `IRIS_REQUIRE_LIVE` arms the run (without it every test skips before any request); every call names `server: "default"` and the namespace. Writes only
 * the disposable `ExecuteMCPv2.Temp.QaStory387Wire*` documents (one compiled, one never compiled) and a scratch
 * directory under the OS temp directory; it removes them before and after the run and asserts that nothing
 * named `QaStory387Wire` is left.
 *
 * Placement (Rule #45): `@iris-mcp/all` spawns built dists. A missing or stale `shared`, `iris-dev-mcp` or
 * `iris-interop-mcp` dist, an unresolvable SDK or an unreachable IRIS skips each test with the reason, or fails
 * when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  assertDeployedBootstrapVersion,
  atelierDocument,
  docFixtures,
  irisTargetFromEnv,
  isIrisReachable,
  liveArmingSkipReason,
  openWireSession,
  resolveSdkEsmDir,
  staleDistReason,
  stemFixtures,
  type DocFixtures,
  type StemFixtures,
  type WireSession as Session,
  type WireSessionOptions,
} from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEV_ENTRY = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");
const INTEROP_ENTRY = path.join(REPO_ROOT, "packages", "iris-interop-mcp", "dist", "index.js");

const TARGET = irisTargetFromEnv();
const IRIS_HOST = TARGET.host;
const IRIS_PORT = TARGET.port;
const NS = TARGET.namespace;

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const STEM = "QaStory387Wire";
const PLAIN = `ExecuteMCPv2.Temp.${STEM}Plain`;
const DRAFT = `ExecuteMCPv2.Temp.${STEM}Draft`;
const MISSING = `ExecuteMCPv2.Temp.${STEM}Missing`;
const LOADED = `ExecuteMCPv2.Temp.${STEM}Loaded`;
const ALL_DOCS = [PLAIN, DRAFT, LOADED].map((name) => `${name}.cls`);

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let admin: Session;
let interop: Session;
let scratch = "";

/** The document helpers and the fixture oracle of `admin`, bound when called, so a teardown after a failed start-up still reaches the tools. */
const docs = (): DocFixtures => docFixtures(admin);
const fixtures = (): StemFixtures => stemFixtures(admin, STEM);

/** The built dev server's session options. */
function devOptions(): WireSessionOptions {
  return { sdkEsmDir: sdkEsmDir as string, entry: DEV_ENTRY, target: TARGET, clientName: "story-38-7-qa-wire-gate" };
}

const openSession = (): Promise<Session> => openWireSession(devOptions());

/** The class text of a fixture. */
function classText(className: string, superclass: string, marker: string): string {
  return [`Class ${className} Extends ${superclass}`, "{", "", `Property ${marker} As %String;`, "", "}"].join("\n");
}

async function removeFixtures(): Promise<void> {
  for (const docName of ALL_DOCS) await admin.call("iris_doc_delete", { name: docName });
}

/** Whether the raw Atelier route holds `docName`. */
async function stored(docName: string): Promise<boolean> {
  try {
    await atelierDocument(TARGET, docName);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("HTTP 404")) return false;
    throw error;
  }
}

beforeAll(async () => {
  const sharedStale = staleDistReason(REPO_ROOT, "shared");
  skipReason = liveArmingSkipReason() ?? sharedStale ?? staleDistReason(REPO_ROOT, "iris-dev-mcp");
  skipReason = skipReason ?? staleDistReason(REPO_ROOT, "iris-interop-mcp");
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    }
  }
  if (!skipReason && !(await isIrisReachable(IRIS_HOST, IRIS_PORT))) {
    skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT}/api/atelier/ (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 38.7 wire gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  admin = await openSession();
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  interop = await openWireSession({ ...devOptions(), entry: INTEROP_ENTRY, clientName: "story-38-7-qa-wire-gate-interop" });
  scratch = mkdtempSync(path.join(realpathSync(tmpdir()), "qa-story-387-wire-"));
  await removeFixtures();
  expect(await fixtures().documents(), "no QaStory387Wire document before the run").toEqual([]);
}, 120000);

afterAll(async () => {
  if (skipReason) return;
  try {
    if (admin) {
      await removeFixtures();
      expect(await fixtures().documents(), "no QaStory387Wire document after the run").toEqual([]);
    }
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    if (interop) await interop.close();
    if (admin) await admin.close();
  }
}, 90000);

// -- DW-533: the production delete only deletes a production class ---------

describe("iris_production_manage delete on the real wire (Story 38.7, DW-533, AC-2)", () => {
  it("a compiled class that is not a production is refused with the matrix text, and the class still exists", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    try {
      await docs().putDoc(`${PLAIN}.cls`, classText(PLAIN, "%RegisteredObject", "Alpha"));
      await docs().compileDoc(`${PLAIN}.cls`);
      expect(await stored(`${PLAIN}.cls`), "precondition: the class exists").toBe(true);

      const result = await interop.call("iris_production_manage", { action: "delete", name: PLAIN });

      expect(result.isError).toBe(true);
      expect(result.structuredContent, "a refusal carries no result").toBeUndefined();
      expect(result.content?.[0]?.text).toContain(
        `Class '${PLAIN}' is not a production class (it does not extend Ens.Production), so nothing was deleted. Name a production class.`,
      );
      expect(result.content?.[0]?.text).not.toContain('"action": "deleted"');
      expect(await stored(`${PLAIN}.cls`), "the class is still stored").toBe(true);
    } finally {
      await removeFixtures();
    }
  }, 90000);

  it("a class saved but never compiled whose Super is Ens.Production is deleted: the result says deleted, and the class is gone", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    try {
      await docs().putDoc(`${DRAFT}.cls`, classText(DRAFT, "Ens.Production", "Beta"));
      expect(await stored(`${DRAFT}.cls`), "precondition: the draft is stored").toBe(true);

      const result = await interop.call("iris_production_manage", { action: "delete", name: DRAFT });

      expect(result.isError, result.content?.[0]?.text).toBeFalsy();
      expect(result.structuredContent).toEqual({ action: "deleted", name: DRAFT });
      expect(await stored(`${DRAFT}.cls`), "the draft is gone").toBe(false);
    } finally {
      await removeFixtures();
    }
  }, 90000);

  it("a name with neither a class nor a row keeps the unchanged 'does not exist' refusal", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const result = await interop.call("iris_production_manage", { action: "delete", name: MISSING });

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain(`Production '${MISSING}' does not exist`);
    expect(await fixtures().documents(), "nothing was created").toEqual([]);
  }, 60000);
});

// -- DW-528: modifiedSince is refused ---------------------------------------

const MODIFIED_SINCE_PARAMETER =
  "Not supported: IRIS cannot filter documents by modification time, so a call that sets it is refused and changes nothing; " +
  "compare the ts of the documents iris_doc_list returns instead.";

function modifiedSinceRefusal(verb: "listed" | "exported" | "counted"): string {
  return (
    `modifiedSince is not supported, so nothing was ${verb}: IRIS has no way to list documents changed since a timestamp ` +
    "(its change list works from a database hash). " +
    "Omit modifiedSince; to find recent changes, list the documents with iris_doc_list and compare each one's ts."
  );
}

describe("modifiedSince on the three document tools, as a client sees it (Story 38.7, DW-528, AC-7)", () => {
  const TOOLS = [
    ["iris_doc_list", "listed"],
    ["iris_doc_export", "exported"],
    ["iris_package_list", "counted"],
  ] as const;

  it("tools/list describes the parameter as refused and no tool description still promises the filter", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const tools = await admin.listTools();
    for (const [name] of TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool, `${name} is listed`).not.toBeUndefined();
      const parameter = (tool?.inputSchema.properties?.["modifiedSince"] ?? {}) as { description?: string };
      expect(parameter.description, `${name} modifiedSince`).toBe(MODIFIED_SINCE_PARAMETER);
      expect(tool?.description ?? "", `${name} description`).not.toMatch(/modifiedSince|incremental|\/modified/i);
    }
  }, 60000);

  for (const [name, verb] of TOOLS) {
    it(`${name} with a non-empty modifiedSince answers the matrix refusal: isError, no structured content, no code, nothing written`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const destination = mkdtempSync(path.join(scratch, "refusal-"));
      const args: Record<string, unknown> =
        name === "iris_doc_export"
          ? { destinationDir: destination, prefix: `ExecuteMCPv2.Temp.${STEM}`, modifiedSince: "2026-01-01T00:00:00Z" }
          : name === "iris_doc_list"
            ? { filter: STEM, modifiedSince: "2026-01-01T00:00:00Z" }
            : { prefix: `ExecuteMCPv2.Temp.${STEM}`, modifiedSince: "2026-01-01T00:00:00Z" };

      const result = await admin.call(name, args);

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual([{ type: "text", text: modifiedSinceRefusal(verb) }]);
      expect(readdirSync(destination), "nothing is written to the export destination").toEqual([]);
    }, 60000);
  }

  it("iris_doc_list with modifiedSince empty lists a fixture exactly as with it absent", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    try {
      await docs().putDoc(`${PLAIN}.cls`, classText(PLAIN, "%RegisteredObject", "Gamma"));

      const absent = await admin.call("iris_doc_list", { filter: `${STEM}Plain` });
      const empty = await admin.call("iris_doc_list", { filter: `${STEM}Plain`, modifiedSince: "" });

      expect(absent.isError).toBeFalsy();
      expect(empty.structuredContent).toEqual(absent.structuredContent);
      expect((absent.structuredContent as { items: Array<{ name: string }> }).items.map((item) => item.name)).toEqual([`${PLAIN}.cls`]);
    } finally {
      await removeFixtures();
    }
  }, 60000);
});

// -- DW-542 and DW-549 through the MCP argument parsing ---------------------

describe("iris_doc_get and iris_doc_load, as a client calls them (Story 38.7, DW-542 and DW-549, AC-5 and AC-6)", () => {
  it("a no-range iris_doc_get of a name with no document type is isError carrying IRIS's reason, with no structured content", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const name = "ExecuteMCPv2.Utils";

    const result = await admin.call("iris_doc_get", { name });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = result.content?.[0]?.text ?? "";
    expect(text.startsWith(`Document '${name}' could not be read in namespace '${NS}': `)).toBe(true);
    expect(text).toContain("ERROR #");
    expect(text.endsWith("Check the document name and namespace, then retry.")).toBe(true);
  }, 60000);

  it("iris_doc_load with ignoreConflict false replaces an existing document: uploaded 1, and the stored text is the file's", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const sourceRoot = mkdtempSync(path.join(scratch, "load-"));
    try {
      await docs().putDoc(`${LOADED}.cls`, classText(LOADED, "%RegisteredObject", "Original"));
      const dir = path.join(sourceRoot, "ExecuteMCPv2", "Temp");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${STEM}Loaded.cls`), `${classText(LOADED, "%RegisteredObject", "FromFile")}\n`, "utf8");

      const result = await admin.call("iris_doc_load", { path: `${sourceRoot}/**/*.cls`, baseDir: sourceRoot, ignoreConflict: false });

      expect(result.isError, result.content?.[1]?.text).toBeFalsy();
      expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0 });
      const document = await atelierDocument(TARGET, `${LOADED}.cls`);
      expect(document.content.join("\n")).toContain("Property FromFile As %String;");
      expect(document.content.join("\n")).not.toContain("Property Original As %String;");
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      await removeFixtures();
    }
  }, 60000);
});
