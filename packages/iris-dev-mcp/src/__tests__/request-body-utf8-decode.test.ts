/**
 * Story 34.8 (ledger `34-6-CR-7`) — request-body UTF-8 decode fix, end-to-end round-trip
 * proof against the REAL deployed route (AC 34.8.6).
 *
 * `ExecuteMCPv2.Utils.ReadRequestBody` used to hand the raw POST body straight to
 * `%DynamicObject.%FromJSON()` without any UTF-8 decode, so every multi-byte character a
 * caller submitted arrived as its raw UTF-8 bytes misread as Latin-1 (`é` → `Ã©`, `世界` →
 * `ä¸ç`, `😀` → `ð`). The fix lives entirely server-side
 * (`ExecuteMCPv2.Utils.DecodeUtf8Stream` / `IncompleteUtf8TailLength`) and has its own
 * exhaustive ObjectScript-level pin in `ExecuteMCPv2.Tests.Utf8DecodeTest` (chunk-boundary
 * sweep, large-body/no-MAXSTRING, ASCII byte-identity). What CANNOT be pinned at the
 * ObjectScript level is whether the real deployed `/command`, `/classmethod`, and `/global`
 * routes actually route non-ASCII request bodies through that fix — `%request` is only
 * live inside a genuine CSP/REST dispatch, unavailable to `%UnitTest.TestCase` (see
 * `ExecuteMCPv2.Tests.BaseTest`'s own note on this same limitation). This file closes that
 * gap: every fixture below is submitted THROUGH the request body of a REAL HTTP call
 * (never a server-originated literal), driven through the same tool handlers a real MCP
 * client uses (`ctx.http`, exercising the actual wire encoding a real client produces —
 * see `@iris-mcp/shared`'s `IrisHttpClient`, which sends `Content-Type: application/json`
 * with no charset parameter, exactly the condition that exposed the defect).
 *
 * Follows the same graceful-degradation shape as `execute-classmethod-epic-gate.test.ts`
 * (Rule #21): a `beforeAll` availability probe + a per-test `ctx.skip()`, so this file
 * never fails a pristine/offline checkout but still runs as part of the DEFAULT suite
 * (`pnpm turbo run test`) whenever a live instance is reachable.
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
import { executeCommandTool, executeClassMethodTool } from "../tools/execute.js";
import { globalSetTool, globalGetTool, globalKillTool } from "../tools/global.js";

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

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

let skipReason: string | undefined;
/**
 * Story 34.8 code review: the missing-fixture condition is tracked SEPARATELY from
 * "IRIS is unreachable". Only the four `/classmethod` tests below need
 * `ExecuteMCPv2.Tests.ClassMethodArgsFixture`; the other eight (`/command`, `/global`)
 * need nothing but a live instance. Folding both conditions into one file-wide
 * `skipReason` meant a bootstrapped-only instance — where the test fixtures are
 * deliberately absent per Rule #39 — silently skipped the `/command` and `/global`
 * decode proofs too, so a genuine regression there could be masked by an unrelated
 * missing classmethod fixture.
 */
let fixtureSkipReason: string | undefined;
let ctx: ToolContext;
let client: IrisHttpClient;

/**
 * Same discrimination as `execute-classmethod-epic-gate.test.ts`'s `fixtureIsDeployed`:
 * probed via the stock Atelier `/doc/` surface (never the endpoint under test), so a
 * genuine regression in `/classmethod` cannot masquerade as "fixtures not deployed".
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
    if (!available) {
      skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT} (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    } else {
      const version = await negotiateVersion(client);
      ctx = buildToolContext("NS", config, client, version);
      if (!(await fixtureIsDeployed(version, ctx.resolveNamespace()))) {
        fixtureSkipReason =
          `The reproduction fixtures are not deployed in ${ctx.resolveNamespace()} ` +
          `(${FIXTURE} not found via the Atelier API). Load src/ExecuteMCPv2/Tests/ to run this gate.`;
      }
    }
  } catch (error) {
    skipReason = `IRIS availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if ((skipReason ?? fixtureSkipReason) && REQUIRE_LIVE) {
    throw new Error(
      `IRIS_REQUIRE_LIVE is set, so this gate may not be skipped: ${skipReason ?? fixtureSkipReason}`,
    );
  }
}, 30000);

describe("Request-body UTF-8 decoding (Story 34.8, ledger 34-6-CR-7)", () => {
  // ── /command — accented BMP, CJK, astral/emoji, mixed (AC 34.8.6) ────────────────

  it(
    "accented BMP character submitted through /command's request body round-trips correctly",
    async (testCtx) => {
      if (skipReason) {
        testCtx.skip();
        return;
      }
      const result = await executeCommandTool.handler(
        { command: 'Write "café-naïve-résumé"', namespace: ctx.resolveNamespace() },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { output: string; truncated: boolean };
      expect(structured.output).toBe("café-naïve-résumé");
      expect(structured.output).not.toContain("Ã");
    },
    { timeout: 30000 },
  );

  it(
    "CJK content submitted through /command's request body round-trips correctly",
    async (testCtx) => {
      if (skipReason) {
        testCtx.skip();
        return;
      }
      const result = await executeCommandTool.handler(
        { command: 'Write "世界你好日本語한국어"', namespace: ctx.resolveNamespace() },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { output: string; truncated: boolean };
      expect(structured.output).toBe("世界你好日本語한국어");
    },
    { timeout: 30000 },
  );

  it(
    "astral-plane emoji (surrogate pair) submitted through /command's request body round-trips correctly",
    async (testCtx) => {
      if (skipReason) {
        testCtx.skip();
        return;
      }
      const result = await executeCommandTool.handler(
        { command: 'Write "😀🎉🚀"', namespace: ctx.resolveNamespace() },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { output: string; truncated: boolean };
      expect(structured.output).toBe("😀🎉🚀");
      // A JS string measures a surrogate pair as length 2 per astral character — this
      // assertion fails if any character was dropped or mis-decoded into replacement chars.
      expect(structured.output.length).toBe(6);
    },
    { timeout: 30000 },
  );

  it(
    "mixed ASCII + non-ASCII submitted through /command's request body round-trips correctly",
    async (testCtx) => {
      if (skipReason) {
        testCtx.skip();
        return;
      }
      const command = 'Write "plain123-café-世界-😀-END"';
      const result = await executeCommandTool.handler(
        { command, namespace: ctx.resolveNamespace() },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { output: string; truncated: boolean };
      expect(structured.output).toBe("plain123-café-世界-😀-END");
    },
    { timeout: 30000 },
  );

  it(
    "the exact Project Lead reproduction (2026-08-16) now round-trips correctly instead of emitting mojibake",
    async (testCtx) => {
      if (skipReason) {
        testCtx.skip();
        return;
      }
      // The story's own live reproduction: this EXACT command previously returned
      // "hÃ©llo-ä¸ç-ð-".
      const result = await executeCommandTool.handler(
        { command: 'Write "héllo-世界-😀-"', namespace: ctx.resolveNamespace() },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { output: string };
      expect(structured.output).toBe("héllo-世界-😀-");
      expect(structured.output).not.toContain("Ã©");
      expect(structured.output).not.toContain("ä¸ç");
    },
    { timeout: 30000 },
  );

  // ── /command — ASCII back-compat (Rule #19) ───────────────────────────────────────

  it(
    "a plain ASCII command submitted through /command's request body is byte-identical (Rule #19 back-compat)",
    async (testCtx) => {
      if (skipReason) {
        testCtx.skip();
        return;
      }
      const command =
        'Set x = 5 + 3 Write "result=",x," normal ascii text 123 !@#$%^&*()_+-=[]{}|;:,.<>/?"';
      const result = await executeCommandTool.handler(
        { command, namespace: ctx.resolveNamespace() },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { output: string };
      expect(structured.output).toBe(
        'result=8 normal ascii text 123 !@#$%^&*()_+-=[]{}|;:,.<>/?',
      );
    },
    { timeout: 30000 },
  );

  // ── /classmethod — args (plain scalar) and {byRef, value} marker (AC 34.8.6) ─────

  it(
    "non-ASCII submitted through /classmethod's args (plain scalar) round-trips correctly",
    async (testCtx) => {
      // Needs the ClassMethodArgsFixture, so it honors BOTH skip conditions.
      if (skipReason || fixtureSkipReason) {
        testCtx.skip();
        return;
      }
      const result = await executeClassMethodTool.handler(
        {
          className: FIXTURE,
          methodName: "TargetPlainReadOnly",
          args: ["café-世界-😀-end"],
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { returnValue: string };
      expect(structured.returnValue).toBe("seen:café-世界-😀-end");
    },
    { timeout: 30000 },
  );

  it(
    "non-ASCII submitted through /classmethod's {byRef, value} marker round-trips correctly",
    async (testCtx) => {
      // Needs the ClassMethodArgsFixture, so it honors BOTH skip conditions.
      if (skipReason || fixtureSkipReason) {
        testCtx.skip();
        return;
      }
      const result = await executeClassMethodTool.handler(
        {
          className: FIXTURE,
          methodName: "TargetByRef",
          args: [{ byRef: true, value: "café-世界-😀-start" }],
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        returnValue: string;
        byRefValues: Record<string, unknown>;
      };
      expect(structured.returnValue).toBe("ok");
      expect(structured.byRefValues["0"]).toBe("café-世界-😀-start-mutated");
    },
    { timeout: 30000 },
  );

  it(
    "a non-ASCII JSON KEY elsewhere in the request body does not corrupt decoding of an adjacent real value (AC 34.8.6)",
    async (testCtx) => {
      if (skipReason) {
        testCtx.skip();
        return;
      }
      // The marker object carries an EXTRA, non-ASCII-named property alongside the real
      // `byRef`/`value` keys. ExecuteMCPv2.Utils.ParseArgEntry ignores unknown keys, so
      // this is a legitimate shape a real caller could send; it proves the decode of a
      // JSON KEY containing multi-byte UTF-8 does not desynchronize decoding of the
      // adjacent VALUE the target actually reads.
      const result = await executeClassMethodTool.handler(
        {
          className: FIXTURE,
          methodName: "TargetByRef",
          args: [
            {
              byRef: true,
              value: "adjacent-value-café",
              "clé-世界-key": "ignored but must not corrupt decoding",
            },
          ],
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { byRefValues: Record<string, unknown> };
      expect(structured.byRefValues["0"]).toBe("adjacent-value-café-mutated");
    },
    { timeout: 30000 },
  );

  it(
    "mixed ASCII + non-ASCII across multiple /classmethod args round-trips correctly",
    async (testCtx) => {
      // Needs the ClassMethodArgsFixture, so it honors BOTH skip conditions.
      if (skipReason || fixtureSkipReason) {
        testCtx.skip();
        return;
      }
      const result = await executeClassMethodTool.handler(
        {
          className: FIXTURE,
          methodName: "TargetMixed",
          args: ["plain-café-scalar", { byRef: true, value: "byref-世界-start" }],
        },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        returnValue: string;
        byRefValues: Record<string, unknown>;
      };
      expect(structured.returnValue).toBe("scalar-seen:plain-café-scalar");
      expect(structured.byRefValues["1"]).toBe("byref-世界-start-mixedmutated");
    },
    { timeout: 30000 },
  );

  // ── /global (iris_global_set / iris_global_get) — the defect report's own scenario ──

  it(
    "non-ASCII submitted through iris_global_set's request body is stored and read back correctly (the defect report's own scenario)",
    async (testCtx) => {
      if (skipReason) {
        testCtx.skip();
        return;
      }
      const globalName = "ZZ348Utf8Test";
      const value = "café-世界-😀-end";
      try {
        const setResult = await globalSetTool.handler(
          { global: globalName, value, namespace: ctx.resolveNamespace() },
          ctx,
        );
        expect(setResult.isError).toBeUndefined();
        const setStructured = setResult.structuredContent as {
          value: string;
          verified: boolean;
        };
        expect(setStructured.value).toBe(value);
        expect(setStructured.verified).toBe(true);

        // Independent read-back — a SEPARATE request, proving the value was genuinely
        // persisted correctly rather than merely echoed within the same request.
        const getResult = await globalGetTool.handler(
          { global: globalName, namespace: ctx.resolveNamespace() },
          ctx,
        );
        expect(getResult.isError).toBeUndefined();
        const getStructured = getResult.structuredContent as {
          value: string;
          defined: boolean;
        };
        expect(getStructured.value).toBe(value);
        expect(getStructured.defined).toBe(true);
      } finally {
        await globalKillTool.handler(
          { global: globalName, namespace: ctx.resolveNamespace() },
          ctx,
        );
      }
    },
    { timeout: 30000 },
  );

  // ── /command — a larger non-ASCII payload through the real wire ─────────────────

  it(
    "a several-KB non-ASCII payload submitted through /command's request body round-trips correctly",
    async (testCtx) => {
      if (skipReason) {
        testCtx.skip();
        return;
      }
      const unit = "café-世界-😀-";
      // 11 UTF-16 code units per unit x 300 = 3,300 JS characters / 5,400 raw UTF-8 bytes.
      // (Counted mechanically, Rule #51 — an earlier hand-written "~3,900" was wrong.)
      const repeated = unit.repeat(300);
      expect(repeated.length).toBe(3300);
      const command = `Write "${repeated}"`;
      const result = await executeCommandTool.handler(
        { command, namespace: ctx.resolveNamespace() },
        ctx,
      );
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { output: string; truncated: boolean };
      expect(structured.truncated).toBe(false);
      expect(structured.output).toBe(repeated);
    },
    { timeout: 30000 },
  );
});
