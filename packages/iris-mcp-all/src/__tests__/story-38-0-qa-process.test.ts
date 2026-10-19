/**
 * Story 38.0 - process-level proofs for two user-facing behaviors that the story's own tests pin
 * only at their pure core or against mocks. Both run real child processes against local listeners
 * this file opens itself; no IRIS instance is ever contacted.
 *
 *  1. DW-388 / AC-7 - `scripts/verify-iris-reachable.mjs`. The existing process tests cover the CI
 *     refusal and the `[WARN]` line. What they cannot show is the other half of the contract: that
 *     the refusal happens before ANY network call (here: a stub that counts requests sees none, an
 *     assertion independent of how fast the machine is), that a fully specified target is never
 *     refused or warned about even under CI, and that the warn path then proceeds to probe the
 *     target as it did before the change (the stub sees the probe, and answers 200 so the script
 *     exits 0).
 *  2. DW-523 / AC-12 - the startup log of the BUILT `iris-dev-mcp` server. A health-check failure is
 *     logged with the `IRIS health check failed:` prefix exactly once for both shapes IRIS can
 *     produce at startup: a connection error (unprefixed) and an HTTP 401 (already prefixed by
 *     `checkHealth`). The 401 comes from a real HTTP listener answering every request with 401.
 *
 * Placement (Rule #45): `@iris-mcp/all` is the only package that depends on every server's built
 * dist. The server legs need a fresh `shared` and `iris-dev-mcp` dist: a missing or stale one skips
 * with the reason, or fails when `IRIS_REQUIRE_LIVE` is armed (the disposition of the epic gates).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDistFresh } from "../../../../scripts/lib/dist-freshness.mjs";
import { inheritedEnv } from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const VERIFY_SCRIPT = path.join(REPO_ROOT, "scripts", "verify-iris-reachable.mjs");
const DEV_ENTRY = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const SIX = ["IRIS_HOST", "IRIS_PORT", "IRIS_USERNAME", "IRIS_PASSWORD", "IRIS_NAMESPACE", "IRIS_HTTPS"];

/** The parent environment with every IRIS_* variable, MCP_TRANSPORT and CI removed, so nothing leaks into a child. */
function cleanEnv(): Record<string, string> {
  return inheritedEnv(["CI"]);
}

interface Stub {
  port: number;
  requests: string[];
  close: () => Promise<void>;
}

/** A local HTTP listener answering every request with `status`, recording `METHOD path` lines. */
async function startStub(status: number): Promise<Stub> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.statusCode = status;
    if (status === 401) res.setHeader("WWW-Authenticate", 'Basic realm="IRIS"');
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A local port nothing listens on (bound and released), so a connection is refused at once. */
async function closedPort(): Promise<number> {
  const stub = await startStub(200);
  const { port } = stub;
  await stub.close();
  return port;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run a script to completion (asynchronously, so a stub in this process can answer it). */
function runToExit(args: string[], env: Record<string, string>, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${args.join(" ")} did not exit within ${timeoutMs} ms.\nstderr: ${stderr}`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

describe("scripts/verify-iris-reachable.mjs against a local stub (Story 38.0, DW-388, AC-7)", () => {
  function targetEnv(port: number, overrides: Record<string, string | undefined> = {}): Record<string, string> {
    const env = {
      ...cleanEnv(),
      IRIS_HOST: "127.0.0.1",
      IRIS_PORT: String(port),
      IRIS_USERNAME: "release-check",
      IRIS_PASSWORD: "not-a-real-password",
      IRIS_NAMESPACE: "USER",
      IRIS_HTTPS: "false",
    };
    const merged: Record<string, string> = { ...env };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete merged[key];
      else merged[key] = value;
    }
    return merged;
  }

  it("under CI, a target with only IRIS_NAMESPACE unset is refused naming it, and the stub sees no request", async () => {
    const stub = await startStub(200);
    try {
      const result = await runToExit(
        [VERIFY_SCRIPT],
        targetEnv(stub.port, { CI: "true", IRIS_NAMESPACE: undefined }),
        20_000,
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("FAILED CLOSED");
      expect(result.stderr).toContain("IRIS_NAMESPACE");
      for (const set of SIX.filter((name) => name !== "IRIS_NAMESPACE")) {
        expect(result.stderr, `${set} was set and must not be named`).not.toContain(set);
      }
      expect(result.stdout).not.toContain("Checking IRIS reachability");
      expect(stub.requests, "the refusal happened before any network call").toEqual([]);
    } finally {
      await stub.close();
    }
  }, 30_000);

  for (const ci of ["1", "true", undefined]) {
    it(`with all six variables set and CI=${JSON.stringify(ci)}, probes the target, prints no warning and exits 0`, async () => {
      const stub = await startStub(200);
      try {
        const result = await runToExit([VERIFY_SCRIPT], targetEnv(stub.port, { CI: ci }), 20_000);

        expect(result.stderr).not.toContain("[WARN]");
        expect(result.stderr).not.toContain("FAILED CLOSED");
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(`IRIS reachable at http://127.0.0.1:${stub.port}`);
        expect(stub.requests.some((line) => line.startsWith("HEAD /api/atelier/"))).toBe(true);
      } finally {
        await stub.close();
      }
    }, 30_000);
  }

  it("without CI, an unset variable warns once and the run still probes the target and succeeds", async () => {
    const stub = await startStub(200);
    try {
      const result = await runToExit(
        [VERIFY_SCRIPT],
        targetEnv(stub.port, { IRIS_NAMESPACE: undefined, IRIS_HTTPS: undefined }),
        20_000,
      );

      const warnLines = result.stderr.split("\n").filter((line) => line.includes("[WARN]"));
      expect(warnLines).toHaveLength(1);
      expect(warnLines[0]).toContain("IRIS_NAMESPACE, IRIS_HTTPS");
      expect(result.status).toBe(0);
      expect(stub.requests.some((line) => line.startsWith("HEAD /api/atelier/"))).toBe(true);
    } finally {
      await stub.close();
    }
  }, 30_000);
});

describe("built iris-dev-mcp startup log (Story 38.0, DW-523, AC-12)", () => {
  let skipReason: string | undefined;

  beforeAll(() => {
    for (const pkg of ["shared", "iris-dev-mcp"]) {
      const fresh = checkDistFresh(path.join(REPO_ROOT, "packages", pkg), pkg);
      if (!fresh.ok || fresh.skipped) {
        skipReason =
          fresh.reason ?? `${pkg} declares no dist/ build output, but this test spawns its built dist.`;
        break;
      }
    }
    if (skipReason && REQUIRE_LIVE) {
      throw new Error(`IRIS_REQUIRE_LIVE is set, so this test may not be skipped: ${skipReason}`);
    }
  });

  /** Start the built server at `port`, wait for it to finish startup, stop it, return its stderr. */
  function startServerAndCaptureLog(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = {
        ...cleanEnv(),
        IRIS_HOST: "127.0.0.1",
        IRIS_PORT: String(port),
        IRIS_USERNAME: "story380-qa",
        IRIS_PASSWORD: "not-a-real-password",
        IRIS_NAMESPACE: "USER",
        IRIS_HTTPS: "false",
      };
      const child = spawn(process.execPath, [DEV_ENTRY], { env, cwd: REPO_ROOT, stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      let stopping = false;
      const stop = () => {
        if (!stopping) {
          stopping = true;
          child.kill("SIGTERM");
        }
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`The server did not finish startup within 20 s.\nstderr so far:\n${stderr}`));
      }, 20_000);
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
        if (stderr.includes("Connected via stdio transport")) stop();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", () => {
        clearTimeout(timer);
        resolve(stderr);
      });
    });
  }

  function healthFailureLines(log: string): string[] {
    return log.split("\n").filter((line) => line.includes("IRIS health check failed"));
  }

  it("a connection error is logged with the prefix exactly once, and the startup still completes", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const port = await closedPort();

    const log = await startServerAndCaptureLog(port);

    const lines = healthFailureLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.split("IRIS health check failed:")).toHaveLength(2);
    expect(lines[0]).toContain(`127.0.0.1:${port}`);
    expect(log).toContain("Continuing startup without the");
    expect(log).toContain("Connected via stdio transport");
  }, 40_000);

  it("an HTTP 401 on the health probe is logged with the prefix exactly once (it is already prefixed by checkHealth)", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const stub = await startStub(401);
    try {
      const log = await startServerAndCaptureLog(stub.port);

      const lines = healthFailureLines(log);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.split("IRIS health check failed:")).toHaveLength(2);
      expect(lines[0]).toContain("HTTP 401");
      expect(log).toContain("Continuing startup without the");
      expect(log).toContain("Connected via stdio transport");
      expect(stub.requests.some((line) => line.startsWith("HEAD /api/atelier/"))).toBe(true);
    } finally {
      await stub.close();
    }
  }, 40_000);
});
