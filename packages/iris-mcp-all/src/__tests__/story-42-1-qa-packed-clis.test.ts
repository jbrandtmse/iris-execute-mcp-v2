/**
 * Story 42.1 QA (AC 42.1.7, DW-628; I/O matrix rows "Documented CLI form" and "Synthesized entry"; Rule #3, Rule #59) - the
 * three command-line tools are driven from the PACKED tarballs, the files a registry install would put on disk.
 *
 * `@iris-mcp/client-config` (bin `iris-mcp-clients`) and `@iris-mcp/shared` (bins `iris-mcp-governance`,
 * `iris-mcp-credentials`) are packed with `pnpm pack` and extracted into a temp directory; each gets a `node_modules` holding
 * ONLY its declared runtime dependencies (taken from the repository's install), standing in for the registry install `npx`
 * performs, so an undeclared import fails here as it would for a user. The bin files named by the PACKED manifest are then
 * run in real child processes, with a throwaway HOME and working directory:
 *
 *  - the documented form, `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients detect --json`, hands the bin `detect --json`:
 *    exit 0 with the JSON envelope;
 *  - the form the documents used to give, `npx -y @iris-mcp/client-config iris-mcp-clients list` (npx-pin-exempt: the pre-fix form), hands the bin
 *    `iris-mcp-clients list`: exit 2, `unknown command "iris-mcp-clients"`;
 *  - `apply` run from the packed bin writes `["-y", "@iris-mcp/dev@1"]` (the pinned entry, from the published artifact);
 *  - each bin prints help and exit 0, and the help names no unpinned spec;
 *  - every `npx ... -p @iris-mcp/<pkg>@1 <bin>` line of the documents names a package whose packed manifest carries that bin.
 *
 * The registry-resolved `@1` itself cannot run before the first publish; the argv the bin receives is the same. A stale
 * client-config or shared build fails this test, it never skips. Everything is written under `os.tmpdir()` and removed.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findUnpinnedSpecs, listScanSurface } from "../../../../scripts/lib/npx-pin-scan.mjs";
import { installDeclaredDependencies, makeTempRoot, pnpmPack, type PnpmPack, REPO_ROOT, removeTempRoot } from "./pack-fixture";
import { staleDistReason } from "./process-gate-helpers.js";

let work = "";
let clientConfig: PnpmPack;
let shared: PnpmPack;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** The bin file the packed manifest names for `bin`, as an absolute path inside the extracted package. */
function binPath(pack: PnpmPack, bin: string): string {
  const target = (pack.manifest["bin"] as Record<string, string> | undefined)?.[bin];
  if (target === undefined) throw new Error(`the packed manifest of ${String(pack.manifest["name"])} has no bin ${bin}`);
  return join(pack.root, target);
}

/** Run a packed bin as `node <bin> <args>` with a throwaway HOME and working directory (npx does the same, minus the install). */
function runBin(pack: PnpmPack, bin: string, args: string[], sandbox: { home: string; project: string }): Run {
  const result = spawnSync(process.execPath, [binPath(pack, bin), ...args], {
    cwd: sandbox.project,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      PATH: process.env["PATH"] ?? "",
      SystemRoot: process.env["SystemRoot"] ?? "",
      TMPDIR: process.env["TMPDIR"] ?? "",
      HOME: sandbox.home,
      USERPROFILE: sandbox.home,
      APPDATA: join(sandbox.home, "AppData", "Roaming"),
    },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function sandbox(name: string): { home: string; project: string } {
  const home = join(work, `${name}-home`);
  const project = join(work, `${name}-project`);
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { home, project };
}

/** Pack `packages/<dir>` and give it only its declared dependencies, as a registry install would provide them. */
function packAndLink(dir: string): PnpmPack {
  const pack = pnpmPack(join(REPO_ROOT, "packages", dir), join(work, dir));
  installDeclaredDependencies(pack, dir, {});
  return pack;
}

beforeAll(() => {
  for (const dir of ["client-config", "shared"]) {
    const stale = staleDistReason(REPO_ROOT, dir);
    if (stale !== undefined) throw new Error(`Build ${dir} first (pnpm --filter "./packages/*" build): ${stale}`);
  }
  work = makeTempRoot("qa-42-1-packed-clis");
  clientConfig = packAndLink("client-config");
  shared = packAndLink("shared");
}, 240_000);

afterAll(() => {
  if (work !== "") removeTempRoot(work);
});

describe("iris-mcp-clients, run from the packed @iris-mcp/client-config (AC 42.1.7, DW-628)", () => {
  it("the documented form hands the bin `detect --json`: exit 0 and the JSON envelope", () => {
    const run = runBin(clientConfig, "iris-mcp-clients", ["detect", "--json"], sandbox("detect"));
    expect(run.status, run.stderr).toBe(0);
    const envelope = JSON.parse(run.stdout) as { ok: boolean; command: string; data: { adapterDataVersion: string; clients: unknown[] } };
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("detect");
    expect(envelope.data.adapterDataVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(envelope.data.clients.length).toBeGreaterThan(0);
  });

  it("the old form hands the bin its own name as the command: exit 2, unknown command", () => {
    const run = runBin(clientConfig, "iris-mcp-clients", ["iris-mcp-clients", "list"], sandbox("old-form"));
    expect(run.status, run.stdout).toBe(2);
    expect(run.stderr).toContain('unknown command "iris-mcp-clients"');
    expect(run.stdout).toBe("");
  });

  it("apply writes the pinned entry `npx -y @iris-mcp/dev@1` into a client config (Synthesized entry, from the published artifact)", () => {
    const box = sandbox("apply");
    const run = runBin(clientConfig, "iris-mcp-clients", ["apply", "--client", "claude-code", "--servers", "iris-dev-mcp", "--yes"], box);
    expect(run.status, run.stderr).toBe(0);
    const written = JSON.parse(readFileSync(join(box.home, ".claude.json"), "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(written.mcpServers["iris-dev-mcp"]).toMatchObject({ command: "npx", args: ["-y", "@iris-mcp/dev@1"] });
  });
});

describe("every packed bin starts and prints help without naming an unpinned spec", () => {
  it.each([
    ["client-config", "iris-mcp-clients"],
    ["shared", "iris-mcp-governance"],
    ["shared", "iris-mcp-credentials"],
  ] as const)("%s: %s --help", (dir, bin) => {
    const run = runBin(dir === "shared" ? shared : clientConfig, bin, ["--help"], sandbox(`help-${bin}`));
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`Usage: ${bin} `);
    expect(findUnpinnedSpecs(`${run.stdout}\n${run.stderr}`, "1")).toEqual([]);
  });
});

describe("the documents name, for each bin, the package that really carries it", () => {
  /** `npx [-y] -p @iris-mcp/<pkg>@1 <bin>` in the documents. */
  const INVOCATION = /\bnpx\s+(?:-y\s+)?-p\s+(@iris-mcp\/[a-z-]+)@1\s+(iris-mcp-[a-z]+)\b/g;

  it("every documented `npx -y -p @iris-mcp/<pkg>@1 <bin>` line names a package whose packed manifest has that bin", () => {
    const packs: Record<string, PnpmPack> = { "@iris-mcp/client-config": clientConfig, "@iris-mcp/shared": shared };
    const documents = listScanSurface(REPO_ROOT).filter((file) => file.endsWith(".md") && !/(^|\/)CHANGELOG\.md$/.test(file));
    const seen = new Set<string>();
    const wrong: string[] = [];
    for (const file of documents) {
      for (const match of readFileSync(join(REPO_ROOT, file), "utf8").matchAll(INVOCATION)) {
        const [, pkg, bin] = match as unknown as [string, string, string];
        seen.add(`${pkg} ${bin}`);
        const bins = Object.keys(((packs[pkg]?.manifest["bin"]) as Record<string, string> | undefined) ?? {});
        if (!bins.includes(bin)) wrong.push(`${file}: -p ${pkg}@1 ${bin} (that package packs: ${bins.join(", ") || "no bin"})`);
      }
    }
    expect(wrong).toEqual([]);
    expect([...seen].sort()).toEqual([
      "@iris-mcp/client-config iris-mcp-clients",
      "@iris-mcp/shared iris-mcp-credentials",
      "@iris-mcp/shared iris-mcp-governance",
    ]);
  });

  it("the invocation matcher reads the documented form and not the old one", () => {
    const names = (text: string): string[] => [...text.matchAll(INVOCATION)].map((match) => `${match[1]} ${match[2]}`);
    expect(names("npx -y -p @iris-mcp/client-config@1 iris-mcp-clients detect --json")).toEqual(["@iris-mcp/client-config iris-mcp-clients"]);
    expect(names("npx -p @iris-mcp/shared@1 iris-mcp-governance universe")).toEqual(["@iris-mcp/shared iris-mcp-governance"]);
    expect(names("npx -y @iris-mcp/client-config iris-mcp-clients list")).toEqual([]); // npx-pin-exempt: the pre-fix form, the matcher's negative control
  });
});
