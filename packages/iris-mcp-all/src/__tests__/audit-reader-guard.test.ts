/**
 * DW-693 guard -- no test or script reads an audit file by splitting it on its newlines. The audit writer appends each entry as one
 * `${line}\n`, so such a reader can parse a half-written last line and throw (the flake of CI runs 39819176668 and 39838191935). Every
 * reader goes through `scripts/lib/audit-lines.mjs` (`readAuditEntries`, `completeAuditLines`).
 *
 * `scripts/lib/audit-reader-scan.mjs` holds the scan. Here it runs over the repository, which must have no finding apart from the kept
 * list, and over samples for each pattern it reports and each form it must pass, so that the guard itself can fail (Rule #59). The
 * samples are string literals, which the scan never reads as code, so this file reports nothing about itself.
 *
 * Reads documents and calls pure functions: no IRIS, no server, no build.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, relativeToRepo } from "../../../../scripts/lib/live-gate-scan.mjs";
import { AUDIT_READER_KEPT, auditReaderFindings, auditReaderScan, auditScanFiles, unkeptFindings } from "../../../../scripts/lib/audit-reader-scan.mjs";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const lines = (...parts: string[]): string => parts.join("\n");

/** The readers that DW-693 replaced, as they were written: each one must be a finding. */
const RAW_READERS: Array<[string, string, number, string]> = [
  [
    "the shared auditLines helper",
    lines(
      "export async function auditLines(filePath: string, minLines: number) {",
      "  for (;;) {",
      "    if (existsSync(filePath)) {",
      '      const lines = readFileSync(filePath, "utf-8")',
      '        .split("\\n")',
      "        .filter((line) => line.trim().length > 0);",
      "    }",
      "  }",
      "}",
    ),
    5,
    'readFileSync(filePath, "utf-8")',
  ],
  [
    "the handler golden's settledAuditEntries",
    lines(
      "export async function settledAuditEntries(file, minimum) {",
      "  const read = () =>",
      "    (existsSync(file) ? readFileSync(file, 'utf8') : '')",
      "      .split('\\n')",
      "      .filter((line) => line.trim() !== '')",
      "      .map((line) => JSON.parse(line));",
      "}",
    ),
    4,
    "(existsSync(file) ? readFileSync(file, 'utf8') : '')",
  ],
  [
    "a private waitForLineCount copy",
    lines(
      "async function waitForLineCount(filePath: string, minLines: number) {",
      "  const lines = readFileSync(filePath, 'utf-8')",
      "    .split('\\n')",
      "    .filter((line) => line.trim().length > 0);",
      "  return lines;",
      "}",
      "const audit = 1;",
    ),
    3,
    "readFileSync(filePath, 'utf-8')",
  ],
  [
    "a variable that holds the file text",
    lines('const raw = existsSync(audit) ? readFileSync(audit, "utf8") : "";', 'const entries = raw.split("\\n").map((line) => JSON.parse(line));'),
    2,
    "raw",
  ],
  [
    "a variable that is trimmed first",
    lines('const text = readFileSync(auditFile, "utf8");', "const rows = text.trim().split(/\\r?\\n/);"),
    2,
    "text.trim()",
  ],
  ["a regular expression separator", lines('const audit = readFileSync(f, "utf8").split(/\\n/);'), 1, 'readFileSync(f, "utf8")'],
  ["a template literal separator", lines("const audit = readFileSync(f).toString().split(`\\n`);"), 1, "readFileSync(f).toString()"],
  ["a separator that holds more than the newline", lines('const audit = readFileSync(f, "utf8").split("\\r\\n");'), 1, 'readFileSync(f, "utf8")'],
];

describe("the repository has no raw audit reader", () => {
  it("every test and script that mentions audit reads its file through scripts/lib/audit-lines.mjs, apart from the kept list", () => {
    const unkept = unkeptFindings(auditReaderScan()).map((finding) => `${finding.file}:${finding.line} (${finding.kind}) ${finding.receiver}`);
    expect(unkept, "a raw split-and-parse reader of an audit file; use readAuditEntries or completeAuditLines").toEqual([]);
  });

  it("the scan reads the shared test helper, the handler golden core, an interop test and the launcher's tests (an empty scan passes everything)", () => {
    const scanned = auditScanFiles().map((file) => relativeToRepo(file));
    expect(scanned.length).toBeGreaterThan(300);
    for (const file of [
      "packages/shared/src/__tests__/test-helpers.ts",
      "scripts/lib/sdk-handler-golden-core.mjs",
      "scripts/lib/audit-lines.mjs",
      "packages/iris-interop-mcp/src/__tests__/message-search-governance.test.ts",
      "packages/iris-mcp-all/src/__tests__/story-43-4-qa-probe-copy.test.ts",
    ]) {
      expect(scanned, file).toContain(file);
      expect(/audit/i.test(read(file)), `${file} mentions audit, so the scan reads it`).toBe(true);
    }
    expect(scanned.some((file) => file.startsWith("extensions/iris-mcp-launcher/src/")), "the extension's tests").toBe(true);
    expect(scanned.some((file) => file.endsWith(".d.mts")), "no declaration file").toBe(false);
  });

  it("the shared helper and the handler golden core read through the shared reader", () => {
    expect(read("packages/shared/src/__tests__/test-helpers.ts")).toContain("readAuditEntries");
    expect(read("scripts/lib/sdk-handler-golden-core.mjs")).toContain("readAuditEntries");
  });

  it("each kept reader names a file and a receiver that the scan still finds, once, and carries a reason", () => {
    const all = auditReaderScan();
    for (const entry of AUDIT_READER_KEPT) {
      expect(entry.reason.trim().length, `${entry.file}: a reason`).toBeGreaterThan(40);
      const matches = all.filter((finding) => finding.file === entry.file && finding.receiver === entry.receiver);
      expect(matches.length, `${entry.file} no longer holds ${entry.receiver}: remove the entry`).toBe(1);
    }
    expect(AUDIT_READER_KEPT.length).toBe(1);
  });
});

describe("the scan reports each raw reader and passes each form that is not one (the guard can fail)", () => {
  it.each(RAW_READERS)("reports %s, at its line", (_label, source, line, receiver) => {
    const found = auditReaderFindings(source, "sample.ts");
    expect(found.map((finding) => ({ file: finding.file, line: finding.line, receiver: finding.receiver }))).toEqual([{ file: "sample.ts", line, receiver }]);
  });

  it("names the kind: a call that holds readFileSync is direct, a variable the nearest declaration initializes from one is a variable", () => {
    expect(auditReaderFindings(lines('const audit = readFileSync(f, "utf8").split("\\n");'))[0]?.kind).toBe("direct");
    expect(auditReaderFindings(lines('const raw = readFileSync(auditFile, "utf8");', 'raw.split("\\n");'))[0]?.kind).toBe("variable");
  });

  it("passes a read through the shared reader, a split of something that is not a file, and a file that never mentions audit", () => {
    expect(auditReaderFindings(lines('import { readAuditEntries } from "./audit-lines.mjs";', "const entries = readAuditEntries(file);"))).toEqual([]);
    expect(auditReaderFindings(lines('const lines = completeAuditLines(readFileSync(auditFile, "utf8"));'))).toEqual([]);
    expect(auditReaderFindings(lines("// audit", "export function f(text: string) {", '  return text.slice(0, 3).split("\\n");', "}"))).toEqual([]);
    expect(auditReaderFindings(lines('const audit = "a,b";', 'const parts = audit.split(",");'))).toEqual([]);
    expect(auditReaderFindings(lines('const raw = readFileSync(f, "utf8").length;', 'const names = list.split("\\n");', "const audit = 1;"))).toEqual([]);
    expect(auditReaderFindings(lines('const text = readFileSync(f, "utf8");', 'const rows = text.split("\\n");'))).toEqual([]);
  });

  it("passes a variable that was not initialized from a file read, and one declared after the split", () => {
    expect(auditReaderFindings(lines("const audit = 1;", "function parse(raw: string) {", '  return raw.split("\\n");', "}"))).toEqual([]);
    expect(auditReaderFindings(lines("const audit = 1;", "function parse(raw: string) {", '  return raw.split("\\n");', "}", 'const raw = readFileSync(f, "utf8");'))).toEqual([]);
  });

  it("does not read a comment or a literal as code", () => {
    expect(auditReaderFindings(lines("// audit", '// const raw = readFileSync(f, "utf8").split("\\n");'))).toEqual([]);
    expect(auditReaderFindings(lines("const audit = 'readFileSync(f).split(`\\\\n`)';", "const note = \"const raw = readFileSync(f); raw.split('\\\\n')\";"))).toEqual([]);
  });

  it("reports a raw reader that is put back into the real shared test helper, naming the file and the line", () => {
    const real = read("packages/shared/src/__tests__/test-helpers.ts");
    expect(auditReaderFindings(real, "packages/shared/src/__tests__/test-helpers.ts"), "the real helper has none").toEqual([]);
    const added = lines("", "export function rawAuditLines(filePath: string) {", '  return readFileSync(filePath, "utf-8").split("\\n").filter((line) => line.trim() !== "");', "}", "");
    const found = auditReaderFindings(`${real}${added}`, "packages/shared/src/__tests__/test-helpers.ts");
    expect(found.length).toBe(1);
    expect(found[0]?.file).toBe("packages/shared/src/__tests__/test-helpers.ts");
    expect(found[0]?.line).toBe(real.split("\n").length + 2);
    expect(unkeptFindings(found).length, "a new reader is not excused by the kept list").toBe(1);
  });

  it("excuses a finding only when both its file and its receiver are listed", () => {
    const [entry] = AUDIT_READER_KEPT;
    expect(entry).toBeDefined();
    const finding = { file: entry?.file ?? "", line: 1, kind: "direct" as const, receiver: entry?.receiver ?? "" };
    expect(unkeptFindings([finding])).toEqual([]);
    expect(unkeptFindings([{ ...finding, file: "packages/iris-mcp-all/src/__tests__/other.test.ts" }]).length).toBe(1);
    expect(unkeptFindings([{ ...finding, receiver: 'readFileSync(auditFile, "utf8")' }]).length).toBe(1);
  });
});
