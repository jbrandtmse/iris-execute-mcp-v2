/**
 * Story 42.8 (AC 42.8.2, AC 42.8.5; Rules #30, #43, #51) - the documents say what the code does, each claim pinned to the code it describes:
 *  - the Releasing table of the root README lists every channel of `RELEASE_CHANNELS`, in order, with the default state the code has;
 *  - the README names the IPM deploy-key secret, the pinned `mcp-publisher` and the three host keys' pin, as the release script has them;
 *  - the plugin's install commands, options and defaults in the pack README, the root README and the changeset are the plugin's own;
 *  - the pinned installer command in the pack README names a real bin and only flags its usage line lists;
 *  - the CHANGELOG has this story's section above the previous one, and the changeset is a `minor` of `@iris-mcp/client-config`;
 *  - the client-config README names the three settings files the detector reads, in precedence order.
 * No test here runs the installer or the release; they read the documents and the constants.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

  it("each row's default state is the code's: enabled when the channel is, and none says `skipped`", () => {
    RELEASE_CHANNELS.forEach((channel: { id: string; enabled: boolean }, index: number) => {
      const state = CHANNEL_ROWS[index]?.state as string;
      expect(state.startsWith(channel.enabled ? "enabled" : "disabled"), `${channel.id}: ${state}`).toBe(true);
      expect(state).not.toContain("skipped");
    });
  });

  it("names the owner prerequisite of IPM (the deploy-key secret and the packaging repository) and the registry's lack of one", () => {
    expect(RELEASING).toContain("`IPM_DIST_DEPLOY_KEY` secret of the `release` environment");
    expect(RELEASING).toContain("`jbrandtmse/iris-execute-mcp-v2-ipm`");
    expect(RELEASING).toContain("It needs no owner step and no secret");
    expect(RELEASING).toContain("owner step O-IPM1");
  });

  it("names the pinned mcp-publisher version and the host-key pin, which are the code's", () => {
    expect(RELEASING).toContain(`\`mcp-publisher\` (${MCP_PUBLISHER.version}`);
    expect(RELEASING).toContain("`StrictHostKeyChecking=yes`");
    expect(RELEASING).not.toContain("accept-new");
  });

  it("says the registry channel runs last and does not block the others, and what a rehearsal does with its `not ready` (decision #108)", () => {
    expect(RELEASING).toContain("runs last and never blocks the others");
    expect(RELEASING).toContain("in a rehearsal its `not ready` is reported without failing the run");
    expect(RELEASING).toContain("a failed upload fails the run only after every other channel has finished");
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
  it("the CHANGELOG has this story's section first, above 42.7's", () => {
    const headings = CHANGELOG.split("\n").filter((line) => line.startsWith("## "));
    expect(headings[0]).toBe("## [Unreleased] \u2014 Story 42.8: Claude Code Plugin and Registry Listings");
    expect(headings[1]).toBe("## [Unreleased] \u2014 Story 42.7: VS Code Extension Publish");
  });

  it("the CHANGELOG section states that nothing moves: the frozen baseline hash and count, and BOOTSTRAP_VERSION", () => {
    const section = CHANGELOG.slice(CHANGELOG.indexOf("## [Unreleased] \u2014 Story 42.8"), CHANGELOG.indexOf("## [Unreleased] \u2014 Story 42.7"));
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
