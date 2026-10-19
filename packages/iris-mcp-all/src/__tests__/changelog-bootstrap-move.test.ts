/**
 * The CHANGELOG names the `BOOTSTRAP_VERSION` the committed embed carries: the newest section that names a
 * `BOOTSTRAP_VERSION` move must end at the embed's version. A story that regenerates the embed therefore names its
 * move in its own section, and each story's doc-claims test can pin its own move as literals that stay true after the
 * next move.
 *
 * Reads documents only: no IRIS and no built dist. Cross-package documentation checks live in `@iris-mcp/all`
 * (rule #45).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/** A documented move, in either wording the CHANGELOG uses: "moves from `a` to `b`", "moves `a` to `b`" or "moves `a` → `b`". */
const MOVE = /`BOOTSTRAP_VERSION` moves (?:from )?`([0-9a-f]{12})` (?:to|→) `([0-9a-f]{12})`/;

describe("the CHANGELOG names the BOOTSTRAP_VERSION of the committed embed", () => {
  it("the newest section that names a BOOTSTRAP_VERSION move ends at the version the committed embed carries", () => {
    const embed = /export const BOOTSTRAP_VERSION = "([0-9a-f]{12})"/.exec(read("packages/shared/src/bootstrap-classes.ts"))?.[1] ?? "";
    expect(embed, "the embed's BOOTSTRAP_VERSION line is found").not.toBe("");

    const sections = read("CHANGELOG.md").split(/^(?=## \[)/m).slice(1);
    expect(sections.length, "the CHANGELOG has its sections").toBeGreaterThan(10);
    const newest = sections
      .map((section) => ({ title: section.split("\n")[0] ?? "", move: MOVE.exec(section.replace(/\s+/g, " ")) }))
      .find((entry) => entry.move !== null);
    expect(newest, "some section names a BOOTSTRAP_VERSION move").toBeDefined();
    expect(
      newest?.move?.[2],
      `${newest?.title ?? ""}: the story that regenerates the embed names its move in its own section ("\`BOOTSTRAP_VERSION\` moves from \`<old>\` to \`<new>\`")`,
    ).toBe(embed);
  });
});
