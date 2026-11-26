import { describe, it, expect } from "vitest";
import { BOOTSTRAP_CLASSES } from "../bootstrap-classes.js";

// Story 45.6 (DW-787): a type named in a formal spec, a return type, a property type or an Extends clause is
// resolved when its class COMPILES. A bootstrapped class that names an Ens., EnsLib. or HS. class therefore fails to
// compile in a namespace that is not interoperability-enabled ("ERROR #5373: Class 'Ens.Config.Item' ... does not
// exist"), and the whole bootstrap reports "Compile failed". Runtime references (##class(Ens.Director)) are resolved
// when they run and are fine: only the compile-time positions are pinned here.
//
// The source is the embedded BOOTSTRAP_CLASSES (what the bootstrap really deploys), with doc comments (`///`) and
// whole-line comments (`;`, `//`) removed, so a doc line that names the type cannot trip the pin.

// ObjectScript keywords are case-insensitive. The compile-time positions: a type after `As` (also `list Of` / `array Of`),
// any class of an `Extends` list, and an `Include` / `IncludeGenerator` of an Ens or HS include file.
const COMPILE_TIME_INTEROP_TYPE = new RegExp(
  [
    String.raw`\bAs\s+(?:(?:list|array)\s+Of\s+)?(?:Ens|EnsLib|HS)\.`,
    String.raw`\bExtends\s+\(?[^)\n{]*?\b(?:Ens|EnsLib|HS)\.`,
    String.raw`\bInclude(?:Generator)?\s+\(?\s*(?:Ens|HS)\w*`,
  ].join("|"),
  "gi",
);

function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\/\/|\/\/|;)/.test(line))
    .join("\n");
}

function interopTypeHits(source: string): string[] {
  return [...stripComments(source).matchAll(COMPILE_TIME_INTEROP_TYPE)].map((m) => m[0]);
}

describe("bootstrap classes name no interoperability type at compile time (DW-787)", () => {
  it("the check can fail: it flags each compile-time position it guards", () => {
    expect(interopTypeHits("ClassMethod X(pItem As Ens.Config.Item) As %Status")).toHaveLength(1);
    expect(interopTypeHits("ClassMethod X() As EnsLib.HTTP.Adapter")).toHaveLength(1);
    expect(interopTypeHits("Property P As HS.Local.Thing")).toHaveLength(1);
    expect(interopTypeHits("Class A.B Extends Ens.Request")).toHaveLength(1);
    expect(interopTypeHits("Method X(pA As %String, pB As Ens.Config.Item)")).toHaveLength(1);
    expect(interopTypeHits("Method X(pItem as ens.Config.Item)")).toHaveLength(1);
    expect(interopTypeHits("Property P As list Of Ens.Config.Item")).toHaveLength(1);
    expect(interopTypeHits("Class A.B Extends (%Persistent, Ens.Request)")).toHaveLength(1);
    expect(interopTypeHits("Include EnsConstants")).toHaveLength(1);
  });

  it("the check ignores comments and runtime references", () => {
    expect(interopTypeHits("/// pItem As Ens.Config.Item")).toEqual([]);
    expect(interopTypeHits("    ; Set x As Ens.Config.Item")).toEqual([]);
    expect(interopTypeHits("    Set tProd = ##class(Ens.Director).GetProductionStatus()")).toEqual([]);
    expect(interopTypeHits('    Set tName = "Ens.Config.Item"')).toEqual([]);
  });

  it("the embed holds classes to check", () => {
    expect(BOOTSTRAP_CLASSES.size).toBeGreaterThan(30);
  });

  it.each([...BOOTSTRAP_CLASSES.entries()])("%s names no Ens., EnsLib. or HS. type in a formal spec, return type, property type or Extends clause", (_name, source) => {
    expect(interopTypeHits(source)).toEqual([]);
  });
});
