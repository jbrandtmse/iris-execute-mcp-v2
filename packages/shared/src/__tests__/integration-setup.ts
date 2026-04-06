/**
 * Vitest setupFile for integration tests.
 *
 * Runs before any test file is loaded, probes whether IRIS is reachable,
 * and stores the result on `globalThis` so that `describe.skipIf()` can
 * reference it synchronously at module load time.
 */

import { isIrisAvailable } from "./integration-helpers.js";

declare global {
  var __IRIS_AVAILABLE__: boolean;
}

globalThis.__IRIS_AVAILABLE__ = await isIrisAvailable();
