/**
 * Small, stable identifiers owned by the InterSystems Server Manager
 * extension, hardcoded here rather than imported at runtime from
 * `@intersystems-community/intersystems-servermanager` — that package is kept
 * as a `devDependency` (types + this extension's own regression test, which
 * imports its REAL runtime constants and asserts they still equal these) so
 * this extension's `dist/*.js` output has NO npm runtime dependency at all —
 * simpler to package (no `node_modules` bundling step / esbuild needed for a
 * single tiny extension) and smaller.
 *
 * Verified 2026-07-25 against `@intersystems-community/intersystems-servermanager@3.10.2`'s
 * `index.js`:
 * ```js
 * module.exports = {
 *   EXTENSION_ID: 'intersystems-community.servermanager',
 *   AUTHENTICATION_PROVIDER: 'intersystems-server-credentials'
 * };
 * ```
 * `src/__tests__/constants.test.ts` imports the real package and pins these
 * values against it, so a future version bump that changes either string is
 * caught mechanically rather than silently drifting.
 */

/** The Server Manager extension's own id, as declared in ITS `package.json` (`intersystems-community.servermanager`). */
export const SERVER_MANAGER_EXTENSION_ID = "intersystems-community.servermanager";

/** The authentication provider id Server Manager registers for `vscode.authentication.getSession`. */
export const AUTHENTICATION_PROVIDER = "intersystems-server-credentials";
