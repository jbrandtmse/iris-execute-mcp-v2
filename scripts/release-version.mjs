#!/usr/bin/env node
// The version step of the release (Story 42.5; AD-14, AD-29): `changeset version`, then every artifact that embeds the version.
//
// USE
//   pnpm run version                      version the pending changesets and regenerate what embeds the version
//   pnpm run version -- --first-release   the same, once, for the first public release: it first copies the 1.0.0 template
//                                         (scripts/release/changeset-1.0.0.md) into .changeset/, so all eight packages land on 1.0.0
//   Run it as `pnpm run version`: `pnpm version` hands over to `npm version`, which runs a `version` script as a lifecycle hook.
//   `pnpm run version -- --first-release` hands this script `--` before `--first-release`; one leading `--` is dropped.
//
// CONTRACT
//   1. REFUSES (exit 2), before it changes anything: when it runs as the `npm version` hook (npm_command=version); on a tree that
//      `git status --porcelain` shows as dirty; with `--first-release` and a missing template; with `--first-release` when a package is
//      already at 1.0.0 or later; without `--first-release` when no changeset is pending; when node_modules/@changesets/cli is not
//      installed; and on any other argument (a second `--` is one).
//   2. RUNS, in this order: the `--first-release` copy (removed again when `changeset version` fails), the repository's own
//      `changeset version` (the bin of node_modules/@changesets/cli, so it needs no PATH entry), the same checks the release's `prepare`
//      makes (`versionProblems`: one shared version, no prerelease, no pending changeset), then `scripts/gen-bootstrap.mjs`, which
//      stamps the new semver into the embed and into ipm/module.xml and keeps the sequence and the hash. Then `scripts/gen-pack.mjs` and
//      `scripts/gen-listings.mjs` regenerate the plugin manifest, the marketplace `ref` (`v<version>`) and the five `server.json` files
//      (Story 42.8, lockstep: `embeddedVersionProblems` refuses any of them off the shared version). Then the VS Code extension
//      follows the shared version (lockstep, Story 42.7): its package.json and package-lock.json (both of the lock's version fields) are
//      stamped, and the `## [Unreleased]` heading of its CHANGELOG.md, which must be that file's first `## ` heading (else exit 1 naming
//      the file), becomes `## [<version>] <em dash> <YYYY-MM-DD>`. Any problem found after a step exits 1 naming it. Nothing is committed,
//      tagged or published.
//   3. PRINTS the `BOOTSTRAP_VERSION` move as the generator left it, and the next steps. The root CHANGELOG section for the release names
//      that move literal.
//
// EXIT CODES
//   0 versioned; 1 a step or a check failed; 2 usage or a refusal.
//
// IMPORT
//   Importing this module runs nothing. The root is the parent of the directory that holds this file, so a copy of the script in a fixture
//   acts on the fixture. `main(argv, env, root)` takes the root for the tests.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { embeddedVersionProblems, readReleaseFacts } from './release.mjs';
import { EXTENSION_CHANGELOG_PATH, compareVersions, versionProblems } from './lib/release-core.mjs';
import { isEntryPoint, spawnInherited } from './lib/script-process.mjs';

/** The template of the first release, and the name it takes in `.changeset/`. */
export const FIRST_RELEASE_TEMPLATE = path.join('scripts', 'release', 'changeset-1.0.0.md');
export const FIRST_RELEASE_CHANGESET = 'release-1-0-0.md';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (line) => process.stderr.write(`version: ${line}\n`);

/** The facts the checks need, from the files on disk. */
function stateOf(root) {
  const facts = readReleaseFacts(root);
  return { facts, versions: facts.packages.map((entry) => ({ name: entry.name, version: entry.version })), pending: facts.pending };
}

/** The extension's version files, relative to the repository root, and how many leading `"version"` fields of each carry the extension's own version. */
const EXTENSION_VERSION_FILES = Object.freeze([
  { file: 'extensions/iris-mcp-launcher/package.json', fields: 1 },
  { file: 'extensions/iris-mcp-launcher/package-lock.json', fields: 2 },
]);

/**
 * Put `version` into the first `fields` `"version"` fields of a JSON file, editing the text in place so that nothing else in the file
 * changes: a lock file's first two are its own (`version` and `packages[""].version`). Returns a problem text, or `undefined`. With
 * `write: false` it only checks, and writes nothing.
 */
function stampVersionFields(root, { file, fields }, version, { write = true } = {}) {
  const full = path.join(root, file);
  if (!existsSync(full)) return `${file} is missing. Restore it from git.`;
  let seen = 0;
  const stamped = readFileSync(full, 'utf8').replace(/^(\s*"version":\s*)"[^"]*"/gm, (match, prefix) => {
    seen += 1;
    return seen <= fields ? `${prefix}"${version}"` : match;
  });
  if (seen < fields) return `${file} has ${seen} "version" fields, not the ${fields} the stamp expects. Fix the file by hand.`;
  if (write) writeFileSync(full, stamped, 'utf8');
  return undefined;
}

/**
 * Rename the extension changelog's `## [Unreleased]` heading to `## [<version>] <em dash> <date>`. It must be the first `## ` heading.
 * Returns a problem text, or `undefined`. With `write: false` it only checks, and writes nothing.
 */
function renameUnreleasedHeading(root, version, date, { write = true } = {}) {
  const full = path.join(root, EXTENSION_CHANGELOG_PATH);
  if (!existsSync(full)) return `${EXTENSION_CHANGELOG_PATH} is missing. Restore it from git.`;
  const lines = readFileSync(full, 'utf8').split('\n');
  const index = lines.findIndex((line) => line.startsWith('## '));
  if (index < 0 || lines[index].trimEnd() !== '## [Unreleased]') {
    return `the first \`## \` heading of ${EXTENSION_CHANGELOG_PATH} is ${JSON.stringify(index < 0 ? undefined : lines[index])}, not \`## [Unreleased]\`. Put the release's entries under a \`## [Unreleased]\` heading at the top, then run it again.`;
  }
  lines[index] = `## [${version}] \u2014 ${date}${lines[index].endsWith('\r') ? '\r' : ''}`;
  if (write) writeFileSync(full, lines.join('\n'), 'utf8');
  return undefined;
}

/** The `bin` of the repository's own `@changesets/cli`, or `undefined` when it is not installed. */
function changesetBin(root) {
  const packageDir = path.join(root, 'node_modules', '@changesets', 'cli');
  const manifestFile = path.join(packageDir, 'package.json');
  if (!existsSync(manifestFile)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  return path.join(packageDir, typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.changeset);
}

/**
 * Version the repository (see the header).
 *
 * @param {readonly string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [root]
 * @param {() => Date} [now] - The clock that dates the extension changelog's release heading.
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2), env = process.env, root = ROOT, now = () => new Date()) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const unknown = args.filter((argument) => argument !== '--first-release');
  if (unknown.length > 0 || args.length > 1) {
    say(`unknown argument ${JSON.stringify(unknown[0] ?? args[1])}. Use: pnpm run version [-- --first-release]`);
    return 2;
  }
  const firstRelease = args.includes('--first-release');
  if (env.npm_command === 'version') {
    say('this script ran as the npm version lifecycle hook. Run pnpm run version instead; pnpm version hands over to npm version.');
    say('npm version has already changed the version in package.json: restore it with git checkout -- package.json first.');
    return 2;
  }
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0) {
    say(`git status failed (${status.error?.message ?? `exit ${status.status}`}). Run it in a git checkout.`);
    return 2;
  }
  if (status.stdout.trim() !== '') {
    say(`the tree is not clean (${status.stdout.trim().split('\n').slice(0, 5).join('; ')}). Commit or stash the changes, then run it again.`);
    return 2;
  }

  const before = stateOf(root);
  const template = path.join(root, FIRST_RELEASE_TEMPLATE);
  const copy = path.join(root, '.changeset', FIRST_RELEASE_CHANGESET);
  if (firstRelease) {
    if (!existsSync(template)) {
      say(`${FIRST_RELEASE_TEMPLATE} is missing. Restore it from git; it names all eight packages as major.`);
      return 2;
    }
    const released = before.versions.filter((entry) => compareVersions(entry.version, '1.0.0') >= 0).map((entry) => `${entry.name}@${entry.version}`);
    if (released.length > 0) {
      say(`--first-release applies once, and ${released.join(', ')} is already at 1.0.0 or later. Run pnpm run version without it.`);
      return 2;
    }
  } else if (before.pending.length === 0) {
    say('no changeset is pending. Add one with pnpm changeset, or use --first-release for the first release.');
    return 2;
  }
  const bin = changesetBin(root);
  if (bin === undefined) {
    say('node_modules/@changesets/cli is not installed. Run pnpm install, then run it again.');
    return 2;
  }
  // The extension's stamp and rename are checked before anything is written, so that a problem there leaves the tree as it was.
  const unstampable = [
    ...EXTENSION_VERSION_FILES.map((entry) => stampVersionFields(root, entry, before.facts.sharedVersion, { write: false })),
    renameUnreleasedHeading(root, before.facts.sharedVersion, '', { write: false }),
  ].filter((problem) => problem !== undefined);
  if (unstampable.length > 0) {
    for (const problem of unstampable) say(`problem: ${problem}`);
    say('nothing was changed. Fix the extension file it names, commit it, then run pnpm run version again.');
    return 1;
  }
  if (firstRelease) {
    copyFileSync(template, copy);
    say(`copied ${FIRST_RELEASE_TEMPLATE} to .changeset/${FIRST_RELEASE_CHANGESET}`);
  }

  /** A tree that a step left changed holds a partial version, which a second run refuses as a dirty tree. */
  const partial = () =>
    say('the tree now holds a partial version: discard it with git restore . && git clean -fd (the tree was clean when this run began), fix the problem above, then run pnpm run version again.');
  const versioned = await spawnInherited([process.execPath, bin, 'version'], { label: 'version', env: { ...env, CI: 'true' }, cwd: root });
  if (versioned !== 0) {
    if (firstRelease) rmSync(copy, { force: true });
    say(`changeset version failed (exit ${versioned}). Fix the changeset it names, then run it again.`);
    if (spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout?.trim()) partial();
    return 1;
  }
  const afterChangesets = stateOf(root);
  const first = [...afterChangesets.facts.problems, ...versionProblems(afterChangesets, 'dry-run')];
  if (first.length > 0) {
    for (const problem of first) say(`problem: ${problem}`);
    partial();
    return 1;
  }

  const generated = await spawnInherited([process.execPath, path.join(root, 'scripts', 'gen-bootstrap.mjs')], { label: 'version', env, cwd: root });
  if (generated !== 0) {
    say(`gen-bootstrap failed (exit ${generated}). Fix the generator error.`);
    partial();
    return 1;
  }
  // The plugin and the registry listings follow the shared version (lockstep): the generators read the versions changeset just wrote.
  for (const script of ['gen-pack.mjs', 'gen-listings.mjs']) {
    const regenerated = await spawnInherited([process.execPath, path.join(root, 'scripts', script)], { label: 'version', env, cwd: root });
    if (regenerated !== 0) {
      say(`${script} failed (exit ${regenerated}). Fix the generator error.`);
      partial();
      return 1;
    }
  }
  // The extension follows the shared version (lockstep): its manifest, its lock and its changelog heading.
  const sharedAfter = stateOf(root).facts.sharedVersion;
  const extensionProblems = [
    ...EXTENSION_VERSION_FILES.map((entry) => stampVersionFields(root, entry, sharedAfter)),
    renameUnreleasedHeading(root, sharedAfter, now().toISOString().slice(0, 10)),
  ].filter((problem) => problem !== undefined);
  if (extensionProblems.length > 0) {
    for (const problem of extensionProblems) say(`problem: ${problem}`);
    partial();
    return 1;
  }
  const after = stateOf(root);
  const problems = [...after.facts.problems, ...versionProblems(after, 'dry-run'), ...embeddedVersionProblems(after.facts)];
  if (problems.length > 0) {
    for (const problem of problems) say(`problem: ${problem}`);
    partial();
    return 1;
  }

  const version = after.facts.sharedVersion;
  say(`all ${after.versions.length} packages are at ${version}; ipm/module.xml and the embed carry it.`);
  say(
    before.facts.marker === after.facts.marker
      ? `\`BOOTSTRAP_VERSION\` does not move (${after.facts.marker}).`
      : `\`BOOTSTRAP_VERSION\` moves from \`${before.facts.marker}\` to \`${after.facts.marker}\``,
  );
  say('next steps: write the root CHANGELOG section for this release, naming the BOOTSTRAP_VERSION move above;');
  say('  the package.json, package-lock.json and CHANGELOG.md heading of the extension now carry the version;');
  say('  the plugin manifest (packages/client-config/skills-pack/.claude-plugin/plugin.json), the marketplace ref (.claude-plugin/marketplace.json) and the five server.json files carry it too;');
  say(`  review git diff and commit; wait for CI to be green on the commit; then tag it v${version}, push the tag, and approve the run in the release environment.`);
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      say(`${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
