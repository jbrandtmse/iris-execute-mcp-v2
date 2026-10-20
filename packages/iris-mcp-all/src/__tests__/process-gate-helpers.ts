/**
 * Shared helpers for the gates in this package. The process-level gates launch a BUILT server entry
 * point in a fresh Node process and observe how it exits; the live gates drive built servers over the
 * MCP SDK client against a disposable fixture and check the result against raw Atelier SQL. The last
 * section holds the helpers that both kinds of gate share: skipping, teardown, fixture clean-up,
 * audit-file polling and local route stubs.
 */

import { spawn } from "node:child_process";
import http from "node:http";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Readable } from "node:stream";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";

/**
 * The ESM build of `@modelcontextprotocol/client` (its `dist/` directory, holding `index.mjs` and
 * `stdio.mjs`) in the pnpm store of the monorepo at `repoRoot`, or `undefined` when no installed
 * client version has one. The client is a devDependency of this package; the servers under test
 * never load it.
 *
 * @param repoRoot - Absolute path of the monorepo root.
 */
export function resolveSdkEsmDir(repoRoot: string): string | undefined {
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return undefined;
  const candidates = readdirSync(pnpmDir)
    .filter((name) => name.startsWith("@modelcontextprotocol+client@"))
    .sort();
  for (const candidate of candidates) {
    const esmDir = path.join(pnpmDir, candidate, "node_modules", "@modelcontextprotocol", "client", "dist");
    if (existsSync(path.join(esmDir, "index.mjs")) && existsSync(path.join(esmDir, "stdio.mjs"))) return esmDir;
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

/** One entry of `prompts/list`. */
export interface WirePrompt {
  name: string;
  title?: string;
  arguments?: Array<{ name: string; required?: boolean }>;
}

/** A rendered prompt as `prompts/get` returns it. */
export interface WirePromptResult {
  messages: Array<{ role: string; content: { type: string; text?: string } }>;
}

/** A `prompts/get` request: `arguments` is sent exactly as given, so an omitted one stays omitted on the wire. */
export interface WirePromptRequest {
  name: string;
  arguments?: Record<string, string>;
}

/** The part of the SDK client that the gates drive. */
export interface SdkClient {
  connect: (transport: unknown) => Promise<void>;
  close: () => Promise<void>;
  /** `arguments` is sent exactly as given, so an omitted one stays omitted on the wire. */
  callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<WireToolResult>;
  listTools: () => Promise<{ tools: WireTool[] }>;
  listPrompts: () => Promise<{ prompts: WirePrompt[] }>;
  getPrompt: (params: WirePromptRequest) => Promise<WirePromptResult>;
  listResources: () => Promise<{ resources: Array<Record<string, unknown>> }>;
  listResourceTemplates: () => Promise<{ resourceTemplates: Array<Record<string, unknown>> }>;
  readResource: (params: { uri: string }) => Promise<{ contents: Array<Record<string, unknown>> }>;
  getServerCapabilities: () => Record<string, unknown> | undefined;
  getServerVersion: () => { name: string; version: string } | undefined;
  getInstructions: () => string | undefined;
  getNegotiatedProtocolVersion: () => string | undefined;
  /** Send a request exactly as given. Unlike the typed methods above, it is not skipped for a capability the server never advertised. */
  request: (request: { method: string; params?: Record<string, unknown> }) => Promise<unknown>;
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
  listPrompts: () => Promise<WirePrompt[]>;
  /** Render a prompt; a refusal rejects with the SDK's error (its `code` is the JSON-RPC error code). */
  getPrompt: (request: WirePromptRequest) => Promise<WirePromptResult>;
  /**
   * Send a request exactly as given and resolve with the raw result. The typed methods above skip the request for a capability the
   * server never advertised (`listPrompts` on a server without prompts answers an empty list); this one always sends it, so the
   * server's own answer is what rejects.
   */
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
}

/** What a wire session needs to start a built server and name its target. */
export interface WireSessionOptions {
  /** The MCP client's ESM build (see {@link resolveSdkEsmDir}). */
  sdkEsmDir: string;
  /** Absolute path of the built server's `index.js`. */
  entry: string;
  /** The IRIS instance and namespace the server and every call target. */
  target: IrisTarget;
  /** The client name the SDK reports in the handshake. */
  clientName: string;
  /** Receives each chunk the server writes to stderr (its log); omitted, the chunks are discarded. */
  onStderr?: (chunk: string) => void;
}

/**
 * Spawn the built server with `extraEnv` on top of the explicit connection settings, and connect the
 * SDK client to it over stdio in its legacy mode (the plain 2025-11-25 connect: no probe and no
 * 2026-07-28 headers). Resolves with the connected client; the caller closes it.
 */
export async function connectSdkClient(
  options: WireSessionOptions,
  extraEnv: Record<string, string> = {},
): Promise<SdkClient> {
  const sdkClientIndex = pathToFileURL(path.join(options.sdkEsmDir, "index.mjs")).href;
  const sdkClientStdio = pathToFileURL(path.join(options.sdkEsmDir, "stdio.mjs")).href;
  const { Client } = (await import(sdkClientIndex)) as {
    Client: new (info: { name: string; version: string }, options: { versionNegotiation: { mode: "legacy" } }) => SdkClient;
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
  (transport as { stderr?: Readable | null }).stderr?.on("data", (chunk: Buffer | string) => {
    options.onStderr?.(chunk.toString());
  });

  const client = new Client({ name: options.clientName, version: "0.0.0" }, { versionNegotiation: { mode: "legacy" } });
  await client.connect(transport);
  return client;
}

/**
 * {@link connectSdkClient} behind the session interface the gates use. The server's startup
 * bootstrap has run before the connection is accepted.
 */
export async function openWireSession(
  options: WireSessionOptions,
  extraEnv: Record<string, string> = {},
): Promise<WireSession> {
  const client = await connectSdkClient(options, extraEnv);
  const namespace = options.target.namespace;
  return {
    call: (name, args) => client.callTool({ name, arguments: { server: "default", namespace, ...args } }),
    callOn: (server, name, args) => client.callTool({ name, arguments: { server, namespace, ...args } }),
    raw: (name, args) => client.callTool({ name, arguments: args }),
    listTools: async () => (await client.listTools()).tools,
    listPrompts: async () => (await client.listPrompts()).prompts,
    getPrompt: (request) => client.getPrompt(request),
    request: (method, params = {}) => client.request({ method, params }),
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

/** The headers of a raw JSON request to the target: the content type and its Basic credentials. */
function rawJsonHeaders(target: IrisTarget): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(`${target.username}:${target.password}`).toString("base64")}`,
  };
}

/** The `result` of an Atelier response, after its HTTP status and `status.errors` have been checked. */
async function atelierResult(
  target: IrisTarget,
  subpath: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ content?: unknown; ts?: unknown }> {
  const response = await fetch(`http://${target.host}:${target.port}/api/atelier/v1/${target.namespace}/${subpath}`, {
    method: init.method,
    headers: rawJsonHeaders(target),
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

/** A raw HTTP answer: its status and its body text, byte for byte. */
export interface RawPostResult {
  status: number;
  text: string;
}

/**
 * POST `body` as JSON to the ExecuteMCPv2 REST service at `path` (for example `/interop/message/resend`)
 * and return the HTTP status and the raw response text. The request goes straight to the route, past
 * every MCP-layer check, so it exercises the handler's own guards; it uses the same credentials as
 * {@link atelierQuery}.
 *
 * @param target - The IRIS instance to call.
 * @param path - The route below `/api/executemcp/v2`, with its leading slash.
 * @param body - The JSON request body.
 */
export async function executeMcpPost(target: IrisTarget, path: string, body: unknown): Promise<RawPostResult> {
  const response = await fetch(`http://${target.host}:${target.port}/api/executemcp/v2${path}`, {
    method: "POST",
    // Without an explicit value, fetch sends `Accept-Language: *`, which IRIS resolves to its
    // alphabetically first locale; the suite's own client pins this same English value.
    headers: { ...rawJsonHeaders(target), "Accept-Language": "en-US,en;q=0.9" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  return { status: response.status, text: await response.text() };
}

/** A raw HTTP answer whose body was also parsed as JSON. */
export interface RawIrisAnswer {
  status: number;
  /** The body text, byte for byte. */
  text: string;
  /** The body parsed as JSON; `undefined` when it is not JSON. */
  json: unknown;
}

/**
 * A raw GET or POST of any path of the target (for example `/api/atelier/v8/HSCUSTOM/action/search?query=x`)
 * with the credentials of {@link atelierQuery}, whatever the answer's status: unlike the Atelier helpers it
 * never throws on a non-200 answer, so a gate can read the status of a request the suite's own client now turns
 * into an error. It is an oracle independent of the code under test.
 *
 * @param target - The IRIS instance to call.
 * @param urlPath - The path (and query string) below the web port, with its leading slash.
 * @param init - The method, for a POST the JSON body, and the `Accept-Language` header (the suite's own
 *   English value when omitted; IRIS reads the message language of each request from it).
 */
export async function rawIrisRequest(
  target: IrisTarget,
  urlPath: string,
  init: { method: "GET" | "POST"; body?: unknown; acceptLanguage?: string },
): Promise<RawIrisAnswer> {
  const response = await fetch(`http://${target.host}:${target.port}${urlPath}`, {
    method: init.method,
    headers: { ...rawJsonHeaders(target), "Accept-Language": init.acceptLanguage ?? "en-US,en;q=0.9" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, text, json };
}

/** Document fixtures written and compiled through one tool session. */
export interface DocFixtures {
  /** Replace the document `docName` with `source` (removing any earlier copy first). */
  putDoc: (docName: string, source: string) => Promise<void>;
  /** Compile `docName` and require success. */
  compileDoc: (docName: string) => Promise<void>;
  /** Remove `docName`; a document that is not there is not an error. */
  removeDoc: (docName: string) => Promise<void>;
}

/**
 * The document helpers of a gate, bound to one dev-server session. Each call names the session's
 * namespace unless `namespace` says otherwise.
 *
 * @param session - A session on a built iris-dev-mcp server.
 * @param namespace - The namespace the documents live in; the session's own when omitted.
 */
export function docFixtures(session: WireSession, namespace?: string): DocFixtures {
  const where: Record<string, unknown> = namespace === undefined ? {} : { namespace };
  const failure = (what: string, result: WireToolResult): Error =>
    new Error(`${what}: ${result.content?.[0]?.text ?? "no content"}`);
  const removeDoc = async (docName: string): Promise<void> => {
    await session.call("iris_doc_delete", { name: docName, ...where });
  };
  return {
    removeDoc,
    putDoc: async (docName, source) => {
      await removeDoc(docName);
      const result = await session.call("iris_doc_put", { name: docName, content: source, ...where });
      if (result.isError) throw failure(`creating ${docName}`, result);
    },
    compileDoc: async (docName) => {
      const result = await session.call("iris_doc_compile", { doc: docName, ...where });
      if (result.isError || (result.structuredContent as { success?: unknown } | undefined)?.success !== true) {
        throw failure(`compiling ${docName}`, result);
      }
    },
  };
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
        "other than the shipped ones. The gate's own built server has connected, and its startup bootstrap " +
        "redeploys a deployment whose version differs, so that bootstrap failed or did not run. Its report " +
        "goes to the server's stderr, which the gate does not show: start the built server by hand against " +
        "this instance to read it, fix the cause, then rerun the gate.",
    );
  }
  return deployed;
}

// -- Helpers the live and process gates share ---------------------------------------

/** What a gate needs of a vitest test context to skip itself. */
export interface SkippableContext {
  skip: () => void;
}

/** The built entry point (`dist/index.js`) of the workspace package `pkg`. */
export function distEntry(repoRoot: string, pkg: string): string {
  return path.join(repoRoot, "packages", pkg, "dist", "index.js");
}

/** Log `[SKIP] <tag>: <reason>`, then mark the running test skipped. */
export function skipTest(tag: string, reason: string | undefined, ctx: SkippableContext): void {
  // eslint-disable-next-line no-console
  console.log(`[SKIP] ${tag}: ${reason}`);
  ctx.skip();
}

/** Mark the running test skipped when `reason` is set, with no log line; `true` when it was skipped. */
export function skipIfReason(reason: string | undefined, ctx: SkippableContext): boolean {
  if (!reason) return false;
  ctx.skip();
  return true;
}

/** A teardown that runs every step even when an earlier one failed, and what went wrong. */
export interface TeardownRecorder {
  /** One line per failed step, `<what>: <message>`. */
  problems: string[];
  /** Run `step`; a failure is recorded in `problems` instead of thrown. */
  attempt: (what: string, step: () => Promise<void>) => Promise<void>;
}

/** A fresh {@link TeardownRecorder}. */
export function teardownRecorder(): TeardownRecorder {
  const problems: string[] = [];
  return {
    problems,
    attempt: async (what, step) => {
      try {
        await step();
      } catch (error) {
        problems.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

/** The text of a tool result's first content block, or `""`. */
export function firstText(result: { content?: Array<{ text?: string }> }): string {
  return result.content?.[0]?.text ?? "";
}

/** The text of every content block of a tool result, joined by newlines. */
export function allText(result: { content?: Array<{ text?: string }> }): string {
  return (result.content ?? []).map((block) => block.text ?? "").join("\n");
}

/** The `id` of each header row, as a number. */
export function headerIds(rows: Array<Record<string, unknown>>): number[] {
  return rows.map((row) => Number(row["id"]));
}

/**
 * The names of the documents (generated ones included) whose name matches each of `filters`, in the
 * order given. Throws when a listing is refused or returns no `items` array.
 *
 * @param session - A session on a built iris-dev-mcp server (`iris_doc_list`).
 */
export async function fixtureDocumentNames(
  session: WireSession,
  filters: readonly string[],
): Promise<Array<{ filter: string; names: string[] }>> {
  const listings: Array<{ filter: string; names: string[] }> = [];
  for (const filter of filters) {
    const listed = await session.call("iris_doc_list", { filter, generated: true });
    const items = (listed.structuredContent as { items?: Array<{ name: string }> } | undefined)?.items;
    if (listed.isError || !Array.isArray(items)) {
      throw new Error(`the ${filter} document listing: ${firstText(listed) || "no items"}`);
    }
    listings.push({ filter, names: items.map((item) => item.name) });
  }
  return listings;
}

/** The documents and globals whose names hold one fixture stem, and a way to kill the globals. */
export interface StemFixtures {
  /** The names of the documents (generated ones included) that match the stem. */
  documents: () => Promise<string[]>;
  /** The globals that match the stem, as `iris_global_list` names them. */
  globals: () => Promise<string[]>;
  /** Kill every listed global that is an `ExecuteMCPv...` global holding the stem; any other is left alone. */
  killGlobals: () => Promise<void>;
}

/**
 * The fixture oracles and cleanup of a gate whose fixtures all carry `stem` in their names.
 *
 * @param session - A session on a built iris-dev-mcp server.
 * @param stem - The name fragment every fixture of the gate carries.
 */
export function stemFixtures(session: WireSession, stem: string): StemFixtures {
  const documents = async (): Promise<string[]> => {
    const listed = await session.call("iris_doc_list", { filter: stem, generated: true });
    const items = (listed.structuredContent as { items?: Array<{ name: string }> } | undefined)?.items;
    if (listed.isError || !Array.isArray(items)) throw new Error(`the document listing: ${firstText(listed) || "no items"}`);
    return items.map((item) => item.name);
  };
  const globals = async (): Promise<string[]> => {
    const listed = await session.call("iris_global_list", { filter: stem });
    const names = (listed.structuredContent as { globals?: string[] } | undefined)?.globals;
    if (listed.isError || !Array.isArray(names)) throw new Error(`the global listing: ${firstText(listed) || "no globals"}`);
    return names;
  };
  const killGlobals = async (): Promise<void> => {
    for (const listed of await globals()) {
      const name = listed.replace(/^\^/, "");
      if (!name.startsWith("ExecuteMCPv") || !name.includes(stem)) continue;
      const killed = await session.call("iris_global_kill", { global: name });
      if (killed.isError) throw new Error(`killing global ${name}: ${firstText(killed)}`);
    }
  };
  return { documents, globals, killGlobals };
}

/** The 1-based number of the first line of `content` equal to `line`. Throws when there is none. */
export function lineNumber(content: string[], line: string): number {
  const index = content.indexOf(line);
  if (index < 0) throw new Error(`the stored document has the line ${JSON.stringify(line)}`);
  return index + 1;
}

/** The 1-based first and last line of the first Storage definition (`Storage <name>` to its closing `}`), or `undefined`. */
export function storageRange(content: string[]): { first: number; last: number } | undefined {
  const start = content.findIndex((line) => /^Storage \S+$/.test(line));
  return start < 0 ? undefined : { first: start + 1, last: content.indexOf("}", start) + 1 };
}

/** The first column of the first row of an Atelier `action/query` result, as a number. */
export async function atelierScalar(target: IrisTarget, query: string): Promise<number> {
  const rows = await atelierQuery(target, query);
  return Number(Object.values(rows[0] ?? {})[0]);
}

/** The governance policy and where each verdict came from, as `iris_server_profiles` reports them. */
export interface GovernanceReport {
  policy: Record<string, boolean>;
  configSource: Record<string, string>;
}

/**
 * The governance report of `iris_server_profiles`, read through `session.raw` (the tool takes no profile
 * argument). Throws when the call is refused.
 */
export async function governanceReport(session: WireSession): Promise<GovernanceReport> {
  const result = await session.raw("iris_server_profiles", {});
  if (result.isError) throw new Error(`iris_server_profiles: ${firstText(result)}`);
  const governance = (result.structuredContent as { governance: GovernanceReport }).governance;
  return { policy: governance.policy, configSource: governance.configSource };
}

/** The structured content of a call refused because the governance policy disables `action`. */
export function governanceDenial(action: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { code: "GOVERNANCE_DISABLED", action, server: "default", ...extra };
}

/** An answer of an ExecuteMCPv2 route: the HTTP status, the raw text, the envelope's error texts and its `result`. */
export interface EnvelopeAnswer {
  status: number;
  text: string;
  errors: string[];
  result: Record<string, unknown>;
}

/**
 * POST `body` to the ExecuteMCPv2 route at `path` and parse the response envelope (see
 * {@link executeMcpPost}). Throws when the text is not JSON.
 */
export async function postEnvelope(target: IrisTarget, path: string, body: unknown): Promise<EnvelopeAnswer> {
  const answer = await executeMcpPost(target, path, body);
  const parsed = JSON.parse(answer.text) as {
    status: { errors?: Array<{ error: string }> };
    result: Record<string, unknown>;
  };
  return {
    status: answer.status,
    text: answer.text,
    errors: (parsed.status.errors ?? []).map((entry) => entry.error),
    result: parsed.result,
  };
}

/**
 * Call the class method `className.methodName(...args)` in `namespace` through `iris_execute_classmethod`
 * and return its string result. Throws when the call is refused.
 *
 * @param session - A session on a built iris-dev-mcp server.
 */
export async function irisClassMethod(
  session: WireSession,
  namespace: string,
  className: string,
  methodName: string,
  args: unknown[],
): Promise<string> {
  const result = await session.call("iris_execute_classmethod", { namespace, className, methodName, args });
  if (result.isError) throw new Error(`${className}.${methodName}: ${allText(result)}`);
  return String((result.structuredContent as { returnValue?: unknown } | undefined)?.returnValue ?? "");
}

/** A wire session that writes an audit file and keeps what the server wrote to stderr. */
export interface AuditedSession {
  session: WireSession;
  /** Everything the server has written to stderr so far. */
  stderr: () => string;
  /** The audit file the server writes (`IRIS_AUDIT_LOG`). */
  auditFile: string;
}

/** {@link WireSessionOptions} plus the audit file the server is told to write. */
export interface AuditedSessionOptions extends WireSessionOptions {
  auditFile: string;
}

/**
 * {@link openWireSession} with `IRIS_AUDIT_LOG` set to `options.auditFile`, `IRIS_AUDIT_LOG_PARAMS=true`
 * and `LOG_LEVEL=DEBUG` (each overridable through `extraEnv`), keeping the server's stderr. An
 * `onStderr` in `options` still receives every chunk.
 */
export async function openAuditedSession(
  options: AuditedSessionOptions,
  extraEnv: Record<string, string> = {},
): Promise<AuditedSession> {
  const { auditFile, onStderr, ...wire } = options;
  let stderr = "";
  const session = await openWireSession(
    {
      ...wire,
      onStderr: (chunk) => {
        stderr += chunk;
        onStderr?.(chunk);
      },
    },
    { IRIS_AUDIT_LOG: auditFile, IRIS_AUDIT_LOG_PARAMS: "true", LOG_LEVEL: "DEBUG", ...extraEnv },
  );
  return { session, stderr: () => stderr, auditFile };
}

/** One line of an audit file. */
export type AuditEntry = Record<string, unknown>;

/** What {@link pollAuditEntries} waits for. */
export interface AuditPollOptions {
  /** Only entries of this tool count (and are returned unless `returnAll`); every entry when omitted. */
  tool?: string;
  /** Wait for at least this many counted entries (default 1). */
  count?: number;
  /** A counted entry must also satisfy this. */
  isWanted?: (entry: AuditEntry) => boolean;
  /** Return every entry of the file, not only the counted tool's. */
  returnAll?: boolean;
  /** Milliseconds between two reads of the file. */
  intervalMs: number;
  /** Milliseconds to wait before giving up. */
  timeoutMs: number;
  /** Characters of the file quoted in the failure text. */
  excerpt: number;
}

/**
 * Read the JSON-lines audit file `file` until it holds the entries `options` asks for, and return them.
 * Throws, quoting the start of the file, when they have not appeared within `timeoutMs`.
 */
export async function pollAuditEntries(file: string, options: AuditPollOptions): Promise<AuditEntry[]> {
  const wanted = options.count ?? 1;
  const deadline = Date.now() + options.timeoutMs;
  const read = (): AuditEntry[] =>
    (existsSync(file) ? readFileSync(file, "utf8") : "")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as AuditEntry);
  const ofTool = (entry: AuditEntry): boolean => options.tool === undefined || entry["tool"] === options.tool;
  for (;;) {
    const entries = read();
    const counted = entries.filter((entry) => ofTool(entry) && (options.isWanted?.(entry) ?? true));
    if (counted.length >= wanted) return options.returnAll ? entries : entries.filter(ofTool);
    if (Date.now() >= deadline) {
      const what = options.tool ?? "audit";
      throw new Error(
        `fewer than ${wanted} ${what} entries in ${file}: ` +
          `${existsSync(file) ? readFileSync(file, "utf8").slice(0, options.excerpt) : "no file"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}

/**
 * The number of entries the JSON-lines audit file `file` holds once no entry has landed for `stableReads` reads
 * `intervalMs` apart (0 when there is no file). The server writes an entry after it has sent the reply, so a test
 * that asserts on the entries its own calls add takes this count first and then reads only what follows it.
 */
export async function settledAuditCount(file: string, intervalMs = 50, stableReads = 3): Promise<number> {
  const count = (): number =>
    (existsSync(file) ? readFileSync(file, "utf8") : "").split("\n").filter((line) => line.trim() !== "").length;
  let last = count();
  for (let stable = 0; stable < stableReads; ) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const now = count();
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
  return last;
}

/** A request a stub listener recorded. */
export interface RecordedRequest {
  method: string;
  url: string;
  body: string;
}

/** A local listener that serves one route of the ExecuteMCPv2 REST service and refuses everything else. */
export interface RouteStub {
  port: number;
  requests: RecordedRequest[];
  /** While `false` every request is answered 503, which is how a server starts without an IRIS. */
  serving: boolean;
  /** The reply of the route, built from the parsed request body. */
  reply: (request: Record<string, unknown>) => unknown;
  close: () => Promise<void>;
}

/**
 * Start a local listener on an ephemeral port. While `serving` is true it answers `HEAD /api/atelier/`
 * with 200 and `POST <route>` with `reply(<parsed body>)` as JSON; every other request, and every
 * request while `serving` is false, gets a 503. Every request is recorded.
 *
 * @param route - The full path of the route to serve, such as `/api/executemcp/v2/interop/message/body`.
 */
export async function startRouteStub(route: string): Promise<RouteStub> {
  const stub: RouteStub = { port: 0, requests: [], serving: false, reply: () => ({}), close: () => Promise.resolve() };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      stub.requests.push({ method: req.method ?? "", url: req.url ?? "", body });
      if (stub.serving && req.method === "HEAD" && req.url === "/api/atelier/") {
        res.statusCode = 200;
        res.end();
        return;
      }
      if (stub.serving && req.method === "POST" && req.url === route) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(stub.reply(JSON.parse(body) as Record<string, unknown>)));
        return;
      }
      res.statusCode = 503;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stub.port = (server.address() as AddressInfo).port;
  stub.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return stub;
}

/** A local listener that answers every request with 503 and records `METHOD path` lines. */
export interface Stub503 {
  port: number;
  requests: string[];
  close: () => Promise<void>;
}

/** Start a {@link Stub503} on an ephemeral port. */
export async function start503Stub(): Promise<Stub503> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.statusCode = 503;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Run `body` with a fresh {@link Stub503}, and always close it. */
export async function withStub<T>(body: (stub: Stub503) => Promise<T>): Promise<T> {
  const stub = await start503Stub();
  try {
    return await body(stub);
  } finally {
    await stub.close();
  }
}

/** The target a server is pointed at when it should reach a local stub: that port, a throwaway credential, HSCUSTOM. */
export function stubTarget(port: number, username: string): IrisTarget {
  return { host: "127.0.0.1", port: String(port), username, password: "not-a-real-password", namespace: "HSCUSTOM" };
}

/** A route reply in the ExecuteMCPv2 envelope: no errors, no console, and `result`. */
export function stubEnvelope(result: unknown): unknown {
  return { status: { errors: [], summary: "" }, console: [], result };
}

/**
 * The requests a stub recorded for the ExecuteMCPv2 routes, which only a tool handler makes. The server's
 * own connection checks and bootstrap traffic go to `/api/atelier/` on its own schedule, so they are not counted.
 */
export function routeRequests(stub: { requests: RecordedRequest[] }): RecordedRequest[] {
  return stub.requests.filter((request) => request.url.startsWith("/api/executemcp/"));
}

let jsonFileCounter = 0;

/** Write `document` as JSON to a new file named `<n>-<name>` in `directory` and return its path. */
export function writeJson(directory: string, name: string, document: unknown): string {
  jsonFileCounter += 1;
  const file = path.join(directory, `${jsonFileCounter}-${name}`);
  writeFileSync(file, JSON.stringify(document), "utf8");
  return file;
}

/** The units of an HL7 v2 batch that IRIS parses on their own: its FHS line, its BHS line, and each message (CR-terminated). */
export function batchUnits(text: string): string[] {
  const units: string[] = [];
  let message: string[] = [];
  const flush = (): void => {
    if (message.length > 0) units.push(`${message.join("\r")}\r`);
    message = [];
  };
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line === "") continue;
    const name = line.slice(0, 3);
    if (name === "FHS" || name === "BHS") {
      flush();
      units.push(`${line}\r`);
    } else if (name === "MSH") {
      flush();
      message.push(line);
    } else if (name === "BTS" || name === "FTS") {
      flush();
    } else {
      message.push(line);
    }
  }
  flush();
  return units;
}

/** Whether `text` holds no lone surrogate half (`String.prototype.isWellFormed`, which the project's TS lib may not declare). */
export function wellFormed(text: string): boolean {
  return (text as unknown as { isWellFormed: () => boolean }).isWellFormed();
}
