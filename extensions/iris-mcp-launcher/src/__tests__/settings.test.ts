import { describe, expect, it } from "vitest";
import { DEFAULT_PACKAGES, readSettings, type ConfigReader } from "../settings.js";

function fakeConfig(values: Record<string, unknown>): (section: string) => ConfigReader {
  return (section: string) => {
    expect(section).toBe("irisMcpLauncher");
    return {
      get: <T>(key: string, defaultValue: T): T =>
        key in values ? (values[key] as T) : defaultValue,
    };
  };
}

describe("readSettings", () => {
  it("defaults: no config set -> all five individual packages, empty servers, HSCUSTOM namespace, combineProfiles off", () => {
    const settings = readSettings(fakeConfig({}));

    expect(settings.packages).toEqual([...DEFAULT_PACKAGES]);
    expect(settings.servers).toEqual([]);
    expect(settings.namespace).toBe("HSCUSTOM");
    expect(settings.combineProfiles).toBe(false);
    expect(settings.governance).toBe("");
  });

  it("reads every configured field through", () => {
    const settings = readSettings(
      fakeConfig({
        servers: ["prod"],
        packages: ["dev", "all"],
        namespace: "USER",
        combineProfiles: true,
        governance: "off",
        toolsPreset: "core",
      }),
    );

    expect(settings.servers).toEqual(["prod"]);
    expect(settings.packages).toEqual(["dev", "all"]);
    expect(settings.namespace).toBe("USER");
    expect(settings.combineProfiles).toBe(true);
    expect(settings.governance).toBe("off");
    expect(settings.toolsPreset).toBe("core");
  });

  it("filters out any unrecognized package key (defensive against a stale/hand-edited settings.json)", () => {
    const settings = readSettings(fakeConfig({ packages: ["dev", "bogus", "admin"] }));
    expect(settings.packages).toEqual(["dev", "admin"]);
  });

  it("falls back to HSCUSTOM when namespace is configured as an empty string", () => {
    const settings = readSettings(fakeConfig({ namespace: "" }));
    expect(settings.namespace).toBe("HSCUSTOM");
  });

  it("packages explicitly set to an empty array yields zero packages, not a silent fallback to the default five — 'unset' and 'explicitly empty' are different user intents", () => {
    const settings = readSettings(fakeConfig({ packages: [] }));
    expect(settings.packages).toEqual([]);
  });

  it("servers explicitly set to an empty array stays empty (the documented 'every available server' sentinel), it is not coerced to some other value", () => {
    const settings = readSettings(fakeConfig({ servers: [] }));
    expect(settings.servers).toEqual([]);
  });
});

/**
 * `WorkspaceConfiguration.get` returns whatever is literally in settings.json —
 * the contributed JSON schema only drives a squiggle in the settings EDITOR, it
 * never rejects or coerces a hand-written value. Every one of these inputs
 * previously reached `.filter(...)`/`.length` and threw a TypeError out of the
 * provider, registering zero servers with no message at all.
 */
describe("readSettings — hand-edited settings.json must never throw", () => {
  it("a bare string where an array was declared falls back to the default instead of throwing", () => {
    const settings = readSettings(fakeConfig({ servers: "prod", packages: "dev" }));

    expect(settings.servers).toEqual([]);
    expect(settings.packages).toEqual([...DEFAULT_PACKAGES]);
  });

  it("non-string members inside an array are dropped, not passed through", () => {
    const settings = readSettings(fakeConfig({ servers: ["prod", 42, null, "dev"] }));

    expect(settings.servers).toEqual(["prod", "dev"]);
  });

  it("a JSON number written where a string setting was declared is coerced, not silently discarded", () => {
    const settings = readSettings(fakeConfig({ auditLogMaxMb: 50 }));

    expect(settings.auditLogMaxMb).toBe("50");
  });

  it("a non-boolean combineProfiles is treated as off rather than truthy", () => {
    expect(readSettings(fakeConfig({ combineProfiles: "true" })).combineProfiles).toBe(false);
  });

  it("a whitespace-only namespace falls back to the default (both consumers only reject the empty string, so '   ' would target a nonexistent namespace)", () => {
    expect(readSettings(fakeConfig({ namespace: "   " })).namespace).toBe("HSCUSTOM");
  });
});
