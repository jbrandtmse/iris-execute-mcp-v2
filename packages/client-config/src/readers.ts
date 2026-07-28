/**
 * `@iris-mcp/client-config` — native-format config readers (Epic 33, Story 33.0).
 *
 * One typed boundary per format. EVERY reader returns
 *   { ok: true, entries } | { ok: false, error }
 * — a malformed file is NEVER an exception across this boundary (AC 33.0.4:
 * per-client `unparseable`, never a crash). Error text names the parse
 * reason and offset/line, never file content lines (spec §3.5.5 — foreign
 * entries may hold third-party secrets).
 *
 * `entries` is the rootKey's name → raw-entry map. Entry VALUES are opaque
 * `RawEntry` records here; classification (iris-mcp-owned vs foreign) and
 * enable/disable interpretation live in status.ts.
 *
 * Story 33.4 added {@link diagnoseConfigSurface}: the finer-grained surface
 * diagnosis the doctor's config-drift check consumes (AC 33.4.2). Both
 * public functions sit on ONE shared parse path (`parseSurface`), so the
 * reader and the diagnoser can never disagree about what "parses".
 */

import { createScanner, parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { parseDocument, type YAMLError } from "yaml";

import type { ClientAdapter, ConfigFormat } from "./types.js";

/** One raw server entry as parsed from the client file (shape unvalidated). */
export type RawEntry = Record<string, unknown>;

export type ReadEntriesResult =
  | {
      ok: true;
      entries: Record<string, RawEntry>;
      /**
       * Root-key children that are NOT single server entries but must never
       * be invisible (Story 33.5, 33-5-12): a TOML array-of-tables
       * (`[[rootKey.name]]`) parses as an ARRAY of tables, which the
       * table-model readers skip — silently hiding an entry. The name is
       * surfaced here (name → form label); status lists it among foreign
       * names and every write against it is a documented REFUSAL.
       */
      unsupported: Record<string, string>;
    }
  | { ok: false; error: string };

/**
 * A REAL plain object — prototype-checked (Story 33.5, AC 33.5.4): class
 * instances are NOT entries/tables. A TOML datetime literal parses to a
 * smol-toml `TomlDate` (a class instance): the old typeof/!Array check let
 * one sit where the root table belongs, defeating both the drift guard (a
 * wrong-shaped root key classified root-ok) and entry classification. `null`
 * prototype objects (Object.create(null)) stay accepted.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** The format's name for its object form ("object" / "table" / "mapping"). */
function objectNoun(format: ConfigFormat): string {
  switch (format) {
    case "json":
    case "jsonc":
      return "object";
    case "toml":
      return "table";
    case "yaml":
      return "mapping";
  }
}

/** The same noun with its article ("an object" / "a table" / "a mapping"). */
function objectNounWithArticle(format: ConfigFormat): string {
  const noun = objectNoun(format);
  return `${noun === "object" ? "an" : "a"} ${noun}`;
}

/**
 * Describe a value's TYPE only — never its content (a wrong-shaped root key
 * could itself hold text; the drift finding reports shape, not bytes).
 */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array (${value.length} item(s))`;
  return `a ${typeof value}`;
}

// ════════════════════════════════════════════════════════════════════
// The shared top-level parse path (Story 33.4 — single-sourced so the
// reader and the drift diagnoser classify the same file identically).
// ════════════════════════════════════════════════════════════════════

type SurfaceParse =
  /** Whitespace/BOM-only input, or a null top level — a valid not-yet-configured file. */
  | { kind: "empty" }
  /** The format parser rejected the text (error names reason + offset/line, never content). */
  | { kind: "syntax-error"; error: string }
  /** Parses, but the top level is not the format's object form (error preserved for the reader). */
  | { kind: "top-not-object"; error: string; found: string }
  /** Parses; the top level is the format's object form. */
  | { kind: "object"; top: Record<string, unknown> };

function formatJsoncErrors(errors: ParseError[], content: string): string {
  const first = errors[0];
  if (!first) return "unknown parse error";
  const upToOffset = content.slice(0, first.offset);
  const line = upToOffset.split("\n").length;
  return `JSON parse error at line ${line} (offset ${first.offset}, code ${first.error})`;
}

// ════════════════════════════════════════════════════════════════════
// Parse-error sanitization (Story 33.5, AC 33.5.1 — the lead-probed HIGH).
// The TOML and YAML libraries' error messages ECHO source lines around the
// failure (smol-toml's codeblock prints the offending line AND the line
// above it; yaml appends the offending line + caret) — a secret sitting on
// or next to the offending line leaked verbatim through readConfigEntries /
// diagnoseConfigSurface into status, doctor, and the --json envelopes. The
// JSONC `formatJsoncErrors` discipline applies to every parser: reason +
// line:col/code ONLY, never file content.
// ════════════════════════════════════════════════════════════════════

/**
 * Content-free TOML error text. smol-toml's TomlError carries numeric
 * `line`/`column` properties and a first line of the form
 * "Invalid TOML document: <generic reason>" (probe 2026-07-28, smol-toml
 * 1.7.1: every first-line reason is generic — the content lives in the
 * `codeblock`/later lines, which are DROPPED here). Falls back to the first
 * line alone when the position properties are absent.
 */
function sanitizeTomlError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const firstLine = (message.split("\n", 1)[0] ?? "unknown").replace(/^Invalid TOML document:\s*/, "");
  const shape = err as { line?: unknown; column?: unknown };
  const line = typeof shape.line === "number" ? shape.line : undefined;
  const column = typeof shape.column === "number" ? shape.column : undefined;
  const where = line !== undefined ? ` at line ${line}${column !== undefined ? ` (column ${column})` : ""}` : "";
  return `TOML parse error${where}: ${firstLine === "" ? "unknown" : firstLine}`;
}

/**
 * Content-free YAML error text. A YAMLParseError message is
 * "<reason> at line L, column C:\n\n<offending line>\n\n^" — everything from
 * the first newline on is source content and is dropped. The REASON itself
 * can quote one offending token (`Unexpected scalar token in YAML stream:
 * "b"` — probe 2026-07-28): a trailing `: "…"` segment is stripped too, so
 * no file bytes survive. Line:col comes from the structured `linePos`.
 */
function sanitizeYamlError(err: YAMLError | undefined): string {
  const rawLine = (err?.message ?? "unknown").split("\n", 1)[0] ?? "unknown";
  const reason = rawLine.replace(/ at line \d+, column \d+:?$/, "").replace(/: "(?:[^"\\]|\\.)*"$/, "");
  const linePos = err?.linePos?.[0];
  const where = linePos ? ` at line ${linePos.line} (column ${linePos.col})` : "";
  return `YAML parse error${where}: ${reason === "" ? "unknown" : reason}`;
}

/** Defensive content-free text for a THROWN parser error (rare — both
 * parsers report in-band). First line only, trailing quoted token stripped,
 * then a trailing UNQUOTED bare token too (33.5 review: yaml's toJS throw for
 * an unresolved alias is `Unresolved alias (...): SECRETALIAS` — the anchor
 * name is file content and the quoted-token strip never matched it). */
function sanitizeThrownError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const firstLine = message.split("\n", 1)[0] ?? "unknown";
  return firstLine.replace(/: "(?:[^"\\]|\\.)*"$/, "").replace(/: [^\s"']+$/, "");
}

/** True when the document holds no real JSON token (comments/whitespace only
 * — a comment-only JSONC file is a VALID empty document, VS Code accepts it;
 * Story 33.5, AC 33.5.4). skipTrivia skips whitespace AND comments. Exported
 * for diff.ts's insertion path: a comment-only document has NO parse tree, so
 * the add path must treat it like an empty file (whole-document write that
 * preserves the trivia) rather than an unsupported shape. */
export function hasJsonTokens(content: string): boolean {
  const scanner = createScanner(content, true);
  // 17 = jsonc-parser's SyntaxKind.EOF (a const enum — unnameable under
  // isolatedModules; the value is probe-verified, jsonc-parser 3.3.1).
  return scanner.scan() !== 17;
}

/**
 * jsonc-parser builds objects via ASSIGNMENT, so a `"__proto__"` key in the
 * source mutates the object's prototype at parse time — the entry silently
 * vanishes AND the corrupted prototype then trips the strict
 * prototype-checking isPlainObject (Story 33.5, 33-5-11: a foreign server
 * literally named "__proto__" was dropped from the matrix). Rehabilitate:
 * hoist the prototype-injected value back to an OWN "__proto__" property,
 * restore the real prototype, recursively. YAML/TOML build own properties
 * and never need this.
 */
function rehabilitateProto(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) rehabilitateProto(item);
    return;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    rehabilitateProto(proto);
    Object.setPrototypeOf(value, Object.prototype);
    Object.defineProperty(value, "__proto__", { value: proto, enumerable: true, writable: true, configurable: true });
  }
  for (const key of Object.keys(value)) {
    rehabilitateProto((value as Record<string, unknown>)[key]);
  }
}

/**
 * Own-property lookup on an `entries`/`unsupported` map (Story 33.5 review —
 * the READ side of the 33-5-11 discipline: the maps are BUILT with
 * defineProperty, but a bare `map[name]` READ still walks the prototype
 * chain, so an absent entry named `__proto__`/`constructor` resolves to an
 * Object.prototype member — misread as PRESENT (or as a garbage
 * `[object Object]` unsupported-form refusal).
 */
export function ownEntry<V>(map: Record<string, V>, name: string): V | undefined {
  return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined;
}

function parseJsonSurface(content: string): SurfaceParse {
  const errors: ParseError[] = [];
  let parsed: unknown;
  try {
    parsed = parseJsonc(content, errors, { allowTrailingComma: true, disallowComments: false });
  } catch (err) {
    return { kind: "syntax-error", error: `JSON parser threw: ${sanitizeThrownError(err)}` };
  }
  if (errors.length > 0) {
    // jsonc-parser reports a "value expected" error for a comment-only file
    // (parsed === undefined) — but with no real token the document is
    // legitimately EMPTY, not malformed (AC 33.5.4).
    if (parsed === undefined && !hasJsonTokens(content)) {
      return { kind: "empty" };
    }
    return { kind: "syntax-error", error: formatJsoncErrors(errors, content) };
  }
  rehabilitateProto(parsed);
  if (parsed === undefined || parsed === null) {
    // Empty file: valid, zero entries (a fresh client config may not exist yet).
    return { kind: "empty" };
  }
  if (!isPlainObject(parsed)) {
    return {
      kind: "top-not-object",
      error: "top-level JSON value is not an object",
      found: describeValue(parsed),
    };
  }
  return { kind: "object", top: parsed };
}

function parseTomlSurface(content: string): SurfaceParse {
  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch (err) {
    return { kind: "syntax-error", error: sanitizeTomlError(err) };
  }
  if (!isPlainObject(parsed)) {
    return {
      kind: "top-not-object",
      error: "top-level TOML value is not a table",
      found: describeValue(parsed),
    };
  }
  return { kind: "object", top: parsed };
}

function parseYamlSurface(content: string): SurfaceParse {
  let doc;
  try {
    doc = parseDocument(content);
  } catch (err) {
    return { kind: "syntax-error", error: `YAML parse error: ${sanitizeThrownError(err)}` };
  }
  if (doc.errors.length > 0) {
    return { kind: "syntax-error", error: sanitizeYamlError(doc.errors[0]) };
  }
  let parsed: unknown;
  try {
    parsed = doc.toJS();
  } catch (err) {
    return { kind: "syntax-error", error: `YAML materialization error: ${sanitizeThrownError(err)}` };
  }
  if (parsed === undefined || parsed === null) return { kind: "empty" };
  if (!isPlainObject(parsed)) {
    return {
      kind: "top-not-object",
      error: "top-level YAML value is not a mapping",
      found: describeValue(parsed),
    };
  }
  return { kind: "object", top: parsed };
}

function parseSurface(adapter: ClientAdapter, text: string): SurfaceParse {
  switch (adapter.format) {
    case "json":
    case "jsonc":
      return parseJsonSurface(text);
    case "toml":
      return parseTomlSurface(text);
    case "yaml":
      return parseYamlSurface(text);
  }
}

/**
 * Parse `content` in the adapter's native format and return its root-key
 * entries. Never throws (AC 33.0.4).
 */
export function readConfigEntries(adapter: ClientAdapter, content: string): ReadEntriesResult {
  // A UTF-8 BOM makes an otherwise valid file look malformed to every one of
  // these parsers (the Story 31.0 review finding) — strip it up front.
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  // An empty/whitespace file is a VALID not-yet-configured client (zero
  // entries), not a parse failure — several parsers report it as an error.
  if (text.trim() === "") {
    return { ok: true, entries: {}, unsupported: {} };
  }
  const surface = parseSurface(adapter, text);
  switch (surface.kind) {
    case "empty":
      return { ok: true, entries: {}, unsupported: {} };
    case "syntax-error":
    case "top-not-object":
      return { ok: false, error: surface.error };
    case "object": {
      const root = surface.top[adapter.rootKey];
      if (root === undefined) return { ok: true, entries: {}, unsupported: {} };
      if (!isPlainObject(root)) {
        return { ok: false, error: `root key "${adapter.rootKey}" is not ${objectNounWithArticle(adapter.format)}` };
      }
      const entries: Record<string, RawEntry> = {};
      const unsupported: Record<string, string> = {};
      for (const [name, value] of Object.entries(root)) {
        if (isPlainObject(value)) {
          // defineProperty, never plain assignment (Story 33.5, AC 33.5.7):
          // `entries["__proto__"] = value` on a {} literal mutates the
          // PROTOTYPE instead of creating an own property — a foreign server
          // literally named "__proto__" was silently DROPPED from the matrix.
          Object.defineProperty(entries, name, { value, enumerable: true, writable: true, configurable: true });
        } else if (Array.isArray(value) && value.length > 0 && value.every(isPlainObject)) {
          // TOML array-of-tables ([[rootKey.name]]): not a single server
          // entry — surfaced by NAME so it is never invisible (33-5-12).
          Object.defineProperty(unsupported, name, { value: "array-of-tables", enumerable: true, writable: true, configurable: true });
        }
      }
      return { ok: true, entries, unsupported };
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// Story 33.4 — config-surface drift diagnosis (AC 33.4.2).
// ════════════════════════════════════════════════════════════════════

/**
 * The finer classification the doctor's config-drift check consumes. The
 * status matrix collapses "syntax error" and "parses but wrong shape" into
 * one `unparseable` bucket; this diagnosis keeps them DISTINCT (a syntax
 * error means repair/restore the file; a wrong shape means the CLIENT's
 * config surface moved away from the adapter data).
 */
export type ConfigSurfaceDiagnosis =
  /** Empty/whitespace-only (or null top level) — a valid not-yet-configured file. */
  | { status: "empty" }
  /** The format parser rejected the text. */
  | { status: "syntax-error"; error: string }
  /** Parses, but the top level isn't the format's object form — every adapter expectation fails. */
  | { status: "top-not-object"; expected: string; found: string }
  /** Parses; the adapter's root key is absent (a normal no-MCP-section config — NOT drift). */
  | { status: "root-absent" }
  /** Parses; the adapter's root key is present with the expected shape. */
  | { status: "root-ok" }
  /** Parses; the adapter's root key is present but holds the wrong shape — drift. */
  | { status: "root-wrong-shape"; expected: string; found: string };

/**
 * Diagnose `content` against the adapter's root-key expectation. Never
 * throws. `expected`/`found` describe shapes only (type names, never file
 * content — the same secrecy discipline as the parse errors).
 */
export function diagnoseConfigSurface(adapter: ClientAdapter, content: string): ConfigSurfaceDiagnosis {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  if (text.trim() === "") return { status: "empty" };
  const surface = parseSurface(adapter, text);
  switch (surface.kind) {
    case "empty":
      return { status: "empty" };
    case "syntax-error":
      return { status: "syntax-error", error: surface.error };
    case "top-not-object":
      return {
        status: "top-not-object",
        expected: `a top-level ${objectNoun(adapter.format)} holding root key "${adapter.rootKey}"`,
        found: surface.found,
      };
    case "object": {
      const root = surface.top[adapter.rootKey];
      if (root === undefined) return { status: "root-absent" };
      if (!isPlainObject(root)) {
        return {
          status: "root-wrong-shape",
          expected: `root key "${adapter.rootKey}" holding ${objectNounWithArticle(adapter.format)} of server entries`,
          found: describeValue(root),
        };
      }
      return { status: "root-ok" };
    }
  }
}
