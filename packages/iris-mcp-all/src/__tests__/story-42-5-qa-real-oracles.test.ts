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
 *
 * No network, no GitHub, no IRIS, no docker.
 */

import { describe, expect, it } from "vitest";
import { environmentProblems, environmentSummary, environmentWarnings } from "../../../../scripts/lib/release-core.mjs";
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
