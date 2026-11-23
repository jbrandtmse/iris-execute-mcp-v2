/**
 * Story 44.6: `IRIS_CREDENTIAL_NAME`, the opt-in that lets the `default`
 * profile and each `IRIS_PROFILES` member take their password from the
 * keychain / `IRIS_CREDENTIAL_HELPER` chain (AD-9).
 *
 * Every keychain and helper here is an injected fake: no test touches a real
 * keychain or spawns a helper. The unset-path rows pin today's behaviour
 * (AD-15, Rule #19): the error texts are the pre-story literals, taken from
 * `loadConfig` at the baseline commit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { loadConfig } from "../config.js";
import { loadProfileRegistry } from "../profiles.js";
import { resolveCredential, resolveStoredCredential } from "../credential-chain.js";
import { logger } from "../logger.js";

const BASE_ENV = {
  IRIS_HOST: "iris.example.com",
  IRIS_PORT: "52773",
  IRIS_USERNAME: "svc",
  IRIS_NAMESPACE: "APP",
};

/** Keychain fake keyed by account; records every account it was asked for. */
function fakeKeychain(entries: Record<string, string>) {
  const asked: string[] = [];
  const getKeychainPassword = async (account: string): Promise<string | undefined> => {
    asked.push(account);
    return entries[account];
  };
  return { asked, getKeychainPassword };
}

/** Helper fake keyed by account; records `(command, account)` pairs. */
function fakeHelper(entries: Record<string, string>) {
  const calls: Array<[string, string]> = [];
  const runCredentialHelper = async (command: string, account: string): Promise<string | undefined> => {
    calls.push([command, account]);
    return entries[account];
  };
  return { calls, runCredentialHelper };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("loadConfig with IRIS_CREDENTIAL_NAME", () => {
  it("returns an empty password when IRIS_PASSWORD is unset or empty (pending the chain)", () => {
    expect(loadConfig({ ...BASE_ENV, IRIS_CREDENTIAL_NAME: "dev1" }).password).toBe("");
    expect(loadConfig({ ...BASE_ENV, IRIS_PASSWORD: "", IRIS_CREDENTIAL_NAME: "dev1" }).password).toBe("");
  });

  it("uses a non-empty IRIS_PASSWORD as today", () => {
    expect(loadConfig({ ...BASE_ENV, IRIS_PASSWORD: "pw", IRIS_CREDENTIAL_NAME: "dev1" }).password).toBe("pw");
  });

  it("still requires IRIS_USERNAME", () => {
    const withoutUser: Record<string, string | undefined> = { ...BASE_ENV, IRIS_USERNAME: undefined };
    expect(() => loadConfig({ ...withoutUser, IRIS_CREDENTIAL_NAME: "dev1" })).toThrow(
      "IRIS_USERNAME environment variable is required. Set it to a valid IRIS username.",
    );
  });
});

describe("AC-1/AC-2: the default profile takes its password from the chain", () => {
  it.each([
    ["unset", {}],
    ["empty", { IRIS_PASSWORD: "" }],
  ])("keychain entry (IRIS_PASSWORD %s) equals an IRIS_PASSWORD of that value", async (_label, passwordEnv) => {
    const kc = fakeKeychain({ dev1: "stored-pw" });
    const registry = await loadProfileRegistry(
      { ...BASE_ENV, ...passwordEnv, IRIS_CREDENTIAL_NAME: "dev1" },
      undefined,
      { getKeychainPassword: kc.getKeychainPassword },
    );
    const expected = await loadProfileRegistry({ ...BASE_ENV, IRIS_PASSWORD: "stored-pw" });
    expect(registry.get("default")).toEqual(expected.get("default"));
    expect(registry.get("default")?.password).toBe("stored-pw");
    expect(registry.get("default")?.source).toBe("env");
    expect(kc.asked).toEqual(["dev1"]);
  });

  it("falls back to the credential helper, which receives the name", async () => {
    const kc = fakeKeychain({});
    const helper = fakeHelper({ dev1: "helper-pw" });
    const registry = await loadProfileRegistry(
      { ...BASE_ENV, IRIS_CREDENTIAL_NAME: "dev1", IRIS_CREDENTIAL_HELPER: "my-helper --flag" },
      undefined,
      { getKeychainPassword: kc.getKeychainPassword, runCredentialHelper: helper.runCredentialHelper },
    );
    expect(registry.get("default")?.password).toBe("helper-pw");
    expect(helper.calls).toEqual([["my-helper --flag", "dev1"]]);
  });
});

describe("AC-3: an exhausted chain fails fast", () => {
  it("names the variable, the name and the remediation, and carries no password", async () => {
    const kc = fakeKeychain({});
    const helper = fakeHelper({});
    const error = await loadProfileRegistry(
      { ...BASE_ENV, IRIS_CREDENTIAL_NAME: "dev1", IRIS_CREDENTIAL_HELPER: "my-helper" },
      undefined,
      { getKeychainPassword: kc.getKeychainPassword, runCredentialHelper: helper.runCredentialHelper },
    ).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain("IRIS_CREDENTIAL_NAME");
    expect(error?.message).toContain('"dev1"');
    expect(error?.message).toContain("iris-mcp-credentials set dev1");
    expect(error?.message).toContain("IRIS_CREDENTIAL_HELPER");
    expect(error?.message).toContain("IRIS_PASSWORD");
  });
});

describe("AC-4: an explicit IRIS_PASSWORD wins and link 1 is never consulted", () => {
  it("uses IRIS_PASSWORD and calls neither seam", async () => {
    const kc = fakeKeychain({ dev1: "stored-pw" });
    const helper = fakeHelper({ dev1: "helper-pw" });
    const registry = await loadProfileRegistry(
      {
        ...BASE_ENV,
        IRIS_PASSWORD: "explicit-pw",
        IRIS_CREDENTIAL_NAME: "dev1",
        IRIS_CREDENTIAL_HELPER: "my-helper",
      },
      undefined,
      { getKeychainPassword: kc.getKeychainPassword, runCredentialHelper: helper.runCredentialHelper },
    );
    expect(registry.get("default")?.password).toBe("explicit-pw");
    expect(kc.asked).toEqual([]);
    expect(helper.calls).toEqual([]);
  });

  it("with IRIS_PROFILES members that carry no password, a non-empty IRIS_PASSWORD still calls neither seam", async () => {
    const kc = fakeKeychain({ a: "pa", dev1: "stored-pw" });
    const helper = fakeHelper({ a: "helper-a" });
    const registry = await loadProfileRegistry(
      {
        ...BASE_ENV,
        IRIS_PASSWORD: "explicit-pw",
        IRIS_CREDENTIAL_NAME: "dev1",
        IRIS_CREDENTIAL_HELPER: "my-helper",
        IRIS_PROFILES: JSON.stringify({ a: { host: "h1" } }),
      },
      undefined,
      { getKeychainPassword: kc.getKeychainPassword, runCredentialHelper: helper.runCredentialHelper },
    );
    expect(registry.get("a")?.password).toBe("explicit-pw");
    expect(registry.get("default")?.password).toBe("explicit-pw");
    expect(kc.asked).toEqual([]);
    expect(helper.calls).toEqual([]);
  });

  it("does not hand default the password of an IRIS_PROFILES member named like the credential", async () => {
    const env = {
      ...BASE_ENV,
      IRIS_CREDENTIAL_NAME: "dev1",
      IRIS_PROFILES: JSON.stringify({ dev1: { host: "other.example.com", password: "member-pw" } }),
    };
    // Oracle: the full chain WOULD return the member's password for that account (link 1).
    expect((await resolveCredential("dev1", { env, getKeychainPassword: async () => undefined }))?.password).toBe(
      "member-pw",
    );
    const kc = fakeKeychain({ dev1: "stored-pw" });
    const registry = await loadProfileRegistry(env, undefined, { getKeychainPassword: kc.getKeychainPassword });
    expect(registry.get("default")?.password).toBe("stored-pw");
    expect(registry.get("dev1")?.password).toBe("member-pw");
  });

  it("resolveStoredCredential never consults link 1", async () => {
    const env = { IRIS_PASSWORD: "env-pw", IRIS_PROFILES: JSON.stringify({ x: { password: "member-pw" } }) };
    const kc = fakeKeychain({});
    expect(await resolveStoredCredential("x", { env, getKeychainPassword: kc.getKeychainPassword })).toBeUndefined();
    expect(kc.asked).toEqual(["x"]);
  });
});

describe("AC-5: IRIS_PROFILES members look up their own name", () => {
  const profiles = JSON.stringify({
    a: { host: "h1" },
    b: { host: "h2", password: "pb" },
    default: { namespace: "X" },
  });

  it("a gets its own entry, b keeps its password, default gets the named entry", async () => {
    const kc = fakeKeychain({ a: "pa", dev1: "pdev" });
    const registry = await loadProfileRegistry(
      { ...BASE_ENV, IRIS_CREDENTIAL_NAME: "dev1", IRIS_PROFILES: profiles },
      undefined,
      { getKeychainPassword: kc.getKeychainPassword },
    );
    expect(registry.get("a")?.password).toBe("pa");
    expect(registry.get("a")?.host).toBe("h1");
    expect(registry.get("b")?.password).toBe("pb");
    expect(registry.get("default")?.password).toBe("pdev");
    expect(registry.get("default")?.namespace).toBe("X");
    expect(kc.asked).toEqual(["dev1", "a"]);
    expect(warnSpy).toHaveBeenCalledTimes(1); // only the existing "IRIS_PROFILES defines default" notice
  });

  it("a member without an entry inherits the default password and one warning names it", async () => {
    const kc = fakeKeychain({ dev1: "pdev" });
    const registry = await loadProfileRegistry(
      { ...BASE_ENV, IRIS_CREDENTIAL_NAME: "dev1", IRIS_PROFILES: profiles },
      undefined,
      { getKeychainPassword: kc.getKeychainPassword },
    );
    expect(registry.get("a")?.password).toBe("pdev");
    const memberWarnings = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('"a"'));
    expect(memberWarnings).toHaveLength(1);
    expect(memberWarnings[0]).toContain("iris-mcp-credentials set a");
    expect(memberWarnings[0]).not.toContain("pdev");
  });
});

describe("AC-6: with IRIS_CREDENTIAL_NAME unset, empty or blank everything is as before", () => {
  const PRE_STORY_USERNAME_TEXT = "IRIS_USERNAME environment variable is required. Set it to a valid IRIS username.";
  const PRE_STORY_PASSWORD_TEXT = "IRIS_PASSWORD environment variable is required. Set it to the password for the IRIS user.";
  const profiles = JSON.stringify({ a: { host: "h1" }, b: { password: "pb" } });

  const offValues: Array<[string, Record<string, string>]> = [
    ["unset", {}],
    ["empty", { IRIS_CREDENTIAL_NAME: "" }],
    ["blank", { IRIS_CREDENTIAL_NAME: "   " }],
  ];

  it.each(offValues)("%s: loadConfig and loadProfileRegistry outputs equal the pre-story outputs, no seam is called", async (_l, extra) => {
    const env = { ...BASE_ENV, IRIS_PASSWORD: "pw", IRIS_PROFILES: profiles };
    const kc = fakeKeychain({ a: "pa", dev1: "x" });
    const helper = fakeHelper({ a: "pa" });
    const deps = { getKeychainPassword: kc.getKeychainPassword, runCredentialHelper: helper.runCredentialHelper };

    expect(loadConfig({ ...env, ...extra })).toEqual(loadConfig(env));
    const withVar = await loadProfileRegistry({ ...env, ...extra, IRIS_CREDENTIAL_HELPER: "h" }, undefined, deps);
    const without = await loadProfileRegistry({ ...env, IRIS_CREDENTIAL_HELPER: "h" }, undefined, deps);
    expect([...withVar]).toEqual([...without]);
    expect(withVar.get("a")?.password).toBe("pw");
    expect(kc.asked).toEqual([]);
    expect(helper.calls).toEqual([]);
  });

  it.each(offValues)("%s: the missing-password and missing-username texts are the pre-story literals", async (_l, extra) => {
    const kc = fakeKeychain({ dev1: "stored-pw" });
    expect(() => loadConfig({ ...BASE_ENV, ...extra })).toThrow(new Error(PRE_STORY_PASSWORD_TEXT));
    expect(() => loadConfig({ ...BASE_ENV, IRIS_PASSWORD: "", ...extra })).toThrow(new Error(PRE_STORY_PASSWORD_TEXT));
    await expect(
      loadProfileRegistry({ ...BASE_ENV, ...extra }, undefined, { getKeychainPassword: kc.getKeychainPassword }),
    ).rejects.toThrow(new Error(PRE_STORY_PASSWORD_TEXT));
    const withoutUser: Record<string, string | undefined> = { ...BASE_ENV, IRIS_USERNAME: undefined };
    expect(() => loadConfig({ ...withoutUser, IRIS_PASSWORD: "pw", ...extra })).toThrow(
      new Error(PRE_STORY_USERNAME_TEXT),
    );
    expect(kc.asked).toEqual([]);
  });
});

describe("AC-7: a control character in IRIS_CREDENTIAL_NAME fails fast", () => {
  it.each(["dev\n1", "dev1\r", "de\tv", "dev\u00001", "dev\u007f1"])("rejects %j naming the variable", async (name) => {
    const env = { ...BASE_ENV, IRIS_PASSWORD: "pw", IRIS_CREDENTIAL_NAME: name };
    expect(() => loadConfig(env)).toThrow(/IRIS_CREDENTIAL_NAME/);
    await expect(loadProfileRegistry(env)).rejects.toThrow(/IRIS_CREDENTIAL_NAME/);
  });
});
