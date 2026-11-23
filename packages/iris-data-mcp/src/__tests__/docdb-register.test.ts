/**
 * Story 44.1 -- `iris_docdb_manage create` registers the DocDB database's `Security.DocDBs` record.
 *
 * Section A pins the behavior that must not move (AC 44.1.7): the request lists of every DocDB tool action other than
 * `create`, the `list`/`drop` results, and the Dispatch UrlMap. The expected values were captured from the pre-story
 * dist (`docdb.ts` at commit 05b26d92) by a recording `http` fake whose every call answers `{ result: { ok: true } }`:
 * `node scratchpad/p441/capture.mjs <repo-root>`. They are never edited to match the implementation (Rule #36).
 *
 * Section B drives the I/O matrix of the spec. Its fakes use shapes captured live from IRIS 2026.2 Build 221U and
 * 2026.1 Build 234U (Rule #54):
 *
 *   822, service on, no record: HTTP 500
 *     {"status":{"errors":[{"error":"ERROR #822: Access Denied","code":822,"domain":"%ObjectErrors","id":"AccessDenied"}],
 *      "summary":"ERROR #822: Access Denied"},"content":null}
 *   25051, database exists: HTTP 409
 *     {"status":{"errors":[{"error":"ERROR #25051: Database 'probeC' is already defined in this namespace","code":25051,
 *      "domain":"%ObjectErrors","id":"DocumentDatabaseAlreadyExists","params":["probeC"]}],...},"content":null}
 *   create: HTTP 201 {"content":{"Name":"probeC","Class":"ISC.DM.probeC","properties":[...]}}
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolContext, ToolDefinition } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  docdbManageTool,
  docdbDocumentTool,
  docdbFindTool,
  docdbPropertyTool,
} from "../tools/docdb.js";
import { createMockCtx, createMockHttp, envelope } from "@iris-mcp/shared/test-helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-data-mcp/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

type RecordedCall = [string, string, unknown?];

/** A ToolContext whose http client records `[method, url, body?]` and answers every call with `{ result: { ok: true } }`. */
function recordingCtx(): { ctx: ToolContext; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const record = (method: string) => async (url: string, body?: unknown) => {
    calls.push(body === undefined ? [method, url] : [method, url, body]);
    return { result: { ok: true } };
  };
  const ctx = createMockCtx({
    get: record("GET"),
    post: record("POST"),
    put: record("PUT"),
    delete: record("DELETE"),
  } as never);
  return { ctx, calls };
}

async function requestsOf(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): Promise<RecordedCall[]> {
  const { ctx, calls } = recordingCtx();
  await tool.handler(args, ctx);
  return calls;
}

const USER = "/api/docdb/v1/USER";

describe("Story 44.1 AC 44.1.7 -- request lists captured before the story", () => {
  it("iris_docdb_manage list", async () => {
    expect(await requestsOf(docdbManageTool, { action: "list" })).toEqual([["GET", USER]]);
    expect(await requestsOf(docdbManageTool, { action: "list", namespace: "HSCUSTOM" })).toEqual([
      ["GET", "/api/docdb/v1/HSCUSTOM"],
    ]);
  });

  it("iris_docdb_manage drop", async () => {
    expect(await requestsOf(docdbManageTool, { action: "drop", database: "MyDb" })).toEqual([
      ["DELETE", `${USER}/db/MyDb`],
    ]);
    expect(
      await requestsOf(docdbManageTool, { action: "drop", database: "My Db/x", namespace: "HSCUSTOM" }),
    ).toEqual([["DELETE", "/api/docdb/v1/HSCUSTOM/db/My%20Db%2Fx"]]);
  });

  it("iris_docdb_manage create starts with the unchanged DocDB POST", async () => {
    const calls = await requestsOf(docdbManageTool, { action: "create", database: "MyDb" });
    expect(calls[0]).toEqual(["POST", `${USER}/db/MyDb`, {}]);
  });

  it("iris_docdb_document", async () => {
    expect(
      await requestsOf(docdbDocumentTool, { action: "insert", database: "MyDb", document: { a: 1 } }),
    ).toEqual([["POST", `${USER}/doc/MyDb/`, { a: 1 }]]);
    expect(await requestsOf(docdbDocumentTool, { action: "get", database: "MyDb", id: "7" })).toEqual([
      ["GET", `${USER}/doc/MyDb/7`],
    ]);
    expect(
      await requestsOf(docdbDocumentTool, { action: "update", database: "MyDb", id: "7", document: { a: 2 } }),
    ).toEqual([["PUT", `${USER}/doc/MyDb/7`, { a: 2 }]]);
    expect(await requestsOf(docdbDocumentTool, { action: "delete", database: "MyDb", id: "7" })).toEqual([
      ["DELETE", `${USER}/doc/MyDb/7`],
    ]);
  });

  it("iris_docdb_find", async () => {
    expect(
      await requestsOf(docdbFindTool, { database: "MyDb", filter: { age: { $gt: 21 }, name: "x" } }),
    ).toEqual([["POST", `${USER}/find/MyDb`, { restriction: [["age", 21, ">"], ["name", "x", "="]] }]]);
    expect(await requestsOf(docdbFindTool, { database: "MyDb", filter: {} })).toEqual([
      ["POST", `${USER}/find/MyDb`, {}],
    ]);
  });

  it("iris_docdb_property", async () => {
    // Story 44.7 (sanction S-44.7-docdb-property): `create` and `index` are the two rows that moved. The pre-story
    // values were `POST .../p?type=%Integer` with `{}` and `POST .../p` with `{ index: true }`. `drop` is unchanged.
    expect(
      await requestsOf(docdbPropertyTool, { action: "create", database: "MyDb", property: "p", type: "%Integer" }),
    ).toEqual([["POST", `${USER}/prop/MyDb/p?type=%Integer&path=%24.p`, {}]]);
    expect(await requestsOf(docdbPropertyTool, { action: "drop", database: "MyDb", property: "p" })).toEqual([
      ["DELETE", `${USER}/prop/MyDb/p`],
    ]);
    // The recording fake answers every call, so the GET finds an existing property and nothing is written.
    expect(await requestsOf(docdbPropertyTool, { action: "index", database: "MyDb", property: "p" })).toEqual([
      ["GET", `${USER}/prop/MyDb/p`],
    ]);
  });
});

describe("Story 44.1 AC 44.1.7 -- list and drop results are unchanged", () => {
  it("list returns the wrapped array exactly as before", async () => {
    const dbs = ["A", "B"];
    const ctx = createMockCtx({ get: async () => ({ result: [...dbs] }) } as never);
    const result = await docdbManageTool.handler({ action: "list" }, ctx);
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(dbs, null, 2) }],
      structuredContent: { items: dbs, count: 2 },
    });
  });

  it("drop returns the DocDB answer exactly as before, for a dropped and a missing name", async () => {
    for (const answer of [
      { database: "MyDb", dropped: true },
      { database: "MyDb", dropped: false },
    ]) {
      // A copy, so a handler that edits the answer in place cannot edit the expected value too.
      const ctx = createMockCtx({ delete: async () => ({ result: { ...answer } }) } as never);
      const result = await docdbManageTool.handler({ action: "drop", database: "MyDb" }, ctx);
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify(answer, null, 2) }],
        structuredContent: answer,
      });
    }
  });
});

describe("Story 44.1 AD-33 -- the Dispatch UrlMap keeps every route and gains two", () => {
  const NEW_ROUTES = [
    '  <Route Url="/security/docdb" Method="GET" Call="ExecuteMCPv2.REST.Security:DocDbGet" />',
    '  <Route Url="/security/docdb" Method="POST" Call="ExecuteMCPv2.REST.Security:DocDbManage" />',
  ];

  const actualRoutes = (): string[] =>
    readFileSync(path.join(REPO_ROOT, "src", "ExecuteMCPv2", "REST", "Dispatch.cls"), "utf8")
      .split("\n")
      .filter((line) => line.includes("<Route "))
      .map((line) => line.replace(/\r$/, ""));

  const preStoryRoutes = (): string[] =>
    readFileSync(path.join(__dirname, "fixtures", "dispatch-routes-pre-44-1.txt"), "utf8")
      .split("\n")
      .filter((line) => line !== "");

  it("the fixture is the 102 routes captured before the story", () => {
    expect(preStoryRoutes()).toHaveLength(102);
  });

  it("the only added route lines are the two /security/docdb routes", () => {
    const added = actualRoutes().filter((line) => NEW_ROUTES.includes(line));
    expect(added).toEqual(NEW_ROUTES);
    expect(actualRoutes().filter((line) => !NEW_ROUTES.includes(line))).toEqual(preStoryRoutes());
  });
});

// ── Section B: the I/O matrix ──────────────────────────────────

const REGISTER_URL = "/api/executemcp/v2/security/docdb";
const SERVICE_URL_FRAGMENT = "/api/executemcp/v2/security/service";

/** Live shapes (see the file header). */
const ACCESS_DENIED = [
  { error: "ERROR #822: Access Denied", code: 822, domain: "%ObjectErrors", id: "AccessDenied" },
];
const ALREADY_EXISTS = [
  {
    error: "ERROR #25051: Database 'probeC' is already defined in this namespace",
    code: 25051,
    domain: "%ObjectErrors",
    id: "DocumentDatabaseAlreadyExists",
    params: ["probeC"],
  },
];
const CREATED = { content: { Name: "probeC", Class: "ISC.DM.probeC", properties: [] } };

const denied = (url: string): IrisApiError => new IrisApiError(500, ACCESS_DENIED, url);
const alreadyExists = (): IrisApiError =>
  new IrisApiError(409, ALREADY_EXISTS, "/api/docdb/v1/USER/db/probeC");

const registered = (alreadyRegistered: boolean) =>
  envelope({ name: "probeC", namespace: "USER", exists: true, registered: true, alreadyRegistered });

describe("Story 44.1 -- iris_docdb_manage create registers the record", () => {
  let http: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    http = createMockHttp();
    ctx = createMockCtx(http);
  });

  const create = () => docdbManageTool.handler({ action: "create", database: "probeC" }, ctx);

  it("fresh create: the DocDB POST, then the register POST; the result is the definition plus registered:true", async () => {
    // The DocDB API answers with plain JSON (no Atelier envelope), as captured live.
    http.post.mockImplementation((url: string) =>
      Promise.resolve(url === REGISTER_URL ? registered(false) : CREATED),
    );

    const result = await create();

    expect(http.post.mock.calls).toEqual([
      [`${USER}/db/probeC`, {}],
      [REGISTER_URL, { action: "register", name: "probeC", namespace: "USER" }],
    ]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ ...CREATED, registered: true });
    expect(JSON.parse(result.content[0]!.text)).toEqual({ ...CREATED, registered: true });
  });

  it("repair: 25051 and no record registers it; created:false, registered:true", async () => {
    http.post.mockImplementation((url: string) =>
      url === REGISTER_URL ? Promise.resolve(registered(false)) : Promise.reject(alreadyExists()),
    );

    const result = await create();

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      database: "probeC",
      namespace: "USER",
      created: false,
      registered: true,
    });
    expect(result.content[0]!.text).toContain("already exists");
    expect(result.content[0]!.text).toContain("has been registered");
  });

  it("already registered: 25051 and a record already there return the original error, byte-identical", async () => {
    const err = alreadyExists();
    http.post.mockImplementation((url: string) =>
      url === REGISTER_URL ? Promise.resolve(registered(true)) : Promise.reject(err),
    );

    const result = await create();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`Error managing DocDB database: ${err.message}`);
    expect(result.structuredContent).toBeUndefined();
  });

  it("repair is keyed on the numeric code 25051, never on message text", async () => {
    // Same wording as the real 25051 text, but another code: it must not trigger a register call.
    const err = new IrisApiError(
      409,
      [{ ...ALREADY_EXISTS[0], code: 5001 }],
      "/api/docdb/v1/USER/db/probeC",
    );
    http.post.mockRejectedValue(err);

    const result = await create();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`Error managing DocDB database: ${err.message}`);
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an IrisApiError 404 from an older deployed service", new IrisApiError(404, [], REGISTER_URL, "Not found"), true],
    ["a connection error", new Error("connect ECONNREFUSED 127.0.0.1:52773"), false],
  ])("register fails after create (%s): an error naming what was created, the real text and both fixes", async (_label, failure, missingRoute) => {
    http.post.mockImplementation((url: string) =>
      url === REGISTER_URL ? Promise.reject(failure) : Promise.resolve(CREATED),
    );

    const result = await create();

    expect(result.isError).toBe(true);
    const text = result.content[0]!.text;
    expect(text).toContain("'probeC' WAS created in namespace USER");
    expect(text).toContain("NOT registered");
    expect(text).toContain(failure.message);
    expect(text).toContain('action="create"');
    expect(text).toContain("Management Portal > System Administration > Security > Applications > Doc DB Applications");
    // Only a 404 names the missing route, and the advice covers the deployments bootstrap leaves alone.
    if (missingRoute) {
      expect(text).toContain("has no /security/docdb route");
      expect(text).toContain("upgrade the iris-execute-mcp-v2 IPM module");
    } else {
      expect(text).not.toContain("/security/docdb route");
    }
    expect(result.structuredContent).toEqual({
      database: "probeC",
      namespace: "USER",
      created: true,
      registered: false,
    });
  });

  it("an unexpected register answer is a failure, never a silent success", async () => {
    http.post.mockImplementation((url: string) =>
      Promise.resolve(url === REGISTER_URL ? { result: { ok: true } } : CREATED),
    );

    const result = await create();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ created: true, registered: false });
  });

  it("repair fails: the same error with created:false and 'already exists' wording", async () => {
    http.post.mockImplementation((url: string) =>
      url === REGISTER_URL
        ? Promise.reject(new IrisApiError(500, ACCESS_DENIED, REGISTER_URL))
        : Promise.reject(alreadyExists()),
    );

    const result = await create();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'probeC' already exists in namespace USER");
    expect(result.content[0]!.text).toContain("registering its Security.DocDBs record failed");
    expect(result.structuredContent).toEqual({
      database: "probeC",
      namespace: "USER",
      created: false,
      registered: false,
    });
  });

  it("service disabled: the unchanged Story 35.7 message and no register call", async () => {
    http.post.mockRejectedValue(denied(`${USER}/db/probeC`));
    http.get.mockResolvedValue(envelope({ name: "%Service_DocDB", enabled: false }));

    const result = await create();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("currently DISABLED");
    expect(http.post.mock.calls.map((call) => call[0])).toEqual([`${USER}/db/probeC`]);
    expect(http.get).toHaveBeenCalledTimes(1);
  });
});

describe("Story 44.1 -- the 822 translation checks the record when the service is enabled", () => {
  let http: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    http = createMockHttp();
    ctx = createMockCtx(http);
  });

  /** Service GET answers `serviceResult`; the record GET answers `recordAnswer` (a rejection when it is an Error). */
  function answerGets(recordAnswer: unknown, serviceResult: unknown = { name: "%Service_DocDB", enabled: true }) {
    http.get.mockImplementation((url: string) => {
      if (url.includes(SERVICE_URL_FRAGMENT)) return Promise.resolve(envelope(serviceResult));
      return recordAnswer instanceof Error ? Promise.reject(recordAnswer) : Promise.resolve(recordAnswer);
    });
  }

  const recordState = (exists: boolean, registeredNow: boolean) =>
    envelope({ name: "probeC", namespace: "USER", exists, registered: registeredNow, alreadyRegistered: registeredNow });

  const propertyCreate = () =>
    docdbPropertyTool.handler({ action: "create", database: "probeC", property: "p", type: "%String" }, ctx);

  it("missing record: names the record, the fix and the original error", async () => {
    const err = denied(`${USER}/prop/probeC/p?type=%String`);
    http.post.mockRejectedValue(err);
    answerGets(recordState(true, false));

    const result = await propertyCreate();

    expect(result.isError).toBe(true);
    const text = result.content[0]!.text;
    expect(text).toContain("DocDB database 'probeC' in namespace USER has no Security.DocDBs record");
    expect(text).toContain('action="create"');
    expect(text).toContain("Management Portal > System Administration > Security > Applications > Doc DB Applications");
    expect(text).toContain(`Original error: ${err.message}`);
    expect(http.get).toHaveBeenCalledWith(`${REGISTER_URL}?name=probeC&namespace=USER`);
  });

  it("no such database: says so and how to create it", async () => {
    const err = denied(`${USER}/doc/probeC/1`);
    http.get.mockImplementation((url: string) =>
      url.includes(SERVICE_URL_FRAGMENT)
        ? Promise.resolve(envelope({ enabled: true }))
        : url.startsWith(REGISTER_URL)
          ? Promise.resolve(recordState(false, false))
          : Promise.reject(err),
    );

    const result = await docdbDocumentTool.handler({ action: "get", database: "probeC", id: "1" }, ctx);

    expect(result.isError).toBe(true);
    const text = result.content[0]!.text;
    expect(text).toContain("no DocDB database 'probeC' exists in namespace USER");
    expect(text).toContain('iris_docdb_manage action="create"');
    expect(text).toContain(`Original error: ${err.message}`);
  });

  it("find and drop reach the same record check", async () => {
    answerGets(recordState(true, false));
    http.post.mockRejectedValue(denied(`${USER}/find/probeC`));
    http.delete.mockRejectedValue(denied(`${USER}/db/probeC`));

    const found = await docdbFindTool.handler({ database: "probeC", filter: {} }, ctx);
    const dropped = await docdbManageTool.handler({ action: "drop", database: "probeC" }, ctx);

    expect(found.content[0]!.text).toContain("has no Security.DocDBs record");
    expect(dropped.content[0]!.text).toContain("has no Security.DocDBs record");
  });

  it.each([
    ["the record is there", recordState(true, true)],
    ["the record check fails", new Error("connection refused")],
    ["the record check answers an unexpected shape", envelope("nonsense")],
    ["the record check answers neither flag", envelope({})],
  ])("passes the original error through unchanged when %s", async (_label, recordAnswer) => {
    const err = denied(`${USER}/prop/probeC/p?type=%String`);
    http.post.mockRejectedValue(err);
    answerGets(recordAnswer);

    const result = await propertyCreate();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`Error managing property 'p': ${err.message}`);
  });

  it("a namespace-level list never checks a record", async () => {
    const err = denied(USER);
    http.get.mockImplementation((url: string) =>
      url.includes(SERVICE_URL_FRAGMENT) ? Promise.resolve(envelope({ enabled: true })) : Promise.reject(err),
    );

    // A `database` the caller passes to list is not a record target either.
    const result = await docdbManageTool.handler({ action: "list", database: "probeC" }, ctx);

    expect(result.content[0]!.text).toBe(`Error managing DocDB database: ${err.message}`);
    // The list GET and the service-state GET; no record GET.
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it("a create that is itself denied with the service enabled passes the 822 through and checks no record", async () => {
    const err = denied(`${USER}/db/probeC`);
    http.post.mockRejectedValue(err);
    answerGets(recordState(false, false));

    const result = await docdbManageTool.handler({ action: "create", database: "probeC" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`Error managing DocDB database: ${err.message}`);
    expect(http.get.mock.calls.map((call) => call[0])).toEqual([
      expect.stringContaining(SERVICE_URL_FRAGMENT),
    ]);
  });

  it("the disabled-service message is unchanged and never checks a record", async () => {
    http.post.mockRejectedValue(denied(`${USER}/prop/probeC/p?type=%String`));
    answerGets(recordState(true, false), { name: "%Service_DocDB", enabled: false });

    const result = await propertyCreate();

    expect(result.content[0]!.text).toContain("currently DISABLED");
    expect(http.get).toHaveBeenCalledTimes(1);
  });
});
