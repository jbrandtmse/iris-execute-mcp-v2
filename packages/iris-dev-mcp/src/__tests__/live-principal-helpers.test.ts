/**
 * Story 45.1 QA (DW-763) - `isMissingUserError` is the only thing the privilege gate's teardown accepts as "the user is gone".
 *
 * The oracle is a live capture, not the implementation (Rule #36): `GET /api/executemcp/v2/security/user/QaNoSuchUser451` as `_SYSTEM`
 * on a throwaway (IRIS 2026.2, `intersystems/irishealth-community:2026.2@sha256:462de1fb...af0a`, 2026-11-25) answered HTTP 200 with
 * `{"status":{"errors":[{"error":"<prefix> #5001: User QaNoSuchUser451 does not exist","code":5001,"domain":"%ObjectErrors",
 * "id":"GeneralError","params":["User QaNoSuchUser451 does not exist"]}],...},"result":{}}`; with a wrong password it answered
 * HTTP 401 with an empty body. `http-client.ts` turns the first into `IrisApiError(200, errors, ...)` and the second into
 * `IrisApiError(401, [], ...)` (non-JSON response). The gate used to treat every `IrisApiError` as "absent", so a 401 or a 500 made
 * its teardown assertion pass without proving anything. Needs no IRIS.
 */

import { describe, it, expect } from "vitest";
import { IrisApiError } from "@iris-mcp/shared";
import { isMissingUserError } from "./live-principal-helpers.js";

const PATH = "/api/executemcp/v2/security/user/QaNoSuchUser451";

/** The captured errors array, with the English and the Arabic prefix the instance's NLS tables can give it. */
const capturedErrors = (prefix: string): unknown[] => [
  {
    error: `${prefix} #5001: User QaNoSuchUser451 does not exist`,
    code: 5001,
    domain: "%ObjectErrors",
    id: "GeneralError",
    params: ["User QaNoSuchUser451 does not exist"],
  },
];

describe("isMissingUserError (DW-763): only the route's own 'User <name> does not exist' answer counts as absent", () => {
  it("accepts the captured answer, whatever the locale prefix", () => {
    for (const prefix of ["ERROR", "خطأ"]) {
      const error = new IrisApiError(200, capturedErrors(prefix), PATH, "IRIS reported errors for GET " + PATH + ".");
      expect(isMissingUserError(error, "QaNoSuchUser451"), prefix).toBe(true);
    }
  });

  it("rejects the same answer for a different user name, including a name that is a prefix or a suffix of it", () => {
    const error = new IrisApiError(200, capturedErrors("ERROR"), PATH);
    for (const other of ["QaNoSuchUser45", "NoSuchUser451", "Other", ""]) expect(isMissingUserError(error, other), other).toBe(false);
  });

  it("rejects a 401 (wrong password: empty errors), a 403, a 404 and a 500, even with the captured text", () => {
    expect(isMissingUserError(new IrisApiError(401, [], PATH, "IRIS returned HTTP 401 ... non-JSON response."), "QaNoSuchUser451")).toBe(false);
    for (const status of [401, 403, 404, 500]) {
      expect(isMissingUserError(new IrisApiError(status, capturedErrors("ERROR"), PATH), "QaNoSuchUser451"), String(status)).toBe(false);
    }
  });

  it("rejects an HTTP 200 envelope that carries a different error, an empty or malformed errors array", () => {
    const denied = [{ error: "ERROR #5001: Access denied", code: 5001, domain: "%ObjectErrors", id: "GeneralError", params: ["Access denied"] }];
    for (const errors of [denied, [], ["User QaNoSuchUser451 does not exist"], [null], [{ error: 5 }], [{ params: ["User QaNoSuchUser451 does not exist"] }]]) {
      expect(isMissingUserError(new IrisApiError(200, errors as unknown[], PATH), "QaNoSuchUser451"), JSON.stringify(errors)).toBe(false);
    }
  });

  it("rejects anything that is not an IrisApiError", () => {
    for (const value of [new Error("User QaNoSuchUser451 does not exist"), "User QaNoSuchUser451 does not exist", null, undefined, {}]) {
      expect(isMissingUserError(value, "QaNoSuchUser451")).toBe(false);
    }
  });
});
