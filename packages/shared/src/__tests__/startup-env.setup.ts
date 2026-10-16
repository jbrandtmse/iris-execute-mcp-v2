/**
 * Vitest `setupFiles` entry for every package's default suite.
 *
 * Runs before each test file is imported, so a variable the code reads once at
 * import time (`LOG_LEVEL` in `logger.ts`) is already clear when it is read.
 * It removes the operator's startup variables from the test process; the
 * connection variables stay (they are the live gates' target, and the harness
 * in `env-harness.ts` defaults them per test).
 */

import { scrubStartupEnv } from "./startup-env.js";

scrubStartupEnv();
