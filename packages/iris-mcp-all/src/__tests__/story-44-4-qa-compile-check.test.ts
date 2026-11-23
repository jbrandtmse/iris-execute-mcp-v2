/**
 * Story 44.4 QA -- gaps left by `story-44-4-compile-oracle.test.ts`, against the BUILT `@iris-mcp/shared` dist.
 *
 * The oracle file drives the stateful fake Atelier through the planning probe's captured shapes. This file adds what that file does
 * not pin, and it answers only shapes the real system can produce (Rule #54):
 *
 * - a compile request that gets no Atelier answer (a transport reset, a non-2xx answer with or without an Atelier envelope) on every
 *   writing branch: today's text, no check request, no privileged request;
 * - the exact text of a check whose own request fails (an HTTP 500 envelope, a reset, a non-JSON page, an answer that is too long),
 *   and a check that answers with no class row at all (fail-closed, every class named);
 * - the whole `BootstrapResult` of a failed compile on every branch (including the next-start `current` check), and the exact request
 *   sequence of the `unconfigured` stop: the clean run's own prefix, and nothing written after the check;
 * - a roster that spans several top-level packages: one dictionary query, one `docnames` read per package in first-seen order, the
 *   query's parameters, the encoded filter, and a failing read of the second package;
 * - `compileAndVerify` refuses a document that is not a `.cls` BEFORE it sends any request (a compile has side effects).
 *
 * Where the fake cannot answer what a test needs, a small proxy in front of it overrides one request (the proxy forwards everything
 * else byte for byte). The proxy answers only the failures a real network or web gateway gives: a connection reset, an HTTP 503 page,
 * an HTTP 400 Atelier envelope, an HTTP 500 Atelier envelope, an HTTP 200 envelope with no rows.
 *
 * Needs no IRIS and no docker; requires a fresh `@iris-mcp/shared` dist and FAILS (never skips) without one.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type * as Shared from "../../../shared/src/index.js";
import type { IrisConnectionConfig } from "../../../shared/src/config.js";
import { staleDistReason } from "./process-gate-helpers.js";
import { LEGS, loadEmbedded, seedInstance, stampedEmbedded, type EmbeddedBootstrap } from "./bootstrap-guard-legs.js";
import {
  COMPILE_CONSOLE_DE,
  isCompileCheckQuery,
  startStatefulFakeAtelier,
  summarizeRequests,
  type FakeRequest,
  type StatefulFakeAtelier,
} from "./stateful-fake-atelier.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const NAMESPACE = "USER";
const V = 8;
const TEST_TIMEOUT_MS = 60_000;
const COMPILE_PATH = `/api/atelier/v${V}/${NAMESPACE}/action/compile`;
const QUERY_PATH = `/api/atelier/v${V}/${NAMESPACE}/action/query`;
const HEALTH = "ExecuteMCPv2.REST.Health.cls";
const PRIVILEGED = /Setup_(Configure|ConfigureMapping|EnsureUnitTestRoot)\(/;

type Branch = "missing" | "stale" | "unconfigured" | "current";
const WRITING_BRANCHES: readonly Branch[] = ["missing", "stale", "unconfigured"];

/** What the proxy does with one request instead of forwarding it. */
type Answer = { status: number; body: string; contentType?: string } | "reset" | undefined;

interface Proxy {
  port: number;
  /** Every request the proxy received, forwarded or answered. */
  seen: FakeRequest[];
  /** Set to answer a request yourself; `undefined` forwards it to the fake. */
  answer: ((request: FakeRequest) => Answer) | undefined;
  close: () => Promise<void>;
}

let shared: typeof Shared;
let embedded: EmbeddedBootstrap;
const openFakes: StatefulFakeAtelier[] = [];
const openProxies: Proxy[] = [];
const openClients: Array<{ destroy: () => void }> = [];

beforeAll(async () => {
  const stale = staleDistReason(REPO_ROOT, "shared");
  if (stale !== undefined) {
    throw new Error(`The compile QA file runs the built shared dist and needs no IRIS, so a stale or missing dist fails it instead of skipping it: ${stale}`);
  }
  shared = (await import(pathToFileURL(path.join(REPO_ROOT, "packages", "shared", "dist", "index.js")).href)) as typeof Shared;
  embedded = await loadEmbedded(REPO_ROOT);
});

afterAll(async () => {
  for (const client of openClients.splice(0)) client.destroy();
  await Promise.all(openProxies.splice(0).map((proxy) => proxy.close()));
  await Promise.all(openFakes.splice(0).map((fake) => fake.close()));
});

/** A proxy in front of `target` (a fake's port) that forwards every request unless `answer` answers it. */
async function startProxy(target: number): Promise<Proxy> {
  const seen: FakeRequest[] = [];
  const proxy: Proxy = { port: 0, seen, answer: undefined, close: async () => undefined };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const request: FakeRequest = { method: req.method ?? "", url: req.url ?? "", body: Buffer.concat(chunks).toString("utf8") };
      seen.push(request);
      const answer = proxy.answer?.(request);
      if (answer === "reset") {
        req.socket.destroy();
        return;
      }
      if (answer !== undefined) {
        res.writeHead(answer.status, { "Content-Type": answer.contentType ?? "application/json" });
        res.end(answer.body);
        return;
      }
      const carriesBody = request.method !== "GET" && request.method !== "HEAD";
      fetch(`http://127.0.0.1:${target}${request.url}`, {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        ...(carriesBody ? { body: request.body } : {}),
      })
        .then(async (forwarded) => {
          const headers: Record<string, string> = {};
          forwarded.headers.forEach((value, key) => {
            if (!["transfer-encoding", "content-length", "connection", "keep-alive", "content-encoding"].includes(key)) headers[key] = value;
          });
          res.writeHead(forwarded.status, headers);
          res.end(request.method === "HEAD" ? undefined : Buffer.from(await forwarded.arrayBuffer()));
        })
        .catch(() => {
          res.writeHead(502);
          res.end();
        });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  proxy.port = (server.address() as AddressInfo).port;
  if (proxy.port === 52773 || proxy.port === 1972) throw new Error("the proxy bound a port that belongs to a shared IRIS");
  proxy.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  openProxies.push(proxy);
  return proxy;
}

function configFor(port: number): IrisConnectionConfig {
  return { host: "127.0.0.1", port, username: "fake", password: "fake", namespace: NAMESPACE, https: false, baseUrl: `http://127.0.0.1:${port}`, timeout: 10_000 };
}

function clientFor(port: number): { http: InstanceType<typeof Shared.IrisHttpClient>; config: IrisConnectionConfig } {
  const config = configFor(port);
  const client = new shared.IrisHttpClient(config);
  openClients.push(client);
  return { http: client, config };
}

/** A fake seeded for `branch`, a proxy in front of it, and a client that talks to the proxy. */
async function arrive(branch: Branch): Promise<{ fake: StatefulFakeAtelier; proxy: Proxy; http: InstanceType<typeof Shared.IrisHttpClient>; config: IrisConnectionConfig; seededMarker: string | undefined }> {
  const fake = await startStatefulFakeAtelier({ namespace: NAMESPACE });
  openFakes.push(fake);
  const target = { host: "127.0.0.1", port: String(fake.port), username: "fake", password: "fake", namespace: NAMESPACE };
  let seededMarker: string | undefined;
  if (branch === "stale") {
    const leg = LEGS.find((candidate) => candidate.id === "older-sequence");
    if (leg === undefined) throw new Error("the older-sequence leg is missing");
    seededMarker = leg.seedMarker(stampedEmbedded(embedded));
    await seedInstance(target, embedded, { marker: seededMarker, perturb: true });
  } else if (branch === "unconfigured") {
    await seedInstance(target, embedded, { marker: embedded.marker, perturb: false });
    fake.state.configured = false;
    fake.state.mapped = false;
  } else if (branch === "current") {
    await seedInstance(target, embedded, { marker: embedded.marker, perturb: false });
  }
  const proxy = await startProxy(fake.port);
  return { fake, proxy, ...clientFor(proxy.port), seededMarker };
}

async function runBootstrap(proxy: Proxy, client: InstanceType<typeof Shared.IrisHttpClient>, config: IrisConnectionConfig): Promise<{ result: Shared.BootstrapResult; window: FakeRequest[] }> {
  const start = proxy.seen.length;
  const result = await shared.bootstrap(client, config, V);
  return { result, window: proxy.seen.slice(start).filter((request) => request.method !== "HEAD") };
}

const isCheckQuery = (request: FakeRequest): boolean => request.method === "POST" && request.url.endsWith("/action/query") && isCompileCheckQuery(String((JSON.parse(request.body) as { query?: unknown }).query ?? ""));
const isDocnamesRead = (request: FakeRequest): boolean => request.method === "GET" && /\/docnames\/CLS\?/.test(request.url);
const checkRequestsOf = (window: readonly FakeRequest[]): FakeRequest[] => window.filter((request) => isCheckQuery(request) || isDocnamesRead(request));
const privilegedIn = (window: readonly FakeRequest[]): string[] => summarizeRequests(window).queries.filter((query) => PRIVILEGED.test(query));

const atelierError = (text: string, code: number): string =>
  JSON.stringify({ status: { errors: [{ error: text, code, domain: "%ObjectErrors", id: "GeneralError", params: [] }], summary: text }, console: [], result: {} });
const EMPTY_ROWS = JSON.stringify({ status: { errors: [], summary: "" }, console: [], result: { content: [] } });

describe("Story 44.4 QA, AC 44.4.3: a compile request that gets no Atelier answer stops every writing branch and sends no check request", () => {
  const failures: Array<{ label: string; answer: Answer }> = [
    { label: "a connection reset", answer: "reset" },
    { label: "an HTTP 503 page from a web gateway", answer: { status: 503, body: "<html><body>Service Unavailable</body></html>", contentType: "text/html" } },
    { label: "an HTTP 400 Atelier envelope that carries status errors", answer: { status: 400, body: atelierError("ERROR #5001: the compile request was refused", 5001) } },
    { label: "an HTTP 500 Atelier envelope that carries status errors", answer: { status: 500, body: atelierError("ERROR #5002: ObjectScript error: <STORE>", 5002) } },
  ];

  for (const branch of WRITING_BRANCHES) {
    for (const { label, answer } of failures) {
      it(
        `${branch}, ${label}: compiled is false with today's text (the client's own message), and no check or privileged request is sent`,
        async () => {
          const { proxy, http: client, config } = await arrive(branch);
          proxy.answer = (request) => (request.method === "POST" && request.url === COMPILE_PATH ? answer : undefined);
          // The oracle of "today's text" is what the client itself throws for the same answered request, read from a separate client.
          const oracle = clientFor(proxy.port).http;
          const expectedMessage = await oracle.post(COMPILE_PATH, ["x.cls"]).then(
            () => {
              throw new Error("the proxy did not fail the compile request");
            },
            (error: unknown) => (error instanceof Error ? error.message : String(error)),
          );

          const { result, window } = await runBootstrap(proxy, client, config);

          expect(result.compiled).toBe(false);
          expect(result.errors).toEqual([`Compile failed: ${expectedMessage}`]);
          expect(result.errors[0], "no check text").not.toContain("could not run");
          expect(result.configured).toBe(false);
          expect(result.mapped).toBe(false);
          expect(result.unitTestRootEnsured).toBe(false);
          expect(checkRequestsOf(window), "no check request after a compile that got no answer").toEqual([]);
          expect(privilegedIn(window)).toEqual([]);
          expect(window.filter((request) => request.url === COMPILE_PATH), "the compile is asked once").toHaveLength(1);
        },
        TEST_TIMEOUT_MS,
      );
    }
  }

  it("compileAndVerify rethrows the very error of such a compile and sends no check request", async () => {
    const { proxy, http: client, config } = await arrive("current");
    proxy.answer = (request) => (request.url === COMPILE_PATH ? { status: 503, body: "<html>down</html>", contentType: "text/html" } : undefined);
    const start = proxy.seen.length;

    const failure = await shared.compileAndVerify(client, config, V, [HEALTH]).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message, "not wrapped in the could-not-run text").not.toContain("could not run");
    expect(checkRequestsOf(proxy.seen.slice(start))).toEqual([]);
  });
});

describe("Story 44.4 QA, AC 44.4.3: the check's own request failing says exactly so, on every branch that runs the check", () => {
  const COULD_NOT_RUN = "Compile failed: the check that every class compiled could not run: ";
  const ALL: readonly Branch[] = ["missing", "stale", "unconfigured", "current"];

  for (const branch of ALL) {
    it(
      `${branch}: an HTTP 500 envelope on the dictionary query gives the exact text, naming the request and IRIS's error`,
      async () => {
        const { proxy, http: client, config } = await arrive(branch);
        proxy.answer = (request) => (isCheckQuery(request) ? { status: 500, body: atelierError("ERROR #5002: ObjectScript error: <STORE>", 5002) } : undefined);

        const { result, window } = await runBootstrap(proxy, client, config);

        expect(result.compiled).toBe(false);
        expect(result.errors).toEqual([
          `${COULD_NOT_RUN}IRIS returned HTTP 500 for POST ${QUERY_PATH}. Check the request parameters and try again. Details: ERROR #5002: ObjectScript error: <STORE>`,
        ]);
        expect(result.configured).toBe(false);
        expect(privilegedIn(window)).toEqual([]);
        expect(window.filter(isDocnamesRead), "the docnames read is not sent once the query failed").toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      `${branch}: an HTTP 500 envelope on the docnames read gives the exact text; the query was already sent`,
      async () => {
        const { proxy, http: client, config } = await arrive(branch);
        proxy.answer = (request) => (isDocnamesRead(request) ? { status: 500, body: atelierError("ERROR #5002: ObjectScript error: <STORE>", 5002) } : undefined);

        const { result, window } = await runBootstrap(proxy, client, config);

        expect(result.compiled).toBe(false);
        expect(result.errors).toEqual([
          `${COULD_NOT_RUN}IRIS returned HTTP 500 for GET /api/atelier/v${V}/${NAMESPACE}/docnames/CLS?filter=ExecuteMCPv2.. Check the request parameters and try again. Details: ERROR #5002: ObjectScript error: <STORE>`,
        ]);
        expect(window.filter(isCheckQuery)).toHaveLength(1);
        expect(privilegedIn(window)).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );
  }

  it("a connection reset on the query, and a non-JSON page from the docnames read, are both 'could not run', never a verdict", async () => {
    for (const [which, answer] of [
      ["query", "reset"],
      ["docnames", { status: 200, body: "<html><body>login</body></html>", contentType: "text/html" }],
    ] as const) {
      const { proxy, http: client, config } = await arrive("unconfigured");
      proxy.answer = (request) => ((which === "query" ? isCheckQuery(request) : isDocnamesRead(request)) ? answer : undefined);

      const { result } = await runBootstrap(proxy, client, config);

      expect(result.compiled, which).toBe(false);
      expect(result.errors, which).toHaveLength(1);
      expect(result.errors[0]!.startsWith(COULD_NOT_RUN), which).toBe(true);
      expect(result.errors[0], `${which}: it names no class as not compiled`).not.toContain("did not compile");
      expect(result.configured, which).toBe(false);
    }
  });

  it("an answer longer than 200 characters is cut to one line of 200 characters and three dots, as describeFailure cuts it", async () => {
    const { proxy, http: client, config } = await arrive("current");
    const long = `ERROR #5002: ${"stack ".repeat(120)}\r\nend`;
    proxy.answer = (request) => (isCheckQuery(request) ? { status: 500, body: atelierError(long, 5002) } : undefined);

    const { result } = await runBootstrap(proxy, client, config);

    expect(result.errors).toHaveLength(1);
    const text = result.errors[0] as string;
    expect(text.startsWith(COULD_NOT_RUN)).toBe(true);
    const described = text.slice(COULD_NOT_RUN.length);
    expect(described).toHaveLength(203);
    expect(described.endsWith("...")).toBe(true);
    expect(described.startsWith(`IRIS returned HTTP 500 for POST ${QUERY_PATH}.`)).toBe(true);
    expect(text).not.toMatch(/[\r\n]/);
  });

  it("a dictionary that answers with no row at all (HTTP 200, empty content) is fail-closed: every class is named, none is read as compiled", async () => {
    const { proxy, http: client, config } = await arrive("current");
    proxy.answer = (request) => (isCheckQuery(request) ? { status: 200, body: EMPTY_ROWS } : undefined);

    const { result, window } = await runBootstrap(proxy, client, config);

    expect(result.compiled).toBe(false);
    const text = result.errors[0] as string;
    expect(result.errors).toHaveLength(1);
    expect(text.startsWith(`Compile failed: ${embedded.classes.size} of ${embedded.classes.size} classes did not compile: `)).toBe(true);
    for (const name of embedded.classes.keys()) expect(text, name).toContain(name.replace(/\.cls$/, ""));
    expect(text, "no IRIS clause: IRIS reported nothing").not.toContain("IRIS reported");
    expect(privilegedIn(window)).toEqual([]);
  });
});

describe("Story 44.4 QA, AC 44.4.3 / 44.4.7: the whole result of a failed compile, and the exact requests of the unconfigured stop", () => {
  const failHealth = (fake: StatefulFakeAtelier): void => {
    fake.compileFailure = () => ({ failed: [{ name: HEALTH, kind: "routine" }], shape: "storage-written", console: COMPILE_CONSOLE_DE });
  };
  const named = `Compile failed: 1 of ${35} classes did not compile: ExecuteMCPv2.REST.Health`;

  it("the roster the tests assume is the 35-class roster", () => {
    expect(embedded.classes.size).toBe(35);
  });

  const expectedResult: Record<Branch, Record<string, unknown>> = {
    missing: { probeFound: false, probeStatus: "missing", deployed: true, compiled: false, configured: false, mapped: false, unitTestRootEnsured: false, errors: [named] },
    stale: { probeFound: true, probeStatus: "stale", deployed: true, compiled: false, configured: false, mapped: false, unitTestRootEnsured: false, errors: [named] },
    unconfigured: { probeFound: true, probeStatus: "unconfigured", deployed: true, compiled: false, configured: false, mapped: false, unitTestRootEnsured: false, errors: [named] },
    current: { probeFound: true, probeStatus: "current", deployed: true, compiled: false, configured: false, mapped: false, unitTestRootEnsured: false, errors: [named] },
  };

  for (const branch of ["missing", "stale", "unconfigured", "current"] as const) {
    it(
      `${branch}: the failed BootstrapResult is exactly the pre-story shape with compiled, configured, mapped and unitTestRootEnsured false and one error`,
      async () => {
        const { fake, proxy, http: client, config, seededMarker } = await arrive(branch);
        if (branch === "current") {
          // The failure is left by an earlier compile; the next start only reads.
          failHealth(fake);
          fake.state.classes.set(HEALTH, { compiledFrom: "2000-01-01 00:00:00.000", error: true, upd: true });
        } else {
          failHealth(fake);
        }

        const { result } = await runBootstrap(proxy, client, config);

        expect(result).toEqual({ ...expectedResult[branch], ...(seededMarker === undefined ? {} : { deployedVersion: seededMarker }) });
        expect(Object.keys(result).sort(), "no field is added by the failure path").toEqual(Object.keys({ ...expectedResult[branch], ...(seededMarker === undefined ? {} : { deployedVersion: 1 }) }).sort());
      },
      TEST_TIMEOUT_MS,
    );
  }

  it("unconfigured, a failed compile: the requests are exactly the clean run's own prefix up to the check's docnames read, and nothing follows it", async () => {
    const clean = await arrive("unconfigured");
    const cleanRun = await runBootstrap(clean.proxy, clean.http, clean.config);
    expect(cleanRun.result.compiled).toBe(true);
    const cleanLines = cleanRun.window.map((request) => `${request.method} ${request.url} ${request.body}`);
    const cutAt = cleanRun.window.findIndex(isDocnamesRead);
    expect(cutAt, "the clean run reads docnames after its compile").toBeGreaterThan(0);

    const failing = await arrive("unconfigured");
    failHealth(failing.fake);
    const failedRun = await runBootstrap(failing.proxy, failing.http, failing.config);

    expect(failedRun.result.compiled).toBe(false);
    const failedLines = failedRun.window.map((request) => `${request.method} ${request.url} ${request.body}`);
    expect(failedLines, "everything up to and including the docnames read is the clean run's; nothing is sent after it").toEqual(cleanLines.slice(0, cutAt + 1));
    expect(failedRun.window.at(-1) && isDocnamesRead(failedRun.window.at(-1) as FakeRequest), "the last request is the check's docnames read").toBe(true);
    expect(failing.fake.state.configured, "the web application stays unregistered").toBe(false);
    expect(failing.fake.state.mapped).toBe(false);
    expect(failedRun.window.filter((request) => request.method === "PUT" || request.method === "DELETE"), "no document was written or removed").toEqual([]);
  });

  it("unconfigured, a failed compile, then a fixed one: the next start recompiles, registers the web application and finishes", async () => {
    const { fake, proxy, http: client, config } = await arrive("unconfigured");
    failHealth(fake);
    const first = await runBootstrap(proxy, client, config);
    expect(first.result.compiled).toBe(false);
    fake.compileFailure = undefined;

    const next = await runBootstrap(proxy, client, config);

    expect(next.result.probeStatus, "still unconfigured, so it is retried").toBe("unconfigured");
    expect(next.result.compiled).toBe(true);
    expect(next.result.configured).toBe(true);
    expect(next.result.mapped).toBe(true);
    expect(next.result.unitTestRootEnsured).toBe(true);
    expect(next.result.errors).toEqual([]);
    expect(fake.state.configured).toBe(true);
  });
});

describe("Story 44.4 QA, AC 44.4.2: a roster that spans several top-level packages", () => {
  const stamp = "2026-11-23 10:00:00.000";
  /** A fake holding the class documents `names`, each compiled clean, a proxy in front of it, and a client. */
  async function holding(names: readonly string[]): Promise<{ fake: StatefulFakeAtelier; proxy: Proxy; http: InstanceType<typeof Shared.IrisHttpClient>; config: IrisConnectionConfig }> {
    const fake = await startStatefulFakeAtelier({ namespace: NAMESPACE });
    openFakes.push(fake);
    for (const name of names) {
      fake.state.docs.set(name, { lines: [`Class ${name.replace(/\.cls$/, "")} {}`], ts: stamp });
      fake.state.classes.set(name, { compiledFrom: stamp, error: false, upd: true });
    }
    const proxy = await startProxy(fake.port);
    return { fake, proxy, ...clientFor(proxy.port) };
  }

  const NAMES = [
    "Alpha444.One.cls",
    "Beta444.Sub.Deep.cls",
    "Alpha444.Two.cls",
    "Gamma444.Three.cls",
    "Alpha444x.Four.cls",
    "Beta444.Five.cls",
  ];

  it("sends one query whose parameters are the class names without .cls in list order, then one docnames read per package in first-seen order", async () => {
    const { proxy, http: client } = await holding(NAMES);
    const start = proxy.seen.length;

    expect(await shared.verifyCompiled(client, NAMESPACE, V, NAMES)).toEqual([]);

    // The client's first request of a session is a HEAD preflight (CSRF); it is not part of the check.
    const window = proxy.seen.slice(start).filter((request) => request.method !== "HEAD");
    expect(window.map((request) => `${request.method} ${request.url.split("?")[0]}`)).toEqual([
      `POST ${QUERY_PATH}`,
      `GET /api/atelier/v${V}/${NAMESPACE}/docnames/CLS`,
      `GET /api/atelier/v${V}/${NAMESPACE}/docnames/CLS`,
      `GET /api/atelier/v${V}/${NAMESPACE}/docnames/CLS`,
      `GET /api/atelier/v${V}/${NAMESPACE}/docnames/CLS`,
    ]);
    const body = JSON.parse(window[0]!.body) as { query: string; parameters: string[] };
    expect(body.parameters).toEqual(NAMES.map((name) => name.replace(/\.cls$/, "")));
    expect((body.query.match(/\?/g) ?? []).length, "one placeholder per class").toBe(NAMES.length);
    expect(window.slice(1).map((request) => request.url.split("?")[1])).toEqual(["filter=Alpha444.", "filter=Beta444.", "filter=Gamma444.", "filter=Alpha444x."]);
  });

  it("each class is judged by its own package's read: a class not up to date in one package is named, the others are not", async () => {
    const { fake, http: client } = await holding(NAMES);
    fake.state.classes.set("Beta444.Sub.Deep.cls", { compiledFrom: stamp, error: false, upd: false });
    fake.state.classes.set("Gamma444.Three.cls", { compiledFrom: stamp, error: true, upd: true });
    fake.state.classes.delete("Alpha444x.Four.cls");

    expect(await shared.verifyCompiled(client, NAMESPACE, V, NAMES)).toEqual(["Beta444.Sub.Deep.cls", "Gamma444.Three.cls", "Alpha444x.Four.cls"]);
  });

  it("a class that exists only under a package whose name merely starts with another's is never confirmed by the other package's read", async () => {
    const { fake, http: client } = await holding(["Alpha444.One.cls", "Alpha444x.Four.cls"]);
    // Alpha444x.Four is stored and compiled, but its own root read would be the only thing that lists it: with it, it counts.
    expect(await shared.verifyCompiled(client, NAMESPACE, V, ["Alpha444.One.cls", "Alpha444x.Four.cls"])).toEqual([]);
    // Without a compiled row, the read of Alpha444. (which does not list it) cannot confirm it.
    fake.state.classes.delete("Alpha444x.Four.cls");
    expect(await shared.verifyCompiled(client, NAMESPACE, V, ["Alpha444.One.cls", "Alpha444x.Four.cls"])).toEqual(["Alpha444x.Four.cls"]);
  });

  it("a read of the second package that fails is 'could not run', after the query and the first package's read were sent", async () => {
    const { proxy, http: client, config } = await holding(NAMES);
    proxy.answer = (request) => (isDocnamesRead(request) && request.url.includes("filter=Beta444.") ? { status: 500, body: atelierError("ERROR #5002: ObjectScript error: <STORE>", 5002) } : undefined);
    const start = proxy.seen.length;

    const failure = await shared.compileAndVerify(client, config, V, NAMES).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      `the check that every class compiled could not run: IRIS returned HTTP 500 for GET /api/atelier/v${V}/${NAMESPACE}/docnames/CLS?filter=Beta444.. Check the request parameters and try again. Details: ERROR #5002: ObjectScript error: <STORE>`,
    );
    const window = proxy.seen.slice(start);
    expect(window.filter(isCheckQuery)).toHaveLength(1);
    expect(window.filter(isDocnamesRead).map((request) => request.url.split("?")[1])).toEqual(["filter=Alpha444.", "filter=Beta444."]);
  });

  it("a package whose name starts with % is sent URL-encoded", async () => {
    const { proxy, http: client } = await holding(["%Pct444.One.cls"]);
    const start = proxy.seen.length;

    expect(await shared.verifyCompiled(client, NAMESPACE, V, ["%Pct444.One.cls"])).toEqual([]);

    expect(proxy.seen.slice(start).filter(isDocnamesRead).map((request) => request.url.split("?")[1])).toEqual(["filter=%25Pct444."]);
  });

  it("an empty list sends no request at all", async () => {
    const { proxy, http: client } = await holding([]);
    const start = proxy.seen.length;

    expect(await shared.verifyCompiled(client, NAMESPACE, V, [])).toEqual([]);

    expect(proxy.seen.slice(start)).toEqual([]);
  });
});

describe("Story 44.4 QA, AC 44.4.2: compileAndVerify refuses a document that is not a class before it sends anything", () => {
  for (const names of [["Pkg444.Routine.mac"], ["Pkg444.Good.cls", "Pkg444.Routine.int"], ["Pkg444.Good.cls", ".cls"], ["Pkg444.Good.cls", ""], ["Pkg444.Good.CLS"]]) {
    it(`${JSON.stringify(names)}: rejects naming the .cls rule, and the compile (which has side effects) is never requested`, async () => {
      const fake = await startStatefulFakeAtelier({ namespace: NAMESPACE });
      openFakes.push(fake);
      fake.state.docs.set("Pkg444.Good.cls", { lines: ["Class Pkg444.Good {}"], ts: "2026-11-23 10:00:00.000" });
      const { http: client, config } = clientFor(fake.port);

      await expect(shared.compileAndVerify(client, config, V, names)).rejects.toThrow(/class documents ending in \.cls/);

      expect(fake.requests, "nothing was sent").toEqual([]);
      expect(fake.state.classes.size, "nothing was compiled").toBe(0);
    });
  }
});
