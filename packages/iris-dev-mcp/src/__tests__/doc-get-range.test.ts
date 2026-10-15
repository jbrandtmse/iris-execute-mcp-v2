/**
 * Story 38.2 - `iris_doc_get` line-range read.
 *
 * Two describes:
 *
 *  1. Back-compat (AC-4, Rule #19): with neither `startLine` nor `endLine`, the tool's request and
 *     its whole ToolResult are pinned as literals. The literals were captured on the UNMODIFIED tree
 *     (baseline commit 8fae074, before any 38.2 source edit) by running
 *     `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/doc-get-range.test.ts`
 *     with this describe only: it passed on that tree, so every literal below is what the baseline
 *     handler returned for these inputs (Rule #36). They are never edited to match the new code.
 *  2. The range read (AC-2, AC-3, AC-6), driven through the matrix of the spec.
 *
 * The fakes are real Atelier shapes: a GET result has the nine keys
 * `name, db, ts, upd, cat, status, enc, flags, content`; a class `content` ends with an empty
 * element; a HEAD carries only `ETag` (the raw `ts` string, never `Last-Modified`).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IrisApiError, type HeadResponse, type ToolContext } from "@iris-mcp/shared";
import { docGetTool } from "../tools/doc.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

/** A HEAD response carrying only the headers given. */
function headResponse(status: number, headerEntries: Record<string, string> = {}): HeadResponse {
  return { status, headers: new Headers(headerEntries) };
}

const TS = "2026-09-01 04:29:37.877";

const CLASS_GET_RESULT = {
  name: "Test.Fixture.cls",
  db: "HSCUSTOM",
  ts: TS,
  upd: false,
  cat: "CLS",
  status: "",
  enc: false,
  flags: 0,
  content: ["Class Test.Fixture Extends %RegisteredObject", "{", "}", ""],
};

const CLASS_GET_TEXT = [
  "{",
  '  "name": "Test.Fixture.cls",',
  '  "db": "HSCUSTOM",',
  '  "ts": "2026-09-01 04:29:37.877",',
  '  "upd": false,',
  '  "cat": "CLS",',
  '  "status": "",',
  '  "enc": false,',
  '  "flags": 0,',
  '  "content": [',
  '    "Class Test.Fixture Extends %RegisteredObject",',
  '    "{",',
  '    "}",',
  '    ""',
  "  ]",
  "}",
].join("\n");

const XML_GET_RESULT = {
  name: "Test.Fixture.cls",
  db: "HSCUSTOM",
  ts: TS,
  upd: false,
  cat: "CLS",
  status: "",
  enc: false,
  flags: 0,
  content: [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Export generator="IRIS" version="26">',
    '<Class name="Test.Fixture">',
    "</Class>",
    "</Export>",
  ],
};

const XML_GET_TEXT = [
  "{",
  '  "name": "Test.Fixture.cls",',
  '  "db": "HSCUSTOM",',
  '  "ts": "2026-09-01 04:29:37.877",',
  '  "upd": false,',
  '  "cat": "CLS",',
  '  "status": "",',
  '  "enc": false,',
  '  "flags": 0,',
  '  "content": [',
  '    "<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>",',
  '    "<Export generator=\\"IRIS\\" version=\\"26\\">",',
  '    "<Class name=\\"Test.Fixture\\">",',
  '    "</Class>",',
  '    "</Export>"',
  "  ]",
  "}",
].join("\n");

const DOC_PATH = "/api/atelier/v7/USER/doc/Test.Fixture.cls";

describe("iris_doc_get without a line range is unchanged (Story 38.2, AC-4)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("default read: one GET on the bare path, the pretty-printed result as text, the raw result as structuredContent", async () => {
    mockHttp.get.mockResolvedValue(envelope(CLASS_GET_RESULT));

    const result = await docGetTool.handler({ name: "Test.Fixture.cls" }, ctx);

    expect(mockHttp.get.mock.calls).toEqual([[DOC_PATH]]);
    expect(mockHttp.head).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      content: [{ type: "text", text: CLASS_GET_TEXT }],
      structuredContent: CLASS_GET_RESULT,
    });
  });

  it("format udl: the same GET carrying ?format=udl", async () => {
    mockHttp.get.mockResolvedValue(envelope(CLASS_GET_RESULT));

    const result = await docGetTool.handler({ name: "Test.Fixture.cls", format: "udl" }, ctx);

    expect(mockHttp.get.mock.calls).toEqual([[`${DOC_PATH}?format=udl`]]);
    expect(mockHttp.head).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      content: [{ type: "text", text: CLASS_GET_TEXT }],
      structuredContent: CLASS_GET_RESULT,
    });
  });

  it("format xml: the GET carries ?format=xml and the XML result is returned whole", async () => {
    mockHttp.get.mockResolvedValue(envelope(XML_GET_RESULT));

    const result = await docGetTool.handler({ name: "Test.Fixture.cls", format: "xml" }, ctx);

    expect(mockHttp.get.mock.calls).toEqual([[`${DOC_PATH}?format=xml`]]);
    expect(mockHttp.head).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      content: [{ type: "text", text: XML_GET_TEXT }],
      structuredContent: XML_GET_RESULT,
    });
  });

  it("metadataOnly false: still the GET path", async () => {
    mockHttp.get.mockResolvedValue(envelope(CLASS_GET_RESULT));

    const result = await docGetTool.handler({ name: "Test.Fixture.cls", metadataOnly: false }, ctx);

    expect(mockHttp.get.mock.calls).toEqual([[DOC_PATH]]);
    expect(mockHttp.head).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      content: [{ type: "text", text: CLASS_GET_TEXT }],
      structuredContent: CLASS_GET_RESULT,
    });
  });

  it("metadataOnly true: one HEAD on the bare path; a HEAD that carries only ETag yields {exists,name,timestamp:undefined,etag}", async () => {
    mockHttp.head.mockResolvedValue(headResponse(200, { ETag: TS }));

    const result = await docGetTool.handler({ name: "Test.Fixture.cls", metadataOnly: true }, ctx);

    expect(mockHttp.head.mock.calls).toEqual([[DOC_PATH]]);
    expect(mockHttp.get).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      content: [
        {
          type: "text",
          text: ["{", '  "exists": true,', '  "name": "Test.Fixture.cls",', `  "etag": "${TS}"`, "}"].join("\n"),
        },
      ],
      structuredContent: { exists: true, name: "Test.Fixture.cls", timestamp: undefined, etag: TS },
    });
  });

  it("metadataOnly true with format xml: the HEAD path carries no query string", async () => {
    mockHttp.head.mockResolvedValue(headResponse(200, { ETag: TS }));

    await docGetTool.handler({ name: "Test.Fixture.cls", format: "xml", metadataOnly: true }, ctx);

    expect(mockHttp.head.mock.calls).toEqual([[DOC_PATH]]);
    expect(mockHttp.get).not.toHaveBeenCalled();
  });

  it("metadataOnly true and the HEAD is a 404: exists:false with isError false", async () => {
    mockHttp.head.mockRejectedValue(new IrisApiError(404, [], DOC_PATH));

    const result = await docGetTool.handler({ name: "Test.Fixture.cls", metadataOnly: true }, ctx);

    expect(mockHttp.head.mock.calls).toEqual([[DOC_PATH]]);
    expect(result).toStrictEqual({
      content: [{ type: "text", text: ["{", '  "exists": false,', '  "name": "Test.Fixture.cls"', "}"].join("\n") }],
      structuredContent: { exists: false, name: "Test.Fixture.cls" },
      isError: false,
    });
  });

  it("the GET is a 404: the not-found text with isError true", async () => {
    mockHttp.get.mockRejectedValue(new IrisApiError(404, [], DOC_PATH));

    const result = await docGetTool.handler({ name: "Test.Fixture.cls" }, ctx);

    expect(mockHttp.get.mock.calls).toEqual([[DOC_PATH]]);
    expect(result).toStrictEqual({
      content: [{ type: "text", text: "Document 'Test.Fixture.cls' not found in namespace 'USER'" }],
      isError: true,
    });
  });
});

// --- The range read ---

/** The spec's fixture class C: 11 elements, ending with "}" and the trailing empty element. */
const C_CONTENT = [
  "/// Fixture class",
  "Class Test.Fixture Extends %RegisteredObject",
  "{",
  "",
  "ClassMethod One() As %String",
  "{",
  '\tQuit "caf\u00e9"',
  "}",
  "",
  "}",
  "",
];

const C_RESULT = { ...CLASS_GET_RESULT, content: C_CONTENT };

const SOFT_ERROR_NAME = "ExecuteMCPv2.Temp.QaStory382Nonexistent.xyz";

/**
 * The GET result IRIS returns for a document it cannot read: HTTP 200, `content` the empty string and a
 * non-empty `status` (no `upd` or `flags` key). Captured live on 2026-10-15 (IRIS 2026.2 build 221U,
 * `default`/HSCUSTOM) by calling `iris_doc_get` with the name below, which IRIS refuses as invalid.
 */
const SOFT_ERROR_RESULT = {
  name: SOFT_ERROR_NAME,
  db: "",
  ts: "",
  cat: "OTH",
  enc: false,
  content: "",
  status: `ERROR #16006: Document '${SOFT_ERROR_NAME}' name is invalid`,
};

/** The exact text of a successful ranged read: the header line, a newline, then the numbered lines. */
function rangedText(header: string, numbered: string[]): string {
  return [header, ...numbered].join("\n");
}

const HEADER_PREFIX = "Document 'Test.Fixture.cls' in namespace 'USER': lines ";

describe("iris_doc_get with a line range (Story 38.2, AC-2, AC-3)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
    mockHttp.get.mockResolvedValue(envelope(C_RESULT));
  });

  function expectNoRequest(): void {
    expect(mockHttp.get).not.toHaveBeenCalled();
    expect(mockHttp.head).not.toHaveBeenCalled();
  }

  describe("a valid range", () => {
    it("startLine and endLine: one GET on today's path; the header, then lines 3-5 numbered; the structured result carries the effective bounds", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 3, endLine: 5 }, ctx);

      expect(mockHttp.get.mock.calls).toEqual([[DOC_PATH]]);
      expect(mockHttp.head).not.toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
      expect(result.content).toEqual([
        {
          type: "text",
          text: rangedText(`${HEADER_PREFIX}3-5 of 11 (ts ${TS})`, [
            "     3\t{",
            "     4\t",
            "     5\tClassMethod One() As %String",
          ]),
        },
      ]);
      expect(result.structuredContent).toEqual({
        name: "Test.Fixture.cls",
        ts: TS,
        startLine: 3,
        endLine: 5,
        totalLines: 11,
        lines: ["{", "", "ClassMethod One() As %String"],
      });
    });

    it("startLine only: endLine is the last line", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 10 }, ctx);

      expect(result.content[0]?.text).toBe(
        rangedText(`${HEADER_PREFIX}10-11 of 11 (ts ${TS})`, ["    10\t}", "    11\t"]),
      );
      expect(result.structuredContent).toEqual({
        name: "Test.Fixture.cls",
        ts: TS,
        startLine: 10,
        endLine: 11,
        totalLines: 11,
        lines: ["}", ""],
      });
    });

    it("endLine only: startLine is 1", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", endLine: 2 }, ctx);

      expect(result.content[0]?.text).toBe(
        rangedText(`${HEADER_PREFIX}1-2 of 11 (ts ${TS})`, [
          "     1\t/// Fixture class",
          "     2\tClass Test.Fixture Extends %RegisteredObject",
        ]),
      );
      expect(result.structuredContent).toEqual({
        name: "Test.Fixture.cls",
        ts: TS,
        startLine: 1,
        endLine: 2,
        totalLines: 11,
        lines: ["/// Fixture class", "Class Test.Fixture Extends %RegisteredObject"],
      });
    });

    it("an endLine past the end is clamped to the last line, in both the text and the structured result", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 9, endLine: 9999 }, ctx);

      expect(result.content[0]?.text).toBe(
        rangedText(`${HEADER_PREFIX}9-11 of 11 (ts ${TS})`, ["     9\t", "    10\t}", "    11\t"]),
      );
      expect(result.structuredContent).toEqual({
        name: "Test.Fixture.cls",
        ts: TS,
        startLine: 9,
        endLine: 11,
        totalLines: 11,
        lines: ["", "}", ""],
      });
    });

    it("a single line: the first line, and a class's last line, which is empty", async () => {
      const first = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 1, endLine: 1 }, ctx);
      const last = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 11, endLine: 11 }, ctx);

      expect(first.content[0]?.text).toBe(rangedText(`${HEADER_PREFIX}1-1 of 11 (ts ${TS})`, ["     1\t/// Fixture class"]));
      expect(last.content[0]?.text).toBe(rangedText(`${HEADER_PREFIX}11-11 of 11 (ts ${TS})`, ["    11\t"]));
      expect(last.structuredContent).toEqual({
        name: "Test.Fixture.cls",
        ts: TS,
        startLine: 11,
        endLine: 11,
        totalLines: 11,
        lines: [""],
      });
    });

    it("the whole document by range: 1-11 equals the content array, trailing empty element included", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 1, endLine: 11 }, ctx);

      expect((result.structuredContent as { lines: string[] }).lines).toEqual(C_CONTENT);
    });

    it("keeps a TAB-led line and a non-ASCII line exactly, behind the line number and one TAB", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 7, endLine: 7 }, ctx);

      expect(result.content[0]?.text).toBe(
        rangedText(`${HEADER_PREFIX}7-7 of 11 (ts ${TS})`, ['     7\t\tQuit "caf\u00e9"']),
      );
    });

    it("format udl: the path carries ?format=udl, as it does without a range", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", format: "udl", startLine: 1 }, ctx);

      expect(mockHttp.get.mock.calls).toEqual([[`${DOC_PATH}?format=udl`]]);
      expect((result.structuredContent as { totalLines: number }).totalLines).toBe(11);
      expect(result.isError).toBeUndefined();
    });

    it("names the requested namespace in the header and requests that namespace", async () => {
      const result = await docGetTool.handler(
        { name: "Test.Fixture.cls", namespace: "HSCUSTOM", startLine: 2, endLine: 2 },
        ctx,
      );

      expect(mockHttp.get.mock.calls).toEqual([["/api/atelier/v7/HSCUSTOM/doc/Test.Fixture.cls"]]);
      expect(result.content[0]?.text).toBe(
        rangedText(`Document 'Test.Fixture.cls' in namespace 'HSCUSTOM': lines 2-2 of 11 (ts ${TS})`, [
          "     2\tClass Test.Fixture Extends %RegisteredObject",
        ]),
      );
    });

    it("removes one leading BOM from line 1 and counts nothing differently", async () => {
      mockHttp.get.mockResolvedValue(
        envelope({ ...CLASS_GET_RESULT, content: ["\uFEFFClass Test.Fixture Extends %RegisteredObject", "\uFEFF{", "}", ""] }),
      );

      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 1, endLine: 2 }, ctx);

      expect(result.content[0]?.text).toBe(
        rangedText(`${HEADER_PREFIX}1-2 of 4 (ts ${TS})`, [
          "     1\tClass Test.Fixture Extends %RegisteredObject",
          "     2\t\uFEFF{",
        ]),
      );
      expect((result.structuredContent as { lines: string[] }).lines).toEqual([
        "Class Test.Fixture Extends %RegisteredObject",
        "\uFEFF{",
      ]);
    });

    it("reads a routine, whose line 1 is the ROUTINE header and which has no trailing empty element", async () => {
      mockHttp.get.mockResolvedValue(
        envelope({ ...CLASS_GET_RESULT, cat: "RTN", content: ["ROUTINE Test.Fixture", "Main\tQuit 1"] }),
      );

      const result = await docGetTool.handler({ name: "Test.Fixture.mac", startLine: 2 }, ctx);

      expect(result.structuredContent).toEqual({
        name: "Test.Fixture.mac",
        ts: TS,
        startLine: 2,
        endLine: 2,
        totalLines: 2,
        lines: ["Main\tQuit 1"],
      });
    });

    it("never mutates the response's content array", async () => {
      const content = ["\uFEFFClass Test.Fixture Extends %RegisteredObject", "{", "}", ""];
      mockHttp.get.mockResolvedValue(envelope({ ...CLASS_GET_RESULT, content }));

      await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 1, endLine: 4 }, ctx);

      expect(content).toEqual(["\uFEFFClass Test.Fixture Extends %RegisteredObject", "{", "}", ""]);
    });

    it("an explicit metadataOnly false with a range is an ordinary ranged read: one GET, no HEAD, no refusal", async () => {
      const result = await docGetTool.handler(
        { name: "Test.Fixture.cls", metadataOnly: false, startLine: 3, endLine: 5 },
        ctx,
      );

      expect(mockHttp.get.mock.calls).toEqual([[DOC_PATH]]);
      expect(mockHttp.head).not.toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        name: "Test.Fixture.cls",
        ts: TS,
        startLine: 3,
        endLine: 5,
        totalLines: 11,
        lines: ["{", "", "ClassMethod One() As %String"],
      });
    });
  });

  describe("range errors", () => {
    it("M1: a range with metadataOnly is refused before any request", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", metadataOnly: true, endLine: 5 }, ctx);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "startLine and endLine cannot be combined with metadataOnly. Omit metadataOnly to read lines, or omit startLine and endLine to read only the metadata.",
          },
        ],
        isError: true,
      });
      expectNoRequest();
    });

    it("M1 comes before M2: metadataOnly with format xml and a range is the metadataOnly refusal", async () => {
      const result = await docGetTool.handler(
        { name: "Test.Fixture.cls", metadataOnly: true, format: "xml", startLine: 1 },
        ctx,
      );

      expect(result.content[0]?.text).toContain("cannot be combined with metadataOnly");
      expectNoRequest();
    });

    it("M2: a range with format xml is refused before any request", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", format: "xml", startLine: 1 }, ctx);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: 'Line ranges apply only to UDL text, not to format "xml". Omit format (or pass "udl") to read a line range.',
          },
        ],
        isError: true,
      });
      expectNoRequest();
    });

    it("M3: startLine after endLine is refused before any request", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 5, endLine: 3 }, ctx);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "startLine 5 is after endLine 3. Pass a startLine that is less than or equal to endLine.",
          },
        ],
        isError: true,
      });
      expectNoRequest();
    });

    it("startLine equal to endLine is a valid range, not M3", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 3, endLine: 3 }, ctx);

      expect(result.isError).toBeUndefined();
    });

    it("M4: a startLine past the end states the document's totalLines and is an error, not an empty success", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 12 }, ctx);

      expect(mockHttp.get.mock.calls).toEqual([[DOC_PATH]]);
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "startLine 12 is past the end of document 'Test.Fixture.cls', which has 11 lines. Pass a startLine from 1 to 11, or omit startLine and endLine to read the whole document.",
          },
        ],
        isError: true,
      });
    });

    it("a startLine on the last line is in range (the M4 boundary)", async () => {
      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 11 }, ctx);

      expect(result.isError).toBeUndefined();
    });

    it("M5: a binary document (enc true) is refused, whatever its content", async () => {
      mockHttp.get.mockResolvedValue(
        envelope({ ...CLASS_GET_RESULT, name: "logo.png", cat: "CSP", enc: true, content: ["iVBORw0KGgo=", "AAAA"] }),
      );

      const result = await docGetTool.handler({ name: "logo.png", startLine: 1 }, ctx);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "Document 'logo.png' is a binary document, and line ranges apply only to text. Omit startLine and endLine to read it whole.",
          },
        ],
        isError: true,
      });
    });

    it("M5 comes before M4: a binary document is refused as binary even when startLine is past its chunk count", async () => {
      mockHttp.get.mockResolvedValue(
        envelope({ ...CLASS_GET_RESULT, name: "logo.png", cat: "CSP", enc: true, content: ["iVBORw0KGgo=", "AAAA"] }),
      );

      const result = await docGetTool.handler({ name: "logo.png", startLine: 50 }, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("is a binary document");
      expect(result.content[0]?.text).not.toContain("past the end");
    });

    it("M6: a soft error (content is the empty string, status is non-empty) carries IRIS's status text", async () => {
      mockHttp.get.mockResolvedValue(envelope(SOFT_ERROR_RESULT));

      const result = await docGetTool.handler({ name: SOFT_ERROR_NAME, startLine: 1 }, ctx);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: `Document '${SOFT_ERROR_NAME}' could not be read in namespace 'USER': ERROR #16006: Document '${SOFT_ERROR_NAME}' name is invalid. Check the document name and namespace, then retry.`,
          },
        ],
        isError: true,
      });
    });

    it("M6: a result whose content is not an array, with an empty status, says IRIS returned no line content", async () => {
      mockHttp.get.mockResolvedValue(envelope({ ...CLASS_GET_RESULT, content: "" }));

      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 1 }, ctx);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "Document 'Test.Fixture.cls' could not be read in namespace 'USER': IRIS returned no line content. Check the document name and namespace, then retry.",
          },
        ],
        isError: true,
      });
    });

    it("M6 comes before M5: a soft error that also says enc true is reported as unreadable", async () => {
      mockHttp.get.mockResolvedValue(envelope({ ...SOFT_ERROR_RESULT, enc: true }));

      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 1 }, ctx);

      expect(result.content[0]?.text).toContain("could not be read in namespace 'USER'");
    });

    it("a 404 with a range is today's not-found text", async () => {
      mockHttp.get.mockRejectedValue(new IrisApiError(404, [], DOC_PATH));

      const result = await docGetTool.handler({ name: "Test.Fixture.cls", startLine: 1, endLine: 4 }, ctx);

      expect(result).toEqual({
        content: [{ type: "text", text: "Document 'Test.Fixture.cls' not found in namespace 'USER'" }],
        isError: true,
      });
    });

    it("a non-404 server error with a range is rethrown", async () => {
      mockHttp.get.mockRejectedValue(new IrisApiError(500, [], DOC_PATH));

      await expect(docGetTool.handler({ name: "Test.Fixture.cls", startLine: 1 }, ctx)).rejects.toThrow(IrisApiError);
    });
  });

  describe("input schema", () => {
    const parse = (input: Record<string, unknown>) => docGetTool.inputSchema.safeParse({ name: "Test.Fixture.cls", ...input });

    it.each([
      ["startLine", 0],
      ["startLine", -1],
      ["startLine", 1.5],
      ["startLine", "abc"],
      ["endLine", 0],
      ["endLine", -1],
      ["endLine", 1.5],
      ["endLine", "abc"],
    ])("rejects %s = %j, naming the parameter", (key, value) => {
      const parsed = parse({ [key]: value });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((issue) => issue.path[0] === key)).toBe(true);
      }
    });

    it("coerces a numeric string, as maxRows does", () => {
      const parsed = parse({ startLine: "12", endLine: "30" });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect((parsed.data as { startLine?: number }).startLine).toBe(12);
        expect((parsed.data as { endLine?: number }).endLine).toBe(30);
      }
    });

    it("accepts both parameters omitted, and either one alone", () => {
      expect(parse({}).success).toBe(true);
      expect(parse({ startLine: 1 }).success).toBe(true);
      expect(parse({ endLine: 1 }).success).toBe(true);
    });
  });

  describe("description", () => {
    it("names startLine, endLine, totalLines, ts and iris_doc_edit, and the etag of metadataOnly", () => {
      const description = docGetTool.description;

      for (const term of ["startLine", "endLine", "totalLines", "`ts`", "`iris_doc_edit`", "`etag`", "clamped"]) {
        expect(description, term).toContain(term);
      }
    });
  });
});
