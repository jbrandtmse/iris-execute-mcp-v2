// A Node `--import` preload for the tests that run a release script as a real process: every `fetch` answers 404 with the MCP Registry's own
// "not found" body, so the process reaches no network. The tests that need another answer inject a `fetch` instead of using this file.

globalThis.fetch = async () =>
  new Response(JSON.stringify({ title: 'Not Found', status: 404, detail: 'Server not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
