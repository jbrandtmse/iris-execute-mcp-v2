/**
 * Shared helpers for the SQL tool tests (`sql.test.ts`, `sql-caps.test.ts`, `sql-safety.test.ts`).
 *
 * Not a test file. Every fake here returns a shape the `/dev/sql/execute` endpoint can return
 * (`ExecuteMCPv2.REST.Sql`): `{outcome, statementType, statementTypeName, ...}` inside the
 * Atelier-style envelope the endpoint renders.
 */

import type { AtelierEnvelope } from "@iris-mcp/shared";
import { envelope } from "./test-helpers.js";

/** The endpoint both SQL tools post to. */
export const SQL_PATH = "/api/executemcp/v2/dev/sql/execute";

/** A row as the endpoint serializes it: an object keyed by column name. */
export type SqlRow = Record<string, unknown>;

/** The result of an executed SELECT (`outcome: "ok"`, statement type 1). */
export function executed(rows: SqlRow[], extra: Record<string, unknown> = {}): AtelierEnvelope<unknown> {
  return envelope({ outcome: "ok", statementType: 1, statementTypeName: "SELECT", content: rows, ...extra });
}

/** The result of an executed INSERT, UPDATE or DELETE (statement types 2, 3 and 4). */
export function executedDml(
  statementType: 2 | 3 | 4,
  statementTypeName: "INSERT" | "UPDATE" | "DELETE",
  rowsAffected: number,
): AtelierEnvelope<unknown> {
  return envelope({ outcome: "ok", statementType, statementTypeName, content: [], rowsAffected });
}

/** The result of an executed statement that is not a SELECT, INSERT, UPDATE or DELETE (DDL, CALL). */
export function executedOther(
  statementType: number,
  statementTypeName: string,
  content: SqlRow[] = [],
): AtelierEnvelope<unknown> {
  return envelope({ outcome: "ok", statementType, statementTypeName, content });
}

/** The result of a statement the endpoint declined or rolled back. */
export function declined(
  outcome: "readOnly" | "countOnly" | "capNotCountable" | "overCap" | "transactionEnded",
  statementType: number,
  statementTypeName: string,
  extra: Record<string, unknown> = {},
): AtelierEnvelope<unknown> {
  return envelope({ outcome, statementType, statementTypeName, ...extra });
}

/**
 * The request body a call with no new control sends: the explicit defaults for `readOnly`,
 * `countOnly` and `maxRowsAffected`, in the namespace the call resolved to.
 */
export function endpointBody(
  query: string,
  overrides: Record<string, unknown> = {},
  namespace = "USER",
): Record<string, unknown> {
  return { query, namespace, readOnly: false, countOnly: false, maxRowsAffected: null, ...overrides };
}
