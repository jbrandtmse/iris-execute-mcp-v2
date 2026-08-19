/**
 * Story 35.2 (ledger `35-SWEEP-2`, HIGH, beta blocker) — `iris_analytics_cubes:
 * build` device-output isolation, pinned as a DEFAULT-SUITE, always-discoverable
 * process gate (Rule 8 shape, mirrors `packages/iris-dev-mcp/src/__tests__/
 * execute-classmethod-epic-gate.test.ts`'s `ctx.skip()`-on-unavailable pattern).
 *
 * THE DEFECT. `%DeepSee.Utils.%BuildCube()` (called from `ExecuteMCPv2.REST.
 * Analytics:CubeAction` at `Analytics.cls:219` for the "build" action) writes
 * progress/diagnostic text directly to the CURRENT DEVICE — the HTTP response
 * stream — ahead of the JSON envelope `RenderResponseBody` writes afterward.
 * Before this story's fix, the raw wire body for a build against a nonexistent
 * cube was:
 *
 *   \nERROR #20013: Cube 'NOSUCHCUBE' does not exist{"status":...}
 *
 * — a correct envelope with device text PREPENDED, unparseable by any JSON
 * client. Live-verified during this story's mutation check (Rule #48): the
 * SUCCESS path is even more corrupted (full progress narration, including raw
 * ANSI escape codes like `\x1b[0J`), because `%BuildCube`'s own `pVerbose`
 * parameter defaults to 1 and `Analytics.cls` never overrides it.
 *
 * RULE #59 — WHY THIS MUST BE A RAW WIRE READ. An in-IRIS round-trip cannot
 * see this defect: the corrupting bytes are prepended to the HTTP response
 * stream itself, while IRIS's own view of the returned object stays clean —
 * structurally identical to the surrogate-pair defect
 * `execute-classmethod-epic-gate.test.ts`'s leg (e-5) exists to guard. This
 * file therefore issues a raw `fetch` and reads `response.arrayBuffer()`
 * directly — never `ctx.http`/`IrisHttpClient` (whose JSON-parsing convenience
 * methods would either mask a parse failure behind a generic error or never
 * expose the raw bytes at all) and never the `iris_analytics_cubes` MCP tool
 * handler (which could itself reformat or swallow a malformed body). If any
 * review layer proposes replacing the raw fetch below with a call through the
 * tool handler or an internal assertion, reject it — that substitution is the
 * exact trap Rule #59 was codified for.
 *
 * ALSO PINS STORY 34.1 CONSTRAINT C-2 (transitively). `CubeAction` binds its
 * mnemonic with `Use tNull::("^"_$ZNAME)`, which requires the `Redirects()` label
 * entry points to live in the SAME generated `.int` routine as `CubeAction` — today
 * `ExecuteMCPv2.REST.Analytics.1.int`. `Command.cls` has an explicit pin for this
 * invariant (`ClassMethodArgsTest.cls`); `Analytics.cls` inherits none. It does not
 * need a separate one: if a future compiler split moved the labels to a second
 * `.int`, `%BuildCube`'s first `Write` would raise `<NOROUTINE>`/`<NOLINE>` inside
 * `CubeAction`'s inner `Try`, the envelope's error text would become that device
 * error instead of DeepSee's, and the `toContain("does not exist")` assertion below
 * would fail. Keep that assertion specific for exactly this reason — loosening it to
 * "some error occurred" would drop the C-2 pin on the floor.
 *
 * SCOPE. This gate exercises the ERROR path only (build against a name no
 * cube on the target instance can plausibly have), because it requires no
 * fixture/cube deployment beyond `ExecuteMCPv2` itself and therefore degrades
 * gracefully on a pristine bootstrapped-only instance — matching this file's
 * `ctx.skip()`-on-unavailable contract. The SUCCESS path (AC 35.2.6) was
 * separately proven live during story development by standing up and building
 * a disposable minimal cube (`ExecuteMCPv2.Temp.Story352Person` +
 * `...Story352PersonCube`, both deleted afterward and confirmed absent from
 * `%DeepSee.Utils:%GetCubeList` and `%Dictionary.CompiledClass`) — not
 * re-encoded here as a permanent test because standing up/tearing down a real
 * DeepSee cube on every default-suite run is a materially heavier and slower
 * dependency than this file's error-path fixture-free shape, and the error
 * path already proves the SAME redirect/restore code path `CubeAction`'s
 * "build" branch runs unconditionally for both outcomes (see
 * `Analytics.cls`'s `CubeAction` — the null-device redirect wraps the
 * `%BuildCube` call itself, before the success/error branch is known).
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  IrisApiError,
  IrisHttpClient,
  loadConfig,
  ping,
  negotiateVersion,
} from "@iris-mcp/shared";

const IRIS_HOST = process.env.IRIS_HOST ?? "localhost";
const IRIS_PORT = process.env.IRIS_PORT ?? "52773";
const IRIS_USERNAME = process.env.IRIS_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_NAMESPACE ?? "HSCUSTOM";

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

/**
 * Opt-in CI switch: when set, an unavailable environment is a hard FAILURE
 * rather than a skip — same contract as the Story 34.3 epic gate this file
 * mirrors.
 */
const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

let skipReason: string | undefined;
let client: IrisHttpClient;

/**
 * Probe whether the custom `ExecuteMCPv2` REST service is deployed —
 * mirrors `integration-setup.ts`'s `probeCustomRest`, reimplemented locally
 * because that file's globals are only wired into `vitest.integration.
 * config.ts`'s `setupFiles`, not the default suite this file must run under
 * (Rule 8).
 */
async function customRestIsDeployed(): Promise<boolean> {
  try {
    await client.get(`${BASE_URL}/analytics/cubes?namespace=${encodeURIComponent(IRIS_NAMESPACE)}`);
    return true;
  } catch (error) {
    if (error instanceof IrisApiError) {
      // Any HTTP response (even an error status) proves the service is
      // deployed; only a 404 means the endpoint itself does not exist.
      return error.statusCode !== 404;
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
      await negotiateVersion(client);
      if (!(await customRestIsDeployed())) {
        skipReason = `ExecuteMCPv2's custom REST service is not deployed in ${IRIS_NAMESPACE} (404 from ${BASE_URL}/analytics/cubes). Load src/ExecuteMCPv2/ to run this gate.`;
      }
    }
  } catch (error) {
    skipReason = `IRIS availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(
      `IRIS_REQUIRE_LIVE is set, so this gate may not be skipped: ${skipReason}`,
    );
  }
}, 30000);

describe("iris_analytics_cubes 'build' device-output isolation (Story 35.2, ledger 35-SWEEP-2)", () => {
  it(
    "the raw wire body for a build against a nonexistent cube is valid, parseable JSON with NO prepended device text (AC 35.2.1/35.2.2/35.2.5)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] analytics-cubes-wire-gate: ${skipReason}`);
        // `testCtx.skip()` — NOT a bare `return`. Story 35.2's code review found
        // this leg returning early without it, which vitest reports as PASSED,
        // so an unreachable IRIS produced a green tick with zero requests issued
        // and nothing even marked skipped. Reported as skipped is the honest
        // signal, and it matches the epic gate this file mirrors
        // (`execute-classmethod-epic-gate.test.ts`, which does call it).
        testCtx.skip();
        return;
      }
      const config = getConfig();
      const auth = Buffer.from(`${config.username}:${config.password}`).toString(
        "base64",
      );
      // A cube name no real DeepSee cube could plausibly have — deterministic
      // reproduction of the exact defect shape lead-verified in the story's
      // Dev Notes (ERROR #20013), requiring no fixture beyond ExecuteMCPv2
      // itself.
      const response = await fetch(`${config.baseUrl}${BASE_URL}/analytics/cubes`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action: "build",
          cube: "ZZ_STORY_35_2_NO_SUCH_CUBE",
          namespace: IRIS_NAMESPACE,
        }),
      });
      expect(response.status).toBe(200);
      const bytes = new Uint8Array(await response.arrayBuffer());

      // The AC 35.2.5 property itself, read from the ACTUAL bytes that left
      // the server — never `response.json()`/`ctx.http`, which would hide a
      // parse failure behind a generic thrown error rather than letting this
      // assertion demonstrate the property directly.
      const text = new TextDecoder("utf-8").decode(bytes);
      // Pre-fix, this string started with "\r\nERROR #20013: ..." — assert
      // the very first byte is the JSON envelope's opening brace, not just
      // that SOME substring parses (a `JSON.parse` on a body with prepended
      // text throws outright, but pinning the first character directly is a
      // stronger, more legible pin of the specific defect shape).
      expect(text.charAt(0)).toBe("{");

      let envelope: {
        status: { errors: Array<{ error: string }> };
        result: Record<string, unknown>;
      };
      expect(() => {
        envelope = JSON.parse(text);
      }).not.toThrow();
      // Sanity check on the setup: this must be the genuine "cube does not
      // exist" error, not some other failure that happens to also parse.
      expect(envelope!.status.errors[0]?.error).toContain(
        "ZZ_STORY_35_2_NO_SUCH_CUBE",
      );
      // NOTE: asserted on the cube NAME, and on the untranslated substring
      // below, deliberately — NOT on the "ERROR #" prefix, which this instance
      // renders locale-dependently (observed live: "خطأ #5001: Cube '...' does
      // not exist"). Project rule #13: never pin an assertion to the error
      // prefix's language.
      expect(envelope!.status.errors[0]?.error).toContain("does not exist");
    },
    { timeout: 30000 },
  );

  it(
    "the redirect is RESTORED before the request ends — a follow-up request's wire body is also clean (AC 35.2.2)",
    async (testCtx) => {
      if (skipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] analytics-cubes-wire-gate (restore leg): ${skipReason}`);
        testCtx.skip();
        return;
      }
      const config = getConfig();
      const auth = Buffer.from(`${config.username}:${config.password}`).toString(
        "base64",
      );
      // Added by Story 35.2's code review. The first leg proves the redirect
      // SUPPRESSED the device text; it cannot by itself prove the redirect was
      // switched back OFF. A redirect that leaks past the request boundary is a
      // WORSE failure than the defect this story fixed — the next request on the
      // same reused CSP worker process writes its JSON envelope into the still-
      // bound null-device mnemonic and returns an empty body. `keepalive` plus
      // back-to-back sequential requests keeps this on the same connection (and
      // so, in practice, the same worker) that just ran the redirect.
      //
      // HONEST SCOPE (Rule #59): this leg is defense-in-depth, not independently
      // mutation-provable. Every REALISTIC restore failure — deleting
      // `ReDirectIO(0)`, deleting the bare `Use tInitIO`, or reordering either
      // after the render — also corrupts the FIRST leg's own body, so the first
      // leg goes RED first and this one cannot be shown to fail alone. What this
      // leg adds is coverage of the one shape the first leg structurally cannot
      // see: state that survives the request boundary into a reused CSP worker.
      const build = await fetch(`${config.baseUrl}${BASE_URL}/analytics/cubes`, {
        method: "POST",
        keepalive: true,
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action: "build",
          cube: "ZZ_STORY_35_2_NO_SUCH_CUBE",
          namespace: IRIS_NAMESPACE,
        }),
      });
      expect(build.status).toBe(200);
      await build.arrayBuffer();

      // Immediately reuse the connection for an UNRELATED read that renders its
      // own envelope. If CubeAction left ReDirectIO on (or the null device
      // current), this body arrives empty or truncated rather than as JSON.
      const followUp = await fetch(
        `${config.baseUrl}${BASE_URL}/analytics/cubes?namespace=${encodeURIComponent(IRIS_NAMESPACE)}`,
        {
          method: "GET",
          keepalive: true,
          headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
        },
      );
      expect(followUp.status).toBe(200);
      const followUpText = new TextDecoder("utf-8").decode(
        new Uint8Array(await followUp.arrayBuffer()),
      );
      // A leaked redirect swallows the envelope entirely — the length check is
      // the assertion that actually distinguishes that case from a clean run.
      expect(followUpText.length).toBeGreaterThan(0);
      expect(followUpText.charAt(0)).toBe("{");
      expect(() => JSON.parse(followUpText)).not.toThrow();
    },
    { timeout: 30000 },
  );
});
