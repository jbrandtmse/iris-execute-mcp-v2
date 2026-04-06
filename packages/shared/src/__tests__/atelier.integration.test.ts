/**
 * Integration tests for Atelier API version negotiation against a real IRIS instance.
 *
 * Skipped automatically when IRIS is not reachable.
 */

import { describe, it, expect, afterAll } from "vitest";
import { IrisHttpClient } from "../http-client.js";
import { negotiateVersion, atelierPath } from "../atelier.js";
import { createIntegrationClient } from "./integration-helpers.js";

const client: IrisHttpClient = createIntegrationClient();

afterAll(() => {
  client.destroy();
});

describe.skipIf(!globalThis.__IRIS_AVAILABLE__)(
  "Atelier Version Negotiation Integration",
  () => {
    it("negotiateVersion(client) returns a version number >= 1", async () => {
      const version = await negotiateVersion(client);
      expect(version).toBeGreaterThanOrEqual(1);
    });

    it("detected version is a reasonable value (between 1 and 8)", async () => {
      const version = await negotiateVersion(client);
      expect(version).toBeGreaterThanOrEqual(1);
      expect(version).toBeLessThanOrEqual(8);
    });

    it("atelierPath produces correct path with detected version", async () => {
      const version = await negotiateVersion(client);
      const path = atelierPath(version, "HSCUSTOM", "doc/MyClass.cls");
      expect(path).toBe(
        `/api/atelier/v${version}/HSCUSTOM/doc/MyClass.cls`,
      );
    });
  },
);
