/**
 * The real-shape fakes of Atelier's answer to a PUT of an existing document that carries no version
 * token, shared by the tests of the document-writing tools. Captured live on 2026-10-15 (IRIS 2026.2
 * build 221U, Atelier v8, HSCUSTOM): HTTP 409, whose result is the document as it is now, with the same
 * nine keys as a GET.
 */

import { IrisApiError } from "@iris-mcp/shared";

/** The version token (`ts`) that the 409 carries for the document as it is now. */
export const TS_CURRENT = "2026-10-15 17:58:02.301";

/**
 * The current document of an existing class as the 409 carries it: the same nine keys as a GET, with
 * the class's lines (and a trailing empty element) in `content`.
 */
export function currentClass(lines: string[], ts = TS_CURRENT): Record<string, unknown> {
  return {
    name: "Test.Fixture.cls",
    db: "HSCUSTOM",
    ts,
    upd: false,
    cat: "CLS",
    status: "",
    enc: false,
    flags: 0,
    content: [...lines, ""],
  };
}

/** The HTTP 404 the shared client throws for a GET of a document that does not exist. */
export function notFound(path: string): IrisApiError {
  return new IrisApiError(404, [], path, `IRIS returned HTTP 404 for GET ${path}.`, null);
}

/** The HTTP 409 the shared client throws for a put to an existing document that carries no version token. */
export function conflict(path: string, result: unknown): IrisApiError {
  return new IrisApiError(
    409,
    [],
    path,
    `IRIS returned HTTP 409 for PUT ${path}. Check the request parameters and try again.`,
    result,
  );
}
