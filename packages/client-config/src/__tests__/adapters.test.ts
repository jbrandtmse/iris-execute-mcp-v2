/**
 * Story 33.0 Task 2 / AC 33.0.1 — the ClientAdapter registry data.
 *
 * Counts are mechanical (Rule #51): the 15-client total is asserted ONCE as
 * a literal, everything else iterates the registry so new adapters cannot
 * drift past the suite.
 */

import { describe, it, expect } from "vitest";

import {
  ADAPTER_DATA_VERSION,
  CLIENT_ADAPTERS,
  CLIENT_DISPOSITIONS,
} from "../index.js";
import type { ClientAdapter } from "../index.js";

const adapters = Object.values(CLIENT_ADAPTERS);

describe("CLIENT_ADAPTERS registry", () => {
  it("contains exactly 15 adapters (the spec roster plus Pi and Junie)", () => {
    // The only hand-authored count in the package: the roster size.
    expect(Object.keys(CLIENT_ADAPTERS)).toHaveLength(15);
  });

  it("keys every record by its own id", () => {
    for (const [key, adapter] of Object.entries(CLIENT_ADAPTERS)) {
      expect(adapter.id).toBe(key);
    }
  });

  it("every adapter carries the full spec §3.2 field set", () => {
    for (const adapter of adapters) {
      expect(adapter.displayName.length).toBeGreaterThan(0);
      expect(["json", "jsonc", "toml", "yaml"]).toContain(adapter.format);
      expect(adapter.rootKey.length).toBeGreaterThan(0);
      expect(adapter.scopes.length).toBeGreaterThan(0);
      expect(["standard", "zed", "goose", "codex-toml"]).toContain(adapter.entryShape);
      expect(["claude", "vscode", "none", "shell"]).toContain(adapter.envExpansion);
      expect(["native", "stash"]).toContain(adapter.disableSupport);
      expect(adapter.restartHint.length).toBeGreaterThan(0);
      expect(adapter.detection.length).toBeGreaterThan(0);
      expect(adapter.docsUrl).toMatch(/^https:\/\//);
    }
  });

  it("every scope has all three platform templates and honest shareability", () => {
    for (const adapter of adapters) {
      for (const scope of adapter.scopes) {
        expect(scope.paths.win32.length).toBeGreaterThan(0);
        expect(scope.paths.darwin.length).toBeGreaterThan(0);
        expect(scope.paths.linux.length).toBeGreaterThan(0);
        // Project files are committable; user files are private.
        expect(scope.shareable).toBe(scope.scope === "project");
      }
    }
  });

  it("native disableSupport always carries its flag; stash never does", () => {
    for (const adapter of adapters) {
      if (adapter.disableSupport === "native") {
        expect(adapter.nativeDisableFlag, adapter.id).toBeDefined();
        expect(adapter.nativeDisableFlag?.key.length).toBeGreaterThan(0);
      } else {
        expect(adapter.nativeDisableFlag, adapter.id).toBeUndefined();
      }
    }
  });

  it("only Cline, Roo Code, Goose and Codex have native file-level disable flags", () => {
    // Spec §3.2: "only Cline/Roo/Goose have native per-entry disable flags"
    // in the ORIGINAL table; Codex's `enabled` flag was verified by the
    // Story 33.1 Rule #16 probe (2026-07-27, official config reference —
    // see the codex record in adapters.ts) and joined the native roster.
    // VS Code's native disable is a UI gesture, not a file flag.
    const nativeIds = adapters.filter((a) => a.disableSupport === "native").map((a) => a.id);
    expect(nativeIds.sort()).toEqual(["cline", "codex", "goose", "roo-code"]);
  });

  it("the odd root keys match the spec capability table", () => {
    expect(CLIENT_ADAPTERS["vscode"]?.rootKey).toBe("servers");
    expect(CLIENT_ADAPTERS["zed"]?.rootKey).toBe("context_servers");
    expect(CLIENT_ADAPTERS["goose"]?.rootKey).toBe("extensions");
    expect(CLIENT_ADAPTERS["codex"]?.rootKey).toBe("mcp_servers");
    // Every other client uses mcpServers.
    for (const adapter of adapters) {
      if (!["vscode", "zed", "goose", "codex"].includes(adapter.id)) {
        expect(adapter.rootKey, adapter.id).toBe("mcpServers");
      }
    }
  });

  it("33-5-L7: every adapter declares an appDir detection rule covering all three platforms it claims to support (a registry-sweep pin against silent platform-completeness drift)", () => {
    // Every v1 adapter in the CURRENT roster claims win32/darwin/linux
    // support (there is no "not applicable" adapter yet) — this sweep pins
    // that AND would flag a future adapter that omits an appDir rule
    // entirely, or one whose appDir paths object is missing a platform.
    for (const adapter of adapters) {
      const appDirRules = adapter.detection.filter((rule) => rule.kind === "appDir");
      expect(appDirRules.length, `${adapter.id} declares no appDir detection rule`).toBeGreaterThan(0);
      for (const rule of appDirRules) {
        if (rule.kind !== "appDir") continue;
        for (const platform of ["win32", "darwin", "linux"] as const) {
          expect(rule.paths[platform].length, `${adapter.id} appDir rule missing a ${platform} path`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("every detection config rule references a scope the adapter declares", () => {
    for (const adapter of adapters) {
      const declared = new Set(adapter.scopes.map((s) => s.scope));
      for (const rule of adapter.detection) {
        if (rule.kind === "config") {
          expect(declared.has(rule.scope), `${adapter.id} probes undeclared ${rule.scope} scope`).toBe(true);
        }
      }
    }
  });

  it("stamps the registry data with a <spec-date>.<serial> version", () => {
    expect(ADAPTER_DATA_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("kimi-code models its env override and a docs-verified single project path (no .mcp.json fallback — falsified live in Story 33.4)", () => {
    const kimiCode: ClientAdapter | undefined = CLIENT_ADAPTERS["kimi-code"];
    const user = kimiCode?.scopes.find((s) => s.scope === "user");
    expect(user?.envOverride?.var).toBe("KIMI_CODE_HOME");
    const project = kimiCode?.scopes.find((s) => s.scope === "project");
    expect(project?.paths.linux).toBe(".kimi-code/mcp.json");
    // The binding spec's repo-root .mcp.json fallback was removed after the
    // 2026-07-28 certification probe falsified it (kimi-code 0.29.0 loaded no
    // probe server from .mcp.json; official docs document only
    // .kimi-code/mcp.json). No adapter may silently re-grow it.
    expect(project?.fallbacks).toBeUndefined();
  });
});

describe("CLIENT_DISPOSITIONS (spec §3.1)", () => {
  it("keeps no client excluded as not MCP-capable: Pi and Junie are adapters now", () => {
    expect(CLIENT_DISPOSITIONS.filter((d) => d.disposition === "excluded-not-mcp-capable")).toEqual([]);
    expect(CLIENT_ADAPTERS.pi?.id).toBe("pi");
    expect(CLIENT_ADAPTERS["jetbrains-junie"]?.id).toBe("jetbrains-junie");
  });

  it("notes Kilo Code and Antigravity CLI as roadmap rows, with the verified facts", () => {
    const roadmap = CLIENT_DISPOSITIONS.filter((d) => d.disposition === "roadmap").map((d) => d.id);
    expect(roadmap.sort()).toEqual(["antigravity", "kilo-code"]);
    const reasons = Object.fromEntries(CLIENT_DISPOSITIONS.map((d) => [d.id, d.reason]));
    expect(reasons["kilo-code"]).toContain("kilo.json");
    expect(reasons["kilo-code"]).toContain("new entry shape");
    expect(reasons.antigravity).toContain("~/.gemini/config/mcp_config.json");
    expect(reasons.antigravity).toContain("collide with Gemini CLI");
  });

  it("dispositions never collide with the adapter roster", () => {
    for (const disposition of CLIENT_DISPOSITIONS) {
      expect(CLIENT_ADAPTERS[disposition.id], disposition.id).toBeUndefined();
    }
  });
});

describe("the 2026-11-21 re-disposition (Story 42.9, DW-626)", () => {
  const scopeOf = (id: string, scope: "user" | "project") => CLIENT_ADAPTERS[id]?.scopes.find((s) => s.scope === scope);

  it("Goose reads %APPDATA%/Block/goose/config/config.yaml on Windows, and the config folder is its detection root", () => {
    const user = scopeOf("goose", "user");
    expect(user?.paths.win32).toBe("%APPDATA%/Block/goose/config/config.yaml");
    expect(user?.paths.darwin).toBe("~/.config/goose/config.yaml");
    expect(user?.paths.linux).toBe("~/.config/goose/config.yaml");
    const appDir = CLIENT_ADAPTERS.goose?.detection.find((rule) => rule.kind === "appDir");
    expect(appDir?.kind === "appDir" ? appDir.paths.win32 : "").toBe("%APPDATA%/Block/goose/config");
  });

  it("Pi: ~/.pi/agent/mcp.json moved by PI_CODING_AGENT_DIR, .pi/mcp.json in a project, mcpServers JSON", () => {
    const pi = CLIENT_ADAPTERS.pi;
    expect(pi?.format).toBe("json");
    expect(pi?.rootKey).toBe("mcpServers");
    expect(scopeOf("pi", "user")?.paths.linux).toBe("~/.pi/agent/mcp.json");
    expect(scopeOf("pi", "user")?.envOverride).toEqual({ var: "PI_CODING_AGENT_DIR", pathSuffix: "mcp.json" });
    expect(scopeOf("pi", "project")?.paths.linux).toBe(".pi/mcp.json");
    expect(pi?.docsUrl).toBe("https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/mcp.md");
  });

  it("Junie: ~/.junie/mcp/mcp.json and .junie/mcp/mcp.json on every platform, mcpServers JSON", () => {
    const junie = CLIENT_ADAPTERS["jetbrains-junie"];
    expect(junie?.displayName).toBe("JetBrains Junie");
    expect(junie?.format).toBe("json");
    expect(junie?.rootKey).toBe("mcpServers");
    for (const platform of ["win32", "darwin", "linux"] as const) {
      expect(scopeOf("jetbrains-junie", "user")?.paths[platform]).toBe("~/.junie/mcp/mcp.json");
      expect(scopeOf("jetbrains-junie", "project")?.paths[platform]).toBe(".junie/mcp/mcp.json");
    }
    expect(junie?.docsUrl).toBe("https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html");
  });

  it("renames Windsurf, archives Kimi CLI and discontinues Roo Code, each keeping its adapter and its path", () => {
    expect(CLIENT_ADAPTERS.windsurf?.displayName).toBe("Devin Desktop (formerly Windsurf)");
    expect(scopeOf("windsurf", "user")?.paths.linux).toBe("~/.codeium/windsurf/mcp_config.json");
    expect(CLIENT_ADAPTERS.kimi?.displayName).toBe("Kimi CLI (archived)");
    expect(CLIENT_ADAPTERS["roo-code"]?.displayName).toBe("Roo Code (discontinued)");
  });

  it("every documentation link is the one read on 2026-11-21", () => {
    expect(CLIENT_ADAPTERS.windsurf?.docsUrl).toBe("https://docs.devin.ai/desktop/devin-local/customizations");
    expect(CLIENT_ADAPTERS.gemini?.docsUrl).toBe("https://geminicli.com/docs/tools/mcp-server/");
    expect(CLIENT_ADAPTERS.goose?.docsUrl).toBe("https://goose-docs.ai/docs/getting-started/using-extensions/");
    expect(CLIENT_ADAPTERS["roo-code"]?.docsUrl).toBe("https://roocodeinc.github.io/Roo-Code/features/mcp/overview/");
  });

  it("stamps the adapter data with the implementation date", () => {
    expect(ADAPTER_DATA_VERSION).toBe("2026-11-21.1");
  });
});
