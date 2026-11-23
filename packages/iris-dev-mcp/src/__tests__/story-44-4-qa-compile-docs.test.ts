/**
 * Story 44.4 QA -- gaps left by `live-doc-helpers.test.ts` for `compileDocs` (the compile the five dev live gates use).
 *
 * That file pins a Storage-written partial failure and a clean compile. This file adds the failures the live gates can meet in the
 * other shapes the planning probe captured (IRIS 2026.2 Build 221U and 2026.1 Build 234U, 2026-11-23):
 *
 * - a compile IRIS answers with a status error (HTTP 200, one `{error, code, domain, id, params}` entry), with the check clean and with
 *   it naming other classes: the error text is context in the thrown message, never the decision;
 * - a compile request that gets no Atelier answer (a non-2xx answer): rethrown unchanged, no check request, never wrapped as a verdict;
 * - a check whose own request fails: the could-not-run error reaches the gate, and no class is read as compiled;
 * - a document that is not a `.cls`: refused before any request (a compile has side effects).
 *
 * IRIS is a stub client; every shape it answers is a captured one.
 */

import { describe, expect, it } from "vitest";
import { IrisApiError } from "@iris-mcp/shared";
import { compileDocs } from "./live-doc-helpers.js";
import { createMockHttp } from "./test-helpers.js";

const VERSION = 7;
const NAMESPACE = "USER";
const GOOD = "Gate444.Good.cls";
const BAD = "Gate444.Bad.cls";

/** The planning probe's captured status error of a class failure (#5373), with the class name substituted. */
const statusError = (cls: string): { error: string; code: number; domain: string; id: string; params: string[] } => ({
  error: `ERROR #5373: Class 'User.NoSuchSuper444', used by '${cls}:superclass', does not exist`,
  code: 5373,
  domain: "%ObjectErrors",
  id: "PredecessorClassDoesNotExist",
  params: ["User.NoSuchSuper444", `${cls}:superclass`, "", "", "", "", ""],
});

const envelope = (content: unknown[]) => ({ status: { errors: [], summary: "" }, console: [], result: { content } });
const clean = (id: string) => ({ ID: id, Compiled: 1, CompileError: 0 });
/** A `docnames` entry in the captured shape `{name, cat, ts, upd, db, gen}`. */
const entry = (name: string, upd: boolean) => ({ name, cat: "CLS", ts: "2026-11-23 10:20:27.782", upd, db: "USER", gen: false });

interface Stub {
  compile: () => Promise<unknown>;
  query?: () => Promise<unknown>;
  docnames?: () => Promise<unknown>;
}

/** A stub client whose three routes answer as `stub` says; the default check is clean for GOOD and BAD. */
function stubClient(stub: Stub) {
  const http = createMockHttp(NAMESPACE);
  http.post.mockImplementation(async (path: string) => {
    if (path.endsWith("/action/compile")) return stub.compile();
    return stub.query === undefined ? envelope([clean("Gate444.Good"), clean("Gate444.Bad")]) : stub.query();
  });
  http.get.mockImplementation(async () =>
    stub.docnames === undefined ? envelope([entry(GOOD, true), entry(BAD, true)]) : stub.docnames(),
  );
  return http;
}

const throwsStatus = (cls: string) => async (): Promise<never> => {
  throw new IrisApiError(
    200,
    [statusError(cls)],
    `/api/atelier/v${VERSION}/${NAMESPACE}/action/compile`,
    `IRIS reported errors for POST /api/atelier/v${VERSION}/${NAMESPACE}/action/compile. Review the error details and correct the request.`,
  );
};

describe("compileDocs: a compile IRIS answered with a status error", () => {
  it("with the check clean, still throws, with the IRIS text as context and no class named", async () => {
    const http = stubClient({ compile: throwsStatus(BAD.replace(/\.cls$/, "")) });

    const failure = await compileDocs(http, VERSION, NAMESPACE, [GOOD, BAD]).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      `compiling ${GOOD}, ${BAD} did not finish successfully: no class named (IRIS reported: ERROR #5373: Class 'User.NoSuchSuper444', used by 'Gate444.Bad:superclass', does not exist)`,
    );
  });

  it("with the check naming a class, names it from the check and adds the IRIS text as context", async () => {
    const http = stubClient({
      compile: throwsStatus("Gate444.Good"),
      // IRIS names Good; the check also finds Bad flagged, and Good without a compiled row (a first compile that failed).
      query: async () => envelope([{ ID: "Gate444.Bad", Compiled: 1, CompileError: 1 }, { ID: "Gate444.Good", Compiled: 0, CompileError: 0 }]),
      docnames: async () => envelope([entry(BAD, true)]),
    });

    const failure = await compileDocs(http, VERSION, NAMESPACE, [GOOD, BAD]).catch((error: unknown) => error);

    expect((failure as Error).message).toBe(
      `compiling ${GOOD}, ${BAD} did not finish successfully: ${GOOD}, ${BAD} (IRIS reported: ERROR #5373: Class 'User.NoSuchSuper444', used by 'Gate444.Good:superclass', does not exist)`,
    );
  });
});

describe("compileDocs: a compile request that gets no Atelier answer, and a check that cannot run", () => {
  it("rethrows the compile's own error unchanged and sends no check request", async () => {
    const refusal = new IrisApiError(503, [], `/api/atelier/v${VERSION}/${NAMESPACE}/action/compile`, "IRIS returned HTTP 503 for POST /x. Check the request parameters and try again.");
    const http = stubClient({
      compile: async () => {
        throw refusal;
      },
    });

    await expect(compileDocs(http, VERSION, NAMESPACE, [GOOD])).rejects.toBe(refusal);

    expect(http.post, "only the compile was posted").toHaveBeenCalledTimes(1);
    expect(http.get, "no docnames read").not.toHaveBeenCalled();
  });

  it("a check whose dictionary query fails reaches the gate as the could-not-run error, never as a pass", async () => {
    const http = stubClient({
      compile: async () => envelope([]),
      query: async () => {
        throw new IrisApiError(500, [], `/api/atelier/v${VERSION}/${NAMESPACE}/action/query`, "IRIS returned HTTP 500 for POST /q. Check the request parameters and try again.");
      },
    });

    await expect(compileDocs(http, VERSION, NAMESPACE, [GOOD])).rejects.toThrow(
      "the check that every class compiled could not run: IRIS returned HTTP 500 for POST /q. Check the request parameters and try again.",
    );
    expect(http.get, "the docnames read is not sent once the query failed").not.toHaveBeenCalled();
  });

  it("a check whose docnames read lists nothing names every class (no upd entry is no confirmation), though the dictionary is clean", async () => {
    const http = stubClient({ compile: async () => envelope([]), docnames: async () => envelope([]) });

    await expect(compileDocs(http, VERSION, NAMESPACE, [GOOD, BAD])).rejects.toThrow(
      new RegExp(`did not finish successfully: ${GOOD.replace(/\./g, "\\.")}, ${BAD.replace(/\./g, "\\.")}$`),
    );
  });

  it("a class whose entry says upd false is named even with a clean row", async () => {
    const http = stubClient({ compile: async () => envelope([]), docnames: async () => envelope([entry(GOOD, true), entry(BAD, false)]) });

    await expect(compileDocs(http, VERSION, NAMESPACE, [GOOD, BAD])).rejects.toThrow(new RegExp(`did not finish successfully: ${BAD.replace(/\./g, "\\.")}$`));
  });
});

describe("compileDocs: a document that is not a class is refused before any request", () => {
  for (const names of [["Gate444.Routine.mac"], [GOOD, "Gate444.Include.inc"], [GOOD, ".cls"]]) {
    it(`${JSON.stringify(names)}`, async () => {
      const http = stubClient({ compile: async () => envelope([]) });

      await expect(compileDocs(http, VERSION, NAMESPACE, names)).rejects.toThrow(/class documents ending in \.cls/);

      expect(http.post).not.toHaveBeenCalled();
      expect(http.get).not.toHaveBeenCalled();
    });
  }
});
