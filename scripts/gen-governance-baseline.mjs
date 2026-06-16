import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

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

// Step 1: Import the built `tools` array from each server package's dist and
// enumerate governance keys.
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

// Step 2: Sort the keys for deterministic output (stable diffs across runs and
// platforms, mirroring gen-bootstrap.mjs's deterministic emission).
const sortedKeys = [...keys].sort();

// Step 3: Compute a short SHA-256 content hash over the sorted keys (mirrors
// the BOOTSTRAP_VERSION hash). Any change to the tool surface — a new tool, a
// new/removed action enum value — produces a new hash, so the committed file is
// a drift-detectable fingerprint of the governed action surface.
const hasher = createHash('sha256');
for (const key of sortedKeys) {
  hasher.update(key);
  hasher.update('\n');
}
const GOVERNANCE_BASELINE_HASH = hasher.digest('hex').substring(0, 12);

// Step 4: Emit governance-baseline.ts with the sorted Set + content hash and
// the Rule #18 DO-NOT-EDIT header.
let output = `// DO NOT EDIT — auto-generated by scripts/gen-governance-baseline.mjs. Regenerate via: pnpm run gen:governance-baseline
/**
 * Generated governance baseline (Epic 14, architecture decision D3).
 *
 * The set of every governance key in the suite AS OF generation: a bare tool
 * name for each single-operation tool, and \`tool:action\` for each value of a
 * multi-action tool's \`action\` enum. Enumerated from the BUILT \`tools\` arrays
 * of all five server packages.
 *
 * This is the mechanical proof of back-compat (Rule #18, output-only):
 * membership in this baseline marks an action as PRE-EXISTING (grandfathered →
 * enabled by the default seed). Anything NOT in the baseline is NEW, and the
 * default seed classifies it by its \`mutates\` metadata (new read enabled, new
 * write disabled). See \`governance.ts\` for the seed/cascade logic.
 *
 * Because the seed derives "is this action new?" from membership here rather
 * than from a hand-maintained flag, "no pre-existing action is disabled by
 * default" is verifiable, not assertable. The companion drift test
 * (\`governance.test.ts\`) re-derives this set from the live tool registries and
 * fails if this file is stale.
 *
 * Regenerate (NEVER hand-edit) after any change to the tool surface:
 *   pnpm turbo run build && pnpm run gen:governance-baseline
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

const outPath = resolve(root, 'packages/shared/src/governance-baseline.ts');
writeFileSync(outPath, output, 'utf-8');

console.log(`Generated ${outPath}`);
console.log(`GOVERNANCE_BASELINE_HASH: ${GOVERNANCE_BASELINE_HASH}`);
console.log(`Tools enumerated: ${toolCount} across ${SERVER_PACKAGES.length} packages`);
console.log(`Baseline keys: ${sortedKeys.length}`);
for (const p of perPackage) {
  console.log(`  ${p.pkg}: ${p.tools} tools → ${p.keys} keys`);
}
