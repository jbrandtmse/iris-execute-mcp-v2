/**
 * Story 44.2 QA - the `vscode` Copilot targets and the shared `.mcp.json`, driven through the BUILT bin
 * (`dist/cli/clients-cli.js`) as a real child process against a real-filesystem scratch HOME.
 *
 * `clients-cli-process.test.ts` carries the happy-path process pins of the story's Integration AC. This file closes the gaps
 * the in-memory suites (`vscode-copilot-targets.test.ts`, `shared-mcp-json.test.ts`) cannot reach, because they never cross
 * `process.argv` / `process.env` / `os.homedir()` / the real file system:
 *
 * - the env-variable matrix (`COPILOT_HOME` set, set-but-empty, unset; `XDG_CONFIG_HOME` and `CLAUDE_CONFIG_DIR` never consulted);
 * - no literal secret by default on every mode and both scopes, with a hostile `IRIS_PASSWORD` in the child environment
 *   and the WHOLE scratch tree scanned for it (explicit needs its typed confirmation);
 * - the strict-JSON user file (a comment or trailing comma is a validation refusal) against the tolerant shared `.mcp.json`;
 * - the shared-file rows: byte-identical writes, adopt writes nothing, conflict in both directions, the unrecorded-entry
 *   asymmetry (AD-15), the disable/remove notes, and `doctor` reporting the shared file once;
 * - the migration out of non-canonical legacy `.vscode/mcp.json` / profile `mcp.json` files (CRLF, BOM, 4-space, trailing commas,
 *   fully compact, comments inside the owned span, `inputs`), byte for byte, plus its `diff` preview, `remove` sweep and backup;
 * - the home-directory refusal for the new project file.
 *
 * Rule #54: the child env is built from scratch (PATH + home variables), the expected bytes are hand-derived literals (an
 * independent oracle: nothing here calls the engine's own edit code), and each fixture is a shape a real file can have.
 * Rule #58: every write path below runs on non-canonical fixtures, not only canonical ones.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "dist", "cli", "clients-cli.js");
const T = 120_000;

const HOSTILE_PASSWORD = "hostile-env-secret-Zq9x7";
const IRIS_ENV: Record<string, string> = {
  IRIS_HOST: "iris.local",
  IRIS_PORT: "52773",
  IRIS_USERNAME: "_SYSTEM",
  IRIS_NAMESPACE: "USER",
  IRIS_HTTPS: "false",
  IRIS_PASSWORD: HOSTILE_PASSWORD,
};

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Box {
  home: string;
  project: string;
  stateDir: string;
  run: (args: string[], opts?: { input?: string; env?: Record<string, string>; cwd?: string }) => Run;
}

const made: string[] = [];
afterEach(() => {
  while (made.length > 0) rmSync(made.pop() as string, { recursive: true, force: true });
});

/** A scratch HOME and project directory (both resolved through `realpath`, as the home guard compares real paths). */
function makeBox(): Box {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "qa442-home-")));
  const project = realpathSync(mkdtempSync(path.join(tmpdir(), "qa442-proj-")));
  made.push(home, project);
  const run: Box["run"] = (args, opts = {}) => {
    const result = spawnSync(process.execPath, [BIN, ...args], {
      cwd: opts.cwd ?? project,
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
      input: opts.input ?? "",
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  return { home, project, stateDir: path.join(home, ".iris-mcp", "client-manager"), run };
}

const APPLY = (client: string, scope: string, extra: string[] = []): string[] => [
  "apply", "--client", client, "--scope", scope, "--servers", "iris-dev-mcp", "--yes", ...extra,
];
const TOGGLE = (verb: string, client: string, scope: string, extra: string[] = []): string[] => [
  verb, "--client", client, "--scope", scope, "--server", "iris-dev-mcp", ...extra,
];

const envelope = (result: Run): { ok: boolean; command: string; data: Record<string, unknown>; error?: string } =>
  JSON.parse(result.stdout) as { ok: boolean; command: string; data: Record<string, unknown>; error?: string };

/** Every file below `dir`, concatenated: the whole-tree secret scan. */
function allBytes(dir: string): string {
  let text = "";
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else text += `\n--${full}--\n${readFileSync(full, "utf8")}`;
    }
  };
  walk(dir);
  return text;
}

/** The old Local-harness profile mcp.json (win32 %APPDATA%/Code/User; darwin ~/Library/Application Support; linux ~/.config). */
function legacyUserPath(home: string): string {
  return process.platform === "win32"
    ? path.join(home, "AppData", "Roaming", "Code", "User", "mcp.json")
    : process.platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Code", "User", "mcp.json")
      : path.join(home, ".config", "Code", "User", "mcp.json");
}

function seed(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const statusScope = (result: Run, client: string, scope: string): { path: string | null; file: string; sharedWith?: string[] } | undefined =>
  (envelope(result).data as { clients: { client: string; scopes: { scope: string; path: string | null; file: string; sharedWith?: string[] }[] }[] }).clients
    .find((entry) => entry.client === client)
    ?.scopes.find((entry) => entry.scope === scope);

// ====================================================================
// 1. COPILOT_HOME and the variables that must NOT matter.
// ====================================================================

describe("QA 44.2: COPILOT_HOME, XDG_CONFIG_HOME and CLAUDE_CONFIG_DIR (process level, probe V1)", () => {
  it("unset, set, and set-but-empty: status, apply and remove all follow the same resolved file", () => {
    for (const [label, env, expected] of [
      ["unset", {}, (b: Box) => path.join(b.home, ".copilot", "mcp-config.json")],
      ["set", { COPILOT_HOME: "__CUSTOM__" }, (b: Box) => path.join(b.home, "custom-cph", "mcp-config.json")],
      ["empty", { COPILOT_HOME: "" }, (b: Box) => path.join(b.home, ".copilot", "mcp-config.json")],
    ] as const) {
      const box = makeBox();
      const runEnv = label === "set" ? { COPILOT_HOME: path.join(box.home, "custom-cph") } : { ...env };
      const target = expected(box);
      // A foreign neighbour in the OTHER candidate directory must never be touched.
      const decoy = label === "set" ? path.join(box.home, ".copilot", "mcp-config.json") : path.join(box.home, "custom-cph", "mcp-config.json");
      seed(decoy, '{"mcpServers":{"decoy":{"command":"d"}}}');

      const applied = box.run(APPLY("vscode", "user"), { env: runEnv });
      expect(applied.status, `${label}: ${applied.stdout}${applied.stderr}`).toBe(0);
      expect(applied.stdout, label).toContain(target);
      expect(JSON.parse(readFileSync(target, "utf8")).mcpServers["iris-dev-mcp"].type, label).toBe("stdio");
      expect(readFileSync(decoy, "utf8"), label).toBe('{"mcpServers":{"decoy":{"command":"d"}}}');

      const after = statusScope(box.run(["status", "--json"], { env: runEnv }), "vscode", "user");
      expect(after?.path, label).toBe(target);
      expect(after?.file, label).toBe("ok");
      const removed = box.run(TOGGLE("remove", "vscode", "user"), { env: runEnv });
      expect(removed.status, `${label}: ${removed.stderr}`).toBe(0);
      expect(JSON.parse(readFileSync(target, "utf8")).mcpServers["iris-dev-mcp"], label).toBeUndefined();
    }
  }, T);

  it("XDG_CONFIG_HOME and CLAUDE_CONFIG_DIR never move the vscode user file; CLAUDE_CONFIG_DIR still moves claude-code's", () => {
    const box = makeBox();
    const env = { XDG_CONFIG_HOME: path.join(box.home, "xdg"), CLAUDE_CONFIG_DIR: path.join(box.home, "claude-dir") };
    // A project .mcp.json makes both clients detected, so status lists their rows (an undetected client has none).
    seed(path.join(box.project, ".mcp.json"), "{}");
    const status = box.run(["status", "--json"], { env });
    expect(statusScope(status, "vscode", "user")?.path).toBe(path.join(box.home, ".copilot", "mcp-config.json"));
    expect(statusScope(status, "claude-code", "user")?.path).toBe(path.join(box.home, "claude-dir", ".claude.json"));
    const applied = box.run(APPLY("vscode", "user"), { env });
    expect(applied.status, applied.stderr).toBe(0);
    expect(existsSync(path.join(box.home, ".copilot", "mcp-config.json"))).toBe(true);
    expect(existsSync(path.join(box.home, "xdg"))).toBe(false);
    expect(existsSync(path.join(box.home, "claude-dir"))).toBe(false);
  }, T);

  it("COPILOT_HOME does not move the old profile mcp.json that the migration reads: that stays under the Code user directory", () => {
    const box = makeBox();
    const legacy = legacyUserPath(box.home);
    const old = '{\n  "servers": {\n    "keep": { "command": "k" },\n    "iris-dev-mcp": { "command": "npx" }\n  }\n}\n';
    seed(legacy, old);
    const env = { COPILOT_HOME: path.join(box.home, "cph") };
    const status = envelope(box.run(["status", "--json"], { env })).data as {
      clients: { client: string; scopes: { scope: string; legacy?: { path: string; servers: string[] }[] }[] }[];
    };
    expect(status.clients.find((c) => c.client === "vscode")?.scopes.find((s) => s.scope === "user")?.legacy?.[0]?.path).toBe(legacy);
    expect(box.run(APPLY("vscode", "user"), { env }).status).toBe(0);
    expect(existsSync(path.join(box.home, "cph", "mcp-config.json"))).toBe(true);
    expect(readFileSync(legacy, "utf8")).toBe('{\n  "servers": {\n    "keep": { "command": "k" }\n  }\n}\n');
  }, T);
});

// ====================================================================
// 2. No literal secret by default, on every mode and scope.
// ====================================================================

describe("QA 44.2: no literal secret by default (AD-9), process level, hostile IRIS_PASSWORD in the environment", () => {
  const GOV = (box: Box): string => {
    const file = path.join(box.home, "gov.json");
    writeFileSync(file, '{"global": {}}\n');
    return file;
  };

  it("env-reference, server-manager and governance-file at user and project scope write no password and no inputs; the project entry equals claude-code's", () => {
    for (const mode of ["env-reference", "server-manager", "governance-file"] as const) {
      for (const scope of ["user", "project"] as const) {
        const vs = makeBox();
        const env = { ...IRIS_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_GOVERNANCE_FILE: GOV(vs) };
        const result = vs.run(APPLY("vscode", scope, ["--mode", mode]), { env });
        expect(result.status, `${mode}/${scope}: ${result.stdout}${result.stderr}`).toBe(0);
        const file = scope === "user" ? path.join(vs.home, ".copilot", "mcp-config.json") : path.join(vs.project, ".mcp.json");
        const text = readFileSync(file, "utf8");
        expect(text, `${mode}/${scope}`).not.toContain('"inputs"');
        expect(text, `${mode}/${scope}`).not.toMatch(/\$\{(env|input|command):/);
        // The WHOLE scratch tree (config, ledger, backups) and both output streams: the secret is nowhere.
        expect(allBytes(vs.home) + allBytes(vs.project) + result.stdout + result.stderr, `${mode}/${scope}`).not.toContain(HOSTILE_PASSWORD);
        if (mode === "env-reference") expect(text).toContain('"IRIS_PASSWORD": "${IRIS_PASSWORD}"');
        else expect(text, `${mode}/${scope} should not even reference the password`).not.toContain("IRIS_PASSWORD");

        if (scope === "project") {
          const cc = makeBox();
          const govCc = path.join(cc.home, "gov.json");
          writeFileSync(govCc, '{"global": {}}\n');
          const ccEnv = { ...IRIS_ENV, IRIS_SERVER_MANAGER: "auto", IRIS_GOVERNANCE_FILE: govCc };
          expect(cc.run(APPLY("claude-code", "project", ["--mode", mode]), { env: ccEnv }).status, mode).toBe(0);
          // The governance path differs per scratch home; compare the shape with it normalized.
          const norm = (value: string, home: string): string => value.split(home).join("<HOME>");
          expect(norm(readFileSync(path.join(cc.project, ".mcp.json"), "utf8"), cc.home), mode).toBe(norm(text, vs.home));
        }
      }
    }
  }, T);

  it("explicit mode without its typed confirmation is a usage error (exit 2) at both scopes and writes nothing; with it, the literal lands only in the file and the ledger flags it", () => {
    for (const scope of ["user", "project"] as const) {
      const refused = makeBox();
      const bare = refused.run(APPLY("vscode", scope, ["--mode", "explicit", "--password-stdin"]), { input: "typed-literal-pw-1\n" });
      expect(bare.status, `${scope}: ${bare.stderr}`).toBe(2);
      expect(existsSync(path.join(refused.home, ".copilot"))).toBe(false);
      expect(existsSync(path.join(refused.project, ".mcp.json"))).toBe(false);
      expect(existsSync(refused.stateDir)).toBe(false);
      expect(bare.stdout + bare.stderr).not.toContain("typed-literal-pw-1");

      const wrong = refused.run(APPLY("vscode", scope, ["--mode", "explicit", "--confirm-secret", "iris-admin-mcp", "--password-stdin"]), { input: "typed-literal-pw-1\n" });
      expect(wrong.status).toBe(2);
      expect(existsSync(refused.stateDir)).toBe(false);

      const ok = makeBox();
      const typed = ok.run(APPLY("vscode", scope, ["--mode", "explicit", "--confirm-secret", "iris-dev-mcp", "--password-stdin"]), { input: "typed-literal-pw-1\n" });
      expect(typed.status, `${scope}: ${typed.stdout}${typed.stderr}`).toBe(0);
      const file = scope === "user" ? path.join(ok.home, ".copilot", "mcp-config.json") : path.join(ok.project, ".mcp.json");
      expect(readFileSync(file, "utf8")).toContain("typed-literal-pw-1");
      expect(typed.stdout + typed.stderr, "streams never echo the password").not.toContain("typed-literal-pw-1");
      expect(readFileSync(path.join(ok.stateDir, "state.json"), "utf8")).toContain('"containsSecret": true');
      expect(readFileSync(path.join(ok.stateDir, "state.json"), "utf8")).not.toContain("typed-literal-pw-1");
    }
  }, T);
});

// ====================================================================
// 3. The strict user file vs the tolerant shared project file.
// ====================================================================

describe("QA 44.2: the user mcp-config.json is strict JSON, the shared .mcp.json is as tolerant as Claude Code's", () => {
  const STRICT_BAD = [
    ["line comment", '// c\n{"mcpServers":{}}\n'],
    ["trailing comma", '{"mcpServers":{"a":{"command":"x"},}}\n'],
    ["block comment inside", '{"mcpServers":{ /* c */ }}\n'],
  ] as const;

  for (const [label, bad] of STRICT_BAD) {
    it(`${label}: apply, status and doctor all refuse the user file; its bytes are untouched and no backup or ledger appears`, () => {
      const box = makeBox();
      const file = path.join(box.home, ".copilot", "mcp-config.json");
      seed(file, bad);
      const refused = box.run(APPLY("vscode", "user"));
      expect(refused.status, refused.stdout).toBe(1);
      expect(refused.stderr).toContain("unparseable");
      expect(readFileSync(file, "utf8")).toBe(bad);
      expect(existsSync(box.stateDir)).toBe(false);
      expect(statusScope(box.run(["status", "--json"]), "vscode", "user")?.file).toBe("unparseable");
      const doctor = envelope(box.run(["doctor", "--json"]));
      expect(doctor.ok).toBe(false);
      expect((doctor.data.findings as { check: string; client: string; scope: string }[]).filter((f) => f.check === "parseability" && f.client === "vscode" && f.scope === "user")).toHaveLength(1);
    }, T);
  }

  it("the same comment and trailing comma in the project .mcp.json are accepted (as for claude-code) and preserved byte for byte around the new entry", () => {
    const box = makeBox();
    const file = path.join(box.project, ".mcp.json");
    const original = '// project servers\n{\n  "mcpServers": {\n    "keep": { "command": "k", }, // trailing\n  },\n}\n';
    seed(file, original);
    const applied = box.run(APPLY("vscode", "project"));
    expect(applied.status, `${applied.stdout}${applied.stderr}`).toBe(0);
    const after = readFileSync(file, "utf8");
    expect(after.startsWith('// project servers\n{\n  "mcpServers": {\n    "keep": { "command": "k", }, // trailing\n')).toBe(true);
    expect(after).toContain('"iris-dev-mcp"');
    expect(box.run(TOGGLE("remove", "vscode", "project")).status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(original);
  }, T);
});

// ====================================================================
// 4. The shared project .mcp.json through the built bin.
// ====================================================================

describe("QA 44.2: the shared .mcp.json (process level)", () => {
  it("vscode and claude-code write byte-identical project files for the same inputs, on every non-canonical shape", () => {
    const shapes: Record<string, string> = {
      none: "",
      compact: '{"mcpServers":{"foo":{"command":"x","args":["a"]}}}',
      fourSpace: '{\n    "mcpServers": {\n        "foo": {\n            "command": "x"\n        }\n    }\n}\n',
      crlfBom: '﻿{\r\n  "mcpServers": {\r\n    "foo": {\r\n      "command": "x"\r\n    }\r\n  }\r\n}\r\n',
      comments: '// top\n{\n  /* block */ "mcpServers": {\n    "foo": { "command": "x" }, // trailing\n    "bar": { "command": "y" /* inner */ }\n  }\n}\n',
    };
    for (const [name, original] of Object.entries(shapes)) {
      const a = makeBox();
      const b = makeBox();
      if (original !== "") {
        seed(path.join(a.project, ".mcp.json"), original);
        seed(path.join(b.project, ".mcp.json"), original);
      }
      expect(a.run(APPLY("claude-code", "project")).status, name).toBe(0);
      expect(b.run(APPLY("vscode", "project")).status, name).toBe(0);
      const viaCc = readFileSync(path.join(a.project, ".mcp.json"), "utf8");
      expect(readFileSync(path.join(b.project, ".mcp.json"), "utf8"), name).toBe(viaCc);
      if (original !== "") expect(viaCc.startsWith(original.slice(0, 12)), name).toBe(true);
      // Remove through the OTHER client's name: foreign bytes return exactly.
      expect(b.run(TOGGLE("remove", "vscode", "project")).status, name).toBe(0);
      if (original !== "") expect(readFileSync(path.join(b.project, ".mcp.json"), "utf8"), name).toBe(original);
    }
  }, T);

  it("adopt writes nothing: the file is byte-identical, no backup is made, and both clients now hold a ledger record", () => {
    const box = makeBox();
    const file = path.join(box.project, ".mcp.json");
    expect(box.run(APPLY("claude-code", "project")).status).toBe(0);
    const bytes = readFileSync(file, "utf8");
    const backupsBefore = existsSync(path.join(box.stateDir, "backups")) ? readdirSync(path.join(box.stateDir, "backups")) : [];
    const adopt = box.run(APPLY("vscode", "project", ["--json"]));
    expect(adopt.status, adopt.stderr).toBe(0);
    const data = envelope(adopt).data as { results?: unknown; changed?: unknown };
    expect(JSON.stringify(data)).toContain("adopted");
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect(existsSync(path.join(box.stateDir, "backups")) ? readdirSync(path.join(box.stateDir, "backups")) : []).toEqual(backupsBefore);
    const ledger = JSON.parse(readFileSync(path.join(box.stateDir, "state.json"), "utf8")) as { entries: { client: string; scope: string; name: string }[] };
    expect(ledger.entries.map((entry) => `${entry.client}/${entry.scope}/${entry.name}`).sort()).toEqual([
      "claude-code/project/iris-dev-mcp",
      "vscode/project/iris-dev-mcp",
    ]);
  }, T);

  it("conflict in BOTH directions exits 1, names .mcp.json and the other client, and leaves file and ledger byte-identical", () => {
    // vscode first, then claude-code with a different (explicit) entry.
    const box = makeBox();
    expect(box.run(APPLY("vscode", "project")).status).toBe(0);
    const file = path.join(box.project, ".mcp.json");
    const bytes = readFileSync(file, "utf8");
    const ledger = readFileSync(path.join(box.stateDir, "state.json"), "utf8");
    const refused = box.run(APPLY("claude-code", "project", ["--mode", "explicit", "--confirm-secret", "iris-dev-mcp", "--password-stdin"]), { input: "a-long-password-1\n" });
    expect(refused.status, refused.stdout).toBe(1);
    expect(refused.stderr).toContain(".mcp.json");
    expect(refused.stderr).toContain("vscode");
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect(readFileSync(path.join(box.stateDir, "state.json"), "utf8")).toBe(ledger);
    expect(allBytes(box.home) + allBytes(box.project)).not.toContain("a-long-password-1");
  }, T);

  it("an UNRECORDED different canonical entry: vscode is refused (exit 1, nothing written), claude-code replaces it as before (AD-15), then vscode adopts", () => {
    const box = makeBox();
    const file = path.join(box.project, ".mcp.json");
    const handWritten = '{\n  "mcpServers": {\n    "iris-dev-mcp": { "command": "node", "args": ["/my/own/build.js"] }\n  }\n}\n';
    seed(file, handWritten);
    const refused = box.run(APPLY("vscode", "project"));
    expect(refused.status, refused.stdout).toBe(1);
    expect(refused.stderr).toContain(".mcp.json");
    expect(refused.stderr).toContain("claude-code");
    expect(readFileSync(file, "utf8")).toBe(handWritten);
    expect(existsSync(box.stateDir)).toBe(false);

    expect(box.run(APPLY("claude-code", "project")).status).toBe(0);
    expect(readFileSync(file, "utf8")).toContain('"@iris-mcp/dev@1"');
    const adopt = box.run(APPLY("vscode", "project"));
    expect(adopt.status, adopt.stderr).toBe(0);
    expect(adopt.stdout).toContain("adopted");
  }, T);

  it("disable and remove by either client proceed and name the other client that reads the file (text and --json)", () => {
    const box = makeBox();
    expect(box.run(APPLY("claude-code", "project")).status).toBe(0);
    expect(box.run(APPLY("vscode", "project")).status).toBe(0);
    const disabled = box.run(TOGGLE("disable", "vscode", "project"));
    expect(disabled.status).toBe(0);
    expect(disabled.stdout).toContain("Claude Code (claude-code) reads the same file");
    expect(readFileSync(path.join(box.project, ".mcp.json"), "utf8")).not.toContain("iris-dev-mcp");
    // The entry is gone from the one shared file, so claude-code's own enable has no stash of its own to restore; vscode's does.
    const enabled = box.run(TOGGLE("enable", "vscode", "project"));
    expect(enabled.status, enabled.stderr).toBe(0);
    expect(readFileSync(path.join(box.project, ".mcp.json"), "utf8")).toContain("iris-dev-mcp");
    const removed = box.run(TOGGLE("remove", "claude-code", "project", ["--json"]));
    expect(removed.status).toBe(0);
    const data = envelope(removed).data as { sharedWith?: string[]; sharedNote?: string; changed?: boolean };
    expect(data.changed).toBe(true);
    expect(data.sharedWith).toEqual(["vscode"]);
    expect(data.sharedNote).toContain("VS Code (Copilot) (vscode) reads the same file");
  }, T);

  it("status and detect list the file under both clients once each, doctor reports an unreadable shared file once, and an env-reference finding once per variable", () => {
    const box = makeBox();
    const file = path.join(box.project, ".mcp.json");
    expect(box.run(APPLY("claude-code", "project")).status).toBe(0);
    expect(box.run(APPLY("vscode", "project")).status).toBe(0);

    const clean = envelope(box.run(["doctor", "--json"]));
    const env = (clean.data.findings as { check: string; path: string; detail: string }[]).filter((f) => f.check === "env-references" && f.path === file);
    expect(env).toHaveLength(6);
    expect(new Set(env.map((f) => f.detail)).size, "one finding per variable, not per client").toBe(6);
    expect(clean.data.parsedFiles).toBe(1);

    const detect = envelope(box.run(["detect", "--json"])).data as { clients: { client: string; probes: { kind: string; scope?: string; path: string; sharedWith?: string[] }[] }[] };
    const shared = detect.clients.flatMap((c) => c.probes.filter((p) => p.kind === "config" && p.scope === "project" && p.sharedWith !== undefined).map((p) => ({ client: c.client, ...p })));
    expect(shared.map((x) => x.client).sort()).toEqual(["claude-code", "vscode"]);
    expect(new Set(shared.map((x) => x.path)).size).toBe(1);
    expect(shared.find((x) => x.client === "vscode")?.sharedWith).toEqual(["claude-code"]);

    writeFileSync(file, '{ "mcpServers": { "iris-dev-mcp": ');
    const broken = envelope(box.run(["doctor", "--json"]));
    expect((broken.data.findings as { check: string; path: string }[]).filter((f) => f.check === "parseability" && f.path === file)).toHaveLength(1);
    const status = box.run(["status", "--json"]);
    expect(statusScope(status, "claude-code", "project")?.file).toBe("unparseable");
    expect(statusScope(status, "vscode", "project")?.file).toBe("unparseable");
  }, T);

  it("the project file under the home directory is refused for vscode (apply and diff), user scope is not, and nothing is created", () => {
    const box = makeBox();
    for (const argv of [APPLY("vscode", "project"), ["diff", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp"]]) {
      const refused = box.run(argv, { cwd: box.home });
      expect(refused.status, argv[0]).toBe(1);
      expect(refused.stderr).toContain("home directory");
    }
    expect(existsSync(path.join(box.home, ".mcp.json"))).toBe(false);
    expect(existsSync(box.stateDir)).toBe(false);
    // The user scope is still writable from there, and status/detect are never refused.
    expect(box.run(APPLY("vscode", "user"), { cwd: box.home }).status).toBe(0);
    expect(box.run(["status"], { cwd: box.home }).status).toBe(0);
  }, T);
});

// ====================================================================
// 5. The migration out of the old files, on non-canonical fixtures.
// ====================================================================

interface Legacy {
  label: string;
  before: string;
  /** The hand-derived bytes after the owned entry leaves (the oracle: derived from the fixture, not from the engine). */
  after: string;
}

const LEGACY: Legacy[] = [
  {
    label: "BOM + CRLF, a comment inside the owned span, a trailing comment on a foreign entry, inputs last",
    before:
      '﻿{\r\n  // Local harness servers\r\n  "servers": {\r\n    "keep-first": { "command": "a" }, // keep\r\n    "iris-dev-mcp": { // owned\r\n      "command": "npx",\r\n      "env": { "IRIS_PASSWORD": "${input:iris-password}" }\r\n    },\r\n    "keep-last": { "command": "b" }\r\n  },\r\n  "inputs": [\r\n    { "id": "iris-password", "type": "promptString", "password": true }\r\n  ]\r\n}\r\n',
    after:
      '﻿{\r\n  // Local harness servers\r\n  "servers": {\r\n    "keep-first": { "command": "a" }, // keep\r\n    "keep-last": { "command": "b" }\r\n  },\r\n  "inputs": [\r\n    { "id": "iris-password", "type": "promptString", "password": true }\r\n  ]\r\n}\r\n',
  },
  {
    label: "4-space indent with trailing commas everywhere, the owned entry last",
    before: '{\n    "servers": {\n        "keep": { "command": "a", },\n        "iris-dev-mcp": {\n            "command": "npx",\n        },\n    },\n    "inputs": [],\n}\n',
    after: '{\n    "servers": {\n        "keep": { "command": "a", },\n    },\n    "inputs": [],\n}\n',
  },
  {
    label: "fully compact single line",
    before: '{"servers":{"keep":{"command":"a"},"iris-dev-mcp":{"command":"npx"}},"inputs":[{"id":"iris-password"}]}',
    after: '{"servers":{"keep":{"command":"a"}},"inputs":[{"id":"iris-password"}]}',
  },
  {
    label: "the owned entry first, a foreign comment line after it",
    before: '{\n  "servers": {\n    "iris-dev-mcp": { "command": "npx" },\n    // keep me\n    "keep": { "command": "a" }\n  }\n}\n',
    after: '{\n  "servers": {\n    // keep me\n    "keep": { "command": "a" }\n  }\n}\n',
  },
  {
    label: "comments and a block comment inside the owned span",
    before: '{\n  "servers": {\n    "iris-dev-mcp": {\n      "command": "npx", // why\n      /* env */ "env": { "A": "${env:A}" }\n    },\n    "keep": { "command": "a" }\n  }\n}\n',
    after: '{\n  "servers": {\n    "keep": { "command": "a" }\n  }\n}\n',
  },
];

function backupsOf(box: Box, scope: string): string[] {
  const dir = path.join(box.stateDir, "backups", "vscode-legacy", scope);
  return existsSync(dir) ? readdirSync(dir).map((name) => readFileSync(path.join(dir, name), "utf8")) : [];
}

describe("QA 44.2: the migration out of a non-canonical legacy .vscode/mcp.json (project scope, built bin)", () => {
  for (const fixture of LEGACY) {
    it(`${fixture.label}: diff previews and writes nothing; apply moves only the owned entry; the old file is backed up; a second apply leaves both files byte-identical`, () => {
      const box = makeBox();
      const legacy = path.join(box.project, ".vscode", "mcp.json");
      seed(legacy, fixture.before);

      // diff: a preview of BOTH files, and not a byte written anywhere.
      const diff = box.run(["diff", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp", "--json"]);
      expect(diff.status, diff.stderr).toBe(0);
      expect((envelope(diff).data as { legacy?: { path: string }[] }).legacy?.[0]?.path).toBe(legacy);
      expect(readFileSync(legacy, "utf8")).toBe(fixture.before);
      expect(existsSync(path.join(box.project, ".mcp.json"))).toBe(false);
      expect(existsSync(box.stateDir)).toBe(false);

      const applied = box.run(APPLY("vscode", "project"));
      expect(applied.status, `${applied.stdout}${applied.stderr}`).toBe(0);
      expect(JSON.parse(readFileSync(path.join(box.project, ".mcp.json"), "utf8")).mcpServers["iris-dev-mcp"].command).toBe("npx");
      expect(readFileSync(legacy, "utf8")).toBe(fixture.after);
      expect(backupsOf(box, "project"), "the old file's pre-edit bytes are the backup").toEqual([fixture.before]);
      // The old file's backup never sits under the Copilot target's own backup folder, so `restore --client vscode` cannot pick it.
      const ownBackups = path.join(box.stateDir, "backups", "vscode");
      expect(existsSync(ownBackups) ? allBytes(ownBackups).includes(fixture.before) : false).toBe(false);

      // A re-apply is an in-place update (a backup is taken, as for claude-code): the contract is that no byte moves.
      const mcpJson = path.join(box.project, ".mcp.json");
      const before = readFileSync(mcpJson, "utf8");
      const again = box.run(APPLY("vscode", "project"));
      expect(again.status, again.stderr).toBe(0);
      expect(readFileSync(legacy, "utf8")).toBe(fixture.after);
      expect(readFileSync(mcpJson, "utf8"), "the second apply leaves .mcp.json byte-identical").toBe(before);
      expect(backupsOf(box, "project"), "the second apply takes no further old-file backup").toEqual([fixture.before]);
      const doctor = envelope(box.run(["doctor", "--json"], { env: IRIS_ENV }));
      expect((doctor.data.findings as { check: string }[]).filter((f) => f.check === "vscode-local-harness-entries")).toEqual([]);
    }, T);
  }

  it("the owned entry is the ONLY entry: the file still parses, `inputs` is byte-identical, and nothing foreign is added", () => {
    const box = makeBox();
    const legacy = path.join(box.project, ".vscode", "mcp.json");
    const inputsLine = '  "inputs": [{ "id": "iris-password", "type": "promptString", "password": true }]';
    seed(legacy, `{\n  "servers": {\n    "iris-dev-mcp": { "command": "npx" }\n  },\n${inputsLine}\n}\n`);
    expect(box.run(APPLY("vscode", "project")).status).toBe(0);
    const after = readFileSync(legacy, "utf8");
    expect(after).toContain(inputsLine);
    expect(JSON.parse(after)).toEqual({ servers: {}, inputs: [{ id: "iris-password", type: "promptString", password: true }] });
  }, T);

  it("remove --client vscode sweeps the owned old-file entry and the new entry together; foreign bytes stay", () => {
    const box = makeBox();
    const legacy = path.join(box.project, ".vscode", "mcp.json");
    const fixture = LEGACY[0] as Legacy;
    expect(box.run(APPLY("vscode", "project")).status).toBe(0);
    // An older manager's entry put back into the old file (a pre-move install that was never migrated).
    seed(legacy, fixture.before);
    const removed = box.run(TOGGLE("remove", "vscode", "project", ["--json"]));
    expect(removed.status, removed.stderr).toBe(0);
    expect(readFileSync(legacy, "utf8")).toBe(fixture.after);
    expect(JSON.parse(readFileSync(path.join(box.project, ".mcp.json"), "utf8")).mcpServers?.["iris-dev-mcp"]).toBeUndefined();
  }, T);

  it("a migration with the shared rule in play: the old entry leaves even when claude-code already wrote the new .mcp.json (adopt), foreign bytes intact", () => {
    const box = makeBox();
    const legacy = path.join(box.project, ".vscode", "mcp.json");
    const fixture = LEGACY[1] as Legacy;
    seed(legacy, fixture.before);
    expect(box.run(APPLY("claude-code", "project")).status).toBe(0);
    const shared = readFileSync(path.join(box.project, ".mcp.json"), "utf8");
    const adopt = box.run(APPLY("vscode", "project"));
    expect(adopt.status, `${adopt.stdout}${adopt.stderr}`).toBe(0);
    expect(adopt.stdout).toContain("adopted");
    expect(readFileSync(path.join(box.project, ".mcp.json"), "utf8")).toBe(shared);
    expect(readFileSync(legacy, "utf8")).toBe(fixture.after);
  }, T);
});

describe("QA 44.2: the migration out of a non-canonical legacy profile mcp.json (user scope, built bin, COPILOT_HOME set)", () => {
  it("BOM + CRLF + comments + inputs: only the owned entry leaves the profile file, and the new entry lands in $COPILOT_HOME", () => {
    const box = makeBox();
    const legacy = legacyUserPath(box.home);
    const fixture = LEGACY[0] as Legacy;
    seed(legacy, fixture.before);
    const cph = path.join(box.home, "elsewhere");
    const applied = box.run(APPLY("vscode", "user"), { env: { COPILOT_HOME: cph } });
    expect(applied.status, `${applied.stdout}${applied.stderr}`).toBe(0);
    expect(readFileSync(legacy, "utf8")).toBe(fixture.after);
    expect(JSON.parse(readFileSync(path.join(cph, "mcp-config.json"), "utf8")).mcpServers["iris-dev-mcp"].type).toBe("stdio");
    expect(backupsOf(box, "user")).toEqual([fixture.before]);
    // The project scope's old file is a different file: this run never touched it.
    expect(existsSync(path.join(box.project, ".vscode"))).toBe(false);
  }, T);

  it("an old file that no longer parses: apply keeps the new entry and exits 1 saying the entry is still in the old file; the old bytes are untouched; doctor reports it as unreadable", () => {
    const box = makeBox();
    const legacy = path.join(box.project, ".vscode", "mcp.json");
    const broken = '{ "servers": { "iris-dev-mcp": ';
    seed(legacy, broken);
    const applied = box.run(APPLY("vscode", "project"));
    expect(applied.status, applied.stdout).toBe(1);
    expect(applied.stderr).toContain("the new entry was written");
    expect(applied.stderr).toContain("still in the old file");
    expect(readFileSync(legacy, "utf8")).toBe(broken);
    expect(JSON.parse(readFileSync(path.join(box.project, ".mcp.json"), "utf8")).mcpServers["iris-dev-mcp"].command).toBe("npx");
    const doctor = envelope(box.run(["doctor", "--json"], { env: IRIS_ENV }));
    const finding = (doctor.data.findings as { check: string; path: string; detail: string }[]).find((f) => f.check === "vscode-local-harness-entries");
    expect(finding?.path).toBe(legacy);
    expect(finding?.detail).toContain("unreadable");
  }, T);
});
