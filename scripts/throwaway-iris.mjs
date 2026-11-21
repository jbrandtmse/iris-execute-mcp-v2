#!/usr/bin/env node
// Throwaway IRIS container harness: runs commands against a fresh, disposable IRIS instance.
//
// USE
//   node scripts/throwaway-iris.mjs run [--image <ref>] [--host-port <port>] -- <command> [args...]
//   node scripts/throwaway-iris.mjs up --image <ref> --namespace <NS> --host-port <port> [--mount <dir>:/opt/iris-mcp/<name>] --state <file>
//   node scripts/throwaway-iris.mjs up --image <ref> --namespace <NS> --network none [--mount <dir>:/opt/iris-mcp/<name>] --state <file>
//   node scripts/throwaway-iris.mjs exec --state <file> -- <command> [args...]
//   node scripts/throwaway-iris.mjs session --state <file> --namespace <NS> --script <file>
//   node scripts/throwaway-iris.mjs cp --state <file> --from <container path under /tmp/iris-mcp-> --to <host path>
//   node scripts/throwaway-iris.mjs logs --state <file>
//   node scripts/throwaway-iris.mjs down --state <file>
//
// CONTRACT
//   1. Validation comes first, before anything is spawned: the image must be digest-pinned
//      (`<repo>[:<tag>]@sha256:<64 hex>`), the container name is one this script generates
//      (`iris-mcp-throwaway-<12 hex>`), the namespace is upper-case letters and digits, and the host port is never
//      52773 or 1972. The images are multi-arch manifest lists (linux/amd64 and linux/arm64), so one digest serves a
//      developer machine and an x86 runner.
//   2. `docker run -d --name <name> --label iris-mcp.owner=throwaway -p 127.0.0.1:<port>:52773 <image>` starts the
//      container. `<port>` is the `--host-port` value, or empty (a dynamic loopback port), read back with `docker port`.
//      The shared instance (container `iris-community-edition`, localhost:52773) is never named, probed or touched.
//   3. Readiness: a bounded `docker exec -i <id> iris session iris -U %SYS` loop, then
//      `Security.Users.UnExpireUserPasswords("_SYSTEM")`, then a bounded poll of `GET /api/atelier/` until HTTP 200.
//      A container that does not become ready has `docker logs --tail 200` printed before it is removed, in `run` and `up`.
//   4. `run` starts a container, runs the command against it, prints `docker logs --tail 200` when the command fails,
//      and removes the container, `docker rm -f -v <id>`, on normal exit, error, INT and TERM. It removes only the
//      container id this script created (the generated name until the id is known), never anything else.
//   5. `up` starts the same container, keeps it on success and writes the state file (JSON `{name, id, port, image,
//      namespace}`, mode 0600, never over an existing file). On any failure it removes the container and writes no
//      state. `exec`, `logs` and `down` read the state file and run `docker inspect` on the container first: it must
//      be one running container with that name, carrying the owner label, with its web port published on
//      127.0.0.1:<port>, or the command is refused and nothing else happens (`logs` and `down` also accept a stopped
//      container that carries the name and the label). `exec` runs the command with the throwaway environment, `logs`
//      prints `docker logs --tail 400`, and `down` removes the container and the state file. A missing state file
//      means `logs` and `down` have nothing to do and exit 0.
//   6. The command runs with IRIS_REQUIRE_LIVE=1, IRIS_HOST=127.0.0.1, IRIS_PORT=<port>, IRIS_USERNAME=_SYSTEM,
//      IRIS_PASSWORD=SYS, IRIS_NAMESPACE=<namespace, USER by default>, IRIS_HTTPS=false and
//      IRIS_THROWAWAY=<container name>; every other ambient IRIS_* variable is dropped. The script exits with the
//      command's exit code.
//   7. A missing docker exits non-zero with a message. The script never skips.
//   8. `up --network none` (Story 42.4) starts the container with `docker run -d --network none` and no `-p`, so it has a
//      loopback interface and nothing else, and it is ready when the session loop and the password unexpiry have answered:
//      there is no web port to poll. `--network none` and `--host-port` exclude each other. The state file is `{name, id,
//      image, namespace, network: "none"}`, mode 0600. `--mount <dir>:/opt/iris-mcp/<name>` (either mode) adds a read-only
//      bind mount `-v <dir>:/opt/iris-mcp/<name>:ro`; the host directory must be absolute, plain (no `..`, `.` or trailing
//      slash), a real directory and not a symbolic link, and the container path is `/opt/iris-mcp/<[a-z0-9-]+>`.
//   9. `session` pipes a script file into `docker exec -i <id> iris session iris -U <NS>` of the recorded container, prints
//      what the session prints, and exits with docker's status. `cp` runs `docker cp <id>:<from> <to>`, and `<from>` must
//      be a plain path under `/tmp/iris-mcp-`. Both re-inspect the container first, as `exec` does; a state with
//      `network: "none"` is inspected for `HostConfig.NetworkMode === "none"` and no published port instead of a port.
//      `exec` refuses a `--network none` state (exit 2): such a container has no port for the command to reach.
//
// EXIT CODES
//   2 usage or a refused image, name, namespace, port, state file or container on the command line; 3 docker not found
//   on PATH; 4 the container did not start or become ready, including a published host port that `docker port` reads
//   back as a refused one (52773 or 1972) or as another one than the one requested; otherwise the command's own exit
//   code (128 + n when a signal ended it).
//
// IMPORT
//   Importing this module spawns nothing. Every process-spawning step sits behind `defaultDeps()`, which only
//   `main()` calls, and `main()` runs only when this file is the entry point. `runHarness`, `upHarness`,
//   `execHarness`, `logsHarness` and `downHarness` take every side effect as a dependency.
//
// PURE HELPERS EXPORTED FOR THE GATES AND THE CI SCRIPTS
//   validateImage, validateHostPort, validateNamespace, validateSessionNamespace, validateContainerName,
//   generateContainerName, validateMount, validateCopySource, validateCopyDestination, buildRunArgv, buildPortArgv,
//   parseDockerPort, buildSessionArgv, buildCopyArgv, buildInspectArgv, buildLogsArgv, buildTeardownArgv,
//   buildChildEnv, throwawayEnvProblems, assertThrowawayEnv, parseCli, parseState, findExecutable, inspectProblems,
//   assertThrowawayInspect, createTeardown. The constants name the images and the safety limits.
//   `sessionHarness` and `copyHarness` are the two subcommand functions the CI scripts drive with `defaultDeps()`.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, chmodSync, constants, lstatSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isEntryPoint, spawnInherited } from './lib/script-process.mjs';

/**
 * The default image: IRIS Community 2026.2, pinned by its multi-arch manifest list digest (linux/amd64 `d4331089...`,
 * linux/arm64 `31d0ef38...`). Source: `registry-1.docker.io/v2/intersystems/iris-community/manifests/<digest>`,
 * content-type `manifest.list.v2`, fetched 2026-10-21.
 */
export const IRIS_COMMUNITY_IMAGE =
  'intersystems/iris-community:2026.2@sha256:cd2ebcab02d1ef80ec155def4418399f353d867162688c36a3705760e750bdaa';

/**
 * The oldest IRIS Community tag whose license key is valid for months ahead, pinned by its manifest list digest. A Community
 * image carries a time-limited license key and refuses to start once it has expired ("Invalid Community Edition license"), so the
 * oldest testable tag moves forward before its key expires (DW-686). The dated floor:
 *  - On 2026-10-22 the keys of 2024.3, 2025.1 and 2025.2 had expired.
 *  - 2025.3 passed every bootstrap-guard leg in CI run 39749804619 (commit `6a8574f`, 2026-10-22), and its key expires on
 *    2026-11-13, so this constant moved off it.
 *  - 2026.1 (IRIS 2026.1 Build 234U, IPM 0.10.5) is the oldest tag now tested; its key is valid to 2027-03-27.
 * Source: `hub.docker.com/v2/repositories/intersystems/iris-community/tags`, fetched 2026-10-22.
 */
export const OLDEST_IRIS_COMMUNITY_IMAGE =
  'intersystems/iris-community:2026.1@sha256:c57b65b2b454494091e7b3e49f6a53b3335f40adf475bcfcee0866083f35a7c2';

/**
 * IRIS for Health Community 2026.2, pinned by its multi-arch manifest list digest (linux/amd64 `788c8626...`): the
 * image a gate selects when it needs the interoperability namespaces that plain IRIS lacks (`HSCUSTOM`).
 */
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

/** The one network mode `up` takes besides a published loopback port: a loopback interface inside the container and nothing else. */
export const NETWORK_NONE = 'none';

/** Where a bind mount appears inside the container, and the prefix of the only container paths `cp` reads. */
export const MOUNT_CONTAINER_ROOT = '/opt/iris-mcp';
export const COPY_SOURCE_PREFIX = '/tmp/iris-mcp-';

/** The account, password, namespace and transport the command receives. */
export const THROWAWAY_USERNAME = '_SYSTEM';
export const THROWAWAY_PASSWORD = 'SYS';
export const THROWAWAY_NAMESPACE = 'USER';
export const THROWAWAY_HTTPS = 'false';

/** How many lines of the container log `run` and `logs` print. */
export const RUN_LOG_TAIL = 200;
export const LOGS_LOG_TAIL = 400;

const IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/:-]*@sha256:[0-9a-f]{64}$/;
const NAME_PATTERN = /^iris-mcp-throwaway-[0-9a-f]{12}$/;
const CONTAINER_ID_PATTERN = /^[0-9a-f]{64}$/;
const NAMESPACE_PATTERN = /^[A-Z][A-Z0-9]{0,63}$/;
const MOUNT_CONTAINER_PATTERN = /^\/opt\/iris-mcp\/[a-z0-9-]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

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
 * The namespace, when it is an IRIS namespace name this harness hands to a command: an upper-case letter followed by
 * up to 63 upper-case letters and digits (`USER`, `HSCUSTOM`).
 *
 * @param {unknown} namespace
 * @returns {string}
 */
export function validateNamespace(namespace) {
  if (typeof namespace !== 'string' || !NAMESPACE_PATTERN.test(namespace)) {
    throw new ThrowawayRefusal(
      `refusing the namespace ${JSON.stringify(namespace)}: it must be an upper-case letter followed by up to 63 upper-case letters or digits.`,
    );
  }
  return namespace;
}

/**
 * The namespace an `iris session` opens: {@link validateNamespace}, or `%SYS`.
 *
 * @param {unknown} namespace
 * @returns {string}
 */
export function validateSessionNamespace(namespace) {
  return namespace === '%SYS' ? namespace : validateNamespace(namespace);
}

/**
 * The read-only bind mount `<absolute host directory>:/opt/iris-mcp/<name>`, split into its two sides. The text must hold
 * exactly one colon, so a drive letter or a third (mode) part is refused; the host directory must be absolute and plain, as
 * `path.resolve` would write it (no `..`, no `.`, no repeated or trailing slash), with no control character; the container
 * path must be `/opt/iris-mcp/<[a-z0-9-]+>`. Only the text is checked: that the directory exists, is a directory and is not a
 * symbolic link is {@link defaultDeps}'s `checkMountDirectory`.
 *
 * @param {unknown} spec
 * @returns {{ host: string, container: string, spec: string }}
 */
export function validateMount(spec) {
  const refuse = (reason) =>
    new ThrowawayRefusal(
      `refusing the mount ${JSON.stringify(spec)}: ${reason} A mount is <absolute host directory>:${MOUNT_CONTAINER_ROOT}/<name>, with the name in [a-z0-9-].`,
    );
  if (typeof spec !== 'string' || spec === '') throw refuse('it is not text.');
  const parts = spec.split(':');
  if (parts.length !== 2) throw refuse('it must hold exactly one ":" (no drive letter, no mode).');
  const [host, container] = parts;
  if (CONTROL_CHARACTER_PATTERN.test(spec)) throw refuse('it holds a control character.');
  if (!path.isAbsolute(host)) throw refuse('the host directory is not absolute.');
  if (host.split(/[\\/]/).includes('..')) throw refuse('the host directory holds "..".');
  if (host !== path.resolve(host)) throw refuse('the host directory is not plain (no ".", repeated slash or trailing slash).');
  if (!MOUNT_CONTAINER_PATTERN.test(container)) throw refuse(`the container path is not ${MOUNT_CONTAINER_ROOT}/<name>.`);
  return { host, container, spec };
}

/**
 * The container path `cp` reads: absolute, under {@link COPY_SOURCE_PREFIX}, with no `..` segment, no colon and no control character.
 *
 * @param {unknown} from
 * @returns {string}
 */
export function validateCopySource(from) {
  const refuse = (reason) =>
    new ThrowawayRefusal(`refusing to copy ${JSON.stringify(from)}: ${reason} A copy reads a path that starts with ${COPY_SOURCE_PREFIX}.`);
  if (typeof from !== 'string' || !from.startsWith(COPY_SOURCE_PREFIX) || from.length === COPY_SOURCE_PREFIX.length) {
    throw refuse('it is not under that prefix.');
  }
  if (from.includes(':') || CONTROL_CHARACTER_PATTERN.test(from)) throw refuse('it holds a colon or a control character.');
  if (from.split('/').includes('..')) throw refuse('it holds "..".');
  return from;
}

/**
 * The host path `cp` writes: non-empty text with no colon (docker reads `name:path` as a container path) and no control character.
 *
 * @param {unknown} to
 * @returns {string}
 */
export function validateCopyDestination(to) {
  if (typeof to !== 'string' || to === '' || to.includes(':') || CONTROL_CHARACTER_PATTERN.test(to)) {
    throw new ThrowawayRefusal(
      `refusing to copy to ${JSON.stringify(to)}: the destination must be a host path with no colon (docker would read it as a container path) and no control character.`,
    );
  }
  return to;
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
 * published on the loopback address only: on `hostPort` when one is given, else on a dynamic port. With `network: 'none'`
 * the container has no network and no `-p`, and a `hostPort` is refused. A `mount` adds a read-only `-v` before the image.
 *
 * @param {{ image: string, name: string, hostPort?: string | number, network?: 'none', mount?: string }} options
 * @returns {string[]}
 */
export function buildRunArgv({ image, name, hostPort, network, mount }) {
  const mounted = [];
  if (mount !== undefined) {
    const { host, container } = validateMount(mount);
    mounted.push('-v', `${host}:${container}:ro`);
  }
  if (network !== undefined) {
    if (network !== NETWORK_NONE) {
      throw new ThrowawayRefusal(`refusing the network ${JSON.stringify(network)}: the only network mode this harness takes is "${NETWORK_NONE}".`);
    }
    if (hostPort !== undefined) {
      throw new ThrowawayRefusal('refusing a host port with --network none: a container with no network publishes no port.');
    }
    return ['run', '-d', '--name', validateContainerName(name), '--label', OWNER_LABEL, '--network', NETWORK_NONE, ...mounted, validateImage(image)];
  }
  const published = hostPort === undefined ? '' : validateHostPort(hostPort);
  return [
    'run',
    '-d',
    '--name',
    validateContainerName(name),
    '--label',
    OWNER_LABEL,
    '-p',
    `${LOOPBACK_HOST}:${published}:${CONTAINER_WEB_PORT}`,
    ...mounted,
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
 * The `docker exec` arguments that open an IRIS terminal session in `namespace` (`%SYS` by default), reading its commands
 * from stdin.
 *
 * @param {string} containerId
 * @param {string} [namespace]
 * @returns {string[]}
 */
export function buildSessionArgv(containerId, namespace = '%SYS') {
  return ['exec', '-i', validateContainerId(containerId), 'iris', 'session', 'iris', '-U', validateSessionNamespace(namespace)];
}

/**
 * The `docker cp` arguments that copy one file out of the container: `<id>:<from>` to the host path `to`.
 *
 * @param {string} containerId
 * @param {string} from - A container path under {@link COPY_SOURCE_PREFIX}.
 * @param {string} to - A host path.
 * @returns {string[]}
 */
export function buildCopyArgv(containerId, from, to) {
  return ['cp', `${validateContainerId(containerId)}:${validateCopySource(from)}`, validateCopyDestination(to)];
}

/**
 * The `docker inspect` arguments for one container: its id, or its generated name.
 *
 * @param {string} containerRef
 * @returns {string[]}
 */
export function buildInspectArgv(containerRef) {
  return ['inspect', CONTAINER_ID_PATTERN.test(String(containerRef)) ? containerRef : validateContainerName(containerRef)];
}

/**
 * The `docker logs` arguments for one container this script created: the last `tail` lines.
 *
 * @param {string} containerRef
 * @param {number} tail
 * @returns {string[]}
 */
export function buildLogsArgv(containerRef, tail) {
  if (!Number.isInteger(tail) || tail < 1) throw new ThrowawayRefusal(`refusing the log tail ${JSON.stringify(tail)}: it is not a positive integer.`);
  return ['logs', '--tail', String(tail), CONTAINER_ID_PATTERN.test(String(containerRef)) ? containerRef : validateContainerName(containerRef)];
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
 * @param {{ port: string | number, name: string, namespace?: string }} throwaway
 * @returns {Record<string, string>}
 */
export function buildChildEnv(baseEnv, { port, name, namespace = THROWAWAY_NAMESPACE }) {
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
    IRIS_NAMESPACE: validateNamespace(namespace),
    IRIS_HTTPS: THROWAWAY_HTTPS,
    IRIS_THROWAWAY: validateContainerName(name),
  };
}

/**
 * What is wrong with an environment that is supposed to target a throwaway container this harness started: it must be
 * armed with `IRIS_REQUIRE_LIVE=1`, carry a name of the shape this harness generates in `IRIS_THROWAWAY`, target
 * `IRIS_HOST=127.0.0.1`, and carry an `IRIS_PORT` that is a port and not 52773 or 1972. An empty list means it has that
 * shape. Only the environment is read: `exec` ties the name to a labelled, running container ({@link assertThrowawayInspect}).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function throwawayEnvProblems(env) {
  const problems = [];
  if (env.IRIS_REQUIRE_LIVE !== '1') problems.push(`IRIS_REQUIRE_LIVE is ${JSON.stringify(env.IRIS_REQUIRE_LIVE)}, not "1".`);
  try {
    validateContainerName(env.IRIS_THROWAWAY);
  } catch (error) {
    problems.push(`IRIS_THROWAWAY: ${error.message}`);
  }
  if (env.IRIS_HOST !== LOOPBACK_HOST) problems.push(`IRIS_HOST is ${JSON.stringify(env.IRIS_HOST)}, not ${LOOPBACK_HOST}.`);
  try {
    validateHostPort(env.IRIS_PORT);
  } catch (error) {
    problems.push(`IRIS_PORT: ${error.message}`);
  }
  return problems;
}

/**
 * Throw a {@link ThrowawayRefusal} unless `env` targets a throwaway container (see {@link throwawayEnvProblems}).
 *
 * @param {Record<string, string | undefined>} env
 */
export function assertThrowawayEnv(env) {
  const problems = throwawayEnvProblems(env);
  if (problems.length > 0) {
    throw new ThrowawayRefusal(`the environment does not target a throwaway IRIS container: ${problems.join(' ')}`);
  }
}

/**
 * Parse the command line.
 *
 * - `run [--image <ref>] [--host-port <port>] -- <command> [args...]`: `{ image, command }`, plus `hostPort` when the flag is
 *   given. The image defaults to {@link IRIS_COMMUNITY_IMAGE}.
 * - `up --image <ref> --namespace <NS> --host-port <port> [--mount <spec>] --state <file>`:
 *   `{ subcommand: 'up', image, namespace, hostPort, state }`, plus `mount` when the flag is given.
 * - `up --image <ref> --namespace <NS> --network none [--mount <spec>] --state <file>`:
 *   `{ subcommand: 'up', image, namespace, network: 'none', state }`, plus `mount`. `--network` and `--host-port` exclude each other.
 * - `exec --state <file> -- <command> [args...]`: `{ subcommand: 'exec', state, command }`.
 * - `session --state <file> --namespace <NS> --script <file>`: `{ subcommand: 'session', state, namespace, script }`.
 * - `cp --state <file> --from <container path> --to <host path>`: `{ subcommand: 'cp', state, from, to }`.
 * - `logs --state <file>` and `down --state <file>`: `{ subcommand, state }`.
 *
 * Every value is validated.
 *
 * @param {readonly string[]} argv
 * @returns {{ image: string, command: string[], hostPort?: string } | { subcommand: 'up', image: string, namespace: string, hostPort?: string, network?: 'none', mount?: string, state: string } | { subcommand: 'exec', state: string, command: string[] } | { subcommand: 'session', state: string, namespace: string, script: string } | { subcommand: 'cp', state: string, from: string, to: string } | { subcommand: 'logs' | 'down', state: string }}
 */
export function parseCli(argv) {
  const usage =
    'usage: node scripts/throwaway-iris.mjs run [--image <digest-pinned ref>] [--host-port <port>] -- <command> [args...]\n' +
    '       node scripts/throwaway-iris.mjs up --image <digest-pinned ref> --namespace <NS> --host-port <port> [--mount <dir>:/opt/iris-mcp/<name>] --state <file>\n' +
    '       node scripts/throwaway-iris.mjs up --image <digest-pinned ref> --namespace <NS> --network none [--mount <dir>:/opt/iris-mcp/<name>] --state <file>\n' +
    '       node scripts/throwaway-iris.mjs exec --state <file> -- <command> [args...]\n' +
    '       node scripts/throwaway-iris.mjs session --state <file> --namespace <NS> --script <file>\n' +
    '       node scripts/throwaway-iris.mjs cp --state <file> --from <container path under /tmp/iris-mcp-> --to <host path>\n' +
    '       node scripts/throwaway-iris.mjs logs --state <file>\n' +
    '       node scripts/throwaway-iris.mjs down --state <file>';
  const subcommand = argv[0];
  if (!['run', 'up', 'exec', 'session', 'cp', 'logs', 'down'].includes(subcommand)) throw new ThrowawayRefusal(usage);

  const allowed = {
    run: ['--image', '--host-port'],
    up: ['--image', '--namespace', '--host-port', '--network', '--mount', '--state'],
    exec: ['--state'],
    session: ['--state', '--namespace', '--script'],
    cp: ['--state', '--from', '--to'],
    logs: ['--state'],
    down: ['--state'],
  }[subcommand];
  const values = {};
  let index = 1;
  while (index < argv.length && argv[index] !== '--') {
    const flag = argv[index];
    if (allowed.includes(flag) && index + 1 < argv.length && values[flag] === undefined) {
      values[flag] = argv[index + 1];
      index += 2;
    } else {
      throw new ThrowawayRefusal(`unknown argument ${JSON.stringify(flag)}; ${usage}`);
    }
  }
  const takesCommand = subcommand === 'run' || subcommand === 'exec';
  const command = argv.slice(index + 1);
  if (takesCommand) {
    if (argv[index] !== '--' || command.length === 0) throw new ThrowawayRefusal(`no command after "--"; ${usage}`);
  } else if (index < argv.length) {
    throw new ThrowawayRefusal(`unexpected "--"; ${usage}`);
  }
  const require = (flag) => {
    if (values[flag] === undefined) throw new ThrowawayRefusal(`${subcommand} needs ${flag}; ${usage}`);
    return values[flag];
  };

  if (subcommand === 'run') {
    const parsed = { image: validateImage(values['--image'] ?? IRIS_COMMUNITY_IMAGE), command };
    if (values['--host-port'] !== undefined) parsed.hostPort = validateHostPort(values['--host-port']);
    return parsed;
  }
  if (subcommand === 'up') {
    const network = values['--network'];
    if (network !== undefined && network !== NETWORK_NONE) {
      throw new ThrowawayRefusal(`refusing --network ${JSON.stringify(network)}: the only network mode this harness takes is "${NETWORK_NONE}"; ${usage}`);
    }
    if (network !== undefined && values['--host-port'] !== undefined) {
      throw new ThrowawayRefusal(`--network none and --host-port exclude each other: a container with no network publishes no port; ${usage}`);
    }
    const parsed = {
      subcommand,
      image: validateImage(require('--image')),
      namespace: validateNamespace(require('--namespace')),
    };
    if (network === undefined) parsed.hostPort = validateHostPort(require('--host-port'));
    else parsed.network = network;
    parsed.state = require('--state');
    if (values['--mount'] !== undefined) parsed.mount = validateMount(values['--mount']).spec;
    return parsed;
  }
  if (subcommand === 'exec') return { subcommand, state: require('--state'), command };
  if (subcommand === 'session') {
    return {
      subcommand,
      state: require('--state'),
      namespace: validateSessionNamespace(require('--namespace')),
      script: require('--script'),
    };
  }
  if (subcommand === 'cp') {
    return {
      subcommand,
      state: require('--state'),
      from: validateCopySource(require('--from')),
      to: validateCopyDestination(require('--to')),
    };
  }
  return { subcommand, state: require('--state') };
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
 * on the loopback address at `port`. An empty list means the container is the throwaway. With `allowStopped`, a
 * container that is not running is accepted when it carries the name and the label, and its published port is not checked.
 *
 * With `network: 'none'` in place of `port`, the container must instead have `HostConfig.NetworkMode === "none"` and publish
 * no port at all (neither `HostConfig.PortBindings` nor `NetworkSettings.Ports` binds anything), whether it runs or not.
 * Exactly one of `port` and `network` is given.
 *
 * @param {unknown} inspected - The parsed JSON of `docker inspect`.
 * @param {{ name: string, port?: string | number, network?: 'none', allowStopped?: boolean }} expected
 * @returns {string[]}
 */
export function inspectProblems(inspected, { name, port, network, allowStopped = false }) {
  const problems = [];
  const isolated = network !== undefined;
  try {
    validateContainerName(name);
  } catch (error) {
    problems.push(error.message);
  }
  if (isolated) {
    if (network !== NETWORK_NONE) problems.push(`the network ${JSON.stringify(network)} is not "${NETWORK_NONE}".`);
    if (port !== undefined) problems.push('a container is published on a port or runs with --network none, never both.');
  } else {
    try {
      validateHostPort(port);
    } catch (error) {
      problems.push(error.message);
    }
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
  const running = container.State?.Running === true;
  if (!running && !allowStopped) {
    problems.push('the container is not running.');
  }
  if (isolated) {
    const mode = container.HostConfig?.NetworkMode;
    if (mode !== NETWORK_NONE) {
      problems.push(`the container's network mode is ${JSON.stringify(mode)}, not "${NETWORK_NONE}".`);
    }
    const bound = (ports) =>
      Object.entries(ports ?? {})
        .filter(([, bindings]) => Array.isArray(bindings) && bindings.length > 0)
        .map(([key]) => key);
    const published = [...bound(container.HostConfig?.PortBindings), ...bound(container.NetworkSettings?.Ports)];
    if (published.length > 0) {
      problems.push(`the container publishes ${[...new Set(published)].join(', ')}, but a --network none container publishes no port.`);
    }
  } else if (running || !allowStopped) {
    const bindings = container.NetworkSettings?.Ports?.[`${CONTAINER_WEB_PORT}/tcp`];
    const published =
      Array.isArray(bindings) &&
      bindings.some((binding) => binding?.HostIp === LOOPBACK_HOST && String(binding?.HostPort) === String(port));
    if (!published) {
      problems.push(`the container does not publish ${CONTAINER_WEB_PORT}/tcp on ${LOOPBACK_HOST}:${port}.`);
    }
  }
  return problems;
}

/**
 * Throw when {@link inspectProblems} finds any problem.
 *
 * @param {unknown} inspected
 * @param {{ name: string, port?: string | number, network?: 'none', allowStopped?: boolean }} expected
 */
export function assertThrowawayInspect(inspected, expected) {
  const problems = inspectProblems(inspected, expected);
  if (problems.length > 0) {
    throw new ThrowawayRefusal(`${expected.name} is not a throwaway container this harness started: ${problems.join(' ')}`);
  }
}

/**
 * The state of a throwaway that `up` keeps: parsed from the state file's text and validated field by field. It records
 * exactly one of `port` (a published loopback port) and `network` (`"none"`), and a `mount` when `up` was given one.
 *
 * @param {string} text
 * @returns {{ name: string, id: string, port: string, image: string, namespace: string, mount?: string } | { name: string, id: string, image: string, namespace: string, network: 'none', mount?: string }}
 */
export function parseState(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ThrowawayRefusal('the state file is not JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ThrowawayRefusal('the state file is not a JSON object.');
  }
  const hasPort = parsed.port !== undefined;
  const hasNetwork = parsed.network !== undefined;
  if (hasPort === hasNetwork) {
    throw new ThrowawayRefusal('the state file must record exactly one of "port" and "network".');
  }
  if (hasNetwork && parsed.network !== NETWORK_NONE) {
    throw new ThrowawayRefusal(`the state file records the network ${JSON.stringify(parsed.network)}, not "${NETWORK_NONE}".`);
  }
  const common = {
    name: validateContainerName(parsed.name),
    id: validateContainerId(parsed.id),
  };
  const rest = {
    image: validateImage(parsed.image),
    namespace: validateNamespace(parsed.namespace),
  };
  const mount = parsed.mount === undefined ? {} : { mount: validateMount(parsed.mount).spec };
  return hasPort
    ? { ...common, port: validateHostPort(parsed.port), ...rest, ...mount }
    : { ...common, ...rest, network: NETWORK_NONE, ...mount };
}

/**
 * A teardown that removes exactly one container, once. `arm(ref)` records the container this script created (first its
 * generated name, then its id); `run()` removes it synchronously, so it is safe in an `exit` handler, and is idempotent;
 * `disarm()` forgets the container, for a container that is kept on purpose.
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
    disarm() {
      ref = undefined;
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
  sessionRunMs: 540_000,
  copyMs: 120_000,
  webReadyMs: 120_000,
  webStepMs: 2_000,
  dockerCallMs: 120_000,
});

/** A failure to start or ready the container: the run ends with exit code 4. */
class StartFailure extends Error {}

/**
 * Start a container from `image` and wait until it is ready: the docker calls, the port read-back, the session loop,
 * the password unexpiry and the HTTP poll. Throws {@link StartFailure} (or a refusal) on any failure; the caller's
 * teardown removes the container.
 *
 * With `network: 'none'` the container publishes no port: there is no `docker port` read-back and no HTTP poll, and it is
 * ready when the session loop and the password unexpiry have answered. `port` is then `undefined`.
 *
 * @returns {Promise<{ name: string, containerId: string, port: string | undefined }>}
 */
async function startContainer({ image, hostPort, network, mount }, deps, teardown, limits) {
  const name = generateContainerName();
  const docker = (args, callOptions) => deps.docker(args, { timeoutMs: limits.dockerCallMs, ...callOptions });
  const isolated = network !== undefined;

  teardown.arm(name);
  const started = docker(buildRunArgv({ image, name, hostPort, network, mount }), { timeoutMs: limits.runMs });
  if (started.status !== 0) {
    throw new StartFailure(`docker run failed (${started.error?.message ?? `exit ${started.status}`}): ${started.stderr.trim()}`);
  }
  const containerId = started.stdout.trim().split(/\r?\n/).pop() ?? '';
  if (!CONTAINER_ID_PATTERN.test(containerId)) {
    throw new StartFailure(`docker run printed ${JSON.stringify(started.stdout.trim())}, not a container id.`);
  }
  teardown.arm(containerId);
  deps.log(`throwaway-iris: started ${name} from ${image}`);

  let port;
  if (isolated) {
    deps.log(`throwaway-iris: ${name} runs with --network ${NETWORK_NONE}: it publishes no port`);
  } else {
    const reported = docker(buildPortArgv(containerId));
    if (reported.status !== 0) throw new StartFailure(`docker port failed: ${reported.stderr.trim()}`);
    port = parseDockerPort(reported.stdout);
    if (hostPort !== undefined && port !== validateHostPort(hostPort)) {
      throw new StartFailure(`${name} publishes the web port on ${LOOPBACK_HOST}:${port}, not on the requested ${validateHostPort(hostPort)}.`);
    }
    deps.log(`throwaway-iris: ${name} publishes the web port on ${LOOPBACK_HOST}:${port}`);
  }

  const session = (script) => docker(buildSessionArgv(containerId), { input: script, timeoutMs: limits.sessionCallMs });

  try {
    const sessionDeadline = deps.now() + limits.sessionReadyMs;
    for (;;) {
      const attempt = session(READY_SCRIPT);
      if (attempt.status === 0 && attempt.stdout.includes('IRISMCP-READY')) break;
      if (deps.now() >= sessionDeadline) {
        throw new StartFailure(`${name} never answered an iris session within ${limits.sessionReadyMs / 1000}s.`);
      }
      await deps.sleep(limits.sessionStepMs);
    }

    const unexpired = session(UNEXPIRE_SCRIPT);
    if (unexpired.status !== 0 || !/IRISMCP-UNEXPIRE:OK:END/.test(unexpired.stdout)) {
      throw new StartFailure(`UnExpireUserPasswords("_SYSTEM") did not report OK: ${`${unexpired.stdout}${unexpired.stderr}`.trim().slice(-400)}`);
    }

    if (!isolated) {
      const webDeadline = deps.now() + limits.webReadyMs;
      while ((await deps.webStatus(port)) !== 200) {
        if (deps.now() >= webDeadline) {
          throw new StartFailure(`GET /api/atelier/ on ${LOOPBACK_HOST}:${port} never answered HTTP 200 within ${limits.webReadyMs / 1000}s.`);
        }
        await deps.sleep(limits.webStepMs);
      }
    }
  } catch (error) {
    printContainerLogs(deps, docker, containerId, RUN_LOG_TAIL);
    throw error;
  }
  return { name, containerId, port };
}

/** The container log tail, printed through `deps.log` (best effort). */
function printContainerLogs(deps, docker, containerId, tail) {
  try {
    const logs = docker(buildLogsArgv(containerId, tail));
    deps.log(`throwaway-iris: docker logs --tail ${tail} ${containerId}:\n${`${logs.stdout}${logs.stderr}`.trimEnd()}`);
  } catch (error) {
    deps.log(`throwaway-iris: could not read the container log: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Run `options.command` against a fresh throwaway container and return its exit code (or one of the codes in the
 * header). Every side effect goes through `deps`; `teardown` removes the container on every path out. When the command
 * fails, the last {@link RUN_LOG_TAIL} lines of the container log are printed before the container is removed.
 *
 * @param {{ image: string, command: string[], hostPort?: string, env: Record<string, string | undefined>, limits?: Partial<typeof DEFAULT_LIMITS> }} options
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
  try {
    image = validateImage(options.image);
    if (options.hostPort !== undefined) validateHostPort(options.hostPort);
  } catch (error) {
    deps.log(`throwaway-iris: ${error.message}`);
    return 2;
  }
  if (deps.findDocker(options.env) === undefined) {
    deps.log('throwaway-iris: docker was not found on PATH. This harness needs docker to start the throwaway IRIS container and never skips.');
    return 3;
  }
  const docker = (args, callOptions) => deps.docker(args, { timeoutMs: limits.dockerCallMs, ...callOptions });
  let containerId;

  try {
    const started = await startContainer({ image, hostPort: options.hostPort }, deps, teardown, limits);
    containerId = started.containerId;
    deps.log(`throwaway-iris: ${started.name} answers HTTP 200 on /api/atelier/; running ${options.command.join(' ')}`);

    const code = await deps.runCommand(options.command, buildChildEnv(options.env, { port: started.port, name: started.name }));
    if (code !== 0) printContainerLogs(deps, docker, containerId, RUN_LOG_TAIL);
    return code;
  } catch (error) {
    deps.log(`throwaway-iris: ${error instanceof Error ? error.message : String(error)}`);
    if (containerId !== undefined) printContainerLogs(deps, docker, containerId, RUN_LOG_TAIL);
    return 4;
  } finally {
    teardown.run();
  }
}

/**
 * Start a container, keep it, and record it in the state file. Nothing is kept on a failure: the container is removed
 * and no state is written. With `network: 'none'` (and no `hostPort`) the container publishes no port; a `mount` adds a
 * read-only bind mount whose host directory `deps.checkMountDirectory` has found to be a real directory and not a link.
 *
 * @param {{ image: string, namespace: string, hostPort?: string, network?: 'none', mount?: string, state: string, env: Record<string, string | undefined>, limits?: Partial<typeof DEFAULT_LIMITS> }} options
 * @param {Parameters<typeof runHarness>[1] & { fileExists: (file: string) => boolean, writeState: (file: string, text: string) => void, checkMountDirectory: (directory: string) => string | undefined }} deps
 * @param {ReturnType<typeof createTeardown>} teardown
 * @returns {Promise<number>}
 */
export async function upHarness(options, deps, teardown) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  let image;
  let namespace;
  let hostPort;
  let network;
  let mount;
  try {
    image = validateImage(options.image);
    namespace = validateNamespace(options.namespace);
    if (options.network !== undefined) {
      if (options.network !== NETWORK_NONE) throw new ThrowawayRefusal(`refusing the network ${JSON.stringify(options.network)}: the only network mode this harness takes is "${NETWORK_NONE}".`);
      if (options.hostPort !== undefined) throw new ThrowawayRefusal('--network none and --host-port exclude each other: a container with no network publishes no port.');
      network = NETWORK_NONE;
    } else {
      hostPort = validateHostPort(options.hostPort);
    }
    if (options.mount !== undefined) {
      mount = validateMount(options.mount);
      if (typeof deps.checkMountDirectory !== 'function') {
        throw new ThrowawayRefusal('a mount needs the host-directory check (deps.checkMountDirectory), and none was supplied.');
      }
      const problem = deps.checkMountDirectory(mount.host);
      if (problem !== undefined) throw new ThrowawayRefusal(`refusing the mount ${JSON.stringify(options.mount)}: ${problem}`);
    }
    if (typeof options.state !== 'string' || options.state === '') throw new ThrowawayRefusal('--state needs a file path.');
    if (deps.fileExists(options.state)) {
      throw new ThrowawayRefusal(`the state file ${options.state} already exists: run "down --state" on it first, or remove it.`);
    }
  } catch (error) {
    deps.log(`throwaway-iris: ${error.message}`);
    return 2;
  }
  if (deps.findDocker(options.env) === undefined) {
    deps.log('throwaway-iris: docker was not found on PATH. This harness needs docker to start the throwaway IRIS container and never skips.');
    return 3;
  }

  try {
    const started = await startContainer({ image, hostPort, network, mount: mount?.spec }, deps, teardown, limits);
    const recorded =
      network === undefined
        ? { name: started.name, id: started.containerId, port: started.port, image, namespace }
        : { name: started.name, id: started.containerId, image, namespace, network };
    if (mount !== undefined) recorded.mount = mount.spec;
    deps.writeState(options.state, `${JSON.stringify(recorded, null, 2)}\n`);
    teardown.disarm();
    deps.log(
      network === undefined
        ? `throwaway-iris: ${started.name} is up on ${LOOPBACK_HOST}:${started.port} (namespace ${namespace}); state in ${options.state}`
        : `throwaway-iris: ${started.name} is up with --network ${NETWORK_NONE} (namespace ${namespace}); state in ${options.state}`,
    );
    return 0;
  } catch (error) {
    deps.log(`throwaway-iris: ${error instanceof Error ? error.message : String(error)}`);
    return 4;
  } finally {
    teardown.run();
  }
}

/**
 * The throwaway that a state file records, after `docker inspect` showed it is still that container: a published port at the
 * state's port, or `--network none` and no published port at all, as the state records. With `needsPort`, a state that records
 * `--network none` is refused with exit code 2 before docker is called, because such a container has no port to reach.
 *
 * @returns {{ state: ReturnType<typeof parseState> } | { missing: true } | { code: number }} `missing` means there is no state file; a `code` means the state or the container was refused.
 */
function loadThrowaway(options, deps, { allowStopped, needsPort = false }) {
  let text;
  try {
    text = deps.readState(options.state);
  } catch (error) {
    deps.log(`throwaway-iris: could not read the state file ${options.state}: ${error instanceof Error ? error.message : String(error)}`);
    return { code: 2 };
  }
  if (text === undefined) return { missing: true };
  let state;
  try {
    state = parseState(text);
  } catch (error) {
    deps.log(`throwaway-iris: ${options.state}: ${error.message}`);
    return { code: 2 };
  }
  if (needsPort && state.network !== undefined) {
    deps.log(
      `throwaway-iris: ${state.name} runs with --network ${NETWORK_NONE} and publishes no port, so there is no IRIS_PORT for a command to reach: use "session" or "cp".`,
    );
    return { code: 2 };
  }
  if (deps.findDocker(options.env) === undefined) {
    deps.log('throwaway-iris: docker was not found on PATH. This harness needs docker and never skips.');
    return { code: 3 };
  }
  const inspected = deps.docker(buildInspectArgv(state.id), { timeoutMs: DEFAULT_LIMITS.dockerCallMs });
  if (inspected.status !== 0) {
    deps.log(`throwaway-iris: docker inspect ${state.id} failed (${inspected.error?.message ?? `exit ${inspected.status}`}): ${inspected.stderr.trim()}`);
    return { code: 2 };
  }
  try {
    const expected = state.network === undefined ? { name: state.name, port: state.port } : { name: state.name, network: state.network };
    assertThrowawayInspect(JSON.parse(inspected.stdout), { ...expected, allowStopped });
  } catch (error) {
    deps.log(`throwaway-iris: ${error.message}`);
    return { code: 2 };
  }
  return { state };
}

/**
 * Run a command with the throwaway environment of the container the state file records.
 *
 * @param {{ state: string, command: string[], env: Record<string, string | undefined> }} options
 * @param {Parameters<typeof runHarness>[1] & { readState: (file: string) => string | undefined }} deps
 * @returns {Promise<number>}
 */
export async function execHarness(options, deps) {
  const loaded = loadThrowaway(options, deps, { allowStopped: false, needsPort: true });
  if (loaded.missing) {
    deps.log(`throwaway-iris: the state file ${options.state} does not exist: run "up --state" first.`);
    return 2;
  }
  if (loaded.code !== undefined) return loaded.code;
  const { state } = loaded;
  try {
    return await deps.runCommand(options.command, buildChildEnv(options.env, { port: state.port, name: state.name, namespace: state.namespace }));
  } catch (error) {
    deps.log(`throwaway-iris: ${error instanceof Error ? error.message : String(error)}`);
    return 4;
  }
}

/**
 * Pipe a script file into an IRIS terminal session of the container the state file records (`docker exec -i <id> iris
 * session iris -U <NS>`), print what the session prints, and return docker's exit status. The container is re-inspected
 * first, and the script and the namespace are checked before docker is called. Exit 2: a refused namespace, script, state or
 * container; 4: docker did not run the session (including a timeout).
 *
 * @param {{ state: string, namespace: string, script: string, env: Record<string, string | undefined>, limits?: Partial<typeof DEFAULT_LIMITS> }} options
 * @param {Parameters<typeof runHarness>[1] & { readState: (file: string) => string | undefined, readScript: (file: string) => string, out: (text: string) => void }} deps
 * @returns {Promise<number>}
 */
export async function sessionHarness(options, deps) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  let namespace;
  let script;
  try {
    namespace = validateSessionNamespace(options.namespace);
    if (typeof options.script !== 'string' || options.script === '') throw new ThrowawayRefusal('--script needs a file path.');
    script = deps.readScript(options.script);
  } catch (error) {
    deps.log(`throwaway-iris: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const loaded = loadThrowaway(options, deps, { allowStopped: false });
  if (loaded.missing) {
    deps.log(`throwaway-iris: the state file ${options.state} does not exist: run "up --state" first.`);
    return 2;
  }
  if (loaded.code !== undefined) return loaded.code;
  const result = deps.docker(buildSessionArgv(loaded.state.id, namespace), { input: script, timeoutMs: limits.sessionRunMs });
  deps.out(result.stdout);
  if (result.stderr.trim() !== '') deps.log(`throwaway-iris: the session wrote to stderr: ${result.stderr.trim()}`);
  if (result.status === null || result.error !== undefined) {
    deps.log(`throwaway-iris: the session did not finish (${result.error?.message ?? 'no exit status'}).`);
    return 4;
  }
  return result.status;
}

/**
 * Copy one file out of the container the state file records (`docker cp <id>:<from> <to>`), after the container has been
 * re-inspected. Exit 0 when docker copied it, 2 for a refused path, state or container, 4 when docker failed.
 *
 * @param {{ state: string, from: string, to: string, env: Record<string, string | undefined>, limits?: Partial<typeof DEFAULT_LIMITS> }} options
 * @param {Parameters<typeof runHarness>[1] & { readState: (file: string) => string | undefined }} deps
 * @returns {Promise<number>}
 */
export async function copyHarness(options, deps) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  try {
    validateCopySource(options.from);
    validateCopyDestination(options.to);
  } catch (error) {
    deps.log(`throwaway-iris: ${error.message}`);
    return 2;
  }
  const loaded = loadThrowaway(options, deps, { allowStopped: false });
  if (loaded.missing) {
    deps.log(`throwaway-iris: the state file ${options.state} does not exist: run "up --state" first.`);
    return 2;
  }
  if (loaded.code !== undefined) return loaded.code;
  const copied = deps.docker(buildCopyArgv(loaded.state.id, options.from, options.to), { timeoutMs: limits.copyMs });
  if (copied.status !== 0) {
    deps.log(`throwaway-iris: docker cp failed (${copied.error?.message ?? `exit ${copied.status}`}): ${copied.stderr.trim()}`);
    return 4;
  }
  deps.log(`throwaway-iris: copied ${options.from} out of ${loaded.state.name} to ${options.to}`);
  return 0;
}

/**
 * Print the last {@link LOGS_LOG_TAIL} lines of the log of the container the state file records. A missing state file
 * means there is no container, and exits 0.
 *
 * @param {{ state: string, env: Record<string, string | undefined> }} options
 * @param {Parameters<typeof runHarness>[1] & { readState: (file: string) => string | undefined }} deps
 * @returns {Promise<number>}
 */
export async function logsHarness(options, deps) {
  const loaded = loadThrowaway(options, deps, { allowStopped: true });
  if (loaded.missing) {
    deps.log(`throwaway-iris: no state file at ${options.state}: no container to read.`);
    return 0;
  }
  if (loaded.code !== undefined) return loaded.code;
  printContainerLogs(deps, (args, callOptions) => deps.docker(args, { timeoutMs: DEFAULT_LIMITS.dockerCallMs, ...callOptions }), loaded.state.id, LOGS_LOG_TAIL);
  return 0;
}

/**
 * Remove the container the state file records, and the state file. A missing state file means there is nothing to
 * remove, and exits 0, so the command can run again after a success.
 *
 * @param {{ state: string, env: Record<string, string | undefined> }} options
 * @param {Parameters<typeof runHarness>[1] & { readState: (file: string) => string | undefined, removeState: (file: string) => void }} deps
 * @returns {Promise<number>}
 */
export async function downHarness(options, deps) {
  const loaded = loadThrowaway(options, deps, { allowStopped: true });
  if (loaded.missing) {
    deps.log(`throwaway-iris: no state file at ${options.state}: no container to remove.`);
    return 0;
  }
  if (loaded.code !== undefined) return loaded.code;
  const removed = deps.docker(buildTeardownArgv(loaded.state.id), { timeoutMs: DEFAULT_LIMITS.dockerCallMs });
  if (removed.status !== 0) {
    deps.log(`throwaway-iris: docker rm failed (${removed.error?.message ?? `exit ${removed.status}`}): ${removed.stderr.trim()}`);
    return 4;
  }
  deps.removeState(options.state);
  deps.log(`throwaway-iris: removed ${loaded.state.name}`);
  return 0;
}

/**
 * The real side effects of the harness functions. Calling this spawns nothing by itself; each function spawns only when
 * it is called.
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
      spawnInherited(command, {
        label: 'throwaway-iris',
        env: commandEnv,
        onChild: (spawned) => {
          child = spawned;
        },
      }),
    /** Forward a signal to the running command. */
    killCommand: (signal) => {
      child?.kill(signal);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (line) => process.stderr.write(`${line}\n`),
    fileExists: (file) => {
      try {
        statSync(file);
        return true;
      } catch {
        return false;
      }
    },
    readState: (file) => {
      try {
        return readFileSync(file, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') return undefined;
        throw error;
      }
    },
    writeState: (file, text) => {
      writeFileSync(file, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      chmodSync(file, 0o600);
    },
    removeState: (file) => {
      rmSync(file, { force: true });
    },
    readScript: (file) => readFileSync(file, 'utf8'),
    out: (text) => {
      process.stdout.write(text);
    },
    /** A reason the host directory of a bind mount is refused, or `undefined` when it is a real directory and not a symbolic link. */
    checkMountDirectory: (directory) => {
      try {
        const entry = lstatSync(directory);
        if (entry.isSymbolicLink()) return `${directory} is a symbolic link, and a mount follows what it points at.`;
        if (!entry.isDirectory()) return `${directory} is not a directory.`;
        return undefined;
      } catch (error) {
        return error?.code === 'ENOENT' ? `${directory} does not exist.` : `${directory} cannot be read (${error?.message ?? error}).`;
      }
    },
  };
}

/**
 * The entry point: parse the command line, install the teardown on exit, INT and TERM for the subcommands that start a
 * container, and run the subcommand.
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
  const subcommand = cli.subcommand ?? 'run';

  if (['logs', 'down', 'exec', 'session', 'cp'].includes(subcommand)) {
    if (subcommand === 'exec') {
      // The container outlives this process: a signal reaches the command only.
      for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
          deps.killCommand(signal);
        });
      }
    }
    const options = { ...cli, state: path.resolve(cli.state), env };
    if (subcommand === 'exec') return execHarness(options, deps);
    if (subcommand === 'session') return sessionHarness({ ...options, script: path.resolve(cli.script) }, deps);
    if (subcommand === 'cp') return copyHarness({ ...options, to: path.resolve(cli.to) }, deps);
    if (subcommand === 'logs') return logsHarness(options, deps);
    return downHarness(options, deps);
  }

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
  if (subcommand === 'up') {
    return upHarness({ ...cli, state: path.resolve(cli.state), env }, deps, teardown);
  }
  return runHarness({ image: cli.image, command: cli.command, hostPort: cli.hostPort, env }, deps, teardown);
}

if (isEntryPoint(import.meta.url)) {
  main().then((code) => process.exit(code));
}
