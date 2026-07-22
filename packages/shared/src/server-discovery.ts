/**
 * Server & governance discovery tool (Epic 19, architecture decision E1).
 *
 * A FRAMEWORK-PROVIDED read tool — registered once in {@link McpServerBase}
 * (`server-base.ts`), exactly like the D2 `server`-param injection and the D6
 * governance resource — so it appears uniformly on all five suite servers
 * without any per-package `tools/index.ts` wiring. It reports:
 *
 * - the **profile roster**: per-profile NON-SECRET connection metadata (the
 *   `password` is NEVER included — built via an explicit allow-list, never a
 *   spread-and-delete, so a future {@link IrisProfile} field cannot silently
 *   leak), and
 * - the **effective governance policy** for a selected profile (default
 *   `default`), or for every profile when `allProfiles` is set — computed via
 *   the SAME {@link getEffectivePolicy} the D6 resource consumes, so the tool
 *   and the resource cannot drift.
 *
 * "Call-first" guidance lives in the tool {@link ToolDefinition.description} and
 * is reinforced by the MCP server `instructions` field (set in `server-base.ts`)
 * so a capable client surfaces it at connect time.
 *
 * Classification (architecture decision D4 / Rule #28): `mutates: "read"` is
 * MANDATORY even though it is a read — a new non-baseline key must carry a
 * classification or registration fails. A read resolves to enabled-by-default
 * via the governance seed, so the frozen baseline (`1e62c5ad5bf7`) is untouched.
 *
 * The tool does NOT declare a `server` field: the framework injects an optional
 * `server` into every tool's advertised schema (D2). This tool's OWN
 * `profile`/`allProfiles` args select which profile's *policy* to report — a
 * distinct concern from `server` (which selects the connection profile and is
 * irrelevant here, since discovery never connects). See the description for the
 * distinction.
 */

import { z } from "zod";

import type { GovernanceConfig, GovernancePreset, MutatesLookup, MutationClass } from "./governance.js";
import { getEffectivePolicy } from "./governance.js";
import type { IrisProfile, ProfileRegistry } from "./profiles.js";
import { DEFAULT_PROFILE_NAME, resolveProfile } from "./profiles.js";
import type { ToolDefinition, ToolResult } from "./tool-types.js";
import type { ToolPresetName } from "./tool-visibility.js";

/** The discovery tool's registered name (architecture decision E1). */
export const SERVER_DISCOVERY_TOOL_NAME = "iris_server_profiles";

/**
 * The MCP server `instructions` text (architecture decision E1, AC 19.0.5).
 *
 * Generic across all five servers (no per-server wording) so the shared base can
 * set it once. Surfaced in the `initialize` result; reinforces the call-first
 * guidance also carried in the discovery tool's description.
 */
export const SERVER_DISCOVERY_INSTRUCTIONS =
  `Call the \`${SERVER_DISCOVERY_TOOL_NAME}\` tool FIRST to discover the configured ` +
  `server profiles (non-secret connection metadata) and the effective governance ` +
  `policy (which actions are enabled/disabled) before invoking other tools. This ` +
  `lets you pick the right \`server\` profile for each call and avoid actions that ` +
  `governance has disabled.\n\n` +
  // Production recovery guidance (Epic 20, decision F1 / AC 20.0.1a). Generic
  // across all five servers (like the call-first guidance above); a client that
  // does not expose the interop tools simply ignores it.
  `When a production is troubled or wedged, prefer \`iris_production_control\` ` +
  `action \`recover\` as the FIRST response. Use action \`clean\` only as a LAST ` +
  `RESORT when \`recover\` does not resolve the problem, and reserve its ` +
  `\`killAppData\` option (which wipes persistent business state) for cases where ` +
  `you accept that data loss.`;

/**
 * A single roster entry: a profile's NON-SECRET connection metadata.
 *
 * `password` is intentionally ABSENT. This shape is produced by an explicit
 * allow-list ({@link buildRosterEntry}), so adding a field to {@link IrisProfile}
 * never silently surfaces it (or a secret) in discovery output.
 */
export interface ProfileRosterEntry {
  name: string;
  isDefault: boolean;
  host: string;
  port: number;
  username: string;
  namespace: string;
  https: boolean;
  baseUrl: string;
  timeout: number;
}

/**
 * Structured result returned by the discovery tool.
 *
 * - `profiles` — the roster (one {@link ProfileRosterEntry} per configured profile).
 * - `defaultProfile` — the reserved default profile's name (for client convenience).
 * - `governance` — either a single profile's policy map (when `allProfiles` is
 *   falsy) under `policy`, OR a per-profile map of policy maps under `policies`.
 * - `preset` — the active `IRIS_GOVERNANCE_PRESET` (Story 24.1, AC 24.1.4a):
 *   `"read-only"` or `"full"` when explicitly set, else `null` (unset — the
 *   `governance` policy above already reflects it, since it is computed by the
 *   SAME {@link getEffectivePolicy} the gate/resource use).
 * - `toolVisibility` — the active `IRIS_TOOLS_*` tool-visibility state (Epic
 *   30, architecture decision I1, AC 30.2.1): the resolved preset plus the
 *   visible/hidden tool COUNTS. Present under every configuration, including
 *   the default `full` (where `hiddenTools` is 0). **Deliberately counts
 *   ONLY — hidden tool NAMES are never disclosed here** (spec §2.6: invisible
 *   means invisible to the agent; an operator diagnoses via env vars + README
 *   roster tables, not via this tool). Sourced from the server's own
 *   `this.toolVisibility` state (`server-base.ts`), computed once at
 *   construction.
 */
export interface ServerDiscoveryResult {
  defaultProfile: string;
  profiles: ProfileRosterEntry[];
  governance: {
    /** The profile whose single policy is reported (absent when `allProfiles`). */
    profile?: string;
    /** Single-profile effective policy map (absent when `allProfiles`). */
    policy?: Record<string, boolean>;
    /** Per-profile effective policy maps (present only when `allProfiles`). */
    policies?: Record<string, Record<string, boolean>>;
  };
  preset: GovernancePreset | null;
  /**
   * Active tool-visibility preset + visible/hidden tool COUNTS (Epic 30, AC
   * 30.2.1). NEVER includes hidden tool names — see the interface doc above.
   */
  toolVisibility: {
    /** Active `IRIS_TOOLS_PRESET` (`full` when unset — Rule #19 back-compat). */
    preset: ToolPresetName;
    /** Number of tools advertised on `tools/list`, including the reserved `iris_server_profiles`. */
    visibleTools: number;
    /** Number of tools hidden by the active preset/`IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE` config. */
    hiddenTools: number;
  };
}

/**
 * Build ONE roster entry by explicitly allow-listing the non-secret fields of a
 * profile (AC 19.0.2). The `password` is NEVER read. Do NOT refactor this to a
 * spread (`{ ...profile }`) + delete — the whole point is that a NEW field added
 * to {@link IrisProfile} must require a deliberate edit here to ever appear in
 * discovery output, so a secret can never leak by accident.
 */
export function buildRosterEntry(profile: IrisProfile): ProfileRosterEntry {
  return {
    name: profile.name,
    isDefault: profile.name === DEFAULT_PROFILE_NAME,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    namespace: profile.namespace,
    https: profile.https,
    baseUrl: profile.baseUrl,
    timeout: profile.timeout,
  };
}

/** Build the full roster (one allow-listed entry per registry profile). */
export function buildRoster(profiles: ProfileRegistry): ProfileRosterEntry[] {
  return [...profiles.values()].map(buildRosterEntry);
}

/**
 * Compute the discovery result (roster + effective governance policy) from the
 * server-base internals. Pure given its inputs so it is unit-testable without a
 * running server; the policy is computed via {@link getEffectivePolicy} — the
 * IDENTICAL call the D6 resource uses — so the tool and resource cannot drift.
 *
 * @param args         - Validated tool args (`profile?`, `allProfiles?`).
 * @param profiles     - The server's profile registry.
 * @param config       - Parsed governance config.
 * @param governedKeys - The full governance key universe (baseline ∪ registered).
 * @param mutatesLookup- Key → mutation class for new actions.
 * @param defaultEnabledWrites - Write keys that seed enabled (Epic 20 F2); default empty.
 *   Threaded so discovery reports the SAME effective policy as the gate/resource —
 *   e.g. `iris_production_control:clean` shows enabled (AC 20.0.5 non-drift).
 * @param preset - Active {@link GovernancePreset} (Story 24.1, AC 24.1.4a); default `undefined`.
 *   Threaded into every {@link getEffectivePolicy} call below AND surfaced verbatim
 *   (as `null` when unset) so the reported policy and the `preset` field never drift.
 * @param classifications - Key → mutation class for frozen-baseline actions (Story 24.1); default empty.
 * @param toolVisibility - The server's resolved tool-visibility state (Epic 30, AC
 *   30.2.1) — `{ preset, visibleCount, hiddenCount }`, sourced verbatim from
 *   `McpServerBase`'s `this.toolVisibility`. Defaulted to the byte-for-byte
 *   pass-through state (`full`, 0 hidden) so existing direct callers/tests that
 *   omit it are unaffected; the real server always passes its own state.
 * @returns The {@link ServerDiscoveryResult}.
 * @throws {ProfileResolutionError} When a requested single `profile` is unknown.
 */
export function computeServerDiscovery(
  args: { profile?: string; allProfiles?: boolean },
  profiles: ProfileRegistry,
  config: GovernanceConfig,
  governedKeys: Iterable<string>,
  mutatesLookup: MutatesLookup,
  defaultEnabledWrites: ReadonlySet<string> = new Set(),
  preset?: GovernancePreset,
  classifications: Readonly<Record<string, MutationClass>> = {},
  toolVisibility: {
    preset: ToolPresetName;
    visibleCount: number;
    hiddenCount: number;
  } = { preset: "full", visibleCount: 0, hiddenCount: 0 },
): ServerDiscoveryResult {
  const roster = buildRoster(profiles);

  let governance: ServerDiscoveryResult["governance"];
  if (args.allProfiles) {
    // Validate an explicitly-supplied `profile` even though `allProfiles`
    // supersedes its single-policy output (CR 19.0-1): a client's typo'd
    // `profile` is surfaced as a clean ProfileResolutionError — the SAME error
    // the single-profile branch raises — instead of being silently ignored.
    // An omitted/empty `profile` is not validated (it carries no intent here).
    if (args.profile !== undefined && args.profile !== "") {
      resolveProfile(profiles, args.profile);
    }
    const policies: Record<string, Record<string, boolean>> = {};
    for (const name of profiles.keys()) {
      // Use defineProperty so a profile name that collides with a prototype
      // member (e.g. "__proto__", "constructor") is written as a real own
      // enumerable property rather than silently no-op'ing the assignment —
      // mirroring getEffectivePolicy's own collision-safe map construction, so
      // every configured profile appears in the output (no silent loss / no
      // prototype mutation). buildProfileRegistry admits any non-empty name.
      Object.defineProperty(policies, name, {
        value: getEffectivePolicy(
          name,
          config,
          governedKeys,
          mutatesLookup,
          undefined,
          defaultEnabledWrites,
          preset,
          classifications,
        ),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    governance = { policies };
  } else {
    // Resolve the single profile name (defaults to `default`). An unknown name
    // throws ProfileResolutionError — the caller maps it to a structured error.
    const profile = resolveProfile(profiles, args.profile);
    governance = {
      profile: profile.name,
      policy: getEffectivePolicy(
        profile.name,
        config,
        governedKeys,
        mutatesLookup,
        undefined,
        defaultEnabledWrites,
        preset,
        classifications,
      ),
    };
  }

  return {
    defaultProfile: DEFAULT_PROFILE_NAME,
    profiles: roster,
    preset: preset ?? null,
    governance,
    toolVisibility: {
      preset: toolVisibility.preset,
      visibleTools: toolVisibility.visibleCount,
      hiddenTools: toolVisibility.hiddenCount,
    },
  };
}

/** Input schema for the discovery tool (no `server` field — injected by D2). */
export const serverDiscoveryInputSchema = z.object({
  profile: z
    .string()
    .optional()
    .describe(
      "Which profile's governance policy to report (a name from the roster). " +
        "Omit to use the default profile. Distinct from the framework `server` " +
        "parameter, which selects the connection profile (irrelevant here — this " +
        "tool reports in-memory config and does not connect to IRIS).",
    ),
  allProfiles: z
    .boolean()
    .optional()
    .describe(
      "When true, return the effective governance policy for EVERY configured " +
        "profile (as `governance.policies`) instead of a single profile's policy. " +
        "A supplied `profile` is still validated (an unknown name errors) but its " +
        "single-policy output is superseded by the per-profile map.",
    ),
});

/**
 * The discovery tool's {@link ToolDefinition}.
 *
 * Its `handler` is a guard: the discovery call is SPECIAL-CASED in
 * {@link McpServerBase.handleToolCall} (which has the profile/governance
 * internals and skips the IRIS connection), so the normal handler path never
 * runs for this tool. The handler throws if ever reached, surfacing the
 * mis-wiring rather than returning silently-wrong (connection-dependent) output.
 */
export const serverDiscoveryTool: ToolDefinition = {
  name: SERVER_DISCOVERY_TOOL_NAME,
  title: "Server Profiles & Governance",
  description:
    "CALL THIS FIRST. Discover the IRIS server profiles this MCP server can " +
    "target and the effective governance policy (which tool actions are " +
    "enabled/disabled) — so you can choose the right `server` profile and avoid " +
    "calling disabled actions, without reading the client's config files. " +
    "Returns: (1) a profile roster with non-secret connection metadata " +
    "(name, host, port, username, namespace, https, baseUrl, timeout; the " +
    "password is NEVER included); and (2) the effective enabled/disabled action " +
    "map for a selected profile (optional `profile` arg; defaults to the " +
    "`default` profile), or for every profile when `allProfiles: true`. " +
    "Note: the optional `profile` arg selects which profile's POLICY to report; " +
    "the framework `server` arg (which selects the connection target) is " +
    "irrelevant to this tool, since it reports in-memory config and does not " +
    "connect to IRIS. This is a read-only tool, enabled by default.",
  inputSchema: serverDiscoveryInputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  mutates: "read",
  handler: async (): Promise<ToolResult> => {
    // Never reached: handleToolCall special-cases this tool before the handler
    // path (it needs server-base internals + must not establish a connection).
    throw new Error(
      `${SERVER_DISCOVERY_TOOL_NAME} must be handled by the server base, not its handler.`,
    );
  },
};
