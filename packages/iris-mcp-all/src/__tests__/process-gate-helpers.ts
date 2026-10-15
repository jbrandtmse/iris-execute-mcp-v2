/**
 * Shared helpers for the process-level gates in this package: each launches a
 * BUILT server entry point in a fresh Node process and observes how it exits.
 */

import { spawn } from "node:child_process";

/**
 * The test runner's environment for a spawned server: everything it inherits
 * (PATH, and SystemRoot on Windows), minus every variable that configures the
 * suite -- each `IRIS_*` key and `MCP_TRANSPORT` -- and minus each name in
 * `alsoDrop`. Names match case-insensitively, as Windows treats them, so an
 * ambient lowercase `iris_host` is dropped too. A gate layers its own explicit
 * values on top of the result.
 *
 * @param alsoDrop - Further variable names to drop (case-insensitive).
 */
export function inheritedEnv(alsoDrop: readonly string[] = []): Record<string, string> {
  const dropped = new Set(["MCP_TRANSPORT", ...alsoDrop.map((name) => name.toUpperCase())]);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    const upper = key.toUpperCase();
    if (upper.startsWith("IRIS_") || dropped.has(upper)) continue;
    env[key] = value;
  }
  return env;
}

/** How a spawned server process ended. */
export interface SpawnOutcome {
  /** Exit code, or `null` when the process was killed at the timeout. */
  code: number | null;
  /** Everything the process wrote to stderr. */
  stderr: string;
  /** `true` when the process was still alive at the timeout and was killed. */
  timedOut: boolean;
}

/**
 * Spawn a built server entry point directly (no MCP handshake) and wait for it
 * to EXIT on its own -- the shape of a startup failure (the entry point prints
 * "Fatal:" plus the error and exits 1). stdin and stdout are ignored; stderr
 * is collected, and the outcome resolves only once stderr has been read to its
 * end. A process still alive at `timeoutMs` is killed with SIGKILL
 * and reported as `timedOut`, which a fail-fast assertion treats as failure:
 * a violation that does NOT stop startup is exactly the regression such a gate
 * pins.
 *
 * @param entryPoint - Absolute path of the built `index.js` to launch.
 * @param args - Extra command-line arguments passed after the entry point.
 * @param env - The complete child environment (nothing is inherited).
 * @param timeoutMs - Milliseconds to wait before killing the process.
 * @param cwd - Working directory of the child; the parent's when omitted.
 */
export function spawnAndWaitForExit(
  entryPoint: string,
  args: readonly string[],
  env: Record<string, string>,
  timeoutMs: number,
  cwd?: string,
): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entryPoint, ...args], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
      ...(cwd !== undefined ? { cwd } : {}),
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: null, stderr, timedOut: true });
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, timedOut: false });
    });
  });
}
