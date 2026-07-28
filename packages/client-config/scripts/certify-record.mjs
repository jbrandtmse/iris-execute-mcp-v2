/**
 * `certify-record.mjs` — the certification record-merge and pass-created
 * path logic, extracted from `certify.mjs` (Story 33.5, AC 33.5.6a/b +
 * 33-5-18) so the behavior is unit-testable without staging a full
 * real-config certification pass.
 */

/**
 * AC 33.5.6a/b — decide what a finished pass does to the results file.
 *
 * - (a) keep-passing guard: a FAILED pass never overwrites an existing
 *   `certified-live` record — the passing evidence stands until a passing
 *   re-run replaces it. Returns { action: "keep" }.
 * - (b) merge, never wholesale-replace: the new record is spread OVER the
 *   existing one, so hand-authored evidence keys (`sharing`, `ac3344`,
 *   `note`, a hand-set `residualRisk`) survive a re-run.
 *
 * @param {object | undefined} existing - the current record for the client (if any)
 * @param {object} record - the new pass record
 * @param {boolean} passOk - whether the pass succeeded
 * @returns {{ action: "keep" } | { action: "write", merged: object }}
 */
export function mergeCertificationRecord(existing, record, passOk) {
  if (!passOk && existing?.disposition === "certified-live") {
    return { action: "keep" };
  }
  return { action: "write", merged: { ...(existing ?? {}), ...record } };
}

/**
 * 33-5-18 — the paths a pass CREATED: post-pass entries not present
 * pre-pass. Used for both backup FILES and backup DIRECTORIES; callers
 * delete files first, then the pass-created directories deepest-first
 * (length-descending) so empty shells never strand.
 *
 * @param {string[]} pre - entries before the pass
 * @param {string[]} post - entries after the pass
 * @returns {string[]} pass-created entries, deepest-first
 */
export function passCreatedPaths(pre, post) {
  return post.filter((entry) => !pre.includes(entry)).sort((a, b) => b.length - a.length || a.localeCompare(b));
}
