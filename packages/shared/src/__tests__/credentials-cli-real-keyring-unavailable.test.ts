/**
 * Task 6 — "the CLI's keychain-unavailable handling is deliberately the
 * OPPOSITE of the chain's" — verified against the REAL (non-injected)
 * `loadRealKeyring()` production wiring, not the `KeyringUnavailableError`
 * thrown directly by an injected fake elsewhere in this suite.
 *
 * `@napi-rs/keyring` is mocked to fail its import (never the real OS
 * keychain — same pattern as `credential-chain-keychain-unavailable.test.ts`).
 * Isolated into its own file so this failure mock cannot affect any other
 * test's ability to exercise the real (or a working-fake) module.
 */

import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";

vi.mock("@napi-rs/keyring", () => {
  throw new Error("simulated native-module load failure (e.g. no prebuilt binary for this platform)");
});

import { runCli } from "../cli/credentials.js";

const silentOutput = { write: (): void => {} };

describe("credentials.ts default loadKeyring wiring — @napi-rs/keyring import mocked to fail", () => {
  it("`set` fails LOUDLY (non-zero exit) rather than silently skipping, unlike the credential chain's own keychain link", async () => {
    let stderrText = "";
    const code = await runCli(["set", "myserver", "--stdin"], {
      env: {},
      stdin: Readable.from(["pw\n"]),
      stdout: silentOutput,
      stderr: { write: (c: string) => { stderrText += c; } },
    });
    expect(code).toBe(1);
    expect(stderrText).toContain("OS keychain is unavailable");
    expect(stderrText).not.toContain("pw\n");
  });

  it("`list` fails loudly too", async () => {
    let stderrText = "";
    const code = await runCli(["list"], {
      env: {},
      stdout: silentOutput,
      stderr: { write: (c: string) => { stderrText += c; } },
    });
    expect(code).toBe(1);
    expect(stderrText).toContain("OS keychain is unavailable");
  });

  it("`delete` fails loudly too", async () => {
    let stderrText = "";
    const code = await runCli(["delete", "myserver"], {
      env: {},
      stdout: silentOutput,
      stderr: { write: (c: string) => { stderrText += c; } },
    });
    expect(code).toBe(1);
    expect(stderrText).toContain("OS keychain is unavailable");
  });

  it("`test` does NOT fail loudly the same way — it degrades to a sane exit 1 with chain remediation, because Task 4 requires it to drive the real chain's own silent-skip-on-missing-module behavior rather than reimplementing it", async () => {
    let stdoutText = "";
    let stderrText = "";
    const code = await runCli(["test", "myserver"], {
      env: {},
      stdout: { write: (c: string) => { stdoutText += c; } },
      stderr: { write: (c: string) => { stderrText += c; } },
      // `resolveCredentialFn` deliberately OMITTED — exercises the real,
      // non-injected `resolveCredential` from credential-chain.ts, whose
      // OWN OS-keychain link performs its own separate `@napi-rs/keyring`
      // import (unrelated to credentials.ts's `loadKeyring`/`KeyringPort`
      // seam under test elsewhere in this file) and silently skips the
      // link on an import failure rather than throwing.
    });

    // Not a crash, not a false-positive success: a real, actionable exit 1.
    expect(code).toBe(1);
    expect(stderrText).toContain("iris-mcp-credentials set myserver");
    expect(stderrText).toContain("IRIS_CREDENTIAL_HELPER");
    expect(stderrText).toContain("IRIS_PROFILES");
    // Distinct from set/list/delete's message — proving this genuinely
    // exercised the chain's own skip path, not credentials.ts's loud
    // KeyringUnavailableError.
    expect(stderrText).not.toContain("OS keychain is unavailable");
    expect(stdoutText).toBe("");
  });
});
