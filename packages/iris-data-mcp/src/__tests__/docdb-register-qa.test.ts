/**
 * Story 44.1 QA gap tests -- what `docdb-register.test.ts` and `docdb.test.ts` leave open against the I/O matrix.
 *
 * Those suites run every matrix row in the default namespace (`USER`) with plain database names. A create/register/record-check
 * flow that hard-wires the namespace, or fails to separate URL encoding from the JSON body, is green there. This file pins:
 *  - the namespace is the resolved one in the DocDB POST, the register body, the repair/failure results and the record GET,
 *    for `create` and for each tool that passes a record target (document, find, property, drop);
 *  - the register body carries the raw name (JSON), the DocDB URLs and the record GET carry it URL-encoded;
 *  - a FRESH create whose register answers `alreadyRegistered: true` (a stale record) is a success, not the "already defined" error;
 *  - a register answer `{registered: false}` is a failure (not only the `{ok: true}` shape).
 *
 * Fake shapes follow the live captures in the header of `docdb-register.test.ts` (IRIS 2026.2 Build 221U, 2026.1 Build 234U) and the
 * handler's own envelope in `src/ExecuteMCPv2/REST/Security.cls` `DocDbRecord` (`{name, namespace, exists, registered, alreadyRegistered}`).
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  docdbManageTool,
  docdbDocumentTool,
  docdbFindTool,
  docdbPropertyTool,
} from "../tools/docdb.js";
import { createMockCtx, createMockHttp, envelope } from "@iris-mcp/shared/test-helpers";

const NS = "HSCUSTOM";
const REGISTER_URL = "/api/executemcp/v2/security/docdb";
const SERVICE_URL_FRAGMENT = "/api/executemcp/v2/security/service";

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

const recordAnswer = (flags: { exists: boolean; registered: boolean; alreadyRegistered?: boolean }) =>
  envelope({ name: "probeC", namespace: NS, alreadyRegistered: flags.registered, ...flags });

describe("Story 44.1 QA -- create in a non-default namespace", () => {
  let http: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    http = createMockHttp();
    ctx = createMockCtx(http);
  });

  const create = (database = "probeC") =>
    docdbManageTool.handler({ action: "create", database, namespace: NS }, ctx);

  it("fresh create: the DocDB POST and the register body both carry the requested namespace", async () => {
    http.post.mockImplementation((url: string) =>
      Promise.resolve(url === REGISTER_URL ? recordAnswer({ exists: true, registered: true, alreadyRegistered: false }) : CREATED),
    );

    const result = await create();

    expect(http.post.mock.calls).toEqual([
      [`/api/docdb/v1/${NS}/db/probeC`, {}],
      [REGISTER_URL, { action: "register", name: "probeC", namespace: NS }],
    ]);
    expect(result.isError).toBeUndefined();
  });

  it("the register body carries the raw name while the DocDB URL carries it encoded", async () => {
    http.post.mockImplementation((url: string) =>
      Promise.resolve(url === REGISTER_URL ? recordAnswer({ exists: true, registered: true, alreadyRegistered: false }) : CREATED),
    );

    await create("My Db/x");

    expect(http.post.mock.calls).toEqual([
      [`/api/docdb/v1/${NS}/db/My%20Db%2Fx`, {}],
      [REGISTER_URL, { action: "register", name: "My Db/x", namespace: NS }],
    ]);
  });

  it("repair: the result and text name the requested namespace", async () => {
    http.post.mockImplementation((url: string) =>
      url === REGISTER_URL
        ? Promise.resolve(recordAnswer({ exists: true, registered: true, alreadyRegistered: false }))
        : Promise.reject(new IrisApiError(409, ALREADY_EXISTS, `/api/docdb/v1/${NS}/db/probeC`)),
    );

    const result = await create();

    expect(result.structuredContent).toEqual({ database: "probeC", namespace: NS, created: false, registered: true });
    expect(result.content[0]!.text).toContain(`already exists in namespace ${NS}`);
  });

  it("register fails after create: the error and its structured content name the requested namespace", async () => {
    http.post.mockImplementation((url: string) =>
      url === REGISTER_URL ? Promise.reject(denied(REGISTER_URL)) : Promise.resolve(CREATED),
    );

    const result = await create();

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain(`'probeC' WAS created in namespace ${NS}`);
    expect(result.structuredContent).toEqual({ database: "probeC", namespace: NS, created: true, registered: false });
  });

  it("a fresh create whose register answers alreadyRegistered:true (a stale record) is a success, not the 'already defined' error", async () => {
    // Real path: a record left behind by an earlier drop that failed half way, or by an operator, for a database that was just made.
    http.post.mockImplementation((url: string) =>
      Promise.resolve(url === REGISTER_URL ? recordAnswer({ exists: true, registered: true, alreadyRegistered: true }) : CREATED),
    );

    const result = await create();

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ ...CREATED, registered: true });
  });

  it("a register answer of registered:false is a failure naming the answer, never a silent success", async () => {
    http.post.mockImplementation((url: string) =>
      Promise.resolve(url === REGISTER_URL ? recordAnswer({ exists: true, registered: false }) : CREATED),
    );

    const result = await create();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ database: "probeC", namespace: NS, created: true, registered: false });
    expect(result.content[0]!.text).toContain("the register call answered an unexpected result");
    expect(result.content[0]!.text).toContain('"registered":false');
  });
});

describe("Story 44.1 QA -- the record check targets the resolved namespace and the encoded name", () => {
  let http: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    http = createMockHttp();
    ctx = createMockCtx(http);
    http.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes(SERVICE_URL_FRAGMENT)
          ? envelope({ name: "%Service_DocDB", enabled: true })
          : recordAnswer({ exists: true, registered: false }),
      ),
    );
  });

  /** Each tool that passes a record target, driven so its DocDB call answers 822. */
  const CALLS: Array<[string, (db: string) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>]> = [
    [
      "iris_docdb_document",
      async (db) => {
        http.get.mockImplementationOnce(() => Promise.reject(denied("doc")));
        // The first GET is the document read; the following two are the service state and the record check.
        return docdbDocumentTool.handler({ action: "get", database: db, id: "1", namespace: NS }, ctx) as never;
      },
    ],
    [
      "iris_docdb_find",
      async (db) => {
        http.post.mockRejectedValue(denied("find"));
        return docdbFindTool.handler({ database: db, filter: {}, namespace: NS }, ctx) as never;
      },
    ],
    [
      "iris_docdb_property",
      async (db) => {
        http.post.mockRejectedValue(denied("prop"));
        return docdbPropertyTool.handler(
          { action: "create", database: db, property: "p", type: "%String", namespace: NS },
          ctx,
        ) as never;
      },
    ],
    [
      "iris_docdb_manage drop",
      async (db) => {
        http.delete.mockRejectedValue(denied("drop"));
        return docdbManageTool.handler({ action: "drop", database: db, namespace: NS }, ctx) as never;
      },
    ],
  ];

  it("the namespace is URL-encoded in the record GET (%SYS carries a percent sign)", async () => {
    http.delete.mockRejectedValue(denied("drop"));

    await docdbManageTool.handler({ action: "drop", database: "probeC", namespace: "%SYS" }, ctx);

    expect(http.get).toHaveBeenCalledWith(`${REGISTER_URL}?name=probeC&namespace=%25SYS`);
  });

  it.each(CALLS)("%s: the record GET carries the resolved namespace and the URL-encoded name", async (_tool, run) => {
    const result = await run("My Db/x");

    expect(result.isError).toBe(true);
    expect(http.get).toHaveBeenCalledWith(`${REGISTER_URL}?name=My%20Db%2Fx&namespace=${NS}`);
    expect(result.content[0]!.text).toContain(`DocDB database 'My Db/x' in namespace ${NS} has no Security.DocDBs record`);
  });
});
