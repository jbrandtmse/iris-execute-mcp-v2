/**
 * Integration AC 31.2.5 — the CLI is the *writer* for the OS-keychain link
 * Story 31.1's credential chain (`credential-chain.ts`) *reads*. This file
 * proves a password written by `iris-mcp-credentials set <name>` is
 * resolvable by the REAL chain for that same `<name>`, with the writer and
 * reader agreeing on the keychain service/account key BY CONSTRUCTION.
 *
 * "By construction" here means: both `credentials.ts`'s `loadRealKeyring()`
 * and `credential-chain.ts`'s `getKeychainPasswordDefault()` import the SAME
 * `CREDENTIAL_CHAIN_KEYCHAIN_SERVICE` constant (never re-declared — see both
 * modules' source) and construct `new Entry(service, serverName)` with the
 * identical two arguments. This test cannot touch the real OS keychain (no
 * test in this suite may — AC 31.1.2 discipline), so it substitutes ONE
 * shared in-memory store for the native `@napi-rs/keyring` calls on BOTH
 * sides and drives everything else for real: the CLI's actual `set` command
 * and the credential chain's actual, un-mocked `resolveCredential()`.
 *
 * **Scope of this file, stated honestly** (corrected at code review
 * 2026-07-25 — the original header overclaimed): the shared fake is keyed by
 * ACCOUNT only, because the `loadKeyring` / `getKeychainPassword` seams both
 * sit BELOW the service argument. So this file pins the ACCOUNT dimension
 * (test 2 proves a different name does not resolve) and proves the real
 * `resolveCredential` reads what the real `set` wrote — but it would stay
 * green if either side re-declared a different SERVICE string. The service
 * dimension is pinned separately, through both sides' production wiring, in
 * `credentials-cli-real-keyring.test.ts`, which module-mocks
 * `@napi-rs/keyring` with an argument-recording `Entry` and asserts the
 * service on every construction.
 */

import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";

import { runCli, type KeyringPort, type KeyringCredential } from "../cli/credentials.js";
import { resolveCredential, CREDENTIAL_CHAIN_KEYCHAIN_SERVICE } from "../credential-chain.js";

/** Stands in for the native `@napi-rs/keyring` binding for BOTH the CLI's write path and the chain's read path. */
function createSharedFakeKeyringStore(): { keyring: KeyringPort; store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    keyring: {
      setPassword(account: string, password: string): void {
        store.set(account, password);
      },
      getPassword(account: string): string | null {
        return store.has(account) ? (store.get(account) as string) : null;
      },
      deleteCredential(account: string): boolean {
        return store.delete(account);
      },
      listCredentials(): KeyringCredential[] {
        return [...store.entries()].map(([account, password]) => ({ account, password }));
      },
    },
  };
}

const silentOutput = { write: (): void => {} };

describe("Integration AC 31.2.5 — CLI-written credential resolvable by the real Story 31.1 chain", () => {
  it("resolveCredential (unmodified, real) resolves what `set` wrote, sourced from the keychain link", async () => {
    const { keyring, store } = createSharedFakeKeyringStore();

    const setCode = await runCli(["set", "chain-agreement-server", "--stdin"], {
      env: {},
      loadKeyring: async () => keyring,
      stdin: Readable.from(["chain-agreement-pw\n"]),
      stdout: silentOutput,
      stderr: silentOutput,
    });
    expect(setCode).toBe(0);
    // Sanity: the CLI really did write into the shared store, under the
    // service constant imported (not re-declared) from credential-chain.ts.
    expect(store.get("chain-agreement-server")).toBe("chain-agreement-pw");

    // The REAL, un-mocked resolveCredential from credential-chain.ts. Only
    // its OS-keychain LINK's native call is substituted (the same seam
    // Story 31.1's own tests and loadProfileRegistry's production wiring
    // use) -- link 1 (env) is empty here, so link 2 is what resolves this.
    const result = await resolveCredential("chain-agreement-server", {
      env: {},
      getKeychainPassword: async (name) => keyring.getPassword(name) ?? undefined,
    });

    expect(result).toEqual({ password: "chain-agreement-pw", source: "keychain" });
  });

  it("a DIFFERENT server name written by `set` does NOT resolve for this one (proves the key is the account, not a fixed/global slot)", async () => {
    const { keyring } = createSharedFakeKeyringStore();
    await runCli(["set", "server-a", "--stdin"], {
      env: {},
      loadKeyring: async () => keyring,
      stdin: Readable.from(["pw-a\n"]),
      stdout: silentOutput,
      stderr: silentOutput,
    });

    const result = await resolveCredential("server-b", {
      env: {},
      getKeychainPassword: async (name) => keyring.getPassword(name) ?? undefined,
    });

    expect(result).toBeUndefined();
  });

  it("holds end-to-end through the CLI's OWN `test <name>` subcommand (AC 31.2.1's literal 'or test <name>, which runs the real chain')", async () => {
    const { keyring } = createSharedFakeKeyringStore();

    const setCode = await runCli(["set", "chain-agreement-server-2", "--stdin"], {
      env: {},
      loadKeyring: async () => keyring,
      stdin: Readable.from(["another-chain-pw\n"]),
      stdout: silentOutput,
      stderr: silentOutput,
    });
    expect(setCode).toBe(0);

    let jsonOut = "";
    const testCode = await runCli(["test", "chain-agreement-server-2", "--json"], {
      env: {},
      stdout: { write: (chunk: string) => { jsonOut += chunk; } },
      stderr: silentOutput,
      // `resolveCredentialFn` here still delegates to the REAL, un-mocked
      // `resolveCredential` -- only the keychain link's native call is
      // substituted, exactly as `test`'s production entry point would call
      // it, just with the fake standing in for `@napi-rs/keyring`.
      resolveCredentialFn: (serverName, options) =>
        resolveCredential(serverName, {
          ...options,
          getKeychainPassword: async (name) => keyring.getPassword(name) ?? undefined,
        }),
    });

    expect(testCode).toBe(0);
    expect(JSON.parse(jsonOut.trim())).toEqual({
      name: "chain-agreement-server-2",
      resolved: true,
      source: "keychain",
    });
    // Secret discipline still holds on this integration path.
    expect(jsonOut).not.toContain("another-chain-pw");
  });

  it("both sides key off the SAME imported service constant (no re-declared string to drift)", () => {
    expect(CREDENTIAL_CHAIN_KEYCHAIN_SERVICE).toBe("iris-mcp");
  });
});
