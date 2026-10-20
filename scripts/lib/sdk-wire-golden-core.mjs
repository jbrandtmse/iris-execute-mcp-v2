// Core of the SDK wire golden (Story 43.1; AD-15, AD-32, AD-2).
//
// Shared by the CLI `scripts/capture-sdk-wire-golden.mjs` and by `packages/iris-mcp-all`'s
// default-suite test `story-43-1-sdk-wire-golden.test.ts` (Rule #45: only `@iris-mcp/all` sees every
// server's built dist), so the exchange list, the driver and the closed-port environment are single
// sourced and the capture and the replay can never disagree.
//
// CONTRACT
//   The golden pins what a client reads off the wire of each BUILT server on the 2025-11-25 era:
//   every response line, verbatim, to a fixed list of requests. The driver speaks newline-delimited
//   JSON-RPC over stdio by hand, with no SDK, so the bytes it records are the bytes the server wrote.
//   Each server runs against a closed local port, so no IRIS instance is reached.
//
//   A session is one server process: its environment, the protocol version its `initialize` asks for,
//   and the requests it answers after the handshake. An exchange is one request: a `label`, a
//   `method`, optional `params`, and (for the DW-617 rows) `dw617Of`, the label of the same prompt's
//   `arguments: {}` row that the omitted-`arguments` row must equal.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SERVER_PACKAGES } from './tool-catalog.mjs';

/** Repository-relative path of the committed golden. */
export const GOLDEN_RELATIVE_PATH = 'packages/iris-mcp-all/src/__tests__/fixtures/sdk-wire-golden.json';

/** The one protocol era the suite serves. */
export const WIRE_ERA = '2025-11-25';

/** A newer era a client may ask for; the server must answer with {@link WIRE_ERA}. */
export const NEWER_ERA_REQUEST = '2026-07-28';

/** Every server package the golden covers, in the order the golden lists them. */
export const GOLDEN_PACKAGES = [...SERVER_PACKAGES];

/** The closed-port connection settings of every spawned server's `default` profile. */
export const CLOSED_PORT_ENV = Object.freeze({
  IRIS_HOST: '127.0.0.1',
  IRIS_PORT: '1',
  IRIS_USERNAME: 'qa',
  IRIS_PASSWORD: 'qa',
  IRIS_NAMESPACE: 'HSCUSTOM',
  IRIS_HTTPS: 'false',
});

/** Milliseconds a server may take to answer one request. */
const REQUEST_TIMEOUT_MS = 30_000;

// -- the per-server picks ---------------------------------------------------------------------

/**
 * What each server's rows call. `typeInvalid` and `enumInvalid` are calls the field-level validation
 * rejects (a wrong type; a value outside an enum); `fieldRefine` and `objectRefine` are calls that fail
 * a field-level and an object-level refine; `denial` is a default-disabled write (omitted when the
 * server has none); `closedRead` is a read that reaches the closed port. `prompts` names the prompt
 * rows (`required` and `allOptional` list the prompts by whether any argument is required);
 * `promptsAbsent` marks the server that registers none.
 */
const PICKS = {
  'iris-dev-mcp': {
    typeInvalid: { name: 'iris_doc_get', arguments: { name: 12345 } },
    enumInvalid: { name: 'iris_doc_get', arguments: { name: 'A.B', format: 'json' } },
    fieldRefine: { name: 'iris_test_coverage', arguments: { target: ':Foo', level: 'class', classes: ['A.B'] } },
    denial: { name: 'iris_env_promote', arguments: { action: 'execute', source: 'A', target: 'B' } },
    closedRead: { name: 'iris_doc_list', arguments: {} },
    prompts: {
      withArgs: { name: 'diagnose-slow-query', arguments: { query: 'SELECT 1' } },
      required: ['diagnose-slow-query'],
      allOptional: [],
    },
  },
  'iris-admin-mcp': {
    typeInvalid: { name: 'iris_namespace_manage', arguments: { action: 'create', name: 12345 } },
    enumInvalid: { name: 'iris_namespace_manage', arguments: { action: 'bogus', name: 'X' } },
    denial: { name: 'iris_resource_manage', arguments: { action: 'grant' } },
    closedRead: { name: 'iris_namespace_list', arguments: {} },
    prompts: {
      withArgs: { name: 'provision-project-environment', arguments: { projectName: 'demo' } },
      required: ['provision-project-environment'],
      allOptional: ['audit-security-posture'],
    },
  },
  'iris-interop-mcp': {
    typeInvalid: { name: 'iris_production_manage', arguments: { action: 'create', name: 12345 } },
    enumInvalid: { name: 'iris_production_manage', arguments: { action: 'bogus', name: 'X' } },
    objectRefine: { name: 'iris_production_control', arguments: { action: 'start' } },
    denial: { name: 'iris_production_item', arguments: { action: 'add', itemName: 'X' } },
    closedRead: { name: 'iris_production_status', arguments: {} },
    prompts: {
      withArgs: { name: 'trace-message-flow', arguments: { sessionOrHeaderId: '123' } },
      required: ['trace-message-flow'],
      allOptional: ['recover-stuck-production'],
    },
  },
  'iris-ops-mcp': {
    typeInvalid: { name: 'iris_database_action', arguments: { action: 'mount', directory: 12345 } },
    enumInvalid: { name: 'iris_alerts_manage', arguments: { action: 'bogus' } },
    denial: { name: 'iris_process_manage', arguments: { action: 'terminate', pid: 1 } },
    closedRead: { name: 'iris_metrics_system', arguments: {} },
    prompts: {
      withArgs: { name: 'check-system-health', arguments: { server: 'default' } },
      required: [],
      allOptional: ['check-system-health', 'run-external-backup'],
    },
  },
  'iris-data-mcp': {
    typeInvalid: { name: 'iris_docdb_document', arguments: { action: 'get', database: 12345 } },
    enumInvalid: { name: 'iris_docdb_manage', arguments: { action: 'bogus' } },
    closedRead: { name: 'iris_docdb_find', arguments: { database: 'd', filter: {} } },
    promptsAbsent: { name: 'check-system-health', arguments: {} },
  },
};

// -- the exchange list ------------------------------------------------------------------------

/** One `tools/call` exchange. */
function toolCall(label, name, args) {
  return { label, method: 'tools/call', params: args === undefined ? { name } : { name, arguments: args } };
}

/** The tool rows of one server, in the order they run. */
function toolExchanges(pick) {
  const rows = [
    { label: 'tools-list', method: 'tools/list', params: {} },
    toolCall('call:unknown-tool', 'no_such_tool', {}),
    toolCall('call:invalid-type', pick.typeInvalid.name, pick.typeInvalid.arguments),
    toolCall('call:invalid-enum', pick.enumInvalid.name, pick.enumInvalid.arguments),
  ];
  if (pick.fieldRefine) rows.push(toolCall('call:invalid-field-refine', pick.fieldRefine.name, pick.fieldRefine.arguments));
  if (pick.objectRefine) rows.push(toolCall('call:invalid-object-refine', pick.objectRefine.name, pick.objectRefine.arguments));
  rows.push(
    toolCall('call:omitted-arguments', pick.typeInvalid.name, undefined),
    toolCall('call:omitted-arguments-profiles', 'iris_server_profiles', undefined),
    toolCall('call:server-profiles', 'iris_server_profiles', {}),
  );
  if (pick.denial) rows.push(toolCall('call:denial', pick.denial.name, pick.denial.arguments));
  rows.push(toolCall('call:closed-read', pick.closedRead.name, pick.closedRead.arguments));
  return rows;
}

/** One `prompts/get` exchange. */
function promptGet(label, name, args, extra = {}) {
  return { label, method: 'prompts/get', params: args === undefined ? { name } : { name, arguments: args }, ...extra };
}

/** The prompt rows of one server, in the order they run. */
function promptExchanges(pick) {
  if (pick.promptsAbsent) {
    return [
      { label: 'prompts-list', method: 'prompts/list', params: {} },
      promptGet('prompts-get:absent', pick.promptsAbsent.name, pick.promptsAbsent.arguments),
    ];
  }
  const prompts = pick.prompts;
  const rows = [
    { label: 'prompts-list', method: 'prompts/list', params: {} },
    promptGet('prompts-get:with-arguments', prompts.withArgs.name, prompts.withArgs.arguments),
  ];
  for (const name of [...prompts.required, ...prompts.allOptional]) {
    rows.push(promptGet(`prompts-get:empty:${name}`, name, {}));
    rows.push(promptGet(`prompts-get:omitted:${name}`, name, undefined, { dw617Of: `prompts-get:empty:${name}` }));
  }
  rows.push(promptGet('prompts-get:unknown', 'no_such_prompt', {}));
  return rows;
}

/** The resource rows, identical for every server. */
function resourceExchanges() {
  return [
    { label: 'resources-list', method: 'resources/list', params: {} },
    { label: 'resources-templates-list', method: 'resources/templates/list', params: {} },
    { label: 'resources-read:default', method: 'resources/read', params: { uri: 'iris-governance://default' } },
    { label: 'resources-read:unknown-profile', method: 'resources/read', params: { uri: 'iris-governance://no-such-profile' } },
    { label: 'resources-read:no-match', method: 'resources/read', params: { uri: 'file:///no/such/resource' } },
  ];
}

/**
 * The sessions of one server package: each is one server process, with the `env` it adds to the
 * closed-port environment, the protocol version its `initialize` asks for, and its exchanges.
 *
 * @param {string} pkg - A server package directory name.
 * @returns {Array<{ id: string, env: Record<string, string>, protocolVersion: string, exchanges: Array<object> }>}
 */
export function goldenSessions(pkg) {
  const pick = PICKS[pkg];
  if (!pick) throw new Error(`sdk-wire-golden: no picks for the package ${pkg}.`);
  const sessions = [
    {
      id: 'main',
      env: {},
      protocolVersion: WIRE_ERA,
      exchanges: [...toolExchanges(pick), ...promptExchanges(pick), ...resourceExchanges()],
    },
    { id: 'newer-era', env: {}, protocolVersion: NEWER_ERA_REQUEST, exchanges: [] },
  ];
  if (pkg === 'iris-dev-mcp') {
    sessions.push({
      id: 'core-preset',
      env: { IRIS_TOOLS_PRESET: 'core' },
      protocolVersion: WIRE_ERA,
      exchanges: [
        { label: 'tools-list', method: 'tools/list', params: {} },
        toolCall('call:hidden-tool', 'iris_doc_delete', { name: 'A.B' }),
      ],
    });
  }
  return sessions;
}

/**
 * Every row label of a server, as `<session>/<label>` in the order the golden lists them. The
 * handshake's own response is the row labelled `initialize` at the head of each session.
 *
 * @param {string} pkg - A server package directory name.
 * @returns {string[]}
 */
export function goldenLabels(pkg) {
  return goldenSessions(pkg).flatMap((session) => [
    `${session.id}/initialize`,
    ...session.exchanges.map((exchange) => `${session.id}/${exchange.label}`),
  ]);
}

// -- the raw driver ---------------------------------------------------------------------------

/**
 * Spawn a built server and speak newline-delimited JSON-RPC to it over stdio, with no SDK.
 *
 * `request` resolves with the response frame's raw `line` and its parsed `message`, matched by `id`; a
 * frame that carries a `method` is a request or notification from the server and never an answer.
 * A server that exits first, writes a stdout line that is not JSON, or stays silent past the timeout,
 * rejects the pending request.
 *
 * @param {object} options
 * @param {string} options.entry - Absolute path of the built server's `index.js`.
 * @param {Record<string, string>} options.env - The complete child environment.
 * @param {number} [options.timeoutMs] - Milliseconds one request may take.
 * @returns {{ request: (method: string, params?: object) => Promise<{ line: string, message: any }>,
 *   notify: (method: string, params?: object) => void,
 *   stderr: () => string,
 *   close: () => Promise<void> }}
 */
export function openRawWire({ entry, env, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const child = spawn(process.execPath, [entry], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  let buffer = '';
  let stderr = '';
  let nextId = 1;
  let ended = false;

  const failAll = (error) => {
    for (const pending of waiting.values()) pending.reject(error);
    waiting.clear();
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (line.trim() === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        failAll(new Error(`the server wrote a stdout line that is not JSON: ${line.slice(0, 200)}`));
        continue;
      }
      // A response carries an `id` and no `method`; a request or notification from the server is not an answer.
      if (typeof message.id === 'number' && message.method === undefined) waiting.get(message.id)?.resolve({ line, message });
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.once('exit', (code, signal) => {
    ended = true;
    failAll(new Error(`the server exited (code ${code}, signal ${signal}) before it answered; stderr: ${stderr.slice(0, 500)}`));
  });
  child.once('error', failAll);
  child.stdin.on('error', failAll);

  const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`);
  return {
    request: (method, params = {}) =>
      new Promise((resolve, reject) => {
        if (ended) {
          reject(new Error(`the server had already exited before ${method}`));
          return;
        }
        const id = nextId++;
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error(`no answer to ${method} within ${timeoutMs} ms; stderr: ${stderr.slice(0, 500)}`));
        }, timeoutMs);
        waiting.set(id, {
          resolve: (frame) => {
            clearTimeout(timer);
            waiting.delete(id);
            resolve(frame);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        send({ jsonrpc: '2.0', id, method, params });
      }),
    notify: (method, params) => send(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params }),
    stderr: () => stderr,
    close: async () => {
      child.stdin.end();
      child.kill();
      await new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve();
        else child.once('exit', () => resolve());
      });
    },
  };
}

/**
 * Run the MCP handshake on an open raw wire: `initialize` asking for `protocolVersion`, then
 * `notifications/initialized`. Resolves with the `initialize` response frame.
 *
 * @param {ReturnType<typeof openRawWire>} wire
 * @param {string} protocolVersion - The era the client asks for.
 * @param {string} clientName - The name the client reports.
 */
export async function handshake(wire, protocolVersion, clientName) {
  const initialized = await wire.request('initialize', {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: clientName, version: '0.0.0' },
  });
  if (initialized.message.error !== undefined) {
    throw new Error(`the server refused the handshake: ${initialized.line}`);
  }
  wire.notify('notifications/initialized');
  return initialized;
}

/**
 * Run one session against a built server and return its rows: the handshake response first, then one
 * row per exchange, each with the response line verbatim.
 *
 * @param {object} options
 * @param {string} options.entry - Absolute path of the built server's `index.js`.
 * @param {Record<string, string>} options.baseEnv - The environment without the `IRIS_*` settings of the host.
 * @param {ReturnType<typeof goldenSessions>[number]} options.session
 * @returns {Promise<Array<{ label: string, method: string, params?: object, dw617Of?: string, line: string }>>}
 */
export async function runGoldenSession({ entry, baseEnv, session }) {
  const wire = openRawWire({ entry, env: { ...baseEnv, ...CLOSED_PORT_ENV, ...session.env } });
  try {
    const initialized = await handshake(wire, session.protocolVersion, 'sdk-wire-golden');
    const rows = [
      {
        label: 'initialize',
        method: 'initialize',
        params: { protocolVersion: session.protocolVersion, capabilities: {}, clientInfo: { name: 'sdk-wire-golden', version: '0.0.0' } },
        line: initialized.line,
      },
    ];
    for (const exchange of session.exchanges) {
      const frame = await wire.request(exchange.method, exchange.params);
      rows.push({ ...exchange, line: frame.line });
    }
    return rows;
  } finally {
    await wire.close();
  }
}

// -- the installed SDK ------------------------------------------------------------------------

/** The MCP SDK packages the shared framework may resolve: the v1 SDK (the oracle build), then the v2 server package. */
const SDK_PACKAGES = ['@modelcontextprotocol/sdk', '@modelcontextprotocol/server'];

/**
 * The MCP SDK package the shared framework resolves, and its installed version, read from the
 * package manifest in the shared package's `node_modules`. On the oracle tree that is the v1 SDK;
 * on a migrated tree it is the v2 server package.
 *
 * @param {string} root - Repository root.
 * @returns {{ sdkPackage: string, sdkVersion: string }}
 */
export function installedSdk(root) {
  for (const sdkPackage of SDK_PACKAGES) {
    const manifestPath = join(root, 'packages', 'shared', 'node_modules', sdkPackage, 'package.json');
    if (existsSync(manifestPath)) {
      return { sdkPackage, sdkVersion: String(JSON.parse(readFileSync(manifestPath, 'utf-8')).version) };
    }
  }
  throw new Error(`none of ${SDK_PACKAGES.join(', ')} is installed under packages/shared/node_modules`);
}

/**
 * The environment a spawned server inherits from `processEnv`: everything except each `IRIS_*` key and
 * `MCP_TRANSPORT` (case-insensitive), so an ambient setting never reaches a golden session.
 *
 * @param {Record<string, string | undefined>} processEnv
 * @returns {Record<string, string>}
 */
export function inheritedGoldenEnv(processEnv) {
  const env = {};
  for (const [key, value] of Object.entries(processEnv)) {
    if (typeof value !== 'string') continue;
    const upper = key.toUpperCase();
    if (upper.startsWith('IRIS_') || upper === 'MCP_TRANSPORT') continue;
    env[key] = value;
  }
  return env;
}
