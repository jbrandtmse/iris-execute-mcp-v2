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
import { PACKAGE_DIRS, SYNTHETIC_CHANGESET, commitFixture, fixtureStatus, fixtureTreeHash, makeVersionFixture, manifestOf, pendingChangesets, removeFixtures } from "./release-fixture";
import { embeddedVersionProblems, readReleaseFacts } from "../../../../scripts/release.mjs";
import { versionProblems } from "../../../../scripts/lib/release-core.mjs";

afterAll(removeFixtures);

/** The environment of a script run: PATH and HOME only, so that no ambient `npm_command` or token reaches it. */
const cleanEnv = (extra: Record<string, string> = {}): Record<string, string> => ({ PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...extra });

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
  return after;
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
  }, 180_000);
});

describe("the root manifest wires the scripts", () => {
  it("`version` runs the version script and `release` the release script", () => {
    const scripts = (JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["version"]).toBe("node scripts/release-version.mjs");
    expect(scripts["release"]).toBe("node scripts/release.mjs");
  });
});
