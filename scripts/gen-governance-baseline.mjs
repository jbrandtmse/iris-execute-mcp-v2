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
const SERVER_PACKAGES = [
  'iris-dev-mcp',
  'iris-admin-mcp',
  'iris-interop-mcp',
  'iris-ops-mcp',
  'iris-data-mcp',
];

// Read the `action` enum's `.options`, peeling any ZodOptional / ZodDefault /
// ZodNullable wrapper first (Story 15.0 AC 15.0.1).
//
// CRITICAL — lock-step: this MUST MIRROR `unwrapActionOptions` in
// packages/shared/src/governance.ts (the gate side). A bare `z.enum([...])` (and
// `.describe(...)`) exposes `.options` directly; a wrapped enum
// (`.optional()`/`.default()`/`.nullable()`) exposes `.options === undefined`,
// so without unwrapping a future wrapped action enum would collapse to the bare
// tool key in the baseline while the gate (which DOES unwrap) emits per-action
// keys — making the two disagree and the cascade miss. If you change the peel
// logic here, change `unwrapActionOptions` too.
//
// NOTE (CR 15.0-5, do not regress): this unwrap is the CORRECT/ROBUST derivation
// and is used by BOTH the write path and the --check path. The governance.test.ts
// drift guard reads `tool.inputSchema?.shape?.action?.options` directly (a known
// deferred lock-step gap, harmless on today's all-bare surface). The --check mode
// here intentionally keeps the unwrap rather than downgrading to the bare read.
function unwrapActionOptions(actionField) {
  let field = actionField;
  for (let depth = 0; depth < 10 && field != null; depth++) {
    if (Array.isArray(field.options)) {
      return field.options;
    }
    const inner =
      typeof field.unwrap === 'function' ? field.unwrap() : field._def?.innerType;
    if (inner == null || inner === field) {
      return undefined;
    }
    field = inner;
  }
  return undefined;
}

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
      // Guard: a tool MUST have a string `name` and an `inputSchema` (AC 15.0.5).
      if (typeof tool?.name !== 'string' || tool.name === '') {
        throw new Error(
          `gen-governance-baseline: ${pkg} has a tool with a missing/empty "name" ` +
            `(got ${JSON.stringify(tool?.name)}).`,
        );
      }
      if (tool.inputSchema == null) {
        throw new Error(
          `gen-governance-baseline: ${pkg}/${tool.name} is missing "inputSchema".`,
        );
      }
      const actionField = tool.inputSchema?.shape?.action;
      if (actionField != null) {
        // The field is present. If it unwraps to a ZodEnum, it MUST be a non-empty
        // enum of string options; anything else is a malformed shape we refuse to
        // silently downgrade. (A non-enum `action`, e.g. z.string(), unwraps to
        // undefined options and is treated as a single-op tool, matching the gate.)
        const options = unwrapActionOptions(actionField);
        if (options !== undefined) {
          if (!Array.isArray(options) || options.length === 0) {
            throw new Error(
              `gen-governance-baseline: ${pkg}/${tool.name} declares an EMPTY "action" ` +
                `enum. A multi-action tool must declare at least one action value.`,
            );
          }
          for (const value of options) {
            if (typeof value !== 'string') {
              throw new Error(
                `gen-governance-baseline: ${pkg}/${tool.name} has a non-string "action" ` +
                  `enum option (${JSON.stringify(value)}). Action values must be strings.`,
              );
            }
          }
          // Multi-action tool — one key per enum value.
          for (const value of options) {
            addKey(`${tool.name}:${value}`, pkg, tool.name);
            pkgKeyCount++;
          }
          continue;
        }
      }
      // Single-operation tool — bare tool name.
      addKey(tool.name, pkg, tool.name);
      pkgKeyCount++;
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

// Wording shared with governance.test.ts's VANISHED_HINT for consistency.
const VANISHED_HINT =
  'a FROZEN foundation key disappeared from the live tool surface — this is a real ' +
  'back-compat regression (a grandfathered action would lose its enabled-by-default ' +
  'guarantee). Restore the tool/action, do NOT regenerate the frozen baseline.';

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

  // ONE-DIRECTIONAL drift (mirrors governance.test.ts):
  //   - vanished = committed \ live  → MUST be empty (real regression).
  //   - postFoundation = live \ committed → EXPECTED, allowed (report only).
  const vanished = [...committed].filter((k) => !liveKeys.has(k)).sort();
  const postFoundation = [...liveKeys].filter((k) => !committed.has(k)).sort();

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
