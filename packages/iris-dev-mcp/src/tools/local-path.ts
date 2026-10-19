/**
 * The path guard of every tool that writes a caller-supplied local path (`iris_doc_export`'s `destinationDir`,
 * `iris_test_status`' `outputPath`).
 *
 * The guard is one function so that the rules cannot drift apart: the path must be a non-empty string, must not
 * contain a `..` segment (in either separator style) and must be absolute. The label names the argument in the
 * error text.
 */

import * as path from "node:path";

/**
 * Hard-reject any user-supplied path that contains `..` segments or that does not resolve to an absolute location on
 * disk.
 *
 * @param value - The caller's path.
 * @param label - The argument's name, as the error text shows it (for example `destinationDir`).
 * @returns An error message string, or `undefined` if the path is safe.
 */
export function validateLocalPath(value: string, label: string): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return `${label} must be a non-empty string`;
  }
  // Reject if the raw input contains traversal syntax.
  const norm = value.replace(/\\/g, "/");
  if (norm.split("/").some((seg) => seg === "..")) {
    return `${label} '${value}' must not contain '..' (path traversal)`;
  }
  if (!path.isAbsolute(value)) {
    return `${label} '${value}' must be an absolute path`;
  }
  return undefined;
}

/**
 * Assert that a resolved local path stays inside the root. Throws on escape (returned as a hard error, not a skip,
 * because this would indicate a server-controlled document name trying to write outside the caller's chosen sandbox).
 *
 * @param resolvedPath - The absolute path about to be written.
 * @param root - The caller's root directory.
 * @param label - The argument that names the root, as the error text shows it.
 */
export function assertInsideRoot(resolvedPath: string, root: string, label = "destinationDir"): void {
  const rootResolved = path.resolve(root);
  const rootWithSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  if (resolvedPath !== rootResolved && !resolvedPath.startsWith(rootWithSep)) {
    throw new Error(`Refusing to write '${resolvedPath}': resolves outside ${label} '${rootResolved}'`);
  }
}
