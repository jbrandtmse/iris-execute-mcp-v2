/**
 * Story 41.7 -- DW-611: the turbo graph of the `test` tasks, read from the working tree's `turbo.json` by turbo itself.
 *
 * Two properties are pinned, each on the path that decides them (project rule #59):
 *
 *  - ORDER. `@iris-mcp/all#test` runs after `@iris-mcp/client-config#build`, so its tests never read a stale or unbuilt
 *    client-config dist. The edge is a turbo `pkg#task` entry; no package dependency is added (AD-2).
 *  - NO REPLAYED GREEN. No `test` task is cacheable, so a green result is never replayed after a change to a file that its
 *    tests read from outside the package (the suites read repository files that no input list fully names).
 *
 * The test copies the manifests turbo needs (the root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` and
 * `turbo.json`, and every `packages/*` `package.json` and package-level `turbo.json[c]`) into a temp directory and runs
 * `turbo run test --dry=json --cwd <copy>` from the repository's own turbo with a temp HOME and telemetry off. The dry
 * run runs no task, and the real tree is never written. Needs no IRIS and no build.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTempRoot, REPO_ROOT, removeTempRoot } from "./pack-fixture";

const TURBO = path.join(REPO_ROOT, "node_modules", "turbo", "bin", "turbo");

interface TurboTask {
  taskId: string;
  task: string;
  dependencies: string[];
  resolvedTaskDefinition: { cache?: boolean };
}

let copy: string;
let home: string;
let tasks: TurboTask[];
/** The name of every package under `packages/`, read from the manifests copied for turbo. */
let workspaceNames: string[];

function task(taskId: string): TurboTask {
  const found = tasks.find((entry) => entry.taskId === taskId);
  expect(found, `${taskId} is in the turbo dry run`).toBeDefined();
  return found as TurboTask;
}

beforeAll(() => {
  copy = makeTempRoot("story-41-7-turbo");
  home = makeTempRoot("story-41-7-turbo-home");
  for (const rel of ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "turbo.json"]) {
    copyFileSync(path.join(REPO_ROOT, rel), path.join(copy, rel));
  }
  workspaceNames = [];
  for (const entry of readdirSync(path.join(REPO_ROOT, "packages"), { withFileTypes: true })) {
    const manifest = path.join(REPO_ROOT, "packages", entry.name, "package.json");
    if (!entry.isDirectory() || !existsSync(manifest)) continue;
    mkdirSync(path.join(copy, "packages", entry.name), { recursive: true });
    copyFileSync(manifest, path.join(copy, "packages", entry.name, "package.json"));
    // A package-level turbo config overrides the root's task definitions, so turbo must see it too.
    for (const config of ["turbo.json", "turbo.jsonc"]) {
      const source = path.join(REPO_ROOT, "packages", entry.name, config);
      if (existsSync(source)) copyFileSync(source, path.join(copy, "packages", entry.name, config));
    }
    workspaceNames.push((JSON.parse(readFileSync(manifest, "utf8")) as { name: string }).name);
  }

  const run = spawnSync(process.execPath, [TURBO, "run", "test", "--dry=json", "--cwd", copy], {
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      TURBO_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
    },
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`turbo dry run failed (${String(run.status)}):\n${run.stdout}\n${run.stderr}`);
  tasks = (JSON.parse(run.stdout) as { tasks: TurboTask[] }).tasks;
});

afterAll(() => {
  if (copy !== undefined) removeTempRoot(copy);
  if (home !== undefined) removeTempRoot(home);
});

describe("the turbo graph of the test tasks (DW-611)", () => {
  it("@iris-mcp/all#test depends on its own build and on client-config's build", () => {
    const dependencies = task("@iris-mcp/all#test").dependencies;
    expect(dependencies).toContain("@iris-mcp/all#build");
    expect(dependencies).toContain("@iris-mcp/client-config#build");
  });

  it("the set of test tasks is not vacuous: it is one test task per package under packages/, the meta-package and client-config included", () => {
    const testTasks = tasks.filter((entry) => entry.task === "test").map((entry) => entry.taskId);
    expect(workspaceNames).toContain("@iris-mcp/all");
    expect(workspaceNames).toContain("@iris-mcp/client-config");
    expect([...testTasks].sort()).toEqual(workspaceNames.map((name) => `${name}#test`).sort());
  });

  it("every test task resolves to cache: false, so a green result is never replayed", () => {
    const testTasks = tasks.filter((entry) => entry.task === "test");
    for (const entry of testTasks) {
      expect(entry.resolvedTaskDefinition.cache, `${entry.taskId} cache`).toBe(false);
    }
  });

  it("build tasks stay cacheable (only the test tasks changed)", () => {
    const builds = tasks.filter((entry) => entry.task === "build");
    expect(builds.length).toBeGreaterThan(0);
    for (const entry of builds) {
      expect(entry.resolvedTaskDefinition.cache, `${entry.taskId} cache`).toBe(true);
    }
  });
});
