#!/usr/bin/env node

/**
 * `iris-mcp-credentials` — executable entry point.
 *
 * Thin wiring only (mirrors the `src/index.ts` pattern of the five server
 * packages, e.g. `packages/iris-dev-mcp/src/index.ts`): all real logic lives
 * in the importable, unit-testable `credentials.ts` sibling module. Runnable
 * directly from the built `dist/` output with no dev-only shims (AC 31.2.3's
 * lead smoke gate depends on this).
 */

import { runCli } from "./credentials.js";

runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `iris-mcp-credentials: unexpected error — ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
