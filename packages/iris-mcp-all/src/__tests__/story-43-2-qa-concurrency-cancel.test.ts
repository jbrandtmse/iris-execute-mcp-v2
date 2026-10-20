/**
 * Story 43.2 QA (AC 43.2.1, 43.2.3; AD-3, AD-19; Rule #59) - several modern requests in flight on one connection, and cancellation.
 *
 * A holding proxy sits between the BUILT dev server and fake IRIS listener A (127.0.0.1 only; no IRIS instance is reached): a read of
 * `Demo.Slow.cls` waits there until the test releases it, so a request is genuinely in flight while others are sent and answered.
 *  - Concurrency: a slow read, a fast read, a read of the other profile in another namespace, a denial, a listing, a schema-invalid
 *    call, a resource read and the profiles call are all written before any answer is read. The fast ones are answered while the slow
 *    one is held; every id is answered exactly once, by the tool it called (the three document reads return the same document, so
 *    the listener requests and the audit trail, not their content, tell those three apart); profile and namespace resolution are
 *    per call (the other profile's read reached only listener B, in USER); the audit trail holds one entry per call with distinct
 *    sequence numbers. The same run on the 2025-11-25 era gives the same answers (AC 43.2.3).
 *  - Cancellation (`notifications/cancelled`): a cancelled request gets no answer, not even after its held IRIS call completes and
 *    the proxy has written that reply back to the server (revision, cancellation: "MUST NOT send any further messages for it"); a
 *    cancel of an unknown id, of a finished request, and one
 *    without a `requestId` are ignored; the connection, the other requests and the gates are unaffected, on both eras, with and
 *    without the envelope on the notification.
 * The file fails, never skips, on a stale dist.
 */

import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { REPO_ROOT } from "./pack-fixture";
import { GOLDEN_PACKAGES } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { staleDistReason } from "./process-gate-helpers.js";
import {
  EXAMPLE_META,
  MINIMAL_META,
  legacyInitializeParams,
  modernCall,
  startRig,
  withoutModernFields,
  type Json,
  type Rig,
} from "./story-43-2-qa-hand-wire";

type Era = "legacy" | "modern";

const SLOW = { name: "Demo.Slow.cls" };
const FAST = { name: "Demo.Sample.cls" };
const DOC_GET_A = "GET /api/atelier/v8/HSCUSTOM/doc/Demo.Sample.cls";
const DOC_GET_B = "GET /api/atelier/v8/USER/doc/Demo.Sample.cls";
const DENIAL = { action: "execute", source: "A", target: "B" };

/** How long a request that is not the held one may take to be answered; a local answer takes milliseconds. */
const ANSWER_WHILE_HELD_MS = 8_000;

const stale = ["shared", ...GOLDEN_PACKAGES].map((pkg) => [pkg, staleDistReason(REPO_ROOT, pkg)] as const).filter(([, reason]) => reason !== undefined);
if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([pkg, reason]) => `${pkg}: ${reason}`).join("; ")}`);

/**
 * A proxy to listener A that holds every read of `Demo.Slow.cls` until released, then forwards it as a read of `Demo.Sample.cls`.
 * `replied` counts the held reads whose reply exchange with the server has ended: the proxy finished writing the reply back, or the
 * server closed that connection first.
 */
function holdingProxy(): {
  interpose: (upstreamPort: number) => Promise<{ port: number; close: () => Promise<void> }>;
  held: () => number;
  replied: () => number;
  release: () => void;
} {
  const waiting: Array<() => void> = [];
  let replied = 0;
  return {
    held: () => waiting.length,
    replied: () => replied,
    release: () => {
      for (const go of waiting.splice(0)) go();
    },
    interpose: async (upstreamPort) => {
      const forward = (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer, rewrite: boolean): void => {
        const upstream = http.request(
          {
            host: "127.0.0.1",
            port: upstreamPort,
            method: req.method,
            path: rewrite ? (req.url ?? "").replace("Demo.Slow.cls", "Demo.Sample.cls") : req.url,
            headers: req.headers,
          },
          (reply) => {
            res.writeHead(reply.statusCode ?? 502, reply.headers);
            reply.pipe(res);
          },
        );
        upstream.on("error", () => {
          res.writeHead(502);
          res.end();
        });
        upstream.end(body);
      };
      const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const body = Buffer.concat(chunks);
          if (req.method === "GET" && (req.url ?? "").includes("/doc/Demo.Slow.cls")) {
            res.once("close", () => {
              replied += 1;
            });
            waiting.push(() => forward(req, res, body, true));
          } else forward(req, res, body, false);
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return {
        port: (server.address() as { port: number }).port,
        close: () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      };
    },
  };
}

const rigs: Rig[] = [];
afterEach(async () => {
  while (rigs.length > 0) await rigs.pop()!.stop();
});

/** Start the rig behind the holding proxy and open the connection on `era`. */
async function open(era: Era): Promise<{ rig: Rig; proxy: ReturnType<typeof holdingProxy>; call: (id: number, name: string, args: Json, meta?: Json) => void }> {
  const proxy = holdingProxy();
  const rig = await startRig({ interpose: proxy.interpose });
  rigs.push(rig);
  const { wire } = rig;
  if (era === "modern") {
    await wire.request(1, "server/discover", { _meta: EXAMPLE_META });
  } else {
    await wire.request(1, "initialize", legacyInitializeParams());
    wire.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
  const call = (id: number, name: string, args: Json, meta?: Json): void =>
    wire.send({ jsonrpc: "2.0", id, method: "tools/call", params: era === "modern" ? modernCall(name, args, meta) : { name, arguments: args } });
  return { rig, proxy, call };
}

async function untilHeld(proxy: ReturnType<typeof holdingProxy>, count: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (proxy.held() < count) {
    if (Date.now() > deadline) throw new Error(`the proxy holds ${proxy.held()} requests, expected ${count}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Wait until the proxy has written `count` released replies back to the server, so a silence after that is the server's. */
async function untilReplied(proxy: ReturnType<typeof holdingProxy>, count: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (proxy.replied() < count) {
    if (Date.now() > deadline) throw new Error(`the proxy has written ${proxy.replied()} held replies, expected ${count}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

interface Concurrent {
  answers: Record<string, Json>;
  a: string[];
  b: string[];
  audit: Json[];
}

/** Eight requests written back to back on `era`, one of them held in IRIS; what each answered, what each listener saw, what was audited. */
async function runConcurrent(era: Era): Promise<Concurrent> {
  const { rig, proxy, call } = await open(era);
  const { wire } = rig;
  const listParams = era === "modern" ? { _meta: MINIMAL_META } : {};
  call(10, "iris_doc_get", SLOW);
  await untilHeld(proxy, 1);
  call(11, "iris_doc_get", FAST);
  call(12, "iris_doc_get", { ...FAST, server: "other", namespace: "USER" });
  call(13, "iris_env_promote", DENIAL);
  wire.send({ jsonrpc: "2.0", id: 14, method: "tools/list", params: listParams });
  call(15, "iris_doc_get", { name: 12345 });
  wire.send({ jsonrpc: "2.0", id: 16, method: "resources/read", params: { uri: "iris-governance://other", ...listParams } });
  call(17, "iris_server_profiles", {});
  const labels: Record<number, string> = { 10: "slow", 11: "fast", 12: "other-profile", 13: "denial", 14: "list", 15: "invalid", 16: "resource", 17: "profiles" };
  const answers: Record<string, Json> = {};
  // Answered while the slow read is held in IRIS: a server that serves one call at a time never answers these.
  for (const id of [11, 12, 13, 14, 15, 16, 17]) answers[labels[id]!] = withoutModernFields((await wire.response(id, ANSWER_WHILE_HELD_MS)).message.result);
  expect(wire.responsesTo(10), "the held request is still unanswered while the others were answered").toHaveLength(0);
  proxy.release();
  answers[labels[10]!] = withoutModernFields((await wire.response(10)).message.result);
  for (const id of Object.keys(labels).map(Number)) expect(wire.responsesTo(id), `request ${id} is answered exactly once`).toHaveLength(1);
  const audit = await rig.audit(1 + 6);
  return { answers, a: rig.requests.a(), b: rig.requests.b(), audit };
}

describe.each(["legacy", "modern"] as const)("eight requests in flight on the %s era", (era) => {
  it("answers each with its own result, resolves profile and namespace per call, and audits each call once", async () => {
    const run = await runConcurrent(era);
    const { answers } = run;
    expect(answers["fast"].structuredContent.name).toBe("Demo.Sample.cls");
    expect(answers["slow"].structuredContent.name, "the held read completes with its own answer").toBe("Demo.Sample.cls");
    expect(answers["other-profile"].structuredContent.name).toBe("Demo.Sample.cls");
    expect(answers["denial"].structuredContent).toMatchObject({ code: "GOVERNANCE_DISABLED", action: "iris_env_promote:execute" });
    expect(answers["list"].tools.length).toBeGreaterThan(0);
    expect(answers["invalid"].isError).toBe(true);
    expect(answers["invalid"].content[0].text).toContain("Input validation error");
    expect(answers["resource"].contents[0].uri).toBe("iris-governance://other");
    expect(typeof JSON.parse(answers["resource"].contents[0].text).policy).toBe("object");
    expect(answers["profiles"].structuredContent.defaultProfile).toBe("default");

    expect(run.a.filter((request) => request.includes("/doc/")), "the fast read and the released slow read reached A in HSCUSTOM").toEqual([DOC_GET_A, DOC_GET_A]);
    expect(run.b.filter((request) => request.includes("/doc/")), "only the other profile's read reached B, in USER").toEqual([DOC_GET_B]);
    const calls = run.audit.slice(1);
    expect(run.audit[0].type).toBe("sessionStart");
    expect(new Set(calls.map((entry) => entry.seq)).size, "distinct sequence numbers").toBe(calls.length);
    expect(calls.map((entry) => entry.seq).sort((x: number, y: number) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(calls.map((entry) => `${entry.tool}:${entry.profile}:${entry.namespace}:${entry.outcome}`).sort()).toEqual(
      [
        "iris_doc_get:default:HSCUSTOM:ok",
        "iris_doc_get:default:HSCUSTOM:ok",
        "iris_doc_get:default:HSCUSTOM:error",
        "iris_doc_get:other:USER:ok",
        "iris_env_promote:default:HSCUSTOM:denied",
        "iris_server_profiles:default:HSCUSTOM:ok",
      ].sort(),
    );
  });
});

describe("the two eras answer a concurrent burst alike", () => {
  it("every answer, every request each listener saw and every audit entry except the order of the sequence numbers are the same", async () => {
    const legacy = await runConcurrent("legacy");
    const modern = await runConcurrent("modern");
    // Each run has listeners of its own: the profiles call reports their ports, which are the one thing that may differ.
    const unported = (answer: Json): string =>
      JSON.stringify(answer)
        .replace(/(port\\*"\s*:\s*)\d+/g, (_match, head: string) => `${head}0`)
        .replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:0");
    expect(Object.keys(modern.answers)).toEqual(Object.keys(legacy.answers));
    for (const label of Object.keys(legacy.answers)) expect(unported(modern.answers[label]), label).toBe(unported(legacy.answers[label]));
    expect(modern.a).toEqual(legacy.a);
    expect(modern.b).toEqual(legacy.b);
    const byTool = (audit: Json[]): string[] =>
      audit.map(({ seq: _seq, ...entry }) => JSON.stringify(entry)).sort();
    expect(byTool(modern.audit)).toEqual(byTool(legacy.audit));
  });
});

describe.each(["legacy", "modern"] as const)("cancellation on the %s era", (era) => {
  it("a cancelled request gets no answer even after its IRIS call completes; ignored cancels and the next requests are unaffected", async () => {
    const { rig, proxy, call } = await open(era);
    const { wire } = rig;
    call(10, "iris_doc_get", SLOW);
    await untilHeld(proxy, 1);
    call(11, "iris_doc_get", FAST);
    const fast = withoutModernFields((await wire.response(11, ANSWER_WHILE_HELD_MS)).message.result);

    // The forms of cancellation: a cancel of the held request, then cancels that must be ignored.
    wire.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 10, reason: "story-43-2 qa" } });
    wire.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 999 } });
    wire.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 11 } });
    wire.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: {} });
    wire.send({ jsonrpc: "2.0", method: "notifications/cancelled" });
    await wire.quiet(200);
    expect(wire.responsesTo(10), "no answer to a cancelled request").toHaveLength(0);

    proxy.release();
    await untilReplied(proxy, 1);
    await wire.quiet(600);
    expect(wire.responsesTo(10), "still none after its IRIS call completed").toHaveLength(0);

    call(12, "iris_doc_get", FAST);
    expect(withoutModernFields((await wire.response(12)).message.result), "the next request is served as the one before").toEqual(fast);
    call(13, "iris_env_promote", DENIAL);
    expect((await wire.response(13)).message.result.structuredContent.code, "the gates are intact after a cancel").toBe("GOVERNANCE_DISABLED");

    const answered = wire.stdout().map((line) => line.message.id).sort((x: number, y: number) => x - y);
    expect(answered, "only the requests that were not cancelled were answered").toEqual([1, 11, 12, 13]);
    for (const line of wire.stdout()) expect(line.message.method, "no message from the server besides answers").toBeUndefined();
    expect(await Promise.race([wire.exit(), wire.quiet(50).then(() => "running")]), "the server is still running").toBe("running");
  });

  it("control: without a cancel, the held request is answered once its IRIS call completes", async () => {
    const { rig, proxy, call } = await open(era);
    const { wire } = rig;
    call(10, "iris_doc_get", SLOW);
    await untilHeld(proxy, 1);
    await wire.quiet(200);
    expect(wire.responsesTo(10)).toHaveLength(0);
    proxy.release();
    expect((await wire.response(10)).message.result.structuredContent.name, "so the silence after a cancel is the cancel's doing").toBe("Demo.Sample.cls");
  });

  if (era === "modern") {
    it("a cancel that carries the envelope in its _meta cancels the same way", async () => {
      const { rig, proxy, call } = await open(era);
      const { wire } = rig;
      call(20, "iris_doc_get", SLOW);
      await untilHeld(proxy, 1);
      wire.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 20, reason: "with the envelope", _meta: MINIMAL_META } });
      await wire.quiet(200);
      proxy.release();
      await untilReplied(proxy, 1);
      await wire.quiet(600);
      expect(wire.responsesTo(20)).toHaveLength(0);
      call(21, "iris_doc_get", FAST);
      expect((await wire.response(21)).message.result.resultType).toBe("complete");
    });
  }
});
