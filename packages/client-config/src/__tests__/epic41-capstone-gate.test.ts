/**
 * Epic 41 capstone gate: the skills pack installed, re-installed and uninstalled for EVERY client id, through the BUILT
 * `iris-mcp-clients` bin, in the default suite (project rule #21), each row naming the path it guards (rule #59).
 *
 * Every row spawns `dist/cli/clients-cli.js` in a fresh child process whose environment is built from scratch (HOME,
 * USERPROFILE and APPDATA are a temp home, cwd is a temp project), so nothing reaches the real home or the real repository.
 * The project is first seeded with foreign content (Rule #58 byte shapes: LF, CRLF, BOM, no final newline, a lone CR, empty,
 * BOM-only, look-alike markers, another rule's block, invalid UTF-8), and the row proves the installer's effect on it:
 *
 *  1. Install (`--yes`): the tree diff is exactly the pack's skill files under the route's skills directory, the notice
 *     beside each file that carries the adaptation header, the rule file or the marked block in its host, the manifest and
 *     the directories that did not exist. Every installed file is byte-equal to the pack, every installed `SKILL.md` passes
 *     `readSkillFrontmatter` (12 declare a preset, 6 none), and every foreign file keeps its bytes.
 *  2. Re-install with every mtime aged: `Nothing to change`, the same tree, mtimes, manifest bytes and backup count.
 *  3. Uninstall (`--yes`): the tree, modes included, equals the snapshot taken before the install.
 *  4. Claude Desktop (the one client with no route): install and uninstall each exit 2 with the refusal on stderr, an empty
 *     stdout, an unchanged tree, no manifest and no backup.
 *
 * Rows (one per `PACK_TARGETS` row, in that order, plus the completeness row):
 *  - 16 routed legs. Path: the built bin -> `cmdSkills` -> `pack-plan` / `pack-apply` / `rule-block` -> the project tree.
 *  - 1 claude-desktop leg. Path: the built bin -> `cmdSkills` -> `usageError` (a null route), before any plan is made.
 *  - the completeness row: 17 unique ids, every route in `PACK_ROUTE_IDS` used, exactly one id with no route.
 *
 * The oracles do not come from the bin: the route table, constants and refusal text are imported from the package's
 * `src/` modules, the pack bytes are read from disk, and frontmatter is read through the pack generator's own reader. A
 * defect in the compiled `dist/` alone (a route, a planner, a block editor) therefore turns a row red.
 *
 * Needs no IRIS. Writes only under OS temp directories it creates and removes.
 */

import { lstatSync, readdirSync, utimesSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  CLAUDE_DESKTOP_REFUSAL,
  NOTICE_FILENAME,
  PACK_ROUTES,
  PACK_ROUTE_IDS,
  PACK_TARGETS,
  RULE_FORM_EXTENSIONS,
  type PackTarget,
} from "../pack-targets.js";

import {
  hostFixtures,
  makeSandbox,
  readProjectFile,
  removeSandboxes,
  writeProjectFile,
  type HostFixture,
  type Sandbox,
} from "./pack-test-helpers.js";
import {
  assertBinFresh,
  BACKUP_ROOT,
  expectedSkillFiles,
  filesUnder,
  lstatTree,
  MANIFEST,
  PACK_ON_DISK,
  packNotice,
  packRuleForms,
  RULE_STEM,
  runBin,
  SPAWN_TEST_TIMEOUT,
  treeDiff,
} from "./qa-41-6-helpers.js";

type ReadSkillFrontmatter = (
  text: string,
  dirName: string,
) => { fields: { name?: string; description?: string }; metadata: Record<string, string>; problems: string[] };

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const BLOCK_HOSTS = ["AGENTS.md", "GEMINI.md"] as const;
const PRESET_KEY = "iris-tools-preset";
const SETTINGS = ".claude/settings.json";

let readSkillFrontmatter: ReadSkillFrontmatter;

beforeAll(async () => {
  await assertBinFresh();
  const generator = (await import(pathToFileURL(path.join(REPO_ROOT, "scripts", "lib", "skills-pack.mjs")).href)) as {
    readSkillFrontmatter: ReadSkillFrontmatter;
  };
  readSkillFrontmatter = generator.readSkillFrontmatter;
});

afterEach(removeSandboxes);

const FIXTURES = hostFixtures(RULE_STEM);
const ROUTED = PACK_TARGETS.filter((target) => target.route !== null);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The ancestor directories of a project-relative path, shallow first. */
function ancestors(rel: string): string[] {
  const parts = rel.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** The pack's names, read from the directories under `skills-pack/skills/`. */
function packSkillNames(): string[] {
  return readdirSync(path.join(PACK_ON_DISK, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** The line ending the installer must add to a host that has none on its last line: the host's own style. */
function lineEndingAdded(host: Buffer): string {
  const bom = host.length >= 3 && host[0] === 0xef && host[1] === 0xbb && host[2] === 0xbf ? 3 : 0;
  if (host.length === bom || host[host.length - 1] === 0x0a) return "";
  return host.includes(Buffer.from("\r\n")) ? "\r\n" : "\n";
}

/** Every file's mtime in ms (links are not followed), optionally after setting each one far in the past. */
function mtimesOf(dir: string, age: boolean): Map<string, number> {
  const out = new Map<string, number>();
  const past = new Date("2001-01-01T00:00:00Z");
  const walk = (current: string, prefix: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      const stat = lstatSync(full);
      if (stat.isDirectory()) {
        walk(full, rel);
      } else {
        if (age) utimesSync(full, past, past);
        out.set(rel, lstatSync(full).mtimeMs);
      }
    }
  };
  walk(dir, "");
  return out;
}

function backupCount(home: string): number {
  const files = [...filesUnder(home).keys()];
  for (const key of files) expect(key.startsWith(`${BACKUP_ROOT}/`), `${key} is outside the backup directory`).toBe(true);
  return files.length;
}

/**
 * Seed the temp project with foreign content and return every seeded path with its bytes. A routed leg (`legIndex` set)
 * also gets a foreign skill on even legs, a foreign rule beside a file-rule route's, and a pre-existing `.iris-mcp/` on
 * every third leg.
 */
function seedProject(sandbox: Sandbox, target: PackTarget, fixture: Buffer, legIndex: number | null): Map<string, Buffer> {
  const seeded = new Map<string, Buffer>();
  const put = (rel: string, bytes: Buffer | string): void => {
    const buffer = Buffer.from(bytes);
    writeProjectFile(sandbox.project, rel, buffer);
    seeded.set(rel, buffer);
  };
  put("CLAUDE.md", fixture);
  put(SETTINGS, '{"hooks":{}}\n');
  const route = target.route === null ? null : PACK_ROUTES[target.route];
  for (const host of BLOCK_HOSTS) {
    // The generic `agents` leg starts without AGENTS.md, so the installer creates it and the uninstall deletes it.
    if (target.id === "agents" && host === "AGENTS.md") continue;
    put(host, fixture);
  }
  if (route !== null && legIndex !== null) {
    if (legIndex % 2 === 0) put(`${route.skillsDir}/team-notes/SKILL.md`, "# Team notes\r\nkeep this line");
    if (route.rule.kind === "file") {
      put(`${route.rule.dir}/team${RULE_FORM_EXTENSIONS[route.rule.form]}`, "a team rule\n");
    }
    if (legIndex % 3 === 0) put(".iris-mcp/notes.txt", "notes\n");
  }
  return seeded;
}

describe("Epic 41 capstone: the skills pack for every client id on the built bin", () => {
  ROUTED.forEach((target, index) => {
    const route = PACK_ROUTES[target.route as NonNullable<PackTarget["route"]>];
    const fixture = FIXTURES[(index + 1) % FIXTURES.length] as HostFixture;

    it(
      `${target.id} (route ${route.id}, host fixture "${fixture.name}"): install, re-install, uninstall`,
      () => {
        const sandbox = makeSandbox();
        const seeded = seedProject(sandbox, target, fixture.bytes, index);
        const snapshot = lstatTree(sandbox.project, { modes: true });

        // 1. Install.
        const installed = runBin(sandbox, ["skills", "install", "--client", target.id, "--yes"]);
        expect(installed.status, `${installed.stdout}${installed.stderr}`).toBe(0);

        const created = new Map<string, Buffer>(expectedSkillFiles(route.skillsDir));
        const changedHosts: string[] = [];
        if (route.rule.kind === "file") {
          const rulePath = `${route.rule.dir}/${RULE_STEM}${RULE_FORM_EXTENSIONS[route.rule.form]}`;
          created.set(rulePath, packRuleForms()[route.rule.form]);
        } else if (seeded.has(route.rule.host)) {
          changedHosts.push(route.rule.host);
        } else {
          created.set(route.rule.host, packRuleForms().agentsMd);
        }
        const createdPaths = [...created.keys(), MANIFEST];
        const createdDirs = [
          ...new Set(createdPaths.flatMap((rel) => ancestors(rel)).filter((dir) => !snapshot.has(dir))),
        ];
        const expectedDiff = [
          ...createdPaths.map((rel) => `added ${rel}`),
          ...createdDirs.map((dir) => `added ${dir}`),
          ...changedHosts.map((rel) => `changed ${rel}`),
        ].sort();
        expect(treeDiff(snapshot, lstatTree(sandbox.project, { modes: true }))).toEqual(expectedDiff);

        for (const [rel, bytes] of created) {
          expect(readProjectFile(sandbox.project, rel).equals(bytes), `${rel} differs from the pack`).toBe(true);
        }
        expect(
          readProjectFile(sandbox.project, `${route.skillsDir}/iris-mcp-objectscript-sql/${NOTICE_FILENAME}`).equals(
            packNotice(),
          ),
          "the notice sits beside the adapted skill",
        ).toBe(true);

        if (route.rule.kind === "block") {
          const section = packRuleForms().agentsMd;
          const host = readProjectFile(sandbox.project, route.rule.host);
          const first = host.indexOf(section);
          expect(first, `${route.rule.host} holds the section`).toBeGreaterThanOrEqual(0);
          expect(host.indexOf(section, first + 1), `${route.rule.host} holds the section once`).toBe(-1);
          expect(first + section.length, "nothing follows the section").toBe(host.length);
          if (changedHosts.length === 0) {
            expect(first, "a created host is the section alone").toBe(0);
          } else {
            const before = host.subarray(0, first);
            const added = lineEndingAdded(fixture.bytes);
            expect(before.equals(Buffer.concat([fixture.bytes, Buffer.from(added)])), "the bytes before the section").toBe(true);
          }
        }

        // Every installed SKILL.md reads cleanly through the pack generator's own reader.
        const names = packSkillNames();
        expect(names).toHaveLength(18);
        let withPreset = 0;
        for (const name of names) {
          const text = readProjectFile(sandbox.project, `${route.skillsDir}/${name}/SKILL.md`).toString("utf8");
          const parsed = readSkillFrontmatter(text, name);
          expect(parsed.problems, `${name} frontmatter`).toEqual([]);
          expect(parsed.fields.name).toBe(name);
          if (parsed.metadata[PRESET_KEY] !== undefined) withPreset += 1;
        }
        expect(withPreset, "skills that declare a tool preset").toBe(12);
        expect(names.length - withPreset, "skills that declare none").toBe(6);

        // The summary line counts exactly the files written.
        const done = new RegExp(`\\nDone: (\\d+) path\\(s\\) changed for ${escapeRegExp(target.displayName)}\\.\\n`).exec(
          installed.stdout,
        );
        expect(done, `the Done line in:\n${installed.stdout}`).not.toBeNull();
        expect(Number(done?.[1])).toBe(createdPaths.length + changedHosts.length);

        // Foreign content is intact: every seeded file keeps its bytes, except the host that received the block.
        for (const [rel, bytes] of seeded) {
          if (changedHosts.includes(rel)) continue;
          expect(readProjectFile(sandbox.project, rel).equals(bytes), `${rel} (foreign) changed`).toBe(true);
        }

        // 2. Re-install: nothing to change, nothing rewritten.
        const afterInstall = lstatTree(sandbox.project, { modes: true });
        const manifestBytes = readProjectFile(sandbox.project, MANIFEST);
        const backupsAfterInstall = backupCount(sandbox.home);
        const aged = mtimesOf(sandbox.project, true);
        const again = runBin(sandbox, ["skills", "install", "--client", target.id, "--yes"]);
        expect(again.status, `${again.stdout}${again.stderr}`).toBe(0);
        expect(again.stdout).toContain(`Nothing to change for ${target.displayName}: the skills pack is already installed.\n`);
        expect(treeDiff(afterInstall, lstatTree(sandbox.project, { modes: true }))).toEqual([]);
        expect(mtimesOf(sandbox.project, false)).toEqual(aged);
        expect(readProjectFile(sandbox.project, MANIFEST).equals(manifestBytes)).toBe(true);
        expect(backupCount(sandbox.home), "a no-op re-install takes no backup").toBe(backupsAfterInstall);

        // 3. Uninstall: the project is exactly as it was.
        const removed = runBin(sandbox, ["skills", "uninstall", "--client", target.id, "--yes"]);
        expect(removed.status, `${removed.stdout}${removed.stderr}`).toBe(0);
        expect(treeDiff(snapshot, lstatTree(sandbox.project, { modes: true }))).toEqual([]);
        for (const [rel, bytes] of seeded) {
          expect(readProjectFile(sandbox.project, rel).equals(bytes), `${rel} after uninstall`).toBe(true);
        }
      },
      SPAWN_TEST_TIMEOUT,
    );
  });

  it(
    "claude-desktop (no route): install and uninstall are refused with exit 2 and change nothing",
    () => {
      const target = PACK_TARGETS.find((entry) => entry.route === null) as PackTarget;
      const sandbox = makeSandbox();
      seedProject(sandbox, target, (FIXTURES[0] as HostFixture).bytes, null);
      const snapshot = lstatTree(sandbox.project, { modes: true });

      for (const action of ["install", "uninstall"]) {
        const run = runBin(sandbox, ["skills", action, "--client", target.id, "--yes"]);
        expect(run.status, `${action}: ${run.stdout}${run.stderr}`).toBe(2);
        expect(run.stdout, `${action} stdout`).toBe("");
        expect(run.stderr.startsWith(`Error: ${CLAUDE_DESKTOP_REFUSAL}\n\nUsage: iris-mcp-clients skills install|uninstall`)).toBe(true);
        expect(treeDiff(snapshot, lstatTree(sandbox.project, { modes: true })), `${action} changed the tree`).toEqual([]);
        expect(lstatTree(sandbox.project).has(".iris-mcp"), "no manifest directory").toBe(false);
      }
      expect([...filesUnder(sandbox.home).keys()], "no backup").toEqual([]);
    },
    SPAWN_TEST_TIMEOUT,
  );

  it("completeness: 17 unique ids, every route used, exactly one id without a route", () => {
    const ids = PACK_TARGETS.map((target) => target.id);
    expect(ids).toHaveLength(17);
    expect(new Set(ids).size).toBe(17);
    expect(FIXTURES, "the 16 host byte shapes, one per routed leg").toHaveLength(16);
    expect(ROUTED).toHaveLength(16);
    const used = new Set(PACK_TARGETS.map((target) => target.route).filter((route) => route !== null));
    expect([...used].sort()).toEqual([...PACK_ROUTE_IDS].sort());
    expect(PACK_TARGETS.filter((target) => target.route === null).map((target) => target.id)).toEqual(["claude-desktop"]);
  });
});
