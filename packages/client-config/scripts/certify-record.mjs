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

/**
 * 36.3, 33-5-L9 leg (a) — the restore-ladder DECISION, extracted from
 * `certify.mjs`'s `restoreAndClean()` so it is unit-testable without
 * staging a real certification pass (rung 2, the engine `restore --backup`
 * step, previously had no test coverage at all). Pure: given whether the
 * config already matches the pre-pass snapshot right now, and the
 * pass-created backup inventory, decides the next rung — never performs
 * any I/O itself.
 *
 * Called TWICE by the real ladder: once after the natural remove round-trip
 * (rung "none"/"engine-restore"/"raw-restore" with `engineRestoreAttempted:
 * false`), and — only when an engine-restore was actually attempted and the
 * config STILL does not match — a second time with `engineRestoreAttempted:
 * true`, which forces straight to "raw-restore" (never retries the same
 * engine restore).
 *
 * @param {object} args
 * @param {boolean} args.configMatches - byte-exact against the pre-pass snapshot RIGHT NOW
 * @param {string[]} args.availableBackups - pass-created backup basenames (any order)
 * @param {boolean} args.engineRestoreAttempted - an engine restore was already tried this ladder run
 * @returns {{ rung: "none" } | { rung: "engine-restore"; backup: string } | { rung: "raw-restore" }}
 */
export function decideRestoreRung({ configMatches, availableBackups, engineRestoreAttempted }) {
  if (configMatches) return { rung: "none" };
  if (!engineRestoreAttempted && availableBackups.length > 0) {
    const earliest = [...availableBackups].sort()[0];
    return { rung: "engine-restore", backup: earliest };
  }
  return { rung: "raw-restore" };
}

/**
 * 36.3, 33-5-L9 leg (b) — a `" [TIMED OUT]"` suffix when a spawned command
 * (a `run()`/`runMaybeShim()` result carrying a `timedOut` boolean) hit its
 * timeout. The field was computed but never consumed anywhere; every
 * evidence site that reports a spawn result now surfaces it instead of
 * silently dropping the signal.
 *
 * @param {{ timedOut?: boolean }} result
 * @returns {string}
 */
export function timeoutSuffix(result) {
  return result.timedOut ? " [TIMED OUT]" : "";
}

/**
 * 36.3, 33-5-L9 leg (c) — truncate `text` on a WORD boundary, never
 * mid-token. A hard slice at exactly `max` characters can land inside a
 * word, producing an illegible half-token in the evidence record; this
 * backs off to the last space at-or-before `max` when there is one
 * reasonably close (at least half of `max` in), else hard-cuts (a single
 * token longer than `max` has no boundary to back off to).
 *
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function excerpt(text, max = 400) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  const cut = oneLine.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const boundary = lastSpace >= Math.floor(max * 0.5) ? lastSpace : max;
  return `${cut.slice(0, boundary)}…`;
}

/** The VALUED options `certify.mjs` accepts; everything else starting with `--` is a boolean switch. */
const VALUED_OPTIONS = new Set(["--server", "--residual-risk"]);

/**
 * Parse `certify.mjs`'s argv (after `node certify.mjs`). 33-5-L9's Set-vs-Map
 * leg, extracted here at the Story 36.3 code review so it is unit-testable —
 * `certify.mjs` itself runs a real certification pass on import, so its
 * inline parser had no test at all, and the dev-stage refactor shipped a
 * regression: `options.set("--residual-risk", argv[++i])` stored `undefined`
 * for a trailing `--residual-risk` with no value, and the record merge then
 * overwrote a hand-set `residualRisk` with it (the pre-refactor truthiness
 * guard had kept it).
 *
 * Boolean switches go into `flags` (a Set, `.has("--foo")`); valued options
 * into `options` (a Map), and ONLY when a real value follows — a missing,
 * empty, or `--`-prefixed next token is not a value (the `--` token stays
 * available as the switch it is).
 *
 * @param {string[]} argv
 * @returns {{ subcommand: string | undefined, positional: string[], flags: Set<string>, options: Map<string, string> }}
 */
export function parseCertifyArgs(argv) {
  const positional = [];
  const flags = new Set();
  const options = new Map();
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUED_OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (typeof value === "string" && value !== "" && !value.startsWith("--")) {
        options.set(arg, value);
        i++;
      }
    } else if (arg.startsWith("--")) {
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }
  return { subcommand: argv[0], positional, flags, options };
}
