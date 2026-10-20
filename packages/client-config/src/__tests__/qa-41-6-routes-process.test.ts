/**
 * Story 41.6 QA (Rule 3) - the `cursor` and `gemini` routes on the BUILT bin, in a fresh child process per command
 * with HOME set to a temp home.
 *
 * The implement stage drove the bin for `claude-code` and `codex`; this file closes the other two routes:
 * dry run, install, re-install, and uninstall, with every installed file compared byte for byte with the pack read
 * straight from disk. The every-client capstone over all 17 ids is Story 41.7 (AC 41.7.2) and is not built here.
 *
 * Oracles are independent of the installer: the pack is walked with plain `fs`, and every route path is a literal.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { makeSandbox, removeSandboxes, writeProjectFile, type Sandbox } from "./pack-test-helpers.js";
import {
  ageAllFiles,
  ancestors,
  assertBinFresh,
  BACKUP_ROOT,
  backupsOf,
  binIsBuilt,
  expectedSkillFiles,
  filesUnder,
  lstatTree,
  MANIFEST,
  mtimes,
  packRuleForms,
  RULE_STEM,
  runBin as spawnBin,
  sha256,
  SPAWN_TEST_TIMEOUT,
  treeDiff,
  type RunResult,
} from "./qa-41-6-helpers.js";

beforeAll(assertBinFresh);

/** Everything the bin printed during the current test; no run may echo a user's own bytes. */
const printed: string[] = [];
const USER_TEXT = ["claude, my words", "agents, mine", "my own rule", "gemini, mine", "last line without a newline", "my edited skill", "export {};"];

function runBin(sandbox: Sandbox, args: string[]): RunResult {
  const result = spawnBin(sandbox, args);
  printed.push(result.stdout, result.stderr);
  return result;
}

afterEach(() => {
  const output = printed.splice(0).join("\n");
  removeSandboxes();
  for (const text of USER_TEXT) expect(output.includes(text), `the bin echoed the user's text ${JSON.stringify(text)}`).toBe(false);
});

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

interface RouteCase {
  client: "cursor" | "gemini";
  displayName: string;
  /** Pre-existing user files for the project: [path, bytes]. */
  seed: Array<[string, Buffer]>;
  /** The files the install must create, by path, built from the pack on disk. */
  expectedFiles: () => Map<string, Buffer>;
  /** The host files the install edits, with their bytes after an install. */
  expectedHosts: () => Map<string, Buffer>;
  /** Seeded paths the route must leave byte-identical. */
  untouched: string[];
  /** Paths that do not exist before and must not exist after an install of this route. */
  neverCreated: string[];
  /** Seeded host files the install rewrites, and so backs up first. */
  rewrittenHosts: string[];
}

const ROUTES: RouteCase[] = [
  {
    client: "cursor",
    displayName: "Cursor",
    seed: [
      ["CLAUDE.md", Buffer.from("# claude, my words\r\n")],
      ["AGENTS.md", Buffer.concat([BOM, Buffer.from("# agents, mine\r\nno final newline")])],
      [".cursor/rules/mine.mdc", Buffer.from("---\nalwaysApply: false\n---\nmy own rule\n")],
      ["src/app.ts", Buffer.from("export {};\n")],
    ],
    expectedFiles: () => {
      const files = expectedSkillFiles(".agents/skills");
      files.set(`.cursor/rules/${RULE_STEM}.mdc`, packRuleForms().cursor);
      return files;
    },
    expectedHosts: () => new Map(),
    untouched: ["CLAUDE.md", "AGENTS.md", ".cursor/rules/mine.mdc", "src/app.ts"],
    neverCreated: [".claude", "GEMINI.md"],
    rewrittenHosts: [],
  },
  {
    client: "gemini",
    displayName: "Gemini CLI",
    seed: [
      ["GEMINI.md", Buffer.concat([BOM, Buffer.from("# gemini, mine\r\nlast line without a newline")])],
      ["CLAUDE.md", Buffer.from("# claude, my words\n")],
      ["AGENTS.md", Buffer.from("# agents, mine\n")],
      [".claude/settings.json", Buffer.from('{"mine":true}\n')],
    ],
    expectedFiles: () => expectedSkillFiles(".agents/skills"),
    expectedHosts: () =>
      new Map([
        [
          "GEMINI.md",
          Buffer.concat([BOM, Buffer.from("# gemini, mine\r\nlast line without a newline"), Buffer.from("\r\n"), packRuleForms().agentsMd]),
        ],
      ]),
    untouched: ["CLAUDE.md", "AGENTS.md", ".claude/settings.json"],
    neverCreated: [".claude/skills", ".claude/rules", ".cursor"],
    rewrittenHosts: ["GEMINI.md"],
  },
];

function seedProject(sandbox: Sandbox, route: RouteCase): void {
  for (const [rel, bytes] of route.seed) writeProjectFile(sandbox.project, rel, bytes);
}

describe("the built bin exists", () => {
  it("dist is built (this suite runs against dist)", () => {
    expect(binIsBuilt(), "run `pnpm --filter @iris-mcp/client-config build` first").toBe(true);
  });
});

describe.each(ROUTES)("the $client route on the built bin", (route) => {
  it(
    "dry run writes nothing, a bare run exits 2, --yes installs the pack byte for byte, a re-run writes nothing, uninstall restores every original byte",
    () => {
      const sandbox = makeSandbox();
      seedProject(sandbox, route);
      const original = lstatTree(sandbox.project, { modes: true });
      const originalBytes = new Map(route.seed.map(([rel]) => [rel, readFileSync(path.join(sandbox.project, ...rel.split("/")))]));

      // Dry run: a preview naming every path, and a byte-identical tree.
      const dry = runBin(sandbox, ["skills", "install", "--client", route.client, "--dry-run"]);
      expect(dry.status, dry.stderr).toBe(0);
      expect(dry.stdout).toContain(`Skills pack install for ${route.displayName} in `);
      expect(dry.stdout.endsWith("(dry run: nothing was written)\n")).toBe(true);
      const expectedFiles = route.expectedFiles();
      for (const rel of expectedFiles.keys()) expect(dry.stdout, rel).toContain(`  create    ${rel}\n`);
      expect(treeDiff(original, lstatTree(sandbox.project, { modes: true }))).toEqual([]);

      // Non-TTY without --yes: refused with exit 2, tree untouched.
      const refused = runBin(sandbox, ["skills", "install", "--client", route.client]);
      expect(refused.status).toBe(2);
      expect(refused.stderr).toContain("needs confirmation before writing and this is not an interactive terminal");
      expect(treeDiff(original, lstatTree(sandbox.project, { modes: true }))).toEqual([]);

      // Install.
      const installed = runBin(sandbox, ["skills", "install", "--client", route.client, "--yes"]);
      expect(installed.status, installed.stderr).toBe(0);
      expect(installed.stdout).toMatch(new RegExp(`\\nDone: \\d+ path\\(s\\) changed for ${route.displayName}\\.\\n`));

      // Every created file is byte-equal to the pack; no other file was created.
      const afterInstall = lstatTree(sandbox.project, { modes: true });
      const addedFiles = [...afterInstall.keys()].filter((key) => !original.has(key) && afterInstall.get(key)?.startsWith("file:")).sort();
      expect(addedFiles).toEqual([...expectedFiles.keys(), MANIFEST].sort());
      for (const [rel, bytes] of expectedFiles) {
        const got = readFileSync(path.join(sandbox.project, ...rel.split("/")));
        expect(got.equals(bytes), `${rel} differs from the pack`).toBe(true);
      }
      // The notice sits beside the adapted SQL skill.
      expect(existsSync(path.join(sandbox.project, ".agents", "skills", "iris-mcp-objectscript-sql", "IRIS-MCP-THIRD-PARTY-NOTICES.md"))).toBe(true);

      // Directories created are exactly the ancestors of the created files that did not exist before.
      const expectedDirs = new Set<string>();
      for (const rel of [...expectedFiles.keys(), MANIFEST]) {
        for (const dir of ancestors(rel)) if (!original.has(dir)) expectedDirs.add(dir);
      }
      const addedDirs = [...afterInstall.keys()].filter((key) => !original.has(key) && afterInstall.get(key)?.startsWith("dir")).sort();
      expect(addedDirs).toEqual([...expectedDirs].sort());

      // Host files: the user's bytes kept, the block appended in the host's own line-ending style.
      for (const [rel, bytes] of route.expectedHosts()) {
        const got = readFileSync(path.join(sandbox.project, ...rel.split("/")));
        expect(got.equals(bytes), `${rel} after install`).toBe(true);
      }
      // Everything else the user had is byte-identical, and nothing outside the route was created.
      for (const rel of route.untouched) {
        expect(readFileSync(path.join(sandbox.project, ...rel.split("/"))).equals(originalBytes.get(rel) as Buffer), rel).toBe(true);
      }
      for (const forbidden of route.neverCreated) expect(afterInstall.has(forbidden), forbidden).toBe(false);

      // The manifest lists exactly the files, their hashes, the client, the block and the created directories.
      const manifest = JSON.parse(readFileSync(path.join(sandbox.project, ...MANIFEST.split("/")), "utf8")) as {
        schema: number;
        files: Array<{ path: string; sha256: string; clients: string[] }>;
        blocks: Array<{ path: string; rule: string; created: boolean; lineEndingAdded: string; clients: string[] }>;
        dirs: string[];
      };
      expect(manifest.schema).toBe(1);
      expect(manifest.files.map((file) => file.path)).toEqual([...expectedFiles.keys()].sort());
      for (const file of manifest.files) {
        expect(file.sha256, file.path).toBe(sha256(expectedFiles.get(file.path) as Buffer));
        expect(file.clients, file.path).toEqual([route.client]);
      }
      expect(manifest.dirs).toEqual([...expectedDirs].sort());
      if (route.client === "gemini") {
        expect(manifest.blocks).toEqual([{ path: "GEMINI.md", rule: RULE_STEM, created: false, lineEndingAdded: "\r\n", clients: ["gemini"] }]);
      } else {
        expect(manifest.blocks).toEqual([]);
      }

      // The only backup an install takes is of a host file it rewrote: the user's bytes from before.
      expect(filesUnder(sandbox.home).size).toBe(route.rewrittenHosts.length);
      for (const rel of route.rewrittenHosts) {
        const copies = backupsOf(sandbox.home, rel);
        expect(copies.length, `backup of ${rel}`).toBe(1);
        expect((copies[0] as Buffer).equals(originalBytes.get(rel) as Buffer), `backup of ${rel} holds the user's bytes`).toBe(true);
      }
      const backupsAfterInstall = filesUnder(sandbox.home).size;

      // Re-install: nothing to change, no write (aged mtimes stay aged), the manifest bytes identical, no backup.
      const manifestBytes = readFileSync(path.join(sandbox.project, ...MANIFEST.split("/")));
      const aged = ageAllFiles(sandbox.project);
      const again = runBin(sandbox, ["skills", "install", "--client", route.client]);
      expect(again.status, again.stderr).toBe(0);
      expect(again.stdout).toContain(`Nothing to change for ${route.displayName}: the skills pack is already installed.\n`);
      expect(again.stdout).not.toMatch(/^ {2}(create|update|remove) /m);
      expect(mtimes(sandbox.project)).toEqual(aged);
      expect(readFileSync(path.join(sandbox.project, ...MANIFEST.split("/"))).equals(manifestBytes)).toBe(true);
      expect(filesUnder(sandbox.home).size, "a no-op re-install takes no backup").toBe(backupsAfterInstall);

      // Uninstall: every original byte is back, created files and directories are gone.
      const removed = runBin(sandbox, ["skills", "uninstall", "--client", route.client, "--yes"]);
      expect(removed.status, removed.stderr).toBe(0);
      expect(treeDiff(original, lstatTree(sandbox.project, { modes: true }))).toEqual([]);

      // Every file the uninstall deleted was backed up first, byte for byte, and every backup is under the temp home's
      // state directory.
      for (const [rel, bytes] of expectedFiles) {
        const copies = backupsOf(sandbox.home, rel);
        expect(copies.length, `backup of ${rel}`).toBe(1);
        expect((copies[0] as Buffer).equals(bytes), `backup of ${rel} equals the removed file`).toBe(true);
      }
      expect(backupsOf(sandbox.home, MANIFEST).length).toBe(1);
      for (const key of filesUnder(sandbox.home).keys()) expect(key.startsWith(`${BACKUP_ROOT}/`), key).toBe(true);

      // A second uninstall is a no-op that says so.
      const nothing = runBin(sandbox, ["skills", "uninstall", "--client", route.client]);
      expect(nothing.status, nothing.stderr).toBe(0);
      expect(nothing.stdout).toContain(`Nothing to remove for ${route.displayName}: the skills pack is not installed.\n`);
    },
    SPAWN_TEST_TIMEOUT,
  );

  it(
    "--include-modified backs up the user's edited skill under the TEMP home, byte for byte, and puts the pack bytes back",
    () => {
      const sandbox = makeSandbox();
      seedProject(sandbox, route);
      expect(runBin(sandbox, ["skills", "install", "--client", route.client, "--yes"]).status).toBe(0);

      const skill = ".agents/skills/check-system-health/SKILL.md";
      // "my edited skill", CRLF, a two-byte UTF-8 letter built from numbers, LF.
      const edited = Buffer.concat([Buffer.from("my edited skill\r\n"), Buffer.from([0xc3, 0xa9]), Buffer.from("\n")]);
      writeFileSync(path.join(sandbox.project, ...skill.split("/")), edited);
      const backupsBefore = filesUnder(sandbox.home).size;

      // Without --include-modified the edit is kept, and no backup is taken.
      const kept = runBin(sandbox, ["skills", "install", "--client", route.client, "--yes"]);
      expect(kept.status, kept.stderr).toBe(0);
      expect(kept.stdout).toContain(`  keep      ${skill} (changed since it was installed; --include-modified replaces it)\n`);
      expect(readFileSync(path.join(sandbox.project, ...skill.split("/"))).equals(edited)).toBe(true);
      expect(filesUnder(sandbox.home).size).toBe(backupsBefore);

      const replaced = runBin(sandbox, ["skills", "install", "--client", route.client, "--yes", "--include-modified"]);
      expect(replaced.status, replaced.stderr).toBe(0);
      expect(readFileSync(path.join(sandbox.project, ...skill.split("/"))).equals(route.expectedFiles().get(skill) as Buffer)).toBe(true);

      const found = backupsOf(sandbox.home, skill);
      expect(found.length).toBe(1);
      expect((found[0] as Buffer).equals(edited)).toBe(true);
      for (const key of filesUnder(sandbox.home).keys()) expect(key.startsWith(`${BACKUP_ROOT}/`), key).toBe(true);
    },
    SPAWN_TEST_TIMEOUT,
  );
});

describe("cursor and gemini share .agents/skills", () => {
  it(
    "uninstalling one keeps the shared skills and the other's rule; uninstalling both restores the original tree",
    () => {
      const sandbox = makeSandbox();
      writeProjectFile(sandbox.project, "GEMINI.md", "# gemini, mine\n");
      writeProjectFile(sandbox.project, ".cursor/rules/mine.mdc", "my own rule\n");
      const original = lstatTree(sandbox.project, { modes: true });
      const skills = expectedSkillFiles(".agents/skills");
      const forms = packRuleForms();

      expect(runBin(sandbox, ["skills", "install", "--client", "cursor", "--yes"]).status).toBe(0);
      const second = runBin(sandbox, ["skills", "install", "--client", "gemini", "--yes"]);
      expect(second.status, second.stderr).toBe(0);
      // The second client finds every skill already identical: no skill file is rewritten for it.
      expect(second.stdout).not.toMatch(/^ {2}(create|update) +\.agents\/skills\//m);

      const manifestBoth = JSON.parse(readFileSync(path.join(sandbox.project, ...MANIFEST.split("/")), "utf8")) as {
        files: Array<{ path: string; clients: string[] }>;
      };
      expect(manifestBoth.files.find((file) => file.path === ".agents/skills/check-system-health/SKILL.md")?.clients).toEqual(["cursor", "gemini"]);

      const first = runBin(sandbox, ["skills", "uninstall", "--client", "cursor", "--yes"]);
      expect(first.status, first.stderr).toBe(0);
      for (const [rel, bytes] of skills) {
        expect(readFileSync(path.join(sandbox.project, ...rel.split("/"))).equals(bytes), rel).toBe(true);
      }
      expect(existsSync(path.join(sandbox.project, ".cursor", "rules", `${RULE_STEM}.mdc`))).toBe(false);
      expect(readFileSync(path.join(sandbox.project, ".cursor", "rules", "mine.mdc"), "utf8")).toBe("my own rule\n");
      const gemini = readFileSync(path.join(sandbox.project, "GEMINI.md"));
      expect(gemini.equals(Buffer.concat([Buffer.from("# gemini, mine\n"), forms.agentsMd]))).toBe(true);

      const last = runBin(sandbox, ["skills", "uninstall", "--client", "gemini", "--yes"]);
      expect(last.status, last.stderr).toBe(0);
      expect(treeDiff(original, lstatTree(sandbox.project, { modes: true }))).toEqual([]);
      for (const key of filesUnder(sandbox.home).keys()) expect(key.startsWith(`${BACKUP_ROOT}/`), key).toBe(true);
    },
    SPAWN_TEST_TIMEOUT,
  );
});
