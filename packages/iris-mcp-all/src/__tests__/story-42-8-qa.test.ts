/**
 * Story 42.8 QA (Rules #36, #54, #58, #59) -- gaps that the implement stage's pinning tests could not see:
 *
 *  1. `@iris-mcp/all` is never listed on the MCP Registry (decision #111): the real tree has a `server.json` and an `mcpName` for the five
 *     server packages and for nothing else.
 *  2. `gen:pack:check` and `gen:listings:check` go red on a drifted plugin file, a drifted listing and a stray file, run as the real
 *     scripts over a throwaway copy under `os.tmpdir()` (never the real tree). The in-memory `assemblePack` rows cannot say that the
 *     CHECK path of the script notices a hand edit.
 *  3. The lockstep, one field at a time, read FROM DISK: `readReleaseFacts` must read the right path of each of the 12 version-bearing
 *     fields (plugin.json, the marketplace `ref`, and `version` plus `packages[0].version` of each of five `server.json`). The existing
 *     rows mutate the facts AFTER they were read, so a reader that read the wrong field stayed green.
 *  4. Claude Code's own validator accepts the generated plugin and marketplace files (skipped where the `claude` CLI is not installed, so
 *     it is a local oracle, never a CI gate: spec Deferred item), run under a scratch `CLAUDE_CONFIG_DIR` and HOME and a non-repo cwd.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SERVER_PACKAGES } from "../../../../scripts/lib/listings.mjs";
import { SERVER_JSON_DIRS } from "../../../../scripts/lib/release-core.mjs";
import { embeddedVersionProblems, readReleaseFacts } from "../../../../scripts/release.mjs";
import { PACK_DIR } from "../../../../scripts/lib/skills-pack.mjs";
import { findExecutable } from "../../../../scripts/throwaway-iris.mjs";
import { REPO_ROOT } from "./pack-fixture";
import { makeVersionFixture, removeFixtures } from "./release-fixture";

afterAll(removeFixtures);

const readJson = (root: string, relative: string): any => JSON.parse(readFileSync(path.join(root, relative), "utf8"));
const writeJson = (root: string, relative: string, value: unknown): void => writeFileSync(path.join(root, relative), `${JSON.stringify(value, null, 2)}\n`);

// -- 1. @iris-mcp/all is never listed ---------------------------------------------------------------------------

describe("@iris-mcp/all is never listed on the MCP Registry (decision #111)", () => {
  const packages = readdirSync(path.join(REPO_ROOT, "packages"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  it("exactly the five server packages carry a server.json, and no other package directory does", () => {
    const withListing = packages.filter((dir) => existsSync(path.join(REPO_ROOT, "packages", dir, "server.json"))).sort();
    expect(withListing).toEqual([...SERVER_JSON_DIRS].sort());
    expect(existsSync(path.join(REPO_ROOT, "packages", "iris-mcp-all", "server.json"))).toBe(false);
  });

  it("exactly the same five packages declare an mcpName, and @iris-mcp/all declares none", () => {
    const withName = packages.filter((dir) => typeof readJson(REPO_ROOT, `packages/${dir}/package.json`).mcpName === "string").sort();
    expect(withName).toEqual([...SERVER_JSON_DIRS].sort());
    expect(readJson(REPO_ROOT, "packages/iris-mcp-all/package.json").name).toBe("@iris-mcp/all");
    expect(readJson(REPO_ROOT, "packages/iris-mcp-all/package.json").mcpName).toBeUndefined();
  });

  it("the generator lists the same five directories, and no listing names @iris-mcp/all, iris-mcp-all or a name that ends in -all", () => {
    expect((SERVER_PACKAGES as ReadonlyArray<{ dir: string; npm: string }>).map((entry) => entry.dir)).toEqual([...SERVER_JSON_DIRS]);
    const names: string[] = [];
    for (const dir of SERVER_JSON_DIRS as string[]) {
      const listing = readJson(REPO_ROOT, `packages/${dir}/server.json`);
      names.push(listing.name, listing.packages[0].identifier, listing.repository.subfolder);
      expect(listing.packages, dir).toHaveLength(1);
    }
    expect(names).toHaveLength(15);
    for (const name of names) expect(name, name).not.toMatch(/(^|[/@-])all($|[/@-])|iris-mcp-all/);
    // The plugin is the marketplace's only entry; the meta package is not a plugin either.
    expect(readJson(REPO_ROOT, ".claude-plugin/marketplace.json").plugins.map((entry: { name: string }) => entry.name)).toEqual(["iris-mcp"]);
  });
});

// -- 2. the generators' --check mode goes red on drift ----------------------------------------------------------

describe("gen:pack:check and gen:listings:check go red on drift, run as the real scripts over a throwaway copy", () => {
  let root = "";
  beforeAll(() => {
    root = makeVersionFixture({ version: "1.0.0", pending: false });
  }, 180_000);
  const script = (name: string, ...args: string[]): { status: number | null; text: string } => {
    const result = spawnSync(process.execPath, [path.join(root, "scripts", name), ...args], { cwd: root, encoding: "utf8", timeout: 120_000 });
    return { status: result.status, text: `${result.stdout}${result.stderr}` };
  };
  const pack = (): { status: number | null; text: string } => script("gen-pack.mjs", "--check");
  const listings = (): { status: number | null; text: string } => script("gen-listings.mjs", "--check");

  /** Apply `change`, run `check`, put every touched file back to its bytes, and prove the check is green again. */
  function drift(files: string[], change: () => void, check: () => { status: number | null; text: string }): { status: number | null; text: string } {
    const saved = files.map((file) => [file, existsSync(path.join(root, file)) ? readFileSync(path.join(root, file)) : null] as const);
    try {
      change();
      return check();
    } finally {
      for (const [file, bytes] of saved) {
        if (bytes === null) rmSync(path.join(root, file), { recursive: true, force: true });
        else writeFileSync(path.join(root, file), bytes);
      }
    }
  }

  const PLUGIN_FILE = `${PACK_DIR}/.claude-plugin/plugin.json`;
  const MCP_FILE = `${PACK_DIR}/.mcp.json`;
  const SOURCE_MCP = "skills-pack-src/plugin/mcp.json";
  const SERVER_FILE = "packages/iris-dev-mcp/server.json";
  const MARKETPLACE = ".claude-plugin/marketplace.json";

  it("control: on the untouched copy both checks pass", () => {
    expect(pack().status, pack().text).toBe(0);
    expect(listings().status, listings().text).toBe(0);
  }, 180_000);

  it("a hand edit of the pack's .mcp.json (one appended byte) is drift, and the file is named", () => {
    const result = drift([MCP_FILE], () => writeFileSync(path.join(root, MCP_FILE), `${readFileSync(path.join(root, MCP_FILE), "utf8")} `), pack);
    expect(result.status).toBe(1);
    expect(result.text).toContain(".mcp.json");
    expect(pack().status, "restored").toBe(0);
  }, 180_000);

  it("a hand edit of the pack's plugin.json (the description) is drift", () => {
    const result = drift([PLUGIN_FILE], () => writeJson(root, PLUGIN_FILE, { ...readJson(root, PLUGIN_FILE), description: "edited by hand" }), pack);
    expect(result.status).toBe(1);
    expect(result.text).toContain("plugin.json");
  }, 180_000);

  it("a change of the source skills-pack-src/plugin/mcp.json that was not regenerated is drift in .mcp.json", () => {
    const result = drift([SOURCE_MCP], () => writeFileSync(path.join(root, SOURCE_MCP), `${readFileSync(path.join(root, SOURCE_MCP), "utf8").replace('"dev"', '"dev2"')}`), pack);
    expect(result.status).toBe(1);
    expect(result.text).toContain(".mcp.json");
  }, 180_000);

  it("a file hand-placed in the plugin root (a hooks directory) is stray", () => {
    const hook = `${PACK_DIR}/hooks/hooks.json`;
    const result = drift(
      [hook, `${PACK_DIR}/hooks`],
      () => {
        mkdirSync(path.join(root, PACK_DIR, "hooks"), { recursive: true });
        writeFileSync(path.join(root, hook), "{}\n");
      },
      pack,
    );
    expect(result.status).toBe(1);
    expect(result.text).toContain("hooks");
    expect(pack().status, "restored").toBe(0);
  }, 180_000);

  it("a hand edit of a server.json (its description), of the marketplace ref (main), and a deleted server.json are each drift in gen:listings:check", () => {
    const edited = drift([SERVER_FILE], () => writeJson(root, SERVER_FILE, { ...readJson(root, SERVER_FILE), description: "edited" }), listings);
    expect(edited.status).toBe(1);
    expect(edited.text).toContain("iris-dev-mcp/server.json");

    const market = readJson(root, MARKETPLACE);
    const pinned = drift(
      [MARKETPLACE],
      () => {
        market.plugins[0].source.ref = "main";
        writeJson(root, MARKETPLACE, market);
      },
      listings,
    );
    expect(pinned.status).toBe(1);
    expect(pinned.text).toContain("marketplace.json");

    const missing = drift([SERVER_FILE], () => rmSync(path.join(root, SERVER_FILE)), listings);
    expect(missing.status).toBe(1);
    expect(missing.text).toContain("MISSING");
    expect(listings().status, "restored").toBe(0);
  }, 180_000);
});

// -- 3. the lockstep, read from disk, one field at a time -------------------------------------------------------

describe("embeddedVersionProblems over files on disk: each of the 12 version-bearing fields, drifted alone, is the only problem and is named", () => {
  let root = "";
  beforeAll(() => {
    root = makeVersionFixture({ version: "1.0.0", pending: false });
  }, 180_000);

  /** `[label, file, edit, expected message]`: the edit sets exactly one field to a version that is not the shared one. */
  const FIELDS: Array<[string, string, (listing: any) => void, RegExp]> = [
    ["plugin.json version", `${PACK_DIR}/.claude-plugin/plugin.json`, (listing) => (listing.version = "0.9.0"), /plugin\.json is at "0\.9\.0", not the shared version 1\.0\.0\. Run pnpm run version/],
    ["marketplace ref", ".claude-plugin/marketplace.json", (listing) => (listing.plugins[0].source.ref = "v0.9.0"), /marketplace\.json pins the ref "v0\.9\.0", not the release tag v1\.0\.0\. Run pnpm run version/],
    ...(SERVER_JSON_DIRS as string[]).flatMap((dir): Array<[string, string, (listing: any) => void, RegExp]> => [
      [`${dir} server.json version`, `packages/${dir}/server.json`, (listing) => (listing.version = "0.9.0"), new RegExp(`packages/${dir}/server\\.json version is "0\\.9\\.0", not the shared version 1\\.0\\.0`)],
      [`${dir} server.json packages[0].version`, `packages/${dir}/server.json`, (listing) => (listing.packages[0].version = "0.9.0"), new RegExp(`packages/${dir}/server\\.json packages\\[0\\]\\.version is "0\\.9\\.0", not the shared version 1\\.0\\.0`)],
    ]),
  ];

  it("the copy as seeded is consistent, and there are 12 fields", () => {
    expect(embeddedVersionProblems(readReleaseFacts(root))).toEqual([]);
    expect(FIELDS).toHaveLength(12);
  }, 180_000);

  it.each(FIELDS.map((field) => [field[0], field] as const))("%s", (_label, [, file, edit, expected]) => {
    const original = readFileSync(path.join(root, file));
    try {
      const listing = JSON.parse(original.toString("utf8"));
      edit(listing);
      writeJson(root, file, listing);
      const problems = embeddedVersionProblems(readReleaseFacts(root)) as string[];
      expect(problems, problems.join(" | ")).toHaveLength(1);
      expect(problems[0]).toMatch(expected);
    } finally {
      writeFileSync(path.join(root, file), original);
    }
    expect(embeddedVersionProblems(readReleaseFacts(root)), "restored").toEqual([]);
  }, 60_000);

  it("a listing file that is deleted, or that has no version field, is a problem too, never read as consistent", () => {
    const file = "packages/iris-ops-mcp/server.json";
    const original = readFileSync(path.join(root, file));
    try {
      rmSync(path.join(root, file));
      expect((embeddedVersionProblems(readReleaseFacts(root)) as string[]).join("\n")).toMatch(/iris-ops-mcp\/server\.json version is undefined/);
      writeFileSync(path.join(root, file), "{}\n");
      expect((embeddedVersionProblems(readReleaseFacts(root)) as string[]).length).toBeGreaterThanOrEqual(2);
    } finally {
      writeFileSync(path.join(root, file), original);
    }
  }, 60_000);
});

// -- 4. Claude Code's own validator (a local oracle) ------------------------------------------------------------

describe("Claude Code accepts the generated plugin and marketplace files (a local oracle: skipped where the claude CLI is not installed)", () => {
  const claude = findExecutable("claude", process.env["PATH"] ?? "");
  const validate = (target: string): { status: number | null; text: string } => {
    const scratch = mkdtempSync(path.join(tmpdir(), "claude-validate-"));
    try {
      // A scratch config dir and home, and a cwd that is not a repository: the user's ~/.claude is never read or written.
      const env = { PATH: process.env["PATH"] ?? "", HOME: path.join(scratch, "home"), CLAUDE_CONFIG_DIR: path.join(scratch, "config"), TMPDIR: scratch };
      mkdirSync(env.HOME);
      const result = spawnSync(claude as string, ["plugin", "validate", target], { cwd: scratch, env, encoding: "utf8", timeout: 120_000 });
      return { status: result.status, text: `${result.stdout}${result.stderr}` };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };

  it.skipIf(claude === undefined)("`claude plugin validate` passes on the plugin root and on the repository's marketplace", () => {
    const plugin = validate(path.join(REPO_ROOT, PACK_DIR));
    expect(plugin.status, plugin.text).toBe(0);
    expect(plugin.text).toContain("Validation passed");
    const marketplace = validate(REPO_ROOT);
    expect(marketplace.status, marketplace.text).toBe(0);
    expect(marketplace.text).toContain("Validation passed");
  }, 240_000);

  it.skipIf(claude === undefined)("the oracle can fail: the same validator refuses a plugin.json that names itself `claude-helper`", () => {
    const scratch = mkdtempSync(path.join(tmpdir(), "claude-validate-copy-"));
    try {
      const copy = path.join(scratch, "plugin");
      mkdirSync(path.join(copy, ".claude-plugin"), { recursive: true });
      const manifest = readJson(REPO_ROOT, `${PACK_DIR}/.claude-plugin/plugin.json`);
      writeFileSync(path.join(copy, ".claude-plugin", "plugin.json"), `${JSON.stringify({ ...manifest, name: "claude-helper" }, null, 2)}\n`);
      const refused = validate(copy);
      expect(refused.status, refused.text).not.toBe(0);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 240_000);
});
