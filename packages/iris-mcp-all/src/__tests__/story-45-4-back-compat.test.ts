/**
 * Story 45.4 - the back-compat replay (AC 45.4.3, AC 45.4.6; `S-45.4-block-raw-tools`; Rules #19, #36, #59).
 *
 * Under the data policies `redact`, `allow` and unset, every `iris_server_profiles` field, every governance
 * verdict and `configSource`, the `iris-governance://` resource, every refusal and its audit entry, and the
 * `[WARN]` lines the built servers write must equal what the BASELINE build said. Only the Story 45.4 startup
 * warning line (it begins `Data policy:`) is new, so it is the one line this replay drops.
 *
 * The oracle is `fixtures/story-45-4-back-compat-baseline.json`. It was captured by the same case runner
 * (`story-45-4-back-compat-cases.ts`) on dists built from baseline revision 8e7aad87 (the tree of `main` before
 * any Story 45.4 change; `git diff 8e7aad87..HEAD -- packages src scripts` was empty at capture), with:
 *
 *   pnpm turbo run build --force
 *   STORY_45_4_CAPTURE=packages/iris-mcp-all/src/__tests__/fixtures/story-45-4-back-compat-baseline.json \
 *     pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-45-4-back-compat.test.ts
 *
 * Re-capturing on a build that carries the Story 45.4 code would encode the story's own behaviour (Rule #49), so
 * the capture variable is for the baseline build only. A later story that changes, under its own sanction, a
 * governance key, a default or a field this replay covers re-captures the fixture the same way on the build of
 * ITS baseline revision (before its own change), then shows the replay red on its change and names the sanction;
 * it never re-captures on a build that carries its own change. The path this test guards is the stdio `tools/call` and
 * `resources/read` of the built server (Rule #59). A stale or missing dist skips each test with the reason, or
 * fails it when `IRIS_REQUIRE_LIVE` is armed.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSdkEsmDir, skipIfReason, staleDistReason } from "./process-gate-helpers.js";
import {
  BACK_COMPAT_SERVERS,
  backCompatCases,
  captureBackCompat,
  type BackCompatRecord,
} from "./story-45-4-back-compat-cases.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const FIXTURE = path.join(__dirname, "fixtures", "story-45-4-back-compat-baseline.json");
const CAPTURE_PATH = process.env.STORY_45_4_CAPTURE;
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The first word of the Story 45.4 startup warning: the one new line. */
const WARNING_MARK = "Data policy:";

let skipReason: string | undefined;
let sdkEsmDir = "";
let replay: BackCompatRecord[] = [];

/** The path and both values of the first place where `expected` and `actual` differ, or undefined when equal. */
function firstDifference(expected: unknown, actual: unknown, at = "$"): string | undefined {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return undefined;
  if (typeof expected === "object" && expected !== null && typeof actual === "object" && actual !== null) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      const found = firstDifference((expected as Record<string, unknown>)[key], (actual as Record<string, unknown>)[key], `${at}.${key}`);
      if (found !== undefined) return found;
    }
  }
  return `${at}: expected ${JSON.stringify(expected)?.slice(0, 300)}, got ${JSON.stringify(actual)?.slice(0, 300)}`;
}

/** The record without the Story 45.4 warning line. */
function withoutWarning(record: BackCompatRecord): BackCompatRecord {
  return { ...record, warnLines: record.warnLines.filter((line) => !line.includes(WARNING_MARK)) };
}

beforeAll(async () => {
  skipReason = ["shared", ...Object.values(BACK_COMPAT_SERVERS)]
    .map((pkg) => staleDistReason(REPO_ROOT, pkg))
    .find((reason) => reason !== undefined);
  if (!skipReason) {
    const resolved = resolveSdkEsmDir(REPO_ROOT);
    if (resolved === undefined) {
      skipReason = "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    } else {
      sdkEsmDir = resolved;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 45.4 back-compat replay may not be skipped: ${skipReason}`);
  }
  if (skipReason) {
    // eslint-disable-next-line no-console
    console.log(`[SKIP] story-45-4-back-compat: ${skipReason}`);
    return;
  }
  replay = await captureBackCompat(REPO_ROOT, sdkEsmDir);
  if (CAPTURE_PATH) {
    // One record per line keeps the file diffable.
    const lines = replay.map((record) => JSON.stringify(withoutWarning(record))).join(",\n");
    writeFileSync(path.resolve(REPO_ROOT, CAPTURE_PATH), `[\n${lines}\n]\n`, "utf8");
  }
}, 900_000);

describe("Story 45.4: nothing changes under redact, allow and an unset policy (AC 45.4.3, AC 45.4.6)", () => {
  if (CAPTURE_PATH) {
    it("captured the baseline fixture", (ctx) => {
      if (skipIfReason(skipReason, ctx)) return;
      expect(replay.length).toBe(backCompatCases().length);
    });
    return;
  }

  const baseline = JSON.parse(readFileSync(FIXTURE, "utf8")) as BackCompatRecord[];

  it("the fixture holds exactly the cases of the replay, over all five servers and every policy", () => {
    const ids = backCompatCases().map((spec) => spec.id);
    expect(baseline.map((record) => record.id)).toEqual(ids);
    for (const server of Object.keys(BACK_COMPAT_SERVERS)) {
      expect(ids.some((id) => id.startsWith(`sweep/${server}/unset/`)), server).toBe(true);
    }
  });

  it("the fixture is real: the dev read-only case denied writes with presetApplied, and the sweep names governance keys", () => {
    const readOnly = baseline.find((record) => record.id === "dev/none/unset/read-only");
    const denials = (readOnly?.calls ?? []).filter((call) => call.gate === "denied").map((call) => call.tool);
    expect(denials).toEqual(["iris_sql_execute", "iris_execute_command", "iris_global_set"]);
    const sweep = baseline.find((record) => record.id === "sweep/dev/unset/none");
    const profiles = sweep?.profiles as { governance: { keys: number; digest: string } };
    expect(profiles.governance.keys).toBeGreaterThan(50);
    expect(profiles.governance.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("every case replays to the baseline, byte for byte, apart from the one new warning line", (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const mismatches = replay
      .map(withoutWarning)
      .filter((record, index) => JSON.stringify(record) !== JSON.stringify(baseline[index]))
      .map((record) => record.id);
    // Name the first differing field of each mismatch: a long record otherwise prints only its truncated start.
    const where = replay
      .map(withoutWarning)
      .map((record, index) => ({ id: record.id, diff: firstDifference(baseline[index], record) }))
      .filter((entry) => entry.diff !== undefined)
      .map((entry) => `${entry.id} at ${entry.diff}`);
    expect(mismatches, where.join("\n")).toEqual([]);
    expect(replay.map(withoutWarning)).toEqual(baseline);
  });

  it("redact and unset produce the same records as each other, case for case (the default is redact)", (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const normalize = (record: BackCompatRecord): string =>
      JSON.stringify({ ...record, id: record.id.replace(/\/(unset|redact)\//, "/P/") }).replace(/"dataPolicySource":"[^"]*"/g, "");
    for (const record of replay) {
      if (!record.id.includes("/unset/")) continue;
      const twin = replay.find((other) => other.id === record.id.replace("/unset/", "/redact/"));
      expect(twin, record.id).toBeDefined();
      expect(normalize(withoutWarning(twin as BackCompatRecord)), record.id).toBe(normalize(withoutWarning(record)));
    }
  });
});
