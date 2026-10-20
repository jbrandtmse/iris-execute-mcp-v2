/**
 * Story 41.6 - AD-30, links at or above an owned path. A symbolic link at or above any path the installer reads
 * or writes, or a hard link at one, is a conflict that refuses the whole run: through it a write or a delete would
 * land outside the project, or in a file such as CLAUDE.md that an AGENTS.md link points at.
 *
 * Plan-level rows run over an in-memory project with a `linkKind`; real-file-system rows (POSIX) make real links
 * in a temp sandbox, including one that appears between the preview and the execution.
 */

import { existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { executePackPlan, preparePackChange, REAL_BYTES_FS } from "../pack-apply.js";
import { LINK_DETAILS, MANIFEST_PATH, planPackChange, type LinkKind, type PackPlan, type ProjectView } from "../pack-plan.js";
import { NOTE_CLAUDE_MD } from "../pack-targets.js";

import {
  contextFor,
  jailedBytesFs,
  makeSandbox,
  mapProject,
  realPack,
  removeSandboxes,
  writeProjectFile,
  type MapProject,
} from "./pack-test-helpers.js";

afterEach(removeSandboxes);

const POSIX = process.platform !== "win32";
const RULE = "iris-mcp-objectscript-pre-write";
const SYMBOLIC =
  "a symbolic link; this installer writes only real files and folders inside the project, so replace the link or install by hand";
const HARD =
  "a hard link that another path shares; this installer never writes a file that another path also names, so replace the link or install by hand";

/** `project` with the given paths reported as links, counting every read of each path. */
function linked(project: MapProject, links: Record<string, LinkKind>): ProjectView & { reads: Map<string, number> } {
  const reads = new Map<string, number>();
  return {
    reads,
    read: (rel) => {
      reads.set(rel, (reads.get(rel) ?? 0) + 1);
      return project.read(rel);
    },
    isDirectory: (rel) => project.isDirectory(rel),
    listDir: (rel) => (project.listDir === undefined ? null : project.listDir(rel)),
    linkKind: (rel) => links[rel] ?? null,
  };
}

function planned(input: Parameters<typeof planPackChange>[0]): PackPlan {
  const result = planPackChange(input);
  if (!result.ok) throw new Error(`refused: ${result.message}`);
  return result;
}

/** The project holds nothing but its AGENTS.md link, which is still a link (a dangling link fails `stat`). */
function expectOnlyTheLink(project: string): void {
  expect(readdirSync(project)).toEqual(["AGENTS.md"]);
  expect(lstatSync(path.join(project, "AGENTS.md")).isSymbolicLink()).toBe(true);
}

function expectRefusedByLink(result: PackPlan, link: string, detail: string): void {
  expect(result.items).toEqual([{ path: link, change: "conflict", detail }]);
  expect(result.conflicts).toEqual([{ path: link, change: "conflict", detail }]);
  expect(result.writes).toEqual([]);
  expect(result.createDirs).toEqual([]);
  expect(result.removeDirs).toEqual([]);
  expect(result.manifestAfter).toBe(result.manifestBefore);
  expect(result.notes).toEqual([]);
  expect(result.changes).toBe(0);
}

describe("the golden link details", () => {
  it("names the link kind and the remedy", () => {
    expect(LINK_DETAILS).toEqual({ symbolic: SYMBOLIC, hard: HARD });
  });
});

describe("a link at or above an owned path refuses the plan", () => {
  const cases: Array<[string, string, LinkKind]> = [
    ["claude-code", ".claude", "symbolic"],
    ["claude-code", ".claude/skills", "symbolic"],
    ["claude-code", ".claude/rules", "symbolic"],
    ["claude-code", `.claude/rules/${RULE}.md`, "symbolic"],
    ["codex", ".agents", "symbolic"],
    ["codex", ".agents/skills/check-system-health", "symbolic"],
    ["codex", "AGENTS.md", "symbolic"],
    ["codex", "AGENTS.md", "hard"],
    ["gemini", "GEMINI.md", "symbolic"],
    ["cursor", ".cursor/rules", "symbolic"],
    ["cursor", `.cursor/rules/${RULE}.mdc`, "symbolic"],
    ["codex", ".iris-mcp", "symbolic"],
    ["codex", MANIFEST_PATH, "symbolic"],
  ];
  for (const [client, link, kind] of cases) {
    it(`install ${client} with a ${kind} link at ${link}: the link is the one conflict and nothing is planned`, () => {
      const project = linked(mapProject(), { [link]: kind });
      const result = planned({ action: "install", client, includeModified: false, pack: realPack(), project });
      expectRefusedByLink(result, link, kind === "hard" ? HARD : SYMBOLIC);
    });
  }

  it("uninstall refuses when an installed directory is now a link, and plans no delete through it", () => {
    const project = mapProject();
    project.apply(planned({ action: "install", client: "codex", includeModified: false, pack: realPack(), project }));
    const result = planned({ action: "uninstall", client: "codex", includeModified: false, project: linked(project, { ".agents/skills": "symbolic" }) });
    expectRefusedByLink(result, ".agents/skills", SYMBOLIC);
  });

  it("never reads the manifest through a linked .iris-mcp", () => {
    const project = mapProject();
    project.apply(planned({ action: "install", client: "codex", includeModified: false, pack: realPack(), project }));
    const view = linked(project, { ".iris-mcp": "symbolic" });
    const result = planned({ action: "uninstall", client: "codex", includeModified: false, project: view });
    expectRefusedByLink(result, ".iris-mcp", SYMBOLIC);
    expect(view.reads.get(MANIFEST_PATH) ?? 0).toBe(0);
  });

  it("names each link once, shallowest first, when several sit on the planned paths", () => {
    const project = linked(mapProject(), { ".agents": "symbolic", "AGENTS.md": "hard" });
    const result = planned({ action: "install", client: "codex", includeModified: false, pack: realPack(), project });
    expect(result.items).toEqual([
      { path: ".agents", change: "conflict", detail: SYMBOLIC },
      { path: "AGENTS.md", change: "conflict", detail: HARD },
    ]);
  });

  it("does not refuse a link the run never touches: CLAUDE.md as a link still gets its note", () => {
    const project = linked(mapProject({ "CLAUDE.md": "# mine\n" }), { "CLAUDE.md": "symbolic", src: "symbolic" });
    const result = planned({ action: "install", client: "claude-code", includeModified: false, pack: realPack(), project });
    expect(result.conflicts).toEqual([]);
    expect(result.notes).toContain(NOTE_CLAUDE_MD);
    expect(result.writes.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!POSIX)("links on a real file system", () => {
  it("REAL_BYTES_FS.linkKind tells a symbolic link (dangling too) and a hard link from a plain file or directory", () => {
    const sandbox = makeSandbox();
    const at = (name: string): string => path.join(sandbox.root, name);
    writeFileSync(at("plain.md"), "plain\n");
    mkdirSync(at("dir"));
    symlinkSync(at("plain.md"), at("to-file"));
    symlinkSync(at("dir"), at("to-dir"));
    symlinkSync(at("nowhere"), at("dangling"));
    writeFileSync(at("first.md"), "shared\n");
    linkSync(at("first.md"), at("second.md"));
    expect(REAL_BYTES_FS.linkKind(at("plain.md"))).toBeNull();
    expect(REAL_BYTES_FS.linkKind(at("dir"))).toBeNull();
    expect(REAL_BYTES_FS.linkKind(at("missing"))).toBeNull();
    expect(REAL_BYTES_FS.linkKind(at("to-file"))).toBe("symbolic");
    expect(REAL_BYTES_FS.linkKind(at("to-dir"))).toBe("symbolic");
    expect(REAL_BYTES_FS.linkKind(at("dangling"))).toBe("symbolic");
    expect(REAL_BYTES_FS.linkKind(at("first.md"))).toBe("hard");
    expect(REAL_BYTES_FS.linkKind(at("second.md"))).toBe("hard");
  });

  it("refuses a dangling AGENTS.md link at prepare time, and the executor writes nothing outside the project", () => {
    const sandbox = makeSandbox();
    const outside = path.join(sandbox.root, "outside");
    mkdirSync(outside);
    symlinkSync(path.join(outside, "not-there.md"), path.join(sandbox.project, "AGENTS.md"));
    const fs = jailedBytesFs(sandbox.root);
    const ctx = contextFor(sandbox, { stateDir: sandbox.state });
    const prepared = preparePackChange(ctx, { action: "install", client: "codex", includeModified: false, fs });
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.plan.conflicts).toEqual([{ path: "AGENTS.md", change: "conflict", detail: SYMBOLIC }]);
    expect(executePackPlan(ctx, prepared.plan, { fs })).toMatchObject({ ok: false, path: "AGENTS.md" });
    expect(existsSync(path.join(outside, "not-there.md"))).toBe(false);
    expectOnlyTheLink(sandbox.project);
    expect(existsSync(sandbox.state)).toBe(false);
  });

  it("plans a linked directory of the installer's own (.claude) as the conflict, not as a path outside its locations", () => {
    const sandbox = makeSandbox();
    const outside = path.join(sandbox.root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, path.join(sandbox.project, ".claude"));
    const prepared = preparePackChange(contextFor(sandbox), {
      action: "install",
      client: "claude-code",
      includeModified: false,
      fs: jailedBytesFs(sandbox.root),
    });
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.plan.items).toEqual([{ path: ".claude", change: "conflict", detail: SYMBOLIC }]);
  });

  it("refuses at execute time a link that appeared after the preview, and writes nothing through it", () => {
    const sandbox = makeSandbox();
    const outside = path.join(sandbox.root, "outside");
    mkdirSync(outside);
    const fs = jailedBytesFs(sandbox.root);
    const ctx = contextFor(sandbox, { stateDir: sandbox.state });
    const prepared = preparePackChange(ctx, { action: "install", client: "codex", includeModified: false, fs });
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.plan.conflicts).toEqual([]);
    symlinkSync(path.join(outside, "not-there.md"), path.join(sandbox.project, "AGENTS.md"));
    const result = executePackPlan(ctx, prepared.plan, { fs });
    expect(result).toEqual({
      ok: false,
      path: "AGENTS.md",
      reason: "AGENTS.md changed after the preview; nothing was written; re-run the command",
      changedSincePreview: true,
      rolledBack: true,
    });
    expect(existsSync(path.join(outside, "not-there.md"))).toBe(false);
    expectOnlyTheLink(sandbox.project);
  });

  it("refuses a hard-linked AGENTS.md and leaves the CLAUDE.md it shares bytes with untouched", () => {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "CLAUDE.md", "# claude, my words\n");
    linkSync(path.join(sandbox.project, "CLAUDE.md"), path.join(sandbox.project, "AGENTS.md"));
    const fs = jailedBytesFs(sandbox.root);
    const ctx = contextFor(sandbox, { stateDir: sandbox.state });
    const prepared = preparePackChange(ctx, { action: "install", client: "codex", includeModified: false, fs });
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.plan.conflicts).toEqual([{ path: "AGENTS.md", change: "conflict", detail: HARD }]);
    expect(executePackPlan(ctx, prepared.plan, { fs }).ok).toBe(false);
    expect(readFileSync(path.join(sandbox.project, "CLAUDE.md"), "utf8")).toBe("# claude, my words\n");
  });
});
