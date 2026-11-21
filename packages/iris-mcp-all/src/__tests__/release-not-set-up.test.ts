/**
 * Story 42.8, decision #121 (the owner's ruling of 2026-11-21): a channel whose OWNER SETUP is missing is `skipped (not set up: <reason>)`
 * in a rehearsal and in a release, does not fail the run, and later channels still run; a channel that is set up and then fails still
 * fails the run; npm is never skippable; every skipped channel is listed in a "Skipped channels" block of the report (so of the step
 * summary) and as a `::warning::` annotation; and running the same tag again after the setup publishes what was skipped.
 *
 * Scope: the Open VSX namespace (owner step O1) is the one reason the real services let a read-only call tell (the namespace API's 404).
 * The Marketplace has none (DW-705: no public signal tells a missing publisher from one that has published nothing yet), `mcp-registry`
 * needs no owner setup and keeps its own non-blocking rule (decision #108), and the IPM channel is excluded pending decision #122: these
 * tests run the channels without it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NPM_PUBLISH_ORDER, RELEASE_CHANNELS } from "../../../../scripts/lib/release-core.mjs";
import { createCleanups, defaultDeps, publish } from "../../../../scripts/release.mjs";
import { installStandIns, type StandInRule, type StandIns } from "./stand-in-clis";
import { SHA, fakeFetch, makeArtifacts, marketplaceHit, mcpRegistryHit, newFakeGithub, newFakeStores, storeAnswerFor, type FakeStores } from "./release-script-fixtures";

const GITHUB_TOKEN = "ghs_SECRETGITHUBTOKEN0987654321";

/** npm, both stores and the MCP Registry: every channel but IPM (decision #122 redesigns it). */
const CHANNELS = RELEASE_CHANNELS.filter((channel: { id: string }) => channel.id !== "ipm").map((channel: { id: string }) => ({ id: channel.id, enabled: true }));
/** The same without the registry, which a rehearsal can only read through a pinned download. */
const STORES_ONLY = CHANNELS.filter((channel: { id: string }) => channel.id !== "mcp-registry");

/**
 * Open VSX's own answer for a namespace that does not exist (read-only GETs of `https://open-vsx.org/api/iris-mcp` and of an invented
 * namespace, 2026-11-21): 404, `application/json`, `{"error":"Namespace not found: <name>"}`. Only this answer is "not set up".
 */
const NAMESPACE_ABSENT = { status: 404, body: { error: "Namespace not found: iris-mcp" } };

const OPEN_VSX_SKIP ="open-vsx\n  iris-mcp-launcher@1.0.0: skipped (not set up: the Open VSX namespace iris-mcp does not exist. Create it once with npx ovsx create-namespace iris-mcp (owner step O1).)";

const NPM_DEFAULT: StandInRule[] = [
  { match: ["--version"], stdout: "11.12.1\n" },
  { match: ["view"], status: 1, stderr: "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/x\n" },
  { match: ["publish"], stdout: "+ published\n" },
];
/** After a first run published everything, `npm view <name>@<version> version` prints the version. */
const NPM_PUBLISHED: StandInRule[] = [
  { match: ["--version"], stdout: "11.12.1\n" },
  { match: ["view"], stdout: "1.0.0\n" },
  { match: ["publish"], stdout: "+ published\n" },
];

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const scratch = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "release-not-set-up-"));
  roots.push(root);
  return root;
};

interface World {
  artifacts: string;
  standIns: StandIns;
  stores: FakeStores;
  lines: string[];
  repo: string;
  run: (options?: { dryRun?: boolean; env?: Record<string, string | undefined>; channels?: unknown }) => Promise<number>;
  report: () => string;
  summaryText: () => string;
}

/** A real publisher, the extension's CLIs installed, and the MCP Registry already listing every server (so that channel needs no download in a release). */
function newWorld(): World {
  const root = scratch();
  const artifacts = path.join(root, "artifacts");
  const repo = path.join(root, "repo");
  mkdirSync(artifacts, { recursive: true });
  makeArtifacts(artifacts, { publisher: "iris-mcp" });
  const standIns = installStandIns(path.join(root, "stand-ins"), ["npm", "git"]);
  const extensionBin = path.join(repo, "extensions", "iris-mcp-launcher", "node_modules", ".bin");
  standIns.installInto("vsce", extensionBin);
  standIns.installInto("ovsx", extensionBin);
  standIns.script("npm", NPM_DEFAULT);
  const github = newFakeGithub();
  const stores = newFakeStores();
  stores.mcpRegistry = (name, version) => mcpRegistryHit(name, version);
  const lines: string[] = [];
  const summary = path.join(root, "summary.md");
  const fetchImpl = fakeFetch(github, (url, init) => storeAnswerFor(stores, url, init));
  const env = (overrides: Record<string, string | undefined> = {}): Record<string, string> =>
    Object.fromEntries(
      Object.entries({
        PATH: standIns.binDir,
        STAND_IN_DIR: standIns.dir,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/tags/v1.0.0",
        GITHUB_SHA: SHA,
        GITHUB_TOKEN,
        GITHUB_REPOSITORY: "o/r",
        GITHUB_API_URL: "https://api.github.com",
        GITHUB_STEP_SUMMARY: summary,
        ...overrides,
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
  return {
    artifacts,
    standIns,
    stores,
    lines,
    repo,
    run: (options = {}) =>
      publish(
        { artifacts, dryRun: options.dryRun ?? false, env: env(options.env), repoRoot: repo, channels: (options.channels ?? CHANNELS) as typeof RELEASE_CHANNELS },
        { ...defaultDeps(), fetch: fetchImpl, log: (line: string) => lines.push(line), cleanups: createCleanups() },
      ),
    report: () => lines.join("\n"),
    summaryText: () => (existsSync(summary) ? readFileSync(summary, "utf8") : ""),
  };
}

const npmUploads = (world: World): number => world.standIns.calls("npm").filter((call) => call.argv[0] === "publish").length;
const registryAsked = (world: World): boolean => world.stores.requests.some((request) => request.url.startsWith("https://registry.modelcontextprotocol.io/"));
const warnings = (world: World): string[] => world.lines.filter((line) => line.startsWith("::warning"));
const MODES = [
  ["a rehearsal", true],
  ["a release", false],
] as const;

describe("an Open VSX namespace that does not exist is not set up (owner step O1)", () => {
  it.each(MODES)("%s: Open VSX is skipped (not set up), the run exits 0, the registry (after it) still runs, and the block, the annotation and the step summary name it", async (_label, dryRun) => {
    const world = newWorld();
    world.stores.namespace = NAMESPACE_ABSENT;
    expect(await world.run({ dryRun })).toBe(0);
    expect(world.report()).toContain(OPEN_VSX_SKIP);
    // In a rehearsal the registry runs after any `not ready` and the dry step never calls ovsx, so these three only observe a release.
    if (!dryRun) {
      expect(registryAsked(world), "the channel after it ran").toBe(true);
      expect(world.report()).not.toMatch(/mcp-registry\n.*: not attempted/);
      expect(world.standIns.calls("ovsx"), "nothing is uploaded to a namespace that does not exist").toEqual([]);
    }
    expect(world.report()).toContain("Skipped channels (not set up; run the release again once the owner step is done):\n  open-vsx: the Open VSX namespace iris-mcp does not exist.");
    expect(warnings(world)).toEqual(["::warning title=Channel skipped%2C not set up::open-vsx: the Open VSX namespace iris-mcp does not exist. Create it once with npx ovsx create-namespace iris-mcp (owner step O1)."]);
    expect(world.summaryText(), "the step summary carries the same block").toContain("Skipped channels (not set up");
    expect(world.summaryText()).toContain("  open-vsx: the Open VSX namespace iris-mcp does not exist.");
  });

  it("Open VSX alone does not block a release: it publishes the eight packages and the Marketplace, skips Open VSX, still runs the registry, and exits 0", async () => {
    const world = newWorld();
    world.stores.namespace = NAMESPACE_ABSENT;
    expect(await world.run()).toBe(0);
    expect(npmUploads(world)).toBe(NPM_PUBLISH_ORDER.length);
    expect(world.standIns.calls("vsce")).toHaveLength(1);
    expect(world.report()).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
    expect(world.report()).toContain(OPEN_VSX_SKIP);
    expect(world.report()).toContain("mcp-registry\n  io.github.jbrandtmse/iris-admin-mcp@1.0.0: already published");
  });
});

describe("a clean run lists nothing as skipped", () => {
  it.each(MODES)("%s with every channel set up: no `Skipped channels` block, no annotation, no step-summary block", async (_label, dryRun) => {
    const world = newWorld();
    expect(await world.run({ dryRun, channels: STORES_ONLY })).toBe(0);
    expect(world.report()).not.toContain("Skipped channels");
    expect(warnings(world)).toEqual([]);
    expect(world.summaryText()).not.toContain("Skipped channels");
    expect(world.summaryText()).toContain(dryRun ? "### Rehearsal 1.0.0" : "### Publish 1.0.0");
  });
});

describe("a channel that is set up and then fails still fails the run, and stops what follows (stop-on-failure unchanged)", () => {
  it.each(MODES)("%s: an Open VSX version lookup that cannot be read (HTTP 500) beside a present namespace is `not ready`/`failed`, exit 1, never `not set up`", async (_label, dryRun) => {
    const world = newWorld();
    world.stores.openVsx = { status: 500 };
    expect(await world.run({ dryRun })).toBe(1);
    expect(world.report()).toMatch(dryRun ? /open-vsx\n {2}iris-mcp-launcher@1\.0\.0: not ready \(could not ask open-vsx/ : /open-vsx\n {2}iris-mcp-launcher@1\.0\.0: failed \(could not ask open-vsx/);
    if (!dryRun) expect(world.report(), "stop-on-failure: what follows a failed channel is not attempted").toContain("mcp-registry\n  5 servers@1.0.0: not attempted");
    expect(world.report()).not.toContain("not set up");
    expect(world.report()).not.toContain("Skipped channels");
    expect(warnings(world)).toEqual([]);
  });

  it.each(MODES)("%s: an Open VSX namespace that cannot be read (HTTP 502) is not an absent namespace: exit 1", async (_label, dryRun) => {
    const world = newWorld();
    world.stores.namespace = { status: 502 };
    expect(await world.run({ dryRun })).toBe(1);
    expect(world.report()).toContain("could not be read (HTTP 502)");
    expect(world.report()).not.toContain("not set up");
    expect(warnings(world)).toEqual([]);
  });

  /** 404s that are not Open VSX's namespace answer: a proxy's HTML page, and the JSON Open VSX gives a path it does not route (GET 2026-11-21). */
  const OTHER_404S = [
    ["an HTML 404 page", { status: 404, contentType: "text/html; charset=utf-8", raw: "<!doctype html><title>404 Not Found</title>" }],
    ["Open VSX's 404 for a path it does not route", { status: 404, body: { timestamp: "2026-11-21T13:25:45.102Z", status: 404, error: "Not Found", path: "/api/iris-mcp" } }],
  ] as const;
  for (const [what, answer] of OTHER_404S) {
    it.each(MODES)(`%s: ${what} on the namespace URL is not "not set up": exit 1, nothing skipped`, async (_label, dryRun) => {
      const world = newWorld();
      world.stores.namespace = answer;
      expect(await world.run({ dryRun })).toBe(1);
      expect(world.report()).toContain("could not be read (HTTP 404, but not Open VSX's \"Namespace not found\" answer");
      expect(world.report()).not.toContain("not set up");
      expect(warnings(world)).toEqual([]);
      expect(world.standIns.calls("ovsx")).toEqual([]);
    });
  }

  it("a skip followed by a channel that fails: the release exits 1, and the skipped channel is still listed and annotated", async () => {
    const world = newWorld();
    world.stores.namespace = NAMESPACE_ABSENT;
    world.stores.mcpRegistry = () => ({ status: 500 });
    expect(await world.run()).toBe(1);
    expect(world.report()).toContain(OPEN_VSX_SKIP);
    expect(world.report()).toMatch(/mcp-registry\n {2}5 servers@1\.0\.0: failed \(/);
    expect(world.report()).toContain("Skipped channels (not set up; run the release again once the owner step is done):\n  open-vsx: the Open VSX namespace iris-mcp does not exist.");
    expect(warnings(world)).toHaveLength(1);
    expect(world.summaryText()).toContain("  open-vsx: the Open VSX namespace iris-mcp does not exist.");
  });

  it("an Open VSX namespace 200 that is not JSON (a captive-portal page) is not the namespace, nor an absent one: a release fails", async () => {
    const world = newWorld();
    world.stores.namespace = { status: 200, contentType: "text/html; charset=utf-8", raw: "<!doctype html><title>Sign in to the network</title>" };
    expect(await world.run()).toBe(1);
    expect(world.report()).toContain("not JSON, so it is not the store's answer");
    expect(world.report()).not.toContain("not set up");
  });

  it("a Marketplace upload that fails (vsce exits 1) fails the release; Open VSX, whose namespace is also absent, is `not attempted`, not skipped, and the block is empty", async () => {
    const world = newWorld();
    world.stores.namespace = NAMESPACE_ABSENT;
    world.standIns.script("vsce", [{ match: ["publish"], status: 1, stderr: "ERROR  The Personal Access Token verification has failed\n" }]);
    expect(await world.run()).toBe(1);
    expect(world.report()).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: failed (ERROR  The Personal Access Token verification has failed)");
    expect(world.report()).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");
    expect(world.report()).toContain("mcp-registry\n  5 servers@1.0.0: not attempted");
    expect(world.report()).not.toContain("Skipped channels");
    expect(warnings(world)).toEqual([]);
  });

  it("an Open VSX upload that fails after a present namespace (ovsx exits 1) fails the release, and the registry after it is not attempted", async () => {
    const world = newWorld();
    world.standIns.script("ovsx", [{ match: ["publish"], status: 1, stderr: "ERROR  Insufficient access rights to the namespace\n" }]);
    expect(await world.run()).toBe(1);
    expect(world.report()).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: failed (ERROR  Insufficient access rights to the namespace)");
    expect(world.report()).toContain("mcp-registry\n  5 servers@1.0.0: not attempted");
    expect(world.report()).not.toContain("not set up");
  });

  it.each(MODES)("%s: an Open VSX namespace that is absent beside an `ovsx` that is not installed is not ready/failed (exit 1): a missing CLI is never owner setup", async (_label, dryRun) => {
    const world = newWorld();
    world.stores.namespace = NAMESPACE_ABSENT;
    rmSync(path.join(world.repo, "extensions", "iris-mcp-launcher", "node_modules", ".bin", "ovsx"));
    expect(await world.run({ dryRun })).toBe(1);
    expect(world.report()).toMatch(/open-vsx\n {2}iris-mcp-launcher@1\.0\.0: (?:not ready|failed) \(ovsx is not installed in extensions\/iris-mcp-launcher\/node_modules/);
    expect(world.report()).not.toContain("not set up");
  });

  it("a vsix whose hash differs from the manifest fails before any channel runs, whatever is not set up: a rehearsal exits 1 and a release exits 2, with no skipped channel", async () => {
    for (const dryRun of [true, false]) {
      const world = newWorld();
      world.stores.namespace = NAMESPACE_ABSENT;
      writeFileSync(path.join(world.artifacts, "vsix", "iris-mcp-launcher-1.0.0.vsix"), "tampered\n");
      expect(await world.run({ dryRun }), dryRun ? "rehearsal" : "release").toBe(dryRun ? 1 : 2);
      expect(world.report()).toContain("does not match its sha256");
      expect(world.report()).not.toContain("Skipped channels");
      expect(world.standIns.calls("ovsx")).toEqual([]);
    }
  });
});

describe("npm is never skippable", () => {
  it.each(MODES)("%s: an npm publish that fails exits 1 and every other channel is `not attempted`, not skipped, even one that is not set up", async (_label, dryRun) => {
    const world = newWorld();
    world.stores.namespace = NAMESPACE_ABSENT;
    world.standIns.script("npm", [{ match: ["publish", "~iris-mcp-admin"], status: 1, stderr: "npm error code E403\n" }, ...NPM_DEFAULT]);
    expect(await world.run({ dryRun, channels: STORES_ONLY })).toBe(1);
    expect(world.report()).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: not attempted");
    expect(world.report()).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: not attempted");
    expect(world.report()).not.toContain("Skipped channels");
    expect(warnings(world)).toEqual([]);
  });

  it("an npm registry that cannot be asked (`npm view` fails with something other than E404) fails the run, whatever is not set up", async () => {
    const world = newWorld();
    world.stores.namespace = NAMESPACE_ABSENT;
    world.standIns.script("npm", [{ match: ["view"], status: 1, stderr: "npm error code ECONNRESET\nnpm error network aborted\n" }, ...NPM_DEFAULT]);
    expect(await world.run()).toBe(1);
    expect(world.report()).toContain("could not ask the registry whether it is published");
    expect(world.report()).not.toContain("Skipped channels");
    expect(world.report()).not.toContain("skipped (not set up");
  });
});

describe("a rerun of the same tag after the owner setup publishes the skipped channels", () => {
  it("run 1 publishes npm and the Marketplace and skips Open VSX; after the namespace exists, run 2 reads npm and the Marketplace `already published` and publishes Open VSX, with no skipped channel left", async () => {
    const world = newWorld();
    world.stores.namespace = NAMESPACE_ABSENT;
    expect(await world.run()).toBe(0);
    expect(npmUploads(world)).toBe(NPM_PUBLISH_ORDER.length);
    expect(world.report()).toContain("Skipped channels (not set up");

    // The owner step is done, and the first run's uploads are on the registries.
    world.stores.namespace = { status: 200, body: { extensions: {} } };
    world.stores.marketplace = marketplaceHit();
    world.standIns.script("npm", NPM_PUBLISHED);
    const uploadsBefore = npmUploads(world);
    world.lines.length = 0;
    expect(await world.run()).toBe(0);
    expect(npmUploads(world), "no npm upload on the rerun").toBe(uploadsBefore);
    for (const name of NPM_PUBLISH_ORDER) expect(world.report(), name).toContain(`${name}@1.0.0: already published`);
    expect(world.report()).toContain("vscode-marketplace\n  iris-mcp-launcher@1.0.0: already published");
    expect(world.report()).toContain("open-vsx\n  iris-mcp-launcher@1.0.0: published (auth: oidc)");
    expect(world.standIns.calls("ovsx")).toHaveLength(1);
    expect(world.standIns.calls("vsce"), "the Marketplace is not uploaded twice").toHaveLength(1);
    expect(world.report()).not.toContain("Skipped channels");
    expect(warnings(world)).toEqual([]);
  });
});
