/**
 * Story 43.2 QA - a hand driver for a BUILT server over stdio, and the 2026-07-28 request metadata written out as literals.
 *
 * It uses neither the SDK client nor the wire driver and envelope helpers of `scripts/lib/sdk-wire-golden-core.mjs` (only its
 * closed-port environment, its environment filter and its `id` substitution `rawWithIdZero`, which it re-exports): it writes the
 * JSON-RPC lines it is given, keeps EVERY stdout line (a response,
 * a notification, or a line that is not JSON at all) and all of stderr, and never filters or reshapes a server message, so a key the
 * server writes is a key the test can see. The envelope constants follow the revision's text (`basic/index#_meta`: `protocolVersion`
 * and `clientCapabilities` are required, `clientInfo` is optional). `startRig` adds the two fake IRIS listeners and the audit file.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startFakeIris } from "../../../../scripts/lib/fake-iris-listener.mjs";
import { normalizeAuditEntry, readBootstrapVersion, settledAuditEntries } from "../../../../scripts/lib/sdk-handler-golden-core.mjs";
import { CLOSED_PORT_ENV, inheritedGoldenEnv } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
export { rawWithIdZero } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { REPO_ROOT } from "./pack-fixture";
import { distEntry } from "./process-gate-helpers.js";

/** A parsed JSON value the tests probe member by member. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export const MODERN_VERSION = "2026-07-28";
export const LEGACY_VERSION = "2025-11-25";

export const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
export const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
export const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
export const LOG_LEVEL_KEY = "io.modelcontextprotocol/logLevel";
export const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";

/** The smallest valid envelope: the two keys the revision requires. */
export const MINIMAL_META = Object.freeze({
  [PROTOCOL_VERSION_KEY]: MODERN_VERSION,
  [CLIENT_CAPABILITIES_KEY]: {},
});

/** The envelope of the revision's own `server/discover` example (with the optional `clientInfo`). */
export const EXAMPLE_META = Object.freeze({
  [PROTOCOL_VERSION_KEY]: MODERN_VERSION,
  [CLIENT_INFO_KEY]: { name: "ExampleClient", version: "1.0.0" },
  [CLIENT_CAPABILITIES_KEY]: {},
});

/** The `initialize` params of a 2025-era client. */
export function legacyInitializeParams(protocolVersion: string = LEGACY_VERSION): Json {
  return { protocolVersion, capabilities: {}, clientInfo: { name: "story-43-2-qa", version: "0.0.0" } };
}

/** One stdout line, as written. */
export interface WireLine {
  raw: string;
  /** The parsed line, or `undefined` when it is not JSON. */
  message: Json;
}

export interface HandWire {
  /** Write one JSON-RPC message (an object, serialized on one line) to the server's stdin. */
  send(frame: unknown): void;
  /** Write `text` and a newline to the server's stdin, as it is. */
  sendRaw(text: string): void;
  /** Send a request and resolve with the response that carries its id. */
  request(id: number, method: string, params?: unknown): Promise<WireLine>;
  /** Resolve with the response to request `id`, whenever the server writes it. */
  response(id: number, timeoutMs?: number): Promise<WireLine>;
  /** Resolve with the first stdout line, already written or still to come, that `predicate` accepts; reject after `timeoutMs` or when the server exits first. */
  untilLine(predicate: (line: WireLine) => boolean, timeoutMs?: number): Promise<WireLine>;
  /** Every stdout line so far. */
  stdout(): WireLine[];
  /** Every response (a line with an `id` and no `method`) to request `id` so far. */
  responsesTo(id: number): WireLine[];
  stderr(): string;
  /** Wait `ms` milliseconds (to see whether a line that must not come, comes). */
  quiet(ms: number): Promise<void>;
  endInput(): void;
  exit(): Promise<{ code: number | null; signal: string | null }>;
  close(): Promise<void>;
}

const RESPONSE_TIMEOUT_MS = 30_000;

/** Start `entry` (a built server's `index.js`) with exactly `env` and the hand driver on its stdio. */
export function startHandWire(entry: string, env: Record<string, string>): HandWire {
  const child = spawn(process.execPath, [entry], { env, stdio: ["pipe", "pipe", "pipe"] });
  const lines: WireLine[] = [];
  const listeners = new Set<() => void>();
  let buffer = "";
  let stderr = "";
  let ended: { code: number | null; signal: string | null } | undefined;
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once("exit", (code, signal) => {
      ended = { code, signal };
      resolve(ended);
      for (const listener of listeners) listener();
    });
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const raw = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      let message: Json;
      try {
        message = JSON.parse(raw);
      } catch {
        message = undefined;
      }
      lines.push({ raw, message });
      for (const listener of [...listeners]) listener();
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.on("error", () => undefined);

  const responsesTo = (id: number): WireLine[] =>
    lines.filter((line) => line.message !== undefined && line.message.id === id && line.message.method === undefined);
  const response = (id: number, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<WireLine> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`no response to request ${id} within ${timeoutMs} ms; stderr: ${stderr.slice(0, 600)}`));
      }, timeoutMs);
      const check = (): void => {
        const found = responsesTo(id)[0];
        if (found !== undefined) {
          clearTimeout(timer);
          listeners.delete(check);
          resolve(found);
        } else if (ended !== undefined) {
          clearTimeout(timer);
          listeners.delete(check);
          reject(new Error(`the server exited (${JSON.stringify(ended)}) before it answered request ${id}; stderr: ${stderr.slice(0, 600)}`));
        }
      };
      listeners.add(check);
      check();
    });
  const untilLine = (predicate: (line: WireLine) => boolean, timeoutMs = 10_000): Promise<WireLine> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(check);
        reject(new Error(`no stdout line matched within ${timeoutMs} ms; stderr: ${stderr.slice(0, 600)}`));
      }, timeoutMs);
      const check = (): void => {
        const found = lines.find(predicate);
        if (found !== undefined) {
          clearTimeout(timer);
          listeners.delete(check);
          resolve(found);
        } else if (ended !== undefined) {
          clearTimeout(timer);
          listeners.delete(check);
          reject(new Error(`the server exited (${JSON.stringify(ended)}) before a stdout line matched; stderr: ${stderr.slice(0, 600)}`));
        }
      };
      listeners.add(check);
      check();
    });
  const send = (frame: unknown): void => {
    child.stdin.write(`${JSON.stringify(frame)}\n`);
  };

  return {
    send,
    untilLine,
    sendRaw: (text) => {
      child.stdin.write(`${text}\n`);
    },
    request: (id, method, params) => {
      send(params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params });
      return response(id);
    },
    response,
    stdout: () => [...lines],
    responsesTo,
    stderr: () => stderr,
    quiet: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    endInput: () => {
      child.stdin.end();
    },
    exit: () => exited,
    close: async () => {
      child.stdin.end();
      child.kill();
      await exited;
    },
  };
}

/**
 * The environment of a spawned server: the host's environment without every `IRIS_*` key, the closed-port `default` profile, then
 * `extra`. A `LOG_LEVEL` key set to `undefined` in `extra` is removed, so a test can start a server with the variable unset.
 */
export function handEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = { ...inheritedGoldenEnv(process.env), ...CLOSED_PORT_ENV };
  delete env["LOG_LEVEL"];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** A disposable directory under the OS temp directory, and its removal. */
export function tempDirectory(prefix: string): { dir: string; remove: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A built server wired to two fake IRIS listeners (`default` reaches A, `other` reaches B) and an audit file in a disposable directory. */
export interface Rig {
  wire: HandWire;
  /** Requests each listener has received so far, as `METHOD url`. */
  requests: { a: () => string[]; b: () => string[] };
  /** The listener ports, to mask them out of text that two runs compare. */
  ports: { a: number; b: number };
  /** The audit entries once at least `minimum` exist and the file has stopped growing, without `ts`, `session` and `durationMs`. */
  audit: (minimum: number) => Promise<Json[]>;
  /** The server's stderr with both listener ports replaced by `PORT`. */
  maskedStderr: () => string;
  stop: () => Promise<void>;
}

/**
 * Start a built server against two fake IRIS listeners with auditing on (parameters included). `env` is added to the server's
 * environment; a key set to `undefined` is removed. Everything the rig creates is removed by `stop()`.
 */
export async function startRig(
  options: {
    pkg?: string;
    env?: Record<string, string | undefined>;
    /** Put something between the server and listener A: it receives A's port and returns the port the server's `default` profile uses. */
    interpose?: (upstreamPort: number) => Promise<{ port: number; close: () => Promise<void> }>;
  } = {},
): Promise<Rig> {
  const bootstrapVersion = readBootstrapVersion(REPO_ROOT);
  const a = await startFakeIris({ bootstrapVersion });
  const b = await startFakeIris({ bootstrapVersion });
  const front = options.interpose === undefined ? undefined : await options.interpose(a.port);
  const scratch = tempDirectory("story-43-2-qa-");
  const auditFile = path.join(scratch.dir, "audit.jsonl");
  const wire = startHandWire(
    distEntry(REPO_ROOT, options.pkg ?? "iris-dev-mcp"),
    handEnv({
      IRIS_PORT: String(front?.port ?? a.port),
      IRIS_PROFILES: JSON.stringify({ other: { host: "127.0.0.1", port: b.port, username: "qa", password: "qa", namespace: "HSCUSTOM" } }),
      IRIS_AUDIT_LOG: auditFile,
      IRIS_AUDIT_LOG_PARAMS: "true",
      LOG_LEVEL: "INFO",
      ...options.env,
    }),
  );
  const listed = (fake: { requests: Array<{ method: string; url: string }> }): string[] => fake.requests.map((request) => `${request.method} ${request.url}`);
  return {
    wire,
    requests: { a: () => listed(a), b: () => listed(b) },
    ports: { a: a.port, b: b.port },
    audit: async (minimum) => (await settledAuditEntries(auditFile, minimum) as Json[]).map((entry) => normalizeAuditEntry(entry)),
    maskedStderr: () => {
      const masked = wire.stderr().replaceAll(String(a.port), "PORT").replaceAll(String(b.port), "PORT");
      return front === undefined ? masked : masked.replaceAll(String(front.port), "PORT");
    },
    stop: async () => {
      await wire.close();
      await front?.close();
      await a.close();
      await b.close();
      scratch.remove();
    },
  };
}

/** The `result` of a response line, or throw with the line when it is an error. */
export function resultOf(line: WireLine): Json {
  if (line.message?.result === undefined) throw new Error(`expected a result, got: ${line.raw.slice(0, 400)}`);
  return line.message.result;
}

/** The `error` of a response line, or throw with the line when it is a result. */
export function errorOf(line: WireLine): Json {
  if (line.message?.error === undefined) throw new Error(`expected an error, got: ${line.raw.slice(0, 400)}`);
  return line.message.error;
}

/** The `[INFO]` stderr lines that name the era a factory call served. */
export function eraLines(stderr: string): string[] {
  return stderr.split("\n").filter((line) => line.startsWith("[INFO] Serving "));
}

export const MODERN_ERA_LINE = "[INFO] Serving MCP protocol revision 2026-07-28 (server/discover)";
export const LEGACY_ERA_LINE = "[INFO] Serving the 2025-era MCP handshake (initialize)";

/**
 * A result without what the 2026-07-28 revision adds to it (`resultType`, the caching hints, the server's `_meta` identity) and without
 * what it takes from a tool (`execution`): the part a 2025-era answer to the same request also has.
 */
export function withoutModernFields(result: Json): Json {
  const { resultType: _resultType, ttlMs: _ttlMs, cacheScope: _cacheScope, ...rest } = result ?? {};
  if (rest._meta !== undefined) {
    const { [SERVER_INFO_KEY]: _identity, ...meta } = rest._meta;
    if (Object.keys(meta).length === 0) delete rest._meta;
    else rest._meta = meta;
  }
  if (Array.isArray(rest.tools)) {
    rest.tools = rest.tools.map((tool: Json) => {
      const { execution: _execution, ...kept } = tool;
      return kept;
    });
  }
  return rest;
}

/** A `tools/call` request's params on the modern era: the call plus a `_meta` that merges `meta` over the minimal envelope. */
export function modernCall(name: string, args: Record<string, unknown> | undefined, meta: Record<string, unknown> = {}): Json {
  return { name, ...(args !== undefined ? { arguments: args } : {}), _meta: { ...MINIMAL_META, ...meta } };
}
