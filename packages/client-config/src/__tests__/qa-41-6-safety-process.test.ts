/**
 * Story 41.6 QA - safety edges of the skills installer, on the BUILT bin with a temp HOME.
 *
 *  1. Links. A symbolic link at or above an owned path, dangling or not, or a hard link at one, refuses the run
 *     with a conflict that names the link: exit 1, and the project and the directory the link points at (inside
 *     the temp root, standing in for a home directory) are byte-identical afterwards, the link still a link to the
 *     same target, and nothing is backed up. The same holds for an uninstall after an installed directory was
 *     replaced by a link.
 *  2. The manifest allow-list on the real CLI path. A manifest that names a path outside the installer's locations
 *     is refused with exit 1 on install, uninstall and dry run, and every victim file survives. The two control
 *     rows prove the harness would delete or edit a victim if the path were allowed.
 *  3. Rollback on a REAL file system failure (read-only directories and files, a file where the backup directory
 *     should be), not the injected throwing fs: the tree is byte-identical afterwards and the exit code is 1.
 */

import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { makeSandbox, removeSandboxes, writeProjectFile, type Sandbox } from "./pack-test-helpers.js";
import {
  assertBinFresh,
  backupsOf,
  filesUnder,
  lstatTree,
  MANIFEST,
  packRuleForms,
  packSkillFiles,
  RULE_STEM,
  runBin,
  sha256,
  SPAWN_TEST_TIMEOUT,
  treeDiff,
} from "./qa-41-6-helpers.js";

beforeAll(assertBinFresh);
afterEach(removeSandboxes);

const POSIX = process.platform !== "win32";
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;
const SECTION = packRuleForms().agentsMd;
const text = (value: string): Buffer => Buffer.from(value, "utf8");

/** A directory that stands in for somewhere else on the machine (a home directory), inside the sandbox root. */
function makeOutside(sandbox: Sandbox): string {
  const outside = path.join(sandbox.root, "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "keep.txt"), "keep\n");
  return outside;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Symlinks
// ---------------------------------------------------------------------------------------------------------------

interface LinkCase {
  name: string;
  client: "claude-code" | "codex" | "gemini" | "cursor";
  /** Create the link(s) in the project. */
  setup: (sandbox: Sandbox, outside: string) => void;
  /** Links that must still be links, to the same target, afterwards. */
  links: string[];
}

const hostBytes = Buffer.concat([text("# outside host\r\n"), text("last line without a newline")]);

const LINK_CASES: LinkCase[] = [
  {
    name: ".claude is a symlink to a directory outside the project",
    client: "claude-code",
    setup: (s, outside) => symlinkSync(outside, path.join(s.project, ".claude"), "dir"),
    links: [".claude"],
  },
  {
    name: ".claude is a relative symlink (../outside)",
    client: "claude-code",
    setup: (s) => symlinkSync(path.join("..", "outside"), path.join(s.project, ".claude"), "dir"),
    links: [".claude"],
  },
  {
    name: ".claude/skills is a symlink to a directory outside the project",
    client: "claude-code",
    setup: (s, outside) => {
      mkdirSync(path.join(s.project, ".claude"));
      symlinkSync(outside, path.join(s.project, ".claude", "skills"), "dir");
    },
    links: [".claude/skills"],
  },
  {
    name: ".agents is a symlink to a directory outside the project",
    client: "codex",
    setup: (s, outside) => symlinkSync(outside, path.join(s.project, ".agents"), "dir"),
    links: [".agents"],
  },
  {
    name: ".iris-mcp is a symlink to a directory outside the project",
    client: "codex",
    setup: (s, outside) => symlinkSync(outside, path.join(s.project, ".iris-mcp"), "dir"),
    links: [".iris-mcp"],
  },
  {
    name: ".cursor/rules is a symlink to a directory outside the project",
    client: "cursor",
    setup: (s, outside) => {
      mkdirSync(path.join(s.project, ".cursor"));
      symlinkSync(outside, path.join(s.project, ".cursor", "rules"), "dir");
    },
    links: [".cursor/rules"],
  },
  {
    name: "AGENTS.md is a symlink to a file outside the project",
    client: "codex",
    setup: (s, outside) => {
      writeFileSync(path.join(outside, "real-agents.md"), hostBytes);
      symlinkSync(path.join(outside, "real-agents.md"), path.join(s.project, "AGENTS.md"), "file");
    },
    links: ["AGENTS.md"],
  },
  {
    name: "AGENTS.md is a symlink to CLAUDE.md inside the project",
    client: "codex",
    setup: (s) => {
      writeFileSync(path.join(s.project, "CLAUDE.md"), hostBytes);
      symlinkSync("CLAUDE.md", path.join(s.project, "AGENTS.md"), "file");
    },
    links: ["AGENTS.md"],
  },
  {
    name: "GEMINI.md is a symlink to a file outside the project",
    client: "gemini",
    setup: (s, outside) => {
      writeFileSync(path.join(outside, "real-gemini.md"), hostBytes);
      symlinkSync(path.join(outside, "real-gemini.md"), path.join(s.project, "GEMINI.md"), "file");
    },
    links: ["GEMINI.md"],
  },
];

function snapshots(sandbox: Sandbox): { project: Map<string, string>; outside: Map<string, string> } {
  return {
    project: lstatTree(sandbox.project, { modes: true }),
    outside: lstatTree(path.join(sandbox.root, "outside"), { modes: true }),
  };
}

const SYMBOLIC_DETAIL =
  "a symbolic link; this installer writes only real files and folders inside the project, so replace the link or install by hand";
const HARD_DETAIL =
  "a hard link that another path shares; this installer never writes a file that another path also names, so replace the link or install by hand";

/** Run `args` and require the refusal: exit 1, the one conflict line naming `link`, and nothing written anywhere. */
function expectLinkRefusal(sandbox: Sandbox, args: string[], link: string, detail = SYMBOLIC_DETAIL): void {
  const before = snapshots(sandbox);
  const run = runBin(sandbox, args);
  expect(run.status, run.stderr).toBe(1);
  expect(run.stdout).toContain(`\n  conflict  ${link} (${detail})\n`);
  expect(run.stderr).toContain("Error: 1 conflict(s); nothing was written.");
  const after = snapshots(sandbox);
  expect(treeDiff(before.project, after.project), "project tree").toEqual([]);
  expect(treeDiff(before.outside, after.outside), "the directory the link points at").toEqual([]);
  expect([...filesUnder(sandbox.home).keys()], "nothing is backed up").toEqual([]);
}

describe.skipIf(!POSIX)("links at or above an owned path, on the built bin", () => {
  it.each(LINK_CASES)(
    "$name: install and its dry run refuse with a conflict naming the link, and nothing changes",
    (linkCase) => {
      const sandbox = makeSandbox();
      const outside = makeOutside(sandbox);
      linkCase.setup(sandbox, outside);
      const targets = linkCase.links.map((rel) => readlinkSync(path.join(sandbox.project, ...rel.split("/"))));
      const link = linkCase.links[0] as string;

      expectLinkRefusal(sandbox, ["skills", "install", "--client", linkCase.client, "--yes"], link);
      expectLinkRefusal(sandbox, ["skills", "install", "--client", linkCase.client, "--dry-run"], link);
      linkCase.links.forEach((rel, index) => {
        const full = path.join(sandbox.project, ...rel.split("/"));
        expect(lstatSync(full).isSymbolicLink(), `${rel} is still a link`).toBe(true);
        expect(readlinkSync(full), `${rel} points where it did`).toBe(targets[index]);
      });
    },
    SPAWN_TEST_TIMEOUT,
  );

  it("a link that points nowhere is refused the same way (.agents -> missing target)", () => {
    const sandbox = makeSandbox();
    const outside = makeOutside(sandbox);
    symlinkSync(path.join(outside, "not-there"), path.join(sandbox.project, ".agents"), "dir");
    expectLinkRefusal(sandbox, ["skills", "install", "--client", "codex", "--yes"], ".agents");
  }, SPAWN_TEST_TIMEOUT);

  it("a dangling symlink at AGENTS.md is refused, so nothing is created where it points", () => {
    const sandbox = makeSandbox();
    const outside = makeOutside(sandbox);
    symlinkSync(path.join(outside, "not-there.md"), path.join(sandbox.project, "AGENTS.md"), "file");
    expectLinkRefusal(sandbox, ["skills", "install", "--client", "codex", "--yes"], "AGENTS.md");
    expect(existsSync(path.join(outside, "not-there.md"))).toBe(false);
  }, SPAWN_TEST_TIMEOUT);

  it("a dangling symlink at the Cursor rule path is refused, so nothing is created where it points", () => {
    const sandbox = makeSandbox();
    const outside = makeOutside(sandbox);
    mkdirSync(path.join(sandbox.project, ".cursor", "rules"), { recursive: true });
    const rule = `.cursor/rules/${RULE_STEM}.mdc`;
    symlinkSync(path.join(outside, "x.mdc"), path.join(sandbox.project, ...rule.split("/")), "file");
    expectLinkRefusal(sandbox, ["skills", "install", "--client", "cursor", "--yes"], rule);
    expect(existsSync(path.join(outside, "x.mdc"))).toBe(false);
  }, SPAWN_TEST_TIMEOUT);

  it("an uninstall refuses when an installed .claude/skills was replaced by a link, and deletes nothing through it", () => {
    const sandbox = makeSandbox();
    const outside = makeOutside(sandbox);
    expect(runBin(sandbox, ["skills", "install", "--client", "claude-code", "--yes"]).status).toBe(0);
    const moved = path.join(outside, "skills");
    renameSync(path.join(sandbox.project, ".claude", "skills"), moved);
    symlinkSync(moved, path.join(sandbox.project, ".claude", "skills"), "dir");
    expectLinkRefusal(sandbox, ["skills", "uninstall", "--client", "claude-code", "--yes"], ".claude/skills");
    expect(readdirSync(moved).length).toBeGreaterThan(10);
  }, SPAWN_TEST_TIMEOUT);

  it("a hard link from AGENTS.md to CLAUDE.md is refused, and CLAUDE.md is never edited", () => {
    const sandbox = makeSandbox();
    makeOutside(sandbox);
    writeFileSync(path.join(sandbox.project, "CLAUDE.md"), hostBytes);
    linkSync(path.join(sandbox.project, "CLAUDE.md"), path.join(sandbox.project, "AGENTS.md"));
    expectLinkRefusal(sandbox, ["skills", "install", "--client", "codex", "--yes"], "AGENTS.md", HARD_DETAIL);
    expect(readFileSync(path.join(sandbox.project, "CLAUDE.md")).equals(hostBytes)).toBe(true);
  }, SPAWN_TEST_TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. The manifest allow-list on the real CLI path
// ---------------------------------------------------------------------------------------------------------------

const VICTIM = Buffer.from("victim\n");
const victimSha = sha256(VICTIM);

interface ManifestRow {
  name: string;
  /** Files to create, relative to the sandbox ROOT (so a row can aim outside the project). */
  victims: Array<[string, Buffer]>;
  /** Empty directories to create, relative to the sandbox root. */
  emptyDirs?: string[];
  /** The manifest, given the sandbox root. */
  manifest: (root: string) => unknown;
  /** The reason the refusal must carry. */
  why: RegExp;
  /** True when the victim only exists as the row means it on a POSIX file system (a backslash is a name character). */
  posixOnly?: boolean;
}

const file = (p: string) => ({ path: p, sha256: victimSha, clients: ["claude-code"] });
const block = (p: string) => ({ path: p, rule: RULE_STEM, created: false, lineEndingAdded: "", clients: ["claude-code"] });
const record = (parts: { files?: unknown[]; blocks?: unknown[]; dirs?: unknown[] }) => ({
  schema: 1,
  note: "x",
  files: parts.files ?? [],
  blocks: parts.blocks ?? [],
  dirs: parts.dirs ?? [],
});
const hostWithBlock = Buffer.concat([text("# mine\n"), SECTION]);
const OUTSIDE_LOCATIONS = /is outside the locations this installer manages/;

const MANIFEST_ROWS: ManifestRow[] = [
  {
    name: "file ../outside/victim.txt",
    victims: [["outside/victim.txt", VICTIM]],
    manifest: () => record({ files: [file("../outside/victim.txt")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file with an absolute path",
    victims: [["outside/victim.txt", VICTIM]],
    manifest: (root) => record({ files: [file(path.join(root, "outside", "victim.txt"))] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file with a backslash path (a file of that literal name exists at the project root)",
    victims: [["proj/.claude\\skills\\evil\\SKILL.md", VICTIM]],
    manifest: () => record({ files: [file(".claude\\skills\\evil\\SKILL.md")] }),
    why: OUTSIDE_LOCATIONS,
    posixOnly: true,
  },
  {
    name: "file src/a.ts",
    victims: [["proj/src/a.ts", VICTIM]],
    manifest: () => record({ files: [file("src/a.ts")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file .claude/skills/../../src/a.ts (an allowed prefix, then ..)",
    victims: [["proj/src/a.ts", VICTIM]],
    manifest: () => record({ files: [file(".claude/skills/../../src/a.ts")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file .claude/skills/./../settings.json (dot segments)",
    victims: [["proj/.claude/settings.json", VICTIM]],
    manifest: () => record({ files: [file(".claude/skills/./../settings.json")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file .claude/settings.json (inside .claude, outside skills and rules)",
    victims: [["proj/.claude/settings.json", VICTIM]],
    manifest: () => record({ files: [file(".claude/settings.json")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file .claude/CLAUDE.md",
    victims: [["proj/.claude/CLAUDE.md", VICTIM]],
    manifest: () => record({ files: [file(".claude/CLAUDE.md")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file CLAUDE.md",
    victims: [["proj/CLAUDE.md", VICTIM]],
    manifest: () => record({ files: [file("CLAUDE.md")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file AGENTS.md (a block host named as a whole file)",
    victims: [["proj/AGENTS.md", hostWithBlock]],
    manifest: () => record({ files: [file("AGENTS.md")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file .github/copilot-instructions.md",
    victims: [["proj/.github/copilot-instructions.md", VICTIM]],
    manifest: () => record({ files: [file(".github/copilot-instructions.md")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file .cursor/rules (the rules directory itself)",
    victims: [["proj/.cursor/rules/keep.mdc", VICTIM]],
    manifest: () => record({ files: [file(".cursor/rules")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file .claude/skills (the skills directory itself)",
    victims: [["proj/.claude/skills/mine/SKILL.md", VICTIM]],
    manifest: () => record({ files: [file(".claude/skills")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file .iris-mcp/skills-pack.json (the record naming itself)",
    victims: [],
    manifest: () => record({ files: [file(".iris-mcp/skills-pack.json")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "file with an empty path",
    victims: [],
    manifest: () => record({ files: [file("")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "block in CLAUDE.md",
    victims: [["proj/CLAUDE.md", hostWithBlock]],
    manifest: () => record({ blocks: [block("CLAUDE.md")] }),
    why: /the block host "CLAUDE.md" is outside the locations this installer manages/,
  },
  {
    name: "block in ../AGENTS.md",
    victims: [["AGENTS.md", hostWithBlock]],
    manifest: () => record({ blocks: [block("../AGENTS.md")] }),
    why: /the block host "\.\.\/AGENTS.md" is outside the locations/,
  },
  {
    name: "block in sub/AGENTS.md",
    victims: [["proj/sub/AGENTS.md", hostWithBlock]],
    manifest: () => record({ blocks: [block("sub/AGENTS.md")] }),
    why: /the block host "sub\/AGENTS.md" is outside the locations/,
  },
  {
    name: "block in agents.md (lower case)",
    victims: [["proj/agents.md", hostWithBlock]],
    manifest: () => record({ blocks: [block("agents.md")] }),
    why: /the block host "agents.md" is outside the locations/,
  },
  {
    name: "block in .github/copilot-instructions.md",
    victims: [["proj/.github/copilot-instructions.md", hostWithBlock]],
    manifest: () => record({ blocks: [block(".github/copilot-instructions.md")] }),
    why: /the block host ".github\/copilot-instructions.md" is outside the locations/,
  },
  {
    name: "block with an absolute path",
    victims: [["outside/AGENTS.md", hostWithBlock]],
    manifest: (root) => record({ blocks: [block(path.join(root, "outside", "AGENTS.md"))] }),
    why: /is outside the locations/,
  },
  {
    name: "dir src",
    victims: [["proj/src/a.ts", VICTIM]],
    emptyDirs: ["proj/emptydir"],
    manifest: () => record({ dirs: ["src", "emptydir"] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "dir . (the project itself)",
    victims: [],
    manifest: () => record({ dirs: ["."] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "dir ../outside/empty",
    victims: [],
    emptyDirs: ["outside/empty"],
    manifest: () => record({ dirs: ["../outside/empty"] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "dir with an absolute path",
    victims: [],
    emptyDirs: ["outside/empty"],
    manifest: (root) => record({ dirs: [path.join(root, "outside", "empty")] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "dir .claude/skills/.. (an allowed prefix, then ..)",
    victims: [],
    emptyDirs: ["proj/.claude"],
    manifest: () => record({ dirs: [".claude/skills/.."] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "dir with an empty path",
    victims: [],
    manifest: () => record({ dirs: [""] }),
    why: OUTSIDE_LOCATIONS,
  },
  {
    name: "a manifest that is not JSON",
    victims: [["proj/src/a.ts", VICTIM]],
    manifest: () => "{ not json",
    why: /it is not JSON/,
  },
  {
    name: "a manifest that is a JSON list",
    victims: [],
    manifest: () => [],
    why: /it is not a JSON object/,
  },
  {
    name: "a manifest with schema 2",
    victims: [],
    manifest: () => ({ ...record({}), schema: 2 }),
    why: /unknown schema 2/,
  },
  {
    name: "a manifest with an unexpected field",
    victims: [],
    manifest: () => ({ ...record({}), extra: true }),
    why: /unexpected field "extra"/,
  },
  {
    name: "a files entry with no clients",
    victims: [["proj/.claude/skills/mine/SKILL.md", VICTIM]],
    manifest: () => record({ files: [{ path: ".claude/skills/mine/SKILL.md", sha256: victimSha, clients: [] }] }),
    why: /needs a non-empty "clients" list/,
  },
  {
    name: "a files entry with a bad sha256",
    victims: [["proj/.claude/skills/mine/SKILL.md", VICTIM]],
    manifest: () => record({ files: [{ path: ".claude/skills/mine/SKILL.md", sha256: "ABC", clients: ["claude-code"] }] }),
    why: /has no valid sha256/,
  },
  {
    name: "a path listed twice",
    victims: [["proj/.claude/skills/mine/SKILL.md", VICTIM]],
    manifest: () => record({ files: [file(".claude/skills/mine/SKILL.md"), file(".claude/skills/mine/SKILL.md")] }),
    why: /is listed twice/,
  },
];

const COMMANDS: string[][] = [
  ["uninstall", "--yes"],
  ["uninstall", "--dry-run"],
  ["install", "--yes"],
  ["install", "--dry-run"],
];

function writeRoot(sandbox: Sandbox, rel: string, bytes: Buffer): void {
  const full = path.join(sandbox.root, ...rel.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, bytes);
}

function writeManifest(sandbox: Sandbox, manifest: unknown): void {
  const bytes = typeof manifest === "string" ? text(manifest) : text(`${JSON.stringify(manifest, null, 2)}\n`);
  writeProjectFile(sandbox.project, MANIFEST, bytes);
}

describe("a manifest naming a path outside the installer's locations, on the built bin", () => {
  it.each(MANIFEST_ROWS.filter((row) => POSIX || row.posixOnly !== true).map((row) => [row.name, row] as const))(
    "%s: every action exits 1 with the reason, and nothing is deleted, written or backed up",
    (_name, row) => {
      const sandbox = makeSandbox();
      for (const [rel, bytes] of row.victims) writeRoot(sandbox, rel, bytes);
      for (const rel of row.emptyDirs ?? []) mkdirSync(path.join(sandbox.root, ...rel.split("/")), { recursive: true });
      writeManifest(sandbox, row.manifest(sandbox.root));
      const before = lstatTree(sandbox.root, { modes: true });
      for (const args of COMMANDS) {
        const run = runBin(sandbox, ["skills", ...args, "--client", "claude-code"]);
        expect(run.status, `${args.join(" ")}: ${run.stderr}`).toBe(1);
        expect(run.stderr, args.join(" ")).toContain("the installer's record .iris-mcp/skills-pack.json is not valid (");
        expect(run.stderr, args.join(" ")).toMatch(row.why);
        expect(treeDiff(before, lstatTree(sandbox.root, { modes: true })), args.join(" ")).toEqual([]);
      }
    },
    SPAWN_TEST_TIMEOUT,
  );

  it("a record that is a directory is refused too, with nothing written", () => {
    const sandbox = makeSandbox();
    mkdirSync(path.join(sandbox.project, ".iris-mcp", "skills-pack.json"), { recursive: true });
    const before = lstatTree(sandbox.root, { modes: true });
    for (const args of COMMANDS) {
      const run = runBin(sandbox, ["skills", ...args, "--client", "claude-code"]);
      expect(run.status, args.join(" ")).toBe(1);
      expect(run.stderr).toContain("(it is a directory)");
      expect(treeDiff(before, lstatTree(sandbox.root, { modes: true })), args.join(" ")).toEqual([]);
    }
  }, SPAWN_TEST_TIMEOUT);

  // Controls (project rule #59): the same harness, with a path that IS allowed, does act on the victim. Without
  // these, every row above could pass because the manifest was never read or the victim could never be touched.
  it("control: an allowed file path with a matching hash is removed by the uninstall, after a backup", () => {
    const sandbox = makeSandbox();
    writeRoot(sandbox, "proj/.claude/skills/mine/SKILL.md", VICTIM);
    writeManifest(sandbox, record({ files: [file(".claude/skills/mine/SKILL.md")] }));
    const run = runBin(sandbox, ["skills", "uninstall", "--client", "claude-code", "--yes"]);
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(path.join(sandbox.project, ".claude", "skills", "mine", "SKILL.md"))).toBe(false);
    const copies = backupsOf(sandbox.home, ".claude/skills/mine/SKILL.md");
    expect(copies.length).toBe(1);
    expect((copies[0] as Buffer).equals(VICTIM)).toBe(true);
  }, SPAWN_TEST_TIMEOUT);

  it("control: an allowed host with a recorded block loses exactly that block on uninstall", () => {
    const sandbox = makeSandbox();
    writeRoot(sandbox, "proj/AGENTS.md", hostWithBlock);
    writeManifest(sandbox, record({ blocks: [block("AGENTS.md")] }));
    const run = runBin(sandbox, ["skills", "uninstall", "--client", "claude-code", "--yes"]);
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(path.join(sandbox.project, "AGENTS.md")).equals(text("# mine\n"))).toBe(true);
  }, SPAWN_TEST_TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Rollback on a real file system failure
// ---------------------------------------------------------------------------------------------------------------

const LAST_SKILL = packSkillFiles()
  .map(([rel]) => rel.split("/")[0] as string)
  .sort()
  .pop() as string;
const canChmod = POSIX && !IS_ROOT;

/** Run `body`, then put the permissions back so the sandbox can be deleted. */
function withModes(restore: Array<[string, number]>, body: () => void): void {
  try {
    body();
  } finally {
    for (const [target, mode] of restore) {
      try {
        chmodSync(target, mode);
      } catch {
        // already gone
      }
    }
  }
}

describe.skipIf(!canChmod)("rollback on a real file system failure, on the built bin", () => {
  const agentsHost = Buffer.concat([text("# agents, mine\r\n"), text("no final newline")]);

  it("install fails midway (a read-only skill directory): exit 1, every change undone, the tree byte-identical", () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "AGENTS.md", agentsHost);
    const readOnly = path.join(sandbox.project, ".agents", "skills", LAST_SKILL);
    mkdirSync(readOnly, { recursive: true });
    chmodSync(readOnly, 0o555);
    withModes([[readOnly, 0o755]], () => {
      const before = lstatTree(sandbox.root, { modes: true });
      const run = runBin(sandbox, ["skills", "install", "--client", "codex", "--yes"]);
      expect(run.status, run.stdout).toBe(1);
      expect(run.stderr).toContain(`could not write .agents/skills/${LAST_SKILL}/`);
      expect(run.stderr).toContain("every change of this run was undone");
      expect(treeDiff(before, lstatTree(sandbox.root, { modes: true }))).toEqual([]);
      expect(readFileSync(path.join(sandbox.project, "AGENTS.md")).equals(agentsHost)).toBe(true);
      expect(existsSync(path.join(sandbox.project, ".iris-mcp"))).toBe(false);
    });
  }, SPAWN_TEST_TIMEOUT);

  it("install fails at the last step (a read-only .iris-mcp): the host and every file written before are put back", () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "AGENTS.md", agentsHost);
    const readOnly = path.join(sandbox.project, ".iris-mcp");
    mkdirSync(readOnly);
    chmodSync(readOnly, 0o555);
    withModes([[readOnly, 0o755]], () => {
      const before = lstatTree(sandbox.project, { modes: true });
      const run = runBin(sandbox, ["skills", "install", "--client", "codex", "--yes"]);
      expect(run.status, run.stdout).toBe(1);
      expect(run.stderr).toContain("could not write .iris-mcp/skills-pack.json");
      expect(run.stderr).toContain("every change of this run was undone");
      expect(treeDiff(before, lstatTree(sandbox.project, { modes: true }))).toEqual([]);
      expect(readFileSync(path.join(sandbox.project, "AGENTS.md")).equals(agentsHost)).toBe(true);
    });
  }, SPAWN_TEST_TIMEOUT);

  it("install fails on a read-only AGENTS.md: exit 1, the files written before it are removed, the host keeps its bytes and its mode", () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "AGENTS.md", agentsHost);
    const host = path.join(sandbox.project, "AGENTS.md");
    chmodSync(host, 0o444);
    withModes([[host, 0o644]], () => {
      const before = lstatTree(sandbox.project, { modes: true });
      const run = runBin(sandbox, ["skills", "install", "--client", "codex", "--yes"]);
      expect(run.status, run.stdout).toBe(1);
      expect(run.stderr).toContain("could not write AGENTS.md");
      expect(treeDiff(before, lstatTree(sandbox.project, { modes: true }))).toEqual([]);
      expect(readFileSync(host).equals(agentsHost)).toBe(true);
      expect(statSync(host).mode & 0o777).toBe(0o444);
    });
  }, SPAWN_TEST_TIMEOUT);

  it("install into a project directory that cannot be written: exit 1 and nothing is created", () => {
    const sandbox = makeSandbox();
    chmodSync(sandbox.project, 0o555);
    withModes([[sandbox.project, 0o755]], () => {
      const run = runBin(sandbox, ["skills", "install", "--client", "gemini", "--yes"]);
      expect(run.status, run.stdout).toBe(1);
      expect(run.stderr).toContain("could not write");
      expect(readdirSync(sandbox.project)).toEqual([]);
    });
  }, SPAWN_TEST_TIMEOUT);

  it("uninstall fails midway (a read-only installed skill directory): exit 1, the removed files and the host block are put back", () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "AGENTS.md", agentsHost);
    expect(runBin(sandbox, ["skills", "install", "--client", "codex", "--yes"]).status).toBe(0);
    const installedHost = readFileSync(path.join(sandbox.project, "AGENTS.md"));
    const readOnly = path.join(sandbox.project, ".agents", "skills", LAST_SKILL);
    chmodSync(readOnly, 0o555);
    withModes([[readOnly, 0o755]], () => {
      const before = lstatTree(sandbox.project, { modes: true });
      const run = runBin(sandbox, ["skills", "uninstall", "--client", "codex", "--yes"]);
      expect(run.status, run.stdout).toBe(1);
      expect(run.stderr).toContain(`could not write .agents/skills/${LAST_SKILL}/`);
      expect(run.stderr).toContain("every change of this run was undone");
      expect(treeDiff(before, lstatTree(sandbox.project, { modes: true }))).toEqual([]);
      expect(readFileSync(path.join(sandbox.project, "AGENTS.md")).equals(installedHost)).toBe(true);
    });
    // With the directory writable again the same uninstall succeeds and restores the original bytes.
    const again = runBin(sandbox, ["skills", "uninstall", "--client", "codex", "--yes"]);
    expect(again.status, again.stderr).toBe(0);
    expect(readFileSync(path.join(sandbox.project, "AGENTS.md")).equals(agentsHost)).toBe(true);
    expect(existsSync(path.join(sandbox.project, ".agents"))).toBe(false);
  }, SPAWN_TEST_TIMEOUT);
});

describe.skipIf(!POSIX)("a backup that cannot be taken stops the overwrite, on the built bin", () => {
  it("--include-modified with a file where the backup directory should be: exit 1, the user's edit is untouched", () => {
    const sandbox = makeSandbox();
    expect(runBin(sandbox, ["skills", "install", "--client", "claude-code", "--yes"]).status).toBe(0);
    const skill = path.join(sandbox.project, ".claude", "skills", "check-system-health", "SKILL.md");
    const edited = text("my edit\n");
    writeFileSync(skill, edited);
    // The state directory's parent is a regular file, so no backup can be created.
    writeFileSync(path.join(sandbox.home, ".iris-mcp"), "not a directory\n");
    const before = lstatTree(sandbox.root, { modes: true });
    const run = runBin(sandbox, ["skills", "install", "--client", "claude-code", "--yes", "--include-modified"]);
    expect(run.status, run.stdout).toBe(1);
    expect(run.stderr).toContain("could not write .claude/skills/check-system-health/SKILL.md");
    expect(run.stderr).toContain("every change of this run was undone");
    expect(treeDiff(before, lstatTree(sandbox.root, { modes: true }))).toEqual([]);
    expect(readFileSync(skill).equals(edited)).toBe(true);
    expect(readFileSync(path.join(sandbox.home, ".iris-mcp"), "utf8")).toBe("not a directory\n");
  }, SPAWN_TEST_TIMEOUT);
});
