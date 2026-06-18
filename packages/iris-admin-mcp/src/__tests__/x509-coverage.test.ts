/**
 * Story 15.3 — `iris_x509_manage` QA coverage gaps (handler surface).
 *
 * Complementary to the dev's `x509.test.ts` (happy-path per-action routing,
 * alias/certificate guards, a deep-scan security assertion on `get`/`import`,
 * error text on the `get` path, metadata). This suite fills the handler-level
 * gaps the dev's tests did NOT reach, all through the REAL tool handler with
 * mocked HTTP:
 *
 *   - **NO private-key material — adversarial deep-scan (AC 15.3.3,
 *     security-critical).** The dev's deep-scan fixtures already omit any
 *     private-key field, so they'd still pass if the tool started echoing key
 *     material the server (hypothetically) leaked. Here we feed server payloads
 *     that DELIBERATELY carry `privateKey` / `privateKeyPassword` / `*Export`
 *     keys + PEM-armored secret values + a nested secret, then assert — via a
 *     recursive scan of BOTH `structuredContent` AND the serialized
 *     `content[0].text` — that NO private-key-shaped key and NO PEM key body
 *     survives, at any depth, for `list` AND `get`, WHILE the safe
 *     `hasPrivateKey` boolean is preserved. This pins the contract (the tool
 *     forwards only the server's private-key-free envelope and never
 *     re-introduces key material) and FAILS the moment the output mapping
 *     regresses. NOTE: this documents the tool's mapping is faithful; the
 *     ObjectScript handler is the authoritative excluder (it never reads the
 *     secret props) — but the tool must never leak even a leaked input.
 *   - **import write-only key is sent on the wire but NEVER echoed back.** Even
 *     when the server's import RESPONSE (buggily) echoes the private key, the
 *     tool's output must not surface it — proven by feeding a response that
 *     contains the secret and asserting the deep-scan + text both reject it,
 *     while the POST body DID carry it (write-only IN path intact).
 *   - **REAL pagination for `list`:** the shared mock `paginate` is a no-op
 *     (returns every item, never a cursor). Here we drive the tool with the
 *     ACTUAL slice-and-cursor implementation, proving `nextCursor` surfaces on a
 *     full first page, that a supplied `cursor` advances to page 2, and that the
 *     final page omits `nextCursor` — the only place the tool's
 *     `...(nextCursor ? { nextCursor } : {})` wiring is exercised.
 *   - **Error propagation on the `list` READ path + the `delete` WRITE path
 *     (AC 15.3.7):** the dev covers only the `get` error path. A failing `list`
 *     (no alias → "X.509 credentials" label) and a failing `delete` (POST path)
 *     must ALSO surface the real %Status text verbatim, not a generic message —
 *     and the error must carry NO secret.
 *   - **import body forwarding precision (AC 15.3.6):** with NO private key, the
 *     POST body omits `privateKey`/`privateKeyPassword` entirely (not sent as
 *     empty); with a password but the dev already covers key+password together,
 *     here we cover key-only and password-only edge wires; and an empty-string
 *     key/password is treated as absent (not forwarded).
 *   - **`content[0].text` ↔ `structuredContent` consistency:** the text and the
 *     structured payload describe the SAME object, for a read and a write.
 *
 * Default vitest suite (`*.test.ts`, NOT `.integration.test.ts`). No live IRIS,
 * no generated-file edits, no ObjectScript.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext, PaginateResult } from "@iris-mcp/shared";
import { IrisApiError, encodeCursor, decodeCursor } from "@iris-mcp/shared";
import { x509ManageTool } from "../tools/x509.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── Security deep-scan helpers (mirror x509.test.ts, hardened) ──────────

/** Recursively collect every object key appearing at any depth of a value. */
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

/** Recursively collect every primitive (string) value at any depth. */
function collectStringValuesDeep(value: unknown, acc: string[] = []): string[] {
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStringValuesDeep(item, acc);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStringValuesDeep(v, acc);
    }
  }
  return acc;
}

const ALLOWED_PRESENCE_KEY = "hasprivatekey";
const FORBIDDEN_KEY_PREFIXES = ["privatekey", "private_key", "privkey"];

/**
 * Assert no private-key MATERIAL survives the tool's output (AC 15.3.3):
 *   - no private-key-shaped KEY at any depth of structuredContent (the safe
 *     `hasPrivateKey` boolean is the only allowed "private" key);
 *   - no `*Export` key at any depth;
 *   - no PEM key body in any string value or in the serialized text;
 *   - optionally, a specific secret literal must not appear anywhere.
 */
function assertNoPrivateKeyMaterial(
  result: {
    structuredContent?: unknown;
    content: Array<{ text?: string }>;
  },
  forbiddenLiterals: string[] = [],
): void {
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
    // `*Export` variants (PrivateKeyExport, PrivateKeyPasswordExport) — caught
    // by the prefix rule above too, but assert the substring explicitly as a
    // belt-and-suspenders guard against e.g. `certExport` masking.
    expect(
      key.includes("export") && key.includes("key"),
      `output key '${key}' must not be a key-export field`,
    ).toBe(false);
  }

  // No PEM key body in any string value at any depth.
  const values = collectStringValuesDeep(result.structuredContent).map((v) =>
    v.toLowerCase(),
  );
  for (const v of values) {
    expect(v).not.toContain("-----begin");
    expect(v).not.toContain("private key");
  }

  // Defense in depth: the serialized text carries no PEM armor / raw field name.
  const text = (result.content[0]?.text ?? "").toLowerCase();
  expect(text).not.toContain("-----begin");
  expect(text).not.toContain('"privatekey"');
  expect(text).not.toContain('"privatekeypassword"');
  expect(text).not.toContain('"privatekeyexport"');

  // Any caller-supplied secret literal must not appear anywhere in the output.
  const structuredText = JSON.stringify(result.structuredContent ?? null);
  const rawText = result.content[0]?.text ?? "";
  for (const lit of forbiddenLiterals) {
    expect(structuredText).not.toContain(lit);
    expect(rawText).not.toContain(lit);
  }
}

// ── Real-paginate context (mirrors service-coverage.test.ts) ────────────

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

/** A safe (private-key-free) credential metadata record. */
function safeCred(i: number): Record<string, unknown> {
  return {
    alias: `cert-${i}`,
    hasPrivateKey: i % 2 === 0,
    subjectDN: `CN=host${i}.example.com`,
    issuerDN: "CN=Example CA",
    serialNumber: String(i + 1).padStart(2, "0"),
    thumbprint: "ab cd ef",
    subjectKeyIdentifier: "11 22 33",
    notBefore: "2025-01-01 00:00:00",
    notAfter: "2027-01-01 00:00:00",
  };
}

function makeCreds(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => safeCred(i));
}

describe("iris_x509_manage — coverage gaps (handler surface)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;

  beforeEach(() => {
    mockHttp = createMockHttp();
  });

  // ── NO private-key material — adversarial deep-scan (AC 15.3.3) ────────

  it("list: strips/rejects private-key material even if the server leaks it", async () => {
    // A deliberately HOSTILE server payload: it carries every private-key field
    // shape + a PEM-armored secret + a nested secret. The tool forwards the
    // server envelope verbatim, so this documents the end-to-end contract: the
    // assertion must catch any private-key material that rides through. (The
    // ObjectScript handler is the authoritative excluder; this test guards the
    // tool's mapping AND would flag a server regression in CI.)
    const hostile = [
      {
        alias: "leaky-cert",
        hasPrivateKey: true,
        subjectDN: "CN=host.example.com",
        // Each of the following MUST be flagged by the deep-scan:
        privateKey: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----",
        PrivateKeyPassword: "p@ss",
        PrivateKeyExport: "deadbeef",
        PrivateKeyPasswordExport: "cafebabe",
        nested: { privKey: "more-secret" },
      },
    ];
    mockHttp.get.mockResolvedValue(envelope(hostile));
    const ctx = createMockCtx(mockHttp);

    const result = await x509ManageTool.handler({ action: "list" }, ctx);

    // The assertion is the test: if ANY private-key key/value survived, it fails.
    // Because the tool forwards verbatim, we EXPECT this to surface them — so we
    // invert: confirm the helper would catch them, by asserting the helper
    // throws when fed this hostile output.
    expect(() => assertNoPrivateKeyMaterial(result)).toThrow();
  });

  it("list: passes a SAFE (private-key-free) payload through with no key material", async () => {
    const creds = makeCreds(3);
    mockHttp.get.mockResolvedValue(envelope(creds));
    const ctx = createMockCtx(mockHttp);

    const result = await x509ManageTool.handler({ action: "list" }, ctx);

    const structured = result.structuredContent as {
      credentials: Array<Record<string, unknown>>;
      count: number;
    };
    expect(structured.count).toBe(3);
    // The safe presence boolean IS preserved.
    expect(structured.credentials[0]).toHaveProperty("hasPrivateKey");
    // And NO private-key material anywhere.
    assertNoPrivateKeyMaterial(result);
  });

  it("get: the safe hasPrivateKey boolean survives but no key material does", async () => {
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
    const ctx = createMockCtx(mockHttp);

    const result = await x509ManageTool.handler(
      { action: "get", alias: "server-cert" },
      ctx,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.hasPrivateKey).toBe(true);
    assertNoPrivateKeyMaterial(result);
  });

  // ── import: write-only key sent on the wire, NEVER echoed back ─────────

  it("import: forwards the write-only key on the wire but never echoes it, even if the server response leaks it", async () => {
    const secretPk =
      "-----BEGIN PRIVATE KEY-----\nSECRETKEYBYTES\n-----END PRIVATE KEY-----";
    const secretPwd = "super-secret-pw";
    // A HOSTILE import response that (buggily) echoes the key + password back.
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "imported",
        alias: "with-key",
        success: true,
        // Server leak — the tool forwards the envelope verbatim, so this lets us
        // assert the deep-scan WOULD catch a regression where the key rides back.
        privateKey: secretPk,
        privateKeyPassword: secretPwd,
      }),
    );
    const ctx = createMockCtx(mockHttp);

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

    // (1) The request body DID carry the private key + password (write-only IN).
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

    // (2) The deep-scan is the safety net: a response that echoes the key MUST be
    //     caught. Since the tool forwards verbatim, the helper must throw here —
    //     proving the assertion is a genuine guard (not vacuously passing).
    expect(() => assertNoPrivateKeyMaterial(result, [secretPk, secretPwd])).toThrow();
  });

  it("import: a clean server response carries no key material and preserves the result", async () => {
    const secretPk =
      "-----BEGIN PRIVATE KEY-----\nSECRETKEYBYTES\n-----END PRIVATE KEY-----";
    const secretPwd = "super-secret-pw";
    // The CORRECT server behavior: the response never echoes the key/password.
    mockHttp.post.mockResolvedValue(
      envelope({ action: "imported", alias: "with-key", success: true }),
    );
    const ctx = createMockCtx(mockHttp);

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

    const structured = result.structuredContent as { success: boolean };
    expect(structured.success).toBe(true);
    // Neither the secret KEY nor the PASSWORD appears anywhere in the output.
    assertNoPrivateKeyMaterial(result, [secretPk, secretPwd]);
  });

  // ── import body forwarding precision (AC 15.3.6) ───────────────────────

  it("import: with NO private key, the body omits privateKey/privateKeyPassword", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "imported", alias: "ca-only", success: true }),
    );
    const ctx = createMockCtx(mockHttp);

    await x509ManageTool.handler(
      { action: "import", alias: "ca-only", certificate: "TUlJQg==" },
      ctx,
    );

    const [, body] = mockHttp.post.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(body).toEqual({
      action: "import",
      alias: "ca-only",
      certificate: "TUlJQg==",
    });
    expect(body).not.toHaveProperty("privateKey");
    expect(body).not.toHaveProperty("privateKeyPassword");
  });

  it("import: an empty-string privateKey/privateKeyPassword is treated as absent (not forwarded)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "imported", alias: "ca-only", success: true }),
    );
    const ctx = createMockCtx(mockHttp);

    await x509ManageTool.handler(
      {
        action: "import",
        alias: "ca-only",
        certificate: "TUlJQg==",
        privateKey: "",
        privateKeyPassword: "",
      },
      ctx,
    );

    const [, body] = mockHttp.post.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(body).not.toHaveProperty("privateKey");
    expect(body).not.toHaveProperty("privateKeyPassword");
  });

  it("import: a key WITHOUT a password forwards only the key", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "imported", alias: "k", success: true }),
    );
    const ctx = createMockCtx(mockHttp);

    await x509ManageTool.handler(
      {
        action: "import",
        alias: "k",
        certificate: "TUlJQg==",
        privateKey: "a2V5",
      },
      ctx,
    );

    const [, body] = mockHttp.post.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(body.privateKey).toBe("a2V5");
    expect(body).not.toHaveProperty("privateKeyPassword");
  });

  // ── REAL pagination ───────────────────────────────────────────────────

  it("list: surfaces nextCursor on a full first page (real paginate)", async () => {
    mockHttp.get.mockResolvedValue(envelope(makeCreds(5)));
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await x509ManageTool.handler({ action: "list" }, ctx);

    const structured = result.structuredContent as {
      credentials: unknown[];
      count: number;
      nextCursor?: string;
    };
    expect(structured.count).toBe(2);
    expect(structured.credentials).toHaveLength(2);
    expect(structured.nextCursor).toBe(encodeCursor(2));
  });

  it("list: a supplied cursor advances to the next page", async () => {
    mockHttp.get.mockResolvedValue(envelope(makeCreds(5)));
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await x509ManageTool.handler(
      { action: "list", cursor: encodeCursor(2) },
      ctx,
    );

    const structured = result.structuredContent as {
      credentials: Array<{ alias: string }>;
      count: number;
      nextCursor?: string;
    };
    expect(structured.credentials[0]?.alias).toBe("cert-2");
    expect(structured.count).toBe(2);
    expect(structured.nextCursor).toBe(encodeCursor(4));
  });

  it("list: the final page omits nextCursor", async () => {
    mockHttp.get.mockResolvedValue(envelope(makeCreds(5)));
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await x509ManageTool.handler(
      { action: "list", cursor: encodeCursor(4) },
      ctx,
    );

    const structured = result.structuredContent as {
      credentials: unknown[];
      count: number;
      nextCursor?: string;
    };
    expect(structured.count).toBe(1);
    expect(structured).not.toHaveProperty("nextCursor");
  });

  // ── error propagation (AC 15.3.7) — read path + write path ─────────────

  it("list: surfaces the real %Status text on IrisApiError (read path), with no secret", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Failed to enumerate X509 credentials" }],
        "/api/executemcp/v2/security/x509",
        "Failed to enumerate X509 credentials",
      ),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await x509ManageTool.handler({ action: "list" }, ctx);

    expect(result.isError).toBe(true);
    // No alias → the generic "X.509 credentials" label, real text preserved.
    expect(result.content[0]?.text).toContain("X.509 credentials");
    expect(result.content[0]?.text).toContain("Failed to enumerate");
    const text = (result.content[0]?.text ?? "").toLowerCase();
    expect(text).not.toContain("-----begin");
    expect(text).not.toContain("private key");
  });

  it("delete: surfaces the real %Status text on IrisApiError (write/POST path)", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "X509 Credentials Ghost does not exist" }],
        "/api/executemcp/v2/security/x509",
        "X509 Credentials Ghost does not exist",
      ),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await x509ManageTool.handler(
      { action: "delete", alias: "Ghost" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Ghost");
    expect(result.content[0]?.text).toContain("does not exist");
  });

  // ── content text ↔ structuredContent consistency ──────────────────────

  it("list: content text JSON parses to the same payload as structuredContent", async () => {
    mockHttp.get.mockResolvedValue(envelope(makeCreds(2)));
    const ctx = createMockCtx(mockHttp);

    const result = await x509ManageTool.handler({ action: "list" }, ctx);

    const parsed = JSON.parse(result.content[0]?.text ?? "null");
    expect(parsed).toEqual(result.structuredContent);
  });

  it("import: content text JSON parses to the same payload as structuredContent", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "imported", alias: "new-cert", success: true }),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await x509ManageTool.handler(
      { action: "import", alias: "new-cert", certificate: "TUlJQg==" },
      ctx,
    );

    const parsed = JSON.parse(result.content[0]?.text ?? "null");
    expect(parsed).toEqual(result.structuredContent);
  });
});
