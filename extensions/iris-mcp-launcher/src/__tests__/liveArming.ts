/**
 * Arming of the launcher's live-IRIS tests (`localSpawnIntegration.test.ts`, `governanceUiRoundTrip.test.ts`).
 *
 * The extension stays self-contained (AD-2: it cannot import `@iris-mcp/shared`), so this is its local copy of the
 * arming contract of `@iris-mcp/shared/test-helpers/live-target`:
 *
 * - A live leg is armed by `IRIS_REQUIRE_LIVE` set to exactly `1` or `true`, and by nothing else: a set `IRIS_HOST`
 *   does not arm it. Unarmed, `skipReason` says why and the leg skips before any probe or spawn.
 * - Armed, the target is `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD` and `IRIS_NAMESPACE`, all required
 *   and none defaulted; a missing one throws, naming it.
 *
 * Unarmed, `target` is an inert one under the reserved `.invalid` TLD that is never contacted. NOT a `*.test.ts` file,
 * so `vitest.config.ts` never collects it as a suite; it sits under `src/__tests__`, which `tsconfig.build.json`
 * excludes, so it never reaches `dist/` or the VSIX.
 */

/** Where an armed live leg reaches IRIS. */
export interface LiveTarget {
  host: string;
  port: number;
  username: string;
  password: string;
  namespace: string;
}

/** What a live test file resolves once, at import time. */
export interface LiveGate {
  /** Why the file's legs skip; `undefined` when armed. */
  skipReason: string | undefined;
  /** The armed target, or an inert one that is never contacted. */
  target: LiveTarget;
}

const TARGET_VARIABLES = ["IRIS_HOST", "IRIS_PORT", "IRIS_USERNAME", "IRIS_PASSWORD", "IRIS_NAMESPACE"] as const;

// The port is one that `fetch` does not block outright, so a leg that wrongly contacts the inert host reaches the
// connection layer, where the connect-refusing preload logs it.
const INERT_TARGET: LiveTarget = {
  host: "unarmed.invalid",
  port: 9999,
  username: "unarmed",
  password: "unarmed",
  namespace: "USER",
};

/**
 * Resolve the live target from `env`.
 *
 * @throws When `IRIS_REQUIRE_LIVE` arms the run and any of the five target variables is missing or empty.
 */
export function liveGateTarget(env: Record<string, string | undefined> = process.env): LiveGate {
  if (env["IRIS_REQUIRE_LIVE"] !== "1" && env["IRIS_REQUIRE_LIVE"] !== "true") {
    return {
      skipReason: `opt-in live leg: set IRIS_REQUIRE_LIVE=1 and ${TARGET_VARIABLES.join(", ")} to run it; a set IRIS_HOST alone does not arm it.`,
      target: { ...INERT_TARGET },
    };
  }
  const missing = TARGET_VARIABLES.filter((name) => (env[name] ?? "") === "");
  if (missing.length > 0) {
    throw new Error(
      `IRIS_REQUIRE_LIVE is set, so this live leg names its target explicitly, but ${missing.join(", ")} ` +
        `${missing.length === 1 ? "is" : "are"} not set. A live leg never falls back to a default instance: set ${TARGET_VARIABLES.join(", ")}.`,
    );
  }
  return {
    skipReason: undefined,
    target: {
      host: env["IRIS_HOST"] as string,
      port: Number(env["IRIS_PORT"]),
      username: env["IRIS_USERNAME"] as string,
      password: env["IRIS_PASSWORD"] as string,
      namespace: env["IRIS_NAMESPACE"] as string,
    },
  };
}
