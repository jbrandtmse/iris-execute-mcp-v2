/**
 * Story 45.4 (AC 45.4.4; AD-26; decision #170 item 2) - the text of the startup `[WARN]` line.
 *
 * `buildDataPolicyWarning` is pure: it takes the profiles, with their resolved policies, and an `isCallable`
 * answer, and returns the one line or `undefined`. The expected texts come from the Story 45.4 intent contract
 * (the Grouping row) and decision #170 (Rule #36). Which keys are callable on a real server (visible AND
 * enabled) is covered over the built servers by `story-45-4-block-seed-wire.test.ts` in `@iris-mcp/all`.
 */

import { describe, it, expect } from "vitest";
import { buildDataPolicyWarning, DATA_POLICY_BLOCK_KEYS, type DataPolicyWarningProfile } from "../data-policy.js";

const ON = (keysByProfile: Record<string, readonly string[]>) => (profile: string, key: string) =>
  (keysByProfile[profile] ?? []).includes(key);

const LEAD =
  'Data policy: "redact" covers message bodies only, so these raw-read and code-execution tools are enabled and ' +
  "their results are not redacted or withheld: ";
const TAIL =
  ". To turn tools off, set their governance keys to false (IRIS_GOVERNANCE or IRIS_GOVERNANCE_FILE) or set " +
  'IRIS_DATA_POLICY=block. See "PHI data policy" in the README.';

/** The three variants of the line, word for word (decision #170 item 2 as amended for #172). */
const REDACT_ONLY_LINE =
  'Data policy: "redact" covers message bodies only, so these raw-read and code-execution tools are enabled and ' +
  'their results are not redacted or withheld: profile "default" (redact): iris_sql_query, iris_global_get. ' +
  "To turn tools off, set their governance keys to false (IRIS_GOVERNANCE or IRIS_GOVERNANCE_FILE) or set " +
  'IRIS_DATA_POLICY=block. See "PHI data policy" in the README.';
const BLOCK_ONLY_LINE =
  'Data policy: an explicit governance key re-enabled these raw-read and code-execution tools under "block", so ' +
  'their results are not withheld: profile "prod" (block, re-enabled by an explicit governance key): ' +
  "iris_sql_query from IRIS_GOVERNANCE, iris_global_get from IRIS_GOVERNANCE_FILE. To turn them off again, remove " +
  'those keys or set them to false in the setting named. See "PHI data policy" in the README.';
const MIXED_LINE =
  "Data policy: these raw-read and code-execution tools are enabled, so their results are not redacted or withheld: " +
  'profile "default" (redact, which covers message bodies only): iris_sql_query, iris_global_get; ' +
  'profile "prod" (block, re-enabled by an explicit governance key): iris_sql_query from IRIS_GOVERNANCE. ' +
  "To turn tools off, set their governance keys to false (IRIS_GOVERNANCE or IRIS_GOVERNANCE_FILE) or set " +
  'IRIS_DATA_POLICY=block. See "PHI data policy" in the README.';

/** A `reEnabledBy` answer from a table of `profile -> key -> configSource`. */
const SOURCES = (table: Record<string, Record<string, string>>) => (profile: string, key: string) => table[profile]?.[key];

describe("buildDataPolicyWarning: the three variants, word for word (decision #170 item 2, amended for #172)", () => {
  it("only redact profiles: redact covers message bodies only, and block is a way out", () => {
    const line = buildDataPolicyWarning([{ name: "default", policy: "redact" }], ON({ default: ["iris_sql_query", "iris_global_get"] }));
    expect(line).toBe(REDACT_ONLY_LINE);
  });

  it("only block profiles with re-enabled keys: an explicit key re-enabled them, each named with its source; no redact sentence, no block offer", () => {
    const line = buildDataPolicyWarning(
      [{ name: "prod", policy: "block" }],
      ON({ prod: ["iris_global_get", "iris_sql_query"] }),
      undefined,
      SOURCES({ prod: { iris_sql_query: "env", iris_global_get: "file" } }),
    );
    expect(line).toBe(BLOCK_ONLY_LINE);
    expect(line).not.toMatch(/redact/i);
    expect(line).not.toContain("IRIS_DATA_POLICY=");
  });

  it("mixed: one line, each group with its own reason", () => {
    const line = buildDataPolicyWarning(
      [{ name: "default", policy: "redact" }, { name: "prod", policy: "block" }],
      ON({ default: ["iris_sql_query", "iris_global_get"], prod: ["iris_sql_query"] }),
      undefined,
      SOURCES({ default: { iris_sql_query: "default", iris_global_get: "default" }, prod: { iris_sql_query: "env" } }),
    );
    expect(line).toBe(MIXED_LINE);
    expect(line?.split("\n")).toHaveLength(1);
  });

  it("no variant offers allow as a way out", () => {
    for (const line of [REDACT_ONLY_LINE, BLOCK_ONLY_LINE, MIXED_LINE]) expect(line).not.toMatch(/allow/i);
  });

  it("two block profiles that re-enable the same key from different settings are two groups", () => {
    const line = buildDataPolicyWarning(
      [{ name: "a", policy: "block" }, { name: "b", policy: "block" }, { name: "c", policy: "block" }],
      () => true,
      ["iris_sql_query"],
      SOURCES({ a: { iris_sql_query: "env" }, b: { iris_sql_query: "file" }, c: { iris_sql_query: "env" } }),
    );
    expect(line).toContain(
      'profiles "a", "c" (block, re-enabled by an explicit governance key): iris_sql_query from IRIS_GOVERNANCE; ' +
        'profile "b" (block, re-enabled by an explicit governance key): iris_sql_query from IRIS_GOVERNANCE_FILE.',
    );
  });

  it("the source is asked for block keys only, and an unknown source names none", () => {
    const asked: string[] = [];
    const line = buildDataPolicyWarning(
      [{ name: "default", policy: "redact" }, { name: "prod", policy: "block" }],
      () => true,
      ["iris_sql_query"],
      (profile, key) => {
        asked.push(`${profile}:${key}`);
        return "parent";
      },
    );
    expect(asked).toEqual(["prod:iris_sql_query"]);
    expect(line).toContain('profile "prod" (block, re-enabled by an explicit governance key): iris_sql_query.');
  });
});

describe("buildDataPolicyWarning", () => {
  it("names a redact profile's callable keys, in declaration order, whatever order the caller found them", () => {
    const profiles: DataPolicyWarningProfile[] = [{ name: "default", policy: "redact" }];
    const line = buildDataPolicyWarning(profiles, ON({ default: ["iris_global_get", "iris_sql_query"] }));
    expect(line).toBe(`${LEAD}profile "default" (redact): iris_sql_query, iris_global_get${TAIL}`);
  });

  it("is undefined when no profile has a key to list", () => {
    expect(buildDataPolicyWarning([{ name: "default", policy: "redact" }], () => false)).toBeUndefined();
    expect(buildDataPolicyWarning([], () => true)).toBeUndefined();
  });

  it("is undefined under allow, however many keys are callable", () => {
    expect(buildDataPolicyWarning([{ name: "a", policy: "allow" }, { name: "b", policy: "allow" }], () => true)).toBeUndefined();
  });

  it("never names an allow profile beside the others", () => {
    const line = buildDataPolicyWarning(
      [{ name: "open", policy: "allow" }, { name: "default", policy: "redact" }],
      () => true,
    );
    expect(line).toContain('profile "default" (redact)');
    expect(line).not.toContain('"open"');
  });

  it("is undefined for a block profile with no re-enabled key (the seed denies them all)", () => {
    expect(buildDataPolicyWarning([{ name: "prod", policy: "block" }], () => false)).toBeUndefined();
  });

  it("marks a block profile's key as re-enabled by an explicit governance key, with no redact sentence", () => {
    const line = buildDataPolicyWarning([{ name: "prod", policy: "block" }], ON({ prod: ["iris_sql_query"] }));
    expect(line).toBe(
      'Data policy: an explicit governance key re-enabled these raw-read and code-execution tools under "block", so ' +
        'their results are not withheld: profile "prod" (block, re-enabled by an explicit governance key): iris_sql_query. ' +
        'To turn them off again, remove those keys or set them to false in the setting named. See "PHI data policy" in the README.',
    );
  });

  it("groups profiles with the same policy and key list, in registry order (the Grouping row)", () => {
    const profiles: DataPolicyWarningProfile[] = [
      { name: "a", policy: "redact" },
      { name: "b", policy: "redact" },
      { name: "c", policy: "block" },
    ];
    const line = buildDataPolicyWarning(
      profiles,
      ON({ a: ["iris_sql_query", "iris_global_get"], b: ["iris_sql_query", "iris_global_get"], c: ["iris_sql_query"] }),
      undefined,
      SOURCES({ c: { iris_sql_query: "env" } }),
    );
    expect(line).toBe(
      "Data policy: these raw-read and code-execution tools are enabled, so their results are not redacted or withheld: " +
        'profiles "a", "b" (redact, which covers message bodies only): iris_sql_query, iris_global_get; ' +
        `profile "c" (block, re-enabled by an explicit governance key): iris_sql_query from IRIS_GOVERNANCE${TAIL}`,
    );
  });

  it("a redact profile and a re-enabling block profile with the SAME key list are two groups in ONE line, never merged (QA 45.4)", () => {
    const profiles: DataPolicyWarningProfile[] = [
      { name: "a", policy: "redact" },
      { name: "b", policy: "block" },
      { name: "c", policy: "redact" },
      { name: "d", policy: "block" },
    ];
    const line = buildDataPolicyWarning(profiles, () => true, ["iris_sql_query"]);
    expect(line).toBe(
      "Data policy: these raw-read and code-execution tools are enabled, so their results are not redacted or withheld: " +
        'profiles "a", "c" (redact, which covers message bodies only): iris_sql_query; ' +
        `profiles "b", "d" (block, re-enabled by an explicit governance key): iris_sql_query${TAIL}`,
    );
    expect(line?.split("\n")).toHaveLength(1);
  });

  it("allow profiles in the middle of the list never split or join a group (QA 45.4)", () => {
    const profiles: DataPolicyWarningProfile[] = [
      { name: "a", policy: "redact" },
      { name: "open", policy: "allow" },
      { name: "b", policy: "redact" },
    ];
    expect(buildDataPolicyWarning(profiles, () => true, ["iris_sql_query"])).toBe(
      `${LEAD}profiles "a", "b" (redact): iris_sql_query${TAIL}`,
    );
  });

  it("is undefined when every covered tool is disabled or hidden for every profile, with several profiles of every policy (QA 45.4)", () => {
    const profiles: DataPolicyWarningProfile[] = [
      { name: "a", policy: "redact" },
      { name: "b", policy: "block" },
      { name: "c", policy: "allow" },
    ];
    expect(buildDataPolicyWarning(profiles, () => false)).toBeUndefined();
  });

  it("keeps profiles with different key lists in separate groups, each written once", () => {
    const profiles: DataPolicyWarningProfile[] = [
      { name: "a", policy: "redact" },
      { name: "b", policy: "redact" },
      { name: "c", policy: "redact" },
    ];
    const line = buildDataPolicyWarning(profiles, ON({ a: ["iris_sql_query"], b: ["iris_global_get"], c: ["iris_sql_query"] }));
    expect(line).toBe(
      `${LEAD}profiles "a", "c" (redact): iris_sql_query; profile "b" (redact): iris_global_get${TAIL}`,
    );
    expect(line?.split("\n")).toHaveLength(1);
  });

  it("writes profile names with JSON.stringify", () => {
    const line = buildDataPolicyWarning([{ name: 'we"ird\nname', policy: "redact" }], () => true);
    expect(line).toContain('profile "we\\"ird\\nname" (redact)');
    expect(line?.includes("\n")).toBe(false);
  });

  it("lists every covered key when all are callable", () => {
    const line = buildDataPolicyWarning([{ name: "default", policy: "redact" }], () => true);
    expect(line).toContain(DATA_POLICY_BLOCK_KEYS.join(", "));
  });

  it("takes a custom covered list", () => {
    const line = buildDataPolicyWarning([{ name: "default", policy: "redact" }], () => true, ["iris_doc_get"]);
    expect(line).toBe(`${LEAD}profile "default" (redact): iris_doc_get${TAIL}`);
  });

  it("says that redact covers message bodies only, points to the README, and never offers allow (decision #170)", () => {
    const line = buildDataPolicyWarning(
      [{ name: "default", policy: "redact" }, { name: "prod", policy: "block" }],
      () => true,
    ) as string;
    expect(line).toContain("(redact, which covers message bodies only)");
    expect(line).toContain('See "PHI data policy" in the README.');
    expect(line).toContain("governance keys");
    expect(line).toContain("IRIS_DATA_POLICY=block");
    // No way out through the loosest policy, in any spelling.
    expect(line).not.toMatch(/allow/i);
  });

  it("carries no value: only the fixed text, the profile names and the key names", () => {
    const line = buildDataPolicyWarning([{ name: "default", policy: "redact" }], () => true) as string;
    const rest = line
      .replace(LEAD, "")
      .replace(TAIL, "")
      .replace('profile "default" (redact): ', "")
      .replace(DATA_POLICY_BLOCK_KEYS.join(", "), "");
    expect(rest).toBe("");
  });
});
