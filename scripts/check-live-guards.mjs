// check-live-guards.mjs (Story 44.5, DW-684): refuses a test in an armed CI suite that can pass without testing.
//
// CONTRACT
//   - It scans every test file that `coveredTestFiles()` (`scripts/lib/ci-checks.mjs`) returns, with rules G and C of
//     `scripts/lib/live-guard-scan.mjs`: a `return` that ends a test early without a skip, and an `if` on `.isError` or
//     `created.` whose then-branch does not end loudly.
//   - It prints each finding as `<file>:<line> <rule> <text>`, then one summary line, `<n> armed files, <k> findings`.
//   - It exits 1 on any finding and 0 otherwise. It reads files and writes nothing.
//   - `main(argv, deps)` is the whole program; it runs only when this file is the entry point, so importing it runs nothing.
//
// USAGE
//   node scripts/check-live-guards.mjs
//   npm: `pnpm check:live-guards` (a step of the `gates` job, and a root check of the release `prepare`)

import { coveredTestFiles } from './lib/ci-checks.mjs';
import { liveGuardFindings } from './lib/live-guard-scan.mjs';
import { isEntryPoint } from './lib/script-process.mjs';

/**
 * @param {readonly string[]} [argv] unused: the check takes no option
 * @param {{ files?: readonly string[], read?: (file: string) => string, out?: (line: string) => void }} [deps]
 * @returns {number} the exit code
 */
export function main(argv = [], { files = coveredTestFiles(), read, out = (line) => console.log(line) } = {}) {
  void argv;
  const findings = liveGuardFindings({ files, ...(read ? { read } : {}) });
  for (const finding of findings) out(`${finding.file}:${finding.line} ${finding.rule} ${finding.text}`);
  out(`${files.length} armed files, ${findings.length} findings`);
  if (findings.length > 0) {
    out(
      'check-live-guards: an armed test must assert, or skip loudly. Rule G is a `return` that ends a test early; rule C is an `if` on `.isError` or `created.` ' +
        'that does not throw. Assert the precondition with expect(...), or skip with the test context (ci-live-suite.mjs lists every skip).',
    );
    return 1;
  }
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
