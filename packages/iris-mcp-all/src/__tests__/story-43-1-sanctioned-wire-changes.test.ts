/**
 * Story 43.1 (AD-15, wave-8 decision #6; project rules #36, #59) - the two 2025-11-25 wire answers that SDK v2 changed and AD-15
 * sanctions, pinned byte for byte on the five BUILT servers over the SDK-free raw driver, so neither can drift unnoticed:
 *  - a malformed `tools/call` request (no `params`, `name` missing or not a string, `arguments` not an object) is answered with the
 *    JSON-RPC error `-32602` `Invalid tools/call request: <the schema issues>`, which the SDK writes before the framework's `tools/call`
 *    runs;
 *  - a `tools/call` that carries a `task` parameter is served as a plain call: its response line is the plain call's line, which the v1
 *    golden (`fixtures/sdk-wire-golden.json`, row `call:server-profiles`) pins.
 *
 * The expected lines are the ones the built v2 servers wrote (`@modelcontextprotocol/server` 2.3.1, zod 4.3.6), captured with this
 * driver on the closed port. Every server runs against 127.0.0.1:1, a closed local port, so no IRIS instance is reached. The file
 * fails, never skips, when a dist is missing or older than its source.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./pack-fixture";
import {
  CLOSED_PORT_ENV,
  GOLDEN_PACKAGES,
  WIRE_ERA,
  handshake,
  inheritedGoldenEnv,
  openRawWire,
} from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { readSanctionedGolden } from "../../../../scripts/lib/golden-sanctioned-changes.mjs";
import { distEntry, staleDistReason } from "./process-gate-helpers.js";

interface Frame {
  line: string;
  message: { id?: number };
}

interface Golden {
  servers: Record<string, { sessions: Record<string, { rows: Array<{ label: string; line: string }> }> }>;
}

const golden = readSanctionedGolden(REPO_ROOT, "wire") as Golden;

/** The message of the SDK's refusal of a malformed `tools/call` whose one issue sits at `params.<pathTail>`. */
function invalidRequestMessage(pathTail: string[], expected: string, received: string): string {
  const pathLines = ["params", ...pathTail].map((segment) => `      "${segment}"`).join(",\n");
  return (
    `Invalid tools/call request: [\n  {\n    "expected": "${expected}",\n    "code": "invalid_type",\n    "path": [\n${pathLines}\n    ],\n` +
    `    "message": "Invalid input: expected ${expected}, received ${received}"\n  }\n]`
  );
}

/** The malformed requests, each with the error message the SDK answers it with. */
const MALFORMED: Array<{ label: string; fields: { method: string; params?: unknown }; message: string }> = [
  { label: "no params", fields: { method: "tools/call" }, message: invalidRequestMessage([], "object", "undefined") },
  { label: "name missing", fields: { method: "tools/call", params: { arguments: {} } }, message: invalidRequestMessage(["name"], "string", "undefined") },
  {
    label: "name not a string",
    fields: { method: "tools/call", params: { name: 12345, arguments: {} } },
    message: invalidRequestMessage(["name"], "string", "number"),
  },
  {
    label: "arguments a string",
    fields: { method: "tools/call", params: { name: "iris_server_profiles", arguments: "x" } },
    message: invalidRequestMessage(["arguments"], "record", "string"),
  },
  {
    label: "arguments null",
    fields: { method: "tools/call", params: { name: "iris_server_profiles", arguments: null } },
    message: invalidRequestMessage(["arguments"], "record", "null"),
  },
  {
    label: "arguments an array",
    fields: { method: "tools/call", params: { name: "iris_server_profiles", arguments: [] } },
    message: invalidRequestMessage(["arguments"], "record", "array"),
  },
];

/** A response line with its trailing JSON-RPC `id` set to `id`; the line must end in one. */
function withTrailingId(line: string, id: number | undefined): string {
  expect(line, "the line ends in its id").toMatch(/"id":\d+\}$/);
  return line.replace(/"id":\d+\}$/, `"id":${id}}`);
}

describe("the sanctioned wire answers are pinned on every built server (AD-15, wave-8 decision #6)", () => {
  beforeAll(() => {
    const stale = ["shared", ...GOLDEN_PACKAGES]
      .map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const)
      .filter(([, reason]) => reason !== undefined);
    if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);
  });

  describe.each(GOLDEN_PACKAGES)("%s", (pkg) => {
    const malformed = new Map<string, Frame>();
    let plain: Frame;
    let withTask: Frame;

    beforeAll(async () => {
      const wire = openRawWire({ entry: distEntry(REPO_ROOT, pkg), env: { ...inheritedGoldenEnv(process.env), ...CLOSED_PORT_ENV } });
      try {
        await handshake(wire, WIRE_ERA, "story-43-1-sanctioned-wire-changes");
        for (const row of MALFORMED) malformed.set(row.label, await wire.requestFrame(row.fields));
        plain = await wire.request("tools/call", { name: "iris_server_profiles", arguments: {} });
        withTask = await wire.request("tools/call", { name: "iris_server_profiles", arguments: {}, task: { ttl: 60000 } });
      } finally {
        await wire.close();
      }
    }, 60_000);

    for (const row of MALFORMED) {
      it(`a tools/call with ${row.label} is refused -32602 'Invalid tools/call request', byte for byte`, () => {
        const frame = malformed.get(row.label)!;
        expect(frame.line).toBe(JSON.stringify({ jsonrpc: "2.0", id: frame.message.id, error: { code: -32602, message: row.message } }));
      });
    }

    it("a tools/call that carries task is served as the plain call, whose line is the v1 golden's call:server-profiles line", () => {
      const goldenLine = golden.servers[pkg]?.sessions["main"]?.rows.find((row) => row.label === "call:server-profiles")?.line;
      expect(goldenLine, "the golden holds the plain call").toBeDefined();
      expect(plain.line).toBe(withTrailingId(goldenLine!, plain.message.id));
      expect(withTask.line).toBe(withTrailingId(plain.line, withTask.message.id));
    });
  });
});
