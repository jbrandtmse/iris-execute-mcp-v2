// IRIS connection target for `scripts/verify-iris-reachable.mjs` (ledger DW-388).
//
// The release-boundary reachability check historically fell back to local-dev values for
// every IRIS variable that was unset, silently. A permissive local default must never loosen
// a check that exists to protect a release (architecture AD-9), so the fallback is now
// explicit: `resolveIrisTarget` reports exactly which variables it defaulted, and refuses
// outright when the process runs under CI.
//
// Pure by design (no I/O, no process access): the caller hands in the environment and acts on
// the result. The script itself is top-level-await and cannot be imported by a test; this
// module can.

/** The six connection variables the reachability check reads, in reporting order. */
export const IRIS_TARGET_VARIABLES = [
  'IRIS_HOST',
  'IRIS_PORT',
  'IRIS_USERNAME',
  'IRIS_PASSWORD',
  'IRIS_NAMESPACE',
  'IRIS_HTTPS',
];

/** The documented local-dev fallback for each variable (this repo's `.vscode` dev instance). */
const LOCAL_DEV_DEFAULTS = {
  IRIS_HOST: 'localhost',
  IRIS_PORT: '52773',
  IRIS_USERNAME: '_SYSTEM',
  IRIS_PASSWORD: 'SYS',
  IRIS_NAMESPACE: 'HSCUSTOM',
  IRIS_HTTPS: 'false',
};

/**
 * Whether the environment declares a CI run: `CI` is set to anything other than the empty
 * string, `0` or `false` (case-insensitive). Unset, `""`, `0` and `false` mean "not CI".
 *
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
function isCi(env) {
  const value = env.CI;
  if (value === undefined) return false;
  const normalized = value.toLowerCase();
  return normalized !== '' && normalized !== '0' && normalized !== 'false';
}

/**
 * Resolve the IRIS connection environment for the reachability check.
 *
 * A variable is "defaulted" when it is `undefined` in `env` (an empty string is a value the
 * operator set, and is passed through unchanged). The fallback values are the documented
 * local-dev ones, and `IRIS_NAMESPACE` stays `HSCUSTOM` so the check keeps probing the
 * development namespace regardless of the suite's own `USER` default.
 *
 * @param {Record<string, string | undefined>} env - Normally `process.env`.
 * @returns {{
 *   env: Record<string, string | undefined>,
 *   defaulted: string[],
 *   ciRefusal: string | undefined
 * }} `env` is the resolved six-variable object to hand to `loadConfig`; `defaulted` names every
 *   variable that fell back (in {@link IRIS_TARGET_VARIABLES} order); `ciRefusal` is a message
 *   naming them when a variable was defaulted under CI, else `undefined`.
 */
export function resolveIrisTarget(env) {
  const resolved = {};
  const defaulted = [];
  for (const name of IRIS_TARGET_VARIABLES) {
    const value = env[name];
    if (value === undefined) {
      resolved[name] = LOCAL_DEV_DEFAULTS[name];
      defaulted.push(name);
    } else {
      resolved[name] = value;
    }
  }

  const ciRefusal =
    defaulted.length > 0 && isCi(env)
      ? `CI is set but ${defaulted.join(', ')} ${defaulted.length === 1 ? 'is' : 'are'} not. ` +
        'A release check must name its target explicitly - local-dev defaults are never used ' +
        'under CI. Export the variable(s) and retry.'
      : undefined;

  return { env: resolved, defaulted, ciRefusal };
}
