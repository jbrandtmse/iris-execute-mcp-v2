// Tree synchronisation for generated directories: the one implementation behind
// `scripts/gen-skills.mjs` (owns `skills/`) and `scripts/gen-pack.mjs` (owns the skills pack).
//
// A generated tree is described by a Map from a relative POSIX path to its expected content: a Buffer,
// or a string that is written and compared as UTF-8. Comparison and writing are byte for byte; file
// bytes are never decoded and re-encoded. The helpers know nothing about what a tree contains.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @param {Buffer | string} content
 * @returns {Buffer}
 */
function toBuffer(content) {
  return Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
}

/**
 * Every regular file under `dir`, as sorted POSIX paths relative to `dir`. A missing `dir` has no
 * files. Symlinks are not followed and not listed.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function listFilesRecursive(dir) {
  const found = [];
  if (!existsSync(dir)) return found;
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(current, entry.name), `${rel}/`);
      } else if (entry.isFile()) {
        found.push(rel);
      }
    }
  };
  walk(dir, '');
  return found.sort();
}

/**
 * Compare the tree on disk at `dir` with the expected tree. Writes nothing.
 *
 * - `missing`: expected paths that do not exist on disk.
 * - `drift`: expected paths that exist but whose bytes differ (or that are not readable files).
 * - `stray`: files on disk that are not expected.
 *
 * @param {Map<string, Buffer | string>} expected
 * @param {string} dir
 * @returns {{ missing: string[], drift: string[], stray: string[] }}
 */
export function diffTree(expected, dir) {
  const missing = [];
  const drift = [];
  for (const [rel, content] of expected) {
    const abs = join(dir, rel);
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    let actual = null;
    try {
      actual = readFileSync(abs);
    } catch {
      // Not a readable regular file: reported as drift below.
    }
    if (actual === null || !actual.equals(toBuffer(content))) drift.push(rel);
  }
  const stray = listFilesRecursive(dir).filter((rel) => !expected.has(rel));
  return { missing, drift, stray };
}

/**
 * Make the tree on disk at `dir` equal to the expected tree: write every expected file whose bytes
 * differ, delete every file that is not expected, and prune the directories that end up empty (`dir`
 * itself is kept).
 *
 * @param {Map<string, Buffer | string>} expected
 * @param {string} dir
 * @returns {string[]} The relative paths of the files that were deleted.
 */
export function writeTree(expected, dir) {
  for (const [rel, content] of expected) {
    const abs = join(dir, rel);
    const bytes = toBuffer(content);
    if (existsSync(abs) && statSync(abs).isFile() && readFileSync(abs).equals(bytes)) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
  }
  const removed = [];
  for (const rel of listFilesRecursive(dir)) {
    if (expected.has(rel)) continue;
    rmSync(join(dir, rel), { force: true });
    removed.push(rel);
  }
  removeEmptyDirs(dir, dir);
  return removed;
}

/**
 * @param {string} dir
 * @param {string} top - The directory that is never removed.
 */
function removeEmptyDirs(dir, top) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(join(dir, entry.name), top);
  }
  if (dir !== top && readdirSync(dir).length === 0) {
    rmSync(dir, { recursive: true, force: true });
  }
}
