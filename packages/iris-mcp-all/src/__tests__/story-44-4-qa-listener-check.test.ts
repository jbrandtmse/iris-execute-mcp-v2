/**
 * Story 44.4 QA (AC 44.4.8) -- the fake IRIS listener (`scripts/lib/fake-iris-listener.mjs`) answers the `current`-start compile check.
 *
 * The existing tests reach the listener only through the roster: a started server's `current` start asks about the 35 bootstrap classes,
 * and the fallback test goes red when the listener answers no rows. That would stay green if the listener knew the roster by name. This
 * file drives the REAL `verifyCompiled` of the built shared dist against the listener with class lists the listener was never told about
 * (the listener learns names only from the query it is asked), and adds the raw `docnames` cases around it:
 *
 * - any class list, in any package layout, is confirmed clean, with one query and one `docnames` read per package, and the listener
 *   makes the check's own request sequence its only memory;
 * - a `docnames` read that no check query preceded, a filter that no checked class contains, another category, an empty filter and the
 *   `throw` filter answer exactly as before the check existed (the Demo entries, `upd: false`, or the non-JSON page);
 * - a statement that is not the check answers no rows.
 *
 * Needs no IRIS and no docker; requires a fresh `@iris-mcp/shared` dist and FAILS (never skips) without one.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type * as Shared from "../../../shared/src/index.js";
import type { IrisConnectionConfig } from "../../../shared/src/config.js";
import { staleDistReason } from "./process-gate-helpers.js";
import { startFakeIris } from "../../../../scripts/lib/fake-iris-listener.mjs";
import { readBootstrapVersion } from "../../../../scripts/lib/sdk-handler-golden-core.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const NAMESPACE = "HSCUSTOM";
const V = 8;

type Listener = Awaited<ReturnType<typeof startFakeIris>>;

let shared: typeof Shared;
const openListeners: Listener[] = [];
const openClients: Array<{ destroy: () => void }> = [];

beforeAll(async () => {
  const stale = staleDistReason(REPO_ROOT, "shared");
  if (stale !== undefined) {
    throw new Error(`The listener check test runs the built shared dist and needs no IRIS, so a stale or missing dist fails it instead of skipping it: ${stale}`);
  }
  shared = (await import(pathToFileURL(path.join(REPO_ROOT, "packages", "shared", "dist", "index.js")).href)) as typeof Shared;
});

afterAll(async () => {
  for (const client of openClients.splice(0)) client.destroy();
  await Promise.all(openListeners.splice(0).map((listener) => listener.close()));
});

async function listening(): Promise<{ listener: Listener; http: InstanceType<typeof Shared.IrisHttpClient>; config: IrisConnectionConfig }> {
  const listener = await startFakeIris({ bootstrapVersion: readBootstrapVersion(REPO_ROOT) });
  openListeners.push(listener);
  const config: IrisConnectionConfig = {
    host: "127.0.0.1",
    port: listener.port,
    username: "fake",
    password: "fake",
    namespace: NAMESPACE,
    https: false,
    baseUrl: `http://127.0.0.1:${listener.port}`,
    timeout: 10_000,
  };
  const client = new shared.IrisHttpClient(config);
  openClients.push(client);
  return { listener, http: client, config };
}

const base = (listener: Listener): string => `http://127.0.0.1:${listener.port}/api/atelier/v${V}/${NAMESPACE}`;
const docnames = (listener: Listener, category: string, filter: string | undefined): Promise<Response> =>
  fetch(`${base(listener)}/docnames/${category}${filter === undefined ? "" : `?filter=${encodeURIComponent(filter)}`}`);
const entriesOf = async (response: Response): Promise<Array<Record<string, unknown>>> => ((await response.json()) as { result: { content: Array<Record<string, unknown>> } }).result.content;
const requestLines = (listener: Listener): string[] =>
  listener.requests.filter((request) => request.method !== "HEAD").map((request) => `${request.method} ${request.url.split("?")[0]}${request.url.includes("?") ? `?${request.url.split("?")[1]}` : ""}`);

/** The check's own statement, as the built `verifyCompiled` sends it (read from what it sent, never retyped). */
async function checkStatementOf(listener: Listener, http: InstanceType<typeof Shared.IrisHttpClient>): Promise<string> {
  const start = listener.requests.length;
  await shared.verifyCompiled(http, NAMESPACE, V, ["Probe444.Statement.cls"]);
  const query = listener.requests.slice(start).find((request) => request.method === "POST" && request.url.endsWith("/action/query"));
  if (query === undefined) throw new Error("verifyCompiled sent no query");
  return (JSON.parse(query.body) as { query: string }).query;
}

describe("Story 44.4 QA, AC 44.4.8: the listener confirms a class list it was never told about", () => {
  it("any list, across several packages and nesting depths, is confirmed clean by the real verifyCompiled, with the check's own request sequence", async () => {
    const { listener, http } = await listening();
    const names = ["Zeta444.Alone.cls", "Alpha444.Sub.Deep.Leaf.cls", "Zeta444.Second.cls", "Mid444.One.cls", "Alpha444.Top.cls"];
    const start = listener.requests.length;

    const notCompiled = await shared.verifyCompiled(http, NAMESPACE, V, names);

    expect(notCompiled, "every class named in the query is a compiled row, not flagged, with upd true").toEqual([]);
    expect(requestLines(listener).slice(requestLines(listener).length - 4)).toEqual([
      `POST /api/atelier/v${V}/${NAMESPACE}/action/query`,
      `GET /api/atelier/v${V}/${NAMESPACE}/docnames/CLS?filter=Zeta444.`,
      `GET /api/atelier/v${V}/${NAMESPACE}/docnames/CLS?filter=Alpha444.`,
      `GET /api/atelier/v${V}/${NAMESPACE}/docnames/CLS?filter=Mid444.`,
    ]);
    expect(listener.requests.slice(start).filter((request) => request.method !== "HEAD")).toHaveLength(4);
  });

  it("the roster of another story's classes, a single class, and a class of the Demo package are all confirmed (the listener knows no list)", async () => {
    const { http } = await listening();

    expect(await shared.verifyCompiled(http, NAMESPACE, V, ["Some444.Single.cls"])).toEqual([]);
    expect(await shared.verifyCompiled(http, NAMESPACE, V, ["Demo.Sample.cls"]), "the listener's own Demo entry is not what answers: the checked name is").toEqual([]);
    expect(await shared.verifyCompiled(http, NAMESPACE, V, ["Demo.NeverListed444.cls"])).toEqual([]);
  });

  it("the rows answer exactly the names asked, in the order asked, in the captured shape, for a list of any length", async () => {
    const { listener, http } = await listening();
    const statement = await checkStatementOf(listener, http);
    const ids = Array.from({ length: 120 }, (_, index) => `Bulk444.Class${index}`);

    const response = await fetch(`${base(listener)}/action/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: statement, parameters: ids }) });

    const rows = await entriesOf(response);
    expect(rows).toEqual(ids.map((id) => ({ ID: id, Compiled: 1, CompileError: 0 })));
  });

  it("a query with no parameters answers no rows, and a statement that is not the check answers no rows", async () => {
    const { listener, http } = await listening();
    const statement = await checkStatementOf(listener, http);
    const post = (body: unknown): Promise<Response> => fetch(`${base(listener)}/action/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    expect(await entriesOf(await post({ query: statement }))).toEqual([]);
    expect(await entriesOf(await post({ query: statement, parameters: "Not444.AList" }))).toEqual([]);
    expect(await entriesOf(await post({ query: "SELECT d.ID FROM %Dictionary.ClassDefinition d", parameters: ["Other444.Class"] }))).toEqual([]);
    // The statement that was not the check taught the listener nothing: no class is remembered, so docnames answers its default.
    const listed = await entriesOf(await docnames(listener, "CLS", "Other444."));
    expect(listed.map((entry) => entry["name"])).toEqual(["Demo.Other.cls", "Demo.Sample.cls"]);
  });
});

describe("Story 44.4 QA, AC 44.4.8: every docnames read the check does not answer is answered as before", () => {
  const DEFAULT_NAMES = ["Demo.Other.cls", "Demo.Sample.cls"];

  it("a docnames read with no earlier check query answers the Demo entries with upd false, whatever the filter", async () => {
    const { listener } = await listening();

    for (const filter of ["ExecuteMCPv2.", "Demo", "anything", undefined]) {
      const entries = await entriesOf(await docnames(listener, "CLS", filter));
      expect(entries.map((entry) => entry["name"]), String(filter)).toEqual(DEFAULT_NAMES);
      expect(entries.map((entry) => entry["upd"]), String(filter)).toEqual([false, false]);
    }
  });

  it("after a check, a filter that no checked class contains, an empty filter, another category and the throw filter answer as before", async () => {
    const { listener, http } = await listening();
    await shared.verifyCompiled(http, NAMESPACE, V, ["Checked444.One.cls"]);

    for (const [category, filter] of [
      ["CLS", "Unchecked444."],
      ["CLS", ""],
      ["CLS", undefined],
      ["MAC", "Checked444."],
      ["RTN", "Checked444."],
    ] as const) {
      const entries = await entriesOf(await docnames(listener, category, filter));
      expect(entries.map((entry) => entry["name"]), `${category} ${String(filter)}`).toEqual(DEFAULT_NAMES);
      expect(entries.every((entry) => entry["upd"] === false), `${category} ${String(filter)}: upd stays false`).toBe(true);
    }
    const page = await docnames(listener, "CLS", "throw");
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("not an Atelier envelope");
  });

  it("after a check, a CLS read whose filter a checked class contains lists exactly those classes, with upd true; the match ignores case", async () => {
    const { listener, http } = await listening();
    await shared.verifyCompiled(http, NAMESPACE, V, ["Checked444.One.cls", "Checked444.Sub.Two.cls", "Elsewhere444.Three.cls"]);

    const exact = await entriesOf(await docnames(listener, "CLS", "Checked444."));
    expect(exact).toEqual([
      { name: "Checked444.One.cls", cat: "CLS", ts: "2026-01-01 00:00:00.000", upd: true, db: "HSCUSTOM", gen: false },
      { name: "Checked444.Sub.Two.cls", cat: "CLS", ts: "2026-01-01 00:00:00.000", upd: true, db: "HSCUSTOM", gen: false },
    ]);
    const lower = await entriesOf(await docnames(listener, "CLS", "checked444."));
    expect(lower.map((entry) => entry["name"])).toEqual(["Checked444.One.cls", "Checked444.Sub.Two.cls"]);
  });

  it("the listener's memory is the checks it answered: a second check adds its classes, and a second listener knows nothing of the first's", async () => {
    const first = await listening();
    const second = await listening();
    await shared.verifyCompiled(first.http, NAMESPACE, V, ["Remembered444.One.cls"]);
    await shared.verifyCompiled(first.http, NAMESPACE, V, ["Remembered444.Two.cls"]);

    const remembered = await entriesOf(await docnames(first.listener, "CLS", "Remembered444."));
    expect(remembered.map((entry) => entry["name"])).toEqual(["Remembered444.One.cls", "Remembered444.Two.cls"]);
    const other = await entriesOf(await docnames(second.listener, "CLS", "Remembered444."));
    expect(other.map((entry) => entry["name"]), "a fresh listener answers its default").toEqual(DEFAULT_NAMES);
  });
});
