/**
 * Story 32.3 QA — `iris-mcp-credentials` CLI behaviors at the BUILT-artifact
 * level (Rule #45 placement: `packages/iris-mcp-all` is the only package
 * depending on every package, so a gate spawning/importing another package's
 * dist lives here).
 *
 * The shared package's own suite covers `runCli` exhaustively with injected
 * fakes at SOURCE level. This gate exercises the NEW Story-32.3 behaviors the
 * way a real consumer hits them:
 *
 *   1. **31-2-5 (64 KiB stdin cap)** — spawn the BUILT bin
 *      (`packages/shared/dist/cli/credentials-cli.js`) with an oversized pipe;
 *      exit 2 naming the cap. The cap fires BEFORE any keychain write.
 *   2. **31-2-6 (UTF-16 stdin rejection)** — UTF-16LE input (with and without
 *      a BOM) is REJECTED with exit 2 naming UTF-16, never stored
 *      NUL-interleaved.
 *   3. **31-2-1 (`connect.credentialSource`) + 31-2-3 (`ok` nullable)** —
 *      `test <name> --connect --json` against LIVE IRIS: the payload reports
 *      which password the probe exercised (the registry profile's, with
 *      provenance) as `attempted:true, ok:true`.
 *   4. **31-2-3 (probe-never-ran)** — a name the credential chain resolves
 *      (via `IRIS_CREDENTIAL_HELPER`) that maps to NO registry profile:
 *      `attempted:false, ok:null` — "never ran" is not "failed".
 *   5. **31-2-4 (create vs replace)** — driven through the BUILT
 *      `dist/cli/credentials.js` module's exported `runCli` with the
 *      documented `KeyringPort` injection seam (an in-memory double). The
 *      real bin has no keychain seam on its argv, so a process-level spawn of
 *      `set` could only exercise this against the REAL OS keychain — which no
 *      test may touch (review directive). Importing the built artifact and
 *      injecting the documented port is the closest honest end-to-end: it
 *      proves the shipped dist wires `exists()` → create/replace messaging.
 *
 * **Keychain note (review directive: no test may touch the real keychain).**
 * Cases 1/2 load the keyring MODULE (the bin's fail-fast `loadKeyring()`)
 * but exit before any account read or write. Case 4's chain performs its
 * normal read-only `getPassword` probe for a deliberately nonexistent,
 * test-unique account before the helper link resolves — the production code
 * path itself; nothing is written and no real credential is reachable. Case 5
 * uses an in-memory `KeyringPort` double. No test reads or writes a real
 * stored credential.
 *
 * **Never fails on a pristine checkout:** an unbuilt `packages/shared/dist`
 * SKIPS with a logged reason; a machine where `@napi-rs/keyring` cannot load
 * skips cases 1/2 (the bin's own "OS keychain is unavailable" exit-1 is the
 * detection signal); the live-IRIS case skips when the instance is
 * unreachable. Credentials come from `IRIS_TEST_*` with the documented local
 * dev defaults (the `31-6-5` convention).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const CREDENTIALS_BIN = path.join(REPO_ROOT, "packages", "shared", "dist", "cli", "credentials-cli.js");
const CREDENTIALS_DIST_MODULE = path.join(
  REPO_ROOT,
  "packages",
  "shared",
  "dist",
  "cli",
  "credentials.js",
);

const IRIS_HOST = process.env.IRIS_TEST_HOST ?? "localhost";
const IRIS_PORT = Number(process.env.IRIS_TEST_PORT ?? 52773);
const IRIS_USERNAME = process.env.IRIS_TEST_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_TEST_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_TEST_NAMESPACE ?? "HSCUSTOM";

/** Test-unique names that can never collide with a real keychain account or profile. */
const CAP_NAME = "qaCliGateCap";
const UTF16_NAME = "qaCliGateUtf16";
const PROFILE_NAME = "qaCliGateProfile";
const CHAIN_ONLY_NAME = "qaCliGateChainOnly";
const REPLACE_NAME = "qaCliGateReplace";

let binSkipReason: string | undefined;
let liveSkipReason: string | undefined;

/** Any HTTP response — even a 401 — proves the IRIS Web Gateway is reachable. */
async function isIrisReachable(): Promise<boolean> {
  try {
    const response = await fetch(`http://${IRIS_HOST}:${IRIS_PORT}/api/atelier/`, {
      signal: AbortSignal.timeout(3000),
    });
    return typeof response.status === "number";
  } catch {
    return false;
  }
}

beforeAll(async () => {
  if (!existsSync(CREDENTIALS_BIN) || !existsSync(CREDENTIALS_DIST_MODULE)) {
    binSkipReason = `packages/shared/dist CLI is not built (run "pnpm turbo run build" first). Looked at: ${CREDENTIALS_BIN}`;
    liveSkipReason = binSkipReason;
    return;
  }
  if (!(await isIrisReachable())) {
    liveSkipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT}/api/atelier/ (set IRIS_TEST_* to point at a live instance).`;
  }
});

/**
 * Child-process env: inherit the ambient env (PATH etc.) minus EVERY IRIS_*
 * variable, then layer the test's explicit values — a developer shell's own
 * suite configuration can never leak into a spawned CLI invocation.
 */
function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && !key.startsWith("IRIS_")) env[key] = value;
  }
  return { ...env, ...extra };
}

interface BinOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn the BUILT bin synchronously with optional piped stdin. */
function runBin(args: string[], options: { input?: Buffer; env?: Record<string, string> }): BinOutcome {
  const result = spawnSync(process.execPath, [CREDENTIALS_BIN, ...args], {
    input: options.input,
    env: options.env ?? childEnv({}),
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout?.toString("utf8") ?? "",
    stderr: result.stderr?.toString("utf8") ?? "",
  };
}

/** True when the bin reported its own keychain-unavailable exit-1 (a pristine machine without the native module). */
function isKeyringUnavailable(outcome: BinOutcome): boolean {
  return outcome.status === 1 && outcome.stderr.includes("OS keychain is unavailable");
}

describe("Story 32.3 QA — iris-mcp-credentials built-bin process gate", () => {
  it("31-2-5: `set --stdin` rejects input past the 64 KiB cap with exit 2 naming the cap", (ctx) => {
    if (binSkipReason) {
      // eslint-disable-next-line no-console
      console.log(`[SKIP] credentials bin gate: ${binSkipReason}`);
      ctx.skip();
      return;
    }
    const outcome = runBin(["set", CAP_NAME, "--stdin"], {
      input: Buffer.alloc(70 * 1024, 0x61),
    });
    if (isKeyringUnavailable(outcome)) {
      // eslint-disable-next-line no-console
      console.log("[SKIP] 31-2-5: @napi-rs/keyring cannot load on this machine (the bin's own exit-1).");
      ctx.skip();
      return;
    }
    expect(outcome.status).toBe(2);
    expect(outcome.stderr).toContain("64 KiB");
    // The failure names the likely cause and never claims a write happened.
    expect(outcome.stderr).toContain("piped in by");
    expect(outcome.stdout).not.toContain("Stored a password");
  });

  it("31-2-6: `set --stdin` rejects UTF-16 input (with and without BOM) with exit 2 naming UTF-16", (ctx) => {
    if (binSkipReason) {
      // eslint-disable-next-line no-console
      console.log(`[SKIP] credentials bin gate: ${binSkipReason}`);
      ctx.skip();
      return;
    }
    const withBom = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hunter22", "utf16le")]);
    const withoutBom = Buffer.from("hunter22", "utf16le");
    for (const [label, input] of [
      ["UTF-16LE with BOM", withBom],
      ["UTF-16LE without BOM", withoutBom],
    ] as const) {
      const outcome = runBin(["set", UTF16_NAME, "--stdin"], { input });
      if (isKeyringUnavailable(outcome)) {
        // eslint-disable-next-line no-console
        console.log("[SKIP] 31-2-6: @napi-rs/keyring cannot load on this machine (the bin's own exit-1).");
        ctx.skip();
        return;
      }
      expect(outcome.status, label).toBe(2);
      expect(outcome.stderr, label).toContain("UTF-16");
      expect(outcome.stdout, label).not.toContain("Stored a password");
    }
  });

  it(
    "31-2-1 + 31-2-3: `test --connect --json` against live IRIS reports attempted/ok/credentialSource for the probed profile",
    (ctx) => {
      if (liveSkipReason) {
        // eslint-disable-next-line no-console
        console.log(`[SKIP] credentials connect gate: ${liveSkipReason}`);
        ctx.skip();
        return;
      }
      const profiles = JSON.stringify({
        [PROFILE_NAME]: {
          host: IRIS_HOST,
          port: IRIS_PORT,
          username: IRIS_USERNAME,
          password: IRIS_PASSWORD,
          namespace: IRIS_NAMESPACE,
        },
      });
      const outcome = runBin(["test", PROFILE_NAME, "--connect", "--json"], {
        env: childEnv({
          IRIS_HOST,
          IRIS_PORT: String(IRIS_PORT),
          IRIS_USERNAME,
          IRIS_PASSWORD,
          IRIS_NAMESPACE,
          IRIS_PROFILES: profiles,
        }),
      });
      expect(outcome.status).toBe(0);
      const payload = JSON.parse(outcome.stdout) as {
        name: string;
        resolved: boolean;
        source: string | null;
        connect?: { attempted: boolean; ok: boolean | null; credentialSource?: string };
      };
      expect(payload.name).toBe(PROFILE_NAME);
      expect(payload.resolved).toBe(true);
      expect(payload.source).toBe("env");
      // 31-2-3: the probe RAN and succeeded — a boolean ok, not null.
      expect(payload.connect?.attempted).toBe(true);
      expect(payload.connect?.ok).toBe(true);
      // 31-2-1: WHICH password the probe exercised is surfaced, with provenance.
      expect(payload.connect?.credentialSource).toBe("env");
      // Secret discipline: the password appears nowhere on either stream.
      expect(outcome.stdout).not.toContain(IRIS_PASSWORD);
      expect(outcome.stderr).not.toContain(IRIS_PASSWORD);
    },
    { timeout: 60000 },
  );

  it("31-2-3: a chain-resolved name mapping to no registry profile reports attempted:false / ok:null (probe never ran)", (ctx) => {
    if (binSkipReason) {
      // eslint-disable-next-line no-console
      console.log(`[SKIP] credentials bin gate: ${binSkipReason}`);
      ctx.skip();
      return;
    }
    const outcome = runBin(["test", CHAIN_ONLY_NAME, "--connect", "--json"], {
      env: childEnv({
        IRIS_HOST,
        IRIS_PORT: String(IRIS_PORT),
        IRIS_USERNAME,
        IRIS_PASSWORD,
        IRIS_NAMESPACE,
        // The chain's helper link resolves a password for ANY name, so the
        // credential check succeeds while the name maps to NO profile —
        // exactly the registry-stage failure 31-2-3 re-shaped.
        IRIS_CREDENTIAL_HELPER: `node -e "process.stdout.write('ChainOnlyPass1234')"`,
      }),
    });
    expect(outcome.status).toBe(1);
    const payload = JSON.parse(outcome.stdout) as {
      resolved: boolean;
      source: string | null;
      connect?: { attempted: boolean; ok: boolean | null; error?: string };
    };
    expect(payload.resolved).toBe(true);
    expect(payload.source).toBe("helper");
    // "Never ran" is distinguishable from "failed": attempted:false, ok:null.
    expect(payload.connect?.attempted).toBe(false);
    expect(payload.connect?.ok).toBeNull();
    expect(payload.connect?.error).toContain("map to a connection profile");
  });

  it("31-2-4: the BUILT dist module's runCli reports create vs replace via the injected KeyringPort (never the real keychain)", async (ctx) => {
    if (binSkipReason) {
      // eslint-disable-next-line no-console
      console.log(`[SKIP] credentials dist-module gate: ${binSkipReason}`);
      ctx.skip();
      return;
    }
    interface KeyringPort {
      setPassword(account: string, password: string): void;
      getPassword(account: string): string | null;
      deleteCredential(account: string): boolean;
      exists(account: string): boolean;
      listCredentials(): { account: string; password: string }[];
    }
    const { runCli } = (await import(pathToFileURL(CREDENTIALS_DIST_MODULE).href)) as {
      runCli: (
        argv: string[],
        deps: {
          loadKeyring?: () => Promise<KeyringPort>;
          stdin?: Readable;
          stdout?: { write(chunk: string): void };
          stderr?: { write(chunk: string): void };
        },
      ) => Promise<number>;
    };

    // In-memory KeyringPort double — the documented injection seam; the real
    // OS keychain is never touched.
    const store = new Map<string, string>();
    const keyring: KeyringPort = {
      setPassword: (account, password) => void store.set(account, password),
      getPassword: (account) => store.get(account) ?? null,
      deleteCredential: (account) => store.delete(account),
      exists: (account) => store.has(account),
      listCredentials: () =>
        [...store.entries()].map(([account, password]) => ({ account, password })),
    };

    const firstOut: string[] = [];
    const firstErr: string[] = [];
    const firstCode = await runCli(["set", REPLACE_NAME, "--stdin"], {
      loadKeyring: async () => keyring,
      stdin: Readable.from(["FirstPass1234\n"]),
      stdout: { write: (chunk) => void firstOut.push(chunk) },
      stderr: { write: (chunk) => void firstErr.push(chunk) },
    });
    expect(firstCode).toBe(0);
    expect(firstOut.join("")).toContain(`Stored a password for "${REPLACE_NAME}"`);
    expect(store.get(REPLACE_NAME)).toBe("FirstPass1234");

    const secondOut: string[] = [];
    const secondErr: string[] = [];
    const secondCode = await runCli(["set", REPLACE_NAME, "--stdin"], {
      loadKeyring: async () => keyring,
      stdin: Readable.from(["SecondPass5678\n"]),
      stdout: { write: (chunk) => void secondOut.push(chunk) },
      stderr: { write: (chunk) => void secondErr.push(chunk) },
    });
    expect(secondCode).toBe(0);
    // 31-2-4: a silent replace is no longer possible — the message says so.
    expect(secondOut.join("")).toContain(`Replaced the existing password for "${REPLACE_NAME}"`);
    expect(store.get(REPLACE_NAME)).toBe("SecondPass5678");
    expect(firstErr.join("") + secondErr.join("")).toBe("");
  });
});
