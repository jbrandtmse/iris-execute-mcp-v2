/**
 * Story 43.1 QA (AC 43.1.1, AC 43.1.2, AD-2, AD-32; project rules #54, #59) - the SDK confinement in what would be PUBLISHED.
 *
 * `story-43-1-sdk-confinement.test.ts` reads the source tree, the manifests and the lockfile. This file reads the packages as
 * `npm pack` would ship them: for each publishable package it asks npm for the list of files the tarball would hold
 * (`npm pack --dry-run --json --ignore-scripts`, which needs no network and writes nothing), reads those files from disk, and checks
 *  - no packed file names `@modelcontextprotocol/sdk` (the v1 package), in code, type declarations, source maps or the manifest;
 *  - the module specifiers that the packed JavaScript and declarations import: only `@iris-mcp/shared` imports an
 *    `@modelcontextprotocol/*` module, and only `@modelcontextprotocol/server` and its `/stdio` entry;
 *  - the packed `package.json`: the one runtime dependency on the MCP SDK is shared's `@modelcontextprotocol/server`, at exactly 2.3.1;
 *    the client package is a test-only devDependency, also exact, and no package lists it (or any SDK package) as a runtime,
 *    peer or optional dependency.
 *
 * It reads the built `dist/` of each package, so it fails, never skips, when one is missing or older than its source.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { staleDistReason } from "./process-gate-helpers.js";

const SDK_V1 = "@modelcontextprotocol/sdk";
/** Every published package with a build, `@iris-mcp/client-config` included; `@iris-mcp/all` (no build) is added below. */
const PUBLISHED = ["shared", "iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp", "iris-ops-mcp", "iris-data-mcp", "client-config"] as const;
const WITH_DIST = new Set<string>(PUBLISHED);

interface Packed {
  name: string;
  files: Array<{ path: string }>;
}

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** What `npm pack` would put in the tarball of a package directory, without packing it. */
function packList(directory: string): Packed {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: directory,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, npm_config_update_notifier: "false", npm_config_loglevel: "error" },
  });
  if (result.status !== 0) throw new Error(`npm pack --dry-run failed in ${directory}: ${result.stderr}`);
  return (JSON.parse(result.stdout) as Packed[])[0]!;
}

/** The module specifiers a JavaScript or declaration file imports: `from "x"`, `import "x"`, `import("x")` and `require("x")`. */
function specifiersOf(text: string): string[] {
  const found = new Set<string>();
  const patterns = [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.add(match[1]!);
  return [...found].sort();
}

const isCode = (file: string): boolean => /\.(js|mjs|cjs|d\.ts)$/.test(file);
const isScanned = (file: string): boolean => isCode(file) || /\.(map|json)$/.test(file);

const packages = new Map<string, { directory: string; packed: Packed; manifest: Manifest; files: Map<string, string> }>();

beforeAll(() => {
  const stale = PUBLISHED.map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const).filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);
  for (const pkg of [...PUBLISHED, "iris-mcp-all"]) {
    const directory = path.join(REPO_ROOT, "packages", pkg);
    const packed = packList(directory);
    const files = new Map<string, string>();
    for (const entry of packed.files) {
      if (isScanned(entry.path)) files.set(entry.path, readFileSync(path.join(directory, entry.path), "utf8"));
    }
    packages.set(pkg, { directory, packed, manifest: JSON.parse(files.get("package.json") ?? "{}") as Manifest, files });
  }
}, 120_000);

describe.each([...PUBLISHED, "iris-mcp-all"])("what npm would publish of %s", (pkg) => {
  const get = () => packages.get(pkg)!;

  it("packs a manifest, and (for a package with a build) its dist and no test or source file", () => {
    const names = get().packed.files.map((entry) => entry.path);
    expect(names).toContain("package.json");
    if (WITH_DIST.has(pkg)) {
      expect(names.some((name) => name === "dist/index.js")).toBe(true);
      expect(names.filter((name) => /(^|\/)__tests__\//.test(name) || name.startsWith("src/") || name.startsWith("node_modules/"))).toEqual([]);
    }
  });

  it("names the v1 SDK in no packed code, declaration, source map or manifest", () => {
    const hits = [...get().files].filter(([, text]) => text.includes(SDK_V1)).map(([file]) => file);
    expect(hits).toEqual([]);
  });

  it("imports an MCP SDK module only from shared, and only the server package and its stdio entry", () => {
    const imported = new Set<string>();
    for (const [file, text] of get().files) {
      if (!isCode(file)) continue;
      for (const specifier of specifiersOf(text)) if (specifier.startsWith("@modelcontextprotocol/")) imported.add(specifier);
    }
    expect([...imported].sort()).toEqual(
      pkg === "shared" ? ["@modelcontextprotocol/server", "@modelcontextprotocol/server/stdio"] : [],
    );
  });

  it("lists an MCP SDK package only as shared's exact 2.3.1 runtime dependency and the test-only exact 2.3.1 client", () => {
    const { manifest } = get();
    const sdkEntries = (section: Record<string, string> | undefined): Array<[string, string]> =>
      Object.entries(section ?? {}).filter(([name]) => name.startsWith("@modelcontextprotocol/"));

    expect(sdkEntries(manifest.peerDependencies), "peerDependencies").toEqual([]);
    expect(sdkEntries(manifest.optionalDependencies), "optionalDependencies").toEqual([]);
    expect(sdkEntries(manifest.dependencies), "dependencies").toEqual(pkg === "shared" ? [["@modelcontextprotocol/server", "2.3.1"]] : []);
    for (const [name, version] of sdkEntries(manifest.devDependencies)) {
      expect([name, version], "devDependencies").toEqual(["@modelcontextprotocol/client", "2.3.1"]);
    }
  });
});
