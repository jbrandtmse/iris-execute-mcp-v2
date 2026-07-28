/**
 * Unit tests for the clients engine access layer (Story 33.3, Task 1) —
 * resolution order, the IRIS_* containment scrub (with the ONE extension-
 * owned re-add), argv wire shapes, spawn/timeout/stdin mechanics, the modes
 * probe parser, and the typed wrappers' envelope/exit-code mapping.
 *
 * Every CLI output fake is shaped like the real built bin's output (Rule #36
 * — captured 2026-07-28; the capture commands are in clientsView.test.ts's
 * header; the SPAWN-level proofs against the real bin live in
 * clientsEngineRealCli.test.ts).
 */
import { describe, expect, it } from "vitest";
import {
  availableModes,
  buildClientsCliEnv,
  CLIENTS_CLI_BIN_NAME,
  CLIENTS_CLI_NPM_PACKAGE,
  CLIENTS_CLI_REPO_PATH,
  clientsCliArgv,
  detectClientsJson,
  diffApplyJson,
  diffApplyText,
  doctorJson,
  parseAvailableModes,
  parseEnvelope,
  resolveClientsCli,
  restoreJson,
  runClientsCli,
  statusMatrixJson,
  toggleJson,
  applyJson,
  type ClientsCliCommand,
  type ClientsCliResult,
  type ClientsCliTarget,
  type ClientsSpawnImpl,
} from "../clientsEngine.js";
import type { LauncherSettings } from "../types.js";

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
  return {
    servers: [],
    packages: ["dev"],
    namespace: "HSCUSTOM",
    combineProfiles: false,
    developmentRepoPath: "",
    hadStaleAllPackage: false,
    governance: "",
    governancePreset: "",
    governanceFile: "",
    auditLog: "",
    auditLogMaxMb: "",
    auditLogParams: "",
    toolsPreset: "",
    toolsDisable: "",
    toolsEnable: "",
    ...overrides,
  };
}

// ── Resolution ─────────────────────────────────────────────────────────

describe("resolveClientsCli", () => {
  it("published mode: npx -y -p @iris-mcp/client-config iris-mcp-clients", async () => {
    const resolution = await resolveClientsCli(settings());
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.target.mode).toBe("npx");
    expect(resolution.target.command).toBe("npx");
    expect(resolution.target.baseArgs).toEqual(["-y", "-p", CLIENTS_CLI_NPM_PACKAGE, CLIENTS_CLI_BIN_NAME]);
    expect(CLIENTS_CLI_NPM_PACKAGE).toBe("@iris-mcp/client-config");
    expect(CLIENTS_CLI_BIN_NAME).toBe("iris-mcp-clients");
  });

  it("dev-repo mode: the extension host interpreter + the repo's built CLI, ELECTRON_RUN_AS_NODE=1", async () => {
    const resolution = await resolveClientsCli(
      settings({ developmentRepoPath: "C:\\git\\iris-execute-mcp-v2" }),
      async () => true,
    );
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.target.mode).toBe("local");
    expect(resolution.target.command).toBe(process.execPath);
    expect(resolution.target.baseArgs).toEqual([
      "C:\\git\\iris-execute-mcp-v2\\packages\\client-config\\dist\\cli\\clients-cli.js",
    ]);
    expect(resolution.target.extraEnv).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
    expect(CLIENTS_CLI_REPO_PATH.replace(/\\/g, "/")).toBe("packages/client-config/dist/cli/clients-cli.js");
  });

  it("a RELATIVE developmentRepoPath fails closed (never silently resolves against two different cwds)", async () => {
    const resolution = await resolveClientsCli(settings({ developmentRepoPath: "relative\\repo" }));
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.error).toContain("not an absolute path");
    expect(resolution.error).toContain("relative\\repo");
  });

  it("an unbuilt CLI fails closed with the build command (never falls back to npx)", async () => {
    const resolution = await resolveClientsCli(
      settings({ developmentRepoPath: "C:\\git\\iris-execute-mcp-v2" }),
      async () => false,
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.error).toContain("clients CLI is not built");
    expect(resolution.error).toContain("pnpm --filter @iris-mcp/client-config build");
  });
});

// ── Env containment ────────────────────────────────────────────────────

describe("buildClientsCliEnv", () => {
  it("scrubs EVERY IRIS_* variable case-insensitively and keeps the non-IRIS passthrough", () => {
    const env = buildClientsCliEnv(settings(), {}, {
      HOME: "/home/u",
      APPDATA: "C:\\Users\\u\\AppData\\Roaming",
      IRIS_PASSWORD: "never-reaches-the-cli",
      iris_username: "lowercase-variant",
      Iris_Server_Manager: "auto",
      IRIS_GOVERNANCE_FILE: "C:\\ambient\\policy.json",
      PATH: "C:\\Windows",
    });
    expect(env["HOME"]).toBe("/home/u");
    expect(env["APPDATA"]).toBe("C:\\Users\\u\\AppData\\Roaming");
    expect(env["PATH"]).toBe("C:\\Windows");
    for (const name of Object.keys(env)) {
      expect(name.toUpperCase().startsWith("IRIS_"), `${name} must be scrubbed`).toBe(false);
    }
  });

  it("re-adds IRIS_GOVERNANCE_FILE from irisMcpLauncher.governanceFile ONLY (the extension-owned channel), never from ambient, and nothing else", () => {
    const withSetting = buildClientsCliEnv(
      settings({ governanceFile: "C:\\owned\\policy.json", governance: '{"global":{}}', governancePreset: "core" }),
      {},
      { IRIS_GOVERNANCE_FILE: "C:\\ambient\\policy.json", IRIS_SERVER_MANAGER: "auto" },
    );
    expect(withSetting["IRIS_GOVERNANCE_FILE"]).toBe("C:\\owned\\policy.json");
    // governance/governancePreset/IRIS_SERVER_MANAGER are NOT clients-CLI inputs — not re-added.
    expect(withSetting["IRIS_GOVERNANCE"]).toBeUndefined();
    expect(withSetting["IRIS_GOVERNANCE_PRESET"]).toBeUndefined();
    expect(withSetting["IRIS_SERVER_MANAGER"]).toBeUndefined();

    const withoutSetting = buildClientsCliEnv(settings(), {}, { IRIS_GOVERNANCE_FILE: "C:\\ambient\\policy.json" });
    expect(withoutSetting["IRIS_GOVERNANCE_FILE"]).toBeUndefined();
  });

  it("extraEnv merges last (the local mode's ELECTRON_RUN_AS_NODE)", () => {
    const env = buildClientsCliEnv(settings(), { ELECTRON_RUN_AS_NODE: "1" }, {});
    expect(env["ELECTRON_RUN_AS_NODE"]).toBe("1");
  });
});

// ── argv wire shapes ───────────────────────────────────────────────────

describe("clientsCliArgv", () => {
  it("read commands take --json; the modes probe is --help", () => {
    expect(clientsCliArgv({ kind: "detect" })).toEqual(["detect", "--json"]);
    expect(clientsCliArgv({ kind: "status" })).toEqual(["status", "--json"]);
    expect(clientsCliArgv({ kind: "doctor" })).toEqual(["doctor", "--json"]);
    expect(clientsCliArgv({ kind: "modesHelp" })).toEqual(["--help"]);
  });

  it("diff --json for non-explicit modes; explicit mode uses the redacted TEXT render (NO --json) with --confirm-secret + --password-stdin", () => {
    expect(
      clientsCliArgv({ kind: "diff", client: "claude-code", scope: "user", servers: ["iris-dev-mcp", "iris-ops-mcp"], mode: "env-reference" }),
    ).toEqual(["diff", "--client", "claude-code", "--servers", "iris-dev-mcp,iris-ops-mcp", "--scope", "user", "--mode", "env-reference", "--json"]);

    const explicit = clientsCliArgv({
      kind: "diff", client: "cursor", scope: "project", servers: ["iris-dev-mcp"], mode: "explicit",
      confirmSecret: "iris-dev-mcp", passwordStdin: "pw",
    });
    expect(explicit).toEqual([
      "diff", "--client", "cursor", "--servers", "iris-dev-mcp", "--scope", "project", "--mode", "explicit",
      "--confirm-secret", "iris-dev-mcp", "--password-stdin",
    ]);
    expect(explicit).not.toContain("--json");
    // The password value is NEVER an argv element.
    expect(explicit).not.toContain("pw");
  });

  it("apply always carries --yes + --json (the panel's confirm button is the confirmation); explicit adds the secret flags", () => {
    expect(
      clientsCliArgv({ kind: "apply", client: "zed", scope: "user", servers: ["iris-admin-mcp"], mode: "server-manager" }),
    ).toEqual(["apply", "--client", "zed", "--servers", "iris-admin-mcp", "--scope", "user", "--mode", "server-manager", "--yes", "--json"]);

    const explicit = clientsCliArgv({
      kind: "apply", client: "zed", scope: "user", servers: ["iris-admin-mcp"], mode: "explicit",
      confirmSecret: "iris-admin-mcp", passwordStdin: "pw",
    });
    expect(explicit).toEqual([
      "apply", "--client", "zed", "--servers", "iris-admin-mcp", "--scope", "user", "--mode", "explicit",
      "--yes", "--json", "--confirm-secret", "iris-admin-mcp", "--password-stdin",
    ]);
    expect(explicit).not.toContain("pw");
  });

  it("enable/disable/remove/restore wire shapes", () => {
    expect(clientsCliArgv({ kind: "disable", client: "claude-code", scope: "user", server: "iris-dev-mcp" }))
      .toEqual(["disable", "--client", "claude-code", "--server", "iris-dev-mcp", "--scope", "user", "--json"]);
    expect(clientsCliArgv({ kind: "enable", client: "cline", scope: "user", server: "iris-ops-mcp" }))
      .toEqual(["enable", "--client", "cline", "--server", "iris-ops-mcp", "--scope", "user", "--json"]);
    expect(clientsCliArgv({ kind: "remove", client: "goose", scope: "user", server: "iris-data-mcp" }))
      .toEqual(["remove", "--client", "goose", "--server", "iris-data-mcp", "--scope", "user", "--json"]);
    expect(clientsCliArgv({ kind: "restore", client: "claude-code", scope: "project" }))
      .toEqual(["restore", "--client", "claude-code", "--scope", "project", "--json"]);
  });
});

// ── runClientsCli mechanics ────────────────────────────────────────────

const LOCAL_TARGET: ClientsCliTarget = {
  command: "node",
  baseArgs: ["C:\\repo\\packages\\client-config\\dist\\cli\\clients-cli.js"],
  extraEnv: {},
  mode: "local",
};

/** A minimal fake child: scripted close status/stdout/stderr, records stdin. */
function fakeChild(script: { status?: number | null; stdout?: string; stderr?: string; error?: string; hang?: boolean }) {
  const listeners: { close: ((arg: unknown) => void)[]; error: ((arg: unknown) => void)[] } = { close: [], error: [] };
  const child = {
    stdinWritten: "",
    stdinEnded: false,
    killed: false,
    stdin: {
      write(chunk: string) {
        child.stdinWritten += chunk;
      },
      end() {
        child.stdinEnded = true;
      },
    },
    stdout: {
      on: (_e: "data", listener: (chunk: string) => void): void => {
        if (script.stdout !== undefined && !script.hang) queueMicrotask(() => listener(script.stdout as string));
      },
    },
    stderr: {
      on: (_e: "data", listener: (chunk: string) => void): void => {
        if (script.stderr !== undefined && !script.hang) queueMicrotask(() => listener(script.stderr as string));
      },
    },
    on: (event: "close" | "error", listener: (arg: unknown) => void): void => {
      listeners[event].push(listener);
      if (script.hang) return;
      queueMicrotask(() => {
        if (event === "error" && script.error !== undefined) listener(new Error(script.error));
        if (event === "close" && script.error === undefined) listener(script.status ?? 0);
      });
    },
    kill: (): void => {
      child.killed = true;
      // Real kill() delivers close ASYNCHRONOUSLY (Rule #54) — the timeout's
      // own finish lands first, so the spawnError survives.
      queueMicrotask(() => {
        for (const listener of listeners.close) listener(null);
      });
    },
  };
  return child;
}

describe("runClientsCli", () => {
  it("captures status/stdout/stderr from a settling child", async () => {
    const child = fakeChild({ status: 0, stdout: "{\"ok\":true}\n", stderr: "" });
    const spawnImpl: ClientsSpawnImpl = () => child;
    const result = await runClientsCli(LOCAL_TARGET, { kind: "detect" }, {}, spawnImpl);
    expect(result).toEqual({ status: 0, stdout: "{\"ok\":true}\n", stderr: "" });
  });

  it("a throwing spawn comes back as spawnError (never rejects)", async () => {
    const spawnImpl: ClientsSpawnImpl = () => {
      throw new Error("ENOENT npx");
    };
    const result = await runClientsCli(LOCAL_TARGET, { kind: "detect" }, {}, spawnImpl);
    expect(result.status).toBeNull();
    expect(result.spawnError).toBe("ENOENT npx");
  });

  it("a child error event comes back as spawnError", async () => {
    const child = fakeChild({ error: "spawn npx ENOENT" });
    const result = await runClientsCli(LOCAL_TARGET, { kind: "detect" }, {}, () => child);
    expect(result.status).toBeNull();
    expect(result.spawnError).toBe("spawn npx ENOENT");
  });

  it("a hung child is killed at the timeout and resolved as spawnError (the 32.2 hung-CLI lesson)", async () => {
    const child = fakeChild({ hang: true });
    const result = await runClientsCli(LOCAL_TARGET, { kind: "status" }, {}, () => child, 25);
    expect(child.killed).toBe(true);
    expect(result.spawnError).toContain("iris-mcp-clients status timed out");
  });

  it("writes passwordStdin to the child's stdin (+ newline) and closes it; nothing without a password", async () => {
    const withPw = fakeChild({ status: 0, stdout: "preview\n", stderr: "" });
    await runClientsCli(
      LOCAL_TARGET,
      { kind: "apply", client: "zed", scope: "user", servers: ["iris-dev-mcp"], mode: "explicit", confirmSecret: "iris-dev-mcp", passwordStdin: "s3cr3t" },
      {},
      () => withPw,
    );
    expect(withPw.stdinWritten).toBe("s3cr3t\n");
    expect(withPw.stdinEnded).toBe(true);

    const withoutPw = fakeChild({ status: 0, stdout: "x", stderr: "" });
    await runClientsCli(LOCAL_TARGET, { kind: "detect" }, {}, () => withoutPw);
    expect(withoutPw.stdinWritten).toBe("");
    expect(withoutPw.stdinEnded).toBe(false);
  });

  it("routes npx through cmd.exe on win32 (the 32.2 CVE-2024-27980 discipline), leaving the argv array intact", async () => {
    let spawned: { command: string; args: string[] } | undefined;
    const child = fakeChild({ status: 0, stdout: "", stderr: "" });
    const spawnImpl: ClientsSpawnImpl = (command, args) => {
      spawned = { command, args };
      return child;
    };
    const npxTarget: ClientsCliTarget = { command: "npx", baseArgs: ["-y", "-p", "@iris-mcp/client-config", "iris-mcp-clients"], extraEnv: {}, mode: "npx" };
    await runClientsCli(npxTarget, { kind: "detect" }, {}, spawnImpl, 1000, "win32");
    expect(spawned?.command.toLowerCase()).toContain("cmd.exe");
    expect(spawned?.args).toEqual(["/d", "/s", "/c", "npx", "-y", "-p", "@iris-mcp/client-config", "iris-mcp-clients", "detect", "--json"]);
  });
});

// ── Modes probe parser ─────────────────────────────────────────────────

describe("parseAvailableModes", () => {
  // Captured 2026-07-28 from the built bin on a bare host (no SM definitions,
  // no governance file): exactly the two always-available modes listed.
  const BARE_HELP = `
  --mode <mode>         Entry synthesis mode (default: env-reference). Modes
                        available on THIS host:
      env-reference    \${VAR} / \${env:VAR} references (VS Code: native inputs for the password)
      explicit         literal values; a literal IRIS_PASSWORD needs --confirm-secret <entry-name>
      (2 mode(s) unavailable on this host are hidden; run with the host probe satisfied —
      server-manager: IRIS_SERVER_MANAGER is unset and no intersystems.servers definitions were found at the standard VS Code settings locations
      governance-file: governance-file mode needs an existing governance file: pass --governance-file <path> or set IRIS_GOVERNANCE_FILE)
  --host <host>          Connection literal (env-reference on no-expansion
`;
  // And with both probes satisfied (governance-file + server-manager lines listed).
  const FULL_HELP = `
                        available on THIS host:
      env-reference    \${VAR} / \${env:VAR} references (VS Code: native inputs for the password)
      explicit         literal values; a literal IRIS_PASSWORD needs --confirm-secret <entry-name>
      server-manager   IRIS_SERVER_MANAGER=auto — connections from Server Manager profiles
      governance-file  IRIS_GOVERNANCE_FILE=<path> — governance from a shared file
  --host <host>          Connection literal (env-reference on no-expansion
`;

  it("parses exactly the listed modes (a bare host offers only the two always modes)", () => {
    expect(parseAvailableModes(BARE_HELP)).toEqual(["env-reference", "explicit"]);
  });

  it("parses the full list when the host probes are satisfied", () => {
    expect(parseAvailableModes(FULL_HELP)).toEqual(["env-reference", "explicit", "server-manager", "governance-file"]);
  });

  it("fails open on the two always modes when the render is truncated/skewed (the CLI's own gate stays the enforcement point)", () => {
    expect(parseAvailableModes("garbage\n")).toEqual(["env-reference", "explicit"]);
    expect(parseAvailableModes("")).toEqual(["env-reference", "explicit"]);
  });

  it("the hidden-modes note is never mistaken for a listed mode", () => {
    const modes = parseAvailableModes(BARE_HELP);
    expect(modes).not.toContain("server-manager");
    expect(modes).not.toContain("governance-file");
  });
});

// ── parseEnvelope ──────────────────────────────────────────────────────

describe("parseEnvelope", () => {
  it("parses a single-envelope stdout (trailing newline tolerated)", () => {
    const parsed = parseEnvelope('{"ok":true,"command":"detect","data":{"counts":{}}}\n', "");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.command).toBe("detect");
  });

  it("non-JSON stdout surfaces the stderr detail (the usage-error plain-text discipline)", () => {
    const parsed = parseEnvelope("", 'Error: Unknown option "--frobnicate".\n');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("--frobnicate");
  });

  it("a JSON-but-not-envelope stdout is rejected", () => {
    const parsed = parseEnvelope('{"unexpected":true}\n', "");
    expect(parsed.ok).toBe(false);
  });
});

// ── Typed wrappers ─────────────────────────────────────────────────────

function runReturning(results: ClientsCliResult[]): { run: (command: ClientsCliCommand) => Promise<ClientsCliResult>; commands: ClientsCliCommand[] } {
  const commands: ClientsCliCommand[] = [];
  let index = 0;
  return {
    commands,
    run: async (command) => {
      commands.push(command);
      const result = results[Math.min(index, results.length - 1)] as ClientsCliResult;
      index++;
      return result;
    },
  };
}

const jsonOut = (payload: unknown): string => `${JSON.stringify(payload)}\n`;

describe("typed wrappers", () => {
  it("detect/status/diff/apply/toggle/restore return the envelope data on exit 0", async () => {
    const detectData = { adapterDataVersion: "2026-07-25.2", clients: [], dispositions: [], counts: { probed: 13, detected: 0, notDetected: 13, dispositioned: 3 } };
    const { run } = runReturning([{ status: 0, stdout: jsonOut({ ok: true, command: "detect", data: detectData }), stderr: "" }]);
    const result = await detectClientsJson(run);
    expect(result).toEqual({ ok: true, data: detectData });
  });

  it("exit 1 with an ok:false envelope surfaces the CLI's own error text", async () => {
    const { run } = runReturning([{
      status: 1,
      stdout: jsonOut({ ok: false, command: "disable", data: { ok: false }, error: 'refusing to modify "github-mcp" — it is outside the iris-mcp namespace' }),
      stderr: 'Error: refusing to modify "github-mcp" — it is outside the iris-mcp namespace\n',
    }]);
    const result = await toggleJson(run, "disable", { client: "claude-code", scope: "user", server: "github-mcp" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('refusing to modify "github-mcp"');
  });

  it("exit 2 (usage, plain text on stderr, NO envelope) surfaces the stderr text", async () => {
    const { run } = runReturning([{ status: 2, stdout: "", stderr: 'Error: unknown client "not-a-client" (known clients: …)\n' }]);
    const result = await statusMatrixJson(run);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('unknown client "not-a-client"');
  });

  it("a spawnError propagates as the wrapper error", async () => {
    const { run } = runReturning([{ status: null, stdout: "", stderr: "", spawnError: "npx not on PATH" }]);
    const result = await diffApplyJson(run, { client: "cursor", scope: "user", servers: ["iris-dev-mcp"], mode: "env-reference" });
    expect(result).toEqual({ ok: false, error: "npx not on PATH" });
  });

  it("diffApplyText returns the CLI's redacted text render; a non-zero exit surfaces stderr", async () => {
    const { run } = runReturning([{ status: 0, stdout: "Pending changes …\n********\n", stderr: "" }]);
    const okResult = await diffApplyText(run, { client: "zed", scope: "user", servers: ["iris-dev-mcp"], mode: "explicit", confirmSecret: "iris-dev-mcp", passwordStdin: "pw" });
    expect(okResult).toEqual({ ok: true, data: "Pending changes …\n********\n" });

    const { run: runFail } = runReturning([{ status: 2, stdout: "", stderr: "Error: explicit mode writes a literal IRIS_PASSWORD; pass --confirm-secret <entry-name>\n" }]);
    const failResult = await diffApplyText(runFail, { client: "zed", scope: "user", servers: ["iris-dev-mcp"], mode: "explicit" });
    expect(failResult.ok).toBe(false);
    if (failResult.ok) return;
    expect(failResult.error).toContain("--confirm-secret");
  });

  it("apply/toggle/restore/availableModes map their data through", async () => {
    const applyData = { client: "claude-code", scope: "user", mode: "env-reference", changed: 1, inputsMerged: [], results: [], restartHint: "Restart Claude Code…" };
    const { run } = runReturning([{ status: 0, stdout: jsonOut({ ok: true, command: "apply", data: applyData }), stderr: "" }]);
    expect(await applyJson(run, { client: "claude-code", scope: "user", servers: ["iris-admin-mcp"], mode: "env-reference" }))
      .toEqual({ ok: true, data: applyData });

    const engineResult = { ok: true, client: "claude-code", scope: "user", action: "restore", path: "C:\\x", changed: true, restartHint: "Restart…" };
    const { run: runRestore } = runReturning([{ status: 0, stdout: jsonOut({ ok: true, command: "restore", data: engineResult }), stderr: "" }]);
    expect(await restoreJson(runRestore, { client: "claude-code", scope: "user" })).toEqual({ ok: true, data: engineResult });

    const { run: runHelp } = runReturning([{ status: 0, stdout: "      env-reference    x\n      explicit         y\n", stderr: "" }]);
    expect(await availableModes(runHelp)).toEqual({ ok: true, data: ["env-reference", "explicit"] });
  });

  it("doctor: exit 1 WITH findings is a legitimate outcome (findingsOk false, data present); exit 0 is clean", async () => {
    const findingsData = { findings: [{ check: "parseability", client: "claude-code", scope: "user", path: null, detail: "unparseable" }], findingCount: 1, repaired: [], staleBackupDays: 30, parsedFiles: 0, restartHints: [] };
    const { run } = runReturning([{ status: 1, stdout: jsonOut({ ok: false, command: "doctor", data: findingsData }), stderr: "" }]);
    const withFindings = await doctorJson(run);
    expect(withFindings).toEqual({ ok: true, findingsOk: false, data: findingsData });

    const cleanData = { findings: [], findingCount: 0, repaired: [], staleBackupDays: 30, parsedFiles: 1, restartHints: [] };
    const { run: runClean } = runReturning([{ status: 0, stdout: jsonOut({ ok: true, command: "doctor", data: cleanData }), stderr: "" }]);
    expect(await doctorJson(runClean)).toEqual({ ok: true, findingsOk: true, data: cleanData });
  });

  it("doctor: a malformed success payload is an inline error, never a render crash (the 32.2 shape-guard discipline)", async () => {
    const { run } = runReturning([{ status: 0, stdout: jsonOut({ ok: true, command: "doctor", data: { unexpectedly: "malformed" } }), stderr: "" }]);
    const result = await doctorJson(run);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("unexpected output shape");
  });
});
