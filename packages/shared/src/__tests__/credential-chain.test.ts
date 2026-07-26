/**
 * Story 31.1 — Credential chain (`credential-chain.ts`).
 *
 * Covers: link order / first-hit-wins / skip-on-error per link (AC 31.1.1,
 * 31.1.2 — every test here uses INJECTED fake keychain/helper deps; no test
 * touches a real keychain), the exhaustion/remediation message (link 4), the
 * `required`-mode escalation (Task 4 — distinct from
 * `resolveServerManagerProfiles`'s own zero-definitions check), secret
 * scrubbing of helper stderr (Task 7), and argv-injection safety for the
 * server name passed to the credential helper.
 *
 * The native-module-import-failure path (AC 31.1.1: "verified by a test that
 * mocks the import failure") lives in its own file,
 * `credential-chain-keychain-unavailable.test.ts`, so mocking `@napi-rs/keyring`
 * for that one scenario cannot affect module resolution in any other test
 * here (vitest gives each test FILE its own module registry).
 */

import { describe, it, expect, vi } from "vitest";

import {
  CREDENTIAL_HELPER_TIMEOUT_MS,
  resolveCredential,
  resolveServerManagerCredentials,
} from "../credential-chain.js";
import type { ServerManagerProfileResult } from "../server-manager-source.js";
import { logger } from "../logger.js";

/** A minimal unresolved ServerManagerProfileResult fixture. */
function unresolvedEntry(name: string, overrides: Partial<ServerManagerProfileResult> = {}): ServerManagerProfileResult {
  return {
    name,
    host: `${name}.example.com`,
    port: 52773,
    username: "u",
    password: "",
    namespace: "USER",
    https: false,
    baseUrl: `http://${name}.example.com:52773`,
    timeout: 30000,
    credentialStatus: "unresolved",
    ...overrides,
  };
}

/** A minimal already-resolved ServerManagerProfileResult fixture. */
function resolvedEntry(name: string, password: string): ServerManagerProfileResult {
  return {
    ...unresolvedEntry(name),
    password,
    credentialStatus: "resolved",
  };
}

// ════════════════════════════════════════════════════════════════════
// resolveCredential — link order, first-hit-wins, skip-on-error (AC 31.1.1/2)
// ════════════════════════════════════════════════════════════════════

describe("resolveCredential", () => {
  it("link 1 (IRIS_PASSWORD for the reserved 'default' name) wins without touching keychain/helper", async () => {
    const getKeychainPassword = vi.fn(async () => "shouldNeverBeCalled");
    const runCredentialHelper = vi.fn(async () => "shouldNeverBeCalled");
    const result = await resolveCredential("default", {
      env: { IRIS_PASSWORD: "envpw" },
      getKeychainPassword,
      runCredentialHelper,
    });
    expect(result).toEqual({ password: "envpw", source: "env" });
    expect(getKeychainPassword).not.toHaveBeenCalled();
    expect(runCredentialHelper).not.toHaveBeenCalled();
  });

  it("link 1 (IRIS_PROFILES.<name>.password) wins for a named profile", async () => {
    const getKeychainPassword = vi.fn(async () => "shouldNeverBeCalled");
    const result = await resolveCredential("prod", {
      env: { IRIS_PROFILES: JSON.stringify({ prod: { password: "profilespw" } }) },
      getKeychainPassword,
    });
    expect(result).toEqual({ password: "profilespw", source: "env" });
    expect(getKeychainPassword).not.toHaveBeenCalled();
  });

  it("link 1 ignores IRIS_PROFILES.<name>.password for a DIFFERENT name", async () => {
    const getKeychainPassword = vi.fn(async () => "keychainpw");
    const result = await resolveCredential("staging", {
      env: { IRIS_PROFILES: JSON.stringify({ prod: { password: "profilespw" } }) },
      getKeychainPassword,
    });
    expect(result).toEqual({ password: "keychainpw", source: "keychain" });
  });

  it("a whitespace-only IRIS_PASSWORD is treated as absent (falls through to link 2)", async () => {
    const result = await resolveCredential("default", {
      env: { IRIS_PASSWORD: "   " },
      getKeychainPassword: async () => "keychainpw",
    });
    expect(result).toEqual({ password: "keychainpw", source: "keychain" });
  });

  it("malformed IRIS_PROFILES is tolerated defensively (link 1 just yields nothing, chain continues)", async () => {
    const result = await resolveCredential("prod", {
      env: { IRIS_PROFILES: "{not valid json" },
      getKeychainPassword: async () => "keychainpw",
    });
    expect(result).toEqual({ password: "keychainpw", source: "keychain" });
  });

  it("link 2 (keychain) wins when link 1 is empty", async () => {
    const runCredentialHelper = vi.fn(async () => "shouldNeverBeCalled");
    const result = await resolveCredential("someServer", {
      env: {},
      getKeychainPassword: async (name) => (name === "someServer" ? "keychainpw" : undefined),
      runCredentialHelper,
    });
    expect(result).toEqual({ password: "keychainpw", source: "keychain" });
    expect(runCredentialHelper).not.toHaveBeenCalled();
  });

  it("skip-on-error: a keychain link that THROWS never aborts the chain — advances to link 3", async () => {
    const result = await resolveCredential("someServer", {
      env: { IRIS_CREDENTIAL_HELPER: "fake-helper" },
      getKeychainPassword: async () => {
        throw new Error("simulated keychain failure");
      },
      runCredentialHelper: async () => "helperpw",
    });
    expect(result).toEqual({ password: "helperpw", source: "helper" });
  });

  it("a keychain result of undefined/whitespace-only is treated as 'not found' (falls through)", async () => {
    const result = await resolveCredential("someServer", {
      env: { IRIS_CREDENTIAL_HELPER: "fake-helper" },
      getKeychainPassword: async () => "   ",
      runCredentialHelper: async () => "helperpw",
    });
    expect(result).toEqual({ password: "helperpw", source: "helper" });
  });

  it("link 3 (credential helper) is invoked with (rawCommand, serverName) and its result wins", async () => {
    const runCredentialHelper = vi.fn(async () => "helperpw");
    const result = await resolveCredential("someServer", {
      env: { IRIS_CREDENTIAL_HELPER: "op read op://vault/item" },
      getKeychainPassword: async () => undefined,
      runCredentialHelper,
    });
    expect(result).toEqual({ password: "helperpw", source: "helper" });
    expect(runCredentialHelper).toHaveBeenCalledWith("op read op://vault/item", "someServer");
  });

  it("link 3 is never attempted when IRIS_CREDENTIAL_HELPER is unset — even an injected fake is not called", async () => {
    const runCredentialHelper = vi.fn(async () => "shouldNeverBeCalled");
    const result = await resolveCredential("someServer", {
      env: {},
      getKeychainPassword: async () => undefined,
      runCredentialHelper,
    });
    expect(result).toBeUndefined();
    expect(runCredentialHelper).not.toHaveBeenCalled();
  });

  it("skip-on-error: a credential-helper link that THROWS never aborts the chain — exhausts gracefully (never throws)", async () => {
    const result = await resolveCredential("someServer", {
      env: { IRIS_CREDENTIAL_HELPER: "fake-helper" },
      getKeychainPassword: async () => undefined,
      runCredentialHelper: async () => {
        throw new Error("simulated helper failure");
      },
    });
    expect(result).toBeUndefined();
  });

  it("all links exhausted ⇒ undefined (never throws)", async () => {
    const result = await resolveCredential("someServer", {
      env: {},
      getKeychainPassword: async () => undefined,
    });
    expect(result).toBeUndefined();
  });

  // ── Code review 2026-07-25: the "NEVER throws" contract vs. a seam that
  // returns a non-string. `CredentialChainOptions` is public API and
  // `@napi-rs/keyring`'s own `getPassword()` is typed `string | null`, so a
  // straight passthrough is the most natural consumer wiring. The `.trim()`
  // guards used to sit OUTSIDE the try/catch, so such a value threw a
  // TypeError that escaped resolveCredential → resolveServerManagerCredentials
  // → loadProfileRegistry → McpServerBase.start(), failing server startup.
  it.each([
    ["null", null],
    ["a number", 12345],
    ["a Buffer", Buffer.from("pw")],
    ["an object", { password: "pw" }],
  ])("a keychain seam returning %s never throws — the link is skipped", async (_label, value) => {
    const result = await resolveCredential("someServer", {
      env: { IRIS_CREDENTIAL_HELPER: "fake-helper" },
      getKeychainPassword: async () => value as unknown as string | undefined,
      runCredentialHelper: async () => "helperpw",
    });
    expect(result).toEqual({ password: "helperpw", source: "helper" });
  });

  it("a credential-helper seam returning null never throws — the chain exhausts gracefully", async () => {
    const result = await resolveCredential("someServer", {
      env: { IRIS_CREDENTIAL_HELPER: "fake-helper" },
      getKeychainPassword: async () => undefined,
      runCredentialHelper: async () => null as unknown as string | undefined,
    });
    expect(result).toBeUndefined();
  });

  // ── Code review 2026-07-25: link 1's precedence for the reserved `default`
  // name must match buildProfileRegistry's, which lets an IRIS_PROFILES
  // "default" entry override the IRIS_*-derived one. Reading only
  // IRIS_PASSWORD inverted that, so Story 31.2's `iris-mcp-credentials test
  // default` would have reported a credential the server does not use.
  it("link 1: IRIS_PROFILES.default.password beats IRIS_PASSWORD for the reserved default name (matches buildProfileRegistry)", async () => {
    const result = await resolveCredential("default", {
      env: {
        IRIS_PASSWORD: "envpw",
        IRIS_PROFILES: JSON.stringify({ default: { password: "profilespw" } }),
      },
      getKeychainPassword: async () => "shouldNeverBeCalled",
    });
    expect(result).toEqual({ password: "profilespw", source: "env" });
  });

  it("link 1: IRIS_PASSWORD is still used for `default` when IRIS_PROFILES has no default entry", async () => {
    const result = await resolveCredential("default", {
      env: { IRIS_PASSWORD: "envpw", IRIS_PROFILES: JSON.stringify({ other: { password: "x" } }) },
      getKeychainPassword: async () => "shouldNeverBeCalled",
    });
    expect(result).toEqual({ password: "envpw", source: "env" });
  });
});

// ════════════════════════════════════════════════════════════════════
// resolveServerManagerCredentials — link 4 (exhaustion) + required escalation
// ════════════════════════════════════════════════════════════════════

describe("resolveServerManagerCredentials", () => {
  it("already-resolved entries pass through unchanged, WITHOUT invoking the chain", async () => {
    const getKeychainPassword = vi.fn(async () => "shouldNeverBeCalled");
    const entries = [resolvedEntry("prod", "legacypw")];
    const result = await resolveServerManagerCredentials(entries, {
      env: {},
      mode: "auto",
      getKeychainPassword,
    });
    expect(result).toEqual([
      {
        name: "prod",
        host: "prod.example.com",
        port: 52773,
        username: "u",
        password: "legacypw",
        namespace: "USER",
        https: false,
        baseUrl: "http://prod.example.com:52773",
        timeout: 30000,
      },
    ]);
    expect(getKeychainPassword).not.toHaveBeenCalled();
  });

  it("an unresolved entry completed via the chain lands in the result WITHOUT a credentialStatus field", async () => {
    const entries = [unresolvedEntry("someServer")];
    const result = await resolveServerManagerCredentials(entries, {
      env: {},
      mode: "auto",
      getKeychainPassword: async () => "chainpw",
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.password).toBe("chainpw");
    expect(Object.prototype.hasOwnProperty.call(result[0] as object, "credentialStatus")).toBe(
      false,
    );
  });

  it("auto: a chain-exhausted entry is EXCLUDED, with a warn naming ALL THREE remediations verbatim (AC 31.1.1 link 4)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const entries = [unresolvedEntry("noPassword")];
      const result = await resolveServerManagerCredentials(entries, {
        env: {},
        mode: "auto",
        getKeychainPassword: async () => undefined,
      });
      expect(result).toEqual([]);
      const exhaustionCalls = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes("noPassword"),
      );
      expect(exhaustionCalls).toHaveLength(1);
      const message = String(exhaustionCalls[0]?.[0]);
      expect(message).toContain("iris-mcp-credentials set noPassword");
      expect(message).toContain("IRIS_CREDENTIAL_HELPER");
      expect(message).toContain("IRIS_PROFILES");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("required: does NOT throw when every entry resolves", async () => {
    const entries = [unresolvedEntry("a"), resolvedEntry("b", "pw")];
    await expect(
      resolveServerManagerCredentials(entries, {
        env: {},
        mode: "required",
        getKeychainPassword: async () => "chainpw",
      }),
    ).resolves.toHaveLength(2);
  });

  it("required: throws naming EVERY exhausted profile (never short-circuits on the first failure)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const entries = [unresolvedEntry("a"), unresolvedEntry("b"), resolvedEntry("c", "pw")];
      let caught: unknown;
      try {
        await resolveServerManagerCredentials(entries, {
          env: {},
          mode: "required",
          getKeychainPassword: async () => undefined,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      expect(message).toContain("IRIS_SERVER_MANAGER=required");
      // Code review 2026-07-25: `toContain("a")` / `toContain("b")` matched
      // ordinary prose elsewhere in the sentence ("...resolve a password...",
      // "...but the..."), so both passed even with the name list emptied —
      // the one assertion proving the aggregate-not-short-circuit behavior
      // proved nothing. Assert the rendered list itself.
      // The rendered list is exactly the two exhausted names — which also
      // proves the RESOLVED entry "c" is not named. (A bare
      // `not.toContain("c")` would be the same vacuous-substring trap: "c"
      // occurs in "credentials", "chain", …)
      expect(message).toContain("for: a, b.");
      expect(message).not.toContain("zero server definitions were found"); // the OTHER required check
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("auto: an exhausted entry does not throw — startup continues with the remaining profiles", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const entries = [unresolvedEntry("bad"), resolvedEntry("good", "pw")];
      const result = await resolveServerManagerCredentials(entries, {
        env: {},
        mode: "auto",
        getKeychainPassword: async () => undefined,
      });
      expect(result.map((p) => p.name)).toEqual(["good"]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// Secret safety — the exhaustion/remediation message never contains the
// profile's (never-resolved) password; helper-stderr scrubbing (Task 7) is
// proven below with a REAL subprocess, since only a REAL resolved password
// makes that scenario meaningful (a synthetic thrown-error message cannot
// stand in for one — an error a broken lookup throws never carries a
// password it never successfully retrieved).
// ════════════════════════════════════════════════════════════════════

describe("secret safety — exhaustion message", () => {
  it("the chain-exhausted remediation warning never echoes any credential-shaped value from the entry", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      // The entry's OWN (unresolved) password is "" by construction — there is
      // nothing to leak — but this documents the invariant the exhaustion path
      // relies on: the remediation message is built ONLY from the profile name
      // and static remediation text, never from any resolved/attempted value.
      const entries = [unresolvedEntry("srv")];
      await resolveServerManagerCredentials(entries, {
        env: {},
        mode: "auto",
        getKeychainPassword: async () => undefined,
        runCredentialHelper: async () => undefined,
      });
      const message = String(
        warnSpy.mock.calls.find((c) => String(c[0]).includes("srv"))?.[0],
      );
      expect(message).toContain("iris-mcp-credentials set srv");
      expect(message).toContain("IRIS_CREDENTIAL_HELPER");
      expect(message).toContain("IRIS_PROFILES");
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// Real subprocess helper integration (no real keychain — that link is faked)
// ════════════════════════════════════════════════════════════════════

describe("resolveCredential — real IRIS_CREDENTIAL_HELPER subprocess (default runCredentialHelper implementation)", () => {
  it("resolves the password from a real child process's trimmed stdout", async () => {
    const helperCommand = `"${process.execPath}" -e "process.stdout.write('  realpw  ')"`;
    const result = await resolveCredential("srv", {
      env: { IRIS_CREDENTIAL_HELPER: helperCommand },
      getKeychainPassword: async () => undefined,
    });
    expect(result).toEqual({ password: "realpw", source: "helper" });
  });

  it("a non-zero exit skips the link (never throws) even though stdout carried text", async () => {
    const helperCommand = `"${process.execPath}" -e "process.stdout.write('ignoredpw'); process.exit(1)"`;
    const result = await resolveCredential("srv", {
      env: { IRIS_CREDENTIAL_HELPER: helperCommand },
      getKeychainPassword: async () => undefined,
    });
    expect(result).toBeUndefined();
  });

  it("the server name is passed as a literal final argv entry — shell metacharacters are NEVER interpreted (no injection)", async () => {
    // The script echoes back its own last argv entry (the appended server
    // name) so we can assert the child process received it byte-for-byte,
    // proving no shell parsed/expanded it.
    const helperCommand = `"${process.execPath}" -e "process.stdout.write(process.argv[process.argv.length - 1])"`;
    const maliciousName = "evil; rm -rf / #$(whoami)`id`";
    const result = await resolveCredential(maliciousName, {
      env: { IRIS_CREDENTIAL_HELPER: helperCommand },
      getKeychainPassword: async () => undefined,
    });
    expect(result).toEqual({ password: maliciousName, source: "helper" });
  });

  it("stderr is scrubbed for the resolved secret before being logged (a naive helper echoing the password to stderr never leaks it)", async () => {
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    try {
      const helperCommand =
        `"${process.execPath}" -e "process.stderr.write('leaked: supersecretvalue'); ` +
        `process.stdout.write('supersecretvalue')"`;
      const result = await resolveCredential("srv", {
        env: { IRIS_CREDENTIAL_HELPER: helperCommand },
        getKeychainPassword: async () => undefined,
      });
      expect(result).toEqual({ password: "supersecretvalue", source: "helper" });

      const allDebugText = debugSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(allDebugText).not.toContain("supersecretvalue");
      expect(allDebugText).toContain("[REDACTED]");
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("CREDENTIAL_HELPER_TIMEOUT_MS is 10 seconds (AC 31.1.1) — pinned as a regression guard; a live 10s timeout is not exercised here to keep the suite fast", () => {
    expect(CREDENTIAL_HELPER_TIMEOUT_MS).toBe(10_000);
  });
});
