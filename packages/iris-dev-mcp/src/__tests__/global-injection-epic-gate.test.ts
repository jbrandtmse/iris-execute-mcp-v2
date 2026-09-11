/**
 * Story 36.4 — `iris_global_get` / `iris_global_set` / `iris_global_kill`
 * subscript-injection epic-done gate, as a DEFAULT-SUITE,
 * always-discoverable process gate (Rule #21 shape, mirrors
 * `execute-classmethod-epic-gate.test.ts`'s `ctx.skip()`-on-unavailable
 * pattern).
 *
 * Ledger `36-2-CR-1` (HIGH, live-verified at the Story 36.2 review):
 * `ExecuteMCPv2.REST.Global:BuildGlobalRef` wrapped a caller-supplied string
 * subscript in quotes WITHOUT doubling a quote it contained, then the handlers
 * evaluated the reference by indirection (`$Get(@tRef)`, `Set @tRef`,
 * `Kill @tRef`). A quote inside the value closed the literal early and the rest
 * of the piece ran as ObjectScript. Because `iris_global_get` is
 * READ-classified and default-enabled (`baseline-classifications.ts`), this
 * was reachable under `IRIS_GOVERNANCE_PRESET=read-only`.
 *
 * This file is NOT named `*.integration.test.ts`, so it IS collected by the
 * default `vitest.config.ts` include glob and runs in `pnpm turbo run test`;
 * it is also armed in `scripts/prepublish-gate.mjs` (`IRIS_REQUIRE_LIVE=1`). It
 * drives the REAL production handlers (`globalGetTool`/`globalSetTool`/
 * `globalKillTool`) over real HTTP against disposable `^ZZ364Gate*` globals:
 *  - every injection payload is WRITE-shaped (`$Increment`) and names a side
 *    global, so the "no side effect" oracle can actually vary: on the pre-fix
 *    builder each executable payload increments that side global (the
 *    namespace-escape payload increments it in `%SYS`, and the gate reads it
 *    there). The "closing the ref" payload is the one exception — pre-fix it
 *    fails with `<SYNTAX>` (name indirection cannot be escaped that way), so its
 *    RED comes from the `isError` assertion, not the side-effect one;
 *  - a set through the payload round-trips (`verified`) and a kill through it
 *    removes the node that set created (kill is seeded first, so `deleted`
 *    is not vacuous);
 *  - control characters are literal data, addressed identically through the
 *    wrapped and unwrapped forms (two different builder branches);
 *  - a quoted key containing a comma (an unmatched edge quote after the comma
 *    split) is REJECTED with a clear error instead of silently addressing a
 *    different node; extended-reference / code-bearing global NAMES are
 *    rejected by `ValidateGlobalName` before the builder runs;
 *  - the SAME `iris_global_get` payload, driven through a REAL `McpServerBase`
 *    with `IRIS_GOVERNANCE_PRESET=read-only` (the real governance dispatch
 *    path), is still ALLOWED and has NO side effect, while `iris_global_set`
 *    and `iris_global_kill` are DENIED.
 *
 * Rule #59 mutation evidence (the path this gate guards is the real HTTP route
 * `/api/executemcp/v2/global`): at the Story 36.4 code review the deployed
 * `ExecuteMCPv2.REST.Global` was reverted to its pre-fix content and this file
 * was run armed — 17 of 20 tests went RED. Every executable payload failed on
 * an observed consequence of executed code (get: the side global — in `%SYS`
 * for the namespace escape — became defined; set: the verify read returned ''
 * because the evaluated subscript changed between the Set and the $Get; kill:
 * the seeded node survived for the same reason); the closing-ref payloads
 * failed on `isError` (`<SYNTAX>`); the edge-quote case failed on its error
 * text; the read-only leg failed on its side-effect assertion (the governance
 * bypass itself). The 3 that stay green on the pre-fix class are back-compat
 * pins (normal round trip, control characters as data, global-name
 * rejection). The fix was then restored and all armed gates re-run green.
 * This gate is not self-mutating — reverting production code inside a
 * permanent suite would itself be a footgun.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  IrisHttpClient,
  loadConfig,
  ping,
  negotiateVersion,
  buildToolContext,
  McpServerBase,
  type ToolContext,
  type McpServerBaseOptions,
  type ToolDefinition,
} from "@iris-mcp/shared";
import { globalGetTool, globalSetTool, globalKillTool } from "../tools/global.js";

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

/**
 * Opt-in CI switch: when set, an unavailable environment is a hard FAILURE
 * rather than a skip (mirrors `execute-classmethod-epic-gate.test.ts`).
 */
const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

let skipReason: string | undefined;
let ctx: ToolContext;
let client: IrisHttpClient;

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

/** Read a global's `defined` flag via the real handler (never via raw ObjectScript). */
async function isDefined(globalName: string, namespace?: string): Promise<boolean> {
  const result = await globalGetTool.handler(
    namespace ? { global: globalName, namespace } : { global: globalName },
    ctx,
  );
  const structured = result.structuredContent as { defined: boolean };
  return structured.defined;
}

async function killDisposable(globalName: string, namespace?: string): Promise<void> {
  await globalKillTool.handler(
    namespace ? { global: globalName, namespace } : { global: globalName },
    ctx,
  );
}

function errorText(result: { content?: Array<{ text?: string }> }): string {
  return result.content?.[0]?.text ?? "";
}

interface InjectionCase {
  name: string;
  /** The malicious `subscripts` value — names `SIDE_GLOBAL` inside its own text. */
  subscripts: string;
  /** Namespace the payload would write the side global into (default: the configured one). */
  sideNamespace?: string;
}

const SIDE_GLOBAL = "ZZ364GateSide";
const TARGET_GLOBAL = "ZZ364GateTarget";

/** Story 36.4 Dev Notes payload table, write-shaped (code-review revision). */
const INJECTION_CASES: InjectionCase[] = [
  {
    name: "quote breakout + side effect ($Increment)",
    subscripts: `x"_$Increment(^${SIDE_GLOBAL})_"x`,
  },
  {
    name: "quote breakout closing the ref",
    subscripts: `a")_$Increment(^${SIDE_GLOBAL})_("b`,
  },
  {
    name: "nested indirection",
    subscripts: `x"_$Increment(@("^${SIDE_GLOBAL}"))_"x`,
  },
  {
    name: "namespace escape via extended reference",
    subscripts: `x"_$Increment(^|"%SYS"|${SIDE_GLOBAL})_"x`,
    sideNamespace: "%SYS",
  },
  {
    name: "quote-wrapped concatenation",
    subscripts: `"a"_$Increment(^${SIDE_GLOBAL})_"b"`,
  },
];

async function sideDefined(injectionCase: InjectionCase): Promise<boolean> {
  return isDefined(SIDE_GLOBAL, injectionCase.sideNamespace);
}

async function resetDisposables(): Promise<void> {
  await killDisposable(SIDE_GLOBAL);
  await killDisposable(SIDE_GLOBAL, "%SYS");
  await killDisposable(TARGET_GLOBAL);
}

describe("global subscript-injection epic-done gate (Story 36.4, ledger 36-2-CR-1, Rule #21 default-suite shape)", () => {
  afterAll(async () => {
    if (skipReason) return;
    await resetDisposables();
  });

  for (const injectionCase of INJECTION_CASES) {
    it(`iris_global_get: "${injectionCase.name}" is addressed as literal data, no side effect`, async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] global-injection epic gate: ${skipReason}`);
        testCtx.skip();
        return;
      }
      await resetDisposables();

      const result = await globalGetTool.handler(
        { global: TARGET_GLOBAL, subscripts: injectionCase.subscripts },
        ctx,
      );
      expect(result.isError).toBeFalsy();
      // The literal subscript was never set — reading it must report
      // undefined, NOT the side effect of executed code.
      expect((result.structuredContent as { defined: boolean }).defined).toBe(false);
      expect(await sideDefined(injectionCase)).toBe(false);
    });

    it(`iris_global_set: "${injectionCase.name}" is addressed as literal data, no side effect`, async (testCtx) => {
      if (skipReason) {
        testCtx.skip();
        return;
      }
      await resetDisposables();

      const result = await globalSetTool.handler(
        { global: TARGET_GLOBAL, subscripts: injectionCase.subscripts, value: "literalValue" },
        ctx,
      );
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { value: string; verified: boolean };
      expect(structured.value).toBe("literalValue");
      expect(structured.verified).toBe(true);
      expect(await sideDefined(injectionCase)).toBe(false);

      await killDisposable(TARGET_GLOBAL);
    });

    it(`iris_global_kill: "${injectionCase.name}" removes exactly the literal node, no side effect`, async (testCtx) => {
      if (skipReason) {
        testCtx.skip();
        return;
      }
      await resetDisposables();

      // Seed the literal node first so `deleted` is not vacuous.
      const seed = await globalSetTool.handler(
        { global: TARGET_GLOBAL, subscripts: injectionCase.subscripts, value: "seeded" },
        ctx,
      );
      expect(seed.isError).toBeFalsy();
      expect(await isDefined(TARGET_GLOBAL)).toBe(true);

      const result = await globalKillTool.handler(
        { global: TARGET_GLOBAL, subscripts: injectionCase.subscripts },
        ctx,
      );
      expect(result.isError).toBeFalsy();
      expect((result.structuredContent as { deleted: boolean }).deleted).toBe(true);
      expect(await isDefined(TARGET_GLOBAL)).toBe(false);
      expect(await sideDefined(injectionCase)).toBe(false);
    });
  }

  it("a normal (non-malicious) set/get/kill round trip through the fixed builder still works", async (testCtx) => {
    if (skipReason) {
      testCtx.skip();
      return;
    }
    await killDisposable(TARGET_GLOBAL);

    const setResult = await globalSetTool.handler(
      { global: TARGET_GLOBAL, subscripts: `"key1","key2"`, value: "normalValue" },
      ctx,
    );
    expect(setResult.isError).toBeFalsy();
    expect((setResult.structuredContent as { verified: boolean }).verified).toBe(true);

    const getResult = await globalGetTool.handler(
      { global: TARGET_GLOBAL, subscripts: `"key1","key2"` },
      ctx,
    );
    expect((getResult.structuredContent as { value: string; defined: boolean }).value).toBe(
      "normalValue",
    );
    expect((getResult.structuredContent as { value: string; defined: boolean }).defined).toBe(
      true,
    );

    const killResult = await globalKillTool.handler(
      { global: TARGET_GLOBAL, subscripts: `"key1","key2"` },
      ctx,
    );
    expect((killResult.structuredContent as { deleted: boolean }).deleted).toBe(true);
    expect(await isDefined(TARGET_GLOBAL)).toBe(false);
  });

  it("control characters are literal data, addressed identically through the wrapped and unwrapped forms", async (testCtx) => {
    if (skipReason) {
      testCtx.skip();
      return;
    }
    await killDisposable(TARGET_GLOBAL);
    const value = "a\nb\u0001c";

    const setResult = await globalSetTool.handler(
      { global: TARGET_GLOBAL, subscripts: value, value: "ctl" },
      ctx,
    );
    expect(setResult.isError).toBeFalsy();
    expect((setResult.structuredContent as { verified: boolean }).verified).toBe(true);

    // Read back through the OTHER builder branch (quote-wrapped).
    const getResult = await globalGetTool.handler(
      { global: TARGET_GLOBAL, subscripts: `"${value}"` },
      ctx,
    );
    expect(getResult.isError).toBeFalsy();
    expect((getResult.structuredContent as { value: string }).value).toBe("ctl");

    const killResult = await globalKillTool.handler(
      { global: TARGET_GLOBAL, subscripts: `"${value}"` },
      ctx,
    );
    expect(killResult.isError).toBeFalsy();
    expect(await isDefined(TARGET_GLOBAL)).toBe(false);
  });

  it("a quoted key containing a comma is rejected with a clear error, not silently mis-addressed", async (testCtx) => {
    if (skipReason) {
      testCtx.skip();
      return;
    }
    await killDisposable(TARGET_GLOBAL);

    const result = await globalSetTool.handler(
      { global: TARGET_GLOBAL, subscripts: `"a,b"`, value: "should-not-write" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(errorText(result)).toContain("unmatched quote");
    expect(await isDefined(TARGET_GLOBAL)).toBe(false);
  });

  it("extended-reference and code-bearing global NAMES are rejected before the builder runs", async (testCtx) => {
    if (skipReason) {
      testCtx.skip();
      return;
    }
    await resetDisposables();

    for (const badName of [
      `|"%SYS"|${SIDE_GLOBAL}`,
      `${TARGET_GLOBAL}(1)`,
      `${TARGET_GLOBAL}"_$Increment(^${SIDE_GLOBAL})_"`,
    ]) {
      const result = await globalGetTool.handler({ global: badName }, ctx);
      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain("Invalid global name");
    }
    expect(await isDefined(SIDE_GLOBAL)).toBe(false);
    expect(await isDefined(SIDE_GLOBAL, "%SYS")).toBe(false);
  });

  // ── Read-only-preset governance bypass (AC 36.4.4) ──────────────────
  //
  // Drives the SAME quote-breakout payload through a REAL `McpServerBase`
  // constructed with `IRIS_GOVERNANCE_PRESET=read-only`, over real HTTP —
  // the real governance dispatch path, not a mocked fetch. Proves BOTH
  // halves of the story: `iris_global_get` stays ALLOWED (a read-only
  // preset must not disable reads) AND the injection payload produces NO
  // side effect (the fix closes the bypass governance could not).
  describe("read-only-preset governance path (AC 36.4.4)", () => {
    function makeServerOpts(tools: ToolDefinition[]): McpServerBaseOptions {
      return { name: "@iris-mcp/dev", version: "0.0.0", tools, needsCustomRest: false };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function callTool(server: any, name: string, args: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdkTools = (server.server as any)._registeredTools;
      const entry = sdkTools[name];
      const callback = entry.callback ?? entry.handler ?? entry.cb;
      return callback(args);
    }

    it("iris_global_get is ALLOWED under read-only and the injection payload has no side effect; iris_global_set and iris_global_kill are DENIED", async (testCtx) => {
      if (skipReason) {
        testCtx.skip();
        return;
      }
      await resetDisposables();

      // `McpServerBase.start()` calls the shared `loadConfig()` with NO
      // arguments (reads straight from `process.env`), unlike this file's
      // own `getConfig()` helper above — so the connection env vars must
      // be set for real here. Ambient governance / visibility / profile
      // settings are cleared too: an explicit `IRIS_GOVERNANCE` override wins
      // over the preset, and a tools preset could hide the tools under test.
      const neutralized = [
        "IRIS_GOVERNANCE",
        "IRIS_GOVERNANCE_FILE",
        "IRIS_PROFILES",
        "IRIS_TOOLS_PRESET",
        "IRIS_TOOLS_ENABLE",
        "IRIS_TOOLS_DISABLE",
      ];
      const managed = [
        ...neutralized,
        "IRIS_GOVERNANCE_PRESET",
        "IRIS_HOST",
        "IRIS_PORT",
        "IRIS_USERNAME",
        "IRIS_PASSWORD",
        "IRIS_NAMESPACE",
        "IRIS_HTTPS",
      ];
      const savedEnv = Object.fromEntries(managed.map((key) => [key, process.env[key]]));
      for (const key of neutralized) delete process.env[key];
      process.env.IRIS_GOVERNANCE_PRESET = "read-only";
      process.env.IRIS_HOST = IRIS_HOST;
      process.env.IRIS_PORT = IRIS_PORT;
      process.env.IRIS_USERNAME = IRIS_USERNAME;
      process.env.IRIS_PASSWORD = IRIS_PASSWORD;
      process.env.IRIS_NAMESPACE = IRIS_NAMESPACE;
      process.env.IRIS_HTTPS = "false";
      let server: McpServerBase | undefined;
      try {
        server = new McpServerBase(makeServerOpts([globalGetTool, globalSetTool, globalKillTool]));
        await server.start("stdio");

        // Write-classified tools must be denied under read-only, proving the
        // governance gate this test drives through is genuinely armed.
        const setResult = await callTool(server, "iris_global_set", {
          global: TARGET_GLOBAL,
          value: "should-not-write",
        });
        expect(setResult.isError).toBe(true);
        expect(setResult.structuredContent).toMatchObject({
          code: "GOVERNANCE_DISABLED",
          action: "iris_global_set",
          presetApplied: "read-only",
        });
        const killResult = await callTool(server, "iris_global_kill", { global: TARGET_GLOBAL });
        expect(killResult.isError).toBe(true);
        expect(killResult.structuredContent).toMatchObject({
          code: "GOVERNANCE_DISABLED",
          action: "iris_global_kill",
          presetApplied: "read-only",
        });

        // `get` is read-classified — must stay allowed. The injection
        // payload must still produce NO side effect (the actual fix).
        const injectionCase = INJECTION_CASES[0];
        if (!injectionCase) throw new Error("unreachable — INJECTION_CASES is non-empty");
        const getResult = await callTool(server, "iris_global_get", {
          global: TARGET_GLOBAL,
          subscripts: injectionCase.subscripts,
        });
        expect(getResult.isError).toBeFalsy();
        expect((getResult.structuredContent as { defined: boolean }).defined).toBe(false);
        expect(await sideDefined(injectionCase)).toBe(false);
      } finally {
        if (server) await server.stop();
        for (const [key, value] of Object.entries(savedEnv)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        await resetDisposables();
      }
    });
  });
});
