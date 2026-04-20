import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import {
  packageListTool,
  rollupPackage,
  stripDocExtension,
  NON_CLASS_BUCKET,
  PACKAGE_ROW_LIMIT,
} from "../tools/packages.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── Local helpers ──────────────────────────────────────────────────

/** Build an Atelier-style doc record (only the fields we care about). */
function doc(name: string) {
  return { name };
}

// ── Pure helpers ───────────────────────────────────────────────────

describe("stripDocExtension", () => {
  it("strips known Atelier document extensions (case-insensitive)", () => {
    expect(stripDocExtension("Foo.Bar.Baz.cls")).toBe("Foo.Bar.Baz");
    expect(stripDocExtension("Foo.Bar.Baz.CLS")).toBe("Foo.Bar.Baz");
    expect(stripDocExtension("My.Routine.mac")).toBe("My.Routine");
    expect(stripDocExtension("My.Include.inc")).toBe("My.Include");
    expect(stripDocExtension("Legacy.BAS")).toBe("Legacy");
    expect(stripDocExtension("Page.csp")).toBe("Page");
  });

  it("leaves unknown or missing extensions intact", () => {
    expect(stripDocExtension("NoExtension")).toBe("NoExtension");
    expect(stripDocExtension("Foo.Bar.xyz")).toBe("Foo.Bar.xyz");
  });
});

describe("rollupPackage", () => {
  it("returns the first N dotted segments before the extension", () => {
    expect(rollupPackage("EnsLib.HTTP.Service.cls", 1)).toBe("EnsLib");
    expect(rollupPackage("EnsLib.HTTP.Service.cls", 2)).toBe("EnsLib.HTTP");
    expect(rollupPackage("EnsLib.HTTP.Service.cls", 3)).toBe(
      "EnsLib.HTTP.Service",
    );
  });

  it("returns the full stem when depth exceeds segment count", () => {
    expect(rollupPackage("Top.cls", 3)).toBe("Top");
    expect(rollupPackage("One.Two.cls", 5)).toBe("One.Two");
  });

  it("does not count the file extension as a segment", () => {
    expect(rollupPackage("Foo.cls", 1)).toBe("Foo");
    expect(rollupPackage("Foo.mac", 1)).toBe("Foo");
  });

  it("buckets CSP/forward-slash paths under NON_CLASS_BUCKET", () => {
    // CSP pages come through Atelier as filesystem-style paths like
    // "/csp/user/menu.csp". They are not dotted packages, so the rollup
    // must not split them on "." (that would produce ugly one-off rows).
    expect(rollupPackage("/csp/user/menu.csp", 1)).toBe(NON_CLASS_BUCKET);
    expect(rollupPackage("/csp/user/menu.csp", 3)).toBe(NON_CLASS_BUCKET);
    expect(rollupPackage("some/path/thing.cls", 1)).toBe(NON_CLASS_BUCKET);
    // Sanity: stems without a slash still roll up normally.
    expect(rollupPackage("EnsLib.HTTP.Service.cls", 1)).toBe("EnsLib");
  });
});

// ── iris_package_list ──────────────────────────────────────────────

describe("iris_package_list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("returns top-level packages at depth 1 sorted by count desc, name asc", async () => {
    const docs = [
      doc("EnsLib.HTTP.Service.cls"),
      doc("EnsLib.JMS.Service.cls"),
      doc("EnsLib.HTTP.Adapter.cls"),
      doc("Ens.Director.cls"),
      doc("Ens.Host.cls"),
      doc("Sample.Person.cls"),
    ];
    mockHttp.get.mockResolvedValue(envelope({ content: docs }));

    const result = await packageListTool.handler({}, ctx);

    // Verify URL shape
    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/docnames/*/*",
    );

    // Sorted: EnsLib (3) > Ens (2) > Sample (1); ties broken by name asc.
    const sc = result.structuredContent as {
      packages: Array<{ name: string; docCount: number; depth: number }>;
      count: number;
      namespace: string;
      depth: number;
      prefix: string | null;
      totalDocs: number;
    };
    expect(sc.packages).toEqual([
      { name: "EnsLib", docCount: 3, depth: 1 },
      { name: "Ens", docCount: 2, depth: 1 },
      { name: "Sample", docCount: 1, depth: 1 },
    ]);
    expect(sc.count).toBe(3);
    expect(sc.totalDocs).toBe(6);
    expect(sc.namespace).toBe("USER");
    expect(sc.depth).toBe(1);
    expect(sc.prefix).toBeNull();
    expect(result.isError).toBeUndefined();
  });

  it("narrows to <prefix>.* at depth 2 and counts correctly", async () => {
    const docs = [
      doc("EnsLib.HTTP.Service.cls"),
      doc("EnsLib.HTTP.Adapter.cls"),
      doc("EnsLib.JMS.Service.cls"),
      doc("EnsLib.JMS.Adapter.cls"),
      doc("EnsLib.JMS.Outbound.cls"),
      doc("Ens.Director.cls"), // excluded by prefix
      doc("Sample.Person.cls"), // excluded by prefix
    ];
    mockHttp.get.mockResolvedValue(envelope({ content: docs }));

    const result = await packageListTool.handler(
      { depth: 2, prefix: "EnsLib" },
      ctx,
    );

    const sc = result.structuredContent as {
      packages: Array<{ name: string; docCount: number; depth: number }>;
      prefix: string | null;
      totalDocs: number;
    };
    expect(sc.packages).toEqual([
      { name: "EnsLib.JMS", docCount: 3, depth: 2 },
      { name: "EnsLib.HTTP", docCount: 2, depth: 2 },
    ]);
    expect(sc.prefix).toBe("EnsLib");
    expect(sc.totalDocs).toBe(5);
  });

  it("excludes % packages by default (system: false)", async () => {
    const docs = [
      doc("MyApp.Service.cls"),
      doc("%Library.Base.cls"),
      doc("%SYS.Python.cls"),
    ];
    mockHttp.get.mockResolvedValue(envelope({ content: docs }));

    const result = await packageListTool.handler({}, ctx);

    const sc = result.structuredContent as {
      packages: Array<{ name: string; docCount: number }>;
      totalDocs: number;
    };
    expect(sc.packages).toEqual([
      { name: "MyApp", docCount: 1, depth: 1 },
    ]);
    expect(sc.totalDocs).toBe(1);
  });

  it("includes both user and % packages when system: 'true'", async () => {
    const docs = [
      doc("MyApp.Service.cls"),
      doc("%Library.Base.cls"),
      doc("%SYS.Python.cls"),
    ];
    mockHttp.get.mockResolvedValue(envelope({ content: docs }));

    const result = await packageListTool.handler({ system: "true" }, ctx);

    const sc = result.structuredContent as {
      packages: Array<{ name: string; docCount: number }>;
      totalDocs: number;
    };
    // %Library (1), %SYS (1), MyApp (1) — tied on count, sorted by name asc.
    // JS localeCompare sorts "%" before letters, so %Library and %SYS come first.
    expect(sc.packages.map((p) => p.name).sort()).toEqual(
      ["%Library", "%SYS", "MyApp"].sort(),
    );
    expect(sc.totalDocs).toBe(3);
  });

  it("returns only % packages when system: 'only'", async () => {
    const docs = [
      doc("MyApp.Service.cls"),
      doc("%Library.Base.cls"),
      doc("%SYS.Python.cls"),
      doc("%SYS.Python.Extra.cls"),
    ];
    mockHttp.get.mockResolvedValue(envelope({ content: docs }));

    const result = await packageListTool.handler({ system: "only" }, ctx);

    const sc = result.structuredContent as {
      packages: Array<{ name: string; docCount: number }>;
      totalDocs: number;
    };
    expect(sc.packages).toEqual([
      { name: "%SYS", docCount: 2, depth: 1 },
      { name: "%Library", docCount: 1, depth: 1 },
    ]);
    expect(sc.totalDocs).toBe(3);
  });

  it("calls /modified/{ts} endpoint when modifiedSince is set and aggregates the result", async () => {
    const modifiedDocs = [
      doc("MyApp.Updated.cls"),
      doc("MyApp.Changed.cls"),
      doc("Other.New.cls"),
    ];
    mockHttp.get.mockResolvedValue(envelope({ content: modifiedDocs }));

    const result = await packageListTool.handler(
      { modifiedSince: "2026-04-05T00:00:00Z" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      `/api/atelier/v7/USER/modified/${encodeURIComponent("2026-04-05T00:00:00Z")}`,
    );
    const sc = result.structuredContent as {
      packages: Array<{ name: string; docCount: number }>;
      totalDocs: number;
    };
    expect(sc.packages).toEqual([
      { name: "MyApp", docCount: 2, depth: 1 },
      { name: "Other", docCount: 1, depth: 1 },
    ]);
    expect(sc.totalDocs).toBe(3);
  });

  it("returns empty packages/count/totalDocs for an empty namespace", async () => {
    mockHttp.get.mockResolvedValue(envelope({ content: [] }));

    const result = await packageListTool.handler({}, ctx);

    expect(result.structuredContent).toEqual({
      packages: [],
      count: 0,
      namespace: "USER",
      depth: 1,
      prefix: null,
      totalDocs: 0,
    });
    expect(result.isError).toBeUndefined();
  });

  it("passes category and type through to the Atelier URL", async () => {
    mockHttp.get.mockResolvedValue(envelope({ content: [] }));

    await packageListTool.handler({ category: "CLS", type: "cls" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/docnames/CLS/cls",
    );
  });

  it("passes generated=1 as a query parameter when generated: true", async () => {
    mockHttp.get.mockResolvedValue(envelope({ content: [] }));

    await packageListTool.handler({ generated: true }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("/docnames/*/*");
    expect(calledPath).toContain("generated=1");
  });

  it("handles a deep prefix with depth=3 (segment-count math)", async () => {
    const docs = [
      doc("A.B.C.One.cls"),
      doc("A.B.C.Two.cls"),
      doc("A.B.D.Three.cls"),
      doc("A.E.F.cls"),
    ];
    mockHttp.get.mockResolvedValue(envelope({ content: docs }));

    const result = await packageListTool.handler(
      { depth: 3, prefix: "A.B" },
      ctx,
    );

    const sc = result.structuredContent as {
      packages: Array<{ name: string; docCount: number; depth: number }>;
      totalDocs: number;
    };
    // A.B.C has 2 docs (A.B.C.One, A.B.C.Two); A.B.D has 1.
    // A.E.F is excluded by prefix=A.B.
    expect(sc.packages).toEqual([
      { name: "A.B.C", docCount: 2, depth: 3 },
      { name: "A.B.D", docCount: 1, depth: 3 },
    ]);
    expect(sc.totalDocs).toBe(3);
  });

  it("caps results at PACKAGE_ROW_LIMIT with truncated: true", async () => {
    // Generate 1001 distinct top-level packages (Pkg0000..Pkg1000).
    const docs = Array.from({ length: PACKAGE_ROW_LIMIT + 1 }, (_, i) =>
      doc(`Pkg${String(i).padStart(4, "0")}.Thing.cls`),
    );
    mockHttp.get.mockResolvedValue(envelope({ content: docs }));

    const result = await packageListTool.handler({}, ctx);

    const sc = result.structuredContent as {
      packages: unknown[];
      count: number;
      totalDocs: number;
      truncated?: boolean;
      limit?: number;
    };
    expect(sc.packages).toHaveLength(PACKAGE_ROW_LIMIT);
    expect(sc.count).toBe(PACKAGE_ROW_LIMIT);
    expect(sc.totalDocs).toBe(PACKAGE_ROW_LIMIT + 1);
    expect(sc.truncated).toBe(true);
    expect(sc.limit).toBe(PACKAGE_ROW_LIMIT);
  });

  it("uses namespace override when provided", async () => {
    mockHttp.get.mockResolvedValue(envelope({ content: [] }));

    await packageListTool.handler({ namespace: "HSCUSTOM" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/HSCUSTOM/docnames/*/*",
    );
  });

  it("collapses CSP/forward-slash paths into a single (csp) bucket row", async () => {
    // Mixed namespace with two real dotted packages plus three CSP-style
    // docs. Without the bucket, each /csp/... doc would produce its own
    // package row (noise); with the bucket they roll up to one row.
    const docs = [
      doc("MyApp.Service.cls"),
      doc("MyApp.Utils.cls"),
      doc("/csp/user/menu.csp"),
      doc("/csp/user/login.csp"),
      doc("/csp/sys/mgr/UtilHome.csp"),
    ];
    mockHttp.get.mockResolvedValue(envelope({ content: docs }));

    const result = await packageListTool.handler({}, ctx);

    const sc = result.structuredContent as {
      packages: Array<{ name: string; docCount: number; depth: number }>;
      totalDocs: number;
    };
    expect(sc.packages).toEqual([
      { name: NON_CLASS_BUCKET, docCount: 3, depth: 1 },
      { name: "MyApp", docCount: 2, depth: 1 },
    ]);
    expect(sc.totalDocs).toBe(5);
  });

  it("matches documents whose name equals the prefix exactly (edge case)", async () => {
    // A doc literally named "Foo.cls" should be counted under prefix "Foo".
    const docs = [
      doc("Foo.cls"),
      doc("Foo.Bar.cls"),
      doc("FooBar.cls"), // must NOT match prefix "Foo" (no dot separator)
    ];
    mockHttp.get.mockResolvedValue(envelope({ content: docs }));

    const result = await packageListTool.handler(
      { prefix: "Foo", depth: 1 },
      ctx,
    );

    const sc = result.structuredContent as {
      packages: Array<{ name: string; docCount: number }>;
      totalDocs: number;
    };
    expect(sc.packages).toEqual([{ name: "Foo", docCount: 2, depth: 1 }]);
    expect(sc.totalDocs).toBe(2);
  });

  it("propagates connection errors", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(packageListTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });

  it("exposes the expected annotations and tool metadata", () => {
    expect(packageListTool.name).toBe("iris_package_list");
    expect(packageListTool.scope).toBe("NS");
    expect(packageListTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    // Description should reference iris_doc_list for AC 10.1.6.
    expect(packageListTool.description).toContain("iris_doc_list");
  });
});
