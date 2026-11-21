/**
 * Story 42.9 QA (DW-702) - the home-directory refusal, second pass over the BUILT bin with a scratch HOME.
 *
 * `home-guard.test.ts` (implement stage) runs every write command against an EMPTY home, so a missing guard on `remove`, `disable`,
 * `enable` or `restore` would still exit 1 for another reason, and "byte-identical" compared nothing. This file closes that:
 *
 * - the home directory holds a REAL user file (an `apply --scope user` result, then rewritten as canonical / BOM+CRLF+4-space /
 *   minified bytes, Rule #58) that the guarded project-scope command would change if the guard were missing; a control run proves
 *   the same file IS changeable by the same command at user scope, so "unchanged" is the guard's doing;
 * - HOME is spelled with a trailing slash, a `.` and a `..` segment, a symbolic link, a symbolic link with a trailing slash, and (on
 *   darwin) a case variant, while the process runs in the physical directory;
 * - `skills install|uninstall` is driven with `--project` in every spelling of the home directory, and for every client of PACK_TARGETS;
 * - every adapter of the registry that has a project scope is refused (mechanical, so a later adapter is covered by construction);
 * - text mode (no `--json`) refuses with exit 1, an empty stdout and the reason on stderr.
 *
 * Every child runs with HOME, USERPROFILE, APPDATA and CLAUDE_CONFIG_DIR inside one temporary directory (Rule #54); nothing real is read.
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CLIENT_ADAPTERS } from "../adapters.js";
import { PACK_TARGETS } from "../pack-targets.js";

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
  run: (args: string[], opts?: { cwd?: string; home?: string; env?: Record<string, string> }) => Result;
}

function makeSandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "qa-42-9-home-")));
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
        ...(opts.env ?? {}),
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  return { root, home, run };
}

/** Every entry under `dir` with its kind and content hash. */
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
  error?: string;
}

function envelopeOf(result: Result): Envelope {
  const lines = result.stdout.trim().split("\n");
  expect(lines, `stdout is one envelope: ${result.stdout}`).toHaveLength(1);
  return JSON.parse(lines[0] as string) as Envelope;
}

/** The connection variables `doctor` wants resolvable, so a clean doctor exits 0 and the exit code means "unchanged by the guard". */
const IRIS_ENV = { IRIS_HOST: "h", IRIS_PORT: "1", IRIS_USERNAME: "u", IRIS_NAMESPACE: "N", IRIS_HTTPS: "false", IRIS_PASSWORD: "p" };

const APPLY_USER = ["apply", "--client", "cursor", "--servers", "iris-dev-mcp", "--scope", "user", "--yes", "--json"];
const REMOVE_USER = ["remove", "--client", "cursor", "--server", "iris-dev-mcp", "--scope", "user", "--json"];

/** The cursor user file, which IS the cursor project file when the project directory is the home directory. */
function cursorFile(home: string): string {
  return path.join(home, ".cursor", "mcp.json");
}

type Variant = { name: string; rewrite: (canonical: string) => string };

/** Rule #58: the same document in non-canonical byte forms. The parsed content is unchanged, so the owned entry is still found. */
const VARIANTS: Variant[] = [
  { name: "canonical (2 spaces, LF)", rewrite: (text) => text },
  {
    name: "BOM, CRLF and 4-space indentation",
    rewrite: (text) => `\uFEFF${JSON.stringify(JSON.parse(text), null, 4).replace(/\n/g, "\r\n")}\r\n`,
  },
  { name: "minified, one line, no trailing newline", rewrite: (text) => JSON.stringify(JSON.parse(text)) },
];

/** A home with a real owned user file for cursor (apply at user scope, then the bytes rewritten in the variant's form). */
function seededHome(variant: Variant): Sandbox {
  const sandbox = makeSandbox();
  const first = sandbox.run(APPLY_USER);
  expect(first.status, `seed apply: ${first.stdout}${first.stderr}`).toBe(0);
  const file = cursorFile(sandbox.home);
  const canonical = JSON.parse(readFileSync(file, "utf8")) as { mcpServers: Record<string, unknown> };
  canonical.mcpServers["foreign-tool"] = { command: "third-party" };
  writeFileSync(file, variant.rewrite(JSON.stringify(canonical, null, 2)));
  return sandbox;
}

describe("DW-702 QA: a project-scope command from the home directory leaves a REAL user file byte-identical", () => {
  for (const variant of VARIANTS) {
    it(`${variant.name}: remove, disable, enable, restore, apply and diff --scope project are refused and the bytes are unchanged; the same file IS changed at user scope`, () => {
      const sandbox = seededHome(variant);
      const file = cursorFile(sandbox.home);
      const bytes = readFileSync(file);
      const before = snapshot(sandbox.root);
      const commands: Array<[string, string[]]> = [
        ["apply", ["apply", "--client", "cursor", "--servers", "iris-dev-mcp", "--scope", "project", "--yes", "--json"]],
        ["diff", ["diff", "--client", "cursor", "--servers", "iris-dev-mcp", "--scope", "project", "--json"]],
        ["remove", ["remove", "--client", "cursor", "--server", "iris-dev-mcp", "--scope", "project", "--json"]],
        ["disable", ["disable", "--client", "cursor", "--server", "iris-dev-mcp", "--scope", "project", "--json"]],
        ["enable", ["enable", "--client", "cursor", "--server", "iris-dev-mcp", "--scope", "project", "--json"]],
        ["restore", ["restore", "--client", "cursor", "--scope", "project", "--json"]],
      ];
      for (const [name, args] of commands) {
        const result = sandbox.run(args);
        expect(result.status, `${name}: ${result.stdout}${result.stderr}`).toBe(1);
        const envelope = envelopeOf(result);
        expect(envelope.ok, name).toBe(false);
        expect(envelope.error, name).toBe(
          `refusing to write the project scope of cursor: the project directory ${sandbox.home} is your home directory, ` +
            `so the project file ${file} is the user file ${file}. Open a project folder (or cd into one), or use --scope user.`,
        );
        expect(readFileSync(file).equals(bytes), `${name} left ${file} byte-identical`).toBe(true);
      }
      expect(snapshot(sandbox.root), "nothing anywhere in the sandbox changed").toEqual(before);

      // Control: the identical file is changed by the identical command at user scope, so the unchanged bytes above are the guard's doing.
      const control = sandbox.run(REMOVE_USER);
      expect(control.status, `${control.stdout}${control.stderr}`).toBe(0);
      expect(readFileSync(file).equals(bytes), "remove --scope user rewrites the file").toBe(false);
    }, T);
  }

  it("text mode (no --json): exit 1, an empty stdout, the reason on stderr naming the project directory and the file", () => {
    const sandbox = seededHome(VARIANTS[0] as Variant);
    const before = snapshot(sandbox.root);
    const result = sandbox.run(["remove", "--client", "cursor", "--server", "iris-dev-mcp", "--scope", "project"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`the project directory ${sandbox.home} is your home directory`);
    expect(result.stderr).toContain(cursorFile(sandbox.home));
    expect(snapshot(sandbox.root)).toEqual(before);
  }, T);
});

describe("DW-702 QA: every spelling of HOME that names the working directory is refused (the child runs in the physical directory)", () => {
  const spellings: Array<[string, (sandbox: Sandbox) => string]> = [
    ["a trailing slash", (s) => `${s.home}/`],
    ["a trailing dot segment", (s) => `${s.home}/.`],
    ["a dot-dot segment", (s) => `${s.root}/side/../home`],
    ["a symbolic link", (s) => path.join(s.root, "link")],
    ["a symbolic link with a trailing slash", (s) => `${path.join(s.root, "link")}/`],
  ];
  for (const [name, spell] of spellings) {
    it(`HOME with ${name}: refused, nothing written`, () => {
      const sandbox = makeSandbox();
      mkdirSync(path.join(sandbox.root, "side"));
      symlinkSync(sandbox.home, path.join(sandbox.root, "link"), "dir");
      const homeVar = spell(sandbox);
      const before = snapshot(sandbox.root);
      const result = sandbox.run(["apply", "--client", "cursor", "--servers", "iris-dev-mcp", "--scope", "project", "--yes", "--json"], {
        cwd: sandbox.home,
        home: homeVar,
      });
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
      const error = envelopeOf(result).error ?? "";
      expect(error).toContain("is your home directory");
      expect(error).toContain(".cursor");
      expect(snapshot(sandbox.root)).toEqual(before);
    }, T);
  }

  it.skipIf(process.platform !== "darwin" && process.platform !== "win32")(
    "HOME spelled in another case than the directory on disk (a case-insensitive host): refused",
    () => {
      const sandbox = makeSandbox();
      const before = snapshot(sandbox.root);
      const result = sandbox.run(["apply", "--client", "cursor", "--servers", "iris-dev-mcp", "--scope", "project", "--yes", "--json"], {
        cwd: sandbox.home,
        home: path.join(sandbox.root, "HOME"),
      });
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
      expect(envelopeOf(result).error).toContain("is your home directory");
      expect(snapshot(sandbox.root)).toEqual(before);
    },
    T,
  );

  it("a sibling directory whose name merely starts with HOME's name is a project, not the home directory", () => {
    const sandbox = makeSandbox();
    const sibling = path.join(sandbox.root, "home-2");
    mkdirSync(sibling);
    const result = sandbox.run(["apply", "--client", "cursor", "--servers", "iris-dev-mcp", "--scope", "project", "--yes", "--json"], { cwd: sibling });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(readFileSync(path.join(sibling, ".cursor", "mcp.json"), "utf8")).toContain("iris-dev-mcp");
    expect(() => lstatSync(path.join(sandbox.home, ".cursor"))).toThrow();
  }, T);
});

describe("DW-702 QA: every adapter with a project scope is refused (enumerated from the registry)", () => {
  const withProject = Object.values(CLIENT_ADAPTERS).filter((adapter) => adapter.scopes.some((scope) => scope.scope === "project"));
  it("the registry has project-scope adapters to enumerate (the loop below is not vacuous)", () => {
    expect(withProject.length).toBeGreaterThanOrEqual(10);
  });
  for (const adapter of withProject) {
    it(`apply --client ${adapter.id} --scope project from the home directory is refused and writes nothing`, () => {
      const sandbox = makeSandbox();
      const before = snapshot(sandbox.root);
      const result = sandbox.run(["apply", "--client", adapter.id, "--servers", "iris-dev-mcp", "--scope", "project", "--yes", "--json"]);
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
      const error = envelopeOf(result).error ?? "";
      expect(error.startsWith(`refusing to write the project scope of ${adapter.id}: the project directory ${sandbox.home} is your home directory, so the project file ${sandbox.home}`)).toBe(true);
      expect(error.endsWith("Open a project folder (or cd into one), or use --scope user.")).toBe(true);
      expect(snapshot(sandbox.root)).toEqual(before);
    }, T);
  }
});

describe("DW-702 QA: skills install and uninstall, every spelling of the home directory and every client of the pack", () => {
  const spellings: Array<[string, (sandbox: Sandbox) => { project: string; cwd: string }]> = [
    ["--project .", (s) => ({ project: ".", cwd: s.home })],
    ["--project ./", (s) => ({ project: "./", cwd: s.home })],
    ["--project with a trailing slash", (s) => ({ project: `${s.home}/`, cwd: s.root })],
    ["--project .. from a subfolder of home", (s) => ({ project: "..", cwd: path.join(s.home, "sub") })],
    ["--project with a dot-dot segment", (s) => ({ project: `${s.home}/sub/..`, cwd: s.root })],
    ["--project naming a symbolic link to home", (s) => ({ project: path.join(s.root, "link"), cwd: s.root })],
    ["--project in another case (case-insensitive hosts)", (s) => ({ project: path.join(s.root, "HOME"), cwd: s.root })],
  ];
  for (const [name, spell] of spellings) {
    const caseRow = name.includes("another case");
    const test = caseRow && process.platform !== "darwin" && process.platform !== "win32" ? it.skip : it;
    test(`${name}: refused for install and uninstall, and nothing is written under ~/.claude`, () => {
      const sandbox = makeSandbox();
      mkdirSync(path.join(sandbox.home, "sub"));
      symlinkSync(sandbox.home, path.join(sandbox.root, "link"), "dir");
      const { project, cwd } = spell(sandbox);
      const before = snapshot(sandbox.root);
      for (const action of ["install", "uninstall"]) {
        const result = sandbox.run(["skills", action, "--client", "claude-code", "--project", project, "--yes", "--json"], { cwd });
        expect(result.status, `${action}: ${result.stdout}${result.stderr}`).toBe(1);
        const envelope = envelopeOf(result);
        expect(envelope.ok, action).toBe(false);
        expect(envelope.error, action).toContain(`refusing to ${action} the skills pack for claude-code`);
        expect(envelope.error, action).toContain("is your home directory");
      }
      expect(snapshot(sandbox.root)).toEqual(before);
      expect(() => lstatSync(path.join(sandbox.home, ".claude"))).toThrow();
    }, T);
  }

  it("--dry-run is refused as well", () => {
    const sandbox = makeSandbox();
    const result = sandbox.run(["skills", "install", "--client", "claude-code", "--dry-run", "--json"]);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
    expect(envelopeOf(result).error).toContain("is your home directory");
  }, T);

  const routed = PACK_TARGETS.filter((target) => target.route !== null);
  it("PACK_TARGETS has routed clients to enumerate", () => {
    expect(routed.length).toBeGreaterThanOrEqual(10);
  });
  for (const target of routed) {
    it(`skills install --client ${target.id} from the home directory is refused, with nothing written`, () => {
      const sandbox = makeSandbox();
      const before = snapshot(sandbox.root);
      const result = sandbox.run(["skills", "install", "--client", target.id, "--yes", "--json"]);
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
      expect(envelopeOf(result).error).toContain(`refusing to install the skills pack for ${target.id}`);
      expect(snapshot(sandbox.root)).toEqual(before);
    }, T);
  }

  it("the same install from a subfolder of home is NOT refused (the guard is not a blanket block)", () => {
    const sandbox = makeSandbox();
    const project = path.join(sandbox.home, "proj");
    mkdirSync(project);
    const result = sandbox.run(["skills", "install", "--client", "claude-code", "--yes", "--json"], { cwd: project });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(() => lstatSync(path.join(sandbox.home, ".claude"))).toThrow();
    expect(lstatSync(path.join(project, ".claude")).isDirectory()).toBe(true);
  }, T);
});

describe("DW-702 QA: reads from the home directory are unaffected, with real files in place", () => {
  it("status --json from the home directory lists cursor's project scope at the (user) file, exits 0 and writes nothing; doctor and detect exit 0", () => {
    const sandbox = seededHome(VARIANTS[1] as Variant);
    const before = snapshot(sandbox.root);
    const status = sandbox.run(["status", "--json"]);
    expect(status.status, `${status.stdout}${status.stderr}`).toBe(0);
    expect(status.stdout).toContain(cursorFile(sandbox.home));
    expect(status.stdout).toContain("iris-dev-mcp");
    for (const command of ["detect", "doctor"]) {
      const result = sandbox.run([command, "--json"], { env: IRIS_ENV });
      expect(result.status, `${command}: ${result.stdout}${result.stderr}`).toBe(0);
      expect(envelopeOf(result).ok, command).toBe(true);
    }
    expect(snapshot(sandbox.root)).toEqual(before);
  }, T);
});
