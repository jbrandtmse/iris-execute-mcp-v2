/**
 * Story 33.3 — clients engine subprocess E2E through the REAL built
 * `iris-mcp-clients` bin (Integration AC 33.3-I1; no mock of the subprocess
 * layer): `clientsEngine.ts`'s own resolution/env/argv/spawn functions drive
 * the BUILT `packages/client-config/dist/cli/clients-cli.js` exactly as the
 * panel's extension.ts engine host composes them (`resolveClientsCli` →
 * `buildClientsCliEnv` → `runClientsCli` with the production spawn), against
 * a real-filesystem SANDBOX HOME (the clients-cli-process.test.ts pattern,
 * Rule #54: `os.homedir()`/`%APPDATA%` genuinely resolve from the child env).
 *
 * What these tests prove that the injected-fake unit suite cannot:
 *
 *   1. **Observable file effects** (I1's real-runtime bar): enable → the
 *      config contains the entry; disable → absent (stashed); remove → the
 *      config is byte-equal the planted fixture.
 *   2. **Exit-code mapping**: usage error (exit 2, plain text) and engine
 *      refusal (exit 1, ok:false envelope) both surface as one inline error
 *      string through the typed wrappers.
 *   3. **Malformed-config refusal**: the CLI's own unparseable-file error
 *      text surfaces and the file's bytes are untouched.
 *   4. **Containment at the real process boundary**: ambient
 *      `IRIS_GOVERNANCE_FILE` / `IRIS_SERVER_MANAGER` / `IRIS_PASSWORD` in the
 *      extension-host environment NEVER reach the CLI; the ONE extension-
 *      owned re-add (`IRIS_GOVERNANCE_FILE` from
 *      `irisMcpLauncher.governanceFile`) does.
 *   5. **The Story-33.3 sanctioned additive**: `detect --json` carries the
 *      `dispositions` array (Pi `excluded-not-mcp-capable` + roadmap rows).
 *
 * **Never fails on a pristine checkout**: an unbuilt client-config dist SKIPS
 * with a logged reason (mirrors the iris-mcp-all process gates).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyJson,
  availableModes,
  buildClientsCliEnv,
  detectClientsJson,
  doctorJson,
  resolveClientsCli,
  restoreJson,
  runClientsCli,
  statusMatrixJson,
  toggleJson,
  type ClientsCliCommand,
  type ClientsCliResult,
  type ClientsCliTarget,
  type DetectData,
  type StatusData,
} from "../clientsEngine.js";
import type { LauncherSettings } from "../types.js";

// src/__tests__ → repo root is four levels up (the extension sits OUTSIDE the
// pnpm workspace but inside the monorepo).
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const CLIENTS_CLI_BIN = path.join(REPO_ROOT, "packages", "client-config", "dist", "cli", "clients-cli.js");
const FIXTURES = path.join(REPO_ROOT, "packages", "client-config", "src", "__tests__", "fixtures");

function settings(overrides: Partial<LauncherSettings> = {}): LauncherSettings {
  return {
    servers: [],
    packages: ["dev"],
    namespace: "HSCUSTOM",
    combineProfiles: false,
    developmentRepoPath: REPO_ROOT,
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

let skipReason: string | undefined;
let target: ClientsCliTarget;
let fixtureRoot: string;
let home: string;
let sandboxAmbient: Record<string, string | undefined>;

/** A run fn bound to the sandbox ambient (+ optional ambient/scripted overrides) — the same composition extension.ts uses. */
function runInSandbox(
  settingsOverrides: Partial<LauncherSettings> = {},
  ambientOverrides: Record<string, string | undefined> = {},
): (command: ClientsCliCommand) => Promise<ClientsCliResult> {
  const effectiveSettings = settings(settingsOverrides);
  const env = buildClientsCliEnv(effectiveSettings, target.extraEnv, { ...sandboxAmbient, ...ambientOverrides });
  return (command) => runClientsCli(target, command, env);
}

beforeAll(async () => {
  if (!existsSync(CLIENTS_CLI_BIN)) {
    skipReason = `packages/client-config/dist/cli/clients-cli.js is not built (run "pnpm turbo run build" first). Looked at: ${CLIENTS_CLI_BIN}`;
    return;
  }
  const resolution = await resolveClientsCli(settings());
  if (!resolution.ok) {
    skipReason = `the engine's local-mode resolution failed against a built checkout: ${resolution.error}`;
    return;
  }
  expect(resolution.target.mode).toBe("local");
  expect(resolution.target.command).toBe(process.execPath);
  expect(resolution.target.baseArgs).toEqual([CLIENTS_CLI_BIN]);
  target = resolution.target;

  fixtureRoot = mkdtempSync(path.join(tmpdir(), "clients-engine-e2e-"));
  home = path.join(fixtureRoot, "home");
  mkdirSync(home, { recursive: true });
  // Built from scratch: no inherited IRIS_*/IRIS_SM_* leaks; the home
  // overrides are exactly the variables real Node resolves (Rule #54).
  sandboxAmbient = {
    PATH: process.env.PATH ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    windir: process.env.windir ?? "",
    TEMP: process.env.TEMP ?? "",
    TMP: process.env.TMP ?? "",
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
  };
});

afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

function skipIf(ctx: { skip: () => void }, label: string): boolean {
  if (!skipReason) return false;
  // eslint-disable-next-line no-console
  console.log(`[SKIP] clients engine real-CLI e2e (${label}): ${skipReason}`);
  ctx.skip();
  return true;
}

/** Plant the claude-code fixture at its real user-scope path inside the sandbox. */
function seedClaudeCode(fixtureName = "claude-code/user.json"): string {
  const content = readFileSync(path.join(FIXTURES, ...fixtureName.split("/")), "utf8");
  writeFileSync(path.join(home, ".claude.json"), content);
  return content;
}

const claudeConfigPath = (): string => path.join(home, ".claude.json");

/** Fresh sandbox HOME per test that plants fixtures (the state ledger lives under HOME). */
function resetHome(): void {
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
}

describe("Story 33.3 — clients engine subprocess e2e through the REAL built bin (AC 33.3-I1)", () => {
  it(
    "detect --json carries the roster AND the sanctioned dispositions array (Pi not-MCP-capable + roadmap rows)",
    async (ctx) => {
      if (skipIf(ctx, "detect")) return;
      resetHome();
      seedClaudeCode();

      // Capture command (Rule #36):
      //   HOME=<sandbox> node packages/client-config/dist/cli/clients-cli.js detect --json
      const result = await detectClientsJson(runInSandbox());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data: DetectData = result.data;
      expect(data.clients.find((row) => row.client === "claude-code")?.detected).toBe(true);
      expect(data.counts.probed).toBe(data.clients.length);
      expect(data.counts.dispositioned).toBe(data.dispositions?.length);
      const pi = data.dispositions?.find((row) => row.id === "pi");
      expect(pi?.disposition).toBe("excluded-not-mcp-capable");
      expect(pi?.reason).toContain("no built-in MCP support");
      expect(data.dispositions?.some((row) => row.disposition === "roadmap")).toBe(true);
    },
    120000,
  );

  it(
    "apply → disable → enable → remove: OBSERVABLE file effects through the real bin (enable → entry present; disable → stashed/absent; remove → byte-equal original)",
    async (ctx) => {
      if (skipIf(ctx, "lifecycle")) return;
      resetHome();
      const original = seedClaudeCode();

      // apply --yes --json: the entry lands in the real file; the restart hint surfaces.
      const applied = await applyJson(runInSandbox(), {
        client: "claude-code", scope: "user", servers: ["iris-admin-mcp"], mode: "env-reference",
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.data.changed).toBe(1);
      expect(applied.data.restartHint).toContain("Restart Claude Code");
      expect(readFileSync(claudeConfigPath(), "utf8")).toContain('"iris-admin-mcp"');
      expect(readFileSync(claudeConfigPath(), "utf8")).not.toBe(original);

      let status = await statusMatrixJson(runInSandbox());
      expect(status.ok).toBe(true);
      if (!status.ok) return;
      const rowFor = (data: StatusData, server: string): string | undefined =>
        data.clients.find((c) => c.client === "claude-code")
          ?.scopes.flatMap((s) => s.servers)
          .find((row) => row.server === server)?.state;
      expect(rowFor(status.data, "iris-admin-mcp")).toBe("present-enabled");

      // disable → the entry is stashed (absent from the file's status rows); the toggle's restart hint surfaces.
      const disabled = await toggleJson(runInSandbox(), "disable", { client: "claude-code", scope: "user", server: "iris-admin-mcp" });
      expect(disabled.ok).toBe(true);
      if (!disabled.ok) return;
      expect(disabled.data.changed).toBe(true);
      expect(disabled.data.restartHint).toContain("Restart Claude Code");
      status = await statusMatrixJson(runInSandbox());
      expect(status.ok).toBe(true);
      if (!status.ok) return;
      expect(rowFor(status.data, "iris-admin-mcp")).toBe("absent");

      // enable → spliced back from the stash.
      const enabled = await toggleJson(runInSandbox(), "enable", { client: "claude-code", scope: "user", server: "iris-admin-mcp" });
      expect(enabled.ok).toBe(true);
      status = await statusMatrixJson(runInSandbox());
      expect(status.ok).toBe(true);
      if (!status.ok) return;
      expect(rowFor(status.data, "iris-admin-mcp")).toBe("present-enabled");

      // remove → byte-equal the original fixture (the foreign entry untouched throughout).
      const removed = await toggleJson(runInSandbox(), "remove", { client: "claude-code", scope: "user", server: "iris-admin-mcp" });
      expect(removed.ok).toBe(true);
      expect(readFileSync(claudeConfigPath(), "utf8")).toBe(original);

      // restore round-trip: apply again (a backup is taken), then restore rolls back to the pre-apply bytes.
      const reApplied = await applyJson(runInSandbox(), {
        client: "claude-code", scope: "user", servers: ["iris-admin-mcp"], mode: "env-reference",
      });
      expect(reApplied.ok).toBe(true);
      const restored = await restoreJson(runInSandbox(), { client: "claude-code", scope: "user" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      expect(restored.data.restartHint).toContain("Restart Claude Code");
      expect(readFileSync(claudeConfigPath(), "utf8")).toBe(original);
    },
    120000,
  );

  it(
    "exit-code mapping: a usage error (exit 2, plain text, NO envelope) and an engine refusal (exit 1, ok:false envelope) both surface as ONE inline error string",
    async (ctx) => {
      if (skipIf(ctx, "exit codes")) return;
      resetHome();
      seedClaudeCode();

      // Usage error: empty --servers (the CLI's argv validation, exit 2).
      const usage = await runInSandbox()({
        kind: "diff", client: "claude-code", scope: "user", servers: [], mode: "env-reference",
      });
      expect(usage.status).toBe(2);
      expect(usage.stdout.trim()).toBe(""); // usage errors stay plain text on stderr
      expect(usage.stderr).toContain("--servers");

      // The wrapper maps the SAME refusal classes: unknown client (exit 2).
      const unknownClient = await toggleJson(runInSandbox(), "disable", { client: "not-a-client", scope: "user", server: "iris-dev-mcp" });
      expect(unknownClient.ok).toBe(false);
      if (unknownClient.ok) return;
      expect(unknownClient.error).toContain('unknown client "not-a-client"');

      // Engine refusal: disabling the FOREIGN entry (exit 1, ok:false envelope) — bytes untouched.
      const before = readFileSync(claudeConfigPath(), "utf8");
      const refusal = await toggleJson(runInSandbox(), "disable", { client: "claude-code", scope: "user", server: "github-mcp" });
      expect(refusal.ok).toBe(false);
      if (refusal.ok) return;
      expect(refusal.error).toContain('refusing to modify "github-mcp"');
      expect(readFileSync(claudeConfigPath(), "utf8")).toBe(before);
    },
    120000,
  );

  it(
    "a malformed config refuses with the CLI's own error text and the file's bytes are UNTOUCHED",
    async (ctx) => {
      if (skipIf(ctx, "malformed refusal")) return;
      resetHome();
      const broken = seedClaudeCode("malformed/bad.jsonc");

      const applied = await applyJson(runInSandbox(), {
        client: "claude-code", scope: "user", servers: ["iris-admin-mcp"], mode: "env-reference",
      });
      expect(applied.ok).toBe(false);
      if (applied.ok) return;
      // The engine's own parse error text (never a crash, never a fabricated message).
      expect(applied.error.length).toBeGreaterThan(0);
      expect(applied.error).toContain("iris-mcp-clients apply failed");
      expect(readFileSync(claudeConfigPath(), "utf8")).toBe(broken);
    },
    120000,
  );

  it(
    "containment at the real process boundary: ambient IRIS_GOVERNANCE_FILE/IRIS_SERVER_MANAGER/IRIS_PASSWORD NEVER reach the CLI; the extension-owned IRIS_GOVERNANCE_FILE re-add DOES",
    async (ctx) => {
      if (skipIf(ctx, "containment")) return;
      resetHome();
      seedClaudeCode();

      // (a) An ambient IRIS_GOVERNANCE_FILE pointing at a REAL file is
      // scrubbed — governance-file mode stays unavailable …
      const ambientGov = path.join(fixtureRoot, "ambient-gov.json");
      writeFileSync(ambientGov, '{"global": {}}\n');
      const scrubbedModes = await availableModes(runInSandbox({}, { IRIS_GOVERNANCE_FILE: ambientGov, IRIS_SERVER_MANAGER: "auto" }));
      expect(scrubbedModes.ok).toBe(true);
      if (!scrubbedModes.ok) return;
      const scrubbed = scrubbedModes.data;
      // … and an ambient IRIS_SERVER_MANAGER=auto changes NOTHING about the
      // offered modes (equality proof — robust to whatever the workspace
      // discovery legitimately finds from the child's cwd).
      const plainModes = await availableModes(runInSandbox());
      expect(plainModes.ok).toBe(true);
      if (!plainModes.ok) return;
      expect(scrubbed).toEqual(plainModes.data);
      expect(scrubbed).not.toContain("governance-file");

      // (b) The extension-owned re-add: settings.governanceFile →
      // IRIS_GOVERNANCE_FILE reaches the CLI's mode gating.
      const ownedModes = await availableModes(runInSandbox({ governanceFile: ambientGov }));
      expect(ownedModes.ok).toBe(true);
      if (!ownedModes.ok) return;
      expect(ownedModes.data).toContain("governance-file");

      // (c) An ambient IRIS_PASSWORD never reaches doctor's resolvability
      // check: after an env-reference apply, doctor MUST still flag
      // IRIS_PASSWORD as unresolved.
      const applied = await applyJson(runInSandbox({}, { IRIS_PASSWORD: "ambient-secret-never-inherited" }), {
        client: "claude-code", scope: "user", servers: ["iris-admin-mcp"], mode: "env-reference",
      });
      expect(applied.ok).toBe(true);
      const doctor = await doctorJson(runInSandbox({}, { IRIS_PASSWORD: "ambient-secret-never-inherited" }));
      expect(doctor.ok).toBe(true);
      if (!doctor.ok) return;
      expect(doctor.findingsOk).toBe(false);
      expect(
        doctor.data.findings.some((finding) => finding.check === "env-references" && finding.detail.includes("IRIS_PASSWORD")),
      ).toBe(true);
      // … and the ambient secret VALUE never leaks onto the findings surface.
      expect(JSON.stringify(doctor.data)).not.toContain("ambient-secret-never-inherited");
    },
    120000,
  );
});
