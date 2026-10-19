/**
 * Story 41.6 - shared helpers for the skills-pack installer tests.
 *
 * Every helper that touches the file system works under an OS temp directory it creates and the test deletes.
 * Nothing here resolves a path from the real repository root or the real $HOME: the installer is always handed an
 * injected `projectDir`, `homeDir` and `BytesFs`, and `jailedBytesFs` throws on any path outside the sandbox root.
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { REAL_BYTES_FS, type BytesFs, type PackContext } from "../pack-apply.js";
import { loadPack, MANIFEST_PATH, type LoadedPack, type PackPlan, type ProjectView } from "../pack-plan.js";

/** The pack that ships in this package (the generated, committed one). */
export function realPack(): LoadedPack {
  const loaded = loadPack();
  if (!loaded.ok) throw new Error(loaded.message);
  return loaded.pack;
}

export function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** UTF-8 BOM, built from numbers. */
export const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

// ------------------------------------------------------------------
// Sandboxes: a temp root holding `home/`, `proj/` and `state/`.
// ------------------------------------------------------------------

export interface Sandbox {
  root: string;
  home: string;
  project: string;
  state: string;
}

const created: string[] = [];

export function makeSandbox(): Sandbox {
  const root = realRoot(mkdtempSync(path.join(tmpdir(), "skills-pack-")));
  created.push(root);
  const sandbox = { root, home: path.join(root, "home"), project: path.join(root, "proj"), state: path.join(root, "state") };
  mkdirSync(sandbox.home);
  mkdirSync(sandbox.project);
  return sandbox;
}

function realRoot(dir: string): string {
  return path.resolve(dir);
}

/** Delete every sandbox this process created. Call from `afterEach`. */
export function removeSandboxes(): void {
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
}

/** The platform id the installer is told about; path semantics must match the real fs under test. */
export function hostPlatform(): "win32" | "linux" {
  return path.sep === "\\" ? "win32" : "linux";
}

/** A context whose `stateDir` is unset by default, so the default resolves under the injected `homeDir`. */
export function contextFor(sandbox: Sandbox, overrides: Partial<PackContext> = {}): PackContext {
  return { platform: hostPlatform(), env: {}, homeDir: sandbox.home, projectDir: sandbox.project, ...overrides };
}

// ------------------------------------------------------------------
// The jail.
// ------------------------------------------------------------------

export class JailError extends Error {}

/**
 * A real-file-system `BytesFs` that throws a `JailError` for any path outside `root`. `touched` records every
 * path an operation named, so a test can assert what the installer reached.
 */
export function jailedBytesFs(root: string, inner: BytesFs = REAL_BYTES_FS): BytesFs & { touched: string[] } {
  const prefix = path.resolve(root) + path.sep;
  const touched: string[] = [];
  const guard = (p: string): string => {
    const resolved = path.resolve(p);
    touched.push(resolved);
    if (resolved !== path.resolve(root) && !resolved.startsWith(prefix)) {
      throw new JailError(`path outside the sandbox: ${p}`);
    }
    return p;
  };
  return {
    touched,
    exists: (p) => inner.exists(guard(p)),
    isDirectory: (p) => inner.isDirectory(guard(p)),
    readBytes: (p) => inner.readBytes(guard(p)),
    writeBytes: (p, bytes) => inner.writeBytes(guard(p), bytes),
    mkdir: (p) => inner.mkdir(guard(p)),
    removeFile: (p) => inner.removeFile(guard(p)),
    removeEmptyDir: (p) => inner.removeEmptyDir(guard(p)),
    listDir: (p) => inner.listDir(guard(p)),
  };
}

/** Wrap a `BytesFs` so it throws on the k-th `writeBytes` call (1-based), once. */
export function failingOnWrite(inner: BytesFs, k: number): BytesFs & { writes: () => number } {
  let writes = 0;
  return {
    ...inner,
    writes: () => writes,
    writeBytes: (p, bytes) => {
      writes += 1;
      if (writes === k) throw new Error(`injected write failure #${k}`);
      inner.writeBytes(p, bytes);
    },
  };
}

/** Count the mutating calls made through a `BytesFs`. */
export function spyBytesFs(inner: BytesFs): BytesFs & { mutations: string[] } {
  const mutations: string[] = [];
  return {
    ...inner,
    mutations,
    writeBytes: (p, bytes) => {
      mutations.push(`write ${p}`);
      inner.writeBytes(p, bytes);
    },
    mkdir: (p) => {
      mutations.push(`mkdir ${p}`);
      inner.mkdir(p);
    },
    removeFile: (p) => {
      mutations.push(`remove ${p}`);
      inner.removeFile(p);
    },
    removeEmptyDir: (p) => {
      mutations.push(`rmdir ${p}`);
      return inner.removeEmptyDir(p);
    },
  };
}

// ------------------------------------------------------------------
// Tree snapshots.
// ------------------------------------------------------------------

/** Every file (sha256) and directory ("dir") below `dir`, keyed by POSIX path relative to it. */
export function treeSnapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string, prefix: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(full).isDirectory()) {
        out.set(rel, "dir");
        walk(full, rel);
      } else {
        out.set(rel, sha(readFileSync(full)));
      }
    }
  };
  walk(dir, "");
  return out;
}

export function writeProjectFile(project: string, rel: string, bytes: Uint8Array | string): void {
  const full = path.join(project, ...rel.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, bytes);
}

export function readProjectFile(project: string, rel: string): Buffer {
  return readFileSync(path.join(project, ...rel.split("/")));
}

// ------------------------------------------------------------------
// An in-memory project for plan-level tests.
// ------------------------------------------------------------------

export interface MapProject extends ProjectView {
  files: Map<string, Buffer>;
  dirs: Set<string>;
  put(rel: string, bytes: Uint8Array | string): void;
  /** Apply a plan the way the executor would: write, delete, then the manifest; empty recorded dirs go. */
  apply(plan: PackPlan): void;
}

export function mapProject(initial: Record<string, Uint8Array | string> = {}): MapProject {
  const files = new Map<string, Buffer>();
  const dirs = new Set<string>();
  const addDirs = (rel: string): void => {
    const parts = rel.split("/").slice(0, -1);
    parts.forEach((_, index) => dirs.add(parts.slice(0, index + 1).join("/")));
  };
  const project: MapProject = {
    files,
    dirs,
    read: (rel) => files.get(rel) ?? null,
    isDirectory: (rel) => dirs.has(rel),
    listDir: (rel) => {
      if (!dirs.has(rel)) return null;
      const names = new Set<string>();
      for (const key of [...files.keys(), ...dirs]) {
        if (key.startsWith(`${rel}/`)) names.add(key.slice(rel.length + 1).split("/")[0] as string);
      }
      return [...names];
    },
    put: (rel, bytes) => {
      files.set(rel, Buffer.from(bytes));
      addDirs(rel);
    },
    apply: (plan) => {
      for (const dir of plan.createDirs) dirs.add(dir);
      for (const write of plan.writes) {
        if (write.after !== null) project.put(write.rel, write.after);
      }
      for (const write of plan.writes) {
        if (write.after === null) files.delete(write.rel);
      }
      for (const dir of plan.removeDirs) dirs.delete(dir);
      if (plan.manifestAfter === null) files.delete(MANIFEST_PATH);
      else project.put(MANIFEST_PATH, plan.manifestAfter);
    },
  };
  for (const [rel, bytes] of Object.entries(initial)) project.put(rel, bytes);
  return project;
}

// ------------------------------------------------------------------
// Host fixtures (Rule #58): non-canonical instruction files.
// ------------------------------------------------------------------

/** The section of a rule, built by hand as an independent oracle of the pack's `agents-md` form. */
export function sectionOf(stem: string, body: string): Buffer {
  return Buffer.from(`<!-- IRIS-MCP-RULE:${stem}:BEGIN -->\n${body}\n<!-- IRIS-MCP-RULE:${stem}:END -->\n`, "utf8");
}

export interface HostFixture {
  name: string;
  bytes: Buffer;
}

/**
 * Hosts that do NOT hold our block, in the shapes a user's `AGENTS.md` or `GEMINI.md` takes. Non-ASCII and
 * invalid UTF-8 bytes are built from numbers.
 */
export function hostFixtures(stem: string): HostFixture[] {
  const text = (value: string): Buffer => Buffer.from(value, "utf8");
  const other = `<!-- IRIS-MCP-RULE:other-rule:BEGIN -->\nforeign body\n<!-- IRIS-MCP-RULE:other-rule:END -->\n`;
  return [
    { name: "lf", bytes: text("# Project\nsecond line\n") },
    { name: "crlf", bytes: text("# Project\r\nsecond line\r\n") },
    { name: "bom+lf", bytes: Buffer.concat([BOM, text("# Project\nsecond line\n")]) },
    { name: "bom+crlf", bytes: Buffer.concat([BOM, text("# Project\r\nsecond line\r\n")]) },
    { name: "no final newline (lf)", bytes: text("# Project\nlast line") },
    { name: "no final newline (crlf)", bytes: text("# Project\r\nlast line") },
    { name: "bom, no final newline", bytes: Buffer.concat([BOM, text("# Project\nlast line")]) },
    { name: "lone cr at the end", bytes: text("# Project\nlast line\r") },
    { name: "whitespace only, terminated", bytes: text("  \n\t\n") },
    { name: "whitespace only, unterminated", bytes: text("   ") },
    { name: "single newline", bytes: text("\n") },
    { name: "empty", bytes: Buffer.alloc(0) },
    { name: "bom only", bytes: Buffer.from(BOM) },
    {
      name: "comments and look-alike markers",
      bytes: text(
        `<!-- a note -->\n  <!-- IRIS-MCP-RULE:${stem}:BEGIN -->\n<!-- IRIS-MCP-RULE:${stem}:BEGIN --> \n` +
          `<!-- iris-mcp-rule:${stem}:begin -->\nsee <!-- IRIS-MCP-RULE:${stem}:END --> inline\n<!-- IRIS-MCP-RULE:${stem}-x:END -->\n`,
      ),
    },
    { name: "another rule's block and another tool's block", bytes: text(`${other}<!-- BEGIN x -->\nfoo\n<!-- END x -->\n`) },
    {
      name: "non-ascii and invalid utf-8",
      bytes: Buffer.concat([text("caf"), Buffer.from([0xc3, 0xa9, 0x0a, 0xc3, 0x28, 0xa0, 0xa1, 0xff, 0x0a]), text("end")]),
    },
  ];
}
