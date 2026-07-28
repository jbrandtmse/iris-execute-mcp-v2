/**
 * Story 33.1 — QA E2E/edge layer ON TOP of dev's MemFs unit suite.
 *
 * What this file adds that the unit suite does not cover:
 *  1. Full lifecycle chains over the BUILT dist (`dist/index.js`, AC 33.1-I2)
 *     against REAL filesystem sandbox HOMEs (mkdtemp — never the real HOME):
 *     apply → status row flips → disable → enable → remove → byte-equality
 *     per format family (JSON stash, JSON native-flag, TOML native-flag,
 *     YAML native-flag, JSONC stash with comments).
 *  2. Synthesis × engine × status end-to-end: synthesizeEntry → apply → the
 *     status matrix row flips (server-manager / env-reference+inputs seam /
 *     explicit with the typed confirmation and the contains-secret ledger).
 *  3. Restore chains: sabotage auto-restore on the real fs, restore over an
 *     EXTERNALLY-CORRUPTED config (the disaster case), and a backup dir
 *     containing pre-existing garbage (non-timestamp files are never picked).
 *     The last two pin QA-found product fixes in write.ts (see below).
 *  4. Concurrent-scope same-basename files (codex user + project both named
 *     config.toml): backups stay segregated per scope, operations never
 *     cross-contaminate.
 *  5. Corrupted state.json mid-flow: the typed refusal fires BEFORE any
 *     backup/write (file byte-identical, backup count unchanged).
 *  6. Multi-client interleavings in ONE sandbox HOME with a shared state
 *     dir; ownership refusals proving ZERO on-disk side effects (no backups
 *     dir, no state.json, file byte-identical).
 *  7. Adversarial encodings/values through the engine on the real fs: CRLF
 *     configs, unicode entry values + stash round-trip, and EACCES-shaped
 *     fs failures (a Rule #54-reachable shape) incl. the state-degrade
 *     warning path.
 *
 * QA-FOUND PRODUCT FIXES this file pins (fixed in src/write.ts, 2026-07-27,
 * both confirmed live against the pre-fix dist before fixing):
 *  - QA-33.1-F1: `restore` refused when the CURRENT config was unparseable —
 *    the exact disaster case restore exists for, leaving no manager-side way
 *    back. restoreBackup now skips pre-parse of the current file only (the
 *    broken bytes are still backed up first; restored bytes are re-parsed).
 *  - QA-33.1-F2: `listBackups` treated ANY `<basename>.*` file as a backup;
 *    a non-timestamp file sorted after every ISO stamp and was silently
 *    restored over the real config. Only the manager's timestamped naming
 *    now counts as a backup.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { readFixture } from "./helpers.js";

type Api = typeof import("../index.js");
type EngineHostContext = import("../index.js").EngineHostContext;
type CanonicalEntry = import("../index.js").CanonicalEntry;
type CanonicalServerName = import("../index.js").CanonicalServerName;
type ClientAdapter = import("../index.js").ClientAdapter;
type ClientScope = import("../index.js").ClientScope;
type WriteFs = import("../index.js").WriteFs;

let api: Api;

beforeAll(async () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const dist = path.resolve(here, "../../dist/index.js");
  if (!existsSync(dist)) {
    throw new Error("packages/client-config/dist/index.js is not built — run `pnpm turbo run build` first");
  }
  api = (await import(pathToFileURL(dist).href)) as Api;
});

const PKG: Record<CanonicalServerName, string> = {
  "iris-dev-mcp": "@iris-mcp/dev",
  "iris-admin-mcp": "@iris-mcp/admin",
  "iris-ops-mcp": "@iris-mcp/ops",
  "iris-interop-mcp": "@iris-mcp/interop",
  "iris-data-mcp": "@iris-mcp/data",
  "iris-mcp-all": "@iris-mcp/all",
};

function canonicalEntry(name: CanonicalServerName): CanonicalEntry {
  return { name, command: "npx", args: ["-y", PKG[name]], env: { IRIS_NAMESPACE: "HSCUSTOM" } };
}

function adapterOf(id: string): ClientAdapter {
  const adapter = api.CLIENT_ADAPTERS[id];
  if (!adapter) throw new Error(`registry missing ${id}`);
  return adapter;
}

interface Sandbox {
  root: string;
  ctx: EngineHostContext;
}

const sandboxes: string[] = [];

function makeSandbox(): Sandbox {
  const root = mkdtempSync(path.join(tmpdir(), "iris-cc-qa-"));
  sandboxes.push(root);
  const homeDir = path.join(root, "home");
  const projectDir = path.join(root, "proj");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  // platform "linux" exercises posix template resolution; the engine joins
  // with posix separators, which the real fs accepts on every host OS.
  const ctx: EngineHostContext = {
    platform: "linux",
    env: {},
    homeDir,
    projectDir,
    stateDir: path.join(root, "state"),
  };
  return { root, ctx };
}

afterEach(() => {
  while (sandboxes.length > 0) {
    const dir = sandboxes.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** Seed a client config into the sandbox at its API-resolved scope path. */
function seedConfig(ctx: EngineHostContext, clientId: string, scope: ClientScope, content: string): string {
  const resolved = api.resolveScopePath(adapterOf(clientId), scope, ctx);
  if (resolved === null) throw new Error(`cannot resolve ${clientId}/${scope}`);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, content, "utf8");
  return resolved;
}

function stateJsonPath(ctx: EngineHostContext): string {
  return path.join(ctx.stateDir ?? "", "state.json");
}

function readStateJson(ctx: EngineHostContext): { entries: Array<Record<string, unknown>>; stashes: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync(stateJsonPath(ctx), "utf8")) as { entries: Array<Record<string, unknown>>; stashes: Array<Record<string, unknown>> };
}

function backupNames(ctx: EngineHostContext, client: string, scope: ClientScope): string[] {
  const dir = api.backupDir(ctx.stateDir ?? "", client, scope, "linux");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

/** The status-matrix row state for one server at one client scope. */
function statusRow(ctx: EngineHostContext, clientId: string, scope: ClientScope, server: CanonicalServerName): string {
  const report = api.status(ctx, api.REAL_STATUS_FS);
  const client = report.clients.find((c) => c.client === clientId);
  if (!client) throw new Error(`${clientId} not detected in the sandbox`);
  const scopeStatus = client.scopes.find((s) => s.scope === scope);
  if (!scopeStatus) throw new Error(`${clientId} has no ${scope} scope`);
  const row = scopeStatus.servers.find((s) => s.server === server);
  if (!row) throw new Error(`${clientId}/${scope} has no row for ${server}`);
  return row.state;
}

describe("lifecycle chains over the built dist (real fs sandbox HOMEs)", () => {
  it("claude-code (JSON stash): apply → status flips → disable → enable byte-exact → remove == initial", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const initial = readFileSync(cfg, "utf8");
    expect(statusRow(ctx, "claude-code", "user", "iris-ops-mcp")).toBe("absent");

    const applied = api.apply(ctx, "claude-code", "user", canonicalEntry("iris-ops-mcp"));
    expect(applied.ok).toBe(true);
    expect(applied.mechanism).toBe("add");
    const afterApply = readFileSync(cfg, "utf8");
    expect(afterApply).not.toBe(initial);
    expect(statusRow(ctx, "claude-code", "user", "iris-ops-mcp")).toBe("present-enabled");

    const disabled = api.disable(ctx, "claude-code", "user", "iris-ops-mcp");
    expect(disabled.ok).toBe(true);
    expect(disabled.mechanism).toBe("stash-remove");
    // A stash client's disabled entry is ABSENT from the client's view.
    expect(statusRow(ctx, "claude-code", "user", "iris-ops-mcp")).toBe("absent");
    expect(readStateJson(ctx).stashes).toHaveLength(1);

    const enabled = api.enable(ctx, "claude-code", "user", "iris-ops-mcp");
    expect(enabled.ok).toBe(true);
    expect(enabled.mechanism).toBe("stash-add");
    expect(readFileSync(cfg, "utf8")).toBe(afterApply);
    expect(statusRow(ctx, "claude-code", "user", "iris-ops-mcp")).toBe("present-enabled");

    const removed = api.remove(ctx, "claude-code", "user", "iris-ops-mcp");
    expect(removed.ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(initial);
    // The ownership ledger and the foreign entry: record dropped, github-mcp intact.
    expect(readStateJson(ctx).entries).toHaveLength(0);
    expect(initial).toContain("github-mcp");
    expect(readFileSync(cfg, "utf8")).toContain("ghp_foreignSecretValue123");
  });

  it("claude-code (JSON stash): remove WHILE STASHED purges state — enable cannot resurrect (33.1 review HIGH, dist-level)", () => {
    // Regression pinned at the dist boundary: pre-fix, remove with the entry
    // absent (stashed) returned ok "already in the requested state" but left
    // the stash + ownership records, so a later enable restored the "removed"
    // server (probe-verified against the pre-fix dist).
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const initial = readFileSync(cfg, "utf8");

    expect(api.apply(ctx, "claude-code", "user", canonicalEntry("iris-ops-mcp")).ok).toBe(true);
    expect(api.disable(ctx, "claude-code", "user", "iris-ops-mcp").ok).toBe(true);
    expect(readStateJson(ctx).stashes).toHaveLength(1);

    const removed = api.remove(ctx, "claude-code", "user", "iris-ops-mcp");
    expect(removed.ok).toBe(true);
    expect(removed.changed).toBe(false);
    expect(readStateJson(ctx).stashes).toHaveLength(0);
    expect(readStateJson(ctx).entries).toHaveLength(0);
    expect(readFileSync(cfg, "utf8")).toBe(initial); // post-disable bytes == initial for a stash client

    const zombie = api.enable(ctx, "claude-code", "user", "iris-ops-mcp");
    expect(zombie.ok).toBe(false);
    expect(zombie.reason ?? "").toContain("nothing to enable");
    expect(statusRow(ctx, "claude-code", "user", "iris-ops-mcp")).toBe("absent");
  });

  it("cline (JSON native flag): disable keeps the entry present-disabled; enable/remove round-trip byte-exact", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "cline", "user", readFixture("cline/cline_mcp_settings.json"));
    const initial = readFileSync(cfg, "utf8");

    expect(api.apply(ctx, "cline", "user", canonicalEntry("iris-ops-mcp")).ok).toBe(true);
    const afterApply = readFileSync(cfg, "utf8");
    expect(statusRow(ctx, "cline", "user", "iris-ops-mcp")).toBe("present-enabled");

    const disabled = api.disable(ctx, "cline", "user", "iris-ops-mcp");
    expect(disabled.ok).toBe(true);
    expect(disabled.mechanism).toBe("native-flag");
    // Native-flag: the entry STAYS, flipped — the client-visible row is present-disabled.
    expect(statusRow(ctx, "cline", "user", "iris-ops-mcp")).toBe("present-disabled");
    expect(readStateJson(ctx).stashes).toHaveLength(0);

    expect(api.enable(ctx, "cline", "user", "iris-ops-mcp").ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(afterApply);

    expect(api.remove(ctx, "cline", "user", "iris-ops-mcp").ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(initial);
    expect(readFileSync(cfg, "utf8")).toContain("aws-docs");
  });

  it("codex (TOML native flag): the verified `enabled` flag flips in place; comments + foreign table survive; remove == initial", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "codex", "user", readFixture("codex/config.toml"));
    const initial = readFileSync(cfg, "utf8");

    expect(api.apply(ctx, "codex", "user", canonicalEntry("iris-admin-mcp")).ok).toBe(true);
    const afterApply = readFileSync(cfg, "utf8");
    expect(afterApply).toContain("[mcp_servers.iris-admin-mcp]");
    expect(statusRow(ctx, "codex", "user", "iris-admin-mcp")).toBe("present-enabled");

    expect(api.disable(ctx, "codex", "user", "iris-admin-mcp").ok).toBe(true);
    const afterDisable = readFileSync(cfg, "utf8");
    expect(afterDisable).toContain("enabled = false");
    expect(statusRow(ctx, "codex", "user", "iris-admin-mcp")).toBe("present-disabled");
    // Comments and the foreign table are byte-untouched by the flag flip.
    expect(afterDisable).toContain("# A foreign third-party server (must never be touched).");
    expect(afterDisable).toContain("[mcp_servers.context7]");
    expect(afterDisable).toContain('trust_level = "trusted"');

    expect(api.enable(ctx, "codex", "user", "iris-admin-mcp").ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(afterApply);

    expect(api.remove(ctx, "codex", "user", "iris-admin-mcp").ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(initial);
  });

  it("goose (YAML native flag): full chain round-trips; the builtin foreign extension and its comments survive", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "goose", "user", readFixture("goose/config.yaml"));
    const initial = readFileSync(cfg, "utf8");

    expect(api.apply(ctx, "goose", "user", canonicalEntry("iris-interop-mcp")).ok).toBe(true);
    const afterApply = readFileSync(cfg, "utf8");
    expect(statusRow(ctx, "goose", "user", "iris-interop-mcp")).toBe("present-enabled");

    expect(api.disable(ctx, "goose", "user", "iris-interop-mcp").ok).toBe(true);
    expect(statusRow(ctx, "goose", "user", "iris-interop-mcp")).toBe("present-disabled");
    const afterDisable = readFileSync(cfg, "utf8");
    expect(afterDisable).toContain("# Built-in Goose extension (foreign, must never be touched).");
    expect(afterDisable).toContain("developer:");

    expect(api.enable(ctx, "goose", "user", "iris-interop-mcp").ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(afterApply);

    expect(api.remove(ctx, "goose", "user", "iris-interop-mcp").ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(initial);
  });

  it("vscode (JSONC stash): comments and trailing commas are byte-intact through the whole chain", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "vscode", "user", readFixture("vscode/user.jsonc"));
    const initial = readFileSync(cfg, "utf8");

    expect(api.apply(ctx, "vscode", "user", canonicalEntry("iris-ops-mcp")).ok).toBe(true);
    const afterApply = readFileSync(cfg, "utf8");
    for (const marker of [
      "// VS Code user MCP configuration — comments and trailing commas are legal here.",
      "// A foreign third-party server (must never be touched).",
      '"microsoft-learn"',
      "https://learn.microsoft.com/api/mcp",
    ]) {
      expect(afterApply).toContain(marker);
    }
    expect(statusRow(ctx, "vscode", "user", "iris-ops-mcp")).toBe("present-enabled");

    expect(api.disable(ctx, "vscode", "user", "iris-ops-mcp").ok).toBe(true);
    expect(statusRow(ctx, "vscode", "user", "iris-ops-mcp")).toBe("absent");
    expect(api.enable(ctx, "vscode", "user", "iris-ops-mcp").ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(afterApply);

    expect(api.remove(ctx, "vscode", "user", "iris-ops-mcp").ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(initial);
  });
});

describe("synthesis × engine × status end-to-end", () => {
  it("server-manager mode: synthesizeEntry → apply → the status row flips; no secrets on disk", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const synth = api.synthesizeEntry("iris-ops-mcp", "server-manager", {
      adapter: adapterOf("claude-code"),
      profile: { serverManagerNames: "prod,dr" },
    });
    if (!synth.ok) throw new Error(`synthesis refused: ${synth.reason}`);
    expect(synth.containsSecret).toBe(false);

    const applied = api.apply(ctx, "claude-code", "user", synth.entry);
    expect(applied.ok).toBe(true);
    expect(statusRow(ctx, "claude-code", "user", "iris-ops-mcp")).toBe("present-enabled");
    const onDisk = readFileSync(cfg, "utf8");
    expect(onDisk).toContain('"IRIS_SERVER_MANAGER": "auto"');
    expect(onDisk).toContain('"IRIS_SM_SERVERS": "prod,dr"');
    expect(onDisk).not.toContain("IRIS_PASSWORD");
  });

  it("vscode env-reference: the ${input:} password lands in the entry; the inputs descriptor is returned but NOT merged (the 33.2 seam)", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "vscode", "user", readFixture("vscode/user.jsonc"));
    const synth = api.synthesizeEntry("iris-ops-mcp", "env-reference", { adapter: adapterOf("vscode") });
    if (!synth.ok) throw new Error(`synthesis refused: ${synth.reason}`);
    expect(synth.entry.env?.["IRIS_PASSWORD"]).toBe(`\${input:${api.VSCODE_PASSWORD_INPUT_ID}}`);
    expect(synth.inputs).toEqual([
      {
        id: api.VSCODE_PASSWORD_INPUT_ID,
        type: "promptString",
        description: "IRIS password for iris-ops-mcp",
        password: true,
      },
    ]);

    expect(api.apply(ctx, "vscode", "user", synth.entry).ok).toBe(true);
    expect(statusRow(ctx, "vscode", "user", "iris-ops-mcp")).toBe("present-enabled");
    const onDisk = readFileSync(cfg, "utf8");
    expect(onDisk).toContain('"IRIS_PASSWORD": "${input:iris-password}"');
    // The fixture's single inputs entry is unchanged — merging is the CLI's seam.
    expect(onDisk.match(/"promptString"/g)).toHaveLength(1);
  });

  it("explicit mode: refusal without the typed confirmation writes NOTHING; with it, the ledger marks contains-secret", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const initial = readFileSync(cfg, "utf8");
    const profile = { host: "iris.example.com", port: 52773, username: "svc", namespace: "PROD", password: "p@ss-explicit-1" };

    const refused = api.synthesizeEntry("iris-ops-mcp", "explicit", { adapter: adapterOf("claude-code"), profile });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toContain("confirm");
      // The refusal never echoes the submitted password.
      expect(refused.reason).not.toContain("p@ss-explicit-1");
    }

    const confirmed = api.synthesizeEntry("iris-ops-mcp", "explicit", {
      adapter: adapterOf("claude-code"),
      profile,
      confirm: "iris-ops-mcp",
    });
    if (!confirmed.ok) throw new Error("confirmed synthesis must succeed");
    expect(confirmed.containsSecret).toBe(true);

    const applied = api.apply(ctx, "claude-code", "user", confirmed.entry, { containsSecret: true });
    expect(applied.ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toContain("p@ss-explicit-1");
    const record = readStateJson(ctx).entries.find((e) => e["name"] === "iris-ops-mcp");
    expect(record?.["containsSecret"]).toBe(true);
    expect(statusRow(ctx, "claude-code", "user", "iris-ops-mcp")).toBe("present-enabled");
    expect(initial).not.toContain("p@ss-explicit-1");
  });
});

describe("safety protocol chains (real fs)", () => {
  it("a sabotaged executor mid-flow auto-restores byte-exact, retains the backup, and records NO state", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    expect(api.apply(ctx, "claude-code", "user", canonicalEntry("iris-ops-mcp")).ok).toBe(true);
    const afterFirst = readFileSync(cfg, "utf8");

    // A corrupting writer bug is a REACHABLE state (Rule #54).
    const sabotage: typeof api.executeNativeEdit = () => "{ not valid json at all";
    const failed = api.apply(ctx, "claude-code", "user", canonicalEntry("iris-admin-mcp"), { executeFn: sabotage });
    expect(failed.ok).toBe(false);
    expect(failed.restored).toBe(true);

    expect(readFileSync(cfg, "utf8")).toBe(afterFirst);
    // Two backups on disk (one per apply attempt); the sabotage one held the pre-sabotage bytes.
    expect(backupNames(ctx, "claude-code", "user")).toHaveLength(2);
    // The failed apply left no ownership record behind.
    const state = readStateJson(ctx);
    expect(state.entries.map((e) => e["name"])).toEqual(["iris-ops-mcp"]);
  });

  it("QA-33.1-F1: restore recovers a config that was EXTERNALLY corrupted after apply (the disaster case)", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const initial = readFileSync(cfg, "utf8");
    expect(api.apply(ctx, "claude-code", "user", canonicalEntry("iris-ops-mcp")).ok).toBe(true);

    // The user (or another tool) breaks the file outside the manager.
    writeFileSync(cfg, "{ GARBAGE broken json !!!", "utf8");
    const restored = api.restore(ctx, "claude-code", "user");
    expect(restored.ok).toBe(true);
    // The latest backup is the pre-apply initial content.
    expect(readFileSync(cfg, "utf8")).toBe(initial);
    expect(statusRow(ctx, "claude-code", "user", "iris-dev-mcp")).toBe("present-enabled");

    // The broken bytes were themselves backed up before the overwrite.
    const names = backupNames(ctx, "claude-code", "user");
    expect(names).toHaveLength(2);
    const dir = api.backupDir(ctx.stateDir ?? "", "claude-code", "user", "linux");
    const contents = names.map((n) => readFileSync(path.join(dir, n), "utf8"));
    expect(contents.some((c) => c.includes("GARBAGE"))).toBe(true);
  });

  it("QA-33.1-F2: pre-existing garbage in the backup dir is never picked as a backup", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const initial = readFileSync(cfg, "utf8");
    expect(api.apply(ctx, "claude-code", "user", canonicalEntry("iris-ops-mcp")).ok).toBe(true);

    const dir = api.backupDir(ctx.stateDir ?? "", "claude-code", "user", "linux");
    // Same-basename junk that sorts AFTER every ISO stamp, plus unrelated files.
    writeFileSync(path.join(dir, ".claude.json.zzz-not-a-backup"), '{"mcpServers": {"evil": {"command": "x", "args": []}}}', "utf8");
    writeFileSync(path.join(dir, "notes.txt"), "hello", "utf8");
    writeFileSync(path.join(dir, ".claude.json.old"), "{}", "utf8");

    // The junk stays on disk untouched, but the manager's backup SURFACE sees
    // only its own timestamped backup (mechanical count, Rule #51).
    expect(readdirSync(dir)).toHaveLength(4);
    const listed = api.listBackups(cfg, {
      adapter: adapterOf("claude-code"),
      client: "claude-code",
      scope: "user",
      stateDir: ctx.stateDir ?? "",
      platform: "linux",
    });
    expect(listed).toHaveLength(1);
    const restored = api.restore(ctx, "claude-code", "user");
    expect(restored.ok).toBe(true);
    expect(restored.note ?? "").not.toContain("zzz");
    expect(readFileSync(cfg, "utf8")).toBe(initial);
    expect(readFileSync(cfg, "utf8")).not.toContain("evil");
  });

  it("restore by NAME across a chain: an earlier stage can be brought back after later mutations", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const initial = readFileSync(cfg, "utf8");
    expect(api.apply(ctx, "claude-code", "user", canonicalEntry("iris-ops-mcp")).ok).toBe(true);
    const firstBackup = backupNames(ctx, "claude-code", "user")[0];
    if (!firstBackup) throw new Error("expected a backup after apply");

    expect(api.disable(ctx, "claude-code", "user", "iris-dev-mcp").ok).toBe(true);
    const restored = api.restore(ctx, "claude-code", "user", { backup: firstBackup });
    expect(restored.ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(initial);
    expect(statusRow(ctx, "claude-code", "user", "iris-dev-mcp")).toBe("present-enabled");
  });
});

describe("concurrent scopes sharing a basename (codex user + project config.toml)", () => {
  it("operations and backups stay segregated per scope; nothing cross-contaminates", () => {
    const { ctx } = makeSandbox();
    const userCfg = seedConfig(ctx, "codex", "user", readFixture("codex/config.toml"));
    const projCfg = seedConfig(ctx, "codex", "project", readFixture("codex/config.toml"));
    const userInitial = readFileSync(userCfg, "utf8");
    const projInitial = readFileSync(projCfg, "utf8");

    expect(api.apply(ctx, "codex", "user", canonicalEntry("iris-admin-mcp")).ok).toBe(true);
    expect(api.apply(ctx, "codex", "project", canonicalEntry("iris-interop-mcp")).ok).toBe(true);

    // Two independent backup buckets for two files that share a basename.
    const userBackups = backupNames(ctx, "codex", "user");
    const projBackups = backupNames(ctx, "codex", "project");
    expect(userBackups).toHaveLength(1);
    expect(projBackups).toHaveLength(1);
    expect(userBackups[0]).toMatch(/^config\.toml\.\d{4}-/);
    expect(projBackups[0]).toMatch(/^config\.toml\.\d{4}-/);

    // Disable in the user scope leaves the project file byte-identical.
    expect(api.disable(ctx, "codex", "user", "iris-admin-mcp").ok).toBe(true);
    const userAfterDisable = readFileSync(userCfg, "utf8");
    expect(readFileSync(projCfg, "utf8")).not.toBe(projInitial);
    const projBefore = readFileSync(projCfg, "utf8");
    expect(api.enable(ctx, "codex", "user", "iris-admin-mcp").ok).toBe(true);
    expect(readFileSync(projCfg, "utf8")).toBe(projBefore);

    // Remove in the project scope; restore(user) touches only the user file
    // and restores its LATEST backup — the pre-enable (disabled) state.
    expect(api.remove(ctx, "codex", "project", "iris-interop-mcp").ok).toBe(true);
    expect(readFileSync(projCfg, "utf8")).toBe(projInitial);
    expect(api.restore(ctx, "codex", "user").ok).toBe(true);
    expect(readFileSync(userCfg, "utf8")).toBe(userAfterDisable);
    expect(readFileSync(projCfg, "utf8")).toBe(projInitial);
    expect(readFileSync(userCfg, "utf8")).not.toBe(userInitial);
  });
});

describe("corrupted state.json mid-flow", () => {
  it("an unparseable state.json fails the operation BEFORE any backup or write", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    expect(api.apply(ctx, "claude-code", "user", canonicalEntry("iris-ops-mcp")).ok).toBe(true);
    const afterApply = readFileSync(cfg, "utf8");
    expect(backupNames(ctx, "claude-code", "user")).toHaveLength(1);

    writeFileSync(stateJsonPath(ctx), "{ nope not json", "utf8");
    const result = api.disable(ctx, "claude-code", "user", "iris-ops-mcp");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unparseable");
    // Zero side effects: file byte-identical, no new backup, the broken
    // state.json left for the user to inspect (never silently re-inited).
    expect(readFileSync(cfg, "utf8")).toBe(afterApply);
    expect(backupNames(ctx, "claude-code", "user")).toHaveLength(1);
    expect(readFileSync(stateJsonPath(ctx), "utf8")).toBe("{ nope not json");
  });

  it("a wrongly-shaped state.json (valid JSON, wrong shape) is a typed refusal, not a guess", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const initial = readFileSync(cfg, "utf8");
    mkdirSync(ctx.stateDir ?? "", { recursive: true });
    writeFileSync(stateJsonPath(ctx), JSON.stringify({ something: "else" }), "utf8");

    const result = api.enable(ctx, "claude-code", "user", "iris-dev-mcp");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("shape");
    expect(readFileSync(cfg, "utf8")).toBe(initial);
    expect(backupNames(ctx, "claude-code", "user")).toHaveLength(0);
  });
});

describe("multi-client interleavings in ONE sandbox HOME", () => {
  it("claude-code + cline + windsurf share a state dir; one client's remove never touches another's file or records", () => {
    const { ctx } = makeSandbox();
    const claudeCfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const clineCfg = seedConfig(ctx, "cline", "user", readFixture("cline/cline_mcp_settings.json"));
    const claudeInitial = readFileSync(claudeCfg, "utf8");

    expect(api.apply(ctx, "claude-code", "user", canonicalEntry("iris-ops-mcp")).ok).toBe(true);
    expect(api.disable(ctx, "cline", "user", "iris-admin-mcp").ok).toBe(true);
    // windsurf had no config at all: apply creates the file from an empty document.
    expect(api.apply(ctx, "windsurf", "user", canonicalEntry("iris-data-mcp")).ok).toBe(true);

    // One shared ledger: exactly the two applied entries are manager-recorded
    // (the cline toggle was a canonical-name native flip — no record needed).
    const state = readStateJson(ctx);
    const recorded = state.entries.map((e) => `${e["client"]}/${e["name"]}`).sort();
    expect(recorded).toEqual(["claude-code/iris-ops-mcp", "windsurf/iris-data-mcp"]);

    // Per-client backup buckets (mechanical counts, Rule #51).
    expect(backupNames(ctx, "claude-code", "user")).toHaveLength(1);
    expect(backupNames(ctx, "cline", "user")).toHaveLength(1);
    expect(backupNames(ctx, "windsurf", "user")).toHaveLength(0); // file created: nothing to back up
    expect(backupNames(ctx, "claude-code", "user")[0]).toContain(".claude.json.");
    expect(backupNames(ctx, "cline", "user")[0]).toContain("cline_mcp_settings.json.");

    // Removing claude-code's entry leaves cline's flip and windsurf's file intact.
    expect(api.remove(ctx, "claude-code", "user", "iris-ops-mcp").ok).toBe(true);
    expect(readFileSync(claudeCfg, "utf8")).toBe(claudeInitial);
    const clineParsed = api.readConfigEntries(adapterOf("cline"), readFileSync(clineCfg, "utf8"));
    if (!clineParsed.ok) throw new Error("cline file must parse");
    expect(clineParsed.entries["iris-admin-mcp"]?.["disabled"]).toBe(true);
    expect(readStateJson(ctx).entries.map((e) => e["name"])).toEqual(["iris-data-mcp"]);
    expect(statusRow(ctx, "windsurf", "user", "iris-data-mcp")).toBe("present-enabled");
  });
});

describe("ownership refusal: zero on-disk side effects (real fs)", () => {
  it("enable/disable/remove/apply-update on a foreign name: file byte-identical, NO backups dir, NO state.json", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const initial = readFileSync(cfg, "utf8");

    for (const name of ["github-mcp", "iris-dev-mcp2", "IRIS-DEV-MCP"]) {
      expect(api.disable(ctx, "claude-code", "user", name).ok, `disable ${name}`).toBe(false);
      expect(api.enable(ctx, "claude-code", "user", name).ok, `enable ${name}`).toBe(false);
      expect(api.remove(ctx, "claude-code", "user", name).ok, `remove ${name}`).toBe(false);
    }
    const foreignUpdate = { name: "github-mcp", command: "npx", args: ["-y", "evil"] } as unknown as CanonicalEntry;
    const updated = api.apply(ctx, "claude-code", "user", foreignUpdate);
    expect(updated.ok).toBe(false);
    expect(updated.reason).toContain("outside the iris-mcp namespace");

    expect(readFileSync(cfg, "utf8")).toBe(initial);
    expect(existsSync(path.join(ctx.stateDir ?? "", "backups"))).toBe(false);
    expect(existsSync(stateJsonPath(ctx))).toBe(false);
  });
});

describe("adversarial encodings and values through the engine (real fs)", () => {
  it("CRLF config: the full cline chain re-parses at every stage and remove restores the CRLF initial bytes", () => {
    const { ctx } = makeSandbox();
    const crlf = readFixture("cline/cline_mcp_settings.json").replaceAll("\n", "\r\n");
    const cfg = seedConfig(ctx, "cline", "user", crlf);

    expect(api.apply(ctx, "cline", "user", canonicalEntry("iris-ops-mcp")).ok).toBe(true);
    const afterApply = readFileSync(cfg, "utf8");
    expect(api.readConfigEntries(adapterOf("cline"), afterApply).ok).toBe(true);

    expect(api.disable(ctx, "cline", "user", "iris-ops-mcp").ok).toBe(true);
    expect(api.readConfigEntries(adapterOf("cline"), readFileSync(cfg, "utf8")).ok).toBe(true);

    expect(api.enable(ctx, "cline", "user", "iris-ops-mcp").ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(afterApply);

    expect(api.remove(ctx, "cline", "user", "iris-ops-mcp").ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(crlf);
  });

  it("unicode entry values round-trip through apply → stash-disable → enable byte-exact (and through state.json)", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const entry: CanonicalEntry = {
      name: "iris-ops-mcp",
      command: "npx",
      args: ["-y", "@iris-mcp/ops"],
      env: { IRIS_NOTE: "設定-名前-🔧" },
    };
    expect(api.apply(ctx, "claude-code", "user", entry).ok).toBe(true);
    const afterApply = readFileSync(cfg, "utf8");
    expect(afterApply).toContain("設定-名前-🔧");

    expect(api.disable(ctx, "claude-code", "user", "iris-ops-mcp").ok).toBe(true);
    // The stash record on disk round-trips the unicode exactly.
    const stash = readStateJson(ctx).stashes.find((s) => s["name"] === "iris-ops-mcp");
    const stashEnv = (stash?.["entry"] as Record<string, Record<string, string>> | undefined)?.["env"];
    expect(stashEnv?.["IRIS_NOTE"]).toBe("設定-名前-🔧");

    expect(api.enable(ctx, "claude-code", "user", "iris-ops-mcp").ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(afterApply);
  });

  it("EACCES on the config read: typed refusal, nothing written", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const fs = api.REAL_WRITE_FS;
    const denied: WriteFs = {
      ...fs,
      readFile: (p) => {
        if (p === cfg) throw new Error(`EACCES: permission denied, open '${p}'`);
        return fs.readFile(p);
      },
    };
    const result = api.apply(ctx, "claude-code", "user", canonicalEntry("iris-ops-mcp"), { fs: denied });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("could not read");
    expect(existsSync(stateJsonPath(ctx))).toBe(false);
  });

  it("EACCES on the backup write: refusal BEFORE the config is touched", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const initial = readFileSync(cfg, "utf8");
    const fs = api.REAL_WRITE_FS;
    const denied: WriteFs = {
      ...fs,
      writeFile: (p, content) => {
        if (p.includes(`${path.sep}backups${path.sep}`) || p.includes("/backups/")) {
          throw new Error(`EACCES: permission denied, open '${p}'`);
        }
        fs.writeFile(p, content);
      },
    };
    const result = api.apply(ctx, "claude-code", "user", canonicalEntry("iris-ops-mcp"), { fs: denied });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("could not take a backup");
    expect(readFileSync(cfg, "utf8")).toBe(initial);
    expect(existsSync(stateJsonPath(ctx))).toBe(false);
  });

  it("EACCES on the state dir: the config write still lands and the state failure degrades to a warning", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    const fs = api.REAL_WRITE_FS;
    const stateDir = ctx.stateDir ?? "";
    const denied: WriteFs = {
      ...fs,
      mkdir: (d) => {
        // Fail ONLY the exact state-dir mkdir (the recursive backup-dir mkdir
        // creates it implicitly on the way down, so backups still work).
        if (d === stateDir) throw new Error(`EACCES: permission denied, mkdir '${d}'`);
        fs.mkdir(d);
      },
    };
    const result = api.apply(ctx, "claude-code", "user", canonicalEntry("iris-ops-mcp"), { fs: denied });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.warnings?.some((w) => w.includes("state.json update failed"))).toBe(true);
    // The entry landed in the client config; the ownership record did not.
    const parsed = api.readConfigEntries(adapterOf("claude-code"), readFileSync(cfg, "utf8"));
    if (!parsed.ok) throw new Error("config must parse");
    expect(parsed.entries["iris-ops-mcp"]).toBeDefined();
    expect(existsSync(stateJsonPath(ctx))).toBe(false);
  });
});

describe("state.json round-trips (the on-disk ledger IS the next session's input)", () => {
  it("the spec §3.4 shapes land on disk exactly, and a fresh engine call enables from the stashed record", () => {
    const { ctx } = makeSandbox();
    const cfg = seedConfig(ctx, "claude-code", "user", readFixture("claude-code/user.json"));
    expect(api.apply(ctx, "claude-code", "user", canonicalEntry("iris-ops-mcp")).ok).toBe(true);
    const afterApply = readFileSync(cfg, "utf8");
    expect(api.disable(ctx, "claude-code", "user", "iris-ops-mcp").ok).toBe(true);

    const raw = readStateJson(ctx);
    // Managed-entry record: exact key set.
    expect(raw.entries).toHaveLength(1);
    expect(Object.keys(raw.entries[0] ?? {}).sort()).toEqual(
      ["client", "containsSecret", "createdAt", "name", "scope", "updatedAt"].sort(),
    );
    // Stash record: the spec §3.4 shape, exact key set.
    expect(raw.stashes).toHaveLength(1);
    expect(Object.keys(raw.stashes[0] ?? {}).sort()).toEqual(["client", "disabledAt", "entry", "name", "scope"].sort());
    expect(raw.stashes[0]).toMatchObject({ client: "claude-code", scope: "user", name: "iris-ops-mcp" });

    // A "new session" (the engine is stateless; every call re-reads the disk)
    // enables purely from the persisted record — byte-exact.
    const enabled = api.enable(ctx, "claude-code", "user", "iris-ops-mcp");
    expect(enabled.ok).toBe(true);
    expect(readFileSync(cfg, "utf8")).toBe(afterApply);
    expect(readStateJson(ctx).stashes).toHaveLength(0);
  });
});
