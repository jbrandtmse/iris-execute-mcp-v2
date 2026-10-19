/**
 * Story 41.1 (QA, AC 41.1.1) - `gen:pack`, `gen:pack:check` and `gen:skills:check` as real processes against
 * a SCRATCH COPY of the real tree (the real `scripts/`, `skills/`, `skills-pack-src/` and committed pack, copied
 * under `os.tmpdir()`). Nothing in the working tree is edited.
 *
 * What the fixture-root tests in `skills-pack.test.ts` do not reach:
 *  - the real 12-skill data set: every fault kind is injected into the real pack, detected by `--check` with
 *    no write, and write mode restores the committed pack exactly (files and directories);
 *  - byte-level faults a text comparison would miss: LF to CRLF, a BOM added or removed, one trailing LF,
 *    Unicode normalisation, an invalid UTF-8 sequence (project rule #58, fixture diversity);
 *  - source-side changes (a CRLF or BOM workflow skill, a changed notice) reach the pack byte for byte;
 *  - `gen:skills` never sees a hand-authored pack source, while the same file inside `skills/` is stale.
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALWAYS_ON_RULE_FILENAME,
  KNOWLEDGE_SOURCE_DIR,
  NOTICE_FILENAME,
  PACK_DIR,
  PACK_SOURCE_DIR,
  RULE_FORM_DIRS,
  RULES_SOURCE_DIR,
  WORKFLOW_SKILLS_DIR,
} from "../../../../scripts/lib/skills-pack.mjs";
import { put, REPO_ROOT } from "./pack-fixture";
import {
  BOM,
  flipMiddleByte,
  makeScratchRepo,
  removeScratchRepo,
  runScript,
  type ScratchOptions,
  toCrlf,
  treeLines,
  walkFiles,
} from "./story-41-1-qa-fixture";

const REAL_PACK = join(REPO_ROOT, PACK_DIR);
const REAL_SKILLS = join(REPO_ROOT, WORKFLOW_SKILLS_DIR);
const CHECK_SKILL = "skills/check-system-health/SKILL.md";
const GEN_PACK = "scripts/gen-pack.mjs";
const GEN_SKILLS = "scripts/gen-skills.mjs";

const scratches: string[] = [];
function scratch(options?: ScratchOptions): string {
  const root = makeScratchRepo(options);
  scratches.push(root);
  return root;
}
afterEach(() => {
  for (const root of scratches.splice(0)) removeScratchRepo(root);
});

function mutate(abs: string, change: (bytes: Buffer) => Buffer): void {
  writeFileSync(abs, change(readFileSync(abs)));
}

interface PackFault {
  name: string;
  apply: (pack: string) => void;
  /** Complete diagnostics the `--check` stderr must contain. */
  stderr: string[];
}

const stray = (rel: string): string => `STRAY generated file (no source): ${PACK_DIR}/${rel}`;
const missing = (rel: string): string => `MISSING generated file: ${PACK_DIR}/${rel}`;
const drift = (rel: string): string => `DRIFT in ${PACK_DIR}/${rel}`;

const PACK_FAULTS: PackFault[] = [
  { name: "a stray file at the pack root", apply: (pack) => put(pack, "zz-stray.md", "x\n"), stderr: [stray("zz-stray.md")] },
  {
    name: "a stray file inside a skill directory",
    apply: (pack) => put(pack, "skills/check-system-health/NOTES.md", "x\n"),
    stderr: [stray("skills/check-system-health/NOTES.md")],
  },
  {
    name: "a stray directory holding a whole skill",
    apply: (pack) => put(pack, "skills/zz-ghost/SKILL.md", "x\n"),
    stderr: [stray("skills/zz-ghost/SKILL.md")],
  },
  {
    name: "a deleted skill file",
    apply: (pack) => rmSync(join(pack, "skills/diagnose-slow-query/SKILL.md")),
    stderr: [missing("skills/diagnose-slow-query/SKILL.md")],
  },
  {
    name: "a deleted skill directory",
    apply: (pack) => rmSync(join(pack, "skills/trace-message-flow"), { recursive: true }),
    stderr: [missing("skills/trace-message-flow/SKILL.md")],
  },
  {
    name: "a deleted notice",
    apply: (pack) => rmSync(join(pack, NOTICE_FILENAME)),
    stderr: [missing(NOTICE_FILENAME)],
  },
  {
    name: "one changed byte in a skill",
    apply: (pack) => mutate(join(pack, CHECK_SKILL), flipMiddleByte),
    stderr: [drift(CHECK_SKILL)],
  },
  {
    name: "one changed byte in the generated README",
    apply: (pack) => mutate(join(pack, "README.md"), flipMiddleByte),
    stderr: [drift("README.md")],
  },
  {
    name: "a deleted rule form",
    apply: (pack) => rmSync(join(pack, RULE_FORM_DIRS.agentsMd, ALWAYS_ON_RULE_FILENAME)),
    stderr: [missing(`${RULE_FORM_DIRS.agentsMd}/${ALWAYS_ON_RULE_FILENAME}`)],
  },
  {
    name: "one changed byte in the AGENTS.md section form",
    apply: (pack) => mutate(join(pack, RULE_FORM_DIRS.agentsMd, ALWAYS_ON_RULE_FILENAME), flipMiddleByte),
    stderr: [drift(`${RULE_FORM_DIRS.agentsMd}/${ALWAYS_ON_RULE_FILENAME}`)],
  },
  {
    name: "a stray rule form",
    apply: (pack) => put(pack, `${RULE_FORM_DIRS.claudeCode}/zz-ghost.md`, "x\n"),
    stderr: [stray(`${RULE_FORM_DIRS.claudeCode}/zz-ghost.md`)],
  },
  {
    name: "a file truncated to zero bytes",
    apply: (pack) => writeFileSync(join(pack, CHECK_SKILL), Buffer.alloc(0)),
    stderr: [drift(CHECK_SKILL)],
  },
  {
    name: "every LF converted to CRLF",
    apply: (pack) => mutate(join(pack, CHECK_SKILL), toCrlf),
    stderr: [drift(CHECK_SKILL)],
  },
  {
    name: "a BOM added",
    apply: (pack) => mutate(join(pack, CHECK_SKILL), (bytes) => Buffer.concat([BOM, bytes])),
    stderr: [drift(CHECK_SKILL)],
  },
  {
    name: "the final LF removed",
    apply: (pack) => mutate(join(pack, CHECK_SKILL), (bytes) => bytes.subarray(0, bytes.length - 1)),
    stderr: [drift(CHECK_SKILL)],
  },
];

describe("gen:pack against a scratch copy of the real tree: the clean baseline", () => {
  it("--check passes, and a write run rewrites no file", () => {
    const root = scratch();
    const check = runScript(root, GEN_PACK, ["--check"]);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain("19 pack file(s) match their sources");

    const pack = join(root, PACK_DIR);
    for (const rel of walkFiles(pack)) utimesSync(join(pack, rel), 1, 1);
    const before = treeLines(root);
    const write = runScript(root, GEN_PACK);
    expect(write.status, write.stderr).toBe(0);
    expect(treeLines(root)).toEqual(before);
    for (const rel of walkFiles(pack)) {
      expect(statSync(join(pack, rel)).mtimeMs, `${rel} was not rewritten`).toBe(1000);
    }
  });
});

describe("gen:pack against a scratch copy of the real tree: pack-side faults", () => {
  it.each(PACK_FAULTS.map((fault) => [fault.name, fault] as const))(
    "%s: --check names it and writes nothing; write mode restores the committed pack exactly",
    (_name, fault) => {
      const root = scratch();
      const pack = join(root, PACK_DIR);
      fault.apply(pack);
      expect(treeLines(pack), "the fault changed the pack").not.toEqual(treeLines(REAL_PACK));

      const before = treeLines(root);
      const check = runScript(root, GEN_PACK, ["--check"]);
      expect(check.status, check.stdout).toBe(1);
      for (const diagnostic of fault.stderr) expect(check.stderr).toContain(diagnostic);
      expect(treeLines(root), "--check wrote nothing").toEqual(before);

      const write = runScript(root, GEN_PACK);
      expect(write.status, write.stderr).toBe(0);
      expect(treeLines(pack), "files and directories equal the committed pack").toEqual(treeLines(REAL_PACK));

      const again = runScript(root, GEN_PACK, ["--check"]);
      expect(again.status, again.stderr).toBe(0);
    },
  );

  // On a case-insensitive file system (macOS, Windows) the renamed entry aliases the expected one; on a
  // case-sensitive one it is a plain stray beside a missing file. Either way --check names the stray and
  // write mode must leave exactly the committed pack, letter case included.
  it.each([
    ["a pack file", CHECK_SKILL, "skills/check-system-health/skill.md", "skills/check-system-health/skill.md"],
    ["a skill directory", "skills/check-system-health", "skills/Check-System-Health", "skills/Check-System-Health/SKILL.md"],
  ])("%s whose name differs only in letter case: --check names the stray, and write mode restores the committed pack exactly", (_name, from, to, strayRel) => {
    const root = scratch();
    const pack = join(root, PACK_DIR);
    renameSync(join(pack, from), join(pack, to));
    const check = runScript(root, GEN_PACK, ["--check"]);
    expect(check.status, check.stdout).toBe(1);
    expect(check.stderr).toContain(stray(strayRel));

    const write = runScript(root, GEN_PACK);
    expect(write.status, write.stderr).toBe(0);
    expect(treeLines(pack), "files and directories equal the committed pack, letter case included").toEqual(treeLines(REAL_PACK));
    expect(runScript(root, GEN_PACK, ["--check"]).status).toBe(0);
  });
});

describe("gen:pack against a scratch copy of the real tree: source-side changes", () => {
  it.each([
    ["the notice source with one byte changed", `${PACK_SOURCE_DIR}/${NOTICE_FILENAME}`, NOTICE_FILENAME, flipMiddleByte],
    ["a workflow skill converted to CRLF", `${WORKFLOW_SKILLS_DIR}/check-system-health/SKILL.md`, CHECK_SKILL, toCrlf],
    ["a workflow skill with a BOM", `${WORKFLOW_SKILLS_DIR}/check-system-health/SKILL.md`, CHECK_SKILL, (bytes: Buffer) => Buffer.concat([BOM, bytes])],
  ])("%s: --check reports DRIFT in the pack copy, and write mode copies the new source bytes unchanged", (_name, sourceRel, packRel, change) => {
    const root = scratch();
    mutate(join(root, sourceRel), change as (bytes: Buffer) => Buffer);
    const sourceBytes = readFileSync(join(root, sourceRel));

    const check = runScript(root, GEN_PACK, ["--check"]);
    expect(check.status, check.stdout).toBe(1);
    expect(check.stderr).toContain(drift(packRel));

    const write = runScript(root, GEN_PACK);
    expect(write.status, write.stderr).toBe(0);
    expect(readFileSync(join(root, PACK_DIR, packRel)).equals(sourceBytes), "the pack copy equals the source byte for byte").toBe(true);
    expect(runScript(root, GEN_PACK, ["--check"]).status).toBe(0);
  });

  it("a knowledge skill named like a real workflow skill is refused naming both sources, in write and check mode, and nothing is written", () => {
    const root = scratch();
    put(root, `${KNOWLEDGE_SOURCE_DIR}/check-system-health/SKILL.md`, "---\nname: check-system-health\n---\n\nCollides.\n");
    const before = treeLines(root);

    for (const args of [[], ["--check"]]) {
      const run = runScript(root, GEN_PACK, args);
      expect(run.status, `gen-pack ${args.join(" ")}`).toBe(1);
      expect(run.stderr).toContain(`${WORKFLOW_SKILLS_DIR}/check-system-health/`);
      expect(run.stderr).toContain(`${KNOWLEDGE_SOURCE_DIR}/check-system-health/`);
    }
    expect(treeLines(root), "neither run wrote anything").toEqual(before);
  });
});

describe("gen:pack against a scratch copy of the real tree: byte preservation (#58)", () => {
  // Each variant is a source skill (and a rule form) that a text-based copy or comparison would alter, and
  // the tampering a text-normalising writer would do to its pack copy.
  const VARIANTS: Array<[string, Buffer, (bytes: Buffer) => Buffer]> = [
    [
      "crlf",
      Buffer.from("---\r\nname: qa-bytes-crlf\r\n---\r\n\r\nline one\r\nline two\r\n", "utf8"),
      (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8"),
    ],
    [
      "bom",
      Buffer.concat([BOM, Buffer.from("---\nname: qa-bytes-bom\n---\n\nbody\n", "utf8")]),
      (bytes) => bytes.subarray(3),
    ],
    [
      "no-trailing-newline",
      Buffer.from("---\nname: qa-bytes-no-trailing-newline\n---\n\nno final newline", "utf8"),
      (bytes) => Buffer.concat([bytes, Buffer.from("\n")]),
    ],
    [
      "non-ascii",
      // "cafe" with the precomposed e-acute, an em dash, a copyright sign and an emoji, as raw UTF-8 bytes.
      Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9, 0x20, 0xe2, 0x80, 0x94, 0x20, 0xc2, 0xa9, 0x20, 0xf0, 0x9f, 0x98, 0x80, 0x0a]),
      (bytes) => Buffer.from(bytes.toString("utf8").normalize("NFD"), "utf8"),
    ],
    [
      "invalid-utf8",
      Buffer.from([0x61, 0xff, 0xfe, 0x62, 0x0a]),
      (bytes) => Buffer.from(bytes.toString("utf8"), "utf8"),
    ],
  ];

  // A rule source carries no frontmatter, so the three variants above that open with frontmatter get
  // frontmatter-free rule bodies with the same byte property; the other two are used as they are.
  const RULE_BODIES: Record<string, Buffer> = {
    crlf: Buffer.from("line one\r\nline two\r\n", "utf8"),
    bom: Buffer.concat([BOM, Buffer.from("body\n", "utf8")]),
    "no-trailing-newline": Buffer.from("no final newline", "utf8"),
  };
  const ruleBytes = (key: string, skillBytes: Buffer): Buffer => RULE_BODIES[key] ?? skillBytes;

  /** The AGENTS.md section the source bytes must produce, with the marker lines typed out. */
  function expectedSection(key: string, bytes: Buffer): Buffer {
    const endsInLineFeed = bytes[bytes.length - 1] === 0x0a;
    return Buffer.concat([
      Buffer.from(`<!-- IRIS-MCP-RULE:qa-bytes-${key}:BEGIN -->\n`, "utf8"),
      bytes,
      Buffer.from(`${endsInLineFeed ? "" : "\n"}<!-- IRIS-MCP-RULE:qa-bytes-${key}:END -->\n`, "utf8"),
    ]);
  }

  function seedVariants(root: string): void {
    for (const [key, bytes] of VARIANTS) {
      put(root, `${KNOWLEDGE_SOURCE_DIR}/qa-bytes-${key}/SKILL.md`, bytes);
      put(root, `${RULES_SOURCE_DIR}/qa-bytes-${key}.md`, ruleBytes(key, bytes));
    }
  }

  it("write mode copies every variant byte for byte into both rule forms, and --check then passes", () => {
    const root = scratch();
    seedVariants(root);
    const write = runScript(root, GEN_PACK);
    expect(write.status, write.stderr).toBe(0);
    for (const [key, bytes] of VARIANTS) {
      const rule = ruleBytes(key, bytes);
      expect(readFileSync(join(root, PACK_DIR, `skills/qa-bytes-${key}/SKILL.md`)).equals(bytes), `${key} skill`).toBe(true);
      expect(readFileSync(join(root, PACK_DIR, `${RULE_FORM_DIRS.claudeCode}/qa-bytes-${key}.md`)).equals(rule), `${key} claude-code form`).toBe(true);
      expect(
        readFileSync(join(root, PACK_DIR, `${RULE_FORM_DIRS.agentsMd}/qa-bytes-${key}.md`)).equals(expectedSection(key, rule)),
        `${key} AGENTS.md section form`,
      ).toBe(true);
    }
    const check = runScript(root, GEN_PACK, ["--check"]);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain("34 pack file(s) match their sources");
  });

  it.each(VARIANTS.map(([key, bytes, tamper]) => [key, bytes, tamper] as const))(
    "%s: a pack copy changed the way a text-normalising writer would is DRIFT",
    (key, bytes, tamper) => {
      const root = scratch();
      seedVariants(root);
      expect(runScript(root, GEN_PACK).status).toBe(0);
      const packCopy = join(root, PACK_DIR, `skills/qa-bytes-${key}/SKILL.md`);
      const tampered = tamper(bytes);
      expect(tampered.equals(bytes), "the tampering changes the bytes").toBe(false);
      writeFileSync(packCopy, tampered);

      const check = runScript(root, GEN_PACK, ["--check"]);
      expect(check.status, check.stdout).toBe(1);
      expect(check.stderr).toContain(drift(`skills/qa-bytes-${key}/SKILL.md`));

      expect(runScript(root, GEN_PACK).status).toBe(0);
      expect(readFileSync(packCopy).equals(bytes), "write mode restores the source bytes").toBe(true);
    },
  );
});

describe("gen:skills against a scratch copy: a hand-authored pack source is never stale", () => {
  const HAND_AUTHORED = [
    { rel: `${KNOWLEDGE_SOURCE_DIR}/qa-hand/SKILL.md`, content: "---\nname: qa-hand\ndescription: hand authored\n---\n\nBody.\n" },
    { rel: `${KNOWLEDGE_SOURCE_DIR}/qa-hand/references/guide.md`, content: "A reference.\n" },
    { rel: `${RULES_SOURCE_DIR}/qa-rule.md`, content: "An always-on rule.\n" },
  ];

  it("control: gen:skills --check passes on the unmodified scratch copy", () => {
    const root = scratch({ serverPackages: true });
    const run = runScript(root, GEN_SKILLS, ["--check"]);
    expect(run.status, `${run.stderr}${run.stdout}`).toBe(0);
    expect(run.stdout).toContain("13 generated file(s) match source");
  });

  it.each([
    ["a changed byte in a generated skill", (skills: string) => mutate(join(skills, "check-system-health/SKILL.md"), flipMiddleByte), "DRIFT in skills/check-system-health/SKILL.md"],
    ["a deleted generated README", (skills: string) => rmSync(join(skills, "README.md")), "MISSING generated file: skills/README.md"],
  ])("gen:skills --check exits 1 naming %s, and write mode restores the committed skills/", (_name, fault, diagnostic) => {
    const root = scratch({ serverPackages: true });
    const skills = join(root, WORKFLOW_SKILLS_DIR);
    fault(skills);
    const check = runScript(root, GEN_SKILLS, ["--check"]);
    expect(check.status, check.stdout).toBe(1);
    expect(check.stderr).toContain(diagnostic);

    expect(runScript(root, GEN_SKILLS).status).toBe(0);
    expect(treeLines(skills)).toEqual(treeLines(REAL_SKILLS));
    expect(runScript(root, GEN_SKILLS, ["--check"]).status).toBe(0);
  });

  it("gen:skills --check still passes with hand-authored sources present; gen:pack --check names the four missing pack files until gen:pack runs", () => {
    const root = scratch({ serverPackages: true });
    for (const { rel, content } of HAND_AUTHORED) put(root, rel, content);

    const skills = runScript(root, GEN_SKILLS, ["--check"]);
    expect(skills.status, `${skills.stderr}${skills.stdout}`).toBe(0);
    expect(skills.stdout).toContain("13 generated file(s) match source");

    const pack = runScript(root, GEN_PACK, ["--check"]);
    expect(pack.status).toBe(1);
    for (const rel of [
      "skills/qa-hand/SKILL.md",
      "skills/qa-hand/references/guide.md",
      `${RULE_FORM_DIRS.claudeCode}/qa-rule.md`,
      `${RULE_FORM_DIRS.agentsMd}/qa-rule.md`,
    ]) {
      expect(pack.stderr).toContain(missing(rel));
    }

    expect(runScript(root, GEN_PACK).status).toBe(0);
    expect(runScript(root, GEN_PACK, ["--check"]).status).toBe(0);
    expect(runScript(root, GEN_SKILLS, ["--check"]).status, "gen:skills --check after gen:pack").toBe(0);
  });

  it("gen:skills write mode leaves the hand-authored sources and the pack untouched, and skills/ equal to the committed skills/", () => {
    const root = scratch({ serverPackages: true });
    for (const { rel, content } of HAND_AUTHORED) put(root, rel, content);
    expect(runScript(root, GEN_PACK).status).toBe(0);
    const sourcesBefore = treeLines(join(root, PACK_SOURCE_DIR));
    const packBefore = treeLines(join(root, PACK_DIR));

    const write = runScript(root, GEN_SKILLS);
    expect(write.status, write.stderr).toBe(0);
    expect(treeLines(join(root, PACK_SOURCE_DIR))).toEqual(sourcesBefore);
    expect(treeLines(join(root, PACK_DIR))).toEqual(packBefore);
    expect(treeLines(join(root, WORKFLOW_SKILLS_DIR))).toEqual(treeLines(REAL_SKILLS));
    for (const { rel, content } of HAND_AUTHORED) expect(readFileSync(join(root, rel), "utf8")).toBe(content);
  });

  it("contrast: the same hand-authored file placed inside skills/ IS stale for gen:skills, and write mode removes it", () => {
    const root = scratch({ serverPackages: true });
    put(root, `${WORKFLOW_SKILLS_DIR}/qa-hand/SKILL.md`, HAND_AUTHORED[0]?.content ?? "");

    const check = runScript(root, GEN_SKILLS, ["--check"]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("STRAY/STALE generated file (no source prompt): skills/qa-hand/SKILL.md");

    expect(runScript(root, GEN_SKILLS).status).toBe(0);
    expect(existsSync(join(root, WORKFLOW_SKILLS_DIR, "qa-hand"))).toBe(false);
    expect(runScript(root, GEN_SKILLS, ["--check"]).status).toBe(0);
  });
});
