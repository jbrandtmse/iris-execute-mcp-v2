/**
 * Story 41.6 - AC 41.6.4: `iris-mcp-clients skills install|uninstall`, in process through `runCli` with a
 * jailed byte file system over a temp project and a temp home. The built-bin process suite is
 * `skills-cli-process.test.ts`.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { runCli, type CliDeps } from "../cli/clients.js";
import { CLAUDE_DESKTOP_REFUSAL, NOTE_CLAUDE_MD, NOTICE_FILENAME, firstMatchNote } from "../pack-targets.js";
import { MANIFEST_PATH } from "../pack-plan.js";

import { MemFs, fixedNow } from "./helpers.js";
import {
  contextFor,
  failingOnWrite,
  hostPlatform,
  jailedBytesFs,
  makeSandbox,
  readProjectFile,
  removeSandboxes,
  treeSnapshot,
  writeProjectFile,
  type Sandbox,
} from "./pack-test-helpers.js";

afterEach(removeSandboxes);

const RULE = "iris-mcp-objectscript-pre-write";
const SKILLS_USAGE =
  "iris-mcp-clients skills install|uninstall --client <id> [--project <dir>] [--scope project] [--dry-run] [--yes] [--include-modified] [--json]";
const NON_TTY_REFUSAL = (action: string): string =>
  `skills ${action} needs confirmation before writing and this is not an interactive terminal; re-run with --yes to accept the previewed changes, or --dry-run to preview only`;

interface Out {
  text: string;
}

interface Harness {
  sandbox: Sandbox;
  stdout: Out;
  stderr: Out;
  deps: CliDeps;
  run: (argv: string[]) => Promise<number>;
}

function stdinFrom(isTTY: boolean): Readable & { isTTY?: boolean } {
  const stream = Readable.from([""]);
  (stream as { isTTY?: boolean }).isTTY = isTTY;
  return stream as Readable & { isTTY?: boolean };
}

function harness(overrides: CliDeps = {}, sandbox: Sandbox = makeSandbox()): Harness {
  const stdout: Out = { text: "" };
  const stderr: Out = { text: "" };
  const deps: CliDeps = {
    env: {},
    platform: hostPlatform(),
    homeDir: sandbox.home,
    projectDir: sandbox.project,
    stateDir: sandbox.state,
    bytesFs: jailedBytesFs(sandbox.root),
    stdout: { write: (chunk: string) => void (stdout.text += chunk) },
    stderr: { write: (chunk: string) => void (stderr.text += chunk) },
    stdin: stdinFrom(false),
    now: fixedNow(1, 2, 3, 4, 5, 6, 7, 8),
    ...overrides,
  };
  return { sandbox, stdout, stderr, deps, run: (argv) => runCli(argv, deps) };
}

function expectUsage(h: Harness, message: string): void {
  expect(h.stderr.text.startsWith(`Error: ${message}`), h.stderr.text).toBe(true);
  expect(h.stderr.text).toContain(`\n\nUsage: ${SKILLS_USAGE}\n`);
  expect(h.stdout.text).toBe("");
}

describe("usage errors exit 2 and write nothing (I/O matrix)", () => {
  const cases: Array<[string, string[], string | RegExp]> = [
    ["no action", ["skills"], "skills needs an action: install or uninstall"],
    ["an unknown action", ["skills", "frobnicate", "--client", "codex"], 'unknown skills action "frobnicate" (expected: install, uninstall)'],
    ["a missing --client", ["skills", "install"], /^a --client <id> is required \(known clients: claude-code, claude-desktop, cursor,/],
    ["an unknown client", ["skills", "install", "--client", "emacs"], /^unknown client "emacs" \(known clients: claude-code,/],
    ["claude-desktop", ["skills", "install", "--client", "claude-desktop"], CLAUDE_DESKTOP_REFUSAL],
    [
      "--scope user",
      ["skills", "install", "--client", "codex", "--scope", "user"],
      "skills supports only --scope project: at user scope the always-on rule would load in every session of every project, and a personal skill shadows a project skill of the same name in Claude Code",
    ],
    ["an invalid --scope", ["skills", "install", "--client", "codex", "--scope", "galaxy"], 'invalid --scope "galaxy" (expected: user, project)'],
    ["an extra positional", ["skills", "install", "extra", "--client", "codex"], '"skills install" takes no further arguments (got "extra").'],
    ["an unknown option", ["skills", "install", "--client", "codex", "--frobnicate"], 'Unknown option "--frobnicate".'],
    ["a valued option missing its value", ["skills", "install", "--client"], 'Option "--client" requires a value.'],
  ];
  for (const [name, argv, expected] of cases) {
    it(name, async () => {
      const h = harness();
      const before = treeSnapshot(h.sandbox.root);
      expect(await h.run(argv)).toBe(2);
      if (typeof expected === "string") expectUsage(h, expected);
      else {
        expect(h.stderr.text.slice("Error: ".length)).toMatch(expected);
        expect(h.stderr.text).toContain(`Usage: ${SKILLS_USAGE}`);
      }
      expect(treeSnapshot(h.sandbox.root)).toEqual(before);
    });
  }

  it("--project that is not a directory", async () => {
    const h = harness();
    const missing = path.join(h.sandbox.root, "nope");
    expect(await h.run(["skills", "install", "--client", "codex", "--project", missing, "--yes"])).toBe(2);
    expect(h.stderr.text.startsWith(`Error: the project ${missing} is not a directory`)).toBe(true);
    writeFileSync(path.join(h.sandbox.root, "afile"), "x");
    const h2 = harness({}, h.sandbox);
    expect(await h2.run(["skills", "install", "--client", "codex", "--project", path.join(h.sandbox.root, "afile"), "--yes"])).toBe(2);
  });

  it("a non-TTY run without --yes or --dry-run shows the preview, then exits 2 and writes nothing", async () => {
    const h = harness();
    const before = treeSnapshot(h.sandbox.root);
    expect(await h.run(["skills", "install", "--client", "claude-code"])).toBe(2);
    expect(h.stdout.text).toContain("Skills pack install for Claude Code in ");
    expect(h.stderr.text.startsWith(`Error: ${NON_TTY_REFUSAL("install")}`)).toBe(true);
    expect(treeSnapshot(h.sandbox.root)).toEqual(before);
    expect(existsSync(h.sandbox.state)).toBe(false);
  });

  it("an uninstall without --yes on a non-TTY exits 2 the same way, and nothing is written", async () => {
    const h = harness();
    expect(await h.run(["skills", "install", "--client", "codex", "--yes"])).toBe(0);
    const before = treeSnapshot(h.sandbox.root);
    const h2 = harness({}, h.sandbox);
    expect(await h2.run(["skills", "uninstall", "--client", "codex"])).toBe(2);
    expect(h2.stderr.text.startsWith(`Error: ${NON_TTY_REFUSAL("uninstall")}`)).toBe(true);
    expect(treeSnapshot(h.sandbox.root)).toEqual(before);
  });
});

describe("install", () => {
  it("writes the claude-code tree with --yes and says what it did", async () => {
    const h = harness();
    expect(await h.run(["skills", "install", "--client", "claude-code", "--yes"])).toBe(0);
    expect(h.stdout.text).toContain(`Skills pack install for Claude Code in ${h.sandbox.project}:`);
    expect(h.stdout.text).toMatch(/^ {2}create {4}\.claude\/rules\/iris-mcp-objectscript-pre-write\.md$/m);
    expect(h.stdout.text).toMatch(/\nDone: \d+ path\(s\) changed for Claude Code\.\n$/);
    expect(existsSync(path.join(h.sandbox.project, ".claude/skills/iris-mcp-objectscript-sql", NOTICE_FILENAME))).toBe(true);
    expect(existsSync(path.join(h.sandbox.project, MANIFEST_PATH))).toBe(true);
    expect(h.stderr.text).toBe("");
  });

  it("prints the counts line from the plan, derived rather than hand-authored", async () => {
    const h = harness();
    expect(await h.run(["skills", "install", "--client", "cursor", "--dry-run"])).toBe(0);
    const items = h.stdout.text.split("\n").filter((line) => /^ {2}(create|update|remove|adopt|unchanged|keep|conflict) /.test(line));
    expect(h.stdout.text).toContain(`${items.length} to create, 0 to update, 0 to remove, 0 to adopt, 0 unchanged, 0 kept, 0 conflict(s).`);
  });

  it("a second identical run changes nothing, says so and exits 0 even on a non-TTY without --yes", async () => {
    const h = harness();
    expect(await h.run(["skills", "install", "--client", "codex", "--yes"])).toBe(0);
    const before = treeSnapshot(h.sandbox.root);
    const h2 = harness({}, h.sandbox);
    expect(await h2.run(["skills", "install", "--client", "codex"])).toBe(0);
    expect(h2.stdout.text).toContain("Nothing to change for Codex CLI: the skills pack is already installed.\n");
    expect(h2.stdout.text).not.toMatch(/^ {2}(create|update|remove) /m);
    expect(treeSnapshot(h.sandbox.root)).toEqual(before);
  });

  it("--dry-run prints the plan and the dry-run line, writes nothing, and wins over --yes", async () => {
    const h = harness();
    const before = treeSnapshot(h.sandbox.root);
    expect(await h.run(["skills", "install", "--client", "gemini", "--dry-run", "--yes"])).toBe(0);
    expect(h.stdout.text).toContain("  create    GEMINI.md (a new file holding the iris-mcp-objectscript-pre-write block)\n");
    expect(h.stdout.text.endsWith("(dry run: nothing was written)\n")).toBe(true);
    expect(treeSnapshot(h.sandbox.root)).toEqual(before);
  });

  it("a dry run exits 1 when the plan has a conflict, naming it", async () => {
    const h = harness();
    writeProjectFile(h.sandbox.project, ".agents/skills/deploy-and-test-class/SKILL.md", "mine\n");
    const before = treeSnapshot(h.sandbox.root);
    expect(await h.run(["skills", "install", "--client", "codex", "--dry-run"])).toBe(1);
    expect(h.stdout.text).toContain(
      "  conflict  .agents/skills/deploy-and-test-class/SKILL.md (exists, and this installer did not install it; move or delete it, then re-run)\n",
    );
    expect(h.stderr.text).toBe("Error: 1 conflict(s); nothing was written. Resolve them as listed above, then re-run.\n");
    expect(treeSnapshot(h.sandbox.root)).toEqual(before);
  });

  it("a conflict refuses the whole run even with --yes", async () => {
    const h = harness();
    writeProjectFile(h.sandbox.project, "AGENTS.md", `<!-- IRIS-MCP-RULE:${RULE}:END -->\n`);
    const before = treeSnapshot(h.sandbox.root);
    expect(await h.run(["skills", "install", "--client", "codex", "--yes"])).toBe(1);
    expect(h.stdout.text).toContain(
      `conflict  AGENTS.md (the ${RULE} markers are not one BEGIN line followed by one END line: BEGIN at line(s) none, END at line(s) 1; fix them by hand, then re-run)`,
    );
    expect(treeSnapshot(h.sandbox.root)).toEqual(before);
  });

  it("resolves --project against the current directory", async () => {
    const h = harness();
    mkdirSync(path.join(h.sandbox.project, "sub"));
    expect(await h.run(["skills", "install", "--client", "gemini", "--project", "sub", "--yes"])).toBe(0);
    expect(existsSync(path.join(h.sandbox.project, "sub", "GEMINI.md"))).toBe(true);
    expect(existsSync(path.join(h.sandbox.project, "GEMINI.md"))).toBe(false);
  });

  it("accepts --scope project", async () => {
    const h = harness();
    expect(await h.run(["skills", "install", "--client", "codex", "--scope", "project", "--dry-run"])).toBe(0);
  });
});

describe("the confirmation gate", () => {
  it("a TTY decline exits 1, says so and writes nothing", async () => {
    const asked: string[] = [];
    const h = harness({
      stdin: stdinFrom(true),
      promptConfirm: async (question) => {
        asked.push(question);
        return false;
      },
    });
    const before = treeSnapshot(h.sandbox.root);
    expect(await h.run(["skills", "install", "--client", "claude-code"])).toBe(1);
    expect(asked).toEqual(["Apply these changes to Claude Code?"]);
    expect(h.stderr.text).toBe("Aborted; no changes were written.\n");
    expect(treeSnapshot(h.sandbox.root)).toEqual(before);
  });

  it("a TTY accept writes", async () => {
    const h = harness({ stdin: stdinFrom(true), promptConfirm: async () => true });
    expect(await h.run(["skills", "install", "--client", "claude-code"])).toBe(0);
    expect(existsSync(path.join(h.sandbox.project, MANIFEST_PATH))).toBe(true);
  });

  it("is not asked when nothing would change or on a dry run", async () => {
    let asks = 0;
    const h = harness({ stdin: stdinFrom(true), promptConfirm: async () => (asks++, true) });
    expect(await h.run(["skills", "install", "--client", "claude-code", "--dry-run"])).toBe(0);
    expect(asks).toBe(0);
  });

  it("apply keeps its three gate messages byte for byte", async () => {
    const memory = new MemFs();
    memory.seed("/home/u/.claude.json", '{\n  "mcpServers": {}\n}\n');
    const base: CliDeps = { env: {}, platform: "linux", homeDir: "/home/u", projectDir: "/proj", fs: memory, now: fixedNow(1, 2, 3, 4, 5, 6, 7, 8) };
    const apply = ["apply", "--client", "claude-code", "--servers", "iris-dev-mcp"];

    const nonTty = { out: "", err: "" };
    const code = await runCli(apply, {
      ...base,
      stdin: stdinFrom(false),
      stdout: { write: (c: string) => void (nonTty.out += c) },
      stderr: { write: (c: string) => void (nonTty.err += c) },
    });
    expect(code).toBe(2);
    expect(nonTty.err).toContain(
      "Error: apply needs confirmation before writing and this is not an interactive terminal; re-run with --yes to accept the previewed changes\n\nUsage: iris-mcp-clients apply --client <id> --servers <list> [--scope user|project] [--mode <mode>] [--yes] [--json]\n",
    );

    const declined = { out: "", err: "" };
    const code2 = await runCli([...apply, "--json"], {
      ...base,
      stdin: stdinFrom(true),
      promptConfirm: async () => false,
      stdout: { write: (c: string) => void (declined.out += c) },
      stderr: { write: (c: string) => void (declined.err += c) },
    });
    expect(code2).toBe(1);
    expect(declined.err).toContain("Aborted; no changes were written.\n");
    expect(JSON.parse(declined.out.trim())).toEqual({ ok: false, command: "apply", data: null, error: "confirmation declined" });
  });
});

describe("--json", () => {
  it("prints one envelope on stdout and the preview on stderr", async () => {
    const h = harness();
    expect(await h.run(["skills", "install", "--client", "cursor", "--yes", "--json"])).toBe(0);
    const lines = h.stdout.text.trim().split("\n");
    expect(lines.length).toBe(1);
    const envelope = JSON.parse(lines[0] as string) as {
      ok: boolean;
      command: string;
      data: { action: string; client: string; route: string; project: string; dryRun: boolean; changed: number; items: Array<{ path: string; change: string }>; notes: string[] };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("skills");
    expect(envelope.data).toMatchObject({ action: "install", client: "cursor", route: "cursor", project: h.sandbox.project, dryRun: false });
    expect(envelope.data.changed).toBe(envelope.data.items.filter((item) => item.change === "create" || item.change === "update").length);
    expect(envelope.data.items.some((item) => item.path === ".cursor/rules/iris-mcp-objectscript-pre-write.mdc")).toBe(true);
    expect(envelope.data.notes.length).toBe(1);
    expect(h.stderr.text).toContain("Skills pack install for Cursor in ");
    expect(h.stderr.text).toContain("Done: ");
  });

  it("reports a dry run with changed 0", async () => {
    const h = harness();
    expect(await h.run(["skills", "install", "--client", "gemini", "--dry-run", "--json"])).toBe(0);
    const envelope = JSON.parse(h.stdout.text.trim()) as { ok: boolean; data: { dryRun: boolean; changed: number } };
    expect(envelope).toMatchObject({ ok: true, data: { dryRun: true, changed: 0 } });
  });

  it("reports a conflict, a decline and a failure as ok:false envelopes", async () => {
    const h = harness();
    writeProjectFile(h.sandbox.project, ".agents/skills/deploy-and-test-class/SKILL.md", "mine\n");
    expect(await h.run(["skills", "install", "--client", "codex", "--yes", "--json"])).toBe(1);
    expect(JSON.parse(h.stdout.text.trim())).toMatchObject({ ok: false, command: "skills", error: expect.stringContaining("1 conflict(s)") });

    const declined = harness({ stdin: stdinFrom(true), promptConfirm: async () => false });
    expect(await declined.run(["skills", "install", "--client", "codex", "--json"])).toBe(1);
    expect(JSON.parse(declined.stdout.text.trim())).toEqual({ ok: false, command: "skills", data: null, error: "confirmation declined" });
  });

  it("keeps usage errors as plain text on stderr", async () => {
    const h = harness();
    expect(await h.run(["skills", "install", "--json"])).toBe(2);
    expect(h.stdout.text).toBe("");
  });
});

describe("uninstall", () => {
  it("says there is nothing to remove for a client that is not installed", async () => {
    const h = harness();
    expect(await h.run(["skills", "uninstall", "--client", "codex"])).toBe(0);
    expect(h.stdout.text).toContain("Nothing to remove for Codex CLI: the skills pack is not installed.\n");
  });

  it("removes what an install wrote and leaves the project as it was", async () => {
    const h = harness();
    writeProjectFile(h.sandbox.project, "AGENTS.md", "# mine\nlast");
    const before = treeSnapshot(h.sandbox.project);
    expect(await h.run(["skills", "install", "--client", "codex", "--yes"])).toBe(0);
    const h2 = harness({}, h.sandbox);
    expect(await h2.run(["skills", "uninstall", "--client", "codex", "--yes"])).toBe(0);
    expect(h2.stdout.text).toMatch(new RegExp(`remove +AGENTS\\.md \\(remove the ${RULE} block, lines \\d+-\\d+\\)`));
    expect(treeSnapshot(h.sandbox.project)).toEqual(before);
    expect(readProjectFile(h.sandbox.project, "AGENTS.md").toString("utf8")).toBe("# mine\nlast");
  });

  it("keeps a file the user edited, and removes it with --include-modified", async () => {
    const h = harness();
    expect(await h.run(["skills", "install", "--client", "claude-code", "--yes"])).toBe(0);
    const target = ".claude/skills/check-system-health/SKILL.md";
    writeProjectFile(h.sandbox.project, target, "mine\n");
    const h2 = harness({}, h.sandbox);
    expect(await h2.run(["skills", "uninstall", "--client", "claude-code", "--yes"])).toBe(0);
    expect(h2.stdout.text).toContain(`  keep      ${target} (changed since it was installed; --include-modified removes it)\n`);
    expect(readProjectFile(h.sandbox.project, target).toString("utf8")).toBe("mine\n");
    const h3 = harness({}, h.sandbox);
    expect(await h3.run(["skills", "uninstall", "--client", "claude-code", "--yes", "--include-modified"])).toBe(0);
    expect(existsSync(path.join(h.sandbox.project, target))).toBe(false);
    expect(treeSnapshot(h.sandbox.project).size).toBe(0);
    expect(existsSync(h.sandbox.state)).toBe(true);
  });

  it("tells a second plain uninstall that only files the user changed remain, and writes nothing", async () => {
    const h = harness();
    expect(await h.run(["skills", "install", "--client", "claude-code", "--yes"])).toBe(0);
    const target = ".claude/skills/check-system-health/SKILL.md";
    writeProjectFile(h.sandbox.project, target, "mine\n");
    expect(await harness({}, h.sandbox).run(["skills", "uninstall", "--client", "claude-code", "--yes"])).toBe(0);
    const before = treeSnapshot(h.sandbox.project);
    const again = harness({}, h.sandbox);
    expect(await again.run(["skills", "uninstall", "--client", "claude-code"])).toBe(0);
    expect(again.stdout.text).toContain(
      "Nothing to remove for Claude Code: every installed file you changed was kept; re-run with --include-modified to remove them.\n",
    );
    expect(again.stdout.text).not.toContain("is not installed");
    expect(treeSnapshot(h.sandbox.project)).toEqual(before);
  });
});

describe("an install that keeps every changed file", () => {
  it("does not call the pack already installed, and writes nothing", async () => {
    const h = harness();
    expect(await h.run(["skills", "install", "--client", "claude-code", "--yes"])).toBe(0);
    const target = ".claude/skills/check-system-health/SKILL.md";
    writeProjectFile(h.sandbox.project, target, "mine\n");
    const before = treeSnapshot(h.sandbox.project);
    const again = harness({}, h.sandbox);
    expect(await again.run(["skills", "install", "--client", "claude-code"])).toBe(0);
    expect(again.stdout.text).toContain(
      "Nothing to change for Claude Code: 1 installed file(s) you changed were kept; re-run with --include-modified to replace them.\n",
    );
    expect(again.stdout.text).not.toContain("already installed");
    expect(treeSnapshot(h.sandbox.project)).toEqual(before);
  });
});

describe("notes (AC 41.6.3)", () => {
  it("installs the rule into .claude/rules next to a CLAUDE.md, leaves CLAUDE.md alone and prints the note in the preview and the result", async () => {
    for (const present of ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"]) {
      const h = harness();
      writeProjectFile(h.sandbox.project, present, "# claude, my words\r\n");
      expect(await h.run(["skills", "install", "--client", "claude-code", "--yes"])).toBe(0);
      expect(existsSync(path.join(h.sandbox.project, ".claude/rules", `${RULE}.md`))).toBe(true);
      expect(readProjectFile(h.sandbox.project, present).toString("utf8")).toBe("# claude, my words\r\n");
      const occurrences = h.stdout.text.split(NOTE_CLAUDE_MD).length - 1;
      expect(occurrences, present).toBe(2);
      expect(h.stdout.text.indexOf(NOTE_CLAUDE_MD)).toBeLessThan(h.stdout.text.indexOf("Done: "));
    }
  });

  it("prints the AGENTS.md-shadows-CLAUDE.md note before the confirmation", async () => {
    const h = harness();
    writeProjectFile(h.sandbox.project, "CLAUDE.md", "# claude\n");
    expect(await h.run(["skills", "install", "--client", "codex"])).toBe(2);
    expect(h.stdout.text).toContain(firstMatchNote());
    expect(existsSync(path.join(h.sandbox.project, "AGENTS.md"))).toBe(false);
  });

  it("prints a client's static note", async () => {
    const h = harness();
    expect(await h.run(["skills", "install", "--client", "gemini", "--dry-run"])).toBe(0);
    expect(h.stdout.text).toContain("Notes:\n  - For unpaid-tier and Google One users, Gemini CLI was replaced by Antigravity CLI on 2026-06-18.\n");
  });
});

describe("failures", () => {
  it("rolls back on a write failure, exits 1 and names the path and the cause", async () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "AGENTS.md", "mine");
    const before = treeSnapshot(sandbox.project);
    const h = harness({ bytesFs: failingOnWrite(jailedBytesFs(sandbox.root), 4) }, sandbox);
    expect(await h.run(["skills", "install", "--client", "codex", "--yes"])).toBe(1);
    expect(h.stderr.text).toMatch(/^Error: could not write \S+: injected write failure #4; every change of this run was undone\n$/);
    expect(treeSnapshot(sandbox.project)).toEqual(before);
  });

  it("refuses an invalid manifest with exit 1 and writes nothing", async () => {
    const h = harness();
    writeProjectFile(h.sandbox.project, MANIFEST_PATH, "{ broken");
    const before = treeSnapshot(h.sandbox.root);
    expect(await h.run(["skills", "install", "--client", "codex", "--yes"])).toBe(1);
    expect(h.stderr.text).toBe(
      `Error: the installer's record ${MANIFEST_PATH} is not valid (it is not JSON); fix or delete it, then re-run\n`,
    );
    expect(treeSnapshot(h.sandbox.root)).toEqual(before);
    const j = harness({}, h.sandbox);
    expect(await j.run(["skills", "uninstall", "--client", "codex", "--yes", "--json"])).toBe(1);
    expect(JSON.parse(j.stdout.text.trim())).toMatchObject({ ok: false, command: "skills" });
  });

  it("reports a file that changed between the preview and the write", async () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "AGENTS.md", "before\n");
    // The host changes while the human is reading the preview.
    const h = harness(
      {
        stdin: stdinFrom(true),
        promptConfirm: async () => {
          writeFileSync(path.join(sandbox.project, "AGENTS.md"), "after\n");
          return true;
        },
      },
      sandbox,
    );
    expect(await h.run(["skills", "install", "--client", "codex"])).toBe(1);
    expect(h.stderr.text).toBe("Error: AGENTS.md changed after the preview; nothing was written; re-run the command\n");
    expect(existsSync(path.join(sandbox.project, MANIFEST_PATH))).toBe(false);
    expect(readProjectFile(sandbox.project, "AGENTS.md").toString("utf8")).toBe("after\n");
    expect([...treeSnapshot(sandbox.project).keys()]).toEqual(["AGENTS.md"]);
  });
});

describe("help and dispatch", () => {
  it("lists the skills command, its options and the footer in --help", async () => {
    const h = harness();
    expect(await h.run(["--help"])).toBe(0);
    for (const line of [
      "  skills install|uninstall --client <id> [--project <dir>] [--dry-run] [--yes] [--include-modified] [--json]",
      "      Install, update or remove the IRIS MCP skills pack and its always-on",
      "      rule in a project, in the client's native locations (--client agents",
      "      for any agent that reads .agents/skills/ and AGENTS.md). Previews the",
      "      changes first and needs the same confirmation as apply; only files and",
      "      marked blocks it installed are changed.",
      "  --yes                 apply, skills: skip the interactive confirmation.",
      "  --project <dir>       skills: the project to install into (default: the",
      "                        current directory). Only project scope is supported.",
      "  --dry-run             skills: preview the changes and write nothing.",
      "  --include-modified    skills: also replace or remove installed files you",
      "                        changed since (each is backed up first).",
      "  --repair              doctor: re-record orphaned manager-created entries.",
      "  --yes-i-mean-it       doctor --repair: the typed confirmation (required).",
      "Skills-pack backups live under ~/.iris-mcp/client-manager/backups/skills-pack/.",
    ]) {
      expect(h.stdout.text, line).toContain(`${line}\n`);
    }
  });

  it("names skills in the valid-commands string", async () => {
    const h = harness();
    expect(await h.run(["frobnicate"])).toBe(2);
    expect(h.stderr.text).toBe(
      'Error: unknown command "frobnicate". Valid commands: detect, status, diff, apply, enable, disable, remove, restore, doctor, skills.\n',
    );
  });

  it("honors --help after skills, and consumes the value of --project", async () => {
    const h = harness();
    expect(await h.run(["skills", "--help"])).toBe(0);
    expect(h.stdout.text).toContain("Usage: iris-mcp-clients <command> [options]");
    const h2 = harness();
    expect(await h2.run(["skills", "install", "--client", "codex", "--project", "--help", "--yes"])).toBe(2);
    expect(h2.stdout.text).not.toContain("Usage: iris-mcp-clients <command>");
  });
});

describe("the default context stays inside the injected roots", () => {
  it("never defaults the state directory to the real home", async () => {
    const sandbox = makeSandbox();
    const h = harness({ stateDir: undefined as unknown as string }, sandbox);
    delete (h.deps as { stateDir?: string }).stateDir;
    writeProjectFile(sandbox.project, "AGENTS.md", "mine");
    expect(await h.run(["skills", "install", "--client", "codex", "--yes"])).toBe(0);
    expect(await h.run(["skills", "uninstall", "--client", "codex", "--yes"])).toBe(0);
    expect(existsSync(path.join(sandbox.home, ".iris-mcp", "client-manager", "backups", "skills-pack"))).toBe(true);
    expect(contextFor(sandbox).stateDir).toBeUndefined();
  });
});
