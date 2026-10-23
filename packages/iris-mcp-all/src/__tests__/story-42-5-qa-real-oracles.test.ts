/**
 * Story 42.5 (QA; AC 42.5.1, AC 42.5.3, DW-689; project rules #36 and #54) -- the release code against the REAL shapes it reads, not
 * against shapes its own tests invented.
 *
 *  - The `release` environment guard reads two GitHub REST bodies. The fixtures here are bodies that GitHub returned for four public
 *    repositories' environments on 2026-10-22 (`GET /repos/<owner>/<repo>/environments/<name>` and `.../deployment-branch-policies`,
 *    read-only), reduced to the fields a guard can read. Every id, URL and timestamp is dropped and every person or team name is replaced
 *    by a neutral one; no key and no value that decides a verdict is edited. They carry what the hand-written fixtures of
 *    `release-script-fixtures.ts` do not: the `branch_policy` protection rule with `reviewers: null`, a Team reviewer whose `login` is
 *    `null` (not absent), `prevent_self_review: null`, and `deployment_branch_policy: null` for an environment with no restriction.
 *  - The IPM channel's git steps run against a REAL empty bare repository (the state of the packaging repository before its first
 *    release): the read-only and local steps only -- `ls-remote --symref`, `clone`, `checkout -B`, `add --all`, `write-tree` and the
 *    `rev-parse` that finds no tag. Nothing here commits, tags or pushes; the steps that do are covered by the scripted `git`.
 *
 * No network, no GitHub, no IRIS, no docker. Every directory is made under `os.tmpdir()` by the test that needs it and removed after it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { environmentProblems, environmentSummary, environmentWarnings, ipmDefaultBranch, ipmPushPlan } from "../../../../scripts/lib/release-core.mjs";
import { readEnvironmentGuard } from "../../../../scripts/release.mjs";

// -- the environment guard against captured GitHub bodies ---------------------------------------------------------------

/** pypa/pip, environment `PyPI`: a Team reviewer (its `login` is null), no admin bypass, custom rules, one tag rule `*`. */
const PIP_PYPI = {
  name: "PyPI",
  can_admins_bypass: false,
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  protection_rules: [
    { type: "branch_policy", prevent_self_review: null, reviewers: null },
    { type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "Team", reviewer: { login: null, name: "Example Committers", slug: "example-committers", type: "organization" } }] },
  ],
};
const PIP_PYPI_POLICIES = { total_count: 1, branch_policies: [{ name: "*", type: "tag" }] };

/** pypa/build, environment `release`: three User reviewers, "Prevent self-review" on, administrators can bypass, no restriction at all. */
const BUILD_RELEASE = {
  name: "release",
  can_admins_bypass: true,
  deployment_branch_policy: null,
  protection_rules: [
    {
      type: "required_reviewers",
      prevent_self_review: true,
      reviewers: [
        { type: "User", reviewer: { login: "maintainer-one", type: "User" } },
        { type: "User", reviewer: { login: "maintainer-two", type: "User" } },
        { type: "User", reviewer: { login: "maintainer-three", type: "User" } },
      ],
    },
  ],
};

/** psf/requests, environment `publish`: User reviewers, no admin bypass, custom rules, FOUR tag rules. */
const REQUESTS_PUBLISH = {
  name: "publish",
  can_admins_bypass: false,
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  protection_rules: [
    { type: "branch_policy", prevent_self_review: null, reviewers: null },
    { type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: { login: "maintainer-one", type: "User" } }, { type: "User", reviewer: { login: "maintainer-two", type: "User" } }] },
  ],
};
const REQUESTS_PUBLISH_POLICIES = {
  total_count: 4,
  branch_policies: [
    { name: "v[0-9].[0-9].[0-9]", type: "tag" },
    { name: "v[0-9].[1-9][0-9].[0-9]", type: "tag" },
    { name: "v[0-9].[1-9][0-9].[0-9].dev[0-9]", type: "tag" },
    { name: "v[0-9].[1-9][0-9].[0-9]rc[0-9]", type: "tag" },
  ],
};

/** urllib3/urllib3, environment `testpypi`: no reviewer (only the `branch_policy` rule), no admin bypass, two branch rules and one tag rule. */
const URLLIB3_TESTPYPI = {
  name: "testpypi",
  can_admins_bypass: false,
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  protection_rules: [{ type: "branch_policy", prevent_self_review: null, reviewers: null }],
};
const URLLIB3_TESTPYPI_POLICIES = {
  total_count: 3,
  branch_policies: [
    { name: "1.26.x", type: "branch" },
    { name: "main", type: "branch" },
    { name: "*.*.*", type: "tag" },
  ],
};

/** The tag rule `v*` that the release environment must have, in the shape GitHub returns it. */
const ONLY_TAG_RULE = { total_count: 1, branch_policies: [{ name: "v*", type: "tag" }] };

describe("The environment guard reads the bodies GitHub really returns (captured 2026-10-22, read-only GET)", () => {
  it("pypa/pip's PyPI: the Team reviewer counts although its login is null, the branch_policy rule is no reviewer, and the one tag rule `*` is the only problem", () => {
    const problems = environmentProblems(PIP_PYPI, PIP_PYPI_POLICIES);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/the deployment rules of the release environment are tag:\*, not exactly one tag rule v\*/);
    expect(environmentWarnings(PIP_PYPI)).toEqual([]);
  });

  it("the same environment with its tag rule `v*` is protected, and its summary names the team by slug", () => {
    expect(environmentProblems(PIP_PYPI, ONLY_TAG_RULE)).toEqual([]);
    expect(environmentSummary(PIP_PYPI, ONLY_TAG_RULE)).toBe("protected (required reviewers: example-committers; admin bypass off; tags v*)");
  });

  it("pypa/build's release: administrator bypass and no restriction at all (a null policy) are two problems, and Prevent self-review is a warning", () => {
    const problems = environmentProblems(BUILD_RELEASE, undefined);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/administrators can bypass/);
    expect(problems.join("\n")).toMatch(/are not restricted to selected rules, not exactly one tag rule v\*/);
    expect(environmentWarnings(BUILD_RELEASE)).toHaveLength(1);
    expect(environmentWarnings(BUILD_RELEASE)[0]).toMatch(/prevents self-review/);
  });

  it("psf/requests' publish: four tag rules are not one tag rule `v*`, and every one of them is named", () => {
    const problems = environmentProblems(REQUESTS_PUBLISH, REQUESTS_PUBLISH_POLICIES);
    expect(problems).toHaveLength(1);
    for (const name of REQUESTS_PUBLISH_POLICIES.branch_policies.map((policy) => policy.name)) expect(problems[0]).toContain(`tag:${name}`);
  });

  it("urllib3's testpypi: an environment with only a branch_policy rule has no reviewer, and a branch rule among the tag rules is a second problem", () => {
    const problems = environmentProblems(URLLIB3_TESTPYPI, URLLIB3_TESTPYPI_POLICIES);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/has no required reviewer/);
    expect(problems.join("\n")).toMatch(/branch:1\.26\.x, branch:main, tag:\*\.\*\.\*/);
  });

  /** The two reads the script makes, from a `fetch` that serves the captured bodies and keeps the paths it was asked for. */
  function serve(environment: unknown, policies: unknown): { deps: { fetch: typeof fetch }; paths: string[] } {
    const paths: string[] = [];
    const answer = async (input: unknown): Promise<Response> => {
      const pathname = new URL(String(input)).pathname;
      paths.push(pathname);
      return new Response(JSON.stringify(pathname.endsWith("/deployment-branch-policies") ? policies : environment), { status: 200 });
    };
    return { deps: { fetch: answer as unknown as typeof fetch }, paths };
  }
  const ENV = { GITHUB_TOKEN: "token-for-the-test", GITHUB_REPOSITORY: "o/r" };

  it("readEnvironmentGuard asks for the deployment rules only when the environment has custom rules, and judges the captured bodies", async () => {
    const custom = serve(PIP_PYPI, ONLY_TAG_RULE);
    const protectedGuard = await readEnvironmentGuard(custom.deps as never, ENV);
    expect(protectedGuard.state).toBe("protected");
    expect(protectedGuard.line).toBe("environment release: protected (required reviewers: example-committers; admin bypass off; tags v*)");
    expect(custom.paths).toEqual(["/repos/o/r/environments/release", "/repos/o/r/environments/release/deployment-branch-policies"]);

    const open = serve(BUILD_RELEASE, { total_count: 0, branch_policies: [] });
    const unprotected = await readEnvironmentGuard(open.deps as never, ENV);
    expect(unprotected.state).toBe("unprotected");
    expect(unprotected.problems).toHaveLength(2);
    expect(unprotected.warnings).toHaveLength(1);
    expect(open.paths, "a null deployment_branch_policy has no rules to read").toEqual(["/repos/o/r/environments/release"]);

    const wrongRule = serve(PIP_PYPI, PIP_PYPI_POLICIES);
    expect((await readEnvironmentGuard(wrongRule.deps as never, ENV)).state).toBe("unprotected");
  });
});

// -- the IPM channel's git steps against a real empty repository ---------------------------------------------------------

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The environment of every git call here: no user or system configuration, and no prompt. */
const GIT_ENV: Record<string, string> = { ...(process.env as Record<string, string>), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0" };

function git(args: readonly string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("git", [...args], { cwd, env: GIT_ENV, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("The IPM channel's git steps against a real empty bare repository (DW-689; project rule #54; no commit, no tag, no push)", () => {
  /** A bare repository whose HEAD names `branch`, empty like the packaging repository before its first release; and the plan aimed at it. */
  function emptyRemote(branch = "master") {
    const root = mkdtempSync(path.join(tmpdir(), "release-real-git-"));
    roots.push(root);
    const bare = path.join(root, "remote.git");
    expect(git(["init", "--bare", "--quiet", `--initial-branch=${branch}`, bare], root).status, "git init --bare").toBe(0);
    const clone = path.join(root, "clone");
    return { root, bare, clone, plan: ipmPushPlan(path.join(root, "tree"), "1.0.0", "c".repeat(40), { url: bare, clone }) };
  }

  it("git is there (a missing git must fail here, not skip)", () => {
    expect(git(["--version"], tmpdir()).stdout).toMatch(/^git version \d+\.\d+/);
  });

  it("the dry step's `ls-remote --symref <url> HEAD` exits 0 with no output on an empty repository, whichever branch its HEAD names, which is `ready`", () => {
    for (const branch of ["master", "main"]) {
      const { root, plan } = emptyRemote(branch);
      const listed = git(plan.lsRemoteArgv, root);
      expect({ status: listed.status, stdout: listed.stdout }, `HEAD names ${branch}`).toEqual({ status: 0, stdout: "" });
      expect(ipmDefaultBranch(listed.stdout)).toBeUndefined();
    }
  });

  it("the same step on a path that is not a repository exits non-zero, which is `absent or not readable`", () => {
    const { root, plan } = emptyRemote();
    const missing = ipmPushPlan(plan.tree, "1.0.0", "c".repeat(40), { url: path.join(root, "no-such-repository.git"), clone: plan.clone });
    const listed = git(missing.lsRemoteArgv, root);
    expect(listed.status).not.toBe(0);
    expect(listed.status).not.toBeNull();
    expect(listed.stdout).toBe("");
  });

  it("clone, `checkout --quiet -B master` on the unborn branch, `add --all` and `write-tree` all succeed, and the tag's tree is absent: `rev-parse --verify --quiet` exits 1 with no output", () => {
    for (const branch of ["master", "main"]) {
      const { root, bare, clone, plan } = emptyRemote(branch);
      expect(git(plan.cloneArgv, root).status, `clone of an empty repository whose HEAD names ${branch}`).toBe(0);
      expect(git(plan.checkoutArgv, clone).status, "checkout -B master").toBe(0);
      expect(git(["symbolic-ref", "HEAD"], clone).stdout.trim(), "the working copy is on master whatever the remote's HEAD names").toBe("refs/heads/master");
      mkdirSync(path.join(clone, "src"), { recursive: true });
      writeFileSync(path.join(clone, "module.xml"), "<Export/>\n");
      writeFileSync(path.join(clone, "src", "a.cls"), "Class A {}\n");
      expect(git(plan.addArgv, clone).status, "add --all").toBe(0);
      const tree = git(plan.writeTreeArgv, clone);
      expect(tree.status, "write-tree").toBe(0);
      expect(tree.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
      const tag = git(plan.tagTreeArgv, clone);
      expect({ status: tag.status, stdout: tag.stdout }, "no tag yet").toEqual({ status: 1, stdout: "" });
      expect(git(["for-each-ref", "refs/"], bare).stdout, "nothing reached the remote").toBe("");
    }
  });
});
