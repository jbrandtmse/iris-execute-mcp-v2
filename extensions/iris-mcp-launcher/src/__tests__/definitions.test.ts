import { describe, expect, it } from "vitest";
import { PACKAGE_NPM_NAME, planDefinitions } from "../definitions.js";
import type { LauncherSettings } from "../types.js";

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
  return {
    servers: [],
    packages: ["dev"],
    namespace: "HSCUSTOM",
    combineProfiles: false,
    governance: "",
    governancePreset: "",
    auditLog: "",
    auditLogMaxMb: "",
    auditLogParams: "",
    toolsPreset: "",
    toolsDisable: "",
    toolsEnable: "",
    ...overrides,
  };
}

describe("planDefinitions", () => {
  it("returns one definition per (package, server) pair by default (cross product)", () => {
    const plans = planDefinitions(settings({ packages: ["dev", "admin"] }), ["serverA", "serverB"]);

    expect(plans).toHaveLength(4);
    expect(plans.every((p) => p.serverNames.length === 1)).toBe(true);
    expect(new Set(plans.map((p) => p.label)).size).toBe(4); // labels unique
  });

  it("uses every available server when settings.servers is empty", () => {
    const plans = planDefinitions(settings({ packages: ["dev"] }), ["a", "b", "c"]);
    expect(plans.map((p) => p.serverNames[0]).sort()).toEqual(["a", "b", "c"]);
  });

  it("intersects settings.servers with availableServerNames, silently dropping unknown names", () => {
    const plans = planDefinitions(settings({ packages: ["dev"], servers: ["a", "ghost"] }), [
      "a",
      "b",
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.serverNames).toEqual(["a"]);
  });

  it("returns [] when no servers are available/selected", () => {
    expect(planDefinitions(settings({ packages: ["dev"] }), [])).toEqual([]);
  });

  it("returns [] when no packages are selected", () => {
    expect(planDefinitions(settings({ packages: [] }), ["a"])).toEqual([]);
  });

  it("combineProfiles=true: one definition per package, covering every selected server", () => {
    const plans = planDefinitions(settings({ packages: ["dev", "ops"], combineProfiles: true }), [
      "a",
      "b",
      "c",
    ]);

    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect(plan.serverNames).toEqual(["a", "b", "c"]);
    }
  });

  it("de-duplicates repeated servers/packages so no two plans share a label", () => {
    const plans = planDefinitions(
      settings({ packages: ["dev", "dev", "admin"], servers: ["a", "a", "b"] }),
      ["a", "b"],
    );

    const labels = plans.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
    // 2 unique packages x 2 unique servers
    expect(plans).toHaveLength(4);
  });

  it("de-duplicates repeated servers inside a combineProfiles plan (no redundant credential prompt, no overwritten profile)", () => {
    const plans = planDefinitions(
      settings({ packages: ["dev"], servers: ["a", "a"], combineProfiles: true }),
      ["a"],
    );

    expect(plans).toHaveLength(1);
    expect(plans[0]?.serverNames).toEqual(["a"]);
  });

  it("maps every SuitePackageKey to its documented npm package name", () => {
    expect(PACKAGE_NPM_NAME).toEqual({
      admin: "@iris-mcp/admin",
      data: "@iris-mcp/data",
      dev: "@iris-mcp/dev",
      interop: "@iris-mcp/interop",
      ops: "@iris-mcp/ops",
      all: "@iris-mcp/all",
    });
  });

  it("plan labels are stable/deterministic for the same inputs (used as the resolve-time lookup key)", () => {
    const a = planDefinitions(settings({ packages: ["dev"] }), ["x"]);
    const b = planDefinitions(settings({ packages: ["dev"] }), ["x"]);
    expect(a[0]?.label).toBe(b[0]?.label);
  });
});
