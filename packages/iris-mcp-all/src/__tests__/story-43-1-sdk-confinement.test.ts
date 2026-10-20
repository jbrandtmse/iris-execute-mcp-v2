/**
 * Story 43.1 (AC 43.1.1, AC 43.1.2, AD-2, AD-32; project rules #45, #59) - the dependency and import boundary of the SDK move.
 *
 * What it pins, in the default suite:
 *  - no package manifest of the workspace lists the v1 SDK package;
 *  - `@iris-mcp/shared` depends on `@modelcontextprotocol/server`, and the client is a devDependency of each package that
 *    drives it, every one at the exact version 2.3.1 (no range);
 *  - only `packages/shared/src` source (tests aside) imports an `@modelcontextprotocol/*` package;
 *  - the lockfile resolves `server`, `client` and `core` at 2.3.1 alone, names no v1 SDK, and marks none of the three as
 *    running an install script;
 *  - the capture script's `installedSdk` finds the v1 SDK on an oracle tree and the v2 server package on a migrated one,
 *    and this repository resolves the v2 server package at 2.3.1.
 *
 * It reads manifests, source files and the lockfile only; it starts no server and touches no IRIS instance. The temporary
 * trees of the `installedSdk` rows are created and removed by the rows themselves.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { installedSdk } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";

const V1_SDK = "@modelcontextprotocol/sdk";
const PINNED = "2.3.1";
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

type Manifest = { name?: string } & Partial<Record<(typeof DEPENDENCY_FIELDS)[number], Record<string, string>>>;

/** The directories under `parent` (relative to the repository root) that hold a `package.json`. */
function manifestDirs(parent: string): string[] {
  const root = path.join(REPO_ROOT, parent);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => path.join(parent, entry.name))
    .filter((dir) => {
      try {
        readFileSync(path.join(REPO_ROOT, dir, "package.json"));
        return true;
      } catch {
        return false;
      }
    });
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, dir, "package.json"), "utf8")) as Manifest;
}

const WORKSPACE_DIRS = [".", ...manifestDirs("packages"), ...manifestDirs("extensions")];

/** Non-test source files under `dir` (absolute), skipping `__tests__`, `dist` and `node_modules`. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mts|js|mjs|cjs)$/.test(entry.name) && !/\.test\.[a-z]+$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** A module specifier of an `@modelcontextprotocol/*` package, as an import, a dynamic import or a require holds it. */
const SDK_SPECIFIER = /["']@modelcontextprotocol\//;

/** The `src` directories of the workspace packages and the extension, relative to the repository root. */
const SOURCE_DIRS = [...manifestDirs("packages"), ...manifestDirs("extensions")].map((dir) => path.join(dir, "src"));

describe("the workspace manifests (AC 43.1.1, AC 43.1.2)", () => {
  it("finds the manifests it is meant to inspect", () => {
    expect(WORKSPACE_DIRS).toEqual(expect.arrayContaining([".", "packages/shared", "packages/iris-dev-mcp", "packages/iris-mcp-all", "extensions/iris-mcp-launcher"]));
  });

  it.each(WORKSPACE_DIRS)("%s lists no v1 SDK in any dependency field", (dir) => {
    const manifest = readManifest(dir);
    for (const field of DEPENDENCY_FIELDS) {
      expect(Object.keys(manifest[field] ?? {}), `${dir} ${field}`).not.toContain(V1_SDK);
    }
  });

  it("@iris-mcp/shared depends on the v2 server package at the exact version", () => {
    const manifest = readManifest("packages/shared");
    expect(manifest.dependencies?.["@modelcontextprotocol/server"]).toBe(PINNED);
  });

  it.each(["packages/shared", "packages/iris-dev-mcp", "packages/iris-mcp-all"])("%s has the v2 client as a devDependency at the exact version", (dir) => {
    expect(readManifest(dir).devDependencies?.["@modelcontextprotocol/client"]).toBe(PINNED);
  });

  it("no package other than shared depends on the v2 server package", () => {
    for (const dir of WORKSPACE_DIRS.filter((candidate) => candidate !== "packages/shared")) {
      const manifest = readManifest(dir);
      for (const field of DEPENDENCY_FIELDS) {
        expect(Object.keys(manifest[field] ?? {}), `${dir} ${field}`).not.toContain("@modelcontextprotocol/server");
      }
    }
  });
});

describe("SDK confinement: only packages/shared/src imports an @modelcontextprotocol package (AC 43.1.2, AD-2, AD-32)", () => {
  it("the specifier pattern matches an import, a dynamic import and a require, and not prose", () => {
    expect(SDK_SPECIFIER.test('import { Client } from "@modelcontextprotocol/client";')).toBe(true);
    expect(SDK_SPECIFIER.test("await import('@modelcontextprotocol/server/stdio')")).toBe(true);
    expect(SDK_SPECIFIER.test('require("@modelcontextprotocol/core")')).toBe(true);
    expect(SDK_SPECIFIER.test("served by the MCP SDK server package")).toBe(false);
  });

  it("the shared framework's source does import the server package (the walk is not vacuous)", () => {
    const sharedFiles = sourceFiles(path.join(REPO_ROOT, "packages", "shared", "src"));
    expect(sharedFiles.length).toBeGreaterThan(0);
    const importing = sharedFiles.filter((file) => SDK_SPECIFIER.test(readFileSync(file, "utf8")));
    expect(importing.map((file) => path.relative(REPO_ROOT, file))).toEqual(expect.arrayContaining(["packages/shared/src/server-base.ts"]));
  });

  it.each(SOURCE_DIRS.filter((dir) => dir !== path.join("packages", "shared", "src")))("%s has no source that imports an @modelcontextprotocol package", (dir) => {
    const files = sourceFiles(path.join(REPO_ROOT, dir));
    const offending = files.filter((file) => SDK_SPECIFIER.test(readFileSync(file, "utf8"))).map((file) => path.relative(REPO_ROOT, file));
    expect(offending).toEqual([]);
  });
});

describe("the lockfile (AC 43.1.1)", () => {
  const lock = readFileSync(path.join(REPO_ROOT, "pnpm-lock.yaml"), "utf8");
  const lines = lock.split("\n");

  /** The lines of the `packages:` entry for `key` (the first occurrence is the one that holds `resolution`). */
  function packageEntry(key: string): string[] {
    const start = lines.indexOf(`  '${key}':`);
    expect(start, `${key} has an entry`).toBeGreaterThanOrEqual(0);
    const entry: string[] = [];
    for (let at = start + 1; at < lines.length && lines[at] !== ""; at += 1) entry.push(lines[at] as string);
    return entry;
  }

  it("names no v1 SDK", () => {
    expect(lock).not.toContain(V1_SDK);
  });

  it("resolves server, client and core at exactly 2.3.1 and no other version", () => {
    const keys = lines.map((line) => /^ {2}'@modelcontextprotocol\/(server|client|core)@([^']+)':$/.exec(line)).filter((match): match is RegExpExecArray => match !== null);
    expect(new Set(keys.map((match) => match[1]))).toEqual(new Set(["server", "client", "core"]));
    expect(new Set(keys.map((match) => match[2]))).toEqual(new Set([PINNED]));
  });

  it.each(["server", "client", "core"])("the %s package is integrity-pinned and runs no install script", (name) => {
    const entry = packageEntry(`@modelcontextprotocol/${name}@${PINNED}`);
    expect(entry.some((line) => /^\s+resolution: \{integrity: sha512-/.test(line)), `${name} has an integrity hash`).toBe(true);
    expect(entry.filter((line) => /requiresBuild/.test(line))).toEqual([]);
  });
});

describe("installedSdk, the capture script's reading of the SDK package it ran against", () => {
  const roots: string[] = [];

  /** A repository-shaped tree whose `packages/shared/node_modules` holds the named packages. */
  function treeWith(...installed: Array<[string, string]>): string {
    const root = mkdtempSync(path.join(tmpdir(), "story-43-1-installed-sdk-"));
    roots.push(root);
    for (const [name, version] of installed) {
      const dir = path.join(root, "packages", "shared", "node_modules", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
    }
    return root;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("finds the v1 SDK on the oracle tree the golden was captured from", () => {
    expect(installedSdk(treeWith([V1_SDK, "1.29.0"]))).toEqual({ sdkPackage: V1_SDK, sdkVersion: "1.29.0" });
  });

  it("finds the v2 server package on a migrated tree", () => {
    expect(installedSdk(treeWith(["@modelcontextprotocol/server", PINNED]))).toEqual({ sdkPackage: "@modelcontextprotocol/server", sdkVersion: PINNED });
  });

  it("fails, rather than guesses, when neither package is installed", () => {
    expect(() => installedSdk(treeWith())).toThrow(/is installed under packages\/shared\/node_modules/);
  });

  it("resolves the v2 server package at 2.3.1 in this repository", () => {
    expect(installedSdk(REPO_ROOT)).toEqual({ sdkPackage: "@modelcontextprotocol/server", sdkVersion: PINNED });
  });
});
