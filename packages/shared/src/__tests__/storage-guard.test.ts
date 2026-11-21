/**
 * Story 38.3 (AC-2, AC-6) - the Storage-drop guard: the scanner, the dropped-names function and the
 * refusal.
 *
 * Every scanner fixture's expected names come from `storage-guard-fixtures.ts`, where each was
 * captured from a real IRIS (2026-10-15, IRIS 2026.2 build 221U, Atelier v8) by PUTting the text and
 * reading the Storage names IRIS echoes; the dev package's live gate re-checks them on every armed run.
 * The fixtures are deliberately not all canonically formatted (Rule #58): a compact header, indented
 * members, a BOM, carriage returns, XML and CDATA.
 */

import { describe, it, expect } from "vitest";
import { BOOTSTRAP_CLASSES } from "../bootstrap-classes.js";
import { REFUSAL_CODES } from "../refusals.js";
import {
  describeStorageDrops,
  droppedStorageDefinitions,
  droppedStorageNames,
  isClassDocument,
  storageDefinitionNames,
  storageDrop,
  storageDroppedDetail,
  storageDroppedRefusal,
  storageDroppedText,
  storageDropsRefusal,
  xmlClassStorageNames,
} from "../storage-guard.js";
import { STORAGE_FIXTURES } from "./storage-guard-fixtures.js";

const CLASS = "Test.Shape";

/** A class with the Storage definitions `names`, each with the generated-style body. */
function classWithStorage(...names: string[]): string[] {
  return [
    `Class ${CLASS} Extends %Persistent`,
    "{",
    "Property Alpha As %String;",
    ...names.flatMap((name) => [`Storage ${name}`, "{", "<Type>%Storage.Persistent</Type>", "}"]),
    "}",
  ];
}

describe("isClassDocument", () => {
  it("is true for a .cls name in any case, and false for every other document type", () => {
    expect(isClassDocument("A.B.cls")).toBe(true);
    expect(isClassDocument("A.B.CLS")).toBe(true);
    expect(isClassDocument("A.B.Cls")).toBe(true);
    for (const name of ["A.mac", "A.inc", "A.int", "A.cls.bak", "A.clsx", "cls", "A.csp", "A.xml"]) {
      expect(isClassDocument(name), name).toBe(false);
    }
  });
});

describe("storageDefinitionNames: the fixtures, as IRIS parses them (AC-2)", () => {
  it("covers the XML, BOM, CR, compact, indented, CDATA, no-header and empty fixtures", () => {
    const ids = STORAGE_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const needle of ["XML", "BOM", "carriage return", "compact", "indented", "CDATA", "no class header", "no lines"]) {
      expect(ids.some((id) => id.includes(needle)), needle).toBe(true);
    }
  });

  for (const fixture of STORAGE_FIXTURES) {
    it(`${fixture.id}: ${JSON.stringify(fixture.names)}`, () => {
      expect(storageDefinitionNames(fixture.lines(CLASS))).toEqual(fixture.names);
    });
  }

  it("never mutates its input", () => {
    const lines = Object.freeze(classWithStorage("Default"));
    expect(storageDefinitionNames(lines)).toEqual(["Default"]);
    expect(lines).toEqual(classWithStorage("Default"));
  });

  it("a CRLF string split by /\\r?\\n/ is the same text as an LF one, so its Storage is found", () => {
    const crlf = classWithStorage("Default").join("\r\n");
    expect(storageDefinitionNames(crlf.split(/\r?\n/))).toEqual(["Default"]);
    expect(storageDefinitionNames(crlf.split("\n"))).toEqual([]);
  });

  // Each case below was also run through a real IRIS (2026-10-15, IRIS 2026.2 build 221U): the Storage
  // names it echoed for the same text equal the expected values.
  it("a Storage definition is the keyword, a name, and a brace: only blanks and line breaks may separate them", () => {
    const wrap = (...member: string[]): string[] => ["Class A.B Extends %Persistent", "{", ...member, "}"];
    expect(storageDefinitionNames(wrap("Storage Default{"))).toEqual(["Default"]);
    expect(storageDefinitionNames(wrap("Storage Default   {", "}"))).toEqual(["Default"]);
    expect(storageDefinitionNames(wrap("Storage Default\t", "{", "}"))).toEqual(["Default"]);
    expect(storageDefinitionNames(wrap("Storage Default", "", "{", "}"))).toEqual(["Default"]);
    expect(storageDefinitionNames(wrap("Storage", "Default", "{", "}"))).toEqual(["Default"]);
    expect(storageDefinitionNames(wrap("Storage Default [ x ]", "{", "}"))).toEqual([]);
    expect(storageDefinitionNames(wrap("Storage Default\r", "{", "}"))).toEqual([]);
    expect(storageDefinitionNames(wrap("Storage Default;"))).toEqual([]);
  });

  it("finds the class body after doc comments, a block comment, Include lines and a header spread over lines", () => {
    const lines = [
      "/* Copyright. Class Fake {",
      "   Storage FakeOne { } */",
      "Include (Ensemble, %occInclude)",
      "IncludeGenerator EnsUtil",
      "/// Class docs. Storage Fake",
      "class A.B Extends (%Persistent, %Populate)",
      "  [ Owner = {%Developer}, System = 4 ]",
      "{",
      "Storage Default",
      "{",
      "}",
      "}",
    ];
    expect(storageDefinitionNames(lines)).toEqual(["Default"]);
  });

  it("skips braces in a formal parameter default, a keyword list, a query body and an ObjectScript trigger", () => {
    const lines = [
      "Class A.B Extends %Persistent",
      "{",
      'ClassMethod M(a As %String = {"x"}, b = {1}) [ Private ]',
      "{",
      '    Quit "}"',
      "}",
      "Query Q() As %SQLQuery",
      "{",
      "SELECT Name FROM T WHERE Name = 'x'",
      "}",
      "Trigger Tr [ Event = INSERT, Language = objectscript ]",
      "{",
      "    ; }",
      "}",
      "Storage Default",
      "{",
      "}",
      "}",
    ];
    expect(storageDefinitionNames(lines)).toEqual(["Default"]);
  });

  it("an ObjectScript body ends at its balanced brace even when its closing brace is indented, and a foreign-language body only at a column-0 brace", () => {
    const indentedClose = [
      "Class A.B Extends %Persistent",
      "{",
      "ClassMethod M()",
      "{",
      "    If 1 {",
      "        Quit",
      "    }",
      "}",
      "Storage One",
      "{",
      "}",
      "}",
    ];
    expect(storageDefinitionNames(indentedClose)).toEqual(["One"]);

    const foreign = [
      "Class A.B Extends %Persistent",
      "{",
      "ClassMethod M() [ Language = Python ]",
      "{",
      "    if True:",
      "        return '{'",
      "}   ",
      "ClassMethod N() [ Language = python ]",
      "{",
      "    d = {",
      "        'a': 1",
      "    }",
      "    return d",
      "}\t",
      "Storage One",
      "{",
      "}",
      "}",
    ];
    expect(storageDefinitionNames(foreign)).toEqual(["One"]);
  });

  it("a Storage member after the class's closing brace, or in a document with an unterminated comment, is not counted", () => {
    expect(storageDefinitionNames(["Class A.B Extends %Persistent", "{", "}", "Storage Late", "{", "}"])).toEqual([]);
    expect(storageDefinitionNames(["Class A.B Extends %Persistent", "{", "/* never closed", "Storage Default", "{", "}"])).toEqual([]);
  });

  it("is case-sensitive about names and finds the keyword in any case", () => {
    expect(storageDefinitionNames(["Class A.B Extends %Persistent", "{", "STORAGE Default", "{", "}", "}"])).toEqual(["Default"]);
    expect(storageDefinitionNames(["Class A.B Extends %Persistent", "{", "Storage default", "{", "}", "}"])).toEqual(["default"]);
  });

  it("XML: reads the name attribute of each Storage element, outside comments and CDATA, with either quote", () => {
    const lines = [
      '<?xml version="1.0"?>',
      "<Export>",
      '<Class name="A.B">',
      '<!-- <Storage name="InComment"> -->',
      '<Storage  type="x"   name = \'Single\'>',
      "</Storage>",
      '<Storage name="Default"/>',
      "<Storage>",
      "</Storage>",
      '<StorageExtra name="NotStorage">',
      "<![CDATA[",
      '<Storage name="InCdata">',
      "]]>",
      "</Class>",
      "</Export>",
    ];
    expect(storageDefinitionNames(lines)).toEqual(["Single", "Default"]);
  });

  it("XML: the first non-blank element decides, so leading blank lines and a BOM do not make it UDL", () => {
    const xml = ['<Export><Class name="A.B"><Storage name="Default">', "</Storage></Class></Export>"];
    expect(storageDefinitionNames(["", "  ", ...xml])).toEqual(["Default"]);
    expect(storageDefinitionNames([`\uFEFF${xml[0]}`, xml[1] as string])).toEqual(["Default"]);
  });
});

describe("droppedStorageDefinitions (AC-2)", () => {
  it("returns the names the proposed text drops, in the order of the current text", () => {
    const current = classWithStorage("Zeta", "Default", "Second");
    expect(droppedStorageDefinitions(current, classWithStorage("Default"))).toEqual(["Zeta", "Second"]);
    expect(droppedStorageDefinitions(current, classWithStorage())).toEqual(["Zeta", "Default", "Second"]);
  });

  it("a rename is a drop, and names are case-sensitive", () => {
    expect(droppedStorageDefinitions(classWithStorage("Default"), classWithStorage("Main"))).toEqual(["Default"]);
    expect(droppedStorageDefinitions(classWithStorage("Default"), classWithStorage("default"))).toEqual(["Default"]);
  });

  it("a change to a definition's content, an added definition and an unchanged class drop nothing", () => {
    const changed = classWithStorage("Default").map((line) =>
      line === "<Type>%Storage.Persistent</Type>" ? "<Type>%Storage.Persistent</Type><DataLocation>^X</DataLocation>" : line,
    );
    expect(droppedStorageDefinitions(classWithStorage("Default"), changed)).toEqual([]);
    expect(droppedStorageDefinitions(classWithStorage("Default"), classWithStorage("Default", "Extra"))).toEqual([]);
    expect(droppedStorageDefinitions(classWithStorage("Default"), classWithStorage("Default"))).toEqual([]);
  });

  it("a class that has no Storage now drops nothing, whatever the new text holds", () => {
    expect(droppedStorageDefinitions(classWithStorage(), classWithStorage())).toEqual([]);
    expect(droppedStorageDefinitions(classWithStorage(), classWithStorage("Default"))).toEqual([]);
    expect(droppedStorageDefinitions([], [])).toEqual([]);
  });

  it("compares across formats: an XML current text against a UDL proposal", () => {
    const xml = STORAGE_FIXTURES.find((fixture) => fixture.id === "B as XML")?.lines(CLASS) as string[];
    const udl = STORAGE_FIXTURES.find((fixture) => fixture.id.startsWith("F:"))?.lines(CLASS) as string[];
    expect(droppedStorageDefinitions(xml, udl)).toEqual(["Second"]);
  });

  it("the decoys alone drop every real definition the class has", () => {
    const withStorage = STORAGE_FIXTURES.find((fixture) => fixture.id.startsWith("B: "))?.lines(CLASS) as string[];
    const decoys = STORAGE_FIXTURES.find((fixture) => fixture.id.startsWith("B decoys"))?.lines(CLASS) as string[];
    expect(droppedStorageDefinitions(withStorage, decoys)).toEqual(["Default", "Second"]);
  });
});

describe("storageDroppedRefusal (AC-3, AC-9)", () => {
  const REMEDY = "Keep the Storage definitions in the content, or pass allowStorageRegeneration: true.";

  it("builds the one-name refusal: text, code, fields in order, isError", () => {
    const result = storageDroppedRefusal("A.B.cls", "USER", ["Second"], REMEDY);

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text:
            "Document 'A.B.cls' was not saved in namespace 'USER': the content drops the Storage definition 'Second' that the class has now, " +
            "and IRIS would generate new storage at the next compile, which can change how existing rows are read. " +
            "Nothing was stored. Keep the Storage definitions in the content, or pass allowStorageRegeneration: true.",
        },
      ],
      structuredContent: { code: "STORAGE_DROPPED", name: "A.B.cls", namespace: "USER", droppedStorage: ["Second"] },
      isError: true,
    });
    expect(result.structuredContent.code).toBe(REFUSAL_CODES.STORAGE_DROPPED);
    expect(Object.keys(result.structuredContent)).toEqual(["code", "name", "namespace", "droppedStorage"]);
  });

  it("names several definitions in the order given", () => {
    const result = storageDroppedRefusal("A.B.cls", "HSCUSTOM", ["Default", "Second"], REMEDY);

    expect(result.content[0]?.text).toContain("the content drops the Storage definitions 'Default', 'Second' that the class has now");
    expect(result.structuredContent.droppedStorage).toEqual(["Default", "Second"]);
  });

  it("copies the dropped names, so the caller's array is never aliased", () => {
    const dropped = ["Default"];
    const result = storageDroppedRefusal("A.B.cls", "USER", dropped, REMEDY);
    dropped.push("Late");
    expect(result.structuredContent.droppedStorage).toEqual(["Default"]);
  });
});

describe("droppedStorageNames (Story 42.11): the one comparison rule", () => {
  it("returns the current names the kept names lack, in the order of the current names, each once", () => {
    expect(droppedStorageNames(["Zeta", "Default", "Second"], ["Default"])).toEqual(["Zeta", "Second"]);
    expect(droppedStorageNames(["Default", "Default"], [])).toEqual(["Default"]);
  });

  it("compares exactly: a rename and a case change are drops, an added name and an unchanged set are not", () => {
    expect(droppedStorageNames(["Default"], ["Main"])).toEqual(["Default"]);
    expect(droppedStorageNames(["Default"], ["default"])).toEqual(["Default"]);
    expect(droppedStorageNames(["Default"], ["Default", "Extra"])).toEqual([]);
    expect(droppedStorageNames([], ["Default"])).toEqual([]);
  });

  it("droppedStorageDefinitions delegates to it", () => {
    const current = classWithStorage("Zeta", "Default");
    expect(droppedStorageDefinitions(current, classWithStorage("Default"))).toEqual(
      droppedStorageNames(storageDefinitionNames(current), storageDefinitionNames(classWithStorage("Default"))),
    );
  });
});

describe("xmlClassStorageNames (Story 42.11): the Storage names of each <Class> of an XML export", () => {
  const storage = (name: string): string => `<Storage name="${name}"><Type>%Storage.Persistent</Type></Storage>`;

  it("maps each class to its Storage names in source order, across several classes", () => {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Export generator="IRIS" version="26">',
      '<Class name="Pkg.A">',
      "<Super>%Persistent</Super>",
      storage("Default"),
      storage("Alt"),
      "</Class>",
      '<Class name="Pkg.B"><Super>%Persistent</Super></Class>',
      '<Class name="Pkg.C">',
      storage("Default"),
      "</Class>",
      "</Export>",
    ];

    const classes = xmlClassStorageNames(lines);

    expect([...classes.keys()]).toEqual(["Pkg.A", "Pkg.B", "Pkg.C"]);
    expect(classes.get("Pkg.A")).toEqual(["Default", "Alt"]);
    expect(classes.get("Pkg.B")).toEqual([]);
    expect(classes.get("Pkg.C")).toEqual(["Default"]);
  });

  it("a class without a Storage element maps to an empty list, and a self-closing class does not swallow the next one's Storage", () => {
    const classes = xmlClassStorageNames(['<Export><Class name="A.One"/>', '<Class name="A.Two">', storage("Default"), "</Class></Export>"]);

    expect(classes.get("A.One")).toEqual([]);
    expect(classes.get("A.Two")).toEqual(["Default"]);
  });

  it("a Storage element inside a comment or a CDATA section does not count", () => {
    const classes = xmlClassStorageNames([
      '<Export><Class name="A.B">',
      `<!-- ${storage("Commented")} -->`,
      `<Method name="M"><Implementation><![CDATA[ ${storage("InCdata")} ]]></Implementation></Method>`,
      storage("Real"),
      "</Class></Export>",
    ]);

    expect(classes.get("A.B")).toEqual(["Real"]);
  });

  it("a Storage element outside a class does not count, and neither does an element that only starts with Class", () => {
    const classes = xmlClassStorageNames([
      `<Export>${storage("Stray")}`,
      '<ClassMethod name="X">',
      `${storage("AlsoStray")}</ClassMethod>`,
      '<Class name="A.B">',
      storage("Default"),
      "</Class>",
      `${storage("After")}</Export>`,
    ]);

    expect([...classes.keys()]).toEqual(["A.B"]);
    expect(classes.get("A.B")).toEqual(["Default"]);
  });

  it("a routine or a project element is not a class", () => {
    const classes = xmlClassStorageNames([
      '<?xml version="1.0"?><Export>',
      '<Routine name="R" type="MAC"><![CDATA[ line ]]></Routine>',
      '<Project name="P"><Items><ProjectItem name="A.B" type="CLS"/></Items></Project>',
      "</Export>",
    ]);

    expect(classes.size).toBe(0);
  });

  it("names are exact: a class named twice keeps the later element's names, and an unnamed class is skipped", () => {
    const classes = xmlClassStorageNames([
      '<Export><Class name="A.B">',
      storage("Default"),
      "</Class>",
      '<Class name="A.B">',
      storage("Other"),
      "</Class>",
      `<Class>${storage("Anon")}</Class><Class name="">${storage("Blank")}</Class></Export>`,
    ]);

    expect([...classes.keys()]).toEqual(["A.B"]);
    expect(classes.get("A.B")).toEqual(["Other"]);
  });

  it("handles a BOM, single-quoted attributes and CRLF-split lines", () => {
    const text = `\uFEFF<Export><Class name='A.B' languagemode="0">\r\n${storage("Default")}\r\n</Class></Export>`;

    expect(xmlClassStorageNames(text.split(/\r?\n/)).get("A.B")).toEqual(["Default"]);
  });

  it("text that is not XML, and an empty text, yield no class", () => {
    expect(xmlClassStorageNames(classWithStorage("Default")).size).toBe(0);
    expect(xmlClassStorageNames([]).size).toBe(0);
  });
});

describe("the drop texts and fields (Story 42.11)", () => {
  const REMEDY = "Do the remedy.";

  it("storageDroppedText is the refusal text of storageDroppedRefusal", () => {
    const text = storageDroppedText("A.B.cls", "USER", ["Default", "Second"], REMEDY);

    expect(text).toBe(
      "Document 'A.B.cls' was not saved in namespace 'USER': the content drops the Storage definitions 'Default', 'Second' that the class has now, " +
        "and IRIS would generate new storage at the next compile, which can change how existing rows are read. Nothing was stored. Do the remedy.",
    );
    expect(storageDroppedRefusal("A.B.cls", "USER", ["Default", "Second"], REMEDY).content[0]?.text).toBe(text);
  });

  it("storageDroppedDetail is the code and a copy of the names, and storageDrop is the name and a copy of the names", () => {
    const names = ["Default"];

    expect(storageDroppedDetail(names)).toEqual({ code: REFUSAL_CODES.STORAGE_DROPPED, droppedStorage: ["Default"] });
    expect(storageDrop("A.B.cls", names)).toEqual({ name: "A.B.cls", droppedStorage: ["Default"] });
    expect(storageDroppedDetail(names).droppedStorage).not.toBe(names);
    expect(storageDrop("A.B.cls", names).droppedStorage).not.toBe(names);
  });

  it("describeStorageDrops lists each document with its names, separated by '; '", () => {
    const drops = [storageDrop("Pkg.A.cls", ["Default"]), storageDrop("Pkg.B.cls", ["Default", "Alt"])];

    expect(describeStorageDrops(drops)).toBe("Pkg.A.cls ('Default'); Pkg.B.cls ('Default', 'Alt')");
    expect(describeStorageDrops([])).toBe("");
  });

  it("describeStorageDrops with a limit lists the first documents and then says how many more", () => {
    const drops = ["A", "B", "C", "D"].map((name) => storageDrop(`Pkg.${name}.cls`, ["Default"]));

    expect(describeStorageDrops(drops, 2)).toBe("Pkg.A.cls ('Default'); Pkg.B.cls ('Default'); and 2 more");
    expect(describeStorageDrops(drops, 3)).toBe("Pkg.A.cls ('Default'); Pkg.B.cls ('Default'); Pkg.C.cls ('Default'); and 1 more");
    expect(describeStorageDrops(drops, 4)).toBe(describeStorageDrops(drops));
    expect(describeStorageDrops(drops, 10)).toBe(describeStorageDrops(drops));
  });

  it("storageDropsRefusal names one drop: 'the class has', the code first, the fields, then storageDrops", () => {
    const result = storageDropsRefusal(
      "The XML was not imported into namespace 'USER' and nothing was stored",
      [storageDrop("Pkg.A.cls", ["Default"])],
      REMEDY,
      { namespace: "USER" },
    );

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text:
            "The XML was not imported into namespace 'USER' and nothing was stored: it drops the Storage definition 'Default' of 'Pkg.A.cls' " +
            "that the class has now, and IRIS would generate new storage at the next compile, which can change how existing rows are read. Do the remedy.",
        },
      ],
      structuredContent: { code: "STORAGE_DROPPED", namespace: "USER", storageDrops: [{ name: "Pkg.A.cls", droppedStorage: ["Default"] }] },
      isError: true,
    });
    expect(Object.keys(result.structuredContent)).toEqual(["code", "namespace", "storageDrops"]);
  });

  it("storageDropsRefusal names several drops: each document with its definitions, joined by '; ', 'the classes have'", () => {
    const result = storageDropsRefusal(
      "Promotion to server 'qa', namespace 'USER' was not run and no changes were made",
      [storageDrop("Pkg.A.cls", ["Default"]), storageDrop("Pkg.B.cls", ["Default", "Alt"])],
      REMEDY,
      { source: { profile: "dev", namespace: "USER" }, target: { profile: "qa", namespace: "USER" } },
    );

    expect(result.content[0]?.text).toBe(
      "Promotion to server 'qa', namespace 'USER' was not run and no changes were made: it drops " +
        "the Storage definition 'Default' of 'Pkg.A.cls'; the Storage definitions 'Default', 'Alt' of 'Pkg.B.cls' " +
        "that the classes have now, and IRIS would generate new storage at the next compile, which can change how existing rows are read. Do the remedy.",
    );
    expect(Object.keys(result.structuredContent)).toEqual(["code", "source", "target", "storageDrops"]);
    expect(result.isError).toBe(true);
  });

  it("storageDropsRefusal never lets a field replace the code", () => {
    const result = storageDropsRefusal("Opening", [storageDrop("A.cls", ["Default"])], REMEDY, { code: "OTHER" });

    expect(result.structuredContent.code).toBe(REFUSAL_CODES.STORAGE_DROPPED);
  });
});

describe("the bootstrap PUT verdict (Story 38.3, AC-6)", () => {
  it("every class the bootstrap PUTs has zero Storage definitions, so the guard has nothing to protect there", () => {
    expect(BOOTSTRAP_CLASSES.size).toBeGreaterThan(10);
    for (const [name, content] of BOOTSTRAP_CLASSES) {
      expect(isClassDocument(name), `${name} is a class document`).toBe(true);
      const lines = content.split("\n");
      expect(storageDefinitionNames(lines), `${name}: the scanner finds no Storage definition`).toEqual([]);
      // An independent check, so a scanner that found nothing anywhere could not pass this vacuously.
      expect(lines.filter((line) => /^\s*storage\b/i.test(line)), `${name}: no line starts with the Storage keyword`).toEqual([]);
    }
  });
});
