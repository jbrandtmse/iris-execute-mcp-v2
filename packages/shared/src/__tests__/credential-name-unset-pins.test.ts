/**
 * Story 44.6 QA: the owner's condition "only when the new setting is used" (AD-15, Rule #19), pinned against LITERALS.
 *
 * With `IRIS_CREDENTIAL_NAME` unset, `""` or whitespace, a password-less `IRIS_PROFILES` member must behave exactly
 * as in 1.1.0 (the baseline commit 374477bd):
 *
 * - (a) the member inherits the `default` profile's password; the whole registry equals the pre-story output, and
 *   neither the keychain nor the credential-helper seam is ever called, although both hold entries for every name
 *   in play (the member, `default`, the would-be credential name);
 * - (b) `default` itself without a password fails with the verbatim pre-story `IRIS_PASSWORD ... is required`
 *   text, with a password-less member present, and again no seam is called.
 *
 * Oracle (Rule #36): the expected registry below was CAPTURED by running the baseline's built `loadProfileRegistry`
 * (`git archive 374477bd packages/shared`, `tsc`, then `loadProfileRegistry(env)` on exactly this env, printed as
 * JSON), not derived from the implementation. The two error texts are the baseline `loadConfig` literals.
 * Unlike the AC-6 rows of `credential-name.test.ts`, which compare two post-change runs, these compare against that
 * capture.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { loadConfig } from "../config.js";
import { loadProfileRegistry } from "../profiles.js";
import { logger } from "../logger.js";

const PRE_STORY_PASSWORD_TEXT = "IRIS_PASSWORD environment variable is required. Set it to the password for the IRIS user.";

const BASE_ENV = {
  IRIS_HOST: "iris.example.com",
  IRIS_PORT: "52773",
  IRIS_USERNAME: "svc",
  IRIS_NAMESPACE: "APP",
  IRIS_CREDENTIAL_HELPER: "h",
};

/** `loadProfileRegistry(env)` of the baseline build on `BASE_ENV` + `IRIS_PASSWORD=pw` + `MEMBERS` (captured, see header). */
const BASELINE_REGISTRY = [
  [
    "default",
    {
      name: "default",
      host: "iris.example.com",
      port: 52773,
      username: "svc",
      password: "pw",
      namespace: "APP",
      https: false,
      baseUrl: "http://iris.example.com:52773",
      timeout: 60000,
      acceptLanguage: "en-US,en;q=0.9",
      source: "env",
    },
  ],
  [
    "member",
    {
      name: "member",
      host: "h1",
      port: 52773,
      username: "svc",
      password: "pw",
      namespace: "APP",
      https: false,
      baseUrl: "http://h1:52773",
      timeout: 60000,
      acceptLanguage: "en-US,en;q=0.9",
      source: "env",
    },
  ],
  [
    "other",
    {
      name: "other",
      host: "iris.example.com",
      port: 52773,
      username: "svc",
      password: "po",
      namespace: "APP",
      https: false,
      baseUrl: "http://iris.example.com:52773",
      timeout: 60000,
      acceptLanguage: "en-US,en;q=0.9",
      source: "env",
    },
  ],
];

const MEMBERS = JSON.stringify({ member: { host: "h1" }, other: { password: "po" } });

/** Keychain and helper that hold a (different) password for EVERY name that could be asked, and record every ask. */
function seams() {
  const names = ["default", "member", "other", "dev1", "svc"];
  const asked: string[] = [];
  const helped: Array<[string, string]> = [];
  return {
    asked,
    helped,
    deps: {
      getKeychainPassword: async (account: string): Promise<string | undefined> => {
        asked.push(account);
        return names.includes(account) ? `STORED-${account}` : undefined;
      },
      runCredentialHelper: async (command: string, account: string): Promise<string | undefined> => {
        helped.push([command, account]);
        return names.includes(account) ? `HELPED-${account}` : undefined;
      },
    },
  };
}

const OFF_VALUES: Array<[string, Record<string, string>]> = [
  ["unset", {}],
  ["empty", { IRIS_CREDENTIAL_NAME: "" }],
  ["spaces", { IRIS_CREDENTIAL_NAME: "   " }],
  ["tab and newline (whitespace only, so still off, not a control-character error)", { IRIS_CREDENTIAL_NAME: "\t\n" }],
];

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe("Rule #19 (a): a password-less IRIS_PROFILES member inherits default's password exactly as in 1.1.0", () => {
  it.each(OFF_VALUES)("%s: the registry equals the captured pre-story registry; no seam is called", async (_label, extra) => {
    const s = seams();
    const registry = await loadProfileRegistry(
      { ...BASE_ENV, IRIS_PASSWORD: "pw", IRIS_PROFILES: MEMBERS, ...extra },
      undefined,
      s.deps,
    );
    expect([...registry]).toEqual(BASELINE_REGISTRY);
    expect(registry.get("member")?.password).toBe("pw");
    expect(s.asked).toEqual([]);
    expect(s.helped).toEqual([]);
    expect(warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("IRIS_CREDENTIAL_NAME"))).toEqual([]);
  });

  it.each(OFF_VALUES)("%s: loadConfig still returns the default profile's pre-story password", (_label, extra) => {
    expect(loadConfig({ ...BASE_ENV, IRIS_PASSWORD: "pw", ...extra }).password).toBe("pw");
  });
});

describe("Rule #19 (b): default without a password fails with the verbatim pre-story text", () => {
  const withoutPassword: Array<[string, Record<string, string | undefined>]> = [
    ["IRIS_PASSWORD unset", {}],
    ["IRIS_PASSWORD empty", { IRIS_PASSWORD: "" }],
  ];

  describe.each(OFF_VALUES)("IRIS_CREDENTIAL_NAME %s", (_label, extra) => {
    it.each(withoutPassword)("%s, with a password-less member present: the literal error, no seam called", async (_l, pwd) => {
      const s = seams();
      const env = { ...BASE_ENV, IRIS_PROFILES: MEMBERS, ...pwd, ...extra };
      let thrown: unknown;
      try {
        await loadProfileRegistry(env, undefined, s.deps);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(PRE_STORY_PASSWORD_TEXT);
      expect(() => loadConfig(env)).toThrow(new Error(PRE_STORY_PASSWORD_TEXT));
      expect(s.asked).toEqual([]);
      expect(s.helped).toEqual([]);
    });

    it("a `default` override inside IRIS_PROFILES does not change that: same literal, no seam called", async () => {
      const s = seams();
      const env = {
        ...BASE_ENV,
        IRIS_PROFILES: JSON.stringify({ member: { host: "h1" }, default: { namespace: "X" } }),
        ...extra,
      };
      await expect(loadProfileRegistry(env, undefined, s.deps)).rejects.toThrow(new Error(PRE_STORY_PASSWORD_TEXT));
      expect(s.asked).toEqual([]);
      expect(s.helped).toEqual([]);
    });
  });
});
