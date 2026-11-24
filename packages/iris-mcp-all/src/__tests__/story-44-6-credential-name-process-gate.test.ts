/**
 * Story 44.6, AC-8 -- the fresh-process proof of `IRIS_CREDENTIAL_NAME` (AD-9; Rules #48 and #59).
 *
 * A fresh BUILT `iris-dev-mcp` process starts with only the non-secret `IRIS_*` settings, `IRIS_PASSWORD=""` and
 * `IRIS_CREDENTIAL_NAME=dev1`, against the fake IRIS listener (`scripts/lib/fake-iris-listener.mjs`, on 127.0.0.1 inside
 * this process). The observable is the `Authorization: Basic ...` header of the server's first request, the warm-up
 * `HEAD /api/atelier/`. The legs:
 *
 * - keychain: a password stored by a REAL `iris-mcp-credentials set dev1 --stdin` process is the one the server sends;
 * - helper: with the keychain unavailable, `IRIS_CREDENTIAL_HELPER` supplies it, and receives `dev1`;
 * - miss: with both empty the process exits 1 naming `IRIS_CREDENTIAL_NAME`, `dev1` and `iris-mcp-credentials set dev1`,
 *   and the fake saw no request;
 * - unset: without the variable the process exits 1 with today's `IRIS_PASSWORD ... is required` text.
 *
 * Nothing reaches the real keychain: every process runs under a scratch HOME with `scripts/lib/fake-keyring-preload.mjs`
 * loaded through NODE_OPTIONS, which routes `@napi-rs/keyring` to a file-backed fake. The first test pins that route
 * (a stored entry lands in the scratch file, not in an OS keychain).
 *
 * Needs no IRIS. It needs fresh dists of `@iris-mcp/shared` and `@iris-mcp/dev` and the built MCP client: locally a
 * missing one skips with a logged reason; on CI (`CI=true`, where every package is built first) it fails.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startFakeIris } from "../../../../scripts/lib/fake-iris-listener.mjs";
import {
  connectionEnv,
  connectSdkClient,
  distEntry,
  inheritedEnv,
  resolveSdkEsmDir,
  shippedBootstrapVersion,
  spawnAndWaitForExit,
  staleDistReason,
  type IrisTarget,
} from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const FAKE_KEYRING_PRELOAD = path.join(REPO_ROOT, "scripts", "lib", "fake-keyring-preload.mjs");
const CREDENTIALS_BIN = path.join(REPO_ROOT, "packages", "shared", "dist", "cli", "credentials-cli.js");

const USERNAME = "svc44";
const CREDENTIAL_NAME = "dev1";
const STORED_PASSWORD = "stored-pw-44.6";
const HELPER_PASSWORD = "helper-pw-44.6";
const PASSWORD_REQUIRED_TEXT =
  "IRIS_PASSWORD environment variable is required. Set it to the password for the IRIS user.";

let skipReason: string | undefined;
let sdkEsmDir = "";
let bootstrapVersion = "";
let scratch = "";
let helperScript = "";
let caseCounter = 0;
const openFakes: Array<Awaited<ReturnType<typeof startFakeIris>>> = [];

beforeAll(async () => {
  skipReason = staleDistReason(REPO_ROOT, "shared") ?? staleDistReason(REPO_ROOT, "iris-dev-mcp");
  const sdk = resolveSdkEsmDir(REPO_ROOT);
  if (skipReason === undefined && sdk === undefined) {
    skipReason = "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm; run pnpm install.";
  }
  if (skipReason === undefined && typeof (await import("node:module")).registerHooks !== "function") {
    skipReason = "This Node has no module.registerHooks (needs >= 22.15), so the fake keyring cannot be preloaded.";
  }
  if (skipReason !== undefined) {
    if (process.env.CI === "true") {
      throw new Error(`The Story 44.6 process gate may not skip on CI, where every package is built first: ${skipReason}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[SKIP] story-44-6 credential-name process gate: ${skipReason}`);
    return;
  }
  sdkEsmDir = sdk as string;
  bootstrapVersion = await shippedBootstrapVersion(REPO_ROOT);
  scratch = mkdtempSync(path.join(tmpdir(), "iris-mcp-44-6-"));
  // The helper prints a password for the one name it is asked about (the name is its final argv entry).
  helperScript = path.join(scratch, "helper.mjs");
  writeFileSync(
    helperScript,
    `process.stdout.write(process.argv[process.argv.length - 1] === ${JSON.stringify(CREDENTIAL_NAME)} ? ${JSON.stringify(HELPER_PASSWORD)} : "");\n`,
    "utf8",
  );
});

afterAll(async () => {
  await Promise.all(openFakes.splice(0).map((fake) => fake.close()));
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
});

/** The scratch HOME, keychain file and NODE_OPTIONS of one case. */
function caseSetup(): { home: string; keyringFile: string; env: Record<string, string> } {
  caseCounter += 1;
  const home = path.join(scratch, `home-${caseCounter}`);
  const keyringFile = path.join(home, "fake-keyring.json");
  const existing = inheritedEnv().NODE_OPTIONS;
  const preload = `--import=${pathToFileURL(FAKE_KEYRING_PRELOAD).href}`;
  return {
    home,
    keyringFile,
    env: {
      HOME: home,
      USERPROFILE: home,
      FAKE_KEYRING_FILE: keyringFile,
      NODE_OPTIONS: existing === undefined || existing.trim() === "" ? preload : `${existing} ${preload}`,
    },
  };
}

async function startFake(): Promise<Awaited<ReturnType<typeof startFakeIris>>> {
  const fake = await startFakeIris({ bootstrapVersion });
  openFakes.push(fake);
  return fake;
}

function targetOf(fake: { port: number }): IrisTarget {
  return { host: "127.0.0.1", port: String(fake.port), username: USERNAME, password: "unused", namespace: "USER" };
}

/**
 * The `Authorization` headers the fake saw on requests that carried one. The first request (the warm-up
 * `HEAD /api/atelier/`) carries Basic auth; later ones may ride the session cookie instead.
 */
function warmUpAuthorizations(fake: { authorizations: Array<{ method: string; url: string; authorization: string | undefined }> }): string[] {
  expect(fake.authorizations[0]?.method, "the first request is the warm-up HEAD").toBe("HEAD");
  expect(fake.authorizations[0]?.url).toBe("/api/atelier/");
  return fake.authorizations.flatMap((entry) => (entry.authorization === undefined ? [] : [entry.authorization]));
}

const basic = (password: string): string => `Basic ${Buffer.from(`${USERNAME}:${password}`).toString("base64")}`;

/** Start the built server with only non-secret settings, `IRIS_PASSWORD=""` and the credential name; resolves once connected. */
async function startServerConnected(
  fake: { port: number },
  extraEnv: Record<string, string>,
): Promise<{ close: () => Promise<void>; serverName: string | undefined }> {
  const client = await connectSdkClient(
    {
      sdkEsmDir,
      entry: distEntry(REPO_ROOT, "iris-dev-mcp"),
      target: targetOf(fake),
      clientName: "story-44-6-gate",
    },
    { IRIS_PASSWORD: "", IRIS_CREDENTIAL_NAME: CREDENTIAL_NAME, ...extraEnv },
  );
  return { close: () => client.close().catch(() => undefined), serverName: client.getServerVersion()?.name };
}

describe("Story 44.6 AC-8: a fresh built server reads its password from the credential chain", () => {
  it("keychain leg: a password stored by a real `iris-mcp-credentials set dev1 --stdin` is the one the server sends", async (ctx) => {
    if (skipReason !== undefined) return ctx.skip();
    const { keyringFile, env } = caseSetup();
    const stored = spawnSync(process.execPath, [CREDENTIALS_BIN, "set", CREDENTIAL_NAME, "--stdin"], {
      input: `${STORED_PASSWORD}\n`,
      env: { ...inheritedEnv(), ...env },
    });
    expect(stored.status, stored.stderr?.toString("utf8")).toBe(0);
    // The store is the scratch file: the fake keyring took the write, not an OS keychain.
    expect(JSON.parse(readFileSync(keyringFile, "utf8"))).toEqual({ "iris-mcp": { [CREDENTIAL_NAME]: STORED_PASSWORD } });

    const fake = await startFake();
    const server = await startServerConnected(fake, env);
    try {
      expect(server.serverName, "the MCP initialize handshake completed").toBeTruthy();
      expect(new Set(warmUpAuthorizations(fake))).toEqual(new Set([basic(STORED_PASSWORD)]));
    } finally {
      await server.close();
    }
  }, 60_000);

  it("helper leg: with the keychain unavailable, IRIS_CREDENTIAL_HELPER supplies the password and receives the name", async (ctx) => {
    if (skipReason !== undefined) return ctx.skip();
    const { env } = caseSetup();
    const fake = await startFake();
    const server = await startServerConnected(fake, {
      ...env,
      FAKE_KEYRING_UNAVAILABLE: "1",
      IRIS_CREDENTIAL_HELPER: `"${process.execPath}" "${helperScript}"`,
    });
    try {
      expect(server.serverName, "the MCP initialize handshake completed").toBeTruthy();
      expect(new Set(warmUpAuthorizations(fake))).toEqual(new Set([basic(HELPER_PASSWORD)]));
    } finally {
      await server.close();
    }
  }, 60_000);

  it("miss leg: an exhausted chain exits 1 naming the variable, the name and the remedy, before any IRIS request", async (ctx) => {
    if (skipReason !== undefined) return ctx.skip();
    const { env } = caseSetup();
    const fake = await startFake();
    const outcome = await spawnAndWaitForExit(
      distEntry(REPO_ROOT, "iris-dev-mcp"),
      [],
      {
        ...inheritedEnv(),
        ...connectionEnv(targetOf(fake)),
        IRIS_PASSWORD: "",
        IRIS_CREDENTIAL_NAME: CREDENTIAL_NAME,
        ...env,
      },
      30_000,
    );
    expect(outcome.timedOut).toBe(false);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain("IRIS_CREDENTIAL_NAME");
    expect(outcome.stderr).toContain(CREDENTIAL_NAME);
    expect(outcome.stderr).toContain(`iris-mcp-credentials set ${CREDENTIAL_NAME}`);
    expect(fake.requests, "no request reached IRIS").toEqual([]);
  }, 60_000);

  it("unset leg: without IRIS_CREDENTIAL_NAME the process exits 1 with today's IRIS_PASSWORD text", async (ctx) => {
    if (skipReason !== undefined) return ctx.skip();
    const { env } = caseSetup();
    const fake = await startFake();
    const outcome = await spawnAndWaitForExit(
      distEntry(REPO_ROOT, "iris-dev-mcp"),
      [],
      { ...inheritedEnv(), ...connectionEnv(targetOf(fake)), IRIS_PASSWORD: "", ...env },
      30_000,
    );
    expect(outcome.timedOut).toBe(false);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain(PASSWORD_REQUIRED_TEXT);
    expect(outcome.stderr).not.toContain("IRIS_CREDENTIAL_NAME");
    expect(fake.requests).toEqual([]);
  }, 60_000);
});
