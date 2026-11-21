import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The inputs of `scripts/gen-bootstrap.mjs`, copied from `repoRoot` into the scratch tree `scratch`: the script and its IPM tree
 * library, the ObjectScript classes, the IPM install guard's source (`ipm/preload`), the shared package's manifest and the sequence
 * state, plus the empty directory the embed is written into. The committed IPM tree (the root `module.xml`, `ipm/src`, `preload`) is
 * NOT copied: the scratch tree starts with none, as a repository does before its first generation. The script resolves its repository
 * root from its own location, so such a tree is a complete stand-in and the real embed, tree and state are never touched. Shared by
 * `gen-bootstrap-write.test.ts` and by the version-step fixture of `@iris-mcp/all` (`release-fixture.ts`).
 */
export function copyGeneratorInputs(scratch: string, repoRoot: string): void {
  mkdirSync(join(scratch, "scripts", "lib"), { recursive: true });
  copyFileSync(join(repoRoot, "scripts", "gen-bootstrap.mjs"), join(scratch, "scripts", "gen-bootstrap.mjs"));
  copyFileSync(join(repoRoot, "scripts", "lib", "ipm-tree.mjs"), join(scratch, "scripts", "lib", "ipm-tree.mjs"));
  cpSync(join(repoRoot, "src", "ExecuteMCPv2"), join(scratch, "src", "ExecuteMCPv2"), { recursive: true });
  cpSync(join(repoRoot, "ipm", "preload"), join(scratch, "ipm", "preload"), { recursive: true });
  mkdirSync(join(scratch, "packages", "shared", "src"), { recursive: true });
  copyFileSync(join(repoRoot, "packages", "shared", "package.json"), join(scratch, "packages", "shared", "package.json"));
  copyFileSync(join(repoRoot, "scripts", "bootstrap-sequence.json"), join(scratch, "scripts", "bootstrap-sequence.json"));
}

/** The committed IPM tree (the root `module.xml`, `ipm/src` and `preload`), copied from `repoRoot` into `scratch`. */
export function copyIpmTree(scratch: string, repoRoot: string): void {
  copyFileSync(join(repoRoot, "module.xml"), join(scratch, "module.xml"));
  cpSync(join(repoRoot, "ipm", "src"), join(scratch, "ipm", "src"), { recursive: true });
  cpSync(join(repoRoot, "preload"), join(scratch, "preload"), { recursive: true });
}
