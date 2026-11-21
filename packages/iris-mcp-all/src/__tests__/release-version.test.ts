/**
 * Story 42.5 (AD-14, AD-29) -- the version step: `pnpm run version [-- --first-release]` (`scripts/release-version.mjs`) runs the
 * repository's REAL `changeset version` and then the REAL bootstrap generator, in a throwaway git fixture under `os.tmpdir()`. The real
 * tree is never versioned, and nothing is committed, tagged or published.
 *
 * The fixture (`release-fixture.ts`) owns its state: all eight manifests at one seeded version, one synthetic `patch` changeset, and the
 * embed and `ipm/module.xml` generated for that version, committed in a git repository of its own so that the script sees a clean tree.
 * What a test expects is fixed by that seed and by the template (a first release lands on 1.0.0; a patch on 0.0.2 gives 0.0.3 and on
 * 1.0.0 gives 1.0.1), never by the real packages. Expected marker values come from running the generator on the fixture (Rule #36): the
 * sequence and hash that the marker keeps are the ones the generator prints before and after, and the printed `BOOTSTRAP_VERSION` move is
 * compared with those two runs. The documented command line is driven through the real `pnpm run version -- --first-release`, which
 * hands the script a leading `--`.
 */

import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, removeLink } from "./pack-fixture";
import { FIXTURE_GIT_ENV, PACKAGE_DIRS, SYNTHETIC_CHANGESET, commitFixture, fixtureStatus, fixtureTreeHash, makeVersionFixture, manifestOf, pendingChangesets, removeFixtures } from "./release-fixture";
import { embeddedVersionProblems, readReleaseFacts } from "../../../../scripts/release.mjs";
import { main as versionMain } from "../../../../scripts/release-version.mjs";
import { versionProblems } from "../../../../scripts/lib/release-core.mjs";

afterAll(removeFixtures);

/**
 * The environment of a script run: PATH and HOME only, so that no ambient `npm_command` or token reaches it, and the fixture's git
 * isolation, so that the script's own `git status` never reads the developer's git configuration.
 */
const cleanEnv = (extra: Record<string, string> = {}): Record<string, string> => ({ PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...FIXTURE_GIT_ENV, ...extra });

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run a script of the fixture with the running Node and return its exit code and output. */
function run(root: string, script: string, args: string[] = [], env: Record<string, string> = cleanEnv()): Run {
  const result = spawnSync(process.execPath, [join(root, "scripts", script), ...args], { cwd: root, env, encoding: "utf8", timeout: 180_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Run `pnpm <args>` in the fixture, as a person at a shell does. */
function runPnpm(root: string, args: string[]): Run {
  const result = spawnSync("pnpm", args, { cwd: root, env: cleanEnv(), encoding: "utf8", timeout: 180_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** The marker `BOOTSTRAP_VERSION: <marker>` that an unchanged generator run on the fixture prints. */
function generatorMarker(root: string): string {
  const generated = run(root, "gen-bootstrap.mjs");
  expect(generated.status, generated.stderr).toBe(0);
  return /BOOTSTRAP_VERSION: (\S+)/.exec(generated.stdout)?.[1] as string;
}

/** The stamped `Parameter BOOTSTRAPVERSION` lines of the embed. */
const stamps = (root: string): string[] => [...readFileSync(join(root, "packages/shared/src/bootstrap-classes.ts"), "utf8").matchAll(/Parameter BOOTSTRAPVERSION = "([^"]+)";/g)].map((match) => match[1] as string);

/** Every manifest of the fixture is at `version`, and the marker, the two stamps and `ipm/module.xml` carry it with the sequence and hash of `before`. */
function expectVersioned(root: string, version: string, before: string): string {
  for (const dir of PACKAGE_DIRS) expect(manifestOf(root, dir).version, dir).toBe(version);
  const after = generatorMarker(root);
  expect(after.split("+")[0], "the marker carries the new semver").toBe(version);
  expect(after.split("+")[1], "the sequence and hash are the ones from before").toBe(before.split("+")[1]);
  expect(stamps(root), "the marker is stamped into the embedded Setup and the embedded install guard").toEqual([after, after]);
  expect(readFileSync(join(root, "ipm/module.xml"), "utf8")).toContain(`<Version>${version}</Version>`);
  const facts = readReleaseFacts(root);
  expect(versionProblems({ versions: facts.packages.map((entry: { name: string; version: string }) => ({ name: entry.name, version: entry.version })), pending: facts.pending }, "dry-run")).toEqual([]);
  expect(embeddedVersionProblems(facts)).toEqual([]);
  expectExtensionVersioned(root, version);
  return after;
}

/** The extension follows the shared version: its manifest, both version fields of its lock (and no other field of the lock), and its changelog heading. */
function expectExtensionVersioned(root: string, version: string, date: RegExp | string = /\d{4}-\d{2}-\d{2}/): void {
  const extension = join(root, "extensions", "iris-mcp-launcher");
  expect((JSON.parse(readFileSync(join(extension, "package.json"), "utf8")) as { version: string }).version, "the extension manifest").toBe(version);
  const lock = JSON.parse(readFileSync(join(extension, "package-lock.json"), "utf8")) as { version: string; packages: Record<string, { version: string }> };
  expect(lock.version, "the lock's own version").toBe(version);
  expect(lock.packages[""]?.version, "the lock's root package").toBe(version);
  expect(lock.packages["node_modules/typescript"]?.version, "a dependency of the lock is left alone").toBe("5.9.3");
  const headings = readFileSync(join(extension, "CHANGELOG.md"), "utf8").split("\n").filter((line) => line.startsWith("## "));
  expect(headings[0], "the first heading is renamed").toMatch(new RegExp(`^## \\[${version.replaceAll(".", "\\.")}\\] \\u2014 ${typeof date === "string" ? date : date.source}$`));
  expect(headings.slice(1), "the older heading is untouched").toEqual(["## [0.1.0] \u2014 2026-01-01"]);
}

describe("pnpm run version -- --first-release in a throwaway fixture (AD-14)", () => {
  it("lands all eight packages on 1.0.0; the marker, the two stamped parameters and ipm/module.xml carry it; the sequence and hash are unchanged; the move literal is the generator's", () => {
    const root = makeVersionFixture();
    const before = generatorMarker(root);
    const sequenceState = readFileSync(join(root, "scripts/bootstrap-sequence.json"), "utf8");
    expect(before).toMatch(/^0\.0\.2\+\d+\.[0-9a-f]{12}$/);
    expect(fixtureStatus(root), "the fixture starts clean, and an unchanged generator run leaves it clean").toBe("");

    const result = run(root, "release-version.mjs", ["--first-release"]);
    expect(result.status, result.stderr).toBe(0);

    const after = expectVersioned(root, "1.0.0", before);
    expect(readFileSync(join(root, "scripts/bootstrap-sequence.json"), "utf8"), "the state file is byte-identical: a semver-only change keeps the sequence").toBe(sequenceState);
    expect(result.stderr).toContain(`version: \`BOOTSTRAP_VERSION\` moves from \`${before}\` to \`${after}\``);
    expect(result.stderr).toContain("all 8 packages are at 1.0.0; ipm/module.xml and the embed carry it.");
    expect(result.stderr).toContain("next steps: write the root CHANGELOG section for this release, naming the BOOTSTRAP_VERSION move above;");
    expect(result.stderr).toContain("then tag it v1.0.0, push the tag, and approve the run in the release environment.");

    expect(pendingChangesets(join(root, ".changeset")), "the synthetic changeset and the copied template are consumed").toEqual([]);
    for (const dir of PACKAGE_DIRS) {
      const headings = readFileSync(join(root, "packages", dir, "CHANGELOG.md"), "utf8").split("\n").filter((line) => line.startsWith("## "));
      expect(headings[0], `${dir}: first changelog section`).toBe("## 1.0.0");
    }
    expect(fixtureStatus(root), "the run left changes to commit, and nothing committed").not.toBe("");
  }, 180_000);

  it("the documented command, the real `pnpm run version -- --first-release`, reaches the script as [--, --first-release] and lands all eight packages on 1.0.0", () => {
    const root = makeVersionFixture();
    const before = generatorMarker(root);
    const result = runPnpm(root, ["run", "version", "--", "--first-release"]);
    expect(result.status, `${result.stderr}${result.stdout}`).toBe(0);
    expect(result.stderr).not.toContain("unknown argument");
    expectVersioned(root, "1.0.0", before);
  }, 180_000);

  it("the script drops one leading `--`: [--, --first-release] versions the first release, and [--] alone versions the pending changeset", () => {
    const first = makeVersionFixture();
    const result = run(first, "release-version.mjs", ["--", "--first-release"]);
    expect(result.status, result.stderr).toBe(0);
    for (const dir of PACKAGE_DIRS) expect(manifestOf(first, dir).version, dir).toBe("1.0.0");

    const bare = makeVersionFixture();
    expect(run(bare, "release-version.mjs", ["--"]).status).toBe(0);
    for (const dir of PACKAGE_DIRS) expect(manifestOf(bare, dir).version, dir).toBe("0.0.3");
  }, 180_000);

  it("a first release needs no pending changeset of its own: the template is the changeset", () => {
    const root = makeVersionFixture({ pending: false });
    expect(pendingChangesets(join(root, ".changeset"))).toEqual([]);
    const result = run(root, "release-version.mjs", ["--first-release"]);
    expect(result.status, result.stderr).toBe(0);
    for (const dir of PACKAGE_DIRS) expect(manifestOf(root, dir).version, dir).toBe("1.0.0");
  }, 180_000);
});

describe("pnpm run version without --first-release versions the pending changeset and regenerates the embed", () => {
  it("every package moves from 0.0.2 to one shared version, 0.0.3 (never 1.0.0), and the marker, the stamps and ipm/module.xml carry it", () => {
    const root = makeVersionFixture();
    const before = generatorMarker(root);
    const result = run(root, "release-version.mjs");
    expect(result.status, result.stderr).toBe(0);
    const after = expectVersioned(root, "0.0.3", before);
    expect(result.stderr).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${before}\` to \`${after}\``);
    expect(pendingChangesets(join(root, ".changeset"))).toEqual([]);
  }, 180_000);
});

describe("pnpm run version after the first release (the packages are at 1.0.0)", () => {
  it("a patch changeset moves every package to 1.0.1, and the marker, the stamps and ipm/module.xml carry it", () => {
    const root = makeVersionFixture({ version: "1.0.0" });
    const before = generatorMarker(root);
    expect(before).toMatch(/^1\.0\.0\+/);
    const result = run(root, "release-version.mjs");
    expect(result.status, result.stderr).toBe(0);
    const after = expectVersioned(root, "1.0.1", before);
    expect(result.stderr).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${before}\` to \`${after}\``);
  }, 180_000);

  it("--first-release is refused (exit 2) naming the packages already at 1.0.0, and nothing changes", () => {
    const root = makeVersionFixture({ version: "1.0.0" });
    const hash = fixtureTreeHash(root);
    const result = run(root, "release-version.mjs", ["--first-release"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--first-release applies once, and @iris-mcp/client-config@1.0.0");
    expect(result.stderr).toContain("is already at 1.0.0 or later. Run pnpm run version without it.");
    expect(fixtureTreeHash(root)).toBe(hash);
    expect(existsSync(join(root, ".changeset", "release-1-0-0.md"))).toBe(false);
  });
});

describe("pnpm run version refuses, with the files unchanged", () => {
  it("as the `npm version` lifecycle hook (npm_command=version): exit 2, saying to use pnpm run version", () => {
    const root = makeVersionFixture();
    const hash = fixtureTreeHash(root);
    const result = run(root, "release-version.mjs", ["--first-release"], cleanEnv({ npm_command: "version" }));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("this script ran as the npm version lifecycle hook. Run pnpm run version instead; pnpm version hands over to npm version.");
    expect(result.stderr, "npm bumps package.json before it runs the hook").toContain("npm version has already changed the version in package.json: restore it with git checkout -- package.json first.");
    expect(fixtureTreeHash(root)).toBe(hash);
    expect(fixtureStatus(root)).toBe("");
  });

  it("with --first-release and the template missing: exit 2 naming the template", () => {
    const root = makeVersionFixture({ withTemplate: false });
    const hash = fixtureTreeHash(root);
    const result = run(root, "release-version.mjs", ["--first-release"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("scripts/release/changeset-1.0.0.md is missing. Restore it from git; it names all eight packages as major.");
    expect(fixtureTreeHash(root)).toBe(hash);
  });

  it("on a dirty tree: exit 2 naming the changed file, and nothing is versioned", () => {
    const root = makeVersionFixture();
    const pending = pendingChangesets(join(root, ".changeset"));
    expect(pending, "the fixture has its synthetic changeset pending").toEqual([SYNTHETIC_CHANGESET]);
    appendFileSync(join(root, "ipm", "module.xml"), "\n");
    const manifests = PACKAGE_DIRS.map((dir) => readFileSync(join(root, "packages", dir, "package.json"), "utf8"));
    const result = run(root, "release-version.mjs");
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/the tree is not clean \(M ipm\/module\.xml\)\. Commit or stash the changes, then run it again\./);
    expect(PACKAGE_DIRS.map((dir) => readFileSync(join(root, "packages", dir, "package.json"), "utf8"))).toEqual(manifests);
    expect(pendingChangesets(join(root, ".changeset")), "the pending changesets are still there").toEqual(pending);
  });

  it("an untracked file also makes the tree dirty", () => {
    const root = makeVersionFixture();
    writeFileSync(join(root, "stray.txt"), "x");
    expect(run(root, "release-version.mjs").status).toBe(2);
  });

  it("--first-release when one package is already at 1.0.0: exit 2, and nothing changes", () => {
    const root = makeVersionFixture();
    const file = join(root, "packages", "shared", "package.json");
    writeFileSync(file, readFileSync(file, "utf8").replace(/"version": "[^"]+"/, '"version": "1.0.0"'));
    commitFixture(root, "released");
    const hash = fixtureTreeHash(root);
    const result = run(root, "release-version.mjs", ["--first-release"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--first-release applies once, and @iris-mcp/shared@1.0.0 is already at 1.0.0 or later");
    expect(fixtureTreeHash(root)).toBe(hash);
  });

  it("with no changeset pending and no --first-release: exit 2 before it changes anything, and no next steps are printed", () => {
    const root = makeVersionFixture({ pending: false });
    const hash = fixtureTreeHash(root);
    const result = run(root, "release-version.mjs");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no changeset is pending. Add one with pnpm changeset, or use --first-release for the first release.");
    expect(result.stderr).not.toContain("next steps");
    expect(fixtureTreeHash(root)).toBe(hash);
    expect(fixtureStatus(root)).toBe("");
  });

  it("any other argument: exit 2 with the usage (a second `--` is one)", () => {
    const root = makeVersionFixture();
    for (const args of [["--major"], ["--first-release", "--first-release"], ["x"], ["--", "--"], ["--", "--", "--first-release"], ["--", "x"], ["--", "--first-release", "--first-release"]]) {
      const result = run(root, "release-version.mjs", args);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.stderr, args.join(" ")).toContain("Use: pnpm run version [-- --first-release]");
    }
    expect(fixtureStatus(root)).toBe("");
  });

  it("a root that is not a git checkout is a refusal", () => {
    const root = makeVersionFixture();
    renameSync(join(root, ".git"), join(root, ".git-moved"));
    const result = run(root, "release-version.mjs");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("git status failed");
  });
});

describe("--first-release leaves no copy of the template behind when the version step does not run", () => {
  it("without node_modules/@changesets/cli it refuses (exit 2) before the copy: no .changeset/release-1-0-0.md, a clean tree", () => {
    const root = makeVersionFixture();
    removeLink(join(root, "node_modules"));
    commitFixture(root, "a checkout with no installed dependencies");
    expect(fixtureStatus(root)).toBe("");
    const hash = fixtureTreeHash(root);
    const result = run(root, "release-version.mjs", ["--first-release"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("node_modules/@changesets/cli is not installed. Run pnpm install, then run it again.");
    expect(existsSync(join(root, ".changeset", "release-1-0-0.md"))).toBe(false);
    expect(fixtureStatus(root)).toBe("");
    expect(fixtureTreeHash(root)).toBe(hash);
  });

  it("when `changeset version` itself fails (exit 1), the copied template is removed again and the tree is clean", () => {
    const root = makeVersionFixture();
    writeFileSync(join(root, ".changeset", "names-no-package.md"), '---\n"@iris-mcp/not-a-package": patch\n---\n\nA change to a package that does not exist.\n');
    commitFixture(root, "a changeset that changeset version rejects");
    expect(fixtureStatus(root)).toBe("");
    const result = run(root, "release-version.mjs", ["--first-release"]);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("copied scripts/release/changeset-1.0.0.md to .changeset/release-1-0-0.md");
    expect(result.stderr).toContain("changeset version failed (exit ");
    expect(existsSync(join(root, ".changeset", "release-1-0-0.md")), "the copy is removed").toBe(false);
    expect(fixtureStatus(root), "the tree is as it was").toBe("");
    expect(result.stderr, "a clean tree holds no partial version to discard").not.toContain("partial version");
  }, 180_000);
});

describe("pnpm run version exits 1 naming what it finds wrong after a step (I/O matrix, version step: mixed or prerelease versions) (QA)", () => {
  it("prerelease mode (.changeset/pre.json): every package lands on a prerelease version, and the script exits 1 naming each one, before it runs the generator", () => {
    const root = makeVersionFixture();
    const before = generatorMarker(root);
    const initialVersions = Object.fromEntries(PACKAGE_DIRS.map((dir) => [manifestOf(root, dir).name, manifestOf(root, dir).version]));
    writeFileSync(join(root, ".changeset", "pre.json"), `${JSON.stringify({ mode: "pre", tag: "next", initialVersions, changesets: [] }, null, 2)}\n`);
    commitFixture(root, "prerelease mode");
    const result = run(root, "release-version.mjs");
    expect(result.status, result.stderr).toBe(1);
    for (const dir of PACKAGE_DIRS) {
      expect(manifestOf(root, dir).version, `${dir}: changeset version put a prerelease on it`).toBe("0.0.3-next.0");
      expect(result.stderr, dir).toContain(`${manifestOf(root, dir).name} is at "0.0.3-next.0", which is not a plain MAJOR.MINOR.PATCH version`);
    }
    expect(result.stderr).not.toContain("next steps");
    expect(stamps(root), "the generator did not run on a prerelease: the embed still carries the marker from before").toEqual([before, before]);
  }, 180_000);

  it("packages that do not move together (a fixed group that is gone): exit 1 naming every package and version, before it runs the generator", () => {
    const root = makeVersionFixture();
    const before = generatorMarker(root);
    const config = join(root, ".changeset", "config.json");
    writeFileSync(config, readFileSync(config, "utf8").replace('"fixed": [["@iris-mcp/*"]]', '"fixed": []'));
    expect(readFileSync(config, "utf8"), "the fixture's changeset config lost its fixed group").toContain('"fixed": []');
    commitFixture(root, "no fixed group");
    const result = run(root, "release-version.mjs");
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("the packages are not at one shared version (@iris-mcp/client-config@0.0.2, @iris-mcp/shared@0.0.3,");
    expect(result.stderr).toContain("Run pnpm run version so that the fixed group moves them together.");
    expect(result.stderr, "a second run would refuse the dirty tree, so it says how to discard the partial version first").toContain("the tree now holds a partial version: discard it with git restore . && git clean -fd");
    expect(result.stderr).not.toContain("next steps");
    expect(stamps(root), "the generator did not run on mixed versions").toEqual([before, before]);
  }, 180_000);

  it("a generator that fails (exit 3): exit 1 naming the step and carrying the generator's own message, with no next steps", () => {
    const root = makeVersionFixture();
    writeFileSync(join(root, "scripts", "gen-bootstrap.mjs"), "process.stderr.write('generator exploded\\n');\nprocess.exit(3);\n");
    commitFixture(root, "a generator that fails");
    const result = run(root, "release-version.mjs");
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("generator exploded");
    expect(result.stderr).toContain("version: gen-bootstrap failed (exit 3). Fix the generator error.");
    expect(result.stderr, "changeset version already moved the packages, so a second run would refuse the dirty tree").toContain("the tree now holds a partial version: discard it with git restore . && git clean -fd");
    expect(result.stderr).not.toContain("next steps");
  }, 180_000);

  it("a generator that exits 0 but stamps nothing: exit 1 naming the marker and ipm/module.xml, with the partial-version line and no next steps", () => {
    const root = makeVersionFixture();
    const before = generatorMarker(root);
    writeFileSync(join(root, "scripts", "gen-bootstrap.mjs"), "process.exit(0);\n");
    commitFixture(root, "a generator that writes nothing");
    const result = run(root, "release-version.mjs");
    expect(result.status, result.stderr).toBe(1);
    for (const dir of PACKAGE_DIRS) expect(manifestOf(root, dir).version, dir).toBe("0.0.3");
    expect(result.stderr).toContain(`problem: BOOTSTRAP_VERSION is "${before}", whose semver is not the shared version 0.0.3.`);
    expect(result.stderr).toContain('problem: ipm/module.xml is at "0.0.2", not the shared version 0.0.3.');
    expect(result.stderr).toContain("the tree now holds a partial version: discard it with git restore . && git clean -fd");
    expect(result.stderr).not.toContain("next steps");
    expect(result.stderr).not.toContain("the embed carry it");
  }, 180_000);
});

/** The plugin manifest, the marketplace ref and the five server.json files of a fixture, as the version step regenerates them. */
function listingVersions(root: string): { plugin: string; ref: string; servers: Array<{ file: string; version: string; packageVersion: string }> } {
  const json = (relative: string): any => JSON.parse(readFileSync(join(root, relative), "utf8"));
  return {
    plugin: json("packages/client-config/skills-pack/.claude-plugin/plugin.json").version,
    ref: json(".claude-plugin/marketplace.json").plugins[0].source.ref,
    servers: ["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"].map((dir) => {
      const listing = json(`packages/${dir}/server.json`);
      return { file: `packages/${dir}/server.json`, version: listing.version, packageVersion: listing.packages[0].version };
    }),
  };
}

describe("the plugin and the registry listings follow the shared version (Story 42.8, lockstep: decision #103)", () => {
  it("the fixture starts with every listing at its seeded version", () => {
    const root = makeVersionFixture({ version: "1.0.0" });
    const before = listingVersions(root);
    expect(before.plugin).toBe("1.0.0");
    expect(before.ref).toBe("v1.0.0");
    for (const server of before.servers) expect([server.version, server.packageVersion], server.file).toEqual(["1.0.0", "1.0.0"]);
  }, 180_000);

  it("a patch changeset regenerates plugin.json's version, the marketplace ref (v<version>) and the five server.json files, and nothing is left for embeddedVersionProblems", async () => {
    const root = makeVersionFixture({ version: "1.0.0" });
    expect(await versionMain([], cleanEnv(), root, () => new Date("2026-11-20T23:59:59Z"))).toBe(0);
    const after = listingVersions(root);
    expect(after.plugin).toBe("1.0.1");
    expect(after.ref).toBe("v1.0.1");
    for (const server of after.servers) expect([server.version, server.packageVersion], server.file).toEqual(["1.0.1", "1.0.1"]);
    expect(embeddedVersionProblems(readReleaseFacts(root))).toEqual([]);
    expect(fixtureStatus(root)).toContain(".claude-plugin/marketplace.json");
    expect(fixtureStatus(root)).toContain("packages/client-config/skills-pack/.claude-plugin/plugin.json");
  }, 180_000);

  it("the script run as a process names the listings in its next steps", () => {
    const root = makeVersionFixture({ version: "1.0.0" });
    const result = run(root, "release-version.mjs");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("the plugin manifest (packages/client-config/skills-pack/.claude-plugin/plugin.json), the marketplace ref (.claude-plugin/marketplace.json) and the five server.json files carry it too;");
  }, 180_000);

  it("a first release puts the listings at 1.0.0", () => {
    const root = makeVersionFixture();
    expect(run(root, "release-version.mjs", ["--first-release"]).status).toBe(0);
    const after = listingVersions(root);
    expect([after.plugin, after.ref]).toEqual(["1.0.0", "v1.0.0"]);
    expect(after.servers.map((server) => server.version)).toEqual(["1.0.0", "1.0.0", "1.0.0", "1.0.0", "1.0.0"]);
  }, 180_000);

  it("a generator that fails stops the step: exit 1 naming the script, with the partial-version line", () => {
    const root = makeVersionFixture({ version: "1.0.0" });
    writeFileSync(join(root, "scripts", "gen-listings.mjs"), "process.exit(3);\n");
    commitFixture(root, "a listings generator that fails");
    const result = run(root, "release-version.mjs");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("gen-listings.mjs failed (exit 3). Fix the generator error.");
    expect(result.stderr).toContain("the tree now holds a partial version");
  }, 180_000);

  describe("embeddedVersionProblems refuses any listing that is off the shared version, in both modes", () => {
    const facts = (change: (listings: any) => void): any => {
      const root = makeVersionFixture({ version: "1.0.0" });
      const read = readReleaseFacts(root);
      change(read.listings);
      return read;
    };

    it("is empty for the fixture as seeded", () => {
      expect(embeddedVersionProblems(facts(() => undefined))).toEqual([]);
    });

    it.each([
      ["plugin.json off the version", (listings: any) => (listings.pluginVersion = "0.9.0"), /plugin\/?.*plugin\.json is at "0\.9\.0", not the shared version 1\.0\.0\. Run pnpm run version/],
      ["the marketplace ref off the tag", (listings: any) => (listings.marketplaceRef = "v0.9.0"), /marketplace\.json pins the ref "v0\.9\.0", not the release tag v1\.0\.0\. Run pnpm run version/],
      ["the marketplace ref pinned to a branch", (listings: any) => (listings.marketplaceRef = "main"), /pins the ref "main", not the release tag v1\.0\.0/],
      ["a server.json version off", (listings: any) => (listings.servers[2].version = "0.9.0"), /packages\/iris-dev-mcp\/server\.json version is "0\.9\.0", not the shared version 1\.0\.0/],
      ["a server.json package version off", (listings: any) => (listings.servers[4].packageVersion = "0.9.0"), /packages\/iris-ops-mcp\/server\.json packages\[0\]\.version is "0\.9\.0"/],
      ["a server.json that was not read", (listings: any) => listings.servers.pop(), /the server\.json listings were not read \(4 of 5\)/],
    ])("%s", (_name, change, expected) => {
      const problems = embeddedVersionProblems(facts(change));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(expected);
    });

    it("facts with no listings at all are refused, never read as consistent", () => {
      const read = facts(() => undefined);
      delete read.listings;
      expect(embeddedVersionProblems(read).length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("the extension follows the shared version (Story 42.7, the lockstep policy)", () => {
  it("stamps the manifest and both version fields of the lock, renames `## [Unreleased]` to `## [<version>] \u2014 <date>` with the injected date, and leaves everything else of those files alone", async () => {
    const root = makeVersionFixture({ version: "1.0.0" });
    const lockBefore = readFileSync(join(root, "extensions/iris-mcp-launcher/package-lock.json"), "utf8");
    const status = await versionMain([], cleanEnv(), root, () => new Date("2026-11-20T23:59:59Z"));
    expect(status).toBe(0);
    expectExtensionVersioned(root, "1.0.1", "2026-11-20");
    const lockAfter = readFileSync(join(root, "extensions/iris-mcp-launcher/package-lock.json"), "utf8");
    expect(lockAfter, "only the two version fields changed").toBe(lockBefore.replaceAll('"version": "1.0.0"', '"version": "1.0.1"'));
    const changelog = readFileSync(join(root, "extensions/iris-mcp-launcher/CHANGELOG.md"), "utf8");
    expect(changelog).toContain("## [1.0.1] \u2014 2026-11-20\n\n### Added\n\n- A synthetic entry.\n");
    expect(changelog).not.toContain("[Unreleased]");
  }, 180_000);

  it("a changelog with CRLF line endings keeps them: the renamed heading is a CRLF line like the rest", async () => {
    const root = makeVersionFixture({ version: "1.0.0" });
    const file = join(root, "extensions/iris-mcp-launcher/CHANGELOG.md");
    writeFileSync(file, readFileSync(file, "utf8").replaceAll("\n", "\r\n"));
    commitFixture(root, "a CRLF changelog");
    const status = await versionMain([], cleanEnv(), root, () => new Date("2026-11-20T23:59:59Z"));
    expect(status).toBe(0);
    const changelog = readFileSync(file, "utf8");
    expect(changelog).toContain("## [1.0.1] \u2014 2026-11-20\r\n\r\n### Added\r\n");
    expect(changelog.replaceAll("\r\n", "")).not.toContain("\n");
  }, 180_000);

  it("the script run as a process stamps the extension too, and its next steps name the extension's files", () => {
    const root = makeVersionFixture({ version: "1.0.0" });
    const result = run(root, "release-version.mjs");
    expect(result.status, result.stderr).toBe(0);
    expectExtensionVersioned(root, "1.0.1");
    expect(result.stderr).toContain("the package.json, package-lock.json and CHANGELOG.md heading of the extension now carry the version;");
    expect(fixtureStatus(root)).toContain("extensions/iris-mcp-launcher/CHANGELOG.md");
  }, 180_000);

  it("a first release stamps the extension at 1.0.0 as well", () => {
    const root = makeVersionFixture();
    expect(run(root, "release-version.mjs", ["--first-release"]).status).toBe(0);
    expectExtensionVersioned(root, "1.0.0");
  }, 180_000);

  /** What `git status --porcelain` says of the fixture: empty when the run changed nothing. */
  const porcelain = (root: string): string => spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout.trim();

  it("a changelog whose first `## ` heading is not `## [Unreleased]`: exit 1 naming the file and the heading, before anything is written (the changesets are not used up), and no next steps", () => {
    const root = makeVersionFixture();
    const file = join(root, "extensions/iris-mcp-launcher/CHANGELOG.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("## [Unreleased]", "## [0.2.0] \u2014 2026-01-02"));
    commitFixture(root, "a changelog with no Unreleased heading");
    const result = run(root, "release-version.mjs");
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('problem: the first `## ` heading of extensions/iris-mcp-launcher/CHANGELOG.md is "## [0.2.0] \u2014 2026-01-02", not `## [Unreleased]`.');
    expect(result.stderr).toContain("nothing was changed. Fix the extension file it names, commit it, then run pnpm run version again.");
    expect(result.stderr).not.toContain("partial version");
    expect(result.stderr).not.toContain("next steps");
    expect(porcelain(root), "changeset version never ran: the tree is as it was").toBe("");
  }, 180_000);

  it("an `## [Unreleased]` heading that is not the first `## ` heading is refused too", () => {
    const root = makeVersionFixture();
    const file = join(root, "extensions/iris-mcp-launcher/CHANGELOG.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("## [Unreleased]", "## Notes\n\n## [Unreleased]"));
    commitFixture(root, "Unreleased is second");
    const result = run(root, "release-version.mjs");
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("extensions/iris-mcp-launcher/CHANGELOG.md is \"## Notes\", not `## [Unreleased]`");
    expect(porcelain(root)).toBe("");
  }, 180_000);

  it("a lock with fewer version fields than the stamp expects: exit 1 naming the file", () => {
    const root = makeVersionFixture();
    writeFileSync(join(root, "extensions/iris-mcp-launcher/package-lock.json"), `${JSON.stringify({ name: "iris-mcp-launcher", lockfileVersion: 3 }, null, 2)}\n`);
    commitFixture(root, "a lock with no version");
    const result = run(root, "release-version.mjs");
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('problem: extensions/iris-mcp-launcher/package-lock.json has 0 "version" fields, not the 2 the stamp expects.');
    expect(porcelain(root), "nothing was stamped beside the lock it could not stamp").toBe("");
  }, 180_000);

  it("the lockstep check refuses a manifest or a lock that is off the shared version, naming the file and the fix", () => {
    const root = makeVersionFixture({ version: "1.0.0" });
    expect(embeddedVersionProblems(readReleaseFacts(root))).toEqual([]);
    const manifest = join(root, "extensions/iris-mcp-launcher/package.json");
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"version": "1.0.0"', '"version": "0.9.0"'));
    expect(embeddedVersionProblems(readReleaseFacts(root))).toEqual([
      'extensions/iris-mcp-launcher/package.json is at "0.9.0", not the shared version 1.0.0. Run pnpm run version, which stamps it.',
    ]);
    const lock = join(root, "extensions/iris-mcp-launcher/package-lock.json");
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"version": "0.9.0"', '"version": "1.0.0"'));
    writeFileSync(lock, readFileSync(lock, "utf8").replace('"version": "1.0.0"', '"version": "0.9.0"'));
    expect(embeddedVersionProblems(readReleaseFacts(root))).toEqual([
      'extensions/iris-mcp-launcher/package-lock.json (version) is at "0.9.0", not the shared version 1.0.0. Run pnpm run version, which stamps it.',
    ]);
  });
});

describe("the extension follows the shared version: the REAL lock and manifest as the oracle (QA, Story 42.7, Rules #36, #54)", () => {
  it("a copy of the extension's real package-lock.json and package.json is stamped in its two own version fields and nowhere else (the fixture lock is hand-written; npm decides the real order)", async () => {
    const realLock = readFileSync(join(REPO_ROOT, "extensions/iris-mcp-launcher/package-lock.json"), "utf8");
    const realManifest = readFileSync(join(REPO_ROOT, "extensions/iris-mcp-launcher/package.json"), "utf8");
    const real = JSON.parse(realLock) as { version: string; packages: Record<string, { version?: string }> };
    expect(Object.keys(real.packages).filter((key) => key !== "").length, "the real lock holds dependencies whose own `version` fields follow the root's").toBeGreaterThan(50);
    const root = makeVersionFixture({ version: real.version });
    writeFileSync(join(root, "extensions/iris-mcp-launcher/package-lock.json"), realLock);
    writeFileSync(join(root, "extensions/iris-mcp-launcher/package.json"), realManifest);
    commitFixture(root, "the real lock and manifest of the extension");
    expect(await versionMain([], cleanEnv(), root, () => new Date("2026-11-20T12:00:00Z"))).toBe(0);
    const shared = readReleaseFacts(root).sharedVersion as string;
    expect(shared, "the version step moved the shared version").not.toBe(real.version);
    const stamped = readFileSync(join(root, "extensions/iris-mcp-launcher/package-lock.json"), "utf8");
    const parsed = JSON.parse(stamped) as { version: string; packages: Record<string, { version?: string }> };
    expect(parsed.version).toBe(shared);
    expect(parsed.packages[""]?.version).toBe(shared);
    // Undo the two stamps and the lock is the real one again: no dependency's `version` field was touched.
    parsed.version = real.version;
    (parsed.packages[""] as { version?: string }).version = real.version;
    expect(parsed).toEqual(real);
    expect(stamped.split("\n").length, "no line was added or removed").toBe(realLock.split("\n").length);
    expect((JSON.parse(readFileSync(join(root, "extensions/iris-mcp-launcher/package.json"), "utf8")) as { version: string }).version).toBe(shared);
    expect(embeddedVersionProblems(readReleaseFacts(root))).toEqual([]);
  }, 180_000);
});

describe("the root manifest wires the scripts", () => {
  it("`version` runs the version script and `release` the release script", () => {
    const scripts = (JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["version"]).toBe("node scripts/release-version.mjs");
    expect(scripts["release"]).toBe("node scripts/release.mjs");
  });
});
