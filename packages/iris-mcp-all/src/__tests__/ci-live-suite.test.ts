/**
 * Story 42.3 (DW-676; AC 42.3.2) -- `scripts/ci-live-suite.mjs`, the wrapper that fails an armed suite in which a test skipped.
 *
 *  1. CLASSIFICATION over REAL reports. `classifyVitestReport` is run over reports that a child `vitest run --reporter=json`
 *     writes at test time over tiny fixture files (a passing test, an `it.skip`, a `ctx.skip()`, an `it.todo`, a file with no
 *     test): the oracle is vitest's own report, not a hand-written one (Rule #36).
 *  2. THE WRAPPER with its spawn stood in for: the refusal rows (nothing is spawned), the exit-code rule, the argument it
 *     appends, the missing report.
 *  3. THE GATES' FORWARDING (AC 42.3.5). Each of the four `scripts/prepublish-gate.mjs` is run with a stand-in `pnpm` that records its
 *     arguments: the reporter arguments reach `vitest run` after the gate files, and with no argument the run is what it was.
 *  4. THE REAL PATH (Rule #59). `node scripts/ci-live-suite.mjs integration-admin` with a harness-shaped throwaway environment
 *     aimed at a closed loopback port, under the connect-refusing preload. The admin setup cannot reach IRIS, so vitest exits 0
 *     with every test skipped; the wrapper must exit 1 and name those tests. A wrapper that ignored skips would exit 0.
 *
 * No docker is run and no IRIS is reached: every child connects to nothing, and the connect log is checked.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { classifyVitestReport, runSuite } from "../../../../scripts/ci-live-suite.mjs";
import { LIVE_SUITES } from "../../../../scripts/lib/ci-checks.mjs";
import { REPO_ROOT, readRoster } from "../../../../scripts/lib/live-gate-scan.mjs";
import { runVitestUnderPreload } from "./live-gate-child-run.js";
import { reserveClosedPort } from "./process-gate-helpers.js";

const PACKAGE_DIR = path.join(REPO_ROOT, "packages", "iris-mcp-all");
const SCRIPT = path.join(REPO_ROOT, "scripts", "ci-live-suite.mjs");
const PRELOAD = pathToFileURL(path.join(REPO_ROOT, "scripts", "lib", "no-live-iris-preload.mjs")).href;
const FAKE_THROWAWAY = "iris-mcp-throwaway-0123456789ab";

type Report = Record<string, unknown>;

/** The fixture files of the real-report runs: name to source (vitest globals, no imports). */
const FIXTURES: Record<string, string> = {
  "passing.test.mjs": 'describe("fixture passing", () => { it("passes", () => { expect(1).toBe(1); }); });\n',
  "static-skip.test.mjs": 'describe("fixture static", () => { it.skip("is skipped", () => {}); });\n',
  "context-skip.test.mjs": 'describe("fixture context", () => { it("skips itself", (ctx) => { ctx.skip(); }); });\n',
  "todo.test.mjs": 'describe("fixture todo", () => { it.todo("is a todo"); });\n',
  "empty.test.mjs": "// no test\n",
};

const SKIP_NAMES = {
  static: "fixture static is skipped",
  context: "fixture context skips itself",
  todo: "fixture todo is a todo",
};

let scratch: string;
let allReport: Report;
let emptyOnlyReport: Report;
let passingOnlyReport: Report;

/** Run the fixture files whose names match `filters` in a child vitest and return its JSON report. */
async function realReport(filters: string[], name: string): Promise<Report> {
  const reportFile = path.join(scratch, `${name}.json`);
  const run = await runVitestUnderPreload({
    packageDir: PACKAGE_DIR,
    args: ["--root", scratch, "--config", path.join(scratch, "vitest.config.mjs"), "--reporter=json", `--outputFile.json=${reportFile}`, ...filters],
    timeoutMs: 120_000,
  });
  expect(run.connects, "the fixture runs connect to nothing").toEqual([]);
  expect(existsSync(reportFile), `vitest wrote its report (${run.output.slice(-500)})`).toBe(true);
  return JSON.parse(readFileSync(reportFile, "utf8")) as Report;
}

beforeAll(async () => {
  scratch = mkdtempSync(path.join(tmpdir(), "ci-live-suite-test-"));
  for (const [name, source] of Object.entries(FIXTURES)) writeFileSync(path.join(scratch, name), source, "utf8");
  writeFileSync(path.join(scratch, "vitest.config.mjs"), 'export default { test: { include: ["*.test.mjs"], globals: true, environment: "node" } };\n', "utf8");
  allReport = await realReport([], "all");
  emptyOnlyReport = await realReport(["empty.test.mjs"], "empty-only");
  passingOnlyReport = await realReport(["passing.test.mjs"], "passing-only");
}, 240_000);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const allow = (file: string, test: string) => ({ file, test, reason: "a fixture skip that the test lists on purpose" });
const only = (...names: string[]) => Object.keys(FIXTURES).filter((name) => names.includes(name));

describe("classifyVitestReport over real vitest reports", () => {
  it("the real reports have the statuses the classifier reads (the oracle can vary)", () => {
    const statuses = (allReport["testResults"] as Array<{ name: string; assertionResults: Array<{ status: string; fullName: string }> }>).flatMap((file) =>
      file.assertionResults.map((test) => [path.basename(file.name), test.status, test.fullName]),
    );

    expect(statuses).toContainEqual(["passing.test.mjs", "passed", "fixture passing passes"]);
    expect(statuses).toContainEqual(["static-skip.test.mjs", "skipped", SKIP_NAMES.static]);
    expect(statuses).toContainEqual(["context-skip.test.mjs", "skipped", SKIP_NAMES.context]);
    expect(statuses).toContainEqual(["todo.test.mjs", "todo", SKIP_NAMES.todo]);
    expect((emptyOnlyReport["testResults"] as unknown[]).length).toBe(1);
  });

  it("passes a run in which every expected file ran and nothing skipped", () => {
    expect(classifyVitestReport(passingOnlyReport, { cwd: scratch, expectedFiles: ["passing.test.mjs"], allowedSkips: [] })).toEqual([]);
  });

  it.each([
    ["an it.skip", "static-skip.test.mjs", SKIP_NAMES.static, /unlisted skip \(skipped\): static-skip\.test\.mjs :: fixture static is skipped/],
    ["a ctx.skip()", "context-skip.test.mjs", SKIP_NAMES.context, /unlisted skip \(skipped\): context-skip\.test\.mjs :: fixture context skips itself/],
    ["an it.todo", "todo.test.mjs", SKIP_NAMES.todo, /unlisted skip \(todo\): todo\.test\.mjs :: fixture todo is a todo/],
  ])("fails %s that no allowlist entry names, naming the file and the test", (_label, _file, _name, expected) => {
    const problems = classifyVitestReport(allReport, {
      cwd: scratch,
      expectedFiles: only("passing.test.mjs", "static-skip.test.mjs", "context-skip.test.mjs", "todo.test.mjs"),
      allowedSkips: [],
    });

    expect(problems.join("\n")).toMatch(expected);
  });

  it("lists every offending test at once", () => {
    const problems = classifyVitestReport(allReport, {
      cwd: scratch,
      expectedFiles: only("passing.test.mjs", "static-skip.test.mjs", "context-skip.test.mjs", "todo.test.mjs", "empty.test.mjs"),
      allowedSkips: [],
    });

    expect(problems.filter((problem) => problem.startsWith("unlisted skip")).length).toBe(3);
    expect(problems.some((problem) => /empty\.test\.mjs/.test(problem))).toBe(true);
  });

  it("passes when an entry names each skipped test by its file and full name, with their reasons", () => {
    const allowedSkips = [
      allow("static-skip.test.mjs", SKIP_NAMES.static),
      allow("context-skip.test.mjs", SKIP_NAMES.context),
      allow("todo.test.mjs", SKIP_NAMES.todo),
    ];

    expect(classifyVitestReport(allReport, { cwd: scratch, expectedFiles: only("passing.test.mjs", "static-skip.test.mjs", "context-skip.test.mjs", "todo.test.mjs"), allowedSkips })).toEqual([]);
  });

  it("fails an allowlist entry that names no skipped test of the report as stale", () => {
    const base = [allow("static-skip.test.mjs", SKIP_NAMES.static), allow("context-skip.test.mjs", SKIP_NAMES.context), allow("todo.test.mjs", SKIP_NAMES.todo)];
    const expectedFiles = only("passing.test.mjs", "static-skip.test.mjs", "context-skip.test.mjs", "todo.test.mjs");

    for (const [label, stale] of [
      ["a test that does not exist", allow("passing.test.mjs", "fixture passing no such test")],
      ["a test that now passes", allow("passing.test.mjs", "fixture passing passes")],
      ["a file that is not in the report", allow("missing.test.mjs", SKIP_NAMES.static)],
    ] as Array<[string, ReturnType<typeof allow>]>) {
      const problems = classifyVitestReport(allReport, { cwd: scratch, expectedFiles, allowedSkips: [...base, stale] });

      expect(problems.length, label).toBe(1);
      expect(problems[0], label).toMatch(/^stale allowlist entry/);
    }
  });

  it("matches an entry on the file AND the test: the right name in another file leaves the skip unlisted and the entry stale", () => {
    const problems = classifyVitestReport(allReport, {
      cwd: scratch,
      expectedFiles: only("passing.test.mjs", "static-skip.test.mjs"),
      allowedSkips: [allow("passing.test.mjs", SKIP_NAMES.static)],
    });

    expect(problems.some((problem) => /^unlisted skip \(skipped\): static-skip\.test\.mjs :: fixture static is skipped$/.test(problem))).toBe(true);
    expect(problems.some((problem) => /^stale allowlist entry.*passing\.test\.mjs/.test(problem))).toBe(true);
  });

  it("fails an expected file that is not in the report, and an expected file that holds no test", () => {
    const missing = classifyVitestReport(allReport, { cwd: scratch, expectedFiles: ["passing.test.mjs", "never-ran.test.mjs"], allowedSkips: [] });

    expect(missing.join("\n")).toMatch(/expected test file is not in the report: never-ran\.test\.mjs/);
    expect(classifyVitestReport(allReport, { cwd: scratch, expectedFiles: ["empty.test.mjs"], allowedSkips: [] }).join("\n")).toMatch(/expected test file reported no tests: empty\.test\.mjs/);
  });

  it("fails a report that holds 0 tests", () => {
    const problems = classifyVitestReport(emptyOnlyReport, { cwd: scratch, expectedFiles: ["empty.test.mjs"], allowedSkips: [] });

    expect(problems.join("\n")).toMatch(/the report holds 0 tests/);
  });

  it.each([
    ["null", null],
    ["an empty object", {}],
    ["a report whose testResults is not a list", { testResults: "none" }],
  ])("fails %s as not a vitest report", (_label, report) => {
    expect(classifyVitestReport(report, { cwd: scratch, expectedFiles: [], allowedSkips: [] })).toEqual(["the report is not a vitest JSON report: it has no testResults list."]);
  });

  it("treats a status the classifier does not know as a run test, and every skip-like status as a skip", () => {
    const report = {
      testResults: [
        {
          name: path.join(scratch, "x.test.mjs"),
          assertionResults: [
            { status: "passed", fullName: "a" },
            { status: "failed", fullName: "b" },
            { status: "pending", fullName: "c" },
            { status: "disabled", fullName: "d" },
          ],
        },
      ],
    };

    expect(classifyVitestReport(report, { cwd: scratch, expectedFiles: [], allowedSkips: [] }).map((problem) => problem.replace(/ ::.*/, ""))).toEqual([
      "unlisted skip (pending): x.test.mjs",
      "unlisted skip (disabled): x.test.mjs",
    ]);
  });
});

describe("runSuite with its spawn stood in for", () => {
  const throwawayEnv = {
    IRIS_REQUIRE_LIVE: "1",
    IRIS_THROWAWAY: FAKE_THROWAWAY,
    IRIS_HOST: "127.0.0.1",
    IRIS_PORT: "49153",
    IRIS_USERNAME: "_SYSTEM",
    IRIS_PASSWORD: "SYS",
    IRIS_NAMESPACE: "HSCUSTOM",
    IRIS_HTTPS: "false",
  };

  /** A spawn that records its calls and, when asked, writes the report the suite's command would have written. */
  function recordingSpawn(options: { code?: number; report?: (reportFile: string) => Report | undefined } = {}) {
    const calls: Array<{ argv: string[]; cwd: string }> = [];
    const spawnCommand = async (argv: string[], spawnOptions: { cwd: string }): Promise<number> => {
      calls.push({ argv, cwd: spawnOptions.cwd });
      const reportFile = argv.find((arg) => arg.startsWith("--outputFile.json="))?.slice("--outputFile.json=".length);
      const report = reportFile === undefined ? undefined : options.report?.(reportFile);
      if (reportFile !== undefined && report !== undefined) writeFileSync(reportFile, JSON.stringify(report), "utf8");
      return options.code ?? 0;
    };
    return { calls, spawnCommand };
  }

  /** A passing report for every file the suite expects. */
  const passingReport = (id: string) => (): Report => ({
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: LIVE_SUITES[id].expectedFiles().map((file: string) => ({ name: path.join(REPO_ROOT, file), assertionResults: [{ status: "passed", fullName: "ok" }] })),
  });

  const run = (id: string, env: Record<string, string | undefined>, spawnCommand: unknown) => {
    const logs: string[] = [];
    return runSuite(id, { env, spawnCommand: spawnCommand as never, log: (line: string) => logs.push(line) }).then((code) => ({ code, logs }));
  };

  it.each([
    ["no environment at all", {}],
    ["no arming variable", { ...throwawayEnv, IRIS_REQUIRE_LIVE: undefined }],
    ["IRIS_REQUIRE_LIVE=true", { ...throwawayEnv, IRIS_REQUIRE_LIVE: "true" }],
    ["no IRIS_THROWAWAY", { ...throwawayEnv, IRIS_THROWAWAY: undefined }],
    ["a container name the harness did not generate", { ...throwawayEnv, IRIS_THROWAWAY: "ocupilot-slot-1" }],
    ["the shared instance's container name", { ...throwawayEnv, IRIS_THROWAWAY: "iris-community-edition" }],
    ["another host", { ...throwawayEnv, IRIS_HOST: "prod.example" }],
    ["localhost", { ...throwawayEnv, IRIS_HOST: "localhost" }],
    ["port 52773", { ...throwawayEnv, IRIS_PORT: "52773" }],
    ["port 1972", { ...throwawayEnv, IRIS_PORT: "1972" }],
  ])("refuses %s with exit 2, and spawns nothing", async (_label, env) => {
    for (const id of ["integration-admin", "prepublish-dev", "process-gates", "launcher-live", "prepublish-shared"]) {
      const spawn = recordingSpawn();
      const result = await run(id, env, spawn.spawnCommand);

      expect(result.code, id).toBe(2);
      expect(spawn.calls, id).toEqual([]);
      expect(result.logs.join("\n")).toMatch(/refusing to run/);
    }
  });

  it("refuses an unknown suite id with exit 2, naming the suites", async () => {
    const spawn = recordingSpawn();
    const result = await run("no-such-suite", throwawayEnv, spawn.spawnCommand);

    expect(result.code).toBe(2);
    expect(spawn.calls).toEqual([]);
    expect(result.logs.join("\n")).toMatch(/unknown suite "no-such-suite".*integration-admin/);
  });

  it("does not require a throwaway environment of the two harness suites: they start their own container", async () => {
    const spawn = recordingSpawn({ report: passingReport("bootstrap-guard") });
    const result = await run("bootstrap-guard", {}, spawn.spawnCommand);

    expect(result.code).toBe(0);
    expect(spawn.calls.length).toBe(1);
    const argv = spawn.calls[0]?.argv as string[];
    expect(argv.slice(0, 3)).toEqual(["node", "scripts/throwaway-iris.mjs", "run"]);
    expect(argv).toContain("--host-port");
    expect(argv[argv.indexOf("--host-port") + 1]).toBe("52790");
    expect(argv.slice(-3)[0]).toBe("--reporter=default");
    expect(argv.slice(-2)[0]).toBe("--reporter=json");
    expect(argv[argv.length - 1]).toMatch(/^--outputFile\.json=.*report\.json$/);
    expect(spawn.calls[0]?.cwd).toBe(REPO_ROOT);
  });

  it("runs a suite in its directory and appends the reporter to a vitest suite but not to a plain one", async () => {
    const vitest = recordingSpawn({ report: passingReport("integration-ops") });
    const plain = recordingSpawn();

    expect((await run("integration-ops", throwawayEnv, vitest.spawnCommand)).code).toBe(0);
    expect(vitest.calls[0]?.cwd).toBe(path.join(REPO_ROOT, "packages", "iris-ops-mcp"));
    expect(vitest.calls[0]?.argv.slice(0, 6)).toEqual(["pnpm", "exec", "vitest", "run", "--config", "vitest.integration.config.ts"]);
    expect(vitest.calls[0]?.argv.some((arg) => arg.startsWith("--outputFile.json="))).toBe(true);

    const plainResult = await run("prepublish-ops", throwawayEnv, plain.spawnCommand);
    expect(plainResult.code).toBe(0);
    expect(plain.calls[0]).toEqual({ argv: ["pnpm", "run", "prepublishOnly"], cwd: path.join(REPO_ROOT, "packages", "iris-ops-mcp") });
    expect(plainResult.logs.join("\n"), "the log says the plain suite has no test to skip").toMatch(/prepublish-ops: a plain command with no test report, so no test of it can skip; 0 unlisted skips/);
  });

  it("exits with the command's own code when it is not 0, and still prints the problems", async () => {
    const spawn = recordingSpawn({ code: 3 });
    const result = await run("integration-ops", throwawayEnv, spawn.spawnCommand);

    expect(result.code).toBe(3);
    expect(result.logs.join("\n")).toMatch(/report missing/);
    expect(result.logs.join("\n")).toMatch(/the command exited 3/);
  });

  it("exits 1 when the command exits 0 but the report is missing, and says so", async () => {
    const result = await run("integration-ops", throwawayEnv, recordingSpawn({ code: 0 }).spawnCommand);

    expect(result.code).toBe(1);
    expect(result.logs.join("\n")).toMatch(/report missing: the command wrote no JSON report/);
  });

  it("exits 1 for an expected file that is missing from the report, and 0 once it is there", async () => {
    const withoutFile = recordingSpawn({ report: () => ({ testResults: [{ name: path.join(REPO_ROOT, "elsewhere.test.ts"), assertionResults: [{ status: "passed", fullName: "x" }] }] }) });
    const failed = await run("integration-ops", throwawayEnv, withoutFile.spawnCommand);

    expect(failed.code).toBe(1);
    expect(failed.logs.join("\n")).toMatch(/expected test file is not in the report: packages\/iris-ops-mcp\/src\/__tests__\/ops\.integration\.test\.ts/);
    expect((await run("integration-ops", throwawayEnv, recordingSpawn({ report: passingReport("integration-ops") }).spawnCommand)).code).toBe(0);
  });

  it("exits 1 and names an unlisted skip, and prints a line with 0 unlisted skips for a clean run", async () => {
    const file = LIVE_SUITES["integration-ops"].expectedFiles()[0] as string;
    const skipping = recordingSpawn({ report: () => ({ testResults: [{ name: path.join(REPO_ROOT, file), assertionResults: [{ status: "skipped", fullName: "ops suite leg" }] }] }) });
    const skipped = await run("integration-ops", throwawayEnv, skipping.spawnCommand);

    expect(skipped.code).toBe(1);
    expect(skipped.logs.join("\n")).toMatch(/unlisted skip \(skipped\): packages\/iris-ops-mcp\/src\/__tests__\/ops\.integration\.test\.ts :: ops suite leg/);

    const clean = await run("integration-ops", throwawayEnv, recordingSpawn({ report: passingReport("integration-ops") }).spawnCommand);
    expect(clean.logs.join("\n")).toMatch(/0 unlisted skips \(0 allowlisted\)/);
  });

  it("holds the allowlisted skips of the registry: the capture legs and the two OAuth tests", () => {
    expect(LIVE_SUITES["prepublish-all"].allowedSkips.length).toBe(4);
    expect(LIVE_SUITES["integration-admin"].allowedSkips.length).toBe(2);
    expect(Object.entries(LIVE_SUITES).filter(([, suite]) => suite.allowedSkips.length > 0).map(([id]) => id)).toEqual(["prepublish-all", "integration-admin"]);
  });
});

describe("AC 42.3.5: the four prepublish gates forward their arguments to vitest", () => {
  const GATES = [
    { dir: "iris-admin-mcp", sequential: false },
    { dir: "iris-data-mcp", sequential: false },
    { dir: "iris-dev-mcp", sequential: true },
    { dir: "iris-mcp-all", sequential: true },
  ];
  const REPORTER = ["--reporter=default", "--reporter=json", "--outputFile.json=/virtual/report.json"];

  /** Run a gate with a stand-in `pnpm` first on PATH that records what it was asked to run, and return the recorded calls. */
  function runGate(dir: string, args: string[]): { status: number | null; calls: Array<{ args: string[]; live: string | undefined }> } {
    const bin = path.join(scratch, `fake-pnpm-${dir}-${args.length}`);
    mkdirSync(bin, { recursive: true });
    const log = path.join(bin, "calls.log");
    writeFileSync(
      path.join(bin, "pnpm"),
      `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.FAKE_PNPM_LOG, JSON.stringify({ args: process.argv.slice(2), live: process.env.IRIS_REQUIRE_LIVE }) + "\\n");\n`,
      "utf8",
    );
    chmodSync(path.join(bin, "pnpm"), 0o755);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      const upper = key.toUpperCase();
      if (typeof value === "string" && !upper.startsWith("IRIS_") && !upper.startsWith("VITEST") && upper !== "NODE_OPTIONS") env[key] = value;
    }
    const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "packages", dir, "scripts", "prepublish-gate.mjs"), ...args], {
      cwd: path.join(REPO_ROOT, "packages", dir),
      env: { ...env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, FAKE_PNPM_LOG: log },
      encoding: "utf8",
      timeout: 60_000,
    });
    const calls = existsSync(log)
      ? readFileSync(log, "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as { args: string[]; live: string | undefined })
      : [];
    return { status: result.status, calls };
  }

  it.skipIf(process.platform === "win32").each(GATES)("$dir: the arguments after the script name follow the gate files in the vitest run, and none changes it", ({ dir, sequential }) => {
    const roster: string[] = readRoster(path.join(REPO_ROOT, "packages", dir));
    const base = ["exec", "vitest", "run", ...(sequential ? ["--no-file-parallelism"] : []), ...roster];

    const plain = runGate(dir, []);
    expect(plain.status).toBe(0);
    expect(plain.calls, "no argument: the run it always was").toEqual([{ args: base, live: "1" }]);

    const forwarded = runGate(dir, REPORTER);
    expect(forwarded.status).toBe(0);
    expect(forwarded.calls, "the reporter arguments reach vitest, after the gate files").toEqual([{ args: [...base, ...REPORTER], live: "1" }]);
  }, 120_000);
});

describe("the real path: ci-live-suite.mjs integration-admin against a closed port (Rule #59)", () => {
  /** Run the script as a process with `env` added to a scrubbed environment, under the connect-refusing preload. */
  function runScript(args: string[], env: Record<string, string>, connectLog: string, watchPort: string) {
    const base: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      const upper = key.toUpperCase();
      if (typeof value !== "string" || upper.startsWith("IRIS_") || upper.startsWith("VITEST") || ["NODE_OPTIONS", "TEST", "NODE_ENV"].includes(upper)) continue;
      base[key] = value;
    }
    return spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env: { ...base, NODE_OPTIONS: `--import=${PRELOAD}`, IRIS_MCP_CONNECT_LOG: connectLog, IRIS_MCP_WATCH_PORTS: `${watchPort},52773,1972`, ...env },
      encoding: "utf8",
      timeout: 280_000,
    });
  }

  const readConnects = (file: string): string[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((line) => line !== "") : []);

  it("exits 1 naming every skipped test, because the admin setup cannot reach IRIS and vitest itself exits 0", async () => {
    const port = await reserveClosedPort();
    const connectLog = path.join(scratch, "real-path-connects.log");
    const result = runScript(
      ["integration-admin"],
      {
        IRIS_REQUIRE_LIVE: "1",
        IRIS_THROWAWAY: FAKE_THROWAWAY,
        IRIS_HOST: "127.0.0.1",
        IRIS_PORT: port,
        IRIS_USERNAME: "_SYSTEM",
        IRIS_PASSWORD: "SYS",
        IRIS_NAMESPACE: "USER",
        IRIS_HTTPS: "false",
      },
      connectLog,
      port,
    );

    expect(result.status, result.stderr.slice(-3000)).toBe(1);
    const skipped = Number(/Tests\s+(\d+) skipped/.exec((result.stdout + result.stderr).replace(/\u001b\[[0-9;]*m/g, ""))?.[1]);
    const problems = Number(/(\d+) problem\(s\) with the run/.exec(result.stderr)?.[1]);
    const allowlisted = LIVE_SUITES["integration-admin"].allowedSkips.length;
    expect(skipped, "vitest itself reported skipped tests").toBeGreaterThan(allowlisted);
    expect(problems, "every skipped test but the allowlisted ones is a problem").toBe(skipped - allowlisted);
    expect(result.stderr).toContain("unlisted skip (skipped): packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts :: iris-admin-mcp integration database management creates a test database");
    expect(result.stderr, "the two allowlisted OAuth tests are not offenders").not.toMatch(/unlisted skip.*oauth management/);
    expect(result.stderr, "and neither is stale").not.toMatch(/stale allowlist entry/);
    const connects = readConnects(connectLog);
    expect(connects.every((line) => line === `127.0.0.1:${port}`), connects.join(",")).toBe(true);
    expect(connects.some((line) => /:(52773|1972)$/.test(line))).toBe(false);
  }, 300_000);

  it("refuses with exit 2 before spawning anything when the environment is not a throwaway target", async () => {
    const port = await reserveClosedPort();
    const connectLog = path.join(scratch, "refusal-connects.log");

    for (const [label, env, args] of [
      ["no arming", { IRIS_THROWAWAY: FAKE_THROWAWAY, IRIS_HOST: "127.0.0.1", IRIS_PORT: port }, ["integration-admin"]],
      ["the shared instance's port", { IRIS_REQUIRE_LIVE: "1", IRIS_THROWAWAY: FAKE_THROWAWAY, IRIS_HOST: "127.0.0.1", IRIS_PORT: "52773" }, ["integration-admin"]],
      ["no suite id", {}, []],
      ["an unknown suite id", {}, ["not-a-suite"]],
    ] as Array<[string, Record<string, string>, string[]]>) {
      const result = runScript(args, env, connectLog, port);

      expect(result.status, label).toBe(2);
      expect(result.stdout, `${label}: nothing ran`).not.toMatch(/RUN|vitest/);
    }
    expect(readConnects(connectLog), "no refusal reached a network").toEqual([]);
  }, 120_000);
});
