/**
 * Story 40.2 -- the Cobertura document and its guarded write (`cobertura.ts`).
 *
 * Oracles (Rule #36): the golden file `fixtures/cobertura/story402-oracle.xml` is the document for `STORY402_RUN` (the live
 * Status record of the Story 40.2 oracle run, `story402-run.ts`). Its line numbers and hits were checked by hand against the raw
 * stored class documents (class line 31 is `Quit "error"`, the one line the test does not reach) and the document was
 * validated against the pinned `coverage-04.dtd` with `xmllint --nonet --dtdvalid` on 2026-10-18 (exit 0; a copy with the
 * `hits` attribute removed exits 3). The in-repo validator `scripts/lib/cobertura-dtd.mjs` encodes that DTD's content model
 * (decision #52); it is loaded by path because it lies outside this package.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildCoberturaXml,
  escapeXml,
  formatRate,
  validateOutputPath,
  writeCoberturaFile,
} from "../tools/cobertura.js";
import { buildCoverageSection, type CoverageRun } from "../tools/test-coverage.js";
import { STORY402_RUN } from "./story402-run.js";

const here = path.dirname(fileURLToPath(import.meta.url));

interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  text: string;
}

interface Dtd {
  validateCobertura(text: string): string[];
  parseXml(text: string): { root: XmlElement };
}

const dtdUrl = pathToFileURL(path.resolve(here, "../../../../scripts/lib/cobertura-dtd.mjs")).href;
const dtd = (await import(/* @vite-ignore */ dtdUrl)) as Dtd;

const GOLDEN = readFileSync(path.join(here, "fixtures", "cobertura", "story402-oracle.xml"), "utf8");

function build(run: CoverageRun, options: { sourceRoot?: string } = {}) {
  return buildCoberturaXml(run, buildCoverageSection(run), { version: "0.0.2", ...options });
}

/** The elements named `name` below `element`, depth first. */
function all(element: XmlElement, name: string): XmlElement[] {
  return [...(element.name === name ? [element] : []), ...element.children.flatMap((child) => all(child, name))];
}

describe("buildCoberturaXml (AC 40.2.3)", () => {
  it("builds the golden document for the live oracle run, byte for byte, and counts 2 classes and 27 lines", () => {
    const document = build(STORY402_RUN);
    expect(document.xml).toBe(GOLDEN);
    expect(document.classes).toBe(2);
    expect(document.lines).toBe(27);
  });

  it("is deterministic: the same run builds the same bytes whatever the clock says, and the timestamp is the run's finishedAt in epoch milliseconds", () => {
    const expected = String(Date.parse("2026-10-18T08:31:17.953Z"));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
      const first = build(STORY402_RUN).xml;
      vi.setSystemTime(new Date("2031-06-15T12:34:56.789Z"));
      const second = build(STORY402_RUN).xml;
      expect(second, "the clock at build time is not part of the document").toBe(first);
      expect(dtd.parseXml(first).root.attributes["timestamp"]).toBe(expected);
    } finally {
      vi.useRealTimers();
    }
    expect(GOLDEN).toContain(`timestamp="${expected}"`);
  });

  it("validates against the pinned DTD's content model", () => {
    expect(dtd.validateCobertura(GOLDEN)).toEqual([]);
    expect(dtd.validateCobertura(build(STORY402_RUN, { sourceRoot: "src" }).xml)).toEqual([]);
  });

  it("parsed back, its packages, classes, methods, line numbers and hits equal the run's class-source data", () => {
    const root = dtd.parseXml(build(STORY402_RUN).xml).root;
    expect(root.attributes).toMatchObject({ "lines-covered": "24", "lines-valid": "27", "line-rate": "0.8889" });
    const classes = all(root, "class");
    expect(classes.map((entry) => [entry.attributes["name"], entry.attributes["filename"]])).toEqual([
      ["Story402.Fixture", "Story402/Fixture.cls"],
      ["Story402.Layout", "Story402/Layout.cls"],
    ]);
    const classLines = (entry: XmlElement): Array<[number, number]> =>
      entry.children
        .filter((child) => child.name === "lines")
        .flatMap((lines) => lines.children.map((line): [number, number] => [Number(line.attributes["number"]), Number(line.attributes["hits"])]));
    expect(classLines(classes[0] as XmlElement).map(([line]) => line)).toEqual([
      13, 14, 19, 24, 25, 30, 31, 33, 35, 36, 41, 44, 46, 48, 53, 54, 55, 56, 68, 81, 82, 87, 88,
    ]);
    expect(classLines(classes[0] as XmlElement).filter(([, hits]) => hits === 0)).toEqual([[31, 0]]);
    expect(classLines(classes[1] as XmlElement)).toEqual([[9, 1], [11, 1], [21, 0], [26, 0]]);
    const methods = (entry: XmlElement) => all(entry, "method").map((method) => method.attributes["name"]);
    expect(methods(classes[0] as XmlElement)).toEqual([
      "ScoreSet", "LabelGet", "Plain", "Macro", "MultiLine", "Sql", "Expr", "Comments", "TwoOnOne",
    ]);
    expect(methods(classes[1] as XmlElement), "a method with no executable class line is not written").toEqual(["Spaced", "Gap", "Inst"]);
    // Every method's lines are its slice of the class's lines.
    for (const entry of classes) {
      const own = classLines(entry);
      const fromMethods = all(entry, "method").flatMap((method) =>
        method.children[0]?.children.map((line): [number, number] => [Number(line.attributes["number"]), Number(line.attributes["hits"])]) ?? [],
      );
      expect(fromMethods).toEqual(own);
    }
  });

  it("writes the INT count as hits, not a 0 or 1: a covered class line whose INT line ran 7 times has hits=\"7\" in its method and in the class lines", () => {
    const run: CoverageRun = {
      ...STORY402_RUN,
      routines: (STORY402_RUN.routines ?? []).map((routine) =>
        routine.routine === "Story402.Fixture.1"
          ? { ...routine, hits: routine.hits.map(([line, count]): [number, number] => [line, line === 44 ? 7 : count]) }
          : routine,
      ),
    };
    const document = build(run);
    // Fixture.Plain's first body line is class line 24, INT line 44; every other line keeps its oracle count.
    expect(document.xml.match(/<line number="24" hits="7"\/>/g), "once in the method, once in the class lines").toHaveLength(2);
    expect(document.xml.replace(/<line number="24" hits="7"\/>/g, '<line number="24" hits="1"/>')).toBe(GOLDEN);
    const root = dtd.parseXml(document.xml).root;
    const fixture = all(root, "class")[0] as XmlElement;
    const plain = all(fixture, "method").find((method) => method.attributes["name"] === "Plain") as XmlElement;
    expect(all(plain, "line").map((line) => [line.attributes["number"], line.attributes["hits"]])).toEqual([["24", "7"], ["25", "1"]]);
    const classLines = fixture.children.find((child) => child.name === "lines") as XmlElement;
    expect(classLines.children.find((line) => line.attributes["number"] === "24")?.attributes["hits"]).toBe("7");
    expect(root.attributes, "the covered count is of lines, not of hits").toMatchObject({ "lines-covered": "24", "lines-valid": "27" });
    expect(dtd.validateCobertura(document.xml)).toEqual([]);
  });

  it("leaves out generated INT lines, a class with no class-source result and an unmeasured class", () => {
    const run: CoverageRun = {
      ...STORY402_RUN,
      sources: [
        STORY402_RUN.sources?.[0] as NonNullable<CoverageRun["sources"]>[number],
        { class: "Story402.Layout", reason: "not-up-to-date", methods: [] },
      ],
    };
    const document = build(run);
    expect(document.classes).toBe(1);
    expect(document.lines, "the 23 executable class lines, not the 46 executable INT lines of the routine").toBe(23);
    expect(document.xml).not.toContain("Story402.Layout");
    expect(document.xml).not.toContain("Story402.Missing");
    expect(dtd.validateCobertura(document.xml)).toEqual([]);
  });

  it("writes no <sources> without a source root, and exactly one with it; nothing else changes", () => {
    expect(GOLDEN).not.toContain("<sources>");
    const withRoot = build(STORY402_RUN, { sourceRoot: "src" }).xml;
    expect(withRoot).toBe(
      GOLDEN.replace('timestamp="1792312277953">\n', 'timestamp="1792312277953">\n  <sources>\n    <source>src</source>\n  </sources>\n'),
    );
  });

  it("escapes names and the source root, and the escaped values parse back to the originals", () => {
    const run: CoverageRun = {
      ...STORY402_RUN,
      routines: (STORY402_RUN.routines ?? []).map((routine) => ({ ...routine, class: routine.class.replace("Story402", "P&Q") })),
      sources: (STORY402_RUN.sources ?? []).map((source) => ({
        ...source,
        class: source.class.replace("Story402", "P&Q"),
        methods: source.methods.map((method) => ({ ...method, name: method.name === "Plain" ? 'Pl"a<i>n' : method.name })),
      })),
      unmeasured: [],
    };
    const sourceRoot = `C:\\src & "docs" <x> 'y'`;
    const document = build(run, { sourceRoot });
    expect(document.xml).toContain("&amp;");
    expect(document.xml).toContain("&quot;");
    expect(document.xml).toContain("&lt;");
    expect(document.xml).not.toContain("<x>");
    expect(dtd.validateCobertura(document.xml)).toEqual([]);
    const root = dtd.parseXml(document.xml).root;
    expect(all(root, "source")[0]?.text).toBe(sourceRoot);
    expect(all(root, "package")[0]?.attributes["name"]).toBe("P&Q");
    expect(all(root, "method").map((method) => method.attributes["name"])).toContain('Pl"a<i>n');
    expect(escapeXml(`a&b<c>"d"'e'`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");
  });

  it("writes one <package> per class package, in first-seen order", () => {
    const rename = (name: string): string => (name === "Story402.Layout" ? "Zeta.Layout" : name);
    const run: CoverageRun = {
      ...STORY402_RUN,
      routines: (STORY402_RUN.routines ?? []).map((routine) => ({ ...routine, class: rename(routine.class) })),
      sources: (STORY402_RUN.sources ?? []).map((source) => ({ ...source, class: rename(source.class) })),
    };
    const root = dtd.parseXml(build(run).xml).root;
    expect(all(root, "package").map((entry) => [entry.attributes["name"], entry.attributes["line-rate"]])).toEqual([
      ["Story402", "0.9565"],
      ["Zeta", "0.5"],
    ]);
    const unmapped: CoverageRun = { ...STORY402_RUN };
    delete unmapped.sources;
    expect(build(unmapped).classes, "a run without a source map has no class to write").toBe(0);
    expect(dtd.validateCobertura(build(unmapped).xml), "and its document is still valid").toEqual([]);
  });

  it("goes red under the mutations the DTD check guards: a method that declares complexity, a dropped hits attribute, lines before methods", () => {
    expect(dtd.validateCobertura(GOLDEN.replace('signature=""', 'signature="" complexity="0"'))).not.toEqual([]);
    expect(dtd.validateCobertura(GOLDEN.replace(' hits="1"/>', "/>"))).not.toEqual([]);
    expect(
      dtd.validateCobertura(
        GOLDEN.replace(/(<methods>[\s\S]*?<\/methods>)(\s*)(<lines>[\s\S]*?<\/lines>)(\s*<\/class>)/, "$3$2$1$4"),
      ),
    ).not.toEqual([]);
  });
});

describe("rates", () => {
  it("are covered/valid to 4 decimal places without trailing zeros, and 1 when nothing is valid", () => {
    expect(formatRate(0, 0)).toBe("1");
    expect(formatRate(5, 5)).toBe("1");
    expect(formatRate(0, 5)).toBe("0");
    expect(formatRate(1, 2)).toBe("0.5");
    expect(formatRate(1, 3)).toBe("0.3333");
    expect(formatRate(2, 3)).toBe("0.6667");
    expect(formatRate(22, 23)).toBe("0.9565");
    expect(formatRate(1, 8)).toBe("0.125");
    expect(formatRate(1, 10000)).toBe("0.0001");
    expect(formatRate(1, 20000)).toBe("0.0001");
    expect(formatRate(1, 30000)).toBe("0");
  });
});

describe("outputPath and the guarded write", () => {
  const roots: string[] = [];
  const scratch = (): string => {
    const root = mkdtempSync(path.join(tmpdir(), "cobertura-test-"));
    roots.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("is refused when it is empty, relative, has a .. segment (either separator), or does not end in .xml (any case accepted)", () => {
    const root = scratch();
    expect(validateOutputPath("")).toBe("outputPath must be a non-empty string");
    expect(validateOutputPath("out/coverage.xml")).toBe("outputPath 'out/coverage.xml' must be an absolute path");
    expect(validateOutputPath(`${root}/../x.xml`)).toContain("must not contain '..'");
    expect(validateOutputPath(`${root}\\..\\x.xml`)).toContain("must not contain '..'");
    expect(validateOutputPath(path.join(root, "coverage.txt"))).toBe(`outputPath '${path.join(root, "coverage.txt")}' must end in .xml`);
    expect(validateOutputPath(path.join(root, "coverage.xml"))).toBeUndefined();
    expect(validateOutputPath(path.join(root, "COVERAGE.XML"))).toBeUndefined();
  });

  it("creates missing parent directories, writes through a temporary sibling that is gone afterwards, and reports the bytes", async () => {
    const root = scratch();
    const target = path.join(root, "x", "y", "coverage.xml");
    const written = await writeCoberturaFile(target, GOLDEN);
    expect(written).toEqual({ outputPath: path.resolve(target), bytes: Buffer.byteLength(GOLDEN) });
    expect(readFileSync(target, "utf8")).toBe(GOLDEN);
    expect(readdirSync(path.dirname(target))).toEqual(["coverage.xml"]);
  });

  it("overwrites an existing file with identical bytes, and leaves no temporary file when the rename fails", async () => {
    const root = scratch();
    const target = path.join(root, "coverage.xml");
    writeFileSync(target, "old");
    await writeCoberturaFile(target, GOLDEN);
    await writeCoberturaFile(target, GOLDEN);
    expect(readFileSync(target, "utf8")).toBe(GOLDEN);

    // A non-empty directory in the way: the rename fails, no temporary file is left, and the directory is untouched.
    const blocked = path.join(root, "blocked.xml");
    mkdirSync(blocked);
    writeFileSync(path.join(blocked, "keep.txt"), "x");
    await expect(writeCoberturaFile(blocked, GOLDEN)).rejects.toThrow();
    expect(readdirSync(root).sort()).toEqual(["blocked.xml", "coverage.xml"]);
    expect(readdirSync(blocked)).toEqual(["keep.txt"]);
  });

  it("writes nothing for a bad path", async () => {
    const root = scratch();
    await expect(writeCoberturaFile(path.join(root, "a.txt"), GOLDEN)).rejects.toThrow("must end in .xml");
    await expect(writeCoberturaFile("relative.xml", GOLDEN)).rejects.toThrow("must be an absolute path");
    expect(readdirSync(root)).toEqual([]);
    expect(existsSync(path.join(root, "a.txt"))).toBe(false);
  });
});
