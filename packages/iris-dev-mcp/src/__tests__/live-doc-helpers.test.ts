/**
 * `compileDocs` of `live-doc-helpers.ts`, which the live gates use to compile their disposable class documents, in the default
 * suite (the live gates that call it are skipped when unarmed). IRIS is a stub client answering the shapes captured live (IRIS
 * 2026.2 Build 221U, 2026-11-23, Story 44.4): a compile that also writes a class's Storage answers HTTP 200 with no status
 * error and only that class's entry, and the failed class shows only in the class dictionary and in `docnames` `upd`.
 */

import { describe, expect, it } from "vitest";
import { compileDocs } from "./live-doc-helpers.js";
import { createMockHttp } from "./test-helpers.js";

const VERSION = 7;
const NAMESPACE = "USER";
const GOOD = "Gate444.Good.cls";
const BAD = "Gate444.Bad.cls";

/** A stub client whose class dictionary and `docnames` answer for `rows` (class, compiled, error flag) and `upd` names. */
function stubClient(console: string[], rows: Array<{ ID: string; Compiled: number; CompileError: number }>, upToDate: string[]) {
  const http = createMockHttp(NAMESPACE);
  http.post.mockImplementation(async (path: string) => {
    if (path.endsWith("/action/compile")) {
      // The Storage-written envelope: HTTP 200, no status error, one entry (the class whose Storage was written).
      return {
        status: { errors: [], summary: "" },
        console,
        result: { content: [{ name: GOOD, status: "", content: ["Storage Default", "{", "}"], db: NAMESPACE, enc: false, flags: 1 }] },
      };
    }
    return { status: { errors: [], summary: "" }, console: [], result: { content: rows } };
  });
  http.get.mockImplementation(async () => ({
    status: { errors: [], summary: "" },
    console: [],
    result: { content: upToDate.map((name) => ({ name, upd: true })) },
  }));
  return http;
}

describe("compileDocs (live-doc-helpers)", () => {
  it("throws a message naming the class that the check does not confirm, although IRIS answered without a status error", async () => {
    const http = stubClient(
      ["", "Compilation started", `ERROR: ${BAD}`],
      [
        { ID: "Gate444.Good", Compiled: 1, CompileError: 0 },
        { ID: "Gate444.Bad", Compiled: 1, CompileError: 1 },
      ],
      [GOOD, BAD],
    );

    await expect(compileDocs(http, VERSION, NAMESPACE, [GOOD, BAD])).rejects.toThrow(
      new RegExp(`did not finish successfully: ${BAD.replace(/\./g, "\\.")}$`),
    );
  });

  it("resolves a clean compile with the compiler's console lines", async () => {
    const console = ["", "Compilation started", "Compilation finished successfully in 0.01s."];
    const http = stubClient(
      console,
      [
        { ID: "Gate444.Good", Compiled: 1, CompileError: 0 },
        { ID: "Gate444.Bad", Compiled: 1, CompileError: 0 },
      ],
      [GOOD, BAD],
    );

    await expect(compileDocs(http, VERSION, NAMESPACE, [GOOD, BAD])).resolves.toEqual(console);
  });
});
