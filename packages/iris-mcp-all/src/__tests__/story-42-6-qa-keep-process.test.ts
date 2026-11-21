/**
 * Story 42.6 QA (AC 42.6.1, DW-47; Rule #3, #54, #59) -- `ci-package-smoke.mjs --keep <dir>` as a user and a client meet it.
 *
 *  - The script as a REAL PROCESS (`node scripts/ci-package-smoke.mjs ...`, the entry point `isEntryPoint` guards): every refused
 *    argument shape exits 2 with the usage line, and a relative `--keep` path resolves against the working directory, so one given
 *    from the repository root is inside the repository and is refused, with nothing created there. The in-process rows of
 *    `ci-package-smoke.test.ts` call `main()` with absolute paths from the package directory and cannot see either.
 *  - The kept project's `.mcp.json` EXECUTED as written. The smoke starts the servers with its own arguments, so a `.mcp.json` whose
 *    `command`, `args` or `env` was wrong would still pass every row that compares the file with the generator's own output. Here
 *    each entry is started the way a client starts it (cwd = the project, `${VAR}` expanded from an environment that holds the five
 *    variables, no other IRIS_ variable), and must answer `initialize` and `tools/list`.
 *
 * Everything is written under `os.tmpdir()` and removed by the test that made it. The synthetic repository is installed offline
 * (`npm_config_offline`), so no network is used.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { SMOKE_PROTOCOL } from "../../../../scripts/ci-package-smoke.mjs";
import { handshake, openRawWire } from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { makeTempRoot, removeTempRoot } from "./pack-fixture";
import { serverSource, smokeOffline, writeRepo, type PackageSpec } from "./smoke-repo-fixture";

const SCRIPT = path.join(REPO_ROOT, "scripts", "ci-package-smoke.mjs");
const USAGE = "usage: node scripts/ci-package-smoke.mjs [--keep <dir>]";

const roots: string[] = [];
const inRepo: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) removeTempRoot(root);
  for (const leaked of inRepo.splice(0)) rmSync(leaked, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const root = makeTempRoot(prefix);
  roots.push(root);
  return root;
}

/** The environment of a real run: the caller's, with no IRIS_ variable and no CI marker that could change the script. */
function cleanProcessEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string" && !/^(IRIS_|MCP_)/i.test(entry[0])));
}

/** Run the smoke script as a real process; a run that lasts past `limitMs` is killed and reported as such. */
function runSmoke(args: string[], cwd: string, limitMs = 20_000): Promise<{ status: number | null; stderr: string; killed: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd, env: cleanProcessEnv(), stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let killed = false;
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, limitMs);
    child.once("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stderr, killed });
    });
  });
}

describe("ci-package-smoke.mjs as a real process: a refused --keep is exit 2 before anything is packed (AC 42.6.1)", () => {
  it.each([
    ["--keep with no directory", ["--keep"]],
    ["--keep twice", ["--keep", "--keep"]],
    ["--keep with an empty directory", ["--keep", ""]],
    ["--keep with a directory and one more argument", ["--keep", "somewhere", "extra"]],
    ["the directory first", ["somewhere", "--keep"]],
    ["the flag with an equals sign", ["--keep=somewhere"]],
    ["another flag", ["--kept", "somewhere"]],
    ["a bare word", ["unexpected-argument"]],
  ])("%s: exit 2 and the usage line, nothing made", async (_label, args) => {
    const here = scratch("qa-42-6-keep-cwd-");
    const result = await runSmoke(args, here);
    expect(result.killed, "the refusal came at once").toBe(false);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(USAGE);
    expect(readdirSync(here), "no directory was made in the working directory").toEqual([]);
  });

  it("a relative --keep given from the repository root is inside the repository: exit 2, the message names it, and nothing is created there", async () => {
    const relative = `qa-42-6-keep-${process.pid}`;
    inRepo.push(path.join(REPO_ROOT, relative));
    const result = await runSmoke(["--keep", relative], REPO_ROOT);
    expect(result.killed, `the refusal came before the smoke started (stderr: ${result.stderr.slice(0, 300)})`).toBe(false);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(`${path.join(REPO_ROOT, relative)} is inside the repository`);
    expect(existsSync(path.join(REPO_ROOT, relative)), "nothing was created inside the repository").toBe(false);
  });

  it("the same relative name from a directory outside the repository is not refused for being inside it (the working directory decides); a non-empty one is refused for that", async () => {
    const outside = scratch("qa-42-6-keep-outside-");
    mkdirSync(path.join(outside, "taken"));
    writeFileSync(path.join(outside, "taken", "keep.txt"), "mine\n");
    const result = await runSmoke(["--keep", "taken"], outside);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("is not an empty directory");
    expect(result.stderr).not.toContain("is inside the repository");
    expect(readFileSync(path.join(outside, "taken", "keep.txt"), "utf8")).toBe("mine\n");
  });
});

describe("the kept project's .mcp.json, started the way a client starts it (AC 42.6.1)", () => {
  const SERVER: PackageSpec = { dir: "iris-admin-mcp", name: "@iris-mcp/fake-admin", bin: "iris-fake-admin-mcp", source: serverSource(2, true) };

  /** What a client does with an entry: `${VAR}` references in `env` are replaced from its own environment. */
  function expand(env: Record<string, string>, own: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(env).map(([name, value]) => [
        name,
        value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_match, variable: string) => {
          if (own[variable] === undefined) throw new Error(`the variable ${variable} is not set in the client's environment`);
          return own[variable] as string;
        }),
      ]),
    );
  }

  it("every entry launches from the project directory with its own command and arguments, and answers initialize and tools/list", async () => {
    const repo = scratch("qa-42-6-mcp-repo-");
    writeRepo(repo, [SERVER], { [SERVER.bin]: 2 });
    const keep = path.join(scratch("qa-42-6-mcp-keep-"), "project");
    const { code, log } = await smokeOffline(repo, scratch("qa-42-6-mcp-tmp-"), undefined, keep);
    expect(code, log).toBe(0);

    const config = JSON.parse(readFileSync(path.join(keep, ".mcp.json"), "utf8")) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> };
    expect(Object.keys(config.mcpServers)).toEqual([SERVER.bin]);

    const home = scratch("qa-42-6-mcp-home-");
    const clientVariables = { IRIS_HOST: "127.0.0.1", IRIS_PORT: "1", IRIS_USERNAME: "qa", IRIS_PASSWORD: "qa", IRIS_NAMESPACE: "HSCUSTOM" };
    for (const [name, entry] of Object.entries(config.mcpServers)) {
      const env = { ...cleanProcessEnv(), HOME: home, USERPROFILE: home, npm_config_update_notifier: "false", ...expand(entry.env, clientVariables) };
      const wire = openRawWire({ command: entry.command, args: entry.args, cwd: keep, env, timeoutMs: 60_000 });
      try {
        const initialized = await handshake(wire, SMOKE_PROTOCOL, "qa-42-6-client");
        expect(initialized.message?.result?.protocolVersion, name).toBe(SMOKE_PROTOCOL);
        const listed = await wire.request("tools/list", {});
        expect(listed.message?.result?.tools, name).toHaveLength(2);
      } finally {
        await wire.close();
      }
    }
    expect(readdirSync(keep)).toEqual(expect.arrayContaining([".mcp.json", "node_modules", "package.json", "package-lock.json"]));
  }, 240_000);

  it("the same launch from a directory that is not the project fails: the entry depends on the project's node_modules, so the project must be the client's working directory", async () => {
    const repo = scratch("qa-42-6-mcp-repo-");
    writeRepo(repo, [SERVER], { [SERVER.bin]: 2 });
    const keep = path.join(scratch("qa-42-6-mcp-keep-"), "project");
    const { code, log } = await smokeOffline(repo, scratch("qa-42-6-mcp-tmp-"), undefined, keep);
    expect(code, log).toBe(0);
    const entry = (JSON.parse(readFileSync(path.join(keep, ".mcp.json"), "utf8")) as { mcpServers: Record<string, { command: string; args: string[] }> }).mcpServers[SERVER.bin] as { command: string; args: string[] };
    const elsewhere = scratch("qa-42-6-mcp-elsewhere-");
    const home = scratch("qa-42-6-mcp-home-");
    const wire = openRawWire({ command: entry.command, args: entry.args, cwd: elsewhere, env: { ...cleanProcessEnv(), HOME: home, USERPROFILE: home, npm_config_update_notifier: "false", npm_config_offline: "true" }, timeoutMs: 30_000 });
    try {
      await expect(handshake(wire, SMOKE_PROTOCOL, "qa-42-6-client")).rejects.toThrow();
    } finally {
      await wire.close();
    }
  }, 240_000);
});
