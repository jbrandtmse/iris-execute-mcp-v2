/**
 * Story 42.2, AC 42.2.5 -- `scripts/throwaway-iris.mjs`, the harness that starts a throwaway IRIS container for a live
 * check, held in the default suite WITHOUT docker. Nothing here runs a docker command: the pure helpers are called
 * directly, the orchestration (`runHarness`) is driven with a recording stand-in for every side effect, and the one
 * process-level run launches the script with a PATH that holds no docker, so the script's own docker lookup fails first.
 *
 * Pins: the pinned image constants; the refusals of a floating image, host port 52773 or 1972, the shared instance's
 * container name and any name the script did not generate; the `docker run` argv (dynamic loopback port, owner label);
 * the `docker port` parser; the teardown argv (only the created container); the command's environment; the readiness
 * loops are bounded; the teardown runs on every path out; a missing docker exits non-zero; importing the module spawns
 * nothing. The `docker inspect` checker the live gate uses is covered here too.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CONTAINER_WEB_PORT,
  IRISHEALTH_COMMUNITY_IMAGE,
  IRIS_COMMUNITY_IMAGE,
  NAME_PREFIX,
  OWNER_LABEL,
  SHARED_INSTANCE_CONTAINER,
  assertThrowawayInspect,
  buildChildEnv,
  buildPortArgv,
  buildRunArgv,
  buildSessionArgv,
  buildTeardownArgv,
  createTeardown,
  findExecutable,
  generateContainerName,
  inspectProblems,
  parseCli,
  parseDockerPort,
  runHarness,
  validateContainerName,
  validateHostPort,
  validateImage,
} from "../../../../scripts/throwaway-iris.mjs";
import { throwawayGatePlan } from "./bootstrap-guard-legs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "..", "..", "..", "scripts", "throwaway-iris.mjs");

const CONTAINER_ID = "a".repeat(64);
const GENERATED_NAME = `${NAME_PREFIX}0123456789ab`;
const PINNED_DIGEST = "cd2ebcab02d1ef80ec155def4418399f353d867162688c36a3705760e750bdaa";

const scratchDirs: string[] = [];

/** A new empty directory of this test; removed after it. */
function scratchDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "throwaway-iris-test-"));
  scratchDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of scratchDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("throwaway-iris: the images", () => {
  it("pins both images by digest, and the default is the IRIS Community 2026.2 digest", () => {
    expect(IRIS_COMMUNITY_IMAGE).toBe(`intersystems/iris-community:2026.2@sha256:${PINNED_DIGEST}`);
    expect(IRISHEALTH_COMMUNITY_IMAGE).toBe(
      "intersystems/irishealth-community:2026.2@sha256:462de1fb3597272fde0e03afad006af1b18b59c90f1c1fb5566c79b027a7af0a",
    );
    expect(validateImage(IRIS_COMMUNITY_IMAGE)).toBe(IRIS_COMMUNITY_IMAGE);
    expect(validateImage(IRISHEALTH_COMMUNITY_IMAGE)).toBe(IRISHEALTH_COMMUNITY_IMAGE);
  });

  it.each([
    ["the floating :latest tag", "intersystems/iris-community:latest"],
    ["a version tag with no digest", "intersystems/iris-community:2026.2"],
    ["no tag and no digest", "intersystems/iris-community"],
    ["a digest that is too short", "intersystems/iris-community:2026.2@sha256:cd2ebcab"],
    ["an upper-case digest", `intersystems/iris-community:2026.2@sha256:${PINNED_DIGEST.toUpperCase()}`],
    ["a digest of another algorithm", `intersystems/iris-community:2026.2@sha512:${PINNED_DIGEST}`],
    ["a reference with trailing text", `${IRIS_COMMUNITY_IMAGE} --privileged`],
    ["a reference with a shell metacharacter", `intersystems/iris-community@sha256:${PINNED_DIGEST};id`],
    ["an empty string", ""],
    ["a non-string", undefined],
  ])("refuses %s", (_label, image) => {
    expect(() => validateImage(image)).toThrow(/digest/);
  });
});

describe("throwaway-iris: ports and names", () => {
  it.each([52773, "52773", " 52773 ", 1972, "1972"])("refuses host port %j (the shared instance's)", (port) => {
    expect(() => validateHostPort(port)).toThrow(/shared IRIS instance/);
  });

  it.each(["052773", "01972"])("refuses %j, which is port 52773 or 1972 written with a leading zero", (port) => {
    expect(() => validateHostPort(port)).toThrow(/refusing (the )?host port/);
  });

  it.each([0, "0", 65536, "65536", "abc", "", "-1", "4915.3", undefined])("refuses %j as not a port", (port) => {
    expect(() => validateHostPort(port)).toThrow(/not an integer from 1 to 65535/);
  });

  it("accepts a dynamic port, as a decimal string", () => {
    expect(validateHostPort(49153)).toBe("49153");
    expect(validateHostPort("49153")).toBe("49153");
  });

  it("refuses the shared instance's container name, and names it", () => {
    expect(() => validateContainerName(SHARED_INSTANCE_CONTAINER)).toThrow(/iris-community-edition.*shared IRIS instance/);
  });

  it.each(["ocupilot", "ocupilot-slot-1", NAME_PREFIX, `${NAME_PREFIX}xyz`, `${NAME_PREFIX}0123456789ab; rm`, `${NAME_PREFIX}0123456789ABC`, "", undefined])(
    "refuses the name %j, which this script did not generate",
    (name) => {
      expect(() => validateContainerName(name)).toThrow(/only handles names it generates/);
    },
  );

  it("generates names that carry the prefix, are accepted back, and differ from call to call", () => {
    const first = generateContainerName();
    const second = generateContainerName();

    expect(first).toMatch(/^iris-mcp-throwaway-[0-9a-f]{12}$/);
    expect(validateContainerName(first)).toBe(first);
    expect(second).not.toBe(first);
    expect(generateContainerName(() => Buffer.alloc(6, 0xab))).toBe(`${NAME_PREFIX}abababababab`);
  });
});

describe("throwaway-iris: the docker arguments", () => {
  it("runs detached with a dynamic loopback port, the owner label and the pinned image, and nothing else", () => {
    const argv = buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name: GENERATED_NAME });

    expect(argv).toEqual(["run", "-d", "--name", GENERATED_NAME, "--label", "iris-mcp.owner=throwaway", "-p", "127.0.0.1::52773", IRIS_COMMUNITY_IMAGE]);
    expect(OWNER_LABEL).toBe("iris-mcp.owner=throwaway");
    expect(argv.join(" ")).not.toMatch(/(^|[ :])(52773|1972):/);
    expect(argv).not.toContain("--privileged");
    expect(argv).not.toContain("--network=host");
  });

  it("refuses to build a run for a floating image or for a name it did not generate", () => {
    expect(() => buildRunArgv({ image: "intersystems/iris-community:latest", name: GENERATED_NAME })).toThrow(/digest/);
    expect(() => buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name: SHARED_INSTANCE_CONTAINER })).toThrow(/shared IRIS instance/);
  });

  it("reads the published port from `docker port` of the container id, and opens the session on the same id", () => {
    expect(buildPortArgv(CONTAINER_ID)).toEqual(["port", CONTAINER_ID, `${CONTAINER_WEB_PORT}/tcp`]);
    expect(buildSessionArgv(CONTAINER_ID)).toEqual(["exec", "-i", CONTAINER_ID, "iris", "session", "iris", "-U", "%SYS"]);
    expect(() => buildPortArgv("iris-community-edition")).toThrow(/not a 64-digit hex id/);
    expect(() => buildSessionArgv("$(docker ps -q)")).toThrow(/not a 64-digit hex id/);
  });

  it("removes only the container it created: its id, or its generated name before the id is known", () => {
    expect(buildTeardownArgv(CONTAINER_ID)).toEqual(["rm", "-f", "-v", CONTAINER_ID]);
    expect(buildTeardownArgv(GENERATED_NAME)).toEqual(["rm", "-f", "-v", GENERATED_NAME]);
    for (const other of [SHARED_INSTANCE_CONTAINER, "ocupilot-slot-1", "$(docker ps -aq)", "--all", "", "abc123"]) {
      expect(() => buildTeardownArgv(other), other).toThrow();
    }
  });
});

describe("throwaway-iris: `docker port` output", () => {
  it("reads the loopback binding", () => {
    expect(parseDockerPort("127.0.0.1:49153\n")).toBe("49153");
    expect(parseDockerPort("127.0.0.1:49153\r\n")).toBe("49153");
    expect(parseDockerPort("0.0.0.0:50000\n127.0.0.1:49153\n")).toBe("49153");
  });

  it.each([
    ["a binding on every interface only", "0.0.0.0:49153\n[::]:49153\n"],
    ["empty output", ""],
    ["text that is not a binding", "Error: No public port '52773/tcp' published"],
  ])("refuses %s", (_label, output) => {
    expect(() => parseDockerPort(output)).toThrow(/no 127\.0\.0\.1 binding/);
  });

  it.each(["127.0.0.1:52773\n", "127.0.0.1:1972\n"])("refuses the shared instance's port in %j", (output) => {
    expect(() => parseDockerPort(output)).toThrow(/shared IRIS instance/);
  });
});

describe("throwaway-iris: the command's environment", () => {
  it("sets the throwaway target and the arming variable, and drops every other IRIS_ variable of the caller", () => {
    const env = buildChildEnv(
      { PATH: "/usr/bin", HOME: "/home/x", IRIS_HOST: "prod.example", iris_password: "secret", IRIS_TEST_TIMEOUT: "9", IRIS_PROFILES: "{}", IRIS_HTTPS: "true", EMPTY: undefined },
      { port: "49153", name: GENERATED_NAME },
    );

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/x",
      IRIS_REQUIRE_LIVE: "1",
      IRIS_HOST: "127.0.0.1",
      IRIS_PORT: "49153",
      IRIS_USERNAME: "_SYSTEM",
      IRIS_PASSWORD: "SYS",
      IRIS_NAMESPACE: "USER",
      IRIS_THROWAWAY: GENERATED_NAME,
    });
  });

  it("refuses the shared instance's port and a name it did not generate", () => {
    expect(() => buildChildEnv({}, { port: "52773", name: GENERATED_NAME })).toThrow(/shared IRIS instance/);
    expect(() => buildChildEnv({}, { port: "49153", name: SHARED_INSTANCE_CONTAINER })).toThrow(/shared IRIS instance/);
  });
});

describe("throwaway-iris: the command line", () => {
  it("takes the command after `--` and defaults to the pinned image", () => {
    expect(parseCli(["run", "--", "pnpm", "test"])).toEqual({ image: IRIS_COMMUNITY_IMAGE, command: ["pnpm", "test"] });
  });

  it("accepts another digest-pinned image", () => {
    expect(parseCli(["run", "--image", IRISHEALTH_COMMUNITY_IMAGE, "--", "true"]).image).toBe(IRISHEALTH_COMMUNITY_IMAGE);
  });

  it.each([
    ["no subcommand", []],
    ["another subcommand", ["start", "--", "true"]],
    ["no `--`", ["run", "true"]],
    ["no command", ["run", "--"]],
    ["an unknown option", ["run", "--name", "x", "--", "true"]],
    ["a floating image", ["run", "--image", "intersystems/iris-community:latest", "--", "true"]],
    ["an image option with no value", ["run", "--image"]],
  ])("refuses %s", (_label, argv) => {
    expect(() => parseCli(argv)).toThrow();
  });
});

describe("throwaway-iris: finding docker without running it", () => {
  it("finds nothing in an empty directory, an empty PATH or an unset PATH, and never searches the current directory", () => {
    const empty = scratchDir();

    expect(findExecutable("docker", empty)).toBeUndefined();
    expect(findExecutable("docker", "")).toBeUndefined();
    expect(findExecutable("docker", undefined)).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("finds an executable file, and ignores a file that is not executable", () => {
    const withExecutable = scratchDir();
    const withPlainFile = scratchDir();
    // Files a test creates for the lookup only; nothing ever runs them.
    writeFileSync(path.join(withExecutable, "docker"), "", "utf8");
    chmodSync(path.join(withExecutable, "docker"), 0o755);
    writeFileSync(path.join(withPlainFile, "docker"), "", "utf8");
    chmodSync(path.join(withPlainFile, "docker"), 0o644);

    expect(findExecutable("docker", `${withPlainFile}${path.delimiter}${withExecutable}`)).toBe(path.join(withExecutable, "docker"));
    expect(findExecutable("docker", withPlainFile)).toBeUndefined();
  });
});

/** The parsed output of `docker inspect <name>` for a healthy throwaway (the shape docker prints). */
function inspectedThrowaway(overrides: Record<string, unknown> = {}): unknown[] {
  return [
    {
      Name: `/${GENERATED_NAME}`,
      State: { Running: true },
      Config: { Labels: { "iris-mcp.owner": "throwaway" } },
      NetworkSettings: { Ports: { "52773/tcp": [{ HostIp: "127.0.0.1", HostPort: "49153" }] } },
      ...overrides,
    },
  ];
}

describe("throwaway-iris: the docker inspect checker of the live gate", () => {
  const expected = { name: GENERATED_NAME, port: "49153" };

  it("accepts the throwaway that publishes that port and carries the label", () => {
    expect(inspectProblems(inspectedThrowaway(), expected)).toEqual([]);
    expect(() => assertThrowawayInspect(inspectedThrowaway(), expected)).not.toThrow();
  });

  it.each([
    ["no owner label", { Config: { Labels: {} } }, /does not carry the label iris-mcp\.owner=throwaway/],
    ["another owner label", { Config: { Labels: { "iris-mcp.owner": "someone" } } }, /does not carry the label/],
    ["another container name", { Name: "/iris-community-edition" }, /is named/],
    ["a stopped container", { State: { Running: false } }, /not running/],
    ["another published port", { NetworkSettings: { Ports: { "52773/tcp": [{ HostIp: "127.0.0.1", HostPort: "49999" }] } } }, /does not publish/],
    ["a port published on every interface", { NetworkSettings: { Ports: { "52773/tcp": [{ HostIp: "0.0.0.0", HostPort: "49153" }] } } }, /does not publish/],
    ["no published port", { NetworkSettings: { Ports: {} } }, /does not publish/],
  ])("refuses %s", (_label, overrides, problem) => {
    const problems = inspectProblems(inspectedThrowaway(overrides), expected);

    expect(problems.join(" ")).toMatch(problem);
    expect(() => assertThrowawayInspect(inspectedThrowaway(overrides), expected)).toThrow(/is not a throwaway container this harness started/);
  });

  it("refuses an inspect result that is not exactly one container, and the shared instance's name and ports", () => {
    expect(inspectProblems([], expected).join(" ")).toMatch(/exactly one container/);
    expect(inspectProblems([...inspectedThrowaway(), ...inspectedThrowaway()], expected).join(" ")).toMatch(/exactly one container/);
    expect(inspectProblems({}, expected).join(" ")).toMatch(/exactly one container/);
    expect(inspectProblems(inspectedThrowaway(), { name: SHARED_INSTANCE_CONTAINER, port: "49153" }).join(" ")).toMatch(/shared IRIS instance/);
    expect(inspectProblems(inspectedThrowaway(), { name: GENERATED_NAME, port: "52773" }).join(" ")).toMatch(/shared IRIS instance/);
    expect(inspectProblems(inspectedThrowaway(), { name: GENERATED_NAME, port: "1972" }).join(" ")).toMatch(/shared IRIS instance/);
  });
});

describe("throwaway-iris: the teardown", () => {
  it("removes the created container once: the id, which replaces the name it was armed with", () => {
    const calls: string[][] = [];
    const teardown = createTeardown((args: string[]) => calls.push(args));

    teardown.run();
    expect(calls, "nothing is removed before a container is armed").toEqual([]);

    teardown.arm(GENERATED_NAME);
    teardown.arm(CONTAINER_ID);
    teardown.run();
    teardown.run();

    expect(calls).toEqual([["rm", "-f", "-v", CONTAINER_ID]]);
  });

  it("refuses to arm anything but its own id or generated name", () => {
    const teardown = createTeardown(() => undefined);

    expect(() => teardown.arm(SHARED_INSTANCE_CONTAINER)).toThrow(/shared IRIS instance/);
    expect(() => teardown.arm("ocupilot-slot-1")).toThrow();
    expect(teardown.armed).toBeUndefined();
  });

  it("does not throw when the removal itself fails", () => {
    const teardown = createTeardown(() => {
      throw new Error("docker is gone");
    });
    teardown.arm(CONTAINER_ID);

    expect(() => teardown.run()).not.toThrow();
  });
});

/** A recording stand-in for every side effect of the harness; no docker, no network, no process. */
function recordingHarness(overrides: { dockerReply?: (args: string[], input: string | undefined) => { status: number | null; stdout?: string; stderr?: string } } = {}) {
  const events: string[] = [];
  const dockerCalls: string[][] = [];
  const logs: string[] = [];
  const commands: Array<{ command: string[]; env: Record<string, string> }> = [];
  let clock = 0;
  let exitCode = 7;

  const defaultReply = (args: string[], input: string | undefined): { status: number | null; stdout?: string; stderr?: string } => {
    switch (args[0]) {
      case "run":
        return { status: 0, stdout: `${CONTAINER_ID}\n` };
      case "port":
        return { status: 0, stdout: "127.0.0.1:49153\n" };
      case "exec":
        return { status: 0, stdout: input?.includes("UnExpireUserPasswords") ? "IRISMCP-UNEXPIRE:OK:END\n" : "IRISMCP-READY\n" };
      case "logs":
        return { status: 0, stdout: "container log tail" };
      default:
        return { status: 0, stdout: "" };
    }
  };

  const deps = {
    findDocker: (): string | undefined => "/fake/docker",
    docker: (args: string[], options: { input?: string } = {}) => {
      dockerCalls.push(args);
      events.push(`docker ${args[0]}`);
      const reply = (overrides.dockerReply ?? defaultReply)(args, options.input);
      return { status: reply.status, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
    },
    webStatus: async (): Promise<number> => 200,
    runCommand: async (command: string[], env: Record<string, string>): Promise<number> => {
      events.push("command");
      commands.push({ command, env });
      return exitCode;
    },
    sleep: async (ms: number): Promise<void> => {
      clock += ms;
    },
    now: (): number => clock,
    log: (line: string): void => {
      logs.push(line);
    },
  };
  const teardown = createTeardown((args: string[]) => deps.docker(args));
  return {
    deps,
    teardown,
    events,
    dockerCalls,
    logs,
    commands,
    setExitCode: (code: number): void => {
      exitCode = code;
    },
    options: (extra: Record<string, unknown> = {}) => ({
      image: IRIS_COMMUNITY_IMAGE,
      command: ["pnpm", "test"],
      env: { PATH: "/usr/bin", IRIS_HOST: "prod.example", IRIS_PASSWORD: "secret" } as Record<string, string | undefined>,
      ...extra,
    }),
  };
}

describe("throwaway-iris: the orchestration, with every side effect stood in for", () => {
  it("starts the container, reads the port, waits for readiness, runs the command with the throwaway environment, returns its exit code, and removes the container last", async () => {
    const harness = recordingHarness();

    const code = await runHarness(harness.options(), harness.deps, harness.teardown);

    expect(code).toBe(7);
    expect(harness.events).toEqual(["docker run", "docker port", "docker exec", "docker exec", "command", "docker rm"]);
    const runArgs = harness.dockerCalls[0] as string[];
    const name = runArgs[runArgs.indexOf("--name") + 1] as string;
    expect(runArgs).toEqual(["run", "-d", "--name", name, "--label", OWNER_LABEL, "-p", "127.0.0.1::52773", IRIS_COMMUNITY_IMAGE]);
    expect(name).toMatch(/^iris-mcp-throwaway-[0-9a-f]{12}$/);
    expect(harness.dockerCalls[1]).toEqual(["port", CONTAINER_ID, "52773/tcp"]);
    expect(harness.dockerCalls[harness.dockerCalls.length - 1]).toEqual(["rm", "-f", "-v", CONTAINER_ID]);
    expect(harness.commands).toEqual([
      {
        command: ["pnpm", "test"],
        env: {
          PATH: "/usr/bin",
          IRIS_REQUIRE_LIVE: "1",
          IRIS_HOST: "127.0.0.1",
          IRIS_PORT: "49153",
          IRIS_USERNAME: "_SYSTEM",
          IRIS_PASSWORD: "SYS",
          IRIS_NAMESPACE: "USER",
          IRIS_THROWAWAY: name,
        },
      },
    ]);
  });

  it("unexpires _SYSTEM through Security.Users in %SYS before it reads the first byte of the command", async () => {
    const seen: string[] = [];
    const harness = recordingHarness({
      dockerReply: (args, input) => {
        if (args[0] === "exec") {
          seen.push(input ?? "");
          return { status: 0, stdout: input?.includes("UnExpireUserPasswords") ? "IRISMCP-UNEXPIRE:OK:END\n" : "IRISMCP-READY\n" };
        }
        return args[0] === "run" ? { status: 0, stdout: `${CONTAINER_ID}\n` } : args[0] === "port" ? { status: 0, stdout: "127.0.0.1:49153\n" } : { status: 0 };
      },
    });

    await runHarness(harness.options(), harness.deps, harness.teardown);

    expect(seen[1]).toContain('##class(Security.Users).UnExpireUserPasswords("_SYSTEM",.tCount)');
    expect(harness.dockerCalls.filter((call) => call[0] === "exec").every((call) => call.includes("%SYS"))).toBe(true);
  });

  it("returns a failing command's exit code and still removes the container", async () => {
    const harness = recordingHarness();
    harness.setExitCode(3);

    expect(await runHarness(harness.options(), harness.deps, harness.teardown)).toBe(3);
    expect(harness.events.slice(-2)).toEqual(["command", "docker rm"]);
  });

  it("removes the container when the command cannot be run at all", async () => {
    const harness = recordingHarness();
    harness.deps.runCommand = async () => {
      throw new Error("spawn failed");
    };

    expect(await runHarness(harness.options(), harness.deps, harness.teardown)).toBe(4);
    expect(harness.dockerCalls[harness.dockerCalls.length - 1]).toEqual(["rm", "-f", "-v", CONTAINER_ID]);
  });

  it("when docker run fails, removes only the generated name it asked docker to create, and goes no further", async () => {
    const harness = recordingHarness({ dockerReply: (args) => (args[0] === "run" ? { status: 125, stderr: "no such image" } : { status: 0 }) });

    const code = await runHarness(harness.options(), harness.deps, harness.teardown);

    expect(code).toBe(4);
    expect(harness.events).toEqual(["docker run", "docker rm"]);
    const runArgs = harness.dockerCalls[0] as string[];
    expect(harness.dockerCalls[1]).toEqual(["rm", "-f", "-v", runArgs[runArgs.indexOf("--name") + 1]]);
    expect(harness.commands).toEqual([]);
  });

  it("when docker prints something that is not a container id, it does not run the command and removes the generated name", async () => {
    const harness = recordingHarness({ dockerReply: (args) => (args[0] === "run" ? { status: 0, stdout: "WARNING: platform mismatch\n" } : { status: 0 }) });

    expect(await runHarness(harness.options(), harness.deps, harness.teardown)).toBe(4);
    expect((harness.dockerCalls[1] as string[])[3]).toMatch(/^iris-mcp-throwaway-[0-9a-f]{12}$/);
    expect(harness.commands).toEqual([]);
  });

  it("refuses a published host port of 52773 or 1972, removes the container, and runs nothing", async () => {
    for (const reported of ["127.0.0.1:52773\n", "127.0.0.1:1972\n"]) {
      const harness = recordingHarness({
        dockerReply: (args) => (args[0] === "run" ? { status: 0, stdout: `${CONTAINER_ID}\n` } : args[0] === "port" ? { status: 0, stdout: reported } : { status: 0 }),
      });

      expect(await runHarness(harness.options(), harness.deps, harness.teardown)).toBe(4);
      expect(harness.events).toEqual(["docker run", "docker port", "docker rm"]);
      expect(harness.logs.join("\n")).toMatch(/shared IRIS instance/);
      expect(harness.commands).toEqual([]);
    }
  });

  it("bounds the readiness loop: a session that never answers ends the run, shows the container log, and removes the container", async () => {
    const harness = recordingHarness({
      dockerReply: (args) => {
        if (args[0] === "exec") return { status: 1, stdout: "", stderr: "not ready" };
        return args[0] === "run" ? { status: 0, stdout: `${CONTAINER_ID}\n` } : args[0] === "port" ? { status: 0, stdout: "127.0.0.1:49153\n" } : { status: 0, stdout: "container log tail" };
      },
    });

    const code = await runHarness(harness.options({ limits: { sessionReadyMs: 20_000, sessionStepMs: 5_000 } }), harness.deps, harness.teardown);

    expect(code).toBe(4);
    expect(harness.dockerCalls.filter((call) => call[0] === "exec").length).toBeLessThanOrEqual(6);
    expect(harness.dockerCalls.some((call) => call[0] === "logs")).toBe(true);
    expect(harness.logs.join("\n")).toMatch(/never answered an iris session/);
    expect(harness.dockerCalls[harness.dockerCalls.length - 1]).toEqual(["rm", "-f", "-v", CONTAINER_ID]);
    expect(harness.commands).toEqual([]);
  });

  it("an UnExpireUserPasswords that does not report OK ends the run before the command", async () => {
    const harness = recordingHarness({
      dockerReply: (args, input) => {
        if (args[0] === "exec") return { status: 0, stdout: input?.includes("UnExpireUserPasswords") ? "IRISMCP-UNEXPIRE:FAILED:no privilege:END\n" : "IRISMCP-READY\n" };
        return args[0] === "run" ? { status: 0, stdout: `${CONTAINER_ID}\n` } : args[0] === "port" ? { status: 0, stdout: "127.0.0.1:49153\n" } : { status: 0 };
      },
    });

    expect(await runHarness(harness.options(), harness.deps, harness.teardown)).toBe(4);
    expect(harness.commands).toEqual([]);
    expect(harness.dockerCalls[harness.dockerCalls.length - 1]).toEqual(["rm", "-f", "-v", CONTAINER_ID]);
  });

  it("bounds the HTTP poll: an Atelier route that never answers 200 ends the run and removes the container", async () => {
    const harness = recordingHarness();
    let polls = 0;
    harness.deps.webStatus = async () => {
      polls += 1;
      return 503;
    };

    const code = await runHarness(harness.options({ limits: { webReadyMs: 10_000, webStepMs: 2_000 } }), harness.deps, harness.teardown);

    expect(code).toBe(4);
    expect(polls).toBeLessThanOrEqual(6);
    expect(harness.logs.join("\n")).toMatch(/never answered HTTP 200/);
    expect(harness.commands).toEqual([]);
    expect(harness.dockerCalls[harness.dockerCalls.length - 1]).toEqual(["rm", "-f", "-v", CONTAINER_ID]);
  });

  it("exits non-zero with a message and calls no docker when docker is not on PATH: it never skips", async () => {
    const harness = recordingHarness();
    harness.deps.findDocker = () => undefined;

    const code = await runHarness(harness.options(), harness.deps, harness.teardown);

    expect(code).toBe(3);
    expect(harness.dockerCalls).toEqual([]);
    expect(harness.commands).toEqual([]);
    expect(harness.logs.join("\n")).toMatch(/docker was not found on PATH/);
  });

  it("refuses a floating image before it looks for docker", async () => {
    const harness = recordingHarness();
    let looked = false;
    harness.deps.findDocker = () => {
      looked = true;
      return "/fake/docker";
    };

    const code = await runHarness(harness.options({ image: "intersystems/iris-community:latest" }), harness.deps, harness.teardown);

    expect(code).toBe(2);
    expect(looked).toBe(false);
    expect(harness.dockerCalls).toEqual([]);
    expect(harness.logs.join("\n")).toMatch(/digest/);
  });
});

describe("the throwaway live gate's arming decision", () => {
  it("skips, with the reason, when IRIS_THROWAWAY is unset or empty, whatever else is set", () => {
    for (const env of [
      {},
      { IRIS_THROWAWAY: "" },
      { IRIS_HOST: "127.0.0.1", IRIS_PORT: "49153" },
      { IRIS_REQUIRE_LIVE: "1", IRIS_HOST: "127.0.0.1", IRIS_PORT: "49153", IRIS_USERNAME: "u", IRIS_PASSWORD: "p", IRIS_NAMESPACE: "USER" },
    ]) {
      const plan = throwawayGatePlan(env);

      expect(plan.run, JSON.stringify(env)).toBe(false);
      expect(plan.run ? "" : plan.reason).toMatch(/IRIS_THROWAWAY is not set/);
    }
  });

  it.each([
    ["IRIS_REQUIRE_LIVE unset", {}],
    ["IRIS_REQUIRE_LIVE=0", { IRIS_REQUIRE_LIVE: "0" }],
    ["IRIS_REQUIRE_LIVE=false", { IRIS_REQUIRE_LIVE: "false" }],
    ["only IRIS_HOST set", { IRIS_HOST: "127.0.0.1" }],
  ])("throws a misconfiguration when IRIS_THROWAWAY is set and the run is not armed (%s)", (_label, extra) => {
    expect(() => throwawayGatePlan({ IRIS_THROWAWAY: GENERATED_NAME, ...extra })).toThrow(/misconfiguration/);
  });

  it("runs against the named container when IRIS_THROWAWAY is set and IRIS_REQUIRE_LIVE is 1 or true", () => {
    for (const armed of ["1", "true"]) {
      expect(throwawayGatePlan({ IRIS_THROWAWAY: GENERATED_NAME, IRIS_REQUIRE_LIVE: armed })).toEqual({ run: true, container: GENERATED_NAME });
    }
  });
});

describe("throwaway-iris: running the script as a process (a PATH with no docker)", () => {
  /** Run the script with Node's absolute path and a PATH that is an empty directory, so docker cannot be found or run. */
  function runScript(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      env: { PATH: scratchDir() },
      encoding: "utf8",
      timeout: 30_000,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it("exits non-zero with a message that names docker, and never skips", () => {
    const result = runScript(["run", "--", "true"]);

    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/docker was not found on PATH/);
    expect(result.stdout).toBe("");
  });

  it("refuses a floating --image with exit code 2 before anything else", () => {
    const result = runScript(["run", "--image", "intersystems/iris-community:latest", "--", "true"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/digest/);
  });

  it("prints the usage for a command line it cannot parse, with exit code 2", () => {
    const result = runScript(["run"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage: node scripts\/throwaway-iris\.mjs run/);
  });

  it("spawns and starts nothing when it is only imported", () => {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)}); console.log("imported");`],
      { env: { PATH: scratchDir() }, encoding: "utf8", timeout: 30_000 },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("imported");
    expect(result.stderr).toBe("");
  });
});
