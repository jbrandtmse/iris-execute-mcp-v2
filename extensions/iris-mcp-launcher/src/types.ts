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

/** Which @iris-mcp suite package a registered definition spawns. */
export type SuitePackageKey = "admin" | "data" | "dev" | "interop" | "ops" | "all";

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
