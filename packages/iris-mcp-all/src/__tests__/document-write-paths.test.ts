/**
 * Story 38.3 (AC-6, AD-24) - every path that writes a document has a recorded verdict.
 *
 * AD-24 requires a verdict for every document-writing path, exhaustive as of a named date, and a grep
 * test that fails on any path with none. This test reads the source files from disk (Rule #45:
 * cross-package checks live in `@iris-mcp/all`), finds every occurrence of each write-path pattern, and
 * requires the found set to equal `DOCUMENT_WRITE_PATHS` exactly: a new write path turns it red, and so
 * does a roster entry whose path is gone.
 *
 * The roster is exhaustive as of 2026-10-15 (Story 38.3). To add a path, add a roster entry with one of
 * the four verdicts:
 *  - `guarded`: the Storage-drop guard covers it;
 *  - `excluded`: no guard, by decision, with a ledger id whose `reopen_if` says when to reopen it;
 *  - `not-applicable`: the target has no Storage definitions to lose, with the reason;
 *  - `not-a-document-write`: it does not write a document, with the reason.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

type Verdict = "guarded" | "excluded" | "not-applicable" | "not-a-document-write";

interface WritePath {
  /** Repo-relative path, with `/` separators. */
  file: string;
  /** The pattern's name in {@link PATTERNS}. */
  pattern: PatternName;
  /** How many times the pattern occurs in the file. */
  count: number;
  verdict: Verdict;
  reason: string;
  /** The deferred-work ledger id of an `excluded` path. */
  ledger?: string;
}

type Language = "typescript" | "objectscript";

interface Pattern {
  /** The source languages the pattern is looked for in. */
  languages: Language[];
  expression: RegExp;
}

const PATTERNS = {
  put: { languages: ["typescript"], expression: /\.put(?:<[^>(]*>)?\(/g },
  xmlLoad: { languages: ["typescript"], expression: /["'`]action\/xml\/load/g },
  saveToClass: { languages: ["objectscript"], expression: /SaveToClass\(/g },
  enableConfigItem: { languages: ["objectscript"], expression: /EnableConfigItem\(/g },
  createApplication: { languages: ["objectscript"], expression: /CreateApplication\(/g },
  dictionaryNew: { languages: ["objectscript"], expression: /##class\(%Dictionary\.\w+Definition\)\.%New\(/g },
} satisfies Record<string, Pattern>;

type PatternName = keyof typeof PATTERNS;

/** Constructs that would be a document write the roster does not model: none may exist anywhere. */
const FORBIDDEN: Array<{ label: string; expression: RegExp }> = [
  { label: "OBJ.Load* / OBJ.Import*", expression: /\bOBJ\)?\.(?:Load|Import)\w*\(/gi },
  { label: "ImportDir", expression: /ImportDir/gi },
  { label: "SetTextFrom*", expression: /SetTextFrom\w*/g },
  { label: "%Routine / %RoutineMgr %New", expression: /##class\(%(Routine|RoutineMgr)\)\.%New\(/g },
];

const INTEROP = "src/ExecuteMCPv2/REST/Interop.cls";

/** Every document-writing path as of 2026-10-15, in the order the verdicts are recorded. */
export const DOCUMENT_WRITE_PATHS: readonly WritePath[] = [
  {
    file: "packages/iris-dev-mcp/src/tools/doc.ts",
    pattern: "put",
    count: 4,
    verdict: "guarded",
    reason: "iris_doc_put: for a class without allowStorageRegeneration, the 409 that the unversioned PUT draws feeds the Storage-drop guard before any write (a refused drop sends no write); a non-class document, and a class with allowStorageRegeneration, are not guarded",
  },
  {
    file: "packages/iris-dev-mcp/src/tools/load.ts",
    pattern: "put",
    count: 1,
    verdict: "excluded",
    reason: "iris_doc_load uploads files with ignoreConflict on by default and the file is the source of truth for the class text",
    ledger: "DW-544",
  },
  {
    file: "packages/iris-dev-mcp/src/tools/env-promote.ts",
    pattern: "put",
    count: 1,
    verdict: "excluded",
    reason: "iris_env_promote execute: a sync replaces the target's class, Storage included, by design; plan-gated and default-disabled",
    ledger: "DW-545",
  },
  {
    file: "packages/iris-dev-mcp/src/tools/format.ts",
    pattern: "xmlLoad",
    count: 1,
    verdict: "excluded",
    reason: "iris_doc_xml_export import: an XML export carries its own Storage elements and is the source of truth for the class it describes",
    ledger: "DW-546",
  },
  {
    file: "packages/shared/src/bootstrap.ts",
    pattern: "put",
    count: 1,
    verdict: "not-applicable",
    reason: "the bootstrap PUTs the embedded ExecuteMCPv2 classes, none of which has a Storage definition (pinned by storage-guard.test.ts)",
  },
  {
    file: "packages/iris-data-mcp/src/tools/docdb.ts",
    pattern: "put",
    count: 1,
    verdict: "not-a-document-write",
    reason: "iris_docdb_document writes a DocDB JSON record through the DocDB REST API, not an Atelier document",
  },
  {
    file: "packages/iris-dev-mcp/src/tools/global.ts",
    pattern: "put",
    count: 1,
    verdict: "not-a-document-write",
    reason: "iris_global_set writes one global node, not a document",
  },
  {
    file: INTEROP,
    pattern: "dictionaryNew",
    count: 2,
    verdict: "not-applicable",
    reason: "production create writes a production class and its XData through the class dictionary; a production class has no Storage definition",
  },
  {
    file: INTEROP,
    pattern: "saveToClass",
    count: 6,
    verdict: "not-applicable",
    reason: "SaveToClass writes a production class's XData; a production class has no Storage definition",
  },
  {
    file: INTEROP,
    pattern: "enableConfigItem",
    count: 2,
    verdict: "not-applicable",
    reason: "EnableConfigItem changes an item's Enabled setting in the production class; a production class has no Storage definition",
  },
  {
    file: INTEROP,
    pattern: "createApplication",
    count: 1,
    verdict: "not-applicable",
    reason: "CreateApplication generates REST dispatch classes from a spec; those classes have no Storage definition",
  },
];

// -- The scan --------------------------------------------------------

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "__tests__"]);

/** Every file under `directory` (repo-relative, `/` separators) that `keep` accepts, in name order. */
function walk(directory: string, keep: (relative: string) => boolean): string[] {
  const absolute = path.join(REPO_ROOT, directory);
  const found: string[] = [];
  let entries;
  try {
    entries = readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return found;
  }
  for (const entry of entries) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) found.push(...walk(relative, keep));
    } else if (entry.isFile() && keep(relative)) {
      found.push(relative);
    }
  }
  return found;
}

const isTypeScriptSource = (relative: string): boolean =>
  relative.endsWith(".ts") && !relative.endsWith(".test.ts") && !relative.endsWith("bootstrap-classes.ts");

/** The packages and extensions that exist on disk: the scan never lists them by hand. */
function directoriesUnder(parent: string): string[] {
  return readdirSync(path.join(REPO_ROOT, parent))
    .filter((name) => statSync(path.join(REPO_ROOT, parent, name)).isDirectory())
    .sort();
}

/** The scanned files, in order, each with its language. */
function scannedFiles(): Array<{ file: string; language: Language }> {
  const files: Array<{ file: string; language: Language }> = [];
  const add = (paths: string[], language: Language): void => {
    for (const file of paths) files.push({ file, language });
  };
  for (const pkg of directoriesUnder("packages")) add(walk(`packages/${pkg}/src`, isTypeScriptSource), "typescript");
  for (const pkg of directoriesUnder("packages")) add(walk(`packages/${pkg}/scripts`, (f) => f.endsWith(".mjs")), "typescript");
  add(walk("scripts", (f) => f.endsWith(".mjs")), "typescript");
  for (const extension of directoriesUnder("extensions")) add(walk(`extensions/${extension}/src`, isTypeScriptSource), "typescript");
  add(
    walk("src/ExecuteMCPv2", (f) => f.endsWith(".cls") && !f.startsWith("src/ExecuteMCPv2/Tests/")),
    "objectscript",
  );
  return files;
}

const countOf = (text: string, expression: RegExp): number => [...text.matchAll(expression)].length;

interface Found {
  file: string;
  pattern: PatternName;
  count: number;
}

function scan(): { found: Found[]; scanned: number; forbidden: string[] } {
  const found: Found[] = [];
  const forbidden: string[] = [];
  const files = scannedFiles();
  for (const { file, language } of files) {
    const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
    for (const [name, pattern] of Object.entries(PATTERNS) as Array<[PatternName, Pattern]>) {
      if (!pattern.languages.includes(language)) continue;
      const count = countOf(text, pattern.expression);
      if (count > 0) found.push({ file, pattern: name, count });
    }
    for (const { label, expression } of FORBIDDEN) {
      const count = countOf(text, expression);
      if (count > 0) forbidden.push(`${file}: ${label} x${count}`);
    }
  }
  return { found, scanned: files.length, forbidden };
}

const key = (entry: Found): string => `${entry.file} :: ${entry.pattern} x${entry.count}`;

describe("every document-writing path has a recorded verdict (Story 38.3, AC-6, AD-24)", () => {
  const { found, scanned, forbidden } = scan();

  it("the scan reads the packages' sources, the scripts, the extension and the IRIS-side classes (an empty scan would pass everything below)", () => {
    expect(scanned).toBeGreaterThan(100);
    const files = scannedFiles().map(({ file }) => file);
    for (const needle of [
      "packages/iris-dev-mcp/src/tools/doc.ts",
      "packages/shared/src/bootstrap.ts",
      "packages/iris-data-mcp/src/tools/docdb.ts",
      "packages/iris-dev-mcp/scripts/prepublish-gate.mjs",
      "scripts/gen-bootstrap.mjs",
      "extensions/iris-mcp-launcher/src/extension.ts",
      INTEROP,
    ]) {
      expect(files, needle).toContain(needle);
    }
    expect(files.some((file) => file.includes("/__tests__/") || file.endsWith(".test.ts"))).toBe(false);
    expect(files.some((file) => file.startsWith("src/ExecuteMCPv2/Tests/"))).toBe(false);
    expect(files.some((file) => file.endsWith("bootstrap-classes.ts"))).toBe(false);
  });

  it("the found write paths equal the roster: a new path with no verdict, or a roster entry whose path is gone, fails", () => {
    const rosterKeys = DOCUMENT_WRITE_PATHS.map((entry) => key(entry)).sort();
    const foundKeys = found.map(key).sort();

    const missingVerdicts = foundKeys.filter((entry) => !rosterKeys.includes(entry));
    const stale = rosterKeys.filter((entry) => !foundKeys.includes(entry));
    expect(
      missingVerdicts,
      "A document-writing path has no recorded verdict (or its occurrence count changed). Add an entry with a verdict " +
        "(guarded, excluded with a ledger id, not-applicable or not-a-document-write) and a reason to DOCUMENT_WRITE_PATHS in " +
        "packages/iris-mcp-all/src/__tests__/document-write-paths.test.ts, in the same change that adds the path (AD-24).",
    ).toEqual([]);
    expect(
      stale,
      "A roster entry matches nothing on disk. Remove or update it in DOCUMENT_WRITE_PATHS in " +
        "packages/iris-mcp-all/src/__tests__/document-write-paths.test.ts.",
    ).toEqual([]);
  });

  it("no construct the roster does not model (OBJ.Load*, OBJ.Import*, ImportDir, SetTextFrom*, %Routine %New) exists in the scanned sources", () => {
    expect(forbidden).toEqual([]);
  });

  it("every entry has a reason, and each exclusion names its own ledger id", () => {
    for (const entry of DOCUMENT_WRITE_PATHS) {
      expect(entry.reason.length, `${key(entry)} has a reason`).toBeGreaterThan(20);
      if (entry.verdict === "excluded") expect(entry.ledger, `${key(entry)} names its ledger id`).toMatch(/^DW-\d+$/);
      else expect(entry.ledger, `${key(entry)} is not an exclusion`).toBeUndefined();
    }
    const ledgerIds = DOCUMENT_WRITE_PATHS.flatMap((entry) => (entry.ledger === undefined ? [] : [entry.ledger]));
    expect(new Set(ledgerIds).size, "each exclusion has its own ledger row").toBe(ledgerIds.length);
  });

  it("the guarded path is found, and its source runs the shared guard (a non-empty guarded set needs a real put)", () => {
    const guarded = DOCUMENT_WRITE_PATHS.filter((entry) => entry.verdict === "guarded");
    expect(guarded.length).toBeGreaterThan(0);
    for (const entry of guarded) {
      expect(found.map(key), `${key(entry)} is found on disk`).toContain(key(entry));
      const source = readFileSync(path.join(REPO_ROOT, entry.file), "utf8");
      expect(source).toContain("droppedStorageDefinitions(");
      expect(source).toContain("storageDroppedRefusal(");
    }
  });

  it("the three recorded exclusions are the Story 38.3 set: iris_doc_load, the iris_env_promote execute sync and the XML import", () => {
    const excluded = DOCUMENT_WRITE_PATHS.filter((entry) => entry.verdict === "excluded").map((entry) => entry.file);
    expect(excluded).toEqual([
      "packages/iris-dev-mcp/src/tools/load.ts",
      "packages/iris-dev-mcp/src/tools/env-promote.ts",
      "packages/iris-dev-mcp/src/tools/format.ts",
    ]);
  });
});
