/**
 * Story 42.5 (AC 42.5.1 to 42.5.4, DW-689; AD-29; project rules #30 and #43) -- the documents say what the release is and how it is
 * run. One claim each, on the pattern of `story-42-4-doc-claims.test.ts`:
 *  - the root README has the `### Releasing` subsection exactly once, after `### Continuous Integration` and under Contributing (a later
 *    subsection may sit between them): the steps with their commands and where the approval is given, the four jobs, the publish order,
 *    what to do when a publish stops part-way, the channels with their default states and the stories that enable them, the manual Open
 *    Exchange release press, the dry run and its trigger, the npm authentication route, and the bad-release policy;
 *  - `SECURITY.md` names the supported versions, the private reporting route with no email address, the scope and the handling;
 *  - the CHANGELOG section of Story 42.5 is found by its title and is above Story 42.4's (the relative order, so a later story's section
 *    above it leaves this file true), names no `BOOTSTRAP_VERSION` move, and says that nothing is published and that no tool, wire or
 *    governance change was made;
 *  - the story adds no changeset, and the 1.0.0 template stays outside `.changeset/`.
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";
import { NPM_PUBLISH_ORDER, RELEASE_CHANNELS } from "../../../../scripts/lib/release-core.mjs";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

interface Heading {
  level: number;
  text: string;
  line: number;
}

/** The Markdown headings of a document, in order; a `#` line inside a code fence is not a heading. */
function headingsOf(document: string): Heading[] {
  const found: Heading[] = [];
  let fenced = false;
  document.split("\n").forEach((line, index) => {
    if (/^(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    const match = fenced ? null : /^(#{1,6}) /.exec(line);
    if (match) found.push({ level: match[1]?.length ?? 0, text: line, line: index });
  });
  return found;
}

/** The text under `heading`, up to the next heading of any level; "" when the heading is absent. */
function sectionUnder(document: string, heading: string): string {
  const headings = headingsOf(document);
  const at = headings.findIndex((candidate) => candidate.text === heading);
  if (at < 0) return "";
  const lines = document.split("\n");
  return lines.slice((headings[at]?.line ?? 0) + 1, headings[at + 1]?.line ?? lines.length).join("\n");
}

const RELEASING = "### Releasing";
const CI = "### Continuous Integration";
const readme = read("README.md");

describe("Story 42.5: the README Releasing subsection", () => {
  const section = squash(sectionUnder(readme, RELEASING));

  it("is there exactly once, after Continuous Integration, under Contributing", () => {
    expect(readme.split("\n").filter((line) => line === RELEASING)).toHaveLength(1);
    const headings = headingsOf(readme);
    const ci = headings.findIndex((heading) => heading.text === CI);
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(headings.findIndex((heading) => heading.text === RELEASING), "Releasing comes after Continuous Integration").toBeGreaterThan(ci);
    expect(readme.indexOf("## Contributing")).toBeLessThan(readme.indexOf(CI));
    expect(readme.indexOf(CI)).toBeLessThan(readme.indexOf(RELEASING));
    expect(section, "the subsection has a body").not.toBe("");
  });

  it("gives the steps with their commands: the version step, the first-release flag, the CHANGELOG section, CI green, the tag, the approval", () => {
    expect(section).toContain("Run `pnpm run version`");
    expect(section).toContain("`pnpm version` hands over to `npm version`, and the script refuses to run as that hook");
    expect(section).toContain("`pnpm run version -- --first-release`");
    expect(section).toContain("`scripts/release/changeset-1.0.0.md`");
    expect(section).toContain("root `CHANGELOG.md` section");
    expect(section).toContain("`BOOTSTRAP_VERSION` move");
    expect(section).toContain("wait for CI to be green on the commit");
    expect(section).toContain("Tag the commit `v<MAJOR.MINOR.PATCH>`");
    expect(section).toContain("Approve the run in the `release` environment");
  });

  it("says where the approval is given: the run page's Review deployments button, not the page that configures the environment", () => {
    expect(section).toContain("the **Review deployments** button on the run page approves it");
    expect(section).toContain("The environment itself (Settings, Environments) holds the required reviewer and the secrets");
    expect(section, "Settings, Environments is no longer named as where to approve").not.toContain("(GitHub, Settings, Environments)");
  });

  it("says what to do when a publish stops part-way: run the release again, and release a new patch version if the fix changes a package", () => {
    expect(section).toContain("If a publish stops part-way, fix the cause and run the release again: versions already on the registry are skipped.");
    expect(section).toContain("If the fix changes a package, release a new patch version.");
  });

  it("names the four jobs, the only entry point and the publish order", () => {
    for (const job of ["ci-gate", "prepare", "rehearse", "publish"]) expect(section, job).toContain(`\`${job}\``);
    expect(section).toContain("`.github/workflows/release.yml`");
    expect(section).toContain("`node scripts/release.mjs` (alias `pnpm release`)");
    expect(section).toContain("no workflow step and no `package.json` script holds a publish command");
    expect(section).toContain(NPM_PUBLISH_ORDER.map((name: string) => `\`${name.replace(/^@iris-mcp\//, "")}\``).join(", ").replace(/, `all`$/, ", `all`"));
    expect(section).toContain("in the order `client-config`, `shared`, `admin`, `data`, `dev`, `interop`, `ops`, `all`");
    expect(section).toContain("with npm provenance");
    expect(section).toContain("it has no environment, no OIDC permission and no secret");
    expect(section).toContain("runs only on a tag push and only after the other three, behind the `release` environment");
    expect(section).toContain("published, already published, failed, not attempted or skipped");
  });

  it("states each channel's default state and the story that enables it, matching the code", () => {
    const rows = sectionUnder(readme, RELEASING).split("\n").filter((line) => line.startsWith("| "));
    expect(rows.length).toBe(RELEASE_CHANNELS.length + 2);
    const bodies = rows.slice(2);
    RELEASE_CHANNELS.forEach((channel: { id: string; enabled: boolean; enabledBy?: string }, index: number) => {
      const row = squash(bodies[index] ?? "");
      if (channel.enabled) {
        expect(row, channel.id).toContain("| enabled |");
      } else {
        expect(row, channel.id).toContain(`disabled: \`skipped: not enabled (${channel.enabledBy})\``);
        expect(row.endsWith(`| ${channel.enabledBy} |`), channel.id).toBe(true);
      }
    });
    expect(bodies[0]).toContain("npm (`@iris-mcp/*`)");
    expect(bodies[1]).toContain("VS Code Marketplace");
    expect(bodies[2]).toContain("Open VSX");
    expect(bodies[3]).toContain("`jbrandtmse/iris-execute-mcp-v2-ipm`");
    expect(section).toContain("runs its read-only dry step in a rehearsal and reports whether it is ready");
    expect(section).toContain("listing the new version on Open Exchange is a manual release step");
  });

  it("explains the dry run, its trigger, and that a tag is never one", () => {
    expect(section).toContain("A push to a `release-dry-run/**` branch, or a manual dispatch of the workflow");
    expect(section).toContain("`git push origin <sha>:refs/heads/release-dry-run/<name>`");
    expect(section).toContain("runs every job except `publish`");
    expect(section).toContain("A tag is never a dry run");
    expect(section).toContain("`npm view @iris-mcp/shared` still answers E404");
  });

  it("explains the npm authentication route: a short-lived token for the first release, then trusted publishing, and the token never printed", () => {
    expect(section).toContain("trusted publishing (OIDC) whenever no token is set");
    expect(section).toContain("short-lived granular token, scoped to `@iris-mcp`, stored as the `NPM_TOKEN` secret of the `release` environment");
    expect(section, "the token a workflow can publish with (decision #75)").toContain('read and write access to the `@iris-mcp` scope, with "Bypass two-factor authentication" turned on');
    expect(section).toContain("an expiry of 7 days or less; npm ends direct publishing with such a token in January 2027");
    expect(section).toContain("0600 temporary userconfig that it deletes on every exit path, and never prints it");
    expect(section).toContain("`npm trust github @iris-mcp/<package> --file release.yml --repo jbrandtmse/iris-execute-mcp-v2 --env release --allow-publish`");
    expect(section).toContain("delete the `NPM_TOKEN` secret");
  });

  it("states the bad-release policy: fix forward, deprecate a harmful version, never unpublish, and where to report a vulnerability", () => {
    expect(section).toContain("is fixed forward");
    expect(section).toContain("`npm deprecate @iris-mcp/<package>@<version>");
    expect(section).toContain("never removed with `npm unpublish`");
    expect(section).toContain("there is no rollback");
    expect(section).toContain("[SECURITY.md](SECURITY.md)");
  });
});

describe("Story 42.5: SECURITY.md", () => {
  const policy = squash(read("SECURITY.md"));

  it("names the supported versions, and reports through GitHub private vulnerability reporting with no email address", () => {
    expect(policy).toContain("The latest `1.x` release receives security fixes");
    expect(policy).toContain("GitHub private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**");
    expect(policy).toContain("No email address is published for security reports");
    expect(policy, "no email address anywhere in the policy").not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(policy).toContain("do not open a public issue or pull request for a vulnerability");
  });

  it("states the scope: the npm packages, the IRIS classes, the extension and the IPM package", () => {
    expect(policy).toContain("the npm packages `@iris-mcp/*`");
    expect(policy).toContain("the `ExecuteMCPv2` package (`/api/executemcp/v2`)");
    expect(policy).toContain("the VS Code extension (IRIS MCP Launcher)");
    expect(policy).toContain("the IPM package `iris-execute-mcp-v2`");
  });

  it("states the handling: fix forward, then an advisory, then npm deprecate, and never unpublish", () => {
    expect(policy).toContain("**Fix forward.**");
    expect(policy).toContain("**Advisory.**");
    expect(policy).toContain("**Deprecation.** Each affected npm version is marked with `npm deprecate`");
    expect(policy).toContain("never removed with `npm unpublish`");
    expect(policy.indexOf("**Fix forward.**")).toBeLessThan(policy.indexOf("**Advisory.**"));
    expect(policy.indexOf("**Advisory.**")).toBeLessThan(policy.indexOf("**Deprecation.**"));
  });
});

describe("Story 42.5: the CHANGELOG section and the changeset", () => {
  const changelog = read("CHANGELOG.md");
  const sections = changelog.split(/^(?=## \[)/m).slice(1);
  const own = sections.find((candidate) => (candidate.split("\n")[0] ?? "").endsWith("Story 42.5: Release Workflow")) ?? "";
  const text = squash(own);

  it("is the section of Story 42.5, found by its title, and it comes before the section of Story 42.4", () => {
    expect(own, "the CHANGELOG has a Story 42.5 section").not.toBe("");
    expect(own.split("\n")[0]).toMatch(/^## \[Pre-release \u2014 2026-10-22\] \u2014 Story 42\.5: Release Workflow$/);
    const titles = sections.map((candidate) => candidate.split("\n")[0] ?? "");
    const at42x5 = titles.findIndex((title) => title.endsWith("Story 42.5: Release Workflow"));
    const at42x4 = titles.findIndex((title) => title.endsWith("Story 42.4: IPM Package Revival"));
    expect(at42x4, "the Story 42.4 section is there").toBeGreaterThanOrEqual(0);
    expect(at42x5).toBeGreaterThanOrEqual(0);
    expect(at42x5).toBeLessThan(at42x4);
  });

  it("says nothing is published and no changeset is added, with no tool, wire or governance change, and that BOOTSTRAP_VERSION does not move", () => {
    expect(text).toContain("Nothing is published, versioned, tagged or released by this story, and it adds no changeset");
    expect(text).toContain("no tool count moves (110 package tools, 115 advertised)");
    expect(text).toContain("the frozen governance baseline stays at hash `1e62c5ad5bf7` (141 keys)");
    expect(text).toContain("the frozen SDK goldens and the tools-list snapshot are byte-unchanged");
    expect(text).toContain("`BOOTSTRAP_VERSION` does not move (it stays `0.0.2+2.244fe8623c76`)");
    expect(text, "a section that names no move is not the newest move of changelog-bootstrap-move.test.ts").not.toMatch(/`BOOTSTRAP_VERSION` moves /);
  });

  it("names the workflow, the script, the version step, SECURITY.md and the DW-693 fixes", () => {
    for (const name of ["`.github/workflows/release.yml`", "`scripts/release.mjs`", "`pnpm run version [-- --first-release]`", "`SECURITY.md`", "`scripts/lib/audit-lines.mjs`", "`audit-reader-guard.test.ts`", "`ChildProcess.prototype.kill` spy"]) {
      expect(text, name).toContain(name);
    }
    for (const id of ["DW-387", "DW-675", "DW-689", "DW-693"]) expect(text, id).toContain(id);
    expect(text).toContain("The extension and IPM channels are implemented and dry-run, and ship disabled");
  });

  it("adds no changeset, and the 1.0.0 template stays outside .changeset/", () => {
    const names = readdirSync(path.join(REPO_ROOT, ".changeset"));
    expect(names.filter((name) => /42-5|release-workflow/.test(name))).toEqual([]);
    expect(existsSync(path.join(REPO_ROOT, "scripts", "release", "changeset-1.0.0.md"))).toBe(true);
    expect(names).not.toContain("changeset-1.0.0.md");
  });
});
