import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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
  { name: 'ExecuteMCPv2.REST.Dispatch.cls', path: 'src/ExecuteMCPv2/REST/Dispatch.cls' },
];

function escapeForTemplateLiteral(content) {
  // Escape backslashes, backticks, and ${ sequences for JS template literals
  return content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

let output = `/**
 * Embedded ObjectScript class content for the ExecuteMCPv2 REST service.
 *
 * Contains all ${classes.length} production classes as string literals, keyed by their
 * document name (e.g. "ExecuteMCPv2.Utils.cls"). These are deployed to
 * IRIS via the Atelier PUT /doc endpoint during bootstrap.
 *
 * This file is auto-generated from the src/ExecuteMCPv2/ directory.
 * Do not edit the class content manually.
 */

export interface BootstrapClass {
  name: string;
  content: string;
}

export const BOOTSTRAP_CLASSES: Map<string, string> = new Map([
`;

for (let i = 0; i < classes.length; i++) {
  const cls = classes[i];
  const filePath = resolve(root, cls.path);
  let content = readFileSync(filePath, 'utf-8');
  // Remove trailing newlines from file content
  content = content.trimEnd();
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
console.log('Classes in order:', classes.map(c => c.name).join(', '));
