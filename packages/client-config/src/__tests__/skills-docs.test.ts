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
 *  - Each "Known limits" bullet of "Installing the skills pack" holds on the built bin, beside a control run that shows
 *    the oracle can see the behavior.
 *
 * Writes only under OS temp directories it creates and removes; the bin runs with a temp HOME.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { NOTE_CLAUDE_MD, PACK_ROUTES, PACK_TARGETS } from "../pack-targets.js";

import { makeSandbox, readProjectFile, removeSandboxes, writeProjectFile } from "./pack-test-helpers.js";
import {
  assertBinFresh,
  backupsOf,
  filesUnder,
  lstatTree,
  MANIFEST,
  PACKAGE_ROOT,
  packRuleForms,
  RULE_STEM,
  runBin,
  SPAWN_TEST_TIMEOUT,
  treeDiff,
} from "./qa-41-6-helpers.js";

const README = readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8");
const README_LINES = README.split("\n");
const ROUTED_IDS = PACK_TARGETS.filter((target) => target.route !== null).map((target) => target.id);
const T = 120_000;
const squash = (text: string): string => text.replace(/\s+/g, " ");

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

/**
 * The GitHub-style anchors of every ATX heading of a Markdown text: letters, digits and marks of any script are kept,
 * other punctuation is dropped, each whitespace character becomes a hyphen, and a repeated heading gets `-1`, `-2`, ....
 * A `#` line inside fenced code is not a heading.
 */
function markdownHeadingSlugs(text: string): Set<string> {
  const slugs = new Set<string>();
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (match === null) continue;
    const anchor = (match[2] as string)
      .replace(/<[^>]*>/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[`*~]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const count = seen.get(anchor) ?? 0;
    seen.set(anchor, count + 1);
    slugs.add(count === 0 ? anchor : `${anchor}-${count}`);
  }
  return slugs;
}

/** The README's `Known limits` bullet of "Installing the skills pack", whitespace collapsed. */
function knownLimits(): string {
  const start = README.indexOf("- **Known limits.**");
  expect(start, "the installer section has a Known limits bullet").toBeGreaterThan(-1);
  const end = README.indexOf("\n\nRun `iris-mcp-clients --help` for every option.", start);
  expect(end).toBeGreaterThan(start);
  return squash(README.slice(start, end));
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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
    const slugs = markdownHeadingSlugs(README);
    expect(slugs.has("installing-the-skills-pack")).toBe(true);
    expect(slugs.has("skills-pack-targets-generated")).toBe(true);
    const level2 = headings.filter((heading) => heading.startsWith("## "));
    const installer = level2.indexOf("## Installing the skills pack");
    expect(installer).toBeGreaterThan(-1);
    expect(level2[installer + 1]).toBe("## Skills pack targets (generated)");
    expect(README).toContain("(#skills-pack-targets-generated)");
  });
});

describe("the README's Known limits hold on the built bin", () => {
  const ruleLine = new RegExp(`^ {2}create +\\.claude/rules/${RULE_STEM}\\.md`, "m");
  const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  it("the claude-code route plans both the skills and the rule", () => {
    expect(knownLimits()).toContain(
      "The `claude-code` route always installs both the skills and the rule; it does not detect a Claude Code plugin.",
    );
    expect(PACK_ROUTES["claude-code"].skillsDir).toBe(".claude/skills");
    expect(PACK_ROUTES["claude-code"].rule).toMatchObject({ kind: "file", dir: ".claude/rules" });
    const sandbox = makeSandbox();
    const run = runBin(sandbox, ["skills", "install", "--client", "claude-code", "--dry-run"]);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toMatch(/^ {2}create +\.claude\/skills\//m);
    expect(run.stdout).toMatch(ruleLine);
  }, T);

  it("`--project` is not compared with the home directory: the home, named or as cwd, is planned like a project", () => {
    expect(knownLimits()).toContain(
      "`--project` is not compared with your home directory: `--project ~`, or a run from `~`, installs the rule where every project's session loads it.",
    );
    const sandbox = makeSandbox();
    const before = lstatTree(sandbox.root);
    const named = runBin(sandbox, ["skills", "install", "--client", "claude-code", "--project", sandbox.home, "--dry-run"]);
    expect(named.status, `${named.stdout}${named.stderr}`).toBe(0);
    expect(named.stdout).toMatch(ruleLine);
    const fromHome = runBin(sandbox, ["skills", "install", "--client", "claude-code", "--dry-run"], { cwd: sandbox.home });
    expect(fromHome.status, `${fromHome.stdout}${fromHome.stderr}`).toBe(0);
    expect(fromHome.stdout).toMatch(ruleLine);
    expect(treeDiff(before, lstatTree(sandbox.root)), "the dry runs wrote nothing").toEqual([]);
  }, T);

  it("only the project directory is checked for a CLAUDE.md", () => {
    expect(knownLimits()).toContain(
      "Only the project directory is checked for a `CLAUDE.md`; a `CLAUDE.md` in a parent directory is not seen.",
    );
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "CLAUDE.md", "# the parent's own words\n");
    const child = path.join(sandbox.project, "app");
    mkdirSync(child);
    const fromChild = runBin(sandbox, ["skills", "install", "--client", "claude-code", "--dry-run"], { cwd: child });
    expect(fromChild.status, `${fromChild.stdout}${fromChild.stderr}`).toBe(0);
    expect(fromChild.stdout, "a CLAUDE.md one folder up is not seen").not.toContain(NOTE_CLAUDE_MD);
    const fromParent = runBin(sandbox, ["skills", "install", "--client", "claude-code", "--dry-run"]);
    expect(fromParent.stdout, "the control: the project's own CLAUDE.md is seen").toContain(NOTE_CLAUDE_MD);
  }, T);

  it("an edit inside the installer's own block is replaced on the next install", () => {
    expect(knownLimits()).toContain("An edit inside the installer's own block is replaced on the next install.");
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "AGENTS.md", "# my notes\n");
    const first = runBin(sandbox, ["skills", "install", "--client", "codex", "--yes"]);
    expect(first.status, `${first.stdout}${first.stderr}`).toBe(0);
    const installed = readProjectFile(sandbox.project, "AGENTS.md");
    const at = installed.indexOf(packRuleForms().agentsMd);
    expect(at, "AGENTS.md holds the pack's block").toBeGreaterThan(-1);
    const afterBeginLine = installed.indexOf(0x0a, at) + 1;
    writeProjectFile(
      sandbox.project,
      "AGENTS.md",
      Buffer.concat([installed.subarray(0, afterBeginLine), Buffer.from("my line inside the block\n"), installed.subarray(afterBeginLine)]),
    );
    const again = runBin(sandbox, ["skills", "install", "--client", "codex", "--yes"]);
    expect(again.status, `${again.stdout}${again.stderr}`).toBe(0);
    expect(again.stdout).toMatch(/^ {2}update +AGENTS\.md /m);
    expect(readProjectFile(sandbox.project, "AGENTS.md").equals(installed), "the block is the pack's again").toBe(true);
  }, SPAWN_TEST_TIMEOUT);

  it("installing for one client never updates another client's files that it does not share", () => {
    expect(knownLimits()).toContain(
      "Installing for one client never updates the files of another client that it does not share.",
    );
    const sandbox = makeSandbox();
    const first = runBin(sandbox, ["skills", "install", "--client", "claude-code", "--yes"]);
    expect(first.status, `${first.stdout}${first.stderr}`).toBe(0);
    // One claude-code file now reads as installed from an older pack: its bytes and its recorded hash both change.
    const rel = ".claude/skills/check-system-health/SKILL.md";
    const older = Buffer.concat([readProjectFile(sandbox.project, rel), Buffer.from("a line of an older pack\n")]);
    writeProjectFile(sandbox.project, rel, older);
    const manifest = JSON.parse(readProjectFile(sandbox.project, MANIFEST).toString("utf8")) as {
      files: Array<{ path: string; sha256: string }>;
    };
    const entry = manifest.files.find((file) => file.path === rel);
    expect(entry, `${rel} is in the manifest`).toBeDefined();
    (entry as { sha256: string }).sha256 = sha256Hex(older);
    writeProjectFile(sandbox.project, MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

    const own = runBin(sandbox, ["skills", "install", "--client", "claude-code", "--dry-run"]);
    expect(own.status, `${own.stdout}${own.stderr}`).toBe(0);
    expect(own.stdout, "the control: claude-code's own install updates it").toMatch(new RegExp(`^ {2}update +${escapeRegExp(rel)}`, "m"));
    const other = runBin(sandbox, ["skills", "install", "--client", "codex", "--dry-run"]);
    expect(other.status, `${other.stdout}${other.stderr}`).toBe(0);
    expect(other.stdout).toMatch(/^ {2}create +\.agents\/skills\//m);
    expect(other.stdout, "codex's install plans nothing under .claude/").not.toMatch(/^ {2}\S+ +\.claude\//m);
  }, SPAWN_TEST_TIMEOUT);

  it("the notes about a client that reads a skill or the rule twice are fixed text, and nothing is deduplicated", () => {
    expect(knownLimits()).toContain(
      "The notes about a client that reads a skill or the rule twice are fixed text; the installer does not deduplicate.",
    );
    const cursor = PACK_TARGETS.find((target) => target.id === "cursor");
    expect(cursor?.notes.length, "cursor carries a note").toBeGreaterThan(0);
    const sandbox = makeSandbox();
    const alone = runBin(sandbox, ["skills", "install", "--client", "cursor", "--dry-run"]);
    expect(alone.status, `${alone.stdout}${alone.stderr}`).toBe(0);
    expect(filesUnder(sandbox.project).size, "the project holds nothing for another client").toBe(0);
    for (const note of cursor?.notes ?? []) expect(alone.stdout, "printed with nothing to read twice").toContain(note);
    const claudeCode = runBin(sandbox, ["skills", "install", "--client", "claude-code", "--yes"]);
    expect(claudeCode.status, `${claudeCode.stdout}${claudeCode.stderr}`).toBe(0);
    const twice = runBin(sandbox, ["skills", "install", "--client", "cursor", "--dry-run"]);
    expect(twice.stdout, "the skills Claude Code already has are planned again").toMatch(
      /^ {2}create +\.agents\/skills\/check-system-health\/SKILL\.md/m,
    );
  }, SPAWN_TEST_TIMEOUT);

  it("skills-pack backups are never pruned, doctor does not list them and restore does not read them", () => {
    expect(knownLimits()).toContain(
      "Skills-pack backups are never pruned, `doctor` does not list them and `restore` does not read them; copy a backup back by hand.",
    );
    const sandbox = makeSandbox();
    for (let round = 0; round < 2; round += 1) {
      const install = runBin(sandbox, ["skills", "install", "--client", "codex", "--yes"]);
      expect(install.status, `${install.stdout}${install.stderr}`).toBe(0);
      const uninstall = runBin(sandbox, ["skills", "uninstall", "--client", "codex", "--yes"]);
      expect(uninstall.status, `${uninstall.stdout}${uninstall.stderr}`).toBe(0);
    }
    expect(backupsOf(sandbox.home, ".agents/skills/check-system-health/SKILL.md"), "one backup per uninstall, both kept").toHaveLength(2);
    const doctor = runBin(sandbox, ["doctor"]);
    expect(doctor.status, `${doctor.stdout}${doctor.stderr}`).toBe(0);
    expect(`${doctor.stdout}${doctor.stderr}`).not.toContain("backups/skills-pack");
    const restore = runBin(sandbox, ["restore", "--client", "skills-pack"]);
    expect(restore.status).toBe(2);
    expect(restore.stderr).toContain('unknown client "skills-pack"');
  }, SPAWN_TEST_TIMEOUT);
});
