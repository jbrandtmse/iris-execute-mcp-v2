// The no-endorsement deny-list of the suite (AD-28): nothing that names or describes the suite presents it as InterSystems', as official or as
// endorsed. One implementation behind the package-manifest test and the provenance check's `plugin` rule (Story 42.8).
//
// A text may carry the suite's own non-endorsement sentence ({@link NO_ENDORSEMENT_SENTENCE}); the deny-list reads the text without it, because
// that sentence says "endorsed" and "by InterSystems" in order to deny them. Pure: no file system and no process access.

/** The sentence a description may end with to deny endorsement (the wording of the IPM packaging repository's README). */
export const NO_ENDORSEMENT_SENTENCE = 'This is an independent community project. It is not made, endorsed or supported by InterSystems.';

/** The claims a name or a description may not make, each with the label a problem carries. */
const CLAIMS = Object.freeze([
  Object.freeze({ pattern: /\bofficial\b/i, label: 'says "official"' }),
  Object.freeze({ pattern: /\bendorsed\b/i, label: 'says "endorsed"' }),
  Object.freeze({ pattern: /\bby\s+InterSystems\b/i, label: 'says "by InterSystems"' }),
]);

/** The words a name may not hold: a vendor's, and the ones Claude Code's marketplace validator rejects. */
const NAME_WORDS = Object.freeze([
  Object.freeze({ pattern: /intersystems/i, label: 'contains "intersystems"' }),
  Object.freeze({ pattern: /claude/i, label: 'contains "claude"' }),
  Object.freeze({ pattern: /anthropic/i, label: 'contains "anthropic"' }),
]);

/**
 * What a name-like or description-like text claims: one problem per claim it makes, labelled with `field`. The non-endorsement sentence is
 * removed first. Empty means the text makes no claim.
 *
 * @param {string} field - What the text is (`name`, `displayName`, `description`, `title`, `keyword`).
 * @param {unknown} text
 * @returns {string[]}
 */
export function endorsementProblems(field, text) {
  const read = String(text ?? '').split(NO_ENDORSEMENT_SENTENCE).join('');
  return CLAIMS.filter(({ pattern }) => pattern.test(read)).map(({ label }) => `${field} ${label}`);
}

/**
 * What a package or plugin name holds that it may not: a vendor's name, or "claude" or "anthropic".
 *
 * @param {unknown} name
 * @returns {string[]}
 */
export function nameProblems(name) {
  const read = String(name ?? '');
  return NAME_WORDS.filter(({ pattern }) => pattern.test(read)).map(({ label }) => `name ${label}`);
}

/**
 * What a description starts with that it may not: the vendor's name, which would read as the vendor's own.
 *
 * @param {unknown} description
 * @returns {string[]}
 */
export function descriptionStartProblems(description) {
  return /^\s*InterSystems/i.test(String(description ?? '')) ? ['description starts with InterSystems'] : [];
}
