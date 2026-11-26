/**
 * Story 44.7 (DW-759; AD-14; Rules #36, #54) - `verifyRoutinesCompiled`, the check of the routines a compile covered, and the pin that
 * the class check `verifyCompiled` sends the requests it sent before the story.
 *
 * The oracle is IRIS's own up-to-date flag in `docnames/RTN` (no localized text). The shapes are the planning probe's captures
 * (irishealth-community 2026.2 Build 221U, 2026-11-23, a failing `.mac` and a clean one compiled together with a persistent
 * class, so that IRIS answered the compile with HTTP 200 and nothing listed):
 *
 *   {"name":"ExecuteMCPv2.Temp.P759Bad.mac","cat":"RTN","upd":false,"gen":false,"ts":"2026-11-23 17:49:08.205"}
 *   {"name":"ExecuteMCPv2.Temp.P759Ok.mac","cat":"RTN","upd":true,"gen":false,"ts":"2026-11-23 17:49:08.210"}
 *
 * The same probe found the flag of an `.inc` true whether or not it compiled, and the flag of an `.int` true after a failed compile,
 * so the check takes `.mac` documents only and refuses any other name before a request.
 */

import { describe, it, expect, vi } from "vitest";
import { COMPILE_CHECK_BATCH, verifyCompiled, verifyRoutinesCompiled } from "../bootstrap.js";
import type { IrisHttpClient } from "../http-client.js";

/** A fake client whose `get` answers `docnames` listings per category, and whose `post` answers the dictionary query. */
function fakeHttp(options: {
  routines?: Array<{ name: string; upd: boolean }>;
  classes?: Array<{ name: string; upd: boolean }>;
  rows?: Array<{ ID: string; Compiled: number; CompileError: number }>;
}) {
  const entry = (item: { name: string; upd: boolean }, cat: string) => ({ name: item.name, cat, ts: "2026-11-23 17:49:08.205", upd: item.upd, gen: false });
  const get = vi.fn(async (path: string) => ({
    result: {
      content: path.includes("docnames/RTN")
        ? (options.routines ?? []).map((item) => entry(item, "RTN"))
        : (options.classes ?? []).map((item) => entry(item, "CLS")),
    },
  }));
  const post = vi.fn<(path: string, body?: unknown) => Promise<unknown>>(async () => ({ result: { content: options.rows ?? [] } }));
  return { http: { get, post } as unknown as IrisHttpClient, get, post };
}

describe("verifyRoutinesCompiled (DW-759)", () => {
  it("names the routine whose up-to-date flag is false, and not the clean one", async () => {
    const { http } = fakeHttp({
      routines: [
        { name: "ExecuteMCPv2.Temp.P759Bad.mac", upd: false },
        { name: "ExecuteMCPv2.Temp.P759Ok.mac", upd: true },
      ],
    });

    const named = await verifyRoutinesCompiled(http, "HSCUSTOM", 8, ["ExecuteMCPv2.Temp.P759Bad.mac", "ExecuteMCPv2.Temp.P759Ok.mac"]);

    expect(named).toEqual(["ExecuteMCPv2.Temp.P759Bad.mac"]);
  });

  it("one docnames/RTN read per package root, filtered by the root, in the namespace and version asked", async () => {
    // Every asked name is listed, so the filtered list answers all of them and no index request is sent (DW-788).
    const { http, get, post } = fakeHttp({
      routines: [{ name: "A.One.mac", upd: true }, { name: "A.Three.mac", upd: true }, { name: "B.Two.mac", upd: true }],
    });

    await verifyRoutinesCompiled(http, "HSCUSTOM", 8, ["A.One.mac", "A.Three.mac", "B.Two.mac"]);

    expect(get.mock.calls.map((call) => call[0])).toEqual([
      "/api/atelier/v8/HSCUSTOM/docnames/RTN?filter=A.",
      "/api/atelier/v8/HSCUSTOM/docnames/RTN?filter=B.",
    ]);
    expect(post).not.toHaveBeenCalled();
  });

  it("a routine IRIS does not list is not confirmed, a name match ignores case, and another package's entries are ignored", async () => {
    const { http } = fakeHttp({ routines: [{ name: "pkg.lower.mac", upd: true }, { name: "Other.Pkg.Lower.mac", upd: true }] });

    expect(await verifyRoutinesCompiled(http, "USER", 7, ["Pkg.Lower.mac", "Pkg.Missing.mac"])).toEqual(["Pkg.Missing.mac"]);
  });

  it("a routine with no package is looked up by its own name", async () => {
    const { http, get } = fakeHttp({ routines: [{ name: "Plain.mac", upd: false }] });

    expect(await verifyRoutinesCompiled(http, "USER", 7, ["Plain.mac"])).toEqual(["Plain.mac"]);
    expect(get.mock.calls[0]?.[0]).toBe("/api/atelier/v7/USER/docnames/RTN?filter=Plain.");
  });

  it("an empty list sends nothing and names nothing", async () => {
    const { http, get } = fakeHttp({});

    expect(await verifyRoutinesCompiled(http, "USER", 7, [])).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("refuses a name that is not a .mac routine before any request (.inc and .int cannot be judged by the flag)", async () => {
    for (const name of ["Pkg.Inc.inc", "Pkg.Int.int", "Pkg.Cls.cls", ".mac", "Pkg.Mac"]) {
      const { http, get } = fakeHttp({});
      await expect(verifyRoutinesCompiled(http, "USER", 7, ["Pkg.Ok.mac", name]), name).rejects.toThrow(/takes documents ending in \.mac/);
      expect(get, name).not.toHaveBeenCalled();
    }
  });

  it("a listing that cannot be read throws: a check that cannot run is never a pass", async () => {
    const get = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    await expect(verifyRoutinesCompiled({ get } as unknown as IrisHttpClient, "USER", 7, ["Pkg.Ok.mac"])).rejects.toThrow("ECONNRESET");
  });
});

describe("verifyCompiled batches its dictionary query (Story 44.7 review)", () => {
  // Probe 2026-11-23 (irishealth-community 2026.2, HSCUSTOM): one check query of 375 class names answered, one of 400 failed with
  // `ERROR #5002: ObjectScript error: <STACK>Query+40^%Api.Atelier.v6.1`, so a compile of that many classes read as a check that
  // could not run. The query is sent per 100 names; the rows answer only the names a query asked for, as IRIS's do.
  it("250 names: three queries of 100, 100 and 50 parameters, each with as many placeholders, and the verdicts of all three are kept", async () => {
    const names = Array.from({ length: 250 }, (_, index) => `Big.C${index}.cls`);
    const get = vi.fn(async () => ({
      result: { content: names.map((name) => ({ name, cat: "CLS", ts: "2026-11-23 17:49:08.205", upd: true, gen: false })) },
    }));
    const post = vi.fn(async (_path: string, body?: unknown) => {
      const { parameters } = body as { parameters: string[] };
      return { result: { content: parameters.map((ID) => ({ ID, Compiled: ID === "Big.C240" ? 0 : 1, CompileError: 0 })) } };
    });
    const http = { get, post } as unknown as IrisHttpClient;

    const named = await verifyCompiled(http, "HSCUSTOM", 8, names);

    expect(named).toEqual(["Big.C240.cls"]);
    const bodies = post.mock.calls.map((call) => call[1] as { query: string; parameters: string[] });
    expect(bodies.map((body) => body.parameters.length)).toEqual([100, 100, 50]);
    expect(bodies.flatMap((body) => body.parameters)).toEqual(names.map((name) => name.slice(0, -".cls".length)));
    for (const body of bodies) expect(body.query.match(/\?/g)).toHaveLength(body.parameters.length);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("exactly 100 names is one query, and COMPILE_CHECK_BATCH is 100", async () => {
    const names = Array.from({ length: 100 }, (_, index) => `Big.C${index}.cls`);
    // The list names every class, so only the dictionary query is a POST.
    const { http, post } = fakeHttp({ classes: names.map((name) => ({ name, upd: true })) });

    await verifyCompiled(http, "HSCUSTOM", 8, names);

    expect(post).toHaveBeenCalledTimes(1);
    expect(COMPILE_CHECK_BATCH).toBe(100);
  });
});

describe("DW-788: the documents the filtered list leaves out are read through action/index", () => {
  // Plan probe P-788 (2026-11-26, IRIS Community 2026.2 Build 221U, throwaway 127.0.0.1:52792): `GET docnames/CLS?filter=ExecuteMCPv2.`
  // answered 101 entries for `_SYSTEM` and 0 entries (HTTP 200, no error) for an account without SQL privileges, and `POST action/index`
  // answered the same `upd` flag for both. Shape re-captured 2026-11-26 on irishealth-community 2026.2 (HSCUSTOM) with
  // `client.post(".../action/index", ["ExecuteMCPv2.Setup.cls","ExecuteMCPv2.NoSuchClass.cls","ExecuteMCPv2.Utils.cls"])`: entries come back ordered
  // by name, each `{name, db, ts, upd, cat, gen, others, status, content}`; a document that does not exist has `status`
  // "ERROR #16005: Document 'ExecuteMCPv2.NoSuchClass.cls' does NOT exist", an empty `ts` and NO `upd` key.
  const indexEntry = (name: string, upd: boolean | undefined) => ({
    name,
    db: upd === undefined ? "" : "HSCUSTOM",
    ts: upd === undefined ? "" : "2026-11-26 16:16:55.415",
    ...(upd === undefined ? {} : { upd }),
    cat: "CLS",
    status: upd === undefined ? `ERROR #16005: Document '${name}' does NOT exist` : "",
  });

  /** A fake whose `docnames` list is empty (the account has no SQL privileges) and whose `action/index` answers per name. */
  function leastPrivilegeHttp(verdicts: Record<string, boolean | undefined>, compiledRows = true) {
    const get = vi.fn(async (_path: string) => ({ result: { content: [] } }));
    const post = vi.fn(async (path: string, body?: unknown) => {
      if (path.endsWith("/action/index")) {
        return { result: { content: (body as string[]).map((name) => indexEntry(name, verdicts[name])).sort((a, b) => a.name.localeCompare(b.name)) } };
      }
      const { parameters } = body as { parameters: string[] };
      return { result: { content: parameters.map((ID) => ({ ID, Compiled: compiledRows ? 1 : 0, CompileError: 0 })) } };
    });
    return { http: { get, post } as unknown as IrisHttpClient, get, post };
  }

  it("an empty filtered list: one action/index with the names, and the classes it confirms are compiled", async () => {
    const { http, get, post } = leastPrivilegeHttp({ "Pkg.A.cls": true, "Pkg.B.cls": true });

    expect(await verifyCompiled(http, "HSCUSTOM", 8, ["Pkg.A.cls", "Pkg.B.cls"])).toEqual([]);

    expect(get.mock.calls.map((call) => call[0])).toEqual(["/api/atelier/v8/HSCUSTOM/docnames/CLS?filter=Pkg."]);
    expect(post.mock.calls.map((call) => call[0])).toEqual([
      "/api/atelier/v8/HSCUSTOM/action/query",
      "/api/atelier/v8/HSCUSTOM/action/index",
    ]);
    expect(post.mock.calls[1]?.[1]).toEqual(["Pkg.A.cls", "Pkg.B.cls"]);
  });

  it("an uncompiled edit (upd false) and a missing document (no upd, an error status) are still named", async () => {
    const { http } = leastPrivilegeHttp({ "Pkg.A.cls": true, "Pkg.Edited.cls": false, "Pkg.Gone.cls": undefined });

    expect(await verifyCompiled(http, "HSCUSTOM", 8, ["Pkg.A.cls", "Pkg.Edited.cls", "Pkg.Gone.cls"])).toEqual([
      "Pkg.Edited.cls",
      "Pkg.Gone.cls",
    ]);
  });

  it("the dictionary still decides: a class with no compiled class is named although the index says upd true", async () => {
    const { http } = leastPrivilegeHttp({ "Pkg.A.cls": true }, false);

    expect(await verifyCompiled(http, "HSCUSTOM", 8, ["Pkg.A.cls"])).toEqual(["Pkg.A.cls"]);
  });

  it("only the names the list left out are indexed, in batches of COMPILE_CHECK_BATCH", async () => {
    const names = Array.from({ length: 250 }, (_, index) => `Big.C${index}.cls`);
    const listed = names.slice(0, 5);
    const get = vi.fn(async () => ({ result: { content: listed.map((name) => ({ name, cat: "CLS", ts: "x", upd: true, gen: false })) } }));
    const post = vi.fn(async (path: string, body?: unknown) => {
      if (path.endsWith("/action/index")) return { result: { content: (body as string[]).map((name) => indexEntry(name, true)) } };
      return { result: { content: (body as { parameters: string[] }).parameters.map((ID) => ({ ID, Compiled: 1, CompileError: 0 })) } };
    });

    expect(await verifyCompiled({ get, post } as unknown as IrisHttpClient, "HSCUSTOM", 8, names)).toEqual([]);

    const indexed = post.mock.calls.filter((call) => String(call[0]).endsWith("/action/index")).map((call) => call[1] as string[]);
    expect(indexed.map((batch) => batch.length)).toEqual([100, 100, 45]);
    expect(indexed.flat()).toEqual(names.slice(5));
  });

  it("a routine the RTN list left out is read through action/index with the .mac name", async () => {
    const get = vi.fn(async () => ({ result: { content: [] } }));
    const post = vi.fn(async (_path: string, body?: unknown) => ({
      result: { content: (body as string[]).map((name) => ({ name, cat: "RTN", upd: name !== "Pkg.Bad.mac" })) },
    }));

    expect(await verifyRoutinesCompiled({ get, post } as unknown as IrisHttpClient, "HSCUSTOM", 8, ["Pkg.Good.mac", "Pkg.Bad.mac"])).toEqual([
      "Pkg.Bad.mac",
    ]);
    expect(post.mock.calls).toEqual([["/api/atelier/v8/HSCUSTOM/action/index", ["Pkg.Good.mac", "Pkg.Bad.mac"]]]);
  });

  it("a failing index request throws: a check that cannot run is never a pass", async () => {
    const get = vi.fn(async () => ({ result: { content: [] } }));
    const post = vi.fn(async (path: string) => {
      if (path.endsWith("/action/index")) throw new Error("ECONNRESET");
      return { result: { content: [] } };
    });

    await expect(verifyCompiled({ get, post } as unknown as IrisHttpClient, "HSCUSTOM", 8, ["Pkg.A.cls"])).rejects.toThrow("ECONNRESET");
  });
});

describe("verifyCompiled keeps the requests it sent before Story 44.7", () => {
  it("one dictionary query over the class ids, then one docnames/CLS read per package root", async () => {
    const { http, get, post } = fakeHttp({
      rows: [
        { ID: "Pkg.A", Compiled: 1, CompileError: 0 },
        { ID: "Pkg.B", Compiled: 0, CompileError: 0 },
      ],
      classes: [
        { name: "Pkg.A.cls", upd: true },
        { name: "Pkg.B.cls", upd: false },
      ],
    });

    const named = await verifyCompiled(http, "HSCUSTOM", 8, ["Pkg.A.cls", "Pkg.B.cls"]);

    expect(named).toEqual(["Pkg.B.cls"]);
    expect(post.mock.calls).toHaveLength(1);
    expect(post.mock.calls[0]?.[0]).toBe("/api/atelier/v8/HSCUSTOM/action/query");
    expect((post.mock.calls[0]?.[1] as { parameters: string[] }).parameters).toEqual(["Pkg.A", "Pkg.B"]);
    expect(get.mock.calls.map((call) => call[0])).toEqual(["/api/atelier/v8/HSCUSTOM/docnames/CLS?filter=Pkg."]);
  });
});
