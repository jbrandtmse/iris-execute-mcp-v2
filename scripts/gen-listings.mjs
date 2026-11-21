// ----------------------------------------------------------------------------
// gen-listings.mjs (Story 42.8)
//
// Builds the generated listings from each server package's `package.json` and the plugin source:
//   - `packages/iris-{admin,data,dev,interop,ops}-mcp/server.json`, the MCP Registry entry of each server package;
//   - `.claude-plugin/marketplace.json`, the repository's Claude Code marketplace, whose one plugin is pinned to the release tag.
// Every listing carries the shared version, so `pnpm run version` runs this script after it stamps the packages. The rendering lives in
// scripts/lib/listings.mjs. Each listing is a committed, generated, DO-NOT-EDIT file: only this script writes it, and it writes only
// these six files.
//
// USAGE:
//   node scripts/gen-listings.mjs            Regenerate the listings (writes).
//   node scripts/gen-listings.mjs --check    No-write drift verification: exit 1 on any missing or changed listing.
//
//   npm: `pnpm gen:listings` / `pnpm gen:listings:check`
// ----------------------------------------------------------------------------

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffFiles, writeFiles } from './lib/generated-tree.mjs';
import { renderListings } from './lib/listings.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_MODE = process.argv.slice(2).includes('--check');

let files;
try {
  files = renderListings(root);
} catch (error) {
  console.error(`gen-listings${CHECK_MODE ? ' --check' : ''}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (CHECK_MODE) {
  const { missing, drift } = diffFiles(files, root);
  for (const rel of missing) console.error(`gen-listings --check: MISSING generated file: ${rel}`);
  for (const rel of drift) console.error(`gen-listings --check: DRIFT in ${rel} (hand-edited, or its source changed without regenerating).`);
  if (missing.length + drift.length > 0) {
    console.error('');
    console.error('Run "pnpm gen:listings" to regenerate the listings, then commit the result.');
    process.exit(1);
  }
  console.log(`gen-listings --check: OK \u2014 ${files.size} listing(s) match their sources, no drift.`);
  process.exit(0);
}

for (const rel of writeFiles(files, root)) console.log(`gen-listings: wrote ${rel}`);
console.log(`Generated ${files.size} listing(s).`);
