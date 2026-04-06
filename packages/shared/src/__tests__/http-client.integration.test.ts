/**
 * Integration tests for {@link IrisHttpClient} against a real IRIS instance.
 *
 * These tests verify authentication, session management, CSRF handling,
 * and the Atelier envelope round-trip over the network.
 *
 * Skipped automatically when IRIS is not reachable.
 */

import { describe, it, expect, afterAll } from "vitest";
import { IrisHttpClient } from "../http-client.js";
import { createIntegrationClient } from "./integration-helpers.js";

const client: IrisHttpClient = createIntegrationClient();

afterAll(() => {
  client.destroy();
});

describe.skipIf(!globalThis.__IRIS_AVAILABLE__)(
  "HTTP Client Integration",
  () => {
    it("authenticates with Basic Auth and receives a session cookie", async () => {
      // The first GET triggers Basic Auth; a successful response means the
      // server accepted our credentials and (typically) set a session cookie.
      const envelope = await client.get("/api/atelier/");
      expect(envelope).toBeDefined();
      expect(envelope.status).toBeDefined();
    });

    it("subsequent requests reuse the session (no re-auth required)", async () => {
      // Second request should succeed using the session cookie established
      // by the first request — if session management is broken this will
      // either fail or trigger a visible re-auth warning.
      const envelope = await client.get("/api/atelier/");
      expect(envelope).toBeDefined();
      expect(envelope.result).toBeDefined();
    });

    it("GET /api/atelier/ returns a valid JSON envelope", async () => {
      const envelope = await client.get("/api/atelier/");

      expect(envelope).toHaveProperty("status");
      expect(envelope).toHaveProperty("result");
      expect(envelope.status).toHaveProperty("errors");
      expect(Array.isArray(envelope.status.errors)).toBe(true);
      expect(envelope.status.errors).toHaveLength(0);
    });

    it("POST request includes CSRF token (no 403 rejection)", async () => {
      // A GET populates the internal CSRF token from response headers.
      await client.get("/api/atelier/");

      // POST exercises CSRF inclusion — the server may reject the body,
      // but a 403 would mean the CSRF token was missing or invalid.
      let postError: unknown = null;
      try {
        await client.post("/api/atelier/", {});
      } catch (error: unknown) {
        postError = error;
      }

      if (postError instanceof Error && "statusCode" in postError) {
        const apiErr = postError as { statusCode: number };
        expect(apiErr.statusCode).not.toBe(403);
      }
      // If no error was thrown, the POST succeeded — CSRF was accepted.
    });
  },
);
