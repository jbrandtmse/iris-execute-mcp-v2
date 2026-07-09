// Shared tool-name-reference validation logic (Epic 25, Story 25.1, AC 25.1.3).
//
// Pure functions with NO filesystem/dist-loading concerns, so the SAME
// module is imported by both `scripts/validate-prompts.mjs` (the CLI /
// default-suite-wired entry point per the story's Task 3) and
// `packages/iris-mcp-all/src/__tests__/validate-prompts.test.ts` (the
// default-suite vitest test) — "keep the validation logic single-sourced"
// per the story's Dev Notes.

/** Matches every `iris_<lowercase/digits/underscore>` token in a string. */
const IRIS_TOKEN_RE = /\biris_[a-z0-9_]+\b/g;

/**
 * Extract every `iris_[a-z0-9_]+` token from `text`, de-duplicated,
 * preserving first-seen order.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractIrisTokens(text) {
  const seen = new Set();
  const tokens = [];
  for (const match of text.matchAll(IRIS_TOKEN_RE)) {
    const token = match[0];
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * Render a `PromptDefinition`'s full text surface (title + description +
 * body) for token scanning. The body is rendered via `prompt.build({})` —
 * an OMITTED-everything call — which every Story 25.1 prompt author has
 * designed to fall back to a bracketed `<argName>` placeholder per
 * argument (see each prompt's local `arg()` helper), so the FULL
 * instructional text — including every literal tool-name reference — is
 * still produced even with no concrete argument values supplied.
 *
 * @param {{ title: string, description: string, build: (args: Record<string, string | undefined>) => string }} prompt
 * @returns {string}
 */
export function renderPromptText(prompt) {
  return `${prompt.title}\n${prompt.description}\n${prompt.build({})}`;
}

/**
 * Validate a set of labeled text sources against a set of known-valid tool
 * names, returning every (label, token) pair where the token does not match
 * a real tool name.
 *
 * @param {Array<{ label: string, text: string }>} sources
 * @param {Set<string>} validNames
 * @returns {Array<{ label: string, token: string }>}
 */
export function validateSources(sources, validNames) {
  const problems = [];
  for (const { label, text } of sources) {
    for (const token of extractIrisTokens(text)) {
      if (!validNames.has(token)) {
        problems.push({ label, token });
      }
    }
  }
  return problems;
}
