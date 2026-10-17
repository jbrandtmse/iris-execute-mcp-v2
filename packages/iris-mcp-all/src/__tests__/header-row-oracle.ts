/**
 * The independent oracle for header rows, shared by the live gates that search `Ens.MessageHeader`
 * (Stories 39.1 and 39.3). It turns a row of the raw Atelier `action/query` route into the row the
 * `iris_message_search` tool must return, using nothing from the code under test: the labels, the
 * time conversion and the NULL handling are written out here.
 */

import { atelierQuery, type AtelierRow, type IrisTarget } from "./process-gate-helpers.js";

/** The header columns every search row is read from, in order. */
const BASE_COLUMNS = [
  "ID",
  "SessionId",
  "Type",
  "Status",
  "IsError",
  "SourceConfigName",
  "TargetConfigName",
  "MessageBodyClassName",
  "MessageBodyId",
  "TimeCreated",
  "TimeProcessed",
  "CorrespondingMessageId",
] as const;

/**
 * The oracle's select list, each column prefixed with `alias.` when one is given. The raw Atelier query
 * route renders a SQL NULL integer as 0, so whether `CorrespondingMessageId` is NULL is read from its
 * own column, `CorrespondingIsNull`.
 */
export function oracleColumns(alias = ""): string {
  const prefix = alias === "" ? "" : `${alias}.`;
  const columns = BASE_COLUMNS.map((column) => `${prefix}${column}`).join(", ");
  return `${columns}, CASE WHEN ${prefix}CorrespondingMessageId IS NULL THEN 1 ELSE 0 END AS CorrespondingIsNull`;
}

const TYPE_LABELS: Record<number, string> = { 1: "Request", 2: "Response", 3: "Terminate" };
const STATUS_ROW_LABELS = ["Created", "Queued", "Delivered", "Discarded", "Suspended", "Deferred", "Aborted", "Error", "Completed"];

/** A stored UTC value as `toISOString()` UTC, or `""`. */
export function isoOf(stored: string): string {
  return stored === "" ? "" : new Date(`${stored.replace(" ", "T")}Z`).toISOString();
}

/** A SQL string literal: single-quoted, with each quote doubled. */
export const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/**
 * The hand-written JOIN oracle (Rule #36) of the body-search gates: the headers of `bodyClass` inside
 * `windowSql` whose body row in `table` satisfies `predicate`, in `TimeCreated, ID` order, as the tool
 * must return them. `predicate` and `windowSql` are written by hand with literals (aliases `h` and `b`);
 * `extra` adds header conditions. It runs through the raw Atelier route against `namespace`.
 */
export async function bodyJoinOracle(
  target: IrisTarget,
  namespace: string,
  table: string,
  bodyClass: string,
  windowSql: string,
  predicate: string,
  extra = "",
): Promise<Array<Record<string, unknown>>> {
  const rows = await atelierQuery(
    { ...target, namespace },
    `SELECT ${oracleColumns("h")} FROM Ens.MessageHeader h JOIN ${table} b ON b.%ID = h.MessageBodyId ` +
      `WHERE h.MessageBodyClassName = ${sqlLiteral(bodyClass)} AND ${windowSql}${extra} AND ${predicate} ` +
      "ORDER BY h.TimeCreated, h.ID",
  );
  return rows.map(expectedRow);
}

/** The row the tool must return for an oracle row. */
export function expectedRow(row: AtelierRow): Record<string, unknown> {
  const created = String(row["TimeCreated"] ?? "");
  const processed = row["TimeProcessed"] === null || row["TimeProcessed"] === undefined ? "" : String(row["TimeProcessed"]);
  return {
    id: Number(row["ID"]),
    sessionId: Number(row["SessionId"]),
    type: TYPE_LABELS[Number(row["Type"])] ?? "Unknown",
    status: STATUS_ROW_LABELS[Number(row["Status"]) - 1] ?? "",
    isError: Number(row["IsError"]) === 1,
    sourceItem: String(row["SourceConfigName"]),
    targetItem: String(row["TargetConfigName"]),
    bodyClassName: String(row["MessageBodyClassName"]),
    bodyId: String(row["MessageBodyId"]),
    timeCreated: isoOf(created),
    timeCreatedRaw: created,
    timeProcessed: isoOf(processed),
    timeProcessedRaw: processed,
    correspondingMessageId: Number(row["CorrespondingIsNull"]) === 1 ? null : Number(row["CorrespondingMessageId"]),
  };
}
