/**
 * Story 39.0 (QA, DW-567, AC-8) - the `type` description of the document-listing tools against a REAL Atelier.
 *
 * `doc-type-description.test.ts` pins the advertised text and checks its examples against a hand-copied table of
 * the 2026-10-16 probe. A table copied from a probe proves nothing about the instance in front of the agent. This
 * gate reads the examples out of `DOC_TYPE_DESCRIPTION` itself, pairs each with the category its sentence names,
 * and sends it to the live route `GET /api/atelier/v<N>/<ns>/docnames/<category>/<type>`:
 *
 *  - the WIRE status of every example is 200. The status is read with a plain `fetch`, which also keeps the
 *    wire read independent of the code under test. The shared HTTP client throws `IrisApiError` for every
 *    non-2xx response, an HTTP 400 with an empty error list included (Story 39.7, DW-569), so a handler call with
 *    an example the route rejects is an error and cannot look like a legitimately empty listing;
 *  - the handlers send the same request: `iris_doc_list` returns the head of the names the wire read returns (it
 *    pages), and `iris_package_list` sends exactly the plain docnames request and rolls up the documents of the
 *    very envelope it received, for every example. The package row compares what cannot move under concurrent
 *    writes to the shared namespace (its own request and its own envelope), never the counts of two separate reads;
 *  - the description's CLS sentence holds: category CLS with no type is HTTP 200 and lists classes only;
 *  - control: the examples the OLD description offered answer HTTP 400 on the same route (captured 2026-10-16,
 *    IRIS 2026.2 build 221U, Atelier v8, HSCUSTOM; source `irislib/%Api/Atelier/v1.cls` `GetDocNames`): category
 *    CLS with type `cls`, and category RTN with type `cls`. That is what makes a 200 row evidence. The handlers
 *    reject those two requests with `IrisApiError` 400 and an empty error list.
 *
 * Read-only: every request is a GET on the docnames route. Nothing is written to IRIS, and the filtered reads match
 * only documents every IRIS ships (`%Library.Base`, the `%occ` includes), so any namespace works. The examples are paired
 * with a category by their sentences ("RTN takes ...", "With category '*', ..."); a quoted example in any other
 * sentence fails the gate until it is paired and probed (Rule #56). `iris_doc_export` shares the constant and the
 * route and is not driven here, because it writes local files.
 *
 * Arming: the live examples run only with `IRIS_REQUIRE_LIVE=1` (or `true`), against the target named by
 * `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (all required, none defaulted;
 * `@iris-mcp/shared/test-helpers/live-target`); the namespace is named in every call. Unarmed, they skip before
 * any request; armed, an unreachable IRIS fails the gate instead of skipping it.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import {
  IrisApiError,
  IrisHttpClient,
  atelierPath,
  buildToolContext,
  loadConfig,
  negotiateVersion,
  ping,
  type ToolContext,
} from "@iris-mcp/shared";
import { liveConnectionEnv, liveGateTarget } from "@iris-mcp/shared/test-helpers/live-target";
import { DOC_TYPE_DESCRIPTION, docListTool } from "../tools/doc.js";
import { packageListTool } from "../tools/packages.js";

const LIVE = liveGateTarget();
const IRIS_HOST = LIVE.target.host;
const IRIS_PORT = LIVE.target.port;
const IRIS_USERNAME = LIVE.target.username;
const IRIS_PASSWORD = LIVE.target.password;
const IRIS_NAMESPACE = LIVE.target.namespace;

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

let skipReason: string | undefined;
let ctx: ToolContext;
let baseUrl = "";
let version = 0;

interface Example {
  category: string;
  type: string;
}

/** The examples `description` offers, each paired with the category its sentence names. */
function examplesOf(description: string): Example[] {
  const found: Example[] = [];
  for (const sentence of description.split(/(?<=\.) /)) {
    const quoted = [...sentence.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
    if (quoted.length === 0) continue;
    if (sentence.startsWith("RTN takes ")) {
      for (const type of quoted) found.push({ category: "RTN", type });
    } else if (sentence.startsWith("With category '*', ")) {
      for (const type of quoted.filter((value) => value !== "*")) found.push({ category: "*", type });
    } else {
      throw new Error(`The description offers an example this gate cannot pair with a category (probe it, then teach the gate): ${sentence}`);
    }
  }
  return found;
}

/** The class every IRIS ships in every namespace, so the gate reads only documents it never has to create. */
const SHIPPED_CLASS = "%Library.Base";

/** A name filter that keeps the response small and matches documents every IRIS ships: system includes for routines, {@link SHIPPED_CLASS} otherwise. */
function filterFor(category: string): string {
  return category === "RTN" ? "%occ" : SHIPPED_CLASS;
}

/** A read-only GET of the docnames route: the HTTP status and the document names the envelope carries. */
async function wireRead(category: string, type: string, filter?: string): Promise<{ status: number; names: string[] }> {
  const query = filter === undefined ? "" : `?filter=${encodeURIComponent(filter)}`;
  const url = `${baseUrl}${atelierPath(version, IRIS_NAMESPACE, `docnames/${category}/${type}`)}${query}`;
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${IRIS_USERNAME}:${IRIS_PASSWORD}`).toString("base64")}` },
    signal: AbortSignal.timeout(30000),
  });
  const body = (await response.json()) as { result?: { content?: Array<{ name: string }> } };
  return { status: response.status, names: (body.result?.content ?? []).map((entry) => entry.name) };
}

beforeAll(async () => {
  skipReason = LIVE.skipReason;
  if (skipReason === undefined) {
    try {
      const config = loadConfig(liveConnectionEnv(LIVE.target));
      const client = new IrisHttpClient(config);
      if (!(await ping(client, 3000))) {
        skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT} (check IRIS_HOST/IRIS_PORT).`;
      } else {
        baseUrl = config.baseUrl;
        version = await negotiateVersion(client);
        ctx = buildToolContext("NS", config, client, version);
      }
    } catch (error) {
      skipReason = `IRIS availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so this gate may not be skipped: ${skipReason}`);
  }
}, 60000);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("every example of the type description is accepted by the live Atelier docnames route (Story 39.0, DW-567, AC-8)", () => {
  it("the description offers examples for RTN and for category '*', each paired with its category", () => {
    const examples = examplesOf(DOC_TYPE_DESCRIPTION);

    expect(examples.filter((example) => example.category === "RTN").length).toBeGreaterThanOrEqual(6);
    expect(examples.filter((example) => example.category === "*").map((example) => example.type)).toEqual(["cls"]);
  });

  it("every example answers HTTP 200 on the wire, and every name returned has an extension the type asked for", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    let nonEmpty = 0;

    for (const { category, type } of examplesOf(DOC_TYPE_DESCRIPTION)) {
      const read = await wireRead(category, type, filterFor(category));
      expect(read.status, `${category}/${type} is accepted by Atelier`).toBe(200);
      const extensions = type.split(",").map((value) => `.${value.toLowerCase()}`);
      for (const name of read.names) {
        expect(extensions.some((extension) => name.toLowerCase().endsWith(extension)), `${category}/${type} returned ${name}`).toBe(true);
      }
      if (read.names.length > 0) nonEmpty += 1;
    }

    expect(nonEmpty, "the typed reads return documents, so the extension check above is not vacuous").toBeGreaterThanOrEqual(3);
  }, 60000);

  it("iris_doc_list sends the same request: for every example its first page is the head of the wire read's names", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    for (const { category, type } of examplesOf(DOC_TYPE_DESCRIPTION)) {
      const filter = filterFor(category);
      const wire = await wireRead(category, type, filter);

      const result = await docListTool.handler({ category, type, filter, namespace: IRIS_NAMESPACE }, ctx);

      expect(result.isError, `${category}/${type}`).toBeUndefined();
      const items = (result.structuredContent as { items: Array<string | { name: string }> }).items;
      const names = items.map((item) => (typeof item === "string" ? item : item.name));
      expect(names, `${category}/${type}: the first page is the head of the wire list`).toEqual(wire.names.slice(0, names.length));
      expect(names.length > 0, `${category}/${type}: empty exactly when the wire list is empty`).toBe(wire.names.length > 0);
    }
  }, 60000);

  it("iris_package_list sends the same request: for every example it sends the plain docnames request and rolls up the documents of the envelope it received", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    let rolledUp = 0;

    for (const { category, type } of examplesOf(DOC_TYPE_DESCRIPTION)) {
      // The shared namespace can gain or lose documents between two reads, so two separate reads are never
      // compared: the request is compared with the wire read's request, and the count with the handler's own envelope.
      const get = vi.spyOn(ctx.http, "get");

      const result = await packageListTool.handler({ category, type, system: "true", namespace: IRIS_NAMESPACE }, ctx);

      expect(result.isError, `${category}/${type}`).toBeUndefined();
      expect(get, `${category}/${type}: one request`).toHaveBeenCalledTimes(1);
      expect(get.mock.calls[0]?.[0], `${category}/${type}: the request the wire read sends, with no query string`).toBe(
        atelierPath(version, IRIS_NAMESPACE, `docnames/${category}/${type}`),
      );
      const received = (await get.mock.results[0]?.value) as { result?: { content?: unknown[] } };
      const { totalDocs } = result.structuredContent as { totalDocs: number };
      expect(totalDocs, `${category}/${type}: the documents of the envelope the handler received`).toBe(
        received.result?.content?.length,
      );
      if (totalDocs > 0) rolledUp += 1;
      get.mockRestore();
    }

    expect(rolledUp, "typed reads roll up documents").toBeGreaterThanOrEqual(3);
  }, 60000);

  it("category CLS with no type is HTTP 200 and lists classes only, as the description's CLS sentence says", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    expect(DOC_TYPE_DESCRIPTION).toContain("CLS takes no type filter (leave it unset)");
    const filter = filterFor("CLS");
    const wire = await wireRead("CLS", "*", filter);
    const result = await docListTool.handler({ category: "CLS", filter, namespace: IRIS_NAMESPACE }, ctx);

    expect(wire.status).toBe(200);
    expect(wire.names, "the class every IRIS ships is listed").toContain(`${SHIPPED_CLASS}.cls`);
    for (const name of wire.names) expect(name.endsWith(".cls"), name).toBe(true);
    const items = (result.structuredContent as { items: Array<string | { name: string }> }).items;
    const names = items.map((item) => (typeof item === "string" ? item : item.name));
    expect(names).toEqual(wire.names.slice(0, names.length));
    expect(names.length > 0).toBe(true);
  }, 60000);

  it("control: the examples the OLD description offered answer HTTP 400 on the same route, so a 200 row is evidence", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const clsWithCls = await wireRead("CLS", "cls", filterFor("CLS"));
    const rtnWithCls = await wireRead("RTN", "cls", filterFor("CLS"));
    const starWithCls = await wireRead("*", "cls", filterFor("CLS"));

    expect(clsWithCls.status).toBe(400);
    expect(rtnWithCls.status).toBe(400);
    expect(starWithCls.status, "the one pairing the description keeps").toBe(200);
  }, 60000);

  // Story 39.7 (DW-569): the two requests the wire answers 400 with no error list are errors on the handler too.
  it("the iris_doc_list handler rejects category CLS with type 'cls' and category RTN with type 'cls' with IrisApiError 400 and an empty error list", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    for (const args of [
      { category: "CLS", type: "cls", filter: SHIPPED_CLASS },
      { category: "RTN", type: "cls", filter: "%occ" },
    ]) {
      let caught: unknown;
      try {
        await docListTool.handler({ ...args, namespace: IRIS_NAMESPACE }, ctx);
      } catch (error) {
        caught = error;
      }

      expect(caught, `${args.category}/cls is rejected`).toBeInstanceOf(IrisApiError);
      expect((caught as IrisApiError).statusCode).toBe(400);
      expect((caught as IrisApiError).errors).toEqual([]);
      expect((caught as IrisApiError).originalUrl).toContain(`docnames/${args.category}/cls`);
    }
  }, 60000);
});
