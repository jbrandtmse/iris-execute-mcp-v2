/**
 * Story 42.3 QA (AC 42.3.3; DW-443; I/O matrix row "Package smoke"; Rule #3, Rule #59) -- `scripts/ci-package-smoke.mjs` RUN, over a
 * synthetic repository, with the real `pnpm pack`, the real `npm install` and the real `npx --no` that the `package` job uses.
 *
 * `ci-package-smoke.test.ts` pins the pure helpers. The body of the smoke -- pack, install, start every bin over stdio, check the
 * tool count, `--help`, clean up, exit 1 naming the bin -- is run by no default-suite test, and the shebang mutation of AC 42.3.3
 * was shown red only by hand. Here a small repository (two or five packages with hand-made `dist/` files, a snapshot, a private
 * package that must be left out) is smoked in-process with `npm_config_offline=true`: the packages have no third-party
 * dependency, so an install that needs the registry fails instead of reaching it, and no network is used.
 *
 *  - A CLEAN repository exits 0, names every bin ok, packs only the non-private packages, and removes its temporary directories.
 *  - A repository with one defect per kind exits 1 and names each failing bin with its reason (tool count, a server that cannot
 *    start because its file has no shebang, a `--help` without `Usage: <bin>`, a `--help` that exits 1), while the good server
 *    is still reported ok; its temporary directories are removed too.
 *  - A package whose `src/` is newer than its `dist/` is refused before anything is packed.
 *
 * It also pins the two helpers the smoke was built on (Rule 2): `openRawWire`'s `{ command, args, cwd }` option (default
 * unchanged) and `pnpmPack`'s `ignoreScripts` option.
 *
 * Everything is written under `os.tmpdir()` and removed by the test that made it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { realpathSync } from "node:fs";
import path from "node:path";
import { SMOKE_PROTOCOL } from "../../../../scripts/ci-package-smoke.mjs";
import { pnpmPack } from "../../../../scripts/lib/pnpm-pack.mjs";
import { handshake, openRawWire } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { makeTempRoot, put, removeTempRoot } from "./pack-fixture";
import { cliSource, serverSource, smokeOffline, writeRepo, type PackageSpec } from "./smoke-repo-fixture";

const roots: string[] = [];

/** A new empty directory of this test; removed after it. */
function scratch(prefix: string): string {
  const directory = makeTempRoot(prefix);
  roots.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of roots.splice(0)) removeTempRoot(directory);
});

/** Smoke `repo` offline, with the temporary directory pointed at a directory the test can list afterwards. */
async function smoke(repo: string): Promise<{ code: number; log: string; leftovers: string[] }> {
  return smokeOffline(repo, scratch("qa-42-3-smoke-tmp"));
}

const GOOD_SERVER: PackageSpec = { dir: "iris-fake-mcp", name: "@iris-mcp/fake", bin: "iris-fake-mcp", source: serverSource(2, true) };
const GOOD_CLI: PackageSpec = { dir: "iris-fake-cli", name: "@iris-mcp/fake-cli", bin: "iris-fake-cli", source: cliSource("Usage: iris-fake-cli [options]", 0) };

describe("ci-package-smoke.mjs over a synthetic repository (real pnpm pack, npm install and npx --no, offline)", () => {
  it("exits 0 for good packages, names every bin ok, leaves the private package out and removes its temporary directories", async () => {
    const repo = scratch("qa-42-3-smoke-repo");
    writeRepo(repo, [GOOD_SERVER, GOOD_CLI, { dir: "private-tool", name: "@iris-mcp/private-tool", bin: "iris-private", source: "", private: true }], { "iris-fake-mcp": 2 });

    const { code, log, leftovers } = await smoke(repo);

    expect(code, log).toBe(0);
    expect(log).toContain("packed @iris-mcp/fake ");
    expect(log).toContain("packed @iris-mcp/fake-cli ");
    expect(log, "a private package is not packed").not.toContain("private-tool");
    expect(log).toContain("installed 2 tarballs");
    expect(log).toContain("iris-fake-mcp: initialize and tools/list (2 tools) ok");
    expect(log).toContain("iris-fake-cli: ok");
    expect(log).toContain("2 packages installed from tarballs, 1 servers and their CLIs answered");
    expect(leftovers, "the temporary directories are removed").toEqual([]);
  }, 180_000);

  it("exits 1 and names every failing bin with its reason, still reports the good server ok, and removes its temporary directories", async () => {
    const repo = scratch("qa-42-3-smoke-repo");
    writeRepo(
      repo,
      [
        GOOD_SERVER,
        { dir: "iris-count-mcp", name: "@iris-mcp/count", bin: "iris-count-mcp", source: serverSource(2, true) },
        { dir: "iris-noshebang-mcp", name: "@iris-mcp/noshebang", bin: "iris-noshebang-mcp", source: serverSource(2, false) },
        { dir: "iris-usage-cli", name: "@iris-mcp/usage", bin: "iris-usage-cli", source: cliSource("this is not the usage line", 0) },
        { dir: "iris-exit-cli", name: "@iris-mcp/exit", bin: "iris-exit-cli", source: cliSource("Usage: iris-exit-cli", 1) },
      ],
      { "iris-fake-mcp": 2, "iris-count-mcp": 3, "iris-noshebang-mcp": 2 },
    );

    const { code, log, leftovers } = await smoke(repo);

    expect(code, log).toBe(1);
    expect(log).toContain("iris-fake-mcp: initialize and tools/list (2 tools) ok");
    expect(log).not.toContain("iris-fake-mcp: FAILED");
    expect(log).toContain("iris-count-mcp: tools/list listed 2 tools, the snapshot lists 3.");
    expect(log).toMatch(/iris-noshebang-mcp: the server exited \(code \d+, signal null\) before it answered/);
    expect(log).toContain('iris-usage-cli: --help did not print "Usage: iris-usage-cli".');
    expect(log).toMatch(/iris-exit-cli: --help exited 1/);
    expect(log).toContain("4 problem(s):");
    expect(leftovers, "the temporary directories are removed on a failing run too").toEqual([]);
  }, 240_000);

  it("refuses a package whose src/ is newer than its dist/ before it packs anything", async () => {
    const repo = scratch("qa-42-3-smoke-repo");
    writeRepo(repo, [{ ...GOOD_SERVER, stale: true }], { "iris-fake-mcp": 2 });

    const { code, log, leftovers } = await smoke(repo);

    expect(code).toBe(1);
    expect(log).toMatch(/@iris-mcp\/fake's src\/ has been modified more recently than its dist\//);
    expect(log, "nothing was packed").not.toContain("packed ");
    expect(leftovers).toEqual([]);
  }, 60_000);

  it("asks the servers for the protocol revision the spec names", () => {
    expect(SMOKE_PROTOCOL).toBe("2025-11-25");
  });
});

describe("openRawWire starts an installed bin: { command, args, cwd } is new, the entry path is unchanged", () => {
  /** A stdio server stand-in that lists its working directory and arguments as tool names. */
  function whereServer(directory: string): string {
    return put(
      directory,
      "where.cjs",
      [
        'const readline = require("node:readline");',
        "const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: \"2.0\", id, result }) + \"\\n\");",
        "readline.createInterface({ input: process.stdin }).on(\"line\", (line) => {",
        "  const message = JSON.parse(line);",
        '  if (message.method === "initialize") reply(message.id, { protocolVersion: message.params.protocolVersion, capabilities: {}, serverInfo: { name: "where", version: "0" } });',
        '  else if (message.method === "tools/list") reply(message.id, { tools: [{ name: "cwd:" + process.cwd() }, { name: "argv:" + JSON.stringify(process.argv.slice(2)) }] });',
        "});",
        "",
      ].join("\n"),
    );
  }

  /** The tool names a started server lists. */
  async function namesOf(wire: ReturnType<typeof openRawWire>): Promise<string[]> {
    try {
      await handshake(wire, SMOKE_PROTOCOL, "qa-42-3");
      const listed = await wire.request("tools/list", {});
      return (listed.message.result.tools as Array<{ name: string }>).map((tool) => tool.name);
    } finally {
      await wire.close();
    }
  }

  it("runs `command` with `args` in `cwd` (and ignores `entry`), and keeps running Node on `entry` in the current directory when no command is given", async () => {
    const directory = scratch("qa-42-3-wire");
    const where = whereServer(directory);
    const elsewhere = realpathSync(scratch("qa-42-3-wire-cwd"));
    const env = { PATH: process.env["PATH"] ?? "" };

    const started = await namesOf(openRawWire({ entry: path.join(directory, "no-such-entry.js"), env, command: process.execPath, args: [where, "--flag", "value"], cwd: elsewhere, timeoutMs: 20_000 }));
    expect(started).toEqual([`cwd:${elsewhere}`, 'argv:["--flag","value"]']);

    const byEntry = await namesOf(openRawWire({ entry: where, env, timeoutMs: 20_000 }));
    expect(byEntry).toEqual([`cwd:${realpathSync(process.cwd())}`, "argv:[]"]);
  }, 60_000);
});

describe("pnpmPack runs the package's lifecycle scripts only when asked", () => {
  it("leaves them off by default and runs `prepack` with { ignoreScripts: false }, the path the package job takes", () => {
    const work = scratch("qa-42-3-pack");
    const packageDir = path.join(work, "pkg");
    put(
      packageDir,
      "package.json",
      `${JSON.stringify({ name: "qa-pack-scripts", version: "1.0.0", files: ["generated.txt"], scripts: { prepack: "node -e \"require('node:fs').writeFileSync('generated.txt', 'from prepack')\"" } }, null, 2)}\n`,
    );

    const off = pnpmPack(packageDir, path.join(work, "off"));
    expect(off.files, "scripts are ignored by default").not.toContain("generated.txt");

    const on = pnpmPack(packageDir, path.join(work, "on"), { ignoreScripts: false });
    expect(on.files, "prepack ran and its output was packed").toContain("generated.txt");
  }, 120_000);

  it("creates its destination and extracts the packed manifest", () => {
    const work = scratch("qa-42-3-pack");
    const packageDir = path.join(work, "pkg");
    put(packageDir, "package.json", `${JSON.stringify({ name: "qa-pack-plain", version: "2.3.4" })}\n`);

    const packed = pnpmPack(packageDir, path.join(work, "nested", "dest"));

    expect(packed.manifest["version"]).toBe("2.3.4");
    expect(packed.bytes).toBeGreaterThan(0);
    expect(path.basename(packed.tarball)).toMatch(/\.tgz$/);
  }, 120_000);
});
