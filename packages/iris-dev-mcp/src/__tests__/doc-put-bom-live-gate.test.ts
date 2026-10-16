/**
 * Story 38.0 (ledger DW-485, AC-1) - `iris_doc_put` and `iris_doc_load` against a REAL IRIS.
 *
 * The unit tests in `doc.test.ts` and `load.test.ts` pin the handlers against mocked HTTP. This
 * gate drives the same handlers through the real `IrisHttpClient` and the real Atelier `PUT /doc`
 * route, so the two properties AC-1 is about are proven where they happen:
 *
 *  - a leading BOM never reaches the wire (IRIS refuses a BOM-prefixed first line and stores
 *    nothing, so a stored document with a BOM-free first line is the proof);
 *  - a document IRIS refuses inside an HTTP 200 envelope (`result.status` a non-empty string,
 *    `status.errors` empty) is reported as an error and nothing is stored.
 *
 * The refusal input is a first line that is not a class header (`ERROR #16021: Illegal Header
 * Line`, live-captured 2026-10-15, IRIS 2026.2, Atelier v8): a BOM can no longer reach IRIS through
 * these tools, so a different input produces the same refusal shape.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`, defaulting to
 * the dev instance at localhost:52773 / HSCUSTOM. Writes only disposable `ExecuteMCPv2.Temp.QaStory380*`
 * documents, removed before and after every test. Skips when IRIS is unreachable; fails instead when
 * `IRIS_REQUIRE_LIVE` is armed (same arming convention as the other live gates in this directory).
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IrisHttpClient,
  buildToolContext,
  loadConfig,
  negotiateVersion,
  ping,
  type ToolContext,
} from "@iris-mcp/shared";
import { docPutTool } from "../tools/doc.js";
import { docLoadTool } from "../tools/load.js";
import * as liveDocs from "./live-doc-helpers.js";

const IRIS_HOST = process.env.IRIS_HOST ?? "localhost";
const IRIS_PORT = process.env.IRIS_PORT ?? "52773";
const IRIS_USERNAME = process.env.IRIS_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_NAMESPACE ?? "HSCUSTOM";

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const PUT_CLASS = "ExecuteMCPv2.Temp.QaStory380Put";
const LOAD_CLASS = "ExecuteMCPv2.Temp.QaStory380Load";
const BOM = "\uFEFF";

let skipReason: string | undefined;
let ctx: ToolContext;
let client: IrisHttpClient;
let version: number;

/** The stored class's lines, or `undefined` when IRIS has no such class. */
function readStoredLines(className: string): Promise<string[] | undefined> {
  return liveDocs.readStoredLines(client, version, IRIS_NAMESPACE, `${className}.cls`);
}

function removeStored(className: string): Promise<void> {
  return liveDocs.removeStored(client, version, IRIS_NAMESPACE, `${className}.cls`);
}

beforeAll(async () => {
  try {
    const config = loadConfig({
      IRIS_HOST,
      IRIS_PORT,
      IRIS_USERNAME,
      IRIS_PASSWORD,
      IRIS_NAMESPACE,
      IRIS_HTTPS: "false",
    });
    client = new IrisHttpClient(config);
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
}, 30000);

beforeEach(async () => {
  if (skipReason) return;
  await removeStored(PUT_CLASS);
  await removeStored(LOAD_CLASS);
});

afterEach(async () => {
  if (skipReason) return;
  await removeStored(PUT_CLASS);
  await removeStored(LOAD_CLASS);
});

const CLASS_LINES = (name: string): string[] => [
  `Class ${name} Extends %RegisteredObject`,
  "{",
  "}",
];

describe("iris_doc_put against live IRIS (Story 38.0, DW-485, AC-1)", () => {
  it("stores a document whose string content starts with a BOM, with the BOM removed", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await docPutTool.handler(
      { name: `${PUT_CLASS}.cls`, content: BOM + CLASS_LINES(PUT_CLASS).join("\n") },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(
      `Document '${PUT_CLASS}.cls' saved successfully in namespace '${IRIS_NAMESPACE}'.`,
    );
    const stored = await readStoredLines(PUT_CLASS);
    expect(stored, "IRIS stored the document").toBeDefined();
    expect(stored?.[0]).toBe(`Class ${PUT_CLASS} Extends %RegisteredObject`);
    expect(stored?.join("\n")).not.toContain(BOM);
  }, 30000);

  it("stores a document whose array content starts with a BOM, and leaves the caller's array untouched", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const callerLines = [BOM + CLASS_LINES(PUT_CLASS)[0], "{", "}"];

    const result = await docPutTool.handler({ name: `${PUT_CLASS}.cls`, content: callerLines }, ctx);

    expect(result.isError).toBeUndefined();
    expect(callerLines[0]?.charCodeAt(0)).toBe(0xfeff);
    const stored = await readStoredLines(PUT_CLASS);
    expect(stored?.[0]).toBe(`Class ${PUT_CLASS} Extends %RegisteredObject`);
  }, 30000);

  it("reports a document IRIS refuses inside an HTTP 200 envelope as an error, and nothing is stored", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await docPutTool.handler(
      { name: `${PUT_CLASS}.cls`, content: "this is not a class header" },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(`Document '${PUT_CLASS}.cls' was not saved in namespace '${IRIS_NAMESPACE}': `);
    expect(text).toContain("ERROR #16021: Illegal Header Line: this is not a class header");
    expect(text).not.toContain("saved successfully");
    const structured = result.structuredContent as { status?: unknown };
    expect(typeof structured.status).toBe("string");
    expect(structured.status).toContain("Illegal Header Line");
    expect(await readStoredLines(PUT_CLASS), "IRIS stored nothing").toBeUndefined();
  }, 30000);

  it("an accepted write after a refused one still succeeds (the refusal left no state behind)", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const refused = await docPutTool.handler({ name: `${PUT_CLASS}.cls`, content: "not a header" }, ctx);
    expect(refused.isError).toBe(true);

    const accepted = await docPutTool.handler(
      { name: `${PUT_CLASS}.cls`, content: CLASS_LINES(PUT_CLASS) },
      ctx,
    );
    expect(accepted.isError).toBeUndefined();
    expect((await readStoredLines(PUT_CLASS))?.[0]).toBe(`Class ${PUT_CLASS} Extends %RegisteredObject`);
  }, 30000);
});

describe("iris_doc_load against live IRIS through the shared helpers (Story 38.0, DW-485, AC-1)", () => {
  let sourceRoot: string;

  beforeEach(() => {
    sourceRoot = mkdtempSync(path.join(realpathSync(tmpdir()), "qa-story-380-load-"));
    mkdirSync(path.join(sourceRoot, "ExecuteMCPv2", "Temp"), { recursive: true });
  });

  afterEach(() => {
    rmSync(sourceRoot, { recursive: true, force: true });
  });

  function writeSource(className: string, text: string): string {
    const file = path.join(sourceRoot, "ExecuteMCPv2", "Temp", `${className.split(".").pop()}.cls`);
    writeFileSync(file, text, "utf8");
    return file;
  }

  it("uploads a BOM-prefixed file with the BOM removed", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const file = writeSource(LOAD_CLASS, BOM + CLASS_LINES(LOAD_CLASS).join("\r\n") + "\r\n");

    const result = await docLoadTool.handler({ path: file, baseDir: sourceRoot }, ctx);

    const structured = result.structuredContent as { total: number; uploaded: number; failed: number };
    expect(structured).toMatchObject({ total: 1, uploaded: 1, failed: 0 });
    const stored = await readStoredLines(LOAD_CLASS);
    expect(stored?.[0]).toBe(`Class ${LOAD_CLASS} Extends %RegisteredObject`);
    expect(stored?.join("\n")).not.toContain(BOM);
  }, 30000);

  it("counts a file IRIS refuses as a failure carrying IRIS's text, not as an upload", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const file = writeSource(LOAD_CLASS, "this is not a class header\n");

    const result = await docLoadTool.handler({ path: file, baseDir: sourceRoot }, ctx);

    const structured = result.structuredContent as {
      uploaded: number;
      failed: number;
      failures?: Array<{ docName: string; error: string }>;
    };
    expect(structured.uploaded).toBe(0);
    expect(structured.failed).toBe(1);
    expect(structured.failures?.[0]?.docName).toBe(`${LOAD_CLASS}.cls`);
    expect(structured.failures?.[0]?.error).toContain("IRIS refused the upload: ERROR #16021");
    expect(await readStoredLines(LOAD_CLASS), "IRIS stored nothing").toBeUndefined();
  }, 30000);

  it("ignoreConflict false replaces an existing document through the version-checked save: two PUTs, the second carrying the 409's ts (Story 38.7, DW-549)", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const sourceLines = (property: string): string => [...CLASS_LINES(LOAD_CLASS).slice(0, 2), property, "}"].join("\n");
    const file = writeSource(LOAD_CLASS, sourceLines("Property Alpha As %String;"));
    const first = await docLoadTool.handler({ path: file, baseDir: sourceRoot }, ctx);
    expect(first.structuredContent).toMatchObject({ total: 1, uploaded: 1, failed: 0 });
    expect((await readStoredLines(LOAD_CLASS))?.join("\n")).toContain("Property Alpha As %String;");

    writeSource(LOAD_CLASS, sourceLines("Property Beta As %String;"));
    const put = vi.spyOn(client, "put");
    let result: Awaited<ReturnType<typeof docLoadTool.handler>>;
    let calls: unknown[][];
    try {
      result = await docLoadTool.handler({ path: file, baseDir: sourceRoot, ignoreConflict: false }, ctx);
    } finally {
      calls = [...put.mock.calls];
      put.mockRestore();
    }

    expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0 });
    expect(calls).toHaveLength(2);
    const encoded = encodeURIComponent(`${LOAD_CLASS}.cls`);
    expect(String(calls[0]?.[0])).toMatch(new RegExp(`/doc/${encoded}$`));
    expect(calls[0]?.[2]).toBeUndefined();
    expect(String(calls[1]?.[0])).toMatch(new RegExp(`/doc/${encoded}$`));
    const versionHeader = (calls[1]?.[2] as { headers?: Record<string, string> } | undefined)?.headers?.["If-None-Match"];
    expect(versionHeader, "the second PUT carries the ts the 409 returned").toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    const stored = (await readStoredLines(LOAD_CLASS))?.join("\n") ?? "";
    expect(stored).toContain("Property Beta As %String;");
    expect(stored).not.toContain("Property Alpha As %String;");
  }, 60000);
});
