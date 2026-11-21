/**
 * Shared helper for the launcher's two SDK-client tests (`localSpawnIntegration.test.ts`, `governanceUiRoundTrip.test.ts`) and for
 * `sdkClientResolution.test.ts`, which checks the lookup they run. Single-sourced deliberately: each integration test SKIPS when the
 * client is not found, and a skip reads the same as "IRIS is not running", so the resolution test is the only red a broken lookup
 * produces, and it can only be that red if it runs the same lookup.
 *
 * The extension is outside the pnpm workspace and declares no dependency on `@modelcontextprotocol/client` (the client is only a
 * devDependency of the monorepo's own packages), so the client is found in the monorepo's pnpm STORE layout,
 * `node_modules/.pnpm/@modelcontextprotocol+client@<version>/node_modules/@modelcontextprotocol/client/dist/`, never at a pinned path.
 *
 * NOT a `*.test.ts` file, so `vitest.config.ts` never collects it as a suite; it sits under `src/__tests__`, which
 * `tsconfig.build.json` excludes, so it never reaches `dist/` or the VSIX.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** The monorepo root: four levels up from `src/__tests__` (`__tests__` -> `src` -> `iris-mcp-launcher` -> `extensions` -> root). */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** The pnpm store directory-name prefix of the client package. */
export const SDK_CLIENT_STORE_PREFIX = "@modelcontextprotocol+client@";

/**
 * The ESM build of `@modelcontextprotocol/client` (its `dist/`, holding `index.mjs` and `stdio.mjs`) in the monorepo's pnpm store, or
 * `undefined`. The candidates are sorted and tried in turn: the store holds one directory per (version, peer-hash) pair, so the first
 * entry may lack a dist while a later one has it.
 *
 * @param repoRoot - The monorepo root; defaults to {@link REPO_ROOT}.
 */
export function resolveSdkEsmDir(repoRoot: string = REPO_ROOT): string | undefined {
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return undefined;
  let entries: string[];
  try {
    entries = readdirSync(pnpmDir);
  } catch {
    return undefined;
  }
  const candidates = entries.filter((name) => name.startsWith(SDK_CLIENT_STORE_PREFIX)).sort();
  for (const candidate of candidates) {
    const esmDir = path.join(pnpmDir, candidate, "node_modules", "@modelcontextprotocol", "client", "dist");
    if (existsSync(path.join(esmDir, "index.mjs")) && existsSync(path.join(esmDir, "stdio.mjs"))) return esmDir;
  }
  return undefined;
}
