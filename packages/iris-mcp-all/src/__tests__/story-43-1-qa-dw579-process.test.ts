/**
 * Story 43.1 QA (DW-579, AD-3, AD-19; project rules #19, #59) - the audit of a schema-invalid `tools/call`, on the real process of
 * every BUILT server, for every tool it lists.
 *
 * `story-43-1-schema-invalid-audit.test.ts` pins one invalid call on the dev server. This file sweeps the whole catalogue (115 tools)
 * over stdio with the SDK-free raw driver, against 127.0.0.1:1 (a closed local port; no IRIS instance is reached), and reads the audit
 * file as an operator would:
 *  - each schema-invalid call writes exactly ONE entry: `outcome` `error`, `error` equal to the text the client received, `paramKeys`
 *    equal to the raw top-level key names minus `server`, and no `params` and no `dataPolicy`, with `IRIS_AUDIT_LOG_PARAMS` set and unset;
 *  - an invented secret placed in the invalid field never reaches the audit file, the client's response line or the server's stderr
 *    (it is sent as an object, as a string in a field of a non-string type, and inside an enum);
 *  - an unknown tool and a hidden tool write no entry, and the audit is demonstrably live in the same session (a visible call after
 *    them is recorded), so "no entry" is not an audit that never worked.
 *
 * The file fails, never skips, when a dist is missing or older than its source.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import {
  CLOSED_PORT_ENV,
  GOLDEN_PACKAGES,
  WIRE_ERA,
  handshake,
  inheritedGoldenEnv,
  openRawWire,
} from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { distEntry, pollAuditEntries, settledAuditCount, staleDistReason } from "./process-gate-helpers.js";

/** An invented secret: it appears nowhere in a tool's schema, a message or a default. */
const SECRET = "QA431-secret-9f3a7c1d-never-log-me";

const INVALID_PREFIX = "MCP error -32602: Input validation error: Invalid arguments for tool ";

type AuditEntry = Record<string, unknown>;

interface ListedProperty {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: unknown[];
  oneOf?: unknown[];
}

interface ListedTool {
  name: string;
  inputSchema: { properties?: Record<string, ListedProperty> };
}

interface SweepCall {
  tool: string;
  variant: string;
  args: Record<string, unknown>;
  line: string;
  text: string;
}

interface Sweep {
  calls: SweepCall[];
  /** Every line of the audit file, parsed, in the order written. */
  entries: AuditEntry[];
  auditText: string;
  stderr: string;
  toolCount: number;
}

let tempDir: string;
let sessionCounter = 0;

/** Whether a property is a free string: a string with no enum, so a string value is valid for it. */
function isFreeString(property: ListedProperty): boolean {
  return property.type === "string" && property.enum === undefined && property.anyOf === undefined && property.oneOf === undefined;
}

/** The arguments of a variant for a tool, or `undefined` when the variant does not apply to it. */
function argumentsOf(variant: "server" | "objects" | "strings", tool: ListedTool): Record<string, unknown> | undefined {
  const properties = tool.inputSchema.properties ?? {};
  if (variant === "server") return { server: { value: SECRET } };
  if (variant === "objects") return Object.fromEntries(Object.keys(properties).map((name) => [name, { value: SECRET }]));
  // "strings": the secret as a string in each field of a non-string type (an enum, a number, a boolean, an array); `server` and
  // `namespace` are left out because a string for them is a valid value that the audit derives its profile and namespace from.
  const poisoned = Object.entries(properties).filter(([name, property]) => name !== "server" && name !== "namespace" && !isFreeString(property));
  return poisoned.length === 0 ? undefined : Object.fromEntries(poisoned.map(([name]) => [name, SECRET]));
}

function readEntries(file: string): AuditEntry[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as AuditEntry);
}

/** Start the built server of `pkg`, call every tool it lists once per variant, and read what it audited and logged. */
async function runSweep(
  pkg: string,
  options: { params: boolean; variants: Array<"server" | "objects" | "strings">; preset?: string },
): Promise<Sweep> {
  sessionCounter += 1;
  const auditFile = path.join(tempDir, `${pkg}-${sessionCounter}.jsonl`);
  const env: Record<string, string> = {
    ...inheritedGoldenEnv(process.env),
    ...CLOSED_PORT_ENV,
    IRIS_AUDIT_LOG: auditFile,
    LOG_LEVEL: "DEBUG",
    ...(options.params ? { IRIS_AUDIT_LOG_PARAMS: "true" } : {}),
    ...(options.preset ? { IRIS_TOOLS_PRESET: options.preset } : {}),
  };
  const wire = openRawWire({ entry: distEntry(REPO_ROOT, pkg), env });
  try {
    await handshake(wire, WIRE_ERA, "story-43-1-qa-dw579-process");
    const listed = (JSON.parse((await wire.request("tools/list", {})).line) as { result: { tools: ListedTool[] } }).result.tools;
    const calls: SweepCall[] = [];
    for (const tool of listed) {
      for (const variant of options.variants) {
        const args = argumentsOf(variant, tool);
        if (args === undefined) continue;
        // eslint-disable-next-line no-await-in-loop
        const frame = await wire.request("tools/call", { name: tool.name, arguments: args });
        const result = (frame.message as { result?: { content?: Array<{ text?: string }> } }).result;
        calls.push({ tool: tool.name, variant, args, line: frame.line, text: result?.content?.[0]?.text ?? "" });
      }
    }
    await pollAuditEntries(auditFile, { count: calls.length, isWanted: (entry) => typeof entry["tool"] === "string", returnAll: true, intervalMs: 50, timeoutMs: 20_000, excerpt: 500 });
    await settledAuditCount(auditFile);
    return {
      calls,
      entries: readEntries(auditFile),
      auditText: readFileSync(auditFile, "utf8"),
      stderr: wire.stderr(),
      toolCount: listed.length,
    };
  } finally {
    await wire.close();
  }
}

beforeAll(() => {
  const stale = ["shared", ...GOLDEN_PACKAGES]
    .map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const)
    .filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);
  tempDir = mkdtempSync(path.join(tmpdir(), "story-43-1-qa-dw579-"));
});

afterAll(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe.each(GOLDEN_PACKAGES)("DW-579 on the real process: %s", (pkg) => {
  let withParams: Sweep;
  let withoutParams: Sweep;

  beforeAll(async () => {
    withParams = await runSweep(pkg, { params: true, variants: ["server", "objects"] });
    withoutParams = await runSweep(pkg, { params: false, variants: ["server", "objects", "strings"] });
  }, 180_000);

  /** The tool entries of a sweep, which come in the order of its calls (the session line is not one). */
  const toolEntries = (sweep: Sweep): AuditEntry[] => sweep.entries.filter((entry) => entry["tool"] !== undefined);

  it("lists the tools of the package, and every call of the sweep is refused as schema-invalid", () => {
    expect(withParams.toolCount).toBeGreaterThan(0);
    expect(withParams.calls).toHaveLength(withParams.toolCount * 2);
    for (const call of withParams.calls) {
      expect(call.text.startsWith(`${INVALID_PREFIX}${call.tool}: `), `${call.tool} (${call.variant})`).toBe(true);
    }
  });

  it("with IRIS_AUDIT_LOG_PARAMS=true, writes one entry per invalid call: outcome error, the client's text, the raw key names, no params", () => {
    const entries = toolEntries(withParams);
    expect(entries).toHaveLength(withParams.calls.length);
    withParams.calls.forEach((call, index) => {
      const entry = entries[index]!;
      const where = `${call.tool} (${call.variant})`;
      expect(entry["tool"], where).toBe(call.tool);
      expect(entry["outcome"], where).toBe("error");
      expect(entry["error"], where).toBe(call.text);
      expect(entry["paramKeys"], where).toEqual(Object.keys(call.args).filter((key) => key !== "server"));
      expect(entry, where).not.toHaveProperty("params");
      expect(entry, where).not.toHaveProperty("dataPolicy");
    });
  });

  it("with IRIS_AUDIT_LOG_PARAMS=true, the secret in the invalid field reaches neither the audit file, nor the client, nor stderr", () => {
    expect(withParams.auditText).not.toContain(SECRET);
    expect(withParams.stderr).not.toContain(SECRET);
    for (const call of withParams.calls) expect(call.line, `${call.tool} (${call.variant})`).not.toContain(SECRET);
  });

  it("with the parameter log off, no entry carries params, and an invalid call's entry is the same as with it on", () => {
    for (const entry of toolEntries(withoutParams)) expect(entry).not.toHaveProperty("params");
    const invalid = (sweep: Sweep, variant: string): AuditEntry[] =>
      sweep.calls
        .map((call, index) => ({ call, entry: toolEntries(sweep)[index]! }))
        .filter(({ call }) => call.variant === variant && call.text.startsWith(INVALID_PREFIX))
        .map(({ entry }) => {
          const { ts: _ts, session: _session, seq: _seq, durationMs: _durationMs, ...rest } = entry;
          return rest;
        });
    expect(invalid(withoutParams, "objects")).toEqual(invalid(withParams, "objects"));
  });

  it("with the parameter log off, the secret in a field of a non-string type reaches no invalid call's entry, the client's response or stderr", () => {
    const entries = toolEntries(withoutParams);
    withoutParams.calls.forEach((call, index) => {
      if (!call.text.startsWith(INVALID_PREFIX)) return;
      expect(JSON.stringify(entries[index]), `${call.tool} (${call.variant})`).not.toContain(SECRET);
      expect(call.line, `${call.tool} (${call.variant})`).not.toContain(SECRET);
    });
    expect(withoutParams.stderr).not.toContain(SECRET);
    // The "strings" variant is a real test of the enum, number, boolean and array fields: some call of it is refused.
    expect(withoutParams.calls.filter((call) => call.variant === "strings" && call.text.startsWith(INVALID_PREFIX)).length).toBeGreaterThan(0);
  });
});

describe("DW-579 on the real process: calls that are not audited", () => {
  const auditedSession = async (preset?: string) => {
    sessionCounter += 1;
    const auditFile = path.join(tempDir, `unaudited-${sessionCounter}.jsonl`);
    const env: Record<string, string> = {
      ...inheritedGoldenEnv(process.env),
      ...CLOSED_PORT_ENV,
      IRIS_AUDIT_LOG: auditFile,
      IRIS_AUDIT_LOG_PARAMS: "true",
      ...(preset ? { IRIS_TOOLS_PRESET: preset } : {}),
    };
    const wire = openRawWire({ entry: distEntry(REPO_ROOT, "iris-dev-mcp"), env });
    await handshake(wire, WIRE_ERA, "story-43-1-qa-dw579-process");
    return { wire, auditFile };
  };

  const textOf = (frame: { message: unknown }): string =>
    (frame.message as { result?: { content?: Array<{ text?: string }> } }).result?.content?.[0]?.text ?? "";

  it("an unknown tool writes no entry, and the audit records the next visible call", async () => {
    const { wire, auditFile } = await auditedSession();
    try {
      const before = await settledAuditCount(auditFile);
      const unknown = await wire.request("tools/call", { name: "no_such_tool", arguments: { value: { value: SECRET } } });
      expect(textOf(unknown)).toBe("MCP error -32602: Tool no_such_tool not found");
      expect(await settledAuditCount(auditFile), "no entry for an unknown tool").toBe(before);

      await wire.request("tools/call", { name: "iris_server_profiles", arguments: {} });
      await pollAuditEntries(auditFile, { tool: "iris_server_profiles", count: 1, intervalMs: 50, timeoutMs: 10_000, excerpt: 500 });
      expect(await settledAuditCount(auditFile), "the audit is live: the visible call is the one new entry").toBe(before + 1);
    } finally {
      await wire.close();
    }
  }, 60_000);

  it("a hidden tool, even with a schema-invalid argument, is refused as not found, writes no entry and echoes no argument", async () => {
    const { wire, auditFile } = await auditedSession("core");
    try {
      const listed = (JSON.parse((await wire.request("tools/list", {})).line) as { result: { tools: Array<{ name: string }> } }).result.tools;
      expect(listed.map((tool) => tool.name), "iris_doc_delete is hidden by the core preset").not.toContain("iris_doc_delete");
      const before = await settledAuditCount(auditFile);

      const hidden = await wire.request("tools/call", { name: "iris_doc_delete", arguments: { name: { value: SECRET } } });
      expect(textOf(hidden)).toBe("MCP error -32602: Tool iris_doc_delete not found");
      expect(hidden.line).not.toContain(SECRET);
      expect(await settledAuditCount(auditFile), "no entry for a hidden tool").toBe(before);

      // The same invalid call to a VISIBLE tool is audited in this very session.
      const visible = await wire.request("tools/call", { name: "iris_doc_get", arguments: { name: { value: SECRET } } });
      expect(textOf(visible).startsWith(`${INVALID_PREFIX}iris_doc_get: `)).toBe(true);
      await pollAuditEntries(auditFile, { tool: "iris_doc_get", count: 1, intervalMs: 50, timeoutMs: 10_000, excerpt: 500 });
      expect(await settledAuditCount(auditFile), "the audit is live: the visible invalid call is the one new entry").toBe(before + 1);
      expect(readFileSync(auditFile, "utf8")).not.toContain(SECRET);
    } finally {
      await wire.close();
    }
  }, 60_000);
});
