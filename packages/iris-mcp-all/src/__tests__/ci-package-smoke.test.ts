/**
 * Story 42.3 (AC 42.3.3; DW-443) -- the pure helpers of `scripts/ci-package-smoke.mjs`, the check that the packages install and
 * start from their tarballs (the `package` job). The script itself packs 8 packages, runs `npm install` against the registry for
 * the third-party dependencies and starts 8 bins, so it is not part of the default suite: it is run once by hand (`## Verification`)
 * and by the `package` job. Here: which packages and bins it covers, the install manifest that keeps every `@iris-mcp/*` package
 * off the registry, the tool counts it expects (the committed snapshot's), and the lockfile check that proves the install used
 * the tarballs.
 *
 * Reads files and calls pure functions: nothing is packed, installed or started.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  binsOf,
  expectedToolCount,
  installManifest,
  lockfileProblems,
  publishablePackages,
  snapshotServers,
} from "../../../../scripts/ci-package-smoke.mjs";
import { PACKAGE_DIRS } from "../../../../scripts/lib/ci-checks.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";

const snapshot = JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", "iris-mcp-all", "src", "__tests__", "fixtures", "tools-list-snapshot.json"), "utf8")) as {
  servers: Record<string, Record<string, unknown>>;
};

const SERVERS = ["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"];

describe("the packages and bins the smoke covers", () => {
  const packages = publishablePackages() as Array<{ dir: string; name: string; manifest: Record<string, unknown> }>;

  it("is every non-private package under packages/, the 8 that CI registers", () => {
    expect(packages.map((pkg) => pkg.dir).sort()).toEqual([...PACKAGE_DIRS].sort());
    expect(packages.map((pkg) => pkg.name).sort()).toEqual([
      "@iris-mcp/admin",
      "@iris-mcp/all",
      "@iris-mcp/client-config",
      "@iris-mcp/data",
      "@iris-mcp/dev",
      "@iris-mcp/interop",
      "@iris-mcp/ops",
      "@iris-mcp/shared",
    ]);
    expect(packages.every((pkg) => pkg.manifest["private"] !== true)).toBe(true);
  });

  it("finds the 5 server bins and the 3 CLI bins, and no bin on the meta-package", () => {
    const bins = Object.fromEntries(packages.map((pkg) => [pkg.name, binsOf(pkg.manifest)]));

    expect(bins["@iris-mcp/dev"]).toEqual(["iris-dev-mcp"]);
    expect(bins["@iris-mcp/client-config"]).toEqual(["iris-mcp-clients"]);
    expect(bins["@iris-mcp/shared"]).toEqual(["iris-mcp-credentials", "iris-mcp-governance"]);
    expect(bins["@iris-mcp/all"]).toEqual([]);
    expect(Object.values(bins).flat().sort()).toEqual([...SERVERS, "iris-mcp-clients", "iris-mcp-credentials", "iris-mcp-governance"].sort());
  });

  it("reads a bin written as a string and a manifest with none", () => {
    expect(binsOf({ name: "@scope/tool", bin: "./dist/cli.js" })).toEqual(["tool"]);
    expect(binsOf({ name: "@scope/tool" })).toEqual([]);
    expect(binsOf({ name: "x", bin: { b: "./b.js", a: "./a.js" } })).toEqual(["a", "b"]);
  });
});

describe("the install manifest keeps every @iris-mcp package off the registry", () => {
  const tarballs = (publishablePackages() as Array<{ name: string }>).map((pkg) => ({ name: pkg.name, tarball: `/work/packs/${pkg.name.replace("@iris-mcp/", "iris-mcp-")}-1.0.0.tgz` }));

  it("resolves each package as a file: dependency and as an override, to the same tarball", () => {
    const manifest = installManifest(tarballs) as { private: boolean; dependencies: Record<string, string>; overrides: Record<string, string> };

    expect(manifest.private).toBe(true);
    expect(Object.keys(manifest.dependencies)).toHaveLength(8);
    expect(manifest.overrides).toEqual(manifest.dependencies);
    for (const { name, tarball } of tarballs) expect(manifest.dependencies[name]).toBe(`file:${tarball}`);
    expect(Object.values(manifest.dependencies).every((spec) => spec.startsWith("file:/"))).toBe(true);
    expect(Object.keys(manifest.dependencies)).toEqual([...Object.keys(manifest.dependencies)].sort());
  });

  it("is the same whatever order the tarballs come in", () => {
    expect(installManifest([...tarballs].reverse())).toEqual(installManifest(tarballs));
  });
});

describe("the tool counts the smoke expects", () => {
  it("are the committed tools-list snapshot's, 27, 8, 33, 25 and 22", () => {
    expect(snapshotServers()).toEqual(SERVERS);
    expect(Object.fromEntries(SERVERS.map((server) => [server, expectedToolCount(server)]))).toEqual({
      "iris-admin-mcp": 27,
      "iris-data-mcp": 8,
      "iris-dev-mcp": 33,
      "iris-interop-mcp": 25,
      "iris-ops-mcp": 22,
    });
    for (const server of SERVERS) expect(expectedToolCount(server), server).toBe(Object.keys(snapshot.servers[server] as object).length);
  });

  it("refuses a server the snapshot does not list", () => {
    expect(() => expectedToolCount("iris-new-mcp")).toThrow(/no server "iris-new-mcp"/);
  });
});

describe("the lockfile check that proves the install used the tarballs", () => {
  const names = ["@iris-mcp/shared", "@iris-mcp/dev"];
  const lock = (packages: Record<string, { resolved?: string }>) => ({ packages });

  it("passes when every @iris-mcp package is resolved from a local tarball", () => {
    expect(
      lockfileProblems(
        lock({
          "": {},
          "node_modules/@iris-mcp/shared": { resolved: "file:../packs/shared.tgz" },
          "node_modules/@iris-mcp/dev": { resolved: "file:../packs/dev.tgz" },
          "node_modules/zod": { resolved: "https://registry.npmjs.org/zod/-/zod-4.3.6.tgz" },
        }),
        names,
      ),
    ).toEqual([]);
  });

  it("names a package resolved from the registry, a package missing, and a package that is no package of this repository", () => {
    const problems = lockfileProblems(
      lock({
        "node_modules/@iris-mcp/shared": { resolved: "https://registry.npmjs.org/@iris-mcp/shared/-/shared-1.0.0.tgz" },
        "node_modules/@iris-mcp/stranger": { resolved: "file:../x.tgz" },
        "node_modules/@iris-mcp/dev/node_modules/@iris-mcp/other": { resolved: "file:../y.tgz" },
      }),
      names,
    );

    expect(problems).toEqual([
      '@iris-mcp/shared was resolved from "https://registry.npmjs.org/@iris-mcp/shared/-/shared-1.0.0.tgz", not from a local tarball.',
      "@iris-mcp/dev is not in the lockfile.",
      "@iris-mcp/stranger is in the lockfile but is no package of this repository.",
      "@iris-mcp/other is in the lockfile but is no package of this repository.",
    ]);
  });

  it("names a nested copy of a repository package that was resolved from the registry", () => {
    const problems = lockfileProblems(
      lock({
        "node_modules/@iris-mcp/shared": { resolved: "file:../packs/shared.tgz" },
        "node_modules/@iris-mcp/dev": { resolved: "file:../packs/dev.tgz" },
        "node_modules/@iris-mcp/dev/node_modules/@iris-mcp/shared": { resolved: "https://registry.npmjs.org/@iris-mcp/shared/-/shared-1.0.0.tgz" },
      }),
      names,
    );

    expect(problems).toEqual([
      '@iris-mcp/shared at node_modules/@iris-mcp/dev/node_modules/@iris-mcp/shared was resolved from "https://registry.npmjs.org/@iris-mcp/shared/-/shared-1.0.0.tgz", not from a local tarball.',
    ]);
  });

  it("treats a lockfile with no packages as missing every package", () => {
    expect(lockfileProblems({}, names)).toHaveLength(2);
  });
});
