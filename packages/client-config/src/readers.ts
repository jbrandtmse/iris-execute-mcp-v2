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
 */

import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { parseDocument } from "yaml";

import type { ClientAdapter } from "./types.js";

/** One raw server entry as parsed from the client file (shape unvalidated). */
export type RawEntry = Record<string, unknown>;

export type ReadEntriesResult =
  | { ok: true; entries: Record<string, RawEntry> }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatJsoncErrors(errors: ParseError[], content: string): string {
  const first = errors[0];
  if (!first) return "unknown parse error";
  const upToOffset = content.slice(0, first.offset);
  const line = upToOffset.split("\n").length;
  return `JSON parse error at line ${line} (offset ${first.offset}, code ${first.error})`;
}

function readJsonLike(content: string, rootKey: string): ReadEntriesResult {
  const errors: ParseError[] = [];
  let parsed: unknown;
  try {
    parsed = parseJsonc(content, errors, { allowTrailingComma: true, disallowComments: false });
  } catch (err) {
    return { ok: false, error: `JSON parser threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (errors.length > 0) {
    return { ok: false, error: formatJsoncErrors(errors, content) };
  }
  if (parsed === undefined || parsed === null) {
    // Empty file: valid, zero entries (a fresh client config may not exist yet).
    return { ok: true, entries: {} };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: "top-level JSON value is not an object" };
  }
  const root = parsed[rootKey];
  if (root === undefined) return { ok: true, entries: {} };
  if (!isPlainObject(root)) {
    return { ok: false, error: `root key "${rootKey}" is not an object` };
  }
  const entries: Record<string, RawEntry> = {};
  for (const [name, value] of Object.entries(root)) {
    if (isPlainObject(value)) entries[name] = value;
  }
  return { ok: true, entries };
}

function readToml(content: string, rootKey: string): ReadEntriesResult {
  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch (err) {
    return { ok: false, error: `TOML parse error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: "top-level TOML value is not a table" };
  }
  const root = parsed[rootKey];
  if (root === undefined) return { ok: true, entries: {} };
  if (!isPlainObject(root)) {
    return { ok: false, error: `root key "${rootKey}" is not a table` };
  }
  const entries: Record<string, RawEntry> = {};
  for (const [name, value] of Object.entries(root)) {
    if (isPlainObject(value)) entries[name] = value;
  }
  return { ok: true, entries };
}

function readYaml(content: string, rootKey: string): ReadEntriesResult {
  let doc;
  try {
    doc = parseDocument(content);
  } catch (err) {
    return { ok: false, error: `YAML parse error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    const linePos = first?.linePos?.[0];
    const where = linePos ? ` at line ${linePos.line}` : "";
    return { ok: false, error: `YAML parse error${where}: ${first?.message ?? "unknown"}` };
  }
  let parsed: unknown;
  try {
    parsed = doc.toJS();
  } catch (err) {
    return { ok: false, error: `YAML materialization error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (parsed === undefined || parsed === null) return { ok: true, entries: {} };
  if (!isPlainObject(parsed)) {
    return { ok: false, error: "top-level YAML value is not a mapping" };
  }
  const root = parsed[rootKey];
  if (root === undefined) return { ok: true, entries: {} };
  if (!isPlainObject(root)) {
    return { ok: false, error: `root key "${rootKey}" is not a mapping` };
  }
  const entries: Record<string, RawEntry> = {};
  for (const [name, value] of Object.entries(root)) {
    if (isPlainObject(value)) entries[name] = value;
  }
  return { ok: true, entries };
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
  switch (adapter.format) {
    case "json":
    case "jsonc":
      return readJsonLike(text, adapter.rootKey);
    case "toml":
      return readToml(text, adapter.rootKey);
    case "yaml":
      return readYaml(text, adapter.rootKey);
  }
}
