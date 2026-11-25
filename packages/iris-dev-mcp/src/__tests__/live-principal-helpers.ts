/**
 * Helpers for the live gates that create and remove IRIS principals (users, roles) on a throwaway.
 *
 * Not a test file. `live-principal-helpers.test.ts` pins them in the default suite.
 */

import { IrisApiError } from "@iris-mcp/shared";

/**
 * True only for the answer `GET /api/executemcp/v2/security/user/{name}` gives when the user does not exist: HTTP 200 with an
 * Atelier envelope whose `status.errors` carries IRIS's `User <name> does not exist` (probed live on a throwaway, IRIS 2026.2,
 * 2026-11-25; the `ERROR #5001` prefix is locale-dependent, the rest is IRIS's own text). Every other failure (401 for a wrong
 * password, a 4xx or 5xx status, a different envelope error) is NOT "absent": a teardown assertion that treated it as absent
 * would pass without proving the user is gone (DW-763).
 */
export function isMissingUserError(error: unknown, name: string): boolean {
  if (!(error instanceof IrisApiError) || error.statusCode !== 200) return false;
  const needle = `User ${name} does not exist`;
  return error.errors.some(
    (entry) => typeof entry === "object" && entry !== null && typeof (entry as { error?: unknown }).error === "string" && ((entry as { error: string }).error).includes(needle),
  );
}
