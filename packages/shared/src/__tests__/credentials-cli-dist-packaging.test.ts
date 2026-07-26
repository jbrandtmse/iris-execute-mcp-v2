/**
 * Static packaging contract for the `iris-mcp-credentials` bin (QA gap #5,
 * Story 31.2 / AC 31.2.3).
 *
 * AC 31.2.3's LIVE smoke — running the built bin against the REAL OS
 * keychain in a fresh Node process (`set --stdin` -> `test` -> `delete`) —
 * is explicitly a LEAD gate run after code review (see the story's Dev
 * Notes); it is not repeated here. What IS cheaply and mechanically
 * verifiable in the default suite is the one failure mode that would
 * silently defeat that gate too: `packages/shared/package.json`'s `bin`
 * entry pointing at a file that doesn't exist post-build, or the
 * `#!/usr/bin/env node` shebang not surviving the `tsc` compile into
 * `dist/`. A broken bin path or missing shebang passes every other unit
 * test in this suite (they all import `../cli/credentials.js` directly,
 * never through the packaged `bin` entry) and fails 100% of real
 * `npx`/global installs.
 *
 * Reads only already-built `dist/` output — no build is triggered here.
 * `pnpm turbo run build test lint type-check` (this story's own required
 * full-suite command, and turbo.json's `test` task, which declares
 * `dependsOn: ["build"]`) always builds this package before running its
 * tests, so `dist/` is present by the time this file executes in that flow.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// This file lives at packages/shared/src/__tests__/ — two levels up is the
// package root (packages/shared/), where package.json and dist/ both live.
const packageRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

interface PackageJsonShape {
  bin?: Record<string, string>;
}

function readPackageJson(): PackageJsonShape {
  return JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as PackageJsonShape;
}

describe("iris-mcp-credentials bin packaging", () => {
  it('package.json declares a "iris-mcp-credentials" bin entry', () => {
    const pkg = readPackageJson();
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin?.["iris-mcp-credentials"]).toBeDefined();
    expect(pkg.bin?.["iris-mcp-credentials"]).toBe("./dist/cli/credentials-cli.js");
  });

  it("the file the bin entry points at actually exists post-build", () => {
    const pkg = readPackageJson();
    const binPath = pkg.bin?.["iris-mcp-credentials"];
    expect(binPath).toBeDefined();
    const resolved = path.join(packageRoot, binPath as string);
    expect(existsSync(resolved)).toBe(true);
  });

  it("the built bin's first line is the node shebang (survives tsc compilation)", () => {
    const pkg = readPackageJson();
    const binPath = pkg.bin?.["iris-mcp-credentials"] as string;
    const resolved = path.join(packageRoot, binPath);
    const firstLine = readFileSync(resolved, "utf8").split(/\r?\n/)[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });

  // The three static checks above pass for a bin that exists with a correct
  // shebang but throws on import — a bad emitted module specifier, an
  // ESM/CJS mismatch, or a missing `dist/cli/credentials.js` sibling. That is
  // precisely the "fails 100% of real npx/global installs" mode this file
  // exists to close, so actually RUN it in a fresh Node process (code review
  // 2026-07-25). This is the static half of AC 31.2.3; the live-keychain
  // half remains the lead's smoke gate. `--help` touches no keychain, no
  // network, and no filesystem state.
  it("the built bin actually RUNS in a fresh Node process (exit 0 on --help, exit 2 on an unknown command)", () => {
    const pkg = readPackageJson();
    const binPath = path.join(packageRoot, pkg.bin?.["iris-mcp-credentials"] as string);

    const help = spawnSync(process.execPath, [binPath, "--help"], { encoding: "utf8" });
    expect(help.error).toBeUndefined();
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: iris-mcp-credentials");
    expect(help.stdout).toContain("iris-mcp");

    // Proves the exit-code wiring in `credentials-cli.ts` reaches the real
    // process exit status, not just `runCli`'s return value.
    const bad = spawnSync(process.execPath, [binPath, "definitely-not-a-command"], { encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("unknown command");
  });
});
