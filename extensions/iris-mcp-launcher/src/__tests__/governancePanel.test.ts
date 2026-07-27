/**
 * Unit tests for the governance panel orchestration (Story 32.2) — the
 * stateful layer between the pure view-model and the subprocess engine.
 *
 * Every dependency is faked; the engine host's canned outputs are shaped
 * EXACTLY like the real `iris-mcp-governance` bin's `--json` output (Rule
 * #36 — captured 2026-07-27 from the built bin; see governanceView.test.ts's
 * header for the capture commands). The fake panel records the HTML it is
 * given and lets tests drive the webview's messages.
 */
import { describe, expect, it } from "vitest";
import {
  createGovernancePanelOpener,
  OPEN_GOVERNANCE_EDITOR_COMMAND_ID,
  type GovernanceEngineHost,
  type GovernancePanelDeps,
  type GovernancePanelHandle,
} from "../governancePanel.js";
import type { GovernanceCliCommand, GovernanceCliResult } from "../governanceEngine.js";
import type { GovernanceViewMessage } from "../governanceView.js";
import { GLOBAL_TAB } from "../governanceView.js";
import type { LauncherSettings } from "../types.js";

// ── Fakes ──────────────────────────────────────────────────────────────

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
    governanceFile: "C:\\governance\\policy.json",
    auditLog: "",
    auditLogMaxMb: "",
    auditLogParams: "",
    toolsPreset: "",
    toolsDisable: "",
    toolsEnable: "",
    ...overrides,
  };
}

/** Real-bin-shaped minimal universe (see header note). */
function universeJson(profile: string, file: string | null): unknown {
  return {
    profile,
    file,
    preset: null,
    universeSource: "C:\\git\\iris-execute-mcp-v2\\packages",
    packages: [
      {
        pkg: "iris-dev-mcp",
        tools: [
          { name: "iris_doc_get", keys: ["iris_doc_get"] },
          { name: "iris_doc_put", keys: ["iris_doc_put"] },
        ],
      },
    ],
    frameworkTool: { name: "iris_server_profiles", keys: ["iris_server_profiles"] },
    keys: ["iris_doc_get", "iris_doc_put", "iris_server_profiles"],
    postFoundation: [],
    mutates: { iris_doc_get: "read", iris_doc_put: "write", iris_server_profiles: "read" },
    defaultEnabledWrites: [],
    policy: { iris_doc_get: true, iris_doc_put: false, iris_server_profiles: true },
    configSource: {
      iris_doc_get: "default",
      iris_doc_put: file === null ? "default" : "file",
      iris_server_profiles: "default",
    },
    note: "universe renders the FULL governance-key universe …",
  };
}

interface RecordedCall {
  command: GovernanceCliCommand;
}

function makeHarness(options: {
  settings?: LauncherSettings;
  fileExists?: boolean;
  engineMode?: "local" | "npx";
  engineDescribeError?: string;
  validateJson?: unknown;
  validateStatus?: number;
  diffJson?: unknown;
  universeJson?: unknown;
  writeResults?: GovernanceCliResult[];
  serverManagerNames?: string[];
  /** When true, set/unset writes return manually-resolved promises (the test drives save timing). */
  manualWrites?: boolean;
}) {
  const calls: RecordedCall[] = [];
  const htmlLog: string[] = [];
  const warnings: string[] = [];
  const settingWrites: string[] = [];
  const pendingWrites: { command: GovernanceCliCommand; resolve: (result: GovernanceCliResult) => void }[] = [];
  let messageListener: ((message: GovernanceViewMessage) => void) | undefined;
  let disposeListener: (() => void) | undefined;
  let revealCount = 0;
  let panelCount = 0;

  const engine: GovernanceEngineHost = {
    describe: async () =>
      options.engineDescribeError !== undefined
        ? { ok: false, error: options.engineDescribeError }
        : { ok: true, mode: options.engineMode ?? "local" },
    run: async (command) => {
      calls.push({ command });
      if (command.kind === "set" || command.kind === "unset") {
        if (options.manualWrites === true) {
          return new Promise<GovernanceCliResult>((resolve) => {
            pendingWrites.push({ command, resolve });
          });
        }
        const next = options.writeResults?.[calls.filter((c) => c.command.kind === "set" || c.command.kind === "unset").length - 1];
        return next ?? { status: 0, stdout: "Set ok\n", stderr: "" };
      }
      if (command.kind === "validate") {
        return {
          status: options.validateStatus ?? 0,
          stdout: `${JSON.stringify(options.validateJson ?? { ok: true, file: "C:\\governance\\policy.json", globalKeys: 1, profiles: 1 })}\n`,
          stderr: "",
        };
      }
      if (command.kind === "diff") {
        return {
          status: 0,
          stdout: `${JSON.stringify(
            options.diffJson ?? {
              file: "C:\\governance\\policy.json",
              entries: [{ layer: "global", key: "iris_doc_put", file: false, default: true, differs: true }],
              note: "…",
            },
          )}\n`,
          stderr: "",
        };
      }
      // universe
      return {
        status: 0,
        stdout: `${JSON.stringify(
          options.universeJson ?? universeJson(command.profile, command.file ?? null),
        )}\n`,
        stderr: "",
      };
    },
  };

  const panel: GovernancePanelHandle = {
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

  const deps: GovernancePanelDeps = {
    getSettings: () => options.settings ?? settings(),
    getServerManagerNames: async () => options.serverManagerNames ?? ["prod"],
    engine,
    fileExists: async () => options.fileExists ?? true,
    chooseFile: async () => undefined,
    updateGovernanceFileSetting: (path) => {
      settingWrites.push(path);
      return Promise.resolve();
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
    settingWrites,
    pendingWrites,
    fireMessage: (message: GovernanceViewMessage) => messageListener?.(message),
    dispose: () => disposeListener?.(),
    revealCount: () => revealCount,
    panelCount: () => panelCount,
  };
}

// ── Flows ──────────────────────────────────────────────────────────────

describe("createGovernancePanelOpener", () => {
  it("the command id is the one package.json declares (cross-checked mechanically by packaging.test.ts)", () => {
    expect(OPEN_GOVERNANCE_EDITOR_COMMAND_ID).toBe("irisMcpLauncher.openGovernanceEditor");
  });

  it("governanceFile unset → renders the empty state (choose-file affordance), running NO CLI command", async () => {
    const harness = makeHarness({ settings: settings({ governanceFile: "" }) });
    const open = createGovernancePanelOpener(harness.deps);
    await open();
    expect(harness.calls).toEqual([]);
    expect(harness.htmlLog.at(-1)).toContain("No governance file is configured");
    expect(harness.htmlLog.at(-1)).toContain("chooseFile");
  });

  it("an engine resolution error renders in the empty state when governanceFile is unset", async () => {
    const harness = makeHarness({
      settings: settings({ governanceFile: "" }),
      engineDescribeError: "The governance CLI is not built",
    });
    await createGovernancePanelOpener(harness.deps)();
    expect(harness.htmlLog.at(-1)).toContain("The governance CLI is not built");
  });

  it("existing valid file → validate + diff + universe run in order, and the editor renders key rows, tabs (incl. the Server Manager name), and the global layer's file-sourced toggle", async () => {
    const harness = makeHarness({});
    await createGovernancePanelOpener(harness.deps)();

    expect(harness.calls.map((call) => call.command.kind)).toEqual(["validate", "diff", "universe"]);
    expect(harness.calls[2]?.command).toMatchObject({ kind: "universe", profile: "default" });
    const html = harness.htmlLog.at(-1) ?? "";
    expect(html).toContain("iris_doc_put");
    expect(html).toContain(">prod</button>");
    expect(html).toContain("global (file)");
    // The file's global layer sets iris_doc_put=false → toggle shows disabled.
    expect(html).toContain('<option value="disabled" selected>');
    // Preset display + engine mode transparency.
    expect(html).toContain("local build");
  });

  it("stage → save runs the set command through the engine (never hand-serialized JSON), then refreshes from disk", async () => {
    const harness = makeHarness({});
    await createGovernancePanelOpener(harness.deps)();

    harness.fireMessage({ type: "stage", key: "iris_doc_get", value: "disabled" });
    expect(harness.htmlLog.at(-1)).toContain("Pending changes (1)");

    const callsBeforeSave = harness.calls.length;
    harness.fireMessage({ type: "save" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

    const saveCalls = harness.calls.slice(callsBeforeSave);
    expect(saveCalls[0]?.command).toEqual({
      kind: "set",
      file: "C:\\governance\\policy.json",
      profile: undefined,
      key: "iris_doc_get",
      value: false,
    });
    // Refresh after save: validate/diff/universe re-run.
    expect(saveCalls.slice(1).map((call) => call.command.kind)).toEqual([
      "validate",
      "diff",
      "universe",
    ]);
    expect(harness.warnings).toEqual([]);
  });

  it("a failed write aborts the save sequence (later edits never run), warns once, and keeps the failed state visible inline", async () => {
    const harness = makeHarness({
      writeResults: [
        { status: 1, stdout: "", stderr: 'Error: "iris_doc_get" is a reserved key and cannot be used.' },
        { status: 0, stdout: "ok", stderr: "" },
      ],
    });
    await createGovernancePanelOpener(harness.deps)();

    harness.fireMessage({ type: "stage", key: "iris_doc_get", value: "disabled" });
    harness.fireMessage({ type: "stage", key: "iris_doc_put", value: "enabled" });
    harness.fireMessage({ type: "save" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

    const writes = harness.calls.filter(
      (call) => call.command.kind === "set" || call.command.kind === "unset",
    );
    expect(writes).toHaveLength(1); // the second staged edit never ran
    expect(harness.warnings).toHaveLength(1);
    expect(harness.warnings[0]).toContain("reserved key");
    expect(harness.htmlLog.at(-1)).toContain("Save failed");
  });

  it("switchProfile fetches the new tab's universe with --profile <name>, and a second switch uses the cached render", async () => {
    const harness = makeHarness({});
    await createGovernancePanelOpener(harness.deps)();
    const universeCallsBefore = harness.calls.filter((c) => c.command.kind === "universe").length;

    harness.fireMessage({ type: "switchProfile", profile: "prod" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    const universeCalls = harness.calls.filter((c) => c.command.kind === "universe");
    expect(universeCalls.length).toBe(universeCallsBefore + 1);
    expect(universeCalls.at(-1)?.command).toMatchObject({ profile: "prod" });
    expect(harness.htmlLog.at(-1)).toContain('class="tab active"');

    // Switch back and forth — no new fetch.
    harness.fireMessage({ type: "switchProfile", profile: GLOBAL_TAB });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    harness.fireMessage({ type: "switchProfile", profile: "prod" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(harness.calls.filter((c) => c.command.kind === "universe").length).toBe(
      universeCallsBefore + 1,
    );
  });

  it("an unknown tab id is ignored (the webview can only post real shapes, but the handler stays defensive)", async () => {
    const harness = makeHarness({});
    await createGovernancePanelOpener(harness.deps)();
    const callsBefore = harness.calls.length;
    harness.fireMessage({ type: "switchProfile", profile: "no-such-tab" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(harness.calls.length).toBe(callsBefore);
  });

  it("a MISSING file skips validate/diff, renders the startup-failure warning, and renders the universe WITHOUT --file (seeds only)", async () => {
    const harness = makeHarness({ fileExists: false });
    await createGovernancePanelOpener(harness.deps)();

    expect(harness.calls.map((call) => call.command.kind)).toEqual(["universe"]);
    expect(harness.calls[0]?.command).toEqual({ kind: "universe", profile: "default" });
    const html = harness.htmlLog.at(-1) ?? "";
    expect(html).toContain("This file does not exist yet");
    expect(html).toContain("FAILS TO START");
  });

  it("an INVALID file renders the engine's own error and never fetches diff/universe (editing is disabled until the file parses)", async () => {
    const harness = makeHarness({
      validateStatus: 1,
      validateJson: { ok: false, error: "IRIS_GOVERNANCE_FILE is invalid: could not parse JSON" },
    });
    await createGovernancePanelOpener(harness.deps)();

    expect(harness.calls.map((call) => call.command.kind)).toEqual(["validate"]);
    const html = harness.htmlLog.at(-1) ?? "";
    expect(html).toContain("The governance file is invalid");
    expect(html).toContain("could not parse JSON");
    expect(html).toContain("Editing is disabled");
  });

  it("chooseFile writes the picked path to irisMcpLauncher.governanceFile and refreshes; a dismissed dialog writes nothing", async () => {
    const harness = makeHarness({ settings: settings({ governanceFile: "" }) });
    let picked: string | undefined = "D:\\policies\\team.json";
    harness.deps.chooseFile = async () => picked;
    await createGovernancePanelOpener(harness.deps)();

    harness.fireMessage({ type: "chooseFile" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(harness.settingWrites).toEqual(["D:\\policies\\team.json"]);

    picked = undefined;
    harness.fireMessage({ type: "chooseFile" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(harness.settingWrites).toEqual(["D:\\policies\\team.json"]);
  });

  it("a settings-write rejection on chooseFile degrades to one warning (no unhandled rejection out of the message pump)", async () => {
    const harness = makeHarness({ settings: settings({ governanceFile: "" }) });
    harness.deps.chooseFile = async () => "D:\\policies\\team.json";
    harness.deps.updateGovernanceFileSetting = () => Promise.reject(new Error("read-only settings"));
    await createGovernancePanelOpener(harness.deps)();
    harness.fireMessage({ type: "chooseFile" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(harness.warnings).toHaveLength(1);
    expect(harness.warnings[0]).toContain("governanceFile");
  });

  it("discard clears every staged edit without any CLI call", async () => {
    const harness = makeHarness({});
    await createGovernancePanelOpener(harness.deps)();
    harness.fireMessage({ type: "stage", key: "iris_doc_get", value: "disabled" });
    expect(harness.htmlLog.at(-1)).toContain("Pending changes (1)");
    const callsBefore = harness.calls.length;
    harness.fireMessage({ type: "discard" });
    expect(harness.htmlLog.at(-1)).not.toContain("Pending changes");
    expect(harness.calls.length).toBe(callsBefore);
  });

  it("a second open reveals the existing panel and refreshes (no stacked duplicates)", async () => {
    const harness = makeHarness({});
    const open = createGovernancePanelOpener(harness.deps);
    await open();
    const callsBefore = harness.calls.length;
    await open();
    expect(harness.revealCount()).toBe(1);
    expect(harness.calls.length).toBeGreaterThan(callsBefore); // refreshed
  });

  it("credential containment: no Server Manager credential shape reaches this layer — the deps surface carries server NAMES only (the panel never imports ServerSpec/AuthApi)", async () => {
    // Structural proof is in containment.test.ts's source grep; this pins the
    // behavioral half: a distinctive marker in a place the panel must never
    // read (a settings field it does not consume) never reaches the HTML.
    const MARKER = "DO-NOT-LEAK-PANEL-8d2e";
    const harness = makeHarness({
      settings: settings({ governance: MARKER, auditLog: MARKER, namespace: MARKER }),
    });
    await createGovernancePanelOpener(harness.deps)();
    harness.fireMessage({ type: "stage", key: "iris_doc_get", value: "disabled" });
    for (const html of harness.htmlLog) {
      expect(html).not.toContain(MARKER);
    }
  });

  // ── 32.2 review patches: save/concurrency hardening ──────────────────

  it("a retry after a partial save replays ONLY the edits that never applied (an already-applied unset is never replayed into a 'nothing to unset' wedge)", async () => {
    // Staged: unset iris_doc_put (the file sets it), then set
    // iris_server_profiles disabled. Sorted order puts the unset FIRST.
    // writeResults: unset succeeds, set fails. The retry must run ONLY the
    // failed set — never the unset again (32.2 review: replaying the applied
    // unset fails "nothing to unset" at the sequence head forever).
    const harness = makeHarness({
      writeResults: [
        { status: 0, stdout: "Unset ok\n", stderr: "" },
        { status: 1, stdout: "", stderr: "Error: could not write C:\\governance\\policy.json — EACCES" },
        { status: 0, stdout: "Set ok\n", stderr: "" },
      ],
    });
    await createGovernancePanelOpener(harness.deps)();

    harness.fireMessage({ type: "stage", key: "iris_doc_put", value: "inherit" });
    harness.fireMessage({ type: "stage", key: "iris_server_profiles", value: "disabled" });
    harness.fireMessage({ type: "save" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

    let writes = harness.calls.filter(
      (call) => call.command.kind === "set" || call.command.kind === "unset",
    );
    expect(writes.map((call) => call.command.kind)).toEqual(["unset", "set"]);
    expect(harness.warnings).toHaveLength(1);
    // Only the FAILED edit remains pending — the applied unset is gone (the
    // pending-table count is the proof; the groups table always lists every
    // universe key, so a key-name negative would be vacuous here).
    expect(harness.htmlLog.at(-1)).toContain("Pending changes (1)");
    expect(harness.htmlLog.at(-1)).toContain("iris_server_profiles");

    // Retry (cause fixed) — the unset is NOT replayed; the set succeeds.
    harness.fireMessage({ type: "save" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    writes = harness.calls.filter(
      (call) => call.command.kind === "set" || call.command.kind === "unset",
    );
    expect(writes.map((call) => call.command.kind)).toEqual(["unset", "set", "set"]);
    expect(writes[2]?.command).toMatchObject({ kind: "set", key: "iris_server_profiles" });
  });

  it("stage and discard are ignored while a save is in flight (no silent wipe of a mid-save gesture)", async () => {
    const harness = makeHarness({ manualWrites: true });
    await createGovernancePanelOpener(harness.deps)();

    harness.fireMessage({ type: "stage", key: "iris_doc_get", value: "disabled" });
    expect(harness.htmlLog.at(-1)).toContain("Pending changes (1)");

    harness.fireMessage({ type: "save" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(harness.pendingWrites).toHaveLength(1); // save holds the first write

    // Mid-save gestures are busy-guarded: neither stages nor discards.
    harness.fireMessage({ type: "stage", key: "iris_doc_put", value: "enabled" });
    harness.fireMessage({ type: "discard" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(harness.pendingWrites).toHaveLength(1);

    // Let the write land; the save completes and refreshes.
    harness.pendingWrites[0]?.resolve({ status: 0, stdout: "Set ok\n", stderr: "" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(harness.calls.map((call) => call.command.kind)).toEqual([
      "validate",
      "diff",
      "universe",
      "set",
      "validate",
      "diff",
      "universe",
    ]);
  });

  it("a second open DURING a save reveals the panel but skips the refresh (no interleaved rebuild against the save's writes)", async () => {
    const harness = makeHarness({ manualWrites: true });
    const open = createGovernancePanelOpener(harness.deps);
    await open();

    harness.fireMessage({ type: "stage", key: "iris_doc_get", value: "disabled" });
    harness.fireMessage({ type: "save" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(harness.pendingWrites).toHaveLength(1);

    const callsBefore = harness.calls.length;
    await open(); // reveal only — the in-flight save renders when it finishes
    expect(harness.revealCount()).toBe(1);
    expect(harness.calls.length).toBe(callsBefore);

    // Once idle, a second open refreshes again.
    harness.pendingWrites[0]?.resolve({ status: 0, stdout: "Set ok\n", stderr: "" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    await open();
    expect(harness.revealCount()).toBe(2);
    expect(harness.calls.length).toBeGreaterThan(callsBefore);
  });

  it("disposing the panel resets the busy guard — a reopen after a hung operation is not dead", async () => {
    const harness = makeHarness({ manualWrites: true });
    const open = createGovernancePanelOpener(harness.deps);
    await open();

    harness.fireMessage({ type: "stage", key: "iris_doc_get", value: "disabled" });
    harness.fireMessage({ type: "save" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(harness.pendingWrites).toHaveLength(1); // the "hung" write

    // Close the panel mid-hang, then reopen: busy was reset on dispose, so
    // the new panel refreshes instead of inheriting a dead guard.
    harness.dispose();
    const callsBefore = harness.calls.length;
    await open();
    expect(harness.panelCount()).toBe(2);
    expect(harness.calls.length).toBeGreaterThan(callsBefore);

    // The abandoned save settles without crashing the message pump.
    harness.pendingWrites[0]?.resolve({ status: 0, stdout: "Set ok\n", stderr: "" });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  });

  it("a stage message with an unknown key or a non-tri-state value is ignored (message-boundary validation)", async () => {
    const harness = makeHarness({});
    await createGovernancePanelOpener(harness.deps)();

    harness.fireMessage({ type: "stage", key: "iris_not_a_real_key", value: "disabled" });
    expect(harness.htmlLog.at(-1)).not.toContain("Pending changes");
    harness.fireMessage({
      type: "stage",
      key: "iris_doc_get",
      value: "definitely-not-a-toggle" as unknown as "disabled",
    });
    expect(harness.htmlLog.at(-1)).not.toContain("Pending changes");

    // A real key + value still stages.
    harness.fireMessage({ type: "stage", key: "iris_doc_get", value: "disabled" });
    expect(harness.htmlLog.at(-1)).toContain("Pending changes (1)");
  });

  it("a malformed universe payload (exit 0, wrong shape) renders an inline load error instead of crashing the render", async () => {
    const harness = makeHarness({ universeJson: { profile: "default", unexpectedly: "malformed" } });
    await createGovernancePanelOpener(harness.deps)();
    expect(harness.htmlLog.at(-1)).toContain("unexpected output shape");
  });
});
