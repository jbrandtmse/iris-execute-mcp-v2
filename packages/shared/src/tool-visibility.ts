/**
 * Tool visibility engine (Epic 30 — architecture decisions I1, I2).
 *
 * A *visibility* config answers "does the agent know this tool exists?" — a
 * PER-TOOL, ADVERTISE-TIME concern, orthogonal to the governance engine
 * (`governance.ts`), which answers "is this call allowed?" per ACTION at
 * CALL time. A hidden tool never reaches the governance gate at all: it is
 * filtered out of the {@link McpServerBase} constructor's registration loop
 * (`server-base.ts`) BEFORE `registerTool` runs, so it is absent from the SDK
 * registry, from `tools/list`, and from governance key derivation.
 *
 * **Env vars, parsed once at startup (mirroring `parseGovernanceConfig`/
 * `parseGovernancePreset`'s fail-fast style):**
 * - `IRIS_TOOLS_PRESET` — `full` (default) | `core` | `developer`. Unknown
 *   value fails fast at startup, naming the valid values.
 * - `IRIS_TOOLS_DISABLE` — comma-separated tool names to hide. Trailing-`*`
 *   wildcard supported (`iris_doc_*`); a bare `*` alone is rejected.
 * - `IRIS_TOOLS_ENABLE` — comma-separated tool names to force-show, beating
 *   both the preset and `IRIS_TOOLS_DISABLE`. Same syntax.
 *
 * **Resolution (mirrors the governance cascade shape):**
 * ```
 * visible(tool) = ENABLE-match ?? DISABLE-match(inverted) ?? presetRoster(tool) ?? true
 * ```
 * i.e. precedence **ENABLE > DISABLE > preset > default-visible**.
 *
 * **Reserved tool.** `iris_server_profiles` (`SERVER_DISCOVERY_TOOL_NAME`) is
 * registered OUTSIDE `options.tools` (unconditionally, by `McpServerBase`
 * itself) and is therefore never part of the `toolNames` this module resolves
 * over. Naming it *literally* in `IRIS_TOOLS_DISABLE` is a deliberate
 * misconfiguration and fails fast; a wildcard that would match it is a
 * cross-server sharing artifact and is silently inert (the reserved tool is
 * simply never a candidate for hiding).
 *
 * **Preset rosters (I2).** Each package MAY supply a {@link ToolPresetRosters}
 * (`packages/<pkg>/src/tools/presets.ts`, wired via
 * `McpServerBaseOptions.toolPresets`) declaring an explicit `include`/
 * `exclude` disposition for every one of its tools, for each NAMED preset
 * (`core`, `developer` — `full` is reserved and cannot be defined in a
 * roster; it always means "every tool visible"). {@link assertPresetCoverage}
 * enforces completeness at construction: `include ∪ exclude` must equal the
 * package's tool-name set exactly, with no overlap. Rosters are optional —
 * `Story 30.1` is the first package to wire them; until then
 * `options.toolPresets` is absent and every named preset behaves like `full`.
 */

/** The three recognized `IRIS_TOOLS_PRESET` values. `full` is reserved: it always means "every tool visible" and cannot be defined in a package's roster. */
export const TOOL_PRESET_NAMES = ["full", "core", "developer"] as const;

/** A recognized `IRIS_TOOLS_PRESET` value. */
export type ToolPresetName = (typeof TOOL_PRESET_NAMES)[number];

/** The two preset names a package roster may define (`full` is reserved and never appears here). */
const NAMED_PRESET_NAMES: readonly Exclude<ToolPresetName, "full">[] = [
  "core",
  "developer",
];

/** One named preset's explicit visibility disposition for every tool in a package. */
export interface ToolPresetRoster {
  /** Tool names visible under this preset. */
  include: string[];
  /** Tool names hidden under this preset. */
  exclude: string[];
}

/**
 * A package's complete preset rosters (architecture decision I2), the shape
 * `packages/<pkg>/src/tools/presets.ts` exports and passes to
 * {@link McpServerBaseOptions.toolPresets}. Every tool the package registers
 * MUST appear in exactly one of `include`/`exclude` for EACH named preset —
 * enforced by {@link assertPresetCoverage} at server construction.
 */
export interface ToolPresetRosters {
  core: ToolPresetRoster;
  developer: ToolPresetRoster;
}

/**
 * Parsed `IRIS_TOOLS_PRESET`/`IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE`
 * configuration, returned by {@link parseToolVisibilityConfig}.
 */
export interface ToolVisibilityConfig {
  /** Active preset (`full` when `IRIS_TOOLS_PRESET` is unset/empty). */
  preset: ToolPresetName;
  /** Normalized (trimmed, comma-split, empties dropped) `IRIS_TOOLS_DISABLE` entries. */
  disable: string[];
  /** Normalized (trimmed, comma-split, empties dropped) `IRIS_TOOLS_ENABLE` entries. */
  enable: string[];
}

/** Fail-fast helper: a clear error naming `IRIS_TOOLS_PRESET` (mirrors `presetError` in `governance.ts`). */
function toolsPresetError(detail: string): Error {
  return new Error(`IRIS_TOOLS_PRESET is invalid: ${detail}`);
}

/** Fail-fast helper: a clear error naming the offending env var (`IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE`). */
function toolsListError(varName: string, detail: string): Error {
  return new Error(`${varName} is invalid: ${detail}`);
}

/** Valid `IRIS_TOOLS_PRESET` values, named in the fail-fast error message. */
const VALID_TOOL_PRESETS: readonly ToolPresetName[] = TOOL_PRESET_NAMES;

/**
 * Normalize one `IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE` value: split on comma,
 * trim whitespace, drop empty entries. A bare `*` token (the whole entry,
 * not a trailing-wildcard family pattern like `iris_doc_*`) fails fast — it
 * would hide/force-show literally every tool, which is never the intended
 * usage (use `IRIS_TOOLS_PRESET` for that).
 */
function parseToolNameList(
  raw: string | undefined,
  varName: string,
): string[] {
  if (raw === undefined || raw === "") return [];
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const entry of entries) {
    if (entry === "*") {
      throw toolsListError(
        varName,
        `a bare "*" wildcard (matching every tool) is not allowed. Use a trailing-wildcard ` +
          `family pattern instead (e.g. "iris_doc_*"), or list explicit tool names.`,
      );
    }
  }
  return entries;
}

/**
 * Parse the `IRIS_TOOLS_PRESET`/`IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE`
 * environment family (Epic 30, spec 11 §2.2), mirroring
 * {@link import("./governance.js").parseGovernancePreset}'s fail-fast style.
 *
 * Unset/empty `IRIS_TOOLS_PRESET` ⇒ `"full"` (byte-for-byte back-compat —
 * every tool visible, Rule #19). An unrecognized preset value fails fast,
 * naming the valid values. A bare `*` in either list entry fails fast (see
 * {@link parseToolNameList}). This function does NOT know the server's tool
 * names, so it cannot detect unknown-name / zero-match-wildcard / literal
 * reserved-tool-disable conditions — those require the live tool set and are
 * detected by {@link resolveVisibleTools}.
 *
 * @param env - Environment map (defaults to `process.env`).
 * @throws {Error} (naming `IRIS_TOOLS_PRESET`) on an unrecognized preset value.
 * @throws {Error} (naming `IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE`) on a bare `*` entry.
 */
export function parseToolVisibilityConfig(
  env: Record<string, string | undefined> = process.env,
): ToolVisibilityConfig {
  const rawPreset = env.IRIS_TOOLS_PRESET;
  let preset: ToolPresetName;
  if (rawPreset === undefined || rawPreset === "") {
    preset = "full";
  } else if ((VALID_TOOL_PRESETS as readonly string[]).includes(rawPreset)) {
    preset = rawPreset as ToolPresetName;
  } else {
    throw toolsPresetError(
      `must be one of: ${VALID_TOOL_PRESETS.join(", ")}. Received: ${JSON.stringify(rawPreset)}.`,
    );
  }

  const disable = parseToolNameList(env.IRIS_TOOLS_DISABLE, "IRIS_TOOLS_DISABLE");
  const enable = parseToolNameList(env.IRIS_TOOLS_ENABLE, "IRIS_TOOLS_ENABLE");

  return { preset, disable, enable };
}

/** True when `pattern` matches `name` — exact match, or (for a trailing-`*` pattern) a prefix match. */
function matchesPattern(pattern: string, name: string): boolean {
  if (pattern.endsWith("*")) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return pattern === name;
}

/** Parameters accepted by {@link resolveVisibleTools}. */
export interface ResolveVisibleToolsParams {
  /** The candidate tool names to resolve (typically `options.tools.map(t => t.name)`), NOT including `reservedName`. */
  toolNames: string[];
  /** Parsed env configuration from {@link parseToolVisibilityConfig}. */
  config: ToolVisibilityConfig;
  /** The package's preset rosters, or `undefined` when not yet wired (no-op: every named preset behaves like `full`). */
  rosters: ToolPresetRosters | undefined;
  /** The reserved discovery tool's name (`SERVER_DISCOVERY_TOOL_NAME`) — ALWAYS visible, never a candidate for hiding. */
  reservedName: string;
}

/** Result of {@link resolveVisibleTools}. */
export interface ResolveVisibleToolsResult {
  /** The visible subset of `toolNames`, PLUS `reservedName` (always present). */
  visible: Set<string>;
  /** Startup-log warnings (AC 30.0.1): literal dup, unknown name, zero-match wildcard. */
  warnings: string[];
}

/**
 * Resolve which tools are visible under the parsed {@link ToolVisibilityConfig}
 * (Epic 30, spec 11 §2.2), applying precedence
 * **ENABLE > DISABLE > preset > default-visible**, and collecting every
 * AC 30.0.1 warning condition along the way.
 *
 * - **Literal name in both `disable` and `enable`** (exact-string duplicate,
 *   NOT a wildcard-vs-literal expansion overlap — that is the intended
 *   family-except-one pattern) → warning; `enable` wins per precedence.
 * - **`reservedName` named literally in `disable`** → **throws** (deliberate
 *   misconfiguration of the reserved discovery tool). A wildcard that would
 *   match it is silently inert — `reservedName` is never a member of
 *   `toolNames`, so it can never be matched or counted by a wildcard here.
 * - **Unknown literal name** in either list (not `reservedName`, not in
 *   `toolNames`) → warning, never a failure (the env block is shared across
 *   all 5 servers).
 * - **Wildcard matching zero of `toolNames`** → warning.
 *
 * @throws {Error} (naming `reservedName`) when `reservedName` appears literally in `config.disable`.
 */
export function resolveVisibleTools(
  params: ResolveVisibleToolsParams,
): ResolveVisibleToolsResult {
  const { toolNames, config, rosters, reservedName } = params;
  const toolNameSet = new Set(toolNames);
  const warnings: string[] = [];

  // Literal (exact-string) duplicate across DISABLE and ENABLE — warn, ENABLE
  // wins by precedence below. A wildcard in one list matching a literal in
  // the other is DIFFERENT (the intended hole-punch pattern) and is NOT
  // flagged here.
  const enableSet = new Set(config.enable);
  for (const name of config.disable) {
    if (enableSet.has(name)) {
      warnings.push(
        `"${name}" appears in both IRIS_TOOLS_DISABLE and IRIS_TOOLS_ENABLE; IRIS_TOOLS_ENABLE takes precedence.`,
      );
    }
  }

  // Reserved discovery tool: a LITERAL disable is a deliberate
  // misconfiguration (it is the diagnostic surface for this very feature) —
  // fail fast. A wildcard cannot reach this branch (it is never an exact
  // match against `reservedName` as a list ENTRY; wildcard matching against
  // `reservedName` as a CANDIDATE never happens because `reservedName` is
  // never a member of `toolNames`).
  if (config.disable.includes(reservedName)) {
    throw new Error(
      `IRIS_TOOLS_DISABLE is invalid: "${reservedName}" is the reserved server & governance ` +
        `discovery tool and cannot be disabled. Remove it from IRIS_TOOLS_DISABLE.`,
    );
  }

  // Unknown literal names + zero-match wildcards, checked across both lists.
  const checkList = (list: string[], varName: string): void => {
    for (const entry of list) {
      if (entry.endsWith("*")) {
        const matchCount = toolNames.filter((name) =>
          matchesPattern(entry, name),
        ).length;
        if (matchCount === 0) {
          warnings.push(
            `${varName}: wildcard "${entry}" matched zero registered tools on this server.`,
          );
        }
      } else if (entry !== reservedName && !toolNameSet.has(entry)) {
        warnings.push(
          `${varName}: "${entry}" is not a registered tool on this server ` +
            `(this env block is shared across all IRIS MCP servers — it may be valid on another one).`,
        );
      }
    }
  };
  checkList(config.disable, "IRIS_TOOLS_DISABLE");
  checkList(config.enable, "IRIS_TOOLS_ENABLE");

  const enableMatch = (name: string): boolean =>
    config.enable.some((pattern) => matchesPattern(pattern, name));
  const disableMatch = (name: string): boolean =>
    config.disable.some((pattern) => matchesPattern(pattern, name));
  const presetVisible = (name: string): boolean | undefined => {
    if (!rosters || config.preset === "full") return undefined;
    const roster = rosters[config.preset];
    if (roster.include.includes(name)) return true;
    if (roster.exclude.includes(name)) return false;
    return undefined;
  };

  const visible = new Set<string>();
  for (const name of toolNames) {
    const isVisible = enableMatch(name)
      ? true
      : disableMatch(name)
        ? false
        : (presetVisible(name) ?? true);
    if (isVisible) visible.add(name);
  }
  // The reserved discovery tool is ALWAYS visible — it is registered outside
  // `options.tools` and therefore never subject to the resolution above.
  visible.add(reservedName);

  return { visible, warnings };
}

/**
 * Assert that every NAMED preset (`core`, `developer` — NOT `full`, which is
 * reserved and cannot be defined) in `rosters` declares an explicit
 * `include`/`exclude` disposition for EVERY name in `toolNames`, with no
 * overlap (Epic 30, spec 11 §2.4 — sibling of
 * {@link import("./governance.js").assertGovernanceClassification}).
 *
 * A no-op when `rosters` is `undefined` — the state until a package wires its
 * `presets.ts` (Story 30.1); until then every named preset behaves like
 * `full` (all tools visible), so there is no coverage to enforce yet.
 *
 * @param rosters - The package's preset rosters, or `undefined`.
 * @param toolNames - The package's own tool names (typically `options.tools.map(t => t.name)`).
 * @throws {Error} naming every offending tool + preset: missing from both
 *   `include`/`exclude`, present in BOTH, or referencing a name outside
 *   `toolNames`.
 */
export function assertPresetCoverage(
  rosters: ToolPresetRosters | undefined,
  toolNames: string[],
): void {
  if (!rosters) return;

  const toolNameSet = new Set(toolNames);
  const offenders: string[] = [];

  for (const presetName of NAMED_PRESET_NAMES) {
    const roster = rosters[presetName];
    const includeSet = new Set(roster.include);
    const excludeSet = new Set(roster.exclude);

    for (const name of includeSet) {
      if (excludeSet.has(name)) {
        offenders.push(
          `"${name}" appears in BOTH include and exclude for preset "${presetName}"`,
        );
      }
      if (!toolNameSet.has(name)) {
        offenders.push(
          `"${name}" is listed in preset "${presetName}"'s include but is not a registered tool`,
        );
      }
    }
    for (const name of excludeSet) {
      if (!toolNameSet.has(name)) {
        offenders.push(
          `"${name}" is listed in preset "${presetName}"'s exclude but is not a registered tool`,
        );
      }
    }
    for (const name of toolNameSet) {
      if (!includeSet.has(name) && !excludeSet.has(name)) {
        offenders.push(
          `"${name}" has no visibility disposition (missing from both include and exclude) for preset "${presetName}"`,
        );
      }
    }
  }

  if (offenders.length > 0) {
    offenders.sort();
    throw new Error(
      `Tool visibility: ${offenders.length} preset-coverage violation(s): ${offenders.join("; ")}. ` +
        `Every named preset ("core", "developer") must declare an explicit include/exclude ` +
        `disposition for EVERY registered tool, with no overlap between include and exclude.`,
    );
  }
}
