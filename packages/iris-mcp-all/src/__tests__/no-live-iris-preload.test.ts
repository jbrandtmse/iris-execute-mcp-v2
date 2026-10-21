/**
 * Story 42.2 (DW-627) QA - the contract of the connection-refusing preload `scripts/lib/no-live-iris-preload.mjs`, driven
 * directly in child Node processes.
 *
 * `live-arming-guard.test.ts` uses the preload as the oracle of "an unarmed run connects to nothing", and its control proves
 * that a connect to ONE explicitly watched stand-in port is refused and logged. That leaves the rest of the preload's
 * documented contract unpinned: the default watched ports 52773 and 1972, the replacement of the defaults by
 * `IRIS_MCP_WATCH_PORTS`, the inert host `unarmed.invalid`, appending to `IRIS_MCP_CONNECT_LOG`, the pass-through of every
 * connect that is not watched, and the call shapes the interception understands. An oracle that cannot tell a refused
 * connect from a passed one, or that watches the wrong ports, makes every "connects to nothing" assertion vacuous.
 *
 * Every case runs in its own child Node process with `--import <preload>` and an environment built from scratch (no IRIS_*
 * variable of this run reaches it). Stand-in listeners are local ephemeral ports of this test; the connects aimed at the
 * default ports use the non-routable 192.0.2.1 (TEST-NET-1), so even a preload that failed to refuse would reach no
 * instance. No IRIS is contacted.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PRELOAD_URL = pathToFileURL(path.join(REPO_ROOT, "scripts", "lib", "no-live-iris-preload.mjs")).href;

/** Reported by the child for a connect the preload refused (its error message names the preload). */
const REFUSED = "refused";
const REACHED = "reached";
const PENDING = "pending";

/** One connect the child makes, by the call shape it uses. */
interface ConnectStep {
  id: string;
  shape: "port-host" | "options" | "port-only" | "socket-connect" | "path-string" | "path-options";
  host?: string;
  port?: number;
  path?: string;
}

/**
 * The child: makes each planned connect and prints `PRELOAD_RESULT {id: outcome}`. A connect is `refused` when the error
 * names the preload, `reached` when the socket connects, `pending` when nothing happened within the timeout, and
 * `error:<code>` otherwise (a connect that was not refused but failed on its own, such as a name that does not resolve).
 */
const CONNECT_CHILD = `
import net from "node:net";
const plan = JSON.parse(process.env.PRELOAD_TEST_PLAN);
function open(step) {
  switch (step.shape) {
    case "port-host": return net.connect(step.port, step.host);
    case "options": return net.connect({ port: step.port, host: step.host });
    case "port-only": return net.connect(step.port);
    case "socket-connect": return new net.Socket().connect(step.port, step.host);
    case "path-string": return net.connect(step.path);
    case "path-options": return net.connect({ path: step.path });
    default: throw new Error("unknown shape " + step.shape);
  }
}
function attempt(step) {
  return new Promise((resolve) => {
    let finished = false;
    let timer;
    const finish = (outcome) => { if (!finished) { finished = true; clearTimeout(timer); resolve(outcome); } };
    let socket;
    try { socket = open(step); } catch (error) { finish("threw:" + error.code); return; }
    socket.once("connect", () => { socket.destroy(); finish("reached"); });
    socket.once("error", (error) => finish(/refused by no-live-iris-preload/.test(error.message) ? "refused" : "error:" + (error.code ?? "?")));
    timer = setTimeout(() => { socket.destroy(); finish("pending"); }, plan.timeoutMs);
  });
}
const results = {};
for (const step of plan.steps) results[step.id] = await attempt(step);
console.log("PRELOAD_RESULT " + JSON.stringify(results));
`;

/** The child for the pure exports: prints `PRELOAD_RESULT <value of the expression in PRELOAD_TEST_EXPRESSION>`. */
const EXPORTS_CHILD = `
const preload = await import(process.env.PRELOAD_URL);
const calls = JSON.parse(process.env.PRELOAD_TEST_CALLS);
const out = calls.map((call) => call.fn === "connectTargetOf" ? preload.connectTargetOf(call.args) : preload.isWatched(call.target === null ? undefined : call.target));
console.log("PRELOAD_RESULT " + JSON.stringify(out.map((value) => value === undefined ? null : value)));
`;

const scratchDirs: string[] = [];
const listeners: net.Server[] = [];

afterEach(async () => {
  for (const server of listeners.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const directory of scratchDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function scratchDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "no-live-iris-preload-test-"));
  scratchDirs.push(directory);
  return directory;
}

/**
 * A local listener that counts the connections it accepts. `spawnSync` blocks this process's event loop while the child
 * runs, so the listener accepts the child's connections only afterwards: `reached()` first gives the loop time to do so.
 */
async function startListener(listenOn: { port: number; host: string } | { path: string }): Promise<{ port: number; reached: () => Promise<number> }> {
  let count = 0;
  const server = net.createServer((socket) => {
    count += 1;
    socket.destroy();
  });
  listeners.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    if ("path" in listenOn) server.listen(listenOn.path, resolve);
    else server.listen(listenOn.port, listenOn.host, resolve);
  });
  const address = server.address();
  return {
    port: typeof address === "object" && address !== null ? address.port : 0,
    reached: async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      return count;
    },
  };
}

interface ChildRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run `code` as an ES module in a child Node with the preload loaded and the given variables only. */
function runChild(code: string, env: Record<string, string>): ChildRun {
  const result = spawnSync(process.execPath, ["--import", PRELOAD_URL, "--input-type=module", "-e", code], {
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function resultOf<T>(run: ChildRun): T {
  const line = run.stdout.split("\n").find((candidate) => candidate.startsWith("PRELOAD_RESULT "));
  if (line === undefined) throw new Error(`the child printed no result (exit ${run.status}): ${run.stdout}${run.stderr}`);
  return JSON.parse(line.slice("PRELOAD_RESULT ".length)) as T;
}

/** Run `steps` under the preload with `env`; the outcome of each step by id, and what the preload logged. */
function connectUnderPreload(
  steps: ConnectStep[],
  env: Record<string, string>,
  logFile: string | undefined,
  timeoutMs = 1500,
): { outcomes: Record<string, string>; logged: string[]; run: ChildRun } {
  const run = runChild(CONNECT_CHILD, {
    PRELOAD_TEST_PLAN: JSON.stringify({ steps, timeoutMs }),
    ...(logFile === undefined ? {} : { IRIS_MCP_CONNECT_LOG: logFile }),
    ...env,
  });
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  let logged: string[] = [];
  if (logFile !== undefined) {
    try {
      logged = readFileSync(logFile, "utf8").split("\n").filter((line) => line !== "");
    } catch {
      logged = [];
    }
  }
  return { outcomes: resultOf<Record<string, string>>(run), logged, run };
}

describe("the preload's default watch list: IRIS_MCP_WATCH_PORTS unset (the web port 52773 and the superserver port 1972)", () => {
  it("refuses and logs a connect to 52773 and to 1972, whatever the host, before any packet is sent", () => {
    const log = path.join(scratchDir(), "connects.log");

    const { outcomes, logged } = connectUnderPreload(
      [
        { id: "web", shape: "port-host", host: "192.0.2.1", port: 52773 },
        { id: "super", shape: "options", host: "192.0.2.1", port: 1972 },
        { id: "bare", shape: "port-only", port: 52773 },
      ],
      {},
      log,
    );

    expect(outcomes).toEqual({ web: REFUSED, super: REFUSED, bare: REFUSED });
    expect(logged).toEqual(["192.0.2.1:52773", "192.0.2.1:1972", "localhost:52773"]);
  });

  it("does not refuse another port: a connect to 192.0.2.1:52774 is left to the network, and nothing is logged", () => {
    const log = path.join(scratchDir(), "connects.log");

    const { outcomes, logged } = connectUnderPreload([{ id: "other", shape: "port-host", host: "192.0.2.1", port: 52774 }], {}, log);

    expect(outcomes["other"]).not.toBe(REFUSED);
    expect(logged).toEqual([]);
  });

  it("refuses the inert host of an unarmed live leg, on any port, and logs it", () => {
    const log = path.join(scratchDir(), "connects.log");

    const { outcomes, logged } = connectUnderPreload(
      [
        { id: "inert", shape: "options", host: "unarmed.invalid", port: 9999 },
        { id: "upper", shape: "port-host", host: "UNARMED.INVALID", port: 8080 },
      ],
      {},
      log,
    );

    expect(outcomes).toEqual({ inert: REFUSED, upper: REFUSED });
    expect(logged).toEqual(["unarmed.invalid:9999", "UNARMED.INVALID:8080"]);
  });
});

describe("IRIS_MCP_WATCH_PORTS and IRIS_MCP_WATCH_HOSTS replace the defaults", () => {
  it("watches exactly the listed ports: the listed one is refused and never reached, an unlisted one passes through unlogged, and 52773 is no longer watched", async () => {
    const watched = await startListener({ port: 0, host: "127.0.0.1" });
    const unwatched = await startListener({ port: 0, host: "127.0.0.1" });
    const log = path.join(scratchDir(), "connects.log");

    const { outcomes, logged } = connectUnderPreload(
      [
        { id: "watched", shape: "port-host", host: "127.0.0.1", port: watched.port },
        { id: "unwatched", shape: "port-host", host: "127.0.0.1", port: unwatched.port },
        { id: "default-port", shape: "port-host", host: "192.0.2.1", port: 52773 },
      ],
      { IRIS_MCP_WATCH_PORTS: String(watched.port) },
      log,
    );

    expect(outcomes["watched"]).toBe(REFUSED);
    expect(outcomes["unwatched"]).toBe(REACHED);
    expect(outcomes["default-port"], "the override replaces the defaults, so 52773 is not refused by the preload").not.toBe(REFUSED);
    expect(logged).toEqual([`127.0.0.1:${watched.port}`]);
    expect(await watched.reached(), "the refused connect never reached the listener").toBe(0);
    expect(await unwatched.reached(), "the pass-through connect did reach its listener").toBe(1);
  });

  it("accepts a comma-separated list with spaces and empty entries", () => {
    const log = path.join(scratchDir(), "connects.log");

    const { outcomes, logged } = connectUnderPreload(
      [
        { id: "a", shape: "port-host", host: "192.0.2.1", port: 41001 },
        { id: "b", shape: "port-host", host: "192.0.2.1", port: 41002 },
      ],
      { IRIS_MCP_WATCH_PORTS: " 41001 , ,41002," },
      log,
    );

    expect(outcomes).toEqual({ a: REFUSED, b: REFUSED });
    expect(logged).toEqual(["192.0.2.1:41001", "192.0.2.1:41002"]);
  });

  it("an empty IRIS_MCP_WATCH_PORTS watches no port, and the inert host stays watched", () => {
    const log = path.join(scratchDir(), "connects.log");

    const { outcomes, logged } = connectUnderPreload(
      [
        { id: "web", shape: "port-host", host: "192.0.2.1", port: 52773 },
        { id: "inert", shape: "port-host", host: "unarmed.invalid", port: 9999 },
      ],
      { IRIS_MCP_WATCH_PORTS: "" },
      log,
    );

    expect(outcomes["web"]).not.toBe(REFUSED);
    expect(outcomes["inert"]).toBe(REFUSED);
    expect(logged).toEqual(["unarmed.invalid:9999"]);
  });

  it("IRIS_MCP_WATCH_HOSTS replaces the inert default host", () => {
    const log = path.join(scratchDir(), "connects.log");

    const { outcomes, logged } = connectUnderPreload(
      [
        { id: "listed", shape: "port-host", host: "iris-stand-in.invalid", port: 9998 },
        { id: "default-host", shape: "port-host", host: "unarmed.invalid", port: 9999 },
      ],
      { IRIS_MCP_WATCH_HOSTS: "iris-stand-in.invalid" },
      log,
    );

    expect(outcomes["listed"]).toBe(REFUSED);
    expect(outcomes["default-host"], "unarmed.invalid is no longer watched").not.toBe(REFUSED);
    expect(logged).toEqual(["iris-stand-in.invalid:9998"]);
  });
});

describe("the connect log", () => {
  it("is appended to, one `<host>:<port>` line per refused connect, keeping what the file already held", () => {
    const log = path.join(scratchDir(), "connects.log");
    writeFileSync(log, "earlier-run:1\n");

    const { logged } = connectUnderPreload(
      [
        { id: "first", shape: "port-host", host: "192.0.2.1", port: 52773 },
        { id: "second", shape: "port-host", host: "192.0.2.1", port: 52773 },
        { id: "third", shape: "port-host", host: "192.0.2.1", port: 1972 },
      ],
      {},
      log,
    );

    expect(logged).toEqual(["earlier-run:1", "192.0.2.1:52773", "192.0.2.1:52773", "192.0.2.1:1972"]);
  });

  it("with no IRIS_MCP_CONNECT_LOG the connect is still refused, and the process still exits 0", () => {
    const { outcomes, run } = connectUnderPreload([{ id: "web", shape: "port-host", host: "192.0.2.1", port: 52773 }], {}, undefined);

    expect(outcomes["web"]).toBe(REFUSED);
    expect(run.status).toBe(0);
  });

  it("a log that cannot be written never turns the refusal into a connection", () => {
    const unwritable = path.join(scratchDir(), "no-such-directory", "connects.log");

    const { outcomes, run } = connectUnderPreload([{ id: "web", shape: "port-host", host: "192.0.2.1", port: 52773 }], { IRIS_MCP_CONNECT_LOG: unwritable }, undefined);

    expect(outcomes["web"]).toBe(REFUSED);
    expect(run.status).toBe(0);
  });
});

describe("what the preload leaves alone", () => {
  it("lets a connect to an unwatched local listener through, by every TCP call shape, and logs nothing", async () => {
    const listener = await startListener({ port: 0, host: "127.0.0.1" });
    const log = path.join(scratchDir(), "connects.log");

    const { outcomes, logged } = connectUnderPreload(
      [
        { id: "port-host", shape: "port-host", host: "127.0.0.1", port: listener.port },
        { id: "options", shape: "options", host: "127.0.0.1", port: listener.port },
        { id: "socket-connect", shape: "socket-connect", host: "127.0.0.1", port: listener.port },
      ],
      { IRIS_MCP_WATCH_PORTS: "52773,1972" },
      log,
    );

    expect(outcomes).toEqual({ "port-host": REACHED, options: REACHED, "socket-connect": REACHED });
    expect(logged).toEqual([]);
    expect(await listener.reached()).toBe(3);
  });

  it.skipIf(process.platform === "win32")("lets an IPC (unix socket path) connect through, as a string and as an options object, and logs nothing", async () => {
    const socketPath = path.join(scratchDir(), "ipc.sock");
    const listener = await startListener({ path: socketPath });
    const log = path.join(scratchDir(), "connects.log");

    const { outcomes, logged } = connectUnderPreload(
      [
        { id: "path-string", shape: "path-string", path: socketPath },
        { id: "path-options", shape: "path-options", path: socketPath },
      ],
      { IRIS_MCP_WATCH_PORTS: "52773,1972" },
      log,
    );

    expect(outcomes).toEqual({ "path-string": REACHED, "path-options": REACHED });
    expect(logged).toEqual([]);
    expect(await listener.reached()).toBe(2);
  });
});

describe("connectTargetOf and isWatched (the pure exports)", () => {
  /** Evaluate `connectTargetOf(args)` for each argument list, in a child that has loaded the preload. */
  function targetsOf(argLists: unknown[][]): unknown[] {
    const run = runChild(EXPORTS_CHILD, {
      PRELOAD_URL,
      PRELOAD_TEST_CALLS: JSON.stringify(argLists.map((args) => ({ fn: "connectTargetOf", args }))),
    });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    return resultOf<unknown[]>(run);
  }

  it("reads the host and port from (port, host), (port), an options object and the array form net.connect hands down", () => {
    expect(
      targetsOf([
        [52773, "iris.example.test"],
        [1972],
        [{ port: 52773, host: "iris.example.test" }],
        [{ port: 1972 }],
        [[{ port: 52773, host: "iris.example.test" }, null]],
        ["52773"],
        ["52773", "iris.example.test"],
      ]),
    ).toEqual([
      { host: "iris.example.test", port: "52773" },
      { host: "localhost", port: "1972" },
      { host: "iris.example.test", port: "52773" },
      { host: "localhost", port: "1972" },
      { host: "iris.example.test", port: "52773" },
      { host: "localhost", port: "52773" },
      { host: "iris.example.test", port: "52773" },
    ]);
  });

  it("reads a path (IPC) connect as no target at all", () => {
    expect(targetsOf([["/tmp/ipc.sock"], [{ path: "/tmp/ipc.sock" }], [["/tmp/ipc.sock", null]]])).toEqual([null, null, null]);
  });

  it("watches by port and by host name, and an IPC connect (no target) is never watched", () => {
    const targets = [
      { host: "x.example.test", port: "52773" },
      { host: "x.example.test", port: "1972" },
      { host: "x.example.test", port: "52774" },
      { host: "Unarmed.Invalid", port: "9999" },
      { host: "x.example.test", port: "" },
    ];
    const run = runChild(EXPORTS_CHILD, {
      PRELOAD_URL,
      PRELOAD_TEST_CALLS: JSON.stringify([...targets.map((target) => ({ fn: "isWatched", target })), { fn: "isWatched", target: null }]),
    });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);

    // The last call has no target (the child passes `undefined` for the JSON null), as an IPC connect has none.
    expect(resultOf<unknown[]>(run)).toEqual([true, true, false, true, false, false]);
  });
});
