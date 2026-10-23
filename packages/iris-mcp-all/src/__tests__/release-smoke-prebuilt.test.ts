/**
 * Story 42.5 (AC 42.5.2; DW-443; AD-29) -- `smokePackages({ tarballs })`, the branch of `scripts/ci-package-smoke.mjs` that `prepare`
 * takes: the smoke installs exactly the tarballs it is given and packs nothing. `release-prepare.test.ts` fakes the smoke; here the REAL
 * function runs, over a synthetic repository of eight packages (five servers, three CLIs) with the real `pnpm pack`, `npm install` and
 * `npx --no`, offline, on the pattern of `story-42-3-qa-package-smoke-runtime.test.ts` (the repository and the offline run are the
 * shared `smoke-repo-fixture.ts`).
 *
 *  - A package with no prebuilt tarball fails the smoke by name, and nothing is packed or installed.
 *  - With the tarballs that `pnpmPack` made (scripts ignored, as `prepare` packs them) the smoke exits 0, says that it used the prebuilt
 *    tarball of each of the eight packages, packs none itself, removes its temporary directories, and installs the files it was given:
 *    after the tarballs are made, the repository's `dist/` of one server is broken, and the smoke still passes.
 *  - The real `pnpm pack` names each tarball as `packedTarballName` (`scripts/release.mjs`) does, the name `publish` holds each npm entry
 *    of the manifest to.
 *
 * Everything is written under `os.tmpdir()` and removed by the test that made it. No network is used.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { pnpmPack } from "../../../../scripts/lib/pnpm-pack.mjs";
import { packedTarballName } from "../../../../scripts/release.mjs";
import { makeTempRoot, put, removeTempRoot } from "./pack-fixture";
import { cliSource, serverSource, smokeOffline, writeRepo, type PackageSpec, type PrebuiltTarball } from "./smoke-repo-fixture";

const SERVERS = ["admin", "data", "dev", "interop", "ops"];
const CLIS = ["clients", "credentials", "governance"];

/** Eight packages as the real repository has them: five servers that answer `tools/list`, and three CLIs that print their usage. */
const PACKAGES: PackageSpec[] = [
  ...SERVERS.map((short) => ({ dir: `iris-${short}-mcp`, name: `@iris-mcp/fake-${short}`, bin: `iris-fake-${short}-mcp`, source: serverSource(2, true) })),
  ...CLIS.map((short) => ({ dir: `iris-${short}-cli`, name: `@iris-mcp/fake-${short}`, bin: `iris-fake-${short}-cli`, source: cliSource(`Usage: iris-fake-${short}-cli [options]`, 0) })),
];
const SNAPSHOT = Object.fromEntries(SERVERS.map((short) => [`iris-fake-${short}-mcp`, 2]));

const roots: string[] = [];
let repo = "";
let tarballs: PrebuiltTarball[] = [];

/** A new empty directory of this file; removed after it. */
function scratch(prefix: string): string {
  const directory = makeTempRoot(prefix);
  roots.push(directory);
  return directory;
}

beforeAll(() => {
  repo = scratch("release-smoke-repo");
  writeRepo(repo, PACKAGES, SNAPSHOT);
  const work = scratch("release-smoke-packs");
  tarballs = PACKAGES.map((spec) => {
    const packed = pnpmPack(path.join(repo, "packages", spec.dir), path.join(work, spec.dir));
    return { name: spec.name, tarball: packed.tarball, manifest: packed.manifest, files: packed.files };
  });
  // From here on the repository no longer holds what the tarballs hold: a smoke that packed the repository again would fail on this.
  put(path.join(repo, "packages", PACKAGES[0]?.dir as string), "dist/bin.js", "throw new Error('the repository was packed again');\n");
}, 180_000);

afterAll(() => {
  for (const directory of roots.splice(0)) removeTempRoot(directory);
});

describe("smokePackages({ tarballs }) over a synthetic repository of eight packages (real pnpm pack, npm install and npx --no, offline)", () => {
  it("packed the eight packages, one tarball each, with scripts ignored", () => {
    expect(tarballs.map((entry) => entry.name)).toEqual(PACKAGES.map((spec) => spec.name));
    expect(tarballs.every((entry) => entry.tarball.endsWith(".tgz"))).toBe(true);
  });

  it("the real pnpm pack names each tarball as packedTarballName does, which publish holds every npm entry of the manifest to (DW-695)", () => {
    expect(tarballs.map((entry) => path.basename(entry.tarball))).toEqual(tarballs.map((entry) => packedTarballName(entry.manifest["name"], entry.manifest["version"])));
    expect(path.basename(tarballs[0]?.tarball as string)).toMatch(/^iris-mcp-fake-admin-\d+\.\d+\.\d+\.tgz$/);
  });

  it("with no prebuilt tarball it fails (exit 1) naming every package, and packs nothing and installs nothing", async () => {
    const { code, log, leftovers } = await smokeOffline(repo, scratch("release-smoke-tmp"), []);
    expect(code, log).toBe(1);
    for (const spec of PACKAGES) expect(log, spec.name).toContain(`${spec.name}: no prebuilt tarball was given for this package.`);
    expect(log).toContain("8 problem(s):");
    expect(log, "nothing is packed").not.toMatch(/ci-package-smoke: packed /);
    expect(log, "nothing is installed").not.toContain("installed");
    expect(leftovers, "the temporary directories are removed").toEqual([]);
  }, 60_000);

  it("a package that is missing from the list fails the smoke by name, while the seven others are used", async () => {
    const { code, log } = await smokeOffline(repo, scratch("release-smoke-tmp"), tarballs.filter((entry) => entry.name !== "@iris-mcp/fake-ops"));
    expect(code, log).toBe(1);
    expect(log).toContain("@iris-mcp/fake-ops: no prebuilt tarball was given for this package.");
    expect(log).toContain("1 problem(s):");
    expect(log).toContain("using the prebuilt tarball of @iris-mcp/fake-admin");
    expect(log).not.toContain("using the prebuilt tarball of @iris-mcp/fake-ops");
    expect(log, "nothing is installed").not.toContain("installed");
  }, 60_000);

  it("with the eight tarballs it exits 0, uses each prebuilt tarball, packs none, starts every bin and removes its temporary directories", async () => {
    const { code, log, leftovers } = await smokeOffline(repo, scratch("release-smoke-tmp"), tarballs);
    expect(code, log).toBe(0);
    for (const spec of PACKAGES) expect(log, spec.name).toContain(`ci-package-smoke: using the prebuilt tarball of ${spec.name}`);
    expect(log.match(/using the prebuilt tarball of /g), "one line per package").toHaveLength(8);
    expect(log, "no package was packed by the smoke").not.toMatch(/ci-package-smoke: packed /);
    expect(log).toContain("installed 8 tarballs");
    for (const short of SERVERS) expect(log).toContain(`iris-fake-${short}-mcp: initialize and tools/list (2 tools) ok`);
    for (const short of CLIS) expect(log).toContain(`iris-fake-${short}-cli: ok`);
    expect(log).toContain("8 packages installed from tarballs, 5 servers and their CLIs answered");
    expect(leftovers, "the temporary directories are removed").toEqual([]);
  }, 240_000);
});
