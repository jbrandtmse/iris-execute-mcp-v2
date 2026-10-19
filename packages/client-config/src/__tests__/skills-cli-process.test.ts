/**
 * Story 41.6 - AC 41.6.4 at process level (Rule #22): the BUILT bin, `dist/cli/clients-cli.js`, run as a real
 * child process with `cwd` set to a temp project and HOME/USERPROFILE/APPDATA set to a temp home.
 *
 * The child env is built from scratch, so nothing from the developer's shell or real home can leak in. The suite
 * fingerprints the real repository root's rule, skill and instruction paths before and after and requires them
 * unchanged: the installer must never be pointed at them.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { MANIFEST_PATH } from "../pack-plan.js";
import { NOTICE_FILENAME } from "../pack-targets.js";

import { makeSandbox, readProjectFile, realPack, removeSandboxes, treeSnapshot, writeProjectFile, type Sandbox } from "./pack-test-helpers.js";

afterEach(removeSandboxes);

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPO_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");
const BIN = path.join(PACKAGE_ROOT, "dist", "cli", "clients-cli.js");
const RULE = "iris-mcp-objectscript-pre-write";
const T = 120_000;

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runBin(sandbox: Sandbox, args: string[], options: { cwd?: string } = {}): RunResult {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: options.cwd ?? sandbox.project,
    env: {
      PATH: process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      windir: process.env.windir ?? "",
      TEMP: process.env.TEMP ?? "",
      TMP: process.env.TMP ?? "",
      TMPDIR: process.env.TMPDIR ?? "",
      HOME: sandbox.home,
      USERPROFILE: sandbox.home,
      APPDATA: path.join(sandbox.home, "AppData", "Roaming"),
    },
    encoding: "utf8",
    input: "",
    timeout: 60_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The real repository root's paths the installer must never touch, as path|size|mtime lines. */
function realRootFingerprint(): string[] {
  const roots = [".claude/rules", ".claude/skills", "CLAUDE.md", "AGENTS.md", "GEMINI.md", ".agents", ".cursor", ".iris-mcp"];
  const lines: string[] = [];
  const walk = (full: string, rel: string): void => {
    if (!existsSync(full)) {
      lines.push(`${rel}|absent`);
      return;
    }
    const stat = statSync(full);
    lines.push(`${rel}|${stat.isDirectory() ? "dir" : stat.size}|${stat.mtimeMs}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(full).sort()) walk(path.join(full, name), `${rel}/${name}`);
    }
  };
  for (const root of roots) walk(path.join(REPO_ROOT, root), root);
  return lines;
}

describe("the built bin: skills install and uninstall", () => {
  it("the bin is built (this suite runs against dist)", () => {
    expect(existsSync(BIN), "run `pnpm --filter @iris-mcp/client-config build` first").toBe(true);
  });

  it(
    "claude-code: dry run, refusal without --yes, install, re-run, uninstall, --json",
    () => {
      const fingerprint = realRootFingerprint();
      const sandbox = makeSandbox();
      writeProjectFile(sandbox.project, "CLAUDE.md", "# claude, my words\r\n");
      writeProjectFile(sandbox.project, "src/app.ts", "export {};\n");
      const original = treeSnapshot(sandbox.project);
      const pack = realPack();

      const dry = runBin(sandbox, ["skills", "install", "--client", "claude-code", "--dry-run"]);
      expect(dry.status).toBe(0);
      expect(dry.stdout).toContain(`Skills pack install for Claude Code in `);
      expect(dry.stdout).toContain(`  create    .claude/rules/${RULE}.md\n`);
      expect(dry.stdout.endsWith("(dry run: nothing was written)\n")).toBe(true);
      expect(treeSnapshot(sandbox.project)).toEqual(original);

      const refused = runBin(sandbox, ["skills", "install", "--client", "claude-code"]);
      expect(refused.status).toBe(2);
      expect(refused.stderr).toContain(
        "skills install needs confirmation before writing and this is not an interactive terminal; re-run with --yes to accept the previewed changes, or --dry-run to preview only",
      );
      expect(treeSnapshot(sandbox.project)).toEqual(original);

      const installed = runBin(sandbox, ["skills", "install", "--client", "claude-code", "--yes"]);
      expect(installed.status).toBe(0);
      expect(installed.stdout).toMatch(/\nDone: \d+ path\(s\) changed for Claude Code\.\n/);
      for (const [rel, bytes] of pack.skills) {
        expect(readProjectFile(sandbox.project, `.claude/skills/${rel}`).equals(bytes), rel).toBe(true);
      }
      expect(readProjectFile(sandbox.project, `.claude/skills/iris-mcp-objectscript-sql/${NOTICE_FILENAME}`).equals(pack.notice)).toBe(true);
      expect(readProjectFile(sandbox.project, `.claude/rules/${RULE}.md`).equals((pack.rules[0] as { claudeCode: Buffer }).claudeCode)).toBe(true);
      expect(existsSync(path.join(sandbox.project, MANIFEST_PATH))).toBe(true);
      expect(readProjectFile(sandbox.project, "CLAUDE.md").toString("utf8")).toBe("# claude, my words\r\n");
      expect(installed.stdout).toContain("This project has a CLAUDE.md, so Claude Code does not read AGENTS.md here.");

      const again = runBin(sandbox, ["skills", "install", "--client", "claude-code"]);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain("Nothing to change for Claude Code: the skills pack is already installed.\n");
      expect(again.stdout).not.toMatch(/^ {2}(create|update|remove) /m);

      const removed = runBin(sandbox, ["skills", "uninstall", "--client", "claude-code", "--yes"]);
      expect(removed.status).toBe(0);
      expect(treeSnapshot(sandbox.project)).toEqual(original);

      const json = runBin(sandbox, ["skills", "install", "--client", "claude-code", "--yes", "--json"]);
      expect(json.status).toBe(0);
      const lines = json.stdout.trim().split("\n");
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0] as string)).toMatchObject({ ok: true, command: "skills", data: { action: "install", client: "claude-code", route: "claude-code", dryRun: false } });
      expect(json.stderr).toContain("Skills pack install for Claude Code in ");

      expect(realRootFingerprint()).toEqual(fingerprint);
    },
    T,
  );

  it(
    "codex: AGENTS.md block with the user's bytes kept, a re-run, and an uninstall that restores them",
    () => {
      const fingerprint = realRootFingerprint();
      const sandbox = makeSandbox();
      const host = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# Mine\r\nlast line without newline"), Buffer.from([0xff, 0x28])]);
      writeFileSync(path.join(sandbox.project, "AGENTS.md"), host);
      const original = treeSnapshot(sandbox.project);
      const pack = realPack();

      const dry = runBin(sandbox, ["skills", "install", "--client", "codex", "--dry-run"]);
      expect(dry.status).toBe(0);
      expect(dry.stdout).toContain(`  update    AGENTS.md (end the last line, then add the ${RULE} block at the end)\n`);
      expect(treeSnapshot(sandbox.project)).toEqual(original);

      expect(runBin(sandbox, ["skills", "install", "--client", "codex"]).status).toBe(2);
      expect(treeSnapshot(sandbox.project)).toEqual(original);

      expect(runBin(sandbox, ["skills", "install", "--client", "codex", "--yes"]).status).toBe(0);
      const installed = readProjectFile(sandbox.project, "AGENTS.md");
      const section = (pack.rules[0] as { agentsMd: Buffer }).agentsMd;
      expect(installed.equals(Buffer.concat([host, Buffer.from("\r\n"), section]))).toBe(true);
      for (const [rel, bytes] of pack.skills) {
        expect(readProjectFile(sandbox.project, `.agents/skills/${rel}`).equals(bytes), rel).toBe(true);
      }

      const again = runBin(sandbox, ["skills", "install", "--client", "codex"]);
      expect(again.status).toBe(0);
      expect(again.stdout).toContain("Nothing to change for Codex CLI: the skills pack is already installed.\n");

      expect(runBin(sandbox, ["skills", "uninstall", "--client", "codex", "--yes"]).status).toBe(0);
      expect(treeSnapshot(sandbox.project)).toEqual(original);
      expect(readProjectFile(sandbox.project, "AGENTS.md").equals(host)).toBe(true);

      const json = runBin(sandbox, ["skills", "uninstall", "--client", "codex", "--json"]);
      expect(json.status).toBe(0);
      expect(JSON.parse(json.stdout.trim())).toMatchObject({ ok: true, command: "skills", data: { action: "uninstall", client: "codex", changed: 0 } });

      expect(realRootFingerprint()).toEqual(fingerprint);
    },
    T,
  );

  it(
    "usage errors exit 2: claude-desktop, user scope, an unknown client, no action",
    () => {
      const sandbox = makeSandbox();
      const original = treeSnapshot(sandbox.root);
      const desktop = runBin(sandbox, ["skills", "install", "--client", "claude-desktop", "--yes"]);
      expect(desktop.status).toBe(2);
      expect(desktop.stderr).toContain("Claude Desktop has no project folder for skills or rules: upload skills as a ZIP under Customize > Skills.");
      expect(runBin(sandbox, ["skills", "install", "--client", "codex", "--scope", "user", "--yes"]).status).toBe(2);
      expect(runBin(sandbox, ["skills", "install", "--client", "emacs", "--yes"]).status).toBe(2);
      expect(runBin(sandbox, ["skills"]).status).toBe(2);
      expect(runBin(sandbox, ["skills", "install", "--client", "codex", "--project", path.join(sandbox.root, "missing"), "--yes"]).status).toBe(2);
      expect(treeSnapshot(sandbox.root)).toEqual(original);
    },
    T,
  );

  it(
    "--project installs into another directory and resolves a relative path against the working directory",
    () => {
      const sandbox = makeSandbox();
      writeProjectFile(sandbox.project, "other/.keep", "");
      const result = runBin(sandbox, ["skills", "install", "--client", "gemini", "--project", "other", "--yes"]);
      expect(result.status).toBe(0);
      expect(existsSync(path.join(sandbox.project, "other", "GEMINI.md"))).toBe(true);
      expect(existsSync(path.join(sandbox.project, "GEMINI.md"))).toBe(false);
      const bytes = readFileSync(path.join(sandbox.project, "other", "GEMINI.md"));
      expect(bytes.equals((realPack().rules[0] as { agentsMd: Buffer }).agentsMd)).toBe(true);
    },
    T,
  );

  it(
    "backups of a modified file land under the temp home, never the real one",
    () => {
      const sandbox = makeSandbox();
      expect(runBin(sandbox, ["skills", "install", "--client", "cursor", "--yes"]).status).toBe(0);
      writeProjectFile(sandbox.project, ".agents/skills/check-system-health/SKILL.md", "edited\n");
      const result = runBin(sandbox, ["skills", "install", "--client", "cursor", "--yes", "--include-modified"]);
      expect(result.status).toBe(0);
      const backups = path.join(sandbox.home, ".iris-mcp", "client-manager", "backups", "skills-pack");
      expect(existsSync(backups)).toBe(true);
    },
    T,
  );
});
