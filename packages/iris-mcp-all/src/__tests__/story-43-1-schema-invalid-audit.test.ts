/**
 * Story 43.1, DW-579 (AD-3, AD-19; project rules #36, #59) - a schema-invalid `tools/call` is audited.
 *
 * On the SDK v1 line the SDK rejected such a call before it reached the audited chokepoint, so no entry was written. The framework now
 * validates the arguments inside the audit wrapper, so the refused call writes its one entry. This test starts the BUILT dev server
 * over stdio against a closed local port (no IRIS instance is reached), with `IRIS_AUDIT_LOG` and `IRIS_AUDIT_LOG_PARAMS=true`, and
 * reads the audit file as an operator would. The fail-never-skip contract: a missing client or a stale dist is a failure.
 *
 * The invalid call's entry carries `outcome` `error`, the schema-invalid text as `error`, the raw top-level key names (minus `server`)
 * as `paramKeys`, and NO `params` key even with parameter logging on, because a refusal records no value (AD-19). A valid call's entry
 * keeps its shape, and an unknown tool writes none.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import {
  type AuditedSession,
  type IrisTarget,
  distEntry,
  openAuditedSession,
  pollAuditEntries,
  resolveSdkEsmDir,
  settledAuditCount,
  staleDistReason,
} from "./process-gate-helpers.js";

const CLOSED_TARGET: IrisTarget = { host: "127.0.0.1", port: "1", username: "qa", password: "qa", namespace: "HSCUSTOM" };

let tempDir: string;
let audited: AuditedSession;

beforeAll(async () => {
  const sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
  if (!sdkEsmDir) throw new Error("Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install.");
  const stale = ["shared", "iris-dev-mcp"].map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const).filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);
  tempDir = mkdtempSync(path.join(tmpdir(), "story-43-1-audit-"));
  audited = await openAuditedSession({
    sdkEsmDir,
    entry: distEntry(REPO_ROOT, "iris-dev-mcp"),
    target: CLOSED_TARGET,
    clientName: "story-43-1-schema-invalid-audit",
    auditFile: path.join(tempDir, "audit.jsonl"),
  });
}, 60_000);

afterAll(async () => {
  await audited?.session.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe("DW-579: the audit entry of a schema-invalid tools/call (Story 43.1)", () => {
  it("writes exactly one entry for the invalid call and one for the valid call, and none for an unknown tool", async () => {
    const { session, auditFile } = audited;
    const unknown = await session.raw("no_such_tool", {});
    expect(unknown.isError).toBe(true);
    const invalid = await session.raw("iris_doc_get", { server: "default", namespace: "HSCUSTOM", name: 12345 });
    expect(invalid.isError).toBe(true);
    const invalidText = invalid.content?.[0]?.text ?? "";
    expect(invalidText.startsWith("MCP error -32602: Input validation error: Invalid arguments for tool iris_doc_get: ")).toBe(true);
    const valid = await session.raw("iris_server_profiles", {});
    expect(valid.isError).toBeFalsy();

    const entries = (await pollAuditEntries(auditFile, {
      count: 2,
      isWanted: (entry) => typeof entry["tool"] === "string",
      returnAll: true,
      intervalMs: 50,
      timeoutMs: 10_000,
      excerpt: 2000,
    })).filter((entry) => typeof entry["tool"] === "string");
    // The server writes an entry after it has sent the reply: wait until the file stops growing, then count.
    expect(await settledAuditCount(auditFile), "the session line, the invalid call and the valid call").toBe(3);
    expect(entries).toHaveLength(2);

    const [refused, ok] = entries as [Record<string, unknown>, Record<string, unknown>];
    expect(refused).toMatchObject({
      tool: "iris_doc_get",
      action: null,
      profile: "default",
      namespace: "HSCUSTOM",
      outcome: "error",
      error: invalidText,
    });
    expect([...(refused["paramKeys"] as string[])].sort()).toEqual(["name", "namespace"]);
    expect(refused, "no params, with IRIS_AUDIT_LOG_PARAMS=true").not.toHaveProperty("params");
    expect(refused, "no data policy").not.toHaveProperty("dataPolicy");
    expect(JSON.stringify(refused), "no submitted value").not.toContain("12345");

    expect(ok, "a valid call's entry keeps its shape").toMatchObject({
      tool: "iris_server_profiles",
      action: null,
      profile: "default",
      namespace: "HSCUSTOM",
      outcome: "ok",
      paramKeys: [],
      params: {},
    });
  }, 60_000);
});
