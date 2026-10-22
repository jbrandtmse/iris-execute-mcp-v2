/**
 * Story 42.5 (AC 42.5.1 to 42.5.4, DW-689; AD-29, AD-14) -- every pure function of `scripts/lib/release-core.mjs` against each row of
 * the story's I/O matrix: the mode, the CI gate decision, the environment guard, the version state, the tarball check, the argv and text
 * builders, and the publish refusals. Nothing here runs a process or touches the network, so a row that the scripts' own tests cover
 * through stand-ins is also pinned here at its source.
 */

import { describe, expect, it } from "vitest";
import {
  CI_WORKFLOW_PATH,
  IPM_DIST_BRANCH,
  IPM_DIST_REPOSITORY,
  MIN_NPM_VERSION,
  NPM_PUBLISH_ORDER,
  RELEASE_CHANNELS,
  RELEASE_CHECK_EXEMPTIONS,
  RELEASE_ENVIRONMENT,
  RELEASE_TAG_PATTERN,
  STATUS,
  ciGateDecision,
  compareVersions,
  describeRuns,
  environmentProblems,
  environmentSummary,
  environmentWarnings,
  ipmDefaultBranch,
  ipmPushPlan,
  ipmReadme,
  ipmRegistryListsVersion,
  npmPublishArgv,
  npmUserconfig,
  npmVersionProblems,
  npmViewArgv,
  ovsxArgv,
  publishRefusals,
  releaseMode,
  releaseReport,
  skippedText,
  tarballProblems,
  versionProblems,
  vsceArgv,
} from "../../../../scripts/lib/release-core.mjs";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

describe("the constants", () => {
  it("name the order, the channels, the environment and the packaging repository the story fixes", () => {
    expect([...NPM_PUBLISH_ORDER]).toEqual(["@iris-mcp/client-config", "@iris-mcp/shared", "@iris-mcp/admin", "@iris-mcp/data", "@iris-mcp/dev", "@iris-mcp/interop", "@iris-mcp/ops", "@iris-mcp/all"]);
    expect(RELEASE_CHANNELS).toEqual([
      { id: "npm", enabled: true },
      { id: "vscode-marketplace", enabled: false, enabledBy: "Story 42.7" },
      { id: "open-vsx", enabled: false, enabledBy: "Story 42.7" },
      { id: "ipm", enabled: false, enabledBy: "Story 42.8" },
    ]);
    expect([RELEASE_ENVIRONMENT, RELEASE_TAG_PATTERN, IPM_DIST_REPOSITORY, IPM_DIST_BRANCH, MIN_NPM_VERSION, CI_WORKFLOW_PATH]).toEqual([
      "release",
      "v*",
      "jbrandtmse/iris-execute-mcp-v2-ipm",
      "master",
      "11.5.1",
      ".github/workflows/ci.yml",
    ]);
    expect(Object.keys(RELEASE_CHECK_EXEMPTIONS)).toEqual(["format:check"]);
    expect(RELEASE_CHECK_EXEMPTIONS["format:check"]).toContain("not a CI gate");
  });
});

describe("Mode: a release only for a push of refs/tags/v<x.y.z>", () => {
  const push = (ref: string, event = "push"): Record<string, string> => ({ GITHUB_EVENT_NAME: event, GITHUB_REF: ref, GITHUB_SHA: SHA });

  it("a push of a version tag is a release of that version, with the tag, ref and sha recorded", () => {
    expect(releaseMode(push("refs/tags/v1.0.0"))).toEqual({ mode: "release", version: "1.0.0", tag: "v1.0.0", ref: "refs/tags/v1.0.0", sha: SHA, event: "push" });
    expect(releaseMode(push("refs/tags/v0.0.2")).version).toBe("0.0.2");
    expect(releaseMode(push("refs/tags/v10.20.30")).version).toBe("10.20.30");
  });

  it("a push to a branch, a dispatch and a dispatch on a tag ref are dry runs", () => {
    expect(releaseMode(push("refs/heads/release-dry-run/42-5"))).toEqual({ mode: "dry-run", ref: "refs/heads/release-dry-run/42-5", sha: SHA, event: "push" });
    expect(releaseMode(push("refs/heads/main", "workflow_dispatch")).mode).toBe("dry-run");
    expect(releaseMode(push("refs/tags/v1.0.0", "workflow_dispatch")).mode, "a dispatch on a tag ref matches the environment's tag rule, so it must not publish").toBe("dry-run");
  });

  it("a v tag that is not v<MAJOR.MINOR.PATCH> is a dry run that names the malformed tag", () => {
    for (const tag of ["v1.0.0-rc.1", "v1.0", "v1.0.0.0", "v01", "vfoo", "v1.0.0+build"]) {
      const info = releaseMode(push(`refs/tags/${tag}`));
      expect(info.mode, tag).toBe("dry-run");
      expect(info.malformedTag, tag).toBe(tag);
    }
    expect(releaseMode(push("refs/tags/nightly")).malformedTag).toBeUndefined();
  });

  it("missing variables are a dry run with empty text, never a throw", () => {
    expect(releaseMode({})).toEqual({ mode: "dry-run", ref: "", sha: "", event: "" });
  });
});

describe("CI gate: pass, pending, red", () => {
  const run = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 1,
    html_url: "https://github.com/o/r/actions/runs/1",
    head_sha: SHA,
    event: "push",
    path: ".github/workflows/ci.yml",
    status: "completed",
    conclusion: "success",
    ...overrides,
  });

  it("a completed success run of ci.yml on the sha passes at once, and names the run", () => {
    const decision = ciGateDecision([run()], SHA);
    expect(decision.decision).toBe("pass");
    expect((decision as { run: { html_url: string } }).run.html_url).toBe("https://github.com/o/r/actions/runs/1");
  });

  it("passes when any run succeeded, even next to a failed one or one still going", () => {
    expect(ciGateDecision([run({ id: 2, conclusion: "failure" }), run({ id: 3 }), run({ id: 4, status: "in_progress", conclusion: null })], SHA).decision).toBe("pass");
  });

  it("no run yet, and runs that are still going, are pending", () => {
    expect(ciGateDecision([], SHA).decision).toBe("pending");
    expect(ciGateDecision([run({ status: "queued", conclusion: null })], SHA).decision).toBe("pending");
    expect(ciGateDecision([run({ status: "in_progress", conclusion: null })], SHA).decision).toBe("pending");
    expect(ciGateDecision([run({ status: "waiting", conclusion: null })], SHA).decision).toBe("pending");
  });

  it("a failed run next to one still going is pending: the second may pass", () => {
    expect(ciGateDecision([run({ id: 2, conclusion: "failure" }), run({ id: 3, status: "in_progress", conclusion: null })], SHA).decision).toBe("pending");
  });

  it("every run completed and none succeeded is red, with each run", () => {
    const decision = ciGateDecision([run({ id: 2, conclusion: "failure" }), run({ id: 3, conclusion: "cancelled" }), run({ id: 4, conclusion: "timed_out" })], SHA);
    expect(decision.decision).toBe("red");
    expect((decision as { runs: unknown[] }).runs).toHaveLength(3);
  });

  it("a conclusion other than success never passes (failure, cancelled, skipped, neutral, timed_out, action_required, startup_failure, stale, null)", () => {
    for (const conclusion of ["failure", "cancelled", "skipped", "neutral", "timed_out", "action_required", "startup_failure", "stale", null]) {
      expect(ciGateDecision([run({ conclusion })], SHA).decision, String(conclusion)).not.toBe("pass");
    }
  });

  it("a success on another sha, or of another workflow, does not count", () => {
    expect(ciGateDecision([run({ head_sha: OTHER })], SHA).decision).toBe("pending");
    expect(ciGateDecision([run({ path: ".github/workflows/release.yml" })], SHA).decision).toBe("pending");
    expect(ciGateDecision([run({ path: ".github/workflows/ci.yml.bak" })], SHA).decision).toBe("pending");
    expect(ciGateDecision([run({ head_sha: OTHER }), run({ id: 2, conclusion: "failure" })], SHA).decision).toBe("red");
  });

  it("a run whose path carries a ref after an @ is a ci.yml run", () => {
    expect(ciGateDecision([run({ path: ".github/workflows/ci.yml@refs/pull/7/merge" })], SHA).decision).toBe("pass");
  });

  it("a push and a workflow_dispatch run count; a run of any other event never does", () => {
    expect(ciGateDecision([run({ event: "push" })], SHA).decision).toBe("pass");
    expect(ciGateDecision([run({ event: "workflow_dispatch" })], SHA).decision).toBe("pass");
    for (const event of ["pull_request", "pull_request_target", "schedule", "workflow_run", "merge_group", undefined]) {
      expect(ciGateDecision([run({ event })], SHA).decision, String(event)).toBe("pending");
    }
  });

  it("a green pull_request run on the sha (it built the merge ref) is pending alone, and red next to a failed push run", () => {
    const pullRequest = run({ id: 9, event: "pull_request", path: ".github/workflows/ci.yml@refs/pull/7/merge" });
    expect(ciGateDecision([pullRequest], SHA).decision).toBe("pending");
    const failedPush = run({ id: 2, event: "push", conclusion: "failure" });
    const decision = ciGateDecision([pullRequest, failedPush], SHA);
    expect(decision.decision).toBe("red");
    expect("runs" in decision ? decision.runs.map((entry) => entry["id"]) : [], "the pull-request run is not listed as a run of the commit").toEqual([2]);
    expect(ciGateDecision([failedPush, pullRequest], SHA).decision, "in either order").toBe("red");
  });

  it("describes each run by its URL and its conclusion, or its status while it goes", () => {
    expect(describeRuns([run({ conclusion: "failure" }), run({ id: 2, html_url: "https://x/2", status: "in_progress", conclusion: null })])).toEqual([
      "https://github.com/o/r/actions/runs/1: failure",
      "https://x/2: in_progress",
    ]);
  });
});

describe("Environment guard: protected means a reviewer, no admin bypass, exactly one tag rule v*", () => {
  const environment = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: "release",
    can_admins_bypass: false,
    protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: { login: "jbrandtmse" } }] }],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    ...overrides,
  });
  const tagRule = { branch_policies: [{ id: 1, name: "v*", type: "tag" }] };

  it("the protected environment has no problem, and its summary names the reviewer, the bypass and the tag rule", () => {
    expect(environmentProblems(environment(), tagRule)).toEqual([]);
    expect(environmentSummary(environment(), tagRule)).toBe("protected (required reviewers: jbrandtmse; admin bypass off; tags v*)");
  });

  it("an environment with no required reviewer, with other protection rules only, is unprotected", () => {
    expect(environmentProblems(environment({ protection_rules: [] }), tagRule).join("\n")).toMatch(/no required reviewer/);
    expect(environmentProblems(environment({ protection_rules: [{ type: "wait_timer", wait_timer: 5 }] }), tagRule).join("\n")).toMatch(/no required reviewer/);
    expect(environmentProblems(environment({ protection_rules: [{ type: "required_reviewers", reviewers: [] }] }), tagRule).join("\n")).toMatch(/no required reviewer/);
  });

  it("a team reviewer counts, by its slug", () => {
    const team = environment({ protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "Team", reviewer: { slug: "maintainers" } }] }] });
    expect(environmentProblems(team, tagRule)).toEqual([]);
    expect(environmentSummary(team, tagRule)).toContain("required reviewers: maintainers");
  });

  it("an environment that administrators can bypass is unprotected, and so is one that does not say", () => {
    expect(environmentProblems(environment({ can_admins_bypass: true }), tagRule).join("\n")).toMatch(/administrators can bypass/);
    expect(environmentProblems(environment({ can_admins_bypass: undefined }), tagRule).join("\n")).toMatch(/administrators can bypass/);
  });

  it("deployment rules that are not exactly one tag rule v* are a problem: none, a branch rule, two rules, another pattern", () => {
    const notExact = /not exactly one tag rule v\*/;
    expect(environmentProblems(environment({ deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }), { branch_policies: [] }).join("\n")).toMatch(notExact);
    expect(environmentProblems(environment({ deployment_branch_policy: null }), undefined).join("\n")).toMatch(notExact);
    expect(environmentProblems(environment(), { branch_policies: [] }).join("\n")).toMatch(notExact);
    expect(environmentProblems(environment(), { branch_policies: [{ name: "v*", type: "branch" }] }).join("\n")).toMatch(notExact);
    expect(environmentProblems(environment(), { branch_policies: [{ name: "v*", type: "tag" }, { name: "main", type: "branch" }] }).join("\n")).toMatch(notExact);
    expect(environmentProblems(environment(), { branch_policies: [{ name: "*", type: "tag" }] }).join("\n")).toMatch(notExact);
    expect(environmentProblems(environment(), { branch_policies: [{ name: "v*", type: "tag" }, { name: "v*", type: "tag" }] }).join("\n")).toMatch(notExact);
  });

  it("reports every problem at once", () => {
    expect(environmentProblems(environment({ protection_rules: [], can_admins_bypass: true }), { branch_policies: [] })).toHaveLength(3);
  });

  it("prevent_self_review is a warning and not a problem", () => {
    const strict = environment({ protection_rules: [{ type: "required_reviewers", prevent_self_review: true, reviewers: [{ type: "User", reviewer: { login: "jbrandtmse" } }] }] });
    expect(environmentProblems(strict, tagRule)).toEqual([]);
    expect(environmentWarnings(strict).join("\n")).toMatch(/prevents self-review.*Turn off "Prevent self-review"/);
    expect(environmentWarnings(environment())).toEqual([]);
  });
});

describe("Version state: tag run needs the tag's version, a dry run one shared version", () => {
  const at = (version: string, names = NPM_PUBLISH_ORDER): Array<{ name: string; version: string }> => names.map((name: string) => ({ name, version }));

  it("a tag run with every package at the tag's version and no pending changeset has no problem", () => {
    expect(versionProblems({ versions: at("1.0.0"), pending: [], tagVersion: "1.0.0" }, "release")).toEqual([]);
  });

  it("a tag run lists every package that is not at the tag's version, and every pending changeset (today's repository: client-config at 0.0.1)", () => {
    const versions = [...at("0.0.2")];
    versions[0] = { name: "@iris-mcp/client-config", version: "0.0.1" };
    const problems = versionProblems({ versions, pending: ["a.md", "b.md"], tagVersion: "0.0.2" }, "release");
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/@iris-mcp\/client-config is at 0\.0\.1, but the tag is v0\.0\.2\. Run pnpm run version/);
    expect(problems[1]).toMatch(/2 changeset\(s\) are still pending in \.changeset\/ \(a\.md, b\.md\)\. Run pnpm run version/);
  });

  it("a tag run names a package at another version, one by one", () => {
    expect(versionProblems({ versions: at("1.0.1"), pending: [], tagVersion: "1.0.0" }, "release")).toHaveLength(NPM_PUBLISH_ORDER.length);
  });

  it("a prerelease or build version is refused, in both modes", () => {
    for (const mode of ["release", "dry-run"] as const) {
      const problems = versionProblems({ versions: at("1.0.0-beta.1"), pending: [], tagVersion: "1.0.0-beta.1" }, mode);
      expect(problems.some((problem) => /not a plain MAJOR\.MINOR\.PATCH version/.test(problem)), mode).toBe(true);
    }
    expect(versionProblems({ versions: at("1.0.0+5"), pending: [] }, "dry-run").length).toBeGreaterThan(0);
  });

  it("a tag run without a usable tag version has a problem", () => {
    expect(versionProblems({ versions: at("1.0.0"), pending: [] }, "release").join("\n")).toMatch(/tag version undefined is not MAJOR\.MINOR\.PATCH/);
  });

  it("a dry run needs one shared version and no pending changeset", () => {
    expect(versionProblems({ versions: at("0.0.2"), pending: [] }, "dry-run")).toEqual([]);
    const mixed = [...at("0.0.2")];
    mixed[0] = { name: "@iris-mcp/client-config", version: "0.0.1" };
    expect(versionProblems({ versions: mixed, pending: ["x.md"] }, "dry-run")).toHaveLength(2);
    expect(versionProblems({ versions: mixed, pending: [] }, "dry-run")[0]).toMatch(/not at one shared version/);
  });

  it("an empty package list is a problem, not a pass", () => {
    expect(versionProblems({ versions: [], pending: [] }, "dry-run").join("\n")).toMatch(/no @iris-mcp package was found/);
  });

  it("compareVersions orders MAJOR.MINOR.PATCH numerically", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.0.2", "1.0.0")).toBe(-1);
    expect(compareVersions("11.5.0", "11.5.1")).toBe(-1);
    expect(compareVersions("11.12.1", "11.5.1")).toBe(1);
    expect(compareVersions("10.0.0", "9.99.99")).toBe(1);
    expect(Number.isNaN(compareVersions("x", "1.0.0"))).toBe(true);
  });

  it("npm must be at least 11.5.1", () => {
    expect(npmVersionProblems("11.5.1\n")).toEqual([]);
    expect(npmVersionProblems("11.12.1")).toEqual([]);
    expect(npmVersionProblems("12.0.0")).toEqual([]);
    expect(npmVersionProblems("11.5.0")[0]).toMatch(/older than 11\.5\.1.*Run the release on Node 26\.0\.0/);
    expect(npmVersionProblems("10.9.2")).toHaveLength(1);
    expect(npmVersionProblems("")[0]).toMatch(/not a version number/);
    expect(npmVersionProblems("garbage")[0]).toMatch(/not a version number/);
  });
});

describe("Tarball check: version, no workspace:, exports of the source", () => {
  const source = { name: "@iris-mcp/shared", version: "0.0.2", publishConfig: { exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }, exports: { ".": { types: "./src/x.ts" }, "./test-helpers": "./src/y.ts" } };
  const packed = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: "@iris-mcp/shared",
    version: "1.0.0",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    dependencies: { zod: "^4.3.6" },
    ...overrides,
  });

  it("a tarball at the release version with the publishConfig exports and no workspace: specifier has no problem", () => {
    expect(tarballProblems(packed(), source, "1.0.0")).toEqual([]);
  });

  it("a tarball at another version is a problem that names the package", () => {
    expect(tarballProblems(packed({ version: "0.0.2" }), source, "1.0.0")[0]).toMatch(/@iris-mcp\/shared: the tarball is at version "0\.0\.2", not 1\.0\.0/);
  });

  it("a tarball that still holds workspace: is a problem in every dependency field", () => {
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const problems = tarballProblems(packed({ [field]: { "@iris-mcp/shared": "workspace:*" } }), source, "1.0.0");
      expect(problems.join("\n"), field).toMatch(new RegExp(`@iris-mcp/shared: the tarball still holds @iris-mcp/shared@workspace:\\* in ${field}`));
    }
  });

  it("an internal dependency that is not at the release version is a problem", () => {
    expect(tarballProblems(packed({ dependencies: { "@iris-mcp/shared": "0.0.2" } }), source, "1.0.0")[0]).toMatch(/depends on @iris-mcp\/shared@0\.0\.2, not 1\.0\.0/);
    expect(tarballProblems(packed({ dependencies: { "@iris-mcp/shared": "1.0.0" } }), source, "1.0.0")).toEqual([]);
  });

  it("a dry run packs each package at its own version: an internal dependency is held to the version in dependencyVersions", () => {
    const old = packed({ version: "0.0.1", dependencies: { "@iris-mcp/shared": "0.0.2" } });
    expect(tarballProblems(old, source, "0.0.1")[0]).toMatch(/depends on @iris-mcp\/shared@0\.0\.2, not 0\.0\.1/);
    expect(tarballProblems(old, source, "0.0.1", { "@iris-mcp/shared": "0.0.2" })).toEqual([]);
    expect(tarballProblems(old, source, "0.0.1", { "@iris-mcp/shared": "0.0.3" })[0]).toMatch(/depends on @iris-mcp\/shared@0\.0\.2, not 0\.0\.3/);
  });

  it("exports outside the source's publishConfig.exports are a problem: the source's own exports, none, or others", () => {
    expect(tarballProblems(packed({ exports: source.exports }), source, "1.0.0")[0]).toMatch(/exports are .*not the source's publishConfig\.exports/);
    expect(tarballProblems(packed({ exports: undefined }), source, "1.0.0")).toHaveLength(1);
    expect(tarballProblems(packed({ exports: { ".": "./other.js" } }), source, "1.0.0")).toHaveLength(1);
  });

  it("a package with no publishConfig is held to its own exports, and a package with none to none", () => {
    const own = { name: "@iris-mcp/client-config", exports: { ".": "./dist/index.js" } };
    expect(tarballProblems({ name: own.name, version: "1.0.0", exports: own.exports }, own, "1.0.0")).toEqual([]);
    expect(tarballProblems({ name: own.name, version: "1.0.0", exports: { ".": "./src/index.ts" } }, own, "1.0.0")).toHaveLength(1);
    const bare = { name: "@iris-mcp/dev" };
    expect(tarballProblems({ name: bare.name, version: "1.0.0" }, bare, "1.0.0")).toEqual([]);
    expect(tarballProblems({ name: bare.name, version: "1.0.0", exports: { ".": "./x.js" } }, bare, "1.0.0")).toHaveLength(1);
  });

  it("reports every problem of a tarball at once", () => {
    expect(tarballProblems(packed({ version: "0.0.2", exports: undefined, dependencies: { "@iris-mcp/x": "workspace:*" } }), source, "1.0.0")).toHaveLength(3);
  });
});

describe("The argv builders", () => {
  it("npmPublishArgv is publish <tgz> --access public --provenance --ignore-scripts, in that order", () => {
    expect(npmPublishArgv("/a/b.tgz")).toEqual(["publish", "/a/b.tgz", "--access", "public", "--provenance", "--ignore-scripts"]);
  });

  it("--dry-run and --userconfig come after the fixed flags", () => {
    expect(npmPublishArgv("/a/b.tgz", { dryRun: true })).toEqual(["publish", "/a/b.tgz", "--access", "public", "--provenance", "--ignore-scripts", "--dry-run"]);
    expect(npmPublishArgv("/a/b.tgz", { userconfig: "/t/npmrc" })).toEqual(["publish", "/a/b.tgz", "--access", "public", "--provenance", "--ignore-scripts", "--userconfig", "/t/npmrc"]);
    expect(npmPublishArgv("/a/b.tgz", { dryRun: false })).not.toContain("--dry-run");
  });

  it("npmViewArgv asks for the version of name@version", () => {
    expect(npmViewArgv("@iris-mcp/shared", "1.0.0")).toEqual(["view", "@iris-mcp/shared@1.0.0", "version"]);
  });

  it("the extension stores take a prebuilt vsix and tolerate a duplicate version", () => {
    expect(vsceArgv("/x/a.vsix")).toEqual(["publish", "--packagePath", "/x/a.vsix", "--skip-duplicate"]);
    expect(ovsxArgv("/x/a.vsix")).toEqual(["publish", "/x/a.vsix", "--skip-duplicate"]);
  });

  it("the userconfig holds the token on one auth line, and refuses a token that could add a line", () => {
    expect(npmUserconfig("npm_abc123")).toBe("//registry.npmjs.org/:_authToken=npm_abc123\n");
    expect(() => npmUserconfig("a\nregistry=https://evil.example/")).toThrow(/NPM_TOKEN holds whitespace or a control character/);
    expect(() => npmUserconfig("a b")).toThrow(/Set it to the token alone/);
    expect(() => npmUserconfig("")).toThrow(/NPM_TOKEN/);
    expect(() => npmUserconfig("tok\u0000en")).toThrow(/control character/);
  });

  it("ipmPushPlan clones, replaces the tree, commits as iris-execute-mcp-v2 <v> from <sha>, tags v<v>, and pushes master and the tag with no force", () => {
    const plan = ipmPushPlan("/tree", "1.0.0", SHA, { url: "git@github.com:jbrandtmse/iris-execute-mcp-v2-ipm.git", clone: "/work/repository" });
    expect(plan.message).toBe(`iris-execute-mcp-v2 1.0.0 from ${SHA}`);
    expect(plan.tag).toBe("v1.0.0");
    expect(plan.cloneArgv).toEqual(["clone", "--quiet", "git@github.com:jbrandtmse/iris-execute-mcp-v2-ipm.git", "/work/repository"]);
    expect(plan.commitArgv.slice(-4)).toEqual(["commit", "--quiet", "-m", plan.message]);
    expect(plan.tagArgv.slice(-5)).toEqual(["tag", "-a", "v1.0.0", "-m", plan.message]);
    expect(plan.pushArgv).toEqual(["push", "--atomic", "origin", "HEAD:refs/heads/master", "refs/tags/v1.0.0"]);
    expect(plan.tagTreeArgv).toEqual(["rev-parse", "--verify", "--quiet", "refs/tags/v1.0.0^{tree}"]);
    const everything = JSON.stringify(plan);
    expect(everything).not.toMatch(/--force|"-f"|--force-with-lease|"\+refs|:\+/);
    expect(plan.lsRemoteArgv).toEqual(["ls-remote", "--symref", "git@github.com:jbrandtmse/iris-execute-mcp-v2-ipm.git", "HEAD"]);
  });

  it("the push is atomic: the branch and the tag land together or not at all", () => {
    const plan = ipmPushPlan("/tree", "1.0.0", SHA, { url: "u", clone: "/c" });
    expect(plan.pushArgv.slice(0, 2)).toEqual(["push", "--atomic"]);
  });

  it("the ls-remote asks for HEAD with its symref, not for a branch that an empty repository lacks (--exit-code on it exits 2)", () => {
    const plan = ipmPushPlan("/tree", "1.0.0", SHA, { url: "u", clone: "/c" });
    expect(plan.lsRemoteArgv).toEqual(["ls-remote", "--symref", "u", "HEAD"]);
    expect(plan.lsRemoteArgv).not.toContain("--exit-code");
    expect(plan.lsRemoteArgv).not.toContain("refs/heads/master");
  });

  it("ipmDefaultBranch reads the default branch from the symref line of ls-remote, and nothing from an empty answer", () => {
    const sha = "c9a020973ccc910f035ff6e2a9462eada67a870a";
    expect(ipmDefaultBranch(`ref: refs/heads/master\tHEAD\n${sha}\tHEAD\n`)).toBe("master");
    expect(ipmDefaultBranch(`ref: refs/heads/main\tHEAD\n${sha}\tHEAD\n`)).toBe("main");
    expect(ipmDefaultBranch(`ref: refs/heads/release/v1\tHEAD\n${sha}\tHEAD\n`)).toBe("release/v1");
    expect(ipmDefaultBranch("")).toBeUndefined();
    expect(ipmDefaultBranch(`${sha}\tHEAD\n`)).toBeUndefined();
  });

  it("ipmReadme names the version and the source, and implies no endorsement (AD-28)", () => {
    const readme = ipmReadme("1.0.0");
    expect(readme).toContain("Version 1.0.0");
    expect(readme).toContain("https://github.com/jbrandtmse/iris-execute-mcp-v2");
    expect(readme).toContain('zpm "install iris-execute-mcp-v2"');
    expect(readme).toMatch(/independent community project/);
    expect(readme).toMatch(/not made, endorsed or supported by InterSystems/);
    expect(readme).not.toMatch(/official|certified/i);
  });

  it("ipmRegistryListsVersion reads the registry's answer: the newest version or the versions list", () => {
    expect(ipmRegistryListsVersion({ name: "x", version: "0.0.5", versions: ["0.0.1", "0.0.5"] }, "0.0.5")).toBe(true);
    expect(ipmRegistryListsVersion({ name: "x", version: "0.0.5", versions: ["0.0.1", "0.0.5"] }, "0.0.1")).toBe(true);
    expect(ipmRegistryListsVersion({ name: "x", version: "0.0.5", versions: ["0.0.1", "0.0.5"] }, "1.0.0")).toBe(false);
    expect(ipmRegistryListsVersion({ version: "1.0.0" }, "1.0.0")).toBe(true);
    expect(ipmRegistryListsVersion(null, "1.0.0")).toBe(false);
    expect(ipmRegistryListsVersion("text", "1.0.0")).toBe(false);
    expect(ipmRegistryListsVersion({}, "1.0.0")).toBe(false);
  });
});

describe("Publish refusals: a real run only for a push of the tag, on the prepared sha, from a release manifest", () => {
  const manifest = { version: "1.0.0", sha: SHA, mode: "release" };
  const env = (overrides: Record<string, string> = {}): Record<string, string> => ({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.0.0", GITHUB_SHA: SHA, ...overrides });

  it("the push of refs/tags/v<manifest.version> on the manifest's sha, from a release manifest, is not refused", () => {
    expect(publishRefusals(env(), manifest)).toEqual([]);
  });

  it("each condition is refused by name: the event, the ref, the sha, the manifest mode", () => {
    expect(publishRefusals(env({ GITHUB_EVENT_NAME: "workflow_dispatch" }), manifest).join("\n")).toMatch(/event is "workflow_dispatch", not push/);
    expect(publishRefusals(env({ GITHUB_REF: "refs/tags/v1.0.1" }), manifest).join("\n")).toMatch(/ref is "refs\/tags\/v1\.0\.1", not refs\/tags\/v1\.0\.0/);
    expect(publishRefusals(env({ GITHUB_REF: "refs/heads/release-dry-run/x" }), manifest)).toHaveLength(1);
    expect(publishRefusals(env({ GITHUB_SHA: OTHER }), manifest).join("\n")).toMatch(/GITHUB_SHA is .*but the artifacts were prepared from/);
    expect(publishRefusals(env(), { ...manifest, mode: "dry-run" }).join("\n")).toMatch(/prepared in "dry-run" mode, not release/);
  });

  it("an empty environment and an empty manifest are refused, not thrown on", () => {
    expect(publishRefusals({}, {}).length).toBeGreaterThanOrEqual(3);
  });
});

describe("The report", () => {
  it("names every package and channel with its status, grouped by channel, in the order given", () => {
    const report = releaseReport([
      { channel: "npm", item: "@iris-mcp/client-config@1.0.0", status: STATUS.published },
      { channel: "npm", item: "@iris-mcp/shared@1.0.0", status: STATUS.failed, detail: "E403" },
      { channel: "npm", item: "@iris-mcp/admin@1.0.0", status: STATUS.notAttempted },
      { channel: "vscode-marketplace", item: "iris-mcp-launcher@0.1.0", status: skippedText({ enabledBy: "Story 42.7" }) },
    ]);
    expect(report).toBe(
      [
        "Release report",
        "npm",
        "  @iris-mcp/client-config@1.0.0: published",
        "  @iris-mcp/shared@1.0.0: failed (E403)",
        "  @iris-mcp/admin@1.0.0: not attempted",
        "vscode-marketplace",
        "  iris-mcp-launcher@0.1.0: skipped: not enabled (Story 42.7)",
        "",
      ].join("\n"),
    );
  });

  it("the statuses are the five of the acceptance criteria", () => {
    expect([STATUS.published, STATUS.alreadyPublished, STATUS.failed, STATUS.notAttempted, STATUS.skipped]).toEqual(["published", "already published", "failed", "not attempted", "skipped"]);
    expect(skippedText({ enabledBy: "Story 42.8" })).toBe("skipped: not enabled (Story 42.8)");
  });
});
