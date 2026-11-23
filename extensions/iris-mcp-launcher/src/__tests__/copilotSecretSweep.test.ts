/**
 * Story 44.6 QA -- secret containment of PROVIDED definitions under every mode and fallback, through the REAL `extension.ts`.
 *
 * VS Code persists a provided definition (workspace storage, and the Copilot harness's `agentPlugins/*&#47;.mcp.json`), so it must hold
 * no secret in any mode. `containment.test.ts` covers one single-server plan with an inline password. This sweep drives the
 * registered provider (`activate()` -> `provideMcpServerDefinitions`) over EVERY branch of the provide path -- single server,
 * several servers, `combineProfiles`, a spec without a username, a spec `getServerSpec` returns `undefined` or throws for (the
 * thrown error message carries the secret), a spec without `webServer` -- with a distinct secret planted at every place a secret
 * can reach the launcher:
 *
 * - `spec.password` and extra spec fields (`auth`, `oauth2`) that a real Server Manager spec carries,
 * - the Server Manager account label and the authentication session's access token,
 * - the message of an error `getServerSpec` throws.
 *
 * Nothing may appear in the serialised provided definitions (what VS Code persists), in any warning, or in anything written to
 * the console / stdout / stderr; and no session or account is ever requested while providing. A non-vacuity row proves each
 * secret DOES flow through the resolve path (the one place it may), so the sweep can fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";
import { activate, deactivate } from "../extension.js";
import type { ServerManagerApi, ServerSpec } from "../types.js";
import { mockState, resetMockState, McpStdioServerDefinition } from "./vscodeMock.js";

const CONFIG = "irisMcpLauncher";
const SECRETS = {
  inline: "QA-SECRET-INLINE-1d6f0a",
  auth: "QA-SECRET-AUTH-9c4e2b",
  oauth: "QA-SECRET-OAUTH-3a7d58",
  token: "QA-SECRET-TOKEN-b05e91",
  account: "QA-SECRET-ACCOUNT-62c8f3",
  thrown: "QA-SECRET-THROWN-e7149d",
};

function fakeContext(): ExtensionContext {
  return { subscriptions: [] } as unknown as ExtensionContext;
}

async function flushEditor(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A real-shaped spec (the Server Manager one carries more than `ServerSpec` types) with a secret in every secret-bearing field. */
function leakySpec(name: string, overrides: Record<string, unknown> = {}): ServerSpec {
  return {
    name,
    webServer: { host: `${name}.example.com`, port: 52773, scheme: "http" },
    username: "_SYSTEM",
    password: SECRETS.inline,
    auth: { username: "_SYSTEM", password: SECRETS.auth },
    oauth2: { clientSecret: SECRETS.oauth },
    ...overrides,
  } as unknown as ServerSpec;
}

type Mode = {
  label: string;
  settings: Record<string, unknown>;
  names: string[];
  spec: (name: string) => Promise<ServerSpec | undefined>;
  /** What `env` the single/combined definitions must carry (`{}` for a fallback), to prove the branch under test ran. */
  expectEnvKeys: "provided" | "empty";
};

const MODES: Mode[] = [
  { label: "single server", settings: { servers: ["a"] }, names: ["a"], spec: async (n) => leakySpec(n), expectEnvKeys: "provided" },
  { label: "several servers", settings: { servers: [] }, names: ["a", "b"], spec: async (n) => leakySpec(n), expectEnvKeys: "provided" },
  { label: "combineProfiles", settings: { servers: ["a", "b"], combineProfiles: true }, names: ["a", "b"], spec: async (n) => leakySpec(n), expectEnvKeys: "empty" },
  { label: "no username", settings: { servers: ["a"] }, names: ["a"], spec: async (n) => leakySpec(n, { username: undefined }), expectEnvKeys: "empty" },
  { label: "blank username", settings: { servers: ["a"] }, names: ["a"], spec: async (n) => leakySpec(n, { username: "  " }), expectEnvKeys: "empty" },
  { label: "spec undefined", settings: { servers: ["a"] }, names: ["a"], spec: async () => undefined, expectEnvKeys: "empty" },
  { label: "spec without webServer", settings: { servers: ["a"] }, names: ["a"], spec: async (n) => leakySpec(n, { webServer: undefined }), expectEnvKeys: "empty" },
  {
    label: "getServerSpec throws an error carrying a secret",
    settings: { servers: ["a"] },
    names: ["a"],
    spec: async () => {
      throw new Error(`cannot read server a: password ${SECRETS.thrown}`);
    },
    expectEnvKeys: "empty",
  },
];

let stray: string[] = [];

beforeEach(() => {
  resetMockState();
  mockState.configStore.set(`${CONFIG}.servers`, []);
  mockState.configStore.set(`${CONFIG}.packages`, ["dev"]);
  mockState.nextSession = {
    id: "s1",
    accessToken: SECRETS.token,
    account: { id: "acct-1", label: SECRETS.account },
    scopes: ["a", "_SYSTEM"],
  } as typeof mockState.nextSession;
  stray = [];
  for (const channel of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
      stray.push(args.map(String).join(" "));
    });
  }
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stray.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stray.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});

afterEach(() => {
  deactivate();
  vi.restoreAllMocks();
});

function serverManager(mode: Mode): (typeof mockState)["serverManager"] {
  const api: ServerManagerApi = {
    getServerNames: () => mode.names.map((name) => ({ name, description: "", detail: "" })),
    getServerSpec: (name: string) => mode.spec(name),
    getAccount: () => ({ id: "acct-1", label: SECRETS.account }),
  };
  return { isActive: true, activate: async () => undefined, exports: api };
}

async function provide(mode: Mode): Promise<McpStdioServerDefinition[]> {
  for (const [key, value] of Object.entries(mode.settings)) mockState.configStore.set(`${CONFIG}.${key}`, value);
  mockState.serverManager = serverManager(mode);
  activate(fakeContext());
  await flushEditor();
  return (await mockState.mcpProviders[0]!.provider.provideMcpServerDefinitions({
    isCancellationRequested: false,
  })) as unknown as McpStdioServerDefinition[];
}

describe("Story 44.6 QA: no secret reaches a provided definition, a warning or an output stream, in any mode", () => {
  for (const mode of MODES) {
    it(`${mode.label}: nothing persisted, warned or printed carries a planted secret; no session or account is requested`, async () => {
      const defs = await provide(mode);
      expect(defs.length, "the provide path still returns its definitions").toBeGreaterThan(0);

      // The branch under test really ran: a resolvable single server carries the provided env, a fallback keeps `{}`.
      for (const def of defs) {
        const env = (def.env ?? {}) as Record<string, string | null>;
        if (mode.expectEnvKeys === "provided") {
          expect(Object.keys(env), `${mode.label}: provided env`).toEqual(expect.arrayContaining(["IRIS_HOST", "IRIS_CREDENTIAL_NAME"]));
        } else {
          expect(env, `${mode.label}: fallback env`).toEqual({});
        }
      }

      const everything = JSON.stringify({ defs, warnings: mockState.warnings, stray });
      for (const [kind, secret] of Object.entries(SECRETS)) {
        expect(everything, `the ${kind} secret`).not.toContain(secret);
      }
      expect(mockState.getSessionCalls, "providing never asks for a session").toEqual([]);
      expect(mockState.warnings, "providing never warns").toEqual([]);
    });
  }

  it("non-vacuity: a secret DOES reach the resolve path (the one place it may), so the sweep above can fail", async () => {
    const mode = MODES[0]!;
    const defs = await provide(mode);
    // What VS Code serialises and persists is the definition AS PROVIDED, before the resolver runs.
    const persisted = JSON.stringify(defs);
    const resolved = (await mockState.mcpProviders[0]!.provider.resolveMcpServerDefinition(defs[0]!, {
      isCancellationRequested: false,
    })) as McpStdioServerDefinition | undefined;
    expect(JSON.stringify(resolved?.env ?? {})).toContain(SECRETS.inline);
    expect(persisted).not.toContain(SECRETS.inline);
  });
});
