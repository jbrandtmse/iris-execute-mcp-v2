/**
 * Shared helper for the source-grep style tests (`containment.test.ts`,
 * `packaging.test.ts`). Single-sourced deliberately: both files grep the same
 * `src/*.ts` text for structural guarantees, and two divergent comment
 * strippers would mean one guard silently checks prose while the other checks
 * code (code review, Story 31.5).
 *
 * NOT a `*.test.ts` file, so `vitest.config.ts`'s
 * `include: ["src/__tests__/ **\/*.test.ts"]` never collects it as a suite; it
 * also sits under `src/__tests__`, which `tsconfig.build.json` excludes, so it
 * never reaches `dist/` or the VSIX.
 */

/**
 * Strip block (`/* ... *\/`) and line (`// ...`) comments so a source grep
 * matches CODE, not prose.
 *
 * The `(^|[^:])` guard keeps a `//` inside a URL (`https://…`) from truncating
 * the rest of a real code line. Imperfect — a `//` inside a non-URL string
 * literal is still stripped — but strictly safer than a bare `/\/\/.*$/gm`,
 * and it errs toward removing text, i.e. toward a check that under-matches
 * rather than one that fires on a doc comment. That direction matters: a
 * `registerCommand("x")` written inside a doc comment must not register a
 * phantom id, and a forbidden identifier named in prose to explain its own
 * absence must not trip a containment check.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
