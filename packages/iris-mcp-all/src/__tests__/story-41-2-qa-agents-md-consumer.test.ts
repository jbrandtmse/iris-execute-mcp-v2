/**
 * Story 41.2 QA (AC 41.2.3), run against the installer's real reader (Story 41.6, DW-616) - the `agents-md` pack form,
 * read the way a consumer of `AGENTS.md` reads it.
 *
 * The form is a section: a BEGIN marker line, the rule, an END marker line. The installer finds that section in a
 * user's own `AGENTS.md` by matching the two marker lines as exact whole lines, owns everything between them, and
 * leaves every other byte alone. This file pins the form against that reading, and every row calls the REAL
 * `locateRuleBlock` / `withRuleBlock` / `withoutRuleBlock` of `@iris-mcp/client-config`, imported from its built dist.
 * There is no reader of the test's own: the marker strings and the section renderer (`sectionOf`) are typed out here as
 * independent oracles of the bytes, nothing more.
 *
 * Pinned:
 *  - the real forms: BEGIN on line 1, END on the last line, each one whole line ending in LF, each once, and no other
 *    line of the form (or of the source, the `claude-code` form or the `cursor` form) holds the marker text;
 *  - a scratch `AGENTS.md` in each variant of project rule #58 (LF, CRLF, a BOM, no final newline, the section first,
 *    last or alone) holds exactly one section, found by the exact lines, whose bytes are the section as the file holds
 *    it; replacing it with the same form changes no byte, and a replaced section is found again;
 *  - lines that only look like a marker (a different rule name, an indent, trailing blanks, another case, the text
 *    inside a sentence) are not found, and a section of another rule is left alone;
 *  - a missing, repeated or misordered marker is not "one section": the reader reports every line number instead of
 *    choosing, and the writer refuses;
 *  - the form starts with its BEGIN line, so the real insert ends an unterminated last line first, in the file's own
 *    style, and finds BEGIN as a whole line; appending the bytes naively would not;
 *  - a BOM at byte 0 stays there through insert, replace and remove, and a BEGIN line right after it counts;
 *  - gen:pack refuses a rule source with a line that starts like a marker line (real CLI, scratch copy), so a
 *    generated section never holds a third marker line.
 *
 * The suite fails loudly when the client-config dist is missing or older than its source: it would otherwise run
 * these rows over code that is not what the source says. No IRIS and no network. Scratch files live under
 * `os.tmpdir()` and are removed by the test that made them.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";
import {
  ALWAYS_ON_RULE_FILENAME,
  PACK_DIR,
  RULE_FORM_DIRS,
  RULES_SOURCE_DIR,
} from "../../../../scripts/lib/skills-pack.mjs";
import { put, REPO_ROOT } from "./pack-fixture";
import { BOM, makeScratchRepo, removeScratchRepo, runScript, toCrlf, treeLines } from "./story-41-1-qa-fixture";

const STEM = "iris-mcp-objectscript-pre-write";
const BEGIN_LINE = `<!-- IRIS-MCP-RULE:${STEM}:BEGIN -->`;
const END_LINE = `<!-- IRIS-MCP-RULE:${STEM}:END -->`;
const MARKER_TEXT = "IRIS-MCP-RULE";

// ---------------------------------------------------------------------------------------------------------
// The installer's real reader and writer, from the built client-config dist.
// ---------------------------------------------------------------------------------------------------------

type Located =
  | { status: "absent" }
  | { status: "one"; start: number; end: number; beginLine: number; endLine: number }
  | { status: "ambiguous"; begins: number[]; ends: number[] };

type Inserted =
  | { ok: true; bytes: Buffer; change: "create" | "insert" | "replace" | "unchanged"; lineEndingAdded: "" | "\n" | "\r\n" }
  | { ok: false; reason: string; location: string };

type Removed = { ok: true; bytes: Buffer | null; change: "remove" | "absent" } | { ok: false; reason: string; location: string };

interface RuleBlockApi {
  locateRuleBlock(host: Uint8Array, stem: string): Located;
  withRuleBlock(host: Uint8Array | null, section: Uint8Array, stem: string): Inserted;
  withoutRuleBlock(host: Uint8Array, stem: string, record: { lineEndingAdded: "" | "\n" | "\r\n"; created: boolean }): Removed;
  describeAmbiguousRuleBlock(stem: string, begins: readonly number[], ends: readonly number[]): string;
}

let api: RuleBlockApi;

beforeAll(async () => {
  const packageDir = join(REPO_ROOT, "packages", "client-config");
  const fresh = checkDistFresh(packageDir, "@iris-mcp/client-config");
  if (!fresh.ok || fresh.skipped) {
    throw new Error(
      `${fresh.reason ?? "@iris-mcp/client-config declares no dist/ build output."} ` +
        'Run "pnpm --filter @iris-mcp/client-config build" and retry.',
    );
  }
  api = (await import(pathToFileURL(join(packageDir, "dist", "rule-block.js")).href)) as RuleBlockApi;
});

function asOne(located: Located): Located & { status: "one" } {
  expect(located.status).toBe("one");
  return located as Located & { status: "one" };
}

/** The real writer's output for a host and a section; the host must be editable. */
function inserted(host: Uint8Array | null, section: Buffer): Inserted & { ok: true } {
  const result = api.withRuleBlock(host, section, STEM);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result as Inserted & { ok: true };
}

/** A section as the form renders it, typed out here: BEGIN, the body, END. */
function sectionOf(stem: string, body: Buffer): Buffer {
  const endsInLineFeed = body.length > 0 && body[body.length - 1] === 0x0a;
  return Buffer.concat([
    Buffer.from(`<!-- IRIS-MCP-RULE:${stem}:BEGIN -->\n`, "latin1"),
    body,
    Buffer.from(`${endsInLineFeed ? "" : "\n"}<!-- IRIS-MCP-RULE:${stem}:END -->\n`, "latin1"),
  ]);
}

const text = (value: string): Buffer => Buffer.from(value, "latin1");

// ---------------------------------------------------------------------------------------------------------
// The real pack bytes.
// ---------------------------------------------------------------------------------------------------------

const CURSOR_FILENAME = ALWAYS_ON_RULE_FILENAME.replace(/\.md$/, ".mdc");
const source = readFileSync(join(REPO_ROOT, RULES_SOURCE_DIR, ALWAYS_ON_RULE_FILENAME));
const claudeCode = readFileSync(join(REPO_ROOT, PACK_DIR, RULE_FORM_DIRS.claudeCode, ALWAYS_ON_RULE_FILENAME));
const cursor = readFileSync(join(REPO_ROOT, PACK_DIR, RULE_FORM_DIRS.cursor, CURSOR_FILENAME));
const form = readFileSync(join(REPO_ROOT, PACK_DIR, RULE_FORM_DIRS.agentsMd, ALWAYS_ON_RULE_FILENAME));
const FORM_LINES = form.toString("latin1").split("\n").length - 1;

describe("the real agents-md form is a section a consumer can find by exact lines (AC 41.2.3)", () => {
  it("opens with the BEGIN line and closes with the END line, each one whole LF-terminated line, and holds no CR", () => {
    const lines = form.toString("utf8").split("\n");
    expect(lines[0]).toBe(BEGIN_LINE);
    expect(lines[lines.length - 1], "the form ends in a line feed").toBe("");
    expect(lines[lines.length - 2]).toBe(END_LINE);
    expect(form.includes(0x0d), "no carriage return").toBe(false);
  });

  it("holds each marker line once, and the marker text nowhere else: not in the rule, not in the other two forms", () => {
    const lines = form.toString("latin1").split("\n");
    expect(lines.filter((line) => line === BEGIN_LINE)).toHaveLength(1);
    expect(lines.filter((line) => line === END_LINE)).toHaveLength(1);
    expect(form.toString("utf8").split(MARKER_TEXT)).toHaveLength(3);
    for (const [label, bytes] of [
      ["the rule source", source],
      ["the claude-code form", claudeCode],
      ["the cursor form", cursor],
    ] as const) {
      expect(bytes.toString("latin1").includes(MARKER_TEXT), `${label} holds the marker text`).toBe(false);
    }
  });

  it("is located as exactly one section that spans the whole form", () => {
    const located = asOne(api.locateRuleBlock(form, STEM));
    expect(located.start).toBe(0);
    expect(located.end).toBe(form.length);
    expect([located.beginLine, located.endLine]).toEqual([1, FORM_LINES]);
  });

  it("is accepted by the writer as a whole section, and creates a file equal to itself", () => {
    const created = inserted(null, form);
    expect(created.change).toBe("create");
    expect(created.bytes.equals(form)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
// A scratch AGENTS.md in each variant: the section found, replaced, and everything else left alone.
// ---------------------------------------------------------------------------------------------------------

const OLD_BODY = text("## Older checklist\r\n\r\n- an earlier bullet\r\n- another one");
const OLD_SECTION = sectionOf(STEM, OLD_BODY);
const OTHER_RULE = sectionOf("other-rule", text("## Another rule\n\n- unrelated\n"));
const PREFIX_NAMED_RULE = sectionOf(`${STEM}-extra`, text("- a rule whose name starts with ours\n"));
const SHORTER_NAMED_RULE = sectionOf("iris-mcp-objectscript-pre-writ", text("- a rule whose name is a prefix of ours\n"));

/** A scratch `AGENTS.md` and the bytes its section occupies in it (the section as the file holds it). */
interface Host {
  name: string;
  host: Buffer;
  region: Buffer;
}

/** The scratch files that hold one section of ours, built around the real form. */
function hostsAround(block: Buffer): Host[] {
  const withoutFinalLf = block.subarray(0, block.length - 1);
  const crlfBlock = toCrlf(block);
  return [
    {
      name: "LF, section in the middle",
      host: Buffer.concat([text("# Project\n\nIntro line.\n\n"), block, text("\n## Other section\n\nMore text.\n")]),
      region: block,
    },
    {
      name: "CRLF throughout, section converted to CRLF",
      host: Buffer.concat([text("# Project\r\n\r\nIntro line.\r\n\r\n"), crlfBlock, text("\r\n## Other section\r\n\r\nMore text.\r\n")]),
      region: crlfBlock,
    },
    {
      name: "CRLF text around an LF section",
      host: Buffer.concat([text("# Project\r\n\r\nIntro line.\r\n\r\n"), block, text("\r\n## Other section\r\n")]),
      region: block,
    },
    {
      name: "a BOM, then LF text",
      host: Buffer.concat([BOM, text("# Project\n\nIntro line.\n\n"), block, text("\n## Other section\n")]),
      region: block,
    },
    {
      name: "a BOM, then the section on line 1",
      host: Buffer.concat([BOM, block, text("\n## Other section\n")]),
      region: block,
    },
    {
      name: "no final newline after the END line",
      host: Buffer.concat([text("# Project\n\n"), withoutFinalLf]),
      region: withoutFinalLf,
    },
    { name: "the section is the first lines", host: Buffer.concat([block, text("\n# Project follows\n")]), region: block },
    { name: "the section is the whole file", host: Buffer.from(block), region: block },
    {
      name: "a different-named section on each side",
      host: Buffer.concat([OTHER_RULE, text("\n"), PREFIX_NAMED_RULE, block, SHORTER_NAMED_RULE, OTHER_RULE]),
      region: block,
    },
    {
      name: "lines that only look like the markers around it",
      host: Buffer.concat([
        text(`  ${BEGIN_LINE}\n${BEGIN_LINE} \n${END_LINE}\t\n<!-- iris-mcp-rule:${STEM}:begin -->\n`),
        text(`Quoted inline: \`${BEGIN_LINE}\` and ${END_LINE} in a sentence.\n<!--${MARKER_TEXT}:${STEM}:BEGIN-->\n\n`),
        block,
        text(`\n    ${END_LINE}\n${BEGIN_LINE}-\n`),
      ]),
      region: block,
    },
  ];
}

describe("a scratch AGENTS.md holds exactly one section, found by exact lines (project rule #58 variants)", () => {
  const variants = hostsAround(form);

  it.each(variants)("$name: located once, and the located bytes are the section as the file holds it", ({ host, region }) => {
    const located = asOne(api.locateRuleBlock(host, STEM));
    expect(host.subarray(located.start, located.end).equals(region)).toBe(true);
  });

  it.each(variants)("$name: the section replaced with the form is found again as the form, and a second replacement changes nothing", ({ host, region }) => {
    const updated = inserted(host, form);
    expect(updated.change).toBe(region.equals(form) ? "unchanged" : "replace");
    const again = asOne(api.locateRuleBlock(updated.bytes, STEM));
    expect(updated.bytes.subarray(again.start, again.end).equals(form)).toBe(true);
    const second = inserted(updated.bytes, form);
    expect(second.change).toBe("unchanged");
    expect(second.bytes.equals(updated.bytes)).toBe(true);
    // A file that already holds the form byte for byte comes back unchanged.
    if (region.equals(form)) expect(updated.bytes.equals(host)).toBe(true);
  });

  it.each(variants)("$name: the section replaced with an older one is found again as that one, and the form restores the file", ({ host }) => {
    const older = inserted(host, OLD_SECTION);
    const again = asOne(api.locateRuleBlock(older.bytes, STEM));
    expect(older.bytes.subarray(again.start, again.end).equals(OLD_SECTION)).toBe(true);
    expect(inserted(older.bytes, form).bytes.equals(inserted(host, form).bytes)).toBe(true);
  });

  it.each(variants)("$name: only the located bytes change; the bytes before and after the section are identical", ({ host }) => {
    const located = asOne(api.locateRuleBlock(host, STEM));
    const updated = inserted(host, OLD_SECTION);
    expect(updated.bytes.subarray(0, located.start).equals(host.subarray(0, located.start))).toBe(true);
    expect(updated.bytes.subarray(updated.bytes.length - (host.length - located.end)).equals(host.subarray(located.end))).toBe(true);
  });

  it.each(variants)("$name: removing the section leaves exactly the bytes around it", ({ host }) => {
    const located = asOne(api.locateRuleBlock(host, STEM));
    const removed = api.withoutRuleBlock(host, STEM, { lineEndingAdded: "", created: false });
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.change).toBe("remove");
      expect(removed.bytes?.equals(Buffer.concat([host.subarray(0, located.start), host.subarray(located.end)]))).toBe(true);
    }
  });

  it("a section in a file with a BOM and CRLF text keeps the BOM and every CR byte", () => {
    const host = Buffer.concat([BOM, text("# Title\r\n\r\n"), form, text("\r\ntail\r\n")]);
    const updated = inserted(host, OLD_SECTION).bytes;
    expect(updated.subarray(0, 3).equals(BOM)).toBe(true);
    expect(updated.subarray(3, 3 + "# Title\r\n\r\n".length).toString("latin1")).toBe("# Title\r\n\r\n");
    expect(updated.subarray(updated.length - "\r\ntail\r\n".length).toString("latin1")).toBe("\r\ntail\r\n");
  });
});

describe("a BOM at byte 0 stays there, and a BEGIN line right after it counts (D7)", () => {
  it("a BEGIN line directly after the BOM is a marker, line 1", () => {
    const host = Buffer.concat([BOM, form]);
    expect(api.locateRuleBlock(host, STEM)).toEqual({ status: "one", start: 3, end: host.length, beginLine: 1, endLine: FORM_LINES });
  });

  it("is kept through insert, replace and remove", () => {
    const plain = Buffer.concat([BOM, text("# Title\r\nlast line without a newline")]);
    const added = inserted(plain, form);
    expect(added.change).toBe("insert");
    expect(added.lineEndingAdded).toBe("\r\n");
    expect(added.bytes.subarray(0, 3).equals(BOM)).toBe(true);

    const replaced = inserted(added.bytes, OLD_SECTION);
    expect(replaced.change).toBe("replace");
    expect(replaced.bytes.subarray(0, 3).equals(BOM)).toBe(true);

    const removed = api.withoutRuleBlock(replaced.bytes, STEM, { lineEndingAdded: added.lineEndingAdded, created: false });
    expect(removed.ok && removed.bytes?.equals(plain)).toBe(true);

    const first = Buffer.concat([BOM, form, text("tail\n")]);
    const gone = api.withoutRuleBlock(first, STEM, { lineEndingAdded: "", created: false });
    expect(gone.ok && gone.bytes?.equals(Buffer.concat([BOM, text("tail\n")]))).toBe(true);
  });

  it("is not counted as part of line 1 when the BOM sits on a later line", () => {
    const host = Buffer.concat([text("first\n"), BOM, text(`${BEGIN_LINE}\nx\n`), BOM, text(`${END_LINE}\n`)]);
    expect(api.locateRuleBlock(host, STEM)).toEqual({ status: "absent" });
  });
});

describe("lines that only look like the markers are not the markers", () => {
  const lookalikes: Array<[string, string]> = [
    ["an indent", `  ${BEGIN_LINE}`],
    ["a tab indent", `\t${END_LINE}`],
    ["trailing spaces", `${BEGIN_LINE}  `],
    ["a trailing tab", `${END_LINE}\t`],
    ["another rule name", "<!-- IRIS-MCP-RULE:other-rule:BEGIN -->"],
    ["a longer rule name", `<!-- IRIS-MCP-RULE:${STEM}-extra:BEGIN -->`],
    ["a shorter rule name", "<!-- IRIS-MCP-RULE:iris-mcp-objectscript-pre-writ:END -->"],
    ["lower case", `<!-- iris-mcp-rule:${STEM}:begin -->`],
    ["no inner spaces", `<!--${MARKER_TEXT}:${STEM}:BEGIN-->`],
    ["text after the marker", `${END_LINE} (managed)`],
    ["text before the marker", `see ${BEGIN_LINE}`],
    ["a Markdown code span", `\`${BEGIN_LINE}\``],
  ];

  it.each(lookalikes)("%s is not found", (_name, line) => {
    expect(api.locateRuleBlock(text(`# Project\n${line}\nbody\n${line}\n`), STEM)).toEqual({ status: "absent" });
  });

  it("a section of another rule is not ours and is left alone when ours is replaced", () => {
    const host = Buffer.concat([OTHER_RULE, text("\n"), form, text("\n"), PREFIX_NAMED_RULE]);
    expect(api.locateRuleBlock(Buffer.concat([OTHER_RULE, PREFIX_NAMED_RULE, SHORTER_NAMED_RULE]), STEM)).toEqual({ status: "absent" });
    const updated = inserted(host, OLD_SECTION).bytes;
    expect(updated.subarray(0, OTHER_RULE.length + 1).equals(Buffer.concat([OTHER_RULE, text("\n")]))).toBe(true);
    expect(updated.subarray(updated.length - PREFIX_NAMED_RULE.length - 1).equals(Buffer.concat([text("\n"), PREFIX_NAMED_RULE]))).toBe(true);
    expect(api.locateRuleBlock(updated, "other-rule").status).toBe("one");
    expect(api.locateRuleBlock(updated, `${STEM}-extra`).status).toBe("one");
  });
});

describe("a missing, repeated or misordered marker is reported with its line numbers, not guessed at", () => {
  const rows: Array<[string, Buffer, number[], number[]]> = [
    ["two sections", Buffer.concat([form, text("\n"), form]), [1, FORM_LINES + 2], [FORM_LINES, 2 * FORM_LINES + 1]],
    ["a BEGIN line with no END line", text(`# Project\n${BEGIN_LINE}\n- text\n`), [2], []],
    ["an END line with no BEGIN line", text(`# Project\n- text\n${END_LINE}\n`), [], [3]],
    ["two BEGIN lines and one END line", Buffer.concat([text(`${BEGIN_LINE}\nold\n`), form]), [1, 3], [2 + FORM_LINES]],
    ["one BEGIN line and two END lines", Buffer.concat([form, text(`${END_LINE}\n`)]), [1], [FORM_LINES, FORM_LINES + 1]],
    ["the END line before the BEGIN line", text(`${END_LINE}\ntext\n${BEGIN_LINE}\n`), [3], [1]],
  ];

  it.each(rows)("%s", (_name, host, begins, ends) => {
    expect(api.locateRuleBlock(host, STEM)).toEqual({ status: "ambiguous", begins, ends });
    const location = api.describeAmbiguousRuleBlock(STEM, begins, ends);
    expect(location).toContain(`the ${STEM} markers are not one BEGIN line followed by one END line`);
    expect(api.withRuleBlock(host, form, STEM)).toEqual({ ok: false, reason: "ambiguous", location });
    expect(api.withoutRuleBlock(host, STEM, { lineEndingAdded: "", created: false })).toEqual({ ok: false, reason: "ambiguous", location });
  });

  it("a file with no marker line holds no section", () => {
    expect(api.locateRuleBlock(text("# Project\n\nNo managed block here.\n"), STEM)).toEqual({ status: "absent" });
    expect(api.locateRuleBlock(Buffer.alloc(0), STEM)).toEqual({ status: "absent" });
  });
});

describe("adding the form to a file that has no section of ours", () => {
  it.each([
    ["an LF file", text("# Project\n\nSome notes.\n"), ""],
    ["a CRLF file", text("# Project\r\n\r\nSome notes.\r\n"), ""],
    ["a file with no final newline", text("# Project\n\nSome notes. No final newline"), "\n"],
    ["a CRLF file with no final newline", text("# Project\r\n\r\nNotes without the last break"), "\r\n"],
    ["a BOM file", Buffer.concat([BOM, text("# Project\n")]), ""],
    ["an empty file", Buffer.alloc(0), ""],
  ] as const)("%s: the real insert is found once, the file's own bytes stay as the prefix, and the ending is in its style", (_name, host, ending) => {
    const grown = inserted(host, form);
    expect(grown.change).toBe("insert");
    expect(grown.lineEndingAdded).toBe(ending);
    expect(grown.bytes.subarray(0, host.length).equals(host)).toBe(true);
    expect(grown.bytes.subarray(host.length, host.length + ending.length).toString("latin1")).toBe(ending);
    const located = asOne(api.locateRuleBlock(grown.bytes, STEM));
    expect(grown.bytes.subarray(located.start, located.end).equals(form)).toBe(true);
    expect(located.end).toBe(grown.bytes.length);
    // And it comes out again exactly.
    const removed = api.withoutRuleBlock(grown.bytes, STEM, { lineEndingAdded: grown.lineEndingAdded, created: false });
    expect(removed.ok && removed.bytes?.equals(host)).toBe(true);
  });

  it("the real insert into a file with no final newline ends the line first and finds BEGIN as a whole line; appending the bytes naively does not", () => {
    const host = text("# Project\n\nNo final newline");
    const naive = Buffer.concat([host, form]);
    expect(api.locateRuleBlock(naive, STEM).status).not.toBe("one");
    const real = inserted(host, form);
    expect(real.bytes.equals(Buffer.concat([host, text("\n"), form]))).toBe(true);
    expect(asOne(api.locateRuleBlock(real.bytes, STEM)).beginLine).toBe(4);
    // The form itself must start with its BEGIN line, which is why the line ending is the writer's to add.
    expect(form.toString("latin1").startsWith(`${BEGIN_LINE}\n`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
// gen:pack and a rule body that holds a marker line (real CLI, scratch copy of the repository).
// ---------------------------------------------------------------------------------------------------------

describe("gen:pack refuses a rule body that holds a marker line (scratch copy)", () => {
  let scratch = "";
  beforeAll(() => {
    scratch = makeScratchRepo();
  });
  afterAll(() => {
    removeScratchRepo(scratch);
  });

  it.each([
    ["its own END line", "quotes-end", (stem: string) => `## A rule\n\n<!-- IRIS-MCP-RULE:${stem}:END -->\n\n- text\n`],
    ["its own BEGIN line", "quotes-begin", (stem: string) => `## A rule\n\n<!-- IRIS-MCP-RULE:${stem}:BEGIN -->\n\n- text\n`],
    ["another rule's marker line, CRLF", "quotes-other", (_stem: string) => "## A rule\r\n<!-- IRIS-MCP-RULE:other-rule:BEGIN -->\r\n"],
  ] as const)("a body that holds %s exits 1, names the file, and writes nothing", (_name, stem, body) => {
    const source = `${RULES_SOURCE_DIR}/${stem}.md`;
    put(scratch, source, body(stem));
    try {
      const before = treeLines(scratch);
      for (const args of [[], ["--check"]]) {
        const run = runScript(scratch, "scripts/gen-pack.mjs", args);
        expect(run.status, `gen-pack ${args.join(" ")}`).toBe(1);
        expect(run.stderr).toContain(`${source} has a line that starts with "<!-- IRIS-MCP-RULE:"`);
      }
      expect(treeLines(scratch), "nothing was written").toEqual(before);
    } finally {
      rmSync(join(scratch, source), { force: true });
    }
    expect(runScript(scratch, "scripts/gen-pack.mjs", ["--check"]).status, "clean again once the source is removed").toBe(0);
  });
});
