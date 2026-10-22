/**
 * The synthetic repository of the package-smoke tests (`story-42-3-qa-package-smoke-runtime.test.ts`, `release-smoke-prebuilt.test.ts`):
 * stand-in server and CLI sources, `packages/<dir>/` directories with a manifest and a fresh `dist/`, the tools-list snapshot, and a
 * run of `smokePackages` over such a repository with `npm_config_offline=true`. The stand-in packages have no third-party dependency, so
 * an install that needs the registry fails instead of reaching it and no network is used.
 *
 * Everything is written by the test that asks for it, under a directory the test removes.
 */

import { mkdirSync, readdirSync, utimesSync } from "node:fs";
import path from "node:path";
import { smokePackages } from "../../../../scripts/ci-package-smoke.mjs";
import { put } from "./pack-fixture";

/** A stdio MCP server stand-in with `count` tools; `shebang` is the file's first line, or none. */
export function serverSource(count: number, shebang: boolean): string {
  return [
    ...(shebang ? ["#!/usr/bin/env node"] : []),
    'const readline = require("node:readline");',
    `const tools = Array.from({ length: ${count} }, (_, index) => ({ name: "tool" + index, description: "stand-in", inputSchema: { type: "object" } }));`,
    "const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: \"2.0\", id, result }) + \"\\n\");",
    "readline.createInterface({ input: process.stdin }).on(\"line\", (line) => {",
    "  if (line.trim() === \"\") return;",
    "  const message = JSON.parse(line);",
    '  if (message.method === "initialize") reply(message.id, { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "stand-in", version: "1.0.0" } });',
    '  else if (message.method === "tools/list") reply(message.id, { tools });',
    '  else if (message.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unsupported" } }) + "\\n");',
    "});",
    "",
  ].join("\n");
}

/** A CLI stand-in: `--help` prints `help` and exits `helpExit`; any other call prints `{}`. */
export function cliSource(help: string, helpExit: number): string {
  return [
    "#!/usr/bin/env node",
    `if (process.argv[2] === "--help") { process.stdout.write(${JSON.stringify(`${help}\n`)}); process.exit(${helpExit}); }`,
    'process.stdout.write("{}\\n");',
    "",
  ].join("\n");
}

/** One package of a synthetic repository. */
export interface PackageSpec {
  dir: string;
  name: string;
  bin: string;
  source: string;
  /** Make `src/` newer than `dist/`. */
  stale?: boolean;
  private?: boolean;
}

/** Write a repository: `packages/<dir>/` with a manifest and a fresh `dist/`, and the tools-list snapshot with `servers[bin]` tools. */
export function writeRepo(repo: string, packages: PackageSpec[], servers: Record<string, number>): void {
  for (const spec of packages) {
    const packageDir = path.join(repo, "packages", spec.dir);
    const manifest: Record<string, unknown> = { name: spec.name, version: "1.0.0", ...(spec.private ? { private: true } : {}), bin: { [spec.bin]: "./dist/bin.js" }, files: ["dist"] };
    put(packageDir, "package.json", `${JSON.stringify(manifest, null, 2)}\n`);
    const dist = put(packageDir, "dist/bin.js", spec.source);
    const src = put(packageDir, "src/index.ts", "export {};\n");
    const now = Date.now() / 1000;
    utimesSync(spec.stale ? dist : src, now - 600, now - 600);
    utimesSync(spec.stale ? src : dist, now - 60, now - 60);
  }
  const snapshot = Object.fromEntries(Object.entries(servers).map(([bin, count]) => [bin, Object.fromEntries(Array.from({ length: count }, (_, index) => [`tool${index}`, {}]))]));
  put(repo, "packages/iris-mcp-all/src/__tests__/fixtures/tools-list-snapshot.json", `${JSON.stringify({ servers: snapshot })}\n`);
  mkdirSync(path.join(repo, "packages", "not-a-package"), { recursive: true });
}

/** The prebuilt tarball of a package, as `smokePackages({ tarballs })` takes it. */
export interface PrebuiltTarball {
  name: string;
  tarball: string;
  manifest: Record<string, unknown>;
  files?: readonly string[];
}

/**
 * Smoke `repo` offline, with the temporary directory pointed at `observed` (an empty directory the caller removes) so that what the
 * smoke leaves behind can be listed afterwards. With `tarballs` the smoke installs exactly those files and packs nothing.
 */
export async function smokeOffline(repo: string, observed: string, tarballs?: readonly PrebuiltTarball[]): Promise<{ code: number; log: string; leftovers: string[] }> {
  const saved = { TMPDIR: process.env["TMPDIR"], offline: process.env["npm_config_offline"] };
  process.env["TMPDIR"] = observed;
  process.env["npm_config_offline"] = "true";
  try {
    const lines: string[] = [];
    const code = await smokePackages({ repoRoot: repo, log: (line: string) => lines.push(line), ...(tarballs === undefined ? {} : { tarballs }) });
    return { code, log: lines.join("\n"), leftovers: readdirSync(observed).filter((name) => name.startsWith("ci-package-smoke-")) };
  } finally {
    for (const [key, value] of [["TMPDIR", saved.TMPDIR], ["npm_config_offline", saved.offline]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
