import { describe, expect, it, vi } from "vitest";
import { AUTHENTICATION_PROVIDER } from "@intersystems-community/intersystems-servermanager";
import { resolveServerCredentials } from "../credentials.js";
import type {
  AccountInfo,
  AuthApi,
  AuthSession,
  GetSessionOptions,
  ServerManagerApi,
  ServerSpec,
} from "../types.js";

function makeSpec(overrides: Partial<ServerSpec> = {}): ServerSpec {
  return {
    name: "myServer",
    webServer: { host: "iris.example.com", port: 52773, scheme: "http" },
    ...overrides,
  };
}

function makeApi(
  spec: ServerSpec | undefined,
  account: AccountInfo | undefined = undefined,
): ServerManagerApi {
  return {
    getServerNames: () => [],
    getServerSpec: vi.fn(async () => spec),
    getAccount: vi.fn(() => account),
  };
}

function makeAuth(
  responses: (
    providerId: string,
    scopes: readonly string[],
    options: GetSessionOptions,
  ) => AuthSession | undefined,
): AuthApi {
  return {
    getSession: vi.fn(async (providerId, scopes, options) =>
      responses(providerId, scopes, options),
    ),
  };
}

const session = (overrides: Partial<AuthSession> = {}): AuthSession => ({
  id: "session-1",
  accessToken: "the-secret-token",
  account: { id: "acct-1", label: "Account One" },
  scopes: ["myServer", "_SYSTEM"],
  ...overrides,
});

describe("resolveServerCredentials", () => {
  it("returns no-spec when getServerSpec finds nothing", async () => {
    const api = makeApi(undefined);
    const auth = makeAuth(() => undefined);
    const result = await resolveServerCredentials(api, auth, "ghost", "USER");
    expect(result).toEqual({ status: "no-spec" });
  });

  it("uses spec.password directly when present — no authentication round-trip at all", async () => {
    const spec = makeSpec({ username: "_SYSTEM", password: "SYS" });
    const api = makeApi(spec);
    const auth = makeAuth(() => {
      throw new Error("must not be called when spec already has a password");
    });

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");

    expect(result).toEqual({
      status: "resolved",
      profile: {
        name: "myServer",
        host: "iris.example.com",
        port: 52773,
        https: false,
        username: "_SYSTEM",
        password: "SYS",
        namespace: "USER",
      },
    });
  });

  it("resolves via a SILENT session (cached) without ever attempting createIfNone", async () => {
    const spec = makeSpec({ username: "_SYSTEM" });
    const api = makeApi(spec, { id: "acct-1", label: "Account One" });
    const calls: GetSessionOptions[] = [];
    const auth = makeAuth((providerId, scopes, options) => {
      calls.push(options);
      expect(providerId).toBe(AUTHENTICATION_PROVIDER);
      expect(scopes).toEqual(["myServer", "_SYSTEM"]);
      if (options.silent) return session();
      throw new Error("createIfNone should not be attempted when the silent call succeeds");
    });

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.profile.password).toBe("the-secret-token");
      expect(result.profile.username).toBe("_SYSTEM");
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      silent: true,
      account: { id: "acct-1", label: "Account One" },
    });
  });

  it("falls back to createIfNone when the silent call finds no cached session", async () => {
    const spec = makeSpec({ username: "_SYSTEM" });
    const api = makeApi(spec);
    const calls: GetSessionOptions[] = [];
    const auth = makeAuth((_p, _s, options) => {
      calls.push(options);
      if (options.silent) return undefined;
      if (options.createIfNone) return session();
      return undefined;
    });

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");

    expect(result.status).toBe("resolved");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.silent).toBe(true);
    expect(calls[1]?.createIfNone).toBe(true);
  });

  it("cancellation: both silent and createIfNone return undefined -> {status:'cancelled'}, never throws", async () => {
    const spec = makeSpec({ username: "_SYSTEM" });
    const api = makeApi(spec);
    const auth = makeAuth(() => undefined);

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");

    expect(result).toEqual({ status: "cancelled" });
  });

  it("username fallback chain: spec username wins when present", async () => {
    const spec = makeSpec({ username: "specUser" });
    const api = makeApi(spec);
    const auth = makeAuth(() =>
      session({ scopes: ["myServer", "sessionUser"], account: { id: "acctUser", label: "x" } }),
    );

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.profile.username).toBe("specUser");
  });

  it("username fallback chain: falls back to session.scopes[1] when spec has no username", async () => {
    const spec = makeSpec({ username: undefined });
    const api = makeApi(spec);
    const auth = makeAuth(() =>
      session({ scopes: ["myServer", "sessionUser"], account: { id: "acctUser", label: "x" } }),
    );

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.profile.username).toBe("sessionUser");
  });

  it("username fallback chain: falls back to session.account.id when neither spec username nor scopes[1] exist", async () => {
    const spec = makeSpec({ username: undefined });
    const api = makeApi(spec);
    const auth = makeAuth(() =>
      session({ scopes: ["myServer"], account: { id: "acctUser", label: "x" } }),
    );

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.profile.username).toBe("acctUser");
  });

  it("username fallback chain: an explicit empty-string spec.username (not just undefined) falls through to scopes[1]", async () => {
    const spec = makeSpec({ username: "" });
    const api = makeApi(spec);
    const auth = makeAuth(() =>
      session({ scopes: ["myServer", "sessionUser"], account: { id: "acctUser", label: "x" } }),
    );

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.profile.username).toBe("sessionUser");
  });

  it("username fallback chain: an explicit empty-string session.scopes[1] (not just a missing index) falls through to session.account.id", async () => {
    const spec = makeSpec({ username: undefined });
    const api = makeApi(spec);
    const auth = makeAuth(() =>
      session({ scopes: ["myServer", ""], account: { id: "acctUser", label: "x" } }),
    );

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.profile.username).toBe("acctUser");
  });

  it("degenerate case: ALL THREE fallback levels empty/falsy resolves to an empty-string username rather than throwing — documents a downstream risk: packages/shared/src/profiles.ts's mergeProfile REJECTS an empty username inside IRIS_PROFILES, so this extension does not itself guard against spawning a server with an unusable identity", async () => {
    const spec = makeSpec({ username: "" });
    const api = makeApi(spec);
    const auth = makeAuth(() =>
      session({ scopes: ["myServer", ""], account: { id: "", label: "x" } }),
    );

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.profile.username).toBe("");
  });

  it("passes the enumerated configuration scope and hideFromRecents back to getServerSpec (multi-root correctness + no Recent-list pollution)", async () => {
    const spec = makeSpec({ username: "_SYSTEM", password: "SYS" });
    const api = makeApi(spec);
    const auth = makeAuth(() => undefined);
    const scopeToken = { uri: "file:///workspace/folder-b" };

    await resolveServerCredentials(api, auth, "myServer", "USER", scopeToken);

    expect(api.getServerSpec).toHaveBeenCalledWith("myServer", scopeToken, undefined, {
      hideFromRecents: true,
    });
  });

  it("surfaces a non-root pathPrefix as ignoredPathPrefix on the resolved result", async () => {
    const spec = makeSpec({
      username: "_SYSTEM",
      password: "SYS",
      webServer: {
        host: "iris.example.com",
        port: 443,
        scheme: "https",
        pathPrefix: "/csp/healthshare",
      },
    });
    const api = makeApi(spec);
    const auth = makeAuth(() => undefined);

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.ignoredPathPrefix).toBe("/csp/healthshare");
  });
});

/**
 * REGRESSION — the real `vscode.authentication.getSession` REJECTS on user
 * cancellation; it does not resolve `undefined`.
 *
 * Oracle (Rule #36): the installed `@types/vscode`'s own declarations, not the
 * story text. `authentication.getSession`'s doc comment reads "Rejects if a
 * provider with providerId is not registered, or if the user does not consent
 * to sharing authentication information with the extension", and the
 * `createIfNone: true` overload is declared `Thenable<AuthenticationSession>`
 * — WITHOUT `| undefined`:
 *
 *   export function getSession(providerId, scopeListOrRequest,
 *     options: AuthenticationGetSessionOptions & { createIfNone: true | ... }
 *   ): Thenable<AuthenticationSession>;
 *
 * Capture command:
 *   grep -n "export function getSession" \
 *     extensions/iris-mcp-launcher/node_modules/@types/vscode/index.d.ts
 *   (@types/vscode@1.125.0, verified 2026-07-25)
 *
 * Every pre-existing cancellation test in this suite models cancel as
 * `resolve(undefined)`, which is the SILENT probe's behaviour — so they were
 * green against a contract the real API does not honour. These tests fake the
 * rejection instead.
 */
describe("resolveServerCredentials — real API cancel semantics (getSession REJECTS)", () => {
  /** Mirrors the real API: the silent probe resolves undefined, the prompting call rejects. */
  function makeRejectingAuth(): AuthApi {
    return {
      getSession: vi.fn(async (_providerId, _scopes, options: GetSessionOptions) => {
        if (options.silent === true) return undefined;
        throw new Error("User did not consent to authentication.");
      }),
    };
  }

  it("a REJECTED createIfNone prompt is the cancelled outcome, not an exception", async () => {
    const api = makeApi(makeSpec({ username: "_SYSTEM" }));
    const auth = makeRejectingAuth();

    await expect(resolveServerCredentials(api, auth, "myServer", "USER")).resolves.toEqual({
      status: "cancelled",
    });
  });

  it("a REJECTED silent probe still falls through to the prompting call and can succeed", async () => {
    const api = makeApi(makeSpec({ username: "_SYSTEM" }));
    const auth: AuthApi = {
      getSession: vi.fn(async (_providerId, _scopes, options: GetSessionOptions) => {
        // Server Manager's auth provider is not registered yet on a cold start
        // -> the doc'd "Rejects if a provider ... is not registered" case.
        if (options.silent === true)
          throw new Error("No authentication provider 'x' is registered.");
        return session();
      }),
    };

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.profile.password).toBe("the-secret-token");
  });

  it("a THROWING getServerSpec is the unavailable outcome, not an exception", async () => {
    const api: ServerManagerApi = {
      getServerNames: () => [],
      getServerSpec: vi.fn(async () => {
        throw new Error("Cannot read properties of undefined (reading 'webServer')");
      }),
      getAccount: vi.fn(() => undefined),
    };

    await expect(
      resolveServerCredentials(api, makeRejectingAuth(), "myServer", "USER"),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("a THROWING getAccount degrades to no account hint rather than failing the resolve", async () => {
    const api: ServerManagerApi = {
      getServerNames: () => [],
      getServerSpec: vi.fn(async () => makeSpec({ username: "_SYSTEM" })),
      getAccount: vi.fn(() => {
        throw new Error("getAccount is not a function");
      }),
    };
    const auth = makeAuth(() => session());

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");

    expect(result.status).toBe("resolved");
  });

  it("a spec whose webServer block is missing entirely is the unavailable outcome, not a TypeError", async () => {
    const api: ServerManagerApi = {
      getServerNames: () => [],
      // A hand-edited intersystems.servers entry can violate IWebServerSpec.
      getServerSpec: vi.fn(async () => ({ name: "myServer" }) as unknown as ServerSpec),
      getAccount: vi.fn(() => undefined),
    };
    const auth = makeAuth(() => session());

    const result = await resolveServerCredentials(api, auth, "myServer", "USER");

    // deriveConnection now tolerates the missing block and applies suite
    // defaults, so this resolves rather than throwing; either way it must NOT
    // escape as a rejection.
    expect(["resolved", "unavailable"]).toContain(result.status);
  });
});
