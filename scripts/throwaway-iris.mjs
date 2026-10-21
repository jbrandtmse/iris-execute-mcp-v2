#!/usr/bin/env node
// Throwaway IRIS container harness: runs one command against a fresh, disposable IRIS instance.
//
// USE
//   node scripts/throwaway-iris.mjs run [--image <ref>] -- <command> [args...]
//
// CONTRACT
//   1. Validation comes first, before anything is spawned: the image must be digest-pinned
//      (`<repo>[:<tag>]@sha256:<64 hex>`), the container name is one this script generates
//      (`iris-mcp-throwaway-<12 hex>`), and the host port is never 52773 or 1972.
//   2. `docker run -d --name <name> --label iris-mcp.owner=throwaway -p 127.0.0.1::52773 <image>` starts the
//      container with a dynamic loopback host port, read back with `docker port`. The shared instance
//      (container `iris-community-edition`, localhost:52773) is never named, probed or touched.
//   3. Teardown, `docker rm -f -v <id>`, runs on normal exit, error, INT and TERM. It removes only the container id
//      this script created (the generated name until the id is known), never anything else.
//   4. Readiness: a bounded `docker exec -i <id> iris session iris -U %SYS` loop, then
//      `Security.Users.UnExpireUserPasswords("_SYSTEM")`, then a bounded poll of `GET /api/atelier/` until HTTP 200.
//   5. The command then runs with IRIS_REQUIRE_LIVE=1, IRIS_HOST=127.0.0.1, IRIS_PORT=<dynamic port>,
//      IRIS_USERNAME=_SYSTEM, IRIS_PASSWORD=SYS, IRIS_NAMESPACE=USER and IRIS_THROWAWAY=<container name>; every other
//      ambient IRIS_* variable is dropped. The script exits with the command's exit code.
//   6. A missing docker exits non-zero with a message. The script never skips.
//
// EXIT CODES
//   2 usage or a refused image, name or port; 3 docker not found on PATH; 4 the container did not start or become
//   ready; otherwise the command's own exit code (128 + n when a signal ended it).
//
// IMPORT
//   Importing this module spawns nothing. Every process-spawning step sits behind `defaultDeps()`, which only
//   `main()` calls, and `main()` runs only when this file is the entry point. `runHarness(options, deps, teardown)`
//   takes every side effect as a dependency.
//
// PURE HELPERS EXPORTED FOR STORY 42.3 AND THE GATES
//   validateImage, validateHostPort, validateContainerName, generateContainerName, buildRunArgv, buildPortArgv,
//   parseDockerPort, buildSessionArgv, buildTeardownArgv, buildChildEnv, parseCli, findExecutable, inspectProblems,
//   assertThrowawayInspect, createTeardown, runHarness. The constants name the images and the safety limits.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The default image: IRIS Community 2026.2, pinned by digest. */
export const IRIS_COMMUNITY_IMAGE =
  'intersystems/iris-community:2026.2@sha256:cd2ebcab02d1ef80ec155def4418399f353d867162688c36a3705760e750bdaa';

/** The alternative a gate selects when plain IRIS cannot compile the ExecuteMCPv2 classes: IRIS for Health Community, pinned by digest. */
export const IRISHEALTH_COMMUNITY_IMAGE =
  'intersystems/irishealth-community:2026.2@sha256:462de1fb3597272fde0e03afad006af1b18b59c90f1c1fb5566c79b027a7af0a';

/** The label every throwaway container carries. */
export const OWNER_LABEL_KEY = 'iris-mcp.owner';
export const OWNER_LABEL_VALUE = 'throwaway';
export const OWNER_LABEL = `${OWNER_LABEL_KEY}=${OWNER_LABEL_VALUE}`;

/** Every container name this script generates starts with this prefix. */
export const NAME_PREFIX = 'iris-mcp-throwaway-';

/** The shared development instance: its container name and the host ports it publishes. */
export const SHARED_INSTANCE_CONTAINER = 'iris-community-edition';
export const REFUSED_HOST_PORTS = Object.freeze(['52773', '1972']);

/** The web port inside the container, and the only address a host port is published on. */
export const CONTAINER_WEB_PORT = '52773';
export const LOOPBACK_HOST = '127.0.0.1';

/** The account, password and namespace the command receives. */
export const THROWAWAY_USERNAME = '_SYSTEM';
export const THROWAWAY_PASSWORD = 'SYS';
export const THROWAWAY_NAMESPACE = 'USER';

const IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/:-]*@sha256:[0-9a-f]{64}$/;
const NAME_PATTERN = /^iris-mcp-throwaway-[0-9a-f]{12}$/;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;

/** A refusal raised by validation: the request names something this harness never uses. */
export class ThrowawayRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'ThrowawayRefusal';
  }
}

/**
 * The image reference, when it is pinned by digest (`@sha256:` plus 64 lowercase hex digits).
 * A floating reference (`:latest`, `:2026.2`, no tag) is refused: it names whatever the registry serves today.
 *
 * @param {unknown} image
 * @returns {string}
 */
export function validateImage(image) {
  if (typeof image !== 'string' || !IMAGE_PATTERN.test(image)) {
    throw new ThrowawayRefusal(
      `refusing the image ${JSON.stringify(image)}: an image must be pinned by digest ` +
        '(<repository>[:<tag>]@sha256:<64 lowercase hex digits>); a floating tag names whatever the registry serves today.',
    );
  }
  return image;
}

/**
 * The host port, as a decimal string, when it may be used: an integer in 1..65535 that is not 52773 or 1972
 * (the shared instance's web and superserver ports).
 *
 * @param {unknown} port
 * @returns {string}
 */
export function validateHostPort(port) {
  const text = typeof port === 'number' ? String(port) : typeof port === 'string' ? port.trim() : '';
  if (!/^[0-9]{1,5}$/.test(text) || Number(text) < 1 || Number(text) > 65535) {
    throw new ThrowawayRefusal(`refusing the host port ${JSON.stringify(port)}: it is not an integer from 1 to 65535.`);
  }
  const normalized = String(Number(text));
  if (REFUSED_HOST_PORTS.includes(normalized)) {
    throw new ThrowawayRefusal(
      `refusing host port ${normalized}: ports ${REFUSED_HOST_PORTS.join(' and ')} belong to the shared IRIS instance.`,
    );
  }
  return normalized;
}

/**
 * The container name, when this script could have generated it (`iris-mcp-throwaway-<12 hex>`).
 * The shared instance's name, and every name this script did not create, are refused.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function validateContainerName(name) {
  if (name === SHARED_INSTANCE_CONTAINER) {
    throw new ThrowawayRefusal(
      `refusing the container name ${SHARED_INSTANCE_CONTAINER}: it is the shared IRIS instance, which this harness never touches.`,
    );
  }
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new ThrowawayRefusal(
      `refusing the container name ${JSON.stringify(name)}: this harness only handles names it generates ` +
        `(${NAME_PREFIX}<12 hex digits>), because it removes what it names.`,
    );
  }
  return name;
}

/**
 * A fresh container name `iris-mcp-throwaway-<12 hex>`.
 *
 * @param {(size: number) => Buffer} [random]
 * @returns {string}
 */
export function generateContainerName(random = randomBytes) {
  return validateContainerName(`${NAME_PREFIX}${random(6).toString('hex')}`);
}

/**
 * The `docker run` arguments (without the `docker` command): detached, named, labelled, with the container's web port
 * published on a dynamic port of the loopback address only.
 *
 * @param {{ image: string, name: string }} options
 * @returns {string[]}
 */
export function buildRunArgv({ image, name }) {
  return [
    'run',
    '-d',
    '--name',
    validateContainerName(name),
    '--label',
    OWNER_LABEL,
    '-p',
    `${LOOPBACK_HOST}::${CONTAINER_WEB_PORT}`,
    validateImage(image),
  ];
}

/**
 * The `docker port` arguments that report where the container's web port is published.
 *
 * @param {string} containerId
 * @returns {string[]}
 */
export function buildPortArgv(containerId) {
  return ['port', validateContainerId(containerId), `${CONTAINER_WEB_PORT}/tcp`];
}

/**
 * The `docker exec` arguments that open an IRIS terminal session in %SYS, reading its commands from stdin.
 *
 * @param {string} containerId
 * @returns {string[]}
 */
export function buildSessionArgv(containerId) {
  return ['exec', '-i', validateContainerId(containerId), 'iris', 'session', 'iris', '-U', '%SYS'];
}

/**
 * The `docker rm` arguments that remove one container this script created: the id, or the generated name before the
 * id is known. Anything else is refused.
 *
 * @param {string} containerRef
 * @returns {string[]}
 */
export function buildTeardownArgv(containerRef) {
  if (CONTAINER_ID_PATTERN.test(String(containerRef))) return ['rm', '-f', '-v', containerRef];
  return ['rm', '-f', '-v', validateContainerName(containerRef)];
}

/**
 * A full container id as `docker run -d` prints it.
 *
 * @param {unknown} containerId
 * @returns {string}
 */
function validateContainerId(containerId) {
  if (typeof containerId !== 'string' || !CONTAINER_ID_PATTERN.test(containerId)) {
    throw new ThrowawayRefusal(`refusing the container id ${JSON.stringify(containerId)}: it is not a 64-digit hex id.`);
  }
  return containerId;
}

/**
 * The host port from the output of `docker port <id> 52773/tcp`: the first line published on the loopback address,
 * as `127.0.0.1:<port>`. A line on another address is ignored; the port is validated.
 *
 * @param {string} output
 * @returns {string}
 */
export function parseDockerPort(output) {
  for (const line of String(output).split(/\r?\n/)) {
    const match = /^\s*127\.0\.0\.1:(\d+)\s*$/.exec(line);
    if (match) return validateHostPort(match[1]);
  }
  throw new ThrowawayRefusal(
    `docker port reported no ${LOOPBACK_HOST} binding for ${CONTAINER_WEB_PORT}/tcp: ${JSON.stringify(String(output).trim())}`,
  );
}

/**
 * The environment of the command: `baseEnv` without any IRIS_* variable (matched case-insensitively), plus the throwaway
 * target and the arming variable.
 *
 * @param {Record<string, string | undefined>} baseEnv
 * @param {{ port: string | number, name: string }} throwaway
 * @returns {Record<string, string>}
 */
export function buildChildEnv(baseEnv, { port, name }) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value !== 'string' || key.toUpperCase().startsWith('IRIS_')) continue;
    env[key] = value;
  }
  return {
    ...env,
    IRIS_REQUIRE_LIVE: '1',
    IRIS_HOST: LOOPBACK_HOST,
    IRIS_PORT: validateHostPort(port),
    IRIS_USERNAME: THROWAWAY_USERNAME,
    IRIS_PASSWORD: THROWAWAY_PASSWORD,
    IRIS_NAMESPACE: THROWAWAY_NAMESPACE,
    IRIS_THROWAWAY: validateContainerName(name),
  };
}

/**
 * Parse `run [--image <ref>] -- <command> [args...]`. The image defaults to {@link IRIS_COMMUNITY_IMAGE} and is validated.
 *
 * @param {readonly string[]} argv
 * @returns {{ image: string, command: string[] }}
 */
export function parseCli(argv) {
  const usage = 'usage: node scripts/throwaway-iris.mjs run [--image <digest-pinned ref>] -- <command> [args...]';
  if (argv[0] !== 'run') throw new ThrowawayRefusal(usage);
  let image = IRIS_COMMUNITY_IMAGE;
  let index = 1;
  while (index < argv.length && argv[index] !== '--') {
    if (argv[index] === '--image' && index + 1 < argv.length) {
      image = argv[index + 1];
      index += 2;
    } else {
      throw new ThrowawayRefusal(`unknown argument ${JSON.stringify(argv[index])}; ${usage}`);
    }
  }
  const command = argv.slice(index + 1);
  if (argv[index] !== '--' || command.length === 0) throw new ThrowawayRefusal(`no command after "--"; ${usage}`);
  return { image: validateImage(image), command };
}

/**
 * The first executable file named `command` in the directories of `pathValue`, or `undefined`. It only looks; it never
 * runs anything, and an unset or empty PATH finds nothing (the current directory is never searched).
 *
 * @param {string} command
 * @param {string | undefined} pathValue
 * @param {NodeJS.Platform} [platform]
 * @returns {string | undefined}
 */
export function findExecutable(command, pathValue, platform = process.platform) {
  if (typeof pathValue !== 'string') return undefined;
  const extensions = platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  for (const directory of pathValue.split(path.delimiter)) {
    if (directory === '') continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not here
      }
    }
  }
  return undefined;
}

/**
 * What is wrong with the parsed output of `docker inspect <name>` for a container that must be a throwaway publishing
 * `port`: it is exactly one running container with that name, carrying the owner label, with its web port published
 * on the loopback address at `port`. An empty list means the container is the throwaway.
 *
 * @param {unknown} inspected - The parsed JSON of `docker inspect`.
 * @param {{ name: string, port: string | number }} expected
 * @returns {string[]}
 */
export function inspectProblems(inspected, { name, port }) {
  const problems = [];
  try {
    validateContainerName(name);
  } catch (error) {
    problems.push(error.message);
  }
  try {
    validateHostPort(port);
  } catch (error) {
    problems.push(error.message);
  }
  if (!Array.isArray(inspected) || inspected.length !== 1) {
    problems.push(`docker inspect must describe exactly one container, but returned ${Array.isArray(inspected) ? inspected.length : typeof inspected}.`);
    return problems;
  }
  const container = inspected[0] ?? {};
  if (container.Name !== `/${name}`) {
    problems.push(`the container is named ${JSON.stringify(container.Name)}, not "/${name}".`);
  }
  if (container.Config?.Labels?.[OWNER_LABEL_KEY] !== OWNER_LABEL_VALUE) {
    problems.push(`the container does not carry the label ${OWNER_LABEL}, so it was not started by scripts/throwaway-iris.mjs.`);
  }
  if (container.State?.Running !== true) {
    problems.push('the container is not running.');
  }
  const bindings = container.NetworkSettings?.Ports?.[`${CONTAINER_WEB_PORT}/tcp`];
  const published =
    Array.isArray(bindings) &&
    bindings.some((binding) => binding?.HostIp === LOOPBACK_HOST && String(binding?.HostPort) === String(port));
  if (!published) {
    problems.push(`the container does not publish ${CONTAINER_WEB_PORT}/tcp on ${LOOPBACK_HOST}:${port}.`);
  }
  return problems;
}

/**
 * Throw when {@link inspectProblems} finds any problem.
 *
 * @param {unknown} inspected
 * @param {{ name: string, port: string | number }} expected
 */
export function assertThrowawayInspect(inspected, expected) {
  const problems = inspectProblems(inspected, expected);
  if (problems.length > 0) {
    throw new ThrowawayRefusal(`${expected.name} is not a throwaway container this harness started: ${problems.join(' ')}`);
  }
}

/**
 * A teardown that removes exactly one container, once. `arm(ref)` records the container this script created (first its
 * generated name, then its id); `run()` removes it synchronously, so it is safe in an `exit` handler, and is idempotent.
 *
 * @param {(args: string[]) => unknown} docker - Runs `docker <args>` synchronously.
 */
export function createTeardown(docker) {
  let ref;
  let done = false;
  return {
    arm(containerRef) {
      buildTeardownArgv(containerRef);
      ref = containerRef;
    },
    run() {
      if (done || ref === undefined) return;
      done = true;
      try {
        docker(buildTeardownArgv(ref));
      } catch {
        // removal is best effort; a failure is reported by the docker call's own output
      }
    },
    /** The container the teardown would remove, or `undefined`. */
    get armed() {
      return done ? undefined : ref;
    },
  };
}

/** The terminal commands of the readiness session. The marker literals are split so the session's echo of its input never matches them. */
const READY_SCRIPT = 'Write "IRISMCP-"_"READY",!\nHalt\n';
const UNEXPIRE_SCRIPT =
  'Set tSC = ##class(Security.Users).UnExpireUserPasswords("_SYSTEM",.tCount)\n' +
  'Write "IRISMCP-"_"UNEXPIRE:"_$Select($System.Status.IsOK(tSC):"OK",1:"FAILED:"_$System.Status.GetErrorText(tSC))_":END",!\n' +
  'Halt\n';

/** Bounds of the readiness steps, in milliseconds. */
const DEFAULT_LIMITS = Object.freeze({
  runMs: 600_000,
  sessionReadyMs: 300_000,
  sessionStepMs: 5_000,
  sessionCallMs: 60_000,
  webReadyMs: 120_000,
  webStepMs: 2_000,
  dockerCallMs: 120_000,
});

/**
 * Run `options.command` against a fresh throwaway container and return its exit code (or one of the codes in the
 * header). Every side effect goes through `deps`; `teardown` removes the container on every path out.
 *
 * @param {{ image: string, command: string[], env: Record<string, string | undefined>, limits?: Partial<typeof DEFAULT_LIMITS> }} options
 * @param {{
 *   findDocker: (env: Record<string, string | undefined>) => string | undefined,
 *   docker: (args: string[], options?: { input?: string, timeoutMs?: number }) => { status: number | null, stdout: string, stderr: string, error?: Error },
 *   webStatus: (port: string) => Promise<number>,
 *   runCommand: (command: string[], env: Record<string, string>) => Promise<number>,
 *   sleep: (ms: number) => Promise<void>,
 *   now: () => number,
 *   log: (line: string) => void,
 * }} deps
 * @param {ReturnType<typeof createTeardown>} teardown
 * @returns {Promise<number>}
 */
export async function runHarness(options, deps, teardown) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  let image;
  let name;
  try {
    image = validateImage(options.image);
    name = generateContainerName();
  } catch (error) {
    deps.log(`throwaway-iris: ${error.message}`);
    return 2;
  }
  if (deps.findDocker(options.env) === undefined) {
    deps.log('throwaway-iris: docker was not found on PATH. This harness needs docker to start the throwaway IRIS container and never skips.');
    return 3;
  }
  const docker = (args, callOptions) => deps.docker(args, { timeoutMs: limits.dockerCallMs, ...callOptions });
  const failed = (message) => {
    deps.log(`throwaway-iris: ${message}`);
    return 4;
  };

  try {
    teardown.arm(name);
    const started = docker(buildRunArgv({ image, name }), { timeoutMs: limits.runMs });
    if (started.status !== 0) {
      return failed(`docker run failed (${started.error?.message ?? `exit ${started.status}`}): ${started.stderr.trim()}`);
    }
    const containerId = started.stdout.trim().split(/\r?\n/).pop() ?? '';
    if (!CONTAINER_ID_PATTERN.test(containerId)) {
      return failed(`docker run printed ${JSON.stringify(started.stdout.trim())}, not a container id.`);
    }
    teardown.arm(containerId);
    deps.log(`throwaway-iris: started ${name} from ${image}`);

    const reported = docker(buildPortArgv(containerId));
    if (reported.status !== 0) return failed(`docker port failed: ${reported.stderr.trim()}`);
    const port = parseDockerPort(reported.stdout);
    deps.log(`throwaway-iris: ${name} publishes the web port on ${LOOPBACK_HOST}:${port}`);

    const session = (script) =>
      docker(buildSessionArgv(containerId), { input: script, timeoutMs: limits.sessionCallMs });

    const sessionDeadline = deps.now() + limits.sessionReadyMs;
    for (;;) {
      const attempt = session(READY_SCRIPT);
      if (attempt.status === 0 && attempt.stdout.includes('IRISMCP-READY')) break;
      if (deps.now() >= sessionDeadline) {
        const logs = docker(['logs', '--tail', '40', containerId]);
        deps.log(`${logs.stdout}${logs.stderr}`.trim());
        return failed(`${name} never answered an iris session within ${limits.sessionReadyMs / 1000}s.`);
      }
      await deps.sleep(limits.sessionStepMs);
    }

    const unexpired = session(UNEXPIRE_SCRIPT);
    if (unexpired.status !== 0 || !/IRISMCP-UNEXPIRE:OK:END/.test(unexpired.stdout)) {
      return failed(`UnExpireUserPasswords("_SYSTEM") did not report OK: ${`${unexpired.stdout}${unexpired.stderr}`.trim().slice(-400)}`);
    }

    const webDeadline = deps.now() + limits.webReadyMs;
    while ((await deps.webStatus(port)) !== 200) {
      if (deps.now() >= webDeadline) {
        return failed(`GET /api/atelier/ on ${LOOPBACK_HOST}:${port} never answered HTTP 200 within ${limits.webReadyMs / 1000}s.`);
      }
      await deps.sleep(limits.webStepMs);
    }
    deps.log(`throwaway-iris: ${name} answers HTTP 200 on /api/atelier/; running ${options.command.join(' ')}`);

    return await deps.runCommand(options.command, buildChildEnv(options.env, { port, name }));
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  } finally {
    teardown.run();
  }
}

/**
 * The real side effects of {@link runHarness}. Calling this spawns nothing by itself; each function spawns only when it
 * is called.
 *
 * @param {Record<string, string | undefined>} env
 */
export function defaultDeps(env) {
  let child;
  const authorization = `Basic ${Buffer.from(`${THROWAWAY_USERNAME}:${THROWAWAY_PASSWORD}`).toString('base64')}`;
  return {
    findDocker: (searchEnv) => findExecutable('docker', searchEnv.PATH),
    docker: (args, callOptions = {}) => {
      const result = spawnSync('docker', args, {
        input: callOptions.input,
        encoding: 'utf8',
        timeout: callOptions.timeoutMs,
        env,
      });
      return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
    },
    webStatus: async (port) => {
      try {
        const response = await fetch(`http://${LOOPBACK_HOST}:${port}/api/atelier/`, {
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(5_000),
        });
        await response.body?.cancel();
        return response.status;
      } catch {
        return 0;
      }
    },
    runCommand: (command, commandEnv) =>
      new Promise((resolve) => {
        child = spawn(command[0], command.slice(1), { env: commandEnv, stdio: 'inherit' });
        child.once('error', (error) => {
          process.stderr.write(`throwaway-iris: could not run ${command[0]}: ${error.message}\n`);
          resolve(127);
        });
        child.once('close', (code, signal) => {
          resolve(code ?? 128 + (osConstants.signals[signal] ?? 1));
        });
      }),
    /** Forward a signal to the running command. */
    killCommand: (signal) => {
      child?.kill(signal);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (line) => process.stderr.write(`${line}\n`),
  };
}

/**
 * The entry point: parse the command line, install the teardown on exit, INT and TERM, and run the harness.
 *
 * @param {readonly string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<number>} The exit code.
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  let cli;
  try {
    cli = parseCli(argv);
  } catch (error) {
    process.stderr.write(`throwaway-iris: ${error.message}\n`);
    return 2;
  }
  const deps = defaultDeps(env);
  const teardown = createTeardown((args) => deps.docker(args, { timeoutMs: DEFAULT_LIMITS.dockerCallMs }));
  process.once('exit', () => teardown.run());
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(signal, () => {
      deps.killCommand(signal);
      teardown.run();
      process.exit(code);
    });
  }
  process.once('uncaughtException', (error) => {
    process.stderr.write(`throwaway-iris: ${error.stack ?? error}\n`);
    teardown.run();
    process.exit(1);
  });
  return runHarness({ image: cli.image, command: cli.command, env }, deps, teardown);
}

function isEntryPoint() {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().then((code) => process.exit(code));
}
