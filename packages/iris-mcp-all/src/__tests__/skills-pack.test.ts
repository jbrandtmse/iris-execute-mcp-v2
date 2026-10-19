/**
 * Story 41.1 (AC 41.1.1) - the skills pack build: `scripts/lib/skills-pack.mjs` assembles
 * `packages/client-config/skills-pack/` from `skills/` (generated) and `skills-pack-src/` (hand-authored),
 * `scripts/lib/generated-tree.mjs` synchronises the tree, and `scripts/gen-pack.mjs` is the CLI over both.
 *
 * Three layers, none of which needs IRIS or the network:
 *  - fixture roots under the OS temp directory (the layout rules, the failure rows, byte preservation);
 *  - the real CLI run from a copy of the scripts inside such a root (write mode, idempotence, refusals);
 *  - the real tree: the committed pack equals what its sources produce, and the real CLIs react to a
 *    temporary stray file and a temporary hand-authored knowledge skill (both removed in `finally`).
 *
 * The real-tree probes are placed through the layout constants, never through literal paths.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { diffTree, listFilesRecursive, writeTree } from "../../../../scripts/lib/generated-tree.mjs";
import {
  assemblePack,
  KNOWLEDGE_SOURCE_DIR,
  NOTICE_FILENAME,
  PACK_DIR,
  PACK_SOURCE_DIR,
  RULES_SOURCE_DIR,
  WORKFLOW_SKILLS_DIR,
} from "../../../../scripts/lib/skills-pack.mjs";
import { makeTempRoot, put, removeTempRoot, REPO_ROOT, runNode } from "./pack-fixture";

const NOTICE_TEXT = "# notice\n";

/** The minimum a root needs for `assemblePack` to succeed: the notice. */
function seedMinimalRoot(root: string): void {
  put(root, `${PACK_SOURCE_DIR}/${NOTICE_FILENAME}`, NOTICE_TEXT);
}

const roots: string[] = [];
function tempRoot(): string {
  const root = makeTempRoot("skills-pack-test");
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) removeTempRoot(root);
});

describe("assemblePack layout (fixture roots)", () => {
  it("maps workflow skills, knowledge skills, rules and the notice into the plugin layout", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    put(root, `${WORKFLOW_SKILLS_DIR}/README.md`, "not part of the pack\n");
    put(root, `${WORKFLOW_SKILLS_DIR}/wf/SKILL.md`, "workflow skill\n");
    put(root, `${WORKFLOW_SKILLS_DIR}/wf/extra.md`, "workflow extra\n");
    put(root, `${KNOWLEDGE_SOURCE_DIR}/k1/SKILL.md`, "knowledge skill\n");
    put(root, `${KNOWLEDGE_SOURCE_DIR}/k1/references/x.md`, "reference\n");
    put(root, `${RULES_SOURCE_DIR}/always.md`, "rule\n");
    put(root, `${RULES_SOURCE_DIR}/nested/form.md`, "rule form\n");
    put(root, `${PACK_SOURCE_DIR}/README.md`, "contributor doc, never copied\n");

    const pack = assemblePack(root) as Map<string, Buffer>;

    expect([...pack.keys()].sort()).toEqual([
      NOTICE_FILENAME,
      "README.md",
      "rules/always.md",
      "rules/nested/form.md",
      "skills/k1/SKILL.md",
      "skills/k1/references/x.md",
      "skills/wf/SKILL.md",
      "skills/wf/extra.md",
    ].sort());
    expect(pack.get(NOTICE_FILENAME)?.toString("utf8")).toBe(NOTICE_TEXT);
    const readme = pack.get("README.md")?.toString("utf8") ?? "";
    expect(readme.startsWith("<!-- DO NOT EDIT")).toBe(true);
    expect(readme).toContain("pnpm gen:pack");
    expect(readme).toContain(NOTICE_FILENAME);
    expect(readme).not.toContain("contributor doc");
  });

  it("counts a missing knowledge/ or rules/ directory as empty", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    expect([...(assemblePack(root) as Map<string, Buffer>).keys()].sort()).toEqual([NOTICE_FILENAME, "README.md"].sort());
  });

  it("fails when a skill name is defined in both sources, naming both", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    put(root, `${WORKFLOW_SKILLS_DIR}/dup/SKILL.md`, "workflow\n");
    put(root, `${KNOWLEDGE_SOURCE_DIR}/dup/SKILL.md`, "knowledge\n");
    expect(() => assemblePack(root)).toThrowError(
      new RegExp(`skill name collision.*${WORKFLOW_SKILLS_DIR}/dup/.*${KNOWLEDGE_SOURCE_DIR}/dup/`),
    );
  });

  it.each([
    ["a file at the top level", () => ({ rel: `${PACK_SOURCE_DIR}/NOTES.md`, content: "x" }), "NOTES.md"],
    ["a directory at the top level", () => ({ rel: `${PACK_SOURCE_DIR}/extras/a.md`, content: "x" }), "extras"],
    ["a knowledge directory without SKILL.md", () => ({ rel: `${KNOWLEDGE_SOURCE_DIR}/k2/other.md`, content: "x" }), "k2"],
    ["a knowledge directory whose skill file is skill.md, not SKILL.md", () => ({ rel: `${KNOWLEDGE_SOURCE_DIR}/k3/skill.md`, content: "x" }), "k3"],
    ["a file directly in knowledge/", () => ({ rel: `${KNOWLEDGE_SOURCE_DIR}/stray.md`, content: "x" }), "stray.md"],
  ])("fails on an unknown entry: %s", (_name, probe, entry) => {
    const root = tempRoot();
    seedMinimalRoot(root);
    const { rel, content } = probe();
    put(root, rel, content);
    expect(() => assemblePack(root)).toThrowError(entry);
  });

  it("fails when the notice is missing", () => {
    const root = tempRoot();
    put(root, `${RULES_SOURCE_DIR}/r.md`, "rule\n");
    expect(() => assemblePack(root)).toThrowError(NOTICE_FILENAME);
  });
});

describe("byte preservation (fixture roots)", () => {
  // Non-canonical variants: CRLF, a BOM, no trailing newline, non-ASCII UTF-8 (bytes, not escapes), and a
  // byte sequence that is not valid UTF-8 at all. A copy that decodes and re-encodes changes the last two.
  const variants: Record<string, Buffer> = {
    crlf: Buffer.from("---\r\nname: crlf\r\n---\r\n\r\nline one\r\nline two\r\n", "utf8"),
    bom: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("---\nname: bom\n---\nbody\n", "utf8")]),
    noTrailingNewline: Buffer.from("no trailing newline", "utf8"),
    nonAscii: Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9, 0x20, 0xe2, 0x80, 0x94, 0x20, 0xc2, 0xa9, 0x20, 0xf0, 0x9f, 0x98, 0x80, 0x0a]),
    invalidUtf8: Buffer.from([0x61, 0xff, 0xfe, 0x62, 0x0a]),
  };

  it("copies every source byte for byte into the assembled pack and onto disk", () => {
    const root = tempRoot();
    seedMinimalRoot(root);
    const expectedBytes = new Map<string, Buffer>();
    for (const [key, bytes] of Object.entries(variants)) {
      put(root, `${WORKFLOW_SKILLS_DIR}/wf/${key}.md`, bytes);
      put(root, `${KNOWLEDGE_SOURCE_DIR}/kn/${key}.md`, bytes);
      put(root, `${RULES_SOURCE_DIR}/${key}.md`, bytes);
      expectedBytes.set(`skills/wf/${key}.md`, bytes);
      expectedBytes.set(`skills/kn/${key}.md`, bytes);
      expectedBytes.set(`rules/${key}.md`, bytes);
    }
    put(root, `${WORKFLOW_SKILLS_DIR}/wf/SKILL.md`, "wf\n");
    put(root, `${KNOWLEDGE_SOURCE_DIR}/kn/SKILL.md`, "kn\n");

    const pack = assemblePack(root) as Map<string, Buffer>;
    for (const [rel, bytes] of expectedBytes) {
      const copy = pack.get(rel);
      expect(Buffer.isBuffer(copy), `${rel} is a Buffer`).toBe(true);
      expect(copy?.equals(bytes), `${rel} is byte-identical in the assembled pack`).toBe(true);
    }

    const packDir = join(root, PACK_DIR);
    writeTree(pack, packDir);
    for (const [rel, bytes] of expectedBytes) {
      expect(readFileSync(join(packDir, rel)).equals(bytes), `${rel} is byte-identical on disk`).toBe(true);
    }
    expect(diffTree(pack, packDir)).toEqual({ missing: [], drift: [], stray: [] });
  });
});

describe("tree synchronisation (fixture roots)", () => {
  it("diffTree reports missing, drifted and stray files; writeTree repairs all three and prunes empty directories", () => {
    const root = tempRoot();
    const dir = join(root, "tree");
    const expected = new Map<string, Buffer | string>([
      ["a.md", "alpha\n"],
      ["sub/b.md", Buffer.from("beta\n")],
      ["sub/c.md", "gamma\n"],
    ]);
    put(dir, "a.md", "alpha\n");
    put(dir, "sub/b.md", "changed\n");
    put(dir, "stray/deep/z.md", "stray\n");

    expect(diffTree(expected, dir)).toEqual({ missing: ["sub/c.md"], drift: ["sub/b.md"], stray: ["stray/deep/z.md"] });

    expect(writeTree(expected, dir)).toEqual(["stray/deep/z.md"]);
    expect(existsSync(join(dir, "stray"))).toBe(false);
    expect(existsSync(dir)).toBe(true);
    expect(diffTree(expected, dir)).toEqual({ missing: [], drift: [], stray: [] });
    expect(listFilesRecursive(dir)).toEqual(["a.md", "sub/b.md", "sub/c.md"]);
  });

  it("writeTree leaves an up-to-date file untouched", () => {
    const root = tempRoot();
    const dir = join(root, "tree");
    const abs = put(dir, "a.md", "alpha\n");
    utimesSync(abs, 1, 1);
    writeTree(new Map([["a.md", "alpha\n"]]), dir);
    expect(statSync(abs).mtimeMs).toBe(1000);
  });

  it("listFilesRecursive of a missing directory is empty", () => {
    expect(listFilesRecursive(join(tempRoot(), "nope"))).toEqual([]);
  });
});

describe("gen-pack CLI (a copy of the scripts inside a fixture root)", () => {
  const SCRIPT_FILES = ["scripts/gen-pack.mjs", "scripts/lib/generated-tree.mjs", "scripts/lib/skills-pack.mjs"];

  function cliRoot(): string {
    const root = tempRoot();
    for (const rel of SCRIPT_FILES) put(root, rel, readFileSync(join(REPO_ROOT, rel)));
    seedMinimalRoot(root);
    put(root, `${WORKFLOW_SKILLS_DIR}/wf/SKILL.md`, "workflow\n");
    put(root, `${KNOWLEDGE_SOURCE_DIR}/kn/SKILL.md`, "knowledge\n");
    put(root, `${RULES_SOURCE_DIR}/rule.md`, "rule\n");
    return root;
  }

  it("write mode builds the pack, and a second run changes nothing", () => {
    const root = cliRoot();
    const first = runNode(root, "scripts/gen-pack.mjs");
    expect(first.status, first.stderr).toBe(0);
    const packDir = join(root, PACK_DIR);
    expect(listFilesRecursive(packDir)).toEqual(
      [NOTICE_FILENAME, "README.md", "rules/rule.md", "skills/kn/SKILL.md", "skills/wf/SKILL.md"].sort(),
    );

    const files = listFilesRecursive(packDir);
    for (const rel of files) utimesSync(join(packDir, rel), 1, 1);
    const second = runNode(root, "scripts/gen-pack.mjs");
    expect(second.status, second.stderr).toBe(0);
    for (const rel of files) {
      expect(statSync(join(packDir, rel)).mtimeMs, `${rel} was not rewritten`).toBe(1000);
    }

    const check = runNode(root, "scripts/gen-pack.mjs", ["--check"]);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain("OK");
  });

  it("--check names DRIFT and STRAY and exits 1; write mode restores the file and removes the stray", () => {
    const root = cliRoot();
    expect(runNode(root, "scripts/gen-pack.mjs").status).toBe(0);
    const packDir = join(root, PACK_DIR);
    put(packDir, "skills/kn/SKILL.md", "hand edited\n");
    put(packDir, "skills/kn/NOTES.md", "stray\n");

    const check = runNode(root, "scripts/gen-pack.mjs", ["--check"]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("DRIFT");
    expect(check.stderr).toContain("skills/kn/SKILL.md");
    expect(check.stderr).toContain("STRAY");
    expect(check.stderr).toContain("skills/kn/NOTES.md");
    expect(readFileSync(join(packDir, "skills/kn/SKILL.md"), "utf8")).toBe("hand edited\n");

    expect(runNode(root, "scripts/gen-pack.mjs").status).toBe(0);
    expect(readFileSync(join(packDir, "skills/kn/SKILL.md"), "utf8")).toBe("knowledge\n");
    expect(existsSync(join(packDir, "skills/kn/NOTES.md"))).toBe(false);
  });

  it("--check names MISSING for an absent pack file", () => {
    const root = cliRoot();
    const check = runNode(root, "scripts/gen-pack.mjs", ["--check"]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("MISSING");
    expect(check.stderr).toContain("skills/kn/SKILL.md");
  });

  it("exits 1 on a name collision, naming both sources, and writes nothing", () => {
    const root = cliRoot();
    put(root, `${KNOWLEDGE_SOURCE_DIR}/wf/SKILL.md`, "collides with the workflow skill\n");
    const run = runNode(root, "scripts/gen-pack.mjs");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${WORKFLOW_SKILLS_DIR}/wf/`);
    expect(run.stderr).toContain(`${KNOWLEDGE_SOURCE_DIR}/wf/`);
    expect(existsSync(join(root, PACK_DIR))).toBe(false);
  });

  it("exits 1 on an unknown source entry, naming it, and writes nothing", () => {
    const root = cliRoot();
    put(root, `${PACK_SOURCE_DIR}/NOTES.md`, "x\n");
    const run = runNode(root, "scripts/gen-pack.mjs");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("NOTES.md");
    expect(existsSync(join(root, PACK_DIR))).toBe(false);
  });
});

describe("the committed pack (real tree)", () => {
  const packDir = join(REPO_ROOT, PACK_DIR);

  it("committed pack matches its sources: no missing, drifted or stray file", () => {
    const diff = diffTree(assemblePack(REPO_ROOT), packDir);
    expect(diff).toEqual({ missing: [], drift: [], stray: [] });
  });

  it("holds the notice, the README and one SKILL.md per workflow skill", () => {
    const files = new Set(listFilesRecursive(packDir));
    expect(files.has(NOTICE_FILENAME)).toBe(true);
    expect(files.has("README.md")).toBe(true);
    const workflowSkills = listFilesRecursive(join(REPO_ROOT, WORKFLOW_SKILLS_DIR)).filter((rel) => rel.endsWith("/SKILL.md"));
    expect(workflowSkills).toHaveLength(13);
    for (const rel of workflowSkills) {
      expect(files.has(`skills/${rel}`), `skills/${rel}`).toBe(true);
    }
  });

  it("gen-pack --check passes on the committed tree", () => {
    const run = runNode(REPO_ROOT, "scripts/gen-pack.mjs", ["--check"]);
    expect(run.status, run.stderr).toBe(0);
  });

  it("gen-pack --check fails on a temporary stray pack file, naming it", () => {
    const stray = join(packDir, "zz-stray-probe.md");
    put(packDir, "zz-stray-probe.md", "not a generated file\n");
    try {
      const run = runNode(REPO_ROOT, "scripts/gen-pack.mjs", ["--check"]);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("STRAY");
      expect(run.stderr).toContain("zz-stray-probe.md");
    } finally {
      rmSync(stray, { force: true });
    }
  });

  describe("with a temporary hand-authored knowledge skill", () => {
    const knowledgeDir = join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR);
    const probeName = "zz-probe-skill";

    /** Place the probe skill through the layout constant; returns the cleanup. */
    function placeProbe(): () => void {
      const existed = existsSync(knowledgeDir);
      put(REPO_ROOT, `${KNOWLEDGE_SOURCE_DIR}/${probeName}/SKILL.md`, "---\nname: zz-probe-skill\n---\n\nProbe.\n");
      return () => rmSync(existed ? join(knowledgeDir, probeName) : knowledgeDir, { recursive: true, force: true });
    }

    it("gen:skills --check still passes: skills/ is gen:skills output and never sees a hand-authored skill", () => {
      const cleanup = placeProbe();
      try {
        const run = runNode(REPO_ROOT, "scripts/gen-skills.mjs", ["--check"]);
        expect(run.status, `${run.stderr}${run.stdout}`).toBe(0);
      } finally {
        cleanup();
      }
    });

    it("gen:pack --check fails on it until the pack is regenerated, naming the missing pack file", () => {
      const cleanup = placeProbe();
      try {
        const run = runNode(REPO_ROOT, "scripts/gen-pack.mjs", ["--check"]);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain("MISSING");
        expect(run.stderr).toContain(`skills/${probeName}/SKILL.md`);
      } finally {
        cleanup();
      }
      expect(existsSync(join(knowledgeDir, probeName))).toBe(false);
    });
  });
});
