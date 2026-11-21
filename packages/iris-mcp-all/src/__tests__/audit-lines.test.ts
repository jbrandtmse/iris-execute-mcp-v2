/**
 * DW-693 -- the one reader of an audit file, `scripts/lib/audit-lines.mjs`. The audit writer appends each entry as one `${line}\n`, so a
 * reader that runs during a write can see a partial last line. `completeAuditLines` returns only the newline-terminated, non-blank
 * lines; `readAuditEntries` parses them, reads a missing file as `[]`, and throws on a terminated line that is not JSON.
 *
 * The fixtures are not only canonical files (Rule #58): a partial last line, blank and whitespace-only lines, CRLF line ends, a
 * partial line that is garbage, and a file that grows between two reads. Reads documents and temp files only: no IRIS, no server.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { completeAuditLines, readAuditEntries } from "../../../../scripts/lib/audit-lines.mjs";

let scratch = "";

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "audit-lines-"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A file of its own in the scratch directory, holding `text`. */
function fileWith(name: string, text: string): string {
  const file = path.join(scratch, name);
  writeFileSync(file, text);
  return file;
}

describe("completeAuditLines", () => {
  it("is empty for an empty text and for a text with no newline: a lone partial line is an entry still being written", () => {
    expect(completeAuditLines("")).toEqual([]);
    expect(completeAuditLines('{"a":1}')).toEqual([]);
    expect(completeAuditLines('{"a":')).toEqual([]);
    expect(completeAuditLines("\n")).toEqual([]);
  });

  it("returns the newline-terminated lines in order and leaves a trailing partial line out", () => {
    expect(completeAuditLines('{"a":1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
    expect(completeAuditLines('{"a":1}\n{"b":2}\n{"c":')).toEqual(['{"a":1}', '{"b":2}']);
    expect(completeAuditLines('{"a":1}\n{"b":2}\n{"c":3}')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("skips blank and whitespace-only lines, whatever the whitespace", () => {
    expect(completeAuditLines('\n\n  \n{"a":1}\n\n\t\n')).toEqual(['{"a":1}']);
    expect(completeAuditLines('{"a":1}\n \t \n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("reads CRLF line ends: a line keeps its carriage return, which JSON accepts, and a line of only a carriage return is blank", () => {
    const lines = completeAuditLines('{"a":1}\r\n\r\n{"b":2}\r\n{"c":');
    expect(lines).toEqual(['{"a":1}\r', '{"b":2}\r']);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("returns a compact file of many entries on one pass, and none of them split", () => {
    const text = Array.from({ length: 50 }, (_, index) => JSON.stringify({ seq: index + 1 })).join("\n") + "\n";
    expect(completeAuditLines(text).map((line) => (JSON.parse(line) as { seq: number }).seq)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
  });
});

describe("readAuditEntries", () => {
  it("parses the complete entries of a file in order", () => {
    const file = fileWith("complete.jsonl", '{"type":"sessionStart"}\n{"tool":"t1","seq":1}\n');
    expect(readAuditEntries(file)).toEqual([{ type: "sessionStart" }, { tool: "t1", seq: 1 }]);
  });

  it("returns only the complete entries of a file that ends in a partial line, and no SyntaxError", () => {
    const file = fileWith("partial.jsonl", '{"tool":"t1","seq":1}\n{"tool":"t1","seq":2');
    expect(readAuditEntries(file)).toEqual([{ tool: "t1", seq: 1 }]);
  });

  it("returns only the complete entries when the partial last line is garbage that is not the start of JSON", () => {
    const file = fileWith("partial-garbage.jsonl", '{"tool":"t1","seq":1}\nnot json at');
    expect(readAuditEntries(file)).toEqual([{ tool: "t1", seq: 1 }]);
  });

  it("sees an entry whole once its newline has landed: a file that grows between two reads", () => {
    const file = fileWith("growing.jsonl", '{"seq":1}\n{"seq":');
    expect(readAuditEntries(file)).toEqual([{ seq: 1 }]);
    appendFileSync(file, "2}\n");
    expect(readAuditEntries(file)).toEqual([{ seq: 1 }, { seq: 2 }]);
  });

  it("skips blank and whitespace-only lines and reads CRLF line ends", () => {
    expect(readAuditEntries(fileWith("blank.jsonl", '\n  \n{"a":1}\n\t\n{"b":2}\n'))).toEqual([{ a: 1 }, { b: 2 }]);
    expect(readAuditEntries(fileWith("crlf.jsonl", '{"a":1}\r\n{"b":2}\r\n{"c":'))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("reads a missing file and an empty file as no entries", () => {
    expect(readAuditEntries(path.join(scratch, "no-such-audit-file.jsonl"))).toEqual([]);
    expect(readAuditEntries(fileWith("empty.jsonl", ""))).toEqual([]);
  });

  it("throws on a newline-terminated line that is not JSON: the writer never produces one, so it is a real defect", () => {
    const file = fileWith("corrupt.jsonl", '{"a":1}\nthis is not json\n{"b":2}\n');
    expect(() => readAuditEntries(file)).toThrow(SyntaxError);
  });
});
