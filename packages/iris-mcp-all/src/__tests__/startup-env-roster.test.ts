/**
 * The environment-variable roster the default test runs scrub (Story 39.0, DW-543; Rule #56).
 *
 * `@iris-mcp/shared`'s `src/__tests__/startup-env.ts` lists every variable the suite's non-test source
 * reads: `STARTUP_ENV_VARS` (scrubbed before every test file), `CONNECTION_ENV_VARS` (defaulted per test by
 * the harness) and `PLATFORM_ENV_VARS` (never scrubbed). A variable read in source but missing from those
 * lists would leak from a developer's shell into the default suite unseen; a listed variable that nothing
 * reads is a stale entry. This guard scans the source, so both directions fail loudly and name the variable.
 *
 * Exhaustive as of 2026-10-16: the scan covers `src/**` of `packages/shared` and the five server packages,
 * excluding `__tests__/` and `test-helpers/`, and matches `env.NAME` and `env["NAME"]` reads outside comments.
 * The servers read no variable directly (handlers never read the environment); only `shared` does.
 *
 * Placement (Rule #45): `@iris-mcp/shared` cannot import a leaf package, and this package is the one that
 * sees every server's source. The lists are loaded from shared's BUILT `dist/__tests__/startup-env.js`, so a
 * stale dist fails the test with the reason rather than comparing against an old list.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { staleDistReason } from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const SCANNED_PACKAGES = [
  "shared",
  "iris-dev-mcp",
  "iris-admin-mcp",
  "iris-interop-mcp",
  "iris-ops-mcp",
  "iris-data-mcp",
] as const;

/** `env.NAME` and `env["NAME"]` (either quote), where `env` is the whole word. */
const ENV_READ = /\benv(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g;

interface RosterModule {
  CONNECTION_ENV_VARS: readonly string[];
  STARTUP_ENV_VARS: readonly string[];
  PLATFORM_ENV_VARS: readonly string[];
}

/** Every non-test `.ts` file under `dir`, skipping `__tests__/` and `test-helpers/` directories. */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "test-helpers") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
    else if (entry.endsWith(".ts")) files.push(full);
  }
  return files;
}

/** `code` with every comment replaced by spaces; string and template literals are left intact. */
function stripComments(code: string): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const ch = code[i] as string;
    const next = code[i + 1];
    if (ch === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
    } else if (ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
      out += " ";
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const start = i;
      i += 1;
      while (i < code.length && code[i] !== ch) i += code[i] === "\\" ? 2 : 1;
      i += 1;
      out += code.slice(start, i);
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** Each variable name the scanned sources read, with the files that read it. */
function scanReads(): Map<string, string[]> {
  const reads = new Map<string, string[]>();
  for (const pkg of SCANNED_PACKAGES) {
    for (const file of sourceFiles(path.join(REPO_ROOT, "packages", pkg, "src"))) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const match of code.matchAll(ENV_READ)) {
        const name = (match[1] ?? match[2]) as string;
        const where = path.relative(REPO_ROOT, file).split(path.sep).join("/");
        const list = reads.get(name) ?? [];
        if (!list.includes(where)) list.push(where);
        reads.set(name, list);
      }
    }
  }
  return reads;
}

let roster: RosterModule;

async function loadRoster(): Promise<void> {
  const stale = staleDistReason(REPO_ROOT, "shared");
  if (stale) {
    throw new Error(
      `The startup-env roster guard reads the lists from @iris-mcp/shared's built dist, which is not usable: ${stale}`,
    );
  }
  const built = path.join(REPO_ROOT, "packages", "shared", "dist", "__tests__", "startup-env.js");
  // The dist freshness gate skips `src/__tests__/`, which is where the lists live, so compare them here.
  const listSource = path.join(REPO_ROOT, "packages", "shared", "src", "__tests__", "startup-env.ts");
  if (statSync(listSource).mtimeMs > statSync(built).mtimeMs) {
    throw new Error(
      "packages/shared/src/__tests__/startup-env.ts is newer than the built dist/__tests__/startup-env.js, so this guard would " +
        "compare the source against an old copy of the lists. Rebuild @iris-mcp/shared; if the rebuild leaves this unchanged " +
        "(the compiler emits nothing when a file's content did not change), delete packages/shared/dist and " +
        "packages/shared/tsconfig.tsbuildinfo, then rebuild.",
    );
  }
  roster = (await import(pathToFileURL(built).href)) as RosterModule;
}

describe("the startup-env roster matches the variables the source reads (Story 39.0, DW-543, AC-6)", () => {
  beforeAll(loadRoster);

  it("scans the source: it finds the known reads, so an empty scan cannot pass", () => {
    const reads = scanReads();
    expect(reads.get("IRIS_HOST"), "IRIS_HOST is read by config.ts").toContain("packages/shared/src/config.ts");
    expect(reads.get("LOG_LEVEL"), 'LOG_LEVEL is read as env["LOG_LEVEL"] by logger.ts').toContain(
      "packages/shared/src/logger.ts",
    );
    expect(reads.size).toBeGreaterThanOrEqual(30);
  });

  it("every variable the source reads is in one of the three lists", () => {
    const listed = new Set([
      ...roster.STARTUP_ENV_VARS,
      ...roster.CONNECTION_ENV_VARS,
      ...roster.PLATFORM_ENV_VARS,
    ]);
    const unlisted = [...scanReads()]
      .filter(([name]) => !listed.has(name))
      .map(([name, files]) => `${name} (read in ${files.join(", ")})`)
      .sort();
    expect(
      unlisted,
      "add each name to STARTUP_ENV_VARS (an operator variable), CONNECTION_ENV_VARS or PLATFORM_ENV_VARS in packages/shared/src/__tests__/startup-env.ts",
    ).toEqual([]);
  });

  it("every listed variable is read somewhere in the source", () => {
    const reads = scanReads();
    const unread = [
      ...roster.STARTUP_ENV_VARS,
      ...roster.CONNECTION_ENV_VARS,
      ...roster.PLATFORM_ENV_VARS,
    ]
      .filter((name) => !reads.has(name))
      .sort();
    expect(unread, "remove each name from packages/shared/src/__tests__/startup-env.ts: nothing reads it").toEqual([]);
  });
});

/** The packages whose default suite runs the scrub: shared, the five servers and `@iris-mcp/all`. `client-config` does not: it is wired only if its default run goes red under a hostile shell, and it stayed green. */
const SCRUBBED_PACKAGES = [
  "shared",
  "iris-dev-mcp",
  "iris-admin-mcp",
  "iris-interop-mcp",
  "iris-ops-mcp",
  "iris-data-mcp",
  "iris-mcp-all",
] as const;

describe("every default suite clears the startup variables before each test file (Story 39.0, DW-543, AC-5)", () => {
  const setupFile = path.join(REPO_ROOT, "packages", "shared", "src", "__tests__", "startup-env.setup.ts");

  for (const pkg of SCRUBBED_PACKAGES) {
    it(`${pkg}: the vitest config the runner loads lists the shared scrub as a setup file`, async () => {
      const packageDir = path.join(REPO_ROOT, "packages", pkg);
      const loaded = (await import(pathToFileURL(path.join(packageDir, "vitest.config.ts")).href)) as {
        default: { test?: { setupFiles?: string | string[] } };
      };
      const entries = [loaded.default.test?.setupFiles ?? []].flat();
      expect(
        entries.map((entry) => path.resolve(packageDir, entry)),
        `packages/${pkg}/vitest.config.ts test.setupFiles`,
      ).toContain(setupFile);
    });
  }
});
