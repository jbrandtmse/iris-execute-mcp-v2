/**
 * The automatic-install setting (Story 45.2; architecture decisions AD-9, AD-8 and AD-14).
 *
 * Whether a server installs, upgrades or repairs the IRIS side (the `ExecuteMCPv2` classes, the web
 * application, the `%ALL` mapping, `^UnitTestRoot`) when it connects is a per-profile setting.
 *
 * **Precedence.** For a profile P, the first value found wins:
 *  1. the `IRIS_PROFILES` entry of P, field `autoInstall` (a JSON boolean);
 *  2. the operator variable `IRIS_AUTO_INSTALL` (`true` or `false`, in any letter case);
 *  3. `IRIS_GOVERNANCE_PRESET=read-only`, which forces it off;
 *  4. on.
 *
 * A value on the `default` entry applies to `default` only and is never inherited. Server Manager
 * profiles never carry the field, so they take the variable. The governance file is not a channel.
 *
 * An explicit "on" (`IRIS_AUTO_INSTALL=true`, or any profile's `autoInstall: true`) together with the
 * read-only preset fails startup naming both settings: the server never picks one silently.
 *
 * This module has no runtime dependency on the rest of the package (type-only imports), so the
 * configuration modules can import it without a cycle.
 */

import type { GovernancePreset } from "./governance.js";

/** The operator variable that sets the automatic install for every profile that no `IRIS_PROFILES` entry sets. */
export const AUTO_INSTALL_ENV_VAR = "IRIS_AUTO_INSTALL";

/** The channel that supplied a profile's automatic-install value. */
export type AutoInstallSource = "IRIS_PROFILES" | "IRIS_AUTO_INSTALL" | "IRIS_GOVERNANCE_PRESET" | "default";

/**
 * Read the operator variable `IRIS_AUTO_INSTALL`.
 *
 * @param env - Environment map (defaults to `process.env`).
 * @returns `true` or `false`, or `undefined` when the variable is unset or empty.
 * @throws {Error} (naming `IRIS_AUTO_INSTALL`) when it is set to anything but `true` or `false`, in any letter case.
 */
export function parseOperatorAutoInstall(
  env: Record<string, string | undefined> = process.env,
): boolean | undefined {
  const raw = env.IRIS_AUTO_INSTALL;
  if (raw === undefined || raw === "") return undefined;
  const lowered = raw.toLowerCase();
  if (lowered !== "true" && lowered !== "false") {
    throw new Error(`${AUTO_INSTALL_ENV_VAR} must be "true" or "false". Received: "${raw}".`);
  }
  return lowered === "true";
}

/** The part of a profile the resolution reads and writes. */
export interface AutoInstallCarrier {
  /** The profile's registered name. */
  name: string;
  /** The resolved value, or, before resolution, the `IRIS_PROFILES` entry's value. */
  autoInstall?: boolean;
  /** The channel that supplied {@link autoInstall}. */
  autoInstallSource?: AutoInstallSource;
}

/** Whether `IRIS_PROFILES` set the value on this profile itself. */
function ownValue(profile: AutoInstallCarrier): boolean | undefined {
  return profile.autoInstallSource === "IRIS_PROFILES" ? profile.autoInstall : undefined;
}

/**
 * Resolve the automatic install of one profile (see the module comment for the order). Only a value
 * that `IRIS_PROFILES` set on the profile itself counts as the profile's own: a value an earlier
 * resolution wrote from another channel is recomputed, so the function is idempotent.
 *
 * @param profile - The profile.
 * @param operator - The `IRIS_AUTO_INSTALL` value, when set.
 * @param preset - The governance preset, when set.
 */
export function resolveAutoInstall(
  profile: AutoInstallCarrier,
  operator: boolean | undefined,
  preset: GovernancePreset | undefined,
): { autoInstall: boolean; source: AutoInstallSource } {
  const own = ownValue(profile);
  if (own !== undefined) return { autoInstall: own, source: "IRIS_PROFILES" };
  if (operator !== undefined) return { autoInstall: operator, source: "IRIS_AUTO_INSTALL" };
  if (preset === "read-only") return { autoInstall: false, source: "IRIS_GOVERNANCE_PRESET" };
  return { autoInstall: true, source: "default" };
}

/**
 * Resolve the automatic install of every profile in `registry` and replace each entry with
 * `{...profile, autoInstall, autoInstallSource}`. The registry is changed in place.
 *
 * @throws {Error} When the read-only preset is set together with an explicit "on": `IRIS_AUTO_INSTALL=true`
 *   (naming that variable and the preset), or a profile's `autoInstall: true` (naming `IRIS_PROFILES`, the
 *   profile and the preset). Nothing is changed in that case.
 */
export function applyAutoInstall<P extends AutoInstallCarrier>(
  registry: Map<string, P>,
  operator: boolean | undefined,
  preset: GovernancePreset | undefined,
): void {
  if (preset === "read-only") {
    if (operator === true) {
      throw new Error(
        `${AUTO_INSTALL_ENV_VAR}=true conflicts with IRIS_GOVERNANCE_PRESET=read-only: the read-only preset turns the ` +
          "automatic install off, and this server does not pick one of the two settings silently. " +
          `Unset ${AUTO_INSTALL_ENV_VAR} (or set it to false) to keep the read-only preset, or remove the read-only preset to install automatically.`,
      );
    }
    for (const profile of registry.values()) {
      if (ownValue(profile) === true) {
        throw new Error(
          `IRIS_PROFILES profile "${profile.name}": "autoInstall": true conflicts with IRIS_GOVERNANCE_PRESET=read-only: ` +
            "the read-only preset turns the automatic install off, and this server does not pick one of the two settings silently. " +
            `Remove "autoInstall" from the profile (or set it to false) to keep the read-only preset, or remove the read-only preset to install automatically.`,
        );
      }
    }
  }
  for (const [name, profile] of [...registry.entries()]) {
    const { autoInstall, source } = resolveAutoInstall(profile, operator, preset);
    registry.set(name, { ...profile, autoInstall, autoInstallSource: source });
  }
}
