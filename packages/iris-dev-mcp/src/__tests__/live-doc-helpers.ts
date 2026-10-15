/**
 * Raw Atelier document helpers shared by the live-IRIS gates that write disposable documents
 * (`doc-put-bom-live-gate.test.ts`, `doc-get-range-live-gate.test.ts`).
 *
 * Not a test file: each gate keeps its own setup and its own `IRIS_REQUIRE_LIVE ===` arming
 * comparison, so `live-gate-roster.test.ts` still sees every armed gate. Every helper takes the
 * target explicitly (client, negotiated Atelier version, namespace) and the FULL document name
 * with its extension (`Pkg.Name.cls`, `Pkg.Name.mac`).
 */

import { IrisApiError, atelierPath, type IrisHttpClient } from "@iris-mcp/shared";

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
