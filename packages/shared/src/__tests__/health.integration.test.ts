/**
 * Integration tests for health check and ping utilities against a real IRIS instance.
 *
 * Skipped automatically when IRIS is not reachable.
 */

import { describe, it, expect, afterAll } from "vitest";
import { IrisHttpClient } from "../http-client.js";
import { checkHealth, ping } from "../health.js";
import { createIntegrationClient } from "./integration-helpers.js";

const client: IrisHttpClient = createIntegrationClient();

afterAll(() => {
  client.destroy();
});

describe.skipIf(!globalThis.__IRIS_AVAILABLE__)(
  "Health Check Integration",
  () => {
    it("checkHealth(client) succeeds against a running IRIS instance", async () => {
      // checkHealth resolves silently on success; throws on failure.
      await expect(checkHealth(client)).resolves.toBeUndefined();
    });

    it("ping(client) returns true against a running IRIS instance", async () => {
      const result = await ping(client);
      expect(result).toBe(true);
    });
  },
);
