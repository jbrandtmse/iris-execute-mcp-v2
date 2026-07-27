/**
 * Story 33.0 Task 4 / AC 33.0.2 + AC 33.0.4 — the client × iris-mcp-server
 * status matrix over the multi-client `sandbox-home` fixture tree (fake
 * HOME, injected paths — never the real HOME).
 */

import { describe, it, expect } from "vitest";

import {
  CLIENT_ADAPTERS,
  CANONICAL_SERVERS,
  status,
  entryPresence,
  REAL_STATUS_FS,
  type HostContext,
  type StatusReport,
} from "../index.js";
import { fixturePath, FOREIGN_SECRET_MARKERS } from "./helpers.js";

function sandboxCtx(): HostContext {
  return { platform: "linux", env: {}, homeDir: fixturePath("sandbox-home") };
}

function run(): StatusReport {
  return status(sandboxCtx(), REAL_STATUS_FS);
}

describe("status matrix over the sandbox tree", () => {
  it("includes exactly the detected clients and lists the rest as undetected", () => {
    const report = run();
    const detected = report.clients.map((c) => c.client).sort();
    expect(detected).toEqual(["claude-code", "cline", "codex", "goose", "vscode"]);
    const undetected = report.undetected.map((c) => c.client).sort();
    expect(undetected).toEqual(
      Object.keys(CLIENT_ADAPTERS)
        .filter((id) => !detected.includes(id))
        .sort(),
    );
    // Undetected clients are excluded from the matrix but listed (AC 33.0.2).
    expect(detected.length + undetected.length).toBe(Object.keys(CLIENT_ADAPTERS).length);
  });

  it("every ok scope renders one row per canonical server (mechanical width)", () => {
    const report = run();
    for (const client of report.clients) {
      for (const scope of client.scopes) {
        if (scope.file !== "ok") continue;
        expect(scope.servers).toHaveLength(CANONICAL_SERVERS.length);
        expect(scope.servers.map((s) => s.server)).toEqual([...CANONICAL_SERVERS]);
      }
    }
  });

  it("claude-code: present-enabled + foreign names surfaced", () => {
    const claude = run().clients.find((c) => c.client === "claude-code");
    const userScope = claude?.scopes.find((s) => s.scope === "user");
    expect(userScope?.file).toBe("ok");
    // The injected homeDir is used verbatim; the template's own separators
    // follow the SIMULATED platform (linux ⇒ forward slash appended here).
    expect(userScope?.path).toBe(fixturePath("sandbox-home") + "/.claude.json");
    const devRow = userScope?.servers.find((s) => s.server === "iris-dev-mcp");
    expect(devRow?.state).toBe("present-enabled");
    const others = userScope?.servers.filter((s) => s.server !== "iris-dev-mcp") ?? [];
    for (const row of others) expect(row.state).toBe("absent");
    expect(userScope?.foreign).toEqual(["github-mcp"]);
  });

  it("cline: native disabled flag reads as present-disabled", () => {
    const cline = run().clients.find((c) => c.client === "cline");
    const userScope = cline?.scopes.find((s) => s.scope === "user");
    expect(userScope?.file).toBe("ok");
    expect(userScope?.servers.find((s) => s.server === "iris-dev-mcp")?.state).toBe("present-disabled");
    expect(userScope?.foreign).toEqual(["aws-docs"]);
  });

  it("codex (native flag verified by the 33.1 probe): an entry without `enabled` reads present-enabled", () => {
    const codex = run().clients.find((c) => c.client === "codex");
    const userScope = codex?.scopes.find((s) => s.scope === "user");
    expect(userScope?.file).toBe("ok");
    expect(userScope?.servers.find((s) => s.server === "iris-ops-mcp")?.state).toBe("present-enabled");
    expect(userScope?.foreign).toEqual(["context7"]);
  });

  it("goose: native enabled flag distinguishes enabled vs disabled", () => {
    const goose = run().clients.find((c) => c.client === "goose");
    const userScope = goose?.scopes.find((s) => s.scope === "user");
    expect(userScope?.file).toBe("ok");
    expect(userScope?.servers.find((s) => s.server === "iris-data-mcp")?.state).toBe("present-enabled");
    expect(userScope?.servers.find((s) => s.server === "iris-ops-mcp")?.state).toBe("present-disabled");
    expect(userScope?.foreign).toEqual(["developer"]);
  });

  it("vscode: malformed file yields per-client unparseable, never a crash (AC 33.0.4)", () => {
    const vscode = run().clients.find((c) => c.client === "vscode");
    const userScope = vscode?.scopes.find((s) => s.scope === "user");
    expect(userScope?.file).toBe("unparseable");
    expect(userScope?.error?.length).toBeGreaterThan(0);
    expect(userScope?.servers).toEqual([]);
    expect(userScope?.foreign).toEqual([]);
    // The rest of the matrix is unaffected by one unparseable client.
    const report = run();
    expect(report.clients.find((c) => c.client === "claude-code")?.scopes[0]?.file).toBe("ok");
  });

  it("never leaks foreign entry VALUES onto the status surface (spec §3.5.5)", () => {
    const rendered = JSON.stringify(run());
    for (const marker of FOREIGN_SECRET_MARKERS) {
      expect(rendered).not.toContain(marker);
    }
  });

  it("stamps the report with the adapter data version", () => {
    expect(run().adapterDataVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe("entryPresence", () => {
  it("flag value equal to disabledValue ⇒ present-disabled; anything else ⇒ present-enabled", () => {
    const cline = CLIENT_ADAPTERS["cline"];
    if (!cline) throw new Error("registry missing cline");
    expect(entryPresence(cline, { disabled: true })).toBe("present-disabled");
    expect(entryPresence(cline, { disabled: false })).toBe("present-enabled");
    expect(entryPresence(cline, {})).toBe("present-enabled");
    const goose = CLIENT_ADAPTERS["goose"];
    if (!goose) throw new Error("registry missing goose");
    expect(entryPresence(goose, { enabled: false })).toBe("present-disabled");
    expect(entryPresence(goose, { enabled: true })).toBe("present-enabled");
  });
});
