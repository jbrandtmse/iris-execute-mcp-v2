/**
 * Story 41.1 (QA, AC 41.1.3 and 41.1.4) - `pnpm check:provenance` (`scripts/check-provenance.mjs`) as a real
 * process, with the real npm packer, against a SCRATCH COPY of the real tree under `os.tmpdir()`.
 *
 * `pack-provenance.test.ts` drives the rules with in-memory inputs. These tests drive the whole chain a
 * contributor and CI run: adapted source on disk -> `gen-pack.mjs` -> the pack -> `check-provenance.mjs`
 * (gather, then check). Each failing case asserts the EXACT set of rule tags on stderr, so a red caused by
 * the wrong rule, or by an accident of the fixture, fails the test. Every red case has a green control that
 * differs in the one thing under test.
 *
 * The scratch root holds the real `scripts/`, `skills/`, `skills-pack-src/`, the committed pack, and
 * client-config's real `package.json` and `dist/`. No network, no IRIS, no read of the upstream checkout.
 * The pinned expectations are typed here from the upstream capture.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  KNOWLEDGE_SOURCE_DIR,
  NOTICE_FILENAME,
  PACK_DIR,
  PACK_SOURCE_DIR,
} from "../../../../scripts/lib/skills-pack.mjs";
import { makeTempRoot, put, REPO_ROOT } from "./pack-fixture";
import { BOM, makeScratchRepo, problemRules, removeScratchRepo, runScript, toCrlf } from "./story-41-1-qa-fixture";

const PINNED_SHA256 = "85b458dc150c4d17873dd5e73d01cfa23c797997a09d841884e08378242e929c";
const PINNED_COMMIT = "b6205bbbad2f431ae14c34401fd55d85cb5d2305";
/** U+00A9 COPYRIGHT SIGN, U+200B ZERO WIDTH SPACE and U+043E CYRILLIC SMALL LETTER O, from code points (ASCII source). */
const COPYRIGHT_SIGN = String.fromCharCode(0xa9);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const CYRILLIC_SMALL_O = String.fromCharCode(0x43e);
const HEADER = `Adapted from intersystems-community/iris-agentic-dev (MIT, ${COPYRIGHT_SIGN} 2025 InterSystems Corporation); see IRIS-MCP-THIRD-PARTY-NOTICES.md`;

const CHECK = "scripts/check-provenance.mjs";
const GEN_PACK = "scripts/gen-pack.mjs";
const NOTICE_REL = `${PACK_SOURCE_DIR}/${NOTICE_FILENAME}`;
const SEPARATOR_ROW = "| --- | --- | --- |\n";
const SKILL_REL = "skills/qa-adapted/SKILL.md";
const SKILL_SRC = `${KNOWLEDGE_SOURCE_DIR}/qa-adapted/SKILL.md`;
const GOOD_SOURCE = "skills/skills/objectscript-style/SKILL.md";

const temps: string[] = [];
function scratch(): string {
  const root = makeScratchRepo({ clientConfigManifest: true });
  temps.push(root);
  return root;
}
afterEach(() => {
  for (const root of temps.splice(0)) removeScratchRepo(root);
});

const row = (packFile: string, source: string): string => `| \`${packFile}\` | \`${source}\` | adapted for the pack |`;

/** A skill file: frontmatter, then `headerBlock` as the first non-blank line, then a body. */
function skillText(headerBlock: string, body = "Body.\n"): string {
  return `---\nname: qa-adapted\ndescription: a skill adapted for the pack\n---\n\n${headerBlock}\n\n${body}`;
}

/** Edit the scratch source notice in place (text in, text out) and keep it as UTF-8. */
function editNotice(root: string, change: (text: string) => string): void {
  const path = join(root, NOTICE_REL);
  const before = readFileSync(path, "utf8");
  const after = change(before);
  expect(after, "the edit changed the notice").not.toBe(before);
  writeFileSync(path, Buffer.from(after, "utf8"));
}

/** Put an adapted knowledge skill and its provenance row in the scratch root, then build the pack. */
function adapt(root: string, options: { skill: string | Buffer; rowLine?: string | null }): void {
  put(root, SKILL_SRC, options.skill);
  const rowLine = options.rowLine === undefined ? row(SKILL_REL, GOOD_SOURCE) : options.rowLine;
  if (rowLine !== null) editNotice(root, (text) => text.replace(SEPARATOR_ROW, () => `${SEPARATOR_ROW}${rowLine}\n`));
  const generated = runScript(root, GEN_PACK);
  expect(generated.status, generated.stderr).toBe(0);
}

/** Run the check and require a red with exactly the given rule tags. */
function expectRed(root: string, rules: string[]): string {
  const run = runScript(root, CHECK);
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
  expect(problemRules(run.stderr), run.stderr).toEqual(rules);
  expect(run.stdout).not.toContain("check-provenance: OK");
  return run.stderr;
}

function expectGreen(root: string): string {
  const run = runScript(root, CHECK);
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  expect(run.stdout).toContain("check-provenance: OK");
  return run.stdout;
}

describe("check:provenance CLI, scratch copy: the green controls", () => {
  it("the unmodified copy passes: pinned MIT hash, the one real row, the 39 agent files and one distribution", () => {
    const out = expectGreen(scratch());
    expect(out).toContain(`MIT block sha256 ${PINNED_SHA256} (1081 bytes)`);
    expect(out).toContain("1 provenance row(s), 39 agent file(s), 1 distribution(s)");
  });

  it("an adapted skill with the exact header and a row passes, source and pack copy both counted", () => {
    const root = scratch();
    adapt(root, { skill: skillText(HEADER) });
    expect(expectGreen(root)).toContain("2 provenance row(s), 41 agent file(s), 1 distribution(s)");
  });

  it("the same adapted skill as CRLF passes (project rule #58)", () => {
    const root = scratch();
    adapt(root, { skill: toCrlf(Buffer.from(skillText(HEADER), "utf8")) });
    expect(expectGreen(root)).toContain("2 provenance row(s), 41 agent file(s)");
  });

  it("the same adapted skill as CRLF with a BOM before its frontmatter is refused, for the source and for the pack copy", () => {
    const root = scratch();
    adapt(root, { skill: Buffer.concat([BOM, toCrlf(Buffer.from(skillText(HEADER), "utf8"))]) });
    const stderr = expectRed(root, ["skill-frontmatter"]);
    expect(stderr).toContain("knowledge:qa-adapted/SKILL.md: begins with a byte-order mark");
    expect(stderr).toContain("pack:skills/qa-adapted/SKILL.md: begins with a byte-order mark");
  });
});

describe("check:provenance CLI, scratch copy: a near-miss adaptation header (AC 41.1.4)", () => {
  const NEAR_MISSES: Array<[string, string]> = [
    ["a plain (c) in place of the copyright sign", HEADER.replace(COPYRIGHT_SIGN, "(c)")],
    ["the year 2024", HEADER.replace("2025", "2024")],
    ["the retired notice filename", HEADER.replace(NOTICE_FILENAME, "THIRD_PARTY_NOTICES.md")],
    ["a trailing space", `${HEADER} `],
    ["the see clause cut off", HEADER.split("; see")[0] ?? ""],
    ["an HTML comment wrapper", `<!-- ${HEADER} -->`],
    ["a blockquote marker", `> ${HEADER}`],
    ["lower case throughout", HEADER.toLowerCase()],
    ["a zero-width space appended", `${HEADER}${ZERO_WIDTH_SPACE}`],
    ["an underscore in the organisation name", HEADER.replace("intersystems-community", "intersystems_community")],
  ];

  it.each(NEAR_MISSES)("%s is refused for the source and for the pack copy", (_name, header) => {
    expect(header).not.toBe(HEADER);
    const root = scratch();
    adapt(root, { skill: skillText(header) });
    const stderr = expectRed(root, ["header", "row-file"]);
    expect(stderr).toContain("knowledge:qa-adapted/SKILL.md: missing or misplaced adaptation header");
    expect(stderr).toContain("pack:skills/qa-adapted/SKILL.md: missing or misplaced adaptation header");
  });

  it("the exact header after the first body line is misplaced", () => {
    const root = scratch();
    adapt(root, { skill: `---\nname: qa-adapted\ndescription: d\n---\n\nFirst body line.\n\n${HEADER}\n` });
    expectRed(root, ["header", "row-file"]);
  });

  it("the exact header in a frontmatter block that is never closed is misplaced", () => {
    const root = scratch();
    adapt(root, { skill: `---\nname: qa-adapted\n\n${HEADER}\n\nBody.\n` });
    expectRed(root, ["header", "row-file", "skill-frontmatter"]);
  });

  it("a row for a file with no header and no mention of the upstream project is refused as a row problem", () => {
    const root = scratch();
    adapt(root, { skill: skillText("An ordinary line.") });
    expectRed(root, ["row-file"]);
  });

  it("the exact header without any provenance row is refused as a claim without a row", () => {
    const root = scratch();
    adapt(root, { skill: skillText(HEADER), rowLine: null });
    const stderr = expectRed(root, ["claim-row"]);
    expect(stderr).toContain(`no provenance row for ${SKILL_REL}`);
  });

  it("a mention in upper case, with no header and no row, is refused for both", () => {
    const root = scratch();
    adapt(root, { skill: skillText("An ordinary line.", "Based on IRIS-AGENTIC-DEV.\n"), rowLine: null });
    expectRed(root, ["claim-row", "header"]);
  });
});

describe("check:provenance CLI, scratch copy: a row citing an excluded source (AC 41.1.4)", () => {
  const EXCLUDED: string[] = [
    "skills/kb/ipm-module-authoring.md",
    "./skills/kb/ipm-module-authoring.md",
    "skills/kb/ipm-module-authoring.md#L5",
    "skills/kb/ipm-module-authoring.md:12",
    "Skills/KB/IPM-Module-Authoring.md",
    "skills\\kb\\ipm-module-authoring.md",
    "skills/skills/iris-objectscript-eval/SKILL.md",
    "skills/skills/IRIS-ObjectScript-Eval/SKILL.md",
    "skills/skills/iris-objectscript-eval/",
    "../iris-agentic-dev/skills/skills/objectscript-style/SKILL.md",
    "/work/iris-agentic-dev/skills/skills/objectscript-style/SKILL.md",
    "https://github.com/intersystems-community/iris-agentic-dev/blob/b6205bb/skills/kb/ipm-module-authoring.md",
  ];

  it.each(EXCLUDED.map((source) => [source] as const))("the source cell %s is refused with a valid file, header and row otherwise", (source) => {
    const root = scratch();
    adapt(root, { skill: skillText(HEADER), rowLine: row(SKILL_REL, source) });
    const stderr = expectRed(root, ["excluded-source"]);
    expect(stderr).toContain(`excluded or malformed source: ${source}`);
  });

  it("a row with a fourth cell is refused, and its file counts as having no row", () => {
    const root = scratch();
    adapt(root, { skill: skillText(HEADER), rowLine: `| \`${SKILL_REL}\` | \`${GOOD_SOURCE}\` | adapted | extra |` });
    expectRed(root, ["claim-row", "provenance-table"]);
  });

  it("a row with an empty source cell is refused, and its file counts as having no row", () => {
    const root = scratch();
    adapt(root, { skill: skillText(HEADER), rowLine: `| \`${SKILL_REL}\` |  | adapted |` });
    expectRed(root, ["claim-row", "provenance-table"]);
  });

  it.each([
    ["a leading ./", `./${SKILL_REL}`],
    ["different letter case", "skills/QA-Adapted/SKILL.md"],
    ["backslashes", "skills\\qa-adapted\\SKILL.md"],
    ["a trailing slash", `${SKILL_REL}/`],
  ])("a pack-file cell with %s does not match the pack file: the row and the claim are both refused", (_name, packFile) => {
    const root = scratch();
    adapt(root, { skill: skillText(HEADER), rowLine: row(packFile, GOOD_SOURCE) });
    expectRed(root, ["claim-row", "row-file"]);
  });
});

describe("check:provenance CLI, scratch copy: the notice and its MIT block (AC 41.1.3)", () => {
  const MIT_VARIANTS: Array<[string, (text: string) => string]> = [
    ["one letter substituted", (text) => text.replace("Permission is hereby", "Permissiom is hereby")],
    ["a hyphen in place of a space", (text) => text.replace('"AS IS"', '"AS-IS"')],
    ["the year 2025 changed to 2024", (text) => text.replace("Copyright (c) 2025", "Copyright (c) 2024")],
    ["a trailing space on the first line", (text) => text.replace("MIT License\n", "MIT License \n")],
    ["one blank line removed", (text) => text.replace("MIT License\n\nCopyright", "MIT License\nCopyright")],
    ["one LF replaced by CRLF", (text) => text.replace("MIT License\n\nCopyright", "MIT License\r\n\nCopyright")],
    ["the final period removed", (text) => text.replace("SOFTWARE.\n```", "SOFTWARE\n```")],
    ["a Cyrillic o in place of a Latin o", (text) => text.replace("of the Software", `of the S${CYRILLIC_SMALL_O}ftware`)],
  ];

  it.each(MIT_VARIANTS)("%s is refused, naming the pinned hash and length", (_name, change) => {
    const root = scratch();
    editNotice(root, change);
    expect(runScript(root, GEN_PACK).status).toBe(0);
    const stderr = expectRed(root, ["mit-block"]);
    expect(stderr).toContain(`expected sha256 ${PINNED_SHA256}, 1081 bytes`);
  });

  it("a pack notice that differs from the source notice is refused for the sync and for the tarball", () => {
    const root = scratch();
    const packNotice = join(root, PACK_DIR, NOTICE_FILENAME);
    writeFileSync(packNotice, Buffer.concat([readFileSync(packNotice), Buffer.from("\n")]));
    expectRed(root, ["distribution", "notice-sync"]);
  });

  it("a deleted pack notice is refused for the sync and for the tarball", () => {
    const root = scratch();
    rmSync(join(root, PACK_DIR, NOTICE_FILENAME));
    const stderr = expectRed(root, ["distribution", "notice-sync"]);
    expect(stderr).toContain("the pack does not contain the notice");
  });

  it("a deleted source notice is refused", () => {
    const root = scratch();
    rmSync(join(root, NOTICE_REL));
    const run = runScript(root, CHECK);
    expect(run.status).toBe(1);
    expect(problemRules(run.stderr)).toContain("notice");
  });

  it.each([
    ["the full upstream commit", (text: string) => text.replace(PINNED_COMMIT, "b6205bb"), ["notice"]],
    ["the credit Tom Dyar", (text: string) => text.replace("Tom Dyar", "T. Dyar"), ["notice"]],
    ["the credit Tim Leavitt", (text: string) => text.replace("Tim Leavitt", "T. Leavitt"), ["notice"]],
    [
      "the non-endorsement sentence",
      (text: string) => text.replace("they are not affiliated with, sponsored by, or endorsed by", "they are affiliated with"),
      ["notice"],
    ],
    // Without the header row no row is read, so the real adapted skill (its source and its pack copy) has no row: claim-row.
    [
      "the provenance table header row (no row is then read, so the real adapted skill is refused too, as claim-row)",
      (text: string) => text.replace("| Pack file | Source file at b6205bb | Adaptation |", "| File | Source | Note |"),
      ["claim-row", "notice"],
    ],
  ])("a notice without %s is refused", (_name, change, rules) => {
    const root = scratch();
    editNotice(root, change);
    expect(runScript(root, GEN_PACK).status).toBe(0);
    expect(expectRed(root, rules)).toContain("the notice lacks");
  });
});

describe("check:provenance CLI, scratch copy: distributions through the real npm packer (AC 41.1.4)", () => {
  /** A second workspace package; `files` lists exactly the given files. */
  function addPackage(root: string, dir: string, files: Record<string, string | Buffer>): void {
    put(root, `packages/${dir}/package.json`, JSON.stringify({ name: `@zz/${dir}`, version: "1.0.0", files: Object.keys(files) }, null, 2));
    for (const [rel, content] of Object.entries(files)) put(root, `packages/${dir}/${rel}`, content);
  }

  const canonicalNotice = (root: string): Buffer => readFileSync(join(root, NOTICE_REL));
  const packReadme = (root: string): Buffer => readFileSync(join(root, PACK_DIR, "README.md"));

  it("control: a package with ordinary content passes, and both distributions are counted", () => {
    const root = scratch();
    addPackage(root, "clean", { "index.js": "export const value = 1;\n" });
    expect(expectGreen(root)).toContain("2 distribution(s)");
  });

  it("a byte-identical copy of a pack file in another package, without the notice, is refused naming that package", () => {
    const root = scratch();
    addPackage(root, "leaky", { "leak.md": packReadme(root) });
    const stderr = expectRed(root, ["distribution"]);
    expect(stderr).toContain("@zz/leaky");
    expect(stderr).toContain(`no ${NOTICE_FILENAME} equal to the canonical notice`);
  });

  it("a file carrying the ASCII marker, without the notice, is refused naming that package", () => {
    const root = scratch();
    addPackage(root, "leaky", { "index.js": "// Adapted from intersystems-community/iris-agentic-dev\nexport const x = 1;\n" });
    const stderr = expectRed(root, ["distribution"]);
    expect(stderr).toContain("@zz/leaky");
  });

  it("the same leak passes when the canonical notice ships beside it", () => {
    const root = scratch();
    addPackage(root, "leaky", { "leak.md": packReadme(root), [NOTICE_FILENAME]: canonicalNotice(root) });
    expectGreen(root);
  });

  it("the same leak is refused when the notice beside it differs by one byte", () => {
    const root = scratch();
    const altered = Buffer.from(canonicalNotice(root));
    altered.writeUInt8(altered.readUInt8(10) ^ 0x01, 10);
    addPackage(root, "leaky", { "leak.md": packReadme(root), [NOTICE_FILENAME]: altered });
    expect(expectRed(root, ["distribution"])).toContain("@zz/leaky");
  });

  it("the same leak is refused when the canonical notice ships under another name", () => {
    const root = scratch();
    addPackage(root, "leaky", { "leak.md": packReadme(root), "THIRD_PARTY_NOTICES.md": canonicalNotice(root) });
    expect(expectRed(root, ["distribution"])).toContain("@zz/leaky");
  });

  it("client-config without skills-pack in its files list ships no pack file: every pack file is named", () => {
    const root = scratch();
    const manifestPath = join(root, "packages/client-config/package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files: string[] };
    expect(manifest.files).toContain("skills-pack");
    manifest.files = manifest.files.filter((entry) => entry !== "skills-pack");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const stderr = expectRed(root, ["distribution"]);
    expect(stderr).toContain(`the tarball lacks the pack file skills-pack/${NOTICE_FILENAME}`);
    expect(stderr).toContain("the tarball lacks the pack file skills-pack/skills/check-system-health/SKILL.md");
  });

  it("client-config without its dist/ is refused loudly, never passed", () => {
    const root = scratch();
    rmSync(join(root, "packages/client-config/dist"), { recursive: true });
    const stderr = expectRed(root, ["distribution"]);
    expect(stderr).toContain("ships dist but its tarball file list names no dist/ file");
  });

  it("a package.json that is not valid JSON is refused, naming it", () => {
    const root = scratch();
    writeFileSync(join(root, "packages/client-config/package.json"), "{ not json");
    const stderr = expectRed(root, ["distribution"]);
    expect(stderr).toContain("is not valid JSON");
  });

  it("with npm missing from PATH the check is refused, never skipped", () => {
    const root = scratch();
    const emptyBin = makeTempRoot("qa-41-1-empty-path");
    temps.push(emptyBin);
    const run = runScript(root, CHECK, [], { PATH: emptyBin });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
    expect(problemRules(run.stderr)).toEqual(["distribution"]);
    expect(run.stderr).toContain("could not run");
    expect(run.stdout).not.toContain("check-provenance: OK");
  });

  it("the notice the fixtures treat as canonical is the repository notice (guards the fixture itself)", () => {
    expect(canonicalNotice(scratch()).equals(readFileSync(join(REPO_ROOT, NOTICE_REL)))).toBe(true);
  });
});
