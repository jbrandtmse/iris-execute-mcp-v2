/**
 * Story 41.7 - AC 41.7.1: the skills pack documentation of this package's README is checked against the BUILT bin and
 * `PACK_TARGETS`, not against itself.
 *
 *  - Every `iris-mcp-clients skills ...` line of the README (the synopsis in the command block and the examples under
 *    "Installing the skills pack") uses only flags that the bin's own `Usage:` line lists. Each example also names a routed
 *    `--client` id and runs, with `--dry-run` added and `--project` pointed at a temp project, to exit 0 with nothing
 *    written.
 *  - The generated "Skills pack targets" table has one body row per `PACK_TARGETS` row, in that order, whose `--client`
 *    cells are the ids. (Its bytes are pinned by `certification-docs.test.ts`, which runs the renderer's `--check`.)
 *  - The two README anchors that other documents link to resolve to headings, and the table section directly follows the
 *    installer section.
 *
 * Writes only under OS temp directories it creates and removes; the bin runs with a temp HOME.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { PACK_TARGETS } from "../pack-targets.js";

import { makeSandbox, removeSandboxes } from "./pack-test-helpers.js";
import { assertBinFresh, filesUnder, lstatTree, PACKAGE_ROOT, runBin, treeDiff } from "./qa-41-6-helpers.js";

const README = readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8");
const README_LINES = README.split("\n");
const ROUTED_IDS = PACK_TARGETS.filter((target) => target.route !== null).map((target) => target.id);
const T = 120_000;

beforeAll(assertBinFresh);
afterEach(removeSandboxes);

/** The `--flag` words in a text, in order. */
function flagsIn(text: string): string[] {
  return text.match(/--[a-z][a-z-]*/g) ?? [];
}

/** The README's `iris-mcp-clients skills ...` lines, each without a trailing `# comment`. */
function skillsCommandLines(): string[] {
  return README_LINES.filter((line) => line.startsWith("iris-mcp-clients skills ")).map((line) => line.replace(/\s+#.*$/, "").trim());
}

/** A synopsis names placeholders or alternatives instead of one runnable command. */
function isSynopsis(line: string): boolean {
  return line.includes("install|uninstall") || line.includes("<") || line.includes("[");
}

/** GitHub's heading slug: lower case, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .trim()
    .replace(/ /g, "-");
}

describe("the README's skills commands match the bin", () => {
  it("finds the synopsis and the four examples", () => {
    const lines = skillsCommandLines();
    expect(lines.filter(isSynopsis)).toHaveLength(1);
    expect(lines.filter((line) => !isSynopsis(line))).toHaveLength(4);
  });

  it(
    "every line uses only flags from the bin's own usage line, and every example names a routed client and runs as a dry run",
    () => {
      const sandbox = makeSandbox();
      const usage = runBin(sandbox, ["skills"]);
      expect(usage.status).toBe(2);
      const usageLine = usage.stderr.split("\n").find((line) => line.startsWith("Usage: iris-mcp-clients skills"));
      expect(usageLine, `the usage line in:\n${usage.stderr}`).toBeDefined();
      const allowed = new Set(flagsIn(usageLine ?? ""));
      expect(allowed.has("--client")).toBe(true);
      expect(allowed.has("--dry-run")).toBe(true);

      for (const line of skillsCommandLines()) {
        for (const flag of flagsIn(line)) expect(allowed.has(flag), `${flag} in "${line}" is not a flag of the bin`).toBe(true);
        if (isSynopsis(line)) continue;

        const words = line.split(/\s+/).slice(1);
        expect(["install", "uninstall"], line).toContain(words[1]);
        const client = words[words.indexOf("--client") + 1];
        expect(ROUTED_IDS, `--client in "${line}"`).toContain(client);

        const args: string[] = [];
        for (let i = 0; i < words.length; i += 1) {
          if (words[i] === "--project") {
            i += 1;
          } else {
            args.push(words[i] as string);
          }
        }
        if (!args.includes("--dry-run")) args.push("--dry-run");
        args.push("--project", sandbox.project);

        const before = lstatTree(sandbox.root);
        const run = runBin(sandbox, args);
        expect(run.status, `${line}\n${run.stdout}${run.stderr}`).toBe(0);
        expect(treeDiff(before, lstatTree(sandbox.root)), `"${line}" wrote files`).toEqual([]);
        expect([...filesUnder(sandbox.home).keys()], `"${line}" wrote to the home`).toEqual([]);
      }
    },
    T,
  );
});

describe("the generated Skills pack targets table lists every PACK_TARGETS row", () => {
  it("has one body row per target, in PACK_TARGETS order, with the id in the --client cell", () => {
    const begin = README_LINES.indexOf("<!-- PACK-TARGETS-TABLE:BEGIN -->");
    const end = README_LINES.indexOf("<!-- PACK-TARGETS-TABLE:END -->");
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    const rows = README_LINES.slice(begin + 1, end).filter((line) => line.startsWith("| "));
    const header = rows.shift() ?? "";
    expect(header.split(/(?<!\\)\|/).map((cell) => cell.trim())[2]).toBe("`--client`");
    expect((rows.shift() ?? "").startsWith("| --- |"), "the separator row").toBe(true);
    expect(rows).toHaveLength(PACK_TARGETS.length);
    const ids = rows.map((row) => {
      const cell = row.split(/(?<!\\)\|/).map((value) => value.trim())[2] ?? "";
      expect(cell.startsWith("`") && cell.endsWith("`"), `the --client cell of "${row.slice(0, 40)}"`).toBe(true);
      return cell.slice(1, -1);
    });
    expect(ids).toEqual(PACK_TARGETS.map((target) => target.id));
  });
});

describe("the README anchors other documents link to", () => {
  it("#installing-the-skills-pack and #skills-pack-targets-generated resolve to headings, the table section right after the installer one", () => {
    const headings = README_LINES.filter((line) => /^#{1,6} /.test(line));
    const slugs = headings.map((heading) => slug(heading.replace(/^#+ /, "")));
    expect(slugs).toContain("installing-the-skills-pack");
    expect(slugs).toContain("skills-pack-targets-generated");
    const level2 = headings.filter((heading) => heading.startsWith("## "));
    const installer = level2.indexOf("## Installing the skills pack");
    expect(installer).toBeGreaterThan(-1);
    expect(level2[installer + 1]).toBe("## Skills pack targets (generated)");
    expect(README).toContain("(#skills-pack-targets-generated)");
  });
});
