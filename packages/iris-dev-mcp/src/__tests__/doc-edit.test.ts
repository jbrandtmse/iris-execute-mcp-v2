/**
 * Story 38.4 - `iris_doc_edit`: the I/O and edge-case matrix, against mock HTTP.
 *
 * The fakes are real Atelier shapes, captured live on 2026-10-15 (IRIS 2026.2 build 221U, Atelier v8,
 * HSCUSTOM): a `GET /doc` and a `PUT /doc` result have the nine keys `name, db, ts, upd, cat, status,
 * enc, flags, content`; a save of an existing document answers `flags: 0, content: []`; a document IRIS
 * refuses inside an HTTP 200 envelope has `ts: ""`, `content: ""` and a string `status` (ERROR #16021,
 * probe 4); and IRIS reformats class source on every save, so a re-read can have more lines than were
 * sent (probe 1: a blank line between members). No fake returns a BOM inside a document's `content`:
 * IRIS refuses BOM text (Rule #54).
 *
 * Every `unifiedDiff` literal below was captured by running `diff -U3 before.txt after.txt` (Apple diff,
 * based on FreeBSD diff) on fixture files holding exactly these lines, one line per array element and
 * the two header lines replaced (Rule #36).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  IrisApiError,
  REFUSAL_CODES,
  refusalResult,
  storageDroppedRefusal,
  textToLines,
  type ToolContext,
  type ToolResult,
} from "@iris-mcp/shared";
import { docEditTool, applyEdits, findStaleEdits, validateEdits, type LineEdit } from "../tools/doc-edit.js";
import { docGetTool } from "../tools/doc.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

const CLASS_NAME = "Test.Edit.cls";
const CLASS_PATH = "/api/atelier/v7/USER/doc/Test.Edit.cls";
const RTN_NAME = "Test.Edit.mac";
const RTN_PATH = "/api/atelier/v7/USER/doc/Test.Edit.mac";
const TS_READ = "2026-10-15 18:00:00.000";
const TS_SAVED = "2026-10-15 18:00:05.000";

/** A class as IRIS returns it: a blank line between members, and a trailing empty element. 13 lines. */
const CLASS_LINES = [
  "Class Test.Edit Extends %RegisteredObject",
  "{",
  "",
  "Property Alpha As %String;",
  "",
  "Method Run() As %Status",
  "{",
  "    Set tSC = $$$OK",
  "    Quit tSC",
  "}",
  "",
  "}",
  "",
];

/** A routine as IRIS returns it: exactly the lines sent, with no trailing empty element. */
const RTN_LINES = ["ROUTINE Test.Edit [Type=MAC]", "Main ; entry point", '    Write "hi",!', "    Quit"];

/** The document result of a GET (and the 409 body): the nine keys. */
function docResult(name: string, lines: string[], ts = TS_READ, cat = "CLS"): Record<string, unknown> {
  return { name, db: "HSCUSTOM", ts, upd: false, cat, status: "", enc: false, flags: 0, content: lines };
}

/** The result of a successful PUT of an existing document. */
function saveResult(name: string, ts = TS_SAVED, cat = "CLS"): Record<string, unknown> {
  return { name, db: "HSCUSTOM", ts, upd: false, cat, status: "", enc: false, flags: 0, content: [] };
}

/** The soft error: HTTP 200, the reason only in `result.status`, nothing stored (probe 4). */
const SOFT_ERROR_RESULT = {
  name: CLASS_NAME,
  db: "",
  ts: "",
  cat: "CLS",
  enc: false,
  content: "",
  status: "ERROR #16021: Illegal Header Line: Property Alpha As %String;",
};

/** The structured content of a result, as a record (`{}` when there is none). */
function sc(result: ToolResult): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

/** One numbered-text row: the number right-aligned in 6 columns, a TAB, the line. */
function row(lineNumber: number, line: string): string {
  return `${String(lineNumber).padStart(6)}\t${line}`;
}

/** The numbered rows of `lines`, the first numbered `first`. */
function rows(lines: readonly string[], first: number): string[] {
  return lines.map((line, index) => row(first + index, line));
}

/** The success text: the sentence, the diff, then one excerpt section per edit. */
function successText(
  sentence: string,
  diffRows: string[],
  sections: Array<{ heading: string; lines: string[] }>,
): string {
  return [
    sentence,
    "",
    ...diffRows,
    ...sections.flatMap((section) => ["", section.heading, ...section.lines]),
  ].join("\n");
}

/** The class after replacing lines 8-9 with three lines (diff -U3 oracle: class-before.txt vs class-s1.txt). */
const S1_LINES = [
  ...CLASS_LINES.slice(0, 7),
  '    Set tSC = $$$ERROR($$$GeneralError, "boom")',
  "    Do ..Log(tSC)",
  "    Quit tSC",
  ...CLASS_LINES.slice(9),
];

/** The class after `insert after 2`, `delete 5-5` and `replace 9-9` (diff -U3 oracle: class-s2.txt). */
const S2_LINES = [
  "Class Test.Edit Extends %RegisteredObject",
  "{",
  "Parameter MAX = 5;",
  "",
  "Property Alpha As %String;",
  "Method Run() As %Status",
  "{",
  "    Set tSC = $$$OK",
  "    Quit $$$OK",
  "}",
  "",
  "}",
  "",
];

const S2_EDITS: LineEdit[] = [
  { op: "replace", startLine: 9, endLine: 9, text: "    Quit $$$OK", expected: "    Quit tSC" },
  { op: "insert", afterLine: 2, text: "Parameter MAX = 5;", expected: "{" },
  { op: "delete", startLine: 5, endLine: 5, expected: "" },
];

describe("iris_doc_edit (Story 38.4)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  /** Queue the read, the save and (when given) the re-read of a document. */
  function arrange(options: {
    read: string[];
    reread?: string[];
    name?: string;
    cat?: string;
  }): void {
    const name = options.name ?? CLASS_NAME;
    const cat = options.cat ?? "CLS";
    mockHttp.get.mockResolvedValueOnce(envelope(docResult(name, options.read, TS_READ, cat)));
    if (options.reread !== undefined) {
      mockHttp.get.mockResolvedValueOnce(envelope(docResult(name, options.reread, TS_SAVED, cat)));
    }
    mockHttp.put.mockResolvedValue(envelope(saveResult(name, TS_SAVED, cat)));
  }

  function run(
    edits: unknown[],
    extra: { action?: string; name?: string; namespace?: string } = {},
  ): Promise<ToolResult> {
    return docEditTool.handler({ action: "apply", name: CLASS_NAME, edits, ...extra }, ctx);
  }

  /** The `content` array the first PUT sent. */
  function sentLines(): unknown {
    return (mockHttp.put.mock.calls[0]?.[1] as { content: unknown }).content;
  }

  /** No request at all. */
  function expectNoRequests(): void {
    expect(mockHttp.get.mock.calls).toEqual([]);
    expect(mockHttp.put.mock.calls).toEqual([]);
    expect(mockHttp.post.mock.calls).toEqual([]);
    expect(mockHttp.delete.mock.calls).toEqual([]);
    expect(mockHttp.head.mock.calls).toEqual([]);
  }

  describe("a replace (the matrix row 'Replace')", () => {
    it("reads once, saves once with the version of the read, re-reads, and answers from the re-read", async () => {
      arrange({ read: CLASS_LINES, reread: S1_LINES });

      const result = await run([
        {
          op: "replace",
          startLine: 8,
          endLine: 9,
          text: '    Set tSC = $$$ERROR($$$GeneralError, "boom")\n    Do ..Log(tSC)\n    Quit tSC\n',
          expected: "    Set tSC = $$$OK\n    Quit tSC",
        },
      ]);

      const diffRows = [
        "@@ -5,7 +5,8 @@",
        " ",
        " Method Run() As %Status",
        " {",
        "-    Set tSC = $$$OK",
        '+    Set tSC = $$$ERROR($$$GeneralError, "boom")',
        "+    Do ..Log(tSC)",
        "     Quit tSC",
        " }",
        " ",
      ];
      const unifiedDiff = [`--- ${CLASS_NAME}\t${TS_READ}`, `+++ ${CLASS_NAME}\t${TS_SAVED}`, ...diffRows].join("\n");
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: successText(
              `Document 'Test.Edit.cls' edited in namespace 'USER': 1 edit applied; it has 14 lines now (ts ${TS_SAVED}). It is not compiled: run iris_doc_compile next.`,
              [`--- ${CLASS_NAME}\t${TS_READ}`, `+++ ${CLASS_NAME}\t${TS_SAVED}`, ...diffRows],
              [{ heading: "Edit 1 (replace lines 8-9), now lines 5-13:", lines: rows(S1_LINES.slice(4, 13), 5) }],
            ),
          },
        ],
        structuredContent: {
          name: CLASS_NAME,
          namespace: "USER",
          ts: TS_SAVED,
          totalLines: 14,
          changed: true,
          unifiedDiff,
          excerpts: [
            { edit: 1, op: "replace", startLine: 5, endLine: 13, lines: S1_LINES.slice(4, 13) },
          ],
        },
      });
      expect(mockHttp.get.mock.calls).toEqual([[CLASS_PATH], [CLASS_PATH]]);
      expect(mockHttp.put.mock.calls).toEqual([
        [CLASS_PATH, { enc: false, content: S1_LINES }, { headers: { "If-None-Match": TS_READ } }],
      ]);
    });

    it("sends no compile request and nothing but the document path (AC-8)", async () => {
      arrange({ read: CLASS_LINES, reread: S1_LINES });

      const result = await run([
        { op: "replace", startLine: 8, endLine: 8, text: "    Set tSC = $$$ERROR(1)", expected: "    Set tSC = $$$OK" },
      ]);

      expect(result.isError).toBeUndefined();
      expect(mockHttp.post.mock.calls).toEqual([]);
      expect(mockHttp.delete.mock.calls).toEqual([]);
      expect(mockHttp.head.mock.calls).toEqual([]);
      for (const call of [...mockHttp.get.mock.calls, ...mockHttp.put.mock.calls]) {
        expect(call[0]).toBe(CLASS_PATH);
      }
      expect(result.content[0]?.text).toContain("It is not compiled: run iris_doc_compile next.");
    });

    it("targets the namespace the caller names, and URL-encodes a %-prefixed name", async () => {
      mockHttp.get.mockResolvedValueOnce(envelope(docResult("%Test.Edit.cls", CLASS_LINES)));
      mockHttp.get.mockResolvedValueOnce(envelope(docResult("%Test.Edit.cls", CLASS_LINES, TS_SAVED)));
      mockHttp.put.mockResolvedValue(envelope(saveResult("%Test.Edit.cls")));

      await run([{ op: "replace", startLine: 8, endLine: 8, text: "    Set tSC = 2", expected: "    Set tSC = $$$OK" }], {
        name: "%Test.Edit.cls",
        namespace: "SAMPLES",
      });

      const path = "/api/atelier/v7/SAMPLES/doc/%25Test.Edit.cls";
      expect(mockHttp.get.mock.calls[0]).toEqual([path]);
      expect(mockHttp.put.mock.calls[0]?.[0]).toBe(path);
    });
  });

  describe("several edits (the matrix row 'Several edits')", () => {
    it("applies insert + delete + replace bottom-up against the read numbering, and numbers excerpts by input order", async () => {
      arrange({ read: CLASS_LINES, reread: S2_LINES });

      const result = await run(S2_EDITS);

      const diffRows = [
        "@@ -1,12 +1,12 @@",
        " Class Test.Edit Extends %RegisteredObject",
        " {",
        "+Parameter MAX = 5;",
        " ",
        " Property Alpha As %String;",
        "-",
        " Method Run() As %Status",
        " {",
        "     Set tSC = $$$OK",
        "-    Quit tSC",
        "+    Quit $$$OK",
        " }",
        " ",
        " }",
      ];
      expect(sentLines()).toEqual(S2_LINES);
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: successText(
              `Document 'Test.Edit.cls' edited in namespace 'USER': 3 edits applied; it has 13 lines now (ts ${TS_SAVED}). It is not compiled: run iris_doc_compile next.`,
              [`--- ${CLASS_NAME}\t${TS_READ}`, `+++ ${CLASS_NAME}\t${TS_SAVED}`, ...diffRows],
              [
                { heading: "Edit 1 (replace lines 9-9), now lines 6-12:", lines: rows(S2_LINES.slice(5, 12), 6) },
                { heading: "Edit 2 (insert after line 2), now lines 1-6:", lines: rows(S2_LINES.slice(0, 6), 1) },
                { heading: "Edit 3 (delete lines 5-5), now lines 3-8:", lines: rows(S2_LINES.slice(2, 8), 3) },
              ],
            ),
          },
        ],
        structuredContent: {
          name: CLASS_NAME,
          namespace: "USER",
          ts: TS_SAVED,
          totalLines: 13,
          changed: true,
          unifiedDiff: [`--- ${CLASS_NAME}\t${TS_READ}`, `+++ ${CLASS_NAME}\t${TS_SAVED}`, ...diffRows].join("\n"),
          excerpts: [
            { edit: 1, op: "replace", startLine: 6, endLine: 12, lines: S2_LINES.slice(5, 12) },
            { edit: 2, op: "insert", startLine: 1, endLine: 6, lines: S2_LINES.slice(0, 6) },
            { edit: 3, op: "delete", startLine: 3, endLine: 8, lines: S2_LINES.slice(2, 8) },
          ],
        },
      });
      expect(mockHttp.put.mock.calls).toHaveLength(1);
    });

    const PERMUTATIONS = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const order of PERMUTATIONS) {
      it(`one save carries the same lines when the edits come in the order ${order.join(",")}`, async () => {
        arrange({ read: CLASS_LINES, reread: S2_LINES });

        const result = await run(order.map((index) => S2_EDITS[index]));

        expect(result.isError).toBeUndefined();
        expect(sentLines()).toEqual(S2_LINES);
        expect(mockHttp.put.mock.calls).toHaveLength(1);
      });
    }

    it("accepts an insert next to a range it does not lie inside: after the line before it, and after its last line", async () => {
      const expectedLines = [
        ...CLASS_LINES.slice(0, 7),
        "    // before",
        "    Quit $$$OK",
        "    // after",
        ...CLASS_LINES.slice(9),
      ];
      arrange({ read: CLASS_LINES, reread: expectedLines });

      const result = await run([
        { op: "insert", afterLine: 9, text: "    // after", expected: "    Quit tSC" },
        {
          op: "replace",
          startLine: 8,
          endLine: 9,
          text: "    Quit $$$OK",
          expected: "    Set tSC = $$$OK\n    Quit tSC",
        },
        { op: "insert", afterLine: 7, text: "    // before", expected: "{" },
      ]);

      expect(result.isError).toBeUndefined();
      expect(sentLines()).toEqual(expectedLines);
    });
  });

  describe("positions and forms (Rule #58 fixtures)", () => {
    it("inserts before line 1 with afterLine 0, whose expected text is line 1", async () => {
      const after = ["// header", ...CLASS_LINES];
      arrange({ read: CLASS_LINES, reread: after });

      const result = await run([
        { op: "insert", afterLine: 0, text: "// header", expected: "Class Test.Edit Extends %RegisteredObject" },
      ]);

      expect(sentLines()).toEqual(after);
      expect(result.structuredContent).toEqual({
        name: CLASS_NAME,
        namespace: "USER",
        ts: TS_SAVED,
        totalLines: 14,
        changed: true,
        unifiedDiff: [
          `--- ${CLASS_NAME}\t${TS_READ}`,
          `+++ ${CLASS_NAME}\t${TS_SAVED}`,
          "@@ -1,3 +1,4 @@",
          "+// header",
          " Class Test.Edit Extends %RegisteredObject",
          " {",
          " ",
        ].join("\n"),
        excerpts: [{ edit: 1, op: "insert", startLine: 1, endLine: 4, lines: after.slice(0, 4) }],
      });
    });

    it("replaces line 1", async () => {
      const after = ["Class Test.Edit Extends %Persistent", ...CLASS_LINES.slice(1)];
      arrange({ read: CLASS_LINES, reread: after });

      await run([
        {
          op: "replace",
          startLine: 1,
          endLine: 1,
          text: "Class Test.Edit Extends %Persistent",
          expected: "Class Test.Edit Extends %RegisteredObject",
        },
      ]);

      expect(sentLines()).toEqual(after);
    });

    it("a class: replaces its last line, the trailing empty element, and inserts after it", async () => {
      const replaced = [...CLASS_LINES.slice(0, 12), "// end"];
      arrange({ read: CLASS_LINES, reread: replaced });
      await run([{ op: "replace", startLine: 13, endLine: 13, text: "// end", expected: "" }]);
      expect(sentLines()).toEqual(replaced);

      mockHttp = createMockHttp();
      ctx = createMockCtx(mockHttp);
      const appended = [...CLASS_LINES, "// tail"];
      arrange({ read: CLASS_LINES, reread: appended });
      const result = await run([{ op: "insert", afterLine: 13, text: "// tail", expected: "" }]);
      expect(result.isError).toBeUndefined();
      expect(sentLines()).toEqual(appended);
    });

    it("a routine with no trailing empty element: replaces its last line and adds none", async () => {
      const after = [...RTN_LINES.slice(0, 3), "    Quit 1"];
      arrange({ read: RTN_LINES, reread: after, name: RTN_NAME, cat: "RTN" });

      const result = await run([{ op: "replace", startLine: 4, endLine: 4, text: "    Quit 1", expected: "    Quit" }], {
        name: RTN_NAME,
      });

      expect(sentLines()).toEqual(after);
      expect(mockHttp.put.mock.calls[0]?.[0]).toBe(RTN_PATH);
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: successText(
              `Document 'Test.Edit.mac' edited in namespace 'USER': 1 edit applied; it has 4 lines now (ts ${TS_SAVED}). It is not compiled: run iris_doc_compile next.`,
              [
                `--- ${RTN_NAME}\t${TS_READ}`,
                `+++ ${RTN_NAME}\t${TS_SAVED}`,
                "@@ -1,4 +1,4 @@",
                " ROUTINE Test.Edit [Type=MAC]",
                " Main ; entry point",
                '     Write "hi",!',
                "-    Quit",
                "+    Quit 1",
              ],
              [{ heading: "Edit 1 (replace lines 4-4), now lines 1-4:", lines: rows(after, 1) }],
            ),
          },
        ],
        structuredContent: {
          name: RTN_NAME,
          namespace: "USER",
          ts: TS_SAVED,
          totalLines: 4,
          changed: true,
          unifiedDiff: [
            `--- ${RTN_NAME}\t${TS_READ}`,
            `+++ ${RTN_NAME}\t${TS_SAVED}`,
            "@@ -1,4 +1,4 @@",
            " ROUTINE Test.Edit [Type=MAC]",
            " Main ; entry point",
            '     Write "hi",!',
            "-    Quit",
            "+    Quit 1",
          ].join("\n"),
          excerpts: [{ edit: 1, op: "replace", startLine: 1, endLine: 4, lines: after }],
        },
      });
    });

    it("parses text and expected with CRLF, a trailing newline and tabs, and leaves the lines untouched alone", async () => {
      const after = [
        ...CLASS_LINES.slice(0, 7),
        "\tSet a = 1",
        "\t\tSet b = 2",
        ...CLASS_LINES.slice(8),
      ];
      arrange({ read: CLASS_LINES, reread: after });

      const result = await run([
        {
          op: "replace",
          startLine: 8,
          endLine: 8,
          text: "\tSet a = 1\r\n\t\tSet b = 2\r\n",
          expected: "    Set tSC = $$$OK\r\n",
        },
      ]);

      expect(result.isError).toBeUndefined();
      expect(sentLines()).toEqual(after);
    });

    it("a trailing newline and none in text give the same saved lines", async () => {
      for (const text of ["    Set x = 1\n    Set y = 2", "    Set x = 1\n    Set y = 2\n", "    Set x = 1\r\n    Set y = 2\r\n"]) {
        mockHttp = createMockHttp();
        ctx = createMockCtx(mockHttp);
        const after = [...CLASS_LINES.slice(0, 7), "    Set x = 1", "    Set y = 2", ...CLASS_LINES.slice(8)];
        arrange({ read: CLASS_LINES, reread: after });

        await run([{ op: "replace", startLine: 8, endLine: 8, text, expected: "    Set tSC = $$$OK" }]);

        expect(sentLines(), JSON.stringify(text)).toEqual(after);
      }
    });

    it("strips one leading BOM from text and from expected, and sends none", async () => {
      const after = ["Class Test.Edit Extends %Persistent", ...CLASS_LINES.slice(1)];
      arrange({ read: CLASS_LINES, reread: after });

      const result = await run([
        {
          op: "replace",
          startLine: 1,
          endLine: 1,
          text: "\uFEFFClass Test.Edit Extends %Persistent",
          expected: "\uFEFFClass Test.Edit Extends %RegisteredObject",
        },
      ]);

      expect(result.isError).toBeUndefined();
      expect(sentLines()).toEqual(after);
      expect((sentLines() as string[]).some((line) => line.includes("\uFEFF"))).toBe(false);
    });

    it("an empty text replaces the addressed lines with one empty line", async () => {
      const after = [...CLASS_LINES.slice(0, 2), "", ...CLASS_LINES.slice(5)];
      arrange({ read: CLASS_LINES, reread: after });

      const result = await run([
        { op: "replace", startLine: 3, endLine: 5, text: "", expected: "\nProperty Alpha As %String;\n\n" },
      ]);

      expect(result.isError).toBeUndefined();
      expect(sentLines()).toEqual(after);
    });

    it("a multi-line expected must match every addressed line", async () => {
      const after = [...CLASS_LINES.slice(0, 5), ...CLASS_LINES.slice(9)];
      arrange({ read: CLASS_LINES, reread: after });

      const result = await run([
        {
          op: "delete",
          startLine: 6,
          endLine: 9,
          expected: "Method Run() As %Status\n{\n    Set tSC = $$$OK\n    Quit tSC",
        },
      ]);

      expect(result.isError).toBeUndefined();
      expect(sentLines()).toEqual(after);
      expect(sc(result).excerpts).toEqual([
        { edit: 1, op: "delete", startLine: 3, endLine: 8, lines: after.slice(2, 8) },
      ]);
    });

    it("sends the lines no edit touches byte-identical: trailing spaces, a tab, and a trailing carriage return", async () => {
      const read = ["Class Test.Edit {", "  trailing  ", "cr\r", "tab\t", "x", "}", ""];
      const after = ["Class Test.Edit {", "  trailing  ", "cr\r", "tab\t", "y", "}", ""];
      arrange({ read, reread: after });

      const result = await run([{ op: "replace", startLine: 5, endLine: 5, text: "y", expected: "x" }]);

      expect(result.isError).toBeUndefined();
      expect(sentLines()).toEqual(after);
      expect((sentLines() as string[])[1]).toBe("  trailing  ");
      expect((sentLines() as string[])[2]).toBe("cr\r");
      expect((sentLines() as string[])[3]).toBe("tab\t");
    });

    it("an expected without the carriage return does not match a line that ends with one", async () => {
      arrange({ read: ["Class Test.Edit {", "cr\r", "}", ""] });

      const result = await run([{ op: "delete", startLine: 2, endLine: 2, expected: "cr" }]);

      expect(result.isError).toBe(true);
      expect(sc(result).code).toBe("STALE_CONTENT");
      expect(mockHttp.put.mock.calls).toEqual([]);
    });
  });

  describe("an edit that IRIS stores differently from what was sent (the matrix row 'IRIS reformats')", () => {
    it("answers from the re-read: the added blank line is in unifiedDiff and in the excerpt", async () => {
      const sent = [...CLASS_LINES.slice(0, 4), "Property Beta As %String;", ...CLASS_LINES.slice(4)];
      const stored = [
        ...CLASS_LINES.slice(0, 4),
        "",
        "Property Beta As %String;",
        ...CLASS_LINES.slice(4),
      ];
      arrange({ read: CLASS_LINES, reread: stored });

      const result = await run([
        { op: "insert", afterLine: 4, text: "Property Beta As %String;", expected: "Property Alpha As %String;" },
      ]);

      const diffRows = [
        "@@ -3,6 +3,8 @@",
        " ",
        " Property Alpha As %String;",
        " ",
        "+Property Beta As %String;",
        "+",
        " Method Run() As %Status",
        " {",
        "     Set tSC = $$$OK",
      ];
      expect(sentLines()).toEqual(sent);
      expect(stored).toHaveLength(15);
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: successText(
              `Document 'Test.Edit.cls' edited in namespace 'USER': 1 edit applied; it has 15 lines now (ts ${TS_SAVED}). It is not compiled: run iris_doc_compile next.`,
              [`--- ${CLASS_NAME}\t${TS_READ}`, `+++ ${CLASS_NAME}\t${TS_SAVED}`, ...diffRows],
              [{ heading: "Edit 1 (insert after line 4), now lines 2-9:", lines: rows(stored.slice(1, 9), 2) }],
            ),
          },
        ],
        structuredContent: {
          name: CLASS_NAME,
          namespace: "USER",
          ts: TS_SAVED,
          totalLines: 15,
          changed: true,
          unifiedDiff: [`--- ${CLASS_NAME}\t${TS_READ}`, `+++ ${CLASS_NAME}\t${TS_SAVED}`, ...diffRows].join("\n"),
          excerpts: [{ edit: 1, op: "insert", startLine: 2, endLine: 9, lines: stored.slice(1, 9) }],
        },
      });
    });

    it("never builds the answer from the locally edited lines", async () => {
      const stored = [...S1_LINES.slice(0, 3), "// stored differently", ...S1_LINES.slice(3)];
      arrange({ read: CLASS_LINES, reread: stored });

      const result = await run([
        {
          op: "replace",
          startLine: 8,
          endLine: 9,
          text: S1_LINES.slice(7, 10).join("\n"),
          expected: "    Set tSC = $$$OK\n    Quit tSC",
        },
      ]);

      expect(sc(result).totalLines).toBe(15);
      expect(sc(result).unifiedDiff).toContain("+// stored differently");
    });

    it("a class edit that IRIS stores back as it was is changed: false, and says so", async () => {
      // Captured live on 2026-10-15 (IRIS 2026.2 build 221U, HSCUSTOM): saving a class without the
      // blank line between two members stores the read's text again, with the read's ts.
      const sent = [...CLASS_LINES.slice(0, 4), ...CLASS_LINES.slice(5)];
      mockHttp.get.mockResolvedValueOnce(envelope(docResult(CLASS_NAME, CLASS_LINES, TS_READ)));
      mockHttp.put.mockResolvedValueOnce(envelope(saveResult(CLASS_NAME, TS_READ)));
      mockHttp.get.mockResolvedValueOnce(envelope(docResult(CLASS_NAME, CLASS_LINES, TS_READ)));

      const result = await run([{ op: "delete", startLine: 5, endLine: 5, expected: "" }]);

      expect(mockHttp.put.mock.calls).toEqual([
        [CLASS_PATH, { enc: false, content: sent }, { headers: { "If-None-Match": TS_READ } }],
      ]);
      expect(mockHttp.get.mock.calls).toEqual([[CLASS_PATH], [CLASS_PATH]]);
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: [
              `Document 'Test.Edit.cls' was saved in namespace 'USER', but IRIS stored the text it already had, so nothing changed; it has 13 lines (ts ${TS_READ}). IRIS reformats class source when it saves, so the edit has no effect.`,
              "",
              "Edit 1 (delete lines 5-5), now lines 2-8:",
              ...rows(CLASS_LINES.slice(1, 8), 2),
            ].join("\n"),
          },
        ],
        structuredContent: {
          name: CLASS_NAME,
          namespace: "USER",
          ts: TS_READ,
          totalLines: 13,
          changed: false,
          unifiedDiff: "",
          excerpts: [{ edit: 1, op: "delete", startLine: 2, endLine: 8, lines: CLASS_LINES.slice(1, 8) }],
        },
      });
    });
  });

  describe("no change (the matrix row 'No change')", () => {
    it("saves nothing and re-reads nothing, and answers from the read", async () => {
      arrange({ read: CLASS_LINES });

      const result = await run([
        { op: "replace", startLine: 8, endLine: 8, text: "    Set tSC = $$$OK\n", expected: "    Set tSC = $$$OK" },
      ]);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: `Document 'Test.Edit.cls' in namespace 'USER' already has the edited text, so nothing was saved; it has 13 lines (ts ${TS_READ}).`,
          },
        ],
        structuredContent: {
          name: CLASS_NAME,
          namespace: "USER",
          ts: TS_READ,
          totalLines: 13,
          changed: false,
          unifiedDiff: "",
          excerpts: [{ edit: 1, op: "replace", startLine: 5, endLine: 11, lines: CLASS_LINES.slice(4, 11) }],
        },
      });
      expect(mockHttp.get.mock.calls).toEqual([[CLASS_PATH]]);
      expect(mockHttp.put.mock.calls).toEqual([]);
    });
  });

  describe("stale content (the matrix row 'Stale')", () => {
    it("refuses a text that differs, with the current text, and sends no save", async () => {
      arrange({ read: CLASS_LINES });

      const result = await run([
        { op: "replace", startLine: 8, endLine: 9, text: "x", expected: "    Set tSC = $$$OK\n    Quit 1" },
      ]);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: [
              "Document 'Test.Edit.cls' was not changed in namespace 'USER': the expected text of edit 1 does not match the document now. Nothing was stored. Retry with the current text below as expected, or read the lines again with iris_doc_get.",
              "",
              "Edit 1 (replace lines 8-9), current text:",
              row(8, "    Set tSC = $$$OK"),
              row(9, "    Quit tSC"),
            ].join("\n"),
          },
        ],
        structuredContent: {
          code: "STALE_CONTENT",
          name: CLASS_NAME,
          namespace: "USER",
          ts: TS_READ,
          totalLines: 13,
          mismatches: [
            { edit: 1, op: "replace", startLine: 8, endLine: 9, current: "    Set tSC = $$$OK\n    Quit tSC\n" },
          ],
        },
        isError: true,
      });
      expect(sc(result).code).toBe(REFUSAL_CODES.STALE_CONTENT);
      expect(mockHttp.get.mock.calls).toEqual([[CLASS_PATH]]);
      expect(mockHttp.put.mock.calls).toEqual([]);
    });

    it("a wrong line count is a mismatch: one expected line for two addressed lines", async () => {
      arrange({ read: CLASS_LINES });

      const result = await run([{ op: "delete", startLine: 8, endLine: 9, expected: "    Set tSC = $$$OK" }]);

      expect(result.isError).toBe(true);
      expect(sc(result).mismatches).toEqual([
        { edit: 1, op: "delete", startLine: 8, endLine: 9, current: "    Set tSC = $$$OK\n    Quit tSC\n" },
      ]);
      expect(mockHttp.put.mock.calls).toEqual([]);
    });

    it("lists every mismatch, in edit order, and names an insert's anchor line", async () => {
      arrange({ read: CLASS_LINES });

      const result = await run([
        { op: "replace", startLine: 4, endLine: 4, text: "x", expected: "Property Wrong" },
        { op: "insert", afterLine: 6, text: "y", expected: "Method Run() As %Status" },
        { op: "insert", afterLine: 0, text: "z", expected: "Class Wrong" },
      ]);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: [
              "Document 'Test.Edit.cls' was not changed in namespace 'USER': the expected text of edits 1, 3 do not match the document now. Nothing was stored. Retry with the current text below as expected, or read the lines again with iris_doc_get.",
              "",
              "Edit 1 (replace lines 4-4), current text:",
              row(4, "Property Alpha As %String;"),
              "",
              "Edit 3 (insert after line 0), current text of line 1:",
              row(1, "Class Test.Edit Extends %RegisteredObject"),
            ].join("\n"),
          },
        ],
        structuredContent: {
          code: "STALE_CONTENT",
          name: CLASS_NAME,
          namespace: "USER",
          ts: TS_READ,
          totalLines: 13,
          mismatches: [
            { edit: 1, op: "replace", startLine: 4, endLine: 4, current: "Property Alpha As %String;\n" },
            { edit: 3, op: "insert", startLine: 1, endLine: 1, current: "Class Test.Edit Extends %RegisteredObject\n" },
          ],
        },
        isError: true,
      });
      expect(mockHttp.put.mock.calls).toEqual([]);
    });

    it("checks the range before the expected text", async () => {
      arrange({ read: CLASS_LINES });

      const result = await run([
        { op: "replace", startLine: 4, endLine: 4, text: "x", expected: "Property Wrong" },
        { op: "delete", startLine: 20, endLine: 21, expected: "gone" },
      ]);

      expect(result.structuredContent).toBeUndefined();
      expect(result.content[0]?.text).toContain("Edit 2 (delete) addresses line 20");
    });
  });

  describe("the current text passed back as expected (DW-552)", () => {
    /** Every range shape of the matrix, on the 13-line CLASS_LINES (lines 3, 5, 11 and 13 are empty). */
    const RANGES: Array<{ label: string; startLine: number; endLine: number }> = [
      { label: "one line", startLine: 4, endLine: 4 },
      { label: "one empty line", startLine: 3, endLine: 3 },
      { label: "several lines", startLine: 8, endLine: 9 },
      { label: "a range that ends in an empty line", startLine: 4, endLine: 5 },
      { label: "a range that starts and ends in empty lines", startLine: 3, endLine: 5 },
      { label: "the document's last line (an empty element)", startLine: 13, endLine: 13 },
      { label: "the last two lines", startLine: 12, endLine: 13 },
    ];

    /** Run an edit and, when it is refused as stale, the same edit with `current` as `expected`. */
    async function refuseThenRetry(
      stale: Record<string, unknown>,
      retry: (current: string) => Record<string, unknown>,
    ): Promise<{ refusal: ToolResult; current: string; retried: ToolResult; edit: LineEdit }> {
      arrange({ read: CLASS_LINES });
      const refusal = await run([stale]);
      expect(refusal.isError).toBe(true);
      expect(sc(refusal).code).toBe("STALE_CONTENT");
      expect(mockHttp.put.mock.calls).toEqual([]);
      const mismatches = sc(refusal).mismatches as Array<{ current: string }>;
      expect(mismatches).toHaveLength(1);
      const current = (mismatches[0] as { current: string }).current;

      const edit = retry(current) as unknown as LineEdit;
      const after = applyEdits([edit], CLASS_LINES).lines;
      mockHttp = createMockHttp();
      ctx = createMockCtx(mockHttp);
      arrange({ read: CLASS_LINES, reread: after });
      const retried = await run([edit]);
      return { refusal, current, retried, edit };
    }

    for (const range of RANGES) {
      it(`a replace of ${range.label}: current parses back to the addressed lines, and passed back as expected the edit applies`, async () => {
        const addressed = CLASS_LINES.slice(range.startLine - 1, range.endLine);
        const { current, retried, edit } = await refuseThenRetry(
          { op: "replace", startLine: range.startLine, endLine: range.endLine, text: "Replaced", expected: "no such text" },
          (value) => ({ op: "replace", startLine: range.startLine, endLine: range.endLine, text: "Replaced", expected: value }),
        );

        expect(current.endsWith("\n")).toBe(true);
        expect(textToLines(current)).toEqual(addressed);
        expect(retried.isError).toBeUndefined();
        expect(sc(retried).changed).toBe(true);
        expect(mockHttp.put.mock.calls).toHaveLength(1);
        expect(sentLines()).toEqual(applyEdits([edit], CLASS_LINES).lines);
      });
    }

    it("a delete of a range that ends in an empty line applies with current passed back", async () => {
      const { current, retried } = await refuseThenRetry(
        { op: "delete", startLine: 4, endLine: 5, expected: "no such text" },
        (value) => ({ op: "delete", startLine: 4, endLine: 5, expected: value }),
      );

      expect(textToLines(current)).toEqual(["Property Alpha As %String;", ""]);
      expect(retried.isError).toBeUndefined();
      expect(sentLines()).toEqual([...CLASS_LINES.slice(0, 3), ...CLASS_LINES.slice(5)]);
    });

    for (const anchor of [
      { label: "line 1 (afterLine 0)", afterLine: 0, line: 1 },
      { label: "an empty anchor line", afterLine: 3, line: 3 },
      { label: "the last line, which is empty", afterLine: 13, line: 13 },
    ]) {
      it(`an insert after ${anchor.label}: current is the anchor line, and passed back as expected the insert applies`, async () => {
        const { current, retried, edit } = await refuseThenRetry(
          { op: "insert", afterLine: anchor.afterLine, text: "Inserted", expected: "no such text" },
          (value) => ({ op: "insert", afterLine: anchor.afterLine, text: "Inserted", expected: value }),
        );

        expect(textToLines(current)).toEqual([CLASS_LINES[anchor.line - 1]]);
        expect(retried.isError).toBeUndefined();
        expect(sentLines()).toEqual(applyEdits([edit], CLASS_LINES).lines);
      });
    }

    it("a wrong expected written with CRLF line breaks is refused with the same LF-based current, and current applies", async () => {
      const { refusal, current, retried } = await refuseThenRetry(
        { op: "replace", startLine: 8, endLine: 9, text: "Replaced", expected: "wrong 1\r\nwrong 2\r\n" },
        (value) => ({ op: "replace", startLine: 8, endLine: 9, text: "Replaced", expected: value }),
      );

      expect(current).toBe("    Set tSC = $$$OK\n    Quit tSC\n");
      expect(sc(refusal).mismatches).toEqual([{ edit: 1, op: "replace", startLine: 8, endLine: 9, current }]);
      expect(retried.isError).toBeUndefined();
    });

    it("the text block of the refusal does not carry the trailing line break of current", async () => {
      arrange({ read: CLASS_LINES });

      const result = await run([{ op: "replace", startLine: 4, endLine: 5, text: "x", expected: "no such text" }]);

      expect(result.content[0]?.text.endsWith(`${row(5, "")}`)).toBe(true);
      expect(result.content[0]?.text).toContain(row(4, "Property Alpha As %String;"));
    });

    it("an expected built from a ranged iris_doc_get read, each line followed by a line break, matches", async () => {
      for (const range of RANGES) {
        mockHttp = createMockHttp();
        ctx = createMockCtx(mockHttp);
        mockHttp.get.mockResolvedValueOnce(envelope(docResult(CLASS_NAME, CLASS_LINES)));
        const read = await docGetTool.handler(
          { name: CLASS_NAME, startLine: range.startLine, endLine: range.endLine },
          ctx,
        );
        const lines = (read.structuredContent as { lines: string[] }).lines;
        expect(lines, range.label).toEqual(CLASS_LINES.slice(range.startLine - 1, range.endLine));
        const expected = lines.map((line) => `${line}\n`).join("");

        const edit = { op: "replace", startLine: range.startLine, endLine: range.endLine, text: "Replaced", expected };
        const after = applyEdits([edit as LineEdit], CLASS_LINES).lines;
        mockHttp.get.mockResolvedValueOnce(envelope(docResult(CLASS_NAME, CLASS_LINES)));
        mockHttp.get.mockResolvedValueOnce(envelope(docResult(CLASS_NAME, after, TS_SAVED)));
        mockHttp.put.mockResolvedValue(envelope(saveResult(CLASS_NAME, TS_SAVED)));
        const result = await run([edit]);

        expect(result.isError, range.label).toBeUndefined();
        expect(sc(result).changed, range.label).toBe(true);
      }
    });
  });

  describe("a conflict (the matrix row 'Conflict')", () => {
    it("reports DOCUMENT_CONFLICT after exactly one save, never retries, and never sends ignoreConflict", async () => {
      arrange({ read: CLASS_LINES });
      mockHttp.put.mockReset();
      mockHttp.put.mockRejectedValue(
        new IrisApiError(
          409,
          [],
          CLASS_PATH,
          `IRIS returned HTTP 409 for PUT ${CLASS_PATH}. Check the request parameters and try again.`,
          docResult(CLASS_NAME, ["changed"], "2026-10-15 18:00:03.000"),
        ),
      );

      const result = await run([
        { op: "replace", startLine: 8, endLine: 8, text: "    Set tSC = 2", expected: "    Set tSC = $$$OK" },
      ]);

      expect(result).toEqual(
        refusalResult(
          REFUSAL_CODES.DOCUMENT_CONFLICT,
          "Document 'Test.Edit.cls' was not changed in namespace 'USER': it changed on the server after this tool read it. Nothing was stored. Read the lines again with iris_doc_get and retry the edits against the current text.",
          { name: CLASS_NAME, namespace: "USER" },
        ),
      );
      expect(result.structuredContent).toEqual({ code: "DOCUMENT_CONFLICT", name: CLASS_NAME, namespace: "USER" });
      expect(mockHttp.put.mock.calls).toHaveLength(1);
      expect(mockHttp.put.mock.calls[0]?.[2]).toEqual({ headers: { "If-None-Match": TS_READ } });
      expect(JSON.stringify(mockHttp.put.mock.calls)).not.toContain("ignoreConflict");
      expect(mockHttp.get.mock.calls).toEqual([[CLASS_PATH]]);
    });
  });

  describe("the Storage guard (the matrix rows 'Storage drop', 'Override' and 'Non-class')", () => {
    const STORE_NAME = "Test.Store.cls";
    const STORE_PATH = "/api/atelier/v7/USER/doc/Test.Store.cls";
    const STORE_LINES = [
      "Class Test.Store Extends %Persistent",
      "{",
      "Property Name As %String;",
      "",
      "Storage Default",
      "{",
      '<Data name="StoreDefaultData">',
      '<Value name="1">',
      "<Value>%%CLASSNAME</Value>",
      "</Value>",
      "</Data>",
      "<DataLocation>^Test.StoreD</DataLocation>",
      "<DefaultData>StoreDefaultData</DefaultData>",
      "<IdLocation>^Test.StoreD</IdLocation>",
      "<IndexLocation>^Test.StoreI</IndexLocation>",
      "<StreamLocation>^Test.StoreS</StreamLocation>",
      "<Type>%Storage.Persistent</Type>",
      "}",
      "}",
      "",
    ];
    const WITHOUT_STORAGE = [...STORE_LINES.slice(0, 3), ...STORE_LINES.slice(18)];
    const DELETE_STORAGE = {
      op: "delete",
      startLine: 4,
      endLine: 18,
      expected: STORE_LINES.slice(3, 18).join("\n"),
    };
    const REMEDY =
      "Keep the Storage definitions in the edited lines, or run the same edits with action regenerateStorage (disabled unless an operator enables it) to let IRIS regenerate the storage.";

    it("refuses an apply that drops a Storage definition, with the remedy, and sends no save", async () => {
      arrange({ read: STORE_LINES, name: STORE_NAME });

      const result = await run([DELETE_STORAGE], { name: STORE_NAME });

      expect(result).toEqual(storageDroppedRefusal(STORE_NAME, "USER", ["Default"], REMEDY));
      expect(result.structuredContent).toEqual({
        code: "STORAGE_DROPPED",
        name: STORE_NAME,
        namespace: "USER",
        droppedStorage: ["Default"],
      });
      expect(result.content[0]?.text).toBe(
        "Document 'Test.Store.cls' was not saved in namespace 'USER': the content drops the Storage definition 'Default' that the class has now, and IRIS would generate new storage at the next compile, which can change how existing rows are read. Nothing was stored. " +
          REMEDY,
      );
      expect(mockHttp.get.mock.calls).toEqual([[STORE_PATH]]);
      expect(mockHttp.put.mock.calls).toEqual([]);
    });

    it("regenerateStorage saves the same edits", async () => {
      arrange({ read: STORE_LINES, reread: WITHOUT_STORAGE, name: STORE_NAME });

      const result = await run([DELETE_STORAGE], { name: STORE_NAME, action: "regenerateStorage" });

      expect(result.isError).toBeUndefined();
      expect(sc(result).changed).toBe(true);
      expect(sentLines()).toEqual(WITHOUT_STORAGE);
      expect(mockHttp.get.mock.calls).toEqual([[STORE_PATH], [STORE_PATH]]);
      expect(mockHttp.put.mock.calls).toHaveLength(1);
    });

    it("an apply that keeps the Storage definitions is saved", async () => {
      const after = [...STORE_LINES.slice(0, 2), "Property Name As %Integer;", ...STORE_LINES.slice(3)];
      arrange({ read: STORE_LINES, reread: after, name: STORE_NAME });

      const result = await run(
        [{ op: "replace", startLine: 3, endLine: 3, text: "Property Name As %Integer;", expected: "Property Name As %String;" }],
        { name: STORE_NAME },
      );

      expect(result.isError).toBeUndefined();
      expect(sentLines()).toEqual(after);
    });

    for (const [name, cat, extension] of [
      ["Test.Edit.mac", "RTN", "a routine"],
      ["Test.Edit.inc", "RTN", "an include file"],
    ] as const) {
      it(`${extension} is never scanned for Storage, whichever the action`, async () => {
        const read = ["ROUTINE Test.Edit", "Storage Default", "{", "}", "    Quit"];
        for (const action of ["apply", "regenerateStorage"]) {
          mockHttp = createMockHttp();
          ctx = createMockCtx(mockHttp);
          arrange({ read, reread: [read[0] as string, read[4] as string], name, cat });

          const result = await run([{ op: "delete", startLine: 2, endLine: 4, expected: "Storage Default\n{\n}" }], {
            name,
            action,
          });

          expect(result.isError, `${name} ${action}`).toBeUndefined();
          expect(sentLines()).toEqual(["ROUTINE Test.Edit", "    Quit"]);
        }
      });
    }
  });

  describe("shape errors (the matrix row 'Shape'): no request", () => {
    const cases: Array<[string, unknown[], string]> = [
      [
        "an insert missing afterLine",
        [{ op: "insert", text: "x", expected: "y" }],
        "Edit 1 (insert) is missing afterLine. An insert takes afterLine, text and expected.",
      ],
      [
        "an insert missing text",
        [{ op: "insert", afterLine: 3, expected: "y" }],
        "Edit 1 (insert) is missing text. An insert takes afterLine, text and expected.",
      ],
      [
        "a delete missing endLine",
        [{ op: "delete", startLine: 3, expected: "y" }],
        "Edit 1 (delete) is missing endLine. A delete takes startLine, endLine and expected.",
      ],
      [
        "a delete missing startLine",
        [{ op: "delete", endLine: 3, expected: "y" }],
        "Edit 1 (delete) is missing startLine. A delete takes startLine, endLine and expected.",
      ],
      [
        "a replace missing text",
        [{ op: "replace", startLine: 3, endLine: 4, expected: "y" }],
        "Edit 1 (replace) is missing text. A replace takes startLine, endLine, text and expected.",
      ],
      [
        "a replace missing startLine, as the second edit",
        [
          { op: "delete", startLine: 1, endLine: 1, expected: "y" },
          { op: "replace", endLine: 4, text: "x", expected: "y" },
        ],
        "Edit 2 (replace) is missing startLine. A replace takes startLine, endLine, text and expected.",
      ],
      [
        "an insert carrying startLine",
        [{ op: "insert", afterLine: 3, startLine: 3, text: "x", expected: "y" }],
        "Edit 1 (insert) does not take startLine. An insert takes afterLine, text and expected.",
      ],
      [
        "an insert carrying endLine",
        [{ op: "insert", afterLine: 3, endLine: 3, text: "x", expected: "y" }],
        "Edit 1 (insert) does not take endLine. An insert takes afterLine, text and expected.",
      ],
      [
        "a delete carrying text, even an empty one",
        [{ op: "delete", startLine: 3, endLine: 3, text: "", expected: "y" }],
        "Edit 1 (delete) does not take text. A delete takes startLine, endLine and expected.",
      ],
      [
        "a delete carrying afterLine 0",
        [{ op: "delete", startLine: 3, endLine: 3, afterLine: 0, expected: "y" }],
        "Edit 1 (delete) does not take afterLine. A delete takes startLine, endLine and expected.",
      ],
      [
        "a replace carrying afterLine",
        [{ op: "replace", startLine: 3, endLine: 3, afterLine: 2, text: "x", expected: "y" }],
        "Edit 1 (replace) does not take afterLine. A replace takes startLine, endLine, text and expected.",
      ],
      [
        "startLine after endLine",
        [{ op: "replace", startLine: 5, endLine: 4, text: "x", expected: "y" }],
        "Edit 1 (replace): startLine 5 is after endLine 4. Pass a startLine that is less than or equal to endLine.",
      ],
      [
        "startLine after endLine on a delete",
        [{ op: "delete", startLine: 9, endLine: 2, expected: "y" }],
        "Edit 1 (delete): startLine 9 is after endLine 2. Pass a startLine that is less than or equal to endLine.",
      ],
    ];
    for (const [title, edits, text] of cases) {
      it(`${title}: names the edit, the field and what the op takes`, async () => {
        const result = await run(edits);

        expect(result).toEqual({ content: [{ type: "text", text }], isError: true });
        expect(result.structuredContent).toBeUndefined();
        expectNoRequests();
      });
    }

    it("reports a missing field before a surplus one, and a shape error before an overlap", async () => {
      const result = await run([
        { op: "replace", startLine: 3, endLine: 5, text: "x", expected: "y" },
        { op: "replace", startLine: 4, endLine: 6, text: "x", expected: "y" },
        { op: "insert", text: "x", expected: "y", startLine: 1 },
      ]);

      expect(result.content[0]?.text).toBe(
        "Edit 3 (insert) is missing afterLine. An insert takes afterLine, text and expected.",
      );
      expectNoRequests();
    });
  });

  describe("overlaps (the matrix row 'Overlap'): no request", () => {
    const TAIL = "address the same lines. Combine them into one edit, or address lines that do not overlap.";
    const cases: Array<[string, unknown[], string]> = [
      [
        "two ranges that share a line",
        [
          { op: "replace", startLine: 3, endLine: 5, text: "x", expected: "y" },
          { op: "replace", startLine: 5, endLine: 6, text: "x", expected: "y" },
        ],
        `Edits 1 and 2 overlap: replace lines 3-5 and replace lines 5-6 ${TAIL}`,
      ],
      [
        "a delete inside a replace",
        [
          { op: "replace", startLine: 3, endLine: 9, text: "x", expected: "y" },
          { op: "delete", startLine: 5, endLine: 5, expected: "y" },
        ],
        `Edits 1 and 2 overlap: replace lines 3-9 and delete lines 5-5 ${TAIL}`,
      ],
      [
        "an insert inside a range",
        [
          { op: "replace", startLine: 4, endLine: 8, text: "x", expected: "y" },
          { op: "insert", afterLine: 6, text: "x", expected: "y" },
        ],
        `Edits 1 and 2 overlap: replace lines 4-8 and insert after line 6 ${TAIL}`,
      ],
      [
        "an insert inside a range, given first: the pair is named in read order",
        [
          { op: "insert", afterLine: 6, text: "x", expected: "y" },
          { op: "replace", startLine: 4, endLine: 8, text: "x", expected: "y" },
        ],
        `Edits 2 and 1 overlap: replace lines 4-8 and insert after line 6 ${TAIL}`,
      ],
      [
        "an insert after the first line of a range",
        [
          { op: "delete", startLine: 4, endLine: 5, expected: "y" },
          { op: "insert", afterLine: 4, text: "x", expected: "y" },
        ],
        `Edits 1 and 2 overlap: delete lines 4-5 and insert after line 4 ${TAIL}`,
      ],
      [
        "two inserts at one position",
        [
          { op: "insert", afterLine: 3, text: "x", expected: "y" },
          { op: "insert", afterLine: 3, text: "z", expected: "y" },
        ],
        `Edits 1 and 2 overlap: insert after line 3 and insert after line 3 ${TAIL}`,
      ],
      [
        "an insert at the top twice",
        [
          { op: "insert", afterLine: 0, text: "x", expected: "y" },
          { op: "insert", afterLine: 0, text: "z", expected: "y" },
        ],
        `Edits 1 and 2 overlap: insert after line 0 and insert after line 0 ${TAIL}`,
      ],
      [
        "the first overlapping pair in read order of several",
        [
          { op: "replace", startLine: 10, endLine: 11, text: "x", expected: "y" },
          { op: "replace", startLine: 4, endLine: 6, text: "x", expected: "y" },
          { op: "replace", startLine: 6, endLine: 7, text: "x", expected: "y" },
          { op: "replace", startLine: 11, endLine: 12, text: "x", expected: "y" },
        ],
        `Edits 2 and 3 overlap: replace lines 4-6 and replace lines 6-7 ${TAIL}`,
      ],
    ];
    for (const [title, edits, text] of cases) {
      it(`${title}`, async () => {
        const result = await run(edits);

        expect(result).toEqual({ content: [{ type: "text", text }], isError: true });
        expectNoRequests();
      });
    }
  });

  describe("range errors (the matrix row 'Range'): the read only", () => {
    const cases: Array<[string, unknown[], string]> = [
      [
        "an endLine past the last line",
        [{ op: "replace", startLine: 12, endLine: 14, text: "x", expected: "y" }],
        "Edit 1 (replace) addresses line 14, but document 'Test.Edit.cls' has 13 lines. Read the lines again with iris_doc_get and address lines 1 to 13.",
      ],
      [
        "a startLine past the last line",
        [{ op: "delete", startLine: 14, endLine: 15, expected: "y" }],
        "Edit 1 (delete) addresses line 14, but document 'Test.Edit.cls' has 13 lines. Read the lines again with iris_doc_get and address lines 1 to 13.",
      ],
      [
        "an afterLine past the last line",
        [{ op: "insert", afterLine: 14, text: "x", expected: "y" }],
        "Edit 1 (insert) addresses line 14, but document 'Test.Edit.cls' has 13 lines. Read the lines again with iris_doc_get and address lines 1 to 13.",
      ],
      [
        "the second edit past the last line",
        [
          { op: "delete", startLine: 1, endLine: 1, expected: "Class Test.Edit Extends %RegisteredObject" },
          { op: "delete", startLine: 20, endLine: 20, expected: "y" },
        ],
        "Edit 2 (delete) addresses line 20, but document 'Test.Edit.cls' has 13 lines. Read the lines again with iris_doc_get and address lines 1 to 13.",
      ],
    ];
    for (const [title, edits, text] of cases) {
      it(`${title}`, async () => {
        arrange({ read: CLASS_LINES });

        const result = await run(edits);

        expect(result).toEqual({ content: [{ type: "text", text }], isError: true });
        expect(mockHttp.get.mock.calls).toEqual([[CLASS_PATH]]);
        expect(mockHttp.put.mock.calls).toEqual([]);
      });
    }
  });

  describe("a document that cannot be edited", () => {
    it("a missing document: names iris_doc_put for creating it", async () => {
      mockHttp.get.mockRejectedValueOnce(new IrisApiError(404, [], CLASS_PATH, "not found", null));

      const result = await run([{ op: "delete", startLine: 1, endLine: 1, expected: "x" }]);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "Document 'Test.Edit.cls' not found in namespace 'USER'. iris_doc_edit changes an existing document; create it with iris_doc_put.",
          },
        ],
        isError: true,
      });
      expect(mockHttp.put.mock.calls).toEqual([]);
    });

    it("a soft error on the read: IRIS's reason, then what to check", async () => {
      mockHttp.get.mockResolvedValueOnce(
        envelope({ name: CLASS_NAME, db: "", ts: "", cat: "CLS", enc: false, content: "", status: "ERROR #5001: boom" }),
      );

      const result = await run([{ op: "delete", startLine: 1, endLine: 1, expected: "x" }]);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "Document 'Test.Edit.cls' could not be read in namespace 'USER': ERROR #5001: boom. Check the document name and namespace, then retry.",
          },
        ],
        isError: true,
      });
      expect(mockHttp.put.mock.calls).toEqual([]);
    });

    it("a read with no line array", async () => {
      mockHttp.get.mockResolvedValueOnce(envelope({ name: CLASS_NAME, ts: TS_READ, status: "", enc: false }));

      const result = await run([{ op: "delete", startLine: 1, endLine: 1, expected: "x" }]);

      expect(result.content[0]?.text).toBe(
        "Document 'Test.Edit.cls' could not be read in namespace 'USER': IRIS returned no line content. Check the document name and namespace, then retry.",
      );
      expect(result.isError).toBe(true);
    });

    it("a binary document: line edits apply only to text", async () => {
      mockHttp.get.mockResolvedValueOnce(
        envelope({ ...docResult("Test.Image.png", ["iVBORw0KGgo="], TS_READ, "OTH"), enc: true }),
      );

      const result = await run([{ op: "delete", startLine: 1, endLine: 1, expected: "x" }], { name: "Test.Image.png" });

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "Document 'Test.Image.png' is a binary document, and line edits apply only to text. Replace it with iris_doc_put.",
          },
        ],
        isError: true,
      });
      expect(mockHttp.put.mock.calls).toEqual([]);
    });

    it("rejects a name with a path traversal before any request", async () => {
      const result = await run([{ op: "delete", startLine: 1, endLine: 1, expected: "x" }], {
        name: "../Secret.cls",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("must not contain '..'");
      expectNoRequests();
    });
  });

  describe("failures on the save and the re-read", () => {
    it("a soft error on the save: IRIS's reason, nothing stored, and no re-read", async () => {
      mockHttp.get.mockResolvedValueOnce(envelope(docResult(CLASS_NAME, CLASS_LINES)));
      mockHttp.put.mockResolvedValue(envelope(SOFT_ERROR_RESULT));

      const result = await run([
        { op: "replace", startLine: 4, endLine: 4, text: "not a member", expected: "Property Alpha As %String;" },
      ]);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: "Document 'Test.Edit.cls' was not saved in namespace 'USER': ERROR #16021: Illegal Header Line: Property Alpha As %String;. Nothing was stored; correct the edits and retry.",
          },
        ],
        structuredContent: {
          name: CLASS_NAME,
          namespace: "USER",
          status: "ERROR #16021: Illegal Header Line: Property Alpha As %String;",
        },
        isError: true,
      });
      expect(mockHttp.get.mock.calls).toEqual([[CLASS_PATH]]);
      expect(mockHttp.put.mock.calls).toHaveLength(1);
    });

    for (const [title, arrangeReread] of [
      ["throws", () => mockHttp.get.mockRejectedValueOnce(new Error("socket hang up"))],
      [
        "answers with a soft error",
        () =>
          mockHttp.get.mockResolvedValueOnce(
            envelope({ name: CLASS_NAME, db: "", ts: "", cat: "CLS", enc: false, content: "", status: "ERROR #5001: gone" }),
          ),
      ],
    ] as const) {
      it(`the re-read ${title}: the edits are applied, the result says so and forbids a repeat`, async () => {
        mockHttp.get.mockResolvedValueOnce(envelope(docResult(CLASS_NAME, CLASS_LINES)));
        arrangeReread();
        mockHttp.put.mockResolvedValue(envelope(saveResult(CLASS_NAME)));

        const result = await run([
          { op: "replace", startLine: 8, endLine: 8, text: "    Set tSC = 2", expected: "    Set tSC = $$$OK" },
        ]);

        const reason = title === "throws" ? "socket hang up" : "ERROR #5001: gone";
        expect(result).toEqual({
          content: [
            {
              type: "text",
              text: `Document 'Test.Edit.cls' was saved in namespace 'USER', but reading it back failed: ${reason}. The edits are applied: do not repeat them. Read the document with iris_doc_get to see the result.`,
            },
          ],
          structuredContent: { name: CLASS_NAME, namespace: "USER", saved: true, ts: TS_SAVED },
          isError: true,
        });
        expect(sc(result).code).toBeUndefined();
        expect(mockHttp.put.mock.calls).toHaveLength(1);
      });
    }

    it("propagates other errors on the read", async () => {
      for (const status of [423, 500]) {
        mockHttp = createMockHttp();
        ctx = createMockCtx(mockHttp);
        const error = new IrisApiError(status, [], CLASS_PATH, `HTTP ${status}`, null);
        mockHttp.get.mockRejectedValueOnce(error);

        await expect(run([{ op: "delete", startLine: 1, endLine: 1, expected: "x" }])).rejects.toBe(error);
        expect(mockHttp.put.mock.calls).toEqual([]);
      }
    });

    it("propagates other errors on the save, without a second save", async () => {
      for (const error of [
        new IrisApiError(423, [], CLASS_PATH, "locked", null),
        new IrisApiError(500, [], CLASS_PATH, "server error", null),
        new Error("ECONNRESET"),
      ]) {
        mockHttp = createMockHttp();
        ctx = createMockCtx(mockHttp);
        mockHttp.get.mockResolvedValueOnce(envelope(docResult(CLASS_NAME, CLASS_LINES)));
        mockHttp.put.mockRejectedValue(error);

        await expect(
          run([{ op: "replace", startLine: 8, endLine: 8, text: "x", expected: "    Set tSC = $$$OK" }]),
        ).rejects.toBe(error);
        expect(mockHttp.put.mock.calls).toHaveLength(1);
        expect(mockHttp.get.mock.calls).toEqual([[CLASS_PATH]]);
      }
    });
  });

  describe("the pure helpers", () => {
    it("validateEdits accepts well-formed edits, and an insert beside a range that it does not lie inside", () => {
      expect(validateEdits(S2_EDITS)).toBeUndefined();
      expect(
        validateEdits([
          { op: "replace", startLine: 3, endLine: 5, text: "x", expected: "y" },
          { op: "insert", afterLine: 2, text: "x", expected: "y" },
          { op: "insert", afterLine: 5, text: "x", expected: "y" },
        ]),
      ).toBeUndefined();
    });

    it("applyEdits gives one result for every order of the edits, and one region per edit in input order", () => {
      const orders = [
        [0, 1, 2],
        [2, 1, 0],
        [1, 2, 0],
      ];
      for (const order of orders) {
        const edits = order.map((index) => S2_EDITS[index] as LineEdit);
        const applied = applyEdits(edits, CLASS_LINES);
        expect(applied.lines, order.join(",")).toEqual(S2_LINES);
        const byEdit = new Map(edits.map((edit, index) => [edit, applied.regions[index]]));
        expect(byEdit.get(S2_EDITS[0] as LineEdit)).toEqual({ start: 8, length: 1 });
        expect(byEdit.get(S2_EDITS[1] as LineEdit)).toEqual({ start: 2, length: 1 });
        expect(byEdit.get(S2_EDITS[2] as LineEdit)).toEqual({ start: 5, length: 0 });
      }
    });

    it("applyEdits never mutates the read lines", () => {
      const read = [...CLASS_LINES];
      applyEdits(S2_EDITS, read);
      expect(read).toEqual(CLASS_LINES);
    });

    it("applyEdits puts an insert after line s-1 before a range that starts at s", () => {
      const applied = applyEdits(
        [
          { op: "replace", startLine: 2, endLine: 2, text: "B", expected: "b" },
          { op: "insert", afterLine: 1, text: "X", expected: "a" },
        ],
        ["a", "b", "c"],
      );
      expect(applied.lines).toEqual(["a", "X", "B", "c"]);
      expect(applied.regions).toEqual([
        { start: 2, length: 1 },
        { start: 1, length: 1 },
      ]);
    });

    it("findStaleEdits compares line by line after textToLines", () => {
      const stale = findStaleEdits(
        [
          { op: "delete", startLine: 4, endLine: 4, expected: "Property Alpha As %String;\r\n" },
          { op: "delete", startLine: 8, endLine: 9, expected: "    Set tSC = $$$OK" },
        ],
        CLASS_LINES,
      );
      expect(stale.map((entry) => entry.edit)).toEqual([2]);
      expect(stale[0]?.current).toEqual(["    Set tSC = $$$OK", "    Quit tSC"]);
    });
  });

  describe("the schema, the description and the classification", () => {
    it("has the required action and no parameter that skips the Storage guard, a version or a conflict check (AC-4)", () => {
      const shape = docEditTool.inputSchema.shape as Record<string, unknown>;
      expect(Object.keys(shape).sort()).toEqual(["action", "edits", "name", "namespace"]);
      for (const forbidden of ["ts", "ignoreConflict", "allowStorageRegeneration", "force"]) {
        expect(shape[forbidden]).toBeUndefined();
      }
      expect(docEditTool.inputSchema.safeParse({ name: CLASS_NAME, edits: [] }).success).toBe(false);
      expect(
        docEditTool.inputSchema.safeParse({ action: "skip", name: CLASS_NAME, edits: [{ op: "delete", expected: "x" }] })
          .success,
      ).toBe(false);
    });

    it("an edit is a flat object: op, afterLine, startLine, endLine, text and a required expected", () => {
      const parse = (edit: unknown) =>
        docEditTool.inputSchema.safeParse({ action: "apply", name: CLASS_NAME, edits: [edit] });

      expect(parse({ op: "delete", startLine: 1, endLine: 2, expected: "x" }).success).toBe(true);
      expect(parse({ op: "insert", afterLine: 0, text: "x", expected: "y" }).success).toBe(true);
      expect(parse({ op: "delete", startLine: 1, endLine: 2 }).success).toBe(false);
      expect(parse({ op: "move", expected: "x" }).success).toBe(false);
      expect(parse({ op: "insert", afterLine: -1, text: "x", expected: "y" }).success).toBe(false);
      expect(parse({ op: "delete", startLine: 0, endLine: 2, expected: "y" }).success).toBe(false);
      expect(parse({ op: "delete", startLine: 1.5, endLine: 2, expected: "y" }).success).toBe(false);
      expect(docEditTool.inputSchema.safeParse({ action: "apply", name: CLASS_NAME, edits: [] }).success).toBe(false);
    });

    it("coerces numeric strings in the line fields, as the other line tools do", () => {
      const parsed = docEditTool.inputSchema.parse({
        action: "apply",
        name: CLASS_NAME,
        edits: [{ op: "replace", startLine: "3", endLine: "4", text: "x", expected: "y" }],
      }) as { edits: Array<{ startLine: number; endLine: number }> };
      expect(parsed.edits[0]?.startLine).toBe(3);
      expect(parsed.edits[0]?.endLine).toBe(4);
    });

    it("describes every field, the edit fields included", () => {
      const shape = docEditTool.inputSchema.shape as Record<string, { description?: string }>;
      for (const [key, field] of Object.entries(shape)) {
        expect(field.description ?? "", key).not.toBe("");
      }
      const edits = docEditTool.inputSchema.shape.edits as unknown as {
        element: { shape: Record<string, { description?: string }> };
      };
      const editFields = Object.entries(edits.element.shape);
      expect(editFields.map(([key]) => key)).toEqual(["op", "afterLine", "startLine", "endLine", "text", "expected"]);
      for (const [key, field] of editFields) {
        expect(field.description ?? "", `edits[].${key}`).not.toBe("");
      }
    });

    it("tells an agent when to use it, what it returns, how it fails and what to run next", () => {
      const text = docEditTool.description;
      expect(text).toContain("iris_doc_get");
      expect(text).toContain("iris_doc_compile");
      expect(text).toContain("`apply` is a write that is enabled by default");
      expect(text).toContain("regenerateStorage");
      expect(text).toContain("STALE_CONTENT");
      expect(text).toContain("DOCUMENT_CONFLICT");
      expect(text).toContain("STORAGE_DROPPED");
      expect(text).toContain("`iris_doc_put` is explicitly disabled");
      expect(text).toContain("`unifiedDiff` (3 context lines)");
      expect(text).toContain("3 context lines on each side");
      expect(text).toContain("afterLine 0");
      expect(text).toContain("distinctive");
      expect(text).toContain("never the whole document");
      expect(text).toContain(
        "`current` of a STALE_CONTENT mismatch can be passed back as `expected` unchanged, and an `expected` built from a ranged read " +
          "ends every line, the last included, with a line break.",
      );
      expect(text).not.toMatch(/\/api\/|atelier|\/doc\//i);
    });

    it("is classified: two write actions, apply enabled by default, a parent, and all four hints", () => {
      expect(docEditTool.name).toBe("iris_doc_edit");
      expect(docEditTool.scope).toBe("NS");
      expect(docEditTool.mutates).toEqual({ apply: "write", regenerateStorage: "write" });
      expect(docEditTool.defaultEnabled).toEqual(["apply"]);
      expect(docEditTool.parent).toBe("iris_doc_put");
      expect(docEditTool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      });
    });
  });
});
