/**
 * Story 31.1 — QA secret-leak sweep across the credential chain.
 *
 * This story handles LIVE PASSWORDS end-to-end (env, OS keychain, credential
 * helper, exhaustion), so secret-leak coverage is the top QA priority. The
 * dev's own `credential-chain.test.ts` already proves the exhaustion-message
 * invariant (an unresolved entry has no password to leak by construction)
 * and a single stderr-scrubbing case. This file extends that with the
 * scenarios most likely to catch a REAL leak:
 *
 * - The helper's stderr pass-through with MULTILINE output (secret on a
 *   non-first line) and a REPEATED secret (multiple occurrences on the same
 *   line) — `scrubSecret` operates on the whole captured string via
 *   `split(secret).join("[REDACTED]")`, so every occurrence must be caught,
 *   not just the first.
 * - The rule-#9 minimum-length gate: a secret shorter than 4 chars is
 *   WITHHELD ENTIRELY (never partially redacted, since substring-replacing a
 *   1-2 char secret would corrupt unrelated text) — this branch had no test
 *   exercising it through the real helper flow.
 * - A successful env-link and keychain-link resolution never logs the
 *   resolved password anywhere (sweeping ALL four logger methods, not just
 *   the one the dev's tests happened to spy on).
 * - Cross-profile isolation: when `resolveServerManagerCredentials` handles
 *   a MIX of a chain-resolved profile (carrying a real secret) and an
 *   exhausted profile in the same call, the `required`-mode thrown Error
 *   must never leak the resolved profile's password — the exhaustion
 *   message is built purely from names, but this is asserted directly
 *   rather than inferred from reading the source.
 */

import { describe, it, expect, vi } from "vitest";

import {
  resolveCredential,
  resolveServerManagerCredentials,
} from "../credential-chain.js";
import type { ServerManagerProfileResult } from "../server-manager-source.js";
import { logger } from "../logger.js";

function unresolvedEntry(
  name: string,
  overrides: Partial<ServerManagerProfileResult> = {},
): ServerManagerProfileResult {
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

/** Spy on every logger method at once; returns the combined text of every call. */
function spyAllLoggerText(): { text(): string; restore(): void } {
  const spies = [
    vi.spyOn(logger, "error").mockImplementation(() => {}),
    vi.spyOn(logger, "warn").mockImplementation(() => {}),
    vi.spyOn(logger, "info").mockImplementation(() => {}),
    vi.spyOn(logger, "debug").mockImplementation(() => {}),
  ];
  return {
    text: () =>
      spies
        .flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" ")))
        .join("\n"),
    restore: () => {
      for (const s of spies) s.mockRestore();
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// Helper stderr scrubbing — multiline / repeated occurrence / short-secret
// withholding, driven through a REAL child process (only a real resolved
// secret makes "does the scrub actually work" a meaningful assertion).
// ════════════════════════════════════════════════════════════════════

describe("secret-leak sweep — helper stderr scrubbing edge cases", () => {
  it("a secret appearing on a NON-FIRST line of multiline stderr is redacted; surrounding diagnostic lines survive", async () => {
    const secret = "MULTILINESECRET123";
    const helperCommand =
      `"${process.execPath}" -e "process.stderr.write('diag start\\nserver said: ${secret} was used\\ndiag end'); ` +
      `process.stdout.write('${secret}')"`;
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    try {
      const result = await resolveCredential("srv", {
        env: { IRIS_CREDENTIAL_HELPER: helperCommand },
        getKeychainPassword: async () => undefined,
      });
      expect(result).toEqual({ password: secret, source: "helper" });

      const allDebugText = debugSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(allDebugText).not.toContain(secret);
      expect(allDebugText).toContain("[REDACTED]");
      // Non-secret diagnostic content is preserved — proves this is a
      // targeted substring redaction, not the "withhold everything" branch.
      expect(allDebugText).toContain("diag start");
      expect(allDebugText).toContain("diag end");
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("a secret appearing MULTIPLE times in stderr is redacted at every occurrence", async () => {
    const secret = "REPEATEDSECRETXYZ";
    const helperCommand =
      `"${process.execPath}" -e "process.stderr.write('first: ${secret} second: ${secret} third: ${secret}'); ` +
      `process.stdout.write('${secret}')"`;
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    try {
      const result = await resolveCredential("srv", {
        env: { IRIS_CREDENTIAL_HELPER: helperCommand },
        getKeychainPassword: async () => undefined,
      });
      expect(result).toEqual({ password: secret, source: "helper" });

      const allDebugText = debugSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(allDebugText).not.toContain(secret);
      const redactedCount = allDebugText.split("[REDACTED]").length - 1;
      expect(redactedCount).toBeGreaterThanOrEqual(3);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("a secret SHORTER than 4 chars is withheld ENTIRELY from the logged stderr, not partially redacted (Rule #9 minimum-length gate)", async () => {
    const secret = "ab"; // 2 chars, below the 4-char redaction threshold
    const helperCommand =
      `"${process.execPath}" -e "process.stderr.write('leaked short secret marker: ${secret} end'); ` +
      `process.stdout.write('${secret}')"`;
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    try {
      const result = await resolveCredential("srv", {
        env: { IRIS_CREDENTIAL_HELPER: helperCommand },
        getKeychainPassword: async () => undefined,
      });
      expect(result).toEqual({ password: secret, source: "helper" });

      const allDebugText = debugSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      // The whole stderr text is withheld — a naive substring-replace on a
      // 2-char secret would corrupt/miss surrounding text, so the code
      // instead drops the entire captured stderr for this log line.
      expect(allDebugText).not.toContain("leaked short secret marker");
      expect(allDebugText).toContain("[withheld: may contain the resolved credential]");
    } finally {
      debugSpy.mockRestore();
    }
  });

  // ── Code review 2026-07-25 (HIGH-adjacent leak) ─────────────────────
  //
  // Two paths through the stderr pass-through leaked the credential in
  // cleartext, both reachable with the README's own documented helper
  // shapes. `logger` defaults to DEBUG, so these lines are emitted in
  // normal operation.

  it("MULTI-LINE stdout: the secret is redacted from stderr even though the whole trimmed blob (not just line 1) is the password", async () => {
    // `pass show iris/prod` — the standard password-store layout — prints the
    // password on line 1 followed by metadata. The scrub key used to be the
    // whole multi-line blob, which never matches the bare password as it
    // appears in stderr, so the real credential was logged verbatim.
    const secret = "s3cr3tPassw0rdXYZ";
    const helperCommand =
      `"${process.execPath}" -e "process.stdout.write('${secret}\\nusername: svc\\nurl: https://x'); ` +
      `process.stderr.write('op: returning ${secret} to caller')"`;
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    try {
      const result = await resolveCredential("srv", {
        env: { IRIS_CREDENTIAL_HELPER: helperCommand },
        getKeychainPassword: async () => undefined,
      });
      // Password semantics are unchanged (AC 31.1.1: "trimmed stdout is the
      // password") — only the SCRUBBING was widened.
      expect(result?.password).toContain(secret);

      const allDebugText = debugSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(allDebugText).not.toContain(secret);
      expect(allDebugText).toContain("[REDACTED]");
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("NO stdout: stderr is WITHHELD rather than logged raw — a helper that prints a token and then fails cannot leak it", async () => {
    // Nothing on stdout means there is no candidate to redact against, so
    // the body cannot be shown to be secret-free. It used to be logged
    // verbatim (`scrubSecret` returned the text unchanged for an empty key).
    const helperCommand =
      `"${process.execPath}" -e "process.stderr.write('boom: could not reach vault ` +
      `(token sk-abcdef123456)'); process.exit(3)"`;
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const result = await resolveCredential("srv", {
        env: { IRIS_CREDENTIAL_HELPER: helperCommand },
        getKeychainPassword: async () => undefined,
      });
      expect(result).toBeUndefined();

      const allText = [...debugSpy.mock.calls, ...warnSpy.mock.calls]
        .map((c) => c.map(String).join(" "))
        .join("\n");
      expect(allText).not.toContain("sk-abcdef123456");
      expect(allText).not.toContain("could not reach vault");
      // The operator still learns stderr existed and how to see it.
      expect(allText).toContain("withheld");
      expect(allText).toContain("Run the IRIS_CREDENTIAL_HELPER command manually");
    } finally {
      debugSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// Successful env/keychain resolution never logs the resolved password,
// across ALL FOUR logger severities (not just the one method a given test
// happens to spy on).
// ════════════════════════════════════════════════════════════════════

describe("secret-leak sweep — successful resolution never logs the password (any severity)", () => {
  it("env link (IRIS_PASSWORD for 'default')", async () => {
    const secret = "ENVLINKSECRET_qzx9";
    const spy = spyAllLoggerText();
    try {
      const result = await resolveCredential("default", {
        env: { IRIS_PASSWORD: secret },
        getKeychainPassword: async () => "shouldNeverBeCalled",
      });
      expect(result).toEqual({ password: secret, source: "env" });
      expect(spy.text()).not.toContain(secret);
    } finally {
      spy.restore();
    }
  });

  it("env link (IRIS_PROFILES.<name>.password)", async () => {
    const secret = "PROFILESLINKSECRET_qzx9";
    const spy = spyAllLoggerText();
    try {
      const result = await resolveCredential("prod", {
        env: { IRIS_PROFILES: JSON.stringify({ prod: { password: secret } }) },
      });
      expect(result).toEqual({ password: secret, source: "env" });
      expect(spy.text()).not.toContain(secret);
    } finally {
      spy.restore();
    }
  });

  it("keychain link", async () => {
    const secret = "KEYCHAINLINKSECRET_qzx9";
    const spy = spyAllLoggerText();
    try {
      const result = await resolveCredential("someServer", {
        env: {},
        getKeychainPassword: async () => secret,
      });
      expect(result).toEqual({ password: secret, source: "keychain" });
      expect(spy.text()).not.toContain(secret);
    } finally {
      spy.restore();
    }
  });

  it("helper link (fake injected runner, not a real subprocess)", async () => {
    const secret = "HELPERLINKSECRET_qzx9";
    const spy = spyAllLoggerText();
    try {
      const result = await resolveCredential("someServer", {
        env: { IRIS_CREDENTIAL_HELPER: "fake-helper" },
        getKeychainPassword: async () => undefined,
        runCredentialHelper: async () => secret,
      });
      expect(result).toEqual({ password: secret, source: "helper" });
      expect(spy.text()).not.toContain(secret);
    } finally {
      spy.restore();
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// Cross-profile isolation in resolveServerManagerCredentials: a resolved
// profile's real secret must never leak into the required-mode thrown
// error (or any log) triggered by a DIFFERENT, exhausted profile in the
// same call.
// ════════════════════════════════════════════════════════════════════

describe("secret-leak sweep — cross-profile isolation under required-mode escalation", () => {
  it("a chain-resolved profile's password never appears in the thrown error naming a DIFFERENT exhausted profile", async () => {
    const secret = "CROSSPROFILESECRET_qzx9";
    const spy = spyAllLoggerText();
    try {
      const entries = [
        unresolvedEntry("goodProfile"),
        unresolvedEntry("badProfile"),
      ];
      let caught: unknown;
      try {
        await resolveServerManagerCredentials(entries, {
          env: {},
          mode: "required",
          getKeychainPassword: async (name) =>
            name === "goodProfile" ? secret : undefined,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      expect(message).toContain("badProfile");
      expect(message).not.toContain("goodProfile");
      expect(message).not.toContain(secret);
      // Also sweep every log emitted during the call (warn for the
      // exhaustion, debug for any link chatter).
      expect(spy.text()).not.toContain(secret);
    } finally {
      spy.restore();
    }
  });

  it("an already-'resolved' (legacy-password) profile's password never appears in the thrown error for a co-exhausted profile", async () => {
    const secret = "LEGACYPWSECRET_qzx9";
    const spy = spyAllLoggerText();
    try {
      const entries: ServerManagerProfileResult[] = [
        { ...unresolvedEntry("legacyProfile"), password: secret, credentialStatus: "resolved" },
        unresolvedEntry("badProfile"),
      ];
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
      expect((caught as Error).message).not.toContain(secret);
      expect(spy.text()).not.toContain(secret);
    } finally {
      spy.restore();
    }
  });
});
