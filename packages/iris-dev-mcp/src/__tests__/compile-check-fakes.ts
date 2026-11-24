/**
 * Fakes for the compile check of the dev tools (Story 44.7, DW-754, DW-755 and DW-759).
 *
 * The shapes are the planning probes' captures (irishealth-community 2026.2 Build 221U, 2026-11-23), the same ones
 * `packages/shared/src/__tests__/bootstrap.test.ts` uses for `verifyCompiled` (Rule #54, #36):
 *
 *   action/query row:  {"ID":"X","Compiled":1,"CompileError":0}            (a class definition; Compiled 0 = no compiled class)
 *   docnames entry:    {"name":"X.cls","cat":"CLS","ts":"2026-11-23 10:20:27.782","upd":true,"db":"USER","gen":false}
 *   routine entry:     {"name":"P759Bad.mac","cat":"RTN","upd":false,"gen":false}  (a failed routine; a compiled one answers upd true)
 *   probe A: [X fails, P persistent] -> HTTP 200, no status error, no per-document error; verifyCompiled -> ["...X.cls"]
 *   probe DW-759: [bad.mac, ok.mac, Pers.cls] -> HTTP 200, success:true; docnames/RTN -> bad.mac upd false, ok.mac upd true
 *
 * A fake that answers a document the real system would not hold, or a request the tool never makes, throws, so the
 * tests fail instead of passing over a path the real system cannot take.
 */

import { vi } from "vitest";
import { envelope } from "./test-helpers.js";
import type { IrisHttpClient } from "@iris-mcp/shared";

type MockHttp = IrisHttpClient & {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

export interface CompileCheckFake {
  /** The compile request's answer: an Atelier envelope, or an error to reject with. */
  compile: unknown;
  /** Documents (`Pkg.Name.cls`, `Pkg.Name.mac`) that the check does not confirm: no compiled class (classes) and `upd: false`. */
  broken?: readonly string[];
  /**
   * Documents `docnames` lists: the classes beyond those the check asks about (the whole catalog a wildcard expands against),
   * and the routines (`.mac`, `.int`, `.inc`), which the check can learn about only from here.
   */
  catalog?: ReadonlyArray<{ name: string; gen?: boolean }>;
  /** Make the check's dictionary query reject with this error (a check that cannot run). */
  queryFails?: Error;
  /** Make the routine listing (`docnames/RTN`) reject with this error. */
  routineListFails?: Error;
  /** Answers every GET that is not a `docnames` read (the Storage guard's document reads, for instance). */
  otherGet?: (path: string) => Promise<unknown>;
}

/** What a fake recorded: the paths of every POST and GET, in order. */
export interface CompileCheckCalls {
  posts: string[];
  /** The `docnames` reads (classes and routines). */
  gets: string[];
  /** The `parameters` of each `action/query` (the class ids the check asked about). */
  queryParameters: string[][];
}

const isRoutineName = (name: string): boolean => !name.endsWith(".cls");

function entryOf(name: string, upd: boolean, gen: boolean) {
  return { name, cat: isRoutineName(name) ? "RTN" : "CLS", ts: "2026-11-23 10:20:27.782", upd, db: "USER", gen };
}

/** Route `mockHttp`'s POST and GET through a compile answer and the check's reads. */
export function fakeCompileAndCheck(mockHttp: MockHttp, fake: CompileCheckFake): CompileCheckCalls {
  const calls: CompileCheckCalls = { posts: [], gets: [], queryParameters: [] };
  const broken = new Set((fake.broken ?? []).map((name) => name.toLowerCase()));
  const asked = new Set<string>();

  mockHttp.post.mockImplementation(async (path: string, body?: unknown) => {
    calls.posts.push(path);
    if (path.includes("action/compile")) {
      if (fake.compile instanceof Error) throw fake.compile;
      return fake.compile;
    }
    if (path.includes("action/query")) {
      if (fake.queryFails) throw fake.queryFails;
      const ids = (body as { parameters: string[] }).parameters;
      calls.queryParameters.push([...ids]);
      for (const id of ids) asked.add(`${id}.cls`);
      return envelope({
        content: ids.map((id) => ({ ID: id, Compiled: broken.has(`${id}.cls`.toLowerCase()) ? 0 : 1, CompileError: 0 })),
      });
    }
    throw new Error(`unexpected POST ${path}`);
  });

  mockHttp.get.mockImplementation(async (path: string) => {
    const category = path.includes("docnames/CLS") ? "CLS" : path.includes("docnames/RTN") ? "RTN" : undefined;
    if (category === undefined) {
      if (fake.otherGet) return fake.otherGet(path);
      throw new Error(`unexpected GET ${path}`);
    }
    calls.gets.push(path);
    if (category === "RTN" && fake.routineListFails) throw fake.routineListFails;
    const listed = new Map<string, { name: string; gen: boolean }>();
    for (const entry of fake.catalog ?? []) {
      if (isRoutineName(entry.name) === (category === "RTN")) listed.set(entry.name, { name: entry.name, gen: entry.gen === true });
    }
    if (category === "CLS") for (const name of asked) listed.set(name, { name, gen: false });
    return envelope({
      content: [...listed.values()].map((entry) => entryOf(entry.name, !broken.has(entry.name.toLowerCase()), entry.gen)),
    });
  });

  return calls;
}

/**
 * The check's reads answered as a clean compile leaves them, for a hand-written fake that has its own routing: each method
 * returns the answer when the path is the check's read, and `undefined` otherwise, so a fake can try it first.
 * The class ids the query asks about are what `docnames/CLS` then lists (all up to date), as the real dictionary would; the
 * routines `docnames/RTN` lists are the ones named in `routines`.
 */
export function cleanCheckReads(options: { routines?: readonly string[] } = {}): {
  post: (path: string, body: unknown) => unknown;
  get: (path: string) => unknown;
} {
  const asked = new Set<string>();
  return {
    post(path, body) {
      if (!path.includes("action/query")) return undefined;
      const ids = (body as { parameters: string[] }).parameters;
      for (const id of ids) asked.add(`${id}.cls`);
      return envelope({ content: ids.map((id) => ({ ID: id, Compiled: 1, CompileError: 0 })) });
    },
    get(path) {
      if (path.includes("docnames/RTN")) return envelope({ content: (options.routines ?? []).map((name) => entryOf(name, true, false)) });
      if (!path.includes("docnames/CLS")) return undefined;
      return envelope({ content: [...asked].map((name) => entryOf(name, true, false)) });
    },
  };
}

/** An Atelier compile answer with one clean per-document result for each document (HTTP 200, no error listed). */
export function cleanCompileAnswer(names: readonly string[], console: string[] = []) {
  return envelope({ content: names.map((name) => ({ name, status: "", errors: [] })) }, console);
}
