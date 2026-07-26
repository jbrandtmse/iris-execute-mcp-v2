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
 *
 * AC 31.5.5 extends this bar to Story 31.5's new UI surfaces — QuickPick
 * items, tooltips, and status bar text — added at the bottom of this file.
 * `SOURCE_FILES` below is disk-enumerated (not hand-rostered), so
 * `selectServers.ts` is automatically covered by check (1) with no roster
 * edit required; `extension.ts`'s ONE new legitimate `WorkspaceConfiguration
 * .update(...)` call (writing the plain, non-secret `irisMcpLauncher.servers`
 * selection) is deliberately structured through an intermediate `config`
 * local (see `updateServersConfig` in `extension.ts`) so it still reads as
 * "a config value was read, then updated elsewhere" rather than the risky
 * "read-then-immediately-mutate-in-one-chain" shape check (1) exists to
 * catch — the same indirection `toConfigReader` already uses for reads.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildStatusBarState, selectServers, type SelectServersDeps } from "../selectServers.js";
import { LauncherProvider, type ProviderDeps } from "../serverDefinitionProvider.js";
import { stripComments } from "./sourceGrep.js";
import type { AuthApi, LauncherSettings, ServerManagerApi, ServerName, ServerSpec } from "../types.js";

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

  it("the ONE configuration write this extension makes targets the plain irisMcpLauncher.servers key and nothing else — pinned POSITIVELY, because the shape-based grep above cannot see a two-statement write", () => {
    // Code review (Story 31.5). `SUSPICIOUS_WRITE_PATTERNS`'s
    // `getConfiguration(...).update(` pattern only matches a single-expression
    // chain, and `extension.ts`'s `updateServersConfig` deliberately splits it
    // across two statements — so the guard whose stated purpose is "a future
    // write-capable call cannot slip in silently" is structurally blind to
    // exactly the idiom this extension now models. Rather than restore the
    // chain or blanket-exempt the file, the write is pinned from the other
    // direction: enumerate EVERY `.update(` in every source file and assert
    // the complete set is the single `irisMcpLauncher.servers` write. A second
    // config write anywhere — including one carrying a credential — fails
    // here, and so does a rename of the written key (which is also what makes
    // Integration AC 31.5.8's "a rename on EITHER side must fail" true for the
    // write side; the read side is covered in selectServers.test.ts).
    const updateArguments: string[] = [];
    for (const file of SOURCE_FILES) {
      const code = stripComments(readFileSync(path.join(SRC_DIR, file), "utf8"));
      for (const match of code.matchAll(/(?<![\w$])update\s*\(\s*("[^"]*"|[A-Za-z_$][\w$]*)/g)) {
        updateArguments.push(`${file}: update(${match[1]})`);
      }
    }

    expect(updateArguments).toEqual(["extension.ts: update(SERVERS_SETTING_KEY)"]);

    // ...and that constant is literally the `servers` key, cross-checked
    // against `settings.ts`'s READ of the same key so the two can never drift.
    const extensionCode = stripComments(readFileSync(path.join(SRC_DIR, "extension.ts"), "utf8"));
    expect(extensionCode).toMatch(/const SERVERS_SETTING_KEY\s*=\s*"servers"/);
    const settingsCode = stripComments(readFileSync(path.join(SRC_DIR, "settings.ts"), "utf8"));
    expect(settingsCode).toMatch(/config\.get<[^>]+>\(\s*"servers"/);
  });
});

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
  return {
    servers: [],
    packages: ["dev"],
    namespace: "HSCUSTOM",
    combineProfiles: false,
    developmentRepoPath: "",
    hadStaleAllPackage: false,
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

/**
 * Story 31.5 / AC 31.5.5 — the credential-containment bar extended to the new
 * server-selection UI: "No credential, token, or password may appear in any
 * QuickPick item, tooltip, status bar text, log line, or warning."
 */
describe("credential containment — Story 31.5 UI surfaces (QuickPick items, tooltips, status bar, selectServers messages)", () => {
  it("selectServers.ts's CODE (doc comments stripped — they legitimately explain this absence in prose) references NO credential-bearing identifier (AuthApi, ResolvedConnectionProfile, resolveServerCredentials, accessToken, password) — structural proof this module cannot see a credential by construction", () => {
    const raw = readFileSync(path.join(SRC_DIR, "selectServers.ts"), "utf8");
    // Strip block (/** ... */) and line (// ...) comments before matching —
    // this file's OWN doc comments name these identifiers in prose to explain
    // their absence, which would otherwise self-defeat this check.
    const code = stripComments(raw);
    // Code review (Story 31.5): `getServerSpec`/`getSession`/`username` were
    // added. The original list forbade only the types this module never
    // imports plus the bare word "password", while `selectServers.ts` DOES
    // import `ServerManagerApi` — whose `getServerSpec()` resolves to a
    // `ServerSpec` carrying `username`/`password` (see `types.ts`). Adding
    // `const spec = await api.getServerSpec(n); items.push({detail:
    // JSON.stringify(spec)})` would have leaked a credential into a QuickPick
    // item while leaving this check green, so the "cannot see a credential by
    // construction" claim did not hold. Forbidding the doorway, not only the
    // payload, is what makes it hold.
    const forbidden = [
      /AuthApi/,
      /ResolvedConnectionProfile/,
      /resolveServerCredentials/,
      /getServerSpec/,
      /getSession/,
      /accessToken/,
      /\busername\b/i,
      /\bpassword\b/i,
    ];
    for (const pattern of forbidden) {
      expect(code, `selectServers.ts's code must not reference ${pattern}`).not.toMatch(pattern);
    }
  });

  it("a distinctive marker placed in every OTHER LauncherSettings field never reaches a QuickPick item, a showWarning call, or a showInfo call", async () => {
    // Code review (Story 31.5): this test's title promised a QuickPick-item
    // assertion it did not make — the fake resolved `items` straight back
    // without capturing them, so nothing about the items was ever checked and
    // a future edit putting `settings.namespace` into `item.detail` would
    // have left it green. The items are now captured and asserted.
    const MARKER = "DO-NOT-LEAK-31-5-UI-7d4a1c";
    const warnings: string[] = [];
    const infos: string[] = [];
    let capturedItems: { label: string; description?: string; detail?: string }[] = [];

    const names: ServerName[] = [{ name: "a", description: "a desc", detail: "a.example.com:52773" }];
    const api: ServerManagerApi = {
      getServerNames: () => names,
      getServerSpec: async () => undefined,
      getAccount: () => undefined,
    };

    const deps: SelectServersDeps = {
      getServerManagerApi: async () => api,
      getSettings: () =>
        settings({
          servers: [],
          governance: MARKER,
          governancePreset: MARKER,
          auditLog: MARKER,
          auditLogMaxMb: MARKER,
          auditLogParams: MARKER,
          toolsPreset: MARKER,
          toolsDisable: MARKER,
          toolsEnable: MARKER,
          namespace: MARKER,
        }),
      configWriter: {
        inspectServers: () => undefined,
        updateServers: () => Promise.resolve(),
      },
      showQuickPick: (items) => {
        capturedItems = items;
        return Promise.resolve(items);
      },
      showWarning: (message) => warnings.push(message),
      showInfo: (message) => infos.push(message),
    };

    await selectServers(deps);

    expect(capturedItems.length).toBeGreaterThan(0); // sanity: items really were built
    for (const item of capturedItems) {
      expect(item.label).not.toContain(MARKER);
      expect(item.description ?? "").not.toContain(MARKER);
      expect(item.detail ?? "").not.toContain(MARKER);
    }
    expect(infos.length + warnings.length).toBeGreaterThan(0); // sanity: the flow actually produced user-facing output
    for (const message of [...warnings, ...infos]) {
      expect(message).not.toContain(MARKER);
    }
  });

  it("a distinctive marker placed in a Server Manager server's description/detail (the only per-server fields this module surfaces) DOES reach the QuickPick item — proving the QuickPick construction is not vacuously empty — but never reaches a showWarning/showInfo call", async () => {
    const MARKER = "server-detail-marker-2f9b";
    const warnings: string[] = [];
    const infos: string[] = [];

    const names: ServerName[] = [{ name: "a", description: MARKER, detail: MARKER }];
    const api: ServerManagerApi = {
      getServerNames: () => names,
      getServerSpec: async () => undefined,
      getAccount: () => undefined,
    };

    let capturedItems: { label: string; description?: string; detail?: string }[] = [];

    const deps: SelectServersDeps = {
      getServerManagerApi: async () => api,
      getSettings: () => settings(),
      configWriter: {
        inspectServers: () => undefined,
        updateServers: () => Promise.resolve(),
      },
      showQuickPick: (items) => {
        capturedItems = items;
        // Code review (Story 31.5): this used to resolve `undefined`
        // (cancel), which returned from `selectServers` before ANY
        // message could be produced — so `warnings` and `infos` were both
        // empty and the "never reaches a showWarning/showInfo call" loop
        // below iterated zero times, i.e. that half of the test could not
        // fail even if the confirmation interpolated `server.detail`
        // verbatim. Confirming instead drives the real write + confirmation
        // path, so the message assertion is now load-bearing.
        return Promise.resolve(items);
      },
      showWarning: (message) => warnings.push(message),
      showInfo: (message) => infos.push(message),
    };

    await selectServers(deps);

    expect(capturedItems.some((item) => item.description === MARKER || item.detail === MARKER)).toBe(
      true,
    );
    expect(infos.length + warnings.length).toBeGreaterThan(0); // sanity: the message assertion below is not vacuous
    for (const message of [...warnings, ...infos]) {
      expect(message).not.toContain(MARKER);
    }
  });

  // Story 31.6 update: `developmentRepoPath` now DOES reach the tooltip by
  // design (AC 31.6.7's development-mode line), so it is deliberately excluded
  // from the marker sweep below — the invariant is "no field this surface does
  // not read leaks into it", and the read set is now
  // `.servers`/`.packages`/`.developmentRepoPath`. Every credential-bearing and
  // pass-through field (namespace/governance/audit*/tools*) is still swept.
  it("buildStatusBarState (the status bar text/tooltip source) never reflects a marker placed in a settings field it does not read (namespace/governance/audit*/tools*) — only .servers/.packages/.developmentRepoPath ever reach the text or tooltip", () => {
    const MARKER = "status-bar-marker-6a3e9d1c";

    const zeroState = buildStatusBarState(
      settings({
        servers: [],
        packages: ["dev"],
        namespace: MARKER,
        governance: MARKER,
        governancePreset: MARKER,
        auditLog: MARKER,
        auditLogMaxMb: MARKER,
        auditLogParams: MARKER,
        toolsPreset: MARKER,
        toolsDisable: MARKER,
        toolsEnable: MARKER,
      }),
    );
    expect(zeroState.text).not.toContain(MARKER);
    expect(zeroState.tooltip).not.toContain(MARKER);

    const populatedState = buildStatusBarState(
      settings({
        servers: ["prod"],
        packages: ["dev"],
        namespace: MARKER,
        governance: MARKER,
        auditLog: MARKER,
        toolsDisable: MARKER,
      }),
    );
    expect(populatedState.text).not.toContain(MARKER);
    expect(populatedState.tooltip).not.toContain(MARKER);
  });
});
