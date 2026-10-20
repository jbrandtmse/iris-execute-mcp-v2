/**
 * Story 43.1 QA (AC 43.1.3, DW-579; AD-15, AD-32, AD-3; project rules #36, #49, #59) - what the tool HANDLERS of the five BUILT
 * servers return, and what they ask IRIS for, pinned to the SDK v1 build.
 *
 * `story-43-1-sdk-wire-golden.test.ts` cannot reach a handler's result, because a handler needs an IRIS instance. This file runs each
 * built server against the fake IRIS in `scripts/lib/fake-iris-listener.mjs` (a listener on 127.0.0.1 inside this process; no IRIS
 * instance is reached) and compares three things with `fixtures/sdk-handler-golden.json`, which `scripts/capture-sdk-handler-golden.mjs`
 * captured from the SDK v1 build of the baseline revision:
 *  - the response line of each `tools/call`, byte for byte (a success, an `isError` result with and without `structuredContent`, a
 *    handler that throws, an HTTP error envelope, a governance denial);
 *  - the requests the server made to IRIS while it answered (they prove the handler received the parsed arguments); and
 *  - the audit entries it wrote with `IRIS_AUDIT_LOG_PARAMS=true`.
 *
 * The one sanctioned difference is the audit entry of the final, schema-invalid call (DW-579): the v1 build wrote none. The audit
 * `sessionStart` line's `version` is compared with the package manifest's version, which a release changes; every other byte is as
 * captured. The golden is the v1 capture and is never edited to match a newer build. The file fails, never skips, when a dist is missing
 * or older than its source.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import {
  GOLDEN_PACKAGES,
  HANDLER_GOLDEN_RELATIVE_PATH,
  diffHandlerSession,
  handlerExchanges,
  readBootstrapVersion,
  runHandlerSession,
  withSessionVersion,
} from "../../../../scripts/lib/sdk-handler-golden-core.mjs";
import { inheritedGoldenEnv, packageVersion } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { distEntry, staleDistReason } from "./process-gate-helpers.js";

interface UpstreamRequest {
  method: string;
  url: string;
  body: string;
}

interface HandlerRow {
  label: string;
  method: string;
  params: { name: string; arguments: Record<string, unknown> };
  schemaInvalid?: boolean;
  line: string;
  upstream: UpstreamRequest[];
}

interface HandlerSession {
  startup: UpstreamRequest[];
  rows: HandlerRow[];
  audit: Array<Record<string, unknown>>;
}

interface HandlerGolden {
  baselineRevision: string;
  sdkPackage: string;
  sdkVersion: string;
  bootstrapVersion: string;
  servers: Record<string, HandlerSession>;
}

const golden = JSON.parse(readFileSync(path.join(REPO_ROOT, HANDLER_GOLDEN_RELATIVE_PATH), "utf8")) as HandlerGolden;

/** The member names of the `result` object of a response line, in the order the line writes them. */
const resultKeys = (line: string): string[] => Object.keys((JSON.parse(line) as { result?: object }).result ?? {});

const rowOf = (session: HandlerSession, label: string): HandlerRow => {
  const row = session.rows.find((candidate) => candidate.label === label);
  if (!row) throw new Error(`no row ${label}`);
  return row;
};

/** Fail, rather than skip, when a dist the test runs is missing or stale. */
function prerequisites(): void {
  const stale = ["shared", ...GOLDEN_PACKAGES]
    .map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const)
    .filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);
}

describe("the handler golden fixture", () => {
  it("is the capture of the SDK v1 build of the baseline revision", () => {
    expect(golden.sdkPackage.endsWith("/sdk")).toBe(true);
    expect(golden.sdkVersion).toBe("1.29.0");
    expect(golden.baselineRevision).toMatch(/^[0-9a-f]{40}$/);
  });

  it("covers the five servers, row for row as the exchange list of the core asks", () => {
    expect(Object.keys(golden.servers)).toEqual([...GOLDEN_PACKAGES]);
    for (const pkg of GOLDEN_PACKAGES) {
      const recorded = golden.servers[pkg]!.rows.map((row) => ({ label: row.label, method: row.method, params: row.params, schemaInvalid: row.schemaInvalid }));
      const asked = handlerExchanges(pkg).map((row: Record<string, unknown>) => ({ label: row.label, method: row.method, params: row.params, schemaInvalid: row.schemaInvalid }));
      expect(recorded, pkg).toEqual(asked);
      expect(golden.servers[pkg]!.rows.at(-1)?.schemaInvalid, `${pkg}: the last row is the schema-invalid call`).toBe(true);
    }
  });

  it("is a v1 capture: it holds no audit entry for the schema-invalid call, and the session line plus one entry per other call", () => {
    for (const pkg of GOLDEN_PACKAGES) {
      const session = golden.servers[pkg]!;
      expect(session.audit.length, pkg).toBe(session.rows.length);
      const invalid = session.rows.at(-1)!;
      expect(session.audit.find((entry) => entry["seq"] === session.rows.length), `${pkg}: no entry for ${invalid.label}`).toBeUndefined();
    }
  });

  it("holds every kind of result a handler returns", () => {
    const dev = golden.servers["iris-dev-mcp"]!;
    const parsed = (label: string) => (JSON.parse(rowOf(dev, label).line) as { result: Record<string, unknown> }).result;
    expect(parsed("doc-get:full")["structuredContent"], "a success with structuredContent").toBeDefined();
    expect(parsed("sql-query:refusal")).toMatchObject({ isError: true, structuredContent: { code: "SQL_READ_ONLY" } });
    expect(parsed("doc-get:metadata-missing")).toMatchObject({ isError: false, structuredContent: { exists: false } });
    expect(parsed("doc-get:not-found")["structuredContent"], "an isError result without structuredContent").toBeUndefined();
    expect(JSON.stringify(parsed("doc-list:handler-throws"))).toContain("Tool error:");
    expect(JSON.stringify(parsed("sql-query:rest-error"))).toContain("IRIS returned HTTP 500");
    expect(parsed("denial")).toMatchObject({ isError: true, structuredContent: { code: "GOVERNANCE_DISABLED" } });
  });
});

describe.each(GOLDEN_PACKAGES)("handler golden: %s", (pkg) => {
  const recorded = golden.servers[pkg]!;
  let live: HandlerSession;

  beforeAll(async () => {
    prerequisites();
    live = await runHandlerSession({
      entry: distEntry(REPO_ROOT, pkg),
      baseEnv: inheritedGoldenEnv(process.env),
      pkg,
      bootstrapVersion: readBootstrapVersion(REPO_ROOT),
    });
  }, 120_000);

  it("asks IRIS for the same things while it starts", () => {
    expect(live.startup).toEqual(recorded.startup);
  });

  for (const row of recorded.rows) {
    it(`${row.label}: the response line is byte-identical to the v1 build's`, () => {
      expect(live.rows.find((candidate) => candidate.label === row.label)?.line).toBe(row.line);
    });

    it(`${row.label}: the server makes the same requests to IRIS`, () => {
      expect(live.rows.find((candidate) => candidate.label === row.label)?.upstream).toEqual(row.upstream);
    });
  }

  it("writes the same audit entries for every valid call, and one entry for the schema-invalid call (DW-579)", () => {
    expect(live.audit.slice(0, recorded.audit.length)).toEqual(withSessionVersion(recorded.audit, packageVersion(REPO_ROOT, pkg)));
    expect(live.audit).toHaveLength(recorded.audit.length + 1);
    const refused = live.audit.at(-1)!;
    const invalid = recorded.rows.at(-1)!;
    expect(refused).toMatchObject({ tool: invalid.params.name, outcome: "error" });
    expect(refused["paramKeys"]).toEqual(Object.keys(invalid.params.arguments));
    expect(refused).not.toHaveProperty("params");
    expect(refused).not.toHaveProperty("dataPolicy");
    expect(String(refused["error"]).startsWith(`MCP error -32602: Input validation error: Invalid arguments for tool ${invalid.params.name}: `)).toBe(true);
  });

  it("differs from the golden in nothing else (the comparison the capture and the replay share)", () => {
    expect(diffHandlerSession(recorded, live, { sessionVersion: packageVersion(REPO_ROOT, pkg) })).toEqual([]);
  });
});

describe("what the golden pins about the dev server", () => {
  let live: HandlerSession;

  beforeAll(async () => {
    prerequisites();
    live = await runHandlerSession({
      entry: distEntry(REPO_ROOT, "iris-dev-mcp"),
      baseEnv: inheritedGoldenEnv(process.env),
      pkg: "iris-dev-mcp",
      bootstrapVersion: readBootstrapVersion(REPO_ROOT),
    });
  }, 120_000);

  it("writes a result with isError and structuredContent as content, structuredContent, isError, as the v1 build did", () => {
    // The v1 SDK server re-parses every tools/call result with its result schema, so its wire already had this order.
    for (const label of ["sql-query:refusal", "doc-get:metadata-missing", "denial"]) {
      const golden1 = resultKeys(rowOf(golden.servers["iris-dev-mcp"]!, label).line);
      expect(golden1, `the v1 build's ${label}`).toEqual(["content", "structuredContent", "isError"]);
      expect(resultKeys(rowOf(live, label).line), `this build's ${label}`).toEqual(golden1);
    }
  });

  it("hands the handler, and the audit entry, the parsed arguments: numbers for numeric strings, booleans for boolean strings, no unknown key", () => {
    const entries = live.audit.filter((entry) => entry["tool"] === "iris_doc_get");
    expect(entries[0]).toMatchObject({ paramKeys: ["name", "startLine", "endLine"], params: { name: "Demo.Sample.cls", startLine: 2, endLine: 3 } });
    expect(rowOf(live, "doc-list:coerced").upstream.map((request) => request.url)).toEqual(["/api/atelier/v8/HSCUSTOM/docnames/CLS/*?filter=Demo&generated=0"]);
  });

  it("audits a governance denial with its reason", () => {
    expect(live.audit.find((entry) => entry["tool"] === "iris_env_promote")).toMatchObject({
      action: "execute",
      outcome: "denied",
      denyReason: "GOVERNANCE_DISABLED",
    });
  });
});

describe("diffHandlerSession (the comparison of a replay with the golden)", () => {
  const dev = golden.servers["iris-dev-mcp"]!;
  const clone = (): HandlerSession => structuredClone(dev);
  /** The golden's own session plus the audit entry a build with DW-579 adds for the schema-invalid call. */
  const withDw579Entry = (session: HandlerSession): HandlerSession => {
    const invalid = session.rows.at(-1)!;
    session.audit.push({
      seq: session.rows.length,
      serverPkg: "@iris-mcp/dev",
      tool: invalid.params.name,
      action: null,
      profile: "default",
      namespace: "HSCUSTOM",
      outcome: "error",
      paramKeys: Object.keys(invalid.params.arguments),
      profileSource: "env",
      error: "MCP error -32602: Input validation error: Invalid arguments for tool iris_doc_get: []",
    });
    return session;
  };

  it("finds nothing when the live session is the golden plus the DW-579 entry", () => {
    expect(diffHandlerSession(dev, withDw579Entry(clone()))).toEqual([]);
  });

  it("finds a response line that differs", () => {
    const live = withDw579Entry(clone());
    live.rows[2]!.line = live.rows[2]!.line.replace("not found", "missing");
    expect(diffHandlerSession(dev, live).join("\n")).toContain("doc-get:not-found: response line differs");
  });

  it("finds a member order that differs, because a line is compared byte for byte", () => {
    const live = withDw579Entry(clone());
    const refusal = live.rows.find((row) => row.label === "sql-query:refusal")!;
    const message = JSON.parse(refusal.line) as { result: Record<string, unknown> };
    const { isError, ...rest } = message.result;
    refusal.line = JSON.stringify({ ...message, result: { content: rest["content"], isError, structuredContent: rest["structuredContent"] } });
    expect(diffHandlerSession(dev, live).join("\n")).toContain("sql-query:refusal: response line differs");
  });

  it("finds a request to IRIS that differs", () => {
    const live = withDw579Entry(clone());
    live.rows[5]!.upstream = live.rows[5]!.upstream.map((request) => ({ ...request, url: request.url.replace("generated=0", "generated=1") }));
    expect(diffHandlerSession(dev, live).join("\n")).toContain("requests made to IRIS differ");
  });

  it("finds an audit entry that differs, and a missing or wrong DW-579 entry", () => {
    const changed = withDw579Entry(clone());
    changed.audit[1] = { ...changed.audit[1], paramKeys: ["name", "startLine", "endLine", "bogus"] };
    expect(diffHandlerSession(dev, changed).join("\n")).toContain("audit entries differ");

    expect(diffHandlerSession(dev, clone()).join("\n")).toContain("wrote no audit entry");

    const withParams = withDw579Entry(clone());
    withParams.audit[withParams.audit.length - 1] = { ...withParams.audit.at(-1), params: { name: 12345 } };
    expect(diffHandlerSession(dev, withParams).join("\n")).toContain("is not the specified one");
  });

  it("finds a startup request that differs", () => {
    const live = withDw579Entry(clone());
    live.startup = [...live.startup, { method: "GET", url: "/api/atelier/v8/HSCUSTOM/extra", body: "" }];
    expect(diffHandlerSession(dev, live).join("\n")).toContain("startup requests differ");
  });
});
