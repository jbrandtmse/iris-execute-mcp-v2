/**
 * Shared-file ownership is per FILE (Story 44.2 rework, DW-733; AD-15, AD-30).
 *
 * The ownership ledger used to be keyed `(client, scope, name)` with no file, so a vscode record from project A counted as a
 * sharing owner in project B's `.mcp.json`, and a claude-code mode change in B (where VS Code was never configured) was refused
 * as "shared with vscode". Every ledger record now carries the resolved config path (an additive optional field), and the
 * shared-file rule counts a peer's record only when its path is the same file.
 *
 * The process half drives the BUILT bin (`dist/cli/clients-cli.js`) as a child process with a scratch HOME and two project
 * directories. Oracles (Rule #36):
 * - the first claude-code apply in a project is compared with `claude-code-shared-oracle-pre-44-2.json`, captured from the
 *   pre-story tree (the bytes a pre-44.2 claude-code wrote);
 * - a claude-code mode change is compared with the same steps in a world where VS Code was never used (a mode change over a
 *   recorded entry is not in the captured oracle; the world with no vscode record is, by the Boundaries' back-compat bound,
 *   what pre-44.2 claude-code did).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { dropRemovedShared, ownerClients, recordAdoptedOwners, recordingClients, soleOwner, sharedPeers } from "../shared-files.js";
import { addStash, dropManaged, findStash, isManagerCreated, readState, recordManaged, type ManagerState } from "../state.js";
import { CLIENT_ADAPTERS } from "../adapters.js";

import { MemFs, readFixture } from "./helpers.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "dist", "cli", "clients-cli.js");
const T = 120_000;

interface Oracle {
  fixtures: Record<string, string>;
  scenarios: Record<string, { apply: { exit: number; file: string | null }; applyAgain: { exit: number; file: string | null } }>;
}
const ORACLE = JSON.parse(readFixture("claude-code-shared-oracle-pre-44-2.json")) as Oracle;
const COMPACT: string = ORACLE.fixtures.compact ?? failFixture("compact");
function failFixture(name: string): never {
  throw new Error(`the pre-44.2 oracle has no "${name}" fixture`);
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface World {
  home: string;
  a: string;
  b: string;
  stateFile: string;
  run: (cwd: string, args: string[], extraEnv?: Record<string, string>) => Run;
}

const made: string[] = [];
afterEach(() => {
  while (made.length > 0) rmSync(made.pop() as string, { recursive: true, force: true });
});

/** A scratch HOME with two project directories A and B (all resolved through `realpath`; the home guard compares real paths). */
function makeWorld(): World {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "po442-home-")));
  const a = realpathSync(mkdtempSync(path.join(tmpdir(), "po442-a-")));
  const b = realpathSync(mkdtempSync(path.join(tmpdir(), "po442-b-")));
  made.push(home, a, b);
  const run: World["run"] = (cwd, args, extraEnv = {}) => {
    const result = spawnSync(process.execPath, [BIN, ...args], {
      cwd,
      env: {
        PATH: process.env.PATH ?? "",
        PATHEXT: process.env.PATHEXT ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        windir: process.env.windir ?? "",
        TEMP: process.env.TEMP ?? "",
        TMP: process.env.TMP ?? "",
        TMPDIR: process.env.TMPDIR ?? "",
        HOME: home,
        USERPROFILE: home,
        APPDATA: path.join(home, "AppData", "Roaming"),
        IRIS_SERVER_MANAGER: "auto",
        ...extraEnv,
      },
      encoding: "utf8",
      input: "",
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  return { home, a, b, stateFile: path.join(home, ".iris-mcp", "client-manager", "state.json"), run };
}

const APPLY = (client: string, mode: string): string[] => [
  "apply", "--client", client, "--scope", "project", "--servers", "iris-dev-mcp", "--mode", mode, "--yes", "--json",
];
const REMOVE = (client: string): string[] => ["remove", "--client", client, "--scope", "project", "--server", "iris-dev-mcp", "--json"];

const mcpJson = (dir: string): string => path.join(dir, ".mcp.json");
const seedMcp = (dir: string, text: string): void => writeFileSync(mcpJson(dir), text);

interface Ledger {
  entries: { client: string; scope: string; name: string; path?: string }[];
  stashes: { client: string; scope: string; name: string; path?: string }[];
}
const ledger = (world: World): Ledger => JSON.parse(readFileSync(world.stateFile, "utf8")) as Ledger;

/** The steps of a mode change in project B for `client`: first apply in env-reference mode, then a change to server-manager. */
function modeChangeInB(world: World, client: string): { first: Run; change: Run; file: string } {
  seedMcp(world.b, COMPACT);
  const first = world.run(world.b, APPLY(client, "env-reference"));
  const change = world.run(world.b, APPLY(client, "server-manager"));
  return { first, change, file: readFileSync(mcpJson(world.b), "utf8") };
}

describe("DW-733: a record of another project's .mcp.json is not a sharing owner (built CLI, scratch HOME)", () => {
  it("vscode in project A, then a claude-code mode change in project B: exit 0, and the bytes pre-44.2 claude-code wrote", () => {
    const world = makeWorld();
    expect(world.run(world.a, APPLY("vscode", "env-reference")).status).toBe(0);

    const { first, change, file } = modeChangeInB(world, "claude-code");
    // The first apply exits as the pre-story oracle's `apply` on the compact fixture does (its bytes are pinned below).
    expect(first.status).toBe(ORACLE.scenarios.compact?.apply.exit);
    // (the oracle's apply runs in env-reference mode on a file that held only the fixture)
    expect(change.status, change.stdout + change.stderr).toBe(0);
    expect(change.stderr).not.toContain("shared with");

    // The same two steps in a world where VS Code was never used.
    const control = makeWorld();
    const expected = modeChangeInB(control, "claude-code");
    expect(expected.change.status).toBe(0);
    expect(file).toBe(expected.file);
    expect(file).toContain("IRIS_SERVER_MANAGER");

    // Project A's vscode entry is untouched.
    expect(readFileSync(mcpJson(world.a), "utf8")).toContain("iris-dev-mcp");
    // The ledger keeps one record per file for the two clients.
    const records = ledger(world).entries.map((entry) => `${entry.client}:${path.basename(path.dirname(entry.path ?? ""))}`).sort();
    expect(records).toEqual([`claude-code:${path.basename(world.b)}`, `vscode:${path.basename(world.a)}`]);
  }, T);

  it("the first claude-code apply in a project is the pre-story oracle's bytes", () => {
    const world = makeWorld();
    expect(world.run(world.a, APPLY("vscode", "env-reference")).status).toBe(0);
    seedMcp(world.b, COMPACT);
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(ORACLE.scenarios.compact?.apply.file);
  }, T);

  it("a claude-code re-apply over its own recorded entry in project B is the pre-story oracle's applyAgain bytes", () => {
    const world = makeWorld();
    expect(world.run(world.a, APPLY("vscode", "env-reference")).status).toBe(0);
    seedMcp(world.b, COMPACT);
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    // The second apply goes through the shared-file rule: a vscode record counted here would adopt and write nothing.
    const again = world.run(world.b, APPLY("claude-code", "env-reference"));
    expect(again.status).toBe(ORACLE.scenarios.compact?.applyAgain.exit);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(ORACLE.scenarios.compact?.applyAgain.file);
  }, T);

  it("the other direction: claude-code in project A, then a vscode mode change in project B, exit 0 and what vscode writes alone", () => {
    const world = makeWorld();
    expect(world.run(world.a, APPLY("claude-code", "env-reference")).status).toBe(0);
    const { change, file } = modeChangeInB(world, "vscode");
    expect(change.status, change.stdout + change.stderr).toBe(0);

    const control = makeWorld();
    const expected = modeChangeInB(control, "vscode");
    expect(expected.change.status).toBe(0);
    expect(file).toBe(expected.file);
  }, T);

  it("a vscode record in project A does not make vscode the sole owner of an entry claude-code wrote in project B", () => {
    const world = makeWorld();
    expect(world.run(world.a, APPLY("vscode", "env-reference")).status).toBe(0);
    // Project B: claude-code writes the entry (its ledger record is for B).
    seedMcp(world.b, COMPACT);
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    const before = readFileSync(mcpJson(world.b), "utf8");
    // vscode in B with a different mode is a conflict in B (claude-code owns it there), whatever vscode recorded in A.
    const refused = world.run(world.b, APPLY("vscode", "server-manager"));
    expect(refused.status).toBe(1);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(before);
    // With the same mode it is adopted.
    expect(world.run(world.b, APPLY("vscode", "env-reference")).status).toBe(0);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(before);
  }, T);

  it("vscode's records for project A and project B both survive: claude-code is still refused a different entry in A", () => {
    const world = makeWorld();
    seedMcp(world.a, COMPACT);
    expect(world.run(world.a, APPLY("vscode", "env-reference")).status).toBe(0);
    expect(world.run(world.b, APPLY("vscode", "env-reference")).status).toBe(0);
    expect(ledger(world).entries.map((entry) => entry.path).sort()).toEqual([mcpJson(world.a), mcpJson(world.b)].sort());
    const before = readFileSync(mcpJson(world.a), "utf8");
    const refused = world.run(world.a, APPLY("claude-code", "server-manager"));
    expect(refused.status, refused.stdout + refused.stderr).toBe(1);
    expect(readFileSync(mcpJson(world.a), "utf8")).toBe(before);
  }, T);

  it("a pre-44.2 vscode project record (no path) does not block claude-code in any project", () => {
    const world = makeWorld();
    seedMcp(world.b, COMPACT);
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    const state = ledger(world);
    // A pre-44.2 state file: no record has a path, and a vscode project record from the old .vscode/mcp.json exists.
    const preStory = {
      version: 1,
      entries: [
        ...state.entries.map(({ path: _dropped, ...rest }) => rest),
        { client: "vscode", scope: "project", name: "iris-dev-mcp", containsSecret: false, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" },
      ],
      stashes: [],
    };
    writeFileSync(world.stateFile, JSON.stringify(preStory, null, 2) + "\n");
    expect(preStory.entries.every((entry) => !("path" in entry))).toBe(true);

    const change = world.run(world.b, APPLY("claude-code", "server-manager"));
    expect(change.status, change.stdout + change.stderr).toBe(0);

    const control = makeWorld();
    expect(modeChangeInB(control, "claude-code").change.status).toBe(0);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(readFileSync(mcpJson(control.b), "utf8"));
    // The refreshed claude-code record now carries its path; the old vscode record is left as it was.
    const after = ledger(world);
    expect(after.entries.find((entry) => entry.client === "claude-code")?.path).toBe(mcpJson(world.b));
    expect(after.entries.find((entry) => entry.client === "vscode")?.path).toBeUndefined();
  }, T);

  it("a pre-44.2 claude-code record (no path): vscode adopts the entry, and a later different vscode write is still refused", () => {
    const world = makeWorld();
    seedMcp(world.b, COMPACT);
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    const state = ledger(world);
    writeFileSync(world.stateFile, JSON.stringify({ version: 1, entries: state.entries.map(({ path: _dropped, ...rest }) => rest), stashes: [] }) + "\n");
    const before = readFileSync(mcpJson(world.b), "utf8");

    const adopted = world.run(world.b, APPLY("vscode", "env-reference"));
    expect(adopted.status, adopted.stdout + adopted.stderr).toBe(0);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(before);
    // The adoption gives claude-code a record for this file; its pathless record stays.
    const records = ledger(world).entries.map((entry) => `${entry.client}:${entry.path === undefined ? "-" : path.basename(path.dirname(entry.path))}`);
    expect(records.sort()).toEqual(["claude-code:-", `claude-code:${path.basename(world.b)}`, `vscode:${path.basename(world.b)}`].sort());

    const refused = world.run(world.b, APPLY("vscode", "server-manager"));
    expect(refused.status, refused.stdout + refused.stderr).toBe(1);
    expect(refused.stdout + refused.stderr).toContain("shared with claude-code");
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(before);
  }, T);

  it("a pre-44.2 claude-code record that a claude-code write in project B turned into B's: vscode adopts in A, and a later different vscode write in A is still refused", () => {
    const world = makeWorld();
    seedMcp(world.a, COMPACT);
    seedMcp(world.b, COMPACT);
    expect(world.run(world.a, APPLY("claude-code", "env-reference")).status).toBe(0);
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    // The pre-44.2 shape: one record of the name, with no path, standing for both projects.
    const state = ledger(world);
    writeFileSync(world.stateFile, JSON.stringify({ version: 1, entries: state.entries.slice(0, 1).map(({ path: _dropped, ...rest }) => rest), stashes: [] }) + "\n");
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    expect(ledger(world).entries.map((entry) => entry.path)).toEqual([mcpJson(world.b)]);
    const before = readFileSync(mcpJson(world.a), "utf8");

    const adopted = world.run(world.a, APPLY("vscode", "env-reference"));
    expect(adopted.status, adopted.stdout + adopted.stderr).toBe(0);
    expect(readFileSync(mcpJson(world.a), "utf8")).toBe(before);
    const refused = world.run(world.a, APPLY("vscode", "server-manager"));
    expect(refused.status, refused.stdout + refused.stderr).toBe(1);
    expect(refused.stdout + refused.stderr).toContain("shared with claude-code");
    expect(readFileSync(mcpJson(world.a), "utf8")).toBe(before);
  }, T);

  it("an entry claude-code owns with no record at all (a lost state file): vscode adopts it, and a later different vscode write is still refused", () => {
    const world = makeWorld();
    seedMcp(world.b, COMPACT);
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    rmSync(world.stateFile);
    const before = readFileSync(mcpJson(world.b), "utf8");

    const adopted = world.run(world.b, APPLY("vscode", "env-reference"));
    expect(adopted.status, adopted.stdout + adopted.stderr).toBe(0);
    expect(ledger(world).entries.map((entry) => `${entry.client}:${entry.path}`).sort()).toEqual([`claude-code:${mcpJson(world.b)}`, `vscode:${mcpJson(world.b)}`]);
    const refused = world.run(world.b, APPLY("vscode", "server-manager"));
    expect(refused.status, refused.stdout + refused.stderr).toBe(1);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(before);
  }, T);

  it("a pre-44.2 claude-code stash enabled by adopting vscode's equal entry: claude-code records the file, and a later different vscode write is refused", () => {
    const world = makeWorld();
    seedMcp(world.b, COMPACT);
    const toggle = (verb: string): Run => world.run(world.b, [verb, "--client", "claude-code", "--scope", "project", "--server", "iris-dev-mcp", "--json"]);
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    expect(toggle("disable").status).toBe(0);
    const state = ledger(world);
    writeFileSync(world.stateFile, JSON.stringify({ version: 1, entries: state.entries.map(({ path: _dropped, ...rest }) => rest), stashes: state.stashes.map(({ path: _dropped, ...rest }) => rest) }) + "\n");
    expect(world.run(world.b, APPLY("vscode", "env-reference")).status).toBe(0);
    const before = readFileSync(mcpJson(world.b), "utf8");

    const enabled = toggle("enable");
    expect(enabled.status, enabled.stdout + enabled.stderr).toBe(0);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(before);
    expect(ledger(world).entries.some((entry) => entry.client === "claude-code" && entry.path === mcpJson(world.b))).toBe(true);
    const refused = world.run(world.b, APPLY("vscode", "server-manager"));
    expect(refused.status, refused.stdout + refused.stderr).toBe(1);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(before);
  }, T);

  it("an old state file without any path parses and behaves as before: claude-code applies, disables, enables and removes", () => {
    const world = makeWorld();
    seedMcp(world.b, COMPACT);
    mkdirSync(path.dirname(world.stateFile), { recursive: true });
    writeFileSync(
      world.stateFile,
      JSON.stringify({
        version: 1,
        entries: [{ client: "claude-code", scope: "project", name: "iris-dev-mcp", containsSecret: false, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }],
        stashes: [],
      }),
    );
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    for (const verb of ["disable", "enable"]) {
      const result = world.run(world.b, [verb, "--client", "claude-code", "--scope", "project", "--server", "iris-dev-mcp", "--json"]);
      expect(result.status, `${verb}: ${result.stdout}${result.stderr}`).toBe(0);
    }
    expect(world.run(world.b, REMOVE("claude-code")).status).toBe(0);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(COMPACT);
  }, T);
});

describe("a genuinely shared file (both clients, one project) still adopts an equal entry and refuses a differing one", () => {
  it("claude-code first: vscode adopts the same mode and is refused a different one, nothing written on the refusal", () => {
    const world = makeWorld();
    seedMcp(world.a, COMPACT);
    expect(world.run(world.a, APPLY("claude-code", "env-reference")).status).toBe(0);
    const before = readFileSync(mcpJson(world.a), "utf8");

    const adopted = world.run(world.a, APPLY("vscode", "env-reference"));
    expect(adopted.status, adopted.stdout + adopted.stderr).toBe(0);
    expect(readFileSync(mcpJson(world.a), "utf8")).toBe(before);
    expect(ledger(world).entries.map((entry) => entry.client).sort()).toEqual(["claude-code", "vscode"]);

    const refused = world.run(world.a, APPLY("vscode", "server-manager"));
    expect(refused.status).toBe(1);
    expect(refused.stdout + refused.stderr).toContain("shared with");
    expect(readFileSync(mcpJson(world.a), "utf8")).toBe(before);
  }, T);

  it("vscode first: claude-code adopts the same mode and is refused a different one, nothing written on the refusal", () => {
    const world = makeWorld();
    seedMcp(world.a, COMPACT);
    expect(world.run(world.a, APPLY("vscode", "env-reference")).status).toBe(0);
    const before = readFileSync(mcpJson(world.a), "utf8");

    const adopted = world.run(world.a, APPLY("claude-code", "env-reference"));
    expect(adopted.status, adopted.stdout + adopted.stderr).toBe(0);
    expect(readFileSync(mcpJson(world.a), "utf8")).toBe(before);

    const refused = world.run(world.a, APPLY("claude-code", "server-manager"));
    expect(refused.status).toBe(1);
    expect(refused.stdout + refused.stderr).toContain("shared with");
    expect(readFileSync(mcpJson(world.a), "utf8")).toBe(before);
  }, T);

  it("DW-735: the peer's manager record does not outlive a shared-file remove", () => {
    const world = makeWorld();
    seedMcp(world.a, COMPACT);
    expect(world.run(world.a, APPLY("claude-code", "env-reference")).status).toBe(0);
    expect(world.run(world.a, APPLY("vscode", "env-reference")).status).toBe(0);
    expect(ledger(world).entries.map((entry) => entry.client).sort()).toEqual(["claude-code", "vscode"]);

    const removed = world.run(world.a, REMOVE("claude-code"));
    expect(removed.status, removed.stdout + removed.stderr).toBe(0);
    expect(readFileSync(mcpJson(world.a), "utf8")).toBe(COMPACT);
    expect(ledger(world).entries).toEqual([]);

    // With no record left, claude-code's later write is a fresh entry, and a vscode write of a different mode conflicts with it.
    expect(world.run(world.a, APPLY("claude-code", "server-manager")).status).toBe(0);
    const refused = world.run(world.a, APPLY("vscode", "env-reference"));
    expect(refused.status).toBe(1);
  }, T);

  it("a claude-code remove in project B leaves its record for project A, so vscode in A is still refused a different entry", () => {
    const world = makeWorld();
    seedMcp(world.a, COMPACT);
    expect(world.run(world.a, APPLY("claude-code", "env-reference")).status).toBe(0);
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    expect(world.run(world.a, APPLY("vscode", "env-reference")).status).toBe(0);
    const before = readFileSync(mcpJson(world.a), "utf8");

    expect(world.run(world.b, REMOVE("claude-code")).status).toBe(0);
    const records = ledger(world).entries.map((entry) => `${entry.client}:${entry.path}`).sort();
    expect(records).toEqual([`claude-code:${mcpJson(world.a)}`, `vscode:${mcpJson(world.a)}`].sort());

    const refused = world.run(world.a, APPLY("vscode", "server-manager"));
    expect(refused.status, refused.stdout + refused.stderr).toBe(1);
    expect(readFileSync(mcpJson(world.a), "utf8")).toBe(before);
  }, T);

  it("stashes are kept per file: a disable in project B does not replace project A's stash, and A's enable restores A", () => {
    const world = makeWorld();
    seedMcp(world.a, COMPACT);
    expect(world.run(world.a, APPLY("claude-code", "env-reference")).status).toBe(0);
    expect(world.run(world.b, APPLY("claude-code", "server-manager")).status).toBe(0);
    const beforeA = readFileSync(mcpJson(world.a), "utf8");
    const toggle = (verb: string, dir: string): Run => world.run(dir, [verb, "--client", "claude-code", "--scope", "project", "--server", "iris-dev-mcp", "--json"]);

    // B first: a lookup that ignored the file would find B's server-manager stash before A's.
    expect(toggle("disable", world.b).status).toBe(0);
    expect(toggle("disable", world.a).status).toBe(0);
    // Unsorted on purpose: the ledger lists B's stash first, so a lookup that ignored the file would find it.
    expect(ledger(world).stashes.map((stash) => stash.path)).toEqual([mcpJson(world.b), mcpJson(world.a)]);
    const enabled = toggle("enable", world.a);
    expect(enabled.status, enabled.stdout + enabled.stderr).toBe(0);
    expect(readFileSync(mcpJson(world.a), "utf8")).toBe(beforeA);
    expect(ledger(world).stashes.map((stash) => stash.path)).toEqual([mcpJson(world.b)]);
  }, T);
});

describe("the other per-file ledger consumers (built CLI, scratch HOME)", () => {
  const RESTORE = ["restore", "--client", "claude-code", "--scope", "project", "--json"];
  const sharedWith = (run: Run): string[] | undefined => (JSON.parse(run.stdout) as { data: { sharedWith?: string[] } }).data.sharedWith;

  it("a claude-code restore names vscode as a reader only when vscode records this project's file", () => {
    const world = makeWorld();
    // vscode's record is for project A; claude-code writes (and so backs up) project B's file.
    expect(world.run(world.a, APPLY("vscode", "env-reference")).status).toBe(0);
    seedMcp(world.b, COMPACT);
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    const elsewhere = world.run(world.b, RESTORE);
    expect(elsewhere.status, elsewhere.stdout + elsewhere.stderr).toBe(0);
    expect(sharedWith(elsewhere)).toBeUndefined();

    // Once vscode records project B's file too, the same restore names it.
    seedMcp(world.b, COMPACT);
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    expect(world.run(world.b, APPLY("vscode", "env-reference")).status).toBe(0);
    const here = world.run(world.b, RESTORE);
    expect(here.status, here.stdout + here.stderr).toBe(0);
    expect(sharedWith(here)).toEqual(["vscode"]);
  }, T);

  it("doctor --repair records the unrecorded entry of a shared .mcp.json with that file's path, and a second doctor finds nothing", () => {
    const world = makeWorld();
    seedMcp(world.b, JSON.stringify({ mcpServers: { "iris-dev-mcp2": { command: "npx", args: ["-y", "@iris-mcp/dev@1"] } } }, null, 2));
    const found = world.run(world.b, ["doctor", "--json"]);
    expect(found.stdout).toContain("unrecorded-entries");

    const repaired = world.run(world.b, ["doctor", "--repair", "--yes-i-mean-it", "--json"]);
    expect(repaired.status, repaired.stdout + repaired.stderr).toBe(0);
    const records = ledger(world).entries.filter((entry) => entry.name === "iris-dev-mcp2");
    expect(records.map((entry) => entry.path)).toEqual([mcpJson(world.b)]);

    const again = world.run(world.b, ["doctor", "--json"]);
    expect(again.stdout).not.toContain("unrecorded-entries");
  }, T);

  it("a name outside the iris-mcp namespace repaired in project A is not owned in project B: remove and disable there are refused, B is unchanged, and doctor in B reports it", () => {
    const world = makeWorld();
    seedMcp(world.a, JSON.stringify({ mcpServers: { "iris-dev-mcp2": { command: "npx", args: ["-y", "@iris-mcp/dev@1"] } } }, null, 2));
    expect(world.run(world.a, ["doctor", "--repair", "--yes-i-mean-it", "--json"]).status).toBe(0);
    seedMcp(world.b, JSON.stringify({ mcpServers: { "iris-dev-mcp2": { command: "node", args: ["my-own-server.js"] } } }, null, 2));
    const before = readFileSync(mcpJson(world.b), "utf8");

    for (const verb of ["remove", "disable"]) {
      const refused = world.run(world.b, [verb, "--client", "claude-code", "--scope", "project", "--server", "iris-dev-mcp2", "--json"]);
      expect(refused.status, `${verb}: ${refused.stdout}${refused.stderr}`).toBe(1);
      expect(refused.stdout + refused.stderr).toContain("outside the iris-mcp namespace");
      expect(readFileSync(mcpJson(world.b), "utf8")).toBe(before);
    }
    expect(world.run(world.b, ["doctor", "--json"]).stdout).toContain("unrecorded-entries");
    expect(ledger(world).entries.filter((entry) => entry.name === "iris-dev-mcp2").map((entry) => entry.path)).toEqual([mcpJson(world.a)]);
  }, T);
});

/** An `enable` or `disable` of the one server for `client` in project scope. */
const TOGGLE = (verb: string, client: string): string[] => [verb, "--client", client, "--scope", "project", "--server", "iris-dev-mcp", "--json"];

/** The state file as a pre-44.2 install wrote it: no record or stash names its file. */
function writePathlessState(world: World, extraStashes: unknown[] = []): void {
  const state = ledger(world);
  writeFileSync(
    world.stateFile,
    JSON.stringify({ version: 1, entries: state.entries.map(({ path: _dropped, ...rest }) => rest), stashes: [...state.stashes.map(({ path: _dropped, ...rest }) => rest), ...extraStashes] }) + "\n",
  );
}

describe("DW-742: an enable in the shared .mcp.json records the enabler for the file (built CLI, scratch HOME)", () => {
  const EMPTY = '{\n  "mcpServers": {}\n}\n';
  const OLD = "2026-08-01T00:00:00.000Z";

  // Lead matrix E5. Captured from the built CLI of the pre-fix tree: the enable exited 0 and recorded nobody, and the
  // later vscode write exited 0 with changed:1 over claude-code's entry.
  it("E5: a pre-44.2 claude-code record plus a pathless vscode stash of its entry; vscode enable, then a different vscode write is refused", () => {
    const world = makeWorld();
    seedMcp(world.b, EMPTY);
    expect(world.run(world.b, APPLY("claude-code", "server-manager")).status).toBe(0);
    const entry = (JSON.parse(readFileSync(mcpJson(world.b), "utf8")) as { mcpServers: Record<string, unknown> }).mcpServers["iris-dev-mcp"];
    writePathlessState(world, [{ client: "vscode", scope: "project", name: "iris-dev-mcp", entry, disabledAt: OLD }]);
    const before = readFileSync(mcpJson(world.b), "utf8");

    const enabled = world.run(world.b, TOGGLE("enable", "vscode"));
    expect(enabled.status, enabled.stdout + enabled.stderr).toBe(0);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(before);
    // The adoption gives claude-code, the pre-sharing writer that owns the entry, a record of this file, and vscode one too.
    const here = ledger(world).entries.filter((record) => record.path === mcpJson(world.b)).map((record) => record.client).sort();
    expect(here).toEqual(["claude-code", "vscode"]);

    const refused = world.run(world.b, APPLY("vscode", "env-reference"));
    expect(refused.status, refused.stdout + refused.stderr).toBe(1);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(before);
  }, T);

  // Lead matrix E6. Captured from the pre-fix tree: the stash was put back with no record of the file, and a claude-code
  // write of a different entry then exited 0 over vscode's entry.
  it("E6: a pathless vscode record and stash put back into an empty .mcp.json; a different claude-code write is refused", () => {
    const world = makeWorld();
    seedMcp(world.b, EMPTY);
    expect(world.run(world.b, APPLY("vscode", "server-manager")).status).toBe(0);
    const entry = (JSON.parse(readFileSync(mcpJson(world.b), "utf8")) as { mcpServers: Record<string, unknown> }).mcpServers["iris-dev-mcp"];
    seedMcp(world.b, EMPTY);
    mkdirSync(path.dirname(world.stateFile), { recursive: true });
    writeFileSync(
      world.stateFile,
      JSON.stringify({
        version: 1,
        entries: [{ client: "vscode", scope: "project", name: "iris-dev-mcp", containsSecret: false, createdAt: OLD, updatedAt: OLD }],
        stashes: [{ client: "vscode", scope: "project", name: "iris-dev-mcp", entry, disabledAt: OLD }],
      }) + "\n",
    );

    const enabled = world.run(world.b, TOGGLE("enable", "vscode"));
    expect(enabled.status, enabled.stdout + enabled.stderr).toBe(0);
    const before = readFileSync(mcpJson(world.b), "utf8");
    expect(before).toContain("iris-dev-mcp");
    expect(ledger(world).entries.some((record) => record.client === "vscode" && record.path === mcpJson(world.b))).toBe(true);

    const refused = world.run(world.b, APPLY("claude-code", "env-reference"));
    expect(refused.status, refused.stdout + refused.stderr).toBe(1);
    expect(readFileSync(mcpJson(world.b), "utf8")).toBe(before);
  }, T);

  it("a client's ordinary disable then enable of its own entry (per-file records) adds no record for the other client", () => {
    const world = makeWorld();
    seedMcp(world.b, COMPACT);
    expect(world.run(world.b, APPLY("claude-code", "env-reference")).status).toBe(0);
    expect(world.run(world.b, TOGGLE("disable", "claude-code")).status).toBe(0);
    expect(world.run(world.b, TOGGLE("enable", "claude-code")).status).toBe(0);
    expect(ledger(world).entries.map((record) => `${record.client}:${record.path}`)).toEqual([`claude-code:${mcpJson(world.b)}`]);
  }, T);
});

describe("DW-743: only the claude-code and vscode project scopes share a file, whatever the working directory (built CLI, scratch HOME)", () => {
  const IRIS_ENV = { IRIS_HOST: "127.0.0.1", IRIS_PORT: "9", IRIS_USERNAME: "u", IRIS_NAMESPACE: "USER" };
  const userClients = Object.values(CLIENT_ADAPTERS)
    .filter((adapter) => adapter.scopes.some((scope) => scope.scope === "user"))
    .map((adapter) => adapter.id);

  /** A user-scope apply, then a mode change, from `cwdOf(world)`, with the ledger as `state` leaves it. */
  function sequence(id: string, state: "per-file" | "pathless" | "none", cwdOf: (world: World) => string): { first: number | null; change: number | null; out: string } {
    const world = makeWorld();
    const gov = path.join(world.a, "governance.json");
    writeFileSync(gov, "{}\n");
    const cwd = cwdOf(world);
    const user = (extra: string[]): string[] => ["apply", "--client", id, "--scope", "user", "--servers", "iris-dev-mcp", ...extra, "--yes", "--json"];
    const first = world.run(cwd, user([]), IRIS_ENV);
    if (state === "pathless") writePathlessState(world);
    if (state === "none") rmSync(world.stateFile, { force: true });
    const change = world.run(cwd, user(["--mode", "governance-file", "--governance-file", gov]), IRIS_ENV);
    return { first: first.status, change: change.status, out: change.stdout + change.stderr };
  }

  // Lead matrix E3. The pre-fix tree exited 1 from HOME ("the file is shared with another client") for cursor, codex, gemini,
  // kimi-code and jetbrains-junie with pathless or no state, and 0 from any other directory.
  for (const id of userClients) {
    it(`${id}: a user-scope apply and a mode change from HOME exit exactly as from another directory (per-file, pathless and no state)`, () => {
      for (const state of ["per-file", "pathless", "none"] as const) {
        const fromHome = sequence(id, state, (world) => world.home);
        const elsewhere = sequence(id, state, (world) => world.b);
        expect({ state, ...fromHome }).toEqual({ state, ...elsewhere, out: fromHome.out });
        expect(fromHome.change, `${id} ${state}: ${fromHome.out}`).toBe(0);
        expect(fromHome.out).not.toContain("shared with");
      }
    }, 240_000);
  }
});

describe("per-file ledger units (in memory)", () => {
  const NOW = new Date("2026-11-22T00:00:00.000Z");
  const FILE_A = "/proj-a/.mcp.json";
  const FILE_B = "/proj-b/.mcp.json";
  const atA = { platform: "linux" as const, path: FILE_A };
  const atB = { platform: "linux" as const, path: FILE_B };
  const ctxB = { platform: "linux" as const, env: {}, homeDir: "/home/u", projectDir: "/proj-b" };
  const vscode = CLIENT_ADAPTERS["vscode"];
  const claude = CLIENT_ADAPTERS["claude-code"];
  if (vscode === undefined || claude === undefined) throw new Error("registry");
  const empty: ManagerState = { version: 1, entries: [], stashes: [] };

  it("records of one slot for two files coexist, are found and dropped per file, and keep their paths", () => {
    let state = recordManaged(empty, { client: "vscode", scope: "project", name: "iris-dev-mcp", containsSecret: false, at: atA }, NOW);
    state = recordManaged(state, { client: "vscode", scope: "project", name: "iris-dev-mcp", containsSecret: false, at: atB }, NOW);
    expect(state.entries.map((entry) => entry.path).sort()).toEqual([FILE_A, FILE_B]);
    expect(isManagerCreated(state, "vscode", "project", "iris-dev-mcp", atA)).toBe(true);
    state = dropManaged(state, "vscode", "project", "iris-dev-mcp", atA);
    expect(isManagerCreated(state, "vscode", "project", "iris-dev-mcp", atA)).toBe(false);
    expect(isManagerCreated(state, "vscode", "project", "iris-dev-mcp", atB)).toBe(true);
    // A re-record of the same file refreshes in place (no duplicate).
    state = recordManaged(state, { client: "vscode", scope: "project", name: "iris-dev-mcp", containsSecret: true, at: atB }, NOW);
    expect(state.entries).toHaveLength(1);
    // Stashes follow the same rule.
    let stashed = addStash(empty, { client: "vscode", scope: "project", name: "x", entry: { v: 1 }, at: atA }, NOW);
    stashed = addStash(stashed, { client: "vscode", scope: "project", name: "x", entry: { v: 2 }, at: atB }, NOW);
    expect(findStash(stashed, "vscode", "project", "x", atA)?.entry).toEqual({ v: 1 });
    expect(findStash(stashed, "vscode", "project", "x", atB)?.entry).toEqual({ v: 2 });
  });

  it("a record without a path is replaced by the first write that records one, and an old state file still reads", () => {
    const pathless: ManagerState = {
      version: 1,
      entries: [{ client: "cursor", scope: "user", name: "iris-dev-mcp", containsSecret: false, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }],
      stashes: [],
    };
    const fs = new MemFs();
    fs.seed("/state/state.json", JSON.stringify(pathless));
    expect(readState(fs, "/state", "linux")).toEqual({ ok: true, state: pathless });
    expect(isManagerCreated(pathless, "cursor", "user", "iris-dev-mcp", atA)).toBe(true);
    const next = recordManaged(pathless, { client: "cursor", scope: "user", name: "iris-dev-mcp", containsSecret: false, at: atA }, NOW);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]?.path).toBe(FILE_A);
    expect(next.entries[0]?.createdAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("recordingClients: a peer's record counts only for the same file; a pathless peer record never counts", () => {
    const peers = sharedPeers(claude, "project", ctxB);
    const rec = (client: string, path?: string): ManagerState["entries"][number] => ({
      client,
      scope: "project",
      name: "iris-dev-mcp",
      containsSecret: false,
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
      ...(path !== undefined ? { path } : {}),
    });
    const other = { ...empty, entries: [rec("vscode", FILE_A)] };
    expect(recordingClients(other, "claude-code", "project", "iris-dev-mcp", peers, atB)).toEqual([]);
    expect(soleOwner(other, "claude-code", "project", "iris-dev-mcp", peers, atB)).toBe(true);
    const here = { ...empty, entries: [rec("vscode", FILE_B)] };
    expect(recordingClients(here, "claude-code", "project", "iris-dev-mcp", peers, atB)).toEqual(["vscode"]);
    const pathless = { ...empty, entries: [rec("vscode")] };
    expect(recordingClients(pathless, "claude-code", "project", "iris-dev-mcp", peers, atB)).toEqual([]);
    expect(soleOwner(pathless, "claude-code", "project", "iris-dev-mcp", peers, atB)).toBe(true);
    // A pathless record of the writer's own still counts for a pre-sharing writer, never for vscode in a shared file.
    const own = { ...empty, entries: [rec("claude-code")] };
    expect(recordingClients(own, "claude-code", "project", "iris-dev-mcp", peers, atB)).toEqual(["claude-code"]);
    const vscodePeers = sharedPeers(vscode, "project", ctxB);
    expect(recordingClients({ ...empty, entries: [rec("vscode")] }, "vscode", "project", "iris-dev-mcp", vscodePeers, atB)).toEqual([]);
    // The file's path compares as the platform does.
    expect(recordingClients(here, "claude-code", "project", "iris-dev-mcp", peers, { platform: "darwin", path: FILE_B.toUpperCase() })).toEqual(["vscode"]);
    // A stash follows the same per-file rule as a manager record.
    const stashedA: ManagerState = { ...empty, stashes: [{ client: "vscode", scope: "project", name: "iris-dev-mcp", entry: { v: 1 }, disabledAt: "2026-11-22T00:00:00.000Z", path: FILE_A }] };
    expect(recordingClients(stashedA, "claude-code", "project", "iris-dev-mcp", peers, atB)).toEqual([]);
    expect(recordingClients(stashedA, "claude-code", "project", "iris-dev-mcp", peers, atA)).toEqual(["vscode"]);
    // In an unshared scope a client's own pathless record still counts, for every client (doctor's unrecorded-entries check).
    const cursorPathless = { ...empty, entries: [{ ...rec("cursor"), scope: "user" as const, name: "iris-dev-mcp2" }] };
    expect(recordingClients(cursorPathless, "cursor", "user", "iris-dev-mcp2", [], { platform: "linux", path: "/home/u/.cursor/mcp.json" })).toEqual(["cursor"]);
  });

  it("recordAdoptedOwners records a pre-sharing writer that owns the adopted entry without a record for this file, once, and never a peer that is not one", () => {
    const peersOfVscode = sharedPeers(vscode, "project", ctxB);
    const adopt = (state: ManagerState): ManagerState => recordAdoptedOwners(state, "vscode", "project", "iris-dev-mcp", peersOfVscode, atB, NOW, false);
    const pathlessClaude: ManagerState["entries"][number] = {
      client: "claude-code",
      scope: "project",
      name: "iris-dev-mcp",
      containsSecret: true,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    const claudeForB = { client: "claude-code", scope: "project", name: "iris-dev-mcp", containsSecret: false, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), path: FILE_B };
    // A pathless record: the pathless record stays, and the file gets its own (with the adopted entry's secret flag).
    const next = adopt({ ...empty, entries: [pathlessClaude] });
    expect(next.entries).toEqual([pathlessClaude, claudeForB]);
    expect(soleOwner(recordManaged(next, { client: "vscode", scope: "project", name: "iris-dev-mcp", containsSecret: false, at: atB }, NOW), "vscode", "project", "iris-dev-mcp", peersOfVscode, atB)).toBe(false);
    // Only a record of another file (a pathless record a write elsewhere has converted), or no record at all: the implied owner is recorded too.
    const onlyA: ManagerState = { ...empty, entries: [{ ...pathlessClaude, path: FILE_A }] };
    expect(adopt(onlyA).entries).toEqual([...onlyA.entries, claudeForB]);
    expect(adopt(empty).entries).toEqual([claudeForB]);
    // Idempotent once the file has a record, and a peer that records this file itself (here vscode, for claude-code's
    // adoption) is never given a second record.
    expect(adopt(next)).toBe(next);
    const vscodeB: ManagerState = { ...empty, entries: [{ ...pathlessClaude, client: "vscode", path: FILE_B }] };
    expect(recordAdoptedOwners(vscodeB, "claude-code", "project", "iris-dev-mcp", sharedPeers(claude, "project", ctxB), atB, NOW, false)).toBe(vscodeB);
  });

  it("sharedPeers is the claude-code and vscode project scopes only: a client's own scopes, and every other adapter, are never peers, from the home directory too", () => {
    const ctxHome = { platform: "linux" as const, env: {}, homeDir: "/home/u", projectDir: "/home/u" };
    for (const adapter of Object.values(CLIENT_ADAPTERS)) {
      for (const scopeDef of adapter.scopes) {
        const peers = sharedPeers(adapter, scopeDef.scope, ctxHome);
        const sharing = (adapter.id === "claude-code" || adapter.id === "vscode") && scopeDef.scope === "project";
        expect(peers.map((peer) => `${peer.client}:${peer.scope}`), `${adapter.id} ${scopeDef.scope}`).toEqual(
          sharing ? [`${adapter.id === "vscode" ? "claude-code" : "vscode"}:project`] : [],
        );
      }
    }
    // Cursor's user file and its own project file are one file from HOME, and still not a share.
    const cursor = CLIENT_ADAPTERS["cursor"];
    if (cursor === undefined) throw new Error("registry");
    expect(sharedPeers(cursor, "user", ctxHome)).toEqual([]);
    expect(sharedPeers(cursor, "project", ctxHome)).toEqual([]);
  });

  it("implied ownership is for the canonical iris-mcp names only: an unrecorded entry under any other name is nobody's", () => {
    expect(ownerClients(empty, "vscode", "project", "iris-dev-mcp", sharedPeers(vscode, "project", ctxB), atB)).toEqual(["claude-code"]);
    expect(ownerClients(empty, "vscode", "project", "my-own-server", sharedPeers(vscode, "project", ctxB), atB)).toEqual([]);
    expect(recordAdoptedOwners(empty, "vscode", "project", "my-own-server", sharedPeers(vscode, "project", ctxB), atB, NOW, false)).toBe(empty);
  });

  it("dropRemovedShared drops the client's own records and the peers' manager records for the file, keeping stashes and other files", () => {
    const peers = sharedPeers(claude, "project", ctxB);
    const rec = (client: string, path: string): ManagerState["entries"][number] => ({
      client,
      scope: "project",
      name: "iris-dev-mcp",
      containsSecret: false,
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
      path,
    });
    const state: ManagerState = {
      version: 1,
      entries: [rec("claude-code", FILE_B), rec("vscode", FILE_B), rec("vscode", FILE_A)],
      stashes: [{ client: "vscode", scope: "project", name: "iris-dev-mcp", entry: { v: 1 }, disabledAt: "2026-11-22T00:00:00.000Z", path: FILE_B }],
    };
    const next = dropRemovedShared(state, "claude-code", "project", "iris-dev-mcp", peers, atB);
    expect(next.entries.map((entry) => `${entry.client}:${entry.path}`)).toEqual([`vscode:${FILE_A}`]);
    expect(next.stashes).toHaveLength(1);
  });
});
