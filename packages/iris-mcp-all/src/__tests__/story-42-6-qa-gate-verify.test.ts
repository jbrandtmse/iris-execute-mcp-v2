/**
 * Story 42.6 QA (DW-696, DW-612, AC 42.6.2, AC 42.6.3; Rule #36, #54, #59) -- the rows that the implement stage's pinning tests left
 * thin, each asked of the real surface rather than of the implementation's own shapes.
 *
 *  - The tag-on-main gate over what a real HTTP answer can be (an HTML page, an empty body, `null`, a rate limit, a bad token), the
 *    runs that are not a push of a `v` tag (a dispatch, even from a tag ref, must never be refused for not being on main), the order
 *    against a CI that never turns green, and the whole script as a real process on a dry run.
 *  - More compare bodies captured from the real API. Captured on 2026-11-20 with the read-only
 *      gh api -X GET "repos/jbrandtmse/iris-execute-mcp-v2/compare/main...<ref>?per_page=1"
 *    for the branch `feature/feature-wave-7-skills-pack` (behind 1), `feature/feature-wave-8-published-install` (ahead 37), `main`
 *    (identical), and the refs `not-a-sha` and `abc` (HTTP 404, whose body is `{"message":"Not Found","documentation_url":...,"status":"404"}`).
 *    The top-level keys of a full 200 body, from `gh api ... --jq keys`: ahead_by, base_commit, behind_by, commits, diff_url, files,
 *    html_url, merge_base_commit, patch_url, permalink_url, status, total_commits, url (the nested values below are trimmed).
 *  - `prepare`'s check set against the CI workflow FILE (not the constant that builds it): a step removed from either side goes red.
 *  - `verify`: a wrong version, a wrong predicate, a network failure that is not "not published", a spawn failure, an rejecting runner,
 *    and a child environment that holds no secret value at all, in both children.
 *  - The tag consistency check at the committed tree (all packages at one version, none pending) and a drift of any single package.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { NPM_PUBLISH_ORDER, ROOT_CHECK_SCRIPT, compareVersions, mainReachability, versionProblems } from "../../../../scripts/lib/release-core.mjs";
import { ciGate, createCleanups, defaultDeps, embeddedVersionProblems, readReleaseFacts, releaseCheckScripts, verify } from "../../../../scripts/release.mjs";
import { installStandIns } from "./stand-in-clis";
import { SHA, ciRun, compareAnswer, fakeFetch, fakeStoresFetch, makeRepo, mcpRegistryHit, newFakeGithub, newFakeStores, startGithubServer, type FakeAnswer, type FakeGithub } from "./release-script-fixtures";

const GITHUB_TOKEN = "ghs_SECRETGITHUBTOKEN0987654321";
const TAG_ENV = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.0.0", GITHUB_SHA: SHA, GITHUB_TOKEN, GITHUB_REPOSITORY: "o/r" };
const DRY_ENV = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/release-dry-run/42-6", GITHUB_SHA: SHA, GITHUB_TOKEN, GITHUB_REPOSITORY: "o/r" };

const roots: string[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A scratch directory under `os.tmpdir()`, removed after the test. */
function scratch(prefix = "qa-42-6-"): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/** `os.tmpdir()` reads TMPDIR on every call, so a test can see exactly the directories that the in-process run made. */
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

/** Run `node <args>` as a real process with exactly `env`. */
function runNode(args: string[], env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

// -- ci-gate ---------------------------------------------------------------------------------------------------------

/** In-process dependencies over the fake API; `compare` (when given) answers every compare request itself with a raw `Response`. */
function gateWorld(github: FakeGithub, compare?: () => Response) {
  const lines: string[] = [];
  const sleeps: number[] = [];
  const base = fakeFetch(github);
  let now = 0;
  const deps = {
    ...defaultDeps(),
    fetch: ((url: string, init?: RequestInit) => {
      if (compare !== undefined && String(url).includes("/compare/")) {
        github.requests.push(`${new URL(String(url)).pathname}${new URL(String(url)).search}`);
        return Promise.resolve(compare());
      }
      return base(url, init);
    }) as unknown as typeof fetch,
    log: (line: string) => lines.push(line),
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
  };
  return { lines, sleeps, deps, text: () => lines.join("\n"), runsRead: () => github.requests.some((request) => request.includes("/actions/runs")) };
}

describe("ci-gate over the answers a real HTTP call can bring back (DW-696; Rule #54: every fake below is a body an API or a proxy can send)", () => {
  const BODIES: Array<[string, number, string, string, RegExp]> = [
    ["an HTML page from a proxy that answered 200", 200, "<html><body>Bad gateway</body></html>", "text/html", /holds no known status/],
    ["an empty 200 body", 200, "", "application/json", /holds no known status/],
    ["a JSON null", 200, "null", "application/json", /holds no known status/],
    ["a JSON array", 200, "[]", "application/json", /holds no known status/],
    ["a bare JSON string that names a status", 200, '"ahead"', "application/json", /holds no known status/],
    ["a status that is an object", 200, '{"status":{"state":"ahead"}}', "application/json", /holds no known status/],
    ["a status that is null", 200, '{"status":null}', "application/json", /holds no known status/],
    ["a 502 page", 502, "<html>502 Bad Gateway</html>", "text/html", /\(HTTP 502\)/],
    ["a 401 for a token that cannot read", 401, '{"message":"Bad credentials","status":"401"}', "application/json", /\(HTTP 401\)/],
    ["a 403 secondary rate limit", 403, '{"message":"You have exceeded a secondary rate limit."}', "application/json", /\(HTTP 403\)/],
    ["a 429", 429, '{"message":"API rate limit exceeded"}', "application/json", /\(HTTP 429\)/],
  ];
  const raw = (status: number, body: string, type: string) => () => new Response(body === "" ? null : body, { status, headers: { "Content-Type": type } });

  it.each(BODIES)("a tag run over %s: exit 1 naming the cause, and the CI runs are never read", async (_label, status, body, type, expected) => {
    const github = newFakeGithub();
    const world = gateWorld(github, raw(status, body, type));
    expect(await ciGate({ env: TAG_ENV }, world.deps)).toBe(1);
    expect(world.text()).toContain(`refusing the tag run: whether ${SHA} is on main could not be read (`);
    expect(world.text()).toMatch(expected);
    expect(world.runsRead(), "no CI read, so no approval can follow").toBe(false);
    expect(world.sleeps).toEqual([]);
  });

  it.each(BODIES)("a dry run over %s: one `unreadable` report line, a tag run stops here, and the run goes on (exit 0)", async (_label, status, body, type, expected) => {
    const github = newFakeGithub();
    const world = gateWorld(github, raw(status, body, type));
    expect(await ciGate({ env: DRY_ENV }, world.deps)).toBe(0);
    expect(world.text()).toMatch(new RegExp(`commit c+: unreadable \\(.*\\); a tag run stops here`));
    expect(world.text()).toMatch(expected);
    expect(world.text()).not.toContain("refusing");
    expect(world.runsRead(), "CI is still gated on a dry run").toBe(true);
  });

  it.each([
    ["a manual dispatch on a branch", { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/probe" }],
    ["a manual dispatch FROM a tag ref (only a push of the tag is a release)", { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/tags/v1.0.0" }],
    ["a push to a release-dry-run branch", { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/release-dry-run/x" }],
    ["a push of a tag that is not a v tag", { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/nightly" }],
    ["a pull request", { GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/9/merge" }],
  ])("%s on a commit that is not on main is never refused for that: a report line, then CI decides", async (_label, event) => {
    for (const status of ["ahead", "diverged"]) {
      const github = newFakeGithub();
      github.compare = compareAnswer(status);
      const world = gateWorld(github);
      expect(await ciGate({ env: { ...DRY_ENV, ...event } }, world.deps), status).toBe(0);
      expect(world.text(), status).toContain(`is not on main (compare: ${status}); a tag run stops here`);
      expect(world.text(), status).not.toContain("refusing");
      expect(world.runsRead(), status).toBe(true);
    }
  });

  it("a malformed v tag is exit 2 before anything is read (the compare included), even on an off-main commit", async () => {
    const github = newFakeGithub();
    github.compare = compareAnswer("ahead");
    const world = gateWorld(github);
    expect(await ciGate({ env: { ...TAG_ENV, GITHUB_REF: "refs/tags/v1.0" } }, world.deps)).toBe(2);
    expect(github.requests).toEqual([]);
  });

  it("a tag run off main ends at once even when CI would never turn green; the same world on main waits (so the order is what ends it)", async () => {
    const pending = () => ({ status: 200, body: { total_count: 0, workflow_runs: [] } }) as FakeAnswer;
    const off = newFakeGithub();
    off.compare = compareAnswer("ahead");
    off.runs = pending;
    const offWorld = gateWorld(off);
    expect(await ciGate({ env: TAG_ENV, timeoutMinutes: 3, pollMs: 60_000 }, offWorld.deps)).toBe(1);
    expect(offWorld.sleeps, "no wait").toEqual([]);
    expect(offWorld.text()).not.toContain("waiting");

    const on = newFakeGithub();
    on.runs = pending;
    const onWorld = gateWorld(on);
    expect(await ciGate({ env: TAG_ENV, timeoutMinutes: 3, pollMs: 60_000 }, onWorld.deps)).toBe(1);
    expect(onWorld.sleeps, "the control waits out the timeout").toEqual([60_000, 60_000, 60_000]);
    expect(onWorld.text()).toContain("waiting: no .github/workflows/ci.yml run");
  });

  it("an off-main tag run with a red CI run on the commit prints the main refusal and never the CI verdict", async () => {
    const github = newFakeGithub();
    github.compare = compareAnswer("ahead");
    github.runs = () => ({ status: 200, body: { workflow_runs: [ciRun({ conclusion: "failure" })] } });
    const world = gateWorld(github);
    expect(await ciGate({ env: TAG_ENV }, world.deps)).toBe(1);
    expect(world.text()).toContain("is not on main");
    expect(world.text()).not.toContain("none succeeded");
    expect(world.runsRead()).toBe(false);
  });

  it("as a real process on a dry run: a commit that is not on main exits 0 with the report line, and CI is still read; a compare 500 on a tag run exits 1", async () => {
    const github = newFakeGithub();
    github.compare = compareAnswer("ahead");
    const server = await startGithubServer(github);
    closers.push(server.close);
    const script = path.join(REPO_ROOT, "scripts", "release.mjs");
    const dry = await runNode([script, "ci-gate"], { ...DRY_ENV, GITHUB_API_URL: server.url });
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stderr).toContain(`ci-gate: commit ${SHA} is not on main (compare: ahead); a tag run stops here`);
    expect(github.requests.some((request) => request.includes("/actions/runs")), "dry run reads CI").toBe(true);

    const broken = newFakeGithub();
    broken.compare = { status: 500, body: { message: "Server Error" } };
    const second = await startGithubServer(broken);
    closers.push(second.close);
    const tag = await runNode([script, "ci-gate"], { ...TAG_ENV, GITHUB_API_URL: second.url });
    expect(tag.status, tag.stderr).toBe(1);
    expect(tag.stderr).toContain("could not be read (HTTP 500)");
    expect(broken.requests.some((request) => request.includes("/actions/runs"))).toBe(false);
  });
});

describe("more real compare bodies (captured 2026-11-20; see the header)", () => {
  const FULL_AHEAD = {
    ahead_by: 37,
    base_commit: { sha: "9a2f515028781a2f5d950bef4ad6f8af86c552a8", parents: [], files: [{ filename: "x", status: "modified" }] },
    behind_by: 0,
    commits: [{ sha: "d".repeat(40), parents: [{ sha: "e".repeat(40) }], commit: { message: "x" } }],
    diff_url: "https://github.com/o/r/compare/main...b.diff",
    files: [{ filename: "a.ts", status: "added" }, { filename: "b.ts", status: "behind" }],
    html_url: "https://github.com/o/r/compare/main...b",
    merge_base_commit: { sha: "9a2f515028781a2f5d950bef4ad6f8af86c552a8" },
    patch_url: "https://github.com/o/r/compare/main...b.patch",
    permalink_url: "https://github.com/o/r/compare/o:9a2f515...o:d",
    status: "ahead",
    total_commits: 37,
    url: "https://api.github.com/repos/o/r/compare/main...b",
  };

  it.each([
    ["the wave-7 branch (merged into main since): behind 1", { status: 200, body: { ahead_by: 0, behind_by: 1, status: "behind", total_commits: 0 } }, "on-main"],
    ["the wave-8 branch (unmerged): ahead 37", { status: 200, body: { ahead_by: 37, behind_by: 0, status: "ahead", total_commits: 37 } }, "off-main"],
    ["main against itself, with the empty commits and files lists", { status: 200, body: { ahead_by: 0, behind_by: 0, commits: [], files: [], status: "identical", total_commits: 0 } }, "on-main"],
    ["a name that is no commit (not-a-sha, abc): the 404 whose own status is the text 404", { status: 404, body: { message: "Not Found", documentation_url: "https://docs.github.com/rest/commits/commits#compare-two-commits", status: "404" } }, "unreadable"],
    ["a full-shape ahead body whose nested files hold a status of their own (`added`, `behind`)", { status: 200, body: FULL_AHEAD }, "off-main"],
  ])("%s is %s", (_label, answer, state) => {
    expect(mainReachability(answer, SHA).state).toBe(state);
  });
});

// -- prepare's check set against the workflow file ---------------------------------------------------------------------

describe("prepare runs the root checks that CI's workflow FILE runs (DW-612; Rule #59: the oracle is .github/workflows/ci.yml, not the constant that builds it)", () => {
  const workflow = readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const rootScripts = (JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;

  /** The `run: pnpm <script>` steps of a workflow text whose script is a root check or validate script, sorted. */
  const rootChecksOf = (text: string): string[] =>
    [...text.matchAll(/^\s+run: pnpm ([^\s]+)\s*$/gm)]
      .map((match) => match[1] as string)
      .filter((name) => ROOT_CHECK_SCRIPT.test(name) && Object.hasOwn(rootScripts, name))
      .sort();

  /** The text of the `gates` job: from its header to the next job. */
  const gatesJob = (text: string): string => {
    const rest = text.slice(text.indexOf("\n  gates:\n") + 1);
    const nextJob = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
    return nextJob < 0 ? rest : rest.slice(0, nextJob + 1);
  };

  it("the gates job's root check steps are exactly the scripts prepare selects from the real root manifest, and no other job carries one", () => {
    const fromGates = rootChecksOf(gatesJob(workflow));
    expect(fromGates.length, "the extractor found the gates job's steps").toBeGreaterThanOrEqual(6);
    expect(releaseCheckScripts(rootScripts)).toEqual(fromGates);
    expect(rootChecksOf(workflow), "a root check outside the gates job would be a check prepare cannot see").toEqual(fromGates);
  });

  it("the comparison can fail: the workflow with one check step removed no longer matches prepare's set", () => {
    const withoutProvenance = workflow.replace("      - name: provenance check\n        run: pnpm check:provenance\n", "");
    expect(withoutProvenance).not.toBe(workflow);
    expect(releaseCheckScripts(rootScripts)).not.toEqual(rootChecksOf(gatesJob(withoutProvenance)));
    expect(rootChecksOf(gatesJob(withoutProvenance))).not.toContain("check:provenance");
  });
});

// -- verify ----------------------------------------------------------------------------------------------------------

describe("verify (AC 42.6.3): the shapes the registry and the machine can answer, and a clean child environment", () => {
  const PROVENANCE = { url: "https://registry.npmjs.org/-/npm/v1/attestations/x", provenance: { predicateType: "https://slsa.dev/provenance/v1" } };
  const PUBLISHED = JSON.stringify({ version: "1.0.0", "dist.attestations": PROVENANCE });

  interface Opened {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
  }

  function newWorld(options: { handshakeFails?: boolean; closeFails?: boolean } = {}) {
    const root = scratch("qa-42-6-verify-");
    const observed = path.join(root, "tmp");
    mkdirSync(observed);
    const standIns = installStandIns(path.join(root, "stand-ins"), ["npm", "git"]);
    standIns.script("npm", [{ match: ["view"], stdout: `${PUBLISHED}\n` }]);
    // The MCP Registry lists every server at the version and the packaging repository holds the tag (Story 42.8), with no network.
    standIns.script("git", [{ match: ["ls-remote"], stdout: `${SHA}\trefs/tags/v1.0.0\n` }]);
    const stores = newFakeStores();
    stores.mcpRegistry = (name, version) => mcpRegistryHit(name, version);
    const lines: string[] = [];
    const opened: Opened[] = [];
    const wireModule = {
      WIRE_ERA: "2025-11-25",
      CLOSED_PORT_ENV: { IRIS_HOST: "127.0.0.1", IRIS_PORT: "1", IRIS_USERNAME: "qa", IRIS_PASSWORD: "qa", IRIS_NAMESPACE: "HSCUSTOM", IRIS_HTTPS: "false" },
      openRawWire: (wireOptions: Opened) => {
        opened.push(wireOptions);
        return { close: async () => { if (options.closeFails) throw new Error("close exploded"); } };
      },
      handshake: async (_wire: unknown, protocol: string) => {
        if (options.handshakeFails) throw new Error("the server exited before it answered");
        return { line: "{}", message: { result: { protocolVersion: protocol, serverInfo: { name: "iris-dev-mcp", version: "1.0.0" } } } };
      },
    };
    const env = (overrides: Record<string, string> = {}): Record<string, string> => ({ PATH: standIns.binDir, STAND_IN_DIR: standIns.dir, ...overrides });
    return {
      root,
      observed,
      standIns,
      lines,
      opened,
      text: () => lines.join("\n"),
      run: (overrides: Record<string, string> = {}, deps: Record<string, unknown> = {}) =>
        withTmpdir(observed, () => verify({ version: "1.0.0", env: env(overrides) }, { ...defaultDeps(), fetch: fakeStoresFetch(stores), log: (line: string) => lines.push(line), loadWire: async () => wireModule, cleanups: createCleanups(), ...deps })),
    };
  }

  it.each([
    ["a version other than the one asked for", JSON.stringify({ version: "1.0.1", "dist.attestations": PROVENANCE }), /the registry answered the version "1\.0\.1", not 1\.0\.0/],
    ["an attestation whose predicate is not SLSA provenance", JSON.stringify({ version: "1.0.0", "dist.attestations": { provenance: { predicateType: "https://example.com/other/v1" } } }), /published without a provenance attestation/],
    ["an answer that is not JSON", "<html>an error page</html>", /npm view answered text that is not JSON/],
  ])("%s is reported for that package alone, exit 1, the seven others ok and the npx start still checked", async (_label, stdout, expected) => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["view", "@iris-mcp/interop@1.0.0"], stdout: `${stdout}\n` }, { match: ["view"], stdout: `${PUBLISHED}\n` }]);
    expect(await world.run()).toBe(1);
    expect(world.text()).toMatch(expected);
    expect(world.text().match(/@iris-mcp\/interop@1\.0\.0: (?!ok)/g)).toHaveLength(1);
    expect(world.text().match(/: ok, published with a provenance attestation/g)).toHaveLength(7);
    expect(world.text()).toContain("npx -y @iris-mcp/dev@1: ok");
    expect(world.standIns.calls("npm").every((call) => call.argv[0] === "view"), "a failing check still publishes, deprecates and logs in nothing").toBe(true);
    expect(world.standIns.calls("git").map((call) => call.argv[0]), "git only reads the packaging tag: no push, tag or commit").toEqual(["ls-remote"]);
    expect(readdirSync(world.observed)).toEqual([]);
  });

  it("a network failure of npm view is `npm view failed`, never `not on the registry` (a fault must not read as an unpublished package)", async () => {
    const world = newWorld();
    world.standIns.script("npm", [{ match: ["view"], status: 1, stderr: "npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/x failed\n" }]);
    expect(await world.run()).toBe(1);
    expect(world.text().match(/npm view failed \(exit 1\)/g)).toHaveLength(8);
    expect(world.text()).not.toContain("not on the registry");
  });

  it("an npm that cannot be started (the runner reports an error and no exit status) fails each package by the error's words", async () => {
    const world = newWorld();
    const run = async () => ({ status: null, stdout: "", stderr: "", error: new Error("spawn npm ENOENT") });
    expect(await world.run({}, { run })).toBe(1);
    expect(world.text().match(/npm view failed \(spawn npm ENOENT\)/g)).toHaveLength(8);
    expect(readdirSync(world.observed)).toEqual([]);
  });

  it("a runner that rejects rejects the verify, with the temporary directory removed and the summary written as exit 1", async () => {
    const world = newWorld();
    const summary = path.join(world.root, "summary.md");
    const run = async () => {
      throw new Error("the runner exploded");
    };
    await expect(world.run({ GITHUB_STEP_SUMMARY: summary }, { run })).rejects.toThrow("the runner exploded");
    expect(readdirSync(world.observed), "the directory is removed on the throwing path").toEqual([]);
    expect(readFileSync(summary, "utf8")).toContain("### verify (exit 1)");
  });

  it("a wire whose close rejects changes no verdict: exit 0 after a pass, exit 1 after a failed start", async () => {
    const passing = newWorld({ closeFails: true });
    expect(await passing.run()).toBe(0);
    const failing = newWorld({ closeFails: true, handshakeFails: true });
    expect(await failing.run()).toBe(1);
    expect(failing.text()).toContain("failed to start and answer initialize (the server exited before it answered)");
    expect(readdirSync(failing.observed)).toEqual([]);
  });

  it("neither child sees a secret: no variable of the secret classes, in any case, and no secret VALUE anywhere in the npm view or npx environment", async () => {
    const world = newWorld();
    const secrets: Record<string, string> = {
      NPM_TOKEN: "SECRET-npm-token",
      GITHUB_TOKEN: "SECRET-github-token",
      IPM_DIST_DEPLOY_KEY: "SECRET-deploy-key",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "SECRET-oidc-token",
      ACTIONS_ID_TOKEN_REQUEST_URL: "SECRET-oidc-url",
      NODE_AUTH_TOKEN: "SECRET-node-auth",
      NPM_CONFIG_USERCONFIG: "SECRET-userconfig",
      Npm_Config_Always_Auth: "SECRET-mixed-case",
      npm_config_registry: "SECRET-registry-override",
      "npm_config_//registry.npmjs.org/:_authToken": "SECRET-scoped-auth",
      IRIS_PASSWORD: "SECRET-iris-password",
      IRIS_USERNAME: "SECRET-iris-user",
      MCP_SERVER_PROFILE: "SECRET-mcp-profile",
    };
    expect(await world.run({ ...secrets, HOME: "/real/home", npm_config_cache: "/real/cache" })).toBe(0);

    const viewEnvs = world.standIns.calls("npm").map((call) => call.env);
    expect(viewEnvs).toHaveLength(NPM_PUBLISH_ORDER.length);
    const npxEnv = world.opened[0]?.env as Record<string, string>;
    for (const [label, env] of [["npm view", viewEnvs[0] as Record<string, string>], ["npx", npxEnv]] as Array<[string, Record<string, string>]>) {
      expect(JSON.stringify(env), `${label}: no secret value`).not.toContain("SECRET-");
      for (const key of Object.keys(env)) {
        expect(key, `${label}: ${key}`).not.toMatch(/^(npm_config_(?!cache$|update_notifier$)|NODE_AUTH_TOKEN$|NPM_TOKEN$|GITHUB_TOKEN$|IPM_DIST_DEPLOY_KEY$|ACTIONS_ID_TOKEN_REQUEST_)/i);
      }
      expect(env["HOME"], `${label}: a clean home`).toMatch(/release-verify-.*\/home$/);
      expect(env["npm_config_cache"], `${label}: a clean cache`).toMatch(/release-verify-.*\/cache$/);
    }
    expect(Object.keys(npxEnv).filter((key) => /^MCP_/i.test(key))).toEqual([]);
    expect(npxEnv["IRIS_PASSWORD"], "the closed-port settings replace any IRIS_ variable").toBe("qa");
    expect(world.text(), "no secret value reaches a log line").not.toContain("SECRET-");
  });
});

// -- the tag consistency check (AC 42.6.2) -----------------------------------------------------------------------------

describe("the tag consistency check at the committed tree (AC 42.6.2: all packages at one version, nothing pending, the embeds in step)", () => {
  const facts = readReleaseFacts(REPO_ROOT);
  const stateOf = (f: { packages: Array<{ name: string; version: string }>; pending: string[] }, tagVersion: string) => ({
    versions: f.packages.map((entry) => ({ name: entry.name, version: entry.version })),
    pending: f.pending,
    tagVersion,
  });

  it("reads all eight packages at one plain version of 1.0.0 or later, and the marker and ipm/module.xml carry it", () => {
    expect(facts.problems).toEqual([]);
    expect(new Set(facts.packages.map((entry: { version: string }) => entry.version)).size).toBe(1);
    expect(facts.packages).toHaveLength(8);
    expect(facts.sharedVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(compareVersions(facts.sharedVersion, "1.0.0"), "the tree never goes back below 1.0.0").toBeGreaterThanOrEqual(0);
    expect(embeddedVersionProblems(facts)).toEqual([]);
  });

  it("a release-mode check at the shared version passes with nothing pending (the tag-time state)", () => {
    expect(versionProblems(stateOf({ ...facts, pending: [] }, facts.sharedVersion), "release")).toEqual([]);
  });

  it.skipIf(facts.pending.length > 0)("with no changeset pending in the tree (the state at a release commit) the real facts pass as read", () => {
    expect(facts.pending).toEqual([]);
    expect(versionProblems(stateOf(facts, facts.sharedVersion), "release")).toEqual([]);
  });

  it.each(NPM_PUBLISH_ORDER as string[])("%s alone at another version, on disk, is exactly one problem naming it, in a release run and in a dry run", (name) => {
    const root = scratch("qa-42-6-tag-");
    makeRepo(root, { version: "1.0.0", versions: { [name]: "0.9.9" } });
    const drifted = readReleaseFacts(root);
    const release = versionProblems(stateOf(drifted, "1.0.0"), "release");
    expect(release).toHaveLength(1);
    expect(release[0]).toContain(`${name} is at 0.9.9, but the tag is v1.0.0`);
    const dry = versionProblems({ ...stateOf(drifted, "1.0.0") }, "dry-run");
    expect(dry).toHaveLength(1);
    expect(dry[0]).toContain("not at one shared version");
    expect(dry[0]).toContain(`${name}@0.9.9`);
  });

  it("a pending changeset on disk, a marker at another semver and a module at another version are each a problem of their own", () => {
    const root = scratch("qa-42-6-tag-");
    makeRepo(root, { version: "1.0.0", pending: ["late.md"], markerSemver: "0.0.2", moduleVersion: "0.9.0" });
    const drifted = readReleaseFacts(root);
    expect(drifted.pending).toEqual(["late.md"]);
    expect(versionProblems(stateOf(drifted, "1.0.0"), "release")).toEqual([expect.stringContaining("1 changeset(s) are still pending in .changeset/ (late.md)")]);
    const embedded = embeddedVersionProblems(drifted);
    expect(embedded).toHaveLength(2);
    expect(embedded[0]).toContain("BOOTSTRAP_VERSION");
    expect(embedded[1]).toContain("ipm/module.xml");
    expect(existsSync(path.join(root, ".changeset", "late.md"))).toBe(true);
  });
});
