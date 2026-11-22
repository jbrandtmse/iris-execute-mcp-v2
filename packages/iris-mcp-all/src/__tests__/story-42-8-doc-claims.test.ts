/**
 * Story 42.8 (AC 42.8.2, AC 42.8.5; Rules #30, #43, #51) - the documents say what the code does, each claim pinned to the code it describes:
 *  - the Releasing table of the root README lists every channel of `RELEASE_CHANNELS`, in order, with the default state the code has;
 *  - the README names the pinned `mcp-publisher` as the release script has it, and the owner's IPM step as a manual one on the Open Exchange
 *    listing (decision #122: no packaging repository, deploy key or host-key pin remains);
 *  - the plugin's install commands, options and defaults in the pack README, the root README and the changeset are the plugin's own;
 *  - the pinned installer command in the pack README names a real bin and only flags its usage line lists;
 *  - the CHANGELOG has this story's section above the previous one, and the changeset is a `minor` of `@iris-mcp/client-config`;
 *  - the client-config README names the three settings files the detector reads, in precedence order.
 * No test here runs the installer or the release; they read the documents and the constants.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { moduleMemberEntries } from "../../../../scripts/lib/ipm-archive.mjs";
import { MCP_PUBLISHER, RELEASE_CHANNELS } from "../../../../scripts/lib/release-core.mjs";
import { MARKETPLACE_NAME, PACK_DIR, PLUGIN_NAME } from "../../../../scripts/lib/skills-pack.mjs";
import { REPO_ROOT } from "./pack-fixture";

const read = (relative: string): string => readFileSync(join(REPO_ROOT, relative), "utf8");
const ROOT_README = read("README.md");
const PACK_README = read(`${PACK_DIR}/README.md`);
const CLIENT_README = read("packages/client-config/README.md");
const CHANGELOG = read("CHANGELOG.md");
const PLUGIN = JSON.parse(read(`${PACK_DIR}/.claude-plugin/plugin.json`)) as { userConfig: Record<string, { default?: string | number | boolean }> };

/** This story's pending changeset, or `undefined` once the version step has consumed it (or the directory is hidden). */
const STORY_CHANGESET = existsSync(join(REPO_ROOT, ".changeset")) ? readdirSync(join(REPO_ROOT, ".changeset")).find((name) => name.startsWith("story-42-8-")) : undefined;

/** The root README's `### Releasing` section. */
const RELEASING = ((): string => {
  const start = ROOT_README.indexOf("### Releasing");
  const end = ROOT_README.indexOf("\n## ", start);
  return ROOT_README.slice(start, end === -1 ? undefined : end);
})();

/** The rows of the Releasing table: the channel cell, the default-state cell. */
const CHANNEL_ROWS = ((): Array<{ channel: string; state: string }> => {
  const lines = RELEASING.split("\n");
  const header = lines.findIndex((line) => line.startsWith("| Channel | Default state"));
  const rows: Array<{ channel: string; state: string }> = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    rows.push({ channel: cells[0] as string, state: cells[1] as string });
  }
  return rows;
})();

describe("the Releasing table (Rules #30, #51: the default state is derived from the channels, never hand-counted)", () => {
  it("has one row per channel of RELEASE_CHANNELS, in publish order", () => {
    const expected = ["npm", "VS Code Marketplace", "Open VSX", "IPM", "MCP Registry"];
    expect(RELEASE_CHANNELS.map((channel: { id: string }) => channel.id)).toEqual(["npm", "vscode-marketplace", "open-vsx", "ipm", "mcp-registry"]);
    expect(CHANNEL_ROWS).toHaveLength(RELEASE_CHANNELS.length);
    CHANNEL_ROWS.forEach((row, index) => expect(row.channel, `row ${index}`).toContain(expected[index] as string));
  });

  it("each row's default state is the code's: `manual step` for the channel that has `manual: true`, enabled when the channel is, and only a disabled row says `skipped` (its own skip text)", () => {
    RELEASE_CHANNELS.forEach((channel: { id: string; enabled: boolean; manual?: boolean }, index: number) => {
      const state = CHANNEL_ROWS[index]?.state as string;
      if (channel.manual === true) expect(state, channel.id).toBe("manual step");
      else expect(state.startsWith(channel.enabled ? "enabled" : "disabled"), `${channel.id}: ${state}`).toBe(true);
      if (channel.enabled) expect(state).not.toContain("skipped");
      else expect(state, channel.id).toBe(`disabled: \`skipped: not enabled (${(channel as { enabledBy?: string }).enabledBy})\``);
    });
    expect(RELEASE_CHANNELS.filter((channel: { manual?: boolean }) => channel.manual === true).map((channel: { id: string }) => channel.id)).toEqual(["ipm"]);
  });

  it("describes the owner's IPM step (decision #122): the Open Exchange listing, the Release press, the root module.xml, and the registry's lack of any other prerequisite", () => {
    expect(RELEASING).toContain("**IPM is a manual step (owner step O-IPM, after the tag).**");
    expect(RELEASING).toContain("`IRIS-MCP-Server-Suite-2`");
    expect(RELEASING).toContain("https://openexchange.intersystems.com/package/IRIS-MCP-Server-Suite-2");
    expect(RELEASING).toContain("the registry reads the root `module.xml` of `main`");
    expect(RELEASING).toContain("tick **Publish in Package Manager**");
    expect(RELEASING).toContain("press **Release**");
    expect(RELEASING).toContain("The release uploads nothing and needs no repository, deploy key or secret.");
    expect(RELEASING).toContain('a "Manual steps" block at the end of the report');
    expect(RELEASING).toContain("it never changes the run's exit code");
    expect(RELEASING).toContain("**Never create a `master` branch in this repository**");
    expect(RELEASING).toContain("It needs no owner step and no secret");
  });

  it("says nothing of the superseded design: no packaging repository, deploy key, host-key pin or `O-IPM1`", () => {
    // Built from parts, so that this file holds none of the removed names (the removal is also checked by grep).
    for (const gone of ["iris-execute-mcp-v2" + "-ipm", "IPM_" + "DIST", "Strict" + "HostKeyChecking", "O-IPM" + "1", "packaging " + "repository", "deploy " + "key with write access"]) {
      expect(RELEASING, gone).not.toContain(gone);
    }
    expect(RELEASING).not.toContain("accept-new");
  });

  it("names the pinned mcp-publisher version, which is the code's", () => {
    expect(RELEASING).toContain(`\`mcp-publisher\` (${MCP_PUBLISHER.version}`);
  });

  it("says the IPM step's verify check: `pending` until the registry lists the version, then the module in the served archive equals the tag's (decision #122)", () => {
    expect(RELEASING).toContain("the IPM registry is `pending` (and verify does not fail for it)");
    expect(RELEASING).toContain("the module in the archive it serves (the root `module.xml`, `ipm/src` and `preload`) must equal `git archive v<MAJOR.MINOR.PATCH>` member for member and byte for byte, the rest of that archive being `main` at the press and not compared");
    expect(RELEASING).toContain("press Release before another version commit reaches `main`, or ask the registry to republish");
    expect(RELEASING).toContain("`pnpm release verify --version <v>` turns IPM from `pending` to `ok`");
  });

  it("states the scoped-verify rule plainly: every file an install reads is compared, and why the rest of the served archive is not (decision #122)", () => {
    expect(RELEASING).toContain("**What `verify` checks for IPM, and why only the module.**");
    expect(RELEASING).toContain("the root `module.xml` and every file under `ipm/src` and `preload/`, byte for byte, with no file missing and none extra, and the served `module.xml` must carry the release's version");
    expect(RELEASING).toContain("Those are every file an IPM install reads, so a served module that differs from the tag in any byte fails `verify`.");
    expect(RELEASING).toContain("the registry packages `main` at the moment the owner presses Release, not the tag");
    // The paragraph names the members the code compares: the root module.xml and everything under ipm/src and preload, nothing else.
    const names = ["module.xml", "ipm/src/cls/A.cls", "ipm/src/other.txt", "preload/ipm/src/cls/G.cls", "README.md", "ipm/preload/G.cls", "src/A.cls", "packages/x.ts"];
    expect(moduleMemberEntries(names.map((name) => ({ name, type: "file" }))).map((entry: { name: string }) => entry.name)).toEqual(["module.xml", "ipm/src/cls/A.cls", "ipm/src/other.txt", "preload/ipm/src/cls/G.cls"]);
  });

  it("step 1 says the version step writes the root module.xml and the stamped IPM tree, and prepare says it refuses a stale tree (decision #122)", () => {
    expect(RELEASING).toContain("`node scripts/gen-bootstrap.mjs --ipm`: the embed, its `BOOTSTRAP_VERSION` marker, the root `module.xml` and the stamped IPM tree under `ipm/src` and `preload/`, which this step alone writes");
    expect(RELEASING).toContain("a release refuses a tree whose stamped marker is not `BOOTSTRAP_VERSION`");
    expect(RELEASING).toContain("a dry run only notes the difference");
  });

  it("says the registry channel runs last and does not block the others, and what a rehearsal does with its `not ready` (decision #108)", () => {
    expect(RELEASING).toContain("runs last and never blocks the others");
    expect(RELEASING).toContain("in a rehearsal its `not ready` is reported without failing the run");
    expect(RELEASING).toContain("a failed upload fails the run only after every other channel has finished");
  });

  it("says a channel that is not set up is skipped and listed, not a failure, and what still fails (decision #121)", () => {
    expect(RELEASING).toContain("**A channel that is not set up is skipped, not a failure.**");
    expect(RELEASING).toContain("`skipped (not set up: <reason>)`");
    expect(RELEASING).toContain('a "Skipped channels" block at the end of the report');
    expect(RELEASING).toContain("`::warning::` annotation");
    expect(RELEASING).toContain("run the release again for the same tag");
    expect(RELEASING).toContain("anything on npm still fail the run");
    expect(RELEASING).toContain("and the IPM channel is not one of them: it is a manual step that never fails or blocks a run (below), so only a missing store setup is skipped, and an npm-only release can go out.");
  });

  it("step 1 names the generators the version step runs after the bootstrap", () => {
    expect(RELEASING).toContain("`pnpm gen:pack` and `pnpm gen:listings`");
    expect(RELEASING).toContain("the five `server.json` files of the MCP Registry");
  });
});

describe("the plugin in the documents (AC 42.8.2)", () => {
  const commands = ["`/plugin marketplace add jbrandtmse/iris-execute-mcp-v2`", `\`/plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}\``];

  it("the pack README (the plugin's README) and the root README give the same two install commands", () => {
    for (const command of commands) {
      expect(PACK_README, `the pack README: ${command}`).toContain(command);
      expect(ROOT_README, `the root README: ${command}`).toContain(command);
    }
  });

  it("the pack README names the six options with the plugin's own defaults", () => {
    for (const [key, option] of Object.entries(PLUGIN.userConfig)) {
      expect(PACK_README, key).toContain(`\`${key}\``);
      if (option.default !== undefined) expect(PACK_README, `${key}'s default`).toContain(`\`${String(option.default)}\``);
    }
    expect(PACK_README).toContain("they win over the same variables exported in your shell");
  });

  it("the pack README gives the @1-pinned installer command for the rule, and that is a real bin with real flags", () => {
    const command = "npx -y -p @iris-mcp/client-config@1 iris-mcp-clients skills install --client claude-code";
    expect(PACK_README).toContain(`\`${command}\``);
    const manifest = JSON.parse(read("packages/client-config/package.json")) as { name: string; bin: Record<string, string> };
    expect(Object.keys(manifest.bin)).toEqual(["iris-mcp-clients"]);
    expect(CLIENT_README).toContain("`npx -y -p @iris-mcp/client-config@1 iris-mcp-clients <command>`");
    for (const flag of command.match(/--[a-z-]+/g) ?? []) expect(read("packages/client-config/src/cli/clients.ts"), flag).toContain(`"${flag}"`);
  });

  it("the root README's skill count for the plugin is the pack's, counted from its skills directory (Rule #51)", () => {
    const count = readdirSync(join(REPO_ROOT, PACK_DIR, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
    const claimed = [...ROOT_README.matchAll(/\b(\d+) skills\b/g)].map((match) => Number(match[1]));
    expect(claimed.length, "the README states the plugin's skill count").toBeGreaterThanOrEqual(2);
    expect(new Set(claimed)).toEqual(new Set([count]));
  });

  it("the root README's skills section and Known limits say that the plugin makes the claude-code route install only the rule", () => {
    expect(ROOT_README).toContain("With the plugin enabled, `skills install --client claude-code` installs only the rule");
    expect(ROOT_README).toContain("The Claude Code route installs only the rule when it finds the `iris-mcp@iris-mcp` plugin enabled");
  });

  it("the client-config README names the three settings files in precedence order and what it does not read", () => {
    const user = CLIENT_README.indexOf("the user file (`$CLAUDE_CONFIG_DIR/settings.json`, else\n  `~/.claude/settings.json`)");
    const project = CLIENT_README.indexOf("the project's `.claude/settings.json`");
    const local = CLIENT_README.indexOf("the project's `.claude/settings.local.json`");
    expect(user).toBeGreaterThan(-1);
    expect(project).toBeGreaterThan(user);
    expect(local).toBeGreaterThan(project);
    expect(CLIENT_README).toContain("managed settings, `--settings`, `--add-dir` and synced");
  });
});

describe("the CHANGELOG and the changeset (Rule #43)", () => {
  it("the CHANGELOG has this story's section directly below Story 42.9's and above 42.7's, and the amendment's (decision #122) above both, under the release's [1.1.0] section", () => {
    const headings = CHANGELOG.split("\n").filter((line) => line.startsWith("## "));
    // A pending `## [Unreleased]` section (a later story's entry before its release) sits above the release's section.
    if (headings[0]?.startsWith("## [Unreleased]")) headings.shift();
    expect(headings[0]).toMatch(/^## \[1\.1\.0\] \u2014 \d{4}-\d{2}-\d{2}$/);
    expect(headings[1]).toBe("## [1.1.0 detail] \u2014 Story 42.8 amendment (decision #122): IPM Publishes From the Main Repository");
    expect(headings[2]).toBe("## [1.1.0 detail] \u2014 Story 42.9: Install Docs and Client Re-Certification");
    expect(headings[3]).toBe("## [1.1.0 detail] \u2014 Story 42.8: Claude Code Plugin and Registry Listings");
    expect(headings[4]).toBe("## [1.1.0 detail] \u2014 Story 42.7: VS Code Extension Publish");
  });

  it("the release's [1.1.0] section (the version step, decision #117) names the BOOTSTRAP_VERSION move and the unchanged baseline", () => {
    const section = CHANGELOG.slice(CHANGELOG.indexOf("## [1.1.0] \u2014"), CHANGELOG.indexOf("## [1.1.0 detail]"));
    expect(section).toContain("`BOOTSTRAP_VERSION` moves from `1.0.0+2.244fe8623c76` to `1.1.0+2.244fe8623c76`");
    expect(section).toContain("`1e62c5ad5bf7` (141 keys)");
    expect(section).toContain('zpm "install iris-execute-mcp-v2"');
    expect(section).toContain("Use it only where the servers cannot install those classes themselves");
    // DW-719: the extension ships as a vsix on the GitHub Release, and no line of the section says it is on a store.
    expect(section).toContain("attached to the `v1.1.0` GitHub Release as `iris-mcp-launcher-1.1.0.vsix`");
    expect(section).toContain("It is not on the Visual Studio Marketplace or Open VSX yet");
    expect(section).not.toMatch(/on the stores|is published under the publisher `iris-mcp` to the VS Code Marketplace/);
  });

  it("the amendment's CHANGELOG section says what moved and what did not: the tree, the manual step, verify, the removals, and that BOOTSTRAP_VERSION stays (decision #122)", () => {
    const section = CHANGELOG.slice(CHANGELOG.indexOf("## [1.1.0 detail] \u2014 Story 42.8 amendment"), CHANGELOG.indexOf("## [1.1.0 detail] \u2014 Story 42.9"));
    for (const claim of [
      "`BOOTSTRAP_VERSION` does not move (`1.0.0+2.244fe8623c76`)",
      "`pnpm gen:ipm`",
      "`pnpm gen:ipm:check`",
      "only the version step (`pnpm run version`) runs it",
      "`ready (manual step after the tag: ...)`",
      '"Manual steps" block',
      "can neither fail nor block a run",
      "`pending`",
      "the module in the archive it serves (the root `module.xml`, `ipm/src` and `preload`) must equal `git archive v<version>`",
      "the rest of the archive is `main` at the Release press and is not compared",
      "The packaging repository, its deploy key and the pinned host keys.",
      "Never create a `master` branch in this repository",
      "there are no export rules",
    ]) {
      expect(section, claim).toContain(claim);
    }
  });

  it("the CHANGELOG section states that nothing moves: the frozen baseline hash and count, and BOOTSTRAP_VERSION", () => {
    const section = CHANGELOG.slice(CHANGELOG.indexOf("## [1.1.0 detail] \u2014 Story 42.8"), CHANGELOG.indexOf("## [1.1.0 detail] \u2014 Story 42.7"));
    expect(section).toContain("`1e62c5ad5bf7` (141 keys)");
    expect(section).toContain("`BOOTSTRAP_VERSION` does not move");
    expect(section).toContain("`1.1.0`");
  });

  // The version step consumes the changeset, so once the release is versioned there is nothing to read (the tests that mention .changeset run again with it hidden).
  it.skipIf(STORY_CHANGESET === undefined)("this story's changeset is a `minor` of @iris-mcp/client-config alone, and the fixed group makes the release 1.1.0", () => {
    const file = STORY_CHANGESET as string;
    const text = read(`.changeset/${file}`);
    expect(/^---\n([\s\S]*?)\n---\n/.exec(text)?.[1]).toBe('"@iris-mcp/client-config": minor');
    const config = JSON.parse(read(".changeset/config.json")) as { fixed: string[][] };
    expect(config.fixed).toEqual([["@iris-mcp/*"]]);
  });
});
