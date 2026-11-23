/**
 * Story 44.2, AC 44.2.2 and AC 44.2.4 - the `vscode` adapter writes the files the Copilot harness reads itself
 * (`~/.copilot/mcp-config.json` or `$COPILOT_HOME/mcp-config.json`, and the workspace `.mcp.json`), moves owned entries
 * out of the old Local-harness files, and never writes a secret literal by default.
 *
 * The expected shapes come from the probe of VS Code 1.147.0 (spec Design Notes D-1: V1 the user path and COPILOT_HOME, V8 the
 * Copilot-global writer's `{type, command, args, env, tools}` and its strict JSON read); the shared-file rows are in
 * `shared-mcp-json.test.ts`.
 */

import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { runCli, type CliDeps } from "../cli/clients.js";
import { CLIENT_ADAPTERS } from "../adapters.js";
import { apply, enable, remove } from "../engine.js";
import { resolveScopePath } from "../paths.js";
import { readState } from "../state.js";
import { executeNativeEdit } from "../write.js";
import { CANONICAL_SERVERS, type CanonicalEntry, type ClientAdapter, type EngineHostContext } from "../index.js";
import { synthesizeEntry, type EnvMode } from "../synthesize.js";

import { MemFs, fixedNow } from "./helpers.js";

const HOME = "/home/u";
const PROJECT = "/proj";
const USER_FILE = `${HOME}/.copilot/mcp-config.json`;
const PROJECT_FILE = `${PROJECT}/.mcp.json`;
const OLD_USER = `${HOME}/.config/Code/User/mcp.json`;
const OLD_PROJECT = `${PROJECT}/.vscode/mcp.json`;
const STATE_DIR = `${HOME}/.iris-mcp/client-manager`;

const vscode: ClientAdapter = (() => {
  const adapter = CLIENT_ADAPTERS["vscode"];
  if (adapter === undefined) throw new Error("registry");
  return adapter;
})();

function ctx(env: Record<string, string | undefined> = {}): EngineHostContext {
  return { platform: "linux", env, homeDir: HOME, projectDir: PROJECT, stateDir: STATE_DIR };
}

function collector(): { out: { text: string }; write: (chunk: string) => void } {
  const out = { text: "" };
  return { out, write: (chunk: string) => void (out.text += chunk) };
}

async function cli(fs: MemFs, argv: string[], extra: CliDeps = {}): Promise<{ exit: number; stdout: string; stderr: string }> {
  const stdout = collector();
  const stderr = collector();
  const exit = await runCli(argv, { env: {}, platform: "linux", homeDir: HOME, projectDir: PROJECT, fs, stdout, stderr, now: fixedNow(1, 2, 3, 4, 5, 6, 7, 8), ...extra });
  return { exit, stdout: stdout.out.text, stderr: stderr.out.text };
}

function entryFor(server: (typeof CANONICAL_SERVERS)[number], mode: EnvMode, extra: { confirm?: string; password?: string } = {}): CanonicalEntry {
  const result = synthesizeEntry(server, mode, {
    adapter: vscode,
    profile: { governanceFile: "/g.json", serverManagerNames: "prod", ...(extra.password !== undefined ? { password: extra.password } : {}) },
    ...(extra.confirm !== undefined ? { confirm: extra.confirm } : {}),
  });
  if (!result.ok) throw new Error(result.reason);
  return result.entry;
}

describe("AC 44.2.2: the write targets", () => {
  it("user scope, default: ~/.copilot/mcp-config.json gains mcpServers.<name> in the Copilot-global shape with ${VAR} references, no inputs, inputsMerged []", async () => {
    const fs = new MemFs();
    // The references are ${VAR}: the adapter expands like Claude Code's, never ${env:VAR} (the doctor reads this field).
    expect(vscode.envExpansion).toBe("claude");
    const run = await cli(fs, ["apply", "--client", "vscode", "--scope", "user", "--servers", "iris-dev-mcp", "--yes", "--json"]);
    expect(run.exit, run.stderr).toBe(0);
    expect(JSON.parse(fs.readFile(USER_FILE))).toEqual({
      mcpServers: {
        "iris-dev-mcp": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@iris-mcp/dev@1"],
          env: {
            IRIS_HOST: "${IRIS_HOST}",
            IRIS_PORT: "${IRIS_PORT}",
            IRIS_USERNAME: "${IRIS_USERNAME}",
            IRIS_NAMESPACE: "${IRIS_NAMESPACE}",
            IRIS_HTTPS: "${IRIS_HTTPS}",
            IRIS_PASSWORD: "${IRIS_PASSWORD}",
          },
          tools: ["*"],
        },
      },
    });
    const envelope = JSON.parse(run.stdout) as { data: { inputsMerged: string[] } };
    expect(envelope.data.inputsMerged).toEqual([]);
    expect(fs.files.has(`${HOME}/.config/Code/User/mcp.json`)).toBe(false);
  });

  it("COPILOT_HOME set: the file is $COPILOT_HOME/mcp-config.json; an empty value falls back to ~/.copilot, as VS Code does (probe V1)", () => {
    expect(resolveScopePath(vscode, "user", ctx({ COPILOT_HOME: "/x" }))).toBe("/x/mcp-config.json");
    expect(resolveScopePath(vscode, "user", ctx({ COPILOT_HOME: "" }))).toBe(USER_FILE);
    expect(resolveScopePath(vscode, "user", ctx({ COPILOT_HOME: undefined }))).toBe(USER_FILE);

    const fs = new MemFs();
    expect(apply(ctx({ COPILOT_HOME: "/x" }), "vscode", "user", entryFor("iris-dev-mcp", "env-reference"), { fs }).path).toBe("/x/mcp-config.json");
    expect(fs.exists("/x/mcp-config.json")).toBe(true);
    const empty = new MemFs();
    expect(apply(ctx({ COPILOT_HOME: "" }), "vscode", "user", entryFor("iris-dev-mcp", "env-reference"), { fs: empty }).path).toBe(USER_FILE);
  });

  it("XDG_CONFIG_HOME is never consulted, and on Windows the file is %USERPROFILE%\\.copilot\\mcp-config.json", () => {
    expect(resolveScopePath(vscode, "user", ctx({ XDG_CONFIG_HOME: "/xdg" }))).toBe(USER_FILE);
    const win = { platform: "win32" as const, env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, homeDir: "C:\\Users\\u" };
    expect(resolveScopePath(vscode, "user", win)).toBe("C:\\Users\\u\\.copilot\\mcp-config.json");
    expect(resolveScopePath(vscode, "user", { ...win, env: { COPILOT_HOME: "D:\\cp" } })).toBe("D:\\cp\\mcp-config.json");
  });

  it("project scope: the workspace .mcp.json entry equals what claude-code writes for the same inputs, in each mode", () => {
    for (const mode of ["env-reference", "server-manager", "governance-file"] as const) {
      const asVscode = new MemFs();
      const asClaude = new MemFs();
      const claude = CLIENT_ADAPTERS["claude-code"];
      if (claude === undefined) throw new Error("registry");
      const claudeEntry = synthesizeEntry("iris-dev-mcp", mode, { adapter: claude, profile: { governanceFile: "/g.json", serverManagerNames: "prod" } });
      if (!claudeEntry.ok) throw new Error(claudeEntry.reason);
      expect(apply(ctx(), "vscode", "project", entryFor("iris-dev-mcp", mode), { fs: asVscode }).ok, mode).toBe(true);
      expect(apply(ctx(), "claude-code", "project", claudeEntry.entry, { fs: asClaude }).ok, mode).toBe(true);
      expect(asVscode.readFile(PROJECT_FILE), mode).toBe(asClaude.readFile(PROJECT_FILE));
    }
  });

  it("user scope in every mode: the shape and the secret rule (non-explicit modes never write a password literal; explicit needs the typed confirmation)", () => {
    for (const mode of ["env-reference", "server-manager", "governance-file"] as const) {
      const fs = new MemFs();
      expect(apply(ctx(), "vscode", "user", entryFor("iris-dev-mcp", mode), { fs }).ok, mode).toBe(true);
      const text = fs.readFile(USER_FILE);
      const written = (JSON.parse(text) as { mcpServers: Record<string, Record<string, unknown>> }).mcpServers["iris-dev-mcp"];
      expect(Object.keys(written ?? {}), mode).toEqual(["type", "command", "args", "env", "tools"]);
      expect(text, mode).not.toMatch(/\$\{(env|input|command):/);
      expect(JSON.parse(text), mode).not.toHaveProperty("inputs");
      const password = ((written?.env ?? {}) as Record<string, string>)["IRIS_PASSWORD"];
      if (password !== undefined) expect(password.startsWith("${"), `${mode} wrote a literal password`).toBe(true);
    }
    const refused = synthesizeEntry("iris-dev-mcp", "explicit", { adapter: vscode, profile: { password: "p4ssw0rd-literal" } });
    expect(refused.ok).toBe(false);
    const fs = new MemFs();
    const result = apply(ctx(), "vscode", "user", entryFor("iris-dev-mcp", "explicit", { confirm: "iris-dev-mcp", password: "p4ssw0rd-literal" }), { fs, containsSecret: true });
    expect(result.ok).toBe(true);
    expect(fs.readFile(USER_FILE)).toContain("p4ssw0rd-literal");
    const ledger = readState(fs, STATE_DIR, "linux");
    expect(ledger.ok && ledger.state.entries[0]?.containsSecret).toBe(true);
  });

  it("the default CLI apply, at either scope, writes no secret literal and no inputs (the mechanical sweep)", async () => {
    for (const scope of ["user", "project"] as const) {
      const fs = new MemFs();
      expect((await cli(fs, ["apply", "--client", "vscode", "--scope", scope, "--servers", "all", "--yes"])).exit).toBe(0);
      const text = fs.readFile(scope === "user" ? USER_FILE : PROJECT_FILE);
      expect(text).not.toContain('"inputs"');
      expect(text).not.toMatch(/IRIS_PASSWORD": "[^$]/);
      expect(text.match(/"IRIS_PASSWORD": "\$\{IRIS_PASSWORD\}"/g)).toHaveLength(CANONICAL_SERVERS.length);
    }
  });

  it("a user file with a comment or a trailing comma is refused at validate (VS Code reads it with JSON.parse), and nothing is written", () => {
    for (const bad of ['// c\n{"mcpServers":{}}\n', '{"mcpServers":{"a":{"command":"x"},}}\n', '/* c */\n']) {
      const fs = new MemFs();
      fs.seed(USER_FILE, bad);
      const result = apply(ctx(), "vscode", "user", entryFor("iris-dev-mcp", "env-reference"), { fs });
      expect(result.ok, bad).toBe(false);
      expect(result.reason).toContain("unparseable");
      expect(result.reason, "the refusal says why").toContain("must be strict JSON (no comments, no trailing commas)");
      expect(fs.readFile(USER_FILE)).toBe(bad);
      expect([...fs.files.keys()].filter((p) => p.includes("/backups/"))).toEqual([]);
    }
  });

  it("a project directory that is the home directory is refused before the protocol, as today", async () => {
    const fs = new MemFs();
    const run = await cli(fs, ["apply", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp", "--yes"], { projectDir: HOME });
    expect(run.exit).toBe(1);
    expect(run.stderr).toContain("home directory");
    expect(fs.files.size).toBe(0);
  });
});

/** Seed the old Local-harness files: owned entries, foreign entries, and an `inputs` array. */
const OLD_USER_TEXT = `{\n  // old harness\n  "inputs": [\n    { "id": "iris-password", "type": "promptString", "password": true }\n  ],\n  "servers": {\n    "keep-user": { "command": "x" },\n    "iris-dev-mcp": { "command": "npx", "env": { "IRIS_PASSWORD": "\${input:iris-password}", "IRIS_HOST": "\${env:IRIS_HOST}" } }\n  }\n}\n`;
const OLD_PROJECT_TEXT = `{\n  "servers": {\n    "keep-project": { "command": "y" },\n    "iris-dev-mcp": { "command": "npx", "env": { "IRIS_PASSWORD": "\${input:iris-password}" } }\n  },\n  "inputs": []\n}\n`;

describe("AC 44.2.4: old installs are reported, then moved by apply through the protocol", () => {
  it("status and doctor report the owned entries in both old files; the files are never edited by a read", async () => {
    const fs = new MemFs();
    fs.seed(OLD_USER, OLD_USER_TEXT);
    fs.seed(OLD_PROJECT, OLD_PROJECT_TEXT);
    const status = JSON.parse((await cli(fs, ["status", "--json"])).stdout) as {
      data: { clients: Array<{ client: string; scopes: Array<{ scope: string; file: string; legacy?: Array<{ path: string; servers: string[] }> }> }> };
    };
    const scopes = status.data.clients.find((c) => c.client === "vscode")?.scopes ?? [];
    expect(scopes.find((s) => s.scope === "user")?.legacy).toEqual([{ path: OLD_USER, file: "ok", servers: ["iris-dev-mcp"] }]);
    expect(scopes.find((s) => s.scope === "project")?.legacy).toEqual([{ path: OLD_PROJECT, file: "ok", servers: ["iris-dev-mcp"] }]);
    expect(scopes.find((s) => s.scope === "user")?.file).toBe("missing");

    const doctor = await cli(fs, ["doctor", "--json"]);
    expect(doctor.exit).toBe(1);
    const findings = (JSON.parse(doctor.stdout) as { data: { findings: Array<{ check: string; path: string | null; scope: string; detail: string }> } }).data.findings.filter(
      (f) => f.check === "vscode-local-harness-entries",
    );
    expect(findings.map((f) => f.path).sort()).toEqual([OLD_PROJECT, OLD_USER].sort());
    for (const finding of findings) expect(finding.detail).toContain(`apply --client vscode --scope ${finding.scope} --servers iris-dev-mcp`);
    expect(fs.readFile(OLD_USER)).toBe(OLD_USER_TEXT);
    expect(fs.readFile(OLD_PROJECT)).toBe(OLD_PROJECT_TEXT);
  });

  it("an old .vscode/mcp.json alone (no Code app folder, no new file) still detects vscode, and status and doctor report it", async () => {
    const fs = new MemFs();
    fs.seed(OLD_PROJECT, OLD_PROJECT_TEXT);
    expect(fs.exists(`${HOME}/.config/Code`)).toBe(false);
    const detect = JSON.parse((await cli(fs, ["detect", "--json"])).stdout) as {
      data: { clients: Array<{ client: string; detected: boolean; probes: Array<{ path: string; exists: boolean; legacy?: boolean }> }> };
    };
    const row = detect.data.clients.find((c) => c.client === "vscode");
    expect(row?.detected).toBe(true);
    expect(row?.probes.filter((p) => p.exists)).toEqual([{ kind: "config", scope: "project", path: OLD_PROJECT, exists: true, legacy: true }]);

    const status = JSON.parse((await cli(fs, ["status", "--json"])).stdout) as {
      data: { clients: Array<{ client: string; scopes: Array<{ scope: string; legacy?: Array<{ path: string; servers: string[] }> }> }> };
    };
    const scopes = status.data.clients.find((c) => c.client === "vscode")?.scopes ?? [];
    expect(scopes.find((s) => s.scope === "project")?.legacy).toEqual([{ path: OLD_PROJECT, file: "ok", servers: ["iris-dev-mcp"] }]);

    const doctor = await cli(fs, ["doctor", "--json"]);
    expect(doctor.exit).toBe(1);
    const findings = (JSON.parse(doctor.stdout) as { data: { findings: Array<{ check: string; path: string | null }> } }).data.findings;
    expect(findings.filter((f) => f.check === "vscode-local-harness-entries").map((f) => f.path)).toEqual([OLD_PROJECT]);
    expect(fs.readFile(OLD_PROJECT)).toBe(OLD_PROJECT_TEXT);
  });

  it("apply --scope project writes .mcp.json, then removes the owned entry from .vscode/mcp.json; the user-scope old file is not touched", async () => {
    const fs = new MemFs();
    fs.seed(OLD_USER, OLD_USER_TEXT);
    fs.seed(OLD_PROJECT, OLD_PROJECT_TEXT);
    const run = await cli(fs, ["apply", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp", "--yes"]);
    expect(run.exit, run.stderr).toBe(0);
    expect(fs.readFile(PROJECT_FILE)).toContain("iris-dev-mcp");
    const after = fs.readFile(OLD_PROJECT);
    expect(after).not.toContain("iris-dev-mcp");
    expect(after).toContain(`    "keep-project": { "command": "y" }`);
    expect(after).toContain(`"inputs": []`);
    expect(fs.readFile(OLD_USER)).toBe(OLD_USER_TEXT);
    expect(run.stdout).toContain("removed iris-dev-mcp from the old location");
  });

  it("the preview shows the old-file removal, and a diff writes nothing", async () => {
    const fs = new MemFs();
    fs.seed(OLD_PROJECT, OLD_PROJECT_TEXT);
    const run = await cli(fs, ["diff", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp", "--json"]);
    expect(run.exit).toBe(0);
    const data = (
      JSON.parse(run.stdout) as {
        data: { servers: Array<{ server: string; text: string }>; legacy?: Array<{ path: string; names: string[]; text: string }> };
      }
    ).data;
    expect(data.legacy?.[0]).toMatchObject({ path: OLD_PROJECT, names: ["iris-dev-mcp"] });
    expect(data.legacy?.[0]?.text).toContain("iris-dev-mcp");
    // The MCP Clients view renders only servers[].text, so the old-file removal is there too.
    expect(data.servers[0]?.text).toContain(`--- old location ${OLD_PROJECT} (remove iris-dev-mcp) ---\n${data.legacy?.[0]?.text ?? "<none>"}`);
    const clean = await cli(new MemFs(), ["diff", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp", "--json"]);
    expect((JSON.parse(clean.stdout) as { data: { servers: Array<{ text: string }> } }).data.servers[0]?.text).not.toContain("old location");
    expect(fs.readFile(OLD_PROJECT)).toBe(OLD_PROJECT_TEXT);
    expect(fs.exists(PROJECT_FILE)).toBe(false);
  });

  it("an apply that would move an old-file entry still asks for confirmation: no --yes on a non-TTY exits 2 and edits nothing", async () => {
    const fs = new MemFs();
    fs.seed(OLD_PROJECT, OLD_PROJECT_TEXT);
    const run = await cli(fs, ["apply", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp"]);
    expect(run.exit).toBe(2);
    expect(run.stdout).toContain(`old location ${OLD_PROJECT}`);
    expect(fs.readFile(OLD_PROJECT)).toBe(OLD_PROJECT_TEXT);
    expect(fs.exists(PROJECT_FILE)).toBe(false);
  });

  it("a re-apply of an entry already in the new file that would also move an old-file entry asks for confirmation: no --yes on a non-TTY exits 2 and edits nothing", async () => {
    const fs = new MemFs();
    expect((await cli(fs, ["apply", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp", "--yes"])).exit).toBe(0);
    const written = fs.readFile(PROJECT_FILE);
    fs.seed(OLD_PROJECT, OLD_PROJECT_TEXT);
    const run = await cli(fs, ["apply", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp"]);
    expect(run.exit).toBe(2);
    expect(fs.readFile(OLD_PROJECT)).toBe(OLD_PROJECT_TEXT);
    expect(fs.readFile(PROJECT_FILE)).toBe(written);
  });

  for (const [owner, other] of [["claude-code", "vscode"], ["vscode", "claude-code"]] as const) {
    it(`a diff by ${other} of an entry ${owner} owns in the shared file exits 1, names ${owner} and the file, and writes nothing`, async () => {
      const fs = new MemFs();
      expect((await cli(fs, ["apply", "--client", owner, "--scope", "project", "--servers", "iris-dev-mcp", "--yes"])).exit).toBe(0);
      const shared = fs.readFile(PROJECT_FILE);
      const before = readState(fs, STATE_DIR, "linux");
      const run = await cli(fs, ["diff", "--client", other, "--scope", "project", "--servers", "iris-dev-mcp", "--json"]);
      expect(run.exit).toBe(1);
      expect((JSON.parse(run.stdout) as { ok: boolean }).ok).toBe(false);
      expect(run.stderr).toContain(`(${owner})`);
      expect(run.stderr).toContain(PROJECT_FILE);
      expect(fs.readFile(PROJECT_FILE)).toBe(shared);
      expect(readState(fs, STATE_DIR, "linux")).toEqual(before);
    });
  }

  it("a multi-server apply with one server owned by claude-code exits 1 before it writes any server", async () => {
    const fs = new MemFs();
    expect((await cli(fs, ["apply", "--client", "claude-code", "--scope", "project", "--servers", "iris-dev-mcp", "--yes"])).exit).toBe(0);
    const shared = fs.readFile(PROJECT_FILE);
    const before = readState(fs, STATE_DIR, "linux");
    const run = await cli(fs, ["apply", "--client", "vscode", "--scope", "project", "--servers", "iris-interop-mcp,iris-dev-mcp", "--yes"]);
    expect(run.exit).toBe(1);
    expect(run.stderr).toContain("claude-code");
    expect(fs.readFile(PROJECT_FILE)).toBe(shared);
    expect(readState(fs, STATE_DIR, "linux")).toEqual(before);
  });

  it("an apply refused because claude-code owns the entry exits 1 before any write: the old file keeps its entry, and no vscode record is made", async () => {
    const fs = new MemFs();
    expect((await cli(fs, ["apply", "--client", "claude-code", "--scope", "project", "--servers", "iris-dev-mcp", "--yes"])).exit).toBe(0);
    const shared = fs.readFile(PROJECT_FILE);
    fs.seed(OLD_PROJECT, OLD_PROJECT_TEXT);
    const run = await cli(fs, ["apply", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp", "--yes"]);
    expect(run.exit).toBe(1);
    expect(run.stderr).toContain("claude-code");
    expect(fs.readFile(PROJECT_FILE)).toBe(shared);
    expect(fs.readFile(OLD_PROJECT)).toBe(OLD_PROJECT_TEXT);
    const ledger = readState(fs, STATE_DIR, "linux");
    expect(ledger.ok && ledger.state.entries.map((e) => `${e.client}/${e.scope}/${e.name}`)).toEqual(["claude-code/project/iris-dev-mcp"]);
  });

  it("the new write fails: the old file is untouched and gets no backup (the old file is never edited before the new write re-parsed clean)", () => {
    class FailsOnNew extends MemFs {
      override writeFile(path: string, content: string): void {
        if (path === PROJECT_FILE) throw new Error("EIO: injected write failure");
        super.writeFile(path, content);
      }
    }
    const fs = new FailsOnNew();
    fs.seed(OLD_PROJECT, OLD_PROJECT_TEXT);
    const result = apply(ctx(), "vscode", "project", entryFor("iris-dev-mcp", "env-reference"), { fs });
    expect(result.ok).toBe(false);
    expect(result.legacy).toBeUndefined();
    expect(fs.readFile(OLD_PROJECT)).toBe(OLD_PROJECT_TEXT);
    expect([...fs.files.keys()].filter((p) => p.includes("vscode-legacy"))).toEqual([]);
  });

  it("the old-file edit fails after the new write: the old file is restored from its backup, the new entry is kept, and the result says the entry is still in the old file", async () => {
    const fs = new MemFs();
    fs.seed(OLD_PROJECT, OLD_PROJECT_TEXT);
    let executions = 0;
    const result = apply(ctx(), "vscode", "project", entryFor("iris-dev-mcp", "env-reference"), {
      fs,
      // The first edit is the new file's; the second is the old file's, and it yields bytes that do not parse.
      executeFn: (content, native) => (++executions === 1 ? executeNativeEdit(content, native) : "{ not json"),
    });
    expect(result.ok).toBe(true);
    expect(fs.readFile(PROJECT_FILE)).toContain("iris-dev-mcp");
    expect(fs.readFile(OLD_PROJECT)).toBe(OLD_PROJECT_TEXT);
    expect(result.legacy?.[0]).toMatchObject({ path: OLD_PROJECT, ok: false, changed: false, removed: [], restored: true });
    expect(result.legacy?.[0]?.reason).toContain("still in the old file");
    expect(result.warnings?.join(" ")).toContain("still in the old file");
    expect(result.legacy?.[0]?.backupPath).toContain("/backups/vscode-legacy/project/");

    // Through the CLI the same failure is exit 1 with the entry reported as still in the old file.
    class FailsOnOld extends MemFs {
      override writeFile(path: string, content: string): void {
        if (path === OLD_PROJECT) throw new Error("EACCES: injected write failure");
        super.writeFile(path, content);
      }
    }
    const blocked = new FailsOnOld();
    blocked.seed(OLD_PROJECT, OLD_PROJECT_TEXT);
    const run = await cli(blocked, ["apply", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp", "--yes"]);
    expect(run.exit).toBe(1);
    expect(run.stderr).toContain("the new entry was written");
    expect(run.stderr).toContain("still in the old file");
    expect(blocked.readFile(PROJECT_FILE)).toContain("iris-dev-mcp");
    expect(blocked.readFile(OLD_PROJECT)).toBe(OLD_PROJECT_TEXT);
  });

  it("an unparseable old file is reported, never edited, and does not block the new write", () => {
    const fs = new MemFs();
    const broken = '{ "servers": { "iris-dev-mcp": ';
    fs.seed(OLD_PROJECT, broken);
    const result = apply(ctx(), "vscode", "project", entryFor("iris-dev-mcp", "env-reference"), { fs });
    expect(result.ok).toBe(true);
    expect(result.legacy?.[0]).toMatchObject({ path: OLD_PROJECT, ok: false });
    expect(fs.readFile(OLD_PROJECT)).toBe(broken);
  });

  it("remove --client vscode also removes the owned old-file entry", async () => {
    const fs = new MemFs();
    fs.seed(OLD_PROJECT, OLD_PROJECT_TEXT);
    expect(apply(ctx(), "vscode", "project", entryFor("iris-dev-mcp", "env-reference"), { fs, executeFn: executeNativeEdit }).ok).toBe(true);
    // Put the old entry back (as if it was written by an older manager), then remove.
    fs.files.set(OLD_PROJECT, OLD_PROJECT_TEXT);
    const result = remove(ctx(), "vscode", "project", "iris-dev-mcp", { fs });
    expect(result.ok).toBe(true);
    expect(result.legacy?.[0]).toMatchObject({ path: OLD_PROJECT, ok: true, changed: true, removed: ["iris-dev-mcp"] });
    expect(fs.readFile(OLD_PROJECT)).not.toContain("iris-dev-mcp");
    expect(fs.readFile(PROJECT_FILE)).not.toContain("iris-dev-mcp");
  });

  it("remove --client vscode whose old-file sweep fails exits 1, names the old file and keeps its bytes", async () => {
    const fs = new MemFs();
    expect((await cli(fs, ["apply", "--client", "vscode", "--scope", "project", "--servers", "iris-dev-mcp", "--yes"])).exit).toBe(0);
    const broken = '{ "servers": { "iris-dev-mcp": ';
    fs.seed(OLD_PROJECT, broken);
    const run = await cli(fs, ["remove", "--client", "vscode", "--scope", "project", "--server", "iris-dev-mcp", "--json"]);
    expect(run.exit).toBe(1);
    const envelope = JSON.parse(run.stdout) as { ok: boolean; error?: string };
    expect(envelope.ok).toBe(false);
    expect(envelope.error).toContain(OLD_PROJECT);
    expect(fs.readFile(OLD_PROJECT)).toBe(broken);
    expect(JSON.parse(fs.readFile(PROJECT_FILE))).toEqual({ mcpServers: {} });
  });

  it("only canonical names are swept from an old file: a foreign entry under a name the engine API applies stays byte for byte", () => {
    const fs = new MemFs();
    const oldText = `{\n  "servers": {\n    "my-tool": { "command": "mine" }\n  }\n}\n`;
    fs.seed(OLD_PROJECT, oldText);
    // The type admits only canonical names; the engine still guards other names at run time.
    const custom = { ...entryFor("iris-dev-mcp", "env-reference"), name: "my-tool" } as unknown as CanonicalEntry;
    const applied = apply(ctx(), "vscode", "project", custom, { fs });
    expect(applied.ok, applied.reason ?? "").toBe(true);
    expect(applied).not.toHaveProperty("legacy");
    expect(fs.readFile(OLD_PROJECT)).toBe(oldText);
    const removed = remove(ctx(), "vscode", "project", "my-tool", { fs });
    expect(removed.ok, removed.reason ?? "").toBe(true);
    expect(fs.readFile(OLD_PROJECT)).toBe(oldText);
  });

  it("an adapter with no legacy files (claude-code) gets no `legacy` field on apply or remove", () => {
    const fs = new MemFs();
    const claude = CLIENT_ADAPTERS["claude-code"];
    if (claude === undefined) throw new Error("registry");
    const entry = synthesizeEntry("iris-dev-mcp", "env-reference", { adapter: claude });
    if (!entry.ok) throw new Error(entry.reason);
    fs.seed(OLD_PROJECT, OLD_PROJECT_TEXT);
    expect(apply(ctx(), "claude-code", "project", entry.entry, { fs })).not.toHaveProperty("legacy");
    expect(remove(ctx(), "claude-code", "project", "iris-dev-mcp", { fs })).not.toHaveProperty("legacy");
    expect(fs.readFile(OLD_PROJECT)).toBe(OLD_PROJECT_TEXT);
  });
});

describe("AC 44.2.4: a stash recorded before the move", () => {
  const stashState = (entry: Record<string, unknown>): string =>
    JSON.stringify({
      version: 1,
      entries: [],
      stashes: [{ client: "vscode", scope: "user", name: "iris-dev-mcp", entry, disabledAt: "2026-11-01T00:00:00.000Z" }],
    });

  it("enable refuses a stash that holds ${env:} or ${input:}, naming the entry and apply; the stash is kept; doctor reports it", async () => {
    for (const reference of ["${env:IRIS_HOST}", "${input:iris-password}"]) {
      const fs = new MemFs();
      fs.seed(`${STATE_DIR}/state.json`, stashState({ command: "npx", env: { IRIS_HOST: reference } }));
      fs.seed(USER_FILE, '{"mcpServers":{}}\n');
      const run = await cli(fs, ["enable", "--client", "vscode", "--scope", "user", "--server", "iris-dev-mcp", "--json"]);
      expect(run.exit, reference).toBe(1);
      expect((JSON.parse(run.stdout) as { error: string }).error).toContain("iris-dev-mcp");
      expect(run.stderr).toContain("apply --client vscode --scope user --servers iris-dev-mcp");
      expect(fs.readFile(USER_FILE)).toBe('{"mcpServers":{}}\n');
      const kept = readState(fs, STATE_DIR, "linux");
      expect(kept.ok && kept.state.stashes).toHaveLength(1);

      const doctor = await cli(fs, ["doctor", "--json"]);
      const findings = (JSON.parse(doctor.stdout) as { data: { findings: Array<{ check: string; entry?: string }> } }).data.findings;
      expect(findings.filter((f) => f.check === "vscode-local-harness-entries" && f.entry === "iris-dev-mcp")).toHaveLength(1);
    }
  });

  it("a user stash in the old {command, args, env} shape is refused even with no references; the stash is kept; apply drops it", async () => {
    const fs = new MemFs();
    fs.seed(`${STATE_DIR}/state.json`, stashState({ command: "npx", args: ["-y", "@iris-mcp/dev@1"], env: { IRIS_HOST: "literal.example.com" } }));
    fs.seed(USER_FILE, '{"mcpServers":{}}\n');
    const result = enable(ctx(), "vscode", "user", "iris-dev-mcp", { fs });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("type and tools keys");
    expect(result.reason).toContain("apply --client vscode --scope user --servers iris-dev-mcp");
    expect(fs.readFile(USER_FILE)).toBe('{"mcpServers":{}}\n');
    const kept = readState(fs, STATE_DIR, "linux");
    expect(kept.ok && kept.state.stashes).toHaveLength(1);

    const doctor = await cli(fs, ["doctor", "--json"]);
    const findings = (JSON.parse(doctor.stdout) as { data: { findings: Array<{ check: string; entry?: string }> } }).data.findings;
    expect(findings.filter((f) => f.check === "vscode-local-harness-entries" && f.entry === "iris-dev-mcp")).toHaveLength(1);

    expect(apply(ctx(), "vscode", "user", entryFor("iris-dev-mcp", "env-reference"), { fs }).ok).toBe(true);
    const after = readState(fs, STATE_DIR, "linux");
    expect(after.ok && after.state.stashes).toHaveLength(0);
  });

  it("a user stash in the Copilot shape, and a project stash in the standard shape, enable as before", () => {
    const copilotEntry = { type: "stdio", command: "npx", args: ["-y", "@iris-mcp/dev@1"], env: { IRIS_HOST: "literal.example.com" }, tools: ["*"] };
    const fs = new MemFs();
    fs.seed(`${STATE_DIR}/state.json`, stashState(copilotEntry));
    fs.seed(USER_FILE, '{"mcpServers":{}}\n');
    const result = enable(ctx(), "vscode", "user", "iris-dev-mcp", { fs });
    expect(result.ok, result.reason ?? "").toBe(true);
    expect(JSON.parse(fs.readFile(USER_FILE))).toEqual({ mcpServers: { "iris-dev-mcp": copilotEntry } });

    const projectFs = new MemFs();
    const standardEntry = { command: "npx", args: ["-y", "@iris-mcp/dev@1"], env: { IRIS_HOST: "literal.example.com" } };
    projectFs.seed(
      `${STATE_DIR}/state.json`,
      JSON.stringify({
        version: 1,
        entries: [],
        stashes: [{ client: "vscode", scope: "project", name: "iris-dev-mcp", entry: standardEntry, disabledAt: "2026-11-01T00:00:00.000Z" }],
      }),
    );
    projectFs.seed(PROJECT_FILE, '{"mcpServers":{}}\n');
    const projectResult = enable(ctx(), "vscode", "project", "iris-dev-mcp", { fs: projectFs });
    expect(projectResult.ok, projectResult.reason ?? "").toBe(true);
    expect(JSON.parse(projectFs.readFile(PROJECT_FILE))).toEqual({ mcpServers: { "iris-dev-mcp": standardEntry } });
  });

  it("another client's stash that holds ${env:...} still enables: only the vscode adapter refuses legacy references", () => {
    const fs = new MemFs();
    const claudeFile = resolveScopePath(CLIENT_ADAPTERS["claude-code"] as ClientAdapter, "user", ctx());
    if (claudeFile === null) throw new Error("claude-code user path");
    fs.seed(
      `${STATE_DIR}/state.json`,
      JSON.stringify({
        version: 1,
        entries: [],
        stashes: [
          {
            client: "claude-code",
            scope: "user",
            name: "iris-dev-mcp",
            entry: { command: "npx", env: { IRIS_HOST: "${env:IRIS_HOST}" } },
            disabledAt: "2026-11-01T00:00:00.000Z",
          },
        ],
      }),
    );
    fs.seed(claudeFile, '{"mcpServers":{}}\n');
    const result = enable(ctx(), "claude-code", "user", "iris-dev-mcp", { fs });
    expect(result.ok, result.reason ?? "").toBe(true);
    expect(fs.readFile(claudeFile)).toContain("${env:IRIS_HOST}");
  });

  it("enable refuses the stash even when the new file does not exist yet (the state a pre-move install is in)", () => {
    const fs = new MemFs();
    fs.seed(`${STATE_DIR}/state.json`, stashState({ command: "npx", env: { IRIS_HOST: "${env:IRIS_HOST}" } }));
    const result = enable(ctx(), "vscode", "user", "iris-dev-mcp", { fs });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("apply --client vscode --scope user --servers iris-dev-mcp");
    expect(fs.files.has(USER_FILE)).toBe(false);
  });

  it("the apply that the refusal advises drops the legacy stash, so enable and doctor stop reporting it", async () => {
    const fs = new MemFs();
    fs.seed(`${STATE_DIR}/state.json`, stashState({ command: "npx", env: { IRIS_HOST: "${env:IRIS_HOST}" } }));
    const run = await cli(fs, ["apply", "--client", "vscode", "--scope", "user", "--servers", "iris-dev-mcp", "--yes", "--json"]);
    expect(run.exit).toBe(0);
    const after = readState(fs, STATE_DIR, "linux");
    expect(after.ok && after.state.stashes).toEqual([]);
    const doctor = await cli(fs, ["doctor", "--json"]);
    const findings = (JSON.parse(doctor.stdout) as { data: { findings: Array<{ check: string; entry?: string }> } }).data.findings;
    expect(findings.filter((f) => f.check === "vscode-local-harness-entries")).toEqual([]);
  });
});

describe("one consumer: the CLI help text names ${VAR} and never ${env:VAR}", () => {
  it("--help", async () => {
    const run = await cli(new MemFs(), ["--help"], { stdin: Object.assign(Readable.from([]), { isTTY: false }) });
    expect(run.stdout).toContain("${VAR} references");
    expect(run.stdout).not.toContain("${env:VAR}");
    expect(run.stdout).not.toContain("native inputs");
  });
});
