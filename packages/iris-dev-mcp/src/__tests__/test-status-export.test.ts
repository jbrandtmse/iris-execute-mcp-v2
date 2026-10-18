/**
 * Story 40.2 -- `iris_test_status` action "export" (matrix rows 8, 9, 11 and 12; AC-4, AC-5, AC-6), with a mocked `http` and a
 * temporary directory. The run record is the live Status record of the Story 40.2 oracle run (`story402-run.ts`).
 *
 * The governance default (row 8, `GOVERNANCE_DISABLED` and no file) is proved through the real gate in
 * `test-status-governance.test.ts`; the live gate drives the same rows over the real wire.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { IrisApiError, type IrisHttpClient } from "@iris-mcp/shared";
import { testStatusTool } from "../tools/test-status.js";
import type { CoverageRun } from "../tools/test-coverage.js";
import { createMockCtx, createMockHttp, envelope } from "./test-helpers.js";
import { STORY402_RUN } from "./story402-run.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dtd = (await import(/* @vite-ignore */ pathToFileURL(path.resolve(here, "../../../../scripts/lib/cobertura-dtd.mjs")).href)) as {
  validateCobertura(text: string): string[];
};
const GOLDEN = readFileSync(path.join(here, "fixtures", "cobertura", "story402-oracle.xml"), "utf8");

const roots: string[] = [];
function scratch(): string {
  const root = mkdtempSync(path.join(tmpdir(), "status-export-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A context whose Status route returns `records` in turn, and whose test-result queries return one passed test. */
function exportCtx(records: unknown[]) {
  const http = createMockHttp();
  let index = 0;
  http.get.mockImplementation(async (route: string) => {
    expect(route).toMatch(/\/dev\/test\/coverage\?id=645$/);
    return envelope(records[Math.min(index++, records.length - 1)]);
  });
  http.post.mockImplementation(async (_route: string, body?: unknown) => {
    const query = String((body as { query?: string })?.query ?? "");
    if (query.includes("TestAssert")) return envelope({ content: [] });
    return envelope({
      content: [
        { ClassName: "Story402.FixtureTest", MethodName: "TestEveryMethod", Status: 1, Duration: 0.5, ErrorAction: "", ErrorDescription: "" },
      ],
    });
  });
  return { http, ctx: createMockCtx(http as unknown as IrisHttpClient, 8) };
}

function exportArgs(outputPath: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { action: "export", coverageRunId: "645", outputPath, ...extra };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((block) => block.text ?? "").join("\n");
}

describe("iris_test_status export: the file (matrix rows 9 and 10, AC-4)", () => {
  it("writes the golden document, creating the missing parent directories, and returns the poll result plus cobertura", async () => {
    const root = scratch();
    const target = path.join(root, "x", "y", "coverage.xml");
    const { ctx } = exportCtx([STORY402_RUN]);
    const result = await testStatusTool.handler(exportArgs(target), ctx);

    expect(result.isError).toBeUndefined();
    expect(readFileSync(target, "utf8").replace(/iris-mcp-dev [0-9.]+/, "iris-mcp-dev 0.0.2"), "the golden, but for the package version").toBe(GOLDEN);
    expect(dtd.validateCobertura(readFileSync(target, "utf8"))).toEqual([]);
    expect(result.structuredContent).toMatchObject({
      status: "completed",
      coverageRunId: 645,
      total: 1,
      passed: 1,
      cobertura: { outputPath: path.resolve(target), bytes: readFileSync(target).length, classes: 2, lines: 27 },
    });
    const text = textOf(result as never);
    expect(text).toContain("Coverage run 645 completed");
    expect(text.split("\n").pop()).toBe(`Cobertura XML written to ${path.resolve(target)} (${readFileSync(target).length} bytes).`);
    // The write is the only side effect on IRIS: two reads of the run and the test-result queries, nothing else.
    expect(readdirSync(path.dirname(target))).toEqual(["coverage.xml"]);
  });

  it("the document is what the build produces for the run: the package version, and the poll result's own coverage", async () => {
    const root = scratch();
    const target = path.join(root, "coverage.xml");
    const { ctx } = exportCtx([STORY402_RUN]);
    const result = await testStatusTool.handler(exportArgs(target), ctx);
    const written = readFileSync(target, "utf8");
    const version = (JSON.parse(readFileSync(path.resolve(here, "../../package.json"), "utf8")) as { version: string }).version;
    expect(written).toContain(`version="iris-mcp-dev ${version}"`);
    const polled = await testStatusTool.handler({ action: "poll", coverageRunId: "645" }, ctx);
    const exported = { ...(result.structuredContent as Record<string, unknown>) };
    expect(exported.cobertura).toBeDefined();
    delete exported.cobertura;
    expect(exported, "export = poll + cobertura").toEqual(polled.structuredContent);
  });

  it("a second export is byte-identical and overwrites; a source root adds the one <sources> element only", async () => {
    const root = scratch();
    const first = path.join(root, "a.xml");
    const second = path.join(root, "b.xml");
    const { ctx } = exportCtx([STORY402_RUN]);
    await testStatusTool.handler(exportArgs(first), ctx);
    writeFileSync(second, "stale");
    await testStatusTool.handler(exportArgs(second), ctx);
    expect(readFileSync(second, "utf8")).toBe(readFileSync(first, "utf8"));

    const rooted = path.join(root, "rooted", "c.xml");
    await testStatusTool.handler(exportArgs(rooted, { sourceRoot: "src" }), ctx);
    expect(readFileSync(rooted, "utf8")).toBe(
      readFileSync(first, "utf8").replace(/(timestamp="\d+">\n)/, "$1  <sources>\n    <source>src</source>\n  </sources>\n"),
    );
    expect(dtd.validateCobertura(readFileSync(rooted, "utf8"))).toEqual([]);

    await testStatusTool.handler(exportArgs(first), ctx);
    expect(readFileSync(first, "utf8"), "a third export to the first path overwrites it with identical bytes").toBe(readFileSync(second, "utf8"));
  });

  it("checks the run's namespace as poll does", async () => {
    const root = scratch();
    const { ctx } = exportCtx([STORY402_RUN]);
    const result = await testStatusTool.handler(exportArgs(path.join(root, "c.xml"), { namespace: "HSCUSTOM" }), ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result as never)).toContain("EXECMCPTMP402A");
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("iris_test_status export: a run that cannot be exported writes nothing (matrix row 11, AC-6)", () => {
  async function refused(record: unknown, expected: RegExp): Promise<string> {
    const root = scratch();
    const target = path.join(root, "coverage.xml");
    const { http, ctx } = exportCtx([record]);
    const result = await testStatusTool.handler(exportArgs(target), ctx);
    expect(result.isError, textOf(result as never)).toBe(true);
    expect(textOf(result as never)).toMatch(expected);
    expect(textOf(result as never)).toContain("Nothing was written");
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
    // The run is unaffected: only the run record was read, and nothing was cancelled or started.
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.post.mock.calls.filter(([route]) => String(route).includes("/dev/test/coverage"))).toEqual([]);
    return textOf(result as never);
  }

  it("a running run: the error names the status and says to wait for it", async () => {
    const text = await refused({ ...STORY402_RUN, status: "running", finishedAt: null, routines: undefined, sources: undefined }, /status is running/);
    expect(text).toContain("Wait for it");
    expect(await refused({ ...STORY402_RUN, status: "starting", finishedAt: null, routines: undefined, sources: undefined }, /status is starting/)).toContain("Wait for it");
  });

  it("a cancelled run, a failed run and an abandoned run: the error names the status and says to run the tests again, never to wait", async () => {
    const cancelled = await refused({ ...STORY402_RUN, status: "cancelled", reason: "cancel" }, /status is cancelled/);
    const failed = await refused({ ...STORY402_RUN, status: "failed", error: "The test process ended before the tests finished." }, /status is failed/);
    const abandoned = await refused({ ...STORY402_RUN, status: "abandoned" }, /status is abandoned/);
    for (const text of [cancelled, failed, abandoned]) {
      expect(text).not.toContain("Wait for it");
      expect(text).toContain("Run the tests again.");
      expect(text).toContain("cannot be exported");
    }
  });

  it("a completed run in which no class has a class-source result is refused: an empty document would read as 100% covered", async () => {
    const empty = await refused({ ...STORY402_RUN, sources: [] }, /no class has a class-source result/);
    expect(empty).toContain("Recompile the classes and run the tests again.");
    const unmappable = await refused(
      {
        ...STORY402_RUN,
        sources: [
          { class: "Story402.Fixture", reason: "not-up-to-date", methods: [] },
          { class: "Story402.Layout", reason: "unavailable", methods: [] },
        ],
      },
      /no class has a class-source result/,
    );
    expect(unmappable).toContain("Recompile the classes and run the tests again.");
  });

  it("a completed run that recorded no test run says no test method ran", async () => {
    await refused({ ...STORY402_RUN, runIndex: null }, /no test method ran/);
  });

  it("a completed run with no counts, or with no class-source data (an older IRIS-side class), is refused", async () => {
    await refused({ ...STORY402_RUN, routines: undefined, sources: undefined }, /coverage is not complete/);
    const legacy: CoverageRun = { ...STORY402_RUN };
    delete legacy.sources;
    await refused(legacy, /no class-source data/);
  });

  it("an unknown run is the not-found error and writes nothing", async () => {
    const root = scratch();
    const { http, ctx } = exportCtx([STORY402_RUN]);
    http.get.mockRejectedValueOnce(
      new IrisApiError(
        400,
        [{ error: "ERROR #5001: Coverage run 645 was not found. Only the 20 most recent runs are kept, and runs do not survive an instance restart." }],
        "/api/executemcp/v2/dev/test/coverage?id=645",
        "IRIS reported errors for GET.",
      ),
    );
    const result = await testStatusTool.handler(exportArgs(path.join(root, "coverage.xml")), ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result as never)).toContain("was not found");
    expect(readdirSync(root)).toEqual([]);
  });

  it("a path the file system cannot write (a directory below a regular file) is an error that says so, names the run, and leaves the file alone", async () => {
    const root = scratch();
    const blocker = path.join(root, "afile");
    writeFileSync(blocker, "keep");
    const target = path.join(blocker, "sub", "coverage.xml");
    const { ctx } = exportCtx([STORY402_RUN]);
    const result = await testStatusTool.handler(exportArgs(target), ctx);
    expect(result.isError, textOf(result as never)).toBe(true);
    const text = textOf(result as never);
    expect(text).toContain("The Cobertura file for coverage run 645 could not be written");
    expect(text).toContain("Nothing was written.");
    expect(result.structuredContent).toMatchObject({ coverageRunId: 645 });
    expect(result.structuredContent, "an error, not the poll result with a cobertura field").not.toHaveProperty("cobertura");
    expect(readdirSync(root)).toEqual(["afile"]);
    expect(readFileSync(blocker, "utf8")).toBe("keep");
  });
});

describe("iris_test_status export: bad arguments are errors and nothing is sent to IRIS (matrix row 12, AC-6)", () => {
  async function invalid(args: Record<string, unknown>, expected: RegExp): Promise<void> {
    const root = scratch();
    const { http, ctx } = exportCtx([STORY402_RUN]);
    const result = await testStatusTool.handler(args, ctx);
    expect(result.isError, textOf(result as never)).toBe(true);
    expect(textOf(result as never)).toMatch(expected);
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
    expect(readdirSync(root)).toEqual([]);
  }

  it("a relative outputPath, one with a .. segment, and one that does not end in .xml name outputPath", async () => {
    const root = scratch();
    await invalid(exportArgs("out/coverage.xml"), /outputPath 'out\/coverage.xml' must be an absolute path/);
    await invalid(exportArgs(`${root}/../coverage.xml`), /outputPath .* must not contain '\.\.'/);
    await invalid(exportArgs(path.join(root, "coverage.txt")), /outputPath .* must end in \.xml/);
    await invalid(exportArgs(""), /outputPath must be a non-empty string/);
    expect(readdirSync(root)).toEqual([]);
  });

  it("a missing outputPath, a missing coverageRunId, and jobId or runIndex together with the handle are errors", async () => {
    const root = scratch();
    await invalid({ action: "export", coverageRunId: "645" }, /needs outputPath/);
    await invalid({ action: "export", outputPath: path.join(root, "c.xml") }, /needs coverageRunId/);
    await invalid(exportArgs(path.join(root, "c.xml"), { jobId: "31797604" }), /cannot be combined with jobId or runIndex/);
    await invalid(exportArgs(path.join(root, "c.xml"), { runIndex: 3 }), /cannot be combined with jobId or runIndex/);
    await invalid(exportArgs(path.join(root, "c.xml"), { coverageRunId: "9;1" }), /not a coverage handle/);
    expect(readdirSync(root)).toEqual([]);
  });

  it("an empty sourceRoot, and one with a control character, are errors", async () => {
    const root = scratch();
    await invalid(exportArgs(path.join(root, "c.xml"), { sourceRoot: "" }), /sourceRoot must not be empty/);
    await invalid(exportArgs(path.join(root, "c.xml"), { sourceRoot: "a\nb" }), /sourceRoot must not contain control characters/);
  });

  it("outputPath or sourceRoot with poll or cancel is an error, whichever handle is passed", async () => {
    const root = scratch();
    await invalid({ action: "poll", coverageRunId: "645", outputPath: path.join(root, "c.xml") }, /only for action "export", not "poll"/);
    await invalid({ action: "cancel", coverageRunId: "645", sourceRoot: "src" }, /only for action "export", not "cancel"/);
    await invalid({ action: "poll", runIndex: 3, outputPath: path.join(root, "c.xml") }, /only for action "export"/);
    await invalid({ action: "cancel", jobId: "31797604", sourceRoot: "src" }, /only for action "export"/);
  });
});

describe("iris_test_status export: the registration", () => {
  it("is a write key of its own with the other two keys unchanged, and the schema takes the three actions and the two new arguments", () => {
    expect(testStatusTool.mutates).toEqual({ poll: "read", cancel: "write", export: "write" });
    expect(testStatusTool.defaultEnabled).toBeUndefined();
    const schema = testStatusTool.inputSchema;
    expect(schema.safeParse({ action: "export", coverageRunId: "9", outputPath: "/a/b.xml", sourceRoot: "src" }).success).toBe(true);
    expect(schema.safeParse({ action: "report" }).success).toBe(false);
    expect(testStatusTool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
  });

  it("describes the export, its default state, its recipe, overwrite and completed runs only, without naming a route", () => {
    const description = testStatusTool.description;
    expect(description).toContain('action:"export" (write, DEFAULT-DISABLED by governance');
    expect(description).toContain('{"global":{"iris_test_status:export":true}}');
    expect(description).toContain("an existing file is overwritten");
    expect(description).toContain("Only a completed run with complete coverage can be exported");
    expect(description).not.toMatch(/\/api\/|\/dev\/|executemcp/i);
  });
});
