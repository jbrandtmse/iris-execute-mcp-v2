/**
 * Story 31.1, AC 31.1.1 link 3 — "enforce the 10s timeout; treat non-zero
 * exit as *skip this link*, not as a fatal error", extended to a helper
 * process that HANGS past the timeout.
 *
 * The dev's own tests pin `CREDENTIAL_HELPER_TIMEOUT_MS === 10_000` and cover
 * non-zero exit via a real subprocess, but explicitly do NOT drive a real
 * 10-second wait ("to keep the suite fast"). That leaves the actual
 * timeout/hang branch of `runCredentialHelperDefault` (the non-injected,
 * `spawnSync`-based default implementation) untested.
 *
 * Rather than guess the shape `spawnSync` returns on timeout, this was
 * verified empirically on this machine (Windows/Node), driving a REAL
 * `spawnSync` call with a 500ms timeout against a child that sleeps 5s:
 *
 *   status: null, signal: 'SIGTERM',
 *   error: Error('spawnSync ... ETIMEDOUT') { code: 'ETIMEDOUT', ... },
 *   stdout: '', stderr: ''
 *
 * `runCredentialHelperDefault` checks `result.error` BEFORE `result.signal`,
 * so the timeout must be recognized by its ERROR CODE, not by the signal
 * branch. Code review 2026-07-25 fixed exactly that: the original code
 * reported a genuine 10s hang through a generic `logger.debug("failed to
 * start")` — wrong severity and wrong description (it did start; it hung) —
 * while the `result.signal` branch that its own comment claimed handled
 * timeouts was unreachable, and the helper's stderr was discarded on that
 * path. A hung helper now WARNs, names the timeout, and still passes its
 * (scrubbed) stderr through. This file mocks `node:child_process` to return
 * the REAL observed shape, so the assertions describe what actually happens.
 *
 * Isolated into its own file (vitest gives each file its own module
 * registry) so mocking `spawnSync` here cannot affect the real-subprocess
 * tests in `credential-chain.test.ts` / the secret-leak-sweep file.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import { resolveCredential, resolveServerManagerCredentials } from "../credential-chain.js";
import type { ServerManagerProfileResult } from "../server-manager-source.js";
import { logger } from "../logger.js";

const spawnSyncMock = vi.mocked(spawnSync);

/** The REAL shape observed from a live `spawnSync` timeout (see file doc comment). */
function timedOutResult() {
  const error = new Error("spawnSync fake-helper ETIMEDOUT") as NodeJS.ErrnoException;
  error.code = "ETIMEDOUT";
  return {
    pid: 4242,
    output: [null, "", ""],
    stdout: "",
    stderr: "",
    status: null,
    signal: "SIGTERM" as NodeJS.Signals,
    error,
  };
}

function unresolvedEntry(name: string): ServerManagerProfileResult {
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
  };
}

describe("credential helper — real spawnSync timeout/hang shape (mocked node:child_process)", () => {
  it("resolveCredential never throws on a timed-out helper — resolves undefined (skip, not fatal)", async () => {
    spawnSyncMock.mockReturnValueOnce(
      timedOutResult() as unknown as ReturnType<typeof spawnSync>,
    );
    const result = await resolveCredential("someServer", {
      env: { IRIS_CREDENTIAL_HELPER: "fake-helper" },
      getKeychainPassword: async () => undefined,
      // runCredentialHelper deliberately OMITTED — exercises the real,
      // spawnSync-based default implementation against the mocked module.
    });
    expect(result).toBeUndefined();
  });

  it("a timed-out helper WARNs naming the 10s timeout (not a generic 'could not be run'), and never logs a password", async () => {
    spawnSyncMock.mockReturnValueOnce(
      timedOutResult() as unknown as ReturnType<typeof spawnSync>,
    );
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    try {
      await resolveCredential("someServer", {
        env: { IRIS_CREDENTIAL_HELPER: "fake-helper" },
        getKeychainPassword: async () => undefined,
      });
      const warnText = warnSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(warnText).toContain("did not finish within 10s");
      expect(warnText).toContain("someServer");
      expect(warnText).toContain("Skipping this link");
      // A hang is NOT a spawn failure — the misleading original wording must
      // not come back.
      expect(warnText).not.toContain("could not be run");
    } finally {
      debugSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("a timed-out helper still passes its (scrub-guarded) stderr through to the logs — the original code discarded it on this path", async () => {
    const timedOutWithStderr = {
      ...timedOutResult(),
      stderr: "vault: connection attempt 1 of 3 timed out",
    };
    spawnSyncMock.mockReturnValueOnce(
      timedOutWithStderr as unknown as ReturnType<typeof spawnSync>,
    );
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const debugSpy = vi.spyOn(logger, "debug").mockImplementation(() => {});
    try {
      await resolveCredential("someServer", {
        env: { IRIS_CREDENTIAL_HELPER: "fake-helper" },
        getKeychainPassword: async () => undefined,
      });
      const debugText = debugSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      // stdout was empty, so there is no candidate to scrub against and the
      // BODY is withheld — but the operator still learns stderr existed.
      expect(debugText).toContain("IRIS_CREDENTIAL_HELPER stderr");
      expect(debugText).toContain("withheld");
      expect(debugText).not.toContain("connection attempt 1 of 3");
    } finally {
      debugSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("a hung/timed-out helper flows safely into resolveServerManagerCredentials: the profile is excluded with the standard exhaustion remediation, auto mode does not throw", async () => {
    spawnSyncMock.mockReturnValueOnce(
      timedOutResult() as unknown as ReturnType<typeof spawnSync>,
    );
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const entries = [unresolvedEntry("hangingServer")];
      const result = await resolveServerManagerCredentials(entries, {
        env: { IRIS_CREDENTIAL_HELPER: "fake-helper" },
        mode: "auto",
        getKeychainPassword: async () => undefined,
      });
      expect(result).toEqual([]);
      // Filter on the exhaustion message specifically: the timeout itself now
      // also warns (naming the same server), so a bare name filter would
      // match two distinct, both-correct lines.
      const exhaustionCalls = warnSpy.mock.calls.filter(
        (c) => String(c[0]).includes("hangingServer") && String(c[0]).includes("was exhausted"),
      );
      expect(exhaustionCalls).toHaveLength(1);
      expect(String(exhaustionCalls[0]?.[0])).toContain("iris-mcp-credentials set hangingServer");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("under required mode, a hung/timed-out helper escalates to a thrown Error naming the profile (never crashes with an unhandled exception type)", async () => {
    spawnSyncMock.mockReturnValueOnce(
      timedOutResult() as unknown as ReturnType<typeof spawnSync>,
    );
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const entries = [unresolvedEntry("hangingServer")];
      let caught: unknown;
      try {
        await resolveServerManagerCredentials(entries, {
          env: { IRIS_CREDENTIAL_HELPER: "fake-helper" },
          mode: "required",
          getKeychainPassword: async () => undefined,
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain("hangingServer");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
