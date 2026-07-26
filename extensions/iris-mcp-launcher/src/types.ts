/**
 * Local, minimal mirrors of the shapes this extension consumes from the
 * `@intersystems-community/intersystems-servermanager` extension API and
 * `vscode.authentication`, plus this extension's own domain types.
 *
 * Deliberately independent of a real `vscode` value import: every module that
 * imports from this file (settings, definitions, connection, credentials, env,
 * serverDefinitionProvider) stays unit-testable in a plain Node process by
 * injecting fakes shaped to these interfaces (Dev Notes: "keep unit tests
 * runnable without a VS Code host"). Only `extension.ts` — the real activation
 * entry point — imports the `vscode` module by value and adapts the real API
 * surface onto these interfaces.
 *
 * Verified against `@intersystems-community/intersystems-servermanager@3.10.2`
 * (installed, cross-checked `index.d.ts`) and the working `iris-table-editor`
 * implementation (`ServerConnectionManager.ts`) — see story Dev Notes.
 */

/**
 * An opaque stand-in for `vscode.ConfigurationScope`. Server Manager treats it
 * as a pass-through token (it hands one out on {@link ServerName.scope} and
 * takes the same one back on {@link ServerManagerApi.getServerSpec}), so this
 * extension never inspects it — modelling it as `unknown` keeps every module
 * except `extension.ts` free of a `vscode` value import while still carrying
 * the scope end-to-end.
 */
export type ConfigScope = unknown;

/** Mirrors `IServerName` from the Server Manager API. */
export interface ServerName {
  name: string;
  description: string;
  detail: string;
  /**
   * The configuration scope the name was resolved in. REQUIRED for correctness
   * in a multi-root workspace: a server defined in folder B's settings is
   * reported by `getServerNames()` but is invisible to `getServerSpec(name)`
   * unless the SAME scope is passed back (verified against
   * `@intersystems-community/intersystems-servermanager@3.10.2`'s `index.d.ts`).
   */
  scope?: ConfigScope;
}

/** Mirrors `IWebServerSpec` from the Server Manager API. */
export interface WebServerSpec {
  scheme?: string;
  host: string;
  port: number;
  pathPrefix?: string;
}

/** Mirrors `IServerSpec` from the Server Manager API. */
export interface ServerSpec {
  name: string;
  webServer: WebServerSpec;
  username?: string;
  password?: string;
  description?: string;
}

/** Mirrors `vscode.AuthenticationSessionAccountInformation`. */
export interface AccountInfo {
  id: string;
  label: string;
}

/** Mirrors `vscode.AuthenticationSession` (only the fields this extension reads). */
export interface AuthSession {
  id: string;
  accessToken: string;
  account: AccountInfo;
  scopes: readonly string[];
}

/** Options accepted by {@link AuthApi.getSession}, mirroring `vscode.AuthenticationGetSessionOptions`. */
export interface GetSessionOptions {
  silent?: boolean;
  createIfNone?: boolean;
  account?: AccountInfo;
}

/**
 * The subset of `vscode.authentication` this extension uses — injectable for
 * tests. Return type is `PromiseLike` (not `Promise`) so the REAL
 * `vscode.authentication.getSession` — which returns a `vscode.Thenable`, a
 * `.then`-only type distinct from `Promise` — satisfies this interface
 * without a cast; `Promise<T>` also satisfies `PromiseLike<T>`, so fakes in
 * tests can return an ordinary `Promise.resolve(...)`.
 */
export interface AuthApi {
  getSession(
    providerId: string,
    scopes: readonly string[],
    options: GetSessionOptions,
  ): PromiseLike<AuthSession | undefined>;
}

/**
 * The subset of the Server Manager extension's `ServerManagerAPI` this
 * extension uses. Signatures verified against
 * `@intersystems-community/intersystems-servermanager@3.10.2`'s `index.d.ts`:
 *
 * ```ts
 * getServerNames(scope?, sorted?): IServerName[]
 * getServerSpec(name, scope?, flushCredentialCache?, options?: { hideFromRecents?: boolean }): Promise<IServerSpec | undefined>
 * getAccount(serverSpec): vscode.AuthenticationSessionAccountInformation | undefined
 * ```
 */
export interface ServerManagerApi {
  getServerNames(scope?: ConfigScope, sorted?: boolean): ServerName[];
  getServerSpec(
    name: string,
    scope?: ConfigScope,
    flushCredentialCache?: boolean,
    options?: { hideFromRecents?: boolean },
  ): Promise<ServerSpec | undefined>;
  getAccount(spec: ServerSpec): AccountInfo | undefined;
}

/**
 * Which @iris-mcp suite package a registered definition spawns.
 *
 * Deliberately excludes `"all"` (AC 31.6.5): `@iris-mcp/all` declares no
 * `main`/`bin`/`files` and ships no `dist` — it "contains no source code of
 * its own" (its own README) — so `npx -y @iris-mcp/all` has no executable to
 * run and local mode has no `dist/index.js` to target. It is unspawnable by
 * construction, not by a bug fixable in this extension. See `settings.ts`'s
 * `hadStaleAllPackage` for how a settings.json that still lists `"all"` is
 * handled (one warning, the other selected packages still register).
 */
export type SuitePackageKey = "admin" | "data" | "dev" | "interop" | "ops";

/** A fully-resolved IRIS connection (host/port/https/username/password/namespace) for one named server. */
export interface ResolvedConnectionProfile {
  /** The Server Manager server name this profile came from — also used as the IRIS_PROFILES key. */
  name: string;
  host: string;
  port: number;
  https: boolean;
  username: string;
  password: string;
  namespace: string;
}

/** Parsed `irisMcpLauncher.*` extension settings (see `settings.ts`). */
export interface LauncherSettings {
  /** Server Manager server names to expose. Empty = every server Server Manager currently reports. */
  servers: string[];
  /** Which @iris-mcp suite packages to register. */
  packages: SuitePackageKey[];
  /** Default IRIS_NAMESPACE for every spawned server. */
  namespace: string;
  /** When true, one definition per package covers ALL selected servers via IRIS_PROFILES. */
  combineProfiles: boolean;
  /**
   * Absolute path to a local monorepo checkout of the IRIS MCP suite (AC
   * 31.6.1). `""` (default) ⇒ spawn stays `npx -y @iris-mcp/<pkg>`, byte-
   * identical to Story 31.5. Non-empty ⇒ each definition spawns
   * `node <developmentRepoPath>/packages/<dir>/dist/index.js` instead — see
   * `definitions.ts`'s `PACKAGE_DIR_NAME` for the explicit key->directory map.
   * Development-only: this makes the extension execute an arbitrary local
   * file path the user is trusting (README "Development mode" section).
   */
  developmentRepoPath: string;
  /**
   * `true` when the raw, unfiltered `irisMcpLauncher.packages` array (as
   * literally stored in settings.json) still contains the removed `"all"`
   * meta-package key (AC 31.6.5) — computed in `settings.ts`'s `readSettings`
   * BEFORE the invalid-key filter drops it, so `LauncherProvider` can surface
   * exactly one warning naming the removal without re-reading raw config.
   */
  hadStaleAllPackage: boolean;
  /** Pass-through governance/audit/visibility env — each "" means unset (do not emit the var). */
  governance: string;
  governancePreset: string;
  auditLog: string;
  auditLogMaxMb: string;
  auditLogParams: string;
  toolsPreset: string;
  toolsDisable: string;
  toolsEnable: string;
}
