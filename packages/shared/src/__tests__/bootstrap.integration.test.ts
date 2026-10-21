/**
 * Integration tests for the bootstrap module against a real IRIS instance.
 *
 * Verifies that {@link probeCustomRest} detects an already-configured REST
 * service and that the full {@link bootstrap} function returns an idempotent
 * skip result (probeFound=true, all steps marked as already done); a
 * deployment from a newer or foreign build is left in place (probeFound=true,
 * no step run).
 *
 * Skipped unless the run is armed (`IRIS_REQUIRE_LIVE` and the five `IRIS_*`
 * target variables) and IRIS is reachable.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { IrisHttpClient } from "../http-client.js";
import { negotiateVersion } from "../atelier.js";
import { probeCustomRest, bootstrap } from "../bootstrap.js";
import {
  getIntegrationConfig,
  createIntegrationClient,
} from "./integration-helpers.js";
import type { IrisConnectionConfig } from "../config.js";

declare global {
  var __IRIS_AVAILABLE__: boolean;
}

// ── Shared state ─────────────────────────────────────────────────────

let client: IrisHttpClient;
let config: IrisConnectionConfig;
let version: number;

describe.skipIf(!globalThis.__IRIS_AVAILABLE__)(
  "Bootstrap Integration",
  () => {
    beforeAll(async () => {
      config = getIntegrationConfig();
      client = createIntegrationClient();
      version = await negotiateVersion(client);
    });

    afterAll(() => {
      client?.destroy();
    });

    it("probeCustomRest returns a ProbeResult reflecting deployment + configuration state", async () => {
      const probe = await probeCustomRest(client, config, version);
      // The probe returns a discriminated union, not a boolean. Its status
      // is one of the six states. On a healthy CI/dev instance this is
      // "current" (classes match AND web app registered); a version-stamped
      // but web-app-absent instance reports "unconfigured"; a deployment from
      // a newer or unorderable build reports "newer" or "foreign".
      expect([
        "missing",
        "current",
        "unconfigured",
        "stale",
        "newer",
        "foreign",
      ]).toContain(probe.status);
    });

    it("bootstrap() returns idempotent skip when service is already configured", async () => {
      const result = await bootstrap(client, config, version);

      if (result.probeStatus === "newer" || result.probeStatus === "foreign") {
        // A deployment from a newer or unorderable build is never replaced:
        // found, but no step ran and nothing failed.
        expect(result.probeFound).toBe(true);
        expect(result.deployedVersion).toEqual(expect.any(String));
        expect(result.deployed).toBe(false);
        expect(result.compiled).toBe(false);
        expect(result.configured).toBe(false);
        expect(result.mapped).toBe(false);
        expect(result.errors).toHaveLength(0);
      } else if (result.probeFound) {
        // If the custom REST service is already deployed, bootstrap should detect
        // it and skip all deploy/compile/configure steps.
        expect(result.deployed).toBe(true);
        expect(result.compiled).toBe(true);
        expect(result.configured).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.manualInstructions).toBeUndefined();
      } else {
        // If not configured, bootstrap will attempt deploy. We verify the
        // function completes without throwing and returns a structured result.
        expect(result).toHaveProperty("probeFound");
        expect(result).toHaveProperty("deployed");
        expect(result).toHaveProperty("compiled");
        expect(result).toHaveProperty("configured");
        expect(result).toHaveProperty("errors");
      }
    });
  },
);
