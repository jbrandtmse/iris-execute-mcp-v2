/**
 * Story 41.6 - AC 41.6.2, a pack update that renames the always-on rule, on the block routes (AGENTS.md, GEMINI.md)
 * and the file route. The old block comes out and the new one goes in, in one run that passes the executor's
 * outside-the-block check, and a later uninstall gives back exactly the bytes the host had before the first
 * install, the line ending the first install added included.
 *
 * Each scratch pack is a byte copy of the shipped pack under a temp sandbox, with the rule's three forms renamed
 * and the markers of its `agents-md` form rewritten byte for byte (latin1 round trip).
 */

import { cpSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { executePackPlan, preparePackChange, type ExecuteResult } from "../pack-apply.js";
import { DEFAULT_PACK_DIR } from "../pack-plan.js";

import { BOM, contextFor, jailedBytesFs, makeSandbox, readProjectFile, removeSandboxes, treeSnapshot, writeProjectFile, type Sandbox } from "./pack-test-helpers.js";

afterEach(removeSandboxes);

const OLD = "iris-mcp-objectscript-pre-write";
const NEW = "iris-mcp-objectscript-before-write";

/** A copy of the shipped pack in which the rule is called `NEW`. */
function renamedPack(sandbox: Sandbox): string {
  const dir = path.join(sandbox.root, "pack-renamed");
  cpSync(DEFAULT_PACK_DIR, dir, { recursive: true });
  for (const [form, ext] of [["claude-code", ".md"], ["cursor", ".mdc"], ["agents-md", ".md"]] as const) {
    renameSync(path.join(dir, "rules", form, `${OLD}${ext}`), path.join(dir, "rules", form, `${NEW}${ext}`));
  }
  const section = path.join(dir, "rules", "agents-md", `${NEW}.md`);
  const text = readFileSync(section).toString("latin1");
  writeFileSync(section, Buffer.from(text.split(`IRIS-MCP-RULE:${OLD}:`).join(`IRIS-MCP-RULE:${NEW}:`), "latin1"));
  return dir;
}

function section(packDir: string, stem: string): Buffer {
  return readFileSync(path.join(packDir, "rules", "agents-md", `${stem}.md`));
}

function run(sandbox: Sandbox, action: "install" | "uninstall", client: string, packDir?: string): ExecuteResult {
  const fs = jailedBytesFs(sandbox.root);
  const ctx = contextFor(sandbox, { stateDir: sandbox.state });
  const prepared = preparePackChange(ctx, { action, client, includeModified: false, fs, ...(packDir !== undefined ? { packDir } : {}) });
  if (!prepared.ok) throw new Error(prepared.message);
  expect(prepared.plan.conflicts).toEqual([]);
  return executePackPlan(ctx, prepared.plan, { fs });
}

function expectOk(result: ExecuteResult): void {
  expect(result.ok, result.ok ? "" : result.reason).toBe(true);
}

describe("a pack update that renames the rule", () => {
  const hosts: Array<[string, string, Buffer]> = [
    ["codex", "AGENTS.md", Buffer.from("# Mine\nlast line without a newline", "utf8")],
    ["gemini", "GEMINI.md", Buffer.concat([BOM, Buffer.from("# Mine\r\nlast line without a newline", "utf8")])],
  ];
  for (const [client, host, original] of hosts) {
    it(`${client}: swaps the block in ${host}, and the uninstall gives back the original bytes`, () => {
      const sandbox = makeSandbox();
      writeProjectFile(sandbox.project, host, original);
      const renamed = renamedPack(sandbox);
      const ending = original.includes(Buffer.from("\r\n")) ? "\r\n" : "\n";

      expectOk(run(sandbox, "install", client));
      expectOk(run(sandbox, "install", client, renamed));
      const swapped = readProjectFile(sandbox.project, host);
      expect(swapped.equals(Buffer.concat([original, Buffer.from(ending), section(renamed, NEW)]))).toBe(true);

      expectOk(run(sandbox, "uninstall", client));
      expect(readProjectFile(sandbox.project, host).equals(original)).toBe(true);
      expect([...treeSnapshot(sandbox.project).keys()]).toEqual([host]);
    });
  }

  it("codex: a host the installer created holds only the new block, and the uninstall deletes it", () => {
    const sandbox = makeSandbox();
    const renamed = renamedPack(sandbox);
    expectOk(run(sandbox, "install", "codex"));
    expectOk(run(sandbox, "install", "codex", renamed));
    expect(readProjectFile(sandbox.project, "AGENTS.md").equals(section(renamed, NEW))).toBe(true);
    expectOk(run(sandbox, "uninstall", "codex"));
    expect([...treeSnapshot(sandbox.project).keys()]).toEqual([]);
  });

  it("claude-code: the old rule file goes as stale and the new one is created", () => {
    const sandbox = makeSandbox();
    const renamed = renamedPack(sandbox);
    expectOk(run(sandbox, "install", "claude-code"));
    expectOk(run(sandbox, "install", "claude-code", renamed));
    const keys = [...treeSnapshot(sandbox.project).keys()];
    expect(keys).toContain(`.claude/rules/${NEW}.md`);
    expect(keys).not.toContain(`.claude/rules/${OLD}.md`);
  });
});
