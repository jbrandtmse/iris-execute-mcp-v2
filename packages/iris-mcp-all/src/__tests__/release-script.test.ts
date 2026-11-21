/**
 * Story 42.5 (AC 42.5.1 to 42.5.4, DW-387, DW-675, DW-689; AD-29) -- the release script `scripts/release.mjs`: `ci-gate` and
 * `publish`, through injected dependencies and through scripted real processes. The `prepare` command and the gate set are in
 * `release-prepare.test.ts`.
 *
 * Every publish-shaped behavior runs against stand-ins that are the ONLY entries of the script's PATH (`stand-in-clis.ts`: `npm`, `git`,
 * `vsce`, `ovsx`) and a fake GitHub API (`release-script-fixtures.ts`), so no test can reach a registry, a store, a remote or GitHub. The
 * tests never read a real token: `NPM_TOKEN` and `GITHUB_TOKEN` hold made-up values or are absent.
 *
 * Rows of the I/O matrix covered here: CI gate (green, pending, red, API failure), Environment guard, Publish refusals, Publish auth,
 * Publish npm, Publish channels, Rehearse; and the static import list that lets `ci-gate`, `rehearse` and `publish` run with no
 * `node_modules`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findExecutable } from "../../../../scripts/throwaway-iris.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { stripComments } from "../../../../scripts/lib/script-ts-import-scan.mjs";
import { NPM_PUBLISH_ORDER, PLACEHOLDER_PUBLISHER, RELEASE_CHANNELS, SERVER_JSON_DIRS, githubKnownHostsText } from "../../../../scripts/lib/release-core.mjs";
import { ciGate, createCleanups, defaultDeps, isContainedPath, npmFailureDetail, packedTarballName, parseArgs, publish, redact, uploadPathProblems, verify } from "../../../../scripts/release.mjs";
import { installStandIns, type StandInCall, type StandInRule, type StandIns } from "./stand-in-clis";
import {
  SHA,
  ciRun,
  compareAnswer,
  makeArtifacts,
  newFakeGithub,
  protectedEnvironment,
  startGithubServer,
  startHangingServer,
  fakeFetch,
  HTML_PAGE,
  MCP_REGISTRY_MISS,
  fakeStoresFetch,
  marketplaceHit,
  mcpRegistryHit,
  newFakeStores,
  openVsxHit,
  storeAnswerFor,
  writeManifest,
  type ArtifactManifest,
  type FakeAnswer,
  type FakeGithub,
  type FakeStores,
} from "./release-script-fixtures";

const RELEASE_SCRIPT = path.join(REPO_ROOT, "scripts", "release.mjs");
const TOKEN = "npm_SECRETSECRETSECRET1234567890";
const GITHUB_TOKEN = "ghs_SECRETGITHUBTOKEN0987654321";

const roots: string[] = [];
const servers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of servers.splice(0)) await close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A scratch directory under `os.tmpdir()`, removed after the test. */
function scratch(prefix = "release-script-"): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/**
 * Run `body` with `os.tmpdir()` pointing at `directory` (it reads TMPDIR on every call), so that a test sees only the temporary
 * directories that the in-process run made, never another process's in the shared temporary directory.
 */
async function withTmpdir<T>(directory: string, body: () => Promise<T>): Promise<T> {
  const saved = process.env["TMPDIR"];
  process.env["TMPDIR"] = directory;
  try {
    return await body();
  } finally {
    if (saved === undefined) delete process.env["TMPDIR"];
    else process.env["TMPDIR"] = saved;
  }
}

// -- the script's own contract ---------------------------------------------------------------------------------------

describe("the script runs with no node_modules (Boundaries: ci-gate, rehearse and publish run without pnpm install)", () => {
  /** The specifiers of the static imports of a module (a dynamic import() is not one). */
  function staticImports(file: string): string[] {
    const code = stripComments(readFileSync(file, "utf8"));
    return [...code.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map((match) => match[1] as string);
  }

  it("scripts/release.mjs statically imports only node: builtins, release-core.mjs and script-process.mjs", () => {
    const specifiers = staticImports(RELEASE_SCRIPT);
    expect(specifiers.filter((specifier) => specifier.startsWith("node:")).sort()).toEqual([
      "node:child_process",
      "node:crypto",
      "node:fs",
      "node:os",
      "node:path",
      "node:url",
    ]);
    expect(specifiers.filter((specifier) => !specifier.startsWith("node:")).sort()).toEqual(["./lib/release-core.mjs", "./lib/script-process.mjs"]);
  });

  it("release-core.mjs and script-process.mjs import only node: builtins", () => {
    for (const file of ["release-core.mjs", "script-process.mjs"]) {
      const specifiers = staticImports(path.join(REPO_ROOT, "scripts", "lib", file));
      expect(specifiers.length, file).toBeGreaterThan(0);
      expect(specifiers.filter((specifier) => !specifier.startsWith("node:")), file).toEqual([]);
    }
  });

  it("every module that only prepare or verify needs is loaded by a dynamic import() inside its own loader, and nowhere else", () => {
    const code = stripComments(readFileSync(RELEASE_SCRIPT, "utf8"));
    const dynamic = [...code.matchAll(/(?<![\w$.])import\(/g)];
    expect(dynamic.length, "two import() calls: prepare's loader and verify's").toBe(2);
    const loader = /async function loadPrepareModules[\s\S]*?\n\}\n/.exec(code)?.[0] ?? "";
    expect(loader).toContain("import(pathToFileURL");
    for (const module of ["scripts/throwaway-iris.mjs", "scripts/lib/ci-checks.mjs", "scripts/lib/pnpm-pack.mjs", "scripts/ci-package-smoke.mjs", "scripts/lib/ipm-archive.mjs"]) {
      expect(loader, module).toContain(`'${module}'`);
    }
    const wireLoader = /async function loadVerifyWire[\s\S]*?\n\}\n/.exec(code)?.[0] ?? "";
    expect(wireLoader).toContain("import(pathToFileURL");
    expect(wireLoader).toContain("'scripts/lib/sdk-wire-golden-core.mjs'");
  });

  it("main() installs its signal handlers through installSignalHandlers and ends no run itself, so the gate set's handlers (registered later) still run", () => {
    const code = stripComments(readFileSync(RELEASE_SCRIPT, "utf8"));
    const main = /export async function main\([\s\S]*?\n\}\n/.exec(code)?.[0] ?? "";
    expect(main).toContain("installSignalHandlers(cleanups)");
    expect(main).not.toMatch(/process\.(?:once|on|exit)\(/);
    const installer = /export function installSignalHandlers\([\s\S]*?\n\}\n/.exec(code)?.[0] ?? "";
    expect(installer).toContain("setImmediate(() => proc.exit(code))");
    expect(installer).not.toMatch(/\n\s*proc\.exit\(code\)/);
  });

  it("a copy of the script with only release-core.mjs and script-process.mjs beside it, far from any node_modules, loads and prints its usage", async () => {
    const directory = scratch("release-isolated-");
    mkdirSync(path.join(directory, "scripts", "lib"), { recursive: true });
    copyFileSync(RELEASE_SCRIPT, path.join(directory, "scripts", "release.mjs"));
    for (const file of ["release-core.mjs", "script-process.mjs"]) copyFileSync(path.join(REPO_ROOT, "scripts", "lib", file), path.join(directory, "scripts", "lib", file));
    writeFileSync(path.join(directory, "package.json"), '{"type":"module"}\n');
    const result = await runNode([path.join(directory, "scripts", "release.mjs")], { PATH: "/nonexistent" });
    expect(result.stderr).toContain("usage: node scripts/release.mjs ci-gate");
    expect(result.status, "a usage refusal").toBe(2);
    expect(existsSync(path.join(directory, "node_modules"))).toBe(false);
  });

  it("the command line: four commands, their flags, and exit code 2 for anything else", () => {
    expect(parseArgs(["verify", "--version", "1.0.0"])).toEqual({ command: "verify", options: { version: "1.0.0" } });
    expect(parseArgs(["--", "verify", "--version", "1.2.3"])).toEqual({ command: "verify", options: { version: "1.2.3" } });
    for (const bad of [["verify", "--version"], ["verify", "--version", "1.0"], ["verify", "--version", "v1.0.0"], ["verify", "--version", "1.0.0-rc.1"], ["verify", "--version", "1.0.0", "--version", "1.0.1"], ["verify", "--version", "1.0.0", "--dry-run"], ["verify", "--version", "1.0.0", "--force"], ["verify", "--out", "/x"]]) {
      expect(() => parseArgs(bad), JSON.stringify(bad)).toThrow(/usage: node scripts\/release\.mjs/);
    }
    expect(parseArgs(["ci-gate"])).toEqual({ command: "ci-gate", options: {} });
    expect(parseArgs(["ci-gate", "--timeout-minutes", "5"])).toEqual({ command: "ci-gate", options: { timeoutMinutes: 5 } });
    expect(parseArgs(["prepare", "--out", "/x"])).toEqual({ command: "prepare", options: { out: "/x" } });
    expect(parseArgs(["publish", "--artifacts", "/x"])).toEqual({ command: "publish", options: { artifacts: "/x", dryRun: false } });
    expect(parseArgs(["publish", "--dry-run", "--artifacts", "/x"])).toEqual({ command: "publish", options: { artifacts: "/x", dryRun: true } });
    expect(parseArgs(["publish", "--artifacts", "/x", "--dry-run"]).options).toEqual({ artifacts: "/x", dryRun: true });
    for (const bad of [[], ["verify"], ["prepare"], ["publish"], ["publish", "--artifacts"], ["ci-gate", "--timeout-minutes", "0"], ["ci-gate", "--timeout-minutes", "x"], ["prepare", "--dry-run", "--out", "/x"], ["publish", "--artifacts", "/x", "--force"], ["publish", "--dry-run", "--dry-run", "--artifacts", "/x"], ["--"], ["--", "--", "ci-gate"]]) {
      expect(() => parseArgs(bad), JSON.stringify(bad)).toThrow(/usage: node scripts\/release\.mjs/);
    }
  });

  it("`pnpm release -- <command>` works: pnpm 9.15 hands the script a literal `--`, and one leading `--` is dropped", () => {
    expect(parseArgs(["--", "publish", "--dry-run", "--artifacts", "/x"])).toEqual(parseArgs(["publish", "--dry-run", "--artifacts", "/x"]));
    expect(parseArgs(["--", "ci-gate"])).toEqual({ command: "ci-gate", options: {} });
  });
});

/** Run `node <args>` as a real process with exactly `env`; resolves with its exit code and output. */
function runNode(args: string[], env: Record<string, string>, onStart?: (pid: number) => void): Promise<{ status: number | null; signal: string | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    onStart?.(child.pid as number);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

/** Copy `scripts/release.mjs` and the two modules it imports into `<root>/scripts`, and return the copy: a process run from it has `<root>` as its repository root. */
function copyScriptInto(root: string): string {
  mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
  copyFileSync(RELEASE_SCRIPT, path.join(root, "scripts", "release.mjs"));
  copyFileSync(path.join(REPO_ROOT, "scripts", "lib", "script-process.mjs"), path.join(root, "scripts", "lib", "script-process.mjs"));
  // The process-level rows are about npm and the two stores: the copy's IPM and MCP Registry channels are off (their rows run in process, with their own stand-ins).
  let core = readFileSync(path.join(REPO_ROOT, "scripts", "lib", "release-core.mjs"), "utf8");
  for (const id of ["ipm", "mcp-registry"]) {
    const enabled = `Object.freeze({ id: '${id}', enabled: true })`;
    if (!core.includes(enabled)) throw new Error(`release-core.mjs no longer declares the channel ${id} as ${enabled}`);
    core = core.replace(enabled, `Object.freeze({ id: '${id}', enabled: false, enabledBy: 'the process-level rows' })`);
  }
  writeFileSync(path.join(root, "scripts", "lib", "release-core.mjs"), core);
  return path.join(root, "scripts", "release.mjs");
}

// -- ci-gate ---------------------------------------------------------------------------------------------------------

/** The dependencies of an in-process run: the fake API, a clock that only `sleep` moves, and a log. */
function gateDeps(github: FakeGithub) {
  const lines: string[] = [];
  const sleeps: number[] = [];
  let now = 0;
  return {
    lines,
    sleeps,
    deps: {
      ...defaultDeps(),
      fetch: fakeFetch(github),
      log: (line: string) => lines.push(line),
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    },
  };
}

const TAG_ENV = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.0.0", GITHUB_SHA: SHA, GITHUB_TOKEN, GITHUB_REPOSITORY: "o/r" };
const DRY_ENV = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/release-dry-run/42-5", GITHUB_SHA: SHA, GITHUB_TOKEN, GITHUB_REPOSITORY: "o/r" };

describe("CI gate (AC 42.5.1)", () => {
  it("green: a completed success run of ci.yml on the sha passes at once and prints the run URL", async () => {
    const github = newFakeGithub();
    const { lines, sleeps, deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(0);
    expect(sleeps).toEqual([]);
    expect(lines.join("\n")).toContain("ci.yml is green on " + SHA + ": https://github.com/o/r/actions/runs/7");
    expect(github.requests.some((request) => request === `/repos/o/r/actions/runs?head_sha=${SHA}&per_page=100`)).toBe(true);
    expect(new Set(github.authorizations)).toEqual(new Set([`Bearer ${GITHUB_TOKEN}`]));
    expect(lines.join("\n"), "the token is never logged").not.toContain(GITHUB_TOKEN);
  });

  it("pending: no run yet, then one going, then a success: it polls every 60 s and passes when one succeeds", async () => {
    const github = newFakeGithub();
    const answers = [[], [ciRun({ status: "in_progress", conclusion: null })], [ciRun({ status: "in_progress", conclusion: null }), ciRun({ id: 8 })]];
    github.runs = () => ({ status: 200, body: { workflow_runs: answers.shift() ?? [] } });
    const { lines, sleeps, deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(0);
    expect(sleeps).toEqual([60_000, 60_000]);
    expect(lines.join("\n")).toMatch(/waiting: no \.github\/workflows\/ci\.yml run on c+ yet/);
    expect(lines.join("\n")).toMatch(/waiting: https:\/\/github\.com\/o\/r\/actions\/runs\/7: in_progress/);
  });

  it("timeout: still pending after --timeout-minutes, it exits 1 naming the sha", async () => {
    const github = newFakeGithub();
    github.runs = () => ({ status: 200, body: { workflow_runs: [] } });
    const { lines, sleeps, deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV, timeoutMinutes: 3 }, deps)).toBe(1);
    expect(sleeps).toEqual([60_000, 60_000, 60_000]);
    expect(lines.join("\n")).toContain(`no green .github/workflows/ci.yml run on ${SHA} within 3 minutes`);
  });

  it("the default timeout is 180 minutes", async () => {
    const github = newFakeGithub();
    github.runs = () => ({ status: 200, body: { workflow_runs: [ciRun({ status: "queued", conclusion: null })] } });
    const { sleeps, deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(1);
    expect(sleeps.length).toBe(180);
  });

  it("red: every run completed and none succeeded exits 1 at once, listing each run's URL and conclusion", async () => {
    const github = newFakeGithub();
    github.runs = () => ({ status: 200, body: { workflow_runs: [ciRun({ id: 1, html_url: "https://x/1", conclusion: "failure" }), ciRun({ id: 2, html_url: "https://x/2", conclusion: "cancelled" })] } });
    const { lines, sleeps, deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(1);
    expect(sleeps).toEqual([]);
    const text = lines.join("\n");
    expect(text).toContain("every .github/workflows/ci.yml run on " + SHA + " completed and none succeeded");
    expect(text).toContain("https://x/1: failure");
    expect(text).toContain("https://x/2: cancelled");
  });

  it("API failure: a non-2xx answer exits 1 naming the status (it fails closed), and so does a network error", async () => {
    const github = newFakeGithub();
    github.runs = () => ({ status: 500, body: { message: "boom" } });
    const failing = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, failing.deps)).toBe(1);
    expect(failing.lines.join("\n")).toMatch(/could not be read \(HTTP 500\)\. .*fails closed/);

    const lines: string[] = [];
    const broken = { ...defaultDeps(), fetch: (async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch, log: (line: string) => lines.push(line), now: () => 0, sleep: async () => undefined };
    expect(await ciGate({ env: TAG_ENV }, broken)).toBe(1);
    expect(lines.join("\n")).toMatch(/could not be read \(socket hang up\)/);
  });

  it("a green pull-request run on the sha (it built the merge ref) does not pass the gate: alone it waits out the timeout, next to a failed push run it is red at once", async () => {
    const pullRequest = ciRun({ id: 9, html_url: "https://x/9", event: "pull_request", path: ".github/workflows/ci.yml@refs/pull/7/merge" });
    const github = newFakeGithub();
    github.runs = () => ({ status: 200, body: { workflow_runs: [pullRequest] } });
    const waiting = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV, timeoutMinutes: 2 }, waiting.deps)).toBe(1);
    expect(waiting.sleeps).toEqual([60_000, 60_000]);
    expect(waiting.lines.join("\n")).toContain(`no green .github/workflows/ci.yml run on ${SHA} within 2 minutes`);

    github.runs = () => ({ status: 200, body: { workflow_runs: [pullRequest, ciRun({ id: 2, html_url: "https://x/2", conclusion: "failure" })] } });
    const red = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, red.deps)).toBe(1);
    expect(red.sleeps).toEqual([]);
    expect(red.lines.join("\n")).toContain("https://x/2: failure");
    expect(red.lines.join("\n"), "the pull-request run is not one of the commit's runs").not.toContain("https://x/9");
  });

  it("a run that throws still appends its lines to the step summary, as exit 1, and the error reaches the caller", async () => {
    const github = newFakeGithub();
    const { deps } = gateDeps(github);
    const summary = path.join(scratch(), "ci-gate-summary.md");
    const broken = { ...deps, now: () => { throw new Error("the clock broke"); } };
    await expect(ciGate({ env: { ...TAG_ENV, GITHUB_STEP_SUMMARY: summary } }, broken)).rejects.toThrow(/the clock broke/);
    expect(readFileSync(summary, "utf8")).toContain("### ci-gate (exit 1)");
    expect(readFileSync(summary, "utf8"), "the lines before the throw").toContain("environment release: protected");
  });

  it("a malformed tag, or a missing token, repository or sha, is a refusal (exit 2) that reads nothing", async () => {
    const github = newFakeGithub();
    const malformed = gateDeps(github);
    expect(await ciGate({ env: { ...TAG_ENV, GITHUB_REF: "refs/tags/v1.0.0-rc.1" } }, malformed.deps)).toBe(2);
    expect(malformed.lines.join("\n")).toContain("the tag v1.0.0-rc.1 is not v<MAJOR.MINOR.PATCH>");
    for (const missing of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "GITHUB_SHA"]) {
      const env: Record<string, string> = { ...TAG_ENV };
      delete env[missing];
      expect(await ciGate({ env }, gateDeps(github).deps), missing).toBe(2);
    }
    expect(github.requests).toEqual([]);
  });
});

describe("Environment guard at ci-gate (AC 42.5.1; Decision #75)", () => {
  it("a tag run with a protected environment prints its summary and goes on to CI", async () => {
    const github = newFakeGithub();
    const { lines, deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(0);
    expect(lines.join("\n")).toContain("environment release: protected (required reviewers: jbrandtmse; admin bypass off; tags v*)");
    expect(github.requests[0]).toBe("/repos/o/r/environments/release");
    expect(github.requests[1]).toBe("/repos/o/r/environments/release/deployment-branch-policies");
  });

  it.each([
    ["missing", { status: 404, body: { message: "Not Found" } } as FakeAnswer, /environment release: missing, or not readable with this token \(HTTP 404\)/],
    ["unreadable", { status: 403, body: { message: "Forbidden" } } as FakeAnswer, /environment release: unreadable \(HTTP 403\)/],
    ["a server error", { status: 502 } as FakeAnswer, /unreadable \(HTTP 502\)/],
    ["unprotected (no reviewer)", protectedEnvironment({ protection_rules: [] }), /environment release: unprotected\. .*no required reviewer/],
    ["unprotected (admin bypass)", protectedEnvironment({ can_admins_bypass: true }), /unprotected\. .*administrators can bypass/],
    ["unprotected (not restricted to a tag rule)", protectedEnvironment({ deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }), /unprotected\. .*not exactly one tag rule v\*/],
  ])("a tag run with the environment %s exits 1 before it reads CI, so no later job runs", async (_label, environment, expected) => {
    const github = newFakeGithub();
    github.environment = environment;
    const { lines, deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(1);
    expect(lines.join("\n")).toMatch(expected);
    expect(lines.join("\n")).toContain("refusing the tag run");
    expect(github.requests.some((request) => request.includes("/actions/runs")), "CI was never asked").toBe(false);
  });

  it("a tag run whose deployment rules are two rules, or a branch rule, is refused", async () => {
    for (const branchPolicies of [[{ name: "v*", type: "tag" }, { name: "main", type: "branch" }], [{ name: "v*", type: "branch" }], []]) {
      const github = newFakeGithub();
      github.policies = { status: 200, body: { branch_policies: branchPolicies } };
      const { deps } = gateDeps(github);
      expect(await ciGate({ env: TAG_ENV }, deps), JSON.stringify(branchPolicies)).toBe(1);
    }
  });

  it("a tag run whose environment cannot be asked (a network error) exits 1", async () => {
    const lines: string[] = [];
    const deps = { ...defaultDeps(), fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch, log: (line: string) => lines.push(line), now: () => 0, sleep: async () => undefined };
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(1);
    expect(lines.join("\n")).toContain("unreadable (offline)");
  });

  it("a dry run reports one line about a missing, unreadable or unprotected environment, says a tag run stops here, and goes on (exit 0)", async () => {
    for (const [environment, expected] of [
      [{ status: 404 }, /environment release: missing, or not readable with this token \(HTTP 404\); a tag run stops here/],
      [{ status: 403 }, /unreadable \(HTTP 403\); a tag run stops here/],
      [protectedEnvironment({ can_admins_bypass: true }), /unprotected\. .*; a tag run stops here/],
    ] as Array<[FakeAnswer, RegExp]>) {
      const github = newFakeGithub();
      github.environment = environment;
      const { lines, deps } = gateDeps(github);
      expect(await ciGate({ env: DRY_ENV }, deps)).toBe(0);
      expect(lines.join("\n")).toMatch(expected);
      expect(github.requests.some((request) => request.includes("/actions/runs")), "CI is still gated").toBe(true);
    }
  });

  it("a dry run with a protected environment prints the summary without the stop notice", async () => {
    const { lines, deps } = gateDeps(newFakeGithub());
    expect(await ciGate({ env: DRY_ENV }, deps)).toBe(0);
    expect(lines.join("\n")).toContain("environment release: protected (required reviewers: jbrandtmse; admin bypass off; tags v*)");
    expect(lines.join("\n")).not.toContain("a tag run stops here");
  });

  it("a dry run still fails when CI is red", async () => {
    const github = newFakeGithub();
    github.runs = () => ({ status: 200, body: { workflow_runs: [ciRun({ conclusion: "failure" })] } });
    expect(await ciGate({ env: DRY_ENV }, gateDeps(github).deps)).toBe(1);
  });

  it("prevent_self_review is reported as a warning and does not fail the gate", async () => {
    const github = newFakeGithub();
    github.environment = protectedEnvironment({ protection_rules: [{ type: "required_reviewers", prevent_self_review: true, reviewers: [{ type: "User", reviewer: { login: "jbrandtmse" } }] }] });
    const { lines, deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(0);
    expect(lines.join("\n")).toMatch(/warning: the release environment prevents self-review/);
  });

  it("a GITHUB_API_URL other than the default is the API that is asked", async () => {
    const github = newFakeGithub();
    const server = await startGithubServer(github);
    servers.push(server.close);
    const { deps } = gateDeps(github);
    const real = { ...deps, fetch: (url: string, init?: RequestInit) => fetch(url, init) };
    expect(await ciGate({ env: { ...TAG_ENV, GITHUB_API_URL: server.url } }, real)).toBe(0);
    expect(github.requests.length).toBeGreaterThan(2);
  });
});

describe("Main reachability at ci-gate (Story 42.6; DW-696, decision #82): a tag run needs a commit that main contains", () => {
  const runsRead = (github: FakeGithub): boolean => github.requests.some((request) => request.includes("/actions/runs"));

  it.each(["identical", "behind"])("compare %s: the commit is on main, its line is printed, and the CI poll follows", async (status) => {
    const github = newFakeGithub();
    github.compare = compareAnswer(status);
    const { lines, deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(0);
    expect(lines.join("\n")).toContain(`ci-gate: commit ${SHA} is on main (compare: ${status})`);
    expect(runsRead(github), "CI was read after the compare").toBe(true);
  });

  it.each(["ahead", "diverged"])("compare %s: exit 1 with the refusal text, and the CI runs are never read", async (status) => {
    const github = newFakeGithub();
    github.compare = compareAnswer(status);
    const { lines, sleeps, deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(1);
    expect(lines.join("\n")).toContain(`ci-gate: refusing the tag run: ${SHA} is not on main (compare main...${SHA}: ${status}). Merge it to main, then tag the merged commit. No later job runs.`);
    expect(runsRead(github), "no /actions/runs request").toBe(false);
    expect(sleeps).toEqual([]);
  });

  it.each([
    ["a 404 (an unknown commit)", { status: 404, body: { message: "Not Found" } } as FakeAnswer, /\(HTTP 404\)/],
    ["a 500", { status: 500 } as FakeAnswer, /\(HTTP 500\)/],
    ["a 403", { status: 403, body: { message: "Forbidden" } } as FakeAnswer, /\(HTTP 403\)/],
    ["a body without a status", { status: 200, body: { total_commits: 0 } } as FakeAnswer, /holds no known status/],
    ["a status that is not a compare status", { status: 200, body: { status: "mystery" } } as FakeAnswer, /"mystery"/],
  ])("%s: exit 1 naming the cause, before the CI poll", async (_label, answer, expected) => {
    const github = newFakeGithub();
    github.compare = answer;
    const { lines, deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(1);
    expect(lines.join("\n")).toContain(`refusing the tag run: whether ${SHA} is on main could not be read (`);
    expect(lines.join("\n")).toMatch(expected);
    expect(runsRead(github), "CI was never asked").toBe(false);
  });

  it("a network error on the compare alone, and a compare that stalls, each exit 1 before the CI poll (fails closed)", async () => {
    const github = newFakeGithub();
    const server = await startHangingServer();
    servers.push(server.close);
    const hanging = defaultDeps({ fetchTimeoutMs: 100 });
    for (const [label, compareFetch, expected] of [
      ["a network error", (async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch, /\(socket hang up\)/],
      ["a stall", ((_url: string, init?: RequestInit) => hanging.fetch(server.url, init)) as unknown as typeof fetch, /could not be read \(.+\)/],
    ] as Array<[string, typeof fetch, RegExp]>) {
      const lines: string[] = [];
      const base = fakeFetch(github);
      const deps = {
        ...defaultDeps(),
        fetch: ((url: string, init?: RequestInit) => (url.includes("/compare/") ? compareFetch(url, init) : base(url, init))) as unknown as typeof fetch,
        log: (line: string) => lines.push(line),
        now: () => 0,
        sleep: async () => undefined,
      };
      expect(await ciGate({ env: TAG_ENV }, deps), label).toBe(1);
      expect(lines.join("\n"), label).toMatch(expected);
      expect(runsRead(github), `${label}: CI was never asked`).toBe(false);
    }
  });

  it("an unprotected environment and an off-main commit print both refusals, exit 1, and the compare call still ran", async () => {
    const github = newFakeGithub();
    github.environment = protectedEnvironment({ can_admins_bypass: true });
    github.compare = compareAnswer("ahead");
    const { lines, deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(1);
    const refusals = lines.filter((line) => line.startsWith("ci-gate: refusing the tag run: "));
    expect(refusals).toHaveLength(2);
    expect(refusals[0]).toContain("administrators can bypass");
    expect(refusals[1]).toContain(`${SHA} is not on main (compare main...${SHA}: ahead)`);
    expect(github.requests.some((request) => request.includes("/compare/main...")), "the compare was read").toBe(true);
    expect(runsRead(github)).toBe(false);
  });

  it("the main check comes after the environment guard and before the CI poll, and asks for main...<sha> with the token", async () => {
    const github = newFakeGithub();
    const { deps } = gateDeps(github);
    expect(await ciGate({ env: TAG_ENV }, deps)).toBe(0);
    expect(github.requests).toEqual([
      "/repos/o/r/environments/release",
      "/repos/o/r/environments/release/deployment-branch-policies",
      `/repos/o/r/compare/main...${SHA}?per_page=1`,
      `/repos/o/r/actions/runs?head_sha=${SHA}&per_page=100`,
    ]);
    expect(new Set(github.authorizations)).toEqual(new Set([`Bearer ${GITHUB_TOKEN}`]));
  });

  it.each([
    ["ahead", /ci-gate: commit c+ is not on main \(compare: ahead\); a tag run stops here/],
    ["diverged", /is not on main \(compare: diverged\); a tag run stops here/],
  ])("a dry run on a commit that is %s reports one line, says a tag run stops here, and goes on (exit 0 on a green run)", async (status, expected) => {
    const github = newFakeGithub();
    github.compare = compareAnswer(status);
    const { lines, deps } = gateDeps(github);
    expect(await ciGate({ env: DRY_ENV }, deps)).toBe(0);
    expect(lines.join("\n")).toMatch(expected);
    expect(lines.join("\n")).not.toContain("refusing the tag run");
    expect(runsRead(github), "CI is still gated").toBe(true);
  });

  it("a dry run with an unreadable compare reports it and goes on; with an on-main commit it reports the plain line", async () => {
    const unreadable = newFakeGithub();
    unreadable.compare = { status: 404, body: { message: "Not Found" } };
    const first = gateDeps(unreadable);
    expect(await ciGate({ env: DRY_ENV }, first.deps)).toBe(0);
    expect(first.lines.join("\n")).toMatch(/commit c+: unreadable \(HTTP 404\); a tag run stops here/);

    const onMain = gateDeps(newFakeGithub());
    expect(await ciGate({ env: DRY_ENV }, onMain.deps)).toBe(0);
    expect(onMain.lines.join("\n")).toContain(`commit ${SHA} is on main (compare: identical)`);
    expect(onMain.lines.join("\n")).not.toContain("a tag run stops here");
  });

  it("a dry run on an off-main commit still fails when CI is red (the report line never rescues it)", async () => {
    const github = newFakeGithub();
    github.compare = compareAnswer("ahead");
    github.runs = () => ({ status: 200, body: { workflow_runs: [ciRun({ conclusion: "failure" })] } });
    expect(await ciGate({ env: DRY_ENV }, gateDeps(github).deps)).toBe(1);
  });

  it("ci-gate as a real process: an off-main tag run exits 1 with the refusal on stderr and the step summary, and reads no CI run", async () => {
    const github = newFakeGithub();
    github.compare = compareAnswer("ahead");
    const server = await startGithubServer(github);
    servers.push(server.close);
    const summary = path.join(scratch(), "summary.md");
    const result = await runNode([RELEASE_SCRIPT, "ci-gate"], { ...TAG_ENV, GITHUB_API_URL: server.url, GITHUB_STEP_SUMMARY: summary });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(`refusing the tag run: ${SHA} is not on main (compare main...${SHA}: ahead)`);
    expect(readFileSync(summary, "utf8")).toContain("### ci-gate (exit 1)");
    expect(github.requests.some((request) => request.includes("/actions/runs"))).toBe(false);
  });
});

describe("A stalled connection ends in a failure, not in a hung job (AC 42.5.1: ci-gate fails closed)", () => {
  /** What a `fetch` of a server that never answers settles as, within `waitMs`. */
  async function settled(request: Promise<unknown>, waitMs: number): Promise<string> {
    return Promise.race([request.then(() => "resolved", (error: Error) => `rejected: ${error.name}`), new Promise<string>((resolve) => setTimeout(() => resolve("hung"), waitMs))]);
  }

  it("defaultDeps().fetch aborts a request that is never answered after fetchTimeoutMs: the promise rejects", async () => {
    const server = await startHangingServer();
    servers.push(server.close);
    expect(await settled(defaultDeps({ fetchTimeoutMs: 100 }).fetch(server.url), 5_000)).toMatch(/^rejected: /);
  });

  it("a request that is given its own signal keeps it: the default timeout is not added over it", async () => {
    const server = await startHangingServer();
    servers.push(server.close);
    const controller = new AbortController();
    const request = defaultDeps({ fetchTimeoutMs: 50 }).fetch(server.url, { signal: controller.signal });
    expect(await settled(request, 400), "still waiting after the default timeout would have fired").toBe("hung");
    controller.abort();
    expect(await settled(request, 5_000)).toBe("rejected: AbortError");
  });

  it("ci-gate over a GitHub API that stalls exits 1 and says the CI runs could not be read", async () => {
    const server = await startHangingServer();
    servers.push(server.close);
    const lines: string[] = [];
    const deps = { ...defaultDeps({ fetchTimeoutMs: 100 }), log: (line: string) => lines.push(line), now: () => 0, sleep: async () => undefined };
    expect(await ciGate({ env: { ...DRY_ENV, GITHUB_API_URL: server.url } }, deps)).toBe(1);
    expect(lines.join("\n")).toMatch(/the CI runs of c+ could not be read \(.+\)\. Fix the token or the API, and run the release again; it fails closed\./);
  });

  it("the default timeout is 30 seconds, added to a request that has no signal and not to one that has", async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const timeouts: number[] = [];
    const originalFetch = globalThis.fetch;
    const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
    globalThis.fetch = (async (_url: unknown, init?: { signal?: AbortSignal | null }) => {
      seen.push(init?.signal);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    AbortSignal.timeout = (milliseconds: number) => {
      timeouts.push(milliseconds);
      return originalTimeout(milliseconds);
    };
    try {
      await defaultDeps().fetch("http://127.0.0.1:1/");
      const own = new AbortController();
      await defaultDeps().fetch("http://127.0.0.1:1/", { signal: own.signal });
      expect(seen[1], "the caller's own signal is passed through untouched").toBe(own.signal);
    } finally {
      globalThis.fetch = originalFetch;
      AbortSignal.timeout = originalTimeout;
    }
    expect(seen[0], "a timeout signal is added").toBeInstanceOf(AbortSignal);
    expect(timeouts, "one timeout, of 30 seconds").toEqual([30_000]);
  });
});

// -- publish ---------------------------------------------------------------------------------------------------------

/** The default answers of the stand-in `npm`: version 11.12.1, nothing is published yet, a publish succeeds. */
const NPM_DEFAULT: StandInRule[] = [
  { match: ["--version"], stdout: "11.12.1\n" },
  { match: ["view"], status: 1, stderr: "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/x\n" },
  { match: ["publish"], stdout: "+ published\n" },
];

/** The registry's answers for the IPM package; 404 means the package is not registered. */
interface Registry {
  answer: FakeAnswer;
}

interface PublishWorld {
  root: string;
  artifacts: string;
  repo: string;
  standIns: StandIns;
  github: FakeGithub;
  registry: Registry;
  /** The fake stores: what the Marketplace and Open VSX answer to the read-only lookups. */
  stores: FakeStores;
  manifest: ArtifactManifest;
  lines: string[];
  env: (overrides?: Record<string, string | undefined>) => Record<string, string>;
  run: (options?: { dryRun?: boolean; env?: Record<string, string | undefined>; channels?: unknown; deps?: Record<string, unknown> }) => Promise<number>;
  published: () => StandInCall[];
}

/** A fixture world: artifacts, stand-ins on PATH, a fake GitHub API, a fixture repository root with the extension's stand-in CLIs. */
function newWorld(options: { publisher?: string; vsixVersion?: string } = {}): PublishWorld {
  const root = scratch();
  const artifacts = path.join(root, "artifacts");
  const repo = path.join(root, "repo");
  mkdirSync(artifacts, { recursive: true });
  // The default publisher is a real one (the channels are enabled by default, and the placeholder is not ready); a test of the placeholder names it.
  const manifest = makeArtifacts(artifacts, { publisher: options.publisher ?? "iris-mcp", ...(options.vsixVersion === undefined ? {} : { vsixVersion: options.vsixVersion }) });
  const standIns = installStandIns(path.join(root, "stand-ins"), ["npm", "git"]);
  const extensionBin = path.join(repo, "extensions", "iris-mcp-launcher", "node_modules", ".bin");
  standIns.installInto("vsce", extensionBin);
  standIns.installInto("ovsx", extensionBin);
  standIns.script("npm", NPM_DEFAULT);
  const github = newFakeGithub();
  const registry: Registry = { answer: { status: 404, body: { error: "not found" } } };
  const stores = newFakeStores();
  const lines: string[] = [];
  const baseEnv = (overrides: Record<string, string | undefined> = {}): Record<string, string> => {
    const env: Record<string, string | undefined> = {
      PATH: standIns.binDir,
      STAND_IN_DIR: standIns.dir,
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/tags/v1.0.0",
      GITHUB_SHA: SHA,
      GITHUB_TOKEN,
      GITHUB_REPOSITORY: "o/r",
      GITHUB_API_URL: "https://api.github.com",
      ...overrides,
    };
    return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  };
  const fetchImpl = fakeFetch(github, (url, init) => (url.startsWith("https://pm.community.intersystems.com/") ? registry.answer : storeAnswerFor(stores, url, init)));
  return {
    root,
    artifacts,
    repo,
    standIns,
    github,
    registry,
    stores,
    manifest,
    lines,
    env: baseEnv,
    run: (runOptions = {}) =>
      publish(
        {
          artifacts,
          dryRun: runOptions.dryRun ?? false,
          env: baseEnv(runOptions.env),
          repoRoot: repo,
          ...(runOptions.channels === SCRIPT_DEFAULT_CHANNELS ? {} : { channels: (runOptions.channels ?? STORES_DEFAULT) as typeof RELEASE_CHANNELS }),
        },
        { ...defaultDeps(), fetch: fetchImpl, log: (line: string) => lines.push(line), cleanups: createCleanups(), ...(runOptions.deps ?? {}) },
      ),
    published: () => standIns.calls("npm").filter((call) => call.argv[0] === "publish"),
  };
}

/** Passed as `channels`, it leaves the option out of the call, so the script publishes its own default channels (all five of RELEASE_CHANNELS). */
const SCRIPT_DEFAULT_CHANNELS = Symbol("the script's default channels");

/** What a helper run with no `channels` option publishes: npm and the two stores, with IPM off and the MCP Registry not listed (the registry's own rows pass their own channels). */
const STORES_DEFAULT = [
  { id: "npm", enabled: true },
  { id: "vscode-marketplace", enabled: true },
  { id: "open-vsx", enabled: true },
  { id: "ipm", enabled: false, enabledBy: "Story 42.8" },
];

/** npm, the two stores and IPM enabled, for the stand-ins; the MCP Registry is not listed. */
const ALL_ENABLED = [...RELEASE_CHANNELS.filter((channel: { id: string }) => channel.id !== "mcp-registry").map((channel: { id: string }) => ({ id: channel.id, enabled: true }))];

/** npm and IPM enabled, the stores disabled. */
const IPM_ONLY = [{ id: "npm", enabled: true }, { id: "vscode-marketplace", enabled: false, enabledBy: "test" }, { id: "open-vsx", enabled: false, enabledBy: "test" }, { id: "ipm", enabled: true }];

/** Only npm enabled: the two stores and IPM are not, each with the story that enables it. */
const NPM_ONLY = [{ id: "npm", enabled: true }, { id: "vscode-marketplace", enabled: false, enabledBy: "Story 42.7" }, { id: "open-vsx", enabled: false, enabledBy: "Story 42.7" }, { id: "ipm", enabled: false, enabledBy: "Story 42.8" }];

/** The tarball path argument of an npm publish call, relative to the artifacts. */
const tarballOf = (call: StandInCall, artifacts: string): string => path.relative(artifacts, call.argv[1] as string);

describe("Publish refusals (exit 2 before any upload) (AC 42.5.2, AC 42.5.4)", () => {
  it.each([
    ["the event is not a push", { GITHUB_EVENT_NAME: "workflow_dispatch" }, /event is "workflow_dispatch", not push/],
    ["the ref is a branch", { GITHUB_REF: "refs/heads/release-dry-run/42-5" }, /ref is "refs\/heads\/release-dry-run\/42-5", not refs\/tags\/v1\.0\.0/],
    ["the tag is another version", { GITHUB_REF: "refs/tags/v1.0.1" }, /not refs\/tags\/v1\.0\.0/],
    ["GITHUB_SHA is not the prepared sha", { GITHUB_SHA: "d".repeat(40) }, /GITHUB_SHA is "d+", but the artifacts were prepared from/],
  ])("%s: exit 2, naming the condition, with no npm call at all", async (_label, overrides, expected) => {
    const world = newWorld();
    expect(await world.run({ env: overrides })).toBe(2);
    expect(world.lines.join("\n")).toMatch(expected);
    expect(world.standIns.allCalls()).toEqual([]);
    expect(world.github.requests, "not even the environment was asked").toEqual([]);
  });

  it("a manifest prepared in dry-run mode is refused", async () => {
    const world = newWorld();
    writeManifest(world.artifacts, { ...world.manifest, mode: "dry-run" });
    expect(await world.run()).toBe(2);
    expect(world.lines.join("\n")).toContain('prepared in "dry-run" mode, not release');
    expect(world.standIns.allCalls()).toEqual([]);
  });

  it("a tarball that no longer matches its hash is refused in real mode (exit 2) and fails a dry run (exit 1), before any upload", async () => {
    for (const dryRun of [false, true]) {
      const world = newWorld();
      writeFileSync(path.join(world.artifacts, "npm", "iris-mcp-shared-1.0.0.tgz"), "tampered\n");
      expect(await world.run({ dryRun }), `dryRun ${dryRun}`).toBe(dryRun ? 1 : 2);
      expect(world.lines.join("\n")).toContain("npm/iris-mcp-shared-1.0.0.tgz does not match its sha256");
      expect(world.published()).toEqual([]);
    }
  });

  it("a run that stops before its report still appends its lines to the step summary; a run with a report appends the report once", async () => {
    const refused = newWorld();
    const refusedSummary = path.join(refused.root, "summary-refused.md");
    expect(await refused.run({ env: { GITHUB_REF: "refs/tags/v1.0.1", GITHUB_STEP_SUMMARY: refusedSummary } })).toBe(2);
    expect(readFileSync(refusedSummary, "utf8")).toMatch(/^### publish \(exit 2\)\n[\s\S]*publish: refusing: the ref is "refs\/tags\/v1\.0\.1", not refs\/tags\/v1\.0\.0/);

    const tampered = newWorld();
    writeFileSync(path.join(tampered.artifacts, "npm", "iris-mcp-shared-1.0.0.tgz"), "tampered\n");
    const tamperedSummary = path.join(tampered.root, "summary-tampered.md");
    expect(await tampered.run({ dryRun: true, env: { GITHUB_STEP_SUMMARY: tamperedSummary } })).toBe(1);
    expect(readFileSync(tamperedSummary, "utf8")).toMatch(/^### publish --dry-run \(exit 1\)\n[\s\S]*problem: npm\/iris-mcp-shared-1\.0\.0\.tgz does not match its sha256/);

    const green = newWorld();
    const greenSummary = path.join(green.root, "summary-green.md");
    expect(await green.run({ dryRun: true, env: { GITHUB_STEP_SUMMARY: greenSummary } })).toBe(0);
    expect(readFileSync(greenSummary, "utf8").match(/^### /gm), "one heading: the report, and no second block of lines").toEqual(["### "]);
    expect(readFileSync(greenSummary, "utf8")).toContain("### Rehearsal 1.0.0");
  });

  it("a missing file, and a file the manifest does not list, are refused", async () => {
    const missing = newWorld();
    rmSync(path.join(missing.artifacts, "ipm", "README.md"));
    expect(await missing.run({ dryRun: true })).toBe(1);
    expect(missing.lines.join("\n")).toContain("ipm/README.md is listed in release-manifest.json but missing");

    const extra = newWorld();
    writeFileSync(path.join(extra.artifacts, "npm", "unlisted.tgz"), "x");
    expect(await extra.run({ dryRun: true })).toBe(1);
    expect(extra.lines.join("\n")).toContain("npm/unlisted.tgz is in the artifacts directory but not in release-manifest.json");
  });

  it("npm older than 11.5.1 is refused in real mode (exit 2) and fails a dry run (exit 1), before any upload", async () => {
    for (const dryRun of [false, true]) {
      const world = newWorld();
      world.standIns.script("npm", [{ match: ["--version"], stdout: "11.4.0\n" }, ...NPM_DEFAULT]);
      expect(await world.run({ dryRun }), `dryRun ${dryRun}`).toBe(dryRun ? 1 : 2);
      expect(world.lines.join("\n")).toMatch(/npm 11\.4\.0 is older than 11\.5\.1/);
      expect(world.published()).toEqual([]);
    }
  });

  it("an npm that cannot run is refused", async () => {
    const world = newWorld();
    expect(await world.run({ env: { PATH: path.join(world.root, "empty") } })).toBe(2);
    expect(world.lines.join("\n")).toMatch(/npm could not run/);
  });

  it("manifest packages out of the publish order are refused", async () => {
    const world = newWorld();
    const npm = world.manifest.channels.find((channel) => channel["id"] === "npm") as { packages: unknown[] };
    npm.packages.reverse();
    writeManifest(world.artifacts, world.manifest);
    expect(await world.run({ dryRun: true })).toBe(1);
    expect(world.lines.join("\n")).toContain("the manifest's packages are @iris-mcp/all");
  });

  it("a missing or unreadable manifest is a usage refusal", async () => {
    const world = newWorld();
    rmSync(path.join(world.artifacts, "release-manifest.json"));
    expect(await world.run()).toBe(2);
    expect(world.lines.join("\n")).toContain("cannot read release-manifest.json");
    writeFileSync(path.join(world.artifacts, "release-manifest.json"), "{not json");
    const again = await world.run();
    expect(again).toBe(2);
    expect(world.lines.join("\n")).toContain("is not valid JSON");
  });

  it.each([
    ["missing", { status: 404 } as FakeAnswer],
    ["unreadable", { status: 403 } as FakeAnswer],
    ["unprotected", protectedEnvironment({ can_admins_bypass: true })],
  ])("the environment guard failing on re-check (%s) is refused (exit 2) before any upload", async (_label, environment) => {
    const world = newWorld();
    world.github.environment = environment;
    expect(await world.run()).toBe(2);
    expect(world.lines.join("\n")).toContain("refusing: environment release:");
    expect(world.published()).toEqual([]);
  });

  it("the environment guard is read again before the first upload, with the run's token", async () => {
    const world = newWorld();
    expect(await world.run()).toBe(0);
    expect(world.github.requests[0]).toBe("/repos/o/r/environments/release");
    expect(world.lines.join("\n")).toContain("environment release: protected (required reviewers: jbrandtmse; admin bypass off; tags v*)");
    expect(new Set(world.github.authorizations)).toEqual(new Set([`Bearer ${GITHUB_TOKEN}`]));
  });
});

describe("Publish refusals, more shapes of a run that is not the tag push of the prepared version (QA, AC 42.5.1, AC 42.5.4)", () => {
  it.each([
    ["a tag without the v", { GITHUB_REF: "refs/tags/1.0.0" }, /ref is "refs\/tags\/1\.0\.0", not refs\/tags\/v1\.0\.0/],
    ["a branch that is named like the tag", { GITHUB_REF: "refs/heads/v1.0.0" }, /ref is "refs\/heads\/v1\.0\.0", not refs\/tags\/v1\.0\.0/],
    ["a prerelease tag of the same version", { GITHUB_REF: "refs/tags/v1.0.0-rc.1" }, /ref is "refs\/tags\/v1\.0\.0-rc\.1", not refs\/tags\/v1\.0\.0/],
    ["a tag that only starts like the version", { GITHUB_REF: "refs/tags/v1.0.00" }, /ref is "refs\/tags\/v1\.0\.00", not refs\/tags\/v1\.0\.0\./],
    ["a pull request", { GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/7/merge" }, /event is "pull_request", not push/],
    ["a scheduled run on the tag's ref", { GITHUB_EVENT_NAME: "schedule" }, /event is "schedule", not push/],
    ["a repository dispatch on the tag's ref", { GITHUB_EVENT_NAME: "repository_dispatch" }, /event is "repository_dispatch", not push/],
    ["a release event on the tag's ref", { GITHUB_EVENT_NAME: "release" }, /event is "release", not push/],
    ["a developer machine that has no GitHub variable at all", { GITHUB_EVENT_NAME: undefined, GITHUB_REF: undefined, GITHUB_SHA: undefined }, /event is "", not push/],
  ] as Array<[string, Record<string, string | undefined>, RegExp]>)("%s: exit 2 naming the condition, before npm, a store, git or GitHub is asked anything", async (_label, overrides, expected) => {
    const world = newWorld();
    expect(await world.run({ env: overrides })).toBe(2);
    expect(world.lines.join("\n")).toMatch(expected);
    expect(world.standIns.allCalls()).toEqual([]);
    expect(world.github.requests).toEqual([]);
  });

  it("the control: the same world on the push of the tag is a real run, so each refusal above comes from its own condition", async () => {
    const world = newWorld();
    expect(await world.run()).toBe(0);
    expect(world.published()).toHaveLength(8);
  });
});

describe("Publish integrity: a manifest that verifies nothing, and a channel that the manifest does not describe (QA, AC 42.5.2, AC 42.5.3)", () => {
  it.each([
    ["an empty file list", (manifest: ArtifactManifest): Record<string, unknown> => ({ ...manifest, files: [] })],
    [
      "no file list at all",
      (manifest: ArtifactManifest): Record<string, unknown> => {
        const { files: _gone, ...rest } = manifest;
        void _gone;
        return rest;
      },
    ],
  ])("%s verifies no hash, so it is refused (exit 2 in real mode, exit 1 in a dry run) before any upload", async (_label, change) => {
    for (const dryRun of [false, true]) {
      const world = newWorld();
      writeFileSync(path.join(world.artifacts, "release-manifest.json"), `${JSON.stringify(change(world.manifest), null, 2)}\n`);
      expect(await world.run({ dryRun }), `dryRun ${dryRun}`).toBe(dryRun ? 1 : 2);
      expect(world.lines.join("\n")).toContain("release-manifest.json lists no file. Prepare the artifacts again.");
      expect(world.published()).toEqual([]);
    }
  });

  it("an enabled channel that the manifest does not describe is a failed channel in the report, after the eight packages and the channel before it, and it stops the channel after it (exit 1)", async () => {
    const world = newWorld({ publisher: "acme" });
    world.standIns.script("git", [
      { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
      { match: ["write-tree"], stdout: "tree-new\n" },
      { match: ["rev-parse"], status: 1 },
    ]);
    world.manifest.channels = world.manifest.channels.filter((channel) => channel["id"] !== "open-vsx");
    writeManifest(world.artifacts, world.manifest);
    expect(await world.run({ channels: ALL_ENABLED, env: { IPM_DIST_DEPLOY_KEY: "-----BEGIN KEY-----\nabc\n-----END KEY-----" } })).toBe(1);
    expect(world.published()).toHaveLength(8);
    expect(world.standIns.calls("vsce"), "the channel before it was published").toHaveLength(1);
    expect(world.standIns.calls("ovsx"), "nothing can be uploaded for a channel that has no entry").toEqual([]);
    expect(world.standIns.calls("git"), "the IPM channel would have succeeded, and is not attempted").toEqual([]);
    const report = world.lines.join("\n");
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: published");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@?: failed (the manifest has no open-vsx entry. Prepare the artifacts again.)");
    expect(report).toContain("ipm\n  iris-execute-mcp-v2@1.0.0: not attempted");
  });
});

describe("Publish uploads only the manifest's hash-verified files, inside the artifacts directory (DW-695; AC 42.5.2: the exact rehearsed bytes)", () => {
  const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nBINDKEYBODY\n-----END OPENSSH PRIVATE KEY-----";
  /** Bytes next to the artifacts directory that no manifest ever hashed. */
  const outside = (world: PublishWorld, name: string): string => {
    const file = path.join(world.root, name);
    writeFileSync(file, "bytes that were never hashed\n");
    return file;
  };
  const channelOf = (world: PublishWorld, id: string): Record<string, any> => world.manifest.channels.find((channel) => channel["id"] === id) as Record<string, any>;
  const npmEntry = (world: PublishWorld, name: string): Record<string, any> => (channelOf(world, "npm")["packages"] as Array<Record<string, any>>).find((entry) => entry["name"] === name) as Record<string, any>;

  it.each([
    ["an npm tarball outside the directory (../outside.tgz)", (world: PublishWorld) => {
      outside(world, "outside.tgz");
      npmEntry(world, "@iris-mcp/shared")["tarball"] = "../outside.tgz";
    }, /@iris-mcp\/shared@1\.0\.0: its tarball "\.\.\/outside\.tgz" is not a hash-verified file of release-manifest\.json/],
    ["an npm tarball at an absolute path", (world: PublishWorld) => {
      npmEntry(world, "@iris-mcp/admin")["tarball"] = outside(world, "iris-mcp-admin-1.0.0.tgz");
    }, /@iris-mcp\/admin@1\.0\.0: its tarball ".*iris-mcp-admin-1\.0\.0\.tgz" is not a hash-verified file/],
    ["a file outside the directory that the manifest lists with its true hash", (world: PublishWorld) => {
      const file = outside(world, "outside.tgz");
      const bytes = readFileSync(file);
      world.manifest.files.push({ path: "../outside.tgz", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      npmEntry(world, "@iris-mcp/shared")["tarball"] = "../outside.tgz";
    }, /lists the file "\.\.\/outside\.tgz", which is not a path inside the artifacts directory/],
    ["an npm entry that names another package's tarball", (world: PublishWorld) => {
      npmEntry(world, "@iris-mcp/shared")["tarball"] = npmEntry(world, "@iris-mcp/admin")["tarball"];
    }, /@iris-mcp\/shared@1\.0\.0: its tarball npm\/iris-mcp-admin-1\.0\.0\.tgz is not iris-mcp-shared-1\.0\.0\.tgz, the one pnpm pack makes for it/],
    ["an npm entry at another version than the release", (world: PublishWorld) => {
      npmEntry(world, "@iris-mcp/ops")["version"] = "0.0.9";
    }, /@iris-mcp\/ops@0\.0\.9 is not at the release version 1\.0\.0/],
    ["a Marketplace vsix outside the directory", (world: PublishWorld) => {
      outside(world, "outside.vsix");
      channelOf(world, "vscode-marketplace")["file"] = "../outside.vsix";
    }, /vscode-marketplace: its vsix "\.\.\/outside\.vsix" is not a hash-verified \.vsix/],
    ["an Open VSX vsix that is not a listed file", (world: PublishWorld) => {
      channelOf(world, "open-vsx")["file"] = "vsix/another.vsix";
    }, /open-vsx: its vsix "vsix\/another\.vsix" is not a hash-verified \.vsix/],
    ["a Marketplace entry that names a listed, hash-verified file that is not a vsix (an npm tarball)", (world: PublishWorld) => {
      channelOf(world, "vscode-marketplace")["file"] = npmEntry(world, "@iris-mcp/shared")["tarball"];
    }, /vscode-marketplace: its vsix "npm\/iris-mcp-shared-1\.0\.0\.tgz" is not a hash-verified \.vsix/],
    ["an IPM tree outside the directory", (world: PublishWorld) => {
      channelOf(world, "ipm")["tree"] = "..";
    }, /ipm: its tree "\.\." is not a directory of release-manifest\.json that holds module\.xml/],
    ["an IPM tree that is not the module (the npm tarballs)", (world: PublishWorld) => {
      channelOf(world, "ipm")["tree"] = "npm";
    }, /ipm: its tree "npm" is not a directory of release-manifest\.json that holds module\.xml/],
  ] as Array<[string, (world: PublishWorld) => void, RegExp]>)("%s is refused before any upload: exit 2 in a real run, exit 1 in a dry run, and no npm publish, store CLI or git call", async (_label, change, expected) => {
    for (const dryRun of [false, true]) {
      const world = newWorld({ publisher: "acme" });
      change(world);
      writeManifest(world.artifacts, world.manifest);
      expect(await world.run({ dryRun, channels: ALL_ENABLED, env: { IPM_DIST_DEPLOY_KEY: KEY } }), `dryRun ${dryRun}`).toBe(dryRun ? 1 : 2);
      expect(world.lines.join("\n")).toMatch(expected);
      expect(world.standIns.allCalls().map((call) => `${call.tool} ${call.argv[0]}`), "only npm --version ran").toEqual(["npm --version"]);
      expect(world.github.requests, "the refusal comes before the environment is asked").toEqual([]);
    }
  });

  it("the control: the manifest as prepare writes it, with every channel enabled, passes the check and uploads every artifact", async () => {
    const world = newWorld({ publisher: "acme" });
    world.standIns.script("git", [
      { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
      { match: ["write-tree"], stdout: "tree-new\n" },
      { match: ["rev-parse"], status: 1 },
    ]);
    expect(await world.run({ channels: ALL_ENABLED, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(0);
    expect(world.published().map((call) => tarballOf(call, world.artifacts))).toEqual(NPM_PUBLISH_ORDER.map((name: string) => `npm/${packedTarballName(name, "1.0.0")}`));
    expect(world.standIns.calls("vsce")).toHaveLength(1);
    expect(world.standIns.calls("ovsx")).toHaveLength(1);
    expect(world.standIns.calls("git").some((call) => call.argv.includes("push"))).toBe(true);
  });

  it("isContainedPath accepts the paths prepare writes and nothing that leaves the directory", () => {
    for (const ok of ["npm/iris-mcp-shared-1.0.0.tgz", "vsix/iris-mcp-launcher-1.0.0.vsix", "ipm", "ipm/src/cls/ExecuteMCPv2/Utils.cls"]) expect(isContainedPath(ok), ok).toBe(true);
    for (const bad of ["../outside.tgz", "npm/../../x", "/abs/x.tgz", "C:/x.tgz", "npm\\x.tgz", "./npm/x.tgz", "npm//x.tgz", "", ".", "..", "npm/", "a\0b", undefined, 7]) expect(isContainedPath(bad), String(bad)).toBe(false);
  });
});

describe("Publish stops at the first failure even when every later step would succeed (QA, AC 42.5.3)", () => {
  const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nSTOPKEYBODY\n-----END OPENSSH PRIVATE KEY-----";

  /** A world in which each enabled channel succeeds if it is reached: a real publisher, both store CLIs, a deploy key's git steps. */
  const workingWorld = (): PublishWorld => {
    const world = newWorld({ publisher: "acme" });
    world.standIns.script("git", [
      { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
      { match: ["write-tree"], stdout: "tree-new\n" },
      { match: ["rev-parse"], status: 1 },
    ]);
    return world;
  };
  const toolsRun = (world: PublishWorld): string[] => [...new Set(world.standIns.allCalls().filter((call) => call.tool !== "npm").map((call) => call.tool))];

  it("the control: with nothing failing every channel is reached, so the stops below are real", async () => {
    const world = workingWorld();
    expect(await world.run({ channels: ALL_ENABLED, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(0);
    expect(world.published()).toHaveLength(8);
    expect(toolsRun(world).sort()).toEqual(["git", "ovsx", "vsce"]);
    expect(world.standIns.calls("git").some((call) => call.argv.includes("push"))).toBe(true);
  });

  it("a package that fails to upload stops every channel after npm: no store CLI and no git call runs, and each channel and package after it is `not attempted` exactly once", async () => {
    const world = workingWorld();
    world.standIns.script("npm", [{ match: ["publish", "~iris-mcp-ops"], status: 1, stderr: "npm error code E403\nnpm error 403 Forbidden\n" }, ...NPM_DEFAULT]);
    expect(await world.run({ channels: ALL_ENABLED, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(1);
    expect(world.published()).toHaveLength(7);
    expect(toolsRun(world), "no store CLI and no git").toEqual([]);
    const report = world.lines.join("\n");
    for (const name of ["client-config", "shared", "admin", "data", "dev", "interop"]) expect(report, name).toContain(`@iris-mcp/${name}@1.0.0: published`);
    expect(report).toMatch(/@iris-mcp\/ops@1\.0\.0: failed \(npm error code E403/);
    expect(report).toContain("@iris-mcp/all@1.0.0: not attempted");
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: not attempted");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");
    expect(report).toContain("ipm\n  iris-execute-mcp-v2@1.0.0: not attempted");
    expect(report.match(/iris-mcp-launcher@1\.0\.0: /g), "one line per channel, never a second result for a channel that was skipped over").toHaveLength(2);
  });

  it("an Open VSX upload that fails stops the IPM channel that would have succeeded: no git call, and the Marketplace stays published", async () => {
    const world = workingWorld();
    world.standIns.script("ovsx", [{ match: ["publish"], status: 1, stderr: "ovsx error 401\n" }]);
    expect(await world.run({ channels: ALL_ENABLED, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(1);
    expect(toolsRun(world).sort()).toEqual(["ovsx", "vsce"]);
    expect(world.standIns.calls("git")).toEqual([]);
    const report = world.lines.join("\n");
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: published");
    expect(report).toMatch(/open-vsx\n {2}iris-mcp-launcher@1\.0\.0: failed \(ovsx error 401/);
    expect(report).toContain("ipm\n  iris-execute-mcp-v2@1.0.0: not attempted");
  });
});

describe("The registry check reads npm's own words (QA, AC 42.5.2; transcripts captured from npm 11.19.0 on 2026-10-22 with `npm view <name>@<version> version`, the debug-log line left out)", () => {
  // `npm view @iris-mcp/shared@0.0.2 version`: a package that has never been published.
  const NEVER_PUBLISHED = [
    "npm error code E404",
    "npm error 404 Not Found - GET https://registry.npmjs.org/@iris-mcp%2fshared - Not found",
    "npm error 404",
    "npm error 404  The requested resource '@iris-mcp/shared@0.0.2' could not be found or you do not have permission to access it.",
    "npm error 404",
    "npm error 404 Note that you can also install from a",
    "npm error 404 tarball, folder, http url, or git url.",
    "",
  ].join("\n");
  // `npm view lodash@999.0.0 version`: a package that exists, at a version it does not have (every release after the first).
  const VERSION_ABSENT = [
    "npm error code E404",
    "npm error 404 No match found for version 999.0.0",
    "npm error 404",
    "npm error 404  The requested resource 'lodash@999.0.0' could not be found or you do not have permission to access it.",
    "npm error 404",
    "npm error 404 Note that you can also install from a",
    "npm error 404 tarball, folder, http url, or git url.",
    "",
  ].join("\n");
  // `npm view lodash@4.17.21 version --registry http://127.0.0.1:1`: a registry that cannot be reached.
  const UNREACHABLE = [
    "npm error code ECONNREFUSED",
    "npm error syscall connect",
    "npm error errno ECONNREFUSED",
    "npm error FetchError: request to http://127.0.0.1:1/lodash failed, reason: connect ECONNREFUSED 127.0.0.1:1",
    "npm error     at ClientRequest.<anonymous> (/opt/homebrew/lib/node_modules/npm/node_modules/minipass-fetch/lib/index.js:130:14)",
    "npm error     at ClientRequest.emit (node:events:514:20)",
    "npm error     at emitErrorEvent (node:_http_client:114:11)",
    "npm error     at _destroy (node:_http_client:1169:9)",
    "npm error     at onSocketNT (node:_http_client:1190:5)",
    "npm error     at process.processTicksAndRejections (node:internal/process/task_queues:91:21) {",
    "npm error   code: 'ECONNREFUSED',",
    "npm error   errno: 'ECONNREFUSED',",
    "npm error   syscall: 'connect',",
    "npm error   address: '127.0.0.1',",
    "npm error   port: 1,",
    "npm error   type: 'system'",
    "npm error }",
    "npm error",
    "npm error If you are behind a proxy, please make sure that the 'proxy' config is set properly.  See: 'npm help config'",
    "npm error A complete log of this run can be found in: /home/runner/.npm/_logs/debug-0.log",
    "",
  ].join("\n");

  it.each([
    ["a package that was never published", NEVER_PUBLISHED],
    ["a package that exists without the version", VERSION_ABSENT],
  ])("npm's answer for %s means `not published`: all eight are uploaded", async (_label, transcript) => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["view"], status: 1, stderr: transcript }, ...NPM_DEFAULT]);
    expect(await world.run()).toBe(0);
    expect(world.published()).toHaveLength(8);
    expect(world.lines.join("\n")).not.toContain("could not ask the registry");
  });

  it("npm's answer for a registry that cannot be reached is not an answer: nothing is uploaded, the first package is reported failed and the rest not attempted (exit 1)", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["view"], status: 1, stderr: UNREACHABLE }, ...NPM_DEFAULT]);
    expect(await world.run()).toBe(1);
    expect(world.published()).toEqual([]);
    const report = world.lines.join("\n");
    expect(report).toContain("@iris-mcp/client-config@1.0.0: could not ask the registry whether it is published. Nothing after it is attempted.");
    expect(report).toContain("@iris-mcp/client-config@1.0.0: failed (could not ask the registry:");
    expect(report, "the code line leads the detail, though the transcript ends in its stack and log path").toContain("@iris-mcp/client-config@1.0.0: failed (could not ask the registry: npm error code ECONNREFUSED\n");
    expect(report).toContain("@iris-mcp/all@1.0.0: not attempted");
  });

  it("an upload that fails the same way is reported with npm's code line too, and the log says how to resume", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["publish", "~iris-mcp-shared"], status: 1, stderr: UNREACHABLE }, ...NPM_DEFAULT]);
    expect(await world.run()).toBe(1);
    const report = world.lines.join("\n");
    expect(report).toContain("@iris-mcp/shared@1.0.0: failed (npm error code ECONNREFUSED\nnpm error }\nnpm error\n");
    expect(report).toContain("A complete log of this run can be found in");
    expect(report).toContain("@iris-mcp/shared@1.0.0: npm publish failed (exit 1). Nothing after it is attempted. Fix the cause and run the release again: versions already on the registry are skipped.");
  });

  it("npmFailureDetail keeps the tail alone when it already holds the code line, and adds nothing when there is none", () => {
    expect(npmFailureDetail({ status: 1, stdout: "", stderr: "npm error code E403\nnpm error 403 Forbidden\n" }, 4)).toBe("npm error code E403\nnpm error 403 Forbidden");
    expect(npmFailureDetail({ status: null, stdout: "", stderr: "", error: new Error("spawn npm ENOENT") }, 4)).toBe("spawn npm ENOENT");
  });
});

describe("A rehearsal runs in a job that holds no GitHub token (QA, AC 42.5.4)", () => {
  it("publish --dry-run without GITHUB_TOKEN, GITHUB_REPOSITORY or GITHUB_API_URL (the rehearse job has none of them) passes, and asks GitHub nothing", async () => {
    const world = newWorld();
    expect(await world.run({ dryRun: true, env: { GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_API_URL: undefined } }), world.lines.join("\n")).toBe(0);
    expect(world.github.requests, "a rehearsal reads no environment and no run").toEqual([]);
    expect(world.published(), "eight dry-run uploads").toHaveLength(8);
    expect(world.published().every((call) => call.argv.includes("--dry-run"))).toBe(true);
  });

  it("the control: a real run in the same world does ask GitHub, so the empty request list above is a property of the dry run", async () => {
    const world = newWorld();
    expect(await world.run()).toBe(0);
    expect(world.github.requests).toEqual(["/repos/o/r/environments/release", "/repos/o/r/environments/release/deployment-branch-policies"]);
  });
});

describe("redact: a secret never reaches a log line, and a short one never corrupts it (QA, project rule #9)", () => {
  it("replaces every occurrence of a secret of four characters or more", () => {
    expect(redact("write npm_abcd failed; retry with npm_abcd", ["npm_abcd"])).toBe("write *** failed; retry with ***");
    expect(redact("two secrets: abcd and wxyz!", ["abcd", "wxyz"])).toBe("two secrets: *** and ***!");
  });

  it("leaves a secret of one to three characters alone, because replacing it would rewrite every such letter of the message", () => {
    expect(redact("a banana and ab abc", ["a", "ab", "abc"])).toBe("a banana and ab abc");
  });

  it("ignores an empty or missing secret", () => {
    expect(redact("nothing to hide", ["", undefined as never, "gone"])).toBe("nothing to hide");
  });
});

describe("Publish auth (AC 42.5.2; Decision #75)", () => {
  it("NPM_TOKEN set: a 0600 userconfig holds the token and is passed as --userconfig to every upload; it is gone afterwards; the log says auth: token and never the token", async () => {
    const world = newWorld();
    expect(await world.run({ env: { NPM_TOKEN: TOKEN } })).toBe(0);
    const uploads = world.published();
    expect(uploads).toHaveLength(8);
    const configs = new Set(uploads.map((call) => call.argv[call.argv.indexOf("--userconfig") + 1]));
    expect(configs.size, "one userconfig for the whole release").toBe(1);
    for (const call of uploads) {
      expect(call.argv).toContain("--userconfig");
      expect(call.userconfig?.mode).toBe("600");
      expect(call.userconfig?.text).toBe(`//registry.npmjs.org/:_authToken=${TOKEN}\n`);
    }
    expect(existsSync([...configs][0] as string), "deleted on exit").toBe(false);
    expect(existsSync(path.dirname([...configs][0] as string))).toBe(false);
    expect(world.lines.join("\n")).toContain("auth: token");
    expect(world.lines.join("\n")).not.toContain(TOKEN);
    for (const call of world.standIns.allCalls()) {
      expect(JSON.stringify(call.env), `${call.tool} ${call.argv[0]}: the token is not in the child's environment`).not.toContain(TOKEN);
      expect(JSON.stringify(call.env), "nor is GITHUB_TOKEN").not.toContain(GITHUB_TOKEN);
      expect(call.env["NPM_TOKEN"]).toBeUndefined();
    }
    expect(world.standIns.calls("npm").filter((call) => call.argv[0] === "view").every((call) => !call.argv.includes("--userconfig"))).toBe(true);
  });

  it("NPM_TOKEN empty or unset: no userconfig, npm uses OIDC (trusted publishing), the log says auth: oidc", async () => {
    for (const env of [{ NPM_TOKEN: "" }, {}]) {
      const world = newWorld();
      expect(await world.run({ env })).toBe(0);
      for (const call of world.published()) {
        expect(call.argv).not.toContain("--userconfig");
        expect(call.userconfig).toBeUndefined();
      }
      expect(world.lines.join("\n")).toContain("auth: oidc");
    }
  });

  it("the job's OIDC request variables reach the three publish CLIs, `npm publish`, `vsce publish` and `ovsx publish`, and no other child: not npm --version, npm view or git", async () => {
    const OIDC = { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-request-SECRET-0123456789", ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example.invalid/x" };
    const world = newWorld({ publisher: "acme" });
    world.standIns.script("git", [
      { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
      { match: ["write-tree"], stdout: "tree-new\n" },
      { match: ["rev-parse"], status: 1 },
    ]);
    expect(await world.run({ channels: ALL_ENABLED, env: { ...OIDC, IPM_DIST_DEPLOY_KEY: "-----BEGIN KEY-----\nabc\n-----END KEY-----" } })).toBe(0);
    const holds = (call: StandInCall): boolean => call.env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"] !== undefined || call.env["ACTIONS_ID_TOKEN_REQUEST_URL"] !== undefined;
    const uploads = world.published();
    expect(uploads).toHaveLength(8);
    expect(uploads.every((call) => call.env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"] === OIDC.ACTIONS_ID_TOKEN_REQUEST_TOKEN && call.env["ACTIONS_ID_TOKEN_REQUEST_URL"] === OIDC.ACTIONS_ID_TOKEN_REQUEST_URL), "npm publish asks GitHub for its OIDC token with them").toBe(true);
    const others = world.standIns.allCalls().filter((call) => !(call.tool === "npm" && call.argv[0] === "publish"));
    expect(others.map((call) => `${call.tool} ${call.argv[0]}`)).toEqual(expect.arrayContaining(["npm --version", "npm view", "vsce publish", "ovsx publish", "git clone", "git push"]));
    expect(others.filter(holds).map((call) => `${call.tool} ${call.argv[0]}`), "only the two store publish CLIs hold them besides npm publish").toEqual(["vsce publish", "ovsx publish"]);
    for (const call of others.filter(holds)) {
      expect(call.env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"], call.tool).toBe(OIDC.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
      expect(call.env["ACTIONS_ID_TOKEN_REQUEST_URL"], call.tool).toBe(OIDC.ACTIONS_ID_TOKEN_REQUEST_URL);
    }
  });

  it("an upload whose output echoes the OIDC request token is reported with the token replaced by ***", async () => {
    const TOKEN = "oidc-request-SECRET-0123456789";
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["publish", "~iris-mcp-shared"], status: 1, stderr: `npm error code E401\nnpm error OIDC exchange failed for token ${TOKEN}\n` }, ...NPM_DEFAULT]);
    expect(await world.run({ env: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: TOKEN, ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example.invalid/x" } })).toBe(1);
    const report = world.lines.join("\n");
    expect(report).toContain("@iris-mcp/shared@1.0.0: failed (npm error code E401\nnpm error OIDC exchange failed for token ***");
    expect(report).not.toContain(TOKEN);
  });

  it("the userconfig is deleted when an upload fails, too", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["publish", "~iris-mcp-admin"], status: 1, stderr: `npm error 403 ${TOKEN} refused\n` }, ...NPM_DEFAULT]);
    expect(await world.run({ env: { NPM_TOKEN: TOKEN } })).toBe(1);
    const config = world.published()[0]?.argv[(world.published()[0]?.argv.indexOf("--userconfig") as number) + 1] as string;
    expect(existsSync(config)).toBe(false);
    expect(world.lines.join("\n"), "even a token that npm echoes is redacted").not.toContain(TOKEN);
    expect(world.lines.join("\n")).toContain("***");
  });

  it("a token with a line break is refused (exit 2) before it is written anywhere and before any upload", async () => {
    const world = newWorld();
    expect(await world.run({ env: { NPM_TOKEN: "abc\nregistry=https://evil.example/" } })).toBe(2);
    expect(world.lines.join("\n")).toContain("refusing: NPM_TOKEN holds whitespace or a control character. Set it to the token alone.");
    expect(world.published()).toEqual([]);
  });
});

describe("Publish npm: in order, idempotent, stops at the first failure (AC 42.5.2, AC 42.5.3)", () => {
  it("one `publish <tgz> --access public --provenance --ignore-scripts` per package, in NPM_PUBLISH_ORDER, each tarball of the artifacts", async () => {
    const world = newWorld();
    expect(await world.run()).toBe(0);
    const uploads = world.published();
    expect(uploads.map((call) => call.argv.slice(2))).toEqual(NPM_PUBLISH_ORDER.map(() => ["--access", "public", "--provenance", "--ignore-scripts"]));
    expect(uploads.map((call) => tarballOf(call, world.artifacts))).toEqual(NPM_PUBLISH_ORDER.map((name: string) => `npm/iris-mcp-${name.replace(/^@iris-mcp\//, "")}-1.0.0.tgz`));
    expect(uploads.map((call) => path.isAbsolute(call.argv[1] as string))).toEqual(Array(8).fill(true));
    expect(uploads.every((call) => !call.argv.includes("--dry-run"))).toBe(true);
    expect(world.lines.join("\n")).toContain("@iris-mcp/client-config@1.0.0: published");
  });

  it("each upload is preceded by a registry check of its version, and the order holds across both calls", async () => {
    const world = newWorld();
    expect(await world.run()).toBe(0);
    const calls = world.standIns.calls("npm").filter((call) => call.argv[0] === "view" || call.argv[0] === "publish");
    expect(calls.map((call) => call.argv[0])).toEqual(NPM_PUBLISH_ORDER.flatMap(() => ["view", "publish"]));
    expect(calls.filter((call) => call.argv[0] === "view").map((call) => call.argv.slice(1))).toEqual(NPM_PUBLISH_ORDER.map((name: string) => [`${name}@1.0.0`, "version"]));
  });

  it("a version that is already on the registry is skipped, and the rest are uploaded", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["view", "@iris-mcp/shared@1.0.0"], stdout: "1.0.0\n" }, ...NPM_DEFAULT]);
    expect(await world.run()).toBe(0);
    expect(world.published()).toHaveLength(7);
    expect(world.published().some((call) => tarballOf(call, world.artifacts).includes("shared"))).toBe(false);
    expect(world.lines.join("\n")).toContain("@iris-mcp/shared@1.0.0: already published, skipped");
    expect(world.lines.join("\n")).toMatch(/@iris-mcp\/shared@1\.0\.0: already published/);
  });

  it("everything already published is a clean run that uploads nothing", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["view"], stdout: "1.0.0\n" }, ...NPM_DEFAULT]);
    expect(await world.run()).toBe(0);
    expect(world.published()).toEqual([]);
  });

  it("the first failure stops everything after it: exit 1, the later packages and channels are not attempted, and the report names each as published, failed, not attempted or skipped", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["publish", "~iris-mcp-dev"], status: 1, stderr: "npm error code E403\nnpm error 403 Forbidden\n" }, ...NPM_DEFAULT]);
    expect(await world.run({ channels: ALL_ENABLED })).toBe(1);
    expect(world.published().map((call) => tarballOf(call, world.artifacts))).toEqual(["npm/iris-mcp-client-config-1.0.0.tgz", "npm/iris-mcp-shared-1.0.0.tgz", "npm/iris-mcp-admin-1.0.0.tgz", "npm/iris-mcp-data-1.0.0.tgz", "npm/iris-mcp-dev-1.0.0.tgz"]);
    const report = world.lines.join("\n");
    expect(report).toContain("@iris-mcp/client-config@1.0.0: published");
    expect(report).toContain("@iris-mcp/data@1.0.0: published");
    expect(report).toMatch(/@iris-mcp\/dev@1\.0\.0: failed \(npm error code E403/);
    for (const name of ["interop", "ops", "all"]) expect(report).toContain(`@iris-mcp/${name}@1.0.0: not attempted`);
    expect(report).toContain("iris-mcp-launcher@1.0.0: not attempted");
    expect(world.standIns.calls("git"), "no channel after the failure ran").toEqual([]);
    expect(world.standIns.calls("vsce")).toEqual([]);
  });

  it("a registry check that fails for another reason than a 404 stops the release without an upload (it fails closed)", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["view", "@iris-mcp/admin@1.0.0"], status: 1, stderr: "npm error network ECONNRESET\n" }, ...NPM_DEFAULT]);
    expect(await world.run()).toBe(1);
    expect(world.published().map((call) => tarballOf(call, world.artifacts))).toEqual(["npm/iris-mcp-client-config-1.0.0.tgz", "npm/iris-mcp-shared-1.0.0.tgz"]);
    expect(world.lines.join("\n")).toMatch(/@iris-mcp\/admin@1\.0\.0: could not ask the registry/);
    expect(world.lines.join("\n")).toContain("@iris-mcp/data@1.0.0: not attempted");
  });

  it("a package whose npm publish exits 1 after an earlier success is reported; a success is never reported for it", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["publish", "~iris-mcp-client-config"], status: 1, stderr: "boom\n" }, ...NPM_DEFAULT]);
    expect(await world.run()).toBe(1);
    expect(world.published()).toHaveLength(1);
    expect(world.lines.join("\n")).toContain("@iris-mcp/client-config@1.0.0: failed");
    expect(world.lines.join("\n")).toContain("@iris-mcp/shared@1.0.0: not attempted");
  });
});

describe("Publish channels (AC 42.5.3)", () => {
  it("by default both stores run and IPM does not: IPM prints `skipped: not enabled (Story 42.8)`, no git runs, and each store CLI runs once", async () => {
    const world = newWorld();
    expect(await world.run()).toBe(0);
    const report = world.lines.join("\n");
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
    expect(report).toContain("ipm\n  iris-execute-mcp-v2@1.0.0: skipped: not enabled (Story 42.8)");
    expect(world.standIns.calls("git")).toEqual([]);
    expect(world.standIns.calls("vsce")).toHaveLength(1);
    expect(world.standIns.calls("ovsx")).toHaveLength(1);
  });

  it("a channel that is not enabled prints `skipped: not enabled (<story>)`, and no store CLI, no store lookup and no git runs, for a store as for IPM", async () => {
    const world = newWorld();
    expect(await world.run({ channels: NPM_ONLY })).toBe(0);
    const report = world.lines.join("\n");
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: skipped: not enabled (Story 42.7)");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: skipped: not enabled (Story 42.7)");
    expect(report).toContain("ipm\n  iris-execute-mcp-v2@1.0.0: skipped: not enabled (Story 42.8)");
    expect(world.standIns.calls("git")).toEqual([]);
    expect(world.standIns.calls("vsce")).toEqual([]);
    expect(world.standIns.calls("ovsx")).toEqual([]);
    expect(world.stores.requests, "a real run of a disabled channel reads no store").toEqual([]);
  });

  it("all four enabled: the order is npm, the Marketplace, Open VSX, IPM; vsce and ovsx run from the extension's node_modules/.bin on the vsix", async () => {
    const world = newWorld({ publisher: "acme" });
    world.standIns.script("git", [
      { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
      { match: ["write-tree"], stdout: "tree-new\n" },
      { match: ["rev-parse"], status: 1 },
    ]);
    expect(await world.run({ channels: ALL_ENABLED, env: { IPM_DIST_DEPLOY_KEY: "-----BEGIN KEY-----\nabc\n-----END KEY-----" } })).toBe(0);
    const order = world.standIns.allCalls().filter((call) => (call.tool === "npm" && call.argv[0] === "publish") || (call.tool !== "npm" && call.tool !== "git") || (call.tool === "git" && call.argv[0] === "push"));
    expect(order.map((call) => call.tool)).toEqual([...NPM_PUBLISH_ORDER.map(() => "npm"), "vsce", "ovsx", "git"]);
    const vsce = world.standIns.calls("vsce")[0] as StandInCall;
    expect(vsce.argv).toEqual(["publish", "--packagePath", path.join(world.artifacts, "vsix", "iris-mcp-launcher-1.0.0.vsix"), "--skip-duplicate", "--oidc"]);
    const ovsx = world.standIns.calls("ovsx")[0] as StandInCall;
    expect(ovsx.argv).toEqual(["publish", path.join(world.artifacts, "vsix", "iris-mcp-launcher-1.0.0.vsix"), "--skip-duplicate", "--trusted-publishing"]);
    expect(realpathSync(vsce.cwd)).toBe(realpathSync(path.join(world.repo, "extensions", "iris-mcp-launcher")));
    const report = world.lines.join("\n");
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
    expect(report).toMatch(/ipm\n {2}iris-execute-mcp-v2@1\.0\.0: published/);
  });

  it("a store CLI that is not installed, or a publisher that is still the placeholder, fails an enabled channel and stops what follows", async () => {
    const placeholder = newWorld({ publisher: PLACEHOLDER_PUBLISHER });
    expect(await placeholder.run({ channels: ALL_ENABLED })).toBe(1);
    expect(placeholder.lines.join("\n")).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: failed (the publisher is TBD-at-publish-time");
    expect(placeholder.stores.requests, "a placeholder names nothing a store could answer for, so no store is asked").toEqual([]);
    expect(placeholder.standIns.calls("vsce")).toEqual([]);
    expect(placeholder.lines.join("\n")).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");

    const absent = newWorld({ publisher: "acme" });
    rmSync(path.join(absent.repo, "extensions", "iris-mcp-launcher", "node_modules", ".bin", "vsce"));
    expect(await absent.run({ channels: ALL_ENABLED })).toBe(1);
    expect(absent.lines.join("\n")).toMatch(/vsce is not installed in extensions\/iris-mcp-launcher\/node_modules/);
  });

  it("a store upload that fails stops the later channels, exit 1", async () => {
    const world = newWorld({ publisher: "acme" });
    world.standIns.script("vsce", [{ match: ["publish"], status: 1, stderr: "vsce error 401\n" }]);
    expect(await world.run({ channels: ALL_ENABLED })).toBe(1);
    expect(world.standIns.calls("ovsx"), "Open VSX is not attempted").toEqual([]);
    expect(world.standIns.calls("git")).toEqual([]);
    expect(world.lines.join("\n")).toMatch(/vscode-marketplace\n {2}iris-mcp-launcher@1\.0\.0: failed \(vsce error 401/);
    expect(world.lines.join("\n")).toContain("ipm\n  iris-execute-mcp-v2@1.0.0: not attempted");
  });

  it("every channel is enabled by default (Story 42.8): npm, the two stores, IPM and the MCP Registry, and none names a story that enables it", () => {
    expect(RELEASE_CHANNELS.filter((channel: { enabled: boolean }) => channel.enabled).map((channel: { id: string }) => channel.id)).toEqual(["npm", "vscode-marketplace", "open-vsx", "ipm", "mcp-registry"]);
    expect(RELEASE_CHANNELS.filter((channel: { enabled: boolean }) => !channel.enabled)).toEqual([]);
  });
});

/**
 * Story 42.7 (AC 42.7.2; AD-29; I/O matrix rows: Store upload, Already on a store, Skip-duplicate race, Lookup unreadable, Upload fails,
 * Open VSX namespace absent, Dry step ready, Secret containment, Version lockstep). The stores' statuses in the fake are the real ones
 * of 2026-11-20 (`release-core.test.ts`, Rule #36): 200 for a version that is there, 404 for one that is not, 404 for an unknown
 * namespace; the skip line is the one vsce 4.1.1 and ovsx 1.4.0 print after `--skip-duplicate` found the version.
 */
describe("Publish: the extension stores (Story 42.7)", () => {
  const SKIP_LINE = "Version 1.0.0 is already published. Skipping publish.\n";
  const OVSX_PAT = "ovsx-PAT-SECRET-0123456789";
  const VSCE_PAT = "vsce-PAT-SECRET-0123456789";
  const OIDC = { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-request-SECRET-0123456789", ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example.invalid/x" };
  const SECRETS = [TOKEN, OVSX_PAT, VSCE_PAT, OIDC.ACTIONS_ID_TOKEN_REQUEST_TOKEN, GITHUB_TOKEN];
  const MARKETPLACE_LOOKUP = "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/iris-mcp/vsextensions/iris-mcp-launcher/1.0.0/vspackage";
  const OPEN_VSX_LOOKUP = "https://open-vsx.org/api/iris-mcp/iris-mcp-launcher/1.0.0";
  const OPEN_VSX_NAMESPACE = "https://open-vsx.org/api/iris-mcp";

  const reportOf = (world: PublishWorld): string => world.lines.join("\n");
  const storeRows = (world: PublishWorld): string[] => reportOf(world).split("\n").filter((line) => /^publish(?: \(dry run\))?: (?:vscode-marketplace|open-vsx): /.test(line));

  it("Store upload: both lookups say absent, so vsce then ovsx upload, after npm, and each row says `published (auth: oidc)`", async () => {
    const world = newWorld();
    expect(await world.run({ env: OIDC })).toBe(0);
    const order = world.standIns.allCalls().filter((call) => (call.tool === "npm" && call.argv[0] === "publish") || call.tool === "vsce" || call.tool === "ovsx");
    expect(order.map((call) => call.tool)).toEqual([...NPM_PUBLISH_ORDER.map(() => "npm"), "vsce", "ovsx"]);
    const report = reportOf(world);
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
    expect(storeRows(world)).toEqual(["publish: vscode-marketplace: published (auth: oidc)", "publish: open-vsx: published (auth: oidc)"]);
  });

  it("the lookups are read-only GETs, in order: the Marketplace's (one byte asked for), then Open VSX's namespace, then Open VSX's version, each with no signal of its own so that the 30 s guard of the deps applies", async () => {
    const world = newWorld();
    expect(await world.run()).toBe(0);
    expect(world.stores.requests.map((request) => request.url)).toEqual([MARKETPLACE_LOOKUP, OPEN_VSX_NAMESPACE, OPEN_VSX_LOOKUP]);
    expect(world.stores.requests[0]?.headers).toEqual({ Range: "bytes=0-0", "User-Agent": "iris-mcp-release" });
    expect(world.stores.requests[2]?.headers).toEqual({ Accept: "application/json", "User-Agent": "iris-mcp-release" });
    expect(world.stores.requests.every((request) => !request.signal)).toBe(true);
    const sequence = world.standIns.allCalls();
    expect(sequence.filter((call) => call.tool === "vsce"), "one vsce publish").toHaveLength(1);
  });

  it("Already on a store: a lookup that finds the version (200, or 206 for the one byte) is `already published` with no CLI publish call, and the other store goes on", async () => {
    for (const found of [200, 206]) {
      const world = newWorld();
      world.stores.marketplace = marketplaceHit(found);
      expect(await world.run()).toBe(0);
      expect(world.standIns.calls("vsce"), `status ${found}: no upload`).toEqual([]);
      expect(world.standIns.calls("ovsx"), "Open VSX still uploads").toHaveLength(1);
      expect(reportOf(world)).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: already published\n");
      expect(reportOf(world)).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
    }
    const both = newWorld();
    both.stores.marketplace = marketplaceHit();
    both.stores.openVsx = openVsxHit();
    expect(await both.run()).toBe(0);
    expect(both.standIns.calls("vsce")).toEqual([]);
    expect(both.standIns.calls("ovsx")).toEqual([]);
    expect(reportOf(both)).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: already published");
  });

  it("Skip-duplicate race: a lookup that says absent and a CLI that exits 0 with the skip line is `already published`, for each store", async () => {
    const world = newWorld();
    world.standIns.script("vsce", [{ match: ["publish"], stdout: ` DONE  ${SKIP_LINE}` }]);
    world.standIns.script("ovsx", [{ match: ["publish"], stdout: "iris-mcp.iris-mcp-launcher v1.0.0 is already published. Skipping publish.\n" }]);
    expect(await world.run()).toBe(0);
    const report = reportOf(world);
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: already published\n");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: already published\n");
    expect(report).not.toMatch(/iris-mcp-launcher@1\.0\.0: published/);
  });

  it("an exit 0 that prints something else is a real upload, however close the words are", async () => {
    const world = newWorld();
    world.standIns.script("vsce", [{ match: ["publish"], stdout: "Version 1.0.0 is already published. Skipping publish. (and then uploaded)\n" }]);
    expect(await world.run()).toBe(0);
    expect(reportOf(world)).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
  });

  it.each([
    ["403", { status: 403, body: { message: "forbidden" } }, /\(HTTP 403\)/],
    ["500", { status: 500, body: {} }, /\(HTTP 500\)/],
    ["a redirect", { status: 301 }, /\(HTTP 301\)/],
    ["a network error", { status: 0, fail: "fetch failed" }, /\(fetch failed\)/],
  ] as Array<[string, FakeAnswer, RegExp]>)("Lookup unreadable (%s) on the Marketplace: `failed`, nothing uploaded, nothing after it attempted (fail closed), exit 1", async (_label, answer, cause) => {
    const world = newWorld();
    world.stores.marketplace = answer;
    expect(await world.run()).toBe(1);
    expect(world.standIns.calls("vsce"), "nothing uploaded").toEqual([]);
    expect(world.standIns.calls("ovsx"), "nothing after it attempted").toEqual([]);
    expect(world.stores.requests.map((request) => request.url), "Open VSX was not even asked").toEqual([MARKETPLACE_LOOKUP]);
    const report = reportOf(world);
    expect(report).toMatch(/vscode-marketplace\n {2}iris-mcp-launcher@1\.0\.0: failed \(could not ask vscode-marketplace whether iris-mcp-launcher@1\.0\.0 is published/);
    expect(report).toMatch(cause);
    expect(report).toContain("Nothing was uploaded to vscode-marketplace; check the network and the store, then run the release again.");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");
    expect(report).toContain("ipm\n  iris-execute-mcp-v2@1.0.0: skipped: not enabled (Story 42.8)");
  });

  it("Lookup unreadable on Open VSX: the Marketplace stays published, Open VSX is `failed` with nothing uploaded, and what follows is `not attempted`", async () => {
    const world = newWorld();
    world.stores.openVsx = { status: 503 };
    expect(await world.run({ channels: ALL_ENABLED, env: { IPM_DIST_DEPLOY_KEY: "-----BEGIN KEY-----\nabc\n-----END KEY-----" } })).toBe(1);
    expect(world.standIns.calls("vsce")).toHaveLength(1);
    expect(world.standIns.calls("ovsx")).toEqual([]);
    expect(world.standIns.calls("git")).toEqual([]);
    const report = reportOf(world);
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
    expect(report).toMatch(/open-vsx\n {2}iris-mcp-launcher@1\.0\.0: failed \(could not ask open-vsx whether iris-mcp-launcher@1\.0\.0 is published \(HTTP 503\)/);
    expect(report).toContain("ipm\n  iris-execute-mcp-v2@1.0.0: not attempted");
  });

  it("a Marketplace 200 that is not the store's answer (a captive-portal or proxy HTML page) is `failed`, never `already published`: nothing uploaded, nothing after it attempted, exit 1", async () => {
    const world = newWorld();
    world.stores.marketplace = HTML_PAGE;
    expect(await world.run()).toBe(1);
    expect(world.standIns.calls("vsce"), "nothing uploaded").toEqual([]);
    expect(world.standIns.calls("ovsx"), "nothing after it attempted").toEqual([]);
    const report = reportOf(world);
    expect(report).not.toContain("already published");
    expect(report).toContain(
      "vscode-marketplace\n  iris-mcp-launcher@1.0.0: failed (could not ask vscode-marketplace whether iris-mcp-launcher@1.0.0 is published (HTTP 200, but the content type is text/html; charset=utf-8, not application/vsix, so it is not the store's answer).",
    );
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");
  });

  it.each([
    ["an HTML page", HTML_PAGE],
    ["JSON for another version", openVsxHit("0.9.0")],
    ["JSON with no version (a proxy's own JSON)", { status: 200, body: { ok: true } }],
  ] as Array<[string, FakeAnswer]>)("an Open VSX 200 that is %s is `failed`, never `already published`, and ovsx does not run", async (_label, answer) => {
    const world = newWorld();
    world.stores.openVsx = answer;
    expect(await world.run()).toBe(1);
    expect(world.standIns.calls("vsce"), "the Marketplace still uploads").toHaveLength(1);
    expect(world.standIns.calls("ovsx"), "nothing uploaded").toEqual([]);
    const report = reportOf(world);
    expect(report).not.toContain("already published");
    expect(report).toMatch(/open-vsx\n {2}iris-mcp-launcher@1\.0\.0: failed \(could not ask open-vsx whether iris-mcp-launcher@1\.0\.0 is published \(HTTP 200, but .*so it is not the store's answer\)/);
  });

  it("in a rehearsal, a store 200 that is not the store's answer is `not ready`, never `ready (would be already published)`", async () => {
    const world = newWorld();
    world.stores.marketplace = HTML_PAGE;
    expect(await world.run({ dryRun: true })).toBe(1);
    const report = reportOf(world);
    expect(report).not.toContain("would be already published");
    expect(report).toMatch(/vscode-marketplace\n {2}iris-mcp-launcher@1\.0\.0: not ready \(could not ask vscode-marketplace whether iris-mcp-launcher@1\.0\.0 is published \(HTTP 200, but the content type is text\/html/);
  });

  it("Lookup unreadable by a stall: a store that never answers is cut off by the 30 s guard of the deps, and the release fails closed", async () => {
    const world = newWorld();
    const github = fakeFetch(world.github);
    const original = globalThis.fetch;
    globalThis.fetch = ((url: unknown, init?: { signal?: AbortSignal }) =>
      String(url).startsWith("https://marketplace.visualstudio.com/")
        ? new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))
        : github(url as string, init as never)) as typeof fetch;
    try {
      const guarded = defaultDeps({ fetchTimeoutMs: 50 }).fetch;
      expect(await world.run({ deps: { fetch: guarded } })).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
    expect(world.standIns.calls("vsce")).toEqual([]);
    expect(world.standIns.calls("ovsx")).toEqual([]);
    expect(reportOf(world)).toMatch(/vscode-marketplace\n {2}iris-mcp-launcher@1\.0\.0: failed \(could not ask vscode-marketplace whether iris-mcp-launcher@1\.0\.0 is published \(.*timeout/);
  });

  it("Upload fails: a CLI that exits non-zero is `failed` with the last four lines of its output, and what follows is `not attempted`", async () => {
    const world = newWorld();
    world.standIns.script("vsce", [{ match: ["publish"], status: 1, stderr: "line 1\nline 2\nline 3\nline 4\nERROR  The Personal Access Token verification has failed\nERROR  last line\n" }]);
    expect(await world.run()).toBe(1);
    expect(world.standIns.calls("ovsx")).toEqual([]);
    const report = reportOf(world);
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: failed (line 3\nline 4\nERROR  The Personal Access Token verification has failed\nERROR  last line)");
    expect(report).not.toContain("line 2");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");
  });

  it("Open VSX namespace absent: a release fails before any lookup or upload of Open VSX, naming the namespace and the owner's step; the Marketplace is not affected", async () => {
    const world = newWorld();
    world.stores.namespace = { status: 404, body: { error: "Namespace not found: iris-mcp" } };
    expect(await world.run()).toBe(1);
    expect(world.standIns.calls("vsce")).toHaveLength(1);
    expect(world.standIns.calls("ovsx"), "nothing uploaded to a namespace that does not exist").toEqual([]);
    expect(world.stores.requests.map((request) => request.url)).toEqual([MARKETPLACE_LOOKUP, OPEN_VSX_NAMESPACE]);
    expect(reportOf(world)).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: failed (the Open VSX namespace iris-mcp does not exist. Create it once with npx ovsx create-namespace iris-mcp (owner step O1). Nothing was uploaded to open-vsx.)");
  });

  it("an Open VSX namespace that cannot be read is `failed` too, with the status", async () => {
    const world = newWorld();
    world.stores.namespace = { status: 502 };
    expect(await world.run()).toBe(1);
    expect(world.standIns.calls("ovsx")).toEqual([]);
    expect(reportOf(world)).toMatch(/open-vsx\n {2}iris-mcp-launcher@1\.0\.0: failed \(the Open VSX namespace iris-mcp could not be read \(HTTP 502\)\. Check the network and open-vsx\.org, then run the release again\. Nothing was uploaded to open-vsx\./);
  });

  it("an Open VSX namespace 200 that is not JSON (a captive-portal or proxy page) is not the namespace: `failed`, ovsx does not run", async () => {
    const world = newWorld();
    world.stores.namespace = HTML_PAGE;
    expect(await world.run()).toBe(1);
    expect(world.standIns.calls("vsce"), "the Marketplace still uploads").toHaveLength(1);
    expect(world.standIns.calls("ovsx")).toEqual([]);
    expect(world.stores.requests.map((request) => request.url), "the version is not asked after a namespace that cannot be judged").toEqual([MARKETPLACE_LOOKUP, OPEN_VSX_NAMESPACE]);
    expect(reportOf(world)).toContain(
      "open-vsx\n  iris-mcp-launcher@1.0.0: failed (the Open VSX namespace iris-mcp could not be read (HTTP 200, but the answer is text/html; charset=utf-8, not JSON, so it is not the store's answer). Check the network and open-vsx.org, then run the release again. Nothing was uploaded to open-vsx.)",
    );
  });

  describe("the rehearsal", () => {
    it("Dry step ready: publisher set, both CLIs installed, namespace present, versions absent: `ready (would publish ...)` for both, exit 0, and no CLI publish runs", async () => {
      const world = newWorld();
      expect(await world.run({ dryRun: true })).toBe(0);
      const report = reportOf(world);
      expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: ready (would publish iris-mcp-launcher@1.0.0)");
      expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: ready (would publish iris-mcp-launcher@1.0.0)");
      expect(world.standIns.calls("vsce")).toEqual([]);
      expect(world.standIns.calls("ovsx")).toEqual([]);
      expect(world.stores.requests.map((request) => request.url)).toEqual([MARKETPLACE_LOOKUP, OPEN_VSX_NAMESPACE, OPEN_VSX_LOOKUP]);
    });

    it("a version that a store already holds reads `ready (would be already published)`", async () => {
      const world = newWorld();
      world.stores.marketplace = marketplaceHit(206);
      expect(await world.run({ dryRun: true })).toBe(0);
      expect(reportOf(world)).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: ready (would be already published)");
      expect(reportOf(world)).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: ready (would publish iris-mcp-launcher@1.0.0)");
    });

    it("Open VSX namespace absent: `not ready: the Open VSX namespace iris-mcp does not exist ...`, exit 1", async () => {
      const world = newWorld();
      world.stores.namespace = { status: 404 };
      expect(await world.run({ dryRun: true })).toBe(1);
      expect(reportOf(world)).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not ready (the Open VSX namespace iris-mcp does not exist. Create it once with npx ovsx create-namespace iris-mcp (owner step O1).)");
      expect(reportOf(world)).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: ready (would publish iris-mcp-launcher@1.0.0)");
    });

    it("an unreadable lookup is `not ready`, not `ready`: the rehearsal cannot tell an upload from a duplicate", async () => {
      const world = newWorld();
      world.stores.openVsx = { status: 500 };
      expect(await world.run({ dryRun: true })).toBe(1);
      expect(reportOf(world)).toMatch(/open-vsx\n {2}iris-mcp-launcher@1\.0\.0: not ready \(could not ask open-vsx whether iris-mcp-launcher@1\.0\.0 is published \(HTTP 500\)/);
    });

    it("a placeholder publisher is `not ready`, and the stores are not asked about a name nobody owns", async () => {
      const world = newWorld({ publisher: PLACEHOLDER_PUBLISHER });
      expect(await world.run({ dryRun: true })).toBe(1);
      expect(reportOf(world)).toMatch(/vscode-marketplace\n {2}iris-mcp-launcher@1\.0\.0: not ready \(the publisher is TBD-at-publish-time\)/);
      expect(world.stores.requests).toEqual([]);
    });

    it("a store CLI that is not installed is `not ready` naming the directory, beside a ready lookup", async () => {
      const world = newWorld();
      rmSync(path.join(world.repo, "extensions", "iris-mcp-launcher", "node_modules", ".bin", "ovsx"));
      expect(await world.run({ dryRun: true })).toBe(1);
      expect(reportOf(world)).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not ready (ovsx is not installed in extensions/iris-mcp-launcher/node_modules)");
    });
  });

  describe("Secret containment: each credential reaches only the CLI that needs it, and no report line holds one", () => {
    const env = { NPM_TOKEN: TOKEN, OVSX_PAT, VSCE_PAT, ...OIDC };
    const holdsAny = (call: StandInCall, names: string[]): string[] => names.filter((name) => call.env[name] !== undefined);

    it("with OVSX_PAT: ovsx gets it in its environment (never in argv) and no `--trusted-publishing`, with `auth: token`; vsce gets the OIDC variables only", async () => {
      const world = newWorld();
      expect(await world.run({ env })).toBe(0);
      const vsce = world.standIns.calls("vsce")[0] as StandInCall;
      const ovsx = world.standIns.calls("ovsx")[0] as StandInCall;
      expect(vsce.argv.slice(-2)).toEqual(["--skip-duplicate", "--oidc"]);
      expect(vsce.env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]).toBe(OIDC.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
      expect(vsce.env["ACTIONS_ID_TOKEN_REQUEST_URL"]).toBe(OIDC.ACTIONS_ID_TOKEN_REQUEST_URL);
      expect(holdsAny(vsce, ["OVSX_PAT", "VSCE_PAT", "NPM_TOKEN", "GITHUB_TOKEN"]), "vsce holds no secret but the OIDC variables, and not VSCE_PAT: the Marketplace always uses OIDC").toEqual([]);
      expect(ovsx.argv).toEqual(["publish", path.join(world.artifacts, "vsix", "iris-mcp-launcher-1.0.0.vsix"), "--skip-duplicate"]);
      expect(ovsx.env["OVSX_PAT"]).toBe(OVSX_PAT);
      expect(ovsx.env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]).toBe(OIDC.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
      expect(holdsAny(ovsx, ["VSCE_PAT", "NPM_TOKEN", "GITHUB_TOKEN"])).toEqual([]);
      expect(JSON.stringify([vsce.argv, ovsx.argv]), "no secret in any argv").not.toMatch(/SECRET/);
      expect(reportOf(world)).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
      expect(reportOf(world)).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: published (auth: token)");
    });

    it("without OVSX_PAT (or with it empty): ovsx asks for trusted publishing, holds no OVSX_PAT, and the row says `auth: oidc`", async () => {
      for (const value of [undefined, ""]) {
        const world = newWorld();
        expect(await world.run({ env: { ...env, OVSX_PAT: value } })).toBe(0);
        const ovsx = world.standIns.calls("ovsx")[0] as StandInCall;
        expect(ovsx.argv.slice(-2)).toEqual(["--skip-duplicate", "--trusted-publishing"]);
        expect(ovsx.env["OVSX_PAT"]).toBeUndefined();
        expect(reportOf(world)).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
      }
    });

    it("no other child holds OVSX_PAT or VSCE_PAT: not npm (--version, view, publish), not git, not vsce", async () => {
      const world = newWorld();
      world.standIns.script("git", [
        { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
        { match: ["write-tree"], stdout: "tree-new\n" },
        { match: ["rev-parse"], status: 1 },
      ]);
      expect(await world.run({ channels: ALL_ENABLED, env: { ...env, IPM_DIST_DEPLOY_KEY: "-----BEGIN KEY-----\nabc\n-----END KEY-----" } })).toBe(0);
      const calls = world.standIns.allCalls();
      expect(calls.length).toBeGreaterThan(20);
      for (const call of calls) {
        const label = `${call.tool} ${call.argv[0]}`;
        if (call.tool !== "ovsx") expect(call.env["OVSX_PAT"], label).toBeUndefined();
        expect(call.env["VSCE_PAT"], label).toBeUndefined();
        expect(call.env["GITHUB_TOKEN"], label).toBeUndefined();
        expect(call.env["NPM_TOKEN"], label).toBeUndefined();
        const publishCli = (call.tool === "npm" && call.argv[0] === "publish") || (call.tool === "vsce" && call.argv[0] === "publish") || (call.tool === "ovsx" && call.argv[0] === "publish");
        if (!publishCli) expect(holdsAny(call, ["ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL"]), label).toEqual([]);
      }
    });

    it("a failing store CLI that echoes a secret is reported with it replaced by ***, and no line of the run holds any secret", async () => {
      const world = newWorld();
      world.standIns.script("ovsx", [{ match: ["publish"], status: 1, stderr: `ovsx error 401: token ${OVSX_PAT} rejected, ambient ${VSCE_PAT}, oidc ${OIDC.ACTIONS_ID_TOKEN_REQUEST_TOKEN}\n` }]);
      expect(await world.run({ env })).toBe(1);
      expect(reportOf(world)).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: failed (ovsx error 401: token *** rejected, ambient ***, oidc ***)");
      for (const secret of SECRETS) expect(reportOf(world), secret).not.toContain(secret);
    });
  });

  it("Version lockstep at the upload: a release whose vsix is not at the release version is refused (exit 2) before any upload, naming the channel", async () => {
    const world = newWorld({ vsixVersion: "0.9.0" });
    expect(await world.run()).toBe(2);
    expect(world.standIns.allCalls().filter((call) => call.argv[0] === "publish")).toEqual([]);
    expect(reportOf(world)).toContain('refusing: vscode-marketplace: its vsix is at "0.9.0", not the release version 1.0.0. Run pnpm run version, then prepare the artifacts again.');
    expect(reportOf(world)).toContain('refusing: open-vsx: its vsix is at "0.9.0", not the release version 1.0.0.');
  });

  it("the version check is a release's: a dry-run manifest carries the extension's own version, and a disabled channel's vsix is not checked", async () => {
    const dry = newWorld({ vsixVersion: "0.9.0" });
    dry.manifest.mode = "dry-run";
    writeManifest(dry.artifacts, dry.manifest);
    expect(await dry.run({ dryRun: true })).toBe(0);
    const disabled = newWorld({ vsixVersion: "0.9.0" });
    expect(await disabled.run({ channels: NPM_ONLY })).toBe(0);
  });
});

describe("Publish: the extension stores, QA gaps (Story 42.7, Rules #54, #59)", () => {
  const OVSX_PAT = "ovsx-PAT-SECRET-0123456789";
  const VSCE_PAT = "vsce-PAT-SECRET-0123456789";
  const OIDC = { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-request-SECRET-0123456789", ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example.invalid/x" };
  const SECRET_ENV = { NPM_TOKEN: TOKEN, OVSX_PAT, VSCE_PAT, ...OIDC };
  const reportOf = (world: PublishWorld): string => world.lines.join("\n");

  /** Take the publisher out of both store entries of the manifest, as a manifest of an extension without one would read. */
  function withoutPublisher(world: PublishWorld): void {
    for (const channel of world.manifest.channels) if (channel["id"] === "vscode-marketplace" || channel["id"] === "open-vsx") delete channel["publisher"];
    writeManifest(world.artifacts, world.manifest);
  }

  it("a store request is a plain GET with no body, the same few headers in a release and a rehearsal, and no secret anywhere in a URL or a header, though every secret is in the job's environment", async () => {
    for (const dryRun of [false, true]) {
      const world = newWorld();
      expect(await world.run({ dryRun, env: SECRET_ENV }), `dryRun ${String(dryRun)}`).toBe(0);
      expect(world.stores.requests, "the Marketplace, the Open VSX namespace and the Open VSX version").toHaveLength(3);
      for (const request of world.stores.requests) {
        expect(request.method, request.url).toBe("GET");
        expect(request.hasBody, request.url).toBe(false);
        expect(Object.keys(request.headers).sort(), request.url).toEqual(request.url.includes("marketplace") ? ["Range", "User-Agent"] : ["Accept", "User-Agent"]);
      }
      const wire = JSON.stringify(world.stores.requests);
      for (const secret of [TOKEN, OVSX_PAT, VSCE_PAT, OIDC.ACTIONS_ID_TOKEN_REQUEST_TOKEN, GITHUB_TOKEN]) expect(wire, secret).not.toContain(secret);
    }
  });

  it("a manifest that names no publisher fails an enabled store channel with `the publisher is missing`, and the stores are not asked about a name nobody owns", async () => {
    const world = newWorld();
    withoutPublisher(world);
    expect(await world.run()).toBe(1);
    expect(world.standIns.calls("vsce")).toEqual([]);
    expect(world.standIns.calls("ovsx")).toEqual([]);
    expect(world.stores.requests).toEqual([]);
    expect(reportOf(world)).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: failed (the publisher is missing)");
    expect(reportOf(world)).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");
  });

  it("the same manifest in a rehearsal is `not ready (the publisher is missing)` at the Marketplace (Open VSX is not attempted), with no store read", async () => {
    const world = newWorld();
    withoutPublisher(world);
    expect(await world.run({ dryRun: true })).toBe(1);
    expect(world.stores.requests).toEqual([]);
    expect(reportOf(world)).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: not ready (the publisher is missing)");
    expect(reportOf(world), "the rehearsal stops at the first store that is not ready").toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");
  });

  it("a store CLI that cannot start (the shape `runCaptured` returns: status null, the error, no output) is `failed` with the error's own words, and what follows is `not attempted`", async () => {
    const world = newWorld();
    const real = defaultDeps().run;
    const run = ((argv: string[], options: unknown) =>
      path.basename(argv[0] as string).startsWith("vsce") ? Promise.resolve({ status: null, stdout: "", stderr: "", error: new Error(`spawn ${argv[0]} ENOEXEC (token ${OVSX_PAT})`) }) : real(argv as never, options as never)) as typeof real;
    expect(await world.run({ env: SECRET_ENV, deps: { run } })).toBe(1);
    expect(world.standIns.calls("ovsx"), "nothing after the failure runs").toEqual([]);
    const report = reportOf(world);
    expect(report).toMatch(/vscode-marketplace\n {2}iris-mcp-launcher@1\.0\.0: failed \(spawn .*vsce ENOEXEC \(token \*\*\*\)\)/);
    expect(report).not.toContain(OVSX_PAT);
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");
  });

  it("a store CLI that exits non-zero with no output is `failed` with how it ended, never an empty `failed ()`", async () => {
    const world = newWorld();
    world.standIns.script("vsce", [{ match: ["publish"], status: 3 }]);
    expect(await world.run()).toBe(1);
    const report = reportOf(world);
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: failed (vsce ended with no output (exit 3))");
    expect(report).not.toContain("failed ()");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");
  });

  it("a rehearsal stops at the first enabled store that is not ready: Open VSX is `not attempted`, and neither its namespace nor its version is read", async () => {
    const world = newWorld();
    world.stores.marketplace = { status: 500 };
    expect(await world.run({ dryRun: true })).toBe(1);
    const report = reportOf(world);
    expect(report).toMatch(/vscode-marketplace\n {2}iris-mcp-launcher@1\.0\.0: not ready \(could not ask vscode-marketplace .*HTTP 500/);
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");
    expect(world.stores.requests.map((request) => request.url)).toEqual([`https://marketplace.visualstudio.com/_apis/public/gallery/publishers/iris-mcp/vsextensions/iris-mcp-launcher/1.0.0/vspackage`]);
    expect(world.standIns.calls("vsce")).toEqual([]);
    expect(world.standIns.calls("ovsx")).toEqual([]);
  });
});

describe("The IPM channel (DW-689; Decision #76)", () => {
  const ipmWorld = (): PublishWorld => {
    const world = newWorld({ publisher: "acme" });
    world.standIns.script("git", [
      { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
      { match: ["write-tree"], stdout: "tree-new\n" },
      { match: ["rev-parse"], status: 1 },
    ]);
    return world;
  };
  const KEY ="-----BEGIN OPENSSH PRIVATE KEY-----\nSECRETKEYBODY\n-----END OPENSSH PRIVATE KEY-----";

  const LISTED = { status: 200, body: { name: "iris-execute-mcp-v2", version: "1.0.0", versions: ["0.9.0", "1.0.0"] } };

  it("a version the registry already lists goes on to the tag and tree check (decision #109): the tag with the identical tree is already published, and nothing is pushed", async () => {
    const world = ipmWorld();
    world.registry.answer = LISTED;
    world.standIns.script("git", [
      { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
      { match: ["write-tree"], stdout: "tree-same\n" },
      { match: ["rev-parse"], stdout: "tree-same\n" },
    ]);
    expect(await world.run({ channels: IPM_ONLY, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(0);
    expect(world.standIns.calls("git").some((call) => call.argv.includes("push") || call.argv.includes("commit"))).toBe(false);
    expect(world.lines.join("\n")).toContain("iris-execute-mcp-v2@1.0.0: already published (v1.0.0 exists with this tree)");
  });

  it("a listed version whose tag is absent fails (exit 1), with nothing pushed: the registry's copy was not made by this release", async () => {
    const world = ipmWorld();
    world.registry.answer = LISTED;
    expect(await world.run({ channels: IPM_ONLY, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(1);
    expect(world.standIns.calls("git").some((call) => call.argv.includes("push") || call.argv.includes("commit") || call.argv.includes("tag"))).toBe(false);
    expect(world.lines.join("\n")).toContain("the IPM registry lists 1.0.0, but jbrandtmse/iris-execute-mcp-v2-ipm has no tag v1.0.0. Nothing was pushed; release a new version.");
  });

  it("a listed version whose tag holds a different tree fails (exit 1), with nothing pushed", async () => {
    const world = ipmWorld();
    world.registry.answer = LISTED;
    world.standIns.script("git", [
      { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
      { match: ["write-tree"], stdout: "tree-new\n" },
      { match: ["rev-parse"], stdout: "tree-old\n" },
    ]);
    expect(await world.run({ channels: IPM_ONLY, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(1);
    expect(world.standIns.calls("git").some((call) => call.argv.includes("push") || call.argv.includes("commit"))).toBe(false);
    expect(world.lines.join("\n")).toContain("v1.0.0 exists on jbrandtmse/iris-execute-mcp-v2-ipm with a different tree");
  });

  it("the push trusts only GitHub's pinned host keys: StrictHostKeyChecking=yes, a 0600 known_hosts of the three keys that is removed on exit, no other known_hosts file, never accept-new", async () => {
    const world = ipmWorld();
    world.registry.answer = { status: 200, body: { name: "iris-execute-mcp-v2", version: "0.9.0", versions: ["0.9.0"] } };
    const seen: Array<{ command: string; mode: string; text: string }> = [];
    const run = defaultDeps().run;
    expect(
      await world.run({
        channels: IPM_ONLY,
        env: { IPM_DIST_DEPLOY_KEY: KEY },
        deps: {
          run: (argv: string[], options: { env?: Record<string, string> }) => {
            const command = options.env?.["GIT_SSH_COMMAND"];
            const file = command === undefined ? undefined : /UserKnownHostsFile=(\S+)/.exec(command)?.[1];
            if (command !== undefined && file !== undefined && existsSync(file) && !seen.some((entry) => entry.command === command)) {
              seen.push({ command, mode: (statSync(file).mode & 0o777).toString(8), text: readFileSync(file, "utf8") });
            }
            return run(argv as never, options as never);
          },
        },
      }),
    ).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.command).toMatch(/-o StrictHostKeyChecking=yes -o UserKnownHostsFile=\S+ -o GlobalKnownHostsFile=\/dev\/null$/);
    expect(seen[0]?.command).not.toContain("accept-new");
    expect(seen[0]?.mode).toBe("600");
    expect(seen[0]?.text).toBe(githubKnownHostsText());
    expect(seen[0]?.text.trim().split("\n")).toHaveLength(3);
    const file = /UserKnownHostsFile=(\S+)/.exec(seen[0]?.command as string)?.[1] as string;
    expect(existsSync(file), "the known_hosts file is removed on exit").toBe(false);
  });

  it("the deploy key is redacted from every report line, even when a git error echoes it", async () => {
    const world = ipmWorld();
    world.registry.answer = { status: 200, body: { name: "iris-execute-mcp-v2", version: "0.9.0", versions: ["0.9.0"] } };
    world.standIns.script("git", [{ match: ["clone"], status: 128, stderr: `fatal: could not read ${KEY.split("\n")[1]}\n` }]);
    expect(await world.run({ channels: IPM_ONLY, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(1);
    expect(world.lines.join("\n")).not.toContain("SECRETKEYBODY");
    expect(world.lines.join("\n")).toContain("git clone failed (exit 128): fatal: could not read ***");
  });

  it("otherwise it clones with the deploy key, replaces the tree, commits `iris-execute-mcp-v2 <v> from <sha>`, tags v<v> and pushes master and the tag, never with force", async () => {
    const world = ipmWorld();
    world.registry.answer = { status: 200, body: { name: "iris-execute-mcp-v2", version: "0.9.0", versions: ["0.9.0"] } };
    expect(await world.run({ channels: IPM_ONLY, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(0);
    const git = world.standIns.calls("git");
    expect(git.map((call) => call.argv.filter((argument) => argument !== "-c" && !argument.startsWith("user.")).slice(0, 3))).toEqual([
      ["clone", "--quiet", "git@github.com:jbrandtmse/iris-execute-mcp-v2-ipm.git"],
      ["checkout", "--quiet", "-B"],
      ["add", "--all"],
      ["write-tree"],
      ["rev-parse", "--verify", "--quiet"],
      ["commit", "--quiet", "-m"],
      ["tag", "-a", "v1.0.0"],
      ["push", "--atomic", "origin"],
    ]);
    const commit = git.find((call) => call.argv.includes("commit")) as StandInCall;
    expect(commit.argv.at(-1)).toBe(`iris-execute-mcp-v2 1.0.0 from ${SHA}`);
    const push = git.at(-1) as StandInCall;
    expect(push.argv, "the branch and the tag land together or not at all").toEqual(["push", "--atomic", "origin", "HEAD:refs/heads/master", "refs/tags/v1.0.0"]);
    for (const call of git) {
      expect(call.argv.some((argument) => /^--force|^-f$|^\+/.test(argument)), `git ${call.argv[0]}: no force`).toBe(false);
      expect(call.env["GIT_SSH_COMMAND"]).toMatch(/^ssh -i \S+ -o IdentitiesOnly=yes/);
      expect(call.env["IPM_DIST_DEPLOY_KEY"], "the key text is not in the environment").toBeUndefined();
    }
    const key = git.find((call) => call.sshKey !== undefined)?.sshKey;
    expect(key?.mode).toBe("600");
    expect(key?.text).toBe(`${KEY}\n`);
    expect(existsSync(key?.path as string), "the key file is removed on exit").toBe(false);
    expect(world.lines.join("\n")).not.toContain("SECRETKEYBODY");
    expect(world.lines.join("\n")).toMatch(/ipm\n {2}iris-execute-mcp-v2@1\.0\.0: published \(v1\.0\.0 on jbrandtmse\/iris-execute-mcp-v2-ipm master\)/);
  });

  it("an existing tag with an identical tree is already published: no commit and no push", async () => {
    const world = ipmWorld();
    world.standIns.script("git", [
      { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
      { match: ["write-tree"], stdout: "tree-same\n" },
      { match: ["rev-parse"], stdout: "tree-same\n" },
    ]);
    expect(await world.run({ channels: IPM_ONLY, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(0);
    expect(world.standIns.calls("git").some((call) => call.argv.includes("push") || call.argv.includes("commit"))).toBe(false);
    expect(world.lines.join("\n")).toContain("iris-execute-mcp-v2@1.0.0: already published (v1.0.0 exists with this tree)");
  });

  it("an existing tag with a different tree fails, with no commit and no push", async () => {
    const world = ipmWorld();
    world.standIns.script("git", [
      { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
      { match: ["write-tree"], stdout: "tree-new\n" },
      { match: ["rev-parse"], stdout: "tree-old\n" },
    ]);
    expect(await world.run({ channels: IPM_ONLY, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(1);
    expect(world.standIns.calls("git").some((call) => call.argv.includes("push") || call.argv.includes("commit"))).toBe(false);
    expect(world.lines.join("\n")).toContain("v1.0.0 exists on jbrandtmse/iris-execute-mcp-v2-ipm with a different tree");
  });

  it("a missing deploy key, a failing clone and a failing push are failures that name the step", async () => {
    const noKey = ipmWorld();
    expect(await noKey.run({ channels: IPM_ONLY })).toBe(1);
    expect(noKey.lines.join("\n")).toContain(
      "IPM_DIST_DEPLOY_KEY is not set. Add the deploy key as a release-environment secret, and to the publish step's env in release.yml and scripts/lib/release-checks.mjs.",
    );
    expect(noKey.standIns.calls("git")).toEqual([]);

    const clone = ipmWorld();
    clone.standIns.script("git", [{ match: ["clone"], status: 128, stderr: "fatal: repository not found\n" }]);
    expect(await clone.run({ channels: IPM_ONLY, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(1);
    expect(clone.lines.join("\n")).toContain("git clone failed (exit 128): fatal: repository not found");
    expect(clone.lines.join("\n"), "the failure says what to do").toContain("Fix the packaging repository or its deploy key, then run the release again.");

    const push = ipmWorld();
    push.standIns.script("git", [
      { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
      { match: ["write-tree"], stdout: "t\n" },
      { match: ["rev-parse"], status: 1 },
      { match: ["push"], status: 1, stderr: "remote rejected\n" },
    ]);
    expect(await push.run({ channels: IPM_ONLY, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(1);
    expect(push.lines.join("\n")).toContain("git push failed (exit 1): remote rejected");
    const rejected = push.standIns.calls("git").find((call) => call.sshKey !== undefined)?.sshKey;
    expect(existsSync(rejected?.path as string), "the key file is removed after a failure, too").toBe(false);
  });

  it("an unreadable registry stops the channel before it pushes", async () => {
    const world = ipmWorld();
    world.registry.answer = { status: 503 };
    expect(await world.run({ channels: IPM_ONLY, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(1);
    expect(world.standIns.calls("git")).toEqual([]);
    expect(world.lines.join("\n")).toContain("the registry could not be read (HTTP 503). Nothing was pushed.");
  });

  it("a throw inside the channel (a file-system error) after eight uploads is a failed channel: the report still names the eight packages as published, exit 1, the message redacted", async () => {
    const world = ipmWorld();
    const run = defaultDeps().run;
    const attempts: string[][] = [];
    const during: string[] = [];
    const privateTmp = scratch("release-private-tmp-");
    const code = await withTmpdir(privateTmp, () =>
      world.run({
        channels: IPM_ONLY,
        env: { IPM_DIST_DEPLOY_KEY: KEY, NPM_TOKEN: TOKEN },
        deps: {
          run: (argv: string[], options: Parameters<typeof run>[1]) => {
            if (argv[0] !== "git") return run(argv, options);
            attempts.push(argv);
            during.push(...readdirSync(privateTmp));
            throw new Error(`ENOSPC: no space left on device, write ${TOKEN}`);
          },
        },
      }),
    );
    expect(code).toBe(1);
    expect(during.some((name) => name.startsWith("release-ipm-")), "the channel had made its working directory when it threw").toBe(true);
    expect(attempts, "the first git call of the channel threw").toHaveLength(1);
    expect(world.published()).toHaveLength(8);
    const report = world.lines.join("\n");
    for (const name of NPM_PUBLISH_ORDER) expect(report, name).toContain(`${name}@1.0.0: published`);
    expect(report).toMatch(/ipm\n {2}iris-execute-mcp-v2@1\.0\.0: failed \(ENOSPC: no space left on device, write \*\*\*\)/);
    expect(report, "the redaction of the report").not.toContain(TOKEN);
    expect(readdirSync(privateTmp), "the channel's working directory and the token's userconfig are removed").toEqual([]);
  });
});

describe("Rehearse: publish --dry-run (AC 42.5.4)", () => {
  it("one `npm publish <tgz> ... --dry-run` per package, in order; NPM_TOKEN is never read: no userconfig, no auth line, the value nowhere", async () => {
    const world = newWorld();
    const privateTmp = scratch("release-private-tmp-");
    expect(await withTmpdir(privateTmp, () => world.run({ dryRun: true, env: { NPM_TOKEN: TOKEN } }))).toBe(0);
    const uploads = world.published();
    expect(uploads.map((call) => call.argv.slice(2))).toEqual(NPM_PUBLISH_ORDER.map(() => ["--access", "public", "--provenance", "--ignore-scripts", "--dry-run"]));
    expect(uploads.map((call) => tarballOf(call, world.artifacts))).toEqual(NPM_PUBLISH_ORDER.map((name: string) => `npm/iris-mcp-${name.replace(/^@iris-mcp\//, "")}-1.0.0.tgz`));
    expect(world.standIns.calls("npm").every((call) => !call.argv.includes("--userconfig"))).toBe(true);
    expect(readdirSync(privateTmp), "no userconfig directory was made").toEqual([]);
    expect(world.lines.join("\n")).toContain("auth: none (dry run)");
    expect(world.lines.join("\n")).not.toContain(TOKEN);
    expect(JSON.stringify(world.standIns.allCalls())).not.toContain(TOKEN);
    expect(world.github.requests, "a dry run asks GitHub nothing").toEqual([]);
  });

  it("every npm publish call carries --dry-run, and a dry run with every channel enabled runs no vsce or ovsx publish, no git push and no commit", async () => {
    const world = newWorld({ publisher: "acme" });
    expect(await world.run({ dryRun: true, channels: ALL_ENABLED })).toBe(0);
    expect(world.published().every((call) => call.argv.includes("--dry-run"))).toBe(true);
    expect(world.standIns.calls("vsce")).toEqual([]);
    expect(world.standIns.calls("ovsx")).toEqual([]);
    const gitCalls = world.standIns.calls("git");
    expect(gitCalls.length, "the IPM dry step did ask the packaging repository").toBeGreaterThan(0);
    expect(gitCalls.every((call) => call.argv[0] === "ls-remote")).toBe(true);
    expect(world.standIns.allCalls().some((call) => call.argv.includes("push") || call.argv.includes("commit") || call.argv.includes("tag"))).toBe(false);
    expect(world.lines.join("\n")).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: ready (would publish iris-mcp-launcher@1.0.0)");
    expect(world.lines.join("\n")).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: ready (would publish iris-mcp-launcher@1.0.0)");
  });

  it("a version that is on the registry is `would be already published`, and its dry-run publish is not made", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["view", "@iris-mcp/data@1.0.0"], stdout: "1.0.0\n" }, ...NPM_DEFAULT]);
    expect(await world.run({ dryRun: true })).toBe(0);
    expect(world.published()).toHaveLength(7);
    expect(world.lines.join("\n")).toContain("@iris-mcp/data@1.0.0: would be already published");
  });

  it("every disabled channel runs its dry step and reports its readiness: the placeholder publisher, a missing CLI, the packaging repository", async () => {
    const world = newWorld({ publisher: PLACEHOLDER_PUBLISHER });
    world.standIns.script("git", [{ match: ["ls-remote"], status: 128, stderr: "fatal: repository not found\n" }]);
    expect(await world.run({ dryRun: true, channels: NPM_ONLY })).toBe(0);
    const report = world.lines.join("\n");
    expect(report).toContain("vscode-marketplace: skipped: not enabled (Story 42.7); dry step: not ready: the publisher is TBD-at-publish-time");
    expect(report).toContain("open-vsx: skipped: not enabled (Story 42.7); dry step: not ready: the publisher is TBD-at-publish-time");
    expect(report).toContain("ipm: skipped: not enabled (Story 42.8); dry step: not ready: the packaging repository jbrandtmse/iris-execute-mcp-v2-ipm is absent or not readable");
    expect(world.standIns.calls("git").map((call) => call.argv)).toEqual([["ls-remote", "--symref", "https://github.com/jbrandtmse/iris-execute-mcp-v2-ipm.git", "HEAD"]]);
    rmSync(path.join(world.repo, "extensions", "iris-mcp-launcher", "node_modules", ".bin", "ovsx"));
    world.lines.length = 0;
    expect(await world.run({ dryRun: true, channels: NPM_ONLY })).toBe(0);
    expect(world.lines.join("\n")).toContain("open-vsx: skipped: not enabled (Story 42.7); dry step: not ready: the publisher is TBD-at-publish-time; ovsx is not installed in extensions/iris-mcp-launcher/node_modules");
    world.registry.answer = { status: 503 };
    world.lines.length = 0;
    expect(await world.run({ dryRun: true, channels: NPM_ONLY })).toBe(0);
    expect(world.lines.join("\n")).toContain("dry step: not ready: the registry could not be read (HTTP 503)");
    expect(world.stores.requests, "a placeholder publisher names nothing a store could answer for, so no store is asked").toEqual([]);
  });

  it("a disabled channel's readiness is `ready` when its prerequisites are there", async () => {
    const world = newWorld({ publisher: "acme" });
    world.registry.answer = { status: 404 };
    expect(await world.run({ dryRun: true, channels: NPM_ONLY })).toBe(0);
    const report = world.lines.join("\n");
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: skipped: not enabled (Story 42.7) (ready (would publish iris-mcp-launcher@1.0.0))");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: skipped: not enabled (Story 42.7) (ready (would publish iris-mcp-launcher@1.0.0))");
    expect(report).toContain("ipm\n  iris-execute-mcp-v2@1.0.0: skipped: not enabled (Story 42.8) (ready)");
  });

  describe("the IPM dry step reads the packaging repository's HEAD with its symref", () => {
    const SYMREF = (branch: string): string => `ref: refs/heads/${branch}\tHEAD\nc9a020973ccc910f035ff6e2a9462eada67a870a\tHEAD\n`;
    const LS_REMOTE = ["ls-remote", "--symref", "https://github.com/jbrandtmse/iris-execute-mcp-v2-ipm.git", "HEAD"];
    const READY = "ipm\n  iris-execute-mcp-v2@1.0.0: ready";
    const NOT_MAIN = "its default branch is main, not master, and the registry reads the default branch";

    it("an empty repository is ready: the answer is empty and the exit is 0", async () => {
      const world = newWorld({ publisher: "acme" });
      world.standIns.script("git", [{ match: ["ls-remote"], stdout: "" }]);
      expect(await world.run({ dryRun: true, channels: IPM_ONLY })).toBe(0);
      expect(world.lines.join("\n")).toContain(READY);
      expect(world.standIns.calls("git").map((call) => call.argv)).toEqual([LS_REMOTE]);
    });

    it("a repository whose default branch is master is ready", async () => {
      const world = newWorld({ publisher: "acme" });
      world.standIns.script("git", [{ match: ["ls-remote"], stdout: SYMREF("master") }]);
      expect(await world.run({ dryRun: true, channels: IPM_ONLY })).toBe(0);
      expect(world.lines.join("\n")).toContain(READY);
    });

    it("a default branch other than master is not ready, and an enabled IPM channel fails the rehearsal on it (exit 1)", async () => {
      const enabled = newWorld({ publisher: "acme" });
      enabled.standIns.script("git", [{ match: ["ls-remote"], stdout: SYMREF("main") }]);
      expect(await enabled.run({ dryRun: true, channels: IPM_ONLY })).toBe(1);
      expect(enabled.lines.join("\n")).toContain(`ipm\n  iris-execute-mcp-v2@1.0.0: not ready (${NOT_MAIN})`);

      const disabled = newWorld({ publisher: "acme" });
      disabled.standIns.script("git", [{ match: ["ls-remote"], stdout: SYMREF("main") }]);
      expect(await disabled.run({ dryRun: true })).toBe(0);
      expect(disabled.lines.join("\n")).toContain(`ipm: skipped: not enabled (Story 42.8); dry step: not ready: ${NOT_MAIN}`);
    });

    it("a failing ls-remote is `absent or not readable`, in both a disabled and an enabled channel", async () => {
      const absent = "the packaging repository jbrandtmse/iris-execute-mcp-v2-ipm is absent or not readable";
      const disabled = newWorld({ publisher: "acme" });
      disabled.standIns.script("git", [{ match: ["ls-remote"], status: 128, stderr: "fatal: repository not found\n" }]);
      expect(await disabled.run({ dryRun: true })).toBe(0);
      expect(disabled.lines.join("\n")).toContain(`ipm: skipped: not enabled (Story 42.8); dry step: not ready: ${absent}`);

      const enabled = newWorld({ publisher: "acme" });
      enabled.standIns.script("git", [{ match: ["ls-remote"], status: 128, stderr: "fatal: repository not found\n" }]);
      expect(await enabled.run({ dryRun: true, channels: IPM_ONLY })).toBe(1);
      expect(enabled.lines.join("\n")).toContain(`ipm\n  iris-execute-mcp-v2@1.0.0: not ready (${absent})`);
    });

    it("an unreadable registry and a wrong default branch are both reported", async () => {
      const world = newWorld({ publisher: "acme" });
      world.registry.answer = { status: 503 };
      world.standIns.script("git", [{ match: ["ls-remote"], stdout: SYMREF("main") }]);
      expect(await world.run({ dryRun: true })).toBe(0);
      expect(world.lines.join("\n")).toContain(`dry step: not ready: the registry could not be read (HTTP 503); ${NOT_MAIN}`);
    });
  });

  it("an enabled channel whose dry step fails fails the rehearsal (exit 1); a disabled channel's problems are `not ready` only", async () => {
    const enabled = newWorld({ publisher: PLACEHOLDER_PUBLISHER });
    expect(await enabled.run({ dryRun: true, channels: ALL_ENABLED })).toBe(1);
    expect(enabled.lines.join("\n")).toMatch(/vscode-marketplace\n {2}iris-mcp-launcher@1\.0\.0: not ready \(the publisher is TBD-at-publish-time/);
    expect(enabled.lines.join("\n")).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");
    const disabled = newWorld({ publisher: PLACEHOLDER_PUBLISHER });
    expect(await disabled.run({ dryRun: true, channels: NPM_ONLY })).toBe(0);
  });

  it("a failing dry-run publish fails the rehearsal and stops after it", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["publish", "~iris-mcp-admin"], status: 1, stderr: "E403\n" }, ...NPM_DEFAULT]);
    expect(await world.run({ dryRun: true })).toBe(1);
    expect(world.published()).toHaveLength(3);
    expect(world.lines.join("\n")).toContain("@iris-mcp/data@1.0.0: not attempted");
  });
});

// -- scripted real processes -----------------------------------------------------------------------------------------

describe("scripted runs of `node scripts/release.mjs` with the stand-ins as the only PATH entries", () => {
  /** A preload for the real process: the two stores answer from here, and no request leaves the machine. */
  const STORE_STUB = [
    'import { appendFileSync } from "node:fs";',
    "const real = globalThis.fetch;",
    "globalThis.fetch = (input, init) => {",
    "  const url = new URL(String(input));",
    '  if (url.host === "marketplace.visualstudio.com" || url.host === "open-vsx.org") {',
    "    appendFileSync(process.env.STORE_STUB_LOG, JSON.stringify({ url: url.href, headers: init?.headers ?? {} }) + String.fromCharCode(10));",
    '    const namespace = url.host === "open-vsx.org" && url.pathname.split("/").filter(Boolean).length === 2;',
    // Typed as the real stores type these answers (JSON for the namespace and for both 404s, 2026-11-21).
    '    return Promise.resolve(new Response(namespace ? JSON.stringify({ extensions: {} }) : JSON.stringify({ error: "not found" }), { status: namespace ? 200 : 404, headers: { "Content-Type": "application/json" } }));',
    "  }",
    "  return real(input, init);",
    "};",
    "",
  ].join(String.fromCharCode(10));

  /** A real process run of the script against the fake GitHub API on a loopback port. */
  async function scripted(world: PublishWorld, args: string[], env: Record<string, string>, onStart?: (pid: number) => void) {
    const server = await startGithubServer(world.github);
    servers.push(server.close);
    // The stores are the real hosts of a real process: a preload answers them (an unpublished version, an existing namespace) and logs each request.
    const stub = path.join(world.root, "store-stub.mjs");
    writeFileSync(stub, STORE_STUB);
    // The script runs from a copy inside the world's repository, so that its repository root is the fixture and the CLIs it runs are the fixture's stand-ins, never the real extension's vsce and ovsx.
    const script = copyScriptInto(world.repo);
    return runNode(["--import", pathToFileURL(stub).href, script, ...args], { ...world.env({ GITHUB_API_URL: server.url, STORE_STUB_LOG: path.join(world.root, "store-requests.log"), ...env }) }, onStart);
  }

  it("publish --dry-run: exit 0, eight dry-run uploads in order, nothing else that publishes, and the report appended to GITHUB_STEP_SUMMARY", async () => {
    const world = newWorld();
    const summary = path.join(world.root, "summary.md");
    const result = await scripted(world, ["publish", "--dry-run", "--artifacts", world.artifacts], { NPM_TOKEN: TOKEN, GITHUB_STEP_SUMMARY: summary });
    expect(result.status, result.stderr).toBe(0);
    expect(world.published().map((call) => call.argv.slice(2))).toEqual(NPM_PUBLISH_ORDER.map(() => ["--access", "public", "--provenance", "--ignore-scripts", "--dry-run"]));
    expect(result.stderr).toContain("publish (dry run): auth: none (dry run)");
    expect(result.stderr).not.toContain(TOKEN);
    expect(readFileSync(summary, "utf8")).toContain("### Rehearsal 1.0.0");
    expect(readFileSync(summary, "utf8")).toContain("@iris-mcp/client-config@1.0.0: would publish");
    expect(JSON.stringify(world.standIns.allCalls())).not.toContain(TOKEN);
  });

  it("publish (real mode) with the token: eight uploads, the userconfig 0600 and gone afterwards, exit 0", async () => {
    const world = newWorld();
    const result = await scripted(world, ["publish", "--artifacts", world.artifacts], { NPM_TOKEN: TOKEN });
    expect(result.status, result.stderr).toBe(0);
    expect(world.published()).toHaveLength(8);
    expect(world.published()[0]?.userconfig?.mode).toBe("600");
    const config = world.published()[0]?.argv[(world.published()[0]?.argv.indexOf("--userconfig") as number) + 1] as string;
    expect(existsSync(config)).toBe(false);
    expect(result.stderr).toContain("publish: auth: token");
    expect(result.stderr).not.toContain(TOKEN);
    expect(result.stderr).toContain("publish: vscode-marketplace: published (auth: oidc)");
    expect(result.stderr).toContain("publish: open-vsx: published (auth: oidc)");
    const requests = readFileSync(path.join(world.root, "store-requests.log"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { url: string });
    expect(requests.map((request) => new URL(request.url).host + new URL(request.url).pathname.replace(/\/iris-mcp-launcher\/1\.0\.0.*/, "/..."))).toEqual(["marketplace.visualstudio.com/_apis/public/gallery/publishers/iris-mcp/vsextensions/...", "open-vsx.org/api/iris-mcp", "open-vsx.org/api/iris-mcp/..."]);
    expect(world.standIns.calls("vsce")).toHaveLength(1);
    expect(world.standIns.calls("ovsx")).toHaveLength(1);
    expect(JSON.stringify(world.standIns.allCalls().filter((call) => call.tool !== "npm")), "the npm token reaches no store CLI").not.toContain(TOKEN);
  });

  it("publish (real mode) outside a tag push is refused with exit 2 and no npm call", async () => {
    const world = newWorld();
    const result = await scripted(world, ["publish", "--artifacts", world.artifacts], { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/tags/v1.0.0" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("refusing: the event is \"workflow_dispatch\", not push");
    expect(world.standIns.allCalls()).toEqual([]);
  });

  it("a SIGTERM during an upload ends the script (exit 143), kills the child, and deletes the userconfig", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["publish"], sleepMs: 30_000 }, ...NPM_DEFAULT]);
    let pid = 0;
    const running = scripted(world, ["publish", "--artifacts", world.artifacts], { NPM_TOKEN: TOKEN }, (started) => (pid = started));
    const deadline = Date.now() + 20_000;
    while (world.published().length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(world.published().length, "the upload started").toBeGreaterThan(0);
    const config = world.published()[0]?.argv[(world.published()[0]?.argv.indexOf("--userconfig") as number) + 1] as string;
    expect(existsSync(config), "the userconfig exists while the upload runs").toBe(true);
    const upload = world.published()[0]?.pid as number;
    const alive = (target: number): boolean => {
      try {
        process.kill(target, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(alive(upload), "the upload's process runs (it sleeps for 30 seconds)").toBe(true);
    process.kill(pid, "SIGTERM");
    const result = await running;
    expect(result.status).toBe(143);
    expect(existsSync(config), "the userconfig is deleted on SIGTERM").toBe(false);
    const until = Date.now() + 5_000;
    while (alive(upload) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alive(upload), "main()'s signal handler killed the running upload, which would otherwise sleep on").toBe(false);
  }, 60_000);

  it("ci-gate as a real process: green exits 0, red exits 1, and an API failure exits 1", async () => {
    const world = newWorld();
    const summary = path.join(world.root, "ci-gate-summary.md");
    const green = await scripted(world, ["ci-gate"], { GITHUB_STEP_SUMMARY: summary });
    expect(green.status, green.stderr).toBe(0);
    expect(green.stderr).toContain("ci-gate: .github/workflows/ci.yml is green on");
    expect(readFileSync(summary, "utf8")).toContain("### ci-gate (exit 0)");
    expect(readFileSync(summary, "utf8")).toContain("environment release: protected (required reviewers: jbrandtmse; admin bypass off; tags v*)");

    world.github.runs = () => ({ status: 200, body: { workflow_runs: [ciRun({ conclusion: "failure" })] } });
    const red = await scripted(world, ["ci-gate"], {});
    expect(red.status).toBe(1);
    expect(red.stderr).toContain("none succeeded");

    world.github.runs = () => ({ status: 500 });
    const broken = await scripted(world, ["ci-gate"], {});
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain("HTTP 500");
  });

  it("the stand-ins really are the only PATH entries: a real npm is never found", async () => {
    const world = newWorld();
    expect(readdirSync(world.standIns.binDir).sort()).toEqual(["git", "npm"]);
    expect(statSync(path.join(world.standIns.binDir, "npm")).mode & 0o111).not.toBe(0);
    const result = await runNode([RELEASE_SCRIPT, "publish", "--dry-run", "--artifacts", path.join(world.root, "no-such-directory")], { PATH: world.standIns.binDir, STAND_IN_DIR: world.standIns.dir });
    expect(result.status).toBe(2);
    expect(world.standIns.allCalls(), "a refused run called nothing").toEqual([]);
  });
});

// -- verify (Story 42.6, AC 42.6.3) -----------------------------------------------------------------------------------

describe("verify: the registry after a publish, read-only (AC 42.6.3)", () => {
  const PROVENANCE = { url: "https://registry.npmjs.org/-/npm/v1/attestations/x", provenance: { predicateType: "https://slsa.dev/provenance/v1" } };
  const PUBLISHED_VIEW = JSON.stringify({ version: "1.0.0", "dist.attestations": PROVENANCE });
  const E404 = "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/x - Not found\n";

  /** What the injected wire saw: the options of the spawn, whether its directories existed at that moment, and whether it was closed. */
  interface WireSeen {
    opened: Array<{ command: string; args: string[]; cwd: string; env: Record<string, string>; existed: boolean }>;
    handshakes: string[];
    closed: number;
  }

  /** A world of stand-in `npm`, an empty temporary directory that observes what verify leaves, and an injected wire. */
  function newVerifyWorld(serverVersion: string | Error = "1.0.0") {
    const root = scratch("release-verify-");
    const observed = path.join(root, "tmp");
    mkdirSync(observed);
    const standIns = installStandIns(path.join(root, "stand-ins"), ["npm", "git"]);
    standIns.script("npm", [{ match: ["view"], stdout: `${PUBLISHED_VIEW}\n` }]);
    standIns.script("git", [{ match: ["ls-remote"], stdout: `${SHA}\trefs/tags/v1.0.0\n` }]);
    // The MCP Registry lists every server at the version, and the packaging repository holds the tag, unless a test says otherwise.
    const stores = newFakeStores();
    stores.mcpRegistry = (name, version) => mcpRegistryHit(name, version);
    const lines: string[] = [];
    const seen: WireSeen = { opened: [], handshakes: [], closed: 0 };
    const wireModule = {
      WIRE_ERA: "2025-11-25",
      CLOSED_PORT_ENV: { IRIS_HOST: "127.0.0.1", IRIS_PORT: "1", IRIS_USERNAME: "qa", IRIS_PASSWORD: "qa", IRIS_NAMESPACE: "HSCUSTOM", IRIS_HTTPS: "false" },
      openRawWire: (options: { command: string; args: string[]; cwd: string; env: Record<string, string> }) => {
        seen.opened.push({ ...options, existed: [options.cwd, options.env["HOME"], options.env["npm_config_cache"]].every((entry) => typeof entry === "string" && existsSync(entry)) });
        return { close: async () => { seen.closed += 1; } };
      },
      handshake: async (_wire: unknown, protocol: string, client: string) => {
        seen.handshakes.push(`${protocol} ${client}`);
        if (serverVersion instanceof Error) throw serverVersion;
        return { line: "{}", message: { result: { protocolVersion: protocol, serverInfo: { name: "iris-dev-mcp", version: serverVersion } } } };
      },
    };
    const env = (overrides: Record<string, string | undefined> = {}): Record<string, string> =>
      Object.fromEntries(Object.entries({ PATH: standIns.binDir, STAND_IN_DIR: standIns.dir, ...overrides }).filter((entry): entry is [string, string] => entry[1] !== undefined));
    return {
      root,
      observed,
      standIns,
      stores,
      lines,
      seen,
      env,
      run: (version: string | undefined, overrides: Record<string, string | undefined> = {}, deps: Record<string, unknown> = {}) =>
        withTmpdir(observed, () =>
          verify({ version: version as string, env: env(overrides) }, { ...defaultDeps(), fetch: fakeStoresFetch(stores), log: (line: string) => lines.push(line), loadWire: async () => wireModule, cleanups: createCleanups(), ...deps }),
        ),
    };
  }

  it("every package published with provenance and the npx start answering the version: one ok line each, exit 0, and nothing left behind", async () => {
    const world = newVerifyWorld();
    expect(await world.run("1.0.0")).toBe(0);
    const text = world.lines.join("\n");
    for (const name of NPM_PUBLISH_ORDER) expect(text, name).toContain(`verify: ${name}@1.0.0: ok, published with a provenance attestation`);
    expect(text).toContain("verify: npx -y @iris-mcp/dev@1: ok, initialize answered serverInfo.version 1.0.0");
    expect(text).toContain("8 packages at 1.0.0 with provenance, 5 servers on the MCP Registry, the packaging tag v1.0.0, and npx -y @iris-mcp/dev@1 starts");
    expect(readdirSync(world.observed), "the temporary directory is removed").toEqual([]);
  });

  it("asks the registry about each package in publish order with npm view ... --json, and calls nothing else of npm", async () => {
    const world = newVerifyWorld();
    await world.run("1.0.0");
    const calls = world.standIns.calls("npm");
    expect(calls.map((call) => call.argv)).toEqual(NPM_PUBLISH_ORDER.map((name: string) => ["view", `${name}@1.0.0`, "version", "dist.attestations", "--json"]));
    expect(calls.every((call) => call.argv[0] === "view"), "no publish, deprecate, login or token call").toBe(true);
  });

  it("also asks the MCP Registry for each of the five servers at the version, and the packaging repository for its tag, read-only (Story 42.8)", async () => {
    const world = newVerifyWorld();
    expect(await world.run("1.0.0")).toBe(0);
    const text = world.lines.join("\n");
    for (const dir of ["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"]) {
      expect(text, dir).toContain(`verify: io.github.jbrandtmse/${dir}@1.0.0: ok, listed on the MCP Registry`);
    }
    expect(world.stores.requests.map((request) => request.url).filter((url) => url.startsWith("https://registry.modelcontextprotocol.io/"))).toEqual(
      ["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"].map((dir) => `https://registry.modelcontextprotocol.io/v0.1/servers/io.github.jbrandtmse%2F${dir}/versions/1.0.0`),
    );
    expect(world.stores.requests.every((request) => request.method === "GET" && !request.hasBody)).toBe(true);
    const git = world.standIns.calls("git");
    expect(git.map((call) => call.argv)).toEqual([["ls-remote", "--tags", "https://github.com/jbrandtmse/iris-execute-mcp-v2-ipm.git", "refs/tags/v1.0.0"]]);
    expect(text).toContain("verify: jbrandtmse/iris-execute-mcp-v2-ipm: ok, holds the tag v1.0.0");
  });

  it("the name it asks the registry for, per server directory, is the package's mcpName and the generated server.json's name", async () => {
    const world = newVerifyWorld();
    expect(await world.run("1.0.0")).toBe(0);
    const asked = world.stores.requests
      .map((request) => /^https:\/\/registry\.modelcontextprotocol\.io\/v0\.1\/servers\/([^/]+)\/versions\//.exec(request.url)?.[1])
      .filter((name): name is string => name !== undefined)
      .map((name) => decodeURIComponent(name));
    const read = (dir: string, file: string): { name?: string; mcpName?: string } => JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", dir, file), "utf8")) as { name?: string; mcpName?: string };
    expect(asked).toHaveLength(SERVER_JSON_DIRS.length);
    expect(asked).toEqual(SERVER_JSON_DIRS.map((dir: string) => read(dir, "package.json").mcpName));
    expect(asked).toEqual(SERVER_JSON_DIRS.map((dir: string) => read(dir, "server.json").name));
  });

  it("a server the MCP Registry does not list (404), one it cannot read (500) and a packaging repository without the tag are each one failed check", async () => {
    const world = newVerifyWorld();
    world.stores.mcpRegistry = (name, version) => (name.endsWith("iris-dev-mcp") ? MCP_REGISTRY_MISS : name.endsWith("iris-ops-mcp") ? { status: 500 } : mcpRegistryHit(name, version));
    world.standIns.script("git", [{ match: ["ls-remote"], stdout: "" }]);
    expect(await world.run("1.0.0")).toBe(1);
    const text = world.lines.join("\n");
    expect(text).toContain("verify: io.github.jbrandtmse/iris-dev-mcp@1.0.0: not listed on the MCP Registry.");
    expect(text).toContain("verify: io.github.jbrandtmse/iris-ops-mcp@1.0.0: the MCP Registry could not be read (HTTP 500).");
    expect(text).toContain("verify: jbrandtmse/iris-execute-mcp-v2-ipm: has no tag v1.0.0.");
    expect(text).toContain("3 check(s) failed");
  });

  it("a git that cannot read the packaging repository is a failed check naming the repository", async () => {
    const world = newVerifyWorld();
    world.standIns.script("git", [{ match: ["ls-remote"], status: 128, stderr: "fatal: repository not found\n" }]);
    expect(await world.run("1.0.0")).toBe(1);
    expect(world.lines.join("\n")).toContain("verify: jbrandtmse/iris-execute-mcp-v2-ipm: the tag v1.0.0 could not be read (exit 128).");
  });

  it("starts npx -y @iris-mcp/dev@1 in a temporary HOME, npm cache and working directory that exist at the call, against the closed port, and closes the wire", async () => {
    const world = newVerifyWorld();
    await world.run("1.0.0", { HOME: "/real/home", npm_config_cache: "/real/cache", IRIS_HOST: "iris.example", IRIS_TOOLS_PRESET: "core", MCP_SERVER_PROFILE: "x", NPM_TOKEN: TOKEN, GITHUB_TOKEN, NPM_CONFIG_USERCONFIG: "/real/npmrc", npm_config_registry: "https://registry.example/", NODE_AUTH_TOKEN: "node-auth" });
    expect(world.seen.opened).toHaveLength(1);
    const [opened] = world.seen.opened;
    expect(opened?.command).toBe("npx");
    expect(opened?.args).toEqual(["-y", "@iris-mcp/dev@1"]);
    expect(opened?.existed, "the cwd, HOME and npm cache exist while the server starts").toBe(true);
    const home = opened?.env["HOME"] as string;
    expect(home.startsWith(world.observed), "inside the temporary directory").toBe(true);
    expect(opened?.env["USERPROFILE"]).toBe(home);
    expect((opened?.env["npm_config_cache"] as string).startsWith(world.observed)).toBe(true);
    expect((opened?.cwd as string).startsWith(world.observed)).toBe(true);
    expect(opened?.env).toMatchObject({ IRIS_HOST: "127.0.0.1", IRIS_PORT: "1", IRIS_NAMESPACE: "HSCUSTOM" });
    for (const key of ["IRIS_TOOLS_PRESET", "MCP_SERVER_PROFILE", "NPM_TOKEN", "GITHUB_TOKEN", "NPM_CONFIG_USERCONFIG", "npm_config_registry", "NODE_AUTH_TOKEN"]) expect(Object.keys(opened?.env ?? {}), key).not.toContain(key);
    expect(JSON.stringify(opened?.env)).not.toContain(TOKEN);
    expect(world.seen.handshakes).toEqual(["2025-11-25 release-verify"]);
    expect(world.seen.closed).toBe(1);
    const viewEnv = world.standIns.calls("npm")[0]?.env as Record<string, string>;
    expect(viewEnv["HOME"], "npm view runs in the clean home too").toBe(home);
    expect(viewEnv["HOME"]).not.toBe("/real/home");
    expect(Object.keys(viewEnv)).not.toContain("NPM_TOKEN");
  });

  it("one package that is not on the registry: exit 1 naming it, the other seven ok, and the npx start still checked", async () => {
    const world = newVerifyWorld();
    world.standIns.script("npm", [{ match: ["view", "@iris-mcp/data@1.0.0"], status: 1, stderr: E404 }, { match: ["view"], stdout: `${PUBLISHED_VIEW}\n` }]);
    expect(await world.run("1.0.0")).toBe(1);
    const text = world.lines.join("\n");
    expect(text).toContain("verify: @iris-mcp/data@1.0.0: not on the registry.");
    expect(text.match(/: not on the registry\./g)).toHaveLength(1);
    expect(text.match(/: ok, published with a provenance attestation/g)).toHaveLength(7);
    expect(text).toContain("npx -y @iris-mcp/dev@1: ok");
    expect(text).toContain("1 check(s) failed");
    expect(readdirSync(world.observed)).toEqual([]);
  });

  it("today's registry (every package E404, the npx start failing): exit 1, eight not-on-the-registry lines, the npx start reported failed", async () => {
    const world = newVerifyWorld(new Error("the server exited (code 1, signal null) before it answered; stderr: npm error code E404"));
    world.standIns.script("npm", [{ match: ["view"], status: 1, stderr: E404 }]);
    expect(await world.run("1.0.0")).toBe(1);
    const text = world.lines.join("\n");
    for (const name of NPM_PUBLISH_ORDER) expect(text, name).toContain(`verify: ${name}@1.0.0: not on the registry.`);
    expect(text).toMatch(/verify: npx -y @iris-mcp\/dev@1: failed to start and answer initialize \(.*E404\)\. Publish the release/);
    expect(text).toContain("9 check(s) failed");
    expect(world.seen.closed, "the wire is closed even though the handshake failed").toBe(1);
    expect(readdirSync(world.observed), "no temporary directory is left").toEqual([]);
  });

  it("a version without a provenance attestation: exit 1 naming the package", async () => {
    const world = newVerifyWorld();
    world.standIns.script("npm", [{ match: ["view", "@iris-mcp/ops@1.0.0"], stdout: '"1.0.0"\n' }, { match: ["view"], stdout: `${PUBLISHED_VIEW}\n` }]);
    expect(await world.run("1.0.0")).toBe(1);
    expect(world.lines.join("\n")).toContain("verify: @iris-mcp/ops@1.0.0: published without a provenance attestation.");
  });

  it("an npx start that answers another version fails, naming both", async () => {
    const world = newVerifyWorld("1.0.1");
    expect(await world.run("1.0.0")).toBe(1);
    expect(world.lines.join("\n")).toContain('initialize answered serverInfo.version "1.0.1", not 1.0.0');
  });

  it.each([
    ["no version", undefined, /--version must be MAJOR\.MINOR\.PATCH\. usage: /],
    ["a version that is not x.y.z", "1.0", /--version must be MAJOR\.MINOR\.PATCH\. usage: /],
    ["a prerelease", "1.0.0-rc.1", /--version must be MAJOR\.MINOR\.PATCH/],
    ["another major", "2.0.0", /verify launches the @1 major\. Update its pinned spec with the next major\./],
    ["major 0", "0.0.3", /verify launches the @1 major/],
  ])("%s: exit 2, nothing run, no temporary directory made", async (_label, version, expected) => {
    const world = newVerifyWorld();
    expect(await world.run(version)).toBe(2);
    expect(world.lines.join("\n")).toMatch(expected);
    expect(world.standIns.allCalls()).toEqual([]);
    expect(world.seen.opened).toEqual([]);
    expect(readdirSync(world.observed)).toEqual([]);
  });

  it("a wire that cannot be loaded is a failed npx start, not a crash, and the temporary directory is still removed", async () => {
    const world = newVerifyWorld();
    const lines = world.lines;
    const code = await world.run("1.0.0", {}, { loadWire: async () => { throw new Error("cannot load the wire helpers"); } });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("cannot load the wire helpers");
    expect(readdirSync(world.observed)).toEqual([]);
  });

  it("the lines are appended to GITHUB_STEP_SUMMARY with the exit code, and the cleanup registered for a signal removes the directory", async () => {
    const world = newVerifyWorld();
    const summary = path.join(world.root, "summary.md");
    expect(await world.run("1.0.0", { GITHUB_STEP_SUMMARY: summary })).toBe(0);
    expect(readFileSync(summary, "utf8")).toMatch(/^### verify \(exit 0\)\n[\s\S]*@iris-mcp\/all@1\.0\.0: ok/);

    // A signal while the server starts: the handlers run the cleanups, which must empty the temporary directory there and then.
    const cleanups = createCleanups();
    const atSignal: { before?: string[]; after?: string[] } = {};
    const signalled = {
      WIRE_ERA: "2025-11-25",
      CLOSED_PORT_ENV: {},
      openRawWire: () => {
        atSignal.before = readdirSync(world.observed);
        cleanups.run();
        atSignal.after = readdirSync(world.observed);
        return { close: async () => undefined };
      },
      handshake: async () => ({ line: "{}", message: { result: { serverInfo: { version: "1.0.0" } } } }),
    };
    await world.run("1.0.0", {}, { cleanups, loadWire: async () => signalled });
    expect(atSignal.before, "verify's temporary directory exists while the server starts").toHaveLength(1);
    expect(atSignal.after, "the cleanup registered for a signal removed it").toEqual([]);
  });

  it("as a real process: no --version and a major other than 1 exit 2; today's registry (stand-in npm E404, stand-in npx failing) exits 1 with no directory left", async () => {
    const world = newVerifyWorld();
    // The generic stand-in reads its stdin to the end, which an MCP wire never closes while it waits for an answer: this one exits at once.
    const npxCalls = path.join(world.root, "npx-calls.log");
    const npxFile = path.join(world.standIns.binDir, "npx");
    writeFileSync(npxFile, `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(npxCalls)}, JSON.stringify(process.argv.slice(2)) + "\\n");\nprocess.stderr.write("npm error code E404\\n");\nprocess.exit(1);\n`);
    chmodSync(npxFile, 0o755);
    world.standIns.script("npm", [{ match: ["view"], status: 1, stderr: E404 }]);
    // Every fetch of the process answers 404 (the preload), so that it reaches no network: the MCP Registry reads are part of verify now.
    const env = { ...world.env(), TMPDIR: world.observed, NODE_OPTIONS: `--import=${pathToFileURL(path.join(REPO_ROOT, "packages/iris-mcp-all/src/__tests__/fetch-offline-preload.mjs")).href}` };
    const noVersion = await runNode([RELEASE_SCRIPT, "verify"], env);
    expect(noVersion.status).toBe(2);
    expect(noVersion.stderr).toMatch(/usage: node scripts\/release\.mjs[\s\S]*verify --version/);
    const major = await runNode([RELEASE_SCRIPT, "verify", "--version", "2.0.0"], env);
    expect(major.status).toBe(2);
    expect(major.stderr).toContain("verify launches the @1 major");
    expect(world.standIns.allCalls(), "the refusals called nothing").toEqual([]);

    const red = await runNode([RELEASE_SCRIPT, "verify", "--version", "1.0.0"], env);
    expect(red.status, red.stderr).toBe(1);
    expect(red.stderr.match(/: not on the registry\./g)).toHaveLength(8);
    expect(red.stderr).toMatch(/verify: npx -y @iris-mcp\/dev@1: failed to start and answer initialize/);
    expect(readFileSync(npxCalls, "utf8").trim().split("\n").map((line) => JSON.parse(line))).toEqual([["-y", "@iris-mcp/dev@1"]]);
    expect(world.standIns.calls("npm").every((call) => call.argv[0] === "view")).toBe(true);
    expect(readdirSync(world.observed), "the temporary directory is removed on the failing path").toEqual([]);
  }, 60_000);
});

// -- the MCP Registry channel (Story 42.8, decisions #108 and #110) --------------------------------------------------

describe("The MCP Registry channel (Story 42.8; AD-29)", () => {
  const OIDC_TOKEN = "oidc_SECRETREQUESTTOKEN1234567890";
  const OIDC = { ACTIONS_ID_TOKEN_REQUEST_TOKEN: OIDC_TOKEN, ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.example/request" };
  const KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nSECRETKEYBODY\n-----END OPENSSH PRIVATE KEY-----";
  const SERVERS = ["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"].map((dir) => `io.github.jbrandtmse/${dir}`);
  const NPM_AND_REGISTRY = [{ id: "npm", enabled: true }, { id: "mcp-registry", enabled: true }];

  /** The real `tar` of the host, linked next to the stand-ins: the channel extracts the publisher with it, and the stand-ins' directory is the script's whole PATH. */
  const hostTar = (): string => {
    const found = findExecutable("tar", process.env["PATH"] ?? "");
    if (found === undefined) throw new Error("no tar on this host's PATH");
    return found;
  };

  interface RegistryWorld extends PublishWorld {
    /** The sleeps the npm poll made and the clock they moved. */
    sleeps: number[];
    pin: { version: string; asset: string; sha256: string };
    publisherCalls: () => StandInCall[];
    /** Run with the registry channel (and npm) enabled, the pinned publisher replaced by this world's, and a clock that only `sleep` moves. */
    runRegistry: (options?: { dryRun?: boolean; env?: Record<string, string | undefined>; channels?: unknown }) => Promise<number>;
  }

  function registryWorld(): RegistryWorld {
    const world = newWorld({ publisher: "acme" });
    // The publisher this world "downloads": a tarball that holds the stand-in `mcp-publisher`, with the sha256 of its own bytes as the pin.
    const stage = path.join(world.root, "publisher-stage");
    mkdirSync(stage);
    world.standIns.installInto("mcp-publisher", stage);
    const archive = path.join(world.root, "mcp-publisher_linux_amd64.tar.gz");
    const packed = spawnSync(hostTar(), ["-czf", archive, "-C", stage, "mcp-publisher"], { encoding: "utf8" });
    if (packed.status !== 0) throw new Error(`tar failed: ${packed.stderr}`);
    const bytes = readFileSync(archive);
    const pin = { version: "v9.9.9-test", asset: "mcp-publisher_linux_amd64.tar.gz", sha256: createHash("sha256").update(bytes).digest("hex") };
    world.stores.publisher = { status: 200, bytes, contentType: "application/octet-stream" };
    symlinkSync(hostTar(), path.join(world.standIns.binDir, "tar"));
    world.standIns.script("mcp-publisher", [{ match: ["login"], stdout: "Successfully logged in\n" }, { match: ["validate"], stdout: "Validation passed\n" }, { match: ["publish"], stdout: "Successfully published\n" }]);
    const sleeps: number[] = [];
    let now = 0;
    const runRegistry: RegistryWorld["runRegistry"] = (options = {}) =>
      world.run({
        dryRun: options.dryRun ?? false,
        channels: options.channels ?? NPM_AND_REGISTRY,
        env: { ...OIDC, ...(options.env ?? {}) },
        deps: { mcpPublisher: pin, now: () => now, sleep: async (ms: number) => void (sleeps.push(ms), (now += ms)) },
      });
    return { ...world, sleeps, pin, publisherCalls: () => world.standIns.calls("mcp-publisher"), runRegistry };
  }

  const reportOf = (world: PublishWorld): string => world.lines.join("\n");
  const lookupsOf = (world: PublishWorld): string[] => world.stores.requests.map((request) => request.url).filter((url) => url.startsWith("https://registry.modelcontextprotocol.io/"));

  it("every server absent: lookups first, the publisher downloaded and verified, then one login github-oidc and one publish per listing, in order, each `published (auth: oidc)`, exit 0", async () => {
    const world = registryWorld();
    expect(await world.runRegistry()).toBe(0);
    expect(lookupsOf(world)).toEqual(SERVERS.map((name) => `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(name)}/versions/1.0.0`));
    const calls = world.publisherCalls();
    expect(calls.map((call) => (call.argv[0] === "login" ? call.argv : [call.argv[0], path.relative(world.artifacts, call.argv[1] as string)]))).toEqual([
      ["login", "github-oidc"],
      ...["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"].map((dir) => ["publish", `mcp-registry/${dir}.json`]),
    ]);
    for (const name of SERVERS) expect(reportOf(world), name).toContain(`${name}@1.0.0: published (auth: oidc)`);
    expect(reportOf(world)).toContain("mcp-registry\n  io.github.jbrandtmse/iris-admin-mcp@1.0.0: published (auth: oidc)");
    expect(world.standIns.calls("npm").filter((call) => call.argv[0] === "publish")).toHaveLength(8);
  });

  it("each lookup is a plain read-only GET, and npm is asked for each package version it will publish before the login", async () => {
    const world = registryWorld();
    expect(await world.runRegistry()).toBe(0);
    const urls = world.stores.requests.map((request) => request.url);
    const npmAsked = urls.filter((url) => url.startsWith("https://registry.npmjs.org/"));
    expect(npmAsked).toEqual(["admin", "data", "dev", "interop", "ops"].map((short) => `https://registry.npmjs.org/@iris-mcp%2F${short}/1.0.0`));
    expect(world.stores.requests.every((request) => request.method === "GET" && !request.hasBody)).toBe(true);
    const publisherDownload = urls.findIndex((url) => url.startsWith("https://github.com/modelcontextprotocol/registry/releases/download/"));
    expect(publisherDownload, "the publisher is downloaded after the lookups").toBeGreaterThan(urls.findIndex((url) => url.startsWith("https://registry.modelcontextprotocol.io/")));
  });

  it("every server already listed (a lookup 200 that names it): `already published`, no download and no mcp-publisher call", async () => {
    const world = registryWorld();
    world.stores.mcpRegistry = (name, version) => mcpRegistryHit(name, version);
    expect(await world.runRegistry()).toBe(0);
    expect(world.publisherCalls()).toEqual([]);
    expect(world.stores.requests.some((request) => request.url.includes("/releases/download/"))).toBe(false);
    for (const name of SERVERS) expect(reportOf(world), name).toContain(`${name}@1.0.0: already published`);
  });

  it("one server listed and four absent: the listed one gets no publish call, and the order of the rest holds", async () => {
    const world = registryWorld();
    world.stores.mcpRegistry = (name, version) => (name.endsWith("iris-dev-mcp") ? mcpRegistryHit(name, version) : MCP_REGISTRY_MISS);
    expect(await world.runRegistry()).toBe(0);
    const published = world.publisherCalls().filter((call) => call.argv[0] === "publish").map((call) => path.basename(call.argv[1] as string));
    expect(published).toEqual(["iris-admin-mcp.json", "iris-data-mcp.json", "iris-interop-mcp.json", "iris-ops-mcp.json"]);
    expect(reportOf(world)).toContain("io.github.jbrandtmse/iris-dev-mcp@1.0.0: already published");
  });

  it.each([
    ["a 500", { status: 500 }, /HTTP 500/],
    ["a 403", { status: 403 }, /HTTP 403/],
    ["a network error", { status: 0, fail: "socket hang up" }, /socket hang up/],
    ["a 200 that is not the registry's answer (a captive portal)", HTML_PAGE, /not JSON/],
    ["a 200 that names another version", { status: 200, body: { server: { name: SERVERS[0], version: "9.9.9" } } }, /does not name/],
  ])("a lookup that cannot be judged (%s) is `failed (could not ask the MCP Registry ...)`, with nothing downloaded, nothing posted and exit 1", async (_label, answer, why) => {
    const world = registryWorld();
    world.stores.mcpRegistry = (name, version) => (name === SERVERS[0] ? (answer as FakeAnswer) : mcpRegistryHit(name, version));
    expect(await world.runRegistry()).toBe(1);
    expect(reportOf(world)).toMatch(/mcp-registry\n {2}\d+ servers@1\.0\.0: failed \(could not ask the MCP Registry whether io\.github\.jbrandtmse\/iris-admin-mcp@1\.0\.0 is published \(/);
    expect(reportOf(world)).toMatch(why);
    expect(world.publisherCalls()).toEqual([]);
    expect(world.stores.requests.some((request) => request.url.includes("/releases/download/"))).toBe(false);
  });

  it("a publisher whose sha256 is not the pin is never run: `failed`, nothing posted, exit 1", async () => {
    const world = registryWorld();
    world.stores.publisher = { status: 200, bytes: Buffer.from("not the pinned bytes"), contentType: "application/octet-stream" };
    expect(await world.runRegistry()).toBe(1);
    expect(reportOf(world)).toMatch(/mcp-registry\n {2}5 servers@1\.0\.0: failed \(the mcp-publisher download has the sha256 [0-9a-f]{64}, not the pinned /);
    expect(world.publisherCalls()).toEqual([]);
  });

  it("a download that answers 404 is `failed` and nothing is run", async () => {
    const world = registryWorld();
    world.stores.publisher = { status: 404, body: {} };
    expect(await world.runRegistry()).toBe(1);
    expect(reportOf(world)).toContain("the download of mcp-publisher v9.9.9-test answered HTTP 404");
    expect(world.publisherCalls()).toEqual([]);
  });

  it("npm that never serves a version is `failed` after 5 minutes of polling, with no login and nothing posted", async () => {
    const world = registryWorld();
    world.stores.npmVersion = (name) => (name === "@iris-mcp/dev" ? { status: 404, body: {} } : { status: 200, body: {} });
    expect(await world.runRegistry()).toBe(1);
    expect(reportOf(world)).toContain("npm does not serve @iris-mcp/dev@1.0.0 after 5 minutes");
    expect(world.sleeps.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(300_000);
    expect(new Set(world.sleeps)).toEqual(new Set([10_000]));
    expect(world.publisherCalls(), "no login and no publish").toEqual([]);
  });

  it("npm that serves a version after a few polls lets the publish go on", async () => {
    const world = registryWorld();
    let asked = 0;
    world.stores.npmVersion = () => (++asked <= 3 ? { status: 404, body: {} } : { status: 200, body: {} });
    expect(await world.runRegistry()).toBe(0);
    expect(world.sleeps).toEqual([10_000, 10_000, 10_000]);
    expect(world.publisherCalls().filter((call) => call.argv[0] === "publish")).toHaveLength(5);
  });

  it("a login that fails posts nothing: `failed` with the redacted output, exit 1", async () => {
    const world = registryWorld();
    world.standIns.script("mcp-publisher", [{ match: ["login"], status: 1, stderr: `invalid audience ${OIDC_TOKEN}\n` }]);
    expect(await world.runRegistry()).toBe(1);
    expect(reportOf(world)).toContain("mcp-publisher login github-oidc failed (exit 1): invalid audience ***");
    expect(reportOf(world)).not.toContain(OIDC_TOKEN);
    expect(world.publisherCalls().map((call) => call.argv[0])).toEqual(["login"]);
  });

  it("a publish that fails with a fresh lookup still 404 is `failed (<last lines, redacted>)`, the servers after it are `not attempted`, and the run exits 1", async () => {
    const world = registryWorld();
    world.standIns.script("mcp-publisher", [
      { match: ["login"], stdout: "ok\n" },
      { match: ["publish", "~iris-data-mcp"], status: 1, stderr: `line 1\nline 2\nline 3\nline 4\nline 5 ${OIDC_TOKEN}\n` },
      { match: ["publish"], stdout: "ok\n" },
    ]);
    expect(await world.runRegistry()).toBe(1);
    const report = reportOf(world);
    expect(report).toContain("io.github.jbrandtmse/iris-admin-mcp@1.0.0: published (auth: oidc)");
    expect(report).toContain("io.github.jbrandtmse/iris-data-mcp@1.0.0: failed (line 2\nline 3\nline 4\nline 5 ***)");
    for (const dir of ["iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"]) expect(report, dir).toContain(`io.github.jbrandtmse/${dir}@1.0.0: not attempted`);
    expect(report).not.toContain(OIDC_TOKEN);
    expect(world.publisherCalls().filter((call) => call.argv[0] === "publish")).toHaveLength(2);
  });

  it("a publish that fails but whose fresh lookup says it is there (a race) is `already published`, and the run goes on and exits 0", async () => {
    const world = registryWorld();
    let afterPublish = false;
    world.standIns.script("mcp-publisher", [
      { match: ["login"], stdout: "ok\n" },
      { match: ["publish", "~iris-data-mcp"], status: 1, stderr: "400 version already exists\n" },
      { match: ["publish"], stdout: "ok\n" },
    ]);
    world.stores.mcpRegistry = (name, version) => {
      if (name.endsWith("iris-data-mcp")) {
        if (afterPublish) return mcpRegistryHit(name, version);
        afterPublish = true;
      }
      return MCP_REGISTRY_MISS;
    };
    expect(await world.runRegistry()).toBe(0);
    expect(reportOf(world)).toContain("io.github.jbrandtmse/iris-data-mcp@1.0.0: already published");
    expect(world.publisherCalls().filter((call) => call.argv[0] === "publish")).toHaveLength(5);
  });

  it("the OIDC request variables reach mcp-publisher login only; no validate, no publish, no git and no npm call holds them, and no secret reaches any call", async () => {
    const world = registryWorld();
    expect(await world.runRegistry({ env: { NPM_TOKEN: TOKEN, IPM_DIST_DEPLOY_KEY: KEY } })).toBe(0);
    const holding = (call: StandInCall): boolean => "ACTIONS_ID_TOKEN_REQUEST_TOKEN" in call.env || "ACTIONS_ID_TOKEN_REQUEST_URL" in call.env;
    const login = world.publisherCalls().find((call) => call.argv[0] === "login") as StandInCall;
    expect(holding(login)).toBe(true);
    expect(login.env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]).toBe(OIDC_TOKEN);
    for (const call of world.publisherCalls().filter((candidate) => candidate.argv[0] !== "login")) expect(holding(call), `mcp-publisher ${call.argv[0]}`).toBe(false);
    for (const call of world.standIns.calls("npm").filter((candidate) => candidate.argv[0] !== "publish")) expect(holding(call), `npm ${call.argv[0]}`).toBe(false);
    const everything = JSON.stringify(world.publisherCalls());
    for (const secret of [TOKEN, "SECRETKEYBODY"]) expect(everything, secret).not.toContain(secret);
    expect(reportOf(world)).not.toContain(OIDC_TOKEN);
  });

  it("the publisher runs with a temporary HOME that is gone afterwards, on a success and on a failure, and the work directory with it", async () => {
    for (const fail of [false, true]) {
      const world = registryWorld();
      if (fail) world.standIns.script("mcp-publisher", [{ match: ["login"], stdout: "ok\n" }, { match: ["publish"], status: 1, stderr: "boom\n" }]);
      const privateTmp = scratch("release-private-tmp-");
      const code = await withTmpdir(privateTmp, () => world.runRegistry());
      expect(code, `fail ${fail}`).toBe(fail ? 1 : 0);
      const homes = world.publisherCalls().map((call) => call.env["HOME"] as string);
      expect(homes.length).toBeGreaterThan(0);
      for (const home of homes) {
        expect(home.startsWith(privateTmp), "HOME is under the temporary directory").toBe(true);
        expect(home, "a HOME of its own, not the runner's").not.toBe(process.env["HOME"]);
        expect(existsSync(home), `fail ${fail}: the HOME is removed`).toBe(false);
      }
      expect(new Set(homes).size, "one HOME for the login and the publishes").toBe(1);
      expect(readdirSync(privateTmp), `fail ${fail}: nothing is left in the temporary directory`).toEqual([]);
    }
  });

  it("an earlier failed channel stops the registry: `not attempted`, with no lookup and no download", async () => {
    const world = registryWorld();
    world.standIns.script("npm", [{ match: ["publish", "~iris-mcp-client-config"], status: 1, stderr: "boom\n" }, ...NPM_DEFAULT]);
    expect(await world.runRegistry()).toBe(1);
    expect(reportOf(world)).toContain("mcp-registry\n  5 servers@1.0.0: not attempted");
    expect(lookupsOf(world)).toEqual([]);
  });

  it("a registry failure is the last thing the run does: npm and the stores before it have published, and the run exits 1 (a rerun recovers it)", async () => {
    const world = registryWorld();
    world.standIns.script("mcp-publisher", [{ match: ["login"], status: 1, stderr: "boom\n" }]);
    expect(await world.runRegistry({ channels: [{ id: "npm", enabled: true }, { id: "vscode-marketplace", enabled: true }, { id: "open-vsx", enabled: true }, { id: "mcp-registry", enabled: true }] })).toBe(1);
    const report = reportOf(world);
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: published");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: published");
    expect(report).toContain("mcp-registry\n  5 servers@1.0.0: failed");
    expect(report.indexOf("open-vsx\n")).toBeLessThan(report.indexOf("mcp-registry\n"));
  });

  describe("a run with no `channels` option publishes the script's own five channels", () => {
    const channelOrder = (report: string): number[] => ["@iris-mcp/dev@1.0.0", "vscode-marketplace", "open-vsx", "ipm", "mcp-registry"].map((id) => report.indexOf(id));

    it("publish: npm, both stores, `ipm` and then `mcp-registry` last, and the registry stand-in was called", async () => {
      const world = registryWorld();
      world.standIns.script("git", [
        { match: ["clone"], effects: [{ mkdir: "$LAST" }, { mkdir: "$LAST/.git" }] },
        { match: ["write-tree"], stdout: "tree-new\n" },
        { match: ["rev-parse"], status: 1 },
      ]);
      expect(await world.runRegistry({ channels: SCRIPT_DEFAULT_CHANNELS, env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(0);
      const report = reportOf(world);
      const positions = channelOrder(report);
      expect(positions.every((position) => position >= 0), `every channel is in the report: ${positions}`).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      expect(report).toContain("mcp-registry\n  io.github.jbrandtmse/iris-admin-mcp@1.0.0: published (auth: oidc)");
      expect(world.publisherCalls().filter((call) => call.argv[0] === "publish")).toHaveLength(5);
    });

    it("rehearsal: the same five channels in the same order, `mcp-registry` last and asked, with every channel ready", async () => {
      const world = registryWorld();
      expect(await world.runRegistry({ dryRun: true, channels: SCRIPT_DEFAULT_CHANNELS })).toBe(0);
      const report = reportOf(world);
      const positions = channelOrder(report);
      expect(positions.every((position) => position >= 0), `every channel is in the report: ${positions}`).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      expect(report).toContain("mcp-registry: ready (would publish 5 servers)");
      expect(world.publisherCalls().map((call) => call.argv[0])).toEqual(["validate", "validate", "validate", "validate", "validate"]);
    });
  });

  describe("a rehearsal's reads of the other channels leave the registry's own rows alone", () => {
    it("the IPM registry lists the version: the dry step reads `ready (would be already published)` without consulting the packaging tag or tree, and the rehearsal exits 0", async () => {
      const world = registryWorld();
      world.registry.answer = { status: 200, body: { name: "iris-execute-mcp-v2", version: "1.0.0", versions: ["0.9.0", "1.0.0"] } };
      expect(await world.runRegistry({ dryRun: true, channels: [{ id: "npm", enabled: true }, { id: "ipm", enabled: true }, { id: "mcp-registry", enabled: true }] })).toBe(0);
      expect(reportOf(world)).toContain("ipm\n  iris-execute-mcp-v2@1.0.0: ready (would be already published)");
      expect(world.standIns.calls("git").map((call) => call.argv[0]), "only the HEAD read: no clone, no tag or tree lookup").toEqual(["ls-remote"]);
    });

    it("an npm dry-run publish that fails leaves `mcp-registry` `not attempted`, with no registry lookup and no publisher download", async () => {
      const world = registryWorld();
      world.standIns.script("npm", [{ match: ["publish", "~iris-mcp-admin"], status: 1, stderr: "E403\n" }, ...NPM_DEFAULT]);
      expect(await world.runRegistry({ dryRun: true })).toBe(1);
      expect(reportOf(world)).toContain("mcp-registry\n  5 servers@1.0.0: not attempted");
      expect(lookupsOf(world)).toEqual([]);
      expect(world.stores.requests.some((request) => request.url.includes("/releases/download/"))).toBe(false);
      expect(world.publisherCalls()).toEqual([]);
    });
  });

  describe("the publish loop and the manifest's listing (review patches)", () => {
    it("a server the registry already lists reads `already published` even after an earlier server failed; only servers still absent read `not attempted`", async () => {
      const world = registryWorld();
      world.stores.mcpRegistry = (name, version) => (name.endsWith("iris-interop-mcp") ? mcpRegistryHit(name, version) : MCP_REGISTRY_MISS);
      world.standIns.script("mcp-publisher", [
        { match: ["login"], stdout: "ok\n" },
        { match: ["publish", "~iris-data-mcp"], status: 1, stderr: "boom\n" },
        { match: ["publish"], stdout: "ok\n" },
      ]);
      expect(await world.runRegistry()).toBe(1);
      const report = reportOf(world);
      expect(report).toContain("io.github.jbrandtmse/iris-data-mcp@1.0.0: failed");
      expect(report).toContain("io.github.jbrandtmse/iris-dev-mcp@1.0.0: not attempted");
      expect(report).toContain("io.github.jbrandtmse/iris-interop-mcp@1.0.0: already published");
      expect(report).toContain("io.github.jbrandtmse/iris-ops-mcp@1.0.0: not attempted");
      expect(world.publisherCalls().filter((call) => call.argv[0] === "publish")).toHaveLength(2);
    });

    it("a manifest whose registry entry lists no server.json is refused before any upload (exit 2)", async () => {
      const world = registryWorld();
      const entry = world.manifest.channels.find((channel: { id: string }) => channel.id === "mcp-registry") as { servers: unknown[] };
      entry.servers = [];
      writeManifest(world.artifacts, world.manifest);
      expect(await world.runRegistry()).toBe(2);
      expect(reportOf(world)).toContain("refusing: mcp-registry: the manifest lists no server.json. Prepare the artifacts again.");
      expect(world.publisherCalls()).toEqual([]);
      expect(world.standIns.calls("npm").every((call) => call.argv[0] === "--version"), "no upload").toBe(true);
    });

    it("uploadPathProblems names an enabled registry channel with no server.json, and one with no entry at all; a disabled channel and a listed one are clean", () => {
      const server = { name: "io.github.jbrandtmse/iris-dev-mcp", version: "1.0.0", package: "@iris-mcp/dev", file: "mcp-registry/iris-dev-mcp.json" };
      const manifest = (entry: unknown) => ({ mode: "release", version: "1.0.0", files: [{ path: "mcp-registry/iris-dev-mcp.json" }], channels: entry === undefined ? [] : [{ id: "mcp-registry", ...(entry as object) }] });
      const on = [{ id: "mcp-registry", enabled: true }];
      expect(uploadPathProblems(manifest({ servers: [] }), on)).toEqual(["mcp-registry: the manifest lists no server.json. Prepare the artifacts again."]);
      expect(uploadPathProblems(manifest(undefined), on)).toEqual(["mcp-registry: the manifest has no mcp-registry entry, so no server.json would be posted. Prepare the artifacts again."]);
      expect(uploadPathProblems(manifest(undefined), [{ id: "mcp-registry", enabled: false }])).toEqual([]);
      expect(uploadPathProblems(manifest({ servers: [server] }), on)).toEqual([]);
    });

    it("an enabled registry channel whose manifest entry is absent is refused before any upload (exit 2); a disabled one is not", async () => {
      const world = registryWorld();
      world.manifest.channels = world.manifest.channels.filter((channel: { id: string }) => channel.id !== "mcp-registry");
      writeManifest(world.artifacts, world.manifest);
      expect(await world.runRegistry()).toBe(2);
      expect(reportOf(world)).toContain("refusing: mcp-registry: the manifest has no mcp-registry entry, so no server.json would be posted. Prepare the artifacts again.");
      expect(world.standIns.calls("npm").every((call) => call.argv[0] === "--version"), "no upload").toBe(true);

      const disabled = registryWorld();
      disabled.manifest.channels = disabled.manifest.channels.filter((channel: { id: string }) => channel.id !== "mcp-registry");
      writeManifest(disabled.artifacts, disabled.manifest);
      expect(await disabled.runRegistry({ channels: [{ id: "npm", enabled: true }, { id: "mcp-registry", enabled: false, enabledBy: "test" }] })).toBe(0);
    });
  });

  describe("the rehearsal", () => {
    it("every lookup 404, the publisher verified and every listing validated: `ready (would publish 5 servers)`, exit 0, and no login, no publish", async () => {
      const world = registryWorld();
      expect(await world.runRegistry({ dryRun: true })).toBe(0);
      expect(reportOf(world)).toContain("mcp-registry: ready (would publish 5 servers)");
      const calls = world.publisherCalls();
      expect(calls.map((call) => call.argv[0])).toEqual(["validate", "validate", "validate", "validate", "validate"]);
      expect(calls.map((call) => path.relative(world.artifacts, call.argv[1] as string))).toEqual(["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"].map((dir) => `mcp-registry/${dir}.json`));
      for (const call of calls) expect("ACTIONS_ID_TOKEN_REQUEST_TOKEN" in call.env, "a rehearsal holds no OIDC variable").toBe(false);
      expect(world.standIns.calls("npm").every((call) => call.argv[0] !== "publish" || call.argv.includes("--dry-run"))).toBe(true);
    });

    it("every lookup 200: `ready (would be already published)`", async () => {
      const world = registryWorld();
      world.stores.mcpRegistry = (name, version) => mcpRegistryHit(name, version);
      expect(await world.runRegistry({ dryRun: true })).toBe(0);
      expect(reportOf(world)).toContain("mcp-registry: ready (would be already published)");
    });

    it("a hash mismatch, a validate failure and an unreadable lookup are each `not ready (...)`, reported but never failing the rehearsal (decision #108)", async () => {
      const mismatch = registryWorld();
      mismatch.stores.publisher = { status: 200, bytes: Buffer.from("other bytes"), contentType: "application/octet-stream" };
      expect(await mismatch.runRegistry({ dryRun: true })).toBe(0);
      expect(reportOf(mismatch)).toMatch(/mcp-registry: not ready \(the mcp-publisher download has the sha256 /);
      expect(mismatch.publisherCalls()).toEqual([]);

      const invalid = registryWorld();
      invalid.standIns.script("mcp-publisher", [{ match: ["validate", "~iris-dev-mcp"], status: 1, stdout: "Validation failed with 1 issue\n" }, { match: ["validate"], stdout: "ok\n" }]);
      expect(await invalid.runRegistry({ dryRun: true })).toBe(0);
      expect(reportOf(invalid)).toMatch(/mcp-registry: not ready \(mcp-publisher validate rejected mcp-registry\/iris-dev-mcp\.json: Validation failed with 1 issue/);

      const unreadable = registryWorld();
      unreadable.stores.mcpRegistry = () => ({ status: 503 });
      expect(await unreadable.runRegistry({ dryRun: true })).toBe(0);
      expect(reportOf(unreadable)).toMatch(/mcp-registry: not ready \(could not ask the MCP Registry whether io\.github\.jbrandtmse\/iris-admin-mcp@1\.0\.0 is published \(HTTP 503\)/);
      expect(reportOf(unreadable)).toContain("mcp-registry is not ready, which does not stop the rehearsal");
    });

    it("IPM not ready still fails the rehearsal (exit 1), while the registry, which is read-only, is still asked and reads `ready (would publish 5 servers)`", async () => {
      const world = registryWorld();
      world.registry.answer = { status: 503 };
      expect(await world.runRegistry({ dryRun: true, channels: [{ id: "npm", enabled: true }, { id: "ipm", enabled: true }, { id: "mcp-registry", enabled: true }] })).toBe(1);
      expect(reportOf(world)).toContain("ipm: not ready (the registry could not be read (HTTP 503))");
      expect(reportOf(world)).toContain("mcp-registry: ready (would publish 5 servers)");
    });

    it("the temporary HOME and work directory of the dry step are removed", async () => {
      const world = registryWorld();
      const privateTmp = scratch("release-private-tmp-");
      expect(await withTmpdir(privateTmp, () => world.runRegistry({ dryRun: true }))).toBe(0);
      const homes = world.publisherCalls().map((call) => call.env["HOME"] as string);
      expect(homes.length).toBeGreaterThan(0);
      for (const home of homes) expect(existsSync(home)).toBe(false);
      expect(readdirSync(privateTmp)).toEqual([]);
    });
  });

  it("the report's item names and the version come from the manifest, and a listing that is not at the release version is refused before any upload", async () => {
    const world = registryWorld();
    const entry = (world.manifest.channels.find((channel: { id: string }) => channel.id === "mcp-registry") as { servers: Array<{ version: string }> }).servers[0] as { version: string };
    entry.version = "0.9.0";
    writeManifest(world.artifacts, world.manifest);
    expect(await world.runRegistry()).toBe(2);
    expect(reportOf(world)).toMatch(/refusing: mcp-registry: io\.github\.jbrandtmse\/iris-admin-mcp@0\.9\.0 is not at the release version 1\.0\.0/);
    expect(world.publisherCalls()).toEqual([]);
    expect(world.standIns.calls("npm").every((call) => call.argv[0] === "--version"), "no upload").toBe(true);
  });

  it("a listing that is not a hash-verified .json of the manifest is refused before any upload", async () => {
    const world = registryWorld();
    const entry = (world.manifest.channels.find((channel: { id: string }) => channel.id === "mcp-registry") as { servers: Array<{ file: string }> }).servers[0] as { file: string };
    entry.file = "../outside.json";
    writeManifest(world.artifacts, world.manifest);
    expect(await world.runRegistry()).toBe(2);
    expect(reportOf(world)).toMatch(/refusing: mcp-registry: .*its listing "\.\.\/outside\.json" is not a hash-verified \.json/);
    expect(world.publisherCalls()).toEqual([]);
    expect(world.standIns.calls("npm").every((call) => call.argv[0] === "--version"), "no upload").toBe(true);
  });
});
