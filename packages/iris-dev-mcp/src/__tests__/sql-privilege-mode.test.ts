/**
 * Story 45.1 (AC 45.1.2, S-45.1-sql-privileges) - the SQL privilege mode of `/dev/sql/execute`, pinned in the default suite.
 *
 * `ExecuteMCPv2.REST.Sql.Perform` prepares every statement with SQL privilege checking on (`%Prepare(.pQuery, 1)`), so a
 * statement the calling account has no SQL grant for fails at prepare (SQLCODE -99). Nothing in the request, the tool or the
 * configuration turns it off (AD-25). This file needs no IRIS: it reads the class source and the embed the bootstrap ships and
 * fails when either prepares with anything but a literal `1`, or when a privilege control is read from the request. The
 * deployed behaviour is proven by `sql-privileges-live-gate.test.ts`, which a throwaway IRIS arms.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { BOOTSTRAP_CLASSES } from "@iris-mcp/shared";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-dev-mcp/src/__tests__/ -> repo root is 4 levels up.
const SOURCE_FILE = path.resolve(HERE, "..", "..", "..", "..", "src", "ExecuteMCPv2", "REST", "Sql.cls");
const EMBED_KEY = "ExecuteMCPv2.REST.Sql.cls";

/** The control names `ReadControls` reads from the request body: the whole request surface of the route. */
const CONTROLS = ["countOnly", "maxRowsAffected", "namespace", "parameters", "query", "readOnly"];

const SOURCES: Array<[string, string]> = [
  ["src/ExecuteMCPv2/REST/Sql.cls", readFileSync(SOURCE_FILE, "utf8")],
  [`the embed (BOOTSTRAP_CLASSES ${EMBED_KEY})`, BOOTSTRAP_CLASSES.get(EMBED_KEY) ?? ""],
];

/** The text from one `ClassMethod <name>(` to the next `ClassMethod`, or to the end of the class. */
function methodBody(source: string, name: string): string {
  const start = source.indexOf(`ClassMethod ${name}(`);
  if (start < 0) return "";
  const next = source.indexOf("\nClassMethod ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

/** The code lines of a method: doc comments (`///`) and line comments dropped. */
function codeOf(body: string): string {
  return body
    .split("\n")
    .filter((line) => !/^\s*(\/\/|;)/.test(line))
    .join("\n");
}

describe("the SQL privilege mode of /dev/sql/execute (Story 45.1, AC 45.1.2)", () => {
  it("both sources are real: the class file and the embed hold ReadControls and Perform", () => {
    for (const [label, source] of SOURCES) {
      expect(methodBody(source, "ReadControls"), label).toContain("ReadFlag(pBody");
      expect(methodBody(source, "Perform"), label).toContain("%SQL.Statement");
    }
  });

  for (const [label, source] of SOURCES) {
    it(`${label}: exactly one %Prepare( call, and it is %Prepare(.pQuery, 1) inside Perform`, () => {
      const calls = [...codeOf(source).matchAll(/%Prepare\([^\n]*/g)].map((match) => match[0].trim());

      expect(calls).toEqual(["%Prepare(.pQuery, 1)"]);
      expect(codeOf(source), "no other prepare or direct-execute entry point").not.toMatch(/%ExecDirect|%PrepareClassQuery/i);
      expect(codeOf(methodBody(source, "Perform"))).toContain("Set tSC = tStmt.%Prepare(.pQuery, 1)");
    });

    it(`${label}: ReadControls reads exactly the six documented controls, no privilege control`, () => {
      const body = codeOf(methodBody(source, "ReadControls"));
      const named = new Set<string>();
      for (const match of body.matchAll(/(?:%IsDefined|%Get|%GetTypeOf)\("([A-Za-z]+)"\)/g)) named.add(match[1] ?? "");
      for (const match of body.matchAll(/ReadFlag\(pBody, "([A-Za-z]+)"/g)) named.add(match[1] ?? "");

      expect([...named].sort()).toEqual(CONTROLS);
      expect(body.toLowerCase()).not.toContain("priv");
    });

    it(`${label}: no other method of the route reads the request or the environment for a privilege switch`, () => {
      for (const name of ["Execute", "Run", "Perform", "Decline"]) {
        const body = codeOf(methodBody(source, name)).toLowerCase();
        expect(body.length, `${name} exists and has a body`).toBeGreaterThan(0);
        expect(body, name).not.toContain("checkpriv");
        expect(body, name).not.toContain("privilege");
        expect(body, name).not.toMatch(/\$system\.|%getenv|\$zu\(/);
      }
    });
  }

  it("the embed's Sql class is the working tree's Sql class (the regenerated embed is not stale)", () => {
    const [, tree] = SOURCES[0] as [string, string];
    const [, embed] = SOURCES[1] as [string, string];

    expect(embed.replace(/\r\n/g, "\n").trimEnd()).toBe(tree.replace(/\r\n/g, "\n").trimEnd());
  });
});
