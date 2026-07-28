/**
 * Story 33.2 — `iris-mcp-clients` CLI suite.
 *
 * Drives `runCli(argv, deps)` (the pure core in `src/cli/clients.ts`) with an
 * injected MemFs sandbox (never the real HOME), covering: the exit-code
 * contract (0/1/2), the stable `--json` envelope, help-scan discipline, the
 * VALUED_OPTIONS single-sourcing pin (32-4-R1, from day one), the AC 33.2-I1
 * no-reimplemented-engine-logic source-scan pin, read commands (detect/
 * status/diff) with AC 33.2.4 derived counts, write commands (apply with
 * diff-first + confirmation, enable/disable/remove/restore) incl. the
 * server-manager/governance-file host-probe gating and the explicit-mode
 * secret discipline, and doctor (env-reference resolvability, stale backups,
 * orphaned stashes, the 33-1-R5 unrecorded-entry repair).
 *
 * Rule #54: interactive behavior is injected through the `promptConfirm` /
 * `promptPassword` seams (never fake stream internals); `--password-stdin`
 * tests use a REAL `Readable` (a shape Node genuinely produces).
 */

import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { runCli, VALUED_OPTIONS, type CliDeps } from "../cli/clients.js";
import { ADAPTER_DATA_VERSION, CLIENT_ADAPTERS, CLIENT_DISPOSITIONS } from "../adapters.js";
import { detectClients } from "../detect.js";
import { buildStatusMatrix } from "../status.js";
import { readState, resolveStateDir, stateFilePath } from "../state.js";

import { MemFs, fixedNow, readFixture } from "./helpers.js";

// ════════════════════════════════════════════════════════════════════
// Test harness.
// ════════════════════════════════════════════════════════════════════

const HOME = "/home/u";
const PROJECT = "/proj";

interface Collected {
  text: string;
}

function collector(): { out: Collected; write: (chunk: string) => void } {
  const out: Collected = { text: "" };
  return { out, write: (chunk: string) => void (out.text += chunk) };
}

interface Harness {
  fs: MemFs;
  stdout: Collected;
  stderr: Collected;
  deps: CliDeps;
  run: (argv: string[]) => Promise<number>;
}

function harness(overrides: CliDeps = {}, env: Record<string, string | undefined> = {}): Harness {
  const fs = new MemFs();
  const stdout = collector();
  const stderr = collector();
  const deps: CliDeps = {
    env,
    platform: "linux",
    homeDir: HOME,
    projectDir: PROJECT,
    fs,
    stdout,
    stderr,
    now: fixedNow(1, 2, 3, 4, 5, 6, 7, 8),
    ...overrides,
  };
  return {
    fs,
    stdout: stdout.out,
    stderr: stderr.out,
    deps,
    run: (argv) => runCli(argv, deps),
  };
}

/** Seed the three sandbox format-family fixtures (Claude Code JSON, Codex TOML, Goose YAML). */
function seedFamilies(fs: MemFs): void {
  fs.seed(`${HOME}/.claude.json`, readFixture("claude-code/user.json"));
  fs.seed(`${HOME}/.codex/config.toml`, readFixture("codex/config.toml"));
  fs.seed(`${HOME}/.config/goose/config.yaml`, readFixture("goose/config.yaml"));
}

/** A REAL Readable carrying `text` (a genuine Node stream shape) with a settable isTTY. */
function stdinFrom(text: string, isTTY = false): Readable & { isTTY?: boolean } {
  const stream = Readable.from([text]);
  (stream as { isTTY?: boolean }).isTTY = isTTY;
  return stream as Readable & { isTTY?: boolean };
}

function stateDirOf(deps: CliDeps): string {
  return resolveStateDir({
    platform: "linux",
    env: deps.env ?? {},
    homeDir: HOME,
    projectDir: PROJECT,
    ...(deps.stateDir !== undefined ? { stateDir: deps.stateDir } : {}),
  });
}

// ════════════════════════════════════════════════════════════════════
// Task 1 — scaffold: usage errors, help discipline, single-sourcing pins.
// ════════════════════════════════════════════════════════════════════

describe("scaffold — exit codes and usage discipline (AC 33.2.3)", () => {
  it("no command exits 2 with help on stderr", async () => {
    const h = harness();
    expect(await h.run([])).toBe(2);
    expect(h.stderr.text).toContain("no command given");
  });

  it("unknown command exits 2 naming the valid commands", async () => {
    const h = harness();
    expect(await h.run(["frobnicate"])).toBe(2);
    expect(h.stderr.text).toContain('unknown command "frobnicate"');
    expect(h.stderr.text).toContain("detect, status, diff, apply, enable, disable, remove, restore, doctor");
  });

  it("--help prints help and exits 0 (also after a command)", async () => {
    const h = harness();
    expect(await h.run(["--help"])).toBe(0);
    expect(h.stdout.text).toContain("Usage: iris-mcp-clients <command> [options]");
    const h2 = harness();
    expect(await h2.run(["apply", "--help"])).toBe(0);
    expect(h2.stdout.text).toContain("Usage: iris-mcp-clients");
  });

  it("help is NOT honored after the -- terminator (32-1-R4)", async () => {
    const h = harness();
    // "--help" lands in POSITIONAL position: diff rejects positionals (exit 2), no help printed.
    expect(await h.run(["diff", "--", "--help"])).toBe(2);
    expect(h.stdout.text).not.toContain("Usage: iris-mcp-clients");
  });

  it("help is NOT honored as a valued option's value (32-1-R4)", async () => {
    const h = harness();
    // "--help" is --client's VALUE: an unknown-client usage error, not help.
    expect(await h.run(["apply", "--client", "--help", "--servers", "all", "--yes"])).toBe(2);
    expect(h.stderr.text).toContain('unknown client "--help"');
    expect(h.stdout.text).not.toContain("Usage: iris-mcp-clients");
  });

  it("unknown option exits 2", async () => {
    const h = harness();
    expect(await h.run(["status", "--frobnicate"])).toBe(2);
    expect(h.stderr.text).toContain('Unknown option "--frobnicate"');
  });

  it("a valued option missing its value exits 2", async () => {
    const h = harness();
    expect(await h.run(["apply", "--client"])).toBe(2);
    expect(h.stderr.text).toContain('Option "--client" requires a value');
  });
});

describe("32-4-R1 — VALUED_OPTIONS single-sourcing pin (day one)", () => {
  it("every parseArgs call site's allowed options are a subset of VALUED_OPTIONS, and helpRequested consumes the same set", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../cli/clients.ts", import.meta.url), "utf8");
    const callSites = [...source.matchAll(/parseArgs\(\s*(?:args|rest)\s*,\s*\[[^\]]*\]\s*,\s*\[([^\]]*)\]/g)];
    expect(callSites.length).toBeGreaterThanOrEqual(6);
    const used = new Set<string>();
    for (const site of callSites) {
      for (const opt of site[1]!.match(/"--[a-z-]+"/g) ?? []) used.add(opt.slice(1, -1));
    }
    for (const opt of used) {
      expect(VALUED_OPTIONS.has(opt), `parseArgs option ${opt} missing from VALUED_OPTIONS`).toBe(true);
    }
    // helpRequested must skip values for exactly the same set — a second
    // hand-maintained literal is the defect this pin exists to catch.
    expect(source).toContain("const valuedOptions = VALUED_OPTIONS");
    expect(source).not.toMatch(/const valuedOptions = new Set\(/);
    // SYNTH_OPTIONS is itself a subset (it feeds the diff/apply call sites).
    const synth = source.match(/const SYNTH_OPTIONS = \[([\s\S]*?)\] as const/);
    expect(synth).not.toBeNull();
    for (const opt of synth![1]!.match(/"--[a-z-]+"/g) ?? []) {
      expect(VALUED_OPTIONS.has(opt.slice(1, -1)), `SYNTH_OPTIONS option ${opt} missing from VALUED_OPTIONS`).toBe(true);
    }
  });
});

describe("AC 33.2-I1 — the CLI re-implements no engine logic (mechanical pin)", () => {
  it("no parser imports and no edit mechanics in the CLI files; engine functions are imported", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["../cli/clients.ts", "../cli/clients-cli.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, `${file} must not import jsonc-parser`).not.toMatch(/from "jsonc-parser"/);
      expect(source, `${file} must not import smol-toml`).not.toMatch(/from "smol-toml"/);
      expect(source, `${file} must not import yaml`).not.toMatch(/from "yaml"/);
      expect(source, `${file} must not execute edits`).not.toMatch(/applyEdits\(|modify\(|parseDocument\(/);
    }
    const core = readFileSync(new URL("../cli/clients.ts", import.meta.url), "utf8");
    // The engine surface is CONSUMED, not re-implemented (33.2-I1).
    for (const fn of ["apply", "enable", "disable", "remove", "restore", "ensureInputs"]) {
      expect(core).toContain(`../engine.js`);
      expect(core).toMatch(new RegExp(`\\b${fn}\\b`));
    }
    expect(core).toContain(`from "../detect.js"`);
    expect(core).toContain(`from "../status.js"`);
    expect(core).toContain(`from "../diff.js"`);
    expect(core).toContain(`from "../synthesize.js"`);
  });
});

// ════════════════════════════════════════════════════════════════════
// Task 2 — read commands: detect / status / diff (AC 33.2.1, AC 33.2.4).
// ════════════════════════════════════════════════════════════════════

describe("detect", () => {
  it("renders detected/not-detected clients with counts DERIVED from the report (AC 33.2.4)", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(await h.run(["detect"])).toBe(0);
    expect(h.stdout.text).toContain("Claude Code (claude-code) — detected");
    expect(h.stdout.text).toContain("Codex CLI (codex) — detected");
    expect(h.stdout.text).toContain("Cursor (cursor) — not detected");
    // Dispositions rows (Pi info, JetBrains/Kilo roadmap).
    expect(h.stdout.text).toContain("excluded-not-mcp-capable");
    expect(h.stdout.text).toContain("roadmap");
    // The printed counts are recomputed HERE from the same report — a
    // hand-authored count in the CLI copy fails this test (AC 33.2.4).
    const report = detectClients(
      { platform: "linux", env: {}, homeDir: HOME, projectDir: PROJECT },
      h.fs,
    );
    const detected = report.clients.filter((client) => client.detected).length;
    const probed = report.clients.length;
    const undetected = report.clients.filter((client) => !client.detected).length;
    expect(h.stdout.text).toContain(
      `${detected} of ${probed} clients detected; ${undetected} not detected; 3 other dispositions.`,
    );
  });

  it("--json emits the stable envelope with derived counts", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(await h.run(["detect", "--json"])).toBe(0);
    const payload = JSON.parse(h.stdout.text) as {
      ok: boolean;
      command: string;
      data: { counts: { probed: number; detected: number; notDetected: number; dispositioned: number } };
    };
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("detect");
    expect(payload.data.counts.probed).toBe(payload.data.counts.detected + payload.data.counts.notDetected);
    expect(payload.data.counts.dispositioned).toBe(3);
  });

  // Story 33.3 (sanctioned additive, lead Option-1 decision 2026-07-28): the
  // --json envelope carries the SAME dispositions the text render prints under
  // "Other clients:" — the extension UI reads them structured, never a
  // text-render scrape.
  it("--json carries the dispositions array, exactly the CLIENT_DISPOSITIONS data (id/displayName/disposition/reason)", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(await h.run(["detect", "--json"])).toBe(0);
    const payload = JSON.parse(h.stdout.text) as {
      ok: boolean;
      command: string;
      data: {
        dispositions: { id: string; displayName: string; disposition: string; reason: string }[];
        counts: { dispositioned: number };
      };
    };
    // The count and the array agree (derived from the same source, AC 33.2.4).
    expect(payload.data.dispositions).toHaveLength(payload.data.counts.dispositioned);
    // Every row is exactly the four documented fields, in registry order.
    for (const row of payload.data.dispositions) {
      expect(Object.keys(row).sort()).toEqual(["displayName", "disposition", "id", "reason"]);
    }
    expect(payload.data.dispositions.map((row) => row.id)).toEqual(
      CLIENT_DISPOSITIONS.map((row) => row.id),
    );
    expect(payload.data.dispositions).toEqual([...CLIENT_DISPOSITIONS]);
    // The Pi row the UI renders as its "not MCP-capable" info row is present
    // with its rationale.
    const pi = payload.data.dispositions.find((row) => row.id === "pi");
    expect(pi?.disposition).toBe("excluded-not-mcp-capable");
    expect(pi?.reason).toContain("no built-in MCP support");
  });
});

describe("status", () => {
  it("renders the matrix with foreign names only and a derived managed-entry count", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(await h.run(["status"])).toBe(0);
    expect(h.stdout.text).toContain("iris-dev-mcp");
    expect(h.stdout.text).toContain("present-enabled");
    expect(h.stdout.text).toContain("foreign (names only): github-mcp");
    // Secret-looking foreign VALUES never surface.
    expect(h.stdout.text).not.toContain("ghp_foreignSecretValue123");
    // AC 33.2.4: recompute the managed count from the matrix itself.
    const report = buildStatusMatrix({ platform: "linux", env: {}, homeDir: HOME, projectDir: PROJECT }, h.fs);
    let managed = 0;
    for (const client of report.clients) {
      for (const scope of client.scopes) {
        for (const server of scope.servers) if (server.state !== "absent") managed++;
      }
    }
    expect(h.stdout.text).toContain(`${report.clients.length} clients detected; ${managed} managed server entries present.`);
  });

  it("an unparseable config renders UNPARSEABLE, never a crash", async () => {
    const h = harness();
    h.fs.seed(`${HOME}/.claude.json`, readFixture("malformed/bad.jsonc"));
    expect(await h.run(["status"])).toBe(0);
    expect(h.stdout.text).toContain("UNPARSEABLE");
  });

  it("--json emits the stable envelope", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(await h.run(["status", "--json"])).toBe(0);
    const payload = JSON.parse(h.stdout.text) as { ok: boolean; command: string };
    expect(payload).toMatchObject({ ok: true, command: "status" });
  });
});

describe("diff", () => {
  it("renders the pending apply edits and writes NOTHING", async () => {
    const h = harness();
    seedFamilies(h.fs);
    const before = new Map(h.fs.files);
    expect(
      await h.run(["diff", "--client", "claude-code", "--servers", "iris-admin-mcp"]),
    ).toBe(0);
    expect(h.stdout.text).toContain("iris-admin-mcp");
    expect(h.stdout.text).toContain("(diff only — nothing was written)");
    expect(h.fs.files).toEqual(before);
  });

  it("unknown server name exits 2", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(await h.run(["diff", "--client", "claude-code", "--servers", "iris-bogus-mcp"])).toBe(2);
    expect(h.stderr.text).toContain('unknown server "iris-bogus-mcp"');
  });

  it("--json emits the stable envelope with per-server renders", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(await h.run(["diff", "--client", "codex", "--servers", "iris-dev-mcp,iris-ops-mcp", "--json"])).toBe(0);
    const payload = JSON.parse(h.stdout.text) as {
      ok: boolean;
      command: string;
      data: { servers: { server: string; mechanism: string }[] };
    };
    expect(payload).toMatchObject({ ok: true, command: "diff" });
    expect(payload.data.servers.map((server) => server.server)).toEqual(["iris-dev-mcp", "iris-ops-mcp"]);
  });
});

// ════════════════════════════════════════════════════════════════════
// Task 3 — write commands + mode gating + explicit-mode discipline.
// ════════════════════════════════════════════════════════════════════

describe("apply", () => {
  it("apply --yes writes the entry, records ownership, and prints the restart hint", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(
      await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--yes"]),
    ).toBe(0);
    const written = h.fs.readFile(`${HOME}/.claude.json`);
    expect(written).toContain('"iris-admin-mcp"');
    expect(written).toContain('"github-mcp"'); // foreign entry untouched
    expect(h.stdout.text).toContain(`Restart: ${CLIENT_ADAPTERS["claude-code"]!.restartHint}`);
    // Ownership ledger recorded the manager-created... canonical entries need
    // no record — assert the ledger is readable and the entry is present.
    const state = readState(h.fs, stateDirOf(h.deps), "linux");
    expect(state.ok).toBe(true);
    // A timestamped backup was taken.
    const backups = h.fs.pathsUnder(`${stateDirOf(h.deps)}/backups/claude-code/user/`);
    expect(backups.some((path) => path.includes(".claude.json."))).toBe(true);
  });

  it("non-TTY without --yes exits 2 with guidance and writes NOTHING", async () => {
    const h = harness(); // no stdin → non-interactive
    seedFamilies(h.fs);
    const before = h.fs.readFile(`${HOME}/.claude.json`);
    expect(await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp"])).toBe(2);
    expect(h.stderr.text).toContain("--yes");
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toBe(before);
    expect(h.fs.pathsUnder(stateDirOf(h.deps))).toEqual([]);
  });

  it("a declined TTY confirmation exits 1 and writes NOTHING", async () => {
    const h = harness({
      stdin: stdinFrom("", true),
      promptConfirm: async () => false,
    });
    seedFamilies(h.fs);
    const before = h.fs.readFile(`${HOME}/.claude.json`);
    expect(await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp"])).toBe(1);
    expect(h.stderr.text).toContain("Aborted");
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toBe(before);
  });

  it("an accepted TTY confirmation writes", async () => {
    const h = harness({
      stdin: stdinFrom("", true),
      promptConfirm: async () => true,
    });
    seedFamilies(h.fs);
    expect(await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp"])).toBe(0);
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toContain('"iris-admin-mcp"');
  });

  it("explicit mode without --confirm-secret refuses BEFORE writing (exit 2)", async () => {
    const h = harness();
    seedFamilies(h.fs);
    const before = h.fs.readFile(`${HOME}/.claude.json`);
    expect(
      await h.run([
        "apply", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--yes",
      ]),
    ).toBe(2);
    expect(h.stderr.text).toContain("--confirm-secret");
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toBe(before);
  });

  it("explicit mode with a wrong --confirm-secret refuses BEFORE writing and never echoes the password", async () => {
    const secret = "s3cr3t-value-never-echoed";
    const h = harness({ stdin: stdinFrom(`${secret}\n`) });
    seedFamilies(h.fs);
    const before = h.fs.readFile(`${HOME}/.claude.json`);
    expect(
      await h.run([
        "apply", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--confirm-secret", "iris-ops-mcp",
        "--password-stdin", "--yes",
      ]),
    ).toBe(2);
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toBe(before);
    expect(h.stdout.text + h.stderr.text).not.toContain(secret);
  });

  it("explicit mode end-to-end: --password-stdin + typed confirmation; the secret never reaches stdout/stderr", async () => {
    const secret = "s3cr3t-value-never-echoed";
    const h = harness({ stdin: stdinFrom(`${secret}\n`) });
    seedFamilies(h.fs);
    expect(
      await h.run([
        "apply", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--confirm-secret", "iris-admin-mcp",
        "--password-stdin", "--yes",
      ]),
    ).toBe(0);
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toContain(secret); // the config file is SUPPOSED to hold it
    expect(h.stdout.text + h.stderr.text).not.toContain(secret);
    const state = readState(h.fs, stateDirOf(h.deps), "linux");
    expect(state.ok && state.state.entries.some((entry) => entry.name === "iris-admin-mcp" && entry.containsSecret)).toBe(true);
  });

  it("server-manager mode is refused (exit 2) when the host probe finds nothing", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(
      await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--mode", "server-manager", "--yes"]),
    ).toBe(2);
    expect(h.stderr.text).toContain('mode "server-manager" is not available on this host');
  });

  it("server-manager mode is available when IRIS_SERVER_MANAGER is set", async () => {
    const h = harness({}, { IRIS_SERVER_MANAGER: "auto" });
    seedFamilies(h.fs);
    expect(
      await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--mode", "server-manager", "--yes"]),
    ).toBe(0);
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toContain('"IRIS_SERVER_MANAGER": "auto"');
  });

  it("server-manager mode is available when a settings file carries intersystems.servers definitions", async () => {
    const h = harness();
    seedFamilies(h.fs);
    h.fs.seed(
      `${HOME}/.config/Code/User/settings.json`,
      JSON.stringify({ "intersystems.servers": { prod: { webServer: { scheme: "http", host: "h", port: 52773 }, username: "u" } } }),
    );
    expect(
      await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--mode", "server-manager", "--yes"]),
    ).toBe(0);
  });

  it("governance-file mode is refused (exit 2) without an existing file, available with one", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(
      await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--mode", "governance-file", "--yes"]),
    ).toBe(2);
    expect(h.stderr.text).toContain('mode "governance-file" is not available on this host');

    const h2 = harness({}, { IRIS_GOVERNANCE_FILE: `${HOME}/gov.json` });
    seedFamilies(h2.fs);
    h2.fs.seed(`${HOME}/gov.json`, `{"global": {}}\n`);
    expect(
      await h2.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--mode", "governance-file", "--yes"]),
    ).toBe(0);
    expect(h2.fs.readFile(`${HOME}/.claude.json`)).toContain(`"IRIS_GOVERNANCE_FILE": "${HOME}/gov.json"`);
  });

  it("VS Code env-reference apply merges the native inputs descriptor (the 33.2 seam)", async () => {
    const h = harness();
    h.fs.seed(
      `${HOME}/.config/Code/User/mcp.json`,
      `{\n  "inputs": [\n    {\n      "type": "promptString",\n      "id": "other-input",\n      "description": "keep me",\n      "password": false\n    }\n  ],\n  "servers": {}\n}\n`,
    );
    expect(await h.run(["apply", "--client", "vscode", "--servers", "iris-dev-mcp", "--yes"])).toBe(0);
    const written = h.fs.readFile(`${HOME}/.config/Code/User/mcp.json`);
    expect(written).toContain('"iris-dev-mcp"');
    expect(written).toContain('"id": "iris-password"'); // merged descriptor
    expect(written).toContain('"id": "other-input"'); // existing descriptor preserved
    expect(written).toContain('"${input:iris-password}"');
    expect(h.stdout.text).toContain("merged native inputs descriptor(s): iris-password");
  });

  it("an unparseable target file refuses (exit 1) and stays byte-identical", async () => {
    const h = harness();
    const broken = readFixture("malformed/bad.jsonc");
    h.fs.seed(`${HOME}/.claude.json`, broken);
    expect(
      await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--yes"]),
    ).toBe(1);
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toBe(broken);
  });

  it("apply --json keeps stdout a single envelope (preview goes to stderr)", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(
      await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--yes", "--json"]),
    ).toBe(0);
    const payload = JSON.parse(h.stdout.text) as { ok: boolean; command: string; data: { changed: number } };
    expect(payload).toMatchObject({ ok: true, command: "apply", data: { changed: 1 } });
    expect(h.stderr.text).toContain("Pending changes");
  });
});

describe("enable / disable / remove", () => {
  async function applied(h: Harness): Promise<void> {
    expect(await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--yes"])).toBe(0);
  }

  it("disable stashes the entry; enable splices it back; restart hint printed after each", async () => {
    const h = harness();
    seedFamilies(h.fs);
    await applied(h);
    expect(await h.run(["disable", "--client", "claude-code", "--server", "iris-admin-mcp"])).toBe(0);
    expect(h.fs.readFile(`${HOME}/.claude.json`)).not.toContain('"iris-admin-mcp"');
    expect(h.stdout.text).toContain(`Restart: ${CLIENT_ADAPTERS["claude-code"]!.restartHint}`);
    const stashed = readState(h.fs, stateDirOf(h.deps), "linux");
    expect(stashed.ok && stashed.state.stashes.some((stash) => stash.name === "iris-admin-mcp")).toBe(true);

    expect(await h.run(["enable", "--client", "claude-code", "--server", "iris-admin-mcp"])).toBe(0);
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toContain('"iris-admin-mcp"');
  });

  it("remove purges the entry and its records", async () => {
    const h = harness();
    seedFamilies(h.fs);
    await applied(h);
    expect(await h.run(["remove", "--client", "claude-code", "--server", "iris-admin-mcp"])).toBe(0);
    expect(h.fs.readFile(`${HOME}/.claude.json`)).not.toContain('"iris-admin-mcp"');
  });

  it("an ownership refusal prints the engine reason VERBATIM (exit 1) and writes nothing", async () => {
    const h = harness();
    seedFamilies(h.fs);
    const before = h.fs.readFile(`${HOME}/.claude.json`);
    expect(await h.run(["disable", "--client", "claude-code", "--server", "github-mcp"])).toBe(1);
    expect(h.stderr.text).toContain('refusing to modify "github-mcp"');
    expect(h.stderr.text).toContain("outside the iris-mcp namespace");
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toBe(before);
  });

  it("missing required --server exits 2", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(await h.run(["disable", "--client", "claude-code"])).toBe(2);
  });
});

describe("restore", () => {
  it("restore with no backups exits 1 naming the reason", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(await h.run(["restore", "--client", "claude-code"])).toBe(1);
    expect(h.stderr.text).toContain("no backups found");
  });

  it("restore rolls back to the latest backup; --backup with an unknown name exits 1", async () => {
    const h = harness();
    seedFamilies(h.fs);
    const original = h.fs.readFile(`${HOME}/.claude.json`);
    expect(await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--yes"])).toBe(0);
    expect(h.fs.readFile(`${HOME}/.claude.json`)).not.toBe(original);
    expect(await h.run(["restore", "--client", "claude-code"])).toBe(0);
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toBe(original);
    expect(h.stdout.text).toContain("restored from");
    expect(await h.run(["restore", "--client", "claude-code", "--backup", "nope.bak"])).toBe(1);
    expect(h.stderr.text).toContain('no backup named "nope.bak"');
  });
});

// ════════════════════════════════════════════════════════════════════
// Task 4 — doctor (AC 33.2.1, Integration AC 33.2-I2 / 33-1-R5).
// ════════════════════════════════════════════════════════════════════

describe("doctor", () => {
  it("a healthy state exits 0", async () => {
    const h = harness({}, {
      IRIS_HOST: "h", IRIS_PORT: "52773", IRIS_USERNAME: "u",
      IRIS_NAMESPACE: "USER", IRIS_HTTPS: "false", IRIS_PASSWORD: "pw",
    });
    seedFamilies(h.fs);
    // The claude-code fixture's iris-dev-mcp has an IRIS_SERVER_MANAGER
    // literal (no references); codex/goose fixtures carry no owned entries
    // with references. No backups, no stashes, no unrecorded entries.
    expect(await h.run(["doctor"])).toBe(0);
    expect(h.stdout.text).toContain("all checks passed");
  });

  it("unresolvable env references in owned entries are findings (exit 1), resolvable ones are not", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--yes"])).toBe(0);
    // env-reference mode wrote ${IRIS_HOST}/${IRIS_PASSWORD}/... — none are set.
    expect(await h.run(["doctor"])).toBe(1);
    expect(h.stdout.text).toContain("env-references");
    expect(h.stdout.text).toContain("IRIS_PASSWORD");

    const h2 = harness({}, {
      IRIS_HOST: "h", IRIS_PORT: "52773", IRIS_USERNAME: "u",
      IRIS_NAMESPACE: "USER", IRIS_HTTPS: "false", IRIS_PASSWORD: "pw",
    });
    seedFamilies(h2.fs);
    expect(await h2.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--yes"])).toBe(0);
    expect(await h2.run(["doctor"])).toBe(0);
  });

  it("a stale backup (age derived from the filename timestamp) is a finding", async () => {
    const h = harness();
    seedFamilies(h.fs);
    const old = "2020-01-01T00-00-00-000Z";
    h.fs.seed(
      `${stateDirOf(h.deps)}/backups/claude-code/user/.claude.json.${old}`,
      "{}",
    );
    expect(await h.run(["doctor"])).toBe(1);
    expect(h.stdout.text).toContain("stale-backups");
    expect(h.stdout.text).toContain("older than 30 days");
  });

  it("a fresh backup is NOT a finding", async () => {
    const h = harness();
    seedFamilies(h.fs);
    // fixedNow = 2026-07-27T12:00Z — a same-day stamp is fresh.
    h.fs.seed(
      `${stateDirOf(h.deps)}/backups/claude-code/user/.claude.json.2026-07-27T11-59-00-000Z`,
      "{}",
    );
    expect(await h.run(["doctor"])).toBe(0);
  });

  it("an orphaned stash (config file gone) is a finding", async () => {
    const h = harness();
    // No claude config at all, but a stash record references it.
    const stateDir = stateDirOf(h.deps);
    h.fs.seed(
      stateFilePath(stateDir, "linux"),
      JSON.stringify({
        version: 1,
        entries: [],
        stashes: [
          { client: "claude-code", scope: "user", name: "iris-dev-mcp", entry: { command: "npx" }, disabledAt: "2026-07-01T00:00:00.000Z" },
        ],
      }),
    );
    expect(await h.run(["doctor"])).toBe(1);
    expect(h.stdout.text).toContain("orphaned-stashes");
    expect(h.stdout.text).toContain("no longer exists");
  });

  it("a stash that conflicts with a present-enabled entry is a finding", async () => {
    const h = harness();
    seedFamilies(h.fs);
    const stateDir = stateDirOf(h.deps);
    h.fs.seed(
      stateFilePath(stateDir, "linux"),
      JSON.stringify({
        version: 1,
        entries: [],
        stashes: [
          { client: "claude-code", scope: "user", name: "iris-dev-mcp", entry: { command: "npx" }, disabledAt: "2026-07-01T00:00:00.000Z" },
        ],
      }),
    );
    expect(await h.run(["doctor"])).toBe(1);
    expect(h.stdout.text).toContain("BOTH stashed and present-enabled");
  });

  it("33-1-R5: a present non-canonical iris- entry failing ownership is reported; foreign entries are NOT", async () => {
    const h = harness({}, {
      IRIS_HOST: "h", IRIS_PORT: "52773", IRIS_USERNAME: "u",
      IRIS_NAMESPACE: "USER", IRIS_HTTPS: "false", IRIS_PASSWORD: "pw",
    });
    seedFamilies(h.fs);
    // Plant an iris- namespaced non-canonical entry (the state.json-loss orphan).
    const config = JSON.parse(h.fs.readFile(`${HOME}/.claude.json`)) as { mcpServers: Record<string, unknown> };
    config.mcpServers["iris-dev-mcp2"] = { command: "npx", args: ["-y", "@iris-mcp/dev"] };
    h.fs.seed(`${HOME}/.claude.json`, JSON.stringify(config, null, 2));
    expect(await h.run(["doctor"])).toBe(1);
    expect(h.stdout.text).toContain("unrecorded-entries");
    expect(h.stdout.text).toContain("iris-dev-mcp2");
    expect(h.stdout.text).toContain("--repair --yes-i-mean-it");
    // github-mcp (foreign) is never flagged by this check.
    expect(h.stdout.text).not.toMatch(/unrecorded-entries[\s\S]*github-mcp/);
  });

  it("--repair without --yes-i-mean-it exits 2 (typed confirmation required)", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(await h.run(["doctor", "--repair"])).toBe(2);
    expect(h.stderr.text).toContain("--yes-i-mean-it");
  });

  it("--repair --yes-i-mean-it re-records the orphan manager-created (conservative contains-secret) and doctor then passes", async () => {
    const h = harness({}, {
      IRIS_HOST: "h", IRIS_PORT: "52773", IRIS_USERNAME: "u",
      IRIS_NAMESPACE: "USER", IRIS_HTTPS: "false", IRIS_PASSWORD: "pw",
    });
    seedFamilies(h.fs);
    const config = JSON.parse(h.fs.readFile(`${HOME}/.claude.json`)) as { mcpServers: Record<string, unknown> };
    config.mcpServers["iris-dev-mcp2"] = { command: "npx", args: ["-y", "@iris-mcp/dev"] };
    h.fs.seed(`${HOME}/.claude.json`, JSON.stringify(config, null, 2));

    expect(await h.run(["doctor", "--repair", "--yes-i-mean-it"])).toBe(0);
    expect(h.stdout.text).toContain("re-recorded manager-created");
    const state = readState(h.fs, stateDirOf(h.deps), "linux");
    expect(state.ok).toBe(true);
    const record = state.ok
      ? state.state.entries.find((entry) => entry.name === "iris-dev-mcp2" && entry.client === "claude-code")
      : undefined;
    expect(record).toBeDefined();
    expect(record?.containsSecret).toBe(true); // unknown provenance ⇒ conservative
    // And the entry is now manageable: a re-run doctor is clean.
    expect(await h.run(["doctor"])).toBe(0);
  });

  it("--json emits per-check findings with a DERIVED findingCount (AC 33.2.4)", async () => {
    const h = harness();
    seedFamilies(h.fs);
    h.fs.seed(`${stateDirOf(h.deps)}/backups/claude-code/user/.claude.json.2020-01-01T00-00-00-000Z`, "{}");
    expect(await h.run(["doctor", "--json"])).toBe(1);
    const payload = JSON.parse(h.stdout.text) as {
      ok: boolean;
      command: string;
      data: { findings: unknown[]; findingCount: number };
    };
    expect(payload.command).toBe("doctor");
    expect(payload.ok).toBe(false);
    expect(payload.data.findingCount).toBe(payload.data.findings.length);
    expect(payload.data.findingCount).toBeGreaterThan(0);
  });

  it("restart hints are printed for clients with pending changes", async () => {
    const h = harness();
    seedFamilies(h.fs);
    // Disable a native-flag client's entry: a state change pending activation.
    expect(await h.run(["apply", "--client", "codex", "--servers", "iris-dev-mcp", "--yes"])).toBe(0);
    expect(await h.run(["disable", "--client", "codex", "--server", "iris-dev-mcp"])).toBe(0);
    await h.run(["doctor"]);
    expect(h.stdout.text).toContain("Restart hints:");
    expect(h.stdout.text).toContain(CLIENT_ADAPTERS["codex"]!.restartHint);
  });
});

// ════════════════════════════════════════════════════════════════════
// Story 33.4 Task 1 — doctor config-drift check (AC 33.4.2, Integration
// AC 33.4-I1): parse-OK-but-wrong-shape is DISTINCT from unparseable.
// ════════════════════════════════════════════════════════════════════

describe("doctor config-drift (AC 33.4.2, 33.4-I1)", () => {
  it("a wrong-shaped root key is a config-drift finding, NOT parseability, with expected/found/adapterDataVersion", async () => {
    const h = harness();
    h.fs.seed(`${HOME}/.claude.json`, readFixture("drift/wrong-shape.json"));
    expect(await h.run(["doctor", "--json"])).toBe(1);
    const payload = JSON.parse(h.stdout.text) as {
      ok: boolean;
      data: {
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
      };
    };
    expect(payload.ok).toBe(false);
    const drift = payload.data.findings.filter((finding) => finding.check === "config-drift");
    expect(drift).toHaveLength(1);
    const finding = drift[0]!;
    expect(finding.client).toBe("claude-code");
    expect(finding.scope).toBe("user");
    expect(finding.path).toBe(`${HOME}/.claude.json`);
    expect(finding.expected).toBe('root key "mcpServers" holding an object of server entries');
    expect(finding.found).toBe("an array (3 item(s))");
    expect(finding.adapterDataVersion).toBe(ADAPTER_DATA_VERSION);
    // The detail names the expectation + the data vintage (AC 33.4-I1).
    expect(finding.detail).toContain("mcpServers");
    expect(finding.detail).toContain(ADAPTER_DATA_VERSION);
    // DISTINCT from unparseable: no parseability finding for the same file.
    expect(payload.data.findings.some((f) => f.check === "parseability")).toBe(false);
  });

  it("wrong shapes are drift across the TOML and YAML families too (codex, goose)", async () => {
    const h = harness();
    h.fs.seed(`${HOME}/.codex/config.toml`, readFixture("drift/wrong-shape.toml"));
    h.fs.seed(`${HOME}/.config/goose/config.yaml`, readFixture("drift/wrong-shape.yaml"));
    expect(await h.run(["doctor", "--json"])).toBe(1);
    const payload = JSON.parse(h.stdout.text) as {
      data: { findings: Array<{ check: string; client: string; expected?: string; found?: string }> };
    };
    const drift = payload.data.findings.filter((finding) => finding.check === "config-drift");
    expect(drift.map((finding) => finding.client).sort()).toEqual(["codex", "goose"]);
    expect(drift.find((finding) => finding.client === "codex")?.expected).toContain('"mcp_servers"');
    expect(drift.find((finding) => finding.client === "codex")?.found).toBe("a string");
    expect(drift.find((finding) => finding.client === "goose")?.expected).toContain('"extensions"');
    expect(payload.data.findings.some((f) => f.check === "parseability")).toBe(false);
  });

  it("a parseable top-level non-object is config-drift (every expectation fails)", async () => {
    const h = harness();
    h.fs.seed(`${HOME}/.claude.json`, readFixture("drift/top-array.json"));
    expect(await h.run(["doctor", "--json"])).toBe(1);
    const payload = JSON.parse(h.stdout.text) as {
      data: { findings: Array<{ check: string; expected?: string; found?: string }> };
    };
    const drift = payload.data.findings.filter((finding) => finding.check === "config-drift");
    expect(drift).toHaveLength(1);
    expect(drift[0]!.expected).toBe('a top-level object holding root key "mcpServers"');
    expect(drift[0]!.found).toBe("an array (3 item(s))");
  });

  it("an ABSENT root key with other content is NOT drift (a normal no-MCP-section config)", async () => {
    const h = harness();
    h.fs.seed(`${HOME}/.claude.json`, readFixture("drift/no-mcp-section.json"));
    expect(await h.run(["doctor"])).toBe(0);
    expect(h.stdout.text).toContain("all checks passed");
    expect(h.stdout.text).not.toContain("config-drift");
  });

  it("an empty file and a missing file produce no finding", async () => {
    const h = harness();
    h.fs.seed(`${HOME}/.claude.json`, "  \n");
    // codex/goose simply not seeded (missing files).
    expect(await h.run(["doctor"])).toBe(0);
    expect(h.stdout.text).not.toContain("config-drift");
  });

  it("a syntax error stays a parseability finding (never config-drift)", async () => {
    const h = harness();
    seedFamilies(h.fs);
    h.fs.seed(`${HOME}/.claude.json`, readFixture("malformed/bad.jsonc"));
    expect(await h.run(["doctor"])).toBe(1);
    expect(h.stdout.text).toContain("parseability");
    expect(h.stdout.text).not.toContain("config-drift");
  });

  it("the text render prints the drift finding with the client/scope and a restart hint", async () => {
    const h = harness();
    h.fs.seed(`${HOME}/.claude.json`, readFixture("drift/wrong-shape.json"));
    expect(await h.run(["doctor"])).toBe(1);
    expect(h.stdout.text).toContain("config-drift (1):");
    expect(h.stdout.text).toContain("[claude-code/user]");
    expect(h.stdout.text).toContain("Restart hints:");
    expect(h.stdout.text).toContain(CLIENT_ADAPTERS["claude-code"]!.restartHint);
  });
});

// ════════════════════════════════════════════════════════════════════
// Mode gating in --help (AC 33.2.1's "excluded from --help mode lists").
// ════════════════════════════════════════════════════════════════════

describe("--help mode gating", () => {
  it("unavailable modes are excluded from the --help mode list", async () => {
    const h = harness(); // nothing probed: server-manager + governance-file unavailable
    expect(await h.run(["--help"])).toBe(0);
    expect(h.stdout.text).toContain("env-reference");
    expect(h.stdout.text).toContain("explicit");
    expect(h.stdout.text).not.toContain("IRIS_SERVER_MANAGER=auto — connections from Server Manager profiles");
    expect(h.stdout.text).not.toContain("IRIS_GOVERNANCE_FILE=<path> — governance from a shared file");
    expect(h.stdout.text).toContain("mode(s) unavailable on this host are hidden");
  });

  it("available modes appear in the --help mode list", async () => {
    const h = harness({}, { IRIS_SERVER_MANAGER: "auto", IRIS_GOVERNANCE_FILE: `${HOME}/gov.json` });
    h.fs.seed(`${HOME}/gov.json`, "{}\n");
    expect(await h.run(["--help"])).toBe(0);
    expect(h.stdout.text).toContain("IRIS_SERVER_MANAGER=auto — connections from Server Manager profiles");
    expect(h.stdout.text).toContain("IRIS_GOVERNANCE_FILE=<path> — governance from a shared file");
  });
});

// ════════════════════════════════════════════════════════════════════
// ensureInputs engine op (the 33.2 seam, engine-side).
// ════════════════════════════════════════════════════════════════════

describe("ensureInputs (engine op)", () => {
  it("is idempotent: a descriptor whose id is present is left untouched", async () => {
    const h = harness();
    h.fs.seed(
      `${HOME}/.config/Code/User/mcp.json`,
      `{\n  "inputs": [\n    {\n      "type": "promptString",\n      "id": "iris-password",\n      "description": "customized by the user",\n      "password": true\n    }\n  ],\n  "servers": {}\n}\n`,
    );
    expect(await h.run(["apply", "--client", "vscode", "--servers", "iris-dev-mcp", "--yes"])).toBe(0);
    const written = h.fs.readFile(`${HOME}/.config/Code/User/mcp.json`);
    expect(written).toContain("customized by the user"); // user's descriptor survives
    expect((written.match(/"id": "iris-password"/g) ?? []).length).toBe(1); // no duplicate
  });

  it("refuses for a non-vscode client (native inputs are a VS Code concept)", async () => {
    const { ensureInputs } = await import("../engine.js");
    const fs = new MemFs();
    const result = ensureInputs(
      { platform: "linux", env: {}, homeDir: HOME },
      "claude-code",
      "user",
      [{ id: "x", type: "promptString", description: "d", password: true }],
      { fs },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("VS Code concept");
  });
});

// ════════════════════════════════════════════════════════════════════
// 33.2 code-review regressions (each pinned against the pre-fix behavior).
// ════════════════════════════════════════════════════════════════════

describe("review: explicit-mode redaction verbatim gate (HIGH)", () => {
  it("a secret the serializer escapes (quotes/backslashes) is NEVER previewed — the render is withheld", async () => {
    const secret = `abc"def\\gh123`; // ≥ 8 chars, but JSON-serialized in the render (abc\"def\\gh123)
    const h = harness({ stdin: stdinFrom(`${secret}\n`) });
    seedFamilies(h.fs);
    expect(
      await h.run([
        "apply", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--confirm-secret", "iris-admin-mcp",
        "--password-stdin", "--yes",
      ]),
    ).toBe(0);
    // Pre-fix: the escaped secret printed verbatim (exact-raw replace found nothing).
    expect(h.stdout.text).toContain("(render withheld");
    expect(h.stdout.text + h.stderr.text).not.toContain(secret);
    expect(h.stdout.text + h.stderr.text).not.toContain(`abc\\"def\\\\gh123`); // escaped form neither
    // The file is SUPPOSED to hold the literal — in its JSON-serialized form.
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toContain(JSON.stringify(secret).slice(1, -1));
  });
});

describe("review: diff --mode explicit works (MEDIUM)", () => {
  it("acquires the password via --password-stdin, renders the redacted preview, writes NOTHING", async () => {
    const secret = "s3cr3t-value-never-echoed";
    const h = harness({ stdin: stdinFrom(`${secret}\n`) });
    seedFamilies(h.fs);
    const before = new Map(h.fs.files);
    // Pre-fix: exit 2 "explicit mode requires profile.password" — the flag was ignored.
    expect(
      await h.run([
        "diff", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--confirm-secret", "iris-admin-mcp", "--password-stdin",
      ]),
    ).toBe(0);
    expect(h.stdout.text).toContain("(diff only — nothing was written)");
    expect(h.stdout.text + h.stderr.text).not.toContain(secret);
    expect(h.fs.files).toEqual(before);
  });

  it("explicit diff without --password-stdin on a non-TTY refuses with guidance (exit 2)", async () => {
    const h = harness(); // no stdin → non-interactive
    seedFamilies(h.fs);
    expect(
      await h.run([
        "diff", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--confirm-secret", "iris-admin-mcp",
      ]),
    ).toBe(2);
    expect(h.stderr.text).toContain("--password-stdin");
  });
});

describe("qa 33.3: diff --json explicit mode redacts the envelope too (HIGH — the JSON path emitted the raw diffText)", () => {
  it("a long verbatim secret is masked in data.servers[].text (the redactPlanSecrets gate, not the raw render)", async () => {
    const secret = "s3cr3t-json-envelope-leak";
    const h = harness({ stdin: stdinFrom(`${secret}\n`) });
    seedFamilies(h.fs);
    // Pre-fix: data.servers[].text carried the literal password (only the
    // text/stderr renders went through redactPlanSecrets).
    expect(
      await h.run([
        "diff", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--confirm-secret", "iris-admin-mcp",
        "--password-stdin", "--json",
      ]),
    ).toBe(0);
    const envelope = JSON.parse(h.stdout.text) as {
      ok: boolean;
      data: { servers: { server: string; text: string }[] };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.servers).toHaveLength(1);
    expect(envelope.data.servers[0]?.text).toContain("********");
    expect(h.stdout.text).not.toContain(secret);
  });

  it("a below-gate secret withholds the render in the envelope (length gate applies to JSON too)", async () => {
    const secret = "pw123"; // < SECRET_MIN_REDACTION_LENGTH
    const h = harness({ stdin: stdinFrom(`${secret}\n`) });
    seedFamilies(h.fs);
    expect(
      await h.run([
        "diff", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--confirm-secret", "iris-admin-mcp",
        "--password-stdin", "--json",
      ]),
    ).toBe(0);
    const envelope = JSON.parse(h.stdout.text) as {
      ok: boolean;
      data: { servers: { server: string; text: string }[] };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.servers[0]?.text).toContain("(render withheld");
    expect(h.stdout.text).not.toContain(secret);
  });

  it("a serializer-escaped secret withholds the render in the envelope (verbatim gate applies to JSON too)", async () => {
    const secret = `abc"def\\gh123`; // ≥ 8 chars, JSON-escaped in the render
    const h = harness({ stdin: stdinFrom(`${secret}\n`) });
    seedFamilies(h.fs);
    expect(
      await h.run([
        "diff", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--confirm-secret", "iris-admin-mcp",
        "--password-stdin", "--json",
      ]),
    ).toBe(0);
    expect(h.stdout.text).toContain("(render withheld");
    expect(h.stdout.text).not.toContain(secret);
    expect(h.stdout.text).not.toContain(`abc\\"def\\\\gh123`); // escaped form neither
  });

  it("non-explicit modes are byte-identical to the pre-fix envelope (the redaction is a no-op when no secret is present)", async () => {
    const h = harness();
    seedFamilies(h.fs);
    expect(
      await h.run([
        "diff", "--client", "claude-code", "--servers", "iris-admin-mcp", "--json",
      ]),
    ).toBe(0);
    const envelope = JSON.parse(h.stdout.text) as {
      ok: boolean;
      data: { mode: string; servers: { server: string; text: string }[] };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.mode).toBe("env-reference");
    expect(envelope.data.servers[0]?.text).toContain("iris-admin-mcp");
    expect(envelope.data.servers[0]?.text).not.toContain("********");
  });
});

describe("review: doctor no-expansion check respects runtime defaults (MEDIUM)", () => {
  it("an entry with profile literals + IRIS_PASSWORD in env is CLEAN (IRIS_HTTPS unset has a runtime default)", async () => {
    const h = harness({}, { IRIS_PASSWORD: "pw" });
    h.fs.seed(`${HOME}/.cursor/mcp.json`, `{"mcpServers": {}}\n`);
    expect(
      await h.run([
        "apply", "--client", "cursor", "--servers", "iris-dev-mcp",
        "--host", "iris.local", "--port", "52773", "--username", "_SYSTEM", "--namespace", "USER", "--yes",
      ]),
    ).toBe(0);
    // Pre-fix: exit 1 flagging "no IRIS_HTTPS literal and IRIS_HTTPS is not
    // set" — contradicting loadConfig's default and the engine's doctorNote.
    expect(await h.run(["doctor"])).toBe(0);
  });

  it("a genuinely-required variable (IRIS_USERNAME/IRIS_PASSWORD) missing from both entry and env IS a finding", async () => {
    const h = harness(); // nothing in env
    h.fs.seed(
      `${HOME}/.cursor/mcp.json`,
      JSON.stringify({ mcpServers: { "iris-dev-mcp": { command: "npx", args: ["-y", "@iris-mcp/dev"], env: { IRIS_HOST: "h" } } } }),
    );
    expect(await h.run(["doctor"])).toBe(1);
    expect(h.stdout.text).toContain("IRIS_USERNAME");
    expect(h.stdout.text).toContain("IRIS_PASSWORD");
    expect(h.stdout.text).not.toContain("IRIS_HTTPS is not set");
  });
});

describe("review: server-manager probe accepts the settings-nested .code-workspace shape (LOW)", () => {
  it("definitions nested under a workspace file's settings key make the mode available", async () => {
    const h = harness();
    seedFamilies(h.fs);
    h.fs.seed(
      `${PROJECT}/team.code-workspace`,
      JSON.stringify({
        folders: [{ path: "." }],
        settings: { "intersystems.servers": { prod: { webServer: { scheme: "http", host: "h", port: 52773 }, username: "u" } } },
      }),
    );
    // Pre-fix: exit 2 "mode server-manager is not available on this host"
    // (the mirror recognized only the top-level settings.json shape).
    expect(
      await h.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--mode", "server-manager", "--yes"]),
    ).toBe(0);
    expect(h.fs.readFile(`${HOME}/.claude.json`)).toContain('"IRIS_SERVER_MANAGER": "auto"');
  });
});


describe("lifecycle over the format families", () => {
  // The applied server must be ABSENT from the fixture: add → disable →
  // enable → remove is the byte-inverse chain (an UPDATE of a pre-existing
  // entry can never round-trip to the original bytes after a purge).
  it.each([
    ["claude-code", `${HOME}/.claude.json`, "iris-admin-mcp"],
    ["codex", `${HOME}/.codex/config.toml`, "iris-admin-mcp"],
    ["goose", `${HOME}/.config/goose/config.yaml`, "iris-dev-mcp"],
  ] as const)("%s: apply → status enabled → disable → enable → remove → byte-equal original", async (client, path, serverName) => {
    const h = harness();
    seedFamilies(h.fs);
    const original = h.fs.readFile(path);

    expect(await h.run(["apply", "--client", client, "--servers", serverName, "--yes"])).toBe(0);
    h.stdout.text = ""; // the collector accumulates across runs — reset before parsing --json
    expect(await h.run(["status", "--json"])).toBe(0);
    const matrix = JSON.parse(h.stdout.text) as {
      data: { clients: { client: string; scopes: { servers: { server: string; state: string }[] }[] }[] };
    };
    const row = matrix.data.clients
      .find((entry) => entry.client === client)
      ?.scopes.flatMap((scope) => scope.servers)
      .find((server) => server.server === serverName);
    expect(row?.state).toBe("present-enabled");

    expect(await h.run(["disable", "--client", client, "--server", serverName])).toBe(0);
    h.stdout.text = "";
    expect(await h.run(["status", "--json"])).toBe(0);
    const afterDisable = JSON.parse(h.stdout.text) as typeof matrix;
    const disabledRow = afterDisable.data.clients
      .find((entry) => entry.client === client)
      ?.scopes.flatMap((scope) => scope.servers)
      .find((server) => server.server === serverName);
    expect(disabledRow?.state).not.toBe("present-enabled");

    expect(await h.run(["enable", "--client", client, "--server", serverName])).toBe(0);
    expect(await h.run(["remove", "--client", client, "--server", serverName])).toBe(0);
    expect(h.fs.readFile(path)).toBe(original);
  });
});
