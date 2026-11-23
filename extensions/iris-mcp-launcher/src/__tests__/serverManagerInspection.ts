/**
 * Test fixtures for the user-scope rule (DW-749, DW-752): the `vscode.workspace.getConfiguration("intersystems", scope)
 * .inspect("servers")` result a provider fake hands `LauncherProvider` through `inspectServerManagerServers`, and fakes of
 * what Server Manager and VS Code do with those layers (Rule #54: each fake returns a shape the real system returns).
 *
 * Sources (Story 44.8, P-1; fetched 2026-11-23, nothing read from a real VS Code profile or keychain):
 * - `inspect`: `@types/vscode` 1.125.0 `WorkspaceConfiguration.inspect`: eight optional members, each that layer's whole
 *   `servers` object.
 * - Merge: VS Code 1.147.0 `src/vs/platform/configuration/common/configurationModels.ts` `mergeContents` (:218-228):
 *   two objects merge recursively, key by key; anything else (an array, a scalar) is replaced by the more specific layer.
 * - Server Manager 3.16.0 (tag commit `7fb0df1a9e72013a7643ee002316cc02c6148d22`): `src/api/getServerSpec.ts` reads the
 *   merged `intersystems.servers` view, defaults the scheme to `http` and keeps a `password` only alongside a `username`;
 *   `src/authenticationProvider.ts` keys a session and its stored password by `<serverName>/<userName lowercased>`
 *   (`sessionId`, :47-53), filtering `getSessions` by the positional, case-insensitive scopes `[serverName, userName]`
 *   (:88-112), with no scope, host, port or scheme in the key. `createSession` returns the stored session before it
 *   prompts (:119-158).
 * - `AuthenticationSession`: `@types/vscode` 1.125.0 `index.d.ts:17823-17846`.
 *
 * Server Manager's own `HEAD` session check (it sends the stored password to the merged host, P-2.3) is NOT modelled:
 * the guard makes it unreachable because `getSession` is never called, which the call-count assertions pin.
 */
import type {
  AccountInfo,
  AuthApi,
  AuthSession,
  ConfigScope,
  GetSessionOptions,
  ServerManagerApi,
  ServerManagerServersInspection,
  ServerSpec,
} from "../types.js";

/** Every named server defined in user settings only (no workspace or folder layer). */
export function userScopeServers(names: readonly string[]): ServerManagerServersInspection {
  return { globalValue: Object.fromEntries(names.map((name) => [name, {}])) };
}

type LayerName = keyof ServerManagerServersInspection;

/**
 * The layers a read WITHOUT a language identifier merges, least to most specific. Server Manager's
 * `getConfiguration("intersystems.servers", scope).get(name)` and the launcher's `inspect` both pass a workspace-folder
 * scope (or none) and never a `languageId`, so VS Code fills no `*LanguageValue` layer for them. A fixture that sets a
 * language layer therefore pins only `isUserScopedServer`'s fail-safe rule for that layer, a shape the launcher's own
 * call never receives.
 */
const LAYER_ORDER: readonly LayerName[] = ["defaultValue", "globalValue", "workspaceValue", "workspaceFolderValue"];

/** A layered `inspect("servers")` result from any of the eight documented layers; `undefined` layers are left out. */
export function layeredServers(layers: Partial<Record<LayerName, unknown>>): ServerManagerServersInspection {
  const out: Record<string, unknown> = {};
  for (const [layer, value] of Object.entries(layers)) {
    if (value !== undefined) out[layer] = value;
  }
  return out as ServerManagerServersInspection;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** VS Code's `mergeContents(source, target)`: recursive for two objects, otherwise `target` (a deep clone) replaces. */
function mergeContents(source: Record<string, unknown>, target: Record<string, unknown>): void {
  for (const key of Object.keys(target)) {
    const existing = source[key];
    const incoming = target[key];
    if (Object.hasOwn(source, key) && isPlainObject(existing) && isPlainObject(incoming)) {
      mergeContents(existing, incoming);
      continue;
    }
    source[key] = structuredClone(incoming);
  }
}

/**
 * The spec Server Manager's `getServerSpec(name)` returns for `layers`: the merged entry (every non-language layer that
 * defines `name`, in VS Code's precedence order; see {@link LAYER_ORDER}), with the scheme defaulted to `http` and a
 * `password` kept only with a `username`. `undefined` when no such layer defines the name.
 */
export function mergedSpec(layers: ServerManagerServersInspection, name: string): ServerSpec | undefined {
  const entry: Record<string, unknown> = {};
  let defined = false;
  for (const layer of LAYER_ORDER) {
    const value = layers[layer];
    if (!isPlainObject(value) || !Object.hasOwn(value, name) || !isPlainObject(value[name])) continue;
    mergeContents(entry, value[name] as Record<string, unknown>);
    defined = true;
  }
  if (!defined) return undefined;
  const webServer = isPlainObject(entry["webServer"]) ? entry["webServer"] : {};
  const username = typeof entry["username"] === "string" && entry["username"] !== "" ? entry["username"] : undefined;
  const password = username !== undefined && typeof entry["password"] === "string" ? entry["password"] : undefined;
  return {
    name,
    ...(typeof entry["description"] === "string" ? { description: entry["description"] } : {}),
    webServer: { ...webServer, scheme: (webServer["scheme"] as string | undefined) || "http" } as ServerSpec["webServer"],
    ...(username !== undefined ? { username } : {}),
    ...(password !== undefined ? { password } : {}),
  };
}

/** What a fake Server Manager / authentication provider was asked, for "nothing called" assertions. */
export interface ServerManagerCalls {
  getServerSpec: Array<{ name: string; scope: ConfigScope | undefined }>;
  getAccount: number;
  getSession: Array<{ scopes: readonly string[]; options: GetSessionOptions }>;
  inspect: Array<ConfigScope | undefined>;
}

/**
 * The stored-password store of Server Manager's authentication provider, as the real `vscode.authentication.getSession`
 * resolves it: a session per `<serverName>/<userName lowercased>` (no host, port or scheme in the key). A silent call
 * resolves the stored session or `undefined`; `createIfNone` resolves the stored session without prompting (Server
 * Manager returns the SecretStorage value before it would prompt), else REJECTS (the real cancel shape).
 */
export function sessionStoreAuthApi(
  stored: Readonly<Record<string, string>>,
  calls: ServerManagerCalls,
): AuthApi {
  return {
    getSession: async (_providerId, scopes, options) => {
      calls.getSession.push({ scopes, options });
      const key = `${String(scopes[0])}/${String(scopes[1] ?? "").toLowerCase()}`;
      const accessToken = stored[key];
      if (accessToken !== undefined) {
        const session: AuthSession = {
          id: key,
          accessToken,
          account: { id: String(scopes[1] ?? ""), label: String(scopes[1] ?? "") },
          scopes: [String(scopes[0]), String(scopes[1] ?? "")],
        };
        return session;
      }
      if (options.createIfNone === true) throw new Error("User did not consent to login.");
      return undefined;
    },
  };
}

/**
 * A Server Manager API fake over `layers`: `getServerNames` lists every server a non-language layer defines (each with the
 * optional `scope`), `getServerSpec` returns {@link mergedSpec}, and `getAccount` returns an account hint. Every call is
 * recorded in `calls`.
 */
export function serverManagerOverLayers(
  layers: ServerManagerServersInspection,
  calls: ServerManagerCalls,
  scope?: ConfigScope,
): ServerManagerApi {
  const names = new Set<string>();
  for (const layer of LAYER_ORDER) {
    const value = layers[layer];
    if (isPlainObject(value)) for (const name of Object.keys(value)) names.add(name);
  }
  return {
    getServerNames: () => [...names].map((name) => ({ name, description: "", detail: "", ...(scope !== undefined ? { scope } : {}) })),
    getServerSpec: async (name: string, specScope?: ConfigScope) => {
      calls.getServerSpec.push({ name, scope: specScope });
      return mergedSpec(layers, name);
    },
    getAccount: (spec: ServerSpec): AccountInfo | undefined => {
      calls.getAccount++;
      return { id: `${spec.name}/${spec.username ?? ""}`, label: `${spec.username ?? ""} on ${spec.name}` };
    },
  };
}

/** A fresh call record. */
export function newServerManagerCalls(): ServerManagerCalls {
  return { getServerSpec: [], getAccount: 0, getSession: [], inspect: [] };
}
