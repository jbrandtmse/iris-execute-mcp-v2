/**
 * A STATEFUL fake of the IRIS Atelier web server, for the bootstrap-guard orchestration test: it remembers what was
 * written to it (documents, their `ts`, the compiled marker), which is what the bootstrap guard can only be observed
 * against. Its reply envelopes are those of `scripts/lib/fake-iris-listener.mjs`.
 *
 * It listens on 127.0.0.1 on an ephemeral port (never 52773 or 1972) and models one namespace:
 *
 * - `GET` and `HEAD /api/atelier/`: the server banner (api version 8, the namespaces).
 * - `PUT  /api/atelier/v<N>/<ns>/doc/<name>?ignoreConflict=1`: stores the document's lines and gives it a new `ts`. An
 *   existing document without `ignoreConflict=1` is refused with HTTP 409, as IRIS refuses a stale save.
 * - `GET  /api/atelier/v<N>/<ns>/doc/<name>`: `{ts, content}`, or a 404 envelope for a missing document.
 * - `DELETE /api/atelier/v<N>/<ns>/doc/<name>`: removes the stored document (200), or a 404 envelope when there is none.
 * - `POST /api/atelier/v<N>/<ns>/action/compile` (a JSON array of names): compiling `ExecuteMCPv2.Setup.cls` makes the
 *   COMPILED marker the one in the stored `Parameter BOOTSTRAPVERSION = "..."` line, as IRIS would. A missing document
 *   is an HTTP 500 error envelope and changes nothing. Every class listed and not failed by `compileFailure` is compiled:
 *   it gets a compiled row, remembers the `ts` of the document it was compiled from, and carries no compile error.
 * - `GET /api/atelier/v<N>/<ns>/docnames/CLS?filter=<text>`: one entry `{name, cat, ts, upd, db, gen}` per stored class
 *   document whose name contains `<text>`, with IRIS's `upd` flag: true only for a class with a compiled row that is not
 *   stale (`upd` held at its compile, and the document not stored again since).
 * - `POST action/query` of the compile check (a `%Dictionary.ClassDefinition` LEFT JOIN `%Dictionary.CompiledClass` over the
 *   class names in `parameters`): one row `{ID, Compiled, CompileError}` per stored class document among them, as the
 *   probe captured it (the values are JSON numbers).
 * - `POST /api/atelier/v<N>/<ns>/action/query`: `SELECT 1 AS One` answers a row (a live instance, whatever is deployed);
 *   `Setup_GetBootstrapVersion()` answers the compiled marker, and an
 *   HTTP 500 error envelope while `Setup` has never been compiled (as IRIS answers for a missing SQL function);
 *   `Setup_Configure(?)`, `Setup_ConfigureMapping(?)` and `Setup_IsConfigured()` model the web application and the
 *   package mapping; `Setup_EnsureUnitTestRoot()` answers a fixed path. The `Setup_*` functions need a compiled `Setup`.
 *
 * Every other request is answered with a clean 404 envelope, so nothing a started server asks ever hangs. Every request
 * is recorded (method, url, body).
 *
 * `SELECT Name FROM %Dictionary.CompiledClass WHERE Name = '<class>'` answers one row when `<class>` is one of the options'
 * `visibleClasses` and none otherwise: the check that a namespace can see `Ens.Director`.
 *
 * `compileFailure`, when a test sets it, is called with the names of each compile request and answers how IRIS compiles it
 * when some classes fail (the planning probe's captures, Story 44.4). The listed classes it does not fail still compile.
 * `failed` names the classes (document names, with `.cls`) and the kind of failure: a `routine` failure keeps a compiled row
 * with the error flag set and `upd` true; a `class` failure leaves no row on a first compile, and keeps the old row with the
 * error flag set and `upd` false when one existed. `shape` is the envelope: `status-errors` answers HTTP 200 with ONE status
 * error, for the first failed class (as IRIS does in the all-fail case), and `storage-written` answers HTTP 200 with no
 * status error and a `result.content` entry for a class whose Storage the compile wrote, because `General.Compile` replaces
 * the compile status with the status of the documents it updated. `console`, when set, is the answer's console. A hook that
 * returns `undefined` leaves the compile clean.
 *
 * `failCompileCheck`, when a test sets it to `"query"` or `"docnames"`, answers that one read of the compile check with an
 * HTTP 500 error envelope.
 *
 * `failVersionQuery`, when a test sets it, answers the `Setup_GetBootstrapVersion()` query as a deployment whose marker
 * cannot be read: an HTTP status and envelope of the test's choosing, or no answer at all (`hang`, a timeout of the
 * client). It is called with the number of version queries since it was set, so a test can fail only the re-read.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { envelope, errorEnvelope } from "../../../../scripts/lib/fake-iris-listener.mjs";

/** The document that carries the version marker. */
export const SETUP_DOCUMENT = "ExecuteMCPv2.Setup.cls";

/** One recorded request. */
export interface FakeRequest {
  method: string;
  url: string;
  body: string;
}

/** A stored document. */
export interface FakeDocument {
  lines: string[];
  ts: string;
}

/** What the fake remembers about one class's last compile. */
export interface FakeClassCompile {
  /** The `ts` of the document the class was compiled from. */
  compiledFrom: string;
  /** Whether the compiled class carries a compile error (`%Dictionary.CompiledClass.ClassCompileError`). */
  error: boolean;
  /**
   * IRIS's own up-to-date judgment (the Atelier `upd` flag): true after a clean compile, false once the document is stored
   * again, and false for a class skipped because a dependency failed. A test sets it directly to model a state the compile
   * does not produce, such as a rollback to identical content, which IRIS treats as up to date by hash whatever the `ts`.
   */
  upd: boolean;
}

/** How a compile with failures is answered ({@link StatefulFakeAtelier.compileFailure}). */
export interface FakeCompileFailure {
  /**
   * `reported` names the class in the status error and flags nothing: a combination the planning probe never observed
   * (a status error with every class confirmed), kept so a test can show that a status error is never read as success.
   */
  failed: Array<{ name: string; kind: "routine" | "class" | "reported" }>;
  shape: "status-errors" | "storage-written";
  console?: readonly string[];
}

/** What the fake remembers. */
export interface FakeAtelierState {
  /** The last compile of each class, by document name (`Pkg.Name.cls`); a class that was never compiled has none. */
  classes: Map<string, FakeClassCompile>;
  /** The marker the compiled `ExecuteMCPv2.Setup` reports; `undefined` until `Setup` is compiled. */
  compiledMarker: string | undefined;
  /** Whether `Setup_Configure` registered the web application. */
  configured: boolean;
  /** Whether `Setup_ConfigureMapping` mapped the package. */
  mapped: boolean;
  /** The stored documents by name. */
  docs: Map<string, FakeDocument>;
}

/** Options of {@link startStatefulFakeAtelier}. */
export interface FakeAtelierOptions {
  /** The one namespace the fake serves. */
  namespace: string;
  /** The classes `%Dictionary.CompiledClass` lists in this namespace; none when omitted. */
  visibleClasses?: readonly string[];
  /**
   * Called after each stored document, with that document's name and the number of documents stored since the fake
   * started. It may change the state, which is how a test models another client that compiled while this one was
   * still uploading.
   */
  onPut?: (name: string, putCount: number, state: FakeAtelierState) => void;
}

/** How the fake answers one version query instead of reading the compiled marker. */
export type VersionQueryFailure = { kind: "reply"; status: number; body: unknown } | { kind: "hang" };

/** A running fake. */
export interface StatefulFakeAtelier {
  port: number;
  namespace: string;
  requests: FakeRequest[];
  state: FakeAtelierState;
  /**
   * Set to fail the version query: called with the 1-based number of version queries since it was set; `undefined`
   * from it (or an unset hook) answers normally. Setting it restarts the count.
   */
  failVersionQuery: ((count: number) => VersionQueryFailure | undefined) | undefined;
  /** Set to fail some classes of a compile request: called with the names it carries (see the header). */
  compileFailure: ((names: string[]) => FakeCompileFailure | undefined) | undefined;
  /**
   * Set to make one of the compile check's two reads fail with an HTTP 500 error envelope (the `query` over the dictionary,
   * or the `docnames` read), so a test can show what a check that cannot run does.
   */
  failCompileCheck: "query" | "docnames" | undefined;
  close: () => Promise<void>;
}

/** The requests of a window, by kind. */
export interface RequestSummary {
  /** The names of the documents stored, in order. */
  puts: string[];
  /** How many compiles were requested. */
  compiles: number;
  /** The SQL statements asked of `action/query`, in order. */
  queries: string[];
  /** `METHOD path` of every other request. */
  others: string[];
}

const REFUSED_PORTS = new Set([52773, 1972]);

const ATELIER_API = 8;

/**
 * The planning probe's de-DE console of a compile in which a class failed and another class's Storage was written (Story 44.4,
 * captured live 2026-11-23 on IRIS 2026.2 Build 221U; the locale is set per request by `Accept-Language`). Pass it as the
 * `console` of {@link FakeCompileFailure}: the answer's console is localized text that nothing may decide on.
 */
export const COMPILE_CONSOLE_DE: readonly string[] = ["","Kompilierung begonnen am 11/23/2026 10:18:04 mit Qualifizierern 'cuk'","Class User.P444A ist auf dem neuesten Stand.","Kompilieren von 2 Klassen","Kompilieren der Klasse User.P444X","Kompilieren der Klasse User.P444P","Kompilieren der Tabelle SQLUser.P444P","Kompilieren der Routine User.P444X.1","ERROR: User.P444X.cls","ERROR:  User.P444X.1(3) : MPP5610 : Referenzmakro nicht definiert: 'NoSuchMacro444'"," TEXT:   Quit $$$NoSuchMacro444 }","ERROR: User.P444X.cls(Hi+2) #1002: Invalid character in tag : '}' : Offset:26 [Hi+1^User.P444X.1]"," TEXT:   Quit $$$NoSuchMacro444 }","Kompilieren der Routine User.P444P.1","2 Fehler w\u00e4hrend der Kompilierung in 0.028s erkannt."];

/** The same compile's ja-JP console (captured with the de-DE one). */
export const COMPILE_CONSOLE_JA: readonly string[] = ["","11/23/2026 10:18:04 \u306b\u4fee\u98fe\u5b50 'cuk' \u3067\u30b3\u30f3\u30d1\u30a4\u30eb\u3092\u958b\u59cb\u3057\u307e\u3057\u305f\u3002","Class User.P444A\u306f\u6700\u65b0\u72b6\u614b\u3067\u3059\u3002",", 2 \u30af\u30e9\u30b9\u3092\u30b3\u30f3\u30d1\u30a4\u30eb\u4e2d","\u30af\u30e9\u30b9\u306e\u30b3\u30f3\u30d1\u30a4\u30eb\u4e2d User.P444X","\u30af\u30e9\u30b9\u306e\u30b3\u30f3\u30d1\u30a4\u30eb\u4e2d User.P444P","\u30c6\u30fc\u30d6\u30eb\u306e\u30b3\u30f3\u30d1\u30a4\u30eb\u4e2d SQLUser.P444P","\u30eb\u30fc\u30c1\u30f3\u306e\u30b3\u30f3\u30d1\u30a4\u30eb\u4e2d User.P444X.1","ERROR: User.P444X.cls","ERROR:  User.P444X.1(3) : MPP5610 : \u53c2\u7167\u30de\u30af\u30ed\u304c\u5b9a\u7fa9\u3055\u308c\u3066\u3044\u307e\u305b\u3093: 'NoSuchMacro444' "," TEXT:   Quit $$$NoSuchMacro444 }","ERROR: User.P444X.cls(Hi+2) #1002: Invalid character in tag : '}' : Offset:26 [Hi+1^User.P444X.1]"," TEXT:   Quit $$$NoSuchMacro444 }","\u30eb\u30fc\u30c1\u30f3\u306e\u30b3\u30f3\u30d1\u30a4\u30eb\u4e2d User.P444P.1","0.027s \u306e\u30b3\u30f3\u30d1\u30a4\u30eb\u4e2d\u306b 2 \u30a8\u30e9\u30fc\u3092\u691c\u51fa\u3057\u307e\u3057\u305f\u3002"];

/** The compile check's statement (`verifyCompiled` of the shared dist): the dictionary join over the class names. */
const COMPILE_CHECK_STATEMENT = /FROM %Dictionary\.ClassDefinition d LEFT JOIN %Dictionary\.CompiledClass c ON c\.ID = d\.ID WHERE d\.ID IN \(/;

/** Whether `statement` is the compile check's dictionary query. */
export function isCompileCheckQuery(statement: string): boolean {
  return COMPILE_CHECK_STATEMENT.test(statement);
}

/**
 * The one status error IRIS answers a compile with, in the planning probe's captured `{error, code, domain, id, params}` shape
 * (Story 44.4, 2026-11-23, IRIS 2026.2 Build 221U): a routine failure is #5475 and a class failure is #5373. `documentName` is
 * the failed class's document name; its class name is substituted into the capture.
 */
function captureStatusError(documentName: string, kind: "routine" | "class"): { error: string; code: number; domain: string; id: string; params: string[] } {
  const cls = documentName.replace(/\.cls$/, "");
  if (kind === "routine") {
    const detail = `${cls}.cls\r\nERROR:  ${cls}.1(3) : MPP5610 : Referenced macro not defined: 'NoSuchMacro444'\r\n TEXT:   Quit $$$NoSuchMacro444 }`;
    return {
      error: `ERROR #5475: Error compiling routine: ${cls}.  Errors:  ${detail}`,
      code: 5475,
      domain: "%ObjectErrors",
      id: "RoutineCompilationErrorWithInfo",
      params: [cls, detail.replace(/'/g, "&#39;"), "", "", "", "", ""],
    };
  }
  return {
    error: `ERROR #5373: Class 'User.NoSuchSuper444', used by '${cls}:superclass', does not exist`,
    code: 5373,
    domain: "%ObjectErrors",
    id: "PredecessorClassDoesNotExist",
    params: ["User.NoSuchSuper444", `${cls}:superclass`, "", "", "", "", ""],
  };
}

/** The `Parameter BOOTSTRAPVERSION = "<marker>";` value of a stored `Setup` document, or `undefined`. */
function markerOf(lines: readonly string[]): string | undefined {
  for (const line of lines) {
    const match = /^Parameter BOOTSTRAPVERSION = "([^"]*)";\s*$/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

/** Group the requests of one window by kind. */
export function summarizeRequests(requests: readonly FakeRequest[]): RequestSummary {
  const summary: RequestSummary = { puts: [], compiles: 0, queries: [], others: [] };
  for (const request of requests) {
    const pathname = new URL(request.url, "http://fake.invalid").pathname;
    const document = /\/doc\/([^/]+)$/.exec(pathname);
    if (request.method === "PUT" && document) {
      summary.puts.push(decodeURIComponent(document[1] as string));
    } else if (request.method === "POST" && pathname.endsWith("/action/compile")) {
      summary.compiles += 1;
    } else if (request.method === "POST" && pathname.endsWith("/action/query")) {
      summary.queries.push(String((JSON.parse(request.body) as { query?: unknown }).query ?? ""));
    } else {
      summary.others.push(`${request.method} ${pathname}`);
    }
  }
  return summary;
}

/** Start the fake. The caller closes it. */
export async function startStatefulFakeAtelier(options: FakeAtelierOptions): Promise<StatefulFakeAtelier> {
  const { namespace } = options;
  const state: FakeAtelierState = { classes: new Map(), compiledMarker: undefined, configured: false, mapped: false, docs: new Map() };
  const requests: FakeRequest[] = [];
  let putCount = 0;
  let tick = 0;
  let failVersionQuery: StatefulFakeAtelier["failVersionQuery"];
  let compileFailure: StatefulFakeAtelier["compileFailure"];
  let failCompileCheck: StatefulFakeAtelier["failCompileCheck"];
  let versionQueries = 0;
  const visibleClasses = new Set(options.visibleClasses ?? []);

  /** Strictly increasing, deterministic Atelier-style timestamps. */
  const nextTimestamp = (): string => {
    tick += 1;
    return new Date(Date.UTC(2026, 9, 21, 12, 0, 0) + tick).toISOString().replace("T", " ").replace("Z", "");
  };

  const reply = (res: http.ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const missingFunction = (res: http.ServerResponse, name: string): void => {
    reply(
      res,
      500,
      errorEnvelope(`ERROR #5540: SQLCODE: -359 Message: User defined SQL function '${name.toUpperCase()}' does not exist`, 5540),
    );
  };

  /** IRIS's `upd` flag of a stored class document: its compiled class is up to date (see {@link FakeClassCompile.upd}). */
  const classUpdated = (name: string): boolean => state.classes.get(name)?.upd === true;

  const query = (res: http.ServerResponse, statement: string, parameters: readonly unknown[]): void => {
    if (COMPILE_CHECK_STATEMENT.test(statement)) {
      if (failCompileCheck === "query") {
        reply(res, 500, errorEnvelope("ERROR #5002: ObjectScript error: <STORE>", 5002));
        return;
      }
      const content = parameters
        .map(String)
        .filter((id) => state.docs.has(`${id}.cls`))
        .map((id) => {
          const compiled = state.classes.get(`${id}.cls`);
          return { ID: id, Compiled: compiled === undefined ? 0 : 1, CompileError: compiled?.error === true ? 1 : 0 };
        });
      reply(res, 200, envelope({ content }));
      return;
    }
    if (/^\s*SELECT 1 AS One\s*$/i.test(statement)) {
      reply(res, 200, envelope({ content: [{ One: 1 }] }));
      return;
    }
    if (statement.includes("Setup_GetBootstrapVersion")) {
      if (failVersionQuery !== undefined) {
        versionQueries += 1;
        const failure = failVersionQuery(versionQueries);
        if (failure?.kind === "hang") return;
        if (failure?.kind === "reply") {
          reply(res, failure.status, failure.body);
          return;
        }
      }
      if (state.compiledMarker === undefined) return missingFunction(res, "EXECUTEMCPV2.SETUP_GETBOOTSTRAPVERSION");
      reply(res, 200, envelope({ content: [{ Version: state.compiledMarker }] }));
      return;
    }
    if (statement.includes("Setup_")) {
      if (state.compiledMarker === undefined) return missingFunction(res, "EXECUTEMCPV2.SETUP");
      if (statement.includes("Setup_IsConfigured")) {
        reply(res, 200, envelope({ content: [{ Configured: state.configured ? 1 : 0 }] }));
      } else if (statement.includes("Setup_ConfigureMapping")) {
        state.mapped = true;
        reply(res, 200, envelope({ content: [{ MappingResult: 1 }] }));
      } else if (statement.includes("Setup_Configure")) {
        state.configured = true;
        reply(res, 200, envelope({ content: [{ ConfigureResult: 1 }] }));
      } else if (statement.includes("Setup_EnsureUnitTestRoot")) {
        reply(res, 200, envelope({ content: [{ UnitTestRoot: "/fake/mgr/" }] }));
      } else {
        reply(res, 404, errorEnvelope(`the fake IRIS has no SQL function for: ${statement}`, 404));
      }
      return;
    }
    const dictionary = /^\s*SELECT Name FROM %Dictionary\.CompiledClass WHERE Name = '([^']+)'\s*$/i.exec(statement);
    if (dictionary) {
      const name = dictionary[1] as string;
      reply(res, 200, envelope({ content: visibleClasses.has(name) ? [{ Name: name }] : [] }));
      return;
    }
    reply(res, 404, errorEnvelope(`the fake IRIS does not run: ${statement}`, 404));
  };

  const route = (method: string, rawUrl: string, bodyText: string, res: http.ServerResponse): void => {
    const url = new URL(rawUrl, "http://fake.invalid");
    let body: unknown;
    try {
      body = bodyText === "" ? undefined : JSON.parse(bodyText);
    } catch {
      body = undefined;
    }

    if (url.pathname === "/api/atelier/") {
      if (method === "HEAD") {
        res.writeHead(200);
        res.end();
        return;
      }
      reply(
        res,
        200,
        envelope({
          content: {
            version: "IRIS for UNIX (Stateful Fake) 2026.2 (Build 221U)",
            id: "FAKE-IRIS-STATEFUL",
            api: ATELIER_API,
            features: [],
            namespaces: [namespace, "%SYS"],
          },
        }),
      );
      return;
    }

    const atelier = /^\/api\/atelier\/v\d+\/([^/]+)\/(.*)$/.exec(url.pathname);
    if (!atelier) {
      reply(res, 404, errorEnvelope(`the fake IRIS has no route for ${method} ${url.pathname}`, 404));
      return;
    }
    const [, requestedNamespace, action] = atelier as unknown as [string, string, string];
    if (decodeURIComponent(requestedNamespace) !== namespace) {
      reply(res, 404, errorEnvelope(`ERROR #16005: Namespace '${requestedNamespace}' does not exist`, 16005));
      return;
    }

    if (method === "POST" && action === "action/query") {
      const parameters = (body as { parameters?: unknown } | undefined)?.parameters;
      query(res, String((body as { query?: unknown } | undefined)?.query ?? ""), Array.isArray(parameters) ? parameters : []);
      return;
    }

    if (method === "GET" && action === "docnames/CLS") {
      if (failCompileCheck === "docnames") {
        reply(res, 500, errorEnvelope("ERROR #5002: ObjectScript error: <STORE>", 5002));
        return;
      }
      const filter = url.searchParams.get("filter") ?? "";
      const content = [...state.docs.entries()]
        .filter(([name]) => name.endsWith(".cls") && name.includes(filter))
        .map(([name, stored]) => ({ name, cat: "CLS", ts: stored.ts, upd: classUpdated(name), db: namespace, gen: false }));
      reply(res, 200, envelope({ content }));
      return;
    }

    if (method === "POST" && action === "action/compile") {
      const names = Array.isArray(body) ? (body as unknown[]).map(String) : [];
      const missing = names.filter((name) => !state.docs.has(name));
      if (missing.length > 0) {
        reply(res, 500, errorEnvelope(`ERROR #5373: Class '${missing[0]}' does not exist`, 5373));
        return;
      }
      const failure = compileFailure?.(names);
      const failedKinds = new Map((failure?.failed ?? []).map((failed) => [failed.name, failed.kind]));
      for (const name of names) {
        const stored = state.docs.get(name) as FakeDocument;
        const kind = failedKinds.get(name);
        const earlier = state.classes.get(name);
        if (kind === undefined || kind === "reported") {
          state.classes.set(name, { compiledFrom: stored.ts, error: false, upd: true });
        } else if (kind === "routine") {
          state.classes.set(name, { compiledFrom: stored.ts, error: true, upd: true });
        } else if (earlier !== undefined) {
          state.classes.set(name, { ...earlier, error: true, upd: false });
        }
      }
      if (names.includes(SETUP_DOCUMENT) && !failedKinds.has(SETUP_DOCUMENT)) {
        const marker = markerOf((state.docs.get(SETUP_DOCUMENT) as FakeDocument).lines);
        if (marker !== undefined) state.compiledMarker = marker;
      }
      if (failure === undefined || failure.failed.length === 0) {
        reply(res, 200, { status: { errors: [], summary: "" }, console: failure?.console ?? ["Compilation finished successfully."], result: { content: [] } });
        return;
      }
      const failureConsole = failure.console ?? failure.failed.map((failed) => `ERROR: ${failed.name}`);
      if (failure.shape === "status-errors") {
        const first = failure.failed[0] as FakeCompileFailure["failed"][number];
        const error = captureStatusError(first.name, first.kind === "reported" ? "class" : first.kind);
        reply(res, 200, { status: { errors: [error], summary: error.error }, console: failureConsole, result: { content: [] } });
        return;
      }
      // storage-written: the compile wrote the Storage of a listed class that did not fail, and IRIS answers with that class's entry only.
      const written = names.find((name) => !failedKinds.has(name)) ?? names[0];
      const entry = { name: written, status: "", content: ["Storage Default", "{", "}"], db: namespace, ts: state.docs.get(written as string)?.ts, enc: false, flags: 1 };
      reply(res, 200, { status: { errors: [], summary: "" }, console: failureConsole, result: { content: [entry] } });
      return;
    }

    const document = /^doc\/(.+)$/.exec(action);
    if (document) {
      const name = decodeURIComponent(document[1] as string);
      if (method === "PUT") {
        const content = (body as { content?: unknown; enc?: unknown } | undefined)?.content;
        if (!Array.isArray(content) || (body as { enc?: unknown }).enc === true) {
          reply(res, 400, errorEnvelope("the fake IRIS stores only plain line content", 400));
          return;
        }
        if (state.docs.has(name) && url.searchParams.get("ignoreConflict") !== "1") {
          reply(res, 409, errorEnvelope(`ERROR #5000: '${name}' was changed on the server since it was read`, 5000));
          return;
        }
        const ts = nextTimestamp();
        state.docs.set(name, { lines: content.map(String), ts });
        // Source stored again since the compile: the compiled class is no longer up to date.
        const compiledBefore = state.classes.get(name);
        if (compiledBefore !== undefined) compiledBefore.upd = false;
        putCount += 1;
        options.onPut?.(name, putCount, state);
        reply(res, 200, envelope({ name, ts, status: "", enc: false, content: [] }));
        return;
      }
      if (method === "GET") {
        const stored = state.docs.get(name);
        if (!stored) {
          reply(res, 404, errorEnvelope(`ERROR #16005: Document '${name}' does not exist`, 16005));
          return;
        }
        reply(res, 200, envelope({ name, db: namespace, ts: stored.ts, upd: false, cat: "CLS", status: "", enc: false, flags: 0, content: stored.lines }));
        return;
      }
      if (method === "DELETE") {
        // A missing document is a 404, as Atelier answers; a stored one is gone (its compiled form, if any, is not modelled).
        if (!state.docs.delete(name)) {
          reply(res, 404, errorEnvelope(`ERROR #16005: Document '${name}' does not exist`, 16005));
          return;
        }
        reply(res, 200, envelope({ name, ts: "", status: "", enc: false, content: [] }));
        return;
      }
    }

    reply(res, 404, errorEnvelope(`the fake IRIS has no route for ${method} ${url.pathname}`, 404));
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method ?? "", url: req.url ?? "", body: bodyText });
      route(req.method ?? "", req.url ?? "", bodyText, res);
    });
  });

  let port = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    port = (server.address() as AddressInfo).port;
    if (!REFUSED_PORTS.has(port)) break;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    port = 0;
  }
  if (port === 0) throw new Error("the stateful fake Atelier could not bind a port other than 52773 and 1972");

  return {
    port,
    namespace,
    requests,
    state,
    get failVersionQuery() {
      return failVersionQuery;
    },
    set failVersionQuery(hook) {
      failVersionQuery = hook;
      versionQueries = 0;
    },
    get compileFailure() {
      return compileFailure;
    },
    set compileFailure(hook) {
      compileFailure = hook;
    },
    get failCompileCheck() {
      return failCompileCheck;
    },
    set failCompileCheck(which) {
      failCompileCheck = which;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
