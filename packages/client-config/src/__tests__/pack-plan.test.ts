/**
 * Story 41.6 - AC 41.6.2: planning over an in-memory project view, against the real pack and scratch packs.
 *
 * The expected paths are derived from a directory walk of the pack, not from the planner (Rule #36), and the
 * block oracles are hand-built sections.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PACK_DIR,
  MANIFEST_PATH,
  installerPayloads,
  loadPack,
  parseManifest,
  planPackChange,
  renderCounts,
  renderManifest,
  renderPlanItem,
  renderPlanPreview,
  type LoadedPack,
  type PackPlan,
  type PackRefusal,
  type PlanInput,
} from "../pack-plan.js";
import { CLAUDE_DESKTOP_REFUSAL, NOTE_CLAUDE_MD, NOTICE_FILENAME, firstMatchNote, packTargetFor } from "../pack-targets.js";

import { BOM, makeSandbox, mapProject, realPack, removeSandboxes, sectionOf, sha, writeProjectFile, type MapProject } from "./pack-test-helpers.js";

afterEach(removeSandboxes);

const RULE = "iris-mcp-objectscript-pre-write";
const SQL_SKILL = "iris-mcp-objectscript-sql/SKILL.md";

function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

const PACK_SKILL_FILES = walk(path.join(DEFAULT_PACK_DIR, "skills"));
const PACK_RULE = (form: string, ext: string): Buffer => readFileSync(path.join(DEFAULT_PACK_DIR, "rules", form, `${RULE}${ext}`));
const PACK_NOTICE = readFileSync(path.join(DEFAULT_PACK_DIR, NOTICE_FILENAME));

function plan(input: Omit<PlanInput, "includeModified"> & { includeModified?: boolean }): PackPlan {
  const result = planPackChange({ includeModified: false, ...input });
  if (!result.ok) throw new Error(`refused: ${result.message}`);
  return result;
}

function refusal(input: Omit<PlanInput, "includeModified"> & { includeModified?: boolean }): PackRefusal {
  const result = planPackChange({ includeModified: false, ...input });
  if (result.ok) throw new Error("expected a refusal");
  return result;
}

function install(project: MapProject, client: string, pack: LoadedPack = realPack(), includeModified = false): PackPlan {
  const result = plan({ action: "install", client, pack, project, includeModified });
  project.apply(result);
  return result;
}

function uninstall(project: MapProject, client: string, includeModified = false): PackPlan {
  const result = plan({ action: "uninstall", client, project, includeModified });
  project.apply(result);
  return result;
}

function paths(result: PackPlan, change?: string): string[] {
  return result.items.filter((item) => change === undefined || item.change === change).map((item) => item.path);
}

function withPack(edit: (skills: Map<string, Buffer>) => void): LoadedPack {
  const pack = realPack();
  const skills = new Map(pack.skills);
  edit(skills);
  return { ...pack, skills };
}

describe("the golden path list per route on an empty project", () => {
  const empty = (): MapProject => mapProject();

  it("claude-code: every skill under .claude/skills, the notice beside the SQL skill, the rule, the manifest", () => {
    const result = plan({ action: "install", client: "claude-code", pack: realPack(), project: empty() });
    const expected = [
      ...PACK_SKILL_FILES.map((rel) => `.claude/skills/${rel}`),
      `.claude/skills/iris-mcp-objectscript-sql/${NOTICE_FILENAME}`,
      `.claude/rules/${RULE}.md`,
      MANIFEST_PATH,
    ].sort();
    expect(paths(result)).toEqual(expected);
    expect(paths(result, "create")).toEqual(expected);
    expect(result.route).toBe("claude-code");
    expect(result.changes).toBe(expected.length);
    expect(result.conflicts).toEqual([]);
  });

  it("cursor: .agents/skills plus the .mdc rule", () => {
    const result = plan({ action: "install", client: "cursor", pack: realPack(), project: empty() });
    const expected = [
      ...PACK_SKILL_FILES.map((rel) => `.agents/skills/${rel}`),
      `.agents/skills/iris-mcp-objectscript-sql/${NOTICE_FILENAME}`,
      `.cursor/rules/${RULE}.mdc`,
      MANIFEST_PATH,
    ].sort();
    expect(paths(result)).toEqual(expected);
  });

  it("codex (agents route): .agents/skills plus an AGENTS.md holding the block", () => {
    const result = plan({ action: "install", client: "codex", pack: realPack(), project: empty() });
    const expected = [
      ...PACK_SKILL_FILES.map((rel) => `.agents/skills/${rel}`),
      `.agents/skills/iris-mcp-objectscript-sql/${NOTICE_FILENAME}`,
      "AGENTS.md",
      MANIFEST_PATH,
    ].sort();
    expect(paths(result)).toEqual(expected);
    const host = result.writes.find((write) => write.rel === "AGENTS.md");
    expect(host?.before).toBeNull();
    expect(host?.after?.equals(PACK_RULE("agents-md", ".md"))).toBe(true);
    expect(host?.after?.subarray(0, 3).equals(BOM)).toBe(false);
  });

  it("gemini: .agents/skills plus a GEMINI.md holding the same section bytes", () => {
    const result = plan({ action: "install", client: "gemini", pack: realPack(), project: empty() });
    expect(paths(result)).toContain("GEMINI.md");
    expect(paths(result)).not.toContain("AGENTS.md");
    expect(result.writes.find((write) => write.rel === "GEMINI.md")?.after?.equals(PACK_RULE("agents-md", ".md"))).toBe(true);
  });

  it("every route copies each pack file byte for byte", () => {
    for (const client of ["claude-code", "cursor", "gemini", "codex", "vscode", "agents"]) {
      const result = plan({ action: "install", client, pack: realPack(), project: empty() });
      const route = packTargetFor(client)?.route;
      const skillsDir = route === "claude-code" ? ".claude/skills" : ".agents/skills";
      for (const rel of PACK_SKILL_FILES) {
        const write = result.writes.find((entry) => entry.rel === `${skillsDir}/${rel}`);
        expect(write?.after?.equals(readFileSync(path.join(DEFAULT_PACK_DIR, "skills", rel))), `${client} ${rel}`).toBe(true);
      }
    }
  });

  it("puts the notice beside the adapted SQL skill, byte-equal to the pack notice, and nowhere else", () => {
    const result = plan({ action: "install", client: "claude-code", pack: realPack(), project: empty() });
    const notices = result.writes.filter((write) => write.rel.endsWith(NOTICE_FILENAME));
    expect(notices.map((write) => write.rel)).toEqual([`.claude/skills/iris-mcp-objectscript-sql/${NOTICE_FILENAME}`]);
    expect(notices[0]?.after?.equals(PACK_NOTICE)).toBe(true);
    expect(PACK_SKILL_FILES).toContain(SQL_SKILL);
  });

  it("creates the directories shallow first and records them in the manifest", () => {
    const result = plan({ action: "install", client: "claude-code", pack: realPack(), project: empty() });
    expect(result.createDirs.slice(0, 4)).toEqual([".claude", ".iris-mcp", ".claude/rules", ".claude/skills"]);
    const depths = result.createDirs.map((dir) => dir.split("/").length);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    expect(result.createDirs).toContain(".iris-mcp");
    const manifest = parseManifest(result.manifestAfter as Buffer);
    expect(manifest.ok && manifest.manifest.dirs.sort()).toEqual([...result.createDirs].sort());
  });

  it("writes a deterministic manifest: sorted, two-space JSON, LF, no timestamp", () => {
    const result = plan({ action: "install", client: "claude-code", pack: realPack(), project: empty() });
    const text = (result.manifestAfter as Buffer).toString("utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).not.toContain("\r");
    expect(text).toContain('\n  "schema": 1,');
    expect(text).not.toMatch(/20\d\d-\d\d-\d\d/);
    const parsed = parseManifest(result.manifestAfter as Buffer);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const filePaths = parsed.manifest.files.map((file) => file.path);
      expect(filePaths).toEqual([...filePaths].sort());
      for (const file of parsed.manifest.files) {
        expect(file.clients).toEqual(["claude-code"]);
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(renderManifest(parsed.manifest).equals(result.manifestAfter as Buffer)).toBe(true);
    }
  });
});

describe("refusals", () => {
  it("refuses an unknown client and a client with no route, never throwing", () => {
    expect(refusal({ action: "install", client: "nope", pack: realPack(), project: mapProject() })).toEqual({
      ok: false,
      kind: "unknown-client",
      message: 'unknown client "nope"',
    });
    expect(refusal({ action: "install", client: "claude-desktop", pack: realPack(), project: mapProject() })).toEqual({
      ok: false,
      kind: "no-route",
      message: CLAUDE_DESKTOP_REFUSAL,
    });
  });

  it("refuses an install planned without a pack", () => {
    expect(refusal({ action: "install", client: "codex", project: mapProject() }).kind).toBe("pack");
  });

  it("refuses a rule form or block section that carries adapted content, fail closed", () => {
    const base = realPack();
    const marker = Buffer.from("Adapted from intersystems-community/iris-agentic-dev\n");
    const rule = base.rules[0] as (typeof base.rules)[number];
    const variants: Record<string, LoadedPack> = {
      claudeCode: { ...base, rules: [{ ...rule, claudeCode: Buffer.concat([marker, rule.claudeCode]) }] },
      cursor: { ...base, rules: [{ ...rule, cursor: Buffer.concat([rule.cursor, marker]) }] },
      agentsMd: {
        ...base,
        rules: [
          {
            ...rule,
            agentsMd: sectionOf(RULE, "Adapted from intersystems-community/iris-agentic-dev (body)"),
          },
        ],
      },
    };
    for (const [form, pack] of Object.entries(variants)) {
      // Whichever route the client takes, a marked form anywhere refuses the install.
      for (const client of ["claude-code", "cursor", "codex"]) {
        const result = refusal({ action: "install", client, pack, project: mapProject() });
        expect(result.kind, `${form} via ${client}`).toBe("pack");
        expect(result.message).toContain("carries adapted content");
      }
    }
  });
});

describe("adopt, keep, conflict", () => {
  it("adopts a file that is byte-identical to the pack, with no write for it", () => {
    const project = mapProject({ [`.claude/skills/${SQL_SKILL}`]: readFileSync(path.join(DEFAULT_PACK_DIR, "skills", SQL_SKILL)) });
    const result = plan({ action: "install", client: "claude-code", pack: realPack(), project });
    const item = result.items.find((entry) => entry.path === `.claude/skills/${SQL_SKILL}`);
    expect(item).toEqual({
      path: `.claude/skills/${SQL_SKILL}`,
      change: "adopt",
      detail: "already identical to the skills pack; recorded as installed",
    });
    expect(result.writes.some((write) => write.rel === `.claude/skills/${SQL_SKILL}`)).toBe(false);
    const manifest = parseManifest(result.manifestAfter as Buffer);
    expect(manifest.ok && manifest.manifest.files.some((file) => file.path === `.claude/skills/${SQL_SKILL}`)).toBe(true);
  });

  it("reports a foreign file at an owned path as a conflict and plans no write at all", () => {
    const target = ".claude/skills/deploy-and-test-class/SKILL.md";
    const project = mapProject({ [target]: "my own skill\n" });
    const result = plan({ action: "install", client: "claude-code", pack: realPack(), project });
    expect(result.conflicts).toEqual([
      {
        path: target,
        change: "conflict",
        detail: "exists, and this installer did not install it; move or delete it, then re-run",
      },
    ]);
    expect(result.writes).toEqual([]);
    expect(result.createDirs).toEqual([]);
    expect(result.manifestAfter).toBeNull();
    expect(result.counts.conflict).toBe(1);
  });

  it("keeps a user-edited owned file on install and uninstall, and replaces or removes it with includeModified", () => {
    const project = mapProject();
    install(project, "claude-code");
    const target = ".claude/skills/check-system-health/SKILL.md";
    project.put(target, "edited by the user\n");

    const keptInstall = plan({ action: "install", client: "claude-code", pack: realPack(), project });
    expect(keptInstall.items.find((entry) => entry.path === target)).toEqual({
      path: target,
      change: "keep",
      detail: "changed since it was installed; --include-modified replaces it",
    });
    expect(keptInstall.writes).toEqual([]);

    const keptUninstall = plan({ action: "uninstall", client: "claude-code", project });
    expect(keptUninstall.items.find((entry) => entry.path === target)).toEqual({
      path: target,
      change: "keep",
      detail: "changed since it was installed; --include-modified removes it",
    });
    expect(keptUninstall.writes.some((write) => write.rel === target)).toBe(false);
    // The record of a kept file stays, so a later --include-modified run can still remove it.
    const manifest = parseManifest(keptUninstall.manifestAfter as Buffer);
    expect(manifest.ok && manifest.manifest.files.map((file) => file.path)).toEqual([target]);

    const replaced = plan({ action: "install", client: "claude-code", pack: realPack(), project, includeModified: true });
    const replace = replaced.writes.find((write) => write.rel === target);
    expect(replace?.before?.toString("utf8")).toBe("edited by the user\n");
    expect(replace?.after?.equals(readFileSync(path.join(DEFAULT_PACK_DIR, "skills", "check-system-health", "SKILL.md")))).toBe(true);

    const removed = plan({ action: "uninstall", client: "claude-code", project, includeModified: true });
    expect(removed.writes.find((write) => write.rel === target)).toMatchObject({ after: null });
  });

  it("recreates an owned file the user deleted", () => {
    const project = mapProject();
    install(project, "claude-code");
    project.files.delete(".claude/skills/check-system-health/SKILL.md");
    const result = plan({ action: "install", client: "claude-code", pack: realPack(), project });
    expect(paths(result, "create")).toEqual([".claude/skills/check-system-health/SKILL.md"]);
  });

  it("reports a directory in the way of a file as a conflict", () => {
    const target = ".claude/rules/" + RULE + ".md";
    const project = mapProject({ [`${target}/inner.txt`]: "x" });
    const result = plan({ action: "install", client: "claude-code", pack: realPack(), project });
    expect(result.conflicts.map((item) => item.path)).toEqual([target]);
  });

  it("reports a file in the way of a directory as a conflict", () => {
    const project = mapProject({ ".claude": "a file named like our directory" });
    const result = plan({ action: "install", client: "claude-code", pack: realPack(), project });
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0]?.detail).toContain("a file is in the way of the directory .claude");
    expect(result.writes).toEqual([]);
  });
});

describe("idempotence and the manifest", () => {
  it("a second identical install marks every item unchanged, keeps the manifest bytes and plans no write", () => {
    const project = mapProject();
    const first = install(project, "codex");
    const second = plan({ action: "install", client: "codex", pack: realPack(), project });
    expect(second.items.every((item) => item.change === "unchanged")).toBe(true);
    expect(second.items.length).toBe(first.items.length);
    expect(second.changes).toBe(0);
    expect(second.writes).toEqual([]);
    expect(second.createDirs).toEqual([]);
    expect((second.manifestAfter as Buffer).equals(second.manifestBefore as Buffer)).toBe(true);
  });

  it("leaves a hand-formatted but equivalent manifest alone", () => {
    const project = mapProject();
    install(project, "claude-code");
    const parsed = parseManifest(project.files.get(MANIFEST_PATH) as Buffer);
    if (!parsed.ok) throw new Error("manifest");
    project.put(MANIFEST_PATH, JSON.stringify(parsed.manifest));
    const again = plan({ action: "install", client: "claude-code", pack: realPack(), project });
    expect(again.changes).toBe(0);
    expect(again.manifestAfter?.toString("utf8")).toBe(JSON.stringify(parsed.manifest));
  });

  it("rejects an invalid manifest with the golden message and each why", () => {
    const wrapper = (why: string): string =>
      `the installer's record ${MANIFEST_PATH} is not valid (${why}); fix or delete it, then re-run`;
    const good = (extra: Record<string, unknown> = {}): string =>
      JSON.stringify({ schema: 1, files: [], blocks: [], dirs: [], ...extra });
    const entry = (p: string): Record<string, unknown> => ({ path: p, sha256: "0".repeat(64), clients: ["codex"] });
    const cases: Array<[string, string, string]> = [
      ["not JSON", "not json {", "it is not JSON"],
      ["an array", "[]", "it is not a JSON object"],
      ["unknown schema", JSON.stringify({ schema: 2, files: [], blocks: [], dirs: [] }), "unknown schema 2; this installer reads schema 1"],
      ["no schema", JSON.stringify({ files: [], blocks: [], dirs: [] }), "unknown schema (none); this installer reads schema 1"],
      ["wrong shape", JSON.stringify({ schema: 1, files: {}, blocks: [], dirs: [] }), '"files", "blocks" and "dirs" must each be a list'],
      ["extra field", good({ extra: 1 }), 'unexpected field "extra"'],
      ["parent path", good({ files: [entry("../x")] }), 'the path "../x" is outside the locations this installer manages'],
      ["absolute path", good({ files: [entry("/abs")] }), 'the path "/abs" is outside the locations this installer manages'],
      ["source path", good({ files: [entry("src/a.ts")] }), 'the path "src/a.ts" is outside the locations this installer manages'],
      [
        "dot segment",
        good({ files: [entry(".claude/skills/../../src/a.ts")] }),
        'the path ".claude/skills/../../src/a.ts" is outside the locations this installer manages',
      ],
      ["backslash", good({ files: [entry(".claude\\skills\\x")] }), 'the path ".claude\\skills\\x" is outside the locations this installer manages'],
      ["bad hash", good({ files: [{ ...entry(".claude/skills/x/SKILL.md"), sha256: "xyz" }] }), 'the files entry ".claude/skills/x/SKILL.md" has no valid sha256'],
      [
        "duplicate path",
        good({ files: [entry(".claude/skills/x/SKILL.md"), entry(".claude/skills/x/SKILL.md")] }),
        'the path ".claude/skills/x/SKILL.md" is listed twice',
      ],
      [
        "no clients",
        good({ files: [{ ...entry(".claude/skills/x/SKILL.md"), clients: [] }] }),
        'the files entry ".claude/skills/x/SKILL.md" needs a non-empty "clients" list',
      ],
      [
        "block in a foreign host",
        good({ blocks: [{ path: "CLAUDE.md", rule: "r", created: false, lineEndingAdded: "", clients: ["codex"] }] }),
        'the block host "CLAUDE.md" is outside the locations this installer manages',
      ],
      [
        "bad line ending",
        good({ blocks: [{ path: "AGENTS.md", rule: "r", created: false, lineEndingAdded: "\r", clients: ["codex"] }] }),
        'the blocks entry "AGENTS.md" has an invalid "lineEndingAdded"',
      ],
      ["foreign directory", good({ dirs: ["src"] }), 'the directory "src" is outside the locations this installer manages'],
    ];
    for (const [name, content, why] of cases) {
      const result = refusal({ action: "install", client: "codex", pack: realPack(), project: mapProject({ [MANIFEST_PATH]: content }) });
      expect(result.kind, name).toBe("manifest");
      expect(result.message, name).toBe(wrapper(why));
    }
  });

  it("rejects a manifest that is a directory", () => {
    const result = refusal({ action: "uninstall", client: "codex", project: mapProject({ [`${MANIFEST_PATH}/x`]: "1" }) });
    expect(result.kind).toBe("manifest");
  });

  it("round-trips a valid manifest", () => {
    const project = mapProject();
    install(project, "codex");
    const parsed = parseManifest(project.files.get(MANIFEST_PATH) as Buffer);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.manifest.blocks).toEqual([
        { path: "AGENTS.md", rule: RULE, created: true, lineEndingAdded: "", clients: ["codex"] },
      ]);
    }
  });
});

describe("pack update and stale removal", () => {
  it("removes a dropped skill, updates a changed one, and leaves the rest unchanged", () => {
    const project = mapProject();
    install(project, "claude-code");
    const dropped = "check-system-health/SKILL.md";
    const changed = "trace-message-flow/SKILL.md";
    const packB = withPack((skills) => {
      skills.delete(dropped);
      skills.set(changed, Buffer.concat([skills.get(changed) as Buffer, Buffer.from("\nAn added line.\n")]));
    });
    const result = plan({ action: "install", client: "claude-code", pack: packB, project });
    expect(result.items.find((item) => item.path === `.claude/skills/${dropped}`)).toEqual({
      path: `.claude/skills/${dropped}`,
      change: "remove",
      detail: "no longer in the skills pack",
    });
    expect(paths(result, "update").sort()).toEqual([`.claude/skills/${changed}`, MANIFEST_PATH].sort());
    expect(result.counts.remove).toBe(1);
    expect(result.counts.create).toBe(0);
    project.apply(result);
    expect(project.files.has(`.claude/skills/${dropped}`)).toBe(false);
    expect(project.files.get(`.claude/skills/${changed}`)?.toString("utf8")).toContain("An added line.");
    const next = plan({ action: "install", client: "claude-code", pack: packB, project });
    expect(next.changes).toBe(0);
  });

  it("removes the directory of a dropped skill when it is empty and the installer created it", () => {
    const project = mapProject();
    install(project, "claude-code");
    const packB = withPack((skills) => skills.delete("check-system-health/SKILL.md"));
    const result = plan({ action: "install", client: "claude-code", pack: packB, project });
    expect(result.removeDirs).toEqual([".claude/skills/check-system-health"]);
  });

  it("keeps a modified file whose skill was dropped, unless includeModified", () => {
    const project = mapProject();
    install(project, "claude-code");
    project.put(".claude/skills/check-system-health/SKILL.md", "mine\n");
    const packB = withPack((skills) => skills.delete("check-system-health/SKILL.md"));
    const kept = plan({ action: "install", client: "claude-code", pack: packB, project });
    expect(kept.items.find((item) => item.path === ".claude/skills/check-system-health/SKILL.md")?.change).toBe("keep");
    const forced = plan({ action: "install", client: "claude-code", pack: packB, project, includeModified: true });
    expect(forced.writes.find((write) => write.rel === ".claude/skills/check-system-health/SKILL.md")).toMatchObject({ after: null });
  });

  it("keeps the notice beside an adapted skill the user edited, on uninstall and on stale removal, and removes both with includeModified", () => {
    const skill = `.claude/skills/${SQL_SKILL}`;
    const notice = `.claude/skills/iris-mcp-objectscript-sql/${NOTICE_FILENAME}`;
    const keptDetail = "kept beside a file you changed, which may still carry the adapted content";
    const project = mapProject();
    install(project, "claude-code");
    project.put(skill, "adapted content, edited by the user\n");

    const kept = plan({ action: "uninstall", client: "claude-code", project });
    expect(kept.items.find((item) => item.path === skill)?.change).toBe("keep");
    expect(kept.items.find((item) => item.path === notice)).toEqual({ path: notice, change: "keep", detail: keptDetail });
    expect(kept.writes.some((write) => write.rel === notice || write.rel === skill)).toBe(false);
    const manifest = parseManifest(kept.manifestAfter as Buffer);
    expect(manifest.ok && manifest.manifest.files.map((file) => file.path).sort()).toEqual([notice, skill].sort());

    const stale = plan({
      action: "install",
      client: "claude-code",
      pack: withPack((skills) => skills.delete(SQL_SKILL)),
      project,
    });
    expect(stale.items.find((item) => item.path === notice)).toEqual({ path: notice, change: "keep", detail: keptDetail });
    expect(stale.writes.some((write) => write.rel === notice)).toBe(false);

    const forced = plan({ action: "uninstall", client: "claude-code", project, includeModified: true });
    expect(forced.writes.find((write) => write.rel === skill)).toMatchObject({ after: null });
    expect(forced.writes.find((write) => write.rel === notice)).toMatchObject({ after: null });

    const untouched = mapProject();
    install(untouched, "claude-code");
    const removed = plan({ action: "uninstall", client: "claude-code", project: untouched });
    expect(removed.writes.find((write) => write.rel === notice)).toMatchObject({ after: null });
  });

  it("drops the record of a file that is already gone", () => {
    const project = mapProject();
    install(project, "claude-code");
    project.files.delete(".claude/skills/check-system-health/SKILL.md");
    const result = plan({ action: "uninstall", client: "claude-code", project });
    expect(result.items.find((item) => item.path === ".claude/skills/check-system-health/SKILL.md")).toEqual({
      path: ".claude/skills/check-system-health/SKILL.md",
      change: "remove",
      detail: "already gone; its record is dropped",
    });
    expect(result.writes.some((write) => write.rel === ".claude/skills/check-system-health/SKILL.md")).toBe(false);
  });
});

describe("shared paths and uninstall", () => {
  it("installing codex then cursor shares .agents/skills; uninstalling cursor removes only the .mdc and its record", () => {
    const project = mapProject();
    install(project, "codex");
    const cursorInstall = install(project, "cursor");
    expect(paths(cursorInstall, "create")).toEqual([`.cursor/rules/${RULE}.mdc`]);
    expect(paths(cursorInstall, "update")).toEqual([MANIFEST_PATH]);

    const removed = uninstall(project, "cursor");
    expect(paths(removed, "remove")).toEqual([`.cursor/rules/${RULE}.mdc`]);
    expect(removed.items.filter((item) => item.path.startsWith(".agents/skills/")).every((item) => item.change === "unchanged")).toBe(true);
    expect(removed.items.find((item) => item.path.startsWith(".agents/skills/"))?.detail).toBe("still used by codex");
    expect(removed.writes.map((write) => write.rel)).toEqual([`.cursor/rules/${RULE}.mdc`]);
    expect(project.files.has("AGENTS.md")).toBe(true);
    const manifest = parseManifest(project.files.get(MANIFEST_PATH) as Buffer);
    expect(manifest.ok && manifest.manifest.files.every((file) => file.clients.join() === "codex")).toBe(true);
    expect(removed.removeDirs).toEqual([".cursor/rules", ".cursor"]);

    const last = uninstall(project, "codex");
    expect(last.manifestAfter).toBeNull();
    expect(project.files.size).toBe(0);
    expect(project.files.has(MANIFEST_PATH)).toBe(false);
  });

  it("two clients of one route share every file and the block", () => {
    const project = mapProject();
    install(project, "codex");
    const second = install(project, "windsurf");
    expect(paths(second, "create")).toEqual([]);
    expect(second.items.filter((item) => item.change === "unchanged").length).toBeGreaterThan(10);
    const first = uninstall(project, "codex");
    expect(first.writes).toEqual([]);
    expect(project.files.has("AGENTS.md")).toBe(true);
    const last = uninstall(project, "windsurf");
    expect(last.writes.length).toBeGreaterThan(0);
    expect(project.files.size).toBe(0);
  });

  it("uninstalling a client that is not installed says so and plans nothing", () => {
    const project = mapProject();
    install(project, "codex");
    const result = plan({ action: "uninstall", client: "cursor", project });
    expect(result.installed).toBe(false);
    expect(result.changes).toBe(0);
    expect(result.writes).toEqual([]);
    expect(result.items.map((item) => item.path)).toEqual([MANIFEST_PATH]);
    expect(plan({ action: "uninstall", client: "codex", project: mapProject() })).toMatchObject({ installed: false, items: [], changes: 0 });
  });

  it("removes only directories the installer created, deepest first, and only when empty", () => {
    const project = mapProject({ ".claude/settings.json": "{}" });
    install(project, "claude-code");
    const removed = uninstall(project, "claude-code");
    expect(removed.removeDirs).not.toContain(".claude");
    expect(removed.removeDirs[removed.removeDirs.length - 1]).toBe(".iris-mcp");
    const depths = removed.removeDirs.map((dir) => dir.split("/").length);
    expect(depths).toEqual([...depths].sort((a, b) => b - a));
    expect(project.files.get(".claude/settings.json")?.toString("utf8")).toBe("{}");
  });

  it("keeps a recorded directory that now holds a foreign file", () => {
    const project = mapProject();
    install(project, "claude-code");
    project.put(".claude/skills/check-system-health/notes.txt", "mine");
    const removed = plan({ action: "uninstall", client: "claude-code", project });
    expect(removed.removeDirs).not.toContain(".claude/skills/check-system-health");
    expect(removed.removeDirs).not.toContain(".claude/skills");
    expect(removed.removeDirs).not.toContain(".claude");
  });
});

describe("hosts: AGENTS.md and GEMINI.md blocks", () => {
  it("appends the block to an existing host, ending an unterminated last line first", () => {
    const project = mapProject({ "AGENTS.md": "# Mine\nlast line" });
    const result = plan({ action: "install", client: "codex", pack: realPack(), project });
    const item = result.items.find((entry) => entry.path === "AGENTS.md");
    expect(item).toEqual({
      path: "AGENTS.md",
      change: "update",
      detail: `end the last line, then add the ${RULE} block at the end`,
    });
    const write = result.writes.find((entry) => entry.rel === "AGENTS.md");
    expect(write?.after?.equals(Buffer.concat([Buffer.from("# Mine\nlast line\n"), PACK_RULE("agents-md", ".md")]))).toBe(true);
    const manifest = parseManifest(result.manifestAfter as Buffer);
    expect(manifest.ok && manifest.manifest.blocks[0]).toMatchObject({ created: false, lineEndingAdded: "\n" });
  });

  it("words an insert into a terminated host and a new file", () => {
    const terminated = plan({ action: "install", client: "codex", pack: realPack(), project: mapProject({ "AGENTS.md": "# Mine\n" }) });
    expect(terminated.items.find((entry) => entry.path === "AGENTS.md")?.detail).toBe(`add the ${RULE} block at the end`);
    const fresh = plan({ action: "install", client: "codex", pack: realPack(), project: mapProject() });
    expect(fresh.items.find((entry) => entry.path === "AGENTS.md")).toEqual({
      path: "AGENTS.md",
      change: "create",
      detail: `a new file holding the ${RULE} block`,
    });
  });

  it("replaces an edited block, naming its lines, and treats an unrecorded identical block as adopted", () => {
    const edited = Buffer.concat([Buffer.from("top\n"), sectionOf(RULE, "old body"), Buffer.from("bottom\n")]);
    const replaced = plan({ action: "install", client: "codex", pack: realPack(), project: mapProject({ "AGENTS.md": edited }) });
    expect(replaced.items.find((entry) => entry.path === "AGENTS.md")).toEqual({
      path: "AGENTS.md",
      change: "update",
      detail: `replace the ${RULE} block, lines 2-4`,
    });
    const bytes = replaced.writes.find((entry) => entry.rel === "AGENTS.md")?.after as Buffer;
    expect(bytes.subarray(0, 4).toString("utf8")).toBe("top\n");
    expect(bytes.subarray(bytes.length - 7).toString("utf8")).toBe("bottom\n");

    const identical = Buffer.concat([Buffer.from("top\n"), PACK_RULE("agents-md", ".md")]);
    const adopted = plan({ action: "install", client: "codex", pack: realPack(), project: mapProject({ "AGENTS.md": identical }) });
    expect(adopted.items.find((entry) => entry.path === "AGENTS.md")?.change).toBe("adopt");
    expect(adopted.writes.some((entry) => entry.rel === "AGENTS.md")).toBe(false);
  });

  it("reports ambiguous own markers as a conflict with the line numbers, on install and uninstall", () => {
    const content = `<!-- IRIS-MCP-RULE:${RULE}:BEGIN -->\n<!-- IRIS-MCP-RULE:${RULE}:BEGIN -->\nx\n<!-- IRIS-MCP-RULE:${RULE}:END -->\n`;
    const expectedDetail = `the ${RULE} markers are not one BEGIN line followed by one END line: BEGIN at line(s) 1, 2, END at line(s) 4; fix them by hand, then re-run`;
    const installed = plan({ action: "install", client: "codex", pack: realPack(), project: mapProject({ "AGENTS.md": content }) });
    expect(installed.conflicts).toEqual([{ path: "AGENTS.md", change: "conflict", detail: expectedDetail }]);
    expect(installed.writes).toEqual([]);

    const project = mapProject();
    install(project, "codex");
    project.put("AGENTS.md", content);
    const removed = plan({ action: "uninstall", client: "codex", project });
    expect(removed.conflicts).toEqual([{ path: "AGENTS.md", change: "conflict", detail: expectedDetail }]);
    expect(removed.writes).toEqual([]);
  });

  it("removes the block, strips the added line ending, and restores the original bytes", () => {
    const original = Buffer.concat([BOM, Buffer.from("# Mine\r\nlast line")]);
    const project = mapProject({ "AGENTS.md": original });
    install(project, "codex");
    const manifest = parseManifest(project.files.get(MANIFEST_PATH) as Buffer);
    expect(manifest.ok && manifest.manifest.blocks[0]?.lineEndingAdded).toBe("\r\n");
    const removed = uninstall(project, "codex");
    expect(removed.items.find((entry) => entry.path === "AGENTS.md")?.detail).toMatch(new RegExp(`^remove the ${RULE} block, lines \\d+-\\d+$`));
    expect(project.files.get("AGENTS.md")?.equals(original)).toBe(true);
  });

  it("deletes a host the installer created, with the golden detail", () => {
    const project = mapProject();
    install(project, "gemini");
    const removed = plan({ action: "uninstall", client: "gemini", project });
    expect(removed.items.find((entry) => entry.path === "GEMINI.md")).toEqual({
      path: "GEMINI.md",
      change: "remove",
      detail: `it holds only the ${RULE} block this installer created`,
    });
    expect(removed.writes.find((entry) => entry.rel === "GEMINI.md")).toMatchObject({ after: null });
  });

  it("refuses a UTF-16 host as a conflict", () => {
    const project = mapProject({ "AGENTS.md": Buffer.from([0xff, 0xfe, 0x41, 0x00]) });
    const result = plan({ action: "install", client: "codex", pack: realPack(), project });
    expect(result.conflicts[0]?.path).toBe("AGENTS.md");
    expect(result.writes).toEqual([]);
  });

  it("never plans a write to CLAUDE.md or any file outside the installer's locations", () => {
    for (const client of ["claude-code", "cursor", "gemini", "codex", "vscode"]) {
      const project = mapProject({ "CLAUDE.md": "# claude\n", ".claude/CLAUDE.md": "x", "CLAUDE.local.md": "y", ".github/copilot-instructions.md": "z" });
      const result = plan({ action: "install", client, pack: realPack(), project });
      for (const write of result.writes) {
        expect(["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md", ".github/copilot-instructions.md"]).not.toContain(write.rel);
        expect(write.rel === "AGENTS.md" || write.rel === "GEMINI.md" || /^\.(claude|agents|cursor)\/(skills|rules)\//.test(write.rel)).toBe(true);
      }
    }
  });
});

describe("notes", () => {
  it("prints N-claude-md for a Claude Code install into a project with a CLAUDE.md, and only then", () => {
    for (const present of ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"]) {
      const result = plan({ action: "install", client: "claude-code", pack: realPack(), project: mapProject({ [present]: "x" }) });
      expect(result.notes).toEqual([NOTE_CLAUDE_MD]);
    }
    expect(plan({ action: "install", client: "claude-code", pack: realPack(), project: mapProject() }).notes).toEqual([]);
    expect(plan({ action: "install", client: "codex", pack: realPack(), project: mapProject({ "CLAUDE.md": "x" }) }).notes).not.toContain(NOTE_CLAUDE_MD);
    expect(NOTE_CLAUDE_MD).toContain("add the line @AGENTS.md to CLAUDE.md");
  });

  it("prints N-first-match when the run creates AGENTS.md in a project that has a CLAUDE.md", () => {
    const shadow = plan({ action: "install", client: "codex", pack: realPack(), project: mapProject({ "CLAUDE.md": "x" }) });
    expect(shadow.notes).toEqual([firstMatchNote()]);
    const existing = plan({ action: "install", client: "codex", pack: realPack(), project: mapProject({ "CLAUDE.md": "x", "AGENTS.md": "y\n" }) });
    expect(existing.notes).toEqual([]);
    const gemini = plan({ action: "install", client: "gemini", pack: realPack(), project: mapProject({ "CLAUDE.md": "x" }) });
    expect(gemini.notes.some((note) => note.includes("stop reading CLAUDE.md"))).toBe(false);
  });

  it("carries a client's static notes after the dynamic ones", () => {
    const result = plan({ action: "install", client: "pi", pack: realPack(), project: mapProject({ "CLAUDE.md": "x" }) });
    expect(result.notes).toEqual([firstMatchNote(), ...(packTargetFor("pi")?.notes ?? [])]);
  });

  it("prints no notes on uninstall", () => {
    const project = mapProject({ "CLAUDE.md": "x" });
    install(project, "claude-code");
    expect(plan({ action: "uninstall", client: "claude-code", project }).notes).toEqual([]);
  });
});

describe("the observed snapshot and the preview", () => {
  it("records the hash of every path the plan read, absent paths as null", () => {
    const project = mapProject({ "AGENTS.md": "mine\n" });
    const result = plan({ action: "install", client: "codex", pack: realPack(), project });
    const byRel = new Map(result.observed.map((entry) => [entry.rel, entry.sha256]));
    expect(byRel.get("AGENTS.md")).toBe(sha(Buffer.from("mine\n")));
    expect(byRel.get(MANIFEST_PATH)).toBeNull();
  });

  it("renders one padded line per path, the counts line and the notes", () => {
    expect(renderPlanItem({ path: "AGENTS.md", change: "conflict", detail: "why" })).toBe("  conflict  AGENTS.md (why)");
    expect(renderPlanItem({ path: "a/b", change: "create" })).toBe("  create    a/b");
    expect(renderPlanItem({ path: "a/b", change: "unchanged" })).toBe("  unchanged a/b");
    expect(renderCounts({ create: 1, update: 2, remove: 3, adopt: 4, unchanged: 5, keep: 6, conflict: 7 })).toBe(
      "1 to create, 2 to update, 3 to remove, 4 to adopt, 5 unchanged, 6 kept, 7 conflict(s).",
    );
    const result = plan({ action: "install", client: "claude-code", pack: realPack(), project: mapProject({ "CLAUDE.md": "x" }) });
    const text = renderPlanPreview(result, "/p");
    const lines = text.split("\n");
    expect(lines[0]).toBe("Skills pack install for Claude Code in /p:");
    expect(lines[lines.length - 4]).toBe(renderCounts(result.counts));
    expect(lines[lines.length - 3]).toBe("Notes:");
    expect(lines[lines.length - 2]).toBe(`  - ${NOTE_CLAUDE_MD}`);
    expect(text).not.toContain("edited by the user");
  });
});

describe("the pack loader", () => {
  it("loads the shipped pack: every skill file, three forms of the rule, the notice", () => {
    const pack = realPack();
    expect([...pack.skills.keys()].sort()).toEqual(PACK_SKILL_FILES);
    expect(pack.rules.map((rule) => rule.stem)).toEqual([RULE]);
    expect(pack.rules[0]?.claudeCode.equals(PACK_RULE("claude-code", ".md"))).toBe(true);
    expect(pack.rules[0]?.cursor.equals(PACK_RULE("cursor", ".mdc"))).toBe(true);
    expect(pack.rules[0]?.agentsMd.equals(PACK_RULE("agents-md", ".md"))).toBe(true);
    expect(pack.notice.equals(PACK_NOTICE)).toBe(true);
  });

  it("refuses a missing pack", () => {
    const sandbox = makeSandbox();
    const result = loadPack(path.join(sandbox.root, "no-such-pack"));
    expect(result.ok).toBe(false);
  });

  it("refuses a pack without the notice, with a rule missing a form, or with an invalid section", () => {
    const sandbox = makeSandbox();
    const scratch = path.join(sandbox.root, "pack");
    writeProjectFile(scratch, "skills/a/SKILL.md", "---\nname: a\ndescription: d\n---\n");
    expect(loadPack(scratch)).toMatchObject({ ok: false, message: expect.stringContaining(NOTICE_FILENAME) });
    writeProjectFile(scratch, NOTICE_FILENAME, "notice\n");
    expect(loadPack(scratch).ok).toBe(true);
    writeProjectFile(scratch, "rules/claude-code/r.md", "body\n");
    expect(loadPack(scratch)).toMatchObject({ ok: false, message: expect.stringContaining("rules/cursor/r.mdc") });
    writeProjectFile(scratch, "rules/cursor/r.mdc", "---\nalwaysApply: true\n---\n\nbody\n");
    writeProjectFile(scratch, "rules/agents-md/r.md", "body without markers\n");
    expect(loadPack(scratch)).toMatchObject({ ok: false, message: expect.stringContaining("rules/agents-md/r.md") });
    writeProjectFile(scratch, "rules/agents-md/r.md", sectionOf("r", "body"));
    expect(loadPack(scratch).ok).toBe(true);
  });
});

describe("installerPayloads", () => {
  it("returns the four routes, each with its files in path order, the notice beside the SQL skill and the manifest", () => {
    const payloads = installerPayloads();
    expect(payloads.map((payload) => payload.route)).toEqual(["claude-code", "cursor", "gemini", "agents"]);
    for (const payload of payloads) {
      const names = payload.files.map((file) => file.path);
      expect(names).toEqual([...names].sort());
      expect(names).toContain(MANIFEST_PATH);
      const skillsDir = payload.route === "claude-code" ? ".claude/skills" : ".agents/skills";
      const notice = payload.files.find((file) => file.path === `${skillsDir}/iris-mcp-objectscript-sql/${NOTICE_FILENAME}`);
      expect(notice?.bytes.equals(PACK_NOTICE), payload.route).toBe(true);
    }
    expect(payloads.find((payload) => payload.route === "claude-code")?.files.find((file) => file.path === `.claude/rules/${RULE}.md`)?.bytes.equals(PACK_RULE("claude-code", ".md"))).toBe(true);
    expect(payloads.find((payload) => payload.route === "cursor")?.files.find((file) => file.path === `.cursor/rules/${RULE}.mdc`)?.bytes.equals(PACK_RULE("cursor", ".mdc"))).toBe(true);
    expect(payloads.find((payload) => payload.route === "gemini")?.files.find((file) => file.path === "GEMINI.md")?.bytes.equals(PACK_RULE("agents-md", ".md"))).toBe(true);
    expect(payloads.find((payload) => payload.route === "agents")?.files.find((file) => file.path === "AGENTS.md")?.bytes.equals(PACK_RULE("agents-md", ".md"))).toBe(true);
  });

  it("throws when the pack cannot be loaded", () => {
    const sandbox = makeSandbox();
    expect(() => installerPayloads(path.join(sandbox.root, "missing"))).toThrow(/missing/);
  });
});
