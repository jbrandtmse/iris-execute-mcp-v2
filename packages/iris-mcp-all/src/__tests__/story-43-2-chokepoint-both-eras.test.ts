/**
 * Story 43.2 (AC 43.2.3; AD-3, AD-7, AD-19, AD-32; Rules #19, #36, #59) - every gate of the call-time chokepoint behaves the same on the
 * 2025-11-25 era and on revision 2026-07-28, and no per-request `_meta` key changes any of them.
 *
 * The BUILT dev server runs against two fake IRIS listeners (`scripts/lib/fake-iris-listener.mjs`, on 127.0.0.1 inside this process; no
 * IRIS instance is reached): the `default` profile reaches A, and `IRIS_PROFILES` adds `other`, which reaches B. Auditing is on, with
 * parameters. The seven calls of the story run once per era on a raw session (`server/discover` plus the envelope on the modern one):
 *   1. `iris_doc_get` of a document: reaches A, in HSCUSTOM, and is audited `ok`.
 *   2. The same call with `_meta` carrying `server`, `namespace`, `profile`, `governance`, `IRIS_GOVERNANCE`, `visible` and an override of
 *      `clientCapabilities`: it is call 1 again - A, HSCUSTOM, the same response and the same audit entry.
 *   3. `server: "other"` with `namespace: "USER"`: reaches B at `/v8/USER/`.
 *   4. `server: "nope"`: the unknown-profile result; nothing reaches IRIS.
 *   5. `iris_env_promote:execute`, with and without `_meta` that tries to enable it: `GOVERNANCE_DISABLED`, audited `denied`, nothing reaches IRIS.
 *   6. A schema-invalid `iris_doc_get`: the validation result and the DW-579 audit entry.
 *   7. Under `IRIS_TOOLS_PRESET=core`, in its own process: `tools/list`, with and without the smuggling `_meta`, returns the 15 core
 *      tools, and `iris_doc_delete`, with and without `_meta { visible: true }`, is "not found" and unaudited.
 * For each call the response (with the mandated fields removed), the requests each listener received, and the normalized audit entry must be
 * equal across the eras AND equal to the literal pinned here, which was captured by running the legacy build on this fixture
 * (`node` on the session driver of `scripts/lib/sdk-wire-golden-core.mjs`; dev 0.0.2, SDK 2.3.1).
 *
 * The file fails, never skips, when a dist is missing or older than its source.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { startFakeIris } from "../../../../scripts/lib/fake-iris-listener.mjs";
import {
  normalizeAuditEntry,
  readBootstrapVersion,
  settledAuditEntries,
  withSessionVersion,
} from "../../../../scripts/lib/sdk-handler-golden-core.mjs";
import {
  CLOSED_PORT_ENV,
  GOLDEN_RELATIVE_PATH,
  WIRE_ERA,
  discoverHandshake,
  handshake,
  inheritedGoldenEnv,
  modernEnvelope,
  openRawWire,
  packageVersion,
  withEnvelope,
  withoutExecution,
  withoutMandatedFields,
} from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { distEntry, staleDistReason } from "./process-gate-helpers.js";

type Era = "legacy" | "modern";

/** One request of a session: `tools/call` of `tool`, or `method` itself, with an optional `_meta` merged into its params. */
interface Step {
  label: string;
  tool?: string;
  args?: Record<string, unknown>;
  method?: string;
  meta?: Record<string, unknown>;
}

/** What one request did: the response without framing and mandated fields, and the requests each listener received. */
interface StepRecord {
  response: unknown;
  a: string[];
  b: string[];
}

interface SessionRecord {
  steps: Map<string, StepRecord>;
  audit: Array<Record<string, unknown>>;
}

const PKG = "iris-dev-mcp";
const DOCUMENT = { name: "Demo.Sample.cls" };

/** Keys a caller might hope to steer the chokepoint with. */
const SMUGGLED_META = {
  server: "other",
  namespace: "%SYS",
  profile: "other",
  governance: { iris_env_promote: true },
  IRIS_GOVERNANCE: JSON.stringify({ "iris_env_promote:execute": true }),
  visible: true,
  "io.modelcontextprotocol/clientCapabilities": { elicitation: {} },
};

const DENIAL = { action: "execute", source: "A", target: "B" };

const MAIN_STEPS: Step[] = [
  { label: "1 plain", tool: "iris_doc_get", args: DOCUMENT },
  { label: "2 smuggled", tool: "iris_doc_get", args: DOCUMENT, meta: SMUGGLED_META },
  { label: "3 other profile and namespace", tool: "iris_doc_get", args: { ...DOCUMENT, server: "other", namespace: "USER" } },
  { label: "4 unknown profile", tool: "iris_doc_get", args: { ...DOCUMENT, server: "nope" } },
  { label: "5 denial plain", tool: "iris_env_promote", args: DENIAL },
  { label: "5 denial smuggled", tool: "iris_env_promote", args: DENIAL, meta: SMUGGLED_META },
  { label: "6 schema-invalid", tool: "iris_doc_get", args: { name: 12345 } },
];

const CORE_STEPS: Step[] = [
  { label: "7 tools-list", method: "tools/list" },
  { label: "7 tools-list smuggled", method: "tools/list", meta: SMUGGLED_META },
  { label: "7 hidden plain", tool: "iris_doc_delete", args: DOCUMENT },
  { label: "7 hidden smuggled", tool: "iris_doc_delete", args: DOCUMENT, meta: SMUGGLED_META },
];

// -- the literals, captured by running the legacy build on this fixture --------------------------------------------------------------

const SAMPLE_DOCUMENT = {
  name: "Demo.Sample.cls",
  db: "HSCUSTOM",
  ts: "2026-01-01 00:00:00.000",
  upd: false,
  cat: "CLS",
  status: "",
  enc: false,
  flags: 0,
  content: ["Class Demo.Sample Extends %RegisteredObject", "{", "Method A()", "{", "}", "}"],
};

const DOC_GET_A = "GET /api/atelier/v8/HSCUSTOM/doc/Demo.Sample.cls";
const DOC_GET_B = "GET /api/atelier/v8/USER/doc/Demo.Sample.cls";

const UNKNOWN_PROFILE_TEXT =
  'Unknown server profile "nope". Valid profiles: default, other. Set IRIS_PROFILES to define additional profiles, or omit the server name to use "default".';

const DENIAL_RESULT = {
  content: [{ type: "text", text: "action 'iris_env_promote:execute' is disabled by governance policy for server 'default'" }],
  structuredContent: { code: "GOVERNANCE_DISABLED", action: "iris_env_promote:execute", server: "default" },
  isError: true,
};

const SCHEMA_INVALID_TEXT = `MCP error -32602: Input validation error: Invalid arguments for tool iris_doc_get: ${JSON.stringify(
  [{ expected: "string", code: "invalid_type", path: ["name"], message: "Invalid input: expected string, received number" }],
  null,
  2,
)}`;

const NOT_FOUND_RESULT = { content: [{ type: "text", text: "MCP error -32602: Tool iris_doc_delete not found" }], isError: true };

const DOC_GET_RESULT = {
  content: [{ type: "text", text: JSON.stringify(SAMPLE_DOCUMENT, null, 2) }],
  structuredContent: SAMPLE_DOCUMENT,
};

const AUDIT_DEFAULTS = { serverPkg: "@iris-mcp/dev", action: null, profileSource: "env" };

/** The audit entries of the main session, after the `sessionStart` line. */
const EXPECTED_MAIN_AUDIT = [
  { ...AUDIT_DEFAULTS, seq: 1, tool: "iris_doc_get", profile: "default", namespace: "HSCUSTOM", outcome: "ok", paramKeys: ["name"], params: DOCUMENT },
  { ...AUDIT_DEFAULTS, seq: 2, tool: "iris_doc_get", profile: "default", namespace: "HSCUSTOM", outcome: "ok", paramKeys: ["name"], params: DOCUMENT },
  {
    ...AUDIT_DEFAULTS,
    seq: 3,
    tool: "iris_doc_get",
    profile: "other",
    namespace: "USER",
    outcome: "ok",
    paramKeys: ["name", "namespace"],
    params: { ...DOCUMENT, namespace: "USER", server: "other" },
  },
  {
    serverPkg: "@iris-mcp/dev",
    seq: 4,
    tool: "iris_doc_get",
    action: null,
    profile: "nope",
    namespace: "",
    outcome: "error",
    paramKeys: ["name"],
    params: { ...DOCUMENT, server: "nope" },
    error: UNKNOWN_PROFILE_TEXT,
  },
  {
    ...AUDIT_DEFAULTS,
    seq: 5,
    tool: "iris_env_promote",
    action: "execute",
    profile: "default",
    namespace: "HSCUSTOM",
    outcome: "denied",
    paramKeys: ["action", "source", "target"],
    params: DENIAL,
    denyReason: "GOVERNANCE_DISABLED",
  },
  {
    ...AUDIT_DEFAULTS,
    seq: 6,
    tool: "iris_env_promote",
    action: "execute",
    profile: "default",
    namespace: "HSCUSTOM",
    outcome: "denied",
    paramKeys: ["action", "source", "target"],
    params: DENIAL,
    denyReason: "GOVERNANCE_DISABLED",
  },
  { ...AUDIT_DEFAULTS, seq: 7, tool: "iris_doc_get", profile: "default", namespace: "HSCUSTOM", outcome: "error", paramKeys: ["name"], error: SCHEMA_INVALID_TEXT },
];

// -- the sessions --------------------------------------------------------------------------------------------------------------------

/** Run `steps` on one era against the dev dist and the two listeners, and record what each did. */
async function runSession(era: Era, extraEnv: Record<string, string>, steps: Step[], directory: string, minimumAudit: number): Promise<SessionRecord> {
  const bootstrapVersion = readBootstrapVersion(REPO_ROOT);
  const a = await startFakeIris({ bootstrapVersion });
  const b = await startFakeIris({ bootstrapVersion });
  const auditFile = path.join(directory, `audit-${era}-${minimumAudit}.jsonl`);
  const wire = openRawWire({
    entry: distEntry(REPO_ROOT, PKG),
    env: {
      ...inheritedGoldenEnv(process.env),
      ...CLOSED_PORT_ENV,
      IRIS_PORT: String(a.port),
      IRIS_PROFILES: JSON.stringify({ other: { host: "127.0.0.1", port: b.port, username: "qa", password: "qa", namespace: "HSCUSTOM" } }),
      IRIS_AUDIT_LOG: auditFile,
      IRIS_AUDIT_LOG_PARAMS: "true",
      ...extraEnv,
    },
  });
  try {
    if (era === "modern") await discoverHandshake(wire, "story-43-2-chokepoint");
    else await handshake(wire, WIRE_ERA, "story-43-2-chokepoint");
    const envelope = modernEnvelope("story-43-2-chokepoint");
    const records = new Map<string, StepRecord>();
    for (const step of steps) {
      const beforeA = a.requests.length;
      const beforeB = b.requests.length;
      const method = step.method ?? "tools/call";
      const params: Record<string, unknown> = {
        ...(step.tool !== undefined ? { name: step.tool, arguments: step.args } : {}),
        ...(step.meta !== undefined ? { _meta: step.meta } : {}),
      };
      const frame = await wire.request(method, era === "modern" ? withEnvelope(params, envelope) : params);
      const parsed = JSON.parse(frame.line) as { result?: unknown; error?: unknown };
      // The legacy `tools/list` keeps `execution` and the modern one has lost it: that is the one difference the eras may have.
      const stripped = (era === "modern" ? withoutMandatedFields(method, parsed) : withoutExecution(parsed)) as { result?: unknown; error?: unknown };
      records.set(step.label, {
        response: stripped.result ?? stripped.error,
        a: a.requests.slice(beforeA).map((request: { method: string; url: string }) => `${request.method} ${request.url}`),
        b: b.requests.slice(beforeB).map((request: { method: string; url: string }) => `${request.method} ${request.url}`),
      });
    }
    const entries = (await settledAuditEntries(auditFile, minimumAudit)) as Array<Record<string, unknown>>;
    return { steps: records, audit: withSessionVersion(entries.map(normalizeAuditEntry), packageVersion(REPO_ROOT, PKG)) };
  } finally {
    await wire.close();
    await a.close();
    await b.close();
  }
}

const sessionStart = (): Record<string, unknown> => ({ type: "sessionStart", serverPkg: "@iris-mcp/dev", version: packageVersion(REPO_ROOT, PKG) });

let workDir: string;
const main = new Map<Era, SessionRecord>();
const core = new Map<Era, SessionRecord>();

beforeAll(async () => {
  const stale = ["shared", PKG].map((name) => [name, staleDistReason(REPO_ROOT, name)] as const).filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([name, reason]) => `${name}: ${reason}`).join("; ")}`);
  workDir = mkdtempSync(path.join(tmpdir(), "story-43-2-chokepoint-"));
  for (const era of ["legacy", "modern"] as const) {
    main.set(era, await runSession(era, {}, MAIN_STEPS, workDir, 1 + MAIN_STEPS.length));
    core.set(era, await runSession(era, { IRIS_TOOLS_PRESET: "core" }, CORE_STEPS, workDir, 1));
  }
}, 240_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

const step = (sessions: Map<Era, SessionRecord>, era: Era, label: string): StepRecord => sessions.get(era)!.steps.get(label)!;

describe.each(["legacy", "modern"] as const)("the chokepoint on the %s era", (era) => {
  it("call 1: reaches the default profile's listener, in HSCUSTOM, with the document", () => {
    expect(step(main, era, "1 plain")).toEqual({ response: DOC_GET_RESULT, a: [DOC_GET_A], b: [] });
  });

  it("call 2: _meta carrying server, namespace, profile, governance, visible and clientCapabilities changes nothing - it is call 1 again", () => {
    expect(step(main, era, "2 smuggled")).toEqual({ response: DOC_GET_RESULT, a: [DOC_GET_A], b: [] });
    expect(step(main, era, "2 smuggled")).toEqual(step(main, era, "1 plain"));
  });

  it("call 3: server other and namespace USER reach listener B at /v8/USER/, and nothing reaches A", () => {
    const seen = step(main, era, "3 other profile and namespace");
    expect(seen.response).toEqual(DOC_GET_RESULT);
    expect(seen.a).toEqual([]);
    expect(seen.b.at(-1)).toBe(DOC_GET_B);
    expect(seen.b.filter((request) => request.includes("/doc/"))).toEqual([DOC_GET_B]);
  });

  it("call 4: an unknown profile is the in-band result, and nothing reaches IRIS", () => {
    expect(step(main, era, "4 unknown profile")).toEqual({
      response: { content: [{ type: "text", text: UNKNOWN_PROFILE_TEXT }], isError: true },
      a: [],
      b: [],
    });
  });

  it("call 5: iris_env_promote:execute is denied by governance with or without _meta that tries to enable it, and nothing reaches IRIS", () => {
    for (const label of ["5 denial plain", "5 denial smuggled"]) {
      expect(step(main, era, label), label).toEqual({ response: DENIAL_RESULT, a: [], b: [] });
    }
  });

  it("call 6: a schema-invalid call is the validation result, and nothing reaches IRIS", () => {
    expect(step(main, era, "6 schema-invalid")).toEqual({
      response: { content: [{ type: "text", text: SCHEMA_INVALID_TEXT }], isError: true },
      a: [],
      b: [],
    });
  });

  it("the audit trail holds one entry per call (the DW-579 entry for call 6, no params) after the session line", () => {
    const audit = main.get(era)!.audit;
    expect(audit[0]).toEqual(sessionStart());
    expect(audit.slice(1)).toEqual(EXPECTED_MAIN_AUDIT);
    expect(Object.prototype.hasOwnProperty.call(audit.at(-1)!, "params")).toBe(false);
  });

  it("call 7: under the core preset, tools/list returns the 15 core tools, and a hidden tool is not found, with or without _meta { visible: true }", () => {
    const golden = JSON.parse(readFileSync(path.join(REPO_ROOT, GOLDEN_RELATIVE_PATH), "utf8")) as {
      servers: Record<string, { sessions: Record<string, { rows: Array<{ label: string; line: string }> }> }>;
    };
    const coreRow = golden.servers[PKG]!.sessions["core-preset"]!.rows.find((row) => row.label === "tools-list")!;
    const coreNames = (JSON.parse(coreRow.line) as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name);
    expect(coreNames).toHaveLength(15);
    const listed = (step(core, era, "7 tools-list").response as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
    expect(listed).toEqual(coreNames);
    expect(step(core, era, "7 tools-list smuggled"), "_meta { visible: true } lists no hidden tool").toEqual(step(core, era, "7 tools-list"));
    for (const label of ["7 hidden plain", "7 hidden smuggled"]) {
      expect(step(core, era, label), label).toEqual({ response: NOT_FOUND_RESULT, a: [], b: [] });
    }
    expect(core.get(era)!.audit, "the hidden tool is never audited").toEqual([sessionStart()]);
  });
});

describe("both eras are equal, call for call", () => {
  it("every main call records the same response, the same requests to each listener, and the same audit entries", () => {
    for (const { label } of MAIN_STEPS) {
      expect(step(main, "modern", label), label).toEqual(step(main, "legacy", label));
    }
    expect(main.get("modern")!.audit).toEqual(main.get("legacy")!.audit);
  });

  it("every core-preset call records the same response and the same audit entries", () => {
    for (const { label } of CORE_STEPS) {
      expect(step(core, "modern", label), label).toEqual(step(core, "legacy", label));
    }
    expect(core.get("modern")!.audit).toEqual(core.get("legacy")!.audit);
  });
});
