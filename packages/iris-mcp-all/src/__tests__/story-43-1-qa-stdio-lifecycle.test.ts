/**
 * Story 43.1 QA (AC 43.1.3, AD-23, AD-32; project rules #22, #59) - a BUILT server ends when its client closes stdin.
 *
 * An MCP client that is done with a stdio server closes its stdin and expects the process to leave. The SDK v1 transport left it to
 * the event loop: the process exits as soon as stdin ends and nothing else is pending. The v2 transport and the owned handlers
 * must keep that, or every client session would leak a server process. This file starts each built server against the fake IRIS
 * of `scripts/lib/fake-iris-listener.mjs` (a listener on 127.0.0.1 inside this process; no IRIS instance is reached), makes one tool call so
 * that the server holds a keep-alive connection to the listener, closes stdin, and requires an exit with code 0 that the test did not
 * cause (no kill, no signal) within a few seconds.
 *
 * The file fails, never skips, when a dist is missing or older than its source.
 */

import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./pack-fixture";
import { startFakeIris } from "../../../../scripts/lib/fake-iris-listener.mjs";
import { handlerExchanges, readBootstrapVersion } from "../../../../scripts/lib/sdk-handler-golden-core.mjs";
import {
  CLOSED_PORT_ENV,
  GOLDEN_PACKAGES,
  WIRE_ERA,
  handshake,
  inheritedGoldenEnv,
  openRawWire,
} from "../../../../scripts/lib/sdk-wire-golden-core.mjs";
import { distEntry, staleDistReason } from "./process-gate-helpers.js";

/**
 * Milliseconds a server may take to leave after its stdin is closed. Shorter than the fake listener's keep-alive timeout (Node's
 * default, 5 s), so a process held up by its open connection to the listener is still running when the window ends.
 */
const EXIT_WITHIN_MS = 3_000;

describe.each(GOLDEN_PACKAGES)("stdio lifecycle: %s", (pkg) => {
  it("exits with code 0 by itself when its client closes stdin, after serving a call that reached IRIS", async () => {
    const stale = ["shared", pkg].map((name) => [name, staleDistReason(REPO_ROOT, name)] as const).filter(([, reason]) => reason !== undefined);
    if (stale.length > 0) throw new Error(`Build the packages first: ${stale.map(([name, reason]) => `${name}: ${reason}`).join("; ")}`);

    const fake = await startFakeIris({ bootstrapVersion: readBootstrapVersion(REPO_ROOT) });
    const wire = openRawWire({
      entry: distEntry(REPO_ROOT, pkg),
      env: { ...inheritedGoldenEnv(process.env), ...CLOSED_PORT_ENV, IRIS_PORT: String(fake.port) },
    });
    try {
      await handshake(wire, WIRE_ERA, "story-43-1-qa-stdio-lifecycle");
      const exchange = handlerExchanges(pkg)[0];
      const before = fake.requests.length;
      const answered = await wire.request(exchange.method, exchange.params);
      expect(answered.message.result, "the call was served").toBeDefined();
      expect(fake.requests.length, "the call reached the listener, so the server holds a connection to it").toBeGreaterThan(before);

      wire.endInput();
      const outcome = await Promise.race([
        wire.exit(),
        new Promise<"still running">((resolve) => setTimeout(() => resolve("still running"), EXIT_WITHIN_MS)),
      ]);
      expect(outcome, `the server was still running ${EXIT_WITHIN_MS} ms after its stdin was closed; stderr: ${wire.stderr().slice(-400)}`).toEqual({ code: 0, signal: null });
      expect(wire.stderr()).not.toContain("Fatal");
    } finally {
      await wire.close();
      await fake.close();
    }
  }, 60_000);
});
