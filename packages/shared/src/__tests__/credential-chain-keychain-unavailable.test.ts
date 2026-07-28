/**
 * Story 31.1, AC 31.1.1 — "when the native module fails to load, the chain
 * SKIPS this link with a debug log (never a crash; verified by a test that
 * mocks the import failure)".
 *
 * Isolated into its OWN file (vitest gives each test file its own module
 * registry) so mocking `@napi-rs/keyring` to fail here cannot affect any
 * other test's ability to exercise the real module (e.g. the live-subprocess
 * helper tests in `credential-chain.test.ts`, or a manual real-keychain
 * sanity check).
 *
 * `getKeychainPasswordDefault` (the production, non-injected implementation)
 * is only reachable when `resolveCredential` is called WITHOUT a
 * `getKeychainPassword` override, so every test below omits it deliberately.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@napi-rs/keyring", () => {
  throw new Error("simulated native-module load failure (e.g. no prebuilt binary for this platform)");
});

import { resolveCredential } from "../credential-chain.js";

describe("resolveCredential — OS keychain link, real (non-injected) implementation, @napi-rs/keyring import mocked to fail", () => {
  it("never throws — the chain degrades and continues to link 3", async () => {
    const result = await resolveCredential("someServer", {
      env: { IRIS_CREDENTIAL_HELPER: "fake-helper" },
      runCredentialHelper: async () => "helperpw",
      // getKeychainPassword deliberately OMITTED — exercises the real,
      // guarded-dynamic-import default implementation.
    });
    expect(result).toEqual({ password: "helperpw", source: "helper" });
  });

  // Code review 2026-07-25: the load-failure diagnostic is emitted only ONCE
  // per process (Node does not cache a failed module resolution, so the
  // guarded import re-runs — and previously re-logged — for every
  // password-less profile). This test therefore needs a FRESH module
  // registry, and must pull `logger` from that same fresh registry so the spy
  // lands on the instance `credential-chain.js` actually holds.
  it("logs the failure at debug level, ONCE per process (never warn/error — an unavailable optional native module is not itself actionable)", async () => {
    vi.resetModules();
    const { logger: freshLogger } = await import("../logger.js");
    const { resolveCredential: freshResolveCredential } = await import("../credential-chain.js");

    const debugSpy = vi.spyOn(freshLogger, "debug").mockImplementation(() => {});
    const warnSpy = vi.spyOn(freshLogger, "warn").mockImplementation(() => {});
    try {
      await freshResolveCredential("someServer", { env: {} });
      const debugText = debugSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(debugText).toContain("OS keychain link unavailable");
      expect(debugText).toContain("failed to load");
      const firstCallCount = debugSpy.mock.calls.filter((c) =>
        String(c[0]).includes("OS keychain link unavailable"),
      ).length;
      expect(firstCallCount).toBe(1);

      // A second profile in the same process must NOT repeat the identical
      // line (N password-less profiles previously produced N copies).
      await freshResolveCredential("anotherServer", { env: {} });
      const secondCallCount = debugSpy.mock.calls.filter((c) =>
        String(c[0]).includes("OS keychain link unavailable"),
      ).length;
      expect(secondCallCount).toBe(1);

      // Never escalated to warn — this is expected/degraded behavior, not an
      // operator-actionable problem on its own.
      const keychainWarnCalls = warnSpy.mock.calls.filter((c) =>
        String(c[0]).toLowerCase().includes("keychain"),
      );
      expect(keychainWarnCalls).toHaveLength(0);
    } finally {
      debugSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("resolves undefined (gracefully) when every other link is also exhausted — never crashes the caller", async () => {
    const result = await resolveCredential("someServer", { env: {} });
    expect(result).toBeUndefined();
  });
});
