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
 * - `POST /api/atelier/v<N>/<ns>/action/compile` (a JSON array of names): compiling `ExecuteMCPv2.Setup.cls` makes the
 *   COMPILED marker the one in the stored `Parameter BOOTSTRAPVERSION = "..."` line, as IRIS would. A missing document
 *   is an HTTP 500 error envelope and changes nothing.
 * - `POST /api/atelier/v<N>/<ns>/action/query`: `SELECT 1 AS One` answers a row (a live instance, whatever is deployed);
 *   `Setup_GetBootstrapVersion()` answers the compiled marker, and an
 *   HTTP 500 error envelope while `Setup` has never been compiled (as IRIS answers for a missing SQL function);
 *   `Setup_Configure(?)`, `Setup_ConfigureMapping(?)` and `Setup_IsConfigured()` model the web application and the
 *   package mapping; `Setup_EnsureUnitTestRoot()` answers a fixed path. The `Setup_*` functions need a compiled `Setup`.
 *
 * Every other request is answered with a clean 404 envelope, so nothing a started server asks ever hangs. Every request
 * is recorded (method, url, body).
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

/** What the fake remembers. */
export interface FakeAtelierState {
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
  /**
   * Called after each stored document, with that document's name and the number of documents stored since the fake
   * started. It may change the state, which is how a test models another client that compiled while this one was
   * still uploading.
   */
  onPut?: (name: string, putCount: number, state: FakeAtelierState) => void;
}

/** A running fake. */
export interface StatefulFakeAtelier {
  port: number;
  namespace: string;
  requests: FakeRequest[];
  state: FakeAtelierState;
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
  const state: FakeAtelierState = { compiledMarker: undefined, configured: false, mapped: false, docs: new Map() };
  const requests: FakeRequest[] = [];
  let putCount = 0;
  let tick = 0;

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

  const query = (res: http.ServerResponse, statement: string): void => {
    if (/^\s*SELECT 1 AS One\s*$/i.test(statement)) {
      reply(res, 200, envelope({ content: [{ One: 1 }] }));
      return;
    }
    if (statement.includes("Setup_GetBootstrapVersion")) {
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
      query(res, String((body as { query?: unknown } | undefined)?.query ?? ""));
      return;
    }

    if (method === "POST" && action === "action/compile") {
      const names = Array.isArray(body) ? (body as unknown[]).map(String) : [];
      const missing = names.filter((name) => !state.docs.has(name));
      if (missing.length > 0) {
        reply(res, 500, errorEnvelope(`ERROR #5373: Class '${missing[0]}' does not exist`, 5373));
        return;
      }
      if (names.includes(SETUP_DOCUMENT)) {
        const marker = markerOf((state.docs.get(SETUP_DOCUMENT) as FakeDocument).lines);
        if (marker !== undefined) state.compiledMarker = marker;
      }
      reply(res, 200, { status: { errors: [], summary: "" }, console: ["Compilation finished successfully."], result: { content: [] } });
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
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
