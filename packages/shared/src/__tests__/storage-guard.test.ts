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
  droppedStorageDefinitions,
  isClassDocument,
  storageDefinitionNames,
  storageDroppedRefusal,
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
