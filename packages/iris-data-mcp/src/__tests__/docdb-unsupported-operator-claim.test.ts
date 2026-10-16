/**
 * Story 38.0 (ledger DW-57, AC-13) - the doc comment on `buildDocDbRestriction` says unsupported
 * operators are "silently skipped". The comment used to claim a console warning. This pins the
 * documented behavior itself, so the comment cannot drift from the code a second time: an unknown
 * operator contributes no predicate, never throws, and writes nothing to the console, while the
 * supported predicates beside it are kept.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { buildDocDbRestriction } from "../tools/docdb.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Spy on every console channel a warning could use. */
function spyOnConsole() {
  return [
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
  ];
}

describe("buildDocDbRestriction - unsupported operators are silently skipped (Story 38.0, DW-57)", () => {
  it("returns null, without throwing or writing to the console, when the only operator is unsupported", () => {
    const spies = spyOnConsole();

    expect(buildDocDbRestriction({ age: { $regex: "^A" } })).toBeNull();

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the supported predicates beside an unsupported operator and says nothing about the skipped one", () => {
    const spies = spyOnConsole();

    const restriction = buildDocDbRestriction({
      age: { $regex: "^A", $gt: 26 },
      name: "Alice",
    });

    expect(restriction).toEqual([
      ["age", 26, ">"],
      ["name", "Alice", "="],
    ]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
