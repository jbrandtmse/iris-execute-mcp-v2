/**
 * Story 33.3 QA — MCP Clients PANEL journeys through the REAL built
 * `iris-mcp-clients` bin (the E2E/edge layer on top of the dev suite).
 *
 * What this file adds beyond the dev tests:
 *
 *   - `clientsEngineRealCli.test.ts` drives the engine WRAPPERS directly;
 *     `clientsPanel.test.ts` drives the panel with a FAKE engine. This file
 *     composes the panel (`createClientsPanelOpener`) with a REAL engine host
 *     built exactly the way `extension.ts` builds it (verbatim composition:
 *     `resolveClientsCli` → `buildClientsCliEnv` → `runClientsCli` with the
 *     production spawn + the typed wrappers — the ONE difference is the
 *     sandbox ambient passed to `buildClientsCliEnv`, the parameter that
 *     exists for exactly this) and drives FULL USER JOURNEYS through the
 *     webview message layer against a sandbox HOME, asserting observable
 *     file effects at every step (Rule #36/#54: real bin, real fs, real
 *     spawn — no subprocess mock anywhere in the journey tests).
 *
 *   - Edge cases at the same tier: hostile persisted-roster shapes through
 *     the memento seam (globalState is hand-editable JSON — every value the
 *     real API can return is legal), restore after EXTERNAL corruption of
 *     the client config, doctor findings rendered, the npx-unavailable
 *     bin-resolution failure surfacing as a typed inline error, and the
 *     explicit-mode secret containment proven against the CLI's REAL
 *     redaction gate (below AND above the length gate).
 *
 *   - The busy-guard re-entrancy proof uses a FAKE deferred engine (the
 *     guard is synchronous panel logic; a real subprocess cannot be paused
 *     deterministically mid-flight) — every fake shape is one the real CLI
 *     emits (captured in clientsView.test.ts's header).
 *
 * **Never fails on a pristine checkout**: an unbuilt client-config dist
 * SKIPS with a logged reason (the clientsEngineRealCli discipline).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyJson,
  availableModes,
  buildClientsCliEnv,
  detectClientsJson,
  diffApplyJson,
  diffApplyText,
  doctorJson,
  resolveClientsCli,
  restoreJson,
  runClientsCli,
  statusMatrixJson,
  toggleJson,
  type ClientsCliCommand,
  type ClientsCliResult,
  type DiffApplyData,
} from "../clientsEngine.js";
import {
  CLIENT_ROSTER_STATE_KEY,
  createClientsPanelOpener,
  type ClientsEngineHost,
  type ClientsPanelDeps,
  type ClientsPanelHandle,
} from "../clientsPanel.js";
import type { ClientsViewMessage } from "../clientsView.js";
import type { LauncherSettings } from "../types.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const CLIENTS_CLI_BIN = path.join(REPO_ROOT, "packages", "client-config", "dist", "cli", "clients-cli.js");
const CLAUDE_FIXTURE = path.join(
  REPO_ROOT, "packages", "client-config", "src", "__tests__", "fixtures", "claude-code", "user.json",
);

const built = existsSync(CLIENTS_CLI_BIN);
const skipReason = built
  ? undefined
  : `packages/client-config/dist/cli/clients-cli.js is not built (run "pnpm turbo run build" first)`;

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

// ── Sandbox HOME (the clients-cli-process.test.ts pattern: os.homedir() /
// %APPDATA% genuinely resolve from the child env, Rule #54) ─────────────

let fixtureRoot: string;
let home: string;
let ambient: Record<string, string | undefined>;

beforeEach(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "clients-panel-e2e-"));
  home = path.join(fixtureRoot, "home");
  mkdirSync(home, { recursive: true });
  ambient = {
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

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function seedClaudeCode(): string {
  const content = readFileSync(CLAUDE_FIXTURE, "utf8");
  writeFileSync(claudeConfigPath(), content);
  return content;
}

const claudeConfigPath = (): string => path.join(home, ".claude.json");
const readConfig = (): string => readFileSync(claudeConfigPath(), "utf8");

// ── The REAL engine host — the extension.ts composition, verbatim ──────

function makeRealEngineHost(
  settingsOverrides: Partial<LauncherSettings> = {},
  ambientOverrides: Record<string, string | undefined> = {},
): ClientsEngineHost {
  const effectiveSettings = settings(settingsOverrides);
  const effectiveAmbient = { ...ambient, ...ambientOverrides };
  const runClientsCommand = async (command: ClientsCliCommand): Promise<ClientsCliResult> => {
    const resolution = await resolveClientsCli(effectiveSettings);
    if (!resolution.ok) {
      return { status: null, stdout: "", stderr: "", spawnError: resolution.error };
    }
    const env = buildClientsCliEnv(effectiveSettings, resolution.target.extraEnv, effectiveAmbient);
    return runClientsCli(resolution.target, command, env);
  };
  return {
    describe: async () => {
      const resolution = await resolveClientsCli(effectiveSettings);
      return resolution.ok
        ? { ok: true as const, mode: resolution.target.mode }
        : { ok: false as const, error: resolution.error };
    },
    detect: () => detectClientsJson(runClientsCommand),
    status: () => statusMatrixJson(runClientsCommand),
    modes: () => availableModes(runClientsCommand),
    diffApply: (args) => diffApplyJson(runClientsCommand, args),
    diffApplyText: (args) => diffApplyText(runClientsCommand, args),
    apply: (args) => applyJson(runClientsCommand, args),
    toggle: (action, args) => toggleJson(runClientsCommand, action, args),
    restore: (args) => restoreJson(runClientsCommand, args),
    doctor: () => doctorJson(runClientsCommand),
  };
}

// ── Panel harness (fake webview handle + real-shaped memento seam) ─────

interface PanelHarness {
  deps: ClientsPanelDeps;
  htmlLog: string[];
  warnings: string[];
  rosterStore: Map<string, unknown>;
  asked: { prompt: string; password?: boolean }[];
  fire(message: ClientsViewMessage): void;
  dispose(): void;
  lastHtml(): string;
  /**
   * Fire a message and wait until the panel has rendered AT LEAST one new
   * HTML document satisfying `predicate` (real-subprocess latency means the
   * fire-and-forget message handler settles many macrotasks later).
   */
  fireAndWait(message: ClientsViewMessage, predicate: (html: string) => boolean, timeoutMs?: number): Promise<string>;
  /** Wait for the CURRENT last HTML to satisfy `predicate` (post-open renders). */
  waitFor(predicate: (html: string) => boolean, timeoutMs?: number): Promise<string>;
}

function makePanelHarness(
  engine: ClientsEngineHost,
  options: { roster?: unknown; askInputAnswers?: (string | undefined)[] } = {},
): PanelHarness {
  const htmlLog: string[] = [];
  const warnings: string[] = [];
  const rosterStore = new Map<string, unknown>();
  if (options.roster !== undefined) rosterStore.set(CLIENT_ROSTER_STATE_KEY, options.roster);
  const answers = [...(options.askInputAnswers ?? [])];
  const asked: { prompt: string; password?: boolean }[] = [];
  let messageListener: ((message: ClientsViewMessage) => void) | undefined;
  let disposeListener: (() => void) | undefined;

  const panel: ClientsPanelHandle = {
    setHtml: (html) => {
      htmlLog.push(html);
    },
    onMessage: (listener) => {
      messageListener = listener;
    },
    onDispose: (listener) => {
      disposeListener = listener;
    },
    reveal: () => undefined,
  };

  const deps: ClientsPanelDeps = {
    engine,
    getClientRoster: () => rosterStore.get(CLIENT_ROSTER_STATE_KEY),
    setClientRoster: (ids) => {
      rosterStore.set(CLIENT_ROSTER_STATE_KEY, ids);
      return Promise.resolve();
    },
    askInput: (inputOptions) => {
      asked.push({ prompt: inputOptions.prompt, password: inputOptions.password });
      return Promise.resolve(answers.shift());
    },
    createPanel: () => panel,
    showWarning: (message) => warnings.push(message),
    nonce: () => "TEST-NONCE",
  };

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  const harness: PanelHarness = {
    deps,
    htmlLog,
    warnings,
    rosterStore,
    asked,
    fire: (message) => messageListener?.(message),
    dispose: () => disposeListener?.(),
    lastHtml: () => htmlLog.at(-1) ?? "",
    async fireAndWait(message, predicate, timeoutMs = 60000) {
      const before = htmlLog.length;
      messageListener?.(message);
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (htmlLog.length > before && predicate(harness.lastHtml())) return harness.lastHtml();
        if (Date.now() > deadline) {
          throw new Error(
            `timed out waiting for the panel after ${JSON.stringify(message)} — ` +
              `last HTML (first 800 chars): ${harness.lastHtml().slice(0, 800)}`,
          );
        }
        await sleep(25);
      }
    },
    async waitFor(predicate, timeoutMs = 60000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (predicate(harness.lastHtml())) return harness.lastHtml();
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for the panel — last HTML (first 800 chars): ${harness.lastHtml().slice(0, 800)}`);
        }
        await sleep(25);
      }
    },
  };
  return harness;
}

/** Open the panel and wait for the first REAL roster render. */
async function openPanel(harness: PanelHarness): Promise<string> {
  const open = createClientsPanelOpener(harness.deps);
  await open(); // the opener's own refresh is awaited inside
  return harness.waitFor((html) => html.includes("Detected clients"));
}

function skipAll(ctx: { skip: () => void }, label: string): boolean {
  if (!skipReason) return false;
  // eslint-disable-next-line no-console
  console.log(`[SKIP] clients panel real-CLI journeys (${label}): ${skipReason}`);
  ctx.skip();
  return true;
}

// ════════════════════════════════════════════════════════════════════
// The journeys.
// ════════════════════════════════════════════════════════════════════

describe("Story 33.3 QA — panel journeys through the REAL built CLI (E2E layer)", () => {
  it(
    "JOURNEY: open → roster select → apply iris-dev-mcp (env-reference) → file contains the entry → disable → stashed → enable → present — restart hint rendered after EVERY write; third-party entry untouched and rendered read-only; undetected collapsed; Pi row",
    async (ctx) => {
      if (skipAll(ctx, "full journey")) return;
      seedClaudeCode();
      const harness = makePanelHarness(makeRealEngineHost());

      // Open: the REAL detection render — roster default-selected, Pi info
      // row, undetected collapsed in <details>, engine transparency line.
      let html = await openPanel(harness);
      expect(html).toContain("Detected clients (1 of 13)");
      expect(html).toContain("Claude Code");
      expect(html).not.toContain("not MCP-capable"); // dispositions section removed (2026-07-28 lead decision)
      expect(html).toContain("local build");
      expect(html).toContain("<details><summary>Not detected ("); // collapsed, never expanded rows
      // Default roster: claude-code checked.
      expect(html).toContain(`&quot;toggleClient&quot;,&quot;client&quot;:&quot;claude-code&quot;}' checked`);

      // Expand the client: the matrix shows every canonical row absent.
      html = await harness.fireAndWait({ type: "activateClient", client: "claude-code" }, (h) =>
        h.includes("iris-dev-mcp"),
      );
      expect(html).toContain('<span class="badge absent">absent</span>');
      // Third-party entries: read-only names — and NEVER a toggle target.
      expect(html).toContain("Third-party entries (read-only, names only");
      expect(html).toContain("github-mcp");
      expect(html).not.toContain('&quot;stageToggle&quot;,&quot;client&quot;:&quot;claude-code&quot;,&quot;action&quot;:&quot;disable&quot;,&quot;server&quot;:&quot;github-mcp&quot;');

      // Stage the apply for iris-dev-mcp and preview it — NOTHING is written.
      await harness.fireAndWait({ type: "toggleApplyServer", client: "claude-code", server: "iris-dev-mcp" }, (h) =>
        h.includes("iris-dev-mcp"),
      );
      const beforePreview = readConfig();
      html = await harness.fireAndWait({ type: "previewApply", client: "claude-code" }, (h) =>
        h.includes("Pending apply"),
      );
      expect(html).toContain("APPLY iris-dev-mcp"); // the CLI's real diff render
      expect(readConfig()).toBe(beforePreview); // preview wrote NOTHING

      // Confirm: the write lands and the restart hint renders.
      html = await harness.fireAndWait({ type: "confirmPending" }, (h) =>
        h.includes("Restart Claude Code") && !h.includes("Pending apply"),
      );
      expect(readConfig()).toContain('"iris-dev-mcp"');
      expect(html).toContain('<span class="badge enabled">enabled</span>'); // refreshed matrix
      expect(harness.warnings).toEqual([]);

      // Disable: staged → confirmed → the entry is stashed (absent), hint again.
      html = await harness.fireAndWait(
        { type: "stageToggle", client: "claude-code", action: "disable", server: "iris-dev-mcp" },
        (h) => h.includes("Pending disable"),
      );
      html = await harness.fireAndWait({ type: "confirmPending" }, (h) => !h.includes("Pending disable"));
      expect(html).toContain("Restart Claude Code");
      expect(readConfig()).not.toContain('"iris-dev-mcp"');
      expect(html).toContain('<span class="badge absent">absent</span>');

      // Enable: spliced back from the stash, hint again.
      await harness.fireAndWait(
        { type: "stageToggle", client: "claude-code", action: "enable", server: "iris-dev-mcp" },
        (h) => h.includes("Pending enable"),
      );
      html = await harness.fireAndWait({ type: "confirmPending" }, (h) => !h.includes("Pending enable"));
      expect(html).toContain("Restart Claude Code");
      expect(readConfig()).toContain('"iris-dev-mcp"');
      expect(html).toContain('<span class="badge enabled">enabled</span>');

      // The third-party entry survived EVERY write byte-intact.
      expect(readConfig()).toContain('"github-mcp"');
      expect(harness.warnings).toEqual([]);
    },
    180000,
  );

  it(
    "EDGE: hostile persisted-roster shapes through the memento seam round-trip safely (a non-array falls back to all-detected; junk entries are filtered and forgotten at the next toggle)",
    async (ctx) => {
      if (skipAll(ctx, "hostile roster")) return;
      seedClaudeCode();

      // (a) A non-ARRAY stored value (globalState is hand-editable JSON — the
      // real API returns whatever was written, Rule #54): the panel falls
      // back to the all-detected default, no crash.
      const nonArray = makePanelHarness(makeRealEngineHost(), { roster: "claude-code" });
      let html = await openPanel(nonArray);
      expect(html).toContain("Detected clients (1 of 13)");
      expect(html).toContain(`&quot;toggleClient&quot;,&quot;client&quot;:&quot;claude-code&quot;}' checked`);

      // (b) A mixed array (numbers, null, empty strings, unknown ids — every
      // one a value globalState can genuinely hold after a hand edit): only
      // the real detected id survives; the junk never renders…
      const junk = makePanelHarness(makeRealEngineHost(), {
        roster: ["claude-code", 42, null, "", "ghost-client"],
      });
      html = await openPanel(junk);
      expect(html).toContain(`&quot;toggleClient&quot;,&quot;client&quot;:&quot;claude-code&quot;}' checked`);
      expect(html).not.toContain("ghost-client");

      // …and the next toggle persists the SANITIZED effective selection —
      // the junk is forgotten (the documented roster-repair behavior).
      await junk.fireAndWait({ type: "toggleClient", client: "claude-code" }, (h) =>
        !h.includes(`&quot;toggleClient&quot;,&quot;client&quot;:&quot;claude-code&quot;}' checked`),
      );
      expect(junk.rosterStore.get(CLIENT_ROSTER_STATE_KEY)).toEqual([]);

      // (c) Round-trip: dispose + reopen through a FRESH opener over the SAME
      // memento — the persisted (empty) selection wins over the default.
      await junk.fireAndWait({ type: "toggleClient", client: "claude-code" }, (h) =>
        h.includes(`&quot;toggleClient&quot;,&quot;client&quot;:&quot;claude-code&quot;}' checked`),
      );
      expect(junk.rosterStore.get(CLIENT_ROSTER_STATE_KEY)).toEqual(["claude-code"]);
      junk.dispose();
      const reopen = createClientsPanelOpener(junk.deps);
      await reopen();
      html = await junk.waitFor((h) => h.includes("Detected clients"));
      expect(html).toContain(`&quot;toggleClient&quot;,&quot;client&quot;:&quot;claude-code&quot;}' checked`);
    },
    180000,
  );

  it(
    "EDGE: restore after EXTERNAL corruption — the status banner shows UNPARSEABLE, then the staged restore rolls the file back to the last backup's bytes",
    async (ctx) => {
      if (skipAll(ctx, "restore after corruption")) return;
      const original = seedClaudeCode();
      const harness = makePanelHarness(makeRealEngineHost());

      // Apply iris-admin-mcp (a backup of the original bytes is taken).
      let html = await openPanel(harness);
      await harness.fireAndWait({ type: "activateClient", client: "claude-code" }, (h) => h.includes("iris-admin-mcp"));
      await harness.fireAndWait({ type: "toggleApplyServer", client: "claude-code", server: "iris-admin-mcp" }, (h) =>
        h.includes("iris-admin-mcp"),
      );
      await harness.fireAndWait({ type: "previewApply", client: "claude-code" }, (h) => h.includes("Pending apply"));
      await harness.fireAndWait({ type: "confirmPending" }, (h) => !h.includes("Pending apply"));
      expect(readConfig()).toContain('"iris-admin-mcp"');

      // External corruption: another tool/hand edit mangles the file.
      writeFileSync(claudeConfigPath(), "{ this is not json at all {{{");

      // Refresh: the UNPARSEABLE banner renders (the CLI's own status row).
      html = await harness.fireAndWait({ type: "refresh" }, (h) => h.includes("UNPARSEABLE"));
      expect(html).toContain("Every write refuses until it is repaired or restored");

      // Restore: staged → confirmed → the file rolls back to the pre-apply
      // backup's bytes — the corruption is repaired from the UI.
      await harness.fireAndWait({ type: "stageRestore", client: "claude-code" }, (h) =>
        h.includes("Pending restore"),
      );
      html = await harness.fireAndWait({ type: "confirmPending" }, (h) => !h.includes("Pending restore"));
      expect(html).toContain("Restart Claude Code");
      expect(readConfig()).toBe(original);
      // The refreshed matrix renders again (no longer unparseable).
      expect(html).not.toContain("UNPARSEABLE");
    },
    180000,
  );

  it(
    "EDGE: doctor findings are rendered through the panel (an env-reference entry with IRIS_PASSWORD unresolved in the sandbox is a REAL finding row)",
    async (ctx) => {
      if (skipAll(ctx, "doctor findings")) return;
      seedClaudeCode();
      const harness = makePanelHarness(makeRealEngineHost());

      // Apply an env-reference entry — its ${IRIS_PASSWORD} reference cannot
      // resolve in the sandbox ambient, so doctor MUST flag it (the real
      // finding the containment test asserts at the wrapper tier).
      await openPanel(harness);
      await harness.fireAndWait({ type: "activateClient", client: "claude-code" }, (h) => h.includes("iris-dev-mcp"));
      await harness.fireAndWait({ type: "toggleApplyServer", client: "claude-code", server: "iris-dev-mcp" }, (h) =>
        h.includes("iris-dev-mcp"),
      );
      await harness.fireAndWait({ type: "previewApply", client: "claude-code" }, (h) => h.includes("Pending apply"));
      await harness.fireAndWait({ type: "confirmPending" }, (h) => !h.includes("Pending apply"));

      const html = await harness.fireAndWait({ type: "runDoctor" }, (h) => h.includes("finding(s)."));
      expect(html).toContain("env-references");
      expect(html).toContain("IRIS_PASSWORD");
      expect(html).not.toContain("All checks passed");
    },
    180000,
  );

  it(
    "EDGE: explicit mode ABOVE the redaction gate — the preview masks the secret, the webview NEVER renders it, and the write lands the literal in the config file (the CLI's REAL redaction, not a fake)",
    async (ctx) => {
      if (skipAll(ctx, "explicit above gate")) return;
      seedClaudeCode();
      const SECRET = "qa3-ExplicitSecret-above-gate-9f3c";
      const harness = makePanelHarness(makeRealEngineHost(), {
        askInputAnswers: ["iris-dev-mcp", SECRET],
      });

      await openPanel(harness);
      await harness.fireAndWait({ type: "activateClient", client: "claude-code" }, (h) => h.includes("iris-dev-mcp"));
      await harness.fireAndWait({ type: "setMode", client: "claude-code", mode: "explicit" }, (h) =>
        h.includes('<option value="explicit" selected>'),
      );
      await harness.fireAndWait({ type: "toggleApplyServer", client: "claude-code", server: "iris-dev-mcp" }, (h) =>
        h.includes("iris-dev-mcp"),
      );

      // The typed confirmation (plain) then the password (hidden).
      const html = await harness.fireAndWait({ type: "previewApply", client: "claude-code" }, (h) =>
        h.includes("Pending apply"),
      );
      expect(harness.asked).toHaveLength(2);
      expect(harness.asked[0]?.password).not.toBe(true);
      expect(harness.asked[1]?.password).toBe(true);
      // The CLI's real redacted render: masked, never the literal.
      expect(html).toContain("********");
      expect(html).not.toContain(SECRET);
      expect(readConfig()).not.toContain(SECRET); // preview wrote NOTHING

      await harness.fireAndWait({ type: "confirmPending" }, (h) => !h.includes("Pending apply"));
      // The write landed the literal password in the CLIENT CONFIG (that is
      // explicit mode's whole point) — while no rendered HTML ever held it.
      expect(readConfig()).toContain(SECRET);
      for (const rendered of harness.htmlLog) {
        expect(rendered).not.toContain(SECRET);
      }
    },
    180000,
  );

  it(
    "EDGE: explicit mode BELOW the redaction gate — the preview is WITHHELD entirely (the length gate), the secret never renders, and the write still lands it",
    async (ctx) => {
      if (skipAll(ctx, "explicit below gate")) return;
      seedClaudeCode();
      const SECRET = "pw123"; // < the CLI's SECRET_MIN_REDACTION_LENGTH
      const harness = makePanelHarness(makeRealEngineHost(), {
        askInputAnswers: ["iris-dev-mcp", SECRET],
      });

      await openPanel(harness);
      await harness.fireAndWait({ type: "activateClient", client: "claude-code" }, (h) => h.includes("iris-dev-mcp"));
      await harness.fireAndWait({ type: "setMode", client: "claude-code", mode: "explicit" }, (h) =>
        h.includes('<option value="explicit" selected>'),
      );
      await harness.fireAndWait({ type: "toggleApplyServer", client: "claude-code", server: "iris-dev-mcp" }, (h) =>
        h.includes("iris-dev-mcp"),
      );
      const html = await harness.fireAndWait({ type: "previewApply", client: "claude-code" }, (h) =>
        h.includes("Pending apply"),
      );
      expect(html).toContain("(render withheld");
      expect(html).not.toContain(SECRET);

      await harness.fireAndWait({ type: "confirmPending" }, (h) => !h.includes("Pending apply"));
      expect(readConfig()).toContain(SECRET);
      for (const rendered of harness.htmlLog) {
        expect(rendered).not.toContain(SECRET);
      }
    },
    180000,
  );

  it(
    "EDGE: npx unavailable (no developmentRepoPath, PATH without npx) surfaces ONE typed inline error — the panel never crashes and spawns nothing further",
    async (ctx) => {
      if (skipAll(ctx, "npx unavailable")) return;
      seedClaudeCode();
      // PATH points at an empty directory: `npx` cannot be found by whatever
      // shim the platform uses (win32: cmd.exe exits 1 with 'not recognized';
      // POSIX: ENOENT). Both are the engine's typed-failure shapes.
      const emptyBin = path.join(fixtureRoot, "empty-bin");
      mkdirSync(emptyBin, { recursive: true });
      const harness = makePanelHarness(
        makeRealEngineHost({ developmentRepoPath: "" }, { PATH: emptyBin }),
      );

      const open = createClientsPanelOpener(harness.deps);
      await open();
      const html = await harness.waitFor((h) => h.includes('class="banner error"'), 60000);
      expect(html).not.toContain("Detected clients (");
      // The error text is the CLI/spawn's own (never a fabricated message,
      // never an unhandled rejection): non-empty inside the banner.
      expect(html.length).toBeGreaterThan(0);
      expect(harness.warnings).toEqual([]);
    },
    120000,
  );
});

// ════════════════════════════════════════════════════════════════════
// Busy-guard re-entrancy — the ONE test here with a fake engine (the guard
// is synchronous panel logic; a real subprocess cannot be paused
// deterministically mid-flight). Every fake shape is one the real CLI
// emits (capture commands in clientsView.test.ts's header).
// ════════════════════════════════════════════════════════════════════

describe("Story 33.3 QA — busy-guard re-entrancy (deferred fake engine)", () => {
  it("while a preview is in flight, EVERY other gesture (stage, confirm, cancel, refresh, roster toggle) is ignored; once it settles the staged apply confirms normally", async () => {
    const calls: string[] = [];
    let resolveDiff: ((value: { ok: true; data: DiffApplyData }) => void) | undefined;
    const engine: ClientsEngineHost = {
      describe: async () => ({ ok: true, mode: "local" }),
      detect: async () => {
        calls.push("detect");
        return {
          ok: true,
          data: {
            adapterDataVersion: "2026-07-25.2",
            clients: [
              {
                client: "claude-code",
                displayName: "Claude Code",
                detected: true,
                probes: [
                  { kind: "config", scope: "user", path: "C:\\home\\.claude.json", exists: true },
                  { kind: "config", scope: "project", path: "C:\\proj\\.mcp.json", exists: false },
                ],
              },
            ],
            dispositions: [],
            counts: { probed: 13, detected: 1, notDetected: 12, dispositioned: 0 },
          },
        };
      },
      status: async () => {
        calls.push("status");
        return {
          ok: true,
          data: {
            adapterDataVersion: "2026-07-25.2",
            clients: [
              {
                client: "claude-code",
                displayName: "Claude Code",
                scopes: [
                  {
                    scope: "user",
                    path: "C:\\home\\.claude.json",
                    file: "ok",
                    servers: [
                      { server: "iris-dev-mcp", state: "present-enabled" },
                      { server: "iris-admin-mcp", state: "absent" },
                    ],
                    foreign: [],
                  },
                ],
              },
            ],
            undetected: [],
            counts: { detected: 1, undetected: 12, managedEntries: 1 },
          },
        };
      },
      modes: async () => ({ ok: true, data: ["env-reference", "explicit"] }),
      diffApply: () => {
        calls.push("diffApply");
        return new Promise((resolvePromise) => {
          resolveDiff = resolvePromise;
        });
      },
      diffApplyText: async () => ({ ok: false, error: "not used in this test" }),
      apply: async () => {
        calls.push("apply");
        return {
          ok: true,
          data: {
            client: "claude-code",
            scope: "user",
            mode: "env-reference",
            changed: 1,
            inputsMerged: [],
            results: [],
            restartHint: "Restart Claude Code (or start a new session) for MCP changes to take effect.",
          },
        };
      },
      toggle: async () => {
        calls.push("toggle");
        return { ok: false, error: "busy-guard violated: toggle ran during an in-flight preview" };
      },
      restore: async () => {
        calls.push("restore");
        return { ok: false, error: "busy-guard violated: restore ran during an in-flight preview" };
      },
      doctor: async () => {
        calls.push("doctor");
        return { ok: false, error: "busy-guard violated: doctor ran during an in-flight preview" };
      },
    };

    const harness = makePanelHarness(engine);
    await openPanel(harness);
    await harness.fireAndWait({ type: "activateClient", client: "claude-code" }, (h) => h.includes("iris-admin-mcp"));
    await harness.fireAndWait({ type: "toggleApplyServer", client: "claude-code", server: "iris-admin-mcp" }, (h) =>
      h.includes("iris-admin-mcp"),
    );

    // The preview goes in flight and NEVER settles (until we resolve it).
    harness.fire({ type: "previewApply", client: "claude-code" });
    await harness.waitFor(() => calls.includes("diffApply"));

    // Every mid-flight gesture is busy-guarded: none stages, none runs.
    harness.fire({ type: "stageToggle", client: "claude-code", action: "disable", server: "iris-dev-mcp" });
    harness.fire({ type: "stageRestore", client: "claude-code" });
    harness.fire({ type: "confirmPending" });
    harness.fire({ type: "cancelPending" });
    harness.fire({ type: "refresh" });
    harness.fire({ type: "toggleClient", client: "claude-code" });
    harness.fire({ type: "runDoctor" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));

    expect(calls).toEqual(["detect", "status", "diffApply"]);
    expect(harness.lastHtml()).not.toContain("Pending");
    expect(harness.rosterStore.get(CLIENT_ROSTER_STATE_KEY)).toBeUndefined(); // toggle ignored

    // Let the preview land: the apply stages and confirms normally.
    resolveDiff?.({
      ok: true,
      data: {
        client: "claude-code",
        scope: "user",
        mode: "env-reference",
        servers: [
          {
            server: "iris-admin-mcp",
            mechanism: "add",
            text: 'APPLY iris-admin-mcp → Claude Code (user scope, json, root key "mcpServers")\nAdd entry "iris-admin-mcp".',
            missingInputIds: [],
          },
        ],
      },
    });
    await harness.waitFor((h) => h.includes("Pending apply"));
    const html = await harness.fireAndWait({ type: "confirmPending" }, (h) => !h.includes("Pending apply"));
    expect(calls).toContain("apply");
    expect(html).toContain("Restart Claude Code");
  });
});
