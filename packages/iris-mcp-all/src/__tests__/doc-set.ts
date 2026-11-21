/**
 * The Markdown documents of the repository that a reader can open: every tracked `*.md` file that still exists, minus
 * the planning, agent and IRIS-source folders. Shared by `story-42-9-doc-claims.test.ts` and `qa-41-7-doc-links.test.ts`, so the
 * two scans read the same set.
 *
 * Exhaustive as of 2026-11-21: `git ls-files '*.md'` held 83 files outside the excluded roots.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./pack-fixture";

/** Folders that hold no reader documentation: BMAD artifacts, agent rules, the gitignored IRIS source copies and the sources folder. */
export const EXCLUDED_DOC_ROOTS = ["_bmad/", "_bmad-output/", ".claude/", "irislib/", "irissys/", "sources/"] as const;

/** Repository-relative paths (forward slashes), sorted. */
export function readerDocs(): string[] {
  const listed = spawnSync("git", ["ls-files", "--cached", "-z", "--", "*.md"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  return [...new Set(listed.stdout.split("\0").filter((entry) => entry !== ""))]
    .filter((entry) => !EXCLUDED_DOC_ROOTS.some((root) => entry.startsWith(root)) && !entry.includes("node_modules") && existsSync(path.join(REPO_ROOT, entry)))
    .sort();
}
