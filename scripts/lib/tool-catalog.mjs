// Shared tool-catalog loader (Epic 25, Story 25.1).
//
// Loads every registered tool across the five server packages from their
// BUILT dist output (mirrors scripts/gen-governance-baseline.mjs's
// deriveLiveKeys() approach — imports packages/<pkg>/dist/tools/index.js via
// a relative file:// URL, which bypasses each package's restrictive
// package.json "exports" map since it is a direct path import, not a bare
// specifier resolution). Requires a prior `pnpm turbo run build`.
//
// Used by scripts/validate-prompts.mjs, packages/iris-mcp-all's default-suite
// vitest tests (validate-prompts.test.ts, readonly-hint-crosscheck.test.ts),
// and (indirectly) anything else needing the live tool surface without
// duplicating the enumeration logic.

import { resolve } from 'path';
import { pathToFileURL } from 'url';

/**
 * The five server packages whose tools form the suite's tool surface.
 * Mirrors `packages/shared/src/governance-baseline-derivation.ts`'s
 * `SERVER_PACKAGES` (kept as a separate literal here — this module is a
 * plain .mjs script-side helper, not a `@iris-mcp/shared` export, so it
 * cannot import that TS module without its own build step; the five-package
 * list is a stable, rarely-changing constant, unlike per-tool key
 * derivation logic).
 */
export const SERVER_PACKAGES = [
  'iris-dev-mcp',
  'iris-admin-mcp',
  'iris-interop-mcp',
  'iris-ops-mcp',
  'iris-data-mcp',
];

/**
 * Load every tool object (raw built-dist `ToolDefinition`-like object) across
 * all five server packages.
 *
 * @param {string} root - Repository root (absolute path).
 * @returns {Promise<Array<{ pkg: string, tool: any }>>}
 */
export async function loadAllTools(root) {
  const out = [];
  for (const pkg of SERVER_PACKAGES) {
    const distEntry = resolve(root, `packages/${pkg}/dist/tools/index.js`);
    let mod;
    try {
      mod = await import(pathToFileURL(distEntry).href);
    } catch (e) {
      throw new Error(
        `tool-catalog: could not import built tools from ${distEntry}.\n` +
          `Did you run "pnpm turbo run build" first? This helper imports the\n` +
          `compiled dist/ output, so it must run after the build.\n` +
          `Underlying error: ${e?.message ?? e}`,
      );
    }
    const tools = mod.tools;
    if (!Array.isArray(tools)) {
      throw new Error(
        `tool-catalog: ${pkg} dist/tools/index.js does not export a "tools" array.`,
      );
    }
    for (const tool of tools) out.push({ pkg, tool });
  }
  return out;
}

/**
 * Every real tool NAME across all five server packages, plus the
 * framework-provided server & governance discovery tool
 * (`iris_server_profiles`, registered centrally by `McpServerBase` — Epic 19,
 * decision E1 — so it is not present in any package's own `tools` array).
 *
 * @param {string} root - Repository root (absolute path).
 * @returns {Promise<Set<string>>}
 */
export async function loadAllToolNames(root) {
  const all = await loadAllTools(root);
  const names = new Set(all.map(({ tool }) => tool.name));
  // Framework tool (Rule #31 — not a member of any package's tool array).
  names.add('iris_server_profiles');
  return names;
}
