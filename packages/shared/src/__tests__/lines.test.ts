import { describe, it, expect } from "vitest";
import {
  stripLeadingBom,
  stripLeadingBomFromLines,
  documentLines,
  linesInRange,
  formatNumberedLines,
  NUMBERED_LINE_WIDTH,
} from "../lines.js";
import * as shared from "../index.js";

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
