import { describe, expect, it, vi } from "vitest";
import { planDefinitions } from "../definitions.js";
import {
  buildStatusBarState,
  resolveWriteTarget,
  selectServers,
  SELECT_SERVERS_COMMAND_ID,
  type ConfigInspection,
  type ConfigWriter,
  type ConfigWriteTarget,
  type SelectServersDeps,
  type SelectServersQuickPickItem,
} from "../selectServers.js";
import { readSettings, type ConfigReader } from "../settings.js";
import type { LauncherSettings, ServerManagerApi, ServerName } from "../types.js";

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
    auditLog: "",
    auditLogMaxMb: "",
    auditLogParams: "",
    toolsPreset: "",
    toolsDisable: "",
    toolsEnable: "",
    ...overrides,
  };
}

function serverName(name: string, overrides: Partial<ServerName> = {}): ServerName {
  return { name, description: `${name} description`, detail: `${name}.example.com:52773`, ...overrides };
}

/** Builds a full `SelectServersDeps`, capturing every side effect for assertions. Every field can be overridden. */
function makeDeps(opts: {
  serverNames?: ServerName[];
  getSettings?: () => LauncherSettings;
  smAvailable?: boolean;
  getServerNamesImpl?: () => ServerName[];
  pickResult?: SelectServersQuickPickItem[] | undefined;
  inspection?: ConfigInspection<string[]> | undefined;
  updateServersImpl?: (value: string[], target: ConfigWriteTarget) => PromiseLike<void>;
  confirmExposeAllImpl?: () => PromiseLike<boolean>;
}): {
  deps: SelectServersDeps;
  warnings: string[];
  infos: string[];
  updateCalls: { value: string[]; target: ConfigWriteTarget }[];
  quickPickCalls: SelectServersQuickPickItem[][];
  confirmCalls: number;
} {
  const confirmState = { confirmCalls: 0 };
  const warnings: string[] = [];
  const infos: string[] = [];
  const updateCalls: { value: string[]; target: ConfigWriteTarget }[] = [];
  const quickPickCalls: SelectServersQuickPickItem[][] = [];

  const smAvailable = opts.smAvailable ?? true;
  const names = opts.serverNames ?? [serverName("a"), serverName("b")];

  const api: ServerManagerApi = {
    getServerNames: opts.getServerNamesImpl ?? (() => names),
    getServerSpec: async () => undefined,
    getAccount: () => undefined,
  };

  const configWriter: ConfigWriter = {
    inspectServers: () => opts.inspection,
    updateServers:
      opts.updateServersImpl ??
      ((value, target) => {
        updateCalls.push({ value, target });
        return Promise.resolve();
      }),
  };

  const deps: SelectServersDeps = {
    getServerManagerApi: async () => (smAvailable ? api : undefined),
    getSettings: opts.getSettings ?? (() => settings()),
    configWriter,
    showQuickPick: (items) => {
      quickPickCalls.push(items);
      return Promise.resolve(opts.pickResult);
    },
    ...(opts.confirmExposeAllImpl
      ? {
          confirmExposeAll: () => {
            confirmState.confirmCalls++;
            return opts.confirmExposeAllImpl!();
          },
        }
      : {}),
    showWarning: (message) => warnings.push(message),
    showInfo: (message) => infos.push(message),
  };

  return {
    deps,
    warnings,
    infos,
    updateCalls,
    quickPickCalls,
    // Read at assertion time (not at makeDeps time) — the count of confirmExposeAll invocations.
    get confirmCalls() {
      return confirmState.confirmCalls;
    },
  };
}

describe("selectServers — happy path", () => {
  it("builds one QuickPick item per Server Manager server, label=name, description/detail carried through, pre-checked from current settings.servers", async () => {
    const { deps, quickPickCalls, updateCalls, infos } = makeDeps({
      serverNames: [serverName("a"), serverName("b"), serverName("c")],
      getSettings: () => settings({ servers: ["b"] }),
      pickResult: [{ label: "a" }, { label: "b" }],
    });

    await selectServers(deps);

    expect(quickPickCalls).toHaveLength(1);
    const items = quickPickCalls[0]!;
    expect(items.map((i) => i.label)).toEqual(["a", "b", "c"]);
    expect(items.map((i) => i.picked)).toEqual([false, true, false]);
    expect(items[0]!.description).toBe("a description");
    expect(items[0]!.detail).toBe("a.example.com:52773");

    expect(updateCalls).toEqual([{ value: ["a", "b"], target: "global" }]);
    expect(infos).toHaveLength(1);
    expect(infos[0]).toContain("2 servers");
    expect(infos[0]).toContain("your user (global)");
    expect(infos[0]).toContain("irisMcpLauncher.servers");
    expect(infos[0]!.toLowerCase()).toMatch(/reload|restart/);
  });

  it("confirming with everything unchecked writes an empty array (does not throw, does not skip the write) and the confirmation explains what that means", async () => {
    const { deps, updateCalls, infos } = makeDeps({ pickResult: [] });

    await selectServers(deps);

    expect(updateCalls).toEqual([{ value: [], target: "global" }]);
    expect(infos[0]).toContain("0 servers");
    expect(infos[0]).toContain("every server");
  });
});

describe("selectServers — cancellation leaves configuration byte-unchanged (AC 31.5.1)", () => {
  it("showQuickPick resolving undefined (the real dismiss shape — see oracle comment in selectServers.ts) never calls the config write port", async () => {
    const { deps, updateCalls, warnings, infos } = makeDeps({ pickResult: undefined });

    await selectServers(deps);

    expect(updateCalls).toEqual([]);
    expect(warnings).toEqual([]);
    expect(infos).toEqual([]);
  });
});

describe("selectServers — empty Server Manager roster (Task 1)", () => {
  it("shows exactly one actionable warning and never opens the picker or touches config", async () => {
    const { deps, warnings, quickPickCalls, updateCalls } = makeDeps({ serverNames: [] });

    await selectServers(deps);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("no servers configured");
    expect(quickPickCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
  });
});

describe("selectServers — failure containment (AC 31.5.5)", () => {
  it("Server Manager extension unavailable: exactly one warning, no picker, no config touch", async () => {
    const { deps, warnings, quickPickCalls, updateCalls } = makeDeps({ smAvailable: false });

    await selectServers(deps);

    expect(warnings).toHaveLength(1);
    expect(quickPickCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
  });

  it("getServerManagerApi() REJECTS (not just resolves undefined): exactly one warning, no picker, no config touch, no unhandled rejection out of the command handler", async () => {
    // Code review (Story 31.5): this was the one third-party call on the
    // command path left outside any try/catch, while the QA pass had already
    // guarded `showQuickPick` and `inspectServers` on exactly this reasoning.
    // `extension.ts`'s real `getServerManagerApi` awaits
    // `extension.activate()` on a third-party extension, so a rejection is
    // reachable — and `registerCommand(ID, () => selectServers(deps))` hands
    // the returned promise straight to VS Code, which renders the rejection
    // reason to the user. Mutation-verified: reverting the try/catch in
    // `selectServers.ts` turns this test red with an unhandled rejection.
    const { deps, warnings, quickPickCalls, updateCalls } = makeDeps({});
    deps.getServerManagerApi = () => Promise.reject(new Error("EACCES: activate() blew up"));

    await expect(selectServers(deps)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("EACCES");
    expect(quickPickCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
  });

  it("api.getServerNames() throws: exactly one warning, no picker, no config touch, no unhandled rejection", async () => {
    const { deps, warnings, quickPickCalls } = makeDeps({
      getServerNamesImpl: () => {
        throw new Error("boom");
      },
    });

    await expect(selectServers(deps)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(quickPickCalls).toEqual([]);
  });

  it("getSettings() throws: exactly one warning, no picker, no config touch", async () => {
    const { deps, warnings, quickPickCalls } = makeDeps({
      getSettings: () => {
        throw new Error("bad settings.json");
      },
    });

    await expect(selectServers(deps)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(quickPickCalls).toEqual([]);
  });

  it("configWriter.updateServers rejects: exactly one warning naming the scope, no third-party error text forwarded, no info confirmation", async () => {
    const { deps, warnings, infos } = makeDeps({
      pickResult: [{ label: "a" }],
      inspection: { workspaceValue: ["a"] },
      updateServersImpl: () => Promise.reject(new Error("EACCES: permission denied secret-detail")),
    });

    await expect(selectServers(deps)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("EACCES");
    expect(warnings[0]).not.toContain("secret-detail");
    expect(warnings[0]).toContain("this workspace's");
    expect(infos).toEqual([]);
  });
});

describe("selectServers — duplicate / whitespace server names (Task 6)", () => {
  it("Server Manager reporting a duplicate name only produces ONE QuickPick item (last one wins, mirroring LauncherProvider's scope Map)", async () => {
    const { deps, quickPickCalls } = makeDeps({
      serverNames: [
        serverName("prod", { description: "first (folder scope)" }),
        serverName("prod", { description: "second (workspace scope)" }),
      ],
      pickResult: [],
    });

    await selectServers(deps);

    const items = quickPickCalls[0]!;
    expect(items).toHaveLength(1);
    expect(items[0]!.description).toBe("second (workspace scope)");
  });

  it("a duplicate label somehow returned by the picker is de-duplicated before writing (defensive — the QuickPick must never write duplicates, 31.4 review finding)", async () => {
    const { deps, updateCalls } = makeDeps({
      serverNames: [serverName("a")],
      pickResult: [{ label: "a" }, { label: "a" }],
    });

    await selectServers(deps);

    expect(updateCalls).toEqual([{ value: ["a"], target: "global" }]);
  });

  it("current settings.servers containing duplicates and whitespace-only entries does not crash the pre-check computation", async () => {
    const { deps, quickPickCalls } = makeDeps({
      serverNames: [serverName("a"), serverName("b")],
      getSettings: () => settings({ servers: ["a", "a", "   ", ""] }),
      pickResult: [],
    });

    await selectServers(deps);

    const items = quickPickCalls[0]!;
    expect(items.find((i) => i.label === "a")!.picked).toBe(true);
    expect(items.find((i) => i.label === "b")!.picked).toBe(false);
  });
});

describe("selectServers — configured servers Server Manager is not currently reporting (code review, Story 31.5)", () => {
  /**
   * Regression pin for a silent data-loss path: the written value used to be a
   * pure function of the CURRENT Server Manager roster, so a name already in
   * `irisMcpLauncher.servers` that Server Manager did not happen to report in
   * this window (a workspace-scoped server, a window without that folder open,
   * a Server Manager still loading) was deleted from the user's settings by
   * simply confirming the picker with no changes. Mutation-verified: dropping
   * the `unreportedSelected` items from `selectServers.ts` turns the first two
   * tests below red.
   */
  it("carries a configured-but-unreported name through as a PRE-CHECKED item, so confirming with no changes is byte-neutral instead of deleting it", async () => {
    const { deps, quickPickCalls, updateCalls } = makeDeps({
      serverNames: [serverName("prod")],
      getSettings: () => settings({ servers: ["prod", "staging"] }),
      // The user changes nothing: both items come back exactly as presented.
      pickResult: [{ label: "prod" }, { label: "staging" }],
    });

    await selectServers(deps);

    const items = quickPickCalls[0]!;
    expect(items.map((i) => i.label)).toEqual(["prod", "staging"]);
    expect(items.map((i) => i.picked)).toEqual([true, true]);
    expect(items[1]!.description).toContain("not currently reported");
    expect(updateCalls).toEqual([{ value: ["prod", "staging"], target: "global" }]);
  });

  it("the carried-through name is still REMOVABLE — unchecking it writes it away, so this is not a setting the user can no longer edit", async () => {
    const { deps, updateCalls } = makeDeps({
      serverNames: [serverName("prod")],
      getSettings: () => settings({ servers: ["prod", "staging"] }),
      pickResult: [{ label: "prod" }],
    });

    await selectServers(deps);

    expect(updateCalls).toEqual([{ value: ["prod"], target: "global" }]);
  });

  it("blank / whitespace-only configured entries are NOT carried through — they can match no server and a blank picker row is not actionable", async () => {
    const { deps, quickPickCalls } = makeDeps({
      serverNames: [serverName("prod")],
      getSettings: () => settings({ servers: ["prod", "", "   "] }),
      pickResult: [],
    });

    await selectServers(deps);

    expect(quickPickCalls[0]!.map((i) => i.label)).toEqual(["prod"]);
  });

  it("a configured name duplicated in settings.servers produces exactly ONE carried-through item", async () => {
    const { deps, quickPickCalls } = makeDeps({
      serverNames: [serverName("prod")],
      getSettings: () => settings({ servers: ["staging", "staging"] }),
      pickResult: [],
    });

    await selectServers(deps);

    expect(quickPickCalls[0]!.map((i) => i.label)).toEqual(["prod", "staging"]);
  });
});

describe("resolveWriteTarget — scope selection across every inspect() shape the REAL API can produce (AC 31.5.2, as amended at code review)", () => {
  /**
   * Oracle (Rule #36) for why `workspaceFolder` is NOT a candidate — read from
   * the installed declaration, not reasoned from memory:
   * `node_modules/@types/vscode/index.d.ts:6943-6948`,
   * `WorkspaceConfiguration.update`'s documented throws, include BOTH
   *   "- window configuration to workspace folder"
   *   "- configuration to workspace folder when {@link WorkspaceConfiguration} is not scoped to a resource."
   * `package.json` declares `irisMcpLauncher.servers` with no `"scope"`, so it
   * takes VS Code's default `window` scope; `extension.ts` obtains an UNSCOPED
   * `WorkspaceConfiguration` (matching the unscoped READ path in
   * `settings.ts`). Both conditions hold, so a WorkspaceFolder-target write is
   * documented to reject and an unscoped `inspect()` of a window-scoped
   * setting can never populate `workspaceFolderValue`. The original
   * implementation branched on it anyway and was proven "correct" by fakes
   * returning a shape the real API cannot produce — the same green-suite-over-
   * an-impossible-path defect Story 31.4's review headlined.
   */
  it("only workspaceValue defined -> workspace", () => {
    expect(resolveWriteTarget({ workspaceValue: ["a"], globalValue: ["b"] })).toBe("workspace");
  });

  it("only globalValue defined -> global", () => {
    expect(resolveWriteTarget({ globalValue: ["a"] })).toBe("global");
  });

  it("nothing defined (empty inspection object) -> global (the documented fallback)", () => {
    expect(resolveWriteTarget({})).toBe("global");
  });

  it("inspect() itself returns undefined (setting not registered) -> global", () => {
    expect(resolveWriteTarget(undefined)).toBe("global");
  });

  it("a workspaceFolderValue somehow present is IGNORED, never chosen as a write target — the real update() is documented to reject a window-scoped setting written to WorkspaceFolder, so choosing it could only ever produce a failed save", () => {
    expect(
      resolveWriteTarget({
        workspaceFolderValue: ["folder"],
        workspaceValue: ["ws"],
        globalValue: ["global"],
      } as ConfigInspection<string[]>),
    ).toBe("workspace");

    expect(
      resolveWriteTarget({ workspaceFolderValue: ["folder"] } as ConfigInspection<string[]>),
    ).toBe("global");
  });
});

describe("buildStatusBarState — AC 31.5.3", () => {
  it("zero servers selected -> discoverable zero-state text, tooltip explains the 'every server' default and how to change it", () => {
    const state = buildStatusBarState(settings({ servers: [], packages: ["dev", "admin"] }));

    expect(state.text).toBe("$(server) IRIS MCP: none");
    expect(state.tooltip).toContain("no servers selected");
    expect(state.tooltip).toContain("every server");
    expect(state.tooltip).toContain("dev, admin");
  });

  it("servers selected -> count in the text, tooltip names the selected servers and packages", () => {
    const state = buildStatusBarState(
      settings({ servers: ["prod", "staging"], packages: ["dev"] }),
    );

    expect(state.text).toBe("$(server) IRIS MCP: 2");
    expect(state.tooltip).toContain("prod, staging");
    expect(state.tooltip).toContain("dev");
  });

  it("one server selected uses the same '$(server) IRIS MCP: <n>' shape (n=1)", () => {
    const state = buildStatusBarState(settings({ servers: ["prod"] }));
    expect(state.text).toBe("$(server) IRIS MCP: 1");
  });

  it("zero packages configured is still rendered (not a crash / not 'undefined') in the tooltip", () => {
    const state = buildStatusBarState(settings({ servers: [], packages: [] }));
    expect(state.tooltip).toContain("(none configured)");
  });

  describe("AC 31.6.7 — development mode surfaced in the tooltip only, text/count/zero-state untouched", () => {
    it("developmentRepoPath set -> tooltip names development mode and the path, in BOTH the zero-state and populated-count tooltips", () => {
      const zeroState = buildStatusBarState(
        settings({ servers: [], packages: ["dev"], developmentRepoPath: "/home/dev/iris-execute-mcp-v2" }),
      );
      expect(zeroState.text).toBe("$(server) IRIS MCP: none"); // AC 31.5.3's zero-state text is pinned — unchanged
      expect(zeroState.tooltip).toContain("Development mode");
      expect(zeroState.tooltip).toContain("/home/dev/iris-execute-mcp-v2");

      const populatedState = buildStatusBarState(
        settings({
          servers: ["prod"],
          packages: ["dev"],
          developmentRepoPath: "/home/dev/iris-execute-mcp-v2",
        }),
      );
      expect(populatedState.text).toBe("$(server) IRIS MCP: 1"); // AC 31.5.3's count shape is pinned — unchanged
      expect(populatedState.tooltip).toContain("Development mode");
      expect(populatedState.tooltip).toContain("/home/dev/iris-execute-mcp-v2");
    });

    it("developmentRepoPath empty (default) -> no 'Development mode' line in either tooltip shape (back-compat, AC 31.6.6's spirit extended to the tooltip)", () => {
      const zeroState = buildStatusBarState(settings({ servers: [], packages: ["dev"] }));
      expect(zeroState.tooltip).not.toContain("Development mode");

      const populatedState = buildStatusBarState(settings({ servers: ["prod"], packages: ["dev"] }));
      expect(populatedState.tooltip).not.toContain("Development mode");
    });
  });
});

describe("SELECT_SERVERS_COMMAND_ID", () => {
  it("is the id package.json's contributes.commands and extension.ts's registerCommand call are both checked against", () => {
    expect(SELECT_SERVERS_COMMAND_ID).toBe("irisMcpLauncher.selectServers");
  });
});

describe("credential containment — selectServers() never echoes an unrelated settings field (AC 31.5.5, extended to the new UI surfaces)", () => {
  const MARKER = "DO-NOT-LEAK-SELECT-SERVERS-9c1f7e2b";

  it("a distinctive marker placed in governance/auditLog/toolsDisable (fields this module must never read) never appears in a QuickPick item, or a showWarning/showInfo call", async () => {
    const { deps, quickPickCalls, warnings, infos } = makeDeps({
      serverNames: [serverName("a")],
      getSettings: () =>
        settings({
          servers: [],
          governance: MARKER,
          auditLog: MARKER,
          auditLogParams: MARKER,
          toolsDisable: MARKER,
          toolsEnable: MARKER,
          namespace: MARKER,
        }),
      pickResult: [{ label: "a" }],
    });

    await selectServers(deps);

    for (const items of quickPickCalls) {
      for (const item of items) {
        expect(item.label).not.toContain(MARKER);
        expect(item.description ?? "").not.toContain(MARKER);
        expect(item.detail ?? "").not.toContain(MARKER);
      }
    }
    for (const message of [...warnings, ...infos]) {
      expect(message).not.toContain(MARKER);
    }
  });

  // NOTE (code review, Story 31.5): a second `it(...)` here whose body was
  // `expect(true).toBe(true)` was REMOVED. Its title claimed a structural
  // source check it did not perform, it could never fail, and it inflated the
  // suite count. The real mechanical proof is
  // `containment.test.ts`'s "selectServers.ts's CODE ... references NO
  // credential-bearing identifier" test, which greps the file from disk.
});

describe("Integration AC 31.5.8 — the value selectServers WRITES is exactly what the 31.4 provider READS", () => {
  /**
   * Wraps raw stored values into the `(section) => ConfigReader` shape
   * `readSettings` expects — the REAL function, not a fake of it. `rawValues`
   * models the FULL persisted `irisMcpLauncher.*` settings.json at read time
   * (which may set other keys, like `packages`, independently of whatever
   * `selectServers()` itself wrote to `servers`).
   */
  function configReaderFor(rawValues: Record<string, unknown>): (section: string) => ConfigReader {
    return () => ({
      get: <T>(key: string, defaultValue: T): T =>
        key in rawValues ? (rawValues[key] as T) : defaultValue,
    });
  }

  it("feeds the write helper's OWN output through the REAL readSettings -> planDefinitions path; the resulting plan matches the selection (not a hand-built literal)", async () => {
    const { deps, updateCalls } = makeDeps({
      serverNames: [serverName("prod"), serverName("staging"), serverName("dev-box")],
      pickResult: [{ label: "prod" }, { label: "dev-box" }],
    });

    await selectServers(deps);
    expect(updateCalls).toHaveLength(1);
    const written = updateCalls[0]!.value;
    expect(written).toEqual(["prod", "dev-box"]);

    // Simulate the round trip: what the command just wrote is now literally
    // what `WorkspaceConfiguration.get("servers", ...)` would return after a
    // reload — fed through the REAL readSettings, not a re-derived fixture.
    const roundTripped = readSettings(
      configReaderFor({ servers: written, packages: ["dev"] }),
    );
    expect(roundTripped.servers).toEqual(written);

    const plan = planDefinitions(roundTripped, ["prod", "staging", "dev-box"]);
    expect(plan.map((p) => p.serverNames).sort()).toEqual([["dev-box"], ["prod"]]);
    expect(plan.every((p) => p.packageKey === "dev")).toBe(true); // default fixture settings() -> packages: ["dev"]
  });

  it("a round trip through settings.json hostile-input coercion (duplicate + non-string member + whitespace-only entry alongside the real written names) still produces the correct plan — the exact edge cases readSettings already guards", () => {
    // Simulates settings.json drifting between the write and the next read
    // (hand-edit, or a stale duplicate) rather than a hand-built literal for
    // the stored value.
    const rawStored: unknown[] = ["prod", "prod", 42, null, "   ", "dev-box"];

    const roundTripped = readSettings(
      configReaderFor({ servers: rawStored, packages: ["dev"] }),
    );
    // readSettings drops non-string members but does NOT dedupe or trim —
    // that happens in planDefinitions (definitions.ts's own documented
    // contract, unchanged by this story).
    expect(roundTripped.servers).toEqual(["prod", "prod", "   ", "dev-box"]);

    const plan = planDefinitions(roundTripped, ["prod", "staging", "dev-box"]);
    // "   " matches no available server name (never trimmed) and is dropped;
    // the duplicate "prod" is de-duplicated by planDefinitions's own Set.
    expect(plan.map((p) => p.serverNames).sort()).toEqual([["dev-box"], ["prod"]]);
  });

  it("a rename or shape change on either side fails this test: asserting against the REAL DefinitionPlan shape (label/packageKey/serverNames), not a re-typed literal", async () => {
    // irisMcpLauncher.packages is already "admin" in settings.json,
    // independently of whatever this command writes to .servers — proving
    // the round trip composes correctly with a setting selectServers.ts
    // itself never touches.
    const { deps, updateCalls } = makeDeps({
      serverNames: [serverName("only-server")],
      getSettings: () => settings({ packages: ["admin"] }),
      pickResult: [{ label: "only-server" }],
    });

    await selectServers(deps);
    const written = updateCalls[0]!.value;

    const roundTripped = readSettings(
      configReaderFor({ servers: written, packages: ["admin"] }),
    );
    const plan = planDefinitions(roundTripped, ["only-server"]);

    expect(plan).toEqual([
      { label: "IRIS Admin Tools — only-server", packageKey: "admin", serverNames: ["only-server"] },
    ]);
  });
});

describe("selectServers — containment for showQuickPick/inspectServers failures (QA pass, AC 31.5.5)", () => {
  /**
   * Neither `deps.showQuickPick` nor `deps.configWriter.inspectServers` was
   * wrapped in try/catch in the original implementation, even though every
   * OTHER third-party call on this path (`getServerNames`+`getSettings`,
   * `configWriter.updateServers`) was — inconsistent with the 31.4-review bar
   * the story's own Dev Notes cite verbatim: "Every third-party call on a
   * user-facing path is guarded; a failure maps to exactly ONE warning...
   * Hold that bar." A throw from either call would reject `selectServers()`
   * itself — an unhandled rejection out of the command handler registered in
   * `extension.ts` (`registerCommand(SELECT_SERVERS_COMMAND_ID, () =>
   * selectServers(...))`), which is exactly what AC 31.5.5 rules out. Fixed
   * as part of this QA pass (mirrors the `updateServers` try/catch already
   * present); these are the regression tests pinning the fix. Mutation-verified
   * (Rule #48): reverting the fix turns both tests below red.
   */
  it("showQuickPick() rejecting is contained to exactly one warning — never an unhandled rejection out of selectServers()", async () => {
    const { deps, warnings, infos, updateCalls } = makeDeps({});
    deps.showQuickPick = () => Promise.reject(new Error("EPIPE: quick pick host disposed"));

    await expect(selectServers(deps)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("EPIPE");
    expect(infos).toEqual([]);
    expect(updateCalls).toEqual([]);
  });

  it("showQuickPick() throwing synchronously is contained the same way as a rejection", async () => {
    const { deps, warnings, updateCalls } = makeDeps({});
    deps.showQuickPick = () => {
      throw new Error("synchronous host failure");
    };

    await expect(selectServers(deps)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(updateCalls).toEqual([]);
  });

  it("configWriter.inspectServers() throwing is contained to exactly one warning — never an unhandled rejection, and the write is never attempted with an unresolved scope", async () => {
    const { deps, warnings, infos, updateCalls } = makeDeps({
      pickResult: [{ label: "a" }],
    });
    deps.configWriter.inspectServers = () => {
      throw new Error("EPERM: workspace configuration unavailable");
    };

    await expect(selectServers(deps)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain("EPERM");
    expect(infos).toEqual([]);
    expect(updateCalls).toEqual([]);
  });
});

describe("resolveWriteTarget — hostile/edge inspect() shapes beyond the documented cases (QA pass)", () => {
  it("workspaceValue defined as an EMPTY array still counts as 'defined' -> workspace, not global (must be a !==undefined check, not a truthiness check — an empty array is falsy-ish but IS the already-chosen scope)", () => {
    expect(resolveWriteTarget({ workspaceValue: [], globalValue: ["a"] })).toBe("workspace");
  });

  it("a malformed stored workspaceValue (null, from a hand-edited settings.json — WorkspaceConfiguration.inspect() is untyped at runtime, same as .get()) still counts as 'defined', so the write self-heals that scope rather than silently falling through to global", () => {
    const hostileInspection = {
      workspaceValue: null,
    } as unknown as ConfigInspection<string[]>;
    expect(resolveWriteTarget(hostileInspection)).toBe("workspace");
  });

  it("a malformed stored globalValue does not matter — global is the fallback either way", () => {
    const hostileInspection = { globalValue: null } as unknown as ConfigInspection<string[]>;
    expect(resolveWriteTarget(hostileInspection)).toBe("global");
  });
});

describe("selectServers — repeated / overlapping invocation carries no shared module state", () => {
  /**
   * Retitled at code review (Story 31.5). This block previously claimed to
   * cover "a real user double-clicking the status bar item" — a scenario the
   * REAL host cannot produce: `@types/vscode@1.125.0` `QuickInput.show`
   * (index.d.ts ~13129) states "Any other input UI will first fire an
   * {@link QuickInput.onDidHide onDidHide} event", and `QuickInput.hide`'s doc
   * lists "some other input UI opening" among the reasons the UI is hidden —
   * so opening a second picker DISMISSES the first, resolving its
   * `showQuickPick` with `undefined` (one cancel + one write, not two writes).
   * What these tests genuinely prove is that `selectServers()` holds no
   * module-level mutable state, so completion order cannot cross-contaminate
   * two runs. Kept under that honest title.
   */
  it("two overlapping invocations whose pickers resolve out of order write their own selection with no cross-talk (statelessness proof)", async () => {
    const { deps, updateCalls } = makeDeps({
      serverNames: [serverName("a"), serverName("b")],
    });
    const resolvers: Array<(v: SelectServersQuickPickItem[] | undefined) => void> = [];
    deps.showQuickPick = () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      });

    const first = selectServers(deps);
    const second = selectServers(deps);
    // Each call crosses an earlier `await deps.getServerManagerApi()` before
    // ever reaching `showQuickPick` — wait for both microtask chains to catch
    // up rather than assuming they've already run synchronously.
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));

    // Resolve the SECOND call's picker first, simulating out-of-order UI
    // resolution — selectServers() carries no shared mutable state across
    // calls (every value is a local const/let inside the function body), so
    // completion order must not matter.
    resolvers[1]!([{ label: "b" }]);
    resolvers[0]!([{ label: "a" }]);

    await Promise.all([first, second]);

    expect(updateCalls).toHaveLength(2);
    expect(updateCalls.map((c) => c.value).sort()).toEqual([["a"], ["b"]]);
  });

  it("repeated sequential invocations each reflect the CURRENT settings.servers for pre-checking — no stale state carried between calls", async () => {
    let currentServers = ["a"];
    const { deps, quickPickCalls } = makeDeps({
      serverNames: [serverName("a"), serverName("b")],
      getSettings: () => settings({ servers: currentServers }),
      pickResult: [],
    });

    await selectServers(deps);
    expect(quickPickCalls[0]!.find((i) => i.label === "a")!.picked).toBe(true);
    expect(quickPickCalls[0]!.find((i) => i.label === "b")!.picked).toBe(false);

    currentServers = ["b"];
    await selectServers(deps);
    expect(quickPickCalls[1]!.find((i) => i.label === "a")!.picked).toBe(false);
    expect(quickPickCalls[1]!.find((i) => i.label === "b")!.picked).toBe(true);
  });

  it("one call's config-write failure does not affect a second, independent call that succeeds", async () => {
    let rejectNext = true;
    // `updateServersImpl` overrides makeDeps's default push-to-`updateCalls`
    // behavior entirely, so this test tracks successful calls itself.
    const successfulCalls: { value: string[]; target: ConfigWriteTarget }[] = [];
    const { deps, warnings } = makeDeps({
      pickResult: [{ label: "a" }],
      inspection: { globalValue: ["x"] },
      updateServersImpl: (value, target) => {
        if (rejectNext) {
          rejectNext = false;
          return Promise.reject(new Error("first call: transient failure"));
        }
        successfulCalls.push({ value, target });
        return Promise.resolve();
      },
    });

    await selectServers(deps); // fails, contained to one warning
    await selectServers(deps); // succeeds independently

    expect(warnings).toHaveLength(1);
    expect(successfulCalls).toEqual([{ value: ["a"], target: "global" }]);
  });
});

describe("buildStatusBarState — hostile settings.servers state a hand-edited settings.json can produce (QA pass)", () => {
  it("duplicate entries in the raw irisMcpLauncher.servers array are counted verbatim (NOT de-duplicated) — pins CURRENT behavior; note this can diverge from the actually-registered server count, since planDefinitions() DOES de-duplicate (definitions.ts) — see Issues Encountered for the resulting UX discrepancy this documents", () => {
    const state = buildStatusBarState(settings({ servers: ["prod", "prod"], packages: ["dev"] }));
    expect(state.text).toBe("$(server) IRIS MCP: 2");
    expect(state.tooltip).toContain("prod, prod");
  });

  it("a server name that is an empty string or whitespace-only does not crash the computation and is still counted/listed verbatim", () => {
    const state = buildStatusBarState(settings({ servers: ["", "   ", "prod"], packages: ["dev"] }));
    expect(state.text).toBe("$(server) IRIS MCP: 3");
    expect(state.tooltip).toContain("prod");
  });
});

describe("selectServers — adversarial Server Manager data (QA pass)", () => {
  it("a Server Manager server with an empty-string name still produces a QuickPick item and, if picked, is written verbatim — no crash, no silent drop", async () => {
    const { deps, quickPickCalls, updateCalls } = makeDeps({
      serverNames: [serverName(""), serverName("b")],
      pickResult: [{ label: "" }],
    });

    await selectServers(deps);

    expect(quickPickCalls[0]!.map((i) => i.label)).toEqual(["", "b"]);
    expect(updateCalls).toEqual([{ value: [""], target: "global" }]);
  });

  it("Server Manager returning duplicate names where every occurrence has a DIFFERENT description does not crash and keeps exactly one item (last-wins), never two items racing for the same picker checkbox", async () => {
    const { deps, quickPickCalls } = makeDeps({
      serverNames: [serverName("prod", { description: "d1" }), serverName("prod", { description: "d2" }), serverName("prod", { description: "d3" })],
      pickResult: [],
    });

    await selectServers(deps);

    const items = quickPickCalls[0]!;
    expect(items).toHaveLength(1);
    expect(items[0]!.description).toBe("d3");
  });
});

describe("Rule #19 back-compat — selectServers.ts has zero effect on the 31.4 provider path when never invoked", () => {
  it("LauncherProvider.providePlannedDefinitions/resolveEnvForLabel are byte-identical to their pre-31.5 shape for a fixed fixture, independent of anything in selectServers.ts", async () => {
    // Deliberately does NOT import anything from selectServers.ts — this
    // proves the 31.4 provider path is unaffected by this story's additions
    // by construction, not by inspection. Pinned expected values (Rule #36:
    // this IS the oracle — the pre-31.5 `LauncherProvider` contract) fail on
    // drift if `serverDefinitionProvider.ts`, `definitions.ts`, or `env.ts`
    // were ever touched as a side effect of this story.
    const { LauncherProvider } = await import("../serverDefinitionProvider.js");

    const api: ServerManagerApi = {
      getServerNames: () => [serverName("prod")],
      getServerSpec: async () => ({
        name: "prod",
        webServer: { host: "prod.example.com", port: 52773, scheme: "http" },
        username: "_SYSTEM",
        password: "SYS",
      }),
      getAccount: () => ({ id: "acct-1", label: "Account One" }),
    };

    const provider = new LauncherProvider({
      getServerManagerApi: async () => api,
      authApi: { getSession: vi.fn() as never },
      getSettings: () => settings({ packages: ["dev"], servers: ["prod"] }),
      showWarning: () => {},
    });

    const planned = await provider.providePlannedDefinitions();
    expect(planned).toEqual([
      { label: "IRIS Dev Tools — prod", command: "npx", args: ["-y", "@iris-mcp/dev"] },
    ]);

    // Code review (Story 31.5): this was five spot-checks
    // (IRIS_HOST/PORT/USERNAME/PASSWORD/NAMESPACE) on a ~20-key record, so a
    // Rule #19 "byte-identical env synthesis" claim would have survived an
    // added key, a changed IRIS_HTTPS, or a dropped `null` clear from
    // `env.ts`'s LAUNCHER_OWNED_VARS. Pinned as a WHOLE-OBJECT `toEqual`
    // instead — that is what actually fails on drift.
    const env = await provider.resolveEnvForLabel("IRIS Dev Tools — prod");
    expect(env).toEqual({
      IRIS_HOST: "prod.example.com",
      IRIS_PORT: "52773",
      IRIS_USERNAME: "_SYSTEM",
      IRIS_PASSWORD: "SYS",
      IRIS_NAMESPACE: "HSCUSTOM",
      // Captured from the REAL `resolveEnvForLabel` return value, not
      // hand-reasoned (Rule #36): the fixture's `scheme: "http"` makes
      // `https` false, which `env.ts` emits as the STRING "false" — not as a
      // `null` clear. Hand-reasoning this one key wrong is precisely the
      // failure mode the previous five-key spot-check could not surface.
      IRIS_HTTPS: "false",
      IRIS_PROFILES: null,
      IRIS_GOVERNANCE: null,
      IRIS_GOVERNANCE_PRESET: null,
      IRIS_AUDIT_LOG: null,
      IRIS_AUDIT_LOG_MAX_MB: null,
      IRIS_AUDIT_LOG_PARAMS: null,
      IRIS_TOOLS_PRESET: null,
      IRIS_TOOLS_DISABLE: null,
      IRIS_TOOLS_ENABLE: null,
      IRIS_SERVER_MANAGER: null,
      IRIS_SM_SERVERS: null,
      IRIS_SM_SETTINGS_PATHS: null,
      IRIS_SM_WORKSPACE: null,
      IRIS_CREDENTIAL_HELPER: null,
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Story 32.3 deferred-item burn-down: 31-5-3 confirm-before-empty, 31-5-5
// theme-icon escaping, 31-5-2 effective status-bar count, 31-6-4 dev-mode
// wording from the registered count.
// ══════════════════════════════════════════════════════════════════════════

describe("Story 32.3 — 31-5-3: uncheck-all means expose-ALL (the inverse gesture), so it is confirmed first", () => {
  it("confirm DECLINED: no write happens at all (same byte-unchanged contract as dismissing the picker)", async () => {
    const harness = makeDeps({
      getSettings: () => settings({ servers: ["a"] }),
      pickResult: [],
      confirmExposeAllImpl: async () => false,
    });

    await selectServers(harness.deps);

    // Read AFTER the command ran — the getter snapshots at access time.
    expect(harness.confirmCalls).toBe(1);
    expect(harness.updateCalls).toEqual([]);
    expect(harness.infos).toEqual([]);
  });

  it("confirm ACCEPTED: the empty selection is written (expose-all is the documented default)", async () => {
    const harness = makeDeps({
      getSettings: () => settings({ servers: ["a"] }),
      pickResult: [],
      confirmExposeAllImpl: async () => true,
    });

    await selectServers(harness.deps);

    expect(harness.confirmCalls).toBe(1);
    expect(harness.updateCalls).toEqual([{ value: [], target: "global" }]);
  });

  it("an empty-first gesture (nothing was pre-selected) needs no confirmation — there is nothing to undo", async () => {
    const harness = makeDeps({
      getSettings: () => settings({ servers: [] }),
      pickResult: [],
      confirmExposeAllImpl: () => {
        throw new Error("must not be called for an empty-first gesture");
      },
    });

    await selectServers(harness.deps);

    expect(harness.confirmCalls).toBe(0);
    expect(harness.updateCalls).toEqual([{ value: [], target: "global" }]);
  });
});

describe("Story 32.3 — 31-5-5: a server named $(zap)prod renders as TEXT in the picker but is written back RAW", () => {
  it("labels/description/detail are icon-escaped for display; the written value is the raw server name", async () => {
    const { deps, quickPickCalls, updateCalls } = makeDeps({
      serverNames: [
        { name: "$(zap)prod", description: "$(star) desc", detail: "$(gear) detail" },
        serverName("plain"),
      ],
      pickResult: [{ label: "\\$(zap)prod" }],
    });

    await selectServers(deps);

    const items = quickPickCalls[0]!;
    expect(items[0]!.label).toBe("\\$(zap)prod");
    expect(items[0]!.description).toBe("\\$(star) desc");
    expect(items[0]!.detail).toBe("\\$(gear) detail");
    expect(items[1]!.label).toBe("plain");

    // The RAW name — backslash-free — is what lands in settings.
    expect(updateCalls).toEqual([{ value: ["$(zap)prod"], target: "global" }]);
  });
});

describe("Story 32.3 — 31-5-2: buildStatusBarState reports the EFFECTIVE registered count when known", () => {
  it("uses registeredCount over the raw servers.length, with a divergence note in the tooltip", () => {
    const state = buildStatusBarState(settings({ servers: ["prod", "prod2", "typo"], packages: ["dev"] }), 2);
    expect(state.text).toBe("$(server) IRIS MCP: 2");
    expect(state.tooltip).toContain("2 of 3 selected servers currently registered");
  });

  it("falls back to the raw count when registeredCount is not supplied (planning failed or unavailable)", () => {
    const state = buildStatusBarState(settings({ servers: ["prod", "prod2"], packages: ["dev"] }));
    expect(state.text).toBe("$(server) IRIS MCP: 2");
    expect(state.tooltip).not.toContain("currently registered");
  });

  it("the zero-state stays RAW-semantics (fresh install has servers: [] by definition) even when a count is supplied", () => {
    const state = buildStatusBarState(settings({ servers: [], packages: ["dev"] }), 0);
    expect(state.text).toBe("$(server) IRIS MCP: none");
    expect(state.tooltip).toContain("no servers selected yet");
  });
});

describe("Story 32.3 — 31-6-4: the dev-mode tooltip line is worded from the registered count", () => {
  it("registeredCount 0 with developmentRepoPath set: says NO servers were registered (never claims spawning from local build)", () => {
    const state = buildStatusBarState(
      settings({ servers: ["prod"], packages: ["dev"], developmentRepoPath: "C:\\typo" }),
      0,
    );
    expect(state.tooltip).toContain("NO servers were registered");
    expect(state.tooltip).toContain("C:\\typo");
    expect(state.tooltip).not.toContain("spawning from local build");
  });

  it("registeredCount > 0 with developmentRepoPath set: claims spawning from local build (the honest case)", () => {
    const state = buildStatusBarState(
      settings({ servers: ["prod"], packages: ["dev"], developmentRepoPath: "C:\\repo" }),
      1,
    );
    expect(state.tooltip).toContain("spawning from local build at C:\\repo");
  });
});
