import { describe, it, expect } from "vitest";
import { atelierDocStatusError } from "../atelier.js";
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
