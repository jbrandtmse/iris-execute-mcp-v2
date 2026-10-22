/**
 * Story 42.3 QA (AC 42.3.2; I/O matrix rows "Harness up", "Harness exec / logs / down", "Harness run fails"; Rule #3, Rule #59) --
 * `scripts/throwaway-iris.mjs` run as a REAL process, end to end, against a scripted `docker` (`fake-docker.ts`).
 *
 * `throwaway-iris.test.ts` drives every subcommand with injected dependencies, so the real dependencies (`defaultDeps`: the spawn of
 * `docker`, the readiness HTTP poll, the state file, the command's environment, output and exit code, the signal handlers of
 * `main`) run in no default-suite test, and in CI for the first time. Here the harness is spawned with a PATH that holds only the
 * stand-in, so no container engine can be found or run, and a loopback HTTP server answers the Atelier readiness poll.
 *
 *  - LIFECYCLE: `up` keeps its container and writes the state (mode 0600); `exec` runs the command with the throwaway environment,
 *    shows its output and returns its exit code; `logs` prints the 400-line tail; `down` removes the container and the state, and a
 *    second `down` is a no-op; an unlabelled container is refused by `exec` and `down`.
 *  - RUN: a failing command prints the 200-line log tail BEFORE the container is removed and exits with the command's code; a
 *    SIGTERM removes the container and ends the command.
 *  - EXEC SIGNAL: a SIGTERM to `exec` reaches the command, the harness exits 143, and the container is kept for `down`.
 *  - UP FAILURES: a refused start, and a published port other than the requested one, remove the container and write no state; an
 *    existing state file is refused before docker is called.
 *
 * Nothing here reaches a network other than the loopback server of the test; every directory and listener is removed after the test.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findExecutable } from "../../../../scripts/throwaway-iris.mjs";
import { FAKE_DOCKER_LOG_LINES, installFakeDocker, type FakeDocker, type FakeDockerCall } from "./fake-docker";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "throwaway-iris.mjs");

const IRISHEALTH = "intersystems/irishealth-community:2026.2@sha256:462de1fb3597272fde0e03afad006af1b18b59c90f1c1fb5566c79b027a7af0a";
const COMMUNITY = "intersystems/iris-community:2026.2@sha256:cd2ebcab02d1ef80ec155def4418399f353d867162688c36a3705760e750bdaa";
const NAME_PATTERN = /^iris-mcp-throwaway-[0-9a-f]{12}$/;
/** Basic auth for `_SYSTEM:SYS`. */
const BASIC_SYSTEM = `Basic ${Buffer.from("_SYSTEM:SYS").toString("base64")}`;

interface Run {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

let root = "";
let fake: FakeDocker;
let server: http.Server;
let port = "";
const webRequests: Array<{ url: string; authorization: string | undefined }> = [];

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "qa-42-3-harness-"));
  fake = installFakeDocker(root);
  webRequests.length = 0;
  server = http.createServer((request, response) => {
    webRequests.push({ url: request.url ?? "", authorization: request.headers.authorization });
    response.statusCode = request.url === "/api/atelier/" && request.headers.authorization === BASIC_SYSTEM ? 200 : 401;
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = String((server.address() as AddressInfo).port);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

/** The environment of the harness process: a PATH that is the stand-in's directory alone, and ambient IRIS_ settings it must drop. */
function harnessEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: fake.binDir, FAKE_DOCKER_DIR: fake.dir, IRIS_PASSWORD: "ambient-password", IRIS_FOO: "ambient", ...extra };
}

/** Start the harness and collect its output; `afterStart` runs once the process is started (to signal it). */
function harness(args: string[], extra: Record<string, string> = {}, afterStart?: (child: ReturnType<typeof spawn>) => Promise<void>): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: harnessEnv(extra), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    // A command the harness left running keeps the output pipes open, so `close` may never come: settle shortly after `exit`.
    const settle = (status: number | null, signal: NodeJS.Signals | null): void => resolve({ status, signal, stdout, stderr });
    child.once("error", reject);
    child.once("exit", (status, signal) => {
      setTimeout(() => settle(status, signal), 500);
    });
    child.once("close", settle);
    if (afterStart !== undefined) afterStart(child).catch(reject);
  });
}

const argvLines = (calls: FakeDockerCall[]): string[] => calls.map((call) => call.argv.join(" "));

/** A script for the harness to run: it writes a JSON of the IRIS_ variables it was given to `argv[2]`, prints a marker, and exits with `argv[3]`. */
function probeScript(): string {
  const file = path.join(root, "probe.cjs");
  writeFileSync(
    file,
    [
      'const fs = require("node:fs");',
      'const names = Object.keys(process.env).filter((name) => name.toUpperCase().startsWith("IRIS_")).sort();',
      "fs.writeFileSync(process.argv[2], JSON.stringify(Object.fromEntries(names.map((name) => [name, process.env[name]]))));",
      'console.log("probe-stdout-marker");',
      "process.exit(Number(process.argv[3]));",
      "",
    ].join("\n"),
    "utf8",
  );
  return file;
}

describe("the harness as a process against a scripted docker: up, exec, logs, down", () => {
  it("is not a real docker: the harness's PATH finds only the stand-in", () => {
    expect(findExecutable("docker", fake.binDir)).toBe(path.join(fake.binDir, "docker"));
    expect(fake.binDir.startsWith(root)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("up keeps the container and writes the state; exec runs with the throwaway environment; logs prints; down removes it, once", async () => {
    const state = path.join(root, "throwaway.json");

    const up = await harness(["up", "--image", IRISHEALTH, "--namespace", "HSCUSTOM", "--host-port", port, "--state", state]);
    expect(up.status, up.stderr).toBe(0);
    const recorded = JSON.parse(readFileSync(state, "utf8")) as { name: string; id: string; port: string; image: string; namespace: string };
    expect(Object.keys(recorded).sort()).toEqual(["id", "image", "name", "namespace", "port"]);
    expect(recorded.name).toMatch(NAME_PATTERN);
    expect(recorded).toEqual({ name: recorded.name, id: expect.stringMatching(/^[0-9a-f]{64}$/), port, image: IRISHEALTH, namespace: "HSCUSTOM" });
    expect(statSync(state).mode & 0o777, "the state file is private").toBe(0o600);
    expect(up.stderr).toContain(`is up on 127.0.0.1:${port} (namespace HSCUSTOM)`);

    // The docker conversation of `up`: the documented `docker run`, the port read-back, the two readiness sessions; nothing is removed.
    const { name, id } = recorded;
    const upCalls = fake.calls();
    expect(upCalls[0]?.argv).toEqual(["run", "-d", "--name", name, "--label", "iris-mcp.owner=throwaway", "-p", `127.0.0.1:${port}:52773`, IRISHEALTH]);
    expect(argvLines(upCalls).slice(1)).toEqual([`port ${id} 52773/tcp`, `exec -i ${id} iris session iris -U %SYS`, `exec -i ${id} iris session iris -U %SYS`]);
    expect(upCalls[2]?.stdin).toContain("READY");
    expect(upCalls[3]?.stdin).toContain("UnExpireUserPasswords");
    expect(Object.keys(fake.containers()), "the container is kept").toEqual([id]);
    expect(webRequests, "the readiness poll authenticates as _SYSTEM").toEqual([{ url: "/api/atelier/", authorization: BASIC_SYSTEM }]);

    // exec: one re-inspection, the throwaway environment (ambient IRIS_ settings dropped), the command's output and exit code.
    const probeOut = path.join(root, "probe.json");
    const exec = await harness(["exec", "--state", state, "--", process.execPath, probeScript(), probeOut, "7"]);
    expect(exec.status, "the harness exits with the command's code").toBe(7);
    expect(exec.stdout, "the command's output reaches the harness's stdout").toContain("probe-stdout-marker");
    expect(JSON.parse(readFileSync(probeOut, "utf8"))).toEqual({
      IRIS_REQUIRE_LIVE: "1",
      IRIS_HOST: "127.0.0.1",
      IRIS_PORT: port,
      IRIS_USERNAME: "_SYSTEM",
      IRIS_PASSWORD: "SYS",
      IRIS_NAMESPACE: "HSCUSTOM",
      IRIS_HTTPS: "false",
      IRIS_THROWAWAY: name,
    });
    expect(argvLines(fake.calls()).slice(upCalls.length)).toEqual([`inspect ${id}`]);

    // logs: the last 400 lines of the container the state records.
    const logs = await harness(["logs", "--state", state]);
    expect(logs.status, logs.stderr).toBe(0);
    expect(logs.stderr).toContain(`docker logs --tail 400 ${id}`);
    for (const line of FAKE_DOCKER_LOG_LINES) expect(logs.stderr).toContain(line);

    // An unlabelled container is no throwaway: exec and down refuse it, and nothing runs or is removed.
    const labelled = fake.containers();
    fake.setContainers({ [id]: { ...(labelled[id] as NonNullable<(typeof labelled)[string]>), labels: {} } });
    rmSync(probeOut);
    const refusedExec = await harness(["exec", "--state", state, "--", process.execPath, probeScript(), probeOut, "0"]);
    expect(refusedExec.status).toBe(2);
    expect(refusedExec.stderr).toMatch(/does not carry the label iris-mcp\.owner=throwaway/);
    expect(existsSync(probeOut), "the refused command never ran").toBe(false);
    const refusedDown = await harness(["down", "--state", state]);
    expect(refusedDown.status).toBe(2);
    expect(Object.keys(fake.containers()), "the refused down removed nothing").toEqual([id]);
    expect(existsSync(state), "and kept the state file").toBe(true);
    fake.setContainers(labelled);

    // down: the container and the state file are gone; a second down finds nothing to do and calls no docker.
    const down = await harness(["down", "--state", state]);
    expect(down.status, down.stderr).toBe(0);
    expect(fake.calls().at(-1)?.argv).toEqual(["rm", "-f", "-v", id]);
    expect(fake.containers()).toEqual({});
    expect(existsSync(state)).toBe(false);
    const callsAfterDown = fake.calls().length;
    const again = await harness(["down", "--state", state]);
    expect(again.status).toBe(0);
    expect(fake.calls().length, "a second down calls no docker").toBe(callsAfterDown);
  }, 120_000);
});

describe("run as a process: the command's code, the log before the removal, and a signal", () => {
  it("prints the 200-line log tail BEFORE it removes the container when the command fails, and exits with the command's code", async () => {
    const script = path.join(root, "fail.cjs");
    writeFileSync(script, 'console.log("failing-command-output");\nprocess.exit(3);\n', "utf8");

    const run = await harness(["run", "--image", COMMUNITY, "--host-port", port, "--", process.execPath, script]);

    expect(run.status, run.stderr).toBe(3);
    expect(run.stdout).toContain("failing-command-output");
    for (const line of FAKE_DOCKER_LOG_LINES) expect(run.stderr).toContain(line);
    const lines = argvLines(fake.calls());
    const id = (fake.calls()[1]?.argv[1] ?? "") as string;
    const logsAt = lines.findIndex((line) => line.startsWith("logs --tail 200 "));
    const removeAt = lines.findIndex((line) => line.startsWith("rm -f -v "));
    expect(logsAt, "the log tail was read").toBeGreaterThan(-1);
    expect(removeAt, "the container was removed").toBeGreaterThan(-1);
    expect(logsAt, "the log is read before the container is removed").toBeLessThan(removeAt);
    expect(lines[removeAt]).toBe(`rm -f -v ${id}`);
    expect(fake.containers()).toEqual({});
  }, 60_000);

  it("reads no log when the command succeeds, and still removes the container", async () => {
    const script = path.join(root, "ok.cjs");
    writeFileSync(script, "process.exit(0);\n", "utf8");

    const run = await harness(["run", "--image", COMMUNITY, "--host-port", port, "--", process.execPath, script]);

    expect(run.status, run.stderr).toBe(0);
    expect(argvLines(fake.calls()).some((line) => line.startsWith("logs "))).toBe(false);
    expect(fake.containers()).toEqual({});
  }, 60_000);

  it.skipIf(process.platform === "win32")("removes the container and ends the command when the harness is sent SIGTERM", async () => {
    const pidFile = path.join(root, "command.pid");
    const script = path.join(root, "wait.cjs");
    writeFileSync(script, `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`, "utf8");

    try {
      const run = await harness(["run", "--image", COMMUNITY, "--host-port", port, "--", process.execPath, script], {}, async (child) => {
        const deadline = Date.now() + 30_000;
        while (!existsSync(pidFile)) {
          if (Date.now() > deadline) throw new Error("the command never started");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        child.kill("SIGTERM");
      });

      expect(run.status, `${run.signal}: ${run.stderr}`).toBe(143);
      expect(fake.containers(), "the container is removed").toEqual({});
      expect(argvLines(fake.calls()).some((line) => line.startsWith("rm -f -v "))).toBe(true);
      const commandPid = Number(readFileSync(pidFile, "utf8"));
      let alive = true;
      for (let attempt = 0; attempt < 100 && alive; attempt += 1) {
        try {
          process.kill(commandPid, 0);
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch {
          alive = false;
        }
      }
      expect(alive, "the command was ended with the harness").toBe(false);
    } finally {
      // A harness that did not end its command must not leave it running after the test.
      if (existsSync(pidFile)) {
        try {
          process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  }, 60_000);
});

describe("exec as a process: a signal reaches the command, and the container outlives it", () => {
  it.skipIf(process.platform === "win32")("ends the command with SIGTERM, exits 143, and keeps the container for down", async () => {
    const state = path.join(root, "throwaway.json");
    const up = await harness(["up", "--image", IRISHEALTH, "--namespace", "HSCUSTOM", "--host-port", port, "--state", state]);
    expect(up.status, up.stderr).toBe(0);
    const { id } = JSON.parse(readFileSync(state, "utf8")) as { id: string };
    const pidFile = path.join(root, "exec-command.pid");
    const script = path.join(root, "exec-wait.cjs");
    writeFileSync(script, `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`, "utf8");

    try {
      const exec = await harness(["exec", "--state", state, "--", process.execPath, script], {}, async (child) => {
        const deadline = Date.now() + 30_000;
        while (!existsSync(pidFile)) {
          if (Date.now() > deadline) throw new Error("the command never started");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        child.kill("SIGTERM");
      });

      expect(exec.status, `${exec.signal}: ${exec.stderr}`).toBe(143);
      expect(Object.keys(fake.containers()), "exec never removes the container").toEqual([id]);
      expect(argvLines(fake.calls()).some((line) => line.startsWith("rm "))).toBe(false);
      let alive = true;
      for (let attempt = 0; attempt < 100 && alive; attempt += 1) {
        try {
          process.kill(Number(readFileSync(pidFile, "utf8")), 0);
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch {
          alive = false;
        }
      }
      expect(alive, "the signal reached the command").toBe(false);
    } finally {
      if (existsSync(pidFile)) {
        try {
          process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  }, 60_000);
});

describe("up as a process keeps nothing on a failure", () => {
  const upArgs = (state: string): string[] => ["up", "--image", IRISHEALTH, "--namespace", "HSCUSTOM", "--host-port", port, "--state", state];

  it("removes the generated container name and writes no state when docker refuses to start it", async () => {
    const state = path.join(root, "refused.json");

    const up = await harness(upArgs(state), { FAKE_DOCKER_RUN_FAIL: "1" });

    expect(up.status).toBe(4);
    expect(up.stderr).toMatch(/docker run failed/);
    const calls = fake.calls();
    const name = calls[0]?.argv[3] as string;
    expect(name).toMatch(NAME_PATTERN);
    expect(calls[1]?.argv, "the name it asked docker to create is removed").toEqual(["rm", "-f", "-v", name]);
    expect(existsSync(state)).toBe(false);
  }, 60_000);

  it("removes the container and writes no state when it publishes another port than the requested one", async () => {
    const state = path.join(root, "wrong-port.json");

    const up = await harness(upArgs(state), { FAKE_DOCKER_PORT_REPORTS: String(Number(port) + 1) });

    expect(up.status).toBe(4);
    expect(up.stderr).toContain(`not on the requested ${port}`);
    expect(fake.containers()).toEqual({});
    expect(existsSync(state)).toBe(false);
  }, 60_000);

  it("refuses an existing state file before it calls docker, and leaves the file as it was", async () => {
    const state = path.join(root, "taken.json");
    writeFileSync(state, '{"keep":"me"}\n', "utf8");

    const up = await harness(upArgs(state));

    expect(up.status).toBe(2);
    expect(up.stderr).toMatch(/already exists/);
    expect(fake.calls()).toEqual([]);
    expect(readFileSync(state, "utf8")).toBe('{"keep":"me"}\n');
  }, 60_000);
});
