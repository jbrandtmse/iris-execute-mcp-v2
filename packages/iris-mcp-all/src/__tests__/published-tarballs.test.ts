/**
 * Story 42.1 (AC 42.1.3, AC 42.1.5; DW-506; Rule #59) - what publishing would actually put on the registry.
 *
 * Each of the eight packages is packed with `pnpm pack`, the packer that publishing goes through (only pnpm applies
 * `publishConfig` overrides such as `exports`, and rewrites `workspace:*`), into a temp directory, extracted there, and
 * read from disk. A sibling of `story-43-1-qa-pack-confinement.test.ts`, which asks `npm pack --dry-run` for the file list
 * and so cannot see `publishConfig`.
 *
 * Checked for every tarball:
 *  - every `main`, `types`, `bin` and `exports` target of the PACKED `package.json` is a file in the tarball;
 *  - `LICENSE` and `README.md` are present;
 *  - no `dist/test-helpers`, `__tests__` or source-map path, and no TypeScript source (only `.d.ts`) ships;
 *  - no vitest peer, no `workspace:` specifier, and `engines.node` equals the root floor;
 *  - the five servers carry `mcpName`.
 * For `@iris-mcp/shared` the packed `exports` holds only `"."`, so no in-repo test helper is advertised (DW-506).
 *
 * The build must be fresh: a missing or stale `dist/` FAILS this test, it never skips (a skipped tarball check is a
 * green badge over an unchecked tarball). Everything is written under `os.tmpdir()` and removed in `afterAll`.
 *
 * The control tests at the end run the problem finder against synthetic tarballs, so the finder itself is proven able to fail.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempRoot, pnpmPack, type PnpmPack, REPO_ROOT, removeTempRoot } from "./pack-fixture";
import { staleDistReason } from "./process-gate-helpers.js";

interface PackedManifest {
  name?: string;
  version?: string;
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: unknown;
  engines?: { node?: string };
  mcpName?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, unknown>;
  optionalDependencies?: Record<string, string>;
  publishConfig?: unknown;
}

const PACKAGE_DIRS = readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(REPO_ROOT, "packages", entry.name, "package.json")))
  .map((entry) => entry.name)
  .sort();
const BUILT_DIRS = PACKAGE_DIRS.filter((dir) => existsSync(join(REPO_ROOT, "packages", dir, "tsconfig.json")));
const SERVER_BINS = new Set(["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"]);
const ROOT_FLOOR = (JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { engines: { node: string } }).engines.node;

/** Every file path a packed manifest points at: `main`, `types`, each `bin` and each leaf string of `exports`. */
function manifestTargets(manifest: PackedManifest): string[] {
  const targets: string[] = [];
  if (manifest.main !== undefined) targets.push(manifest.main);
  if (manifest.types !== undefined) targets.push(manifest.types);
  for (const target of Object.values(manifest.bin ?? {})) targets.push(target);
  const walk = (value: unknown): void => {
    if (typeof value === "string") targets.push(value);
    else if (value !== null && typeof value === "object") for (const inner of Object.values(value)) walk(inner);
  };
  walk(manifest.exports);
  return targets;
}

/** Everything wrong with one packed package, each message naming the package and the offending path or field. */
function tarballProblems(manifest: PackedManifest, files: readonly string[]): string[] {
  const name = manifest.name ?? "<unnamed>";
  const present = new Set(files);
  const problems: string[] = [];
  for (const target of manifestTargets(manifest)) {
    if (!present.has(target.replace(/^\.\//, ""))) problems.push(`${name}: manifest target ${target} is not in the tarball`);
  }
  // `pnpm pack` copies the workspace root's LICENSE into a package that has none, so on this path the LICENSE row holds
  // while the root file exists; the per-package copy is pinned by package-manifests.test.ts (a byte copy of the root).
  for (const required of ["LICENSE", "README.md", "package.json"]) {
    if (!present.has(required)) problems.push(`${name}: ${required} is missing from the tarball`);
  }
  for (const file of files) {
    if (/(^|\/)dist\/test-helpers(\/|$)/.test(file)) problems.push(`${name}: ${file} ships a test helper`);
    if (/(^|\/)__tests__(\/|$)/.test(file)) problems.push(`${name}: ${file} ships a test`);
    if (/\.map$/.test(file)) problems.push(`${name}: ${file} is a source map`);
    if (/\.(ts|mts|cts)$/.test(file) && !/\.d\.(ts|mts|cts)$/.test(file)) problems.push(`${name}: ${file} is TypeScript source`);
  }
  if (manifest.peerDependencies?.["vitest"] !== undefined || manifest.peerDependenciesMeta?.["vitest"] !== undefined) {
    problems.push(`${name}: the manifest still declares a vitest peer`);
  }
  for (const section of [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies, manifest.peerDependencies]) {
    for (const [dependency, specifier] of Object.entries(section ?? {})) {
      if (specifier.startsWith("workspace:")) problems.push(`${name}: ${dependency} is still ${specifier} (not rewritten for publishing)`);
    }
  }
  if (manifest.engines?.node !== ROOT_FLOOR) problems.push(`${name}: engines.node is ${String(manifest.engines?.node)}, expected ${ROOT_FLOOR}`);
  const serverBin = Object.keys(manifest.bin ?? {}).find((bin) => SERVER_BINS.has(bin));
  if (serverBin !== undefined && manifest.mcpName !== `io.github.jbrandtmse/${serverBin}`) {
    problems.push(`${name}: mcpName is ${String(manifest.mcpName)}, expected io.github.jbrandtmse/${serverBin}`);
  }
  return problems;
}

let work = "";
const packs = new Map<string, PnpmPack>();

beforeAll(() => {
  const stale = BUILT_DIRS.map((dir) => [dir, staleDistReason(REPO_ROOT, dir)] as const).filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) {
    throw new Error(`Build the packages first (pnpm --filter "./packages/*" build): ${stale.map(([dir, reason]) => `${dir}: ${reason}`).join("; ")}`);
  }
  work = makeTempRoot("published-tarballs");
  for (const dir of PACKAGE_DIRS) {
    const destination = join(work, dir);
    // pnpm creates the destination itself when it is missing; the extraction directory is made inside it.
    packs.set(dir, pnpmPack(join(REPO_ROOT, "packages", dir), destination));
  }
}, 240_000);

afterAll(() => {
  if (work !== "") removeTempRoot(work);
});

describe("the eight packed tarballs", () => {
  it("covers every package directory", () => {
    expect(PACKAGE_DIRS).toHaveLength(8);
    expect([...packs.keys()]).toEqual(PACKAGE_DIRS);
  });

  it.each(PACKAGE_DIRS)("%s: no problem is found in its tarball", (dir) => {
    const pack = packs.get(dir) as PnpmPack;
    expect(tarballProblems(pack.manifest as PackedManifest, pack.files)).toEqual([]);
  });

  it.each(PACKAGE_DIRS)("%s: the packed manifest keeps its version and drops publishConfig", (dir) => {
    const pack = packs.get(dir) as PnpmPack;
    const source = JSON.parse(readFileSync(join(REPO_ROOT, "packages", dir, "package.json"), "utf8")) as PackedManifest;
    expect((pack.manifest as PackedManifest).version).toBe(source.version);
    expect((pack.manifest as PackedManifest).publishConfig).toBeUndefined();
  });

  it("the five servers carry mcpName and the others do not", () => {
    const named = PACKAGE_DIRS.filter((dir) => (packs.get(dir)?.manifest as PackedManifest).mcpName !== undefined);
    expect(named).toEqual(["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"]);
  });
});

describe("@iris-mcp/shared (AC 42.1.3, DW-506)", () => {
  const shared = (): PnpmPack => packs.get("shared") as PnpmPack;

  it("advertises only its root export once packed", () => {
    expect(Object.keys((shared().manifest as PackedManifest).exports as Record<string, unknown>)).toEqual(["."]);
  });

  it("ships no test helper, test, source map or source file", () => {
    const stray = shared().files.filter(
      (file) => /test-helpers|__tests__|\.map$/.test(file) || file.startsWith("src/") || (/\.ts$/.test(file) && !/\.d\.ts$/.test(file)),
    );
    expect(stray).toEqual([]);
  });

  it("keeps the source manifest's test-helper exports for the in-repo imports", () => {
    const source = JSON.parse(readFileSync(join(REPO_ROOT, "packages/shared/package.json"), "utf8")) as PackedManifest;
    expect(Object.keys(source.exports as Record<string, unknown>)).toEqual([
      ".",
      "./test-helpers",
      "./test-helpers/integration-config",
      "./test-helpers/live-target",
      "./test-helpers/storage-guard-fixtures",
    ]);
  });
});

describe("the problem finder can fail (Rule #59 controls)", () => {
  const GOOD: PackedManifest = {
    name: "@iris-mcp/demo",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    bin: { "iris-dev-mcp": "./dist/index.js" },
    mcpName: "io.github.jbrandtmse/iris-dev-mcp",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    engines: { node: ROOT_FLOOR },
  };
  const GOOD_FILES = ["LICENSE", "README.md", "package.json", "dist/index.js", "dist/index.d.ts"];

  it("accepts a clean tarball", () => {
    expect(tarballProblems(GOOD, GOOD_FILES)).toEqual([]);
  });

  it("names a manifest target that the tarball lacks", () => {
    expect(tarballProblems(GOOD, GOOD_FILES.filter((file) => file !== "dist/index.d.ts"))).toEqual([
      "@iris-mcp/demo: manifest target ./dist/index.d.ts is not in the tarball",
      "@iris-mcp/demo: manifest target ./dist/index.d.ts is not in the tarball",
    ]);
  });

  it("names an export that points at unshipped source", () => {
    const exports = { ...(GOOD.exports as object), "./test-helpers": { import: "./src/__tests__/test-helpers.ts" } };
    expect(tarballProblems({ ...GOOD, exports }, GOOD_FILES)).toEqual([
      "@iris-mcp/demo: manifest target ./src/__tests__/test-helpers.ts is not in the tarball",
    ]);
  });

  it("names a shipped test helper, test, source map and source file", () => {
    const files = [...GOOD_FILES, "dist/test-helpers/integration-config.js", "dist/__tests__/a.test.js", "dist/index.js.map", "src/index.ts"];
    expect(tarballProblems(GOOD, files)).toEqual([
      "@iris-mcp/demo: dist/test-helpers/integration-config.js ships a test helper",
      "@iris-mcp/demo: dist/__tests__/a.test.js ships a test",
      "@iris-mcp/demo: dist/index.js.map is a source map",
      "@iris-mcp/demo: src/index.ts is TypeScript source",
    ]);
  });

  it("names a missing LICENSE, a vitest peer, an unrewritten workspace specifier, a wrong floor and a wrong mcpName", () => {
    const manifest: PackedManifest = {
      ...GOOD,
      peerDependencies: { vitest: ">=2.0.0" },
      dependencies: { "@iris-mcp/shared": "workspace:*" },
      engines: { node: ">=18.0.0" },
      mcpName: "io.github.someone/iris-dev-mcp",
    };
    expect(tarballProblems(manifest, GOOD_FILES.filter((file) => file !== "LICENSE"))).toEqual([
      "@iris-mcp/demo: LICENSE is missing from the tarball",
      "@iris-mcp/demo: the manifest still declares a vitest peer",
      "@iris-mcp/demo: @iris-mcp/shared is still workspace:* (not rewritten for publishing)",
      `@iris-mcp/demo: engines.node is >=18.0.0, expected ${ROOT_FLOOR}`,
      "@iris-mcp/demo: mcpName is io.github.someone/iris-dev-mcp, expected io.github.jbrandtmse/iris-dev-mcp",
    ]);
  });
});
