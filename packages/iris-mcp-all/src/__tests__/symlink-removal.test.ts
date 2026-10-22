/**
 * A test removes a link to a directory with `unlink`, never with `rmSync(link, { force: true })`. Node 24.0.0 refuses that call on a
 * link to a directory ("Path is a directory"), where Node 22 and 26 remove the link, so a test that does it passes on a developer
 * machine and fails on the 24.0.0 leg of CI's `gates` job.
 *
 * Two parts. `removeLink` (the helper the scratch-copy tests use) is shown on a real link to a real directory; its cases pass on
 * every Node but 24.0.0, whatever the helper does. And a scan of the test sources finds any file that makes links and also calls
 * `rmSync` or `rm` with `force: true` and no `recursive`, in any layout prettier gives the call, which is the call that fails; on
 * every other Node the scan is what fails when the helper's `unlinkSync` is replaced by that call.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PACKAGES_DIR, LAUNCHER_DIR, walk } from "../../../../scripts/lib/live-gate-scan.mjs";
import { makeTempRoot, removeLink, removeTempRoot } from "./pack-fixture";

const roots: string[] = [];
function scratch(): string {
  const root = makeTempRoot("symlink-removal");
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) removeTempRoot(root);
});

describe("removeLink removes the link and nothing it points at", () => {
  it("a link to a directory: the link goes, the directory and its file stay", () => {
    const root = scratch();
    const target = path.join(root, "target");
    mkdirSync(target);
    writeFileSync(path.join(target, "kept.txt"), "kept\n");
    const link = path.join(root, "link");
    symlinkSync(target, link, "junction");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);

    removeLink(link);

    expect(lstatSync(link, { throwIfNoEntry: false }), "the link is gone").toBeUndefined();
    expect(readFileSync(path.join(target, "kept.txt"), "utf8")).toBe("kept\n");
  });

  it("a link to a file and a dangling link go too", () => {
    const root = scratch();
    writeFileSync(path.join(root, "file.txt"), "x\n");
    symlinkSync(path.join(root, "file.txt"), path.join(root, "to-file"));
    symlinkSync(path.join(root, "nowhere"), path.join(root, "dangling"));

    removeLink(path.join(root, "to-file"));
    removeLink(path.join(root, "dangling"));

    expect(readdirSync(root)).toEqual(["file.txt"]);
  });

  it("a real directory, a real file and a missing path are left as they are", () => {
    const root = scratch();
    mkdirSync(path.join(root, "dir"));
    writeFileSync(path.join(root, "dir", "inside.txt"), "inside\n");
    writeFileSync(path.join(root, "file.txt"), "file\n");

    removeLink(path.join(root, "dir"));
    removeLink(path.join(root, "file.txt"));
    removeLink(path.join(root, "missing"));

    expect(readdirSync(root).sort()).toEqual(["dir", "file.txt"]);
    expect(readFileSync(path.join(root, "dir", "inside.txt"), "utf8")).toBe("inside\n");
  });
});

/**
 * The calls in `source` that are `rmSync(<path>, { force: true })` or its `rm` form: the options object asks for `force` and never
 * for `recursive`, whatever else it holds and however the call is wrapped (a trailing comma, the options on their own line).
 */
function forceOnlyRemovals(source: string): string[] {
  return [...source.matchAll(/\brm(?:Sync)?\([^;]*?\{(?![^{}]*\brecursive\b)[^{}]*\bforce:\s*true\b[^{}]*\}\s*,?\s*\)/g)].map((match) => match[0]);
}

/** A test source makes links when it calls `symlinkSync` or `symlink`, or asks the scratch-repository fixture for the linked server packages. */
const MAKES_LINKS = /\bsymlink(?:Sync)?\(|serverPackages:\s*true/;

describe("no test that makes links removes one with rmSync and force alone", () => {
  const testSources = (): string[] => {
    const directories = [
      ...readdirSync(PACKAGES_DIR).map((name) => path.join(PACKAGES_DIR, name, "src")),
      path.join(LAUNCHER_DIR, "src"),
    ];
    // This file is left out: its samples are the calls the scan looks for.
    return directories
      .filter((directory) => existsSync(directory))
      .flatMap((directory) => walk(directory, [".ts"]))
      .filter((file) => file.includes(`${path.sep}__tests__${path.sep}`) && path.basename(file) !== "symlink-removal.test.ts");
  };

  it("the scan reads the test sources at all (an empty scan would pass the next case vacuously)", () => {
    const sources = testSources();
    expect(sources.length, "the test sources of the workspace").toBeGreaterThan(300);
    expect(sources.filter((file) => MAKES_LINKS.test(readFileSync(file, "utf8"))).length, "the test sources that make links").toBeGreaterThan(8);
  });

  it("finds the call that fails on Node 24.0.0, and only that call", () => {
    expect(forceOnlyRemovals('rmSync(join(root, "packages", dir), { force: true });')).toHaveLength(1);
    expect(forceOnlyRemovals("rmSync(link,\n  { force: true });")).toHaveLength(1);
    expect(forceOnlyRemovals("rmSync(link, {\n  force: true,\n});")).toHaveLength(1);
    expect(forceOnlyRemovals("rmSync(\n  join(root, OPS_PACKAGE, \"dist\", \"tools\"),\n  { force: true },\n);")).toHaveLength(1);
    expect(forceOnlyRemovals("rmSync(link, { force: true, maxRetries: 2 });")).toHaveLength(1);
    expect(forceOnlyRemovals("await rm(link, { force: true });")).toHaveLength(1);
    expect(forceOnlyRemovals("fs.rmSync(link, { force: true });")).toHaveLength(1);
    expect(forceOnlyRemovals("rmSync(dir, { recursive: true, force: true });")).toEqual([]);
    expect(forceOnlyRemovals("rmSync(dir, { force: true, recursive: true });")).toEqual([]);
    expect(forceOnlyRemovals("rmSync(dir, {\n  recursive: true,\n  force: true,\n});")).toEqual([]);
    expect(forceOnlyRemovals("await rm(dir, { recursive: true, force: true });")).toEqual([]);
    expect(forceOnlyRemovals("confirm(link, { force: true });")).toEqual([]);
    expect(forceOnlyRemovals("rmSync(file);")).toEqual([]);
    expect(forceOnlyRemovals("unlinkSync(link);")).toEqual([]);
  });

  it("no test source that makes links calls rmSync or rm with force and no recursive", () => {
    const offenders = testSources()
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return MAKES_LINKS.test(text) && forceOnlyRemovals(text).length > 0;
      })
      .map((file) => path.relative(PACKAGES_DIR, file).split(path.sep).join("/"));
    expect(offenders, "use removeLink from ./pack-fixture (an unlink) for a link").toEqual([]);
  });
});
