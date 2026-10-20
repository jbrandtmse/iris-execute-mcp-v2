/**
 * Story 41.6 - DW-616: the marked-block reader and writer, at unit level, with byte oracles (Rule #58).
 *
 * Fixtures are non-canonical on purpose: CRLF, BOM, no final newline, invalid UTF-8, comments, look-alike
 * markers, foreign blocks. The oracles are byte equality outside the block, a round trip equal to the original,
 * and an idempotent replace. Non-ASCII and BOM bytes are built from numbers.
 */

import { describe, expect, it } from "vitest";

import {
  describeAmbiguousRuleBlock,
  hasUtf16Bom,
  locateRuleBlock,
  ruleBlockMarkers,
  ruleSectionProblem,
  withRuleBlock,
  withoutRuleBlock,
} from "../rule-block.js";

import { BOM, hostFixtures, sectionOf } from "./pack-test-helpers.js";

const STEM = "iris-mcp-objectscript-pre-write";
const SECTION = sectionOf(STEM, "## Checklist\n\n- one\n- two");
const OTHER_SECTION = sectionOf(STEM, "## Changed checklist");
const BEGIN = `<!-- IRIS-MCP-RULE:${STEM}:BEGIN -->`;
const END = `<!-- IRIS-MCP-RULE:${STEM}:END -->`;

function text(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
  return result as Extract<T, { ok: true }>;
}

describe("markers", () => {
  it("are the exact whole lines of the convention", () => {
    expect(ruleBlockMarkers(STEM)).toEqual({ begin: BEGIN, end: END });
  });
});

describe("locateRuleBlock", () => {
  it("reports absent for a host without our markers", () => {
    expect(locateRuleBlock(text("# Title\n"), STEM)).toEqual({ status: "absent" });
    expect(locateRuleBlock(Buffer.alloc(0), STEM)).toEqual({ status: "absent" });
  });

  it("finds one block with 1-based line numbers and byte offsets", () => {
    const pre = text("# Title\n\n");
    const post = text("tail\n");
    const host = Buffer.concat([pre, SECTION, post]);
    const found = locateRuleBlock(host, STEM);
    expect(found).toEqual({
      status: "one",
      start: pre.length,
      end: pre.length + SECTION.length,
      beginLine: 3,
      endLine: 3 + SECTION.toString("utf8").split("\n").length - 2,
    });
  });

  it("counts lines the same for CRLF hosts", () => {
    const host = text(`a\r\n${BEGIN}\r\nbody\r\n${END}\r\nz\r\n`);
    const found = locateRuleBlock(host, STEM);
    expect(found).toMatchObject({ status: "one", beginLine: 2, endLine: 4 });
  });

  it("reads a BEGIN line right after a BOM as line 1 (D7)", () => {
    const host = Buffer.concat([BOM, SECTION]);
    expect(locateRuleBlock(host, STEM)).toEqual({
      status: "one",
      start: 3,
      end: host.length,
      beginLine: 1,
      endLine: SECTION.toString("utf8").split("\n").length - 1,
    });
  });

  it("finds a block whose END line has no line ending at the end of the file", () => {
    const host = text(`${BEGIN}\nbody\n${END}`);
    expect(locateRuleBlock(host, STEM)).toMatchObject({ status: "one", start: 0, end: host.length });
  });

  describe("look-alike lines are not markers (no guess)", () => {
    const lookAlikes: Array<[string, Buffer]> = [
      ["indented", text(`  ${BEGIN}\nx\n  ${END}\n`)],
      ["trailing blank", text(`${BEGIN} \nx\n${END} \n`)],
      ["trailing tab", text(`${BEGIN}\t\nx\n${END}\t\n`)],
      ["other case", text(`${BEGIN.toLowerCase()}\nx\n${END.toLowerCase()}\n`)],
      ["other rule name", text(`<!-- IRIS-MCP-RULE:${STEM}-2:BEGIN -->\nx\n<!-- IRIS-MCP-RULE:${STEM}-2:END -->\n`)],
      ["inline in a sentence", text(`see ${BEGIN} and ${END} here\n`)],
      ["after a BOM on a line other than 1", Buffer.concat([text("first\n"), BOM, text(`${BEGIN}\nx\n`), BOM, text(`${END}\n`)])],
      ["a second BOM before BEGIN on line 1", Buffer.concat([BOM, BOM, text(`${BEGIN}\nx\n  ${END}\n`)])],
    ];
    for (const [name, host] of lookAlikes) {
      it(`${name}`, () => {
        expect(locateRuleBlock(host, STEM)).toEqual({ status: "absent" });
        const inserted = ok(withRuleBlock(host, SECTION, STEM));
        expect(inserted.change).toBe("insert");
        expect(locateRuleBlock(inserted.bytes, STEM)).toMatchObject({ status: "one" });
      });
    }

    it("a look-alike beside one real block still reads the real block only", () => {
      const host = Buffer.concat([text(`  ${BEGIN}\n`), SECTION, text(`  ${END}\n`)]);
      expect(locateRuleBlock(host, STEM)).toMatchObject({ status: "one", beginLine: 2 });
    });
  });

  describe("ambiguous own markers are reported with their line numbers (DW-616)", () => {
    const cases: Array<[string, string, number[], number[]]> = [
      ["two of our sections", `${BEGIN}\na\n${END}\n${BEGIN}\nb\n${END}\n`, [1, 4], [3, 6]],
      ["BEGIN without END", `x\n${BEGIN}\nbody\n`, [2], []],
      ["END without BEGIN", `x\nbody\n${END}\n`, [], [3]],
      ["two BEGIN lines and one END", `${BEGIN}\n${BEGIN}\nx\n${END}\n`, [1, 2], [4]],
      ["one BEGIN and two END lines", `${BEGIN}\nx\n${END}\n${END}\n`, [1], [3, 4]],
      ["END before BEGIN", `${END}\nx\n${BEGIN}\n`, [3], [1]],
    ];
    for (const [name, content, begins, ends] of cases) {
      it(name, () => {
        const host = text(content);
        expect(locateRuleBlock(host, STEM)).toEqual({ status: "ambiguous", begins, ends });
        const expected = describeAmbiguousRuleBlock(STEM, begins, ends);
        expect(withRuleBlock(host, SECTION, STEM)).toEqual({ ok: false, reason: "ambiguous", location: expected });
        expect(withoutRuleBlock(host, STEM, { lineEndingAdded: "", created: false })).toEqual({
          ok: false,
          reason: "ambiguous",
          location: expected,
        });
      });
    }

    it("words the location with the fix", () => {
      expect(describeAmbiguousRuleBlock("r", [1, 4], [])).toBe(
        "the r markers are not one BEGIN line followed by one END line: BEGIN at line(s) 1, 4, END at line(s) none; fix them by hand, then re-run",
      );
      expect(describeAmbiguousRuleBlock("r", [], [3])).toContain("BEGIN at line(s) none, END at line(s) 3;");
    });
  });
});

describe("withRuleBlock", () => {
  it("creates a file holding the section when there is no host", () => {
    const result = ok(withRuleBlock(null, SECTION, STEM));
    expect(result.change).toBe("create");
    expect(result.lineEndingAdded).toBe("");
    expect(result.bytes.equals(SECTION)).toBe(true);
  });

  it("makes an empty host the section with no line ending added", () => {
    const result = ok(withRuleBlock(Buffer.alloc(0), SECTION, STEM));
    expect(result.change).toBe("insert");
    expect(result.lineEndingAdded).toBe("");
    expect(result.bytes.equals(SECTION)).toBe(true);
  });

  it("keeps a BOM at byte 0 and adds nothing after a BOM-only host", () => {
    const result = ok(withRuleBlock(Buffer.from(BOM), SECTION, STEM));
    expect(result.lineEndingAdded).toBe("");
    expect(result.bytes.equals(Buffer.concat([BOM, SECTION]))).toBe(true);
  });

  it("ends an unterminated last line in the file's own style before the block", () => {
    const lf = ok(withRuleBlock(text("a\nlast"), SECTION, STEM));
    expect(lf.lineEndingAdded).toBe("\n");
    expect(lf.bytes.equals(Buffer.concat([text("a\nlast\n"), SECTION]))).toBe(true);
    // The real insert ends the line first, so BEGIN is a whole line and is found.
    expect(locateRuleBlock(lf.bytes, STEM)).toMatchObject({ status: "one", beginLine: 3 });

    const crlf = ok(withRuleBlock(text("a\r\nlast"), SECTION, STEM));
    expect(crlf.lineEndingAdded).toBe("\r\n");
    expect(crlf.bytes.equals(Buffer.concat([text("a\r\nlast\r\n"), SECTION]))).toBe(true);
  });

  it("copies the section's LF bytes as they are into a CRLF host", () => {
    const result = ok(withRuleBlock(text("a\r\n"), SECTION, STEM));
    expect(result.lineEndingAdded).toBe("");
    expect(result.bytes.equals(Buffer.concat([text("a\r\n"), SECTION]))).toBe(true);
  });

  it("replaces an existing block whole and leaves every other byte alone", () => {
    const pre = Buffer.concat([BOM, text("# T\r\n"), Buffer.from([0xc3, 0x28, 0x0a])]);
    const post = text("tail without newline");
    const host = Buffer.concat([pre, SECTION, post]);
    const result = ok(withRuleBlock(host, OTHER_SECTION, STEM));
    expect(result.change).toBe("replace");
    expect(result.bytes.equals(Buffer.concat([pre, OTHER_SECTION, post]))).toBe(true);
    // Replacing back restores the original bytes exactly.
    const back = ok(withRuleBlock(result.bytes, SECTION, STEM));
    expect(back.bytes.equals(host)).toBe(true);
  });

  it("is unchanged when the block already equals the section", () => {
    const host = Buffer.concat([text("x\n"), SECTION, text("y\n")]);
    const result = ok(withRuleBlock(host, SECTION, STEM));
    expect(result.change).toBe("unchanged");
    expect(result.bytes.equals(host)).toBe(true);
  });

  it("refuses a host that starts with a UTF-16 byte-order mark", () => {
    for (const bom of [Buffer.from([0xff, 0xfe, 0x41, 0x00]), Buffer.from([0xfe, 0xff, 0x00, 0x41])]) {
      expect(hasUtf16Bom(bom)).toBe(true);
      const result = withRuleBlock(bom, SECTION, STEM);
      expect(result).toMatchObject({ ok: false, reason: "utf16" });
      expect(withoutRuleBlock(bom, STEM, { lineEndingAdded: "", created: false })).toMatchObject({ ok: false, reason: "utf16" });
    }
    expect(hasUtf16Bom(Buffer.concat([BOM, text("x")]))).toBe(false);
  });

  it("refuses a section that is not exactly its own BEGIN line, a body and its own END line", () => {
    const bad: Array<[string, Buffer]> = [
      ["empty", Buffer.alloc(0)],
      ["no END", text(`${BEGIN}\nbody\n`)],
      ["no final line ending", text(`${BEGIN}\nbody\n${END}`)],
      ["text before BEGIN", text(`x\n${BEGIN}\nbody\n${END}\n`)],
      ["text after END", text(`${BEGIN}\nbody\n${END}\nx\n`)],
      ["two blocks", Buffer.concat([SECTION, SECTION])],
      ["another rule's markers", sectionOf("other", "body")],
      ["a BOM", Buffer.concat([BOM, SECTION])],
    ];
    for (const [name, section] of bad) {
      expect(ruleSectionProblem(section, STEM), name).not.toBeNull();
      expect(withRuleBlock(text("a\n"), section, STEM), name).toMatchObject({ ok: false, reason: "section" });
    }
    expect(ruleSectionProblem(SECTION, STEM)).toBeNull();
  });
});

describe("withoutRuleBlock", () => {
  it("returns an unchanged copy for a host without the block", () => {
    const host = text("nothing here\n");
    const result = ok(withoutRuleBlock(host, STEM, { lineEndingAdded: "", created: false }));
    expect(result.change).toBe("absent");
    expect(result.bytes?.equals(host)).toBe(true);
  });

  it("deletes the file when the installer created it and nothing else is left", () => {
    const created = ok(withRuleBlock(null, SECTION, STEM));
    const removed = ok(withoutRuleBlock(created.bytes, STEM, { lineEndingAdded: "", created: true }));
    expect(removed.change).toBe("remove");
    expect(removed.bytes).toBeNull();
  });

  it("keeps a created file that the user added content to", () => {
    const host = Buffer.concat([SECTION, text("user note\n")]);
    const removed = ok(withoutRuleBlock(host, STEM, { lineEndingAdded: "", created: true }));
    expect(removed.bytes?.equals(text("user note\n"))).toBe(true);
  });

  it("returns an empty file, not null, when the host was not created by the installer", () => {
    const removed = ok(withoutRuleBlock(SECTION, STEM, { lineEndingAdded: "", created: false }));
    expect(removed.bytes?.length).toBe(0);
  });

  it("strips the recorded line ending only when the block was at the end of the file", () => {
    const original = text("a\nlast");
    const inserted = ok(withRuleBlock(original, SECTION, STEM));
    expect(ok(withoutRuleBlock(inserted.bytes, STEM, { lineEndingAdded: "\n", created: false })).bytes?.equals(original)).toBe(true);

    // The user added a line after the block: the ending we added is no longer at the join, so it stays.
    const extended = Buffer.concat([inserted.bytes, text("more\n")]);
    const removed = ok(withoutRuleBlock(extended, STEM, { lineEndingAdded: "\n", created: false }));
    expect(removed.bytes?.equals(text("a\nlast\nmore\n"))).toBe(true);
  });

  it("keeps a BOM at byte 0 when the block was first", () => {
    const host = Buffer.concat([BOM, SECTION, text("tail\n")]);
    const removed = ok(withoutRuleBlock(host, STEM, { lineEndingAdded: "", created: false }));
    expect(removed.bytes?.equals(Buffer.concat([BOM, text("tail\n")]))).toBe(true);
  });
});

describe("byte oracles over the host fixtures (Rule #58)", () => {
  for (const fixture of hostFixtures(STEM)) {
    describe(fixture.name, () => {
      it("install keeps every byte outside the block, and the block equals the section", () => {
        const result = ok(withRuleBlock(fixture.bytes, SECTION, STEM));
        const added = Buffer.from(result.lineEndingAdded, "utf8");
        expect(result.bytes.subarray(0, fixture.bytes.length).equals(fixture.bytes)).toBe(true);
        expect(result.bytes.subarray(fixture.bytes.length, fixture.bytes.length + added.length).equals(added)).toBe(true);
        expect(result.bytes.subarray(fixture.bytes.length + added.length).equals(SECTION)).toBe(true);
        if (fixture.bytes.subarray(0, 3).equals(BOM)) expect(result.bytes.subarray(0, 3).equals(BOM)).toBe(true);
        const found = locateRuleBlock(result.bytes, STEM);
        expect(found.status).toBe("one");
      });

      it("uninstall restores exactly the original bytes", () => {
        const inserted = ok(withRuleBlock(fixture.bytes, SECTION, STEM));
        const removed = ok(
          withoutRuleBlock(inserted.bytes, STEM, { lineEndingAdded: inserted.lineEndingAdded, created: false }),
        );
        expect(removed.bytes?.equals(fixture.bytes)).toBe(true);
      });

      it("a second install is unchanged, and a replace round-trips", () => {
        const inserted = ok(withRuleBlock(fixture.bytes, SECTION, STEM));
        const again = ok(withRuleBlock(inserted.bytes, SECTION, STEM));
        expect(again.change).toBe("unchanged");
        expect(again.bytes.equals(inserted.bytes)).toBe(true);
        const replaced = ok(withRuleBlock(inserted.bytes, OTHER_SECTION, STEM));
        expect(replaced.change).toBe("replace");
        const restored = ok(withRuleBlock(replaced.bytes, SECTION, STEM));
        expect(restored.bytes.equals(inserted.bytes)).toBe(true);
      });
    });
  }

  it("the block first after a BOM, in the middle, last, or the whole file all survive replace and remove", () => {
    const pre = Buffer.concat([text("# Title\r\n"), Buffer.from([0xc3, 0x28, 0x0a])]);
    const post = text("trailer\r\n");
    const layouts: Array<[string, Buffer, Buffer, Buffer]> = [
      ["first after a BOM", BOM, Buffer.alloc(0), post],
      ["in the middle", pre, Buffer.alloc(0), post],
      ["last", pre, Buffer.alloc(0), Buffer.alloc(0)],
      ["the whole file", Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)],
    ];
    for (const [name, before, , after] of layouts) {
      const host = Buffer.concat([before, SECTION, after]);
      const replaced = ok(withRuleBlock(host, OTHER_SECTION, STEM));
      expect(replaced.bytes.equals(Buffer.concat([before, OTHER_SECTION, after])), `${name}: replace`).toBe(true);
      const removed = ok(withoutRuleBlock(host, STEM, { lineEndingAdded: "", created: false }));
      expect(removed.bytes?.equals(Buffer.concat([before, after])), `${name}: remove`).toBe(true);
    }
  });
});
