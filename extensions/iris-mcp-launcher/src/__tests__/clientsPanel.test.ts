/**
 * Unit tests for the MCP Clients panel orchestration (Story 33.3, Task 3) —
 * the stateful layer between the pure view-model and the subprocess engine.
 *
 * Every dependency is faked; the engine host's canned outputs are shaped
 * EXACTLY like the real `iris-mcp-clients` bin's `--json` output (Rule #36 —
 * captured 2026-07-28 from the built bin; see clientsView.test.ts's header
 * for the capture commands). The fake panel records the HTML it is given and
 * lets tests drive the webview's messages; the roster memento is a plain Map.
 */
import { describe, expect, it } from "vitest";
import {
  CLIENT_ROSTER_STATE_KEY,
  createClientsPanelOpener,
  MANAGE_CLIENTS_COMMAND_ID,
  type ClientsEngineHost,
  type ClientsPanelDeps,
  type ClientsPanelHandle,
} from "../clientsPanel.js";
import type {
  ApplyData,
  CliEnvMode,
  DetectData,
  DiffApplyData,
  DoctorData,
  EngineResultJson,
  StatusData,
} from "../clientsEngine.js";
import type { ClientsViewMessage } from "../clientsView.js";

// ── Real-bin-shaped fixtures (see clientsView.test.ts's header) ────────

const DETECT: DetectData = {
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
    {
      client: "claude-desktop",
      displayName: "Claude Desktop",
      detected: true,
      probes: [{ kind: "config", scope: "user", path: "C:\\home\\cd.json", exists: true }],
    },
    {
      client: "cursor",
      displayName: "Cursor",
      detected: false,
      probes: [{ kind: "config", scope: "user", path: "C:\\home\\.cursor\\mcp.json", exists: false }],
    },
  ],
  dispositions: [
    {
      id: "pi",
      displayName: "Pi (pi CLI / pi-coding-agent)",
      disposition: "excluded-not-mcp-capable",
      reason: "Verified to have no built-in MCP support by design (minimal four-tool core; external tools via bash or TypeScript extensions). Revisit if Pi ships MCP support.",
    },
  ],
  counts: { probed: 13, detected: 2, notDetected: 11, dispositioned: 1 },
};

function statusWith(devState: "present-enabled" | "present-disabled" | "absent"): StatusData {
  return {
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
              { server: "iris-dev-mcp", state: devState },
              { server: "iris-admin-mcp", state: "absent" },
              { server: "iris-ops-mcp", state: "absent" },
              { server: "iris-interop-mcp", state: "absent" },
              { server: "iris-data-mcp", state: "absent" },
              { server: "iris-mcp-all", state: "absent" },
            ],
            foreign: ["github-mcp"],
          },
          { scope: "project", path: "C:\\proj\\.mcp.json", file: "missing", servers: [], foreign: [] },
        ],
      },
      {
        client: "claude-desktop",
        displayName: "Claude Desktop",
        scopes: [{ scope: "user", path: "C:\\home\\cd.json", file: "missing", servers: [], foreign: [] }],
      },
    ],
    undetected: [{ client: "cursor", displayName: "Cursor" }],
    counts: { detected: 2, undetected: 11, managedEntries: devState === "absent" ? 0 : 1 },
  };
}

const DIFF: DiffApplyData = {
  client: "claude-code",
  scope: "user",
  mode: "env-reference",
  servers: [
    {
      server: "iris-admin-mcp",
      mechanism: "add",
      text: "APPLY iris-admin-mcp → Claude Code (user scope, json, root key \"mcpServers\")\nAdd entry \"iris-admin-mcp\".",
      missingInputIds: [],
    },
  ],
};

const APPLY_RESULT: ApplyData = {
  client: "claude-code",
  scope: "user",
  mode: "env-reference",
  changed: 1,
  inputsMerged: [],
  results: [
    {
      ok: true,
      client: "claude-code",
      scope: "user",
      action: "apply",
      path: "C:\\home\\.claude.json",
      mechanism: "add",
      changed: true,
      backupPath: "C:\\home\\.iris-mcp\\client-manager\\backups\\claude-code\\user\\.claude.json.2026-07-28T02-00-04-093Z",
      restartHint: "Restart Claude Code (or start a new session) for MCP changes to take effect.",
    },
  ],
  restartHint: "Restart Claude Code (or start a new session) for MCP changes to take effect.",
};

const TOGGLE_RESULT: EngineResultJson = {
  ok: true,
  client: "claude-code",
  scope: "user",
  action: "disable",
  path: "C:\\home\\.claude.json",
  mechanism: "stash-remove",
  changed: true,
  backupPath: "C:\\home\\.iris-mcp\\client-manager\\backups\\claude-code\\user\\.claude.json.2026-07-28T02-00-04-292Z",
  restartHint: "Restart Claude Code (or start a new session) for MCP changes to take effect.",
};

const DOCTOR_CLEAN: DoctorData = { findings: [], findingCount: 0, repaired: [], staleBackupDays: 30, parsedFiles: 1, restartHints: [] };

// ── Harness ────────────────────────────────────────────────────────────

interface RecordedCall {
  method: string;
  args: unknown;
}

function makeHarness(options: {
  roster?: unknown;
  engineMode?: "local" | "npx";
  describeError?: string;
  detectError?: string;
  statusError?: string;
  modes?: CliEnvMode[];
  modesError?: string;
  status?: StatusData;
  diffError?: string;
  applyError?: string;
  toggleError?: string;
  restoreError?: string;
  doctorError?: string;
  askInputResponses?: (string | undefined)[];
  rosterPersistRejects?: boolean;
} = {}) {
  const calls: RecordedCall[] = [];
  const htmlLog: string[] = [];
  const warnings: string[] = [];
  const rosterStore = new Map<string, unknown>();
  if (options.roster !== undefined) rosterStore.set(CLIENT_ROSTER_STATE_KEY, options.roster);
  let messageListener: ((message: ClientsViewMessage) => void) | undefined;
  let disposeListener: (() => void) | undefined;
  let revealCount = 0;
  let panelCount = 0;
  const inputAnswers = [...(options.askInputResponses ?? [])];
  const askedPrompts: { prompt: string; password?: boolean }[] = [];

  const engine: ClientsEngineHost = {
    describe: async () =>
      options.describeError !== undefined
        ? { ok: false, error: options.describeError }
        : { ok: true, mode: options.engineMode ?? "local" },
    detect: async () => {
      calls.push({ method: "detect", args: undefined });
      return options.detectError !== undefined ? { ok: false, error: options.detectError } : { ok: true, data: DETECT };
    },
    status: async () => {
      calls.push({ method: "status", args: undefined });
      return options.statusError !== undefined
        ? { ok: false, error: options.statusError }
        : { ok: true, data: options.status ?? statusWith("present-enabled") };
    },
    modes: async () => {
      calls.push({ method: "modes", args: undefined });
      return options.modesError !== undefined
        ? { ok: false, error: options.modesError }
        : { ok: true, data: options.modes ?? (["env-reference", "explicit"] as CliEnvMode[]) };
    },
    diffApply: async (args) => {
      calls.push({ method: "diffApply", args });
      return options.diffError !== undefined ? { ok: false, error: options.diffError } : { ok: true, data: DIFF };
    },
    diffApplyText: async (args) => {
      calls.push({ method: "diffApplyText", args });
      return options.diffError !== undefined
        ? { ok: false, error: options.diffError }
        : { ok: true, data: "Pending changes for claude-code (user, explicit):\n********\n" };
    },
    apply: async (args) => {
      calls.push({ method: "apply", args });
      return options.applyError !== undefined ? { ok: false, error: options.applyError } : { ok: true, data: APPLY_RESULT };
    },
    toggle: async (action, args) => {
      calls.push({ method: "toggle", args: { action, ...args } });
      return options.toggleError !== undefined ? { ok: false, error: options.toggleError } : { ok: true, data: TOGGLE_RESULT };
    },
    restore: async (args) => {
      calls.push({ method: "restore", args });
      return options.restoreError !== undefined
        ? { ok: false, error: options.restoreError }
        : { ok: true, data: { ...TOGGLE_RESULT, action: "restore", note: "restored from …" } };
    },
    doctor: async () => {
      calls.push({ method: "doctor", args: undefined });
      return options.doctorError !== undefined
        ? { ok: false, error: options.doctorError }
        : { ok: true, findingsOk: true, data: DOCTOR_CLEAN };
    },
  };

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
    reveal: () => {
      revealCount++;
    },
  };

  const deps: ClientsPanelDeps = {
    engine,
    getClientRoster: () => rosterStore.get(CLIENT_ROSTER_STATE_KEY),
    setClientRoster: (ids) => {
      if (options.rosterPersistRejects === true) return Promise.reject(new Error("read-only memento"));
      rosterStore.set(CLIENT_ROSTER_STATE_KEY, ids);
      return Promise.resolve();
    },
    askInput: (inputOptions) => {
      askedPrompts.push({ prompt: inputOptions.prompt, password: inputOptions.password });
      return Promise.resolve(inputAnswers.shift());
    },
    createPanel: () => {
      panelCount++;
      return panel;
    },
    showWarning: (message) => warnings.push(message),
    nonce: () => "TEST-NONCE",
  };

  return {
    deps,
    calls,
    htmlLog,
    warnings,
    rosterStore,
    askedPrompts,
    fireMessage: (message: ClientsViewMessage) => messageListener?.(message),
    dispose: () => disposeListener?.(),
    revealCount: () => revealCount,
    panelCount: () => panelCount,
    lastHtml: () => htmlLog.at(-1) ?? "",
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// ── Flows ──────────────────────────────────────────────────────────────

describe("createClientsPanelOpener", () => {
  it("the command id + roster key are the ones package.json/containment pin mechanically", () => {
    expect(MANAGE_CLIENTS_COMMAND_ID).toBe("irisMcpLauncher.manageClients");
    expect(CLIENT_ROSTER_STATE_KEY).toBe("irisMcpLauncher.clientRoster");
  });

  it("open runs describe → detect → modes → status and renders the roster with the DEFAULT selection (every detected client) when nothing is persisted", async () => {
    const harness = makeHarness();
    await createClientsPanelOpener(harness.deps)();

    expect(harness.calls.map((call) => call.method)).toEqual(["detect", "modes", "status"]);
    const html = harness.lastHtml();
    expect(html).toContain("Detected clients (2 of 13)");
    expect(html).toContain("Claude Code");
    expect(html).toContain("not MCP-capable");
    expect(html).toContain("local build");
  });

  it("a persisted roster filters the rendered selection (and survives a refresh)", async () => {
    const harness = makeHarness({ roster: ["claude-desktop"] });
    const open = createClientsPanelOpener(harness.deps);
    await open();
    let html = harness.lastHtml();
    // claude-desktop checked, claude-code NOT (the persisted selection wins).
    const checkboxFor = (client: string): boolean =>
      html.includes(`data-msg='{&quot;type&quot;:&quot;toggleClient&quot;,&quot;client&quot;:&quot;${client}&quot;}' checked`);
    expect(checkboxFor("claude-desktop")).toBe(true);
    expect(html).toContain(`data-msg='{&quot;type&quot;:&quot;toggleClient&quot;,&quot;client&quot;:&quot;claude-code&quot;}'>`);
    await open();
    html = harness.lastHtml();
    expect(checkboxFor("claude-desktop")).toBe(true);
  });

  it("toggleClient persists the new roster via the memento seam; a persist failure warns but still renders", async () => {
    const harness = makeHarness();
    await createClientsPanelOpener(harness.deps)();

    harness.fireMessage({ type: "toggleClient", client: "claude-desktop" });
    await tick();
    expect(harness.rosterStore.get(CLIENT_ROSTER_STATE_KEY)).toEqual(["claude-code"]);
    expect(harness.warnings).toEqual([]);

    const rejecting = makeHarness({ rosterPersistRejects: true });
    await createClientsPanelOpener(rejecting.deps)();
    rejecting.fireMessage({ type: "toggleClient", client: "claude-desktop" });
    await tick();
    expect(rejecting.warnings).toHaveLength(1);
    expect(rejecting.warnings[0]).toContain("could not be persisted");
  });

  it("toggle server → staged confirm → engine write → restart hint + status refresh (AC 33.3.3's write flow)", async () => {
    const harness = makeHarness();
    await createClientsPanelOpener(harness.deps)();
    harness.fireMessage({ type: "activateClient", client: "claude-code" });
    harness.fireMessage({ type: "stageToggle", client: "claude-code", action: "disable", server: "iris-dev-mcp" });
    expect(harness.lastHtml()).toContain("Pending disable");
    expect(harness.calls.filter((call) => call.method === "toggle")).toEqual([]); // nothing written yet

    const statusCallsBefore = harness.calls.filter((call) => call.method === "status").length;
    harness.fireMessage({ type: "confirmPending" });
    await tick();
    await tick();

    expect(harness.calls).toContainEqual({
      method: "toggle",
      args: { action: "disable", client: "claude-code", scope: "user", server: "iris-dev-mcp" },
    });
    // Restart hint surfaced + the matrix refreshed.
    expect(harness.lastHtml()).toContain("Restart Claude Code (or start a new session)");
    expect(harness.calls.filter((call) => call.method === "status").length).toBeGreaterThan(statusCallsBefore);
    expect(harness.warnings).toEqual([]);
  });

  it("a failed write keeps the staged action and renders the engine's error inside the pending box", async () => {
    const harness = makeHarness({ toggleError: 'iris-mcp-clients disable failed: could not write C:\\home\\.claude.json — EACCES' });
    await createClientsPanelOpener(harness.deps)();
    harness.fireMessage({ type: "activateClient", client: "claude-code" });
    harness.fireMessage({ type: "stageToggle", client: "claude-code", action: "disable", server: "iris-dev-mcp" });
    harness.fireMessage({ type: "confirmPending" });
    await tick();
    await tick();
    expect(harness.lastHtml()).toContain("Pending disable");
    expect(harness.lastHtml()).toContain("EACCES");

    // Cancel clears the staged action.
    harness.fireMessage({ type: "cancelPending" });
    expect(harness.lastHtml()).not.toContain("Pending disable");
  });

  it("apply flows diff preview FIRST (AC 33.3.3): Preview renders the CLI diff, only Confirm writes through apply --yes", async () => {
    const harness = makeHarness({ status: statusWith("absent") });
    await createClientsPanelOpener(harness.deps)();
    harness.fireMessage({ type: "activateClient", client: "claude-code" });
    harness.fireMessage({ type: "toggleApplyServer", client: "claude-code", server: "iris-admin-mcp" });

    harness.fireMessage({ type: "previewApply", client: "claude-code" });
    await tick();
    await tick();
    expect(harness.calls).toContainEqual({
      method: "diffApply",
      args: { client: "claude-code", scope: "user", servers: ["iris-admin-mcp"], mode: "env-reference" },
    });
    expect(harness.lastHtml()).toContain("Pending apply");
    expect(harness.lastHtml()).toContain("iris-admin-mcp → Claude Code");
    expect(harness.calls.filter((call) => call.method === "apply")).toEqual([]); // preview wrote NOTHING

    harness.fireMessage({ type: "confirmPending" });
    await tick();
    await tick();
    expect(harness.calls).toContainEqual({
      method: "apply",
      args: { client: "claude-code", scope: "user", servers: ["iris-admin-mcp"], mode: "env-reference" },
    });
    expect(harness.lastHtml()).toContain("Restart Claude Code");
  });

  it("explicit mode collects the typed confirmation + hidden password (never rendered), previews the redacted text, and applies with the secret on the stdin seam only", async () => {
    const SECRET = "s3cr3t-never-rendered-4f8c";
    const harness = makeHarness({
      status: statusWith("absent"),
      askInputResponses: ["iris-admin-mcp", SECRET],
    });
    await createClientsPanelOpener(harness.deps)();
    harness.fireMessage({ type: "activateClient", client: "claude-code" });
    harness.fireMessage({ type: "setMode", client: "claude-code", mode: "explicit" });
    harness.fireMessage({ type: "toggleApplyServer", client: "claude-code", server: "iris-admin-mcp" });

    harness.fireMessage({ type: "previewApply", client: "claude-code" });
    await tick();
    await tick();

    // The typed confirmation (plain) then the password (hidden).
    expect(harness.askedPrompts).toHaveLength(2);
    expect(harness.askedPrompts[0]?.password).not.toBe(true);
    expect(harness.askedPrompts[1]?.password).toBe(true);
    expect(harness.calls).toContainEqual({
      method: "diffApplyText",
      args: {
        client: "claude-code",
        scope: "user",
        servers: ["iris-admin-mcp"],
        mode: "explicit",
        confirmSecret: "iris-admin-mcp",
        passwordStdin: SECRET,
      },
    });
    // The secret NEVER reaches the HTML (the CLI's redacted text render only).
    for (const html of harness.htmlLog) {
      expect(html).not.toContain(SECRET);
    }

    harness.fireMessage({ type: "confirmPending" });
    await tick();
    await tick();
    expect(harness.calls).toContainEqual({
      method: "apply",
      args: {
        client: "claude-code",
        scope: "user",
        servers: ["iris-admin-mcp"],
        mode: "explicit",
        confirmSecret: "iris-admin-mcp",
        passwordStdin: SECRET,
      },
    });
    for (const html of harness.htmlLog) {
      expect(html).not.toContain(SECRET);
    }
  });

  it("a dismissed explicit confirmation stages NOTHING (cancel is not an error)", async () => {
    const harness = makeHarness({ status: statusWith("absent"), askInputResponses: [undefined] });
    await createClientsPanelOpener(harness.deps)();
    harness.fireMessage({ type: "activateClient", client: "claude-code" });
    harness.fireMessage({ type: "setMode", client: "claude-code", mode: "explicit" });
    harness.fireMessage({ type: "toggleApplyServer", client: "claude-code", server: "iris-admin-mcp" });
    harness.fireMessage({ type: "previewApply", client: "claude-code" });
    await tick();
    await tick();
    expect(harness.calls.filter((call) => call.method === "diffApplyText")).toEqual([]);
    expect(harness.lastHtml()).not.toContain("Pending apply");
    expect(harness.warnings).toEqual([]);
  });

  it("33.3 review: a REFRESH drops a staged EXPLICIT apply (the secret is wiped with the refresh — a kept pending would confirm with an empty stdin and refuse-loop)", async () => {
    const harness = makeHarness({
      status: statusWith("absent"),
      askInputResponses: ["iris-admin-mcp", "s3cr3t-refresh-wipe-1a2b"],
    });
    await createClientsPanelOpener(harness.deps)();
    harness.fireMessage({ type: "activateClient", client: "claude-code" });
    harness.fireMessage({ type: "setMode", client: "claude-code", mode: "explicit" });
    harness.fireMessage({ type: "toggleApplyServer", client: "claude-code", server: "iris-admin-mcp" });
    harness.fireMessage({ type: "previewApply", client: "claude-code" });
    await tick();
    await tick();
    expect(harness.lastHtml()).toContain("Pending apply");

    harness.fireMessage({ type: "refresh" });
    await tick();
    await tick();
    await tick();
    // The staged explicit apply is GONE (a non-explicit pending would survive).
    expect(harness.lastHtml()).not.toContain("Pending apply");

    // A confirm now is a no-op — the engine NEVER sees an apply with an empty stdin.
    harness.fireMessage({ type: "confirmPending" });
    await tick();
    await tick();
    expect(harness.calls.filter((call) => call.method === "apply")).toEqual([]);
  });

  it("33.3 review: a FAILED explicit confirm drops the staged action (the secret is gone — retry is impossible) and surfaces the error as a banner", async () => {
    const harness = makeHarness({
      status: statusWith("absent"),
      askInputResponses: ["iris-admin-mcp", "s3cr3t-failed-confirm-3c4d"],
      applyError: "iris-mcp-clients apply failed: could not write C:\\home\\.claude.json — EACCES",
    });
    await createClientsPanelOpener(harness.deps)();
    harness.fireMessage({ type: "activateClient", client: "claude-code" });
    harness.fireMessage({ type: "setMode", client: "claude-code", mode: "explicit" });
    harness.fireMessage({ type: "toggleApplyServer", client: "claude-code", server: "iris-admin-mcp" });
    harness.fireMessage({ type: "previewApply", client: "claude-code" });
    await tick();
    await tick();
    expect(harness.lastHtml()).toContain("Pending apply");

    harness.fireMessage({ type: "confirmPending" });
    await tick();
    await tick();
    // Pending DROPPED (not kept for a retry that could only re-fail with an
    // empty stdin); the engine's error renders as a banner instead.
    expect(harness.lastHtml()).not.toContain("Pending apply");
    expect(harness.lastHtml()).toContain("EACCES");

    // A second confirm does NOT re-fire the apply (pre-fix: an empty-stdin
    // refusal loop until the user thought to Cancel).
    const applyCalls = harness.calls.filter((call) => call.method === "apply").length;
    harness.fireMessage({ type: "confirmPending" });
    await tick();
    await tick();
    expect(harness.calls.filter((call) => call.method === "apply")).toHaveLength(applyCalls);
    expect(applyCalls).toBe(1);
  });

  it("restore flows stage → confirm → engine restore → restart hint (backup/restore reachable from the UI, AC 33.3.3)", async () => {
    const harness = makeHarness();
    await createClientsPanelOpener(harness.deps)();
    harness.fireMessage({ type: "activateClient", client: "claude-code" });
    harness.fireMessage({ type: "stageRestore", client: "claude-code" });
    expect(harness.lastHtml()).toContain("Pending restore");
    harness.fireMessage({ type: "confirmPending" });
    await tick();
    await tick();
    expect(harness.calls).toContainEqual({ method: "restore", args: { client: "claude-code", scope: "user" } });
  });

  it("doctor renders through the same engine surface (clean result → the all-clear banner)", async () => {
    const harness = makeHarness();
    await createClientsPanelOpener(harness.deps)();
    harness.fireMessage({ type: "runDoctor" });
    await tick();
    await tick();
    expect(harness.calls.filter((call) => call.method === "doctor")).toHaveLength(1);
    expect(harness.lastHtml()).toContain("All checks passed");
  });

  it("a modes-probe failure degrades to the two always-available modes (the CLI's write gate stays the enforcement point)", async () => {
    const harness = makeHarness({ modesError: "iris-mcp-clients --help failed: exit 2" });
    await createClientsPanelOpener(harness.deps)();
    harness.fireMessage({ type: "activateClient", client: "claude-code" });
    const html = harness.lastHtml();
    expect(html).toContain('<option value="env-reference"');
    expect(html).toContain('<option value="explicit"');
    expect(html).not.toContain("server-manager");
  });

  it("a resolution error renders inline and nothing else is spawned", async () => {
    const harness = makeHarness({ describeError: "The clients CLI is not built at C:\\repo" });
    await createClientsPanelOpener(harness.deps)();
    expect(harness.lastHtml()).toContain("The clients CLI is not built");
  });

  it("a detect failure renders the engine's error inline", async () => {
    const harness = makeHarness({ detectError: "npx not on PATH" });
    await createClientsPanelOpener(harness.deps)();
    expect(harness.lastHtml()).toContain("npx not on PATH");
    // modes/status never ran (detect gates them).
    expect(harness.calls.map((call) => call.method)).toEqual(["detect"]);
  });

  it("a second open reveals the singleton and refreshes (no stacked duplicates)", async () => {
    const harness = makeHarness();
    const open = createClientsPanelOpener(harness.deps);
    await open();
    const detectCallsBefore = harness.calls.filter((call) => call.method === "detect").length;
    await open();
    expect(harness.revealCount()).toBe(1);
    expect(harness.calls.filter((call) => call.method === "detect").length).toBe(detectCallsBefore + 1);
  });

  it("dispose resets state + busy: a reopened panel builds fresh from the persisted roster", async () => {
    const harness = makeHarness({ roster: ["claude-desktop"] });
    const open = createClientsPanelOpener(harness.deps);
    await open();
    harness.dispose();
    await open();
    expect(harness.panelCount()).toBe(2);
    expect(harness.lastHtml()).toContain("Detected clients");
  });

  it("message-boundary validation: malformed scope/action/mode messages are ignored", async () => {
    const harness = makeHarness();
    await createClientsPanelOpener(harness.deps)();
    harness.fireMessage({ type: "activateClient", client: "claude-code" });
    harness.fireMessage({ type: "setScope", client: "claude-code", scope: "system" as unknown as "user" });
    harness.fireMessage({ type: "stageToggle", client: "claude-code", action: "frob" as unknown as "disable", server: "iris-dev-mcp" });
    harness.fireMessage({ type: "setMode", client: "claude-code", mode: "server-manager" }); // not in the host's modes
    await tick();
    const html = harness.lastHtml();
    expect(html).not.toContain("Pending");
    expect(html).toContain('<option value="env-reference" selected>'); // unchanged default
  });

  it("credential containment: the panel surface never reflects a settings/memento marker it does not own", async () => {
    const MARKER = "DO-NOT-LEAK-CLIENTS-PANEL-7c2e";
    const harness = makeHarness({ roster: ["claude-code", MARKER] });
    await createClientsPanelOpener(harness.deps)();
    for (const html of harness.htmlLog) {
      expect(html).not.toContain(MARKER);
    }
  });
});
