/**
 * The Cobertura XML document of a finished coverage run, and the guarded write of it (Story 40.2).
 *
 * The document is built from the run's class-source coverage ({@link ./coverage-report.ts}) and is deterministic for a
 * given run: the timestamp is the run's `finishedAt`, and every ordering is the run's own. It follows the published
 * `coverage-04.dtd`: a `<package>` per class package in first-seen order, a `<class>` per measured class with a class-source
 * result (its `filename` is the path `iris_doc_export` writes the class to, relative to its `destinationDir`), a `<method>` per
 * mapped method that has an executable class line (without a `complexity` attribute, which the published DTD does not
 * declare), and one `<line number hits/>` per executable class line. Branches are not measured, so every branch rate and
 * complexity is 0. Generated INT lines, classes without a class-source result and unmeasured classes are left out.
 */

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { docNameToFilePath } from "./load.js";
import { validateLocalPath } from "./local-path.js";
import { hasSourceResult, mapSources, type MappedClass } from "./coverage-report.js";
import type { CoverageRun, CoverageSection } from "./test-coverage.js";

/** The DOCTYPE the document names (the URL coverage.py also names). It is never fetched. */
const DOCTYPE =
  '<!DOCTYPE coverage SYSTEM "https://raw.githubusercontent.com/cobertura/web/master/htdocs/xml/coverage-04.dtd">';

export interface CoberturaOptions {
  /** The one `<source>` of the document; `<sources>` is left out without it. */
  sourceRoot?: string;
  /** The `@iris-mcp/dev` version, written as `iris-mcp-dev <version>`. */
  version: string;
}

export interface CoberturaDocument {
  xml: string;
  /** The `<class>` elements in the document. */
  classes: number;
  /** The `<line>` elements of the classes' own `<lines>` (the executable class lines). */
  lines: number;
}

/** Escape text for an attribute value or element content. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `covered / valid` rounded to 4 decimal places, written without trailing zeros, and `1` when nothing is valid. */
export function formatRate(covered: number, valid: number): string {
  if (valid === 0) return "1";
  return String(Math.round((covered / valid) * 10000) / 10000);
}

/** The package of a class: its name without the last segment. */
function packageOf(className: string): string {
  const dot = className.lastIndexOf(".");
  return dot < 0 ? "" : className.slice(0, dot);
}

/** The path `iris_doc_export` writes class `className` to, relative to its `destinationDir`. */
function filenameOf(className: string): string {
  return docNameToFilePath(`${className}.cls`, "").replace(/^\/+/, "");
}

interface ClassEntry {
  mapped: MappedClass;
  valid: number;
  covered: number;
}

/**
 * Build the Cobertura document of a completed run.
 *
 * @param run - The run record (it carries the class-source map and the INT data).
 * @param coverage - The run's coverage section; only the classes with a class-source result are written, in its order.
 * @param options - The source root and the producer version.
 */
export function buildCoberturaXml(run: CoverageRun, coverage: CoverageSection, options: CoberturaOptions): CoberturaDocument {
  const mappedByClass = new Map(mapSources(run).map((mapped) => [mapped.class, mapped] as const));
  const packages = new Map<string, ClassEntry[]>();
  let totalValid = 0;
  let totalCovered = 0;
  let classCount = 0;
  for (const entry of coverage.classes) {
    const mapped = mappedByClass.get(entry.class);
    if (mapped === undefined || !hasSourceResult(entry.source)) continue;
    const lines = mapped.methods.flatMap((method) => method.lines);
    const covered = lines.filter((line) => line.hits > 0).length;
    const list = packages.get(packageOf(entry.class)) ?? [];
    list.push({ mapped, valid: lines.length, covered });
    packages.set(packageOf(entry.class), list);
    totalValid += lines.length;
    totalCovered += covered;
    classCount++;
  }

  const timestamp = run.finishedAt ? Date.parse(run.finishedAt) : 0;
  const out: string[] = [];
  out.push('<?xml version="1.0" ?>');
  out.push(DOCTYPE);
  out.push(
    `<coverage line-rate="${formatRate(totalCovered, totalValid)}" branch-rate="0" lines-covered="${totalCovered}" ` +
      `lines-valid="${totalValid}" branches-covered="0" branches-valid="0" complexity="0" ` +
      `version="${escapeXml(`iris-mcp-dev ${options.version}`)}" timestamp="${Number.isFinite(timestamp) ? timestamp : 0}">`,
  );
  if (options.sourceRoot !== undefined) {
    out.push("  <sources>");
    out.push(`    <source>${escapeXml(options.sourceRoot)}</source>`);
    out.push("  </sources>");
  }
  out.push("  <packages>");
  for (const [packageName, classes] of packages) {
    const valid = classes.reduce((sum, entry) => sum + entry.valid, 0);
    const covered = classes.reduce((sum, entry) => sum + entry.covered, 0);
    out.push(
      `    <package name="${escapeXml(packageName)}" line-rate="${formatRate(covered, valid)}" branch-rate="0" complexity="0">`,
    );
    out.push("      <classes>");
    for (const entry of classes) {
      const { mapped } = entry;
      out.push(
        `        <class name="${escapeXml(mapped.class)}" filename="${escapeXml(filenameOf(mapped.class))}" ` +
          `line-rate="${formatRate(entry.covered, entry.valid)}" branch-rate="0" complexity="0">`,
      );
      out.push("          <methods>");
      for (const method of mapped.methods) {
        if (method.lines.length === 0) continue;
        const methodCovered = method.lines.filter((line) => line.hits > 0).length;
        out.push(
          `            <method name="${escapeXml(method.name)}" signature="" ` +
            `line-rate="${formatRate(methodCovered, method.lines.length)}" branch-rate="0">`,
        );
        out.push("              <lines>");
        for (const line of method.lines) out.push(`                <line number="${line.line}" hits="${line.hits}"/>`);
        out.push("              </lines>");
        out.push("            </method>");
      }
      out.push("          </methods>");
      out.push("          <lines>");
      const classLines = mapped.methods.flatMap((method) => method.lines).sort((a, b) => a.line - b.line);
      for (const line of classLines) out.push(`            <line number="${line.line}" hits="${line.hits}"/>`);
      out.push("          </lines>");
      out.push("        </class>");
    }
    out.push("      </classes>");
    out.push("    </package>");
  }
  out.push("  </packages>");
  out.push("</coverage>");
  return { xml: `${out.join("\n")}\n`, classes: classCount, lines: totalValid };
}

/**
 * The error text for an `outputPath` that is not acceptable, or `undefined`. It must pass `iris_doc_export`'s path guard
 * (absolute, no `..` segment) under the label `outputPath`, and end in `.xml` (any letter case).
 *
 * @param outputPath - The caller's path.
 */
export function validateOutputPath(outputPath: string): string | undefined {
  const guard = validateLocalPath(outputPath, "outputPath");
  if (guard) return guard;
  if (!/\.xml$/i.test(outputPath)) return `outputPath '${outputPath}' must end in .xml`;
  return undefined;
}

/**
 * Write `xml` to `outputPath`: the parent directory is created recursively, the content goes to a temporary sibling, and
 * the sibling is renamed over `outputPath` (an existing file is overwritten). The path guard runs first.
 *
 * @param outputPath - An absolute path ending in `.xml`.
 * @param xml - The document.
 * @returns The resolved absolute path and the number of bytes written.
 * @throws When the path is not acceptable or a file system step fails; the temporary file is removed.
 */
export async function writeCoberturaFile(outputPath: string, xml: string): Promise<{ outputPath: string; bytes: number }> {
  const invalid = validateOutputPath(outputPath);
  if (invalid) throw new Error(invalid);
  const resolved = path.resolve(outputPath);
  const directory = path.dirname(resolved);
  const temporary = path.join(directory, `.${path.basename(resolved)}.${process.pid}.${Date.now()}.tmp`);
  const buffer = Buffer.from(xml, "utf-8");
  await fsp.mkdir(directory, { recursive: true });
  try {
    await fsp.writeFile(temporary, buffer);
    await fsp.rename(temporary, resolved);
  } catch (error: unknown) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
  return { outputPath: resolved, bytes: buffer.length };
}
