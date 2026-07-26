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
  it("defaults: no config set -> all five individual packages, empty servers, HSCUSTOM namespace, combineProfiles off, developmentRepoPath empty", () => {
    const settings = readSettings(fakeConfig({}));

    expect(settings.packages).toEqual([...DEFAULT_PACKAGES]);
    expect(settings.servers).toEqual([]);
    expect(settings.namespace).toBe("HSCUSTOM");
    expect(settings.combineProfiles).toBe(false);
    expect(settings.governance).toBe("");
    expect(settings.developmentRepoPath).toBe("");
    expect(settings.hadStaleAllPackage).toBe(false);
  });

  it("reads every configured field through, including developmentRepoPath", () => {
    const settings = readSettings(
      fakeConfig({
        servers: ["prod"],
        packages: ["dev", "admin"],
        namespace: "USER",
        combineProfiles: true,
        governance: "off",
        toolsPreset: "core",
        developmentRepoPath: "/home/dev/iris-execute-mcp-v2",
      }),
    );

    expect(settings.servers).toEqual(["prod"]);
    expect(settings.packages).toEqual(["dev", "admin"]);
    expect(settings.namespace).toBe("USER");
    expect(settings.combineProfiles).toBe(true);
    expect(settings.governance).toBe("off");
    expect(settings.toolsPreset).toBe("core");
    expect(settings.developmentRepoPath).toBe("/home/dev/iris-execute-mcp-v2");
    expect(settings.hadStaleAllPackage).toBe(false);
  });

  it("filters out any unrecognized package key (defensive against a stale/hand-edited settings.json)", () => {
    const settings = readSettings(fakeConfig({ packages: ["dev", "bogus", "admin"] }));
    expect(settings.packages).toEqual(["dev", "admin"]);
  });

  it("trims whitespace off developmentRepoPath the same way namespace is trimmed", () => {
    const settings = readSettings(fakeConfig({ developmentRepoPath: "  /home/dev/repo  " }));
    expect(settings.developmentRepoPath).toBe("/home/dev/repo");
  });

  it("a developmentRepoPath of only whitespace normalizes to the empty-string default (back-compat npx path)", () => {
    const settings = readSettings(fakeConfig({ developmentRepoPath: "   " }));
    expect(settings.developmentRepoPath).toBe("");
  });

  /**
   * QA pass (Story 31.6) — the settings layer applies ONLY `.trim()` to
   * `developmentRepoPath`; it must never reshape, resolve, or reject an
   * otherwise-valid-looking path string. `readSettings` never touches the
   * filesystem (that validation is `LauncherProvider.resolveSpawnTargets`'s
   * job, covered with real fs fixtures in `serverDefinitionProvider.test.ts`),
   * so these are pinned here as pure string round-trips.
   */
  it("preserves internal spaces in developmentRepoPath verbatim — only leading/trailing whitespace is trimmed, not spaces inside the path", () => {
    const settings = readSettings(
      fakeConfig({ developmentRepoPath: "  /home/dev/my repo with spaces  " }),
    );
    expect(settings.developmentRepoPath).toBe("/home/dev/my repo with spaces");
  });

  it("preserves a relative developmentRepoPath verbatim — it is not resolved against cwd or otherwise normalized here", () => {
    const settings = readSettings(fakeConfig({ developmentRepoPath: "  ../sibling-repo  " }));
    expect(settings.developmentRepoPath).toBe("../sibling-repo");
  });

  it("preserves a trailing path separator on developmentRepoPath verbatim — it is not stripped at the settings layer", () => {
    const settings = readSettings(fakeConfig({ developmentRepoPath: "/home/dev/repo/" }));
    expect(settings.developmentRepoPath).toBe("/home/dev/repo/");

    const windowsStyle = readSettings(fakeConfig({ developmentRepoPath: "C:\\dev\\repo\\" }));
    expect(windowsStyle.developmentRepoPath).toBe("C:\\dev\\repo\\");
  });

  it("preserves a UNC-style developmentRepoPath verbatim — no special-casing of the \\\\server\\share form at the settings layer", () => {
    const settings = readSettings(
      fakeConfig({ developmentRepoPath: "\\\\myserver\\share\\iris-execute-mcp-v2" }),
    );
    expect(settings.developmentRepoPath).toBe("\\\\myserver\\share\\iris-execute-mcp-v2");
  });

  it("AC 31.6.5: 'all' in the raw packages array is filtered out (like any unrecognized key) AND flagged via hadStaleAllPackage", () => {
    const settings = readSettings(fakeConfig({ packages: ["dev", "all"] }));
    expect(settings.packages).toEqual(["dev"]);
    expect(settings.hadStaleAllPackage).toBe(true);
  });

  it("hadStaleAllPackage is false when 'all' is not present, even alongside other unrecognized keys", () => {
    const settings = readSettings(fakeConfig({ packages: ["dev", "bogus"] }));
    expect(settings.hadStaleAllPackage).toBe(false);
  });

  it("'all' as the ONLY configured package still yields hadStaleAllPackage true with packages ending up empty (not silently falling back to the default five)", () => {
    const settings = readSettings(fakeConfig({ packages: ["all"] }));
    expect(settings.packages).toEqual([]);
    expect(settings.hadStaleAllPackage).toBe(true);
  });

  it("'all' appearing TWICE in the raw array still yields hadStaleAllPackage as a single boolean true (not double-counted), and 'dev' is kept exactly once — this is where a duplicated stale key collapses to the ONE-warning guarantee LauncherProvider relies on", () => {
    const settings = readSettings(fakeConfig({ packages: ["all", "dev", "all"] }));
    expect(settings.packages).toEqual(["dev"]);
    expect(settings.hadStaleAllPackage).toBe(true);
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

  it("a JSON number/boolean developmentRepoPath is coerced to its string form (same toSettingString discipline as every other string setting), never thrown", () => {
    expect(readSettings(fakeConfig({ developmentRepoPath: 42 })).developmentRepoPath).toBe("42");
    expect(readSettings(fakeConfig({ developmentRepoPath: true })).developmentRepoPath).toBe("true");
  });

  it("a developmentRepoPath of the wrong shape entirely (array/object) falls back to the empty-string default instead of throwing", () => {
    expect(readSettings(fakeConfig({ developmentRepoPath: ["not", "a", "string"] })).developmentRepoPath).toBe(
      "",
    );
    expect(readSettings(fakeConfig({ developmentRepoPath: { path: "x" } })).developmentRepoPath).toBe("");
  });

  it("a non-array packages value still computes hadStaleAllPackage as false rather than throwing", () => {
    expect(readSettings(fakeConfig({ packages: "all" })).hadStaleAllPackage).toBe(false);
  });
});
