/**
 * Story 41.8 -- the documents state what the burn-down changed where it is used (project rules #30 and #43): the CHANGELOG
 * section and the changeset; and no new text claims regulatory compliance.
 *
 * The OS suite pins the behavior of `SanitizeError`, `StripErrorPrefix` and `SafeText`; no test of it reads a document. This
 * file asserts:
 *
 *  - the CHANGELOG section above the Story 41.7 one: its title, headings, the counts that do not move and the
 *    `BOOTSTRAP_VERSION` move;
 *  - the decisions and ledger id the Changed block records;
 *  - the changeset's bump map and its summary;
 *  - that the section and the changeset claim no compliance.
 *
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLAIMS } from "./doc-claims-patterns.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const squash = (text: string): string => text.replace(/\s+/g, " ");

/** The em dash the documents use in headings and notes, by code point. */
const EM_DASH = "\u{2014}";

/** The sections of a CHANGELOG, each starting at its `## [` heading. */
function sectionsOf(changelog: string): string[] {
  return changelog.split(/^(?=## \[)/m).slice(1);
}

const CHANGELOG_TITLE = new RegExp(`^## \\[Pre-release ${EM_DASH} 2026-10-19\\] ${EM_DASH} Story 41\\.8: Epic 41 burn-down$`);

/**
 * The `BOOTSTRAP_VERSION` values of the Story 41.8 move, as history literals: `changelog-bootstrap-move.test.ts` ties the newest
 * documented move to the committed embed, so a later move leaves this file true.
 */
const BOOTSTRAP_FROM = "5296a1c836f4";
const BOOTSTRAP_TO = "d51856f74d6a";

describe("Story 41.8: the CHANGELOG section and the changeset", () => {
  const changelog = read("CHANGELOG.md");
  const sections = sectionsOf(changelog);
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";

  it("has the Story 41.8 section above the Story 41.7 one, with Changed, Added, Tests and Known limits headings", () => {
    expect(section, "the CHANGELOG has the Story 41.8 section").not.toBe("");
    expect(section.split("\n").filter((line) => line.startsWith("### "))).toEqual([
      "### Changed",
      "### Added",
      "### Tests",
      "### Known limits",
    ]);
    const index = sections.indexOf(section);
    const previous = sections.findIndex((candidate) => (candidate.split("\n")[0] ?? "").includes("Story 41.7:"));
    expect(previous, "the CHANGELOG still has the Story 41.7 section").toBeGreaterThanOrEqual(0);
    expect(index, "newest section first").toBeLessThan(previous);
  });

  it("states the counts that do not move and the bootstrap move as literals", () => {
    const text = squash(section);
    expect(text).toContain("so no count moves: the suite stays at 110 package tools and 115 advertised");
    expect(text).toContain("the 12 prompts are byte-identical on the wire (16 hashes)");
    expect(text).toContain("the frozen governance baseline stays at hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain("the skills pack stays at 23 files, `gen:skills` at 13 generated files, and the bootstrapped service at 35 classes");
    expect(text).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
    expect(text).toContain("because `Utils.cls`, `Coverage/Job.cls` and `Diagram/Loader.cls` changed");
  });

  it("Changed records DW-622 and the decisions with what stays unchanged", () => {
    const text = squash(section);
    expect(text).toContain("removes the one leading status prefix in every message language (DW-622; wave-7 decision #45)");
    expect(text).toContain("so a status read in de, es-cl, fr, it, ja, ko, nl, pt-br, ru, uk or zh-cn kept its prefix and doubled it when re-wrapped");
    expect(text).toContain("It removes at most one prefix, and it returns a `<TOKEN>` item such as `<UNDEFINED>`, a bracket domain code such as `<Ens>ErrGeneral` and a look-alike that is part of the message unchanged.");
    expect(text).toContain("`ERREUR #5001: ERREUR #5001: Required parameter 'global' is missing or empty` before");
    expect(text).toContain("`ERREUR #5001: Required parameter 'global' is missing or empty` after");
    expect(text).toContain("gain an optional trailing language argument (wave-7 decision #44)");
    expect(text).toContain("runs the same one-argument `GetErrorText(status)` call as before, for all 614 call sites");
    expect(text).toContain("reads the inner message of the sanitized status (wave-7 decision #46)");
    expect(text).toContain("are joined by a space (wave-7 decision #47)");
    expect(text).toContain("a combined status read `disk fullERROR #5001: second`. It now reads `disk full ERROR #5001: second`");
    expect(text).toContain("is unchanged except for one comment (wave-7 decision #49)");
    expect(text).toContain("states the empty and `0` status edge (wave-7 decision #51)");
    expect(text).toContain("`ERROR #00: (no error description)` while `GetErrorCodes` returns `6219`");
  });

  it("Added and Tests record the OS class and the pinned languages", () => {
    const text = squash(section);
    expect(text).toContain("`ExecuteMCPv2.Tests.SanitizeErrorLocaleTest`**, an IRIS-side `%UnitTest` class with 9 `Test*` methods");
    expect(text).toContain("writes no global and changes no session, process or NLS locale");
    expect(text).toContain("`GetLanguages(\"%ObjectErrors\", \"s\")` and `GetLanguages(\"%Utility\", \"s\")` lists equal the 15 pins");
  });

  it("Added and Tests record the opt-in live gate, its guard and the BaseTest handler pin (DW-635, DW-634)", () => {
    const text = squash(section);
    expect(text).toContain("**`story-41-8-qa-accept-language-live-gate.test.ts`**, an opt-in live gate in the `@iris-mcp/all` prepublish roster");
    expect(text).toContain(
      "it reaches an instance only when `IRIS_REQUIRE_LIVE=1` and all five of `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD` and `IRIS_NAMESPACE` are set",
    );
    expect(text).toContain("deployed classes whose `BOOTSTRAP_VERSION` is not this tree's embed");
    expect(text).toContain("**`story-41-8-qa-gate-guard.test.ts`** (default suite, no IRIS)");
    expect(text).toContain("**`basetest-rest-handlers.test.ts`** (default suite)");
    expect(text).toContain("and against `SafeText`'s pre-41.8 tail, which the OS class does not see");
    expect(text).toContain("The guard test shows that an unarmed run sends no request.");
    expect(text).toContain("is now `TestEveryRestHandlerExtendsBase`");
    expect(text).toContain("that they equal the 19 the source tree holds, and `BaseTest` passes 7 of 7 again");
  });

  it("Known limits records the shape-only rule and the Arabic-only diagram word", () => {
    const text = squash(section);
    expect(text).toContain("`StripErrorPrefix` reads a shape");
    expect(text).toContain("`SanitizeError` never passes such text first");
    expect(text).toContain("`CleanStatusText` still normalizes only the Arabic word");
  });

  it("Known limits records the stale language docs and that only the opt-in gate checks a request language", () => {
    const text = squash(section);
    expect(text).toContain("The `IRIS_ACCEPT_LANGUAGE` text in `README.md` and `tool_support.md` still says");
    expect(text).toContain("that correction is left for a later docs story");
    expect(text).toContain("The one-argument call under a request language is checked only by the opt-in live gate, which a plain test run skips.");
    expect(text).not.toContain("not a repeatable test");
  });

  // `changeset version` consumes (deletes) the file and moves its text into the generated package
  // changelogs, so the bumps are checked while the file exists.
  const changesetPath = ".changeset/story-41-8-epic-41-burn-down.md";
  const changesetPresent = existsSync(path.join(REPO_ROOT, changesetPath));

  it.skipIf(!changesetPresent)("the changeset bumps exactly shared and client-config by a patch and records the bootstrap move", () => {
    const text = read(changesetPath);
    const frontMatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    const bumps = Object.fromEntries(
      frontMatter
        .split("\n")
        .map((line) => /^"([^"]+)":\s*(\w+)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1], match[2]]),
    );
    expect(bumps).toEqual({ "@iris-mcp/shared": "patch", "@iris-mcp/client-config": "patch" });
    expect(frontMatter.split("\n").filter((line) => line.trim() !== "")).toHaveLength(2);
    const summary = squash(text);
    expect(summary).toContain("fix: Epic 41 burn-down (Story 41.8)");
    expect(summary).toContain("removes the one leading status prefix in every message language the instance has");
    expect(summary).toContain("(DW-622)");
    expect(summary).toContain("gain an optional trailing language argument, and a call without it behaves as before");
    expect(summary).toContain("No tool, action, governance key, preset row, prompt, refusal code, environment variable or route is added or changed, so no tool count moves.");
    expect(summary).toContain(`\`BOOTSTRAP_VERSION\` moves from \`${BOOTSTRAP_FROM}\` to \`${BOOTSTRAP_TO}\``);
  });
});

describe("Story 41.8: no new text claims regulatory compliance", () => {
  const sections = sectionsOf(read("CHANGELOG.md"));
  const section = sections.find((candidate) => CHANGELOG_TITLE.test(candidate.split("\n")[0] ?? "")) ?? "";

  const changesetPath = ".changeset/story-41-8-epic-41-burn-down.md";
  const changesetEntries: Array<readonly [string, string]> = existsSync(path.join(REPO_ROOT, changesetPath))
    ? [["the changeset", read(changesetPath)]]
    : [];

  for (const [name, text] of [
    ["the CHANGELOG section", section],
    ...changesetEntries,
    ["skills-pack-src/knowledge/iris-mcp-objectscript-error-handling/SKILL.md", read("skills-pack-src/knowledge/iris-mcp-objectscript-error-handling/SKILL.md")],
  ] as const) {
    it(`${name} makes no compliance claim`, () => {
      expect(text.length, `${name} is not empty`).toBeGreaterThan(0);
      for (const claim of CLAIMS) expect(text.match(claim)?.[0], `${name} matches ${String(claim)}`).toBeUndefined();
    });
  }
});
