import { describe, it, expect } from "vitest";
import { atelierDocRequest, atelierDocStatusError } from "../atelier.js";
import { IrisApiError } from "../errors.js";
import * as shared from "../index.js";

describe("atelierDocStatusError", () => {
  it("returns the status text when it is a non-empty string", () => {
    expect(
      atelierDocStatusError({
        name: "X.Y.cls",
        status: "ERROR #16021: Illegal Header Line: x",
      }),
    ).toBe("ERROR #16021: Illegal Header Line: x");
  });

  it("returns undefined for the empty status of an accepted write", () => {
    expect(atelierDocStatusError({ name: "X.Y.cls", status: "" })).toBeUndefined();
  });

  it("returns undefined when status is absent", () => {
    expect(atelierDocStatusError({ name: "X.Y.cls" })).toBeUndefined();
  });

  it("returns undefined for a non-string status", () => {
    expect(atelierDocStatusError({ status: 0 })).toBeUndefined();
    expect(atelierDocStatusError({ status: { errors: [] } })).toBeUndefined();
    expect(atelierDocStatusError({ status: null })).toBeUndefined();
  });

  it("returns undefined for a missing or non-object result", () => {
    expect(atelierDocStatusError(undefined)).toBeUndefined();
    expect(atelierDocStatusError(null)).toBeUndefined();
    expect(atelierDocStatusError("ERROR")).toBeUndefined();
  });

  it("passes whitespace-only status text through unchanged", () => {
    expect(atelierDocStatusError({ status: " " })).toBe(" ");
  });

  it("is exported from the @iris-mcp/shared barrel", () => {
    expect(shared.atelierDocStatusError).toBe(atelierDocStatusError);
  });
});

// Story 39.7 (DW-569): the shared client throws on every non-2xx answer, including the HTTP 400 with an empty
// error list that Atelier uses for a document name it refuses. `atelierDocRequest` returns that one answer as the
// envelope it always was, so a tool that reads the reason from `result.status` keeps its output.
describe("atelierDocRequest", () => {
  const rejection = (statusCode: number, errors: unknown[], result: unknown): IrisApiError =>
    new IrisApiError(statusCode, errors, "/api/atelier/v8/NS/doc/X", "IRIS returned HTTP", result);

  const REFUSED = { name: "X", db: "", ts: "", cat: "OTH", enc: false, content: "", status: "ERROR #16006: Document 'X' name is invalid" };

  it("returns the envelope of a request that succeeds, untouched", async () => {
    const envelope = { status: { errors: [], summary: "" }, console: ["c"], result: { content: ["a"] } };
    await expect(atelierDocRequest(async () => envelope)).resolves.toBe(envelope);
  });

  it("returns an HTTP 400 with an empty error list and a status text as an envelope carrying that result", async () => {
    const envelope = await atelierDocRequest(async () => {
      throw rejection(400, [], REFUSED);
    });

    expect(envelope).toEqual({ status: { errors: [], summary: "" }, console: [], result: REFUSED });
    expect(atelierDocStatusError(envelope.result)).toBe("ERROR #16006: Document 'X' name is invalid");
  });

  it("still throws every other failure: another status, a 400 that lists errors, a 400 with no status text, or a non-API error", async () => {
    const other = [
      rejection(404, [], REFUSED),
      rejection(409, [], REFUSED),
      rejection(500, [], REFUSED),
      rejection(400, [{ error: "boom" }], REFUSED),
      rejection(400, [], { ...REFUSED, status: "" }),
      rejection(400, [], { content: "" }),
      rejection(400, [], undefined),
      new Error("ECONNREFUSED"),
    ];
    for (const failure of other) {
      await expect(
        atelierDocRequest(async () => {
          throw failure;
        }),
        String(failure),
      ).rejects.toBe(failure);
    }
  });

  it("is exported from the @iris-mcp/shared barrel", () => {
    expect(shared.atelierDocRequest).toBe(atelierDocRequest);
  });
});
