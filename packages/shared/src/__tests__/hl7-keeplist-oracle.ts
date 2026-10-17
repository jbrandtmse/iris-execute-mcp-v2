/**
 * Story 39.2 (QA): an oracle for the HL7 keep-list that is independent of `hl7-redaction.ts`.
 *
 * `SPEC_KEEP_TABLE` is transcribed from the reviewed keep-list table of the Story 39.2 spec (Design Notes,
 * HL7 v2.5.1, reviewed 2026-10-16), never read from the engine, so a keep-list that drifts from the review
 * (a field added or dropped) disagrees with it. `buildSegment` writes one segment whose every field carries
 * a tagged value: `KEEPME-<seg>-<n>-...` where the table keeps field n, `SYNTHPHI-<seg>-<n>-...` where it
 * does not. It returns the input line and the output the table prescribes: a kept field byte-identical, every
 * non-empty leaf of any other field `***`, separators and empty leaves unchanged. Every value holds two
 * components, a subcomponent, a repetition and an escape sequence, so the leaf-wise rule is exercised in
 * every position. No position is empty unless the caller says so (an empty field hides a drifted keep-list
 * entry at that position), and trailing empty fields follow the last tagged one.
 *
 * Shared by `hl7-redaction-keeplist.test.ts` (the source) and the `@iris-mcp/all` process test (the built dist).
 */

/** The separators a message declares: the field separator and the four encoding characters. */
export interface OracleSeparators {
  field: string;
  component: string;
  repetition: string;
  escape: string;
  subcomponent: string;
}

export const DEFAULT_SEPARATORS: OracleSeparators = { field: "|", component: "^", repetition: "~", escape: "\\", subcomponent: "&" };
export const ALT_SEPARATORS: OracleSeparators = { field: "#", component: "!", repetition: "@", escape: "$", subcomponent: "%" };
export const PUNCTUATION_SEPARATORS: OracleSeparators = { field: "+", component: ":", repetition: ";", escape: "?", subcomponent: "," };

/** The reviewed keep-list, by segment: HL7 v2.5.1 field numbers (MSH, FHS and BHS number the field separator 1). */
export const SPEC_KEEP_TABLE: Readonly<Record<string, readonly number[]>> = {
  MSH: [1, 2, 9, 11, 12, 15, 16, 18],
  FHS: [1, 2],
  BHS: [1, 2],
  FTS: [1],
  BTS: [1],
  EVN: [1, 4],
  MSA: [1],
  ERR: [3, 4],
  PID: [1, 8],
  NK1: [1, 3, 7],
  PV1: [1, 2, 4, 18],
  GT1: [1],
  IN1: [1],
  ORC: [1, 5],
  OBR: [1, 4, 24, 25],
  OBX: [1, 2, 3, 4, 6, 8, 11],
  NTE: [1, 2],
  DG1: [1, 2, 3, 6],
  AL1: [1, 2, 3, 4],
  PR1: [1, 2, 3],
  SPM: [1, 4],
};

/** The segments whose first field is the field separator and whose second is the encoding characters. */
export const SEPARATOR_SEGMENT_NAMES = ["MSH", "FHS", "BHS"] as const;

/**
 * Segments no one reviewed, each a real HL7 v2 segment or a Z-segment that can carry identifying data
 * (PD1, PV2, IN2, IN3, MRG and the rest are siblings of reviewed segments). All of their fields are redacted.
 */
export const UNREVIEWED_SEGMENT_NAMES = [
  "PD1", "PV2", "IN2", "IN3", "MRG", "ACC", "DB1", "ARV", "STF", "IAM", "RXA", "SCH", "TQ1", "ZPI", "ZXX", "Z01",
] as const;

/** The reviewed segments that are neither batch nor message headers. */
export const REVIEWED_BODY_SEGMENT_NAMES = Object.keys(SPEC_KEEP_TABLE).filter(
  (name) => !(SEPARATOR_SEGMENT_NAMES as readonly string[]).includes(name) && name !== "FTS" && name !== "BTS",
);

/** What one built segment looks like going in and coming out. */
export interface OracleSegment {
  /** The segment line as the input holds it. */
  input: string;
  /** The line the keep-list prescribes. */
  expected: string;
  /** How many fields have a non-empty leaf the keep-list does not keep. */
  redactedFields: number;
}

/** The value of field `n` of `name`: two components, a subcomponent, a repetition and an escape sequence. */
function fieldValue(name: string, n: number, seps: OracleSeparators, kept: boolean): { input: string; expected: string } {
  const tag = kept ? "KEEPME" : "SYNTHPHI";
  const leaf = (suffix: string): string => `${tag}-${name}-${n}-${suffix}`;
  const parts = [
    leaf("a"),
    seps.component,
    `${leaf("b")}${seps.escape}F${seps.escape}x`,
    seps.subcomponent,
    leaf("c"),
    seps.repetition,
    leaf("d"),
  ];
  const input = parts.join("");
  const expected = kept ? input : ["***", seps.component, "***", seps.subcomponent, "***", seps.repetition, "***"].join("");
  return { input, expected };
}

/** What `buildSegment` varies besides the segment, its length and its separators. */
export interface BuildOptions {
  /** The field numbers left empty, which neither side changes. None by default, so every position carries a tag. */
  empty?: readonly number[];
  /** How many empty fields follow the last numbered one. Two by default. */
  trailingEmpty?: number;
}

/**
 * Build one segment with `fieldCount` tagged fields (counting the field separator as field 1 on MSH, FHS and
 * BHS), followed by empty fields. The keep-list followed is always {@link SPEC_KEEP_TABLE}.
 *
 * @param name - The segment name.
 * @param fieldCount - The highest tagged field number; at least 2 on a separator segment.
 * @param seps - The separators the line uses.
 * @param options - Interior empty fields and the trailing empty-field count.
 */
export function buildSegment(
  name: string,
  fieldCount: number,
  seps: OracleSeparators = DEFAULT_SEPARATORS,
  options: BuildOptions = {},
): OracleSegment {
  const kept = SPEC_KEEP_TABLE[name] ?? [];
  const empty = options.empty ?? [];
  const isSeparatorSegment = (SEPARATOR_SEGMENT_NAMES as readonly string[]).includes(name);
  const encoding = `${seps.component}${seps.repetition}${seps.escape}${seps.subcomponent}`;
  let input = isSeparatorSegment ? `${name}${seps.field}${encoding}` : name;
  let expected = input;
  let redactedFields = 0;
  for (let n = isSeparatorSegment ? 3 : 1; n <= fieldCount; n += 1) {
    if (empty.includes(n)) {
      input += seps.field;
      expected += seps.field;
      continue;
    }
    const isKept = kept.includes(n);
    const value = fieldValue(name, n, seps, isKept);
    input += `${seps.field}${value.input}`;
    expected += `${seps.field}${value.expected}`;
    if (!isKept) redactedFields += 1;
  }
  const trailing = seps.field.repeat(options.trailingEmpty ?? 2);
  return { input: input + trailing, expected: expected + trailing, redactedFields };
}

/** A whole text built from segments, with the terminator after each line chosen by the caller. */
export interface OracleMessage {
  input: string;
  expected: string;
  redactedFields: number;
}

/**
 * Join built segments into one message. `terminators[i]` follows segment i (the last may be `""`).
 */
export function joinSegments(segments: readonly OracleSegment[], terminators: readonly string[]): OracleMessage {
  let input = "";
  let expected = "";
  let redactedFields = 0;
  segments.forEach((segment, index) => {
    const terminator = terminators[index] ?? "\r";
    input += segment.input + terminator;
    expected += segment.expected + terminator;
    redactedFields += segment.redactedFields;
  });
  return { input, expected, redactedFields };
}
