#!/usr/bin/env node

/**
 * `iris-mcp-governance` — executable entry point.
 *
 * Thin wiring only (mirrors `credentials-cli.ts`): all real logic lives in
 * the importable, unit-testable `governance.ts` sibling module. Runnable
 * directly from the built `dist/` output with no dev-only shims (AC 32.1.3's
 * dist smoke and the packaging test both execute THIS file).
 */

import { runCli } from "./governance.js";

runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `iris-mcp-governance: unexpected error — ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
