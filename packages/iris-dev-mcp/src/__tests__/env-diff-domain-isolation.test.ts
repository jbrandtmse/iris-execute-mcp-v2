/**
 * Tests for `iris_env_diff`'s PER-DOMAIN ERROR ISOLATION (Story 27.1 cycle-2
 * lead-smoke rework, elevates CR 27.1-3).
 *
 * The lead's live smoke against real IRIS (built dist + both configured
 * profiles) proved the tool's core value — 145 real cross-namespace `mappings`
 * drift items between HSCUSTOM and SADEMO — but ALSO found that two natural
 * invocations failed ENTIRELY under the shared single try/catch that used to
 * wrap all five domains: (A) a bare `iris_env_diff(source, target)` call
 * aborted because `documents` was silently defaulted-in and needed a `spec`
 * it never got, hiding the four no-spec domains' results; (D) `defaultSettings`
 * against a non-interop namespace hard-errored (`Ens_Config.DefaultSettings`
 * missing) and discarded every other domain's already-computed diff.
 *
 * This suite proves the fix: each domain's fetch+diff now runs in its OWN
 * try/catch (mirrors `Health.cls`'s per-area isolation — Epic 23 / Rule #41).
 * A hard error (an `IrisApiError`, or — for `documents` — the missing-`spec`
 * guard) is isolated to THAT domain (`structuredContent.errors[domain]`) and
 * the diff CONTINUES with the rest; `summary` only rolls up the succeeded
 * domains. `isError` is `false` for a PARTIAL failure (>=1 domain succeeded)
 * and `true` only when EVERY requested domain fails. A genuine bug (a
 * non-`IrisApiError` throw) is NOT swallowed — it still propagates out of the
 * whole call, exactly as before this rework (isolation is scoped to
 * anticipated IRIS-side failures, never to real defects).
 *
 * Complements `env-diff-domains.test.ts` (each domain's OWN bucket behavior in
 * isolation) and `env-diff.test.ts` (the single-domain-is-the-only-domain
 * all-fail case, e.g. `documents` requested alone without `spec`). Mocked-HTTP
 * unit tests only — no live IRIS. Plain `*.test.ts` in the DEFAULT vitest
 * suite (Rule #21 — not the excluded `*.integration.test.ts` suffix).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError, ProfileResolutionError } from "@iris-mcp/shared";
import { envDiffTool } from "../tools/env-diff.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── fixture builders (self-contained, mirrors sibling suites' shapes) ──────

interface MappingRow {
  name: string;
  type: string;
  namespace: string;
  database: string;
}

function mappingRow(overrides: Partial<MappingRow> = {}): MappingRow {
  return { name: "Test", type: "global", namespace: "HSCUSTOM", database: "IRISDB", ...overrides };
}

interface WebAppRow {
  name: string;
  namespace: string;
  dispatchClass: string;
  description: string;
  enabled: boolean;
  authEnabled: number;
  isNameSpaceDefault: boolean;
  cspZenEnabled: boolean;
  recurse: boolean;
  matchRoles: string;
  cookiePath: string;
}

function webappRow(overrides: Partial<WebAppRow> = {}): WebAppRow {
  return {
    name: "/api/test",
    namespace: "HSCUSTOM",
    dispatchClass: "My.Dispatch",
    description: "",
    enabled: true,
    authEnabled: 32,
    isNameSpaceDefault: false,
    cspZenEnabled: false,
    recurse: true,
    matchRoles: "%DB_HSCUSTOM",
    cookiePath: "/api/test/",
    ...overrides,
  };
}

function configProps(overrides: Partial<Record<string, number | string>> = {}) {
  return {
    Maxprocesses: 100,
    globals: 100,
    routines: 100,
    gmheap: 100,
    locksiz: 100,
    jrnbufs: 100,
    console: "en",
    errlog: 100,
    wdparm: 100,
    ijcnum: 100,
    ijcbuff: 100,
    ...overrides,
  };
}

// ── structuredContent shapes (test-local) ───────────────────────────────

interface BucketCounts {
  onlyInSource: unknown[];
  onlyInTarget: unknown[];
  differs: unknown[];
  identical: number;
}

interface EnvDiffSC {
  domains: {
    documents?: BucketCounts;
    mappings?: BucketCounts;
    defaultSettings?: BucketCounts;
    webapps?: BucketCounts;
    config?: BucketCounts;
  };
  errors?: Record<string, string>;
  summary: { driftCount: number; identicalCount: number };
}

describe("iris_env_diff -- per-domain error isolation (Story 27.1 cycle-2 rework, CR 27.1-3)", () => {
  let sourceHttp: ReturnType<typeof createMockHttp>;
  let targetHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    sourceHttp = createMockHttp("HSCUSTOM");
    targetHttp = createMockHttp("SADEMO");
    ctx = createMockCtx(sourceHttp);
    ctx.resolveProfileClient = vi.fn(async (name: string) => {
      if (name === "source") return sourceHttp;
      if (name === "target") return targetHttp;
      throw new ProfileResolutionError(name, ["default", "source", "target"]);
    });
  });

  it("isolates ONE hard-erroring domain (defaultSettings, mirrors the live smoke's scenario D) -- the other three default domains still succeed, isError:false, summary excludes the failed domain", async () => {
    sourceHttp.get.mockImplementation(async (path: string) => {
      if (path.includes("/config/mapping/global")) {
        return envelope([mappingRow({ name: "OnlySrcMap" })]);
      }
      if (path.includes("/config/mapping/")) return envelope([]); // routine, package
      if (path.includes("/interop/defaultsettings")) {
        throw new IrisApiError(
          500,
          [],
          "/api/executemcp/v2/interop/defaultsettings",
          "SQLCODE <0: Ens_Config.DefaultSettings does not exist in this namespace.",
        );
      }
      if (path.includes("/security/webapp")) {
        return envelope([webappRow({ name: "/api/same" })]);
      }
      throw new Error(`unexpected source GET ${path}`);
    });
    targetHttp.get.mockImplementation(async (path: string) => {
      if (path.includes("/config/mapping/")) return envelope([]);
      if (path.includes("/interop/defaultsettings")) {
        throw new IrisApiError(
          500,
          [],
          "/api/executemcp/v2/interop/defaultsettings",
          "SQLCODE <0: Ens_Config.DefaultSettings does not exist in this namespace.",
        );
      }
      if (path.includes("/security/webapp")) {
        return envelope([webappRow({ name: "/api/same" })]);
      }
      throw new Error(`unexpected target GET ${path}`);
    });
    sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps({ Maxprocesses: 100 }) }));
    targetHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps({ Maxprocesses: 200 }) }));

    // Bare default domains -- no `domains` param, no `spec` (documents is opt-in).
    const result = await envDiffTool.handler({ source: "source", target: "target" }, ctx);

    // Partial failure: the call itself succeeded (isError:false, not true and
    // not undefined) -- real data came back for 3 of the 4 domains.
    expect(result.isError).toBe(false);

    const sc = result.structuredContent as unknown as EnvDiffSC;
    expect(sc.domains.defaultSettings).toBeUndefined();
    expect(sc.domains.mappings).toBeDefined();
    expect(sc.domains.webapps).toBeDefined();
    expect(sc.domains.config).toBeDefined();
    expect(sc.domains.documents).toBeUndefined(); // opt-in, not requested

    expect(sc.errors).toBeDefined();
    expect(Object.keys(sc.errors!)).toEqual(["defaultSettings"]);
    expect(sc.errors!.defaultSettings).toContain("Ens_Config.DefaultSettings");

    // Summary reflects ONLY the 3 succeeded domains: mappings (1 onlyInSource),
    // webapps (1 identical), config (1 differs + 10 identical).
    expect(sc.domains.mappings!.onlyInSource).toHaveLength(1);
    expect(sc.domains.webapps!.identical).toBe(1);
    expect(sc.domains.config!.differs).toHaveLength(1);
    expect(sc.summary.driftCount).toBe(2); // 1 (mappings onlyInSource) + 1 (config differs)
    expect(sc.summary.identicalCount).toBe(11); // 0 (mappings) + 1 (webapps) + 10 (config)

    // The failure is surfaced in the human-readable text too.
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Default Settings:");
    expect(text).toContain("ERROR: SQLCODE <0: Ens_Config.DefaultSettings does not exist in this namespace.");
    expect(text).toContain("1 of 4 requested domain(s) failed");
    expect(text).toContain("Mappings:");
    expect(text).toContain("Web Applications:");
    expect(text).toContain("Config:");
  });

  it("returns isError:true with a clean envelope when EVERY requested domain fails", async () => {
    const boom = () => {
      throw new IrisApiError(503, [], "/api/executemcp/v2/x", "service unavailable");
    };
    sourceHttp.get.mockImplementation(async () => boom());
    targetHttp.get.mockImplementation(async () => boom());
    sourceHttp.post.mockImplementation(async () => boom());
    targetHttp.post.mockImplementation(async () => boom());

    const result = await envDiffTool.handler(
      { source: "source", target: "target", domains: ["mappings", "defaultSettings", "webapps", "config"] },
      ctx,
    );

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as unknown as EnvDiffSC;
    expect(sc.domains.mappings).toBeUndefined();
    expect(sc.domains.defaultSettings).toBeUndefined();
    expect(sc.domains.webapps).toBeUndefined();
    expect(sc.domains.config).toBeUndefined();
    expect(Object.keys(sc.errors!).sort()).toEqual(["config", "defaultSettings", "mappings", "webapps"]);
    expect(sc.summary.driftCount).toBe(0);
    expect(sc.summary.identicalCount).toBe(0);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("4 of 4 requested domain(s) failed");
  });

  it("isolates the 'documents' missing-spec guard to JUST that domain when requested alongside another domain (scenario A shape) -- isError:false, the other domain's diff is intact", async () => {
    sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps({ Maxprocesses: 100 }) }));
    targetHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps({ Maxprocesses: 100 }) }));

    const result = await envDiffTool.handler(
      { source: "source", target: "target", domains: ["documents", "config"] }, // no 'spec' passed
      ctx,
    );

    expect(result.isError).toBe(false);
    const sc = result.structuredContent as unknown as EnvDiffSC;
    expect(sc.domains.documents).toBeUndefined();
    expect(sc.domains.config).toBeDefined();
    expect(sc.domains.config!.identical).toBe(11);
    expect(sc.errors).toEqual({
      documents:
        "'spec' is required for the 'documents' domain (e.g. 'MyPkg.*.cls,*.mac'). " +
        "A bare '*' is refused unless allowWide:true.",
    });
    // No /dev/doc/hashes call was ever attempted for the failed domain.
    expect(sourceHttp.post.mock.calls.every((c) => (c[0] as string).includes("/system/config"))).toBe(true);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Documents:");
    expect(text).toContain("ERROR: 'spec' is required");
    expect(text).toContain("1 of 2 requested domain(s) failed");
    expect(text).toContain("Config:");
  });

  it("does NOT swallow a non-IrisApiError (a genuine bug) as a per-domain error -- it still propagates out of the whole call, aborting domains not yet processed", async () => {
    sourceHttp.get.mockImplementation(async (path: string) => {
      if (path.includes("/config/mapping/")) throw new TypeError("unexpected shape");
      return envelope([]);
    });
    targetHttp.get.mockResolvedValue(envelope([]));
    // 'config' comes AFTER 'mappings' in canonical domain order, so it must
    // never even be reached once mappings rethrows.
    targetHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps() }));

    await expect(
      envDiffTool.handler(
        { source: "source", target: "target", domains: ["mappings", "config"] },
        ctx,
      ),
    ).rejects.toThrow("unexpected shape");

    expect(targetHttp.post).not.toHaveBeenCalled();
  });

  it("an all-succeeding call across the default 4 domains has NO 'errors' key at all and isError is undefined (not false)", async () => {
    const getMock = async (path: string) => {
      if (path.includes("/interop/defaultsettings")) return envelope({ settings: [], count: 0 });
      return envelope([]); // mappings, webapps
    };
    sourceHttp.get.mockImplementation(getMock);
    targetHttp.get.mockImplementation(getMock);
    sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps() }));
    targetHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps() }));

    const result = await envDiffTool.handler({ source: "source", target: "target" }, ctx);

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as unknown as EnvDiffSC;
    expect(sc.errors).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("requested domain(s) failed");
  });
});
