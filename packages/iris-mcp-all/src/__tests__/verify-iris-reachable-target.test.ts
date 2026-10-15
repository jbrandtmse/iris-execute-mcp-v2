/**
 * Story 38.0 (ledger DW-388, AC-7) - `scripts/verify-iris-reachable.mjs` must never let a
 * silent local-dev default loosen a release check.
 *
 * Two layers, both in the DEFAULT suite:
 *
 *  1. `resolveIrisTarget` (the pure core in `scripts/lib/iris-target.mjs`) - which variables
 *     fall back, what the fallback values are, and when CI turns the fallback into a refusal.
 *     The script itself is top-level-await and cannot be imported by a test, so the logic
 *     lives in this module and is single-sourced.
 *  2. Two real processes. The script spawned under `CI=1` with all six IRIS variables removed
 *     must exit 1, name the variables on stderr, and finish long before the script's own 10 s
 *     reachability timeout - proving the refusal happens before any network call. The WARN
 *     path (variables unset, no `CI`) is spawned only with the host and port pointed at a
 *     local port nothing listens on, because that path goes on to probe its target and a
 *     default-suite test must never contact a real instance.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IRIS_TARGET_VARIABLES,
  resolveIrisTarget,
} from "../../../../scripts/lib/iris-target.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "verify-iris-reachable.mjs");

const SIX = ["IRIS_HOST", "IRIS_PORT", "IRIS_USERNAME", "IRIS_PASSWORD", "IRIS_NAMESPACE", "IRIS_HTTPS"];

describe("resolveIrisTarget (Story 38.0, DW-388)", () => {
  it("covers exactly the six connection variables", () => {
    expect([...IRIS_TARGET_VARIABLES]).toEqual(SIX);
  });

  it("with nothing set, defaults all six to the unchanged local-dev values and reports them", () => {
    const result = resolveIrisTarget({});
    expect(result.env).toEqual({
      IRIS_HOST: "localhost",
      IRIS_PORT: "52773",
      IRIS_USERNAME: "_SYSTEM",
      IRIS_PASSWORD: "SYS",
      IRIS_NAMESPACE: "HSCUSTOM",
      IRIS_HTTPS: "false",
    });
    expect(result.defaulted).toEqual(SIX);
    expect(result.ciRefusal).toBeUndefined();
  });

  it("with all six set, passes them through and reports nothing defaulted (the local loop is unchanged)", () => {
    const env = {
      IRIS_HOST: "iris.example.com",
      IRIS_PORT: "1972",
      IRIS_USERNAME: "release",
      IRIS_PASSWORD: "pw",
      IRIS_NAMESPACE: "PROD",
      IRIS_HTTPS: "true",
      CI: "1",
    };
    const result = resolveIrisTarget(env);
    expect(result.env).toEqual({
      IRIS_HOST: "iris.example.com",
      IRIS_PORT: "1972",
      IRIS_USERNAME: "release",
      IRIS_PASSWORD: "pw",
      IRIS_NAMESPACE: "PROD",
      IRIS_HTTPS: "true",
    });
    expect(result.defaulted).toEqual([]);
    expect(result.ciRefusal).toBeUndefined();
  });

  it("names only the variables that were actually left unset", () => {
    const result = resolveIrisTarget({
      IRIS_HOST: "h",
      IRIS_USERNAME: "u",
      IRIS_PASSWORD: "p",
      IRIS_HTTPS: "false",
    });
    expect(result.defaulted).toEqual(["IRIS_PORT", "IRIS_NAMESPACE"]);
    expect(result.env.IRIS_PORT).toBe("52773");
    expect(result.env.IRIS_NAMESPACE).toBe("HSCUSTOM");
    expect(result.env.IRIS_HOST).toBe("h");
  });

  it("keeps the IRIS_NAMESPACE fallback at HSCUSTOM (independent of the suite's own USER default)", () => {
    expect(resolveIrisTarget({}).env.IRIS_NAMESPACE).toBe("HSCUSTOM");
  });

  it("treats an empty string as a value the operator set (not defaulted)", () => {
    const result = resolveIrisTarget({ IRIS_PASSWORD: "" });
    expect(result.env.IRIS_PASSWORD).toBe("");
    expect(result.defaulted).not.toContain("IRIS_PASSWORD");
  });

  for (const ci of ["1", "true", "TRUE", "yes", "anything", " "]) {
    it(`refuses under CI=${JSON.stringify(ci)}, naming every defaulted variable`, () => {
      const result = resolveIrisTarget({ CI: ci, IRIS_HOST: "h" });
      expect(result.ciRefusal).toBeDefined();
      for (const name of SIX.filter((n) => n !== "IRIS_HOST")) {
        expect(result.ciRefusal).toContain(name);
      }
      expect(result.ciRefusal).not.toContain("IRIS_HOST");
    });
  }

  for (const ci of [undefined, "", "0", "false", "FALSE", "False"]) {
    it(`does not refuse when CI is ${JSON.stringify(ci)} (the WARN path applies instead)`, () => {
      const env: Record<string, string | undefined> = ci === undefined ? {} : { CI: ci };
      const result = resolveIrisTarget(env);
      expect(result.ciRefusal).toBeUndefined();
      expect(result.defaulted).toEqual(SIX);
    });
  }

  it("a CI run with every variable set is not refused", () => {
    const env = Object.fromEntries(SIX.map((name) => [name, "x"]));
    expect(resolveIrisTarget({ ...env, CI: "1" }).ciRefusal).toBeUndefined();
  });
});

describe("scripts/verify-iris-reachable.mjs as a process (Story 38.0, DW-388, AC-7)", () => {
  it("exits 1 naming the six unset variables, before the dist check and any network call", () => {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string" && !key.startsWith("IRIS_")) env[key] = value;
    }
    env.CI = "1";

    const startedAt = Date.now();
    const result = spawnSync(process.execPath, [SCRIPT], {
      env,
      encoding: "utf8",
      timeout: 8_000,
      cwd: REPO_ROOT,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    for (const name of SIX) {
      expect(result.stderr).toContain(name);
    }
    expect(result.stderr).toContain("FAILED CLOSED");
    // The script's own reachability timeout is 10 s; a refusal that never reaches the
    // network finishes in a fraction of that.
    expect(elapsedMs).toBeLessThan(5_000);
    // Nothing was reported as checked or reachable: the refusal came before the dist
    // check (which prints one of these two lines) and before the reachability probe.
    expect(result.stdout).not.toContain("Checking IRIS reachability");
    expect(result.stdout).not.toContain("is present and fresh");
    expect(result.stdout).not.toContain("build-freshness check skipped");
  });

  // The warn path (variables unset, no CI) proceeds to probe the target, so this case points
  // it at a port nothing listens on: the probe is refused at once, locally, and no real
  // instance is ever contacted. Whatever stops the run after the warning (an unreachable
  // target, or a build that is not fresh), the warning itself was printed first.
  it("warns on stderr, naming exactly the variables left unset, when CI is not set", async () => {
    const closedPort = await new Promise<number>((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const port = typeof address === "object" && address !== null ? address.port : 0;
        probe.close(() => resolve(port));
      });
    });
    expect(closedPort).toBeGreaterThan(0);

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string" && !key.startsWith("IRIS_") && key !== "CI") env[key] = value;
    }
    env.IRIS_HOST = "127.0.0.1";
    env.IRIS_PORT = String(closedPort);
    env.IRIS_USERNAME = "release-check";
    env.IRIS_PASSWORD = "not-a-real-password";
    // IRIS_NAMESPACE and IRIS_HTTPS stay unset: exactly these two fall back.

    const result = spawnSync(process.execPath, [SCRIPT], {
      env,
      encoding: "utf8",
      timeout: 8_000,
      cwd: REPO_ROOT,
    });

    expect(result.error).toBeUndefined();
    const warnLines = result.stderr.split("\n").filter((line) => line.includes("[WARN]"));
    expect(warnLines).toHaveLength(1);
    expect(warnLines[0]).toContain("IRIS_NAMESPACE, IRIS_HTTPS");
    for (const set of ["IRIS_HOST", "IRIS_PORT", "IRIS_USERNAME", "IRIS_PASSWORD"]) {
      expect(warnLines[0]).not.toContain(set);
    }
    // Nothing listens on that port, so the run cannot succeed.
    expect(result.status).toBe(1);
  }, 15_000);
});
