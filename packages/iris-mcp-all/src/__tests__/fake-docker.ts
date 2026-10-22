/**
 * A scripted stand-in for the `docker` command, so that `scripts/throwaway-iris.mjs` can be run as a REAL process (its
 * `defaultDeps`: the spawn of `docker`, the state file, the command's environment and exit code, the signal handlers) without a
 * container engine. It is a Node script named `docker` in a directory that the test makes the ONLY entry of the harness's
 * PATH, so no real `docker` can be found or run. It never starts a process.
 *
 * It models the subcommands the harness issues and nothing else (any other subcommand exits 99 and is recorded):
 *  - `run -d --name N --label K=V -p 127.0.0.1:P:52773 IMAGE`: records a running container and prints its 64-hex id.
 *  - `port ID 52773/tcp`: prints `127.0.0.1:<P>`, or `127.0.0.1:<FAKE_DOCKER_PORT_REPORTS>` when that variable is set.
 *  - `exec -i ID iris session iris -U %SYS` (a script on stdin): answers the readiness marker, or the password-unexpiry marker.
 *  - `inspect REF`: a one-element JSON array shaped like `docker inspect` (name, labels, running, published port); `[]` and exit 1
 *    for a container that does not exist.
 *  - `logs --tail N REF`: two fixed log lines.
 *  - `rm -f -v REF`: forgets the container.
 * `FAKE_DOCKER_RUN_FAIL=1` makes `run` fail the way a refused start does (exit 125).
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
  hostPort: string;
  image: string;
  running: boolean;
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
  return argv[argv.indexOf(flag) + 1];
}

const command = argv[0];
if (command === "run") {
  if (process.env.FAKE_DOCKER_RUN_FAIL) fail(125, "docker: Error response from daemon: scripted failure to start");
  const published = /^127\.0\.0\.1:(\d*):52773$/.exec(valueOf("-p") || "");
  if (!published) fail(125, "unscripted publish: " + valueOf("-p"));
  const [labelKey, labelValue] = (valueOf("--label") || "=").split("=");
  const id = crypto.randomBytes(32).toString("hex");
  const state = load();
  state[id] = { id, name: valueOf("--name"), labels: { [labelKey]: labelValue }, hostPort: published[1], image: argv[argv.length - 1], running: true };
  save(state);
  process.stdout.write(id + "\n");
} else if (command === "port") {
  const container = find(load(), argv[1]);
  if (!container) fail(1, "Error: No such container: " + argv[1]);
  process.stdout.write("127.0.0.1:" + (process.env.FAKE_DOCKER_PORT_REPORTS || container.hostPort) + "\n");
} else if (command === "exec") {
  if (stdin.includes("UnExpireUserPasswords")) process.stdout.write("IRISMCP-" + "UNEXPIRE:OK:END\n");
  else if (stdin.includes("READY")) process.stdout.write("IRISMCP-" + "READY\n");
} else if (command === "inspect") {
  const container = find(load(), argv[1]);
  if (!container) {
    process.stdout.write("[]\n");
    fail(1, "Error: No such object: " + argv[1]);
  }
  process.stdout.write(
    JSON.stringify([
      {
        Name: "/" + container.name,
        Config: { Labels: container.labels },
        State: { Running: container.running },
        NetworkSettings: { Ports: { "52773/tcp": [{ HostIp: "127.0.0.1", HostPort: container.hostPort }] } },
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
