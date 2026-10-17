/**
 * DW-561 guard: no gate declares its own copy of a helper that `process-gate-helpers.ts` (or, for the
 * SQL strings, `header-row-oracle.ts`) now exports.
 *
 * Scans every `*.test.ts` of this directory that imports `./process-gate-helpers.js`. A top-level
 * `function <name>(` or `const <name> =` of a replaced name fails the test, naming the file and the name,
 * unless `KEPT_VARIANTS` lists that file and name with the reason the copy has a different contract. The
 * names that cannot be a local variable are also refused when they are nested in a describe block or a
 * hook, and so is a function declaration of `entries` at any depth. A kept variant that the file no longer declares fails too, so the list cannot go stale. No IRIS.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Names a helper replaced: declared at the top of a gate file, they are a copy. */
const REPLACED_NAMES = [
  "entryOf",
  "skip",
  "skipIfNeeded",
  "fixtureDocuments",
  "fixtureGlobals",
  "lineNumber",
  "storageRange",
  "scalar",
  "governanceReport",
  "governanceDenial",
  "denial",
  "removeDoc",
  "putDoc",
  "compileDoc",
  "putFixture",
  "route",
  "textOf",
  "ids",
  "irisMethod",
  "seedMethod",
  "proxiedSession",
  "probedSession",
  "probed",
  "searchEntries",
  "auditEntries",
  "entries",
  "startStub",
  "envelope",
  "stubTarget",
  "routeRequests",
  "writeJson",
  "withStub",
  "batchUnits",
  "wellFormed",
  "sqlLiteral",
  "squash",
  "HEADER_COLUMNS",
  "logOracle",
] as const;

/** Replaced names that are never a local variable, so a declaration at any depth is a copy. */
const NEVER_LOCAL = [
  "entryOf",
  "skipIfNeeded",
  "fixtureDocuments",
  "fixtureGlobals",
  "irisMethod",
  "seedMethod",
  "proxiedSession",
  "probedSession",
  "searchEntries",
  "auditEntries",
  "startStub",
  "batchUnits",
  "wellFormed",
  "HEADER_COLUMNS",
] as const;

/**
 * Replaced names that gates still use as a local variable (`const entries = await pollAuditEntries(...)`),
 * so only a nested or top-level FUNCTION declaration of them is a copy.
 */
const FUNCTION_NEVER_LOCAL = ["entries"] as const;

/** The teardown helper a gate used to declare inside its `afterAll`. */
const NESTED_ATTEMPT = "attempt";

interface KeptVariant {
  file: string;
  name: string;
  /** Why this declaration is not behaviorally identical to the exported helper. */
  reason: string;
}

/** Declarations that stay in a gate because their contract differs from the exported helper's. */
const KEPT_VARIANTS: readonly KeptVariant[] = [
  {
    file: "story-38-7-qa-governance-process.test.ts",
    name: "governanceReport",
    reason: "starts its own session on the stub, captures the server's stderr and the tool names (the exported one reads an open session).",
  },
  {
    file: "story-39-3-qa-live-gate.test.ts",
    name: "route",
    reason: "builds its own body-search request around postEnvelope and asserts the HTTP status.",
  },
  {
    file: "story-39-4-qa-live-gate.test.ts",
    name: "route",
    reason: "builds its own Search Table request around postEnvelope, with a namespace argument.",
  },
  {
    file: "story-39-5-qa-live-gate.test.ts",
    name: "route",
    reason: "asserts that the request names the scratch namespace before it calls postEnvelope.",
  },
  {
    file: "story-38-0-qa-process.test.ts",
    name: "startStub",
    reason: "answers a caller-chosen status; the exported stubs answer 503 or serve one route.",
  },
];

/** The gate files in this directory that import the shared helpers. */
function importers(): string[] {
  return readdirSync(__dirname)
    .filter((name) => name.endsWith(".test.ts") && name !== path.basename(fileURLToPath(import.meta.url)))
    .filter((name) => importsHelpers(readFileSync(path.join(__dirname, name), "utf8")))
    .sort();
}

/** Whether `source` imports `./process-gate-helpers` (either quote style, with or without the `.js` suffix). */
function importsHelpers(source: string): boolean {
  return /from\s+["']\.\/process-gate-helpers(?:\.js)?["']/.test(source);
}

/** Whether `source` declares `name` as a function at any depth (a local `const name =` is not a declaration here). */
function declaresFunction(source: string, name: string): boolean {
  return new RegExp(`^[ \\t]*(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[(<]`, "m").test(source);
}

/** Whether `source` declares `name` as a function, or as a const/let/var, at column 0 (or at any depth when `nested`). */
function declares(source: string, name: string, nested: boolean): boolean {
  const indent = nested ? "[ \\t]*" : "";
  const declaration = new RegExp(
    `^${indent}(?:export\\s+)?(?:(?:async\\s+)?function\\s+${name}\\s*[(<]|(?:const|let|var)\\s+${name}\\s*[:=])`,
    "m",
  );
  return declaration.test(source);
}

/** The `{file, name}` pairs where `source` of `file` declares a replaced name. */
function copiesIn(file: string, source: string): Array<{ file: string; name: string }> {
  const found: Array<{ file: string; name: string }> = [];
  for (const name of REPLACED_NAMES) {
    if (declares(source, name, (NEVER_LOCAL as readonly string[]).includes(name))) found.push({ file, name });
  }
  if (declares(source, NESTED_ATTEMPT, true)) found.push({ file, name: NESTED_ATTEMPT });
  for (const name of FUNCTION_NEVER_LOCAL) {
    if (declaresFunction(source, name) && !found.some((copy) => copy.name === name)) found.push({ file, name });
  }
  return found;
}

const isKept = (copy: { file: string; name: string }): boolean =>
  KEPT_VARIANTS.some((variant) => variant.file === copy.file && variant.name === copy.name);

describe("DW-561: no gate re-declares a helper that process-gate-helpers.ts exports", () => {
  const files = importers();

  it("finds the gates at all (an empty scan would pass every case below vacuously)", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("epic38-capstone-gate.test.ts");
    expect(files).toContain("story-39-5-body-reader-live-gate.test.ts");
  });

  it("no gate declares a replaced name, except the listed variants", () => {
    const copies = files.flatMap((file) => copiesIn(file, readFileSync(path.join(__dirname, file), "utf8")));
    const unlisted = copies.filter((copy) => !isKept(copy)).map((copy) => `${copy.file}: ${copy.name}`);
    expect(unlisted, "a gate declares a copy of a shared helper; call the exported one").toEqual([]);
  });

  it("every kept variant is still declared by its file, and carries a reason", () => {
    for (const variant of KEPT_VARIANTS) {
      expect(variant.reason.length, `${variant.file} ${variant.name}: a reason`).toBeGreaterThan(20);
      const source = readFileSync(path.join(__dirname, variant.file), "utf8");
      const stillDeclared = copiesIn(variant.file, source).some((copy) => copy.name === variant.name);
      expect(stillDeclared, `${variant.file} no longer declares ${variant.name}: remove the entry`).toBe(true);
    }
  });

  it("recognizes each declaration form (the detector itself can fail)", () => {
    expect(declares("function entryOf(pkg: string) {}", "entryOf", false)).toBe(true);
    expect(declares("async function entryOf (pkg) {}", "entryOf", false)).toBe(true);
    expect(declares("const entryOf = (pkg) => pkg;", "entryOf", false)).toBe(true);
    expect(declares("const entryOf: Fn = (pkg) => pkg;", "entryOf", false)).toBe(true);
    expect(declares("export function entryOf(pkg) {}", "entryOf", false)).toBe(true);
    expect(declares("  function entryOf(pkg) {}", "entryOf", false), "a nested copy of a top-level name is not refused").toBe(false);
    expect(declares("  function entryOf(pkg) {}", "entryOf", true), "a nested copy of a never-local name is refused").toBe(true);
    expect(declares("const entryOfKind = 1;", "entryOf", false)).toBe(false);
    expect(declares("distEntry(root, pkg)", "entryOf", false)).toBe(false);
  });

  it("refuses a nested function copy of `entries` and allows the local variable gates name `entries`", () => {
    const nested = ["describe('x', () => {", "  async function entries(file: string) {", "    return [];", "  }", "});", ""].join("\n");
    expect(copiesIn("some-gate.test.ts", nested)).toEqual([{ file: "some-gate.test.ts", name: "entries" }]);
    const local = "  it('x', async () => {\n    const entries = await pollAuditEntries(file, { intervalMs: 5, timeoutMs: 50, excerpt: 10 });\n  });\n";
    expect(copiesIn("some-gate.test.ts", local)).toEqual([]);
    expect(copiesIn("some-gate.test.ts", "function entries(file) {}\n")).toEqual([{ file: "some-gate.test.ts", name: "entries" }]);
  });

  it("finds an importer whatever the quote style and suffix", () => {
    expect(importsHelpers('import { a } from "./process-gate-helpers.js";')).toBe(true);
    expect(importsHelpers("import { a } from './process-gate-helpers.js';")).toBe(true);
    expect(importsHelpers('import { a } from "./process-gate-helpers";')).toBe(true);
    expect(importsHelpers('import { a } from "./process-gate-helpers-other.js";')).toBe(false);
    expect(importsHelpers('import { a } from "./header-row-oracle.js";')).toBe(false);
  });

  it("a re-declared name in a gate is reported with its file and name", () => {
    const gate = ['import { distEntry } from "./process-gate-helpers.js";', "", "function entryOf(pkg: string): string {", "  return pkg;", "}", ""].join("\n");
    expect(copiesIn("some-gate.test.ts", gate)).toEqual([{ file: "some-gate.test.ts", name: "entryOf" }]);
    expect(copiesIn("some-gate.test.ts", "const x = distEntry(root, pkg);\n")).toEqual([]);
  });
});
