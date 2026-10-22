import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The inputs of `scripts/gen-bootstrap.mjs`, copied from `repoRoot` into the scratch tree `scratch`: the script, the ObjectScript
 * classes, the IPM manifest and install guard, the shared package's manifest and the sequence state, plus the empty directory the
 * embed is written into. The script resolves its repository root from its own location, so such a tree is a complete stand-in and the
 * real embed, manifest and state are never touched. Shared by `gen-bootstrap-write.test.ts` and by the version-step fixture of
 * `@iris-mcp/all` (`release-fixture.ts`).
 */
export function copyGeneratorInputs(scratch: string, repoRoot: string): void {
  mkdirSync(join(scratch, "scripts"), { recursive: true });
  copyFileSync(join(repoRoot, "scripts", "gen-bootstrap.mjs"), join(scratch, "scripts", "gen-bootstrap.mjs"));
  cpSync(join(repoRoot, "src", "ExecuteMCPv2"), join(scratch, "src", "ExecuteMCPv2"), { recursive: true });
  cpSync(join(repoRoot, "ipm"), join(scratch, "ipm"), { recursive: true });
  mkdirSync(join(scratch, "packages", "shared", "src"), { recursive: true });
  copyFileSync(join(repoRoot, "packages", "shared", "package.json"), join(scratch, "packages", "shared", "package.json"));
  copyFileSync(join(repoRoot, "scripts", "bootstrap-sequence.json"), join(scratch, "scripts", "bootstrap-sequence.json"));
}
