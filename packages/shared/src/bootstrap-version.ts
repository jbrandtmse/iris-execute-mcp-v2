/**
 * Ordering of the bootstrap version marker.
 *
 * The marker stamped into `ExecuteMCPv2.Setup` is `<semver>+<sequence>.<hash>`:
 * the version of `@iris-mcp/shared`, a sequence that `scripts/bootstrap-sequence.json`
 * raises by one whenever the content hash changes, and a 12-character content hash.
 * A build that predates the sequence stamped the bare 12-character hash (a "legacy"
 * marker).
 *
 * One comparator serves the bootstrap probe, the re-check before compile and the
 * live gates: `classifyDeployedMarker(deployed, embedded)` says how the deployment
 * on an instance relates to the build that is about to deploy.
 */

/** A marker in the current grammar: `<major>.<minor>.<patch>+<sequence>.<hash>`. */
export interface StampedBootstrapMarker {
  kind: "stamped";
  /** The semver of `@iris-mcp/shared`, as `[major, minor, patch]`. */
  semver: readonly [bigint, bigint, bigint];
  /** The generator's sequence number. */
  sequence: bigint;
  /** The 12-character lowercase hex content hash. */
  hash: string;
}

/** A pre-sequence marker: the bare 12-character lowercase hex hash. */
export interface LegacyBootstrapMarker {
  kind: "legacy";
  hash: string;
}

/** Anything else: the `dev` placeholder of the source `Setup.cls`, an empty or malformed value. */
export interface UnparseableBootstrapMarker {
  kind: "unparseable";
  raw: string;
}

export type ParsedBootstrapMarker =
  | StampedBootstrapMarker
  | LegacyBootstrapMarker
  | UnparseableBootstrapMarker;

/** How a deployed marker relates to the embedded one. */
export type DeployedMarkerClassification = "current" | "older" | "newer" | "foreign";

const STAMPED_PATTERN = /^(\d+)\.(\d+)\.(\d+)\+(\d+)\.([0-9a-f]{12})$/;
const LEGACY_PATTERN = /^[0-9a-f]{12}$/;

/**
 * Parse a marker. The numbers are read as unbounded integers, so a value past
 * `Number.MAX_SAFE_INTEGER` still orders correctly.
 */
export function parseBootstrapMarker(marker: string): ParsedBootstrapMarker {
  const stamped = STAMPED_PATTERN.exec(marker);
  if (stamped) {
    return {
      kind: "stamped",
      semver: [BigInt(stamped[1] as string), BigInt(stamped[2] as string), BigInt(stamped[3] as string)],
      sequence: BigInt(stamped[4] as string),
      hash: stamped[5] as string,
    };
  }
  if (LEGACY_PATTERN.test(marker)) return { kind: "legacy", hash: marker };
  return { kind: "unparseable", raw: marker };
}

function compareBigint(left: bigint, right: bigint): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * Classify the deployed marker against the embedded one.
 *
 * - `current`: the same marker (leading zeros carry no meaning).
 * - `older`: a legacy marker, a lower semver, or the same semver with a lower sequence.
 *   The embedded build may redeploy over it.
 * - `newer`: a higher semver, or the same semver with a higher sequence. Never redeployed.
 * - `foreign`: the same semver and sequence with a different hash, the `dev`
 *   placeholder, or any value that parses as neither grammar. Never redeployed.
 *
 * An embedded marker that is not in the current grammar cannot order anything: the
 * deployed value is `current` when it is identical and `foreign` otherwise.
 */
export function classifyDeployedMarker(deployed: string, embedded: string): DeployedMarkerClassification {
  if (deployed === embedded) return "current";
  const embeddedMarker = parseBootstrapMarker(embedded);
  if (embeddedMarker.kind !== "stamped") return "foreign";
  const deployedMarker = parseBootstrapMarker(deployed);
  if (deployedMarker.kind === "legacy") return "older";
  if (deployedMarker.kind !== "stamped") return "foreign";

  for (let part = 0; part < 3; part += 1) {
    const order = compareBigint(deployedMarker.semver[part] as bigint, embeddedMarker.semver[part] as bigint);
    if (order !== 0) return order < 0 ? "older" : "newer";
  }
  const bySequence = compareBigint(deployedMarker.sequence, embeddedMarker.sequence);
  if (bySequence !== 0) return bySequence < 0 ? "older" : "newer";
  return deployedMarker.hash === embeddedMarker.hash ? "current" : "foreign";
}
