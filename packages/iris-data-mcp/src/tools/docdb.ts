/**
 * Document Database (DocDB) tools for the IRIS Data & Analytics MCP server.
 *
 * Provides four tools for managing IRIS document databases:
 * - {@link docdbManageTool} — Create, drop, or list document databases
 * - {@link docdbDocumentTool} — Insert, get, update, or delete documents
 * - {@link docdbFindTool} — Query documents with filter criteria
 * - {@link docdbPropertyTool} — Create, drop, or index properties
 *
 * All tools call the IRIS built-in DocDB REST API at
 * `/api/docdb/v1/{namespace}/...`. IRIS denies every call on a database that has
 * no `Security.DocDBs` record (ERROR #822) and that API never writes one, so
 * `iris_docdb_manage create` also registers the record through the ExecuteMCPv2
 * route `/api/executemcp/v2/security/docdb` (Story 44.1).
 *
 * ## DocDB API contract notes (from reading %Api.DocDB.v1.cls and %DocDB.Database.cls)
 *
 * ### Property create (BUG-5 fix)
 * `POST /api/docdb/v1/{ns}/prop/{db}/{prop}` reads `type` from
 * `%request.Data("type",1)` — i.e., a **URL query parameter**, not the
 * JSON body.  Sending `{type: "..."}` in the body is silently ignored and
 * the server defaults to `%String`.  Fix: append `?type=<encoded>` to the
 * URL and send an empty body `{}`.
 *
 * ENCODING: IRIS type names start with `%` (e.g. `%Integer`).
 * `encodeURIComponent` turns `%` into `%25`, but the IRIS CSP layer does
 * NOT URL-decode `%XX` sequences in `%request.Data` — it reads `%25Integer`
 * literally, causing lookup failure for class `%Library.25Integer`.
 * Fix: split on `%`, encode each segment, rejoin with `%`.
 * This keeps the type `%` prefix as a literal `%` while encoding any other
 * special characters in the type name. Verified via direct HTTP probe.
 *
 * ### Find / filter (BUG-6 fix)
 * `POST /api/docdb/v1/{ns}/find/{db}` reads `requestBody.restriction`,
 * `.projection`, and `.options` from the JSON body.  `restriction` is
 * either a single DocDB predicate array `[field, value, operator]` or an
 * array of such arrays (combined with AND).  The MongoDB-style filter
 * `{field: {$gt: value}}` must be translated to `["field", value, ">"]`.
 * Supported operators: $eq → =, $ne → !=, $lt → <, $lte → <=, $gt → >,
 * $gte → >=.  Multiple field/op pairs are combined as an array of predicates.
 */

import { IrisApiError, type ToolContext, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the IRIS DocDB REST API. */
const BASE_DOCDB_URL = "/api/docdb/v1";

/** Base URL for the custom ExecuteMCPv2 REST service (service-state probes). */
const BASE_EXECUTEMCP_URL = "/api/executemcp/v2";

/**
 * Map from MongoDB-style comparison operator to IRIS DocDB SQL operator.
 * Source: %DocDB.Database.generatePredicate() — the supported set is
 * =, !=, <, >, <=, >=, <>, %STARTSWITH, NULL, NOT NULL, IN.
 */
const MONGO_OP_MAP: Record<string, string> = {
  $eq: "=",
  $ne: "!=",
  $lt: "<",
  $lte: "<=",
  $gt: ">",
  $gte: ">=",
};

/**
 * Translate a MongoDB-style filter object to a DocDB restriction value.
 *
 * The DocDB `%FindDocuments()` method accepts a `restriction` argument that
 * is either:
 * - A single predicate array: `[field, value, operator]`
 * - An array of predicate arrays for AND-combination: `[[f1,v1,op1],[f2,v2,op2]]`
 *
 * This function converts:
 * ```json
 * { "age": { "$gt": 26 }, "name": { "$eq": "Alice" } }
 * ```
 * to:
 * ```json
 * [["age", 26, ">"], ["name", "Alice", "="]]
 * ```
 * A single predicate is returned as a flat `[field, value, operator]` array
 * (not nested) per the DocDB API contract.
 *
 * Unsupported operators are silently skipped.
 *
 * @param filter - The MongoDB-style filter object.
 * @returns The DocDB restriction value, or `null` if no predicates could be built.
 */
export function buildDocDbRestriction(
  filter: Record<string, unknown>,
): unknown[] | null {
  const predicates: [string, unknown, string][] = [];

  for (const [field, condition] of Object.entries(filter)) {
    if (
      condition !== null &&
      typeof condition === "object" &&
      !Array.isArray(condition)
    ) {
      const condObj = condition as Record<string, unknown>;
      for (const [mongoOp, value] of Object.entries(condObj)) {
        const docdbOp = MONGO_OP_MAP[mongoOp];
        if (docdbOp !== undefined) {
          predicates.push([field, value, docdbOp]);
        }
        // Unknown operators are silently skipped — the caller will get all docs
      }
    } else {
      // Plain equality: { field: value }
      predicates.push([field, condition, "="]);
    }
  }

  if (predicates.length === 0) return null;
  if (predicates.length === 1) return predicates[0]!;
  return predicates;
}

/**
 * Extract the usable result from a DocDB API response.
 *
 * The {@link IrisHttpClient} casts every JSON response to
 * `AtelierEnvelope<T>`, but the DocDB API returns plain JSON
 * (no `{status, console, result}` wrapper). When the response
 * lacks the Atelier envelope, `.result` is `undefined` and the
 * actual data sits at the top level of the parsed object.
 *
 * @param response - The parsed response from `ctx.http.*`.
 * @returns The actual data payload.
 */
export function extractResult(response: unknown): unknown {
  if (
    response !== null &&
    typeof response === "object" &&
    "result" in (response as Record<string, unknown>) &&
    (response as Record<string, unknown>).result !== undefined
  ) {
    return (response as Record<string, unknown>).result;
  }
  return response;
}

/**
 * Ensure a value is a record suitable for MCP `structuredContent`.
 * MCP requires structuredContent to be a JSON object (record), not an array.
 * Arrays are wrapped in `{ items, count }`.
 */
export function toStructured(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { items: value, count: value.length };
  }
  if (value !== null && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return { value };
}

// ── %Service_DocDB gate translation (Story 35.7) ───────────────

/**
 * IRIS error code for "Access Denied" (ERROR #822). The numeric code is
 * locale-stable — the message text is NOT (Rules #8/#13: IRIS localizes
 * error prefixes/text), so detection keys on `code` only.
 *
 * Code 822 is SHARED between a disabled `%Service_DocDB` and a genuine
 * privilege failure (lead live probe, 2026-08-19: `_SYSTEM` holding `%All`
 * still receives 822 when the service is off), so the code alone is never
 * a sufficient discriminator (Rule #54) — the live service state is.
 */
const IRIS_ERROR_CODE_ACCESS_DENIED = 822;

/** The DocDB gateway service — disabled by default on IRIS. */
const DOCDB_SERVICE_NAME = "%Service_DocDB";

/** IRIS error code for "database already defined in this namespace" (the DocDB create of an existing name). */
const IRIS_ERROR_CODE_DOCDB_ALREADY_EXISTS = 25051;

/**
 * True when the error carries an `errors[]` entry with the numeric `code`.
 *
 * The runtime cast in http-client.ts passes envelope.status.errors through
 * whenever it has a length; a non-empty STRING satisfies that check, so
 * `errors` can be a non-array here despite the unknown[] type (the shared
 * formatIrisErrors guards the same shape). Guard before .some so a
 * malformed error can never throw out of the caller's catch path. Never
 * matches message text (Rules #8/#13: it is localized).
 */
function hasErrorCode(error: IrisApiError, code: number): boolean {
  return (
    Array.isArray(error.errors) &&
    error.errors.some(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        (entry as Record<string, unknown>).code === code,
    )
  );
}

/** The database a DocDB call targeted; lets the 822 translation check its `Security.DocDBs` record. */
export interface DocDbTarget {
  database: string;
  namespace: string;
}

/** Where to register a database that has no record, named in every message that says it is missing. */
const DOCDB_PORTAL_ROUTE =
  "Management Portal > System Administration > Security > Applications > Doc DB Applications";

/**
 * Translate a DocDB access-denied failure into an actionable error message
 * (Story 35.7, AC 35.7.1/35.7.3/35.7.4; Story 44.1).
 *
 * Returns the enriched message when (and only when) ALL of the following
 * hold; returns `null` (caller passes the original error through unchanged)
 * otherwise:
 *
 * - the error carries an `errors[]` entry with numeric `code === 822`
 *   (the real disabled-service shape is HTTP 200 with a code-822 object in
 *   `status.errors[]` — never match message text, never branch on the HTTP
 *   status); AND
 * - a follow-up `GET /api/executemcp/v2/security/service?name=...` reports
 *   `%Service_DocDB` as `enabled: false` (the disabled-service message); OR
 *   it reports `enabled: true`, `target` is given, and a follow-up
 *   `GET /api/executemcp/v2/security/docdb?name=...&namespace=...` reports
 *   that the database exists without a `Security.DocDBs` record, or that no
 *   such database exists (the record messages).
 *
 * Pass-through is total: a genuine privilege failure (service enabled and a
 * record present), no `target` (a namespace-level `list`), a follow-up check
 * that itself fails or answers an unexpected shape, or a non-822 error all
 * return `null`: a secondary failure must never mask the real error.
 *
 * This is a catch-path translation, not a pre-check: the extra round-trips
 * happen only when a call has already failed with 822.
 *
 * @param ctx - Tool context (used for the follow-up GETs).
 * @param error - The `IrisApiError` thrown by the DocDB call.
 * @param target - The database the call targeted; omit for namespace-level calls.
 * @returns The actionable message, or `null` for pass-through.
 */
export async function translateDocDbAccessDenied(
  ctx: ToolContext,
  error: IrisApiError,
  target?: DocDbTarget,
): Promise<string | null> {
  if (!hasErrorCode(error, IRIS_ERROR_CODE_ACCESS_DENIED)) return null;

  let enabled: unknown;
  try {
    const response = await ctx.http.get(
      `${BASE_EXECUTEMCP_URL}/security/service?name=${encodeURIComponent(DOCDB_SERVICE_NAME)}`,
    );
    const result = (response as { result?: unknown }).result;
    enabled =
      result !== null && typeof result === "object"
        ? (result as Record<string, unknown>).enabled
        : undefined;
  } catch {
    // The service-state check itself failed — never mask the original error.
    return null;
  }

  if (enabled === true && target !== undefined) {
    return translateMissingDocDbRecord(ctx, error, target);
  }

  if (enabled !== false) {
    // Service enabled (genuine privilege/other failure) or an unexpected
    // response shape — pass the original error through unchanged.
    return null;
  }

  return (
    `ERROR #822: Access Denied — this usually means the ${DOCDB_SERVICE_NAME} ` +
    `service is disabled (it is disabled by default on IRIS). Checked live: ` +
    `${DOCDB_SERVICE_NAME} is currently DISABLED on this instance. ` +
    `To fix: enable it in the Management Portal (System Administration > ` +
    `Security > Services > ${DOCDB_SERVICE_NAME}), or via the ` +
    `iris_service_manage tool (in the @iris-mcp/admin server) with ` +
    `action="enable" and ` +
    `name="${DOCDB_SERVICE_NAME}" — note that action is itself ` +
    `governance-default-disabled and needs an IRIS_GOVERNANCE override such ` +
    `as {"global": {"iris_service_manage:enable": true}}. ` +
    `Original error: ${error.message}`
  );
}

/**
 * With `%Service_DocDB` enabled, name the cause of an 822 when the database has
 * no `Security.DocDBs` record, or does not exist (Story 44.1).
 *
 * Returns `null` (pass the original error through) when the record is there,
 * when the check fails, or when its answer has an unexpected shape.
 */
async function translateMissingDocDbRecord(
  ctx: ToolContext,
  error: IrisApiError,
  target: DocDbTarget,
): Promise<string | null> {
  let exists: unknown;
  let registered: unknown;
  try {
    const response = await ctx.http.get(
      `${BASE_EXECUTEMCP_URL}/security/docdb?name=${encodeURIComponent(target.database)}` +
        `&namespace=${encodeURIComponent(target.namespace)}`,
    );
    const result = (response as { result?: unknown }).result;
    if (result === null || typeof result !== "object") return null;
    exists = (result as Record<string, unknown>).exists;
    registered = (result as Record<string, unknown>).registered;
  } catch {
    // The record check itself failed; never mask the original error.
    return null;
  }

  if (registered !== false) return null;

  if (exists === true) {
    return (
      `ERROR #822: Access Denied \u2014 DocDB database '${target.database}' in namespace ` +
      `${target.namespace} has no Security.DocDBs record. IRIS denies every DocDB call ` +
      `on a database without one, and the DocDB REST API never writes it (a database ` +
      `created before iris_docdb_manage 'create' registered it is in this state). ` +
      `Checked live: ${DOCDB_SERVICE_NAME} is enabled and the record is missing. ` +
      `To fix: run iris_docdb_manage with action="create" and database="${target.database}" ` +
      `(the same name) \u2014 it registers the missing record \u2014 or add it in the ` +
      `${DOCDB_PORTAL_ROUTE}. ` +
      `Original error: ${error.message}`
    );
  }
  if (exists === false) {
    return (
      `ERROR #822: Access Denied \u2014 no DocDB database '${target.database}' exists in ` +
      `namespace ${target.namespace}, so IRIS has no record to authorize the call against. ` +
      `Create it with iris_docdb_manage action="create" (that also registers its ` +
      `Security.DocDBs record), or check the database and namespace names. ` +
      `Original error: ${error.message}`
    );
  }
  return null;
}

/** The text of an error thrown by a follow-up call, for a message that must carry the real reason. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The result of `iris_docdb_manage create` when the database's `Security.DocDBs`
 * record could not be registered: an error that says what was created, what was
 * not, why, and what to do (Story 44.1). Never silent, never thrown.
 */
function registrationFailure(
  target: DocDbTarget,
  created: boolean,
  cause: unknown,
) {
  const missingRoute =
    cause instanceof IrisApiError && cause.statusCode === 404
      ? " The ExecuteMCPv2 REST service deployed on this instance has no /security/docdb route; it is updated when the server next bootstraps."
      : "";
  const lead = created
    ? `DocDB database '${target.database}' WAS created in namespace ${target.namespace}, but its Security.DocDBs record was NOT registered, so IRIS denies every other DocDB call on it (ERROR #822: Access Denied)`
    : `DocDB database '${target.database}' already exists in namespace ${target.namespace}, but registering its Security.DocDBs record failed; without that record IRIS denies every other DocDB call on it (ERROR #822: Access Denied)`;
  return {
    content: [
      {
        type: "text" as const,
        text:
          `${lead}. ` +
          `Registration error: ${errorText(cause)}${missingRoute} ` +
          `To fix: run iris_docdb_manage with action="create" and database="${target.database}" ` +
          `again (it registers the missing record), or add it in the ${DOCDB_PORTAL_ROUTE}.`,
      },
    ],
    structuredContent: {
      database: target.database,
      namespace: target.namespace,
      created,
      registered: false,
    },
    isError: true,
  };
}

// ── iris_docdb_manage ──────────────────────────────────────────

export const docdbManageTool: ToolDefinition = {
  name: "iris_docdb_manage",
  title: "Manage Document Database",
  description:
    "Create, drop, or list IRIS document databases. " +
    "'list' returns all DocDB databases in the namespace. " +
    "'create' creates a new document database with optional property definitions. " +
    "'drop' permanently removes a document database and all its data. " +
    "Prerequisite: the %Service_DocDB service must be enabled on the instance " +
    "(it is disabled by default on IRIS) — a disabled service fails these calls " +
    "with ERROR #822: Access Denied. " +
    "'create' also registers the database's Security.DocDBs record, which every other DocDB call requires, " +
    "and on a database that exists without one it registers the missing record.",
  inputSchema: z.object({
    action: z
      .enum(["list", "create", "drop"])
      .describe("Action to perform: 'list', 'create', or 'drop'"),
    database: z
      .string()
      .min(1)
      .optional()
      .describe("Database name (required for 'create' and 'drop')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, database, namespace } = args as {
      action: string;
      database?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    try {
      let response: unknown;

      if (action === "list") {
        response = await ctx.http.get(
          `${BASE_DOCDB_URL}/${encodeURIComponent(ns)}`,
        );
      } else if (action === "create") {
        if (!database) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'database' is required for 'create' action",
              },
            ],
            isError: true,
          };
        }
        const target: DocDbTarget = { database, namespace: ns };
        let existingError: IrisApiError | undefined;
        try {
          response = await ctx.http.post(
            `${BASE_DOCDB_URL}/${encodeURIComponent(ns)}/db/${encodeURIComponent(database)}`,
            {},
          );
        } catch (createError: unknown) {
          // A database that already exists answers 25051 (matched on the
          // numeric code, never the text). It may be one made before create
          // registered the record, so try to register it (repair).
          if (
            !(createError instanceof IrisApiError) ||
            !hasErrorCode(createError, IRIS_ERROR_CODE_DOCDB_ALREADY_EXISTS)
          ) {
            throw createError;
          }
          existingError = createError;
        }

        // The DocDB API never writes the Security.DocDBs record that IRIS
        // requires for every other call on the database; register it.
        let registration: unknown;
        try {
          const registerResponse = await ctx.http.post(
            `${BASE_EXECUTEMCP_URL}/security/docdb`,
            { action: "register", name: database, namespace: ns },
          );
          registration = (registerResponse as { result?: unknown }).result;
        } catch (registerError: unknown) {
          return registrationFailure(target, existingError === undefined, registerError);
        }
        const registrationFields =
          registration !== null && typeof registration === "object"
            ? (registration as Record<string, unknown>)
            : {};
        if (registrationFields.registered !== true) {
          return registrationFailure(
            target,
            existingError === undefined,
            new Error(
              `the register call answered an unexpected result: ${JSON.stringify(registration)}`,
            ),
          );
        }

        if (existingError !== undefined) {
          if (registrationFields.alreadyRegistered === true) {
            // The database exists and has its record: this is the plain
            // "already exists" error, exactly as before.
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error managing DocDB database: ${existingError.message}`,
                },
              ],
              isError: true,
            };
          }
          const repaired = {
            database,
            namespace: ns,
            created: false,
            registered: true,
          };
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `DocDB database '${database}' already exists in namespace ${ns}; its ` +
                  `Security.DocDBs record was missing and has been registered.\n` +
                  JSON.stringify(repaired, null, 2),
              },
            ],
            structuredContent: repaired,
          };
        }

        const created = { ...toStructured(extractResult(response)), registered: true };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(created, null, 2) },
          ],
          structuredContent: created,
        };
      } else {
        // drop
        if (!database) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'database' is required for 'drop' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.delete(
          `${BASE_DOCDB_URL}/${encodeURIComponent(ns)}/db/${encodeURIComponent(database)}`,
        );
      }

      const result = extractResult(response);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        // Story 35.7: a disabled %Service_DocDB surfaces as ERROR #822 —
        // translate it into an actionable message (pass-through otherwise).
        const gateMessage = await translateDocDbAccessDenied(
          ctx,
          error,
          action === "drop" && database ? { database, namespace: ns } : undefined,
        );
        return {
          content: [
            {
              type: "text" as const,
              text:
                gateMessage ?? `Error managing DocDB database: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_docdb_document ────────────────────────────────────────

export const docdbDocumentTool: ToolDefinition = {
  name: "iris_docdb_document",
  title: "Manage Document",
  description:
    "Insert, get, update, or delete a document in an IRIS document database. " +
    "'insert' adds a new document and returns its generated ID. " +
    "'get' retrieves a document by ID. " +
    "'update' replaces a document by ID. " +
    "'delete' removes a document by ID. " +
    "Prerequisite: the %Service_DocDB service must be enabled on the instance " +
    "(it is disabled by default on IRIS) — a disabled service fails these calls " +
    "with ERROR #822: Access Denied.",
  inputSchema: z.object({
    action: z
      .enum(["insert", "get", "update", "delete"])
      .describe("Action to perform: 'insert', 'get', 'update', or 'delete'"),
    database: z.string().min(1).describe("Document database name"),
    id: z
      .string()
      .min(1)
      .optional()
      .describe("Document ID (required for 'get', 'update', 'delete')"),
    document: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Document content as JSON (required for 'insert' and 'update')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, database, id, document, namespace } = args as {
      action: string;
      database: string;
      id?: string;
      document?: Record<string, unknown>;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const dbPath = `${BASE_DOCDB_URL}/${encodeURIComponent(ns)}/doc/${encodeURIComponent(database)}`;

    try {
      let response: unknown;

      if (action === "insert") {
        if (!document) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'document' is required for 'insert' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.post(`${dbPath}/`, document);
      } else if (action === "get") {
        if (!id) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'id' is required for 'get' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.get(
          `${dbPath}/${encodeURIComponent(id)}`,
        );
      } else if (action === "update") {
        if (!id) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'id' is required for 'update' action",
              },
            ],
            isError: true,
          };
        }
        if (!document) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'document' is required for 'update' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.put(
          `${dbPath}/${encodeURIComponent(id)}`,
          document,
        );
      } else {
        // delete
        if (!id) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'id' is required for 'delete' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.delete(
          `${dbPath}/${encodeURIComponent(id)}`,
        );
      }

      const result = extractResult(response);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        // Story 35.7: a disabled %Service_DocDB surfaces as ERROR #822 —
        // translate it into an actionable message (pass-through otherwise).
        const gateMessage = await translateDocDbAccessDenied(ctx, error, {
          database,
          namespace: ns,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: gateMessage ?? `Error managing document: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_docdb_find ────────────────────────────────────────────

export const docdbFindTool: ToolDefinition = {
  name: "iris_docdb_find",
  title: "Find Documents",
  description:
    "Query documents in an IRIS document database using filter criteria. " +
    "Supports comparison operators ($eq, $lt, $gt, $ne, $lte, $gte) " +
    "and returns matching documents. " +
    "Prerequisite: the %Service_DocDB service must be enabled on the instance " +
    "(it is disabled by default on IRIS) — a disabled service fails these calls " +
    "with ERROR #822: Access Denied.",
  inputSchema: z.object({
    database: z.string().min(1).describe("Document database name"),
    filter: z
      .record(z.string(), z.unknown())
      .describe(
        "Filter criteria as JSON with comparison operators (e.g., { \"age\": { \"$gt\": 21 } })",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { database, filter, namespace } = args as {
      database: string;
      filter: Record<string, unknown>;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    try {
      // Translate MongoDB-style filter to DocDB restriction format.
      // The DocDB /find/ endpoint reads requestBody.restriction (not a flat filter).
      // restriction is a predicate array [field, value, operator] or an array of
      // such arrays for AND-combination (from %DocDB.Database.%FindDocuments docs).
      const restriction = buildDocDbRestriction(filter);
      const findBody: Record<string, unknown> = {};
      if (restriction !== null) {
        findBody.restriction = restriction;
      }

      const response = await ctx.http.post(
        `${BASE_DOCDB_URL}/${encodeURIComponent(ns)}/find/${encodeURIComponent(database)}`,
        findBody,
      );

      const result = extractResult(response);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        // Story 35.7: a disabled %Service_DocDB surfaces as ERROR #822 —
        // translate it into an actionable message (pass-through otherwise).
        const gateMessage = await translateDocDbAccessDenied(ctx, error, {
          database,
          namespace: ns,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: gateMessage ?? `Error querying documents: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_docdb_property ────────────────────────────────────────

export const docdbPropertyTool: ToolDefinition = {
  name: "iris_docdb_property",
  title: "Manage Document Property",
  description:
    "Create, drop, or index a property on an IRIS document database. " +
    "'create' defines a new property with a specified type. " +
    "'drop' removes a property definition. " +
    "'index' creates an index on a property for faster queries. " +
    "Prerequisite: the %Service_DocDB service must be enabled on the instance " +
    "(it is disabled by default on IRIS) — a disabled service fails these calls " +
    "with ERROR #822: Access Denied.",
  inputSchema: z.object({
    action: z
      .enum(["create", "drop", "index"])
      .describe("Action to perform: 'create', 'drop', or 'index'"),
    database: z.string().min(1).describe("Document database name"),
    property: z.string().min(1).describe("Property name"),
    type: z
      .string()
      .optional()
      .describe("Property type (required for 'create', e.g., '%String', '%Integer')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, database, property, type, namespace } = args as {
      action: string;
      database: string;
      property: string;
      type?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const propPath = `${BASE_DOCDB_URL}/${encodeURIComponent(ns)}/prop/${encodeURIComponent(database)}/${encodeURIComponent(property)}`;

    try {
      let response: unknown;

      if (action === "create") {
        if (!type) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'type' is required for 'create' action",
              },
            ],
            isError: true,
          };
        }
        // The DocDB httpPostProperty handler reads `type` from %request.Data("type",1),
        // which is a URL query parameter — NOT from the JSON body.  Sending the type
        // in the body is silently ignored and the server defaults to %String.  Fix:
        // append ?type=<encoded> to the URL and send an empty body (BUG-5).
        //
        // ENCODING NOTE: IRIS type names begin with "%" (e.g. "%Integer", "%Library.String").
        // encodeURIComponent("%Integer") → "%25Integer", but the IRIS CSP layer does NOT
        // URL-decode %XX sequences in %request.Data query param values — it reads "%25Integer"
        // literally, causing class lookup for "%Library.25Integer" to fail.
        // Fix: split on "%" and encode each segment individually, then rejoin with bare "%".
        // This keeps IRIS type % prefixes as literal "%" while still encoding any other
        // special characters that might appear in a type name.
        // Verified via %Net.HttpRequest probe: "?type=%Integer" → StoredType: %Library.Integer.
        const encodedType = type
          .split("%")
          .map((part) => encodeURIComponent(part))
          .join("%");
        response = await ctx.http.post(`${propPath}?type=${encodedType}`, {});
      } else if (action === "drop") {
        response = await ctx.http.delete(propPath);
      } else {
        // index
        response = await ctx.http.post(propPath, { index: true });
      }

      const result = extractResult(response);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        // Story 35.7: a disabled %Service_DocDB surfaces as ERROR #822 —
        // translate it into an actionable message (pass-through otherwise).
        const gateMessage = await translateDocDbAccessDenied(ctx, error, {
          database,
          namespace: ns,
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                gateMessage ??
                `Error managing property '${property}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
