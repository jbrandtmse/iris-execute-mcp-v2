/**
 * Synthetic HL7 v2 (ER7) fixtures for the redaction engine (Story 39.2), shared by
 * `hl7-redaction.test.ts` and the live gate in `@iris-mcp/all` (which imports this file by relative path,
 * because it has no dependency on `@iris-mcp/shared`).
 *
 * Every identifying value contains `SYNTHPHI`; every value that must survive redaction contains
 * `KEEPME` or is a kept field's own code (`F`, `P`, `2.5.1`). Times fall on 2001-02-03. Non-ASCII
 * characters are authored as escapes.
 *
 * `checkRedactedPositions` states the position contract once, over parsed segments: the unit tests feed
 * it a naive parser's output ({@link parseEr7Naive}), and the live gate feeds it what IRIS's own
 * `EnsLib.HL7.Message` parser reads, which is the independent oracle (Rule #36).
 */

import { HL7_KEEP_FIELDS } from "../hl7-redaction.js";

/** Join segments with CR and end with a CR, the way IRIS stores an HL7 message. */
const er7 = (...segments: string[]): string => `${segments.join("\r")}\r`;

/** One fixture: an ER7 text and whether IRIS's parser can read it as a single, non-batch message. */
export interface Hl7Fixture {
  name: string;
  text: string;
  /** `true` for a non-batch message, which the live gate also parses with IRIS before and after redaction. */
  oracle: boolean;
}

/** A golden fixture: the redacted text and the number of fields the engine redacts, both exact. */
export interface Hl7GoldenFixture extends Hl7Fixture {
  expected: string;
  redactedFields: number;
}

const MSH_ADT = String.raw`MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203120000||ADT^A01^ADT_A01|SYNTHPHI-CTL|P|2.5.1`;

/** The two golden fixtures: the spec's ADT example, and an ACK. */
export const HL7_GOLDEN: readonly Hl7GoldenFixture[] = [
  {
    name: "golden ADT",
    oracle: true,
    text: er7(
      MSH_ADT,
      String.raw`PID|1||SYNTHPHI-MRN^^^SYNTHPHI-AA~SYNTHPHI-MRN2||SYNTHPHI-LAST^SYNTHPHI-FIRST\T\X||19010101|F`,
      "ZPI|SYNTHPHI-Z||x",
    ),
    expected: er7(
      String.raw`MSH|^~\&|***|***|||***||ADT^A01^ADT_A01|***|P|2.5.1`,
      "PID|1||***^^^***~***||***^***||***|F",
      "ZPI|***||***",
    ),
    redactedFields: 9,
  },
  {
    name: "golden ACK",
    oracle: true,
    text: er7(
      String.raw`MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203120001||ACK^A01^ACK|SYNTHPHI-CTL2|P|2.5.1`,
      "MSA|AA|SYNTHPHI-CTL",
    ),
    expected: er7(String.raw`MSH|^~\&|***|***|||***||ACK^A01^ACK|***|P|2.5.1`, "MSA|AA|***"),
    redactedFields: 5,
  },
];

const FULL_ADT = er7(
  String.raw`MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090001||ADT^A01^ADT_A01|SYNTHPHI-CTL1|P|2.5.1`,
  "EVN|A01|20010203090001|||SYNTHPHI-OPERATOR",
  String.raw`PID|1||SYNTHPHI-MRN^^^SYNTHPHI-AA~SYNTHPHI-MRN2^^^SYNTHPHI-AB||SYNTHPHI-LAST^SYNTHPHI-FIRST\T\X&SYNTHPHI-SUB~SYNTHPHI-ALIAS^SYNTHPHI-A||19010101|F|||SYNTHPHI-STREET\S\1^^SYNTHPHI-CITY^ZZ^00000~SYNTHPHI-STREET2^^SYNTHPHI-CITY2^ZZ^00001||SYNTHPHI-PHONE`,
  "NK1|1|SYNTHPHI-KIN^SYNTHPHI-KINF|SPO^Spouse|SYNTHPHI-NKADDR||SYNTHPHI-NKPHONE|C",
  "PV1|1|I|SYNTHPHI-WARD^101^A|R|||SYNTHPHI-DOC^SYNTHPHI-DOCF|||||||||||E|SYNTHPHI-VISIT",
  "GT1|1||SYNTHPHI-GUAR^SYNTHPHI-GUARF",
  "IN1|1||SYNTHPHI-PLAN|SYNTHPHI-INSCO",
  String.raw`OBX|1|TX|GLU^KEEPME-GLUCOSE^L||SYNTHPHI-free text \F\ with \T\ escapes|mg/dL|||||F`,
  "NTE|1|L|SYNTHPHI-comment",
  "ZPI|SYNTHPHI-Z||x",
);

const ACK = er7(
  String.raw`MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090002||ACK^A01^ACK|SYNTHPHI-CTL2|P|2.5.1`,
  "MSA|AA|SYNTHPHI-CTL1",
  "ERR||PID^1|101^Required field missing^HL70357|E",
);

const ESCAPES = er7(
  String.raw`MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090010||ORU^R01^ORU_R01|SYNTHPHI-CTL10|P|2.5.1`,
  String.raw`PID|1||SYNTHPHI-MRN10||SYNTHPHI\F\LAST\S\X^SYNTHPHI\T\FIRST\R\Y\E\Z||19010101|M`,
  String.raw`OBX|1|TX|ESC^KEEPME\F\\S\\T\\R\\E\\X0D\\H\\N\^L||SYNTHPHI\X0D\\H\bold\N\ text||||||F`,
  String.raw`NTE|1|L|SYNTHPHI\.br\comment`,
);

const UNREVIEWED = er7(
  String.raw`MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090011||ADT^A08^ADT_A01|SYNTHPHI-CTL11|P|2.5.1`,
  "PID|1||SYNTHPHI-MRN11||SYNTHPHI-LAST^SYNTHPHI-FIRST||19010101|M",
  "PD1|SYNTHPHI-PD1^x||SYNTHPHI-PCP",
  "MRG|SYNTHPHI-OLD^^^SYNTHPHI-AA||||SYNTHPHI-VISIT||SYNTHPHI-OLDNAME",
  "ZXX|SYNTHPHI-Z1|SYNTHPHI-Z2^SYNTHPHI-Z3&SYNTHPHI-Z4~SYNTHPHI-Z5",
);

const NO_PID = er7(
  String.raw`MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090012||ORU^R01^ORU_R01|SYNTHPHI-CTL12|P|2.5.1`,
  "OBX|1|NM|GLU^KEEPME-GLUCOSE^L||SYNTHPHI-5.5|mg/dL|||||F",
);

const MSH_ONLY = er7(
  String.raw`MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090013||ACK|SYNTHPHI-CTL13|P|2.5.1`,
);

const ALT_SEPARATORS = er7(
  "MSH#!@$%#SYNTHPHI-APP#SYNTHPHI-FAC###20010203090008##ADT!A01!ADT_A01#SYNTHPHI-CTL8#P#2.5.1",
  "PID#1##SYNTHPHI-MRN!!!SYNTHPHI-AA@SYNTHPHI-MRN2##SYNTHPHI-LAST!SYNTHPHI-FIRST%X##19010101#F",
  "OBX#1#TX#GLU!KEEPME-GLUCOSE!L##SYNTHPHI-free text^with~default$separators$#mg/dL#####F",
);

/** Non-ASCII characters, by code point: E acute, e acute, micro sign, and two CJK ideographs. */
const [E_ACUTE_UPPER, E_ACUTE, MICRO, CJK_ONE, CJK_TWO] = [0xc9, 0xe9, 0xb5, 0x4e2d, 0x6587].map((code) =>
  String.fromCodePoint(code),
) as [string, string, string, string, string];

const NON_ASCII = er7(
  String.raw`MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090014||ORU^R01^ORU_R01|SYNTHPHI-CTL14|P|2.5.1`,
  `PID|1||SYNTHPHI-MRN14||SYNTHPHI-${E_ACUTE_UPPER}MILIE^SYNTHPHI-${CJK_ONE}${CJK_TWO}||19010101|F`,
  `OBX|1|NM|GLU^KEEPME-GLUCOSE^L||SYNTHPHI-${E_ACUTE}|KEEPME-${MICRO}mol/L|||||F`,
);

const EMPTY_FIELDS = er7(
  String.raw`MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090015||ACK|SYNTHPHI-CTL15|P|2.5.1||`,
  "PID|1|||||||||||||||||||||",
  "PID|2||SYNTHPHI-MRN15||||||||||SYNTHPHI-PHONE||",
  "NTE|1|L|^^^",
);

const BATCH = er7(
  String.raw`FHS|^~\&|SYNTHPHI-FILEAPP|SYNTHPHI-FILEFAC|||20010203090016|SYNTHPHI-FILENAME|SYNTHPHI-FILECOMMENT|SYNTHPHI-FILECTL`,
  String.raw`BHS|^~\&|SYNTHPHI-BATCHAPP|SYNTHPHI-BATCHFAC`,
  String.raw`MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090016||ADT^A01^ADT_A01|SYNTHPHI-CTL16|P|2.5.1`,
  "PID|1||SYNTHPHI-MRN16||SYNTHPHI-LAST^SYNTHPHI-FIRST||19010101|F",
  "BTS|1|SYNTHPHI-BTSCOMMENT",
  "FTS|1|SYNTHPHI-FTSCOMMENT",
);

const BATCH_SWITCHING_SEPARATORS = er7(
  String.raw`BHS|^~\&|SYNTHPHI-BATCHAPP|SYNTHPHI-BATCHFAC`,
  String.raw`MSH|^~\&|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090017||ADT^A01^ADT_A01|SYNTHPHI-CTL17|P|2.5.1`,
  "PID|1||SYNTHPHI-MRN17^^^SYNTHPHI-AA~SYNTHPHI-MRN17B||SYNTHPHI-LAST^SYNTHPHI-FIRST||19010101|F",
  "MSH#!@$%#SYNTHPHI-APP#SYNTHPHI-FAC###20010203090017##ADT!A01!ADT_A01#SYNTHPHI-CTL17B#P#2.5.1",
  "PID#1##SYNTHPHI-MRN17C!!!SYNTHPHI-AA@SYNTHPHI-MRN17D##SYNTHPHI-LAST!SYNTHPHI-FIRST^SYNTHPHI-KEPT##19010101#F",
  "BTS#1",
);

const TRUNCATION_CHAR = er7(
  String.raw`MSH|^~\&#|SYNTHPHI-APP|SYNTHPHI-FAC|||20010203090018||ADT^A01^ADT_A01|SYNTHPHI-CTL18|P|2.7`,
  "PID|1||SYNTHPHI-MRN18||SYNTHPHI-LAST^SYNTHPHI-FIRST||19010101|F",
);

const LF_SEPARATED = FULL_ADT.replaceAll("\r", "\n");
const CRLF_SEPARATED = FULL_ADT.replaceAll("\r", "\r\n");
/** CR, CRLF and LF in one text. */
const MIXED_TERMINATORS = (() => {
  const segments = FULL_ADT.split("\r").filter((segment) => segment !== "");
  const terminators = ["\r", "\r\n", "\n"];
  return segments.map((segment, index) => `${segment}${terminators[index % 3]}`).join("");
})();

/** Every redaction fixture. `oracle` fixtures are parsed by IRIS before and after redaction in the live gate. */
export const HL7_FIXTURES: readonly Hl7Fixture[] = [
  ...HL7_GOLDEN,
  { name: "ADT A01 with repetitions, components, subcomponents, escapes and a Z-segment", text: FULL_ADT, oracle: true },
  { name: "ACK with an ERR segment and no PID", text: ACK, oracle: true },
  { name: "all HL7 escape sequences in kept and redacted fields", text: ESCAPES, oracle: true },
  { name: "PD1, MRG and a Z-segment (unreviewed segments)", text: UNREVIEWED, oracle: true },
  { name: "no PID", text: NO_PID, oracle: true },
  { name: "an MSH-only message", text: MSH_ONLY, oracle: true },
  { name: "non-default separators", text: ALT_SEPARATORS, oracle: true },
  { name: "non-ASCII values", text: NON_ASCII, oracle: true },
  { name: "empty and trailing empty fields", text: EMPTY_FIELDS, oracle: true },
  { name: "LF terminators", text: LF_SEPARATED, oracle: true },
  { name: "CRLF terminators", text: CRLF_SEPARATED, oracle: true },
  { name: "mixed CR, CRLF and LF terminators", text: MIXED_TERMINATORS, oracle: true },
  { name: "no trailing terminator", text: FULL_ADT.slice(0, -1), oracle: true },
  { name: "blank lines between segments", text: FULL_ADT.replaceAll("\r", "\r\r"), oracle: false },
  { name: "a leading blank line", text: `\r${FULL_ADT}`, oracle: false },
  { name: "a file and batch envelope", text: BATCH, oracle: false },
  { name: "a batch whose messages use different separators", text: BATCH_SWITCHING_SEPARATORS, oracle: false },
  { name: "a truncation character in the encoding characters", text: TRUNCATION_CHAR, oracle: false },
];

/** Texts the engine refuses, with what the refusal is about. */
export const HL7_REFUSAL_FIXTURES: ReadonlyArray<{ name: string; text: string }> = [
  { name: "empty text", text: "" },
  { name: "only terminators", text: "\r\r\n\n" },
  { name: "no MSH, FHS or BHS first", text: "PID|1||SYNTHPHI-MRN\r" },
  { name: "text before the MSH", text: `SYNTHPHI-PREFACE\r${MSH_ONLY}` },
  { name: "lower-case segment name", text: String.raw`msh|^~\&|SYNTHPHI-APP` },
  { name: "separators that repeat", text: String.raw`MSH|^^\&|SYNTHPHI-APP|SYNTHPHI-FAC` },
  { name: "an empty field 2", text: "MSH||SYNTHPHI-APP|SYNTHPHI-FAC" },
  { name: "an alphanumeric separator", text: String.raw`MSH|A~\&|SYNTHPHI-APP|SYNTHPHI-FAC` },
  { name: "a digit as the field separator", text: String.raw`MSH1^~\&1SYNTHPHI-APP1SYNTHPHI-FAC` },
  { name: "an asterisk separator", text: String.raw`MSH|*~\&|SYNTHPHI-APP|SYNTHPHI-FAC` },
  { name: "an asterisk as the field separator", text: String.raw`MSH*^~\&*SYNTHPHI-APP*SYNTHPHI-FAC` },
  { name: "encoding characters missing", text: "MSH|" },
  { name: "too few encoding characters", text: "MSH|^~\\|SYNTHPHI-APP" },
  { name: "a segment name of four characters", text: `${MSH_ONLY}PIDX|1||SYNTHPHI-MRN\r` },
  { name: "a segment name of two characters", text: `${MSH_ONLY}PI|1||SYNTHPHI-MRN\r` },
  { name: "a segment name with a lower-case letter", text: `${MSH_ONLY}Pid|1||SYNTHPHI-MRN\r` },
  { name: "an LF inside a segment", text: `${MSH_ONLY}PID|1||SYNTHPHI-MRN\nSYNTHPHI-SPLIT|x\r` },
  { name: "a whitespace-only line", text: `${MSH_ONLY} \r` },
  { name: "a segment name not followed by the field separator", text: `${MSH_ONLY}PID#1||SYNTHPHI-MRN\r` },
];

/** One segment as a parser reads it: `fields[k - 1]` is field `k`, and MSH-1 is the field separator. */
export interface ParsedSegment {
  name: string;
  fields: string[];
}

/**
 * A naive ER7 parser for the unit tests, written without the engine's code: split the lines, take the
 * field separator from the MSH, FHS or BHS, and split each segment at it. `fields[k - 1]` is HL7 field `k`.
 */
export function parseEr7Naive(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let fieldSeparator = "|";
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line === "") continue;
    const name = line.slice(0, 3);
    if (name === "MSH" || name === "FHS" || name === "BHS") {
      fieldSeparator = line.charAt(3);
      segments.push({ name, fields: [fieldSeparator, ...line.slice(4).split(fieldSeparator)] });
    } else {
      segments.push({ name, fields: line.slice(4).split(fieldSeparator) });
    }
  }
  return segments;
}

/**
 * The violations of the position contract between a message and its redaction, or `[]`: the segments
 * and their field counts match; a kept field (`HL7_KEEP_FIELDS`) is byte-identical; every other field
 * holds only `***` and separators, and holds `***` when the original held a value.
 *
 * @param before - The original segments.
 * @param after - The redacted segments, parsed the same way.
 * @param separators - Every separator character the text uses (the field separator and the encoding characters).
 */
export function checkRedactedPositions(
  before: readonly ParsedSegment[],
  after: readonly ParsedSegment[],
  separators: string,
): string[] {
  const violations: string[] = [];
  if (before.length !== after.length) {
    return [`segment count ${before.length} became ${after.length}`];
  }
  const stripSeparators = (value: string): string => [...value].filter((ch) => !separators.includes(ch)).join("");
  before.forEach((segment, index) => {
    const redacted = after[index] as ParsedSegment;
    if (segment.name !== redacted.name) {
      violations.push(`segment ${index + 1}: ${segment.name} became ${redacted.name}`);
      return;
    }
    if (segment.fields.length !== redacted.fields.length) {
      violations.push(`${segment.name} (segment ${index + 1}): ${segment.fields.length} fields became ${redacted.fields.length}`);
      return;
    }
    const keep = HL7_KEEP_FIELDS[segment.name] ?? [];
    segment.fields.forEach((original, fieldIndex) => {
      const field = fieldIndex + 1;
      const where = `${segment.name}-${field} (segment ${index + 1})`;
      const now = redacted.fields[fieldIndex] as string;
      if (keep.includes(field)) {
        if (now !== original) violations.push(`${where}: a kept field changed`);
        return;
      }
      if (!/^\**$/.test(stripSeparators(now))) violations.push(`${where}: a redacted field holds more than *** and separators`);
      if (stripSeparators(original) !== "" && !now.includes("***")) violations.push(`${where}: a value was not redacted`);
    });
  });
  return violations;
}

/** Every separator character `text` uses, read from each of its MSH, FHS and BHS segments. */
export function separatorCharacters(text: string): string {
  const characters = new Set<string>();
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!/^(MSH|FHS|BHS)/.test(line)) continue;
    const fieldSeparator = line.charAt(3);
    const encoding = line.slice(4).split(fieldSeparator, 1)[0] ?? "";
    for (const ch of `${fieldSeparator}${encoding}`) characters.add(ch);
  }
  return [...characters].join("");
}
