/**
 * Credential resolution at spawn time (AC 31.4.2, Task 3).
 *
 * Verified call sequence (story Dev Notes; cross-checked against the working
 * `iris-table-editor` implementation, `packages/vscode/src/providers/ServerConnectionManager.ts`):
 *
 *   1. `api.getServerSpec(name)` — may already carry a password.
 *   2. If not: `api.getAccount(spec)`, then `auth.getSession(AUTHENTICATION_PROVIDER,
 *      [name, username], { silent: true, account })`.
 *   3. If no cached session: `auth.getSession(..., { createIfNone: true, account })`.
 *   4. Password is `session.accessToken`. Username fallback chain:
 *      spec username -> `session.scopes[1]` -> `session.account.id`.
 *
 * **User cancellation ARRIVES AS A REJECTION, not as `undefined`.** Verified
 * against the installed `@types/vscode` (`AuthenticationGetSessionOptions`
 * overloads): the `createIfNone: true` overload is declared
 * `Thenable<AuthenticationSession>` — WITHOUT `| undefined` — and its doc
 * comment reads "Rejects if a provider with providerId is not registered, or
 * if the user does not consent to sharing authentication information with the
 * extension." A `!session` check alone is therefore dead code on the real
 * cancel path; the reference implementation this flow was ported from
 * (`iris-table-editor`'s `ServerConnectionManager._getServerSpecWithCredentials`)
 * relies on an enclosing `try/catch` for exactly this reason. Both shapes are
 * handled here so cancellation stays a first-class, non-throwing outcome
 * (`{ status: "cancelled" }`) — never an exception, never a retry loop.
 *
 * Failures from the Server Manager API itself (a malformed
 * `intersystems.servers` entry, an API-shape change) surface as
 * `{ status: "unavailable" }` rather than escaping as a rejected promise.
 *
 * Containment note (AC 31.4.3): no catch block here interpolates the caught
 * error's text into a returned value or message. Third-party error text is
 * outside this extension's control, so it is never forwarded to a
 * user-visible surface where a credential could ride along.
 *
 * This is the ONE path in the whole suite where VS Code SecretStorage-backed
 * credentials are reachable at all (story Dev Notes) — do not attempt to read
 * SecretStorage any other way.
 */
import { AUTHENTICATION_PROVIDER } from "./constants.js";
import { deriveConnection } from "./connection.js";
import type {
  AccountInfo,
  AuthApi,
  AuthSession,
  ConfigScope,
  ResolvedConnectionProfile,
  ServerManagerApi,
  ServerSpec,
} from "./types.js";

export type CredentialResult =
  | { status: "resolved"; profile: ResolvedConnectionProfile; ignoredPathPrefix?: string }
  | { status: "no-spec" }
  | { status: "cancelled" }
  | { status: "unavailable" };

/**
 * Resolve a fully-populated {@link ResolvedConnectionProfile} for one Server
 * Manager server name, prompting for credentials via the authentication
 * provider when needed.
 *
 * Never throws for the "no definition" or "user cancelled" outcomes — both are
 * ordinary, expected results the caller renders as ONE clear message (never an
 * error toast storm, never a retry loop).
 */
export async function resolveServerCredentials(
  api: ServerManagerApi,
  auth: AuthApi,
  serverName: string,
  namespace: string,
  scope?: ConfigScope,
): Promise<CredentialResult> {
  let spec: ServerSpec | undefined;
  try {
    // `hideFromRecents` — this is a programmatic lookup on behalf of an MCP
    // server start, not a user picking a server, so it must not pollute Server
    // Manager's "Recent" list. `scope` carries the multi-root configuration
    // scope the name was enumerated in; without it a server defined in a
    // non-default workspace folder resolves to `undefined` (see types.ts).
    spec = await api.getServerSpec(serverName, scope, undefined, { hideFromRecents: true });
  } catch {
    return { status: "unavailable" };
  }
  if (!spec) {
    return { status: "no-spec" };
  }

  let connection;
  try {
    connection = deriveConnection(spec);
  } catch {
    // A hand-edited `intersystems.servers` entry can violate the declared
    // IWebServerSpec shape (e.g. a missing `webServer` block).
    return { status: "unavailable" };
  }
  const ignoredPathPrefixField =
    connection.ignoredPathPrefix !== undefined
      ? { ignoredPathPrefix: connection.ignoredPathPrefix }
      : {};

  // The spec may already carry a password (e.g. Server Manager resolved it
  // through its own cache) — use it directly, no authentication round-trip.
  if (spec.password) {
    return {
      status: "resolved",
      profile: {
        name: serverName,
        host: connection.host,
        port: connection.port,
        https: connection.https,
        username: spec.username ?? "",
        password: spec.password,
        namespace,
      },
      ...ignoredPathPrefixField,
    };
  }

  let account: AccountInfo | undefined;
  try {
    account = api.getAccount(spec);
  } catch {
    // Account hinting is an optimisation, not a requirement — losing it only
    // means the user may be asked which account to use.
    account = undefined;
  }

  const specUsername = spec.username ?? "";
  const scopes = [serverName, specUsername];

  let session: AuthSession | undefined;
  try {
    session = await auth.getSession(AUTHENTICATION_PROVIDER, scopes, {
      silent: true,
      account,
    });
  } catch {
    // The silent probe also rejects when the provider is not registered yet
    // (Server Manager's auth provider races this call on a cold start). Fall
    // through to the prompting attempt rather than failing outright.
    session = undefined;
  }

  if (!session) {
    try {
      session = await auth.getSession(AUTHENTICATION_PROVIDER, scopes, {
        createIfNone: true,
        account,
      });
    } catch {
      // THE REAL CANCEL PATH: `getSession({ createIfNone: true })` rejects when
      // the user declines. First-class outcome — no throw, no retry.
      return { status: "cancelled" };
    }
  }
  if (!session) {
    // Defensive: a provider that resolves `undefined` instead of rejecting.
    return { status: "cancelled" };
  }

  const finalUsername = specUsername || session.scopes[1] || session.account.id;

  return {
    status: "resolved",
    profile: {
      name: serverName,
      host: connection.host,
      port: connection.port,
      https: connection.https,
      username: finalUsername,
      password: session.accessToken,
      namespace,
    },
    ...ignoredPathPrefixField,
  };
}
