/**
 * IRIS X.509 certificate-credentials tool for the IRIS Administration MCP
 * server.
 *
 * Provides {@link x509ManageTool} — a single multi-action tool to list,
 * inspect, import, and delete X.509 certificate credentials
 * (`%SYS.X509Credentials`) via the custom REST endpoint
 * `/api/executemcp/v2/security/x509`. Operations execute in the `%SYS`
 * namespace on the IRIS server.
 *
 * **Governed write tool (Epic 15, Story 15.3).** The `mutates` classification
 * map classifies all four actions: `list`/`get` are reads (enabled by default),
 * while `import`/`delete` are writes that the governance layer
 * default-DISABLES until an operator opts in via `IRIS_GOVERNANCE`. The tool
 * does NOT declare a `server` field — the framework injects it (architecture
 * decision D2).
 *
 * **SECURITY-CRITICAL — NO private-key material in output (AC 15.3.3):**
 * `%SYS.X509Credentials` holds private-key material (`PrivateKey`,
 * `PrivateKeyPassword`, and the `*Export` variants). `list`/`get` return ONLY
 * public metadata: the alias, a `hasPrivateKey` boolean, and safe public
 * certificate fields (subject/issuer/serial/thumbprint/subjectKeyIdentifier/
 * notBefore/notAfter). They MUST NEVER return the private key in any form. The
 * exclusion is enforced in BOTH the ObjectScript handler (which never reads the
 * secret properties into its output) and this output mapping (which only ever
 * forwards the server's already-private-key-free envelope). A deep-scan unit
 * test asserts no private-key-shaped field appears at any depth of the output.
 *
 * **`import` mechanism (AC 15.3.4, Rule #16 live probe):** the native
 * `%SYS.X509Credentials.Import(FileName, .NumImported, Flags)` reads a
 * server-side XML *export* file — not agent-friendly for importing a single
 * certificate. The class DOES support constructing a credential from a
 * base64-encoded certificate (DER or PEM) + `Save` (mirroring what
 * `LoadCertificate` does internally: base64-decode → `Certificate` setter,
 * which auto-derives Thumbprint/Subject/Issuer/Serial/SubjectKeyIdentifier). So
 * `import` accepts a base64 `certificate` (required) and an OPTIONAL,
 * write-only base64 `privateKey` (+ optional `privateKeyPassword`). The private
 * key is accepted IN only — it is never echoed back in the import response.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_x509_manage ────────────────────────────────────────────

export const x509ManageTool: ToolDefinition = {
  name: "iris_x509_manage",
  title: "Manage IRIS X.509 Certificate Credentials",
  description:
    "List, inspect, import, and delete IRIS X.509 certificate credentials " +
    "(backed by %SYS.X509Credentials in %SYS). Actions: 'list' (all " +
    "credentials' public metadata), 'get' (one credential's public metadata — " +
    "requires alias), 'import' (create a credential from a base64-encoded " +
    "certificate — requires alias + certificate), 'delete' (remove a credential " +
    "— requires alias). The mutating actions (import/delete) are opt-in under " +
    "tool governance and are disabled by default until enabled via " +
    "IRIS_GOVERNANCE. SECURITY: private-key material (PrivateKey, " +
    "PrivateKeyPassword) is NEVER returned by 'list' or 'get' — only the alias, " +
    "a hasPrivateKey boolean, and safe public certificate fields (subjectDN, " +
    "issuerDN, serialNumber, thumbprint, subjectKeyIdentifier, notBefore, " +
    "notAfter). Import mechanism: the 'certificate' field is a base64-encoded " +
    "X.509 certificate (DER, or a PEM body); an OPTIONAL 'privateKey' " +
    "(base64-encoded PEM) and 'privateKeyPassword' may be supplied write-only " +
    "(accepted on import, NEVER echoed back). The native file-based Import API " +
    "is not exposed; credentials are created via object-create + Save.",
  inputSchema: z.object({
    action: z
      .enum(["list", "get", "import", "delete"])
      .describe("Action to perform on the X.509 credential(s)"),
    alias: z
      .string()
      .optional()
      .describe(
        "X.509 credential alias (required for get/import/delete; the unique key)",
      ),
    certificate: z
      .string()
      .optional()
      .describe(
        "Base64-encoded X.509 certificate (DER bytes, or a PEM certificate " +
          "body) — required for 'import'",
      ),
    privateKey: z
      .string()
      .optional()
      .describe(
        "OPTIONAL base64-encoded PEM private key to associate with the " +
          "certificate on 'import' (write-only; NEVER returned in any response)",
      ),
    privateKeyPassword: z
      .string()
      .optional()
      .describe(
        "OPTIONAL password for the supplied private key (write-only; NEVER " +
          "returned in any response)",
      ),
    namespace: z
      .string()
      .optional()
      .describe(
        "Namespace override (X.509 credentials are %SYS-scoped; usually omit)",
      ),
    cursor: z
      .string()
      .optional()
      .describe(
        "Pagination cursor from a previous 'list' response's nextCursor field",
      ),
  }),
  annotations: {
    // The tool can mutate (import/delete). MCP annotations are tool-scoped; the
    // per-action read/write distinction is realized through `mutates` below.
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "SYS",
  // Governance classification (Story 15.0 strict contract): EVERY action key is
  // classified because none are in the frozen Epic-14 baseline. Reads default
  // enabled; writes default DISABLED (opt-in via IRIS_GOVERNANCE).
  mutates: {
    list: "read",
    get: "read",
    import: "write",
    delete: "write",
  },
  handler: async (args, ctx) => {
    const { action, alias, certificate, privateKey, privateKeyPassword, cursor } =
      args as {
        action: "list" | "get" | "import" | "delete";
        alias?: string;
        certificate?: string;
        privateKey?: string;
        privateKeyPassword?: string;
        cursor?: string;
      };

    const path = `${BASE_URL}/security/x509`;

    try {
      if (action === "list") {
        const response = await ctx.http.get(path);
        const rawResult = response.result as Array<Record<string, unknown>>;
        const allCreds = Array.isArray(rawResult) ? rawResult : [];
        const { page, nextCursor } = ctx.paginate(allCreds, cursor);
        const result = {
          credentials: page,
          count: page.length,
          ...(nextCursor ? { nextCursor } : {}),
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          structuredContent: result,
        };
      }

      if (action === "get") {
        // `alias` is required for get. An absent ?alias= would make the server
        // return the whole inventory (wrong shape under a `get` action). Reject
        // up front so the caller gets a clear error.
        if (alias === undefined || alias === "") {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: 'alias' is required for the '${action}' action.`,
              },
            ],
            isError: true,
          };
        }
        const getPath = `${path}?alias=${encodeURIComponent(alias)}`;
        const response = await ctx.http.get(getPath);
        const result = response.result;
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          structuredContent: result,
        };
      }

      // import / delete — POST a mutating request body. `alias` is required for
      // every write action.
      if (alias === undefined || alias === "") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: 'alias' is required for the '${action}' action.`,
            },
          ],
          isError: true,
        };
      }

      if (action === "import" && (certificate === undefined || certificate === "")) {
        // An import with no certificate cannot create a credential — reject up
        // front rather than let the server fail on a missing required field.
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: the 'import' action requires a base64 'certificate'.`,
            },
          ],
          isError: true,
        };
      }

      const body: Record<string, unknown> = { action, alias };
      if (action === "import") {
        body.certificate = certificate;
        // Private key + password are write-only: forwarded on import, never read
        // back. Only include when supplied.
        if (privateKey !== undefined && privateKey !== "") {
          body.privateKey = privateKey;
        }
        if (privateKeyPassword !== undefined && privateKeyPassword !== "") {
          body.privateKeyPassword = privateKeyPassword;
        }
      }

      const response = await ctx.http.post(path, body);
      const result = response.result;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        const label = alias ? `X.509 credential '${alias}'` : "X.509 credentials";
        return {
          content: [
            {
              type: "text" as const,
              text: `Error performing '${action}' on ${label}: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
