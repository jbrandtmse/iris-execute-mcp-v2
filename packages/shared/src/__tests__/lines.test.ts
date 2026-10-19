import { describe, it, expect } from "vitest";
import {
  stripLeadingBom,
  stripLeadingBomFromLines,
  documentLines,
  linesInRange,
  formatNumberedLines,
  NUMBERED_LINE_WIDTH,
  splitLines,
  joinLines,
  textToLines,
  alignLines,
  unifiedDiff,
  DIFF_CONTEXT_LINES,
  MAX_DIFF_DISTANCE,
} from "../lines.js";
import * as shared from "../index.js";
import { mulberry32 } from "./test-helpers.js";

describe("stripLeadingBom", () => {
  it("removes a single leading U+FEFF", () => {
    expect(stripLeadingBom("\uFEFFClass A.B {}")).toBe("Class A.B {}");
  });

  it("returns the same text when there is no BOM", () => {
    expect(stripLeadingBom("Class A.B {}")).toBe("Class A.B {}");
  });

  it("returns the empty string unchanged", () => {
    expect(stripLeadingBom("")).toBe("");
  });

  it("removes only one BOM when two are stacked", () => {
    expect(stripLeadingBom("\uFEFF\uFEFFx")).toBe("\uFEFFx");
  });

  it("preserves a U+FEFF that is not the first character", () => {
    expect(stripLeadingBom("a\uFEFFb")).toBe("a\uFEFFb");
  });

  it("strips a BOM that is the entire input", () => {
    expect(stripLeadingBom("\uFEFF")).toBe("");
  });

  it("is exported from the @iris-mcp/shared barrel", () => {
    expect(shared.stripLeadingBom).toBe(stripLeadingBom);
  });
});

describe("stripLeadingBomFromLines", () => {
  it("returns a copy with the first line's BOM removed and leaves the caller's array untouched", () => {
    const caller = ["﻿Class A.B {", "﻿{", "}"];

    const result = stripLeadingBomFromLines(caller);

    expect(result).toEqual(["Class A.B {", "﻿{", "}"]);
    expect(result).not.toBe(caller);
    expect(caller).toEqual(["﻿Class A.B {", "﻿{", "}"]);
  });

  it("returns the same array when the first line has no BOM", () => {
    const caller = ["Class A.B {", "}"];

    expect(stripLeadingBomFromLines(caller)).toBe(caller);
  });

  it("returns the same empty array for an empty document", () => {
    const caller: string[] = [];

    expect(stripLeadingBomFromLines(caller)).toBe(caller);
  });

  it("is exported from the @iris-mcp/shared barrel", () => {
    expect(shared.stripLeadingBomFromLines).toBe(stripLeadingBomFromLines);
  });
});

describe("documentLines", () => {
  it("removes one BOM from element 0 only and leaves every other element exactly as sent", () => {
    const content = ["\uFEFFClass A.B {", "\uFEFF{", "\tSet x = 1  ", ""];

    expect(documentLines(content)).toEqual(["Class A.B {", "\uFEFF{", "\tSet x = 1  ", ""]);
  });

  it("keeps a class's trailing empty element as a line", () => {
    expect(documentLines(["Class A.B {", "}", ""])).toHaveLength(3);
  });

  it("always returns a fresh array, with or without a BOM", () => {
    const withoutBom = ["Class A.B {", "}"];
    const withBom = ["\uFEFFClass A.B {", "}"];

    expect(documentLines(withoutBom)).toEqual(withoutBom);
    expect(documentLines(withoutBom)).not.toBe(withoutBom);
    expect(documentLines(withBom)).not.toBe(withBom);
  });

  it("never mutates its input", () => {
    const content = ["\uFEFFClass A.B {", "}"];

    documentLines(content).push("extra");

    expect(content).toEqual(["\uFEFFClass A.B {", "}"]);
  });

  it("returns an empty array for an empty content array", () => {
    expect(documentLines([])).toEqual([]);
  });

  it("is exported from the @iris-mcp/shared barrel", () => {
    expect(shared.documentLines).toBe(documentLines);
  });
});

describe("linesInRange", () => {
  const LINES = ["l1", "l2", "l3", "l4", "l5"];

  it("slices 1-based and inclusive", () => {
    expect(linesInRange(LINES, 2, 4)).toEqual(["l2", "l3", "l4"]);
  });

  it("returns the first line for 1-1", () => {
    expect(linesInRange(LINES, 1, 1)).toEqual(["l1"]);
  });

  it("returns the last line for N-N", () => {
    expect(linesInRange(LINES, 5, 5)).toEqual(["l5"]);
  });

  it("returns a single middle line", () => {
    expect(linesInRange(LINES, 3, 3)).toEqual(["l3"]);
  });

  it("returns every line, as a copy, for 1-N", () => {
    const all = linesInRange(LINES, 1, 5);

    expect(all).toEqual(LINES);
    expect(all).not.toBe(LINES);
  });

  it("never mutates its input", () => {
    const input = [...LINES];

    linesInRange(input, 2, 3).push("extra");

    expect(input).toEqual(LINES);
  });

  it("is exported from the @iris-mcp/shared barrel", () => {
    expect(shared.linesInRange).toBe(linesInRange);
  });
});

describe("formatNumberedLines", () => {
  it("uses the cat -n layout: the number right-aligned in 6 columns, a TAB, the line", () => {
    expect(NUMBERED_LINE_WIDTH).toBe(6);
    expect(formatNumberedLines(["Class A.B {", "}"], 1)).toBe("     1\tClass A.B {\n     2\t}");
  });

  it("numbers from the given first line number", () => {
    expect(formatNumberedLines(["x", "y", "z"], 98)).toBe("    98\tx\n    99\ty\n   100\tz");
  });

  it("writes an empty line as the number and a TAB, with nothing after it", () => {
    expect(formatNumberedLines(["a", "b", "c", "d", ""], 1).split("\n")[4]).toBe("     5\t");
  });

  it("keeps a TAB-led line exactly, so the first TAB still ends the number", () => {
    const text = formatNumberedLines(["\tSet x = 1  "], 7);

    expect(text).toBe("     7\t\tSet x = 1  ");
    expect(text.slice(0, text.indexOf("\t"))).toBe("     7");
    expect(text.slice(text.indexOf("\t") + 1)).toBe("\tSet x = 1  ");
  });

  it("does not truncate a number wider than the column (a 7-digit line number)", () => {
    expect(formatNumberedLines(["big"], 1234567)).toBe("1234567\tbig");
  });

  it("has no trailing newline and returns the empty string for no lines", () => {
    expect(formatNumberedLines(["only"], 1).endsWith("\n")).toBe(false);
    expect(formatNumberedLines([], 1)).toBe("");
  });

  it("never alters the line text (non-ASCII and trailing spaces survive)", () => {
    expect(formatNumberedLines(["caf\u00e9 \u2014 end  "], 3)).toBe("     3\tcaf\u00e9 \u2014 end  ");
  });

  it("is exported from the @iris-mcp/shared barrel", () => {
    expect(shared.formatNumberedLines).toBe(formatNumberedLines);
    expect(shared.NUMBERED_LINE_WIDTH).toBe(NUMBERED_LINE_WIDTH);
  });
});

describe("splitLines and joinLines", () => {
  const TEXTS = [
    "a\nb\nc",
    "a\r\nb\r\nc",
    "a\nb\r\nc",
    "a\nb\n",
    "a\r\nb\r\n",
    "",
    "\n",
    "\n\n",
    "lone\rcarriage",
    "tab\there  \nspaces  ",
  ];

  it("splits exactly like split(/\\r?\\n/) on CRLF, LF and trailing-newline fixtures", () => {
    for (const text of TEXTS) expect(splitLines(text), JSON.stringify(text)).toEqual(text.split(/\r?\n/));
  });

  it("yields a trailing empty element for a trailing line break and [''] for empty text", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b", ""]);
    expect(splitLines("")).toEqual([""]);
  });

  it("does not treat a lone carriage return as a line break", () => {
    expect(splitLines("lone\rcarriage")).toEqual(["lone\rcarriage"]);
  });

  it("joins with a bare newline and no trailing newline", () => {
    expect(joinLines(["a", "b", ""])).toBe("a\nb\n");
    expect(joinLines(["only"])).toBe("only");
    expect(joinLines([])).toBe("");
  });

  it("joinLines inverts splitLines for LF text", () => {
    for (const text of ["a\nb\nc", "a\nb\n", "", "\n\n"]) expect(joinLines(splitLines(text))).toBe(text);
  });

  it("are exported from the @iris-mcp/shared barrel", () => {
    expect(shared.splitLines).toBe(splitLines);
    expect(shared.joinLines).toBe(joinLines);
  });
});

describe("textToLines", () => {
  it("drops one trailing line break, so a trailing newline and none give the same lines", () => {
    expect(textToLines("a\nb\n")).toEqual(["a", "b"]);
    expect(textToLines("a\r\nb")).toEqual(["a", "b"]);
    expect(textToLines("a\nb")).toEqual(["a", "b"]);
    expect(textToLines("a\r\nb\r\n")).toEqual(["a", "b"]);
  });

  it("treats the empty text as one empty line", () => {
    expect(textToLines("")).toEqual([""]);
    expect(textToLines("\n")).toEqual([""]);
    expect(textToLines("\r\n")).toEqual([""]);
  });

  it("drops only one trailing line break: a second one is an empty line", () => {
    expect(textToLines("a\n\n")).toEqual(["a", ""]);
    expect(textToLines("\n\n")).toEqual(["", ""]);
  });

  it("removes one leading BOM, and only one", () => {
    expect(textToLines("\uFEFFa\nb")).toEqual(["a", "b"]);
    expect(textToLines("\uFEFF")).toEqual([""]);
    expect(textToLines("\uFEFF\uFEFFa")).toEqual(["\uFEFFa"]);
  });

  it("keeps tabs, trailing spaces and a U+FEFF that is not first", () => {
    expect(textToLines("\tSet x = 1  \n  \ty\uFEFF\n")).toEqual(["\tSet x = 1  ", "  \ty\uFEFF"]);
  });

  it("splits on CRLF and LF alike inside the text", () => {
    expect(textToLines("a\r\nb\nc\r\nd\n")).toEqual(["a", "b", "c", "d"]);
  });

  it("always yields at least one line", () => {
    for (const text of ["", "\n", "\r\n", "x", "\uFEFF\n"]) expect(textToLines(text).length).toBeGreaterThanOrEqual(1);
  });

  it("is exported from the @iris-mcp/shared barrel", () => {
    expect(shared.textToLines).toBe(textToLines);
  });
});

/** Lines `<prefix>1` to `<prefix><count>`. */
function numbered(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

const LABELS = { oldLabel: "before.txt", newLabel: "after.txt" };

describe("unifiedDiff against diff -U3", () => {
  // Rule #36: each expected literal below is the output of `diff -U3 before.txt after.txt` (Apple diff,
  // based on FreeBSD diff; `diff --version` prints "Apple diff (based on FreeBSD diff)") run on the
  // exact fixture files, with the two header lines replaced by the labels. Every fixture has distinct
  // lines, so the diff is unique and does not depend on the algorithm's tie-breaking.
  it("an insert at the top: the new range keeps three context lines", () => {
    // before.txt = row1..row10; after.txt = top, row1..row10
    expect(unifiedDiff(numbered("row", 10), ["top", ...numbered("row", 10)], LABELS)).toBe(
      "--- before.txt\n+++ after.txt\n@@ -1,3 +1,4 @@\n+top\n row1\n row2\n row3",
    );
  });

  it("a change in the middle: a deletion comes before its insertion", () => {
    // before.txt = row1..row10; after.txt = row1..row4, "ROW5 changed", row6..row10
    const after = numbered("row", 10);
    after[4] = "ROW5 changed";
    expect(unifiedDiff(numbered("row", 10), after, LABELS)).toBe(
      "--- before.txt\n+++ after.txt\n@@ -2,7 +2,7 @@\n row2\n row3\n row4\n-row5\n+ROW5 changed\n row6\n row7\n row8",
    );
  });

  it("two changes with 6 unchanged lines between them merge into one hunk", () => {
    // before.txt = line1..line12; after.txt = line2 -> LINE2, line9 -> LINE9
    const after = numbered("line", 12);
    after[1] = "LINE2";
    after[8] = "LINE9";
    expect(unifiedDiff(numbered("line", 12), after, LABELS)).toBe(
      [
        "--- before.txt",
        "+++ after.txt",
        "@@ -1,12 +1,12 @@",
        " line1",
        "-line2",
        "+LINE2",
        " line3",
        " line4",
        " line5",
        " line6",
        " line7",
        " line8",
        "-line9",
        "+LINE9",
        " line10",
        " line11",
        " line12",
      ].join("\n"),
    );
  });

  it("two changes with 7 unchanged lines between them stay two hunks", () => {
    // before.txt = line1..line12; after.txt = line2 -> LINE2, line10 -> LINE10
    const after = numbered("line", 12);
    after[1] = "LINE2";
    after[9] = "LINE10";
    expect(unifiedDiff(numbered("line", 12), after, LABELS)).toBe(
      [
        "--- before.txt",
        "+++ after.txt",
        "@@ -1,5 +1,5 @@",
        " line1",
        "-line2",
        "+LINE2",
        " line3",
        " line4",
        " line5",
        "@@ -7,6 +7,6 @@",
        " line7",
        " line8",
        " line9",
        "-line10",
        "+LINE10",
        " line11",
        " line12",
      ].join("\n"),
    );
  });

  it("a pure delete: the new range is shorter and nothing is added", () => {
    // before.txt = row1..row10; after.txt = row1..row3, row6..row10
    const after = [...numbered("row", 3), "row6", "row7", "row8", "row9", "row10"];
    expect(unifiedDiff(numbered("row", 10), after, LABELS)).toBe(
      "--- before.txt\n+++ after.txt\n@@ -1,8 +1,6 @@\n row1\n row2\n row3\n-row4\n-row5\n row6\n row7\n row8",
    );
  });

  it("an append: the hunk starts three lines before the end", () => {
    // before.txt = row1..row10; after.txt = row1..row10, tail1, tail2
    expect(unifiedDiff(numbered("row", 10), [...numbered("row", 10), "tail1", "tail2"], LABELS)).toBe(
      "--- before.txt\n+++ after.txt\n@@ -8,3 +8,5 @@\n row8\n row9\n row10\n+tail1\n+tail2",
    );
  });

  it("deleting every line names the empty new range by the line before it (+0,0)", () => {
    // before.txt = only1..only3; after.txt = empty
    expect(unifiedDiff(["only1", "only2", "only3"], [], LABELS)).toBe(
      "--- before.txt\n+++ after.txt\n@@ -1,3 +0,0 @@\n-only1\n-only2\n-only3",
    );
    // before.txt = solo; after.txt = empty: a count of 1 omits the ",1"
    expect(unifiedDiff(["solo"], [], LABELS)).toBe("--- before.txt\n+++ after.txt\n@@ -1 +0,0 @@\n-solo");
  });

  it("adding lines to an empty document names the empty old range by the line before it (-0,0)", () => {
    // before.txt = empty; after.txt = fresh
    expect(unifiedDiff([], ["fresh"], LABELS)).toBe("--- before.txt\n+++ after.txt\n@@ -0,0 +1 @@\n+fresh");
  });

  it("returns the empty string when the inputs are equal", () => {
    expect(unifiedDiff(numbered("row", 4), numbered("row", 4), LABELS)).toBe("");
    expect(unifiedDiff([], [], LABELS)).toBe("");
  });

  it("uses the labels verbatim, so a name, a TAB and a timestamp survive", () => {
    const diff = unifiedDiff(["a"], ["b"], { oldLabel: "A.cls\t2026-10-15 10:00:00.000", newLabel: "A.cls\t2026-10-15 10:00:01.000" });
    expect(diff.split("\n").slice(0, 2)).toEqual([
      "--- A.cls\t2026-10-15 10:00:00.000",
      "+++ A.cls\t2026-10-15 10:00:01.000",
    ]);
  });

  it("prefixes lines that start with a space, a minus or a plus without confusing them with marks", () => {
    expect(unifiedDiff([" x", "-y"], [" x", "+z"], LABELS)).toBe(
      "--- before.txt\n+++ after.txt\n@@ -1,2 +1,2 @@\n  x\n--y\n++z",
    );
  });

  it("keeps trailing spaces, tabs and a trailing carriage return in the lines", () => {
    expect(unifiedDiff(["a  ", "b\r"], ["a  ", "c\t"], LABELS)).toBe(
      "--- before.txt\n+++ after.txt\n@@ -1,2 +1,2 @@\n a  \n-b\r\n+c\t",
    );
  });

  it("has no trailing newline", () => {
    expect(unifiedDiff(["a"], ["b"], LABELS).endsWith("\n")).toBe(false);
  });

  it("states three context lines", () => {
    expect(DIFF_CONTEXT_LINES).toBe(3);
  });

  it("is exported from the @iris-mcp/shared barrel", () => {
    expect(shared.unifiedDiff).toBe(unifiedDiff);
    expect(shared.alignLines).toBe(alignLines);
    expect(shared.DIFF_CONTEXT_LINES).toBe(DIFF_CONTEXT_LINES);
    expect(shared.MAX_DIFF_DISTANCE).toBe(MAX_DIFF_DISTANCE);
  });
});

/** The length of the longest common subsequence of two arrays, by dynamic programming (an independent oracle). */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  let previous: number[] = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? (previous[j - 1] as number) + 1
          : Math.max(previous[j] as number, current[j - 1] as number);
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/**
 * Apply a unified diff produced by unifiedDiff to `before`, checking as it goes that each hunk header
 * matches its rows and that every context and deleted row equals the line it names.
 */
function applyUnifiedDiff(before: readonly string[], diff: string): string[] {
  if (diff === "") return [...before];
  const rows = diff.split("\n");
  expect(rows[0]).toMatch(/^--- /);
  expect(rows[1]).toMatch(/^\+\+\+ /);
  const output: string[] = [];
  let position = 0;
  let index = 2;
  while (index < rows.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(rows[index] as string);
    expect(header, rows[index]).not.toBeNull();
    const oldStart = Number(header?.[1]);
    const oldCount = header?.[2] === undefined ? 1 : Number(header[2]);
    const newStart = Number(header?.[3]);
    const newCount = header?.[4] === undefined ? 1 : Number(header[4]);
    const firstOld = oldCount === 0 ? oldStart : oldStart - 1;
    output.push(...before.slice(position, firstOld));
    position = firstOld;
    expect(newCount === 0 ? newStart : newStart - 1).toBe(output.length);
    index += 1;
    let seenOld = 0;
    let seenNew = 0;
    while (index < rows.length && !(rows[index] as string).startsWith("@@ ")) {
      const row = rows[index] as string;
      const text = row.slice(1);
      if (row[0] === " " || row[0] === "-") {
        expect(before[position]).toBe(text);
        position += 1;
        seenOld += 1;
      }
      if (row[0] === " " || row[0] === "+") {
        output.push(text);
        seenNew += 1;
      }
      index += 1;
    }
    expect([seenOld, seenNew]).toEqual([oldCount, newCount]);
  }
  output.push(...before.slice(position));
  return output;
}

describe("alignLines and unifiedDiff over random edits", () => {
  const ALPHABET = ["a", "b", "c", "d", "e", "f", "g"];

  /** `before` with a seeded random set of deletions, insertions and replacements. */
  function randomEdit(random: () => number): { before: string[]; after: string[] } {
    const before = Array.from({ length: Math.floor(random() * 40) }, () => ALPHABET[Math.floor(random() * ALPHABET.length)] as string);
    const after: string[] = [];
    for (const line of before) {
      const roll = random();
      if (roll < 0.15) continue;
      after.push(roll < 0.3 ? `changed-${Math.floor(random() * 5)}` : line);
      if (random() < 0.15) after.push(`added-${Math.floor(random() * 5)}`);
    }
    return { before, after };
  }

  it("pairs ascending, equal lines, in a number that equals the longest common subsequence", () => {
    const random = mulberry32(384);
    for (let round = 0; round < 300; round += 1) {
      const { before, after } = randomEdit(random);
      const pairs = alignLines(before, after);
      let lastOld = 0;
      let lastNew = 0;
      for (const [i, j] of pairs) {
        expect(i).toBeGreaterThan(lastOld);
        expect(j).toBeGreaterThan(lastNew);
        expect(before[i - 1]).toBe(after[j - 1]);
        lastOld = i;
        lastNew = j;
      }
      expect(pairs.length, `round ${round}`).toBe(lcsLength(before, after));
    }
  });

  it("applying the hunks of unifiedDiff to before yields after, and every hunk header matches its rows", () => {
    const random = mulberry32(4);
    for (let round = 0; round < 300; round += 1) {
      const { before, after } = randomEdit(random);
      const diff = unifiedDiff(before, after, LABELS);
      expect(applyUnifiedDiff(before, diff), `round ${round}`).toEqual(after);
      expect(diff === "").toBe(before.length === after.length && before.every((line, i) => line === after[i]));
    }
  });

  it("every hunk has at most three context lines before its first change and after its last, and changes are never more than six unchanged lines apart inside it", () => {
    const random = mulberry32(77);
    for (let round = 0; round < 100; round += 1) {
      const { before, after } = randomEdit(random);
      const diff = unifiedDiff(before, after, LABELS);
      if (diff === "") continue;
      const hunks: string[][] = [];
      for (const row of diff.split("\n").slice(2)) {
        if (row.startsWith("@@ ")) hunks.push([]);
        else (hunks[hunks.length - 1] as string[]).push(row);
      }
      for (const hunk of hunks) {
        const marks = hunk.map((row) => row[0]);
        const firstChange = marks.findIndex((mark) => mark !== " ");
        const lastChange = marks.length - 1 - [...marks].reverse().findIndex((mark) => mark !== " ");
        expect(firstChange).toBeGreaterThanOrEqual(0);
        expect(firstChange).toBeLessThanOrEqual(DIFF_CONTEXT_LINES);
        expect(marks.length - 1 - lastChange).toBeLessThanOrEqual(DIFF_CONTEXT_LINES);
        let run = 0;
        for (const mark of marks.slice(firstChange, lastChange + 1)) {
          run = mark === " " ? run + 1 : 0;
          expect(run).toBeLessThanOrEqual(2 * DIFF_CONTEXT_LINES);
        }
      }
    }
  });

  it("pairs every line of equal arrays and none of an empty side", () => {
    expect(alignLines(["a", "b"], ["a", "b"])).toEqual([[1, 1], [2, 2]]);
    expect(alignLines([], ["a"])).toEqual([]);
    expect(alignLines(["a"], [])).toEqual([]);
    expect(alignLines([], [])).toEqual([]);
  });

  it("pairs the shifted lines after an insert, using 1-based indexes in each array", () => {
    expect(alignLines(["a", "b", "c"], ["a", "x", "b", "c"])).toEqual([[1, 1], [2, 3], [3, 4]]);
    expect(alignLines(["a", "b", "c"], ["a", "c"])).toEqual([[1, 1], [3, 2]]);
  });

  it("never mutates its inputs", () => {
    const before = ["a", "b", "c"];
    const after = ["a", "x", "c"];
    alignLines(before, after);
    unifiedDiff(before, after, LABELS);
    expect(before).toEqual(["a", "b", "c"]);
    expect(after).toEqual(["a", "x", "c"]);
  });
});

describe("the MAX_DIFF_DISTANCE fallback", () => {
  /** `head` distinct lines, then `keep`, then `tail` distinct lines; the line texts carry `prefix`. */
  function around(prefix: string, head: number, tail: number, keep: string): string[] {
    return [...numbered(`${prefix}h`, head), keep, ...numbered(`${prefix}t`, tail)];
  }

  it("keeps a common line while the lines that differ need at most the maximum", () => {
    // 1000 deletions + 1000 insertions = 2000 = MAX_DIFF_DISTANCE
    const pairs = alignLines(around("old", 500, 500, "KEEP"), around("new", 500, 500, "KEEP"));
    expect(MAX_DIFF_DISTANCE).toBe(2000);
    expect(pairs).toEqual([[501, 501]]);
  });

  it("reports the differing middle as one change when it needs more than the maximum", () => {
    // 1002 deletions + 1000 insertions = 2002 > MAX_DIFF_DISTANCE: the common line is not paired
    const before = around("old", 501, 501, "KEEP");
    const after = around("new", 500, 500, "KEEP");
    expect(alignLines(before, after)).toEqual([]);
  });

  it("still produces a valid diff, with every old line deleted and every new line inserted", () => {
    const before = around("old", 501, 501, "KEEP");
    const after = around("new", 500, 500, "KEEP");
    const diff = unifiedDiff(before, after, LABELS);
    expect(diff.split("\n")[2]).toBe(`@@ -1,${before.length} +1,${after.length} @@`);
    expect(applyUnifiedDiff(before, diff)).toEqual(after);
  });

  it("still trims the common head and tail before the fallback applies", () => {
    const head = numbered("head", 5);
    const tail = numbered("tail", 5);
    const before = [...head, ...numbered("old", 1500), ...tail];
    const after = [...head, ...numbered("new", 1500), ...tail];
    const pairs = alignLines(before, after);
    expect(pairs.slice(0, 5)).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]);
    expect(pairs).toHaveLength(10);
    expect(pairs[5]).toEqual([before.length - 4, after.length - 4]);
  });
});
