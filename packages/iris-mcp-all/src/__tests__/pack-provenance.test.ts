/**
 * Story 41.1 (AC 41.1.3 and 41.1.4) - provenance of adapted third-party content in the skills pack.
 *
 * `scripts/lib/provenance-core.mjs` holds the rules and the pinned oracles; this file drives them three ways:
 *  - in-memory inputs, one fixture per provenance row of the story's I/O matrix (each mutates one fact of a
 *    consistent input set, so a failure names the rule that caught it);
 *  - the gatherer (`scripts/lib/provenance-inputs.mjs`) against fixture workspaces, with the packer call
 *    replaced by results `child_process.spawnSync` can really return (npm missing, non-zero exit, text instead
 *    of JSON, no file list), proving every failure to gather is reported and never skipped;
 *  - the real tree: the committed notice and pack pass every rule, and npm's own dry-run packer lists the
 *    whole pack and the notice in the client-config tarball.
 *
 * The pinned expectations below are typed here from the upstream capture (`shasum -a 256 LICENSE` at
 * b6205bbbad2f431ae14c34401fd55d85cb5d2305); nothing is derived from the notice under test. No test reads the
 * upstream checkout or the network. The only child process is `npm pack --dry-run --json --ignore-scripts
 * --offline` with an explicit `cwd`.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ADAPTATION_HEADER,
  checkProvenance,
  DISTRIBUTION_MARKER,
  extractLicenseBlock,
  hasValidAdaptationHeader,
  isExcludedSource,
  NON_ENDORSEMENT,
  parseProvenanceRows,
  PROVENANCE_HEADER_ROW,
  REQUIRED_CREDITS,
  UPSTREAM_COMMIT,
} from "../../../../scripts/lib/provenance-core.mjs";
import { gatherProvenanceInputs, NPM_PACK_ARGS } from "../../../../scripts/lib/provenance-inputs.mjs";
import { NOTICE_FILENAME, PACK_DIR, PACK_SOURCE_DIR, WORKFLOW_SKILLS_DIR } from "../../../../scripts/lib/skills-pack.mjs";
import { makeTempRoot, put, removeTempRoot, REPO_ROOT, runNode } from "./pack-fixture";

interface Distribution {
  name: string;
  mustShipPack: boolean;
  files: Array<{ path: string; bytes: Buffer }>;
  problem?: string;
}
interface Inputs {
  sourceNotice: Buffer | null;
  packNotice: Buffer | null;
  agentFiles: Array<{ label: string; packRel: string; text: string }>;
  packFiles: Array<{ rel: string; bytes: Buffer }>;
  distributions: Distribution[];
}
interface Problem {
  rule: string;
  label: string;
  message: string;
}
interface PackerResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
}

const PINNED_LICENSE_SHA256 = "85b458dc150c4d17873dd5e73d01cfa23c797997a09d841884e08378242e929c";
const PINNED_LICENSE_BYTES = 1081;
const PINNED_COMMIT = "b6205bbbad2f431ae14c34401fd55d85cb5d2305";
const PINNED_HEADER =
  "Adapted from intersystems-community/iris-agentic-dev (MIT, \u00A9 2025 InterSystems Corporation); see IRIS-MCP-THIRD-PARTY-NOTICES.md";

const realNotice = readFileSync(join(REPO_ROOT, PACK_SOURCE_DIR, NOTICE_FILENAME));
const SEPARATOR_ROW = "| --- | --- | --- |\n";

/** The real notice with provenance rows inserted after the table's separator row. */
function noticeWithRows(rows: Array<[string, string]> = []): Buffer {
  const lines = rows.map(([file, source]) => `| \`${file}\` | \`${source}\` | adapted for the pack |\n`).join("");
  return Buffer.from(realNotice.toString("utf8").replace(SEPARATOR_ROW, () => SEPARATOR_ROW + lines), "utf8");
}

/** The text of an adapted file: frontmatter, then the header as the first non-blank line. */
function adaptedText(body = "Body.\n"): string {
  return `---\nname: k\ndescription: d\n---\n\n${ADAPTATION_HEADER}\n\n${body}`;
}

/** What npm would list for a package that ships the given pack files at `skills-pack/<rel>`. */
function tarballOf(packFiles: Array<{ rel: string; bytes: Buffer }>): Array<{ path: string; bytes: Buffer }> {
  return packFiles.map((file) => ({ path: `skills-pack/${file.rel}`, bytes: file.bytes }));
}

/** A consistent input set, with each part replaceable. */
function inputsFor(
  options: {
    rows?: Array<[string, string]>;
    notice?: Buffer;
    packNotice?: Buffer | null;
    agentFiles?: Inputs["agentFiles"];
    extraPackFiles?: Inputs["packFiles"];
    distributions?: Distribution[];
  } = {},
): Inputs {
  const notice = options.notice ?? noticeWithRows(options.rows);
  const packNotice = options.packNotice === undefined ? notice : options.packNotice;
  const packFiles = [
    ...(packNotice === null ? [] : [{ rel: NOTICE_FILENAME, bytes: packNotice }]),
    ...(options.extraPackFiles ?? []),
  ];
  return {
    sourceNotice: notice,
    packNotice,
    agentFiles: options.agentFiles ?? [],
    packFiles,
    distributions: options.distributions ?? [
      { name: "@iris-mcp/client-config", mustShipPack: true, files: tarballOf(packFiles) },
    ],
  };
}

const check = (inputs: Inputs): Problem[] => checkProvenance(inputs) as Problem[];
const byRule = (problems: Problem[], rule: string): Problem[] => problems.filter((problem) => problem.rule === rule);

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeTempRoot(root);
});

describe("the pinned oracles", () => {
  it("MIT block is byte-exact to the pinned upstream LICENSE", () => {
    const block = extractLicenseBlock(realNotice);
    expect(block).not.toBeNull();
    expect(block?.length).toBe(PINNED_LICENSE_BYTES);
    expect(createHash("sha256").update(block ?? Buffer.alloc(0)).digest("hex")).toBe(PINNED_LICENSE_SHA256);
    expect(block?.toString("utf8").endsWith("SOFTWARE.\n")).toBe(true);
    expect(byRule(check(inputsFor()), "mit-block")).toEqual([]);
  });

  it("the constants in the core module equal the independently typed upstream capture", () => {
    expect(UPSTREAM_COMMIT).toBe(PINNED_COMMIT);
    expect(ADAPTATION_HEADER).toBe(PINNED_HEADER);
    expect(DISTRIBUTION_MARKER).toBe("Adapted from intersystems-community/iris-agentic-dev");
    expect(ADAPTATION_HEADER.startsWith(DISTRIBUTION_MARKER)).toBe(true);
    expect(REQUIRED_CREDITS).toEqual(["Tim Leavitt", "Tom Dyar"]);
    expect(PROVENANCE_HEADER_ROW).toBe("| Pack file | Source file at b6205bb | Adaptation |");
    expect(NON_ENDORSEMENT).toBe(
      "The IRIS MCP Server Suite and this skills pack are independent projects; they are not affiliated with, sponsored by, or endorsed by InterSystems Corporation.",
    );
  });

  it("the notice carries the full commit, both credits, the non-endorsement sentence and the table", () => {
    const text = realNotice.toString("utf8");
    expect(text).toContain(PINNED_COMMIT);
    expect(text).toContain("Tim Leavitt");
    expect(text).toContain("Tom Dyar");
    expect(text).toContain(NON_ENDORSEMENT);
    expect(text.split("\n")).toContain(PROVENANCE_HEADER_ROW);
  });

  it("the NPM packer is invoked with the safety flags", () => {
    expect(NPM_PACK_ARGS).toEqual(["pack", "--dry-run", "--json", "--ignore-scripts", "--offline"]);
  });
});

describe("a consistent input set (fixture)", () => {
  it("passes with no adapted file and no row", () => {
    expect(check(inputsFor())).toEqual([]);
  });

  it("passes with an adapted file, its pack copy, its row and a tarball that ships both", () => {
    const text = adaptedText();
    const bytes = Buffer.from(text, "utf8");
    const inputs = inputsFor({
      rows: [["skills/k/SKILL.md", "skills/skills/some-skill/SKILL.md"]],
      agentFiles: [
        { label: "knowledge:k/SKILL.md", packRel: "skills/k/SKILL.md", text },
        { label: "pack:skills/k/SKILL.md", packRel: "skills/k/SKILL.md", text },
      ],
      extraPackFiles: [{ rel: "skills/k/SKILL.md", bytes }],
    });
    expect(check(inputs)).toEqual([]);
  });
});

describe("claim without a row, and the header", () => {
  it("an agent file that mentions iris-agentic-dev and carries the header, but has no row, is refused", () => {
    const problems = check(
      inputsFor({ agentFiles: [{ label: "knowledge:k/SKILL.md", packRel: "skills/k/SKILL.md", text: adaptedText() }] }),
    );
    expect(problems).toEqual([
      { rule: "claim-row", label: "knowledge:k/SKILL.md", message: "no provenance row for skills/k/SKILL.md" },
    ]);
  });

  it.each(["Based on IRIS-AGENTIC-DEV.\n", "Credit: Iris-Agentic-Dev.\n"])(
    "a file whose only mention is %j, in another case and with no header, is refused for both the header and the row",
    (body) => {
      const text = `---\nname: k\n---\n\n${body}`;
      const problems = check(inputsFor({ agentFiles: [{ label: "knowledge:k/SKILL.md", packRel: "skills/k/SKILL.md", text }] }));
      expect(problems.map((problem) => problem.rule).sort()).toEqual(["claim-row", "header"]);
    },
  );

  it.each([
    ["absent", "---\nname: k\n---\n\nAdapted from iris-agentic-dev.\n"],
    ["after other text", `---\nname: k\n---\n\nIntro.\n${ADAPTATION_HEADER}\n`],
    ["with a different copyright sign", `---\nname: k\n---\n\n${ADAPTATION_HEADER.replace(/\(MIT, [^ ]+ /, "(MIT, (c) ")}\n`],
    ["with a trailing space", `${ADAPTATION_HEADER} \n`],
    ["inside an unterminated frontmatter block", `---\nname: k\n${ADAPTATION_HEADER}\n`],
  ])("a file whose header is %s is refused as missing or misplaced", (_name, text) => {
    const problems = check(inputsFor({ agentFiles: [{ label: "rule:r.md", packRel: "rules/r.md", text }] }));
    expect(byRule(problems, "header")).toEqual([
      { rule: "header", label: "rule:r.md", message: "missing or misplaced adaptation header" },
    ]);
  });

  it("a file that never mentions iris-agentic-dev needs neither header nor row", () => {
    const problems = check(
      inputsFor({ agentFiles: [{ label: "rule:r.md", packRel: "rules/r.md", text: "Plain content about iris_health_check.\n" }] }),
    );
    expect(problems).toEqual([]);
  });
});

describe("hasValidAdaptationHeader", () => {
  it.each([
    ["no frontmatter", `${ADAPTATION_HEADER}\n\nBody\n`, true],
    ["frontmatter then blank lines", `---\na: 1\n---\n\n\n${ADAPTATION_HEADER}\nBody\n`, true],
    ["CRLF line endings", `---\r\na: 1\r\n---\r\n\r\n${ADAPTATION_HEADER}\r\nBody\r\n`, true],
    ["a leading BOM", `${String.fromCharCode(0xfeff)}---\na: 1\n---\n${ADAPTATION_HEADER}\n`, true],
    ["no header at all", "Body\n", false],
    ["header only in the body", `---\na: 1\n---\nBody\n${ADAPTATION_HEADER}\n`, false],
    ["empty text", "", false],
  ])("%s", (_name, text, expected) => {
    expect(hasValidAdaptationHeader(text)).toBe(expected);
  });
});

describe("provenance rows", () => {
  it("parses rows with and without code ticks, and reports a malformed row", () => {
    const text = [
      PROVENANCE_HEADER_ROW,
      "| --- | --- | --- |",
      "| `skills/a/SKILL.md` | `skills/skills/a/SKILL.md` | trimmed |",
      "| rules/r.md | rules/r.md | plain cells |",
      "| only | two |",
      "",
      "| `late.md` | `late.md` | after a blank line, not a row |",
    ].join("\n");
    const { rows, problems } = parseProvenanceRows(text);
    expect(rows.map((row: { packFile: string; source: string }) => [row.packFile, row.source])).toEqual([
      ["skills/a/SKILL.md", "skills/skills/a/SKILL.md"],
      ["rules/r.md", "rules/r.md"],
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("line 5");
  });

  it("reports a table whose separator row is missing", () => {
    const { rows, problems } = parseProvenanceRows(`${PROVENANCE_HEADER_ROW}\n| a | b | c |\n`);
    expect(rows).toEqual([]);
    expect(problems).toHaveLength(1);
  });

  it("returns no rows when the header row is absent", () => {
    expect(parseProvenanceRows("| a | b | c |\n")).toEqual({ rows: [], problems: [] });
  });

  it("a row whose pack file is absent from the pack is refused, one problem for the row", () => {
    const problems = check(inputsFor({ rows: [["skills/ghost/SKILL.md", "skills/skills/ghost/SKILL.md"]] }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ rule: "row-file", label: "skills/ghost/SKILL.md" });
  });

  it("a row whose pack file lacks the header is refused, one problem for the row", () => {
    const problems = check(
      inputsFor({
        rows: [["skills/k/SKILL.md", "skills/skills/k/SKILL.md"]],
        extraPackFiles: [{ rel: "skills/k/SKILL.md", bytes: Buffer.from("---\nname: k\n---\n\nNo header.\n") }],
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ rule: "row-file", label: "skills/k/SKILL.md" });
  });
});

describe("excluded and malformed sources", () => {
  const refused = [
    "skills/kb/ipm-module-authoring.md",
    "./skills/kb/ipm-module-authoring.md",
    "Skills/KB/IPM-Module-Authoring.md",
    "skills\\kb\\ipm-module-authoring.md",
    "skills/skills/iris-objectscript-eval/SKILL.md",
    "iris-objectscript-eval/README.md",
    "skills/kb/ipm-module-authoring.md#L5",
    "skills/kb/ipm-module-authoring.md:12",
    "skills/kb/ipm-module-authoring.md (section 2)",
    "skills/skills/iris-objectscript-eval/SKILL.md?ref=main",
    "/etc/passwd",
    "C:/work/SKILL.md",
    "../outside/SKILL.md",
    "skills/../../outside/SKILL.md",
    "skills/a..b/SKILL.md",
    "",
  ];
  const allowed = [
    "skills/skills/objectscript-style/SKILL.md",
    "skills/kb/other-guide.md",
    "skills/skills/iris-objectscript-eval-notes/SKILL.md",
    "docs/ipm-module-authoring.md",
  ];

  it("a row citing an excluded source is refused", () => {
    for (const source of refused.filter((entry) => entry !== "")) {
      const bytes = Buffer.from(adaptedText(), "utf8");
      const problems = check(
        inputsFor({ rows: [["skills/k/SKILL.md", source]], extraPackFiles: [{ rel: "skills/k/SKILL.md", bytes }] }),
      );
      expect(problems, source).toEqual([
        { rule: "excluded-source", label: "skills/k/SKILL.md", message: `excluded or malformed source: ${source}` },
      ]);
    }
  });

  it("isExcludedSource refuses the excluded and malformed paths and allows ordinary ones", () => {
    for (const source of refused) expect(isExcludedSource(source), `refuse ${source}`).toBe(true);
    for (const source of allowed) expect(isExcludedSource(source), `allow ${source}`).toBe(false);
  });
});

describe("the MIT block", () => {
  const text = realNotice.toString("utf8");
  const altered: Array<[string, string]> = [
    ["one byte changed", text.replace("Copyright (c) 2025", "Copyright (c) 2024")],
    ["CRLF line endings", text.replace(/\n/g, "\r\n")],
    ["a missing final LF", text.replace("SOFTWARE.\n```", "SOFTWARE.```")],
    ["the closing fence moved up", text.replace("SOFTWARE.\n```\n", "```\nSOFTWARE.\n")],
    ["the opening marker removed", text.replace("<!-- BEGIN iris-agentic-dev LICENSE (verbatim) -->\n", "")],
    ["the closing marker removed", text.replace("<!-- END iris-agentic-dev LICENSE -->", "")],
    ["the fence language removed", text.replace("```text\n", "```\n")],
    ["the block removed", text.slice(0, text.indexOf("<!-- BEGIN"))],
    ["a second copy of the block appended", `${text}\n${text.slice(text.indexOf("<!-- BEGIN"))}`],
    [
      "the closing fence and end marker placed before the begin marker",
      text
        .replace("```\n<!-- END iris-agentic-dev LICENSE -->", "```")
        .replace(
          "<!-- BEGIN iris-agentic-dev LICENSE (verbatim) -->",
          "```\n<!-- END iris-agentic-dev LICENSE -->\n<!-- BEGIN iris-agentic-dev LICENSE (verbatim) -->",
        ),
    ],
  ];

  it.each(altered)("%s is refused", (_name, mutated) => {
    expect(mutated).not.toBe(text);
    const bytes = Buffer.from(mutated, "utf8");
    const problems = byRule(check(inputsFor({ notice: bytes })), "mit-block");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain(PINNED_LICENSE_SHA256);
  });

  it("a changed byte is reported with the sha256 and length it has, against the pin", () => {
    const bytes = Buffer.from(text.replace("Copyright (c) 2025", "Copyright (c) 2024"), "utf8");
    const message = byRule(check(inputsFor({ notice: bytes })), "mit-block")[0]?.message ?? "";
    expect(message).toContain("1081 bytes");
    expect(message).toMatch(/sha256 [0-9a-f]{64}, 1081 bytes \(expected/);
  });
});

describe("the notice", () => {
  const text = realNotice.toString("utf8");
  const header = `${PROVENANCE_HEADER_ROW}\n`;
  const missing: Array<[string, string]> = [
    ["the full commit", text.split(PINNED_COMMIT).join("")],
    ["the credit Tim Leavitt", text.split("Tim Leavitt").join("")],
    ["the credit Tom Dyar", text.split("Tom Dyar").join("")],
    ["the non-endorsement sentence", text.split(NON_ENDORSEMENT).join("")],
    ["the table header row", text.replace(header, "")],
  ];

  it.each(missing)("without %s, the notice is refused with one problem", (_name, mutated) => {
    expect(mutated).not.toBe(text);
    const problems = check(inputsFor({ notice: Buffer.from(mutated, "utf8") }));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.rule).toBe("notice");
  });

  it("a pack notice that differs from the source notice is refused", () => {
    const problems = check(inputsFor({ packNotice: Buffer.concat([realNotice, Buffer.from("\n")]) }));
    expect(byRule(problems, "notice-sync")).toHaveLength(1);
  });

  it("a pack without the notice is refused", () => {
    expect(byRule(check(inputsFor({ packNotice: null })), "notice-sync")).toHaveLength(1);
  });

  it("a missing source notice is refused", () => {
    const inputs = { ...inputsFor(), sourceNotice: null };
    expect(byRule(check(inputs), "notice")).toHaveLength(1);
  });
});

describe("distributions", () => {
  const skill = { rel: "skills/k/SKILL.md", bytes: Buffer.from(adaptedText(), "utf8") };
  const noticeFile = { path: `skills-pack/${NOTICE_FILENAME}`, bytes: realNotice };
  const base = inputsFor({
    rows: [["skills/k/SKILL.md", "skills/skills/k/SKILL.md"]],
    extraPackFiles: [skill],
  });
  const shipped = tarballOf(base.packFiles);
  const clientConfig = (files: Distribution["files"]): Distribution => ({ name: "@iris-mcp/client-config", mustShipPack: true, files });
  const distributionProblems = (distributions: Distribution[]): Problem[] =>
    byRule(check({ ...base, distributions }), "distribution");

  it("a tarball that ships the whole pack and the notice passes", () => {
    expect(distributionProblems([clientConfig(shipped)])).toEqual([]);
  });

  it("a tarball with a pack file but no notice is refused, naming the package", () => {
    const withoutNotice = shipped.filter((file) => !file.path.endsWith(NOTICE_FILENAME));
    const problems = distributionProblems([clientConfig(shipped), { name: "@x/pack-only", mustShipPack: false, files: withoutNotice }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ rule: "distribution", label: "@x/pack-only" });
    expect(problems[0]?.message).toContain(NOTICE_FILENAME);
  });

  it("a tarball with a file carrying the ASCII marker but no notice is refused, naming the package", () => {
    const marked = { path: "dist/skill-text.js", bytes: Buffer.from(`export default "${DISTRIBUTION_MARKER} ...";\n`) };
    const problems = distributionProblems([clientConfig(shipped), { name: "@x/compiled", mustShipPack: false, files: [marked] }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ label: "@x/compiled" });
  });

  it("a notice that is not byte-equal to the canonical notice does not count", () => {
    const altered = { path: noticeFile.path, bytes: Buffer.concat([realNotice, Buffer.from(" ")]) };
    const problems = distributionProblems([
      clientConfig(shipped),
      { name: "@x/other", mustShipPack: false, files: [{ path: "skills-pack/skills/k/SKILL.md", bytes: skill.bytes }, altered] },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ label: "@x/other" });
  });

  it("a byte-identical copy of a pack file at another path counts as pack content", () => {
    const plain = { rel: "skills/plain/SKILL.md", bytes: Buffer.from("Plain skill text, no attribution.\n", "utf8") };
    const withPlain = inputsFor({
      rows: [["skills/k/SKILL.md", "skills/skills/k/SKILL.md"]],
      extraPackFiles: [skill, plain],
    });
    const copy = { path: "dist/templates/skill.md", bytes: plain.bytes };
    const problems = byRule(
      check({
        ...withPlain,
        distributions: [clientConfig(tarballOf(withPlain.packFiles)), { name: "@x/copy", mustShipPack: false, files: [copy] }],
      }),
      "distribution",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ label: "@x/copy" });
  });

  it("a package that ships no pack or adapted content needs no notice", () => {
    const unrelated = { name: "@x/server", mustShipPack: false, files: [{ path: "dist/index.js", bytes: Buffer.from("export {};\n") }] };
    expect(distributionProblems([clientConfig(shipped), unrelated])).toEqual([]);
  });

  it("a pack-shipping package whose tarball lacks a pack file is refused, naming the file", () => {
    const problems = distributionProblems([clientConfig(shipped.filter((file) => !file.path.endsWith("k/SKILL.md")))]);
    expect(problems.some((problem) => problem.message.includes("skills-pack/skills/k/SKILL.md"))).toBe(true);
  });

  it("an input set where no distribution ships the pack is refused", () => {
    const problems = distributionProblems([{ name: "@x/server", mustShipPack: false, files: [] }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("no distribution");
  });

  it("a distribution whose file list could not be gathered is reported with its reason", () => {
    const problems = distributionProblems([
      clientConfig(shipped),
      { name: "@x/broken", mustShipPack: false, files: [], problem: "npm pack could not run" },
    ]);
    expect(problems).toEqual([{ rule: "distribution", label: "@x/broken", message: "npm pack could not run" }]);
  });
});

describe("gathering distributions fails closed (fixture workspace, injected packer)", () => {
  function workspace(): string {
    const root = makeTempRoot("pack-provenance-test");
    roots.push(root);
    put(root, "packages/aa-server/package.json", JSON.stringify({ name: "@x/server", files: ["dist", "!dist/**/__tests__"] }));
    put(root, "packages/aa-server/dist/index.js", "export {};\n");
    put(root, "packages/bb-meta/package.json", JSON.stringify({ name: "@x/meta", files: [] }));
    put(root, "packages/cc-private/package.json", JSON.stringify({ name: "@x/private", private: true, files: ["dist"] }));
    return root;
  }
  const listing = (...paths: string[]): string => JSON.stringify([{ files: paths.map((path) => ({ path })) }]);
  const ok = (stdout: string): PackerResult => ({ status: 0, stdout, stderr: "", error: null });

  it("lists one distribution per non-private package from the packer's file list, with the bytes read from disk", () => {
    const root = workspace();
    const cwds: string[] = [];
    const inputs = gatherProvenanceInputs(root, {
      runNpmPack: (cwd: string) => {
        cwds.push(cwd);
        return ok(cwd.endsWith("aa-server") ? listing("package.json", "dist/index.js") : listing("package.json"));
      },
    }) as Inputs;
    expect(cwds).toEqual([join(root, "packages/aa-server"), join(root, "packages/bb-meta")]);
    expect(inputs.distributions.map((distribution) => distribution.name)).toEqual(["@x/server", "@x/meta"]);
    const server = inputs.distributions[0];
    expect(server?.problem).toBeUndefined();
    expect(server?.files.map((file) => file.path)).toEqual(["package.json", "dist/index.js"]);
    expect(server?.files[1]?.bytes.toString("utf8")).toBe("export {};\n");
    expect(inputs.distributions[1]?.problem).toBeUndefined();
  });

  const failures: Array<[string, PackerResult]> = [
    ["npm cannot be started", { status: null, stdout: "", stderr: "", error: new Error("spawn npm ENOENT") }],
    ["npm exits non-zero", { status: 1, stdout: "", stderr: "npm error boom\n", error: null }],
    ["npm prints text, not JSON", ok("this is not json")],
    ["npm prints an empty list", ok("[]")],
    ["npm prints JSON without a file list", ok(JSON.stringify([{ name: "x" }]))],
    ["a listed file is not on disk", ok(listing("package.json", "dist/missing.js"))],
  ];

  it.each(failures)("%s: the distribution carries a problem and the check reports it", (_name, result) => {
    const root = workspace();
    const inputs = gatherProvenanceInputs(root, { runNpmPack: () => result }) as Inputs;
    const server = inputs.distributions.find((distribution) => distribution.name === "@x/server");
    expect(server?.problem, "the failure is recorded on the distribution").toEqual(expect.any(String));
    const problems = byRule(check(inputs), "distribution");
    expect(problems.some((problem) => problem.label === "@x/server" && problem.message === server?.problem)).toBe(true);
  });

  it("a dist-shipping package whose dry-run lists no dist/ file is refused, while a dist-less package is not", () => {
    const root = workspace();
    const inputs = gatherProvenanceInputs(root, { runNpmPack: () => ok(listing("package.json")) }) as Inputs;
    const server = inputs.distributions.find((distribution) => distribution.name === "@x/server");
    const meta = inputs.distributions.find((distribution) => distribution.name === "@x/meta");
    expect(server?.problem).toContain("dist/");
    expect(meta?.problem).toBeUndefined();
  });

  it("a workspace with no packages has no distribution that ships the pack, which is refused", () => {
    const root = makeTempRoot("pack-provenance-test");
    roots.push(root);
    const inputs = gatherProvenanceInputs(root, { runNpmPack: () => ok("[]") }) as Inputs;
    expect(inputs.distributions).toEqual([]);
    expect(byRule(check(inputs), "distribution").some((problem) => problem.message.includes("no distribution"))).toBe(true);
  });

  it("a package.json that is not valid JSON is a distribution with a problem", () => {
    const root = makeTempRoot("pack-provenance-test");
    roots.push(root);
    put(root, "packages/broken/package.json", "{ not json");
    const inputs = gatherProvenanceInputs(root, { runNpmPack: () => ok("[]") }) as Inputs;
    expect(inputs.distributions).toHaveLength(1);
    expect(inputs.distributions[0]?.problem).toContain("not valid JSON");
  });
});

describe("the real tree", () => {
  let inputs: Inputs;
  beforeAll(() => {
    inputs = gatherProvenanceInputs(REPO_ROOT) as Inputs;
  }, 120_000);

  it("real tree passes every provenance rule", () => {
    expect(check(inputs)).toEqual([]);
  });

  it("client-config tarball ships every pack file and the notice", () => {
    const clientConfig = inputs.distributions.find((distribution) => distribution.name === "@iris-mcp/client-config");
    expect(clientConfig, "the client-config distribution").toBeDefined();
    expect(clientConfig?.mustShipPack).toBe(true);
    expect(clientConfig?.problem).toBeUndefined();
    const listed = new Set(clientConfig?.files.map((file) => file.path));

    expect(listed.has(`skills-pack/${NOTICE_FILENAME}`), "the notice").toBe(true);
    expect(listed.has("skills-pack/README.md"), "the pack README").toBe(true);
    const workflowSkills = readdirSync(join(REPO_ROOT, WORKFLOW_SKILLS_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(workflowSkills).toHaveLength(12);
    for (const name of workflowSkills) {
      expect(listed.has(`skills-pack/skills/${name}/SKILL.md`), `skills-pack/skills/${name}/SKILL.md`).toBe(true);
    }
    for (const file of inputs.packFiles) {
      expect(listed.has(`skills-pack/${file.rel}`), `skills-pack/${file.rel}`).toBe(true);
    }
    expect(inputs.packFiles.length).toBeGreaterThanOrEqual(16);
  });

  it("enumerates one distribution per non-private workspace package, as of 2026-10-18, each listing dist files when it ships dist", () => {
    const names = inputs.distributions.map((distribution) => distribution.name);
    const packagesDir = join(REPO_ROOT, "packages");
    const publishable = readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, "package.json")))
      .map((entry) => JSON.parse(readFileSync(join(packagesDir, entry.name, "package.json"), "utf8")) as { name: string; private?: boolean })
      .filter((manifest) => manifest.private !== true)
      .map((manifest) => manifest.name);
    expect([...names].sort()).toEqual([...publishable].sort());
    expect(names).toEqual(
      expect.arrayContaining([
        "@iris-mcp/client-config",
        "@iris-mcp/shared",
        "@iris-mcp/dev",
        "@iris-mcp/admin",
        "@iris-mcp/interop",
        "@iris-mcp/ops",
        "@iris-mcp/data",
        "@iris-mcp/all",
      ]),
    );
    for (const distribution of inputs.distributions) {
      expect(distribution.problem, distribution.name).toBeUndefined();
      expect(distribution.files.some((file) => file.path === "package.json"), `${distribution.name} lists package.json`).toBe(true);
    }
    const shared = inputs.distributions.find((distribution) => distribution.name === "@iris-mcp/shared");
    expect(shared?.files.some((file) => file.path.startsWith("dist/"))).toBe(true);
    expect(inputs.distributions.filter((distribution) => distribution.mustShipPack).map((distribution) => distribution.name)).toEqual([
      "@iris-mcp/client-config",
    ]);
  });
});

describe("the check-provenance CLI", () => {
  const SCRIPT_FILES = [
    "scripts/check-provenance.mjs",
    "scripts/lib/provenance-core.mjs",
    "scripts/lib/provenance-inputs.mjs",
    "scripts/lib/dist-freshness.mjs",
    "scripts/lib/generated-tree.mjs",
    "scripts/lib/skills-pack.mjs",
  ];

  it("exits 0 on the real tree and prints the pinned MIT block hash", () => {
    const run = runNode(REPO_ROOT, "scripts/check-provenance.mjs");
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain(`MIT block sha256 ${PINNED_LICENSE_SHA256} (${PINNED_LICENSE_BYTES} bytes)`);
  }, 60_000);

  it("exits 1 and names the failing rule for a fixture root whose notice was altered", () => {
    const root = makeTempRoot("check-provenance-cli");
    roots.push(root);
    for (const rel of SCRIPT_FILES) put(root, rel, readFileSync(join(REPO_ROOT, rel)));
    const altered = Buffer.from(realNotice.toString("utf8").replace("Copyright (c) 2025", "Copyright (c) 2024"), "utf8");
    put(root, `${PACK_SOURCE_DIR}/${NOTICE_FILENAME}`, altered);
    put(root, `${PACK_DIR}/${NOTICE_FILENAME}`, altered);

    const run = runNode(root, "scripts/check-provenance.mjs");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("[mit-block]");
    expect(run.stdout).not.toContain("check-provenance: OK");
  });
});
