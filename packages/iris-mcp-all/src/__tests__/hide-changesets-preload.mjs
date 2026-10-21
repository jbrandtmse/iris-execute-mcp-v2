// Node preload (`node --import <this file>`) for the after-release run of story-42-1-qa-changeset-readers.test.ts.
//
// `changeset version` consumes (deletes) every pending `.changeset/*.md`. This preload makes the files of ONE directory
// look consumed, without touching the disk, to the `node:fs` calls the changeset readers use: `existsSync` says no;
// `readFileSync`, `statSync`, `lstatSync`, `accessSync`, `openSync`, `copyFileSync`, `cpSync` and their `fs.promises`
// forms throw or reject ENOENT; and `readdirSync` / `fs.promises.readdir` of that directory leave the names out. The
// callback API, streams, `opendir`, `realpath`, `glob` and a recursive listing from an ancestor are NOT patched, so a
// reader that uses one of them is not covered. `README.md`, `config.json` and every other path are untouched. The
// directory is `process.env.IRIS_HIDE_CHANGESETS_DIR` (absolute); unset, nothing is patched.

import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hiddenDirectory = process.env.IRIS_HIDE_CHANGESETS_DIR;

if (hiddenDirectory) {
  const fs = createRequire(import.meta.url)("node:fs");
  const root = path.resolve(hiddenDirectory);

  const asPath = (value) => {
    if (typeof value === "string") return value;
    if (value instanceof URL) return value.protocol === "file:" ? fileURLToPath(value) : "";
    if (Buffer.isBuffer(value)) return value.toString("utf8");
    return "";
  };
  const hiddenName = (name) => name.endsWith(".md") && name !== "README.md";
  const isHidden = (value) => {
    const raw = asPath(value);
    if (raw === "") return false;
    const absolute = path.resolve(raw);
    return path.dirname(absolute) === root && hiddenName(path.basename(absolute));
  };
  const enoent = (syscall, value) => {
    const error = new Error(`ENOENT: no such file or directory, ${syscall} '${asPath(value)}'`);
    error.code = "ENOENT";
    error.errno = -2;
    error.syscall = syscall;
    error.path = asPath(value);
    return error;
  };
  const entryName = (entry) => (typeof entry === "string" ? entry : Buffer.isBuffer(entry) ? entry.toString("utf8") : entry.name);

  /** Replace `target[name]` with a function that applies `whenHidden` to a hidden first argument and the original otherwise. */
  const guard = (target, name, whenHidden) => {
    const real = target[name];
    target[name] = function guarded(first, ...rest) {
      return isHidden(first) ? whenHidden(name, first) : real.call(this, first, ...rest);
    };
  };

  guard(fs, "existsSync", () => false);
  for (const name of ["readFileSync", "statSync", "lstatSync", "accessSync", "openSync", "copyFileSync", "cpSync"]) {
    guard(fs, name, (syscall, value) => {
      throw enoent(syscall, value);
    });
  }
  for (const name of ["readFile", "stat", "lstat", "access", "open", "copyFile", "cp"]) {
    guard(fs.promises, name, (syscall, value) => Promise.reject(enoent(syscall, value)));
  }

  const withoutHiddenNames = (first, listing) =>
    asPath(first) !== "" && path.resolve(asPath(first)) === root && Array.isArray(listing)
      ? listing.filter((entry) => !hiddenName(entryName(entry)))
      : listing;
  const realReaddirSync = fs.readdirSync;
  fs.readdirSync = function readdirSync(first, ...rest) {
    return withoutHiddenNames(first, realReaddirSync.call(this, first, ...rest));
  };
  const realReaddir = fs.promises.readdir;
  fs.promises.readdir = async function readdir(first, ...rest) {
    return withoutHiddenNames(first, await realReaddir.call(this, first, ...rest));
  };

  syncBuiltinESMExports();
}
