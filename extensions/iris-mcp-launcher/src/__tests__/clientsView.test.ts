/**
 * Unit tests for the MCP Clients view-model (Story 33.3, Task 2) — roster
 * selection + persistence sanitizing, per-client scope/mode pickers, the
 * server matrix, apply staging + validation, pending-action lifecycle, and
 * HTML rendering.
 *
 * The CLI-output fixtures are shaped EXACTLY like the real `iris-mcp-clients`
 * bin's `--json` output (Rule #36 — captured 2026-07-28 by running the built
 * bin against a sandbox HOME with the claude-code fixture planted:
 *   node packages/client-config/dist/cli/clients-cli.js detect --json
 *   node packages/client-config/dist/cli/clients-cli.js status --json
 *   node packages/client-config/dist/cli/clients-cli.js diff --client claude-code --servers iris-admin-mcp --json
 *   node packages/client-config/dist/cli/clients-cli.js apply --client claude-code --servers iris-admin-mcp --yes --json
 *   node packages/client-config/dist/cli/clients-cli.js doctor --json
 * only the roster is minimized (2 detected + 2 undetected of the real 13).
 */
import { describe, expect, it } from "vitest";
import {
  absentServers,
  activateClient,
  applySelection,
  applyValidation,
  cancelPending,
  dismissNotices,
  effectiveRosterSelection,
  initialClientsViewState,
  modeFor,
  renderClientsHtml,
  sanitizePersistedRoster,
  scopeFor,
  scopesForClient,
  setMode,
  setScope,
  stageApply,
  stageRestore,
  stageToggleAction,
  statusScope,
  toggleApplyServer,
  toggleRosterClient,
  writeFailed,
  writeSucceeded,
  type ClientsViewState,
} from "../clientsView.js";
import type { DetectData, DiffApplyData, DoctorData, StatusData } from "../clientsEngine.js";
import { escapeHtml } from "../clientsView.js";

/** The HTML-attribute-escaped form of a message JSON (how data-msg renders). */
const msg = (value: unknown): string => escapeHtml(JSON.stringify(value));

// ── Fixtures (real-bin shapes, minimized) ──────────────────────────────

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
        { kind: "appDir", path: "C:\\home\\.claude", exists: false },
      ],
    },
    {
      client: "claude-desktop",
      displayName: "Claude Desktop",
      detected: true,
      probes: [
        { kind: "config", scope: "user", path: "C:\\home\\AppData\\Roaming\\Claude\\claude_desktop_config.json", exists: true },
        { kind: "appDir", path: "C:\\home\\AppData\\Roaming\\Claude", exists: true },
      ],
    },
    {
      client: "cursor",
      displayName: "Cursor",
      detected: false,
      probes: [{ kind: "config", scope: "user", path: "C:\\home\\.cursor\\mcp.json", exists: false }],
    },
    {
      client: "vscode",
      displayName: "VS Code (Copilot)",
      detected: false,
      probes: [{ kind: "config", scope: "user", path: "C:\\home\\AppData\\Roaming\\Code\\User\\mcp.json", exists: false }],
    },
  ],
  // The REAL CLIENT_DISPOSITIONS rows (verbatim, incl. the Pi rationale the
  // AC 33.3.1 info row renders).
  dispositions: [
    {
      id: "pi",
      displayName: "Pi (pi CLI / pi-coding-agent)",
      disposition: "excluded-not-mcp-capable",
      reason:
        "Verified to have no built-in MCP support by design (minimal four-tool core; external tools via bash or TypeScript extensions). Revisit if Pi ships MCP support.",
    },
    {
      id: "jetbrains-junie",
      displayName: "JetBrains AI Assistant / Junie",
      disposition: "roadmap",
      reason:
        "High adoption but config surface not yet verified against official docs; the registry is data-driven, so this is an adapter-data addition + fixture test once verified.",
    },
    {
      id: "kilo-code",
      displayName: "Kilo Code",
      disposition: "roadmap",
      reason: "Roo/Cline-lineage fork; likely follows the mcp_settings.json pattern — verify against official docs before adding (never assume).",
    },
  ],
  counts: { probed: 13, detected: 2, notDetected: 11, dispositioned: 3 },
};

const STATUS: StatusData = {
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
            { server: "iris-admin-mcp", state: "present-disabled" },
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
      scopes: [
        {
          scope: "user",
          path: "C:\\home\\AppData\\Roaming\\Claude\\claude_desktop_config.json",
          file: "unparseable",
          error: "expected JSON object",
          servers: [],
          foreign: [],
        },
      ],
    },
  ],
  undetected: [
    { client: "cursor", displayName: "Cursor" },
    { client: "vscode", displayName: "VS Code (Copilot)" },
  ],
  counts: { detected: 2, undetected: 11, managedEntries: 2 },
};

const DIFF: DiffApplyData = {
  client: "claude-code",
  scope: "user",
  mode: "env-reference",
  servers: [
    {
      server: "iris-admin-mcp",
      mechanism: "add",
      text: "APPLY iris-admin-mcp → Claude Code (user scope, json, root key \"mcpServers\")\nAdd entry \"iris-admin-mcp\" (not currently present).",
      missingInputIds: [],
    },
  ],
};

const DOCTOR_FINDINGS: DoctorData = {
  findings: [
    {
      check: "env-references",
      client: "claude-code",
      scope: "user",
      path: "C:\\home\\.claude.json",
      detail: "entry \"iris-dev-mcp\" references ${IRIS_PASSWORD}, which is not set in the current environment",
    },
  ],
  findingCount: 1,
  repaired: [],
  staleBackupDays: 30,
  parsedFiles: 1,
  restartHints: [{ client: "claude-code", hint: "Restart Claude Code (or start a new session) for MCP changes to take effect." }],
};

function loaded(overrides: Partial<ClientsViewState> = {}): ClientsViewState {
  return {
    ...initialClientsViewState(),
    engineMode: "local",
    detect: DETECT,
    status: STATUS,
    modes: ["env-reference", "explicit"],
    rosterSelected: ["claude-code", "claude-desktop"],
    ...overrides,
  };
}

// ── Roster ─────────────────────────────────────────────────────────────

describe("roster selection + persistence", () => {
  it("sanitizePersistedRoster accepts a string array and rejects every other stored shape (hostile globalState)", () => {
    expect(sanitizePersistedRoster(["claude-code", "cursor"])).toEqual(["claude-code", "cursor"]);
    expect(sanitizePersistedRoster([])).toEqual([]);
    expect(sanitizePersistedRoster(undefined)).toBeUndefined();
    expect(sanitizePersistedRoster("claude-code")).toBeUndefined();
    expect(sanitizePersistedRoster(42)).toBeUndefined();
    expect(sanitizePersistedRoster({})).toBeUndefined();
    // Non-strings and empty strings drop out; what remains is still a valid roster.
    expect(sanitizePersistedRoster(["claude-code", 7, "", null, "cursor"])).toEqual(["claude-code", "cursor"]);
  });

  it("the default selection is EVERY detected client (no persisted roster), in detection order", () => {
    expect(effectiveRosterSelection(DETECT, undefined)).toEqual(["claude-code", "claude-desktop"]);
    expect(effectiveRosterSelection(undefined, undefined)).toEqual([]);
  });

  it("a persisted roster filters the detected clients; unknown/uninstalled ids drop out of the EFFECTIVE selection but stay persisted", () => {
    expect(effectiveRosterSelection(DETECT, ["cursor", "claude-desktop"])).toEqual(["claude-desktop"]);
    expect(effectiveRosterSelection(DETECT, [])).toEqual([]);
  });

  it("toggleRosterClient flips a detected client and ignores undetected/unknown ids", () => {
    const off = toggleRosterClient(loaded(), "claude-code");
    expect(off.rosterSelected).toEqual(["claude-desktop"]);
    const backOn = toggleRosterClient(off, "claude-code");
    expect(backOn.rosterSelected).toEqual(["claude-desktop", "claude-code"]);

    const undetected = toggleRosterClient(loaded(), "cursor");
    expect(undetected.rosterSelected).toEqual(["claude-code", "claude-desktop"]);
    const unknown = toggleRosterClient(loaded(), "not-a-client");
    expect(unknown.rosterSelected).toEqual(["claude-code", "claude-desktop"]);
  });

  it("deselecting the expanded client collapses its section and drops its pending action", () => {
    let state = loaded({ activeClient: "claude-code" });
    state = stageToggleAction(state, "claude-code", "disable", "iris-dev-mcp");
    expect(state.pendingAction?.kind).toBe("toggle");
    state = toggleRosterClient(state, "claude-code");
    expect(state.activeClient).toBeUndefined();
    expect(state.pendingAction).toBeUndefined();
  });

  it("activateClient expands/collapses one SELECTED client only", () => {
    let state = loaded();
    state = activateClient(state, "claude-code");
    expect(state.activeClient).toBe("claude-code");
    state = activateClient(state, "claude-code");
    expect(state.activeClient).toBeUndefined();
    state = activateClient(state, "cursor");
    expect(state.activeClient).toBeUndefined();
  });
});

// ── Pickers ────────────────────────────────────────────────────────────

describe("scope + mode pickers", () => {
  it("scopesForClient derives the offered scopes from the detection probes (config probes only)", () => {
    expect(scopesForClient(DETECT, "claude-code")).toEqual(["user", "project"]);
    expect(scopesForClient(DETECT, "claude-desktop")).toEqual(["user"]);
    expect(scopesForClient(DETECT, "not-a-client")).toEqual([]);
  });

  it("scopeFor defaults to the first offered scope; setScope honors only offered scopes", () => {
    let state = loaded();
    expect(scopeFor(state, "claude-code")).toBe("user");
    state = setScope(state, "claude-code", "project");
    expect(scopeFor(state, "claude-code")).toBe("project");
    // claude-desktop offers no project scope — the gesture is ignored.
    state = setScope(state, "claude-desktop", "project");
    expect(scopeFor(state, "claude-desktop")).toBe("user");
  });

  it("modeFor defaults to env-reference; setMode honors only the CLI's available modes", () => {
    let state = loaded();
    expect(modeFor(state, "claude-code")).toBe("env-reference");
    state = setMode(state, "claude-code", "explicit");
    expect(modeFor(state, "claude-code")).toBe("explicit");
    // server-manager is NOT offered on this host (fixture modes list) — ignored.
    state = setMode(state, "claude-code", "server-manager");
    expect(modeFor(state, "claude-code")).toBe("explicit");
  });
});

// ── Matrix + apply staging ─────────────────────────────────────────────

describe("server matrix + apply staging", () => {
  it("statusScope rows surface per-scope file states", () => {
    const state = loaded();
    expect(statusScope(state, "claude-code", "user")?.file).toBe("ok");
    expect(statusScope(state, "claude-code", "project")?.file).toBe("missing");
    expect(statusScope(state, "claude-desktop", "user")?.file).toBe("unparseable");
  });

  it("absentServers lists exactly the absent rows of an ok scope", () => {
    const state = loaded();
    expect(absentServers(state, "claude-code", "user")).toEqual([
      "iris-ops-mcp",
      "iris-interop-mcp",
      "iris-data-mcp",
      "iris-mcp-all",
    ]);
    expect(absentServers(state, "claude-code", "project")).toEqual([]); // missing file
    expect(absentServers(state, "claude-desktop", "user")).toEqual([]); // unparseable
  });

  it("toggleApplyServer checks/unchecks one server; applyValidation gates zero-selection and multi-server explicit mode", () => {
    let state = loaded();
    expect(applyValidation(state, "claude-code")).toContain("Check at least one");
    state = toggleApplyServer(state, "claude-code", "iris-ops-mcp");
    state = toggleApplyServer(state, "claude-code", "iris-data-mcp");
    expect(applySelection(state, "claude-code")).toEqual(["iris-ops-mcp", "iris-data-mcp"]);
    expect(applyValidation(state, "claude-code")).toBeUndefined();

    state = setMode(state, "claude-code", "explicit");
    expect(applyValidation(state, "claude-code")).toContain("exactly one server");
    state = toggleApplyServer(state, "claude-code", "iris-data-mcp");
    expect(applyValidation(state, "claude-code")).toBeUndefined();
  });
});

// ── Pending-action lifecycle ───────────────────────────────────────────

describe("pending actions (diff preview → explicit confirm → engine)", () => {
  it("stageApply snapshots the client's CURRENT scope/mode/selection + the preview", () => {
    let state = loaded();
    state = setScope(state, "claude-code", "project");
    state = toggleApplyServer(state, "claude-code", "iris-ops-mcp");
    state = stageApply(state, "claude-code", { kind: "json", data: DIFF });
    expect(state.pendingAction).toEqual({
      kind: "apply",
      client: "claude-code",
      scope: "project",
      mode: "env-reference",
      servers: ["iris-ops-mcp"],
      preview: { kind: "json", data: DIFF },
    });
  });

  it("stageToggleAction/stageRestore stage at the active scope; cancelPending clears", () => {
    let state = loaded();
    state = stageToggleAction(state, "claude-code", "disable", "iris-dev-mcp");
    expect(state.pendingAction).toMatchObject({ kind: "toggle", action: "disable", client: "claude-code", scope: "user", server: "iris-dev-mcp" });
    state = cancelPending(state);
    expect(state.pendingAction).toBeUndefined();

    state = stageRestore(state, "claude-desktop");
    expect(state.pendingAction).toMatchObject({ kind: "restore", client: "claude-desktop", scope: "user" });
  });

  it("writeSucceeded clears the pending action, surfaces the restart hint, and drops the applied servers from staging", () => {
    let state = loaded();
    state = toggleApplyServer(state, "claude-code", "iris-ops-mcp");
    state = stageApply(state, "claude-code", { kind: "json", data: DIFF });
    // Checked AFTER the preview was staged — not part of the pending apply.
    state = toggleApplyServer(state, "claude-code", "iris-data-mcp");
    state = writeSucceeded(state, "Restart Claude Code (or start a new session) for MCP changes to take effect.");
    expect(state.pendingAction).toBeUndefined();
    expect(state.restartNotices).toEqual(["Restart Claude Code (or start a new session) for MCP changes to take effect."]);
    expect(applySelection(state, "claude-code")).toEqual(["iris-data-mcp"]);
    state = dismissNotices(state);
    expect(state.restartNotices).toEqual([]);
  });

  it("writeFailed keeps the staged action for retry and carries the engine's error", () => {
    let state = loaded();
    state = stageToggleAction(state, "claude-code", "disable", "iris-dev-mcp");
    state = writeFailed(state, "iris-mcp-clients disable failed: could not write C:\\home\\.claude.json — EACCES");
    expect(state.pendingAction?.kind).toBe("toggle");
    expect(state.actionError).toContain("EACCES");
  });
});

// ── HTML rendering ─────────────────────────────────────────────────────

describe("renderClientsHtml", () => {
  const NONCE = "TEST-NONCE";

  it("renders the roster with checkboxes, derived counts, the collapsed undetected list, and the disposition info rows (Pi not-MCP-capable + roadmap)", () => {
    const html = renderClientsHtml(loaded(), NONCE);
    expect(html).toContain("Detected clients (2 of 13)");
    expect(html).toContain("Claude Code");
    expect(html).toContain("Claude Desktop");
    // Both selected → checked.
    expect(html.match(/type="checkbox" data-msg='[^']*' checked/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Not detected (2)");
    expect(html).toContain("Cursor (cursor)");
    // Pi info row with rationale (AC 33.3.1) + a roadmap row.
    expect(html).toContain("not MCP-capable");
    expect(html).toContain("Pi (pi CLI / pi-coding-agent)");
    expect(html).toContain("no built-in MCP support");
    expect(html).toContain("roadmap");
    expect(html).toContain("JetBrains AI Assistant / Junie");
    // CSP nonce.
    expect(html).toContain(`script-src 'nonce-${NONCE}'`);
  });

  it("33.3 review: an OLDER CLI's detect envelope (no `dispositions` key — npx/devRepoPath version skew) renders WITHOUT the info-row section instead of throwing the view away", () => {
    const skewedDetect = { ...DETECT } as Partial<DetectData>;
    delete skewedDetect.dispositions;
    const html = renderClientsHtml(loaded({ detect: skewedDetect as DetectData }), NONCE);
    // The roster still renders; only the dispositions section is absent.
    expect(html).toContain("Detected clients (2 of 13)");
    expect(html).not.toContain("Other clients considered");
    expect(html).not.toContain("not MCP-capable");
  });

  it("renders the expanded client's matrix: enabled/disabled/absent rows with their actions, the scope picker only when the client offers two scopes, and foreign entries read-only names-only", () => {
    const html = renderClientsHtml(loaded({ activeClient: "claude-code" }), NONCE);
    expect(html).toContain(">enabled</span>");
    expect(html).toContain(">disabled</span>");
    expect(html).toContain(">absent</span>");
    expect(html).toContain(msg({ type: "stageToggle", client: "claude-code", action: "disable", server: "iris-dev-mcp" }));
    expect(html).toContain(msg({ type: "stageToggle", client: "claude-code", action: "enable", server: "iris-admin-mcp" }));
    expect(html).toContain("include in apply");
    expect(html).toContain(msg({ type: "toggleApplyServer", client: "claude-code", server: "iris-ops-mcp" }));
    // Scope picker present (claude-code offers user+project).
    expect(html).toContain(escapeHtml('{"type":"setScope","client":"claude-code","scope":'));
    // Foreign entries: read-only names, and never a toggle button for them.
    expect(html).toContain("Third-party entries (read-only, names only");
    expect(html).toContain("github-mcp");
    expect(html).not.toContain(escapeHtml('"server":"github-mcp"'));
  });

  it("claude-desktop (one offered scope) renders the scope note instead of a picker, and its unparseable scope renders the refusal banner", () => {
    const html = renderClientsHtml(loaded({ activeClient: "claude-desktop" }), NONCE);
    expect(html).toContain("the only scope this client offers");
    expect(html).not.toContain(escapeHtml('"type":"setScope","client":"claude-desktop"'));
    expect(html).toContain("UNPARSEABLE");
    expect(html).toContain("Every write refuses until it is repaired or restored");
  });

  it("the mode picker offers exactly the CLI's available modes", () => {
    const html = renderClientsHtml(loaded({ activeClient: "claude-code" }), NONCE);
    expect(html).toContain('<option value="env-reference" selected>');
    expect(html).toContain('<option value="explicit">');
    expect(html).not.toContain('<option value="server-manager">');
  });

  it("a staged apply renders the CLI's diff preview text + Confirm/Cancel (AC 33.3.3); a failed confirm keeps the box with the error", () => {
    let state = loaded({ activeClient: "claude-code" });
    state = toggleApplyServer(state, "claude-code", "iris-ops-mcp");
    state = stageApply(state, "claude-code", { kind: "json", data: DIFF });
    let html = renderClientsHtml(state, NONCE);
    expect(html).toContain("Pending apply");
    expect(html).toContain("iris-admin-mcp → Claude Code"); // the diff render text
    expect(html).toContain(msg({ type: "confirmPending" }));
    expect(html).toContain(msg({ type: "cancelPending" }));

    state = writeFailed(state, "iris-mcp-clients apply failed: boom");
    html = renderClientsHtml(state, NONCE);
    expect(html).toContain("iris-mcp-clients apply failed: boom");
  });

  it("a staged toggle renders the backup promise; a post-write restart hint surfaces until dismissed", () => {
    let state = loaded({ activeClient: "claude-code" });
    state = stageToggleAction(state, "claude-code", "disable", "iris-dev-mcp");
    let html = renderClientsHtml(state, NONCE);
    expect(html).toContain("Pending disable");
    expect(html).toContain("timestamped backup");

    state = writeSucceeded(cancelPending(state), "Restart Claude Code …");
    html = renderClientsHtml(state, NONCE);
    expect(html).toContain("Restart Claude Code …");
    expect(html).toContain(msg({ type: "dismissNotices" }));
  });

  it("doctor renders findings + restart hints, or the clean banner", () => {
    let html = renderClientsHtml(loaded({ doctor: DOCTOR_FINDINGS, doctorClean: false }), NONCE);
    expect(html).toContain("env-references");
    expect(html).toContain("IRIS_PASSWORD");
    expect(html).toContain("1 finding(s)");

    const clean: DoctorData = { findings: [], findingCount: 0, repaired: [], staleBackupDays: 30, parsedFiles: 2, restartHints: [] };
    html = renderClientsHtml(loaded({ doctor: clean, doctorClean: true }), NONCE);
    expect(html).toContain("All checks passed (2 config file(s) parsed)");
  });

  it("escapes every CLI-supplied string (a hostile foreign entry name can never inject markup)", () => {
    const hostileStatus: StatusData = {
      ...STATUS,
      clients: [
        {
          client: "claude-code",
          displayName: "Claude Code",
          scopes: [
            {
              scope: "user",
              path: "C:\\home\\.claude.json",
              file: "ok",
              servers: [{ server: "iris-dev-mcp", state: "present-enabled" }],
              foreign: ['<script>alert("xss")</script>'],
            },
          ],
        },
      ],
    };
    const html = renderClientsHtml(loaded({ activeClient: "claude-code", status: hostileStatus }), NONCE);
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain("&lt;script&gt;");
  });

  it("the loading state renders before the first detect, and the picker data-prefix + a value completes to a valid message", () => {
    const loading = renderClientsHtml(initialClientsViewState(), NONCE);
    expect(loading).toContain("Detecting MCP clients…");

    const html = renderClientsHtml(loaded({ activeClient: "claude-code" }), NONCE);
    const prefix = /data-picker='([^']*)'/.exec(html)?.[1];
    expect(prefix).toBeDefined();
    const decoded = prefix!.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    const message = JSON.parse(decoded + JSON.stringify("project") + "}") as { type: string; client: string; scope: string };
    expect(message).toEqual({ type: "setScope", client: "claude-code", scope: "project" });
  });
});
