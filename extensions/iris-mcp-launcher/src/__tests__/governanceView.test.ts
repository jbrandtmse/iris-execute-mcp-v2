/**
 * Unit tests for the governance editor view-model (Story 32.2, Tasks 2+3) —
 * pure state derivation, toggle → set/unset command mapping, diff preview,
 * badge mapping, and HTML rendering.
 *
 * The CLI-output fixtures are shaped EXACTLY like the real
 * `iris-mcp-governance` bin's `--json` output (Rule #36 — captured
 * 2026-07-27 by running the built Story 32.1/32.2 bin:
 *   node packages/shared/dist/cli/governance-cli.js universe --json --file <f> --profile <p>
 *   node packages/shared/dist/cli/governance-cli.js diff --json --file <f>
 *   node packages/shared/dist/cli/governance-cli.js validate --json --file <f>
 * with a two-layer fixture file); only the key set is minimized.
 */
import { describe, expect, it } from "vitest";
import {
  buildGroups,
  computeProfileTabs,
  configSourceBadge,
  fileProfileNames,
  fileValueFor,
  GLOBAL_TAB,
  layerForTab,
  originBadge,
  pendingChanges,
  renderEmptyStateHtml,
  renderGovernanceHtml,
  renderProfileForTab,
  stageToggle,
  stagedCliCommands,
  toggleFor,
  type DiffJson,
  type GovernanceViewState,
  type UniverseJson,
  type ValidateJson,
} from "../governanceView.js";

// ── Fixtures (real-bin shapes, minimized) ──────────────────────────────

const UNIVERSE_DEFAULT: UniverseJson = {
  profile: "default",
  file: "C:\\governance\\policy.json",
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
    {
      pkg: "iris-ops-mcp",
      tools: [{ name: "iris_backup_manage", keys: ["iris_backup_manage:run", "iris_backup_manage:freeze"] }],
    },
  ],
  frameworkTool: { name: "iris_server_profiles", keys: ["iris_server_profiles"] },
  keys: [
    "iris_backup_manage:freeze",
    "iris_backup_manage:run",
    "iris_doc_get",
    "iris_doc_put",
    "iris_server_profiles",
  ],
  postFoundation: ["iris_backup_manage:freeze"],
  mutates: {
    "iris_backup_manage:freeze": "write",
    "iris_backup_manage:run": "write",
    iris_doc_get: "read",
    iris_doc_put: "write",
    iris_server_profiles: "read",
  },
  defaultEnabledWrites: [],
  policy: {
    "iris_backup_manage:freeze": false,
    "iris_backup_manage:run": true,
    iris_doc_get: true,
    iris_doc_put: false,
    iris_server_profiles: true,
  },
  configSource: {
    "iris_backup_manage:freeze": "default",
    "iris_backup_manage:run": "default",
    iris_doc_get: "default",
    iris_doc_put: "file",
    iris_server_profiles: "default",
  },
  note: "universe renders the FULL governance-key universe …",
};

const UNIVERSE_PROD: UniverseJson = {
  ...UNIVERSE_DEFAULT,
  profile: "prod",
  policy: { ...UNIVERSE_DEFAULT.policy, iris_doc_get: false },
  configSource: { ...UNIVERSE_DEFAULT.configSource, iris_doc_get: "file" },
};

const DIFF: DiffJson = {
  file: "C:\\governance\\policy.json",
  entries: [
    { layer: "global", key: "iris_doc_put", file: false, default: true, differs: true },
    { layer: 'profile "prod"', key: "iris_doc_get", file: false, default: true, differs: true },
  ],
  note: "keys not in the frozen baseline …",
};

const VALIDATE_OK: ValidateJson = { ok: true, file: "C:\\governance\\policy.json", globalKeys: 1, profiles: 1 };

function makeState(overrides: Partial<GovernanceViewState> = {}): GovernanceViewState {
  return {
    file: "C:\\governance\\policy.json",
    fileExists: true,
    engineMode: "local",
    validation: VALIDATE_OK,
    diff: DIFF,
    universeByTab: { [GLOBAL_TAB]: UNIVERSE_DEFAULT, prod: UNIVERSE_PROD },
    profileTabs: [GLOBAL_TAB, "default", "prod"],
    activeTab: GLOBAL_TAB,
    staged: [],
    preset: "",
    ...overrides,
  };
}

// ── Tabs + layers ──────────────────────────────────────────────────────

describe("computeProfileTabs / fileProfileNames", () => {
  it("parses profile names out of diff layer labels (the CLI's own `profile \"name\"` format)", () => {
    expect(fileProfileNames(DIFF)).toEqual(["prod"]);
    expect(fileProfileNames(undefined)).toEqual([]);
  });

  it("orders the global tab first, then the sorted union of `default`, Server Manager names, and file profile names — deduped", () => {
    expect(computeProfileTabs(["prod", "staging"], DIFF)).toEqual([
      GLOBAL_TAB,
      "default",
      "prod",
      "staging",
    ]);
    // A Server Manager name the file also names appears ONCE.
    expect(computeProfileTabs(["prod"], DIFF)).toEqual([GLOBAL_TAB, "default", "prod"]);
  });

  it("the global tab edits the global layer (undefined profile) and renders the reserved default profile", () => {
    expect(renderProfileForTab(GLOBAL_TAB)).toBe("default");
    expect(renderProfileForTab("prod")).toBe("prod");
  });

  it("a profile literally named \"global\" does NOT collide with the global-layer sentinel — it keeps its own tab and its own layer (32.2 review)", () => {
    const diff: DiffJson = {
      file: "C:\\governance\\policy.json",
      entries: [
        { layer: 'profile "global"', key: "iris_doc_get", file: true, default: true, differs: false },
      ],
      note: "…",
    };
    const tabs = computeProfileTabs(["global"], diff);
    // Exactly one sentinel tab plus the DISTINCT profile tab — no duplicate id.
    expect(tabs).toEqual([GLOBAL_TAB, "default", "global"]);
    expect(new Set(tabs).size).toBe(tabs.length);
    // The profile tab edits its OWN layer and renders its OWN profile.
    expect(layerForTab("global")).toBe("global");
    expect(renderProfileForTab("global")).toBe("global");
    expect(layerForTab(GLOBAL_TAB)).toBeUndefined();
    // …and its file value is visible on the profile tab, not the sentinel tab.
    const state = makeState({ diff, profileTabs: tabs, activeTab: "global" });
    expect(fileValueFor(state, "global", "iris_doc_get")).toBe(true);
    expect(fileValueFor(state, GLOBAL_TAB, "iris_doc_get")).toBeUndefined();
  });

  it("a profile name containing a NEWLINE still parses out of the diff layer label (32.2 review)", () => {
    const diff: DiffJson = {
      file: "C:\\governance\\policy.json",
      entries: [
        { layer: 'profile "line1\nline2"', key: "iris_doc_get", file: true, default: true, differs: false },
      ],
      note: "…",
    };
    expect(fileProfileNames(diff)).toEqual(["line1\nline2"]);
  });
});

// ── File values + tri-state toggles ────────────────────────────────────

describe("fileValueFor / toggleFor / stageToggle", () => {
  it("reads the file's OWN value per tab layer from the diff entries", () => {
    const state = makeState();
    expect(fileValueFor(state, GLOBAL_TAB, "iris_doc_put")).toBe(false);
    expect(fileValueFor(state, "prod", "iris_doc_get")).toBe(false);
    // The global layer's prod-only entry is NOT visible in the global tab…
    expect(fileValueFor(state, GLOBAL_TAB, "iris_doc_get")).toBeUndefined();
    // …and vice versa.
    expect(fileValueFor(state, "prod", "iris_doc_put")).toBeUndefined();
  });

  it("maps file values to toggle positions (true→enabled, false→disabled, unset→inherit)", () => {
    const state = makeState();
    expect(toggleFor(state, GLOBAL_TAB, "iris_doc_put")).toBe("disabled");
    expect(toggleFor(state, GLOBAL_TAB, "iris_doc_get")).toBe("inherit");
  });

  it("staging a change records it; staging the file's CURRENT value unstages (the pending list only holds real changes)", () => {
    let state = makeState();
    state = stageToggle(state, GLOBAL_TAB, "iris_doc_get", "enabled");
    expect(state.staged).toEqual([{ tab: GLOBAL_TAB, key: "iris_doc_get", value: true }]);
    expect(toggleFor(state, GLOBAL_TAB, "iris_doc_get")).toBe("enabled");

    // Toggling back to the file's current state (inherit/unset) unstages.
    state = stageToggle(state, GLOBAL_TAB, "iris_doc_get", "inherit");
    expect(state.staged).toEqual([]);

    // Staging a value EQUAL to the file's current value is a no-op unstage.
    state = stageToggle(state, GLOBAL_TAB, "iris_doc_put", "enabled");
    expect(state.staged).toEqual([{ tab: GLOBAL_TAB, key: "iris_doc_put", value: true }]);
    state = stageToggle(state, GLOBAL_TAB, "iris_doc_put", "disabled");
    expect(state.staged).toEqual([]);
  });

  it("staging in one tab does not leak into another tab's toggle", () => {
    let state = makeState();
    state = stageToggle(state, "prod", "iris_doc_get", "enabled");
    expect(toggleFor(state, "prod", "iris_doc_get")).toBe("enabled");
    expect(toggleFor(state, GLOBAL_TAB, "iris_doc_get")).toBe("inherit");
  });
});

// ── Toggle → set/unset command mapping + pending preview ───────────────

describe("stagedCliCommands / pendingChanges", () => {
  it("maps staged edits to set/unset CLI commands — global tab without --profile, profile tabs with it", () => {
    let state = makeState();
    state = stageToggle(state, GLOBAL_TAB, "iris_doc_get", "disabled");
    state = stageToggle(state, "prod", "iris_doc_get", "inherit");
    state = stageToggle(state, "prod", "iris_backup_manage:freeze", "enabled");

    expect(stagedCliCommands(state)).toEqual([
      { kind: "set", file: state.file, profile: undefined, key: "iris_doc_get", value: false },
      { kind: "set", file: state.file, profile: "prod", key: "iris_backup_manage:freeze", value: true },
      { kind: "unset", file: state.file, profile: "prod", key: "iris_doc_get" },
    ]);
  });

  it("orders by tab order, then key (deterministic save sequence)", () => {
    let state = makeState();
    state = stageToggle(state, "prod", "iris_doc_get", "inherit");
    state = stageToggle(state, GLOBAL_TAB, "iris_doc_get", "disabled");
    const commands = stagedCliCommands(state);
    expect(commands[0]?.profile).toBeUndefined(); // global tab first
    expect(commands[1]?.profile).toBe("prod");
  });

  it("renders the pending preview in display vocabulary (from → to)", () => {
    let state = makeState();
    state = stageToggle(state, GLOBAL_TAB, "iris_doc_put", "inherit");
    expect(pendingChanges(state)).toEqual([
      {
        tab: GLOBAL_TAB,
        key: "iris_doc_put",
        from: "disabled (false)",
        to: "inherit (unset)",
      },
    ]);
  });
});

// ── Grouping + badges (the effective-policy preview rows) ──────────────

describe("buildGroups / badges", () => {
  it("groups keys per package exactly as the universe render emits them, plus the framework group", () => {
    const groups = buildGroups(makeState());
    expect(groups.map((group) => group.pkg)).toEqual(["iris-dev-mcp", "iris-ops-mcp", "framework"]);
    expect(groups[0]?.tools.map((tool) => tool.tool)).toEqual(["iris_doc_get", "iris_doc_put"]);
    expect(groups[2]?.tools[0]?.rows[0]?.key).toBe("iris_server_profiles");
  });

  it("each row carries the effective value, its configSource badge, the mutates badge, the origin badge, and the toggle for the ACTIVE tab", () => {
    const state = makeState({ activeTab: GLOBAL_TAB });
    const devGroup = buildGroups(state)[0];
    const put = devGroup?.tools[1]?.rows[0];
    expect(put).toMatchObject({
      key: "iris_doc_put",
      mutates: "write",
      baseline: true,
      effective: false,
      source: "file",
      toggle: "disabled",
      staged: false,
    });
    const freeze = buildGroups(state)[1]?.tools[0]?.rows.find((row) => row.key === "iris_backup_manage:freeze");
    expect(freeze).toMatchObject({ mutates: "write", baseline: false, effective: false, source: "default" });
  });

  it("switches the rendered rows with the active tab (the prod tab shows the prod render and the prod layer's toggles)", () => {
    const state = makeState({ activeTab: "prod" });
    const docGet = buildGroups(state)[0]?.tools[0]?.rows[0];
    expect(docGet).toMatchObject({ effective: false, source: "file", toggle: "disabled" });
  });

  it("badge mappings are the documented vocabulary", () => {
    const state = makeState();
    const row = buildGroups(state)[0]?.tools[1]?.rows[0];
    expect(row && configSourceBadge(row.source)).toBe("file");
    expect(row && originBadge(row)).toBe("baseline");
    const freeze = buildGroups(state)[1]?.tools[0]?.rows.find((r) => r.key === "iris_backup_manage:freeze");
    expect(freeze && originBadge(freeze)).toBe("new");
  });

  it("a staged row is flagged for the staged-row highlight", () => {
    let state = makeState();
    state = stageToggle(state, GLOBAL_TAB, "iris_doc_get", "disabled");
    const docGet = buildGroups(state)[0]?.tools[0]?.rows[0];
    expect(docGet?.staged).toBe(true);
    expect(docGet?.toggle).toBe("disabled");
  });
});

// ── HTML rendering ─────────────────────────────────────────────────────

describe("renderGovernanceHtml", () => {
  it("renders the CSP nonce, the file path, the preset display, the tabs, and every key row with its tri-state select", () => {
    const html = renderGovernanceHtml(makeState(), "NONCE-1");
    expect(html).toContain("script-src 'nonce-NONCE-1'");
    expect(html).toContain("C:\\governance\\policy.json");
    expect(html).toContain("Preset (env-sourced, display only): unset");
    expect(html).toContain("global (file)");
    // data-msg attributes carry the message JSON HTML-escaped (quotes → &quot;).
    expect(html).toContain(
      "data-msg='{&quot;type&quot;:&quot;switchProfile&quot;,&quot;profile&quot;:&quot;prod&quot;}'",
    );
    expect(html).toContain('data-key="iris_doc_put"');
    expect(html).toContain('<option value="disabled" selected>');
    // Effective-policy summary (the AC 32.2.3 preview).
    expect(html).toContain("Effective policy for profile");
    expect(html).toContain("3 of 5 keys enabled");
    // The restart-to-apply contract (PD-3).
    expect(html).toContain("restart a server to apply");
  });

  it("renders the pending-changes section only when edits are staged, with the Save count", () => {
    const unstaged = renderGovernanceHtml(makeState(), "N");
    expect(unstaged).not.toContain("Pending changes");

    let state = makeState();
    state = stageToggle(state, GLOBAL_TAB, "iris_doc_get", "disabled");
    const html = renderGovernanceHtml(state, "N");
    expect(html).toContain("Pending changes (1)");
    expect(html).toContain("Save (1)");
    expect(html).toContain("inherit (unset)");
    expect(html).toContain("disabled (false)");
    expect(html).toContain("→");
  });

  it("renders the diff preview from the diff entries", () => {
    const html = renderGovernanceHtml(makeState(), "N");
    expect(html).toContain("Current file vs the default seed (2 entries)");
    expect(html).toContain('profile &quot;prod&quot;');
    expect(html).toContain("differs");
  });

  it("an invalid file renders the engine's OWN error, disables editing, and HTML-escapes the message", () => {
    const state = makeState({
      validation: { ok: false, error: 'IRIS_GOVERNANCE_FILE is invalid: <script>alert("x")</script>' },
      universeByTab: {},
    });
    const html = renderGovernanceHtml(state, "N");
    expect(html).toContain("The governance file is invalid");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Editing is disabled");
  });

  it("a missing file renders the server-startup-failure warning (the create-on-save flow)", () => {
    const html = renderGovernanceHtml(makeState({ fileExists: false, validation: undefined, diff: undefined }), "N");
    expect(html).toContain("This file does not exist yet");
    expect(html).toContain("FAILS TO START");
    expect(html).toContain("Save any change");
  });

  it("a load error renders inline", () => {
    const html = renderGovernanceHtml(makeState({ loadError: "npx is not on PATH" }), "N");
    expect(html).toContain("npx is not on PATH");
  });
});

describe("renderEmptyStateHtml", () => {
  it("offers the choose-file affordance and documents the governanceFile setting (J1: explicit path only)", () => {
    const html = renderEmptyStateHtml("NONCE-2");
    expect(html).toContain("script-src 'nonce-NONCE-2'");
    expect(html).toContain("data-msg='{&quot;type&quot;:&quot;chooseFile&quot;}'");
    expect(html).toContain("irisMcpLauncher.governanceFile");
    expect(html).toContain("IRIS_GOVERNANCE_FILE");
    expect(html).toContain("never discovered");
  });

  it("renders an engine resolution error when the CLI cannot be located", () => {
    const html = renderEmptyStateHtml("N", "The governance CLI is not built");
    expect(html).toContain("The governance CLI is not built");
  });
});
