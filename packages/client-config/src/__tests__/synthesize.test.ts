/**
 * Story 33.1 Task 6 / AC 33.1.5 — canonical entry synthesis in the four env
 * modes per adapter env-expansion capability (spec §3.3).
 *
 * Proves: (a) the four modes render per capability (claude/shell `${VAR}`,
 * vscode `${env:VAR}` + native `inputs` upgrade, none literal-with-doctor-
 * note); (b) `explicit` requires the typed confirmation and marks
 * contains-secret; (c) MECHANICALLY (Rule #51 sweep over every adapter ×
 * every non-explicit mode): no literal IRIS_PASSWORD value is ever rendered
 * outside explicit mode; (d) PKG_BY_SERVER covers exactly the canonical set.
 */

import { describe, it, expect } from "vitest";

import {
  CANONICAL_SERVERS,
  CLIENT_ADAPTERS,
  IRIS_MCP_MAJOR,
  PKG_BY_SERVER,
  VSCODE_PASSWORD_INPUT_ID,
  pinnedSpec,
  synthesizeEntry,
  type ClientAdapter,
  type EnvMode,
  type SynthesisResult,
} from "../index.js";

function adapterOf(id: string): ClientAdapter {
  const adapter = CLIENT_ADAPTERS[id];
  if (!adapter) throw new Error(`registry missing ${id}`);
  return adapter;
}

function expectOk(result: SynthesisResult): Extract<SynthesisResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok synthesis, got: ${result.reason}`);
  return result;
}

const PROFILE = { host: "iris.example.com", port: 52773, username: "svc", namespace: "PROD", https: true };

describe("server-manager mode", () => {
  it("renders IRIS_SERVER_MANAGER=auto + IRIS_SM_SERVERS, no secrets", () => {
    const result = expectOk(
      synthesizeEntry("iris-dev-mcp", "server-manager", { adapter: adapterOf("cursor"), profile: { serverManagerNames: "prod,dr" } }),
    );
    expect(result.entry).toEqual({
      name: "iris-dev-mcp",
      command: "npx",
      args: ["-y", "@iris-mcp/dev@1"],
      env: { IRIS_SERVER_MANAGER: "auto", IRIS_SM_SERVERS: "prod,dr" },
    });
    expect(result.containsSecret).toBe(false);
  });

  it("defaults IRIS_SM_SERVERS to 'default' when no profile is given", () => {
    const result = expectOk(synthesizeEntry("iris-ops-mcp", "server-manager", { adapter: adapterOf("cursor") }));
    expect(result.entry.env?.["IRIS_SM_SERVERS"]).toBe("default");
  });
});

describe("env-reference mode per expansion capability", () => {
  it("claude expansion: password is ${IRIS_PASSWORD}; profile fields are literals", () => {
    const result = expectOk(
      synthesizeEntry("iris-dev-mcp", "env-reference", { adapter: adapterOf("claude-code"), profile: PROFILE }),
    );
    expect(result.entry.env?.["IRIS_PASSWORD"]).toBe("${IRIS_PASSWORD}");
    expect(result.entry.env?.["IRIS_HOST"]).toBe("iris.example.com");
    expect(result.entry.env?.["IRIS_PORT"]).toBe("52773");
    expect(result.entry.env?.["IRIS_HTTPS"]).toBe("true");
    expect(result.containsSecret).toBe(false);
    expect(result.inputs).toBeUndefined();
  });

  it("claude expansion without a profile references every connection var", () => {
    const result = expectOk(synthesizeEntry("iris-dev-mcp", "env-reference", { adapter: adapterOf("claude-code") }));
    expect(result.entry.env?.["IRIS_HOST"]).toBe("${IRIS_HOST}");
    expect(result.entry.env?.["IRIS_PORT"]).toBe("${IRIS_PORT}");
    expect(result.entry.env?.["IRIS_USERNAME"]).toBe("${IRIS_USERNAME}");
    expect(result.entry.env?.["IRIS_NAMESPACE"]).toBe("${IRIS_NAMESPACE}");
    expect(result.entry.env?.["IRIS_PASSWORD"]).toBe("${IRIS_PASSWORD}");
  });

  it("vscode: ${env:VAR} for connection vars + the native inputs upgrade for the password", () => {
    const result = expectOk(synthesizeEntry("iris-dev-mcp", "env-reference", { adapter: adapterOf("vscode") }));
    expect(result.entry.env?.["IRIS_HOST"]).toBe("${env:IRIS_HOST}");
    expect(result.entry.env?.["IRIS_PASSWORD"]).toBe(`\${input:${VSCODE_PASSWORD_INPUT_ID}}`);
    expect(result.inputs).toEqual([
      {
        id: VSCODE_PASSWORD_INPUT_ID,
        type: "promptString",
        description: "IRIS password for iris-dev-mcp",
        password: true,
      },
    ]);
    expect(result.containsSecret).toBe(false);
  });

  it("vscode with a profile keeps literals for non-secret fields and the input for the password", () => {
    const result = expectOk(
      synthesizeEntry("iris-admin-mcp", "env-reference", { adapter: adapterOf("vscode"), profile: PROFILE }),
    );
    expect(result.entry.env?.["IRIS_HOST"]).toBe("iris.example.com");
    expect(result.entry.env?.["IRIS_PASSWORD"]).toBe(`\${input:${VSCODE_PASSWORD_INPUT_ID}}`);
    expect(result.inputs).toHaveLength(1);
  });

  it("no-expansion clients (cursor: none): literals, NO password, doctor note", () => {
    const result = expectOk(
      synthesizeEntry("iris-dev-mcp", "env-reference", { adapter: adapterOf("cursor"), profile: PROFILE }),
    );
    expect(result.entry.env?.["IRIS_HOST"]).toBe("iris.example.com");
    expect(result.entry.env).not.toHaveProperty("IRIS_PASSWORD");
    expect(result.doctorNote).toContain("OS environment");
    expect(result.doctorNote).toContain("IRIS_PASSWORD");
    expect(result.containsSecret).toBe(false);
  });

  it("shell-convention clients (gemini): ${VAR} references — the registry's documented capability (33.1 review fix)", () => {
    // The adapter registry declares Gemini's envExpansion "shell" for its
    // documented $VAR/${VAR} substitution (types.ts + spec §3.2 table), so
    // env-reference mode renders REFERENCES, not literals + a doctor note —
    // routing shell to the none treatment contradicted the registry and
    // mis-advised the user ("does not expand env vars").
    const result = expectOk(
      synthesizeEntry("iris-dev-mcp", "env-reference", { adapter: adapterOf("gemini"), profile: PROFILE }),
    );
    expect(result.entry.env?.["IRIS_HOST"]).toBe("iris.example.com"); // profile literal
    expect(result.entry.env?.["IRIS_PASSWORD"]).toBe("${IRIS_PASSWORD}"); // reference, never a literal
    expect(result.doctorNote).toBeUndefined();
    expect(result.containsSecret).toBe(false);
    const withoutProfile = expectOk(synthesizeEntry("iris-dev-mcp", "env-reference", { adapter: adapterOf("gemini") }));
    expect(withoutProfile.entry.env?.["IRIS_HOST"]).toBe("${IRIS_HOST}");
    expect(withoutProfile.entry.env?.["IRIS_PASSWORD"]).toBe("${IRIS_PASSWORD}");
  });

  it("no-expansion without a profile names the full OS-env contract in the doctor note", () => {
    const result = expectOk(synthesizeEntry("iris-dev-mcp", "env-reference", { adapter: adapterOf("cursor") }));
    expect(result.entry.env).toEqual({});
    expect(result.doctorNote).toContain("IRIS_HOST");
    expect(result.doctorNote).toContain("IRIS_PASSWORD");
  });
});

describe("governance-file mode", () => {
  it("renders IRIS_GOVERNANCE_FILE plus optional connection literals; no secrets", () => {
    const result = expectOk(
      synthesizeEntry("iris-dev-mcp", "governance-file", {
        adapter: adapterOf("cursor"),
        profile: { ...PROFILE, governanceFile: "/etc/iris/governance.json" },
      }),
    );
    expect(result.entry.env?.["IRIS_GOVERNANCE_FILE"]).toBe("/etc/iris/governance.json");
    expect(result.entry.env?.["IRIS_HOST"]).toBe("iris.example.com");
    expect(result.entry.env).not.toHaveProperty("IRIS_PASSWORD");
    expect(result.containsSecret).toBe(false);
  });

  it("refuses without a governanceFile path", () => {
    const result = synthesizeEntry("iris-dev-mcp", "governance-file", { adapter: adapterOf("cursor") });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("governanceFile");
  });
});

describe("explicit mode (typed confirmation + contains-secret)", () => {
  const explicitProfile = { ...PROFILE, password: "literal-secret-pw" };

  it("refuses without a password", () => {
    const result = synthesizeEntry("iris-dev-mcp", "explicit", { adapter: adapterOf("cursor"), profile: PROFILE });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("password");
  });

  it("refuses without the typed confirmation, and with a WRONG confirmation", () => {
    const missing = synthesizeEntry("iris-dev-mcp", "explicit", { adapter: adapterOf("cursor"), profile: explicitProfile });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toContain('"iris-dev-mcp"');
    const wrong = synthesizeEntry("iris-dev-mcp", "explicit", {
      adapter: adapterOf("cursor"),
      profile: explicitProfile,
      confirm: "iris-dev-mcp2", // exact-match discipline, never prefix
    });
    expect(wrong.ok).toBe(false);
  });

  it("renders literal values with the exact confirmation and marks contains-secret", () => {
    const result = expectOk(
      synthesizeEntry("iris-dev-mcp", "explicit", {
        adapter: adapterOf("cursor"),
        profile: explicitProfile,
        confirm: "iris-dev-mcp",
      }),
    );
    expect(result.entry.env?.["IRIS_PASSWORD"]).toBe("literal-secret-pw");
    expect(result.entry.env?.["IRIS_HOST"]).toBe("iris.example.com");
    expect(result.containsSecret).toBe(true);
    // The refusal reason never echoes the submitted secret value.
  });

  it("refusal reasons never echo the submitted password", () => {
    const result = synthesizeEntry("iris-dev-mcp", "explicit", {
      adapter: adapterOf("cursor"),
      profile: explicitProfile,
      confirm: "nope",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain("literal-secret-pw");
  });
});

/** The launch spec each canonical server must synthesize to: literals, so the pin helper cannot validate itself. */
const PINNED_SPEC_BY_SERVER: Record<(typeof CANONICAL_SERVERS)[number], string> = {
  "iris-dev-mcp": "@iris-mcp/dev@1",
  "iris-admin-mcp": "@iris-mcp/admin@1",
  "iris-ops-mcp": "@iris-mcp/ops@1",
  "iris-interop-mcp": "@iris-mcp/interop@1",
  "iris-data-mcp": "@iris-mcp/data@1",
};

describe("the @1 pin (AC 42.1.6, AD-29)", () => {
  it("IRIS_MCP_MAJOR is '1' and pinnedSpec appends it with '@', never '^' (cmd.exe escape character)", () => {
    expect(IRIS_MCP_MAJOR).toBe("1");
    expect(pinnedSpec("@iris-mcp/dev")).toBe("@iris-mcp/dev@1");
    expect(pinnedSpec("@iris-mcp/dev")).not.toContain("^");
  });

  it("PKG_BY_SERVER keeps the bare package names", () => {
    for (const server of CANONICAL_SERVERS) {
      expect(PKG_BY_SERVER[server]).toBe(PINNED_SPEC_BY_SERVER[server].replace(/@1$/, ""));
    }
  });

  it("every adapter x server x non-explicit mode synthesizes `npx -y <pkg>@1`", () => {
    const nonExplicit: EnvMode[] = ["server-manager", "env-reference"];
    let checked = 0;
    for (const adapter of Object.values(CLIENT_ADAPTERS)) {
      for (const server of CANONICAL_SERVERS) {
        for (const mode of nonExplicit) {
          const result = expectOk(synthesizeEntry(server, mode, { adapter, profile: PROFILE }));
          expect(result.entry.command).toBe("npx");
          expect(result.entry.args).toEqual(["-y", PINNED_SPEC_BY_SERVER[server]]);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(Object.keys(CLIENT_ADAPTERS).length * CANONICAL_SERVERS.length * nonExplicit.length);
  });
});

describe("mechanical sweeps (Rule #51)", () => {
  it("PKG_BY_SERVER covers exactly the canonical server set", () => {
    expect(Object.keys(PKG_BY_SERVER).sort()).toEqual([...CANONICAL_SERVERS].sort());
    for (const server of CANONICAL_SERVERS) {
      const result = expectOk(synthesizeEntry(server, "server-manager", { adapter: adapterOf("cursor") }));
      expect(result.entry.command).toBe("npx");
      expect(result.entry.args).toEqual(["-y", PINNED_SPEC_BY_SERVER[server]]);
    }
  });

  it("NO non-explicit render ever carries a literal IRIS_PASSWORD (every adapter × 3 modes)", () => {
    const nonExplicit: EnvMode[] = ["server-manager", "env-reference", "governance-file"];
    let checked = 0;
    for (const adapter of Object.values(CLIENT_ADAPTERS)) {
      for (const mode of nonExplicit) {
        const result = synthesizeEntry("iris-dev-mcp", mode, {
          adapter,
          profile: { ...PROFILE, password: "literal-secret-pw", governanceFile: "/g.json", serverManagerNames: "prod" },
        });
        expect(result.ok, `${adapter.id}/${mode}`).toBe(true);
        if (result.ok) {
          const pw = result.entry.env?.["IRIS_PASSWORD"];
          // Either absent entirely, or a REFERENCE form — never the literal.
          if (pw !== undefined) {
            expect(pw.startsWith("${"), `${adapter.id}/${mode} rendered a literal password`).toBe(true);
            expect(pw).not.toContain("literal-secret-pw");
          }
          expect(result.containsSecret).toBe(false);
          expect(JSON.stringify(result.entry)).not.toContain("literal-secret-pw");
          checked++;
        }
      }
    }
    // The sweep is exhaustive: every adapter × 3 modes (mechanical count).
    expect(checked).toBe(Object.keys(CLIENT_ADAPTERS).length * 3);
  });

  it("server-manager and governance-file modes never even NAME IRIS_PASSWORD", () => {
    for (const adapter of Object.values(CLIENT_ADAPTERS)) {
      for (const mode of ["server-manager", "governance-file"] as const) {
        const result = expectOk(
          synthesizeEntry("iris-dev-mcp", mode, { adapter, profile: { governanceFile: "/g.json" } }),
        );
        expect(result.entry.env).not.toHaveProperty("IRIS_PASSWORD");
      }
    }
  });
});
