/**
 * Story 38.3 (AC-6, AD-24) - every path that writes a document has a recorded verdict.
 *
 * AD-24 requires a verdict for every document-writing path, exhaustive as of a named date, and a grep
 * test that fails on any path with none. This test reads the source files from disk (Rule #45:
 * cross-package checks live in `@iris-mcp/all`), finds every occurrence of each write-path pattern, and
 * requires the found set to equal `DOCUMENT_WRITE_PATHS` exactly: a new write path turns it red, and so
 * does a roster entry whose path is gone.
 *
 * The roster is exhaustive as of 2026-10-21 (Story 42.11). To add a path, add a roster entry with one of
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
  /** The shared-guard calls a `guarded` path's source must contain. */
  guard?: readonly string[];
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
  dictionaryOpen: { languages: ["objectscript"], expression: /##class\(%Dictionary\.\w+Definition\)\.%Open(?:Id)?\(/g },
} satisfies Record<string, Pattern>;

type PatternName = keyof typeof PATTERNS;

/** Constructs that would be a document write the roster does not model: none may exist anywhere. */
const FORBIDDEN: Array<{ label: string; expression: RegExp }> = [
  { label: "OBJ.Load* / OBJ.Import*", expression: /\bOBJ\)?\.(?:Load|Import)\w*\(/gi },
  { label: "ImportDir", expression: /ImportDir/gi },
  { label: "SetTextFrom*", expression: /SetTextFrom\w*/g },
  { label: "%Routine / %RoutineMgr %New", expression: /##class\(%(?:Library\.)?(?:Routine|RoutineMgr)\)\.%New\(/g },
];

/**
 * Files that hold a forbidden construct on purpose, each with the exact constructs (label and count, as the scan reports them) and
 * its reason. A construct is exempt only in a file that no agent tool and no user instance can reach, and only as often as listed:
 * a further construct, or one more of a listed kind, in that file is forbidden again, and an entry the file no longer matches fails
 * as stale.
 */
const FORBIDDEN_EXEMPTIONS: Readonly<Record<string, { constructs: readonly string[]; reason: string }>> = {
  "scripts/lib/ipm-archive.mjs": {
    constructs: ["OBJ.Load* / OBJ.Import* x2"],
    reason:
      "builds the terminal sessions of the IPM archive proof (scripts/ci-ipm-archive.mjs, Story 42.4): `$System.OBJ.Load` imports IPM from the image's own " +
      "copy and loads a synthetic Setup class, both inside a throwaway container that scripts/throwaway-iris.mjs started with no network; no agent tool and no user instance ever runs them",
  },
};

const INTEROP = "src/ExecuteMCPv2/REST/Interop.cls";

/** Every document-writing path as of 2026-10-21 (Story 42.11), in the order the verdicts are recorded. */
export const DOCUMENT_WRITE_PATHS: readonly WritePath[] = [
  {
    file: "packages/iris-dev-mcp/src/tools/doc.ts",
    pattern: "put",
    count: 4,
    verdict: "guarded",
    reason: "iris_doc_put: for a class without allowStorageRegeneration, the 409 that the unversioned PUT draws feeds the Storage-drop guard before any write (a refused drop sends no write); a non-class document, and a class with allowStorageRegeneration, are not guarded",
    guard: ["droppedStorageDefinitions(", "storageDroppedRefusal("],
  },
  {
    file: "packages/iris-dev-mcp/src/tools/doc-edit.ts",
    pattern: "put",
    count: 1,
    verdict: "guarded",
    reason: "iris_doc_edit: the edits are applied to the one read of the class, and for action apply the Storage-drop guard compares that read with the edited lines before the one version-checked PUT (a refused drop sends no write); action regenerateStorage is the default-disabled override, and a non-class document is not guarded",
    guard: ["droppedStorageDefinitions(", "storageDroppedRefusal("],
  },
  {
    file: "packages/iris-dev-mcp/src/tools/load.ts",
    pattern: "put",
    count: 2,
    verdict: "guarded",
    reason: "iris_doc_load: for a class file without allowStorageRegeneration, a GET of the class (ignoreConflict true) or the 409 of the unversioned PUT (ignoreConflict false) feeds the Storage-drop guard before any write; a refused file is a failures entry with code STORAGE_DROPPED, the other files continue, and the PUT sequence of a file that drops nothing is unchanged (the second PUT is the version-checked repeat of the first, Story 38.7, DW-549); a new class, a non-class document and a class with allowStorageRegeneration are not refused",
    guard: ["droppedStorageDefinitions(", "storageDroppedDetail("],
  },
  {
    file: "packages/iris-dev-mcp/src/tools/env-promote.ts",
    pattern: "put",
    count: 1,
    verdict: "guarded",
    reason: "iris_env_promote execute: before the confirmation dialog and before any write, a GET-only preflight reads the source and target copy of each class step; a source copy that drops a Storage definition the target class has refuses the whole execute unless allowStorageRegeneration is set, and the batch PUTs the source text the preflight checked; a non-class document is not guarded",
    guard: ["droppedStorageDefinitions(", "storageDropsRefusal("],
  },
  {
    file: "packages/iris-dev-mcp/src/tools/format.ts",
    pattern: "xmlLoad",
    count: 1,
    verdict: "guarded",
    reason: "iris_doc_xml_export import: before the one POST, a GET of each <Class> of the XML is compared with the Storage elements the XML holds for it; a class that drops a definition refuses the whole import unless allowStorageRegeneration is set; a new class and an XML with no class are not refused, and export and list write nothing",
    guard: ["xmlClassStorageNames(", "storageDropsRefusal("],
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
  // The IPM-only install guard (Story 42.4) is IRIS-side source that sits outside src/.
  add(walk("ipm/preload", (f) => f.endsWith(".cls")), "objectscript");
  return files;
}

const countOf = (text: string, expression: RegExp): number => [...text.matchAll(expression)].length;

interface Found {
  file: string;
  pattern: PatternName;
  count: number;
}

function scan(): { found: Found[]; scanned: number; forbidden: string[]; exempted: string[] } {
  const found: Found[] = [];
  const forbidden: string[] = [];
  const exempted: string[] = [];
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
      if (count === 0) continue;
      const construct = `${label} x${count}`;
      const exempt = Object.hasOwn(FORBIDDEN_EXEMPTIONS, file) && FORBIDDEN_EXEMPTIONS[file]?.constructs.includes(construct) === true;
      (exempt ? exempted : forbidden).push(`${file}: ${construct}`);
    }
  }
  return { found, scanned: files.length, forbidden, exempted };
}

const key = (entry: Found): string => `${entry.file} :: ${entry.pattern} x${entry.count}`;

describe("every document-writing path has a recorded verdict (Story 38.3, AC-6, AD-24)", () => {
  const { found, scanned, forbidden, exempted } = scan();

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

  it("every exemption from that rule names a scanned file, the exact constructs it still holds, and a reason (a stale or widened one fails)", () => {
    const scannedPaths = scannedFiles().map(({ file }) => file);
    const listed: string[] = [];
    for (const [file, { constructs, reason }] of Object.entries(FORBIDDEN_EXEMPTIONS)) {
      expect(scannedPaths, `${file} is scanned`).toContain(file);
      expect(constructs.length, `${file} lists its constructs`).toBeGreaterThan(0);
      expect(reason.length, `${file} has a reason`).toBeGreaterThan(60);
      listed.push(...constructs.map((construct) => `${file}: ${construct}`));
    }
    // Equal both ways: a listed construct the file no longer holds is stale, and the file holding more (or other) constructs than listed
    // puts them in `forbidden` above, so the exemption never covers a construct nobody reviewed.
    expect([...exempted].sort()).toEqual([...listed].sort());
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

  it("every guarded path is found, and its source runs the shared guard calls that its entry names (a non-empty guarded set needs a real put)", () => {
    const guarded = DOCUMENT_WRITE_PATHS.filter((entry) => entry.verdict === "guarded");
    expect(guarded.length).toBeGreaterThan(0);
    for (const entry of guarded) {
      expect(entry.guard?.length ?? 0, `${key(entry)} names the shared guard calls its source must contain`).toBeGreaterThan(0);
      expect(found.map(key), `${key(entry)} is found on disk`).toContain(key(entry));
      const source = readFileSync(path.join(REPO_ROOT, entry.file), "utf8");
      for (const call of entry.guard ?? []) expect(source, `${entry.file} calls ${call}`).toContain(call);
    }
  });

  it("all five agent class-write paths are guarded, and no path is excluded (Story 42.11: the Story 38.3 exclusions are gone)", () => {
    const guarded = DOCUMENT_WRITE_PATHS.filter((entry) => entry.verdict === "guarded").map((entry) => entry.file);
    expect(guarded).toEqual([
      "packages/iris-dev-mcp/src/tools/doc.ts",
      "packages/iris-dev-mcp/src/tools/doc-edit.ts",
      "packages/iris-dev-mcp/src/tools/load.ts",
      "packages/iris-dev-mcp/src/tools/env-promote.ts",
      "packages/iris-dev-mcp/src/tools/format.ts",
    ]);
    expect(DOCUMENT_WRITE_PATHS.filter((entry) => entry.verdict === "excluded")).toEqual([]);
  });

  it("only a guarded path names guard calls", () => {
    for (const entry of DOCUMENT_WRITE_PATHS) {
      if (entry.verdict !== "guarded") expect(entry.guard, `${key(entry)} is not guarded`).toBeUndefined();
    }
  });
});
