// Tool-visibility payload measurement (Epic 30, Story 30.2, AC 30.2.3 — spec
// research/feature-specs/11-tool-visibility-presets.md §2.7).
//
// Constructs a REAL McpServerBase per {server × preset} and drives the REAL
// `tools/list` SDK request handler (the same `_requestHandlers`-map pattern
// used by `packages/shared/src/__tests__/tool-visibility.e2e.test.ts`) so the
// measured bytes match exactly what a connected client receives over the wire
// (the SDK's own Zod→JSON-schema tool conversion), not a hand-rolled
// serialization. Reports, per server × {full, core, developer}: tool count,
// `tools/list` JSON bytes, and `~tokens = Math.round(bytes / 4)` (a heuristic
// — no new tokenizer dependency, per spec §2.7).
//
// The reusable (side-effect-free) measurement helpers live in
// scripts/lib/measure-tools-payload-core.mjs, imported by BOTH this CLI
// script AND packages/iris-mcp-all's default-suite vitest sanity test
// (single source of truth, mirroring validate-prompts.mjs/-core.mjs).
//
// Requires a prior `pnpm turbo run build` — imports each package's BUILT
// dist output (mirrors `scripts/lib/tool-catalog.mjs`'s `loadAllTools`
// pattern: a relative file:// dist import, bypassing each package's
// restrictive package.json "exports" map).
//
// Usage: node scripts/measure-tools-payload.mjs   (npm: pnpm measure:tools-payload)

import { resolve, dirname } from 'path';
import { readFile } from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';

import { SERVER_PACKAGES } from './lib/tool-catalog.mjs';
import { measureOne, buildMarkdownTable } from './lib/measure-tools-payload-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const PRESETS = ['full', 'core', 'developer'];

/** The package's published npm name + version (fed into McpServerBase's required `version`). */
async function loadPackageMeta(pkg) {
  const pkgJsonPath = resolve(root, `packages/${pkg}/package.json`);
  const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
  return { name: pkgJson.name, version: pkgJson.version };
}

/** Import a package's built `tools` array + `toolPresets` rosters from dist. */
async function loadPackageToolSurface(pkg) {
  const toolsEntry = resolve(root, `packages/${pkg}/dist/tools/index.js`);
  const presetsEntry = resolve(root, `packages/${pkg}/dist/tools/presets.js`);
  let toolsMod, presetsMod;
  try {
    toolsMod = await import(pathToFileURL(toolsEntry).href);
  } catch (e) {
    throw new Error(
      `measure-tools-payload: could not import built tools from ${toolsEntry}.\n` +
        `Did you run "pnpm turbo run build" first?\nUnderlying error: ${e?.message ?? e}`,
    );
  }
  try {
    presetsMod = await import(pathToFileURL(presetsEntry).href);
  } catch (e) {
    throw new Error(
      `measure-tools-payload: could not import built presets from ${presetsEntry}.\n` +
        `Did you run "pnpm turbo run build" first?\nUnderlying error: ${e?.message ?? e}`,
    );
  }
  const tools = toolsMod.tools;
  if (!Array.isArray(tools)) {
    throw new Error(
      `measure-tools-payload: ${pkg} dist/tools/index.js does not export a "tools" array.`,
    );
  }
  const toolPresets = presetsMod.toolPresets;
  if (!toolPresets || typeof toolPresets !== 'object') {
    throw new Error(
      `measure-tools-payload: ${pkg} dist/tools/presets.js does not export a "toolPresets" object.`,
    );
  }
  return { tools, toolPresets };
}

async function main() {
  // Import McpServerBase from the BUILT shared dist (this script itself runs
  // after `pnpm turbo run build`, mirroring gen-governance-baseline.mjs).
  const sharedEntry = resolve(root, 'packages/shared/dist/index.js');
  let sharedMod;
  try {
    sharedMod = await import(pathToFileURL(sharedEntry).href);
  } catch (e) {
    throw new Error(
      `measure-tools-payload: could not import built @iris-mcp/shared from ${sharedEntry}.\n` +
        `Did you run "pnpm turbo run build" first?\nUnderlying error: ${e?.message ?? e}`,
    );
  }
  const { McpServerBase } = sharedMod;
  if (typeof McpServerBase !== 'function') {
    throw new Error(
      'measure-tools-payload: @iris-mcp/shared dist does not export McpServerBase.',
    );
  }

  const results = [];
  for (const pkg of SERVER_PACKAGES) {
    const pkgMeta = await loadPackageMeta(pkg);
    const { tools, toolPresets } = await loadPackageToolSurface(pkg);
    const rows = {};
    for (const preset of PRESETS) {
      // eslint-disable-next-line no-await-in-loop
      rows[preset] = await measureOne(McpServerBase, pkgMeta, tools, toolPresets, preset);
    }
    results.push({ pkg, name: pkgMeta.name, rows });
  }

  const table = buildMarkdownTable(results);
  console.log(table);
  return table;
}

main().catch((err) => {
  console.error(err?.stack ?? err);
  process.exitCode = 1;
});
