/**
 * Fixtures shared by the tests of the IPM archive proof (`ci-ipm-archive.test.ts`, `ci-ipm-archive-tgz.test.ts`): the real embed as
 * `scripts/lib/ipm-archive.mjs` takes it, and a `tar czf` of a directory that holds nothing the archive proof does not expect.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import {
  BOOTSTRAP_CLASSES,
  BOOTSTRAP_VERSION,
  IPM_INSTALL_GUARD,
  IPM_MODULE_NAME,
} from "../../../shared/src/bootstrap-classes.js";
import { classifyDeployedMarker, parseBootstrapMarker } from "../../../shared/src/bootstrap-version.js";

/** The real embed, from the sources of `@iris-mcp/shared` (the scripted run uses the built dist, which holds the same). */
export function realEmbed() {
  return {
    marker: BOOTSTRAP_VERSION,
    classes: BOOTSTRAP_CLASSES,
    guard: IPM_INSTALL_GUARD,
    moduleName: IPM_MODULE_NAME,
    moduleXml: readFileSync(path.join(REPO_ROOT, "ipm", "module.xml"), "utf8"),
    classify: classifyDeployedMarker,
    parse: parseBootstrapMarker,
  };
}

export type Embed = ReturnType<typeof realEmbed>;

/** Every file under `directory`, relative, with forward slashes, sorted. */
export function filesUnder(directory: string, base = directory): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? filesUnder(path.join(directory, entry.name), base) : [path.relative(base, path.join(directory, entry.name)).split(path.sep).join("/")],
    )
    .sort();
}

/**
 * `tar czf <archive> [extra...] -C <directory> .`, with `COPYFILE_DISABLE=1` so that a macOS `tar` stores no AppleDouble `._` member
 * next to a file that carries an extended attribute: such a member is a real member of the archive, which no IPM archive holds.
 * Returns the exit status and what `tar` wrote to stderr (or why it could not be started), for an assertion message.
 */
export function tarGz(archive: string, directory: string, extra: string[] = []): { status: number | null; stderr: string } {
  const made = spawnSync("tar", ["czf", archive, ...extra, "-C", directory, "."], { encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return { status: made.status, stderr: `${made.stderr ?? ""}${made.error?.message ?? ""}` };
}
