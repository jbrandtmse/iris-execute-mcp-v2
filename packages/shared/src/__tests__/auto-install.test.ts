/**
 * Story 45.2: the automatic-install setting's pure parts (AD-9, AD-8, AD-14).
 *
 * Pins the parse of `IRIS_AUTO_INSTALL`, the precedence (profile, variable, read-only preset, on), that a
 * `default` entry's value is never inherited, that Server Manager profiles take the variable, the two
 * conflicts with the read-only preset, the malformed values, and the `IRIS_PROFILES` field.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyAutoInstall,
  parseOperatorAutoInstall,
  resolveAutoInstall,
} from "../auto-install.js";
import type { AutoInstallCarrier } from "../auto-install.js";
import { buildProfileRegistry, mergeProfile } from "../profiles.js";
import { loadConfig } from "../config.js";

const CONNECTION_ENV = { IRIS_USERNAME: "u", IRIS_PASSWORD: "p" };

/** A registry built by the real `buildProfileRegistry` from `IRIS_PROFILES`. */
function registryFor(profiles?: unknown) {
  const env: Record<string, string | undefined> = { ...CONNECTION_ENV };
  if (profiles !== undefined) env.IRIS_PROFILES = JSON.stringify(profiles);
  return buildProfileRegistry(loadConfig(env), env);
}

describe("parseOperatorAutoInstall (IRIS_AUTO_INSTALL)", () => {
  it("is undefined when unset or empty", () => {
    expect(parseOperatorAutoInstall({})).toBeUndefined();
    expect(parseOperatorAutoInstall({ IRIS_AUTO_INSTALL: "" })).toBeUndefined();
  });

  it("accepts true and false in any letter case", () => {
    expect(parseOperatorAutoInstall({ IRIS_AUTO_INSTALL: "true" })).toBe(true);
    expect(parseOperatorAutoInstall({ IRIS_AUTO_INSTALL: "TRUE" })).toBe(true);
    expect(parseOperatorAutoInstall({ IRIS_AUTO_INSTALL: "False" })).toBe(false);
    expect(parseOperatorAutoInstall({ IRIS_AUTO_INSTALL: "false" })).toBe(false);
  });

  it("fails fast, naming the variable and echoing the value, on anything else", () => {
    for (const bad of ["yes", "1", "0", " true", "off", "on"]) {
      expect(() => parseOperatorAutoInstall({ IRIS_AUTO_INSTALL: bad }), bad).toThrow(
        `IRIS_AUTO_INSTALL must be "true" or "false". Received: "${bad}".`,
      );
    }
  });
});

describe("resolveAutoInstall: the precedence, first match wins", () => {
  const plain: AutoInstallCarrier = { name: "p" };
  const own = (autoInstall: boolean): AutoInstallCarrier => ({ name: "p", autoInstall, autoInstallSource: "IRIS_PROFILES" });

  it("nothing set: on, from default", () => {
    expect(resolveAutoInstall(plain, undefined, undefined)).toEqual({ autoInstall: true, source: "default" });
    expect(resolveAutoInstall(plain, undefined, "full")).toEqual({ autoInstall: true, source: "default" });
  });

  it("the read-only preset forces it off", () => {
    expect(resolveAutoInstall(plain, undefined, "read-only")).toEqual({
      autoInstall: false,
      source: "IRIS_GOVERNANCE_PRESET",
    });
  });

  it("the variable beats the preset and the default", () => {
    expect(resolveAutoInstall(plain, false, undefined)).toEqual({ autoInstall: false, source: "IRIS_AUTO_INSTALL" });
    expect(resolveAutoInstall(plain, true, undefined)).toEqual({ autoInstall: true, source: "IRIS_AUTO_INSTALL" });
    expect(resolveAutoInstall(plain, false, "read-only")).toEqual({ autoInstall: false, source: "IRIS_AUTO_INSTALL" });
  });

  it("the profile's own value beats the variable (both directions)", () => {
    expect(resolveAutoInstall(own(false), true, undefined)).toEqual({ autoInstall: false, source: "IRIS_PROFILES" });
    expect(resolveAutoInstall(own(true), false, undefined)).toEqual({ autoInstall: true, source: "IRIS_PROFILES" });
  });

  it("is idempotent: a value an earlier resolution wrote from another channel is recomputed", () => {
    const resolved: AutoInstallCarrier = { name: "p", autoInstall: false, autoInstallSource: "IRIS_AUTO_INSTALL" };
    expect(resolveAutoInstall(resolved, undefined, undefined)).toEqual({ autoInstall: true, source: "default" });
  });
});

describe("applyAutoInstall over a real registry", () => {
  it("writes autoInstall and autoInstallSource on every profile", () => {
    const registry = registryFor({ p2: { host: "other" } });
    applyAutoInstall(registry, undefined, undefined);
    for (const profile of registry.values()) {
      expect(profile.autoInstall).toBe(true);
      expect(profile.autoInstallSource).toBe("default");
    }
  });

  it("never inherits the default entry's value: default off (IRIS_PROFILES), p2 on (default)", () => {
    const registry = registryFor({ default: { autoInstall: false }, p2: {} });
    applyAutoInstall(registry, undefined, undefined);
    expect(registry.get("default")).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_PROFILES" });
    expect(registry.get("p2")).toMatchObject({ autoInstall: true, autoInstallSource: "default" });
  });

  it("a profile that sets it and one that does not, side by side", () => {
    const registry = registryFor({ p1: { autoInstall: false }, p2: {} });
    applyAutoInstall(registry, undefined, undefined);
    expect(registry.get("p1")).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_PROFILES" });
    expect(registry.get("p2")).toMatchObject({ autoInstall: true });
  });

  it("precedence over a registry: profile false + variable true is off (IRIS_PROFILES); profile true + variable false is on", () => {
    const off = registryFor({ p: { autoInstall: false } });
    applyAutoInstall(off, true, undefined);
    expect(off.get("p")).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_PROFILES" });
    const on = registryFor({ p: { autoInstall: true } });
    applyAutoInstall(on, false, undefined);
    expect(on.get("p")).toMatchObject({ autoInstall: true, autoInstallSource: "IRIS_PROFILES" });
  });

  it("the read-only preset turns every profile off, a Server Manager profile included (source: the preset)", () => {
    const registry = registryFor({ p2: {} });
    registry.set("sm", { ...registry.get("p2")!, name: "sm", source: "server-manager" });
    applyAutoInstall(registry, undefined, "read-only");
    for (const profile of registry.values()) {
      expect(profile).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_GOVERNANCE_PRESET" });
    }
  });

  it("IRIS_AUTO_INSTALL=false under the read-only preset: off, source IRIS_AUTO_INSTALL", () => {
    const registry = registryFor();
    applyAutoInstall(registry, false, "read-only");
    expect(registry.get("default")).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_AUTO_INSTALL" });
  });

  it("a Server Manager profile takes the variable", () => {
    const registry = registryFor();
    registry.set("sm", { ...registry.get("default")!, name: "sm", source: "server-manager" });
    applyAutoInstall(registry, false, undefined);
    expect(registry.get("sm")).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_AUTO_INSTALL" });
  });

  it("running it twice gives the same registry", () => {
    const registry = registryFor({ p1: { autoInstall: false }, p2: {} });
    applyAutoInstall(registry, undefined, "read-only");
    const once = JSON.stringify([...registry.entries()]);
    applyAutoInstall(registry, undefined, "read-only");
    expect(JSON.stringify([...registry.entries()])).toBe(once);
  });
});

describe("the conflicts with the read-only preset fail startup naming both settings", () => {
  it("IRIS_AUTO_INSTALL=true + read-only: names both and the way out; the registry is not changed", () => {
    const registry = registryFor({ p2: {} });
    const before = JSON.stringify([...registry.entries()]);
    expect(() => applyAutoInstall(registry, true, "read-only")).toThrow(/IRIS_AUTO_INSTALL=true conflicts with IRIS_GOVERNANCE_PRESET=read-only/);
    try {
      applyAutoInstall(registry, true, "read-only");
    } catch (error) {
      const text = (error as Error).message;
      expect(text).toContain("Unset IRIS_AUTO_INSTALL (or set it to false)");
      expect(text).toContain("remove the read-only preset");
    }
    expect(JSON.stringify([...registry.entries()])).toBe(before);
  });

  it('a profile\'s "autoInstall": true + read-only: names IRIS_PROFILES, the profile, autoInstall and the preset', () => {
    const registry = registryFor({ p2: { autoInstall: true } });
    expect(() => applyAutoInstall(registry, undefined, "read-only")).toThrow(
      /IRIS_PROFILES profile "p2": "autoInstall": true conflicts with IRIS_GOVERNANCE_PRESET=read-only/,
    );
  });

  it("the default entry's autoInstall: true conflicts too", () => {
    const registry = registryFor({ default: { autoInstall: true } });
    expect(() => applyAutoInstall(registry, undefined, "read-only")).toThrow(/profile "default"/);
  });

  it("a profile's autoInstall: false under read-only is not a conflict", () => {
    const registry = registryFor({ p2: { autoInstall: false } });
    expect(() => applyAutoInstall(registry, undefined, "read-only")).not.toThrow();
    expect(registry.get("p2")).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_PROFILES" });
  });

  it("an explicit true without the read-only preset (or with the full preset) is no conflict", () => {
    expect(() => applyAutoInstall(registryFor({ p2: { autoInstall: true } }), true, undefined)).not.toThrow();
    expect(() => applyAutoInstall(registryFor({ p2: { autoInstall: true } }), true, "full")).not.toThrow();
  });
});

describe("the IRIS_PROFILES autoInstall field", () => {
  const base = loadConfig(CONNECTION_ENV);

  it("is recorded with source IRIS_PROFILES and never inherited from base", () => {
    expect(mergeProfile("p", base, { autoInstall: false })).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_PROFILES" });
    expect(mergeProfile("p", base, { autoInstall: true })).toMatchObject({ autoInstall: true, autoInstallSource: "IRIS_PROFILES" });
    const inheriting = mergeProfile("p", { ...base, autoInstall: false, autoInstallSource: "IRIS_PROFILES" }, {});
    expect(inheriting).not.toHaveProperty("autoInstall");
    expect(inheriting).not.toHaveProperty("autoInstallSource");
  });

  it("loadConfig never sets it", () => {
    expect(loadConfig(CONNECTION_ENV)).not.toHaveProperty("autoInstall");
    expect(loadConfig({ ...CONNECTION_ENV, IRIS_AUTO_INSTALL: "false" })).not.toHaveProperty("autoInstall");
  });

  it('rejects a non-boolean, naming the profile and IRIS_PROFILES: p2:{autoInstall:"true"}', () => {
    expect(() => registryFor({ p2: { autoInstall: "true" } })).toThrow(
      'IRIS_PROFILES is invalid: profile "p2": "autoInstall" must be a boolean (true/false).',
    );
    for (const bad of [1, 0, null, {}, []]) {
      expect(() => mergeProfile("p2", base, { autoInstall: bad }), JSON.stringify(bad)).toThrow(/"autoInstall" must be a boolean/);
    }
  });
});

describe("a profile imported by the real Server Manager source", () => {
  let dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  /** The registry `loadProfileRegistry` builds from a real settings file whose server entry even carries an `autoInstall` key. */
  async function smRegistry() {
    const dir = mkdtempSync(join(tmpdir(), "iris-auto-install-sm-"));
    dirs.push(dir);
    mkdirSync(join(dir, ".vscode"), { recursive: true });
    writeFileSync(
      join(dir, ".vscode", "settings.json"),
      JSON.stringify({
        "intersystems.servers": {
          smserver: {
            webServer: { scheme: "http", host: "sm.example.com", port: 52773 },
            username: "smuser",
            password: "smpass",
            autoInstall: false,
          },
        },
      }),
      "utf8",
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = {
      ...CONNECTION_ENV,
      IRIS_SERVER_MANAGER: "auto",
      IRIS_SM_SETTINGS_PATHS: join(dir, ".vscode", "settings.json"),
    };
    const { loadProfileRegistry } = await import("../profiles.js");
    const registry = await loadProfileRegistry(env, process.platform, { getKeychainPassword: async () => undefined });
    expect(registry.get("smserver")).toMatchObject({ source: "server-manager", host: "sm.example.com" });
    return registry;
  }

  it("never carries the field: a key in the settings file is not read, so with nothing set the profile installs (default)", async () => {
    const registry = await smRegistry();
    expect(registry.get("smserver")).not.toHaveProperty("autoInstall");
    applyAutoInstall(registry, undefined, undefined);
    expect(registry.get("smserver")).toMatchObject({ autoInstall: true, autoInstallSource: "default" });
  });

  it("takes the variable: IRIS_AUTO_INSTALL=false turns it off (source IRIS_AUTO_INSTALL), and the read-only preset turns it off (source preset)", async () => {
    const withVariable = await smRegistry();
    applyAutoInstall(withVariable, false, undefined);
    expect(withVariable.get("smserver")).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_AUTO_INSTALL" });
    const withPreset = await smRegistry();
    applyAutoInstall(withPreset, undefined, "read-only");
    expect(withPreset.get("smserver")).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_GOVERNANCE_PRESET" });
  });
});
