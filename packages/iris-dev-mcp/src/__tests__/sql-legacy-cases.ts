/**
 * Story 38.5 (AD-15, AC-5) - the pre-feature results of `iris_sql_execute`, as literals.
 *
 * Each case is a call that used no Story 38.5 control, the rows the SQL endpoint returned for it, and the
 * `structuredContent` the tool returned before Story 38.5 for those rows. `sql.test.ts` runs every case
 * through the tool and requires `structuredContent` to equal the literal and the text block to equal
 * `JSON.stringify(literal, null, 2)`, so a new field on a call that uses no new control fails the test.
 *
 * The literals were checked against the pre-feature tool: the same cases were run through the
 * `sqlExecuteTool` handler of commit 4eb8ad4 (the Atelier `action/query` mapping), which returned each
 * literal exactly (Rule #36). They are never edited to match the new code.
 */

import type { SqlRow } from "./sql-test-support.js";

/** One pre-feature call and its result. */
export interface LegacyCase {
  /** What the case exercises. */
  id: string;
  /** The tool arguments; none uses a Story 38.5 control. */
  args: { query: string; parameters?: unknown[]; maxRows?: number; namespace?: string };
  /** `ctx.config` fields the case sets (`sqlMaxRows`, `sqlTimeoutMs`). */
  config?: { sqlMaxRows?: number };
  /** The rows the endpoint returned. */
  rows: SqlRow[];
  /** The `structuredContent` the tool returned before Story 38.5. */
  expected: Record<string, unknown>;
}

const ids = (count: number): SqlRow[] => Array.from({ length: count }, (_, i) => ({ ID: i }));
const idRows = (from: number, to: number): unknown[][] =>
  Array.from({ length: to - from }, (_, i) => [from + i]);
const nameRows = (count: number): SqlRow[] => Array.from({ length: count }, (_, i) => ({ ID: i, Name: `Name${i}` }));

export const LEGACY_CASES: LegacyCase[] = [
  {
    id: "columns and rows, in the first row's key order",
    args: { query: "SELECT ID, Name, DOB FROM Sample.Person" },
    rows: [
      { ID: 1, Name: "Smith", DOB: "1990-01-01" },
      { ID: 2, Name: "Jones", DOB: "1985-06-15" },
    ],
    expected: {
      columns: ["ID", "Name", "DOB"],
      rows: [
        [1, "Smith", "1990-01-01"],
        [2, "Jones", "1985-06-15"],
      ],
      rowCount: 2,
    },
  },
  {
    id: "a parameterized query",
    args: { query: "SELECT ID, Name FROM Sample.Person WHERE ID = ?", parameters: [1] },
    rows: [{ ID: 1, Name: "Smith" }],
    expected: { columns: ["ID", "Name"], rows: [[1, "Smith"]], rowCount: 1 },
  },
  {
    id: "maxRows below the row count",
    args: { query: "SELECT ID, Name FROM Sample.Person", maxRows: 10 },
    rows: nameRows(50),
    expected: {
      columns: ["ID", "Name"],
      rows: Array.from({ length: 10 }, (_, i) => [i, `Name${i}`]),
      rowCount: 10,
      truncated: true,
      totalAvailable: 50,
    },
  },
  {
    id: "the default maxRows of 1000",
    args: { query: "SELECT ID FROM Sample.Person" },
    rows: ids(1500),
    expected: { columns: ["ID"], rows: idRows(0, 1000), rowCount: 1000, truncated: true, totalAvailable: 1500 },
  },
  {
    id: "a namespace override",
    args: { query: "SELECT 1", namespace: "HSCUSTOM" },
    rows: [{ ID: 1 }],
    expected: { columns: ["ID"], rows: [[1]], rowCount: 1 },
  },
  {
    id: "an empty parameters array",
    args: { query: "SELECT 1", parameters: [] },
    rows: [{ ID: 1 }],
    expected: { columns: ["ID"], rows: [[1]], rowCount: 1 },
  },
  {
    id: "an empty result",
    args: { query: "SELECT ID, Name FROM Sample.Person WHERE 1=0" },
    rows: [],
    expected: { columns: [], rows: [], rowCount: 0 },
  },
  {
    id: "values of every JSON kind are passed through",
    args: { query: "SELECT a, b, c, d, e FROM T" },
    rows: [{ a: null, b: true, c: { x: 1 }, d: [1, 2], e: "text" }],
    expected: { columns: ["a", "b", "c", "d", "e"], rows: [[null, true, { x: 1 }, [1, 2], "text"]], rowCount: 1 },
  },
  {
    id: "maxRows below the row count, no operator cap",
    args: { query: "SELECT ID FROM Sample.Person", maxRows: 10 },
    rows: ids(50),
    expected: { columns: ["ID"], rows: idRows(0, 10), rowCount: 10, truncated: true, totalAvailable: 50 },
  },
  {
    id: "IRIS_SQL_MAX_ROWS below the request",
    args: { query: "SELECT ID FROM Sample.Person", maxRows: 20 },
    config: { sqlMaxRows: 5 },
    rows: ids(50),
    expected: { columns: ["ID"], rows: idRows(0, 5), rowCount: 5, truncated: true, totalAvailable: 50, rowsCapped: true },
  },
  {
    id: "IRIS_SQL_MAX_ROWS above the request",
    args: { query: "SELECT ID FROM Sample.Person", maxRows: 20 },
    config: { sqlMaxRows: 1000 },
    rows: ids(50),
    expected: { columns: ["ID"], rows: idRows(0, 20), rowCount: 20, truncated: true, totalAvailable: 50 },
  },
  {
    id: "IRIS_SQL_MAX_ROWS equal to the default request",
    args: { query: "SELECT ID FROM Sample.Person" },
    config: { sqlMaxRows: 1000 },
    rows: ids(2000),
    expected: { columns: ["ID"], rows: idRows(0, 1000), rowCount: 1000, truncated: true, totalAvailable: 2000 },
  },
  {
    id: "IRIS_SQL_MAX_ROWS above the row count, below the request",
    args: { query: "SELECT ID FROM Sample.Person", maxRows: 20 },
    config: { sqlMaxRows: 5 },
    rows: ids(3),
    expected: { columns: ["ID"], rows: idRows(0, 3), rowCount: 3, rowsCapped: true },
  },
  {
    id: "IRIS_SQL_MAX_ROWS well below the row count",
    args: { query: "SELECT ID FROM Sample.Person", maxRows: 100 },
    config: { sqlMaxRows: 7 },
    rows: ids(200),
    expected: { columns: ["ID"], rows: idRows(0, 7), rowCount: 7, truncated: true, totalAvailable: 200, rowsCapped: true },
  },
  {
    id: "IRIS_SQL_MAX_ROWS equal to an explicit maxRows",
    args: { query: "SELECT ID FROM Sample.Person", maxRows: 50 },
    config: { sqlMaxRows: 50 },
    rows: ids(100),
    expected: { columns: ["ID"], rows: idRows(0, 50), rowCount: 50, truncated: true, totalAvailable: 100 },
  },
  {
    id: "IRIS_SQL_MAX_ROWS below the default request",
    args: { query: "SELECT ID FROM Sample.Person" },
    config: { sqlMaxRows: 200 },
    rows: ids(500),
    expected: { columns: ["ID"], rows: idRows(0, 200), rowCount: 200, truncated: true, totalAvailable: 500, rowsCapped: true },
  },
  {
    id: "IRIS_SQL_MAX_ROWS well below a large request",
    args: { query: "SELECT ID FROM Sample.Person", maxRows: 15 },
    config: { sqlMaxRows: 4 },
    rows: ids(30),
    expected: { columns: ["ID"], rows: idRows(0, 4), rowCount: 4, truncated: true, totalAvailable: 30, rowsCapped: true },
  },
];
