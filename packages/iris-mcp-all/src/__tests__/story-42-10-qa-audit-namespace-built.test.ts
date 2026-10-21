/**
 * Story 42.10 QA (AC 42.10.5 and the decision #41 item, DW-654 and DW-667; AD-3, AD-19; project rules #34 and #59) - the audit `namespace`
 * and `targetNamespace` that the BUILT servers write, on the real stdio wire.
 *
 * The unit tests pin `deriveAuditNamespace` with synthetic tools, the handler golden pins the entry of one ok call of one real SYS-scoped
 * tool, and the 43.3 gates pin the entries of `iris_audit_manage`. None of them drives a real SYS-scoped tool that is given a `namespace`
 * argument, a denied or schema-invalid call of a real SYS-scoped tool, or a real BOTH-, NONE- or NS-scoped tool that is given one. This
 * file does, for each scope, against the built servers and the in-process fake IRIS (`scripts/lib/fake-iris-listener.mjs`; 127.0.0.1 only,
 * no IRIS instance), with `IRIS_AUDIT_LOG` set and `IRIS_AUDIT_LOG_PARAMS` unset:
 *  - SYS (admin): an ok call without and with a `namespace` argument, a denied call, a schema-invalid call and a call whose handler fails
 *    all record `"%SYS"`; a call that has the argument also records it as `targetNamespace` (and still names it in `paramKeys`), and a
 *    call without it has no `targetNamespace` key;
 *  - BOTH (admin `iris_webapp_list`), NONE (ops `iris_database_action`) and NS (dev, interop, data): the entry records the call's
 *    `namespace` argument, else the profile's default (`HSCUSTOM`), as it did before Story 42.10, for an ok call and for a schema-invalid
 *    call, and never has a `targetNamespace` key.
 * Entries are matched on the members this story owns, so a member that a later story adds to an entry does not fail them. The file fails,
 * never skips, when a dist it runs is missing or older than its source. Needs no IRIS.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./pack-fixture";
import { startFakeIris } from "../../../../scripts/lib/fake-iris-listener.mjs";
import { CLOSED_PORT_ENV, WIRE_ERA, handshake, inheritedGoldenEnv, openRawWire } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { normalizeAuditEntry, readBootstrapVersion, settledAuditEntries } from "../../../../scripts/lib/sdk-handler-golden-core.mjs";
import { distEntry } from "./process-gate-helpers.js";
import { requireFreshDists } from "./story-43-3-qa-wire.js";

type Entry = Record<string, unknown>;

/** One `tools/call` of a session; `label` names its entry in the result. */
interface Call {
  label: string;
  tool: string;
  args: Record<string, unknown>;
}

/** Enables the one gated write the admin session needs: an audit purge, which is off by default. */
const PURGE_ENABLED = JSON.stringify({ global: { "iris_audit_manage:purge": true } });

/** A bounded purge: the tool refuses an unbounded one before it asks IRIS. */
const PURGE = { action: "purge", end: "2026-01-01 00:00:00", confirm: true };

/**
 * Run `calls` in order against the built `pkg` server and a fresh fake IRIS, with auditing on, and return each call's audit entry by label
 * (without `ts`, `session` and `durationMs`). `governance` is the `IRIS_GOVERNANCE` text; omitted, the defaults apply.
 */
async function auditedSession(pkg: string, calls: Call[], governance?: string): Promise<Record<string, Entry>> {
  const fake = await startFakeIris({ bootstrapVersion: readBootstrapVersion(REPO_ROOT) });
  const directory = mkdtempSync(join(tmpdir(), "story-42-10-qa-audit-"));
  const auditFile = join(directory, "audit.jsonl");
  const env = {
    ...inheritedGoldenEnv(process.env),
    ...CLOSED_PORT_ENV,
    IRIS_PORT: String(fake.port),
    IRIS_AUDIT_LOG: auditFile,
    ...(governance === undefined ? {} : { IRIS_GOVERNANCE: governance }),
  };
  const wire = openRawWire({ entry: distEntry(REPO_ROOT, pkg), env });
  try {
    await handshake(wire, WIRE_ERA, "story-42-10-qa-audit");
    for (const call of calls) await wire.request("tools/call", { name: call.tool, arguments: call.args });
    // The session line, then one entry per call: a denied and a schema-invalid call are audited too.
    const written = ((await settledAuditEntries(auditFile, 1 + calls.length)) as Entry[]).filter((entry) => entry["type"] !== "sessionStart");
    expect(written.map((entry) => entry["tool"]), `${pkg}: one entry per call, in call order`).toEqual(calls.map((call) => call.tool));
    return Object.fromEntries(calls.map((call, index) => [call.label, normalizeAuditEntry(written[index]) as Entry]));
  } finally {
    await wire.close();
    await fake.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The names of an entry's parameters, sorted (the order is the schema's, which no test here pins). */
const keysOf = (entry: Entry): string[] => [...(entry["paramKeys"] as string[])].sort();

/** Whether the entry has a `targetNamespace` key at all (a key with no value would still be a key). */
const hasTarget = (entry: Entry | undefined): boolean => entry !== undefined && Object.prototype.hasOwnProperty.call(entry, "targetNamespace");

describe("a SYS-scoped tool of the built admin server records %SYS (AD-3, AD-19)", () => {
  let defaults: Record<string, Entry>;
  let purgeEnabled: Record<string, Entry>;

  beforeAll(async () => {
    requireFreshDists("iris-admin-mcp");
    defaults = await auditedSession("iris-admin-mcp", [
      { label: "ok-without-argument", tool: "iris_namespace_list", args: {} },
      { label: "denied-with-argument", tool: "iris_audit_manage", args: { ...PURGE, namespace: "USER" } },
      { label: "denied-without-argument", tool: "iris_audit_manage", args: PURGE },
      { label: "schema-invalid-with-argument", tool: "iris_mapping_manage", args: { action: "create", type: "global", namespace: "USER", name: 12345 } },
      { label: "handler-error-with-argument", tool: "iris_mapping_list", args: { namespace: "USER", type: "global" } },
    ]);
    purgeEnabled = await auditedSession(
      "iris-admin-mcp",
      [
        { label: "ok-with-argument", tool: "iris_audit_manage", args: { ...PURGE, namespace: "USER" } },
        { label: "ok-without-argument", tool: "iris_audit_manage", args: PURGE },
      ],
      PURGE_ENABLED,
    );
  }, 120_000);

  it("an ok call records %SYS, with and without a namespace argument, and keeps the argument as a parameter key", () => {
    expect(defaults["ok-without-argument"]).toMatchObject({ tool: "iris_namespace_list", outcome: "ok", namespace: "%SYS", paramKeys: [] });
    expect(purgeEnabled["ok-without-argument"]).toMatchObject({ tool: "iris_audit_manage", action: "purge", outcome: "ok", namespace: "%SYS" });
    expect(purgeEnabled["ok-with-argument"]).toMatchObject({ tool: "iris_audit_manage", action: "purge", outcome: "ok", namespace: "%SYS" });
    expect(keysOf(purgeEnabled["ok-with-argument"]!), "the argument the call carried is still named").toEqual(["action", "confirm", "end", "namespace"]);
    expect(keysOf(purgeEnabled["ok-without-argument"]!)).toEqual(["action", "confirm", "end"]);
  });

  it("a denied call records %SYS, with and without a namespace argument", () => {
    for (const label of ["denied-with-argument", "denied-without-argument"]) {
      expect(defaults[label], label).toMatchObject({ tool: "iris_audit_manage", outcome: "denied", denyReason: "GOVERNANCE_DISABLED", namespace: "%SYS" });
    }
    expect(keysOf(defaults["denied-with-argument"]!)).toContain("namespace");
    expect(keysOf(defaults["denied-without-argument"]!)).not.toContain("namespace");
  });

  it("a schema-invalid call records %SYS, whatever its namespace argument says", () => {
    const entry = defaults["schema-invalid-with-argument"]!;
    expect(entry).toMatchObject({ tool: "iris_mapping_manage", outcome: "error", namespace: "%SYS" });
    expect(String(entry["error"]).startsWith("MCP error -32602: Input validation error: Invalid arguments for tool iris_mapping_manage: ")).toBe(true);
    expect(keysOf(entry)).toEqual(["action", "name", "namespace", "type"]);
  });

  it("a call whose handler fails records %SYS, whatever its namespace argument says", () => {
    expect(defaults["handler-error-with-argument"]).toMatchObject({ tool: "iris_mapping_list", outcome: "error", namespace: "%SYS" });
    expect(keysOf(defaults["handler-error-with-argument"]!)).toEqual(["namespace", "type"]);
  });

  it("a call that has a namespace argument records it as targetNamespace on every outcome, and a call without one has no targetNamespace key (DW-667)", () => {
    const withArgument = [
      purgeEnabled["ok-with-argument"],
      defaults["denied-with-argument"],
      defaults["schema-invalid-with-argument"],
      defaults["handler-error-with-argument"],
    ];
    for (const entry of withArgument) expect(entry, String(entry?.["tool"])).toMatchObject({ namespace: "%SYS", targetNamespace: "USER" });
    const withoutArgument = { "ok iris_namespace_list": defaults["ok-without-argument"], "ok purge": purgeEnabled["ok-without-argument"], "denied purge": defaults["denied-without-argument"] };
    for (const [label, entry] of Object.entries(withoutArgument)) expect(hasTarget(entry), `${label}: no targetNamespace key`).toBe(false);
    for (const entry of withArgument) expect(entry, "parameter values stay out of the entry").not.toHaveProperty("params");
  });
});

describe("a tool that is not SYS-scoped keeps recording its namespace argument, else the profile's default (as before Story 42.10)", () => {
  let admin: Record<string, Entry>;
  let ops: Record<string, Entry>;
  let dev: Record<string, Entry>;
  let interop: Record<string, Entry>;
  let data: Record<string, Entry>;

  beforeAll(async () => {
    requireFreshDists("iris-admin-mcp", "iris-ops-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-data-mcp");
    admin = await auditedSession("iris-admin-mcp", [
      { label: "with-argument", tool: "iris_webapp_list", args: { namespace: "USER" } },
      { label: "without-argument", tool: "iris_webapp_list", args: {} },
    ]);
    ops = await auditedSession("iris-ops-mcp", [
      { label: "schema-invalid-with-argument", tool: "iris_database_action", args: { action: "mount", directory: 12345, namespace: "USER" } },
      { label: "schema-invalid-without-argument", tool: "iris_database_action", args: { action: "mount", directory: 12345 } },
    ]);
    dev = await auditedSession("iris-dev-mcp", [
      { label: "ok-with-argument", tool: "iris_doc_get", args: { name: "Demo.Sample.cls", namespace: "USER" } },
      { label: "ok-without-argument", tool: "iris_doc_get", args: { name: "Demo.Sample.cls" } },
      { label: "schema-invalid-with-argument", tool: "iris_doc_get", args: { name: 12345, namespace: "USER" } },
      { label: "schema-invalid-without-argument", tool: "iris_doc_get", args: { name: 12345 } },
    ]);
    interop = await auditedSession("iris-interop-mcp", [
      { label: "schema-invalid-with-argument", tool: "iris_production_manage", args: { action: "create", name: 12345, namespace: "USER" } },
      { label: "schema-invalid-without-argument", tool: "iris_production_manage", args: { action: "create", name: 12345 } },
    ]);
    data = await auditedSession("iris-data-mcp", [
      { label: "schema-invalid-with-argument", tool: "iris_docdb_document", args: { action: "get", database: 12345, namespace: "USER" } },
      { label: "schema-invalid-without-argument", tool: "iris_docdb_document", args: { action: "get", database: 12345 } },
    ]);
  }, 180_000);

  it("a BOTH-scoped tool (admin iris_webapp_list) records the argument, else the profile's default", () => {
    expect(admin["with-argument"]).toMatchObject({ tool: "iris_webapp_list", namespace: "USER" });
    expect(admin["without-argument"]).toMatchObject({ tool: "iris_webapp_list", namespace: "HSCUSTOM" });
    expect(keysOf(admin["with-argument"]!)).toEqual(["namespace"]);
  });

  it("a NONE-scoped tool (ops iris_database_action) records the argument, else the profile's default", () => {
    expect(ops["schema-invalid-with-argument"]).toMatchObject({ tool: "iris_database_action", outcome: "error", namespace: "USER" });
    expect(ops["schema-invalid-without-argument"]).toMatchObject({ tool: "iris_database_action", outcome: "error", namespace: "HSCUSTOM" });
  });

  it("an NS-scoped tool (dev iris_doc_get) records the argument, else the profile's default, for an ok call and a schema-invalid call", () => {
    expect(dev["ok-with-argument"]).toMatchObject({ tool: "iris_doc_get", outcome: "ok", namespace: "USER" });
    expect(dev["ok-without-argument"]).toMatchObject({ tool: "iris_doc_get", outcome: "ok", namespace: "HSCUSTOM" });
    expect(dev["schema-invalid-with-argument"]).toMatchObject({ tool: "iris_doc_get", outcome: "error", namespace: "USER" });
    expect(dev["schema-invalid-without-argument"]).toMatchObject({ tool: "iris_doc_get", outcome: "error", namespace: "HSCUSTOM" });
  });

  it("the NS-scoped tools of the interop and data servers record the same, for a schema-invalid call", () => {
    expect(interop["schema-invalid-with-argument"]).toMatchObject({ tool: "iris_production_manage", outcome: "error", namespace: "USER" });
    expect(interop["schema-invalid-without-argument"]).toMatchObject({ tool: "iris_production_manage", outcome: "error", namespace: "HSCUSTOM" });
    expect(data["schema-invalid-with-argument"]).toMatchObject({ tool: "iris_docdb_document", outcome: "error", namespace: "USER" });
    expect(data["schema-invalid-without-argument"]).toMatchObject({ tool: "iris_docdb_document", outcome: "error", namespace: "HSCUSTOM" });
  });

  it("no entry of a BOTH-, NONE- or NS-scoped tool has a targetNamespace key, with or without a namespace argument (DW-667)", () => {
    const sessions = { admin, ops, dev, interop, data };
    let seen = 0;
    for (const [server, entries] of Object.entries(sessions)) {
      for (const [label, entry] of Object.entries(entries)) {
        seen += 1;
        expect(hasTarget(entry), `${server} ${label}: no targetNamespace key`).toBe(false);
      }
    }
    expect(seen, "the sweep sees every entry of the five sessions").toBe(12);
  });
});
