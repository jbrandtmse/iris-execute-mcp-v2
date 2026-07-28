/**
 * Story 33.0 Task 3 / AC 33.0.2 — read-only client detection.
 *
 * Includes the mechanical read-only proof (story constraint): the real
 * `node:fs` write/rename/mkdir/append surface is spied while detection AND
 * status run against the on-disk sandbox fixture tree — any write call
 * fails the suite.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";

import {
  CLIENT_ADAPTERS,
  CANONICAL_SERVERS,
  detect,
  buildStatusMatrix,
  REAL_STATUS_FS,
  type HostContext,
} from "../index.js";
import { fixturePath } from "./helpers.js";

// The ESM fs namespace is frozen (vi.spyOn cannot redefine it), so the write
// surface is wrapped via module mock DELEGATING to the real implementation —
// any write production code performs is both recorded and actually executed
// (mirrors packages/shared's readFileSync-spy pattern; the delegation keeps
// every other test in this file on the REAL filesystem).
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync),
    mkdirSync: vi.fn(actual.mkdirSync),
    renameSync: vi.fn(actual.renameSync),
    appendFileSync: vi.fn(actual.appendFileSync),
    rmSync: vi.fn(actual.rmSync),
    unlinkSync: vi.fn(actual.unlinkSync),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

function linuxCtx(extra?: Partial<HostContext>): HostContext {
  return { platform: "linux", env: {}, homeDir: "/home/fake", ...extra };
}

describe("detect", () => {
  it("reports every registry client with per-probe results", () => {
    const report = detect(linuxCtx(), { exists: () => false });
    expect(report.clients.map((c) => c.client).sort()).toEqual(
      Object.keys(CLIENT_ADAPTERS).sort(),
    );
    for (const client of report.clients) {
      expect(client.detected).toBe(false);
      expect(client.probes.length).toBeGreaterThan(0);
      for (const probe of client.probes) expect(probe.exists).toBe(false);
    }
  });

  it("detects a client via its config file", () => {
    const configPath = "/home/fake/.claude.json";
    const report = detect(linuxCtx(), { exists: (p) => p === configPath });
    const claude = report.clients.find((c) => c.client === "claude-code");
    expect(claude?.detected).toBe(true);
    expect(claude?.probes.some((p) => p.kind === "config" && p.path === configPath && p.exists)).toBe(true);
  });

  it("detects a client via its app dir even when no config exists", () => {
    const report = detect(linuxCtx(), { exists: (p) => p === "/home/fake/.codex" });
    const codex = report.clients.find((c) => c.client === "codex");
    expect(codex?.detected).toBe(true);
    expect(codex?.probes.some((p) => p.kind === "appDir" && p.exists)).toBe(true);
  });

  it("reports undetected clients distinctly (detected: false, never an omission)", () => {
    const report = detect(linuxCtx(), { exists: (p) => p === "/home/fake/.gemini" });
    const detected = report.clients.filter((c) => c.detected).map((c) => c.client);
    const undetected = report.clients.filter((c) => !c.detected).map((c) => c.client);
    expect(detected).toEqual(["gemini"]);
    expect(undetected.sort()).toEqual(
      Object.keys(CLIENT_ADAPTERS).filter((id) => id !== "gemini").sort(),
    );
  });

  it("never throws when a probe errors (EACCES-shaped)", () => {
    const report = detect(linuxCtx(), {
      exists: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    for (const client of report.clients) {
      expect(client.detected).toBe(false);
      for (const probe of client.probes) expect(probe.exists).toBe(false);
    }
  });

  it("skips project-scope probes without a projectDir, includes them with one", () => {
    const without = detect(linuxCtx(), { exists: () => false });
    const claudeWithout = without.clients.find((c) => c.client === "claude-code");
    expect(claudeWithout?.probes.some((p) => p.scope === "project")).toBe(false);

    const withDir = detect(linuxCtx({ projectDir: "/work/repo" }), { exists: () => false });
    const claudeWith = withDir.clients.find((c) => c.client === "claude-code");
    expect(claudeWith?.probes.some((p) => p.scope === "project" && p.path === "/work/repo/.mcp.json")).toBe(true);
  });

  it("stamps the report with the adapter data version", () => {
    const report = detect(linuxCtx(), { exists: () => false });
    expect(report.adapterDataVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe("read-only proof (mechanical)", () => {
  it("detect + status perform ZERO write syscalls against the real fs surface", () => {
    const writeSpies = [
      fs.writeFileSync,
      fs.mkdirSync,
      fs.renameSync,
      fs.appendFileSync,
      fs.rmSync,
      fs.unlinkSync,
    ];
    const ctx = linuxCtx({ homeDir: fixturePath("sandbox-home") });
    // Exercise BOTH read paths end-to-end against the real on-disk tree.
    const detection = detect(ctx, REAL_STATUS_FS);
    expect(detection.clients.some((c) => c.detected)).toBe(true);
    const report = buildStatusMatrix(ctx, REAL_STATUS_FS);
    expect(report.clients.length).toBeGreaterThan(0);
    for (const spy of writeSpies) {
      expect(spy, "a write syscall fired during a read-only operation").not.toHaveBeenCalled();
    }
  });
});

describe("sandbox-home detection (real fs, fake HOME)", () => {
  it("detects exactly the clients planted in the sandbox tree", () => {
    const ctx = linuxCtx({ homeDir: fixturePath("sandbox-home") });
    const report = detect(ctx, REAL_STATUS_FS);
    const detected = report.clients.filter((c) => c.detected).map((c) => c.client).sort();
    // Planted: .claude.json, .codex/, .config/goose/, .config/Code/ (vscode app dir),
    // .config/Code/User/globalStorage/saoudrizwan.claude-dev/ (cline).
    expect(detected).toEqual(["claude-code", "cline", "codex", "goose", "vscode"]);
    expect(detected.length).toBeLessThan(Object.keys(CLIENT_ADAPTERS).length);
    // And the canonical server set still has the documented width (5 —
    // iris-mcp-all unmanaged per the 2026-07-28 Project Lead decision).
    expect(CANONICAL_SERVERS).toHaveLength(5);
  });
});
