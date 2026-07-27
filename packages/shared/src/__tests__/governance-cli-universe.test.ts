/**
 * Unit tests for the `iris-mcp-governance universe` command (Epic 32, Story
 * 32.2) — the FULL governed-key universe render the extension governance UI
 * consumes.
 *
 * The default tool loader runs against the monorepo's REAL built dist (the
 * shared package's tests run after `turbo build`, so `packages/<pkg>/dist/`
 * is present) — the same derivation `iris-mcp-all`'s cross-package tests and
 * the baseline generator use, never a hand-maintained key list. The
 * no-drift proof compares the CLI render against an INDEPENDENT oracle:
 * tools imported straight from each package's `dist/tools/index.js` in this
 * test, run through the shared `getEffectivePolicy`/`getEffectiveConfigSources`
 * engine directly.
 *
 * Filesystem fixtures use REAL temp files under `mkdtempSync` (the
 * `governance-cli.test.ts` style); `deps.env` is always an explicit map so no
 * test touches a developer's real environment.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runCli, type CliDeps, type LoadedPackage } from "../cli/governance.js";
import {
  buildDefaultEnabledWrites,
  buildMutatesLookup,
  getEffectiveConfigSources,
  getEffectivePolicy,
} from "../governance.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import { BASELINE_ACTION_CLASSIFICATIONS } from "../baseline-classifications.js";
import { SERVER_PACKAGES } from "../governance-baseline-derivation.js";
import { SERVER_DISCOVERY_TOOL_NAME, serverDiscoveryTool } from "../server-discovery.js";
import type { ToolDefinition } from "../tool-types.js";

// ── Harness ────────────────────────────────────────────────────────────

function createCollector(): { write: (chunk: string) => void; text: string } {
  const collector = {
    text: "",
    write(chunk: string): void {
      collector.text += chunk;
    },
  };
  return collector;
}

function baseDeps(env: Record<string, string | undefined> = {}): {
  deps: CliDeps;
  stdout: ReturnType<typeof createCollector>;
  stderr: ReturnType<typeof createCollector>;
} {
  const stdout = createCollector();
  const stderr = createCollector();
  return { deps: { env, stdout, stderr }, stdout, stderr };
}

// This file lives at packages/shared/src/__tests__/ — four levels up is the
// monorepo root.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "iris-gov-cli-universe-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface UniverseJson {
  profile: string;
  file: string | null;
  preset: string | null;
  universeSource: string;
  packages: { pkg: string; tools: { name: string; keys: string[] }[] }[];
  frameworkTool: { name: string; keys: string[] };
  keys: string[];
  postFoundation: string[];
  mutates: Record<string, "read" | "write">;
  defaultEnabledWrites: string[];
  policy: Record<string, boolean>;
  configSource: Record<string, string>;
  note: string;
  error?: string;
}

async function runUniverseJson(
  args: string[] = [],
  env: Record<string, string | undefined> = {},
): Promise<{ code: number; json: UniverseJson; stderr: string }> {
  const { deps, stdout, stderr } = baseDeps(env);
  const code = await runCli(["universe", ...args, "--json"], deps);
  return { code, json: JSON.parse(stdout.text) as UniverseJson, stderr: stderr.text };
}

/**
 * The INDEPENDENT oracle: every server package's tools imported directly
 * from built dist by THIS test (never through the CLI's own loader), plus
 * the framework tool — so a bug in the CLI's resolution/derivation cannot be
 * corroborated by itself.
 */
async function loadOracleTools(): Promise<{ pkg: string; tools: ToolDefinition[] }[]> {
  const out: { pkg: string; tools: ToolDefinition[] }[] = [];
  for (const pkg of SERVER_PACKAGES) {
    const entry = path.join(REPO_ROOT, "packages", pkg, "dist", "tools", "index.js");
    const mod = (await import(pathToFileURL(entry).href)) as { tools: ToolDefinition[] };
    out.push({ pkg, tools: mod.tools });
  }
  return out;
}

// ── Full-universe render against the real built dist ───────────────────

describe("universe — full-universe render over the real built dist", () => {
  it("renders every key of the REAL universe: baseline ∪ dist-derived ∪ framework, with complete mutates and matching policy/configSource key sets", async () => {
    const { code, json } = await runUniverseJson();
    expect(code).toBe(0);

    // Derived, never hand-counted (Rule #51): the universe is a strict
    // superset of the frozen baseline, plus the framework tool.
    const keys = new Set(json.keys);
    for (const key of GOVERNANCE_BASELINE) {
      expect(keys.has(key), `universe missing baseline key ${key}`).toBe(true);
    }
    expect(keys.has(SERVER_DISCOVERY_TOOL_NAME)).toBe(true);
    expect(json.keys.length).toBeGreaterThan(GOVERNANCE_BASELINE.size);

    // postFoundation = keys \ baseline, exactly.
    expect(new Set(json.postFoundation)).toEqual(
      new Set(json.keys.filter((key) => !GOVERNANCE_BASELINE.has(key))),
    );
    expect(json.postFoundation.length).toBeGreaterThan(0);
    // The framework tool is post-foundation (not a frozen key).
    expect(json.postFoundation).toContain(SERVER_DISCOVERY_TOOL_NAME);

    // policy/configSource/mutates cover EXACTLY the universe.
    expect(new Set(Object.keys(json.policy))).toEqual(keys);
    expect(new Set(Object.keys(json.configSource))).toEqual(keys);
    expect(new Set(Object.keys(json.mutates))).toEqual(keys);

    // Every value is from the real domains.
    for (const value of Object.values(json.policy)) expect(typeof value).toBe("boolean");
    for (const source of Object.values(json.configSource)) {
      expect(["env", "file", "preset", "default"]).toContain(source);
    }
    for (const cls of Object.values(json.mutates)) expect(["read", "write"]).toContain(cls);

    // The one F2 default-enabled write the suite currently ships (derived
    // from the real dist — pinned as "contains", so a FUTURE opt-in doesn't
    // break this test).
    expect(json.defaultEnabledWrites).toContain("iris_production_control:clean");
  });

  it("groups keys per package exactly as the dist tools produce them, plus the framework group", async () => {
    const { code, json } = await runUniverseJson();
    expect(code).toBe(0);

    expect(json.packages.map((pkg) => pkg.pkg)).toEqual([...SERVER_PACKAGES]);
    expect(json.frameworkTool).toEqual({
      name: SERVER_DISCOVERY_TOOL_NAME,
      keys: [SERVER_DISCOVERY_TOOL_NAME],
    });

    // Every derived key appears in its package's group exactly once.
    const grouped = json.packages.flatMap((pkg) => pkg.tools.flatMap((tool) => tool.keys));
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const key of grouped) expect(json.keys).toContain(key);
    // …and every package group name matches its tools' names.
    for (const pkg of json.packages) {
      for (const tool of pkg.tools) {
        expect(tool.keys.length).toBeGreaterThan(0);
        for (const key of tool.keys) {
          expect(key === tool.name || key.startsWith(`${tool.name}:`)).toBe(true);
        }
      }
    }
  });

  it("seeds post-foundation WRITE keys default-DISABLED (the server behavior `effective` cannot reproduce), and F2 default-enabled writes ENABLED", async () => {
    const { code, json } = await runUniverseJson();
    expect(code).toBe(0);

    // Pick the write keys from the REAL render — never a hand-picked name —
    // so this test survives future tool additions.
    const seededWriteKeys = json.postFoundation.filter(
      (key) => json.mutates[key] === "write" && !json.defaultEnabledWrites.includes(key),
    );
    expect(seededWriteKeys.length).toBeGreaterThan(0);
    for (const key of seededWriteKeys) {
      expect(json.policy[key], `${key} must seed default-disabled`).toBe(false);
      expect(json.configSource[key]).toBe("default");
    }
    for (const key of json.defaultEnabledWrites) {
      expect(json.policy[key], `${key} (F2 default-enabled) must seed enabled`).toBe(true);
    }

    // …while frozen-baseline keys (read OR write) stay grandfathered-enabled.
    const baselineWrites = json.keys.filter(
      (key) => GOVERNANCE_BASELINE.has(key) && json.mutates[key] === "write",
    );
    expect(baselineWrites.length).toBeGreaterThan(0);
    for (const key of baselineWrites) {
      expect(json.policy[key], `baseline key ${key} must stay grandfathered-enabled`).toBe(true);
    }
  });

  it("agrees key-for-key with a DIRECT shared-engine render over independently-loaded dist tools (the no-drift proof — the CLI composes the engine, never reimplements it)", async () => {
    const { code, json } = await runUniverseJson(["--profile", "default"]);
    expect(code).toBe(0);

    // Independent oracle: tools loaded by THIS test, straight from dist.
    const oraclePackages = await loadOracleTools();
    const oracleTools = [...oraclePackages.flatMap((pkg) => pkg.tools), serverDiscoveryTool];
    const mutatesLookup = buildMutatesLookup(oracleTools);
    const defaultEnabledWrites = buildDefaultEnabledWrites(oracleTools);

    const expectedPolicy = getEffectivePolicy(
      "default",
      {},
      json.keys,
      mutatesLookup,
      GOVERNANCE_BASELINE,
      defaultEnabledWrites,
      undefined,
      BASELINE_ACTION_CLASSIFICATIONS,
      undefined,
    );
    const expectedSources = getEffectiveConfigSources(
      "default",
      {},
      json.keys,
      mutatesLookup,
      undefined,
      BASELINE_ACTION_CLASSIFICATIONS,
      undefined,
    );

    expect(json.policy).toEqual(expectedPolicy);
    expect(json.configSource).toEqual(expectedSources);
  });
});

// ── Cascade inputs (file / env / preset) ───────────────────────────────

describe("universe — cascade inputs match the server's", () => {
  it("the FILE channel resolves values and attribution (file layer beats seed, env beats file)", async () => {
    // Derived real keys: one post-foundation write (seeded false) and one
    // baseline key — the file flips both.
    const probe = await runUniverseJson();
    const writeKey = probe.json.postFoundation.find(
      (key) => probe.json.mutates[key] === "write" && !probe.json.defaultEnabledWrites.includes(key),
    );
    const baselineKey = [...GOVERNANCE_BASELINE][0];
    expect(writeKey).toBeDefined();

    const file = path.join(dir, "governance.json");
    writeFileSync(
      file,
      JSON.stringify({ global: { [writeKey as string]: true, [baselineKey as string]: false } }),
      "utf8",
    );

    const { code, json } = await runUniverseJson(["--file", file]);
    expect(code).toBe(0);
    expect(json.policy[writeKey as string]).toBe(true);
    expect(json.configSource[writeKey as string]).toBe("file");
    expect(json.policy[baselineKey as string]).toBe(false);
    expect(json.configSource[baselineKey as string]).toBe("file");

    // Env beats file for the SAME key (all env layers above all file layers).
    const envOverride = await runUniverseJson(["--file", file], {
      IRIS_GOVERNANCE: JSON.stringify({ global: { [baselineKey as string]: true } }),
    });
    expect(envOverride.json.policy[baselineKey as string]).toBe(true);
    expect(envOverride.json.configSource[baselineKey as string]).toBe("env");
    // …while the file-only key stays file-sourced.
    expect(envOverride.json.configSource[writeKey as string]).toBe("file");
  });

  it("a PROFILE layer in the file applies only to that profile's render", async () => {
    const baselineKey = [...GOVERNANCE_BASELINE][0];

    const file = path.join(dir, "governance.json");
    writeFileSync(
      file,
      JSON.stringify({ profiles: { prod: { [baselineKey as string]: false } } }),
      "utf8",
    );

    const prod = await runUniverseJson(["--file", file, "--profile", "prod"]);
    expect(prod.json.policy[baselineKey as string]).toBe(false);
    expect(prod.json.configSource[baselineKey as string]).toBe("file");

    const other = await runUniverseJson(["--file", file, "--profile", "default"]);
    expect(other.json.policy[baselineKey as string]).toBe(true);
    expect(other.json.configSource[baselineKey as string]).toBe("default");
  });

  it("preset read-only disables every write key with source 'preset' (including F2 default-enabled writes — read-only means read-only)", async () => {
    const { code, json } = await runUniverseJson([], { IRIS_GOVERNANCE_PRESET: "read-only" });
    expect(code).toBe(0);
    expect(json.preset).toBe("read-only");

    for (const key of json.keys) {
      if (json.mutates[key] === "write") {
        expect(json.policy[key], `write key ${key} must be disabled under read-only`).toBe(false);
        expect(json.configSource[key]).toBe("preset");
      } else {
        expect(json.policy[key], `read key ${key} must stay enabled under read-only`).toBe(true);
      }
    }
  });

  it("works with NO file at all (unlike get/set/unset/diff, universe never requires one)", async () => {
    const { code, json } = await runUniverseJson();
    expect(code).toBe(0);
    expect(json.file).toBeNull();
  });
});

// ── Dist resolution (--root, auto-detect, failure modes) ───────────────

describe("universe — dist resolution", () => {
  it("--root pointing at the monorepo ROOT resolves through its packages/ subdir", async () => {
    const { code, json } = await runUniverseJson(["--root", REPO_ROOT]);
    expect(code).toBe(0);
    expect(json.universeSource).toBe(path.join(REPO_ROOT, "packages"));
    expect(json.keys.length).toBeGreaterThan(GOVERNANCE_BASELINE.size);
  });

  it("--root pointing directly at the packages/ container also works", async () => {
    const { code, json } = await runUniverseJson(["--root", path.join(REPO_ROOT, "packages")]);
    expect(code).toBe(0);
    expect(json.keys.length).toBeGreaterThan(GOVERNANCE_BASELINE.size);
  });

  it("a --root with no locatable dist exits 1 naming every probed path (and emits the --json error object)", async () => {
    const { code, json, stderr } = await runUniverseJson(["--root", dir]);
    expect(code).toBe(1);
    expect(json.error).toBeDefined();
    expect(json.error).toContain("could not locate built tools");
    // Names the package and BOTH candidate layouts probed (monorepo dir name
    // + npm short name) so the operator can see exactly what was tried.
    expect(json.error).toContain("iris-dev-mcp");
    expect(json.error).toContain(path.join(dir, "iris-dev-mcp", "dist", "tools", "index.js"));
    expect(stderr).toContain("could not locate built tools");
  });

  it("an injected loader failure surfaces as exit 1 with the loader's message", async () => {
    const { deps, stdout } = baseDeps();
    deps.loadPackageTools = async () => {
      throw new Error("synthetic loader failure");
    };
    const code = await runCli(["universe", "--json"], deps);
    expect(code).toBe(1);
    expect((JSON.parse(stdout.text) as { error: string }).error).toContain(
      "synthetic loader failure",
    );
  });
});

// ── Derivation guards (injected loader) ────────────────────────────────

describe("universe — derivation guards (injected loader, never the real dist)", () => {
  function fakeTool(name: string, mutates?: "read" | "write"): ToolDefinition {
    // Minimal real shape: name + a zod-less inputSchema stand-in is NOT
    // enough for deriveKeysForTool (it reads inputSchema.shape.action), so
    // give it a plain shape object — a bare-name tool derives one key.
    return { name, inputSchema: { shape: {} }, mutates } as unknown as ToolDefinition;
  }

  it("a governance key produced by TWO packages is a hard error naming both origins (the baseline generator's duplicate guard, never a silent merge)", async () => {
    const { deps, stdout, stderr } = baseDeps();
    const loaded: LoadedPackage[] = [
      { pkg: "iris-dev-mcp", tools: [fakeTool("iris_dup")] },
      { pkg: "iris-ops-mcp", tools: [fakeTool("iris_dup")] },
    ];
    deps.loadPackageTools = async () => loaded;
    const code = await runCli(["universe", "--json"], deps);
    expect(code).toBe(1);
    const error = (JSON.parse(stdout.text) as { error: string }).error;
    expect(error).toContain('duplicate governance key "iris_dup"');
    expect(error).toContain("iris-dev-mcp/iris_dup");
    expect(error).toContain("iris-ops-mcp/iris_dup");
    expect(stderr.text).toContain("duplicate governance key");
  });

  it("a package tool named like the reserved framework tool is a hard error (never silently shadowed)", async () => {
    const { deps, stdout } = baseDeps();
    deps.loadPackageTools = async () => [
      { pkg: "iris-dev-mcp", tools: [fakeTool(SERVER_DISCOVERY_TOOL_NAME)] },
    ];
    const code = await runCli(["universe", "--json"], deps);
    expect(code).toBe(1);
    expect((JSON.parse(stdout.text) as { error: string }).error).toContain("reserved");
  });

  it("a malformed tool surface (missing inputSchema) fails loudly naming the tool — never a silent bare-name fallback", async () => {
    const { deps, stdout } = baseDeps();
    deps.loadPackageTools = async () => [
      { pkg: "iris-dev-mcp", tools: [{ name: "iris_broken" } as unknown as ToolDefinition] },
    ];
    const code = await runCli(["universe", "--json"], deps);
    expect(code).toBe(1);
    expect((JSON.parse(stdout.text) as { error: string }).error).toContain("iris_broken");
  });
});

// ── Usage errors + text mode ───────────────────────────────────────────

describe("universe — usage errors and text mode", () => {
  it("a positional argument exits 2 with usage", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["universe", "stray"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('"universe" takes no arguments');
    expect(stderr.text).toContain("Usage: iris-mcp-governance universe");
  });

  it("an unknown option exits 2", async () => {
    const { deps, stderr } = baseDeps();
    const code = await runCli(["universe", "--bogus"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain('Unknown option "--bogus"');
  });

  it("a reserved profile name exits 2 before any dist load", async () => {
    const { deps, stderr } = baseDeps();
    let loaderCalled = false;
    deps.loadPackageTools = async () => {
      loaderCalled = true;
      return [];
    };
    const code = await runCli(["universe", "--profile", "__proto__"], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain("reserved key");
    expect(loaderCalled).toBe(false);
  });

  it("--root \"\" is a usage error (exit 2), not a silent auto-detect — the 32.1 --file \"\" discipline (32.2 review)", async () => {
    const { deps, stderr } = baseDeps();
    let loaderCalled = false;
    deps.loadPackageTools = async () => {
      loaderCalled = true;
      return [];
    };
    const code = await runCli(["universe", "--root", ""], deps);
    expect(code).toBe(2);
    expect(stderr.text).toContain("--root requires a non-empty path");
    expect(loaderCalled).toBe(false);
  });

  it("an invalid governance FILE exits 1 with the server loader's exact text (and the --json error object)", async () => {
    const file = path.join(dir, "broken.json");
    writeFileSync(file, "{ not json", "utf8");
    const { code, json, stderr } = await runUniverseJson(["--file", file]);
    expect(code).toBe(1);
    expect(json.error).toBeDefined();
    expect(stderr).toContain("IRIS_GOVERNANCE_FILE is invalid");
  });

  it("text mode renders per-package groups, the framework group, and the note", async () => {
    const { deps, stdout } = baseDeps();
    const code = await runCli(["universe"], deps);
    expect(code).toBe(0);
    expect(stdout.text).toContain("Governance universe for profile");
    expect(stdout.text).toContain("iris-dev-mcp (");
    expect(stdout.text).toContain("framework (1 tool, 1 key):");
    expect(stdout.text).toContain(SERVER_DISCOVERY_TOOL_NAME);
    expect(stdout.text).toContain("(source: default, mutates:");
    expect(stdout.text).toContain("Note: ");
  });
});
