/**
 * Maps a Server Manager `IServerSpec.webServer` block onto the suite's own
 * host/port/https shape (`packages/shared/src/config.ts`'s `loadConfig`
 * defaults: http / localhost / 52773), per story Dev Notes ("Derive
 * webServer.{scheme,host,port} from the spec exactly as the suite's own
 * mapping does").
 */
import type { ServerSpec } from "./types.js";

const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = 52773;
/** Upper bound enforced by the consumer (`loadConfig`: "IRIS_PORT must be a valid port number (1-65535)"). */
const MAX_PORT = 65535;

/** Connection fields derived from a Server Manager spec, plus a dropped-field note. */
export interface DerivedConnection {
  host: string;
  port: number;
  https: boolean;
  /**
   * Set when the spec declares a non-empty, non-root `webServer.pathPrefix`.
   * The suite's `IRIS_*` / `IRIS_PROFILES` env contract
   * (`packages/shared/src/config.ts` / `profiles.ts`'s `ProfileOverride`) has
   * NO path-prefix field today, so it cannot be represented in the synthesized
   * spawn env and is silently dropped unless the caller surfaces this value
   * (the provider does, via a one-time warning — see `serverDefinitionProvider.ts`).
   */
  ignoredPathPrefix?: string;
}

/** Derive host/port/https from a Server Manager spec, applying the suite's own defaults. */
export function deriveConnection(spec: ServerSpec): DerivedConnection {
  // `intersystems.servers` is hand-editable JSON, so treat every field as
  // untrusted regardless of what IWebServerSpec declares — a missing
  // `webServer` block or a non-string `host`/`scheme` must not throw a
  // TypeError out of the (async, unguarded-by-the-editor) resolve path.
  const webServer: Partial<ServerSpec["webServer"]> = spec.webServer ?? {};

  const host =
    typeof webServer.host === "string" && webServer.host.trim() !== ""
      ? webServer.host
      : DEFAULT_HOST;
  const port =
    typeof webServer.port === "number" &&
    Number.isInteger(webServer.port) &&
    webServer.port > 0 &&
    webServer.port <= MAX_PORT
      ? webServer.port
      : DEFAULT_PORT;
  const scheme = typeof webServer.scheme === "string" ? webServer.scheme : "http";
  const https = scheme.trim().toLowerCase() === "https";

  const result: DerivedConnection = { host, port, https };

  const pathPrefix =
    typeof webServer.pathPrefix === "string" ? webServer.pathPrefix.trim() : undefined;
  if (pathPrefix !== undefined && pathPrefix !== "" && pathPrefix !== "/") {
    result.ignoredPathPrefix = pathPrefix;
  }

  return result;
}
