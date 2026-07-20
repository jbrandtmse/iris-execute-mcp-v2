// Core (pure, side-effect-free) helpers for the tool-visibility payload
// measurement (Epic 30, Story 30.2, AC 30.2.3 — spec
// research/feature-specs/11-tool-visibility-presets.md §2.7).
//
// Split out from scripts/measure-tools-payload.mjs (the CLI orchestrator,
// which has side effects: env var mutation across a loop, stdout output) so
// this module can be imported WITHOUT triggering a full measurement run —
// consumed by both the CLI script and packages/iris-mcp-all's default-suite
// vitest sanity test (Rule #45: cross-package validation tests live in
// @iris-mcp/all, since only it depends on all five server packages).

/**
 * Invoke a request handler on the underlying SDK Server by method name — the
 * SAME pattern `tool-visibility.e2e.test.ts`'s `callRequest` helper uses to
 * drive the real wire without a live transport.
 */
export async function callRequest(server, method, params) {
  const innerServer = server.server.server;
  const handler = innerServer._requestHandlers.get(method);
  if (!handler) throw new Error(`No request handler for "${method}"`);
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return handler({ method, params }, extra);
}

/** Drive the real `tools/list` handler, following `nextCursor` if the SDK paginates. */
export async function fetchAllTools(server) {
  const all = [];
  let cursor;
  do {
    // eslint-disable-next-line no-await-in-loop
    const result = await callRequest(server, 'tools/list', cursor ? { cursor } : {});
    all.push(...result.tools);
    cursor = result.nextCursor;
  } while (cursor);
  return all;
}

/**
 * Construct a real `McpServerBase` under the given preset, drive the real
 * `tools/list` handler, and size the resulting payload exactly as a
 * connected client would receive it over the wire.
 *
 * Mutates then restores `process.env.IRIS_TOOLS_PRESET`/`_DISABLE`/`_ENABLE`
 * around the single construction (the env vars this repo's visibility engine
 * reads — parsed once at `McpServerBase` construction).
 *
 * @returns {Promise<{count: number, bytes: number, tokens: number}>}
 */
export async function measureOne(McpServerBase, pkgMeta, tools, toolPresets, preset) {
  const savedPreset = process.env.IRIS_TOOLS_PRESET;
  const savedDisable = process.env.IRIS_TOOLS_DISABLE;
  const savedEnable = process.env.IRIS_TOOLS_ENABLE;
  delete process.env.IRIS_TOOLS_DISABLE;
  delete process.env.IRIS_TOOLS_ENABLE;
  if (preset === 'full') {
    delete process.env.IRIS_TOOLS_PRESET;
  } else {
    process.env.IRIS_TOOLS_PRESET = preset;
  }
  try {
    const server = new McpServerBase({
      name: pkgMeta.name,
      version: pkgMeta.version,
      tools,
      toolPresets,
    });
    const listedTools = await fetchAllTools(server);
    const json = JSON.stringify({ tools: listedTools });
    const bytes = Buffer.byteLength(json, 'utf8');
    const tokens = Math.round(bytes / 4);
    return { count: listedTools.length, bytes, tokens };
  } finally {
    if (savedPreset === undefined) delete process.env.IRIS_TOOLS_PRESET;
    else process.env.IRIS_TOOLS_PRESET = savedPreset;
    if (savedDisable === undefined) delete process.env.IRIS_TOOLS_DISABLE;
    else process.env.IRIS_TOOLS_DISABLE = savedDisable;
    if (savedEnable === undefined) delete process.env.IRIS_TOOLS_ENABLE;
    else process.env.IRIS_TOOLS_ENABLE = savedEnable;
  }
}

function fmtBytes(n) {
  return n.toLocaleString('en-US');
}
function fmtTokens(n) {
  return `~${n.toLocaleString('en-US')}`;
}

/**
 * Render the markdown table from a list of `{ name, rows: {full,core,developer} }`
 * measurement results (one entry per server package).
 */
export function buildMarkdownTable(results) {
  const lines = [];
  lines.push('## Tool Visibility Presets — measured `tools/list` payload (AC 30.2.3)');
  lines.push('');
  lines.push(
    '| Server | full (count / bytes / ~tokens) | core (count / bytes / ~tokens) | developer (count / bytes / ~tokens) |',
  );
  lines.push('| --- | --- | --- | --- |');
  for (const { name, rows } of results) {
    const cell = (p) =>
      `${rows[p].count} / ${fmtBytes(rows[p].bytes)} / ${fmtTokens(rows[p].tokens)}`;
    lines.push(`| ${name} | ${cell('full')} | ${cell('core')} | ${cell('developer')} |`);
  }
  lines.push('');
  lines.push(
    '_`~tokens` is a `bytes / 4` heuristic (spec §2.7) — no tokenizer dependency. ' +
      '`tools/list` bytes are the REAL SDK-serialized payload (Zod→JSON-schema ' +
      'conversion included), driven through the actual `tools/list` request handler._',
  );
  return lines.join('\n');
}
