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

  it("marks a block profile's key as re-enabled by an explicit governance key", () => {
    const line = buildDataPolicyWarning([{ name: "prod", policy: "block" }], ON({ prod: ["iris_sql_query"] }));
    expect(line).toBe(`${LEAD}profile "prod" (block, re-enabled by an explicit governance key): iris_sql_query${TAIL}`);
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
    );
    expect(line).toBe(
      `${LEAD}profiles "a", "b" (redact): iris_sql_query, iris_global_get; ` +
        `profile "c" (block, re-enabled by an explicit governance key): iris_sql_query${TAIL}`,
    );
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
    expect(line).toContain('"redact" covers message bodies only');
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
