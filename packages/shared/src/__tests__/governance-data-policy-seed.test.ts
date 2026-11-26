/**
 * Story 45.4 (AC 45.4.2, AC 45.4.3; AD-6; `S-45.4-block-raw-tools`) - the `block` data-policy seed in the governance
 * cascade: `env.profile ?? env.global ?? file.profile ?? file.global ?? inheritedDisable ?? dataPolicySeed ??
 * presetSeed ?? defaultSeed`.
 *
 * The engine only, with a synthetic world (two baseline keys, one read child of `iris_sql_execute`, a baseline write
 * and read) and the real declaration `DATA_POLICY_BLOCK_KEYS`. Expected values come from the Story 45.4 intent
 * contract's I/O matrix (Rule #36), not from the implementation. The gate, the discovery tool and the resource are
 * covered over the built servers by `story-45-4-block-seed-wire.test.ts` in `@iris-mcp/all`.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  DATA_POLICIES,
  DATA_POLICY_BLOCK_KEYS,
  DATA_POLICY_BLOCK_KEYS_AS_OF,
  dataPolicySeed,
  type DataPolicy,
} from "../data-policy.js";
import {
  buildDefaultEnabledWrites,
  buildMutatesLookup,
  buildParentKeys,
  configSource,
  effective,
  getEffectiveConfigSources,
  getEffectivePolicy,
  type GovernanceConfig,
  type GovernancePreset,
} from "../governance.js";
import type { ToolDefinition } from "../tool-types.js";

/** The synthetic world: baseline keys the covered set names, and one the set does not. */
const WORLD_BASELINE: ReadonlySet<string> = new Set([
  "iris_sql_execute",
  "iris_global_get",
  "iris_global_set",
  "iris_doc_get",
  "iris_execute_command",
]);
const CLASSIFICATIONS = {
  iris_sql_execute: "write",
  iris_global_get: "read",
  iris_global_set: "write",
  iris_doc_get: "read",
  iris_execute_command: "write",
} as const;

/** `iris_sql_query`: a new read key whose parent is `iris_sql_execute` (the real shape of Story 38.4). */
const SQL_QUERY: ToolDefinition = {
  name: "iris_sql_query",
  title: "SQL query",
  description: "A read-only way to do what iris_sql_execute does.",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true },
  scope: "NS",
  mutates: "read",
  parent: "iris_sql_execute",
  handler: async () => ({ content: [{ type: "text" as const, text: "ran" }] }),
};
const TOOLS = [SQL_QUERY];
const MUTATES = buildMutatesLookup(TOOLS);
const DEFAULT_ENABLED = buildDefaultEnabledWrites(TOOLS);
const PARENT_KEYS = buildParentKeys(TOOLS, WORLD_BASELINE);
const WORLD_KEYS = [...WORLD_BASELINE, "iris_sql_query"];

interface Options {
  profile?: string;
  preset?: GovernancePreset;
  file?: GovernanceConfig;
  policy?: DataPolicy;
  blockKeys?: readonly string[];
}

/** Resolve one key of the world: its value and its source. */
function resolve(key: string, config: GovernanceConfig, options: Options = {}): { value: boolean; source: string } {
  const profile = options.profile ?? "default";
  return {
    value: effective(
      key,
      profile,
      config,
      MUTATES,
      WORLD_BASELINE,
      DEFAULT_ENABLED,
      options.preset,
      CLASSIFICATIONS,
      options.file,
      PARENT_KEYS,
      options.policy,
      options.blockKeys,
    ),
    source: configSource(
      key,
      profile,
      config,
      MUTATES,
      options.preset,
      CLASSIFICATIONS,
      options.file,
      PARENT_KEYS,
      options.policy,
      options.blockKeys,
    ),
  };
}

const DENIED = { value: false, source: "dataPolicy" };

/** The four keys of the covered set that the synthetic world knows. */
const WORLD_COVERED = ["iris_sql_query", "iris_sql_execute", "iris_global_get", "iris_execute_command"];

describe("the declaration", () => {
  it("is the 11 keys of decision #169, in order, as of 2026-11-25, and frozen", () => {
    expect([...DATA_POLICY_BLOCK_KEYS]).toEqual([
      "iris_sql_query",
      "iris_sql_execute",
      "iris_global_get",
      "iris_global_list",
      "iris_execute_command",
      "iris_execute_classmethod",
      "iris_execute_tests",
      "iris_test_coverage",
      "iris_transform_test",
      "iris_docdb_document:get",
      "iris_docdb_find",
    ]);
    expect(DATA_POLICY_BLOCK_KEYS_AS_OF).toBe("2026-11-25");
    expect(Object.isFrozen(DATA_POLICY_BLOCK_KEYS)).toBe(true);
  });
});

describe("dataPolicySeed", () => {
  it("is false for a covered key under block, and undefined for every other key", () => {
    for (const key of DATA_POLICY_BLOCK_KEYS) expect(dataPolicySeed(key, "block"), key).toBe(false);
    expect(dataPolicySeed("iris_doc_get", "block")).toBeUndefined();
    expect(dataPolicySeed("iris_docdb_document:insert", "block")).toBeUndefined();
    expect(dataPolicySeed("iris_docdb_document", "block")).toBeUndefined();
  });

  it("is undefined under redact, allow and no policy, for every covered key", () => {
    for (const policy of [...DATA_POLICIES.filter((value) => value !== "block"), undefined] as const) {
      for (const key of DATA_POLICY_BLOCK_KEYS) expect(dataPolicySeed(key, policy), `${policy}/${key}`).toBeUndefined();
    }
  });

  it("never matches a key that collides with an Object.prototype member", () => {
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(dataPolicySeed(key, "block"), key).toBeUndefined();
      expect(dataPolicySeed(key, "block", ["iris_x"]), key).toBeUndefined();
    }
  });

  it("takes a custom covered list", () => {
    expect(dataPolicySeed("iris_doc_get", "block", ["iris_doc_get"])).toBe(false);
    expect(dataPolicySeed("iris_sql_query", "block", ["iris_doc_get"])).toBeUndefined();
  });
});

describe("the cascade under block", () => {
  it("seeds every covered key disabled, reported as dataPolicy", () => {
    for (const key of WORLD_COVERED) expect(resolve(key, {}, { policy: "block" }), key).toEqual(DENIED);
  });

  it("leaves a key outside the set as it was", () => {
    expect(resolve("iris_doc_get", {}, { policy: "block" })).toEqual({ value: true, source: "default" });
    expect(resolve("iris_global_set", {}, { policy: "block" })).toEqual({ value: true, source: "default" });
  });

  it("an explicit true re-enables a key at each of the four explicit layers, reported by that channel", () => {
    const key = "iris_sql_query";
    expect(resolve(key, { profiles: { default: { [key]: true } } }, { policy: "block" })).toEqual({ value: true, source: "env" });
    expect(resolve(key, { global: { [key]: true } }, { policy: "block" })).toEqual({ value: true, source: "env" });
    expect(resolve(key, {}, { policy: "block", file: { profiles: { default: { [key]: true } } } })).toEqual({ value: true, source: "file" });
    expect(resolve(key, {}, { policy: "block", file: { global: { [key]: true } } })).toEqual({ value: true, source: "file" });
  });

  it("an explicit true re-enables one key only: the others stay denied", () => {
    const config = { global: { iris_sql_query: true } };
    expect(resolve("iris_sql_query", config, { policy: "block" }).value).toBe(true);
    for (const key of WORLD_COVERED.filter((other) => other !== "iris_sql_query")) {
      expect(resolve(key, config, { policy: "block" }), key).toEqual(DENIED);
    }
  });

  it("an explicit true on another profile does not re-enable this one", () => {
    const config = { profiles: { prod: { iris_global_get: true } } };
    expect(resolve("iris_global_get", config, { policy: "block", profile: "prod" })).toEqual({ value: true, source: "env" });
    expect(resolve("iris_global_get", config, { policy: "block", profile: "stage" })).toEqual(DENIED);
  });

  it("an explicit false keeps its own attribution (env or file), never dataPolicy", () => {
    expect(resolve("iris_global_get", { global: { iris_global_get: false } }, { policy: "block" })).toEqual({ value: false, source: "env" });
    expect(resolve("iris_global_get", {}, { policy: "block", file: { global: { iris_global_get: false } } })).toEqual({ value: false, source: "file" });
  });

  it("an explicit parent enable is not inherited: the child keeps its own seed", () => {
    const config = { global: { iris_sql_execute: true } };
    expect(resolve("iris_sql_execute", config, { policy: "block" })).toEqual({ value: true, source: "env" });
    expect(resolve("iris_sql_query", config, { policy: "block" })).toEqual(DENIED);
  });

  it("an explicit parent disable is inherited and keeps parent attribution, ahead of the seed", () => {
    const config = { global: { iris_sql_execute: false } };
    expect(resolve("iris_sql_execute", config, { policy: "block" })).toEqual({ value: false, source: "env" });
    expect(resolve("iris_sql_query", config, { policy: "block" })).toEqual({ value: false, source: "parent" });
  });

  it("a seeded disable is not an explicit one: with the parent only seeded, the child is its own seed", () => {
    // iris_sql_execute is seeded false by block; iris_sql_query reports dataPolicy, not parent.
    expect(resolve("iris_sql_query", {}, { policy: "block" }).source).toBe("dataPolicy");
  });

  it("beats the preset for a covered key, and leaves a non-covered write to the preset", () => {
    const options: Options = { policy: "block", preset: "read-only" };
    expect(resolve("iris_global_get", {}, options)).toEqual(DENIED); // a read the preset leaves enabled
    expect(resolve("iris_sql_query", {}, options)).toEqual(DENIED);
    expect(resolve("iris_sql_execute", {}, options)).toEqual(DENIED); // a write the preset also blocks
    expect(resolve("iris_global_set", {}, options)).toEqual({ value: false, source: "preset" });
    expect(resolve("iris_doc_get", {}, options)).toEqual({ value: true, source: "preset" });
  });

  it("an explicit true beats both the seed and the preset", () => {
    const config = { global: { iris_execute_command: true } };
    expect(resolve("iris_execute_command", config, { policy: "block", preset: "read-only" })).toEqual({ value: true, source: "env" });
    expect(resolve("iris_global_set", config, { policy: "block", preset: "read-only" })).toEqual({ value: false, source: "preset" });
  });

  it("a custom covered list replaces the declaration", () => {
    const options: Options = { policy: "block", blockKeys: ["iris_doc_get"] };
    expect(resolve("iris_doc_get", {}, options)).toEqual(DENIED);
    expect(resolve("iris_sql_query", {}, options)).toEqual({ value: true, source: "default" });
  });
});

describe("under redact, allow and no policy the cascade is the one without the seed (AC 45.4.3)", () => {
  const CONFIGS: Array<{ label: string; config: GovernanceConfig; options: Options }> = [
    { label: "empty", config: {}, options: {} },
    { label: "read-only", config: {}, options: { preset: "read-only" } },
    { label: "explicit true", config: { global: { iris_sql_query: true, iris_global_get: true } }, options: {} },
    { label: "explicit false", config: { global: { iris_sql_execute: false, iris_global_get: false } }, options: { preset: "read-only" } },
    { label: "profile layers", config: { profiles: { prod: { iris_sql_query: true } } }, options: { profile: "prod" } },
    { label: "file layers", config: {}, options: { file: { global: { iris_global_get: false }, profiles: { default: { iris_sql_query: true } } } } },
  ];

  for (const policy of [...DATA_POLICIES.filter((value) => value !== "block"), undefined] as const) {
    for (const row of CONFIGS) {
      it(`${policy ?? "unset"} / ${row.label}: policy and sources deep-equal the calls without the new arguments`, () => {
        const profile = row.options.profile ?? "default";
        const without = getEffectivePolicy(
          profile,
          row.config,
          WORLD_KEYS,
          MUTATES,
          WORLD_BASELINE,
          DEFAULT_ENABLED,
          row.options.preset,
          CLASSIFICATIONS,
          row.options.file,
          PARENT_KEYS,
        );
        const withPolicy = getEffectivePolicy(
          profile,
          row.config,
          WORLD_KEYS,
          MUTATES,
          WORLD_BASELINE,
          DEFAULT_ENABLED,
          row.options.preset,
          CLASSIFICATIONS,
          row.options.file,
          PARENT_KEYS,
          policy,
        );
        expect(withPolicy).toEqual(without);
        const sourcesWithout = getEffectiveConfigSources(
          profile,
          row.config,
          WORLD_KEYS,
          MUTATES,
          row.options.preset,
          CLASSIFICATIONS,
          row.options.file,
          PARENT_KEYS,
        );
        const sourcesWith = getEffectiveConfigSources(
          profile,
          row.config,
          WORLD_KEYS,
          MUTATES,
          row.options.preset,
          CLASSIFICATIONS,
          row.options.file,
          PARENT_KEYS,
          policy,
        );
        expect(sourcesWith).toEqual(sourcesWithout);
        expect(Object.values(sourcesWith)).not.toContain("dataPolicy");
      });
    }
  }
});

describe("the maps under block", () => {
  it("getEffectivePolicy and getEffectiveConfigSources agree with the per-key cascade", () => {
    const config = { global: { iris_global_get: true } };
    const policy = getEffectivePolicy("default", config, WORLD_KEYS, MUTATES, WORLD_BASELINE, DEFAULT_ENABLED, undefined, CLASSIFICATIONS, undefined, PARENT_KEYS, "block");
    const sources = getEffectiveConfigSources("default", config, WORLD_KEYS, MUTATES, undefined, CLASSIFICATIONS, undefined, PARENT_KEYS, "block");
    expect(policy).toEqual({
      iris_sql_execute: false,
      iris_global_get: true,
      iris_global_set: true,
      iris_doc_get: true,
      iris_execute_command: false,
      iris_sql_query: false,
    });
    expect(sources).toEqual({
      iris_sql_execute: "dataPolicy",
      iris_global_get: "env",
      iris_global_set: "default",
      iris_doc_get: "default",
      iris_execute_command: "dataPolicy",
      iris_sql_query: "dataPolicy",
    });
  });
});
