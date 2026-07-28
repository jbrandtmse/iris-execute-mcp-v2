/**
 * Story 33.2 — `iris-mcp-clients` PROCESS-level E2E suite (the QA layer on
 * top of the dev suite in `clients-cli.test.ts`).
 *
 * The dev suite drives the pure `runCli(argv, deps)` core with an injected
 * MemFs. THIS suite drives the BUILT bin (`dist/cli/clients-cli.js`) as a
 * real child process against a real-filesystem sandbox HOME, proving the
 * whole stack a user actually runs: shebang entry → process.argv →
 * os.homedir()/process.env wiring → engine → real fs. (`pnpm turbo run test`
 * depends on `build`, so dist is always freshly compiled when this runs.)
 *
 * Coverage (the stage brief):
 * - Full command-surface chains per format family (Claude Code JSON, Codex
 *   TOML, Goose YAML): detect → diff (writes nothing) → apply --yes →
 *   status --json parses and shows present-enabled → disable → enable →
 *   remove → the config file is byte-equal the original fixture.
 * - The exit-code matrix: 0/1/2 per command incl. unknown command, missing
 *   args, engine refusals, non-TTY apply without --yes.
 * - `--json` envelope stability: one parseable {ok, command, data, error?}
 *   envelope on every command; usage errors stay plain-text on stderr.
 * - doctor end-to-end: each finding class planted (unresolvable env ref,
 *   unparseable config, stale backup, orphaned stash, unrecorded
 *   non-canonical entry) → `doctor --repair --yes-i-mean-it` round-trip.
 * - Mode gating on a host WITHOUT Server Manager / governance file (modes
 *   hidden in --help; a forced mode is exit 2) and the positive wiring.
 * - Secret discipline: explicit-mode previews never echo the password —
 *   below AND above the 8-char redaction gate.
 *
 * Rule #54: the sandbox models REAL Node behavior, never internals —
 * `os.homedir()` genuinely resolves HOME (POSIX) / USERPROFILE (Windows)
 * from the child env, `%APPDATA%` templates genuinely expand from APPDATA,
 * and piped stdin is genuinely non-TTY (so the apply confirmation gate and
 * --password-stdin exercise the real non-interactive paths). The child env
 * is built from scratch (PATH + home vars only), so no IRIS_* / IRIS_SM_*
 * variable from the developer shell can leak in and flip a probe.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, afterEach } from "vitest";

import { ADAPTER_DATA_VERSION } from "../adapters.js";

import { readFixture } from "./helpers.js";

// ════════════════════════════════════════════════════════════════════
// Harness: a real-fs sandbox HOME + a child-process runner.
// ════════════════════════════════════════════════════════════════════

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "dist", "cli", "clients-cli.js");

/** Per-test timeout: Windows node startup makes each spawn ~0.2-0.5s and the
 * lifecycle chains run ~8 spawns. */
const T = 120_000;

/** The IRIS connection variables that make env-reference entries resolvable. */
const IRIS_ENV: Record<string, string> = {
  IRIS_HOST: "iris.local",
  IRIS_PORT: "52773",
  IRIS_USERNAME: "_SYSTEM",
  IRIS_NAMESPACE: "USER",
  IRIS_HTTPS: "false",
  IRIS_PASSWORD: "doctor-env-pw",
};

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Sandbox {
  home: string;
  project: string;
  run: (args: string[], opts?: { input?: string; env?: Record<string, string> }) => RunResult;
  configPath: (client: "claude-code" | "codex" | "goose" | "vscode") => string;
  stateDir: string;
}

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop() as string;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeSandbox(): Sandbox {
  const home = mkdtempSync(path.join(tmpdir(), "clients-e2e-home-"));
  const project = mkdtempSync(path.join(tmpdir(), "clients-e2e-proj-"));
  createdDirs.push(home, project);
  const stateDir = path.join(home, ".iris-mcp", "client-manager");

  const run: Sandbox["run"] = (args, opts = {}) => {
    const result = spawnSync(process.execPath, [BIN, ...args], {
      cwd: project,
      // Built from scratch: no inherited IRIS_*/IRIS_SM_* leaks; the home
      // overrides are exactly the variables real Node resolves (Rule #54).
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
        ...(opts.env ?? {}),
      },
      encoding: "utf8",
      input: opts.input,
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };

  const configPath: Sandbox["configPath"] = (client) => {
    switch (client) {
      case "claude-code":
        return path.join(home, ".claude.json");
      case "codex":
        return path.join(home, ".codex", "config.toml");
      case "goose":
        // The adapter's win32 template is %APPDATA%/goose/config.yaml; the
        // sandbox's APPDATA is <home>/AppData/Roaming (darwin/linux use
        // ~/.config/goose). Mirrors the REAL per-platform paths, so the child
        // detects the client exactly as a real install would.
        return process.platform === "win32"
          ? path.join(home, "AppData", "Roaming", "goose", "config.yaml")
          : path.join(home, ".config", "goose", "config.yaml");
      case "vscode":
        // The adapter's per-OS user-scope mcp.json paths (win32
        // %APPDATA%/Code/User/mcp.json; darwin ~/Library/Application Support;
        // linux ~/.config) — mirrored exactly, like the goose case.
        return process.platform === "win32"
          ? path.join(home, "AppData", "Roaming", "Code", "User", "mcp.json")
          : process.platform === "darwin"
            ? path.join(home, "Library", "Application Support", "Code", "User", "mcp.json")
            : path.join(home, ".config", "Code", "User", "mcp.json");
    }
  };

  return { home, project, run, configPath, stateDir };
}

/** Plant one format family's fixture into the sandbox at the client's real
 * user-scope path (the `~` templates are platform-independent). */
function seedFamily(sandbox: Sandbox, client: "claude-code" | "codex" | "goose"): string {
  const fixture =
    client === "claude-code"
      ? readFixture("claude-code/user.json")
      : client === "codex"
        ? readFixture("codex/config.toml")
        : readFixture("goose/config.yaml");
  const target = sandbox.configPath(client);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, fixture);
  return fixture;
}

/** Parse a --json envelope, failing the test with the raw output otherwise. */
function parseEnvelope(result: RunResult): {
  ok: boolean;
  command: string;
  data: unknown;
  error?: string;
} {
  // stderr is unrestricted (previews go there under --json); stdout must be
  // exactly one parseable envelope.
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`stdout was not a single JSON envelope:\n${result.stdout}\n(stderr: ${result.stderr})`);
  }
  return parsed as { ok: boolean; command: string; data: unknown; error?: string };
}

/** The state of one server row in a status --json payload. */
function statusRowState(payload: unknown, client: string, server: string): string | undefined {
  const data = (payload as {
    data: { clients: { client: string; scopes: { servers: { server: string; state: string }[] }[] }[] };
  }).data;
  return data.clients
    .find((entry) => entry.client === client)
    ?.scopes.flatMap((scope) => scope.servers)
    .find((row) => row.server === server)?.state;
}

const stateFileOf = (sandbox: Sandbox): string => path.join(sandbox.stateDir, "state.json");

// ════════════════════════════════════════════════════════════════════
// 1. Full command-surface lifecycle chains, one per format family.
// ════════════════════════════════════════════════════════════════════

describe("E2E lifecycle chains per format family (AC 33.2.2, process level)", () => {
  it.each([
    ["claude-code", "iris-admin-mcp"],
    ["codex", "iris-admin-mcp"],
    ["goose", "iris-dev-mcp"],
  ] as const)(
    "%s: detect → diff → apply --yes → status --json → disable → enable → remove → byte-equal original",
    (client, server) => {
      const sandbox = makeSandbox();
      const original = seedFamily(sandbox, client);
      const target = sandbox.configPath(client);

      // detect: the client is reported detected through the real bin.
      let result = sandbox.run(["detect", "--json"]);
      expect(result.status).toBe(0);
      const detection = parseEnvelope(result) as {
        data: { clients: { client: string; detected: boolean }[] };
      };
      expect(detection.data.clients.find((row) => row.client === client)?.detected).toBe(true);

      // diff: exit 0, renders the pending edit, writes NOTHING.
      result = sandbox.run(["diff", "--client", client, "--servers", server]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("(diff only — nothing was written)");
      expect(readFileSync(target, "utf8")).toBe(original);

      // apply --yes: exit 0, restart hint printed, state recorded UNDER THE SANDBOX.
      result = sandbox.run(["apply", "--client", client, "--servers", server, "--yes"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Restart:");
      expect(existsSync(stateFileOf(sandbox))).toBe(true);
      expect(readFileSync(target, "utf8")).not.toBe(original);

      // status --json parses; the new row is present-enabled.
      result = sandbox.run(["status", "--json"]);
      expect(result.status).toBe(0);
      expect(statusRowState(parseEnvelope(result), client, server)).toBe("present-enabled");

      // disable → the row is no longer present-enabled; restart hint printed.
      result = sandbox.run(["disable", "--client", client, "--server", server]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Restart:");
      result = sandbox.run(["status", "--json"]);
      expect(result.status).toBe(0);
      expect(statusRowState(parseEnvelope(result), client, server)).not.toBe("present-enabled");

      // enable → back to present-enabled.
      result = sandbox.run(["enable", "--client", client, "--server", server]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Restart:");
      result = sandbox.run(["status", "--json"]);
      expect(statusRowState(parseEnvelope(result), client, server)).toBe("present-enabled");

      // remove → the config file is BYTE-EQUAL the original fixture.
      result = sandbox.run(["remove", "--client", client, "--server", server]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Restart:");
      expect(readFileSync(target, "utf8")).toBe(original);
    },
    T,
  );

  it("a foreign third-party entry survives the entire chain untouched (claude-code)", () => {
    const sandbox = makeSandbox();
    seedFamily(sandbox, "claude-code");
    const target = sandbox.configPath("claude-code");

    expect(sandbox.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--yes"]).status).toBe(0);
    let content = readFileSync(target, "utf8");
    expect(content).toContain('"github-mcp"');
    expect(content).toContain("ghp_foreignSecretValue123"); // foreign VALUE stays in the FILE…
    expect(sandbox.run(["remove", "--client", "claude-code", "--server", "iris-admin-mcp"]).status).toBe(0);
    content = readFileSync(target, "utf8");
    expect(content).toContain('"github-mcp"');
    // …but never leaks onto the status surface.
    const status = sandbox.run(["status"]);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain("github-mcp"); // names only
    expect(status.stdout).not.toContain("ghp_foreignSecretValue123");
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 2. Exit-code matrix (AC 33.2.3): 0 success / 1 operational / 2 usage.
// ════════════════════════════════════════════════════════════════════

describe("E2E exit-code matrix (AC 33.2.3)", () => {
  it("usage errors exit 2: no command, unknown command, unknown option, missing value", () => {
    const sandbox = makeSandbox();

    let result = sandbox.run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no command given");

    result = sandbox.run(["frobnicate"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown command "frobnicate"');
    expect(result.stderr).toContain("detect, status, diff, apply, enable, disable, remove, restore, doctor");

    result = sandbox.run(["status", "--frobnicate"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown option "--frobnicate"');

    result = sandbox.run(["apply", "--client"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Option "--client" requires a value');
  }, T);

  it("usage errors exit 2: missing required args and invalid values per command", () => {
    const sandbox = makeSandbox();
    seedFamily(sandbox, "claude-code");

    // disable without --server
    let result = sandbox.run(["disable", "--client", "claude-code"]);
    expect(result.status).toBe(2);

    // diff without --servers
    result = sandbox.run(["diff", "--client", "claude-code"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--servers");

    // apply without --client
    result = sandbox.run(["apply", "--servers", "all", "--yes"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--client");

    // unknown client
    result = sandbox.run(["status", "--client", "not-a-client"]);
    expect(result.status).toBe(2); // status takes no --client at all → unknown option
    result = sandbox.run(["diff", "--client", "not-a-client", "--servers", "iris-dev-mcp"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown client "not-a-client"');

    // invalid scope / mode / server name / port
    result = sandbox.run(["diff", "--client", "claude-code", "--servers", "iris-dev-mcp", "--scope", "system"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('invalid --scope "system"');
    result = sandbox.run(["diff", "--client", "claude-code", "--servers", "iris-dev-mcp", "--mode", "bogus"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown --mode "bogus"');
    result = sandbox.run(["diff", "--client", "claude-code", "--servers", "iris-bogus-mcp"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown server "iris-bogus-mcp"');
    result = sandbox.run(["diff", "--client", "claude-code", "--servers", "iris-dev-mcp", "--port", "not-a-port"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("invalid --port");
  }, T);

  it("operational failures exit 1: foreign-entry refusal, absent backups, unparseable target", () => {
    const sandbox = makeSandbox();
    const original = seedFamily(sandbox, "claude-code");
    const target = sandbox.configPath("claude-code");

    // Engine refusal: the foreign entry is outside the iris-mcp namespace.
    let result = sandbox.run(["disable", "--client", "claude-code", "--server", "github-mcp"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to modify "github-mcp"');
    expect(readFileSync(target, "utf8")).toBe(original);

    // restore with no backups taken yet.
    result = sandbox.run(["restore", "--client", "claude-code"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no backups found");

    // apply against an unparseable file refuses and stays byte-identical.
    writeFileSync(target, readFixture("malformed/bad.jsonc"));
    const broken = readFileSync(target, "utf8");
    result = sandbox.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--yes"]);
    expect(result.status).toBe(1);
    expect(readFileSync(target, "utf8")).toBe(broken);
  }, T);

  it("non-TTY apply without --yes exits 2 with guidance and writes NOTHING (no state dir created)", () => {
    const sandbox = makeSandbox();
    const original = seedFamily(sandbox, "claude-code");
    // The child's stdin is a PIPE (genuinely non-TTY, Rule #54) — no input.
    const result = sandbox.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--yes");
    expect(readFileSync(sandbox.configPath("claude-code"), "utf8")).toBe(original);
    expect(existsSync(sandbox.stateDir)).toBe(false);
  }, T);

  it("success paths exit 0: --help and every read command", () => {
    const sandbox = makeSandbox();
    seedFamily(sandbox, "claude-code");
    expect(sandbox.run(["--help"]).status).toBe(0);
    expect(sandbox.run(["detect"]).status).toBe(0);
    expect(sandbox.run(["status"]).status).toBe(0);
    expect(sandbox.run(["diff", "--client", "claude-code", "--servers", "iris-admin-mcp"]).status).toBe(0);
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 3. --json envelope stability across the whole command surface.
// ════════════════════════════════════════════════════════════════════

describe("E2E --json envelope stability (AC 33.2.3)", () => {
  it("every command emits exactly one parseable {ok, command, data, error?} envelope", () => {
    const sandbox = makeSandbox();
    seedFamily(sandbox, "claude-code");

    // detect
    let result = sandbox.run(["detect", "--json"]);
    expect(result.status).toBe(0);
    let envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("detect");
    expect(typeof (envelope.data as { counts: { probed: number } }).counts.probed).toBe("number");

    // status
    result = sandbox.run(["status", "--json"]);
    expect(result.status).toBe(0);
    envelope = parseEnvelope(result);
    expect(envelope).toMatchObject({ ok: true, command: "status" });

    // diff
    result = sandbox.run(["diff", "--client", "claude-code", "--servers", "iris-admin-mcp", "--json"]);
    expect(result.status).toBe(0);
    envelope = parseEnvelope(result);
    expect(envelope).toMatchObject({ ok: true, command: "diff" });
    expect(
      (envelope.data as { servers: { server: string }[] }).servers.map((row) => row.server),
    ).toEqual(["iris-admin-mcp"]);

    // apply (stdout stays ONE envelope; the preview goes to stderr)
    result = sandbox.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--yes", "--json"]);
    expect(result.status).toBe(0);
    envelope = parseEnvelope(result);
    expect(envelope).toMatchObject({ ok: true, command: "apply" });
    expect((envelope.data as { changed: number }).changed).toBe(1);
    expect(result.stderr).toContain("Pending changes");

    // disable / enable / remove
    for (const action of ["disable", "enable", "remove"] as const) {
      result = sandbox.run([action, "--client", "claude-code", "--server", "iris-admin-mcp", "--json"]);
      expect(result.status).toBe(0);
      envelope = parseEnvelope(result);
      expect(envelope).toMatchObject({ ok: true, command: action });
    }

    // doctor (clean sandbox after the remove → ok true)
    result = sandbox.run(["doctor", "--json"], { env: IRIS_ENV });
    expect(result.status).toBe(0);
    envelope = parseEnvelope(result);
    expect(envelope).toMatchObject({ ok: true, command: "doctor" });
    const doctorData = envelope.data as { findings: unknown[]; findingCount: number };
    expect(doctorData.findingCount).toBe(doctorData.findings.length);
  }, T);

  it("failure envelopes carry ok:false + an error string (restore, engine refusal, doctor finding)", () => {
    const sandbox = makeSandbox();
    const original = seedFamily(sandbox, "claude-code");

    // restore with no backups: exit 1, ok:false, error string.
    let result = sandbox.run(["restore", "--client", "claude-code", "--json"]);
    expect(result.status).toBe(1);
    let envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe("restore");
    expect(typeof envelope.error).toBe("string");

    // engine refusal on a foreign entry: exit 1, ok:false, verbatim reason in error.
    result = sandbox.run(["disable", "--client", "claude-code", "--server", "github-mcp", "--json"]);
    expect(result.status).toBe(1);
    envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe("disable");
    expect(envelope.error).toContain('refusing to modify "github-mcp"');
    expect(readFileSync(sandbox.configPath("claude-code"), "utf8")).toBe(original);

    // doctor with a planted finding: exit 1, ok:false, derived count.
    writeFileSync(sandbox.configPath("claude-code"), readFixture("malformed/bad.jsonc"));
    result = sandbox.run(["doctor", "--json"]);
    expect(result.status).toBe(1);
    envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(false);
    const data = envelope.data as { findings: { check: string }[]; findingCount: number };
    expect(data.findingCount).toBe(data.findings.length);
    expect(data.findings.some((finding) => finding.check === "parseability")).toBe(true);
  }, T);

  it("usage errors stay PLAIN TEXT on stderr even when --json was requested (no half-envelope)", () => {
    const sandbox = makeSandbox();
    const result = sandbox.run(["status", "--json", "--frobnicate"]);
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain('Unknown option "--frobnicate"');
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 4. doctor end-to-end: every finding class planted, then the repair loop.
// ════════════════════════════════════════════════════════════════════

describe("E2E doctor finding classes (AC 33.2.1)", () => {
  it("unresolvable env references exit 1; the same setup with IRIS_* set exits 0", () => {
    const sandbox = makeSandbox();
    seedFamily(sandbox, "claude-code");
    expect(sandbox.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--yes"]).status).toBe(0);

    // env-reference mode wrote ${IRIS_HOST}/${IRIS_PASSWORD}/… — none set in the child env.
    let result = sandbox.run(["doctor"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("env-references");
    expect(result.stdout).toContain("IRIS_PASSWORD");

    // Same sandbox, variables provided → clean.
    result = sandbox.run(["doctor"], { env: IRIS_ENV });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("all checks passed");
  }, T);

  it("an unparseable config is a parseability finding (exit 1), never a crash", () => {
    const sandbox = makeSandbox();
    seedFamily(sandbox, "claude-code");
    writeFileSync(sandbox.configPath("claude-code"), readFixture("malformed/bad.jsonc"));
    const result = sandbox.run(["doctor"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("parseability");
    expect(result.stdout).toContain("claude-code");
  }, T);

  it("a stale backup (timestamp in the filename) is a finding; a fresh one is not", () => {
    const sandbox = makeSandbox();
    seedFamily(sandbox, "claude-code");
    const backupDir = path.join(sandbox.stateDir, "backups", "claude-code", "user");
    mkdirSync(backupDir, { recursive: true });
    writeFileSync(path.join(backupDir, ".claude.json.2020-01-01T00-00-00-000Z"), "{}");

    let result = sandbox.run(["doctor"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("stale-backups");
    expect(result.stdout).toContain("older than 30 days");

    // Replace with a today-stamped backup → no finding. (The stamp is derived
    // from the REAL clock, like the CLI's own writes.)
    rmSync(backupDir, { recursive: true, force: true });
    mkdirSync(backupDir, { recursive: true });
    const fresh = new Date().toISOString().replace(/:/g, "-").replace(".", "-");
    writeFileSync(path.join(backupDir, `.claude.json.${fresh}`), "{}");
    result = sandbox.run(["doctor"]);
    expect(result.status).toBe(0);
  }, T);

  it("an orphaned stash (client config gone) is a finding with a --json envelope", () => {
    const sandbox = makeSandbox();
    // No client configs at all, but state.json holds a stash record.
    mkdirSync(sandbox.stateDir, { recursive: true });
    writeFileSync(
      stateFileOf(sandbox),
      JSON.stringify({
        version: 1,
        entries: [],
        stashes: [
          {
            client: "claude-code",
            scope: "user",
            name: "iris-dev-mcp",
            entry: { command: "npx", args: ["-y", "@iris-mcp/dev"] },
            disabledAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const result = sandbox.run(["doctor", "--json"]);
    expect(result.status).toBe(1);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(false);
    const data = envelope.data as { findings: { check: string; detail: string }[] };
    expect(
      data.findings.some((finding) => finding.check === "orphaned-stashes" && finding.detail.includes("no longer exists")),
    ).toBe(true);
  }, T);

  it("a stash conflicting with a present-enabled entry is a finding", () => {
    const sandbox = makeSandbox();
    seedFamily(sandbox, "claude-code"); // fixture's iris-dev-mcp IS present-enabled
    mkdirSync(sandbox.stateDir, { recursive: true });
    writeFileSync(
      stateFileOf(sandbox),
      JSON.stringify({
        version: 1,
        entries: [],
        stashes: [
          {
            client: "claude-code",
            scope: "user",
            name: "iris-dev-mcp",
            entry: { command: "npx" },
            disabledAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const result = sandbox.run(["doctor"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("BOTH stashed and present-enabled");
  }, T);

  it("33-1-R5 repair round-trip: unrecorded non-canonical entry → typed repair → doctor clean", () => {
    const sandbox = makeSandbox();
    seedFamily(sandbox, "claude-code");
    // Plant an iris- namespaced non-canonical entry (the state.json-loss orphan).
    const target = sandbox.configPath("claude-code");
    const config = JSON.parse(readFileSync(target, "utf8")) as { mcpServers: Record<string, unknown> };
    config.mcpServers["iris-dev-mcp2"] = { command: "npx", args: ["-y", "@iris-mcp/dev"] };
    writeFileSync(target, JSON.stringify(config, null, 2));

    // Detected: exit 1, names the entry + the repair invocation; github-mcp never flagged.
    let result = sandbox.run(["doctor"], { env: IRIS_ENV });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("unrecorded-entries");
    expect(result.stdout).toContain("iris-dev-mcp2");
    expect(result.stdout).toContain("--repair --yes-i-mean-it");
    expect(result.stdout).not.toMatch(/unrecorded-entries[\s\S]*github-mcp/);

    // --repair WITHOUT the typed confirmation: exit 2, nothing recorded.
    result = sandbox.run(["doctor", "--repair"], { env: IRIS_ENV });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--yes-i-mean-it");
    expect(existsSync(stateFileOf(sandbox))).toBe(false);

    // The typed repair: exit 0, recorded manager-created with conservative containsSecret.
    result = sandbox.run(["doctor", "--repair", "--yes-i-mean-it", "--json"], { env: IRIS_ENV });
    expect(result.status).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    const repaired = (envelope.data as { repaired: string[] }).repaired;
    expect(repaired).toContain("claude-code/user/iris-dev-mcp2");
    const state = JSON.parse(readFileSync(stateFileOf(sandbox), "utf8")) as {
      entries: { client: string; name: string; containsSecret: boolean }[];
    };
    const record = state.entries.find((entry) => entry.name === "iris-dev-mcp2" && entry.client === "claude-code");
    expect(record).toBeDefined();
    expect(record?.containsSecret).toBe(true);

    // Round-trip: the re-run doctor is clean.
    result = sandbox.run(["doctor"], { env: IRIS_ENV });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("all checks passed");
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 4b. doctor config-drift end-to-end (Story 33.4, Integration AC 33.4-I1):
// wrong-shape fixtures per format family through the BUILT bin's envelope.
// ════════════════════════════════════════════════════════════════════

describe("E2E doctor config-drift (AC 33.4-I1, process level)", () => {
  it.each([
    ["claude-code", "drift/wrong-shape.json", 'root key "mcpServers" holding an object of server entries', "an array (3 item(s))"],
    ["vscode", "drift/wrong-shape.jsonc", 'root key "servers" holding an object of server entries', "an array (3 item(s))"],
    ["codex", "drift/wrong-shape.toml", 'root key "mcp_servers" holding a table of server entries', "a string"],
    ["goose", "drift/wrong-shape.yaml", 'root key "extensions" holding a mapping of server entries', "an array (2 item(s))"],
  ] as const)(
    "%s: a wrong-shaped root key yields a config-drift finding naming client/path/expectation/ADAPTER_DATA_VERSION",
    (client, fixtureRel, expected, found) => {
      const sandbox = makeSandbox();
      const target = sandbox.configPath(client);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, readFixture(fixtureRel));

      const result = sandbox.run(["doctor", "--json"]);
      expect(result.status).toBe(1);
      const envelope = parseEnvelope(result);
      expect(envelope.ok).toBe(false);
      expect(envelope.command).toBe("doctor");
      const data = envelope.data as {
        findings: Array<{
          check: string;
          client: string;
          path: string | null;
          expected?: string;
          found?: string;
          adapterDataVersion?: string;
          detail: string;
        }>;
        findingCount: number;
      };
      const drift = data.findings.filter((finding) => finding.check === "config-drift");
      expect(drift).toHaveLength(1);
      const finding = drift[0]!;
      expect(finding.client).toBe(client);
      expect(finding.path).toBe(target);
      expect(finding.expected).toBe(expected);
      expect(finding.found).toBe(found);
      expect(finding.adapterDataVersion).toBe(ADAPTER_DATA_VERSION);
      expect(finding.detail).toContain(ADAPTER_DATA_VERSION);
      // DISTINCT from unparseable: no parseability finding for the same file.
      expect(data.findings.some((row) => row.check === "parseability")).toBe(false);
      expect(data.findingCount).toBe(data.findings.length);
    },
    T,
  );

  it("a parseable file WITHOUT the root key (a normal no-MCP-section config) is NOT drift", () => {
    const sandbox = makeSandbox();
    const target = sandbox.configPath("claude-code");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFixture("drift/no-mcp-section.json"));

    const result = sandbox.run(["doctor", "--json"]);
    expect(result.status).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { findings: unknown[]; findingCount: number };
    expect(data.findingCount).toBe(0);
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 5. Mode gating on a host WITHOUT Server Manager / governance file.
// ════════════════════════════════════════════════════════════════════

describe("E2E mode gating (the 33.1 seam, process level)", () => {
  it("a bare host hides server-manager/governance-file from --help and refuses them with exit 2", () => {
    const sandbox = makeSandbox();
    const original = seedFamily(sandbox, "claude-code");

    // --help lists only the always-available modes.
    let result = sandbox.run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("env-reference");
    expect(result.stdout).toContain("explicit");
    expect(result.stdout).not.toContain("IRIS_SERVER_MANAGER=auto — connections from Server Manager profiles");
    expect(result.stdout).not.toContain("IRIS_GOVERNANCE_FILE=<path> — governance from a shared file");
    expect(result.stdout).toContain("mode(s) unavailable on this host are hidden");

    // Forcing either gated mode is a usage error (exit 2) and writes NOTHING.
    result = sandbox.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--mode", "server-manager", "--yes"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mode "server-manager" is not available on this host');
    result = sandbox.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--mode", "governance-file", "--yes"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('mode "governance-file" is not available on this host');
    result = sandbox.run(["diff", "--client", "claude-code", "--servers", "iris-admin-mcp", "--mode", "server-manager"]);
    expect(result.status).toBe(2);
    expect(readFileSync(sandbox.configPath("claude-code"), "utf8")).toBe(original);
  }, T);

  it("the positive wiring: probed hosts list the modes and apply succeeds through the bin", () => {
    const sandbox = makeSandbox();
    seedFamily(sandbox, "claude-code");

    // server-manager available via the environment.
    let result = sandbox.run(["--help"], { env: { IRIS_SERVER_MANAGER: "auto" } });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IRIS_SERVER_MANAGER=auto — connections from Server Manager profiles");
    result = sandbox.run(
      ["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--mode", "server-manager", "--yes"],
      { env: { IRIS_SERVER_MANAGER: "auto" } },
    );
    expect(result.status).toBe(0);
    expect(readFileSync(sandbox.configPath("claude-code"), "utf8")).toContain('"IRIS_SERVER_MANAGER": "auto"');

    // governance-file available via an existing file named by the env.
    const govPath = path.join(sandbox.home, "gov.json");
    writeFileSync(govPath, '{"global": {}}\n');
    result = sandbox.run(["--help"], { env: { IRIS_GOVERNANCE_FILE: govPath } });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IRIS_GOVERNANCE_FILE=<path> — governance from a shared file");
    result = sandbox.run(
      ["apply", "--client", "claude-code", "--servers", "iris-ops-mcp", "--mode", "governance-file", "--yes"],
      { env: { IRIS_GOVERNANCE_FILE: govPath } },
    );
    expect(result.status).toBe(0);
    expect(readFileSync(sandbox.configPath("claude-code"), "utf8")).toContain('"IRIS_GOVERNANCE_FILE"');
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 6. Secret discipline: the explicit-mode preview never echoes the password.
// ════════════════════════════════════════════════════════════════════

describe("E2E explicit-mode secret discipline", () => {
  it("at/above the redaction gate: the preview masks the secret; the file holds it; streams never echo it", () => {
    const sandbox = makeSandbox();
    seedFamily(sandbox, "claude-code");
    const secret = "s3cr3t-value-never-echoed"; // 25 chars ≥ the 8-char gate

    const result = sandbox.run(
      [
        "apply", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--confirm-secret", "iris-admin-mcp",
        "--password-stdin", "--yes",
      ],
      { input: `${secret}\n` },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("********"); // masked render
    expect(result.stdout + result.stderr).not.toContain(secret);
    // The config file is SUPPOSED to hold the literal (explicit mode).
    expect(readFileSync(sandbox.configPath("claude-code"), "utf8")).toContain(secret);
    // state.json marks it containsSecret.
    const state = JSON.parse(readFileSync(stateFileOf(sandbox), "utf8")) as {
      entries: { name: string; containsSecret: boolean }[];
    };
    expect(state.entries.some((entry) => entry.name === "iris-admin-mcp" && entry.containsSecret)).toBe(true);
  }, T);

  it("below the redaction gate: the render is WITHHELD entirely; the secret still never echoes", () => {
    const sandbox = makeSandbox();
    seedFamily(sandbox, "claude-code");
    const secret = "pw12345"; // 7 chars < the 8-char gate — exact-replace would corrupt prose

    const result = sandbox.run(
      [
        "apply", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--confirm-secret", "iris-admin-mcp",
        "--password-stdin", "--yes",
      ],
      { input: `${secret}\n` },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("(render withheld");
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(readFileSync(sandbox.configPath("claude-code"), "utf8")).toContain(secret);
  }, T);

  it("a wrong --confirm-secret refuses BEFORE writing (exit 2) and never echoes the password", () => {
    const sandbox = makeSandbox();
    const original = seedFamily(sandbox, "claude-code");
    const secret = "s3cr3t-value-never-echoed";

    const result = sandbox.run(
      [
        "apply", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--confirm-secret", "iris-ops-mcp",
        "--password-stdin", "--yes",
      ],
      { input: `${secret}\n` },
    );
    expect(result.status).toBe(2);
    expect(readFileSync(sandbox.configPath("claude-code"), "utf8")).toBe(original);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(existsSync(sandbox.stateDir)).toBe(false);
  }, T);

  it("explicit mode without --confirm-secret refuses (exit 2); --password-stdin with an empty stdin refuses", () => {
    const sandbox = makeSandbox();
    const original = seedFamily(sandbox, "claude-code");

    let result = sandbox.run(
      ["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--mode", "explicit", "--yes"],
      { input: "whatever-password\n" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--confirm-secret");

    result = sandbox.run(
      [
        "apply", "--client", "claude-code", "--servers", "iris-admin-mcp",
        "--mode", "explicit", "--confirm-secret", "iris-admin-mcp", "--password-stdin", "--yes",
      ],
      { input: "" }, // empty stdin → usage failure, never a silent exit 0
    );
    expect(result.status).toBe(2);
    expect(readFileSync(sandbox.configPath("claude-code"), "utf8")).toBe(original);
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 7. restore through the real bin (write command + restart hint).
// ════════════════════════════════════════════════════════════════════

describe("E2E restore", () => {
  it("restore rolls the config back to the pre-apply bytes and prints the restart hint", () => {
    const sandbox = makeSandbox();
    const original = seedFamily(sandbox, "claude-code");
    const target = sandbox.configPath("claude-code");

    expect(sandbox.run(["apply", "--client", "claude-code", "--servers", "iris-admin-mcp", "--yes"]).status).toBe(0);
    expect(readFileSync(target, "utf8")).not.toBe(original);

    const result = sandbox.run(["restore", "--client", "claude-code"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("restored from");
    expect(result.stdout).toContain("Restart:");
    expect(readFileSync(target, "utf8")).toBe(original);

    // An unknown backup name is an operational failure.
    const unknown = sandbox.run(["restore", "--client", "claude-code", "--backup", "nope.bak"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('no backup named "nope.bak"');
  }, T);
});
