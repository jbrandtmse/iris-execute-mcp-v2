// A connection-refusing preload: the oracle that a run reaches no IRIS instance, and the safety net while it is proven.
//
// USE
//   NODE_OPTIONS="--import <this file>" <command>
//   Node loads this module before the command's own code, in the process and in every child process and worker thread that
//   inherits NODE_OPTIONS (a vitest pool, a spawned MCP server).
//
// CONTRACT
//   `net.Socket.prototype.connect` is wrapped. A connect to a watched port, or to a watched host, is REFUSED (the socket
//   is destroyed with an ECONNREFUSED error on the next tick) and one line `<host>:<port>` is appended to the file named
//   by IRIS_MCP_CONNECT_LOG. Every other connect passes through unchanged. HTTP clients, fetch and TLS all connect
//   through this method, so a test run that is meant to reach nothing shows an empty log.
//
//   IRIS_MCP_WATCH_PORTS  comma-separated ports; default 52773,1972 (the IRIS web gateway and the superserver).
//   IRIS_MCP_WATCH_HOSTS  comma-separated host names; default unarmed.invalid (the inert target of an unarmed live leg).
//   IRIS_MCP_CONNECT_LOG  the log file; unset means refuse without logging.
//
// Nothing here runs unless the module is loaded; no product code imports it.

import net from 'node:net';
import { appendFileSync } from 'node:fs';

const DEFAULT_WATCH_PORTS = '52773,1972';
const DEFAULT_WATCH_HOSTS = 'unarmed.invalid';

function listOf(value, fallback) {
  return new Set(
    (value === undefined ? fallback : value)
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  );
}

const watchedPorts = listOf(process.env.IRIS_MCP_WATCH_PORTS, DEFAULT_WATCH_PORTS);
const watchedHosts = listOf(process.env.IRIS_MCP_WATCH_HOSTS, DEFAULT_WATCH_HOSTS);
const logPath = process.env.IRIS_MCP_CONNECT_LOG;

/**
 * The `{host, port}` a `Socket.prototype.connect` call names, or `undefined` for a path (IPC) connect.
 * The arguments are `(options)`, `(port[, host])`, `(path)` or the pre-normalized `[options, callback]` array that
 * `net.connect` hands down.
 */
export function connectTargetOf(args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (first !== null && typeof first === 'object') {
    if (first.path !== undefined && first.port === undefined) return undefined;
    return { host: String(first.host ?? 'localhost'), port: String(first.port ?? '') };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first)) return undefined;
  return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: String(first ?? '') };
}

/** Whether a connect to `target` is refused. */
export function isWatched(target) {
  if (target === undefined) return false;
  return watchedPorts.has(target.port) || watchedHosts.has(target.host.toLowerCase());
}

const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function connectUnlessWatched(...args) {
  const target = connectTargetOf(args);
  if (!isWatched(target)) return originalConnect.apply(this, args);
  if (logPath !== undefined && logPath !== '') {
    try {
      appendFileSync(logPath, `${target.host}:${target.port}\n`);
    } catch {
      // A log that cannot be written must not turn into a connection.
    }
  }
  const refusal = new Error(`connect ${target.host}:${target.port} refused by no-live-iris-preload`);
  refusal.code = 'ECONNREFUSED';
  process.nextTick(() => this.destroy(refusal));
  return this;
};
