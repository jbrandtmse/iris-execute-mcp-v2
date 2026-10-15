/**
 * Story 38.0 (ledger DW-511) - the dev package's prepublish gate runs its live-IRIS gate files
 * one after another.
 *
 * The gate files share ONE instance's Atelier async work queue and the QAFixtures classes, so
 * vitest's default file parallelism lets two files' test runs interleave and a gate fails on
 * the interleaving rather than on a defect. The script is a top-level spawn and cannot be
 * imported, so this reads its source and pins the argument list it hands to vitest.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, "..", "..", "scripts", "prepublish-gate.mjs");

describe("scripts/prepublish-gate.mjs (Story 38.0, DW-511)", () => {
  it("passes --no-file-parallelism to `vitest run`, ahead of the gate files", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const match = /^const vitestArgs = (\[[^\]]*\]);$/m.exec(source);
    expect(match, "the vitestArgs declaration").not.toBeNull();

    const args = match?.[1] ?? "";
    expect(args).toContain('"run", "--no-file-parallelism", ...gateTestFiles');
  });
});
