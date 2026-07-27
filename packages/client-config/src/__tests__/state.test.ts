/**
 * Story 33.1 Task 4 / AC 33.1.3 + AC 33.1.4 — the manager state ledger:
 * state.json read/write, the manager-created ownership roster, and the
 * stash records (spec §3.4 shape `{client, scope, name, entry, disabledAt}`).
 */

import { describe, it, expect } from "vitest";

import {
  addStash,
  dropManaged,
  dropStash,
  findStash,
  isManagerCreated,
  readState,
  recordManaged,
  resolveStateDir,
  stateFilePath,
  writeState,
  EMPTY_STATE,
} from "../index.js";
import { MemFs } from "./helpers.js";

const NOW = new Date(Date.UTC(2026, 6, 27, 12, 0, 0, 0));
const LATER = new Date(Date.UTC(2026, 6, 27, 13, 0, 0, 0));

describe("resolveStateDir", () => {
  it("defaults to ~/.iris-mcp/client-manager under the injected homeDir", () => {
    expect(resolveStateDir({ platform: "linux", env: {}, homeDir: "/h" })).toBe("/h/.iris-mcp/client-manager");
    expect(resolveStateDir({ platform: "win32", env: {}, homeDir: "C:/Users/x" })).toBe(
      "C:/Users/x/.iris-mcp/client-manager".replaceAll("/", "\\"),
    );
  });

  it("honors an explicit stateDir override", () => {
    expect(resolveStateDir({ platform: "linux", env: {}, homeDir: "/h", stateDir: "/custom" })).toBe("/custom");
  });
});

describe("readState", () => {
  it("a missing state file is a valid EMPTY state (first run)", () => {
    const fs = new MemFs();
    const result = readState(fs, "/state", "linux");
    expect(result).toEqual({ ok: true, state: EMPTY_STATE });
  });

  it("an unparseable state file is a typed error, never a guess", () => {
    const fs = new MemFs();
    fs.seed("/state/state.json", "{ not json");
    const result = readState(fs, "/state", "linux");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unparseable");
  });

  it("a wrongly-shaped state file is a typed error", () => {
    const fs = new MemFs();
    fs.seed("/state/state.json", JSON.stringify({ something: "else" }));
    const result = readState(fs, "/state", "linux");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("shape");
  });
});

describe("writeState / readState round-trip", () => {
  it("persists the ledger as JSON and reads it back structurally equal", () => {
    const fs = new MemFs();
    let state = EMPTY_STATE;
    state = recordManaged(state, { client: "cursor", scope: "user", name: "iris-dev-mcp", containsSecret: true }, NOW);
    state = addStash(state, { client: "cursor", scope: "user", name: "iris-ops-mcp", entry: { command: "npx", args: ["-y"] } }, NOW);
    writeState(fs, "/state", "linux", state);
    expect(fs.exists(stateFilePath("/state", "linux"))).toBe(true);
    const back = readState(fs, "/state", "linux");
    expect(back).toEqual({ ok: true, state });
  });
});

describe("managed-entry roster (AC 33.1.4 ownership ledger)", () => {
  it("recordManaged creates; isManagerCreated is exact per (client, scope, name)", () => {
    let state = EMPTY_STATE;
    expect(isManagerCreated(state, "cursor", "user", "custom-server")).toBe(false);
    state = recordManaged(state, { client: "cursor", scope: "user", name: "custom-server", containsSecret: false }, NOW);
    expect(isManagerCreated(state, "cursor", "user", "custom-server")).toBe(true);
    // The same NAME under another client or scope is NOT owned.
    expect(isManagerCreated(state, "windsurf", "user", "custom-server")).toBe(false);
    expect(isManagerCreated(state, "cursor", "project", "custom-server")).toBe(false);
  });

  it("re-recording refreshes updatedAt + containsSecret but preserves createdAt", () => {
    let state = EMPTY_STATE;
    state = recordManaged(state, { client: "cursor", scope: "user", name: "x", containsSecret: false }, NOW);
    state = recordManaged(state, { client: "cursor", scope: "user", name: "x", containsSecret: true }, LATER);
    const record = state.entries.find((r) => r.name === "x");
    expect(state.entries).toHaveLength(1);
    expect(record?.createdAt).toBe(NOW.toISOString());
    expect(record?.updatedAt).toBe(LATER.toISOString());
    expect(record?.containsSecret).toBe(true);
  });

  it("dropManaged removes exactly the one slot", () => {
    let state = EMPTY_STATE;
    state = recordManaged(state, { client: "cursor", scope: "user", name: "x", containsSecret: false }, NOW);
    state = recordManaged(state, { client: "cursor", scope: "user", name: "y", containsSecret: false }, NOW);
    state = dropManaged(state, "cursor", "user", "x");
    expect(isManagerCreated(state, "cursor", "user", "x")).toBe(false);
    expect(isManagerCreated(state, "cursor", "user", "y")).toBe(true);
  });
});

describe("stash records (AC 33.1.3, spec §3.4 shape)", () => {
  it("addStash stores {client, scope, name, entry, disabledAt}; findStash/dropStash round-trip", () => {
    let state = EMPTY_STATE;
    const entry = { command: "npx", args: ["-y", "@iris-mcp/dev"], autoApprove: ["iris_doc_list"] };
    state = addStash(state, { client: "claude-code", scope: "user", name: "iris-dev-mcp", entry }, NOW);
    const stash = findStash(state, "claude-code", "user", "iris-dev-mcp");
    expect(stash).toEqual({
      client: "claude-code",
      scope: "user",
      name: "iris-dev-mcp",
      entry,
      disabledAt: NOW.toISOString(),
    });
    // Native-only keys (autoApprove) survive the stash byte-for-value.
    state = dropStash(state, "claude-code", "user", "iris-dev-mcp");
    expect(findStash(state, "claude-code", "user", "iris-dev-mcp")).toBeUndefined();
  });

  it("re-stashing the same slot replaces the record (disable is idempotent at the ledger level)", () => {
    let state = EMPTY_STATE;
    state = addStash(state, { client: "claude-code", scope: "user", name: "x", entry: { v: 1 } }, NOW);
    state = addStash(state, { client: "claude-code", scope: "user", name: "x", entry: { v: 2 } }, LATER);
    expect(state.stashes).toHaveLength(1);
    expect(findStash(state, "claude-code", "user", "x")?.entry).toEqual({ v: 2 });
  });
});
