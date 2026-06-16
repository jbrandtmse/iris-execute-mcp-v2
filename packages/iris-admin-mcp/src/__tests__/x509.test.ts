import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { x509ManageTool } from "../tools/x509.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_x509_manage ────────────────────────────────────────────

/**
 * Recursively collect every object key appearing at any depth of a value.
 * Used by the security deep-scan: no private-key-shaped key may ever appear in
 * the tool's output (AC 15.3.3), at any nesting level.
 */
function collectKeysDeep(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeysDeep(item, acc);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.push(k);
      collectKeysDeep(v, acc);
    }
  }
  return acc;
}

/**
 * Private-key-MATERIAL keys that must NEVER appear in any output (AC 15.3.3).
 * Note: the safe presence boolean `hasPrivateKey` is explicitly NOT forbidden —
 * it carries no key material, only a true/false flag. We forbid the exact secret
 * field names (the `%SYS.X509Credentials` private-key property set) at any depth,
 * plus any key whose name STARTS with a private-key marker (so `privateKey`,
 * `privateKeyPassword`, `privateKeyExport`, `private_key`, `privKey`, … are all
 * caught) — while `hasPrivateKey` (starts with "has") is allowed.
 */
const ALLOWED_PRESENCE_KEY = "hasprivatekey";
const FORBIDDEN_KEY_PREFIXES = ["privatekey", "private_key", "privkey"];

function assertNoPrivateKeyMaterial(result: {
  structuredContent?: unknown;
  content: Array<{ text?: string }>;
}): void {
  const keys = collectKeysDeep(result.structuredContent).map((k) =>
    k.toLowerCase(),
  );
  for (const key of keys) {
    if (key === ALLOWED_PRESENCE_KEY) continue; // safe boolean flag
    for (const prefix of FORBIDDEN_KEY_PREFIXES) {
      expect(
        key.startsWith(prefix),
        `output key '${key}' must not be a private-key field`,
      ).toBe(false);
    }
  }
  // Defense in depth: the serialized text must not carry PEM key material or a
  // raw private-key field name (the presence flag `hasPrivateKey` aside).
  const text = (result.content[0]?.text ?? "").toLowerCase();
  expect(text).not.toContain("-----begin");
  expect(text).not.toContain('"privatekey"');
  expect(text).not.toContain('"privatekeypassword"');
}

describe("iris_x509_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── list ──────────────────────────────────────────────────────

  it("list: GETs the x509 endpoint and returns credentials + count", async () => {
    const credData = [
      {
        alias: "server-cert",
        hasPrivateKey: true,
        subjectDN: "CN=server.example.com",
        issuerDN: "CN=Example CA",
        serialNumber: "01",
        thumbprint: "ab cd ef",
        subjectKeyIdentifier: "11 22 33",
        notBefore: "2025-01-01 00:00:00",
        notAfter: "2027-01-01 00:00:00",
        peerNames: "",
        caFile: "",
      },
      {
        alias: "ca-only",
        hasPrivateKey: false,
        subjectDN: "CN=Example CA",
        issuerDN: "CN=Example CA",
        serialNumber: "02",
        thumbprint: "de ad be ef",
        subjectKeyIdentifier: "",
        notBefore: "2024-01-01 00:00:00",
        notAfter: "2034-01-01 00:00:00",
        peerNames: "",
        caFile: "",
      },
    ];
    mockHttp.get.mockResolvedValue(envelope(credData));

    const result = await x509ManageTool.handler({ action: "list" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/x509",
    );
    const structured = result.structuredContent as {
      credentials: typeof credData;
      count: number;
    };
    expect(structured.credentials).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(structured.credentials[0]?.alias).toBe("server-cert");
    expect(structured.credentials[0]?.hasPrivateKey).toBe(true);
    expect(result.isError).toBeUndefined();
    // SECURITY: no private-key material anywhere in the list output.
    assertNoPrivateKeyMaterial(result);
  });

  it("list: handles an empty credential list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await x509ManageTool.handler({ action: "list" }, ctx);

    const structured = result.structuredContent as {
      credentials: unknown[];
      count: number;
    };
    expect(structured.credentials).toEqual([]);
    expect(structured.count).toBe(0);
  });

  // ── get ───────────────────────────────────────────────────────

  it("get: GETs with the alias query parameter and returns metadata", async () => {
    const props = {
      alias: "server-cert",
      hasPrivateKey: true,
      subjectDN: "CN=server.example.com",
      issuerDN: "CN=Example CA",
      serialNumber: "01",
      thumbprint: "ab cd ef",
      subjectKeyIdentifier: "11 22 33",
      notBefore: "2025-01-01 00:00:00",
      notAfter: "2027-01-01 00:00:00",
      peerNames: "",
      caFile: "",
    };
    mockHttp.get.mockResolvedValue(envelope(props));

    const result = await x509ManageTool.handler(
      { action: "get", alias: "server-cert" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/x509?alias=server-cert",
    );
    const structured = result.structuredContent as typeof props;
    expect(structured.alias).toBe("server-cert");
    expect(structured.hasPrivateKey).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  // ── NO private-key material (AC 15.3.3, security-critical) ─────

  it("get: never surfaces private-key material — deep-scan finds none", async () => {
    // Even if a (hypothetical/buggy) server leaked a private-key field, this
    // test documents the contract: the tool's output must carry no private-key
    // key at any depth. The mocked server here returns only safe metadata; the
    // assertion guards against regressions in the output mapping.
    const props = {
      alias: "server-cert",
      hasPrivateKey: true,
      subjectDN: "CN=server.example.com",
      issuerDN: "CN=Example CA",
      serialNumber: "01",
      thumbprint: "ab cd ef",
      notBefore: "2025-01-01 00:00:00",
      notAfter: "2027-01-01 00:00:00",
    };
    mockHttp.get.mockResolvedValue(envelope(props));

    const result = await x509ManageTool.handler(
      { action: "get", alias: "server-cert" },
      ctx,
    );

    assertNoPrivateKeyMaterial(result);
    // The presence flag IS surfaced (it is safe and useful).
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toHaveProperty("hasPrivateKey");
  });

  // ── import / delete ───────────────────────────────────────────

  it("import: POSTs action+alias+certificate and returns the structured result", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "imported", alias: "new-cert", success: true }),
    );

    const result = await x509ManageTool.handler(
      { action: "import", alias: "new-cert", certificate: "TUlJQg==" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/x509",
      { action: "import", alias: "new-cert", certificate: "TUlJQg==" },
    );
    const structured = result.structuredContent as {
      action: string;
      success: boolean;
    };
    expect(structured.action).toBe("imported");
    expect(structured.success).toBe(true);
    assertNoPrivateKeyMaterial(result);
  });

  it("import: forwards an optional write-only private key + password but never echoes them", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "imported", alias: "with-key", success: true }),
    );

    const secretPk = "LS0tLS1CRUdJTiالبطة";
    const secretPwd = "super-secret-pw";
    const result = await x509ManageTool.handler(
      {
        action: "import",
        alias: "with-key",
        certificate: "TUlJQg==",
        privateKey: secretPk,
        privateKeyPassword: secretPwd,
      },
      ctx,
    );

    // The request body DID carry the private key (write-only path to server).
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/x509",
      {
        action: "import",
        alias: "with-key",
        certificate: "TUlJQg==",
        privateKey: secretPk,
        privateKeyPassword: secretPwd,
      },
    );
    // But the RESPONSE never echoes the key or password back.
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain(secretPk);
    expect(text).not.toContain(secretPwd);
    assertNoPrivateKeyMaterial(result);
  });

  it("delete: POSTs action+alias (no certificate)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", alias: "old-cert" }),
    );

    const result = await x509ManageTool.handler(
      { action: "delete", alias: "old-cert" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/x509",
      { action: "delete", alias: "old-cert" },
    );
    const structured = result.structuredContent as { action: string };
    expect(structured.action).toBe("deleted");
  });

  // ── guards ────────────────────────────────────────────────────

  it("get: rejects a missing alias without GETting", async () => {
    const result = await x509ManageTool.handler({ action: "get" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("alias");
    expect(mockHttp.get).not.toHaveBeenCalled();
  });

  it("delete: rejects a missing alias without POSTing", async () => {
    const result = await x509ManageTool.handler({ action: "delete" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("alias");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("import: rejects a missing alias without POSTing", async () => {
    const result = await x509ManageTool.handler(
      { action: "import", certificate: "TUlJQg==" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("alias");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("import: rejects a missing certificate (no-op guard) without POSTing", async () => {
    const result = await x509ManageTool.handler(
      { action: "import", alias: "cert" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("certificate");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  // ── error handling ────────────────────────────────────────────

  it("returns isError on IrisApiError, naming the alias (preserves text)", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "X509 Credentials NoSuch does not exist" }],
        "/api/executemcp/v2/security/x509",
        "X509 Credentials NoSuch does not exist",
      ),
    );

    const result = await x509ManageTool.handler(
      { action: "get", alias: "NoSuch" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("NoSuch");
    expect(result.content[0]?.text).toContain("does not exist");
  });

  it("propagates non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      x509ManageTool.handler({ action: "list" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  // ── tool metadata ─────────────────────────────────────────────

  it("has scope SYS and is mutate-capable (readOnlyHint false)", () => {
    expect(x509ManageTool.scope).toBe("SYS");
    expect(x509ManageTool.annotations.readOnlyHint).toBe(false);
  });

  it("classifies every action in `mutates` (list/get=read; import/delete=write)", () => {
    expect(x509ManageTool.mutates).toEqual({
      list: "read",
      get: "read",
      import: "write",
      delete: "write",
    });
  });

  it("declares the action enum with all four actions", () => {
    const shape = x509ManageTool.inputSchema.shape as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options = (shape.action as any)?.options;
    expect(options).toEqual(["list", "get", "import", "delete"]);
  });

  it("does NOT declare a reserved `server` field (framework injects it)", () => {
    const shape = x509ManageTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).not.toHaveProperty("server");
  });
});
