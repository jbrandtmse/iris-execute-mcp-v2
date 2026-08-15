/**
 * Story 34.3 QA — `iris_execute_classmethod` epic-done gate as a DEFAULT-SUITE,
 * always-discoverable process gate (Rule #21 shape, mirrors
 * `packages/iris-mcp-all/src/__tests__/host-guard-process-gate.test.ts`'s
 * `ctx.skip()`-on-unavailable pattern).
 *
 * Epic 34 exists to remove the need for a bespoke `%SYS.Capture` wrapper
 * classmethod when a target `Write`s to the current device, mutates a
 * `ByRef`/`Output` argument, or switches namespace mid-execution. The story
 * file's Dev Notes name AC 34.3.4(a) — the three `docs/bugs-2026-08-14.md`
 * reproduction shapes passing with NO wrapper class — as the epic's capstone.
 *
 * The dev's own verification of that exact claim (all three shapes together,
 * against the BUILT dist, over a real stdio MCP handshake) was a DISPOSABLE
 * script (`tmp-34-3-epic-gate-smoke.mjs`) that was deleted before staging —
 * genuine when it ran, but not re-runnable and not part of any gate. Two of
 * the three shapes were separately pinned in `custom-rest.integration.test.ts`,
 * but that file is named `*.integration.test.ts`, which `vitest.config.ts`
 * EXCLUDES from the default `vitest run` — and `turbo.json`'s `test` task
 * only ever invokes each package's `"test": "vitest run"` script, never
 * `test:integration`. So NONE of the three reproductions were reachable from
 * `pnpm turbo run build test lint type-check`, and the THIRD reproduction
 * (`%UnitTest.Manager.RunTest` — the one exercising a REAL InterSystems stock
 * tool's own narration, not a project fixture) had zero permanent coverage
 * anywhere in the repository (verified by grep across every `.test.ts` and
 * every `ExecuteMCPv2.Tests.*` class — no match for `RunTest`).
 *
 * This file closes that gap: it is NOT named `*.integration.test.ts`, so it
 * is collected by the default `vitest.config.ts` include glob and therefore
 * runs as part of `pnpm turbo run test`. It degrades gracefully (never fails
 * a pristine/offline checkout) via a `beforeAll` availability probe + a
 * per-test `ctx.skip()`, exactly like the `iris-mcp-all` process gates.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  IrisHttpClient,
  atelierPath,
  loadConfig,
  ping,
  negotiateVersion,
  buildToolContext,
  type ToolContext,
} from "@iris-mcp/shared";
import { executeClassMethodTool } from "../tools/execute.js";

const IRIS_HOST = process.env.IRIS_HOST ?? "localhost";
const IRIS_PORT = process.env.IRIS_PORT ?? "52773";
const IRIS_USERNAME = process.env.IRIS_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_NAMESPACE ?? "HSCUSTOM";

function getConfig() {
  return loadConfig({
    IRIS_HOST,
    IRIS_PORT,
    IRIS_USERNAME,
    IRIS_PASSWORD,
    IRIS_NAMESPACE,
    IRIS_HTTPS: "false",
  });
}

const FIXTURE = "ExecuteMCPv2.Tests.ClassMethodArgsFixture";

/**
 * Opt-in CI switch: when set, an unavailable environment is a hard FAILURE rather
 * than a skip. A gate that can only ever skip is a gate that protects nothing, so
 * any pipeline that intends this to be the epic-done gate must set this.
 */
const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

let skipReason: string | undefined;
let ctx: ToolContext;
let client: IrisHttpClient;

/**
 * Is the reproduction fixture deployed on this instance?
 *
 * Deliberately probed through the STOCK ATELIER `/doc/` surface, never through the
 * `/classmethod` endpoint this file exists to guard. Probing the endpoint under test
 * would let a genuine REGRESSION in that endpoint present as "service not available"
 * and silently skip all three reproductions — a green suite over a broken gate.
 * Atelier answers independently of `ExecuteMCPv2`, so it separates the two states the
 * gate must never confuse: fixtures ABSENT (pristine/bootstrapped-only instance —
 * `ExecuteMCPv2.Tests.*` are deliberately outside the bootstrap manifest per Rule #39,
 * so this is a legitimate skip) from fixtures PRESENT but the endpoint misbehaving
 * (a real regression — must go RED, never skip).
 */
async function fixtureIsDeployed(version: number, ns: string): Promise<boolean> {
  try {
    await client.get(
      atelierPath(version, ns, `doc/${encodeURIComponent(`${FIXTURE}.cls`)}`),
    );
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  try {
    const config = getConfig();
    client = new IrisHttpClient(config);
    const available = await ping(client, 3000);
    if (!available) {
      skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT} (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    } else {
      const version = await negotiateVersion(client);
      ctx = buildToolContext("NS", config, client, version);
      if (!(await fixtureIsDeployed(version, ctx.resolveNamespace()))) {
        skipReason =
          `The reproduction fixtures are not deployed in ${ctx.resolveNamespace()} ` +
          `(${FIXTURE} not found via the Atelier API). Load src/ExecuteMCPv2/Tests/ to run the epic gate.`;
      }
    }
  } catch (error) {
    skipReason = `IRIS availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(
      `IRIS_REQUIRE_LIVE is set, so the epic-done gate may not be skipped: ${skipReason}`,
    );
  }
}, 30000);

describe("iris_execute_classmethod epic-done gate (Story 34.3 AC 34.3.4a, Rule #21 default-suite shape)", () => {
  it(
    "repro 1 — a Write-per-item narrating target returns captured output with NO wrapper class",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (repro 1): ${skipReason}`);
        testCtx.skip();
        return;
      }
      // `TargetWriteModerate` (a For loop writing one line per iteration, 300
      // iterations) is the fixture `docs/bugs-2026-08-14.md` records as standing in
      // for the reporter's patch-runner. The Write-per-ITEM VOLUME is the
      // characteristic that distinguishes this reproduction from ordinary two-line
      // capture, so the volume is asserted, not just the presence of output.
      const result = await executeClassMethodTool.handler(
        { className: FIXTURE, methodName: "TargetWriteModerate" },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        returnValue: string;
        output: string;
        truncated: boolean;
      };
      expect(structured.returnValue).toBe("wrote-moderate");
      const LINE = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
      const lines = structured.output.split("\n");
      // 300 written lines, each newline-terminated, so the trailing split entry is "".
      expect(lines).toHaveLength(301);
      expect(lines[300]).toBe("");
      expect(new Set(lines.slice(0, 300))).toEqual(new Set([LINE]));
      expect(structured.output).toHaveLength(300 * (LINE.length + 1));
      expect(structured.truncated).toBe(false);
    },
    { timeout: 30000 },
  );

  it(
    "repro 2 — the REAL %UnitTest.Manager.RunTest (InterSystems' own stock runner) narrates via its own output, captured with NO wrapper class",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (repro 2): ${skipReason}`);
        testCtx.skip();
        return;
      }
      // Called directly against the real stock class — not a project fixture, not a
      // simulation.
      //
      // The spec/qualifier form is this project's own mandated invocation (see
      // `ExecuteMCPv2.REST.UnitTest.BuildTestSpec`: a class-level run is ":"_class,
      // with "/noload/nodelete/norecursive"). Both halves are load-bearing:
      //   * ":"-prefixed spec — a BARE class name is parsed as a DIRECTORY suite, so
      //     the runner never executes a single test method; it emits a "Directory name
      //     ... is invalid" banner instead (whose text happens to contain the class
      //     name, which is why a naive toContain(className) assertion passes over a run
      //     in which nothing ran).
      //   * /nodelete — the DEFAULT semantics let the stock runner DELETE the test
      //     classes from the namespace after running. A default-suite test must never
      //     mutate the developer's instance.
      // Verified live on IRIS 2026.1: this exact call executes all 19 UtilsTest methods
      // (confirmed in ^UnitTest.Result) and emits the narration asserted below.
      const result = await executeClassMethodTool.handler(
        {
          className: "%UnitTest.Manager",
          methodName: "RunTest",
          args: [":ExecuteMCPv2.Tests.UtilsTest", "/noload/nodelete/norecursive"],
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { returnValue: unknown; output: string };
      // Every marker below is stock %UnitTest.Manager narration that CANNOT be produced
      // by echoing the caller-supplied arguments — the failure mode a `toContain(
      // "UtilsTest")` assertion cannot distinguish from a genuine capture.
      expect(structured.output).toContain("begins ...");
      expect(structured.output).toContain("Use the following URL to view the result:");
      expect(structured.output).toContain("UnitTest.Portal");
      // Proves the non-destructive qualifier actually reached the real stock runner.
      expect(structured.output).toContain("Skipping deleting classes");
      // Multi-line narration, not a one-line diagnostic.
      expect(structured.output.split("\n").length).toBeGreaterThan(5);
      expect(typeof structured.returnValue === "number" || typeof structured.returnValue === "boolean").toBe(
        true,
      );
    },
    { timeout: 60000 },
  );

  it(
    "repro 3 — a Write-narrating target that ZNs mid-execution captures output across the namespace switch, AND reads back a ByRef mutation, with NO wrapper class",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (repro 3): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const result = await executeClassMethodTool.handler(
        {
          className: FIXTURE,
          methodName: "TargetZNWriteByRef",
          args: [{ byRef: true, value: "start" }],
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        returnValue: string;
        output: string;
        byRefValues: Record<string, unknown>;
      };
      expect(structured.returnValue).toBe("zn-ok");
      expect(structured.output).toBe(`before-zn:${ctx.resolveNamespace()}\nafter-zn:USER`);
      expect(structured.byRefValues["0"]).toBe("start-zn-mutated");
    },
    { timeout: 30000 },
  );

  // ── Story 34.4 (AC 34.4.3 / 34-3-R4): AC 34.3.4 legs (b) Output-param, (c)
  // 20-arg, and (d) second-namespace joining leg (a) above in this DEFAULT-suite
  // file. Before this story these three legs lived ONLY in
  // `custom-rest.integration.test.ts`, which `vitest.config.ts` excludes from the
  // default `vitest run` (and `turbo.json`'s `test` task never invokes
  // `test:integration`) — so three-quarters of AC 34.3.4 carried the same
  // zero-protection property the Story 34.3 review rated HIGH for leg (a) alone.
  // Assertions ported verbatim from `custom-rest.integration.test.ts` (Rule #36 —
  // do not re-derive expected values). ─────────────────────────────────────────

  it(
    "leg (b) — an Output-param method returns its post-call value via byRefValues (AC 34.3.4b)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (leg b): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const result = await executeClassMethodTool.handler(
        {
          className: FIXTURE,
          methodName: "TargetOutput",
          args: [{ byRef: true }],
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        byRefValues: Record<string, unknown>;
      };
      // wasUndef=1 confirms the Output parameter arrived genuinely undefined-in.
      expect(structured.byRefValues["0"]).toBe("output-set-wasUndef1");
    },
    { timeout: 30000 },
  );

  it(
    "leg (c) — a 20-argument call dispatches and reads back every position (AC 34.3.4c)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (leg c): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const markers = Array.from({ length: 20 }, (_, i) => ({
        byRef: true,
        value: `v${i}`,
      }));
      const result = await executeClassMethodTool.handler(
        { className: FIXTURE, methodName: "Target20", args: markers },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        returnValue: string;
        byRefValues: Record<string, unknown>;
      };
      expect(structured.returnValue).toBe("20-ok");
      expect(structured.byRefValues["0"]).toBe("v0-m");
      expect(structured.byRefValues["19"]).toBe("v19-m");
    },
    { timeout: 30000 },
  );

  it(
    "leg (d) — iris_execute_classmethod works in a second, genuinely different namespace (Rule #34)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (leg d): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const result = await executeClassMethodTool.handler(
        {
          className: "%SYSTEM.Version",
          methodName: "GetVersion",
          namespace: "USER",
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const text = result.content[0]?.text ?? "";
      expect(text).toMatch(/IRIS|20\d{2}\.\d/i);
    },
    { timeout: 30000 },
  );
});
