/**
 * Story 42.1 (AC 42.1.6, DW-260; AD-29, Rule #45, Rule #59) - every `npx` spec the suite writes, spawns or documents
 * carries the pinned major, taken from one constant.
 *
 *  1. The scan. `scripts/lib/npx-pin-scan.mjs` reads every tracked or untracked-but-not-ignored text file (documents,
 *     source, scripts, manifests, fixtures and the skills pack; lockfiles and the planning, agent and IRIS-source folders
 *     apart) and finds each `@iris-mcp/<name>` spec that does not end in `@1`: a shell line, a JSON or TOML argument
 *     array (also across lines, with or without `-y`), a YAML list, `-p`, `--package=` and `npm exec`. A failure names
 *     `file:line`.
 *  2. The reasoned exemptions (CHANGELOG history, the dated certification captures, the legacy-input fixtures, the
 *     pin tooling's own synthetic input) are checked for rot: each must still match something.
 *  3. What the code writes. The built `synthesizeEntry` is asserted for all five servers in every mode on every
 *     adapter, and the built CLI is driven once end to end.
 *  4. The extension mirror. The extension keeps a literal copy of the major (it has no runtime dependencies and no
 *     bundler); it must equal the constant `@iris-mcp/client-config` exports.
 *
 * The scan's own forms are exercised on synthetic text, and a temp tree with one unpinned row proves a failure names
 * the file and line. A default-suite test (no IRIS); a stale client-config build fails it, it never skips.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EXEMPTIONS,
  findUnpinnedSpecs,
  INLINE_EXEMPTION_MARKER,
  isExcludedPath,
  listScanSurface,
  PIN_TOOLING_FILES,
  scanFiles,
} from "../../../../scripts/lib/npx-pin-scan.mjs";
import { IRIS_MCP_MAJOR as EXTENSION_MAJOR, pinnedSpec as extensionPinnedSpec, PACKAGE_NPM_NAME } from "../../../../extensions/iris-mcp-launcher/src/definitions";
import { REPO_ROOT } from "./pack-fixture";
import { staleDistReason } from "./process-gate-helpers.js";

interface ClientConfigDist {
  IRIS_MCP_MAJOR: string;
  pinnedSpec: (pkg: string) => string;
  PKG_BY_SERVER: Record<string, string>;
  CLIENT_ADAPTERS: Record<string, unknown>;
  CANONICAL_SERVERS: readonly string[];
  synthesizeEntry: (
    server: string,
    mode: string,
    options: { adapter: unknown; profile?: Record<string, unknown>; confirm?: string },
  ) => { ok: boolean; entry?: { command: string; args: string[] }; reason?: string };
}

/** The launch spec each canonical server must synthesize to: literals, so the constant cannot validate itself. */
const EXPECTED_SPEC: Record<string, string> = {
  "iris-admin-mcp": "@iris-mcp/admin@1",
  "iris-data-mcp": "@iris-mcp/data@1",
  "iris-dev-mcp": "@iris-mcp/dev@1",
  "iris-interop-mcp": "@iris-mcp/interop@1",
  "iris-ops-mcp": "@iris-mcp/ops@1",
};

let dist: ClientConfigDist;
let surface: string[] = [];
let rawHits: ReturnType<typeof scanFiles> = [];
const tempDirs: string[] = [];

beforeAll(async () => {
  const stale = staleDistReason(REPO_ROOT, "client-config");
  if (stale !== undefined) throw new Error(`Build client-config first (pnpm --filter @iris-mcp/client-config build): ${stale}`);
  dist = (await import(pathToFileURL(join(REPO_ROOT, "packages/client-config/dist/index.js")).href)) as ClientConfigDist;
  surface = listScanSurface(REPO_ROOT);
  rawHits = scanFiles(REPO_ROOT, surface, dist.IRIS_MCP_MAJOR);
}, 60_000);

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "npx-pin-"));
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

describe("the constant", () => {
  it("is one integer major, written without a range operator (^ is cmd.exe's escape character)", () => {
    expect(dist.IRIS_MCP_MAJOR).toBe("1");
    expect(dist.IRIS_MCP_MAJOR).toMatch(/^\d+$/);
    expect(dist.pinnedSpec("@iris-mcp/dev")).toBe("@iris-mcp/dev@1");
  });

  it("the extension's literal mirror equals client-config's IRIS_MCP_MAJOR", () => {
    expect(
      EXTENSION_MAJOR,
      `extension mirror is ${JSON.stringify(EXTENSION_MAJOR)} but @iris-mcp/client-config exports ${JSON.stringify(dist.IRIS_MCP_MAJOR)}`,
    ).toBe(dist.IRIS_MCP_MAJOR);
    expect(extensionPinnedSpec("@iris-mcp/dev")).toBe(dist.pinnedSpec("@iris-mcp/dev"));
  });

  it("the extension's package names are the bare names of the same five servers", () => {
    const expected = Object.values(EXPECTED_SPEC).map((spec) => spec.replace(/@1$/, "")).sort();
    expect(Object.values(PACKAGE_NPM_NAME).sort()).toEqual(expected);
    expect(Object.values(dist.PKG_BY_SERVER).sort()).toEqual(expected);
  });
});

describe("what the code writes", () => {
  it("synthesizeEntry yields `npx -y <pkg>@1` for all five servers, in every mode, on every adapter", () => {
    const profile = { host: "iris.example.com", port: 52773, username: "svc", namespace: "PROD", https: true, governanceFile: "/p/g.json", password: "pw" };
    let checked = 0;
    for (const adapter of Object.values(dist.CLIENT_ADAPTERS)) {
      for (const server of dist.CANONICAL_SERVERS) {
        for (const mode of ["server-manager", "env-reference", "governance-file", "explicit"]) {
          const result = dist.synthesizeEntry(server, mode, { adapter, profile, confirm: server });
          expect(result.ok, `${server} ${mode}: ${result.reason ?? ""}`).toBe(true);
          expect(result.entry?.command).toBe("npx");
          expect(result.entry?.args).toEqual(["-y", EXPECTED_SPEC[server]]);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(Object.keys(dist.CLIENT_ADAPTERS).length * 5 * 4);
  });

  it("the built `iris-mcp-clients apply` writes the pinned entry into a temp client config", () => {
    const home = mkdtempSync(join(tmpdir(), "npx-pin-home-"));
    const project = mkdtempSync(join(tmpdir(), "npx-pin-proj-"));
    tempDirs.push(home, project);
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, "packages/client-config/dist/cli/clients-cli.js"), "apply", "--client", "claude-code", "--servers", "iris-dev-mcp", "--yes"],
      {
        cwd: project,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          PATH: process.env["PATH"] ?? "",
          SystemRoot: process.env["SystemRoot"] ?? "",
          TMPDIR: process.env["TMPDIR"] ?? "",
          HOME: home,
          USERPROFILE: home,
          APPDATA: join(home, "AppData", "Roaming"),
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const written = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(written.mcpServers["iris-dev-mcp"]?.command).toBe("npx");
    expect(written.mcpServers["iris-dev-mcp"]?.args).toEqual(["-y", "@iris-mcp/dev@1"]);
  });
});

describe("the scan surface", () => {
  it("covers the documents, the extension and client-config, and nothing from the excluded folders", () => {
    for (const expected of [
      "README.md",
      "docs/client-config/claude-code.md",
      "docs/migration-v1-v2.md",
      "packages/iris-dev-mcp/README.md",
      "packages/iris-mcp-all/README.md",
      "packages/client-config/README.md",
      "extensions/iris-mcp-launcher/README.md",
      "extensions/iris-mcp-launcher/package.json",
      "extensions/iris-mcp-launcher/src/definitions.ts",
      "extensions/iris-mcp-launcher/src/__tests__/serverDefinitionProvider.test.ts",
      "packages/client-config/src/synthesize.ts",
      "packages/client-config/scripts/certification-results.json",
      "packages/client-config/src/__tests__/fixtures/golden/cline/stage-1-added.json",
      "packages/client-config/src/__tests__/fixtures/golden/goose/stage-1-added.yaml",
      "packages/client-config/src/__tests__/fixtures/golden/codex/stage-1-added.toml",
      "packages/client-config/skills-pack/rules/cursor/iris-mcp-objectscript-pre-write.mdc",
      "packages/shared/src/cli/governance.ts",
      "packages/shared/src/cli/credentials.ts",
      "packages/iris-dev-mcp/src/index.ts",
      "packages/iris-dev-mcp/package.json",
      "scripts/lib/dist-freshness.mjs",
    ]) {
      expect(surface, expected).toContain(expected);
    }
    expect(surface.filter((file) => /^(_bmad[^/]*|\.claude)\//.test(file))).toEqual([]);
    expect(surface.filter((file) => /(^|\/)(pnpm-lock\.yaml|package-lock\.json)$/.test(file))).toEqual([]);
  });

  it("excludes exactly the planning, agent and IRIS-source folders: a sibling such as .claude-plugin/ is scanned", () => {
    for (const excluded of ["_bmad/config.yaml", "_bmad-output/a.md", ".claude/rules/x.md", "irislib/a.cls", "irissys/a.cls", "sources/a.md"]) {
      expect(isExcludedPath(excluded), excluded).toBe(true);
    }
    for (const scanned of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "sources-notes.md", "docs/_bmad.md", "README.md"]) {
      expect(isExcludedPath(scanned), scanned).toBe(false);
    }
  });
});

describe("no unpinned spec on the surface (AC 42.1.6)", () => {
  it("every spec is pinned, exempted with a reason, or the scan names file:line", () => {
    const unpinned = rawHits.filter((hit) => hit.exemption === null).map((hit) => `${hit.file}:${hit.line}  ${hit.spec}`);
    expect(unpinned).toEqual([]);
  });

  it("every list exemption still matches a real unpinned spec, and carries a reason", () => {
    for (const [index, exemption] of EXEMPTIONS.entries()) {
      expect(exemption.reason.length, `exemption ${index} has no reason`).toBeGreaterThan(20);
      const matched = rawHits.some((hit) => hit.exemption?.kind === "list" && hit.exemption.index === index);
      expect(matched, `exemption ${index} (${String(exemption.file)}) matches nothing: delete it`).toBe(true);
    }
  });

  it("every inline `npx-pin-exempt:` marker sits on a line that holds an unpinned spec", () => {
    const markers: string[] = [];
    for (const file of surface.filter((candidate) => !PIN_TOOLING_FILES.test(candidate))) {
      readFileSync(join(REPO_ROOT, file), "utf8")
        .split("\n")
        .forEach((text, index) => {
          if (text.includes("npx-pin-exempt:")) markers.push(`${file}:${index + 1}`);
        });
    }
    expect(markers.length).toBeGreaterThan(0);
    const marked = new Set(rawHits.filter((hit) => hit.exemption?.kind === "inline").map((hit) => `${hit.file}:${hit.line}`));
    expect(markers.filter((marker) => !marked.has(marker))).toEqual([]);
  });
});

/**
 * Documented bin invocations through npx. The clients and governance CLIs are bins of a scoped package with a different name, so
 * npx must be told the package with `-p`; `npx -y @iris-mcp/client-config iris-mcp-clients <command>` hands `iris-mcp-clients` to the
 * CLI as its first argument, which it refuses as an unknown command (DW-628). Returns one message per wrong invocation.
 */
function binInvocationProblems(text: string): string[] {
  const problems: string[] = [];
  const bare = /\bnpx\b((?:\s+(?:-y|--yes|-p\s+\S+|--package[= ]\S+))*)\s+(iris-mcp-(?:clients|governance|credentials))\b/g;
  for (const match of text.matchAll(bare)) {
    const flags = match[1] ?? "";
    const bin = match[2] as string;
    const expected = bin === "iris-mcp-clients" ? "@iris-mcp/client-config@1" : "@iris-mcp/shared@1";
    if (!flags.includes(`-p ${expected}`)) problems.push(`npx ${bin} needs -p ${expected} (found: npx${flags})`);
  }
  const packageAsCommand = /\bnpx\b(?:\s+(?:-y|--yes))*\s+@iris-mcp\/(?:client-config|shared)\S*\s+(iris-mcp-(?:clients|governance|credentials))\b/g;
  for (const match of text.matchAll(packageAsCommand)) problems.push(`npx runs the package, not the ${match[1]} bin: use -p <package> ${match[1]}`);
  return problems;
}

describe("the documented bin invocations use the -p form (AC 42.1.7, DW-628)", () => {
  it("every documented `npx ... iris-mcp-clients|governance|credentials` line names its package with -p and the pin", () => {
    const problems: string[] = [];
    for (const file of surface.filter((candidate) => candidate.endsWith(".md") && !/(^|\/)CHANGELOG\.md$/.test(candidate))) {
      readFileSync(join(REPO_ROOT, file), "utf8")
        .split("\n")
        .forEach((text, index) => {
          for (const problem of binInvocationProblems(text)) problems.push(`${file}:${index + 1}  ${problem}`);
        });
    }
    expect(problems).toEqual([]);
  });

  it.each([
    "packages/client-config/README.md",
    "docs/client-config/README.md",
    "docs/client-config/claude-code.md",
    "docs/client-config/claude-desktop.md",
    "docs/client-config/cursor.md",
  ])("%s documents `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients <command>`", (file) => {
    expect(readFileSync(join(REPO_ROOT, file), "utf8")).toContain("npx -y -p @iris-mcp/client-config@1 iris-mcp-clients");
  });

  it("the checker rejects the old form, a pinned package used as the command, and a missing pin, and accepts the new one", () => {
    expect(binInvocationProblems("npx -y @iris-mcp/client-config iris-mcp-clients list")).toHaveLength(1);
    expect(binInvocationProblems("npx -y @iris-mcp/client-config@1 iris-mcp-clients list")).toHaveLength(1);
    expect(binInvocationProblems("npx -y iris-mcp-clients list")).toHaveLength(1);
    expect(binInvocationProblems("npx -y -p @iris-mcp/client-config iris-mcp-clients list")).toHaveLength(1);
    expect(binInvocationProblems("npx -y -p @iris-mcp/shared iris-mcp-credentials set x")).toHaveLength(1);
    expect(binInvocationProblems("npx -y -p @iris-mcp/client-config@1 iris-mcp-clients detect --json")).toEqual([]);
    expect(binInvocationProblems("npx -y -p @iris-mcp/shared@1 iris-mcp-credentials set x")).toEqual([]);
    expect(binInvocationProblems("npx -y -p @iris-mcp/shared@1 iris-mcp-governance universe")).toEqual([]);
  });
});

describe("the scan finds every form (Rule #59 controls)", () => {
  const unpinned = (text: string): string[] => findUnpinnedSpecs(text, "1").map((hit) => hit.spec);

  it.each([
    ["a shell line", "npx -y @iris-mcp/dev", ["@iris-mcp/dev"]],
    ["npx without -y", "npx @iris-mcp/dev", ["@iris-mcp/dev"]],
    ["a placeholder name", "`npx -y @iris-mcp/<pkg>`", ["@iris-mcp/<pkg>"]],
    ["the client-config CLI form", "npx -y -p @iris-mcp/client-config iris-mcp-clients detect", ["@iris-mcp/client-config"]],
    ["several -p packages", "npx -y -p @iris-mcp/shared -p @iris-mcp/dev@1 iris-mcp-governance", ["@iris-mcp/shared"]],
    ["--package=", "npx --package=@iris-mcp/shared iris-mcp-governance", ["@iris-mcp/shared"]],
    ["npm exec", "npm exec @iris-mcp/ops", ["@iris-mcp/ops"]],
    ["npm exec with a separator", "npm exec --package @iris-mcp/shared -- iris-mcp-governance", ["@iris-mcp/shared"]],
    ["a JSON array", '"args": ["-y", "@iris-mcp/admin"],', ["@iris-mcp/admin"]],
    ["a JSON array across lines", '"args": [\n  "-y",\n  "@iris-mcp/ops"\n]', ["@iris-mcp/ops"]],
    ["a TOML array", 'args = ["-y", "@iris-mcp/data"]', ["@iris-mcp/data"]],
    ["a YAML list", 'args:\n  - -y\n  - "@iris-mcp/interop"', ["@iris-mcp/interop"]],
    ["a JSON array without -y", '"command": "npx", "args": ["@iris-mcp/dev"]', ["@iris-mcp/dev"]],
    ["a TOML array without -y", 'args = ["@iris-mcp/data"]', ["@iris-mcp/data"]],
    ["a YAML list without -y", 'args:\n  - "@iris-mcp/interop"', ["@iris-mcp/interop"]],
    ["a floating tag", "npx -y @iris-mcp/dev@latest", ["@iris-mcp/dev@latest"]],
    ["a caret range", "npx -y @iris-mcp/dev@^1", ["@iris-mcp/dev@^1"]],
    ["another major", "npx -y @iris-mcp/dev@2", ["@iris-mcp/dev@2"]],
    ["a spec closing a sentence", "Run npx -y @iris-mcp/dev.", ["@iris-mcp/dev"]],
  ])("finds %s", (_form, text, expected) => {
    expect(unpinned(text)).toEqual(expected);
  });

  it.each([
    ["a pinned shell line", "npx -y @iris-mcp/dev@1"],
    ["a pinned sentence end", "Run npx -y @iris-mcp/dev@1."],
    ["pinned -p packages", "npx -y -p @iris-mcp/client-config@1 iris-mcp-clients detect"],
    ["a pinned JSON array", '"args": ["-y", "@iris-mcp/admin@1"],'],
    ["a pinned multi-line array", '"args": [\n  "-y",\n  "@iris-mcp/ops@1"\n]'],
    ["a pinned YAML list", 'args:\n  - -y\n  - "@iris-mcp/interop@1"'],
    ["an import", 'import { x } from "@iris-mcp/shared";'],
    ["an install command", "npm install -g @iris-mcp/all"],
    ["a package name in prose", "the @iris-mcp/dev package ships the server"],
    ["a filter command", "pnpm --filter @iris-mcp/dev build"],
    ["a package-name constant", 'const PKG = "@iris-mcp/dev";'],
    ["a foreign package", 'npx -y @upstash/context7-mcp'],
  ])("passes %s", (_form, text) => {
    expect(unpinned(text)).toEqual([]);
  });

  it("names the file and line of an unpinned row in a temp tree, and passes once it is pinned", () => {
    const root = tempTree({
      "docs/guide.md": "# Guide\n\nStart it:\n\n```\nnpx -y @iris-mcp/dev\n```\n",
      "docs/other.md": "nothing to see\n",
    });
    const failing = scanFiles(root, ["docs/guide.md", "docs/other.md"], "1").filter((hit) => hit.exemption === null);
    expect(failing.map((hit) => `${hit.file}:${hit.line}`)).toEqual(["docs/guide.md:6"]);
    writeFileSync(join(root, "docs/guide.md"), "# Guide\n\nStart it:\n\n```\nnpx -y @iris-mcp/dev@1\n```\n");
    expect(scanFiles(root, ["docs/guide.md", "docs/other.md"], "1")).toEqual([]);
  });

  it("an inline marker with a reason exempts its line of a test file; a bare marker, or a marker in a document or shipped source, does not", () => {
    const files = {
      "src/__tests__/a.ts": 'const legacy = ["-y", "@iris-mcp/dev"]; // npx-pin-exempt: the legacy input this test upgrades\n',
      "src/__tests__/b.ts": 'const legacy = ["-y", "@iris-mcp/dev"]; // npx-pin-exempt:\n',
      "docs/c.md": "npx -y @iris-mcp/dev <!-- npx-pin-exempt: a document cannot exempt itself -->\n",
      "src/d.ts": 'const spec = ["-y", "@iris-mcp/dev"]; // npx-pin-exempt: shipped source cannot exempt itself\n',
    };
    const root = tempTree(files);
    const hits = scanFiles(root, Object.keys(files), "1");
    expect(hits.map((hit) => [hit.file, hit.exemption?.kind ?? null])).toEqual([
      ["src/__tests__/a.ts", "inline"],
      ["src/__tests__/b.ts", null],
      ["docs/c.md", null],
      ["src/d.ts", null],
    ]);
    expect(INLINE_EXEMPTION_MARKER.test("// npx-pin-exempt: a reason")).toBe(true);
  });

  it("scanning with another expected major reports the pinned rows (the major is not hard-coded in the scan)", () => {
    expect(findUnpinnedSpecs("npx -y @iris-mcp/dev@1", "2").map((hit) => hit.spec)).toEqual(["@iris-mcp/dev@1"]);
  });
});
