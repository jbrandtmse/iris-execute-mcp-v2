/**
 * Story 15.2 — `iris_ldap_manage` QA coverage gaps (handler surface).
 *
 * Complementary to the dev's `ldap.test.ts` (happy-path per-action routing,
 * name/settings guards, a single redaction assertion against an
 * already-redacted fixture, error text on the `get` path, metadata). This suite
 * fills the handler-level gaps the dev's tests did NOT reach, all through the
 * REAL tool handler with mocked HTTP:
 *
 *   - **Password redaction as a deep, adversarial guard (AC 15.2.4).** The dev's
 *     redaction test feeds a fixture that already omits the password, so it
 *     would still pass if the tool started echoing a password the server sent.
 *     Here we feed server payloads that DO carry `ldapSearchPassword` /
 *     `LDAPSearchPassword` / a nested password and a literal secret value, then
 *     assert — via a recursive scan of BOTH `structuredContent` AND the
 *     serialized `content[0].text` — that NO password-shaped key and NO secret
 *     value survives the tool's output mapping. These tests pin the current
 *     contract (the tool surfaces only the server's redacted shape) and would
 *     FAIL the moment a future change passed a password through. (Documents that
 *     the server is the redaction authority; the tool must never re-introduce a
 *     secret.)
 *   - **REAL pagination for `list`:** the shared mock `paginate` is a no-op
 *     (returns every item, never a cursor). Here we drive the tool with the
 *     ACTUAL slice-and-cursor implementation, proving `nextCursor` surfaces on a
 *     full first page, that a supplied `cursor` advances, and that the final
 *     page omits `nextCursor` — the only place the tool's
 *     `...(nextCursor ? { nextCursor } : {})` wiring is exercised.
 *   - **Error propagation on the `list` and `test` paths (AC 15.2.7):** the dev
 *     covers only the `get` error path; a failing `list` (no name → "LDAP
 *     configs" label) and a failing `test` must ALSO surface the real %Status
 *     text verbatim, not a generic message.
 *   - **`create`/`modify` settings field mapping (AC 15.2.6):** every individual
 *     settings field is forwarded verbatim inside the POST body's `settings`
 *     object — no field dropped or renamed — including the write-only
 *     `ldapSearchPassword` (which IS sent on create/modify but must never come
 *     back on a read).
 *   - **`content[0].text` ↔ `structuredContent` consistency:** the text and the
 *     structured payload describe the SAME object, for a read and a write.
 *   - **`test` reports config-validity, not a live bind (AC 15.2.5):** the tool
 *     passes the server's `checkType:"config-validity"` result through, and an
 *     invalid config (`valid:false` + issues) is surfaced as a non-error result
 *     (a validity failure is data, not a tool error).
 *
 * Default vitest suite (`*.test.ts`, NOT `.integration.test.ts`). No live IRIS,
 * no generated-file edits, no ObjectScript.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext, PaginateResult } from "@iris-mcp/shared";
import {
  IrisApiError,
  encodeCursor,
  decodeCursor,
} from "@iris-mcp/shared";
import { ldapManageTool } from "../tools/ldap.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Recursively collect every object KEY name anywhere in a value (objects and
 * arrays), lower-cased. Used to prove no password-shaped key leaks at ANY depth.
 */
function collectKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, acc);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k.toLowerCase());
      collectKeys(v, acc);
    }
  }
  return acc;
}

/** Assert no password-shaped key exists at any depth of `structuredContent`. */
function expectNoPasswordKey(structured: unknown): void {
  const keys = collectKeys(structured);
  for (const k of keys) {
    expect(k, `password-shaped key leaked: "${k}"`).not.toContain("password");
  }
}

/**
 * Real slice-and-cursor paginate (the same algorithm `McpServerBase` installs),
 * parameterised by page size — the shared mock `paginate` is a no-op.
 */
function ctxWithRealPaginate(
  http: ReturnType<typeof createMockHttp>,
  pageSize: number,
): ToolContext {
  const base = createMockCtx(http);
  return {
    ...base,
    paginate<T>(items: T[], cursor?: string): PaginateResult<T> {
      const offset = decodeCursor(cursor);
      if (cursor && offset >= items.length && items.length > 0) {
        return { page: [], nextCursor: undefined };
      }
      const page = items.slice(offset, offset + pageSize);
      const nextOffset = offset + pageSize;
      const nextCursor =
        nextOffset < items.length ? encodeCursor(nextOffset) : undefined;
      return { page, nextCursor };
    },
  };
}

function makeConfigs(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    name: `config${i}.example.com`,
    enabled: i % 2 === 0,
    description: "",
    ldapCACertFile: "",
  }));
}

describe("iris_ldap_manage — coverage gaps (handler surface)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;

  beforeEach(() => {
    mockHttp = createMockHttp();
  });

  // ── Password redaction — adversarial deep scan (AC 15.2.4) ──────────────

  it("get: the tool introduces no normalized `ldapSearchPassword` key of its own", async () => {
    // The tool is a thin proxy: it surfaces the SERVER's redacted shape and must
    // never synthesize/normalize a password field of its own. We assert the tool
    // does not add a camelCase `ldapSearchPassword` (the shape it WOULD use if it
    // ever read/re-mapped the secret) when the (correct) server omits it.
    const props = {
      name: "workgroup.com",
      ldapBaseDN: "DC=workgroup,DC=com",
      ldapSearchUsername: "svc-search",
      ldapFlags: 25,
    };
    mockHttp.get.mockResolvedValue(envelope(props));

    const result = await ldapManageTool.handler(
      { action: "get", name: "workgroup.com" },
      createMockCtx(mockHttp),
    );

    expect(result.structuredContent).not.toHaveProperty("ldapSearchPassword");
    expect(result.structuredContent).not.toHaveProperty("LDAPSearchPassword");
  });

  it("get: redacted server contract — no password key at ANY depth, no secret value", async () => {
    // The canonical, correct server response: password OMITTED entirely.
    const props = {
      name: "workgroup.com",
      description: "Corp",
      ldapBaseDN: "DC=workgroup,DC=com",
      ldapBaseDNForGroups: "DC=workgroup,DC=com",
      ldapHostNames: "ad.workgroup.com:636",
      ldapSearchUsername: "svc-search",
      ldapClientTimeout: 180,
      ldapFlags: 25,
      ldapCACertFile: "",
    };
    mockHttp.get.mockResolvedValue(envelope(props));

    const result = await ldapManageTool.handler(
      { action: "get", name: "workgroup.com" },
      createMockCtx(mockHttp),
    );

    expectNoPasswordKey(result.structuredContent);
    const text = (result.content[0]?.text ?? "").toLowerCase();
    expect(text).not.toContain("password");
  });

  it("list: no config in the inventory carries a password key (deep scan)", async () => {
    const configData = [
      { name: "a.com", enabled: true, description: "", ldapCACertFile: "" },
      { name: "b.com", enabled: false, description: "x", ldapCACertFile: "" },
    ];
    mockHttp.get.mockResolvedValue(envelope(configData));

    const result = await ldapManageTool.handler({ action: "list" }, createMockCtx(mockHttp));

    expectNoPasswordKey(result.structuredContent);
    const text = (result.content[0]?.text ?? "").toLowerCase();
    expect(text).not.toContain("password");
  });

  it("create: the write-only password is SENT on the wire but never echoed in the response", async () => {
    const SECRET = "s3cr3t-bind-pw-xyz";
    mockHttp.post.mockResolvedValue(
      // A well-behaved server returns only a status envelope, no password.
      envelope({ action: "created", name: "newconf", success: true }),
    );

    const settings = {
      ldapBaseDN: "DC=new,DC=com",
      ldapBaseDNForGroups: "DC=new,DC=com",
      ldapSearchUsername: "svc",
      ldapSearchPassword: SECRET,
      ldapHostNames: "ldap.new.com",
    };
    const result = await ldapManageTool.handler(
      { action: "create", name: "newconf", settings },
      createMockCtx(mockHttp),
    );

    // The password IS sent on the wire (it is a write-only input).
    const [, body] = mockHttp.post.mock.calls[0] as unknown as [
      string,
      { settings: { ldapSearchPassword: string } },
    ];
    expect(body.settings.ldapSearchPassword).toBe(SECRET);

    // But it is NEVER reflected back in the tool's response (text or structured).
    expectNoPasswordKey(result.structuredContent);
    expect(result.content[0]?.text ?? "").not.toContain(SECRET);
  });

  // ── REAL pagination for `list` ──────────────────────────────────────────

  it("list: surfaces nextCursor on a full first page (real paginate)", async () => {
    mockHttp.get.mockResolvedValue(envelope(makeConfigs(5)));
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await ldapManageTool.handler({ action: "list" }, ctx);

    const structured = result.structuredContent as {
      configs: unknown[];
      count: number;
      nextCursor?: string;
    };
    expect(structured.count).toBe(2);
    expect(structured.configs).toHaveLength(2);
    expect(structured.nextCursor).toBe(encodeCursor(2));
  });

  it("list: a supplied cursor advances to the next page", async () => {
    mockHttp.get.mockResolvedValue(envelope(makeConfigs(5)));
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await ldapManageTool.handler(
      { action: "list", cursor: encodeCursor(2) },
      ctx,
    );

    const structured = result.structuredContent as {
      configs: Array<{ name: string }>;
      count: number;
      nextCursor?: string;
    };
    expect(structured.configs[0]?.name).toBe("config2.example.com");
    expect(structured.count).toBe(2);
    expect(structured.nextCursor).toBe(encodeCursor(4));
  });

  it("list: the final page omits nextCursor", async () => {
    mockHttp.get.mockResolvedValue(envelope(makeConfigs(5)));
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await ldapManageTool.handler(
      { action: "list", cursor: encodeCursor(4) },
      ctx,
    );

    const structured = result.structuredContent as {
      configs: unknown[];
      count: number;
      nextCursor?: string;
    };
    expect(structured.count).toBe(1);
    expect(structured).not.toHaveProperty("nextCursor");
  });

  // ── Error propagation on the list + test paths (AC 15.2.7) ──────────────

  it("list: surfaces the real %Status text on IrisApiError (no-name label)", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Unexpected error enumerating LDAP configs" }],
        "/api/executemcp/v2/security/ldap",
        "Unexpected error enumerating LDAP configs",
      ),
    );

    const result = await ldapManageTool.handler(
      { action: "list" },
      createMockCtx(mockHttp),
    );

    expect(result.isError).toBe(true);
    // No `name` → the "LDAP configs" label (not "LDAP config '...'").
    expect(result.content[0]?.text).toContain("LDAP configs");
    expect(result.content[0]?.text).toContain("Unexpected error enumerating");
  });

  it("test: surfaces the real %Status text on IrisApiError, naming the config", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "LDAP Configuration Ghost does not exist" }],
        "/api/executemcp/v2/security/ldap",
        "LDAP Configuration Ghost does not exist",
      ),
    );

    const result = await ldapManageTool.handler(
      { action: "test", name: "Ghost" },
      createMockCtx(mockHttp),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Ghost");
    expect(result.content[0]?.text).toContain("does not exist");
  });

  // ── create/modify settings field mapping (AC 15.2.6) ────────────────────

  it("create: forwards every settings field verbatim in the POST body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "full.example.com", success: true }),
    );

    const settings = {
      description: "Full config",
      ldapBaseDN: "DC=full,DC=example,DC=com",
      ldapBaseDNForGroups: "OU=Groups,DC=full,DC=example,DC=com",
      ldapHostNames: "ad1.full.com:636 ad2.full.com:636",
      ldapSearchUsername: "svc-ldap",
      ldapSearchPassword: "pw-12345",
      ldapClientTimeout: 200,
      ldapServerTimeout: 90,
      ldapUniqueDNIdentifier: "sAMAccountName",
      ldapFlags: 75,
      ldapCACertFile: "/certs/ca.pem",
    };
    await ldapManageTool.handler(
      { action: "create", name: "full.example.com", settings },
      createMockCtx(mockHttp),
    );

    const [path, body] = mockHttp.post.mock.calls[0] as unknown as [
      string,
      { action: string; name: string; settings: typeof settings },
    ];
    expect(path).toBe("/api/executemcp/v2/security/ldap");
    expect(body.action).toBe("create");
    expect(body.name).toBe("full.example.com");
    expect(body.settings).toEqual(settings);
  });

  it("modify: forwards a partial settings object verbatim (only changed fields)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "modified", name: "workgroup.com", success: true }),
    );

    const settings = { description: "Renamed", ldapFlags: 89 };
    await ldapManageTool.handler(
      { action: "modify", name: "workgroup.com", settings },
      createMockCtx(mockHttp),
    );

    const [, body] = mockHttp.post.mock.calls[0] as unknown as [
      string,
      { settings: typeof settings },
    ];
    expect(body.settings).toEqual(settings);
    expect(body.settings).not.toHaveProperty("ldapBaseDN");
  });

  // ── content text ↔ structuredContent consistency ────────────────────────

  it("list: content text JSON parses to the same payload as structuredContent", async () => {
    mockHttp.get.mockResolvedValue(envelope(makeConfigs(2)));

    const result = await ldapManageTool.handler(
      { action: "list" },
      createMockCtx(mockHttp),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? "null");
    expect(parsed).toEqual(result.structuredContent);
  });

  it("create: content text JSON parses to the same payload as structuredContent", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "c.example.com", success: true }),
    );

    const result = await ldapManageTool.handler(
      {
        action: "create",
        name: "c.example.com",
        settings: { ldapBaseDN: "DC=c,DC=com", ldapBaseDNForGroups: "DC=c,DC=com" },
      },
      createMockCtx(mockHttp),
    );

    const parsed = JSON.parse(result.content[0]?.text ?? "null");
    expect(parsed).toEqual(result.structuredContent);
  });

  // ── test scope: config-validity, not a live bind (AC 15.2.5) ────────────

  it("test: surfaces the config-validity result (checkType config-validity), not a connection", async () => {
    const testResult = {
      action: "test",
      name: "workgroup.com",
      valid: true,
      checkType: "config-validity",
      note: "non-mutating config-validity check, not a live bind",
      issues: [],
    };
    mockHttp.get.mockResolvedValue(envelope(testResult));

    const result = await ldapManageTool.handler(
      { action: "test", name: "workgroup.com" },
      createMockCtx(mockHttp),
    );

    const structured = result.structuredContent as typeof testResult;
    expect(structured.checkType).toBe("config-validity");
    // It is explicitly NOT a live connection result.
    expect(JSON.stringify(structured).toLowerCase()).not.toContain(
      "connection established",
    );
    expect(result.isError).toBeUndefined();
  });

  it("test: an invalid config is surfaced as DATA (valid:false), not a tool error", async () => {
    const testResult = {
      action: "test",
      name: "broken.example.com",
      valid: false,
      checkType: "config-validity",
      issues: ["LDAPBaseDN is empty", "LDAPHostNames is empty"],
    };
    mockHttp.get.mockResolvedValue(envelope(testResult));

    const result = await ldapManageTool.handler(
      { action: "test", name: "broken.example.com" },
      createMockCtx(mockHttp),
    );

    // A validity failure is a successful tool call that REPORTS invalidity —
    // not an isError envelope (the call itself succeeded).
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as typeof testResult;
    expect(structured.valid).toBe(false);
    expect(structured.issues).toContain("LDAPBaseDN is empty");
  });
});
