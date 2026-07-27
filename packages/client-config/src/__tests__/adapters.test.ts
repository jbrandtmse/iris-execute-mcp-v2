/**
 * Story 33.0 Task 2 / AC 33.0.1 — the ClientAdapter registry data.
 *
 * Counts are mechanical (Rule #51): the 13-client total is asserted ONCE as
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
  it("contains exactly 13 v1 adapters (the spec §3.2 roster)", () => {
    // The ONLY hand-authored count in the package — the spec's v1 roster size.
    expect(Object.keys(CLIENT_ADAPTERS)).toHaveLength(13);
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

  it("kimi-code models its env override and most-specific-wins project fallback", () => {
    const kimiCode: ClientAdapter | undefined = CLIENT_ADAPTERS["kimi-code"];
    const user = kimiCode?.scopes.find((s) => s.scope === "user");
    expect(user?.envOverride?.var).toBe("KIMI_CODE_HOME");
    const project = kimiCode?.scopes.find((s) => s.scope === "project");
    expect(project?.paths.linux).toBe(".kimi-code/mcp.json");
    expect(project?.fallbacks?.[0]?.linux).toBe(".mcp.json");
  });
});

describe("CLIENT_DISPOSITIONS (spec §3.1)", () => {
  it("documents Pi as excluded-not-MCP-capable", () => {
    const pi = CLIENT_DISPOSITIONS.find((d) => d.id === "pi");
    expect(pi?.disposition).toBe("excluded-not-mcp-capable");
    expect(pi?.reason).toContain("MCP");
  });

  it("notes JetBrains and Kilo Code as roadmap adapters", () => {
    const roadmap = CLIENT_DISPOSITIONS.filter((d) => d.disposition === "roadmap").map((d) => d.id);
    expect(roadmap.sort()).toEqual(["jetbrains-junie", "kilo-code"]);
  });

  it("dispositions never collide with the adapter roster", () => {
    for (const disposition of CLIENT_DISPOSITIONS) {
      expect(CLIENT_ADAPTERS[disposition.id], disposition.id).toBeUndefined();
    }
  });
});
