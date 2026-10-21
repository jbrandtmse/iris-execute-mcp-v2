/**
 * Story 42.11 - the Storage-drop guard on `iris_env_promote` execute.
 *
 * The matrix rows (the refusal, the override, nothing dropped, a failed preflight read, a decline after the
 * preflight) with exact texts and call orders. The expected texts come from the story's Design Notes, never
 * from the implementation. The plan is a REAL `plan` result; the class text a GET answers is the real nine-key
 * document of `conflict-fakes.ts` (a class that is not there is a 404).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { CONFIRMATION_TEXT_LIMIT, IrisApiError, ProfileResolutionError } from "@iris-mcp/shared";
import { STORAGE_FIXTURES } from "@iris-mcp/shared/test-helpers/storage-guard-fixtures";
import { envPromoteTool } from "../tools/env-promote.js";
import { currentClass, notFound } from "./conflict-fakes.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

/** A scanner fixture's text for class `name`, found by the start of its id. */
function fixtureLines(idPrefix: string, name: string): string[] {
  const fixture = STORAGE_FIXTURES.find((candidate) => candidate.id.startsWith(idPrefix));
  if (fixture === undefined) throw new Error(`no scanner fixture starts with '${idPrefix}'`);
  return fixture.lines(name);
}

const withStorage = (name: string): string[] => fixtureLines("F:", name);
const withoutStorage = (name: string): string[] => fixtureLines("A:", name);

const SRC = "/api/atelier/v8/HSCUSTOM/doc/";
const TGT = "/api/atelier/v8/SADEMO/doc/";

type Http = ReturnType<typeof createMockHttp>;
type Confirm = NonNullable<ToolContext["confirm"]>;

const DECLINED_RESULT = {
  content: [{ type: "text" as const, text: "The person declined the confirmation." }],
  structuredContent: { code: "CONFIRMATION_DECLINED" },
  isError: true,
};

/** The one mapping the source holds, which the mixed plan creates on the target. */
const MAPPING = { name: "NewGlobal", type: "global", namespace: "HSCUSTOM", database: "IRISDB" };

/** The call order of a mock's first call: later calls have larger numbers. */
function firstCallOrder(fn: { mock: { invocationCallOrder: number[] } }): number {
  const order = fn.mock.invocationCallOrder[0];
  expect(order).toBeDefined();
  return order as number;
}

/** A diff with a mapping (1) and the documents `Changed.cls` (2), `New.cls` (3) and `Rtn.mac` (4). */
function mixedDiff(): Record<string, unknown> {
  return {
    source: { profile: "source", namespace: "HSCUSTOM" },
    target: { profile: "target", namespace: "SADEMO" },
    domains: {
      mappings: { onlyInSource: ["global::NewGlobal"], onlyInTarget: [], differs: [], identical: 0 },
      documents: {
        onlyInSource: ["New.cls", "Rtn.mac"],
        onlyInTarget: [],
        differs: [
          { name: "Changed.cls", sourceHash: "a".repeat(64), targetHash: "b".repeat(64), sourceTs: "t1", targetTs: "t2" },
        ],
        identical: 0,
      },
    },
    summary: { driftCount: 4, identicalCount: 0 },
  };
}

/** A diff of `count` documents `C01.cls`, `C02.cls`, ..., all `onlyInSource`. */
function manyClassesDiff(count: number): Record<string, unknown> {
  const names = Array.from({ length: count }, (_, i) => `C${String(i + 1).padStart(2, "0")}.cls`);
  return {
    source: { profile: "source", namespace: "HSCUSTOM" },
    target: { profile: "target", namespace: "SADEMO" },
    domains: { documents: { onlyInSource: names, onlyInTarget: [], differs: [], identical: 0 } },
    summary: { driftCount: count, identicalCount: 0 },
  };
}

interface PlanResult {
  planHash: string;
  steps: Array<{ index: number; subject: string }>;
}

async function buildPlan(diff: Record<string, unknown>): Promise<PlanResult> {
  const result = await envPromoteTool.handler(
    { action: "plan", source: "source", target: "target", diff },
    createMockCtx(),
  );
  return result.structuredContent as unknown as PlanResult;
}

describe("iris_env_promote execute: the Storage guard (Story 42.11)", () => {
  const originalGovernance = process.env.IRIS_GOVERNANCE;
  let sourceHttp: Http;
  let targetHttp: Http;
  let ctx: ToolContext;

  /** The documents the source and the target hold: name to lines, or `null` for a 200 with no content. */
  let sourceDocs: Record<string, string[] | null>;
  let targetDocs: Record<string, string[]>;

  function wire(sourceNamespace = "HSCUSTOM", targetNamespace = "SADEMO"): void {
    sourceHttp = createMockHttp(sourceNamespace);
    targetHttp = createMockHttp(targetNamespace);
    ctx = createMockCtx(sourceHttp);
    ctx.resolveProfileClient = vi.fn(async (name: string) => {
      if (name === "source") return sourceHttp;
      if (name === "target") return targetHttp;
      throw new ProfileResolutionError(name, ["default", "source", "target"]);
    });
  }

  /** The clients answer from `sourceDocs` and `targetDocs`; a target class that is not there is new (404). */
  function arrange(): void {
    sourceHttp.get.mockImplementation(async (path: string) => {
      if (path === "/api/atelier/") return envelope({ content: { api: 8 } });
      if (path.includes("/config/mapping/")) return envelope(path.includes("/global?") ? [MAPPING] : []);
      for (const [name, lines] of Object.entries(sourceDocs)) {
        if (path === `${SRC}${name}`) return envelope(lines === null ? { name } : { name, content: lines });
      }
      throw notFound(path);
    });
    targetHttp.get.mockImplementation(async (path: string) => {
      if (path === "/api/atelier/") return envelope({ content: { api: 8 } });
      for (const [name, lines] of Object.entries(targetDocs)) {
        if (path === `${TGT}${name}`) return envelope(currentClass(lines));
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
    const plan = await buildPlan(diff);
    return envPromoteTool.handler(
      { action: "execute", source: "source", target: "target", diff, plan, steps, confirm: true, ...extra },
      ctx,
    );
  }

  function proceedingConfirm() {
    return vi.fn<Confirm>(async () => ({ proceed: true }));
  }

  function decliningConfirm() {
    return vi.fn<Confirm>(async () => ({ proceed: false, result: DECLINED_RESULT }));
  }

  /** The traffic that writes: every PUT, POST, DELETE and HEAD of both clients. */
  function writes() {
    return { sourcePut: sourceHttp.put.mock.calls, sourcePost: sourceHttp.post.mock.calls, targetPut: targetHttp.put.mock.calls, targetPost: targetHttp.post.mock.calls, targetDelete: targetHttp.delete.mock.calls };
  }

  /** The document paths each client was asked to GET. */
  function docGets(http: Http): string[] {
    return http.get.mock.calls.map((call) => String(call[0])).filter((path) => path.includes("/doc/"));
  }

  const NONE: ReturnType<typeof writes> = { sourcePut: [], sourcePost: [], targetPut: [], targetPost: [], targetDelete: [] };

  beforeEach(() => {
    wire();
    sourceDocs = {
      "Changed.cls": withoutStorage("Changed"),
      "New.cls": withStorage("New"),
      "Rtn.mac": ["ROUTINE Rtn", " quit"],
    };
    targetDocs = { "Changed.cls": withStorage("Changed") };
    arrange();
  });

  afterEach(() => {
    if (originalGovernance === undefined) delete process.env.IRIS_GOVERNANCE;
    else process.env.IRIS_GOVERNANCE = originalGovernance;
  });

  describe("a drop, without the override: the refusal", () => {
    it("is STORAGE_DROPPED with the promote text and the source, target and storageDrops fields, before the dialog and before any write", async () => {
      const confirm = proceedingConfirm();
      ctx.confirm = confirm;

      const result = await execute(mixedDiff(), [1, 2, 3, 4]);

      expect(result).toEqual({
        content: [
          {
            type: "text",
            text:
              "Promotion to server 'target', namespace 'SADEMO' was not run and no changes were made: it drops " +
              "the Storage definition 'Default' of 'Changed.cls' that the class has now, and IRIS would generate new storage at the next compile, " +
              "which can change how existing rows are read. Promote source copies that keep those Storage definitions, " +
              "or pass allowStorageRegeneration: true to let IRIS regenerate the storage on the target.",
          },
        ],
        structuredContent: {
          code: "STORAGE_DROPPED",
          source: { profile: "source", namespace: "HSCUSTOM" },
          target: { profile: "target", namespace: "SADEMO" },
          storageDrops: [{ name: "Changed.cls", droppedStorage: ["Default"] }],
        },
        isError: true,
      });
      expect(Object.keys(result.structuredContent as object)).toEqual(["code", "source", "target", "storageDrops"]);
      expect(confirm).not.toHaveBeenCalled();
      expect(writes()).toEqual(NONE);
    });

    it("the preflight reads are the Atelier versions and each class's source and target copy, and a non-class document is not read", async () => {
      await execute(mixedDiff(), [1, 2, 3, 4]);

      expect(sourceHttp.get.mock.calls.map((call) => call[0])).toEqual(["/api/atelier/", `${SRC}Changed.cls`, `${SRC}New.cls`]);
      expect(targetHttp.get.mock.calls.map((call) => call[0])).toEqual(["/api/atelier/", `${TGT}Changed.cls`, `${TGT}New.cls`]);
    });

    it("a drop in one of several class steps refuses the whole execute: the other classes and the mapping are not written", async () => {
      sourceDocs["Changed.cls"] = withStorage("Changed");
      targetDocs["New.cls"] = withStorage("New");
      sourceDocs["New.cls"] = withoutStorage("New");

      const result = await execute(mixedDiff(), [1, 2, 3, 4]);

      expect((result.structuredContent as { storageDrops: unknown }).storageDrops).toEqual([
        { name: "New.cls", droppedStorage: ["Default"] },
      ]);
      expect(writes()).toEqual(NONE);
    });

    it("names the drops of several classes, one list entry for each", async () => {
      targetDocs["New.cls"] = withStorage("New");
      sourceDocs["New.cls"] = withoutStorage("New");

      const result = await execute(mixedDiff(), [2, 3]);

      expect(result.content[0]?.text).toContain(
        "it drops the Storage definition 'Default' of 'Changed.cls'; the Storage definition 'Default' of 'New.cls' that the classes have now,",
      );
    });

    it("a renamed definition and a case change are drops, and changed content is not", async () => {
      for (const newName of ["Alt", "default"]) {
        wire();
        sourceDocs["Changed.cls"] = withStorage("Changed").map((line) => (line === "Storage Default" ? `Storage ${newName}` : line));
        arrange();

        const renamed = await execute(mixedDiff(), [2]);

        expect(renamed.isError, newName).toBe(true);
        expect((renamed.structuredContent as { storageDrops: unknown }).storageDrops, newName).toEqual([
          { name: "Changed.cls", droppedStorage: ["Default"] },
        ]);
      }

      wire();
      sourceDocs["Changed.cls"] = withStorage("Changed").map((line) =>
        line === "<Type>%Storage.Persistent</Type>" ? "<Type>%Storage.Persistent</Type><DataLocation>^X</DataLocation>" : line,
      );
      arrange();

      const changed = await execute(mixedDiff(), [2]);

      expect(changed.isError).toBeFalsy();
    });

    it("comes after the gates and the blank-namespace check: a blank namespace refuses before any read", async () => {
      wire("HSCUSTOM", "");
      arrange();

      const result = await execute(mixedDiff(), [2]);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("the resolved namespace is blank");
      expect(sourceHttp.get.mock.calls).toEqual([]);
      expect(targetHttp.get.mock.calls).toEqual([]);
    });
  });

  describe("allowStorageRegeneration: true", () => {
    it("asks with the drops in the scope, after the preflight reads and before the first write", async () => {
      const confirm = proceedingConfirm();
      ctx.confirm = confirm;

      const result = await execute(mixedDiff(), [1, 2, 3, 4], { allowStorageRegeneration: true });

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0]?.[0]).toEqual({
        operation: "promote changes to another server",
        target: "server 'target', namespace SADEMO",
        scope:
          "4 step(s) from server 'source': #1 mappings createMapping global::NewGlobal; #2 documents putAndCompile Changed.cls; " +
          "#3 documents putAndCompile New.cls; #4 documents putAndCompile Rtn.mac; drops Storage definitions: Changed.cls ('Default')",
      });
      const asked = firstCallOrder(confirm);
      expect(firstCallOrder(sourceHttp.get)).toBeLessThan(asked);
      expect(firstCallOrder(targetHttp.get)).toBeLessThan(asked);
      expect(asked).toBeLessThan(firstCallOrder(targetHttp.put));
      expect(asked).toBeLessThan(firstCallOrder(targetHttp.post));
      expect(result.isError).toBeFalsy();
    });

    it("writes the source text the preflight checked: no second source GET of a class, and the PUT body is the first answer", async () => {
      let answers = 0;
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return envelope({ content: { api: 8 } });
        if (path.includes("/config/mapping/")) return envelope(path.includes("/global?") ? [MAPPING] : []);
        if (path === `${SRC}Changed.cls`) {
          answers += 1;
          return envelope({ name: "Changed.cls", content: answers === 1 ? withoutStorage("Changed") : withStorage("Changed") });
        }
        const name = path.slice(SRC.length);
        return envelope({ name, content: sourceDocs[name] });
      });

      await execute(mixedDiff(), [1, 2, 3, 4], { allowStorageRegeneration: true });

      expect(answers).toBe(1);
      expect(docGets(sourceHttp)).toEqual([`${SRC}Changed.cls`, `${SRC}New.cls`, `${SRC}Rtn.mac`]);
      expect(targetHttp.put.mock.calls).toEqual([
        [`${TGT}Changed.cls?ignoreConflict=1`, { enc: false, content: withoutStorage("Changed") }],
        [`${TGT}New.cls?ignoreConflict=1`, { enc: false, content: withStorage("New") }],
        [`${TGT}Rtn.mac?ignoreConflict=1`, { enc: false, content: ["ROUTINE Rtn", " quit"] }],
      ]);
    });

    it("the result adds storageDrops after summary, and the text has a line that names the drops", async () => {
      const result = await execute(mixedDiff(), [1, 2, 3, 4], { allowStorageRegeneration: true });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(Object.keys(structured)).toEqual(["source", "target", "planHash", "executed", "summary", "storageDrops"]);
      expect(structured.storageDrops).toEqual([{ name: "Changed.cls", droppedStorage: ["Default"] }]);
      expect(structured.summary).toEqual({ completed: 4, failed: 0, skipped: 0 });
      expect(result.content[0]?.text.split("\n").at(-1)).toBe(
        "Storage definitions dropped (allowStorageRegeneration; IRIS generates new storage at the next compile): Changed.cls ('Default').",
      );
    });

    it("names a class in storageDrops only when its PUT succeeded", async () => {
      targetDocs["New.cls"] = withStorage("New");
      sourceDocs["New.cls"] = withoutStorage("New");
      targetHttp.put
        .mockResolvedValueOnce(envelope({ status: "" }))
        .mockRejectedValueOnce(new Error("PUT of New.cls failed"));

      const result = await execute(mixedDiff(), [2, 3], { allowStorageRegeneration: true });

      expect(result.isError).toBe(true);
      expect((result.structuredContent as { storageDrops: unknown }).storageDrops).toEqual([
        { name: "Changed.cls", droppedStorage: ["Default"] },
      ]);
    });

    it("a decline after the preflight returns the decline unchanged: the reads were made, nothing was written", async () => {
      const confirm = decliningConfirm();
      ctx.confirm = confirm;

      const result = await execute(mixedDiff(), [1, 2, 3, 4], { allowStorageRegeneration: true });

      expect(result).toBe(DECLINED_RESULT);
      expect(docGets(sourceHttp).length).toBeGreaterThan(0);
      expect(docGets(targetHttp).length).toBeGreaterThan(0);
      expect(writes()).toEqual(NONE);
    });

    it("lists the first ten dropped documents in the dialog and says how many more, with fewer steps listed so that the drops fit the dialog", async () => {
      sourceDocs = {};
      targetDocs = {};
      for (let i = 1; i <= 12; i += 1) {
        const name = `C${String(i).padStart(2, "0")}`;
        sourceDocs[`${name}.cls`] = withoutStorage(name);
        targetDocs[`${name}.cls`] = withStorage(name);
      }
      const confirm = proceedingConfirm();
      ctx.confirm = confirm;

      const result = await execute(manyClassesDiff(12), Array.from({ length: 12 }, (_, i) => i + 1), { allowStorageRegeneration: true });

      // Ten listed steps would make the scope 653 characters, which the dialog cuts at 600: eight steps make it 580.
      const listed = Array.from({ length: 8 }, (_, i) => `#${i + 1} documents putAndCompile C${String(i + 1).padStart(2, "0")}.cls`).join("; ");
      const dropped = Array.from({ length: 10 }, (_, i) => `C${String(i + 1).padStart(2, "0")}.cls ('Default')`).join("; ");
      expect(confirm.mock.calls[0]?.[0]?.scope).toBe(
        `12 step(s) from server 'source': ${listed}; and 4 more; drops Storage definitions: ${dropped}; and 2 more`,
      );
      expect((result.structuredContent as { storageDrops: unknown[] }).storageDrops).toHaveLength(12);
    });

    describe("long class names", () => {
      const names = Array.from({ length: 10 }, (_, i) => `Billing.Ledger.Entry.Adjustment${String(i + 1).padStart(2, "0")}`);
      const droppingIndexes = [1, 4, 7];

      function namedClassesDiff(): Record<string, unknown> {
        return {
          source: { profile: "source", namespace: "HSCUSTOM" },
          target: { profile: "target", namespace: "SADEMO" },
          domains: { documents: { onlyInSource: names.map((name) => `${name}.cls`), onlyInTarget: [], differs: [], identical: 0 } },
          summary: { driftCount: 10, identicalCount: 0 },
        };
      }

      function arrangeNamedClasses(): void {
        sourceDocs = {};
        targetDocs = {};
        names.forEach((name, i) => {
          sourceDocs[`${name}.cls`] = droppingIndexes.includes(i + 1) ? withoutStorage(name) : withStorage(name);
          targetDocs[`${name}.cls`] = withStorage(name);
        });
      }

      it("the drops survive the dialog's cut: fewer steps are listed, and the scope fits 600 characters", async () => {
        arrangeNamedClasses();
        const confirm = proceedingConfirm();
        ctx.confirm = confirm;

        await execute(namedClassesDiff(), names.map((_, i) => i + 1), { allowStorageRegeneration: true });

        const scope = String(confirm.mock.calls[0]?.[0]?.scope);
        const dropped = droppingIndexes.map((i) => `${names[i - 1]}.cls ('Default')`).join("; ");
        const shown = (scope.match(/#\d+ documents putAndCompile/g) ?? []).length;
        expect(scope.length).toBeLessThanOrEqual(CONFIRMATION_TEXT_LIMIT);
        expect(shown).toBeGreaterThanOrEqual(1);
        expect(shown).toBeLessThan(10);
        expect(scope.startsWith(`10 step(s) from server 'source': #1 documents putAndCompile ${names[0]}.cls`)).toBe(true);
        expect(scope.endsWith(`; and ${10 - shown} more; drops Storage definitions: ${dropped}`)).toBe(true);
      });

      it("when the drops alone are longer than the dialog shows, one step is listed and fewer dropped documents, with how many more", async () => {
        arrangeNamedClasses();
        names.forEach((name) => {
          sourceDocs[`${name}.cls`] = withoutStorage(name);
        });
        const confirm = proceedingConfirm();
        ctx.confirm = confirm;

        await execute(namedClassesDiff(), names.map((_, i) => i + 1), { allowStorageRegeneration: true });

        // One step and ten drops make 646 characters, nine drops 607: eight drops make the scope 556.
        const dropped = names.slice(0, 8).map((name) => `${name}.cls ('Default')`).join("; ");
        const scope = String(confirm.mock.calls[0]?.[0]?.scope);
        expect(scope).toBe(
          `10 step(s) from server 'source': #1 documents putAndCompile ${names[0]}.cls; and 9 more; ` +
            `drops Storage definitions: ${dropped}; and 2 more`,
        );
        expect(scope.length).toBeLessThanOrEqual(CONFIRMATION_TEXT_LIMIT);
      });

      it("without a drop the scope lists ten steps whatever its length, as before", async () => {
        arrangeNamedClasses();
        names.forEach((name) => {
          sourceDocs[`${name}.cls`] = withStorage(name);
        });
        const confirm = proceedingConfirm();
        ctx.confirm = confirm;

        await execute(namedClassesDiff(), names.map((_, i) => i + 1), { allowStorageRegeneration: true });

        const listed = names.map((name, i) => `#${i + 1} documents putAndCompile ${name}.cls`).join("; ");
        expect(confirm.mock.calls[0]?.[0]?.scope).toBe(`10 step(s) from server 'source': ${listed}`);
        expect(listed.length).toBeGreaterThan(600);
      });
    });

    it("reads and writes each side with the Atelier version that side negotiated: source v8, target v7", async () => {
      const TGT7 = "/api/atelier/v7/SADEMO/doc/";
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return envelope({ content: { api: 7 } });
        if (path === `${TGT7}Changed.cls`) return envelope(currentClass(withStorage("Changed")));
        throw notFound(path);
      });

      const refused = await execute(mixedDiff(), [2]);

      expect((refused.structuredContent as { code: string }).code).toBe("STORAGE_DROPPED");
      expect(docGets(sourceHttp)).toEqual([`${SRC}Changed.cls`]);
      expect(docGets(targetHttp)).toEqual([`${TGT7}Changed.cls`]);
      expect(writes()).toEqual(NONE);

      const allowed = await execute(mixedDiff(), [2], { allowStorageRegeneration: true });

      expect(allowed.isError).toBeFalsy();
      expect(targetHttp.put.mock.calls.map((call) => call[0])).toEqual([`${TGT7}Changed.cls?ignoreConflict=1`]);
      expect(targetHttp.post.mock.calls.map((call) => call[0]).every((path) => String(path).includes("/api/atelier/v7/SADEMO/"))).toBe(true);
    });
  });

  describe("nothing dropped: the scope, the result and the text are those of today", () => {
    it("a new class, a kept name and a non-class document: no refusal, the plain scope, and no storageDrops", async () => {
      sourceDocs["Changed.cls"] = withStorage("Changed");
      const confirm = proceedingConfirm();
      ctx.confirm = confirm;

      const result = await execute(mixedDiff(), [1, 2, 3, 4]);

      expect(confirm.mock.calls[0]?.[0]?.scope).toBe(
        "4 step(s) from server 'source': #1 mappings createMapping global::NewGlobal; #2 documents putAndCompile Changed.cls; " +
          "#3 documents putAndCompile New.cls; #4 documents putAndCompile Rtn.mac",
      );
      expect(result.isError).toBeFalsy();
      expect(Object.keys(result.structuredContent as object)).toEqual(["source", "target", "planHash", "executed", "summary"]);
      expect(result.content[0]?.text).not.toContain("Storage definitions dropped");
    });

    it("the override with nothing to drop changes neither the scope nor the result", async () => {
      sourceDocs["Changed.cls"] = withStorage("Changed");
      const confirm = proceedingConfirm();
      ctx.confirm = confirm;

      const result = await execute(mixedDiff(), [1, 2, 3, 4], { allowStorageRegeneration: true });

      expect(confirm.mock.calls[0]?.[0]?.scope).not.toContain("drops Storage definitions");
      expect(Object.keys(result.structuredContent as object)).toEqual(["source", "target", "planHash", "executed", "summary"]);
    });

    it("a plan of non-class documents only makes no preflight read: each is read once, in the batch", async () => {
      const result = await execute(mixedDiff(), [4]);

      expect(result.isError).toBeFalsy();
      expect(docGets(sourceHttp)).toEqual([`${SRC}Rtn.mac`]);
      expect(docGets(targetHttp)).toEqual([]);
      expect(targetHttp.put.mock.calls).toHaveLength(1);
    });

    it("a plan with no document step reads no document", async () => {
      await execute(mixedDiff(), [1]);

      expect(docGets(sourceHttp)).toEqual([]);
      expect(docGets(targetHttp)).toEqual([]);
      expect(targetHttp.get.mock.calls).toEqual([]);
    });
  });

  describe("a preflight read that fails is carried to its step", () => {
    it("a source copy with no content fails that step with today's text, after the earlier step completed and before later ones", async () => {
      sourceDocs["Changed.cls"] = null;

      const result = await execute(mixedDiff(), [1, 2, 3, 4]);

      expect(result.isError).toBe(true);
      const executed = (result.structuredContent as { executed: Array<{ subject: string; status: string; error?: string }> }).executed;
      expect(executed.map((step) => [step.subject, step.status])).toEqual([
        ["global::NewGlobal", "completed"],
        ["Changed.cls", "failed"],
        ["New.cls", "skipped"],
        ["Rtn.mac", "skipped"],
      ]);
      expect(executed[1]?.error).toBe(
        "Source returned no document content for 'Changed.cls' -- refusing to overwrite the target document with empty content.",
      );
      expect(targetHttp.put.mock.calls).toEqual([]);
    });

    it("a target read that fails (not a 404) fails that step with the target-read text, and nothing is written for it", async () => {
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return envelope({ content: { api: 8 } });
        throw new IrisApiError(500, [], path, `IRIS returned HTTP 500 for GET ${path}. Check the request parameters and try again.`);
      });

      const result = await execute(mixedDiff(), [1, 2, 3, 4]);

      expect(result.isError).toBe(true);
      const executed = (result.structuredContent as { executed: Array<{ subject: string; status: string; error?: string }> }).executed;
      expect(executed.map((step) => step.status)).toEqual(["completed", "failed", "skipped", "skipped"]);
      expect(executed[1]?.error).toBe(
        "Could not read the target's copy of 'Changed.cls' to check its Storage definitions: " +
          `IRIS returned HTTP 500 for GET ${TGT}Changed.cls. Check the request parameters and try again. ` +
          "Nothing was written for this document.",
      );
      expect(targetHttp.put.mock.calls).toEqual([]);
    });

    it("an unreadable or binary target copy is a carried failure too", async () => {
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return envelope({ content: { api: 8 } });
        return envelope({ ...currentClass(withStorage("Changed")), enc: true });
      });

      const result = await execute(mixedDiff(), [2]);

      const executed = (result.structuredContent as { executed: Array<{ status: string; error?: string }> }).executed;
      expect(executed[0]?.status).toBe("failed");
      expect(executed[0]?.error).toBe(
        "Could not read the target's copy of 'Changed.cls' to check its Storage definitions: Document 'Changed.cls' could not " +
          "be read in namespace 'SADEMO': it is a binary document. Check the document name and namespace, then retry. " +
          "Nothing was written for this document.",
      );
      expect(targetHttp.put.mock.calls).toEqual([]);
    });
  });

  describe("the schema and the description", () => {
    it("allowStorageRegeneration follows namespace and carries the Design Notes text", () => {
      const shape = envPromoteTool.inputSchema.shape as Record<string, { description?: string }>;
      const keys = Object.keys(shape);

      expect(keys.indexOf("allowStorageRegeneration")).toBe(keys.indexOf("namespace") + 1);
      expect(shape.allowStorageRegeneration?.description).toBe(
        "For action 'execute' only. Boolean (true/false), default false. When false, 'execute' is refused before any write (STORAGE_DROPPED) " +
          "if the source copy of a promoted class lacks one of the Storage definitions the target class has now; changing a definition's content " +
          "is allowed. When true, the classes are promoted, IRIS generates new storage on the target at the next compile (which can change how " +
          "existing rows are read), and the confirmation dialog and the result's storageDrops name the dropped definitions.",
      );
    });

    it("the description ends with the STORAGE GUARD paragraph, after the human confirmation paragraph which stays whole", () => {
      const guard =
        "STORAGE GUARD -- before the confirmation dialog and before any write, 'execute' reads the source and target copy of each class it would " +
        "promote; if a source copy lacks one of the Storage definitions the target class has now, the whole execute is refused with " +
        "STORAGE_DROPPED and nothing changes, because IRIS would generate new storage on the target at the next compile, which can change how " +
        "existing rows are read. allowStorageRegeneration (default false) lets it through; the dialog and the result then name the dropped definitions.";
      const confirmation =
        "HUMAN CONFIRMATION -- when the MCP client supports form elicitation, 'execute' also asks the person in a confirmation dialog, after all four " +
        "gates pass and right before the first write to 'target'; only an accept with Confirm ticked proceeds, and a decline or a dismissal returns " +
        "CONFIRMATION_DECLINED with nothing changed (do not repeat the call unless the person asks). A client without elicitation is not asked, " +
        "and the call works as described above.";

      expect(envPromoteTool.description.endsWith(`${confirmation}\n\n${guard}`)).toBe(true);
      expect(envPromoteTool.description.toLowerCase().split("human confirmation")).toHaveLength(2);
    });

    it("the parameter is optional with no default, so the confirmation hash of the arguments does not move", () => {
      const parsed = envPromoteTool.inputSchema.safeParse({ action: "plan", source: "a", target: "b" }).data;

      expect(parsed).toEqual({ action: "plan", source: "a", target: "b" });
    });
  });
});
