/**
 * Story 41.6 - AC 41.6.2: executing a plan against real temp directories, through a jailed `BytesFs` and an
 * injected context. Nothing here touches the repository root or the real home directory.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  REAL_BYTES_FS,
  executePackPlan,
  preparePackChange,
  projectKey,
  type BytesFs,
  type ExecuteResult,
  type PackContext,
} from "../pack-apply.js";
import { MANIFEST_PATH, parseManifest, type PackPlan } from "../pack-plan.js";
import { NOTICE_FILENAME } from "../pack-targets.js";

import {
  JailError,
  contextFor,
  failingOnWrite,
  hostFixtures,
  jailedBytesFs,
  makeSandbox,
  readProjectFile,
  realPack,
  removeSandboxes,
  sectionOf,
  sha,
  spyBytesFs,
  treeSnapshot,
  writeProjectFile,
  type Sandbox,
} from "./pack-test-helpers.js";

afterEach(removeSandboxes);

const RULE = "iris-mcp-objectscript-pre-write";
const ROUTE_CLIENTS = ["claude-code", "cursor", "gemini", "codex"] as const;

function clock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 9, 19, 12, 0, 0, tick++));
}

interface Run {
  prepared: PackPlan;
  result: ExecuteResult;
}

function run(
  sandbox: Sandbox,
  action: "install" | "uninstall",
  client: string,
  options: { includeModified?: boolean; fs?: BytesFs; ctx?: PackContext; now?: () => Date } = {},
): Run {
  const fs = options.fs ?? jailedBytesFs(sandbox.root);
  const ctx = options.ctx ?? contextFor(sandbox);
  const prepared = preparePackChange(ctx, { action, client, includeModified: options.includeModified ?? false, fs });
  if (!prepared.ok) throw new Error(`prepare failed: ${prepared.message}`);
  const result = executePackPlan(ctx, prepared.plan, { fs, now: options.now ?? clock() });
  return { prepared: prepared.plan, result };
}

function expectOk(result: ExecuteResult): void {
  expect(result.ok, result.ok ? "" : result.reason).toBe(true);
}

function skillsDirOf(client: string): string {
  return client === "claude-code" ? ".claude/skills" : ".agents/skills";
}

function packSkill(rel: string): Buffer {
  const bytes = realPack().skills.get(rel);
  if (bytes === undefined) throw new Error(`no such pack file: ${rel}`);
  return bytes;
}

describe("install: byte-exact copies of the pack", () => {
  for (const client of ROUTE_CLIENTS) {
    it(`${client}: every pack file, the notice beside the SQL skill, the rule and the manifest; nothing else`, () => {
      const sandbox = makeSandbox();
      const { result, prepared } = run(sandbox, "install", client);
      expectOk(result);
      const pack = realPack();
      const skills = skillsDirOf(client);
      const expectedFiles = new Set<string>([MANIFEST_PATH, `${skills}/iris-mcp-objectscript-sql/${NOTICE_FILENAME}`]);
      for (const [rel, bytes] of pack.skills) {
        expectedFiles.add(`${skills}/${rel}`);
        expect(readProjectFile(sandbox.project, `${skills}/${rel}`).equals(bytes), `${client} ${rel}`).toBe(true);
      }
      expect(readProjectFile(sandbox.project, `${skills}/iris-mcp-objectscript-sql/${NOTICE_FILENAME}`).equals(pack.notice)).toBe(true);
      const rule = pack.rules[0] as (typeof pack.rules)[number];
      if (client === "claude-code") {
        expectedFiles.add(`.claude/rules/${RULE}.md`);
        expect(readProjectFile(sandbox.project, `.claude/rules/${RULE}.md`).equals(rule.claudeCode)).toBe(true);
      } else if (client === "cursor") {
        expectedFiles.add(`.cursor/rules/${RULE}.mdc`);
        expect(readProjectFile(sandbox.project, `.cursor/rules/${RULE}.mdc`).equals(rule.cursor)).toBe(true);
      } else {
        const host = client === "gemini" ? "GEMINI.md" : "AGENTS.md";
        expectedFiles.add(host);
        expect(readProjectFile(sandbox.project, host).equals(rule.agentsMd)).toBe(true);
      }
      const onDisk = [...treeSnapshot(sandbox.project)].filter(([, kind]) => kind !== "dir").map(([rel]) => rel);
      expect(new Set(onDisk)).toEqual(expectedFiles);
      expect(result.ok && result.changed).toBe(prepared.changes);
      // The manifest records the sha of every file it lists.
      const manifest = parseManifest(readProjectFile(sandbox.project, MANIFEST_PATH));
      expect(manifest.ok).toBe(true);
      if (manifest.ok) {
        for (const file of manifest.manifest.files) {
          expect(file.sha256).toBe(sha(readProjectFile(sandbox.project, file.path)));
        }
      }
    });
  }

  it("never writes CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md or Copilot's instruction files", () => {
    for (const client of [...ROUTE_CLIENTS, "vscode"]) {
      const sandbox = makeSandbox();
      const untouched: Record<string, string> = {
        "CLAUDE.md": "# claude\n",
        ".claude/CLAUDE.md": "inner\n",
        "CLAUDE.local.md": "local\n",
        ".github/copilot-instructions.md": "copilot\n",
        ".github/instructions/a.instructions.md": "applyTo\n",
        ".claude/settings.json": "{}\n",
      };
      for (const [rel, content] of Object.entries(untouched)) writeProjectFile(sandbox.project, rel, content);
      expectOk(run(sandbox, "install", client).result);
      for (const [rel, content] of Object.entries(untouched)) {
        expect(readProjectFile(sandbox.project, rel).toString("utf8"), `${client} ${rel}`).toBe(content);
      }
      expectOk(run(sandbox, "uninstall", client).result);
      for (const [rel, content] of Object.entries(untouched)) {
        expect(readProjectFile(sandbox.project, rel).toString("utf8"), `${client} ${rel} after uninstall`).toBe(content);
      }
    }
  });
});

describe("install then uninstall leaves the project as it was", () => {
  for (const client of ROUTE_CLIENTS) {
    it(`${client}: created files and created directories are removed`, () => {
      const sandbox = makeSandbox();
      writeProjectFile(sandbox.project, "src/app.ts", "export {};\n");
      const before = treeSnapshot(sandbox.project);
      expectOk(run(sandbox, "install", client).result);
      expect(treeSnapshot(sandbox.project).size).toBeGreaterThan(before.size);
      expectOk(run(sandbox, "uninstall", client).result);
      expect(treeSnapshot(sandbox.project)).toEqual(before);
    });
  }

  it("keeps a directory the user already had, and removes the ones the installer made", () => {
    const sandbox = makeSandbox();
    mkdirSync(path.join(sandbox.project, ".claude"));
    const before = treeSnapshot(sandbox.project);
    expectOk(run(sandbox, "install", "claude-code").result);
    expectOk(run(sandbox, "uninstall", "claude-code").result);
    expect(treeSnapshot(sandbox.project)).toEqual(before);
    expect(before.get(".claude")).toBe("dir");
  });

  it("keeps a recorded directory that gained a foreign file, and removes everything else", () => {
    const sandbox = makeSandbox();
    expectOk(run(sandbox, "install", "claude-code").result);
    writeProjectFile(sandbox.project, ".claude/skills/check-system-health/mine.txt", "mine");
    expectOk(run(sandbox, "uninstall", "claude-code").result);
    expect([...treeSnapshot(sandbox.project).keys()].sort()).toEqual([
      ".claude",
      ".claude/skills",
      ".claude/skills/check-system-health",
      ".claude/skills/check-system-health/mine.txt",
    ]);
  });
});

describe("host fixtures (Rule #58): AGENTS.md and GEMINI.md", () => {
  const stem = RULE;
  for (const [client, host] of [["codex", "AGENTS.md"], ["gemini", "GEMINI.md"]] as const) {
    for (const fixture of hostFixtures(stem)) {
      it(`${client} ${host}, ${fixture.name}: bytes outside the block identical; uninstall restores the original`, () => {
        const sandbox = makeSandbox();
        writeFileSync(path.join(sandbox.project, host), fixture.bytes);
        expectOk(run(sandbox, "install", client).result);
        const installed = readProjectFile(sandbox.project, host);
        const section = realPack().rules[0]?.agentsMd as Buffer;
        expect(installed.subarray(installed.length - section.length).equals(section)).toBe(true);
        const outside = installed.subarray(0, installed.length - section.length);
        expect(outside.subarray(0, fixture.bytes.length).equals(fixture.bytes)).toBe(true);
        const added = outside.subarray(fixture.bytes.length).toString("utf8");
        const expectedAdded =
          fixture.bytes.length === 0 || (fixture.bytes.length === 3 && fixture.name === "bom only") || fixture.bytes[fixture.bytes.length - 1] === 0x0a
            ? ""
            : fixture.bytes.includes("\r\n")
              ? "\r\n"
              : "\n";
        expect(added).toBe(expectedAdded);
        expectOk(run(sandbox, "uninstall", client).result);
        expect(readProjectFile(sandbox.project, host).equals(fixture.bytes)).toBe(true);
        expect([...treeSnapshot(sandbox.project).keys()]).toEqual([host]);
      });
    }
  }

  it("a pre-existing block with the user's own text above and below survives an update and an uninstall", () => {
    const sandbox = makeSandbox();
    const original = Buffer.concat([Buffer.from("top\r\n"), sectionOf(RULE, "stale body"), Buffer.from("bottom, no newline")]);
    writeFileSync(path.join(sandbox.project, "AGENTS.md"), original);
    expectOk(run(sandbox, "install", "codex").result);
    const updated = readProjectFile(sandbox.project, "AGENTS.md");
    const section = realPack().rules[0]?.agentsMd as Buffer;
    expect(updated.equals(Buffer.concat([Buffer.from("top\r\n"), section, Buffer.from("bottom, no newline")]))).toBe(true);
    expectOk(run(sandbox, "uninstall", "codex").result);
    expect(readProjectFile(sandbox.project, "AGENTS.md").equals(Buffer.concat([Buffer.from("top\r\n"), Buffer.from("bottom, no newline")]))).toBe(true);
  });

  it("ambiguous markers refuse the run: exit-worthy conflict, nothing written", () => {
    const sandbox = makeSandbox();
    const content = Buffer.from(`<!-- IRIS-MCP-RULE:${RULE}:BEGIN -->\nonly a begin\n`);
    writeFileSync(path.join(sandbox.project, "AGENTS.md"), content);
    const before = treeSnapshot(sandbox.project);
    const fs = jailedBytesFs(sandbox.root);
    const ctx = contextFor(sandbox, { stateDir: sandbox.state });
    const prepared = preparePackChange(ctx, { action: "install", client: "codex", includeModified: false, fs });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.plan.conflicts.map((item) => item.path)).toEqual(["AGENTS.md"]);
    const result = executePackPlan(ctx, prepared.plan, { fs });
    expect(result.ok).toBe(false);
    expect(treeSnapshot(sandbox.project)).toEqual(before);
    expect(existsSync(sandbox.state)).toBe(false);
  });
});

describe("idempotence", () => {
  for (const client of ROUTE_CLIENTS) {
    it(`${client}: re-running an install writes no file, takes no backup and keeps the manifest bytes`, () => {
      const sandbox = makeSandbox();
      expectOk(run(sandbox, "install", client, { ctx: contextFor(sandbox, { stateDir: sandbox.state }) }).result);
      const manifestBefore = readProjectFile(sandbox.project, MANIFEST_PATH);
      const treeBefore = treeSnapshot(sandbox.project);
      const spy = spyBytesFs(jailedBytesFs(sandbox.root));
      const again = run(sandbox, "install", client, { fs: spy, ctx: contextFor(sandbox, { stateDir: sandbox.state }) });
      expectOk(again.result);
      expect(spy.mutations).toEqual([]);
      expect(again.prepared.changes).toBe(0);
      expect(again.prepared.items.every((item) => item.change === "unchanged")).toBe(true);
      expect(readProjectFile(sandbox.project, MANIFEST_PATH).equals(manifestBefore)).toBe(true);
      expect(treeSnapshot(sandbox.project)).toEqual(treeBefore);
      expect(existsSync(sandbox.state)).toBe(false);
    });
  }
});

describe("backups under the state directory", () => {
  it("backs up an owned file the user changed before --include-modified replaces it", () => {
    const sandbox = makeSandbox();
    const ctx = contextFor(sandbox, { stateDir: sandbox.state });
    expectOk(run(sandbox, "install", "claude-code", { ctx }).result);
    const target = ".claude/skills/check-system-health/SKILL.md";
    writeProjectFile(sandbox.project, target, "my edits\n");
    const kept = run(sandbox, "install", "claude-code", { ctx });
    expectOk(kept.result);
    expect(readProjectFile(sandbox.project, target).toString("utf8")).toBe("my edits\n");
    expect(existsSync(sandbox.state)).toBe(false);

    const forced = run(sandbox, "install", "claude-code", { ctx, includeModified: true });
    expectOk(forced.result);
    expect(readProjectFile(sandbox.project, target).equals(packSkill("check-system-health/SKILL.md"))).toBe(true);
    const backups = forced.result.ok ? forced.result.backups : [];
    expect(backups.length).toBe(1);
    const backup = backups[0] as string;
    expect(backup.startsWith(path.join(sandbox.state, "backups", "skills-pack", projectKey(ctx, sandbox.project)))).toBe(true);
    expect(path.basename(backup)).toMatch(/^SKILL\.md\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
    expect(readFileSync(backup, "utf8")).toBe("my edits\n");
  });

  it("backs up every file an uninstall deletes, and a host it rewrites", () => {
    const sandbox = makeSandbox();
    const ctx = contextFor(sandbox, { stateDir: sandbox.state });
    writeFileSync(path.join(sandbox.project, "AGENTS.md"), "mine");
    expectOk(run(sandbox, "install", "codex", { ctx }).result);
    const removed = run(sandbox, "uninstall", "codex", { ctx });
    expectOk(removed.result);
    const backups = removed.result.ok ? removed.result.backups : [];
    const deletions = removed.prepared.writes.filter((write) => write.after === null).length;
    const rewrites = removed.prepared.writes.filter((write) => write.after !== null && write.before !== null).length;
    expect(backups.length).toBe(deletions + rewrites + 1);
    for (const backup of backups) expect(backup.startsWith(sandbox.state)).toBe(true);
    const hostBackup = backups.find((backup) => path.basename(backup).startsWith("AGENTS.md."));
    expect(hostBackup).toBeDefined();
    expect(readFileSync(hostBackup as string).toString("utf8")).toContain(`<!-- IRIS-MCP-RULE:${RULE}:BEGIN -->`);
    const manifestBackup = backups.find((backup) => path.basename(backup).startsWith("skills-pack.json."));
    expect(manifestBackup).toBeDefined();
  });

  it("numbers a second backup taken in the same millisecond", () => {
    const sandbox = makeSandbox();
    const ctx = contextFor(sandbox, { stateDir: sandbox.state });
    expectOk(run(sandbox, "install", "claude-code", { ctx }).result);
    const target = ".claude/skills/check-system-health/SKILL.md";
    const fixed = (): Date => new Date(Date.UTC(2026, 9, 19, 12, 0, 0, 0));
    writeProjectFile(sandbox.project, target, "one\n");
    expectOk(run(sandbox, "install", "claude-code", { ctx, includeModified: true, now: fixed }).result);
    writeProjectFile(sandbox.project, target, "two\n");
    const second = run(sandbox, "install", "claude-code", { ctx, includeModified: true, now: fixed });
    expectOk(second.result);
    const backups = second.result.ok ? second.result.backups : [];
    expect(backups.some((backup) => backup.endsWith("-1"))).toBe(true);
    const dir = path.dirname(backups[0] as string);
    expect(readdirSync(dir).filter((name) => name.startsWith("SKILL.md.")).length).toBe(2);
  });

  it("derives the backup key from the project's name and the sha256 of its path", () => {
    const sandbox = makeSandbox();
    const ctx = contextFor(sandbox);
    const key = projectKey(ctx, sandbox.project);
    expect(key).toBe(`proj-${sha(Buffer.from(sandbox.project, "utf8")).slice(0, 12)}`);
    expect(projectKey(ctx, path.join(sandbox.root, "other", "proj"))).not.toBe(key);
    expect(projectKey(ctx, "/")).toMatch(/^project-[0-9a-f]{12}$/);
    expect(projectKey(ctx, "/a/b c?d")).toMatch(/^b_c_d-[0-9a-f]{12}$/);
  });
});

describe("rollback on a write failure", () => {
  /** A project with a host file the install must edit, plus a file the install must leave alone. */
  function seeded(): Sandbox {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "AGENTS.md", "# Mine\nlast line");
    writeProjectFile(sandbox.project, "src/app.ts", "export {};\n");
    return sandbox;
  }

  function countWrites(action: "install" | "uninstall"): number {
    const sandbox = seeded();
    const ctx = contextFor(sandbox, { stateDir: sandbox.state });
    if (action === "uninstall") expectOk(run(sandbox, "install", "codex", { ctx }).result);
    const counter = failingOnWrite(jailedBytesFs(sandbox.root), Number.MAX_SAFE_INTEGER);
    expectOk(run(sandbox, action, "codex", { fs: counter, ctx }).result);
    return counter.writes();
  }

  for (const action of ["install", "uninstall"] as const) {
    it(`${action}: every injected failure leaves the project byte-identical and the manifest unwritten`, () => {
      const total = countWrites(action);
      expect(total).toBeGreaterThan(5);
      const points = [...new Set([1, 2, 3, Math.floor(total / 2), total - 1, total])];
      for (const k of points) {
        const sandbox = seeded();
        const ctx = contextFor(sandbox, { stateDir: sandbox.state });
        if (action === "uninstall") expectOk(run(sandbox, "install", "codex", { ctx }).result);
        const before = treeSnapshot(sandbox.project);
        const manifestBefore = existsSync(path.join(sandbox.project, MANIFEST_PATH))
          ? readProjectFile(sandbox.project, MANIFEST_PATH)
          : null;
        const failing = failingOnWrite(jailedBytesFs(sandbox.root), k);
        const { result } = run(sandbox, action, "codex", { fs: failing, ctx });
        expect(result.ok, `${action} fails on write #${k}`).toBe(false);
        if (result.ok) continue;
        expect(result.rolledBack, `${action} #${k}`).toBe(true);
        expect(result.reason).toContain(`injected write failure #${k}`);
        expect(result.path).not.toBe("");
        expect(treeSnapshot(sandbox.project), `${action} #${k}`).toEqual(before);
        const manifestAfter = existsSync(path.join(sandbox.project, MANIFEST_PATH))
          ? readProjectFile(sandbox.project, MANIFEST_PATH)
          : null;
        expect(manifestAfter === null ? null : manifestAfter.toString("utf8")).toBe(manifestBefore === null ? null : manifestBefore.toString("utf8"));
      }
    });
  }

  it("names the path and the cause, never file content", () => {
    const sandbox = seeded();
    const failing = failingOnWrite(jailedBytesFs(sandbox.root), 2);
    const { result } = run(sandbox, "install", "codex", { fs: failing });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/^could not write \S+: injected write failure #2; every change of this run was undone$/);
      expect(result.reason).not.toContain("last line");
    }
  });
});

describe("the changed-since-preview refusal", () => {
  it("writes nothing when a planned file changes between plan and execute", () => {
    const sandbox = makeSandbox();
    writeFileSync(path.join(sandbox.project, "AGENTS.md"), "before preview\n");
    const fs = jailedBytesFs(sandbox.root);
    const ctx = contextFor(sandbox);
    const prepared = preparePackChange(ctx, { action: "install", client: "codex", includeModified: false, fs });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    writeFileSync(path.join(sandbox.project, "AGENTS.md"), "after preview\n");
    const edited = treeSnapshot(sandbox.project);
    const result = executePackPlan(ctx, prepared.plan, { fs });
    expect(result).toMatchObject({
      ok: false,
      path: "AGENTS.md",
      reason: "AGENTS.md changed after the preview; nothing was written; re-run the command",
      changedSincePreview: true,
    });
    expect(treeSnapshot(sandbox.project)).toEqual(edited);
  });

  it("refuses when a file that was absent at preview appears, and when a directory to create appears", () => {
    const sandbox = makeSandbox();
    const fs = jailedBytesFs(sandbox.root);
    const ctx = contextFor(sandbox);
    const prepared = preparePackChange(ctx, { action: "install", client: "claude-code", includeModified: false, fs });
    if (!prepared.ok) throw new Error(prepared.message);
    mkdirSync(path.join(sandbox.project, ".claude"));
    const dirResult = executePackPlan(ctx, prepared.plan, { fs });
    expect(dirResult).toMatchObject({ ok: false, changedSincePreview: true, path: ".claude" });
    writeProjectFile(sandbox.project, `.claude/rules/${RULE}.md`, "appeared\n");
    const fileResult = executePackPlan(ctx, prepared.plan, { fs });
    expect(fileResult).toMatchObject({ ok: false, changedSincePreview: true, path: `.claude/rules/${RULE}.md` });
    expect([...treeSnapshot(sandbox.project).keys()].sort()).toEqual([".claude", ".claude/rules", `.claude/rules/${RULE}.md`]);
  });

  it("refuses when the host the plan creates appears before the run, with no directory involved, and keeps its bytes", () => {
    const sandbox = makeSandbox();
    const fs = jailedBytesFs(sandbox.root);
    const ctx = contextFor(sandbox, { stateDir: sandbox.state });
    const prepared = preparePackChange(ctx, { action: "install", client: "codex", includeModified: false, fs });
    if (!prepared.ok) throw new Error(prepared.message);
    writeProjectFile(sandbox.project, "AGENTS.md", "mine, written while the prompt was open\n");
    const result = executePackPlan(ctx, prepared.plan, { fs });
    expect(result).toMatchObject({
      ok: false,
      path: "AGENTS.md",
      reason: "AGENTS.md changed after the preview; nothing was written; re-run the command",
      changedSincePreview: true,
    });
    expect(readProjectFile(sandbox.project, "AGENTS.md").toString("utf8")).toBe("mine, written while the prompt was open\n");
    expect([...treeSnapshot(sandbox.project).keys()]).toEqual(["AGENTS.md"]);
  });
});

describe("prepare: usage versus failure", () => {
  it("reports a missing project directory, an unknown client and a client with no route as usage", () => {
    const sandbox = makeSandbox();
    const fs = jailedBytesFs(sandbox.root);
    const ctx = contextFor(sandbox);
    expect(preparePackChange(contextFor(sandbox, { projectDir: path.join(sandbox.root, "nope") }), { action: "install", client: "codex", includeModified: false, fs })).toMatchObject({ ok: false, kind: "usage" });
    expect(preparePackChange(ctx, { action: "install", client: "nope", includeModified: false, fs })).toMatchObject({ ok: false, kind: "usage" });
    expect(preparePackChange(ctx, { action: "install", client: "claude-desktop", includeModified: false, fs })).toMatchObject({ ok: false, kind: "usage" });
    const { projectDir: omitted, ...withoutProject } = ctx;
    expect(omitted).toBeDefined();
    expect(preparePackChange(withoutProject, { action: "install", client: "codex", includeModified: false, fs })).toMatchObject({ ok: false, kind: "usage" });
  });

  it("reports an invalid manifest and a missing pack as failures, and needs no pack for an uninstall", () => {
    const sandbox = makeSandbox();
    const fs = jailedBytesFs(sandbox.root);
    const ctx = contextFor(sandbox);
    writeProjectFile(sandbox.project, MANIFEST_PATH, "{ not json");
    const bad = preparePackChange(ctx, { action: "install", client: "codex", includeModified: false, fs });
    expect(bad).toMatchObject({ ok: false, kind: "failure" });
    expect(!bad.ok && bad.message).toContain("is not valid (it is not JSON)");
    writeProjectFile(sandbox.project, MANIFEST_PATH, JSON.stringify({ schema: 1, files: [], blocks: [], dirs: [] }));
    const missing = preparePackChange(ctx, { action: "install", client: "codex", includeModified: false, fs, packDir: path.join(sandbox.root, "no-pack") });
    expect(missing).toMatchObject({ ok: false, kind: "failure" });
    const uninstall = preparePackChange(ctx, { action: "uninstall", client: "codex", includeModified: false, fs, packDir: path.join(sandbox.root, "no-pack") });
    expect(uninstall.ok).toBe(true);
  });

  it("reports an unreadable project file as a failure naming the cause, never an exception", () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "AGENTS.md", "mine\n");
    const inner = jailedBytesFs(sandbox.root);
    const unreadable: BytesFs = {
      ...inner,
      readBytes: (p) => {
        if (p.endsWith("AGENTS.md")) throw new Error("EACCES: permission denied");
        return inner.readBytes(p);
      },
    };
    const prepared = preparePackChange(contextFor(sandbox), { action: "install", client: "codex", includeModified: false, fs: unreadable });
    expect(prepared).toEqual({ ok: false, kind: "failure", message: "could not read the project: EACCES: permission denied" });
  });

  it("refuses to execute a plan that has conflicts, writing nothing", () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, ".agents/skills/deploy-and-test-class/SKILL.md", "foreign\n");
    const before = treeSnapshot(sandbox.project);
    const fs = jailedBytesFs(sandbox.root);
    const ctx = contextFor(sandbox);
    const prepared = preparePackChange(ctx, { action: "install", client: "codex", includeModified: false, fs });
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.plan.conflicts.length).toBe(1);
    expect(executePackPlan(ctx, prepared.plan, { fs })).toMatchObject({ ok: false });
    expect(treeSnapshot(sandbox.project)).toEqual(before);
  });

  it("does not delete or write outside the installer's locations when the manifest names such a path", () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "src/a.ts", "keep me\n");
    const evil = JSON.stringify({
      schema: 1,
      files: [{ path: "src/a.ts", sha256: sha(Buffer.from("keep me\n")), clients: ["codex"] }],
      blocks: [],
      dirs: [],
    });
    writeProjectFile(sandbox.project, MANIFEST_PATH, evil);
    const prepared = preparePackChange(contextFor(sandbox), { action: "uninstall", client: "codex", includeModified: true, fs: jailedBytesFs(sandbox.root) });
    expect(prepared).toMatchObject({ ok: false, kind: "failure" });
    expect(readProjectFile(sandbox.project, "src/a.ts").toString("utf8")).toBe("keep me\n");
  });
});

describe("the never boundary: every touched path, defaults included, stays inside the injected roots", () => {
  it("the jail throws for a path outside the sandbox", () => {
    const sandbox = makeSandbox();
    const fs = jailedBytesFs(sandbox.root);
    const outside = path.join(tmpdir(), "definitely-outside-the-sandbox");
    expect(() => fs.exists(outside)).toThrow(JailError);
    expect(() => fs.writeBytes(outside, Buffer.alloc(0))).toThrow(JailError);
    expect(() => fs.mkdir(path.join(sandbox.root, "..", "escape"))).toThrow(JailError);
    expect(fs.exists(sandbox.project)).toBe(true);
  });

  for (const client of ROUTE_CLIENTS) {
    it(`${client}: install, update with backup, and uninstall with stateDir unset reach only the sandbox`, () => {
      const sandbox = makeSandbox();
      const fs = jailedBytesFs(sandbox.root);
      const ctx = contextFor(sandbox);
      expect(ctx.stateDir).toBeUndefined();
      writeProjectFile(sandbox.project, "AGENTS.md", "mine");
      writeProjectFile(sandbox.project, "GEMINI.md", "mine");
      expectOk(run(sandbox, "install", client, { fs, ctx }).result);
      writeProjectFile(sandbox.project, `${skillsDirOf(client)}/check-system-health/SKILL.md`, "edited\n");
      expectOk(run(sandbox, "install", client, { fs, ctx, includeModified: true }).result);
      expectOk(run(sandbox, "uninstall", client, { fs, ctx }).result);
      expect(fs.touched.length).toBeGreaterThan(100);
      const root = path.resolve(sandbox.root) + path.sep;
      for (const touched of fs.touched) {
        expect(touched === path.resolve(sandbox.root) || touched.startsWith(root), touched).toBe(true);
      }
      // The default state directory is <homeDir>/.iris-mcp/client-manager, inside the sandbox.
      const backups = path.join(sandbox.home, ".iris-mcp", "client-manager", "backups", "skills-pack", projectKey(ctx, sandbox.project));
      expect(existsSync(backups)).toBe(true);
      expect(fs.touched.some((touched) => touched.startsWith(path.join(sandbox.home, ".iris-mcp", "client-manager")))).toBe(true);
    });
  }
});

describe("REAL_BYTES_FS", () => {
  it("removes a directory only when it is empty", () => {
    const sandbox = makeSandbox();
    const dir = path.join(sandbox.root, "d");
    REAL_BYTES_FS.mkdir(path.join(dir, "inner"));
    writeFileSync(path.join(dir, "inner", "f"), "x");
    expect(REAL_BYTES_FS.removeEmptyDir(path.join(dir, "inner"))).toBe(false);
    expect(REAL_BYTES_FS.removeEmptyDir(path.join(dir, "missing"))).toBe(false);
    REAL_BYTES_FS.removeFile(path.join(dir, "inner", "f"));
    expect(REAL_BYTES_FS.removeEmptyDir(path.join(dir, "inner"))).toBe(true);
    expect(REAL_BYTES_FS.isDirectory(path.join(dir, "inner"))).toBe(false);
    expect(REAL_BYTES_FS.isDirectory(path.join(dir, "nothing"))).toBe(false);
  });

  it("reads and writes bytes without decoding", () => {
    const sandbox = makeSandbox();
    const file = path.join(sandbox.root, "bytes.bin");
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0xc3, 0x28, 0x0d, 0x0a]);
    REAL_BYTES_FS.writeBytes(file, bytes);
    expect(REAL_BYTES_FS.readBytes(file).equals(bytes)).toBe(true);
    expect(REAL_BYTES_FS.listDir(sandbox.root)).toContain("bytes.bin");
  });
});
