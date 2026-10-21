/**
 * Story 43.1 (AC 43.1.3; project rules #36, #59) - the contract of the SDK-free stdio driver (`openRawWire` in
 * `scripts/lib/sdk-wire-golden-core.mjs`) that the golden pin test and `story-41-5-qa-dist-consumer.test.ts` read the
 * servers' bytes with.
 *
 * A fake server (a few lines of Node, written to a temporary directory by each row's setup) answers three requests:
 *  - `ping`: first a REQUEST of its own that carries the same `id`, then the response. The driver must resolve with the
 *    response line, never with the server's own request;
 *  - `junk`: a stdout line that is not JSON. The driver must reject the pending request, not throw out of the stream handler;
 *  - `bye`: a response, then the process exits. A request made after that must be rejected at once, not left to time out.
 *
 * The fake server touches no IRIS instance and no network.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openRawWire } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";

const FAKE_SERVER = [
  "const readline = require('node:readline');",
  "const lines = readline.createInterface({ input: process.stdin });",
  "lines.on('line', (line) => {",
  "  const request = JSON.parse(line);",
  "  const send = (frame, done) => process.stdout.write(JSON.stringify(frame) + '\\n', done);",
  "  if (request.method === 'ping') {",
  "    send({ jsonrpc: '2.0', id: request.id, method: 'roots/list' });",
  "    send({ jsonrpc: '2.0', id: request.id, result: { answered: 'ping' } });",
  "  } else if (request.method === 'junk') {",
  "    process.stdout.write('this is not json\\n');",
  "  } else if (request.method === 'bye') {",
  "    send({ jsonrpc: '2.0', id: request.id, result: { answered: 'bye' } }, () => process.exit(0));",
  "  }",
  "});",
].join("\n");

let workDir: string;
let entry: string;
const opened: Array<ReturnType<typeof openRawWire>> = [];

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "story-43-1-raw-wire-"));
  entry = path.join(workDir, "fake-server.cjs");
  writeFileSync(entry, FAKE_SERVER);
});

afterEach(async () => {
  for (const wire of opened.splice(0)) await wire.close().catch(() => {});
  rmSync(workDir, { recursive: true, force: true });
});

function open(): ReturnType<typeof openRawWire> {
  const wire = openRawWire({ entry, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 10_000 });
  opened.push(wire);
  return wire;
}

describe("the raw stdio driver", () => {
  it("resolves a request with the response line, and not with a request the server sent under the same id", async () => {
    const frame = await open().request("ping");
    expect(frame.line).toBe(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { answered: "ping" } }));
    expect(frame.message.method).toBeUndefined();
  });

  it("rejects the pending request, naming the line, when the server writes a stdout line that is not JSON", async () => {
    await expect(open().request("junk")).rejects.toThrow(/not JSON: this is not json/);
  });

  it("rejects a request made after the server has exited", async () => {
    const wire = open();
    await wire.request("bye");
    expect(await wire.exit()).toEqual({ code: 0, signal: null });
    await expect(wire.request("ping")).rejects.toThrow(/^the server had already exited before ping$/);
  });
});
