import { describe, it, expect } from "vitest";
import { stripLeadingBom } from "../lines.js";
import * as shared from "../index.js";

describe("stripLeadingBom", () => {
  it("removes a single leading U+FEFF", () => {
    expect(stripLeadingBom("\uFEFFClass A.B {}")).toBe("Class A.B {}");
  });

  it("returns the same text when there is no BOM", () => {
    expect(stripLeadingBom("Class A.B {}")).toBe("Class A.B {}");
  });

  it("returns the empty string unchanged", () => {
    expect(stripLeadingBom("")).toBe("");
  });

  it("removes only one BOM when two are stacked", () => {
    expect(stripLeadingBom("\uFEFF\uFEFFx")).toBe("\uFEFFx");
  });

  it("preserves a U+FEFF that is not the first character", () => {
    expect(stripLeadingBom("a\uFEFFb")).toBe("a\uFEFFb");
  });

  it("strips a BOM that is the entire input", () => {
    expect(stripLeadingBom("\uFEFF")).toBe("");
  });

  it("is exported from the @iris-mcp/shared barrel", () => {
    expect(shared.stripLeadingBom).toBe(stripLeadingBom);
  });
});
