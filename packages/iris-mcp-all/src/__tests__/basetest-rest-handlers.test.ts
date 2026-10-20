/**
 * `ExecuteMCPv2.Tests.BaseTest:HandlerNames` lists the source tree's REST handlers (DW-634, Story 41.8): every
 * `src/ExecuteMCPv2/REST/*.cls` except `Base.cls` and `Dispatch.cls`, by short name, in name order.
 *
 * The OS test `BaseTest:TestEveryRestHandlerExtendsBase` asserts that the handlers compiled on the instance equal that
 * list and that each one extends `ExecuteMCPv2.REST.Base`. A list that lags the tree would leave that OS test red
 * where only an OS run shows it; this file shows it in the default suite, at the change that adds the handler.
 *
 * Reads the two source locations from disk; needs no IRIS and no built dist.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const REST_DIR = path.join(REPO_ROOT, "src", "ExecuteMCPv2", "REST");
const BASE_TEST = path.join(REPO_ROOT, "src", "ExecuteMCPv2", "Tests", "BaseTest.cls");

/** The comma-joined literal `BaseTest:HandlerNames()` returns, split; empty when the method is not found. */
function pinnedHandlers(): string[] {
  const source = readFileSync(BASE_TEST, "utf8");
  const literal = /ClassMethod HandlerNames\(\) As %String\s*\{\s*Quit "([^"]*)"\s*\}/.exec(source)?.[1];
  return literal === undefined || literal === "" ? [] : literal.split(",");
}

/** The REST classes of the source tree, by short name, minus Base and Dispatch, in name order. */
function sourceHandlers(): string[] {
  return readdirSync(REST_DIR)
    .filter((name) => name.endsWith(".cls"))
    .map((name) => name.slice(0, -".cls".length))
    .filter((name) => name !== "Base" && name !== "Dispatch")
    .sort();
}

describe("BaseTest:HandlerNames is the source tree's REST handlers (DW-634)", () => {
  it("lists every src/ExecuteMCPv2/REST/*.cls except Base and Dispatch, in name order", () => {
    const pinned = pinnedHandlers();
    expect(pinned.length, "HandlerNames() was parsed from BaseTest.cls").toBeGreaterThan(0);
    expect(pinned).toEqual(sourceHandlers());
  });
});
