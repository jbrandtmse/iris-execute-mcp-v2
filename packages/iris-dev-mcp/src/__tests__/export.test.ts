import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { ToolContext } from "@iris-mcp/shared";
import { docExportTool } from "../tools/export.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── Local helpers ───────────────────────────────────────────────────

/** Shape matching iris_doc_export's structuredContent. */
interface ExportResult {
  destinationDir: string;
  namespace: string;
  filtersApplied: Record<string, unknown>;
  total: number;
  exported: number;
  skipped: number;
  skippedItems: Array<{ docName: string; reason: string; hint?: string }>;
  manifest?: string;
  durationMs: number;
  partial?: boolean;
  aborted?: boolean;
}

interface Manifest {
  namespace: string;
  exportedAt: string;
  filtersApplied: Record<string, unknown>;
  files: Array<{ docName: string; localPath: string; bytes: number; modifiedOnServer?: string }>;
  skipped: Array<{ docName: string; reason: string; hint?: string }>;
  shortPathMap: Record<string, string> | null;
  aborted?: boolean;
  partial?: boolean;
}

/** Build an Atelier-style doc record. */
function doc(name: string, ts?: string) {
  return ts !== undefined ? { name, ts } : { name };
}

/** Fake GET /doc/{name} response for a given content string. */
function docContentEnvelope(name: string, lines: string[]) {
  return envelope({ name, content: lines });
}

/** Create a unique tmp directory for a single test. */
async function makeTmpDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `iris-export-test-${crypto.randomBytes(8).toString("hex")}`);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/** Best-effort rm -rf of a test tmp dir. */
async function rmTmpDir(dir: string): Promise<void> {
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}

/**
 * Install a mockHttp.get implementation that serves a list of docs for
 * /docnames or /modified, and per-doc content for /doc/{name}.
 */
function installMockHttp(
  mockHttp: ReturnType<typeof createMockHttp>,
  docs: Array<{ name: string; lines?: string[]; ts?: string; fail?: string }>,
) {
  mockHttp.get.mockImplementation((async (url: string) => {
    if (url.includes("/docnames/") || url.includes("/modified/")) {
      return envelope({ content: docs.map((d) => doc(d.name, d.ts)) });
    }
    // /doc/{name}
    const decodedPath = decodeURIComponent(url.split("?")[0] ?? url);
    const marker = "/doc/";
    const idx = decodedPath.indexOf(marker);
    const name = decodedPath.slice(idx + marker.length);
    const match = docs.find((d) => d.name === name);
    if (!match) {
      throw new Error(`Mock: no doc registered for ${name}`);
    }
    if (match.fail) {
      throw new Error(match.fail);
    }
    return docContentEnvelope(name, match.lines ?? [`// ${name}`, "Quit"]);
  }) as never);
}

// ── Tests ──────────────────────────────────────────────────────────

describe("iris_doc_export", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;
  let tmp: string;

  beforeEach(async () => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
    tmp = await makeTmpDir();
  });

  afterEach(async () => {
    await rmTmpDir(tmp);
  });

  // ── 1. Happy path with dotted-dir mapping ────────────────────────

  it("writes a small batch mapping dotted names to subdirectories", async () => {
    installMockHttp(mockHttp, [
      { name: "EnsLib.HTTP.GenericService.cls", lines: ["Class EnsLib.HTTP.GenericService {", "}"] },
      { name: "EnsLib.JMS.Service.cls", lines: ["Class EnsLib.JMS.Service {", "}"] },
      { name: "MyApp.Utils.cls", lines: ["Class MyApp.Utils {", "}"] },
    ]);

    const result = await docExportTool.handler(
      { destinationDir: tmp },
      ctx,
    );

    const sc = result.structuredContent as ExportResult;
    expect(sc.total).toBe(3);
    expect(sc.exported).toBe(3);
    expect(sc.skipped).toBe(0);
    expect(sc.manifest).toBe(path.join(tmp, "manifest.json"));

    // Files exist on disk at correct paths
    const p1 = path.join(tmp, "EnsLib", "HTTP", "GenericService.cls");
    const p2 = path.join(tmp, "EnsLib", "JMS", "Service.cls");
    const p3 = path.join(tmp, "MyApp", "Utils.cls");
    await expect(fsp.stat(p1)).resolves.toBeTruthy();
    await expect(fsp.stat(p2)).resolves.toBeTruthy();
    await expect(fsp.stat(p3)).resolves.toBeTruthy();

    const content = await fsp.readFile(p1, "utf-8");
    expect(content).toBe("Class EnsLib.HTTP.GenericService {\n}");
  });

  // ── 2. Enumeration via /docnames ─────────────────────────────────

  it("enumerates via /docnames/*/* and fetches every doc", async () => {
    const docs = [
      { name: "Pkg.A.cls" },
      { name: "Pkg.B.cls" },
      { name: "Pkg.C.cls" },
    ];
    installMockHttp(mockHttp, docs);

    await docExportTool.handler({ destinationDir: tmp }, ctx);

    // First call is /docnames
    const enumPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(enumPath).toContain("/docnames/*/*");
    expect(enumPath).toContain("generated=0");

    // 3 more calls for individual docs
    const fetchCalls = mockHttp.get.mock.calls.slice(1);
    expect(fetchCalls).toHaveLength(3);
    for (const [url] of fetchCalls) {
      expect(String(url)).toContain("/doc/");
    }
  });

  // ── 3. ignoreErrors: true keeps the batch going ──────────────────

  it("continues on per-file failure when ignoreErrors is true (default)", async () => {
    installMockHttp(mockHttp, [
      { name: "MyApp.Good.cls" },
      { name: "MyApp.Bad.cls", fail: "500 Internal Server Error" },
      { name: "MyApp.AlsoGood.cls" },
    ]);

    const result = await docExportTool.handler({ destinationDir: tmp }, ctx);
    const sc = result.structuredContent as ExportResult;

    expect(sc.total).toBe(3);
    expect(sc.exported).toBe(2);
    expect(sc.skipped).toBe(1);
    expect(sc.skippedItems[0]?.docName).toBe("MyApp.Bad.cls");
    expect(sc.skippedItems[0]?.reason).toContain("fetch failed");
    expect(result.isError).toBeUndefined();
  });

  // ── 4. ignoreErrors: false aborts on first error ─────────────────

  it("returns isError:true, partial:true when ignoreErrors is false", async () => {
    installMockHttp(mockHttp, [
      { name: "MyApp.Bad.cls", fail: "500 Internal Server Error" },
      { name: "MyApp.Good.cls" },
    ]);

    const result = await docExportTool.handler(
      { destinationDir: tmp, ignoreErrors: false },
      ctx,
    );
    const sc = result.structuredContent as ExportResult;

    expect(result.isError).toBe(true);
    expect(sc.partial).toBe(true);
    expect(result.content[0]?.text).toContain("Export failed");

    // Manifest should be written and self-describe the incomplete run
    // via `partial: true` — a caller reading only manifest.json should
    // be able to tell the export didn't complete cleanly.
    const manifestPath = path.join(tmp, "manifest.json");
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf-8")) as Manifest;
    expect(manifest.partial).toBe(true);
    expect(manifest.aborted).toBeUndefined();
  });

  // ── 5. overwrite: ifDifferent skips unchanged files ──────────────

  it("overwrite:ifDifferent does not rewrite a byte-identical existing file", async () => {
    const expectedContent = "Class MyApp.Utils {\n}";
    // Pre-create the file with the same content
    const existingPath = path.join(tmp, "MyApp", "Utils.cls");
    await fsp.mkdir(path.dirname(existingPath), { recursive: true });
    await fsp.writeFile(existingPath, expectedContent, "utf-8");
    const originalMtime = (await fsp.stat(existingPath)).mtimeMs;

    installMockHttp(mockHttp, [
      { name: "MyApp.Utils.cls", lines: ["Class MyApp.Utils {", "}"] },
    ]);

    await new Promise((r) => setTimeout(r, 10)); // ensure clock tick for mtime detection
    const result = await docExportTool.handler({ destinationDir: tmp }, ctx);
    const sc = result.structuredContent as ExportResult;

    expect(sc.exported).toBe(1);
    const newMtime = (await fsp.stat(existingPath)).mtimeMs;
    // ifDifferent: byte-identical → not rewritten → mtime unchanged
    expect(newMtime).toBe(originalMtime);
  });

  // ── 6. overwrite: never ──────────────────────────────────────────

  it("overwrite:never refuses to overwrite existing files and records skip", async () => {
    const existingPath = path.join(tmp, "MyApp", "Utils.cls");
    await fsp.mkdir(path.dirname(existingPath), { recursive: true });
    await fsp.writeFile(existingPath, "OLD CONTENT", "utf-8");

    installMockHttp(mockHttp, [
      { name: "MyApp.Utils.cls", lines: ["NEW", "CONTENT"] },
    ]);

    const result = await docExportTool.handler(
      { destinationDir: tmp, overwrite: "never" },
      ctx,
    );
    const sc = result.structuredContent as ExportResult;

    expect(sc.exported).toBe(0);
    expect(sc.skipped).toBe(1);
    expect(sc.skippedItems[0]?.reason).toBe("exists");
    // File contents unchanged
    const content = await fsp.readFile(existingPath, "utf-8");
    expect(content).toBe("OLD CONTENT");
  });

  // ── 7. overwrite: always ─────────────────────────────────────────

  it("overwrite:always rewrites existing files", async () => {
    const existingPath = path.join(tmp, "MyApp", "Utils.cls");
    await fsp.mkdir(path.dirname(existingPath), { recursive: true });
    await fsp.writeFile(existingPath, "OLD", "utf-8");

    installMockHttp(mockHttp, [
      { name: "MyApp.Utils.cls", lines: ["NEW"] },
    ]);

    await docExportTool.handler(
      { destinationDir: tmp, overwrite: "always" },
      ctx,
    );

    const content = await fsp.readFile(existingPath, "utf-8");
    expect(content).toBe("NEW");
  });

  // ── 8. useShortPaths truncates segments on Windows ───────────────

  it("useShortPaths: true on Windows shortens directory segments to 8 chars", async () => {
    if (process.platform !== "win32") return;
    installMockHttp(mockHttp, [
      {
        name: "ReallyLongPackageNameHere.AnotherLongOne.Foo.cls",
        lines: ["Class Foo {", "}"],
      },
    ]);

    const result = await docExportTool.handler(
      { destinationDir: tmp, useShortPaths: true },
      ctx,
    );
    const sc = result.structuredContent as ExportResult;

    expect(sc.exported).toBe(1);
    // File should be at the shortened path
    const shortPath = path.join(tmp, "ReallyLo", "AnotherL", "Foo.cls");
    await expect(fsp.stat(shortPath)).resolves.toBeTruthy();

    // Manifest records the short-path mapping
    const manifest = JSON.parse(await fsp.readFile(path.join(tmp, "manifest.json"), "utf-8")) as Manifest;
    expect(manifest.shortPathMap).not.toBeNull();
    const keys = Object.keys(manifest.shortPathMap ?? {});
    expect(keys.some((k) => k.includes("ReallyLongPackageNameHere"))).toBe(true);
  });

  // ── 9. useShortPaths ignored on non-Windows ──────────────────────

  it("useShortPaths: true on non-Windows is ignored (no truncation, null shortPathMap)", async () => {
    if (process.platform === "win32") return;
    installMockHttp(mockHttp, [
      {
        name: "ReallyLongPackageNameHere.AnotherLongOne.Foo.cls",
        lines: ["Class Foo {", "}"],
      },
    ]);

    await docExportTool.handler(
      { destinationDir: tmp, useShortPaths: true },
      ctx,
    );

    // File at the full path
    const fullPath = path.join(tmp, "ReallyLongPackageNameHere", "AnotherLongOne", "Foo.cls");
    await expect(fsp.stat(fullPath)).resolves.toBeTruthy();

    // Manifest shortPathMap is null (useShort ignored on non-Windows)
    const manifest = JSON.parse(await fsp.readFile(path.join(tmp, "manifest.json"), "utf-8")) as Manifest;
    expect(manifest.shortPathMap).toBeNull();
  });

  // ── 10. Path traversal safety ────────────────────────────────────

  it("rejects destinationDir containing '..' (path traversal)", async () => {
    // Use forward-slash form so the literal ".." segment survives (path.join
    // would collapse it). Caller-supplied paths of this shape must hard-fail.
    const result = await docExportTool.handler(
      { destinationDir: `${tmp}/../escape` },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("path traversal");
  });

  it("rejects relative destinationDir", async () => {
    const result = await docExportTool.handler(
      { destinationDir: "relative/path" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("absolute");
  });

  // ── 11. system tri-state ─────────────────────────────────────────

  it("system: 'false' (default) excludes %* packages", async () => {
    installMockHttp(mockHttp, [
      { name: "MyApp.A.cls" },
      { name: "%Library.Base.cls" },
      { name: "%SYS.Other.cls" },
    ]);

    const result = await docExportTool.handler({ destinationDir: tmp }, ctx);
    const sc = result.structuredContent as ExportResult;

    expect(sc.total).toBe(1);
    expect(sc.exported).toBe(1);
    await expect(fsp.stat(path.join(tmp, "MyApp", "A.cls"))).resolves.toBeTruthy();
  });

  it("system: 'true' includes both user and % packages", async () => {
    installMockHttp(mockHttp, [
      { name: "MyApp.A.cls" },
      { name: "%Library.Base.cls" },
    ]);

    const result = await docExportTool.handler(
      { destinationDir: tmp, system: "true" },
      ctx,
    );
    const sc = result.structuredContent as ExportResult;
    expect(sc.total).toBe(2);
    expect(sc.exported).toBe(2);
  });

  it("system: 'only' returns only % packages", async () => {
    installMockHttp(mockHttp, [
      { name: "MyApp.A.cls" },
      { name: "%Library.Base.cls" },
      { name: "%SYS.Other.cls" },
    ]);

    const result = await docExportTool.handler(
      { destinationDir: tmp, system: "only" },
      ctx,
    );
    const sc = result.structuredContent as ExportResult;
    expect(sc.total).toBe(2);
    expect(sc.exported).toBe(2);
  });

  // ── 12. generated tri-state passed through to URL ─────────────────

  it("generated: 'false' sends generated=0 in /docnames query", async () => {
    installMockHttp(mockHttp, []);
    await docExportTool.handler({ destinationDir: tmp }, ctx);
    const enumPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(enumPath).toContain("generated=0");
  });

  it("generated: 'true' sends generated=1 in /docnames query", async () => {
    installMockHttp(mockHttp, []);
    await docExportTool.handler({ destinationDir: tmp, generated: "true" }, ctx);
    const enumPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(enumPath).toContain("generated=1");
  });

  it("generated: 'both' omits the generated query param", async () => {
    installMockHttp(mockHttp, []);
    await docExportTool.handler({ destinationDir: tmp, generated: "both" }, ctx);
    const enumPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(enumPath).not.toContain("generated=");
  });

  // ── 13. modifiedSince uses /modified/{ts} endpoint ───────────────

  it("modifiedSince uses the /modified/{ts} endpoint", async () => {
    installMockHttp(mockHttp, [{ name: "Recently.Updated.cls" }]);

    await docExportTool.handler(
      { destinationDir: tmp, modifiedSince: "2026-04-01T00:00:00Z" },
      ctx,
    );

    const enumPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(enumPath).toContain(`/modified/${encodeURIComponent("2026-04-01T00:00:00Z")}`);
  });

  // ── 14. Empty result — no manifest ───────────────────────────────

  it("returns empty result with no manifest file when zero docs match", async () => {
    installMockHttp(mockHttp, []);

    const result = await docExportTool.handler({ destinationDir: tmp }, ctx);
    const sc = result.structuredContent as ExportResult;

    expect(sc.total).toBe(0);
    expect(sc.exported).toBe(0);
    expect(sc.skipped).toBe(0);
    expect(sc.manifest).toBeUndefined();

    // No manifest.json on disk
    await expect(fsp.stat(path.join(tmp, "manifest.json"))).rejects.toThrow();
  });

  // ── 15. continueDownloadOnTimeout: false honors abort ────────────

  it("continueDownloadOnTimeout: false with a triggered AbortSignal returns partial:true", async () => {
    const controller = new AbortController();
    controller.abort(); // already aborted when handler starts

    installMockHttp(mockHttp, [
      { name: "MyApp.A.cls" },
      { name: "MyApp.B.cls" },
      { name: "MyApp.C.cls" },
    ]);

    // Attach signal to ctx via a thin override
    const ctxWithSignal = { ...ctx, signal: controller.signal } as ToolContext;

    const result = await docExportTool.handler(
      { destinationDir: tmp, continueDownloadOnTimeout: false },
      ctxWithSignal,
    );
    const sc = result.structuredContent as ExportResult;

    expect(sc.aborted).toBe(true);
    expect(sc.partial).toBe(true);
    expect(sc.total).toBe(3);
    // All attempts are aborted before any fetch happens
    expect(sc.exported).toBe(0);
    // Manifest should record aborted:true
    const manifest = JSON.parse(await fsp.readFile(path.join(tmp, "manifest.json"), "utf-8")) as Manifest;
    expect(manifest.aborted).toBe(true);
  });

  // ── 16. Manifest temp-rename semantics ───────────────────────────

  it("writes manifest.json atomically (no stale .manifest.json.tmp left behind)", async () => {
    installMockHttp(mockHttp, [{ name: "MyApp.A.cls" }]);

    await docExportTool.handler({ destinationDir: tmp }, ctx);

    // manifest.json exists
    await expect(fsp.stat(path.join(tmp, "manifest.json"))).resolves.toBeTruthy();
    // .manifest.json.tmp should NOT be present after a successful run
    await expect(fsp.stat(path.join(tmp, ".manifest.json.tmp"))).rejects.toThrow();
  });

  // ── 17. CSP paths preserve forward slashes ───────────────────────

  it("maps CSP forward-slash names under destinationDir (leading slash stripped)", async () => {
    installMockHttp(mockHttp, [
      { name: "/csp/user/menu.csp", lines: ["<html></html>"] },
    ]);

    // CSP docs pass prefix filter only if prefix is unset (their stem starts with "/")
    const result = await docExportTool.handler(
      { destinationDir: tmp, category: "CSP" },
      ctx,
    );
    const sc = result.structuredContent as ExportResult;

    expect(sc.exported).toBe(1);
    const cspPath = path.join(tmp, "csp", "user", "menu.csp");
    await expect(fsp.stat(cspPath)).resolves.toBeTruthy();
  });

  // ── 18. Path collision detection (platform-independent) ──────────
  //
  // Two doc names can resolve to the same on-disk path when a
  // CSP-style name and a dotted class name happen to overlap
  // (e.g., `/csp/foo/bar.cls` and `csp.foo.bar.cls`). Without a
  // collision guard the second write silently overwrites the first.
  // The second doc must be skipped with a clear `reason`.

  it("detects and skips path collisions between two different doc names", async () => {
    installMockHttp(mockHttp, [
      { name: "/csp/foo/bar.cls", lines: ["CSP CONTENT"] },
      { name: "csp.foo.bar.cls", lines: ["DOTTED CONTENT"] },
    ]);

    const result = await docExportTool.handler({ destinationDir: tmp }, ctx);
    const sc = result.structuredContent as ExportResult;

    expect(sc.total).toBe(2);
    expect(sc.exported).toBe(1);
    expect(sc.skipped).toBe(1);
    expect(sc.skippedItems[0]?.reason).toContain("short-path collision");

    // Exactly one file on disk at that path
    const collisionPath = path.join(tmp, "csp", "foo", "bar.cls");
    await expect(fsp.stat(collisionPath)).resolves.toBeTruthy();
  });

  // ── Additional: annotations + scope ──────────────────────────────

  it("has correct tool annotations and scope", () => {
    expect(docExportTool.name).toBe("iris_doc_export");
    expect(docExportTool.scope).toBe("NS");
    expect(docExportTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
