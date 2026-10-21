// A local fake of the IRIS web server for the handler golden (Story 43.1 QA; AD-15, AD-32).
//
// CONTRACT
//   `startFakeIris` listens on 127.0.0.1 on an ephemeral port and answers, deterministically, the Atelier and
//   ExecuteMCPv2 REST shapes that the handler golden's tool calls need: the connection checks, the version
//   negotiation, the bootstrap probe (reported "current", so a started server deploys nothing), documents, document
//   names, the SQL endpoint, and one read route for each of the other four servers. It also answers the write routes
//   of the confirmation gates: the audit purge, the production `clean`, `resend` and `resendFiltered`, the persistent
//   class `Demo.Stored.cls` (a read, a version probe and a save), and the save and compile of a promoted document
//   (`Demo.Sample.cls` and `action/compile`). It records every request, so a
//   run can be compared with another by what each server asked IRIS for. It is SDK-free and reaches nothing but its
//   own socket.
//
//   Every reply is a function of the request alone: two runs against fresh listeners that make the same requests get
//   the same bytes. The SQL endpoint and the product routes choose their reply from marker values in the request
//   (`SELECT boom` answers an HTTP 500 error envelope, `filter=throw` answers a non-JSON page, namespace `ERRNS`
//   answers an HTTP 500 error envelope; a `resendFiltered` of item `Demo.Refused` is refused as IRIS refuses, HTTP 200
//   with the error in the envelope, and one of item `Demo.PreviewDown` answers its preview with an HTTP 500 error
//   envelope); a document called `Demo.Missing.cls` is absent.

import http from 'node:http';

/** The Atelier API version the fake reports. */
const ATELIER_API = 8;

/** A reply in the Atelier envelope: no errors, no console, and `result`. */
export function envelope(result) {
  return { status: { errors: [], summary: '' }, console: [], result };
}

/** A reply in the Atelier envelope that carries one error. */
export function errorEnvelope(text, code) {
  return { status: { errors: [{ error: text, code, domain: '%ObjectErrors', id: 'GeneralError', params: [] }], summary: text }, console: [], result: {} };
}

/** The document `Demo.Sample.cls` as the Atelier document route returns it. */
const SAMPLE_DOCUMENT = {
  name: 'Demo.Sample.cls',
  db: 'HSCUSTOM',
  ts: '2026-01-01 00:00:00.000',
  upd: false,
  cat: 'CLS',
  status: '',
  enc: false,
  flags: 0,
  content: ['Class Demo.Sample Extends %RegisteredObject', '{', 'Method A()', '{', '}', '}'],
};

/** The persistent class `Demo.Stored.cls`: one `Storage Default` definition, which an edit can drop. */
const STORED_DOCUMENT = {
  name: 'Demo.Stored.cls',
  db: 'HSCUSTOM',
  ts: '2026-01-01 00:00:00.000',
  upd: false,
  cat: 'CLS',
  status: '',
  enc: false,
  flags: 0,
  content: [
    'Class Demo.Stored Extends %Persistent',
    '{',
    'Property A As %String;',
    'Storage Default',
    '{',
    '<DataLocation>^Demo.StoredD</DataLocation>',
    '<Type>%Storage.Persistent</Type>',
    '}',
    '}',
  ],
};

/** How many messages the `resendFiltered` route counts for `item`: none for `Demo.Zero`, 600 for `Demo.Many`, else 3. */
function matchCountOf(item) {
  if (item === 'Demo.Zero') return 0;
  if (item === 'Demo.Many') return 600;
  return 3;
}

/**
 * Start the fake.
 *
 * @param {object} options
 * @param {string} options.bootstrapVersion - The value `ExecuteMCPv2.Setup_GetBootstrapVersion()` answers: the
 *   `BOOTSTRAP_VERSION` of the build under test, so the probe finds the classes current and deploys nothing.
 * @returns {Promise<{ port: number, requests: Array<{ method: string, url: string, body: string }>, close: () => Promise<void> }>}
 */
export async function startFakeIris({ bootstrapVersion }) {
  const requests = [];

  const reply = (res, status, body, headers = {}) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json', ...headers });
    res.end(text);
  };

  const route = (method, rawUrl, bodyText, res) => {
    const url = new URL(rawUrl, 'http://fake.invalid');
    const path = url.pathname;
    let body;
    try {
      body = bodyText === '' ? undefined : JSON.parse(bodyText);
    } catch {
      body = undefined;
    }

    if (path === '/api/atelier/') {
      if (method === 'HEAD') {
        res.writeHead(200);
        res.end();
        return;
      }
      reply(res, 200, envelope({
        content: { version: 'IRIS for UNIX (Fake) 2026.2 (Build 221U)', id: 'FAKE-IRIS-0001', api: ATELIER_API, features: [{ name: 'DEEPSEE', enabled: 'false' }], namespaces: ['HSCUSTOM', '%SYS'] },
      }));
      return;
    }

    const atelier = path.match(/^\/api\/atelier\/v\d+\/([^/]+)\/(.*)$/);
    if (atelier) {
      const action = atelier[2];
      if (method === 'POST' && action === 'action/query') {
        const query = String(body?.query ?? '');
        if (query.includes('Setup_GetBootstrapVersion')) reply(res, 200, envelope({ content: [{ Version: bootstrapVersion }] }));
        else if (query.includes('Setup_IsConfigured')) reply(res, 200, envelope({ content: [{ Configured: 1 }] }));
        else reply(res, 200, envelope({ content: [] }));
        return;
      }
      if (method === 'POST' && action === 'action/compile') {
        reply(res, 200, envelope({ content: [] }));
        return;
      }
      if (method === 'GET' && action.startsWith('docnames/')) {
        if (url.searchParams.get('filter') === 'throw') {
          reply(res, 200, '<html><body>not an Atelier envelope</body></html>');
          return;
        }
        reply(res, 200, envelope({
          content: [
            { name: 'Demo.Other.cls', cat: 'CLS', ts: '2026-01-02 00:00:00.000', upd: false, db: 'HSCUSTOM', gen: false },
            { name: 'Demo.Sample.cls', cat: 'CLS', ts: '2026-01-01 00:00:00.000', upd: false, db: 'HSCUSTOM', gen: false },
          ],
        }));
        return;
      }
      if (action.startsWith('doc/')) {
        const name = decodeURIComponent(action.slice('doc/'.length));
        if (name === 'Demo.Stored.cls') {
          if (method === 'HEAD') {
            res.writeHead(200, { ETag: `"${STORED_DOCUMENT.ts}"` });
            res.end();
          } else if (method === 'PUT') {
            reply(res, 200, envelope({ name, ts: '2026-01-02 00:00:00.000', status: '', content: [] }));
          } else {
            reply(res, 200, envelope(STORED_DOCUMENT));
          }
          return;
        }
        if (name === 'Demo.Sample.cls') {
          if (method === 'HEAD') {
            res.writeHead(200, { ETag: '"2026-01-01 00:00:00.000"' });
            res.end();
          } else {
            reply(res, 200, envelope(SAMPLE_DOCUMENT));
          }
          return;
        }
        if (method === 'HEAD') {
          res.writeHead(404);
          res.end();
        } else {
          reply(res, 404, errorEnvelope(`ERROR #16005: Document '${name}' does not exist`, 16005));
        }
        return;
      }
    }

    if (method === 'POST' && path === '/api/executemcp/v2/dev/sql/execute') {
      const query = String(body?.query ?? '');
      if (query.includes('boom')) {
        reply(res, 500, errorEnvelope("ERROR #5540: SQLCODE: -29 Field 'BOOM' not found in the applicable tables", 5540));
      } else if (/^\s*insert/i.test(query)) {
        reply(res, 200, envelope({ outcome: 'readOnly', statementType: 2, statementTypeName: 'INSERT' }));
      } else {
        reply(res, 200, envelope({ outcome: 'ok', statementType: 1, statementTypeName: 'SELECT', content: [{ A: 1, B: 'two' }, { A: 3, B: 'four' }] }));
      }
      return;
    }
    if (method === 'GET' && path === '/api/executemcp/v2/config/namespace') {
      reply(res, 200, envelope([
        { name: 'HSCUSTOM', globals: 'HSCUSTOM', routines: 'HSCUSTOM', library: 'IRISLIB', tempGlobals: 'IRISTEMP' },
        { name: '%SYS', globals: 'IRISSYS', routines: 'IRISSYS', library: 'IRISLIB', tempGlobals: 'IRISTEMP' },
      ]));
      return;
    }
    if (method === 'GET' && path === '/api/executemcp/v2/interop/production/status') {
      if (url.searchParams.get('namespace') === 'ERRNS') {
        reply(res, 500, errorEnvelope('ERROR #5001: the namespace has no production', 5001));
      } else {
        reply(res, 200, envelope({ production: 'Demo.Production', state: 'Running', stateCode: 1 }));
      }
      return;
    }
    if (method === 'GET' && path === '/api/executemcp/v2/monitor/system') {
      reply(res, 200, envelope({ metrics: [{ name: 'iris_fake_gauge', help: 'A fake gauge', type: 'gauge', value: 7 }], databases: [{ name: 'HSCUSTOM', directory: '/fake/db', sizeMB: 10, maxSizeMB: 100 }] }));
      return;
    }
    if (method === 'POST' && /^\/api\/docdb\/v1\/[^/]+\/find\/[^/]+$/.test(path)) {
      reply(res, 200, envelope([{ _id: 1, name: 'alpha' }, { _id: 2, name: 'beta' }]));
      return;
    }

    // The write routes of the confirmation gates (Story 43.3). Each answers from the request alone and uses the
    // texts of the IRIS-side guards (`Security.cls`, `Interop.cls`, `MessageResend.cls`).
    if (method === 'POST' && path === '/api/executemcp/v2/security/audit' && body?.action === 'purge') {
      if (body.confirm === true) {
        reply(res, 200, envelope({ action: 'purge', deleted: 3, success: 1 }));
      } else {
        reply(res, 400, errorEnvelope("ERROR #5001: Parameter 'confirm' must be true to purge audit-log records", 5001));
      }
      return;
    }
    if (method === 'POST' && path === '/api/executemcp/v2/interop/production/control' && body?.action === 'clean') {
      if (body.killAppData && !body.confirm) {
        reply(res, 400, errorEnvelope(
          'ERROR #5001: killAppData wipes the persistent Ens.AppData business state (HL7 sequence numbers, file/FTP done-file tables, batch/control-number state) and can cause duplicate re-ingestion of already-processed data; it requires confirm:true. No changes were made.',
          5001,
        ));
      } else {
        reply(res, 200, envelope({ action: 'cleaned', killAppData: !!body.killAppData }));
      }
      return;
    }
    if (method === 'POST' && path === '/api/executemcp/v2/interop/message/resend' && body?.action === 'resend') {
      const ids = Array.isArray(body.headerIds) ? body.headerIds : [];
      reply(res, 200, envelope({ results: [], summary: { total: ids.length, succeeded: ids.length, failed: 0 } }));
      return;
    }
    if (method === 'POST' && path === '/api/executemcp/v2/interop/message/resend' && body?.action === 'resendFiltered') {
      const matchCount = matchCountOf(body.item);
      const maxMessages = body.maxMessages ?? 100;
      const preview = body.dryRun === undefined || body.dryRun === true;
      // `Demo.Refused`: IRIS refuses the preview and the execute alike, the way the ExecuteMCPv2 handlers refuse
      // (HTTP 200 with the error in the envelope). `Demo.PreviewDown`: the preview fails with a server error, and the
      // execute would run.
      if (body.item === 'Demo.Refused') {
        reply(res, 200, errorEnvelope(
          "ERROR #5001: The 'from'/'to' window spans approximately 9.00 days, exceeding the maximum allowed window of 7 days; narrow the range and retry. No changes were made.",
          5001,
        ));
        return;
      }
      if (body.item === 'Demo.PreviewDown' && preview) {
        reply(res, 500, errorEnvelope('ERROR #5002: the fake IRIS preview failed', 5002));
        return;
      }
      if (preview) {
        reply(res, 200, envelope({
          action: 'resendFiltered',
          dryRun: true,
          matchCount,
          sample: [],
          item: body.item,
          status: body.status ?? 'Errored',
          from: body.from,
          to: body.to ?? body.from,
          maxMessages,
        }));
      } else if (!body.confirm) {
        reply(res, 400, errorEnvelope(
          'ERROR #5001: resendFiltered execution requires dryRun:false and confirm:true; by default dryRun is true and only previews matching messages without resending. No changes were made.',
          5001,
        ));
      } else if (matchCount > maxMessages) {
        reply(res, 400, errorEnvelope(
          `ERROR #5001: ${matchCount} messages match the filter, exceeding the maxMessages cap of ${maxMessages}; narrow the time window or item filter and retry. No changes were made.`,
          5001,
        ));
      } else {
        reply(res, 200, envelope({
          action: 'resendFiltered',
          dryRun: false,
          matchCount,
          results: [],
          summary: { total: matchCount, succeeded: matchCount, failed: 0 },
        }));
      }
      return;
    }

    reply(res, 404, errorEnvelope(`the fake IRIS has no route for ${method} ${path}`, 404));
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method ?? '', url: req.url ?? '', body: bodyText });
      route(req.method ?? '', req.url ?? '', bodyText, res);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: server.address().port,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
