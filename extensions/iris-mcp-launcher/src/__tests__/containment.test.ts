/**
 * AC 31.4.3 — credentials exist ONLY in the spawned process env, never
 * written to settings, globalState, workspaceState, or any log/output
 * channel.
 *
 * Two complementary checks:
 *  1. Structural (mechanical, Rule #51-style): grep every non-test source
 *     file for the write-capable calls that WOULD leak a credential if this
 *     extension ever grew one (`globalState`/`workspaceState`/`.update(` on a
 *     `getConfiguration(...)` chain). None of the current modules touch these
 *     APIs at all — `ProviderDeps` (serverDefinitionProvider.ts) doesn't even
 *     expose them — so this also acts as a regression guard: adding such a
 *     call anywhere trips this test immediately, before it could ever reach a
 *     credential.
 *  2. Behavioral: run a REAL resolve flow with a distinctive secret, capture
 *     every `showWarning` call, and assert none contain the secret — while
 *     also asserting the returned env DOES contain it, so the test is not
 *     vacuous (it proves the secret really flowed through this code path).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LauncherProvider, type ProviderDeps } from "../serverDefinitionProvider.js";
import type { AuthApi, LauncherSettings, ServerManagerApi, ServerSpec } from "../types.js";

// __dirname (not import.meta.url) so this file type-checks cleanly under the
// extension's own CommonJS tsconfig.json, not just under vitest's transform.
const SRC_DIR = path.dirname(__dirname);

/**
 * Enumerated from the DIRECTORY, never hand-maintained (project rule #51): a
 * hardcoded roster silently stops covering the one thing it exists to catch —
 * a NEW source file that writes a credential somewhere persistent.
 */
const SOURCE_FILES = readdirSync(SRC_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
  .map((entry) => entry.name)
  .sort();

// Patterns that would indicate a credential/config value is being WRITTEN
// somewhere persistent, rather than only read or handed to the spawned
// process env. Deliberately broad (over-matches "globalState.get" is fine —
// we grep first, then eyeball) so a future write-capable call cannot slip in
// silently.
const SUSPICIOUS_WRITE_PATTERNS = [
  /globalState\s*\.\s*update\s*\(/,
  /workspaceState\s*\.\s*update\s*\(/,
  /getConfiguration\([^)]*\)\s*\.\s*update\s*\(/,
  /\.secrets\s*\.\s*store\s*\(/, // SecretStorage.store — this extension only ever READS credentials, never re-stores them
  // Ad-hoc logging: the ONLY sanctioned output surface is `extension.ts`'s
  // `showWarning`, whose messages are behaviorally proven credential-free
  // below. A stray console/appendLine call elsewhere would bypass that proof.
  /console\s*\.\s*(log|info|warn|error|debug)\s*\(/,
  /appendLine\s*\(/,
  /writeFileSync\s*\(|\.writeFile\s*\(/,
];

/** `extension.ts` owns the one sanctioned output channel, so its `appendLine` is expected. */
const LOGGING_EXEMPT: Record<string, RegExp[]> = {
  "extension.ts": [/appendLine\s*\(/],
};

describe("credential containment — structural (source grep)", () => {
  it("enumerates every non-test source file from disk (the roster cannot go stale)", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(5);
    expect(SOURCE_FILES).toContain("credentials.ts");
    expect(SOURCE_FILES).toContain("serverDefinitionProvider.ts");
  });

  it("no source file calls a globalState/workspaceState/config/.secrets WRITE API, or an unsanctioned log/file-write API", () => {
    const offenders: string[] = [];

    for (const file of SOURCE_FILES) {
      const fullPath = path.join(SRC_DIR, file);
      const text = readFileSync(fullPath, "utf8");
      const exemptions = LOGGING_EXEMPT[file] ?? [];
      for (const pattern of SUSPICIOUS_WRITE_PATTERNS) {
        if (exemptions.some((exempt) => exempt.source === pattern.source)) continue;
        if (pattern.test(text)) {
          offenders.push(`${file}: matched ${pattern}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
  return {
    servers: [],
    packages: ["dev"],
    namespace: "HSCUSTOM",
    combineProfiles: false,
    governance: "",
    governancePreset: "",
    auditLog: "",
    auditLogMaxMb: "",
    auditLogParams: "",
    toolsPreset: "",
    toolsDisable: "",
    toolsEnable: "",
    ...overrides,
  };
}

const SECRET = "DO-NOT-LEAK-4f8c9e7b2a1d";

describe("credential containment — behavioral (secret never reaches a log/warning call)", () => {
  it("a resolved password flows into the returned env but never into any showWarning call, including on the path-prefix warning branch", async () => {
    const warnings: string[] = [];

    const spec: ServerSpec = {
      name: "a",
      webServer: { host: "a.example.com", port: 443, scheme: "https", pathPrefix: "/csp/health" },
      username: "_SYSTEM",
      password: SECRET,
    };

    const api: ServerManagerApi = {
      getServerNames: () => [{ name: "a", description: "", detail: "" }],
      getServerSpec: async () => spec,
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };

    const authApi: AuthApi = {
      getSession: async () => {
        throw new Error("must not be called — spec already carries a password");
      },
    };

    const deps: ProviderDeps = {
      getServerManagerApi: async () => api,
      authApi,
      getSettings: () => settings(),
      showWarning: (message: string) => warnings.push(message),
    };

    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();
    const env = await provider.resolveEnvForLabel(planned!.label);

    // Sanity: the secret DID flow through this code path (not a vacuous test).
    expect(env?.IRIS_PASSWORD).toBe(SECRET);
    // The path-prefix branch fires here (pathPrefix is set) — exactly the
    // branch most likely to accidentally interpolate profile data.
    expect(warnings.length).toBeGreaterThan(0);
    for (const message of warnings) {
      expect(message).not.toContain(SECRET);
    }
  });

  it("a session accessToken (the OAuth-style password) never reaches a showWarning call, including on cancellation", async () => {
    const warnings: string[] = [];

    const spec: ServerSpec = {
      name: "a",
      webServer: { host: "a.example.com", port: 52773, scheme: "http" },
      username: "_SYSTEM",
    };

    const api: ServerManagerApi = {
      getServerNames: () => [{ name: "a", description: "", detail: "" }],
      getServerSpec: async () => spec,
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };

    const authApi: AuthApi = {
      getSession: async () => ({
        id: "s1",
        accessToken: SECRET,
        account: { id: "acct-1", label: "Account One" },
        scopes: ["a", "_SYSTEM"],
      }),
    };

    const deps: ProviderDeps = {
      getServerManagerApi: async () => api,
      authApi,
      getSettings: () => settings(),
      showWarning: (message: string) => warnings.push(message),
    };

    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();
    const env = await provider.resolveEnvForLabel(planned!.label);

    expect(env?.IRIS_PASSWORD).toBe(SECRET);
    for (const message of warnings) {
      expect(message).not.toContain(SECRET);
    }
  });
});

describe("credential containment — a resolved secret must not leak across a LATER resolve for a DIFFERENT definition", () => {
  const LEAKY_SECRET = "DO-NOT-LEAK-CROSS-DEF-9f1e3c7a";

  it("resolving 'leaky' (secret) then resolving a DIFFERENT cancelled server never puts the first secret in a later warning", async () => {
    const warnings: string[] = [];
    const specs: Record<string, ServerSpec | undefined> = {
      leaky: {
        name: "leaky",
        webServer: { host: "leaky.example.com", port: 52773, scheme: "http" },
        username: "_SYSTEM",
        password: LEAKY_SECRET,
      },
      cancelme: {
        name: "cancelme",
        webServer: { host: "c.example.com", port: 52773, scheme: "http" },
        username: "_SYSTEM",
      },
    };
    const api: ServerManagerApi = {
      getServerNames: () => [
        { name: "leaky", description: "", detail: "" },
        { name: "cancelme", description: "", detail: "" },
      ],
      getServerSpec: async (name: string) => specs[name],
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };
    // "leaky" already carries a password (no auth round-trip); "cancelme" has
    // none, so any getSession call belongs to it and always cancels.
    const authApi: AuthApi = { getSession: async () => undefined };

    const deps: ProviderDeps = {
      getServerManagerApi: async () => api,
      authApi,
      getSettings: () => settings({ packages: ["dev"], servers: ["leaky", "cancelme"] }),
      showWarning: (message: string) => warnings.push(message),
    };

    const provider = new LauncherProvider(deps);
    const planned = await provider.providePlannedDefinitions();
    const leakyPlan = planned.find((p) => p.label.includes("leaky"));
    const cancelPlan = planned.find((p) => p.label.includes("cancelme"));
    expect(leakyPlan).toBeDefined();
    expect(cancelPlan).toBeDefined();

    const leakyEnv = await provider.resolveEnvForLabel(leakyPlan!.label);
    expect(leakyEnv?.IRIS_PASSWORD).toBe(LEAKY_SECRET); // sanity: the secret really flowed here first

    const cancelEnv = await provider.resolveEnvForLabel(cancelPlan!.label);
    expect(cancelEnv).toBeUndefined();

    expect(warnings.length).toBeGreaterThan(0);
    for (const message of warnings) {
      expect(message).not.toContain(LEAKY_SECRET);
    }
  });

  it("resolving 'leaky' (secret) then a server removed from Server Manager (no-spec) never leaks the first secret", async () => {
    const warnings: string[] = [];
    const specs: Record<string, ServerSpec | undefined> = {
      leaky: {
        name: "leaky",
        webServer: { host: "leaky.example.com", port: 52773, scheme: "http" },
        username: "_SYSTEM",
        password: LEAKY_SECRET,
      },
      removed: undefined,
    };
    const api: ServerManagerApi = {
      getServerNames: () => [
        { name: "leaky", description: "", detail: "" },
        { name: "removed", description: "", detail: "" },
      ],
      getServerSpec: async (name: string) => specs[name],
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };
    const authApi: AuthApi = {
      getSession: async () => {
        throw new Error(
          "must not be called — 'leaky' has a password, 'removed' has no spec at all",
        );
      },
    };

    const deps: ProviderDeps = {
      getServerManagerApi: async () => api,
      authApi,
      getSettings: () => settings({ packages: ["dev"], servers: ["leaky", "removed"] }),
      showWarning: (message: string) => warnings.push(message),
    };

    const provider = new LauncherProvider(deps);
    const planned = await provider.providePlannedDefinitions();
    const leakyPlan = planned.find((p) => p.label.includes("leaky"));
    const removedPlan = planned.find((p) => p.label.includes("removed"));
    expect(leakyPlan).toBeDefined();
    expect(removedPlan).toBeDefined();

    await provider.resolveEnvForLabel(leakyPlan!.label);
    const removedEnv = await provider.resolveEnvForLabel(removedPlan!.label);
    expect(removedEnv).toBeUndefined();

    expect(warnings.length).toBeGreaterThan(0);
    for (const message of warnings) {
      expect(message).not.toContain(LEAKY_SECRET);
    }
  });

  it("resolving 'leaky' (secret) then Server Manager going unavailable on a LATER resolve of the SAME definition never leaks the earlier secret", async () => {
    const warnings: string[] = [];
    let smAvailable = true;
    const spec: ServerSpec = {
      name: "leaky",
      webServer: { host: "leaky.example.com", port: 52773, scheme: "http" },
      username: "_SYSTEM",
      password: LEAKY_SECRET,
    };
    const api: ServerManagerApi = {
      getServerNames: () => [{ name: "leaky", description: "", detail: "" }],
      getServerSpec: async () => spec,
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };
    const authApi: AuthApi = {
      getSession: async () => {
        throw new Error("must not be called — 'leaky' has a password");
      },
    };

    const deps: ProviderDeps = {
      getServerManagerApi: async () => (smAvailable ? api : undefined),
      authApi,
      getSettings: () => settings({ packages: ["dev"], servers: ["leaky"] }),
      showWarning: (message: string) => warnings.push(message),
    };

    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    const firstEnv = await provider.resolveEnvForLabel(planned!.label);
    expect(firstEnv?.IRIS_PASSWORD).toBe(LEAKY_SECRET);

    smAvailable = false;
    const secondEnv = await provider.resolveEnvForLabel(planned!.label);
    expect(secondEnv).toBeUndefined();

    expect(warnings.length).toBeGreaterThan(0);
    for (const message of warnings) {
      expect(message).not.toContain(LEAKY_SECRET);
    }
  });
});

describe("credential containment — a REJECTED credential prompt must not carry the secret out", () => {
  const THROWN_SECRET = "DO-NOT-LEAK-THROWN-6b2d0a4e";

  it("resolving a secret first, then hitting the real (rejecting) cancel path, never puts the secret — or the third-party error text — in a warning", async () => {
    const warnings: string[] = [];
    const specs: Record<string, ServerSpec | undefined> = {
      leaky: {
        name: "leaky",
        webServer: { host: "leaky.example.com", port: 52773, scheme: "http" },
        username: "_SYSTEM",
        password: THROWN_SECRET,
      },
      rejects: {
        name: "rejects",
        webServer: { host: "r.example.com", port: 52773, scheme: "http" },
        username: "_SYSTEM",
      },
    };
    const api: ServerManagerApi = {
      getServerNames: () => [
        { name: "leaky", description: "", detail: "" },
        { name: "rejects", description: "", detail: "" },
      ],
      getServerSpec: async (name: string) => specs[name],
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };
    // The real API's cancel shape: silent resolves undefined, createIfNone
    // REJECTS. The error message deliberately embeds the secret to prove the
    // extension never forwards caught third-party error text to a user surface.
    const authApi: AuthApi = {
      getSession: async (_p, _s, options) => {
        if (options.silent === true) return undefined;
        throw new Error(`auth failed while handling token ${THROWN_SECRET}`);
      },
    };

    const provider = new LauncherProvider({
      getServerManagerApi: async () => api,
      authApi,
      getSettings: () => settings({ packages: ["dev"], servers: ["leaky", "rejects"] }),
      showWarning: (message: string) => warnings.push(message),
    });

    const planned = await provider.providePlannedDefinitions();
    const leakyPlan = planned.find((p) => p.label.includes("leaky"));
    const rejectPlan = planned.find((p) => p.label.includes("rejects"));

    const leakyEnv = await provider.resolveEnvForLabel(leakyPlan!.label);
    expect(leakyEnv?.IRIS_PASSWORD).toBe(THROWN_SECRET); // sanity: the secret really flowed first

    const rejectedEnv = await provider.resolveEnvForLabel(rejectPlan!.label);
    expect(rejectedEnv).toBeUndefined();

    expect(warnings.length).toBeGreaterThan(0);
    for (const message of warnings) {
      expect(message).not.toContain(THROWN_SECRET);
    }
  });
});

describe("cancellation must not storm: repeated resolves of the same cancelled definition", () => {
  it("produces exactly ONE new warning per call and exactly TWO auth attempts per call (silent + createIfNone) — never accumulating, never retrying beyond one prompt per call", async () => {
    const warnings: string[] = [];
    let sessionCallCount = 0;
    const spec: ServerSpec = {
      name: "a",
      webServer: { host: "a.example.com", port: 52773, scheme: "http" },
      username: "_SYSTEM",
    };
    const api: ServerManagerApi = {
      getServerNames: () => [{ name: "a", description: "", detail: "" }],
      getServerSpec: async () => spec,
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };
    const authApi: AuthApi = {
      getSession: async () => {
        sessionCallCount++;
        return undefined; // user always cancels
      },
    };

    const deps: ProviderDeps = {
      getServerManagerApi: async () => api,
      authApi,
      getSettings: () => settings({ packages: ["dev"], servers: ["a"] }),
      showWarning: (message: string) => warnings.push(message),
    };

    const provider = new LauncherProvider(deps);
    const [planned] = await provider.providePlannedDefinitions();

    for (let call = 1; call <= 3; call++) {
      const env = await provider.resolveEnvForLabel(planned!.label);
      expect(env).toBeUndefined();
      expect(warnings).toHaveLength(call); // linear growth: one new warning per call, never a burst
      expect(sessionCallCount).toBe(call * 2); // silent + createIfNone, no extra retries
    }
  });
});
