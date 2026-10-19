/**
 * Story 41.6 QA (Rule #58) - adversarial host bytes beyond the spec's matrix, through the BUILT bin.
 *
 * Each fixture is an existing `AGENTS.md` (client `codex`) or `GEMINI.md` (client `gemini`) in a temp project, and
 * every one ends in one of three outcomes, each asserted byte for byte:
 *
 *  - round trip: install adds the block in the host's own line-ending style; uninstall gives back the original bytes;
 *  - owned block: the host already holds a block of our rule (a hand-written copy, an edited one, one with CRLF
 *    markers, one whose END marker is the last line with no newline). Install adopts or replaces exactly that block;
 *    uninstall removes it, so what remains is the bytes outside it;
 *  - refused: a UTF-16 byte-order mark or ambiguous markers. Exit 1 with a clear message and nothing written.
 *
 * The expected bytes are built in this file from the pack read straight from disk (an independent oracle), with the
 * expected line ending written down per fixture, never derived from the installer's own rule.
 */

import { readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { makeSandbox, removeSandboxes, writeProjectFile, type Sandbox } from "./pack-test-helpers.js";
import {
  assertBinFresh,
  filesUnder,
  lstatTree,
  packRuleForms,
  RULE_STEM,
  runBin as spawnBin,
  sha256,
  SPAWN_TEST_TIMEOUT,
  treeDiff,
  type RunResult,
} from "./qa-41-6-helpers.js";

beforeAll(assertBinFresh);

/** Everything the bin printed during the current test; no run may echo the user's text around our block. */
const printed: string[] = [];
const USER_TEXT = ["# mine", "line two", "# before", "# after", "user file", "EDITED BY HAND"];

function runBin(sandbox: Sandbox, args: string[]): RunResult {
  const result = spawnBin(sandbox, args);
  printed.push(result.stdout, result.stderr);
  return result;
}

afterEach(() => {
  const output = printed.splice(0).join("\n");
  removeSandboxes();
  for (const text of USER_TEXT) expect(output.includes(text), `the bin echoed the user's text ${JSON.stringify(text)}`).toBe(false);
});

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const SECTION = packRuleForms().agentsMd;
const LF = 0x0a;
const text = (value: string): Buffer => Buffer.from(value, "utf8");

/** The number of lines in `bytes`: its LF bytes, plus one when the last line has no LF. */
function lineCount(bytes: Buffer): number {
  let lfs = 0;
  for (const byte of bytes) if (byte === LF) lfs += 1;
  return lfs + (bytes.length > 0 && bytes[bytes.length - 1] !== LF ? 1 : 0);
}

/** `count` bytes of a fixed pseudo-random stream with no CR or LF, ending in bytes that are not valid UTF-8. */
function noisyBytes(count: number): Buffer {
  const out = Buffer.alloc(count);
  let state = 12345;
  for (let index = 0; index < count; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const byte = (state >> 16) & 0xff;
    out[index] = byte === 0x0a || byte === 0x0d ? 0x20 : byte;
  }
  out.set([0xff, 0xfe, 0x80, 0x41], count - 4);
  return out;
}

interface Fixture {
  name: string;
  host: Buffer;
  /** The host's bytes after an install. */
  installed: Buffer;
  /** The host's bytes after the uninstall that follows. */
  afterUninstall: Buffer;
  /** The preview line the host gets. */
  preview: string;
}

const insertDetail = (ending: string): string =>
  ending === "" ? `add the ${RULE_STEM} block at the end` : `end the last line, then add the ${RULE_STEM} block at the end`;

/** A host without our block: install appends `ending` (written down by the caller) then the section. */
function roundTrip(name: string, host: Buffer, ending: "" | "\n" | "\r\n"): Fixture {
  return {
    name,
    host,
    installed: Buffer.concat([host, text(ending), SECTION]),
    afterUninstall: host,
    preview: `update    @HOST@ (${insertDetail(ending)})`,
  };
}

/** A host that already holds a block (`block`) between `prefix` and `suffix`, both without our markers. */
function owned(name: string, prefix: Buffer, block: Buffer, suffix: Buffer): Fixture {
  const beginLine = lineCount(prefix) + 1;
  const endLine = beginLine + lineCount(block) - 1;
  return {
    name,
    host: Buffer.concat([prefix, block, suffix]),
    installed: Buffer.concat([prefix, SECTION, suffix]),
    afterUninstall: Buffer.concat([prefix, suffix]),
    preview: block.equals(SECTION)
      ? "adopt     @HOST@ (already identical to the skills pack; recorded as installed)"
      : `update    @HOST@ (replace the ${RULE_STEM} block, lines ${beginLine}-${endLine})`,
  };
}

const firstLf = SECTION.indexOf(LF);
const editedBlock = Buffer.concat([SECTION.subarray(0, firstLf + 1), text("EDITED BY HAND\n"), SECTION.subarray(firstLf + 1)]);
const crlfBlock = text(SECTION.toString("utf8").replace(/\n/g, "\r\n"));
const sectionNoFinalLf = SECTION.subarray(0, SECTION.length - 1);
const mib = 1048576;

const FIXTURES: Fixture[] = [
  // --- hosts without our block: install, then uninstall gives back the original bytes ---
  roundTrip("a host that is only a BOM", BOM, ""),
  roundTrip("BOM with no newline", Buffer.concat([BOM, text("abc")]), "\n"),
  roundTrip("lone CR line endings, last line terminated by CR", text("a\rb\rc\r"), "\n"),
  roundTrip("lone CR line endings, unterminated", text("a\rb\rc"), "\n"),
  roundTrip("a single CR", text("\r"), "\n"),
  roundTrip("a single CRLF", text("\r\n"), ""),
  roundTrip("mixed CRLF and LF, unterminated: the host holds CRLF, so CRLF is added", text("a\r\nb\nc\r\nd"), "\r\n"),
  roundTrip("mixed LF then CRLF, terminated", text("a\nb\r\n"), ""),
  roundTrip("mixed CRLF then LF, unterminated", text("a\r\nb\nlast"), "\r\n"),
  roundTrip("NUL bytes inside text", Buffer.concat([text("a"), Buffer.from([0]), text("b\n"), Buffer.from([0, 0]), text("\nend")]), "\n"),
  roundTrip("NUL bytes only", Buffer.from([0, 0, 0, 0]), "\n"),
  roundTrip("UTF-16LE text without a BOM", Buffer.from("# Mine\n\nline\n", "utf16le"), "\n"),
  roundTrip("1 MB of LF lines, last line unterminated", Buffer.from(`${"fifteen bytes.\n".repeat(69905)}tail`), "\n"),
  roundTrip("1 MB of LF lines ending in LF", Buffer.from("fifteen chars!!\n".repeat(mib / 16)), ""),
  roundTrip("1 MB single line, no newline", Buffer.alloc(mib, 0x61), "\n"),
  roundTrip("1 MB of CRLF", text("\r\n".repeat(mib / 2)), ""),
  roundTrip("1 MB of pseudo-random bytes with invalid UTF-8 at the end", noisyBytes(mib), "\n"),

  // --- hosts that already hold our block ---
  owned("a hand-written copy of the pack's form, first in the file", Buffer.alloc(0), SECTION, text("# after\n")),
  owned("a hand-written copy of the pack's form, in the middle", text("# before\n"), SECTION, text("# after\n")),
  owned("a hand-written copy of the pack's form, last", text("# before\n"), SECTION, Buffer.alloc(0)),
  owned("a hand-written copy of the pack's form, the whole file", Buffer.alloc(0), SECTION, Buffer.alloc(0)),
  owned("a hand-written copy of the pack's form, right after a BOM", BOM, SECTION, text("# after\n")),
  owned("a hand-written copy after 1 MB of user text", Buffer.from("x".repeat(mib - 1) + "\n"), SECTION, Buffer.alloc(0)),
  owned("a hand-written copy whose body was edited", text("# before\r\n"), editedBlock, text("# after\r\n")),
  owned("our END marker as the last line, with no newline", text("# mine\n"), sectionNoFinalLf, Buffer.alloc(0)),
  owned("only our block, END marker unterminated", Buffer.alloc(0), sectionNoFinalLf, Buffer.alloc(0)),
  owned("our markers and body in CRLF inside an otherwise LF file", text("# mine\nline two\n"), crlfBlock, text("tail\n")),
  owned("our block in CRLF at the end of a CRLF file", text("# mine\r\n"), crlfBlock, Buffer.alloc(0)),
  owned(
    "documentation that quotes both marker lines in a code fence",
    text("```\n"),
    text(`<!-- IRIS-MCP-RULE:${RULE_STEM}:BEGIN -->\nexample\n<!-- IRIS-MCP-RULE:${RULE_STEM}:END -->\n`),
    text("```\n"),
  ),
];

const HOSTS: Array<{ client: "codex" | "gemini"; displayName: string; file: "AGENTS.md" | "GEMINI.md"; other: "AGENTS.md" | "GEMINI.md" }> = [
  { client: "codex", displayName: "Codex CLI", file: "AGENTS.md", other: "GEMINI.md" },
  { client: "gemini", displayName: "Gemini CLI", file: "GEMINI.md", other: "AGENTS.md" },
];

describe("fixture sanity", () => {
  it("the 1 MB fixtures are 1 MB, and no fixture is an accident of an empty oracle", () => {
    const big = FIXTURES.filter((fixture) => fixture.name.startsWith("1 MB") || fixture.name.includes("1 MB"));
    expect(big.length).toBeGreaterThanOrEqual(6);
    for (const fixture of big) expect(fixture.host.length, fixture.name).toBeGreaterThanOrEqual(mib - 1);
    expect(new Set(FIXTURES.map((fixture) => fixture.name)).size).toBe(FIXTURES.length);
    for (const fixture of FIXTURES) expect(fixture.installed.equals(fixture.afterUninstall), fixture.name).toBe(false);
  });
});

describe.each(HOSTS)("$file ($client) on the built bin", (route) => {
  it.each(FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s",
    (_name, fixture) => {
      const sandbox = makeSandbox();
      const hostPath = path.join(sandbox.project, route.file);
      writeFileSync(hostPath, fixture.host);
      writeProjectFile(sandbox.project, "keep/me.txt", "user file\n");
      const original = lstatTree(sandbox.project, { modes: true });
      const previewLine = fixture.preview.replace("@HOST@", route.file);

      // Dry run: the host's line is in the preview and nothing changes.
      const dry = runBin(sandbox, ["skills", "install", "--client", route.client, "--dry-run"]);
      expect(dry.status, dry.stderr).toBe(0);
      expect(dry.stdout).toContain(`  ${previewLine}\n`);
      expect(treeDiff(original, lstatTree(sandbox.project, { modes: true }))).toEqual([]);

      // Install: the block lands, the bytes around it are the user's.
      const installed = runBin(sandbox, ["skills", "install", "--client", route.client, "--yes"]);
      expect(installed.status, installed.stderr).toBe(0);
      expect(readFileSync(hostPath).equals(fixture.installed), "host bytes after install").toBe(true);
      expect(statSync(path.join(sandbox.project, route.other), { throwIfNoEntry: false })).toBeUndefined();

      // Re-install: nothing to change, and the host is not rewritten.
      const past = new Date("2001-01-01T00:00:00Z");
      utimesSync(hostPath, past, past);
      const again = runBin(sandbox, ["skills", "install", "--client", route.client]);
      expect(again.status, again.stderr).toBe(0);
      expect(again.stdout).toContain(`Nothing to change for ${route.displayName}: the skills pack is already installed.\n`);
      expect(statSync(hostPath).mtimeMs).toBe(past.getTime());
      expect(readFileSync(hostPath).equals(fixture.installed)).toBe(true);

      // Uninstall: exactly the bytes outside the block, and every other path as it was.
      const removed = runBin(sandbox, ["skills", "uninstall", "--client", route.client, "--yes"]);
      expect(removed.status, removed.stderr).toBe(0);
      const finalHost = readFileSync(hostPath);
      expect(finalHost.equals(fixture.afterUninstall), "host bytes after uninstall").toBe(true);
      const expected = new Map(original);
      expected.set(route.file, `file:${sha256(fixture.afterUninstall)}`);
      expect(treeDiff(expected, lstatTree(sandbox.project, { modes: true }))).toEqual([]);
    },
    SPAWN_TEST_TIMEOUT,
  );
});

describe("hosts the installer refuses, on the built bin", () => {
  const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("# Mine\n", "utf16le")]);
  const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from([0x00, 0x23, 0x00, 0x0a])]);

  it.each([
    ["UTF-16LE with a BOM", utf16le],
    ["UTF-16BE with a BOM", utf16be],
  ])("%s: install and dry run exit 1 naming the file, and nothing is written", (_name, host) => {
    for (const route of HOSTS) {
      const sandbox = makeSandbox();
      writeFileSync(path.join(sandbox.project, route.file), host);
      const original = lstatTree(sandbox.project, { modes: true });
      for (const args of [["--dry-run"], ["--yes"]]) {
        const run = runBin(sandbox, ["skills", "install", "--client", route.client, ...args]);
        expect(run.status, `${route.file} ${args.join(" ")}`).toBe(1);
        expect(run.stdout).toContain(
          `  conflict  ${route.file} (the file starts with a UTF-16 byte-order mark, which this installer does not edit; save it as UTF-8, then re-run)\n`,
        );
        expect(treeDiff(original, lstatTree(sandbox.project, { modes: true }))).toEqual([]);
      }
      expect(filesUnder(sandbox.home).size, "no backup, no state").toBe(0);
    }
  }, SPAWN_TEST_TIMEOUT);

  it("a host the user re-saved as UTF-16 after the install makes the uninstall exit 1 and leaves the whole tree alone", () => {
    const sandbox = makeSandbox();
    expect(runBin(sandbox, ["skills", "install", "--client", "codex", "--yes"]).status).toBe(0);
    writeFileSync(path.join(sandbox.project, "AGENTS.md"), utf16le);
    const before = lstatTree(sandbox.project, { modes: true });
    const run = runBin(sandbox, ["skills", "uninstall", "--client", "codex", "--yes"]);
    expect(run.status, run.stderr).toBe(1);
    expect(run.stdout).toContain("  conflict  AGENTS.md (the file starts with a UTF-16 byte-order mark");
    expect(treeDiff(before, lstatTree(sandbox.project, { modes: true }))).toEqual([]);
  }, SPAWN_TEST_TIMEOUT);

  const begin = `<!-- IRIS-MCP-RULE:${RULE_STEM}:BEGIN -->`;
  const end = `<!-- IRIS-MCP-RULE:${RULE_STEM}:END -->`;
  const conflict = (beginLines: string): string =>
    `  conflict  GEMINI.md (the ${RULE_STEM} markers are not one BEGIN line followed by one END line: ${beginLines}; fix them by hand, then re-run)\n`;

  it("ambiguous markers (BOM, CRLF, two BEGIN lines and one END) exit 1 on install and dry run, naming the line numbers, with nothing written", () => {
    const sandbox = makeSandbox();
    writeFileSync(path.join(sandbox.project, "GEMINI.md"), Buffer.concat([BOM, text(`${begin}\r\nfirst\r\n${begin}\r\nsecond\r\n${end}\r\n`)]));
    const before = lstatTree(sandbox.project, { modes: true });
    for (const args of [["--dry-run"], ["--yes"]]) {
      const run = runBin(sandbox, ["skills", "install", "--client", "gemini", ...args]);
      expect(run.status, args.join(" ")).toBe(1);
      expect(run.stdout, args.join(" ")).toContain(conflict("BEGIN at line(s) 1, 3, END at line(s) 5"));
      expect(treeDiff(before, lstatTree(sandbox.project, { modes: true })), args.join(" ")).toEqual([]);
    }
    expect(filesUnder(sandbox.home).size).toBe(0);
  }, SPAWN_TEST_TIMEOUT);

  it("markers the user damaged after the install (a second END line) make uninstall, dry run and re-install exit 1, with nothing written", () => {
    const sandbox = makeSandbox();
    writeFileSync(path.join(sandbox.project, "GEMINI.md"), text("# mine\n"));
    expect(runBin(sandbox, ["skills", "install", "--client", "gemini", "--yes"]).status).toBe(0);
    const installed = readFileSync(path.join(sandbox.project, "GEMINI.md"));
    writeFileSync(path.join(sandbox.project, "GEMINI.md"), Buffer.concat([installed, text(`${end}\n`)]));
    const before = lstatTree(sandbox.project, { modes: true });
    const backups = filesUnder(sandbox.home).size;
    const beginLine = lineCount(text("# mine\n")) + 1;
    const firstEnd = beginLine + lineCount(SECTION) - 1;
    for (const args of [
      ["uninstall", "--yes"],
      ["uninstall", "--dry-run"],
      ["install", "--yes"],
    ]) {
      const run = runBin(sandbox, ["skills", ...args, "--client", "gemini"]);
      expect(run.status, args.join(" ")).toBe(1);
      expect(run.stdout, args.join(" ")).toContain(conflict(`BEGIN at line(s) ${beginLine}, END at line(s) ${firstEnd}, ${firstEnd + 1}`));
      expect(treeDiff(before, lstatTree(sandbox.project, { modes: true })), args.join(" ")).toEqual([]);
      expect(filesUnder(sandbox.home).size, args.join(" ")).toBe(backups);
    }
  }, SPAWN_TEST_TIMEOUT);
});
