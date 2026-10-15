/**
 * Story 38.2 (AC-1, AC-5) - `iris_doc_get` line-range read against a REAL IRIS.
 *
 * `doc-get-range.test.ts` pins the handler against mocked HTTP. This gate drives the handler through
 * the real `IrisHttpClient` and the real Atelier `GET /doc` route, so the properties the range read
 * rests on are proven where they happen:
 *
 *  - line N is element N-1 of the live `content` array: every ranged read equals the matching slice
 *    of the live no-range read, on a class over 500 lines and on a routine (AC-5);
 *  - the live shape facts the numbering depends on: a class ends with a trailing empty element, a
 *    routine's element 0 is its ROUTINE header with no trailing empty element, and `ts` equals the
 *    ETag (AC-1);
 *  - the AD-24 version-token record: a PUT to an existing document with no `If-None-Match` is refused
 *    with HTTP 409 and writes nothing, while `If-None-Match: <ts>` is accepted (AC-1);
 *  - a document IRIS cannot read (an invalid name, read-only) returns the soft-error shape, and the
 *    ranged read reports IRIS's reason (AC-2, M6);
 *  - a %-prefixed system class and a system include file (both read-only) read by range like the
 *    fixtures, an include file's line 1 keeps its `[Type=INC]` header, and a class's `totalLines`
 *    equals the `totalLines` that `iris_loc_count` reports for it (AC-5).
 *
 * The pinned literals below were captured from the live run of 2026-10-15 (IRIS 2026.2 build 221U,
 * Atelier v8, `default` profile, HSCUSTOM) by running this file armed and reading the values it
 * reported; they are not edited to match the implementation (Rule #36).
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`, defaulting to
 * the dev instance at localhost:52773 / HSCUSTOM. Writes only the disposable
 * `ExecuteMCPv2.Temp.QaStory382Range.cls`, `...Range.mac` and `...Token.cls` documents (never
 * compiled), removed before and after use. Skips when IRIS is unreachable; fails instead when
 * `IRIS_REQUIRE_LIVE` is armed (same arming convention as the other live gates in this directory).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import {
  IrisApiError,
  IrisHttpClient,
  atelierDocStatusError,
  buildToolContext,
  loadConfig,
  negotiateVersion,
  ping,
  type ToolContext,
} from "@iris-mcp/shared";
import { docGetTool } from "../tools/doc.js";
import { locCountTool } from "../tools/loc.js";
import { docPath, readStoredLines, removeStored } from "./live-doc-helpers.js";

const IRIS_HOST = process.env.IRIS_HOST ?? "localhost";
const IRIS_PORT = process.env.IRIS_PORT ?? "52773";
const IRIS_USERNAME = process.env.IRIS_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_NAMESPACE ?? "HSCUSTOM";

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const RANGE_NAME = "ExecuteMCPv2.Temp.QaStory382Range";
const RANGE_CLASS_DOC = `${RANGE_NAME}.cls`;
const RANGE_ROUTINE_DOC = `${RANGE_NAME}.mac`;
const TOKEN_NAME = "ExecuteMCPv2.Temp.QaStory382Token";
const TOKEN_DOC = `${TOKEN_NAME}.cls`;
const ALL_DOCS = [RANGE_CLASS_DOC, RANGE_ROUTINE_DOC, TOKEN_DOC];

let skipReason: string | undefined;
let ctx: ToolContext;
let client: IrisHttpClient;
let version: number;

/** A live no-range read: the reference every ranged read is compared with. */
interface Reference {
  content: string[];
  ts: string;
}
let rangeClass: Reference;
let rangeRoutine: Reference;

/** Class text: a `///` line, the header, `{`, then 80 methods, then the closing `}`. Never compiled. */
function rangeClassLines(): string[] {
  const lines = [
    "/// Disposable fixture for the Story 38.2 live gate; never compiled.",
    `Class ${RANGE_NAME} Extends %RegisteredObject`,
    "{",
    "",
  ];
  for (let n = 1; n <= 80; n += 1) {
    const id = String(n).padStart(3, "0");
    lines.push(
      `/// Method ${id}: caf\u00e9 \u2014 a doc line with non-ASCII text`,
      `ClassMethod M${id}() As %String`,
      "{",
      `\tSet tValue = "m${id}"  `,
      "    Quit tValue",
      "}",
      "",
    );
  }
  lines.push("}");
  return lines;
}

/** Routine text: the `ROUTINE` header and 29 body lines. Never compiled. */
function rangeRoutineLines(): string[] {
  const lines = [`ROUTINE ${RANGE_NAME} [Type=MAC]`];
  for (let n = 1; n <= 29; n += 1) {
    lines.push(n % 2 === 1 ? `Label${n} ; routine line ${n} caf\u00e9 \u2014 text` : `\tSet x = ${n}  `);
  }
  return lines;
}

function tokenLines(extra: string[] = []): string[] {
  return [...extra, `Class ${TOKEN_NAME} Extends %RegisteredObject`, "{", "}"];
}

/** A raw Atelier PUT: IRIS refusing the document inside an HTTP 200 envelope is a gate failure. */
async function putDoc(docName: string, lines: string[], headers?: Record<string, string>): Promise<void> {
  const response = await client.put(
    docPath(version, IRIS_NAMESPACE, docName),
    { enc: false, content: lines },
    headers ? { headers } : undefined,
  );
  const refusal = atelierDocStatusError(response.result);
  if (refusal !== undefined) throw new Error(`IRIS refused ${docName}: ${refusal}`);
}

/** The status code of the IrisApiError a PUT throws; fails when the PUT is accepted. */
async function putStatusCode(docName: string, lines: string[], headers?: Record<string, string>): Promise<number> {
  try {
    await putDoc(docName, lines, headers);
  } catch (error) {
    expect(error).toBeInstanceOf(IrisApiError);
    return (error as IrisApiError).statusCode;
  }
  throw new Error(`the PUT to ${docName} was accepted; a refusal was expected`);
}

async function removeAll(): Promise<void> {
  for (const docName of ALL_DOCS) await removeStored(client, version, IRIS_NAMESPACE, docName);
}

/** The no-range `iris_doc_get` read of `docName`. */
async function fullRead(docName: string): Promise<Reference> {
  const result = await docGetTool.handler({ name: docName }, ctx);
  expect(result.isError, `full read of ${docName}`).toBeUndefined();
  const read = result.structuredContent as { content: string[]; ts: string };
  return { content: read.content, ts: read.ts };
}

/** Read `startLine`..`endLine` (either may be omitted) and assert it equals the slice of `reference`. */
async function expectRangeMatches(
  docName: string,
  reference: Reference,
  startLine?: number,
  endLine?: number,
): Promise<void> {
  const args: Record<string, unknown> = { name: docName };
  if (startLine !== undefined) args.startLine = startLine;
  if (endLine !== undefined) args.endLine = endLine;
  const label = `${docName} ${startLine ?? "-"}..${endLine ?? "-"}`;

  const result = await docGetTool.handler(args, ctx);

  expect(result.isError, label).toBeUndefined();
  const totalLines = reference.content.length;
  const first = startLine ?? 1;
  const last = Math.min(endLine ?? totalLines, totalLines);
  const expected = reference.content.slice(first - 1, last);
  expect(expected.length, `${label}: the slice is not empty`).toBeGreaterThan(0);
  const structured = result.structuredContent as {
    name: string;
    ts: string;
    startLine: number;
    endLine: number;
    totalLines: number;
    lines: string[];
  };
  expect(structured, label).toEqual({
    name: docName,
    ts: reference.ts,
    startLine: first,
    endLine: last,
    totalLines,
    lines: expected,
  });

  const [header, ...numbered] = (result.content[0]?.text ?? "").split("\n");
  expect(header, label).toBe(
    `Document '${docName}' in namespace '${IRIS_NAMESPACE}': lines ${first}-${last} of ${totalLines} (ts ${reference.ts})`,
  );
  expect(numbered, `${label}: one text line per returned line`).toHaveLength(expected.length);
  numbered.forEach((line, index) => {
    const tab = line.indexOf("\t");
    expect(line.slice(0, tab), `${label} line ${first + index}: the number`).toBe(String(first + index).padStart(6));
    expect(line.slice(tab + 1), `${label} line ${first + index}: the text after the first TAB`).toBe(
      expected[index],
    );
  });
}

/** A one-line ranged read: its `totalLines` and its `lines`. */
async function readOneLine(docName: string, line: number): Promise<{ totalLines: number; lines: string[] }> {
  const result = await docGetTool.handler({ name: docName, startLine: line, endLine: line }, ctx);
  expect(result.isError, `${docName} line ${line}`).toBeUndefined();
  const { totalLines, lines } = result.structuredContent as { totalLines: number; lines: string[] };
  return { totalLines, lines };
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
  if (skipReason) return;

  await removeAll();
  await putDoc(RANGE_CLASS_DOC, rangeClassLines());
  await putDoc(RANGE_ROUTINE_DOC, rangeRoutineLines());
  rangeClass = await fullRead(RANGE_CLASS_DOC);
  rangeRoutine = await fullRead(RANGE_ROUTINE_DOC);
}, 60000);

afterAll(async () => {
  if (skipReason) return;
  await removeAll();
}, 60000);

describe("live document shape: the facts the line numbering rests on (Story 38.2, AC-1)", () => {
  it("IRIS returns the gate's own fixtures (written without CR, LF or BOM) with no line break or BOM inside any element", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    for (const reference of [rangeClass, rangeRoutine]) {
      expect(reference.content.some((line) => /[\r\n\uFEFF]/.test(line))).toBe(false);
    }
  }, 60000);

  it("a class ends with a trailing empty element, which is a line", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    expect(rangeClass.content.length).toBeGreaterThan(500);
    expect(rangeClass.content.at(-1)).toBe("");
    expect(rangeClass.content.at(-2)).toBe("}");
  }, 60000);

  it("a routine's element 0 is the ROUTINE header, with the type dropped, and it has no trailing empty element", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    expect(rangeRoutine.content[0]).toBe(`ROUTINE ${RANGE_NAME}`);
    expect(rangeRoutine.content.at(-1)).not.toBe("");
  }, 60000);

  it("pins the class's totalLines, line 1, last line and line 250, as ranged reads return them (captured live)", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    expect(await readOneLine(RANGE_CLASS_DOC, 1)).toEqual({
      totalLines: 566,
      lines: ["/// Disposable fixture for the Story 38.2 live gate; never compiled."],
    });
    expect(await readOneLine(RANGE_CLASS_DOC, 250)).toEqual({
      totalLines: 566,
      lines: ["/// Method 036: caf\u00e9 \u2014 a doc line with non-ASCII text"],
    });
    expect(await readOneLine(RANGE_CLASS_DOC, 566)).toEqual({ totalLines: 566, lines: [""] });
  }, 60000);

  it("pins the routine's totalLines, line 1 (the header, type dropped) and last line, as ranged reads return them (captured live)", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    expect(await readOneLine(RANGE_ROUTINE_DOC, 1)).toEqual({
      totalLines: 30,
      lines: ["ROUTINE ExecuteMCPv2.Temp.QaStory382Range"],
    });
    expect(await readOneLine(RANGE_ROUTINE_DOC, 30)).toEqual({
      totalLines: 30,
      lines: ["Label29 ; routine line 29 caf\u00e9 \u2014 text"],
    });
  }, 60000);
});

describe("ranged reads equal the slices of the live full read (Story 38.2, AC-5)", () => {
  it("class: line 1, the last line and line 250", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const total = rangeClass.content.length;

    await expectRangeMatches(RANGE_CLASS_DOC, rangeClass, 1, 1);
    await expectRangeMatches(RANGE_CLASS_DOC, rangeClass, total, total);
    await expectRangeMatches(RANGE_CLASS_DOC, rangeClass, 250, 250);
  }, 60000);

  it("class: the first 50 lines, a middle window and the end window", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const total = rangeClass.content.length;

    await expectRangeMatches(RANGE_CLASS_DOC, rangeClass, 1, 50);
    await expectRangeMatches(RANGE_CLASS_DOC, rangeClass, 200, 300);
    await expectRangeMatches(RANGE_CLASS_DOC, rangeClass, total - 49, total);
  }, 60000);

  it("class: startLine only, endLine only, and an endLine past the end clamped to the last line", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const total = rangeClass.content.length;

    await expectRangeMatches(RANGE_CLASS_DOC, rangeClass, 400, undefined);
    await expectRangeMatches(RANGE_CLASS_DOC, rangeClass, undefined, 75);
    await expectRangeMatches(RANGE_CLASS_DOC, rangeClass, total - 5, 100000);
  }, 60000);

  it("class: 100-line windows stepping over every line of the document", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const total = rangeClass.content.length;

    for (let start = 1; start <= total; start += 100) {
      await expectRangeMatches(RANGE_CLASS_DOC, rangeClass, start, start + 99);
    }
  }, 60000);

  it("routine: the header line, the last line, one-sided reads and a clamped read", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const total = rangeRoutine.content.length;

    await expectRangeMatches(RANGE_ROUTINE_DOC, rangeRoutine, 1, 1);
    await expectRangeMatches(RANGE_ROUTINE_DOC, rangeRoutine, total, total);
    await expectRangeMatches(RANGE_ROUTINE_DOC, rangeRoutine, 10, undefined);
    await expectRangeMatches(RANGE_ROUTINE_DOC, rangeRoutine, undefined, 10);
    await expectRangeMatches(RANGE_ROUTINE_DOC, rangeRoutine, total - 2, 100000);
  }, 60000);

  it("routine: 10-line windows stepping over every line of the document", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const total = rangeRoutine.content.length;

    for (let start = 1; start <= total; start += 10) {
      await expectRangeMatches(RANGE_ROUTINE_DOC, rangeRoutine, start, start + 9);
    }
  }, 60000);

  it("a startLine past the last line is refused with the live totalLines", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const total = rangeClass.content.length;

    const result = await docGetTool.handler({ name: RANGE_CLASS_DOC, startLine: total + 1 }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      `startLine ${total + 1} is past the end of document '${RANGE_CLASS_DOC}', which has ${total} lines. Pass a startLine from 1 to ${total}, or omit startLine and endLine to read the whole document.`,
    );
  }, 60000);

  it("a document IRIS cannot read comes back as the live soft-error shape and is reported with IRIS's reason", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const unreadable = "ExecuteMCPv2.Temp.QaStory382Unreadable.xyz";

    const result = await docGetTool.handler({ name: unreadable, startLine: 1 }, ctx);

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text.startsWith(`Document '${unreadable}' could not be read in namespace '${IRIS_NAMESPACE}': `)).toBe(true);
    expect(text).toContain("#16006");
    expect(text.endsWith(". Check the document name and namespace, then retry.")).toBe(true);
  }, 60000);
});

/** A system class that every namespace maps: read-only, never written. */
const SYSTEM_CLASS_DOC = "%Library.RegisteredObject.cls";
/** A system include file that every namespace maps: read-only, never written. */
const SYSTEM_INCLUDE_DOC = "%occStatus.inc";

describe("ranged reads beyond the fixtures (Story 38.2, AC-5)", () => {
  it("a %-prefixed system class (read-only): ranged reads equal the slices of its live full read", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const reference = await fullRead(SYSTEM_CLASS_DOC);
    const total = reference.content.length;
    expect(total, "the system class is large enough for the windows below").toBeGreaterThan(60);
    expect(reference.content.some((line) => /[\r\n\uFEFF]/.test(line))).toBe(false);

    await expectRangeMatches(SYSTEM_CLASS_DOC, reference, 1, 1);
    await expectRangeMatches(SYSTEM_CLASS_DOC, reference, 1, 40);
    await expectRangeMatches(SYSTEM_CLASS_DOC, reference, 30, 60);
    await expectRangeMatches(SYSTEM_CLASS_DOC, reference, total, total);
    await expectRangeMatches(SYSTEM_CLASS_DOC, reference, total - 9, 100000);
  }, 60000);

  it("a %-prefixed system include file (read-only): line 1 is its ROUTINE header with the type kept, and ranged reads equal the slices of its live full read", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const reference = await fullRead(SYSTEM_INCLUDE_DOC);
    const total = reference.content.length;
    expect(total, "the include file is large enough for the windows below").toBeGreaterThan(20);
    expect(reference.content[0]).toBe("ROUTINE %occStatus [Type=INC]");

    await expectRangeMatches(SYSTEM_INCLUDE_DOC, reference, 1, 1);
    await expectRangeMatches(SYSTEM_INCLUDE_DOC, reference, 1, 20);
    await expectRangeMatches(SYSTEM_INCLUDE_DOC, reference, total, total);
    await expectRangeMatches(SYSTEM_INCLUDE_DOC, reference, total - 4, 100000);
  }, 60000);

  it("a class's totalLines equals the totalLines iris_loc_count reports for the same class", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const loc = await locCountTool.handler({ spec: RANGE_CLASS_DOC, namespace: IRIS_NAMESPACE }, ctx);

    if (loc.isError) {
      const reason = `iris_loc_count could not run in ${IRIS_NAMESPACE} (is the ExecuteMCPv2 REST service deployed there?): ${loc.content[0]?.text}`;
      if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set, so this case may not be skipped: ${reason}`);
      return testCtx.skip();
    }
    const counted = loc.structuredContent as { filesParsed: number; totalLines: number };
    expect(counted.filesParsed, "the scan matched exactly the fixture class").toBe(1);
    expect(counted.totalLines).toBe(rangeClass.content.length);
    expect((await readOneLine(RANGE_CLASS_DOC, 1)).totalLines).toBe(counted.totalLines);
  }, 60000);
});

describe("AD-24 version-token record on a live document (Story 38.2, AC-1)", () => {
  beforeEach(async () => {
    if (skipReason) return;
    await removeStored(client, version, IRIS_NAMESPACE, TOKEN_DOC);
    await putDoc(TOKEN_DOC, tokenLines());
  }, 60000);

  afterEach(async () => {
    if (skipReason) return;
    await removeStored(client, version, IRIS_NAMESPACE, TOKEN_DOC);
  }, 60000);

  it("the ranged ts equals the full read's ts and the metadataOnly etag", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const full = await fullRead(TOKEN_DOC);
    const ranged = await docGetTool.handler({ name: TOKEN_DOC, startLine: 1 }, ctx);
    const meta = await docGetTool.handler({ name: TOKEN_DOC, metadataOnly: true }, ctx);

    const rangedTs = (ranged.structuredContent as { ts: string }).ts;
    const etag = (meta.structuredContent as { etag?: string }).etag;
    expect(full.ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+$/);
    expect(rangedTs).toBe(full.ts);
    expect(etag).toBe(full.ts);
  }, 60000);

  it("a PUT with no If-None-Match and no ignoreConflict is refused with HTTP 409, and the document is unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await fullRead(TOKEN_DOC);

    const statusCode = await putStatusCode(TOKEN_DOC, tokenLines(["/// changed without a token"]));

    expect(statusCode).toBe(409);
    expect(await fullRead(TOKEN_DOC)).toEqual(before);
    expect(await readStoredLines(client, version, IRIS_NAMESPACE, TOKEN_DOC)).toEqual(before.content);
  }, 60000);

  it("a PUT carrying If-None-Match: <ts> is accepted, and a re-read shows the new content and a different ts", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await fullRead(TOKEN_DOC);

    await putDoc(TOKEN_DOC, tokenLines(["/// changed with the token"]), { "If-None-Match": before.ts });

    const after = await fullRead(TOKEN_DOC);
    expect(after.content).toContain("/// changed with the token");
    expect(after.content).toHaveLength(before.content.length + 1);
    expect(after.ts).not.toBe(before.ts);
  }, 60000);

  it("a PUT carrying the old ts after another write is refused with HTTP 409", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await fullRead(TOKEN_DOC);
    await putDoc(TOKEN_DOC, tokenLines(["/// first change"]), { "If-None-Match": before.ts });
    const afterFirst = await fullRead(TOKEN_DOC);

    const statusCode = await putStatusCode(TOKEN_DOC, tokenLines(["/// second change"]), {
      "If-None-Match": before.ts,
    });

    expect(statusCode).toBe(409);
    expect(await fullRead(TOKEN_DOC)).toEqual(afterFirst);
  }, 60000);
});
