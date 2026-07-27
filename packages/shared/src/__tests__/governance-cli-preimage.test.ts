/**
 * 32-1-R7 (Story 32.4) — the governance CLI's write commands read the
 * pre-image ONCE. Before Story 32.4, `set`/`unset` parsed the file through
 * the loader (one read) and THEN read the raw bytes for a potential
 * rollback (a second, later read): under concurrent modification the
 * rollback would restore content the CLI never parsed, so the "restore
 * pre-write state byte-for-byte" contract was approximate. The pre-image is
 * now read once and that SAME text is both validated
 * (`parseGovernanceFileText`) and kept for rollback.
 *
 * Pinned mechanically: an fs spy counts `readFileSync` calls against the
 * target file for one `set` and one `unset` invocation — exactly ONE
 * pre-image read each (two reads total per invocation: the pre-image plus
 * the post-write re-validation of the WRITTEN file inside
 * `writeGovernanceFileAtomic`, which is a different read of different
 * content). The spy wraps the REAL implementation (the
 * profiles-bootstrap.test.ts pattern) so fixture creation and the CLI's own
 * writes keep working.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import { readFileSync as mockedReadFileSync } from "node:fs";
const readFileSyncSpy = mockedReadFileSync as unknown as ReturnType<typeof vi.fn>;

import { runCli, type CliDeps } from "../cli/governance.js";

function quietDeps(): CliDeps {
  const sink = { write: (_chunk: string): void => undefined };
  return { env: {}, stdout: sink, stderr: sink };
}

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "iris-gov-cli-preimage-"));
  file = path.join(dir, "governance.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  readFileSyncSpy.mockClear();
});

function readsOf(target: string): number {
  return readFileSyncSpy.mock.calls.filter((call) => call[0] === target).length;
}

describe("32-1-R7 — write commands read the pre-image exactly ONCE", () => {
  it("set on an existing file reads it exactly once (parse and rollback share the pre-image)", async () => {
    writeFileSync(file, JSON.stringify({ global: { iris_doc_put: true } }), "utf8");
    readFileSyncSpy.mockClear();
    const code = await runCli(["set", "iris_sql_execute", "false", "--file", file], quietDeps());
    expect(code).toBe(0);
    // Exactly one read for the pre-image + one read for the post-write
    // re-validation inside writeGovernanceFileAtomic (which validates the
    // WRITTEN file, not the pre-image) — never two reads of the pre-image.
    expect(readsOf(file)).toBe(2);
  });

  it("unset reads the pre-image exactly once too", async () => {
    writeFileSync(file, JSON.stringify({ global: { iris_doc_put: true } }), "utf8");
    readFileSyncSpy.mockClear();
    const code = await runCli(["unset", "iris_doc_put", "--file", file], quietDeps());
    expect(code).toBe(0);
    expect(readsOf(file)).toBe(2);
  });
});
