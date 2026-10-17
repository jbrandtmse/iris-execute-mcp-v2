// Core helpers for the `tools/list` snapshot (Story 39.6, DW-573; AD-15, AD-2).
//
// Shared by the CLI `scripts/gen-tools-list-snapshot.mjs` and by
// `packages/iris-mcp-all`'s default-suite test `tools-list-snapshot.test.ts`
// (Rule #45: only `@iris-mcp/all` sees every server's built dist), so the
// capture and the comparison are single-sourced and the two can never
// disagree.
//
// CONTRACT
//   The snapshot pins, for every tool of the five built servers under
//   preset `full`, the fields of its real `tools/list` entry that a client
//   sees: `title`, `description`, `inputSchema`, `annotations`, and
//   `outputSchema` when present. `name` is the key. The SDK-owned
//   `execution` and `_meta` fields are not tool-owned and are excluded.
//
//   The check is ONE-DIRECTIONAL:
//     - every snapshot entry must still be listed, and each pinned field must
//       deep-equal the live one after a sorted-key canonicalization (array
//       order is significant). Any difference, an additive one included, is a
//       problem: the story that makes the change regenerates the snapshot;
//     - a live tool absent from the snapshot is reported in `added` and is
//       allowed.
//
//   An empty snapshot, or one missing a server package, is never "no
//   problems": it is rejected by `assertSnapshotShape`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { checkDistFresh } from './dist-freshness.mjs';
import { fetchAllTools } from './measure-tools-payload-core.mjs';
import { SERVER_PACKAGES } from './tool-catalog.mjs';

/** Repository-relative path of the committed snapshot. */
export const SNAPSHOT_RELATIVE_PATH =
  'packages/iris-mcp-all/src/__tests__/fixtures/tools-list-snapshot.json';

/** The pinned entry fields, in report order. `outputSchema` is pinned when present on either side. */
export const ENTRY_FIELDS = ['title', 'description', 'inputSchema', 'annotations', 'outputSchema'];

/** Entry fields every snapshot entry must carry. */
const REQUIRED_ENTRY_FIELDS = ['title', 'description', 'inputSchema', 'annotations'];

/** Packages whose built dist a capture reads: the shared framework plus the five servers. */
export const DIST_PACKAGES = ['shared', ...SERVER_PACKAGES];

/** The environment variables the tool-visibility engine reads at server construction. */
const TOOLS_ENV_KEYS = ['IRIS_TOOLS_PRESET', 'IRIS_TOOLS_DISABLE', 'IRIS_TOOLS_ENABLE'];

/** Longest excerpt a problem line quotes from either side. */
const EXCERPT_LIMIT = 80;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deep copy with every object's keys sorted (UTF-16 code-unit order, so the result
 * never depends on the locale) and `undefined` members dropped. Array order is kept.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

// ── dist freshness ───────────────────────────────────────────────────────────

/** The `pnpm --filter` command that rebuilds one package, from its manifest name. */
function rebuildCommand(root, pkg) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'packages', pkg, 'package.json'), 'utf-8'));
    if (typeof manifest.name === 'string') return `pnpm --filter ${manifest.name} build`;
  } catch {
    // Fall through: a missing manifest is itself reported by checkDistFresh.
  }
  return `pnpm --filter ${pkg} build`;
}

/**
 * The packages whose built dist a capture reads that are missing or stale (a `src/` file
 * newer than the build output, per `checkDistFresh`). A package that declares no dist
 * counts as stale: the capture needs its build output.
 *
 * @param {string} root - Repository root.
 * @returns {Array<{ pkg: string, reason: string, command: string }>}
 */
export function staleDists(root) {
  const stale = [];
  for (const pkg of DIST_PACKAGES) {
    const fresh = checkDistFresh(join(root, 'packages', pkg), pkg);
    if (!fresh.ok) {
      stale.push({ pkg, reason: fresh.reason ?? `${pkg} build output could not be verified.`, command: rebuildCommand(root, pkg) });
    } else if (fresh.skipped) {
      stale.push({
        pkg,
        reason: `${pkg} declares no dist/ build output, but the tools/list capture reads its built dist.`,
        command: rebuildCommand(root, pkg),
      });
    }
  }
  return stale;
}

/**
 * The failure text for a non-empty {@link staleDists} result: names each package and
 * the command that rebuilds it. Always contains the word "rebuild".
 *
 * @param {Array<{ pkg: string, reason: string, command: string }>} stale
 * @returns {string}
 */
export function staleDistMessage(stale) {
  const lines = stale.map((entry) => `  - ${entry.pkg}: ${entry.reason}\n    rebuild it with: ${entry.command}`);
  return `The tools/list capture reads built dists, and ${stale.length} of them are stale or missing; rebuild before capturing:\n${lines.join('\n')}`;
}

// ── capture ──────────────────────────────────────────────────────────────────

/** Run `fn` with the tool-visibility variables removed (preset `full`), then restore them. */
async function withToolsEnvScrubbed(fn) {
  const saved = new Map(TOOLS_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of TOOLS_ENV_KEYS) delete process.env[key];
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** The installed version of `dep` as the shared package resolves it (read from its manifest, not an exports map). */
function installedVersion(root, dep) {
  const manifest = JSON.parse(readFileSync(join(root, 'packages', 'shared', 'node_modules', dep, 'package.json'), 'utf-8'));
  return String(manifest.version);
}

/** Map one listed tool to its pinned entry; a JSON round trip drops `undefined` members exactly as the wire does. */
function toEntry(listed) {
  const entry = {
    title: listed.title,
    description: listed.description,
    inputSchema: listed.inputSchema,
    annotations: listed.annotations,
  };
  if (listed.outputSchema !== undefined) entry.outputSchema = listed.outputSchema;
  return canonicalize(JSON.parse(JSON.stringify(entry)));
}

/**
 * Capture the real `tools/list` of all five built servers under preset `full`: construct
 * an `McpServerBase` per server from the built dists (no IRIS connection is made), drive
 * the real `tools/list` handler with {@link fetchAllTools}, and map each tool to its
 * pinned entry. The `IRIS_TOOLS_*` variables are removed for the construction and restored.
 *
 * Does not check dist freshness: callers run {@link staleDists} first.
 *
 * @param {string} root - Repository root.
 * @returns {Promise<{ sdkVersion: string, zodVersion: string, entryCount: number, servers: Record<string, Record<string, object>> }>}
 */
export async function captureToolsList(root) {
  const sharedEntry = join(root, 'packages', 'shared', 'dist', 'index.js');
  const { McpServerBase } = await import(pathToFileURL(sharedEntry).href);
  if (typeof McpServerBase !== 'function') {
    throw new Error(`tools-list-snapshot: ${sharedEntry} does not export McpServerBase.`);
  }

  const servers = {};
  let entryCount = 0;
  await withToolsEnvScrubbed(async () => {
    for (const pkg of SERVER_PACKAGES) {
      const manifest = JSON.parse(readFileSync(join(root, 'packages', pkg, 'package.json'), 'utf-8'));
      const { tools } = await import(pathToFileURL(join(root, 'packages', pkg, 'dist', 'tools', 'index.js')).href);
      const { toolPresets } = await import(pathToFileURL(join(root, 'packages', pkg, 'dist', 'tools', 'presets.js')).href);
      if (!Array.isArray(tools)) {
        throw new Error(`tools-list-snapshot: ${pkg} dist/tools/index.js does not export a "tools" array.`);
      }
      const server = new McpServerBase({ name: manifest.name, version: manifest.version, tools, toolPresets });
      const entries = {};
      for (const listed of await fetchAllTools(server)) {
        if (Object.prototype.hasOwnProperty.call(entries, listed.name)) {
          throw new Error(`tools-list-snapshot: ${pkg} lists the tool ${listed.name} more than once.`);
        }
        entries[listed.name] = toEntry(listed);
        entryCount += 1;
      }
      servers[pkg] = entries;
    }
  });

  return {
    sdkVersion: installedVersion(root, '@modelcontextprotocol/sdk'),
    zodVersion: installedVersion(root, 'zod'),
    entryCount,
    servers: canonicalize(servers),
  };
}

// ── shape ────────────────────────────────────────────────────────────────────

/**
 * Reject a snapshot (committed or live) that cannot be trusted as a pin: not an object
 * with a `servers` object, missing any of the five server packages, a server with no
 * tools, an entry lacking a pinned field or holding a field of the wrong type, or an
 * `entryCount` that is not the number of entries.
 *
 * @param {unknown} snapshot
 * @throws {Error} Naming the first defect.
 */
export function assertSnapshotShape(snapshot) {
  if (!isPlainObject(snapshot) || !isPlainObject(snapshot.servers)) {
    throw new Error('tools/list snapshot is invalid: it is not an object with a "servers" object.');
  }
  let counted = 0;
  for (const pkg of SERVER_PACKAGES) {
    const entries = snapshot.servers[pkg];
    if (!isPlainObject(entries)) {
      throw new Error(`tools/list snapshot is invalid: it has no entries for the server package ${pkg}.`);
    }
    const names = Object.keys(entries);
    if (names.length === 0) {
      throw new Error(`tools/list snapshot is invalid: the server package ${pkg} lists no tools.`);
    }
    for (const name of names) {
      const entry = entries[name];
      if (!isPlainObject(entry)) {
        throw new Error(`tools/list snapshot is invalid: ${pkg} ${name} is not an object.`);
      }
      for (const field of REQUIRED_ENTRY_FIELDS) {
        if (entry[field] === undefined) {
          throw new Error(`tools/list snapshot is invalid: ${pkg} ${name} has no ${field}.`);
        }
      }
      for (const field of ['title', 'description']) {
        if (typeof entry[field] !== 'string') {
          throw new Error(`tools/list snapshot is invalid: ${pkg} ${name}.${field} is not a string.`);
        }
      }
      for (const field of ['inputSchema', 'annotations', 'outputSchema']) {
        if (entry[field] !== undefined && !isPlainObject(entry[field])) {
          throw new Error(`tools/list snapshot is invalid: ${pkg} ${name}.${field} is not an object.`);
        }
      }
      counted += 1;
    }
  }
  if (snapshot.entryCount !== counted) {
    throw new Error(
      `tools/list snapshot is invalid: entryCount is ${JSON.stringify(snapshot.entryCount)} but the servers hold ${counted} entries.`,
    );
  }
}

// ── compare ──────────────────────────────────────────────────────────────────

/** Marks a member that exists on only one side of a comparison. */
const ABSENT = Symbol('absent');

/** Append an object key to a JSON path. */
function childPath(path, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/**
 * The first difference between two canonicalized values, in sorted-key / index order:
 * `{ path, snapshot, live }`, or `undefined` when they are deep-equal. A string
 * difference also carries the index of its first differing character.
 */
function firstDifference(snapshot, live, path) {
  if (snapshot === ABSENT || live === ABSENT) return { path, snapshot, live };
  if (Array.isArray(snapshot) && Array.isArray(live)) {
    const length = Math.max(snapshot.length, live.length);
    for (let i = 0; i < length; i += 1) {
      const found = firstDifference(i < snapshot.length ? snapshot[i] : ABSENT, i < live.length ? live[i] : ABSENT, `${path}[${i}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (isPlainObject(snapshot) && isPlainObject(live)) {
    const keys = [...new Set([...Object.keys(snapshot), ...Object.keys(live)])].sort();
    for (const key of keys) {
      const found = firstDifference(
        Object.prototype.hasOwnProperty.call(snapshot, key) ? snapshot[key] : ABSENT,
        Object.prototype.hasOwnProperty.call(live, key) ? live[key] : ABSENT,
        childPath(path, key),
      );
      if (found) return found;
    }
    return undefined;
  }
  if (snapshot === live) return undefined;
  if (typeof snapshot === 'string' && typeof live === 'string') {
    let index = 0;
    while (index < snapshot.length && index < live.length && snapshot[index] === live[index]) index += 1;
    return { path, snapshot, live, index };
  }
  return { path, snapshot, live };
}

/** Quote one side of a difference, bounded; a string is windowed around its first differing character. */
function excerpt(value, index) {
  if (value === ABSENT) return '(absent)';
  if (typeof value === 'string' && index !== undefined) {
    const start = Math.max(0, index - 20);
    const end = Math.min(value.length, index + 20);
    return `${start > 0 ? '...' : ''}${JSON.stringify(value.slice(start, end))}${end < value.length ? '...' : ''}`;
  }
  const text = JSON.stringify(value) ?? String(value);
  return text.length > EXCERPT_LIMIT ? `${text.slice(0, EXCERPT_LIMIT)}...` : text;
}

/**
 * Compare a committed snapshot against a live capture, one-directionally.
 *
 * `problems` holds one line per snapshot entry that is no longer listed
 * (`<pkg> <tool> vanished: ...`) and one per pinned field that differs
 * (`<pkg> <tool>.<field> differs at <first differing JSON path>: ...`; a string difference
 * also names the character index). `added` holds `<pkg> <tool>` for each live tool the
 * snapshot does not list; it is reported and never a problem. A snapshot that fails
 * {@link assertSnapshotShape} yields that defect as the only problem.
 *
 * @param {{ servers: Record<string, Record<string, object>> }} snapshot - The committed snapshot.
 * @param {{ servers: Record<string, Record<string, object>> }} live - A {@link captureToolsList} result.
 * @returns {{ problems: string[], added: string[] }}
 */
export function compareSnapshot(snapshot, live) {
  try {
    assertSnapshotShape(snapshot);
  } catch (error) {
    return { problems: [error instanceof Error ? error.message : String(error)], added: [] };
  }
  const liveServers = isPlainObject(live) && isPlainObject(live.servers) ? live.servers : {};
  const problems = [];
  const added = [];

  for (const pkg of Object.keys(snapshot.servers).sort()) {
    const liveEntries = isPlainObject(liveServers[pkg]) ? liveServers[pkg] : {};
    for (const name of Object.keys(snapshot.servers[pkg]).sort()) {
      const pinned = snapshot.servers[pkg][name];
      const listed = liveEntries[name];
      if (!isPlainObject(listed)) {
        problems.push(`${pkg} ${name} vanished: the snapshot lists it, the live tools/list does not.`);
        continue;
      }
      for (const field of ENTRY_FIELDS) {
        if (pinned[field] === undefined && listed[field] === undefined) continue;
        const found = firstDifference(
          pinned[field] === undefined ? ABSENT : canonicalize(pinned[field]),
          listed[field] === undefined ? ABSENT : canonicalize(listed[field]),
          `$.${field}`,
        );
        if (found) {
          const where = found.index === undefined ? '' : ` (character ${found.index})`;
          problems.push(
            `${pkg} ${name}.${field} differs at ${found.path}${where}: snapshot ${excerpt(found.snapshot, found.index)} / live ${excerpt(found.live, found.index)}`,
          );
        }
      }
    }
  }

  for (const pkg of Object.keys(liveServers).sort()) {
    const pinnedEntries = isPlainObject(snapshot.servers[pkg]) ? snapshot.servers[pkg] : {};
    for (const name of Object.keys(liveServers[pkg]).sort()) {
      if (!Object.prototype.hasOwnProperty.call(pinnedEntries, name)) added.push(`${pkg} ${name}`);
    }
  }

  return { problems, added };
}

/**
 * The committed file's text for a snapshot document: 2-space JSON, ASCII only (every
 * character above U+007E is written as a `\uXXXX` escape, which parses back to the same
 * string), and one trailing newline. The generator writes exactly this, so a committed
 * file that is not byte-equal to `serializeSnapshot(JSON.parse(text))` was not produced
 * by it.
 *
 * @param {object} document
 * @returns {string}
 */
export function serializeSnapshot(document) {
  const json = JSON.stringify(document, null, 2).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `${json}\n`;
}

/**
 * Read and parse the committed snapshot of the tree at `root`.
 *
 * @param {string} root - Repository root.
 * @returns {object}
 */
export function readSnapshot(root) {
  return JSON.parse(readFileSync(join(root, SNAPSHOT_RELATIVE_PATH), 'utf-8'));
}
