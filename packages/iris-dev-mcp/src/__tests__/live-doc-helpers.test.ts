/**
 * `compileDocs` of `live-doc-helpers.ts`, which the live gates use to compile their disposable class documents, in the default
 * suite (the live gates that call it are skipped when unarmed). IRIS is a stub client answering the shapes captured live (IRIS
 * 2026.2 Build 221U, 2026-11-23, Story 44.4): a compile that also writes a class's Storage answers HTTP 200 with no status
 * error and only that class's entry, and the failed class shows only in the class dictionary and in `docnames` `upd`.
 */

import { describe, expect, it } from "vitest";
import { IrisApiError } from "@iris-mcp/shared";
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
        result: {
          content: [{ name: GOOD, status: "", content: ["Storage Default", "{", "}"], db: NAMESPACE, ts: "2026-11-23 10:18:04.098", enc: false, flags: 1 }],
        },
      };
    }
    return { status: { errors: [], summary: "" }, console: [], result: { content: rows } };
  });
  http.get.mockImplementation(async () => ({
    status: { errors: [], summary: "" },
    console: [],
    result: { content: upToDate.map((name) => ({ name, cat: "CLS", ts: "2026-11-23 10:20:27.782", upd: true, db: NAMESPACE, gen: false })) },
  }));
  return http;
}

/**
 * The planning probe's de-DE console, verbatim (IRIS 2026.2 Build 221U, 2026-11-23; `Accept-Language: de-DE`): no English
 * `Compilation finished successfully` line, and German error lines about other classes. Nothing may decide on it.
 */
const CONSOLE_DE = ["","Kompilierung begonnen am 11/23/2026 10:18:04 mit Qualifizierern 'cuk'","Class User.P444A ist auf dem neuesten Stand.","Kompilieren von 2 Klassen","Kompilieren der Klasse User.P444X","Kompilieren der Klasse User.P444P","Kompilieren der Tabelle SQLUser.P444P","Kompilieren der Routine User.P444X.1","ERROR: User.P444X.cls","ERROR:  User.P444X.1(3) : MPP5610 : Referenzmakro nicht definiert: 'NoSuchMacro444'"," TEXT:   Quit $$$NoSuchMacro444 }","ERROR: User.P444X.cls(Hi+2) #1002: Invalid character in tag : '}' : Offset:26 [Hi+1^User.P444X.1]"," TEXT:   Quit $$$NoSuchMacro444 }","Kompilieren der Routine User.P444P.1","2 Fehler während der Kompilierung in 0.028s erkannt."];

/** The planning probe's captured #5475 status error (CR LF inside its text), with the class name substituted. */
const ROUTINE_ERROR = {
  error:
    "ERROR #5475: Error compiling routine: Gate444.Bad.  Errors:  Gate444.Bad.cls\r\nERROR:  Gate444.Bad.1(3) : MPP5610 : Referenced macro not defined: 'NoSuchMacro444'\r\n TEXT:   Quit $$$NoSuchMacro444 }",
  code: 5475,
  domain: "%ObjectErrors",
  id: "RoutineCompilationErrorWithInfo",
  params: ["Gate444.Bad", "Gate444.Bad.cls\r\nERROR:  Gate444.Bad.1(3) : MPP5610 : Referenced macro not defined: &#39;NoSuchMacro444&#39;\r\n TEXT:   Quit $$$NoSuchMacro444 }", "", "", "", "", ""],
};

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

  it("resolves a clean compile whose console is localized and has no English success line (AC 44.4.4: the console decides nothing)", async () => {
    const http = stubClient(
      CONSOLE_DE,
      [
        { ID: "Gate444.Good", Compiled: 1, CompileError: 0 },
        { ID: "Gate444.Bad", Compiled: 1, CompileError: 0 },
      ],
      [GOOD, BAD],
    );

    await expect(compileDocs(http, VERSION, NAMESPACE, [GOOD, BAD])).resolves.toEqual(CONSOLE_DE);
  });

  it("puts IRIS's status error text on one line in the thrown message", async () => {
    const http = stubClient([], [{ ID: "Gate444.Good", Compiled: 1, CompileError: 0 }, { ID: "Gate444.Bad", Compiled: 1, CompileError: 1 }], [GOOD, BAD]);
    http.post.mockImplementationOnce(async () => {
      throw new IrisApiError(200, [ROUTINE_ERROR], `/api/atelier/v${VERSION}/${NAMESPACE}/action/compile`, "IRIS reported errors for POST /x.");
    });

    const failure = await compileDocs(http, VERSION, NAMESPACE, [GOOD, BAD]).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain(`did not finish successfully: ${BAD} (IRIS reported: ERROR #5475: Error compiling routine: Gate444.Bad. Errors: Gate444.Bad.cls ERROR: Gate444.Bad.1(3)`);
    expect(message, "no line break from the IRIS text").not.toMatch(/[\r\n]/);
  });
});
