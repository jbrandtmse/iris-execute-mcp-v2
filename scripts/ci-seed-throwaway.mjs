#!/usr/bin/env node
// Seeds a throwaway IRIS for Health container so that CI's armed suites have what they need (Story 42.3).
//
// USE
//   node scripts/throwaway-iris.mjs exec --state <file> -- node scripts/ci-seed-throwaway.mjs
//   The environment is the throwaway's (IRIS_REQUIRE_LIVE=1, IRIS_THROWAWAY, IRIS_HOST=127.0.0.1, the five IRIS_* target variables).
//
// CONTRACT
//   1. Refusal comes first (exit 2), before the shared dist is loaded or a request is made: the environment must have the
//      shape `throwaway-iris.mjs exec` gives it (`assertThrowawayEnv`: IRIS_REQUIRE_LIVE=1, a harness-shaped IRIS_THROWAWAY,
//      IRIS_HOST=127.0.0.1, a port that is not 52773 or 1972). The check reads the environment only; `exec` is what ties the
//      name to a labelled, running container that publishes that port.
//   2. The real `bootstrap()` of the built `@iris-mcp/shared` deploys, compiles and configures the ExecuteMCPv2 classes in the
//      target namespace, as a server does on its first start. The seed fails unless the result has no error and either the
//      probe found the deployment current, or `deployed`, `compiled`, `configured` and `mapped` are all true (AD-14: the
//      bootstrapped classes come from the embed, never from `src/`).
//   3. `Ens.Director` must be visible in `%Dictionary.CompiledClass` of the target namespace. If it is not, the namespace is
//      not interoperability-enabled and the seed fails, naming the namespace.
//   4. Every document under `src/ExecuteMCPv2/Tests/` and `src/ExecuteMCPv2/QAFixtures/` is PUT and compiled through
//      `deployClasses` and `compileClasses` of the shared dist. A compile error in the response fails the seed. The list
//      shares no document with the bootstrap roster of `scripts/gen-bootstrap.mjs` (`seedDocuments` refuses otherwise): a
//      bootstrapped class loaded from `src/` would carry the `dev` marker and pin the deployment as foreign.
//
// EXIT CODES
//   0 seeded; 1 a step failed; 2 the environment is not a throwaway target.
//
// IMPORT
//   Importing this module runs nothing. `seedThrowaway(options)` takes the environment, the repository root and the loader of the
//   shared dist as options.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ThrowawayRefusal, assertThrowawayEnv } from './throwaway-iris.mjs';
import { REPO_ROOT, walk } from './lib/live-gate-scan.mjs';
import { isEntryPoint } from './lib/script-process.mjs';

/** The directories whose documents the seed deploys, relative to `src/`. */
const SEED_DIRECTORIES = ['ExecuteMCPv2/Tests', 'ExecuteMCPv2/QAFixtures'];

/** Milliseconds one request to the throwaway may take: the compile of the fixtures is one synchronous call. */
const REQUEST_TIMEOUT_MS = 600_000;

/** The statement that shows whether the namespace is interoperability-enabled. */
export const INTEROP_QUERY = "SELECT Name FROM %Dictionary.CompiledClass WHERE Name = 'Ens.Director'";

/**
 * The classes `scripts/gen-bootstrap.mjs` bootstraps: the document names and the source paths of its `classes[]` literal.
 *
 * @param {string} repoRoot
 * @returns {{ names: string[], paths: string[] }}
 */
export function bootstrapRoster(repoRoot = REPO_ROOT) {
  const source = readFileSync(path.join(repoRoot, 'scripts', 'gen-bootstrap.mjs'), 'utf8');
  const literal = /const classes = \[([\s\S]*?)\n\];/.exec(source)?.[1] ?? '';
  const entries = [...literal.matchAll(/\{\s*name:\s*'([^']+)',\s*path:\s*'([^']+)'\s*\}/g)];
  return { names: entries.map((entry) => entry[1]), paths: entries.map((entry) => entry[2]) };
}

/**
 * The documents the seed deploys, each as `{ name, path, content }`: `name` is the Atelier document name
 * (`ExecuteMCPv2.Tests.UtilsTest.cls`), `path` the file relative to the repository root, `content` its text with `\n` line
 * ends. The list is sorted by path, and a dotfile (`.DS_Store`) is not a document. It throws when it is empty, when a file is
 * not a class, or when it shares a document or a path with the bootstrap roster.
 *
 * @param {string} repoRoot
 * @returns {Array<{ name: string, path: string, content: string }>}
 */
export function seedDocuments(repoRoot = REPO_ROOT) {
  const sourceRoot = path.join(repoRoot, 'src');
  const documents = SEED_DIRECTORIES.flatMap((directory) => walk(path.join(sourceRoot, directory), ['']))
    .filter((file) => !path.basename(file).startsWith('.'))
    .sort()
    .map((file) => {
      const relative = path.relative(sourceRoot, file).split(path.sep).join('/');
      if (!relative.endsWith('.cls')) throw new Error(`the seed deploys classes only, and ${relative} is not one.`);
      return {
        name: `${relative.slice(0, -'.cls'.length).split('/').join('.')}.cls`,
        path: `src/${relative}`,
        content: readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').replace(/\s+$/, ''),
      };
    });
  if (documents.length === 0) throw new Error(`the seed found no class under ${SEED_DIRECTORIES.join(' or ')}.`);

  const roster = bootstrapRoster(repoRoot);
  const shared = documents.filter((document) => roster.names.includes(document.name) || roster.paths.includes(document.path));
  if (shared.length > 0) {
    throw new Error(
      `the seed list shares ${shared.map((document) => document.name).join(', ')} with the bootstrap roster of scripts/gen-bootstrap.mjs: ` +
        'a bootstrapped class loaded from src/ carries the dev marker, and the deployment would count as foreign.',
    );
  }
  return documents;
}

/**
 * What is wrong with the result of `bootstrap()` for a seed: an empty list means the ExecuteMCPv2 service is deployed, compiled and
 * configured in the target namespace.
 *
 * @param {{ probeStatus?: string, deployed?: boolean, compiled?: boolean, configured?: boolean, mapped?: boolean, errors?: string[] }} result
 * @returns {string[]}
 */
export function bootstrapProblems(result) {
  const problems = [];
  for (const error of result?.errors ?? []) problems.push(`bootstrap reported: ${error}`);
  const complete = result?.probeStatus === 'current' || (result?.deployed === true && result?.compiled === true && result?.configured === true && result?.mapped === true);
  if (!complete) {
    problems.push(
      `bootstrap did not finish (probe ${result?.probeStatus}; deployed ${result?.deployed}, compiled ${result?.compiled}, configured ${result?.configured}, mapped ${result?.mapped}).`,
    );
  }
  return problems;
}

/**
 * What is wrong with the response of an Atelier compile that did not throw. IRIS compiles with `CompileList` and then reuses the
 * status for the documents it updated, so a compile in which some classes failed can answer HTTP 200 with no status error: the
 * failure is then only in the console. An empty list means the console printed no error line and reported that the compilation
 * finished successfully (the line `iris_doc_compile` and the live gates require). A compile that fails outright is thrown by
 * the HTTP client before this function sees it.
 *
 * @param {unknown} response - The parsed envelope of `POST action/compile`.
 * @returns {string[]}
 */
export function compileProblems(response) {
  const envelope = response !== null && typeof response === 'object' ? response : {};
  const lines = Array.isArray(envelope.console) ? envelope.console.map(String) : [];
  const problems = lines.filter((line) => /ERROR\s*#\d+/.test(line)).map((line) => `console: ${line.trim()}`);
  if (!lines.some((line) => /Compilation finished successfully/.test(line))) {
    problems.push(`the compile did not report that it finished successfully (console: ${JSON.stringify(lines)}).`);
  }
  return problems;
}

/** Import the built `@iris-mcp/shared`. */
async function loadSharedDist(repoRoot) {
  return import(pathToFileURL(path.join(repoRoot, 'packages', 'shared', 'dist', 'index.js')).href);
}

const describeFailure = (error) => (error instanceof Error ? error.message : String(error));

/**
 * Seed the throwaway the environment names and return the exit code.
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   repoRoot?: string,
 *   loadShared?: (repoRoot: string) => Promise<Record<string, any>>,
 *   log?: (line: string) => void,
 * }} [options]
 * @returns {Promise<number>}
 */
export async function seedThrowaway(options = {}) {
  const { env = process.env, repoRoot = REPO_ROOT, loadShared = loadSharedDist, log = (line) => process.stderr.write(`${line}\n`) } = options;

  try {
    assertThrowawayEnv(env);
  } catch (error) {
    if (!(error instanceof ThrowawayRefusal)) throw error;
    log(`ci-seed-throwaway: refusing to seed: ${error.message}`);
    return 2;
  }

  let documents;
  try {
    documents = seedDocuments(repoRoot);
  } catch (error) {
    log(`ci-seed-throwaway: ${describeFailure(error)}`);
    return 1;
  }

  let shared;
  try {
    shared = await loadShared(repoRoot);
  } catch (error) {
    log(`ci-seed-throwaway: could not load the built @iris-mcp/shared (run pnpm build first): ${describeFailure(error)}`);
    return 1;
  }
  const { IrisHttpClient, atelierPath, bootstrap, compileClasses, deployClasses, loadConfig, negotiateVersion } = shared;

  let http;
  try {
    const config = loadConfig(env);
    http = new IrisHttpClient(config, REQUEST_TIMEOUT_MS);
    const version = await negotiateVersion(http);
    log(`ci-seed-throwaway: ${config.host}:${config.port}, namespace ${config.namespace}, Atelier v${version}`);

    const result = await bootstrap(http, config, version);
    const bootstrapFailures = bootstrapProblems(result);
    if (bootstrapFailures.length > 0) {
      log(`ci-seed-throwaway: the bootstrap of ${config.namespace} failed:\n  - ${bootstrapFailures.join('\n  - ')}`);
      return 1;
    }
    log(`ci-seed-throwaway: bootstrap ${result.probeStatus === 'current' ? 'found the ExecuteMCPv2 service current' : 'installed the ExecuteMCPv2 service'}`);

    const probe = await http.post(atelierPath(version, config.namespace, 'action/query'), { query: INTEROP_QUERY });
    const rows = Array.isArray(probe.result?.content) ? probe.result.content : [];
    if (!rows.some((row) => row?.Name === 'Ens.Director')) {
      log(
        `ci-seed-throwaway: ${config.namespace} is not interoperability-enabled: Ens.Director is not visible in %Dictionary.CompiledClass there. ` +
          'The armed rosters need the interoperability classes, and this harness never enables a namespace.',
      );
      return 1;
    }
    log(`ci-seed-throwaway: Ens.Director is visible in ${config.namespace}`);

    await deployClasses(http, config, version, new Map(documents.map((document) => [document.name, document.content])));
    const compiled = await compileClasses(http, config, version, documents.map((document) => document.name));
    const compileFailures = compileProblems(compiled);
    if (compileFailures.length > 0) {
      log(`ci-seed-throwaway: ${compileFailures.length} compile problem(s) in ${config.namespace}:\n  - ${compileFailures.join('\n  - ')}`);
      return 1;
    }
    log(`ci-seed-throwaway: deployed and compiled ${documents.length} test and fixture classes in ${config.namespace}`);
    return 0;
  } catch (error) {
    log(`ci-seed-throwaway: ${describeFailure(error)}`);
    return 1;
  } finally {
    http?.destroy?.();
  }
}

/** The entry point. */
export async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length > 0) {
    process.stderr.write('usage: node scripts/ci-seed-throwaway.mjs (the throwaway target comes from the environment)\n');
    return 2;
  }
  return seedThrowaway({ env });
}

if (isEntryPoint(import.meta.url)) {
  main().then((code) => process.exit(code));
}
