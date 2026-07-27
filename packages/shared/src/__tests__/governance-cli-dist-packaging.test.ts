/**
 * Static packaging contract for the `iris-mcp-governance` bin (Epic 32,
 * Story 32.1), mirroring `credentials-cli-dist-packaging.test.ts` — the
 * 31-2 review HIGH was a packaging test that never EXECUTED the bin, so the
 * fourth test below runs the built `dist/cli/governance-cli.js` in a fresh
 * Node process via `spawnSync`.
 *
 * What is cheaply and mechanically verifiable in the default suite is the
 * one failure mode that would silently defeat real installs:
 * `packages/shared/package.json`'s `bin` entry pointing at a file that
 * doesn't exist post-build, the `#!/usr/bin/env node` shebang not surviving
 * the `tsc` compile into `dist/`, or a bin that throws on import (a bad
 * emitted module specifier / ESM-CJS mismatch). All three pass every unit
 * test in this suite (they import `../cli/governance.js` directly, never
 * through the packaged `bin` entry) and fail 100% of real `npx`/global
 * installs.
 *
 * Reads only already-built `dist/` output — no build is triggered here.
 * `pnpm turbo run build test lint type-check` (and turbo.json's `test` task,
 * which declares `dependsOn: ["build"]`) always builds this package before
 * running its tests, so `dist/` is present by the time this file executes in
 * that flow.
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

describe("iris-mcp-governance bin packaging", () => {
  it('package.json declares a "iris-mcp-governance" bin entry', () => {
    const pkg = readPackageJson();
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin?.["iris-mcp-governance"]).toBeDefined();
    expect(pkg.bin?.["iris-mcp-governance"]).toBe("./dist/cli/governance-cli.js");
  });

  it("the file the bin entry points at actually exists post-build", () => {
    const pkg = readPackageJson();
    const binPath = pkg.bin?.["iris-mcp-governance"];
    expect(binPath).toBeDefined();
    const resolved = path.join(packageRoot, binPath as string);
    expect(existsSync(resolved)).toBe(true);
  });

  it("the built bin's first line is the node shebang (survives tsc compilation)", () => {
    const pkg = readPackageJson();
    const binPath = pkg.bin?.["iris-mcp-governance"] as string;
    const resolved = path.join(packageRoot, binPath);
    const firstLine = readFileSync(resolved, "utf8").split(/\r?\n/)[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });

  // The three static checks above pass for a bin that exists with a correct
  // shebang but throws on import — a bad emitted module specifier, an
  // ESM/CJS mismatch, or a missing `dist/cli/governance.js` sibling. That is
  // precisely the "fails 100% of real npx/global installs" mode this file
  // exists to close, so actually RUN it in a fresh Node process (the 31-2
  // review lesson). `--help` touches no filesystem state and no IRIS
  // connection. Expected values below are the bin's REAL output contract
  // (exit codes + usage text), mirrored from `governance.ts`'s HELP_TEXT and
  // runCli's dispatch — the same strings the unit tests pin in-process.
  it("the built bin actually RUNS in a fresh Node process (exit 0 on --help, exit 2 on an unknown command)", () => {
    const pkg = readPackageJson();
    const binPath = path.join(packageRoot, pkg.bin?.["iris-mcp-governance"] as string);

    const help = spawnSync(process.execPath, [binPath, "--help"], { encoding: "utf8" });
    expect(help.error).toBeUndefined();
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Usage: iris-mcp-governance");
    expect(help.stdout).toContain("iris-mcp-governance");

    // Proves the exit-code wiring in `governance-cli.ts` reaches the real
    // process exit status, not just `runCli`'s return value.
    const bad = spawnSync(process.execPath, [binPath, "definitely-not-a-command"], { encoding: "utf8" });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain("unknown command");
  });

  // The bin must also run a REAL command end-to-end from dist: `validate`
  // against a missing file exercises the arg parser, the loader import, and
  // the exit-1 operational path — the import-graph closure the unit tests
  // (which bypass the bin) cannot prove.
  it("the built bin's validate command runs end-to-end from dist (exit 1 naming IRIS_GOVERNANCE_FILE + path)", () => {
    const pkg = readPackageJson();
    const binPath = path.join(packageRoot, pkg.bin?.["iris-mcp-governance"] as string);
    const missing = path.join(packageRoot, "dist", "definitely-not-a-real-governance-file.json");

    const result = spawnSync(process.execPath, [binPath, "validate", "--file", missing], {
      encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("IRIS_GOVERNANCE_FILE is invalid");
    expect(result.stderr).toContain(missing);
  });
});
