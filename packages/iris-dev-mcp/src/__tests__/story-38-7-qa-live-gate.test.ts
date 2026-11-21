/**
 * Story 38.7 (QA) - three burn-down fixes proven against a REAL IRIS, where the story's own tests use
 * fakes or sit on a happy path.
 *
 * The unit tests (`doc.test.ts`, `export.test.ts`, `packages.test.ts`, `load.test.ts`,
 * `env-promote-execute.test.ts`) pin the handlers against mocked HTTP, and the live gates of Stories
 * 38.0 to 38.3 cover the uploads. This gate drives the same handlers through the real `IrisHttpClient`
 * and the real Atelier routes, so the properties below are proven where they happen:
 *
 *  - DW-528: a non-empty `modifiedSince` on `iris_doc_list`, `iris_doc_export` and `iris_package_list`
 *    is refused, and the real wire sees NO request at all (the global `fetch` the client sends every
 *    request through is spied on, and an unrefused call proves the spy can see traffic). A refused
 *    export writes nothing to its destination. An absent or empty `modifiedSince` lists exactly as
 *    before, through `/docnames/`, never `/modified`.
 *  - DW-549: `iris_doc_load` with `ignoreConflict: false` sends one PUT for a new document, two for an
 *    existing one (the second carrying the 409's `ts`), and when the document changes on the server
 *    between the two PUTs IRIS's own 409 on the version-checked save becomes a per-file
 *    `DOCUMENT_CONFLICT` with no third PUT, while the other files continue and only the other writer's
 *    text is stored. The default (`true`) path stays one unconditional `?ignoreConflict=1` PUT.
 *  - DW-530: `iris_env_promote` execute, when IRIS answers the target PUT of a document with HTTP 200
 *    and a non-empty `result.status` (a refusal IRIS itself produces: the request body's first line is
 *    not a class header, `ERROR #16021: Illegal Header Line`, live-captured 2026-10-15), fails that step
 *    with the hedged text, skips the rest, and never compiles. The same plan with the body untouched
 *    completes, so the failure is caused by IRIS's status and nothing else.
 *
 * The expected texts come from the Story 38.7 intent contract (its I/O and edge-case matrix), never
 * from the implementation (Rule #36).
 *
 * Arming: runs only with `IRIS_REQUIRE_LIVE=1` (or `true`), against the target named by
 * `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (all required, none defaulted;
 * `@iris-mcp/shared/test-helpers/live-target`). Unarmed, every test skips before any request; armed, an
 * unreachable IRIS fails the gate instead of skipping it (listed in `scripts/prepublish-gate.mjs`
 * `gateTestFiles`). Writes only the disposable
 * `ExecuteMCPv2.Temp.QaStory387*` documents (two of them compiled by the promote control), removed before
 * and after every test, and a scratch directory under the OS temp directory.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IrisHttpClient,
  buildToolContext,
  loadConfig,
  negotiateVersion,
  ping,
  type IrisConnectionConfig,
  type ToolContext,
} from "@iris-mcp/shared";
import { liveConnectionEnv, liveGateTarget } from "@iris-mcp/shared/test-helpers/live-target";
import { docListTool } from "../tools/doc.js";
import { docExportTool } from "../tools/export.js";
import { docLoadTool } from "../tools/load.js";
import { packageListTool } from "../tools/packages.js";
import { envPromoteTool } from "../tools/env-promote.js";
import { putDocLines, readStoredLines, removeStored, type AtelierDocResult } from "./live-doc-helpers.js";

const LIVE = liveGateTarget();
const IRIS_HOST = LIVE.target.host;
const IRIS_PORT = LIVE.target.port;
const IRIS_NAMESPACE = LIVE.target.namespace;

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const STEM = "ExecuteMCPv2.Temp.QaStory387";
const MOD_DOC = `${STEM}Mod.cls`;
const LOAD_A = `${STEM}LoadA`;
const LOAD_B = `${STEM}LoadB`;
const LOAD_C = `${STEM}LoadC`;
const PROM_A = `${STEM}PromA`;
const PROM_B = `${STEM}PromB`;
const ALL_DOCS = [MOD_DOC, ...[LOAD_A, LOAD_B, LOAD_C, PROM_A, PROM_B].map((name) => `${name}.cls`)];

let skipReason: string | undefined;
let config: IrisConnectionConfig;
let client: IrisHttpClient;
/** A second client for the "other writer" and the oracle reads, never spied on. */
let other: IrisHttpClient;
let version: number;
let ctx: ToolContext;

/** The class text a fixture document holds (plain, uncompiled unless a test compiles it). */
function classLines(className: string, marker: string): string[] {
  return [`Class ${className} Extends %RegisteredObject`, "{", "", `Property ${marker} As %String;`, "", "}"];
}

/** A fixture class as IRIS returns it: a stored class ends with one trailing empty element (live shape, 38.2 gate). */
function storedClass(className: string, marker: string): string[] {
  return [...classLines(className, marker), ""];
}

async function readStored(docName: string): Promise<string[] | undefined> {
  return readStoredLines(other, version, IRIS_NAMESPACE, docName);
}

async function removeAll(): Promise<void> {
  for (const docName of ALL_DOCS) await removeStored(other, version, IRIS_NAMESPACE, docName);
}

/**
 * Names of every document under this gate's fixture stem, generated documents included. The `QaStory387Wire`
 * documents belong to the `@iris-mcp/all` wire gate, which may run at the same time, so they are not counted.
 */
async function leftovers(): Promise<string[]> {
  const listed = await docListTool.handler({ filter: "QaStory387", generated: true, namespace: IRIS_NAMESPACE }, ctx);
  expect(listed.isError, "the leftover listing").toBeUndefined();
  const items = (listed.structuredContent as { items: Array<{ name: string }> }).items;
  return items.map((item) => item.name).filter((name) => !name.includes("QaStory387Wire"));
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
  await removeAll();
  expect(await leftovers(), "no QaStory387 document before the run").toEqual([]);
}, 60000);

afterAll(async () => {
  if (skipReason) return;
  await removeAll();
  expect(await leftovers(), "no QaStory387 document after the run").toEqual([]);
}, 60000);

beforeEach(async () => {
  if (skipReason) return;
  await removeAll();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (skipReason) return;
  await removeAll();
});

// -- DW-528 --------------------------------------------------------------

/** The matrix text of the `modifiedSince` refusal for a tool that `verb` its documents. */
function modifiedSinceRefusal(verb: "listed" | "exported" | "counted"): string {
  return (
    `modifiedSince is not supported, so nothing was ${verb}: IRIS has no way to list documents changed since a timestamp ` +
    "(its change list works from a database hash). " +
    "Omit modifiedSince; to find recent changes, list the documents with iris_doc_list and compare each one's ts."
  );
}

describe("modifiedSince is refused on the real wire (Story 38.7, DW-528, AC-7)", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(path.join(realpathSync(tmpdir()), "qa-story-387-export-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  for (const [toolName, verb] of [
    ["iris_doc_list", "listed"],
    ["iris_doc_export", "exported"],
    ["iris_package_list", "counted"],
  ] as const) {
    it(`${toolName} with a non-empty modifiedSince sends no request, answers the matrix refusal, and changes nothing`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      await putDocLines(other, version, IRIS_NAMESPACE, MOD_DOC, classLines(`${STEM}Mod`, "Alpha"));
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      for (const modifiedSince of ["2026-01-01T00:00:00Z", "yesterday"]) {
        const result =
          toolName === "iris_doc_list"
            ? await docListTool.handler({ filter: "QaStory387", modifiedSince, namespace: IRIS_NAMESPACE }, ctx)
            : toolName === "iris_doc_export"
              ? await docExportTool.handler(
                  { destinationDir: scratch, prefix: STEM, modifiedSince, namespace: IRIS_NAMESPACE },
                  ctx,
                )
              : await packageListTool.handler({ prefix: STEM, modifiedSince, namespace: IRIS_NAMESPACE }, ctx);

        expect(result, `${toolName} ${modifiedSince}`).toEqual({
          content: [{ type: "text", text: modifiedSinceRefusal(verb) }],
          isError: true,
        });
      }

      expect(fetchSpy, `${toolName} made a request although it refused`).not.toHaveBeenCalled();
      expect(readdirSync(scratch), "a refused export writes nothing to its destination").toEqual([]);
      expect(await readStored(MOD_DOC), "the fixture document is untouched").toEqual(storedClass(`${STEM}Mod`, "Alpha"));
    }, 60000);
  }

  it("iris_doc_list with modifiedSince absent or empty lists the fixture through /docnames/, identically, and never touches /modified", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await putDocLines(other, version, IRIS_NAMESPACE, MOD_DOC, classLines(`${STEM}Mod`, "Alpha"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const absent = await docListTool.handler({ filter: "QaStory387Mod", namespace: IRIS_NAMESPACE }, ctx);
    const empty = await docListTool.handler({ filter: "QaStory387Mod", modifiedSince: "", namespace: IRIS_NAMESPACE }, ctx);

    expect(absent.isError).toBeUndefined();
    expect(empty).toEqual(absent);
    const items = (absent.structuredContent as { items: Array<{ name: string }> }).items;
    expect(items.map((item) => item.name)).toEqual([MOD_DOC]);
    const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
    expect(urls.length, "the spy sees the listing requests (so the zero above means something)").toBeGreaterThanOrEqual(2);
    expect(urls.filter((url) => /\/docnames\//.test(url))).toHaveLength(urls.length);
    expect(urls.some((url) => /\/modified/.test(url)), "no request goes to /modified").toBe(false);
  }, 60000);
});

// -- DW-549 --------------------------------------------------------------

/** The per-file text of a version-checked save that lost to a concurrent change (Story 38.7 intent contract). */
const CONFLICT_ERROR =
  "The document changed on the server while this tool was saving it, so nothing was stored. " +
  "Run iris_doc_load again to replace the current version.";

describe("iris_doc_load ignoreConflict on the real wire (Story 38.7, DW-549, AC-6)", () => {
  let sourceRoot: string;

  beforeEach(() => {
    sourceRoot = mkdtempSync(path.join(realpathSync(tmpdir()), "qa-story-387-load-"));
    mkdirSync(path.join(sourceRoot, "ExecuteMCPv2", "Temp"), { recursive: true });
  });

  afterEach(() => {
    rmSync(sourceRoot, { recursive: true, force: true });
  });

  /** Write the source file of `className` (a class of this gate) and return its path. */
  function writeSource(className: string, marker: string): string {
    const file = path.join(sourceRoot, "ExecuteMCPv2", "Temp", `${className.split(".").pop()}.cls`);
    writeFileSync(file, `${classLines(className, marker).join("\n")}\n`, "utf8");
    return file;
  }

  interface PutCall {
    doc: string;
    query: string;
    versionHeader: string | undefined;
  }

  /** Spy on the client's PUTs (recording each) and run `onFirst409` for the first 409 of the document named `conflictDoc`. */
  function spyOnPuts(conflictDoc: string | undefined, onFirst409: (staleTs: string) => Promise<void>): PutCall[] {
    const calls: PutCall[] = [];
    const realPut = client.put.bind(client);
    let fired = false;
    vi.spyOn(client, "put").mockImplementation(async (putPath, body, options) => {
      const [pathPart, query = ""] = String(putPath).split("?");
      const doc = decodeURIComponent(pathPart?.split("/doc/")[1] ?? "");
      calls.push({ doc, query, versionHeader: options?.headers?.["If-None-Match"] });
      try {
        return await realPut(putPath, body, options);
      } catch (error) {
        const result = (error as { statusCode?: number; result?: AtelierDocResult }).result;
        if (!fired && doc === conflictDoc && (error as { statusCode?: number }).statusCode === 409 && result) {
          fired = true;
          await onFirst409(result.ts);
        }
        throw error;
      }
    });
    return calls;
  }

  it("a change between the unversioned and the version-checked PUT is a per-file DOCUMENT_CONFLICT after exactly two PUTs, while a second existing file and a new file are uploaded", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    for (const name of [LOAD_A, LOAD_B]) {
      await putDocLines(other, version, IRIS_NAMESPACE, `${name}.cls`, classLines(name, "Original"));
    }
    writeSource(LOAD_A, "FromTool");
    writeSource(LOAD_B, "FromTool");
    writeSource(LOAD_C, "FromTool");
    const otherWriter = classLines(LOAD_A, "FromOtherWriter");
    const calls = spyOnPuts(`${LOAD_A}.cls`, async (staleTs) => {
      // The document changes between this tool's first request and its second: a save by another writer.
      await putDocLines(other, version, IRIS_NAMESPACE, `${LOAD_A}.cls`, otherWriter, { "If-None-Match": staleTs });
    });

    const result = await docLoadTool.handler(
      { path: `${sourceRoot}/**/*.cls`, baseDir: sourceRoot, ignoreConflict: false, namespace: IRIS_NAMESPACE },
      ctx,
    );

    expect(result.isError, "one file failed, two uploaded").toBeFalsy();
    expect(result.structuredContent).toEqual({
      total: 3,
      uploaded: 2,
      failed: 1,
      failures: [
        {
          file: expect.stringContaining("QaStory387LoadA.cls"),
          docName: `${LOAD_A}.cls`,
          error: CONFLICT_ERROR,
          code: "DOCUMENT_CONFLICT",
        },
      ],
    });
    const byDoc = (doc: string): PutCall[] => calls.filter((call) => call.doc === doc);
    expect(byDoc(`${LOAD_A}.cls`), "the conflicting file: the unversioned PUT and one version-checked PUT, never a third").toHaveLength(2);
    expect(byDoc(`${LOAD_A}.cls`)[0]?.versionHeader).toBeUndefined();
    expect(byDoc(`${LOAD_A}.cls`)[1]?.versionHeader).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(byDoc(`${LOAD_B}.cls`), "an existing file that did not conflict: two PUTs").toHaveLength(2);
    expect(byDoc(`${LOAD_B}.cls`)[1]?.versionHeader).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(byDoc(`${LOAD_C}.cls`), "a new file: one PUT, no version").toEqual([
      { doc: `${LOAD_C}.cls`, query: "", versionHeader: undefined },
    ]);
    expect(calls.map((call) => call.query), "no PUT carries ignoreConflict on the false path").toEqual(["", "", "", "", ""]);

    expect(await readStored(`${LOAD_A}.cls`), "only the other writer's text is stored for the conflicting file").toEqual(
      storedClass(LOAD_A, "FromOtherWriter"),
    );
    expect((await readStored(`${LOAD_B}.cls`))?.join("\n")).toContain("Property FromTool As %String;");
    expect((await readStored(`${LOAD_C}.cls`))?.join("\n")).toContain("Property FromTool As %String;");
  }, 90000);

  it("the default ignoreConflict (true) replaces an existing document with ONE unconditional ?ignoreConflict=1 PUT, byte-identical to before", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await putDocLines(other, version, IRIS_NAMESPACE, `${LOAD_A}.cls`, classLines(LOAD_A, "Original"));
    writeSource(LOAD_A, "FromTool");
    const calls = spyOnPuts(undefined, async () => {});

    const result = await docLoadTool.handler(
      { path: `${sourceRoot}/**/*.cls`, baseDir: sourceRoot, namespace: IRIS_NAMESPACE },
      ctx,
    );

    expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0 });
    expect(calls).toEqual([{ doc: `${LOAD_A}.cls`, query: "ignoreConflict=1", versionHeader: undefined }]);
    expect((await readStored(`${LOAD_A}.cls`))?.join("\n")).toContain("Property FromTool As %String;");
  }, 60000);
});

// -- DW-530 --------------------------------------------------------------

describe("iris_env_promote execute on a target PUT that IRIS answers with HTTP 200 and a status (Story 38.7, DW-530, AC-8)", () => {
  /** A diff with the two fixture documents on the source only (the shape `iris_env_diff` returns for new documents). */
  function documentsDiff(): Record<string, unknown> {
    return {
      source: { profile: "source", namespace: IRIS_NAMESPACE },
      target: { profile: "target", namespace: IRIS_NAMESPACE },
      domains: { documents: { onlyInSource: [`${PROM_A}.cls`, `${PROM_B}.cls`], onlyInTarget: [], differs: [], identical: 0 } },
      summary: { driftCount: 2, identicalCount: 0 },
    };
  }

  interface Executed {
    subject: string;
    status: "completed" | "failed" | "skipped";
    error?: string;
  }

  /** Run plan then execute on the two documents with a real source client and a real target client. */
  async function promote(targetClient: IrisHttpClient): Promise<{
    result: Awaited<ReturnType<typeof envPromoteTool.handler>>;
    executed: Executed[];
  }> {
    const promoteCtx = buildToolContext("NONE", config, client, version, undefined, async (profile) => {
      if (profile === "source") return new IrisHttpClient(config);
      if (profile === "target") return targetClient;
      throw new Error(`unexpected profile ${profile}`);
    });
    const diff = documentsDiff();
    const plan = await envPromoteTool.handler({ action: "plan", source: "source", target: "target", diff }, promoteCtx);
    const steps = (plan.structuredContent as { steps: Array<{ index: number; subject: string }> }).steps;
    expect(steps.map((step) => step.subject), "plan orders the documents by name").toEqual([`${PROM_A}.cls`, `${PROM_B}.cls`]);
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
      promoteCtx,
    );
    return { result, executed: (result.structuredContent as { executed: Executed[] }).executed };
  }

  beforeEach(async () => {
    if (skipReason) return;
    for (const name of [PROM_A, PROM_B]) {
      await putDocLines(other, version, IRIS_NAMESPACE, `${name}.cls`, classLines(name, "Source"));
    }
  });

  it("control: with the target PUT bodies untouched, both documents are put and compiled once, and both steps complete", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const targetClient = new IrisHttpClient(config);
    const compile = vi.spyOn(targetClient, "post");

    const { result, executed } = await promote(targetClient);

    expect(result.isError).toBeFalsy();
    expect(executed.map((step) => [step.subject, step.status])).toEqual([
      [`${PROM_A}.cls`, "completed"],
      [`${PROM_B}.cls`, "completed"],
    ]);
    const compiles = compile.mock.calls.filter((call) => String(call[0]).includes("/action/compile"));
    expect(compiles, "one batched compile").toHaveLength(1);
    expect(compiles[0]?.[1]).toEqual([`${PROM_A}.cls`, `${PROM_B}.cls`]);
  }, 90000);

  it("a document IRIS refuses inside an HTTP 200 envelope fails its step with the hedged text, skips the rest, never compiles, and stores nothing for it", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const targetClient = new IrisHttpClient(config);
    const realPut = targetClient.put.bind(targetClient);
    // The second document's body reaches IRIS with a first line that is not a class header: IRIS itself answers
    // HTTP 200 with result.status "ERROR #16021: Illegal Header Line" and stores nothing.
    vi.spyOn(targetClient, "put").mockImplementation(async (putPath, body, options) => {
      if (String(putPath).includes(encodeURIComponent(`${PROM_B}.cls`))) {
        const content = (body as { content: string[] }).content;
        return realPut(putPath, { ...(body as object), content: ["this is not a class header", ...content] }, options);
      }
      return realPut(putPath, body, options);
    });
    const compile = vi.spyOn(targetClient, "post");

    const { result, executed } = await promote(targetClient);

    expect(result.isError).toBe(true);
    expect(executed.map((step) => [step.subject, step.status])).toEqual([
      [`${PROM_A}.cls`, "skipped"],
      [`${PROM_B}.cls`, "failed"],
    ]);
    const failed = executed[1] as Executed;
    expect(failed.error).toMatch(
      new RegExp(
        `^IRIS reported an error after the write of '${PROM_B}\\.cls' to the target: ERROR #16021[^]*\\. ` +
          "The document may have been saved on the target; check it with iris_doc_get before running iris_env_promote again\\.$",
      ),
    );
    expect(
      compile.mock.calls.filter((call) => String(call[0]).includes("/action/compile")),
      "no compile after a failed put",
    ).toHaveLength(0);
    expect(await readStored(`${PROM_B}.cls`), "IRIS stored nothing for the refused document").toEqual(
      storedClass(PROM_B, "Source"),
    );
  }, 90000);
});
