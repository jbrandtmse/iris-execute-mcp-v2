/**
 * Story 27.3 — unit tests for `iris_env_promote`'s `execute` action (AC
 * 27.3.1/27.3.2/27.3.3).
 *
 * Covers, per the story's Task 5:
 *  - ALL FOUR gate refusals (Gate 1 confirm / Gate 2 steps allowlist / Gate 3
 *    plan-hash freshness / Gate 4 target-profile governance), each asserting
 *    ZERO write calls (and, where applicable, that NO profile client is even
 *    resolved -- the gates run BEFORE any IRIS connection is made);
 *  - per-step execution in plan order, restricted to the allowlist;
 *  - halt-on-first-error (a mid-list failure marks later allowlisted steps
 *    "skipped", earlier ones "completed", `isError:true`, and NO further
 *    writes are attempted);
 *  - source re-fetch (a write body carries the LIVE value re-fetched from
 *    `source`, sent to the `target` client/host -- never a value embedded in
 *    the plan/diff);
 *  - credential redaction (a credential System Default Settings value is
 *    re-fetched live and forwarded to target WITHOUT ever appearing in this
 *    tool's own output);
 *  - the `updateMapping` delete+create pair and the batched `documents`
 *    put+compile path (including a put failure and a compile failure).
 *
 * `plan`/`diff` fixtures are produced by calling the REAL `plan` action first
 * (a pure transform -- no IRIS calls) so the `planHash`/`steps` shape used
 * for `execute` is guaranteed genuine, never hand-computed.
 *
 * `ctx.resolveProfileClient` is overridden per test with a `vi.fn()` mapping
 * profile name -> its own mock `IrisHttpClient` (mirrors `env-diff.test.ts` /
 * `env-diff-domains.test.ts`). Gate 4 tests manipulate `process.env.IRIS_GOVERNANCE`
 * directly (the handler's Gate 4 reads it via `parseGovernanceConfig()`), restored
 * in `afterEach`.
 *
 * Mocked-HTTP only, no live IRIS. Not named `*.integration.test.ts` (Rule #21)
 * -- runs in the default suite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError, ProfileResolutionError, loadGovernanceFile } from "@iris-mcp/shared";
import { envPromoteTool } from "../tools/env-promote.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── shared fixture helpers ───────────────────────────────────────────

/** Atelier version-negotiation response body (major 8). */
function versionResponse(): unknown {
  return envelope({ content: { api: 8 } });
}

interface ExecutedStepSC {
  index: number;
  domain: string;
  operation: string;
  subject: string;
  status: "completed" | "failed" | "skipped";
  error?: string;
}
interface ExecuteResultSC {
  source: { profile: string; namespace: string };
  target: { profile: string; namespace: string };
  planHash: string;
  executed: ExecutedStepSC[];
  summary: { completed: number; failed: number; skipped: number };
}
interface PlanResultSC {
  planHash: string;
  steps: Array<{ index: number; domain: string; operation: string; subject: string }>;
}

/** Generate a REAL plan (steps + planHash) from a diff via a throwaway ctx (plan never touches ctx.http). */
async function buildPlan(diff: Record<string, unknown>): Promise<PlanResultSC> {
  const planCtx = createMockCtx();
  const result = await envPromoteTool.handler({ action: "plan", source: "source", target: "target", diff }, planCtx);
  return result.structuredContent as unknown as PlanResultSC;
}

/** A diff with exactly ONE `onlyInSource` entry in each of mappings/defaultSettings/webapps/config (NO documents), so `plan` emits exactly 4 steps, indices 1-4 in that domain order. */
function fourStepDiff(): Record<string, unknown> {
  return {
    source: { profile: "source", namespace: "HSCUSTOM" },
    target: { profile: "target", namespace: "SADEMO" },
    domains: {
      mappings: {
        // Cycle-2 HIGH fix (2026-07-11): key is `type::name` -- no namespace segment.
        onlyInSource: ["global::NewGlobal"],
        onlyInTarget: [],
        differs: [],
        identical: 0,
      },
      defaultSettings: {
        onlyInSource: [
          { production: "MyProd", item: "MyItem", hostClass: "MyHost", setting: "Timeout", value: "30" },
        ],
        onlyInTarget: [],
        differs: [],
        identical: 0,
      },
      webapps: {
        onlyInSource: ["/api/new"],
        onlyInTarget: [],
        differs: [],
        identical: 0,
      },
      config: {
        onlyInSource: ["Maxprocesses"],
        onlyInTarget: [],
        differs: [],
        identical: 0,
      },
    },
    summary: { driftCount: 4, identicalCount: 0 },
  };
}

describe("iris_env_promote:execute", () => {
  let sourceHttp: ReturnType<typeof createMockHttp>;
  let targetHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;
  const originalGovernance = process.env.IRIS_GOVERNANCE;

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

  // Gate 4 reads `process.env.IRIS_GOVERNANCE` directly (mirrors
  // `McpServerBase.start()`'s own parse). Restoring it after EVERY test here
  // (not just the ones that set it) is more robust than scattered
  // try/finally blocks -- no test can leak governance state into a sibling.
  // (The FILE channel is different: since Story 32.1 / deferred item 32-0-1
  // Gate 4 reads the STARTUP SNAPSHOT via `ctx.governanceFileConfig`, never
  // the process env or the file itself -- tests thread it through the ctx.)
  afterEach(() => {
    if (originalGovernance === undefined) delete process.env.IRIS_GOVERNANCE;
    else process.env.IRIS_GOVERNANCE = originalGovernance;
  });

  // ══════════════════════════════════════════════════════════════════
  // The FOUR refuse-before-any-write gates (AC 27.3.2)
  // ══════════════════════════════════════════════════════════════════

  describe("the four gates -- each refuses mutating NOTHING", () => {
    it("Gate 1 (confirm): missing 'confirm' refuses, resolving NO profile client at all", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [1] },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("confirm");
      expect(result.structuredContent).toBeUndefined();
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
      expect(sourceHttp.get).not.toHaveBeenCalled();
      expect(targetHttp.post).not.toHaveBeenCalled();
    });

    it("Gate 1 (confirm): 'confirm: false' also refuses (not just omitted)", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [1], confirm: false },
        ctx,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("confirm");
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
    });

    it("Gate 2 (steps allowlist): missing 'steps' refuses, resolving NO profile client", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("steps");
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
      expect(targetHttp.post).not.toHaveBeenCalled();
    });

    it("Gate 2 (steps allowlist): an EMPTY 'steps' array refuses", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [], confirm: true },
        ctx,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("steps");
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
    });

    it("Gate 2 (steps allowlist): an out-of-range index (not present in plan.steps) refuses, naming the index, resolving NO client", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [1, 99], confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("99");
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
      expect(targetHttp.post).not.toHaveBeenCalled();
    });

    it("Gate 3 (plan-hash freshness): 'diff' omitted refuses, resolving NO client", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", plan, steps: [1], confirm: true },
        ctx,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("diff");
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
    });

    it("Gate 3 (plan-hash freshness): a 'diff' whose hash != plan.planHash (stale plan) refuses, naming it, resolving NO client", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      // Mutate the diff AFTER the plan was generated -- planHash no longer matches.
      const staleDiff = { ...diff, summary: { driftCount: 999, identicalCount: 0 } };

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff: staleDiff, plan, steps: [1], confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text.toLowerCase()).toContain("stale plan");
      expect(result.structuredContent).toBeUndefined();
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
      expect(targetHttp.post).not.toHaveBeenCalled();
    });

    it("Gate 4 (target-profile governance): the TARGET profile's governance disabling a used write key refuses, NAMING the key, resolving NO client", async () => {
      const originalGovernance = process.env.IRIS_GOVERNANCE;
      process.env.IRIS_GOVERNANCE = JSON.stringify({
        profiles: { target: { "iris_config_manage:set": false } },
      });
      try {
        const diff = fourStepDiff();
        const plan = await buildPlan(diff);
        const configStep = plan.steps.find((s) => s.operation === "setConfig");
        expect(configStep).toBeDefined();

        const result = await envPromoteTool.handler(
          {
            action: "execute",
            source: "source",
            target: "target",
            diff,
            plan,
            steps: [configStep!.index],
            confirm: true,
          },
          ctx,
        );

        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain("iris_config_manage:set");
        expect(result.content[0]?.text).toContain("target");
        expect(result.structuredContent).toBeUndefined();
        expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
        expect(targetHttp.post).not.toHaveBeenCalled();
      } finally {
        if (originalGovernance === undefined) delete process.env.IRIS_GOVERNANCE;
        else process.env.IRIS_GOVERNANCE = originalGovernance;
      }
    });

    it("Gate 4 honors the FILE channel (Story 32.0/32.1): a write key disabled ONLY in the startup-snapshot file config refuses, resolving NO client", async () => {
      // Gate 4 is the ONLY governance check on the write-family keys (execute
      // re-fetches via profile clients directly, never through handleToolCall),
      // so a file-layer disable must be honored here -- this is the regression
      // proof that Gate 4 evaluates the same 6-layer cascade as the D5 gate.
      // Since Story 32.1 (32-0-1) the file config reaches Gate 4 as the
      // STARTUP SNAPSHOT via ctx.governanceFileConfig -- built here with the
      // REAL loader, so the file -> snapshot -> Gate 4 wiring stays in the loop.
      const dir = mkdtempSync(join(tmpdir(), "iris-gov-gate4-"));
      const filePath = join(dir, "governance.json");
      writeFileSync(
        filePath,
        JSON.stringify({
          profiles: { target: { "iris_config_manage:set": false } },
        }),
        "utf8",
      );
      const snapshot = loadGovernanceFile({ IRIS_GOVERNANCE_FILE: filePath });
      expect(snapshot).toBeDefined();
      if (snapshot !== undefined) ctx.governanceFileConfig = snapshot;
      try {
        const diff = fourStepDiff();
        const plan = await buildPlan(diff);
        const configStep = plan.steps.find((s) => s.operation === "setConfig");
        expect(configStep).toBeDefined();

        const result = await envPromoteTool.handler(
          {
            action: "execute",
            source: "source",
            target: "target",
            diff,
            plan,
            steps: [configStep!.index],
            confirm: true,
          },
          ctx,
        );

        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain("iris_config_manage:set");
        expect(result.content[0]?.text).toContain("target");
        expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
        expect(targetHttp.post).not.toHaveBeenCalled();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("Gate 4 reads the STARTUP SNAPSHOT, never re-reads the file (32-0-1 TERMINAL): a file edited after startup does NOT change the verdict", async () => {
      // The documented contract is "read once at startup; restart to apply
      // (no hot-reload in v1)" -- uniform across the D5 gate, the resource,
      // iris_server_profiles, AND Gate 4. The defect being pinned: Gate 4
      // used to call loadGovernanceFile() per execute call, honoring a
      // mid-session edit at exactly this one enforcement point.
      //
      // Setup: the startup snapshot DISABLES the key; the on-disk file is
      // then REWRITTEN to re-enable it. The verdict must STILL refuse -- a
      // per-call re-read would now allow and proceed to resolve clients.
      // (Mutation check, run during dev: restoring `loadGovernanceFile()`
      // in Gate 4 turns this test red.)
      const dir = mkdtempSync(join(tmpdir(), "iris-gov-gate4-snapshot-"));
      const filePath = join(dir, "governance.json");
      writeFileSync(
        filePath,
        JSON.stringify({
          profiles: { target: { "iris_config_manage:set": false } },
        }),
        "utf8",
      );
      // "Startup": the snapshot is parsed ONCE via the real loader…
      const snapshot = loadGovernanceFile({ IRIS_GOVERNANCE_FILE: filePath });
      expect(snapshot).toBeDefined();
      if (snapshot !== undefined) ctx.governanceFileConfig = snapshot;
      // …and a mid-session edit RE-ENABLES the key on disk (also proves Gate
      // 4 performs zero filesystem access of its own: a re-read would parse
      // this NEW content, or throw if it were malformed).
      writeFileSync(filePath, JSON.stringify({}), "utf8");
      try {
        const diff = fourStepDiff();
        const plan = await buildPlan(diff);
        const configStep = plan.steps.find((s) => s.operation === "setConfig");
        expect(configStep).toBeDefined();

        const result = await envPromoteTool.handler(
          {
            action: "execute",
            source: "source",
            target: "target",
            diff,
            plan,
            steps: [configStep!.index],
            confirm: true,
          },
          ctx,
        );

        // Still refused per the snapshot: the mid-session edit is honored
        // NOWHERE until restart.
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain("Gate 4");
        expect(result.content[0]?.text).toContain("iris_config_manage:set");
        expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
        expect(targetHttp.post).not.toHaveBeenCalled();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("Gate 4 (target-profile governance): only checks keys for domains ACTUALLY allowlisted -- a disabled config key does NOT block a mappings-only execute", async () => {
      const originalGovernance = process.env.IRIS_GOVERNANCE;
      process.env.IRIS_GOVERNANCE = JSON.stringify({
        profiles: { target: { "iris_config_manage:set": false } },
      });
      try {
        const diff = fourStepDiff();
        const plan = await buildPlan(diff);
        const mappingStep = plan.steps.find((s) => s.operation === "createMapping")!;

        sourceHttp.get.mockImplementation(async (path: string) => {
          if (path.includes("/config/mapping/global")) {
            return envelope([{ name: "NewGlobal", type: "global", namespace: "HSCUSTOM", database: "IRISDB" }]);
          }
          return envelope([]);
        });
        targetHttp.post.mockResolvedValue(envelope({ success: true }));

        const result = await envPromoteTool.handler(
          {
            action: "execute",
            source: "source",
            target: "target",
            diff,
            plan,
            steps: [mappingStep.index],
            confirm: true,
          },
          ctx,
        );

        expect(result.isError).toBeFalsy();
        const sc = result.structuredContent as unknown as ExecuteResultSC;
        expect(sc.summary).toEqual({ completed: 1, failed: 0, skipped: 0 });
      } finally {
        if (originalGovernance === undefined) delete process.env.IRIS_GOVERNANCE;
        else process.env.IRIS_GOVERNANCE = originalGovernance;
      }
    });

    it("an explicit governance ENABLE at the target profile still permits execution (Gate 4 is not fail-closed by default)", async () => {
      const originalGovernance = process.env.IRIS_GOVERNANCE;
      process.env.IRIS_GOVERNANCE = JSON.stringify({
        profiles: { target: { "iris_config_manage:set": true } },
      });
      try {
        const diff = fourStepDiff();
        const plan = await buildPlan(diff);
        const configStep = plan.steps.find((s) => s.operation === "setConfig")!;

        sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: { Maxprocesses: 500 } }));
        targetHttp.post.mockResolvedValue(envelope({ success: true }));

        const result = await envPromoteTool.handler(
          {
            action: "execute",
            source: "source",
            target: "target",
            diff,
            plan,
            steps: [configStep.index],
            confirm: true,
          },
          ctx,
        );
        expect(result.isError).toBeFalsy();
      } finally {
        if (originalGovernance === undefined) delete process.env.IRIS_GOVERNANCE;
        else process.env.IRIS_GOVERNANCE = originalGovernance;
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Per-step execution: allowlist subset, plan order, halt-on-first-error
  // ══════════════════════════════════════════════════════════════════

  describe("per-step execution (AC 27.3.1)", () => {
    it("allowlisting a SUBSET of steps runs ONLY those, in plan order -- unlisted steps never appear in 'executed' and their endpoints are never called", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      const mappingStep = plan.steps.find((s) => s.operation === "createMapping")!;
      const webappStep = plan.steps.find((s) => s.operation === "modifyWebApp")!;

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([{ name: "NewGlobal", type: "global", namespace: "HSCUSTOM", database: "IRISDB" }]);
        }
        if (path.includes("/security/webapp")) {
          return envelope([
            {
              name: "/api/new",
              namespace: "HSCUSTOM",
              dispatchClass: "My.Dispatch",
              description: "",
              enabled: true,
              authEnabled: 32,
              isNameSpaceDefault: false,
              cspZenEnabled: false,
              recurse: false,
              matchRoles: "",
              cookiePath: "/x",
            },
          ]);
        }
        return envelope([]);
      });
      targetHttp.post.mockResolvedValue(envelope({ success: true }));

      const result = await envPromoteTool.handler(
        {
          action: "execute",
          source: "source",
          target: "target",
          diff,
          plan,
          steps: [mappingStep.index, webappStep.index],
          confirm: true,
        },
        ctx,
      );

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as unknown as ExecuteResultSC;
      expect(sc.executed.map((e) => e.index)).toEqual([mappingStep.index, webappStep.index].sort((a, b) => a - b));
      expect(sc.executed.every((e) => e.status === "completed")).toBe(true);
      expect(sc.summary).toEqual({ completed: 2, failed: 0, skipped: 0 });

      // defaultSettings/config endpoints were never touched (not allowlisted).
      const targetPaths = targetHttp.post.mock.calls.map((c) => c[0] as string);
      expect(targetPaths.some((p) => p.includes("/interop/defaultsettings"))).toBe(false);
      expect(targetPaths.some((p) => p.includes("/system/config"))).toBe(false);
      expect(sourceHttp.post).not.toHaveBeenCalled(); // fetchConfig (POST) never invoked
    });

    it("a mid-list step failure HALTS: that step is 'failed', later allowlisted steps are 'skipped', earlier ones 'completed', isError:true, and NO further writes happen", async () => {
      // 'iris_default_settings_manage:set' is a post-foundation write key
      // (Rule #28 default-disabled) -- enable it for 'target' so Gate 4
      // passes and this test reaches the per-step dispatch it's actually
      // exercising (Gate 4 itself is covered by its own dedicated tests above).
      // The top-level `afterEach` restores IRIS_GOVERNANCE unconditionally.
      process.env.IRIS_GOVERNANCE = JSON.stringify({
        profiles: { target: { "iris_default_settings_manage:set": true } },
      });

      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      const mappingStep = plan.steps.find((s) => s.operation === "createMapping")!;
      const sdsStep = plan.steps.find((s) => s.operation === "setDefaultSetting")!;
      const webappStep = plan.steps.find((s) => s.operation === "modifyWebApp")!;
      const configStep = plan.steps.find((s) => s.operation === "setConfig")!;

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([{ name: "NewGlobal", type: "global", namespace: "HSCUSTOM", database: "IRISDB" }]);
        }
        if (path.includes("/interop/defaultsettings")) {
          return envelope({
            settings: [{ id: 1, production: "MyProd", item: "MyItem", hostClass: "MyHost", setting: "Timeout", value: "30" }],
            count: 1,
          });
        }
        return envelope([]);
      });
      // mapping create (1st write) succeeds; defaultSettings set (2nd write) FAILS;
      // webapp modify (3rd, would-be write) and config set (4th) never happen.
      targetHttp.post
        .mockResolvedValueOnce(envelope({ success: true }))
        .mockRejectedValueOnce(new IrisApiError(500, [], "/api/executemcp/v2/interop/defaultsettings", "IRIS returned HTTP 500. Server error."));

      const result = await envPromoteTool.handler(
        {
          action: "execute",
          source: "source",
          target: "target",
          diff,
          plan,
          steps: [mappingStep.index, sdsStep.index, webappStep.index, configStep.index],
          confirm: true,
        },
        ctx,
      );

      expect(result.isError).toBe(true);
      const sc = result.structuredContent as unknown as ExecuteResultSC;
      const byIndex = new Map(sc.executed.map((e) => [e.index, e]));
      expect(byIndex.get(mappingStep.index)?.status).toBe("completed");
      expect(byIndex.get(sdsStep.index)?.status).toBe("failed");
      expect(byIndex.get(sdsStep.index)?.error).toContain("500");
      expect(byIndex.get(webappStep.index)?.status).toBe("skipped");
      expect(byIndex.get(configStep.index)?.status).toBe("skipped");
      expect(sc.summary).toEqual({ completed: 1, failed: 1, skipped: 2 });

      // Exactly 2 target writes attempted (mapping create + the failing defaultSettings
      // set) -- webapp modify and config set NEVER dispatched after the halt.
      expect(targetHttp.post).toHaveBeenCalledTimes(2);
      const targetPaths = targetHttp.post.mock.calls.map((c) => c[0] as string);
      expect(targetPaths.some((p) => p.includes("/security/webapp"))).toBe(false);
      expect(targetPaths.some((p) => p.includes("/system/config"))).toBe(false);
      expect(sourceHttp.post).not.toHaveBeenCalled(); // fetchConfig (webapp/config re-fetch) never reached
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Source re-fetch: writes carry the LIVE source value, sent to TARGET
  // ══════════════════════════════════════════════════════════════════

  describe("source re-fetch -- the plan carries no write data; execute re-fetches live from source (Rule #47)", () => {
    it("a mapping createMapping step writes the LIVE source database/collation to the TARGET client/host, in the TARGET namespace", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      const mappingStep = plan.steps.find((s) => s.operation === "createMapping")!;

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([
            { name: "NewGlobal", type: "global", namespace: "HSCUSTOM", database: "LIVEDB", collation: "5" },
          ]);
        }
        return envelope([]);
      });
      targetHttp.post.mockResolvedValue(envelope({ success: true }));

      await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [mappingStep.index], confirm: true },
        ctx,
      );

      expect(targetHttp.post).toHaveBeenCalledTimes(1);
      const [path, body] = targetHttp.post.mock.calls[0] as [string, Record<string, unknown>];
      expect(path).toContain("/config/mapping/global");
      expect(body).toEqual({
        action: "create",
        namespace: "SADEMO", // target's OWN namespace, not source's
        name: "NewGlobal",
        database: "LIVEDB", // the LIVE re-fetched value, not anything from the diff/plan
        collation: "5",
      });
      // The read came from the SOURCE client, scoped to the SOURCE namespace
      // (a query param on this custom-REST route, not a path segment).
      const sourcePath = sourceHttp.get.mock.calls[0]?.[0] as string;
      expect(sourcePath).toContain("namespace=HSCUSTOM");
    });

    it("a setConfig step re-fetches the config property from SOURCE (POST) and writes it to TARGET (POST) carrying the source value", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      const configStep = plan.steps.find((s) => s.operation === "setConfig")!;

      sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: { Maxprocesses: 777 } }));
      targetHttp.post.mockResolvedValue(envelope({ success: true }));

      await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [configStep.index], confirm: true },
        ctx,
      );

      expect(sourceHttp.post).toHaveBeenCalledTimes(1);
      expect(sourceHttp.post.mock.calls[0]?.[1]).toEqual({ action: "get", section: "config" });
      expect(targetHttp.post).toHaveBeenCalledTimes(1);
      const [path, body] = targetHttp.post.mock.calls[0] as [string, Record<string, unknown>];
      expect(path).toContain("/system/config");
      expect(body).toEqual({ action: "set", section: "config", properties: { Maxprocesses: 777 } });
    });

    it("re-fetches the source mapping via the FRESH execute-time source namespace; the subject itself carries NO namespace at all (cycle-2 HIGH fix, 2026-07-11 -- 'type::name' only, never 'type::namespace::name')", async () => {
      // Cycle-2 HIGH fix: env-diff.ts's `mappingKey` no longer embeds a
      // per-side namespace segment (it made the SAME logical mapping key
      // differently per side whenever source/target resolved to DIFFERENT
      // namespaces, so a genuinely-identical mapping could never match and
      // `promote` could never reach "clean" -- the lead capstone's live
      // finding). The re-fetch below is still namespace-SCOPED (via the
      // execute-time-resolved `srcNs`, asserted on the request path), just
      // never via a namespace segment embedded in the subject string.
      const diff = {
        source: { profile: "source", namespace: "HSCUSTOM" },
        target: { profile: "target", namespace: "SADEMO" },
        domains: {
          mappings: {
            onlyInSource: ["global::NewGlobal"],
            onlyInTarget: [],
            differs: [],
            identical: 0,
          },
        },
        summary: { driftCount: 1, identicalCount: 0 },
      };
      const plan = await buildPlan(diff);
      const mappingStep = plan.steps[0]!;
      expect(mappingStep.subject).toBe("global::NewGlobal");

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          // Only responds correctly when queried with the EXECUTE-TIME
          // resolved source namespace ("HSCUSTOM") -- proving the re-fetch is
          // scoped by `srcNs`, not by anything embedded in the subject.
          expect(path).toContain("namespace=HSCUSTOM");
          return envelope([{ name: "NewGlobal", type: "global", namespace: "HSCUSTOM", database: "LIVEDB" }]);
        }
        return envelope([]);
      });
      targetHttp.post.mockResolvedValue(envelope({ success: true }));

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [mappingStep.index], confirm: true },
        ctx,
      );

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as unknown as ExecuteResultSC;
      expect(sc.executed[0]?.status).toBe("completed");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Credential redaction: live value forwarded to target, NEVER in output
  // ══════════════════════════════════════════════════════════════════

  describe("credential redaction (a live secret is forwarded to target but never rendered in this tool's output)", () => {
    it("a credential-named SDS onlyInSource step writes the LIVE secret to target, but the secret never appears in content[].text or structuredContent", async () => {
      // 'iris_default_settings_manage:set' is a post-foundation write key
      // (Rule #28 default-disabled) -- enable it for 'target' so Gate 4
      // passes (Gate 4 itself is covered by its own dedicated tests above).
      process.env.IRIS_GOVERNANCE = JSON.stringify({
        profiles: { target: { "iris_default_settings_manage:set": true } },
      });
      const secret = "zQ9-LIVE-SUPER-SECRET-4471";
      const diff = {
        source: { profile: "source", namespace: "HSCUSTOM" },
        target: { profile: "target", namespace: "SADEMO" },
        domains: {
          defaultSettings: {
            // iris_env_diff already redacts a credential-named row's `value`
            // to the literal "[REDACTED]" by the time it reaches `diff` --
            // execute must NEVER read that; it re-fetches the TRUE value live.
            onlyInSource: [
              { production: "P", item: "I", hostClass: "H", setting: "AccessToken", value: "[REDACTED]" },
            ],
            onlyInTarget: [],
            differs: [],
            identical: 0,
          },
        },
        summary: { driftCount: 1, identicalCount: 0 },
      };
      const plan = await buildPlan(diff);
      expect(plan.steps[0]?.subject).toBe("P||I||H||AccessToken");

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({
            settings: [{ id: 1, production: "P", item: "I", hostClass: "H", setting: "AccessToken", value: secret }],
            count: 1,
          });
        }
        return envelope([]);
      });
      targetHttp.post.mockResolvedValue(envelope({ success: true }));

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [plan.steps[0]!.index], confirm: true },
        ctx,
      );

      expect(result.isError).toBeFalsy();

      // The write body DOES carry the live secret -- it was genuinely forwarded.
      expect(targetHttp.post).toHaveBeenCalledTimes(1);
      const [, body] = targetHttp.post.mock.calls[0] as [string, Record<string, unknown>];
      expect(body.value).toBe(secret);

      // But the tool's OWN output (text + structuredContent) never renders it.
      const serialized = JSON.stringify(result.structuredContent) + "\n" + result.content.map((c) => c.text).join("\n");
      expect(serialized).not.toContain(secret);
    });

    it("even when the target WRITE FAILS with an IRIS error that ECHOES the secret value, the secret is scrubbed from the per-step error (never in output)", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({
        profiles: { target: { "iris_default_settings_manage:set": true } },
      });
      const secret = "zQ9-LIVE-SUPER-SECRET-4471";
      const diff = {
        source: { profile: "source", namespace: "HSCUSTOM" },
        target: { profile: "target", namespace: "SADEMO" },
        domains: {
          defaultSettings: {
            onlyInSource: [{ production: "P", item: "I", hostClass: "H", setting: "AccessToken", value: "[REDACTED]" }],
            onlyInTarget: [],
            differs: [],
            identical: 0,
          },
        },
        summary: { driftCount: 1, identicalCount: 0 },
      };
      const plan = await buildPlan(diff);

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({
            settings: [{ id: 1, production: "P", item: "I", hostClass: "H", setting: "AccessToken", value: secret }],
            count: 1,
          });
        }
        return envelope([]);
      });
      // The TARGET write rejects with an IRIS error whose text embeds the value
      // (a pathological-but-possible validation echo) -- the scrub must strip it.
      targetHttp.post.mockRejectedValue(
        new IrisApiError(500, [], "/api/executemcp/v2/interop/defaultsettings", `ERROR #5001: value '${secret}' rejected`),
      );

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [plan.steps[0]!.index], confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      const sc = result.structuredContent as unknown as ExecuteResultSC;
      expect(sc.executed[0]?.status).toBe("failed");
      // The error is surfaced (diagnostic preserved) but the secret is redacted.
      expect(sc.executed[0]?.error).toContain("[REDACTED]");
      const serialized = JSON.stringify(result.structuredContent) + "\n" + result.content.map((c) => c.text).join("\n");
      expect(serialized).not.toContain(secret);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Mappings: updateMapping (delete + create, no target-only deletion)
  // ══════════════════════════════════════════════════════════════════

  describe("mappings updateMapping -- delete then create (Config.cls has no update)", () => {
    it("issues delete THEN create to the target for the SAME name, using the live re-fetched source value; never touches an onlyInTarget name", async () => {
      const diff = {
        source: { profile: "source", namespace: "HSCUSTOM" },
        target: { profile: "target", namespace: "SADEMO" },
        domains: {
          mappings: {
            onlyInSource: [],
            onlyInTarget: ["global::TargetOnlyGlobal"],
            differs: [
              {
                type: "global",
                namespace: "HSCUSTOM",
                name: "ChangedGlobal",
                sourceValue: { database: "OLD" },
                targetValue: { database: "STALE" },
              },
            ],
            identical: 0,
          },
        },
        summary: { driftCount: 2, identicalCount: 0 },
      };
      const plan = await buildPlan(diff);
      const updateStep = plan.steps.find((s) => s.operation === "updateMapping")!;
      expect(updateStep.subject).toBe("global::ChangedGlobal");

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([{ name: "ChangedGlobal", type: "global", namespace: "HSCUSTOM", database: "LIVEDB" }]);
        }
        return envelope([]);
      });
      targetHttp.post.mockResolvedValue(envelope({ success: true }));

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [updateStep.index], confirm: true },
        ctx,
      );

      expect(result.isError).toBeFalsy();
      expect(targetHttp.post).toHaveBeenCalledTimes(2);
      const [deletePath, deleteBody] = targetHttp.post.mock.calls[0] as [string, Record<string, unknown>];
      const [createPath, createBody] = targetHttp.post.mock.calls[1] as [string, Record<string, unknown>];
      expect(deletePath).toContain("/config/mapping/global");
      expect(deleteBody).toEqual({ action: "delete", namespace: "SADEMO", name: "ChangedGlobal" });
      expect(createPath).toContain("/config/mapping/global");
      expect(createBody).toEqual({ action: "create", namespace: "SADEMO", name: "ChangedGlobal", database: "LIVEDB" });

      // The onlyInTarget name never appears in ANY write body -- execute never
      // deletes a target-only item (it is a warning in `plan`, never a step).
      const allBodies = targetHttp.post.mock.calls.map((c) => JSON.stringify(c[1]));
      expect(allBodies.some((b) => b.includes("TargetOnlyGlobal"))).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // documents: put sequential, compile ONE batched call
  // ══════════════════════════════════════════════════════════════════

  describe("documents -- put sequential, compile ONE batched call", () => {
    function documentsDiff(): Record<string, unknown> {
      return {
        source: { profile: "source", namespace: "HSCUSTOM" },
        target: { profile: "target", namespace: "SADEMO" },
        domains: {
          documents: {
            onlyInSource: ["New.cls"],
            onlyInTarget: [],
            differs: [
              { name: "Changed.cls", sourceHash: "a".repeat(64), targetHash: "b".repeat(64), sourceTs: "t1", targetTs: "t2" },
            ],
            identical: 0,
          },
        },
        summary: { driftCount: 2, identicalCount: 0 },
      };
    }

    it("PUTs each doc (source GET -> target PUT) then issues ONE batched compile call for both, both steps 'completed'", async () => {
      const diff = documentsDiff();
      const plan = await buildPlan(diff);
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps.every((s) => s.operation === "putAndCompile")).toBe(true);

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return versionResponse();
        if (path.includes("doc/New.cls")) return envelope({ name: "New.cls", content: ["Class New {}"] });
        if (path.includes("doc/Changed.cls")) return envelope({ name: "Changed.cls", content: ["Class Changed {}"] });
        throw new Error(`unexpected sourceHttp.get ${path}`);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return versionResponse();
        throw new Error(`unexpected targetHttp.get ${path}`);
      });
      targetHttp.put.mockResolvedValue(envelope({}));
      targetHttp.post.mockImplementation(async (path: string, body: unknown) => {
        if (path.includes("/action/compile")) {
          const names = body as string[];
          return envelope({ content: names.map((name) => ({ name, errors: [] })) });
        }
        throw new Error(`unexpected targetHttp.post ${path}`);
      });

      const result = await envPromoteTool.handler(
        {
          action: "execute",
          source: "source",
          target: "target",
          diff,
          plan,
          steps: plan.steps.map((s) => s.index),
          confirm: true,
        },
        ctx,
      );

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as unknown as ExecuteResultSC;
      expect(sc.executed.every((e) => e.status === "completed")).toBe(true);
      expect(sc.summary).toEqual({ completed: 2, failed: 0, skipped: 0 });

      // Exactly ONE batched compile call, carrying BOTH doc names.
      const compileCalls = targetHttp.post.mock.calls.filter((c) => (c[0] as string).includes("/action/compile"));
      expect(compileCalls).toHaveLength(1);
      expect((compileCalls[0]?.[0] as string)).toContain("flags=cuk");
      expect(compileCalls[0]?.[1]).toEqual(expect.arrayContaining(["New.cls", "Changed.cls"]));

      // Each PUT carried the content GET from source.
      expect(targetHttp.put).toHaveBeenCalledTimes(2);
      const putBodies = targetHttp.put.mock.calls.map((c) => c[1] as Record<string, unknown>);
      expect(putBodies.some((b) => JSON.stringify(b.content).includes("Class New"))).toBe(true);
      expect(putBodies.some((b) => JSON.stringify(b.content).includes("Class Changed"))).toBe(true);
    });

    it("a PUT failure on the SECOND doc: the first (already-put) doc is 'skipped' (never compiled), the second is 'failed', and NO compile call is ever made", async () => {
      const diff = documentsDiff();
      const plan = await buildPlan(diff);
      // Deterministic order: buildPlan sub-orders documents steps by subject
      // ("Changed.cls" < "New.cls").
      expect(plan.steps.map((s) => s.subject)).toEqual(["Changed.cls", "New.cls"]);

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return versionResponse();
        if (path.includes("doc/Changed.cls")) return envelope({ name: "Changed.cls", content: ["Class Changed {}"] });
        if (path.includes("doc/New.cls")) return envelope({ name: "New.cls", content: ["Class New {}"] });
        throw new Error(`unexpected sourceHttp.get ${path}`);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return versionResponse();
        throw new Error(`unexpected targetHttp.get ${path}`);
      });
      // First doc's PUT succeeds; second doc's PUT fails.
      targetHttp.put
        .mockResolvedValueOnce(envelope({}))
        .mockRejectedValueOnce(new IrisApiError(409, [], "/api/atelier/v8/SADEMO/doc/New.cls", "IRIS returned HTTP 409. Conflict."));

      const result = await envPromoteTool.handler(
        {
          action: "execute",
          source: "source",
          target: "target",
          diff,
          plan,
          steps: plan.steps.map((s) => s.index),
          confirm: true,
        },
        ctx,
      );

      expect(result.isError).toBe(true);
      const sc = result.structuredContent as unknown as ExecuteResultSC;
      const bySubject = new Map(sc.executed.map((e) => [e.subject, e]));
      expect(bySubject.get("Changed.cls")?.status).toBe("skipped"); // put succeeded but never compiled
      expect(bySubject.get("New.cls")?.status).toBe("failed");
      expect(bySubject.get("New.cls")?.error).toContain("409");
      // NO compile call at all -- the batch aborted before any compile attempt.
      const compileCalls = targetHttp.post.mock.calls.filter((c) => (c[0] as string).includes("/action/compile"));
      expect(compileCalls).toHaveLength(0);
    });

    it("a target PUT that answers HTTP 200 with a non-empty result.status halts like a thrown PUT: that doc is 'failed' with the hedged text, the earlier doc is 'skipped', and NO compile call is made (Story 38.7, DW-530)", async () => {
      const diff = documentsDiff();
      const plan = await buildPlan(diff);
      expect(plan.steps.map((s) => s.subject)).toEqual(["Changed.cls", "New.cls"]);

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return versionResponse();
        if (path.includes("doc/Changed.cls")) return envelope({ name: "Changed.cls", content: ["Class Changed {}"] });
        if (path.includes("doc/New.cls")) return envelope({ name: "New.cls", content: ["Class New {}"] });
        throw new Error(`unexpected sourceHttp.get ${path}`);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return versionResponse();
        throw new Error(`unexpected targetHttp.get ${path}`);
      });
      // The live shape of a document IRIS refuses inside an HTTP 200 envelope (doc-put-bom-live-gate.test.ts,
      // captured 2026-10-15, IRIS 2026.2 build 221U): empty status.errors, ts "" and content "", the reason only in
      // result.status.
      const softStatus = "ERROR #16021: Illegal Header Line: Class New {}";
      targetHttp.put
        .mockResolvedValueOnce(envelope({}))
        .mockResolvedValueOnce(
          envelope({ name: "New.cls", db: "", ts: "", cat: "CLS", enc: false, content: "", status: softStatus }),
        );

      const result = await envPromoteTool.handler(
        {
          action: "execute",
          source: "source",
          target: "target",
          diff,
          plan,
          steps: plan.steps.map((s) => s.index),
          confirm: true,
        },
        ctx,
      );

      expect(result.isError).toBe(true);
      const sc = result.structuredContent as unknown as ExecuteResultSC;
      const bySubject = new Map(sc.executed.map((e) => [e.subject, e]));
      expect(bySubject.get("Changed.cls")?.status).toBe("skipped");
      expect(bySubject.get("New.cls")?.status).toBe("failed");
      expect(bySubject.get("New.cls")?.error).toBe(
        `IRIS reported an error after the write of 'New.cls' to the target: ${softStatus}. ` +
          "The document may have been saved on the target; check it with iris_doc_get before running iris_env_promote again.",
      );
      expect(sc.summary).toEqual({ completed: 0, failed: 1, skipped: 1 });
      expect(targetHttp.post.mock.calls.filter((c) => (c[0] as string).includes("/action/compile"))).toHaveLength(0);
    });

    it("a compile-time error on one doc: that doc is 'failed' with the compile error; a later doc in the same batch is reported 'skipped' (batch reporting halts at the first compile failure)", async () => {
      const diff = documentsDiff();
      const plan = await buildPlan(diff);
      expect(plan.steps.map((s) => s.subject)).toEqual(["Changed.cls", "New.cls"]);

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return versionResponse();
        return envelope({ name: "doc", content: ["Class X {}"] });
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return versionResponse();
        throw new Error(`unexpected targetHttp.get ${path}`);
      });
      targetHttp.put.mockResolvedValue(envelope({}));
      targetHttp.post.mockImplementation(async (path: string) => {
        if (path.includes("/action/compile")) {
          return envelope({
            content: [
              { name: "Changed.cls", errors: [{ error: "ERROR #1: Syntax error" }] },
              { name: "New.cls", errors: [] },
            ],
          });
        }
        throw new Error(`unexpected targetHttp.post ${path}`);
      });

      const result = await envPromoteTool.handler(
        {
          action: "execute",
          source: "source",
          target: "target",
          diff,
          plan,
          steps: plan.steps.map((s) => s.index),
          confirm: true,
        },
        ctx,
      );

      expect(result.isError).toBe(true);
      const sc = result.structuredContent as unknown as ExecuteResultSC;
      const bySubject = new Map(sc.executed.map((e) => [e.subject, e]));
      expect(bySubject.get("Changed.cls")?.status).toBe("failed");
      expect(bySubject.get("Changed.cls")?.error).toContain("Syntax error");
      // "New.cls" (index-after "Changed.cls" in this plan) is skipped -- the
      // batch treats the first compile failure as the halt point, matching
      // the general halt-on-first-error contract uniformly across domains.
      expect(bySubject.get("New.cls")?.status).toBe("skipped");
    });

    it("a source GET returning 200 WITHOUT a content array fails the step and NEVER PUTs empty content (never blanks a target doc)", async () => {
      const diff = documentsDiff();
      const plan = await buildPlan(diff);
      // Subject order: "Changed.cls" < "New.cls". Make the FIRST doc's source
      // GET return an anomalous 200 with no `content` array.
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return versionResponse();
        if (path.includes("doc/Changed.cls")) return envelope({ name: "Changed.cls" }); // NO content field
        if (path.includes("doc/New.cls")) return envelope({ name: "New.cls", content: ["Class New {}"] });
        throw new Error(`unexpected sourceHttp.get ${path}`);
      });
      targetHttp.get.mockImplementation(async (path: string) => {
        if (path === "/api/atelier/") return versionResponse();
        throw new Error(`unexpected targetHttp.get ${path}`);
      });
      targetHttp.put.mockResolvedValue(envelope({}));

      const result = await envPromoteTool.handler(
        {
          action: "execute",
          source: "source",
          target: "target",
          diff,
          plan,
          steps: plan.steps.map((s) => s.index),
          confirm: true,
        },
        ctx,
      );

      expect(result.isError).toBe(true);
      const sc = result.structuredContent as unknown as ExecuteResultSC;
      const bySubject = new Map(sc.executed.map((e) => [e.subject, e]));
      expect(bySubject.get("Changed.cls")?.status).toBe("failed");
      expect(bySubject.get("Changed.cls")?.error).toContain("no document content");
      expect(bySubject.get("New.cls")?.status).toBe("skipped");
      // The critical assertion: NO empty PUT ever reached the target, and NO
      // compile was attempted -- the target document was never blanked.
      expect(targetHttp.put).not.toHaveBeenCalled();
      const compileCalls = targetHttp.post.mock.calls.filter((c) => (c[0] as string).includes("/action/compile"));
      expect(compileCalls).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // QA hardening (Story 27.3 QA stage) -- genuinely-missing guardrail
  // coverage on security-critical surfaces, added without duplicating the
  // dev suite above.
  // ══════════════════════════════════════════════════════════════════

  // Gate 4 is built specifically to consult IRIS_GOVERNANCE_PRESET (Task 1's
  // whole rationale for exporting parseGovernancePreset/BASELINE_ACTION_
  // CLASSIFICATIONS -- see the env-promote.ts module doc comment), yet no
  // dev test ever sets IRIS_GOVERNANCE_PRESET. These tests close that gap.
  describe("QA hardening: Gate 4 correctly consults IRIS_GOVERNANCE_PRESET=read-only", () => {
    const originalPreset = process.env.IRIS_GOVERNANCE_PRESET;

    afterEach(() => {
      if (originalPreset === undefined) delete process.env.IRIS_GOVERNANCE_PRESET;
      else process.env.IRIS_GOVERNANCE_PRESET = originalPreset;
    });

    it("a read-only preset refuses a setConfig step, naming the key, resolving NO client, no target writes", async () => {
      process.env.IRIS_GOVERNANCE_PRESET = "read-only";
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      const configStep = plan.steps.find((s) => s.operation === "setConfig")!;

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [configStep.index], confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("iris_config_manage:set");
      expect(result.structuredContent).toBeUndefined();
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
      expect(targetHttp.post).not.toHaveBeenCalled();
    });

    it("a read-only preset ALSO refuses a mappings-only createMapping step, naming iris_mapping_manage:create -- the preset is consulted for EVERY write-family key, not only the one the explicit-override tests already exercise", async () => {
      process.env.IRIS_GOVERNANCE_PRESET = "read-only";
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      const mappingStep = plan.steps.find((s) => s.operation === "createMapping")!;

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [mappingStep.index], confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("iris_mapping_manage:create");
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
      expect(targetHttp.post).not.toHaveBeenCalled();
    });

    it("an EXPLICIT per-profile enable on the target beats a read-only preset (cascade order: profile-explicit > preset) -- execution proceeds", async () => {
      process.env.IRIS_GOVERNANCE_PRESET = "read-only";
      process.env.IRIS_GOVERNANCE = JSON.stringify({
        profiles: { target: { "iris_config_manage:set": true } },
      });
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      const configStep = plan.steps.find((s) => s.operation === "setConfig")!;

      sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: { Maxprocesses: 500 } }));
      targetHttp.post.mockResolvedValue(envelope({ success: true }));

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [configStep.index], confirm: true },
        ctx,
      );
      expect(result.isError).toBeFalsy();
      expect(targetHttp.post).toHaveBeenCalledTimes(1);
    });
  });

  // updateMapping is the ONE operation whose write-family check spans TWO
  // keys (delete + create -- Config.cls has no update). No dev test disables
  // JUST the delete half, so a coding mistake that only checked "create"
  // would go unnoticed.
  describe("QA hardening: Gate 4 precision -- updateMapping requires BOTH iris_mapping_manage:delete AND :create", () => {
    it("disabling ONLY 'iris_mapping_manage:delete' on the target still refuses an updateMapping step, naming the delete key specifically", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({
        profiles: { target: { "iris_mapping_manage:delete": false } },
      });
      const diff = {
        source: { profile: "source", namespace: "HSCUSTOM" },
        target: { profile: "target", namespace: "SADEMO" },
        domains: {
          mappings: {
            onlyInSource: [],
            onlyInTarget: [],
            differs: [
              {
                type: "global",
                namespace: "HSCUSTOM",
                name: "ChangedGlobal",
                sourceValue: { database: "OLD" },
                targetValue: { database: "STALE" },
              },
            ],
            identical: 0,
          },
        },
        summary: { driftCount: 1, identicalCount: 0 },
      };
      const plan = await buildPlan(diff);
      const updateStep = plan.steps.find((s) => s.operation === "updateMapping")!;

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [updateStep.index], confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("iris_mapping_manage:delete");
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
      expect(targetHttp.post).not.toHaveBeenCalled();
    });
  });

  // The dev suite's only SDS re-fetch proof is the credential-redaction test,
  // which checks `body.value` alone. Neither the optional `description`/
  // `deployable` fields nor a non-credential value/body shape are exercised
  // anywhere else.
  describe("source re-fetch -- QA hardening: setDefaultSetting forwards optional description/deployable fields from the LIVE re-fetch", () => {
    it("a non-credential setDefaultSetting step forwards the LIVE re-fetched value + description + deployable to TARGET, in the TARGET namespace", async () => {
      process.env.IRIS_GOVERNANCE = JSON.stringify({
        profiles: { target: { "iris_default_settings_manage:set": true } },
      });
      const diff = {
        source: { profile: "source", namespace: "HSCUSTOM" },
        target: { profile: "target", namespace: "SADEMO" },
        domains: {
          defaultSettings: {
            onlyInSource: [
              { production: "MyProd", item: "MyItem", hostClass: "MyHost", setting: "Timeout", value: "30" },
            ],
            onlyInTarget: [],
            differs: [],
            identical: 0,
          },
        },
        summary: { driftCount: 1, identicalCount: 0 },
      };
      const plan = await buildPlan(diff);
      const sdsStep = plan.steps[0]!;

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/interop/defaultsettings")) {
          return envelope({
            settings: [
              {
                id: 7,
                production: "MyProd",
                item: "MyItem",
                hostClass: "MyHost",
                setting: "Timeout",
                value: "45", // LIVE value -- differs from the diff-time "30"
                description: "Live re-fetched description",
                deployable: true,
              },
            ],
            count: 1,
          });
        }
        return envelope([]);
      });
      targetHttp.post.mockResolvedValue(envelope({ success: true }));

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [sdsStep.index], confirm: true },
        ctx,
      );

      expect(result.isError).toBeFalsy();
      expect(targetHttp.post).toHaveBeenCalledTimes(1);
      const [path, body] = targetHttp.post.mock.calls[0] as [string, Record<string, unknown>];
      expect(path).toContain("/interop/defaultsettings");
      expect(body).toEqual({
        action: "set",
        namespace: "SADEMO",
        production: "MyProd",
        item: "MyItem",
        hostClass: "MyHost",
        setting: "Timeout",
        value: "45",
        description: "Live re-fetched description",
        deployable: true,
      });
    });
  });

  // No dev test asserts the ACTUAL modifyWebApp write body -- only that its
  // endpoint was (or wasn't) called. The Dev Notes explicitly call out
  // excluding 'cookiePath'; nothing currently proves that exclusion holds on
  // the real dispatched body.
  describe("source re-fetch -- QA hardening: modifyWebApp forwards ONLY the curated field subset (cookiePath excluded)", () => {
    it("a modifyWebApp step writes exactly the curated fields to TARGET -- 'cookiePath' and 'description' from the source re-fetch never appear in the write body", async () => {
      const diff = {
        source: { profile: "source", namespace: "HSCUSTOM" },
        target: { profile: "target", namespace: "SADEMO" },
        domains: {
          webapps: {
            onlyInSource: ["/api/new"],
            onlyInTarget: [],
            differs: [],
            identical: 0,
          },
        },
        summary: { driftCount: 1, identicalCount: 0 },
      };
      const plan = await buildPlan(diff);
      const webappStep = plan.steps[0]!;

      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/security/webapp")) {
          return envelope([
            {
              name: "/api/new",
              namespace: "HSCUSTOM",
              dispatchClass: "My.Dispatch",
              description: "unused by execute",
              enabled: true,
              authEnabled: 32,
              isNameSpaceDefault: false,
              cspZenEnabled: true,
              recurse: true,
              matchRoles: ":%DB_IRISSYS",
              cookiePath: "/instance-specific-path",
            },
          ]);
        }
        return envelope([]);
      });
      targetHttp.post.mockResolvedValue(envelope({ success: true }));

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [webappStep.index], confirm: true },
        ctx,
      );

      expect(result.isError).toBeFalsy();
      expect(targetHttp.post).toHaveBeenCalledTimes(1);
      const [path, body] = targetHttp.post.mock.calls[0] as [string, Record<string, unknown>];
      expect(path).toContain("/security/webapp");
      expect(body).toEqual({
        action: "modify",
        name: "/api/new",
        dispatchClass: "My.Dispatch",
        enabled: 1,
        authEnabled: 32,
        isNameSpaceDefault: 0,
        cspZenEnabled: 1,
        recurse: 1,
        matchRoles: ":%DB_IRISSYS",
        // The webapp entry's OWN namespace field (its source-side binding) --
        // NOT translated to the resolved target namespace. Pinned as a
        // regression guard for this (deliberate) behavior.
        namespace: "HSCUSTOM",
      });
      expect(Object.prototype.hasOwnProperty.call(body, "cookiePath")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(body, "description")).toBe(false);
    });
  });

  // parseExecPlanSteps restricts 'operation' to the closed 6-verb allowlist,
  // but no test proves a hand-tampered plan carrying an operation OUTSIDE
  // that set (e.g. a hypothetical delete verb) is actually rejected rather
  // than silently dispatched or crashing.
  describe("execute -- QA hardening: a tampered plan cannot smuggle in an unsupported (e.g. destructive) operation", () => {
    it("a plan.steps entry whose 'operation' is OUTSIDE the known write-verb set is rejected as a malformed plan, before Gate 2/3/4 or any HTTP call", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      const tamperedPlan = {
        ...plan,
        steps: plan.steps.map((s, i) => (i === 0 ? { ...s, operation: "deleteMapping" } : s)),
      };

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan: tamperedPlan, steps: [1], confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text.toLowerCase()).toContain("plan");
      expect(result.structuredContent).toBeUndefined();
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
      expect(targetHttp.post).not.toHaveBeenCalled();
    });

    // The operation-tamper above is caught by parseExecPlanSteps' verb
    // allowlist. A SUBJECT swap (still a valid verb + valid string) survives
    // parsing, keeps the SAME plan.planHash, and the diff still hashes to it --
    // so only Gate 3b (re-derive steps from diff + compare) catches it. Without
    // Gate 3b this would reach dispatch and promote a source item OUTSIDE the
    // reviewed diff.
    it("a plan.steps entry whose 'subject' was swapped (hash still valid) is refused by Gate 3b (plan/diff consistency), before any client resolution or write", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      // Swap the mapping step's subject to a DIFFERENT (unreviewed) global,
      // leaving planHash + every other field intact.
      const tamperedPlan = {
        ...plan,
        steps: plan.steps.map((s) =>
          s.operation === "createMapping" ? { ...s, subject: "global::EvilGlobal" } : s,
        ),
      };

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan: tamperedPlan, steps: [1], confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("consistency");
      expect(result.structuredContent).toBeUndefined();
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
      expect(sourceHttp.get).not.toHaveBeenCalled();
      expect(targetHttp.post).not.toHaveBeenCalled();
    });

    it("a genuine, untampered plan+diff PASSES Gate 3b and dispatches (the consistency check is a no-op for a real caller)", async () => {
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      const mappingStep = plan.steps.find((s) => s.operation === "createMapping")!;
      sourceHttp.get.mockImplementation(async (path: string) => {
        if (path.includes("/config/mapping/global")) {
          return envelope([{ name: "NewGlobal", type: "global", namespace: "HSCUSTOM", database: "IRISDB" }]);
        }
        return envelope([]);
      });
      targetHttp.post.mockResolvedValue(envelope({ success: true }));

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [mappingStep.index], confirm: true },
        ctx,
      );

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as unknown as ExecuteResultSC;
      expect(sc.executed[0]?.status).toBe("completed");
      expect(targetHttp.post).toHaveBeenCalledTimes(1);
    });

    // CR 27.2-2 (routed to 27.3): a plan/diff reviewed for one target must not
    // be executed against a DIFFERENT instance (wrong-instance write guard).
    it("a 'target' that does NOT match the diff's own target profile is refused (Gate 3c), before any client resolution or write", async () => {
      const diff = fourStepDiff(); // diff.target.profile === "target"
      const plan = await buildPlan(diff);
      // resolveProfileClient also knows a "prod" profile so a resolution error
      // can't mask the gate refusal.
      ctx.resolveProfileClient = vi.fn(async (name: string) => {
        if (name === "source") return sourceHttp;
        if (name === "target" || name === "prod") return targetHttp;
        throw new ProfileResolutionError(name, ["default", "source", "target", "prod"]);
      });

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "prod", diff, plan, steps: [1], confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("diff/profile match");
      expect(result.content[0]?.text).toContain("prod");
      expect(result.structuredContent).toBeUndefined();
      expect(ctx.resolveProfileClient).not.toHaveBeenCalled();
      expect(targetHttp.post).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Story 29.3 burn-down: CR 27.3-4 (blank resolved namespace refusal)
  // ══════════════════════════════════════════════════════════════════

  describe("CR 27.3-4: a blank resolved namespace refuses before any write", () => {
    it("refuses when the source profile's resolved namespace is blank (misconfigured profile, no override)", async () => {
      sourceHttp = createMockHttp("");
      ctx.resolveProfileClient = vi.fn(async (name: string) => {
        if (name === "source") return sourceHttp;
        if (name === "target") return targetHttp;
        throw new ProfileResolutionError(name, ["default", "source", "target"]);
      });
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [1], confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("resolved namespace is blank");
      expect(result.structuredContent).toBeUndefined();
      expect(sourceHttp.get).not.toHaveBeenCalled();
      expect(targetHttp.post).not.toHaveBeenCalled();
    });

    it("refuses when the target profile's resolved namespace is blank (misconfigured profile, no override)", async () => {
      targetHttp = createMockHttp("");
      ctx.resolveProfileClient = vi.fn(async (name: string) => {
        if (name === "source") return sourceHttp;
        if (name === "target") return targetHttp;
        throw new ProfileResolutionError(name, ["default", "source", "target"]);
      });
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);

      const result = await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: [1], confirm: true },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("resolved namespace is blank");
      expect(targetHttp.post).not.toHaveBeenCalled();
    });

    it("does NOT refuse when an explicit 'namespace' override compensates for a blank-default profile", async () => {
      sourceHttp = createMockHttp("");
      targetHttp = createMockHttp("");
      ctx.resolveProfileClient = vi.fn(async (name: string) => {
        if (name === "source") return sourceHttp;
        if (name === "target") return targetHttp;
        throw new ProfileResolutionError(name, ["default", "source", "target"]);
      });
      const diff = fourStepDiff();
      const plan = await buildPlan(diff);
      sourceHttp.get.mockResolvedValue(
        envelope([{ name: "NewGlobal", type: "global", namespace: "HSCUSTOM", database: "IRISDB" }]),
      );
      targetHttp.post.mockResolvedValue(envelope({}));

      const result = await envPromoteTool.handler(
        {
          action: "execute",
          source: "source",
          target: "target",
          diff,
          plan,
          steps: [1],
          confirm: true,
          namespace: "HSCUSTOM",
        },
        ctx,
      );

      expect(result.content[0]?.text).not.toContain("resolved namespace is blank");
      expect(targetHttp.post).toHaveBeenCalled();
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// Story 43.3: the person is asked once, after every check and before the first IRIS call
// ══════════════════════════════════════════════════════════════════

type PromoteConfirm = NonNullable<ToolContext["confirm"]>;
type PromoteConfirmRequest = Parameters<PromoteConfirm>[0];
type PromoteConfirmOutcome = Awaited<ReturnType<PromoteConfirm>>;

/** The result a declining person ends the call with. The gate must return this very object. */
const DECLINED_RESULT = {
  content: [{ type: "text" as const, text: "The person declined the confirmation." }],
  structuredContent: { code: "CONFIRMATION_DECLINED" },
  isError: true,
};

/** A `ctx.confirm` that answers `proceed: true`. */
function proceedingConfirm() {
  return vi.fn(async (_request: PromoteConfirmRequest): Promise<PromoteConfirmOutcome> => ({ proceed: true }));
}

/** A `ctx.confirm` that answers with a decline. */
function decliningConfirm() {
  return vi.fn(
    async (_request: PromoteConfirmRequest): Promise<PromoteConfirmOutcome> => ({
      proceed: false,
      result: DECLINED_RESULT,
    }),
  );
}

/** Where a mock's first call falls among the calls of all mocks: a call made later has a larger number. */
function firstCallOrder(fn: { mock: { invocationCallOrder: number[] } }): number {
  const order = fn.mock.invocationCallOrder[0];
  expect(order).toBeDefined();
  return order as number;
}

/** The arguments of an `execute` call over `fourStepDiff` (indices 1-4), allowing `steps` unless overridden. */
async function promoteExecuteArgs(extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const diff = fourStepDiff();
  const plan = await buildPlan(diff);
  return { action: "execute", source: "source", target: "target", diff, plan, steps: [1], confirm: true, ...extra };
}

/** A diff of `count` mapping steps, `global::G01`, `global::G02`, ..., all `createMapping`, indices 1 to `count`. */
function manyMappingsDiff(count: number): Record<string, unknown> {
  const keys = Array.from({ length: count }, (_, i) => `global::G${String(i + 1).padStart(2, "0")}`);
  return {
    source: { profile: "source", namespace: "HSCUSTOM" },
    target: { profile: "target", namespace: "SADEMO" },
    domains: { mappings: { onlyInSource: keys, onlyInTarget: [], differs: [], identical: 0 } },
    summary: { driftCount: count, identicalCount: 0 },
  };
}

/** A diff of two document steps: 1 `Changed.cls`, 2 `New.cls`. */
function twoDocumentsDiff(): Record<string, unknown> {
  return {
    source: { profile: "source", namespace: "HSCUSTOM" },
    target: { profile: "target", namespace: "SADEMO" },
    domains: {
      documents: {
        onlyInSource: ["New.cls"],
        onlyInTarget: [],
        differs: [
          { name: "Changed.cls", sourceHash: "a".repeat(64), targetHash: "b".repeat(64), sourceTs: "t1", targetTs: "t2" },
        ],
        identical: 0,
      },
    },
    summary: { driftCount: 2, identicalCount: 0 },
  };
}

describe("Story 43.3: confirmation (execute)", () => {
  const originalGovernance = process.env.IRIS_GOVERNANCE;
  let sourceHttp: ReturnType<typeof createMockHttp>;
  let targetHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  /** Fresh clients and a context with no `confirm`, as a unit test builds it. */
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

  beforeEach(() => {
    wire();
  });

  afterEach(() => {
    if (originalGovernance === undefined) delete process.env.IRIS_GOVERNANCE;
    else process.env.IRIS_GOVERNANCE = originalGovernance;
  });

  /** Every call made on the source and target clients, by method. */
  function recordedCalls() {
    const of = (http: typeof sourceHttp) => ({
      get: [...http.get.mock.calls],
      post: [...http.post.mock.calls],
      put: [...http.put.mock.calls],
      delete: [...http.delete.mock.calls],
      head: [...http.head.mock.calls],
    });
    return { source: of(sourceHttp), target: of(targetHttp) };
  }

  /** Neither client was called at all: nothing was read and nothing was written. */
  function expectNoIrisCalls(): void {
    const none = { get: [], post: [], put: [], delete: [], head: [] };
    expect(recordedCalls()).toEqual({ source: none, target: none });
  }

  /** The source re-fetches and target writes of a run that allows mapping 1, web application 3 and config 4. */
  function arrangeSubset(): void {
    sourceHttp.get.mockImplementation(async (path: string) => {
      if (path.includes("/config/mapping/global")) {
        return envelope([{ name: "NewGlobal", type: "global", namespace: "HSCUSTOM", database: "IRISDB" }]);
      }
      if (path.includes("/security/webapp")) {
        return envelope([
          {
            name: "/api/new",
            namespace: "HSCUSTOM",
            dispatchClass: "My.Dispatch",
            description: "",
            enabled: true,
            authEnabled: 32,
            isNameSpaceDefault: false,
            cspZenEnabled: false,
            recurse: false,
            matchRoles: "",
            cookiePath: "/x",
          },
        ]);
      }
      return envelope([]);
    });
    sourceHttp.post.mockResolvedValue(envelope({ section: "config", properties: { Maxprocesses: 500 } }));
    targetHttp.post.mockResolvedValue(envelope({ success: true }));
  }

  /** Run `execute` allowing steps 4, 1 and 3 (config, mapping, web application), listed out of plan order. */
  async function executeSubset(extra: Record<string, unknown> = {}) {
    return envPromoteTool.handler(await promoteExecuteArgs({ steps: [4, 1, 3], ...extra }), ctx);
  }

  /** The source and target document traffic of a run over `twoDocumentsDiff`. */
  function arrangeDocuments(): void {
    sourceHttp.get.mockImplementation(async (path: string) => {
      if (path === "/api/atelier/") return versionResponse();
      if (path.includes("doc/New.cls")) return envelope({ name: "New.cls", content: ["Class New {}"] });
      if (path.includes("doc/Changed.cls")) return envelope({ name: "Changed.cls", content: ["Class Changed {}"] });
      throw new Error(`unexpected sourceHttp.get ${path}`);
    });
    targetHttp.get.mockImplementation(async (path: string) => {
      if (path === "/api/atelier/") return versionResponse();
      throw new Error(`unexpected targetHttp.get ${path}`);
    });
    targetHttp.put.mockResolvedValue(envelope({}));
    targetHttp.post.mockImplementation(async (path: string, body: unknown) => {
      if (path.includes("/action/compile")) {
        return envelope({ content: (body as string[]).map((name) => ({ name, errors: [] })) });
      }
      throw new Error(`unexpected targetHttp.post ${path}`);
    });
  }

  // ── asked once, with the strings of the spec, before the first IRIS call ──

  it("asks once with the operation, the target and the allowed steps in plan order, before the first read or write", async () => {
    arrangeSubset();
    const confirm = proceedingConfirm();
    ctx.confirm = confirm;

    const result = await executeSubset();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toEqual({
      operation: "promote changes to another server",
      target: "server 'target', namespace SADEMO",
      scope:
        "3 step(s) from server 'source': #1 mappings createMapping global::NewGlobal; " +
        "#3 webapps modifyWebApp /api/new; #4 config setConfig Maxprocesses",
    });
    expect(result.isError).toBeFalsy();
    expect(targetHttp.post).toHaveBeenCalledTimes(3);
    const asked = firstCallOrder(confirm);
    expect(asked).toBeLessThan(firstCallOrder(sourceHttp.get));
    expect(asked).toBeLessThan(firstCallOrder(sourceHttp.post));
    expect(asked).toBeLessThan(firstCallOrder(targetHttp.post));
  });

  it("asks before the first document is read, put or compiled", async () => {
    arrangeDocuments();
    const confirm = proceedingConfirm();
    ctx.confirm = confirm;
    const diff = twoDocumentsDiff();
    const plan = await buildPlan(diff);

    const result = await envPromoteTool.handler(
      { action: "execute", source: "source", target: "target", diff, plan, steps: [2, 1], confirm: true },
      ctx,
    );

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toEqual({
      operation: "promote changes to another server",
      target: "server 'target', namespace SADEMO",
      scope:
        "2 step(s) from server 'source': #1 documents putAndCompile Changed.cls; #2 documents putAndCompile New.cls",
    });
    expect(result.isError).toBeFalsy();
    expect(targetHttp.put).toHaveBeenCalledTimes(2);
    const asked = firstCallOrder(confirm);
    expect(asked).toBeLessThan(firstCallOrder(sourceHttp.get));
    expect(asked).toBeLessThan(firstCallOrder(targetHttp.get));
    expect(asked).toBeLessThan(firstCallOrder(targetHttp.put));
    expect(asked).toBeLessThan(firstCallOrder(targetHttp.post));
  });

  it("names the namespace override as the target namespace", async () => {
    const confirm = decliningConfirm();
    ctx.confirm = confirm;

    await executeSubset({ namespace: "OVERRIDE" });

    expect(confirm.mock.calls[0]?.[0]?.target).toBe("server 'target', namespace OVERRIDE");
  });

  const TEN =
    "#1 mappings createMapping global::G01; #2 mappings createMapping global::G02; " +
    "#3 mappings createMapping global::G03; #4 mappings createMapping global::G04; " +
    "#5 mappings createMapping global::G05; #6 mappings createMapping global::G06; " +
    "#7 mappings createMapping global::G07; #8 mappings createMapping global::G08; " +
    "#9 mappings createMapping global::G09; #10 mappings createMapping global::G10";
  const scopeCases: Array<{ title: string; steps: number[]; scope: string }> = [
    {
      title: "12 allowed steps list the first 10, then say how many more",
      steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      scope: `12 step(s) from server 'source': ${TEN}; and 2 more`,
    },
    {
      title: "11 allowed steps list the first 10 and 1 more",
      steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      scope: `11 step(s) from server 'source': ${TEN}; and 1 more`,
    },
    {
      title: "10 allowed steps are all listed, with no 'more'",
      steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      scope: `10 step(s) from server 'source': ${TEN}`,
    },
    {
      title: "the count and the listing cover the allowed steps only, in plan order",
      steps: [12, 2, 7],
      scope:
        "3 step(s) from server 'source': #2 mappings createMapping global::G02; " +
        "#7 mappings createMapping global::G07; #12 mappings createMapping global::G12",
    },
    {
      title: "one allowed step",
      steps: [5],
      scope: "1 step(s) from server 'source': #5 mappings createMapping global::G05",
    },
  ];
  for (const scopeCase of scopeCases) {
    it(`scope of a 12-step plan: ${scopeCase.title}`, async () => {
      const diff = manyMappingsDiff(12);
      const plan = await buildPlan(diff);
      expect(plan.steps).toHaveLength(12);
      const confirm = decliningConfirm();
      ctx.confirm = confirm;

      await envPromoteTool.handler(
        { action: "execute", source: "source", target: "target", diff, plan, steps: scopeCase.steps, confirm: true },
        ctx,
      );

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0]?.[0]?.scope).toBe(scopeCase.scope);
    });
  }

  // ── never asked when a check of the gate refuses first ──

  interface RefusalCase {
    title: string;
    text: string;
    args: () => Promise<Record<string, unknown>>;
    arrange?: () => void;
  }
  const refusalCases: RefusalCase[] = [
    {
      title: "Gate 1: 'confirm' omitted",
      text: "Gate 1 (confirm): 'confirm' must be true to execute. No changes were made.",
      args: () => promoteExecuteArgs({ confirm: undefined }),
    },
    {
      title: "Gate 1: 'confirm' false",
      text: "Gate 1 (confirm): 'confirm' must be true to execute. No changes were made.",
      args: () => promoteExecuteArgs({ confirm: false }),
    },
    {
      title: "no plan",
      text:
        "'plan' is required for action 'execute' (pass the structuredContent from a prior " +
        "iris_env_promote 'plan' call). No changes were made.",
      args: () => promoteExecuteArgs({ plan: undefined }),
    },
    {
      title: "a plan without a planHash",
      text:
        "'plan' is missing a 'planHash' string -- pass the structuredContent from a prior " +
        "iris_env_promote 'plan' call. No changes were made.",
      args: () => promoteExecuteArgs({ plan: { steps: [] } }),
    },
    {
      title: "a plan without a valid steps array",
      text:
        "'plan' is missing a valid 'steps' array -- pass the structuredContent from a prior " +
        "iris_env_promote 'plan' call. No changes were made.",
      args: () => promoteExecuteArgs({ plan: { planHash: "abc", steps: "none" } }),
    },
    {
      title: "Gate 2: 'steps' omitted",
      text:
        "Gate 2 (steps allowlist): 'steps' (a non-empty array of plan step indices) is required " +
        "for action 'execute'. No changes were made.",
      args: () => promoteExecuteArgs({ steps: undefined }),
    },
    {
      title: "Gate 2: 'steps' empty",
      text:
        "Gate 2 (steps allowlist): 'steps' (a non-empty array of plan step indices) is required " +
        "for action 'execute'. No changes were made.",
      args: () => promoteExecuteArgs({ steps: [] }),
    },
    {
      title: "Gate 2: an index outside the plan",
      text:
        "Gate 2 (steps allowlist): 'steps' contains index/indices not present in 'plan.steps': 99. " +
        "No changes were made.",
      args: () => promoteExecuteArgs({ steps: [1, 99] }),
    },
    {
      title: "Gate 3: 'diff' omitted",
      text:
        "Gate 3 (plan-hash freshness): 'diff' is required for action 'execute' too -- pass the SAME " +
        "'diff' that produced 'plan' so the plan's freshness can be verified. No changes were made.",
      args: () => promoteExecuteArgs({ diff: undefined }),
    },
    {
      title: "Gate 3: a 'diff' that is not an env diff",
      text:
        "'diff' is missing a 'domains' object -- pass the structuredContent from a prior iris_env_diff call. " +
        "No changes were made.",
      args: () => promoteExecuteArgs({ diff: {} }),
    },
    {
      title: "Gate 3: a stale plan",
      text:
        "Gate 3 (plan-hash freshness): stale plan -- regenerate the plan from the current diff " +
        "('diff' no longer matches 'plan.planHash'). No changes were made.",
      args: () => promoteExecuteArgs({ diff: { ...fourStepDiff(), summary: { driftCount: 999, identicalCount: 0 } } }),
    },
    {
      title: "Gate 3b: a plan whose step subject was swapped",
      text:
        "Gate 3 (plan/diff consistency): 'plan.steps' do not match the steps derived from 'diff' -- " +
        "the plan appears hand-edited or was generated from a different diff. Regenerate the plan from " +
        "the current diff. No changes were made.",
      args: async () => {
        const plan = await buildPlan(fourStepDiff());
        return promoteExecuteArgs({
          plan: {
            ...plan,
            steps: plan.steps.map((s) => (s.operation === "createMapping" ? { ...s, subject: "global::EvilGlobal" } : s)),
          },
        });
      },
    },
    {
      title: "Gate 3c: a source that is not the diff's source",
      text:
        "Gate 3 (diff/profile match): 'diff' was generated for source 'source', but 'source' is 'other'. " +
        "Regenerate the diff/plan for the intended source. No changes were made.",
      args: () => promoteExecuteArgs({ source: "other" }),
    },
    {
      title: "Gate 3c: a target that is not the diff's target",
      text:
        "Gate 3 (diff/profile match): 'diff' was generated for target 'target', but 'target' is 'prod'. " +
        "Refusing to execute a plan against a DIFFERENT target than it was reviewed for. " +
        "Regenerate the diff/plan for the intended target. No changes were made.",
      args: () => promoteExecuteArgs({ target: "prod" }),
    },
    {
      title: "Gate 4: the target profile's governance disables a write key of the allowed steps",
      text:
        "Gate 4 (target-profile governance): target profile 'target' governance disables " +
        "iris_config_manage:set -- execution refused. No changes were made.",
      args: () => promoteExecuteArgs({ steps: [4] }),
      arrange: () => {
        process.env.IRIS_GOVERNANCE = JSON.stringify({ profiles: { target: { "iris_config_manage:set": false } } });
      },
    },
    {
      title: "a profile that cannot be resolved",
      text: new ProfileResolutionError("target", ["default", "source"]).message,
      args: () => promoteExecuteArgs(),
      arrange: () => {
        ctx.resolveProfileClient = vi.fn(async (name: string) => {
          if (name === "source") return sourceHttp;
          throw new ProfileResolutionError(name, ["default", "source"]);
        });
      },
    },
    {
      title: "a blank source namespace",
      text:
        "Cannot execute: the resolved namespace is blank (source='', target='SADEMO'). " +
        "Check the profile's configured default namespace, or pass an explicit 'namespace' override. " +
        "No changes were made.",
      args: () => promoteExecuteArgs(),
      arrange: () => wire("", "SADEMO"),
    },
    {
      title: "a blank target namespace",
      text:
        "Cannot execute: the resolved namespace is blank (source='HSCUSTOM', target=''). " +
        "Check the profile's configured default namespace, or pass an explicit 'namespace' override. " +
        "No changes were made.",
      args: () => promoteExecuteArgs(),
      arrange: () => wire("HSCUSTOM", ""),
    },
  ];
  for (const refusal of refusalCases) {
    it(`is not asked when the gate refuses first -- ${refusal.title}: the refusal text is unchanged and nothing is called`, async () => {
      refusal.arrange?.();
      const confirm = proceedingConfirm();
      ctx.confirm = confirm;

      const result = await envPromoteTool.handler(await refusal.args(), ctx);

      expect(result).toEqual({ content: [{ type: "text", text: refusal.text }], isError: true });
      expect(confirm).not.toHaveBeenCalled();
      expectNoIrisCalls();
    });
  }

  // ── a decline ends the call; a proceed and a missing confirm leave today's behavior ──

  it("returns a declined outcome unchanged, and reads and writes nothing", async () => {
    arrangeSubset();
    const confirm = decliningConfirm();
    ctx.confirm = confirm;

    const result = await executeSubset();

    expect(result).toBe(DECLINED_RESULT);
    expect(confirm).toHaveBeenCalledTimes(1);
    expectNoIrisCalls();
  });

  it("returns a declined outcome unchanged on a documents run: nothing is read, put or compiled", async () => {
    arrangeDocuments();
    const confirm = decliningConfirm();
    ctx.confirm = confirm;
    const diff = twoDocumentsDiff();
    const plan = await buildPlan(diff);

    const result = await envPromoteTool.handler(
      { action: "execute", source: "source", target: "target", diff, plan, steps: [1, 2], confirm: true },
      ctx,
    );

    expect(result).toBe(DECLINED_RESULT);
    expectNoIrisCalls();
  });

  it("executes exactly as a context without confirm when the outcome is proceed: the same result, reads and writes", async () => {
    arrangeSubset();
    const withoutConfirm = await executeSubset();
    const withoutConfirmCalls = recordedCalls();

    wire();
    arrangeSubset();
    const confirm = proceedingConfirm();
    ctx.confirm = confirm;
    const withConfirm = await executeSubset();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(withConfirm).toEqual(withoutConfirm);
    expect(recordedCalls()).toEqual(withoutConfirmCalls);
    expect(withConfirm.isError).toBeFalsy();
    const executed = withConfirm.structuredContent as unknown as ExecuteResultSC;
    expect(executed.summary).toEqual({ completed: 3, failed: 0, skipped: 0 });
  });

  it("writes as today when the context has no confirm: no question, the allowed steps run in plan order", async () => {
    arrangeSubset();
    expect(ctx.confirm).toBeUndefined();

    const result = await executeSubset();

    expect(result.isError).toBeFalsy();
    const executed = result.structuredContent as unknown as ExecuteResultSC;
    expect(executed.executed.map((step) => `${step.index}:${step.status}`)).toEqual([
      "1:completed",
      "3:completed",
      "4:completed",
    ]);
    expect(targetHttp.post.mock.calls.map((call) => call[0])).toEqual([
      "/api/executemcp/v2/config/mapping/global",
      "/api/executemcp/v2/security/webapp",
      "/api/executemcp/v2/system/config",
    ]);
  });
});
