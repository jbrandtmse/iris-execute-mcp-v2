/**
 * Story 39.2 (QA): the HL7 keep-list against an oracle that does not read it (AC-2; Rules #36, #44, #56, #58).
 *
 * The engine's own tests take the kept positions from `HL7_KEEP_FIELDS`, so a keep-list that drifted from the
 * reviewed table (a field added, say PV1-3 or NK1-8, neither of which the Safe Harbor inventory lists) would pass
 * them. Here `SPEC_KEEP_TABLE` is the reviewed table of the spec, typed out again in `hl7-keeplist-oracle.ts`:
 *
 *  - the shipped keep-list equals it, segment for segment and field for field;
 *  - for every reviewed segment, and for unreviewed siblings and Z-segments, a segment whose every field is tagged
 *    comes out with exactly the prescribed text, `redactedFields` included;
 *  - whole messages and batches, in three separator sets and every terminator style, come out as prescribed;
 *  - a seeded random sweep over segment mixes, field counts, separators and terminators comes out as prescribed;
 *  - a stray line that is not a segment (a raw line feed in free text splits one off) is refused
 *    (fail-closed) at every length, three included, and so is a name alone of a segment no one reviewed.
 */

import { describe, it, expect } from "vitest";
import { HL7_KEEP_FIELDS, redactHl7 } from "../hl7-redaction.js";
import {
  ALT_SEPARATORS,
  DEFAULT_SEPARATORS,
  PUNCTUATION_SEPARATORS,
  REVIEWED_BODY_SEGMENT_NAMES,
  SPEC_KEEP_TABLE,
  UNREVIEWED_SEGMENT_NAMES,
  buildSegment,
  joinSegments,
  type OracleSeparators,
} from "./hl7-keeplist-oracle.js";

/** Redact `text` and require success. */
function redacted(text: string): { text: string; redactedFields: number } {
  const result = redactHl7(text);
  if (!result.ok) throw new Error(`redaction refused: ${result.reason}`);
  return result;
}

const FIELD_COUNT = 70;

/** A header segment that precedes a body or trailer segment: an MSH with a few redactable fields. */
function headerFor(seps: OracleSeparators) {
  return buildSegment("MSH", 12, seps);
}

describe("the shipped keep-list equals the reviewed table", () => {
  it("names the same segments", () => {
    expect(Object.keys(HL7_KEEP_FIELDS).sort()).toEqual(Object.keys(SPEC_KEEP_TABLE).sort());
  });

  for (const [name, fields] of Object.entries(SPEC_KEEP_TABLE)) {
    it(`${name} keeps exactly fields ${fields.join(", ")}`, () => {
      expect([...(HL7_KEEP_FIELDS[name] ?? [])].sort((a, b) => a - b)).toEqual([...fields]);
    });
  }
});

describe("one segment at a time: exactly the reviewed fields survive, every other field is ***", () => {
  for (const seps of [DEFAULT_SEPARATORS, ALT_SEPARATORS, PUNCTUATION_SEPARATORS]) {
    describe(`separators ${seps.field}${seps.component}${seps.repetition}${seps.escape}${seps.subcomponent}`, () => {
      it("MSH, as the first segment", () => {
        const segment = buildSegment("MSH", FIELD_COUNT, seps);
        const result = redacted(`${segment.input}\r`);
        expect(result.text).toBe(`${segment.expected}\r`);
        expect(result.redactedFields).toBe(segment.redactedFields);
      });

      for (const name of ["FHS", "BHS"]) {
        it(`${name}, as the first segment`, () => {
          const segment = buildSegment(name, FIELD_COUNT, seps);
          const result = redacted(`${segment.input}\r`);
          expect(result.text).toBe(`${segment.expected}\r`);
          expect(result.redactedFields).toBe(segment.redactedFields);
        });
      }

      for (const name of ["FTS", "BTS", ...REVIEWED_BODY_SEGMENT_NAMES]) {
        it(`${name}, behind a message header`, () => {
          const header = headerFor(seps);
          const segment = buildSegment(name, FIELD_COUNT, seps);
          const message = joinSegments([header, segment], ["\r", "\r"]);
          const result = redacted(message.input);
          expect(result.text).toBe(message.expected);
          expect(result.redactedFields).toBe(message.redactedFields);
          expect(result.text).not.toContain("SYNTHPHI");
          const firstKept = (SPEC_KEEP_TABLE[name] as readonly number[])[0];
          expect(result.text, "the kept values survive").toContain(`KEEPME-${name}-${firstKept}-`);
        });
      }

      for (const name of UNREVIEWED_SEGMENT_NAMES) {
        it(`${name}, which no one reviewed: all ${FIELD_COUNT} fields are redacted`, () => {
          const header = headerFor(seps);
          const segment = buildSegment(name, FIELD_COUNT, seps);
          expect(segment.redactedFields, "the oracle keeps nothing of an unreviewed segment").toBeGreaterThan(50);
          const message = joinSegments([header, segment], ["\r", "\r"]);
          const result = redacted(message.input);
          expect(result.text).toBe(message.expected);
          expect(result.redactedFields).toBe(message.redactedFields);
          expect(result.text).not.toContain("SYNTHPHI");
        });
      }
    });
  }
});

describe("whole messages and batches", () => {
  const bodyNames = [...REVIEWED_BODY_SEGMENT_NAMES, ...UNREVIEWED_SEGMENT_NAMES];

  it("a message holding every reviewed body segment and every unreviewed one, CR-terminated", () => {
    const segments = [headerFor(DEFAULT_SEPARATORS), ...bodyNames.map((name) => buildSegment(name, 45))];
    const message = joinSegments(segments, segments.map(() => "\r"));
    const result = redacted(message.input);
    expect(result.text).toBe(message.expected);
    expect(result.redactedFields).toBe(message.redactedFields);
    expect(result.text).not.toContain("SYNTHPHI");
  });

  it("the same message with LF terminators and no terminator after the last segment", () => {
    const segments = [headerFor(ALT_SEPARATORS), ...bodyNames.map((name) => buildSegment(name, 45, ALT_SEPARATORS))];
    const message = joinSegments(segments, segments.map((_, index) => (index === segments.length - 1 ? "" : "\n")));
    const result = redacted(message.input);
    expect(result.text).toBe(message.expected);
    expect(result.redactedFields).toBe(message.redactedFields);
  });

  it("a file and batch envelope around two messages, one with its own separators", () => {
    const segments = [
      buildSegment("FHS", 14),
      buildSegment("BHS", 14),
      headerFor(DEFAULT_SEPARATORS),
      buildSegment("PID", 39, DEFAULT_SEPARATORS, { empty: [2, 3, 4, 10], trailingEmpty: 0 }),
      buildSegment("ZPI", 20, DEFAULT_SEPARATORS, { empty: [1, 20], trailingEmpty: 5 }),
      headerFor(PUNCTUATION_SEPARATORS),
      buildSegment("PID", 39, PUNCTUATION_SEPARATORS),
      buildSegment("PD1", 20, PUNCTUATION_SEPARATORS),
      buildSegment("BTS", 4, PUNCTUATION_SEPARATORS),
      buildSegment("FTS", 4, PUNCTUATION_SEPARATORS),
    ];
    const message = joinSegments(segments, ["\r", "\r\n", "\r", "\n", "\r", "\r", "\r\n", "\r", "\n", "\r"]);
    const result = redacted(message.input);
    expect(result.text).toBe(message.expected);
    expect(result.redactedFields).toBe(message.redactedFields);
    expect(result.text).not.toContain("SYNTHPHI");
  });
});

describe("a seeded random sweep over segment mixes, field counts, separators and terminators", () => {
  it("every message comes out exactly as the reviewed table prescribes (300 messages)", () => {
    let seed = 20010203;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % bound;
    };
    const separatorSets = [DEFAULT_SEPARATORS, ALT_SEPARATORS, PUNCTUATION_SEPARATORS];
    const terminatorSet = ["\r", "\r\n", "\n"];
    const pool = [...REVIEWED_BODY_SEGMENT_NAMES, ...UNREVIEWED_SEGMENT_NAMES];
    let redactedTotal = 0;
    for (let run = 0; run < 300; run += 1) {
      const seps = separatorSets[next(separatorSets.length)] as OracleSeparators;
      const options = (fieldCount: number) => ({
        empty: Array.from({ length: next(4) }, () => 1 + next(fieldCount)),
        trailingEmpty: next(3),
      });
      const mshFields = 2 + next(30);
      const segments = [buildSegment("MSH", mshFields, seps, options(mshFields))];
      const count = 1 + next(10);
      for (let i = 0; i < count; i += 1) {
        const name = pool[next(pool.length)] as string;
        const fieldCount = 1 + next(60);
        segments.push(buildSegment(name, fieldCount, seps, options(fieldCount)));
      }
      const terminators = segments.map(() => terminatorSet[next(terminatorSet.length)] as string);
      if (next(2) === 0) terminators[terminators.length - 1] = "";
      const message = joinSegments(segments, terminators);
      const result = redactHl7(message.input);
      expect(result.ok, `run ${run}`).toBe(true);
      if (!result.ok) continue;
      expect(result.text, `run ${run}`).toBe(message.expected);
      expect(result.redactedFields, `run ${run}`).toBe(message.redactedFields);
      expect(result.text, `run ${run}`).not.toContain("SYNTHPHI");
      redactedTotal += result.redactedFields;
    }
    expect(redactedTotal, "the sweep redacted fields (an empty sweep would pass)").toBeGreaterThan(1000);
  });
});

describe("a stray line that is not a segment is refused, never passed through (fail-closed)", () => {
  const header = "MSH|^~\\&|SYNTHPHI-APP|SYNTHPHI-FAC\r";
  const BAD_SEGMENT = "A segment name is not three capital letters or digits followed by the field separator.";
  const UNKNOWN_SEGMENT = "A segment name is neither an HL7 v2 segment (versions 2.1 to 2.8.2) nor a Z-segment.";
  const FIELDLESS_SEGMENT = "A segment with no fields is not one of the reviewed segments.";

  /** The refusal reason for `stray`, split off a free-text field by a raw line feed; the text must be refused. */
  function refusalOf(stray: string): string {
    const result = redactHl7(`${header}NTE|1||Dx: SYNTHPHI-a\n${stray}\r`);
    expect(result.ok, JSON.stringify(stray)).toBe(false);
    return result.ok ? "" : result.reason;
  }

  it("a continuation line of one, two, four or more characters, or of three that cannot be a segment name", () => {
    for (const stray of ["S", "SY", "SYNT", "SYNTHPHI", "synthphi", "Smith, J", "123", "1AB"]) {
      expect(refusalOf(stray), JSON.stringify(stray)).toBe(BAD_SEGMENT);
    }
  });

  it("a continuation line of exactly three characters that fit a segment name, but name no segment", () => {
    for (const stray of ["LEE", "JRS", "A12", "Y99"]) expect(refusalOf(stray), stray).toBe(UNKNOWN_SEGMENT);
  });

  it("a continuation line that starts with three such characters and then the field separator", () => {
    for (const stray of ["DOE|John was seen", "SMI|TH", "LEE|", "Y99|SYNTHPHI"]) {
      expect(refusalOf(stray), stray).toBe(UNKNOWN_SEGMENT);
    }
  });

  it("a name alone of a segment no one reviewed: standard, later-version or Z", () => {
    for (const stray of ["DON", "PD1", "ZOE", "ZPI"]) expect(refusalOf(stray), stray).toBe(FIELDLESS_SEGMENT);
  });

  it("a name that is followed by something other than the field separator", () => {
    for (const line of ["PID 1||SYNTHPHI", "PID\t1||SYNTHPHI", "PIDX|1||SYNTHPHI", "P|1||SYNTHPHI", "pid|1||SYNTHPHI"]) {
      expect(redactHl7(`${header}${line}\r`).ok, JSON.stringify(line)).toBe(false);
    }
  });

  it("a name-only line of a real segment is still accepted (the control for the refusals above)", () => {
    const result = redacted(`${header}PID\rPD1|SYNTHPHI-x\r`);
    expect(result.text).toBe("MSH|^~\\&|***|***\rPID\rPD1|***\r");
  });
});
