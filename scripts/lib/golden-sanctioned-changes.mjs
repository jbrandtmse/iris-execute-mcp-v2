// Sanctioned-change ledger over the frozen SDK goldens (Story 43.4; AD-15, AD-32; Rule #36; DW-639).
//
// CONTRACT
//   `sdk-wire-golden.json` and `sdk-handler-golden.json` are frozen captures of the SDK v1 build. They are never
//   edited and never recaptured. A change that AD-15 sanctions to bytes they hold is one entry of
//   `fixtures/sdk-golden-sanctioned-changes.json`: the golden, the row, a JSON pointer inside the row's parsed
//   `line`, the exact frozen value (`old`), the exact new value (`new`), and the sanction id that the CHANGELOG
//   entry of the story names.
//
//   `applySanctionedChanges` returns a deep clone of a golden in which each row that an entry names carries the
//   frozen line with the entry's value replaced or removed at its pointer, re-serialized with `JSON.stringify`.
//   Every other row, and every other field of a named row, is the frozen one. The loader refuses, naming the
//   entry `id`, an entry whose row or pointer does not exist, whose `old` is not the frozen value, or whose frozen
//   line is not canonical JSON (re-serializing it would change bytes no entry names). It never skips an entry.
//
//   An entry that replaces a description only appends (`appendOnly`) when it says so: `new` starts with `old` and is
//   longer. An entry without `appendOnly` may replace the text (a correction); which sanction may do so is the
//   ledger test's decision, not the loader's.
//
//   A "handler" entry with `section: "audit"` addresses the server's `audit` array instead of a row: its pointer
//   starts with the index of an audit element and then names a member of it. Only a call entry (an element that has
//   `seq`) can change; the `sessionStart` element and every row `line` stay frozen. It is checked like any other entry:
//   the pointer must resolve, and `old` must be the frozen value.
//
// LEDGER SCHEMA (`validateSanctionedChanges` enforces it; unknown keys are refused)
//   { "description": string, "changes": [ change ... ] }
//   change: id (unique, non-empty), sanction (^S-\d+\.\d+-[a-z-]+$), story (^\d+\.\d+$), golden ("wire" | "handler"),
//           server (one of the golden's servers), session (required for "wire", absent for "handler"), label (the
//           row; absent when `section` is "audit"), section (optional, "audit", "handler" only), pointer (RFC 6901,
//           starting with "/", inside the parsed line, or `/<audit index>/<member>...` for the audit section),
//           op ("replace" | "remove"), old (required), new (required for "replace", absent for "remove"),
//           appendOnly (optional boolean).
//   Changes to one row, or to one audit element, apply in file order.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GOLDEN_PACKAGES, GOLDEN_RELATIVE_PATH } from './sdk-wire-golden-core.mjs';
import { HANDLER_GOLDEN_RELATIVE_PATH } from './sdk-handler-golden-core.mjs';

/** Repository-relative path of the committed ledger. */
export const SANCTIONED_CHANGES_RELATIVE_PATH = 'packages/iris-mcp-all/src/__tests__/fixtures/sdk-golden-sanctioned-changes.json';

/** The repository-relative path of each golden kind. */
const GOLDEN_PATHS = Object.freeze({ wire: GOLDEN_RELATIVE_PATH, handler: HANDLER_GOLDEN_RELATIVE_PATH });

const CHANGE_KEYS = ['id', 'sanction', 'story', 'golden', 'server', 'session', 'label', 'section', 'pointer', 'op', 'old', 'new', 'appendOnly'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isText = (value) => typeof value === 'string' && value !== '';

/** Deep equality of two parsed-JSON values; object key order does not matter, array order does. */
function sameJson(left, right) {
  if (left === right) return true;
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length && left.every((item, index) => sameJson(item, right[index]));
  }
  if (isObject(left)) {
    if (!isObject(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => hasOwn(right, key) && sameJson(left[key], right[key]));
  }
  return false;
}

/** The tokens of RFC 6901 pointer `pointer`, or `undefined` when it is not a valid pointer. */
function pointerTokens(pointer) {
  if (typeof pointer !== 'string') return undefined;
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) return undefined;
  const raw = pointer.slice(1).split('/');
  if (raw.some((token) => /~(?![01])/.test(token))) return undefined;
  return raw.map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** The array index that `token` names, or `undefined` when it is not a canonical index. */
const indexOf = (token) => (/^(0|[1-9][0-9]*)$/.test(token) ? Number(token) : undefined);

/** The value that the pointer `tokens` name inside `message`, or `undefined` when they name nothing. */
function walk(message, tokens) {
  let node = message;
  for (const token of tokens) {
    if (Array.isArray(node)) {
      const index = indexOf(token);
      if (index === undefined || index >= node.length) return undefined;
      node = node[index];
    } else if (isObject(node)) {
      if (!hasOwn(node, token)) return undefined;
      node = node[token];
    } else {
      return undefined;
    }
  }
  return node;
}

/**
 * The value at RFC 6901 pointer `pointer` inside `message`, or `undefined` when the pointer is invalid or names
 * nothing (a parsed JSON value is never `undefined`, so the two cannot be confused).
 */
export function valueAt(message, pointer) {
  const tokens = pointerTokens(pointer);
  return tokens === undefined ? undefined : walk(message, tokens);
}

/** What entry `id` is called in a refusal. */
const named = (id) => `Sanctioned change '${id}'`;

/** Validate one change of the ledger, throwing a refusal that names it. */
function validateChange(change, index) {
  if (!isObject(change)) throw new Error(`Sanctioned change #${index} must be a JSON object.`);
  const id = isText(change.id) ? change.id : `#${index}`;
  const refuse = (problem) => {
    throw new Error(`${named(id)}: ${problem}`);
  };
  if (!isText(change.id)) refuse('id must be a non-empty string.');
  for (const key of Object.keys(change)) {
    if (!CHANGE_KEYS.includes(key)) refuse(`unknown key '${key}'.`);
  }
  if (typeof change.sanction !== 'string' || !/^S-\d+\.\d+-[a-z-]+$/.test(change.sanction)) refuse('sanction must match ^S-\\d+\\.\\d+-[a-z-]+$.');
  if (typeof change.story !== 'string' || !/^\d+\.\d+$/.test(change.story)) refuse('story must match ^\\d+\\.\\d+$.');
  if (change.golden !== 'wire' && change.golden !== 'handler') refuse("golden must be 'wire' or 'handler'.");
  if (!GOLDEN_PACKAGES.includes(change.server)) refuse(`server must be one of ${GOLDEN_PACKAGES.join(', ')}.`);
  if (change.golden === 'wire' && !isText(change.session)) refuse("a 'wire' change needs a non-empty session.");
  if (change.golden === 'handler' && hasOwn(change, 'session')) refuse("a 'handler' change has no session.");
  const audit = hasOwn(change, 'section');
  if (audit) {
    if (change.section !== 'audit') refuse("section must be 'audit' when present.");
    if (change.golden !== 'handler') refuse("an 'audit' change must be a 'handler' change.");
    if (hasOwn(change, 'label')) refuse("an 'audit' change addresses an element of the audit array and has no label.");
  } else if (!isText(change.label)) {
    refuse('label must be a non-empty string.');
  }
  if (typeof change.pointer !== 'string' || !change.pointer.startsWith('/') || pointerTokens(change.pointer) === undefined) {
    refuse('pointer must be an RFC 6901 pointer starting with "/".');
  }
  if (audit) {
    const tokens = pointerTokens(change.pointer);
    if (tokens.length < 2 || indexOf(tokens[0]) === undefined) refuse("an 'audit' pointer must be /<audit index>/<member>.");
  }
  if (change.op !== 'replace' && change.op !== 'remove') refuse("op must be 'replace' or 'remove'.");
  if (!hasOwn(change, 'old')) refuse('old is required.');
  if (change.op === 'remove' && hasOwn(change, 'new')) refuse("a 'remove' change has no new.");
  if (change.op === 'replace') {
    if (!hasOwn(change, 'new')) refuse("a 'replace' change needs new.");
    if (sameJson(change.old, change.new)) refuse('new equals old, so the change is a no-op.');
  }
  if (hasOwn(change, 'appendOnly')) {
    if (typeof change.appendOnly !== 'boolean') refuse('appendOnly must be a boolean.');
    if (change.appendOnly) {
      if (change.op !== 'replace') refuse("an appendOnly change must be a 'replace'.");
      if (typeof change.old !== 'string' || typeof change.new !== 'string') refuse('an appendOnly change needs string old and new values.');
      if (!change.new.startsWith(change.old) || change.new.length <= change.old.length) refuse('an appendOnly change must start with old and be longer.');
    }
  }
  return id;
}

/**
 * Validate a parsed ledger document and return its `changes`. Throws an `Error` that names the offending entry's
 * `id` on any schema problem, a duplicate `id`, a no-op `replace`, or an `appendOnly` entry that is not an append.
 *
 * @param {unknown} document - The parsed ledger.
 * @returns {Array<Record<string, any>>} The validated changes, in file order.
 */
export function validateSanctionedChanges(document) {
  if (!isObject(document)) throw new Error('The sanctioned-change ledger must be a JSON object.');
  const keys = Object.keys(document).sort().join(',');
  if (keys !== 'changes,description') throw new Error(`The sanctioned-change ledger must hold exactly 'description' and 'changes', not '${keys}'.`);
  if (!isText(document.description)) throw new Error("The sanctioned-change ledger's description must be a non-empty string.");
  if (!Array.isArray(document.changes)) throw new Error("The sanctioned-change ledger's changes must be an array.");
  const seen = new Set();
  document.changes.forEach((change, index) => {
    const id = validateChange(change, index);
    if (seen.has(id)) throw new Error(`${named(id)}: id is not unique.`);
    seen.add(id);
  });
  return document.changes;
}

/**
 * Read and validate the committed ledger under `root`.
 *
 * @param {string} root - Repository root (absolute path).
 * @returns {Array<Record<string, any>>} The validated changes, in file order.
 */
export function readSanctionedChanges(root) {
  return validateSanctionedChanges(JSON.parse(readFileSync(join(root, SANCTIONED_CHANGES_RELATIVE_PATH), 'utf8')));
}

/** The rows of the golden section that change `change` names. */
function rowsOf(golden, change) {
  const server = golden.servers?.[change.server];
  return change.golden === 'wire' ? server?.sessions?.[change.session]?.rows : server?.rows;
}

/** The one row that `change` names; throws, naming the change, when there is none or more than one. */
function rowOf(golden, change) {
  const rows = rowsOf(golden, change);
  const where = `${change.server}${change.golden === 'wire' ? `/${change.session}` : ''}/${change.label}`;
  if (!Array.isArray(rows)) throw new Error(`${named(change.id)}: the golden has no rows for ${where}.`);
  const matches = rows.filter((row) => row?.label === change.label);
  if (matches.length === 0) throw new Error(`${named(change.id)}: the golden has no row ${where}.`);
  if (matches.length > 1) throw new Error(`${named(change.id)}: ${where} names more than one row.`);
  return matches[0];
}

/** Replace or remove the value at `change.pointer` inside `message`, whose current value has already been checked. */
function edit(message, change) {
  const tokens = pointerTokens(change.pointer);
  const parent = walk(message, tokens.slice(0, -1));
  const last = tokens[tokens.length - 1];
  if (change.op === 'replace') {
    parent[Array.isArray(parent) ? indexOf(last) : last] = structuredClone(change.new);
  } else if (Array.isArray(parent)) {
    parent.splice(indexOf(last), 1);
  } else {
    delete parent[last];
  }
}

/**
 * Apply one `section: "audit"` change to `clone`: the audit element that the pointer's first token names must exist and
 * be a call entry (it has `seq`), the pointer must resolve inside it, and `old` must be its value. Throws, naming the
 * change, otherwise.
 */
function applyAuditChange(clone, change) {
  const audit = clone.servers?.[change.server]?.audit;
  if (!Array.isArray(audit)) throw new Error(`${named(change.id)}: the golden has no audit array for ${change.server}.`);
  const tokens = pointerTokens(change.pointer);
  const element = walk(audit, tokens.slice(0, 1));
  if (element === undefined) throw new Error(`${named(change.id)}: the audit array of ${change.server} has no element ${tokens[0]}.`);
  if (!isObject(element) || !hasOwn(element, 'seq')) {
    throw new Error(`${named(change.id)}: audit element ${tokens[0]} of ${change.server} is not a call entry (it has no seq), so it stays frozen.`);
  }
  const current = walk(audit, tokens);
  if (current === undefined) throw new Error(`${named(change.id)}: pointer ${change.pointer} resolves to nothing in the audit array of ${change.server}.`);
  if (!sameJson(current, change.old)) throw new Error(`${named(change.id)}: old is not the value at ${change.pointer} in the audit array of ${change.server}.`);
  edit(audit, change);
}

/**
 * A deep clone of `golden` with the ledger applied: each row that a `kind` change names carries its frozen line with
 * the changes of that row applied in file order and re-serialized with `JSON.stringify`, and each audit element that
 * a handler change names carries the changed member. No other field changes.
 *
 * @param {Record<string, any>} golden - The frozen golden, parsed.
 * @param {'wire' | 'handler'} kind - Which golden `golden` is; only the changes of that kind apply.
 * @param {Array<Record<string, any>>} changes - The validated changes.
 * @returns {Record<string, any>} The sanctioned golden.
 */
export function applySanctionedChanges(golden, kind, changes) {
  if (kind !== 'wire' && kind !== 'handler') throw new Error(`The golden kind must be 'wire' or 'handler', not '${String(kind)}'.`);
  const clone = structuredClone(golden);
  const parsed = new Map();
  for (const change of changes.filter((candidate) => candidate.golden === kind)) {
    if (change.section === 'audit') {
      applyAuditChange(clone, change);
      continue;
    }
    const row = rowOf(clone, change);
    if (!parsed.has(row)) {
      const message = JSON.parse(row.line);
      if (JSON.stringify(message) !== row.line) {
        throw new Error(`${named(change.id)}: the frozen line of '${change.label}' is not canonical JSON, so re-serializing it would change bytes no change names.`);
      }
      parsed.set(row, message);
    }
    const message = parsed.get(row);
    const current = valueAt(message, change.pointer);
    if (current === undefined) throw new Error(`${named(change.id)}: pointer ${change.pointer} resolves to nothing in '${change.label}'.`);
    if (!sameJson(current, change.old)) throw new Error(`${named(change.id)}: old is not the value at ${change.pointer} in '${change.label}'.`);
    edit(message, change);
  }
  for (const [row, message] of parsed) row.line = JSON.stringify(message);
  return clone;
}

/**
 * Read a frozen golden under `root` and apply the committed ledger to it.
 *
 * @param {string} root - Repository root (absolute path).
 * @param {'wire' | 'handler'} kind - Which golden to read.
 * @returns {Record<string, any>} The sanctioned golden.
 */
export function readSanctionedGolden(root, kind) {
  if (!hasOwn(GOLDEN_PATHS, kind)) throw new Error(`The golden kind must be 'wire' or 'handler', not '${String(kind)}'.`);
  const golden = JSON.parse(readFileSync(join(root, GOLDEN_PATHS[kind]), 'utf8'));
  return applySanctionedChanges(golden, kind, readSanctionedChanges(root));
}
