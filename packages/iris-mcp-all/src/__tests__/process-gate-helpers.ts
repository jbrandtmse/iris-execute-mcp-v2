/**
 * Shared helpers for the process-level gates in this package: each launches a
 * BUILT server entry point in a fresh Node process and observes how it exits.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Readable } from "node:stream";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";

/**
 * The MCP SDK's ESM build in the pnpm store of the monorepo at `repoRoot`
 * (this package does not depend on the SDK itself), or `undefined` when no
 * installed SDK version has one.
 *
 * @param repoRoot - Absolute path of the monorepo root.
 */
export function resolveSdkEsmDir(repoRoot: string): string | undefined {
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return undefined;
  const candidates = readdirSync(pnpmDir)
    .filter((name) => name.startsWith("@modelcontextprotocol+sdk@"))
    .sort();
  for (const candidate of candidates) {
    const esmDir = path.join(pnpmDir, candidate, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
    if (existsSync(esmDir)) return esmDir;
  }
  return undefined;
}

/**
 * Why a gate that runs a workspace package's built dist cannot trust it
 * (`checkDistFresh`: missing or older than its source), or `undefined` when
 * the dist is fresh.
 *
 * @param repoRoot - Absolute path of the monorepo root.
 * @param pkgDir - The package's directory name under `packages/`.
 */
export function staleDistReason(repoRoot: string, pkgDir: string): string | undefined {
  const fresh = checkDistFresh(path.join(repoRoot, "packages", pkgDir), pkgDir);
  if (!fresh.ok) return fresh.reason;
  if (fresh.skipped) return `${pkgDir} declares no dist/ build output, but this gate runs its built dist.`;
  return undefined;
}

/**
 * Whether the IRIS Web Gateway answers at `host:port`. Any HTTP response,
 * even a 401, proves it is reachable; a network error or a 3-second timeout
 * means it is not.
 *
 * @param host - The IRIS host name.
 * @param port - The IRIS web port.
 */
export async function isIrisReachable(host: string, port: string): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/api/atelier/`, {
      signal: AbortSignal.timeout(3000),
    });
    return typeof response.status === "number";
  } catch {
    return false;
  }
}

/**
 * The test runner's environment for a spawned server: everything it inherits
 * (PATH, and SystemRoot on Windows), minus every variable that configures the
 * suite -- each `IRIS_*` key and `MCP_TRANSPORT` -- and minus each name in
 * `alsoDrop`. Names match case-insensitively, as Windows treats them, so an
 * ambient lowercase `iris_host` is dropped too. A gate layers its own explicit
 * values on top of the result.
 *
 * @param alsoDrop - Further variable names to drop (case-insensitive).
 */
export function inheritedEnv(alsoDrop: readonly string[] = []): Record<string, string> {
  const dropped = new Set(["MCP_TRANSPORT", ...alsoDrop.map((name) => name.toUpperCase())]);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    const upper = key.toUpperCase();
    if (upper.startsWith("IRIS_") || dropped.has(upper)) continue;
    env[key] = value;
  }
  return env;
}

/** How a spawned server process ended. */
export interface SpawnOutcome {
  /** Exit code, or `null` when the process was killed at the timeout. */
  code: number | null;
  /** Everything the process wrote to stderr. */
  stderr: string;
  /** `true` when the process was still alive at the timeout and was killed. */
  timedOut: boolean;
}

/**
 * Spawn a built server entry point directly (no MCP handshake) and wait for it
 * to EXIT on its own -- the shape of a startup failure (the entry point prints
 * "Fatal:" plus the error and exits 1). stdin and stdout are ignored; stderr
 * is collected, and the outcome resolves only once stderr has been read to its
 * end. A process still alive at `timeoutMs` is killed with SIGKILL
 * and reported as `timedOut`, which a fail-fast assertion treats as failure:
 * a violation that does NOT stop startup is exactly the regression such a gate
 * pins.
 *
 * @param entryPoint - Absolute path of the built `index.js` to launch.
 * @param args - Extra command-line arguments passed after the entry point.
 * @param env - The complete child environment (nothing is inherited).
 * @param timeoutMs - Milliseconds to wait before killing the process.
 * @param cwd - Working directory of the child; the parent's when omitted.
 */
export function spawnAndWaitForExit(
  entryPoint: string,
  args: readonly string[],
  env: Record<string, string>,
  timeoutMs: number,
  cwd?: string,
): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entryPoint, ...args], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
      ...(cwd !== undefined ? { cwd } : {}),
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, stderr, timedOut: true });
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, timedOut: false });
    });
  });
}

// -- Live gates: the IRIS target, a wire session and the Atelier oracle -----------

/** Where a live gate reaches IRIS. */
export interface IrisTarget {
  host: string;
  port: string;
  username: string;
  password: string;
  namespace: string;
}

/**
 * The target named by `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD` and
 * `IRIS_NAMESPACE`, each defaulting to the dev instance at localhost:52773 as `_SYSTEM` in HSCUSTOM.
 */
export function irisTargetFromEnv(): IrisTarget {
  return {
    host: process.env.IRIS_HOST ?? "localhost",
    port: process.env.IRIS_PORT ?? "52773",
    username: process.env.IRIS_USERNAME ?? "_SYSTEM",
    password: process.env.IRIS_PASSWORD ?? "SYS",
    namespace: process.env.IRIS_NAMESPACE ?? "HSCUSTOM",
  };
}

/** The connection settings of a spawned server's `default` profile. */
export function connectionEnv(target: IrisTarget): Record<string, string> {
  return {
    IRIS_HOST: target.host,
    IRIS_PORT: target.port,
    IRIS_USERNAME: target.username,
    IRIS_PASSWORD: target.password,
    IRIS_NAMESPACE: target.namespace,
    IRIS_HTTPS: "false",
  };
}

/** A tool result as an MCP client receives it. */
export interface WireToolResult {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

/** One entry of `tools/list`. */
export interface WireTool {
  name: string;
  description?: string;
  inputSchema: { properties?: Record<string, unknown>; required?: string[] };
  annotations?: Record<string, unknown>;
}

interface SdkClient {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  callTool: (params: { name: string; arguments: Record<string, unknown> }) => Promise<WireToolResult>;
  listTools: () => Promise<{ tools: WireTool[] }>;
}

/** A connected client of one spawned server. */
export interface WireSession {
  /** Call a tool on the `default` profile, naming the target namespace. */
  call: (name: string, args: Record<string, unknown>) => Promise<WireToolResult>;
  /** Call a tool on the named profile, naming the target namespace. */
  callOn: (server: string, name: string, args: Record<string, unknown>) => Promise<WireToolResult>;
  /** Call a tool exactly as given (the discovery tool takes no profile argument here). */
  raw: (name: string, args: Record<string, unknown>) => Promise<WireToolResult>;
  listTools: () => Promise<WireTool[]>;
  close: () => Promise<void>;
}

/** What a wire session needs to start a built server and name its target. */
export interface WireSessionOptions {
  /** The MCP SDK's ESM build (see {@link resolveSdkEsmDir}). */
  sdkEsmDir: string;
  /** Absolute path of the built server's `index.js`. */
  entry: string;
  /** The IRIS instance and namespace the server and every call target. */
  target: IrisTarget;
  /** The client name the SDK reports in the handshake. */
  clientName: string;
}

/**
 * Spawn the built server with `extraEnv` on top of the explicit connection settings, and connect an
 * SDK client to it over stdio. The server's startup bootstrap has run before the connection is
 * accepted.
 */
export async function openWireSession(
  options: WireSessionOptions,
  extraEnv: Record<string, string> = {},
): Promise<WireSession> {
  const sdkClientIndex = pathToFileURL(path.join(options.sdkEsmDir, "client", "index.js")).href;
  const sdkClientStdio = pathToFileURL(path.join(options.sdkEsmDir, "client", "stdio.js")).href;
  const { Client } = (await import(sdkClientIndex)) as {
    Client: new (info: { name: string; version: string }) => SdkClient;
  };
  const { StdioClientTransport } = (await import(sdkClientStdio)) as {
    StdioClientTransport: new (params: {
      command: string;
      args: string[];
      env: Record<string, string>;
      stderr: string;
    }) => unknown;
  };

  const transport = new StdioClientTransport({
    command: "node",
    args: [options.entry],
    env: { ...inheritedEnv(), ...connectionEnv(options.target), ...extraEnv },
    stderr: "pipe",
  });
  // The pipe must be drained, or a chatty server blocks on a full stderr buffer.
  (transport as { stderr?: Readable | null }).stderr?.on("data", () => {});

  const namespace = options.target.namespace;
  const client = new Client({ name: options.clientName, version: "0.0.0" });
  await client.connect(transport);
  return {
    call: (name, args) => client.callTool({ name, arguments: { server: "default", namespace, ...args } }),
    callOn: (server, name, args) => client.callTool({ name, arguments: { server, namespace, ...args } }),
    raw: (name, args) => client.callTool({ name, arguments: args }),
    listTools: async () => (await client.listTools()).tools,
    close: () => client.close().catch(() => {}),
  };
}

/** Run `body` with a session whose server was started with `extraEnv`, and always close it. */
export async function withWireSession<T>(
  options: WireSessionOptions,
  extraEnv: Record<string, string>,
  body: (session: WireSession) => Promise<T>,
): Promise<T> {
  const session = await openWireSession(options, extraEnv);
  try {
    return await body(session);
  } finally {
    await session.close();
  }
}

/** One row of an Atelier query result. */
export type AtelierRow = Record<string, unknown>;

/** The `result` of an Atelier response, after its HTTP status and `status.errors` have been checked. */
async function atelierResult(
  target: IrisTarget,
  subpath: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ content?: unknown; ts?: unknown }> {
  const response = await fetch(`http://${target.host}:${target.port}/api/atelier/v1/${target.namespace}/${subpath}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${target.username}:${target.password}`).toString("base64")}`,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if (response.status !== 200) {
    throw new Error(`Atelier ${subpath} answered HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    status?: { errors?: unknown[] };
    result?: { content?: unknown; ts?: unknown };
  };
  const errors = body.status?.errors ?? [];
  if (errors.length > 0) {
    throw new Error(`Atelier ${subpath} reported errors ${JSON.stringify(errors)}`);
  }
  return body.result ?? {};
}

/**
 * The rows the Atelier `action/query` route returns for a statement. This route never goes through
 * the suite's own SQL endpoint, so a gate uses it as an oracle that is independent of the code under
 * test. Throws when the route answers anything but HTTP 200 without errors.
 */
export async function atelierQuery(target: IrisTarget, query: string): Promise<AtelierRow[]> {
  let result: { content?: unknown };
  try {
    result = await atelierResult(target, "action/query", { method: "POST", body: { query } });
  } catch (error: unknown) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}: ${query}`);
  }
  return Array.isArray(result.content) ? (result.content as AtelierRow[]) : [];
}

/** A document as the Atelier `GET /doc` route stores and returns it. */
export interface AtelierDocument {
  /** The version token. */
  ts: string;
  /** The document's lines, as Atelier returns them. */
  content: string[];
}

/**
 * The document `name` (with its extension) as the raw Atelier `GET /doc` route returns it: an oracle
 * for what is stored, independent of the tools under test. Throws when the route answers anything
 * but HTTP 200 without errors, or returns no line array.
 */
export async function atelierDocument(target: IrisTarget, name: string): Promise<AtelierDocument> {
  const result = await atelierResult(target, `doc/${encodeURIComponent(name)}`, { method: "GET" });
  if (!Array.isArray(result.content) || typeof result.ts !== "string") {
    throw new Error(`Atelier doc/${name} returned no line content`);
  }
  return { ts: result.ts, content: result.content as string[] };
}

/** The `BOOTSTRAP_VERSION` the built shared dist embeds: what a built server deploys to IRIS. */
export async function shippedBootstrapVersion(repoRoot: string): Promise<string> {
  const embed = path.join(repoRoot, "packages", "shared", "dist", "bootstrap-classes.js");
  const loaded = (await import(pathToFileURL(embed).href)) as { BOOTSTRAP_VERSION?: unknown };
  if (typeof loaded.BOOTSTRAP_VERSION !== "string" || loaded.BOOTSTRAP_VERSION === "") {
    throw new Error(`${embed} does not export a BOOTSTRAP_VERSION string.`);
  }
  return loaded.BOOTSTRAP_VERSION;
}

/**
 * Assert that the ExecuteMCPv2 classes deployed on the instance are the ones the built shared dist
 * ships, so a gate that drives a built server is not testing some other build.
 *
 * Call it once the gate's first built-server session has connected: that server's startup
 * bootstrap redeploys any deployment whose version differs, so a mismatch after the connection means
 * the deployment is not the shipped embed. The deployed value is read over the raw Atelier route,
 * independently of the bootstrap code that decides the redeploy.
 *
 * @returns The version, once it matches.
 * @throws When the deployed version differs from the shipped one, naming both.
 */
export async function assertDeployedBootstrapVersion(repoRoot: string, target: IrisTarget): Promise<string> {
  const shipped = await shippedBootstrapVersion(repoRoot);
  const rows = await atelierQuery(target, "SELECT ExecuteMCPv2.Setup_GetBootstrapVersion() AS Version");
  const deployed = String(rows[0]?.["Version"] ?? "");
  if (deployed !== shipped) {
    throw new Error(
      `The deployed ExecuteMCPv2 classes report BOOTSTRAP_VERSION "${deployed}" but the shipped embed ` +
        `(packages/shared/dist/bootstrap-classes.js) is "${shipped}", so this gate would test classes ` +
        "other than the shipped ones. Rebuild shared and run a built server against this instance so " +
        "that its bootstrap redeploys them, then rerun the gate.",
    );
  }
  return deployed;
}
