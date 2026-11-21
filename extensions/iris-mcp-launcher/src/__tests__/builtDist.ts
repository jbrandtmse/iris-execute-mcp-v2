/**
 * The skip of a real-CLI test file whose build is missing (Story 42.7 code review, Rule #59).
 *
 * The real-CLI files (`clientsEngineRealCli`, `clientsPanelRealCli`, `governanceEngineRealCli`) and the env-contract file read
 * built dists of the monorepo. On a checkout that has not been built they skip, so that a fresh clone can run the suite. On CI
 * (GitHub Actions sets `CI=true` on every runner) the `launcher` job builds every package first, so a skip there means a dist
 * or a resolution is broken: the test fails instead, naming the reason. A narrowed build once left a whole real-CLI file
 * skipped on all three legs while each leg was green. The two live files (`liveArming.ts`) skip unarmed on CI too: they do
 * not use this helper.
 *
 * NOT a `*.test.ts` file, so `vitest.config.ts` never collects it as a suite; `tsconfig.build.json` excludes `src/__tests__`.
 */

/** Whether a test runs on CI, where every dist is built before the suite. */
export function onCi(env: Record<string, string | undefined> = process.env): boolean {
  return env.CI === "true";
}

/**
 * Skip the test when `reason` is set, or throw on CI. Returns whether it skipped; `false` when `reason` is `undefined`.
 *
 * @param label what the test is, for the log line and the error.
 */
export function skipUnbuilt(
  ctx: { skip: () => void },
  label: string,
  reason: string | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (reason === undefined || reason === "") return false;
  if (onCi(env)) {
    throw new Error(`${label} may not skip on CI, where the launcher job builds every package first: ${reason}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[SKIP] ${label}: ${reason}`);
  ctx.skip();
  return true;
}
