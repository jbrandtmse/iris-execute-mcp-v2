/**
 * Story 33.4 — QA E2E/edge layer ON TOP of the dev suite (the stage-brief
 * layer; dev's own coverage lives in `clients-cli-process.test.ts` §4b and
 * `certification-docs.test.ts`).
 *
 * Four surfaces, all driven through REAL child processes / REAL files:
 *
 *  1. Doctor config-drift edges the dev suite does not chain: a top-level
 *     non-object (`top-not-object`), empty/whitespace files (never a
 *     finding), a BOM-prefixed wrong-shape file, drift at PROJECT scope (cwd
 *     resolution), and drift COMPOSING with other finding classes in one
 *     report (envelope + plain-text renders; 33-5-14: drift earns no
 *     restart-hint block — a restart is a non-remedy for drift).
 *  2. `scripts/render-certification-table.mjs --check` is a GENUINE guard:
 *     run against a sandbox COPY of the package (script + results JSON +
 *     built dist/adapters.js + README), a hand-edit to either generated
 *     section makes --check exit 1, a bare run regenerates, and the roster
 *     guard refuses a missing/unknown certification record (exit 2).
 *  3. `scripts/certify.mjs` dry-run safety VERIFIED (never assumed): bare
 *     invocation / `run` without `--real-config` / unknown client / the
 *     detect gate / the refuse-to-clobber gate all exit WITHOUT writing —
 *     the results file hash is unchanged and the sandbox HOME stays clean.
 *  4. The Kimi `.mcp.json` falsification pins independently re-verified
 *     (Rule #56 — a stale mention is a finding): the BUILT dist adapter data
 *     has no kimi-code `.mcp.json` fallback, the generated README table row
 *     names only `.kimi-code/mcp.json`, and every `.mcp.json` mention on a
 *     Kimi-related line across the docs is a negated/falsification one.
 *
 * Every expected string below was pinned by RUNNING the built CLI / scripts
 * on 2026-07-28 (Rule #36) — capture commands mirrored the test bodies.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it, afterEach } from "vitest";

import { ADAPTER_DATA_VERSION } from "../adapters.js";

import { readFixture } from "./helpers.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "dist", "cli", "clients-cli.js");
const RENDERER = path.join(PACKAGE_ROOT, "scripts", "render-certification-table.mjs");
const CERTIFY = path.join(PACKAGE_ROOT, "scripts", "certify.mjs");
const RESULTS_PATH = path.join(PACKAGE_ROOT, "scripts", "certification-results.json");

const T = 120_000;

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop() as string;
    rmSync(dir, { recursive: true, force: true });
  }
});

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** A real-fs sandbox HOME + child-process runner for the BUILT bin — the
 * same shape as clients-cli-process.test.ts (child env built from scratch so
 * no developer-shell variable leaks in). */
function makeCliSandbox(): {
  home: string;
  project: string;
  run: (args: string[]) => RunResult;
  configPath: (client: "claude-code") => string;
} {
  const home = mkTmp("qa334-home-");
  const project = mkTmp("qa334-proj-");
  const run = (args: string[]): RunResult => {
    const result = spawnSync(process.execPath, [BIN, ...args], {
      cwd: project,
      env: {
        PATH: process.env.PATH ?? "",
        PATHEXT: process.env.PATHEXT ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        windir: process.env.windir ?? "",
        TEMP: process.env.TEMP ?? "",
        TMP: process.env.TMP ?? "",
        HOME: home,
        USERPROFILE: home,
        APPDATA: path.join(home, "AppData", "Roaming"),
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  return {
    home,
    project,
    run,
    configPath: () => path.join(home, ".claude.json"),
  };
}

interface DoctorData {
  findings: Array<{
    check: string;
    client: string;
    scope: string;
    path: string | null;
    expected?: string;
    found?: string;
    adapterDataVersion?: string;
    detail: string;
  }>;
  findingCount: number;
  restartHints: Array<{ client: string; hint: string }>;
}

function parseDoctor(result: RunResult): DoctorData {
  let parsed: { data: DoctorData };
  try {
    parsed = JSON.parse(result.stdout) as { data: DoctorData };
  } catch {
    throw new Error(`stdout was not a JSON envelope:\n${result.stdout}\n(stderr: ${result.stderr})`);
  }
  return parsed.data;
}

// ════════════════════════════════════════════════════════════════════
// 1. Doctor config-drift edges through the BUILT bin.
// ════════════════════════════════════════════════════════════════════

describe("QA 33.4: doctor config-drift edges (process level)", () => {
  it("a top-level NON-OBJECT file is config-drift (top-not-object), never parseability, and NO restart hint (33-5-14)", () => {
    const sandbox = makeCliSandbox();
    const target = sandbox.configPath("claude-code");
    writeFileSync(target, readFixture("drift/top-array.json"));

    const result = sandbox.run(["doctor", "--json"]);
    expect(result.status).toBe(1);
    const data = parseDoctor(result);
    const drift = data.findings.filter((finding) => finding.check === "config-drift");
    expect(drift).toHaveLength(1);
    // Pinned from the live run (2026-07-28, adapter data 2026-07-28.1).
    expect(drift[0]).toMatchObject({
      client: "claude-code",
      scope: "user",
      path: target,
      expected: 'a top-level object holding root key "mcpServers"',
      found: "an array (3 item(s))",
      adapterDataVersion: ADAPTER_DATA_VERSION,
    });
    expect(drift[0]!.detail).toContain("adapter-data patch + fixture update, never engine code");
    expect(data.findings.some((finding) => finding.check === "parseability")).toBe(false);
    // 33-5-14: drift earns NO restart hint — a restart does not remedy drift
    // (the fix is an adapter-data patch); only parseability/present-disabled do.
    expect(data.restartHints.map((hint) => hint.client)).not.toContain("claude-code");
    expect(data.findingCount).toBe(data.findings.length);
  }, T);

  it.each([
    ["empty", ""],
    ["whitespace-only", "  \n\t \n"],
  ])("an %s config file produces NO finding (exit 0)", (_label, content) => {
    const sandbox = makeCliSandbox();
    writeFileSync(sandbox.configPath("claude-code"), content);
    const result = sandbox.run(["doctor", "--json"]);
    expect(result.status).toBe(0);
    const data = parseDoctor(result);
    expect(data.findingCount).toBe(0);
  }, T);

  it("a BOM-prefixed wrong-shape file is config-drift (the diagnoser strips the BOM), not parseability", () => {
    const sandbox = makeCliSandbox();
    writeFileSync(
      sandbox.configPath("claude-code"),
      // A real UTF-8 BOM (written by Windows editors) ahead of a wrong-shape root key.
      "\uFEFF{\"mcpServers\": [\"not\", \"an\", \"object\"]}",
    );
    const result = sandbox.run(["doctor", "--json"]);
    expect(result.status).toBe(1);
    const data = parseDoctor(result);
    const drift = data.findings.filter((finding) => finding.check === "config-drift");
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      expected: 'root key "mcpServers" holding an object of server entries',
      found: "an array (3 item(s))",
      adapterDataVersion: ADAPTER_DATA_VERSION,
    });
    expect(data.findings.some((finding) => finding.check === "parseability")).toBe(false);
  }, T);

  it("drift at PROJECT scope: a wrong-shaped .mcp.json in the cwd is found with scope \"project\"", () => {
    const sandbox = makeCliSandbox();
    // A clean user-scope config (parses, correct shape) isolates the project finding.
    writeFileSync(sandbox.configPath("claude-code"), JSON.stringify({ mcpServers: {} }, null, 2));
    const projectConfig = path.join(sandbox.project, ".mcp.json");
    writeFileSync(projectConfig, JSON.stringify({ mcpServers: 42 }));

    const result = sandbox.run(["doctor", "--json"]);
    expect(result.status).toBe(1);
    const data = parseDoctor(result);
    const drift = data.findings.filter((finding) => finding.check === "config-drift");
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      client: "claude-code",
      scope: "project",
      path: projectConfig,
      expected: 'root key "mcpServers" holding an object of server entries',
      found: "a number",
      adapterDataVersion: ADAPTER_DATA_VERSION,
    });
  }, T);

  it("drift COMPOSES with other finding classes in one report (envelope + plain-text restart hints)", () => {
    const sandbox = makeCliSandbox();
    writeFileSync(sandbox.configPath("claude-code"), readFixture("drift/top-array.json"));
    // A stale backup (2020 stamp) alongside the drifted config.
    const backupDir = path.join(sandbox.home, ".iris-mcp", "client-manager", "backups", "claude-code", "user");
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(path.join(backupDir, ".claude.json.2020-01-01T00-00-00-000Z"), "{}");

    // --json: both classes in ONE envelope, derived count. 33-5-14: neither
    // config-drift nor stale-backups earns a restart hint (non-remedies).
    const json = sandbox.run(["doctor", "--json"]);
    expect(json.status).toBe(1);
    const data = parseDoctor(json);
    const checks = data.findings.map((finding) => finding.check).sort();
    expect(checks).toEqual(["config-drift", "stale-backups"]);
    expect(data.findingCount).toBe(2);
    expect(data.restartHints).toEqual([]);

    // Plain text: both groups render with per-class counts; no hint block.
    const text = sandbox.run(["doctor"]);
    expect(text.status).toBe(1);
    expect(text.stdout).toContain("config-drift (1):");
    expect(text.stdout).toContain("stale-backups (1):");
    expect(text.stdout).toContain("2 finding(s).");
    expect(text.stdout).toContain(ADAPTER_DATA_VERSION);
    expect(text.stdout).not.toContain("Restart hints:");
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 2. render-certification-table.mjs — the --check guard is GENUINE.
//    Runs against a sandbox COPY of the package so the real README/results
//    are never touched. dist/adapters.js is self-contained (zero imports —
//    verified), so the copy needs only the four files.
// ════════════════════════════════════════════════════════════════════

function makePkgSandbox(): { pkg: string; run: (args: string[]) => RunResult; readmePath: string; resultsPath: string } {
  const pkg = mkTmp("qa334-pkg-");
  mkdirSync(path.join(pkg, "scripts"), { recursive: true });
  mkdirSync(path.join(pkg, "dist"), { recursive: true });
  cpSync(RENDERER, path.join(pkg, "scripts", "render-certification-table.mjs"));
  cpSync(RESULTS_PATH, path.join(pkg, "scripts", "certification-results.json"));
  cpSync(path.join(PACKAGE_ROOT, "dist", "adapters.js"), path.join(pkg, "dist", "adapters.js"));
  cpSync(path.join(PACKAGE_ROOT, "README.md"), path.join(pkg, "README.md"));
  const run = (args: string[]): RunResult => {
    const result = spawnSync(process.execPath, [path.join(pkg, "scripts", "render-certification-table.mjs"), ...args], {
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  return {
    pkg,
    run,
    readmePath: path.join(pkg, "README.md"),
    resultsPath: path.join(pkg, "scripts", "certification-results.json"),
  };
}

/** Mutate the sandbox README, asserting the anchor existed (a no-op mutation
 * would make the out-of-sync assertion vacuous). */
function mutateReadme(readmePath: string, anchor: string, replacement: string): void {
  const readme = readFileSync(readmePath, "utf8");
  expect(readme.includes(anchor), `mutation anchor missing: ${anchor}`).toBe(true);
  writeFileSync(readmePath, readme.replace(anchor, replacement), "utf8");
}

describe("QA 33.4: render-certification-table --check guard (real script, sandbox package)", () => {
  it("a pristine copy passes --check; a hand-edited ADAPTER table row fails it (exit 1)", () => {
    const sandbox = makePkgSandbox();
    expect(sandbox.run(["--check"]).status).toBe(0);

    mutateReadme(
      sandbox.readmePath,
      "| **certified-live** 2026-07-28 (incl. agent CLI probe) |",
      "| fixture-only (residual risk) |",
    );
    const result = sandbox.run(["--check"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("OUT OF SYNC");
  }, T);

  it("a hand-edited CERTIFICATION disposition section fails --check (exit 1)", () => {
    const sandbox = makePkgSandbox();
    mutateReadme(
      sandbox.readmePath,
      "#### Claude Code (`claude-code`)",
      "#### Claude Code MUTATED (`claude-code`)",
    );
    const result = sandbox.run(["--check"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("OUT OF SYNC");
  }, T);

  it("a bare run REGENERATES the edited section (the mutation is overwritten; --check passes again)", () => {
    const sandbox = makePkgSandbox();
    mutateReadme(
      sandbox.readmePath,
      "| **certified-live** 2026-07-28 (incl. agent CLI probe) |",
      "| fixture-only (residual risk) EDITED |",
    );
    expect(sandbox.run(["--check"]).status).toBe(1);

    const regen = sandbox.run([]);
    expect(regen.status).toBe(0);
    expect(regen.stdout).toContain("regenerated");
    expect(readFileSync(sandbox.readmePath, "utf8")).not.toContain("EDITED");
    expect(sandbox.run(["--check"]).status).toBe(0);
  }, T);

  it("the roster guard refuses a MISSING certification record (exit 2, naming the id)", () => {
    const sandbox = makePkgSandbox();
    const results = JSON.parse(readFileSync(sandbox.resultsPath, "utf8")) as { clients: Record<string, unknown> };
    delete results.clients["goose"];
    writeFileSync(sandbox.resultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

    const result = sandbox.run(["--check"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("roster mismatch");
    expect(result.stderr).toContain("goose");
    // The README is never written on a roster refusal.
    expect(readFileSync(sandbox.readmePath, "utf8")).toBe(readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8"));
  }, T);

  it("the roster guard refuses an UNKNOWN certification record (exit 2, naming the id)", () => {
    const sandbox = makePkgSandbox();
    const results = JSON.parse(readFileSync(sandbox.resultsPath, "utf8")) as { clients: Record<string, unknown> };
    results.clients["bogus-client"] = { disposition: "fixture-only-with-residual-risk", date: "2026-07-28", note: "x" };
    writeFileSync(sandbox.resultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

    const result = sandbox.run(["--check"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("roster mismatch");
    expect(result.stderr).toContain("bogus-client");
  }, T);

  it("the roster guard refuses an UNKNOWN DISPOSITION (exit 2, naming the id) — never relabels it fixture-only (33-4-R1)", () => {
    const sandbox = makePkgSandbox();
    const results = JSON.parse(readFileSync(sandbox.resultsPath, "utf8")) as { clients: Record<string, unknown> };
    // certify.mjs itself writes this disposition after a failed pass; the
    // pre-fix renderer rendered it as "fixture-only-with-residual-risk —
    // undefined" (a dishonest label + a literal undefined).
    results.clients["goose"] = {
      disposition: "certification-failed-see-story",
      date: "2026-07-28",
      host: "win32/x64",
      server: "iris-mcp-all",
      steps: ["FAIL add (engine apply)"],
      evidence: ["FAIL add (engine apply) — boom"],
    };
    writeFileSync(sandbox.resultsPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

    const result = sandbox.run(["--check"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown disposition");
    expect(result.stderr).toContain("goose");
    // And a bare regeneration run refuses identically (no silent rewrite).
    const regen = sandbox.run([]);
    expect(regen.status).toBe(2);
    expect(readFileSync(sandbox.readmePath, "utf8")).toBe(readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8"));
  }, T);

  it("a README missing a marker pair is a hard error (exit 2), never a silent rewrite", () => {
    const sandbox = makePkgSandbox();
    mutateReadme(sandbox.readmePath, "<!-- ADAPTER-TABLE:BEGIN -->", "<!-- ADAPTER-TABLE:REMOVED -->");
    const result = sandbox.run(["--check"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("missing the <!-- ADAPTER-TABLE:BEGIN -->");
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 3. certify.mjs — no writes without the FULL explicit pass, VERIFIED.
//    The REAL script runs against a sandbox HOME; every gate below exits
//    BEFORE the pass body (the only write sites — engine apply and the
//    results-file record — are never reached). Both are asserted.
// ════════════════════════════════════════════════════════════════════

const md5 = (file: string): string => createHash("md5").update(readFileSync(file)).digest("hex");

function runCertify(args: string[], home?: string): RunResult {
  const result = spawnSync(process.execPath, [CERTIFY, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    env: home === undefined
      ? process.env
      : {
          PATH: process.env.PATH ?? "",
          PATHEXT: process.env.PATHEXT ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          windir: process.env.windir ?? "",
          TEMP: process.env.TEMP ?? "",
          TMP: process.env.TMP ?? "",
          HOME: home,
          USERPROFILE: home,
          APPDATA: path.join(home, "AppData", "Roaming"),
        },
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Every entry under `dir` (relative, recursive) — the "sandbox stayed clean" witness. */
function treeEntries(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, name.name);
      out.push(path.relative(dir, full));
      if (name.isDirectory()) walk(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

describe("QA 33.4: certify.mjs writes nothing without the full explicit pass", () => {
  it("a bare invocation prints the no-op plan (exit 0) and leaves the results file untouched", () => {
    const before = md5(RESULTS_PATH);
    const result = runCertify([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("does NOTHING");
    expect(result.stdout).toContain("--real-config");
    expect(md5(RESULTS_PATH)).toBe(before);
  }, T);

  it("`run <client>` WITHOUT --real-config refuses (exit 2) and writes nothing", () => {
    const home = mkTmp("qa334-cert-home-");
    const before = md5(RESULTS_PATH);
    const result = runCertify(["run", "claude-code"], home);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("does NOTHING");
    expect(md5(RESULTS_PATH)).toBe(before);
    expect(treeEntries(home)).toEqual([]);
  }, T);

  it("an unknown client id refuses (exit 2) and writes nothing", () => {
    const home = mkTmp("qa334-cert-home-");
    const before = md5(RESULTS_PATH);
    const result = runCertify(["run", "not-a-client", "--real-config"], home);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("a client id is required");
    expect(md5(RESULTS_PATH)).toBe(before);
    expect(treeEntries(home)).toEqual([]);
  }, T);

  it("the detect gate: --real-config on a host WITHOUT the client refuses (exit 2) — no state dir, no writes", () => {
    const home = mkTmp("qa334-cert-home-");
    const before = md5(RESULTS_PATH);
    const result = runCertify(["run", "claude-code", "--real-config"], home);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("claude-code is not detected on this machine");
    expect(result.stderr).toContain("fixture-only-with-residual-risk");
    expect(md5(RESULTS_PATH)).toBe(before);
    expect(existsSync(path.join(home, ".iris-mcp"))).toBe(false);
    expect(treeEntries(home)).toEqual([]);
  }, T);

  it("the clobber gate: --real-config with the server ALREADY present refuses (exit 2) — config byte-identical", () => {
    const home = mkTmp("qa334-cert-home-");
    const configPath = path.join(home, ".claude.json");
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { "iris-dev-mcp": { command: "npx", args: ["-y", "@iris-mcp/dev"] } } }, null, 2),
    );
    const originalBytes = readFileSync(configPath, "utf8");
    const before = md5(RESULTS_PATH);

    const result = runCertify(["run", "claude-code", "--real-config"], home);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("refusing to clobber a real entry");
    // AC 33.5.6d: the refusal names the restore recovery path.
    expect(result.stderr).toContain("iris-mcp-clients restore --client claude-code");
    expect(readFileSync(configPath, "utf8")).toBe(originalBytes);
    expect(md5(RESULTS_PATH)).toBe(before);
    // Only the config we planted exists — no manager state, no backups.
    expect(treeEntries(home)).toEqual([".claude.json"]);
  }, T);

  it("AC 33.5.6c: a client with no scripted verification surface fails BEFORE detection/writes (exit 2)", () => {
    const home = mkTmp("qa334-cert-home-");
    const before = md5(RESULTS_PATH);
    // cursor IS in the adapter roster but has no scripted verifier; the gate
    // fires before the detect probe (cursor would otherwise fail "not
    // detected" — the unsupported-surface message proves the ordering).
    const result = runCertify(["run", "cursor", "--real-config"], home);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no scripted verification surface");
    expect(result.stderr).toContain("BEFORE any real-config write");
    expect(md5(RESULTS_PATH)).toBe(before);
    expect(treeEntries(home)).toEqual([]);
  }, T);

  it("33-5-17: the usage roster is derived from CLIENT_ADAPTERS (the full 13, never a hand-mirrored subset)", async () => {
    const { CLIENT_ADAPTERS } = await import("../adapters.js");
    const result = runCertify([]);
    expect(result.status).toBe(0);
    for (const id of Object.keys(CLIENT_ADAPTERS)) {
      expect(result.stdout).toContain(id);
    }
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 4. Kimi `.mcp.json` falsification pins — independent re-verification
//    (Rule #56: a stale positive mention anywhere is a finding).
// ════════════════════════════════════════════════════════════════════

describe("QA 33.4: the falsified kimi-code .mcp.json fallback is consistently ABSENT", () => {
  it("the BUILT dist adapter data has no .mcp.json anywhere in kimi-code (and claude-code keeps its own)", async () => {
    const dist = (await import(pathToFileURL(path.join(PACKAGE_ROOT, "dist", "adapters.js")).href)) as {
      CLIENT_ADAPTERS: Record<string, {
        scopes: Array<{ scope: string; paths: Record<string, string>; fallbacks?: Array<Record<string, string>> }>;
      }>;
    };
    const kimiCode = dist.CLIENT_ADAPTERS["kimi-code"];
    expect(kimiCode, "kimi-code adapter exists in the built dist").toBeDefined();
    for (const scope of kimiCode!.scopes) {
      for (const platform of ["win32", "darwin", "linux"] as const) {
        expect(scope.paths[platform], `kimi-code ${scope.scope}/${platform}`).not.toBe(".mcp.json");
      }
      expect(scope.fallbacks, `kimi-code ${scope.scope} fallbacks`).toBeUndefined();
    }
    const project = kimiCode!.scopes.find((scope) => scope.scope === "project");
    expect(project?.paths.win32).toBe(".kimi-code/mcp.json");
    // Negative space: the removal was scoped to kimi-code — claude-code's
    // legitimate repo-root .mcp.json project path is untouched.
    const claudeProject = dist.CLIENT_ADAPTERS["claude-code"]?.scopes.find((scope) => scope.scope === "project");
    expect(claudeProject?.paths.win32).toBe(".mcp.json");
  });

  it("the generated README adapter-table row for kimi-code names ONLY .kimi-code/mcp.json", () => {
    const readme = readFileSync(path.join(PACKAGE_ROOT, "README.md"), "utf8");
    const row = readme.split("\n").find((line) => line.startsWith("| Kimi Code (`kimi-code`)"));
    expect(row, "kimi-code adapter-table row exists").toBeDefined();
    expect(row).toContain("`.kimi-code/mcp.json`");
    // A bare repo-root `.mcp.json` cell in the kimi-code row would be the
    // stale fallback resurfacing (`.kimi-code/mcp.json` never matches this).
    expect(row).not.toMatch(/(?<![\w/-])\.mcp\.json/);
  });

  it("every .mcp.json mention on a Kimi-related line (or inside the docs' Kimi Code section) is negated/falsification", () => {
    const NEGATION = /NOT|falsif|never|does not|removed|only/i;
    const targets: Array<{ file: string; line: string }> = [];

    const docsIndex = readFileSync(path.join(REPO_ROOT, "docs", "client-config", "README.md"), "utf8");
    const docsLines = docsIndex.split("\n");
    // The whole "## Kimi Code" section (a stale claim could drop the word "Kimi").
    const sectionStart = docsLines.findIndex((line) => line.startsWith("## Kimi Code"));
    expect(sectionStart, "docs index has a Kimi Code section").toBeGreaterThan(-1);
    const sectionEnd = docsLines.findIndex((line, index) => index > sectionStart && line.startsWith("## "));
    for (const line of docsLines.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd)) {
      targets.push({ file: "docs/client-config/README.md##KimiCode", line });
    }

    for (const rel of [
      "README.md",
      path.join("packages", "client-config", "README.md"),
      path.join("docs", "client-config", "README.md"),
    ]) {
      for (const line of readFileSync(path.join(REPO_ROOT, rel), "utf8").split("\n")) {
        if (/kimi/i.test(line)) targets.push({ file: rel, line });
      }
    }

    const offenders = targets.filter(
      ({ line }) => /(?<![\w/-])\.mcp\.json/.test(line) && !NEGATION.test(line),
    );
    expect(
      offenders,
      `stale positive .mcp.json mentions for Kimi:\n${offenders.map((o) => `${o.file}: ${o.line}`).join("\n")}`,
    ).toEqual([]);
  });

  it("the certification record itself carries the falsification (kimiSide + consequence)", () => {
    const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as {
      clients: Record<string, {
        ac3344?: { mcpJsonSharing?: { kimiSide?: string; consequence?: string } };
      }>;
    };
    const sharing = results.clients["kimi-code"]?.ac3344?.mcpJsonSharing;
    expect(sharing, "kimi-code record carries ac3344.mcpJsonSharing").toBeDefined();
    expect(sharing?.kimiSide).toMatch(/FALSIFIED/);
    expect(sharing?.consequence).toMatch(/fallback was REMOVED/);
    expect(sharing?.consequence).toContain(ADAPTER_DATA_VERSION);
  });
});
