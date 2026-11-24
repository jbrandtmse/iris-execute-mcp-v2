/**
 * Story 44.7 (AC DW-754, DW-755, DW-756; AD-14; Rules #48, #59) - the compile check of `iris_doc_compile`, `iris_doc_load` and
 * `iris_env_promote`, against a REAL IRIS.
 *
 * The defect: IRIS answers `action/compile` with HTTP 200, no status error and no per-document error when one class fails in a
 * compile that also writes the Storage of a persistent class (planning probe A, 2026-11-23, irishealth-community 2026.2), so the
 * three tools reported success. The tools now ask `verifyCompiled` (the class dictionary and IRIS's own up-to-date flag, no
 * localized text) after a compile that listed no error. The fixture of every leg is the same pair: a class that cannot compile
 * (an undefined macro) and a persistent class that has no Storage yet, so that the same compile writes it.
 *
 *  - leg 1, `iris_doc_compile` with the pair: `success` is false and `errors` names exactly the failing class;
 *  - leg 2, `iris_doc_compile` with a wildcard that matches the pair: the same, and the check asked about exactly the two classes;
 *  - leg 3, `iris_doc_compile` with a clean list: unchanged (`success` true, no `errors`), plus the check's two reads;
 *  - leg 4, `iris_doc_load` with `compile: true`: `compilationResult.success` is false and names the failing class;
 *  - leg 5, `iris_env_promote` execute: the failing class's step is `failed` and no later step is `completed`;
 *  - leg 6, the DW-756 evidence: the `iris_doc_xml_export` import with `compile: true` of the same pair carries a "Per-file status"
 *    block that names the failing class, so that tool needs no check;
 *  - legs 7 and 8, DW-759: a failing `.mac` routine in the same kind of compile (a persistent class whose Storage it writes) is
 *    named by `iris_doc_compile` and fails its step in `iris_env_promote`; IRIS's own up-to-date flag for the routine is the oracle,
 *    read raw from `docnames/RTN`. (`.inc` and `.int` documents have no such flag: the probe found it true after a failed compile.)
 *
 * Every leg proves its premise on the wire (Rule #59): the raw compile response, read from the `post` spy, lists no error in any
 * document, and the persistent class really has Storage after the compile. A gate whose premise did not hold would be green over
 * the path it does not guard. The expected texts come from the Story 44.7 spec, never from the implementation (Rule #36).
 *
 * Arming: runs only with `IRIS_REQUIRE_LIVE=1` (or `true`), against the target named by
 * `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (all required, none defaulted;
 * `@iris-mcp/shared/test-helpers/live-target`). Unarmed, every test skips before any request; armed, an unreachable IRIS
 * fails the gate instead of skipping it (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`). Writes only the disposable
 * `ExecuteMCPv2.Temp.QaStory447*` classes (no data rows) and a scratch directory under the OS temp directory. Before and after
 * the run the gate removes its classes and every data global whose name contains `QaStory447`, and asserts that none is left.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IrisHttpClient,
  buildToolContext,
  loadConfig,
  atelierPath,
  negotiateVersion,
  ping,
  storageDefinitionNames,
  verifyCompiled,
  type IrisConnectionConfig,
  type ToolContext,
} from "@iris-mcp/shared";
import { liveConnectionEnv, liveGateTarget } from "@iris-mcp/shared/test-helpers/live-target";
import { docCompileTool } from "../tools/compile.js";
import { notConfirmedText } from "../tools/compile-check.js";
import { docListTool } from "../tools/doc.js";
import { envPromoteTool } from "../tools/env-promote.js";
import { docXmlExportTool } from "../tools/format.js";
import { globalKillTool, globalListTool } from "../tools/global.js";
import { docLoadTool } from "../tools/load.js";
import { putDocLines, readStoredLines, removeStored } from "./live-doc-helpers.js";

const LIVE = liveGateTarget();
const IRIS_HOST = LIVE.target.host;
const IRIS_PORT = LIVE.target.port;
const IRIS_NAMESPACE = LIVE.target.namespace;

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const PREFIX = "ExecuteMCPv2.Temp.QaStory447";
const BAD = `${PREFIX}Bad`;
const PERS = `${PREFIX}Pers`;
const OK = `${PREFIX}Ok`;
const XML_BAD = `${PREFIX}XmlBad`;
const XML_PERS = `${PREFIX}XmlPers`;
const BAD_DOC = `${BAD}.cls`;
const PERS_DOC = `${PERS}.cls`;
const OK_DOC = `${OK}.cls`;
const XML_BAD_DOC = `${XML_BAD}.cls`;
const XML_PERS_DOC = `${XML_PERS}.cls`;
/** The routines of the DW-759 legs: one that cannot compile and one that can. */
const RTN_BAD = `${PREFIX}RtnBad`;
const RTN_OK = `${PREFIX}RtnOk`;
const RTN_BAD_DOC = `${RTN_BAD}.mac`;
const RTN_OK_DOC = `${RTN_OK}.mac`;
const ALL_DOCS = [BAD_DOC, PERS_DOC, OK_DOC, XML_BAD_DOC, XML_PERS_DOC, RTN_BAD_DOC, RTN_OK_DOC];
/** The names (without extension) of every document the gate writes, for the leftover listing. */
const ALL_CLASSES = [BAD, PERS, OK, XML_BAD, XML_PERS, RTN_BAD, RTN_OK];

let skipReason: string | undefined;
let config: IrisConnectionConfig;
let client: IrisHttpClient;
/** A second client for the oracle reads and the fixture writes, never spied on. */
let other: IrisHttpClient;
let version: number;
let ctx: ToolContext;

// -- Fixtures --------------------------------------------------------

/** A class that cannot compile: the macro is not defined. */
function badSource(className: string): string[] {
  return [`Class ${className}`, "{", "", "ClassMethod Hi() As %String", "{", "    Quit $$$NoSuchMacro447", "}", "", "}"];
}

/** A persistent class with no Storage: the compile that covers it writes its `Storage Default`. */
function persistentSource(className: string): string[] {
  return [`Class ${className} Extends %Persistent`, "{", "", "Property A As %String;", "", "}"];
}

/** A class that compiles. */
function okSource(className: string): string[] {
  return [`Class ${className}`, "{", "", "ClassMethod Hi() As %String", "{", "    Quit 1", "}", "", "}"];
}

/** A `.mac` routine that cannot compile (the macro is not defined), and one that can. */
function badRoutineSource(routine: string): string[] {
  return [`ROUTINE ${routine}`, " Write $$$NoSuchMacro447", " Quit"];
}
function okRoutineSource(routine: string): string[] {
  return [`ROUTINE ${routine}`, " Write 1", " Quit"];
}

/** The up-to-date flags (`upd`) that IRIS lists for the routines whose name contains `QaStory447`, read raw, by name. */
async function routineFlags(): Promise<Record<string, boolean>> {
  const listed = await other.get(atelierPath(version, IRIS_NAMESPACE, `docnames/RTN?filter=${encodeURIComponent(PREFIX)}`));
  const entries = (listed.result as { content?: Array<{ name: string; upd: boolean }> }).content ?? [];
  return Object.fromEntries(entries.map((entry) => [entry.name, entry.upd]));
}

// -- Cleanup ---------------------------------------------------------

/** The globals whose name contains `QaStory447`, with the caret IRIS lists them with. */
async function listFixtureGlobals(): Promise<string[]> {
  const listed = await globalListTool.handler({ filter: "QaStory447", namespace: IRIS_NAMESPACE }, ctx);
  expect(listed.isError, "the global listing").toBeUndefined();
  return (listed.structuredContent as { globals: string[] }).globals;
}

/** Kill every global whose name starts `ExecuteMCPv` and contains `QaStory447`. */
async function killFixtureGlobals(): Promise<void> {
  for (const listed of await listFixtureGlobals()) {
    const name = listed.replace(/^\^/, "");
    if (!name.startsWith("ExecuteMCPv") || !name.includes("QaStory447")) continue;
    const result = await globalKillTool.handler({ global: name, namespace: IRIS_NAMESPACE }, ctx);
    expect(result.isError, `killing global ${name}`).toBeUndefined();
  }
}

/** The documents of this gate's classes that IRIS lists, generated documents included. */
async function listFixtureDocuments(): Promise<string[]> {
  const listed = await docListTool.handler({ filter: "QaStory447", generated: true, namespace: IRIS_NAMESPACE }, ctx);
  expect(listed.isError, "the leftover listing").toBeUndefined();
  return (listed.structuredContent as { items: Array<{ name: string }> }).items
    .map((item) => item.name)
    .filter((name) => ALL_CLASSES.some((className) => name.startsWith(`${className}.`)));
}

/** Remove everything the gate writes: the data globals, then the documents. */
async function removeFixtures(): Promise<void> {
  await killFixtureGlobals();
  for (const docName of ALL_DOCS) await removeStored(other, version, IRIS_NAMESPACE, docName);
}

/** Start a leg from nothing: remove every fixture, then write `sources` (class name to lines) and no other. */
async function arrange(sources: Record<string, string[]>, routines: Record<string, string[]> = {}): Promise<void> {
  await removeFixtures();
  for (const [className, lines] of Object.entries(sources)) {
    await putDocLines(other, version, IRIS_NAMESPACE, `${className}.cls`, lines);
  }
  for (const [routine, lines] of Object.entries(routines)) {
    await putDocLines(other, version, IRIS_NAMESPACE, `${routine}.mac`, lines);
  }
}

/** The compile responses a spied `post` returned: only the calls to `action/compile`. */
async function compileEnvelopes(post: MockInstance): Promise<Array<{ result?: { content?: Array<{ name: string; errors?: unknown[] }> } }>> {
  const envelopes: Array<{ result?: { content?: Array<{ name: string; errors?: unknown[] }> } }> = [];
  post.mock.calls.forEach((call, index) => {
    if (String(call[0]).includes("action/compile")) envelopes.push(post.mock.results[index]?.value);
  });
  return Promise.all(envelopes);
}

/**
 * The premise of every leg (Rule #59): IRIS answered the compile without a status error (the client would have thrown) and
 * listed no error in any document, so that the old tools had nothing to report, and the persistent class has Storage now.
 */
async function expectCompileListedNothing(post: MockInstance, persistentDocs: string[]): Promise<void> {
  const envelopes = await compileEnvelopes(post);
  expect(envelopes.length, "one compile request was sent").toBe(1);
  const documents = envelopes[0]?.result?.content ?? [];
  expect(documents.length, "the compile answered per-document results").toBeGreaterThan(0);
  for (const document of documents) {
    expect(document.errors ?? [], `IRIS listed no error for ${document.name}`).toEqual([]);
  }
  for (const docName of persistentDocs) {
    const lines = await readStoredLines(other, version, IRIS_NAMESPACE, docName);
    expect(storageDefinitionNames(lines ?? []), `${docName} has Storage after the compile: the compile wrote it`).toEqual(["Default"]);
  }
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
  expect(await listFixtureDocuments(), "no document of this gate's QaStory447 classes before the run").toEqual([]);
  expect(await listFixtureGlobals(), "no QaStory447 global before the run").toEqual([]);
}, 60000);

afterAll(async () => {
  if (skipReason) return;
  await removeFixtures();
  expect(await listFixtureDocuments(), "no document of this gate's QaStory447 classes after the run").toEqual([]);
  expect(await listFixtureGlobals(), "no QaStory447 global after the run").toEqual([]);
}, 60000);

afterEach(() => {
  vi.restoreAllMocks();
});

// -- iris_doc_compile (legs 1 to 3) ----------------------------------

describe("iris_doc_compile: the compile check (Story 44.7, DW-754)", () => {
  type CompileResult = { success: boolean; documents: string[]; errors?: Array<{ document: string; error: string }> };

  it("leg 1: a failing class compiled with a persistent class whose Storage the compile writes is success:false and names exactly the failing class", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await arrange({ [BAD]: badSource(BAD), [PERS]: persistentSource(PERS) });
    const post = vi.spyOn(client, "post");

    const result = await docCompileTool.handler({ doc: [BAD_DOC, PERS_DOC], namespace: IRIS_NAMESPACE }, ctx);

    await expectCompileListedNothing(post, [PERS_DOC]);
    expect(result.isError).toBe(false);
    const structured = result.structuredContent as CompileResult;
    expect(structured.success).toBe(false);
    expect(structured.errors).toEqual([{ document: BAD_DOC, error: notConfirmedText(BAD_DOC) }]);
    expect(await verifyCompiled(other, IRIS_NAMESPACE, version, [BAD_DOC, PERS_DOC]), "the independent oracle names the same class").toEqual([BAD_DOC]);
  }, 90000);

  it("leg 2: a wildcard that matches both is checked on the classes it matched, and the result is the same", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await arrange({ [BAD]: badSource(BAD), [PERS]: persistentSource(PERS) });
    const post = vi.spyOn(client, "post");

    const result = await docCompileTool.handler({ doc: `${PREFIX}*.cls`, namespace: IRIS_NAMESPACE }, ctx);

    await expectCompileListedNothing(post, [PERS_DOC]);
    const structured = result.structuredContent as CompileResult;
    expect(structured.success).toBe(false);
    expect(structured.errors).toEqual([{ document: BAD_DOC, error: notConfirmedText(BAD_DOC) }]);
    const queries = post.mock.calls.filter((call) => String(call[0]).includes("action/query"));
    expect(queries, "one dictionary query").toHaveLength(1);
    expect(
      [...((queries[0]?.[1] as { parameters: string[] }).parameters)].sort(),
      "the check asked about exactly the two classes the pattern matched",
    ).toEqual([BAD, PERS].sort());
  }, 90000);

  it("leg 3: a clean compile is unchanged (success true, no errors) and adds only the check's two reads", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await arrange({ [OK]: okSource(OK), [PERS]: persistentSource(PERS) });
    const post = vi.spyOn(client, "post");
    const get = vi.spyOn(client, "get");

    const result = await docCompileTool.handler({ doc: [OK_DOC, PERS_DOC], namespace: IRIS_NAMESPACE }, ctx);

    expect(result.isError).toBe(false);
    const structured = result.structuredContent as CompileResult;
    expect(structured.success).toBe(true);
    expect(structured).not.toHaveProperty("errors");
    expect(structured.documents).toEqual([OK_DOC, PERS_DOC]);
    expect(post.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining("action/compile"),
      expect.stringContaining("action/query"),
    ]);
    expect(get.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringContaining("docnames/CLS?filter=ExecuteMCPv2.")]);
    expect(await verifyCompiled(other, IRIS_NAMESPACE, version, [OK_DOC, PERS_DOC])).toEqual([]);
  }, 90000);
});

// -- routines (legs 7 and 8, DW-759) ---------------------------------

describe("a failed .mac routine in a compile that also writes a class's Storage (Story 44.7, DW-759)", () => {
  type CompileResult = { success: boolean; errors?: Array<{ document: string; error: string }> };

  it("leg 7, iris_doc_compile: success is false and names exactly the failing routine; the routine's own up-to-date flag says the same", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await arrange({ [PERS]: persistentSource(PERS) }, { [RTN_BAD]: badRoutineSource(RTN_BAD), [RTN_OK]: okRoutineSource(RTN_OK) });
    const post = vi.spyOn(client, "post");

    const result = await docCompileTool.handler({ doc: [RTN_BAD_DOC, RTN_OK_DOC, PERS_DOC], namespace: IRIS_NAMESPACE }, ctx);

    await expectCompileListedNothing(post, [PERS_DOC]);
    expect(result.isError).toBe(false);
    const structured = result.structuredContent as CompileResult;
    expect(structured.success).toBe(false);
    expect(structured.errors).toEqual([{ document: RTN_BAD_DOC, error: notConfirmedText(RTN_BAD_DOC) }]);
    const flags = await routineFlags();
    expect(flags[RTN_BAD_DOC], "the failed routine is not up to date").toBe(false);
    expect(flags[RTN_OK_DOC], "the clean routine is").toBe(true);
  }, 90000);

  it("leg 8, iris_env_promote execute: the failing routine's step is failed, the class before it is completed, and the step after it is skipped", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await arrange({ [PERS]: persistentSource(PERS) }, { [RTN_BAD]: badRoutineSource(RTN_BAD), [RTN_OK]: okRoutineSource(RTN_OK) });
    const sourceClient = new IrisHttpClient(config);
    const targetClient = new IrisHttpClient(config);
    const targetPost = vi.spyOn(targetClient, "post");
    const promote = buildToolContext("NONE", config, client, version, undefined, async (profile) => {
      if (profile === "source") return sourceClient;
      if (profile === "target") return targetClient;
      throw new Error(`unexpected profile ${profile}`);
    });
    const diff = {
      source: { profile: "source", namespace: IRIS_NAMESPACE },
      target: { profile: "target", namespace: IRIS_NAMESPACE },
      domains: { documents: { onlyInSource: [PERS_DOC, RTN_BAD_DOC, RTN_OK_DOC], onlyInTarget: [], differs: [], identical: 0 } },
      summary: { driftCount: 3, identicalCount: 0 },
    };
    const plan = await envPromoteTool.handler({ action: "plan", source: "source", target: "target", diff }, promote);
    const steps = (plan.structuredContent as { steps: Array<{ index: number; subject: string }> }).steps;
    expect(steps.map((step) => step.subject), "the steps run in subject order").toEqual([PERS_DOC, RTN_BAD_DOC, RTN_OK_DOC]);

    const result = await envPromoteTool.handler(
      { action: "execute", source: "source", target: "target", diff, plan: plan.structuredContent, steps: steps.map((s) => s.index), confirm: true, namespace: IRIS_NAMESPACE },
      promote,
    );

    // The one batched compile covers the class (whose Storage it writes) and both routines, so IRIS answers it with nothing listed.
    await expectCompileListedNothing(targetPost, [PERS_DOC]);
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as { executed: Array<{ subject: string; status: string; error?: string }> };
    expect(structured.executed.map((step) => [step.subject, step.status])).toEqual([
      [PERS_DOC, "completed"],
      [RTN_BAD_DOC, "failed"],
      [RTN_OK_DOC, "skipped"],
    ]);
    expect(structured.executed[1]?.error).toBe(`compile error: ${notConfirmedText(RTN_BAD_DOC)}`);
    sourceClient.destroy();
    targetClient.destroy();
  }, 90000);
});

// -- iris_doc_load (leg 4) -------------------------------------------

describe("iris_doc_load with compile: true: the compile check (Story 44.7, DW-755)", () => {
  let sourceRoot: string | undefined;

  afterEach(() => {
    if (sourceRoot !== undefined) rmSync(sourceRoot, { recursive: true, force: true });
    sourceRoot = undefined;
  });

  it("leg 4: compilationResult.success is false and names the failing class", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await arrange({});
    sourceRoot = mkdtempSync(path.join(realpathSync(tmpdir()), "qa-story-447-load-"));
    const dir = path.join(sourceRoot, "ExecuteMCPv2", "Temp");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${BAD.split(".").pop()}.cls`), `${badSource(BAD).join("\n")}\n`, "utf8");
    writeFileSync(path.join(dir, `${PERS.split(".").pop()}.cls`), `${persistentSource(PERS).join("\n")}\n`, "utf8");
    const post = vi.spyOn(client, "post");

    const result = await docLoadTool.handler(
      { path: `${sourceRoot}/**/*.cls`, baseDir: sourceRoot, namespace: IRIS_NAMESPACE, compile: true },
      ctx,
    );

    await expectCompileListedNothing(post, [PERS_DOC]);
    expect(result.isError).toBe(false);
    const structured = result.structuredContent as {
      uploaded: number;
      compilationResult: { success: boolean; errors?: Array<{ document: string; error: string }> };
    };
    expect(structured.uploaded).toBe(2);
    expect(structured.compilationResult.success).toBe(false);
    expect(structured.compilationResult.errors).toEqual([{ document: BAD_DOC, error: notConfirmedText(BAD_DOC) }]);
  }, 90000);
});

// -- iris_env_promote execute (leg 5) --------------------------------

describe("iris_env_promote execute: the compile check (Story 44.7, DW-755)", () => {
  it("leg 5: the failing class's step is failed and no later step is completed", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await arrange({ [BAD]: badSource(BAD), [PERS]: persistentSource(PERS) });
    const sourceClient = new IrisHttpClient(config);
    const targetClient = new IrisHttpClient(config);
    const targetPost = vi.spyOn(targetClient, "post");
    const promote = buildToolContext("NONE", config, client, version, undefined, async (profile) => {
      if (profile === "source") return sourceClient;
      if (profile === "target") return targetClient;
      throw new Error(`unexpected profile ${profile}`);
    });
    const diff = {
      source: { profile: "source", namespace: IRIS_NAMESPACE },
      target: { profile: "target", namespace: IRIS_NAMESPACE },
      domains: { documents: { onlyInSource: [BAD_DOC, PERS_DOC], onlyInTarget: [], differs: [], identical: 0 } },
      summary: { driftCount: 2, identicalCount: 0 },
    };
    const plan = await envPromoteTool.handler({ action: "plan", source: "source", target: "target", diff }, promote);
    const steps = (plan.structuredContent as { steps: Array<{ index: number; subject: string }> }).steps;
    expect(steps.map((step) => step.subject), "the steps run in subject order: the failing class first").toEqual([BAD_DOC, PERS_DOC]);

    const result = await envPromoteTool.handler(
      {
        action: "execute",
        source: "source",
        target: "target",
        diff,
        plan: plan.structuredContent,
        steps: steps.map((step) => step.index),
        confirm: true,
        namespace: IRIS_NAMESPACE,
      },
      promote,
    );

    await expectCompileListedNothing(targetPost, [PERS_DOC]);
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as {
      executed: Array<{ subject: string; status: string; error?: string }>;
      summary: unknown;
    };
    expect(structured.executed.map((step) => [step.subject, step.status])).toEqual([
      [BAD_DOC, "failed"],
      [PERS_DOC, "skipped"],
    ]);
    expect(structured.executed[0]?.error).toBe(`compile error: ${notConfirmedText(BAD_DOC)}`);
    expect(structured.summary).toEqual({ completed: 0, failed: 1, skipped: 1 });
    sourceClient.destroy();
    targetClient.destroy();
  }, 90000);
});

// -- iris_doc_xml_export import (leg 6) ------------------------------

describe("iris_doc_xml_export import with compile: true: the evidence for closing DW-756 (Story 44.7)", () => {
  it("leg 6: the reply carries a Per-file status block that names the failing class, although the compile also wrote another class's Storage", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await arrange({});
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Export generator="IRIS" version="26">',
      `<Class name="${XML_BAD}">`,
      '<Method name="Hi">',
      "<ClassMethod>1</ClassMethod>",
      "<ReturnType>%String</ReturnType>",
      "<Implementation><![CDATA[",
      "    Quit $$$NoSuchMacro447",
      "]]></Implementation>",
      "</Method>",
      "</Class>",
      `<Class name="${XML_PERS}">`,
      "<Super>%Persistent</Super>",
      '<Property name="A">',
      "<Type>%String</Type>",
      "</Property>",
      "</Class>",
      "</Export>",
    ].join("\n");

    const result = await docXmlExportTool.handler({ action: "import", content: xml, compile: true, namespace: IRIS_NAMESPACE }, ctx);

    const texts = result.content.map((block) => block.text);
    const perFile = texts.filter((text) => text.startsWith("Per-file status"));
    expect(perFile, "the reply has a Per-file status block").toHaveLength(1);
    expect(perFile[0], "the block names the failing class").toContain(XML_BAD);
    const storedLines = await readStoredLines(other, version, IRIS_NAMESPACE, XML_PERS_DOC);
    expect(storageDefinitionNames(storedLines ?? []), "the same compile wrote the persistent class's Storage").toEqual(["Default"]);
    expect(await verifyCompiled(other, IRIS_NAMESPACE, version, [XML_BAD_DOC, XML_PERS_DOC]), "the independent oracle names the same class").toEqual([XML_BAD_DOC]);
  }, 90000);
});

// Nothing left behind: the `beforeAll` and `afterAll` above remove the QaStory447 fixtures and assert that no document or
// generated routine of this gate's classes, and no global named QaStory447, remains, whatever order the tests ran in.
