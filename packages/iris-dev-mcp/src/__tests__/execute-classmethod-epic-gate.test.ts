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
  IrisApiError,
  IrisHttpClient,
  atelierPath,
  loadConfig,
  ping,
  negotiateVersion,
  buildToolContext,
  type ToolContext,
} from "@iris-mcp/shared";
import { executeClassMethodTool, executeCommandTool } from "../tools/execute.js";

const IRIS_HOST = process.env.IRIS_HOST ?? "localhost";
const IRIS_PORT = process.env.IRIS_PORT ?? "52773";
const IRIS_USERNAME = process.env.IRIS_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_NAMESPACE ?? "HSCUSTOM";

/**
 * Mirrors `execute.ts`'s own module-private `BASE_URL` (not exported — that file has
 * no reason to export it, since every other caller goes through `ctx.http`). Story
 * 34.7 leg (e-5) is the one place in this file that deliberately bypasses `ctx.http`
 * (see that leg's own comment for why), so it needs the literal path itself.
 */
const BASE_URL = "/api/executemcp/v2";

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
/** Set once `ping` confirms basic connectivity — independent of `skipReason`, which
 * also covers the (unrelated) "fixtures not deployed" case below. Gates the
 * `fixtureIsDeployed` discrimination tests, which need a genuinely live client but
 * not the reproduction fixtures themselves. */
let irisReachable = false;

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
 *
 * Story 34.6 AC 34.6.3 (ledger 34-4-R3): only a genuine "this document does not
 * exist" — Atelier's own not-found signal, the SAME `IrisApiError.statusCode === 404`
 * check this repo already uses for the identical existence check in `doc.ts`'s
 * `iris_doc_get` and in every package's `integration-setup.ts` — is a legitimate
 * reason to report "fixtures not deployed" and skip gracefully. Anything else — a
 * credential fault (401/403), a network failure, a licence error, a 500 — is
 * RE-THROWN so `beforeAll`'s catch reports the REAL reason instead of collapsing
 * every possible failure into a misleading "fixtures not deployed" message, and so
 * `IRIS_REQUIRE_LIVE=1` fails loudly on the true cause instead of misdiagnosing it.
 */
async function fixtureIsDeployed(version: number, ns: string): Promise<boolean> {
  try {
    await client.get(
      atelierPath(version, ns, `doc/${encodeURIComponent(`${FIXTURE}.cls`)}`),
    );
    return true;
  } catch (error) {
    if (error instanceof IrisApiError && error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

beforeAll(async () => {
  try {
    const config = getConfig();
    client = new IrisHttpClient(config);
    const available = await ping(client, 3000);
    irisReachable = available;
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

  it(
    "repro 3b — several ZN switches interleaved with narration and a ByRef mutation between each (Story 36.3, ledger 34-1-R16 — repro 3's own shape, not the single-switch simplification above)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (repro 3b): ${skipReason}`);
        testCtx.skip();
        return;
      }
      // TargetMultiZNInterleaved: start -> ZN USER -> ZN %SYS -> ZN USER, writing
      // narration and mutating the ByRef argument between EVERY switch — the actual
      // bug-report repro 3 shape (several switches), which repro 3 above simplifies to
      // a single switch. `ctx.resolveNamespace()` is the configured default (HSCUSTOM).
      const origNs = ctx.resolveNamespace();
      const result = await executeClassMethodTool.handler(
        {
          className: FIXTURE,
          methodName: "TargetMultiZNInterleaved",
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
      expect(structured.returnValue).toBe("multizn-ok");
      expect(structured.output).toBe(
        `start:${origNs}\nmid1:USER\nmid2:%SYS\nend:USER`,
      );
      expect(structured.byRefValues["0"]).toBe("start-mid1-mid2-end");
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
      // Ledger 34-4-R2: the test's own title claims "every position" but the body
      // used to check only 0 and 19 — positions 1-18 could silently be wrong (or
      // missing) and this test would still pass. Loop every position AND assert
      // the exact key count, so a silently-OMITTED position is caught too, not
      // just a wrong value at a spot-checked index.
      for (let i = 0; i < 20; i++) {
        expect(structured.byRefValues[String(i)]).toBe(`v${i}-m`);
      }
      expect(Object.keys(structured.byRefValues)).toHaveLength(20);
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
      // Story 34.6 AC 34.6.2 (ledger 34-4-R1): %SYSTEM.Version.GetVersion() returns
      // the SAME string in every namespace, so this leg could not fail for the
      // property it claims — a regression dropping `namespace` entirely would still
      // pass. The oracle below echoes $NAMESPACE, so the assertion genuinely requires
      // the namespace parameter to have reached the server AND been applied
      // (Rules #34/#40): it must equal the requested namespace and must NOT equal the
      // configured default namespace this ctx would otherwise resolve to.
      //
      // Code review (Story 34.6) hardened this leg against two false-RED modes that
      // would BLOCK the release, since `prepublishOnly` now runs this file:
      //   1. The second namespace is DERIVED, not hard-coded to "USER". This package's
      //      own README documents `IRIS_NAMESPACE` default as `USER` and every example
      //      client config sets it, so a publisher following the README made the two
      //      assertions below mutually unsatisfiable ("expected 'USER' not to be
      //      'USER'") on a perfectly working system — verified live.
      //   2. The target is `%SYSTEM.SYS.NameSpace`, a system class present in EVERY
      //      namespace, rather than `ExecuteMCPv2.Tests.ClassMethodArgsFixture`. The
      //      fixture is deliberately excluded from the bootstrap manifest (Rule #39)
      //      and `beforeAll`'s probe only checks the CONFIGURED namespace, so a leg
      //      calling it in a different namespace depended on an unstated cross-namespace
      //      mapping — on a clean instance loaded per the repo's own instructions it
      //      would go RED as "<CLASS DOES NOT EXIST>". Verified live that
      //      `%SYSTEM.SYS.NameSpace` returns "USER"/"%SYS"/"HSCUSTOM" correctly.
      // The mutation property AC 34.6.2 requires is preserved: dropping `namespace`
      // still turns this leg RED (re-verified after the change).
      const configuredNamespace = ctx.resolveNamespace();
      const secondNamespace =
        configuredNamespace.toUpperCase() === "USER" ? "%SYS" : "USER";
      const result = await executeClassMethodTool.handler(
        {
          className: "%SYSTEM.SYS",
          methodName: "NameSpace",
          namespace: secondNamespace,
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { returnValue: string };
      expect(structured.returnValue).toBe(secondNamespace);
      expect(structured.returnValue).not.toBe(configuredNamespace);
    },
    { timeout: 30000 },
  );

  // ── Story 34.6 AC 34.6.1/34.6.5 — response-payload ceiling, pinned at the
  //    REAL endpoint (added in code review) ──────────────────────────────────
  //
  // WHY THIS EXISTS. Before this leg, the story's headline feature had NO
  // regression coverage at its integration point. Every ceiling test either
  // called `ExecuteMCPv2.Utils.ApplyOutputCeiling` directly or re-implemented
  // `Execute()`'s sequence itself ("Mirror Execute()'s post-capture ceiling
  // application exactly"), and the TS tests fed a MOCKED over-ceiling envelope.
  // The two lines that actually ship the feature — the `ApplyOutputCeiling`
  // calls in `ExecuteMCPv2.REST.Command`'s `Execute()` and `ClassMethod()` —
  // were asserted by nothing. Code review proved this by deleting BOTH calls,
  // recompiling, and confirming the live `/command` endpoint returned 50,000
  // untruncated characters while `ExecuteMCPv2.Tests.CommandTest` (18/18), the
  // full `@iris-mcp/dev` vitest suite (643/643) and `custom-rest.integration`
  // (12/12) all stayed GREEN.
  //
  // This leg drives the deployed endpoints through the real tool handlers, so
  // removing either wiring turns it RED. It lives in this file deliberately:
  // this file is in the DEFAULT suite (not `*.integration.test.ts`) and is the
  // file `scripts/prepublish-gate.mjs` runs with `IRIS_REQUIRE_LIVE=1`, so the
  // pin is armed on the packaging path too.
  it(
    "leg (e) — the response-payload ceiling is actually wired into BOTH deployed endpoints (AC 34.6.1), and under-ceiling responses stay byte-identical (AC 34.6.5 / Rule #19)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (leg e): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const CEILING = 32768;

      // (1) /command OVER the ceiling — proves Execute()'s wiring is present.
      const overCommand = await executeCommandTool.handler(
        { command: 'Write $TR($J("",50000)," ","Q")' },
        ctx,
      );
      const overCommandOut = (
        overCommand.structuredContent as { output: string; truncated: boolean }
      );
      expect(overCommandOut.output.length).toBe(CEILING);
      expect(overCommandOut.output).toContain("[IRIS-MCP-TRUNCATED");
      expect(overCommandOut.truncated).toBe(true);

      // (2) /command UNDER the ceiling — Rule #19 byte-identity at the endpoint.
      const underCommand = await executeCommandTool.handler(
        { command: 'Write "hello world under ceiling"' },
        ctx,
      );
      const underCommandOut = (
        underCommand.structuredContent as { output: string; truncated: boolean }
      );
      expect(underCommandOut.output).toBe("hello world under ceiling");
      expect(underCommandOut.truncated).toBe(false);

      // (3) /classmethod OVER the ceiling — proves ClassMethod()'s wiring is
      //     present. TargetWriteOverCeiling writes 50,000 characters and returns
      //     "wrote-over-ceiling" (18 chars). Story 34.7 AC 34.7.3: returnValue,
      //     byRefValues, and output now share ONE 32768-character budget, spent in
      //     that field order — returnValue is first, so it consumes 19 of the
      //     budget (untouched, well under 32768), leaving CEILING - 19 for output
      //     (there is no byRefValues competitor here — no byRef args). Derived from
      //     the fixture's own known-fixed return string, never hard-coded, so this
      //     stays correct if the ceiling itself is ever tuned.
      const overClassMethod = await executeClassMethodTool.handler(
        { className: FIXTURE, methodName: "TargetWriteOverCeiling" },
        ctx,
      );
      const overCm = overClassMethod.structuredContent as {
        output: string;
        truncated: boolean;
        returnValue: string;
      };
      expect(overCm.returnValue).toBe("wrote-over-ceiling");
      const expectedOutputBudget = CEILING - overCm.returnValue.length;
      expect(overCm.output.length).toBe(expectedOutputBudget);
      expect(overCm.output).toContain("[IRIS-MCP-TRUNCATED");
      expect(overCm.truncated).toBe(true);

      // (4) /classmethod UNDER the ceiling — Rule #19 byte-identity, and the
      //     additive byRefTruncated field present and false.
      const underClassMethod = await executeClassMethodTool.handler(
        { className: FIXTURE, methodName: "TargetWriteModerate" },
        ctx,
      );
      const underCm = underClassMethod.structuredContent as {
        truncated: boolean;
        byRefTruncated: boolean;
        returnValue: string;
      };
      expect(underCm.returnValue).toBe("wrote-moderate");
      expect(underCm.truncated).toBe(false);
      expect(underCm.byRefTruncated).toBe(false);
    },
    { timeout: 30000 },
  );

  // ── Story 34.6 code-review finding CR-5 (HIGH, review-continuation pass) ──
  //
  // WHY THIS EXISTS. leg (e) above proved the ceiling is wired onto `output` on both
  // endpoints, but `returnValue` — the PRIMARY payload field on `/classmethod` — had
  // ZERO coverage of its own: the reviewer shipped a live 1,000,000-character
  // `returnValue` with `truncated:false`. Following the SAME Rule #54 lesson leg (e)
  // itself exists to enforce, this drives the REAL deployed endpoint rather than
  // re-implementing `ClassMethod()`'s sequence in a unit test, so deleting the fix's
  // wiring turns this RED, not just a re-implementation of the fix.
  it(
    "leg (e-2) — returnValue is now bounded by the same ceiling on /classmethod (34-6-CR-5), and under-ceiling responses stay byte-identical (Rule #19)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (leg e-2): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const CEILING = 32768;

      // (1) returnValue OVER the ceiling — TargetReturnOverCeiling returns 50,000 chars
      //     directly (not via Write), isolating this ceiling from the output one.
      const overReturn = await executeClassMethodTool.handler(
        { className: FIXTURE, methodName: "TargetReturnOverCeiling" },
        ctx,
      );
      expect(overReturn.isError).toBeUndefined();
      const overRc = overReturn.structuredContent as {
        returnValue: string;
        returnValueTruncated: boolean;
      };
      expect(overRc.returnValue.length).toBe(CEILING);
      expect(overRc.returnValue).toContain("[IRIS-MCP-TRUNCATED");
      expect(overRc.returnValueTruncated).toBe(true);

      // (2) returnValue UNDER the ceiling — Rule #19 byte-identity, and the additive
      //     returnValueTruncated field present and false.
      const underReturn = await executeClassMethodTool.handler(
        { className: FIXTURE, methodName: "TargetReturnNamespace" },
        ctx,
      );
      expect(underReturn.isError).toBeUndefined();
      const underRc = underReturn.structuredContent as {
        returnValue: string;
        returnValueTruncated: boolean;
      };
      expect(underRc.returnValue).toBe(ctx.resolveNamespace());
      expect(underRc.returnValueTruncated).toBe(false);
    },
    { timeout: 30000 },
  );

  // ── Story 34.6 code-review finding CR-6 (HIGH, review-continuation pass) ──
  //
  // WHY THIS EXISTS. Code review reproduced live, with this exact fixture (Target20,
  // one huge Output value followed by several small ones), that once the shared
  // byRefValues byte budget was exhausted, positions 1-3's small real values
  // ("42-m", "hello-m", "x-m") were DESTROYED and replaced with ~37-char elision
  // markers — larger than the values they replaced — pushing the total content past
  // the documented 32768-char budget. This leg drives the REAL deployed endpoint with
  // the review's own repro shape, so deleting the fix (either the ApplyOutputCeiling
  // marker-vs-ceiling guard, or the AddByRefPosition top-level omission guard) turns
  // it RED.
  it(
    "leg (e-3) — the byRef byte budget no longer destroys small values with oversized markers, and never exceeds its stated budget (34-6-CR-6)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (leg e-3): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const CEILING = 32768;
      const huge = "H".repeat(40000);
      const result = await executeClassMethodTool.handler(
        {
          className: FIXTURE,
          methodName: "Target20",
          args: [
            { byRef: true, value: huge },
            { byRef: true, value: "42" },
            { byRef: true, value: "hello" },
            { byRef: true, value: "x" },
          ],
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        returnValue: string;
        byRefValues: Record<string, unknown>;
        byRefTruncated: boolean;
      };
      expect(structured.byRefTruncated).toBe(true);
      // Story 34.7 AC 34.7.3: returnValue ("20-ok") is first in the shared-budget
      // priority order and is well under budget, so it is untouched — but it still
      // consumes its own length from the ONE shared 32768-character pool, leaving
      // byRefValues (second in priority) with CEILING minus that, not the full
      // CEILING. Derived from the actual observed returnValue, never hard-coded.
      const byRefSharedBudget = CEILING - structured.returnValue.length;
      expect((structured.byRefValues["0"] as string).length).toBe(byRefSharedBudget);

      // The exact code-review repro: positions 1-3's small values ("42-m", "hello-m",
      // "x-m") must be OMITTED once the shared budget is exhausted — never replaced by
      // a marker LARGER than the value it would have destroyed.
      expect("1" in structured.byRefValues).toBe(false);
      expect("2" in structured.byRefValues).toBe(false);
      expect("3" in structured.byRefValues).toBe(false);

      // The combined content across every surviving position must never exceed
      // byRefValues' own share of the documented budget — the "response grew while
      // losing data" defect.
      const totalLen = Object.values(structured.byRefValues)
        .filter((v): v is string => typeof v === "string")
        .reduce((sum, v) => sum + v.length, 0);
      expect(totalLen).toBeLessThanOrEqual(byRefSharedBudget);
    },
    { timeout: 30000 },
  );

  // ── Story 34.6 code-review finding CR-6, second half (HIGH, review-continuation pass) ──
  //
  // WHY THIS EXISTS. leg (e-3) above drives the exact code-review repro, where position 0
  // exhausts the shared budget down to EXACTLY zero — a case the AddByRefPosition
  // top-level omission guard alone fully protects (it skips every later position before
  // ever calling ApplyOutputCeiling again). That leaves the OTHER half of the CR-6 fix —
  // ApplyOutputCeiling's own marker-vs-ceiling guard, which matters whenever a position is
  // truncated against a SMALL BUT POSITIVE remaining budget rather than an already-zero
  // one — genuinely unexercised at the endpoint (confirmed while building this leg: with
  // only the ApplyOutputCeiling half of the fix reverted, leg (e-3) stayed GREEN even
  // though the underlying defect was back, because AddByRefPosition's guard short-circuits
  // before the buggy code path is ever reached in that specific scenario). This leg closes
  // that gap: position 0 leaves a small POSITIVE remainder (20 chars, smaller than the
  // ~38-character marker at that ceiling) rather than exactly zero, so position 1 is
  // truncated THROUGH ApplyOutputCeiling itself.
  //
  // Story 34.7 AC 34.7.3: returnValue, byRefValues, and output now share ONE 32768-char
  // budget (spent returnValue -> byRefValues -> output), so byRefValues' OWN starting
  // budget is CEILING minus Target20's known "20-ok" return value (5 chars), not the
  // full CEILING. raw0's length is derived from that — never hard-coded — so this leg
  // does not go stale if the ceiling or the fixture's return string ever change.
  it(
    "leg (e-4) — a small POSITIVE remaining byRef budget (smaller than the marker) hard-cuts with no marker, never exceeding the ceiling or the original value (34-6-CR-6)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (leg e-4): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const CEILING = 32768;
      const RETURN_VALUE = "20-ok"; // Target20's own known, fixed return value
      const MUTATE_SUFFIX = "-m"; // Target20 appends this to every byRef value
      const REMAINING_BUDGET_TARGET = 20; // smaller than the ~38-char marker, deliberately positive
      const byRefSharedBudget = CEILING - RETURN_VALUE.length;

      // Position 0: mutated length (raw + "-m" suffix) is chosen so it stays UNDER
      // byRefSharedBudget (no truncation), leaving exactly REMAINING_BUDGET_TARGET
      // characters for the next position — smaller than the ~38-character elision
      // marker, so position 1 below cannot be truncated via the marker path without
      // exceeding its own remaining budget.
      const position0MutatedLen = byRefSharedBudget - REMAINING_BUDGET_TARGET;
      const raw0 = "P".repeat(position0MutatedLen - MUTATE_SUFFIX.length);
      // Position 1: mutated length (30 + 2 = 32) exceeds the 20-char remaining budget,
      // forcing truncation. All 30 raw characters are "Q", so the first 20 characters of
      // the mutated value are unambiguous regardless of exactly where the cut lands.
      const raw1 = "Q".repeat(30);
      const result = await executeClassMethodTool.handler(
        {
          className: FIXTURE,
          methodName: "Target20",
          args: [
            { byRef: true, value: raw0 },
            { byRef: true, value: raw1 },
          ],
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        returnValue: string;
        byRefValues: Record<string, unknown>;
        byRefTruncated: boolean;
      };
      // Sanity check on the setup — if Target20's return value ever changes, this leg's
      // arithmetic above (derived from RETURN_VALUE) would silently stop matching reality.
      expect(structured.returnValue).toBe(RETURN_VALUE);
      // Position 0 was never truncated at all (sanity check on the setup).
      expect(structured.byRefValues["0"]).toBe(raw0 + MUTATE_SUFFIX);
      // Position 1 must be a plain 20-character hard cut — a genuine PREFIX of its own
      // mutated value, never the marker (which would be 38 characters, bigger than both
      // the 20-char budget AND, being a fabricated string, not a real prefix at all).
      const pos1 = structured.byRefValues["1"] as string;
      expect(pos1.length).toBe(REMAINING_BUDGET_TARGET);
      expect(pos1).toBe("Q".repeat(REMAINING_BUDGET_TARGET));
      expect(pos1).not.toContain("[IRIS-MCP-TRUNCATED");
      expect(structured.byRefTruncated).toBe(true);
      // The total across both positions lands exactly on byRefValues' own share of the
      // shared budget — nothing was wasted, and nothing exceeded it.
      const totalLen = (structured.byRefValues["0"] as string).length + pos1.length;
      expect(totalLen).toBe(byRefSharedBudget);
    },
    { timeout: 30000 },
  );

  // ── Story 34.7 AC 34.7.1 + 34.7.2 (ledger 34-6-CR-10) — surrogate-safe truncation,
  //    pinned on the ACTUAL WIRE BYTES with a strict decoder ─────────────────────
  //
  // WHY THIS EXISTS. The Story 34.6 pin for this exact defect
  // (`UtilsTest.TestApplyOutputCeilingMidSurrogatePairStaysValidJSON`) round-tripped
  // through %ToJSON/%FromJSON INSIDE IRIS — a closed loop that tolerates IRIS's own
  // WTF-8 encoding of an unpaired surrogate and is structurally blind to what actually
  // reaches an HTTP client (Rules #36/#54). Live-verified during this story: with the
  // cut landing on a high surrogate, the raw response body is invalid UTF-8 (IRIS emits
  // the lone D83D high surrogate as WTF-8 ED A0 BD); Node's own lenient `response.text()`
  // (used by `ctx.http` / `IrisHttpClient`) silently substitutes 3 x U+FFFD, inflating
  // the client-visible length from 32768 to 32,770 — breaking the "capped at 32768"
  // claim outright. AC 34.7.2 requires decoding the ACTUAL bytes that left the server
  // with a STRICT decoder, so this leg deliberately bypasses `ctx.http`/`IrisHttpClient`
  // entirely (which would hide the defect exactly like the Story 34.6 pin did) and
  // issues its own raw `fetch`, reading `response.arrayBuffer()` rather than
  // `response.text()`.
  //
  // The command builds a long, solid run of surrogate pairs starting at position 1
  // (high, low, high, low, ...) via `Write` — deterministic content, not a fixture
  // method, so no server redeploy is required to exercise this. `/command` (not
  // `/classmethod`) is used deliberately: it has no returnValue/byRefValues to share
  // the response budget with, so `output`'s ceiling is always the full, predictable
  // 32768 characters, keeping this leg's oracle independent of the AC 34.7.3 shared
  // budget this same story also introduces.
  it(
    "leg (e-5) — a truncation cut through a surrogate pair emits valid UTF-8 on the wire, decoded with a strict decoder (AC 34.7.1 + AC 34.7.2, ledger 34-6-CR-10)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (leg e-5): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const config = getConfig();
      const auth = Buffer.from(`${config.username}:${config.password}`).toString("base64");
      // 20000 repeated (high, low) surrogate pairs = 40000 characters, comfortably past
      // the 32768-char ceiling, with EVERY odd position a high surrogate and EVERY even
      // position a low surrogate — deterministically exercising the exact defect
      // trigger regardless of the ceiling/marker's own exact digit-length arithmetic.
      const command =
        'Set s="" For i=1:1:20000 { Set s=s_$Char(55357)_$Char(56832) } Write s';
      const response = await fetch(`${config.baseUrl}${BASE_URL}/command`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ command, namespace: ctx.resolveNamespace() }),
      });
      expect(response.status).toBe(200);
      const bytes = new Uint8Array(await response.arrayBuffer());

      // The AC 34.7.2 property itself: the ACTUAL bytes that left the server must be
      // valid UTF-8 under a STRICT (fatal) decoder — not Node's lenient default, which
      // is exactly what let the Story 34.6 pin miss this defect at the tool layer.
      const strictDecoder = new TextDecoder("utf-8", { fatal: true });
      let text = "";
      expect(() => {
        text = strictDecoder.decode(bytes);
      }).not.toThrow();

      const envelope = JSON.parse(text) as {
        result: { output: string; truncated: boolean };
      };
      expect(envelope.result.truncated).toBe(true);
      // The AC 34.7.1 property: the client-visible length is genuinely <= the
      // advertised ceiling — the pre-fix defect inflated a clean 32768-character cut to
      // 32,770 once Node's lenient decoder substituted the orphaned surrogate.
      expect(envelope.result.output.length).toBeLessThanOrEqual(32768);
      expect(envelope.result.output).toContain("[IRIS-MCP-TRUNCATED");
    },
    { timeout: 30000 },
  );

  // ── Story 34.7 AC 34.7.3 (ledger 34-6-CR2-6) — shared-budget PRIORITY ORDER,
  //    proven end-to-end at the real endpoint with ALL THREE fields competing ──────
  //
  // WHY THIS EXISTS. legs (e)/(e-3)/(e-4) above each exercise ONE pairwise interaction
  // (returnValue-vs-output, returnValue-vs-byRefValues). This leg drives the full
  // three-way contract in a single call: TargetReturnHugeWriteAndByRef both writes
  // narration AND mutates a ByRef argument AND returns a value alone longer than the
  // WHOLE shared budget — proving returnValue (first in priority) consumes the entire
  // budget by itself, so byRefValues (second) and output (third) are BOTH observably
  // starved, never silently unaffected.
  it(
    "leg (e-6) — returnValue alone exceeding the shared budget consumes it entirely, starving BOTH byRefValues and output (AC 34.7.3)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (leg e-6): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const CEILING = 32768;
      const result = await executeClassMethodTool.handler(
        {
          className: FIXTURE,
          methodName: "TargetReturnHugeWriteAndByRef",
          args: [{ byRef: true, value: "start" }],
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        returnValue: string;
        output: string;
        byRefValues: Record<string, unknown>;
        truncated: boolean;
        byRefTruncated: boolean;
        returnValueTruncated: boolean;
      };
      // returnValue (first in priority) is truncated to exactly the whole shared budget.
      expect(structured.returnValue.length).toBe(CEILING);
      expect(structured.returnValue).toContain("[IRIS-MCP-TRUNCATED");
      expect(structured.returnValueTruncated).toBe(true);
      // byRefValues (second in priority) gets NOTHING — the marked position is omitted
      // entirely, never a misleading empty-string placeholder.
      expect(structured.byRefValues).toEqual({});
      expect(structured.byRefTruncated).toBe(true);
      // output (third/last in priority) gets NOTHING either — the target's own
      // "some-narration" Write is fully elided, not merely shortened.
      expect(structured.output).toBe("");
      expect(structured.truncated).toBe(true);
    },
    { timeout: 30000 },
  );

  // ── Story 34.7 AC 34.7.4 — raw characters vs. serialized JSON size, pinned with an
  //    escape-heavy fixture (Rule #58) ──────────────────────────────────────────────
  //
  // WHY THIS EXISTS. Every prior over-ceiling fixture in this file/repo used
  // escaping-NEUTRAL content (a single repeated plain letter), which is structurally
  // blind to how far JSON string escaping can inflate the SERIALIZED response body
  // past the documented RAW-character ceiling. TargetReturnEscapeHeavyOverCeiling
  // returns 40,000 characters built entirely from a quote, a backslash, a tab, and a
  // control character with no short JSON escape — repeated — so the truncated
  // 32768-raw-character result is maximally adversarial to serialize.
  it(
    "leg (e-7) — an escape-heavy over-budget field stays bounded at 32768 RAW characters even though its SERIALIZED size is far larger (AC 34.7.4, Rule #58)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] execute-classmethod epic gate (leg e-7): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const CEILING = 32768;
      const result = await executeClassMethodTool.handler(
        { className: FIXTURE, methodName: "TargetReturnEscapeHeavyOverCeiling" },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        returnValue: string;
        returnValueTruncated: boolean;
      };
      // The RAW-character invariant holds regardless of content: exactly the ceiling,
      // never more, even though every character here is JSON-escape-heavy.
      expect(structured.returnValue.length).toBe(CEILING);
      expect(structured.returnValueTruncated).toBe(true);
      // The SERIALIZED size is the whole point of this leg: it must be substantially
      // larger than the raw-character ceiling, proving the documentation's raw-vs-wire
      // distinction is real and testable, not just asserted in prose. Live-measured at
      // 98,410 characters for the whole HTTP response body (Dev Notes); asserting a
      // generous lower bound here (not the exact figure) keeps this resilient to minor
      // envelope-shape changes while still proving the inflation is real and large.
      const serializedSize = JSON.stringify(structured).length;
      expect(serializedSize).toBeGreaterThan(CEILING * 2);
    },
    { timeout: 30000 },
  );
});

// Story 34.6 AC 34.6.3 (ledger 34-4-R3): permanent, direct pin of
// `fixtureIsDeployed`'s discrimination — a genuine 404 is the ONLY case that may
// collapse to "fixtures not deployed" (false); everything else (a credential fault,
// a network error, a licence error, a 500) must RE-THROW so `beforeAll` reports the
// real cause and, under IRIS_REQUIRE_LIVE=1, the gate fails LOUDLY rather than
// silently skipping with a misleading reason. Exercises `fixtureIsDeployed` directly
// (accessible in-module, no export needed) against the REAL negotiated Atelier
// version, with the module-level `client` binding temporarily swapped for a fake
// that throws exactly the error shapes the real `IrisHttpClient` genuinely produces
// (Rule #54) — never mutating the real client instance, so nothing to leave broken
// if a test fails midway; restored in a `finally` regardless.
describe("fixtureIsDeployed discrimination (Story 34.6 AC 34.6.3, ledger 34-4-R3)", () => {
  it("returns false for a genuine 404 (the ONLY legitimate 'fixtures not deployed' case)", async (testCtx) => {
    if (!irisReachable) {
      testCtx.skip();
      return;
    }
    const version = await negotiateVersion(client);
    const realClient = client;
    client = {
      get: async () => {
        throw new IrisApiError(404, [], "/fake/doc/path", "not found");
      },
    } as unknown as IrisHttpClient;
    try {
      await expect(fixtureIsDeployed(version, "HSCUSTOM")).resolves.toBe(false);
    } finally {
      client = realClient;
    }
  });

  it("RE-THROWS a non-404 IrisApiError (e.g. a 401 credential fault) instead of collapsing it into 'not deployed'", async (testCtx) => {
    if (!irisReachable) {
      testCtx.skip();
      return;
    }
    const version = await negotiateVersion(client);
    const realClient = client;
    const fault = new IrisApiError(401, [], "/fake/doc/path", "Unauthorized");
    client = {
      get: async () => {
        throw fault;
      },
    } as unknown as IrisHttpClient;
    try {
      await expect(fixtureIsDeployed(version, "HSCUSTOM")).rejects.toBe(fault);
    } finally {
      client = realClient;
    }
  });

  it("RE-THROWS a non-IrisApiError (e.g. a raw network failure) instead of collapsing it into 'not deployed'", async (testCtx) => {
    if (!irisReachable) {
      testCtx.skip();
      return;
    }
    const version = await negotiateVersion(client);
    const realClient = client;
    const fault = new Error("ECONNRESET");
    client = {
      get: async () => {
        throw fault;
      },
    } as unknown as IrisHttpClient;
    try {
      await expect(fixtureIsDeployed(version, "HSCUSTOM")).rejects.toBe(fault);
    } finally {
      client = realClient;
    }
  });
});
