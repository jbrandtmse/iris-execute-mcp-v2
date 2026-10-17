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
  STORY392_IDS,
  createInteropNamespace,
  hl7Fields,
  leftovers,
  removeInteropNamespace,
  seedBodies,
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
});
