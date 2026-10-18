/**
 * The name guard of the disposable-namespace harness (`interop-namespace-fixture.ts`, Story 39.1). No IRIS.
 *
 * The harness deletes mappings, namespaces, database configurations, database files and directories from a
 * name it is given, on a shared instance. Every function that takes a name must refuse one that is not
 * `EXECMCPTMP<digits><capital letter>` before it calls any tool, so a caller that passes a real namespace
 * name (`USER`, `HSCUSTOM`) cannot reach a delete. The sessions here are stubs that record their calls.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  FIXTURE_CLASS_SOURCE,
  STORY392_IDS,
  STORY395_DOCUMENTS,
  STORY395_IDS,
  STORY396_DOCUMENTS,
  STORY396_IDS,
  STORY397_DOCUMENTS,
  STORY397_IDS,
  STORY400_DOCUMENTS,
  STORY400_IDS,
  STORY400_SEED_SOURCE,
  createInteropNamespace,
  hl7Fields,
  leftovers,
  removeInteropNamespace,
  seedBodies,
  seedBodyReader,
  seedBurnDown,
  seedCapstone,
  seedEventLogCounts,
  seedHeaders,
} from "./interop-namespace-fixture.js";
import { STORY401_DOCUMENTS, STORY401_IDS, seedCoverageFixture, setSlowTestHang } from "./coverage-fixture.js";

type Session = Parameters<typeof removeInteropNamespace>[0];

/** A stub session that records every call and answers each one with `returnValue`. */
function stubSession(returnValue = "[]"): Session & { call: ReturnType<typeof vi.fn> } {
  const call = vi.fn(async () => ({ isError: false, content: [], structuredContent: { returnValue } }));
  return { call } as unknown as Session & { call: ReturnType<typeof vi.fn> };
}

/** Names that are real namespaces, near misses, and a list that smuggles one in. */
const REFUSED_NAMES = [
  "HSCUSTOM",
  "USER",
  "%SYS",
  "EXECMCPTMP391",
  "EXECMCPTMP391a",
  "EXECMCPTMP391AB",
  "execmcptmp391A",
  "EXECMCPTMP391A,USER",
  "",
];

describe("Story 39.1: the fixture harness refuses a name that is not a scratch namespace, before any tool call", () => {
  for (const name of REFUSED_NAMES) {
    it(`refuses ${JSON.stringify(name)} in every function, and calls nothing`, async () => {
      const admin = stubSession();
      const dev = stubSession();

      await expect(removeInteropNamespace(admin, dev, name)).rejects.toThrow(/not a fixture namespace name/);
      await expect(createInteropNamespace(admin, dev, name, { interop: true })).rejects.toThrow(/not a fixture namespace name/);
      await expect(seedHeaders(dev, name, "alpha")).rejects.toThrow(/not a fixture namespace name/);
      await expect(leftovers(dev, [name])).rejects.toThrow(/not a fixture namespace name/);
      await expect(seedBodies(dev, name)).rejects.toThrow(/not a fixture namespace name/);
      await expect(hl7Fields(dev, name, "MSH|^~\\&|")).rejects.toThrow(/not a fixture namespace name/);
      await expect(seedBodyReader(dev as never, name, "a")).rejects.toThrow(/not a fixture namespace name/);
      await expect(seedCapstone(dev as never, name)).rejects.toThrow(/not a fixture namespace name/);
      await expect(seedBurnDown(dev as never, name)).rejects.toThrow(/not a fixture namespace name/);
      await expect(seedEventLogCounts(dev as never, name)).rejects.toThrow(/not a fixture namespace name/);
      await expect(seedCoverageFixture(dev as never, name)).rejects.toThrow(/not a fixture namespace name/);
      await expect(setSlowTestHang(dev as never, name, 3)).rejects.toThrow(/not a fixture namespace name/);
      await expect(createInteropNamespace(admin, dev, name, { interop: true, hsLib: true })).rejects.toThrow(
        /not a fixture namespace name/,
      );

      expect(admin.call).not.toHaveBeenCalled();
      expect(dev.call).not.toHaveBeenCalled();
    });
  }

  it("lets a scratch name through to the tool call, so the refusals above are the guard and not a broken harness", async () => {
    const dev = stubSession("[]");

    await expect(leftovers(dev, ["EXECMCPTMP391A", "EXECMCPTMP39200B"])).resolves.toEqual([]);

    expect(dev.call).toHaveBeenCalledTimes(1);
    expect(dev.call).toHaveBeenCalledWith(
      "iris_execute_classmethod",
      expect.objectContaining({ methodName: "Leftovers", args: ["EXECMCPTMP391A,EXECMCPTMP39200B"] }),
    );
  });

  it("lets a scratch name through for the Story 39.2 body seed and HL7 parse, too", async () => {
    const seeder = stubSession(JSON.stringify(STORY392_IDS));
    await expect(seedBodies(seeder, "EXECMCPTMP392A")).resolves.toBeUndefined();
    expect(seeder.call).toHaveBeenCalledWith(
      "iris_execute_classmethod",
      expect.objectContaining({ namespace: "EXECMCPTMP392A", methodName: "SeedBodies", args: ["story392"] }),
    );

    const parser = stubSession("[]");
    await expect(hl7Fields(parser, "EXECMCPTMP392A", "MSH|^~\\&|")).resolves.toEqual([]);
    expect(parser.call).toHaveBeenCalledWith(
      "iris_execute_classmethod",
      expect.objectContaining({ namespace: "EXECMCPTMP392A", methodName: "Hl7Fields" }),
    );
  });

  it("lets a scratch name through for the Story 39.5 body-reader seed, and compiles only the classes of its set", async () => {
    for (const set of ["a", "b"] as const) {
      const seeder = stubSession(JSON.stringify(STORY395_IDS[set]));
      seeder.call.mockImplementation(async () => ({
        isError: false,
        content: [],
        structuredContent: { returnValue: JSON.stringify(STORY395_IDS[set]), success: true },
      }));
      await expect(seedBodyReader(seeder as never, "EXECMCPTMP395A", set)).resolves.toBeUndefined();
      const compiled = seeder.call.mock.calls
        .filter(([tool]) => tool === "iris_doc_compile")
        .map(([, args]) => (args as { doc: string }).doc);
      expect(compiled, `the classes compiled for set ${set}`).toEqual(STORY395_DOCUMENTS[set].map(([doc]) => doc));
      expect(seeder.call).toHaveBeenCalledWith(
        "iris_execute_classmethod",
        expect.objectContaining({ namespace: "EXECMCPTMP395A", className: "Story395.Seed", methodName: "Seed", args: [set] }),
      );
    }
    expect(STORY395_DOCUMENTS.b.map(([doc]) => doc), "namespace B compiles the seed only").toEqual(["Story395.Seed.cls"]);
  });

  it("lets a scratch name through for the Story 39.6 capstone seed, which compiles the Search Table class first and then seeds with no arguments", async () => {
    const seeder = stubSession(JSON.stringify(STORY396_IDS));
    seeder.call.mockImplementation(async () => ({
      isError: false,
      content: [],
      structuredContent: { returnValue: JSON.stringify(STORY396_IDS), success: true },
    }));
    await expect(seedCapstone(seeder as never, "EXECMCPTMP396A")).resolves.toBeUndefined();
    const compiled = seeder.call.mock.calls
      .filter(([tool]) => tool === "iris_doc_compile")
      .map(([, args]) => (args as { doc: string }).doc);
    expect(compiled, "the classes compiled, in order").toEqual(["Story394.SearchTable.cls", "Story396.Seed.cls"]);
    expect(STORY396_DOCUMENTS.map(([doc]) => doc)).toEqual(compiled);
    expect(seeder.call).toHaveBeenCalledWith(
      "iris_execute_classmethod",
      expect.objectContaining({ namespace: "EXECMCPTMP396A", className: "Story396.Seed", methodName: "Seed", args: [] }),
    );
    expect(STORY396_IDS).toEqual({ headers: "1,2,3,4", hl7: "1,2,3" });
  });

  it("lets a scratch name through for the Story 39.7 burn-down seed, which compiles the body class first and then seeds with no arguments", async () => {
    const seeder = stubSession(JSON.stringify(STORY397_IDS));
    seeder.call.mockImplementation(async () => ({
      isError: false,
      content: [],
      structuredContent: { returnValue: JSON.stringify(STORY397_IDS), success: true },
    }));
    await expect(seedBurnDown(seeder as never, "EXECMCPTMP397A")).resolves.toBeUndefined();
    const compiled = seeder.call.mock.calls
      .filter(([tool]) => tool === "iris_doc_compile")
      .map(([, args]) => (args as { doc: string }).doc);
    expect(compiled, "the classes compiled, in order").toEqual(["Story397.StreamBody.cls", "Story397.Seed.cls"]);
    expect(STORY397_DOCUMENTS.map(([doc]) => doc)).toEqual(compiled);
    expect(seeder.call).toHaveBeenCalledWith(
      "iris_execute_classmethod",
      expect.objectContaining({ namespace: "EXECMCPTMP397A", className: "Story397.Seed", methodName: "Seed", args: [] }),
    );
    expect(STORY397_IDS).toEqual({ headers: "1,2,3,4", logs: "1,2", xml: "1", stream: "1,2" });
    expect(Object.keys(STORY397_IDS), "the key order is the order the seed writes its map in").toEqual([
      "headers",
      "logs",
      "xml",
      "stream",
    ]);
  });

  it("lets a scratch name through for the Story 40.0 Event Log counts seed, which compiles one class and seeds with no arguments", async () => {
    const seeder = stubSession(JSON.stringify(STORY400_IDS));
    seeder.call.mockImplementation(async () => ({
      isError: false,
      content: [],
      structuredContent: { returnValue: JSON.stringify(STORY400_IDS), success: true },
    }));
    await expect(seedEventLogCounts(seeder as never, "EXECMCPTMP400A")).resolves.toBeUndefined();
    const compiled = seeder.call.mock.calls
      .filter(([tool]) => tool === "iris_doc_compile")
      .map(([, args]) => (args as { doc: string }).doc);
    expect(compiled, "the one class compiled").toEqual(["Story400.Seed.cls"]);
    expect(STORY400_DOCUMENTS.map(([doc]) => doc)).toEqual(compiled);
    expect(seeder.call).toHaveBeenCalledWith(
      "iris_execute_classmethod",
      expect.objectContaining({ namespace: "EXECMCPTMP400A", className: "Story400.Seed", methodName: "Seed", args: [] }),
    );
    expect(STORY400_IDS).toEqual({ logs: "1,2,3,4,5,6,7,8,9,10", headers: "1,2,3" });
    expect(Object.keys(STORY400_IDS), "the key order is the order the seed writes its map in").toEqual(["logs", "headers"]);
  });

  it("lets EXECMCPTMP401<letter> through for the Story 40.1 coverage seed, which compiles the four Story401 classes in order and seeds with no arguments", async () => {
    const seeder = stubSession(JSON.stringify(STORY401_IDS));
    seeder.call.mockImplementation(async () => ({
      isError: false,
      content: [],
      structuredContent: { returnValue: JSON.stringify(STORY401_IDS), success: true },
    }));
    await expect(seedCoverageFixture(seeder as never, "EXECMCPTMP401A")).resolves.toBeUndefined();
    const compiled = seeder.call.mock.calls
      .filter(([tool]) => tool === "iris_doc_compile")
      .map(([, args]) => (args as { doc: string }).doc);
    expect(compiled, "the classes compiled, in order").toEqual([
      "Story401.Fixture.cls",
      "Story401.FixtureTest.cls",
      "Story401.SlowTest.cls",
      "Story401.Seed.cls",
    ]);
    expect(STORY401_DOCUMENTS.map(([doc]) => doc)).toEqual(compiled);
    expect(seeder.call).toHaveBeenCalledWith(
      "iris_execute_classmethod",
      expect.objectContaining({ namespace: "EXECMCPTMP401A", className: "Story401.Seed", methodName: "Seed", args: [] }),
    );
    expect(STORY401_IDS).toEqual({ hang: "3" });
  });

  it("setSlowTestHang sets the hang in the named coverage namespace and checks what it returns", async () => {
    const dev = stubSession("20");
    dev.call.mockImplementation(async () => ({ isError: false, content: [], structuredContent: { returnValue: "20" } }));
    await expect(setSlowTestHang(dev as never, "EXECMCPTMP401A", 20)).resolves.toBeUndefined();
    expect(dev.call).toHaveBeenCalledWith(
      "iris_execute_classmethod",
      expect.objectContaining({ namespace: "EXECMCPTMP401A", className: "Story401.Seed", methodName: "SetHang", args: [20] }),
    );
    await expect(setSlowTestHang(dev as never, "EXECMCPTMP401A", 5)).rejects.toThrow(/returned "20"/);
  });

  it("the Story 40.1 fixture methods exist, the foreign session and the termination helper keep their guards, and MayTerminate is asked immediately before Terminate", () => {
    for (const method of [
      "MonitorState", "StartForeign", "StartForeignAll", "StopIfList", "TerminateCoverageProcess",
      "StartDecoy", "DecoyRun", "DecoyAlive", "StopDecoy", "PointRunnerAtDecoy",
      "HoldMonitorLock", "MonitorLockRun", "MonitorLockHeld", "ReleaseMonitorLock", "CorruptRoutines", "RenameRoutineList",
      "SeedRunRecords", "RunRecordCount", "ClearFakeRuns",
    ]) {
      expect(FIXTURE_CLASS_SOURCE, method).toContain(`ClassMethod ${method}(`);
    }
    // The decoy is never terminated: it ends by itself when asked, and the run record is pointed only at it.
    expect(FIXTURE_CLASS_SOURCE).toContain('If (pPid = "") || (pPid \'= $Get(^IRIS.TempStory391Fixture("decoy"))) { Quit "refused: "_pPid_" is not the decoy" }');
    const decoyMethods = FIXTURE_CLASS_SOURCE.slice(FIXTURE_CLASS_SOURCE.indexOf("ClassMethod StartDecoy("), FIXTURE_CLASS_SOURCE.indexOf("ClassMethod TerminateCoverageProcess("));
    expect(decoyMethods).not.toContain("Terminate(");
    expect(FIXTURE_CLASS_SOURCE).toContain('Quit "refused: a monitor session is already active"');
    expect(FIXTURE_CLASS_SOURCE).toContain("$ListBuild(\"ExecuteMCPv2.Temp.Story391Fixture.1\"), $ListBuild(\"RtnLine\"), $ListBuild($Job))");
    expect(FIXTURE_CLASS_SOURCE).toMatch(
      /MayTerminate\(tId, tRole, pPid\) \{ Quit "refused: MayTerminate is false for the "_tRole \}\n    Quit "terminated:"_\$System\.Process\.Terminate\(pPid\)/,
    );
    expect(FIXTURE_CLASS_SOURCE).toContain('If tRole = "" { Quit "refused: "_pPid_" is neither the supervisor nor the runner of the session node" }');
  });

  it("the Story 40.2 fixture methods exist, and each keeps its guard: the runner lock is held only for the next run id, object code is deleted only in a scratch namespace for a Story402 routine, the large record only above 990000000", () => {
    for (const method of [
      "HoldRunnerLock", "RunnerLockRun", "RunnerLockHeld", "ReleaseRunnerLock", "DeleteObjectCode",
      "SeedLargeRun", "ClearLargeRun", "MeasureStatus",
    ]) {
      expect(FIXTURE_CLASS_SOURCE, method).toContain(`ClassMethod ${method}(`);
    }
    expect(FIXTURE_CLASS_SOURCE).toContain('If pId \'= ($Get(^IRIS.TempExecuteMCPv2Coverage("seq")) + 1) { Quit "refused: "_pId_" is not the next coverage run id" }');
    expect(FIXTURE_CLASS_SOURCE).toContain('If ##class(ExecuteMCPv2.Coverage.Job).RunExists(pId) { Quit "refused: coverage run "_pId_" exists" }');
    expect(FIXTURE_CLASS_SOURCE).toContain('If pNamespace \'? 1"EXECMCPTMP"1.N1U { Quit "refused: the namespace must be EXECMCPTMP, digits and one capital letter" }');
    expect(FIXTURE_CLASS_SOURCE).toContain('If pRoutine \'? 1"Story402."1.AN1".1" { Quit "refused: the routine must be the first routine of a Story402 class" }');
    expect(FIXTURE_CLASS_SOURCE.match(/If \(pId < 990000000\) \|\| \(pId '= \(pId \\ 1\)\) \{ Quit "refused: the id must be a whole number above 990000000" \}/g)).toHaveLength(2);
    // The lock holder takes the lock of a run that does not exist yet, and terminates nothing.
    const holder = FIXTURE_CLASS_SOURCE.slice(FIXTURE_CLASS_SOURCE.indexOf("ClassMethod HoldRunnerLock("), FIXTURE_CLASS_SOURCE.indexOf("ClassMethod DeleteObjectCode("));
    expect(holder).not.toContain("Terminate(");
    expect(holder).not.toContain("LineByLine");
  });

  it("the Story 40.2 fixture sources are the oracle classes under the 402 names, and the seed refuses any namespace but EXECMCPTMP402<letter>", async () => {
    const fixture = await import("./coverage-fixture.js");
    expect(fixture.STORY402_DOCUMENTS.map(([doc]) => doc)).toEqual([
      "Story402.Fixture.cls",
      "Story402.Layout.cls",
      "Story402.Gone.cls",
      "Story402.FixtureTest.cls",
      "Story402.SlowTest.cls",
      "Story402.Seed.cls",
    ]);
    expect(fixture.STORY402_SEED_SOURCE).toContain('If $NAMESPACE \'? 1"EXECMCPTMP402"1U');
    expect(fixture.STORY402_LAYOUT_SOURCE, "tabs and a two-line signature, for the non-canonical layout").toContain("\tSet tX = pN\t; tab indented");
    expect(fixture.STORY402_LAYOUT_SOURCE).toContain("ClassMethod Gap(pA As %Integer,\n    pB As %Integer) As %Integer");

    // The repository's OS-test copy of the oracle class has the same text under its own name (the plan's "upload exactly").
    const copy = readFileSync(new URL("../../../../src/ExecuteMCPv2/Tests/CoverageSourceFixture.cls", import.meta.url), "utf8");
    expect(copy.replace("ExecuteMCPv2.Tests.CoverageSourceFixture", "Story402.Fixture")).toBe(fixture.STORY402_FIXTURE_SOURCE);

    const dev = stubSession("20");
    dev.call.mockImplementation(async () => ({ isError: false, content: [], structuredContent: { returnValue: "20" } }));
    await expect(fixture.setSlowTestHang(dev as never, "EXECMCPTMP402A", 20)).resolves.toBeUndefined();
    expect(dev.call).toHaveBeenCalledWith(
      "iris_execute_classmethod",
      expect.objectContaining({ namespace: "EXECMCPTMP402A", className: "Story402.Seed", methodName: "SetHang", args: [20] }),
    );
    await expect(fixture.seedReportFixture(dev as never, "EXECMCPTMP391A")).rejects.toThrow(/is not a fixture namespace name/);
    await expect(fixture.seedReportFixture(dev as never, "HSCUSTOM")).rejects.toThrow(/is not a fixture namespace name/);
  });

  it("the all-processes foreign session (decision #49) starts only with the monitor idle, only on the fixture's own routine, and is the one Start in the fixture class without a process list", () => {
    const method = FIXTURE_CLASS_SOURCE.slice(FIXTURE_CLASS_SOURCE.indexOf("ClassMethod StartForeignAll("), FIXTURE_CLASS_SOURCE.indexOf("ClassMethod StopIfList("));
    expect(method).toContain('If ##class(ExecuteMCPv2.Coverage.Job).MonitorActive() { Quit "refused: a monitor session is already active" }');
    expect(method).toContain('Start($ListBuild("ExecuteMCPv2.Temp.Story391Fixture.1"), $ListBuild("RtnLine"), "")');
    expect(method.indexOf("MonitorActive()"), "the idle check comes before the Start").toBeLessThan(method.indexOf("LineByLine).Start("));
    expect(FIXTURE_CLASS_SOURCE.match(/LineByLine\)\.Start\(/g), "the fixture class starts two kinds of session").toHaveLength(2);
    expect(FIXTURE_CLASS_SOURCE.match(/\$ListBuild\("RtnLine"\), ""\)/g), "and only one is a session of all processes").toHaveLength(1);
    expect(FIXTURE_CLASS_SOURCE).toContain('Kill ^IRIS.TempStory391Fixture("foreign"), ^IRIS.TempStory391Fixture("foreignAll")');
  });

  it("the Story 40.1 seed refuses any namespace but EXECMCPTMP401<letter>", async () => {
    const { STORY401_SEED_SOURCE } = await import("./coverage-fixture.js");
    expect(STORY401_SEED_SOURCE).toContain('If $NAMESPACE \'? 1"EXECMCPTMP401"1U');
  });

  it("the Story 40.0 seed refuses any namespace but EXECMCPTMP400<letter>, and one that holds headers or Event Log rows", () => {
    expect(STORY400_SEED_SOURCE).toContain('If $NAMESPACE \'? 1"EXECMCPTMP400"1U');
    expect(STORY400_SEED_SOURCE).toContain('If $Order(^Ens.MessageHeaderD("")) \'= ""');
    expect(STORY400_SEED_SOURCE).toContain('If $Order(^Ens.Util.LogD("")) \'= ""');
  });

  it("the Story 40.0 MetricsAtZone helper runs only in EXECMCPTMP400<letter> and restores the process time zone after its Try/Catch, on every path", () => {
    expect(STORY400_SEED_SOURCE).toContain('If $NAMESPACE \'? 1"EXECMCPTMP400"1U { Quit "REFUSED: MetricsAtZone');
    expect(STORY400_SEED_SOURCE).toMatch(/Set tSaved = \$ZTimeZone\n[\s\S]*?Catch ex \{\n[^\n]*\n\s*\}\n\s*Set \$ZTimeZone = tSaved\n\s*Quit tResult/);
  });

  it("maps HS to HSLIB only when hsLib is set, and removes an HS mapping in every teardown", async () => {
    const mappingCalls = (session: ReturnType<typeof stubSession>) =>
      session.call.mock.calls.filter(([tool]) => tool === "iris_mapping_manage").map(([, args]) => args as Record<string, unknown>);

    const without = stubSession("C:/mgr/");
    await createInteropNamespace(without, without, "EXECMCPTMP397A", { interop: true });
    expect(mappingCalls(without).some((args) => args.name === "HS"), "no HS mapping without hsLib").toBe(false);

    const withHs = stubSession("C:/mgr/");
    await createInteropNamespace(withHs, withHs, "EXECMCPTMP397A", { interop: true, hsLib: true });
    expect(mappingCalls(withHs)).toContainEqual({
      action: "create",
      type: "package",
      namespace: "EXECMCPTMP397A",
      name: "HS",
      database: "HSLIB",
    });

    const teardown = stubSession("removed");
    await removeInteropNamespace(teardown, teardown, "EXECMCPTMP397A");
    expect(mappingCalls(teardown)).toContainEqual({
      action: "delete",
      type: "package",
      namespace: "EXECMCPTMP397A",
      name: "HS",
    });
  });

  it("the Leftovers method of the fixture class reports an HS package mapping", () => {
    expect(FIXTURE_CLASS_SOURCE).toContain('Config.MapPackages).Exists(tName, "HS")');
    expect(FIXTURE_CLASS_SOURCE).toContain('"package mapping "_tName_" HS"');
  });

  it("refuses a seed answer that is not the ID map, naming what it returned", async () => {
    for (const answer of ["REFUSED: the namespace already holds message headers", '{"headers":"1,2","hl7":"1"}']) {
      const seeder = stubSession(answer);
      seeder.call.mockImplementation(async () => ({
        isError: false,
        content: [],
        structuredContent: { returnValue: answer, success: true },
      }));
      await expect(seedCapstone(seeder as never, "EXECMCPTMP396A")).rejects.toThrow(/seeding the capstone fixture mu into EXECMCPTMP396A returned/);
    }
  });

  it("the Story 40.3 fixture methods exist, and each keeps its guard: the InstalledNamespace node is set and cleared only for an existing scratch namespace, the Ens lock is held only in one", () => {
    for (const method of [
      "SetInstalledNamespace", "ClearInstalledNamespace", "HoldEnsRuntime", "EnsRuntimeRun", "EnsRuntimeHeld", "ReleaseEnsRuntime",
    ]) {
      expect(FIXTURE_CLASS_SOURCE, method).toContain(`ClassMethod ${method}(`);
    }
    const nodeMethods = FIXTURE_CLASS_SOURCE.slice(
      FIXTURE_CLASS_SOURCE.indexOf("ClassMethod SetInstalledNamespace("),
      FIXTURE_CLASS_SOURCE.indexOf("ClassMethod HoldEnsRuntime("),
    );
    // Both refuse a name that is not a scratch name, and a namespace that does not exist, before they touch the node.
    expect(nodeMethods.match(/If pName '\? 1"EXECMCPTMP"1\.N1U \{ Quit "refused: the name must be EXECMCPTMP, digits and one capital letter" \}/g)).toHaveLength(2);
    expect(nodeMethods.match(/If '##class\(Config\.Namespaces\)\.Exists\(pName\) \{/g)).toHaveLength(2);
    // The one node, set to nothing and killed, and no other: no EnableNamespace, no other subscript, no other global.
    expect(nodeMethods.match(/\^%SYS\(/g)).toHaveLength(2);
    expect(nodeMethods).toContain('Set ^%SYS("Ensemble", "InstalledNamespace", pName) = ""');
    expect(nodeMethods).toContain('Kill ^%SYS("Ensemble", "InstalledNamespace", pName)');
    expect(FIXTURE_CLASS_SOURCE, "EnableNamespace is never called").not.toContain("EnsembleMgr");
    expect(nodeMethods.indexOf("Exists(pName)"), "the existence check comes before the first write").toBeLessThan(nodeMethods.indexOf("Set ^%SYS("));
    // The lock holder is a job of this class that switches to the scratch namespace itself, takes ^Ens.Runtime there and nowhere else.
    const holder = FIXTURE_CLASS_SOURCE.slice(FIXTURE_CLASS_SOURCE.indexOf("ClassMethod HoldEnsRuntime("), FIXTURE_CLASS_SOURCE.indexOf("ClassMethod ReleaseEnsRuntime("));
    expect(holder.match(/If pNamespace '\? 1"EXECMCPTMP"1\.N1U/g)).toHaveLength(3);
    expect(holder).toContain("If '##class(%SYS.Namespace).Exists(pNamespace) { Quit \"refused: namespace \"_pNamespace_\" does not exist\" }");
    expect(holder).toContain("Set $NAMESPACE = pNamespace\n    Lock +^Ens.Runtime:10");
    expect(holder).toContain("$Select(pSeconds > 30: 30, pSeconds < 1: 1, 1: pSeconds)");
    expect(holder).not.toContain("Terminate(");
    expect(holder).not.toContain("LineByLine");
    expect(holder.match(/Lock \+\^Ens\.Runtime/g)).toHaveLength(2);
  });

  it("the Story 40.3 fixture helpers refuse a name that is not EXECMCPTMP403<letter>, before any tool call", async () => {
    const fixture = await import("./testproduction-fixture.js");
    for (const name of [...REFUSED_NAMES, "EXECMCPTMP391A", "EXECMCPTMP4030", "EXECMCPTMP403AB"]) {
      const admin = stubSession();
      const dev = stubSession();
      const interop = stubSession();
      await expect(fixture.setInstalledNamespace(dev, name), name).rejects.toThrow(/not a fixture namespace name/);
      await expect(fixture.clearInstalledNamespace(dev, name), name).rejects.toThrow(/not a fixture namespace name/);
      await expect(fixture.holdEnsRuntime(dev, name, 10), name).rejects.toThrow(/not a fixture namespace name/);
      await expect(fixture.releaseEnsRuntime(dev, name), name).rejects.toThrow(/not a fixture namespace name/);
      await expect(fixture.seedTestProductionFixture(dev as never, name), name).rejects.toThrow(/not a fixture namespace name/);
      await expect(fixture.seedPlainFixture(dev as never, name), name).rejects.toThrow(/not a fixture namespace name/);
      await expect(fixture.createTestProductionNamespace(admin as never, dev as never, name), name).rejects.toThrow(/not a fixture namespace name/);
      await expect(fixture.removeTestProductionNamespace(admin as never, interop, dev as never, name), name).rejects.toThrow(/not a fixture namespace name/);
      expect(admin.call).not.toHaveBeenCalled();
      expect(dev.call).not.toHaveBeenCalled();
      expect(interop.call).not.toHaveBeenCalled();
    }
  });

  it("the Story 40.3 teardown stops the production and clears the node only when the namespace exists, then removes it; the node is set before the classes compile", async () => {
    const fixture = await import("./testproduction-fixture.js");

    // Present: the leftovers list the namespace, so the production is stopped (forced) and the node cleared BEFORE the namespace goes.
    const order: string[] = [];
    const present = stubSession();
    present.call.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      order.push(`${tool}${args.methodName ? `:${String(args.methodName)}` : ""}${args.action ? `:${String(args.action)}` : ""}`);
      const returnValue =
        args.methodName === "Leftovers" ? JSON.stringify(["namespace EXECMCPTMP403A"])
          : args.methodName === "ClearInstalledNamespace" ? "cleared"
            : args.methodName === "ManagerDirectory" ? "C:/mgr/"
              : args.methodName === "RemoveDatabaseFiles" ? "removed"
                : "";
      return { isError: false, content: [], structuredContent: { returnValue } };
    });
    await fixture.removeTestProductionNamespace(present as never, present, present as never, "EXECMCPTMP403A");
    const stop = order.indexOf("iris_production_control:stop");
    const clear = order.indexOf("iris_execute_classmethod:ClearInstalledNamespace");
    const removeNamespace = order.indexOf("iris_namespace_manage:delete");
    expect(stop, "the production is stopped").toBeGreaterThan(-1);
    expect(clear, "the node is cleared after the stop").toBeGreaterThan(stop);
    expect(removeNamespace, "the namespace is removed after the node is cleared").toBeGreaterThan(clear);
    expect(present.call).toHaveBeenCalledWith(
      "iris_production_control",
      { action: "stop", force: true, namespace: "EXECMCPTMP403A" },
    );

    // Absent: nothing is stopped and no node is cleared (the fixture would refuse a namespace that does not exist), but the removal still runs.
    const absentOrder: string[] = [];
    const absent = stubSession();
    absent.call.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      absentOrder.push(`${tool}${args.methodName ? `:${String(args.methodName)}` : ""}`);
      const returnValue = args.methodName === "Leftovers" ? "[]" : args.methodName === "ManagerDirectory" ? "C:/mgr/" : args.methodName === "RemoveDatabaseFiles" ? "removed" : "";
      return { isError: false, content: [], structuredContent: { returnValue } };
    });
    await fixture.removeTestProductionNamespace(absent as never, absent, absent as never, "EXECMCPTMP403A");
    expect(absentOrder).not.toContain("iris_production_control");
    expect(absentOrder).not.toContain("iris_execute_classmethod:ClearInstalledNamespace");
    expect(absentOrder).toContain("iris_namespace_manage");

    // Creation: the node is set before the first TestProduction class is put, and every class is compiled.
    const created: string[] = [];
    const maker = stubSession();
    maker.call.mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      created.push(`${tool}:${String(args.methodName ?? args.name ?? args.doc ?? args.action ?? "")}`);
      return { isError: false, content: [], structuredContent: { returnValue: args.methodName === "SetInstalledNamespace" ? "set" : "C:/mgr/", success: true } };
    });
    await fixture.createTestProductionNamespace(maker as never, maker as never, "EXECMCPTMP403A");
    const setNode = created.indexOf("iris_execute_classmethod:SetInstalledNamespace");
    const firstClass = created.findIndex((entry) => entry.startsWith("iris_doc_put:"));
    expect(setNode).toBeGreaterThan(-1);
    expect(firstClass, "the node is set before any class is put").toBeGreaterThan(setNode);
    expect(created.filter((entry) => entry.startsWith("iris_doc_compile:")).map((entry) => entry.slice("iris_doc_compile:".length))).toEqual(
      fixture.STORY403_DOCUMENTS.map(([doc]) => doc),
    );
  });

  it("the Story 40.3 sources: the pass, fail and error tests differ only in CheckResults, OtherTest and BadTest name their own production, FreshTest is a TestProduction test, and nothing is in HSCUSTOM", async () => {
    const fixture = await import("./testproduction-fixture.js");
    const sources = new Map(fixture.STORY403_DOCUMENTS.map(([doc, source]) => [doc, source] as const));
    expect(fixture.STORY403_DOCUMENTS.map(([doc]) => doc)).toEqual([
      "Story392.Operation.cls", "Story403.Production.cls", "Story403.Other.cls", "Story403.PassTest.cls", "Story403.FailTest.cls",
      "Story403.ErrorTest.cls", "Story403.OtherTest.cls", "Story403.BadTest.cls", "Story403.Mixed.ProdTest.cls",
      "Story403.PlainTest.cls", "Story403.Plain.OneTest.cls", "Story403.Mixed.PlainTest.cls",
    ]);
    expect(sources.get("Story403.PassTest.cls")).toContain('Parameter PRODUCTION = "Story403.Production";');
    expect(sources.get("Story403.PassTest.cls")).toContain("Parameter MAXWAIT = 3;");
    expect(sources.get("Story403.PassTest.cls")).toContain("Parameter MINRUN = 1;");
    expect(sources.get("Story403.FailTest.cls")).toContain('$$$AssertTrue(0, "fail fixture")');
    expect(sources.get("Story403.ErrorTest.cls")).toContain("1 / tZero");
    expect(sources.get("Story403.OtherTest.cls")).toContain('Parameter PRODUCTION = "Story403.Other";');
    expect(sources.get("Story403.BadTest.cls")).toContain('Parameter PRODUCTION = "Story403.Missing";');
    expect(sources.get("Story403.Mixed.ProdTest.cls")).toContain("Extends %UnitTest.TestProduction");
    expect(sources.get("Story403.Mixed.PlainTest.cls")).toContain("Extends %UnitTest.TestCase");
    expect(fixture.STORY403_FRESH_SOURCE).toContain("Class Story403.FreshTest Extends %UnitTest.TestProduction");
    expect(sources.get("Story403.Production.cls")).toContain('<Item Name="Story403.Target" Category="" ClassName="Story392.Operation"');
    expect(sources.get("Story403.Other.cls")).toContain('<Item Name="Story403.OtherTarget" Category="" ClassName="Story392.Operation"');
    for (const [doc, source] of fixture.STORY403_DOCUMENTS) {
      expect(source, doc).not.toContain("ExecuteMCPv2");
    }
  });
});
