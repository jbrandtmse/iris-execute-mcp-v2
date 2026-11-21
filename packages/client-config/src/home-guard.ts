/**
 * `@iris-mcp/client-config` - the home-directory refusal (Story 42.9, DW-702; AD-30).
 *
 * A project-scope write made while the project directory is the user's home directory would land in a user-level location: the
 * project file of most clients IS their user file, and the rest sit in a folder the client reads for every project. Such a write is
 * refused before the write protocol starts, naming the project and user paths. `detect`, `status` and `doctor` are never refused; `diff`
 * and a skills `--dry-run` are, because they plan a write.
 *
 * This module is pure. Whether the project directory resolves to the home directory is decided at the package boundary (the CLI, with
 * the real file system) and arrives as `HostContext.projectIsHome`.
 */

import path from "node:path";

import { resolveScopePath } from "./paths.js";
import type { AdapterPlatform, ClientAdapter, HostContext } from "./types.js";

/** Compare two paths of the simulated platform: case-insensitive on darwin and win32. */
export function samePath(platform: AdapterPlatform, a: string, b: string): boolean {
  const p = platform === "win32" ? path.win32 : path.posix;
  const left = p.normalize(a);
  const right = p.normalize(b);
  return platform === "linux" ? left === right : left.toLowerCase() === right.toLowerCase();
}

/**
 * The refusal text for a project-scope write of an adapter, or `null` when the write may proceed (user scope, an adapter without a
 * project scope, or a project directory that is not the home directory).
 *
 * @param adapter - The client the write targets.
 * @param ctx - The host context; `projectIsHome` is the boundary's verdict.
 * @param exists - The injected existence probe that picks a fallback path, exactly as the write does.
 */
export function homeGuardReason(
  adapter: ClientAdapter,
  ctx: HostContext,
  exists?: (path: string) => boolean,
): string | null {
  if (ctx.projectIsHome !== true || ctx.projectDir === undefined) return null;
  // The project directory IS the home directory (the boundary resolved both through the real path), so the message names it, and
  // the project file under it, the way the user's own HOME writes them.
  const asHome: HostContext = { ...ctx, projectDir: ctx.homeDir };
  const projectFile = resolveScopePath(adapter, "project", asHome, exists);
  if (projectFile === null) return null;
  const userFile = resolveScopePath(adapter, "user", ctx, exists);
  const relation =
    userFile === null
      ? "is a user-level location"
      : samePath(ctx.platform, projectFile, userFile)
        ? `is the user file ${userFile}`
        : `is a user-level location (${userFile})`;
  return (
    `refusing to write the project scope of ${adapter.id}: the project directory ${ctx.homeDir} is your home directory, ` +
    `so the project file ${projectFile} ${relation}. ` +
    `Open a project folder (or cd into one), or use --scope user.`
  );
}

/** The refusal text for a skills install or uninstall whose project directory is the home directory. */
export function skillsHomeGuardReason(client: string, action: string, projectDir: string): string {
  return (
    `refusing to ${action} the skills pack for ${client}: the project directory ${projectDir} is your home directory, ` +
    `so the pack's project folders would be user-level locations that every project of the client reads. ` +
    `Open a project folder (or cd into one), or pass --project <dir>.`
  );
}
