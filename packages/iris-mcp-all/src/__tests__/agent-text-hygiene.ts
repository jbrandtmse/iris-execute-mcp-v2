/**
 * Shared text checks for agent content that a user's agent will read: the always-on rule and the knowledge skills.
 *
 * FORBIDDEN lists what such text must not carry (an internal rule number, a planning id, a repository path or file,
 * repository tooling, a tool or server name, a mention of how its claims were checked, a reference to this project).
 * Each entry carries a sample that the pattern flags, so a test can prove the pattern still matches. problemsOf
 * names the classes a text trips. wordCount counts words as the size budgets do. A caller with a legitimate use of
 * a class (an IRIS code such as `#1043:`, an IRIS qualifier such as `/noload/nodelete/norecursive`) swaps that
 * entry for its own and says why next to the swap.
 *
 * Pure functions and one constant; no filesystem and no IRIS.
 */

/** What agent content for another project must not carry, by the name each pattern is reported under. */
export const FORBIDDEN: Array<[name: string, pattern: RegExp, sample: string]> = [
  ["a number sign and digits that are not an IRIS error code", /(?<!ERROR )#\d+/, "see rule #7 or item #58"],
  ["a story, epic or sprint number", /\b(?:Story|Epic|Sprint)\s+\d/i, "added in Story 41.2"],
  ["a planning or deferred-work id", /\b(?:DW|AD|AC|NFR|FR)-\d+/, "tracked as DW-615"],
  ["a snapshot folder of this repository", /\birislib\b|\birissys\b/, "read irislib for the class"],
  // Case-sensitive: `tSC` is the ObjectScript status variable the rule's examples use.
  ["repository tooling", /\b(?:pnpm|npm|npx|turbo|vitest|tsc|gen:pack|gen:skills)\b/, "run pnpm test or tsc"],
  ["a repository file", /\b[\w-]+\.(?:md|ts|mjs|json|yaml|toml)\b/i, "edit rules.md"],
  ["a path", /[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/, "see packages/shared"],
  ["a URL", /https?:\/\//i, "docs at https://example.com"],
  ["a tool or server name", /\biris[-_][a-z]|mcp__|@iris-mcp/i, "use iris-dev or mcp__iris-dev__tool"],
  ["a client configuration file", /\b(?:CLAUDE|AGENTS)\.md\b|\.claude\b|\.cursor\b/, "put it in CLAUDE.md"],
  ["the retired prompt", /objectscript-review/, "run the objectscript-review prompt"],
  ["a mention of how the claims were checked", /\bprobe[sd]?\b/i, "verified by a probe"],
  ["this project", /\bthis (?:project|repo|repository)\b/i, "in this repo"],
];

/** The names of the FORBIDDEN classes the text trips, in list order. */
export function problemsOf(text: string): string[] {
  return FORBIDDEN.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

/** Whitespace-separated tokens that hold at least one letter or digit (a bare "-" bullet marker is no word). */
export function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => /[A-Za-z0-9]/.test(word)).length;
}
