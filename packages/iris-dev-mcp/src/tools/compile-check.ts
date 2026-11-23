/**
 * The compile check of the compiling dev tools (Story 44.7, DW-754, DW-755 and DW-759; AD-14).
 *
 * An HTTP 200 from `action/compile` is not proof that every document compiled: IRIS can answer 200 with no status error and no
 * per-document error although a class or a routine failed, when the same compile also writes the Storage of a persistent class
 * (probed 2026-11-23, irishealth-community 2026.2). `verifyCompiled` and `verifyRoutinesCompiled` (`@iris-mcp/shared`) decide
 * from the class dictionary and IRIS's own up-to-date flag and read no localized text, so `iris_doc_compile`, `iris_doc_load`
 * and `iris_env_promote` call them after a sync compile that IRIS answered without an error, and map each document they do not
 * confirm to the failure the tool already reports. This module owns only that mapping's shared pieces: the document filters and
 * the texts, so the three tools say the same thing.
 *
 * Judged: classes (`.cls`) and routines (`.mac`). Not judged: include files (`.inc`, whose up-to-date flag is true whether or not
 * anything compiled it) and `.int` routines (whose flag is true after a failed compile), and every other document type.
 */

import { verifyCompiled, verifyRoutinesCompiled, type IrisHttpClient } from "@iris-mcp/shared";

/** True for a class document name (`Pkg.Name.cls`): the class dictionary and IRIS's up-to-date flag decide it. */
export function isCheckableClass(name: string): boolean {
  // The extension is matched as `verifyCompiled` matches it (lower case), so a name it would refuse is never handed to it.
  return name.endsWith(".cls") && name.length > ".cls".length;
}

/** True for a routine document name (`Pkg.Name.mac`): IRIS's up-to-date flag decides it. */
export function isCheckableRoutine(name: string): boolean {
  return name.endsWith(".mac") && name.length > ".mac".length;
}

/**
 * The documents among `names` that the check does not confirm as compiled, in the order of `names`: classes by the class
 * dictionary and IRIS's up-to-date flag, `.mac` routines by IRIS's up-to-date flag. Other documents are not checked. The reads:
 * one dictionary query per 100 classes and one `docnames/CLS` listing per package root of the classes, one `docnames/RTN`
 * listing per package root of the routines, none when there is nothing to check.
 *
 * @throws Whatever the requests throw: a check that cannot run is never a pass, so the caller reports it.
 */
export async function unconfirmedDocuments(
  http: IrisHttpClient,
  namespace: string,
  version: number,
  names: readonly string[],
): Promise<string[]> {
  const classes = names.filter(isCheckableClass);
  const routines = names.filter(isCheckableRoutine);
  const notConfirmed = new Set<string>();
  if (classes.length > 0) for (const name of await verifyCompiled(http, namespace, version, classes)) notConfirmed.add(name);
  if (routines.length > 0) for (const name of await verifyRoutinesCompiled(http, namespace, version, routines)) notConfirmed.add(name);
  return names.filter((name) => notConfirmed.has(name));
}

/** The error text for a document that the check does not confirm. */
export function notConfirmedText(document: string): string {
  const evidence = isCheckableRoutine(document) ? "IRIS's up-to-date flag does not confirm it" : "the class dictionary and IRIS's up-to-date flag do not confirm it";
  return `${document} did not compile: ${evidence} (IRIS answered the compile without a status error; see console)`;
}

/** The error text for a check that could not run: the compile is then a failure, never a pass. */
export function checkCouldNotRunText(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `the check that every class compiled could not run: ${reason}`;
}
