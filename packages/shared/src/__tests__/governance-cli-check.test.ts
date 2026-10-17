/**
 * Unit tests for the `iris-mcp-governance check` command (Story 39.0, DW-565, AC-2):
 * every key in `IRIS_GOVERNANCE` and the resolved governance file is checked against the
 * suite's full key universe, which `universe` already loads. A key that matches nothing
 * has no effect on any server, and `check` exits 1 with one message per key.
 *
 * The real-dist rows drive `runCli` over the monorepo's BUILT packages (as
 * `governance-cli-universe.test.ts` does); the error rows inject the package loader.
 * Expected texts come from the Story 39.0 intent contract (its I/O matrix), written out
 * by hand (Rule #36); the universe key count is derived from `universe --json`, never
 * hard-coded.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCli, type CliDeps, type LoadedPackage } from "../cli/governance.js";
import { loadGovernanceFile, parseGovernanceConfig } from "../governance.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import type { ToolDefinition } from "../tool-types.js";

// -- Harness -----------------------------------------------------------

interface Collector {
  text: string;
  write(chunk: string): void;
}

function createCollector(): Collector {
  const collector: Collector = {
    text: "",
    write(chunk: string): void {
      collector.text += chunk;
    },
  };
  return collector;
}

interface Run {
  code: number;
  out: string;
  err: string;
}

async function run(args: string[], env: Record<string, string | undefined> = {}, extra: CliDeps = {}): Promise<Run> {
  const stdout = createCollector();
  const stderr = createCollector();
  const code = await runCli(args, { env, stdout, stderr, ...extra });
  return { code, out: stdout.text, err: stderr.text };
}

// This file lives at packages/shared/src/__tests__/, four levels below the monorepo root.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "iris-gov-cli-check-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

let fileCounter = 0;
function writeDoc(document: unknown): string {
  fileCounter += 1;
  const file = path.join(dir, `governance-${fileCounter}.json`);
  writeFileSync(file, typeof document === "string" ? document : JSON.stringify(document), "utf8");
  return file;
}

const USAGE = "Usage: iris-mcp-governance check [--file <path>] [--root <path>] [--json]\n";

/** The universe key count the OK line reports: the length of `universe --json`'s key list. */
async function universeKeyCount(extra: CliDeps = {}): Promise<number> {
  const { code, out } = await run(["universe", "--root", REPO_ROOT, "--json"], {}, extra);
  expect(code).toBe(0);
  return (JSON.parse(out) as { keys: string[] }).keys.length;
}

interface CheckJson {
  ok: boolean;
  sources: string[];
  checked: number;
  universeKeys: number;
  universeSource: string;
  unmatched: { source: string; layer: string; key: string; message: string }[];
  error?: string;
}

// -- The real built dist -----------------------------------------------

describe("check over the real built dist", { timeout: 60_000 }, () => {
  it("exits 0 with the OK line when every key matches, counting keys across layers and the derived universe size", async () => {
    const file = writeDoc({
      global: { iris_doc_put: false, "iris_doc_edit:apply": true },
      profiles: { prod: { "iris_production_control:clean": false } },
    });
    const keyCount = await universeKeyCount();

    const { code, out, err } = await run(["check", "--file", file, "--root", REPO_ROOT]);

    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toBe(`OK: all 3 key(s) in IRIS_GOVERNANCE_FILE (path: ${file}) match the suite's ${keyCount} governance keys.\n`);
    expect(keyCount).toBeGreaterThan(GOVERNANCE_BASELINE.size);
  });

  it("exits 1 with one message per dead key, in layer order, then the summary line", async () => {
    const file = writeDoc({
      global: { iris_doc_putt: false, iris_doc_edit: false, iris_doc_put: true },
      profiles: { default: { "iris_doc_put:apply": false, "iris_production_control:strat": false } },
    });

    const { code, out, err } = await run(["check", "--file", file, "--root", REPO_ROOT]);

    const source = `IRIS_GOVERNANCE_FILE (path: ${file})`;
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe(
      [
        `${source}: "iris_doc_putt" under "global" has no effect, because no tool of the suite has this key. Check it for a typo; iris-mcp-governance universe lists every key.`,
        `${source}: "iris_doc_edit" under "global" has no effect, because iris_doc_edit is governed per action. Set the actions you mean instead: iris_doc_edit:apply, iris_doc_edit:regenerateStorage.`,
        `${source}: "iris_doc_put:apply" under profile "default" has no effect, because iris_doc_put takes no action. Use "iris_doc_put" instead.`,
        `${source}: "iris_production_control:strat" under profile "default" has no effect, because iris_production_control has no action "strat". Use one of: iris_production_control:start, iris_production_control:stop, iris_production_control:restart, iris_production_control:update, iris_production_control:recover, iris_production_control:clean.`,
        `Error: 4 of 5 key(s) in ${source} have no effect on any server.`,
        "",
      ].join("\n"),
    );
  });

  it("checks the environment document first, then the file, and joins the sources with ' and '", async () => {
    const file = writeDoc({ global: { iris_doc_put: true, iris_doc_putt: true } });
    const env = { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_execut: true } }) };

    const { code, err } = await run(["check", "--file", file, "--root", REPO_ROOT], env);

    const sources = `IRIS_GOVERNANCE and IRIS_GOVERNANCE_FILE (path: ${file})`;
    expect(code).toBe(1);
    expect(err.split("\n")).toEqual([
      'IRIS_GOVERNANCE: "iris_sql_execut" under "global" has no effect, because no tool of the suite has this key. Check it for a typo; iris-mcp-governance universe lists every key.',
      `IRIS_GOVERNANCE_FILE (path: ${file}): "iris_doc_putt" under "global" has no effect, because no tool of the suite has this key. Check it for a typo; iris-mcp-governance universe lists every key.`,
      `Error: 2 of 3 key(s) in ${sources} have no effect on any server.`,
      "",
    ]);
  });

  it("names only IRIS_GOVERNANCE when no file is resolvable, and only the file when the variable is unset or empty", async () => {
    const env = { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_doc_put: false } }) };
    const envOnly = await run(["check", "--root", REPO_ROOT], env);
    expect(envOnly.code).toBe(0);
    expect(envOnly.out).toMatch(/^OK: all 1 key\(s\) in IRIS_GOVERNANCE match the suite's \d+ governance keys\.\n$/);

    const file = writeDoc({ global: { iris_doc_put: false } });
    const fileOnly = await run(["check", "--file", file, "--root", REPO_ROOT], { IRIS_GOVERNANCE: "" });
    expect(fileOnly.out).toContain(`in IRIS_GOVERNANCE_FILE (path: ${file}) match`);
  });

  it("resolves the file like the other commands: --file wins over IRIS_GOVERNANCE_FILE, which alone is enough", async () => {
    const good = writeDoc({ global: { iris_doc_put: false } });
    const bad = writeDoc({ global: { iris_doc_putt: false } });

    const viaEnv = await run(["check", "--root", REPO_ROOT], { IRIS_GOVERNANCE_FILE: bad });
    expect(viaEnv.code).toBe(1);
    expect(viaEnv.err).toContain(`IRIS_GOVERNANCE_FILE (path: ${bad})`);

    const flagWins = await run(["check", "--file", good, "--root", REPO_ROOT], { IRIS_GOVERNANCE_FILE: bad });
    expect(flagWins.code).toBe(0);
  });

  it("a document holding every key of the universe is clean", async () => {
    const universe = JSON.parse((await run(["universe", "--root", REPO_ROOT, "--json"])).out) as { keys: string[] };
    const file = writeDoc({ global: Object.fromEntries(universe.keys.map((key) => [key, true])) });

    const { code, out } = await run(["check", "--file", file, "--root", REPO_ROOT]);

    expect(code).toBe(0);
    expect(out).toBe(
      `OK: all ${universe.keys.length} key(s) in IRIS_GOVERNANCE_FILE (path: ${file}) match the suite's ${universe.keys.length} governance keys.\n`,
    );
  });
});

describe("check --json", { timeout: 60_000 }, () => {
  it("writes exactly one object on exit 0", async () => {
    const file = writeDoc({ global: { iris_doc_put: false } });
    const keyCount = await universeKeyCount();

    const { code, out, err } = await run(["check", "--file", file, "--root", REPO_ROOT, "--json"]);

    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(out)).toEqual({
      ok: true,
      sources: [`IRIS_GOVERNANCE_FILE (path: ${file})`],
      checked: 1,
      universeKeys: keyCount,
      universeSource: path.join(REPO_ROOT, "packages"),
      unmatched: [],
    });
  });

  it("writes exactly one object on exit 1, with the same messages on stderr", async () => {
    const file = writeDoc({ global: { iris_doc_putt: false, iris_doc_edit: false } });

    const { code, out, err } = await run(["check", "--file", file, "--root", REPO_ROOT, "--json"]);

    expect(code).toBe(1);
    expect(out.trimEnd().split("\n")).toHaveLength(1);
    const json = JSON.parse(out) as CheckJson;
    expect(json.ok).toBe(false);
    expect(json.sources).toEqual([`IRIS_GOVERNANCE_FILE (path: ${file})`]);
    expect(json.checked).toBe(2);
    expect(json.unmatched.map(({ source, layer, key }) => ({ source, layer, key }))).toEqual([
      { source: `IRIS_GOVERNANCE_FILE (path: ${file})`, layer: '"global"', key: "iris_doc_putt" },
      { source: `IRIS_GOVERNANCE_FILE (path: ${file})`, layer: '"global"', key: "iris_doc_edit" },
    ]);
    for (const finding of json.unmatched) expect(err).toContain(`${finding.message}\n`);
  });

  it("an invalid document writes {ok:false,error} with the server loader's text, on exit 1", async () => {
    const file = writeDoc("{ not json");
    let loaderText = "";
    try {
      loadGovernanceFile({ IRIS_GOVERNANCE_FILE: file });
    } catch (error: unknown) {
      loaderText = error instanceof Error ? error.message : String(error);
    }
    expect(loaderText).toContain("IRIS_GOVERNANCE_FILE is invalid");

    const { code, out, err } = await run(["check", "--file", file, "--root", REPO_ROOT, "--json"]);

    expect(code).toBe(1);
    expect(JSON.parse(out)).toEqual({ ok: false, error: loaderText });
    expect(err).toBe(`Error: ${loaderText}\n`);
  });
});

// -- Errors ------------------------------------------------------------

describe("check: errors", { timeout: 60_000 }, () => {
  it("no governance document at all exits 2 with the usage text, before any dist load", async () => {
    let loaderCalled = false;
    const { code, out, err } = await run(["check"], { IRIS_GOVERNANCE: "", IRIS_GOVERNANCE_FILE: "" }, {
      loadPackageTools: async () => {
        loaderCalled = true;
        return [];
      },
    });

    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toBe(
      `Error: "check" needs a governance document: pass --file <path>, or set IRIS_GOVERNANCE_FILE or IRIS_GOVERNANCE.\n\n${USAGE}`,
    );
    expect(loaderCalled).toBe(false);
  });

  it("an invalid IRIS_GOVERNANCE document exits 1 with the server's exact text, before any dist load", async () => {
    const env = { IRIS_GOVERNANCE: JSON.stringify({ iris_doc_put: false }) };
    let loaderText = "";
    try {
      parseGovernanceConfig(env);
    } catch (error: unknown) {
      loaderText = error instanceof Error ? error.message : String(error);
    }
    expect(loaderText).toContain("IRIS_GOVERNANCE is invalid");
    let loaderCalled = false;

    const { code, err } = await run(["check"], env, {
      loadPackageTools: async () => {
        loaderCalled = true;
        return [];
      },
    });

    expect(code).toBe(1);
    expect(err).toBe(`Error: ${loaderText}\n`);
    expect(loaderCalled).toBe(false);
  });

  it("a missing file exits 1 with the loader's text", async () => {
    const { code, err } = await run(["check", "--file", path.join(dir, "absent.json"), "--root", REPO_ROOT]);
    expect(code).toBe(1);
    expect(err).toContain("IRIS_GOVERNANCE_FILE");
  });

  it("a --root with no dist exits 1 with exactly the universe loader's message", async () => {
    const file = writeDoc({ global: { iris_doc_put: false } });
    const universe = await run(["universe", "--root", dir]);
    expect(universe.code).toBe(1);
    expect(universe.err).toContain("could not locate built tools");

    const { code, out, err } = await run(["check", "--file", file, "--root", dir]);

    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe(universe.err);

    const json = await run(["check", "--file", file, "--root", dir, "--json"]);
    expect(json.code).toBe(1);
    expect((JSON.parse(json.out) as CheckJson).ok).toBe(false);
    expect((JSON.parse(json.out) as CheckJson).error).toBe(universe.err.replace(/^Error: /, "").trimEnd());
  });

  it.each([
    ["a positional argument", ["check", "stray"], '"check" takes no arguments.'],
    ["an unknown option", ["check", "--bogus"], 'Unknown option "--bogus".'],
    ["--profile, which check does not take", ["check", "--profile", "prod"], 'Unknown option "--profile".'],
    ["an empty --root", ["check", "--root", ""], "--root requires a non-empty path."],
    ["--file without a value", ["check", "--file"], 'Option "--file" requires a value.'],
  ])("%s exits 2 with the usage text, before any dist load", async (_label, args, text) => {
    let loaderCalled = false;
    const { code, out, err } = await run(args, { IRIS_GOVERNANCE: "{}" }, {
      loadPackageTools: async () => {
        loaderCalled = true;
        return [];
      },
    });

    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toBe(`Error: ${text}\n\n${USAGE}`);
    expect(loaderCalled).toBe(false);
  });
});

// -- The universe it checks against is the one the loader returns -------

describe("check: injected loader", () => {
  function fakeTool(name: string): ToolDefinition {
    return { name, inputSchema: { shape: {} } } as unknown as ToolDefinition;
  }

  const FAKE_PACKAGES: LoadedPackage[] = [{ pkg: "iris-dev-mcp", tools: [fakeTool("iris_only_tool")] }];
  const fakeLoader = { loadPackageTools: async () => FAKE_PACKAGES };

  it("checks against the loaded universe: a tool the loader lacks is dead even if a real package has it", async () => {
    const file = writeDoc({ global: { iris_only_tool: true, iris_other_tool: true } });

    const { code, err } = await run(["check", "--file", file], {}, fakeLoader);

    expect(code).toBe(1);
    expect(err).toBe(
      [
        `IRIS_GOVERNANCE_FILE (path: ${file}): "iris_other_tool" under "global" has no effect, because no tool of the suite has this key. Check it for a typo; iris-mcp-governance universe lists every key.`,
        `Error: 1 of 2 key(s) in IRIS_GOVERNANCE_FILE (path: ${file}) have no effect on any server.`,
        "",
      ].join("\n"),
    );
  });

  it("a frozen-baseline key whose tool no package carries is in the universe, so it is not reported", async () => {
    const baselineKey = [...GOVERNANCE_BASELINE][0] as string;
    const file = writeDoc({ global: { [baselineKey]: true } });
    const keyCount = await universeKeyCount(fakeLoader);

    const { code, out } = await run(["check", "--file", file], {}, fakeLoader);

    expect(code).toBe(0);
    expect(out).toBe(`OK: all 1 key(s) in IRIS_GOVERNANCE_FILE (path: ${file}) match the suite's ${keyCount} governance keys.\n`);
  });

  it("the framework tool's key is in the universe", async () => {
    const file = writeDoc({ global: { iris_server_profiles: true } });
    const { code } = await run(["check", "--file", file], {}, fakeLoader);
    expect(code).toBe(0);
  });

  it("a loader failure exits 1 with its message (and the {ok:false,error} object under --json)", async () => {
    const file = writeDoc({ global: { iris_doc_put: true } });
    const failing = {
      loadPackageTools: async (): Promise<LoadedPackage[]> => {
        throw new Error("synthetic loader failure");
      },
    };

    const text = await run(["check", "--file", file], {}, failing);
    expect(text.code).toBe(1);
    expect(text.err).toBe("Error: synthetic loader failure\n");

    const json = await run(["check", "--file", file, "--json"], {}, failing);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out)).toEqual({ ok: false, error: "synthetic loader failure" });
  });

  it("a key produced by two packages is the universe loader's duplicate-key error", async () => {
    const file = writeDoc({ global: { iris_dup: true } });
    const duplicated: LoadedPackage[] = [
      { pkg: "iris-dev-mcp", tools: [fakeTool("iris_dup")] },
      { pkg: "iris-ops-mcp", tools: [fakeTool("iris_dup")] },
    ];

    const { code, err } = await run(["check", "--file", file], {}, { loadPackageTools: async () => duplicated });

    expect(code).toBe(1);
    expect(err).toContain('duplicate governance key "iris_dup"');
    expect(err).toContain("iris-dev-mcp/iris_dup");
    expect(err).toContain("iris-ops-mcp/iris_dup");
  });
});

describe("check: help and the unknown-command list", () => {
  it("--help lists the command, and an unknown command names check among the valid ones", async () => {
    const help = await run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.out).toContain("check [--file <path>] [--root <path>] [--json]");

    const unknown = await run(["bogus"]);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain("Valid commands: validate, get, set, unset, preset, effective, diff, universe, check.");
  });
});
