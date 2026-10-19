/**
 * Story 41.4 QA (AC 41.4.3) - the pack's FIRST real provenance row, driven as a real `pnpm check:provenance`
 * (`scripts/check-provenance.mjs`) process in SCRATCH COPIES of the real tree under `os.tmpdir()`.
 *
 * `story-41-1-qa-provenance-cli.test.ts` proves every rule on a synthetic adapted skill (`qa-adapted`). Since Story 41.4 the
 * tree holds a REAL adapted skill, `iris-mcp-objectscript-sql`, with a real row in the notice. These rows damage that real
 * skill, its real row or its real header one way at a time, rebuild the pack with the real `gen-pack.mjs` where the source
 * changed, run the real checker with the real npm packer, and pin the exact set of `[rule] label` pairs on stderr. Each
 * defect has the green control that differs in nothing else: the unmodified copy.
 *
 * The expected pairs are typed here from the rules of `scripts/lib/provenance-core.mjs` and then confirmed by running the
 * checker on each scratch copy (capture: `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-41-4-qa-first-row-process.test.ts`,
 * IRIS 2026.2 build of the pack at Story 41.4). The real tree is never written. No IRIS, no network, no read of the upstream
 * checkout.
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWLEDGE_SOURCE_DIR, NOTICE_FILENAME, PACK_DIR, PACK_SOURCE_DIR } from "../../../../scripts/lib/skills-pack.mjs";
import { REPO_ROOT } from "./pack-fixture";
import { makeScratchRepo, problemPairs, removeScratchRepo, runScript } from "./story-41-1-qa-fixture";

/** U+00A9 COPYRIGHT SIGN, from its code point (the test source stays ASCII). */
const COPYRIGHT_SIGN = String.fromCharCode(0xa9);
/** The adaptation header, typed from AD-28's wording (not read from the checker). */
const HEADER = `Adapted from intersystems-community/iris-agentic-dev (MIT, ${COPYRIGHT_SIGN} 2025 InterSystems Corporation); see IRIS-MCP-THIRD-PARTY-NOTICES.md`;

const SKILL = "iris-mcp-objectscript-sql";
const SOURCE_REL = `${KNOWLEDGE_SOURCE_DIR}/${SKILL}/SKILL.md`;
const NOTICE_REL = `${PACK_SOURCE_DIR}/${NOTICE_FILENAME}`;
const PACK_FILE = `skills/${SKILL}/SKILL.md`;
const ROW_SOURCE = "skills/skills/objectscript-sql-patterns/SKILL.md";
/** The two labels `check:provenance` gives the adapted skill: its knowledge source and its pack copy. */
const KNOWLEDGE_LABEL = `knowledge:${SKILL}/SKILL.md`;
const PACK_LABEL = `pack:${PACK_FILE}`;

const CHECK = "scripts/check-provenance.mjs";
const GEN_PACK = "scripts/gen-pack.mjs";
/** The four installer routes' distributions (Story 41.6): each holds the pack's skills, so each is refused when the notice is not canonical. */
const INSTALLER_DISTRIBUTIONS = ["agents", "claude-code", "cursor", "gemini"].map((route) => `distribution installer:${route}`);

const temps: string[] = [];
function scratch(): string {
  const root = makeScratchRepo({ clientConfigManifest: true });
  temps.push(root);
  return root;
}
afterEach(() => {
  for (const root of temps.splice(0)) {
    removeScratchRepo(root);
    expect(existsSync(root), `the scratch root ${root} is removed`).toBe(false);
  }
});

/** The row line of the adapted skill in the notice text. */
function rowLine(notice: string): string {
  const rows = notice.split("\n").filter((line) => line.startsWith(`| \`${PACK_FILE}\` |`));
  expect(rows, "the real notice holds exactly one row for the adapted skill").toHaveLength(1);
  return rows[0] as string;
}

/** Change a file of the scratch copy (text in, text out); the change must alter it. */
function edit(root: string, rel: string, change: (text: string) => string): void {
  const path = join(root, rel);
  const before = readFileSync(path, "utf8");
  const after = change(before);
  expect(after, `the edit changed ${rel}`).not.toBe(before);
  writeFileSync(path, Buffer.from(after, "utf8"));
}

function regenerate(root: string): void {
  const run = runScript(root, GEN_PACK);
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
}

/** Run the checker; it must exit 1 with exactly these pairs. Returns stderr. */
function expectRed(root: string, expected: string[]): string {
  const run = runScript(root, CHECK);
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
  expect(run.stdout).not.toContain("check-provenance: OK");
  expect(problemPairs(run.stderr), run.stderr).toEqual([...expected].sort());
  return run.stderr;
}

describe("check:provenance CLI, scratch copy of the real tree: the real adapted skill and its real row (AC 41.4.3)", () => {
  it("control: the unmodified copy passes with the one real row and the 40 agent files, and starts from the shipped state", () => {
    const root = scratch();
    const source = readFileSync(join(root, SOURCE_REL), "utf8");
    expect(source.split("\n")[5], "the header is line 6 of the real source").toBe(HEADER);
    expect(source.split("\n").filter((line) => line === HEADER)).toHaveLength(1);
    expect(rowLine(readFileSync(join(root, NOTICE_REL), "utf8"))).toContain(`| \`${ROW_SOURCE}\` |`);
    const run = runScript(root, CHECK);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("1 provenance row(s), 40 agent file(s), 5 distribution(s)");
    // The scratch pack is the committed pack: regenerating it from the unmodified sources changes nothing.
    regenerate(root);
    expect(readFileSync(join(root, PACK_DIR, PACK_FILE)).equals(readFileSync(join(REPO_ROOT, PACK_DIR, PACK_FILE)))).toBe(true);
    const again = runScript(root, CHECK);
    expect(again.status, `${again.stdout}${again.stderr}`).toBe(0);
  });

  it("the row removed from the source notice, pack regenerated: a claim without a row, for the source and for the pack copy", () => {
    const root = scratch();
    edit(root, NOTICE_REL, (text) => text.replace(`${rowLine(text)}\n`, ""));
    regenerate(root);
    const stderr = expectRed(root, [`claim-row ${KNOWLEDGE_LABEL}`, `claim-row ${PACK_LABEL}`]);
    expect(stderr).toContain(`no provenance row for ${PACK_FILE}`);
  });

  it("the row removed from the source notice but the pack NOT regenerated: the stale pack notice is refused too", () => {
    const root = scratch();
    edit(root, NOTICE_REL, (text) => text.replace(`${rowLine(text)}\n`, ""));
    expectRed(root, [
      `claim-row ${KNOWLEDGE_LABEL}`,
      `claim-row ${PACK_LABEL}`,
      `distribution @iris-mcp/client-config`,
      ...INSTALLER_DISTRIBUTIONS,
      `notice-sync skills-pack/${NOTICE_FILENAME}`,
    ]);
  });

  it("the header removed from the source, pack regenerated: the row names a pack file without the header", () => {
    const root = scratch();
    edit(root, SOURCE_REL, (text) => text.replace(`${HEADER}\n\n`, ""));
    regenerate(root);
    // With the header gone the file no longer mentions the upstream project at all, so only the row's own check can see it.
    // The installed copies then carry pack content but no notice, which each installer route reports as a distribution.
    const stderr = expectRed(root, [`row-file ${PACK_FILE}`, ...INSTALLER_DISTRIBUTIONS]);
    expect(stderr).toContain("without the adaptation header");
  });

  it("the header moved above the frontmatter: the frontmatter rule refuses it, for the source and for the pack copy", () => {
    const root = scratch();
    edit(root, SOURCE_REL, (text) => `${HEADER}\n\n${text.replace(`${HEADER}\n\n`, "")}`);
    regenerate(root);
    // The header is then the first non-blank line of a file that has no frontmatter, which the header rule accepts;
    // the frontmatter rule is the one that catches it.
    const stderr = expectRed(root, [`skill-frontmatter ${KNOWLEDGE_LABEL}`, `skill-frontmatter ${PACK_LABEL}`]);
    expect(stderr).toContain("does not open with a --- frontmatter line");
  });

  it.each([
    ["the copyright sign written (c)", (text: string) => text.replace(COPYRIGHT_SIGN, "(c)")],
    ["the year 2024", (text: string) => text.replace("2025", "2024")],
    ["the notice filename misspelled", (text: string) => text.replace("IRIS-MCP-THIRD-PARTY-NOTICES.md", "IRIS-MCP-THIRD-PARTY-NOTICE.md")],
    ["a trailing space", (text: string) => text.replace(`${HEADER}\n`, `${HEADER} \n`)],
  ])("the credit line altered, %s: the header is refused for both copies, and the row's pack file has no valid header", (_name, change) => {
    const root = scratch();
    edit(root, SOURCE_REL, change);
    regenerate(root);
    const stderr = expectRed(root, [`header ${KNOWLEDGE_LABEL}`, `header ${PACK_LABEL}`, `row-file ${PACK_FILE}`]);
    expect(stderr).toContain("missing or misplaced adaptation header");
  });

  it.each([
    ["the ipm-module-authoring knowledge-base file", "skills/kb/ipm-module-authoring.md"],
    ["the iris-objectscript-eval skill", "skills/skills/iris-objectscript-eval/SKILL.md"],
    ["a path with a line suffix", `${ROW_SOURCE}:12`],
  ])("the row citing an excluded or malformed source, %s: refused, and nothing else is", (_name, source) => {
    const root = scratch();
    edit(root, NOTICE_REL, (text) => text.replace(`| \`${ROW_SOURCE}\` |`, `| \`${source}\` |`));
    regenerate(root);
    const stderr = expectRed(root, [`excluded-source ${PACK_FILE}`]);
    expect(stderr).toContain(`excluded or malformed source: ${source}`);
  });

  it("the row citing another valid source file is NOT caught here (the knowledge test owns which file is cited)", () => {
    const root = scratch();
    edit(root, NOTICE_REL, (text) => text.replace(`| \`${ROW_SOURCE}\` |`, "| `skills/skills/objectscript-style/SKILL.md` |"));
    regenerate(root);
    const run = runScript(root, CHECK);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("1 provenance row(s), 40 agent file(s)");
  });

  it("the row's pack-file cell renamed: the row names a file that is not in the pack, and the real skill has no row", () => {
    const root = scratch();
    edit(root, NOTICE_REL, (text) => text.replace(`| \`${PACK_FILE}\` |`, `| \`skills/${SKILL}-v2/SKILL.md\` |`));
    regenerate(root);
    const stderr = expectRed(root, [`claim-row ${KNOWLEDGE_LABEL}`, `claim-row ${PACK_LABEL}`, `row-file skills/${SKILL}-v2/SKILL.md`]);
    expect(stderr).toContain("names a file that is not in the pack");
  });

  it("the skill's directory renamed in the sources, pack regenerated: the name no longer matches, the new path has no row, the row's file is gone", () => {
    const root = scratch();
    const renamed = `${SKILL}-v2`;
    renameSync(join(root, KNOWLEDGE_SOURCE_DIR, SKILL), join(root, KNOWLEDGE_SOURCE_DIR, renamed));
    regenerate(root);
    expect(existsSync(join(root, PACK_DIR, "skills", SKILL)), "the old pack directory is gone after the rebuild").toBe(false);
    expectRed(root, [
      `claim-row knowledge:${renamed}/SKILL.md`,
      `claim-row pack:skills/${renamed}/SKILL.md`,
      `row-file ${PACK_FILE}`,
      `skill-frontmatter knowledge:${renamed}/SKILL.md`,
      `skill-frontmatter pack:skills/${renamed}/SKILL.md`,
    ]);
  });
});
