// ----------------------------------------------------------------------------
// gen-pack.mjs (Story 41.1)
//
// Builds the IRIS MCP skills pack, `packages/client-config/skills-pack/`, from its two source trees:
// the generated workflow skills in `skills/` (owned by `gen-skills.mjs`) and the hand-authored sources
// in `skills-pack-src/` (knowledge skills, the always-on rule, the notice). Every pack file is a byte
// for byte copy of its source, except the generated pack README. The assembly rules and the layout live in
// scripts/lib/skills-pack.mjs; the tree synchronisation is shared with gen-skills.mjs
// (scripts/lib/generated-tree.mjs).
//
// The pack is a committed, generated, DO-NOT-EDIT directory. Only this script writes it.
//
// This script renders nothing from the prompt catalog, so it needs no build.
//
// USAGE:
//   node scripts/gen-pack.mjs            Regenerate the pack from its sources (writes).
//   node scripts/gen-pack.mjs --check    No-write drift verification: exit 1 on any missing, changed or
//                                        stray pack file.
//
//   npm: `pnpm gen:pack` / `pnpm gen:pack:check`
//
// A skill name defined in both sources, a knowledge skill without a SKILL.md, or an unknown entry in
// skills-pack-src/ exits 1 before anything is written.
// ----------------------------------------------------------------------------

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { diffTree, writeTree } from './lib/generated-tree.mjs';
import { assemblePack, PACK_DIR } from './lib/skills-pack.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const CHECK_MODE = process.argv.slice(2).includes('--check');
const packDir = resolve(root, PACK_DIR);

let files;
try {
  files = assemblePack(root);
} catch (error) {
  console.error(`gen-pack${CHECK_MODE ? ' --check' : ''}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (CHECK_MODE) {
  const { missing, drift, stray } = diffTree(files, packDir);

  for (const rel of missing) {
    console.error(`gen-pack --check: MISSING generated file: ${PACK_DIR}/${rel}`);
  }
  for (const rel of drift) {
    console.error(
      `gen-pack --check: DRIFT in ${PACK_DIR}/${rel} (hand-edited, or source changed without regenerating).`,
    );
  }
  for (const rel of stray) {
    console.error(`gen-pack --check: STRAY generated file (no source): ${PACK_DIR}/${rel}`);
  }

  if (missing.length + drift.length + stray.length > 0) {
    console.error('');
    console.error('Run "pnpm gen:pack" to regenerate the pack from its sources, then commit the result.');
    process.exit(1);
  }

  console.log(`gen-pack --check: OK \u2014 ${files.size} pack file(s) match their sources, no drift.`);
  process.exit(0);
}

// Write mode (default).
for (const rel of writeTree(files, packDir)) {
  console.log(`gen-pack: removing stray generated file: ${PACK_DIR}/${rel}`);
}

console.log(`Generated ${files.size} file(s) under ${PACK_DIR}/.`);
