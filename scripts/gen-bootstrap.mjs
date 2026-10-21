import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Classes in compilation order: Utils first (no deps), then Setup (depends on Utils),
// then the Diagram library (models first; facade referenced by REST/Interop.cls),
// then REST/Base.cls (Story 34.4 — must precede every class extending it), then
// handlers (depend on Utils, and — since Story 34.4 — on REST/Base.cls),
// then Dispatch last (references all handlers in UrlMap)
const classes = [
  { name: 'ExecuteMCPv2.Utils.cls', path: 'src/ExecuteMCPv2/Utils.cls' },
  { name: 'ExecuteMCPv2.Setup.cls', path: 'src/ExecuteMCPv2/Setup.cls' },
  { name: 'ExecuteMCPv2.Diagram.Event.cls', path: 'src/ExecuteMCPv2/Diagram/Event.cls' },
  { name: 'ExecuteMCPv2.Diagram.RenderEvent.cls', path: 'src/ExecuteMCPv2/Diagram/RenderEvent.cls' },
  { name: 'ExecuteMCPv2.Diagram.Loader.cls', path: 'src/ExecuteMCPv2/Diagram/Loader.cls' },
  { name: 'ExecuteMCPv2.Diagram.Correlator.cls', path: 'src/ExecuteMCPv2/Diagram/Correlator.cls' },
  { name: 'ExecuteMCPv2.Diagram.Compressor.cls', path: 'src/ExecuteMCPv2/Diagram/Compressor.cls' },
  { name: 'ExecuteMCPv2.Diagram.Writer.cls', path: 'src/ExecuteMCPv2/Diagram/Writer.cls' },
  { name: 'ExecuteMCPv2.Diagram.Generate.cls', path: 'src/ExecuteMCPv2/Diagram/Generate.cls' },
  { name: 'ExecuteMCPv2.Loc.Classifier.cls', path: 'src/ExecuteMCPv2/Loc/Classifier.cls' },
  { name: 'ExecuteMCPv2.Loc.Scanner.cls', path: 'src/ExecuteMCPv2/Loc/Scanner.cls' },
  { name: 'ExecuteMCPv2.Loc.Generate.cls', path: 'src/ExecuteMCPv2/Loc/Generate.cls' },
  { name: 'ExecuteMCPv2.Coverage.Job.cls', path: 'src/ExecuteMCPv2/Coverage/Job.cls' },
  { name: 'ExecuteMCPv2.Coverage.Runner.cls', path: 'src/ExecuteMCPv2/Coverage/Runner.cls' },
  { name: 'ExecuteMCPv2.REST.Base.cls', path: 'src/ExecuteMCPv2/REST/Base.cls' },
  { name: 'ExecuteMCPv2.REST.Global.cls', path: 'src/ExecuteMCPv2/REST/Global.cls' },
  { name: 'ExecuteMCPv2.REST.Command.cls', path: 'src/ExecuteMCPv2/REST/Command.cls' },
  { name: 'ExecuteMCPv2.REST.UnitTest.cls', path: 'src/ExecuteMCPv2/REST/UnitTest.cls' },
  { name: 'ExecuteMCPv2.REST.Config.cls', path: 'src/ExecuteMCPv2/REST/Config.cls' },
  { name: 'ExecuteMCPv2.REST.Security.cls', path: 'src/ExecuteMCPv2/REST/Security.cls' },
  { name: 'ExecuteMCPv2.REST.Interop.cls', path: 'src/ExecuteMCPv2/REST/Interop.cls' },
  { name: 'ExecuteMCPv2.REST.MessageResend.cls', path: 'src/ExecuteMCPv2/REST/MessageResend.cls' },
  { name: 'ExecuteMCPv2.REST.MessageSearch.cls', path: 'src/ExecuteMCPv2/REST/MessageSearch.cls' },
  { name: 'ExecuteMCPv2.REST.MessageBody.cls', path: 'src/ExecuteMCPv2/REST/MessageBody.cls' },
  { name: 'ExecuteMCPv2.REST.Loc.cls', path: 'src/ExecuteMCPv2/REST/Loc.cls' },
  { name: 'ExecuteMCPv2.REST.Monitor.cls', path: 'src/ExecuteMCPv2/REST/Monitor.cls' },
  { name: 'ExecuteMCPv2.REST.Health.cls', path: 'src/ExecuteMCPv2/REST/Health.cls' },
  { name: 'ExecuteMCPv2.REST.EnvSync.cls', path: 'src/ExecuteMCPv2/REST/EnvSync.cls' },
  { name: 'ExecuteMCPv2.REST.Task.cls', path: 'src/ExecuteMCPv2/REST/Task.cls' },
  { name: 'ExecuteMCPv2.REST.SystemConfig.cls', path: 'src/ExecuteMCPv2/REST/SystemConfig.cls' },
  { name: 'ExecuteMCPv2.REST.Analytics.cls', path: 'src/ExecuteMCPv2/REST/Analytics.cls' },
  { name: 'ExecuteMCPv2.REST.SqlAdvisor.cls', path: 'src/ExecuteMCPv2/REST/SqlAdvisor.cls' },
  { name: 'ExecuteMCPv2.REST.Sql.cls', path: 'src/ExecuteMCPv2/REST/Sql.cls' },
  { name: 'ExecuteMCPv2.REST.Coverage.cls', path: 'src/ExecuteMCPv2/REST/Coverage.cls' },
  { name: 'ExecuteMCPv2.REST.Dispatch.cls', path: 'src/ExecuteMCPv2/REST/Dispatch.cls' },
];

function escapeForTemplateLiteral(content) {
  // Escape backslashes, backticks, and ${ sequences for JS template literals
  return content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

// Placeholder string that lives in src/ExecuteMCPv2/Setup.cls on disk.
// gen-bootstrap.mjs replaces it with the real marker in the in-memory copy
// before embedding the class into bootstrap-classes.ts. The disk version
// keeps "dev" so that local iris_doc_load deployments of Setup.cls compile
// without extra steps; the bootstrap treats a deployed "dev" as foreign and
// never redeploys over it.
const VERSION_PLACEHOLDER_LINE = 'Parameter BOOTSTRAPVERSION = "dev";';

// Step 1: Read all class files into memory.
// CRLF → LF normalization is CRITICAL here, for two reasons:
//
//   1. JavaScript template literals normalize CRLF to LF at parse time
//      (per the ECMAScript spec), so embedded class content would
//      silently drift from the disk bytes on Windows even though the
//      runtime string matches the LF-normalized form.
//
//   2. The BOOTSTRAP_VERSION hash must be platform-independent: a
//      Windows contributor with CRLF .cls files and a Linux contributor
//      with LF files must compute the same hash from identical content.
//
// We trim trailing whitespace AFTER normalizing so the file doesn't end
// with a stray \n left over from a trimmed-but-not-removed \r.
const rawContents = classes.map((cls) => {
  const filePath = resolve(root, cls.path);
  return readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n').trimEnd();
});

// Step 2: Compute the content hash.
// Short SHA-256 (first 12 hex chars) of the concatenated class content, taken over
// the on-disk content, so it does not depend on the semver or the sequence the
// marker carries. Any change to any .cls file, even a single character, produces a
// new hash. Developers never set it by hand.
const hasher = createHash('sha256');
for (const content of rawContents) {
  hasher.update(content);
  hasher.update('\n--CLASS-SEPARATOR--\n');
}
const CONTENT_HASH = hasher.digest('hex').substring(0, 12);

// Step 2b: Build the marker `<semver>+<sequence>.<hash>`.
//   semver    the version of @iris-mcp/shared (packages/shared/package.json).
//   sequence  rises by exactly 1 whenever the content hash differs from the hash
//             recorded in scripts/bootstrap-sequence.json, and never falls. A
//             merge conflict in that file is resolved by keeping the higher
//             sequence and rerunning this generator.
//   hash      the content hash above.
// The marker orders deployments (packages/shared/src/bootstrap-version.ts): a build
// never redeploys over a newer or foreign deployment.
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const sharedManifest = JSON.parse(readFileSync(resolve(root, 'packages/shared/package.json'), 'utf-8'));
const SEMVER = sharedManifest.version;
if (typeof SEMVER !== 'string' || !SEMVER_PATTERN.test(SEMVER)) {
  throw new Error(
    `gen-bootstrap: packages/shared/package.json version "${SEMVER}" is not MAJOR.MINOR.PATCH ` +
    'with digits only; the bootstrap marker needs exactly that.',
  );
}

const sequenceStatePath = resolve(root, 'scripts/bootstrap-sequence.json');
if (!existsSync(sequenceStatePath)) {
  throw new Error(
    'gen-bootstrap: scripts/bootstrap-sequence.json is missing; restore it from git; the sequence never goes backwards.',
  );
}
let sequenceState;
try {
  sequenceState = JSON.parse(readFileSync(sequenceStatePath, 'utf-8'));
} catch (error) {
  throw new Error(`gen-bootstrap: scripts/bootstrap-sequence.json is not valid JSON (${error.message}); restore it from git.`);
}
if (
  !Number.isSafeInteger(sequenceState.sequence) ||
  sequenceState.sequence < 0 ||
  typeof sequenceState.hash !== 'string' ||
  !/^([0-9a-f]{12})?$/.test(sequenceState.hash)
) {
  throw new Error(
    'gen-bootstrap: scripts/bootstrap-sequence.json must be {"sequence": <non-negative integer>, "hash": "<12 hex or empty>"}.',
  );
}
let sequenceChanged = false;
let SEQUENCE = sequenceState.sequence;
if (sequenceState.hash !== CONTENT_HASH) {
  SEQUENCE += 1;
  sequenceChanged = true;
}
const BOOTSTRAP_VERSION = `${SEMVER}+${SEQUENCE}.${CONTENT_HASH}`;

// Step 3: Inject the marker into the in-memory copy of Setup.cls.
// The disk file has `Parameter BOOTSTRAPVERSION = "dev";` as a placeholder.
// We swap it for the real marker ONLY in the embedded copy; disk stays clean.
const setupIndex = classes.findIndex((c) => c.name === 'ExecuteMCPv2.Setup.cls');
if (setupIndex < 0) {
  throw new Error('gen-bootstrap: could not find Setup.cls in class list');
}
if (!rawContents[setupIndex].includes(VERSION_PLACEHOLDER_LINE)) {
  throw new Error(
    `gen-bootstrap: placeholder not found in Setup.cls.\n` +
    `Expected exactly: ${VERSION_PLACEHOLDER_LINE}\n` +
    `Make sure src/ExecuteMCPv2/Setup.cls contains this line literally.`,
  );
}
rawContents[setupIndex] = rawContents[setupIndex].replace(
  VERSION_PLACEHOLDER_LINE,
  `Parameter BOOTSTRAPVERSION = "${BOOTSTRAP_VERSION}";`,
);

// Step 4: Emit bootstrap-classes.ts with the marker-injected class contents
// and a BOOTSTRAP_VERSION export.
let output = `/**
 * Embedded ObjectScript class content for the ExecuteMCPv2 REST service.
 *
 * Contains all ${classes.length} production classes as string literals, keyed by their
 * document name (e.g. "ExecuteMCPv2.Utils.cls"). These are deployed to
 * IRIS via the Atelier PUT /doc endpoint during bootstrap.
 *
 * This file is auto-generated from the src/ExecuteMCPv2/ directory.
 * Do not edit the class content manually.
 *
 * The BOOTSTRAP_VERSION export is the marker \`<semver>+<sequence>.<hash>\`:
 * the version of @iris-mcp/shared, a sequence that scripts/bootstrap-sequence.json
 * raises by one whenever the content hash changes, and a short SHA-256 hash of the
 * concatenated class content. The bootstrap flow reads the marker stamped into the
 * deployed Setup.cls and redeploys only an absent or older deployment; a newer or
 * foreign deployment is left in place with a warning. See
 * packages/shared/src/bootstrap-version.ts for the ordering and
 * packages/shared/src/bootstrap.ts for the upgrade logic.
 */

/**
 * Bootstrap version marker \`<semver>+<sequence>.<hash>\`.
 *
 * Moves only through \`pnpm gen:bootstrap\`: the hash changes with any class file,
 * the sequence rises by one with it, and the semver follows
 * packages/shared/package.json. Compared against
 * \`ExecuteMCPv2.Setup_GetBootstrapVersion()\` at MCP server startup.
 */
export const BOOTSTRAP_VERSION = "${BOOTSTRAP_VERSION}";

export interface BootstrapClass {
  name: string;
  content: string;
}

export const BOOTSTRAP_CLASSES: Map<string, string> = new Map([
`;

for (let i = 0; i < classes.length; i++) {
  const cls = classes[i];
  const content = rawContents[i];
  const escaped = escapeForTemplateLiteral(content);

  output += `  [\n    "${cls.name}",\n    \`${escaped}\`,\n  ]`;
  if (i < classes.length - 1) {
    output += ',';
  }
  output += '\n';
}

output += `]);

/**
 * Return all bootstrap classes in compilation order.
 *
 * Utils and Setup are compiled first (no handler dependencies),
 * then the individual REST handler classes, and finally Dispatch
 * which references all handlers in its UrlMap.
 */
export function getBootstrapClasses(): BootstrapClass[] {
  return [...BOOTSTRAP_CLASSES.entries()].map(([name, content]) => ({
    name,
    content,
  }));
}
`;

// Step 5: Write only when the output differs from the file on disk. The shared
// dist's freshness check is mtime-based, so rewriting an identical embed would
// make a clean dist look stale.
// The sequence state is written first, so a failed embed write leaves a state that the
// next run reuses unchanged instead of one that raises the sequence twice.
if (sequenceChanged) {
  writeFileSync(sequenceStatePath, `{"sequence": ${SEQUENCE}, "hash": "${CONTENT_HASH}"}\n`, 'utf-8');
}
const outPath = resolve(root, 'packages/shared/src/bootstrap-classes.ts');
const unchanged = existsSync(outPath) && readFileSync(outPath, 'utf-8') === output;
if (unchanged) {
  console.log(`Unchanged ${outPath} with ${classes.length} classes (not rewritten)`);
  console.log(`BOOTSTRAP_VERSION: ${BOOTSTRAP_VERSION}`);
} else {
  writeFileSync(outPath, output, 'utf-8');
  console.log(`Generated ${outPath} with ${classes.length} classes`);
  console.log(`BOOTSTRAP_VERSION: ${BOOTSTRAP_VERSION}`);
  console.log('Classes in order:', classes.map(c => c.name).join(', '));
}
