/**
 * Story 42.9 (DW-626) - the Pi and JetBrains Junie adapters: detection, status, path resolution and the write engine over
 * NON-canonical files (Rule #58): compact single-line foreign entries, 4-space indentation, CRLF line endings and a byte order
 * mark. Foreign content survives every operation byte for byte, and remove returns the original bytes.
 */

import { describe, expect, it } from "vitest";

import {
  apply,
  buildStatusMatrix,
  CLIENT_ADAPTERS,
  detectClients,
  readConfigEntries,
  remove,
  resolveScopePath,
  synthesizeEntry,
  type ClientAdapter,
  type EngineHostContext,
} from "../index.js";
import { MemFs, readFixture } from "./helpers.js";

const PROFILE = { host: "iris.example.com", port: 52773, username: "svc", namespace: "PROD", https: true };

const HOME = "/h";
const PROJECT = "/p";

function ctx(env: Record<string, string> = {}): EngineHostContext {
  return { platform: "linux", env, homeDir: HOME, projectDir: PROJECT, stateDir: "/state" };
}

function adapterOf(id: string): ClientAdapter {
  const adapter = CLIENT_ADAPTERS[id];
  if (!adapter) throw new Error(`registry missing ${id}`);
  return adapter;
}

const BOM = "\ufeff";
const COMPACT = `{\n  "mcpServers": {\n    "third-party": { "command": "x", "env": { "API_KEY": "shh" } }\n  }\n}\n`;
const MINIFIED = `{"mcpServers":{"third-party":{"command":"x","env":{"API_KEY":"shh"}}}}`;
const FOUR_SPACE = `{\n    "mcpServers": {\n        "third-party": {\n            "command": "x",\n            "env": { "API_KEY": "shh" }\n        }\n    }\n}\n`;
const CRLF = `{\r\n  "mcpServers": {\r\n    "third-party": { "command": "x", "env": { "API_KEY": "shh" } }\r\n  }\r\n}\r\n`;

const VARIANTS: Array<{ label: string; content: string; foreign: string[] }> = [
  { label: "compact single-line foreign entry", content: COMPACT, foreign: [`    "third-party": { "command": "x", "env": { "API_KEY": "shh" } }`] },
  { label: "4-space indentation", content: FOUR_SPACE, foreign: [`            "command": "x",`, `            "env": { "API_KEY": "shh" }`] },
  { label: "a fully minified single-line document", content: MINIFIED, foreign: [`"third-party":{"command":"x","env":{"API_KEY":"shh"}}`] },
  { label: "an empty object", content: "{}\n", foreign: [] },
  { label: "CRLF line endings", content: CRLF, foreign: [`    "third-party": { "command": "x", "env": { "API_KEY": "shh" } }`] },
  { label: "a byte order mark", content: `${BOM}${COMPACT}`, foreign: [`    "third-party": { "command": "x", "env": { "API_KEY": "shh" } }`] },
];

const NEW_ADAPTERS: Array<{ id: string; userPath: string; projectPath: string }> = [
  { id: "pi", userPath: "/h/.pi/agent/mcp.json", projectPath: "/p/.pi/mcp.json" },
  { id: "jetbrains-junie", userPath: "/h/.junie/mcp/mcp.json", projectPath: "/p/.junie/mcp/mcp.json" },
];

describe("Pi and Junie: path resolution", () => {
  for (const { id, userPath, projectPath } of NEW_ADAPTERS) {
    it(`${id}: user ${userPath}, project ${projectPath}`, () => {
      expect(resolveScopePath(adapterOf(id), "user", ctx())).toBe(userPath);
      expect(resolveScopePath(adapterOf(id), "project", ctx())).toBe(projectPath);
    });
  }

  it("Pi: PI_CODING_AGENT_DIR moves the user file, and an empty value does not", () => {
    expect(resolveScopePath(adapterOf("pi"), "user", ctx({ PI_CODING_AGENT_DIR: "/agent" }))).toBe("/agent/mcp.json");
    expect(resolveScopePath(adapterOf("pi"), "user", ctx({ PI_CODING_AGENT_DIR: "" }))).toBe("/h/.pi/agent/mcp.json");
  });

  it("Junie has no environment override: the variable that moves Pi leaves it alone", () => {
    expect(resolveScopePath(adapterOf("jetbrains-junie"), "user", ctx({ PI_CODING_AGENT_DIR: "/agent" }))).toBe("/h/.junie/mcp/mcp.json");
  });
});

describe("Pi and Junie: detect and status", () => {
  for (const { id, userPath, projectPath } of NEW_ADAPTERS) {
    it(`${id}: undetected on an empty host, detected by its config file or its folder`, () => {
      const empty = new MemFs();
      const none = detectClients({ platform: "linux", env: {}, homeDir: HOME, projectDir: PROJECT }, empty);
      expect(none.clients.find((c) => c.client === id)?.detected).toBe(false);

      const byUser = new MemFs();
      byUser.seed(userPath, readFixture(`${id}/mcp.json`));
      const user = detectClients({ platform: "linux", env: {}, homeDir: HOME, projectDir: PROJECT }, byUser);
      expect(user.clients.find((c) => c.client === id)?.detected).toBe(true);

      const byProject = new MemFs();
      byProject.seed(projectPath, readFixture(`${id}/mcp.json`));
      const project = detectClients({ platform: "linux", env: {}, homeDir: HOME, projectDir: PROJECT }, byProject);
      expect(project.clients.find((c) => c.client === id)?.detected).toBe(true);

      const byFolder = new MemFs();
      byFolder.mkdir(id === "pi" ? "/h/.pi" : "/h/.junie");
      const folder = detectClients({ platform: "linux", env: {}, homeDir: HOME, projectDir: PROJECT }, byFolder);
      expect(folder.clients.find((c) => c.client === id)?.detected).toBe(true);
    });

    it(`${id}: the status matrix reads the owned entry and names the foreign entry only`, () => {
      const fs = new MemFs();
      fs.seed(userPath, readFixture(`${id}/mcp.json`));
      const report = buildStatusMatrix({ platform: "linux", env: {}, homeDir: HOME, projectDir: PROJECT }, fs);
      const client = report.clients.find((c) => c.client === id);
      const user = client?.scopes.find((s) => s.scope === "user");
      expect(user?.file).toBe("ok");
      expect(user?.servers.filter((s) => s.state === "present-enabled")).toHaveLength(1);
      expect(user?.foreign).toEqual([id === "pi" ? "pi-foreign-tool" : "Context7"]);
    });
  }
});

describe("Pi and Junie: apply, then remove, over non-canonical files", () => {
  for (const { id, userPath, projectPath } of NEW_ADAPTERS) {
    for (const scope of ["user", "project"] as const) {
      for (const variant of VARIANTS) {
        it(`${id} ${scope} scope, ${variant.label}: foreign lines survive apply, remove restores the original bytes`, () => {
          const target = scope === "user" ? userPath : projectPath;
          const fs = new MemFs();
          fs.seed(target, variant.content);
          const synthesis = synthesizeEntry("iris-dev-mcp", "env-reference", { adapter: adapterOf(id), profile: PROFILE });
          if (!synthesis.ok) throw new Error(`synthesis failed: ${synthesis.reason}`);

          const applied = apply(ctx(), id, scope, synthesis.entry, { fs });
          expect(applied.ok, applied.reason ?? "").toBe(true);
          const bytes = fs.readFile(target);
          for (const line of variant.foreign) expect(bytes, `lost or reformatted: ${line}`).toContain(line);
          if (variant.content.includes("\r\n")) expect(bytes.match(/(?<!\r)\n/g) ?? [], "a bare LF in a CRLF file").toEqual([]);
          if (variant.content.startsWith(BOM)) expect(bytes.startsWith(BOM), "the byte order mark stays first").toBe(true);
          const parsed = readConfigEntries(adapterOf(id), bytes);
          expect(parsed.ok && parsed.entries["iris-dev-mcp"] !== undefined, "the owned entry landed").toBe(true);
          if (variant.foreign.length > 0) expect(parsed.ok && parsed.entries["third-party"] !== undefined, "the foreign entry is still there").toBe(true);

          const removed = remove(ctx(), id, scope, "iris-dev-mcp", { fs });
          expect(removed.ok, removed.reason ?? "").toBe(true);
          if (variant.foreign.length > 0) expect(fs.readFile(target), "remove returns the original bytes").toBe(variant.content);
          else {
            const after = readConfigEntries(adapterOf(id), fs.readFile(target));
            expect(after.ok && Object.keys(after.entries).length === 0, "remove leaves no entry in a document that held none").toBe(true);
          }
        });
      }
    }
  }

  it("apply creates the Pi file when it does not exist, under the override directory when one is set", () => {
    const fs = new MemFs();
    const synthesis = synthesizeEntry("iris-dev-mcp", "env-reference", { adapter: adapterOf("pi"), profile: PROFILE });
    if (!synthesis.ok) throw new Error(`synthesis failed: ${synthesis.reason}`);
    const result = apply(ctx({ PI_CODING_AGENT_DIR: "/agent" }), "pi", "user", synthesis.entry, { fs });
    expect(result.ok, result.reason ?? "").toBe(true);
    expect(fs.exists("/agent/mcp.json")).toBe(true);
    expect(fs.exists("/h/.pi/agent/mcp.json")).toBe(false);
  });
});
