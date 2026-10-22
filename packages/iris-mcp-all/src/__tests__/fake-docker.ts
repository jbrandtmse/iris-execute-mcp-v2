/**
 * A scripted stand-in for the `docker` command, so that `scripts/throwaway-iris.mjs` can be run as a REAL process (its
 * `defaultDeps`: the spawn of `docker`, the state file, the command's environment and exit code, the signal handlers) without a
 * container engine. It is a Node script named `docker` in a directory that the test makes the ONLY entry of the harness's
 * PATH, so no real `docker` can be found or run. It never starts a process.
 *
 * It models the subcommands the harness issues and nothing else (any other subcommand exits 99 and is recorded):
 *  - `run -d --name N --label K=V -p 127.0.0.1:P:52773 [-v H:C:ro] IMAGE`: records a running container and prints its 64-hex id.
 *  - `run -d --name N --label K=V --network none [-v H:C:ro] IMAGE`: the same, for a container with no network and no published
 *    port (a `-p` together with `--network none` is refused with exit 125, as docker refuses it).
 *  - `port ID 52773/tcp`: prints `127.0.0.1:<P>`, or `127.0.0.1:<FAKE_DOCKER_PORT_REPORTS>` when that variable is set; for a
 *    container with no published port it exits 1, as docker does.
 *  - `exec -i ID iris session iris -U %SYS` (a script on stdin): answers the readiness marker, or the password-unexpiry marker.
 *  - `exec -i ID iris session iris -U NS` for any other namespace: prints `FAKE_DOCKER_SESSION_OUTPUT` (default: the line
 *    `scripted session in NS` and the script it was given) and exits with `FAKE_DOCKER_SESSION_STATUS` (default 0). When
 *    `FAKE_DOCKER_SESSION_HANDLER` names a CommonJS module, its export `(namespace, stdin, { dir, container })` answers instead,
 *    returning `{ stdout, status? }` (it keeps its own state in files under `dir`, because every call is a new process).
 *  - `cp ID:PATH DEST`: copies the file `FAKE_DOCKER_CP_SOURCE` to DEST, or else writes `FAKE_DOCKER_CP_CONTENT` (default
 *    `scripted archive`) to it, or exits 1 when `FAKE_DOCKER_CP_FAIL=1`.
 *  - `inspect REF`: a one-element JSON array shaped like `docker inspect` (name, labels, running, network mode, published port);
 *    `[]` and exit 1 for a container that does not exist.
 *  - `logs --tail N REF`: two fixed log lines.
 *  - `rm -f -v REF`: forgets the container.
 * `FAKE_DOCKER_RUN_FAIL=1` makes `run` fail the way a refused start does (exit 125).
 * `FAKE_DOCKER_READY_SIGNAL=<SIGNAL>` makes the first readiness session send that signal to the process that called docker and fail, so
 * the signal reaches it while it is still waiting for a container it has started (later readiness sessions answer).
 *
 * Every call is appended to `calls.log` as `{ argv, stdin }`; the containers are in `containers.json`, which a test may rewrite
 * (for instance to take a label off a container).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** One container the stand-in holds. */
export interface FakeContainer {
  id: string;
  name: string;
  labels: Record<string, string>;
  /** The published loopback port; empty for a `--network none` container. */
  hostPort: string;
  image: string;
  running: boolean;
  /** `none` for a container started with `--network none`; absent for a published-port container. */
  network?: string;
  /** The `-v` value, when the container was started with a mount. */
  mount?: string;
}

/** One recorded call of the stand-in. */
export interface FakeDockerCall {
  argv: string[];
  stdin: string;
}

/** The log lines `logs` prints. */
export const FAKE_DOCKER_LOG_LINES = ["scripted container log line 1", "scripted container log line 2"];

const SOURCE = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const dir = process.env.FAKE_DOCKER_DIR;
const statePath = path.join(dir, "containers.json");
const argv = process.argv.slice(2);
const stdin = argv[0] === "exec" ? readStdin() : "";
fs.appendFileSync(path.join(dir, "calls.log"), JSON.stringify({ argv, stdin }) + "\n");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}
function load() {
  return fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
}
function save(state) {
  fs.writeFileSync(statePath, JSON.stringify(state));
}
function find(state, ref) {
  return Object.values(state).find((container) => container.id === ref || container.name === ref);
}
function fail(code, message) {
  process.stderr.write(message + "\n");
  process.exit(code);
}
function valueOf(flag) {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

const command = argv[0];
if (command === "run") {
  if (process.env.FAKE_DOCKER_RUN_FAIL) fail(125, "docker: Error response from daemon: scripted failure to start");
  const network = valueOf("--network");
  const publishArg = valueOf("-p");
  let hostPort = "";
  if (network === "none") {
    if (publishArg !== undefined) fail(125, "docker: conflicting options: port publishing and the container type network mode");
  } else {
    if (network !== undefined) fail(125, "unscripted network: " + network);
    const published = /^127\.0\.0\.1:(\d*):52773$/.exec(publishArg || "");
    if (!published) fail(125, "unscripted publish: " + publishArg);
    hostPort = published[1];
  }
  const [labelKey, labelValue] = (valueOf("--label") || "=").split("=");
  const id = crypto.randomBytes(32).toString("hex");
  const state = load();
  state[id] = { id, name: valueOf("--name"), labels: { [labelKey]: labelValue }, hostPort, image: argv[argv.length - 1], running: true };
  if (network === "none") state[id].network = "none";
  if (argv.includes("-v")) state[id].mount = valueOf("-v");
  save(state);
  process.stdout.write(id + "\n");
} else if (command === "port") {
  const container = find(load(), argv[1]);
  if (!container) fail(1, "Error: No such container: " + argv[1]);
  if (container.network === "none") fail(1, "Error: No public port '52773/tcp' published for " + argv[1]);
  process.stdout.write("127.0.0.1:" + (process.env.FAKE_DOCKER_PORT_REPORTS || container.hostPort) + "\n");
} else if (command === "exec") {
  const namespace = argv[argv.indexOf("-U") + 1];
  if (namespace !== "%SYS") {
    if (process.env.FAKE_DOCKER_SESSION_HANDLER) {
      const container = find(load(), argv[2]);
      const reply = require(process.env.FAKE_DOCKER_SESSION_HANDLER)(namespace, stdin, { dir, container });
      process.stdout.write(reply.stdout);
      process.exit(reply.status || 0);
    }
    process.stdout.write(process.env.FAKE_DOCKER_SESSION_OUTPUT !== undefined ? process.env.FAKE_DOCKER_SESSION_OUTPUT : "scripted session in " + namespace + "\n" + stdin);
    process.exit(Number(process.env.FAKE_DOCKER_SESSION_STATUS || 0));
  }
  if (stdin.includes("UnExpireUserPasswords")) process.stdout.write("IRISMCP-" + "UNEXPIRE:OK:END\n");
  else if (stdin.includes("READY")) {
    const signalFile = path.join(dir, "ready-signalled");
    if (process.env.FAKE_DOCKER_READY_SIGNAL && !fs.existsSync(signalFile)) {
      fs.writeFileSync(signalFile, "1");
      process.kill(process.ppid, process.env.FAKE_DOCKER_READY_SIGNAL);
      process.exit(1);
    }
    process.stdout.write("IRISMCP-" + "READY\n");
  }
} else if (command === "cp") {
  const [source, destination] = [argv[1], argv[2]];
  if (!find(load(), source.split(":")[0])) fail(1, "Error: No such container:path: " + source);
  if (process.env.FAKE_DOCKER_CP_FAIL) fail(1, "Error: Could not find the file " + source.split(":").slice(1).join(":"));
  if (process.env.FAKE_DOCKER_CP_SOURCE) fs.copyFileSync(process.env.FAKE_DOCKER_CP_SOURCE, destination);
  else fs.writeFileSync(destination, process.env.FAKE_DOCKER_CP_CONTENT !== undefined ? process.env.FAKE_DOCKER_CP_CONTENT : "scripted archive");
} else if (command === "inspect") {
  const container = find(load(), argv[1]);
  if (!container) {
    process.stdout.write("[]\n");
    fail(1, "Error: No such object: " + argv[1]);
  }
  const isolated = container.network === "none";
  process.stdout.write(
    JSON.stringify([
      {
        Name: "/" + container.name,
        Config: { Labels: container.labels },
        State: { Running: container.running },
        HostConfig: isolated
          ? { NetworkMode: "none", PortBindings: {} }
          : { NetworkMode: "default", PortBindings: { "52773/tcp": [{ HostIp: "127.0.0.1", HostPort: container.hostPort }] } },
        NetworkSettings: { Ports: { "52773/tcp": isolated ? null : [{ HostIp: "127.0.0.1", HostPort: container.hostPort }] } },
      },
    ]) + "\n",
  );
} else if (command === "logs") {
  process.stdout.write("scripted container log line 1\nscripted container log line 2\n");
} else if (command === "rm") {
  const state = load();
  const container = find(state, argv[argv.length - 1]);
  if (container) delete state[container.id];
  save(state);
  process.stdout.write(argv[argv.length - 1] + "\n");
} else {
  fail(99, "unscripted docker command: " + argv.join(" "));
}
`;

/** The stand-in installed in a directory. */
export interface FakeDocker {
  /** The directory that holds the `docker` script: the whole PATH of the harness under test. */
  binDir: string;
  /** The directory of `containers.json` and `calls.log`; the `FAKE_DOCKER_DIR` value. */
  dir: string;
  /** The calls so far, in order. */
  calls: () => FakeDockerCall[];
  /** The containers it holds, by id. */
  containers: () => Record<string, FakeContainer>;
  /** Replace the containers it holds. */
  setContainers: (containers: Record<string, FakeContainer>) => void;
}

/**
 * Install the stand-in under `root`: `root/bin/docker` (executable) and `root/state/`. The shebang is the absolute path of the
 * running Node, so the script runs with a PATH that holds nothing but its own directory.
 */
export function installFakeDocker(root: string): FakeDocker {
  const binDir = path.join(root, "bin");
  const dir = path.join(root, "state");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  const script = path.join(binDir, "docker");
  writeFileSync(script, `#!${process.execPath}\n${SOURCE}`, "utf8");
  chmodSync(script, 0o755);
  const containersFile = path.join(dir, "containers.json");
  const callsFile = path.join(dir, "calls.log");
  return {
    binDir,
    dir,
    calls: () =>
      existsSync(callsFile)
        ? readFileSync(callsFile, "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => JSON.parse(line) as FakeDockerCall)
        : [],
    containers: () => (existsSync(containersFile) ? (JSON.parse(readFileSync(containersFile, "utf8")) as Record<string, FakeContainer>) : {}),
    setContainers: (containers) => writeFileSync(containersFile, JSON.stringify(containers), "utf8"),
  };
}
