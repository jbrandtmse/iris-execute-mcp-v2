// ----------------------------------------------------------------------------
// check-provenance.mjs (Story 41.1)
//
// Checks that adapted third-party content in the skills pack carries its licence and attribution (AD-28):
//
//   - the MIT block of skills-pack-src/IRIS-MCP-THIRD-PARTY-NOTICES.md is byte-exact to the upstream
//     LICENSE (pinned sha256 and length);
//   - the notice names the upstream commit and both authors, carries the non-endorsement sentence and the
//     provenance table, and equals the copy in the pack;
//   - every agent content file that mentions iris-agentic-dev carries the adaptation header as its first
//     non-blank line after any frontmatter, and has a provenance row;
//   - every provenance row names a pack file that exists and carries the header, and cites no excluded
//     upstream source;
//   - every agent file at skills/<name>/SKILL.md (a workflow skill, a knowledge source or a pack copy)
//     opens with frontmatter on its first line that holds a valid name and description and, optionally,
//     a valid metadata map (its one key is iris-tools-preset; rule skill-frontmatter);
//   - every npm tarball that carries pack or adapted content also carries the notice, and the client-config
//     tarball carries every pack file.
//
// The rules live in scripts/lib/provenance-core.mjs and are imported by this script and by the default-suite
// test packages/iris-mcp-all/src/__tests__/pack-provenance.test.ts. The tarball file lists come from npm's
// own packer (`npm pack --dry-run --json --ignore-scripts --offline`); the check fails closed when it cannot
// gather one.
//
// USAGE:
//   node scripts/check-provenance.mjs
//   npm: `pnpm check:provenance`
//
// Requires a prior `pnpm turbo run build`: a package that ships dist must list dist files in its tarball.
// ----------------------------------------------------------------------------

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { checkProvenance, provenanceSummary } from './lib/provenance-core.mjs';
import { gatherProvenanceInputs } from './lib/provenance-inputs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const inputs = gatherProvenanceInputs(root);
const problems = checkProvenance(inputs);

if (problems.length > 0) {
  console.error('check-provenance: found provenance problems:');
  for (const problem of problems) {
    console.error(`  - [${problem.rule}] ${problem.label}: ${problem.message}`);
  }
  console.error('');
  console.error(
    'Fix the sources in skills-pack-src/ (or the package manifest), run "pnpm gen:pack", then re-run "pnpm check:provenance".',
  );
  console.error(
    'A workflow skill is generated from its prompt in packages/*-mcp/src/prompts/: fix the prompt, then run "pnpm gen:skills" and "pnpm gen:pack".',
  );
  process.exit(1);
}

const summary = provenanceSummary(inputs);
console.log(
  `check-provenance: OK \u2014 MIT block sha256 ${summary.mitSha256} (${summary.mitBytes} bytes), ` +
    `${summary.rows} provenance row(s), ${summary.agentFiles} agent file(s), ${summary.distributions} distribution(s).`,
);
process.exit(0);
