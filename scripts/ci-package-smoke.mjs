#!/usr/bin/env node
// Proves that the packages install and start from their tarballs, the path a user's `npx` takes and `prepublishOnly` does not (DW-443).
//
// USE
//   pnpm build && node scripts/ci-package-smoke.mjs
//   CI runs it as the `package` job, which starts only after the `gates` and `throwaway` jobs are green.
//
// CONTRACT
//   1. `pnpm pack` packs every non-private `packages/*` package with its lifecycle scripts on, the real path. A package whose
//      dist is not fresh is refused first (build before packing).
//   2. The tarballs are installed together with `npm install` into a fresh temporary directory whose `package.json` resolves every
//      `@iris-mcp/*` package, as a dependency and as an override, to its local tarball. Afterwards the lockfile must show every
//      `@iris-mcp/*` entry resolved from a `file:` tarball: none came from the registry. Third-party dependencies come from the
//      registry, so this step needs network access to it. No IRIS is reached.
//   3. Each server bin (`iris-{dev,admin,interop,ops,data}-mcp`) is started with `npx --no -- <bin>`, against a closed local port and
//      with no `IRIS_TOOLS_*` variable. It must answer `initialize` (protocol 2025-11-25) and a `tools/list` whose tool count equals
//      the committed tools-list snapshot's.
//   4. Each CLI bin (`iris-mcp-clients`, `iris-mcp-credentials`, `iris-mcp-governance`) must print `Usage: <bin>` for `--help` and
//      exit 0, and `iris-mcp-clients detect --json` must exit 0 with `HOME` set to an empty temporary directory.
//   5. The temporary directories are removed. The exit code is 0 when every check passed and 1 otherwise, with each failing bin named.
//
// IMPORT
//   Importing this module runs nothing. The pure helpers (`publishablePackages`, `binsOf`, `installManifest`, `expectedToolCount`,
//   `lockfileProblems`) are exported for the tests.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkDistFresh } from './lib/dist-freshness.mjs';
import { REPO_ROOT } from './lib/live-gate-scan.mjs';
import { pnpmPack } from './lib/pnpm-pack.mjs';
import { isEntryPoint } from './lib/script-process.mjs';
import { CLOSED_PORT_ENV, handshake, openRawWire } from './lib/sdk-wire-golden-core.mjs';

/** The protocol revision the smoke asks the servers for. */
export const SMOKE_PROTOCOL = '2025-11-25';

/** The committed tools-list snapshot, relative to the repository root. */
const SNAPSHOT_PATH = 'packages/iris-mcp-all/src/__tests__/fixtures/tools-list-snapshot.json';

/**
 * The non-private packages under `packages/`, sorted by directory: `{ dir, name, manifest }`.
 *
 * @param {string} [repoRoot]
 */
export function publishablePackages(repoRoot = REPO_ROOT) {
  const packagesDir = path.join(repoRoot, 'packages');
  return readdirSync(packagesDir)
    .filter((dir) => existsSync(path.join(packagesDir, dir, 'package.json')))
    .sort()
    .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(path.join(packagesDir, dir, 'package.json'), 'utf8')) }))
    .filter(({ manifest }) => manifest.private !== true)
    .map(({ dir, manifest }) => ({ dir, name: manifest.name, manifest }));
}

/** The bin names a package manifest declares (a string `bin` is named after the package, without its scope). */
export function binsOf(manifest) {
  if (typeof manifest.bin === 'string') return [String(manifest.name).replace(/^@[^/]+\//, '')];
  if (manifest.bin !== null && typeof manifest.bin === 'object') return Object.keys(manifest.bin).sort();
  return [];
}

/**
 * The `package.json` of the install directory: every `@iris-mcp/*` tarball is a `file:` dependency and, so that a package's own
 * dependency on another resolves to the tarball too, an override.
 *
 * @param {ReadonlyArray<{ name: string, tarball: string }>} tarballs
 */
export function installManifest(tarballs) {
  const specs = Object.fromEntries(
    [...tarballs].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, tarball }) => [name, `file:${tarball}`]),
  );
  return { name: 'ci-package-smoke', version: '0.0.0', private: true, dependencies: { ...specs }, overrides: { ...specs } };
}

/** The server bins the committed tools-list snapshot covers, sorted. */
export function snapshotServers(repoRoot = REPO_ROOT) {
  return Object.keys(readSnapshot(repoRoot).servers).sort();
}

function readSnapshot(repoRoot) {
  return JSON.parse(readFileSync(path.join(repoRoot, SNAPSHOT_PATH), 'utf8'));
}

/** The number of tools the committed snapshot lists for the server `server` (its bin name, `iris-dev-mcp`). */
export function expectedToolCount(server, repoRoot = REPO_ROOT) {
  const entry = readSnapshot(repoRoot).servers[server];
  if (entry === undefined) throw new Error(`the tools-list snapshot has no server ${JSON.stringify(server)}.`);
  return Object.keys(entry).length;
}

/**
 * What is wrong with the `package-lock.json` an install wrote: every `@iris-mcp/*` entry must be resolved from a `file:` tarball, and
 * every package of `names` must be there.
 *
 * @param {{ packages?: Record<string, { resolved?: string }> }} lock
 * @param {readonly string[]} names
 * @returns {string[]}
 */
export function lockfileProblems(lock, names) {
  const problems = [];
  const entries = lock?.packages ?? {};
  for (const name of names) {
    const entry = entries[`node_modules/${name}`];
    if (entry === undefined) problems.push(`${name} is not in the lockfile.`);
    else if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith('file:')) {
      problems.push(`${name} was resolved from ${JSON.stringify(entry.resolved)}, not from a local tarball.`);
    }
  }
  for (const [key, entry] of Object.entries(entries)) {
    const match = /(?:^|\/)node_modules\/(@iris-mcp\/[^/]+)$/.exec(key);
    if (match === null) continue;
    if (!names.includes(match[1])) problems.push(`${match[1]} is in the lockfile but is no package of this repository.`);
    else if (key !== `node_modules/${match[1]}` && (typeof entry?.resolved !== 'string' || !entry.resolved.startsWith('file:'))) {
      problems.push(`${match[1]} at ${key} was resolved from ${JSON.stringify(entry?.resolved)}, not from a local tarball.`);
    }
  }
  return problems;
}

/** The environment of every child: the caller's, without any IRIS_* or MCP_* setting, and with an empty home. */
function cleanEnv(home) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    if (typeof value !== 'string' || upper.startsWith('IRIS_') || upper.startsWith('MCP_')) continue;
    env[key] = value;
  }
  return { ...env, HOME: home, USERPROFILE: home, npm_config_update_notifier: 'false', NO_UPDATE_NOTIFIER: '1' };
}

/** Run a program to completion and collect its output. */
function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 600_000, shell: process.platform === 'win32', ...options });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
}

/** Start a server bin through `npx --no`, run the handshake and `tools/list`, and return what is wrong with its answers. */
async function checkServer(bin, installDir, env, expected) {
  const wire = openRawWire({ command: 'npx', args: ['--no', '--', bin], cwd: installDir, env: { ...env, ...CLOSED_PORT_ENV }, timeoutMs: 120_000 });
  try {
    const initialized = await handshake(wire, SMOKE_PROTOCOL, 'ci-package-smoke');
    const negotiated = initialized.message?.result?.protocolVersion;
    if (negotiated !== SMOKE_PROTOCOL) return [`initialize answered protocol ${JSON.stringify(negotiated)}, not ${SMOKE_PROTOCOL}.`];
    let count = 0;
    let cursor;
    do {
      const listed = await wire.request('tools/list', cursor === undefined ? {} : { cursor });
      const tools = listed.message?.result?.tools;
      if (!Array.isArray(tools)) return [`tools/list answered no tools array: ${listed.line.slice(0, 200)}`];
      count += tools.length;
      cursor = listed.message.result.nextCursor;
    } while (cursor !== undefined);
    return count === expected ? [] : [`tools/list listed ${count} tools, the snapshot lists ${expected}.`];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  } finally {
    await wire.close();
  }
}

/** Run a CLI bin through `npx --no` and return what is wrong with its answers. */
function checkCli(bin, installDir, env) {
  const problems = [];
  const help = run('npx', ['--no', '--', bin, '--help'], { cwd: installDir, env });
  if (help.status !== 0) problems.push(`--help exited ${help.status ?? help.error?.message}: ${help.stderr.trim().slice(0, 300)}`);
  else if (!help.stdout.includes(`Usage: ${bin}`)) problems.push(`--help did not print "Usage: ${bin}".`);
  if (bin === 'iris-mcp-clients') {
    const detect = run('npx', ['--no', '--', bin, 'detect', '--json'], { cwd: installDir, env });
    if (detect.status !== 0) problems.push(`detect --json exited ${detect.status ?? detect.error?.message}: ${detect.stderr.trim().slice(0, 300)}`);
  }
  return problems;
}

/**
 * Pack, install and start every package, and return the exit code.
 *
 * @param {{ repoRoot?: string, log?: (line: string) => void }} [options]
 * @returns {Promise<number>}
 */
export async function smokePackages({ repoRoot = REPO_ROOT, log = (line) => process.stderr.write(`${line}\n`) } = {}) {
  const packages = publishablePackages(repoRoot);
  const failures = [];
  const fail = (what, problems) => {
    for (const problem of problems) failures.push(`${what}: ${problem}`);
  };

  for (const pkg of packages) {
    const fresh = checkDistFresh(path.join(repoRoot, 'packages', pkg.dir), pkg.name);
    if (!fresh.ok) {
      log(`ci-package-smoke: ${fresh.reason}`);
      return 1;
    }
  }

  const work = mkdtempSync(path.join(tmpdir(), 'ci-package-smoke-'));
  try {
    const home = path.join(work, 'home');
    mkdirSync(home);
    const env = cleanEnv(home);

    const tarballs = [];
    for (const pkg of packages) {
      const destination = path.join(work, 'packs', pkg.dir);
      const packed = pnpmPack(path.join(repoRoot, 'packages', pkg.dir), destination, { ignoreScripts: false });
      tarballs.push({ name: pkg.name, tarball: packed.tarball, manifest: packed.manifest });
      for (const bin of binsOf(packed.manifest)) {
        const target = typeof packed.manifest.bin === 'string' ? packed.manifest.bin : packed.manifest.bin[bin];
        if (!packed.files.includes(String(target).replace(/^\.\//, ''))) fail(bin, [`the tarball of ${pkg.name} does not hold its bin file ${target}.`]);
      }
      log(`ci-package-smoke: packed ${pkg.name} (${packed.bytes} bytes)`);
    }

    const installDir = path.join(work, 'install');
    mkdirSync(installDir);
    writeFileSync(path.join(installDir, 'package.json'), `${JSON.stringify(installManifest(tarballs), null, 2)}\n`);
    const installed = run('npm', ['install', '--no-audit', '--no-fund'], { cwd: installDir, env });
    if (installed.status !== 0) {
      log(`ci-package-smoke: npm install failed (${installed.status ?? installed.error?.message}):\n${installed.stderr.trim().slice(-2000)}`);
      return 1;
    }
    const lockFile = path.join(installDir, 'package-lock.json');
    fail('install', existsSync(lockFile) ? lockfileProblems(JSON.parse(readFileSync(lockFile, 'utf8')), packages.map((pkg) => pkg.name)) : ['npm wrote no package-lock.json.']);
    log(`ci-package-smoke: installed ${packages.length} tarballs`);

    const servers = snapshotServers(repoRoot);
    const bins = packages.flatMap((pkg) => binsOf(tarballs.find((entry) => entry.name === pkg.name).manifest));
    for (const server of servers) {
      if (!bins.includes(server)) fail(server, ['no packed package declares this server bin.']);
    }
    for (const bin of bins.filter((candidate) => servers.includes(candidate))) {
      const problems = await checkServer(bin, installDir, env, expectedToolCount(bin, repoRoot));
      fail(bin, problems);
      log(`ci-package-smoke: ${bin}: ${problems.length === 0 ? `initialize and tools/list (${expectedToolCount(bin, repoRoot)} tools) ok` : 'FAILED'}`);
    }
    for (const bin of bins.filter((candidate) => !servers.includes(candidate))) {
      const problems = checkCli(bin, installDir, env);
      fail(bin, problems);
      log(`ci-package-smoke: ${bin}: ${problems.length === 0 ? 'ok' : 'FAILED'}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    log(`ci-package-smoke: ${failures.length} problem(s):\n  - ${failures.join('\n  - ')}`);
    return 1;
  }
  log(`ci-package-smoke: ${packages.length} packages installed from tarballs, ${snapshotServers(repoRoot).length} servers and their CLIs answered`);
  return 0;
}

/** The entry point. */
export async function main(argv = process.argv.slice(2)) {
  if (argv.length > 0) {
    process.stderr.write('usage: node scripts/ci-package-smoke.mjs\n');
    return 2;
  }
  return smokePackages();
}

if (isEntryPoint(import.meta.url)) {
  main().then((code) => process.exit(code));
}
