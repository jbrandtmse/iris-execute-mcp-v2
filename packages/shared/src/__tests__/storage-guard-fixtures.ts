/**
 * Class-text fixtures for the Storage scanner, shared by `storage-guard.test.ts` (unit) and the
 * dev package's `doc-put-storage-guard-live-gate.test.ts` (the live oracle).
 *
 * Each fixture is a function of the class name, because IRIS refuses a document whose header names
 * a different class than the document. `names` is what IRIS itself reports for the text: the live
 * oracle PUTs the fixture to a real IRIS and reads the Storage names it echoes (2026-10-15, IRIS
 * 2026.2 build 221U, Atelier v8, HSCUSTOM), and the pins below were captured from that run, never
 * edited to match the scanner (Rule #36). A fixture with `oracle: false` cannot be sent to IRIS
 * (a BOM makes IRIS refuse the first line, and a fixture with no class header is no document).
 *
 * Not a test file: no vitest collection, no imports.
 */

/** One scanner fixture. */
export interface StorageFixture {
  /** The fixture's name, unique in {@link STORAGE_FIXTURES}. */
  readonly id: string;
  /** The class text, as the `content` array of an Atelier `/doc` request, for class `className`. */
  readonly lines: (className: string) => string[];
  /** The Storage definition names IRIS reports for the text, in order. */
  readonly names: readonly string[];
  /** True when the live oracle can PUT the text to IRIS. */
  readonly oracle: boolean;
}

const STORAGE_TYPE = "<Type>%Storage.Persistent</Type>";

/** Storage definition `name` with the generated-style body that the fixtures share. */
function storageBlock(name: string, indent = ""): string[] {
  return [`${indent}Storage ${name}`, `${indent}{`, `${indent}${STORAGE_TYPE}`, `${indent}}`];
}

/** The class text of fixture B with the two real Storage blocks left out: the decoys alone. */
function decoyLines(className: string): string[] {
  return [
    "/// Decoys. Storage Default in this doc comment must not count.",
    `Class ${className} Extends %Persistent`,
    "{",
    "",
    "/* Storage Commented",
    "{",
    STORAGE_TYPE,
    "}",
    "*/",
    "// Storage LineCommented",
    'Parameter NOTE = "Storage InString";',
    "",
    "/// Storage InDocComment",
    "Property Alpha As %String;",
    "",
    "ClassMethod Probe() As %String",
    "{",
    '    Set x = "Storage InMethodString"',
    "    // Storage InMethodComment",
    "    Quit x",
    "}",
    "",
    "}",
  ];
}

/** The class text of fixture B: the decoys, then the real Default and Second definitions. */
function decoysWithStorageLines(className: string): string[] {
  const lines = decoyLines(className);
  const closing = lines.pop() as string;
  return [
    ...lines,
    "Storage Default",
    "{",
    '<Data name="Q383DefaultData">',
    '<Value name="1">',
    "<Value>%%CLASSNAME</Value>",
    "</Value>",
    '<Value name="2">',
    "<Value>Alpha</Value>",
    "</Value>",
    "</Data>",
    "<DataLocation>^ExecuteMCPv2.Temp.QaStory383BD</DataLocation>",
    "<DefaultData>Q383DefaultData</DefaultData>",
    "<IdLocation>^ExecuteMCPv2.Temp.QaStory383BD</IdLocation>",
    "<IndexLocation>^ExecuteMCPv2.Temp.QaStory383BI</IndexLocation>",
    "<StreamLocation>^ExecuteMCPv2.Temp.QaStory383BS</StreamLocation>",
    STORAGE_TYPE,
    "}",
    "",
    ...storageBlock("Second"),
    "",
    closing,
  ];
}

/** The XML export of fixture B (the `Export` form that IRIS reads from `PUT /doc` and echoes on a 409). */
function decoysXmlLines(className: string): string[] {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Export generator="IRIS" version="26">',
    `<Class name="${className}">`,
    "<Description>",
    "Decoys. Storage Default in this doc comment must not count.</Description>",
    "<Super>%Persistent</Super>",
    "",
    '<UDLText name="T">',
    "<Content><![CDATA[",
    "/* Storage Commented",
    "{",
    STORAGE_TYPE,
    "}",
    "*/",
    "]]></Content>",
    "</UDLText>",
    "",
    '<Parameter name="NOTE">',
    "<Default>Storage InString</Default>",
    "</Parameter>",
    "",
    '<Property name="Alpha">',
    "<Description>",
    "Storage InDocComment</Description>",
    "<Type>%String</Type>",
    "</Property>",
    "",
    '<Method name="Probe">',
    "<ClassMethod>1</ClassMethod>",
    "<ReturnType>%String</ReturnType>",
    "<Implementation><![CDATA[",
    '    Set x = "Storage InMethodString"',
    "    // Storage InMethodComment",
    "    Quit x",
    "]]></Implementation>",
    "</Method>",
    "",
    '<Storage name="Default">',
    STORAGE_TYPE,
    "<DataLocation>^ExecuteMCPv2.Temp.QaStory383BD</DataLocation>",
    "<DefaultData>Q383DefaultData</DefaultData>",
    "<IdLocation>^ExecuteMCPv2.Temp.QaStory383BD</IdLocation>",
    "<IndexLocation>^ExecuteMCPv2.Temp.QaStory383BI</IndexLocation>",
    "<StreamLocation>^ExecuteMCPv2.Temp.QaStory383BS</StreamLocation>",
    '<Data name="Q383DefaultData">',
    '<Value name="1">',
    "<Value>%%CLASSNAME</Value>",
    "</Value>",
    '<Value name="2">',
    "<Value>Alpha</Value>",
    "</Value>",
    "</Data>",
    "</Storage>",
    "",
    '<Storage name="Second">',
    STORAGE_TYPE,
    "</Storage>",
    "</Class>",
    "</Export>",
  ];
}

/** An XML export whose method code holds the text of a `<Storage name=...>` element inside a CDATA section. */
function cdataXmlLines(className: string): string[] {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Export generator="IRIS" version="26">',
    `<Class name="${className}">`,
    "<Super>%Persistent</Super>",
    '<Property name="Alpha">',
    "<Type>%String</Type>",
    "</Property>",
    "",
    '<Method name="Probe">',
    "<ClassMethod>1</ClassMethod>",
    "<ReturnType>%String</ReturnType>",
    "<Implementation><![CDATA[",
    '    Quit "<Storage name=""Fake"">"',
    "]]></Implementation>",
    "</Method>",
    "",
    '<Storage name="Default">',
    STORAGE_TYPE,
    "</Storage>",
    "</Class>",
    "</Export>",
  ];
}

/** Every scanner fixture, with the names IRIS reports for it. */
export const STORAGE_FIXTURES: readonly StorageFixture[] = [
  {
    id: "A: persistent class with no Storage",
    names: [],
    oracle: true,
    lines: (c) => [
      "/// Disposable fixture.",
      `Class ${c} Extends %Persistent`,
      "{",
      "",
      "Property Alpha As %String;",
      "",
      "Property Beta As %String;",
      "",
      "}",
    ],
  },
  {
    id: "B: Default and Second among comment, string and method decoys",
    names: ["Default", "Second"],
    oracle: true,
    lines: decoysWithStorageLines,
  },
  {
    id: "B decoys alone: the real blocks removed",
    names: [],
    oracle: true,
    lines: decoyLines,
  },
  {
    id: "B as XML",
    names: ["Default", "Second"],
    oracle: true,
    lines: decoysXmlLines,
  },
  {
    id: "C: Storage in an XData body and as a column-0 label",
    names: [],
    oracle: true,
    lines: (c) => [
      `Class ${c} Extends %RegisteredObject`,
      "{",
      "",
      "XData Notes [ MimeType = text/plain ]",
      "{",
      "Storage InXData",
      "{",
      "}",
      "}",
      "",
      "ClassMethod Probe() As %String",
      "{",
      "Storage ; a label named Storage at column 0",
      '    Quit "x"',
      "}",
      "",
      "}",
    ],
  },
  {
    id: "D: lowercase storage keyword",
    names: ["Lowercase"],
    oracle: true,
    lines: (c) => [
      `Class ${c} Extends %Persistent`,
      "{",
      "",
      "Property Alpha As %String;",
      "",
      "storage Lowercase",
      "{",
      STORAGE_TYPE,
      "}",
      "",
      "}",
    ],
  },
  {
    id: "E: an unbalanced quote in XData, Python '{', ObjectScript quoted and commented braces",
    names: ["Default"],
    oracle: true,
    lines: (c) => [
      `Class ${c} Extends %Persistent`,
      "{",
      "",
      "XData Quote [ MimeType = text/plain ]",
      "{",
      'He said "hi',
      "}",
      "",
      "ClassMethod Py() As %String [ Language = python ]",
      "{",
      "    x = '{'",
      "    return x",
      "}",
      "",
      "ClassMethod Os() As %String",
      "{",
      '    Set x = "}" ; a } in a comment',
      "    Quit x",
      "}",
      "",
      ...storageBlock("Default"),
      "",
      "}",
    ],
  },
  {
    id: "F: one Storage definition, plain layout",
    names: ["Default"],
    oracle: true,
    lines: (c) => [
      `Class ${c} Extends %Persistent`,
      "{",
      "",
      "Property Alpha As %String;",
      "",
      ...storageBlock("Default"),
      "",
      "}",
    ],
  },
  {
    id: "G: every element ends in a carriage return",
    names: [],
    oracle: true,
    lines: (c) =>
      [
        `Class ${c} Extends %Persistent`,
        "{",
        "",
        "Property Alpha As %String;",
        "",
        ...storageBlock("Default"),
        "",
        "}",
        "",
      ].map((line) => `${line}\r`),
  },
  {
    id: "compact header: Class X Extends %Persistent {",
    names: ["Default"],
    oracle: true,
    lines: (c) => [
      `Class ${c} Extends %Persistent {`,
      "Property Alpha As %String;",
      ...storageBlock("Default"),
      "}",
    ],
  },
  {
    id: "members indented by four spaces",
    names: ["Default"],
    oracle: true,
    lines: (c) => [
      `Class ${c} Extends %Persistent`,
      "{",
      "    Property Alpha As %String;",
      "",
      ...storageBlock("Default", "    "),
      "}",
    ],
  },
  {
    id: "comments holding braces at member level",
    names: ["Default"],
    oracle: true,
    lines: (c) => [
      `Class ${c} Extends %Persistent`,
      "{",
      "// a line comment with a brace {",
      "/* a block comment with a brace } */",
      "/// a doc comment with a brace {",
      "Property Alpha As %String;",
      "",
      ...storageBlock("Default"),
      "",
      "}",
    ],
  },
  {
    id: "braces in a keyword list and in a formal parameter default",
    names: ["Default"],
    oracle: true,
    lines: (c) => [
      `Class ${c} Extends %Persistent [ Owner = {_SYSTEM} ]`,
      "{",
      "",
      "Property Alpha As %String;",
      "",
      'Property Calc As %String [ Calculated, SqlComputeCode = {Set {Calc}={Alpha}_"x"}, SqlComputed ];',
      "",
      'Method Probe(target As %String = {"x"}) As %String [ Private ]',
      "{",
      "    Quit target",
      "}",
      "",
      ...storageBlock("Default"),
      "",
      "}",
    ],
  },
  {
    id: "formal parameter defaults in braces, a quoted brace in a body, a query body and an ObjectScript trigger",
    names: ["Default"],
    oracle: true,
    lines: (c) => [
      `Class ${c} Extends %Persistent`,
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
      ...storageBlock("Default"),
      "}",
    ],
  },
  {
    id: "XML with a Storage element inside a CDATA section",
    names: ["Default"],
    oracle: true,
    lines: cdataXmlLines,
  },
  {
    id: "a leading BOM",
    names: ["Default"],
    oracle: false,
    lines: (c) => {
      const [first, ...rest] = [
        `Class ${c} Extends %Persistent`,
        "{",
        ...storageBlock("Default"),
        "}",
      ];
      return [`\uFEFF${first}`, ...rest];
    },
  },
  {
    id: "no class header",
    names: [],
    oracle: false,
    lines: () => ["Property Alpha As %String;", ...storageBlock("Default")],
  },
  {
    id: "no lines",
    names: [],
    oracle: false,
    lines: () => [],
  },
];
