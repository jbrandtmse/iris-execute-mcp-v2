/**
 * Story 39.6 QA (AC-5, AC-7; Snapshot rows) -- the `tools/list` snapshot CLI `scripts/gen-tools-list-snapshot.mjs`
 * driven as a spawned process in all three modes, on throwaway trees. No IRIS.
 *
 * Each tree is a scratch directory holding a copy of the CLI and its four library modules, the built `shared` and
 * five server packages linked in (so the capture reads the real dists), and a snapshot file of its own: a copy of the
 * committed one, a deliberately drifted copy, or none. Every mode therefore runs against the real built servers,
 * while the committed fixture of this repository is never a target: the file is hashed before the first tree is made
 * and again after the last, and must be byte-identical with the same modification time.
 *
 * Pinned here:
 *  - no flag, an unknown flag and both flags refuse with exit 2 and write nothing, even into a tree that has no
 *    snapshot file; the refusal names `--check` and `--force`;
 *  - `--check` is read-only whatever it finds: a matching copy exits 0 with the OK line, a live tool the copy lacks is
 *    listed as new and still exits 0, a changed description or annotation exits 1 naming `<package> <tool>.<field>`
 *    and the first differing path, and a pinned tool the live servers do not list exits 1 naming it; the bytes and
 *    the modification time of the tree's snapshot are unchanged after each;
 *  - `--force` writes the generator's own file: the six header and body members, ASCII 2-space JSON with one trailing
 *    newline, the live capture's entries (equal to the committed snapshot's on this tree), the SDK and zod versions,
 *    and a fresh `capturedAt`; it names the entries it re-pins; it also writes when no snapshot exists; and the
 *    file it wrote passes `--check` in the same tree;
 *  - the capture is preset `full` whatever `IRIS_TOOLS_*` holds in the operator's environment.
 *
 * Reads the built `shared` and server dists; it fails, never skips, when one is stale (rebuild the package first).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SNAPSHOT_RELATIVE_PATH, serializeSnapshot, staleDistMessage, staleDists } from "../../../../scripts/lib/tools-list-snapshot-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const REAL_SNAPSHOT = path.join(REPO_ROOT, SNAPSHOT_RELATIVE_PATH);

/** The packages a tree links in: the shared framework and the five servers whose dists the capture reads. */
const LINKED_PACKAGES = ["shared", "iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp", "iris-ops-mcp", "iris-data-mcp"];
/** The library modules the CLI imports. */
const LIB_MODULES = ["tools-list-snapshot-core.mjs", "dist-freshness.mjs", "measure-tools-payload-core.mjs", "tool-catalog.mjs"];

const DEV = "iris-dev-mcp";
const TOOL = "iris_doc_get";
const GHOST = "iris_ghost_tool";

interface Entry {
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, unknown>;
}
interface SnapshotDocument {
  comment: string;
  capturedAt: string;
  sdkVersion: string;
  zodVersion: string;
  entryCount: number;
  servers: Record<string, Record<string, Entry>>;
}

let scratch = "";
let committedText = "";
let committed: SnapshotDocument;
let realBytes: Buffer;
let realMtimeMs = 0;
let treeCount = 0;

beforeAll(() => {
  const stale = staleDists(REPO_ROOT);
  if (stale.length > 0) throw new Error(staleDistMessage(stale));
  committedText = readFileSync(REAL_SNAPSHOT, "utf8");
  committed = JSON.parse(committedText) as SnapshotDocument;
  realBytes = readFileSync(REAL_SNAPSHOT);
  realMtimeMs = statSync(REAL_SNAPSHOT).mtimeMs;
  // The CLI derives its root from its own resolved location, so the scratch directory is named by its real path.
  scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "tools-list-snapshot-cli-")));
});

afterAll(() => {
  try {
    expect(readFileSync(REAL_SNAPSHOT).equals(realBytes), "the committed snapshot is byte-identical after every mode ran").toBe(true);
    expect(statSync(REAL_SNAPSHOT).mtimeMs, "the committed snapshot was never rewritten").toBe(realMtimeMs);
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
});

/**
 * A throwaway tree: the CLI and its libraries copied, the built packages linked, and the snapshot file written from
 * `snapshotText` (no file at all when it is undefined). Returns the tree's root.
 */
function makeTree(snapshotText: string | undefined): string {
  treeCount += 1;
  const tree = path.join(scratch, `tree-${treeCount}`);
  mkdirSync(path.join(tree, "scripts", "lib"), { recursive: true });
  copyFileSync(path.join(REPO_ROOT, "scripts", "gen-tools-list-snapshot.mjs"), path.join(tree, "scripts", "gen-tools-list-snapshot.mjs"));
  for (const name of LIB_MODULES) copyFileSync(path.join(REPO_ROOT, "scripts", "lib", name), path.join(tree, "scripts", "lib", name));
  mkdirSync(path.join(tree, "packages"), { recursive: true });
  for (const pkg of LINKED_PACKAGES) symlinkSync(path.join(REPO_ROOT, "packages", pkg), path.join(tree, "packages", pkg), "dir");
  mkdirSync(path.dirname(path.join(tree, SNAPSHOT_RELATIVE_PATH)), { recursive: true });
  if (snapshotText !== undefined) writeFileSync(path.join(tree, SNAPSHOT_RELATIVE_PATH), snapshotText, "utf8");
  return tree;
}

/** The tree's snapshot file. */
const snapshotOf = (tree: string): string => path.join(tree, SNAPSHOT_RELATIVE_PATH);

/** A deep copy of the committed document, to edit before it is written into a tree. */
function committedCopy(): SnapshotDocument {
  return JSON.parse(committedText) as SnapshotDocument;
}

/** The committed document with `edit` applied, serialized the way the generator writes it. */
function drifted(edit: (document: SnapshotDocument) => void): string {
  const document = committedCopy();
  edit(document);
  return serializeSnapshot(document);
}

/** Run the CLI of `tree` with `args`; `env` is added to the inherited environment. */
function runCli(tree: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [path.join(tree, "scripts", "gen-tools-list-snapshot.mjs"), ...args], {
    encoding: "utf8",
    cwd: scratch,
    timeout: 120000,
    env: { ...process.env, ...env },
  });
  expect(result.error, "the CLI started").toBeUndefined();
  return result;
}

/** The bytes and modification time of the tree's snapshot, for a before/after comparison. */
function fingerprint(tree: string): { bytes: Buffer; mtimeMs: number } {
  return { bytes: readFileSync(snapshotOf(tree)), mtimeMs: statSync(snapshotOf(tree)).mtimeMs };
}

function expectUntouched(tree: string, before: { bytes: Buffer; mtimeMs: number }, label: string): void {
  const after = fingerprint(tree);
  expect(after.bytes.equals(before.bytes), `${label}: the snapshot bytes are unchanged`).toBe(true);
  expect(after.mtimeMs, `${label}: the snapshot was not rewritten`).toBe(before.mtimeMs);
}

describe("Story 39.6 QA: the tools/list snapshot CLI, three modes, on throwaway trees", () => {
  it("the committed fixture is the generator's own output, so the trees below start from a real snapshot of 114 entries", () => {
    expect(committedText).toBe(serializeSnapshot(committed));
    expect(committed.entryCount).toBe(114);
    expect(Object.keys(committed.servers[DEV] ?? {})).toContain(TOOL);
  });

  describe("no flag: refuses", () => {
    it("exits 2 with the refusal, names both modes, and writes nothing into a tree that has a snapshot", () => {
      const tree = makeTree(committedText);
      const before = fingerprint(tree);

      const result = runCli(tree, []);

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain("REFUSING (no flag given); nothing was written.");
      expect(result.stderr).toContain("--check");
      expect(result.stderr).toContain("--force");
      expect(result.stdout, "a refusal prints nothing on stdout").toBe("");
      expectUntouched(tree, before, "no flag");
    });

    it("creates no snapshot in a tree that has none, and says why for an unknown flag and for both flags", () => {
      const tree = makeTree(undefined);

      const none = runCli(tree, []);
      expect(none.status, none.stderr).toBe(2);
      expect(existsSync(snapshotOf(tree)), "no snapshot file was created").toBe(false);

      const unknown = runCli(tree, ["--write"]);
      expect(unknown.status, unknown.stderr).toBe(2);
      expect(unknown.stderr).toContain("unknown argument(s): --write");
      expect(existsSync(snapshotOf(tree))).toBe(false);

      const both = runCli(tree, ["--check", "--force"]);
      expect(both.status, both.stderr).toBe(2);
      expect(both.stderr).toContain("--check and --force are mutually exclusive");
      expect(existsSync(snapshotOf(tree))).toBe(false);
    });
  });

  describe("--check: read-only", () => {
    it("a matching copy exits 0 with the OK line and no new tools, and the snapshot is untouched", () => {
      const tree = makeTree(committedText);
      const before = fingerprint(tree);

      const result = runCli(tree, ["--check"]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("gen-tools-list-snapshot --check (no-write)");
      expect(result.stdout).toMatch(/committed entries:\s+114/);
      expect(result.stdout).toMatch(/live entries:\s+114/);
      expect(result.stdout).toMatch(/new tools \(allowed\):\s+0/);
      expect(result.stdout).toContain("OK - every one of the 114 snapshot entries is still listed, unchanged.");
      expectUntouched(tree, before, "--check on a match");
    });

    it("a live tool the snapshot does not list is reported as new and still exits 0", () => {
      const tree = makeTree(
        drifted((document) => {
          delete (document.servers[DEV] as Record<string, Entry>)[TOOL];
          document.entryCount -= 1;
        }),
      );
      const before = fingerprint(tree);

      const result = runCli(tree, ["--check"]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/committed entries:\s+113/);
      expect(result.stdout).toMatch(/new tools \(allowed\):\s+1/);
      expect(result.stdout).toContain(`+ ${DEV} ${TOOL}`);
      expectUntouched(tree, before, "--check with a new tool");
    });

    it("a changed description exits 1 naming <package> <tool>.description and the first differing path, and the snapshot is untouched", () => {
      const tree = makeTree(
        drifted((document) => {
          const entry = (document.servers[DEV] as Record<string, Entry>)[TOOL] as Entry;
          entry.description = `${entry.description}!`;
        }),
      );
      const before = fingerprint(tree);

      const result = runCli(tree, ["--check"]);

      expect(result.status, result.stdout).toBe(1);
      expect(result.stderr).toContain("1 problem(s)");
      expect(result.stderr).toContain(`${DEV} ${TOOL}.description differs at $.description`);
      expect(result.stderr).toContain("pnpm gen:tools-list-snapshot --force");
      expect(result.stdout, "the counts still print").toMatch(/live entries:\s+114/);
      expectUntouched(tree, before, "--check on drift");
    });

    it("a changed annotation exits 1 naming the annotation that differs", () => {
      const tree = makeTree(
        drifted((document) => {
          const entry = (document.servers[DEV] as Record<string, Entry>)[TOOL] as Entry;
          entry.annotations["readOnlyHint"] = entry.annotations["readOnlyHint"] !== true;
        }),
      );
      const before = fingerprint(tree);

      const result = runCli(tree, ["--check"]);

      expect(result.status, result.stdout).toBe(1);
      expect(result.stderr).toContain(`${DEV} ${TOOL}.annotations differs at $.annotations.readOnlyHint`);
      expectUntouched(tree, before, "--check on an annotation change");
    });

    it("a pinned tool the live servers do not list exits 1 naming it, and the snapshot is untouched", () => {
      const tree = makeTree(
        drifted((document) => {
          const servers = document.servers[DEV] as Record<string, Entry>;
          servers[GHOST] = JSON.parse(JSON.stringify(servers[TOOL])) as Entry;
          document.entryCount += 1;
        }),
      );
      const before = fingerprint(tree);

      const result = runCli(tree, ["--check"]);

      expect(result.status, result.stdout).toBe(1);
      expect(result.stderr).toContain(`${DEV} ${GHOST} vanished`);
      expectUntouched(tree, before, "--check on a vanished tool");
    });

    it("captures preset full whatever IRIS_TOOLS_* holds in the operator's environment", () => {
      const tree = makeTree(committedText);

      const result = runCli(tree, ["--check"], { IRIS_TOOLS_PRESET: "core", IRIS_TOOLS_DISABLE: `${TOOL},iris_doc_put` });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/live entries:\s+114/);
    });
  });

  describe("--force: writes", () => {
    it("re-pins a drifted copy: names the entries it re-pins, writes the generator's own file, and the file passes --check", () => {
      const startedAt = Date.now();
      const tree = makeTree(
        drifted((document) => {
          const servers = document.servers[DEV] as Record<string, Entry>;
          (servers[TOOL] as Entry).description = "drifted";
          servers[GHOST] = JSON.parse(JSON.stringify(servers[TOOL])) as Entry;
          delete (document.servers["iris-ops-mcp"] as Record<string, Entry>)["iris_health_check"];
          // One entry added (the ghost) and one removed: the count stays 114.
          document.sdkVersion = "0.0.0";
        }),
      );

      const result = runCli(tree, ["--force"]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Re-pinning 2 changed or vanished entries:");
      expect(result.stdout).toContain(`${DEV} ${TOOL}.description differs`);
      expect(result.stdout).toContain(`${DEV} ${GHOST} vanished`);
      expect(result.stdout, "a live tool the copy did not pin is named as newly pinned").toContain("Pinning 1 new tool:\n  + iris-ops-mcp iris_health_check\n");
      expect(result.stdout).toContain(`Generated ${snapshotOf(tree)}`);
      expect(result.stdout).toContain("entryCount: 114");

      const text = readFileSync(snapshotOf(tree), "utf8");
      const written = JSON.parse(text) as SnapshotDocument;
      expect(Object.keys(written), "the header and body members, in order").toEqual(["comment", "capturedAt", "sdkVersion", "zodVersion", "entryCount", "servers"]);
      expect(text, "the generator's own serialization").toBe(serializeSnapshot(written));
      expect(text.endsWith("}\n") && !text.endsWith("\n\n")).toBe(true);
      expect(/[^ -~\n]/.test(text), "printable ASCII and line ends only").toBe(false);
      expect(written.entryCount).toBe(114);
      expect(written.servers, "the live capture is the committed snapshot's entries on this tree").toEqual(committed.servers);
      expect(written.sdkVersion).toBe(committed.sdkVersion);
      expect(written.zodVersion).toBe(committed.zodVersion);
      expect(written.comment).toBe(committed.comment);
      expect(Date.parse(written.capturedAt), "capturedAt is a fresh ISO timestamp").toBeGreaterThanOrEqual(startedAt - 2000);
      expect(Number.isNaN(Date.parse(written.capturedAt))).toBe(false);

      const check = runCli(tree, ["--check"]);
      expect(check.status, check.stderr).toBe(0);
      expect(check.stdout).toContain("OK - every one of the 114 snapshot entries is still listed, unchanged.");
    });

    it("writes the snapshot when the tree has none, without any re-pinning line", () => {
      const tree = makeTree(undefined);

      const result = runCli(tree, ["--force"]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain("Re-pinning");
      expect(existsSync(snapshotOf(tree))).toBe(true);
      const written = JSON.parse(readFileSync(snapshotOf(tree), "utf8")) as SnapshotDocument;
      expect(written.servers).toEqual(committed.servers);
      expect(written.entryCount).toBe(committed.entryCount);
      for (const [pkg, entries] of Object.entries(committed.servers)) {
        expect(result.stdout, `${pkg} is reported`).toContain(`${pkg}: ${Object.keys(entries).length} entries`);
      }
    });

    it("re-pinning a copy that is already current rewrites the file and changes only capturedAt", () => {
      const startedAt = Date.now();
      const tree = makeTree(committedText);

      const result = runCli(tree, ["--force"]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).not.toContain("Re-pinning");
      expect(result.stdout).not.toContain("new tool");
      const written = JSON.parse(readFileSync(snapshotOf(tree), "utf8")) as SnapshotDocument;
      expect(written.capturedAt, "the file was rewritten").not.toBe(committed.capturedAt);
      expect(Date.parse(written.capturedAt)).toBeGreaterThanOrEqual(startedAt - 2000);
      expect({ ...written, capturedAt: "" }).toEqual({ ...committed, capturedAt: "" });
    });
  });
});
