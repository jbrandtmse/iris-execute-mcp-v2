/**
 * Story 43.4 QA (DW-641, AC 43.4.3 docs; Rules #3, #36, #59) - the probe copy that a TypeScript MCP SDK v2 client starts, observed on the
 * real SDK client against the built admin server and a fake IRIS listener.
 *
 * `docs/client-config/README.md` says that a client in `auto` mode or pinned to a revision first starts a short-lived probe copy of the
 * server, which runs the whole startup, answers `server/discover` and is ended by the client with SIGTERM; that the server therefore
 * starts twice per connect, that `IRIS_AUDIT_LOG` gains a second `sessionStart` line, which is the only line of the probe's session (no
 * stdio session writes a `shutdown` line), and that the probe's stderr is discarded; that a client on `auto` whose probe is not answered
 * within the request timeout (60 seconds by default) treats the server as 2025-11-25. The root README says that a stdio server whose
 * client closes its input writes no `shutdown` line. The documents are pinned by `story-43-4-doc-claims.test.ts`; this file observes
 * the behavior, per negotiation mode:
 *  - the process starts, through a launcher that records its pid and every SIGTERM before it hands over to the built server (the
 *    launcher exits on SIGTERM only when no other SIGTERM listener exists, so a handler the server installs still runs);
 *  - the SIGTERM that ends the probe is observed on the client side, by a `ChildProcess.prototype.kill` spy, because the SDK ends the
 *    probe's stdin first and a loaded probe that sees the EOF exits before its own SIGTERM listener runs;
 *  - the `sessionStart` and `shutdown` lines of the audit file, read again after the client has closed and every process has exited,
 *    and the bootstrap version queries the listener receives;
 *  - the startup lines on the stderr that the client forwards (the probe's are discarded);
 *  - whether any started process outlives the client.
 * The silent-probe row delays the first start past the probe timeout (`versionNegotiation.probe.timeoutMs`) and expects the 2025-11-25
 * handshake; the SDK's default timeout is read from the installed client. Whether Claude Code probes on the same connection and starts
 * the server once is the lead's live check (a client this suite does not run).
 *
 * Servers run through `sdk-confirmation-rig.ts` against a 127.0.0.1 listener; no IRIS instance is reached. A stale dist or a missing SDK
 * client fails the file.
 */

import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readAuditEntries } from "../../../../scripts/lib/audit-lines.mjs";
import { REPO_ROOT } from "./pack-fixture";
import { distEntry, resolveSdkEsmDir } from "./process-gate-helpers.js";
import { sleep } from "./monitor-gate-helpers.js";
import type { SdkClient, SdkVersionNegotiation } from "./process-gate-helpers.js";
import { closeSdkRigs, openSdkRig } from "./sdk-confirmation-rig.js";
import { LEGACY_ERA_LINE, MODERN_ERA_LINE } from "./story-43-2-qa-hand-wire.js";

const PKG = "iris-admin-mcp";

/** Records each start and every SIGTERM of the process, delays the first start when asked, then runs the built server. */
const LAUNCHER = `import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const record = (event) => appendFileSync(process.env.QA_EVENTS_FILE, JSON.stringify({ event, pid: process.pid }) + "\\n");
process.on("SIGTERM", () => {
  record("SIGTERM");
  if (process.listenerCount("SIGTERM") === 1) process.exit(143);
});
const first = !existsSync(process.env.QA_FIRST_MARKER);
if (first) writeFileSync(process.env.QA_FIRST_MARKER, "1");
record("start");
const delay = Number(process.env.QA_DELAY_FIRST_MS || 0);
if (first && delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
await import(process.env.QA_REAL_ENTRY);
`;

interface Harness {
  client: SdkClient;
  stderr: () => string;
  /** Every `start` and `SIGTERM` the launcher recorded, in order. */
  events: () => Array<{ event: "start" | "SIGTERM"; pid: number }>;
  /** Every line of the audit file. */
  audit: () => Array<{ type: string; session: string }>;
  /** The bootstrap version queries the listener has received. */
  bootstrapQueries: () => number;
  /** Every `kill` the client made on a child process before `open()` resolved: the process and the signal sent to it. */
  signalsSentBeforeOpen: Array<{ pid: number | undefined; signal: NodeJS.Signals | number | undefined }>;
}

const directories: string[] = [];
let killSpy: MockInstance | undefined;

afterEach(async () => {
  killSpy?.mockRestore();
  killSpy = undefined;
  await closeSdkRigs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Poll `read` until `done` accepts it or `timeoutMs` passes; returns the last value either way. */
async function settle<T>(read: () => T, done: (value: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(25);
    value = read();
  }
  return value;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Connect the real SDK client to the built admin server through the launcher, in `negotiation`. */
async function open(negotiation: SdkVersionNegotiation, delayFirstStartMs = 0): Promise<Harness> {
  const directory = mkdtempSync(path.join(tmpdir(), "story-43-4-probe-"));
  directories.push(directory);
  const launcher = path.join(directory, "launcher.mjs");
  const eventsFile = path.join(directory, "events.jsonl");
  writeFileSync(launcher, LAUNCHER);
  // The client ends a probe copy with SIGTERM right after stdin EOF. A loaded probe sees the EOF first and exits before its own
  // SIGTERM listener runs, so what the client SENT is observed on the client side, in this process.
  const kills: Harness["signalsSentBeforeOpen"] = [];
  const kill = ChildProcess.prototype.kill;
  killSpy?.mockRestore();
  killSpy = vi.spyOn(ChildProcess.prototype, "kill").mockImplementation(function (this: ChildProcess, signal?: NodeJS.Signals | number) {
    kills.push({ pid: this.pid, signal });
    return kill.call(this, signal);
  });
  const rig = await openSdkRig(PKG, negotiation, {
    clientName: "story-43-4-probe",
    entry: launcher,
    env: {
      QA_EVENTS_FILE: eventsFile,
      QA_FIRST_MARKER: path.join(directory, "first"),
      QA_DELAY_FIRST_MS: String(delayFirstStartMs),
      QA_REAL_ENTRY: pathToFileURL(distEntry(REPO_ROOT, PKG)).href,
      LOG_LEVEL: "INFO",
    },
  });
  const signalsSentBeforeOpen = kills.slice();
  return {
    client: rig.client,
    stderr: rig.stderr,
    events: () => readAuditEntries(eventsFile) as unknown as Array<{ event: "start" | "SIGTERM"; pid: number }>,
    audit: () => readAuditEntries(rig.auditFile) as unknown as Array<{ type: string; session: string }>,
    signalsSentBeforeOpen,
    bootstrapQueries: () => rig.requests().filter((request) => request.method === "POST" && request.url.endsWith("/action/query") && request.body.includes("Setup_GetBootstrapVersion")).length,
  };
}

const starts = (harness: Harness): number[] => harness.events().filter((entry) => entry.event === "start").map((entry) => entry.pid);
const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

describe("a client on the TypeScript MCP SDK v2: how many times the built server starts per connect", () => {
  it("legacy: one start, one sessionStart line, one bootstrap version query, one startup on stderr, and no shutdown line after the client closes", async () => {
    const harness = await open({ mode: "legacy" });
    await harness.client.listTools();
    await settle(harness.audit, (lines) => lines.length >= 1);
    await sleep(300);

    expect(harness.client.getProtocolEra()).toBe("legacy");
    const pids = starts(harness);
    expect(pids, "one process was started").toHaveLength(1);
    expect(harness.audit().filter((line) => line.type === "sessionStart")).toHaveLength(1);
    expect(harness.bootstrapQueries(), "one bootstrap version query").toBe(1);
    expect(countOf(harness.stderr(), "starting with Atelier API"), "one startup on stderr").toBe(1);

    // The client closes the server's input, as the stdio transport asks, and the session ends.
    await harness.client.close();
    expect(await settle(() => alive(pids[0] as number), (isAlive) => !isAlive), "the server does not outlive the client").toBe(false);
    expect(harness.audit().filter((line) => line.type === "shutdown"), "a session its client closes writes no shutdown line").toEqual([]);
  }, 60_000);

  it.each([
    ["pinned 2026-07-28", { mode: { pin: "2026-07-28" } } as SdkVersionNegotiation],
    ["auto", { mode: "auto" } as SdkVersionNegotiation],
  ])("%s: a probe copy runs the whole startup first, so there are two starts, two sessionStart lines and two bootstrap version queries, and the probe's stderr is discarded", async (_name, negotiation) => {
    const harness = await open(negotiation);
    await harness.client.listTools();
    const audit = await settle(harness.audit, (lines) => lines.filter((line) => line.type === "sessionStart").length >= 2);
    const stderr = await settle(harness.stderr, (text) => text.includes(MODERN_ERA_LINE));
    await sleep(300);

    expect(harness.client.getProtocolEra()).toBe("modern");
    const pids = starts(harness);
    expect(new Set(pids).size, "two different processes were started").toBe(2);
    const sessionStarts = audit.filter((line) => line.type === "sessionStart");
    expect(sessionStarts, "IRIS_AUDIT_LOG gains a second sessionStart line").toHaveLength(2);
    expect(new Set(sessionStarts.map((line) => line.session)).size, "from two sessions").toBe(2);
    expect(harness.audit().filter((line) => line.type === "sessionStart"), "and no third").toHaveLength(2);
    expect(harness.bootstrapQueries(), "the probe ran the bootstrap version query too").toBe(2);
    expect(countOf(harness.stderr(), "starting with Atelier API"), "only one startup reaches the client's stderr").toBe(1);
    expect(countOf(stderr, MODERN_ERA_LINE), "and one era line").toBe(1);
    expect(countOf(harness.stderr(), LEGACY_ERA_LINE), "and none of the other era").toBe(0);

    // The probe is ended by the client with SIGTERM before open() resolved: the client sent it to the probe's pid, which is the first
    // process the launcher started.
    const probe = pids[0] as number;
    const sigtermPids = harness.signalsSentBeforeOpen.filter((sent) => sent.signal === "SIGTERM").map((sent) => sent.pid);
    expect(sigtermPids, "the client sent SIGTERM to the probe, and to nothing else, before open() resolved").toEqual([probe]);
    expect(pids, "and the probe is one of the processes the launcher started").toContain(sigtermPids[0]);
    expect(await settle(() => alive(probe), (isAlive) => !isAlive), "the probe is gone while the session goes on").toBe(false);
    expect(alive(pids[1] as number), "the serving process is still up").toBe(true);

    await harness.client.close();
    for (const pid of pids) expect(await settle(() => alive(pid), (isAlive) => !isAlive), `process ${pid} does not outlive the client`).toBe(false);
    const probeSession = sessionStarts[0]!.session;
    expect(harness.audit().filter((line) => line.session === probeSession), "the probe's sessionStart is the only line of its session").toEqual([sessionStarts[0]]);
    expect(harness.audit().filter((line) => line.type === "shutdown"), "neither session writes a shutdown line").toEqual([]);
  }, 60_000);

  it("auto, a probe that is not answered within the probe timeout: the client falls back to the 2025-11-25 handshake, and no process outlives the client", async () => {
    const harness = await open({ mode: "auto", probe: { timeoutMs: 400 } }, 2_500);

    expect(harness.client.getProtocolEra()).toBe("legacy");
    expect(harness.client.getNegotiatedProtocolVersion()).toBe("2025-11-25");
    expect(((await harness.client.listTools()) as { tools: unknown[] }).tools.length).toBeGreaterThan(20);
    const pids = starts(harness);
    expect(new Set(pids).size, "the silent probe and the serving process").toBe(2);
    expect(countOf(await settle(harness.stderr, (text) => text.includes(LEGACY_ERA_LINE)), LEGACY_ERA_LINE)).toBe(1);
    await harness.client.close();
    for (const pid of pids) expect(await settle(() => alive(pid), (isAlive) => !isAlive), `process ${pid} does not outlive the client`).toBe(false);
  }, 60_000);

  it("the probe timeout the docs name is the installed SDK client's default: 60 seconds", () => {
    const sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    expect(sdkEsmDir, "the SDK client is installed").toBeDefined();
    const declarations = readdirSync(sdkEsmDir as string)
      .filter((name) => name.endsWith(".mjs"))
      .flatMap((name) => readFileSync(path.join(sdkEsmDir as string, name), "utf8").match(/const DEFAULT_REQUEST_TIMEOUT_MSEC = [^;\n]+/g) ?? []);
    expect(declarations.map((declaration) => Number(declaration.split("=")[1]!.trim()))).toEqual([60_000]);
    expect(readFileSync(path.join(REPO_ROOT, "docs", "client-config", "README.md"), "utf8")).toContain("(60 seconds by default)");
  });
});
