/**
 * Story 33.5 — QA E2E/edge layer (PROCESS level), on top of the dev pins.
 *
 * Drives the BUILT bin (`dist/cli/clients-cli.js`) as a real child process
 * against a real-filesystem sandbox HOME (the clients-cli-process.test.ts
 * harness discipline, Rule #54: the sandbox models REAL Node behavior —
 * os.homedir() resolves HOME/USERPROFILE from the child env, %APPDATA%
 * templates expand from APPDATA). The child env is built from scratch so no
 * IRIS_* variable from the developer shell leaks in.
 *
 * Coverage (the stage brief):
 * - The lead's two ORIGINAL reproductions (Dev Notes P1/P2), independently
 *   re-run against the built dist and pinned dead: P1 = TOML parse error
 *   echoing `api_key = "SECRETVALUE123"` through readConfigEntries → status /
 *   doctor / --json surfaces; P2 = a Cline apply wiping `disabled: true`,
 *   `autoApprove`, `timeout` and env extras on update.
 * - Parse-error sanitization ADVERSARIAL SWEEP: secret markers in exotic
 *   positions (CRLF files, tab-indented lines, unicode secrets, secrets in a
 *   trailing comment on the offending line, secrets on a distant line,
 *   multi-error files) across the TOML/YAML/JSONC families — asserted absent
 *   from FIVE built surfaces each (status text, status --json, doctor text,
 *   doctor --json, the apply refusal).
 * - apply-update preservation across EVERY native-flag client (cline, roo-code,
 *   goose, codex) with diverse unmanaged keys: nested objects, arrays, comments
 *   INSIDE owned entries, env extras — and the TOML datetime documented refusal.
 * - TOML multiline region lifecycle: nested `"""` strings with header-looking
 *   lines, multi-line nested arrays and quoted keys through apply → disable →
 *   enable → remove with zero orphaned lines.
 * - The comment-only JSONC lifecycle (the QA-stage product fix): a comment-only
 *   file is a valid empty document that apply can write into, preserving the
 *   user's trivia.
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { parseDocument } from "yaml";
import { describe, expect, it, afterEach } from "vitest";

// ════════════════════════════════════════════════════════════════════
// Harness (mirrors clients-cli-process.test.ts, extended to the four
// native-flag clients this story's sweeps target).
// ════════════════════════════════════════════════════════════════════

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "dist", "cli", "clients-cli.js");

const T = 120_000;

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

type SandboxClient = "claude-code" | "codex" | "goose" | "vscode" | "cline" | "roo-code";

interface Sandbox {
  home: string;
  project: string;
  run: (args: string[], opts?: { input?: string; env?: Record<string, string> }) => RunResult;
  configPath: (client: SandboxClient) => string;
  /** Write a config file (creating parent dirs) at the client's real user-scope path. */
  seed: (client: SandboxClient, content: string) => string;
}

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop() as string;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeSandbox(): Sandbox {
  const home = mkdtempSync(path.join(tmpdir(), "qa335-home-"));
  const project = mkdtempSync(path.join(tmpdir(), "qa335-proj-"));
  createdDirs.push(home, project);

  const run: Sandbox["run"] = (args, opts = {}) => {
    const result = spawnSync(process.execPath, [BIN, ...args], {
      cwd: project,
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

  const vscodeUserRoot =
    process.platform === "win32"
      ? path.join(home, "AppData", "Roaming", "Code", "User")
      : process.platform === "darwin"
        ? path.join(home, "Library", "Application Support", "Code", "User")
        : path.join(home, ".config", "Code", "User");

  const configPath: Sandbox["configPath"] = (client) => {
    switch (client) {
      case "claude-code":
        return path.join(home, ".claude.json");
      case "codex":
        return path.join(home, ".codex", "config.toml");
      case "goose":
        return process.platform === "win32"
          ? path.join(home, "AppData", "Roaming", "goose", "config.yaml")
          : path.join(home, ".config", "goose", "config.yaml");
      case "vscode":
        return path.join(vscodeUserRoot, "mcp.json");
      case "cline":
        return path.join(vscodeUserRoot, "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
      case "roo-code":
        return path.join(vscodeUserRoot, "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json");
    }
  };

  const seed: Sandbox["seed"] = (client, content) => {
    const target = configPath(client);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    return target;
  };

  return { home, project, run, configPath, seed };
}

/** Parse a --json envelope, failing the test with the raw output otherwise. */
function parseEnvelope(result: RunResult): { ok: boolean; command: string; data: unknown; error?: string } {
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

// ════════════════════════════════════════════════════════════════════
// 1. The lead's ORIGINAL reproductions, independently re-run (dead pins).
// ════════════════════════════════════════════════════════════════════

describe("QA 33.5: the lead's original reproductions are dead (Dev Notes P1/P2, built bin)", () => {
  it("P1: the TOML parse error echoes NO source content on any of the five surfaces", () => {
    const sandbox = makeSandbox();
    // The exact lead-probed shape: the secret sits on the line ABOVE the
    // offending one (smol-toml's codeblock prints both lines).
    const target = sandbox.seed("codex", '[mcp_servers.my-server]\napi_key = "SECRETVALUE123"\nbad = = =\n');
    const original = readFileSync(target, "utf8");

    const statusText = sandbox.run(["status"]);
    expect(statusText.status).toBe(0);
    expect(statusText.stdout).toContain("UNPARSEABLE");
    expect(statusText.stdout).toMatch(/line 3/); // reason + line:col survive…
    expect(statusText.stdout + statusText.stderr).not.toContain("SECRETVALUE123"); // …content never does
    expect(statusText.stdout + statusText.stderr).not.toContain("api_key");

    const statusJson = sandbox.run(["status", "--json"]);
    expect(statusJson.status).toBe(0);
    parseEnvelope(statusJson);
    expect(statusJson.stdout).not.toContain("SECRETVALUE123");
    expect(statusJson.stdout).not.toContain("api_key");

    const doctorText = sandbox.run(["doctor"]);
    expect(doctorText.status).toBe(1);
    expect(doctorText.stdout).toContain("parseability");
    expect(doctorText.stdout + doctorText.stderr).not.toContain("SECRETVALUE123");
    expect(doctorText.stdout + doctorText.stderr).not.toContain("api_key");

    const doctorJson = sandbox.run(["doctor", "--json"]);
    expect(doctorJson.status).toBe(1);
    parseEnvelope(doctorJson);
    expect(doctorJson.stdout).not.toContain("SECRETVALUE123");
    expect(doctorJson.stdout).not.toContain("api_key");

    const applied = sandbox.run(["apply", "--client", "codex", "--servers", "iris-dev-mcp", "--yes"]);
    expect(applied.status).toBe(1);
    expect(applied.stdout + applied.stderr).not.toContain("SECRETVALUE123");
    expect(applied.stdout + applied.stderr).not.toContain("api_key");
    expect(readFileSync(target, "utf8")).toBe(original); // the refusal writes nothing
  }, T);

  it("P2: a Cline apply PRESERVES disabled:true, autoApprove, timeout and env extras on update", () => {
    const sandbox = makeSandbox();
    const target = sandbox.seed(
      "cline",
      JSON.stringify(
        {
          mcpServers: {
            "iris-dev-mcp": {
              command: "old",
              args: ["--old"],
              disabled: true,
              autoApprove: ["iris_server_info"],
              timeout: 45,
              env: { IRIS_PASSWORD: "old-secret", USER_EXTRA: "keep-me" },
            },
          },
        },
        null,
        2,
      ),
    );

    const applied = sandbox.run(["apply", "--client", "cline", "--servers", "iris-dev-mcp", "--yes"]);
    expect(applied.status).toBe(0);
    // The confirm text states the preservation contract (AC 33.5.2).
    expect(applied.stdout).toContain("preserved");

    const after = JSON.parse(readFileSync(target, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    const entry = after.mcpServers["iris-dev-mcp"] as Record<string, unknown>;
    expect(entry.command).toBe("npx"); // manager-owned overwritten
    expect(entry.args).toEqual(["-y", "@iris-mcp/dev"]);
    expect(entry.disabled).toBe(true); // enablement NEVER changes on apply
    expect(entry.autoApprove).toEqual(["iris_server_info"]);
    expect(entry.timeout).toBe(45);
    expect((entry.env as Record<string, unknown>).USER_EXTRA).toBe("keep-me");

    // The matrix reads the preserved enablement: still present-disabled.
    const statusJson = sandbox.run(["status", "--json"]);
    expect(statusJson.status).toBe(0);
    expect(statusRowState(parseEnvelope(statusJson), "cline", "iris-dev-mcp")).toBe("present-disabled");
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 2. Parse-error sanitization adversarial sweep — exotic marker positions.
// ════════════════════════════════════════════════════════════════════

interface LeakCase {
  name: string;
  client: SandboxClient;
  applyClient: string;
  content: string;
  /** Markers that must appear NOWHERE on any surface (secrets + key names). */
  markers: string[];
}

const LEAK_CASES: LeakCase[] = [
  {
    name: "TOML CRLF file, secret on the line above the offending one",
    client: "codex",
    applyClient: "codex",
    content: '[mcp_servers.my-server]\r\napi_key = "tok_CRLFSECRET_aaa"\r\nbad = = =\r\n',
    markers: ["tok_CRLFSECRET_aaa", "api_key"],
  },
  {
    name: "TOML tab-indented secret line above the offending one",
    client: "codex",
    applyClient: "codex",
    content: '[mcp_servers.my-server]\n\tapi_key = "tok_TABSECRET_bbb"\n\tbad = = =\n',
    markers: ["tok_TABSECRET_bbb", "api_key"],
  },
  {
    name: "TOML unicode secret ON the offending line (unterminated string)",
    client: "codex",
    applyClient: "codex",
    content: '[mcp_servers]\nbad = "sëcret-秘密-🔑-UNI\n',
    markers: ["sëcret-秘密-🔑-UNI"],
  },
  {
    name: "TOML secret inside a trailing comment on the offending line",
    client: "codex",
    applyClient: "codex",
    content: "[mcp_servers.my-server]\nbad = = = # tok_COMMENTSECRET_ddd\n",
    markers: ["tok_COMMENTSECRET_ddd"],
  },
  {
    name: "TOML multi-error file: secrets on TWO bad lines (only the first error is reported)",
    client: "codex",
    applyClient: "codex",
    content: '[mcp_servers.my-server]\nbad1 = "tok_FIRSTSECRET_eee\nbad2 = "tok_SECONDSECRET_fff\n',
    markers: ["tok_FIRSTSECRET_eee", "tok_SECONDSECRET_fff"],
  },
  {
    name: "TOML secret three lines above the offending one (outside the codeblock window)",
    client: "codex",
    applyClient: "codex",
    content: '[mcp_servers.my-server]\napi_key = "tok_DISTANTSECRET_ggg"\nx = 1\ny = 2\nbad = = =\n',
    markers: ["tok_DISTANTSECRET_ggg", "api_key"],
  },
  {
    name: "YAML unicode secret on the line above the offending one",
    client: "goose",
    applyClient: "goose",
    content: 'extensions:\n  my-server:\n    api_key: "sëcret-秘密-🔑-YUNI"\n  bad: [ unclosed\n',
    markers: ["sëcret-秘密-🔑-YUNI", "api_key", "unclosed"],
  },
  {
    name: "YAML secret ON the offending line (unclosed flow sequence)",
    client: "goose",
    applyClient: "goose",
    content: 'extensions:\n  bad: [ "tok_YAMLOFFENDING_hhh"\n',
    markers: ["tok_YAMLOFFENDING_hhh"],
  },
  {
    name: "YAML tab-indented secret line (tabs are illegal indentation)",
    client: "goose",
    applyClient: "goose",
    content: "extensions:\n\tapi_key: tok_YAMLTAB_iii\n",
    markers: ["tok_YAMLTAB_iii", "api_key"],
  },
  {
    name: "YAML multi-error file: a second secret past the first reported error",
    client: "goose",
    applyClient: "goose",
    content: 'extensions:\n  a: "tok_YAMLFIRST_jjj"\n  b: [ unclosed\n- stray: "tok_YAMLSECOND_kkk"\n',
    markers: ["tok_YAMLFIRST_jjj", "tok_YAMLSECOND_kkk"],
  },
  {
    name: "JSONC CRLF file, secret on the line above the offending token",
    client: "claude-code",
    applyClient: "claude-code",
    content: '{"mcpServers": {\r\n  "a": "tok_JSONCSECRET_lll"\r\n} bad}\r\n',
    markers: ["tok_JSONCSECRET_lll"],
  },
];

describe("QA 33.5: parse-error sanitization adversarial sweep (built bin, five surfaces per case)", () => {
  for (const leakCase of LEAK_CASES) {
    it(
      `${leakCase.name}: no marker leaks; the error still carries line info`,
      () => {
        const sandbox = makeSandbox();
        const target = sandbox.seed(leakCase.client, leakCase.content);
        const original = readFileSync(target, "utf8");

        const assertClean = (label: string, result: RunResult): void => {
          for (const marker of leakCase.markers) {
            expect(result.stdout + result.stderr, `${label} must not echo ${marker}`).not.toContain(marker);
          }
        };

        const statusText = sandbox.run(["status"]);
        expect(statusText.status, "status exit").toBe(0);
        expect(statusText.stdout).toContain("UNPARSEABLE");
        expect(statusText.stdout, "reason keeps line:col").toMatch(/line \d+/);
        assertClean("status text", statusText);

        const statusJson = sandbox.run(["status", "--json"]);
        expect(statusJson.status).toBe(0);
        parseEnvelope(statusJson); // stays ONE parseable envelope
        assertClean("status --json", statusJson);

        const doctorText = sandbox.run(["doctor"]);
        expect(doctorText.status).toBe(1);
        assertClean("doctor text", doctorText);

        const doctorJson = sandbox.run(["doctor", "--json"]);
        expect(doctorJson.status).toBe(1);
        parseEnvelope(doctorJson);
        assertClean("doctor --json", doctorJson);

        const applied = sandbox.run(["apply", "--client", leakCase.applyClient, "--servers", "iris-dev-mcp", "--yes"]);
        expect(applied.status).toBe(1);
        assertClean("apply refusal", applied);
        expect(readFileSync(target, "utf8"), "the refusal writes nothing").toBe(original);
      },
      T,
    );
  }
});

// ════════════════════════════════════════════════════════════════════
// 3. apply-update preservation sweeps across every native-flag client.
// ════════════════════════════════════════════════════════════════════

describe("QA 33.5: apply-update preservation sweeps (built bin)", () => {
  it("roo-code: disabled:false, nested objects, arrays and env extras survive; the confirm text states preservation", () => {
    const sandbox = makeSandbox();
    const target = sandbox.seed(
      "roo-code",
      JSON.stringify(
        {
          mcpServers: {
            "iris-dev-mcp": {
              command: "old",
              args: ["--old"],
              disabled: false,
              autoApprove: ["iris_server_info", "iris_database_list"],
              custom: { nested: { deep: [1, 2, 3] } },
              watchOptions: { interval: 500 },
              env: { IRIS_PASSWORD: "old-secret", USER_EXTRA: "keep-me" },
            },
          },
        },
        null,
        2,
      ),
    );

    const applied = sandbox.run(["apply", "--client", "roo-code", "--servers", "iris-dev-mcp", "--yes"]);
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain("preserved");

    const after = JSON.parse(readFileSync(target, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    const entry = after.mcpServers["iris-dev-mcp"] as Record<string, unknown>;
    expect(entry.command).toBe("npx");
    expect(entry.disabled).toBe(false); // enablement untouched in EITHER direction
    expect(entry.autoApprove).toEqual(["iris_server_info", "iris_database_list"]);
    expect(entry.custom).toEqual({ nested: { deep: [1, 2, 3] } });
    expect(entry.watchOptions).toEqual({ interval: 500 });
    expect((entry.env as Record<string, unknown>).USER_EXTRA).toBe("keep-me");
  }, T);

  it("roo-code: an update NEVER stamps the native flag onto an entry that lacks one", () => {
    const sandbox = makeSandbox();
    const target = sandbox.seed(
      "roo-code",
      JSON.stringify({ mcpServers: { "iris-dev-mcp": { command: "old", args: [], timeout: 30 } } }, null, 2),
    );
    const applied = sandbox.run(["apply", "--client", "roo-code", "--servers", "iris-dev-mcp", "--yes"]);
    expect(applied.status).toBe(0);
    const after = JSON.parse(readFileSync(target, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    const entry = after.mcpServers["iris-dev-mcp"] as Record<string, unknown>;
    expect("disabled" in entry).toBe(false);
    expect(entry.timeout).toBe(30);
  }, T);

  it("goose: enabled:false, an interior comment, timeout and envs extras survive (comments INSIDE owned entries)", () => {
    const sandbox = makeSandbox();
    const target = sandbox.seed(
      "goose",
      [
        "extensions:",
        "  iris-dev-mcp:",
        "    type: stdio",
        "    cmd: old-cmd",
        "    # keep this interior comment",
        "    args:",
        "      - --old",
        "    enabled: false",
        "    timeout: 90",
        "    envs:",
        "      IRIS_PASSWORD: old",
        "      USER_EXTRA: keep-me",
        "  developer: # foreign entry — untouched",
        "    type: builtin",
        "",
      ].join("\n"),
    );

    const applied = sandbox.run(["apply", "--client", "goose", "--servers", "iris-dev-mcp", "--yes"]);
    expect(applied.status).toBe(0);
    expect(applied.stdout).toContain("preserved");

    const text = readFileSync(target, "utf8");
    expect(text).toContain("# keep this interior comment");
    expect(text).toContain("developer:"); // foreign entry intact

    const doc = parseDocument(text);
    expect(doc.errors).toHaveLength(0); // the result is valid YAML
    const parsed = doc.toJS() as { extensions: Record<string, Record<string, unknown>> };
    const entry = parsed.extensions["iris-dev-mcp"] as Record<string, unknown>;
    expect(entry.cmd).toBe("npx");
    expect(entry.enabled).toBe(false); // enablement preserved
    expect(entry.timeout).toBe(90);
    const envs = entry.envs as Record<string, unknown>;
    expect(envs.USER_EXTRA).toBe("keep-me");
    expect(envs.IRIS_PASSWORD).toBe("${IRIS_PASSWORD}"); // canonical env wins key-wise
  }, T);

  it("cline: a comment INSIDE the owned entry survives the per-key update (the whole-value replace dropped it)", () => {
    const sandbox = makeSandbox();
    const target = sandbox.seed(
      "cline",
      [
        "{",
        '  "mcpServers": {',
        '    "iris-dev-mcp": {',
        '      "command": "old",',
        "      // keep this interior comment",
        '      "args": ["--old"],',
        '      "disabled": true,',
        '      "timeout": 45',
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
    );

    const applied = sandbox.run(["apply", "--client", "cline", "--servers", "iris-dev-mcp", "--yes"]);
    expect(applied.status).toBe(0);

    const text = readFileSync(target, "utf8");
    expect(text).toContain("// keep this interior comment");
    const parsed = parseJsonc(text) as { mcpServers: Record<string, Record<string, unknown>> };
    const entry = parsed.mcpServers["iris-dev-mcp"] as Record<string, unknown>;
    expect(entry.command).toBe("npx");
    expect(entry.disabled).toBe(true);
    expect(entry.timeout).toBe(45);
  }, T);

  it("codex: a TOML datetime env value is a documented REFUSAL — exit 1, byte-identical file, reason names the form", () => {
    const sandbox = makeSandbox();
    const seed = [
      "[mcp_servers.iris-dev-mcp]",
      'command = "old"',
      "",
      "[mcp_servers.iris-dev-mcp.env]",
      "CREATED = 2026-01-01T00:00:00Z",
      "",
    ].join("\n");
    const target = sandbox.seed("codex", seed);

    const applied = sandbox.run(["apply", "--client", "codex", "--servers", "iris-dev-mcp", "--yes"]);
    expect(applied.status).toBe(1);
    expect(applied.stderr).toContain("datetime");
    expect(applied.stderr).toContain("refusing");
    expect(readFileSync(target, "utf8")).toBe(seed);
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 4. TOML multiline region lifecycle: nested """ strings, multi-line
//    arrays, quoted keys — apply → disable → enable → remove, no orphans.
// ════════════════════════════════════════════════════════════════════

describe("QA 33.5: TOML multiline region lifecycle (built bin)", () => {
  const MULTILINE_SEED = [
    "[mcp_servers.iris-dev-mcp]",
    'command = "old-cmd"',
    "# tuned for the slow VPN",
    'notes = """',
    "[mcp_servers.notreal]",
    "still string",
    '"""',
    "matrix = [",
    '  ["a"],',
    '  ["b"]',
    "]",
    '"weird key" = "preserved"',
    "",
    "[mcp_servers.iris-dev-mcp.env]",
    'USER_EXTRA = "keep-me"',
    "",
    "[mcp_servers.context7]",
    'command = "npx"',
    "",
  ].join("\n");

  it("apply (update) preserves every multiline form; disable/enable flip only the owned flag; remove leaves zero orphans", () => {
    const sandbox = makeSandbox();
    const target = sandbox.seed("codex", MULTILINE_SEED);

    // apply-update: multiline forms, comments, quoted keys, the env sub-table
    // extra and the foreign table all survive; only manager-owned lines change.
    const applied = sandbox.run(["apply", "--client", "codex", "--servers", "iris-dev-mcp", "--yes"]);
    expect(applied.status).toBe(0);
    let text = readFileSync(target, "utf8");
    expect(text).toContain('command = "npx"');
    expect(text).toContain('notes = """\n[mcp_servers.notreal]\nstill string\n"""');
    expect(text).toContain('matrix = [\n  ["a"],\n  ["b"]\n]');
    expect(text).toContain('"weird key" = "preserved"');
    expect(text).toContain("# tuned for the slow VPN");
    expect(text).toContain('USER_EXTRA = "keep-me"');
    expect(text).toContain("[mcp_servers.context7]");
    expect(() => parseToml(text)).not.toThrow();

    // disable: the flag lands in the OWNED table only (region math is
    // multiline-aware — the header-looking line inside the """ string and the
    // nested array brackets must not truncate the scan).
    const disabled = sandbox.run(["disable", "--client", "codex", "--server", "iris-dev-mcp"]);
    expect(disabled.status).toBe(0);
    text = readFileSync(target, "utf8");
    const parsedOff = parseToml(text) as {
      mcp_servers: Record<string, Record<string, unknown>>;
    };
    expect(parsedOff.mcp_servers["iris-dev-mcp"]?.enabled).toBe(false);
    expect(parsedOff.mcp_servers["context7"]?.enabled).toBeUndefined();
    expect(text).toContain('notes = """\n[mcp_servers.notreal]\nstill string\n"""');

    // enable: back to enabled = true.
    const enabled = sandbox.run(["enable", "--client", "codex", "--server", "iris-dev-mcp"]);
    expect(enabled.status).toBe(0);
    text = readFileSync(target, "utf8");
    const parsedOn = parseToml(text) as {
      mcp_servers: Record<string, Record<string, unknown>>;
    };
    expect(parsedOn.mcp_servers["iris-dev-mcp"]?.enabled).toBe(true);

    // remove: the whole owned region (table + env sub-table + multiline
    // forms) goes; NOTHING orphaned behind; the foreign table is untouched.
    const removed = sandbox.run(["remove", "--client", "codex", "--server", "iris-dev-mcp"]);
    expect(removed.status).toBe(0);
    text = readFileSync(target, "utf8");
    expect(text).not.toContain("iris-dev-mcp");
    expect(text).not.toContain("notreal");
    expect(text).not.toContain("still string");
    expect(text).not.toContain("weird key");
    expect(text).not.toContain('["b"]');
    expect(text).not.toContain("USER_EXTRA");
    const parsedAfter = parseToml(text) as {
      mcp_servers: Record<string, Record<string, unknown>>;
    };
    expect(parsedAfter.mcp_servers["context7"]?.command).toBe("npx");
  }, T);
});

// ════════════════════════════════════════════════════════════════════
// 5. Comment-only JSONC lifecycle (the QA-stage product fix: apply used to
//    refuse a comment-only file as an "unsupported document shape" even
//    though AC 33.5.4 made it a VALID empty document).
// ════════════════════════════════════════════════════════════════════

describe("QA 33.5: comment-only JSONC lifecycle (built bin)", () => {
  it("cline: apply writes into a comment-only file, preserving the trivia; status + remove round-trip", () => {
    const sandbox = makeSandbox();
    const target = sandbox.seed("cline", "// just a comment\n");

    // status: the file is a valid EMPTY document, not unparseable.
    const statusText = sandbox.run(["status"]);
    expect(statusText.status).toBe(0);
    expect(statusText.stdout).not.toContain("UNPARSEABLE");

    // apply works on it (pre-fix: exit 1 "unsupported document shape").
    const applied = sandbox.run(["apply", "--client", "cline", "--servers", "iris-dev-mcp", "--yes"]);
    expect(applied.status).toBe(0);
    const text = readFileSync(target, "utf8");
    expect(text.startsWith("// just a comment")).toBe(true); // trivia preserved verbatim
    const parsed = parseJsonc(text) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(parsed.mcpServers["iris-dev-mcp"]?.command).toBe("npx");

    const statusJson = sandbox.run(["status", "--json"]);
    expect(statusRowState(parseEnvelope(statusJson), "cline", "iris-dev-mcp")).toBe("present-enabled");

    // remove round-trips; the comment survives.
    const removed = sandbox.run(["remove", "--client", "cline", "--server", "iris-dev-mcp"]);
    expect(removed.status).toBe(0);
    const afterRemove = readFileSync(target, "utf8");
    expect(afterRemove).toContain("// just a comment");
    const reparsed = parseJsonc(afterRemove) as { mcpServers: Record<string, unknown> };
    expect(reparsed.mcpServers["iris-dev-mcp"]).toBeUndefined();
  }, T);

  it("vscode: a block-comment-only mcp.json accepts an apply (the JSONC family's documented file form)", () => {
    const sandbox = makeSandbox();
    const target = sandbox.seed("vscode", "/* user notes only */\n");

    const applied = sandbox.run(["apply", "--client", "vscode", "--servers", "iris-dev-mcp", "--yes"]);
    expect(applied.status).toBe(0);
    const text = readFileSync(target, "utf8");
    expect(text.startsWith("/* user notes only */")).toBe(true);
    const parsed = parseJsonc(text) as { servers: Record<string, Record<string, unknown>> };
    expect(parsed.servers["iris-dev-mcp"]?.command).toBe("npx");

    const statusJson = sandbox.run(["status", "--json"]);
    expect(statusRowState(parseEnvelope(statusJson), "vscode", "iris-dev-mcp")).toBe("present-enabled");
  }, T);

  it("a comment-only file with REAL tokens past the comments still refuses as unparseable (the carve-out stays narrow)", () => {
    const sandbox = makeSandbox();
    sandbox.seed("cline", '// note\n{"mcpServers": ,}\n');
    const statusText = sandbox.run(["status"]);
    expect(statusText.status).toBe(0);
    expect(statusText.stdout).toContain("UNPARSEABLE");
    const applied = sandbox.run(["apply", "--client", "cline", "--servers", "iris-dev-mcp", "--yes"]);
    expect(applied.status).toBe(1);
  }, T);
});
