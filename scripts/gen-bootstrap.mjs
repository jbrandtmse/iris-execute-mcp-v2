import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Classes in compilation order: Utils first (no deps), then Setup (depends on Utils),
// then handlers (depend on Utils), then Dispatch last (references all handlers in UrlMap)
const classes = [
  { name: 'ExecuteMCPv2.Utils.cls', path: 'src/ExecuteMCPv2/Utils.cls' },
  { name: 'ExecuteMCPv2.Setup.cls', path: 'src/ExecuteMCPv2/Setup.cls' },
  { name: 'ExecuteMCPv2.REST.Global.cls', path: 'src/ExecuteMCPv2/REST/Global.cls' },
  { name: 'ExecuteMCPv2.REST.Command.cls', path: 'src/ExecuteMCPv2/REST/Command.cls' },
  { name: 'ExecuteMCPv2.REST.UnitTest.cls', path: 'src/ExecuteMCPv2/REST/UnitTest.cls' },
  { name: 'ExecuteMCPv2.REST.Config.cls', path: 'src/ExecuteMCPv2/REST/Config.cls' },
  { name: 'ExecuteMCPv2.REST.Security.cls', path: 'src/ExecuteMCPv2/REST/Security.cls' },
  { name: 'ExecuteMCPv2.REST.Interop.cls', path: 'src/ExecuteMCPv2/REST/Interop.cls' },
  { name: 'ExecuteMCPv2.REST.Monitor.cls', path: 'src/ExecuteMCPv2/REST/Monitor.cls' },
  { name: 'ExecuteMCPv2.REST.Task.cls', path: 'src/ExecuteMCPv2/REST/Task.cls' },
  { name: 'ExecuteMCPv2.REST.SystemConfig.cls', path: 'src/ExecuteMCPv2/REST/SystemConfig.cls' },
  { name: 'ExecuteMCPv2.REST.Analytics.cls', path: 'src/ExecuteMCPv2/REST/Analytics.cls' },
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
// gen-bootstrap.mjs replaces it with the real hash in the in-memory copy
// before embedding the class into bootstrap-classes.ts. The disk version
// keeps "dev" so that local iris_doc_load deployments of Setup.cls compile
// without extra steps.
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

// Step 2: Compute the bootstrap version hash.
// Short SHA-256 (first 12 hex chars) of the concatenated class content.
// Any change to any .cls file — even a single character — produces a new
// hash, so the version stamp auto-bumps on every `npm run gen:bootstrap`
// run. Developers never set this by hand.
const hasher = createHash('sha256');
for (const content of rawContents) {
  hasher.update(content);
  hasher.update('\n--CLASS-SEPARATOR--\n');
}
const BOOTSTRAP_VERSION = hasher.digest('hex').substring(0, 12);

// Step 3: Inject the hash into the in-memory copy of Setup.cls.
// The disk file has `Parameter BOOTSTRAPVERSION = "dev";` as a placeholder.
// We swap it for the real hash ONLY in the embedded copy — disk stays clean.
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

// Step 4: Emit bootstrap-classes.ts with the hash-injected class contents
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
 * The BOOTSTRAP_VERSION export is a short SHA-256 hash of the concatenated
 * class content. The bootstrap flow compares this value against the version
 * stamp baked into the deployed Setup.cls to detect drift and trigger
 * automatic redeployment of stale classes. See packages/shared/src/bootstrap.ts
 * for the upgrade logic.
 */

/**
 * Bootstrap version stamp — short SHA-256 hash of concatenated class content.
 *
 * Auto-bumps on every \`npm run gen:bootstrap\` run when any class file
 * changes. Compared against \`ExecuteMCPv2.Setup_GetBootstrapVersion()\` at
 * MCP server startup to detect stale deployments.
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

const outPath = resolve(root, 'packages/shared/src/bootstrap-classes.ts');
writeFileSync(outPath, output, 'utf-8');
console.log(`Generated ${outPath} with ${classes.length} classes`);
console.log(`BOOTSTRAP_VERSION: ${BOOTSTRAP_VERSION}`);
console.log('Classes in order:', classes.map(c => c.name).join(', '));
