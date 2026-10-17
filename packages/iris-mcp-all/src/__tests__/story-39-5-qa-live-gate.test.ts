/**
 * Story 39.5 (QA) live gate: what the body-reader gate leaves open, on the REAL wire, in the default suite
 * (Rules #34, #36, #41, #54, #59).
 *
 * Paths: the BUILT iris-interop-mcp dist over stdio for the tool rows (three servers: the default `redact`, the
 * operator's `allow` and the operator's `block`, each at DEBUG with an audit file that logs parameters); raw HTTP
 * `POST`s to the body route for the route rows; IRIS's own HL7 parser (`Hl7Fields`) as the oracle for redacted
 * texts. The fixtures are synthetic, written by hand, and every size is measured: a fixture that is meant to be
 * 65536 characters long is checked against the text the route returns, never against the code under test.
 *
 * Rows:
 *  - the shapes of an HL7 v2 body that IRIS really stores (a BOM, LF and CRLF ends and a mix of them, a line
 *    split off a field, a lowercase segment name, escape sequences, repetitions, other separators with the default
 *    ones in the data, control characters in a value, a line separator, a Z segment, MSH alone, a trailing line,
 *    a batch with no BHS, non-ASCII values): under `redact` the result holds no identifying value, whichever
 *    shapes IRIS keeps; a body that is shown is checked by IRIS's parser against its original, and a body that
 *    is withheld has a fixed reason; `block` shows nothing; the audit file and the console log hold no value;
 *  - the HL7 v2 read limit, exactly: a body of 65536 characters is read whole and one of 65537 is not, under
 *    `redact` (redacted or withheld as `hl7TooLarge`) and under `allow` (with the default `maxChars`, with
 *    `maxChars` 65536 and with 65537), for ASCII and for non-ASCII values, and on the route at the cap and one
 *    below it;
 *  - `maxChars` and the stream reader, exactly: streams of 65536, 65537, 100000 and 100001 characters, read with
 *    `maxChars` one below, at and one above the length, report `truncated` when something was left, and the text
 *    is the stream's prefix;
 *  - non-ASCII and astral text through IRIS, the JSON export (which IRIS writes through a UTF-8 temp file) and
 *    the route, and a cut inside a surrogate pair on IRIS's side, which leaves no lone surrogate;
 *  - a body whose class throws on open, a JSON export that throws and a container with no stream: the item has a
 *    fixed text and the exception text (which holds an identifying value) is nowhere;
 *  - 20 headers that name the largest readable body, under `redact` and `allow`, inside a time budget;
 *  - the route's own guards for the odd forms of `headerIds`, `bodyRead` and `bodyTextMaxChars`.
 *
 * Fixture: one scratch namespace `EXECMCPTMP395Q` (Interoperability mapped; the `Story395Q` classes compiled
 * inside), removed in `afterAll` with nothing-left assertions. Every identifying value contains `SYNTHPHI395Q`;
 * values that must survive contain `KEEPME395Q`; times fall on 2001-02-03 UTC. No message of HSCUSTOM is read: every
 * call names the scratch namespace, and the audit entries are checked for it.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773,
 * `_SYSTEM`, HSCUSTOM). Writes only the namespace and database `EXECMCPTMP395Q` and the HSCUSTOM class
 * `ExecuteMCPv2.Temp.Story391Fixture`. No production is started. A missing or stale dist, an unresolvable SDK or an
 * unreachable IRIS skips each row with the reason, or fails with "may not be skipped" when `IRIS_REQUIRE_LIVE` is
 * armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDeployedBootstrapVersion,
  executeMcpPost,
  irisTargetFromEnv,
  isIrisReachable,
  openWireSession,
  resolveSdkEsmDir,
  staleDistReason,
  docFixtures,
  type WireSession,
  type WireSessionOptions,
  type WireToolResult,
} from "./process-gate-helpers.js";
import {
  FIXTURE_DOC,
  createInteropNamespace,
  hl7Fields,
  leftovers,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
} from "./interop-namespace-fixture.js";
import { checkRedactedPositions, separatorCharacters } from "../../../shared/src/__tests__/hl7-redaction-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const entryOf = (pkg: string): string => path.join(REPO_ROOT, "packages", pkg, "dist", "index.js");

const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The scratch namespace holding the fixtures, and one that is never created. */
const NS_Q = "EXECMCPTMP395Q";
const NS_Z = "EXECMCPTMP395Z";
const BODY_ROUTE = "/interop/message/body";

/** Every identifying value contains this; nothing a `redact` or `block` response holds may. */
const MARK = "SYNTHPHI395Q";
/** A value that sits at a kept position of an HL7 v2 text and must survive a redaction. */
const KEEP = "KEEPME395Q";
/** e acute, a CJK character and an astral character (a surrogate pair): IRIS builds the same text with `$Char`. */
const WIDE = "\u{E9}\u{4E2D}\u{1F600}";

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
let firstStartMs = 0;
let tempDir = "";

function wireOptions(pkg: string, extra: Partial<WireSessionOptions> = {}): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: entryOf(pkg),
    target: TARGET,
    clientName: "story-39-5-qa-live-gate",
    ...extra,
  };
}

/** Per-test skip helper: log the reason, then mark the test skipped. */
function skip(testCtx: { skip: () => void }): void {
  // eslint-disable-next-line no-console
  console.log(`[SKIP] story-39-5-qa-live-gate: ${skipReason}`);
  testCtx.skip();
}

// -- The ObjectScript fixtures, compiled inside the scratch namespace ------------------------------------------

const JSON_WIDE_SOURCE = String.raw`Class Story395Q.JsonWide Extends (%Persistent, %JSON.Adaptor)
{

Property Name As %String;

}
`;

const THROWS_EXPORT_SOURCE = String.raw`Class Story395Q.ThrowsExport Extends (%Persistent, %JSON.Adaptor)
{

Property Name As %String;

/// The export always throws, with an exception text that holds an identifying value.
Method %JSONExportToStream(ByRef export As %Stream.Object, %mappingName As %String = "") As %Status
{
    Throw ##class(%Exception.General).%New("SYNTHPHI395Q-EXPORT-EXCEPTION", 5001, "", "SYNTHPHI395Q-EXPORT-DATA")
}

}
`;

const THROWS_OPEN_SOURCE = String.raw`Class Story395Q.ThrowsOpen Extends %Persistent
{

Property Name As %String;

/// Opening always throws, with an exception text that holds an identifying value.
Method %OnOpen() As %Status
{
    Throw ##class(%Exception.General).%New("SYNTHPHI395Q-OPEN-EXCEPTION", 5002, "", "SYNTHPHI395Q-OPEN-DATA")
}

}
`;

const SEED_SOURCE = String.raw`Class Story395Q.Seed
{

/// The wide text: e acute, a CJK character and an astral character (a surrogate pair).
ClassMethod Wide() As %String
{
    Quit $Char(233, 20013, 55357, 56832)
}

/// pText with every @WIDE@ replaced by the wide text.
ClassMethod Expand(pText As %String) As %String
{
    Quit $Replace(pText, "@WIDE@", ..Wide())
}

/// A text of exactly pLength characters of a fixed ASCII pattern.
ClassMethod Pattern(pLength As %Integer) As %String
{
    Set tUnit = "abcdefghijklmnopqrstuvwxyz0123456789"
    Set tText = ""
    For { Quit:$Length(tText)>=pLength  Set tText = tText_tUnit }
    Quit $Extract(tText, 1, pLength)
}

/// pChars characters of the ASCII unit "abcdefghij", or, with pWide, of two BMP characters (e acute, a CJK character).
ClassMethod Filler(pChars As %Integer, pWide As %Boolean) As %String
{
    Set tUnit = $Select(pWide: $Char(233, 20013), 1: "abcdefghij")
    Set tText = ""
    For { Quit:$Length(tText)>=pChars  Set tText = tText_tUnit }
    Quit $Extract(tText, 1, pChars)
}

/// Save pText (with @WIDE@ expanded) as an unsent EnsLib.HL7.Message; the ID, or the error text.
ClassMethod SaveHl7(pText As %String) As %String
{
    Quit ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveHl7(..Expand(pText))
}

/// Save pText (with @WIDE@ expanded) as an Ens.StringRequest; the ID, or the error text.
ClassMethod SaveString(pText As %String) As %String
{
    Quit ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveString(..Expand(pText))
}

/// Save an ADT message whose PID-3, OBX-3.2 and OBX-5 hold the wide text. The values are set into the parsed
/// message: ImportFromString translates a text from Latin-1 and cannot store them. The ID, or the error text.
ClassMethod SaveWideHl7() As %String
{
    Set tCR = $Char(13)
    Set tText = "MSH|^~\&|SYNTHPHI395Q-APP|SYNTHPHI395Q-FAC|||20010203090001||ADT^A01^ADT_A01|SYNTHPHI395Q-CTL|P|2.5.1"_tCR
    Set tText = tText_"PID|1||X||SYNTHPHI395Q-N"_tCR
    Set tText = tText_"OBX|1|TX|GLU^X^L||X"_tCR
    Set tMsg = ##class(EnsLib.HL7.Message).ImportFromString(tText, .tSC)
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Set tSC = tMsg.SetValueAt("SYNTHPHI395Q-"_..Wide()_"-MRN", "2:3")
    If $System.Status.IsOK(tSC) { Set tSC = tMsg.SetValueAt("KEEPME395Q-"_..Wide(), "3:3.2") }
    If $System.Status.IsOK(tSC) { Set tSC = tMsg.SetValueAt("SYNTHPHI395Q-"_..Wide(), "3:5") }
    If $System.Status.IsOK(tSC) { Set tSC = tMsg.%Save() }
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tMsg.%Id()
}

/// Save a %Stream.GlobalCharacter of exactly pLength characters of the pattern; the ID, or the error text.
ClassMethod SavePatternStream(pLength As %Integer) As %String
{
    Quit ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveStream(..Pattern(pLength))
}

/// Save a %Stream.GlobalCharacter holding pLead (with @WIDE@ expanded) and then pPairs astral characters; the ID, or the error text.
ClassMethod SaveAstralStream(pLead As %String, pPairs As %Integer) As %String
{
    Set tText = ..Expand(pLead)
    Set tPair = $Char(55357, 56832)
    For tI = 1:1:pPairs { Set tText = tText_tPair }
    Quit ##class(ExecuteMCPv2.Temp.Story391Fixture).SaveStream(tText)
}

/// Save a Story395Q.JsonWide whose Name holds the wide text; the ID, or the error text.
ClassMethod SaveWideJson() As %String
{
    Set tObj = ##class(Story395Q.JsonWide).%New()
    Set tObj.Name = "SYNTHPHI395Q-"_..Wide()
    Set tSC = tObj.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tObj.%Id()
}

/// Save a Story395Q.ThrowsExport; the ID, or the error text.
ClassMethod SaveThrowsExport() As %String
{
    Set tObj = ##class(Story395Q.ThrowsExport).%New()
    Set tObj.Name = "SYNTHPHI395Q-EXPORT-NAME"
    Set tSC = tObj.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tObj.%Id()
}

/// Save a Story395Q.ThrowsOpen; the ID, or the error text. Opening it throws.
ClassMethod SaveThrowsOpen() As %String
{
    Set tObj = ##class(Story395Q.ThrowsOpen).%New()
    Set tObj.Name = "SYNTHPHI395Q-OPEN-NAME"
    Set tSC = tObj.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tObj.%Id()
}

/// Save an Ens.StreamContainer that holds no stream; the ID, or the error text.
ClassMethod SaveEmptyContainer() As %String
{
    Set tBody = ##class(Ens.StreamContainer).%New()
    Set tSC = tBody.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit tBody.%Id()
}

/// The ER7 text of an ORU message whose OBX-5 is pFiller.
ClassMethod SizedText(pFiller As %String) As %String
{
    Set tCR = $Char(13)
    Set tText = "MSH|^~\&|SYNTHPHI395Q-APP|SYNTHPHI395Q-FAC|||20010203090001||ORU^R01^ORU_R01|SYNTHPHI395Q-CTL|P|2.5.1"_tCR
    Set tText = tText_"PID|1||SYNTHPHI395Q-MRN^^^SYNTHPHI395Q-AA||SYNTHPHI395Q-LAST^SYNTHPHI395Q-FIRST||19010101|F"_tCR
    Set tText = tText_"OBX|1|TX|NOTE^KEEPME395Q^L||"_pFiller_"|||||F"_tCR
    Quit tText
}

/// Save an ORU message whose serialization (OutputToLibraryStream) is exactly pTarget characters. The OBX-5 is
/// ASCII, or, with pWide, e acute and a CJK character set into the parsed message with SetValueAt (an import
/// of a large non-Latin-1 text fails in the HL7 parser, which re-reads the string as bytes once the MSH declares
/// UTF-8, and one that declares none is translated from Latin-1). Returns the JSON {"id", "size"}; size is what
/// IRIS wrote for the saved message when it is opened again.
ClassMethod SaveHl7Sized(pTarget As %Integer, pWide As %Boolean = 0) As %String
{
    Set tChars = pTarget - 400
    Set tId = ""
    Set tSize = 0
    For tTry = 1:1:4 {
        Set tMsg = ##class(EnsLib.HL7.Message).ImportFromString(..SizedText(..Filler(tChars, 0)), .tSC)
        If $System.Status.IsError(tSC) { Set tId = "ERROR: "_$System.Status.GetErrorText(tSC) Quit }
        If pWide {
            Set tSC = tMsg.SetValueAt(..Filler(tChars, 1), "3:5")
            If $System.Status.IsError(tSC) { Set tId = "ERROR: "_$System.Status.GetErrorText(tSC) Quit }
        }
        Set tSC = tMsg.%Save()
        If $System.Status.IsError(tSC) { Set tId = "ERROR: "_$System.Status.GetErrorText(tSC) Quit }
        Set tId = tMsg.%Id()
        Set tObj = ##class(EnsLib.HL7.Message).%OpenId(tId)
        Set tStream = ##class(%Stream.TmpCharacter).%New()
        Set tSC = tObj.OutputToLibraryStream(tStream)
        Set tSize = tStream.Size
        If tSize = pTarget { Quit }
        Set tChars = tChars + (pTarget - tSize)
    }
    Quit {"id":(tId),"size":(tSize)}.%ToJSON()
}

/// Save one Completed Request header, number pN, for the body pBodyId (with @WIDE@ expanded) of class pClass.
ClassMethod AddHeader(pN As %Integer, pClass As %String, pBodyId As %String) As %String
{
    Set tTime = "2001-02-03 12:"_$Extract(100 + (pN \ 60), 2, 3)_":"_$Extract(100 + (pN # 60), 2, 3)
    Quit ##class(ExecuteMCPv2.Temp.Story391Fixture).Add(395100 + pN, 1, 9, 0, "Story395Q.Source", "Story395Q.Target", pClass, ..Expand(pBodyId), tTime)
}

}
`;

const QA_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Story395Q.JsonWide.cls", JSON_WIDE_SOURCE],
  ["Story395Q.ThrowsExport.cls", THROWS_EXPORT_SOURCE],
  ["Story395Q.ThrowsOpen.cls", THROWS_OPEN_SOURCE],
  ["Story395Q.Seed.cls", SEED_SOURCE],
];

// -- The HL7 v2 shapes ---------------------------------------------------------------------------------------------

const SEG_MSH = `MSH|^~\\&|${MARK}-APP|${MARK}-FAC|||20010203090001||ADT^A01^ADT_A01|${MARK}-CTL|P|2.5.1`;
const SEG_PID = `PID|1||${MARK}-MRN^^^${MARK}-AA||${MARK}-LAST^${MARK}-FIRST||19010101|F`;
const SEG_OBX = `OBX|1|TX|GLU^${KEEP}^L||${MARK}-free text|mg/dL|||||F`;
const PLAIN = `${[SEG_MSH, SEG_PID, SEG_OBX].join("\r")}\r`;

/** The shapes IRIS is asked to store; `@WIDE@` is expanded inside IRIS (to the same text as {@link WIDE}). */
const SHAPES: Array<[string, string]> = [
  ["plain", PLAIN],
  ["bom", `\u{FEFF}${PLAIN}`],
  ["leadingLF", `\n${PLAIN}`],
  ["lfEnds", PLAIN.replace(/\r/g, "\n")],
  ["crlfEnds", PLAIN.replace(/\r/g, "\r\n")],
  ["mixedEnds", PLAIN.replace("\rPID", "\r\nPID").replace("\rOBX", "\nOBX")],
  ["noFinalEnd", PLAIN.slice(0, -1)],
  ["splitLine", PLAIN.replace(`${MARK}-MRN^^^`, `${MARK}-MRN\r${MARK}-SPLIT|cont^^^`)],
  ["splitLineLF", PLAIN.replace(`${MARK}-MRN^^^`, `${MARK}-MRN\n${MARK}-SPLITLF|cont^^^`)],
  ["lowercaseSegment", PLAIN.replace("PID|", "pid|")],
  ["escapes", `${SEG_MSH}\rPID|1||${MARK}-A\\F\\${MARK}-B\\S\\C\\T\\D\\R\\E\\E\\.br\\${MARK}-F||${MARK}-N\r${SEG_OBX}\r`],
  ["repetitions", `${SEG_MSH}\rPID|1||${MARK}-A~${MARK}-B~${MARK}-C^&&&${MARK}-D&${MARK}-E||${MARK}-N\r${SEG_OBX}\r`],
  [
    "otherSeparators",
    `MSH#!@$%#${MARK}-APP#${MARK}-FAC###20010203090001##ADT!A01!ADT_A01#${MARK}-CTL#P#2.5.1\r` +
      `PID#1##${MARK}|MRN^X!${MARK}|Y@${MARK}-Z%W##${MARK}-LAST!${MARK}-FIRST\r` +
      `OBX#1#TX#GLU!${KEEP}!L##${MARK}|pipe\r`,
  ],
  ["controlCharacters", `${SEG_MSH}\rPID|1||${MARK}-MRN\u{1}\u{B}\u{1F}\u{7F}${MARK}-C0||${MARK}-N\r${SEG_OBX}\r`],
  ["lineSeparator", `${SEG_MSH}\rPID|1||${MARK}-MRN\u{2028}${MARK}-LS||${MARK}-N\r${SEG_OBX}\r`],
  ["zSegment", `${PLAIN}ZZZ|${MARK}-Z|${KEEP}-Z\r`],
  ["mshOnly", `${SEG_MSH}\r`],
  ["trailingLine", `${PLAIN}${MARK}-TAIL-NO-SEGMENT`],
  ["batchNoBhs", `FHS|^~\\&|${MARK}-FAPP\r${PLAIN}${PLAIN}FTS|1\r`],
];

/**
 * The shape that holds non-Latin-1 values. ImportFromString cannot store one: the HL7 parser translates a text from
 * Latin-1 (a character above U+00FF becomes "?"), and with MSH-18 declaring UTF-8 it reads the string again as bytes
 * and mangles it, so `Story395Q.Seed.SaveWideHl7` sets the values into the parsed message instead.
 */
const WIDE_SHAPE = "nonAscii";
const SHAPE_NAMES: string[] = [...SHAPES.map(([name]) => name), WIDE_SHAPE];

// -- Seeding ----------------------------------------------------------------------------------------------------------

/** A class method of the QA seed class in the scratch namespace, and its string result. */
async function seedMethod(methodName: string, args: unknown[]): Promise<string> {
  const result = await dev.call("iris_execute_classmethod", { namespace: NS_Q, className: "Story395Q.Seed", methodName, args });
  expect(result.isError, `Story395Q.Seed.${methodName}: ${textOf(result)}`).toBeFalsy();
  return String((result.structuredContent as { returnValue?: unknown } | undefined)?.returnValue ?? "");
}

/** The header ID of each fixture, by name. */
const HEADER = new Map<string, number>();
/** The shapes IRIS refused to store. */
const REFUSED_SHAPES: string[] = [];
/** The text length IRIS wrote for each sized fixture. */
const SIZED = new Map<string, number>();
let headerCounter = 0;

async function addHeader(name: string, bodyClass: string, bodyId: string): Promise<void> {
  headerCounter += 1;
  const id = await seedMethod("AddHeader", [headerCounter, bodyClass, bodyId]);
  expect(id, `the header of ${name}`).toMatch(/^\d+$/);
  HEADER.set(name, Number(id));
}

/** Save a body with `method`, then its header. A body IRIS refuses is reported to the caller as `false`. */
async function seedBody(name: string, method: string, args: unknown[], bodyClass: string): Promise<boolean> {
  const bodyId = await seedMethod(method, args);
  if (bodyId.startsWith("ERROR:")) return false;
  expect(bodyId, `the body of ${name}`).toMatch(/^\d+$/);
  await addHeader(name, bodyClass, bodyId);
  return true;
}

async function seedSized(name: string, target: number, wide: boolean): Promise<void> {
  const returned = JSON.parse(await seedMethod("SaveHl7Sized", [target, wide ? 1 : 0])) as { id: string; size: number };
  expect(returned.size, `${name}: IRIS serializes the fixture to exactly ${target} characters (${String(returned.id).slice(0, 300)})`).toBe(target);
  SIZED.set(name, returned.size);
  await addHeader(name, "EnsLib.HL7.Message", String(returned.id));
}

const STREAM_LENGTHS = [65536, 65537, 100000, 100001] as const;

async function seedAll(): Promise<void> {
  for (const [name, text] of SHAPES) {
    if (!(await seedBody(`shape:${name}`, "SaveHl7", [text], "EnsLib.HL7.Message"))) REFUSED_SHAPES.push(name);
  }
  expect(await seedBody(`shape:${WIDE_SHAPE}`, "SaveWideHl7", [], "EnsLib.HL7.Message"), "the wide HL7 v2 shape").toBe(true);
  await seedSized("hl7:65536", 65536, false);
  await seedSized("hl7:65537", 65537, false);
  await seedSized("hl7:wide65536", 65536, true);
  for (const length of STREAM_LENGTHS) {
    expect(await seedBody(`stream:${length}`, "SavePatternStream", [length], "%Stream.GlobalCharacter")).toBe(true);
  }
  expect(await seedBody("stream:wide", "SaveAstralStream", ["@WIDE@-", 3], "%Stream.GlobalCharacter")).toBe(true);
  expect(await seedBody("stream:astralOdd", "SaveAstralStream", ["x", 35000], "%Stream.GlobalCharacter")).toBe(true);
  expect(await seedBody("string:wide", "SaveString", [`${MARK}-@WIDE@ "q" \\ back`], "Ens.StringRequest")).toBe(true);
  expect(await seedBody("json:wide", "SaveWideJson", [], "Story395Q.JsonWide")).toBe(true);
  expect(await seedBody("throws:export", "SaveThrowsExport", [], "Story395Q.ThrowsExport")).toBe(true);
  expect(await seedBody("throws:open", "SaveThrowsOpen", [], "Story395Q.ThrowsOpen")).toBe(true);
  expect(await seedBody("container:empty", "SaveEmptyContainer", [], "Ens.StreamContainer")).toBe(true);
  await addHeader("literal:wide", "", `${MARK}-@WIDE@-literal`);
  // A message sent with no body object: Ens writes an empty class and an empty ID.
  await addHeader("literal:empty", "", "");
}

// -- Sessions ---------------------------------------------------------------------------------------------------------

interface Probed {
  session: WireSession;
  stderr: () => string;
  auditFile: string;
}

const opened: WireSession[] = [];
const probedSessions: Probed[] = [];

async function probedSession(label: string, extraEnv: Record<string, string> = {}): Promise<Probed> {
  const auditFile = path.join(tempDir, `audit-${label}.jsonl`);
  let stderr = "";
  const session = await openWireSession(
    wireOptions("iris-interop-mcp", {
      onStderr: (chunk) => {
        stderr += chunk;
      },
    }),
    { IRIS_AUDIT_LOG: auditFile, IRIS_AUDIT_LOG_PARAMS: "true", LOG_LEVEL: "DEBUG", ...extraEnv },
  );
  opened.push(session);
  const probed = { session, stderr: () => stderr, auditFile };
  probedSessions.push(probed);
  return probed;
}

let redactS: Probed;
let allowS: Probed;
let blockS: Probed;

// -- Reading results --------------------------------------------------------------------------------------------------

type Item = Record<string, unknown>;

interface BodyContent {
  items: Item[];
  count: number;
  maxChars: number;
  dataPolicy: { policy: string; redacted: number; blocked: number };
  dataPolicyClamped?: boolean;
}

const textOf = (result: WireToolResult): string => (result.content ?? []).map((block) => block.text ?? "").join("\n");
const contentOf = (result: WireToolResult): BodyContent => result.structuredContent as unknown as BodyContent;

function succeeded(result: WireToolResult): BodyContent {
  expect(result.isError, textOf(result)).toBeFalsy();
  expect(result.content, "one text block").toHaveLength(1);
  return contentOf(result);
}

function wellFormed(text: string): boolean {
  return (text as unknown as { isWellFormed: () => boolean }).isWellFormed();
}

/** The header ID of fixture `name`. */
function idOf(name: string): number {
  const id = HEADER.get(name);
  if (id === undefined) throw new Error(`no fixture ${name}`);
  return id;
}

/** `iris_message_body` on the scratch namespace through `session`; `args` overrides any field but never targets another namespace by accident. */
function readBodies(session: WireSession, names: string[], args: Record<string, unknown> = {}): Promise<WireToolResult> {
  const namespace = (args.namespace as string | undefined) ?? NS_Q;
  expect([NS_Q, NS_Z], "a call names the scratch namespace (or the one that never exists)").toContain(namespace);
  return session.call("iris_message_body", { headerIds: names.map(idOf), ...args, namespace });
}

const itemFor = (content: BodyContent, name: string): Item => content.items.find((item) => item.id === idOf(name)) as Item;

/** The route, raw: the HTTP status, the text and the parsed envelope. The body names the scratch namespace. */
async function route(body: Record<string, unknown>): Promise<{ status: number; text: string; errors: string[]; result: Record<string, unknown> }> {
  expect([NS_Q, NS_Z], "a route call names the scratch namespace").toContain(body.namespace);
  const answer = await executeMcpPost(TARGET, BODY_ROUTE, body);
  const parsed = JSON.parse(answer.text) as { status: { errors?: Array<{ error: string }> }; result: Record<string, unknown> };
  return { status: answer.status, text: answer.text, errors: (parsed.status.errors ?? []).map((entry) => entry.error), result: parsed.result };
}

/** The raw route's item for fixture `name`, read with `bodyRead` and `bodyTextMaxChars`. */
async function rawItem(name: string, bodyRead: string, bodyTextMaxChars: number): Promise<Item> {
  const answer = await route({ headerIds: [idOf(name)], namespace: NS_Q, bodyRead, bodyTextMaxChars });
  expect(answer.errors, `${name}: the route read it`).toEqual([]);
  return (answer.result.items as Item[])[0] as Item;
}

/** The pattern text of a stream fixture, as IRIS wrote it: "abcdefghijklmnopqrstuvwxyz0123456789" repeated. */
function pattern(length: number): string {
  const unit = "abcdefghijklmnopqrstuvwxyz0123456789";
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

/** The reasons and texts of the spec, written by hand. */
const TOO_LARGE_REASON = "The HL7 v2 body is longer than 65536 characters, so the redact data policy withholds it.";
const tooLargeShown = (cap: number): string =>
  `The HL7 v2 body is longer than ${cap} characters, so it is not shown; a larger maxChars (at most 1048576) reads it whole.`;
const UNREADABLE_TEXT = "The body could not be read.";
const UNOPENED_TEXT = "The body does not open (it may have been purged), so it cannot be read.";
const HL7_WITHHELD = /^The HL7 v2 body (could not be parsed \(.+\)|could not be read in full|is longer than 65536 characters), so the redact data policy withholds it\.$/;

// -- Setup and teardown ----------------------------------------------------------------------------------------------

beforeAll(async () => {
  skipReason = staleDistReason(REPO_ROOT, "shared");
  for (const pkg of ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"]) skipReason ??= staleDistReason(REPO_ROOT, pkg);
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    } else if (!(await isIrisReachable(TARGET.host, TARGET.port))) {
      skipReason = `IRIS is not reachable at http://${TARGET.host}:${TARGET.port}/api/atelier/ (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.5 QA live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  tempDir = mkdtempSync(path.join(tmpdir(), "story-39-5-qa-gate-"));
  const started = performance.now();
  dev = await openWireSession(wireOptions("iris-dev-mcp"));
  firstStartMs = Math.round(performance.now() - started);
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  await putFixtureClass(dev);
  await removeInteropNamespace(admin, dev, NS_Q);
  expect(await leftovers(dev, [NS_Q]), "no fixture namespace before the run").toEqual([]);

  await createInteropNamespace(admin, dev, NS_Q, { interop: true });
  // A positive control: the same check that must read empty after the run sees the namespace now.
  expect(await leftovers(dev, [NS_Q]), "the leftovers check sees the namespace while it exists").toEqual(
    expect.arrayContaining([`namespace ${NS_Q}`, `database configuration ${NS_Q}`]),
  );
  const docs = docFixtures(dev, NS_Q);
  for (const [doc, source] of QA_DOCUMENTS) {
    await docs.putDoc(doc, source);
    await docs.compileDoc(doc);
  }
  await seedAll();

  redactS = await probedSession("redact");
  allowS = await probedSession("allow", { IRIS_DATA_POLICY: "allow" });
  blockS = await probedSession("block", { IRIS_DATA_POLICY: "block" });
}, 600000);

afterAll(async () => {
  if (skipReason) return;
  // Every step runs even when an earlier one failed, so one bad removal cannot leave the others behind.
  const problems: string[] = [];
  const attempt = async (what: string, step: () => Promise<void>): Promise<void> => {
    try {
      await step();
    } catch (error) {
      problems.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    await attempt("the audit files and the console logs", async () => {
      for (const probed of probedSessions) {
        // One more round trip, so every line the server wrote to stderr while it handled the calls has been read.
        await probed.session.listTools();
        const raw = existsSync(probed.auditFile) ? readFileSync(probed.auditFile, "utf8") : "";
        const entries = raw
          .split("\n")
          .filter((line) => line.trim() !== "")
          .map((line) => JSON.parse(line) as Item)
          .filter((entry) => entry.tool === "iris_message_body");
        for (const entry of entries) {
          expect([NS_Q, NS_Z], "every audited call named the scratch namespace").toContain((entry.params as Item | undefined)?.namespace);
        }
        if (probed === allowS || probed === redactS || probed === blockS) {
          expect(raw, "an audit file holds no identifying value, under any policy").not.toContain(MARK);
          expect(probed.stderr(), "the console log holds no identifying value, under any policy").not.toContain(MARK);
        }
      }
    });
    await attempt(`removing ${NS_Q}`, () => removeInteropNamespace(admin, dev, NS_Q));
    await attempt("the leftovers check", async () => {
      expect(await leftovers(dev, [NS_Q]), "no fixture namespace after the run").toEqual([]);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("removing the temp files", async () => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });
    await attempt("the fixture document listing", async () => {
      for (const filter of ["Story391", "Story395"]) {
        const listed = await dev.call("iris_doc_list", { filter, generated: true });
        expect(listed.isError, `the ${filter} document listing`).toBeFalsy();
        const names = (listed.structuredContent as { items: Array<{ name: string }> }).items.map((item) => item.name);
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [...opened, admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- The fixtures are what they say -----------------------------------------------------------------------------------

describe("Story 39.5 QA: the fixtures are measured, not assumed", () => {
  it("each sized HL7 v2 fixture is exactly its length in the text the route returns, and IRIS kept most of the shapes", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    for (const [name, length] of [["hl7:65536", 65536], ["hl7:65537", 65537], ["hl7:wide65536", 65536]] as const) {
      const item = await rawItem(name, "hl7", 1048576);
      expect(String(item.bodyText).length, `${name}: the text the route returns`).toBe(length);
      expect(item.bodyTextComplete, name).toBe(true);
      if (name === "hl7:wide65536") expect(String(item.bodyText), "the wide fixture really holds the CJK character").toContain("\u{4E2D}");
    }
    // A shape IRIS refuses to store is not a defect (it is one less input), but the sweep must still mean something.
    // eslint-disable-next-line no-console
    console.log(`[qa-39-5] shapes IRIS refused to store: ${REFUSED_SHAPES.length === 0 ? "none" : REFUSED_SHAPES.join(", ")}`);
    expect(SHAPE_NAMES.length - REFUSED_SHAPES.length, "most shapes are stored").toBeGreaterThanOrEqual(15);
    for (const name of ["plain", "lfEnds", "crlfEnds", "mixedEnds", "escapes", "repetitions", "otherSeparators", "zSegment", WIDE_SHAPE]) {
      expect(REFUSED_SHAPES, `IRIS stores the ${name} shape`).not.toContain(name);
      expect(HEADER.has(`shape:${name}`), `the ${name} shape has a header`).toBe(true);
    }
    expect(HEADER.get("stream:65536")).toBeDefined();
  }, 120000);
});

// -- Adversarial HL7 v2 shapes -------------------------------------------------------------------------------------

/** The units of a batch that IRIS parses on their own: its FHS line, its BHS line, and each message. */
function batchUnits(text: string): string[] {
  const units: string[] = [];
  let message: string[] = [];
  const flush = (): void => {
    if (message.length > 0) units.push(`${message.join("\r")}\r`);
    message = [];
  };
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line === "") continue;
    const name = line.slice(0, 3);
    if (name === "FHS" || name === "BHS") {
      flush();
      units.push(`${line}\r`);
    } else if (name === "MSH") {
      flush();
      message.push(line);
    } else if (name === "BTS" || name === "FTS") {
      flush();
    } else {
      message.push(line);
    }
  }
  flush();
  return units;
}

describe("Story 39.5 QA: the HL7 v2 shapes IRIS stores, under redact, block and allow (AC-4; AD-26, Rule #36)", () => {
  const storedShapes = (): string[] => SHAPE_NAMES.filter((name) => !REFUSED_SHAPES.includes(name));

  it("redact: whatever IRIS kept, the result holds no identifying value; a shown text is redacted, a withheld one has a fixed reason, and the kept value survives where it was kept", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const names = storedShapes().map((name) => `shape:${name}`);
    const observed: string[] = [];
    // At most 20 headers a call.
    for (let start = 0; start < names.length; start += 20) {
      const slice = names.slice(start, start + 20);
      const result = await readBodies(redactS.session, slice);
      const content = succeeded(result);
      const allow = succeeded(await readBodies(allowS.session, slice, { maxChars: 65536 }));
      expect(JSON.stringify(result), `redact: no identifying value, headers ${slice.join(" ")}`).not.toContain(MARK);
      expect(textOf(result), "and none in the text").not.toContain(MARK);
      expect(content.count).toBe(slice.length);
      let redacted = 0;
      let withheld = 0;
      for (const name of slice) {
        const item = itemFor(content, name);
        const positive = itemFor(allow, name);
        expect(item.bodyKind, name).toBe("hl7v2");
        expect(JSON.stringify(positive), `${name}: allow holds the value (the positive control)`).toContain(MARK);
        const policy = item.bodyPolicy as { outcome: string; reason?: string };
        if (policy.outcome === "redacted") {
          redacted += 1;
          expect(item.format, name).toBe("er7");
          expect(String(item.text), name).toContain("***");
          if (String(positive.text).includes(KEEP)) expect(String(item.text), `${name}: a kept value survives`).toContain(KEEP);
          observed.push(`${name}: redacted`);
        } else {
          withheld += 1;
          expect(policy.outcome, name).toBe("blocked");
          expect(String(policy.reason), name).toMatch(HL7_WITHHELD);
          expect(item.notShown, name).toBe(policy.reason);
          expect(item, name).not.toHaveProperty("text");
          observed.push(`${name}: withheld (${policy.reason})`);
        }
      }
      expect(content.dataPolicy, "the counts").toEqual({ policy: "redact", redacted, blocked: withheld });
    }
    // eslint-disable-next-line no-console
    console.log(`[qa-39-5] HL7 v2 shapes under redact:\n${observed.map((line) => `  ${line}`).join("\n")}`);
    expect(observed.filter((line) => line.includes(": redacted")).length, "the sweep redacts most shapes").toBeGreaterThanOrEqual(10);
  }, 300000);

  it("block: the same bodies show no text, and the wire asked for the kind only", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const names = storedShapes().map((name) => `shape:${name}`).slice(0, 20);
    const result = await readBodies(blockS.session, names);
    const content = succeeded(result);
    expect(content.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: names.length });
    for (const item of content.items) {
      expect(item, `item ${String(item.id)}`).not.toHaveProperty("text");
      expect(item.bodyPolicy).toEqual({ outcome: "blocked", reason: "The block data policy withholds every message body." });
    }
    expect(JSON.stringify(result)).not.toContain(MARK);
  }, 120000);

  it("every redacted text is read by IRIS's own parser against its original: kept positions equal, every other position holds only *** and separators", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const names = storedShapes();
    const checked: string[] = [];
    const unparsed: string[] = [];
    for (const name of names) {
      const fixture = `shape:${name}`;
      const redacted = itemFor(succeeded(await readBodies(redactS.session, [fixture])), fixture);
      if ((redacted.bodyPolicy as { outcome: string }).outcome !== "redacted") continue;
      const original = itemFor(succeeded(await readBodies(allowS.session, [fixture], { maxChars: 65536 })), fixture);
      const before = String(original.text).replace(/\n/g, "\r");
      const after = String(redacted.text).replace(/\n/g, "\r");
      // A batch is parsed unit by unit (its FHS line, its BHS line, each message): IRIS adds pseudo-segments to a batch parent.
      const pairs: Array<[string, string]> = before.startsWith("FHS")
        ? batchUnits(before).map((unit, index) => [unit, batchUnits(after)[index] as string])
        : [[before, after]];
      try {
        for (const [unitBefore, unitAfter] of pairs) {
          const parsedBefore = await hl7Fields(dev, NS_Q, unitBefore);
          const parsedAfter = await hl7Fields(dev, NS_Q, unitAfter);
          expect(parsedBefore.length, `${name}: IRIS parsed the original`).toBeGreaterThan(0);
          expect(checkRedactedPositions(parsedBefore, parsedAfter, separatorCharacters(unitBefore)), name).toEqual([]);
        }
      } catch (error) {
        // IRIS cannot parse this shape as a message (hl7Fields throws): there is no oracle for it. An assertion is not swallowed.
        if (error instanceof Error && error.name === "AssertionError") throw error;
        unparsed.push(name);
        continue;
      }
      checked.push(name);
    }
    // eslint-disable-next-line no-console
    console.log(`[qa-39-5] IRIS parser oracle: checked ${checked.join(", ")}; no oracle for ${unparsed.join(", ") || "none"}`);
    expect(checked.length, "the oracle checked most of the redacted shapes").toBeGreaterThanOrEqual(8);
    for (const name of ["plain", "lfEnds", "crlfEnds", "mixedEnds", "escapes", "repetitions", "otherSeparators", "zSegment", "nonAscii"]) {
      expect(checked, `the oracle checked the ${name} shape`).toContain(name);
    }
  }, 300000);
});

// -- The HL7 v2 read limit, exactly ----------------------------------------------------------------------------------

describe("Story 39.5 QA: the 65536-character limit of an HL7 v2 body, exactly (AC-2, AC-3; DW-577)", () => {
  it("redact: a body of 65536 characters is read whole and redacted, one of 65537 is withheld as too large, for ASCII and non-ASCII values", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const result = await readBodies(redactS.session, ["hl7:65536", "hl7:wide65536", "hl7:65537"], { maxChars: 1048576 });
    const content = succeeded(result);
    for (const name of ["hl7:65536", "hl7:wide65536"]) {
      const item = itemFor(content, name);
      expect(item.bodyPolicy, name).toMatchObject({ outcome: "redacted" });
      expect(item, name).toMatchObject({ format: "er7", truncated: false });
      expect(String(item.text), `${name}: redacted whole`).toContain("***");
      expect(String(item.text), `${name}: the kept value survives`).toContain(KEEP);
      expect(String(item.text), name).toMatch(/^MSH\|\^~\\&\|\*\*\*\|\*\*\*\|\|\|\*\*\*\|\|ORU\^R01\^ORU_R01\|\*\*\*\|P\|2\.5\.1\n/);
    }
    expect(itemFor(content, "hl7:65537").bodyPolicy).toEqual({ outcome: "blocked", reason: TOO_LARGE_REASON });
    expect(itemFor(content, "hl7:65537")).not.toHaveProperty("text");
    expect(content.dataPolicy).toEqual({ policy: "redact", redacted: 2, blocked: 1 });
    expect(JSON.stringify(result)).not.toContain(MARK);
    expect(JSON.stringify(result)).not.toContain("abcdefghij");
  }, 120000);

  it("allow: the default maxChars reads a body of 65536 and cuts it to 10000; 65537 is too large until maxChars reaches 65537; the wide body is whole at 65536", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const first = succeeded(await readBodies(allowS.session, ["hl7:65536", "hl7:65537"]));
    expect(itemFor(first, "hl7:65536")).toMatchObject({ format: "er7", truncated: true });
    expect(String(itemFor(first, "hl7:65536").text), "cut to the default maxChars").toHaveLength(10000);
    expect(itemFor(first, "hl7:65537")).toMatchObject({ notShown: tooLargeShown(65536) });
    expect(itemFor(first, "hl7:65537")).not.toHaveProperty("text");

    const at65536 = succeeded(await readBodies(allowS.session, ["hl7:65536", "hl7:wide65536", "hl7:65537"], { maxChars: 65536 }));
    for (const name of ["hl7:65536", "hl7:wide65536"]) {
      expect(String(itemFor(at65536, name).text), `${name}: whole`).toHaveLength(65536);
      expect(itemFor(at65536, name), name).toMatchObject({ truncated: false, format: "er7" });
    }
    expect(itemFor(at65536, "hl7:65537")).toMatchObject({ notShown: tooLargeShown(65536) });

    const at65537 = succeeded(await readBodies(allowS.session, ["hl7:65537"], { maxChars: 65537 }));
    expect(String(itemFor(at65537, "hl7:65537").text)).toHaveLength(65537);
    expect(itemFor(at65537, "hl7:65537")).toMatchObject({ truncated: false, format: "er7" });
  }, 120000);

  it("the route: the cap is inclusive at 65536 characters (65536 reads, 65535 is tooLarge), for ASCII and non-ASCII values", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    for (const name of ["hl7:65536", "hl7:wide65536"]) {
      const atCap = await rawItem(name, "hl7", 65536);
      expect(String(atCap.bodyText), `${name} at the cap`).toHaveLength(65536);
      const below = await rawItem(name, "hl7", 65535);
      expect(below, `${name} one below`).toMatchObject({ bodyTextOmitted: "tooLarge" });
      expect(below, name).not.toHaveProperty("bodyText");
    }
    const over = await rawItem("hl7:65537", "hl7", 65536);
    expect(over).toMatchObject({ bodyTextOmitted: "tooLarge" });
    const wide = await rawItem("hl7:65537", "hl7", 65537);
    expect(String(wide.bodyText)).toHaveLength(65537);
  }, 120000);

  it("20 headers that name the largest readable body are read inside a time budget, under redact and under allow", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const twenty = Array.from({ length: 20 }, () => "hl7:65536");
    const startedRedact = performance.now();
    const redact = succeeded(await readBodies(redactS.session, twenty));
    const redactMs = Math.round(performance.now() - startedRedact);
    expect(redact.count).toBe(20);
    expect(redact.dataPolicy).toEqual({ policy: "redact", redacted: 20, blocked: 0 });
    for (const item of redact.items) expect(item.bodyPolicy).toMatchObject({ outcome: "redacted" });

    const startedAllow = performance.now();
    const allow = succeeded(await readBodies(allowS.session, twenty, { maxChars: 65536 }));
    const allowMs = Math.round(performance.now() - startedAllow);
    expect(allow.count).toBe(20);
    for (const item of allow.items) {
      expect(String(item.text)).toHaveLength(65536);
      expect(item.truncated).toBe(false);
    }
    // eslint-disable-next-line no-console
    console.log(`[perf] story-39-5-qa: 20 x 65536 characters: redact ${redactMs} ms, allow ${allowMs} ms (budget 10000 ms each)`);
    expect(redactMs, "20 redacted bodies of the largest size").toBeLessThan(10000);
    expect(allowMs, "20 shown bodies of the largest size").toBeLessThan(10000);
  }, 120000);
});

// -- maxChars and the stream reader ---------------------------------------------------------------------------------

describe("Story 39.5 QA: maxChars and the stream reader, around the length of a stream (AC-2)", () => {
  it("a stream of 65536, 65537, 100000 or 100001 characters read with maxChars one below, at and one above its length: the text is its prefix and truncated says whether anything was left", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    for (const length of STREAM_LENGTHS) {
      const name = `stream:${length}`;
      const full = pattern(length);
      for (const maxChars of [length - 1, length, length + 1]) {
        if (maxChars > 1048576) continue;
        const item = itemFor(succeeded(await readBodies(allowS.session, [name], { maxChars })), name);
        const where = `${name}, maxChars ${maxChars}`;
        expect(item, where).toMatchObject({ format: "text", bodyPolicy: { outcome: "none" } });
        expect(item.text, where).toBe(full.slice(0, maxChars));
        expect(item.truncated, where).toBe(maxChars < length);
      }
    }
    // The smallest and the largest legal maxChars.
    const one = itemFor(succeeded(await readBodies(allowS.session, ["stream:65536"], { maxChars: 1 })), "stream:65536");
    expect(one).toMatchObject({ text: "a", truncated: true });
    const widest = itemFor(succeeded(await readBodies(allowS.session, ["stream:100001"], { maxChars: 1048576 })), "stream:100001");
    expect(String(widest.text)).toHaveLength(100001);
    expect(widest.truncated).toBe(false);
  }, 180000);

  it("the route: a stream is read as a prefix of bodyTextMaxChars with bodyTextComplete false, whole with true, at the length and one below", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const full = pattern(65536);
    const whole = await rawItem("stream:65536", "all", 65536);
    expect(whole).toMatchObject({ bodyText: full, bodyTextComplete: true });
    const below = await rawItem("stream:65536", "all", 65535);
    expect(below).toMatchObject({ bodyText: full.slice(0, 65535), bodyTextComplete: false });
    const over = await rawItem("stream:65537", "all", 65536);
    expect(over).toMatchObject({ bodyText: full, bodyTextComplete: false });
    const one = await rawItem("stream:65537", "all", 1);
    expect(one).toMatchObject({ bodyText: "a", bodyTextComplete: false });
    const max = await rawItem("stream:100001", "all", 1048576);
    expect(String(max.bodyText)).toHaveLength(100001);
    expect(max.bodyTextComplete).toBe(true);
  }, 120000);
});

// -- Non-ASCII and astral text ------------------------------------------------------------------------------------------

describe("Story 39.5 QA: non-ASCII and astral text through IRIS and the route (AC-2; Rule #34)", () => {
  it("allow: a stream, a string body, a JSON-adaptor body and a literal that hold e acute, a CJK character and an astral character come back exactly", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const content = succeeded(await readBodies(allowS.session, ["stream:wide", "string:wide", "json:wide", "literal:wide"]));
    expect(itemFor(content, "stream:wide")).toMatchObject({ format: "text", text: `${WIDE}-${"\u{1F600}".repeat(3)}`, truncated: false });
    const stringItem = itemFor(content, "string:wide");
    expect(stringItem.format).toBe("json");
    expect(JSON.parse(String(stringItem.text)), "the string body's JSON").toEqual({ StringValue: `${MARK}-${WIDE} "q" \\ back` });
    const jsonItem = itemFor(content, "json:wide");
    expect(jsonItem.format).toBe("json");
    expect(JSON.parse(String(jsonItem.text)), "the JSON adaptor's export").toEqual({ Name: `${MARK}-${WIDE}` });
    expect(itemFor(content, "literal:wide")).toMatchObject({
      format: "text",
      text: `${MARK}-${WIDE}-literal`,
      bodyId: `${MARK}-${WIDE}-literal`,
      truncated: false,
    });
    for (const item of content.items) expect(wellFormed(JSON.stringify(item)), `item ${String(item.id)}`).toBe(true);
  }, 120000);

  it("allow: a cut inside a surrogate pair, by maxChars, leaves no lone surrogate", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    // The lead is e acute, a CJK character, an astral character (two UTF-16 units) and "-": 5 units, with a pair at
    // units 3 and 4. Three more pairs follow: 11 units in all.
    const lead = `${WIDE}-`;
    const pair = "\u{1F600}";
    for (const [maxChars, expected, truncated] of [
      [2, "\u{E9}\u{4E2D}", true],
      [3, "\u{E9}\u{4E2D}", true],
      [4, `\u{E9}\u{4E2D}${pair}`, true],
      [5, lead, true],
      [6, lead, true],
      [7, `${lead}${pair}`, true],
      [8, `${lead}${pair}`, true],
      [10, `${lead}${pair}${pair}`, true],
      [11, `${lead}${pair.repeat(3)}`, false],
    ] as Array<[number, string, boolean]>) {
      const item = itemFor(succeeded(await readBodies(allowS.session, ["stream:wide"], { maxChars })), "stream:wide");
      expect(item.text, `maxChars ${maxChars}`).toBe(expected);
      expect(item.truncated, `maxChars ${maxChars}`).toBe(truncated);
      expect(wellFormed(String(item.text)), `maxChars ${maxChars}`).toBe(true);
    }
  }, 120000);

  it("allow: IRIS's own cut at the read limit, inside a surrogate pair of a 70001-unit stream, leaves a prefix with no lone surrogate", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const emoji = "\u{1F600}";
    const full = `x${emoji.repeat(35000)}`;
    expect(full).toHaveLength(70001);
    // maxChars 65536 is also the wire read limit, so IRIS cuts at 65536 units: after "x" and 32767 pairs, one unit into a pair.
    const item = itemFor(succeeded(await readBodies(allowS.session, ["stream:astralOdd"], { maxChars: 65536 })), "stream:astralOdd");
    const text = String(item.text);
    expect(wellFormed(text), "no lone surrogate").toBe(true);
    expect(full.startsWith(text), "a prefix of the stream").toBe(true);
    expect(text.length, "cut at the limit, one unit short of it").toBe(65535);
    expect(item.truncated, "and says so").toBe(true);
    const raw = await rawItem("stream:astralOdd", "all", 65536);
    expect(wellFormed(String(raw.bodyText)), "the route's own text has no lone surrogate").toBe(true);
    expect(raw.bodyTextComplete).toBe(false);
    // Whole at the largest limit.
    const whole = itemFor(succeeded(await readBodies(allowS.session, ["stream:astralOdd"], { maxChars: 100000 })), "stream:astralOdd");
    expect(whole.text).toBe(full);
    expect(whole.truncated).toBe(false);
  }, 120000);

  it("redact: non-ASCII values are redacted and withheld the same way, with the kept non-ASCII value intact", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const result = await readBodies(redactS.session, ["shape:nonAscii", "stream:wide", "string:wide", "json:wide", "literal:wide"]);
    const content = succeeded(result);
    expect(content.dataPolicy).toEqual({ policy: "redact", redacted: 1, blocked: 4 });
    expect(String(itemFor(content, "shape:nonAscii").text)).toContain(`${KEEP}-${WIDE}`);
    expect(itemFor(content, "literal:wide").bodyId).toBe("");
    expect(JSON.stringify(result)).not.toContain(MARK);
  }, 120000);
});

// -- Bodies that fail to read -----------------------------------------------------------------------------------------

describe("Story 39.5 QA: a body that cannot be read has a fixed text and no exception text (AC-1, AC-2; AD-19)", () => {
  it("a header with no body (empty class and ID) is none with its fixed reason, never withheld or counted, and the route says so with bodyId \"\" in every mode", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const noBody = "The message has no body: its header names no body class and no body ID.";
    for (const [label, probed] of [["redact", redactS], ["block", blockS], ["allow", allowS]] as const) {
      const content = succeeded(await readBodies(probed.session, ["literal:empty"]));
      const item = itemFor(content, "literal:empty");
      expect(item, label).toMatchObject({ found: true, bodyClassName: "", bodyId: "", bodyKind: "literal", bodyPolicy: { outcome: "none" }, notShown: noBody });
      expect(item, label).not.toHaveProperty("text");
      expect(content.dataPolicy, label).toEqual({ policy: label, redacted: 0, blocked: 0 });
    }
    for (const bodyRead of ["kind", "hl7", "all"]) {
      expect(await rawItem("literal:empty", bodyRead, 100), bodyRead).toMatchObject({ found: true, bodyKind: "literal", bodyId: "", bodyAvailable: false });
    }
    // A literal header that holds a value still has no bodyId outside all.
    expect(await rawItem("literal:wide", "kind", 100)).not.toHaveProperty("bodyId");
  }, 120000);

  it("allow: a JSON export that throws, a class that throws on open and a container with no stream are not shown, and no identifying value or exception text is anywhere", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const names = ["throws:export", "throws:open", "container:empty"];
    const result = await readBodies(allowS.session, names);
    const content = succeeded(result);
    expect(itemFor(content, "throws:export")).toMatchObject({ bodyKind: "persistent", bodyPolicy: { outcome: "none" }, notShown: UNREADABLE_TEXT });
    expect(itemFor(content, "throws:open")).toMatchObject({ bodyKind: "persistent", bodyPolicy: { outcome: "none" }, notShown: UNOPENED_TEXT });
    expect(itemFor(content, "container:empty")).toMatchObject({ bodyKind: "streamContainer", bodyPolicy: { outcome: "none" }, notShown: UNREADABLE_TEXT });
    for (const item of content.items) {
      for (const key of ["text", "format", "truncated"]) expect(item, `item ${String(item.id)}: ${key}`).not.toHaveProperty(key);
    }
    const everything = JSON.stringify(result);
    expect(everything).not.toContain("EXCEPTION");
    expect(everything).not.toContain(MARK);

    // The route itself sent a token, not a text.
    const raw = await route({ headerIds: names.map(idOf), namespace: NS_Q, bodyRead: "all", bodyTextMaxChars: 65536 });
    expect(raw.errors).toEqual([]);
    expect(raw.text).not.toContain("EXCEPTION");
    expect(raw.text).not.toContain(MARK);
    const items = raw.result.items as Item[];
    expect(items.find((item) => item.id === idOf("throws:export"))).toMatchObject({ bodyAvailable: true, bodyTextOmitted: "unreadable" });
    expect(items.find((item) => item.id === idOf("throws:open"))).toMatchObject({ bodyAvailable: false });
    expect(items.find((item) => item.id === idOf("container:empty"))).toMatchObject({ bodyAvailable: true, bodyTextOmitted: "unreadable" });
  }, 120000);

  it("redact and block: the same three bodies are withheld by kind and nothing leaks", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const names = ["throws:export", "throws:open", "container:empty"];
    const redact = await readBodies(redactS.session, names);
    const redactContent = succeeded(redact);
    expect(itemFor(redactContent, "throws:export").bodyPolicy).toEqual({
      outcome: "blocked",
      reason: "A persistent body cannot be redacted reliably, so the redact data policy withholds it.",
    });
    expect(itemFor(redactContent, "throws:open").bodyPolicy, "an unavailable body is not decided").toEqual({ outcome: "none" });
    expect(itemFor(redactContent, "container:empty").bodyPolicy).toMatchObject({ outcome: "blocked" });
    expect(JSON.stringify(redact)).not.toContain(MARK);
    const block = await readBodies(blockS.session, names);
    expect(succeeded(block).dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 2 });
    expect(JSON.stringify(block)).not.toContain(MARK);
  }, 120000);
});

// -- The route's own guards ----------------------------------------------------------------------------------------------

describe("Story 39.5 QA: the route reads least, over every fixture of the namespace (AC-3; AD-26, Design Notes I2)", () => {
  /** Every fixture header, in 20s: the route takes at most 20 IDs. */
  async function sweep(bodyRead: string, bodyTextMaxChars: number): Promise<{ items: Item[]; text: string }> {
    const ids = [...HEADER.values()];
    const items: Item[] = [];
    let text = "";
    for (let start = 0; start < ids.length; start += 20) {
      const answer = await route({ headerIds: ids.slice(start, start + 20), namespace: NS_Q, bodyRead, bodyTextMaxChars });
      expect(answer.errors, `${bodyRead} ${start}`).toEqual([]);
      items.push(...(answer.result.items as Item[]));
      text += answer.text;
    }
    expect(items.map((item) => item.id), "one item per header, in order").toEqual(ids);
    return { items, text };
  }

  it("kind sends no text, no text-omitted token and no literal value, and the whole response holds no identifying value or exception text", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const { items, text } = await sweep("kind", 65536);
    expect(text).not.toContain(MARK);
    expect(text).not.toContain("EXCEPTION");
    for (const item of items) {
      for (const key of ["bodyText", "bodyTextComplete", "bodyTextOmitted"]) expect(item, `item ${String(item.id)}: ${key}`).not.toHaveProperty(key);
    }
    const literal = items.find((item) => item.id === idOf("literal:wide")) as Item;
    expect(literal, "a literal header's value is not sent").not.toHaveProperty("bodyId");
    expect(literal.bodyKind).toBe("literal");
  }, 120000);

  it("hl7 sends text for an HL7 v2 body only, and no other body's content or exception text", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const { items, text } = await sweep("hl7", 65536);
    for (const item of items) {
      if (item.bodyKind !== "hl7v2") {
        for (const key of ["bodyText", "bodyTextComplete", "bodyTextOmitted"]) expect(item, `item ${String(item.id)} (${String(item.bodyKind)}): ${key}`).not.toHaveProperty(key);
      }
    }
    expect(items.filter((item) => "bodyText" in item).every((item) => item.bodyKind === "hl7v2")).toBe(true);
    expect(items.filter((item) => item.bodyTextOmitted === "tooLarge").map((item) => item.id), "only the body over the limit")
      .toEqual([idOf("hl7:65537")]);
    // The streams hold the pattern, the string and the JSON body hold identifying values, the throwing classes hold exception text.
    for (const sentinel of ["klmnopqrstuvwxyz0123456789", "EXCEPTION", "back", "-literal"]) expect(text, sentinel).not.toContain(sentinel);
    expect(text, "the HL7 v2 bodies are what carries the identifying values").toContain(MARK);
    const literal = items.find((item) => item.id === idOf("literal:wide")) as Item;
    expect(literal).not.toHaveProperty("bodyId");
  }, 120000);
});

describe("Story 39.5 QA: the odd forms of the route's inputs (AC-1)", () => {
  const ONE = 1;

  it("headerIds: a value that is not a positive integer or a string of digits is refused, naming the parameter, with no namespace error and no read", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const refused: Array<[string, unknown[]]> = [
      ["a word", ["x"]],
      ["an empty string", [""]],
      ["a fraction string", ["1.5"]],
      ["a fraction", [1.5]],
      ["a negative", [-1]],
      ["a negative string", ["-1"]],
      ["an exponent string", ["1e3"]],
      ["two numbers in a string", ["1 2"]],
      ["a null", [null]],
      ["an object", [{ id: 1 }]],
      ["a nested array", [[1]]],
      ["an injection string", ["1 OR 1=1"]],
    ];
    for (const [label, ids] of refused) {
      const answer = await route({ headerIds: ids, namespace: NS_Z });
      expect(answer.errors.length, label).toBeGreaterThan(0);
      expect(answer.errors[0], label).toContain("headerIds");
      expect(answer.text, `${label}: validation came before the namespace switch`).not.toContain("NAMESPACE");
      expect(answer.result, label).toEqual({});
    }
    for (const notAnArray of ["1", 1, {}, true]) {
      const answer = await route({ headerIds: notAnArray, namespace: NS_Z });
      expect(answer.errors[0], JSON.stringify(notAnArray)).toContain("headerIds");
      expect(answer.text).not.toContain("NAMESPACE");
    }
  }, 120000);

  it("bodyRead and bodyTextMaxChars: the forms outside the contract are refused naming the parameter; the boundary values and a null are accepted", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const refused: Array<[string, Record<string, unknown>, string]> = [
      ["bodyRead in capitals", { bodyRead: "KIND" }, "bodyRead"],
      ["bodyRead padded", { bodyRead: " hl7" }, "bodyRead"],
      ["bodyRead a boolean", { bodyRead: true }, "bodyRead"],
      ["bodyRead an array", { bodyRead: ["all"] }, "bodyRead"],
      ["bodyRead an object", { bodyRead: { all: 1 } }, "bodyRead"],
      ["bodyTextMaxChars -1", { bodyTextMaxChars: -1 }, "bodyTextMaxChars"],
      ["bodyTextMaxChars a fraction", { bodyTextMaxChars: 1.5 }, "bodyTextMaxChars"],
      ["bodyTextMaxChars a boolean", { bodyTextMaxChars: true }, "bodyTextMaxChars"],
      ["bodyTextMaxChars an array", { bodyTextMaxChars: [10] }, "bodyTextMaxChars"],
      ["bodyTextMaxChars an object", { bodyTextMaxChars: { n: 10 } }, "bodyTextMaxChars"],
    ];
    for (const [label, extra, parameter] of refused) {
      const answer = await route({ headerIds: [ONE], namespace: NS_Z, ...extra });
      expect(answer.errors.length, label).toBeGreaterThan(0);
      expect(answer.errors[0], label).toContain(parameter);
      expect(answer.text, `${label}: before the namespace switch`).not.toContain("NAMESPACE");
    }
    const id = idOf("stream:65536");
    const accepted: Array<[string, Record<string, unknown>]> = [
      ["no bodyRead and no bodyTextMaxChars", {}],
      ["null bodyRead and null bodyTextMaxChars", { bodyRead: null, bodyTextMaxChars: null }],
      ["bodyTextMaxChars 1", { bodyRead: "all", bodyTextMaxChars: 1 }],
      ["bodyTextMaxChars 1048576", { bodyRead: "all", bodyTextMaxChars: 1048576 }],
    ];
    for (const [label, extra] of accepted) {
      const answer = await route({ headerIds: [id], namespace: NS_Q, ...extra });
      expect(answer.errors, label).toEqual([]);
      const item = (answer.result.items as Item[])[0] as Item;
      expect(item.id, label).toBe(id);
      if (extra.bodyRead === "all") expect(String(item.bodyText).length, label).toBe(Math.min(extra.bodyTextMaxChars as number, 65536));
      else expect(item, `${label}: kind reads no text`).not.toHaveProperty("bodyText");
    }
  }, 120000);

  it("a header that does not exist, between ones that do, is found: false with its own text, and a read of a missing one under every bodyRead holds no body", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    for (const bodyRead of ["kind", "hl7", "all"]) {
      const answer = await route({ headerIds: [idOf("stream:65536"), 99999999, idOf("literal:wide")], namespace: NS_Q, bodyRead, bodyTextMaxChars: 100 });
      expect(answer.errors, bodyRead).toEqual([]);
      const items = answer.result.items as Item[];
      expect(items.map((item) => item.id), bodyRead).toEqual([idOf("stream:65536"), 99999999, idOf("literal:wide")]);
      expect(items[1], bodyRead).toEqual({ id: 99999999, found: false, error: "Header 99999999 not found" });
    }
  }, 120000);
});

// -- The first start --------------------------------------------------------------------------------------------------

describe("Story 39.5 QA: the first built-server start", () => {
  it("deploys the bootstrap inside its 60 s budget", (testCtx) => {
    if (skipReason) return skip(testCtx);
    // eslint-disable-next-line no-console
    console.log(`[perf] story-39-5-qa: the first built-server start took ${firstStartMs} ms (budget 60000 ms)`);
    expect(firstStartMs).toBeLessThan(60000);
  });
});
