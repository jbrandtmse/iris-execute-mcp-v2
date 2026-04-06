/**
 * Integration tests for error scenarios against a real (or unreachable) IRIS instance.
 *
 * These tests deliberately use bad credentials and unreachable hosts to verify
 * that the client produces the correct error types with actionable messages.
 *
 * The "invalid credentials" test is skipped when IRIS is unavailable because
 * we need a running server to distinguish auth failures from connection failures.
 * The connection-error tests run unconditionally since they target unreachable hosts.
 */

import { describe, it, expect } from "vitest";
import { IrisApiError, IrisConnectionError } from "../errors.js";
import { createIntegrationClient } from "./integration-helpers.js";

// ── Invalid credentials (requires running IRIS) ────────────────────

describe.skipIf(!globalThis.__IRIS_AVAILABLE__)(
  "Error Scenarios — Invalid Credentials",
  () => {
    it("throws IrisApiError with invalid credentials", async () => {
      const badClient = createIntegrationClient({
        IRIS_PASSWORD: "DEFINITELY_WRONG_PASSWORD",
      });

      try {
        await expect(
          badClient.get("/api/atelier/"),
        ).rejects.toThrow(IrisApiError);
      } finally {
        badClient.destroy();
      }
    });
  },
);

// ── Connection errors (no IRIS required) ───────────────────────────

describe("Error Scenarios — Connection Errors", () => {
  it("throws IrisConnectionError for invalid host within 2 seconds", async () => {
    // 192.0.2.1 is a documentation-only IP (RFC 5737) — guaranteed non-routable.
    const badClient = createIntegrationClient(
      { IRIS_HOST: "192.0.2.1" },
      2000, // 2-second timeout
    );

    const start = Date.now();
    try {
      await expect(
        badClient.get("/api/atelier/"),
      ).rejects.toThrow(IrisConnectionError);
    } finally {
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(3000); // AC requires within 2s; 3s allows minor overhead
      badClient.destroy();
    }
  });

  it("throws IrisConnectionError for invalid port", async () => {
    const badClient = createIntegrationClient(
      { IRIS_PORT: "1" }, // port 1 is almost certainly not running IRIS
      2000,
    );

    try {
      await expect(
        badClient.get("/api/atelier/"),
      ).rejects.toThrow(IrisConnectionError);
    } finally {
      badClient.destroy();
    }
  });
});
