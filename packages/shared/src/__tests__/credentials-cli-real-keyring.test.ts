/**
 * Verifies `credentials.ts`'s PRODUCTION `loadRealKeyring()` wiring — the
 * code path every earlier CLI test bypasses by injecting `loadKeyring`
 * directly. `@napi-rs/keyring` is mocked (never the real OS keychain — same
 * discipline as `credential-chain-keychain-unavailable.test.ts`) with a
 * working in-memory fake `Entry`/`findCredentials` implementation that
 * RECORDS the `(service, account)` arguments it was constructed with, so
 * this test can assert the CLI's own default keyring wiring really does
 * pass `CREDENTIAL_CHAIN_KEYCHAIN_SERVICE` (imported, never re-declared) —
 * the concrete claim the module doc comment and Dev Notes make.
 *
 * Isolated into its own file (vitest gives each test file its own module
 * registry) so mocking `@napi-rs/keyring` here cannot affect any other
 * test's ability to exercise the real module.
 */

import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";

interface FakeCredential {
  account: string;
  password: string;
}

const entryConstructions: Array<[string, string]> = [];
const fakeStore = new Map<string, string>();

function storeKey(service: string, account: string): string {
  return `${service}\u0000${account}`;
}

vi.mock("@napi-rs/keyring", () => {
  class Entry {
    private readonly service: string;
    private readonly account: string;
    constructor(service: string, account: string) {
      this.service = service;
      this.account = account;
      entryConstructions.push([service, account]);
    }
    setPassword(password: string): void {
      fakeStore.set(storeKey(this.service, this.account), password);
    }
    getPassword(): string | null {
      const k = storeKey(this.service, this.account);
      return fakeStore.has(k) ? (fakeStore.get(k) as string) : null;
    }
    deleteCredential(): boolean {
      return fakeStore.delete(storeKey(this.service, this.account));
    }
  }
  function findCredentials(service: string): FakeCredential[] {
    const prefix = `${service}\u0000`;
    return [...fakeStore.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, password]) => ({ account: k.slice(prefix.length), password }));
  }
  return { Entry, findCredentials };
});

import { runCli } from "../cli/credentials.js";
import { resolveCredential, CREDENTIAL_CHAIN_KEYCHAIN_SERVICE } from "../credential-chain.js";

const silentOutput = { write: (): void => {} };

describe("credentials.ts default loadKeyring wiring (real @napi-rs/keyring import, module mocked)", () => {
  it("set/list/delete all key off CREDENTIAL_CHAIN_KEYCHAIN_SERVICE — the imported constant, not a re-declared string", async () => {
    entryConstructions.length = 0;

    const setCode = await runCli(["set", "prod-wiring-server", "--stdin"], {
      env: {},
      stdin: Readable.from(["prodwiringpw\n"]),
      stdout: silentOutput,
      stderr: silentOutput,
      // `loadKeyring` deliberately OMITTED — exercises the real,
      // non-injected `loadRealKeyring()` default.
    });
    expect(setCode).toBe(0);
    expect(entryConstructions).toContainEqual([CREDENTIAL_CHAIN_KEYCHAIN_SERVICE, "prod-wiring-server"]);

    let listOut = "";
    const listCode = await runCli(["list", "--json"], {
      env: {},
      stdout: { write: (c: string) => { listOut += c; } },
      stderr: silentOutput,
    });
    expect(listCode).toBe(0);
    expect(JSON.parse(listOut.trim())).toEqual({ names: ["prod-wiring-server"] });

    const deleteCode = await runCli(["delete", "prod-wiring-server"], {
      env: {},
      stdout: silentOutput,
      stderr: silentOutput,
    });
    expect(deleteCode).toBe(0);
    expect(fakeStore.has(storeKey(CREDENTIAL_CHAIN_KEYCHAIN_SERVICE, "prod-wiring-server"))).toBe(false);
  });

  // Integration AC 31.2.5, closing the residual gap the code review found
  // (2026-07-25): `credentials-cli-chain-agreement.test.ts` substitutes an
  // ACCOUNT-keyed fake on both sides, so the SERVICE dimension is absent from
  // it — and no test anywhere pinned the READER's service. Here both halves
  // run through their real production wiring against one service+account
  // keyed store, so a change to EITHER side's service constant fails this.
  it("a password written by the real `set` wiring is read back by the real, un-seamed credential chain — writer AND reader service pinned end-to-end", async () => {
    entryConstructions.length = 0;
    fakeStore.clear();

    const setCode = await runCli(["set", "roundtrip-server", "--stdin"], {
      env: {},
      stdin: Readable.from(["roundtrippw\n"]),
      stdout: silentOutput,
      stderr: silentOutput,
    });
    expect(setCode).toBe(0);

    // `getKeychainPassword` deliberately OMITTED — this exercises
    // `credential-chain.ts`'s own `getKeychainPasswordDefault`, which
    // constructs `new Entry(CREDENTIAL_CHAIN_KEYCHAIN_SERVICE, serverName)`
    // against the same mocked module. `env: {}` keeps link 1 empty so link 2
    // is what must resolve this.
    const result = await resolveCredential("roundtrip-server", { env: {} });

    expect(result).toEqual({ password: "roundtrippw", source: "keychain" });
    // Both constructions recorded, with the SAME service on both sides.
    const roundtripEntries = entryConstructions.filter(([, account]) => account === "roundtrip-server");
    expect(roundtripEntries.length).toBeGreaterThanOrEqual(2);
    for (const [service] of roundtripEntries) {
      expect(service).toBe(CREDENTIAL_CHAIN_KEYCHAIN_SERVICE);
    }
  });
});
