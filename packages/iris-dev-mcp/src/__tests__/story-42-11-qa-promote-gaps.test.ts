/**
 * Story 42.11 (QA) - the rows of the Storage guard on `iris_env_promote` execute that `env-promote-storage-guard.test.ts`
 * leaves open:
 *
 *  - the `namespace` argument replaces BOTH sides' namespace, so the preflight, the writes, the refusal and the dialog all name
 *    the namespace the caller asked for (every other row runs with the profiles' own namespaces, which differ from each other, so
 *    a preflight that read one side in the other's namespace is caught there, but one that ignored the argument is not);
 *  - `steps` is an allowlist: a class step that is not selected is neither read nor counted, so a drop in it refuses nothing;
 *  - the allowlist's order does not reorder the plan: the refusal names the dropping classes in plan order;
 *  - a drop in one step refuses the whole execute even when another step's preflight read failed: the failure is not carried to
 *    its turn, because nothing is written.
 *
 * The plan is a REAL `plan` result. The expected texts come from the story's Design Notes, never from the implementation
 * (Rule #36). The class text a GET answers is the real nine-key document of `conflict-fakes.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { ProfileResolutionError } from "@iris-mcp/shared";
import { STORAGE_FIXTURES } from "@iris-mcp/shared/test-helpers/storage-guard-fixtures";
import { envPromoteTool } from "../tools/env-promote.js";
import { currentClass, notFound } from "./conflict-fakes.js";
import { createMockCtx, createMockHttp, envelope } from "./test-helpers.js";

/** A scanner fixture's text for class `name`, found by the start of its id. */
function fixtureLines(idPrefix: string, name: string): string[] {
  const fixture = STORAGE_FIXTURES.find((candidate) => candidate.id.startsWith(idPrefix));
  if (fixture === undefined) throw new Error(`no scanner fixture starts with '${idPrefix}'`);
  return fixture.lines(name);
}

const withStorage = (name: string): string[] => fixtureLines("F:", name);
const withoutStorage = (name: string): string[] => fixtureLines("A:", name);

const SOURCE_NS = "HSCUSTOM";
const TARGET_NS = "SADEMO";
const docPath = (namespace: string, name: string): string => `/api/atelier/v8/${namespace}/doc/${name}`;

type Http = ReturnType<typeof createMockHttp>;
type Confirm = NonNullable<ToolContext["confirm"]>;

/** A diff of the documents `names`, all `onlyInSource`: `plan` turns each into one `putAndCompile` step, in this order. */
function documentsDiff(...names: string[]): Record<string, unknown> {
  return {
    source: { profile: "source", namespace: SOURCE_NS },
    target: { profile: "target", namespace: TARGET_NS },
    domains: { documents: { onlyInSource: names, onlyInTarget: [], differs: [], identical: 0 } },
    summary: { driftCount: names.length, identicalCount: 0 },
  };
}

describe("Story 42.11 (QA): iris_env_promote execute, the Storage guard's scope and order", () => {
  const originalGovernance = process.env.IRIS_GOVERNANCE;
  let sourceHttp: Http;
  let targetHttp: Http;
  let ctx: ToolContext;

  /** The documents each side holds: name to lines, or `null` for a 200 with no content. A target document that is not there is new (404). */
  let sourceDocs: Record<string, string[] | null>;
  let targetDocs: Record<string, string[]>;

  /** Answer the documents of `sourceDocs` and `targetDocs` in `sourceNs` and `targetNs`; any other path is a 404. */
  function arrange(sourceNs = SOURCE_NS, targetNs = TARGET_NS): void {
    sourceHttp.get.mockImplementation(async (path: string) => {
      if (path === "/api/atelier/") return envelope({ content: { api: 8 } });
      for (const [name, lines] of Object.entries(sourceDocs)) {
        if (path === docPath(sourceNs, name)) return envelope(lines === null ? { name } : { name, content: lines });
      }
      throw notFound(path);
    });
    targetHttp.get.mockImplementation(async (path: string) => {
      if (path === "/api/atelier/") return envelope({ content: { api: 8 } });
      for (const [name, lines] of Object.entries(targetDocs)) {
        if (path === docPath(targetNs, name)) return envelope(currentClass(lines));
      }
      throw notFound(path);
    });
    targetHttp.put.mockResolvedValue(envelope({ status: "" }));
    targetHttp.post.mockImplementation(async (path: string, body: unknown) => {
      if (path.includes("/action/compile")) return envelope({ content: (body as string[]).map((name) => ({ name, errors: [] })) });
      return envelope({ success: true });
    });
  }

  async function execute(diff: Record<string, unknown>, steps: number[], extra: Record<string, unknown> = {}) {
    const planned = await envPromoteTool.handler({ action: "plan", source: "source", target: "target", diff }, createMockCtx());
    return envPromoteTool.handler(
      { action: "execute", source: "source", target: "target", diff, plan: planned.structuredContent, steps, confirm: true, ...extra },
      ctx,
    );
  }

  const docGets = (http: Http): string[] => http.get.mock.calls.map((call) => String(call[0])).filter((path) => path.includes("/doc/"));
  const writeCount = (): number => targetHttp.put.mock.calls.length + targetHttp.post.mock.calls.length + targetHttp.delete.mock.calls.length;

  beforeEach(() => {
    sourceHttp = createMockHttp(SOURCE_NS);
    targetHttp = createMockHttp(TARGET_NS);
    ctx = createMockCtx(sourceHttp);
    ctx.resolveProfileClient = vi.fn(async (name: string) => {
      if (name === "source") return sourceHttp;
      if (name === "target") return targetHttp;
      throw new ProfileResolutionError(name, ["default", "source", "target"]);
    });
    sourceDocs = { "Alpha.cls": withoutStorage("Alpha"), "Beta.cls": withoutStorage("Beta"), "Gamma.cls": withStorage("Gamma") };
    targetDocs = { "Alpha.cls": withStorage("Alpha"), "Beta.cls": withStorage("Beta") };
    arrange();
  });

  afterEach(() => {
    if (originalGovernance === undefined) delete process.env.IRIS_GOVERNANCE;
    else process.env.IRIS_GOVERNANCE = originalGovernance;
  });

  describe("the namespace argument replaces the namespace of both sides", () => {
    it("the preflight reads both sides in it, and the refusal names it in the text, the source and the target", async () => {
      arrange("ALTNS", "ALTNS");

      const result = await execute(documentsDiff("Alpha.cls"), [1], { namespace: "ALTNS" });

      expect(docGets(sourceHttp)).toEqual([docPath("ALTNS", "Alpha.cls")]);
      expect(docGets(targetHttp)).toEqual([docPath("ALTNS", "Alpha.cls")]);
      expect(writeCount()).toBe(0);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text.startsWith("Promotion to server 'target', namespace 'ALTNS' was not run and no changes were made: it drops")).toBe(true);
      expect(result.structuredContent).toEqual({
        code: "STORAGE_DROPPED",
        source: { profile: "source", namespace: "ALTNS" },
        target: { profile: "target", namespace: "ALTNS" },
        storageDrops: [{ name: "Alpha.cls", droppedStorage: ["Default"] }],
      });
    });

    it("a class that exists only in the profile's own namespace is new in the namespace the caller named: nothing is refused", async () => {
      // The target holds Alpha.cls with its Storage in SADEMO only; in ALTNS there is no such class.
      arrange("ALTNS", "ALTNS");
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return envelope({ content: { api: 8 } });
        if (path === docPath(TARGET_NS, "Alpha.cls")) return envelope(currentClass(withStorage("Alpha")));
        throw notFound(path);
      });

      const result = await execute(documentsDiff("Alpha.cls"), [1], { namespace: "ALTNS" });

      expect(result.isError).toBeFalsy();
      expect(docGets(targetHttp)).toEqual([docPath("ALTNS", "Alpha.cls")]);
      expect(result.structuredContent).not.toHaveProperty("storageDrops");
    });

    it("the override writes in it, and the dialog names it in its target and lists the drop", async () => {
      arrange("ALTNS", "ALTNS");
      const confirm = vi.fn<Confirm>(async () => ({ proceed: true }));
      ctx.confirm = confirm;

      const result = await execute(documentsDiff("Alpha.cls"), [1], { namespace: "ALTNS", allowStorageRegeneration: true });

      expect(confirm.mock.calls[0]?.[0]).toEqual({
        operation: "promote changes to another server",
        target: "server 'target', namespace ALTNS",
        scope: "1 step(s) from server 'source': #1 documents putAndCompile Alpha.cls; drops Storage definitions: Alpha.cls ('Default')",
      });
      expect(targetHttp.put.mock.calls.map((call) => call[0])).toEqual([`${docPath("ALTNS", "Alpha.cls")}?ignoreConflict=1`]);
      expect(targetHttp.post.mock.calls.map((call) => call[0])).toEqual(["/api/atelier/v8/ALTNS/action/compile?flags=cuk"]);
      expect(result.structuredContent).toMatchObject({ storageDrops: [{ name: "Alpha.cls", droppedStorage: ["Default"] }] });
    });
  });

  describe("steps is an allowlist", () => {
    it("a class step that is not selected is neither read nor refused: only the selected class is checked and written", async () => {
      const result = await execute(documentsDiff("Alpha.cls", "Beta.cls", "Gamma.cls"), [3]);

      expect(result.isError).toBeFalsy();
      expect(docGets(sourceHttp)).toEqual([docPath(SOURCE_NS, "Gamma.cls")]);
      expect(docGets(targetHttp)).toEqual([docPath(TARGET_NS, "Gamma.cls")]);
      expect(targetHttp.put.mock.calls.map((call) => call[0])).toEqual([`${docPath(TARGET_NS, "Gamma.cls")}?ignoreConflict=1`]);
      expect(result.structuredContent).not.toHaveProperty("storageDrops");
    });

    it("the selected classes that drop are named in plan order, whatever order the allowlist lists them in", async () => {
      const result = await execute(documentsDiff("Alpha.cls", "Beta.cls", "Gamma.cls"), [3, 2, 1]);

      expect(result.isError).toBe(true);
      expect((result.structuredContent as { storageDrops: unknown }).storageDrops).toEqual([
        { name: "Alpha.cls", droppedStorage: ["Default"] },
        { name: "Beta.cls", droppedStorage: ["Default"] },
      ]);
      expect(result.content[0]?.text).toContain(
        "it drops the Storage definition 'Default' of 'Alpha.cls'; the Storage definition 'Default' of 'Beta.cls' that the classes have now,",
      );
      expect(writeCount()).toBe(0);
    });
  });

  describe("a drop and a failed preflight read in the same call", () => {
    it("the drop refuses the whole execute: the step whose source has no content is not run and is not reported", async () => {
      sourceDocs["Beta.cls"] = null;

      const result = await execute(documentsDiff("Alpha.cls", "Beta.cls"), [1, 2]);

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        code: "STORAGE_DROPPED",
        source: { profile: "source", namespace: SOURCE_NS },
        target: { profile: "target", namespace: TARGET_NS },
        storageDrops: [{ name: "Alpha.cls", droppedStorage: ["Default"] }],
      });
      expect(result.structuredContent).not.toHaveProperty("executed");
      expect(writeCount()).toBe(0);
    });
  });
});
