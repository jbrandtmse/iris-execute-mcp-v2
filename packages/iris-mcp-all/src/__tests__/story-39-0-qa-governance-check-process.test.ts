/**
 * Story 39.0 (QA, DW-565, AC-2 and AC-3) - `iris-mcp-governance check` as a spawned process, over the whole
 * suite's built dists.
 *
 * `governance-cli-check.test.ts` drives `runCli` in-process and `governance-cli-e2e.test.ts` spawns the bin with
 * keys of the dev server only and without the `IRIS_GOVERNANCE` channel. Neither shows, on the built bin, the
 * property that makes `check` worth running: a key of ANOTHER server (and the framework tool's key) is not dead,
 * because the universe it checks against is the whole suite, while a key no tool of the suite has exits 1 naming
 * that key alone. This gate spawns the built bin in a directory that is not the repository, with a scrubbed
 * environment plus exactly the channel under test, against real governance files:
 *
 *  - a document holding keys of all five servers and the framework tool, in `global` and in a profile layer,
 *    exits 0 with the OK line, on stdout only, and `--json` writes one object counting the derived universe;
 *  - the same document plus one key no tool has exits 1: the form (d) line for that key alone, the summary line,
 *    nothing on stdout, and the file is byte-identical afterwards (`check` is read-only);
 *  - `IRIS_GOVERNANCE` in the child's environment is a channel of its own, and is checked before the file.
 *
 * The keys are read from the bin's own `universe --json` (one per package: the first key of its first tool, the
 * last key of its last tool, and the second key of its first multi-action tool), so no key is hand-copied and
 * the universe size is derived, never hard-coded (the Story 39.0 intent contract's I/O matrix gives the texts).
 * Nothing contacts IRIS. Placement (Rule #45): `@iris-mcp/all` is the only package that sees every server's
 * built dist. A stale or missing dist fails the file with the reason: a skipped check proves nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inheritedEnv, staleDistReason } from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const BIN = path.join(REPO_ROOT, "packages", "shared", "dist", "cli", "governance-cli.js");

const SUITE_PACKAGES = ["shared", "iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp", "iris-ops-mcp", "iris-data-mcp"] as const;

interface UniverseJson {
  keys: string[];
  universeSource: string;
  frameworkTool: { name: string; keys: string[] };
  packages: Array<{ pkg: string; tools: Array<{ name: string; keys: string[] }> }>;
}

interface Outcome {
  status: number | null;
  stdout: string;
  stderr: string;
}

let scratch = "";
let universe: UniverseJson;

/** Run the built bin in `scratch` (not the repository) with the scrubbed environment plus `env`. */
function runBin(args: string[], env: Record<string, string> = {}): Outcome {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    cwd: scratch,
    env: { ...inheritedEnv(), ...env },
    timeout: 60000,
  });
  expect(result.error, "the bin started").toBeUndefined();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

let fileCounter = 0;
function writeDoc(document: unknown): string {
  fileCounter += 1;
  const file = path.join(scratch, `governance-${fileCounter}.json`);
  writeFileSync(file, JSON.stringify(document), "utf8");
  return file;
}

/** Keys of every server: per package, the first key of its first tool, the last key of its last tool, and a multi-action key. */
function crossServerKeys(): { global: string[]; profile: string[]; packagesCovered: string[] } {
  const global: string[] = [universe.frameworkTool.keys[0] as string];
  const profile: string[] = [];
  const packagesCovered: string[] = [];
  for (const { pkg, tools } of universe.packages) {
    const first = tools[0]?.keys[0];
    const last = tools[tools.length - 1]?.keys.slice(-1)[0];
    const multi = tools.find((tool) => tool.keys.length > 1)?.keys[1];
    expect(first, `${pkg} has tools`).toBeDefined();
    global.push(first as string);
    if (multi) global.push(multi);
    profile.push(last as string);
    packagesCovered.push(pkg);
  }
  return { global: [...new Set(global)], profile: [...new Set(profile)], packagesCovered };
}

beforeAll(() => {
  const stale = SUITE_PACKAGES.map((pkg) => staleDistReason(REPO_ROOT, pkg)).filter((reason): reason is string => reason !== undefined);
  if (stale.length > 0) {
    throw new Error(`The Story 39.0 check process gate needs fresh dists of the whole suite (pnpm --filter <pkg> build): ${stale.join(" | ")}`);
  }
  scratch = mkdtempSync(path.join(tmpdir(), "story-39-0-check-"));
  const result = spawnSync(process.execPath, [BIN, "universe", "--json"], {
    encoding: "utf8",
    cwd: scratch,
    env: inheritedEnv(),
    maxBuffer: 16 * 1024 * 1024,
  });
  expect(result.status, result.stderr).toBe(0);
  universe = JSON.parse(result.stdout) as UniverseJson;
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("iris-mcp-governance check over the whole suite, built bin, spawned process (Story 39.0, DW-565, AC-2)", () => {
  it("the universe the bin loads is the five servers' dists in order (a hand-written roster, not derived from the bin)", () => {
    expect(universe.packages.map((entry) => entry.pkg)).toEqual([
      "iris-dev-mcp",
      "iris-admin-mcp",
      "iris-interop-mcp",
      "iris-ops-mcp",
      "iris-data-mcp",
    ]);
    expect(universe.frameworkTool.keys).toEqual(["iris_server_profiles"]);
  });

  it("exits 0 for keys written by hand, one per server and the framework tool: another server's key is not dead", () => {
    // Action keys are not in the frozen baseline, so only the loaded dists can make them match.
    const keys = [
      "iris_doc_edit:apply",
      "iris_namespace_manage:create",
      "iris_production_control:clean",
      "iris_process_manage:terminate",
      "iris_docdb_manage:create",
      "iris_server_profiles",
    ];
    const file = writeDoc({ global: Object.fromEntries(keys.map((key) => [key, false])) });

    const result = runBin(["check", "--file", file]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`OK: all 6 key(s) in IRIS_GOVERNANCE_FILE (path: ${file}) match the suite's ${universe.keys.length} governance keys.\n`);
    expect(result.stderr).toBe("");
  });

  it("the keys under test really come from all five servers and the framework tool, and the universe is larger than any one server's keys", () => {
    const { global, profile, packagesCovered } = crossServerKeys();

    expect(packagesCovered).toHaveLength(5);
    expect(universe.keys).toEqual(expect.arrayContaining([...global, ...profile]));
    const devKeys = new Set(universe.packages.find((entry) => entry.pkg === "iris-dev-mcp")?.tools.flatMap((tool) => tool.keys));
    const foreign = [...global, ...profile].filter((key) => !devKeys.has(key) && key !== universe.frameworkTool.keys[0]);
    expect(foreign.length, "most of the keys belong to a server other than dev").toBeGreaterThanOrEqual(8);
    expect(universe.keys.length).toBeGreaterThan(devKeys.size);
  });

  it("exits 0: a document of keys from every server, in global and in a profile layer, matches the suite; the OK line counts them", () => {
    const { global, profile } = crossServerKeys();
    const file = writeDoc({ global: Object.fromEntries(global.map((key) => [key, false])), profiles: { prod: Object.fromEntries(profile.map((key) => [key, true])) } });

    const result = runBin(["check", "--file", file]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      `OK: all ${global.length + profile.length} key(s) in IRIS_GOVERNANCE_FILE (path: ${file}) match the suite's ${universe.keys.length} governance keys.\n`,
    );
  });

  it("--json: exactly one object on exit 0, counting the checked keys against the derived universe, located from the bin", () => {
    const { global } = crossServerKeys();
    const file = writeDoc({ global: Object.fromEntries(global.map((key) => [key, true])) });

    const result = runBin(["check", "--file", file, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      sources: [`IRIS_GOVERNANCE_FILE (path: ${file})`],
      checked: global.length,
      universeKeys: universe.keys.length,
      universeSource: universe.universeSource,
      unmatched: [],
    });
    expect(universe.universeSource, "the dists are found from the bin's own location, not the working directory").toBe(path.join(REPO_ROOT, "packages"));
  });

  it("exits 1: the same document plus a key no tool of the suite has reports that key alone, leaves stdout empty and the file untouched", () => {
    const { global, profile } = crossServerKeys();
    const document = {
      global: { ...Object.fromEntries(global.map((key) => [key, false])), iris_doc_putt: false },
      profiles: { prod: Object.fromEntries(profile.map((key) => [key, true])) },
    };
    const file = writeDoc(document);
    const before = readFileSync(file);
    const filesBefore = readdirSync(scratch).sort();

    const result = runBin(["check", "--file", file]);

    const source = `IRIS_GOVERNANCE_FILE (path: ${file})`;
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      [
        `${source}: "iris_doc_putt" under "global" has no effect, because no tool of the suite has this key. Check it for a typo; iris-mcp-governance universe lists every key.`,
        `Error: 1 of ${global.length + 1 + profile.length} key(s) in ${source} have no effect on any server.`,
        "",
      ].join("\n"),
    );
    expect(readFileSync(file).equals(before), "check never writes the governance file").toBe(true);
    expect(readdirSync(scratch).sort(), "check leaves no temp file behind").toEqual(filesBefore);
  });

  it("exits 1 for a key under a profile layer too, and names that layer", () => {
    const { global } = crossServerKeys();
    const file = writeDoc({ global: { [global[0] as string]: true }, profiles: { prod: { iris_sql_execut: false } } });

    const result = runBin(["check", "--file", file]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"iris_sql_execut" under profile "prod" has no effect, because no tool of the suite has this key.');
    expect(result.stderr).toContain("Error: 1 of 2 key(s)");
  });

  it("IRIS_GOVERNANCE in the child's environment is a channel of its own: another server's key exits 0, a typo exits 1 naming the variable", () => {
    const interopKey = universe.packages.find((entry) => entry.pkg === "iris-interop-mcp")?.tools[0]?.keys[0] as string;
    expect(interopKey).toBeDefined();

    const ok = runBin(["check"], { IRIS_GOVERNANCE: JSON.stringify({ global: { [interopKey]: false } }) });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe(`OK: all 1 key(s) in IRIS_GOVERNANCE match the suite's ${universe.keys.length} governance keys.\n`);
    expect(ok.stderr).toBe("");

    const dead = runBin(["check"], { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_production_contrl: false } }) });
    expect(dead.status).toBe(1);
    expect(dead.stdout).toBe("");
    expect(dead.stderr).toBe(
      [
        'IRIS_GOVERNANCE: "iris_production_contrl" under "global" has no effect, because no tool of the suite has this key. Check it for a typo; iris-mcp-governance universe lists every key.',
        "Error: 1 of 1 key(s) in IRIS_GOVERNANCE have no effect on any server.",
        "",
      ].join("\n"),
    );
  });

  it("checks IRIS_GOVERNANCE first, then the file, and the summary joins both sources", () => {
    const file = writeDoc({ global: { iris_doc_putt: true } });
    const env = { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_execut: true } }) };

    const result = runBin(["check", "--file", file], env);

    const sources = `IRIS_GOVERNANCE and IRIS_GOVERNANCE_FILE (path: ${file})`;
    expect(result.status).toBe(1);
    const lines = result.stderr.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^IRIS_GOVERNANCE: "iris_sql_execut" under "global" has no effect/);
    expect(lines[1]).toContain(`IRIS_GOVERNANCE_FILE (path: ${file}): "iris_doc_putt" under "global" has no effect`);
    expect(lines[2]).toBe(`Error: 2 of 2 key(s) in ${sources} have no effect on any server.`);
    expect(lines[3]).toBe("");
  });
});
