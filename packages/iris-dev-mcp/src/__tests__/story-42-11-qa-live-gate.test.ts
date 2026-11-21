/**
 * Story 42.11 (QA; AC 42.11.1 to 42.11.3, AD-15 "unchanged when nothing drops", Rules #3, #34, #59) - what the Storage guard does NOT
 * refuse, against a REAL IRIS.
 *
 * `storage-guard-write-paths-live-gate.test.ts` proves the refusals and the overrides on the real Atelier. The guard's other half is as
 * much a contract: a write that keeps every Storage definition of the class, and a write of a class that is new, must go through as they
 * did before the guard (AD-15), on the same real routes. A guard that misread IRIS's own class text, or refused every class that
 * has Storage, would pass every refusal leg and break every everyday save; this gate drives the three handlers through the real
 * `IrisHttpClient` on a persistent class that IRIS compiled (so it has `Storage Default`) and proves for each path:
 *
 *  - leg A, `iris_doc_load` default: a file that keeps the Storage and adds a property is uploaded on the one GET and the one
 *    `?ignoreConflict=1` PUT, the result is `{total, uploaded, failed}` with no `storageDrops` and no failure, and the stored class keeps
 *    its Storage definition;
 *  - leg B, `iris_doc_load` with `ignoreConflict: false`: the same file is saved on the real 409 and the one version-checked PUT;
 *  - leg C, `iris_doc_load` of a class IRIS does not have: the real answer to the guard's GET is HTTP 404, the class is created by the one
 *    PUT, and nothing is refused or named;
 *  - leg D, the XML import of the tool's own export, unchanged: one `xml/load` POST, `structuredContent` is the untouched API result (no
 *    `storageDrops`), and the class keeps its Storage definition;
 *  - leg E, `iris_env_promote` execute where the source copy keeps the target's Storage: no refusal, the dialog's scope is the plain one,
 *    the PUT body is the source text, the result has no `storageDrops`, and the target class keeps its Storage definition.
 *
 * Expected shapes come from the story's I/O matrix ("nothing dropped" rows), never from the implementation (Rule #36).
 *
 * Arming: runs only with `IRIS_REQUIRE_LIVE=1` (or `true`), against the target named by
 * `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (all required, none defaulted;
 * `@iris-mcp/shared/test-helpers/live-target`). Unarmed, every test skips before any request; armed, an
 * unreachable IRIS fails the gate instead of skipping it (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 * Writes only the disposable `ExecuteMCPv2.Temp.QaStory4211NdLoad.cls`, `...NdNew.cls`, `...NdXml.cls` and
 * `...NdProm.cls` (persistent, compiled, no data rows, except the one load creates and never compiles) and a scratch directory under the OS
 * temp directory. Before and after the run the gate removes its four classes and every data global whose name contains `QaStory4211`, and
 * asserts that no document of its classes and no such global is left (the write-paths gate's `QaStory4211{Load,Xml,Prom}` classes are not
 * counted, so the two gates never block each other).
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IrisApiError,
  IrisHttpClient,
  buildToolContext,
  loadConfig,
  negotiateVersion,
  ping,
  storageDefinitionNames,
  type IrisConnectionConfig,
  type ToolContext,
} from "@iris-mcp/shared";
import { liveConnectionEnv, liveGateTarget } from "@iris-mcp/shared/test-helpers/live-target";
import { docListTool } from "../tools/doc.js";
import { envPromoteTool } from "../tools/env-promote.js";
import { docXmlExportTool } from "../tools/format.js";
import { globalKillTool, globalListTool } from "../tools/global.js";
import { docLoadTool } from "../tools/load.js";
import { compileDocs, docPath, putDocLines, readStoredLines, removeStored, type AtelierDocResult } from "./live-doc-helpers.js";

const LIVE = liveGateTarget();
const IRIS_HOST = LIVE.target.host;
const IRIS_PORT = LIVE.target.port;
const IRIS_NAMESPACE = LIVE.target.namespace;

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const PREFIX = "ExecuteMCPv2.Temp.QaStory4211Nd";
const LOAD = `${PREFIX}Load`;
const NEW = `${PREFIX}New`;
const XML = `${PREFIX}Xml`;
const PROM = `${PREFIX}Prom`;
const LOAD_DOC = `${LOAD}.cls`;
const NEW_DOC = `${NEW}.cls`;
const XML_DOC = `${XML}.cls`;
const PROM_DOC = `${PROM}.cls`;
const ALL_DOCS = [LOAD_DOC, NEW_DOC, XML_DOC, PROM_DOC];

let skipReason: string | undefined;
let config: IrisConnectionConfig;
let client: IrisHttpClient;
/** A second client for the oracle reads, never spied on. */
let other: IrisHttpClient;
let version: number;
let ctx: ToolContext;

// -- Fixtures --------------------------------------------------------

/** A persistent class with no Storage (compiling it generates `Storage Default`). */
function classSource(className: string): string[] {
  return [`Class ${className} Extends %Persistent`, "{", "", "Property Alpha As %String;", "", "Property Beta As %String;", "", "}"];
}

/** `content` with one more property declared, and every other line, the Storage definition included, as it is. */
function withExtraProperty(content: string[]): string[] {
  const at = content.indexOf("Property Beta As %String;");
  expect(at, "the compiled class declares Property Beta").toBeGreaterThan(-1);
  return [...content.slice(0, at + 1), "", "Property Gamma As %String;", ...content.slice(at + 1)];
}

// -- Cleanup ---------------------------------------------------------

/** The globals whose name contains `QaStory4211`, with the caret IRIS lists them with. */
async function listFixtureGlobals(): Promise<string[]> {
  const listed = await globalListTool.handler({ filter: "QaStory4211", namespace: IRIS_NAMESPACE }, ctx);
  expect(listed.isError, "the global listing").toBeUndefined();
  return (listed.structuredContent as { globals: string[] }).globals;
}

/** Kill every global whose name starts `ExecuteMCPv` and contains `QaStory4211`. */
async function killFixtureGlobals(): Promise<void> {
  for (const listed of await listFixtureGlobals()) {
    const name = listed.replace(/^\^/, "");
    if (!name.startsWith("ExecuteMCPv") || !name.includes("QaStory4211")) continue;
    const result = await globalKillTool.handler({ global: name, namespace: IRIS_NAMESPACE }, ctx);
    expect(result.isError, `killing global ${name}`).toBeUndefined();
  }
}

/**
 * The documents of this gate's classes that IRIS lists, generated documents included. The other Story 42.11 gate's
 * `QaStory4211{Load,Xml,Prom}` classes are not this gate's, so either gate can run while the other's fixtures exist.
 */
async function listFixtureDocuments(): Promise<string[]> {
  const listed = await docListTool.handler({ filter: "QaStory4211", generated: true, namespace: IRIS_NAMESPACE }, ctx);
  expect(listed.isError, "the leftover listing").toBeUndefined();
  return (listed.structuredContent as { items: Array<{ name: string }> }).items
    .map((item) => item.name)
    .filter((name) => [LOAD, NEW, XML, PROM].some((className) => name.startsWith(`${className}.`)));
}

/** Remove everything the gate writes: the data globals, then the documents. */
async function removeFixtures(): Promise<void> {
  await killFixtureGlobals();
  for (const docName of ALL_DOCS) await removeStored(other, version, IRIS_NAMESPACE, docName);
}

/** A fresh persistent class: removed, written without Storage, and compiled, which generates its `Storage Default`. */
async function createFixture(className: string): Promise<void> {
  const docName = `${className}.cls`;
  await removeStored(other, version, IRIS_NAMESPACE, docName);
  await putDocLines(other, version, IRIS_NAMESPACE, docName, classSource(className));
  await compileDocs(other, version, IRIS_NAMESPACE, [docName]);
}

interface Snapshot {
  ts: string;
  content: string[];
  storageNames: string[];
}

/** The stored class as the oracle client reads it: its `ts`, its lines and the names of its Storage definitions. */
async function snapshot(docName: string): Promise<Snapshot> {
  const read = (await other.get(docPath(version, IRIS_NAMESPACE, docName))).result as AtelierDocResult;
  return { ts: read.ts, content: read.content, storageNames: storageDefinitionNames(read.content) };
}

beforeAll(async () => {
  skipReason = LIVE.skipReason;
  if (skipReason === undefined) {
    try {
      config = loadConfig(liveConnectionEnv(LIVE.target));
      client = new IrisHttpClient(config);
      other = new IrisHttpClient(config);
      if (!(await ping(client, 3000))) {
        skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT} (check IRIS_HOST/IRIS_PORT).`;
      } else {
        version = await negotiateVersion(client);
        ctx = buildToolContext("NS", config, client, version);
      }
    } catch (error) {
      skipReason = `IRIS availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so this gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  await removeFixtures();
  expect(await listFixtureDocuments(), "no document of this gate's QaStory4211Nd classes before the run").toEqual([]);
  expect(await listFixtureGlobals(), "no QaStory4211 global before the run").toEqual([]);
}, 60000);

afterAll(async () => {
  if (skipReason) return;
  await removeFixtures();
  expect(await listFixtureDocuments(), "no document of this gate's QaStory4211Nd classes after the run").toEqual([]);
  expect(await listFixtureGlobals(), "no QaStory4211 global after the run").toEqual([]);
}, 60000);

afterEach(() => {
  vi.restoreAllMocks();
});

// -- iris_doc_load (legs A to C) -------------------------------------

describe("iris_doc_load of a class that keeps its Storage, and of a new class (Story 42.11 QA, nothing dropped)", () => {
  let sourceRoot: string;

  beforeEach(async () => {
    sourceRoot = mkdtempSync(path.join(realpathSync(tmpdir()), "qa-story-4211-nd-"));
    mkdirSync(path.join(sourceRoot, "ExecuteMCPv2", "Temp"), { recursive: true });
  });

  afterEach(() => {
    rmSync(sourceRoot, { recursive: true, force: true });
  });

  /** Write the file at `Temp/<stem>.cls` of the scratch tree. */
  function writeFile(className: string, lines: string[]): void {
    writeFileSync(path.join(sourceRoot, "ExecuteMCPv2", "Temp", `${className.split(".").pop()}.cls`), `${lines.join("\n")}\n`, "utf8");
  }

  function load(args: Record<string, unknown> = {}) {
    return docLoadTool.handler({ path: `${sourceRoot}/**/*.cls`, baseDir: sourceRoot, namespace: IRIS_NAMESPACE, ...args }, ctx);
  }

  it("leg A, default: a file that keeps the Storage and adds a property is uploaded on the one GET and the one ?ignoreConflict=1 PUT, and the class keeps its Storage", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await createFixture(LOAD);
    const before = await snapshot(LOAD_DOC);
    expect(before.storageNames, "the compiled class has Storage Default").toEqual(["Default"]);
    const edited = withExtraProperty(before.content);
    writeFile(LOAD, edited);
    const put = vi.spyOn(client, "put");
    const get = vi.spyOn(client, "get");

    const result = await load();

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0 });
    expect(get.mock.calls.map((call) => String(call[0])), "the class was read once").toEqual([docPath(version, IRIS_NAMESPACE, LOAD_DOC)]);
    expect(put.mock.calls.map((call) => String(call[0])), "one unconditional PUT").toEqual([`${docPath(version, IRIS_NAMESPACE, LOAD_DOC)}?ignoreConflict=1`]);
    const after = await snapshot(LOAD_DOC);
    expect(after.ts).not.toBe(before.ts);
    expect(after.content).toContain("Property Gamma As %String;");
    expect(after.storageNames, "the stored class keeps its Storage definition").toEqual(["Default"]);
  }, 90000);

  it("leg B, ignoreConflict false: the same file is saved on the real 409 and the one version-checked PUT, and the class keeps its Storage", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await createFixture(LOAD);
    const before = await snapshot(LOAD_DOC);
    writeFile(LOAD, withExtraProperty(before.content));
    const put = vi.spyOn(client, "put");
    const get = vi.spyOn(client, "get");

    const result = await load({ ignoreConflict: false });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0 });
    expect(get.mock.calls, "the 409 is the read: no GET").toEqual([]);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[0]?.[0], "the unversioned PUT: no query").toBe(docPath(version, IRIS_NAMESPACE, LOAD_DOC));
    expect(put.mock.calls[0]?.[2], "no version header on the first PUT").toBeUndefined();
    expect(put.mock.calls[1]?.[2], "the second PUT is checked against the version the 409 carried").toEqual({ headers: { "If-None-Match": before.ts } });
    const after = await snapshot(LOAD_DOC);
    expect(after.content).toContain("Property Gamma As %String;");
    expect(after.storageNames).toEqual(["Default"]);
  }, 90000);

  it("leg C, a class IRIS does not have: the guard's GET is a real HTTP 404, the one PUT creates the class, and nothing is refused or named", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await removeStored(other, version, IRIS_NAMESPACE, NEW_DOC);
    writeFile(NEW, classSource(NEW));
    const put = vi.spyOn(client, "put");
    const get = vi.spyOn(client, "get");

    const result = await load();

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0 });
    expect(get).toHaveBeenCalledTimes(1);
    await expect(get.mock.results[0]?.value, "IRIS answers the read of a class it does not have with HTTP 404").rejects.toBeInstanceOf(IrisApiError);
    await expect(get.mock.results[0]?.value).rejects.toMatchObject({ statusCode: 404 });
    expect(put.mock.calls.map((call) => String(call[0]))).toEqual([`${docPath(version, IRIS_NAMESPACE, NEW_DOC)}?ignoreConflict=1`]);
    expect(await readStoredLines(other, version, IRIS_NAMESPACE, NEW_DOC), "the class was created").toEqual(expect.arrayContaining([`Class ${NEW} Extends %Persistent`]));
  }, 90000);
});

// -- the XML import (leg D) ------------------------------------------

describe("the iris_doc_xml_export import of the tool's own export, unchanged (Story 42.11 QA, nothing dropped)", () => {
  it("leg D: one xml/load POST, the untouched API result with no storageDrops, and the class keeps its Storage", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await createFixture(XML);
    const exported = await docXmlExportTool.handler({ action: "export", docs: [XML_DOC], namespace: IRIS_NAMESPACE }, ctx);
    expect(exported.isError, "the export").toBeUndefined();
    const content = (exported.structuredContent as { content: string[] | string }).content;
    const xml = Array.isArray(content) ? content.join("\n") : content;
    expect(xml, "the export carries the class's Storage element").toContain('<Storage name="Default">');
    const before = await snapshot(XML_DOC);
    const post = vi.spyOn(client, "post");
    const get = vi.spyOn(client, "get");

    const result = await docXmlExportTool.handler({ action: "import", content: xml, namespace: IRIS_NAMESPACE }, ctx);

    expect(result.isError).toBeUndefined();
    expect(post.mock.calls.filter((call) => String(call[0]).includes("action/xml/load")), "one xml/load POST").toHaveLength(1);
    expect(get.mock.calls.map((call) => String(call[0])), "the class was read once").toEqual([docPath(version, IRIS_NAMESPACE, XML_DOC)]);
    const structured = result.structuredContent as { content: Array<{ imported: string[]; status: string }> };
    expect(structured).not.toHaveProperty("storageDrops");
    expect(Object.keys(structured)).toEqual(["content"]);
    expect(structured.content[0]?.imported).toContain(XML_DOC);
    expect(structured.content[0]?.status).toBe("");
    expect(result.content.map((block) => block.text).join("\n")).not.toContain("Storage definitions dropped");
    const after = await snapshot(XML_DOC);
    expect(after.storageNames, "the class keeps its Storage definition").toEqual(before.storageNames);
    expect(after.storageNames).toEqual(["Default"]);
  }, 90000);
});

// -- iris_env_promote execute (leg E) --------------------------------

describe("iris_env_promote execute of a class whose source copy keeps the target's Storage (Story 42.11 QA, nothing dropped)", () => {
  it("leg E: no refusal, the plain dialog scope, the PUT body is the source text, no storageDrops, and the target class keeps its Storage", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await createFixture(PROM);
    const before = await snapshot(PROM_DOC);
    expect(before.storageNames).toEqual(["Default"]);
    const sourceClient = new IrisHttpClient(config);
    const targetClient = new IrisHttpClient(config);
    const put = vi.spyOn(targetClient, "put");
    const promote = buildToolContext("NONE", config, client, version, undefined, async (profile) => {
      if (profile === "source") return sourceClient;
      if (profile === "target") return targetClient;
      throw new Error(`unexpected profile ${profile}`);
    });
    const confirm = vi.fn<NonNullable<ToolContext["confirm"]>>(async () => ({ proceed: true }));
    promote.confirm = confirm;
    const diff = {
      source: { profile: "source", namespace: IRIS_NAMESPACE },
      target: { profile: "target", namespace: IRIS_NAMESPACE },
      domains: { documents: { onlyInSource: [], onlyInTarget: [], differs: [{ name: PROM_DOC, sourceHash: "a".repeat(64), targetHash: "b".repeat(64), sourceTs: "t1", targetTs: "t2" }], identical: 0 } },
      summary: { driftCount: 1, identicalCount: 0 },
    };
    const planned = await envPromoteTool.handler({ action: "plan", source: "source", target: "target", diff }, promote);
    const steps = (planned.structuredContent as { steps: Array<{ index: number; subject: string }> }).steps;
    expect(steps.map((step) => step.subject)).toEqual([PROM_DOC]);

    const result = await envPromoteTool.handler(
      {
        action: "execute",
        source: "source",
        target: "target",
        diff,
        plan: planned.structuredContent,
        steps: steps.map((step) => step.index),
        confirm: true,
        namespace: IRIS_NAMESPACE,
      },
      promote,
    );

    expect(result.isError, JSON.stringify(result.structuredContent)).toBeFalsy();
    const structured = result.structuredContent as { executed: Array<{ subject: string; status: string }>; summary: unknown };
    expect(structured.executed.map((step) => [step.subject, step.status])).toEqual([[PROM_DOC, "completed"]]);
    expect(structured.summary).toEqual({ completed: 1, failed: 0, skipped: 0 });
    expect(Object.keys(structured)).toEqual(["source", "target", "planHash", "executed", "summary"]);
    expect(result.content[0]?.text).not.toContain("Storage definitions dropped");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toEqual({
      operation: "promote changes to another server",
      target: `server 'target', namespace ${IRIS_NAMESPACE}`,
      scope: `1 step(s) from server 'source': #1 documents putAndCompile ${PROM_DOC}`,
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(String(put.mock.calls[0]?.[0])).toBe(`${docPath(version, IRIS_NAMESPACE, PROM_DOC)}?ignoreConflict=1`);
    expect((put.mock.calls[0]?.[1] as { content: string[] }).content, "the PUT body is the source copy").toEqual(before.content);
    const after = await snapshot(PROM_DOC);
    expect(after.storageNames, "the target class keeps its Storage definition").toEqual(["Default"]);
  }, 90000);
});

// Nothing left behind (Story 42.11 QA): the `beforeAll` and `afterAll` above remove the QaStory4211 fixtures and assert that no
// document or generated routine of this gate's classes, and no global named QaStory4211, remains, whatever order the tests ran in.
