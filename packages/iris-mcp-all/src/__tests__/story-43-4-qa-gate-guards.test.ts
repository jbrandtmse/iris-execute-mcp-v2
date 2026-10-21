/**
 * Story 43.4 QA (DW-639, AC 43.4.2; Rules #21, #59) - the two gates of Story 43.4 are proven to guard the path they claim to guard.
 *
 * 1. The five golden tests read THROUGH the ledger. A test that pointed at the raw golden would go red on the sanctioned rows of the wire
 *    golden, but the handler golden holds no sanctioned entry yet, so `story-43-1-qa-handler-golden.test.ts` would stay green on a raw
 *    read and the ledger would be bypassed unseen. This file therefore checks the routing itself: every test that loads a frozen golden
 *    does so with `readSanctionedGolden(REPO_ROOT, "<kind>")` for the kinds it needs, a new consumer must be named here, and no test but
 *    the three that pin the frozen bytes (the ledger test, the independent wire test and this file) reads the frozen files or their path
 *    constants.
 * 2. The epic capstone runs in the default suite. The default suite is what `vitest run` selects in this package: the include and
 *    exclude globs of `vitest.config.ts`, resolved by vitest itself (`vitest list`), a `test` script with no file filter, a file name that
 *    is not `*.integration.test.ts`, no entry in the prepublish gate roster, and no skip construct in the files of the story.
 *
 * The scanners are pure (text in, problems out) and have rows below that make them fail on a bypass, a missing route, an unregistered
 * consumer, and each skip construct, so a green run means they could see a problem. Reads files and runs `vitest list`; needs no IRIS and
 * no built dist.
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";

const PACKAGE_DIR = path.join(REPO_ROOT, "packages", "iris-mcp-all");
const TESTS = "packages/iris-mcp-all/src/__tests__";

/** The test files that load a frozen golden through the ledger, and the kinds each needs. */
const CONSUMERS: Record<string, Array<"wire" | "handler">> = {
  [`${TESTS}/story-43-1-sdk-wire-golden.test.ts`]: ["wire"],
  [`${TESTS}/story-43-1-sanctioned-wire-changes.test.ts`]: ["wire"],
  [`${TESTS}/story-43-2-cross-era-pin.test.ts`]: ["wire"],
  [`${TESTS}/story-43-2-chokepoint-both-eras.test.ts`]: ["wire"],
  [`${TESTS}/story-43-1-qa-handler-golden.test.ts`]: ["handler"],
  [`${TESTS}/epic43-capstone-gate.test.ts`]: ["wire", "handler"],
};

/** The test files that pin or read the frozen bytes on purpose (and so may also name the frozen files). */
const FROZEN_READERS = [`${TESTS}/story-43-4-sanctioned-golden-changes.test.ts`, `${TESTS}/story-43-4-qa-sanctioned-wire.test.ts`, `${TESTS}/story-43-4-qa-gate-guards.test.ts`];

/** What names a frozen golden in code: the files and the two path constants the capture scripts export. */
const RAW_TOKENS: Array<[string, RegExp]> = [
  ["sdk-wire-golden.json", /sdk-wire-golden\.json/],
  ["sdk-handler-golden.json", /sdk-handler-golden\.json/],
  ["HANDLER_GOLDEN_RELATIVE_PATH", /\bHANDLER_GOLDEN_RELATIVE_PATH\b/],
  ["GOLDEN_RELATIVE_PATH", /\bGOLDEN_RELATIVE_PATH\b/],
];

/** `text` without its block comments and line comments, so a header that mentions a file is not a read of it. */
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

interface SourceFile {
  path: string;
  text: string;
}

/** The kinds that `text` loads through the ledger. */
function routedKinds(text: string): Array<"wire" | "handler"> {
  return [...text.matchAll(/readSanctionedGolden\(\s*REPO_ROOT\s*,\s*"(wire|handler)"\s*\)/g)].map((match) => match[1] as "wire" | "handler");
}

/** What is wrong with how `files` load the frozen goldens; empty when every route is as `consumers` and `frozenReaders` say. */
function routingProblems(files: SourceFile[], consumers: Record<string, Array<"wire" | "handler">>, frozenReaders: string[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    const code = withoutComments(file.text);
    const usesLoader = /readSanctionedGolden\s*\(/.test(code);
    if (usesLoader && consumers[file.path] === undefined && !frozenReaders.includes(file.path)) {
      problems.push(`${file.path} loads a golden through the ledger but is not registered as a consumer`);
    }
    const token = RAW_TOKENS.find(([, pattern]) => pattern.test(code));
    if (token !== undefined && !frozenReaders.includes(file.path)) problems.push(`${file.path} names the frozen golden (${token[0]}) and is not one of the files that pin it`);
  }
  for (const [consumer, kinds] of Object.entries(consumers)) {
    const file = files.find((candidate) => candidate.path === consumer);
    if (file === undefined) {
      problems.push(`${consumer} is registered as a consumer but does not exist`);
      continue;
    }
    const routed = routedKinds(withoutComments(file.text));
    for (const kind of kinds) if (!routed.includes(kind)) problems.push(`${consumer} does not load the ${kind} golden through readSanctionedGolden(REPO_ROOT, "${kind}")`);
  }
  return problems;
}

/** Every `*.test.ts` under the `src` of each package and extension, as repository-relative paths with their text. */
function testSources(): SourceFile[] {
  const found: SourceFile[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", "dist", "out", ".git", "coverage"].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".test.ts")) found.push({ path: path.relative(REPO_ROOT, full).split(path.sep).join("/"), text: readFileSync(full, "utf8") });
    }
  };
  for (const group of ["packages", "extensions"]) {
    const root = path.join(REPO_ROOT, group);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const src = path.join(root, entry.name, "src");
      if (entry.isDirectory() && existsSync(src)) walk(src);
    }
  }
  return found;
}

/** The skip constructs a gate must not contain, with the text that matched. */
function skipConstructs(text: string): string[] {
  return [...text.matchAll(/\b(?:it|test|describe)\s*\.\s*(?:skip|skipIf|runIf|todo|only)\b|\bctx\.skip\b|\bIRIS_REQUIRE_LIVE\b|\bxit\s*\(|\bxdescribe\s*\(/g)].map((match) => match[0]);
}

describe("the five golden tests read through the ledger, and nothing else reads the frozen files", () => {
  it("the checker sees a raw read, a missing route, an unregistered consumer and a missing file", () => {
    const registered = { "a.test.ts": ["handler"] as Array<"wire" | "handler"> };
    expect(routingProblems([{ path: "a.test.ts", text: 'import { HANDLER_GOLDEN_RELATIVE_PATH } from "x";' }], registered, [])).toEqual([
      'a.test.ts names the frozen golden (HANDLER_GOLDEN_RELATIVE_PATH) and is not one of the files that pin it',
      'a.test.ts does not load the handler golden through readSanctionedGolden(REPO_ROOT, "handler")',
    ]);
    expect(routingProblems([{ path: "a.test.ts", text: 'readSanctionedGolden(REPO_ROOT, "wire")' }], registered, [])).toEqual([
      'a.test.ts does not load the handler golden through readSanctionedGolden(REPO_ROOT, "handler")',
    ]);
    expect(routingProblems([{ path: "b.test.ts", text: 'readSanctionedGolden(REPO_ROOT, "wire")' }], {}, [])).toEqual([
      "b.test.ts loads a golden through the ledger but is not registered as a consumer",
    ]);
    expect(routingProblems([], registered, [])).toEqual(["a.test.ts is registered as a consumer but does not exist"]);
    expect(routingProblems([{ path: "a.test.ts", text: 'readSanctionedGolden(REPO_ROOT, "handler")' }], registered, [])).toEqual([]);
  });

  it("every consumer loads each golden it needs through readSanctionedGolden(REPO_ROOT, kind), and no other test names a frozen golden", () => {
    const files = testSources();
    expect(files.length, "the scan found the repository's tests").toBeGreaterThan(300);
    expect(routingProblems(files, CONSUMERS, FROZEN_READERS)).toEqual([]);
  });
});

describe("the epic capstone and the Story 43.4 tests are in the default suite and cannot skip", () => {
  /** The capstone and the tests Story 43.4 added: none may skip. */
  const NEW_FILES = [
    `${TESTS}/epic43-capstone-gate.test.ts`,
    `${TESTS}/story-43-4-sanctioned-golden-changes.test.ts`,
    `${TESTS}/story-43-4-doc-claims.test.ts`,
    `${TESTS}/story-43-4-qa-sanctioned-wire.test.ts`,
    `${TESTS}/story-43-4-qa-probe-copy.test.ts`,
    `${TESTS}/story-43-4-qa-docs-runtime.test.ts`,
    `${TESTS}/story-43-4-qa-gate-guards.test.ts`,
  ];
  /** Those and the five golden tests, which must also be selected by the default suite. */
  const STORY_FILES = [...new Set([...NEW_FILES, ...Object.keys(CONSUMERS)])];

  it("the skip scanner sees each construct (it can fail)", () => {
    expect(skipConstructs("it.skip('x', () => {})")).toEqual(["it.skip"]);
    expect(skipConstructs("describe.skipIf(!live)('x', () => {})")).toEqual(["describe.skipIf"]);
    expect(skipConstructs("test.todo('x'); it.only('y')")).toEqual(["test.todo", "it.only"]);
    expect(skipConstructs("if (!ready) ctx.skip();")).toEqual(["ctx.skip"]);
    expect(skipConstructs("if (process.env.IRIS_REQUIRE_LIVE) {}")).toEqual(["IRIS_REQUIRE_LIVE"]);
    expect(skipConstructs("xit('x'); xdescribe('y')")).toEqual(["xit(", "xdescribe("]);
    expect(skipConstructs("it('a skipped-looking name', () => {})")).toEqual([]);
  });

  it("vitest's own resolution of this package's include and exclude globs selects every one of them", () => {
    const vitestMain = path.join(path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("VITEST") && key !== "NODE_OPTIONS")) as Record<string, string>;
    const listed = spawnSync(process.execPath, [vitestMain, "list", "--filesOnly"], { cwd: PACKAGE_DIR, env, encoding: "utf8", timeout: 120_000 });
    expect(listed.status, `vitest list exited ${listed.status}: ${listed.stderr.slice(0, 300)}`).toBe(0);
    const selected = new Set(listed.stdout.split("\n").map((line) => line.trim()).filter((line) => line.endsWith(".test.ts")));
    expect(selected.size, "the default suite lists this package's test files").toBeGreaterThan(100);
    for (const file of STORY_FILES) expect(selected.has(file.replace("packages/iris-mcp-all/", "")), `${file} is in the default suite`).toBe(true);
  }, 150_000);

  it("the package's test script runs the whole suite, and no story file is a *.integration.test.ts or a prepublish gate roster entry", () => {
    const manifest = JSON.parse(readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(manifest.scripts["test"], "no file filter, no config override").toBe("vitest run");
    const roster = readFileSync(path.join(PACKAGE_DIR, "scripts", "prepublish-gate.mjs"), "utf8");
    for (const file of STORY_FILES) {
      expect(file, `${file} is not excluded by the *.integration.test.ts suffix`).not.toMatch(/\.integration\.test\.ts$/);
      expect(roster, `${file} is not in the prepublish gate roster (a capstone of the default suite is not an armed live gate)`).not.toContain(path.basename(file));
    }
  });

  it("the capstone and the Story 43.4 tests contain no skip construct and never read IRIS_REQUIRE_LIVE", () => {
    for (const file of NEW_FILES) {
      if (file.endsWith("story-43-4-qa-gate-guards.test.ts")) continue;
      expect(skipConstructs(readFileSync(path.join(REPO_ROOT, file), "utf8")), `${file} has no skip construct`).toEqual([]);
    }
  });
});
