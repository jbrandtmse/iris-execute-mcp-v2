/**
 * The independent oracle for header rows, shared by the live gates that search `Ens.MessageHeader`
 * (Stories 39.1, 39.3 and 39.4). It turns a row of the raw Atelier `action/query` route into the row the
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

/** Ignore case and white space: the statement index stores a statement upper-cased and tokenized. */
export const squash = (text: string): string => text.replace(/\s+/g, "").toUpperCase();

/** The twelve header columns the search route selects, written by hand. */
export const HEADER_COLUMNS =
  "h.ID, h.SessionId, h.Type, h.Status, h.IsError, h.SourceConfigName, h.TargetConfigName, h.MessageBodyClassName, h.MessageBodyId, h.TimeCreated, h.TimeProcessed, h.CorrespondingMessageId";

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

/**
 * One Search Table condition of the Story 39.4 oracle: `h.MessageBodyId [NOT] IN (...)` over the entries of
 * the property `propName` of the Search Table extent `classExtent` (its table is `extentTable`). The
 * PropId is resolved by this SQL's own join on `Ens_Config.SearchTableProp`, never taken from the code
 * under test. `predicate` is written by hand with literals on the stored form (alias `s`). `negate` selects
 * the messages with no entry that satisfies it, which is how the oracle writes `ne` and `isNull`.
 */
export function searchTableCondition(
  extentTable: string,
  classExtent: string,
  propName: string,
  predicate: string,
  negate = false,
): string {
  return (
    `h.MessageBodyId ${negate ? "NOT IN" : "IN"} (SELECT s.DocId FROM ${extentTable} s, Ens_Config.SearchTableProp p ` +
    `WHERE p.ClassExtent = ${sqlLiteral(classExtent)} AND p.Name = ${sqlLiteral(propName)} AND s.PropId = p.PropId AND ${predicate})`
  );
}

/**
 * The hand-written `IN` / `NOT IN` oracle (Rule #36) of the Search Table gate: the `EnsLib.HL7.Message`
 * headers inside `windowSql` whose body ID is (or, with `negate`, is not) among the entries of `propName`
 * that satisfy `predicate`, in `TimeCreated, ID` order, as the tool must return them. `extra` adds further
 * header conditions (it starts with ` AND `). It runs through the raw Atelier route against `namespace`.
 */
export async function searchTableOracle(
  target: IrisTarget,
  namespace: string,
  extentTable: string,
  classExtent: string,
  propName: string,
  windowSql: string,
  predicate: string,
  negate = false,
  extra = "",
): Promise<Array<Record<string, unknown>>> {
  const rows = await atelierQuery(
    { ...target, namespace },
    `SELECT ${oracleColumns("h")} FROM Ens.MessageHeader h WHERE h.MessageBodyClassName = 'EnsLib.HL7.Message' ` +
      `AND ${windowSql}${extra} AND ${searchTableCondition(extentTable, classExtent, propName, predicate, negate)} ` +
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
