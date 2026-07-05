// ════════════════════════════════════════════════════════════════════════════
// FROZEN-FOUNDATION NOTE (Story 15.1 AC 15.1.7, lead 2026-06-16;
//   Story 16.0 — --check / --force, lead 2026-06-16).
//
// This generator PRODUCED the FROZEN Epic-14 foundation governance baseline
// (packages/shared/src/governance-baseline.ts — 141 keys, hash `1e62c5ad5bf7`).
//
// It MUST NOT be re-run to GROW the committed baseline with post-foundation
// (Epic 15+) tools. The frozen-foundation model is deliberate: a NEW write tool
// (e.g. `iris_service_manage:enable`) must be ABSENT from the baseline so the
// default seed (`governance.ts` → `defaultSeed`) default-DISABLES it. New tool
// keys are governed by their `mutates` classification + the default seed, NOT by
// baseline membership. Merging them into this file would re-grandfather every new
// write as enabled-by-default and break the opt-in-write guarantee, and would
// change the frozen hash that the one-directional drift test pins.
//
// USAGE (Rule #25 — a generator that emits a FROZEN artifact needs a no-write
// --check mode and refuses to overwrite without --force):
//
//   node scripts/gen-governance-baseline.mjs --check
//       SAFE. Re-derives the LIVE governance keys from the built server dists
//       and verifies the FROZEN committed baseline ONE-DIRECTIONALLY (mirrors
//       the governance.test.ts drift guard): every frozen foundation key must
//       still exist in the live surface (a vanished key is a real back-compat
//       regression → exit 1). New post-foundation keys are EXPECTED and allowed
//       (reported for visibility, never a failure). Writes NOTHING; exit 0 on
//       success. Use this in CI and locally — NEVER the bare write below.
//       (npm: `pnpm gen:governance-baseline:check`)
//
//   node scripts/gen-governance-baseline.mjs            (no flag)
//       REFUSES. Prints a frozen-file refusal and exits non-zero WITHOUT
//       writing. This is the footgun guard: running the generator "just to
//       check counts" used to silently regrow the frozen file.
//       (npm: `pnpm gen:governance-baseline` — also refuses without --force)
//
//   node scripts/gen-governance-baseline.mjs --force
//       DANGEROUS. Overwrites governance-baseline.ts with the full LIVE surface.
//       Only ever appropriate to RE-DERIVE / RE-VERIFY the Epic-14 foundation
//       hash (`1e62c5ad5bf7`) against an unchanged Epic-14 tool surface — then
//       discard the output (`git checkout -- packages/shared/src/governance-baseline.ts`).
//       NEVER commit a regenerated file that includes post-foundation tools.
// ════════════════════════════════════════════════════════════════════════════

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createHash } from 'crypto';

// Shared key-derivation + drift helpers (Story 22.1, CR 16.0-1 / CR 16.0-2). The generator
// and the governance.test.ts drift guard now import the SAME derivation so they can never
// disagree. Imported from the BUILT shared dist — this generator already runs AFTER
// `pnpm turbo run build` (it imports the server dists), so the shared dist is present.
import {
  deriveKeysForTool,
  computeBaselineDrift,
  SERVER_PACKAGES,
  VANISHED_HINT,
} from '../packages/shared/dist/governance-baseline-derivation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ── CLI mode (Story 16.0) ────────────────────────────────────────────────────
// --check : no-write one-directional drift verification (CI-safe).
// --force : restore today's write behavior (deliberate foundation re-derivation).
// neither : refuse to overwrite the frozen file (footgun guard) → exit non-zero.
const argv = process.argv.slice(2);
const CHECK_MODE = argv.includes('--check');
const FORCE_MODE = argv.includes('--force');

// The five server packages whose tools form the governance baseline.
// Each exports `export const tools: ToolDefinition[]` from its built
// dist/tools/index.js. The generator imports the BUILT dists, so it MUST run
// AFTER `pnpm turbo run build` (see the gen:governance-baseline script).
//
// NOTE: this generator (in scripts/, build-time, repo root) imports server
// dists; the generated `governance-baseline.ts` is STATIC DATA, so
// @iris-mcp/shared importing it creates NO runtime dependency on the server
// packages — no cycle.
// SERVER_PACKAGES + the per-tool key derivation (unwrapActionOptions + the fail-fast
// guards) are imported from the shared `governance-baseline-derivation` module (CR 16.0-1):
// the generator, the governance.test.ts drift guard, and the runtime gate now all funnel
// through ONE derivation, so they can never disagree.

// Derive the LIVE governance key set from the built server dists.
//
// Governance key model (architecture decision D4):
//   - Multi-action tool (inputSchema has an `action` ZodEnum): emit
//     `tool:<value>` for every enum option.
//   - Single-operation tool (no `action` enum): emit the bare `tool` name.
//
// Fail-fast guards (Story 15.0 AC 15.0.5): rather than silently downgrading a
// malformed tool shape to a bare/"undefined" key, the generator THROWS, naming
// the offending package + tool. A `seen` set across ALL packages turns an
// accidental cross-package duplicate tool name / `tool:action` key (previously a
// silent Set merge) into a hard build error.
//
// Returns { keys: Set<string>, toolCount, perPackage }.
async function deriveLiveKeys() {
  const keys = new Set();
  const seen = new Map(); // governance key → "pkg/tool" that first produced it
  let toolCount = 0;
  const perPackage = [];

  /** Add a key, throwing on a cross-package duplicate (AC 15.0.5). */
  function addKey(key, pkg, toolName) {
    const origin = `${pkg}/${toolName}`;
    if (seen.has(key)) {
      throw new Error(
        `gen-governance-baseline: duplicate governance key "${key}" — produced by ` +
          `${seen.get(key)} and again by ${origin}. Tool names (and tool:action keys) ` +
          `must be unique across all server packages.`,
      );
    }
    seen.set(key, origin);
    keys.add(key);
  }

  for (const pkg of SERVER_PACKAGES) {
    const distEntry = resolve(root, `packages/${pkg}/dist/tools/index.js`);
    let mod;
    try {
      mod = await import(pathToFileURL(distEntry).href);
    } catch (e) {
      throw new Error(
        `gen-governance-baseline: could not import built tools from ${distEntry}.\n` +
          `Did you run "pnpm turbo run build" first? This generator imports the\n` +
          `compiled dist/ output, so it must run after the build.\n` +
          `Underlying error: ${e?.message ?? e}`,
      );
    }
    const tools = mod.tools;
    if (!Array.isArray(tools)) {
      throw new Error(
        `gen-governance-baseline: ${pkg} dist/tools/index.js does not export a "tools" array.`,
      );
    }

    let pkgKeyCount = 0;
    for (const tool of tools) {
      toolCount++;
      // Per-tool key derivation (unwrap + fail-fast guards for missing name/inputSchema,
      // empty enum, non-string option) is the SHARED helper (CR 16.0-1), so the generator
      // and the governance.test.ts drift guard can never derive a different surface. The
      // cross-package duplicate guard (addKey/seen) stays here — it is a build-time
      // integrity check spanning all packages, not a per-tool concern.
      for (const key of deriveKeysForTool(tool, pkg)) {
        addKey(key, pkg, tool.name);
        pkgKeyCount++;
      }
    }
    perPackage.push({ pkg, tools: tools.length, keys: pkgKeyCount });
  }

  return { keys, toolCount, perPackage };
}

// Compute the short SHA-256 content hash over a sorted key list (mirrors the
// BOOTSTRAP_VERSION hash formula).
function computeHash(sortedKeys) {
  const hasher = createHash('sha256');
  for (const key of sortedKeys) {
    hasher.update(key);
    hasher.update('\n');
  }
  return hasher.digest('hex').substring(0, 12);
}

const outPath = resolve(root, 'packages/shared/src/governance-baseline.ts');

// VANISHED_HINT is imported from the shared derivation module (single source of truth,
// shared with the governance.test.ts drift guard).

// ════════════════════════════════════════════════════════════════════════════
// --check : no-write one-directional drift verification (AC 16.0.1, 16.0.2).
// ════════════════════════════════════════════════════════════════════════════
if (CHECK_MODE) {
  const { keys: liveKeys } = await deriveLiveKeys();

  // Import the FROZEN committed baseline (source of truth for the foundation).
  // `outPath` is the single shared path constant — --check verifies exactly the
  // file --force would write, so they can never diverge.
  let committedModule;
  try {
    committedModule = await import(pathToFileURL(outPath).href);
  } catch (e) {
    console.error(
      `gen-governance-baseline --check: could not import the committed baseline at\n` +
        `${outPath}.\nUnderlying error: ${e?.message ?? e}`,
    );
    process.exit(1);
  }
  // A successful import with a missing / non-iterable / empty GOVERNANCE_BASELINE
  // export must NOT silently pass: `new Set(undefined)` would be empty, making
  // `vanished` empty and reporting a destroyed foundation as healthy (a false OK
  // that defeats the whole point of --check as the CI guard). The committed export
  // is a `Set<string>` (an iterable), so validate it is iterable AND non-empty.
  const committedExport = committedModule.GOVERNANCE_BASELINE;
  const committedIsIterable =
    committedExport != null && typeof committedExport[Symbol.iterator] === 'function';
  if (!committedIsIterable) {
    console.error(
      `gen-governance-baseline --check: the committed baseline at\n${outPath}\n` +
        `does not export an iterable GOVERNANCE_BASELINE (got ` +
        `${Object.prototype.toString.call(committedExport)}). The frozen ` +
        `foundation appears destroyed or the export was renamed — refusing to ` +
        `report a false "OK". Restore the frozen baseline; do NOT regenerate it.`,
    );
    process.exit(1);
  }
  const committed = new Set(committedExport);
  if (committed.size === 0) {
    console.error(
      `gen-governance-baseline --check: the committed baseline at\n${outPath}\n` +
        `exports an EMPTY GOVERNANCE_BASELINE. The frozen foundation appears ` +
        `destroyed — refusing to report a false "OK". Restore the frozen ` +
        `baseline; do NOT regenerate it.`,
    );
    process.exit(1);
  }

  // ONE-DIRECTIONAL drift via the SHARED helper (CR 16.0-2 — the SAME pure comparison the
  // new governance-baseline-derivation unit test exercises with synthetic sets):
  //   - vanished = committed \ live  → MUST be empty (real regression).
  //   - postFoundation = live \ committed → EXPECTED, allowed (report only).
  const { vanished, postFoundation } = computeBaselineDrift(committed, liveKeys);

  console.log('gen-governance-baseline --check (no-write drift verification)');
  console.log(`  frozen foundation keys (committed): ${committed.size}`);
  console.log(`  live keys (derived from dists):     ${liveKeys.size}`);
  console.log(`  post-foundation new keys (allowed): ${postFoundation.length}`);

  if (vanished.length > 0) {
    console.error('');
    console.error(
      `Governance foundation is BROKEN — ${vanished.length} FROZEN foundation key(s) ` +
        `missing from the live tool surface:`,
    );
    for (const k of vanished) {
      console.error(`  - ${k}`);
    }
    console.error('');
    console.error(VANISHED_HINT);
    process.exit(1);
  }

  console.log('');
  console.log('OK — every frozen foundation key still exists in the live surface.');
  process.exit(0);
}

// ════════════════════════════════════════════════════════════════════════════
// Footgun guard (AC 16.0.3): refuse to overwrite the frozen file without --force.
// ════════════════════════════════════════════════════════════════════════════
if (!FORCE_MODE) {
  console.error(
    `gen-governance-baseline: REFUSING to overwrite the FROZEN baseline at\n` +
      `${outPath}.\n` +
      `\n` +
      `This file is the FROZEN Epic-14 foundation snapshot (141 keys, hash\n` +
      `1e62c5ad5bf7). Regenerating it would regrow it with post-foundation\n` +
      `(Epic 15+) tools and re-grandfather every new write as enabled-by-default,\n` +
      `breaking the opt-in-write guarantee and the one-directional drift test.\n` +
      `\n` +
      `  - To VERIFY the frozen baseline against the live surface (CI-safe, no write):\n` +
      `        node scripts/gen-governance-baseline.mjs --check\n` +
      `        (or: pnpm gen:governance-baseline:check)\n` +
      `  - To GENUINELY regenerate (only to re-derive the Epic-14 foundation hash\n` +
      `    against an UNCHANGED Epic-14 tool surface, then discard the output):\n` +
      `        node scripts/gen-governance-baseline.mjs --force\n`,
  );
  process.exit(1);
}

// ════════════════════════════════════════════════════════════════════════════
// --force : write path (today's behavior, gated). Deliberate foundation re-derivation only.
// ════════════════════════════════════════════════════════════════════════════
const { keys, toolCount, perPackage } = await deriveLiveKeys();

// Sort the keys for deterministic output (stable diffs across runs and
// platforms, mirroring gen-bootstrap.mjs's deterministic emission).
const sortedKeys = [...keys].sort();

// Compute the short SHA-256 content hash over the sorted keys. Any change to the
// tool surface — a new tool, a new/removed action enum value — produces a new
// hash, so the committed file is a drift-detectable fingerprint.
const GOVERNANCE_BASELINE_HASH = computeHash(sortedKeys);

// Emit governance-baseline.ts with the sorted Set + content hash and the
// Rule #18 DO-NOT-EDIT header.
let output = `// DO NOT EDIT — generated by scripts/gen-governance-baseline.mjs (FROZEN — see below).
/**
 * FROZEN Epic-14 foundation governance baseline (architecture decision D3 +
 * Story 15.1 AC 15.1.7, frozen-foundation model, lead 2026-06-16).
 *
 * This is the IMMUTABLE Epic-14 foundation snapshot (141 keys, hash
 * \`1e62c5ad5bf7\`): the set of governance keys that existed at the end of the
 * Epic-14 foundation — a bare tool name for each single-operation tool, and
 * \`tool:action\` for each value of a multi-action tool's \`action\` enum.
 *
 * It is the mechanical proof of back-compat (Rule #18, output-only): membership
 * here marks an action as PRE-EXISTING (grandfathered → enabled by the default
 * seed). Anything NOT in the baseline is NEW, and the default seed classifies it
 * by its \`mutates\` metadata (new read enabled, new write disabled). See
 * \`governance.ts\` for the seed/cascade logic.
 *
 * **DO NOT regenerate this file to GROW it with post-foundation (Epic 15+)
 * tools.** A NEW write tool MUST be ABSENT from this baseline so \`defaultSeed\`
 * default-disables it; new tool keys are governed by \`mutates\` + defaultSeed,
 * NOT by baseline membership. The companion drift test (\`governance.test.ts\`)
 * is one-directional: every frozen foundation key must still exist in the live
 * surface, and new post-foundation keys are EXPECTED to live outside this set.
 * The generator may be re-run only to RE-VERIFY the frozen hash (use --check;
 * --force overwrites and is only for a deliberate foundation re-derivation).
 */

/**
 * Short SHA-256 fingerprint of the sorted baseline keys. Changes whenever the
 * governed action surface changes; useful for drift detection / changelogs.
 */
export const GOVERNANCE_BASELINE_HASH = "${GOVERNANCE_BASELINE_HASH}";

/**
 * Every governance key that existed at generation time. Used by the default
 * seed to grandfather pre-existing actions as enabled.
 */
export const GOVERNANCE_BASELINE: ReadonlySet<string> = new Set([
`;

for (const key of sortedKeys) {
  output += `  ${JSON.stringify(key)},\n`;
}

output += `]);
`;

writeFileSync(outPath, output, 'utf-8');

console.log(`Generated ${outPath}`);
console.log(`GOVERNANCE_BASELINE_HASH: ${GOVERNANCE_BASELINE_HASH}`);
console.log(`Tools enumerated: ${toolCount} across ${SERVER_PACKAGES.length} packages`);
console.log(`Baseline keys: ${sortedKeys.length}`);
for (const p of perPackage) {
  console.log(`  ${p.pkg}: ${p.tools} tools → ${p.keys} keys`);
}
