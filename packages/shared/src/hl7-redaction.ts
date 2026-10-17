/**
 * HL7 v2 (ER7) redaction for the PHI data policy (Story 39.2; architecture decision AD-26).
 *
 * {@link redactHl7} turns the complete ER7 text of one message into text that carries no identifying
 * value. It is fail-closed: a reviewed list of non-identifying fields, {@link HL7_KEEP_FIELDS}, names
 * the only fields it keeps. Every other field of a reviewed segment, and every field of any other
 * segment (PD1, MRG, a Z-segment, any other segment of HL7 v2.1 to v2.8.2), is redacted. A field nobody
 * reviewed is redacted, never kept: a list that is wrong by omission over-redacts, where a list of
 * identifying fields that is wrong by omission leaks.
 *
 * A segment name is copied to the output, so only a name the engine knows is accepted: a reviewed
 * segment, a segment of {@link HL7_STANDARD_SEGMENT_NAMES}, or a Z-segment. Any other line is refused,
 * never copied: that includes a line split off a free-text field by a raw line feed (IRIS stores a line
 * feed as a segment break), such as `LEE` or `DOE|...`. A line with no fields is accepted only for a
 * reviewed segment. What the names cannot tell apart: a split-off line that starts with the three
 * characters of a known segment name and then the field separator is read as that segment, so those
 * three characters are kept (and, for a reviewed segment, its kept positions).
 *
 * The engine reads only the text it is given. It must be given the COMPLETE, unsanitized text: a text
 * that was cut or flattened before it got here has already lost the structure the redaction follows.
 * It never throws, and the reasons it gives for a refusal are fixed texts that contain no input.
 *
 * **Not a compliance claim.** The keep-list and the Safe Harbor inventory reduce exposure of message
 * data. They are not a certification of de-identification.
 */

/** The review the keep-list and the Safe Harbor inventory record. */
export const HL7_REDACTION_REVIEW = {
  /** The date the lists were reviewed. */
  date: "2026-10-16",
  /** The HL7 version whose field numbering the lists follow. */
  hl7Version: "2.5.1",
  /** What the review was made from. */
  sources: [
    "45 CFR 164.514(b)(2)(i)(A)-(R) (Cornell LII, accessed 2026-10-16)",
    "IHE ITI De-Identification Handbook v2.0.0-comment, HL7 v2 example (profiles.ihe.net/ITI/DeId/hl7-example.html, generated 2026-06-12, accessed 2026-10-16): MSH-10; PID-3, 5, 7, 8, 11, 13, 14, 18 and 19; PV1-19; OBR-7 and 8; NTE. It is not exhaustive. PID-8 is kept, because Safe Harbor does not list sex.",
    "HL7 v2.5.1 field definitions, with the field names verified against EnsLib.HL7.Schema on IRIS 2026.2 (Build 221U)",
  ],
} as const;

/** The value every redacted leaf becomes. */
export const HL7_REDACTED_VALUE = "***";

/**
 * The fields that are kept, by segment name: HL7 v2.5.1 field numbers, where MSH, FHS and BHS number
 * their field separator as field 1. Every other field of these segments is redacted, and so is every
 * field of a segment that is not a key here.
 */
export const HL7_KEEP_FIELDS: Readonly<Record<string, readonly number[]>> = {
  // 1 Field Separator; 2 Encoding Characters; 9 Message Type; 11 Processing ID; 12 Version ID;
  // 15 Accept Acknowledgment Type; 16 Application Acknowledgment Type; 18 Character Set
  MSH: [1, 2, 9, 11, 12, 15, 16, 18],
  // 1 File Field Separator; 2 File Encoding Characters
  FHS: [1, 2],
  // 1 Batch Field Separator; 2 Batch Encoding Characters
  BHS: [1, 2],
  // 1 File Batch Count
  FTS: [1],
  // 1 Batch Message Count
  BTS: [1],
  // 1 Event Type Code; 4 Event Reason Code
  EVN: [1, 4],
  // 1 Acknowledgment Code
  MSA: [1],
  // 3 HL7 Error Code; 4 Severity
  ERR: [3, 4],
  // 1 Set ID - PID; 8 Administrative Sex
  PID: [1, 8],
  // 1 Set ID - NK1; 3 Relationship; 7 Contact Role
  NK1: [1, 3, 7],
  // 1 Set ID - PV1; 2 Patient Class; 4 Admission Type; 18 Patient Type
  PV1: [1, 2, 4, 18],
  // 1 Set ID - GT1
  GT1: [1],
  // 1 Set ID - IN1
  IN1: [1],
  // 1 Order Control; 5 Order Status
  ORC: [1, 5],
  // 1 Set ID - OBR; 4 Universal Service Identifier; 24 Diagnostic Serv Sect ID; 25 Result Status
  OBR: [1, 4, 24, 25],
  // 1 Set ID - OBX; 2 Value Type; 3 Observation Identifier; 4 Observation Sub-ID; 6 Units;
  // 8 Abnormal Flags; 11 Observation Result Status
  OBX: [1, 2, 3, 4, 6, 8, 11],
  // 1 Set ID - NTE; 2 Source of Comment
  NTE: [1, 2],
  // 1 Set ID - DG1; 2 Diagnosis Coding Method; 3 Diagnosis Code - DG1; 6 Diagnosis Type
  DG1: [1, 2, 3, 6],
  // 1 Set ID - AL1; 2 Allergen Type Code; 3 Allergen Code/Mnemonic/Description; 4 Allergy Severity Code
  AL1: [1, 2, 3, 4],
  // 1 Set ID - PR1; 2 Procedure Coding Method; 3 Procedure Code
  PR1: [1, 2, 3],
  // 1 Set ID - SPM; 4 Specimen Type
  SPM: [1, 4],
};

/**
 * Every segment name of the HL7 v2 standard, versions 2.1 to 2.8.2: the union of the
 * `<SegmentStructure name=...>` entries of the schema documents `2.1.HL7` to `2.8.2.HL7` that IRIS
 * 2026.2 (Build 221U) ships, 191 names. Together with the reviewed segments and the Z-segments, these
 * are the only segment names {@link redactHl7} accepts.
 */
export const HL7_STANDARD_SEGMENT_NAMES: ReadonlySet<string> = new Set([
  "ABS", "ACC", "ADD", "ADJ", "AFF", "AIG", "AIL", "AIP", "AIS", "AL1", "APR", "ARQ", "ARV", "AUT", "BHS", "BLC",
  "BLG", "BPO", "BPX", "BTS", "BTX", "BUI", "CDM", "CDO", "CER", "CM0", "CM1", "CM2", "CNS", "CON", "CSP", "CSR",
  "CSS", "CTD", "CTI", "DB1", "DG1", "DMI", "DON", "DPS", "DRG", "DSC", "DSP", "ECD", "ECR", "ED1", "EDU", "EQL",
  "EQP", "EQU", "ERQ", "ERR", "EVN", "FAC", "FHS", "FT1", "FTS", "GOL", "GP1", "GP2", "GT1", "IAM", "IAR", "IIM",
  "ILT", "IN1", "IN2", "IN3", "INV", "IPC", "IPR", "ISD", "ITM", "IVC", "IVT", "LAN", "LCC", "LCH", "LDP", "LOC",
  "LRL", "MCP", "MFA", "MFE", "MFI", "MRG", "MSA", "MSH", "NCK", "NDS", "NK1", "NPU", "NSC", "NST", "NTE", "OBR",
  "OBX", "ODS", "ODT", "OM1", "OM2", "OM3", "OM4", "OM5", "OM6", "OM7", "OMC", "ORC", "ORG", "ORO", "OVR", "PAC",
  "PCE", "PCR", "PD1", "PDA", "PDC", "PEO", "PES", "PID", "PKG", "PM1", "PMT", "PR1", "PRA", "PRB", "PRC", "PRD",
  "PRT", "PSG", "PSH", "PSL", "PSS", "PTH", "PV1", "PV2", "PYE", "QAK", "QID", "QPD", "QRD", "QRF", "QRI", "RCP",
  "RDF", "RDT", "REL", "RF1", "RFI", "RGS", "RMI", "ROL", "RQ1", "RQD", "RX1", "RXA", "RXC", "RXD", "RXE", "RXG",
  "RXO", "RXR", "RXV", "SAC", "SCD", "SCH", "SCP", "SDD", "SFT", "SGH", "SGT", "SHP", "SID", "SLT", "SPM", "SPR",
  "STF", "STZ", "TCC", "TCD", "TQ1", "TQ2", "TXA", "UAC", "UB1", "UB2", "URD", "URS", "VAR", "VND", "VTQ",
]);

/** One field of the Safe Harbor inventory, tagged with its 45 CFR 164.514(b)(2)(i) category. */
export interface Hl7SafeHarborField {
  segment: string;
  field: number;
  /** The identifier category, `A` to `R`. */
  category: string;
}

/**
 * The cross-check inventory: HL7 v2.5.1 fields that can carry an identifier of 45 CFR
 * 164.514(b)(2)(i), each with its category (A names; B geographic subdivisions; C dates; D telephone
 * numbers; E fax numbers; F e-mail addresses; G social security numbers; H medical record numbers;
 * I health plan beneficiary numbers; J account numbers; K certificate and license numbers; L vehicle
 * identifiers; M device identifiers; N URLs; O IP addresses; P biometric identifiers; Q photographs;
 * R any other unique identifying number or code). It is written independently of
 * {@link HL7_KEEP_FIELDS}, and a test requires the two to be disjoint, so a field cannot be both kept
 * and listed as identifying. It is a review signal, not the redaction rule: redaction keeps only what
 * the keep-list names.
 */
export const HL7_SAFE_HARBOR_FIELDS: readonly Hl7SafeHarborField[] = [
  { segment: "MSH", field: 7, category: "C" }, // Date/Time of Message
  { segment: "MSH", field: 10, category: "R" }, // Message Control ID
  { segment: "EVN", field: 2, category: "C" }, // Recorded Date/Time
  { segment: "EVN", field: 3, category: "C" }, // Date/Time Planned Event
  { segment: "EVN", field: 5, category: "R" }, // Operator ID
  { segment: "EVN", field: 6, category: "C" }, // Event Occurred
  { segment: "PID", field: 2, category: "H" }, // Patient ID
  { segment: "PID", field: 3, category: "H" }, // Patient Identifier List
  { segment: "PID", field: 4, category: "H" }, // Alternate Patient ID - PID
  { segment: "PID", field: 5, category: "A" }, // Patient Name
  { segment: "PID", field: 6, category: "A" }, // Mother's Maiden Name
  { segment: "PID", field: 7, category: "C" }, // Date/Time of Birth
  { segment: "PID", field: 9, category: "A" }, // Patient Alias
  { segment: "PID", field: 11, category: "B" }, // Patient Address
  { segment: "PID", field: 12, category: "B" }, // County Code
  { segment: "PID", field: 13, category: "D" }, // Phone Number - Home
  { segment: "PID", field: 14, category: "D" }, // Phone Number - Business
  { segment: "PID", field: 18, category: "J" }, // Patient Account Number
  { segment: "PID", field: 19, category: "G" }, // SSN Number - Patient
  { segment: "PID", field: 20, category: "K" }, // Driver's License Number - Patient
  { segment: "PID", field: 21, category: "R" }, // Mother's Identifier
  { segment: "PID", field: 23, category: "B" }, // Birth Place
  { segment: "PID", field: 29, category: "C" }, // Patient Death Date and Time
  { segment: "PID", field: 33, category: "C" }, // Last Update Date/Time
  { segment: "NK1", field: 2, category: "A" }, // Name
  { segment: "NK1", field: 4, category: "B" }, // Address
  { segment: "NK1", field: 5, category: "D" }, // Phone Number
  { segment: "NK1", field: 6, category: "D" }, // Business Phone Number
  { segment: "NK1", field: 16, category: "C" }, // Date/Time of Birth
  { segment: "NK1", field: 30, category: "A" }, // Contact Person's Name
  { segment: "NK1", field: 31, category: "D" }, // Contact Person's Telephone Number
  { segment: "NK1", field: 32, category: "B" }, // Contact Person's Address
  { segment: "NK1", field: 33, category: "R" }, // Next of Kin/Associated Party's Identifiers
  { segment: "NK1", field: 37, category: "G" }, // Contact Person Social Security Number
  { segment: "PV1", field: 5, category: "R" }, // Preadmit Number
  { segment: "PV1", field: 19, category: "J" }, // Visit Number
  { segment: "PV1", field: 44, category: "C" }, // Admit Date/Time
  { segment: "PV1", field: 45, category: "C" }, // Discharge Date/Time
  { segment: "PV1", field: 50, category: "J" }, // Alternate Visit ID
  { segment: "GT1", field: 2, category: "R" }, // Guarantor Number
  { segment: "GT1", field: 3, category: "A" }, // Guarantor Name
  { segment: "GT1", field: 5, category: "B" }, // Guarantor Address
  { segment: "GT1", field: 6, category: "D" }, // Guarantor Ph Num - Home
  { segment: "GT1", field: 7, category: "D" }, // Guarantor Ph Num - Business
  { segment: "GT1", field: 8, category: "C" }, // Guarantor Date/Time of Birth
  { segment: "GT1", field: 12, category: "G" }, // Guarantor SSN
  { segment: "IN1", field: 16, category: "A" }, // Name of Insured
  { segment: "IN1", field: 18, category: "C" }, // Insured's Date of Birth
  { segment: "IN1", field: 19, category: "B" }, // Insured's Address
  { segment: "IN1", field: 36, category: "I" }, // Policy Number
  { segment: "IN1", field: 49, category: "I" }, // Insured's ID Number
  { segment: "MRG", field: 1, category: "H" }, // Prior Patient Identifier List
  { segment: "MRG", field: 2, category: "H" }, // Prior Alternate Patient ID
  { segment: "MRG", field: 3, category: "J" }, // Prior Patient Account Number
  { segment: "MRG", field: 5, category: "J" }, // Prior Visit Number
  { segment: "MRG", field: 6, category: "J" }, // Prior Alternate Visit ID
  { segment: "MRG", field: 7, category: "A" }, // Prior Patient Name
  { segment: "ORC", field: 2, category: "R" }, // Placer Order Number
  { segment: "ORC", field: 3, category: "R" }, // Filler Order Number
  { segment: "ORC", field: 9, category: "C" }, // Date/Time of Transaction
  { segment: "OBR", field: 2, category: "R" }, // Placer Order Number
  { segment: "OBR", field: 3, category: "R" }, // Filler Order Number
  { segment: "OBR", field: 7, category: "C" }, // Observation Date/Time
  { segment: "OBR", field: 8, category: "C" }, // Observation End Date/Time
  { segment: "OBX", field: 5, category: "R" }, // Observation Value
  { segment: "OBX", field: 14, category: "C" }, // Date/Time of the Observation
  { segment: "OBX", field: 18, category: "M" }, // Equipment Instance Identifier
  { segment: "NTE", field: 3, category: "R" }, // Comment
  { segment: "DG1", field: 5, category: "C" }, // Diagnosis Date/Time
  { segment: "AL1", field: 6, category: "C" }, // Identification Date
  { segment: "PR1", field: 5, category: "C" }, // Procedure Date/Time
  { segment: "SPM", field: 2, category: "R" }, // Specimen ID
  { segment: "SPM", field: 17, category: "C" }, // Specimen Collection Date/Time
];

/** What {@link redactHl7} returns. A refusal's `reason` is a fixed text that holds no input. */
export type Hl7RedactionResult =
  | { ok: true; text: string; redactedFields: number }
  | { ok: false; reason: string };

/** The segments whose first field is the field separator and whose second is the encoding characters. */
const SEPARATOR_SEGMENTS = new Set(["MSH", "FHS", "BHS"]);

const SEGMENT_NAME = /^[A-Z][A-Z0-9]{2}$/;

const Z_SEGMENT_NAME = /^Z[A-Z0-9]{2}$/;

const REASONS = {
  noHeader: "The text does not start with an MSH, FHS or BHS segment.",
  badSeparators: "The field or encoding separators are not usable for redaction.",
  badSegment: "A segment name is not three capital letters or digits followed by the field separator.",
  unknownSegment: "A segment name is neither an HL7 v2 segment (versions 2.1 to 2.8.2) nor a Z-segment.",
  fieldlessSegment: "A segment with no fields is not one of the reviewed segments.",
  failed: "The text could not be processed.",
} as const;

/** Whether the engine may copy `name` to its output: a reviewed, a standard or a Z-segment name. */
function knownSegmentName(name: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(HL7_KEEP_FIELDS, name) ||
    HL7_STANDARD_SEGMENT_NAMES.has(name) ||
    Z_SEGMENT_NAME.test(name)
  );
}

/** The separators of one MSH, FHS or BHS segment that the redaction splits on. */
interface Separators {
  field: string;
  component: string;
  repetition: string;
  subcomponent: string;
}

/** Whether `ch` can be a separator: not alphanumeric and not the redaction character. */
function usableSeparator(ch: string): boolean {
  return ch !== "*" && !/[\p{L}\p{N}]/u.test(ch);
}

/**
 * Read the separators of the MSH, FHS or BHS segment `content`: the character after the name is the
 * field separator, and the encoding characters (field 2) are the component, repetition, escape and
 * subcomponent separators, in that order, optionally followed by a truncation character. Returns
 * `undefined` when they are missing, repeat, or are not usable.
 */
function readSeparators(content: string): Separators | undefined {
  const field = content.charAt(3);
  if (field === "") return undefined;
  const encoding = content.slice(4).split(field, 1)[0] ?? "";
  const chars = [...field, ...encoding];
  if (chars.length < 5 || chars.length > 6) return undefined;
  if (new Set(chars).size !== chars.length) return undefined;
  if (!chars.every(usableSeparator)) return undefined;
  return {
    field,
    component: chars[1] as string,
    repetition: chars[2] as string,
    subcomponent: chars[4] as string,
  };
}

/**
 * Replace every non-empty leaf of one field with {@link HL7_REDACTED_VALUE}, keeping the separators and
 * the empty leaves. `leaves` is how many leaves were replaced; a field of separators only has none.
 */
function redactField(value: string, seps: Separators): { text: string; leaves: number } {
  const delimiters = new Set([seps.repetition, seps.component, seps.subcomponent]);
  let text = "";
  let leaves = 0;
  let run = "";
  for (const ch of value) {
    if (delimiters.has(ch)) {
      if (run !== "") {
        text += HL7_REDACTED_VALUE;
        leaves += 1;
      }
      text += ch;
      run = "";
    } else {
      run += ch;
    }
  }
  if (run !== "") {
    text += HL7_REDACTED_VALUE;
    leaves += 1;
  }
  return { text, leaves };
}

/**
 * Redact the complete ER7 text of one message (or batch).
 *
 * The text is split at CR, CRLF and LF, and each terminator is kept as it was, so the output has the
 * same segments in the same order with the same terminators (and blank lines). The separators come from
 * every MSH, FHS and BHS segment, and apply from there to the next one. In each segment, every field
 * that {@link HL7_KEEP_FIELDS} does not keep, and every field of a segment it does not list, has each
 * non-empty leaf (repetition, component or subcomponent) replaced by {@link HL7_REDACTED_VALUE}; the
 * separators and the empty leaves stay. Running it on its own output changes nothing. `redactedFields`
 * counts the fields that had at least one non-empty leaf replaced.
 *
 * Refuses (`ok: false`) a text whose first segment is not an MSH, FHS or BHS; whose separators repeat,
 * are alphanumeric or contain `*`; that holds a segment whose name is not three capital letters or
 * digits followed by the field separator, or is neither a reviewed segment, a segment of
 * {@link HL7_STANDARD_SEGMENT_NAMES} nor a Z-segment; or that holds a line of a name alone (no fields)
 * whose segment is not a reviewed one.
 *
 * @param text - The complete, unsanitized ER7 text.
 */
export function redactHl7(text: string): Hl7RedactionResult {
  try {
    if (typeof text !== "string") return { ok: false, reason: REASONS.failed };
    const parts = text.split(/(\r\n|\r|\n)/);
    const lines: Array<{ content: string; terminator: string }> = [];
    for (let i = 0; i < parts.length; i += 2) {
      lines.push({ content: parts[i] ?? "", terminator: parts[i + 1] ?? "" });
    }
    const last = lines[lines.length - 1];
    if (lines.length > 1 && last !== undefined && last.content === "" && last.terminator === "") lines.pop();

    const first = lines.find((line) => line.content !== "");
    if (first === undefined || !SEPARATOR_SEGMENTS.has(first.content.slice(0, 3))) {
      return { ok: false, reason: REASONS.noHeader };
    }

    let seps: Separators | undefined;
    let redactedFields = 0;
    let out = "";
    for (const line of lines) {
      const content = line.content;
      if (content === "") {
        out += line.terminator;
        continue;
      }
      const name = content.slice(0, 3);
      if (!SEGMENT_NAME.test(name)) return { ok: false, reason: REASONS.badSegment };
      const isSeparatorSegment = SEPARATOR_SEGMENTS.has(name);
      if (isSeparatorSegment) {
        seps = readSeparators(content);
        if (seps === undefined) return { ok: false, reason: REASONS.badSeparators };
      }
      if (seps === undefined) return { ok: false, reason: REASONS.noHeader };
      if (content.length > 3 && content.charAt(3) !== seps.field) {
        return { ok: false, reason: REASONS.badSegment };
      }
      if (!knownSegmentName(name)) return { ok: false, reason: REASONS.unknownSegment };
      if (content.length === 3) {
        if (!Object.prototype.hasOwnProperty.call(HL7_KEEP_FIELDS, name)) {
          return { ok: false, reason: REASONS.fieldlessSegment };
        }
        out += content + line.terminator;
        continue;
      }
      const active = seps;
      const keep = HL7_KEEP_FIELDS[name] ?? [];
      const fields = content.slice(4).split(active.field);
      // The field number of fields[0]: 2 on a separator segment (field 1 is the separator itself).
      const firstNumber = isSeparatorSegment ? 2 : 1;
      const rewritten = fields.map((value, index) => {
        if (value === "" || keep.includes(index + firstNumber)) return value;
        const redacted = redactField(value, active);
        if (redacted.leaves > 0) redactedFields += 1;
        return redacted.text;
      });
      out += `${name}${active.field}${rewritten.join(active.field)}${line.terminator}`;
    }
    return { ok: true, text: out, redactedFields };
  } catch {
    return { ok: false, reason: REASONS.failed };
  }
}
