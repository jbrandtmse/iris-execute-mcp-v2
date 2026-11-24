/**
 * Story 44.6 QA, Rule #19 / AD-15: the owner's condition "only when the new setting is used", as FRESH BUILT PROCESSES.
 *
 * With `IRIS_CREDENTIAL_NAME` unset, `""` or whitespace, the built `iris-dev-mcp` process must behave as in 1.1.0
 * even though the fake OS keychain (the `fake-keyring-preload.mjs` route; never the real keychain) holds an entry
 * for EVERY name in play:
 *
 * - (a) a password-less `IRIS_PROFILES` member inherits the `default` profile's password: every request the member's
 *   client sends (told apart by its own namespace in the URL) carries `Basic base64(user:<IRIS_PASSWORD>)`, never the
 *   keychain entry stored under the member's name;
 * - (b) `default` itself without a password exits 1 with the verbatim pre-story `IRIS_PASSWORD ... is required` text
 *   (a password-less member present), and no request reaches IRIS.
 *
 * The oracle can vary (Rule #59): the CONTROL leg turns the opt-in on (`IRIS_CREDENTIAL_NAME=dev1`, empty
 * `IRIS_PASSWORD`), and then the very same member requests carry the keychain entry stored under the member's name,
 * so a leak of the lookup into the unset path would show up as exactly that header.
 *
 * Like the 44.6 process gate it needs fresh dists (locally a stale one skips with a logged reason; on CI it fails).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const USERNAME = "svc44";
const REAL_PASSWORD = "env-password-44.6";
const MEMBER_NAMESPACE = "MEMNS";
const PASSWORD_REQUIRED_TEXT =
  "IRIS_PASSWORD environment variable is required. Set it to the password for the IRIS user.";
/** A stored password for every name the lookup could ask for. */
const KEYCHAIN = {
  "iris-mcp": {
    default: "STORED-default",
    member: "STORED-member",
    dev1: "STORED-dev1",
    [USERNAME]: "STORED-username",
  },
};
const PROFILES = JSON.stringify({ member: { namespace: MEMBER_NAMESPACE } });

const OFF_VALUES: Array<[string, Record<string, string>]> = [
  ["unset", {}],
  ["empty", { IRIS_CREDENTIAL_NAME: "" }],
  ["spaces", { IRIS_CREDENTIAL_NAME: "   " }],
];

let skipReason: string | undefined;
let sdkEsmDir = "";
let bootstrapVersion = "";
let scratch = "";
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
      throw new Error(`The Story 44.6 unset-path process gate may not skip on CI: ${skipReason}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[SKIP] story-44-6 unset-path process gate: ${skipReason}`);
    return;
  }
  sdkEsmDir = sdk as string;
  bootstrapVersion = await shippedBootstrapVersion(REPO_ROOT);
  scratch = mkdtempSync(path.join(tmpdir(), "iris-mcp-44-6-unset-"));
});

afterAll(async () => {
  await Promise.all(openFakes.splice(0).map((fake) => fake.close()));
  if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
});

/** A scratch HOME whose fake keychain file already holds {@link KEYCHAIN}; the preload routes `@napi-rs/keyring` to it. */
function populatedKeychainEnv(): Record<string, string> {
  caseCounter += 1;
  const home = path.join(scratch, `home-${caseCounter}`);
  const keyringFile = path.join(scratch, `keyring-${caseCounter}.json`);
  writeFileSync(keyringFile, JSON.stringify(KEYCHAIN), "utf8");
  const existing = inheritedEnv().NODE_OPTIONS;
  const preload = `--import=${pathToFileURL(FAKE_KEYRING_PRELOAD).href}`;
  return {
    HOME: home,
    USERPROFILE: home,
    FAKE_KEYRING_FILE: keyringFile,
    NODE_OPTIONS: existing === undefined || existing.trim() === "" ? preload : `${existing} ${preload}`,
  };
}

async function startFake(): Promise<Awaited<ReturnType<typeof startFakeIris>>> {
  const fake = await startFakeIris({ bootstrapVersion });
  openFakes.push(fake);
  return fake;
}

const targetOf = (fake: { port: number }, password: string): IrisTarget => ({
  host: "127.0.0.1",
  port: String(fake.port),
  username: USERNAME,
  password,
  namespace: "USER",
});

const basic = (password: string): string => `Basic ${Buffer.from(`${USERNAME}:${password}`).toString("base64")}`;

/**
 * Start the built server (default password per `extraEnv`), call a tool against the `member` profile, and return every
 * `Authorization` header the fake saw, in order. Fails when no request went to the member's namespace (a vacuous run).
 */
async function memberRequestAuthorizations(extraEnv: Record<string, string>, password: string): Promise<string[]> {
  const fake = await startFake();
  const client = await connectSdkClient(
    {
      sdkEsmDir,
      entry: distEntry(REPO_ROOT, "iris-dev-mcp"),
      target: targetOf(fake, password),
      clientName: "story-44-6-unset-gate",
    },
    { IRIS_PROFILES: PROFILES, ...extraEnv },
  );
  try {
    // The call may fail at the fake (it only answers the connection checks); the request it sends is what is observed.
    await client.callTool({ name: "iris_doc_list", arguments: { server: "member" } }).catch(() => undefined);
  } finally {
    await client.close().catch(() => undefined);
  }
  const memberUrls = new Set(
    fake.requests.filter((request) => request.url.includes(`/${MEMBER_NAMESPACE}/`)).map((request) => `${request.method} ${request.url}`),
  );
  expect(memberUrls.size, "the member's client sent a request (the run is not vacuous)").toBeGreaterThan(0);
  // Each client's FIRST request carries Basic auth (the later ones ride its session cookie): the default profile's
  // client sends the first one, the member's client (created lazily by the call above) the second.
  return fake.authorizations.flatMap((entry) => (entry.authorization === undefined ? [] : [entry.authorization]));
}

describe("Story 44.6 QA, Rule #19 (a): a password-less member inherits the default password in a fresh process", () => {
  for (const [label, extra] of OFF_VALUES) {
    it(`${label}: the member's requests carry IRIS_PASSWORD, never the keychain entry stored for its name`, async (ctx) => {
      if (skipReason !== undefined) return ctx.skip();
      const sent = await memberRequestAuthorizations({ ...populatedKeychainEnv(), IRIS_PASSWORD: REAL_PASSWORD, ...extra }, REAL_PASSWORD);
      expect(sent, "[default client, member client]: both Basic headers carry IRIS_PASSWORD").toEqual([
        basic(REAL_PASSWORD),
        basic(REAL_PASSWORD),
      ]);
    }, 60_000);
  }

  it("control: with the opt-in ON (IRIS_CREDENTIAL_NAME=dev1, empty IRIS_PASSWORD) the same member sends the entry stored for its own name", async (ctx) => {
    if (skipReason !== undefined) return ctx.skip();
    const sent = await memberRequestAuthorizations(
      { ...populatedKeychainEnv(), IRIS_PASSWORD: "", IRIS_CREDENTIAL_NAME: "dev1" },
      "",
    );
    expect(sent, "[default client, member client]: each took its own stored entry").toEqual([
      basic("STORED-dev1"),
      basic("STORED-member"),
    ]);
  }, 60_000);
});

describe("Story 44.6 QA: with the opt-in ON, no stored password reaches stderr or any tool result (leak sweep, fresh process)", () => {
  it("stderr at the default (DEBUG) log level and the tool results never carry a keychain password; a member miss logs only its name", async (ctx) => {
    if (skipReason !== undefined) return ctx.skip();
    const fake = await startFake();
    const stderr: string[] = [];
    const client = await connectSdkClient(
      {
        sdkEsmDir,
        entry: distEntry(REPO_ROOT, "iris-dev-mcp"),
        target: targetOf(fake, ""),
        clientName: "story-44-6-leak-sweep",
        onStderr: (chunk) => stderr.push(chunk),
      },
      {
        ...populatedKeychainEnv(),
        IRIS_PASSWORD: "",
        IRIS_CREDENTIAL_NAME: "dev1",
        // `member` has a stored entry, `nokey` has none (its miss is logged by name and keeps the default password).
        IRIS_PROFILES: JSON.stringify({ member: { namespace: MEMBER_NAMESPACE }, nokey: { namespace: "NKNS" } }),
      },
    );
    const results: string[] = [];
    const rosters: string[] = [];
    try {
      for (const args of [{}, { server: "member" }, { server: "nokey" }, { server: "no-such-profile" }]) {
        for (const name of ["iris_server_profiles", "iris_doc_list"]) {
          const result = await client.callTool({ name, arguments: args }).catch((error: unknown) => ({ thrown: String(error) }));
          results.push(JSON.stringify(result));
          if (name === "iris_server_profiles") rosters.push(JSON.stringify(result));
        }
      }
    } finally {
      await client.close().catch(() => undefined);
    }
    const everything = `${stderr.join("")}\n${results.join("\n")}`;
    for (const password of Object.values(KEYCHAIN["iris-mcp"])) {
      expect(everything, `the stored password ${password}`).not.toContain(password);
    }
    // The roster is an allow-list (AD-9): it lists the profiles and does not expose the credential name.
    expect(rosters[0], "the default call lists the profiles").toContain('"member"');
    expect(rosters.join("\n")).not.toMatch(/IRIS_CREDENTIAL_NAME|credentialName/i);
    // Non-vacuity: the capture worked (the miss warning is on stderr, naming the member and the remedy, never a password)
    // and the stored passwords really were in use (the default client sent the dev1 entry).
    expect(stderr.join("")).toContain('IRIS_PROFILES member "nokey"');
    expect(stderr.join("")).toContain("iris-mcp-credentials set nokey");
    expect(fake.authorizations[0]?.authorization).toBe(basic("STORED-dev1"));
  }, 60_000);
});

describe("Story 44.6 QA, Rule #19 (b): default without a password fails with today's text in a fresh process", () => {
  const PASSWORDS: Array<[string, string | undefined]> = [
    ["IRIS_PASSWORD unset", undefined],
    ["IRIS_PASSWORD empty", ""],
  ];
  for (const [offLabel, extra] of OFF_VALUES) {
    for (const [pwLabel, password] of PASSWORDS) {
    it(`IRIS_CREDENTIAL_NAME ${offLabel}, ${pwLabel}, a password-less member present: exit 1 with the literal text, no request`, async (ctx) => {
      if (skipReason !== undefined) return ctx.skip();
      const fake = await startFake();
      const baseEnv: Record<string, string> = { ...inheritedEnv(), ...connectionEnv(targetOf(fake, "x")) };
      delete baseEnv.IRIS_PASSWORD;
      const outcome = await spawnAndWaitForExit(
        distEntry(REPO_ROOT, "iris-dev-mcp"),
        [],
        {
          ...baseEnv,
          ...(password === undefined ? {} : { IRIS_PASSWORD: password }),
          IRIS_PROFILES: PROFILES,
          ...populatedKeychainEnv(),
          ...extra,
        },
        30_000,
      );
      expect(outcome.timedOut).toBe(false);
      expect(outcome.code).toBe(1);
      expect(outcome.stderr).toContain(PASSWORD_REQUIRED_TEXT);
      expect(outcome.stderr).not.toContain("IRIS_CREDENTIAL_NAME");
      expect(outcome.stderr).not.toContain("STORED-");
      expect(fake.requests, "no request reached IRIS").toEqual([]);
    }, 60_000);
    }
  }
});
