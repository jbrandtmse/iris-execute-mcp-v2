/**
 * Shared governance key-derivation + baseline-drift helpers (Story 22.1, CR 16.0-1 /
 * CR 16.0-2).
 *
 * Before Story 22.1 the governance-key derivation was duplicated THREE ways that could
 * silently disagree: the baseline generator (`scripts/gen-governance-baseline.mjs`) used a
 * robust unwrap, while the in-suite drift guard (`governance.test.ts`) did a BARE
 * `inputSchema.shape.action.options` read (the CR 16.0-1 lock-step gap). This module is
 * the SINGLE source of truth both now import, so the CLI `--check` path and the drift test
 * can never derive a different surface.
 *
 * The unwrap itself reuses {@link unwrapActionOptions} from `governance.ts` — the SAME
 * function the enforcement gate uses — so the generator, the drift test, and the runtime
 * gate all peel `ZodOptional`/`ZodDefault`/`ZodNullable` identically.
 */

import { unwrapActionOptions } from "./governance.js";

/**
 * The five server packages whose tools form the governance surface. Single source of
 * truth for both the generator and the drift test (previously duplicated by a
 * "MUST stay in sync" comment — a CR 14.3 maintainability note).
 */
export const SERVER_PACKAGES = [
  "iris-dev-mcp",
  "iris-admin-mcp",
  "iris-interop-mcp",
  "iris-ops-mcp",
  "iris-data-mcp",
] as const;

/**
 * Shared regression wording for a vanished frozen key — used by BOTH the generator's
 * `--check` failure branch and the `governance.test.ts` drift assertion so the two never
 * drift in their guidance.
 */
export const VANISHED_HINT =
  "a FROZEN foundation key disappeared from the live tool surface — this is a real " +
  "back-compat regression (a grandfathered action would lose its enabled-by-default " +
  "guarantee). Restore the tool/action, do NOT regenerate the frozen baseline.";

/** Minimal shape both a raw built-dist tool object and a synthetic test tool satisfy. */
export interface DerivableTool {
  name?: unknown;
  inputSchema?: unknown;
}

/**
 * Derive the governance keys for ONE tool (architecture decision D4), applying the SAME
 * `ZodOptional`/`ZodDefault`/`ZodNullable` unwrap as the enforcement gate
 * ({@link unwrapActionOptions}) so the generator and the drift guard can never diverge
 * (CR 16.0-1).
 *
 * - A multi-action tool (an `action` enum) emits `tool:<value>` for every option.
 * - A single-operation tool (no `action` enum) emits the bare `tool` name.
 *
 * Malformed shapes THROW (never silently downgrade to a bare/`undefined` key), naming the
 * offending tool — mirroring the generator's fail-fast guards (Story 15.0 AC 15.0.5).
 *
 * @param tool     - A tool object (built-dist or synthetic) with `name` + `inputSchema`.
 * @param pkgLabel - Optional package name for clearer error messages.
 * @returns The governance key(s) for the tool.
 * @throws {Error} on a missing/empty name, missing inputSchema, empty action enum, or a
 *   non-string action option.
 */
export function deriveKeysForTool(tool: DerivableTool, pkgLabel = ""): string[] {
  const where = pkgLabel ? `${pkgLabel}/` : "";
  const name = tool?.name;
  if (typeof name !== "string" || name === "") {
    throw new Error(
      `deriveKeysForTool: ${where}tool has a missing/empty "name" (got ${JSON.stringify(name)}).`,
    );
  }
  if (tool.inputSchema == null) {
    throw new Error(
      `deriveKeysForTool: ${where}${name} is missing "inputSchema".`,
    );
  }
  const shape = (tool.inputSchema as { shape?: { action?: unknown } }).shape;
  const actionField = shape?.action;
  if (actionField != null) {
    const options = unwrapActionOptions(actionField);
    if (options !== undefined) {
      if (!Array.isArray(options) || options.length === 0) {
        throw new Error(
          `deriveKeysForTool: ${where}${name} declares an EMPTY "action" enum. ` +
            `A multi-action tool must declare at least one action value.`,
        );
      }
      const keys: string[] = [];
      for (const value of options) {
        if (typeof value !== "string") {
          throw new Error(
            `deriveKeysForTool: ${where}${name} has a non-string "action" enum option ` +
              `(${JSON.stringify(value)}). Action values must be strings.`,
          );
        }
        keys.push(`${name}:${value}`);
      }
      return keys;
    }
  }
  return [name];
}

/**
 * One-directional baseline drift (CR 16.0-2): compare the FROZEN committed baseline to the
 * LIVE key surface.
 *
 * - `vanished` = committed \ live — a real back-compat regression (a grandfathered action
 *   disappeared, losing its enabled-by-default guarantee). MUST be empty.
 * - `postFoundation` = live \ committed — EXPECTED, allowed growth (new Epic 15+ keys).
 *
 * Extracting this pure comparison lets the vanished-key exit-1 path be unit-tested with
 * synthetic sets — no dist mutation and no frozen-file perturbation needed (the gap the
 * `governance-baseline-check.test.ts` CLI suite documented it could not cover).
 *
 * @param committed - The committed frozen-foundation keys.
 * @param live      - The keys derived from the live tool surface.
 * @returns `{ vanished, postFoundation }`, both sorted ascending.
 */
export function computeBaselineDrift(
  committed: Iterable<string>,
  live: Iterable<string>,
): { vanished: string[]; postFoundation: string[] } {
  const committedSet = new Set(committed);
  const liveSet = new Set(live);
  const vanished = [...committedSet].filter((k) => !liveSet.has(k)).sort();
  const postFoundation = [...liveSet].filter((k) => !committedSet.has(k)).sort();
  return { vanished, postFoundation };
}
