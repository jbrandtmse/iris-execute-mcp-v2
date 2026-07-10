/**
 * Cross-profile environment drift detector for the IRIS Development MCP server
 * (Epic 27, Story 27.0).
 *
 * Provides {@link envDiffTool} — `iris_env_diff` — which compares two configured
 * IRIS server profiles (`source` / `target`, e.g. `stage` vs `prod`) and reports
 * a structured drift report, so an operator can see "what's different between
 * stage and prod?" in one call instead of a manual export/diff dance.
 *
 * This story (27.0) wires the **`documents`** domain end-to-end: it resolves
 * BOTH profiles' `IrisHttpClient`s via the new framework primitive
 * `ctx.resolveProfileClient` (Story 27.0, `@iris-mcp/shared`), calls the new
 * ObjectScript endpoint `POST /api/executemcp/v2/dev/doc/hashes` on each side,
 * and buckets the results into `onlyInSource` / `onlyInTarget` / `differs` /
 * `identical`. The remaining domains (`mappings`, `defaultSettings`, `webapps`,
 * `config`) are declared in the schema for forward-compat (Story 27.1 fills
 * their handlers) but are REFUSED if requested in this version — see
 * {@link UNIMPLEMENTED_DOMAINS}.
 *
 * **`onlyInTarget` is informational (a warning) — NEVER a deletion signal.**
 * This invariant is established here and must hold for the lifetime of the
 * feature; it becomes load-bearing once `iris_env_promote:plan` (Story 27.2)
 * turns a diff into an execution plan.
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

/** Full domain enum (forward-compat with Story 27.1 — declared now, not all implemented). */
const DIFF_DOMAINS = [
  "documents",
  "mappings",
  "defaultSettings",
  "webapps",
  "config",
] as const;
type DiffDomain = (typeof DIFF_DOMAINS)[number];

/**
 * Domains NOT YET implemented (ship in Story 27.1). Requesting one of these
 * explicitly is refused with a clear "not implemented until Story 27.1"
 * message (decision (a) from the story's Dev Notes — a clean signal rather
 * than a silently-misleading `identical:0` bucket).
 */
const UNIMPLEMENTED_DOMAINS: readonly DiffDomain[] = [
  "mappings",
  "defaultSettings",
  "webapps",
  "config",
];

// ── /dev/doc/hashes response shape (ExecuteMCPv2.REST.EnvSync) ─────

interface DocHashEntry {
  name: string;
  hash: string;
  timestamp: string;
}

interface DocHashesResult {
  documents: DocHashEntry[];
  count: number;
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

interface EnvDiffResult {
  source: ProfileRef;
  target: ProfileRef;
  domains: {
    documents?: DocumentsDiff;
  };
  summary: {
    driftCount: number;
    identicalCount: number;
  };
}

// ── helpers ──────────────────────────────────────────────────────

/** Fetch `{name -> {hash, timestamp}}` from one profile's /dev/doc/hashes endpoint. */
async function fetchDocHashes(
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

function validationError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
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
    "THIS VERSION implements the 'documents' domain only (ObjectScript source, compared by " +
    "SHA-256 content hash -- cross-IRIS-version safe, not a compiled-artifact comparison). " +
    "The 'mappings'/'defaultSettings'/'webapps'/'config' domains are declared for forward-" +
    "compatibility but are REFUSED if requested in this version (they ship in a later story). " +
    "For the 'documents' domain, 'spec' is REQUIRED (a comma-delimited document spec with */? " +
    "wildcards, e.g. 'MyPkg.*.cls,*.mac'); a bare '*' (whole-namespace scan) is refused unless " +
    "allowWide:true is also passed -- a wide scan on a large namespace risks the ~60s Web " +
    "Gateway timeout, so prefer a package-scoped spec. 'onlyInTarget' entries are INFORMATIONAL " +
    "(something exists on the target only) and are NEVER a deletion signal -- nothing is ever " +
    "deleted by this tool. Hash comparison is idempotent (stable across repeated calls) and, by " +
    "default (ignoreTimestamps:true), insensitive to timestamp-only differences (a recompile " +
    "without a content change does not read as drift). This is a READ-ONLY tool, enabled by " +
    "default.",
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
      .describe(
        "Domains to compare (default: ['documents'] in this version). " +
          "'mappings'/'defaultSettings'/'webapps'/'config' are declared for forward-" +
          "compatibility but are refused if requested -- they ship in a later story.",
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
        "Namespace applied to BOTH sides' 'documents' lookup, overriding each profile's own " +
          "default. Omit to use each profile's OWN configured default namespace independently " +
          "(source and target may resolve to different namespaces -- e.g. comparing a profile " +
          "defaulting to HSCUSTOM against one defaulting to SADEMO).",
      ),
    ignoreTimestamps: z
      .boolean()
      .optional()
      .describe(
        "Default true: compare documents by content hash only (a timestamp-only difference " +
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

    const domains = input.domains ?? (["documents"] as DiffDomain[]);
    const ignoreTimestamps = input.ignoreTimestamps ?? true;

    // Not-yet-implemented domains (27.1 scope) are refused with a clean signal
    // rather than silently returning a misleading identical:0 bucket.
    const requestedUnimplemented = domains.filter((d) =>
      UNIMPLEMENTED_DOMAINS.includes(d),
    );
    if (requestedUnimplemented.length > 0) {
      return validationError(
        `Domain(s) ${requestedUnimplemented.map((d) => `'${d}'`).join(", ")} ` +
          `not yet implemented -- ships in Story 27.1. Only 'documents' is supported in ` +
          `this version; omit 'domains' or pass domains:["documents"] explicitly.`,
      );
    }

    const includesDocuments = domains.includes("documents");
    if (includesDocuments && (!input.spec || input.spec.trim() === "")) {
      return validationError(
        "'spec' is required for the 'documents' domain (e.g. 'MyPkg.*.cls,*.mac'). " +
          "A bare '*' is refused unless allowWide:true.",
      );
    }

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
      throw error;
    }

    // Resolve each side's namespace independently: an explicit input.namespace
    // overrides BOTH sides identically (spec "applies to both sides"); when
    // omitted, each side falls back to ITS OWN resolved profile's configured
    // default namespace -- they may differ (e.g. source's default profile
    // defaults to HSCUSTOM, target's "sademo" profile defaults to SADEMO).
    // Never left blank -- always a resolved, non-empty namespace (Rule #47 /
    // CR 27.0-3 fix, Story 27.0 cycle 2).
    const sourceNamespace = input.namespace ?? sourceClient.namespace;
    const targetNamespace = input.namespace ?? targetClient.namespace;

    const result: EnvDiffResult = {
      source: { profile: input.source, namespace: sourceNamespace },
      target: { profile: input.target, namespace: targetNamespace },
      domains: {},
      summary: { driftCount: 0, identicalCount: 0 },
    };

    try {
      if (includesDocuments) {
        const spec = (input.spec as string).trim();
        const [sourceMap, targetMap] = await Promise.all([
          fetchDocHashes(sourceClient, spec, sourceNamespace, input.allowWide),
          fetchDocHashes(targetClient, spec, targetNamespace, input.allowWide),
        ]);
        const documentsDiff = diffDocuments(sourceMap, targetMap, ignoreTimestamps);
        result.domains.documents = documentsDiff;
        result.summary.driftCount +=
          documentsDiff.onlyInSource.length +
          documentsDiff.onlyInTarget.length +
          documentsDiff.differs.length;
        result.summary.identicalCount += documentsDiff.identical;
      }
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error diffing environments (source='${input.source}', target='${input.target}'): ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }

    const textLines: string[] = [
      `Environment diff: source='${input.source}' target='${input.target}'`,
    ];
    if (result.domains.documents) {
      textLines.push("Documents:");
      textLines.push(renderDocumentsSection(result.domains.documents));
    }
    textLines.push(
      `Summary: ${result.summary.driftCount} drifted, ${result.summary.identicalCount} identical.`,
    );

    return {
      content: [{ type: "text" as const, text: textLines.join("\n") }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
};
