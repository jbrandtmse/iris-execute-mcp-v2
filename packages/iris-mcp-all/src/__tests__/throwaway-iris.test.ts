/**
 * Story 42.2, AC 42.2.5 -- `scripts/throwaway-iris.mjs`, the harness that starts a throwaway IRIS container for a live
 * check, held in the default suite WITHOUT docker. Nothing here runs a docker command: the pure helpers are called
 * directly, the orchestration (`runHarness`) is driven with a recording stand-in for every side effect, and the one
 * process-level run launches the script with a PATH that holds no docker, so the script's own docker lookup fails first.
 *
 * Pins: the pinned image constants; the refusals of a floating image, host port 52773 or 1972, the shared instance's
 * container name, a bad namespace and any name the script did not generate; the `docker run` argv (dynamic or fixed loopback
 * port, owner label); the `docker port` parser; the teardown argv (only the created container); the command's environment
 * (including `IRIS_HTTPS` and the namespace); the readiness loops are bounded; the teardown runs on every path out; a
 * missing docker exits non-zero; importing the module spawns nothing. The `docker inspect` checker the live gate uses is
 * covered here too.
 *
 * The CI subcommands (`up`, `exec`, `logs`, `down`, Story 42.3) are driven with injected dependencies, so nothing here
 * runs docker: `up` keeps its container only on success, `exec`, `logs` and `down` re-inspect the container and refuse one
 * that is not a throwaway this harness started, `run` prints the container log when its command fails, and the
 * environment the harness hands a command satisfies `scripts/verify-iris-reachable.mjs` under `CI=true`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CONTAINER_WEB_PORT,
  IRISHEALTH_COMMUNITY_IMAGE,
  IRIS_COMMUNITY_IMAGE,
  NAME_PREFIX,
  NETWORK_NONE,
  OLDEST_IRIS_COMMUNITY_IMAGE,
  OWNER_LABEL,
  SHARED_INSTANCE_CONTAINER,
  assertThrowawayEnv,
  assertThrowawayInspect,
  buildChildEnv,
  buildCopyArgv,
  buildInspectArgv,
  buildLogsArgv,
  buildPortArgv,
  buildRunArgv,
  buildSessionArgv,
  buildTeardownArgv,
  copyHarness,
  createTeardown,
  defaultDeps,
  downHarness,
  execHarness,
  findExecutable,
  generateContainerName,
  inspectProblems,
  logsHarness,
  parseCli,
  parseDockerPort,
  parseState,
  runHarness,
  sessionHarness,
  throwawayEnvProblems,
  upHarness,
  validateContainerName,
  validateCopyDestination,
  validateCopySource,
  validateHostPort,
  validateImage,
  validateMount,
  validateNamespace,
  validateSessionNamespace,
} from "../../../../scripts/throwaway-iris.mjs";
import { throwawayGatePlan } from "./bootstrap-guard-legs.js";
import { runScriptUnderPreload } from "./live-gate-child-run.js";
import { reserveClosedPort } from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SCRIPT = path.resolve(REPO_ROOT, "scripts", "throwaway-iris.mjs");

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

  // DW-686 (Story 42.4): 2025.3 passed every guard leg in CI run 39749804619 (commit 6a8574f, 2026-10-22) and its license key
  // expires on 2026-11-13, so the oldest tested tag is 2026.1, whose key is valid to 2027-03-27. The digest is the manifest list
  // the plan stage pulled and the implement stage ran the throwaway proofs on (IRIS 2026.1 Build 234U, IPM 0.10.5).
  it("pins the oldest IRIS Community tag whose key is valid for months ahead (2026.1) by its manifest-list digest", () => {
    expect(OLDEST_IRIS_COMMUNITY_IMAGE).toBe(
      "intersystems/iris-community:2026.1@sha256:c57b65b2b454494091e7b3e49f6a53b3335f40adf475bcfcee0866083f35a7c2",
    );
    expect(validateImage(OLDEST_IRIS_COMMUNITY_IMAGE)).toBe(OLDEST_IRIS_COMMUNITY_IMAGE);
    expect(OLDEST_IRIS_COMMUNITY_IMAGE, "no longer the 2025.3 digest whose key expires on 2026-11-13").not.toContain("f456892d143d54a1");
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

  it.each(["USER", "HSCUSTOM", "A", "ABC123", `A${"B".repeat(63)}`])("accepts the namespace %j", (namespace) => {
    expect(validateNamespace(namespace)).toBe(namespace);
  });

  it.each(["", "user", "1ABC", "ABC-DEF", "AB CD", "ABC;rm", "%SYS", "A".repeat(65), undefined, 5])("refuses %j as a namespace", (namespace) => {
    expect(() => validateNamespace(namespace)).toThrow(/refusing the namespace/);
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

  it("publishes on the requested loopback port when one is given, and builds today's argv when it is omitted", () => {
    const fixed = buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name: GENERATED_NAME, hostPort: "52790" });

    expect(fixed).toEqual(["run", "-d", "--name", GENERATED_NAME, "--label", OWNER_LABEL, "-p", "127.0.0.1:52790:52773", IRIS_COMMUNITY_IMAGE]);
    expect(buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name: GENERATED_NAME, hostPort: 52791 })[7]).toBe("127.0.0.1:52791:52773");
    expect(buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name: GENERATED_NAME })[7]).toBe("127.0.0.1::52773");
  });

  it.each(["52773", 52773, "1972", "0", "65536", "abc", ""])("refuses to publish on the host port %j", (hostPort) => {
    expect(() => buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name: GENERATED_NAME, hostPort })).toThrow(/refusing (the )?host port/);
  });

  it("refuses to build a run for a floating image or for a name it did not generate", () => {
    expect(() => buildRunArgv({ image: "intersystems/iris-community:latest", name: GENERATED_NAME })).toThrow(/digest/);
    expect(() => buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name: SHARED_INSTANCE_CONTAINER })).toThrow(/shared IRIS instance/);
  });

  it("inspects and reads the log of one container by id or generated name, and refuses any other reference", () => {
    expect(buildInspectArgv(CONTAINER_ID)).toEqual(["inspect", CONTAINER_ID]);
    expect(buildInspectArgv(GENERATED_NAME)).toEqual(["inspect", GENERATED_NAME]);
    expect(buildLogsArgv(CONTAINER_ID, 400)).toEqual(["logs", "--tail", "400", CONTAINER_ID]);
    for (const other of [SHARED_INSTANCE_CONTAINER, "ocupilot-slot-1", "$(docker ps -q)", ""]) {
      expect(() => buildInspectArgv(other), other).toThrow();
      expect(() => buildLogsArgv(other, 400), other).toThrow();
    }
    expect(() => buildLogsArgv(CONTAINER_ID, 0)).toThrow(/log tail/);
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
      IRIS_HTTPS: "false",
      IRIS_THROWAWAY: GENERATED_NAME,
    });
  });

  it("takes the namespace of the throwaway, USER when none is given", () => {
    expect(buildChildEnv({}, { port: "49153", name: GENERATED_NAME }).IRIS_NAMESPACE).toBe("USER");
    expect(buildChildEnv({}, { port: "49153", name: GENERATED_NAME, namespace: "HSCUSTOM" }).IRIS_NAMESPACE).toBe("HSCUSTOM");
    expect(() => buildChildEnv({}, { port: "49153", name: GENERATED_NAME, namespace: "hscustom" })).toThrow(/refusing the namespace/);
  });

  it("refuses the shared instance's port and a name it did not generate", () => {
    expect(() => buildChildEnv({}, { port: "52773", name: GENERATED_NAME })).toThrow(/shared IRIS instance/);
    expect(() => buildChildEnv({}, { port: "49153", name: SHARED_INSTANCE_CONTAINER })).toThrow(/shared IRIS instance/);
  });
});

describe("throwaway-iris: the environment of a throwaway target (assertThrowawayEnv)", () => {
  const harnessEnv = buildChildEnv({ PATH: "/usr/bin" }, { port: "52790", name: GENERATED_NAME, namespace: "HSCUSTOM" });

  it("accepts the environment the harness builds, for any namespace", () => {
    expect(throwawayEnvProblems(harnessEnv)).toEqual([]);
    expect(() => assertThrowawayEnv(harnessEnv)).not.toThrow();
  });

  it.each([
    ["no arming variable", { IRIS_REQUIRE_LIVE: undefined }, /IRIS_REQUIRE_LIVE/],
    ["IRIS_REQUIRE_LIVE=true", { IRIS_REQUIRE_LIVE: "true" }, /IRIS_REQUIRE_LIVE/],
    ["IRIS_REQUIRE_LIVE=0", { IRIS_REQUIRE_LIVE: "0" }, /IRIS_REQUIRE_LIVE/],
    ["no IRIS_THROWAWAY", { IRIS_THROWAWAY: undefined }, /IRIS_THROWAWAY/],
    ["a container name the harness did not generate", { IRIS_THROWAWAY: "ocupilot-slot-1" }, /IRIS_THROWAWAY.*only handles names it generates/],
    ["the shared instance's container name", { IRIS_THROWAWAY: SHARED_INSTANCE_CONTAINER }, /IRIS_THROWAWAY.*shared IRIS instance/],
    ["another host", { IRIS_HOST: "prod.example" }, /IRIS_HOST/],
    ["localhost, which is not the loopback address", { IRIS_HOST: "localhost" }, /IRIS_HOST/],
    ["no host", { IRIS_HOST: undefined }, /IRIS_HOST/],
    ["port 52773", { IRIS_PORT: "52773" }, /IRIS_PORT.*shared IRIS instance/],
    ["port 1972", { IRIS_PORT: "1972" }, /IRIS_PORT.*shared IRIS instance/],
    ["no port", { IRIS_PORT: undefined }, /IRIS_PORT/],
    ["a port that is not a number", { IRIS_PORT: "abc" }, /IRIS_PORT/],
  ])("refuses %s", (_label, change, problem) => {
    const env: Record<string, string | undefined> = { ...harnessEnv, ...change };

    expect(throwawayEnvProblems(env).join(" ")).toMatch(problem);
    expect(() => assertThrowawayEnv(env)).toThrow(/does not target a throwaway IRIS container/);
  });

  it("names every problem at once", () => {
    const problems = throwawayEnvProblems({ IRIS_HOST: "prod.example", IRIS_PORT: "52773" });

    expect(problems.length).toBe(4);
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

  it("adds the host port to the result of `run` only when the flag is given", () => {
    expect(parseCli(["run", "--host-port", "52790", "--", "true"])).toEqual({ image: IRIS_COMMUNITY_IMAGE, command: ["true"], hostPort: "52790" });
    expect(parseCli(["run", "--image", OLDEST_IRIS_COMMUNITY_IMAGE, "--host-port", "52790", "--", "pnpm", "test"])).toEqual({
      image: OLDEST_IRIS_COMMUNITY_IMAGE,
      command: ["pnpm", "test"],
      hostPort: "52790",
    });
    expect(Object.keys(parseCli(["run", "--", "true"]))).toEqual(["image", "command"]);
  });

  it.each(["52773", "1972", "0", "65536", "abc"])("refuses `run --host-port %s`", (port) => {
    expect(() => parseCli(["run", "--host-port", port, "--", "true"])).toThrow(/refusing (the )?host port/);
  });

  it("parses `up`: every option is required, and each is validated", () => {
    const state = "/tmp/throwaway-live.json";

    expect(parseCli(["up", "--image", IRISHEALTH_COMMUNITY_IMAGE, "--namespace", "HSCUSTOM", "--host-port", "52791", "--state", state])).toEqual({
      subcommand: "up",
      image: IRISHEALTH_COMMUNITY_IMAGE,
      namespace: "HSCUSTOM",
      hostPort: "52791",
      state,
    });
    for (const [label, argv] of [
      ["no image", ["up", "--namespace", "USER", "--host-port", "52791", "--state", state]],
      ["no namespace", ["up", "--image", IRIS_COMMUNITY_IMAGE, "--host-port", "52791", "--state", state]],
      ["no host port", ["up", "--image", IRIS_COMMUNITY_IMAGE, "--namespace", "USER", "--state", state]],
      ["no state", ["up", "--image", IRIS_COMMUNITY_IMAGE, "--namespace", "USER", "--host-port", "52791"]],
      ["a floating image", ["up", "--image", "intersystems/iris-community:2026.2", "--namespace", "USER", "--host-port", "52791", "--state", state]],
      ["a lower-case namespace", ["up", "--image", IRIS_COMMUNITY_IMAGE, "--namespace", "user", "--host-port", "52791", "--state", state]],
      ["port 52773", ["up", "--image", IRIS_COMMUNITY_IMAGE, "--namespace", "USER", "--host-port", "52773", "--state", state]],
      ["port 1972", ["up", "--image", IRIS_COMMUNITY_IMAGE, "--namespace", "USER", "--host-port", "1972", "--state", state]],
      ["a repeated option", ["up", "--image", IRIS_COMMUNITY_IMAGE, "--image", IRIS_COMMUNITY_IMAGE, "--namespace", "USER", "--host-port", "52791", "--state", state]],
      ["a command", ["up", "--image", IRIS_COMMUNITY_IMAGE, "--namespace", "USER", "--host-port", "52791", "--state", state, "--", "true"]],
    ] as Array<[string, string[]]>) {
      expect(() => parseCli(argv), label).toThrow();
    }
  });

  it("parses `exec`, `logs` and `down` with their state file", () => {
    expect(parseCli(["exec", "--state", "s.json", "--", "node", "x.mjs"])).toEqual({ subcommand: "exec", state: "s.json", command: ["node", "x.mjs"] });
    expect(parseCli(["logs", "--state", "s.json"])).toEqual({ subcommand: "logs", state: "s.json" });
    expect(parseCli(["down", "--state", "s.json"])).toEqual({ subcommand: "down", state: "s.json" });
    for (const argv of [
      ["exec", "--", "true"],
      ["exec", "--state", "s.json"],
      ["exec", "--state", "s.json", "--"],
      ["exec", "--image", IRIS_COMMUNITY_IMAGE, "--state", "s.json", "--", "true"],
      ["logs"],
      ["down"],
      ["logs", "--state", "s.json", "--", "true"],
      ["down", "--state", "s.json", "extra"],
    ]) {
      expect(() => parseCli(argv), argv.join(" ")).toThrow();
    }
  });

  it("validates the state file the harness reads: every field is one it writes", () => {
    const state = { name: GENERATED_NAME, id: CONTAINER_ID, port: "52791", image: IRISHEALTH_COMMUNITY_IMAGE, namespace: "HSCUSTOM" };

    expect(parseState(JSON.stringify(state))).toEqual(state);
    for (const [label, change] of [
      ["the shared instance's container", { name: SHARED_INSTANCE_CONTAINER }],
      ["a container id that is not 64 hex digits", { id: "iris-community-edition" }],
      ["port 52773", { port: "52773" }],
      ["a floating image", { image: "intersystems/iris-community:latest" }],
      ["a lower-case namespace", { namespace: "hscustom" }],
      ["a missing field", { name: undefined }],
    ] as Array<[string, Record<string, unknown>]>) {
      expect(() => parseState(JSON.stringify({ ...state, ...change })), label).toThrow();
    }
    expect(() => parseState("not json")).toThrow(/not JSON/);
    expect(() => parseState("[]")).toThrow(/not a JSON object/);
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

/** The reply of the stand-in docker to the calls that start and ready a container (inspect and logs included). */
function defaultStartReply(args: string[], input: string | undefined): { status: number | null; stdout?: string; stderr?: string } {
  switch (args[0]) {
    case "run":
      return { status: 0, stdout: `${CONTAINER_ID}\n` };
    case "port":
      return { status: 0, stdout: "127.0.0.1:49153\n" };
    case "exec":
      return { status: 0, stdout: input?.includes("UnExpireUserPasswords") ? "IRISMCP-UNEXPIRE:OK:END\n" : "IRISMCP-READY\n" };
    case "logs":
      return { status: 0, stdout: "container log tail" };
    case "inspect":
      return { status: 0, stdout: JSON.stringify(inspectedThrowaway()) };
    default:
      return { status: 0, stdout: "" };
  }
}

/** A recording stand-in for every side effect of the harness; no docker, no network, no process. */
function recordingHarness(overrides: { dockerReply?: (args: string[], input: string | undefined) => { status: number | null; stdout?: string; stderr?: string } } = {}) {
  const events: string[] = [];
  const dockerCalls: string[][] = [];
  const dockerInputs: Array<string | undefined> = [];
  const dockerTimeouts: Array<number | undefined> = [];
  const logs: string[] = [];
  const commands: Array<{ command: string[]; env: Record<string, string> }> = [];
  const files = new Map<string, string>();
  const scripts = new Map<string, string>();
  const output: string[] = [];
  const mountProblems = new Map<string, string>();
  let clock = 0;
  let exitCode = 7;

  const deps = {
    findDocker: (): string | undefined => "/fake/docker",
    docker: (args: string[], options: { input?: string; timeoutMs?: number } = {}) => {
      dockerCalls.push(args);
      dockerInputs.push(options.input);
      dockerTimeouts.push(options.timeoutMs);
      events.push(`docker ${args[0]}`);
      const reply = (overrides.dockerReply ?? defaultStartReply)(args, options.input);
      return { status: reply.status, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
    },
    readScript: (file: string): string => {
      const text = scripts.get(file);
      if (text === undefined) throw new Error(`ENOENT: no such file ${file}`);
      return text;
    },
    out: (text: string): void => {
      output.push(text);
    },
    checkMountDirectory: (directory: string): string | undefined => mountProblems.get(directory),
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
    fileExists: (file: string): boolean => files.has(file),
    readState: (file: string): string | undefined => files.get(file),
    writeState: (file: string, text: string): void => {
      events.push("write state");
      files.set(file, text);
    },
    removeState: (file: string): void => {
      events.push("remove state");
      files.delete(file);
    },
  };
  const teardown = createTeardown((args: string[]) => deps.docker(args));
  return {
    deps,
    teardown,
    events,
    dockerCalls,
    dockerInputs,
    dockerTimeouts,
    logs,
    commands,
    files,
    scripts,
    output,
    mountProblems,
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
  it("starts the container, reads the port, waits for readiness, runs the command with the throwaway environment, returns its exit code, and removes the container last (the log tail first, as the command failed)", async () => {
    const harness = recordingHarness();

    const code = await runHarness(harness.options(), harness.deps, harness.teardown);

    expect(code).toBe(7);
    expect(harness.events).toEqual(["docker run", "docker port", "docker exec", "docker exec", "command", "docker logs", "docker rm"]);
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
          IRIS_HTTPS: "false",
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

  it("returns a failing command's exit code, prints the container log tail before it removes the container", async () => {
    const harness = recordingHarness();
    harness.setExitCode(3);

    expect(await runHarness(harness.options(), harness.deps, harness.teardown)).toBe(3);
    expect(harness.events.slice(-3)).toEqual(["command", "docker logs", "docker rm"]);
    expect(harness.dockerCalls[harness.dockerCalls.length - 2]).toEqual(["logs", "--tail", "200", CONTAINER_ID]);
    expect(harness.logs.join("\n")).toContain("container log tail");
  });

  it("prints no container log when the command succeeds", async () => {
    const harness = recordingHarness();
    harness.setExitCode(0);

    expect(await runHarness(harness.options(), harness.deps, harness.teardown)).toBe(0);
    expect(harness.events).toEqual(["docker run", "docker port", "docker exec", "docker exec", "command", "docker rm"]);
  });

  it("publishes on the requested host port, and ends the run when docker reports another one", async () => {
    const same = recordingHarness({
      dockerReply: (args, input) => (args[0] === "port" ? { status: 0, stdout: "127.0.0.1:52790\n" } : defaultStartReply(args, input)),
    });
    same.setExitCode(0);
    expect(await runHarness(same.options({ hostPort: "52790" }), same.deps, same.teardown)).toBe(0);
    expect((same.dockerCalls[0] as string[])[7]).toBe("127.0.0.1:52790:52773");
    expect(same.commands[0]?.env.IRIS_PORT).toBe("52790");

    const other = recordingHarness();
    expect(await runHarness(other.options({ hostPort: "52790" }), other.deps, other.teardown)).toBe(4);
    expect(other.logs.join("\n")).toMatch(/not on the requested 52790/);
    expect(other.commands).toEqual([]);
    expect(other.events.slice(-1)).toEqual(["docker rm"]);
  });

  it("refuses a requested host port of 52773 or 1972 before it looks for docker", async () => {
    for (const hostPort of ["52773", "1972"]) {
      const harness = recordingHarness();

      expect(await runHarness(harness.options({ hostPort }), harness.deps, harness.teardown)).toBe(2);
      expect(harness.dockerCalls).toEqual([]);
    }
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
    expect(harness.dockerCalls.slice(-2), "the log tail is printed before the container is removed").toEqual([["logs", "--tail", "200", CONTAINER_ID], ["rm", "-f", "-v", CONTAINER_ID]]);
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

const STATE_FILE = "/virtual/throwaway-live.json";
const KEPT_STATE = { name: GENERATED_NAME, id: CONTAINER_ID, port: "49153", image: IRISHEALTH_COMMUNITY_IMAGE, namespace: "HSCUSTOM" };
const AMBIENT_ENV = { PATH: "/usr/bin", IRIS_HOST: "prod.example", IRIS_PASSWORD: "secret", IRIS_HTTPS: "true" } as Record<string, string | undefined>;

/** A harness whose state file already records a throwaway (what `up` leaves behind). */
function keptHarness(overrides: Parameters<typeof recordingHarness>[0] = {}) {
  const harness = recordingHarness(overrides);
  harness.files.set(STATE_FILE, JSON.stringify(KEPT_STATE));
  return harness;
}

const stateOptions = () => ({ state: STATE_FILE, env: AMBIENT_ENV });

/** A docker stand-in whose `inspect` reports the throwaway with `overrides`, or the raw `stdout` / failure given. */
const inspectReply =
  (reply: { overrides?: Record<string, unknown>; stdout?: string; status?: number; stderr?: string }) =>
  (args: string[], input: string | undefined) =>
    args[0] === "inspect"
      ? { status: reply.status ?? 0, stdout: reply.stdout ?? JSON.stringify(inspectedThrowaway(reply.overrides)), stderr: reply.stderr ?? "" }
      : defaultStartReply(args, input);

/** Containers `exec`, `logs` and `down` must refuse: each is something other than the throwaway the state file records. */
const NOT_THE_THROWAWAY: Array<[string, { overrides?: Record<string, unknown>; stdout?: string }, RegExp]> = [
  ["an unlabelled container", { overrides: { Config: { Labels: {} } } }, /does not carry the label iris-mcp\.owner=throwaway/],
  ["a container with another owner label", { overrides: { Config: { Labels: { "iris-mcp.owner": "someone" } } } }, /does not carry the label/],
  ["another container name", { overrides: { Name: "/iris-community-edition" } }, /is named/],
  ["a container that publishes another port", { overrides: { NetworkSettings: { Ports: { "52773/tcp": [{ HostIp: "127.0.0.1", HostPort: "52773" }] } } } }, /does not publish/],
  ["two containers", { stdout: JSON.stringify([...inspectedThrowaway(), ...inspectedThrowaway()]) }, /exactly one container/],
];

describe("throwaway-iris: up keeps its container only on success", () => {
  const upOptions = (harness: ReturnType<typeof recordingHarness>, extra: Record<string, unknown> = {}) => ({
    image: IRISHEALTH_COMMUNITY_IMAGE,
    namespace: "HSCUSTOM",
    hostPort: "49153",
    state: STATE_FILE,
    env: harness.options().env,
    ...extra,
  });

  it("starts the container on the requested loopback port, readies it, writes the state and removes nothing", async () => {
    const harness = recordingHarness();

    const code = await upHarness(upOptions(harness), harness.deps, harness.teardown);

    expect(code).toBe(0);
    expect(harness.events).toEqual(["docker run", "docker port", "docker exec", "docker exec", "write state"]);
    const runArgs = harness.dockerCalls[0] as string[];
    expect(runArgs).toEqual(["run", "-d", "--name", runArgs[3], "--label", OWNER_LABEL, "-p", "127.0.0.1:49153:52773", IRISHEALTH_COMMUNITY_IMAGE]);
    const state = JSON.parse(harness.files.get(STATE_FILE) as string) as Record<string, string>;
    expect(state).toEqual({ name: runArgs[3], id: CONTAINER_ID, port: "49153", image: IRISHEALTH_COMMUNITY_IMAGE, namespace: "HSCUSTOM" });
    expect(parseState(harness.files.get(STATE_FILE) as string)).toEqual(state);
    expect(harness.commands, "up runs no command").toEqual([]);
    expect(harness.teardown.armed, "nothing is left armed for the exit handler").toBeUndefined();
    harness.teardown.run();
    expect(harness.events, "a later teardown run removes nothing").not.toContain("docker rm");
  });

  it.each([
    ["docker run fails", (args: string[], input?: string) => (args[0] === "run" ? { status: 125, stderr: "no such image" } : defaultStartReply(args, input)), ["docker run", "docker rm"]],
    ["docker prints no container id", (args: string[], input?: string) => (args[0] === "run" ? { status: 0, stdout: "WARNING\n" } : defaultStartReply(args, input)), ["docker run", "docker rm"]],
    ["docker publishes another port than the requested one", (args: string[], input?: string) => (args[0] === "port" ? { status: 0, stdout: "127.0.0.1:50000\n" } : defaultStartReply(args, input)), ["docker run", "docker port", "docker rm"]],
    ["docker publishes the shared instance's port", (args: string[], input?: string) => (args[0] === "port" ? { status: 0, stdout: "127.0.0.1:52773\n" } : defaultStartReply(args, input)), ["docker run", "docker port", "docker rm"]],
    ["the unexpiry does not report OK", (args: string[], input?: string) => (args[0] === "exec" && input?.includes("UnExpireUserPasswords") ? { status: 0, stdout: "IRISMCP-UNEXPIRE:FAILED:x:END\n" } : defaultStartReply(args, input)), ["docker run", "docker port", "docker exec", "docker exec", "docker logs", "docker rm"]],
  ])("removes the container and writes no state when %s", async (_label, dockerReply, events) => {
    const harness = recordingHarness({ dockerReply });

    expect(await upHarness(upOptions(harness), harness.deps, harness.teardown)).toBe(4);
    expect(harness.events).toEqual(events);
    expect(harness.files.size, "no state file").toBe(0);
    expect(harness.dockerCalls[harness.dockerCalls.length - 1]).toEqual(["rm", "-f", "-v", (harness.dockerCalls[harness.dockerCalls.length - 1] as string[])[3]]);
  });

  it("removes the container and writes no state when the session never answers", async () => {
    const harness = recordingHarness({ dockerReply: (args, input) => (args[0] === "exec" ? { status: 1, stderr: "not ready" } : defaultStartReply(args, input)) });

    const code = await upHarness(upOptions(harness, { limits: { sessionReadyMs: 10_000, sessionStepMs: 5_000 } }), harness.deps, harness.teardown);

    expect(code).toBe(4);
    expect(harness.events.slice(-2), "the log tail is printed before the container is removed").toEqual(["docker logs", "docker rm"]);
    expect(harness.logs.join("\n")).toContain("container log tail");
    expect(harness.files.size).toBe(0);
  });

  it("removes the container and writes no state when the web port never answers 200, printing the log tail first", async () => {
    const harness = recordingHarness();
    harness.deps.webStatus = async () => 503;

    const code = await upHarness(upOptions(harness, { limits: { webReadyMs: 4_000, webStepMs: 2_000 } }), harness.deps, harness.teardown);

    expect(code).toBe(4);
    expect(harness.dockerCalls.slice(-2)).toEqual([["logs", "--tail", "200", CONTAINER_ID], ["rm", "-f", "-v", CONTAINER_ID]]);
    expect(harness.logs.join("\n")).toContain("container log tail");
    expect(harness.files.size).toBe(0);
  });

  it("removes the container when the state file cannot be written", async () => {
    const harness = recordingHarness();
    harness.deps.writeState = () => {
      throw new Error("EACCES");
    };

    expect(await upHarness(upOptions(harness), harness.deps, harness.teardown)).toBe(4);
    expect(harness.events[harness.events.length - 1]).toBe("docker rm");
    expect(harness.files.size).toBe(0);
  });

  it.each([
    ["a floating image", { image: "intersystems/iris-community:2026.2" }],
    ["a lower-case namespace", { namespace: "hscustom" }],
    ["host port 52773", { hostPort: "52773" }],
    ["host port 1972", { hostPort: "1972" }],
    ["a state file that already exists", { state: STATE_FILE, existing: true }],
  ])("refuses %s with exit 2, before docker is looked for", async (_label, extra) => {
    const harness = recordingHarness();
    if ("existing" in extra) harness.files.set(STATE_FILE, "{}");
    let looked = false;
    harness.deps.findDocker = () => {
      looked = true;
      return "/fake/docker";
    };

    expect(await upHarness(upOptions(harness, extra), harness.deps, harness.teardown)).toBe(2);
    expect(looked).toBe(false);
    expect(harness.dockerCalls).toEqual([]);
  });

  it("exits 3 and calls no docker when docker is not on PATH", async () => {
    const harness = recordingHarness();
    harness.deps.findDocker = () => undefined;

    expect(await upHarness(upOptions(harness), harness.deps, harness.teardown)).toBe(3);
    expect(harness.dockerCalls).toEqual([]);
    expect(harness.files.size).toBe(0);
  });
});

describe("throwaway-iris: exec re-inspects the container and runs the command with the throwaway environment", () => {
  it("runs the command with the namespace of the state, IRIS_HTTPS=false and the throwaway name, after one docker inspect", async () => {
    const harness = keptHarness();
    harness.setExitCode(5);

    const code = await execHarness({ ...stateOptions(), command: ["node", "scripts/ci-seed-throwaway.mjs"] }, harness.deps);

    expect(code, "the command's exit code").toBe(5);
    expect(harness.dockerCalls).toEqual([["inspect", CONTAINER_ID]]);
    expect(harness.commands).toEqual([
      {
        command: ["node", "scripts/ci-seed-throwaway.mjs"],
        env: {
          PATH: "/usr/bin",
          IRIS_REQUIRE_LIVE: "1",
          IRIS_HOST: "127.0.0.1",
          IRIS_PORT: "49153",
          IRIS_USERNAME: "_SYSTEM",
          IRIS_PASSWORD: "SYS",
          IRIS_NAMESPACE: "HSCUSTOM",
          IRIS_HTTPS: "false",
          IRIS_THROWAWAY: GENERATED_NAME,
        },
      },
    ]);
  });

  it.each(NOT_THE_THROWAWAY)("refuses %s with exit 2 and runs nothing", async (_label, reply, problem) => {
    const harness = keptHarness({ dockerReply: inspectReply(reply) });

    const code = await execHarness({ ...stateOptions(), command: ["node", "x.mjs"] }, harness.deps);

    expect(code).toBe(2);
    expect(harness.commands).toEqual([]);
    expect(harness.logs.join("\n")).toMatch(problem);
  });

  it("refuses a container that is not running", async () => {
    const harness = keptHarness({ dockerReply: inspectReply({ overrides: { State: { Running: false } } }) });

    expect(await execHarness({ ...stateOptions(), command: ["node", "x.mjs"] }, harness.deps)).toBe(2);
    expect(harness.commands).toEqual([]);
    expect(harness.logs.join("\n")).toMatch(/not running/);
  });

  it("refuses when docker inspect fails", async () => {
    const harness = keptHarness({ dockerReply: inspectReply({ status: 1, stdout: "", stderr: "No such object" }) });

    expect(await execHarness({ ...stateOptions(), command: ["node", "x.mjs"] }, harness.deps)).toBe(2);
    expect(harness.commands).toEqual([]);
  });

  it.each([
    ["no state file", undefined],
    ["a state file that is not JSON", "not json"],
    ["a state file that names the shared instance's container", JSON.stringify({ ...KEPT_STATE, name: SHARED_INSTANCE_CONTAINER })],
    ["a state file with the shared instance's port", JSON.stringify({ ...KEPT_STATE, port: "52773" })],
  ])("refuses %s with exit 2, before any docker call", async (_label, text) => {
    const harness = recordingHarness();
    if (text !== undefined) harness.files.set(STATE_FILE, text);

    expect(await execHarness({ ...stateOptions(), command: ["node", "x.mjs"] }, harness.deps)).toBe(2);
    expect(harness.dockerCalls).toEqual([]);
    expect(harness.commands).toEqual([]);
  });

  it("exits 3 when docker is not on PATH", async () => {
    const harness = keptHarness();
    harness.deps.findDocker = () => undefined;

    expect(await execHarness({ ...stateOptions(), command: ["node", "x.mjs"] }, harness.deps)).toBe(3);
    expect(harness.commands).toEqual([]);
  });
});

describe("throwaway-iris: logs prints the container log, and a missing state file is nothing to do", () => {
  it("prints the last 400 lines of the container the state file records", async () => {
    const harness = keptHarness();

    expect(await logsHarness(stateOptions(), harness.deps)).toBe(0);
    expect(harness.dockerCalls).toEqual([["inspect", CONTAINER_ID], ["logs", "--tail", "400", CONTAINER_ID]]);
    expect(harness.logs.join("\n")).toContain("container log tail");
  });

  it("reads the log of a stopped container that still carries the name and the label", async () => {
    const harness = keptHarness({ dockerReply: inspectReply({ overrides: { State: { Running: false }, NetworkSettings: { Ports: {} } } }) });

    expect(await logsHarness(stateOptions(), harness.deps)).toBe(0);
    expect(harness.dockerCalls.map((call) => call[0])).toEqual(["inspect", "logs"]);
  });

  it.each(NOT_THE_THROWAWAY)("refuses %s with exit 2 and reads no log", async (_label, reply, problem) => {
    const harness = keptHarness({ dockerReply: inspectReply(reply) });

    expect(await logsHarness(stateOptions(), harness.deps)).toBe(2);
    expect(harness.dockerCalls.map((call) => call[0])).toEqual(["inspect"]);
    expect(harness.logs.join("\n")).toMatch(problem);
  });

  it("exits 0 and calls no docker when there is no state file", async () => {
    const harness = recordingHarness();

    expect(await logsHarness(stateOptions(), harness.deps)).toBe(0);
    expect(harness.dockerCalls).toEqual([]);
  });
});

describe("throwaway-iris: down removes the recorded container, once", () => {
  it("removes the container by id and the state file, and a second down is a no-op", async () => {
    const harness = keptHarness();

    expect(await downHarness(stateOptions(), harness.deps)).toBe(0);
    expect(harness.dockerCalls).toEqual([["inspect", CONTAINER_ID], ["rm", "-f", "-v", CONTAINER_ID]]);
    expect(harness.files.size, "the state file is gone").toBe(0);

    expect(await downHarness(stateOptions(), harness.deps)).toBe(0);
    expect(harness.dockerCalls.length, "the second down calls no docker").toBe(2);
  });

  it("removes a stopped container that still carries the name and the label", async () => {
    const harness = keptHarness({ dockerReply: inspectReply({ overrides: { State: { Running: false }, NetworkSettings: { Ports: {} } } }) });

    expect(await downHarness(stateOptions(), harness.deps)).toBe(0);
    expect(harness.dockerCalls[harness.dockerCalls.length - 1]).toEqual(["rm", "-f", "-v", CONTAINER_ID]);
  });

  it.each(NOT_THE_THROWAWAY)("refuses %s with exit 2: nothing is removed and the state file stays", async (_label, reply, problem) => {
    const harness = keptHarness({ dockerReply: inspectReply(reply) });

    expect(await downHarness(stateOptions(), harness.deps)).toBe(2);
    expect(harness.dockerCalls.map((call) => call[0]), "no docker rm").toEqual(["inspect"]);
    expect(harness.files.has(STATE_FILE)).toBe(true);
    expect(harness.logs.join("\n")).toMatch(problem);
  });

  it("keeps the state file and exits 4 when docker rm fails", async () => {
    const harness = keptHarness({ dockerReply: (args, input) => (args[0] === "rm" ? { status: 1, stderr: "daemon error" } : defaultStartReply(args, input)) });

    expect(await downHarness(stateOptions(), harness.deps)).toBe(4);
    expect(harness.files.has(STATE_FILE)).toBe(true);
  });

  it("exits 0 and calls no docker when there is no state file", async () => {
    const harness = recordingHarness();

    expect(await downHarness(stateOptions(), harness.deps)).toBe(0);
    expect(harness.dockerCalls).toEqual([]);
  });
});

describe("throwaway-iris: the environment it hands a command satisfies verify-iris-reachable under CI=true", () => {
  it("reports IRIS unreachable at a closed port, and never an unset IRIS_HTTPS", async () => {
    const port = await reserveClosedPort();
    const env = buildChildEnv({ PATH: process.env.PATH, CI: "true" }, { port, name: GENERATED_NAME, namespace: "HSCUSTOM" }) as Record<string, string>;

    const result = await runScriptUnderPreload({
      script: path.join(REPO_ROOT, "scripts", "verify-iris-reachable.mjs"),
      args: [],
      cwd: path.join(REPO_ROOT, "packages", "iris-mcp-all"),
      env,
      watchPorts: [port],
      timeoutMs: 60_000,
    });

    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toMatch(/FAILED CLOSED: IRIS is not reachable/);
    expect(result.stderr).not.toMatch(/IRIS_HTTPS|CI is set but/);
    const { connects } = result;
    expect(connects.length, "the check did try the closed port").toBeGreaterThan(0);
    expect(connects.every((line) => line === `127.0.0.1:${port}`), connects.join(",")).toBe(true);
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

  it("exits 3 for `up` when docker is not on PATH, and 2 when `up` or `run` is given a refused value, without a state file written", () => {
    const state = path.join(scratchDir(), "state.json");
    const up = (extra: string[]) => runScript(["up", "--image", IRISHEALTH_COMMUNITY_IMAGE, "--namespace", "HSCUSTOM", "--host-port", "52791", "--state", state, ...extra]);

    expect(up([]).status).toBe(3);
    expect(runScript(["up", "--image", IRISHEALTH_COMMUNITY_IMAGE, "--namespace", "HSCUSTOM", "--host-port", "52773", "--state", state]).status).toBe(2);
    expect(runScript(["run", "--host-port", "1972", "--", "true"]).status).toBe(2);
    expect(existsSync(state)).toBe(false);
  });

  it("exits 2 for `exec` and 0 for `logs` and `down` when there is no state file, and calls no docker", () => {
    const state = path.join(scratchDir(), "missing.json");

    expect(runScript(["exec", "--state", state, "--", "true"]).status).toBe(2);
    expect(runScript(["logs", "--state", state]).status).toBe(0);
    expect(runScript(["down", "--state", state]).status).toBe(0);
  });

  it("refuses a state file that names the shared instance's container, with exit 2, before docker is looked for", () => {
    const state = path.join(scratchDir(), "shared.json");
    writeFileSync(state, JSON.stringify({ ...KEPT_STATE, name: SHARED_INSTANCE_CONTAINER }), "utf8");

    for (const subcommand of ["logs", "down"]) {
      const result = runScript([subcommand, "--state", state]);

      expect(result.status, subcommand).toBe(2);
      expect(result.stderr).toMatch(/shared IRIS instance/);
    }
    expect(existsSync(state)).toBe(true);
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

describe("throwaway-iris: the state file the real writer produces", () => {
  it.skipIf(process.platform === "win32")("is written with mode 0600, never over an existing file, and removed by removeState", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "throwaway-state-"));
    try {
      const file = path.join(directory, "state.json");
      const deps = defaultDeps({});

      deps.writeState(file, '{"first":true}\n');
      expect(statSync(file).mode & 0o777).toBe(0o600);

      expect(() => deps.writeState(file, '{"second":true}\n')).toThrow(/EEXIST/);
      expect(readFileSync(file, "utf8")).toBe('{"first":true}\n');

      expect(deps.readState(file)).toBe('{"first":true}\n');
      deps.removeState(file);
      expect(existsSync(file)).toBe(false);
      expect(deps.readState(file), "a missing state file reads as undefined").toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

// ── Story 42.4 (AC 42.4.2): `up --network none`, `--mount`, `session` and `cp` ─────────────────────────────────────────

const MOUNT_HOST = "/virtual/stage";
const MOUNT_SPEC = `${MOUNT_HOST}:/opt/iris-mcp/stage`;
const NONE_STATE = { name: GENERATED_NAME, id: CONTAINER_ID, image: IRIS_COMMUNITY_IMAGE, namespace: "USER", network: "none" };

/** The parsed output of `docker inspect` for a healthy `--network none` throwaway: the web port is exposed by the image but bound to nothing. */
function inspectedIsolated(overrides: Record<string, unknown> = {}): unknown[] {
  return [
    {
      Name: `/${GENERATED_NAME}`,
      State: { Running: true },
      Config: { Labels: { "iris-mcp.owner": "throwaway" } },
      HostConfig: { NetworkMode: "none", PortBindings: {} },
      NetworkSettings: { Ports: { "52773/tcp": null } },
      ...overrides,
    },
  ];
}

/** A docker stand-in whose `inspect` reports a `--network none` throwaway with `overrides`. */
const isolatedReply =
  (overrides: Record<string, unknown> = {}) =>
  (args: string[], input: string | undefined) =>
    args[0] === "inspect" ? { status: 0, stdout: JSON.stringify(inspectedIsolated(overrides)) } : defaultStartReply(args, input);

/** A harness whose state file records a `--network none` throwaway. */
function isolatedHarness(overrides: Parameters<typeof recordingHarness>[0] = {}, state: Record<string, unknown> = NONE_STATE) {
  const harness = recordingHarness({ dockerReply: overrides.dockerReply ?? isolatedReply() });
  harness.files.set(STATE_FILE, JSON.stringify(state));
  return harness;
}

describe("throwaway-iris: `docker run --network none` and the read-only mount", () => {
  it("builds the isolated argv: no -p, the network, no mount unless asked for, and the image last", () => {
    expect(buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name: GENERATED_NAME, network: "none" })).toEqual([
      "run", "-d", "--name", GENERATED_NAME, "--label", OWNER_LABEL, "--network", "none", IRIS_COMMUNITY_IMAGE,
    ]);
    const mounted = buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name: GENERATED_NAME, network: "none", mount: MOUNT_SPEC });
    expect(mounted).toEqual([
      "run", "-d", "--name", GENERATED_NAME, "--label", OWNER_LABEL, "--network", "none", "-v", `${MOUNT_HOST}:/opt/iris-mcp/stage:ro`, IRIS_COMMUNITY_IMAGE,
    ]);
    expect(mounted, "an isolated container publishes nothing").not.toContain("-p");
  });

  it("leaves `run`'s argv byte-identical when neither a network nor a mount is given, and adds only the read-only -v for a mount", () => {
    expect(buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name: GENERATED_NAME })).toEqual([
      "run", "-d", "--name", GENERATED_NAME, "--label", OWNER_LABEL, "-p", "127.0.0.1::52773", IRIS_COMMUNITY_IMAGE,
    ]);
    expect(buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name: GENERATED_NAME, hostPort: "49153", mount: MOUNT_SPEC })).toEqual([
      "run", "-d", "--name", GENERATED_NAME, "--label", OWNER_LABEL, "-p", "127.0.0.1:49153:52773", "-v", `${MOUNT_HOST}:/opt/iris-mcp/stage:ro`, IRIS_COMMUNITY_IMAGE,
    ]);
  });

  it.each([
    ["a host port with --network none", { network: "none", hostPort: "49153" }, /publishes no port/],
    ["a network other than none", { network: "host" }, /only network mode this harness takes is "none"/],
    ["a mount with a second colon", { network: "none", mount: `${MOUNT_HOST}:/opt/iris-mcp/stage:rw` }, /exactly one ":"/],
  ])("refuses %s", (_label, extra, problem) => {
    expect(() => buildRunArgv({ image: IRIS_COMMUNITY_IMAGE, name: GENERATED_NAME, ...extra })).toThrow(problem);
  });

  it("accepts the mount <absolute plain directory>:/opt/iris-mcp/<name>", () => {
    expect(validateMount(MOUNT_SPEC)).toEqual({ host: MOUNT_HOST, container: "/opt/iris-mcp/stage", spec: MOUNT_SPEC });
    expect(validateMount("/tmp/a b/c:/opt/iris-mcp/install-1").host).toBe("/tmp/a b/c");
  });

  it.each([
    ["an empty value", ""],
    ["a non-string", undefined],
    ["no container side", MOUNT_HOST],
    ["a third (mode) part", `${MOUNT_SPEC}:rw`],
    ["a relative host directory", "stage:/opt/iris-mcp/stage"],
    ["a host directory with ..", "/virtual/../etc:/opt/iris-mcp/stage"],
    ["a host directory ending in ..", "/virtual/stage/..:/opt/iris-mcp/stage"],
    ["a host directory with .", "/virtual/./stage:/opt/iris-mcp/stage"],
    ["a host directory with a repeated slash", "/virtual//stage:/opt/iris-mcp/stage"],
    ["a host directory with a trailing slash", "/virtual/stage/:/opt/iris-mcp/stage"],
    ["a Windows drive letter", "C:\\stage:/opt/iris-mcp/stage"],
    ["a control character", "/virtual/st\nage:/opt/iris-mcp/stage"],
    ["a container path outside /opt/iris-mcp", `${MOUNT_HOST}:/etc`],
    ["a container path that is /opt/iris-mcp itself", `${MOUNT_HOST}:/opt/iris-mcp`],
    ["a container path with an upper-case name", `${MOUNT_HOST}:/opt/iris-mcp/Stage`],
    ["a container path with a nested directory", `${MOUNT_HOST}:/opt/iris-mcp/a/b`],
    ["a container path with ..", `${MOUNT_HOST}:/opt/iris-mcp/..`],
  ])("refuses %s as a mount", (_label, spec) => {
    expect(() => validateMount(spec)).toThrow(/refusing the mount/);
  });
});

describe("throwaway-iris: the command line of `up --network none`, `session` and `cp`", () => {
  const state = "/tmp/throwaway-ipm.json";
  const noneUp = ["up", "--image", IRIS_COMMUNITY_IMAGE, "--namespace", "USER", "--network", "none", "--state", state];

  it("parses `up --network none`, with and without a mount, and `up --host-port` as before", () => {
    expect(parseCli(noneUp)).toEqual({ subcommand: "up", image: IRIS_COMMUNITY_IMAGE, namespace: "USER", network: "none", state });
    expect(Object.keys(parseCli(noneUp))).not.toContain("hostPort");
    expect(parseCli([...noneUp, "--mount", MOUNT_SPEC])).toEqual({ subcommand: "up", image: IRIS_COMMUNITY_IMAGE, namespace: "USER", network: "none", state, mount: MOUNT_SPEC });
    const published = parseCli(["up", "--image", IRIS_COMMUNITY_IMAGE, "--namespace", "USER", "--host-port", "52791", "--mount", MOUNT_SPEC, "--state", state]);
    expect(published).toEqual({ subcommand: "up", image: IRIS_COMMUNITY_IMAGE, namespace: "USER", hostPort: "52791", state, mount: MOUNT_SPEC });
    expect(Object.keys(published)).not.toContain("network");
  });

  it.each([
    ["--network none with --host-port", [...noneUp, "--host-port", "52791"]],
    ["a network other than none", ["up", "--image", IRIS_COMMUNITY_IMAGE, "--namespace", "USER", "--network", "host", "--state", state]],
    ["a --network with no value", ["up", "--image", IRIS_COMMUNITY_IMAGE, "--namespace", "USER", "--state", state, "--network"]],
    ["a bad mount", [...noneUp, "--mount", "/virtual/../x:/opt/iris-mcp/stage"]],
    ["a repeated --mount", [...noneUp, "--mount", MOUNT_SPEC, "--mount", MOUNT_SPEC]],
    ["no --host-port and no --network", ["up", "--image", IRIS_COMMUNITY_IMAGE, "--namespace", "USER", "--state", state]],
    ["--network on run", ["run", "--network", "none", "--", "true"]],
    ["--mount on run", ["run", "--mount", MOUNT_SPEC, "--", "true"]],
  ])("refuses %s", (_label, argv) => {
    expect(() => parseCli(argv as string[])).toThrow();
  });

  it("parses `session` and `cp` with their state file, and validates each value", () => {
    expect(parseCli(["session", "--state", "s.json", "--namespace", "USER", "--script", "s.mos"])).toEqual({
      subcommand: "session", state: "s.json", namespace: "USER", script: "s.mos",
    });
    expect(parseCli(["session", "--state", "s.json", "--namespace", "%SYS", "--script", "s.mos"]).namespace).toBe("%SYS");
    expect(parseCli(["cp", "--state", "s.json", "--from", "/tmp/iris-mcp-ipm-out/x.tgz", "--to", "out/x.tgz"])).toEqual({
      subcommand: "cp", state: "s.json", from: "/tmp/iris-mcp-ipm-out/x.tgz", to: "out/x.tgz",
    });
    for (const argv of [
      ["session", "--state", "s.json", "--namespace", "USER"],
      ["session", "--state", "s.json", "--script", "s.mos"],
      ["session", "--namespace", "USER", "--script", "s.mos"],
      ["session", "--state", "s.json", "--namespace", "user", "--script", "s.mos"],
      ["session", "--state", "s.json", "--namespace", "USER", "--script", "s.mos", "--", "true"],
      ["cp", "--state", "s.json", "--from", "/tmp/iris-mcp-x/y"],
      ["cp", "--state", "s.json", "--to", "y"],
      ["cp", "--state", "s.json", "--from", "/etc/passwd", "--to", "y"],
      ["cp", "--state", "s.json", "--from", "/tmp/iris-mcp-x/../../etc/passwd", "--to", "y"],
      ["cp", "--state", "s.json", "--from", "/tmp/iris-mcp-x/y", "--to", "other-container:/y"],
      ["cp", "--state", "s.json", "--from", "/tmp/iris-mcp-x/y", "--to", "y", "extra"],
    ]) {
      expect(() => parseCli(argv), argv.join(" ")).toThrow();
    }
  });

  it("prints a usage that names every subcommand", () => {
    let usage = "";
    try {
      parseCli(["start"]);
    } catch (error) {
      usage = (error as Error).message;
    }
    for (const line of ["run ", "up ", "--network none", "--mount", "exec ", "session ", "cp ", "logs ", "down "]) {
      expect(usage, line).toContain(line);
    }
  });
});

describe("throwaway-iris: session and cp argv", () => {
  it("opens the session in the namespace asked for, %SYS by default, and refuses anything else", () => {
    expect(buildSessionArgv(CONTAINER_ID)).toEqual(["exec", "-i", CONTAINER_ID, "iris", "session", "iris", "-U", "%SYS"]);
    expect(buildSessionArgv(CONTAINER_ID, "USER")).toEqual(["exec", "-i", CONTAINER_ID, "iris", "session", "iris", "-U", "USER"]);
    expect(validateSessionNamespace("%SYS")).toBe("%SYS");
    for (const namespace of ["%sys", "user", "%ALL", "USER;x", ""]) {
      expect(() => buildSessionArgv(CONTAINER_ID, namespace), namespace).toThrow(/refusing the namespace/);
    }
  });

  it("copies one file out by container id, under the prefix, and refuses any other source or destination", () => {
    expect(buildCopyArgv(CONTAINER_ID, "/tmp/iris-mcp-ipm-out/x.tgz", "/host/x.tgz")).toEqual(["cp", `${CONTAINER_ID}:/tmp/iris-mcp-ipm-out/x.tgz`, "/host/x.tgz"]);
    expect(validateCopySource("/tmp/iris-mcp-a")).toBe("/tmp/iris-mcp-a");
    for (const from of ["/tmp/other/x", "/tmp/iris-mcp-", "tmp/iris-mcp-x", "/tmp/iris-mcp-x/../y", "/tmp/iris-mcp-x:y", "/tmp/iris-mcp-x\ny", undefined, ""]) {
      expect(() => validateCopySource(from), String(from)).toThrow(/refusing to copy/);
    }
    for (const to of ["", "c:/x", "container:/x", "x\ny", undefined]) {
      expect(() => validateCopyDestination(to), String(to)).toThrow(/refusing to copy to/);
    }
    expect(() => buildCopyArgv("not-an-id", "/tmp/iris-mcp-x", "/host/x")).toThrow(/container id/);
  });
});

describe("throwaway-iris: up --network none keeps a container that has no web port", () => {
  const upOptions = (harness: ReturnType<typeof recordingHarness>, extra: Record<string, unknown> = {}) => ({
    image: IRIS_COMMUNITY_IMAGE,
    namespace: "USER",
    network: "none",
    state: STATE_FILE,
    env: harness.options().env,
    ...extra,
  });

  it("starts the container with --network none, readies it by the session loop and the unexpiry alone (no docker port, no web poll), and writes a state with no port", async () => {
    const harness = recordingHarness();
    let polled = 0;
    harness.deps.webStatus = async () => {
      polled += 1;
      return 200;
    };

    const code = await upHarness(upOptions(harness), harness.deps, harness.teardown);

    expect(code).toBe(0);
    expect(harness.events).toEqual(["docker run", "docker exec", "docker exec", "write state"]);
    expect(polled, "no web port to poll").toBe(0);
    const runArgs = harness.dockerCalls[0] as string[];
    expect(runArgs).toEqual(["run", "-d", "--name", runArgs[3], "--label", OWNER_LABEL, "--network", "none", IRIS_COMMUNITY_IMAGE]);
    expect(harness.dockerInputs[1]).toContain("READY");
    expect(harness.dockerInputs[2]).toContain("UnExpireUserPasswords");
    const recorded = JSON.parse(harness.files.get(STATE_FILE) as string) as Record<string, string>;
    expect(Object.keys(recorded)).toEqual(["name", "id", "image", "namespace", "network"]);
    expect(recorded).toEqual({ name: runArgs[3], id: CONTAINER_ID, image: IRIS_COMMUNITY_IMAGE, namespace: "USER", network: "none" });
    expect(parseState(harness.files.get(STATE_FILE) as string)).toEqual(recorded);
    expect(harness.teardown.armed, "nothing is left armed").toBeUndefined();
    expect(harness.logs.join("\n")).toContain("--network none");
  });

  it("adds the read-only mount to the docker run and records it in the state, once the directory is found to be real", async () => {
    const harness = recordingHarness();

    const code = await upHarness(upOptions(harness, { mount: MOUNT_SPEC }), harness.deps, harness.teardown);

    expect(code).toBe(0);
    expect(harness.dockerCalls[0]).toEqual([
      "run", "-d", "--name", (harness.dockerCalls[0] as string[])[3], "--label", OWNER_LABEL, "--network", "none", "-v", `${MOUNT_HOST}:/opt/iris-mcp/stage:ro`, IRIS_COMMUNITY_IMAGE,
    ]);
    const recorded = JSON.parse(harness.files.get(STATE_FILE) as string) as Record<string, string>;
    expect(Object.keys(recorded)).toEqual(["name", "id", "image", "namespace", "network", "mount"]);
    expect(recorded.mount).toBe(MOUNT_SPEC);
    expect(parseState(harness.files.get(STATE_FILE) as string).mount).toBe(MOUNT_SPEC);
  });

  it("keeps the published-port state exactly as it was when a mount is given with a host port", async () => {
    const harness = recordingHarness();

    const code = await upHarness(upOptions(harness, { network: undefined, hostPort: "49153", mount: MOUNT_SPEC }), harness.deps, harness.teardown);

    expect(code).toBe(0);
    expect(harness.events).toEqual(["docker run", "docker port", "docker exec", "docker exec", "write state"]);
    expect(Object.keys(JSON.parse(harness.files.get(STATE_FILE) as string))).toEqual(["name", "id", "port", "image", "namespace", "mount"]);
  });

  it.each([
    ["a host port as well", { hostPort: "49153" }, undefined],
    ["a network other than none", { network: "host" }, undefined],
    ["a mount host directory that is a symbolic link", { mount: MOUNT_SPEC }, "is a symbolic link"],
    ["a mount host directory that is missing", { mount: MOUNT_SPEC }, "does not exist"],
    ["a mount with .. in the host directory", { mount: "/virtual/../x:/opt/iris-mcp/stage" }, undefined],
    ["a mount with a colon in the host directory", { mount: "/virtual/a:b:/opt/iris-mcp/stage" }, undefined],
    ["a state file that already exists", { existing: true }, undefined],
  ] as Array<[string, Record<string, unknown>, string | undefined]>)("refuses %s with exit 2, before docker is looked for", async (_label, extra, problem) => {
    const harness = recordingHarness();
    if ("existing" in extra) harness.files.set(STATE_FILE, "{}");
    if (problem !== undefined) harness.mountProblems.set(MOUNT_HOST, `${MOUNT_HOST} ${problem}.`);
    let looked = false;
    harness.deps.findDocker = () => {
      looked = true;
      return "/fake/docker";
    };

    expect(await upHarness(upOptions(harness, extra), harness.deps, harness.teardown)).toBe(2);
    expect(looked).toBe(false);
    expect(harness.dockerCalls).toEqual([]);
    if (problem !== undefined) expect(harness.logs.join("\n")).toContain(problem);
  });

  it("never skips the host-directory check: a mount with no checker in the dependencies is refused with exit 2 and no docker call, and a start with no mount needs none", async () => {
    const refused = recordingHarness();
    delete (refused.deps as { checkMountDirectory?: unknown }).checkMountDirectory;
    expect(await upHarness(upOptions(refused, { mount: MOUNT_SPEC }), refused.deps, refused.teardown)).toBe(2);
    expect(refused.dockerCalls).toEqual([]);
    expect(refused.logs.join("\n")).toContain("deps.checkMountDirectory");

    const plain = recordingHarness();
    delete (plain.deps as { checkMountDirectory?: unknown }).checkMountDirectory;
    expect(await upHarness(upOptions(plain), plain.deps, plain.teardown)).toBe(0);
  });

  it("removes the container and writes no state when the session never answers, printing the log tail first", async () => {
    const harness = recordingHarness({ dockerReply: (args, input) => (args[0] === "exec" ? { status: 1, stderr: "not ready" } : defaultStartReply(args, input)) });

    const code = await upHarness(upOptions(harness, { limits: { sessionReadyMs: 10_000, sessionStepMs: 5_000 } }), harness.deps, harness.teardown);

    expect(code).toBe(4);
    expect(harness.events.slice(-2)).toEqual(["docker logs", "docker rm"]);
    expect(harness.files.size).toBe(0);
  });

  it("removes the container and writes no state when docker run fails", async () => {
    const harness = recordingHarness({ dockerReply: (args, input) => (args[0] === "run" ? { status: 125, stderr: "no such image" } : defaultStartReply(args, input)) });

    expect(await upHarness(upOptions(harness), harness.deps, harness.teardown)).toBe(4);
    expect(harness.events).toEqual(["docker run", "docker rm"]);
    expect(harness.files.size).toBe(0);
  });
});

describe("throwaway-iris: the inspection of a --network none container", () => {
  const expected = { name: GENERATED_NAME, network: "none" };

  it("accepts a labelled container whose network mode is none and which publishes nothing", () => {
    expect(inspectProblems(inspectedIsolated(), expected)).toEqual([]);
    expect(inspectProblems(inspectedIsolated({ NetworkSettings: { Ports: {} } }), expected)).toEqual([]);
    expect(() => assertThrowawayInspect(inspectedIsolated(), expected)).not.toThrow();
  });

  it.each([
    ["the default bridge network", { HostConfig: { NetworkMode: "default", PortBindings: {} } }, /network mode is "default", not "none"/],
    ["the host network", { HostConfig: { NetworkMode: "host", PortBindings: {} } }, /network mode is "host"/],
    ["no host config at all", { HostConfig: undefined }, /network mode is undefined/],
    ["a published port in the network settings", { NetworkSettings: { Ports: { "52773/tcp": [{ HostIp: "127.0.0.1", HostPort: "49153" }] } } }, /publishes 52773\/tcp, but a --network none container publishes no port/],
    ["a published port in the host config", { HostConfig: { NetworkMode: "none", PortBindings: { "52773/tcp": [{ HostIp: "", HostPort: "49153" }] } } }, /publishes 52773\/tcp/],
    ["no owner label", { Config: { Labels: {} } }, /does not carry the label/],
    ["another container name", { Name: "/iris-community-edition" }, /is named/],
    ["a stopped container", { State: { Running: false } }, /not running/],
  ])("refuses %s", (_label, overrides, problem) => {
    expect(inspectProblems(inspectedIsolated(overrides), expected).join(" ")).toMatch(problem);
    expect(() => assertThrowawayInspect(inspectedIsolated(overrides), expected)).toThrow(/is not a throwaway container this harness started/);
  });

  it("checks the network mode of a stopped container too, when a stopped one is allowed", () => {
    expect(inspectProblems(inspectedIsolated({ State: { Running: false } }), { ...expected, allowStopped: true })).toEqual([]);
    expect(
      inspectProblems(inspectedIsolated({ State: { Running: false }, HostConfig: { NetworkMode: "bridge", PortBindings: {} } }), { ...expected, allowStopped: true }).join(" "),
    ).toMatch(/network mode is "bridge"/);
  });

  it("refuses a container that publishes a port when the state says --network none, and the reverse", () => {
    expect(inspectProblems(inspectedThrowaway(), expected).join(" ")).toMatch(/network mode is undefined/);
    expect(inspectProblems(inspectedIsolated(), { name: GENERATED_NAME, port: "49153" }).join(" ")).toMatch(/does not publish/);
  });

  it("takes exactly one of a port and a network", () => {
    expect(inspectProblems(inspectedIsolated(), { name: GENERATED_NAME, network: "none", port: "49153" }).join(" ")).toMatch(/never both/);
    expect(inspectProblems(inspectedIsolated(), { name: GENERATED_NAME, network: "host" }).join(" ")).toMatch(/is not "none"/);
    expect(inspectProblems(inspectedIsolated(), { name: GENERATED_NAME }).join(" ")).toMatch(/refusing the host port/);
  });
});

describe("throwaway-iris: the state of a --network none container", () => {
  it("reads the state `up` writes: exactly one of port and network, an optional mount, every field validated", () => {
    expect(parseState(JSON.stringify(NONE_STATE))).toEqual(NONE_STATE);
    expect(parseState(JSON.stringify({ ...NONE_STATE, mount: MOUNT_SPEC }))).toEqual({ ...NONE_STATE, mount: MOUNT_SPEC });
    expect(parseState(JSON.stringify({ ...KEPT_STATE, mount: MOUNT_SPEC }))).toEqual({ ...KEPT_STATE, mount: MOUNT_SPEC });
    expect(parseState(JSON.stringify(KEPT_STATE)), "a published-port state is as it was").toEqual(KEPT_STATE);
    for (const [label, state] of [
      ["both a port and a network", { ...NONE_STATE, port: "49153" }],
      ["neither a port nor a network", { name: GENERATED_NAME, id: CONTAINER_ID, image: IRIS_COMMUNITY_IMAGE, namespace: "USER" }],
      ["a network other than none", { ...NONE_STATE, network: "host" }],
      ["a bad mount", { ...NONE_STATE, mount: "/virtual/../x:/opt/iris-mcp/stage" }],
      ["the shared instance's container", { ...NONE_STATE, name: SHARED_INSTANCE_CONTAINER }],
      ["a floating image", { ...NONE_STATE, image: "intersystems/iris-community:2026.2" }],
    ] as Array<[string, Record<string, unknown>]>) {
      expect(() => parseState(JSON.stringify(state)), label).toThrow();
    }
  });

  it("exports the network constant the state records", () => {
    expect(NETWORK_NONE).toBe("none");
  });
});

describe("throwaway-iris: exec, logs and down on a --network none state", () => {
  it("exec refuses a state with no port with exit 2, before docker is called, and runs nothing", async () => {
    const harness = isolatedHarness();

    const code = await execHarness({ ...stateOptions(), command: ["node", "x.mjs"] }, harness.deps);

    expect(code).toBe(2);
    expect(harness.dockerCalls).toEqual([]);
    expect(harness.commands).toEqual([]);
    expect(harness.logs.join("\n")).toMatch(/publishes no port/);
  });

  it("logs reads the log of an isolated container after one inspection", async () => {
    const harness = isolatedHarness();

    expect(await logsHarness(stateOptions(), harness.deps)).toBe(0);
    expect(harness.dockerCalls).toEqual([["inspect", CONTAINER_ID], ["logs", "--tail", "400", CONTAINER_ID]]);
  });

  it("down removes an isolated container and the state file", async () => {
    const harness = isolatedHarness();

    expect(await downHarness(stateOptions(), harness.deps)).toBe(0);
    expect(harness.dockerCalls).toEqual([["inspect", CONTAINER_ID], ["rm", "-f", "-v", CONTAINER_ID]]);
    expect(harness.files.size).toBe(0);
  });

  it.each([
    ["a container with a published port", { NetworkSettings: { Ports: { "52773/tcp": [{ HostIp: "127.0.0.1", HostPort: "49153" }] } } }, /publishes 52773\/tcp/],
    ["a container on another network", { HostConfig: { NetworkMode: "bridge", PortBindings: {} } }, /network mode is "bridge"/],
    ["an unlabelled container", { Config: { Labels: {} } }, /does not carry the label/],
  ])("down refuses %s with exit 2: nothing is removed and the state file stays", async (_label, overrides, problem) => {
    const harness = isolatedHarness({ dockerReply: isolatedReply(overrides) });

    expect(await downHarness(stateOptions(), harness.deps)).toBe(2);
    expect(harness.dockerCalls.map((call) => call[0])).toEqual(["inspect"]);
    expect(harness.files.has(STATE_FILE)).toBe(true);
    expect(harness.logs.join("\n")).toMatch(problem);
  });
});

describe("throwaway-iris: session pipes a script into the recorded container", () => {
  const SCRIPT_FILE = "/virtual/ipm-script.mos";
  const SCRIPT_TEXT = 'Write "IRISMCP-"_"X-START:"_1_":IRISMCP-"_"X-END",!\nHalt\n';
  const sessionOptions = (extra: Record<string, unknown> = {}) => ({ ...stateOptions(), namespace: "USER", script: SCRIPT_FILE, ...extra });
  /** Answers the session with `stdout` and `status`; every other docker call is the isolated container's. */
  const sessionReply = (stdout: string, status = 0, stderr = "") => (args: string[], input: string | undefined) =>
    args[0] === "exec" ? { status, stdout, stderr } : isolatedReply()(args, input);

  it("re-inspects, runs `docker exec -i <id> iris session iris -U <NS>` with the script on stdin, prints the output and returns docker's status", async () => {
    const harness = isolatedHarness({ dockerReply: sessionReply("IRISMCP-X-START:1:IRISMCP-X-END\n", 0) });
    harness.scripts.set(SCRIPT_FILE, SCRIPT_TEXT);

    const code = await sessionHarness(sessionOptions(), harness.deps);

    expect(code).toBe(0);
    expect(harness.dockerCalls).toEqual([["inspect", CONTAINER_ID], ["exec", "-i", CONTAINER_ID, "iris", "session", "iris", "-U", "USER"]]);
    expect(harness.dockerInputs[1], "the script is the session's stdin, byte for byte").toBe(SCRIPT_TEXT);
    expect(harness.dockerTimeouts[1], "a session may run longer than a readiness call").toBeGreaterThan(60_000);
    expect(harness.output.join("")).toBe("IRISMCP-X-START:1:IRISMCP-X-END\n");
  });

  it("runs in %SYS when asked, and on a published-port state as well", async () => {
    const harness = keptHarness({ dockerReply: (args, input) => (args[0] === "exec" ? { status: 0, stdout: "ok\n" } : defaultStartReply(args, input)) });
    harness.scripts.set(SCRIPT_FILE, SCRIPT_TEXT);

    expect(await sessionHarness(sessionOptions({ namespace: "%SYS" }), harness.deps)).toBe(0);
    expect(harness.dockerCalls[1]).toEqual(["exec", "-i", CONTAINER_ID, "iris", "session", "iris", "-U", "%SYS"]);
  });

  it("exits with docker's status when the session fails, and still prints what it printed", async () => {
    const harness = isolatedHarness({ dockerReply: sessionReply("partial output\n", 3, "boom") });
    harness.scripts.set(SCRIPT_FILE, SCRIPT_TEXT);

    expect(await sessionHarness(sessionOptions(), harness.deps)).toBe(3);
    expect(harness.output.join("")).toBe("partial output\n");
    expect(harness.logs.join("\n")).toContain("boom");
  });

  it("exits 4 when docker did not finish the session (no exit status)", async () => {
    const harness = isolatedHarness({ dockerReply: sessionReply("", null as unknown as number) });
    harness.scripts.set(SCRIPT_FILE, SCRIPT_TEXT);

    expect(await sessionHarness(sessionOptions(), harness.deps)).toBe(4);
  });

  it.each([
    ["a lower-case namespace", { namespace: "user" }],
    ["a namespace with a semicolon", { namespace: "USER;x" }],
    ["no script path", { script: "" }],
    ["a script file that does not exist", { script: "/virtual/missing.mos" }],
  ])("refuses %s with exit 2, before docker is called", async (_label, extra) => {
    const harness = isolatedHarness();
    harness.scripts.set(SCRIPT_FILE, SCRIPT_TEXT);

    expect(await sessionHarness(sessionOptions(extra), harness.deps)).toBe(2);
    expect(harness.dockerCalls).toEqual([]);
  });

  it("refuses a missing state file with exit 2, and calls no docker", async () => {
    const harness = recordingHarness();
    harness.scripts.set(SCRIPT_FILE, SCRIPT_TEXT);

    expect(await sessionHarness(sessionOptions(), harness.deps)).toBe(2);
    expect(harness.dockerCalls).toEqual([]);
    expect(harness.logs.join("\n")).toMatch(/does not exist/);
  });

  it.each([
    ["an unlabelled container", { Config: { Labels: {} } }, /does not carry the label/],
    ["a container with a published port", { NetworkSettings: { Ports: { "52773/tcp": [{ HostIp: "127.0.0.1", HostPort: "49153" }] } } }, /publishes 52773\/tcp/],
    ["a container that is not running", { State: { Running: false } }, /not running/],
  ])("refuses %s with exit 2: it inspects, and never opens the session", async (_label, overrides, problem) => {
    const harness = isolatedHarness({ dockerReply: isolatedReply(overrides) });
    harness.scripts.set(SCRIPT_FILE, SCRIPT_TEXT);

    expect(await sessionHarness(sessionOptions(), harness.deps)).toBe(2);
    expect(harness.dockerCalls.map((call) => call[0])).toEqual(["inspect"]);
    expect(harness.output).toEqual([]);
    expect(harness.logs.join("\n")).toMatch(problem);
  });

  it("exits 3 when docker is not on PATH", async () => {
    const harness = isolatedHarness();
    harness.scripts.set(SCRIPT_FILE, SCRIPT_TEXT);
    harness.deps.findDocker = () => undefined;

    expect(await sessionHarness(sessionOptions(), harness.deps)).toBe(3);
    expect(harness.dockerCalls).toEqual([]);
  });
});

describe("throwaway-iris: cp copies one file out of the recorded container", () => {
  const FROM = "/tmp/iris-mcp-ipm-out/iris-execute-mcp-v2.tgz";
  const copyOptions = (extra: Record<string, unknown> = {}) => ({ ...stateOptions(), from: FROM, to: "/host/out/archive.tgz", ...extra });

  it("re-inspects, then runs `docker cp <id>:<from> <to>` and exits 0", async () => {
    const harness = isolatedHarness();

    const code = await copyHarness(copyOptions(), harness.deps);

    expect(code).toBe(0);
    expect(harness.dockerCalls).toEqual([["inspect", CONTAINER_ID], ["cp", `${CONTAINER_ID}:${FROM}`, "/host/out/archive.tgz"]]);
    expect(harness.logs.join("\n")).toContain("copied");
  });

  it("exits 4 and says why when docker cp fails", async () => {
    const harness = isolatedHarness({ dockerReply: (args, input) => (args[0] === "cp" ? { status: 1, stderr: "Could not find the file" } : isolatedReply()(args, input)) });

    expect(await copyHarness(copyOptions(), harness.deps)).toBe(4);
    expect(harness.logs.join("\n")).toContain("Could not find the file");
  });

  it.each([
    ["a source outside /tmp/iris-mcp-", { from: "/etc/passwd" }],
    ["a source with ..", { from: "/tmp/iris-mcp-x/../../etc/passwd" }],
    ["a destination that docker would read as a container path", { to: "iris-community-edition:/etc" }],
  ])("refuses %s with exit 2, before docker is called", async (_label, extra) => {
    const harness = isolatedHarness();

    expect(await copyHarness(copyOptions(extra), harness.deps)).toBe(2);
    expect(harness.dockerCalls).toEqual([]);
  });

  it("refuses a missing state file and an unlabelled container with exit 2, and copies nothing", async () => {
    const missing = recordingHarness();
    expect(await copyHarness(copyOptions(), missing.deps)).toBe(2);
    expect(missing.dockerCalls).toEqual([]);

    const unlabelled = isolatedHarness({ dockerReply: isolatedReply({ Config: { Labels: {} } }) });
    expect(await copyHarness(copyOptions(), unlabelled.deps)).toBe(2);
    expect(unlabelled.dockerCalls.map((call) => call[0])).toEqual(["inspect"]);
  });

  it("exits 3 when docker is not on PATH", async () => {
    const harness = isolatedHarness();
    harness.deps.findDocker = () => undefined;

    expect(await copyHarness(copyOptions(), harness.deps)).toBe(3);
    expect(harness.dockerCalls).toEqual([]);
  });
});

describe("throwaway-iris: the real mount-directory check", () => {
  it.skipIf(process.platform === "win32")("accepts a real directory, and refuses a symbolic link to one, a file and a missing path", () => {
    const base = scratchDir();
    const real = path.join(base, "real");
    const link = path.join(base, "link");
    const file = path.join(base, "file");
    mkdirSync(real);
    symlinkSync(real, link);
    writeFileSync(file, "x", "utf8");
    const deps = defaultDeps({});

    expect(deps.checkMountDirectory(real)).toBeUndefined();
    expect(deps.checkMountDirectory(link)).toMatch(/symbolic link/);
    expect(deps.checkMountDirectory(file)).toMatch(/not a directory/);
    expect(deps.checkMountDirectory(path.join(base, "missing"))).toMatch(/does not exist/);
  });

  it("reads a script file as text", () => {
    const base = scratchDir();
    const file = path.join(base, "s.mos");
    writeFileSync(file, "Halt\n", "utf8");

    expect(defaultDeps({}).readScript(file)).toBe("Halt\n");
    expect(() => defaultDeps({}).readScript(path.join(base, "none.mos"))).toThrow(/ENOENT/);
  });
});
