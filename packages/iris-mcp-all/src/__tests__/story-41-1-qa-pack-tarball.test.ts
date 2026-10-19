/**
 * Story 41.1 (QA, AC 41.1.1 Integration AC) - the REAL npm tarball of `@iris-mcp/client-config`.
 *
 * `pack-provenance.test.ts` reads npm's `--dry-run` file list. This file builds an actual tarball with the
 * same packer and flags minus `--dry-run` (`npm pack --json --ignore-scripts --offline --pack-destination`),
 * into a temp directory, extracts it there with the system `tar`, and compares what comes out with the
 * committed pack:
 *  - the same files, at `skills-pack/<rel>`, with the same bytes (also the bytes the sources produce);
 *  - the notice at its expected path, with the pinned upstream MIT block;
 *  - no copy of a pack file anywhere else in the tarball;
 *  - nothing written next to the package.
 *
 * The expectations are typed here from the upstream capture; nothing is derived from the notice under test.
 * No network, no IRIS. The tarball and its extraction live under `os.tmpdir()` and are removed in `afterAll`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractLicenseBlock } from "../../../../scripts/lib/provenance-core.mjs";
import { NPM_PACK_ARGS } from "../../../../scripts/lib/provenance-inputs.mjs";
import {
  ALWAYS_ON_RULE_FILENAME,
  assemblePack,
  NOTICE_FILENAME,
  PACK_DIR,
  PACK_SOURCE_DIR,
  RULE_FORM_DIRS,
  RULE_FORM_EXTENSIONS,
  WORKFLOW_SKILLS_DIR,
} from "../../../../scripts/lib/skills-pack.mjs";
import { makeTempRoot, removeTempRoot, REPO_ROOT } from "./pack-fixture";
import { QUIET_NPM_ENV, sha256, walkFiles } from "./story-41-1-qa-fixture";

const PINNED_LICENSE_SHA256 = "85b458dc150c4d17873dd5e73d01cfa23c797997a09d841884e08378242e929c";
const PINNED_LICENSE_BYTES = 1081;
const PACKAGE_DIR = join(REPO_ROOT, "packages", "client-config");

interface PackJson {
  filename: string;
  files: Array<{ path: string }>;
}

let work = "";
let outDir = "";
let extractDir = "";
let packJson: PackJson;
let tarEntries: string[] = [];

function run(command: string, args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...QUIET_NPM_ENV },
    timeout: 120_000,
    shell: process.platform === "win32" && command === "npm",
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

beforeAll(() => {
  work = makeTempRoot("qa-41-1-tarball");
  outDir = join(work, "out");
  extractDir = join(work, "extract");
  mkdirSync(outDir);
  mkdirSync(extractDir);

  // The production flags, minus --dry-run, plus a destination outside the repository.
  const args = [...(NPM_PACK_ARGS as string[]).filter((arg) => arg !== "--dry-run"), "--pack-destination", outDir];
  const packed = run("npm", args, PACKAGE_DIR);
  expect(packed.status, packed.stderr).toBe(0);
  packJson = (JSON.parse(packed.stdout) as PackJson[])[0] as PackJson;

  const tarball = join(outDir, packJson.filename);
  const listed = run("tar", ["-tzf", tarball], work);
  expect(listed.status, listed.stderr).toBe(0);
  tarEntries = listed.stdout.split(/\r?\n/).filter((line) => line !== "" && !line.endsWith("/"));
  const extracted = run("tar", ["-xzf", tarball, "-C", extractDir], work);
  expect(extracted.status, extracted.stderr).toBe(0);
}, 120_000);

afterAll(() => {
  if (work !== "") removeTempRoot(work);
});

describe("the real tarball built by npm pack --ignore-scripts (AC 41.1.1 Integration AC)", () => {
  it("is written to the temp destination only, never next to the package", () => {
    expect(packJson.filename).toMatch(/\.tgz$/);
    expect(readdirSync(outDir)).toEqual([packJson.filename]);
    expect(statSync(join(outDir, packJson.filename)).size).toBeGreaterThan(0);
    expect(existsSync(join(PACKAGE_DIR, packJson.filename))).toBe(false);
    expect(existsSync(join(REPO_ROOT, packJson.filename))).toBe(false);
  });

  it("holds only files under package/, and its tar listing is the file list npm printed", () => {
    expect(tarEntries.length).toBeGreaterThan(0);
    for (const entry of tarEntries) {
      expect(entry.startsWith("package/"), entry).toBe(true);
      expect(entry.includes(".."), entry).toBe(false);
    }
    const listedByTar = tarEntries.map((entry) => entry.slice("package/".length)).sort();
    const listedByNpm = packJson.files.map((file) => file.path).sort();
    expect(listedByTar).toEqual(listedByNpm);
  });

  it("carries every committed pack file at skills-pack/<rel>: the same file set, no extra file", () => {
    const committed = walkFiles(join(REPO_ROOT, PACK_DIR));
    const extracted = walkFiles(join(extractDir, "package", "skills-pack"));
    expect(extracted).toEqual(committed);
    expect(committed.length).toBeGreaterThanOrEqual(19);
  });

  it("carries the notice, the pack README, all three forms of the always-on rule and all 12 workflow SKILL.md files at the expected paths", () => {
    const base = join(extractDir, "package", "skills-pack");
    expect(existsSync(join(base, NOTICE_FILENAME))).toBe(true);
    expect(existsSync(join(base, "README.md"))).toBe(true);
    expect(Object.keys(RULE_FORM_DIRS)).toHaveLength(3);
    for (const [form, dir] of Object.entries(RULE_FORM_DIRS) as Array<[keyof typeof RULE_FORM_EXTENSIONS, string]>) {
      const file = `${ALWAYS_ON_RULE_FILENAME.replace(/\.md$/, "")}${RULE_FORM_EXTENSIONS[form]}`;
      expect(existsSync(join(base, dir, file)), `${dir}/${file}`).toBe(true);
    }
    const workflowSkills = readdirSync(join(REPO_ROOT, WORKFLOW_SKILLS_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(workflowSkills).toHaveLength(12);
    for (const name of workflowSkills) {
      expect(existsSync(join(base, "skills", name, "SKILL.md")), `skills/${name}/SKILL.md`).toBe(true);
    }
    expect(existsSync(join(base, "skills", "objectscript-review")), "the retired prompt's skill is not shipped").toBe(false);
  });

  it("every extracted pack file is byte-identical to the committed pack file", () => {
    for (const rel of walkFiles(join(REPO_ROOT, PACK_DIR))) {
      const committed = readFileSync(join(REPO_ROOT, PACK_DIR, rel));
      const shipped = readFileSync(join(extractDir, "package", "skills-pack", rel));
      expect(shipped.equals(committed), `${rel} is byte-identical in the tarball`).toBe(true);
    }
  });

  it("every extracted pack file is also byte-identical to what the sources produce", () => {
    const expected = assemblePack(REPO_ROOT) as Map<string, Buffer>;
    expect([...expected.keys()].sort()).toEqual(walkFiles(join(extractDir, "package", "skills-pack")));
    for (const [rel, bytes] of expected) {
      const shipped = readFileSync(join(extractDir, "package", "skills-pack", rel));
      expect(shipped.equals(bytes), `${rel} equals its assembled source bytes`).toBe(true);
    }
  });

  it("the shipped notice is the source notice, and its MIT block is the pinned upstream LICENSE", () => {
    const shipped = readFileSync(join(extractDir, "package", "skills-pack", NOTICE_FILENAME));
    expect(shipped.equals(readFileSync(join(REPO_ROOT, PACK_SOURCE_DIR, NOTICE_FILENAME)))).toBe(true);
    const block = extractLicenseBlock(shipped) as Buffer | null;
    expect(block, "the MIT block is found in the shipped notice").not.toBeNull();
    expect(block?.length).toBe(PINNED_LICENSE_BYTES);
    expect(sha256(block as Buffer)).toBe(PINNED_LICENSE_SHA256);
  });

  it("no copy of a pack file ships anywhere else in the tarball", () => {
    const packHashes = new Map<string, string>();
    for (const rel of walkFiles(join(REPO_ROOT, PACK_DIR))) {
      packHashes.set(sha256(readFileSync(join(REPO_ROOT, PACK_DIR, rel))), rel);
    }
    const outside = walkFiles(join(extractDir, "package")).filter((rel) => !rel.startsWith("skills-pack/"));
    expect(outside.length).toBeGreaterThan(0);
    for (const rel of outside) {
      const hash = sha256(readFileSync(join(extractDir, "package", rel)));
      expect(packHashes.get(hash), `${rel} is not a copy of a pack file`).toBeUndefined();
    }
  });
});
