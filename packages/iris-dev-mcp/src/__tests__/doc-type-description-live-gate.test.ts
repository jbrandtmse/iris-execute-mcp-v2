/**
 * Story 39.0 (QA, DW-567, AC-8) - the `type` description of the document-listing tools against a REAL Atelier.
 *
 * `doc-type-description.test.ts` pins the advertised text and checks its examples against a hand-copied table of
 * the 2026-10-16 probe. A table copied from a probe proves nothing about the instance in front of the agent. This
 * gate reads the examples out of `DOC_TYPE_DESCRIPTION` itself, pairs each with the category its sentence names,
 * and sends it to the live route `GET /api/atelier/v<N>/<ns>/docnames/<category>/<type>`:
 *
 *  - the WIRE status of every example is 200. The status is read with a plain `fetch`, because the tools cannot
 *    show it: the shared HTTP client turns an HTTP 400 with an empty error list into an empty success (by design,
 *    for Atelier endpoints that answer 400 for "no results"), so `iris_doc_list` with category CLS and type `cls`
 *    returns `{ items: [] }` and looks exactly like a legitimately empty listing. Asserting "the handler did not
 *    throw" here would pass for the very examples the old description got wrong;
 *  - the handlers send the same request: `iris_doc_list` returns the head of the names the wire read returns (it
 *    pages), and `iris_package_list` rolls up exactly that many documents, for every example;
 *  - the description's CLS sentence holds: category CLS with no type is HTTP 200 and lists classes only;
 *  - control: the examples the OLD description offered answer HTTP 400 on the same route (captured 2026-10-16,
 *    IRIS 2026.2 build 221U, Atelier v8, HSCUSTOM; source `irislib/%Api/Atelier/v1.cls` `GetDocNames`): category
 *    CLS with type `cls`, and category RTN with type `cls`. That is what makes a 200 row evidence.
 *
 * Read-only: every request is a GET on the docnames route. Nothing is written to IRIS, and the filtered reads match
 * only documents every IRIS ships (`%Library.Base`, the `%occ` includes), so any namespace works. The examples are paired
 * with a category by their sentences ("RTN takes ...", "With category '*', ..."); a quoted example in any other
 * sentence fails the gate until it is paired and probed (Rule #56). `iris_doc_export` shares the constant and the
 * route and is not driven here, because it writes local files.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`, defaulting to the dev instance
 * at localhost:52773 / HSCUSTOM; the namespace is named in every call. Skips when IRIS is unreachable; fails
 * instead when `IRIS_REQUIRE_LIVE` is armed (same arming convention as the other live gates in this directory).
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  IrisHttpClient,
  atelierPath,
  buildToolContext,
  loadConfig,
  negotiateVersion,
  ping,
  type ToolContext,
} from "@iris-mcp/shared";
import { DOC_TYPE_DESCRIPTION, docListTool } from "../tools/doc.js";
import { packageListTool } from "../tools/packages.js";

const IRIS_HOST = process.env.IRIS_HOST ?? "localhost";
const IRIS_PORT = process.env.IRIS_PORT ?? "52773";
const IRIS_USERNAME = process.env.IRIS_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_NAMESPACE ?? "HSCUSTOM";

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
  try {
    const config = loadConfig({
      IRIS_HOST,
      IRIS_PORT,
      IRIS_USERNAME,
      IRIS_PASSWORD,
      IRIS_NAMESPACE,
      IRIS_HTTPS: "false",
    });
    const client = new IrisHttpClient(config);
    if (!(await ping(client, 3000))) {
      skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT} (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    } else {
      baseUrl = config.baseUrl;
      version = await negotiateVersion(client);
      ctx = buildToolContext("NS", config, client, version);
    }
  } catch (error) {
    skipReason = `IRIS availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so this gate may not be skipped: ${skipReason}`);
  }
}, 60000);

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

  it("iris_package_list sends the same request: for every example it rolls up exactly the documents the wire read returns", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    let rolledUp = 0;

    for (const { category, type } of examplesOf(DOC_TYPE_DESCRIPTION)) {
      const wire = await wireRead(category, type);

      const result = await packageListTool.handler({ category, type, system: "true", namespace: IRIS_NAMESPACE }, ctx);

      expect(result.isError, `${category}/${type}`).toBeUndefined();
      const { totalDocs } = result.structuredContent as { totalDocs: number };
      expect(totalDocs, `${category}/${type}`).toBe(wire.names.length);
      if (totalDocs > 0) rolledUp += 1;
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
});
