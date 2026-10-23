/**
 * The fixtures of the version step (Story 42.1, Story 42.5): copies of what `changeset version` and `scripts/gen-bootstrap.mjs` read and
 * write, in directories under `os.tmpdir()`, so that the repository's REAL tools run against them and the real tree is never versioned.
 *
 *  - {@link makeFixture} (Story 42.1, `release-1-0-0-mechanism.test.ts`): the root manifest, the workspace file, `.changeset/` with every
 *    pending changeset, and each package's manifest and changelog, with a `node_modules` link to the repository's so that the real
 *    `@changesets/cli` resolves. With `withTemplate`, the 1.0.0 release changeset is added.
 *  - {@link makeVersionFixture} (Story 42.5, `release-version.test.ts`): the same, plus the inputs of the bootstrap generator (the
 *    shared builder `copyGeneratorInputs`), the embed, the release scripts, the template under `scripts/release/` and a `.gitignore`.
 *    The fixture owns its state: all eight manifests are seeded at one version, the pending changesets are one synthetic `patch` of
 *    `@iris-mcp/shared`, and the generator runs in the fixture before the first commit, so the embed and `ipm/module.xml` start
 *    consistent with that version and the version script sees a clean tree. What a test expects never depends on the real manifests,
 *    the real changesets or the real embed.
 * {@link removeFixtures} removes every directory these made.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { copyGeneratorInputs } from "../../../shared/src/__tests__/gen-bootstrap-scratch.js";
import { REPO_ROOT } from "./pack-fixture";

/** The subset of a package manifest the fixtures read. */
export interface Manifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
}

/** The directory names under `packages/`, sorted. */
export const PACKAGE_DIRS = readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(REPO_ROOT, "packages", entry.name, "package.json")))
  .map((entry) => entry.name)
  .sort();

/** The changeset files of a directory (every `.md` but the README), sorted. */
export const pendingChangesets = (directory: string): string[] =>
  existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".md") && name !== "README.md").sort() : [];

/** The manifest of a package directory of a tree. */
export const manifestOf = (root: string, dir: string): Manifest => JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8")) as Manifest;

/** The template of the first release. */
export const TEMPLATE = join(REPO_ROOT, "scripts/release/changeset-1.0.0.md");

const directories: string[] = [];

/** Remove every fixture directory that was made. */
export function removeFixtures(): void {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Copy `relative` from the repository into `root`. */
function copyInto(root: string, relative: string): void {
  mkdirSync(dirname(join(root, relative)), { recursive: true });
  cpSync(join(REPO_ROOT, relative), join(root, relative));
}

/**
 * A fixture copy of what `changeset version` reads and writes, under `os.tmpdir()`. The repository's `node_modules` is linked in so
 * the real `@changesets/cli` and its modules resolve.
 */
export function makeFixture(options: { withTemplate: boolean; prefix?: string }): string {
  const root = mkdtempSync(join(tmpdir(), options.prefix ?? "release-1-0-0-"));
  directories.push(root);
  copyInto(root, "package.json");
  copyInto(root, "pnpm-workspace.yaml");
  copyInto(root, ".changeset/config.json");
  for (const name of pendingChangesets(join(REPO_ROOT, ".changeset"))) copyInto(root, `.changeset/${name}`);
  for (const dir of PACKAGE_DIRS) {
    copyInto(root, `packages/${dir}/package.json`);
    if (existsSync(join(REPO_ROOT, "packages", dir, "CHANGELOG.md"))) copyInto(root, `packages/${dir}/CHANGELOG.md`);
  }
  if (options.withTemplate) cpSync(TEMPLATE, join(root, ".changeset", "release-1-0-0.md"));
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"), "junction");
  return root;
}

/**
 * The environment of every git process a version fixture starts, its own and the version script's: the developer's global and system git
 * configuration are not read (a hook path, a signing rule or `status.showUntrackedFiles` there would change what the tests see).
 */
export const FIXTURE_GIT_ENV = Object.freeze({ GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });

/** Run `git` in `cwd`; throws with its output when it fails. */
function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...FIXTURE_GIT_ENV } });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  return result.stdout;
}

/** The one pending changeset of the version fixture: a `patch` of `@iris-mcp/shared`, which the fixed group applies to all eight packages. */
export const SYNTHETIC_CHANGESET = "synthetic-patch.md";

/** What {@link makeVersionFixture} builds. */
export interface VersionFixtureOptions {
  /** Whether the 1.0.0 template is under `scripts/release/` (default true). */
  withTemplate?: boolean;
  /** The version of all eight packages, the embed's marker and `ipm/module.xml` (default `0.0.2`). */
  version?: string;
  /** Whether the synthetic `patch` changeset is pending (default true). */
  pending?: boolean;
}

/**
 * The fixture of the version step (see the header): {@link makeFixture} with the template files, the inputs of the bootstrap generator
 * and the embed, the release scripts and a `.gitignore`, seeded at `version`, committed in a git repository of its own (so
 * `git status --porcelain` is empty).
 */
export function makeVersionFixture(options: VersionFixtureOptions = {}): string {
  const version = options.version ?? "0.0.2";
  const root = makeFixture({ withTemplate: false, prefix: "release-version-" });
  copyGeneratorInputs(root, REPO_ROOT);
  copyInto(root, "packages/shared/src/bootstrap-classes.ts");
  copyInto(root, ".gitignore");
  for (const relative of ["scripts/release-version.mjs", "scripts/release.mjs", "scripts/lib/release-core.mjs", "scripts/lib/script-process.mjs"]) copyInto(root, relative);
  if (options.withTemplate !== false) copyInto(root, "scripts/release/changeset-1.0.0.md");

  for (const dir of PACKAGE_DIRS) {
    const file = join(root, "packages", dir, "package.json");
    const seeded = readFileSync(file, "utf8").replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
    if (!seeded.includes(`"version": "${version}"`)) throw new Error(`could not seed the version of packages/${dir}/package.json`);
    writeFileSync(file, seeded);
  }
  for (const name of pendingChangesets(join(root, ".changeset"))) rmSync(join(root, ".changeset", name));
  if (options.pending !== false) writeFileSync(join(root, ".changeset", SYNTHETIC_CHANGESET), '---\n"@iris-mcp/shared": patch\n---\n\nA synthetic change.\n');
  const generated = spawnSync(process.execPath, [join(root, "scripts", "gen-bootstrap.mjs")], { cwd: root, encoding: "utf8" });
  if (generated.status !== 0) throw new Error(`gen-bootstrap failed in ${root}: ${generated.stderr}`);

  git(root, ["init", "--quiet"]);
  commitFixture(root, "fixture");
  return root;
}

/** Commit every change of a fixture repository; the identity and the signing setting are the fixture's own. */
export function commitFixture(root: string, message: string): void {
  git(root, ["add", "--all"]);
  git(root, ["commit", "--quiet", "-m", message]);
}

/** The porcelain status of a fixture repository. */
export const fixtureStatus = (root: string): string => git(root, ["status", "--porcelain"]);

/** The hash of every tracked file of a fixture and its untracked ones, to show that a refused run changed nothing. */
export function fixtureTreeHash(root: string): string {
  return git(root, ["add", "--all", "--dry-run"]) + git(root, ["diff", "HEAD", "--stat"]) + git(root, ["status", "--porcelain"]);
}
