/**
 * Story 39.2: the HL7 v2 redaction engine (AD-26). Fail-closed: only the reviewed non-identifying fields
 * survive; everything else, an unreviewed segment or a Z-segment included, is redacted.
 *
 * Rows: the golden fixtures (exact text and exact `redactedFields`), the variety fixtures (Rule #58:
 * terminators, escapes, repetitions, components, subcomponents, unreviewed segments, batches,
 * non-default separators, non-ASCII values), the refusals, and the keep-list against the Safe Harbor
 * inventory. Position checks use a naive parser written in the fixtures file; the live gate repeats them
 * against IRIS's own parser.
 */

import { describe, it, expect } from "vitest";
import {
  HL7_KEEP_FIELDS,
  HL7_REDACTED_VALUE,
  HL7_REDACTION_REVIEW,
  HL7_SAFE_HARBOR_FIELDS,
  redactHl7,
} from "../hl7-redaction.js";
import {
  HL7_FIXTURES,
  HL7_GOLDEN,
  HL7_REFUSAL_FIXTURES,
  checkRedactedPositions,
  parseEr7Naive,
  separatorCharacters,
} from "./hl7-redaction-fixtures.js";

const FIXED_REASONS = [
  "The text does not start with an MSH, FHS or BHS segment.",
  "The field or encoding separators are not usable for redaction.",
  "A segment name is not three capital letters or digits followed by the field separator.",
  "The text could not be processed.",
];

/** Redact `text` and require success. */
function redacted(text: string): { text: string; redactedFields: number } {
  const result = redactHl7(text);
  if (!result.ok) throw new Error(`redaction refused: ${result.reason}`);
  return result;
}

/** The number of non-empty fields outside the keep-list that hold at least one non-separator character. */
function expectedRedactedFields(text: string): number {
  const separators = separatorCharacters(text);
  let count = 0;
  for (const segment of parseEr7Naive(text)) {
    const keep = HL7_KEEP_FIELDS[segment.name] ?? [];
    segment.fields.forEach((value, index) => {
      if (keep.includes(index + 1)) return;
      if ([...value].some((ch) => !separators.includes(ch))) count += 1;
    });
  }
  return count;
}

describe("the golden fixtures", () => {
  for (const golden of HL7_GOLDEN) {
    it(`${golden.name}: the output and the redacted field count are exact`, () => {
      const result = redacted(golden.text);
      expect(result.text).toBe(golden.expected);
      expect(result.redactedFields).toBe(golden.redactedFields);
    });
  }

  it("the ADT golden is the spec's example", () => {
    const [adt] = HL7_GOLDEN;
    expect(adt?.expected.split("\r")).toEqual([
      String.raw`MSH|^~\&|***|***|||***||ADT^A01^ADT_A01|***|P|2.5.1`,
      "PID|1||***^^^***~***||***^***||***|F",
      "ZPI|***||***",
      "",
    ]);
    expect(HL7_REDACTED_VALUE).toBe("***");
  });
});

describe("the variety fixtures (Rule #58)", () => {
  for (const fixture of HL7_FIXTURES) {
    describe(fixture.name, () => {
      const result = redactHl7(fixture.text);

      it("is redacted, not refused", () => {
        expect(result.ok).toBe(true);
      });

      it("keeps no SYNTHPHI value", () => {
        expect(redacted(fixture.text).text).not.toContain("SYNTHPHI");
      });

      it("keeps the segments, their order, every terminator and every field position", () => {
        const out = redacted(fixture.text).text;
        expect(out.match(/\r\n|\r|\n/g)).toEqual(fixture.text.match(/\r\n|\r|\n/g));
        expect(out.endsWith("\r") || out.endsWith("\n")).toBe(fixture.text.endsWith("\r") || fixture.text.endsWith("\n"));
        expect(checkRedactedPositions(parseEr7Naive(fixture.text), parseEr7Naive(out), separatorCharacters(fixture.text))).toEqual([]);
      });

      it("counts the fields it redacted", () => {
        expect(redacted(fixture.text).redactedFields).toBe(expectedRedactedFields(fixture.text));
        expect(redacted(fixture.text).redactedFields).toBeGreaterThan(0);
      });

      it("gives the same result when run twice", () => {
        const once = redacted(fixture.text);
        const twice = redacted(once.text);
        expect(twice.text).toBe(once.text);
      });
    });
  }
});

describe("the values that must survive (Rule #58)", () => {
  it("keeps every KEEPME value byte for byte, in each fixture that carries one", () => {
    const carrying = HL7_FIXTURES.filter((fixture) => fixture.text.includes("KEEPME"));
    expect(carrying.length, "the scan finds fixtures with a KEEPME value (an empty scan would pass)").toBeGreaterThanOrEqual(3);
    for (const fixture of carrying) {
      const values = fixture.text.match(/KEEPME[^|^~&#!@$%\r\n]*/g) ?? [];
      expect(values.length, fixture.name).toBeGreaterThan(0);
      const after = redacted(fixture.text).text;
      for (const value of values) expect(after, `${fixture.name}: ${value}`).toContain(value);
    }
  });
});

describe("rows with an exact expectation", () => {
  it("redacts every field of PD1, MRG and a Z-segment, which no one reviewed", () => {
    const text = HL7_FIXTURES.find((fixture) => fixture.name.startsWith("PD1, MRG"))?.text ?? "";
    const lines = redacted(text).text.split("\r");
    expect(lines).toContain("PD1|***^***||***");
    expect(lines).toContain("MRG|***^^^***||||***||***");
    expect(lines).toContain("ZXX|***|***^***&***~***");
  });

  it("redacts everything of a segment that is missing from the keep-list, whatever its fields hold", () => {
    expect(redacted(String.raw`MSH|^~\&|a|b` + "\rZZZ|KEEPME|x^y\r").text).toBe(String.raw`MSH|^~\&|***|***` + "\rZZZ|***|***^***\r");
  });

  it("an MSH-only message keeps the separators, the type, the processing ID and the version", () => {
    const text = HL7_FIXTURES.find((fixture) => fixture.name === "an MSH-only message")?.text ?? "";
    expect(redacted(text).text).toBe(String.raw`MSH|^~\&|***|***|||***||ACK|***|P|2.5.1` + "\r");
  });

  it("CRLF, LF and mixed terminators are kept as they were", () => {
    const reference = redacted(HL7_FIXTURES.find((fixture) => fixture.name === "ADT A01 with repetitions, components, subcomponents, escapes and a Z-segment")?.text ?? "").text;
    const crlf = HL7_FIXTURES.find((fixture) => fixture.name === "CRLF terminators")?.text ?? "";
    const lf = HL7_FIXTURES.find((fixture) => fixture.name === "LF terminators")?.text ?? "";
    expect(redacted(crlf).text).toBe(reference.replaceAll("\r", "\r\n"));
    expect(redacted(lf).text).toBe(reference.replaceAll("\r", "\n"));
  });

  it("blank lines and a missing trailing terminator are kept", () => {
    expect(redacted(String.raw`MSH|^~\&|a|b` + "\r\r\rZZZ|x").text).toBe(String.raw`MSH|^~\&|***|***` + "\r\r\rZZZ|***");
    expect(redacted("\n\n" + String.raw`MSH|^~\&|a|b`).text).toBe("\n\n" + String.raw`MSH|^~\&|***|***`);
  });

  it("a kept field with escape sequences is byte-identical and a redacted one becomes ***", () => {
    const text = HL7_FIXTURES.find((fixture) => fixture.name === "all HL7 escape sequences in kept and redacted fields")?.text ?? "";
    const lines = redacted(text).text.split("\r");
    expect(lines[2]).toBe(String.raw`OBX|1|TX|ESC^KEEPME\F\\S\\T\\R\\E\\X0D\\H\\N\^L||***||||||F`);
    expect(lines[1]).toBe(String.raw`PID|1||***||***^***||***|M`);
    expect(lines[0]).toBe(String.raw`MSH|^~\&|***|***|||***||ORU^R01^ORU_R01|***|P|2.5.1`);
    expect(lines[3]).toBe("NTE|1|L|***");
  });

  it("non-default separators keep the MSH-1 and MSH-2 the message declares", () => {
    const text = HL7_FIXTURES.find((fixture) => fixture.name === "non-default separators")?.text ?? "";
    const lines = redacted(text).text.split("\r");
    expect(lines[0]).toBe("MSH#!@$%#***#***###***##ADT!A01!ADT_A01#***#P#2.5.1");
    expect(lines[1]).toBe("PID#1##***!!!***@***##***!***%***##***#F");
  });

  it("a batch keeps the counts and redacts the envelope's names, times, comments and control IDs", () => {
    const text = HL7_FIXTURES.find((fixture) => fixture.name === "a file and batch envelope")?.text ?? "";
    const lines = redacted(text).text.split("\r");
    expect(lines[0]).toBe(String.raw`FHS|^~\&|***|***|||***|***|***|***`);
    expect(lines[1]).toBe(String.raw`BHS|^~\&|***|***`);
    expect(lines[4]).toBe("BTS|1|***");
    expect(lines[5]).toBe("FTS|1|***");
  });

  it("a batch follows each MSH's own separators", () => {
    const text = HL7_FIXTURES.find((fixture) => fixture.name === "a batch whose messages use different separators")?.text ?? "";
    const out = redacted(text).text;
    expect(out).not.toContain("SYNTHPHI");
    const lines = out.split("\r");
    expect(lines[2]).toBe("PID|1||***^^^***~***||***^***||***|F");
    expect(lines[4]).toBe("PID#1##***!!!***@***##***!***##***#F");
  });

  it("the golden ACK keeps the acknowledgment code", () => {
    expect(redacted(HL7_GOLDEN[1]?.text ?? "").text).toContain("MSA|AA|***");
  });
});

describe("refusals", () => {
  for (const refusal of HL7_REFUSAL_FIXTURES) {
    it(`${refusal.name}: refuses with a fixed reason that holds no input`, () => {
      const result = redactHl7(refusal.text);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(FIXED_REASONS).toContain(result.reason);
      expect(result.reason).not.toContain("SYNTHPHI");
    });
  }

  it("never throws, whatever it is given", () => {
    for (const value of [undefined, null, 5, {}, [], Symbol.iterator] as unknown[]) {
      expect(() => redactHl7(value as string)).not.toThrow();
      expect(redactHl7(value as string).ok).toBe(false);
    }
  });

  it("never throws on random text built from separators, terminators and segment names", () => {
    const alphabet = ["MSH", "PID", "ZZZ", "|", "^", "~", "\\", "&", "#", "*", "\r", "\n", "\r\n", "a", "SYNTHPHI-x", " ", "1"];
    let seed = 20010203;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let run = 0; run < 300; run += 1) {
      let text = run % 2 === 0 ? String.raw`MSH|^~\&|a` : "";
      for (let part = 0; part < 30; part += 1) text += alphabet[next() % alphabet.length];
      const result = redactHl7(text);
      if (!result.ok) {
        expect(FIXED_REASONS).toContain(result.reason);
        continue;
      }
      expect(redactHl7(result.text)).toEqual({ ok: true, text: result.text, redactedFields: expect.any(Number) });
    }
  });
});

describe("the keep-list and the Safe Harbor inventory", () => {
  it("record the review date and their sources", () => {
    expect(HL7_REDACTION_REVIEW.date).toBe("2026-10-16");
    expect(HL7_REDACTION_REVIEW.hl7Version).toBe("2.5.1");
    expect(HL7_REDACTION_REVIEW.sources.length).toBeGreaterThanOrEqual(3);
    for (const source of HL7_REDACTION_REVIEW.sources) expect(source).not.toBe("");
    expect(HL7_REDACTION_REVIEW.sources.join(" ")).toContain("164.514(b)(2)(i)");
    expect(HL7_REDACTION_REVIEW.sources.join(" ")).toContain("profiles.ihe.net/ITI/DeId/hl7-example.html");
  });

  it("do not intersect: no field is both kept and listed as identifying", () => {
    const overlap = HL7_SAFE_HARBOR_FIELDS.filter((entry) => (HL7_KEEP_FIELDS[entry.segment] ?? []).includes(entry.field));
    expect(overlap).toEqual([]);
  });

  it("the inventory tags every field with a 45 CFR 164.514(b)(2)(i) category from A to R, once each", () => {
    const seen = new Set<string>();
    for (const entry of HL7_SAFE_HARBOR_FIELDS) {
      expect(entry.category, `${entry.segment}-${entry.field}`).toMatch(/^[A-R]$/);
      expect(Number.isInteger(entry.field) && entry.field > 0).toBe(true);
      const key = `${entry.segment}-${entry.field}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("the inventory lists the identifiers the IHE de-identification example names", () => {
    const listed = new Set(HL7_SAFE_HARBOR_FIELDS.map((entry) => `${entry.segment}-${entry.field}`));
    for (const key of ["MSH-10", "PID-3", "PID-5", "PID-7", "PID-11", "PID-13", "PID-14", "PID-18", "PID-19", "PV1-19", "OBR-7", "OBR-8", "NTE-3"]) {
      expect(listed.has(key), key).toBe(true);
    }
  });

  it("the keep-list keeps the separators of every segment that declares them, and only the reviewed fields elsewhere", () => {
    for (const name of ["MSH", "FHS", "BHS"]) expect(HL7_KEEP_FIELDS[name]).toEqual(expect.arrayContaining([1, 2]));
    expect(HL7_KEEP_FIELDS.PID).toEqual([1, 8]);
    expect(HL7_KEEP_FIELDS.PD1).toBeUndefined();
    expect(HL7_KEEP_FIELDS.MRG).toBeUndefined();
    for (const [name, fields] of Object.entries(HL7_KEEP_FIELDS)) {
      expect(name).toMatch(/^[A-Z][A-Z0-9]{2}$/);
      for (const field of fields) expect(Number.isInteger(field) && field > 0, `${name}-${field}`).toBe(true);
    }
  });
});
