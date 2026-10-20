/**
 * Story 41.6 - AC 41.6.2: what `executePackPlan` checks after it writes, and how it reports a rollback that itself
 * fails. Every file system here is a jailed `BytesFs` over a temp sandbox; some wrap it to store other bytes than
 * they were given, or to refuse an undo step. Nothing touches the repository root or the real home directory.
 */

import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { executePackPlan, preparePackChange, type BytesFs, type ExecuteResult } from "../pack-apply.js";
import { MANIFEST_PATH, type PackPlan } from "../pack-plan.js";

import {
  contextFor,
  failingOnWrite,
  jailedBytesFs,
  makeSandbox,
  removeSandboxes,
  treeSnapshot,
  writeProjectFile,
  type Sandbox,
} from "./pack-test-helpers.js";

afterEach(removeSandboxes);

const RULE = "iris-mcp-objectscript-pre-write";
const SKILL = ".claude/skills/check-system-health/SKILL.md";

function prepare(sandbox: Sandbox, client: string, fs: BytesFs): PackPlan {
  const prepared = preparePackChange(contextFor(sandbox, { stateDir: sandbox.state }), {
    action: "install",
    client,
    includeModified: false,
    fs,
  });
  if (!prepared.ok) throw new Error(`prepare failed: ${prepared.message}`);
  return prepared.plan;
}

function execute(sandbox: Sandbox, plan: PackPlan, fs: BytesFs): ExecuteResult {
  return executePackPlan(contextFor(sandbox, { stateDir: sandbox.state }), plan, { fs });
}

/** A file system that stores one byte less than it is given for every path ending in `suffix`. */
function storingOneByteLess(inner: BytesFs, suffix: string): BytesFs {
  return {
    ...inner,
    writeBytes: (p, bytes) => inner.writeBytes(p, p.endsWith(suffix) ? bytes.subarray(0, bytes.length - 1) : bytes),
  };
}

/** The plan with the bytes of one write replaced. */
function withAfter(plan: PackPlan, rel: string, edit: (text: string) => string): PackPlan {
  return {
    ...plan,
    writes: plan.writes.map((write) =>
      write.rel === rel && write.after !== null ? { ...write, after: Buffer.from(edit(write.after.toString("utf8")), "utf8") } : write,
    ),
  };
}

describe("the read-back after each write", () => {
  it("refuses a file whose stored bytes differ from the bytes written, and undoes the run", () => {
    const sandbox = makeSandbox();
    const jailed = jailedBytesFs(sandbox.root);
    const plan = prepare(sandbox, "claude-code", jailed);
    const before = treeSnapshot(sandbox.project);
    const result = execute(sandbox, plan, storingOneByteLess(jailed, path.join("check-system-health", "SKILL.md")));
    expect(result).toEqual({
      ok: false,
      path: SKILL,
      reason: `could not write ${SKILL}: the bytes read back differ from the bytes written; every change of this run was undone`,
      changedSincePreview: false,
      rolledBack: true,
    });
    expect(treeSnapshot(sandbox.project)).toEqual(before);
  });

  it("refuses a manifest whose stored bytes differ, and undoes every file written before it", () => {
    const sandbox = makeSandbox();
    const jailed = jailedBytesFs(sandbox.root);
    const plan = prepare(sandbox, "claude-code", jailed);
    const before = treeSnapshot(sandbox.project);
    const result = execute(sandbox, plan, storingOneByteLess(jailed, "skills-pack.json"));
    expect(result).toMatchObject({ ok: false, path: MANIFEST_PATH, rolledBack: true });
    expect(result.ok ? "" : result.reason).toContain("the bytes read back differ from the bytes written");
    expect(treeSnapshot(sandbox.project)).toEqual(before);
  });
});

describe("the block check after a write to a host", () => {
  function hostSandbox(): { sandbox: Sandbox; jailed: BytesFs; plan: PackPlan; before: Map<string, string> } {
    const sandbox = makeSandbox();
    writeProjectFile(sandbox.project, "AGENTS.md", "# Mine\nlast line");
    const jailed = jailedBytesFs(sandbox.root);
    const plan = prepare(sandbox, "codex", jailed);
    return { sandbox, jailed, plan, before: treeSnapshot(sandbox.project) };
  }

  it("a control: the untouched plan installs the block", () => {
    const { sandbox, jailed, plan } = hostSandbox();
    expect(execute(sandbox, plan, jailed).ok).toBe(true);
  });

  it("refuses a host that does not hold exactly one whole block after the write, and undoes the run", () => {
    const { sandbox, jailed, plan, before } = hostSandbox();
    const damaged = withAfter(plan, "AGENTS.md", (text) => text.replace(`${RULE}:END -->`, `${RULE}:END --!>`));
    const result = execute(sandbox, damaged, jailed);
    expect(result).toMatchObject({ ok: false, path: "AGENTS.md", rolledBack: true });
    expect(result.ok ? "" : result.reason).toContain(`the ${RULE} block is not exactly one whole block after the write`);
    expect(treeSnapshot(sandbox.project)).toEqual(before);
  });

  it("refuses a host whose bytes outside the block are not the bytes it had, and undoes the run", () => {
    const { sandbox, jailed, plan, before } = hostSandbox();
    const altered = withAfter(plan, "AGENTS.md", (text) => text.replace("# Mine", "# Evil"));
    const result = execute(sandbox, altered, jailed);
    expect(result).toMatchObject({ ok: false, path: "AGENTS.md", rolledBack: true });
    expect(result.ok ? "" : result.reason).toContain("the bytes outside the block changed");
    expect(treeSnapshot(sandbox.project)).toEqual(before);
  });
});

describe("a rollback that cannot finish", () => {
  it("says what it could not undo instead of claiming the run was undone", () => {
    const sandbox = makeSandbox();
    const jailed = jailedBytesFs(sandbox.root);
    const plan = prepare(sandbox, "claude-code", jailed);
    const stuck: BytesFs = {
      ...failingOnWrite(jailed, 3),
      removeFile: () => {
        throw new Error("injected remove failure");
      },
    };
    const result = execute(sandbox, plan, stuck);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rolledBack).toBe(false);
    expect(result.reason).toMatch(/^could not write \S+: injected write failure #3; it could not undo .+: injected remove failure/);
    expect(result.reason).not.toContain("every change of this run was undone");
  });
});
