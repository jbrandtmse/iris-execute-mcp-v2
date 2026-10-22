/**
 * No repository script imports a TypeScript file. Node strips types from a `.ts` import only from 22.18, and the floor of every
 * published package is 22.17.0, the lowest leg of CI's `gates` job: a script that imports a `.ts` file passes on Node 24 or 26 and
 * fails on the floor with ERR_UNKNOWN_FILE_EXTENSION.
 *
 * The scan is `scripts/lib/script-ts-import-scan.mjs`. The cases below run it on the real scripts, on the governance generator's
 * `--check` import as it stood at commit 221181a (it imported `packages/shared/src/governance-baseline.ts`), and on synthetic
 * sources. The premise itself, that a floor Node refuses a `.ts` import, is shown by a real child process started with
 * `--no-experimental-strip-types`, the flag that makes any newer Node behave as the floor does.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  scriptFiles,
  scriptTsImportProblems,
  stripComments,
  tsImportProblems,
} from "../../../../scripts/lib/script-ts-import-scan.mjs";

/** The generator's `--check` import as it stood at commit 221181a: a `.ts` import, which fails on Node 22.17.0. */
const DEFECTIVE_GENERATOR = `
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outPath = resolve(root, 'packages/shared/src/governance-baseline.ts');
if (CHECK_MODE) {
  let committedModule;
  try {
    committedModule = await import(pathToFileURL(outPath).href);
  } catch (e) {
    process.exit(1);
  }
}
writeFileSync(outPath, output, 'utf-8');
`;

const scratchDirs: string[] = [];
afterEach(() => {
  for (const directory of scratchDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("no repository script imports a TypeScript file", () => {
  it("the scan finds the scripts at all (an empty scan would pass the next case vacuously)", () => {
    const names = scriptFiles().map((file) => path.basename(file));
    expect(names).toEqual(expect.arrayContaining(["gen-governance-baseline.mjs", "throwaway-iris.mjs", "prepublish-gate.mjs", "live-gate-scan.mjs"]));
    expect(names.length, "the scripts of the repository").toBeGreaterThan(30);
  });

  it("the real scripts import no .ts file, directly or through a variable", () => {
    expect(scriptTsImportProblems()).toEqual([]);
  });

  it("the generator as it stood in the first CI run is found, naming the line and the variable", () => {
    expect(tsImportProblems(DEFECTIVE_GENERATOR, "gen-governance-baseline.mjs")).toEqual([
      "gen-governance-baseline.mjs:10 imports a TypeScript file: 'packages/shared/src/governance-baseline.ts' (through outPath)",
    ]);
  });

  it("the generator's other use of that variable, writing the file, is not an import", () => {
    const writeOnly = DEFECTIVE_GENERATOR.replace("await import(pathToFileURL(outPath).href)", "await import(pathToFileURL(builtPath).href)");
    expect(tsImportProblems(writeOnly)).toEqual([]);
  });

  it.each([
    ["a static import", "import { x } from './lib/x.ts';\n", "imports ./lib/x.ts"],
    ["a multi-line static import", "import {\n  a,\n  b,\n} from '../packages/shared/src/index.mts';\n", "imports ../packages/shared/src/index.mts"],
    ["a bare import", "import './setup.cts';\n", "imports ./setup.cts"],
    ["a re-export", "export * from './x.ts';\n", "imports ./x.ts"],
    ["a dynamic import of a literal", "const m = await import('./x.ts');\n", "imports a TypeScript file: './x.ts'"],
    ["a dynamic import of a file URL", "await import(pathToFileURL('/a/b/c.ts').href);\n", "imports a TypeScript file: '/a/b/c.ts'"],
    ["a require", "const m = require('./x.cts');\n", "requires a TypeScript file: './x.cts'"],
    ["a template literal path", "const p = `${root}/src/index.ts`;\nawait import(pathToFileURL(p).href);\n", "(through p)"],
    ["a path built in two steps", "const base = 'src/a.ts';\nconst full = join(root, base);\nawait import(full);\n", "(through base)"],
    ["a tsx file", "import App from './App.tsx';\n", "imports ./App.tsx"],
    [
      "an import after a regular expression that follows return",
      "function quoted(text) {\n  return /['\"]/.test(text);\n}\nawait import('./x.ts');\n",
      "imports a TypeScript file: './x.ts'",
    ],
    [
      "an import on a line that divides by a name ending in a keyword",
      "const half = todo / 2; await import('./x.ts'); const share = total / 4;\n",
      "imports a TypeScript file: './x.ts'",
    ],
  ])("finds %s", (_label, source, expected) => {
    const problems = tsImportProblems(source, "script.mjs");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(expected);
  });

  it.each([
    ["a built .js import", "import { x } from '../packages/shared/dist/index.js';\nawait import(pathToFileURL(dist).href);\n"],
    ["a .json import", "const manifest = JSON.parse(readFileSync('package.json'));\nimport data from './x.json' with { type: 'json' };\n"],
    ["a .ts name that is only text", "const generated = 'packages/shared/src/bootstrap-classes.ts';\nwriteFileSync(generated, output);\n"],
    ["a .ts name in a comment", "// import { x } from './x.ts';\n/* await import('./y.ts'); */\nimport { z } from './z.js';\n"],
    ["a .ts name in a string that mentions import(", "const note = \"call import('./x.ts') later\";\n"],
    ["an argument the scan cannot trace", "export async function load(modulePath) {\n  return import(pathToFileURL(modulePath).href);\n}\n"],
    ["a regular expression that holds a quote", "const quote = /['\"]/;\nawait import('./ok.js');\n"],
    ["an import path whose words name a variable that holds a .ts path", "const outPath = './a.ts';\nawait import('./lib/outPath.js');\n"],
  ])("does not report %s", (_label, source) => {
    expect(tsImportProblems(source)).toEqual([]);
  });

  it("removes comments without touching strings, templates or regular expressions", () => {
    const source = "const a = 'x // y'; // tail\nconst b = `p /* q */ r`; /* block\nspans */ const c = /a\\/\\/b/;\n";
    const stripped = stripComments(source);
    expect(stripped).toContain("'x // y'");
    expect(stripped).toContain("`p /* q */ r`");
    expect(stripped).toContain("/a\\/\\/b/");
    expect(stripped).not.toContain("tail");
    expect(stripped).not.toContain("spans");
    expect(stripped.split("\n")).toHaveLength(source.split("\n").length);
  });
});

describe("the floor refuses a .ts import (the premise of the scan)", () => {
  it("a child Node run with --no-experimental-strip-types fails on a .ts import with ERR_UNKNOWN_FILE_EXTENSION", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "script-ts-imports-"));
    scratchDirs.push(directory);
    writeFileSync(path.join(directory, "value.ts"), "export const value: number = 1;\n");
    const loader = path.join(directory, "load.mjs");
    writeFileSync(loader, `await import(${JSON.stringify(pathToFileURL(path.join(directory, "value.ts")).href)});\nconsole.log("loaded");\n`);

    const floor = spawnSync(process.execPath, ["--no-experimental-strip-types", loader], { encoding: "utf8" });
    expect(floor.status, `stdout: ${floor.stdout}\nstderr: ${floor.stderr}`).not.toBe(0);
    expect(floor.stderr).toContain("ERR_UNKNOWN_FILE_EXTENSION");
    expect(floor.stdout).not.toContain("loaded");
  });
});
