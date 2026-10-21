/**
 * The one place a live-IRIS test leg decides whether it is armed, and where it points.
 *
 * ARMING. A live leg is armed by `IRIS_REQUIRE_LIVE` set to `1` or `true`, and by nothing
 * else: a set `IRIS_HOST` does not arm it, because users export `IRIS_HOST` to run the
 * servers. Unarmed, a leg skips before it makes any request.
 *
 * TARGET. Armed, the target is the five variables `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`,
 * `IRIS_PASSWORD` and `IRIS_NAMESPACE`, all required and none defaulted: a leg never falls
 * back to whatever instance happens to answer on localhost. `IRIS_HTTPS` is optional
 * (`false`). An armed run with a variable missing throws, naming the missing ones.
 *
 * Test code reaches the target only through this module. `live-arming-guard.test.ts` (in
 * `@iris-mcp/all`) scans every test file for an inline `process.env.IRIS_* ?? "<default>"`
 * and for the retired `IRIS_TEST_*` names, and runs every live-capable file with no arming
 * variable under a connection-refusing preload.
 *
 * In-repo only: `package.json` `exports` lists it, `publishConfig.exports` does not.
 */

/** The variables an armed run must set. */
export const LIVE_TARGET_VARIABLES = [
  "IRIS_HOST",
  "IRIS_PORT",
  "IRIS_USERNAME",
  "IRIS_PASSWORD",
  "IRIS_NAMESPACE",
] as const;

/** Where an armed live leg reaches IRIS. */
export interface LiveTarget {
  host: string;
  port: string;
  username: string;
  password: string;
  namespace: string;
  /** From `IRIS_HTTPS` (`true` selects https; anything else, or unset, is http). */
  https: boolean;
}

/** The outcome of {@link resolveLiveTarget}. */
export type LiveTargetResolution =
  | { armed: false; reason: string }
  | { armed: true; requireLive: true; target: LiveTarget };

/** The environment a resolution reads: normally `process.env`. */
export type LiveEnv = Record<string, string | undefined>;

/**
 * Whether `env` arms a live leg: `IRIS_REQUIRE_LIVE` is exactly `1` or `true`.
 * `IRIS_HOST` and every other variable are irrelevant.
 */
export function isLiveArmed(env: LiveEnv = process.env): boolean {
  return env["IRIS_REQUIRE_LIVE"] === "1" || env["IRIS_REQUIRE_LIVE"] === "true";
}

/**
 * Resolve the live target.
 *
 * - Unarmed: `{ armed: false, reason }`, decided before anything else is read.
 * - Armed with all five variables set (non-empty): `{ armed: true, requireLive: true, target }`.
 * - Armed with any variable missing or empty: throws, naming the missing variables.
 *
 * `requireLive` is `true` whenever a leg is armed. What an armed leg does when IRIS does
 * not answer is the leg's own contract: a gate throws instead of skipping, and an
 * integration setup reports IRIS unavailable so that its tests skip.
 */
export function resolveLiveTarget(env: LiveEnv = process.env): LiveTargetResolution {
  if (!isLiveArmed(env)) {
    return {
      armed: false,
      reason:
        `opt-in live leg: set IRIS_REQUIRE_LIVE=1 and ${LIVE_TARGET_VARIABLES.join(", ")} to run it; ` +
        "without IRIS_REQUIRE_LIVE it reaches no IRIS (a set IRIS_HOST does not arm it).",
    };
  }
  const missing = LIVE_TARGET_VARIABLES.filter((name) => (env[name] ?? "") === "");
  if (missing.length > 0) {
    throw new Error(
      `IRIS_REQUIRE_LIVE is set, so this live leg names its target explicitly, but ${missing.join(", ")} ` +
        `${missing.length === 1 ? "is" : "are"} not set. A live leg never falls back to a default instance: ` +
        `set ${LIVE_TARGET_VARIABLES.join(", ")} (IRIS_HTTPS is optional).`,
    );
  }
  return {
    armed: true,
    requireLive: true,
    target: {
      host: env["IRIS_HOST"] as string,
      port: env["IRIS_PORT"] as string,
      username: env["IRIS_USERNAME"] as string,
      password: env["IRIS_PASSWORD"] as string,
      namespace: env["IRIS_NAMESPACE"] as string,
      https: env["IRIS_HTTPS"] === "true",
    },
  };
}

/**
 * The target a test file holds when it is not armed. It is never contacted: its host is
 * under the reserved `.invalid` TLD, which never resolves, and every leg checks
 * {@link LiveGate.skipReason} before it makes a request. It exists so that a test file can
 * read `TARGET.namespace` at import time without a branch, and loads through `loadConfig`.
 * Its port is one that `fetch` does not block outright, so a leg that wrongly contacts it
 * reaches the connection layer, where the connect-refusing preload logs it.
 */
export const UNARMED_LIVE_TARGET: Readonly<LiveTarget> = Object.freeze({
  host: "unarmed.invalid",
  port: "9999",
  username: "unarmed",
  password: "unarmed",
  namespace: "USER",
  https: false,
});

/** What a live test file resolves once, at import time. */
export interface LiveGate {
  /** Why the file's legs skip; `undefined` when armed. */
  skipReason: string | undefined;
  /** The armed target, or {@link UNARMED_LIVE_TARGET} (never contacted) when not. */
  target: LiveTarget;
}

/**
 * {@link resolveLiveTarget} shaped for a test file's import-time constants. Throws, as
 * `resolveLiveTarget` does, when armed with a variable missing.
 */
export function liveGateTarget(env: LiveEnv = process.env): LiveGate {
  const resolution = resolveLiveTarget(env);
  if (!resolution.armed) {
    return { skipReason: resolution.reason, target: { ...UNARMED_LIVE_TARGET } };
  }
  return { skipReason: undefined, target: resolution.target };
}

/** The `IRIS_*` settings that make a spawned server or `loadConfig` call reach `target`. */
export function liveConnectionEnv(target: LiveTarget): Record<string, string> {
  return {
    IRIS_HOST: target.host,
    IRIS_PORT: target.port,
    IRIS_USERNAME: target.username,
    IRIS_PASSWORD: target.password,
    IRIS_NAMESPACE: target.namespace,
    IRIS_HTTPS: target.https ? "true" : "false",
  };
}
