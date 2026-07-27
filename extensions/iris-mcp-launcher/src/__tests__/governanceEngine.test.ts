/**
 * Unit tests for the governance engine access layer (Story 32.2, Task 1) —
 * the subprocess contract over the `iris-mcp-governance` CLI.
 *
 * Expected argv/env shapes are pinned against the CLI's DOCUMENTED contract
 * (`packages/shared/src/cli/governance.ts`'s HELP_TEXT + the 31.6 spawn
 * resolution discipline), and the scrub is asserted against the containment
 * invariant the story names: no `IRIS_*` variable — credential material
 * (`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_PROFILES`) or an ambient governance
 * channel — ever reaches the spawned process's environment.
 */
import { describe, expect, it } from "vitest";
import {
  buildGovernanceCliEnv,
  governanceCliArgv,
  GOVERNANCE_CLI_BIN_NAME,
  GOVERNANCE_CLI_NPM_PACKAGE,
  GOVERNANCE_CLI_REPO_PATH,
  parseCliJson,
  resolveGovernanceCli,
  runGovernanceCli,
  type GovernanceCliResult,
  type SpawnImpl,
} from "../governanceEngine.js";
import { PACKAGE_NPM_NAME } from "../definitions.js";
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

describe("resolveGovernanceCli — resolution order mirrors 31.6", () => {
  it("published mode (default): npx -y -p @iris-mcp/shared iris-mcp-governance", () => {
    const resolution = resolveGovernanceCli(settings(), false);
    expect(resolution).toEqual({
      ok: true,
      target: {
        command: "npx",
        baseArgs: ["-y", "-p", GOVERNANCE_CLI_NPM_PACKAGE, GOVERNANCE_CLI_BIN_NAME],
        extraEnv: {},
        mode: "npx",
      },
    });
  });

  it("published mode for `universe` additionally -p-installs the five server packages (DERIVED from PACKAGE_NPM_NAME — never a hand-maintained roster), so the CLI finds their built dist as npm siblings", () => {
    const resolution = resolveGovernanceCli(settings(), true);
    if (!resolution.ok) throw new Error("expected ok resolution");
    const expectedPackages = [
      GOVERNANCE_CLI_NPM_PACKAGE,
      ...Object.values(PACKAGE_NPM_NAME),
    ];
    const expectedArgs = ["-y"];
    for (const pkg of expectedPackages) expectedArgs.push("-p", pkg);
    expectedArgs.push(GOVERNANCE_CLI_BIN_NAME);
    expect(resolution.target.baseArgs).toEqual(expectedArgs);
    // Sanity: the derivation really covers all five server packages.
    expect(Object.keys(PACKAGE_NPM_NAME)).toHaveLength(5);
  });

  it("local mode: developmentRepoPath → process.execPath + packages/shared/dist/cli/governance-cli.js + ELECTRON_RUN_AS_NODE=1", () => {
    const resolution = resolveGovernanceCli(
      settings({ developmentRepoPath: "C:\\dev\\iris-execute-mcp-v2" }),
      false,
      () => true,
    );
    if (!resolution.ok) throw new Error("expected ok resolution");
    expect(resolution.target.command).toBe(process.execPath);
    expect(resolution.target.baseArgs).toEqual([
      "C:\\dev\\iris-execute-mcp-v2\\packages\\shared\\dist\\cli\\governance-cli.js",
    ]);
    expect(resolution.target.extraEnv).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
    expect(resolution.target.mode).toBe("local");
    expect(GOVERNANCE_CLI_REPO_PATH.replace(/\\/g, "/")).toBe(
      "packages/shared/dist/cli/governance-cli.js",
    );
  });

  it("fail-closed: a RELATIVE developmentRepoPath is rejected, never resolved or fallen back to npx (the 31.6 discipline — a silent fallback would run a different engine than the user pinned)", () => {
    const resolution = resolveGovernanceCli(
      settings({ developmentRepoPath: "relative\\repo" }),
      false,
      () => true,
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error("expected failed resolution");
    expect(resolution.error).toContain("not an absolute path");
  });

  it("fail-closed: an unbuilt CLI (no dist/cli/governance-cli.js) is an actionable error, never a silent npx fallback", () => {
    const resolution = resolveGovernanceCli(
      settings({ developmentRepoPath: "C:\\dev\\repo" }),
      false,
      () => false,
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) throw new Error("expected failed resolution");
    expect(resolution.error).toContain("governance-cli.js");
    expect(resolution.error).toContain("pnpm --filter @iris-mcp/shared build");
  });
});

describe("buildGovernanceCliEnv — credential containment (the spawned CLI never receives IRIS_* material)", () => {
  it("scrubs EVERY IRIS_* variable from the ambient environment — including IRIS_USERNAME/IRIS_PASSWORD/IRIS_PROFILES and the ambient governance channels — then re-adds only the extension's own two cascade inputs", () => {
    const env = buildGovernanceCliEnv(
      settings({ governance: '{"global":{"iris_doc_put":false}}', governancePreset: "read-only" }),
      { ELECTRON_RUN_AS_NODE: "1" },
      {
        PATH: "C:\\Windows",
        IRIS_USERNAME: "_SYSTEM",
        IRIS_PASSWORD: "SYS",
        IRIS_PROFILES: '{"prod":{"host":"h","password":"p"}}',
        IRIS_GOVERNANCE: "ambient-must-not-leak",
        IRIS_GOVERNANCE_PRESET: "ambient-must-not-leak",
        IRIS_GOVERNANCE_FILE: "ambient-must-not-leak",
        IRIS_HOST: "ambient",
        IRIS_SERVER_MANAGER: "auto",
      },
    );

    expect(env).toEqual({
      PATH: "C:\\Windows",
      IRIS_GOVERNANCE: '{"global":{"iris_doc_put":false}}',
      IRIS_GOVERNANCE_PRESET: "read-only",
      ELECTRON_RUN_AS_NODE: "1",
    });
  });

  it("emits NO IRIS_* variable at all when the extension's governance settings are unset", () => {
    const env = buildGovernanceCliEnv(settings(), {}, {
      PATH: "/usr/bin",
      IRIS_PASSWORD: "x",
      IRIS_GOVERNANCE: "y",
    });
    expect(env).toEqual({ PATH: "/usr/bin" });
  });

  it("behavioral containment pin: a distinctive secret placed in every credential-shaped ambient variable appears NOWHERE in the spawned env (and the scrub really saw those variables — not a vacuous sweep)", () => {
    const SECRET = "DO-NOT-LEAK-GOVCLI-3c7a1f";
    const env = buildGovernanceCliEnv(settings(), {}, {
      PATH: "/usr/bin",
      IRIS_USERNAME: SECRET,
      IRIS_PASSWORD: SECRET,
      IRIS_PROFILES: SECRET,
      NOT_IRIS_BUT_SECRET: SECRET,
    });
    // The scrub is by IRIS_ prefix: the two IRIS_ secrets are gone…
    expect(env["IRIS_USERNAME"]).toBeUndefined();
    expect(env["IRIS_PASSWORD"]).toBeUndefined();
    expect(env["IRIS_PROFILES"]).toBeUndefined();
    // …and only a variable the extension deliberately passes through could
    // carry it — which nothing here is. (NOT_IRIS_BUT_SECRET is NOT scrubbed
    // by design: the containment contract covers the IRIS_* contract family,
    // and this pin documents that boundary explicitly rather than implying
    // a whole-env wipe that would break PATH//SystemRoot on the child.)
    expect(env["NOT_IRIS_BUT_SECRET"]).toBe(SECRET);
    expect(env["PATH"]).toBe("/usr/bin");
  });

  it("the scrub is CASE-INSENSITIVE — a lowercase/mixed-case ambient iris_* variable (honored by Windows' case-insensitive environment lookup exactly like its uppercase spelling) never reaches the child (32.2 review)", () => {
    const env = buildGovernanceCliEnv(settings(), {}, {
      PATH: "/usr/bin",
      iris_password: "lowercase-secret",
      Iris_Profiles: "mixed-case-secret",
      iris_governance: "lowercase-ambient-channel",
      IRIS_USERNAME: "uppercase-secret",
    });
    expect(env).toEqual({ PATH: "/usr/bin" });
  });
});

describe("governanceCliArgv — the wire shape, pinned against the CLI's documented contract", () => {
  it("read commands carry --json and --file", () => {
    expect(governanceCliArgv({ kind: "validate", file: "/p/g.json" })).toEqual([
      "validate", "--json", "--file", "/p/g.json",
    ]);
    expect(governanceCliArgv({ kind: "diff", file: "/p/g.json" })).toEqual([
      "diff", "--json", "--file", "/p/g.json",
    ]);
    expect(governanceCliArgv({ kind: "universe", file: "/p/g.json", profile: "prod" })).toEqual([
      "universe", "--json", "--file", "/p/g.json", "--profile", "prod",
    ]);
  });

  it("universe omits --file when the file does not exist yet (the CLI renders env/preset/seed without one)", () => {
    expect(governanceCliArgv({ kind: "universe", profile: "default" })).toEqual([
      "universe", "--json", "--profile", "default",
    ]);
  });

  it("set/unset address the GLOBAL layer without --profile, a profile layer with it", () => {
    expect(
      governanceCliArgv({ kind: "set", file: "/p/g.json", profile: undefined, key: "k", value: true }),
    ).toEqual(["set", "k", "true", "--file", "/p/g.json"]);
    expect(
      governanceCliArgv({ kind: "set", file: "/p/g.json", profile: "prod", key: "k", value: false }),
    ).toEqual(["set", "k", "false", "--file", "/p/g.json", "--profile", "prod"]);
    expect(
      governanceCliArgv({ kind: "unset", file: "/p/g.json", profile: undefined, key: "k" }),
    ).toEqual(["unset", "k", "--file", "/p/g.json"]);
    expect(
      governanceCliArgv({ kind: "unset", file: "/p/g.json", profile: "prod", key: "k" }),
    ).toEqual(["unset", "k", "--file", "/p/g.json", "--profile", "prod"]);
  });
});

describe("runGovernanceCli — captured output, never throws", () => {
  function fakeSpawn(scripted: {
    stdout?: string;
    stderr?: string;
    status?: number;
    error?: string;
    onSpawn?: (command: string, args: string[], env: Record<string, string>) => void;
  }): SpawnImpl {
    return (command, args, options) => {
      scripted.onSpawn?.(command, args, options.env);
      const listeners = new Map<string, ((arg: unknown) => void)[]>();
      const child = {
        stdout: {
          on: (_event: "data", listener: (chunk: string) => void) => {
            if (scripted.stdout !== undefined) listener(scripted.stdout);
          },
        },
        stderr: {
          on: (_event: "data", listener: (chunk: string) => void) => {
            if (scripted.stderr !== undefined) listener(scripted.stderr);
          },
        },
        on: (event: "close" | "error", listener: (arg: unknown) => void) => {
          listeners.set(event, [...(listeners.get(event) ?? []), listener]);
          if (event === "error" && scripted.error !== undefined) listener(new Error(scripted.error));
          if (event === "close" && scripted.error === undefined) listener(scripted.status ?? 0);
        },
      };
      return child;
    };
  }

  const target = { command: "npx", baseArgs: ["-y", "-p", "@iris-mcp/shared", "iris-mcp-governance"], extraEnv: {}, mode: "npx" as const };

  it("spawns command + baseArgs + command argv, captures stdout/stderr/status (POSIX shape — no shell wrapping)", async () => {
    let seen: { command: string; args: string[] } | undefined;
    const result = await runGovernanceCli(
      target,
      { kind: "set", file: "/p/g.json", profile: "prod", key: "iris_doc_put", value: false },
      { PATH: "/usr/bin" },
      fakeSpawn({
        stdout: "Set ok\n",
        status: 0,
        onSpawn: (command, args) => {
          seen = { command, args };
        },
      }),
      120_000,
      "linux",
    );
    expect(result).toEqual<GovernanceCliResult>({ status: 0, stdout: "Set ok\n", stderr: "" });
    expect(seen?.command).toBe("npx");
    expect(seen?.args).toEqual([
      "-y", "-p", "@iris-mcp/shared", "iris-mcp-governance",
      "set", "iris_doc_put", "false", "--file", "/p/g.json", "--profile", "prod",
    ]);
  });

  it("on win32 a non-.exe command (the npx .cmd shim) routes through cmd.exe /d /s /c — plain spawn cannot execute batch files (verified empirically: spawn('npx') → ENOENT; 32.2 review)", async () => {
    let seen: { command: string; args: string[] } | undefined;
    const result = await runGovernanceCli(
      target,
      { kind: "universe", profile: "default" },
      {},
      fakeSpawn({
        stdout: "{}\n",
        onSpawn: (command, args) => {
          seen = { command, args };
        },
      }),
      120_000,
      "win32",
    );
    expect(result.status).toBe(0);
    expect(seen?.command.toLowerCase()).toContain("cmd.exe");
    expect(seen?.args).toEqual([
      "/d", "/s", "/c", "npx",
      "-y", "-p", "@iris-mcp/shared", "iris-mcp-governance",
      "universe", "--json", "--profile", "default",
    ]);
  });

  it("an .exe command (local mode's process.execPath) is NOT wrapped even on win32", async () => {
    let seen: { command: string; args: string[] } | undefined;
    const localTarget = {
      command: "C:\\Program Files\\nodejs\\node.exe",
      baseArgs: ["C:\\repo\\packages\\shared\\dist\\cli\\governance-cli.js"],
      extraEnv: { ELECTRON_RUN_AS_NODE: "1" },
      mode: "local" as const,
    };
    await runGovernanceCli(
      localTarget,
      { kind: "validate", file: "/p/g.json" },
      {},
      fakeSpawn({
        stdout: "{}\n",
        onSpawn: (command, args) => {
          seen = { command, args };
        },
      }),
      120_000,
      "win32",
    );
    expect(seen?.command).toBe(localTarget.command);
    expect(seen?.args).toEqual([localTarget.baseArgs[0], "validate", "--json", "--file", "/p/g.json"]);
  });

  it("a child that never settles is killed and resolved as a spawnError after the timeout (never a session-long wedge)", async () => {
    let killed = false;
    const hungSpawn: SpawnImpl = () => ({
      stdout: { on: () => undefined },
      stderr: { on: () => undefined },
      on: () => undefined, // never fires close/error — the hang
      kill: () => {
        killed = true;
      },
    });
    const result = await runGovernanceCli(
      target,
      { kind: "universe", profile: "default" },
      {},
      hungSpawn,
      10,
      "linux",
    );
    expect(result.status).toBeNull();
    expect(result.spawnError).toContain("timed out");
    expect(killed).toBe(true);
  });

  it("a spawn-level error (e.g. npx ENOENT) comes back as spawnError — never a thrown rejection", async () => {
    const result = await runGovernanceCli(
      target,
      { kind: "validate", file: "/p/g.json" },
      {},
      fakeSpawn({ error: "spawn npx ENOENT" }),
    );
    expect(result.status).toBeNull();
    expect(result.spawnError).toContain("ENOENT");
  });

  it("a synchronous spawn throw comes back as spawnError", async () => {
    const result = await runGovernanceCli(target, { kind: "diff", file: "/p/g.json" }, {}, () => {
      throw new Error("synchronous spawn failure");
    });
    expect(result.status).toBeNull();
    expect(result.spawnError).toBe("synchronous spawn failure");
  });

  it("a non-zero exit carries status + stderr through", async () => {
    const result = await runGovernanceCli(
      target,
      { kind: "unset", file: "/p/g.json", profile: undefined, key: "k" },
      {},
      fakeSpawn({ status: 1, stderr: '"k" is not set — nothing to unset.\n' }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("nothing to unset");
  });
});

describe("parseCliJson — the CLI's single-JSON-object stdout contract", () => {
  it("parses one JSON object", () => {
    const parsed = parseCliJson('{"ok":true,"file":"/p/g.json"}\n', "");
    expect(parsed).toEqual({ ok: true, json: { ok: true, file: "/p/g.json" } });
  });

  it("prefers the CLI's own stderr text when stdout is empty or unparseable (the engine's own messages become the inline validation errors)", () => {
    const parsed = parseCliJson("", "Error: IRIS_GOVERNANCE_FILE is invalid: ...\n");
    expect(parsed).toEqual({
      ok: false,
      error: "Error: IRIS_GOVERNANCE_FILE is invalid: ...",
    });
    const garbage = parseCliJson("not json", "some stderr");
    expect(garbage.ok).toBe(false);
    if (garbage.ok) throw new Error("expected failure");
    expect(garbage.error).toBe("some stderr");
  });
});
