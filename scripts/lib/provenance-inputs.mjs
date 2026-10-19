// Gathers the inputs of the provenance check (scripts/lib/provenance-core.mjs `checkProvenance`).
//
// DISTRIBUTIONS. One per non-private `packages/*/package.json`, enumerated mechanically. A distribution's
// file list is what npm's own packer would put in the tarball (`npm pack --dry-run --json
// --ignore-scripts --offline`); the bytes of those files come from disk. Stories that add a distribution
// (the installer payload, the plugin) append it to `gatherDistributions`.
//
// FAIL CLOSED. A distribution whose file list cannot be gathered is returned with a `problem`, never
// skipped: npm missing, a non-zero exit, output that is not the expected JSON, an unreadable file, and a
// dist-shipping package whose list names no `dist/` file.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDistShipping } from './dist-freshness.mjs';
import { listFilesRecursive } from './generated-tree.mjs';
import { listAgentContentFiles, NOTICE_FILENAME, PACK_DIR, PACK_SOURCE_DIR } from './skills-pack.mjs';

/** The packages whose tarball must carry the whole pack. */
export const PACK_SHIPPING_PACKAGES = ['@iris-mcp/client-config'];

export const NPM_PACK_ARGS = ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline'];

/**
 * Run npm's dry-run packer in `cwd`. Only stdout is parsed by the caller.
 *
 * @param {string} cwd - The package directory.
 * @returns {{ status: number | null, stdout: string, stderr: string, error: Error | null }}
 */
export function runNpmPack(cwd) {
  const options = { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 };
  const result =
    process.platform === 'win32'
      ? spawnSync(`npm ${NPM_PACK_ARGS.join(' ')}`, { ...options, shell: true })
      : spawnSync('npm', NPM_PACK_ARGS, options);
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    error: result.error ?? null,
  };
}

/** @param {string} path */
function readOrNull(path) {
  return existsSync(path) ? readFileSync(path) : null;
}

/**
 * One distribution from a package directory, or a distribution carrying a `problem`.
 *
 * @param {string} name
 * @param {string} pkgDir
 * @param {unknown} pkgJson
 * @param {(cwd: string) => { status: number | null, stdout: string, stderr: string, error: Error | null }} runner
 */
function gatherDistribution(name, pkgDir, pkgJson, runner) {
  const base = { name, mustShipPack: PACK_SHIPPING_PACKAGES.includes(name), files: [] };
  const fail = (problem) => ({ ...base, problem });

  const result = runner(pkgDir);
  if (result.error) {
    return fail(`could not run "npm ${NPM_PACK_ARGS.join(' ')}" in ${pkgDir}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim().split('\n').slice(-3).join(' | ');
    return fail(`"npm ${NPM_PACK_ARGS.join(' ')}" exited with status ${String(result.status)} in ${pkgDir}: ${detail}`);
  }

  let listing;
  try {
    listing = JSON.parse(result.stdout);
  } catch {
    return fail(`"npm ${NPM_PACK_ARGS.join(' ')}" in ${pkgDir} did not print JSON`);
  }
  const entry = Array.isArray(listing) ? listing[0] : undefined;
  if (!entry || !Array.isArray(entry.files) || entry.files.some((file) => typeof file?.path !== 'string')) {
    return fail(`"npm ${NPM_PACK_ARGS.join(' ')}" in ${pkgDir} printed JSON without a file list`);
  }

  const paths = entry.files.map((file) => file.path);
  if (isDistShipping(pkgJson) && !paths.some((path) => path.startsWith('dist/'))) {
    return fail(`${name} ships dist but its tarball file list names no dist/ file; run "pnpm turbo run build"`);
  }

  const files = [];
  for (const path of paths) {
    try {
      files.push({ path, bytes: readFileSync(join(pkgDir, path)) });
    } catch (error) {
      return fail(`could not read ${path} from ${pkgDir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ...base, files };
}

/**
 * One distribution per non-private workspace package.
 *
 * @param {string} root
 * @param {(cwd: string) => { status: number | null, stdout: string, stderr: string, error: Error | null }} runner
 */
function gatherDistributions(root, runner) {
  const packagesDir = join(root, 'packages');
  if (!existsSync(packagesDir)) return [];
  const distributions = [];
  const dirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const dir of dirs) {
    const pkgDir = join(packagesDir, dir);
    const manifestPath = join(pkgDir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    let pkgJson;
    try {
      pkgJson = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      distributions.push({
        name: dir,
        mustShipPack: false,
        files: [],
        problem: `packages/${dir}/package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (pkgJson === null || typeof pkgJson !== 'object' || Array.isArray(pkgJson)) {
      distributions.push({ name: dir, mustShipPack: false, files: [], problem: `packages/${dir}/package.json is not a JSON object` });
      continue;
    }
    if (pkgJson.private === true) continue;
    distributions.push(gatherDistribution(typeof pkgJson.name === 'string' ? pkgJson.name : dir, pkgDir, pkgJson, runner));
  }
  return distributions;
}

/**
 * Everything `checkProvenance` reads.
 *
 * @param {string} root - Repository root (absolute path).
 * @param {{ runNpmPack?: typeof runNpmPack }} [options] - `runNpmPack` replaces the packer call.
 * @returns {import('./provenance-core.mjs').ProvenanceInputs}
 */
export function gatherProvenanceInputs(root, options = {}) {
  const runner = options.runNpmPack ?? runNpmPack;
  const packDir = join(root, PACK_DIR);
  return {
    sourceNotice: readOrNull(join(root, PACK_SOURCE_DIR, NOTICE_FILENAME)),
    packNotice: readOrNull(join(packDir, NOTICE_FILENAME)),
    agentFiles: listAgentContentFiles(root).map(({ label, packRel, absPath }) => ({
      label,
      packRel,
      text: readFileSync(absPath, 'utf8'),
    })),
    packFiles: listFilesRecursive(packDir).map((rel) => ({ rel, bytes: readFileSync(join(packDir, rel)) })),
    distributions: gatherDistributions(root, runner),
  };
}
