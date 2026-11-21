/**
 * Story 42.1 QA (AC 42.1.3, AC 42.1.5; I/O matrix rows "Shared tarball" and "Every tarball"; Rule #3, Rule #54, Rule #59) - the five
 * servers START and serve `tools/list` from the PACKED layout, the one a registry install produces.
 *
 * `published-tarballs.test.ts` proves every `exports`/`main`/`types`/`bin` target is IN each tarball. That cannot see a runtime
 * failure: `@iris-mcp/shared` publishes only its root export (`publishConfig.exports`), so any server import of a subpath the
 * tarball no longer advertises, or of a dependency the packed manifest does not declare, works in the repository and fails for a user.
 * Here `@iris-mcp/shared` and the five servers are packed with `pnpm pack` and extracted; each packed server gets a `node_modules`
 * holding ONLY its declared runtime dependencies (taken from the repository's install) and the PACKED shared, and the SDK client
 * connects to it over stdio against a closed port (a server starts without IRIS and answers `tools/list`).
 *
 *  - the packed server reports the name and version of its packed manifest;
 *  - its `tools/list` equals, entry for entry, that of the same server run from the repository's dist: packing moves no wire byte.
 *
 * A stale build fails this test, it never skips. No IRIS is contacted (the child gets a closed local port); everything is written
 * under `os.tmpdir()` and removed in `afterAll`.
 */

import { realpathSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installDeclaredDependencies, makeTempRoot, pnpmPack, type PnpmPack, REPO_ROOT, removeTempRoot } from "./pack-fixture";
import { connectSdkClient, type IrisTarget, reserveClosedPort, resolveSdkEsmDir, staleDistReason, type WireTool } from "./process-gate-helpers.js";

const SERVERS = [
  ["iris-admin-mcp", "@iris-mcp/admin", "iris-admin-mcp"],
  ["iris-data-mcp", "@iris-mcp/data", "iris-data-mcp"],
  ["iris-dev-mcp", "@iris-mcp/dev", "iris-dev-mcp"],
  ["iris-interop-mcp", "@iris-mcp/interop", "iris-interop-mcp"],
  ["iris-ops-mcp", "@iris-mcp/ops", "iris-ops-mcp"],
] as const;

let work = "";
let sdkEsmDir = "";
let target: IrisTarget;
let shared: PnpmPack;
const packedServers = new Map<string, PnpmPack>();

/** The tools a server lists, sorted by name, from the entry point at `entry` (stderr is collected for a failure message). */
async function listToolsOf(entry: string): Promise<{ tools: WireTool[]; version: { name: string; version: string } | undefined; log: string }> {
  let log = "";
  const client = await connectSdkClient({ sdkEsmDir, entry, target, clientName: "story-42-1-qa", onStderr: (chunk) => (log += chunk) }).catch(
    (error: unknown) => {
      throw new Error(`${entry} did not connect: ${error instanceof Error ? error.message : String(error)}\n${log}`);
    },
  );
  try {
    const { tools } = await client.listTools();
    return { tools: [...tools].sort((a, b) => a.name.localeCompare(b.name)), version: client.getServerVersion(), log };
  } finally {
    await client.close().catch(() => {});
  }
}

beforeAll(async () => {
  const dirs = ["shared", ...SERVERS.map(([dir]) => dir)];
  const stale = dirs.map((dir) => [dir, staleDistReason(REPO_ROOT, dir)] as const).filter(([, reason]) => reason !== undefined);
  if (stale.length > 0) throw new Error(`Build the packages first (pnpm --filter "./packages/*" build): ${stale.map(([dir, reason]) => `${dir}: ${reason}`).join("; ")}`);
  const resolved = resolveSdkEsmDir(REPO_ROOT);
  if (resolved === undefined) throw new Error("Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm (run pnpm install)");
  sdkEsmDir = resolved;
  target = { host: "127.0.0.1", port: await reserveClosedPort(), username: "_SYSTEM", password: "SYS", namespace: "USER" };

  work = makeTempRoot("qa-42-1-packed-servers");
  shared = pnpmPack(join(REPO_ROOT, "packages/shared"), join(work, "shared"));
  installDeclaredDependencies(shared, "shared", {});
  for (const [dir] of SERVERS) {
    const pack = pnpmPack(join(REPO_ROOT, "packages", dir), join(work, dir));
    installDeclaredDependencies(pack, dir, { "@iris-mcp/shared": shared.root });
    packedServers.set(dir, pack);
  }
}, 240_000);

afterAll(() => {
  if (work !== "") removeTempRoot(work);
});

describe("the packed @iris-mcp/shared is what the packed servers load", () => {
  it("advertises only its root export, and the packed servers resolve it through that export", () => {
    expect(Object.keys((shared.manifest as { exports: Record<string, unknown> }).exports)).toEqual(["."]);
    for (const [dir] of SERVERS) {
      expect(realpathSync(join((packedServers.get(dir) as PnpmPack).root, "node_modules/@iris-mcp/shared")), dir).toBe(realpathSync(shared.root));
    }
  });
});

describe("each packed server starts and lists the tools its repository build lists (no IRIS)", () => {
  it.each(SERVERS)(
    "%s",
    async (dir, name, bin) => {
      const pack = packedServers.get(dir) as PnpmPack;
      expect(pack.manifest["name"]).toBe(name);
      const entry = join(pack.root, (pack.manifest["bin"] as Record<string, string>)[bin] as string);

      const packed = await listToolsOf(entry);
      expect(packed.tools.length, packed.log).toBeGreaterThan(0);
      expect(packed.tools.map((tool) => tool.name)).toContain("iris_server_profiles");
      expect(packed.version, packed.log).toEqual({ name: expect.any(String), version: pack.manifest["version"] });

      const repository = await listToolsOf(join(REPO_ROOT, "packages", dir, "dist", "index.js"));
      expect(packed.tools, `${name}: the packed tools/list differs from the repository build's`).toEqual(repository.tools);
      expect(packed.version).toEqual(repository.version);
    },
    120_000,
  );
});
