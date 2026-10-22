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
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { stripComments } from "../../../../scripts/lib/script-ts-import-scan.mjs";
import { NPM_PUBLISH_ORDER, RELEASE_CHANNELS } from "../../../../scripts/lib/release-core.mjs";
import { ciGate, createCleanups, defaultDeps, parseArgs, publish } from "../../../../scripts/release.mjs";
import { installStandIns, type StandInCall, type StandInRule, type StandIns } from "./stand-in-clis";
import {
  SHA,
  ciRun,
  makeArtifacts,
  newFakeGithub,
  protectedEnvironment,
  startGithubServer,
  startHangingServer,
  fakeFetch,
  writeManifest,
  type ArtifactManifest,
  type FakeAnswer,
  type FakeGithub,
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

  it("every module that only prepare needs is loaded by a dynamic import() inside prepare's loader, and nowhere else", () => {
    const code = stripComments(readFileSync(RELEASE_SCRIPT, "utf8"));
    const dynamic = [...code.matchAll(/(?<![\w$.])import\(/g)];
    expect(dynamic.length, "one import() call, in the loader").toBe(1);
    const loader = /async function loadPrepareModules[\s\S]*?\n\}\n/.exec(code)?.[0] ?? "";
    expect(loader).toContain("import(pathToFileURL");
    for (const module of ["scripts/throwaway-iris.mjs", "scripts/lib/ci-checks.mjs", "scripts/lib/pnpm-pack.mjs", "scripts/ci-package-smoke.mjs", "scripts/lib/ipm-archive.mjs"]) {
      expect(loader, module).toContain(`'${module}'`);
    }
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

  it("the command line: three commands, their flags, and exit code 2 for anything else", () => {
    expect(parseArgs(["ci-gate"])).toEqual({ command: "ci-gate", options: {} });
    expect(parseArgs(["ci-gate", "--timeout-minutes", "5"])).toEqual({ command: "ci-gate", options: { timeoutMinutes: 5 } });
    expect(parseArgs(["prepare", "--out", "/x"])).toEqual({ command: "prepare", options: { out: "/x" } });
    expect(parseArgs(["publish", "--artifacts", "/x"])).toEqual({ command: "publish", options: { artifacts: "/x", dryRun: false } });
    expect(parseArgs(["publish", "--dry-run", "--artifacts", "/x"])).toEqual({ command: "publish", options: { artifacts: "/x", dryRun: true } });
    expect(parseArgs(["publish", "--artifacts", "/x", "--dry-run"]).options).toEqual({ artifacts: "/x", dryRun: true });
    for (const bad of [[], ["verify"], ["prepare"], ["publish"], ["publish", "--artifacts"], ["ci-gate", "--timeout-minutes", "0"], ["ci-gate", "--timeout-minutes", "x"], ["prepare", "--dry-run", "--out", "/x"], ["publish", "--artifacts", "/x", "--force"], ["publish", "--dry-run", "--dry-run", "--artifacts", "/x"]]) {
      expect(() => parseArgs(bad), JSON.stringify(bad)).toThrow(/usage: node scripts\/release\.mjs/);
    }
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
  manifest: ArtifactManifest;
  lines: string[];
  env: (overrides?: Record<string, string | undefined>) => Record<string, string>;
  run: (options?: { dryRun?: boolean; env?: Record<string, string | undefined>; channels?: unknown; deps?: Record<string, unknown> }) => Promise<number>;
  published: () => StandInCall[];
}

/** A fixture world: artifacts, stand-ins on PATH, a fake GitHub API, a fixture repository root with the extension's stand-in CLIs. */
function newWorld(options: { publisher?: string } = {}): PublishWorld {
  const root = scratch();
  const artifacts = path.join(root, "artifacts");
  const repo = path.join(root, "repo");
  mkdirSync(artifacts, { recursive: true });
  const manifest = makeArtifacts(artifacts, { ...(options.publisher === undefined ? {} : { publisher: options.publisher }) });
  const standIns = installStandIns(path.join(root, "stand-ins"), ["npm", "git"]);
  const extensionBin = path.join(repo, "extensions", "iris-mcp-launcher", "node_modules", ".bin");
  standIns.installInto("vsce", extensionBin);
  standIns.installInto("ovsx", extensionBin);
  standIns.script("npm", NPM_DEFAULT);
  const github = newFakeGithub();
  const registry: Registry = { answer: { status: 404, body: { error: "not found" } } };
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
  const fetchImpl = fakeFetch(github, (url) => (url.startsWith("https://pm.community.intersystems.com/") ? registry.answer : undefined));
  return {
    root,
    artifacts,
    repo,
    standIns,
    github,
    registry,
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
          ...(runOptions.channels === undefined ? {} : { channels: runOptions.channels as typeof RELEASE_CHANNELS }),
        },
        { ...defaultDeps(), fetch: fetchImpl, log: (line: string) => lines.push(line), cleanups: createCleanups(), ...(runOptions.deps ?? {}) },
      ),
    published: () => standIns.calls("npm").filter((call) => call.argv[0] === "publish"),
  };
}

/** The channels with every one of them enabled, for the stand-ins. */
const ALL_ENABLED = RELEASE_CHANNELS.map((channel: { id: string }) => ({ id: channel.id, enabled: true }));

/** npm and IPM enabled, the stores disabled. */
const IPM_ONLY = [{ id: "npm", enabled: true }, { id: "vscode-marketplace", enabled: false, enabledBy: "test" }, { id: "open-vsx", enabled: false, enabledBy: "test" }, { id: "ipm", enabled: true }];

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
    expect(report).toContain("iris-mcp-launcher@0.1.0: not attempted");
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
  it("the extension and IPM channels are disabled: each prints `skipped: not enabled (<story>)`, and no store CLI and no git runs", async () => {
    const world = newWorld();
    expect(await world.run()).toBe(0);
    const report = world.lines.join("\n");
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@0.1.0: skipped: not enabled (Story 42.7)");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@0.1.0: skipped: not enabled (Story 42.7)");
    expect(report).toContain("ipm\n  iris-execute-mcp-v2@1.0.0: skipped: not enabled (Story 42.8)");
    expect(world.standIns.calls("git")).toEqual([]);
    expect(world.standIns.calls("vsce")).toEqual([]);
    expect(world.standIns.calls("ovsx")).toEqual([]);
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
    expect(vsce.argv).toEqual(["publish", "--packagePath", path.join(world.artifacts, "vsix", "iris-mcp-launcher-0.1.0.vsix"), "--skip-duplicate"]);
    const ovsx = world.standIns.calls("ovsx")[0] as StandInCall;
    expect(ovsx.argv).toEqual(["publish", path.join(world.artifacts, "vsix", "iris-mcp-launcher-0.1.0.vsix"), "--skip-duplicate"]);
    expect(realpathSync(vsce.cwd)).toBe(realpathSync(path.join(world.repo, "extensions", "iris-mcp-launcher")));
    const report = world.lines.join("\n");
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@0.1.0: published");
    expect(report).toContain("open-vsx\n  iris-mcp-launcher@0.1.0: published");
    expect(report).toMatch(/ipm\n {2}iris-execute-mcp-v2@1\.0\.0: published/);
  });

  it("a store CLI that is not installed, or a publisher that is still the placeholder, fails an enabled channel and stops what follows", async () => {
    const placeholder = newWorld();
    expect(await placeholder.run({ channels: ALL_ENABLED })).toBe(1);
    expect(placeholder.lines.join("\n")).toMatch(/vscode-marketplace: failed|iris-mcp-launcher@0\.1\.0: failed \(the publisher is TBD-at-publish-time/);
    expect(placeholder.standIns.calls("vsce")).toEqual([]);
    expect(placeholder.lines.join("\n")).toContain("open-vsx\n  iris-mcp-launcher@0.1.0: not attempted");

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
    expect(world.lines.join("\n")).toMatch(/vscode-marketplace\n {2}iris-mcp-launcher@0\.1\.0: failed \(vsce error 401/);
    expect(world.lines.join("\n")).toContain("ipm\n  iris-execute-mcp-v2@1.0.0: not attempted");
  });

  it("the channels are enabled by default only for npm: the real RELEASE_CHANNELS", () => {
    expect(RELEASE_CHANNELS.filter((channel: { enabled: boolean }) => channel.enabled).map((channel: { id: string }) => channel.id)).toEqual(["npm"]);
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

  it("a version the registry already lists is refused (exit 1) with no git call at all", async () => {
    const world = ipmWorld();
    world.registry.answer = { status: 200, body: { name: "iris-execute-mcp-v2", version: "1.0.0", versions: ["0.9.0", "1.0.0"] } };
    expect(await world.run({ channels: ALL_ENABLED.map((channel: { id: string }) => ({ ...channel, enabled: channel.id === "ipm" })), env: { IPM_DIST_DEPLOY_KEY: KEY } })).toBe(1);
    expect(world.standIns.calls("git")).toEqual([]);
    expect(world.lines.join("\n")).toContain("the IPM registry already lists 1.0.0");
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
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith("release-ipm-"));
    const code = await world.run({
      channels: IPM_ONLY,
      env: { IPM_DIST_DEPLOY_KEY: KEY, NPM_TOKEN: TOKEN },
      deps: {
        run: (argv: string[], options: Parameters<typeof run>[1]) => {
          if (argv[0] !== "git") return run(argv, options);
          attempts.push(argv);
          throw new Error(`ENOSPC: no space left on device, write ${TOKEN}`);
        },
      },
    });
    expect(code).toBe(1);
    expect(attempts, "the first git call of the channel threw").toHaveLength(1);
    expect(world.published()).toHaveLength(8);
    const report = world.lines.join("\n");
    for (const name of NPM_PUBLISH_ORDER) expect(report, name).toContain(`${name}@1.0.0: published`);
    expect(report).toMatch(/ipm\n {2}iris-execute-mcp-v2@1\.0\.0: failed \(ENOSPC: no space left on device, write \*\*\*\)/);
    expect(report, "the redaction of the report").not.toContain(TOKEN);
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith("release-ipm-")), "the channel's working directory is removed").toEqual(before);
  });
});

describe("Rehearse: publish --dry-run (AC 42.5.4)", () => {
  it("one `npm publish <tgz> ... --dry-run` per package, in order; NPM_TOKEN is never read: no userconfig, no auth line, the value nowhere", async () => {
    const world = newWorld();
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith("release-npm-"));
    expect(await world.run({ dryRun: true, env: { NPM_TOKEN: TOKEN } })).toBe(0);
    const uploads = world.published();
    expect(uploads.map((call) => call.argv.slice(2))).toEqual(NPM_PUBLISH_ORDER.map(() => ["--access", "public", "--provenance", "--ignore-scripts", "--dry-run"]));
    expect(uploads.map((call) => tarballOf(call, world.artifacts))).toEqual(NPM_PUBLISH_ORDER.map((name: string) => `npm/iris-mcp-${name.replace(/^@iris-mcp\//, "")}-1.0.0.tgz`));
    expect(world.standIns.calls("npm").every((call) => !call.argv.includes("--userconfig"))).toBe(true);
    expect(readdirSync(tmpdir()).filter((name) => name.startsWith("release-npm-")), "no userconfig directory was made").toEqual(before);
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
    expect(world.lines.join("\n")).toContain("vscode-marketplace\n  iris-mcp-launcher@0.1.0: ready");
  });

  it("a version that is on the registry is `would be already published`, and its dry-run publish is not made", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["view", "@iris-mcp/data@1.0.0"], stdout: "1.0.0\n" }, ...NPM_DEFAULT]);
    expect(await world.run({ dryRun: true })).toBe(0);
    expect(world.published()).toHaveLength(7);
    expect(world.lines.join("\n")).toContain("@iris-mcp/data@1.0.0: would be already published");
  });

  it("every disabled channel runs its dry step and reports its readiness: the placeholder publisher, a missing CLI, the packaging repository", async () => {
    const world = newWorld();
    world.standIns.script("git", [{ match: ["ls-remote"], status: 128, stderr: "fatal: repository not found\n" }]);
    expect(await world.run({ dryRun: true })).toBe(0);
    const report = world.lines.join("\n");
    expect(report).toContain("vscode-marketplace: skipped: not enabled (Story 42.7); dry step: not ready: the publisher is TBD-at-publish-time");
    expect(report).toContain("open-vsx: skipped: not enabled (Story 42.7); dry step: not ready: the publisher is TBD-at-publish-time");
    expect(report).toContain("ipm: skipped: not enabled (Story 42.8); dry step: not ready: the packaging repository jbrandtmse/iris-execute-mcp-v2-ipm is absent or not readable");
    expect(world.standIns.calls("git").map((call) => call.argv)).toEqual([["ls-remote", "--symref", "https://github.com/jbrandtmse/iris-execute-mcp-v2-ipm.git", "HEAD"]]);
    rmSync(path.join(world.repo, "extensions", "iris-mcp-launcher", "node_modules", ".bin", "ovsx"));
    world.lines.length = 0;
    expect(await world.run({ dryRun: true })).toBe(0);
    expect(world.lines.join("\n")).toContain("open-vsx: skipped: not enabled (Story 42.7); dry step: not ready: the publisher is TBD-at-publish-time; ovsx is not installed in extensions/iris-mcp-launcher/node_modules");
    world.registry.answer = { status: 503 };
    world.lines.length = 0;
    expect(await world.run({ dryRun: true })).toBe(0);
    expect(world.lines.join("\n")).toContain("dry step: not ready: the registry could not be read (HTTP 503)");
  });

  it("a disabled channel's readiness is `ready` when its prerequisites are there", async () => {
    const world = newWorld({ publisher: "acme" });
    world.registry.answer = { status: 404 };
    expect(await world.run({ dryRun: true })).toBe(0);
    const report = world.lines.join("\n");
    expect(report).toContain("vscode-marketplace\n  iris-mcp-launcher@0.1.0: skipped: not enabled (Story 42.7) (ready)");
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
    const enabled = newWorld();
    expect(await enabled.run({ dryRun: true, channels: ALL_ENABLED })).toBe(1);
    expect(enabled.lines.join("\n")).toMatch(/vscode-marketplace\n {2}iris-mcp-launcher@0\.1\.0: not ready \(the publisher is TBD-at-publish-time/);
    expect(enabled.lines.join("\n")).toContain("open-vsx\n  iris-mcp-launcher@0.1.0: not attempted");
    const disabled = newWorld();
    expect(await disabled.run({ dryRun: true })).toBe(0);
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
  /** A real process run of the script against the fake GitHub API on a loopback port. */
  async function scripted(world: PublishWorld, args: string[], env: Record<string, string>, onStart?: (pid: number) => void) {
    const server = await startGithubServer(world.github);
    servers.push(server.close);
    return runNode([RELEASE_SCRIPT, ...args], { ...world.env({ GITHUB_API_URL: server.url, ...env }) }, onStart);
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
    process.kill(pid, "SIGTERM");
    const result = await running;
    expect(result.status).toBe(143);
    expect(existsSync(config), "the userconfig is deleted on SIGTERM").toBe(false);
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
