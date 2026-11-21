/**
 * Story 42.9 (DW-702) - a project-scope write is refused when the project directory is the home directory.
 *
 * The rows run the BUILT bin as a child process against a real-file-system sandbox whose HOME, USERPROFILE and
 * CLAUDE_CONFIG_DIR are all inside one temporary directory (Rule #54: `os.homedir()` and `process.cwd()` are the real ones).
 * Every refusal row asserts the sandbox is byte-identical afterwards, and that the reason reaches the `--json` envelope's
 * `error` (not "see stderr").
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { homeGuardReason, samePath } from "../home-guard.js";
import { CLIENT_ADAPTERS } from "../adapters.js";
import { resolvesToHome } from "../cli/host-probes.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BIN = path.join(PACKAGE_ROOT, "dist", "cli", "clients-cli.js");
const T = 120_000;

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Sandbox {
  root: string;
  home: string;
  run: (args: string[], opts?: { cwd?: string; home?: string }) => Result;
}

/** A sandbox: `<root>/home` is the home directory; every variable that can name a home or a Claude Code config points inside `root`. */
function makeSandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "home-guard-")));
  created.push(root);
  const home = path.join(root, "home");
  mkdirSync(home);
  const run: Sandbox["run"] = (args, opts = {}) => {
    const homeVar = opts.home ?? home;
    const result = spawnSync(process.execPath, [BIN, ...args], {
      cwd: opts.cwd ?? home,
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        TMPDIR: process.env.TMPDIR ?? "",
        HOME: homeVar,
        USERPROFILE: homeVar,
        APPDATA: path.join(homeVar, "AppData", "Roaming"),
        CLAUDE_CONFIG_DIR: path.join(homeVar, ".claude"),
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  return { root, home, run };
}

/** Every entry under `dir` with its kind and content hash: the byte-level snapshot a refusal must leave unchanged. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      const stat = lstatSync(full);
      const rel = path.relative(dir, full);
      if (stat.isDirectory()) {
        out[rel] = "dir";
        walk(full);
      } else if (stat.isSymbolicLink()) {
        out[rel] = "link";
      } else {
        out[rel] = createHash("sha256").update(readFileSync(full)).digest("hex");
      }
    }
  };
  walk(dir);
  return out;
}

interface Envelope {
  ok: boolean;
  command: string;
  data: unknown;
  error?: string;
}

function envelopeOf(result: Result): Envelope {
  const lines = result.stdout.trim().split("\n");
  expect(lines, `stdout is one envelope: ${result.stdout}`).toHaveLength(1);
  return JSON.parse(lines[0] as string) as Envelope;
}

function applyArgs(client: string): string[] {
  return ["apply", "--client", client, "--servers", "iris-dev-mcp", "--scope", "project", "--yes", "--json"];
}

/** The project file of an adapter, relative to the project directory. */
function projectRel(client: string): string {
  const scope = CLIENT_ADAPTERS[client]?.scopes.find((s) => s.scope === "project");
  if (scope === undefined) throw new Error(`${client} has no project scope`);
  return scope.paths.linux;
}

describe("DW-702: the home directory is never a project (the built bin, a sandbox HOME)", () => {
  for (const client of ["cursor", "codex", "gemini", "kimi-code", "jetbrains-junie"]) {
    it(`apply --client ${client} --scope project from the home directory is refused, naming the one path twice, and writes nothing`, () => {
      const sandbox = makeSandbox();
      const before = snapshot(sandbox.root);
      const result = sandbox.run(applyArgs(client));
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
      const envelope = envelopeOf(result);
      expect(envelope.ok).toBe(false);
      expect(envelope.command).toBe("apply");
      const file = path.join(sandbox.home, projectRel(client));
      expect(envelope.error).toBe(
        `refusing to write the project scope of ${client}: the project directory ${sandbox.home} is your home directory, ` +
          `so the project file ${file} is the user file ${file}. ` +
          `Open a project folder (or cd into one), or use --scope user.`,
      );
      expect(result.stderr).toContain(`Error: ${envelope.error}`);
      expect(snapshot(sandbox.root), "the sandbox is byte-identical").toEqual(before);
    }, T);
  }

  it("vscode: the project file and the user file are different paths, and the refusal says the project file is a user-level location", () => {
    const sandbox = makeSandbox();
    const before = snapshot(sandbox.root);
    const result = sandbox.run(applyArgs("vscode"));
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
    const error = envelopeOf(result).error ?? "";
    expect(error).toContain(`the project file ${path.join(sandbox.home, projectRel("vscode"))} is a user-level location (`);
    expect(error).toContain("Open a project folder (or cd into one), or use --scope user.");
    expect(snapshot(sandbox.root)).toEqual(before);
  }, T);

  it("HOME is a symbolic link to the directory the process runs in: the real paths match, so it is refused", () => {
    const sandbox = makeSandbox();
    const link = path.join(sandbox.root, "home-link");
    symlinkSync(sandbox.home, link, "dir");
    const before = snapshot(sandbox.root);
    const result = sandbox.run(applyArgs("cursor"), { cwd: sandbox.home, home: link });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
    expect(envelopeOf(result).error).toContain("is your home directory");
    expect(snapshot(sandbox.root)).toEqual(before);
  }, T);

  it("the process is started in a symbolic link to HOME: refused (the child sees the physical directory, so the HOME-link row above is what pins realpath)", () => {
    const sandbox = makeSandbox();
    const link = path.join(sandbox.root, "cwd-link");
    symlinkSync(sandbox.home, link, "dir");
    const before = snapshot(sandbox.root);
    const result = sandbox.run(applyArgs("cursor"), { cwd: link });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
    expect(snapshot(sandbox.root)).toEqual(before);
  }, T);

  it.skipIf(process.platform !== "darwin" && process.platform !== "win32")(
    "the process is started in a case variant of HOME: refused on a case-insensitive host (the child sees the on-disk case, so the resolvesToHome row below is what pins the case fold)",
    () => {
      const sandbox = makeSandbox();
      const variant = path.join(sandbox.root, "HOME");
      const before = snapshot(sandbox.root);
      const result = sandbox.run(applyArgs("cursor"), { cwd: variant });
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
      expect(snapshot(sandbox.root)).toEqual(before);
    },
    T,
  );

  it("a subfolder of HOME is a project: the write proceeds into the subfolder only", () => {
    const sandbox = makeSandbox();
    const project = path.join(sandbox.home, "proj");
    mkdirSync(project);
    const result = sandbox.run(applyArgs("cursor"), { cwd: project });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(envelopeOf(result).ok).toBe(true);
    expect(readFileSync(path.join(project, ".cursor", "mcp.json"), "utf8")).toContain("iris-dev-mcp");
    expect(() => lstatSync(path.join(sandbox.home, ".cursor"))).toThrow();
  }, T);

  it("user scope from the home directory is unaffected", () => {
    const sandbox = makeSandbox();
    const result = sandbox.run(["apply", "--client", "cursor", "--servers", "iris-dev-mcp", "--scope", "user", "--yes", "--json"]);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(readFileSync(path.join(sandbox.home, ".cursor", "mcp.json"), "utf8")).toContain("iris-dev-mcp");
  }, T);

  it("diff, enable, disable, remove and restore with --scope project are refused as well", () => {
    const sandbox = makeSandbox();
    const before = snapshot(sandbox.root);
    const commands: Array<[string, string[]]> = [
      ["diff", ["diff", "--client", "cursor", "--servers", "iris-dev-mcp", "--scope", "project", "--json"]],
      ["enable", ["enable", "--client", "cursor", "--server", "iris-dev-mcp", "--scope", "project", "--json"]],
      ["disable", ["disable", "--client", "cursor", "--server", "iris-dev-mcp", "--scope", "project", "--json"]],
      ["remove", ["remove", "--client", "cursor", "--server", "iris-dev-mcp", "--scope", "project", "--json"]],
      ["restore", ["restore", "--client", "cursor", "--scope", "project", "--json"]],
    ];
    for (const [name, args] of commands) {
      const result = sandbox.run(args);
      expect(result.status, `${name}: ${result.stdout}${result.stderr}`).toBe(1);
      const envelope = envelopeOf(result);
      expect(envelope.ok, name).toBe(false);
      expect(envelope.error, name).toContain("refusing to write the project scope of cursor");
      expect(envelope.error, name).toContain("is your home directory");
    }
    expect(snapshot(sandbox.root), "no command wrote anything").toEqual(before);
  }, T);

  for (const action of ["install", "uninstall"]) {
    it(`skills ${action} --client claude-code from the home directory is refused, with nothing under ~/.claude`, () => {
      const sandbox = makeSandbox();
      const before = snapshot(sandbox.root);
      const result = sandbox.run(["skills", action, "--client", "claude-code", "--yes", "--json"]);
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
      const envelope = envelopeOf(result);
      expect(envelope.ok).toBe(false);
      expect(envelope.error).toBe(
        `refusing to ${action} the skills pack for claude-code: the project directory ${sandbox.home} is your home directory, ` +
          `so the pack's project folders would be user-level locations that every project of the client reads. ` +
          `Open a project folder (or cd into one), or pass --project <dir>.`,
      );
      expect(() => lstatSync(path.join(sandbox.home, ".claude"))).toThrow();
      expect(snapshot(sandbox.root)).toEqual(before);
    }, T);
  }

  it("skills install --project naming the home directory from elsewhere is refused too", () => {
    const sandbox = makeSandbox();
    const elsewhere = path.join(sandbox.root, "elsewhere");
    mkdirSync(elsewhere);
    const result = sandbox.run(["skills", "install", "--client", "claude-code", "--project", sandbox.home, "--yes", "--json"], { cwd: elsewhere });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
    expect(envelopeOf(result).error).toContain("is your home directory");
  }, T);

  it("reads from the home directory are unchanged: status, detect and doctor succeed", () => {
    const sandbox = makeSandbox();
    const before = snapshot(sandbox.root);
    for (const command of ["status", "detect", "doctor"]) {
      const result = sandbox.run([command, "--json"]);
      expect(result.status, `${command}: ${result.stdout}${result.stderr}`).toBe(0);
      expect(envelopeOf(result).ok, command).toBe(true);
    }
    expect(snapshot(sandbox.root), "reads write nothing").toEqual(before);
  }, T);
});

describe("DW-702: the pure pieces", () => {
  it("resolvesToHome folds case on darwin and win32 and not on linux, for paths that do not exist", () => {
    expect(resolvesToHome("/no/such/Home", "/no/such/home", "darwin")).toBe(true);
    expect(resolvesToHome("C:\\Users\\Me", "c:\\users\\me", "win32")).toBe(true);
    expect(resolvesToHome("/no/such/Home", "/no/such/home", "linux")).toBe(false);
    expect(resolvesToHome("/no/such/home/proj", "/no/such/home", "darwin")).toBe(false);
  });

  it("samePath normalizes before comparing", () => {
    expect(samePath("linux", "/a/b/../c", "/a/c")).toBe(true);
    expect(samePath("win32", "C:\\A\\B", "c:/a/b")).toBe(true);
  });

  it("homeGuardReason is silent unless the boundary said the project is the home directory, and for user scope or no project scope", () => {
    const cursor = CLIENT_ADAPTERS.cursor;
    const goose = CLIENT_ADAPTERS.goose;
    if (cursor === undefined || goose === undefined) throw new Error("registry");
    const ctx = { platform: "linux" as const, env: {}, homeDir: "/h", projectDir: "/h" };
    expect(homeGuardReason(cursor, ctx)).toBeNull();
    expect(homeGuardReason(cursor, { ...ctx, projectIsHome: false })).toBeNull();
    expect(homeGuardReason(goose, { ...ctx, projectIsHome: true })).toBeNull();
    expect(homeGuardReason(cursor, { ...ctx, projectIsHome: true })).toContain("is the user file /h/.cursor/mcp.json");
  });
});
