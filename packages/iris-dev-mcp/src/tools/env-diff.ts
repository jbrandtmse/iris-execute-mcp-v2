/**
 * Cross-profile environment drift detector for the IRIS Development MCP server
 * (Epic 27, Stories 27.0-27.1, incl. the Story 27.1 cycle-2 lead-smoke rework).
 *
 * Provides {@link envDiffTool} — `iris_env_diff` — which compares two configured
 * IRIS server profiles (`source` / `target`, e.g. `stage` vs `prod`) and reports
 * a structured drift report, so an operator can see "what's different between
 * stage and prod?" in one call instead of a manual export/diff dance.
 *
 * Both profiles' `IrisHttpClient`s are resolved via the framework primitive
 * `ctx.resolveProfileClient` (Story 27.0, `@iris-mcp/shared`). All FIVE domains
 * are implemented (Story 27.1 completed the set started in 27.0), each against
 * the EXISTING custom-REST endpoint its dedicated tool already calls (this tool
 * calls the routes directly via the two profile clients, not those tools):
 *
 * - **documents** — `POST /dev/doc/hashes` (new in Story 27.0): ObjectScript
 *   source compared by SHA-256 content hash (cross-IRIS-version safe). OPT-IN
 *   ONLY (cycle-2 rework): NOT in the default `domains` set because it REQUIRES
 *   a `spec` — a bare `iris_env_diff(source, target)` call must not fail just
 *   because `documents` was silently defaulted-in without one.
 * - **mappings** — `GET /config/mapping/{global,routine,package}`: global/
 *   routine/package namespace mappings, keyed by `(type, name)` (cycle-2 HIGH
 *   fix, 2026-07-11: `namespace` is the per-SIDE config namespace being
 *   compared, not part of the item's identity — see {@link mappingKey}).
 *   Subscript-level mappings are embedded in `name` (e.g. `%SYS("HealthShare")`)
 *   — the server's `subscript` response field is dead and is never read here.
 * - **defaultSettings** — `GET /interop/defaultsettings`: Interoperability
 *   System Default Settings (`Ens.Config.DefaultSettings`), keyed by the
 *   `production||item||hostClass||setting` 4-tuple (Rule #29 delimiter). Rows
 *   whose SETTING NAME looks credential-ish (case-insensitive substring —
 *   {@link isCredentialSetting}; broadened in the cycle-2 rework beyond
 *   `password`/`secret`/`key` to also catch `token`/`pwd`/`passphrase`/
 *   `credential`/`cert`/`private`/`salt`, fail-safe/over-redact) are REDACTED
 *   in every bucket: the plaintext value never appears in this tool's output.
 * - **webapps** — `GET /security/webapp`: a curated property subset of
 *   `Security.Applications` (instance-wide; `cookiePath` is excluded by
 *   default as the closest thing to an instance-specific path on this
 *   endpoint; the per-app `resource` property is not compared — it is omitted
 *   from the list endpoint this tool calls, an N+1 fetch is out of scope).
 * - **config** — `POST /system/config` (`action:"get", section:"config"`):
 *   the ~11 supported CPF `config`-section properties (instance-wide).
 *
 * **Default `domains` (cycle-2 rework, Lead-approved deviation from spec §3's
 * literal "default all 5"):** `mappings`, `defaultSettings`, `webapps`,
 * `config` — the four domains that need no `spec`. `documents` is fetched only
 * when explicitly listed in `domains`.
 *
 * `documents`, `mappings`, and `defaultSettings` resolve EACH SIDE'S OWN
 * namespace (an explicit `namespace` input overrides both sides identically;
 * omitted, each side falls back to its own profile's configured default).
 * `webapps` and `config` are instance-wide and never take a namespace.
 *
 * **Per-domain error isolation (cycle-2 rework, mirrors `Health.cls`'s
 * per-area isolation — Epic 23 / Rule #41):** each requested domain's
 * fetch+diff runs in its OWN try/catch. A domain that hard-errors (an
 * `IrisApiError` — e.g. `defaultSettings` against a namespace with no
 * Interoperability schema — or, for `documents`, the missing-`spec` guard)
 * records a sanitized message in `structuredContent.errors[domain]` and the
 * diff CONTINUES with the other domains; `summary` rolls up only the
 * SUCCEEDED domains. The overall result is `isError:true` ONLY when EVERY
 * requested domain errors; a partial failure returns `isError:false` with the
 * successful domains' diffs intact and the failures named in `errors`.
 *
 * **`onlyInTarget` is informational (a warning) — NEVER a deletion signal.**
 * This invariant is established in Story 27.0 and holds for every domain; it
 * becomes load-bearing once `iris_env_promote:plan` (Story 27.2) turns a diff
 * into an execution plan.
 *
 * Read-only (`mutates: "read"` — Rule #28, mandatory even for a read),
 * `scope: "NONE"` (profiles are explicit `source`/`target` params, not the
 * framework `server` param).
 */

import {
  IrisApiError,
  ProfileResolutionError,
  type ToolDefinition,
  type IrisHttpClient,
} from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

/** Full domain enum — all five are implemented as of Story 27.1. */
const DIFF_DOMAINS = [
  "documents",
  "mappings",
  "defaultSettings",
  "webapps",
  "config",
] as const;
type DiffDomain = (typeof DIFF_DOMAINS)[number];

/**
 * Default `domains` set when the caller omits `domains` entirely (cycle-2
 * rework). `documents` is EXCLUDED — it requires a `spec`, so defaulting it in
 * would make a bare `iris_env_diff(source, target)` call fail. The four
 * remaining domains need no extra input and are safe to run unconditionally.
 */
const DEFAULT_DIFF_DOMAINS: readonly DiffDomain[] = [
  "mappings",
  "defaultSettings",
  "webapps",
  "config",
];

// ── /dev/doc/hashes response shape (ExecuteMCPv2.REST.EnvSync) ─────

/**
 * One `/dev/doc/hashes` row. Exported (Story 27.3, Rule #47) so `execute`
 * can reuse {@link fetchDocHashes}'s exact source-read logic rather than
 * duplicating it; `execute` itself re-fetches document CONTENT via the
 * Atelier `doc/{name}` route (this endpoint returns hashes, not content).
 */
export interface DocHashEntry {
  name: string;
  hash: string;
  timestamp: string;
}

interface DocHashesResult {
  documents: DocHashEntry[];
  count: number;
}

// ── /config/mapping/{type} response shape (ExecuteMCPv2.REST.Config) ──

/**
 * One global/routine/package mapping row. The server's `subscript` field is
 * intentionally OMITTED from this interface: it is DEAD (never populated —
 * `Config.MapGlobals` has no `Subscript` property; a subscript-level mapping
 * is embedded in `name` instead, e.g. `%SYS("HealthShare")`). Never read it.
 *
 * Exported (Story 27.3, Rule #47) so `execute` can re-fetch the authoritative
 * source-side mapping value via {@link fetchMappings} rather than duplicating
 * the fetch/shape logic.
 */
export interface MappingEntry {
  name: string;
  type: string;
  namespace: string;
  database: string;
  collation?: string;
  lockDatabase?: string;
}

// ── /interop/defaultsettings response shape (ExecuteMCPv2.REST.Interop) ──

/**
 * One System Default Settings row. Exported (Story 27.3, Rule #47) so
 * `execute` can re-fetch the authoritative source-side (UN-redacted) value
 * via {@link fetchDefaultSettings} at execute time.
 */
export interface SdsEntry {
  id: number;
  production: string;
  item: string;
  hostClass: string;
  setting: string;
  value: string;
  description?: string;
  deployable?: boolean;
}

interface SdsListResult {
  settings: SdsEntry[];
  count: number;
}

// ── /security/webapp response shape (ExecuteMCPv2.REST.Security) ──────

/**
 * One web application row. Exported (Story 27.3, Rule #47) so `execute` can
 * re-fetch the authoritative source-side webapp properties via
 * {@link fetchWebapps} at execute time.
 */
export interface WebAppEntry {
  name: string;
  namespace: string;
  dispatchClass: string;
  description: string;
  enabled: boolean;
  authEnabled: number;
  isNameSpaceDefault: boolean;
  cspZenEnabled: boolean;
  recurse: boolean;
  matchRoles: string;
  cookiePath: string;
}

// ── /system/config response shape (ExecuteMCPv2.REST.SystemConfig) ────

/**
 * The ~11 supported CPF `config`-section properties. Exported (Story 27.3,
 * Rule #47) so `execute` can re-fetch the authoritative source-side value
 * via {@link fetchConfig} at execute time.
 */
export interface ConfigProperties {
  Maxprocesses: number;
  globals: number;
  routines: number;
  gmheap: number;
  locksiz: number;
  jrnbufs: number;
  console: string;
  errlog: number;
  wdparm: number;
  ijcnum: number;
  ijcbuff: number;
}

interface ConfigGetResult {
  section: string;
  properties: ConfigProperties;
}

// ── structuredContent shape (spec 05-env-diff-promotion.md §3) ─────

interface ProfileRef {
  profile: string;
  namespace: string;
}

interface DocDiffEntry {
  name: string;
  sourceHash: string;
  targetHash: string;
  sourceTs: string;
  targetTs: string;
}

interface DocumentsDiff {
  onlyInSource: string[];
  onlyInTarget: string[];
  differs: DocDiffEntry[];
  identical: number;
}

interface MappingValue {
  database: string;
  collation?: string;
  lockDatabase?: string;
}

interface MappingDiffEntry {
  type: string;
  namespace: string;
  name: string;
  sourceValue: MappingValue;
  targetValue: MappingValue;
}

interface MappingsDiff {
  onlyInSource: string[];
  onlyInTarget: string[];
  differs: MappingDiffEntry[];
  identical: number;
}

/**
 * One SDS row present on only one side. `value` is the literal string
 * `"[REDACTED]"` for a credential-ish setting name (AC 27.1.2) — see
 * {@link isCredentialSetting}.
 */
interface SdsOnlyEntry {
  production: string;
  item: string;
  hostClass: string;
  setting: string;
  value: string;
}

/**
 * One SDS row whose value differs between source and target. For a
 * credential-ish setting name, `sourceValue`/`targetValue` are OMITTED
 * entirely and `redacted` carries the marker instead — the plaintext never
 * enters this structure (AC 27.1.2).
 */
interface SdsDiffEntry {
  production: string;
  item: string;
  hostClass: string;
  setting: string;
  sourceValue?: string;
  targetValue?: string;
  redacted?: "[REDACTED:differs]";
}

interface DefaultSettingsDiff {
  onlyInSource: SdsOnlyEntry[];
  onlyInTarget: SdsOnlyEntry[];
  differs: SdsDiffEntry[];
  identical: number;
}

/** Curated webapp property subset compared (spec §3 — instance-specific `cookiePath` excluded by default). */
interface WebAppValue {
  dispatchClass: string;
  enabled: boolean;
  authEnabled: number;
  isNameSpaceDefault: boolean;
  cspZenEnabled: boolean;
  recurse: boolean;
  matchRoles: string;
  namespace: string;
}

interface WebAppDiffEntry {
  name: string;
  sourceValue: WebAppValue;
  targetValue: WebAppValue;
}

interface WebappsDiff {
  onlyInSource: string[];
  onlyInTarget: string[];
  differs: WebAppDiffEntry[];
  identical: number;
}

interface ConfigDiffEntry {
  key: string;
  sourceValue: string | number;
  targetValue: string | number;
}

interface ConfigDiff {
  onlyInSource: string[];
  onlyInTarget: string[];
  differs: ConfigDiffEntry[];
  identical: number;
}

interface EnvDiffResult {
  source: ProfileRef;
  target: ProfileRef;
  domains: {
    documents?: DocumentsDiff;
    mappings?: MappingsDiff;
    defaultSettings?: DefaultSettingsDiff;
    webapps?: WebappsDiff;
    config?: ConfigDiff;
  };
  /**
   * Cycle-2 rework (per-domain error isolation): present only when at least
   * one REQUESTED domain hard-errored. Keyed by domain name, value is a
   * sanitized message. A domain present here is ABSENT from `domains` above
   * (its diff was never computed) and is excluded from `summary`.
   */
  errors?: Partial<Record<DiffDomain, string>>;
  summary: {
    driftCount: number;
    identicalCount: number;
  };
}

// ── helpers: documents (Story 27.0) ─────────────────────────────────

/**
 * Fetch `{name -> {hash, timestamp}}` from one profile's /dev/doc/hashes endpoint.
 *
 * Exported (Story 27.3, Task 2 / Rule #47) so a future consumer can reuse this
 * EXACT source-read logic rather than duplicating it; `iris_env_promote:execute`
 * (Story 27.3) re-fetches document CONTENT via the Atelier `doc/{name}` route
 * instead (this endpoint returns hashes, not content), so it does not import
 * this specific helper, but the fetcher is exported uniformly with its siblings.
 */
export async function fetchDocHashes(
  client: IrisHttpClient,
  spec: string,
  namespace: string,
  allowWide: boolean | undefined,
): Promise<Map<string, { hash: string; timestamp: string }>> {
  const body: Record<string, unknown> = { spec, namespace };
  if (allowWide !== undefined) body.allowWide = allowWide;

  const response = await client.post<DocHashesResult>(`${BASE_URL}/dev/doc/hashes`, body);
  const result = response.result;
  const map = new Map<string, { hash: string; timestamp: string }>();
  for (const entry of result.documents ?? []) {
    map.set(entry.name, { hash: entry.hash, timestamp: entry.timestamp });
  }
  return map;
}

/**
 * Bucket two name->{hash,timestamp} maps into the spec §3 documents-diff shape.
 *
 * `ignoreTimestamps` (default true): a hash match is "identical" REGARDLESS of
 * a timestamp difference (a recompile without a content change must not read
 * as drift). When explicitly `false`, a hash match with a timestamp mismatch
 * is ALSO bucketed into `differs` (distinguishable from a content difference
 * by comparing `sourceHash`/`targetHash`, which are equal in that case).
 */
function diffDocuments(
  sourceMap: Map<string, { hash: string; timestamp: string }>,
  targetMap: Map<string, { hash: string; timestamp: string }>,
  ignoreTimestamps: boolean,
): DocumentsDiff {
  const onlyInSource: string[] = [];
  const onlyInTarget: string[] = [];
  const differs: DocDiffEntry[] = [];
  let identical = 0;

  for (const [name, sourceEntry] of sourceMap) {
    const targetEntry = targetMap.get(name);
    if (!targetEntry) {
      onlyInSource.push(name);
      continue;
    }
    const hashMatches = sourceEntry.hash === targetEntry.hash;
    const isIdentical = ignoreTimestamps
      ? hashMatches
      : hashMatches && sourceEntry.timestamp === targetEntry.timestamp;
    if (isIdentical) {
      identical += 1;
    } else {
      differs.push({
        name,
        sourceHash: sourceEntry.hash,
        targetHash: targetEntry.hash,
        sourceTs: sourceEntry.timestamp,
        targetTs: targetEntry.timestamp,
      });
    }
  }

  for (const name of targetMap.keys()) {
    if (!sourceMap.has(name)) onlyInTarget.push(name);
  }

  onlyInSource.sort();
  onlyInTarget.sort();
  differs.sort((a, b) => a.name.localeCompare(b.name));

  return { onlyInSource, onlyInTarget, differs, identical };
}

// ── helpers: generic keyed-map diff core (Story 27.1 domains) ───────

/**
 * Generic core for a "compare two `key -> entry` maps" diff: partitions keys
 * into only-in-source / only-in-target / differs / identical, given a
 * projection from entry to a comparable value. Each domain (mappings,
 * webapps, config, defaultSettings) formats its OWN `differs`/`onlyIn*` array
 * shape from this result — see {@link diffMappings}, {@link diffWebapps},
 * {@link diffConfig}, {@link diffDefaultSettings}. (`documents` predates this
 * helper and keeps its own hand-written {@link diffDocuments} — untouched.)
 */
function computeKeyedDiff<TEntry, TValue>(
  sourceMap: Map<string, TEntry>,
  targetMap: Map<string, TEntry>,
  toValue: (entry: TEntry) => TValue,
  valuesEqual: (a: TValue, b: TValue) => boolean,
): {
  onlyInSourceKeys: string[];
  onlyInTargetKeys: string[];
  differsKeys: string[];
  identical: number;
  sourceValues: Map<string, TValue>;
  targetValues: Map<string, TValue>;
} {
  const onlyInSourceKeys: string[] = [];
  const onlyInTargetKeys: string[] = [];
  const differsKeys: string[] = [];
  const sourceValues = new Map<string, TValue>();
  const targetValues = new Map<string, TValue>();
  let identical = 0;

  for (const [key, sourceEntry] of sourceMap) {
    // Key-EXISTENCE check (not a truthiness check on the entry): the `config`
    // domain stores the scalar value AS the map entry, so a legitimately
    // present property whose value is falsy (`0` or `""` -- e.g. `ijcnum:0`,
    // `console:""`, both common on real instances) must NOT be misread as
    // "only in source". `.has(key)` distinguishes absent from present-but-falsy.
    if (!targetMap.has(key)) {
      onlyInSourceKeys.push(key);
      continue;
    }
    const targetEntry = targetMap.get(key) as TEntry;
    const sourceValue = toValue(sourceEntry);
    const targetValue = toValue(targetEntry);
    if (valuesEqual(sourceValue, targetValue)) {
      identical += 1;
    } else {
      differsKeys.push(key);
      sourceValues.set(key, sourceValue);
      targetValues.set(key, targetValue);
    }
  }

  for (const key of targetMap.keys()) {
    if (!sourceMap.has(key)) onlyInTargetKeys.push(key);
  }

  onlyInSourceKeys.sort();
  onlyInTargetKeys.sort();
  differsKeys.sort();

  return {
    onlyInSourceKeys,
    onlyInTargetKeys,
    differsKeys,
    identical,
    sourceValues,
    targetValues,
  };
}

/** Roll a domain's bucket counts into the top-level `summary` (AC 27.1.3). */
function accumulateDrift(
  summary: EnvDiffResult["summary"],
  diff: { onlyInSource: unknown[]; onlyInTarget: unknown[]; differs: unknown[]; identical: number },
): void {
  summary.driftCount += diff.onlyInSource.length + diff.onlyInTarget.length + diff.differs.length;
  summary.identicalCount += diff.identical;
}

// ── helpers: mappings ────────────────────────────────────────────────

const MAPPING_TYPES = ["global", "routine", "package"] as const;

/**
 * Stable per-item key: `(type, name)` — deliberately EXCLUDES `namespace`
 * (cycle-2 HIGH fix, lead capstone finding 2026-07-11). `namespace` is the
 * per-SIDE config namespace (source resolves its own, target resolves its
 * own — they are frequently DIFFERENT, e.g. HSCUSTOM vs SADEMO), not part of
 * the mapping's identity. Keying on it made the same logical mapping produce
 * a DIFFERENT key on each side, so genuinely identical mappings could never
 * match and were spuriously reported as `onlyInSource` + `onlyInTarget` drift
 * that `promote` could never clean up. `name` already embeds any
 * subscript-level mapping (e.g. `%SYS("HealthShare")`), and `(type, name)` is
 * unique WITHIN one namespace's mapping list — no collision risk.
 */
function mappingKey(entry: Pick<MappingEntry, "type" | "name">): string {
  return `${entry.type}::${entry.name}`;
}

function mappingValue(entry: MappingEntry): MappingValue {
  const value: MappingValue = { database: entry.database };
  if (entry.collation !== undefined) value.collation = entry.collation;
  if (entry.lockDatabase !== undefined) value.lockDatabase = entry.lockDatabase;
  return value;
}

function mappingValuesEqual(a: MappingValue, b: MappingValue): boolean {
  return (
    a.database === b.database &&
    (a.collation ?? "") === (b.collation ?? "") &&
    (a.lockDatabase ?? "") === (b.lockDatabase ?? "")
  );
}

/**
 * Fetch ALL global/routine/package mappings for one profile's namespace, merged
 * into one map. Exported (Story 27.3, Task 2 / Rule #47) so `execute` reuses this
 * EXACT source-read logic to re-fetch the authoritative source-side mapping
 * value at execute time, rather than duplicating it.
 */
export async function fetchMappings(
  client: IrisHttpClient,
  namespace: string,
): Promise<Map<string, MappingEntry>> {
  const responses = await Promise.all(
    MAPPING_TYPES.map((type) =>
      client.get<MappingEntry[]>(
        `${BASE_URL}/config/mapping/${type}?namespace=${encodeURIComponent(namespace)}`,
      ),
    ),
  );
  const map = new Map<string, MappingEntry>();
  for (const response of responses) {
    for (const entry of response.result ?? []) {
      map.set(mappingKey(entry), entry);
    }
  }
  return map;
}

function diffMappings(
  sourceMap: Map<string, MappingEntry>,
  targetMap: Map<string, MappingEntry>,
): MappingsDiff {
  const generic = computeKeyedDiff(sourceMap, targetMap, mappingValue, mappingValuesEqual);
  const differs = generic.differsKeys.map((key): MappingDiffEntry => {
    const entry = sourceMap.get(key) as MappingEntry;
    return {
      type: entry.type,
      namespace: entry.namespace,
      name: entry.name,
      sourceValue: generic.sourceValues.get(key) as MappingValue,
      targetValue: generic.targetValues.get(key) as MappingValue,
    };
  });
  return {
    onlyInSource: generic.onlyInSourceKeys,
    onlyInTarget: generic.onlyInTargetKeys,
    differs,
    identical: generic.identical,
  };
}

// ── helpers: defaultSettings (SDS) + credential redaction ───────────

/**
 * Whether a System Default Settings SETTING NAME looks credential-ish
 * (case-insensitive substring match on `password`, `secret`, `key`, `token`,
 * `pwd`, `passphrase`, `credential`, `cert`, `private`, or `salt`).
 *
 * Broadened in the Story 27.1 cycle-2 lead-smoke rework (elevates CR 27.1-2)
 * from the original 3-term list (`password`/`secret`/`key`) — the real
 * Interoperability credential surface includes names like `AccessToken`,
 * `Pwd`, `Passphrase`, `ClientCredential`, `PrivateKey`, and `Salt` that none
 * of the original 3 terms caught. Fail-safe direction: broadening only ever
 * REDACTS MORE, never less — no existing redaction narrows.
 *
 * Matched on the NAME, never the value (AC 27.1.2) — a credential-LOOKING
 * value under a non-matching name is intentionally left visible (the
 * name-not-value contract). Used by every bucket of {@link diffDefaultSettings}
 * so a matching row's VALUE never appears in this tool's output — see
 * {@link SdsOnlyEntry}, {@link SdsDiffEntry}.
 */
export function isCredentialSetting(settingName: string): boolean {
  return /password|secret|key|token|pwd|passphrase|credential|cert|private|salt/i.test(
    settingName,
  );
}

/** Stable per-item key: the server's own `production||item||hostClass||setting` join (Rule #29). */
function sdsKey(entry: Pick<SdsEntry, "production" | "item" | "hostClass" | "setting">): string {
  return `${entry.production}||${entry.item}||${entry.hostClass}||${entry.setting}`;
}

function sdsOnlyEntry(entry: SdsEntry): SdsOnlyEntry {
  const credential = isCredentialSetting(entry.setting);
  return {
    production: entry.production,
    item: entry.item,
    hostClass: entry.hostClass,
    setting: entry.setting,
    value: credential ? "[REDACTED]" : entry.value,
  };
}

/**
 * Fetch ALL System Default Settings rows for one profile's namespace. Exported
 * (Story 27.3, Task 2 / Rule #47) so `execute` reuses this EXACT source-read
 * logic to re-fetch the authoritative, UN-redacted source-side value at
 * execute time (this raw fetch never applies {@link isCredentialSetting}
 * redaction — that happens only in `iris_env_diff`'s own diff/render layer).
 */
export async function fetchDefaultSettings(
  client: IrisHttpClient,
  namespace: string,
): Promise<Map<string, SdsEntry>> {
  const response = await client.get<SdsListResult>(
    `${BASE_URL}/interop/defaultsettings?namespace=${encodeURIComponent(namespace)}`,
  );
  const map = new Map<string, SdsEntry>();
  for (const entry of response.result.settings ?? []) {
    map.set(sdsKey(entry), entry);
  }
  return map;
}

/**
 * Bucket two SDS maps, applying credential redaction (AC 27.1.2) in every
 * bucket a value could otherwise appear in. `identical` is a bare count (like
 * every other domain) so it never carries a value to redact.
 */
function diffDefaultSettings(
  sourceMap: Map<string, SdsEntry>,
  targetMap: Map<string, SdsEntry>,
): DefaultSettingsDiff {
  const generic = computeKeyedDiff(
    sourceMap,
    targetMap,
    (entry) => entry.value,
    (a, b) => a === b,
  );

  const onlyInSource = generic.onlyInSourceKeys.map((key) =>
    sdsOnlyEntry(sourceMap.get(key) as SdsEntry),
  );
  const onlyInTarget = generic.onlyInTargetKeys.map((key) =>
    sdsOnlyEntry(targetMap.get(key) as SdsEntry),
  );
  const differs = generic.differsKeys.map((key): SdsDiffEntry => {
    const entry = sourceMap.get(key) as SdsEntry;
    const { production, item, hostClass, setting } = entry;
    if (isCredentialSetting(setting)) {
      // Do NOT emit sourceValue/targetValue -- the plaintext must never leave
      // the server in diff output (AC 27.1.2).
      return { production, item, hostClass, setting, redacted: "[REDACTED:differs]" };
    }
    return {
      production,
      item,
      hostClass,
      setting,
      sourceValue: generic.sourceValues.get(key) as string,
      targetValue: generic.targetValues.get(key) as string,
    };
  });

  return { onlyInSource, onlyInTarget, differs, identical: generic.identical };
}

// ── helpers: webapps ──────────────────────────────────────────────────

function webappValue(entry: WebAppEntry): WebAppValue {
  return {
    dispatchClass: entry.dispatchClass,
    enabled: entry.enabled,
    authEnabled: entry.authEnabled,
    isNameSpaceDefault: entry.isNameSpaceDefault,
    cspZenEnabled: entry.cspZenEnabled,
    recurse: entry.recurse,
    matchRoles: entry.matchRoles,
    namespace: entry.namespace,
  };
}

function webappValuesEqual(a: WebAppValue, b: WebAppValue): boolean {
  return (
    a.dispatchClass === b.dispatchClass &&
    a.enabled === b.enabled &&
    a.authEnabled === b.authEnabled &&
    a.isNameSpaceDefault === b.isNameSpaceDefault &&
    a.cspZenEnabled === b.cspZenEnabled &&
    a.recurse === b.recurse &&
    a.matchRoles === b.matchRoles &&
    a.namespace === b.namespace
  );
}

/**
 * Fetch ALL web applications, instance-wide (NO namespace filter — webapps
 * are unique by `name` across the whole instance; each row carries its own
 * `namespace` field, which IS part of the compared value subset).
 *
 * Exported (Story 27.3, Task 2 / Rule #47) so `execute` reuses this EXACT
 * source-read logic to re-fetch the authoritative source-side webapp
 * properties at execute time.
 */
export async function fetchWebapps(client: IrisHttpClient): Promise<Map<string, WebAppEntry>> {
  const response = await client.get<WebAppEntry[]>(`${BASE_URL}/security/webapp`);
  const map = new Map<string, WebAppEntry>();
  for (const entry of response.result ?? []) {
    map.set(entry.name, entry);
  }
  return map;
}

function diffWebapps(
  sourceMap: Map<string, WebAppEntry>,
  targetMap: Map<string, WebAppEntry>,
): WebappsDiff {
  const generic = computeKeyedDiff(sourceMap, targetMap, webappValue, webappValuesEqual);
  const differs = generic.differsKeys.map((name): WebAppDiffEntry => ({
    name,
    sourceValue: generic.sourceValues.get(name) as WebAppValue,
    targetValue: generic.targetValues.get(name) as WebAppValue,
  }));
  return {
    onlyInSource: generic.onlyInSourceKeys,
    onlyInTarget: generic.onlyInTargetKeys,
    differs,
    identical: generic.identical,
  };
}

// ── helpers: config ───────────────────────────────────────────────────

/**
 * Fetch the ~11 supported `config`-section CPF properties, instance-wide (no
 * namespace concept). Exported (Story 27.3, Task 2 / Rule #47) so `execute`
 * reuses this EXACT source-read logic to re-fetch the authoritative
 * source-side config value at execute time.
 */
export async function fetchConfig(client: IrisHttpClient): Promise<ConfigProperties> {
  const response = await client.post<ConfigGetResult>(`${BASE_URL}/system/config`, {
    action: "get",
    section: "config",
  });
  return response.result.properties;
}

function diffConfig(source: ConfigProperties, target: ConfigProperties): ConfigDiff {
  const sourceMap = new Map<string, string | number>(
    Object.entries(source) as Array<[string, string | number]>,
  );
  const targetMap = new Map<string, string | number>(
    Object.entries(target) as Array<[string, string | number]>,
  );
  const generic = computeKeyedDiff(
    sourceMap,
    targetMap,
    (value) => value,
    (a, b) => a === b,
  );
  const differs = generic.differsKeys.map((key): ConfigDiffEntry => ({
    key,
    sourceValue: generic.sourceValues.get(key) as string | number,
    targetValue: generic.targetValues.get(key) as string | number,
  }));
  return {
    onlyInSource: generic.onlyInSourceKeys,
    onlyInTarget: generic.onlyInTargetKeys,
    differs,
    identical: generic.identical,
  };
}

// ── rendering (content[].text summary) ──────────────────────────────

function renderDocumentsSection(d: DocumentsDiff): string {
  const lines: string[] = [];
  lines.push(`  identical: ${d.identical}`);
  lines.push(
    `  onlyInSource (${d.onlyInSource.length}): ${d.onlyInSource.length > 0 ? d.onlyInSource.join(", ") : "(none)"}`,
  );
  lines.push(
    `  onlyInTarget (${d.onlyInTarget.length}, informational -- NOT a deletion signal): ${
      d.onlyInTarget.length > 0 ? d.onlyInTarget.join(", ") : "(none)"
    }`,
  );
  lines.push(`  differs (${d.differs.length}):`);
  for (const entry of d.differs) {
    lines.push(
      `    ${entry.name} (source=${entry.sourceHash.slice(0, 12)}... target=${entry.targetHash.slice(0, 12)}...)`,
    );
  }
  return lines.join("\n");
}

function renderMappingsSection(d: MappingsDiff): string {
  const lines: string[] = [];
  lines.push(`  identical: ${d.identical}`);
  lines.push(
    `  onlyInSource (${d.onlyInSource.length}): ${d.onlyInSource.length > 0 ? d.onlyInSource.join(", ") : "(none)"}`,
  );
  lines.push(
    `  onlyInTarget (${d.onlyInTarget.length}, informational -- NOT a deletion signal): ${
      d.onlyInTarget.length > 0 ? d.onlyInTarget.join(", ") : "(none)"
    }`,
  );
  lines.push(`  differs (${d.differs.length}):`);
  for (const entry of d.differs) {
    lines.push(`    ${entry.type}:${entry.namespace}:${entry.name}`);
  }
  return lines.join("\n");
}

/** Display key for one SDS entry -- key fields ONLY, never the (possibly redacted) value. */
function sdsDisplayKey(entry: { production: string; item: string; hostClass: string; setting: string }): string {
  return `${entry.production}/${entry.item}/${entry.hostClass}/${entry.setting}`;
}

function renderDefaultSettingsSection(d: DefaultSettingsDiff): string {
  const lines: string[] = [];
  lines.push(`  identical: ${d.identical}`);
  lines.push(
    `  onlyInSource (${d.onlyInSource.length}): ${
      d.onlyInSource.length > 0 ? d.onlyInSource.map(sdsDisplayKey).join(", ") : "(none)"
    }`,
  );
  lines.push(
    `  onlyInTarget (${d.onlyInTarget.length}, informational -- NOT a deletion signal): ${
      d.onlyInTarget.length > 0 ? d.onlyInTarget.map(sdsDisplayKey).join(", ") : "(none)"
    }`,
  );
  lines.push(`  differs (${d.differs.length}):`);
  for (const entry of d.differs) {
    lines.push(`    ${sdsDisplayKey(entry)}${entry.redacted ? ` ${entry.redacted}` : ""}`);
  }
  return lines.join("\n");
}

function renderWebappsSection(d: WebappsDiff): string {
  const lines: string[] = [];
  lines.push(`  identical: ${d.identical}`);
  lines.push(
    `  onlyInSource (${d.onlyInSource.length}): ${d.onlyInSource.length > 0 ? d.onlyInSource.join(", ") : "(none)"}`,
  );
  lines.push(
    `  onlyInTarget (${d.onlyInTarget.length}, informational -- NOT a deletion signal): ${
      d.onlyInTarget.length > 0 ? d.onlyInTarget.join(", ") : "(none)"
    }`,
  );
  lines.push(`  differs (${d.differs.length}):`);
  for (const entry of d.differs) {
    lines.push(`    ${entry.name}`);
  }
  return lines.join("\n");
}

function renderConfigSection(d: ConfigDiff): string {
  const lines: string[] = [];
  lines.push(`  identical: ${d.identical}`);
  lines.push(
    `  onlyInSource (${d.onlyInSource.length}): ${d.onlyInSource.length > 0 ? d.onlyInSource.join(", ") : "(none)"}`,
  );
  lines.push(
    `  onlyInTarget (${d.onlyInTarget.length}): ${d.onlyInTarget.length > 0 ? d.onlyInTarget.join(", ") : "(none)"}`,
  );
  lines.push(`  differs (${d.differs.length}):`);
  for (const entry of d.differs) {
    lines.push(`    ${entry.key} (source=${entry.sourceValue} target=${entry.targetValue})`);
  }
  return lines.join("\n");
}

// ── error envelopes ──────────────────────────────────────────────────

function validationError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/** Shared IrisApiError envelope for both the resolve-phase and fetch-phase catches (CR 27.0-2). */
function apiErrorEnvelope(source: string, target: string, error: IrisApiError) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error diffing environments (source='${source}', target='${target}'): ${error.message}`,
      },
    ],
    isError: true,
  };
}

// ── iris_env_diff ───────────────────────────────────────────

export const envDiffTool: ToolDefinition = {
  name: "iris_env_diff",
  title: "Diff Two IRIS Environments",
  description:
    "Compare two configured IRIS server profiles (source vs target, e.g. 'stage' vs 'prod') " +
    "and report a structured drift report -- what's different between them -- in one call. " +
    "Covers FIVE domains; only the requested domains are fetched. DEFAULT (when 'domains' is " +
    "omitted): the FOUR no-spec config domains -- 'mappings', 'defaultSettings', 'webapps', " +
    "'config'. 'documents' is OPT-IN ONLY -- list it explicitly in 'domains' (and pass 'spec' " +
    "too) -- because it REQUIRES a 'spec' and a bare call must not fail just for omitting one. " +
    "'documents': ObjectScript source compared by SHA-256 content hash (cross-IRIS-version " +
    "safe, not a compiled-artifact comparison). 'mappings': global/routine/package namespace " +
    "mappings, incl. subscript-level mappings embedded in the mapping name. 'defaultSettings': " +
    "Interoperability System Default Settings -- rows whose SETTING NAME contains " +
    "'password'/'secret'/'key'/'token'/'pwd'/'passphrase'/'credential'/'cert'/'private'/'salt' " +
    "(case-insensitive substring, fail-safe/over-redact) are REDACTED as '[REDACTED:differs]' / " +
    "'[REDACTED]' and their VALUES never appear in this tool's output. 'webapps': a curated " +
    "Security.Applications property subset (dispatchClass, enabled, authEnabled, " +
    "isNameSpaceDefault, cspZenEnabled, recurse, matchRoles, namespace); 'cookiePath' is " +
    "EXCLUDED by default as the closest thing to an instance-specific path on this endpoint, " +
    "and the per-app 'resource' property is not compared (omitted from the list endpoint this " +
    "tool calls). 'config': the ~11 supported CPF 'config'-section properties. " +
    "'documents'/'mappings'/'defaultSettings' are compared PER-NAMESPACE (each profile's own " +
    "configured default namespace, unless overridden by 'namespace'); 'webapps' and 'config' are " +
    "INSTANCE-WIDE and never take a namespace. For the 'documents' domain, 'spec' is REQUIRED (a " +
    "comma-delimited document spec with */? wildcards, e.g. 'MyPkg.*.cls,*.mac'); a bare '*' " +
    "(whole-namespace scan) is refused unless allowWide:true is also passed -- a wide scan on a " +
    "large namespace risks the ~60s Web Gateway timeout, so prefer a package-scoped spec. " +
    "PER-DOMAIN ERROR ISOLATION: each requested domain is fetched/compared independently -- a " +
    "domain that hard-errors (e.g. 'defaultSettings' against a namespace with no " +
    "Interoperability schema, or 'documents' requested without 'spec') is reported in 'errors' " +
    "(an object keyed by domain name, sanitized message) and does NOT abort the other domains; " +
    "'summary' rolls up only the SUCCEEDED domains. The call is isError:true ONLY when EVERY " +
    "requested domain fails -- a partial failure returns isError:false with the succeeded " +
    "domains' diffs intact. " +
    "'onlyInTarget' entries (in every domain) are INFORMATIONAL (something exists on the target " +
    "only) and are NEVER a deletion signal -- nothing is ever deleted by this tool. Hash " +
    "comparison is idempotent (stable across repeated calls) and, by default " +
    "(ignoreTimestamps:true), insensitive to timestamp-only differences (a recompile without a " +
    "content change does not read as drift). This is a READ-ONLY tool, enabled by default.",
  inputSchema: z.object({
    source: z
      .string()
      .min(1)
      .describe("Source profile name (from IRIS_PROFILES, or 'default')."),
    target: z
      .string()
      .min(1)
      .describe("Target profile name (from IRIS_PROFILES, or 'default')."),
    domains: z
      .array(z.enum(DIFF_DOMAINS))
      .min(1)
      .optional()
      .default([...DEFAULT_DIFF_DOMAINS])
      .describe(
        "Domains to compare. Default when omitted: the FOUR no-spec config domains -- " +
          "mappings, defaultSettings, webapps, config. 'documents' is OPT-IN ONLY -- include " +
          "it explicitly in this list AND pass 'spec' (required for 'documents'). Only the " +
          "requested domains are fetched.",
      ),
    spec: z
      .string()
      .optional()
      .describe(
        "Document spec for the 'documents' domain (REQUIRED when 'documents' is compared; " +
          "comma-delimited, */? wildcards, e.g. 'MyPkg.*.cls,*.mac'). A bare '*' is refused " +
          "unless allowWide:true.",
      ),
    allowWide: z
      .boolean()
      .optional()
      .describe(
        "Permit a wide/whole-namespace 'documents' spec (a bare '*'). Default false -- a " +
          "large namespace may hit the ~60s Web Gateway timeout.",
      ),
    namespace: z
      .string()
      .optional()
      .describe(
        "Namespace applied to BOTH sides' 'documents'/'mappings'/'defaultSettings' lookups, " +
          "overriding each profile's own default. Omit (or pass blank) to use each profile's " +
          "OWN configured default namespace independently (source and target may resolve to " +
          "different namespaces -- e.g. comparing a profile defaulting to HSCUSTOM against one " +
          "defaulting to SADEMO). Not used by 'webapps'/'config' (instance-wide).",
      ),
    ignoreTimestamps: z
      .boolean()
      .optional()
      .describe(
        "Default true: compare 'documents' by content hash only (a timestamp-only difference " +
          "does not count as drift). Set false to also flag timestamp-only differences.",
      ),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  // Governance (Rule #28): new post-foundation key -- classification is mandatory
  // even for a pure read. Read -> default-ENABLED via defaultSeed.
  mutates: "read",
  handler: async (args, ctx) => {
    const input = args as {
      source: string;
      target: string;
      domains?: DiffDomain[];
      spec?: string;
      allowWide?: boolean;
      namespace?: string;
      ignoreTimestamps?: boolean;
    };

    // Cycle-2 rework: default domains no longer include 'documents' (it
    // requires 'spec') -- see DEFAULT_DIFF_DOMAINS. Zod's own `.default(...)`
    // only fires when args are parsed through zod; the tool registry may pass
    // raw args, so this `??` fallback is required to preserve the contract
    // regardless (mirrors the established `rest.ts` `scope ?? "spec-first"`
    // pattern).
    const domains = input.domains ?? [...DEFAULT_DIFF_DOMAINS];
    const ignoreTimestamps = input.ignoreTimestamps ?? true;

    const includesDocuments = domains.includes("documents");
    const includesMappings = domains.includes("mappings");
    const includesDefaultSettings = domains.includes("defaultSettings");
    const includesWebapps = domains.includes("webapps");
    const includesConfig = domains.includes("config");

    // Canonical, de-duplicated, ordered list of the domains actually being
    // attempted this call (used only for the all-vs-partial error tally
    // below -- NOT for control flow, which stays on the includesX booleans).
    const requestedDomains: DiffDomain[] = DIFF_DOMAINS.filter((d) => domains.includes(d));

    // Resolve BOTH profile clients through the framework primitive -- reuses the
    // exact establishment path (health-check + version negotiation + one-time
    // custom-REST bootstrap) so a custom-REST call succeeds even against a
    // profile that was never the framework `server`-selected calling profile.
    let sourceClient: IrisHttpClient;
    let targetClient: IrisHttpClient;
    try {
      [sourceClient, targetClient] = await Promise.all([
        ctx.resolveProfileClient(input.source),
        ctx.resolveProfileClient(input.target),
      ]);
    } catch (error: unknown) {
      if (error instanceof ProfileResolutionError) {
        return validationError(error.message);
      }
      // CR 27.0-2: an IrisApiError establishing a profile (health-check/
      // version-negotiation/bootstrap) gets the SAME friendly envelope the
      // fetch-phase catch below produces, instead of an unhandled rethrow.
      // Profile establishment is NOT domain-specific (every domain needs
      // these clients), so this stays a whole-call abort -- unlike the
      // per-domain isolation below.
      if (error instanceof IrisApiError) {
        return apiErrorEnvelope(input.source, input.target, error);
      }
      throw error;
    }

    // Resolve each side's namespace independently: an explicit input.namespace
    // overrides BOTH sides identically (spec "applies to both sides"); when
    // omitted OR blank/whitespace-only (CR 27.0-5), each side falls back to
    // ITS OWN resolved profile's configured default namespace -- they may
    // differ (e.g. source's default profile defaults to HSCUSTOM, target's
    // "sademo" profile defaults to SADEMO). Never left blank -- always a
    // resolved, non-empty namespace (Rule #47 / CR 27.0-3 fix, Story 27.0
    // cycle 2; CR 27.0-5 fix, Story 27.1).
    const namespaceOverride = input.namespace?.trim() || undefined;
    const sourceNamespace = namespaceOverride ?? sourceClient.namespace;
    const targetNamespace = namespaceOverride ?? targetClient.namespace;

    const result: EnvDiffResult = {
      source: { profile: input.source, namespace: sourceNamespace },
      target: { profile: input.target, namespace: targetNamespace },
      domains: {},
      summary: { driftCount: 0, identicalCount: 0 },
    };

    // Per-domain error isolation (cycle-2 rework, elevates CR 27.1-3, mirrors
    // Health.cls's per-area isolation -- Epic 23 / Rule #41): EACH domain
    // below runs in its OWN try/catch. An IrisApiError (a hard error from
    // IRIS itself -- e.g. a non-interop namespace's Ens_Config schema
    // missing) is isolated to that ONE domain: a sanitized message lands in
    // `domainErrors`, and the loop CONTINUES with the remaining domains. Any
    // OTHER thrown type (a genuine bug, e.g. a TypeError) still propagates
    // out of the handler entirely -- isolation is deliberately scoped to
    // anticipated IRIS-side failures, not silently swallowing real defects.
    const domainErrors: Partial<Record<DiffDomain, string>> = {};

    if (includesDocuments) {
      // The missing-spec guard is now a per-domain concern (previously a
      // whole-call abort before any client was even resolved) -- isolated to
      // 'documents' via `domainErrors`, not `validationError()`, so a request
      // that ALSO includes other domains still gets their results.
      if (!input.spec || input.spec.trim() === "") {
        domainErrors.documents =
          "'spec' is required for the 'documents' domain (e.g. 'MyPkg.*.cls,*.mac'). " +
          "A bare '*' is refused unless allowWide:true.";
      } else {
        try {
          const spec = input.spec.trim();
          const [sourceMap, targetMap] = await Promise.all([
            fetchDocHashes(sourceClient, spec, sourceNamespace, input.allowWide),
            fetchDocHashes(targetClient, spec, targetNamespace, input.allowWide),
          ]);
          const documentsDiff = diffDocuments(sourceMap, targetMap, ignoreTimestamps);
          result.domains.documents = documentsDiff;
          accumulateDrift(result.summary, documentsDiff);
        } catch (error: unknown) {
          if (error instanceof IrisApiError) {
            domainErrors.documents = error.message;
          } else {
            throw error;
          }
        }
      }
    }

    if (includesMappings) {
      try {
        const [sourceMap, targetMap] = await Promise.all([
          fetchMappings(sourceClient, sourceNamespace),
          fetchMappings(targetClient, targetNamespace),
        ]);
        const mappingsDiff = diffMappings(sourceMap, targetMap);
        result.domains.mappings = mappingsDiff;
        accumulateDrift(result.summary, mappingsDiff);
      } catch (error: unknown) {
        if (error instanceof IrisApiError) {
          domainErrors.mappings = error.message;
        } else {
          throw error;
        }
      }
    }

    if (includesDefaultSettings) {
      try {
        const [sourceMap, targetMap] = await Promise.all([
          fetchDefaultSettings(sourceClient, sourceNamespace),
          fetchDefaultSettings(targetClient, targetNamespace),
        ]);
        const defaultSettingsDiff = diffDefaultSettings(sourceMap, targetMap);
        result.domains.defaultSettings = defaultSettingsDiff;
        accumulateDrift(result.summary, defaultSettingsDiff);
      } catch (error: unknown) {
        if (error instanceof IrisApiError) {
          domainErrors.defaultSettings = error.message;
        } else {
          throw error;
        }
      }
    }

    if (includesWebapps) {
      try {
        const [sourceMap, targetMap] = await Promise.all([
          fetchWebapps(sourceClient),
          fetchWebapps(targetClient),
        ]);
        const webappsDiff = diffWebapps(sourceMap, targetMap);
        result.domains.webapps = webappsDiff;
        accumulateDrift(result.summary, webappsDiff);
      } catch (error: unknown) {
        if (error instanceof IrisApiError) {
          domainErrors.webapps = error.message;
        } else {
          throw error;
        }
      }
    }

    if (includesConfig) {
      try {
        const [sourceProps, targetProps] = await Promise.all([
          fetchConfig(sourceClient),
          fetchConfig(targetClient),
        ]);
        const configDiff = diffConfig(sourceProps, targetProps);
        result.domains.config = configDiff;
        accumulateDrift(result.summary, configDiff);
      } catch (error: unknown) {
        if (error instanceof IrisApiError) {
          domainErrors.config = error.message;
        } else {
          throw error;
        }
      }
    }

    const erroredDomains = DIFF_DOMAINS.filter((d) => domainErrors[d] !== undefined);
    if (erroredDomains.length > 0) {
      result.errors = domainErrors;
    }
    // isError:true ONLY when EVERY requested domain errored; a partial
    // failure (>=1 requested domain succeeded) is isError:false -- the call
    // itself succeeded and returned real data, even though part of it is an
    // error map instead of a diff.
    const allDomainsErrored =
      requestedDomains.length > 0 && erroredDomains.length === requestedDomains.length;
    const someDomainsErrored = erroredDomains.length > 0 && !allDomainsErrored;

    const textLines: string[] = [
      `Environment diff: source='${input.source}' target='${input.target}'`,
    ];
    if (result.domains.documents) {
      textLines.push("Documents:");
      textLines.push(renderDocumentsSection(result.domains.documents));
    } else if (domainErrors.documents) {
      textLines.push("Documents:");
      textLines.push(`  ERROR: ${domainErrors.documents}`);
    }
    if (result.domains.mappings) {
      textLines.push("Mappings:");
      textLines.push(renderMappingsSection(result.domains.mappings));
    } else if (domainErrors.mappings) {
      textLines.push("Mappings:");
      textLines.push(`  ERROR: ${domainErrors.mappings}`);
    }
    if (result.domains.defaultSettings) {
      textLines.push("Default Settings:");
      textLines.push(renderDefaultSettingsSection(result.domains.defaultSettings));
    } else if (domainErrors.defaultSettings) {
      textLines.push("Default Settings:");
      textLines.push(`  ERROR: ${domainErrors.defaultSettings}`);
    }
    if (result.domains.webapps) {
      textLines.push("Web Applications:");
      textLines.push(renderWebappsSection(result.domains.webapps));
    } else if (domainErrors.webapps) {
      textLines.push("Web Applications:");
      textLines.push(`  ERROR: ${domainErrors.webapps}`);
    }
    if (result.domains.config) {
      textLines.push("Config:");
      textLines.push(renderConfigSection(result.domains.config));
    } else if (domainErrors.config) {
      textLines.push("Config:");
      textLines.push(`  ERROR: ${domainErrors.config}`);
    }
    if (erroredDomains.length > 0) {
      textLines.push(
        `${erroredDomains.length} of ${requestedDomains.length} requested domain(s) failed ` +
          `(see ERROR lines above) -- the summary below reflects only the ` +
          `${requestedDomains.length - erroredDomains.length} succeeded domain(s).`,
      );
    }
    textLines.push(
      `Summary: ${result.summary.driftCount} drifted, ${result.summary.identicalCount} identical.`,
    );

    return {
      content: [{ type: "text" as const, text: textLines.join("\n") }],
      structuredContent: result as unknown as Record<string, unknown>,
      // Omitted entirely when no domain errored (matches the pre-existing
      // all-success contract: isError undefined, not a literal false).
      ...(allDomainsErrored ? { isError: true } : someDomainsErrored ? { isError: false } : {}),
    };
  },
};
