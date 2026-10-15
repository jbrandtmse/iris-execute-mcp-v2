/**
 * Raw Atelier document helpers shared by the live-IRIS gates that write disposable documents
 * (`doc-put-bom-live-gate.test.ts`, `doc-get-range-live-gate.test.ts`,
 * `doc-put-storage-guard-live-gate.test.ts`).
 *
 * Not a test file: each gate keeps its own setup and its own `IRIS_REQUIRE_LIVE ===` arming
 * comparison, so `live-gate-roster.test.ts` still sees every armed gate. Every helper takes the
 * target explicitly (client, negotiated Atelier version, namespace) and the FULL document name
 * with its extension (`Pkg.Name.cls`, `Pkg.Name.mac`).
 */

import { IrisApiError, atelierDocStatusError, atelierPath, type IrisHttpClient } from "@iris-mcp/shared";

/** The nine keys of an Atelier `PUT /doc` result, and of the current document in its HTTP 409. */
export interface AtelierDocResult {
  name: string;
  db: string;
  ts: string;
  upd: boolean;
  cat: string;
  status: string;
  enc: boolean;
  flags: number;
  content: string[];
}

/** The Atelier `/doc` path of `docName` in `namespace`. */
export function docPath(version: number, namespace: string, docName: string): string {
  return atelierPath(version, namespace, `doc/${encodeURIComponent(docName)}`);
}

/** The stored document's lines, or `undefined` when IRIS has no such document. */
export async function readStoredLines(
  client: IrisHttpClient,
  version: number,
  namespace: string,
  docName: string,
): Promise<string[] | undefined> {
  try {
    const response = await client.get(docPath(version, namespace, docName));
    const result = response.result as { content?: unknown };
    return Array.isArray(result.content) ? (result.content as string[]) : [];
  } catch (error) {
    if (error instanceof IrisApiError && error.statusCode === 404) return undefined;
    throw error;
  }
}

/** Delete the document; a document that does not exist is not an error. */
export async function removeStored(
  client: IrisHttpClient,
  version: number,
  namespace: string,
  docName: string,
): Promise<void> {
  try {
    await client.delete(docPath(version, namespace, docName));
  } catch (error) {
    if (error instanceof IrisApiError && error.statusCode === 404) return;
    throw error;
  }
}

/**
 * A raw Atelier PUT, optionally with request headers (for example `If-None-Match`). IRIS refusing the
 * document inside an HTTP 200 envelope is a gate failure; an HTTP error propagates as `IrisApiError`.
 *
 * @returns The `result` of the response.
 */
export async function putDocLines(
  client: IrisHttpClient,
  version: number,
  namespace: string,
  docName: string,
  lines: string[],
  headers?: Record<string, string>,
): Promise<AtelierDocResult> {
  const response = await client.put(
    docPath(version, namespace, docName),
    { enc: false, content: lines },
    headers ? { headers } : undefined,
  );
  const refusal = atelierDocStatusError(response.result);
  if (refusal !== undefined) throw new Error(`IRIS refused ${docName}: ${refusal}`);
  return response.result as AtelierDocResult;
}

/** The status code of the IrisApiError a raw PUT throws; fails when the PUT is accepted. */
export async function putStatus(
  client: IrisHttpClient,
  version: number,
  namespace: string,
  docName: string,
  lines: string[],
  headers?: Record<string, string>,
): Promise<number> {
  try {
    await putDocLines(client, version, namespace, docName, lines, headers);
  } catch (error) {
    if (error instanceof IrisApiError) return error.statusCode;
    throw error;
  }
  throw new Error(`the PUT to ${docName} was accepted; a refusal was expected`);
}

/**
 * Compile documents with the server's default qualifiers. A compile that does not finish
 * successfully is a gate failure.
 *
 * @returns The compiler's console lines.
 */
export async function compileDocs(
  client: IrisHttpClient,
  version: number,
  namespace: string,
  names: string[],
): Promise<string[]> {
  const response = await client.post(atelierPath(version, namespace, "action/compile"), names);
  const lines = response.console ?? [];
  if (!lines.some((line) => /Compilation finished successfully/.test(line))) {
    throw new Error(`compiling ${names.join(", ")} did not finish successfully: ${lines.join(" | ")}`);
  }
  return lines;
}

/** Run one SQL statement (a query or DML) with the Atelier query action and return its rows. */
export async function runQuery(
  client: IrisHttpClient,
  version: number,
  namespace: string,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await client.post(atelierPath(version, namespace, "action/query"), { query: sql });
  const result = response.result as { content?: unknown };
  return Array.isArray(result.content) ? (result.content as Array<Record<string, unknown>>) : [];
}
