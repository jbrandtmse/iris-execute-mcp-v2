// Prints the installer payload of every route, computed by the built installer itself.
//
// USAGE: node scripts/lib/installer-payload-probe.mjs <root>
//
// It imports `<root>/packages/client-config/dist/pack-plan.js` and calls `installerPayloads()`, which plans an
// install of each route into an empty project and returns the files it would write. The result goes to stdout as
// one JSON object:
//
//   {"payloads":[{"route":"claude-code","files":[{"path":".claude/rules/...","base64":"..."}]}]}
//
// On any failure it prints one line to stderr and exits 1. It runs in a child process so that the provenance
// check stays synchronous, and it needs no node_modules in <root>: the installer's planning modules import only
// node built-ins.
//
// When <root> holds the installer's sources (`packages/client-config/src`), the probe first checks that the
// installer's `dist/` is at least as new as them, so a stale build is refused instead of describing an installer
// that no longer exists. A root without those sources (a scratch copy of the built installer) is not checked.

import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDistFresh } from './dist-freshness.mjs';

/** @param {string} message */
function fail(message) {
  console.error(message.replace(/\s*\r?\n\s*/g, ' ').trim());
  process.exit(1);
}

/** @param {unknown} error */
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

const rootArg = process.argv[2];
if (rootArg === undefined || rootArg === '') fail('usage: node installer-payload-probe.mjs <root>');

const clientConfigDir = join(resolve(rootArg), 'packages', 'client-config');
const modulePath = join(clientConfigDir, 'dist', 'pack-plan.js');

if (existsSync(join(clientConfigDir, 'src'))) {
  const freshness = checkDistFresh(clientConfigDir, '@iris-mcp/client-config');
  if (!freshness.ok) fail(`client-config's dist is not fresh: ${freshness.reason ?? 'unknown reason'}`);
}

let installer;
try {
  installer = await import(pathToFileURL(modulePath).href);
} catch (error) {
  fail(`could not load ${modulePath}: ${describe(error)}`);
}
if (typeof installer.installerPayloads !== 'function') {
  fail(`${modulePath} does not export installerPayloads`);
}

let payloads;
try {
  payloads = installer.installerPayloads();
} catch (error) {
  fail(`installerPayloads failed: ${describe(error)}`);
}

const out = {
  payloads: payloads.map((payload) => ({
    route: payload.route,
    files: payload.files.map((file) => ({ path: file.path, base64: Buffer.from(file.bytes).toString('base64') })),
  })),
};
process.stdout.write(JSON.stringify(out));
