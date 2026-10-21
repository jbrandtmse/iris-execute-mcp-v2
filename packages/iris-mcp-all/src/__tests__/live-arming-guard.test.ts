/**
 * Story 42.2 (DW-627, DW-518; decision #51) - a plain `pnpm test` touches no IRIS instance.
 *
 * Every test leg that can reach IRIS is armed by `IRIS_REQUIRE_LIVE` (`1` or `true`) and by nothing else, and an armed leg takes
 * its target from the five `IRIS_*` variables, none defaulted (`@iris-mcp/shared/test-helpers/live-target`). This file pins that:
 *
 *  (a) STATIC SCAN. No test source of the workspace or of the launcher reads `process.env.IRIS_(TEST_)?(HOST|PORT|USERNAME|PASSWORD|NAMESPACE)`
 *      with a `??` or `||` default, and none names the retired `IRIS_TEST_(HOST|PORT|USERNAME|PASSWORD|NAMESPACE)` variables.
 *  (b) BEHAVIORAL RUN. Every live-capable test file (at least 63 on 2026-10-21), grouped by package, runs in a child `vitest run` with
 *      no `IRIS_*` variable in its environment, under a preload that refuses and logs every connect to port 52773 or 1972 (and to the
 *      inert host of an unarmed leg). Each child exits 0 and its connect log is empty. The integration files run through the package's
 *      `vitest.integration.config.ts`.
 *  (c) CONTROL. A control test connects to a stand-in listener whose port the preload watches: the connect is logged and never reaches
 *      the listener. The same control without the preload reaches the listener and logs nothing, so the oracle of (b) can tell the two apart.
 *  (d) HELPER TABLE. `resolveLiveTarget`, `isLiveArmed` and `liveGateTarget` over an empty environment, `IRIS_REQUIRE_LIVE` alone,
 *      `IRIS_HOST` alone, and all five variables.
 *
 * The launcher's two live files run in `extensions/iris-mcp-launcher/src/__tests__/live-arming-guard.test.ts`. No IRIS is reached here.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runVitestUnderPreload } from "./live-gate-child-run.js";
import {
  UNARMED_LIVE_TARGET,
  isLiveArmed,
  liveConnectionEnv,
  liveGateTarget,
  resolveLiveTarget,
} from "../../../shared/src/test-helpers/live-target.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");
const LAUNCHER_DIR = path.join(REPO_ROOT, "extensions", "iris-mcp-launcher");

/** The two guard files: they name the patterns they scan for. */
const GUARD_FILES = [
  "packages/iris-mcp-all/src/__tests__/live-arming-guard.test.ts",
  "extensions/iris-mcp-launcher/src/__tests__/live-arming-guard.test.ts",
];

/** A read of a target variable with a default. */
const DEFAULTED_READ =
  /process\.env(?:\.|\[\s*["'])IRIS_(?:TEST_)?(?:HOST|PORT|USERNAME|PASSWORD|NAMESPACE)(?:["']\s*\])?\s*(?:\?\?|\|\|)/;

/** A retired target variable, by name. `IRIS_TEST_TIMEOUT` is a product variable and is not one. */
const RETIRED_NAME = /\bIRIS_TEST_(?:HOST|PORT|USERNAME|PASSWORD|NAMESPACE)\b/;

/** A test file that can reach IRIS: it resolves a live target or an integration config, or it reads the availability flag. */
const LIVE_CAPABLE =
  /process\.env\.IRIS_(?:TEST_)?HOST\s*\?\?|\birisTargetFromEnv\(|\bliveGateTarget\(|\bliveArmingSkipReason\(|\bresolveLiveTarget\(|\bgetIntegrationConfig\(|__IRIS_AVAILABLE__/;

const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git", "coverage"]);

/** Every file under `dir` whose extension is one of `extensions`. */
function walk(dir: string, extensions: readonly string[]): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full, extensions));
    else if (extensions.some((extension) => entry.endsWith(extension))) found.push(full);
  }
  return found;
}

const relative = (file: string): string => path.relative(REPO_ROOT, file).split(path.sep).join("/");

const packageNames = readdirSync(PACKAGES_DIR).filter((name) => existsSync(path.join(PACKAGES_DIR, name, "package.json")));

/** Test sources: every `.test.ts` and every `.ts` or `.mjs` helper under a `__tests__` or `test-helpers` directory. */
function testSources(): string[] {
  const roots = [
    ...packageNames.flatMap((name) => [path.join(PACKAGES_DIR, name, "src"), path.join(PACKAGES_DIR, name, "tests")]),
    path.join(LAUNCHER_DIR, "src"),
  ];
  return roots
    .flatMap((root) => walk(root, [".ts", ".mts", ".mjs"]))
    .filter((file) => {
      const rel = relative(file);
      return /(^|\/)(__tests__|test-helpers)\//.test(rel) || rel.endsWith(".test.ts");
    })
    .filter((file) => !GUARD_FILES.includes(relative(file)))
    .sort();
}

const sources = testSources();
const readSource = (file: string): string => readFileSync(file, "utf8");

describe("(a) static scan: no test source defaults a live target or names a retired variable (DW-627)", () => {
  it("finds the test sources at all (an empty scan would pass every case below vacuously)", () => {
    expect(sources.length).toBeGreaterThan(300);
    for (const name of ["shared", "iris-dev-mcp", "iris-admin-mcp", "iris-data-mcp", "iris-interop-mcp", "iris-ops-mcp", "iris-mcp-all"]) {
      expect(packageNames, name).toContain(name);
    }
    const rels = sources.map(relative);
    expect(rels, "the launcher's tests are scanned").toContain("extensions/iris-mcp-launcher/src/__tests__/localSpawnIntegration.test.ts");
    expect(rels, "the shared test helpers are scanned").toContain("packages/shared/src/test-helpers/live-target.ts");
  });

  it("no test source reads process.env.IRIS_(TEST_)?(HOST|PORT|USERNAME|PASSWORD|NAMESPACE) with a ?? or || default", () => {
    const offenders = sources.filter((file) => DEFAULTED_READ.test(readSource(file))).map(relative);
    expect(offenders, "a live target is never defaulted: resolve it through @iris-mcp/shared/test-helpers/live-target").toEqual([]);
  });

  it("no test source names IRIS_TEST_(HOST|PORT|USERNAME|PASSWORD|NAMESPACE)", () => {
    const offenders = sources.filter((file) => RETIRED_NAME.test(readSource(file))).map(relative);
    expect(offenders, "the IRIS_TEST_* target variables are retired: use IRIS_*").toEqual([]);
  });

  it("the detectors fire on what they exist to catch and stay quiet on what they must not", () => {
    for (const bad of [
      'const host = process.env.IRIS_HOST ?? "localhost";',
      'const port = process.env["IRIS_PORT"] || 52773;',
      "const user = process.env.IRIS_TEST_USERNAME ?? '_SYSTEM';",
      'process.env.IRIS_PASSWORD   ??   "SYS"',
      'process.env[ "IRIS_USERNAME" ] ?? "_SYSTEM"',
    ]) {
      expect(DEFAULTED_READ.test(bad), bad).toBe(true);
    }
    for (const fine of [
      "const host = process.env.IRIS_HOST;",
      'const armed = process.env.IRIS_REQUIRE_LIVE ?? "";',
      'const timeout = process.env.IRIS_TEST_TIMEOUT ?? "120";',
      'env["IRIS_HOST"] = "127.0.0.1";',
      'IRIS_HOST: target.host ?? "x"',
    ]) {
      expect(DEFAULTED_READ.test(fine), fine).toBe(false);
    }
    for (const retired of ["IRIS_TEST_HOST", "process.env.IRIS_TEST_NAMESPACE", "`IRIS_TEST_PASSWORD`"]) {
      expect(RETIRED_NAME.test(retired), retired).toBe(true);
    }
    for (const fine of ["IRIS_TEST_TIMEOUT", "IRIS_TEST_HOSTILE", "MY_IRIS_TEST_HOST_X"]) {
      expect(RETIRED_NAME.test(fine), fine).toBe(false);
    }
  });
});

/** The live-capable test files, as absolute paths. */
const liveCapable = sources.filter((file) => file.endsWith(".test.ts") && LIVE_CAPABLE.test(readSource(file)));

describe("(b) behavioral run: every live-capable test file, with no arming variable, connects to nothing (DW-627)", () => {
  it("the scan finds at least 63 live-capable files, across the packages and the launcher", () => {
    expect(liveCapable.length).toBeGreaterThanOrEqual(63);
    const owners = new Set(liveCapable.map((file) => relative(file).split("/").slice(0, 2).join("/")));
    for (const owner of [
      "packages/shared",
      "packages/iris-dev-mcp",
      "packages/iris-admin-mcp",
      "packages/iris-data-mcp",
      "packages/iris-interop-mcp",
      "packages/iris-ops-mcp",
      "packages/iris-mcp-all",
      "extensions/iris-mcp-launcher",
    ]) {
      expect(owners, owner).toContain(owner);
    }
  });

  const byPackage = new Map<string, string[]>();
  for (const file of liveCapable) {
    const rel = relative(file);
    if (!rel.startsWith("packages/")) continue;
    const owner = rel.split("/")[1] as string;
    byPackage.set(owner, [...(byPackage.get(owner) ?? []), file]);
  }

  /** The number N of "Test Files  ... (N)" in a vitest summary, or -1. */
  const filesRun = (output: string): number => Number(/Test Files[^\n]*\((\d+)\)/.exec(output)?.[1] ?? -1);

  for (const [owner, files] of [...byPackage.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const packageDir = path.join(PACKAGES_DIR, owner);
    const defaultFiles = files.filter((file) => !file.endsWith(".integration.test.ts"));
    const integrationFiles = files.filter((file) => file.endsWith(".integration.test.ts"));

    if (defaultFiles.length > 0) {
      it(`${owner}: its ${defaultFiles.length} default-suite live-capable files pass and connect to nothing`, async () => {
        const run = await runVitestUnderPreload({
          packageDir,
          args: defaultFiles.map((file) => path.relative(packageDir, file).split(path.sep).join("/")),
          timeoutMs: 520_000,
        });

        expect(run.status, run.output.slice(-3000)).toBe(0);
        expect(run.connects, "connects the preload refused").toEqual([]);
        expect(filesRun(run.output), "every listed file ran").toBe(defaultFiles.length);
      }, 540_000);
    }

    if (integrationFiles.length > 0) {
      it(`${owner}: its integration files (vitest.integration.config.ts) skip and connect to nothing`, async () => {
        const run = await runVitestUnderPreload({
          packageDir,
          args: ["--config", "vitest.integration.config.ts"],
          timeoutMs: 300_000,
        });

        expect(run.status, run.output.slice(-3000)).toBe(0);
        expect(run.connects, "connects the preload refused").toEqual([]);
        expect(filesRun(run.output), "the integration files ran").toBeGreaterThanOrEqual(integrationFiles.length);
      }, 320_000);
    }
  }
});

describe("(c) control: the connect log and the preload can tell a run that connects from one that does not", () => {
  const controlFile = "src/__tests__/fixtures/live-arming-control.control.ts";
  const packageDir = path.join(PACKAGES_DIR, "iris-mcp-all");

  /** Run the control test against a stand-in HTTP listener; report what the run logged and what the listener saw. */
  async function runControl(withoutPreload: boolean): Promise<{ output: string; connects: string[]; reached: number; status: number | null }> {
    const scratch = mkdtempSync(path.join(tmpdir(), "mcp-arming-control-"));
    let reached = 0;
    const standIn = http.createServer((_request, response) => {
      reached += 1;
      response.end("ok");
    });
    await new Promise<void>((resolve) => standIn.listen(0, "127.0.0.1", resolve));
    try {
      const port = String((standIn.address() as AddressInfo).port);
      const config = path.join(scratch, "vitest.control.config.mjs");
      writeFileSync(
        config,
        `export default { test: { environment: "node", globals: true, include: [${JSON.stringify(controlFile)}] } };\n`,
      );
      const run = await runVitestUnderPreload({
        packageDir,
        args: ["--config", config, "--root", packageDir],
        watchPorts: [port],
        env: { LIVE_ARMING_CONTROL_PORT: port },
        withoutPreload,
        timeoutMs: 120_000,
      });
      return { output: run.output, connects: run.connects, reached, status: run.status };
    } finally {
      await new Promise<void>((resolve) => standIn.close(() => resolve()));
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  it("under the preload, a connect to a watched port is refused, logged, and never reaches the listener", async () => {
    const run = await runControl(false);

    expect(run.status, run.output.slice(-2000)).toBe(0);
    expect(run.output).toContain("LIVE_ARMING_CONTROL refused");
    expect(run.connects.length, "the refused connect is in the log").toBeGreaterThanOrEqual(1);
    expect(run.connects.every((line) => line.startsWith("127.0.0.1:"))).toBe(true);
    expect(run.reached, "the listener saw nothing").toBe(0);
  }, 150_000);

  it("without the preload, the same connect reaches the listener and nothing is logged (so an empty log means something)", async () => {
    const run = await runControl(true);

    expect(run.status, run.output.slice(-2000)).toBe(0);
    expect(run.output).toContain("LIVE_ARMING_CONTROL reached");
    expect(run.connects).toEqual([]);
    expect(run.reached).toBe(1);
  }, 150_000);
});

describe("(d) the arming helper: resolveLiveTarget, isLiveArmed and liveGateTarget (DW-627, decision #51)", () => {
  const FIVE = {
    IRIS_HOST: "iris.example.test",
    IRIS_PORT: "52780",
    IRIS_USERNAME: "tester",
    IRIS_PASSWORD: "secret-pass",
    IRIS_NAMESPACE: "SCRATCH",
  };

  it("an empty environment is not armed, and the reason says how to arm", () => {
    const resolution = resolveLiveTarget({});

    expect(resolution.armed).toBe(false);
    expect(resolution.armed === false && resolution.reason).toContain("IRIS_REQUIRE_LIVE=1");
    expect(isLiveArmed({})).toBe(false);
  });

  it("IRIS_HOST alone does not arm, nor do all five variables without IRIS_REQUIRE_LIVE", () => {
    expect(resolveLiveTarget({ IRIS_HOST: "iris.example.test" }).armed).toBe(false);
    expect(resolveLiveTarget(FIVE).armed).toBe(false);
    expect(liveGateTarget(FIVE).skipReason).toContain("IRIS_REQUIRE_LIVE");
  });

  it.each([
    ["0", false],
    ["", false],
    ["yes", false],
    ["TRUE", false],
    ["True", false],
    [" 1", false],
    ["1", true],
    ["true", true],
  ])("IRIS_REQUIRE_LIVE=%j arms: %s", (value, armed) => {
    expect(isLiveArmed({ IRIS_REQUIRE_LIVE: value })).toBe(armed);
  });

  it("IRIS_REQUIRE_LIVE alone is armed with nothing to target: it throws, naming all five variables", () => {
    expect(() => resolveLiveTarget({ IRIS_REQUIRE_LIVE: "1" })).toThrow(
      /IRIS_HOST, IRIS_PORT, IRIS_USERNAME, IRIS_PASSWORD, IRIS_NAMESPACE are not set/,
    );
    expect(() => liveGateTarget({ IRIS_REQUIRE_LIVE: "true" })).toThrow(/IRIS_HOST, IRIS_PORT, IRIS_USERNAME, IRIS_PASSWORD, IRIS_NAMESPACE/);
  });

  it.each(Object.keys(FIVE))("armed without %s: it throws, naming exactly that variable", (missing) => {
    const env: Record<string, string> = { IRIS_REQUIRE_LIVE: "1", ...FIVE };
    delete env[missing];

    expect(() => resolveLiveTarget(env)).toThrow(new RegExp(`but ${missing} is not set\\.`));
  });

  it("an empty-string target variable counts as missing", () => {
    expect(() => resolveLiveTarget({ IRIS_REQUIRE_LIVE: "1", ...FIVE, IRIS_PASSWORD: "" })).toThrow(/IRIS_PASSWORD is not set/);
  });

  it("armed with all five: the target is exactly those values, https is off unless IRIS_HTTPS is true, and requireLive is true", () => {
    const resolution = resolveLiveTarget({ IRIS_REQUIRE_LIVE: "1", ...FIVE });

    expect(resolution).toEqual({
      armed: true,
      requireLive: true,
      target: {
        host: "iris.example.test",
        port: "52780",
        username: "tester",
        password: "secret-pass",
        namespace: "SCRATCH",
        https: false,
      },
    });
    const secure = resolveLiveTarget({ IRIS_REQUIRE_LIVE: "true", ...FIVE, IRIS_HTTPS: "true" });
    expect(secure.armed && secure.target.https).toBe(true);
    expect(liveGateTarget({ IRIS_REQUIRE_LIVE: "1", ...FIVE }).skipReason).toBeUndefined();
  });

  it("liveConnectionEnv returns the six IRIS_* settings of a target", () => {
    const resolution = resolveLiveTarget({ IRIS_REQUIRE_LIVE: "1", ...FIVE, IRIS_HTTPS: "true" });
    if (!resolution.armed) throw new Error("armed expected");

    expect(liveConnectionEnv(resolution.target)).toEqual({ ...FIVE, IRIS_HTTPS: "true" });
  });

  it("unarmed, the gate's target is the inert one: an invalid host that never resolves, and it is not any IRIS default", () => {
    const gate = liveGateTarget({});

    expect(gate.target).toEqual(UNARMED_LIVE_TARGET);
    expect(gate.target.host.endsWith(".invalid")).toBe(true);
    expect(gate.target.port).not.toBe("52773");
    expect(gate.target.port).not.toBe("1972");
    expect(gate.skipReason).toBeDefined();
  });
});
