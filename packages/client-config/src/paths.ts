/**
 * `@iris-mcp/client-config` — pure path resolution (Epic 33, Story 33.0).
 *
 * Resolves an adapter scope's path templates against an INJECTED
 * platform/env/homeDir/projectDir — this module never reads process.env,
 * process.platform, or os.homedir() (story constraint; the 33.2 CLI wires
 * the real ones at the package boundary).
 *
 * Path discipline (32-3-R2 / Rule #16 spirit): all joins/normalizes go
 * through `path.win32` or `path.posix` selected by the SIMULATED platform —
 * never bare `path`, so win32/darwin/linux can be simulated on any host.
 */

import path from "node:path";

import type { AdapterPlatform, ClientAdapter, ClientScope, HostContext, LegacyScopeDef, ScopeDef } from "./types.js";

/** The path module view for the simulated platform. */
function pathFor(platform: AdapterPlatform): typeof path.win32 | typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Expand a path template against the injected context:
 * - `%VAR%` and `${VAR}` expand from `ctx.env`; an unset/empty variable
 *   leaves the placeholder VERBATIM (never invent values — a probe against
 *   the unresolved path simply reports not-exists).
 * - A leading `~` expands to `ctx.homeDir`.
 * - The result is normalized with the simulated platform's separator.
 */
export function resolvePathTemplate(template: string, ctx: HostContext): string {
  const p = pathFor(ctx.platform);
  let out = template;
  out = out.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name: string) => {
    const value = ctx.env[name];
    return value !== undefined && value !== "" ? value : whole;
  });
  out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => {
    const value = ctx.env[name];
    return value !== undefined && value !== "" ? value : whole;
  });
  if (out === "~" || out.startsWith("~/")) {
    out = ctx.homeDir + out.slice(1);
  }
  // Forward-slash templates normalize to the simulated platform's separators.
  return p.normalize(out);
}

/**
 * Resolve the effective config-file path for one adapter scope, or `null`
 * when the scope cannot be resolved in this context (a project scope with no
 * projectDir, or an envOverride variable that is set-but-unresolvable is not
 * possible — an UNSET override variable simply falls through to the template).
 *
 * Resolution order: scope `envOverride` (when its variable is set) → primary
 * template → `fallbacks[]` in order, the first whose file `exists` wins
 * (existence is probed through the injected `exists` predicate; when no
 * predicate is supplied the PRIMARY template is returned — pure resolution
 * with no fs access).
 */
export function resolveScopePath(
  adapter: ClientAdapter,
  scope: ClientScope,
  ctx: HostContext,
  exists?: (path: string) => boolean,
): string | null {
  const scopeDef = adapter.scopes.find((s) => s.scope === scope);
  if (!scopeDef) return null;
  if (scopeDef.scope === "project" && ctx.projectDir === undefined) return null;

  if (scopeDef.envOverride) {
    const overrideRoot = ctx.env[scopeDef.envOverride.var];
    if (overrideRoot !== undefined && overrideRoot !== "") {
      return joinScope(ctx, overrideRoot, scopeDef.envOverride.pathSuffix, scopeDef);
    }
  }

  const primary = resolveScopeTemplate(scopeDef.paths[ctx.platform], ctx, scopeDef);
  if (primary === null) return null;
  if (!exists || exists(primary)) return primary;
  for (const fallback of scopeDef.fallbacks ?? []) {
    const candidate = resolveScopeTemplate(fallback[ctx.platform], ctx, scopeDef);
    if (candidate !== null && exists(candidate)) return candidate;
  }
  return primary;
}

/**
 * The adapter as one of its scopes sees it: the scope's `entryShape` and `strictJson` override the
 * adapter's. An adapter whose scope sets neither is returned as is, so every other adapter's data and
 * behavior are untouched.
 */
export function adapterForScope(adapter: ClientAdapter, scope: ClientScope): ClientAdapter {
  const scopeDef = adapter.scopes.find((s) => s.scope === scope);
  if (scopeDef === undefined || (scopeDef.entryShape === undefined && scopeDef.strictJson !== true)) return adapter;
  return {
    ...adapter,
    ...(scopeDef.entryShape !== undefined ? { entryShape: scopeDef.entryShape } : {}),
    ...(scopeDef.strictJson === true ? { strictJson: true } : {}),
  };
}

/**
 * The adapter as one of its legacy files sees it: the legacy format, root key and expansion, one scope
 * holding the legacy path templates, and the standard entry shape. It is a read-only view for
 * reading the old file and for removing owned entries from it.
 */
export function legacyAdapterView(adapter: ClientAdapter, legacy: LegacyScopeDef): ClientAdapter {
  return {
    ...adapter,
    format: legacy.format,
    rootKey: legacy.rootKey,
    envExpansion: legacy.envExpansion,
    entryShape: "standard",
    scopes: [{ scope: legacy.scope, paths: legacy.paths, shareable: legacy.scope === "project" }],
    detection: [],
  };
}

/** The resolved path of one legacy file, or `null` when the context cannot resolve it (a project file with no project directory). */
export function resolveLegacyPath(adapter: ClientAdapter, legacy: LegacyScopeDef, ctx: HostContext): string | null {
  return resolveScopePath(legacyAdapterView(adapter, legacy), legacy.scope, ctx);
}

/** All candidate paths for a scope (primary + fallbacks), resolved, for
 * detection probe enumeration. Project scopes return [] without projectDir. */
export function resolveScopeCandidates(
  adapter: ClientAdapter,
  scope: ClientScope,
  ctx: HostContext,
): string[] {
  const scopeDef = adapter.scopes.find((s) => s.scope === scope);
  if (!scopeDef) return [];
  if (scopeDef.scope === "project" && ctx.projectDir === undefined) return [];
  const out: string[] = [];
  if (scopeDef.envOverride) {
    const overrideRoot = ctx.env[scopeDef.envOverride.var];
    if (overrideRoot !== undefined && overrideRoot !== "") {
      out.push(joinScope(ctx, overrideRoot, scopeDef.envOverride.pathSuffix, scopeDef));
      return out;
    }
  }
  const primary = resolveScopeTemplate(scopeDef.paths[ctx.platform], ctx, scopeDef);
  if (primary !== null) out.push(primary);
  for (const fallback of scopeDef.fallbacks ?? []) {
    const candidate = resolveScopeTemplate(fallback[ctx.platform], ctx, scopeDef);
    if (candidate !== null) out.push(candidate);
  }
  return out;
}

function resolveScopeTemplate(template: string, ctx: HostContext, scopeDef: ScopeDef): string | null {
  if (scopeDef.scope === "project") {
    if (ctx.projectDir === undefined) return null;
    return joinScope(ctx, ctx.projectDir, template, scopeDef);
  }
  return resolvePathTemplate(template, ctx);
}

function joinScope(ctx: HostContext, root: string, suffix: string, _scopeDef: ScopeDef): string {
  const p = pathFor(ctx.platform);
  return p.normalize(p.join(root, suffix));
}
