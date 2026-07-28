/**
 * `@iris-mcp/client-config` — read-only client detection (Epic 33, Story 33.0).
 *
 * Probes each adapter's declared config-file and app-dir paths through an
 * INJECTED filesystem predicate. This module performs ZERO writes — the
 * injected surface (`exists` + `readFile`) structurally has no write methods,
 * and a test spies the real fs to prove no write/mkdir/rename syscall fires.
 */

import { existsSync } from "node:fs";

import { ADAPTER_DATA_VERSION, CLIENT_ADAPTERS } from "./adapters.js";
import { resolvePathTemplate, resolveScopeCandidates } from "./paths.js";
import type { ClientAdapter, HostContext } from "./types.js";

/** Injectable filesystem surface — reads only, by construction. */
export interface DetectionFs {
  exists(path: string): boolean;
}

/** Default fs surface (real filesystem, existence only). */
export const REAL_DETECTION_FS: DetectionFs = { exists: existsSync };

export interface DetectionProbe {
  kind: "config" | "appDir";
  scope?: "user" | "project";
  path: string;
  exists: boolean;
}

export interface ClientDetection {
  client: string;
  displayName: string;
  detected: boolean;
  probes: DetectionProbe[];
}

export interface DetectionReport {
  adapterDataVersion: string;
  clients: ClientDetection[];
}

/** Enumerate the probe paths for one adapter (config scopes + app dirs). */
export function detectionProbes(
  adapter: ClientAdapter,
  ctx: HostContext,
): Omit<DetectionProbe, "exists">[] {
  const probes: Omit<DetectionProbe, "exists">[] = [];
  for (const rule of adapter.detection) {
    if (rule.kind === "config") {
      for (const candidate of resolveScopeCandidates(adapter, rule.scope, ctx)) {
        probes.push({ kind: "config", scope: rule.scope, path: candidate });
      }
    } else {
      probes.push({ kind: "appDir", path: resolvePathTemplate(rule.paths[ctx.platform], ctx) });
    }
  }
  return probes;
}

/**
 * Detect which clients are installed, per adapter data. Never throws on
 * missing files (a probe that errors — e.g. EACCES on an unreadable parent —
 * reports `exists: false`, it never propagates). Undetected clients are
 * reported distinctly via `detected: false` (33.3 lists them collapsed with
 * a "not detected" note).
 */
export function detectClients(
  ctx: HostContext,
  fs: DetectionFs = REAL_DETECTION_FS,
  adapters: Readonly<Record<string, ClientAdapter>> = CLIENT_ADAPTERS,
): DetectionReport {
  const clients: ClientDetection[] = [];
  for (const adapter of Object.values(adapters)) {
    const probes: DetectionProbe[] = detectionProbes(adapter, ctx).map((probe) => {
      let exists = false;
      try {
        exists = fs.exists(probe.path);
      } catch {
        exists = false;
      }
      return { ...probe, exists };
    });
    clients.push({
      client: adapter.id,
      displayName: adapter.displayName,
      detected: probes.some((probe) => probe.exists),
      probes,
    });
  }
  return { adapterDataVersion: ADAPTER_DATA_VERSION, clients };
}
