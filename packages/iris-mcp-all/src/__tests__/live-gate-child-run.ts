/**
 * Runs one live-gate file in its own vitest process, under the connection-refusing preload
 * (`scripts/lib/no-live-iris-preload.mjs`), for the guards that pin each gate's arming on its own real path
 * (`epic38-gate-guards.test.ts`, `story-39-1-gate-guards.test.ts`).
 *
 * The child's target is a local port nothing listens on. The preload watches that port and the default IRIS
 * ports (52773 and 1972), so a connect to any of them is refused and logged: a gate that probes while it is not
 * armed shows a logged connect, `spawnSync` observes it without a listener in this process, and a gate that
 * fell back to a default instance would be refused instead of reaching one.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inheritedEnv } from "./process-gate-helpers.js";

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");

/** The connection-refusing preload every child run loads. */
const PRELOAD_URL = pathToFileURL(path.join(REPO_ROOT, "scripts", "lib", "no-live-iris-preload.mjs")).href;

/** The vitest entry point this package's tests run under. */
const VITEST_ENTRY = path.join(
  path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

/**
 * How the child is armed:
 *  - `unarmed`: the full five-variable target, without `IRIS_REQUIRE_LIVE`;
 *  - `armed`: the same target with `IRIS_REQUIRE_LIVE=1`;
 *  - `armedIncomplete`: `IRIS_REQUIRE_LIVE=1` with only `IRIS_HOST` and `IRIS_PORT`.
 */
export type ArmingMode = "unarmed" | "armed" | "armedIncomplete";

/** What a child run produced. */
export interface LiveGateRun {
  status: number | null;
  /** Both streams of the child. */
  output: string;
  /** One `<host>:<port>` line per connect the preload refused. */
  connects: string[];
}

/**
 * Run `src/__tests__/<file>` of this package in its own vitest process, targeting `127.0.0.1:<closedPort>`.
 *
 * @param file - The test file name inside `src/__tests__/`.
 * @param mode - How the child is armed.
 * @param closedPort - A local port nothing listens on; the preload watches it.
 */
export function runLiveGateFile(file: string, mode: ArmingMode, closedPort: string): LiveGateRun {
  const scratch = mkdtempSync(path.join(tmpdir(), "mcp-live-gate-child-"));
  const connectLog = path.join(scratch, "connects.log");
  try {
    const outcome = spawnSync(process.execPath, [VITEST_ENTRY, "run", `src/__tests__/${file}`], {
      cwd: PACKAGE_DIR,
      env: {
        ...inheritedEnv(["VITEST", "VITEST_WORKER_ID", "VITEST_POOL_ID", "VITEST_MODE", "TEST", "NODE_ENV", "NODE_OPTIONS"]),
        NODE_OPTIONS: `--import=${PRELOAD_URL}`,
        IRIS_MCP_CONNECT_LOG: connectLog,
        IRIS_MCP_WATCH_PORTS: `${closedPort},52773,1972`,
        IRIS_HOST: "127.0.0.1",
        IRIS_PORT: closedPort,
        ...(mode === "armedIncomplete"
          ? {}
          : { IRIS_USERNAME: "arming-guard", IRIS_PASSWORD: "arming-guard", IRIS_NAMESPACE: "ARMINGGUARD", IRIS_HTTPS: "false" }),
        ...(mode === "unarmed" ? {} : { IRIS_REQUIRE_LIVE: "1" }),
      },
      encoding: "utf8",
      timeout: 90000,
    });
    return {
      status: outcome.status,
      output: `${outcome.stdout ?? ""}\n${outcome.stderr ?? ""}`,
      connects: existsSync(connectLog)
        ? readFileSync(connectLog, "utf8")
            .split("\n")
            .filter((line) => line !== "")
        : [],
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** What {@link runVitestUnderPreload} observed. */
export interface PreloadedRun {
  status: number | null;
  /** Both streams of the child. */
  output: string;
  /** The child's standard output alone. */
  stdout: string;
  /** The child's standard error alone. */
  stderr: string;
  /** One `<host>:<port>` line per connect the preload refused. */
  connects: string[];
}

/**
 * The inherited environment with NO arming or target variable: every `IRIS_*` key is removed (case-insensitively), and so
 * is every variable that makes a child think it is nested in a test run (`VITEST*`, `TEST`, `NODE_ENV`, `NODE_OPTIONS`).
 */
export function scrubbedEnv(): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    if (typeof value !== "string" || upper.startsWith("IRIS_") || upper.startsWith("VITEST")) continue;
    if (["TEST", "NODE_ENV", "NODE_OPTIONS"].includes(upper)) continue;
    base[key] = value;
  }
  return base;
}

/** How to run vitest under the preload. */
export interface PreloadedRunOptions {
  /** The package directory vitest runs in (its `vitest.config.ts` applies unless `args` names another config). */
  packageDir: string;
  /** Arguments after `vitest run`: test files, `--config <file>`, `--root <dir>`. */
  args: readonly string[];
  /** Extra ports the preload refuses, besides the IRIS defaults 52773 and 1972. */
  watchPorts?: readonly string[];
  /** Extra variables for the child (after the scrub). */
  env?: Record<string, string>;
  /** Run without the preload: the control that shows the oracle can tell a run that connects from one that does not. */
  withoutPreload?: boolean;
  timeoutMs: number;
}

/**
 * Run `vitest run <args>` in `packageDir` as a child with NO arming or target variable: every `IRIS_*` key is
 * removed (case-insensitively) from the inherited environment, and so is every variable that makes the child
 * think it is nested in a test run. Unless `withoutPreload` is set, the connection-refusing preload watches the
 * default IRIS ports and `watchPorts`, so the returned `connects` lists every attempt to reach an instance.
 */
export function runVitestUnderPreload(options: PreloadedRunOptions): Promise<PreloadedRun> {
  const vitestEntry = path.join(
    path.dirname(createRequire(path.join(options.packageDir, "package.json")).resolve("vitest/package.json")),
    "vitest.mjs",
  );
  return runNodeUnderPreload([vitestEntry, "run", ...options.args], options.packageDir, options);
}

/** How to run a Node script under the preload. */
export interface PreloadedScriptOptions extends Omit<PreloadedRunOptions, "packageDir" | "args"> {
  /** The script, by absolute path. */
  script: string;
  /** Its arguments. */
  args: readonly string[];
  /** The directory it runs in. */
  cwd: string;
}

/** Run `node <script> <args>` in `cwd` the way {@link runVitestUnderPreload} runs vitest: scrubbed, under the preload. */
export function runScriptUnderPreload(options: PreloadedScriptOptions): Promise<PreloadedRun> {
  return runNodeUnderPreload([options.script, ...options.args], options.cwd, options);
}

function runNodeUnderPreload(
  argv: readonly string[],
  cwd: string,
  options: Pick<PreloadedRunOptions, "watchPorts" | "env" | "withoutPreload" | "timeoutMs">,
): Promise<PreloadedRun> {
  const scratch = mkdtempSync(path.join(tmpdir(), "mcp-preloaded-run-"));
  const connectLog = path.join(scratch, "connects.log");
  const env: Record<string, string> = {
    ...scrubbedEnv(),
    ...(options.withoutPreload === true
      ? {}
      : {
          NODE_OPTIONS: `--import=${PRELOAD_URL}`,
          IRIS_MCP_CONNECT_LOG: connectLog,
          IRIS_MCP_WATCH_PORTS: ["52773", "1972", ...(options.watchPorts ?? [])].join(","),
        }),
    ...options.env,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...argv], { cwd, env });
    const chunks: string[] = [];
    const out: string[] = [];
    const err: string[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString("utf8"));
      out.push(chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString("utf8"));
      err.push(chunk.toString("utf8"));
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      rmSync(scratch, { recursive: true, force: true });
      reject(error);
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      const connects = existsSync(connectLog)
        ? readFileSync(connectLog, "utf8")
            .split("\n")
            .filter((line) => line !== "")
        : [];
      rmSync(scratch, { recursive: true, force: true });
      resolve({ status, output: chunks.join(""), stdout: out.join(""), stderr: err.join(""), connects });
    });
  });
}
