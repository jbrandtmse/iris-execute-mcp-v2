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

import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { parseDocument } from "yaml";

import type { ClientAdapter, ConfigFormat } from "./types.js";

/** One raw server entry as parsed from the client file (shape unvalidated). */
export type RawEntry = Record<string, unknown>;

export type ReadEntriesResult =
  | { ok: true; entries: Record<string, RawEntry> }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function parseJsonSurface(content: string): SurfaceParse {
  const errors: ParseError[] = [];
  let parsed: unknown;
  try {
    parsed = parseJsonc(content, errors, { allowTrailingComma: true, disallowComments: false });
  } catch (err) {
    return { kind: "syntax-error", error: `JSON parser threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (errors.length > 0) {
    return { kind: "syntax-error", error: formatJsoncErrors(errors, content) };
  }
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
    return { kind: "syntax-error", error: `TOML parse error: ${err instanceof Error ? err.message : String(err)}` };
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
    return { kind: "syntax-error", error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    const linePos = first?.linePos?.[0];
    const where = linePos ? ` at line ${linePos.line}` : "";
    return { kind: "syntax-error", error: `YAML parse error${where}: ${first?.message ?? "unknown"}` };
  }
  let parsed: unknown;
  try {
    parsed = doc.toJS();
  } catch (err) {
    return { kind: "syntax-error", error: `YAML materialization error: ${err instanceof Error ? err.message : String(err)}` };
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
    return { ok: true, entries: {} };
  }
  const surface = parseSurface(adapter, text);
  switch (surface.kind) {
    case "empty":
      return { ok: true, entries: {} };
    case "syntax-error":
    case "top-not-object":
      return { ok: false, error: surface.error };
    case "object": {
      const root = surface.top[adapter.rootKey];
      if (root === undefined) return { ok: true, entries: {} };
      if (!isPlainObject(root)) {
        return { ok: false, error: `root key "${adapter.rootKey}" is not ${objectNounWithArticle(adapter.format)}` };
      }
      const entries: Record<string, RawEntry> = {};
      for (const [name, value] of Object.entries(root)) {
        if (isPlainObject(value)) entries[name] = value;
      }
      return { ok: true, entries };
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
