/**
 * Story 40.2 -- the local path guard shared by `iris_doc_export` (`destinationDir`) and `iris_test_status` (`outputPath`).
 *
 * The `destinationDir` texts are the exact strings the guard returned before it moved out of `export.ts`: they are captured
 * from the baseline source (`git show 4da459e838dad43e5bbbe3fb14bd0b4b07f4c5a2:packages/iris-dev-mcp/src/tools/export.ts`,
 * `validateDestinationDir` and `assertInsideRoot`), and pinned whole, not by substring (Rule #36).
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { assertInsideRoot, validateLocalPath } from "../tools/local-path.js";

describe("validateLocalPath with the label destinationDir: the baseline texts, byte for byte", () => {
  it("an empty value", () => {
    expect(validateLocalPath("", "destinationDir")).toBe("destinationDir must be a non-empty string");
  });

  it("a .. segment, with either separator", () => {
    expect(validateLocalPath("/tmp/../etc", "destinationDir")).toBe("destinationDir '/tmp/../etc' must not contain '..' (path traversal)");
    expect(validateLocalPath("C:\\tmp\\..\\etc", "destinationDir")).toBe(
      "destinationDir 'C:\\tmp\\..\\etc' must not contain '..' (path traversal)",
    );
  });

  it("a relative path", () => {
    expect(validateLocalPath("out/classes", "destinationDir")).toBe("destinationDir 'out/classes' must be an absolute path");
  });

  it("an absolute path without a .. segment is accepted", () => {
    expect(validateLocalPath(path.resolve("/tmp/classes"), "destinationDir")).toBeUndefined();
    expect(validateLocalPath("/tmp/a..b/c", "destinationDir")).toBeUndefined();
  });
});

describe("validateLocalPath with the label outputPath", () => {
  it("names the argument in each text", () => {
    expect(validateLocalPath("", "outputPath")).toBe("outputPath must be a non-empty string");
    expect(validateLocalPath("/tmp/../c.xml", "outputPath")).toBe("outputPath '/tmp/../c.xml' must not contain '..' (path traversal)");
    expect(validateLocalPath("c.xml", "outputPath")).toBe("outputPath 'c.xml' must be an absolute path");
  });
});

describe("assertInsideRoot", () => {
  it("refuses a path outside the root with the baseline text and its default label destinationDir", () => {
    const root = path.resolve("/tmp/story402-root");
    const outside = path.resolve("/tmp/story402-other/file.cls");
    expect(() => assertInsideRoot(outside, root)).toThrow(
      new Error(`Refusing to write '${outside}': resolves outside destinationDir '${root}'`),
    );
  });

  it("names the label it is given", () => {
    const root = path.resolve("/tmp/story402-root");
    const outside = path.resolve("/tmp/story402-other/file.xml");
    expect(() => assertInsideRoot(outside, root, "outputPath")).toThrow(
      new Error(`Refusing to write '${outside}': resolves outside outputPath '${root}'`),
    );
  });

  it("accepts the root itself and a path below it, and refuses a sibling that shares the root's prefix", () => {
    const root = path.resolve("/tmp/story402-root");
    expect(() => assertInsideRoot(root, root)).not.toThrow();
    expect(() => assertInsideRoot(path.join(root, "A", "B.cls"), root)).not.toThrow();
    expect(() => assertInsideRoot(`${root}-sibling${path.sep}B.cls`, root)).toThrow(/resolves outside destinationDir/);
  });
});
