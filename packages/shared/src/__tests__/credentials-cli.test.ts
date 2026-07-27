/**
 * Unit tests for `iris-mcp-credentials` (Epic 31, Story 31.2).
 *
 * Every test injects a FAKE keychain — no test ever touches the real OS
 * keychain (same discipline as AC 31.1.2 / project rule for this epic).
 * The fake keychain is an in-memory Map scoped to a single test, so nothing
 * here can leak into (or read from) a developer's or CI runner's real
 * credential store.
 */

import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

import {
  runCli,
  promptPasswordFromStream,
  KeyringUnavailableError,
  type KeyringPort,
  type KeyringCredential,
  type CliDeps,
} from "../cli/credentials.js";
import { CREDENTIAL_CHAIN_KEYCHAIN_SERVICE, type CredentialLinkResult } from "../credential-chain.js";
import { ProfileResolutionError, type IrisProfile, type ProfileRegistry } from "../profiles.js";

// ── Fakes ──────────────────────────────────────────────────────────────

function createFakeKeyring(initial: Record<string, string> = {}): KeyringPort & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    setPassword(account: string, password: string): void {
      store.set(account, password);
    },
    getPassword(account: string): string | null {
      return store.has(account) ? (store.get(account) as string) : null;
    },
    deleteCredential(account: string): boolean {
      return store.delete(account);
    },
    exists(account: string): boolean {
      return store.has(account);
    },
    listCredentials(): KeyringCredential[] {
      return [...store.entries()].map(([account, password]) => ({ account, password }));
    },
  };
}

function createCollector(): { write: (chunk: string) => void; text: string } {
  const collector = {
    text: "",
    write(chunk: string): void {
      collector.text += chunk;
    },
  };
  return collector;
}

function baseDeps(overrides: Partial<CliDeps> = {}): { deps: CliDeps; stdout: ReturnType<typeof createCollector>; stderr: ReturnType<typeof createCollector> } {
  const stdout = createCollector();
  const stderr = createCollector();
  const deps: CliDeps = {
    env: {},
    stdout,
    stderr,
    loadKeyring: async () => createFakeKeyring(),
    ...overrides,
  };
  return { deps, stdout, stderr };
}

function fakeProfile(name: string, password: string): IrisProfile {
  return {
    name,
    host: "irisexample.test",
    port: 443,
    username: "admin",
    password,
    namespace: "USER",
    https: true,
    baseUrl: "https://irisexample.test:443",
    timeout: 60_000,
  };
}

// ── Usage errors (exit 2) ────────────────────────────────────────────

describe("usage errors — exit code 2", () => {
  it("no command at all", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli([], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain("no command given");
    expect(stderr.text).toContain("Usage: iris-mcp-credentials");
  });

  it("unknown command", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["frobnicate"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('unknown command "frobnicate"');
  });

  it("set missing serverName", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["set"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('"set" requires exactly one argument');
  });

  it("set with extra positional arg", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["set", "a", "b"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('"set" requires exactly one argument');
  });

  it("set with unknown flag", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["set", "myserver", "--bogus"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('Unknown option "--bogus"');
  });

  it("delete missing serverName", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["delete"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('"delete" requires exactly one argument');
  });

  it("list rejects a positional argument", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["list", "extra"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('"list" takes no arguments');
  });

  it("list rejects an unknown flag", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["list", "--connect"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('Unknown option "--connect"');
  });

  it("test missing serverName", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["test"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('"test" requires exactly one argument');
  });

  it("test rejects an unknown flag", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["test", "myserver", "--stdin"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('Unknown option "--stdin"');
  });

  it("-h/--help short-circuits with exit 0, regardless of position", async () => {
    const { deps: deps1, stdout: stdout1 } = baseDeps();
    expect(await runCli(["--help"], deps1)).toBe(0);
    expect(stdout1.text).toContain("Usage: iris-mcp-credentials");

    const { deps: deps2, stdout: stdout2 } = baseDeps();
    expect(await runCli(["set", "-h"], deps2)).toBe(0);
    expect(stdout2.text).toContain("Usage: iris-mcp-credentials");
  });
});

// ── set ──────────────────────────────────────────────────────────────

describe("set", () => {
  it("interactive path: prompts, stores via the keyring, never echoes the password", async () => {
    const keyring = createFakeKeyring();
    const promptPassword = vi.fn(async (serverName: string) => {
      expect(serverName).toBe("myserver");
      return "s3cr3t-pw";
    });
    const { deps, stdout, stderr } = baseDeps({ loadKeyring: async () => keyring, promptPassword });

    const code = await runCli(["set", "myserver"], deps);

    expect(code).toBe(0);
    expect(promptPassword).toHaveBeenCalledTimes(1);
    expect(keyring.store.get("myserver")).toBe("s3cr3t-pw");
    expect(stdout.text).not.toContain("s3cr3t-pw");
    expect(stderr.text).not.toContain("s3cr3t-pw");
    expect(stdout.text).toContain('Stored a password for "myserver"');
    expect(stdout.text).toContain(CREDENTIAL_CHAIN_KEYCHAIN_SERVICE);
  });

  it("--stdin path: reads from the injected stream, trims a single trailing newline only", async () => {
    const keyring = createFakeKeyring();
    const { deps } = baseDeps({ loadKeyring: async () => keyring, stdin: Readable.from(["  stdinpw123  \n"]) });

    const code = await runCli(["set", "myserver", "--stdin"], deps);

    expect(code).toBe(0);
    // Only the trailing "\n" is stripped -- leading/inner whitespace is preserved verbatim.
    expect(keyring.store.get("myserver")).toBe("  stdinpw123  ");
  });

  it("--stdin path: trims a single trailing CRLF", async () => {
    const keyring = createFakeKeyring();
    const { deps } = baseDeps({ loadKeyring: async () => keyring, stdin: Readable.from(["crlfpw\r\n"]) });

    const code = await runCli(["set", "myserver", "--stdin"], deps);

    expect(code).toBe(0);
    expect(keyring.store.get("myserver")).toBe("crlfpw");
  });

  it("--stdin path: empty input is a usage error, and the keyring is never touched", async () => {
    const keyring = createFakeKeyring();
    const setPasswordSpy = vi.spyOn(keyring, "setPassword");
    const { deps, stderr } = baseDeps({ loadKeyring: async () => keyring, stdin: Readable.from(["\n"]) });

    const code = await runCli(["set", "myserver", "--stdin"], deps);

    expect(code).toBe(2);
    expect(stderr.text).toContain("no password was provided");
    expect(setPasswordSpy).not.toHaveBeenCalled();
  });

  it("whitespace-only stdin input is also rejected as empty", async () => {
    const keyring = createFakeKeyring();
    const { deps, stderr } = baseDeps({ loadKeyring: async () => keyring, stdin: Readable.from(["   \n"]) });

    const code = await runCli(["set", "myserver", "--stdin"], deps);

    expect(code).toBe(2);
    expect(stderr.text).toContain("no password was provided");
  });

  it("keychain unavailable: fails LOUDLY with a non-zero exit (opposite of the chain's silent skip)", async () => {
    const { deps, stderr } = baseDeps({
      loadKeyring: async () => {
        throw new KeyringUnavailableError("no prebuilt binary for this platform");
      },
      stdin: Readable.from(["pw\n"]),
    });

    const code = await runCli(["set", "myserver", "--stdin"], deps);

    expect(code).toBe(1);
    expect(stderr.text).toContain("OS keychain is unavailable");
    expect(stderr.text).not.toContain("pw\n");
  });

  it("keyring.setPassword throwing is reported and never leaks the password", async () => {
    const keyring = createFakeKeyring();
    keyring.setPassword = () => {
      throw new Error("Ambiguous credential");
    };
    const { deps, stderr } = baseDeps({ loadKeyring: async () => keyring, stdin: Readable.from(["topsecretvalue\n"]) });

    const code = await runCli(["set", "myserver", "--stdin"], deps);

    expect(code).toBe(1);
    expect(stderr.text).toContain("could not write to the OS keychain");
    expect(stderr.text).not.toContain("topsecretvalue");
  });

  // ── 31-2-4 (Story 32.3): create vs replace is meaningful information for a
  // tool whose worst failure mode is "the wrong password is stored".
  it("31-2-4: a fresh entry reports 'Stored', and replacing an existing entry reports 'Replaced the existing password'", async () => {
    const keyring = createFakeKeyring();
    const first = baseDeps({ loadKeyring: async () => keyring, stdin: Readable.from(["pw-one\n"]) });
    const code1 = await runCli(["set", "myserver", "--stdin"], first.deps);
    expect(code1).toBe(0);
    expect(first.stdout.text).toContain('Stored a password for "myserver"');
    expect(first.stdout.text).not.toContain("Replaced");

    const second = baseDeps({ loadKeyring: async () => keyring, stdin: Readable.from(["pw-two\n"]) });
    const code2 = await runCli(["set", "myserver", "--stdin"], second.deps);
    expect(code2).toBe(0);
    expect(second.stdout.text).toContain('Replaced the existing password for "myserver"');
    expect(keyring.store.get("myserver")).toBe("pw-two");
  });
});

// ── delete ───────────────────────────────────────────────────────────

describe("delete", () => {
  it("deletes an existing entry", async () => {
    const keyring = createFakeKeyring({ myserver: "pw" });
    const { deps, stdout } = baseDeps({ loadKeyring: async () => keyring });

    const code = await runCli(["delete", "myserver"], deps);

    expect(code).toBe(0);
    expect(keyring.store.has("myserver")).toBe(false);
    expect(stdout.text).toContain('Deleted the stored password for "myserver"');
  });

  it("a missing entry is exit code 1, not a crash", async () => {
    const keyring = createFakeKeyring();
    const { deps, stderr } = baseDeps({ loadKeyring: async () => keyring });

    const code = await runCli(["delete", "ghost"], deps);

    expect(code).toBe(1);
    expect(stderr.text).toContain('No stored password found for "ghost"');
  });

  it("keychain unavailable fails loudly", async () => {
    const { deps, stderr } = baseDeps({
      loadKeyring: async () => {
        throw new KeyringUnavailableError("boom");
      },
    });

    const code = await runCli(["delete", "myserver"], deps);

    expect(code).toBe(1);
    expect(stderr.text).toContain("OS keychain is unavailable");
  });
});

// ── list ─────────────────────────────────────────────────────────────

describe("list", () => {
  it("empty keychain: human output says so, exit 0", async () => {
    const { deps, stdout } = baseDeps({ loadKeyring: async () => createFakeKeyring() });

    const code = await runCli(["list"], deps);

    expect(code).toBe(0);
    expect(stdout.text).toContain("No stored passwords.");
  });

  it("human output: names only, sorted, one per line — never the password", async () => {
    const keyring = createFakeKeyring({ zeta: "pw-zeta-secret", alpha: "pw-alpha-secret" });
    const { deps, stdout } = baseDeps({ loadKeyring: async () => keyring });

    const code = await runCli(["list"], deps);

    expect(code).toBe(0);
    expect(stdout.text).toBe("alpha\nzeta\n");
    expect(stdout.text).not.toContain("secret");
  });

  it("--json output: {names: [...]}, sorted, never the password", async () => {
    const keyring = createFakeKeyring({ zeta: "pw-zeta-secret", alpha: "pw-alpha-secret" });
    const { deps, stdout } = baseDeps({ loadKeyring: async () => keyring });

    const code = await runCli(["list", "--json"], deps);

    expect(code).toBe(0);
    expect(JSON.parse(stdout.text.trim())).toEqual({ names: ["alpha", "zeta"] });
    expect(stdout.text).not.toContain("secret");
  });

  it("keychain unavailable fails loudly", async () => {
    const { deps, stderr } = baseDeps({
      loadKeyring: async () => {
        throw new KeyringUnavailableError("boom");
      },
    });

    const code = await runCli(["list"], deps);

    expect(code).toBe(1);
    expect(stderr.text).toContain("OS keychain is unavailable");
  });

  it("keyring.listCredentials throwing is reported, exit 1", async () => {
    const keyring = createFakeKeyring();
    keyring.listCredentials = () => {
      throw new Error("enumeration failed");
    };
    const { deps, stderr } = baseDeps({ loadKeyring: async () => keyring });

    const code = await runCli(["list"], deps);

    expect(code).toBe(1);
    expect(stderr.text).toContain("could not list OS-keychain entries");
  });
});

// ── test ─────────────────────────────────────────────────────────────

describe("test (no --connect)", () => {
  it("resolved via env: human + json report the source, never the password", async () => {
    const resolveCredentialFn = vi.fn(
      async (): Promise<CredentialLinkResult | undefined> => ({ password: "envsecretvalue", source: "env" }),
    );
    const { deps, stdout } = baseDeps({ resolveCredentialFn });

    const code = await runCli(["test", "myserver"], deps);

    expect(code).toBe(0);
    expect(stdout.text).toContain("resolved via env link");
    expect(stdout.text).not.toContain("envsecretvalue");
  });

  it("resolved via keychain: --json shape", async () => {
    const resolveCredentialFn = vi.fn(
      async (): Promise<CredentialLinkResult | undefined> => ({ password: "kcsecretvalue", source: "keychain" }),
    );
    const { deps, stdout } = baseDeps({ resolveCredentialFn });

    const code = await runCli(["test", "myserver", "--json"], deps);

    expect(code).toBe(0);
    expect(JSON.parse(stdout.text.trim())).toEqual({ name: "myserver", resolved: true, source: "keychain" });
    expect(stdout.text).not.toContain("kcsecretvalue");
  });

  it("resolved via helper: --json shape", async () => {
    const resolveCredentialFn = vi.fn(
      async (): Promise<CredentialLinkResult | undefined> => ({ password: "helpersecretvalue", source: "helper" }),
    );
    const { deps, stdout } = baseDeps({ resolveCredentialFn });

    const code = await runCli(["test", "myserver", "--json"], deps);

    expect(code).toBe(0);
    expect(JSON.parse(stdout.text.trim())).toEqual({ name: "myserver", resolved: true, source: "helper" });
  });

  it("unresolved: exit 1, remediation names all three options, --json shape has source:null AND carries the remediation", async () => {
    const resolveCredentialFn = vi.fn(async (): Promise<CredentialLinkResult | undefined> => undefined);
    const { deps: humanDeps, stderr } = baseDeps({ resolveCredentialFn });
    const humanCode = await runCli(["test", "myserver"], humanDeps);
    expect(humanCode).toBe(1);
    expect(stderr.text).toContain("iris-mcp-credentials set myserver");
    expect(stderr.text).toContain("IRIS_CREDENTIAL_HELPER");
    expect(stderr.text).toContain("IRIS_PROFILES");

    const { deps: jsonDeps, stdout } = baseDeps({ resolveCredentialFn });
    const jsonCode = await runCli(["test", "myserver", "--json"], jsonDeps);
    expect(jsonCode).toBe(1);
    // AC 31.2.2 "errors name remediations" must hold in the machine-readable
    // shape too — the remediation was previously reachable only on the human
    // branch, so `test --json` reported a failure with no way to act on it
    // (code review 2026-07-25).
    const payload = JSON.parse(stdout.text.trim()) as { error: string };
    expect(payload).toEqual({
      name: "myserver",
      resolved: false,
      source: null,
      error: expect.any(String),
    });
    expect(payload.error).toContain("iris-mcp-credentials set myserver");
    expect(payload.error).toContain("IRIS_CREDENTIAL_HELPER");
  });

  it("a chain that THROWS is contained: exit 1 with this command's own message + remediation, never the bin's generic handler", async () => {
    const resolveCredentialFn = vi.fn(async () => {
      throw new Error("credential helper exploded");
    }) as unknown as NonNullable<CliDeps["resolveCredentialFn"]>;
    const { deps, stdout, stderr } = baseDeps({ resolveCredentialFn, env: { IRIS_PASSWORD: "envsecretvalue" } });

    // Must RESOLVE with an exit code, not reject: the real chain documents
    // "NEVER throws", but `resolveCredentialFn` is a public seam and link 3
    // shells out to an operator-supplied helper.
    const code = await runCli(["test", "myserver", "--json"], deps);

    expect(code).toBe(1);
    expect(stderr.text).toContain("the credential chain failed");
    expect(stderr.text).toContain("iris-mcp-credentials set myserver");
    expect(JSON.parse(stdout.text.trim())).toEqual({
      name: "myserver",
      resolved: false,
      source: null,
      error: "credential helper exploded",
    });
  });

  it("a chain throw whose message echoes IRIS_PASSWORD is redacted on both streams", async () => {
    const resolveCredentialFn = vi.fn(async () => {
      throw new Error("helper printed envsecretvalue to stderr");
    }) as unknown as NonNullable<CliDeps["resolveCredentialFn"]>;
    const { deps, stdout, stderr } = baseDeps({
      resolveCredentialFn,
      env: { IRIS_PASSWORD: "envsecretvalue" },
    });

    const code = await runCli(["test", "myserver", "--json"], deps);

    expect(code).toBe(1);
    expect(stderr.text).not.toContain("envsecretvalue");
    expect(stdout.text).not.toContain("envsecretvalue");
    expect(stderr.text).toContain("[REDACTED]");
  });

  it("resolveCredentialFn is called with the CLI's env, driving the REAL chain in production (not reimplemented)", async () => {
    const resolveCredentialFn = vi.fn(async (): Promise<CredentialLinkResult | undefined> => undefined);
    const env = { IRIS_PASSWORD: "irrelevant-here" };
    const { deps } = baseDeps({ resolveCredentialFn, env });

    await runCli(["test", "myserver"], deps);

    expect(resolveCredentialFn).toHaveBeenCalledWith("myserver", { env });
  });
});

describe("test --connect", () => {
  it("not resolved: connect is reported as not attempted, exit 1, no profile registry lookup performed", async () => {
    const resolveCredentialFn = vi.fn(async (): Promise<CredentialLinkResult | undefined> => undefined);
    const loadProfileRegistryFn = vi.fn();
    const { deps, stdout } = baseDeps({ resolveCredentialFn, loadProfileRegistryFn });

    const code = await runCli(["test", "myserver", "--connect", "--json"], deps);

    expect(code).toBe(1);
    const payload = JSON.parse(stdout.text.trim());
    expect(payload).toEqual({
      name: "myserver",
      resolved: false,
      source: null,
      error: expect.any(String),
      // 31-2-3 (Story 32.3): `ok` is NULL — "the probe never ran" is no longer
      // indistinguishable from "the probe failed".
      connect: { attempted: false, ok: null, error: expect.any(String) },
    });
    expect(loadProfileRegistryFn).not.toHaveBeenCalled();
  });

  it("not resolved, human mode: the skipped connectivity check is stated rather than silently omitted", async () => {
    const resolveCredentialFn = vi.fn(async (): Promise<CredentialLinkResult | undefined> => undefined);
    const { deps, stderr } = baseDeps({ resolveCredentialFn, loadProfileRegistryFn: vi.fn() });

    const code = await runCli(["test", "myserver", "--connect"], deps);

    expect(code).toBe(1);
    expect(stderr.text).toContain("connect SKIPPED");
  });

  it("resolved + connect succeeds: exit 0, profile built via the real loadProfileRegistry entry point, connectFn reused from health.ts's pattern", async () => {
    const resolveCredentialFn = vi.fn(
      async (): Promise<CredentialLinkResult | undefined> => ({ password: "chainsecretvalue", source: "keychain" }),
    );
    const profile = fakeProfile("myserver", "registrysecretvalue");
    const registry: ProfileRegistry = new Map([["myserver", profile]]);
    const loadProfileRegistryFn = vi.fn(async () => registry);
    const connectFn = vi.fn(async () => {
      /* success */
    });
    const { deps, stdout } = baseDeps({ resolveCredentialFn, loadProfileRegistryFn, connectFn });

    const code = await runCli(["test", "myserver", "--connect", "--json"], deps);

    expect(code).toBe(0);
    expect(connectFn).toHaveBeenCalledWith(profile);
    const payload = JSON.parse(stdout.text.trim());
    // 31-2-1/31-2-3 (Story 32.3): `connect.credentialSource` names WHICH
    // password the probe exercised — the registry profile's (provenance
    // "env" here), not necessarily the chain-resolved one reported in
    // `source` — and `ok` is a real boolean on an attempted probe.
    expect(payload).toEqual({
      name: "myserver",
      resolved: true,
      source: "keychain",
      connect: { attempted: true, ok: true, credentialSource: "env" },
    });
    expect(stdout.text).not.toContain("chainsecretvalue");
    expect(stdout.text).not.toContain("registrysecretvalue");
  });

  it("31-2-1: when the chain and the registry disagree (stale env password vs keychain), credentialSource makes the two halves visibly distinct", async () => {
    // The fixture the deferred item asks for: the chain resolves via the
    // KEYCHAIN (a fresh password), while the registry profile is env-sourced
    // and carries a DIFFERENT (stale) one. `source: "keychain"` and
    // `connect.credentialSource: "env"` side by side say exactly which
    // credential each half of the report exercised.
    const resolveCredentialFn = vi.fn(
      async (): Promise<CredentialLinkResult | undefined> => ({ password: "freshkeychainpw", source: "keychain" }),
    );
    const profile = fakeProfile("myserver", "staleregistrypw");
    const registry: ProfileRegistry = new Map([["myserver", profile]]);
    const loadProfileRegistryFn = vi.fn(async () => registry);
    const connectFn = vi.fn(async () => {
      /* success */
    });
    const { deps, stdout } = baseDeps({ resolveCredentialFn, loadProfileRegistryFn, connectFn });

    const code = await runCli(["test", "myserver", "--connect", "--json"], deps);

    expect(code).toBe(0);
    // The probe exercised the REGISTRY's password, not the chain-resolved one —
    // deep-equality on the exact registry profile object, whose password is
    // "staleregistrypw" (fakeProfile above), never "freshkeychainpw".
    expect(connectFn).toHaveBeenCalledWith(profile);
    const payload = JSON.parse(stdout.text.trim());
    expect(payload.source).toBe("keychain");
    expect(payload.connect.credentialSource).toBe("env");
    expect(payload.connect.ok).toBe(true);
    expect(stdout.text).not.toContain("freshkeychainpw");
    expect(stdout.text).not.toContain("staleregistrypw");
  });

  it("31-2-1: a Server-Manager-sourced registry profile reports credentialSource \"server-manager\"", async () => {
    const resolveCredentialFn = vi.fn(
      async (): Promise<CredentialLinkResult | undefined> => ({ password: "chainpw", source: "keychain" }),
    );
    const profile: IrisProfile = { ...fakeProfile("myserver", "smpw"), source: "server-manager" };
    const registry: ProfileRegistry = new Map([["myserver", profile]]);
    const loadProfileRegistryFn = vi.fn(async () => registry);
    const connectFn = vi.fn(async () => {
      /* success */
    });
    const { deps, stdout } = baseDeps({ resolveCredentialFn, loadProfileRegistryFn, connectFn });

    const code = await runCli(["test", "myserver", "--connect", "--json"], deps);

    expect(code).toBe(0);
    const payload = JSON.parse(stdout.text.trim());
    expect(payload.connect.credentialSource).toBe("server-manager");
  });

  it("31-2-3: a registry-mapping failure (no HTTP call made) reports attempted: false and ok: null — the probe never ran", async () => {
    const resolveCredentialFn = vi.fn(
      async (): Promise<CredentialLinkResult | undefined> => ({ password: "chainpw", source: "keychain" }),
    );
    const loadProfileRegistryFn = vi.fn(async () => {
      throw new ProfileResolutionError("myserver", ["default"]);
    });
    const connectFn = vi.fn();
    const { deps, stdout } = baseDeps({ resolveCredentialFn, loadProfileRegistryFn, connectFn });

    const code = await runCli(["test", "myserver", "--connect", "--json"], deps);

    expect(code).toBe(1);
    expect(connectFn).not.toHaveBeenCalled();
    const payload = JSON.parse(stdout.text.trim());
    expect(payload.connect.attempted).toBe(false);
    expect(payload.connect.ok).toBeNull();
    expect(payload.connect.error).toContain("IRIS_SERVER_MANAGER=auto");
  });

  it("resolved + connect FAILS: exit 1, error surfaced, password never leaked even if the thrown error happened to echo it", async () => {
    const resolveCredentialFn = vi.fn(
      async (): Promise<CredentialLinkResult | undefined> => ({ password: "chainsecretvalue", source: "env" }),
    );
    const profile = fakeProfile("myserver", "leakcandidatepassword");
    const registry: ProfileRegistry = new Map([["myserver", profile]]);
    const loadProfileRegistryFn = vi.fn(async () => registry);
    // Deliberately adversarial: simulate an upstream bug where the thrown
    // error's message echoes the resolved profile's password, to prove the
    // CLI's OWN redaction (not the upstream layer's good behavior) is what
    // keeps the failure surface secret-free.
    const connectFn = vi.fn(async () => {
      throw new Error("connection refused while using password leakcandidatepassword for auth");
    });
    const { deps, stdout, stderr } = baseDeps({ resolveCredentialFn, loadProfileRegistryFn, connectFn });

    const code = await runCli(["test", "myserver", "--connect"], deps);

    expect(code).toBe(1);
    // Failures go to STDERR like every other failure in this CLI, so
    // `test <name> --connect > result.txt` cannot swallow the diagnostic
    // (code review 2026-07-25).
    expect(stderr.text).toContain("connect FAILED");
    expect(stdout.text).not.toContain("leakcandidatepassword");
    expect(stderr.text).not.toContain("leakcandidatepassword");
    expect(stderr.text).toContain("[REDACTED]");
  });

  it("a password too short to redact safely WITHHOLDS the whole failure body rather than passing it through (mirrors credential-chain.ts)", async () => {
    const resolveCredentialFn = vi.fn(
      async (): Promise<CredentialLinkResult | undefined> => ({ password: "abc", source: "keychain" }),
    );
    // 3 characters — below SECRET_MIN_REDACTION_LENGTH, so substring
    // redaction would corrupt unrelated text. The chain withholds the body in
    // this case; the CLI mirrored the constant but not the withhold branch,
    // so a 1-3 character password previously printed in cleartext.
    const profile = fakeProfile("myserver", "abc");
    const registry: ProfileRegistry = new Map([["myserver", profile]]);
    const connectFn = vi.fn(async () => {
      throw new Error("auth failed for password abc");
    });
    const { deps, stdout, stderr } = baseDeps({
      resolveCredentialFn,
      loadProfileRegistryFn: vi.fn(async () => registry),
      connectFn,
    });

    const code = await runCli(["test", "myserver", "--connect"], deps);

    expect(code).toBe(1);
    expect(stderr.text).toContain("withheld");
    expect(stderr.text).not.toContain("auth failed for password abc");
    expect(stdout.text).not.toContain("auth failed for password abc");
  });

  it("a loadProfileRegistry throw is redacted too — the branch where `profile` is still undefined", async () => {
    const resolveCredentialFn = vi.fn(
      async (): Promise<CredentialLinkResult | undefined> => ({ password: "chainsecretvalue", source: "keychain" }),
    );
    // Reproduces the live finding: V8 embeds a ~20-character SOURCE EXCERPT
    // in a JSON SyntaxError, and `buildProfileRegistry` wraps that message
    // verbatim — so a malformed IRIS_PROFILES whose syntax error sits near a
    // password really did print the password on this path, which redacted
    // only against `profile.password` (undefined here).
    const loadProfileRegistryFn = vi.fn(async () => {
      throw new Error(`IRIS_PROFILES is invalid: could not parse JSON (Unexpected token 'e', ..."password":envsecretvalue"... is not valid JSON).`);
    }) as unknown as NonNullable<CliDeps["loadProfileRegistryFn"]>;
    const { deps, stdout, stderr } = baseDeps({
      resolveCredentialFn,
      loadProfileRegistryFn,
      connectFn: vi.fn(),
      env: { IRIS_PASSWORD: "envsecretvalue" },
    });

    const code = await runCli(["test", "myserver", "--connect", "--json"], deps);

    expect(code).toBe(1);
    expect(stdout.text).not.toContain("envsecretvalue");
    expect(stderr.text).not.toContain("envsecretvalue");
    expect(stdout.text).toContain("[REDACTED]");
  });

  it("resolved but no profile mapped in the registry (e.g. IRIS_SERVER_MANAGER unset): connect fails cleanly, exit 1", async () => {
    const resolveCredentialFn = vi.fn(
      async (): Promise<CredentialLinkResult | undefined> => ({ password: "chainsecretvalue", source: "keychain" }),
    );
    const emptyRegistry: ProfileRegistry = new Map();
    const loadProfileRegistryFn = vi.fn(async () => emptyRegistry);
    const connectFn = vi.fn();
    const { deps, stderr } = baseDeps({ resolveCredentialFn, loadProfileRegistryFn, connectFn });

    const code = await runCli(["test", "myserver", "--connect"], deps);

    expect(code).toBe(1);
    // 31-2-3 (Story 32.3 code review): the probe never RAN (no profile was
    // mapped, so no HTTP call was made) — attempted:false/ok:null reads as
    // SKIPPED on the human surface too, never "FAILED".
    expect(stderr.text).toContain("connect SKIPPED");
    expect(connectFn).not.toHaveBeenCalled();
    // AC 31.2.2: this is the MOST likely --connect failure for the CLI's
    // target user (fresh machine, IRIS_SERVER_MANAGER not set in the shell),
    // and `resolveProfile`'s own message steers them to IRIS_PROFILES, which
    // the README says REPLACES rather than completes a Server Manager
    // definition. The CLI names the right remedy itself.
    expect(stderr.text).toContain("IRIS_SERVER_MANAGER=auto");
    expect(stderr.text).toContain("The credential check itself already succeeded");
  });

  it("propagates a real ProfileResolutionError message (valid profile names) without throwing", async () => {
    const resolveCredentialFn = vi.fn(
      async (): Promise<CredentialLinkResult | undefined> => ({ password: "x-secret-value", source: "env" }),
    );
    const registry: ProfileRegistry = new Map([["default", fakeProfile("default", "defaultpw")]]);
    const loadProfileRegistryFn = vi.fn(async () => registry);
    const { deps, stdout } = baseDeps({
      resolveCredentialFn,
      loadProfileRegistryFn,
      connectFn: vi.fn(),
    });

    const code = await runCli(["test", "myserver", "--connect", "--json"], deps);

    expect(code).toBe(1);
    const payload = JSON.parse(stdout.text.trim()) as { connect: { error: string } };
    // The REAL ProfileResolutionError (profiles.ts), proving this path is
    // not reimplemented — it drives the same resolveProfile() a real server
    // startup would. `toContain` rather than `toBe` because the CLI now
    // appends its own remediation (that error's own advice, "Set
    // IRIS_PROFILES", is the wrong remedy for a keychain-backed name).
    expect(payload.connect.error).toContain(new ProfileResolutionError("myserver", ["default"]).message);
    expect(payload.connect.error).toContain("IRIS_SERVER_MANAGER=auto");
  });
});

// ── Exit-code matrix completeness (QA gap #3) ───────────────────────────
// credentials-cli.test.ts already covers: set (missing arg / extra arg /
// unknown flag), delete (missing arg), list (extra arg / unknown flag),
// test (missing arg / unknown flag), --help, unknown command. The three
// cases below round out delete/test so every one of the four subcommands
// has an "extra positional arg" AND an "unknown flag" usage-error case.

describe("exit-code matrix — rounding out delete/test usage errors", () => {
  it("delete rejects an extra positional argument (exit 2)", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["delete", "myserver", "extra"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('"delete" requires exactly one argument');
  });

  it("delete rejects an unknown flag (exit 2) — delete accepts no flags at all", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["delete", "myserver", "--json"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('Unknown option "--json"');
  });

  it("test rejects an extra positional argument (exit 2)", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["test", "myserver", "extra"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('"test" requires exactly one argument');
  });
});

// ── Secret-never-in-argv (QA gap #2 — the single worst possible regression) ──

describe("secret discipline — `set` cannot accept a password positionally", () => {
  it('"set <name> <password>" (no --stdin) is a usage error; the keyring is never touched and the would-be password is never stored anywhere', async () => {
    const keyring = createFakeKeyring();
    const setPasswordSpy = vi.spyOn(keyring, "setPassword");
    const { deps, stdout, stderr } = baseDeps({ loadKeyring: async () => keyring });

    // "hunter2" stands in for a password an attacker/careless user might
    // type positionally, exactly as `credential set myserver hunter2`
    // would look if this design mistake were made. It must land in
    // parseArgs's extra-positional-arg usage error, not in the keyring.
    const code = await runCli(["set", "myserver", "hunter2"], deps);

    expect(code).toBe(2);
    expect(stderr.text).toContain('"set" requires exactly one argument');
    expect(setPasswordSpy).not.toHaveBeenCalled();
    expect(keyring.store.has("myserver")).toBe(false);
    expect([...keyring.store.values()]).not.toContain("hunter2");
    expect(stdout.text).not.toContain("hunter2");
    expect(stderr.text).not.toContain("hunter2");
  });
});

// ── `list` and malformed native rows (QA gap #1) ────────────────────────
// `findCredentials(service)` is typed `Array<{account, password}>` but is a
// native (napi-rs) call whose real-world shape is not enforced by that type
// at runtime. These tests feed cmdList's account-extraction step
// (`credentials.map((c) => c.account).sort(...)`) rows the type system
// assumes can't happen, and verify secret-safety holds regardless of what
// else happens.
//
// Verified live (node -e probe, this repo, Node v24): per ECMA-262
// 23.1.3.30, `Array.prototype.sort` skips its comparator entirely for
// `undefined` elements (they always sort to the end), but `null` receives no
// such exemption — `null.localeCompare` threw a TypeError out of `cmdList`,
// `runCli` and the caller, because the `.map()/.sort()` call sat OUTSIDE the
// try/catch that guarded `keyring.listCredentials()` itself. Fixed at code
// review 2026-07-25: the transformation is inside the guard, non-string
// `account` rows are filtered out (they can never be a usable server name),
// and a plain `.sort()` replaces `localeCompare` so the machine-readable
// ordering does not depend on ICU data or the ambient locale.
describe("list — malformed native rows (defense-in-depth: no crash, no leak)", () => {
  it("account: undefined is skipped rather than serialized as a null entry in --json", async () => {
    const keyring = createFakeKeyring({ alpha: "alpha-secret-pw", zeta: "zeta-secret-pw" });
    keyring.listCredentials = () => [
      { account: "zeta", password: "zeta-secret-pw" },
      { account: undefined as unknown as string, password: "malformed-row-secret" },
      { account: "alpha", password: "alpha-secret-pw" },
    ];
    const { deps, stdout } = baseDeps({ loadKeyring: async () => keyring });

    const code = await runCli(["list", "--json"], deps);

    expect(code).toBe(0);
    // Previously ["alpha","zeta",null] — an untyped value handed to --json
    // consumers. A row with no usable account name is simply not a listable
    // server name.
    expect(JSON.parse(stdout.text.trim())).toEqual({ names: ["alpha", "zeta"] });
    expect(stdout.text).not.toContain("secret-pw");
    expect(stdout.text).not.toContain("malformed-row-secret");
  });

  it("account: null no longer crashes — the run completes with exit 0, the malformed row is skipped, and no password appears", async () => {
    const keyring = createFakeKeyring({ alpha: "alpha-secret-pw" });
    // Order verified live to trigger the comparator with the null entry on
    // the left (`null.localeCompare("alpha")`) under the OLD implementation:
    // a well-formed entry BEFORE the malformed one. This is the exact input
    // that used to escape `runCli` as an uncaught TypeError.
    keyring.listCredentials = () => [
      { account: "alpha", password: "alpha-secret-pw" },
      { account: null as unknown as string, password: "malformed-row-secret" },
    ];
    const { deps, stdout, stderr } = baseDeps({ loadKeyring: async () => keyring });

    // Must RESOLVE with an exit code — `runCli` documents itself as a pure
    // function of argv/deps that returns an exit code, never rejects.
    const code = await runCli(["list"], deps);

    expect(code).toBe(0);
    expect(stdout.text).toBe("alpha\n");
    expect(stdout.text).not.toContain("secret-pw");
    expect(stderr.text).not.toContain("secret-pw");
    expect(stderr.text).not.toContain("malformed-row-secret");
  });

  it("a listCredentials() implementation that throws still reaches the CONTRACTED exit 1 + message, not a generic crash", async () => {
    const keyring = createFakeKeyring();
    keyring.listCredentials = () => {
      throw new TypeError("native enumeration blew up");
    };
    const { deps, stderr } = baseDeps({ loadKeyring: async () => keyring });

    const code = await runCli(["list"], deps);

    expect(code).toBe(1);
    expect(stderr.text).toContain("could not list OS-keychain entries");
  });

  it("password: null on an otherwise well-formed row never disrupts listing (the password field is discarded unconditionally, whatever its value)", async () => {
    const keyring = createFakeKeyring({ alpha: "alpha-secret-pw" });
    keyring.listCredentials = () => [
      { account: "alpha", password: "alpha-secret-pw" },
      { account: "orphaned", password: null as unknown as string },
    ];
    const { deps, stdout } = baseDeps({ loadKeyring: async () => keyring });

    const code = await runCli(["list", "--json"], deps);

    expect(code).toBe(0);
    expect(JSON.parse(stdout.text.trim())).toEqual({ names: ["alpha", "orphaned"] });
  });
});

// ── `list --json` on failure paths (QA gap #6 — resolved at code review) ──
// The asymmetry QA documented is now closed. The CLI-wide rule, stated in
// `--help` and the README: an OPERATIONAL outcome (exit 0 or 1) under
// `--json` always writes exactly one JSON object to stdout; usage errors
// (exit 2) stay plain text on stderr, because a usage error means the flags
// themselves were not understood. The human-readable line still goes to
// stderr in both cases, so `list --json 2>/dev/null | jq` works and a human
// running it sees the error too.
describe("list --json on failure paths (machine-readable parity with test --json)", () => {
  it("keychain-unavailable: --json emits {error} on stdout AND the human line on stderr", async () => {
    const { deps, stdout, stderr } = baseDeps({
      loadKeyring: async () => {
        throw new KeyringUnavailableError("boom");
      },
    });

    const code = await runCli(["list", "--json"], deps);

    expect(code).toBe(1);
    const payload = JSON.parse(stdout.text.trim()) as { error: string; names?: unknown };
    expect(payload.error).toContain("OS keychain is unavailable");
    // No `names` key on the failure shape — an empty array would be read as
    // "no credentials stored", which is a different (and wrong) fact.
    expect(payload.names).toBeUndefined();
    expect(stderr.text).toContain("OS keychain is unavailable");
  });

  it("listCredentials throwing: same shape", async () => {
    const keyring = createFakeKeyring();
    keyring.listCredentials = () => {
      throw new Error("enumeration failed");
    };
    const { deps, stdout, stderr } = baseDeps({ loadKeyring: async () => keyring });

    const code = await runCli(["list", "--json"], deps);

    expect(code).toBe(1);
    const payload = JSON.parse(stdout.text.trim()) as { error: string; names?: unknown };
    expect(payload.error).toContain("could not list OS-keychain entries");
    expect(payload.names).toBeUndefined();
    expect(stderr.text).toContain("could not list OS-keychain entries");
  });

  it("a USAGE error (exit 2) stays plain text on stderr even under --json — the flags were not understood", async () => {
    const { deps, stdout, stderr } = baseDeps();

    const code = await runCli(["list", "extra", "--json"], deps);

    expect(code).toBe(2);
    expect(stdout.text).toBe("");
    expect(stderr.text).toContain('"list" takes no arguments');
  });
});

// ── The interactive prompt itself (code review 2026-07-25) ──────────────
// Previously UNTESTABLE and therefore untested: `promptPasswordDefault`
// hard-coded `process.stdin`/`process.stdout`, so every `set` test injected
// `deps.promptPassword` and bypassed it. It is now bound to the resolved
// stdin/stderr seams and exported, and these tests pin the two defects that
// were hiding there — both reproduced live on Node v24 before the fix.

interface FakeStdin extends Readable {
  emitData(s: string): void;
  emitEnd(): void;
  emitError(e: Error): void;
}

/** A minimal non-TTY `Readable` stand-in the prompt can be driven through. */
function createFakeStdin(): FakeStdin {
  const emitter = new EventEmitter();
  const stream = emitter as unknown as FakeStdin;
  Object.assign(stream, {
    resume: () => stream,
    pause: () => stream,
    setEncoding: () => stream,
    emitData: (s: string): void => {
      emitter.emit("data", s);
    },
    emitEnd: (): void => {
      emitter.emit("end");
    },
    emitError: (e: Error): void => {
      emitter.emit("error", e);
    },
  });
  return stream;
}

describe("promptPasswordFromStream — hidden interactive prompt", () => {
  it("a PASTED password arriving as one chunk with its trailing newline resolves WITHOUT the newline", async () => {
    // The regression that motivated the rewrite: the old whole-chunk switch
    // matched no terminator for "pastedpw\n", appended it verbatim, and the
    // user's next Enter then stored a password containing a literal newline —
    // authentication failed forever after, against a value unreadable from
    // anywhere. Reproduced live before the fix.
    const stdin = createFakeStdin();
    const stderr = createCollector();
    const promise = promptPasswordFromStream("myserver", stdin, stderr);
    stdin.emitData("pastedpw\n");

    await expect(promise).resolves.toBe("pastedpw");
    expect(stderr.text).toContain('Password for "myserver"');
    expect(stderr.text).not.toContain("pastedpw");
  });

  it("CRLF and trailing garbage after the terminator are ignored", async () => {
    const stdin = createFakeStdin();
    const promise = promptPasswordFromStream("myserver", stdin, createCollector());
    stdin.emitData("pastedpw\r\nignored-after-enter");
    await expect(promise).resolves.toBe("pastedpw");
  });

  it("EOF (stream end) resolves instead of hanging forever — the silent exit-0-storing-nothing bug", async () => {
    // With only a "data" listener, `set <name>` against a piped or closed
    // stdin never settled; a pending promise does not hold the event loop
    // open, so the process exited 0 having written nothing.
    const stdin = createFakeStdin();
    const promise = promptPasswordFromStream("myserver", stdin, createCollector());
    stdin.emitData("piped");
    stdin.emitEnd();
    await expect(promise).resolves.toBe("piped");
  });

  it("EOF with no input at all resolves empty (which `set` then rejects as empty input)", async () => {
    const stdin = createFakeStdin();
    const promise = promptPasswordFromStream("myserver", stdin, createCollector());
    stdin.emitEnd();
    await expect(promise).resolves.toBe("");
  });

  it("character-by-character typing, backspace, and Ctrl-D all work", async () => {
    const stdin = createFakeStdin();
    const promise = promptPasswordFromStream("myserver", stdin, createCollector());
    for (const ch of "abcX") stdin.emitData(ch);
    stdin.emitData("\u007f"); // DEL removes the X
    stdin.emitData("d");
    stdin.emitData("\u0004"); // Ctrl-D
    await expect(promise).resolves.toBe("abcd");
  });

  it("backspace is code-point correct for astral characters", async () => {
    const stdin = createFakeStdin();
    const promise = promptPasswordFromStream("myserver", stdin, createCollector());
    stdin.emitData("a\u{1F510}"); // 'a' + a 2-code-unit emoji, one chunk
    stdin.emitData("\u007f"); // must remove the WHOLE emoji, not half a surrogate pair
    stdin.emitData("\n");
    await expect(promise).resolves.toBe("a");
  });

  it("Ctrl-C rejects and removes every listener", async () => {
    const stdin = createFakeStdin();
    const promise = promptPasswordFromStream("myserver", stdin, createCollector());
    stdin.emitData("secret\u0003");
    await expect(promise).rejects.toThrow("Aborted.");
    expect(stdin.listenerCount("data")).toBe(0);
    expect(stdin.listenerCount("end")).toBe(0);
    expect(stdin.listenerCount("error")).toBe(0);
  });

  it("a stream error rejects rather than surfacing as an uncaught EventEmitter exception", async () => {
    const stdin = createFakeStdin();
    const promise = promptPasswordFromStream("myserver", stdin, createCollector());
    stdin.emitError(new Error("EIO"));
    await expect(promise).rejects.toThrow("EIO");
  });

  it("drives `set` end-to-end through the REAL default prompt (no promptPassword injection)", async () => {
    const keyring = createFakeKeyring();
    const stdin = createFakeStdin();
    const stdout = createCollector();
    const stderr = createCollector();
    const run = runCli(["set", "myserver"], {
      env: {},
      stdout,
      stderr,
      stdin,
      loadKeyring: async () => keyring,
      // `promptPassword` deliberately OMITTED.
    });
    // Give cmdSet's `await deps.loadKeyring()` a turn before the paste lands.
    await Promise.resolve();
    await Promise.resolve();
    stdin.emitData("pasted-from-manager\n");

    expect(await run).toBe(0);
    expect(keyring.store.get("myserver")).toBe("pasted-from-manager");
    expect(stdout.text).not.toContain("pasted-from-manager");
    expect(stderr.text).not.toContain("pasted-from-manager");
  });
});

// ── `set --stdin` on a terminal, and server-name validation ─────────────

describe("set --stdin on an interactive terminal", () => {
  it("is refused (exit 2) — reading a TTY does not suppress echo, so the password would be shown in cleartext", async () => {
    const keyring = createFakeKeyring();
    const setPasswordSpy = vi.spyOn(keyring, "setPassword");
    const tty = createFakeStdin();
    (tty as unknown as { isTTY: boolean }).isTTY = true;
    const { deps, stderr } = baseDeps({ loadKeyring: async () => keyring, stdin: tty });

    const code = await runCli(["set", "myserver", "--stdin"], deps);

    expect(code).toBe(2);
    expect(stderr.text).toContain("cleartext");
    expect(stderr.text).toContain('"iris-mcp-credentials set myserver" (no --stdin)');
    expect(setPasswordSpy).not.toHaveBeenCalled();
  });
});

describe("server-name validation (exit 2 before the keychain is touched)", () => {
  const invalid: Array<[string, string]> = [
    ["empty", ""],
    ["whitespace-only", "   "],
    ["embedded newline", "a\nb"],
    ["embedded control character", "a\u0001b"],
  ];

  for (const [label, name] of invalid) {
    it(`set rejects a ${label} server name`, async () => {
      const keyring = createFakeKeyring();
      const setPasswordSpy = vi.spyOn(keyring, "setPassword");
      const { deps, stderr } = baseDeps({
        loadKeyring: async () => keyring,
        stdin: Readable.from(["pw\n"]),
      });

      const code = await runCli(["set", name, "--stdin"], deps);

      expect(code).toBe(2);
      expect(stderr.text).toContain("<serverName> must not");
      expect(setPasswordSpy).not.toHaveBeenCalled();
    });

    it(`test rejects a ${label} server name`, async () => {
      const resolveCredentialFn = vi.fn(async (): Promise<CredentialLinkResult | undefined> => undefined);
      const { deps, stderr } = baseDeps({ resolveCredentialFn });

      const code = await runCli(["test", name], deps);

      expect(code).toBe(2);
      expect(stderr.text).toContain("<serverName> must not");
      // An empty name previously resolved through `resolveProfile` to the
      // RESERVED "default" profile, so `test "" --connect` silently probed
      // the LOCAL default host while reporting `name: ""`.
      expect(resolveCredentialFn).not.toHaveBeenCalled();
    });
  }

  it("delete rejects an empty server name", async () => {
    const keyring = createFakeKeyring({ "": "orphan" });
    const { deps, stderr } = baseDeps({ loadKeyring: async () => keyring });
    const code = await runCli(["delete", ""], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain("<serverName> must not");
  });

  it("a legitimate name with unicode and punctuation is still accepted", async () => {
    const keyring = createFakeKeyring();
    const { deps } = baseDeps({ loadKeyring: async () => keyring, stdin: Readable.from(["pw\n"]) });
    expect(await runCli(["set", "prod-eu_1.café", "--stdin"], deps)).toBe(0);
    expect(keyring.store.get("prod-eu_1.café")).toBe("pw");
  });
});

describe('"--" end-of-options terminator', () => {
  it("makes a server name beginning with a dash addressable instead of an unknown-option error", async () => {
    const keyring = createFakeKeyring({ "--json": "pw" });
    const { deps, stdout } = baseDeps({ loadKeyring: async () => keyring });

    const code = await runCli(["delete", "--", "--json"], deps);

    expect(code).toBe(0);
    expect(stdout.text).toContain('Deleted the stored password for "--json"');
    expect(keyring.store.has("--json")).toBe(false);
  });

  it("without it, the same argument is still rejected as an unknown option", async () => {
    const { deps, stderr } = baseDeps();
    expect(await runCli(["delete", "--json"], deps)).toBe(2);
    expect(stderr.text).toContain('Unknown option "--json"');
  });
});

// ── `set --stdin` byte-level input hazards ─────────────────────────────

describe("set --stdin byte handling", () => {
  it("strips a leading UTF-8 BOM (PowerShell Out-File is the platform default here)", async () => {
    const keyring = createFakeKeyring();
    const { deps } = baseDeps({
      loadKeyring: async () => keyring,
      stdin: Readable.from([Buffer.from("\ufeffbomprefixedpw\n", "utf8")]),
    });

    const code = await runCli(["set", "myserver", "--stdin"], deps);

    expect(code).toBe(0);
    // Previously stored "\ufeffbomprefixedpw": an invisible prefix that
    // `.trim()` in the empty-input guard absorbs, so `set` reported success
    // and every later authentication failed.
    expect(keyring.store.get("myserver")).toBe("bomprefixedpw");
  });

  // \u2500\u2500 31-2-5 (Story 32.3): a misdirected pipe is a clean error, not an
  // unbounded allocation.
  it("31-2-5: input past the 64 KiB cap is a usage error (exit 2) naming the cap, and the keyring is never written", async () => {
    const keyring = createFakeKeyring();
    const setPasswordSpy = vi.spyOn(keyring, "setPassword");
    const oversized = Buffer.alloc(70 * 1024, "x"); // 70 KiB \u2014 past the 64 KiB cap
    const { deps, stderr } = baseDeps({
      loadKeyring: async () => keyring,
      stdin: Readable.from([oversized]),
    });

    const code = await runCli(["set", "myserver", "--stdin"], deps);

    expect(code).toBe(2);
    expect(stderr.text).toContain("64 KiB");
    expect(setPasswordSpy).not.toHaveBeenCalled();
  });

  it("31-2-5: input exactly AT the 64 KiB cap is accepted", async () => {
    const keyring = createFakeKeyring();
    const atCap = Buffer.alloc(64 * 1024, "y");
    const { deps } = baseDeps({
      loadKeyring: async () => keyring,
      stdin: Readable.from([atCap]),
    });

    const code = await runCli(["set", "myserver", "--stdin"], deps);

    expect(code).toBe(0);
    expect(keyring.store.get("myserver")).toHaveLength(64 * 1024);
  });

  // \u2500\u2500 31-2-6 (Story 32.3): UTF-16 input is REJECTED (never transcoded \u2014
  // encoding-guessing can misfire on a legitimate password).
  it("31-2-6: a UTF-16LE input WITH a BOM is rejected with exit 2 naming UTF-16 as the likely cause", async () => {
    const keyring = createFakeKeyring();
    const setPasswordSpy = vi.spyOn(keyring, "setPassword");
    const utf16leBom = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("hunter2\n", "utf16le"),
    ]);
    const { deps, stderr } = baseDeps({
      loadKeyring: async () => keyring,
      stdin: Readable.from([utf16leBom]),
    });

    const code = await runCli(["set", "myserver", "--stdin"], deps);

    expect(code).toBe(2);
    expect(stderr.text).toContain("UTF-16");
    expect(setPasswordSpy).not.toHaveBeenCalled();
  });

  it("31-2-6: a UTF-16LE input WITHOUT a BOM is rejected the same way", async () => {
    const keyring = createFakeKeyring();
    const utf16le = Buffer.from("hunter2", "utf16le");
    const { deps, stderr } = baseDeps({
      loadKeyring: async () => keyring,
      stdin: Readable.from([utf16le]),
    });

    const code = await runCli(["set", "myserver", "--stdin"], deps);

    expect(code).toBe(2);
    expect(stderr.text).toContain("UTF-16");
    expect(keyring.store.has("myserver")).toBe(false);
  });
});

// ── --help output is secret-free (Dev Notes: every output path, incl. --help) ──

describe("--help output", () => {
  it("documents the four commands, the three exit codes, and the keychain service — never a secret", async () => {
    const { deps, stdout } = baseDeps();
    const code = await runCli(["--help"], deps);

    expect(code).toBe(0);
    for (const term of ["set", "delete", "list", "test", "--stdin", "--json", "--connect", "0", "1", "2", CREDENTIAL_CHAIN_KEYCHAIN_SERVICE]) {
      expect(stdout.text).toContain(term);
    }
  });
});
