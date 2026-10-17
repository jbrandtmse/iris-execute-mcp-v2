/**
 * Unit tests of the helpers the live and process gates share (DW-561), with no IRIS and no built
 * server: pure functions, a temp file, a local listener and call-only stub sessions. The helpers
 * that start or contact a built server are exercised by the gates themselves.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  allText,
  atelierScalar,
  batchUnits,
  distEntry,
  firstText,
  fixtureDocumentNames,
  governanceDenial,
  governanceReport,
  headerIds,
  irisClassMethod,
  lineNumber,
  pollAuditEntries,
  postEnvelope,
  rawIrisRequest,
  routeRequests,
  skipIfReason,
  skipTest,
  start503Stub,
  startRouteStub,
  stemFixtures,
  storageRange,
  stubEnvelope,
  stubTarget,
  teardownRecorder,
  wellFormed,
  withStub,
  writeJson,
  type WireSession,
  type WireToolResult,
} from "./process-gate-helpers.js";

let scratch = "";

beforeAll(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "process-gate-helpers-"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A session whose `call` and `raw` answer from `answers`, keyed by tool name; every call is recorded. */
function stubSession(answers: Record<string, WireToolResult>): {
  session: WireSession;
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const answer = async (tool: string, args: Record<string, unknown>): Promise<WireToolResult> => {
    calls.push({ tool, args });
    return answers[tool] ?? { isError: true, content: [{ text: `no answer for ${tool}` }] };
  };
  const session = {
    call: answer,
    callOn: (_server: string, tool: string, args: Record<string, unknown>) => answer(tool, args),
    raw: answer,
    listTools: async () => [],
    close: async () => {},
  } as WireSession;
  return { session, calls };
}

describe("DW-561: distEntry, skipTest and skipIfReason", () => {
  it("distEntry is the package's built index.js", () => {
    expect(distEntry("/repo", "iris-dev-mcp")).toBe(path.join("/repo", "packages", "iris-dev-mcp", "dist", "index.js"));
  });

  it("skipTest logs the tag and the reason on one line, then skips the test", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const skip = vi.fn();
    try {
      skipTest("some-gate", "the dist is stale", { skip });
      expect(log).toHaveBeenCalledWith("[SKIP] some-gate: the dist is stale");
      expect(skip).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("skipIfReason skips and answers true only when a reason is set, and logs nothing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const unset = vi.fn();
      expect(skipIfReason(undefined, { skip: unset })).toBe(false);
      expect(skipIfReason("", { skip: unset })).toBe(false);
      expect(unset).not.toHaveBeenCalled();
      const set = vi.fn();
      expect(skipIfReason("no SDK", { skip: set })).toBe(true);
      expect(set).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});

describe("DW-561: teardownRecorder", () => {
  it("runs every step, records each failure as '<what>: <message>' and does not throw", async () => {
    const recorder = teardownRecorder();
    const ran: string[] = [];
    await recorder.attempt("first", async () => {
      ran.push("first");
      throw new Error("boom");
    });
    await recorder.attempt("second", async () => {
      ran.push("second");
    });
    await recorder.attempt("third", async () => {
      ran.push("third");
      throw "plain text";
    });
    expect(ran).toEqual(["first", "second", "third"]);
    expect(recorder.problems).toEqual(["first: boom", "third: plain text"]);
  });

  it("starts empty, and two recorders do not share their problems", async () => {
    const one = teardownRecorder();
    const two = teardownRecorder();
    await one.attempt("x", async () => {
      throw new Error("y");
    });
    expect(one.problems).toHaveLength(1);
    expect(two.problems).toEqual([]);
  });
});

describe("DW-561: reading results", () => {
  it("firstText is the first block's text, and allText joins every block with a newline", () => {
    const result = { content: [{ text: "one" }, { text: "two" }, {}] };
    expect(firstText(result)).toBe("one");
    expect(allText(result)).toBe("one\ntwo\n");
    expect(firstText({})).toBe("");
    expect(allText({})).toBe("");
  });

  it("headerIds turns each row's id into a number", () => {
    expect(headerIds([{ id: 3 }, { id: "4" }, { id: 12 }])).toEqual([3, 4, 12]);
  });
});

describe("DW-561: document lines", () => {
  const content = ["Class A.B", "{", "Property P As %String;", "Storage Default", "{", "<Data/>", "}", "", "}"];

  it("lineNumber is 1-based and names the missing line when there is none", () => {
    expect(lineNumber(content, "Class A.B")).toBe(1);
    expect(lineNumber(content, "Property P As %String;")).toBe(3);
    expect(() => lineNumber(content, "Nothing")).toThrow('the stored document has the line "Nothing"');
  });

  it("storageRange runs from the Storage line to its closing brace, and is undefined without a Storage definition", () => {
    expect(storageRange(content)).toEqual({ first: 4, last: 7 });
    expect(storageRange(["Class A.B", "{", "}"])).toBeUndefined();
    expect(storageRange(["Storage", "{", "}"])).toBeUndefined();
  });
});

describe("DW-561: stub sessions", () => {
  it("fixtureDocumentNames lists each filter's documents in order, generated ones included", async () => {
    const { session, calls } = stubSession({
      iris_doc_list: { structuredContent: { items: [{ name: "A.cls" }, { name: "A.1.int" }] } },
    });
    await expect(fixtureDocumentNames(session, ["Story391", "Story395"])).resolves.toEqual([
      { filter: "Story391", names: ["A.cls", "A.1.int"] },
      { filter: "Story395", names: ["A.cls", "A.1.int"] },
    ]);
    expect(calls).toEqual([
      { tool: "iris_doc_list", args: { filter: "Story391", generated: true } },
      { tool: "iris_doc_list", args: { filter: "Story395", generated: true } },
    ]);
  });

  it("fixtureDocumentNames throws, naming the filter, when the listing is refused or has no items array", async () => {
    const refused = stubSession({ iris_doc_list: { isError: true, content: [{ text: "denied" }] } });
    await expect(fixtureDocumentNames(refused.session, ["Story391"])).rejects.toThrow("the Story391 document listing: denied");
    const empty = stubSession({ iris_doc_list: { structuredContent: {} } });
    await expect(fixtureDocumentNames(empty.session, ["Story391"])).rejects.toThrow("the Story391 document listing");
  });

  it("stemFixtures reads the documents and globals by stem and kills only the ExecuteMCPv globals that hold it", async () => {
    const { session, calls } = stubSession({
      iris_doc_list: { structuredContent: { items: [{ name: "Stem.cls" }] } },
      iris_global_list: { structuredContent: { globals: ["^ExecuteMCPv2.TempStem", "^Other.Stem", "^ExecuteMCPv2.Unrelated"] } },
      iris_global_kill: { content: [{ text: "ok" }] },
    });
    const fixtures = stemFixtures(session, "Stem");
    await expect(fixtures.documents()).resolves.toEqual(["Stem.cls"]);
    await expect(fixtures.globals()).resolves.toEqual(["^ExecuteMCPv2.TempStem", "^Other.Stem", "^ExecuteMCPv2.Unrelated"]);
    calls.length = 0;
    await fixtures.killGlobals();
    expect(calls.filter((call) => call.tool === "iris_global_kill").map((call) => call.args)).toEqual([
      { global: "ExecuteMCPv2.TempStem" },
    ]);
  });

  it("stemFixtures.killGlobals throws when a kill is refused", async () => {
    const { session } = stubSession({
      iris_global_list: { structuredContent: { globals: ["^ExecuteMCPv2.TempStem"] } },
      iris_global_kill: { isError: true, content: [{ text: "nope" }] },
    });
    await expect(stemFixtures(session, "Stem").killGlobals()).rejects.toThrow("killing global ExecuteMCPv2.TempStem: nope");
  });

  it("irisClassMethod returns the string result and throws, naming the method, when the call is refused", async () => {
    const ok = stubSession({ iris_execute_classmethod: { structuredContent: { returnValue: 42 } } });
    await expect(irisClassMethod(ok.session, "NS", "A.B", "M", ["x"])).resolves.toBe("42");
    expect(ok.calls[0]).toEqual({
      tool: "iris_execute_classmethod",
      args: { namespace: "NS", className: "A.B", methodName: "M", args: ["x"] },
    });
    const none = stubSession({ iris_execute_classmethod: { structuredContent: {} } });
    await expect(irisClassMethod(none.session, "NS", "A.B", "M", [])).resolves.toBe("");
    const refused = stubSession({ iris_execute_classmethod: { isError: true, content: [{ text: "bad" }] } });
    await expect(irisClassMethod(refused.session, "NS", "A.B", "M", [])).rejects.toThrow("A.B.M: bad");
  });

  it("governanceReport reads the policy and the sources through raw, and governanceDenial is the refusal shape", async () => {
    const { session, calls } = stubSession({
      iris_server_profiles: {
        structuredContent: { governance: { policy: { a: true }, configSource: { a: "default" }, extra: 1 } },
      },
    });
    await expect(governanceReport(session)).resolves.toEqual({ policy: { a: true }, configSource: { a: "default" } });
    expect(calls).toEqual([{ tool: "iris_server_profiles", args: {} }]);
    expect(governanceDenial("iris_x:y")).toEqual({ code: "GOVERNANCE_DISABLED", action: "iris_x:y", server: "default" });
    expect(governanceDenial("iris_x", { mode: "m" })).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_x",
      server: "default",
      mode: "m",
    });
  });

  it("atelierScalar answers the first column of the first row, and throws on an error answer, a non-200 answer or an unreachable target", async () => {
    const stub = await startRouteStub("/api/atelier/v1/HSCUSTOM/action/query");
    try {
      stub.serving = true;
      stub.reply = () => ({ status: { errors: [] }, result: { content: [{ N: "7", Other: 9 }, { N: "8" }] } });
      const target = stubTarget(stub.port, "u");
      await expect(atelierScalar(target, "SELECT 7 AS N")).resolves.toBe(7);
      const posted = stub.requests.find((request) => request.method === "POST");
      expect(JSON.parse(posted?.body ?? "null")).toEqual({ query: "SELECT 7 AS N" });

      stub.reply = () => ({ status: { errors: [{ error: "boom" }] }, result: {} });
      await expect(atelierScalar(target, "SELECT 1")).rejects.toThrow(/reported errors/);
      stub.serving = false;
      await expect(atelierScalar(target, "SELECT 1")).rejects.toThrow(/HTTP 503/);
    } finally {
      await stub.close();
    }
    await expect(
      atelierScalar({ host: "127.0.0.1", port: "1", username: "u", password: "p", namespace: "N" }, "SELECT 1"),
    ).rejects.toThrow();
  });

  it("postEnvelope answers the HTTP status, the raw text, the envelope's error texts in order, and its result", async () => {
    const stub = await startRouteStub("/api/executemcp/v2/interop/message/body");
    try {
      stub.serving = true;
      const target = stubTarget(stub.port, "u");
      stub.reply = (request) => stubEnvelope({ echoed: request });
      const ok = await postEnvelope(target, "/interop/message/body", { a: 1 });
      expect(ok).toMatchObject({ status: 200, errors: [], result: { echoed: { a: 1 } } });
      expect(JSON.parse(ok.text)).toEqual(stubEnvelope({ echoed: { a: 1 } }));

      stub.reply = () => ({ status: { errors: [{ error: "first" }, { error: "second" }] }, result: { b: 2 } });
      const failed = await postEnvelope(target, "/interop/message/body", {});
      expect(failed).toMatchObject({ status: 200, errors: ["first", "second"], result: { b: 2 } });
    } finally {
      await stub.close();
    }
  });

  it("rawIrisRequest answers the status, the text and the parsed JSON of any path, and does not throw on a non-200 answer (Story 39.7)", async () => {
    const stub = await startRouteStub("/api/atelier/v8/HSCUSTOM/action/getmacrodefinition");
    try {
      stub.serving = true;
      const target = stubTarget(stub.port, "u");
      stub.reply = (request) => stubEnvelope({ echoed: request });
      const served = await rawIrisRequest(target, "/api/atelier/v8/HSCUSTOM/action/getmacrodefinition", {
        method: "POST",
        body: { docname: "" },
      });
      expect(served.status).toBe(200);
      expect(served.json).toEqual(stubEnvelope({ echoed: { docname: "" } }));
      expect(JSON.parse(served.text)).toEqual(served.json);
      const posted = stub.requests.find((request) => request.method === "POST");
      expect(JSON.parse(posted?.body ?? "null")).toEqual({ docname: "" });

      const refused = await rawIrisRequest(target, "/api/atelier/v8/HSCUSTOM/docnames/CLS/cls?filter=x", { method: "GET" });
      expect(refused).toEqual({ status: 503, text: "", json: undefined });
    } finally {
      await stub.close();
    }
    await expect(
      rawIrisRequest({ host: "127.0.0.1", port: "1", username: "u", password: "p", namespace: "N" }, "/x", { method: "GET" }),
    ).rejects.toThrow();
  });
});

describe("DW-561: pollAuditEntries", () => {
  const line = (entry: Record<string, unknown>): string => `${JSON.stringify(entry)}\n`;

  it("returns the tool's entries once there are enough, and every entry with returnAll", async () => {
    const file = path.join(scratch, "audit-a.jsonl");
    writeFileSync(file, line({ tool: "t1", n: 1 }) + line({ tool: "t2", n: 2 }) + line({ tool: "t1", n: 3 }));
    const options = { intervalMs: 5, timeoutMs: 500, excerpt: 100 };
    await expect(pollAuditEntries(file, { ...options, tool: "t1", count: 2 })).resolves.toEqual([
      { tool: "t1", n: 1 },
      { tool: "t1", n: 3 },
    ]);
    await expect(pollAuditEntries(file, { ...options, tool: "t1", count: 2, returnAll: true })).resolves.toHaveLength(3);
    await expect(pollAuditEntries(file, options)).resolves.toHaveLength(3);
  });

  it("waits for an entry that is written later, and for isWanted to accept one", async () => {
    const file = path.join(scratch, "audit-b.jsonl");
    writeFileSync(file, line({ tool: "t1", n: 1 }));
    const pending = pollAuditEntries(file, {
      tool: "t1",
      isWanted: (entry) => entry["n"] === 2,
      intervalMs: 5,
      timeoutMs: 2000,
      excerpt: 100,
    });
    setTimeout(() => appendFileSync(file, line({ tool: "t1", n: 2 })), 40);
    await expect(pending).resolves.toEqual([
      { tool: "t1", n: 1 },
      { tool: "t1", n: 2 },
    ]);
  });

  it("throws, naming the tool and quoting the start of the file, when the entries never appear", async () => {
    const file = path.join(scratch, "audit-c.jsonl");
    writeFileSync(file, line({ tool: "t1", n: 1 }));
    await expect(
      pollAuditEntries(file, { tool: "t2", count: 1, intervalMs: 5, timeoutMs: 60, excerpt: 12 }),
    ).rejects.toThrow(`fewer than 1 t2 entries in ${file}: {"tool":"t1"`);
    const missing = path.join(scratch, "no-such.jsonl");
    await expect(pollAuditEntries(missing, { intervalMs: 5, timeoutMs: 40, excerpt: 10 })).rejects.toThrow(
      `fewer than 1 audit entries in ${missing}: no file`,
    );
  });
});

describe("DW-561: the stub listeners", () => {
  it("startRouteStub answers 503 until it serves, then the route with the reply and HEAD /api/atelier/ with 200, and records every request", async () => {
    const stub = await startRouteStub("/api/executemcp/v2/interop/message/body");
    try {
      const base = `http://127.0.0.1:${stub.port}`;
      const refused = await fetch(`${base}/api/executemcp/v2/interop/message/body`, { method: "POST", body: "{}" });
      expect(refused.status).toBe(503);

      stub.serving = true;
      stub.reply = (request) => stubEnvelope({ echoed: request });
      const served = await fetch(`${base}/api/executemcp/v2/interop/message/body`, { method: "POST", body: '{"a":1}' });
      expect(served.status).toBe(200);
      expect(await served.json()).toEqual({ status: { errors: [], summary: "" }, console: [], result: { echoed: { a: 1 } } });
      expect((await fetch(`${base}/api/atelier/`, { method: "HEAD" })).status).toBe(200);
      expect((await fetch(`${base}/api/executemcp/v2/other`, { method: "POST", body: "{}" })).status).toBe(503);

      expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        "POST /api/executemcp/v2/interop/message/body",
        "POST /api/executemcp/v2/interop/message/body",
        "HEAD /api/atelier/",
        "POST /api/executemcp/v2/other",
      ]);
      expect(routeRequests(stub).map((request) => request.url)).toEqual([
        "/api/executemcp/v2/interop/message/body",
        "/api/executemcp/v2/interop/message/body",
        "/api/executemcp/v2/other",
      ]);
    } finally {
      await stub.close();
    }
  });

  it("start503Stub and withStub answer every request with 503, record 'METHOD path', and close", async () => {
    const seen = await withStub(async (stub) => {
      expect((await fetch(`http://127.0.0.1:${stub.port}/x?y=1`)).status).toBe(503);
      expect((await fetch(`http://127.0.0.1:${stub.port}/z`, { method: "POST", body: "{}" })).status).toBe(503);
      return { port: stub.port, requests: [...stub.requests] };
    });
    expect(seen.requests).toEqual(["GET /x?y=1", "POST /z"]);
    await expect(fetch(`http://127.0.0.1:${seen.port}/after`)).rejects.toThrow();

    const standalone = await start503Stub();
    await standalone.close();
  });

  it("stubTarget points at the local port with a throwaway credential, and stubEnvelope wraps a result", () => {
    expect(stubTarget(4321, "story-qa")).toEqual({
      host: "127.0.0.1",
      port: "4321",
      username: "story-qa",
      password: "not-a-real-password",
      namespace: "HSCUSTOM",
    });
    expect(stubEnvelope({ rows: [] })).toEqual({ status: { errors: [], summary: "" }, console: [], result: { rows: [] } });
  });

  it("writeJson writes each document to its own numbered file", () => {
    const one = writeJson(scratch, "doc.json", { a: 1 });
    const two = writeJson(scratch, "doc.json", { b: 2 });
    expect(one).not.toBe(two);
    expect(path.basename(one)).toMatch(/^\d+-doc\.json$/);
    expect(JSON.parse(readFileSync(one, "utf8"))).toEqual({ a: 1 });
    expect(JSON.parse(readFileSync(two, "utf8"))).toEqual({ b: 2 });
  });
});

describe("DW-561: HL7 text helpers", () => {
  it("batchUnits splits a batch into its FHS line, its BHS line and each message, dropping BTS and FTS", () => {
    const batch = [
      "FHS|^~\\&|F",
      "BHS|^~\\&|B",
      "MSH|^~\\&|A|1",
      "PID|1||M1",
      "MSH|^~\\&|A|2",
      "PID|1||M2",
      "BTS|2",
      "FTS|1",
    ].join("\r");
    expect(batchUnits(batch)).toEqual([
      "FHS|^~\\&|F\r",
      "BHS|^~\\&|B\r",
      "MSH|^~\\&|A|1\rPID|1||M1\r",
      "MSH|^~\\&|A|2\rPID|1||M2\r",
    ]);
    expect(batchUnits("MSH|a\nPID|b\n")).toEqual(["MSH|a\rPID|b\r"]);
    expect(batchUnits("")).toEqual([]);
  });

  it("wellFormed is false for a lone surrogate half and true otherwise", () => {
    expect(wellFormed("plain \u{1F600}")).toBe(true);
    expect(wellFormed("lone \uD83D")).toBe(false);
  });
});
