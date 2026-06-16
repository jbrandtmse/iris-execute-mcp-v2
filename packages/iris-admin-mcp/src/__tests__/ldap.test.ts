import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { ldapManageTool } from "../tools/ldap.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_ldap_manage ────────────────────────────────────────────

describe("iris_ldap_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── list ──────────────────────────────────────────────────────

  it("list: GETs the ldap endpoint and returns configs + count", async () => {
    const configData = [
      {
        name: "workgroup.com",
        enabled: false,
        description: "",
        ldapCACertFile: "",
      },
      {
        name: "example.org",
        enabled: true,
        description: "Corp AD",
        ldapCACertFile: "/certs/ca.pem",
      },
    ];
    mockHttp.get.mockResolvedValue(envelope(configData));

    const result = await ldapManageTool.handler({ action: "list" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/ldap",
    );
    const structured = result.structuredContent as {
      configs: typeof configData;
      count: number;
    };
    expect(structured.configs).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(structured.configs[0]?.name).toBe("workgroup.com");
    expect(result.isError).toBeUndefined();
  });

  it("list: handles an empty config list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await ldapManageTool.handler({ action: "list" }, ctx);

    const structured = result.structuredContent as {
      configs: unknown[];
      count: number;
    };
    expect(structured.configs).toEqual([]);
    expect(structured.count).toBe(0);
  });

  // ── get ───────────────────────────────────────────────────────

  it("get: GETs with the name query parameter and returns properties", async () => {
    const props = {
      name: "workgroup.com",
      description: "",
      ldapBaseDN: "DC=workgroup,DC=com",
      ldapBaseDNForGroups: "DC=workgroup,DC=com",
      ldapHostNames: "ad.workgroup.com",
      ldapSearchUsername: "svc-search",
      ldapClientTimeout: 180,
      ldapServerTimeout: 60,
      ldapUniqueDNIdentifier: "sAMAccountName",
      ldapFlags: 25,
      ldapCACertFile: "",
    };
    mockHttp.get.mockResolvedValue(envelope(props));

    const result = await ldapManageTool.handler(
      { action: "get", name: "workgroup.com" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/ldap?name=workgroup.com",
    );
    const structured = result.structuredContent as typeof props;
    expect(structured.name).toBe("workgroup.com");
    expect(structured.ldapFlags).toBe(25);
    expect(result.isError).toBeUndefined();
  });

  // ── password redaction (AC 15.2.4) ────────────────────────────

  it("get: never surfaces a bind password — none is present in the response shape", async () => {
    // The server omits LDAPSearchPassword entirely; assert the tool passes the
    // redacted shape straight through and that no password-shaped key leaks.
    const props = {
      name: "workgroup.com",
      ldapSearchUsername: "svc-search",
      ldapBaseDN: "DC=workgroup,DC=com",
      ldapFlags: 25,
    };
    mockHttp.get.mockResolvedValue(envelope(props));

    const result = await ldapManageTool.handler(
      { action: "get", name: "workgroup.com" },
      ctx,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).not.toHaveProperty("ldapSearchPassword");
    expect(structured).not.toHaveProperty("LDAPSearchPassword");
    // Defense in depth: the serialized text carries no password key either.
    const text = result.content[0]?.text ?? "";
    expect(text.toLowerCase()).not.toContain("password");
  });

  // ── test (config-validity, AC 15.2.5) ─────────────────────────

  it("test: GETs with name + test=1 and returns the validity result", async () => {
    const testResult = {
      action: "test",
      name: "workgroup.com",
      valid: true,
      checkType: "config-validity",
      note: "IRIS exposes no high-level LDAP connection-test API; this is a non-mutating config-validity check, not a live bind.",
      issues: [],
    };
    mockHttp.get.mockResolvedValue(envelope(testResult));

    const result = await ldapManageTool.handler(
      { action: "test", name: "workgroup.com" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/ldap?name=workgroup.com&test=1",
    );
    const structured = result.structuredContent as typeof testResult;
    expect(structured.valid).toBe(true);
    expect(structured.checkType).toBe("config-validity");
    expect(result.isError).toBeUndefined();
  });

  // ── create / modify / delete ──────────────────────────────────

  it("create: POSTs action+name+settings and returns the structured result", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "newconf", success: true }),
    );

    const settings = {
      ldapBaseDN: "DC=new,DC=com",
      ldapBaseDNForGroups: "DC=new,DC=com",
      ldapSearchUsername: "svc",
      ldapSearchPassword: "s3cr3t-bind-pw",
      ldapHostNames: "ldap.new.com",
    };
    const result = await ldapManageTool.handler(
      { action: "create", name: "newconf", settings },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/ldap",
      { action: "create", name: "newconf", settings },
    );
    const structured = result.structuredContent as {
      action: string;
      success: boolean;
    };
    expect(structured.action).toBe("created");
    expect(structured.success).toBe(true);
    // The success envelope never echoes the bind password back.
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("s3cr3t-bind-pw");
  });

  it("modify: POSTs the settings object alongside action+name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "modified", name: "workgroup.com", success: true }),
    );

    const settings = { description: "Updated", ldapFlags: 64 };
    const result = await ldapManageTool.handler(
      { action: "modify", name: "workgroup.com", settings },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/ldap",
      { action: "modify", name: "workgroup.com", settings },
    );
    expect(result.isError).toBeUndefined();
  });

  it("delete: POSTs action+name (no settings)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "workgroup.com" }),
    );

    const result = await ldapManageTool.handler(
      { action: "delete", name: "workgroup.com" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/ldap",
      { action: "delete", name: "workgroup.com" },
    );
    const structured = result.structuredContent as { action: string };
    expect(structured.action).toBe("deleted");
  });

  // ── round-trip create → get(redacted) → modify → delete ───────

  it("round-trips create → get(redacted) → modify → delete (mocked)", async () => {
    // create
    mockHttp.post.mockResolvedValueOnce(
      envelope({ action: "created", name: "rt", success: true }),
    );
    const created = await ldapManageTool.handler(
      {
        action: "create",
        name: "rt",
        settings: {
          ldapBaseDN: "DC=rt,DC=com",
          ldapBaseDNForGroups: "DC=rt,DC=com",
          ldapSearchUsername: "svc",
          ldapSearchPassword: "pw-rt-123",
        },
      },
      ctx,
    );
    expect((created.structuredContent as { action: string }).action).toBe(
      "created",
    );

    // get — password must NOT be present
    mockHttp.get.mockResolvedValueOnce(
      envelope({
        name: "rt",
        ldapBaseDN: "DC=rt,DC=com",
        ldapSearchUsername: "svc",
        ldapFlags: 25,
      }),
    );
    const got = await ldapManageTool.handler(
      { action: "get", name: "rt" },
      ctx,
    );
    expect(got.structuredContent as Record<string, unknown>).not.toHaveProperty(
      "ldapSearchPassword",
    );

    // modify
    mockHttp.post.mockResolvedValueOnce(
      envelope({ action: "modified", name: "rt", success: true }),
    );
    const modified = await ldapManageTool.handler(
      { action: "modify", name: "rt", settings: { description: "x" } },
      ctx,
    );
    expect((modified.structuredContent as { action: string }).action).toBe(
      "modified",
    );

    // delete
    mockHttp.post.mockResolvedValueOnce(
      envelope({ action: "deleted", name: "rt" }),
    );
    const deleted = await ldapManageTool.handler(
      { action: "delete", name: "rt" },
      ctx,
    );
    expect((deleted.structuredContent as { action: string }).action).toBe(
      "deleted",
    );
  });

  // ── guards ────────────────────────────────────────────────────

  it("get: rejects a missing name without GETting", async () => {
    const result = await ldapManageTool.handler({ action: "get" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("name");
    expect(mockHttp.get).not.toHaveBeenCalled();
  });

  it("test: rejects a missing name without GETting", async () => {
    const result = await ldapManageTool.handler({ action: "test" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("name");
    expect(mockHttp.get).not.toHaveBeenCalled();
  });

  it("delete: rejects a missing name without POSTing", async () => {
    const result = await ldapManageTool.handler({ action: "delete" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("name");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("create: rejects a call with no settings (no-op guard) without POSTing", async () => {
    const result = await ldapManageTool.handler(
      { action: "create", name: "conf" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("settings");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("modify: rejects an empty settings object (no-op guard)", async () => {
    const result = await ldapManageTool.handler(
      { action: "modify", name: "conf", settings: {} },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  // ── error handling ────────────────────────────────────────────

  it("returns isError on IrisApiError, naming the config (preserves text)", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "LDAP Configuration NoSuch does not exist" }],
        "/api/executemcp/v2/security/ldap",
        "LDAP Configuration NoSuch does not exist",
      ),
    );

    const result = await ldapManageTool.handler(
      { action: "get", name: "NoSuch" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("NoSuch");
    expect(result.content[0]?.text).toContain("does not exist");
  });

  it("propagates non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      ldapManageTool.handler({ action: "list" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  // ── tool metadata ─────────────────────────────────────────────

  it("has scope SYS and is mutate-capable (readOnlyHint false)", () => {
    expect(ldapManageTool.scope).toBe("SYS");
    expect(ldapManageTool.annotations.readOnlyHint).toBe(false);
  });

  it("classifies every action in `mutates` (test=read; create/modify/delete=write)", () => {
    expect(ldapManageTool.mutates).toEqual({
      list: "read",
      get: "read",
      test: "read",
      create: "write",
      modify: "write",
      delete: "write",
    });
  });

  it("declares the action enum with all six actions", () => {
    const shape = ldapManageTool.inputSchema.shape as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = (shape.action as any)?.options;
    expect(options).toEqual([
      "list",
      "get",
      "create",
      "modify",
      "delete",
      "test",
    ]);
  });

  it("does NOT declare a reserved `server` field (framework injects it)", () => {
    const shape = ldapManageTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).not.toHaveProperty("server");
  });
});
