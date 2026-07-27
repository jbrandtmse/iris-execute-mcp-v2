/**
 * Story 33.0 Task 2 / AC 33.0.1 — pure path resolution.
 *
 * The resolution core never reads process.env/process.platform/os.homedir()
 * — these tests simulate win32/darwin/linux with injected contexts and pin
 * the 32-3-R2 path discipline (path.win32/path.posix selected by the
 * SIMULATED platform, never the host's).
 */

import { describe, it, expect } from "vitest";

import {
  CLIENT_ADAPTERS,
  resolvePathTemplate,
  resolveScopePath,
  resolveScopeCandidates,
  type AdapterPlatform,
  type HostContext,
} from "../index.js";

const PLATFORMS: AdapterPlatform[] = ["win32", "darwin", "linux"];

function ctxFor(platform: AdapterPlatform, extra?: Partial<HostContext>): HostContext {
  return {
    platform,
    env: platform === "win32" ? { APPDATA: "C:/Users/fake/AppData/Roaming" } : {},
    homeDir: platform === "win32" ? "C:/Users/fake" : "/home/fake",
    projectDir: platform === "win32" ? "C:/work/repo" : "/work/repo",
    ...extra,
  };
}

describe("resolvePathTemplate", () => {
  it("expands ~ to the injected homeDir", () => {
    const out = resolvePathTemplate("~/.claude.json", ctxFor("linux"));
    expect(out).toBe("/home/fake/.claude.json");
  });

  it("expands %VAR% from the injected env (win32 style)", () => {
    const out = resolvePathTemplate("%APPDATA%/Claude/claude_desktop_config.json", ctxFor("win32"));
    expect(out).toBe("C:\\Users\\fake\\AppData\\Roaming\\Claude\\claude_desktop_config.json");
  });

  it("expands ${VAR} from the injected env", () => {
    const out = resolvePathTemplate("${KIMI_CODE_HOME}/mcp.json", ctxFor("linux", { env: { KIMI_CODE_HOME: "/opt/kimi" } }));
    expect(out).toBe("/opt/kimi/mcp.json");
  });

  it("leaves unresolved placeholders verbatim (never invents values)", () => {
    const out = resolvePathTemplate("%APPDATA%/Claude/x.json", ctxFor("win32", { env: {} }));
    expect(out).toContain("%APPDATA%");
  });

  it("normalizes with the SIMULATED platform's separators, not the host's", () => {
    const win = resolvePathTemplate("~/.cursor/mcp.json", ctxFor("win32"));
    expect(win).toBe("C:\\Users\\fake\\.cursor\\mcp.json");
    const mac = resolvePathTemplate("~/.cursor/mcp.json", ctxFor("darwin"));
    expect(mac).toBe("/home/fake/.cursor/mcp.json");
  });
});

describe("resolveScopePath — full registry × platforms matrix", () => {
  for (const platform of PLATFORMS) {
    it(`resolves every adapter scope on ${platform} without leftover ~ or host coupling`, () => {
      const ctx = ctxFor(platform);
      for (const adapter of Object.values(CLIENT_ADAPTERS)) {
        for (const scope of adapter.scopes) {
          const resolved = resolveScopePath(adapter, scope.scope, ctx);
          expect(resolved, `${adapter.id}/${scope.scope}`).not.toBeNull();
          expect(resolved).not.toContain("~");
          if (platform === "win32") {
            expect(resolved, `${adapter.id}/${scope.scope}`).not.toMatch(/\//);
          } else {
            expect(resolved, `${adapter.id}/${scope.scope}`).not.toContain("\\");
          }
          if (scope.scope === "project") {
            expect(resolved?.startsWith(platform === "win32" ? "C:\\work\\repo" : "/work/repo")).toBe(true);
          } else {
            expect(resolved?.startsWith(platform === "win32" ? "C:\\work\\repo" : "/work/repo")).toBe(false);
          }
        }
      }
    });
  }

  it("project scopes resolve to null without an injected projectDir", () => {
    const ctx = ctxFor("linux");
    delete ctx.projectDir;
    for (const adapter of Object.values(CLIENT_ADAPTERS)) {
      expect(resolveScopePath(adapter, "project", ctx)).toBeNull();
      expect(resolveScopeCandidates(adapter, "project", ctx)).toEqual([]);
      // User scopes are unaffected by the missing projectDir.
      expect(resolveScopePath(adapter, "user", ctx)).not.toBeNull();
    }
  });

  it("kimi-code honors $KIMI_CODE_HOME over the default location", () => {
    const adapter = CLIENT_ADAPTERS["kimi-code"];
    if (!adapter) throw new Error("registry missing kimi-code");
    const withOverride = resolveScopePath(adapter, "user", ctxFor("linux", { env: { KIMI_CODE_HOME: "/opt/kimi" } }));
    expect(withOverride).toBe("/opt/kimi/mcp.json");
    const withoutOverride = resolveScopePath(adapter, "user", ctxFor("linux"));
    expect(withoutOverride).toBe("/home/fake/.kimi-code/mcp.json");
  });

  it("kimi-code project scope prefers .kimi-code/mcp.json, falls back to .mcp.json (most specific wins)", () => {
    const adapter = CLIENT_ADAPTERS["kimi-code"];
    if (!adapter) throw new Error("registry missing kimi-code");
    const ctx = ctxFor("linux");
    const primary = "/work/repo/.kimi-code/mcp.json";
    const fallback = "/work/repo/.mcp.json";
    // No fs predicate: primary is returned as-is.
    expect(resolveScopePath(adapter, "project", ctx)).toBe(primary);
    // Only the fallback exists: the fallback wins.
    expect(resolveScopePath(adapter, "project", ctx, (p) => p === fallback)).toBe(fallback);
    // Both exist: the most specific wins.
    expect(resolveScopePath(adapter, "project", ctx, () => true)).toBe(primary);
    // Candidates enumerate both, primary first.
    expect(resolveScopeCandidates(adapter, "project", ctx)).toEqual([primary, fallback]);
  });
});
