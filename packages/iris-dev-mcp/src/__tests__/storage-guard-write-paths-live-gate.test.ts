/**
 * Story 42.11 (AC 42.11.1 to 42.11.3, DW-652, Rule #59) - the Storage-drop guard on `iris_doc_load`, the `iris_doc_xml_export`
 * import and `iris_env_promote` execute, against a REAL IRIS.
 *
 * The unit suites (`load-storage-guard.test.ts`, `format-storage-guard.test.ts`, `env-promote-storage-guard.test.ts`) pin each
 * path against mocked HTTP. This gate drives the same handlers through the real `IrisHttpClient` and the real Atelier routes on
 * a persistent class that IRIS compiled (so it has `Storage Default`), and proves for each path, on the path it guards:
 *
 *  - leg 1, `iris_doc_load` default (the GET read): a file that drops the Storage is refused with STORAGE_DROPPED, its PUT is
 *    never sent, and the class's `ts`, content and Storage lines are unchanged;
 *  - leg 2, `iris_doc_load` with `ignoreConflict: false` (the 409 read): the same refusal after the one unversioned PUT, which
 *    Atelier answers with the 409 and stores nothing for;
 *  - leg 3, `iris_doc_load` with `allowStorageRegeneration`: the file is uploaded on the one `?ignoreConflict=1` PUT, `storageDrops`
 *    names the drop, and the stored class has no Storage block;
 *  - leg 4, the XML import of the tool's own export with its `<Storage>` element removed: refused before the `xml/load` POST, and
 *    the class is unchanged;
 *  - leg 5, the same import with the override: it loads, `storageDrops` names the drop, and the stored class has no Storage block;
 *  - leg 6, `iris_env_promote` execute where the source copy of the class lacks the Storage the target class has (the source
 *    client's GET answers IRIS's real document with its Storage block removed, which is what IRIS returns for a class saved
 *    without Storage): refused before the dialog and before any write, zero target PUT or POST, the target class unchanged;
 *  - leg 7, the same execute with the override: the class is promoted with the source text the preflight read, `storageDrops`
 *    names the drop, the PUT body has no Storage, and the compile that the promotion runs generates new storage on the target,
 *    which reads the properties in the order of the new text (the layout change the guard exists to stop).
 *
 * The expected texts come from the Story 42.11 Design Notes, never from the implementation (Rule #36).
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`, defaulting to the dev instance at
 * localhost:52773 / HSCUSTOM. Writes only the disposable `ExecuteMCPv2.Temp.QaStory4211Load.cls`, `...Xml.cls` and `...Prom.cls`
 * (persistent, compiled, no data rows) and a scratch directory under the OS temp directory. Before and after the run the gate
 * removes every document and every data global whose name contains `QaStory4211` and asserts that none is left. Skips when IRIS
 * is unreachable; fails instead when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IrisHttpClient,
  buildToolContext,
  loadConfig,
  negotiateVersion,
  ping,
  storageDefinitionNames,
  type IrisConnectionConfig,
  type ToolContext,
} from "@iris-mcp/shared";
import { docListTool } from "../tools/doc.js";
import { envPromoteTool } from "../tools/env-promote.js";
import { docXmlExportTool } from "../tools/format.js";
import { globalKillTool, globalListTool } from "../tools/global.js";
import { docLoadTool } from "../tools/load.js";
import { compileDocs, docPath, putDocLines, removeStored, type AtelierDocResult } from "./live-doc-helpers.js";

const IRIS_HOST = process.env.IRIS_HOST ?? "localhost";
const IRIS_PORT = process.env.IRIS_PORT ?? "52773";
const IRIS_USERNAME = process.env.IRIS_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_NAMESPACE ?? "HSCUSTOM";

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const PREFIX = "ExecuteMCPv2.Temp.QaStory4211";
const LOAD = `${PREFIX}Load`;
const XML = `${PREFIX}Xml`;
const PROM = `${PREFIX}Prom`;
const LOAD_DOC = `${LOAD}.cls`;
const XML_DOC = `${XML}.cls`;
const PROM_DOC = `${PROM}.cls`;
const ALL_DOCS = [LOAD_DOC, XML_DOC, PROM_DOC];

let skipReason: string | undefined;
let config: IrisConnectionConfig;
let client: IrisHttpClient;
/** A second client for the oracle reads, never spied on. */
let other: IrisHttpClient;
let version: number;
let ctx: ToolContext;

// -- Fixtures --------------------------------------------------------

/** A persistent class with no Storage (compiling it generates `Storage Default`), with its two properties in the given order. */
function classSource(className: string, first = "Alpha", second = "Beta"): string[] {
  return [`Class ${className} Extends %Persistent`, "{", "", `Property ${first} As %String;`, "", `Property ${second} As %String;`, "", "}"];
}

/** The lines of the first Storage definition of `content`: from its `Storage <name>` line to its closing `}`. */
function storageLines(content: string[]): string[] {
  const start = content.findIndex((line) => /^Storage \S+$/.test(line));
  if (start < 0) return [];
  const end = content.indexOf("}", start);
  return content.slice(start, end + 1);
}

/** `content` without its first Storage definition. */
function withoutStorage(content: string[]): string[] {
  const block = storageLines(content);
  if (block.length === 0) return [...content];
  const start = content.findIndex((line) => /^Storage \S+$/.test(line));
  return [...content.slice(0, start), ...content.slice(start + block.length)];
}

/** `content` with the two property declarations exchanged: a changed data layout once IRIS regenerates the storage. */
function withPropertiesSwapped(content: string[]): string[] {
  return content.map((line) =>
    line === "Property Alpha As %String;" ? "Property Beta As %String;" : line === "Property Beta As %String;" ? "Property Alpha As %String;" : line,
  );
}

/** The `<Value>` lines of the Storage in `content`, in order: the property order the stored layout reads. */
function storageValues(content: string[]): string[] {
  return storageLines(content).filter((line) => line.startsWith("<Value>"));
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

/** The documents IRIS lists for `QaStory4211`, generated documents included. */
async function listFixtureDocuments(): Promise<string[]> {
  const listed = await docListTool.handler({ filter: "QaStory4211", generated: true, namespace: IRIS_NAMESPACE }, ctx);
  expect(listed.isError, "the leftover listing").toBeUndefined();
  return (listed.structuredContent as { items: Array<{ name: string }> }).items.map((item) => item.name);
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
  storage: string[];
}

/** Everything a refused call must leave alone: the stored source, its `ts` and its Storage lines. */
async function snapshot(docName: string): Promise<Snapshot> {
  const read = (await other.get(docPath(version, IRIS_NAMESPACE, docName))).result as AtelierDocResult;
  return { ts: read.ts, content: read.content, storage: storageLines(read.content) };
}

/** The refusal text of `iris_doc_load` for `docName` that drops `subject`. */
function loadDroppedText(docName: string, subject: string): string {
  return (
    `Document '${docName}' was not saved in namespace '${IRIS_NAMESPACE}': the content drops ${subject} that the class has now, ` +
    "and IRIS would generate new storage at the next compile, which can change how existing rows are read. " +
    "Nothing was stored. Keep the Storage definitions in the file (read the class with iris_doc_get first), " +
    "or pass allowStorageRegeneration: true to let IRIS regenerate the storage."
  );
}

beforeAll(async () => {
  try {
    config = loadConfig({
      IRIS_HOST,
      IRIS_PORT,
      IRIS_USERNAME,
      IRIS_PASSWORD,
      IRIS_NAMESPACE,
      IRIS_HTTPS: "false",
    });
    client = new IrisHttpClient(config);
    other = new IrisHttpClient(config);
    if (!(await ping(client, 3000))) {
      skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT} (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    } else {
      version = await negotiateVersion(client);
      ctx = buildToolContext("NS", config, client, version);
    }
  } catch (error) {
    skipReason = `IRIS availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so this gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  await removeFixtures();
  expect(await listFixtureDocuments(), "no QaStory4211 document before the run").toEqual([]);
  expect(await listFixtureGlobals(), "no QaStory4211 global before the run").toEqual([]);
}, 60000);

afterAll(async () => {
  if (skipReason) return;
  await removeFixtures();
  expect(await listFixtureDocuments(), "no QaStory4211 document after the run").toEqual([]);
  expect(await listFixtureGlobals(), "no QaStory4211 global after the run").toEqual([]);
}, 60000);

afterEach(() => {
  vi.restoreAllMocks();
});

// -- iris_doc_load (legs 1 to 3) -------------------------------------

describe("iris_doc_load on a persistent class that has Storage (Story 42.11, AC 42.11.1 to 42.11.3)", () => {
  let sourceRoot: string;

  beforeEach(async () => {
    sourceRoot = mkdtempSync(path.join(realpathSync(tmpdir()), "qa-story-4211-load-"));
    mkdirSync(path.join(sourceRoot, "ExecuteMCPv2", "Temp"), { recursive: true });
    if (skipReason) return;
    await createFixture(LOAD);
  }, 60000);

  afterEach(() => {
    rmSync(sourceRoot, { recursive: true, force: true });
  });

  /** Write the file that would replace the class: its properties exchanged, and no Storage. */
  function writeFile(): string[] {
    const lines = classSource(LOAD, "Beta", "Alpha");
    writeFileSync(path.join(sourceRoot, "ExecuteMCPv2", "Temp", `${LOAD.split(".").pop()}.cls`), `${lines.join("\n")}\n`, "utf8");
    return lines;
  }

  function load(args: Record<string, unknown> = {}) {
    return docLoadTool.handler({ path: `${sourceRoot}/**/*.cls`, baseDir: sourceRoot, namespace: IRIS_NAMESPACE, ...args }, ctx);
  }

  const refusalOf = () => ({
    total: 1,
    uploaded: 0,
    failed: 1,
    failures: [
      {
        file: expect.stringContaining("QaStory4211Load.cls"),
        docName: LOAD_DOC,
        error: loadDroppedText(LOAD_DOC, "the Storage definition 'Default'"),
        code: "STORAGE_DROPPED",
        droppedStorage: ["Default"],
      },
    ],
  });

  it("leg 1, the GET read: a file that drops the Storage is refused, its PUT is never sent, and the class's ts, content and Storage lines are unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    writeFile();
    const before = await snapshot(LOAD_DOC);
    expect(before.storage[0], "the compiled class has Storage Default").toBe("Storage Default");
    const put = vi.spyOn(client, "put");
    const get = vi.spyOn(client, "get");

    const result = await load();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(refusalOf());
    expect(put, "no PUT was sent").not.toHaveBeenCalled();
    expect(get.mock.calls.map((call) => String(call[0])), "the class was read once").toEqual([docPath(version, IRIS_NAMESPACE, LOAD_DOC)]);
    const after = await snapshot(LOAD_DOC);
    expect(after.ts).toBe(before.ts);
    expect(after.content).toEqual(before.content);
    expect(after.storage).toEqual(before.storage);
  }, 90000);

  it("leg 2, the 409 read (ignoreConflict false): the same refusal after the one unversioned PUT, which IRIS answers with the 409 and stores nothing for", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    writeFile();
    const before = await snapshot(LOAD_DOC);
    const put = vi.spyOn(client, "put");

    const result = await load({ ignoreConflict: false });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(refusalOf());
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[0], "the unversioned PUT: no query").toBe(docPath(version, IRIS_NAMESPACE, LOAD_DOC));
    expect(put.mock.calls[0]?.[2], "no version header: the 409 is the read").toBeUndefined();
    const after = await snapshot(LOAD_DOC);
    expect(after.ts).toBe(before.ts);
    expect(after.content).toEqual(before.content);
    expect(after.storage).toEqual(before.storage);
  }, 90000);

  it("leg 3, the override: the file is uploaded on the one ?ignoreConflict=1 PUT, storageDrops names the drop, and the stored class has no Storage block", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    writeFile();
    const before = await snapshot(LOAD_DOC);
    const put = vi.spyOn(client, "put");

    const result = await load({ allowStorageRegeneration: true });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      total: 1,
      uploaded: 1,
      failed: 0,
      storageDrops: [{ name: LOAD_DOC, droppedStorage: ["Default"] }],
    });
    expect(result.content[0]?.text).toContain("Storage definitions dropped (allowStorageRegeneration; IRIS generates new storage at the next compile): " + `${LOAD_DOC} ('Default').`);
    expect(put.mock.calls.map((call) => String(call[0]))).toEqual([`${docPath(version, IRIS_NAMESPACE, LOAD_DOC)}?ignoreConflict=1`]);
    const after = await snapshot(LOAD_DOC);
    expect(after.ts).not.toBe(before.ts);
    expect(after.storage, "the stored class has no Storage block").toEqual([]);
    expect(storageDefinitionNames(after.content)).toEqual([]);
  }, 90000);
});

// -- the XML import (legs 4 and 5) -----------------------------------

describe("the iris_doc_xml_export import on a persistent class that has Storage (Story 42.11, AC 42.11.1 to 42.11.3)", () => {
  beforeEach(async () => {
    if (skipReason) return;
    await createFixture(XML);
  }, 60000);

  /** The tool's own export of the class, as the lines of the XML. */
  async function exportedXml(): Promise<string> {
    const exported = await docXmlExportTool.handler({ action: "export", docs: [XML_DOC], namespace: IRIS_NAMESPACE }, ctx);
    expect(exported.isError, "the export").toBeUndefined();
    const content = (exported.structuredContent as { content: string[] | string }).content;
    return Array.isArray(content) ? content.join("\n") : content;
  }

  /** The export with the class's `<Storage name="Default">` element removed. */
  async function exportWithoutStorage(): Promise<string> {
    const xml = await exportedXml();
    expect(xml, "the export carries the class's Storage element").toContain('<Storage name="Default">');
    const stripped = xml.replace(/<Storage name="Default">[\s\S]*?<\/Storage>/, "");
    expect(stripped).not.toBe(xml);
    expect(stripped).not.toContain("<Storage");
    return stripped;
  }

  it("leg 4: the import of the export without its Storage element is refused before the xml/load POST, and the class is unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const xml = await exportWithoutStorage();
    const before = await snapshot(XML_DOC);
    expect(before.storage[0]).toBe("Storage Default");
    const post = vi.spyOn(client, "post");
    const get = vi.spyOn(client, "get");

    const result = await docXmlExportTool.handler({ action: "import", content: xml, namespace: IRIS_NAMESPACE }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      `The XML was not imported into namespace '${IRIS_NAMESPACE}' and nothing was stored: it drops the Storage definition 'Default' of '${XML_DOC}' ` +
        "that the class has now, and IRIS would generate new storage at the next compile, which can change how existing rows are read. " +
        "Keep each class's Storage elements in the XML (export the classes with iris_doc_xml_export first), " +
        "or pass allowStorageRegeneration: true to let IRIS regenerate the storage.",
    );
    expect(result.structuredContent).toEqual({
      code: "STORAGE_DROPPED",
      namespace: IRIS_NAMESPACE,
      storageDrops: [{ name: XML_DOC, droppedStorage: ["Default"] }],
    });
    expect(post.mock.calls.filter((call) => String(call[0]).includes("action/xml/load")), "no xml/load POST").toEqual([]);
    expect(get.mock.calls.map((call) => String(call[0])), "the class was read once").toEqual([docPath(version, IRIS_NAMESPACE, XML_DOC)]);
    const after = await snapshot(XML_DOC);
    expect(after.ts).toBe(before.ts);
    expect(after.content).toEqual(before.content);
    expect(after.storage).toEqual(before.storage);
  }, 90000);

  it("leg 5, the override: the import loads, storageDrops names the drop, and the stored class has no Storage block", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const xml = await exportWithoutStorage();
    const before = await snapshot(XML_DOC);
    const post = vi.spyOn(client, "post");

    const result = await docXmlExportTool.handler(
      { action: "import", content: xml, namespace: IRIS_NAMESPACE, allowStorageRegeneration: true },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as { content: Array<{ imported: string[]; status: string }>; storageDrops: unknown };
    expect(structured.storageDrops).toEqual([{ name: XML_DOC, droppedStorage: ["Default"] }]);
    expect(structured.content[0]?.imported).toContain(XML_DOC);
    expect(structured.content[0]?.status).toBe("");
    expect(result.content.at(-1)?.text).toBe(
      "Storage definitions dropped (allowStorageRegeneration; IRIS generates new storage at the next compile): " + `${XML_DOC} ('Default').`,
    );
    expect(post.mock.calls.filter((call) => String(call[0]).includes("action/xml/load"))).toHaveLength(1);
    const after = await snapshot(XML_DOC);
    expect(after.ts).not.toBe(before.ts);
    expect(after.storage, "the stored class has no Storage block").toEqual([]);
  }, 90000);
});

// -- iris_env_promote execute (legs 6 and 7) -------------------------

describe("iris_env_promote execute on a persistent class that has Storage on the target (Story 42.11, AC 42.11.1 to 42.11.3)", () => {
  beforeEach(async () => {
    if (skipReason) return;
    await createFixture(PROM);
  }, 60000);

  /**
   * The source and target clients of one instance and namespace. The source client's GET of the fixture answers IRIS's real
   * document with its Storage block removed and its two properties exchanged: the document IRIS returns for a class saved
   * without Storage, in the other property order.
   */
  function twoClients(): { sourceClient: IrisHttpClient; targetClient: IrisHttpClient } {
    const sourceClient = new IrisHttpClient(config);
    const targetClient = new IrisHttpClient(config);
    const realGet = sourceClient.get.bind(sourceClient);
    vi.spyOn(sourceClient, "get").mockImplementation(async (getPath, options) => {
      const response = await realGet(getPath, options);
      if (!String(getPath).includes(`/doc/${encodeURIComponent(PROM_DOC)}`)) return response;
      const result = response.result as AtelierDocResult;
      return { ...response, result: { ...result, content: withPropertiesSwapped(withoutStorage(result.content)) } } as typeof response;
    });
    return { sourceClient, targetClient };
  }

  function promoteCtx(sourceClient: IrisHttpClient, targetClient: IrisHttpClient): ToolContext {
    return buildToolContext("NONE", config, client, version, undefined, async (profile) => {
      if (profile === "source") return sourceClient;
      if (profile === "target") return targetClient;
      throw new Error(`unexpected profile ${profile}`);
    });
  }

  function documentsDiff(): Record<string, unknown> {
    return {
      source: { profile: "source", namespace: IRIS_NAMESPACE },
      target: { profile: "target", namespace: IRIS_NAMESPACE },
      domains: { documents: { onlyInSource: [PROM_DOC], onlyInTarget: [], differs: [], identical: 0 } },
      summary: { driftCount: 1, identicalCount: 0 },
    };
  }

  async function execute(promote: ToolContext, extra: Record<string, unknown> = {}) {
    const diff = documentsDiff();
    const plan = await envPromoteTool.handler({ action: "plan", source: "source", target: "target", diff }, promote);
    const steps = (plan.structuredContent as { steps: Array<{ index: number; subject: string }> }).steps;
    expect(steps.map((step) => step.subject)).toEqual([PROM_DOC]);
    return envPromoteTool.handler(
      {
        action: "execute",
        source: "source",
        target: "target",
        diff,
        plan: plan.structuredContent,
        steps: steps.map((step) => step.index),
        confirm: true,
        namespace: IRIS_NAMESPACE,
        ...extra,
      },
      promote,
    );
  }

  it("leg 6: a source copy that lacks the target's Storage refuses the execute before any write: zero target PUT or POST, and the target class is unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await snapshot(PROM_DOC);
    expect(before.storage[0]).toBe("Storage Default");
    const { sourceClient, targetClient } = twoClients();
    const put = vi.spyOn(targetClient, "put");
    const post = vi.spyOn(targetClient, "post");

    const result = await execute(promoteCtx(sourceClient, targetClient));

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      `Promotion to server 'target', namespace '${IRIS_NAMESPACE}' was not run and no changes were made: it drops the Storage definition 'Default' of '${PROM_DOC}' ` +
        "that the class has now, and IRIS would generate new storage at the next compile, which can change how existing rows are read. " +
        "Promote source copies that keep those Storage definitions, or pass allowStorageRegeneration: true to let IRIS regenerate the storage on the target.",
    );
    expect(result.structuredContent).toEqual({
      code: "STORAGE_DROPPED",
      source: { profile: "source", namespace: IRIS_NAMESPACE },
      target: { profile: "target", namespace: IRIS_NAMESPACE },
      storageDrops: [{ name: PROM_DOC, droppedStorage: ["Default"] }],
    });
    expect(put, "no target PUT").not.toHaveBeenCalled();
    expect(post, "no target POST").not.toHaveBeenCalled();
    const after = await snapshot(PROM_DOC);
    expect(after.ts).toBe(before.ts);
    expect(after.content).toEqual(before.content);
    expect(after.storage).toEqual(before.storage);
  }, 90000);

  it("leg 7, the override: the class is promoted with the source text the preflight read, storageDrops names the drop, and the compile generates new storage in the new property order", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await snapshot(PROM_DOC);
    expect(storageValues(before.content), "the layout before: Alpha then Beta").toEqual([
      "<Value>%%CLASSNAME</Value>",
      "<Value>Alpha</Value>",
      "<Value>Beta</Value>",
    ]);
    const { sourceClient, targetClient } = twoClients();
    const put = vi.spyOn(targetClient, "put");
    const sourceGet = sourceClient.get as unknown as ReturnType<typeof vi.fn>;

    const result = await execute(promoteCtx(sourceClient, targetClient), { allowStorageRegeneration: true });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as {
      executed: Array<{ subject: string; status: string }>;
      summary: unknown;
      storageDrops: unknown;
    };
    expect(structured.executed.map((step) => [step.subject, step.status])).toEqual([[PROM_DOC, "completed"]]);
    expect(structured.summary).toEqual({ completed: 1, failed: 0, skipped: 0 });
    expect(structured.storageDrops).toEqual([{ name: PROM_DOC, droppedStorage: ["Default"] }]);
    expect(result.content[0]?.text.split("\n").at(-1)).toBe(
      "Storage definitions dropped (allowStorageRegeneration; IRIS generates new storage at the next compile): " + `${PROM_DOC} ('Default').`,
    );
    expect(
      sourceGet.mock.calls.filter((call) => String(call[0]).includes(`/doc/${encodeURIComponent(PROM_DOC)}`)),
      "the class was read from the source once: the PUT writes the text the preflight checked",
    ).toHaveLength(1);
    expect(put).toHaveBeenCalledTimes(1);
    const body = put.mock.calls[0]?.[1] as { content: string[] };
    expect(String(put.mock.calls[0]?.[0])).toBe(`${docPath(version, IRIS_NAMESPACE, PROM_DOC)}?ignoreConflict=1`);
    expect(storageLines(body.content), "the PUT body has no Storage").toEqual([]);
    expect(body.content).toContain("Property Beta As %String;");

    const after = await snapshot(PROM_DOC);
    expect(after.ts).not.toBe(before.ts);
    expect(storageValues(after.content), "the compile generated new storage, with the properties in the new order").toEqual([
      "<Value>%%CLASSNAME</Value>",
      "<Value>Beta</Value>",
      "<Value>Alpha</Value>",
    ]);
  }, 90000);
});

// Nothing left behind (Story 42.11, AC 42.11.3): the `beforeAll` and `afterAll` above remove the QaStory4211 fixtures
// and assert that no document, generated routine or global named QaStory4211 remains, whatever order the tests ran in.
