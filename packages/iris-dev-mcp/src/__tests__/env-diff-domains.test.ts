/**
 * Tests for the four domains `iris_env_diff` gained in Story 27.1 —
 * `mappings`, `defaultSettings` (+ credential redaction, AC 27.1.2), `webapps`,
 * `config` — plus the default `domains` behavior and the cross-domain
 * roll-up/filter behavior (AC 27.1.3).
 *
 * Cycle-1 widened the default `domains` to ALL FIVE; the cycle-2 lead-smoke
 * rework NARROWED it back to these FOUR no-spec domains (`documents` is
 * opt-in only — see `env-diff.ts`'s `DEFAULT_DIFF_DOMAINS`) — the "default
 * domains" tests below reflect the CURRENT (cycle-2) behavior. Per-domain
 * error-isolation tests (partial failure, all-domains-fail) live in the
 * sibling `env-diff-domain-isolation.test.ts`.
 *
 * Sibling to `env-diff.test.ts` (Story 27.0's `documents`-domain suite, per
 * the story's own "env-diff.test.ts (or a sibling)" guidance). Mocked-HTTP
 * unit tests only — no live IRIS (Rule #21, default vitest suite).
 *
 * `ctx.resolveProfileClient` is overridden per test with a `vi.fn()` that maps
 * profile name -> its own mock `IrisHttpClient`, mirroring `env-diff.test.ts`
 * (the shared `createMockCtx` default cannot exercise TWO distinct profiles).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError, ProfileResolutionError } from "@iris-mcp/shared";
import { envDiffTool, isCredentialSetting } from "../tools/env-diff.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── fixture builders ──────────────────────────────────────────────────

interface MappingRow {
  name: string;
  type: string;
  namespace: string;
  database: string;
  collation?: string;
  lockDatabase?: string;
  subscript?: string;
}

function mappingRow(overrides: Partial<MappingRow> = {}): MappingRow {
  return {
    name: "Test",
    type: "global",
    namespace: "HSCUSTOM",
    database: "IRISDB",
    ...overrides,
  };
}

interface SdsRow {
  id: number;
  production: string;
  item: string;
  hostClass: string;
  setting: string;
  value: string;
}

function sdsRow(overrides: Partial<SdsRow> = {}): SdsRow {
  return {
    id: 1,
    production: "MyProd",
    item: "MyItem",
    hostClass: "MyHost",
    setting: "Timeout",
    value: "30",
    ...overrides,
  };
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

// ── structuredContent shapes (test-local, mirrors env-diff.ts's internal types) ──

interface MappingsDiffSC {
  onlyInSource: string[];
  onlyInTarget: string[];
  differs: Array<{
    type: string;
    namespace: string;
    name: string;
    sourceValue: Record<string, unknown>;
    targetValue: Record<string, unknown>;
  }>;
  identical: number;
}

interface SdsOnlyEntrySC {
  production: string;
  item: string;
  hostClass: string;
  setting: string;
  value: string;
}

interface SdsDiffEntrySC {
  production: string;
  item: string;
  hostClass: string;
  setting: string;
  sourceValue?: string;
  targetValue?: string;
  redacted?: string;
}

interface DefaultSettingsDiffSC {
  onlyInSource: SdsOnlyEntrySC[];
  onlyInTarget: SdsOnlyEntrySC[];
  differs: SdsDiffEntrySC[];
  identical: number;
}

interface WebappsDiffSC {
  onlyInSource: string[];
  onlyInTarget: string[];
  differs: Array<{ name: string; sourceValue: Record<string, unknown>; targetValue: Record<string, unknown> }>;
  identical: number;
}

interface ConfigDiffSC {
  onlyInSource: string[];
  onlyInTarget: string[];
  differs: Array<{ key: string; sourceValue: unknown; targetValue: unknown }>;
  identical: number;
}

interface FullDomainsSC {
  source: { profile: string; namespace: string };
  target: { profile: string; namespace: string };
  domains: {
    documents?: unknown;
    mappings?: MappingsDiffSC;
    defaultSettings?: DefaultSettingsDiffSC;
    webapps?: WebappsDiffSC;
    config?: ConfigDiffSC;
  };
  summary: { driftCount: number; identicalCount: number };
}

describe("iris_env_diff -- Story 27.1 domains", () => {
  let sourceHttp: ReturnType<typeof createMockHttp>;
  let targetHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    // Distinct default namespaces per mock (mirrors two real profiles with
    // different configured defaults, e.g. default->HSCUSTOM, sademo->SADEMO).
    sourceHttp = createMockHttp("HSCUSTOM");
    targetHttp = createMockHttp("SADEMO");
    ctx = createMockCtx(sourceHttp);
    ctx.resolveProfileClient = vi.fn(async (name: string) => {
      if (name === "source") return sourceHttp;
      if (name === "target") return targetHttp;
      throw new ProfileResolutionError(name, ["default", "source", "target"]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // mappings (AC 27.1.1)
  // ══════════════════════════════════════════════════════════════════

  describe("mappings domain", () => {
    it("buckets onlyInSource/onlyInTarget/differs/identical keyed by (type, name); database/collation/lockDatabase are the compared value", async () => {
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([
            mappingRow({ name: "OnlySrc" }),
            mappingRow({ name: "Diff", database: "DBA" }),
            mappingRow({ name: "Same", database: "DBB", collation: "5" }),
          ]);
        }
        return envelope([]); // routine, package: empty
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([
            mappingRow({ name: "OnlyTgt" }),
            mappingRow({ name: "Diff", database: "DBZ" }),
            mappingRow({ name: "Same", database: "DBB", collation: "5" }),
          ]);
        }
        return envelope([]);
      });

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["mappings"], namespace: "HSCUSTOM" },
        ctx,
      );

      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.mappings as MappingsDiffSC;
      expect(d.onlyInSource).toEqual(["global::OnlySrc"]);
      expect(d.onlyInTarget).toEqual(["global::OnlyTgt"]);
      expect(d.differs).toEqual([
        {
          type: "global",
          namespace: "HSCUSTOM",
          name: "Diff",
          sourceValue: { database: "DBA" },
          targetValue: { database: "DBZ" },
        },
      ]);
      expect(d.identical).toBe(1);
      expect(sc.summary.driftCount).toBe(3);
      expect(sc.summary.identicalCount).toBe(1);
    });

    it("issues 3 GET calls per side (global/routine/package), each carrying the resolved namespace query param", async () => {
      sourceHttp.get.mockResolvedValue(envelope([]));
      targetHttp.get.mockResolvedValue(envelope([]));
      await envDiffTool.handler(
        { source: "source", target: "target", domains: ["mappings"], namespace: "HSCUSTOM" },
        ctx,
      );
      expect(sourceHttp.get).toHaveBeenCalledTimes(3);
      const paths = sourceHttp.get.mock.calls.map((c) => c[0] as string);
      expect(paths.some((p) => p.includes("/config/mapping/global?namespace=HSCUSTOM"))).toBe(true);
      expect(paths.some((p) => p.includes("/config/mapping/routine?namespace=HSCUSTOM"))).toBe(true);
      expect(paths.some((p) => p.includes("/config/mapping/package?namespace=HSCUSTOM"))).toBe(true);
    });

    it("CROSS-NAMESPACE regression (cycle-2 HIGH fix, 2026-07-11): keys on (type, name) ONLY -- namespace is NOT part of the identity. A same-named/same-type mapping under each profile's OWN differing default namespace is IDENTICAL when its value matches (previously a spurious onlyInSource+onlyInTarget artifact -- the lead capstone's 'promote can never go clean' bug), and DIFFERS (never onlyInSource+onlyInTarget) when its value genuinely differs", async () => {
      // No `namespace` override -- source resolves HSCUSTOM, target resolves SADEMO (beforeEach).
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([
            mappingRow({ name: "Same", namespace: "HSCUSTOM", database: "DB" }),
            mappingRow({ name: "Diff", namespace: "HSCUSTOM", database: "DBA" }),
          ]);
        }
        return envelope([]);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([
            mappingRow({ name: "Same", namespace: "SADEMO", database: "DB" }),
            mappingRow({ name: "Diff", namespace: "SADEMO", database: "DBZ" }),
          ]);
        }
        return envelope([]);
      });

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["mappings"] },
        ctx,
      );
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.mappings as MappingsDiffSC;
      // Same (type, name) + same database, different namespace -> IDENTICAL (the fix).
      expect(d.identical).toBe(1);
      expect(d.onlyInSource).toEqual([]);
      expect(d.onlyInTarget).toEqual([]);
      // Same (type, name) + DIFFERING database, different namespace -> differs (never onlyInSource+onlyInTarget).
      expect(d.differs).toEqual([
        {
          type: "global",
          namespace: "HSCUSTOM",
          name: "Diff",
          sourceValue: { database: "DBA" },
          targetValue: { database: "DBZ" },
        },
      ]);
    });

    it("does not read the dead 'subscript' response field -- name-embedded subscripts are the only representation", async () => {
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([
            mappingRow({ name: '%SYS("HealthShare")', database: "DB", subscript: "should-be-ignored" }),
          ]);
        }
        return envelope([]);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([mappingRow({ name: '%SYS("HealthShare")', database: "DB" })]);
        }
        return envelope([]);
      });
      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["mappings"], namespace: "HSCUSTOM" },
        ctx,
      );
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.mappings as MappingsDiffSC;
      // Identical despite one side carrying a (deliberately ignored) subscript field.
      expect(d.identical).toBe(1);
      expect(d.differs).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // defaultSettings (SDS) + credential redaction (AC 27.1.1, AC 27.1.2)
  // ══════════════════════════════════════════════════════════════════

  describe("defaultSettings domain", () => {
    it("buckets onlyInSource/onlyInTarget/differs/identical keyed by production||item||hostClass||setting, for a non-credential setting", async () => {
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({
            settings: [
              sdsRow({ setting: "OnlySrc", value: "1" }),
              sdsRow({ setting: "Diff", value: "source-val" }),
              sdsRow({ setting: "Same", value: "same-val" }),
            ],
            count: 3,
          });
        }
        return envelope([]);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({
            settings: [
              sdsRow({ setting: "OnlyTgt", value: "2" }),
              sdsRow({ setting: "Diff", value: "target-val" }),
              sdsRow({ setting: "Same", value: "same-val" }),
            ],
            count: 3,
          });
        }
        return envelope([]);
      });

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["defaultSettings"], namespace: "HSCUSTOM" },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.defaultSettings as DefaultSettingsDiffSC;
      expect(d.onlyInSource).toEqual([
        { production: "MyProd", item: "MyItem", hostClass: "MyHost", setting: "OnlySrc", value: "1" },
      ]);
      expect(d.onlyInTarget).toEqual([
        { production: "MyProd", item: "MyItem", hostClass: "MyHost", setting: "OnlyTgt", value: "2" },
      ]);
      expect(d.differs).toEqual([
        {
          production: "MyProd",
          item: "MyItem",
          hostClass: "MyHost",
          setting: "Diff",
          sourceValue: "source-val",
          targetValue: "target-val",
        },
      ]);
      expect(d.identical).toBe(1);
      expect(sc.summary.driftCount).toBe(3);
      expect(sc.summary.identicalCount).toBe(1);
    });

    it("fetches with the resolved namespace query param and reads response.result.settings (an object, not a raw array)", async () => {
      sourceHttp.get.mockResolvedValue(envelope({ settings: [], count: 0 }));
      targetHttp.get.mockResolvedValue(envelope({ settings: [], count: 0 }));
      await envDiffTool.handler(
        { source: "source", target: "target", domains: ["defaultSettings"], namespace: "HSCUSTOM" },
        ctx,
      );
      expect(sourceHttp.get).toHaveBeenCalledTimes(1);
      expect(sourceHttp.get.mock.calls[0]?.[0]).toContain(
        "/interop/defaultsettings?namespace=HSCUSTOM",
      );
    });

    it("redacts a DIFFERING credential-ish setting as [REDACTED:differs], omitting sourceValue/targetValue -- the plaintext appears NOWHERE in the serialized result", async () => {
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({ settings: [sdsRow({ setting: "Password", value: "s3cr3t-SOURCE-99" })], count: 1 });
        }
        return envelope([]);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({ settings: [sdsRow({ setting: "Password", value: "s3cr3t-TARGET-77" })], count: 1 });
        }
        return envelope([]);
      });

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["defaultSettings"], namespace: "HSCUSTOM" },
        ctx,
      );
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.defaultSettings as DefaultSettingsDiffSC;
      expect(d.differs).toEqual([
        {
          production: "MyProd",
          item: "MyItem",
          hostClass: "MyHost",
          setting: "Password",
          redacted: "[REDACTED:differs]",
        },
      ]);
      expect(d.differs[0]).not.toHaveProperty("sourceValue");
      expect(d.differs[0]).not.toHaveProperty("targetValue");

      const serialized =
        JSON.stringify(result.structuredContent) +
        "\n" +
        result.content.map((c) => ("text" in c ? c.text : "")).join("\n");
      expect(serialized).not.toContain("s3cr3t-SOURCE-99");
      expect(serialized).not.toContain("s3cr3t-TARGET-77");
      expect(serialized).toContain("[REDACTED:differs]");
    });

    it("redacts a setting matched ONLY by a cycle-2 BROADENED term (e.g. 'AccessToken') end-to-end through the diff, not just the isCredentialSetting classifier", async () => {
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({ settings: [sdsRow({ setting: "AccessToken", value: "src-token-plaintext" })], count: 1 });
        }
        return envelope([]);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({ settings: [sdsRow({ setting: "AccessToken", value: "tgt-token-plaintext" })], count: 1 });
        }
        return envelope([]);
      });

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["defaultSettings"], namespace: "HSCUSTOM" },
        ctx,
      );
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.defaultSettings as DefaultSettingsDiffSC;
      expect(d.differs).toEqual([
        {
          production: "MyProd",
          item: "MyItem",
          hostClass: "MyHost",
          setting: "AccessToken",
          redacted: "[REDACTED:differs]",
        },
      ]);
      const serialized =
        JSON.stringify(result.structuredContent) +
        "\n" +
        result.content.map((c) => ("text" in c ? c.text : "")).join("\n");
      expect(serialized).not.toContain("src-token-plaintext");
      expect(serialized).not.toContain("tgt-token-plaintext");
    });

    it("counts an IDENTICAL credential-ish setting normally -- identical is a bare count, so there is no value to redact", async () => {
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({ settings: [sdsRow({ setting: "APIKey", value: "same-secret" })], count: 1 });
        }
        return envelope([]);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({ settings: [sdsRow({ setting: "APIKey", value: "same-secret" })], count: 1 });
        }
        return envelope([]);
      });
      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["defaultSettings"], namespace: "HSCUSTOM" },
        ctx,
      );
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.defaultSettings as DefaultSettingsDiffSC;
      expect(d.identical).toBe(1);
      expect(d.differs).toEqual([]);
      expect(JSON.stringify(result.structuredContent)).not.toContain("same-secret");
    });

    it("shows [REDACTED] (never the plaintext) for a credential-ish setting present on only one side", async () => {
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({ settings: [sdsRow({ setting: "client_secret", value: "only-src-secret" })], count: 1 });
        }
        return envelope([]);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) return envelope({ settings: [], count: 0 });
        return envelope([]);
      });
      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["defaultSettings"], namespace: "HSCUSTOM" },
        ctx,
      );
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.defaultSettings as DefaultSettingsDiffSC;
      expect(d.onlyInSource).toEqual([
        { production: "MyProd", item: "MyItem", hostClass: "MyHost", setting: "client_secret", value: "[REDACTED]" },
      ]);
      expect(JSON.stringify(result.structuredContent)).not.toContain("only-src-secret");
    });

    it("a NON-credential setting shows its real value in every bucket", async () => {
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({ settings: [sdsRow({ setting: "RetryCount", value: "only-src-plain" })], count: 1 });
        }
        return envelope([]);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) return envelope({ settings: [], count: 0 });
        return envelope([]);
      });
      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["defaultSettings"], namespace: "HSCUSTOM" },
        ctx,
      );
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.defaultSettings as DefaultSettingsDiffSC;
      expect(d.onlyInSource).toEqual([
        { production: "MyProd", item: "MyItem", hostClass: "MyHost", setting: "RetryCount", value: "only-src-plain" },
      ]);
    });
  });

  describe("isCredentialSetting (AC 27.1.2)", () => {
    it("matches case-insensitively on 'password'/'secret'/'key' substrings; does not match unrelated names", () => {
      expect(isCredentialSetting("Password")).toBe(true);
      expect(isCredentialSetting("PASSWORD")).toBe(true);
      expect(isCredentialSetting("APIKey")).toBe(true);
      expect(isCredentialSetting("client_secret")).toBe(true);
      expect(isCredentialSetting("SecretToken")).toBe(true);
      expect(isCredentialSetting("Timeout")).toBe(false);
      expect(isCredentialSetting("RetryCount")).toBe(false);
      expect(isCredentialSetting("")).toBe(false);
    });

    it("matches the BROADENED term list (cycle-2 rework, elevates CR 27.1-2): 'token'/'pwd'/'passphrase'/'credential'/'cert'/'private'/'salt'", () => {
      expect(isCredentialSetting("AccessToken")).toBe(true);
      expect(isCredentialSetting("Pwd")).toBe(true);
      expect(isCredentialSetting("Passphrase")).toBe(true);
      expect(isCredentialSetting("ClientCredential")).toBe(true);
      expect(isCredentialSetting("PrivateKey")).toBe(true);
      expect(isCredentialSetting("Salt")).toBe(true);
      // Fail-safe direction: broadening only ever redacts MORE -- the
      // original 3-term matches (and the original non-matches) are
      // unaffected by adding the new terms.
      expect(isCredentialSetting("Timeout")).toBe(false);
      expect(isCredentialSetting("RetryCount")).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // webapps (AC 27.1.1)
  // ══════════════════════════════════════════════════════════════════

  describe("webapps domain", () => {
    it("buckets onlyInSource/onlyInTarget/differs/identical keyed by name, over the curated property subset", async () => {
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/security/webapp")) {
          return envelope([
            webappRow({ name: "/api/only-src" }),
            webappRow({ name: "/api/diff", dispatchClass: "Src.Dispatch" }),
            webappRow({ name: "/api/same" }),
          ]);
        }
        return envelope([]);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/security/webapp")) {
          return envelope([
            webappRow({ name: "/api/only-tgt" }),
            webappRow({ name: "/api/diff", dispatchClass: "Tgt.Dispatch" }),
            webappRow({ name: "/api/same" }),
          ]);
        }
        return envelope([]);
      });

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["webapps"] },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.webapps as WebappsDiffSC;
      expect(d.onlyInSource).toEqual(["/api/only-src"]);
      expect(d.onlyInTarget).toEqual(["/api/only-tgt"]);
      expect(d.differs).toEqual([
        {
          name: "/api/diff",
          sourceValue: {
            dispatchClass: "Src.Dispatch",
            enabled: true,
            authEnabled: 32,
            isNameSpaceDefault: false,
            cspZenEnabled: false,
            recurse: true,
            matchRoles: "%DB_HSCUSTOM",
            namespace: "HSCUSTOM",
          },
          targetValue: {
            dispatchClass: "Tgt.Dispatch",
            enabled: true,
            authEnabled: 32,
            isNameSpaceDefault: false,
            cspZenEnabled: false,
            recurse: true,
            matchRoles: "%DB_HSCUSTOM",
            namespace: "HSCUSTOM",
          },
        },
      ]);
      expect(d.identical).toBe(1);
    });

    it("does NOT pass a namespace query parameter (webapps are instance-wide)", async () => {
      sourceHttp.get.mockResolvedValue(envelope([]));
      targetHttp.get.mockResolvedValue(envelope([]));
      await envDiffTool.handler({ source: "source", target: "target", domains: ["webapps"] }, ctx);
      expect(sourceHttp.get).toHaveBeenCalledTimes(1);
      const path = sourceHttp.get.mock.calls[0]?.[0] as string;
      expect(path).toContain("/security/webapp");
      expect(path).not.toContain("namespace=");
    });

    it("excludes 'cookiePath' from the compared subset -- a cookiePath-only difference is IDENTICAL, not differs", async () => {
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/security/webapp")) {
          return envelope([webappRow({ name: "/api/x", cookiePath: "/api/x/src/" })]);
        }
        return envelope([]);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/security/webapp")) {
          return envelope([webappRow({ name: "/api/x", cookiePath: "/api/x/tgt/" })]);
        }
        return envelope([]);
      });
      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["webapps"] },
        ctx,
      );
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.webapps as WebappsDiffSC;
      expect(d.identical).toBe(1);
      expect(d.differs).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // config (AC 27.1.1)
  // ══════════════════════════════════════════════════════════════════

  describe("config domain", () => {
    it("buckets differs/identical by property name; onlyInSource/onlyInTarget when a key is absent on one side", async () => {
      const sourceProps = { ...configProps({ Maxprocesses: 100, console: "en" }), ExtraOnSource: 1 };
      const targetProps = configProps({ Maxprocesses: 200, console: "en" });

      sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: sourceProps }));
      targetHttp.post.mockResolvedValue(envelope({ section: "config", properties: targetProps }));

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["config"] },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.config as ConfigDiffSC;
      expect(d.onlyInSource).toEqual(["ExtraOnSource"]);
      expect(d.onlyInTarget).toEqual([]);
      expect(d.differs).toEqual([{ key: "Maxprocesses", sourceValue: 100, targetValue: 200 }]);
      // 11 shared keys - 1 differing (Maxprocesses) = 10 identical.
      expect(d.identical).toBe(10);
    });

    it("counts a shared property whose value is FALSY (0 / empty string) as identical, not onlyInSource (CR 27.1 regression)", async () => {
      // Real instances commonly have `console:""` and `ijcnum:0`/`errlog:0`.
      // A truthiness-based presence check would misfile these present-on-both
      // keys as `onlyInSource` -> spurious drift between IDENTICAL instances.
      const props = configProps({ console: "", ijcnum: 0, errlog: 0 });
      sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: props }));
      targetHttp.post.mockResolvedValue(envelope({ section: "config", properties: { ...props } }));

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["config"] },
        ctx,
      );
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.config as ConfigDiffSC;
      expect(d.onlyInSource).toEqual([]);
      expect(d.onlyInTarget).toEqual([]);
      expect(d.differs).toEqual([]);
      expect(d.identical).toBe(11);
      expect(sc.summary.driftCount).toBe(0);
    });

    it("buckets a shared property that DIFFERS to a falsy target value (N -> 0) as differs, not onlyInSource (CR 27.1 regression)", async () => {
      const sourceProps = configProps({ errlog: 500 });
      const targetProps = configProps({ errlog: 0 });
      sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: sourceProps }));
      targetHttp.post.mockResolvedValue(envelope({ section: "config", properties: targetProps }));

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["config"] },
        ctx,
      );
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.config as ConfigDiffSC;
      expect(d.onlyInSource).toEqual([]);
      expect(d.differs).toEqual([{ key: "errlog", sourceValue: 500, targetValue: 0 }]);
      expect(d.identical).toBe(10);
    });

    it("POSTs {action:'get', section:'config'} with no namespace concept", async () => {
      sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps() }));
      targetHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps() }));
      await envDiffTool.handler({ source: "source", target: "target", domains: ["config"] }, ctx);
      const path = sourceHttp.post.mock.calls[0]?.[0] as string;
      const body = sourceHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(path).toContain("/system/config");
      expect(body).toEqual({ action: "get", section: "config" });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // roll-up + filter (AC 27.1.3)
  // ══════════════════════════════════════════════════════════════════

  describe("roll-up + filter", () => {
    it("domains:['mappings'] fetches ONLY mappings endpoints -- no documents/defaultSettings/webapps/config calls", async () => {
      sourceHttp.get.mockResolvedValue(envelope([]));
      targetHttp.get.mockResolvedValue(envelope([]));

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["mappings"] },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      expect(sc.domains.mappings).toBeDefined();
      expect(sc.domains.documents).toBeUndefined();
      expect(sc.domains.defaultSettings).toBeUndefined();
      expect(sc.domains.webapps).toBeUndefined();
      expect(sc.domains.config).toBeUndefined();

      // documents + config both POST; mappings/defaultSettings/webapps all GET.
      expect(sourceHttp.post).not.toHaveBeenCalled();
      expect(targetHttp.post).not.toHaveBeenCalled();
      const sourcePaths = sourceHttp.get.mock.calls.map((c) => c[0] as string);
      expect(sourcePaths.length).toBeGreaterThan(0);
      expect(sourcePaths.every((p) => p.includes("/config/mapping/"))).toBe(true);
      expect(sourcePaths.some((p) => p.includes("/interop/defaultsettings"))).toBe(false);
      expect(sourcePaths.some((p) => p.includes("/security/webapp"))).toBe(false);
    });

    it("should NOT require 'spec' when 'documents' is not among the requested domains", async () => {
      sourceHttp.get.mockResolvedValue(envelope([]));
      targetHttp.get.mockResolvedValue(envelope([]));
      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["mappings"] },
        ctx,
      );
      expect(result.isError).toBeUndefined();
    });

    it("default domains (omitted) compares the FOUR no-spec domains -- 'documents' is opt-in only (cycle-2 rework)", async () => {
      // No 'spec' passed at all -- proves the cycle-2 rework's core fix: a
      // bare `iris_env_diff(source, target)` call (the exact smoke-test
      // scenario (A) that used to abort entirely) now succeeds and returns
      // the 4 config domains cleanly, without ever touching /dev/doc/hashes.
      sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps() }));
      targetHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps() }));
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) return envelope({ settings: [], count: 0 });
        return envelope([]); // mappings, webapps
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) return envelope({ settings: [], count: 0 });
        return envelope([]);
      });

      const result = await envDiffTool.handler({ source: "source", target: "target" }, ctx);
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      expect(sc.domains.documents).toBeUndefined();
      expect(sc.domains.mappings).toBeDefined();
      expect(sc.domains.defaultSettings).toBeDefined();
      expect(sc.domains.webapps).toBeDefined();
      expect(sc.domains.config).toBeDefined();
      // No /dev/doc/hashes call at all -- every POST was the /system/config call.
      expect(
        sourceHttp.post.mock.calls.every((c) => (c[0] as string).includes("/system/config")),
      ).toBe(true);
      expect(
        targetHttp.post.mock.calls.every((c) => (c[0] as string).includes("/system/config")),
      ).toBe(true);
    });

    it("'documents' can still be requested explicitly alongside the default-set domains (opt-in, cycle-2 rework)", async () => {
      sourceHttp.post.mockImplementation(async (path: string) => {
        if (path.includes("/system/config")) {
          return envelope({ section: "config", properties: configProps() });
        }
        return envelope({ documents: [], count: 0 }); // /dev/doc/hashes
      });
      targetHttp.post.mockImplementation(async (path: string) => {
        if (path.includes("/system/config")) {
          return envelope({ section: "config", properties: configProps() });
        }
        return envelope({ documents: [], count: 0 });
      });
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) return envelope({ settings: [], count: 0 });
        return envelope([]); // mappings, webapps
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) return envelope({ settings: [], count: 0 });
        return envelope([]);
      });

      const result = await envDiffTool.handler(
        {
          source: "source",
          target: "target",
          spec: "A.cls",
          domains: ["documents", "mappings", "defaultSettings", "webapps", "config"],
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      expect(sc.domains.documents).toBeDefined();
      expect(sc.domains.mappings).toBeDefined();
      expect(sc.domains.defaultSettings).toBeDefined();
      expect(sc.domains.webapps).toBeDefined();
      expect(sc.domains.config).toBeDefined();
    });

    it("sums driftCount/identicalCount across multiple requested domains (documents + mappings)", async () => {
      sourceHttp.post.mockImplementation(async (path: string) => {
        if (path.includes("/dev/doc/hashes")) {
          return envelope({
            documents: [
              { name: "OnlySrc.cls", hash: "AAAA", timestamp: "2026-01-01 00:00:00.000" },
              { name: "Same.cls", hash: "SAME", timestamp: "2026-01-01 00:00:00.000" },
            ],
            count: 2,
          });
        }
        throw new Error(`unexpected source POST ${path}`);
      });
      targetHttp.post.mockImplementation(async (path: string) => {
        if (path.includes("/dev/doc/hashes")) {
          return envelope({
            documents: [{ name: "Same.cls", hash: "SAME", timestamp: "2026-01-01 00:00:00.000" }],
            count: 1,
          });
        }
        throw new Error(`unexpected target POST ${path}`);
      });
      sourceHttp.get.mockResolvedValue(envelope([]));
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([mappingRow({ name: "OnlyTgt", namespace: "SADEMO", database: "DB" })]);
        }
        return envelope([]);
      });

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["documents", "mappings"], spec: "A.cls" },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC & {
        domains: { documents?: { onlyInSource: string[]; onlyInTarget: string[]; identical: number } };
      };
      expect(sc.domains.documents!.onlyInSource).toEqual(["OnlySrc.cls"]);
      expect(sc.domains.documents!.identical).toBe(1);
      expect((sc.domains.mappings as MappingsDiffSC).onlyInTarget).toEqual(["global::OnlyTgt"]);
      // documents: drift=1 (onlyInSource), identical=1; mappings: drift=1 (onlyInTarget), identical=0.
      expect(sc.summary.driftCount).toBe(2);
      expect(sc.summary.identicalCount).toBe(1);
    });

    it("a mixed 'documents' + 'config' request (the combination the old refusal used to reject) now succeeds and returns both", async () => {
      sourceHttp.post.mockImplementation(async (path: string) => {
        if (path.includes("/system/config")) return envelope({ section: "config", properties: configProps() });
        return envelope({ documents: [], count: 0 });
      });
      targetHttp.post.mockImplementation(async (path: string) => {
        if (path.includes("/system/config")) return envelope({ section: "config", properties: configProps() });
        return envelope({ documents: [], count: 0 });
      });

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["documents", "config"], spec: "A.cls" },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      expect(sc.domains.documents).toBeDefined();
      expect(sc.domains.config).toBeDefined();
      expect(sc.domains.mappings).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // opportunistic hardening folds (CR 27.0-2, CR 27.0-5)
  // ══════════════════════════════════════════════════════════════════

  describe("opportunistic hardening folds", () => {
    it("CR 27.0-5: an explicit blank/whitespace-only namespace falls back to each side's own default, not a literal blank", async () => {
      sourceHttp.post.mockResolvedValue(envelope({ documents: [], count: 0 }));
      targetHttp.post.mockResolvedValue(envelope({ documents: [], count: 0 }));
      const result = await envDiffTool.handler(
        { source: "source", target: "target", spec: "A.cls", domains: ["documents"], namespace: "   " },
        ctx,
      );
      expect((sourceHttp.post.mock.calls[0]?.[1] as Record<string, unknown>).namespace).toBe("HSCUSTOM");
      expect((targetHttp.post.mock.calls[0]?.[1] as Record<string, unknown>).namespace).toBe("SADEMO");
      const sc = result.structuredContent as unknown as FullDomainsSC;
      expect(sc.source.namespace).toBe("HSCUSTOM");
      expect(sc.target.namespace).toBe("SADEMO");
    });

    it("CR 27.0-2: an IrisApiError during profile resolution is wrapped in the tool's own error envelope, not rethrown", async () => {
      ctx.resolveProfileClient = vi.fn(async (name: string) => {
        if (name === "source") throw new IrisApiError(500, [], "/api/atelier/", "establishment boom");
        if (name === "target") return targetHttp;
        throw new ProfileResolutionError(name, ["default", "source", "target"]);
      });
      const result = await envDiffTool.handler(
        { source: "source", target: "target", spec: "A.cls", domains: ["documents"] },
        ctx,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Error diffing environments");
      expect(result.content[0]?.text).toContain("establishment boom");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Story 29.3 burn-down regressions (CR 27.1-4, 27.1-7, 27.1-9, 27.1-10)
  // ══════════════════════════════════════════════════════════════════

  describe("Story 29.3 burn-down hardening", () => {
    it("CR 27.1-4: a malformed response (result: null) for defaultSettings does not throw -- fetch fails closed to an empty map", async () => {
      sourceHttp.get.mockResolvedValue(envelope(null));
      targetHttp.get.mockResolvedValue(envelope(null));
      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["defaultSettings"] },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.defaultSettings as { onlyInSource: unknown[]; onlyInTarget: unknown[]; identical: number };
      expect(d.onlyInSource).toEqual([]);
      expect(d.onlyInTarget).toEqual([]);
      expect(d.identical).toBe(0);
    });

    it("CR 27.1-4: a malformed response (result: null) for config does not throw -- fetch fails closed to an empty properties object", async () => {
      sourceHttp.post.mockResolvedValue(envelope(null));
      targetHttp.post.mockResolvedValue(envelope(null));
      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["config"] },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.config as ConfigDiffSC;
      expect(d.onlyInSource).toEqual([]);
      expect(d.onlyInTarget).toEqual([]);
      expect(d.identical).toBe(0);
    });

    it("CR 27.1-7: a mapping row missing 'database' (per-row Config.Map*.Get failure) is not a type-lie and matches an identical missing-database row on the other side (never a spurious differs)", async () => {
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([{ name: "Partial", type: "global", namespace: "HSCUSTOM" }]);
        }
        return envelope([]);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([{ name: "Partial", type: "global", namespace: "HSCUSTOM" }]);
        }
        return envelope([]);
      });
      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["mappings"], namespace: "HSCUSTOM" },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.mappings as MappingsDiffSC;
      expect(d.differs).toEqual([]);
      expect(d.identical).toBe(1);
    });

    it("CR 27.1-7: a missing 'database' (undefined) normalizes the same as an empty-string 'database' -- mirrors the collation/lockDatabase missing-value handling, never a spurious differs", async () => {
      // Source's row omits `database` entirely (Get failed); target's row
      // carries an explicit empty string. `mappingValuesEqual` normalizes
      // both to "" (mirroring collation/lockDatabase) so they compare equal.
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([{ name: "Partial", type: "global", namespace: "HSCUSTOM" }]);
        }
        return envelope([]);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([
            { name: "Partial", type: "global", namespace: "HSCUSTOM", database: "" },
          ]);
        }
        return envelope([]);
      });
      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["mappings"], namespace: "HSCUSTOM" },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      const d = sc.domains.mappings as MappingsDiffSC;
      expect(d.differs).toEqual([]);
      expect(d.identical).toBe(1);
    });

    it("CR 27.1-9: a raw-args call with domains:[] (bypassing the Zod .min(1) gate) falls back to the default domain set, not a vacuous no-op diff", async () => {
      sourceHttp.get.mockResolvedValue(envelope([]));
      targetHttp.get.mockResolvedValue(envelope([]));
      sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps() }));
      targetHttp.post.mockResolvedValue(envelope({ section: "config", properties: configProps() }));

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: [] } as unknown as Record<string, unknown>,
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as unknown as FullDomainsSC;
      // The default domain set (mappings/defaultSettings/webapps/config) ran,
      // NOT a vacuous zero-domain diff.
      expect(Object.keys(sc.domains).length).toBeGreaterThan(0);
      expect(sc.domains.mappings).toBeDefined();
    });

    it("CR 27.1-10: the config domain's onlyInTarget render carries the 'informational -- NOT a deletion signal' annotation (matching the other four domains)", async () => {
      const sourceProps = configProps();
      const targetProps = { ...configProps(), ExtraOnTarget: 1 };
      sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: sourceProps }));
      targetHttp.post.mockResolvedValue(envelope({ section: "config", properties: targetProps }));

      const result = await envDiffTool.handler(
        { source: "source", target: "target", domains: ["config"] },
        ctx,
      );
      expect(result.content[0]?.text).toContain(
        "onlyInTarget (1, informational -- NOT a deletion signal): ExtraOnTarget",
      );
    });
  });
});
