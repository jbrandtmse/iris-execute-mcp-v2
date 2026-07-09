// Shared prompt-catalog loader (Epic 25, Story 25.1).
//
// Loads every registered PromptDefinition across the prompt-owning server
// packages from their BUILT dist output (packages/<pkg>/dist/prompts/index.js),
// mirroring scripts/lib/tool-catalog.mjs's approach. Requires a prior
// `pnpm turbo run build`.
//
// Single source of truth for prompt content enumeration: used by
// scripts/gen-skills.mjs, scripts/validate-prompts.mjs, and
// packages/iris-mcp-all's default-suite vitest test.

import { resolve } from 'path';
import { pathToFileURL } from 'url';

/**
 * The server packages that own at least one prompt in v1 (Epic 25, Story
 * 25.1). `iris-data-mcp` ships no prompts and is deliberately excluded.
 */
export const PROMPT_PACKAGES = [
  'iris-ops-mcp',
  'iris-dev-mcp',
  'iris-interop-mcp',
  'iris-admin-mcp',
];

/**
 * Load every prompt (as `{ pkg, prompt }`) across all prompt-owning server
 * packages.
 *
 * @param {string} root - Repository root (absolute path).
 * @returns {Promise<Array<{ pkg: string, prompt: import('../../packages/shared/src/tool-types.js').PromptDefinition }>>}
 */
export async function loadAllPrompts(root) {
  const out = [];
  for (const pkg of PROMPT_PACKAGES) {
    const distEntry = resolve(root, `packages/${pkg}/dist/prompts/index.js`);
    let mod;
    try {
      mod = await import(pathToFileURL(distEntry).href);
    } catch (e) {
      throw new Error(
        `prompt-catalog: could not import built prompts from ${distEntry}.\n` +
          `Did you run "pnpm turbo run build" first? This helper imports the\n` +
          `compiled dist/ output, so it must run after the build.\n` +
          `Underlying error: ${e?.message ?? e}`,
      );
    }
    const prompts = mod.prompts;
    if (!Array.isArray(prompts)) {
      throw new Error(
        `prompt-catalog: ${pkg} dist/prompts/index.js does not export a "prompts" array.`,
      );
    }
    for (const prompt of prompts) out.push({ pkg, prompt });
  }
  return out;
}
