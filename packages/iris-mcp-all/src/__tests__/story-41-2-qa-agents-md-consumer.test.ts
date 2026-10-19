/**
 * Story 41.2 QA (AC 41.2.3) - the `agents-md` pack form, read the way a consumer of `AGENTS.md` will read it.
 *
 * The form is a section: a BEGIN marker line, the rule, an END marker line. A consumer (Story 41.6's installer) finds
 * that section in a user's own `AGENTS.md` by matching the two marker lines as exact whole lines, owns everything
 * between them, and leaves every other byte alone. This file pins the form against that reading. It is a contract
 * test of the pack bytes, not an installer: `locateBlock` below is a deliberately small reference reader, and the
 * marker strings are typed out here so nothing is derived from the module under test.
 *
 * Pinned:
 *  - the real form: BEGIN on line 1, END on the last line, each one whole line ending in LF, each once, and no other
 *    line of the form (or of the source, or of the `claude-code` form) holds the marker text;
 *  - a scratch `AGENTS.md` in each variant of project rule #58 (LF, CRLF, a BOM, no final newline, the section first,
 *    last or alone) holds exactly one section, found by the exact lines, whose bytes are the section as the file holds
 *    it; replacing it with the same form changes no byte, and a replaced section is found again;
 *  - lines that only look like a marker (a different rule name, an indent, trailing blanks, another case, the text
 *    inside a sentence) are not found, and a section of another rule is left alone;
 *  - a missing or repeated marker is not "one section": the reader reports it instead of choosing;
 *  - the form starts with its BEGIN line, so appending it to a file that does not end in a line break produces no
 *    marker line: a consumer has to add the line break first;
 *  - gen:pack refuses a rule source with a line that starts like a marker line (real CLI, scratch copy), so a
 *    generated section never holds a third marker line.
 *
 * No IRIS and no network. Scratch files live under `os.tmpdir()` and are removed by the test that made them.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
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
// The reference reader: exact whole-line markers, bytes kept as they are.
// ---------------------------------------------------------------------------------------------------------

interface Line {
  /** Byte offset of the first byte of the line. */
  start: number;
  /** Byte offset just past the line's terminator (the end of the file for an unterminated last line). */
  end: number;
  /** The line without its terminator: no LF, and no CR before the LF. Latin-1, so one character per byte. */
  text: string;
}

function linesOf(host: Buffer): Line[] {
  const text = host.toString("latin1");
  const lines: Line[] = [];
  let start = 0;
  while (start < text.length) {
    const lf = text.indexOf("\n", start);
    const end = lf === -1 ? text.length : lf + 1;
    let body = text.slice(start, lf === -1 ? text.length : lf);
    if (body.endsWith("\r")) body = body.slice(0, -1);
    lines.push({ start, end, text: body });
    start = end;
  }
  return lines;
}

type Located =
  | { status: "absent" }
  | { status: "one"; start: number; end: number }
  | { status: "ambiguous"; begins: number; ends: number };

/** The one section of `stem` in `host`: from its BEGIN line to the end of its END line. */
function locateBlock(host: Buffer, stem: string): Located {
  const begin = `<!-- IRIS-MCP-RULE:${stem}:BEGIN -->`;
  const end = `<!-- IRIS-MCP-RULE:${stem}:END -->`;
  const lines = linesOf(host);
  const begins = lines.filter((line) => line.text === begin);
  const ends = lines.filter((line) => line.text === end);
  if (begins.length === 0 && ends.length === 0) return { status: "absent" };
  const first = begins[0];
  const last = ends[0];
  if (begins.length === 1 && ends.length === 1 && first !== undefined && last !== undefined && first.start < last.start) {
    return { status: "one", start: first.start, end: last.end };
  }
  return { status: "ambiguous", begins: begins.length, ends: ends.length };
}

/** `host` with the bytes of the located section replaced by `section`. */
function replaceBlock(host: Buffer, located: Located & { status: "one" }, section: Buffer): Buffer {
  return Buffer.concat([host.subarray(0, located.start), section, host.subarray(located.end)]);
}

function asOne(located: Located): Located & { status: "one" } {
  expect(located.status).toBe("one");
  return located as Located & { status: "one" };
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

const source = readFileSync(join(REPO_ROOT, RULES_SOURCE_DIR, ALWAYS_ON_RULE_FILENAME));
const claudeCode = readFileSync(join(REPO_ROOT, PACK_DIR, RULE_FORM_DIRS.claudeCode, ALWAYS_ON_RULE_FILENAME));
const form = readFileSync(join(REPO_ROOT, PACK_DIR, RULE_FORM_DIRS.agentsMd, ALWAYS_ON_RULE_FILENAME));

describe("the real agents-md form is a section a consumer can find by exact lines (AC 41.2.3)", () => {
  it("opens with the BEGIN line and closes with the END line, each one whole LF-terminated line, and holds no CR", () => {
    const lines = form.toString("utf8").split("\n");
    expect(lines[0]).toBe(BEGIN_LINE);
    expect(lines[lines.length - 1], "the form ends in a line feed").toBe("");
    expect(lines[lines.length - 2]).toBe(END_LINE);
    expect(form.includes(0x0d), "no carriage return").toBe(false);
  });

  it("holds each marker line once, and the marker text nowhere else: not in the rule, not in the claude-code form", () => {
    const lines = linesOf(form);
    expect(lines.filter((line) => line.text === BEGIN_LINE)).toHaveLength(1);
    expect(lines.filter((line) => line.text === END_LINE)).toHaveLength(1);
    expect(form.toString("utf8").split(MARKER_TEXT)).toHaveLength(3);
    for (const [label, bytes] of [
      ["the rule source", source],
      ["the claude-code form", claudeCode],
    ] as const) {
      expect(bytes.toString("latin1").includes(MARKER_TEXT), `${label} holds the marker text`).toBe(false);
    }
  });

  it("is located as exactly one section that spans the whole form", () => {
    const located = asOne(locateBlock(form, STEM));
    expect(located.start).toBe(0);
    expect(located.end).toBe(form.length);
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
    const located = asOne(locateBlock(host, STEM));
    expect(host.subarray(located.start, located.end).equals(region)).toBe(true);
  });

  it.each(variants)("$name: the section replaced with the form is found again as the form, and a second replacement changes nothing", ({ host, region }) => {
    const located = asOne(locateBlock(host, STEM));
    const updated = replaceBlock(host, located, form);
    const again = asOne(locateBlock(updated, STEM));
    expect(updated.subarray(again.start, again.end).equals(form)).toBe(true);
    expect(replaceBlock(updated, again, form).equals(updated)).toBe(true);
    // A file that already holds the form byte for byte comes back unchanged.
    if (region.equals(form)) expect(updated.equals(host)).toBe(true);
  });

  it.each(variants)("$name: the section replaced with an older one is found again as that one, and the form restores the file", ({ host }) => {
    const located = asOne(locateBlock(host, STEM));
    const updated = replaceBlock(host, located, OLD_SECTION);
    const again = asOne(locateBlock(updated, STEM));
    expect(updated.subarray(again.start, again.end).equals(OLD_SECTION)).toBe(true);
    expect(replaceBlock(updated, again, form).equals(replaceBlock(host, located, form))).toBe(true);
  });

  it("a section in a file with a BOM and CRLF text keeps the BOM and every CR byte", () => {
    const host = Buffer.concat([BOM, text("# Title\r\n\r\n"), form, text("\r\ntail\r\n")]);
    const updated = replaceBlock(host, asOne(locateBlock(host, STEM)), OLD_SECTION);
    expect(updated.subarray(0, 3).equals(BOM)).toBe(true);
    expect(updated.subarray(3, 3 + "# Title\r\n\r\n".length).toString("latin1")).toBe("# Title\r\n\r\n");
    expect(updated.subarray(updated.length - "\r\ntail\r\n".length).toString("latin1")).toBe("\r\ntail\r\n");
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
    expect(locateBlock(text(`# Project\n${line}\nbody\n${line}\n`), STEM)).toEqual({ status: "absent" });
  });

  it("a section of another rule is not ours and is left alone when ours is replaced", () => {
    const host = Buffer.concat([OTHER_RULE, text("\n"), form, text("\n"), PREFIX_NAMED_RULE]);
    expect(locateBlock(Buffer.concat([OTHER_RULE, PREFIX_NAMED_RULE, SHORTER_NAMED_RULE]), STEM)).toEqual({ status: "absent" });
    const located = asOne(locateBlock(host, STEM));
    const updated = replaceBlock(host, located, OLD_SECTION);
    expect(updated.subarray(0, OTHER_RULE.length + 1).equals(Buffer.concat([OTHER_RULE, text("\n")]))).toBe(true);
    expect(updated.subarray(updated.length - PREFIX_NAMED_RULE.length - 1).equals(Buffer.concat([text("\n"), PREFIX_NAMED_RULE]))).toBe(true);
    expect(locateBlock(updated, "other-rule").status).toBe("one");
    expect(locateBlock(updated, `${STEM}-extra`).status).toBe("one");
  });
});

describe("a missing or repeated marker is reported, not guessed at", () => {
  it.each([
    ["two sections", Buffer.concat([form, text("\n"), form]), 2, 2],
    ["a BEGIN line with no END line", text(`# Project\n${BEGIN_LINE}\n- text\n`), 1, 0],
    ["an END line with no BEGIN line", text(`# Project\n- text\n${END_LINE}\n`), 0, 1],
    ["two BEGIN lines and one END line", Buffer.concat([text(`${BEGIN_LINE}\nold\n`), form]), 2, 1],
    ["the END line before the BEGIN line", text(`${END_LINE}\ntext\n${BEGIN_LINE}\n`), 1, 1],
  ])("%s", (_name, host, begins, ends) => {
    const located = locateBlock(host, STEM);
    expect(located.status).toBe("ambiguous");
    if (located.status === "ambiguous") expect([located.begins, located.ends]).toEqual([begins, ends]);
  });

  it("a file with no marker line holds no section", () => {
    expect(locateBlock(text("# Project\n\nNo managed block here.\n"), STEM)).toEqual({ status: "absent" });
    expect(locateBlock(Buffer.alloc(0), STEM)).toEqual({ status: "absent" });
  });
});

describe("adding the form to a file that has no section of ours", () => {
  /** What a consumer must do first: end the last line, in the file's own style. */
  function endLine(host: Buffer): Buffer {
    if (host.length === 0 || host[host.length - 1] === 0x0a) return host;
    return Buffer.concat([host, text(host.includes(text("\r\n")) ? "\r\n" : "\n")]);
  }

  it.each([
    ["an LF file", text("# Project\n\nSome notes.\n")],
    ["a CRLF file", text("# Project\r\n\r\nSome notes.\r\n")],
    ["a file with no final newline", text("# Project\n\nSome notes. No final newline")],
    ["a CRLF file with no final newline", text("# Project\r\n\r\nNotes without the last break")],
    ["a BOM file", Buffer.concat([BOM, text("# Project\n")])],
    ["an empty file", Buffer.alloc(0)],
  ])("%s: the form appended after a line break is found once, and the file's own bytes stay as the prefix", (_name, host) => {
    const grown = Buffer.concat([endLine(host), form]);
    expect(grown.subarray(0, host.length).equals(host)).toBe(true);
    const located = asOne(locateBlock(grown, STEM));
    expect(grown.subarray(located.start, located.end).equals(form)).toBe(true);
    expect(located.end).toBe(grown.length);
  });

  it("the form appended straight to a file with no final newline puts BEGIN inside the last line, so no marker line exists", () => {
    const host = text("# Project\n\nNo final newline");
    const naive = Buffer.concat([host, form]);
    expect(linesOf(naive).some((line) => line.text === BEGIN_LINE)).toBe(false);
    expect(locateBlock(naive, STEM).status).not.toBe("one");
    // The remedy is a consumer's, because the form itself must start with its BEGIN line.
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
