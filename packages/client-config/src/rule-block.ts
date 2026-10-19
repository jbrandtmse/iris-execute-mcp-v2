/**
 * `@iris-mcp/client-config` - the marked-block reader and writer for a rule inside a user's instructions file
 * (`AGENTS.md`, `GEMINI.md`; Story 41.6, DW-616).
 *
 * A block the suite owns sits between two marker lines, matched as exact whole lines:
 *
 *   <!-- IRIS-MCP-RULE:<stem>:BEGIN -->
 *   ...the rule...
 *   <!-- IRIS-MCP-RULE:<stem>:END -->
 *
 * Everything works on bytes and never decodes the host, so bytes outside the block (invalid UTF-8, a BOM, CRLF,
 * comments, other tools' blocks) stay as they are.
 *
 * - **Lines** split on LF. A line's text excludes its LF and one CR before it. A UTF-8 BOM at byte 0 is not part
 *   of line 1, so a BEGIN line right after it is a marker, and the BOM stays at byte 0.
 * - **One block** is exactly one BEGIN line and one END line, BEGIN first. Any other combination with at least one
 *   marker is ambiguous: it is reported with its line numbers and nothing is guessed.
 * - **Insert** appends the section. A last line without a line ending first gets one, in the file's own style
 *   (CRLF when the host holds `\r\n`, else LF); the ending is reported so a remover can take it out again.
 * - **Replace and remove** splice exactly the block's bytes, from BEGIN's first byte to the byte after END's line
 *   ending.
 *
 * Pure and portable: no file system, no process state.
 */

const BOM_UTF8 = [0xef, 0xbb, 0xbf] as const;
const LF = 0x0a;
const CR = 0x0d;

/** The line ending the installer added to an unterminated last line (empty when it added none). */
export type LineEndingAdded = "" | "\n" | "\r\n";

/** The two marker lines of a rule, each without its line ending. */
export interface RuleBlockMarkers {
  begin: string;
  end: string;
}

/** The marker lines of the rule named `stem`. A test pins them against the pack generator's `agentsMdMarkers`. */
export function ruleBlockMarkers(stem: string): RuleBlockMarkers {
  return {
    begin: `<!-- IRIS-MCP-RULE:${stem}:BEGIN -->`,
    end: `<!-- IRIS-MCP-RULE:${stem}:END -->`,
  };
}

/** Where a rule's block sits in a host. Offsets are byte offsets; line numbers are 1-based. */
export type RuleBlockLocation =
  | { status: "absent" }
  | { status: "one"; start: number; end: number; beginLine: number; endLine: number }
  | { status: "ambiguous"; begins: number[]; ends: number[] };

interface Line {
  /** Offset of the line's first byte. */
  start: number;
  /** Offset after the line's text (before its CR and LF). */
  textEnd: number;
  /** Offset after the line's LF, or the end of the host for an unterminated last line. */
  end: number;
}

function hasBom(host: Uint8Array): boolean {
  return host.length >= 3 && host[0] === BOM_UTF8[0] && host[1] === BOM_UTF8[1] && host[2] === BOM_UTF8[2];
}

/** True when the host starts with a UTF-16 byte-order mark, which the installer does not edit. */
export function hasUtf16Bom(host: Uint8Array): boolean {
  return host.length >= 2 && ((host[0] === 0xff && host[1] === 0xfe) || (host[0] === 0xfe && host[1] === 0xff));
}

function splitLines(host: Uint8Array): Line[] {
  const lines: Line[] = [];
  let start = hasBom(host) ? 3 : 0;
  while (start < host.length) {
    const lf = host.indexOf(LF, start);
    if (lf < 0) {
      lines.push({ start, textEnd: host.length, end: host.length });
      break;
    }
    const textEnd = lf > start && host[lf - 1] === CR ? lf - 1 : lf;
    lines.push({ start, textEnd, end: lf + 1 });
    start = lf + 1;
  }
  return lines;
}

function lineEquals(host: Uint8Array, line: Line, marker: Uint8Array): boolean {
  if (line.textEnd - line.start !== marker.length) return false;
  for (let i = 0; i < marker.length; i++) {
    if (host[line.start + i] !== marker[i]) return false;
  }
  return true;
}

/**
 * Find the block of the rule named `stem` in `host`.
 *
 * @param host - The host file's bytes.
 * @param stem - The rule's name.
 */
export function locateRuleBlock(host: Uint8Array, stem: string): RuleBlockLocation {
  const markers = ruleBlockMarkers(stem);
  const begin = Buffer.from(markers.begin, "utf8");
  const end = Buffer.from(markers.end, "utf8");
  const lines = splitLines(host);
  const begins: number[] = [];
  const ends: number[] = [];
  lines.forEach((line, index) => {
    if (lineEquals(host, line, begin)) begins.push(index);
    else if (lineEquals(host, line, end)) ends.push(index);
  });
  if (begins.length === 0 && ends.length === 0) return { status: "absent" };
  const first = begins[0];
  const last = ends[0];
  if (begins.length === 1 && ends.length === 1 && first !== undefined && last !== undefined && first < last) {
    return {
      status: "one",
      start: (lines[first] as Line).start,
      end: (lines[last] as Line).end,
      beginLine: first + 1,
      endLine: last + 1,
    };
  }
  return { status: "ambiguous", begins: begins.map((index) => index + 1), ends: ends.map((index) => index + 1) };
}

/** The text that names an ambiguous set of markers, with the fix. */
export function describeAmbiguousRuleBlock(stem: string, begins: readonly number[], ends: readonly number[]): string {
  const list = (numbers: readonly number[]): string => (numbers.length === 0 ? "none" : numbers.join(", "));
  return (
    `the ${stem} markers are not one BEGIN line followed by one END line: ` +
    `BEGIN at line(s) ${list(begins)}, END at line(s) ${list(ends)}; fix them by hand, then re-run`
  );
}

/** Why a host or a section cannot be edited. */
export type RuleBlockRefusalReason = "ambiguous" | "utf16" | "section";

export interface RuleBlockRefusal {
  ok: false;
  reason: RuleBlockRefusalReason;
  /** The sentence that says what is wrong and how to fix it. */
  location: string;
}

const UTF16_REFUSAL =
  "the file starts with a UTF-16 byte-order mark, which this installer does not edit; save it as UTF-8, then re-run";

/**
 * What is wrong with a section, or `null` when it is exactly its own BEGIN line, a body and its own END line,
 * each line ending in LF.
 *
 * @param section - The section bytes (the `agents-md` form of a rule).
 * @param stem - The rule's name.
 */
export function ruleSectionProblem(section: Uint8Array, stem: string): string | null {
  if (section.length === 0 || section[section.length - 1] !== LF) {
    return `the ${stem} section does not end with a line ending`;
  }
  if (hasBom(section)) return `the ${stem} section starts with a byte-order mark`;
  const location = locateRuleBlock(section, stem);
  if (location.status !== "one" || location.start !== 0 || location.end !== section.length) {
    return `the ${stem} section is not exactly its own BEGIN line, a body and its own END line`;
  }
  return null;
}

export type WithRuleBlockResult =
  | {
      ok: true;
      bytes: Buffer;
      change: "create" | "insert" | "replace" | "unchanged";
      lineEndingAdded: LineEndingAdded;
    }
  | RuleBlockRefusal;

function containsCrLf(host: Uint8Array): boolean {
  const at = host.indexOf(CR);
  if (at < 0) return false;
  for (let i = at; i < host.length - 1; i++) {
    if (host[i] === CR && host[i + 1] === LF) return true;
  }
  return false;
}

/**
 * Put `section` into `host`: create the host, append the block, replace the existing block, or leave it.
 *
 * - `host` of `null` creates a file holding the section.
 * - An empty host (or one holding only a BOM) becomes the section, with no line ending added.
 * - Otherwise a last line without a line ending gets one in the file's own style, then the section follows.
 * - An existing block is replaced whole; one that equals the section is `unchanged`.
 *
 * @param host - The host's bytes, or `null` when the file does not exist.
 * @param section - The rule's `agents-md` form.
 * @param stem - The rule's name.
 */
export function withRuleBlock(host: Uint8Array | null, section: Uint8Array, stem: string): WithRuleBlockResult {
  const problem = ruleSectionProblem(section, stem);
  if (problem !== null) return { ok: false, reason: "section", location: problem };
  if (host === null) return { ok: true, bytes: Buffer.from(section), change: "create", lineEndingAdded: "" };
  if (hasUtf16Bom(host)) return { ok: false, reason: "utf16", location: UTF16_REFUSAL };

  const location = locateRuleBlock(host, stem);
  if (location.status === "ambiguous") {
    return { ok: false, reason: "ambiguous", location: describeAmbiguousRuleBlock(stem, location.begins, location.ends) };
  }
  if (location.status === "one") {
    const current = host.subarray(location.start, location.end);
    if (Buffer.from(current).equals(Buffer.from(section))) {
      return { ok: true, bytes: Buffer.from(host), change: "unchanged", lineEndingAdded: "" };
    }
    return {
      ok: true,
      bytes: Buffer.concat([host.subarray(0, location.start), section, host.subarray(location.end)]),
      change: "replace",
      lineEndingAdded: "",
    };
  }

  const bodyStart = hasBom(host) ? 3 : 0;
  if (host.length === bodyStart) {
    return { ok: true, bytes: Buffer.concat([host, section]), change: "insert", lineEndingAdded: "" };
  }
  if (host[host.length - 1] === LF) {
    return { ok: true, bytes: Buffer.concat([host, section]), change: "insert", lineEndingAdded: "" };
  }
  const ending: LineEndingAdded = containsCrLf(host) ? "\r\n" : "\n";
  return {
    ok: true,
    bytes: Buffer.concat([host, Buffer.from(ending, "utf8"), section]),
    change: "insert",
    lineEndingAdded: ending,
  };
}

export type WithoutRuleBlockResult =
  | {
      ok: true;
      /** The new bytes, or `null` when the file the installer created holds nothing else and is to be deleted. */
      bytes: Buffer | null;
      change: "remove" | "absent";
    }
  | RuleBlockRefusal;

/**
 * Take the block of `stem` out of `host`.
 *
 * - Exactly the block's bytes are removed; a BOM before line 1 stays.
 * - When `lineEndingAdded` is recorded and the block was at the end of the file, that exact ending is removed
 *   again.
 * - When `created` is true (the installer created the file) and nothing is left, `bytes` is `null`: delete the file.
 * - A host with no block is `absent` and comes back unchanged.
 *
 * @param host - The host's bytes.
 * @param stem - The rule's name.
 * @param record - What the installer recorded when it inserted the block.
 */
export function withoutRuleBlock(
  host: Uint8Array,
  stem: string,
  record: { lineEndingAdded: LineEndingAdded; created: boolean },
): WithoutRuleBlockResult {
  if (hasUtf16Bom(host)) return { ok: false, reason: "utf16", location: UTF16_REFUSAL };
  const location = locateRuleBlock(host, stem);
  if (location.status === "ambiguous") {
    return { ok: false, reason: "ambiguous", location: describeAmbiguousRuleBlock(stem, location.begins, location.ends) };
  }
  if (location.status === "absent") return { ok: true, bytes: Buffer.from(host), change: "absent" };

  let before = Buffer.from(host.subarray(0, location.start));
  const after = Buffer.from(host.subarray(location.end));
  if (record.lineEndingAdded !== "" && after.length === 0) {
    const ending = Buffer.from(record.lineEndingAdded, "utf8");
    if (before.length >= ending.length && before.subarray(before.length - ending.length).equals(ending)) {
      before = before.subarray(0, before.length - ending.length);
    }
  }
  const result = Buffer.concat([before, after]);
  if (record.created && result.length === 0) return { ok: true, bytes: null, change: "remove" };
  return { ok: true, bytes: result, change: "remove" };
}
