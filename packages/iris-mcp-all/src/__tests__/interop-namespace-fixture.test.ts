/**
 * The name guard of the disposable-namespace harness (`interop-namespace-fixture.ts`, Story 39.1). No IRIS.
 *
 * The harness deletes mappings, namespaces, database configurations, database files and directories from a
 * name it is given, on a shared instance. Every function that takes a name must refuse one that is not
 * `EXECMCPTMP<digits><capital letter>` before it calls any tool, so a caller that passes a real namespace
 * name (`USER`, `HSCUSTOM`) cannot reach a delete. The sessions here are stubs that record their calls.
 */

import { describe, it, expect, vi } from "vitest";
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

  it("the Story 40.0 seed refuses any namespace but EXECMCPTMP400<letter>, and one that holds headers or Event Log rows", () => {
    expect(STORY400_SEED_SOURCE).toContain('If $NAMESPACE \'? 1"EXECMCPTMP400"1U');
    expect(STORY400_SEED_SOURCE).toContain('If $Order(^Ens.MessageHeaderD("")) \'= ""');
    expect(STORY400_SEED_SOURCE).toContain('If $Order(^Ens.Util.LogD("")) \'= ""');
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
});
