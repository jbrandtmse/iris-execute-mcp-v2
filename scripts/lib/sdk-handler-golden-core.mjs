// Core of the SDK handler golden (Story 43.1 QA; AD-15, AD-32, AD-3, AD-19).
//
// The wire golden (`sdk-wire-golden-core.mjs`) cannot reach the results of tool HANDLERS, because a handler
// needs an IRIS instance. This golden can: every server runs against the fake IRIS of
// `fake-iris-listener.mjs`, and a session records, for a fixed list of `tools/call` requests,
//   - the response line, verbatim;
//   - the requests the server made to IRIS while it answered (method, url, body), which prove that the
//     handler received the same PARSED arguments; and
//   - the audit entries the server wrote (`IRIS_AUDIT_LOG`, `IRIS_AUDIT_LOG_PARAMS=true`).
//
// The CLI `scripts/capture-sdk-handler-golden.mjs` records the golden once, from the SDK v1 build, and the
// default-suite test `story-43-1-qa-handler-golden.test.ts` replays it against the built servers.
//
// THE ONE SANCTIONED DIFFERENCE (AD-15, "Story 43.1"). DW-579: the last exchange of every session is a
// schema-invalid call. The v1 build wrote no audit entry for it; a later build writes one, with `outcome`
// `error`, the raw key names and no `params`. `diffHandlerSession` checks that entry. Every response line and
// every request made to IRIS must be byte-identical; anything else is a difference the golden reports. That
// includes the member order of a result that carries `isError` and `structuredContent`: the v1 SDK server
// re-parses every `tools/call` result with its result schema, so the v1 wire already wrote
// `content, structuredContent, isError`.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { readAuditEntries } from './audit-lines.mjs';
import { startFakeIris } from './fake-iris-listener.mjs';
import { CLOSED_PORT_ENV, GOLDEN_PACKAGES, WIRE_ERA, handshake, openRawWire } from './sdk-wire-golden-core.mjs';

export { GOLDEN_PACKAGES, WIRE_ERA };

/** Repository-relative path of the committed handler golden. */
export const HANDLER_GOLDEN_RELATIVE_PATH = 'packages/iris-mcp-all/src/__tests__/fixtures/sdk-handler-golden.json';

/** One `tools/call` exchange. `schemaInvalid` marks the call a later build audits and the v1 build did not. */
function call(label, name, args, extra = {}) {
  return { label, method: 'tools/call', params: { name, arguments: args }, ...extra };
}

/**
 * The exchanges of one server, in the order they run. Arguments are chosen to need the parsed form: a numeric
 * field sent as a string, a boolean sent as a string, an unknown key. The last exchange is the schema-invalid call.
 */
const EXCHANGES = {
  'iris-dev-mcp': [
    call('doc-get:range', 'iris_doc_get', { name: 'Demo.Sample.cls', startLine: '2', endLine: '3', bogus: 'dropped' }),
    call('doc-get:full', 'iris_doc_get', { name: 'Demo.Sample.cls' }),
    call('doc-get:not-found', 'iris_doc_get', { name: 'Demo.Missing.cls' }),
    call('doc-get:metadata-only', 'iris_doc_get', { name: 'Demo.Sample.cls', metadataOnly: 'true' }),
    call('doc-get:metadata-missing', 'iris_doc_get', { name: 'Demo.Missing.cls', metadataOnly: 'true' }),
    call('doc-list:coerced', 'iris_doc_list', { category: 'CLS', generated: 'false', filter: 'Demo' }),
    call('doc-list:handler-throws', 'iris_doc_list', { filter: 'throw' }),
    call('sql-query:ok', 'iris_sql_query', { query: 'SELECT 1 AS A', maxRows: '1' }),
    call('sql-query:refusal', 'iris_sql_query', { query: 'INSERT INTO T VALUES (1)' }),
    call('sql-query:rest-error', 'iris_sql_query', { query: 'SELECT boom' }),
    call('server-info', 'iris_server_info', {}),
    call('denial', 'iris_env_promote', { action: 'execute', source: 'A', target: 'B' }),
    call('schema-invalid', 'iris_doc_get', { name: 12345 }, { schemaInvalid: true }),
  ],
  'iris-admin-mcp': [
    call('namespace-list', 'iris_namespace_list', {}),
    call('schema-invalid', 'iris_namespace_manage', { action: 'create', name: 12345 }, { schemaInvalid: true }),
  ],
  'iris-interop-mcp': [
    call('production-status:detail', 'iris_production_status', { detail: true }),
    call('production-status:rest-error', 'iris_production_status', { namespace: 'ERRNS' }),
    call('schema-invalid', 'iris_production_manage', { action: 'create', name: 12345 }, { schemaInvalid: true }),
  ],
  'iris-ops-mcp': [
    call('metrics-system', 'iris_metrics_system', {}),
    call('schema-invalid', 'iris_database_action', { action: 'mount', directory: 12345 }, { schemaInvalid: true }),
  ],
  'iris-data-mcp': [
    call('docdb-find', 'iris_docdb_find', { database: 'd', filter: { name: 'alpha' } }),
    call('schema-invalid', 'iris_docdb_document', { action: 'get', database: 12345 }, { schemaInvalid: true }),
  ],
};

/**
 * The exchange list of one server package.
 *
 * @param {string} pkg - A server package directory name.
 */
export function handlerExchanges(pkg) {
  const exchanges = EXCHANGES[pkg];
  if (!exchanges) throw new Error(`sdk-handler-golden: no exchanges for the package ${pkg}.`);
  return exchanges;
}

/**
 * The `BOOTSTRAP_VERSION` a build embeds, read from its built shared package; throws when the built file does not hold one.
 * @param {string} distRoot
 * @returns {string}
 */
export function readBootstrapVersion(distRoot) {
  const text = readFileSync(join(distRoot, 'packages', 'shared', 'dist', 'bootstrap-classes.js'), 'utf8');
  const match = text.match(/BOOTSTRAP_VERSION\s*=\s*"((?:\d+\.\d+\.\d+\+\d+\.)?[0-9a-f]+)"/);
  if (!match) throw new Error('sdk-handler-golden: BOOTSTRAP_VERSION not found in packages/shared/dist/bootstrap-classes.js.');
  return match[1];
}

/** An audit entry without the fields that differ between two runs of one build: the time, the session and the duration. */
export function normalizeAuditEntry(entry) {
  const { ts: _ts, session: _session, durationMs: _durationMs, ...rest } = entry;
  return rest;
}

/**
 * Audit entries with the `version` of each `sessionStart` line set to `version` and every other member as given. A server
 * writes its package manifest's version there, which a release changes; a comparison with the golden passes that version.
 *
 * @param {Array<object>} entries
 * @param {string} version
 */
export function withSessionVersion(entries, version) {
  return entries.map((entry) => (entry.type === 'sessionStart' ? { ...entry, version } : entry));
}

/** Wait until the audit file holds at least `minimum` lines and has stopped growing, then return its entries. */
export async function settledAuditEntries(file, minimum) {
  const read = () => readAuditEntries(file);
  const deadline = Date.now() + 15_000;
  let last = read();
  for (let stable = 0; stable < 8; ) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 50));
    const now = read();
    stable = now.length === last.length && now.length >= minimum ? stable + 1 : 0;
    last = now;
    if (Date.now() > deadline) throw new Error(`sdk-handler-golden: the audit file held ${now.length} entries, expected at least ${minimum}.`);
  }
  return last;
}

/**
 * Run one session of a built server against a fresh fake IRIS and return what it did.
 *
 * @param {object} options
 * @param {string} options.entry - Absolute path of the built server's `index.js`.
 * @param {Record<string, string>} options.baseEnv - The environment without the `IRIS_*` settings of the host.
 * @param {string} options.pkg - The server package directory name.
 * @param {string} options.bootstrapVersion - The `BOOTSTRAP_VERSION` of the build under test.
 * @returns {Promise<{ startup: Array<object>, rows: Array<object>, audit: Array<object> }>}
 */
export async function runHandlerSession({ entry, baseEnv, pkg, bootstrapVersion }) {
  const exchanges = handlerExchanges(pkg);
  const fake = await startFakeIris({ bootstrapVersion });
  const directory = mkdtempSync(join(tmpdir(), 'sdk-handler-golden-'));
  const auditFile = join(directory, 'audit.jsonl');
  const env = { ...baseEnv, ...CLOSED_PORT_ENV, IRIS_PORT: String(fake.port), IRIS_AUDIT_LOG: auditFile, IRIS_AUDIT_LOG_PARAMS: 'true' };
  const wire = openRawWire({ entry, env });
  try {
    await handshake(wire, WIRE_ERA, 'sdk-handler-golden');
    const startup = fake.requests.map((request) => ({ ...request }));
    const rows = [];
    for (const exchange of exchanges) {
      const before = fake.requests.length;
      // eslint-disable-next-line no-await-in-loop
      const frame = await wire.request(exchange.method, exchange.params);
      rows.push({ ...exchange, line: frame.line, upstream: fake.requests.slice(before).map((request) => ({ ...request })) });
    }
    // The session line, plus one entry per call that every build audits.
    const audit = (await settledAuditEntries(auditFile, 1 + exchanges.filter((exchange) => !exchange.schemaInvalid).length)).map(normalizeAuditEntry);
    return { startup, rows, audit };
  } finally {
    await wire.close();
    await fake.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

// -- comparing two sessions --------------------------------------------------------------------

/**
 * Compare a recorded (golden) session with a live one. Returns every difference that is not sanctioned:
 * an empty list means the live build answered and behaved exactly as the golden build did, apart from the
 * audit entry of the schema-invalid call (DW-579).
 *
 * @param {{ startup: Array<object>, rows: Array<object>, audit: Array<object> }} golden
 * @param {{ startup: Array<object>, rows: Array<object>, audit: Array<object> }} live
 * @param {{ sessionVersion?: string }} [options] - `sessionVersion`: the version the live build's `sessionStart` line
 *   reports (its package manifest's); the golden's line is compared with it in place of the captured one.
 * @returns {string[]}
 */
export function diffHandlerSession(golden, live, { sessionVersion } = {}) {
  const findings = [];
  if (!isDeepStrictEqual(golden.startup, live.startup)) {
    findings.push(`startup requests differ: golden ${JSON.stringify(golden.startup)} vs live ${JSON.stringify(live.startup)}`);
  }
  if (golden.rows.length !== live.rows.length) {
    findings.push(`row count differs: golden ${golden.rows.length} vs live ${live.rows.length}`);
    return findings;
  }
  golden.rows.forEach((row, index) => {
    const now = live.rows[index];
    if (row.label !== now.label) {
      findings.push(`row ${index}: label ${row.label} vs ${now.label}`);
      return;
    }
    if (row.line !== now.line) {
      findings.push(`${row.label}: response line differs: golden ${row.line.slice(0, 300)} vs live ${now.line.slice(0, 300)}`);
    }
    if (!isDeepStrictEqual(row.upstream, now.upstream)) {
      findings.push(`${row.label}: requests made to IRIS differ: golden ${JSON.stringify(row.upstream)} vs live ${JSON.stringify(now.upstream)}`);
    }
  });
  // DW-579: the live build audits the schema-invalid call (last), the v1 build did not.
  const lastEntry = live.audit.at(-1);
  const extra = live.audit.length === golden.audit.length + 1 ? lastEntry : undefined;
  const compared = extra === undefined ? live.audit : live.audit.slice(0, -1);
  const expectedAudit = sessionVersion === undefined ? golden.audit : withSessionVersion(golden.audit, sessionVersion);
  if (!isDeepStrictEqual(expectedAudit, compared)) {
    findings.push(`audit entries differ: golden ${JSON.stringify(expectedAudit)} vs live ${JSON.stringify(compared)}`);
  }
  const invalidRow = live.rows.at(-1);
  if (extra === undefined) {
    findings.push('the schema-invalid call (DW-579) wrote no audit entry');
  } else {
    const keys = Object.keys(invalidRow.params.arguments).filter((key) => key !== 'server');
    if (extra.tool !== invalidRow.params.name || extra.outcome !== 'error' || !isDeepStrictEqual(extra.paramKeys, keys) || 'params' in extra || 'dataPolicy' in extra) {
      findings.push(`the audit entry of the schema-invalid call (DW-579) is not the specified one: ${JSON.stringify(extra)}`);
    }
  }
  return findings;
}
