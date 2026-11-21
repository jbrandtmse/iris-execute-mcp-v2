/**
 * Vitest setupFile for integration tests.
 *
 * Runs before any test file is loaded and stores the availability of the live
 * IRIS instance on `globalThis` so that `describe.skipIf()` can reference it
 * synchronously at module load time. The integration run is opt-in: unless
 * `IRIS_REQUIRE_LIVE` is `1` or `true`, the flag is `false` without a request,
 * so every integration test skips. Armed, the target is the five `IRIS_*`
 * variables (all required, none defaulted; a missing one fails the run naming
 * it) and the flag reports whether that instance answers.
 */

import { isIrisAvailable } from "./integration-helpers.js";

declare global {
  var __IRIS_AVAILABLE__: boolean;
}

globalThis.__IRIS_AVAILABLE__ = await isIrisAvailable();
