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
import { verifyCompiled, verifyRoutinesCompiled } from "../bootstrap.js";
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
    const { http, get, post } = fakeHttp({ routines: [{ name: "A.One.mac", upd: true }, { name: "B.Two.mac", upd: true }] });

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
