#!/usr/bin/env node

/**
 * `iris-mcp-clients` — executable entry point.
 *
 * Thin wiring only (mirrors `governance-cli.ts` in `@iris-mcp/shared`): all
 * real logic lives in the importable, unit-testable `clients.ts` sibling
 * module. Runnable directly from the built `dist/` output with no dev-only
 * shims (the AC 33.2.2 dist smoke executes THIS file).
 */

import { runCli } from "./clients.js";

runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `iris-mcp-clients: unexpected error — ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
