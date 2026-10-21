/**
 * Story 38.6 (AC-6, DW-559) -- the deployed-version check that the Epic 38 capstone and the Story 38.4 and
 * 38.5 wire gates run once their first built-server session has connected.
 *
 * `assertDeployedBootstrapVersion` reads `ExecuteMCPv2.Setup_GetBootstrapVersion()` over the raw Atelier
 * `action/query` route and compares it with the `BOOTSTRAP_VERSION` of the built shared dist. The gates
 * exercise the passing path against a live IRIS; this file exercises every outcome of the check, with no
 * IRIS: a local HTTP server answers the Atelier route with the result shape the route returns
 * (`{status: {errors: []}, console: [], result: {content: [{Version}]}}`, the shape `probeCustomRest` in
 * `packages/shared/src/bootstrap.ts` reads).
 *
 * Reads the built shared dist, as the gates do, and fails (never skips) when it is missing.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDeployedBootstrapVersion,
  atelierDocument,
  shippedBootstrapVersion,
  type IrisTarget,
} from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const VERSION_QUERY = "SELECT ExecuteMCPv2.Setup_GetBootstrapVersion() AS Version";

let server: Server;
let target: IrisTarget;
/** What the fake route answers for the version query: the `content` rows of the Atelier result. */
let versionRows: Array<Record<string, unknown>> = [];
/** The queries the fake route received. */
let received: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      if (request.method === "POST" && request.url === "/api/atelier/v1/HSCUSTOM/action/query") {
        received.push((JSON.parse(body) as { query: string }).query);
        response.end(JSON.stringify({ status: { errors: [] }, console: [], result: { content: versionRows } }));
      } else if (request.method === "GET" && request.url === "/api/atelier/v1/HSCUSTOM/doc/Test.Doc.cls") {
        response.end(
          JSON.stringify({
            status: { errors: [] },
            console: [],
            result: { name: "Test.Doc.cls", ts: "2026-10-16 10:00:00.000", content: ["Class Test.Doc", "{", "}", ""] },
          }),
        );
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify({ status: { errors: [{ error: "not found" }] }, console: [], result: {} }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  target = { host: "127.0.0.1", port: String(port), username: "u", password: "p", namespace: "HSCUSTOM" };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Story 38.6: assertDeployedBootstrapVersion (DW-559)", () => {
  it("passes, and returns the version, when the deployed version equals the shipped one; it sends the Setup_GetBootstrapVersion query", async () => {
    const shipped = await shippedBootstrapVersion(REPO_ROOT);
    expect(shipped).toMatch(/^\d+\.\d+\.\d+\+\d+\.[0-9a-f]{12}$/);
    versionRows = [{ Version: shipped }];
    received = [];

    await expect(assertDeployedBootstrapVersion(REPO_ROOT, target)).resolves.toBe(shipped);
    expect(received).toEqual([VERSION_QUERY]);
  });

  for (const [label, rows, deployed] of [
    ["the source placeholder dev", [{ Version: "dev" }], "dev"],
    ["an older hash", [{ Version: "0123456789ab" }], "0123456789ab"],
    ["an empty version", [{ Version: "" }], ""],
    ["no row at all", [], ""],
  ] as const) {
    it(`fails, naming both the deployed and the shipped value, when the deployed version is ${label}`, async () => {
      const shipped = await shippedBootstrapVersion(REPO_ROOT);
      versionRows = rows.map((row) => ({ ...row }));

      const outcome = await assertDeployedBootstrapVersion(REPO_ROOT, target).then(
        () => undefined,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );

      expect(outcome, "the check rejected").toBeDefined();
      expect(outcome).toContain(`BOOTSTRAP_VERSION "${deployed}"`);
      expect(outcome).toContain(`"${shipped}"`);
      expect(outcome).toContain("this gate would test classes other than the shipped ones");
      expect(outcome).toContain("that bootstrap failed or did not run, or refused to replace a newer or foreign deployment");
    });
  }

  it("fails, naming the route, when the Atelier route answers an error", async () => {
    const dead: IrisTarget = { ...target, namespace: "NOSUCH" };
    await expect(assertDeployedBootstrapVersion(REPO_ROOT, dead)).rejects.toThrow(
      "Atelier action/query answered HTTP 404",
    );
  });
});

describe("Story 38.6: atelierDocument, the raw GET /doc oracle of the capstone", () => {
  it("returns the version token and the lines exactly as the route answers them", async () => {
    await expect(atelierDocument(target, "Test.Doc.cls")).resolves.toEqual({
      ts: "2026-10-16 10:00:00.000",
      content: ["Class Test.Doc", "{", "}", ""],
    });
  });

  it("throws, naming the route, for a document the route does not have", async () => {
    await expect(atelierDocument(target, "No.Such.cls")).rejects.toThrow("Atelier doc/No.Such.cls answered HTTP 404");
  });
});
