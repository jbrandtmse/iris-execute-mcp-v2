/**
 * Story 42.5 (AC 42.5.2, DW-387, DW-675; AD-29, AD-14) -- `node scripts/release.mjs prepare`: the version state, the tree integrity, the
 * gate set (every package's `prepublishOnly` ONCE, armed on a seeded throwaway, before anything is packed), the artifacts and the
 * manifest; and the gate set's container lifecycle under a real SIGTERM and SIGINT, with `installSignalHandlers` (which `main()` calls
 * first) installed before the gate set's own handlers, so that the signal reaches the running command and the container is removed.
 *
 * `prepare` runs against a synthetic repository (`makeRepo`) with its commands scripted, and with the REAL throwaway harness driving
 * `fake-docker.ts` (a docker script that is the only PATH entry), so the container lifecycle, the state file and the child environment
 * are the harness's own. No docker, no IRIS, no network, no `pnpm`: the packer, the smoke, the IPM embed and the commands are fakes
 * whose answers a test sets. The manifest that `prepare` writes is then fed to `publish --dry-run` with the stand-in `npm`.
 *
 * Rows of the I/O matrix covered here: Prepare (version state, tree integrity, gate set, artifacts).
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as checks from "../../../../scripts/lib/ci-checks.mjs";
import * as ipm from "../../../../scripts/lib/ipm-archive.mjs";
import { NPM_PUBLISH_ORDER } from "../../../../scripts/lib/release-core.mjs";
import * as harness from "../../../../scripts/throwaway-iris.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import {
  artifactProblems,
  createCleanups,
  defaultDeps,
  installSignalHandlers,
  listFiles,
  prepare,
  publish,
  readReleaseFacts,
  releaseCheckScripts,
  runCaptured,
  runGateSet,
} from "../../../../scripts/release.mjs";
import { installFakeDocker, type FakeDocker } from "./fake-docker";
import { installStandIns } from "./stand-in-clis";
import { MARKER_TAIL, PACKAGE_DIRS, ROOT_SCRIPTS, SHA, makeRepo, type RepoOptions } from "./release-script-fixtures";

const SECRET_NPM = "npm_PREPARESECRET1234567890";
const SECRET_GITHUB = "ghs_PREPARESECRET0987654321";
const SUITE_IDS = NPM_PUBLISH_ORDER.map((name: string) => `prepublish-${name.replace(/^@iris-mcp\//, "")}`);

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A scratch directory under `os.tmpdir()`, removed after the test. */
function scratch(prefix = "release-prepare-"): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** What one scripted command did. */
interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Behaviors {
  /** The root scripts that fail. */
  failChecks: Set<string>;
  /** The exit code of `pnpm run gen:bootstrap`, and what `git status --porcelain` prints afterwards. */
  genStatus: number;
  dirty: string;
  /** The exit code of an exec'd command, by its last argument. */
  suiteCodes: Record<string, number>;
  /** Changes the packed manifest of a package, by name. */
  packed: Record<string, (manifest: Record<string, any>) => Record<string, any>>;
  smokeStatus: number;
  /** The suites the CI registry knows (default: the real registry's). */
  suites: Record<string, unknown>;
  /** Changes the embed before it is checked. */
  embed: (embed: Record<string, any>) => Record<string, any>;
}

interface PrepareWorld {
  root: string;
  repo: string;
  out: string;
  docker: FakeDocker;
  /** Every command, exec, pack and smoke, in the order they ran. */
  events: string[];
  lines: string[];
  runCommands: Array<{ command: string[]; env: Record<string, string> }>;
  runs: Array<{ argv: string[]; cwd: string | undefined; env: Record<string, string> | undefined }>;
  smoked: Array<{ name: string; tarball: string }>;
  /** The number of arguments of each `pnpmPack` call (the packer's third argument is how lifecycle scripts are switched on). */
  packArgumentCounts: number[];
  behaviors: Behaviors;
  env: (overrides?: Record<string, string | undefined>) => Record<string, string>;
  run: (options?: { env?: Record<string, string | undefined>; out?: string }) => Promise<number>;
}

/** A world: a synthetic repository, a fake docker, scripted commands, and the real harness's functions. */
function newWorld(repoOptions: RepoOptions = {}): PrepareWorld {
  const root = scratch();
  const repo = path.join(root, "repo");
  const out = path.join(root, "out");
  mkdirSync(repo, { recursive: true });
  makeRepo(repo, repoOptions);
  const docker = installFakeDocker(path.join(root, "fake-docker"));
  const events: string[] = [];
  const lines: string[] = [];
  const runCommands: PrepareWorld["runCommands"] = [];
  const runs: PrepareWorld["runs"] = [];
  const smoked: PrepareWorld["smoked"] = [];
  const packArgumentCounts: number[] = [];
  const behaviors: Behaviors = { failChecks: new Set(), genStatus: 0, dirty: "", suiteCodes: {}, packed: {}, smokeStatus: 0, suites: checks.LIVE_SUITES as Record<string, unknown>, embed: (embed) => embed };
  const baseEnv = (overrides: Record<string, string | undefined> = {}): Record<string, string> => {
    const env: Record<string, string | undefined> = {
      PATH: docker.binDir,
      FAKE_DOCKER_DIR: docker.dir,
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/release-dry-run/42-5",
      GITHUB_SHA: SHA,
      ...overrides,
    };
    return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  };

  const script = async (argv: string[], options: { cwd?: string; env?: Record<string, string> } = {}): Promise<Result> => {
    runs.push({ argv, cwd: options.cwd, env: options.env });
    events.push(`run ${argv.join(" ")}`);
    const key = argv.join(" ");
    if (key === "pnpm run gen:bootstrap") return { status: behaviors.genStatus, stdout: "", stderr: behaviors.genStatus === 0 ? "" : "generator exploded\n" };
    if (key === "git status --porcelain") return { status: 0, stdout: behaviors.dirty, stderr: "" };
    if (argv[0] === "pnpm" && argv[1] === "run") return behaviors.failChecks.has(argv[2] as string) ? { status: 1, stdout: "", stderr: `${argv[2]} found a difference\n` } : { status: 0, stdout: "", stderr: "" };
    if (key === "npm run build") return { status: 0, stdout: "", stderr: "" };
    if (key.startsWith("npm run package -- --out ")) {
      const directory = argv[argv.length - 1] as string;
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, "iris-mcp-launcher-0.1.0.vsix"), "synthetic vsix\n");
      return { status: 0, stdout: "", stderr: "" };
    }
    if (key === "npm exec -- vsce ls") return { status: 0, stdout: "package.json\ndist/extension.js\nLICENSE\n", stderr: "" };
    throw new Error(`unscripted command: ${key}`);
  };

  const modules = (): Record<string, any> => ({
    harness,
    checks: { CI_HOST_PORTS: checks.CI_HOST_PORTS, LIVE_NAMESPACE: checks.LIVE_NAMESPACE, LIVE_SUITES: behaviors.suites },
    pack: {
      pnpmPack: (...args: unknown[]) => {
        packArgumentCounts.push(args.length);
        const [packageDir, destination] = args as [string, string];
        const source = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")) as Record<string, any>;
        events.push(`pack ${source["name"]}`);
        const dependencies = Object.fromEntries(Object.entries((source["dependencies"] ?? {}) as Record<string, string>).map(([name, specifier]) => [name, specifier.startsWith("workspace:") ? source["version"] : specifier]));
        const manifest: Record<string, any> = { name: source["name"], version: source["version"], dependencies, ...(source["publishConfig"]?.exports ?? source["exports"] ? { exports: source["publishConfig"]?.exports ?? source["exports"] } : {}) };
        mkdirSync(destination, { recursive: true });
        const tarball = path.join(destination, `${String(source["name"]).replace("@", "").replace("/", "-")}-${source["version"]}.tgz`);
        writeFileSync(tarball, `tarball of ${source["name"]}@${source["version"]}\n`);
        return { tarball, bytes: readFileSync(tarball).length, root: destination, files: ["package.json", "dist/index.js"], manifest: behaviors.packed[source["name"] as string]?.(manifest) ?? manifest };
      },
    },
    smoke: {
      smokePackages: async (options: { tarballs: Array<{ name: string; tarball: string }>; log: (line: string) => void }) => {
        events.push("smoke");
        smoked.push(...options.tarballs.map((entry) => ({ name: entry.name, tarball: entry.tarball })));
        return behaviors.smokeStatus;
      },
    },
    ipm: {
      embedProblems: ipm.embedProblems,
      stageModule: ipm.stageModule,
      loadEmbed: async (repoRoot: string) => {
        events.push("embed");
        const marker = /BOOTSTRAP_VERSION = "([^"]+)"/.exec(readFileSync(path.join(repoRoot, "packages", "shared", "src", "bootstrap-classes.ts"), "utf8"))?.[1] as string;
        const stamped = (name: string): string => `Class ${name} {\nParameter BOOTSTRAPVERSION = "${marker}";\n}\n`;
        return behaviors.embed({
          marker,
          classes: new Map([
            ["ExecuteMCPv2.Setup.cls", stamped("ExecuteMCPv2.Setup")],
            ["ExecuteMCPv2.Utils.cls", "Class ExecuteMCPv2.Utils {}\n"],
          ]),
          guard: { name: "ExecuteMCPv2.InstallGuard.cls", content: stamped("ExecuteMCPv2.InstallGuard") },
          moduleName: "iris-execute-mcp-v2",
          moduleXml: readFileSync(path.join(repoRoot, "ipm", "module.xml"), "utf8"),
        });
      },
    },
  });

  return {
    root,
    repo,
    out,
    docker,
    events,
    lines,
    runCommands,
    runs,
    smoked,
    packArgumentCounts,
    behaviors,
    env: baseEnv,
    run: (runOptions = {}) => {
      const env = baseEnv(runOptions.env);
      const harnessDeps = {
        ...harness.defaultDeps(env),
        log: () => undefined,
        webStatus: async () => 200,
        runCommand: async (command: string[], commandEnv: Record<string, string>) => {
          events.push(`exec ${command.join(" ")}`);
          runCommands.push({ command, env: commandEnv });
          return behaviors.suiteCodes[command[command.length - 1] as string] ?? 0;
        },
        killCommand: () => undefined,
      };
      const proc = { once: () => undefined, off: () => undefined, exit: () => undefined };
      return prepare(
        { out: runOptions.out ?? out, env, repoRoot: repo },
        { ...defaultDeps(), log: (line: string) => lines.push(line), run: script as never, loadModules: async () => modules(), harnessDeps, proc } as never,
      );
    },
  };
}

/** The docker subcommands the fake received, in order. */
const dockerVerbs = (docker: FakeDocker): string[] => docker.calls().map((call) => call.argv[0] as string);

describe("Prepare: the gate set runs every prepublishOnly once, through the harness's exec, before anything is packed (AC 42.5.2; DW-387, DW-675)", () => {
  it("a healthy dry run: up, the seed, the eight prepublish suites in publish order, down; then eight tarballs, the smoke, the vsix and the IPM tree; exit 0", async () => {
    const world = newWorld({ version: "1.0.0" });
    expect(await world.run()).toBe(0);
    const order = world.events.filter((event) => event.startsWith("exec ") || event.startsWith("pack ") || event === "smoke" || event === "embed");
    expect(order).toEqual([
      "exec node scripts/ci-seed-throwaway.mjs",
      ...SUITE_IDS.map((id: string) => `exec node scripts/ci-live-suite.mjs ${id}`),
      ...NPM_PUBLISH_ORDER.map((name: string) => `pack ${name}`),
      "smoke",
      "embed",
    ]);
    const run = world.docker.calls().find((call) => call.argv[0] === "run")?.argv as string[];
    expect(run).toEqual([
      "run",
      "-d",
      "--name",
      run[3],
      "--label",
      "iris-mcp.owner=throwaway",
      "-p",
      "127.0.0.1:52791:52773",
      "intersystems/irishealth-community:2026.2@sha256:462de1fb3597272fde0e03afad006af1b18b59c90f1c1fb5566c79b027a7af0a",
    ]);
    expect(dockerVerbs(world.docker).filter((verb) => verb === "rm")).toHaveLength(1);
    expect(world.docker.containers(), "the container is removed").toEqual({});
    expect(world.lines.join("\n")).toContain("gate set: seed and 8 prepublish suites passed, and the container is removed");
  });

  it("the lines of the run are appended to the step summary, whatever the exit code", async () => {
    const world = newWorld();
    const summary = path.join(world.root, "prepare-summary.md");
    expect(await world.run({ env: { GITHUB_STEP_SUMMARY: summary } })).toBe(0);
    expect(readFileSync(summary, "utf8")).toContain("### prepare (exit 0)");
    expect(readFileSync(summary, "utf8")).toContain("prepare: gate set: seed and 8 prepublish suites passed, and the container is removed");
    const failing = newWorld();
    failing.behaviors.suiteCodes["prepublish-dev"] = 1;
    const failedSummary = path.join(failing.root, "failed-summary.md");
    expect(await failing.run({ env: { GITHUB_STEP_SUMMARY: failedSummary } })).toBe(1);
    expect(readFileSync(failedSummary, "utf8")).toContain("### prepare (exit 1)");
  });

  it("the command of each suite is the CI registry's, and each id is a suite of the real registry (so ci-live-suite.mjs accepts it)", async () => {
    for (const id of SUITE_IDS) {
      expect(Object.hasOwn(checks.LIVE_SUITES, id), id).toBe(true);
      expect(checks.LIVE_SUITES[id].command).toEqual(["pnpm", "run", "prepublishOnly"]);
    }
    const world = newWorld();
    await world.run();
    expect(world.runCommands.map((entry) => entry.command)).toEqual([["node", "scripts/ci-seed-throwaway.mjs"], ...SUITE_IDS.map((id: string) => ["node", "scripts/ci-live-suite.mjs", id])]);
  });

  it("every exec'd command gets all five IRIS_* variables, IRIS_HTTPS and IRIS_REQUIRE_LIVE=1 from the harness's own buildChildEnv, and no ambient IRIS_* (DW-675)", async () => {
    const world = newWorld();
    expect(await world.run({ env: { IRIS_HOST: "ambient.example", IRIS_PORT: "1", IRIS_USERNAME: "someone", IRIS_PASSWORD: "ambient", IRIS_NAMESPACE: "USER", IRIS_REQUIRE_LIVE: "0", IRIS_TOOLS_PRESET: "core" } })).toBe(0);
    expect(world.runCommands).toHaveLength(9);
    for (const { command, env } of world.runCommands) {
      expect(env["IRIS_REQUIRE_LIVE"], command.join(" ")).toBe("1");
      expect(env["IRIS_HOST"]).toBe("127.0.0.1");
      expect(env["IRIS_PORT"]).toBe("52791");
      expect(env["IRIS_USERNAME"]).toBe("_SYSTEM");
      expect(env["IRIS_PASSWORD"]).toBe("SYS");
      expect(env["IRIS_NAMESPACE"]).toBe("HSCUSTOM");
      expect(env["IRIS_HTTPS"]).toBe("false");
      expect(env["IRIS_THROWAWAY"]).toMatch(/^iris-mcp-throwaway-[0-9a-f]{12}$/);
      expect(env["IRIS_TOOLS_PRESET"], "an ambient IRIS_* setting is dropped").toBeUndefined();
    }
    const expected = harness.buildChildEnv({ PATH: "p" }, { port: "52791", name: world.runCommands[0]?.env["IRIS_THROWAWAY"] as string, namespace: "HSCUSTOM" });
    for (const key of ["IRIS_REQUIRE_LIVE", "IRIS_HOST", "IRIS_PORT", "IRIS_USERNAME", "IRIS_PASSWORD", "IRIS_NAMESPACE", "IRIS_HTTPS", "IRIS_THROWAWAY"]) {
      expect(world.runCommands[1]?.env[key], key).toBe(expected[key]);
    }
  });

  it("the secrets never reach a child: not the exec'd commands, not the scripted commands", async () => {
    const world = newWorld();
    expect(await world.run({ env: { NPM_TOKEN: SECRET_NPM, GITHUB_TOKEN: SECRET_GITHUB } })).toBe(0);
    expect(JSON.stringify(world.runCommands)).not.toContain(SECRET_NPM);
    expect(JSON.stringify(world.runCommands)).not.toContain(SECRET_GITHUB);
    expect(JSON.stringify(world.runs)).not.toContain(SECRET_NPM);
    expect(JSON.stringify(world.runs)).not.toContain(SECRET_GITHUB);
    expect(world.lines.join("\n")).not.toContain(SECRET_NPM);
  });

  it("a red suite stops the gate set after `down`: exit 1, the later suites do not run, nothing is packed, the container is removed", async () => {
    const world = newWorld();
    world.behaviors.suiteCodes["prepublish-dev"] = 1;
    expect(await world.run()).toBe(1);
    const execs = world.events.filter((event) => event.startsWith("exec "));
    expect(execs.at(-1)).toBe("exec node scripts/ci-live-suite.mjs prepublish-dev");
    expect(execs).toHaveLength(1 + SUITE_IDS.indexOf("prepublish-dev") + 1);
    expect(world.events.some((event) => event.startsWith("pack "))).toBe(false);
    expect(world.docker.containers()).toEqual({});
    expect(world.lines.join("\n")).toContain("gate set: prepublish-dev exited 1");
    expect(existsSync(world.out) ? readdirSync(world.out) : []).toEqual([]);
  });

  it("a failing seed stops before any suite", async () => {
    const world = newWorld();
    world.behaviors.suiteCodes["scripts/ci-seed-throwaway.mjs"] = 1;
    expect(await world.run()).toBe(1);
    expect(world.events.filter((event) => event.startsWith("exec "))).toEqual(["exec node scripts/ci-seed-throwaway.mjs"]);
    expect(world.docker.containers()).toEqual({});
  });

  it("no docker on PATH is exit 3 and nothing is packed; a container that does not start is exit 4 and none is left", async () => {
    const missing = newWorld();
    expect(await missing.run({ env: { PATH: path.join(missing.root, "empty") } })).toBe(3);
    expect(missing.events.some((event) => event.startsWith("exec ") || event.startsWith("pack "))).toBe(false);

    const failing = newWorld();
    expect(await failing.run({ env: { FAKE_DOCKER_RUN_FAIL: "1" } })).toBe(4);
    expect(failing.docker.containers()).toEqual({});
    expect(failing.events.some((event) => event.startsWith("exec ") || event.startsWith("pack "))).toBe(false);
  });

  it("a suite id that the CI registry does not know is a problem before any container starts", async () => {
    const world = newWorld();
    const { "prepublish-ops": _gone, ...rest } = checks.LIVE_SUITES as Record<string, unknown>;
    void _gone;
    world.behaviors.suites = rest;
    expect(await world.run()).toBe(1);
    expect(world.lines.join("\n")).toContain("the CI registry has no suite prepublish-ops");
    expect(world.docker.calls()).toEqual([]);
  });
});

describe("Prepare: the version state (AC 42.5.2)", () => {
  it("a tag run with every package at the tag's version, no pending changeset and consistent files passes, and records mode release", async () => {
    const world = newWorld({ version: "1.0.0" });
    expect(await world.run({ env: { GITHUB_REF: "refs/tags/v1.0.0" } })).toBe(0);
    const manifest = JSON.parse(readFileSync(path.join(world.out, "release-manifest.json"), "utf8")) as { version: string; mode: string; sha: string; ref: string };
    expect(manifest).toMatchObject({ version: "1.0.0", mode: "release", sha: SHA, ref: "refs/tags/v1.0.0" });
  });

  it("a tag run lists every problem and stops before docker (today: client-config at 0.0.1 and changesets pending), exit 1", async () => {
    const world = newWorld({ version: "0.0.2", versions: { "@iris-mcp/client-config": "0.0.1" }, pending: ["one.md", "two.md"] });
    expect(await world.run({ env: { GITHUB_REF: "refs/tags/v0.0.2" } })).toBe(1);
    const text = world.lines.join("\n");
    expect(text).toContain("problem: @iris-mcp/client-config is at 0.0.1, but the tag is v0.0.2");
    expect(text).toContain("problem: 2 changeset(s) are still pending in .changeset/ (one.md, two.md)");
    expect(world.docker.calls()).toEqual([]);
    expect(world.runs, "no command ran").toEqual([]);
    expect(world.events.some((event) => event.startsWith("pack "))).toBe(false);
  });

  it("a tag whose version differs from every package is refused, one line per package", async () => {
    const world = newWorld({ version: "1.0.0" });
    expect(await world.run({ env: { GITHUB_REF: "refs/tags/v1.0.1" } })).toBe(1);
    expect(world.lines.filter((line) => line.includes("but the tag is v1.0.1"))).toHaveLength(8);
  });

  it("a dry run prints the same lines prefixed `a tag run would refuse:` and goes on (exit 0), with one shared version recorded", async () => {
    const world = newWorld({ version: "0.0.2", versions: { "@iris-mcp/client-config": "0.0.1" }, pending: ["one.md"] });
    expect(await world.run()).toBe(0);
    const text = world.lines.join("\n");
    expect(text).toContain("a tag run would refuse: the packages are not at one shared version (@iris-mcp/client-config@0.0.1, @iris-mcp/shared@0.0.2");
    expect(text).toContain("version state: a dry run goes on with the problems above");
    expect(text).toContain("a tag run would refuse: 1 changeset(s) are still pending");
    expect(text).not.toContain("problem: @iris-mcp/client-config");
    const manifest = JSON.parse(readFileSync(path.join(world.out, "release-manifest.json"), "utf8")) as { version: string; mode: string; channels: Array<{ packages?: Array<{ name: string; version: string }> }> };
    expect(manifest).toMatchObject({ mode: "dry-run", version: "0.0.2" });
    expect(manifest.channels[0]?.packages?.map((entry) => `${entry.name}@${entry.version}`)).toEqual(NPM_PUBLISH_ORDER.map((name: string) => `${name}@${name === "@iris-mcp/client-config" ? "0.0.1" : "0.0.2"}`));
  });

  it("a prerelease version is refused in a tag run", async () => {
    const world = newWorld({ version: "1.0.0-rc.1" });
    expect(await world.run({ env: { GITHUB_REF: "refs/tags/v1.0.0" } })).toBe(1);
    expect(world.lines.join("\n")).toContain("not a plain MAJOR.MINOR.PATCH version");
  });

  it("a v tag that is not v<MAJOR.MINOR.PATCH> is a dry run with no version of its own", async () => {
    const world = newWorld({ version: "1.0.0" });
    expect(await world.run({ env: { GITHUB_REF: "refs/tags/v1.0.0-rc.1" } })).toBe(0);
    expect(JSON.parse(readFileSync(path.join(world.out, "release-manifest.json"), "utf8")).mode).toBe("dry-run");
  });
});

describe("Prepare: tree integrity, in both modes (AC 42.5.2; AD-14)", () => {
  it.each([
    ["the bootstrap marker's semver is not the shared version", { markerSemver: "0.9.0" }, /BOOTSTRAP_VERSION is "0\.9\.0\+2\.244fe8623c76", whose semver is not the shared version 1\.0\.0/],
    ["ipm/module.xml is at another version", { moduleVersion: "0.9.0" }, /ipm\/module\.xml is at "0\.9\.0", not the shared version 1\.0\.0/],
  ])("%s: exit 1 in a tag run and in a dry run, before docker", async (_label, repoOptions, expected) => {
    for (const ref of ["refs/tags/v1.0.0", "refs/heads/release-dry-run/x"]) {
      const world = newWorld(repoOptions as RepoOptions);
      expect(await world.run({ env: { GITHUB_REF: ref } }), ref).toBe(1);
      expect(world.lines.join("\n")).toMatch(expected);
      expect(world.docker.calls()).toEqual([]);
    }
  });

  it("pnpm run gen:bootstrap must leave `git status --porcelain` empty: a dirty tree is exit 1 in both modes and names the files", async () => {
    for (const ref of ["refs/tags/v1.0.0", "refs/heads/release-dry-run/x"]) {
      const world = newWorld();
      world.behaviors.dirty = " M packages/shared/src/bootstrap-classes.ts\n M ipm/module.xml\n";
      expect(await world.run({ env: { GITHUB_REF: ref } }), ref).toBe(1);
      expect(world.lines.join("\n")).toMatch(/pnpm run gen:bootstrap changed the tree \(.*bootstrap-classes\.ts; .*module\.xml\)\. Run it, review the result and commit it/);
      expect(world.docker.calls()).toEqual([]);
    }
    const healthy = newWorld();
    await healthy.run();
    expect(healthy.events.slice(0, 2)).toEqual(["run pnpm run gen:bootstrap", "run git status --porcelain"]);
  });

  it("a generator that fails is a problem that carries its output", async () => {
    const world = newWorld();
    world.behaviors.genStatus = 1;
    expect(await world.run()).toBe(1);
    expect(world.lines.join("\n")).toContain("pnpm run gen:bootstrap failed (exit 1): generator exploded");
  });

  it("every root script that ends in :check runs, except format:check (a named reason) and the lifecycle hooks; a failing one is named, and all problems are listed", async () => {
    const world = newWorld();
    world.behaviors.failChecks = new Set(["gen:skills:check", "gen:pack:check"]);
    expect(await world.run()).toBe(1);
    const ran = world.runs.filter((entry) => entry.argv[0] === "pnpm" && entry.argv[1] === "run" && entry.argv[2] !== "gen:bootstrap").map((entry) => entry.argv[2]);
    expect(ran).toEqual(["gen:governance-baseline:check", "gen:pack:check", "gen:skills:check", "gen:tools-list-snapshot:check"]);
    expect(ran).not.toContain("format:check");
    expect(ran).not.toContain("pregen:governance-baseline:check");
    const text = world.lines.join("\n");
    expect(text).toContain("problem: pnpm run gen:skills:check failed (exit 1): gen:skills:check found a difference");
    expect(text).toContain("problem: pnpm run gen:pack:check failed (exit 1)");
    expect(text).toContain("format:check: not run, not a CI gate (exempted by ROOT_SCRIPT_EXEMPTIONS in ci-workflow.test.ts)");
    expect(world.docker.calls()).toEqual([]);
  });

  it("releaseCheckScripts finds the :check scripts of the REAL root manifest and none of its hooks, and format:check is the one exemption", () => {
    const scripts = (JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(releaseCheckScripts(scripts)).toEqual(["gen:governance-baseline:check", "gen:pack:check", "gen:skills:check", "gen:tools-list-snapshot:check"]);
    expect(Object.keys(scripts).filter((name) => name.endsWith(":check") && !releaseCheckScripts(scripts).includes(name)).sort()).toEqual(["format:check", "pregen:governance-baseline:check"]);
  });

  it("releaseCheckScripts drops only a lifecycle hook: a pre/post name whose remainder is itself a script", () => {
    const scripts = {
      "prettier:check": "prettier --check .",
      "gen:x:check": "node x --check",
      "pregen:x:check": "turbo run build",
      "postgen:x:check": "echo done",
      "postfoo:check": "echo foo",
      "format:check": "prettier --check .",
      "gen:y": "node y",
    };
    expect(releaseCheckScripts(scripts)).toEqual(["gen:x:check", "postfoo:check", "prettier:check"]);
  });

  it("a root script like prettier:check, which merely starts with pre, runs in prepare; its neighbours' hooks do not", async () => {
    const world = newWorld({ scripts: { ...ROOT_SCRIPTS, "prettier:check": "prettier --check src", "postgen:skills:check": "echo done" } });
    expect(await world.run()).toBe(0);
    const ran = world.runs.filter((entry) => entry.argv[0] === "pnpm" && entry.argv[1] === "run" && entry.argv[2] !== "gen:bootstrap").map((entry) => entry.argv[2]);
    expect(ran).toEqual(["gen:governance-baseline:check", "gen:pack:check", "gen:skills:check", "gen:tools-list-snapshot:check", "prettier:check"]);
  });
});

describe("Prepare: the artifacts and the manifest (AC 42.5.2)", () => {
  it("eight tarballs in publish order, the vsix with its file list, the IPM tree with README.md and LICENSE, and a manifest whose files carry the real sha256", async () => {
    const world = newWorld();
    expect(await world.run()).toBe(0);
    const files = listFiles(world.out);
    expect(files.filter((file) => file.startsWith("npm/"))).toEqual(NPM_PUBLISH_ORDER.map((name: string) => `npm/${name.replace("@", "").replace("/", "-")}-1.0.0.tgz`).sort());
    expect(files).toContain("vsix/iris-mcp-launcher-0.1.0.vsix");
    for (const file of ["ipm/module.xml", "ipm/src/cls/ExecuteMCPv2/Setup.cls", "ipm/src/cls/ExecuteMCPv2/Utils.cls", "ipm/preload/src/cls/ExecuteMCPv2/InstallGuard.cls", "ipm/README.md", "ipm/LICENSE"]) {
      expect(files, file).toContain(file);
    }
    expect(readFileSync(path.join(world.out, "ipm", "LICENSE"), "utf8")).toBe("MIT License\n");
    expect(readFileSync(path.join(world.out, "ipm", "README.md"), "utf8")).toMatch(/not made, endorsed or supported by InterSystems/);

    const manifest = JSON.parse(readFileSync(path.join(world.out, "release-manifest.json"), "utf8")) as Record<string, any>;
    expect(manifest["schema"]).toBe(1);
    expect(manifest["version"]).toBe("1.0.0");
    expect(manifest["sha"]).toBe(SHA);
    expect(manifest["mode"]).toBe("dry-run");
    expect(manifest["channels"].map((channel: { id: string; enabled: boolean }) => [channel.id, channel.enabled])).toEqual([
      ["npm", true],
      ["vscode-marketplace", false],
      ["open-vsx", false],
      ["ipm", false],
    ]);
    expect(manifest["channels"][0].packages.map((entry: { name: string }) => entry.name)).toEqual([...NPM_PUBLISH_ORDER]);
    expect(manifest["channels"][1]).toMatchObject({ file: "vsix/iris-mcp-launcher-0.1.0.vsix", name: "iris-mcp-launcher", version: "0.1.0", publisher: "TBD-at-publish-time", files: ["package.json", "dist/extension.js", "LICENSE"] });
    expect(manifest["channels"][3]).toMatchObject({ tree: "ipm", module: "iris-execute-mcp-v2", version: "1.0.0", repository: "jbrandtmse/iris-execute-mcp-v2-ipm", branch: "master" });
    expect(manifest["files"].map((entry: { path: string }) => entry.path)).toEqual(files.filter((file) => file !== "release-manifest.json"));
    for (const entry of manifest["files"] as Array<{ path: string; bytes: number; sha256: string }>) {
      const bytes = readFileSync(path.join(world.out, entry.path));
      expect(entry.sha256, entry.path).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(entry.bytes, entry.path).toBe(bytes.length);
    }
    expect(artifactProblems(world.out, manifest)).toEqual([]);
  });

  it("the smoke runs on the exact tarballs that the artifacts hold", async () => {
    const world = newWorld();
    expect(await world.run()).toBe(0);
    expect(world.smoked.map((entry) => entry.name)).toEqual([...NPM_PUBLISH_ORDER]);
    expect(world.smoked.map((entry) => path.relative(world.out, entry.tarball))).toEqual(NPM_PUBLISH_ORDER.map((name: string) => `npm/${name.replace("@", "").replace("/", "-")}-1.0.0.tgz`));
    expect(world.events.indexOf("smoke")).toBeGreaterThan(world.events.lastIndexOf("pack @iris-mcp/all"));
  });

  it("prepare packs with pnpmPack(dir, dest) and no third argument: lifecycle scripts stay ignored (the tarball is what pnpm pack makes, with no prepack output)", async () => {
    const world = newWorld();
    expect(await world.run()).toBe(0);
    expect(world.packArgumentCounts).toEqual(Array(8).fill(2));
  });

  it("a tarball that still holds workspace: is exit 1 naming the package", async () => {
    const world = newWorld();
    world.behaviors.packed["@iris-mcp/ops"] = (manifest) => ({ ...manifest, dependencies: { "@iris-mcp/shared": "workspace:*" } });
    expect(await world.run()).toBe(1);
    expect(world.lines.join("\n")).toContain("problem: @iris-mcp/ops: the tarball still holds @iris-mcp/shared@workspace:* in dependencies");
    expect(existsSync(path.join(world.out, "release-manifest.json"))).toBe(false);
    expect(world.events).not.toContain("smoke");
  });

  it("a tarball whose exports are not the source's publishConfig.exports is exit 1 naming the package", async () => {
    const world = newWorld();
    world.behaviors.packed["@iris-mcp/shared"] = (manifest) => ({ ...manifest, exports: { ".": { types: "./src/index.ts", import: "./src/index.ts" } } });
    expect(await world.run()).toBe(1);
    expect(world.lines.join("\n")).toMatch(/problem: @iris-mcp\/shared: the tarball's exports are .*src\/index\.ts.*not the source's publishConfig\.exports/);
  });

  it("a tarball at another version is exit 1", async () => {
    const world = newWorld();
    world.behaviors.packed["@iris-mcp/data"] = (manifest) => ({ ...manifest, version: "0.9.9" });
    expect(await world.run()).toBe(1);
    expect(world.lines.join("\n")).toContain('@iris-mcp/data: the tarball is at version "0.9.9", not 1.0.0');
  });

  it("a failing smoke is exit 1 and no manifest is written", async () => {
    const world = newWorld();
    world.behaviors.smokeStatus = 1;
    expect(await world.run()).toBe(1);
    expect(world.lines.join("\n")).toContain("the package smoke failed on the tarballs that would be published");
    expect(existsSync(path.join(world.out, "release-manifest.json"))).toBe(false);
  });

  it("an embed that is not releasable (a class still holding the dev placeholder) is exit 1 naming the class", async () => {
    const world = newWorld();
    world.behaviors.embed = (embed) => ({ ...embed, classes: new Map([...(embed["classes"] as Map<string, string>), ["ExecuteMCPv2.Utils.cls", 'Class X {\nParameter BOOTSTRAPVERSION = "dev";\n}\n']]) });
    expect(await world.run()).toBe(1);
    expect(world.lines.join("\n")).toMatch(/the IPM embed is not releasable: ExecuteMCPv2\.Utils\.cls still holds the dev placeholder/);
  });

  it("an output directory that is not empty, a missing sha and a missing --out are refusals (exit 2)", async () => {
    const full = newWorld();
    mkdirSync(full.out, { recursive: true });
    writeFileSync(path.join(full.out, "left-over"), "x");
    expect(await full.run()).toBe(2);
    expect(full.lines.join("\n")).toContain("is not empty. Pass an empty or new directory.");
    expect(full.runs).toEqual([]);

    const noSha = newWorld();
    expect(await noSha.run({ env: { GITHUB_SHA: undefined } })).toBe(2);
    expect(noSha.lines.join("\n")).toContain("GITHUB_SHA is \"\", not a commit");

    const noOut = newWorld();
    expect(await noOut.run({ out: "" })).toBe(2);
  });

  it("the manifest that prepare writes is the one publish --dry-run accepts, with the stand-in npm (prepare feeds rehearse)", async () => {
    const world = newWorld();
    expect(await world.run()).toBe(0);
    const standIns = installStandIns(path.join(world.root, "stand-ins"), ["npm", "git"]);
    standIns.script("npm", [
      { match: ["--version"], stdout: "11.12.1\n" },
      { match: ["view"], status: 1, stderr: "npm error code E404\n" },
    ]);
    const lines: string[] = [];
    const code = await publish(
      { artifacts: world.out, dryRun: true, env: { PATH: standIns.binDir, STAND_IN_DIR: standIns.dir }, repoRoot: world.repo },
      { ...defaultDeps(), log: (line: string) => lines.push(line), fetch: (async () => new Response(null, { status: 404 })) as unknown as typeof fetch },
    );
    expect(code, lines.join("\n")).toBe(0);
    expect(standIns.calls("npm").filter((call) => call.argv[0] === "publish")).toHaveLength(8);
    expect(lines.join("\n")).toContain("8 packages at 1.0.0: hashes verified, npm 11.12.1");
  });
});

describe("the real loadModules, which only prepare runs (a runner without node_modules never does)", () => {
  it("loads the five modules from the repository root, with every member that prepare and runGateSet call", async () => {
    const modules = await defaultDeps().loadModules(REPO_ROOT);
    expect(Object.keys(modules).sort()).toEqual(["checks", "harness", "ipm", "pack", "smoke"]);
    for (const member of ["upHarness", "execHarness", "downHarness", "createTeardown", "defaultDeps"]) expect(typeof modules.harness[member], `harness.${member}`).toBe("function");
    expect(typeof modules.harness.IRISHEALTH_COMMUNITY_IMAGE).toBe("string");
    expect(typeof modules.checks.LIVE_NAMESPACE).toBe("string");
    expect(modules.checks.CI_HOST_PORTS.live, "checks.CI_HOST_PORTS.live").toMatch(/^\d+$/);
    for (const id of SUITE_IDS) expect(Object.hasOwn(modules.checks.LIVE_SUITES, id), `checks.LIVE_SUITES.${id}`).toBe(true);
    expect(typeof modules.pack.pnpmPack).toBe("function");
    expect(typeof modules.smoke.smokePackages).toBe("function");
    for (const member of ["loadEmbed", "embedProblems", "stageModule"]) expect(typeof modules.ipm[member], `ipm.${member}`).toBe("function");
  });
});

describe("readReleaseFacts reads the real repository's packages in publish order", () => {
  it("finds the eight packages, none missing and none extra, with the shared version and the marker's tail", () => {
    const facts = readReleaseFacts(REPO_ROOT);
    expect(facts.problems).toEqual([]);
    expect(facts.packages.map((entry: { name: string }) => entry.name)).toEqual([...NPM_PUBLISH_ORDER]);
    expect(facts.packages.map((entry: { dir: string }) => entry.dir)).toEqual(NPM_PUBLISH_ORDER.map((name: string) => PACKAGE_DIRS[name]));
    expect(facts.marker).toMatch(/^\d+\.\d+\.\d+\+\d+\.[0-9a-f]{12}$/);
    expect(facts.moduleVersion).toBe(facts.sharedVersion);
    expect(MARKER_TAIL).toMatch(/^\d+\.[0-9a-f]{12}$/);
  });

  it("reports a package that is published but missing from the order, and one in the order with no manifest", () => {
    const root = scratch();
    makeRepo(root, { version: "1.0.0" });
    writeFileSync(path.join(root, "packages", "iris-mcp-all", "package.json"), JSON.stringify({ name: "@iris-mcp/all-extra", version: "1.0.0" }));
    const facts = readReleaseFacts(root);
    expect(facts.problems.join("\n")).toMatch(/@iris-mcp\/all is in NPM_PUBLISH_ORDER but no packages\/\*\/package\.json names it/);
    expect(facts.problems.join("\n")).toMatch(/@iris-mcp\/all-extra is published but missing from NPM_PUBLISH_ORDER/);
  });
});

describe("The gate set removes its container on every exit path (AC 42.5.2)", () => {
  /** A `process`-like object that records its listeners and the exit code, so a handler can be fired by hand. */
  function fakeProcess(): { once: (event: string, handler: () => void) => void; off: (event: string, handler: () => void) => void; exit: (code: number) => void; listeners: Map<string, () => void>; exits: number[] } {
    const listeners = new Map<string, () => void>();
    const exits: number[] = [];
    return {
      once: (event, handler) => void listeners.set(event, handler),
      off: (event) => void listeners.delete(event),
      exit: (code) => void exits.push(code),
      listeners,
      exits,
    };
  }

  it("a signal while a command runs removes the container (docker rm), forwards the signal to the command, and exits 130 or 143", async () => {
    for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
      const world = newWorld();
      const proc = fakeProcess();
      const killed: string[] = [];
      let release: (code: number) => void = () => undefined;
      const harnessDeps = { ...harness.defaultDeps(world.env()), log: () => undefined, webStatus: async () => 200, runCommand: () => new Promise<number>((resolve) => (release = resolve)), killCommand: (name: string) => killed.push(name) };
      const running = runGateSet({
        env: world.env(),
        modules: { harness, checks },
        harnessDeps,
        stateFile: path.join(world.root, "state.json"),
        commands: [{ label: "blocked", argv: ["node", "blocked.mjs"] }],
        log: (line) => world.lines.push(line),
        proc,
      });
      for (let waited = 0; !world.lines.includes("gate set: blocked"); waited += 1) {
        if (waited > 400) throw new Error("the command never started");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(Object.keys(world.docker.containers())).toHaveLength(1);
      proc.listeners.get(signal)?.();
      expect(proc.exits, signal).toEqual([code]);
      expect(killed).toEqual([signal]);
      expect(world.docker.containers(), `${signal}: the container is removed by the handler`).toEqual({});
      release(1);
      expect(await running).toBe(1);
      expect(proc.listeners.size, "the handlers are removed afterwards").toBe(0);
    }
  });

  it("the exit handler removes a container that is still there", async () => {
    const world = newWorld();
    const proc = fakeProcess();
    let release: (code: number) => void = () => undefined;
    const harnessDeps = { ...harness.defaultDeps(world.env()), log: () => undefined, webStatus: async () => 200, runCommand: () => new Promise<number>((resolve) => (release = resolve)), killCommand: () => undefined };
    const running = runGateSet({ env: world.env(), modules: { harness, checks }, harnessDeps, stateFile: path.join(world.root, "state.json"), commands: [{ label: "blocked", argv: ["x"] }], log: (line) => world.lines.push(line), proc });
    while (!world.lines.includes("gate set: blocked")) await new Promise((resolve) => setTimeout(resolve, 25));
    proc.listeners.get("exit")?.();
    expect(world.docker.containers()).toEqual({});
    release(0);
    await running;
  });

  /**
   * Run the gate set in a real child process (a driver script) in the order `main()` takes: `installSignalHandlers` first, then
   * `runGateSet`, whose handlers register later. With a signal, the command under the gate set records the signal it receives
   * (`received`) and the driver is signalled once the command reports that it is running.
   */
  async function drive(
    signal: NodeJS.Signals | undefined,
    readySignal?: NodeJS.Signals,
  ): Promise<{ status: number | null; world: PrepareWorld; stderr: string; received: string | undefined }> {
    const world = newWorld();
    const driver = path.join(world.root, "driver.mjs");
    const received = path.join(world.root, "signal-received");
    const running = path.join(world.root, "command-running");
    const url = (relative: string): string => `file://${path.join(REPO_ROOT, relative)}`;
    // The command ends by itself after 10 s, so a handler that never reaches it cannot leave it behind.
    const commandSource = [
      "const fs = require('node:fs');",
      `for (const name of ['SIGINT', 'SIGTERM']) process.on(name, () => { fs.writeFileSync(${JSON.stringify(received)}, name); process.exit(0); });`,
      `fs.writeFileSync(${JSON.stringify(running)}, 'running');`,
      "setTimeout(() => process.exit(3), 10000);",
      "setInterval(() => {}, 1000);",
    ].join(" ");
    writeFileSync(
      driver,
      [
        `const { createCleanups, installSignalHandlers, runGateSet } = await import(${JSON.stringify(url("scripts/release.mjs"))});`,
        `const harness = await import(${JSON.stringify(url("scripts/throwaway-iris.mjs"))});`,
        `const checks = await import(${JSON.stringify(url("scripts/lib/ci-checks.mjs"))});`,
        "const env = JSON.parse(process.env.DRIVER_ENV);",
        "const harnessDeps = { ...harness.defaultDeps(env), webStatus: async () => 200 };",
        `const argv = process.env.DRIVER_SIGNAL ? [process.execPath, '-e', ${JSON.stringify(commandSource)}] : [process.execPath, '-e', '0'];`,
        "installSignalHandlers(createCleanups());",
        `const code = await runGateSet({ env, modules: { harness, checks }, harnessDeps, stateFile: ${JSON.stringify(path.join(world.root, "driver-state.json"))}, commands: [{ label: 'command', argv }], log: (line) => console.error(line) });`,
        "process.exit(code);",
        "",
      ].join("\n"),
    );
    const env = world.env(readySignal === undefined ? {} : { FAKE_DOCKER_READY_SIGNAL: readySignal });
    const child = spawn(process.execPath, [driver], { env: { PATH: process.env["PATH"] ?? "", DRIVER_ENV: JSON.stringify(env), ...(signal === undefined ? {} : { DRIVER_SIGNAL: "1" }) }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const closed = new Promise<number | null>((resolve) => child.once("close", (status) => resolve(status)));
    if (signal !== undefined) {
      for (let waited = 0; !existsSync(running); waited += 1) {
        if (waited > 600) throw new Error(`the command never started: ${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      child.kill(signal);
    }
    const status = await closed;
    // The command records the signal after the driver has exited, so give it time.
    for (let waited = 0; signal !== undefined && !existsSync(received) && waited < 200; waited += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    return { status, world, stderr, received: existsSync(received) ? readFileSync(received, "utf8") : undefined };
  }

  it("as a real process: SIGTERM during a command removes the container, reaches the command and exits 143; SIGINT does the same and exits 130", async () => {
    for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]] as const) {
      const { status, world, stderr, received } = await drive(signal);
      expect(status, stderr).toBe(code);
      expect(dockerVerbs(world.docker), signal).toContain("rm");
      expect(world.docker.containers(), signal).toEqual({});
      expect(received, `${signal} reached the running command, though main()'s handlers were installed first`).toBe(signal);
    }
  }, 60_000);

  it("as a real process: a signal while the container is still starting removes it too", async () => {
    const { status, world, stderr } = await drive(undefined, "SIGTERM");
    expect(status, stderr).toBe(143);
    expect(world.docker.containers()).toEqual({});
  }, 60_000);

  it("as a real process: a command that finishes ends the run with exit 0 and the container removed by `down`", async () => {
    const { status, world, stderr } = await drive(undefined);
    expect(status, stderr).toBe(0);
    expect(world.docker.containers()).toEqual({});
    expect(dockerVerbs(world.docker).filter((verb) => verb === "rm")).toHaveLength(1);
  }, 60_000);
});

describe("installSignalHandlers, which main() installs before any command runs (AC 42.5.2)", () => {
  /** An event emitter that stands for `process`: `emit` fires the listeners in registration order, `exit` records the code. */
  function fakeProcess(): EventEmitter & { exit: (code: number) => void; exits: number[] } {
    const exits: number[] = [];
    return Object.assign(new EventEmitter(), { exit: (code: number) => void exits.push(code), exits });
  }

  it("a signal runs the cleanups and ends the process from setImmediate, so a listener registered later for the same signal still runs before it ends", async () => {
    for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
      const proc = fakeProcess();
      const cleanups = createCleanups();
      const cleaned: string[] = [];
      cleanups.add(() => cleaned.push("cleanup"));
      installSignalHandlers(cleanups, proc as never);
      const later: string[] = [];
      proc.once(signal, () => later.push(`${signal} with ${proc.exits.length} exits`));
      proc.emit(signal);
      expect(cleaned, "the cleanups ran").toEqual(["cleanup"]);
      expect(later, "the later listener ran while the process had not yet exited").toEqual([`${signal} with 0 exits`]);
      expect(proc.exits).toEqual([]);
      await new Promise((resolve) => setImmediate(resolve));
      expect(proc.exits, signal).toEqual([code]);
    }
  });

  it("a signal kills the child processes that runCaptured started, and the exit handler runs the cleanups once", async () => {
    const proc = fakeProcess();
    const cleanups = createCleanups();
    let cleaned = 0;
    cleanups.add(() => (cleaned += 1));
    installSignalHandlers(cleanups, proc as never);
    const running = runCaptured([process.execPath, "-e", "setInterval(() => {}, 1000)"], { timeoutMs: 20_000 });
    proc.emit("SIGTERM");
    const result = await running;
    expect(result.status).toBeNull();
    expect(result.error?.message).toBe("ended by SIGTERM");
    proc.emit("exit");
    expect(cleaned, "the cleanups run once, however many times they are asked").toBe(1);
  });
});
