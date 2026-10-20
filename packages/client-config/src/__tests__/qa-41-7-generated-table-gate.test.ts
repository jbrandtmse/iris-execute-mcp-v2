/**
 * Story 41.7 QA - the generated `Skills pack targets` table of the client-config README, checked on the paths the
 * existing gates do not reach (project rule #59: a gate must be proven to fail on the path it actually guards).
 *
 * Two gaps, each found by experiment on a scratch copy of the package:
 *
 *  1. Source freshness. `render-certification-table.mjs --check` renders from the BUILT `dist/pack-targets.js`, and
 *     `certification-docs.test.ts` runs it without asking whether `dist/` is current. After a `PACK_TARGETS` edit in
 *     `src/pack-targets.ts` with no rebuild, `--check` still exits 0 (the README equals a render of the OLD data), and
 *     `certification-docs.test.ts` stays green when it is run alone. The first row asserts the gate's precondition: the
 *     dist the renderer reads is not older than `src/`, then `--check` exits 0. A source-only edit turns it red.
 *  2. Table structure. `--check` compares the README with the renderer's own output, so a renderer that fails to escape a
 *     `|` would write a broken row and still pass its own check. The second row reads the committed table the way a
 *     GitHub Flavored Markdown renderer does (cells split on pipes that are not escaped) and asserts that the header, the
 *     delimiter row and each of the 17 body rows have the same number of cells, one row per `PACK_TARGETS` entry in order.
 *
 * Writes nothing. Needs no IRIS.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PACK_TARGETS } from "../pack-targets.js";

import { assertBinFresh, PACKAGE_ROOT } from "./qa-41-6-helpers.js";

const RENDERER = path.join(PACKAGE_ROOT, "scripts", "render-certification-table.mjs");
const README = path.join(PACKAGE_ROOT, "README.md");
const BEGIN = "<!-- PACK-TARGETS-TABLE:BEGIN -->";
const END = "<!-- PACK-TARGETS-TABLE:END -->";
const COLUMNS = 6;

/** The cells of one table line, split the way GFM does: on every `|` that is not preceded by a backslash. */
function cellsOf(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  const inner = line.trim().replace(/^\|/, "");
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i] as string;
    if (char === "\\" && inner[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim() !== "") cells.push(current.trim());
  return cells;
}

describe("the generated Skills pack targets table, on the paths its gates do not reach", () => {
  it("render --check runs against a dist that is not older than src, and the README is in sync", async () => {
    // `assertBinFresh` fails when src/ is newer than dist/: the renderer reads dist/pack-targets.js, so without this
    // precondition a PACK_TARGETS edit in src/ would leave --check green.
    await assertBinFresh();
    const result = spawnSync(process.execPath, [RENDERER, "--check"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(result.status, `render --check failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("render --check: README.md marker sections are in sync");
  });

  it("the committed table has one header, one delimiter row and 17 body rows, all with the same cells, in PACK_TARGETS order", () => {
    const text = readFileSync(README, "utf8");
    const begin = text.indexOf(BEGIN);
    const end = text.indexOf(END);
    expect(begin, "the begin marker").toBeGreaterThanOrEqual(0);
    expect(text.indexOf(BEGIN, begin + 1), "one begin marker").toBe(-1);
    expect(end, "the end marker follows").toBeGreaterThan(begin);

    const lines = text.slice(begin, end).split("\n").filter((line) => line.startsWith("|"));
    expect(lines, "a header, a delimiter row and one row per target").toHaveLength(2 + PACK_TARGETS.length);
    const [header, delimiter, ...body] = lines as [string, string, ...string[]];

    expect(cellsOf(header)).toHaveLength(COLUMNS);
    const delimiterCells = cellsOf(delimiter);
    expect(delimiterCells).toHaveLength(COLUMNS);
    for (const cell of delimiterCells) expect(cell, "a delimiter cell").toMatch(/^:?-{3,}:?$/);

    body.forEach((line, index) => {
      const cells = cellsOf(line);
      const target = PACK_TARGETS[index];
      expect(cells, `row ${index + 1} (${target?.id}): cells ${JSON.stringify(cells.map((cell) => cell.slice(0, 24)))}`).toHaveLength(COLUMNS);
      expect(cells[1], `row ${index + 1} names the client id`).toBe(`\`${target?.id}\``);
      expect(cells[0], `row ${index + 1} names the client`).toBe(target?.displayName);
    });
  });
});
