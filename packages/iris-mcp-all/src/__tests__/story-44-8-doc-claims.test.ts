/**
 * Story 44.8 (AC-7; project rules #30 and #43) -- the documents say what the Local harness's resolve step now refuses and why.
 * One claim each, on the pattern of `story-44-6-doc-claims.test.ts`:
 *  - the root CHANGELOG has the Story 44.8 block (newest first) naming DW-752, DW-761 and the sanctioned AD-15 change, and the
 *    Story 44.6 block's "Local harness unchanged" sentence is corrected to point at it;
 *  - the extension CHANGELOG's first section names Story 44.8 and no longer claims the Local harness is unchanged without
 *    qualification;
 *  - the extension README no longer says the Local harness still prompts for a workspace-defined server, and its Credential
 *    handling section names the refusal;
 *  - the root README says a workspace-defined Server Manager server never gets a stored password (DW-761);
 *  - the one changeset is an `@iris-mcp/shared` patch (asserted only while it exists: the release step consumes it).
 * Needs no IRIS and no built dist: it reads documents. Cross-package documentation checks live in `@iris-mcp/all` (rule #45).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const squash = (text: string): string => text.replace(/\s+/g, " ");

describe("Story 44.8: the changelogs", () => {
  const rootChangelog = read("CHANGELOG.md");
  const blocks = rootChangelog.split(/^(?=## \[)/m);
  const block = blocks.find((section) => section.startsWith("## [Unreleased] — Story 44.8")) ?? "";

  it("the root CHANGELOG has the Story 44.8 block, newest first, naming both defects and the sanctioned AD-15 change", () => {
    expect(block).not.toBe("");
    const story446Index = blocks.findIndex((section) => section.startsWith("## [Unreleased] — Story 44.6"));
    expect(story446Index).toBeGreaterThan(-1);
    expect(blocks.indexOf(block), "newer than the Story 44.6 block").toBeLessThan(story446Index);
    const flat = squash(block);
    expect(flat).toContain("sanctioned AD-15 change");
    expect(flat).toContain("DW-752");
    expect(flat).toContain("DW-761");
    expect(flat).toContain("define the server in your user settings under a name no workspace settings use");
  });

  it("the Story 44.6 block no longer claims the Local harness env is unconditionally unchanged", () => {
    const story446 = squash(blocks.find((section) => section.startsWith("## [Unreleased] — Story 44.6")) ?? "");
    expect(story446).not.toContain("the resolve step still runs and returns exactly the env it returned before.");
    expect(story446).toContain("for a server defined in user settings alone");
    expect(story446).toContain("Story 44.8");
  });

  it("the extension CHANGELOG's first section names Story 44.8 and qualifies the Local-harness claim", () => {
    const first = squash(read("extensions/iris-mcp-launcher/CHANGELOG.md").split(/^(?=## \[)/m)[1] ?? "");
    expect(first).toMatch(/^## \[(Unreleased|\d+\.\d+\.\d+)\]/);
    expect(first).toContain("Story 44.8");
    expect(first).toContain("DW-752");
    expect(first).toContain("sanctioned AD-15 change");
    expect(first).not.toContain("**Local harness unchanged.**");
    expect(first).toContain("Local harness unchanged for a server defined in your user settings alone");
  });
});

describe("Story 44.8: the READMEs", () => {
  const readme = squash(read("extensions/iris-mcp-launcher/README.md"));

  it("the extension README no longer says the Local harness still prompts for a workspace-defined server", () => {
    expect(readme).not.toContain("the Local harness still prompts for such a server as before");
    expect(readme).toContain("The Local harness refuses such a server in the same way");
    // The Story 44.6 claims this story must not disturb.
    expect(readme).toContain("**Only servers defined in your user settings get a connection.**");
  });

  it("the Credential handling section names the refusal, the calls never made and the remedy", () => {
    const start = readme.indexOf("## Credential handling");
    expect(start).toBeGreaterThan(-1);
    const section = readme.slice(start);
    expect(section).toContain("**The Local resolve step starts only servers defined in your user settings alone**");
    expect(section).toContain("never calls Server Manager's `getServerSpec`, `getAccount` or `getSession`");
    expect(section).toContain("define it in your user settings under a name no workspace settings use");
  });

  it("the root README says a workspace-defined Server Manager server never gets a stored password (DW-761)", () => {
    const root = squash(read("README.md"));
    expect(root).toContain("**A workspace-defined server never gets a stored password** (DW-761).");
    expect(root).toContain("files you list in `IRIS_SM_SETTINGS_PATHS` count as yours");
  });
});

describe("Story 44.8: the changeset", () => {
  const changesetPath = ".changeset/story-44-8-local-resolver-hands-a-password-only-to-user-scoped-servers.md";
  const changesetPresent = existsSync(path.join(REPO_ROOT, changesetPath));

  // The changeset is consumed by the release version step, so it is asserted only while it exists.
  it.skipIf(!changesetPresent)("is one @iris-mcp/shared patch", () => {
    const changeset = read(changesetPath);
    expect(changeset.split("---")[1]?.trim()).toBe('"@iris-mcp/shared": patch');
  });
});
