// The committed, stamped IPM tree (Story 42.8, decision #122; AD-14): the root `module.xml`, the stamped classes under `ipm/src/cls/`
// and the stamped install guard under `preload/ipm/src/cls/`. `scripts/gen-bootstrap.mjs --ipm` is the only writer. This module is
// pure: it imports only `node:` builtins, runs nothing on import, and reads only the paths it is given. The generator, the archive
// proof's staging and the tree check share it, so one path map and one manifest renderer serve all three.
//
// THE LAYOUT. IPM reads the manifest from the module root and preloaded classes only from `<root>/preload`, so two root entries are
// unavoidable. Resources resolve under `<root>/<SourcesRoot>`, here `ipm/src` (at most 20 characters, the limit of
// `%IPM.Storage.Module.SourcesRoot`). A preloaded item sits at `preload/` plus the sources root plus `/cls/...`, IPM's own `package`
// layout. IPM imports everything under `<root>/preload` recursively, so nothing but the guard may live there; and it runs
// `pip install -r <root>/requirements.txt` when that file exists, so the root holds none.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const IPM_SOURCES_ROOT = 'ipm/src';
export const IPM_PRELOAD_PREFIX = 'preload';
export const IPM_MANIFEST_FILE = 'module.xml';

/** The line that holds the stamped marker in a class (`Parameter BOOTSTRAPVERSION = "...";`), and the placeholder on disk. */
export const VERSION_PLACEHOLDER_LINE = 'Parameter BOOTSTRAPVERSION = "dev";';
const MARKER_LINE_PATTERN = /^Parameter BOOTSTRAPVERSION = "([^"]*)";$/m;
const MARKER_PATTERN = /^(\d+\.\d+\.\d+)\+(\d+)\.([0-9a-f]{12})$/;

/** The class whose marker the tree's Setup stamp is read from. */
const SETUP_DOCUMENT = 'ExecuteMCPv2.Setup.cls';

/** The remedy every refusal of a damaged tree ends with. */
const REPAIR = 'Run pnpm gen:ipm -- --force from a clean version commit, or restore it from git.';

// -- Paths and text ----------------------------------------------------------------------

/** `ExecuteMCPv2.REST.Base.cls` as the path segments `['ExecuteMCPv2', 'REST', 'Base.cls']`. */
export function classPathSegments(documentName) {
  const stem = String(documentName).replace(/\.cls$/, '');
  return [...stem.split('.').slice(0, -1), `${stem.split('.').at(-1)}.cls`];
}

/** The tree path of a class document, `ipm/src/cls/<package path>.cls`. */
export function classTreePath(documentName) {
  return [IPM_SOURCES_ROOT, 'cls', ...classPathSegments(documentName)].join('/');
}

/** The tree path of the preloaded guard, `preload/ipm/src/cls/<package path>.cls`. */
export function guardTreePath(documentName) {
  return [IPM_PRELOAD_PREFIX, IPM_SOURCES_ROOT, 'cls', ...classPathSegments(documentName)].join('/');
}

/** The line ends the embed and the tree are compared after: LF, with no trailing whitespace. */
export function normalizeText(text) {
  return String(text).replace(/\r\n/g, '\n').trimEnd();
}

const withNewline = (text) => (text.endsWith('\n') ? text : `${text}\n`);

/** The marker a class text stamps, or `undefined` when it has no `Parameter BOOTSTRAPVERSION` line. */
export function stampedMarker(content) {
  return MARKER_LINE_PATTERN.exec(content)?.[1];
}

/**
 * The content hash of the bootstrap marker: the first 12 hex characters of the SHA-256 over the unstamped contents, each followed by
 * a separator line. The generator and the tree check both compute it here, so the two cannot disagree on the formula.
 *
 * @param {readonly string[]} contents - The classes of `classes[]` in order, then the install guard, normalized and unstamped.
 */
export function contentHash(contents) {
  const hasher = createHash('sha256');
  for (const content of contents) {
    hasher.update(content);
    hasher.update('\n--CLASS-SEPARATOR--\n');
  }
  return hasher.digest('hex').substring(0, 12);
}

// -- The manifest -----------------------------------------------------------------------

/** Every `name="value"` attribute of one element tag, by name. */
function attributesOf(tag) {
  return Object.fromEntries([...tag.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

/** The text of the first `<Tag>text</Tag>` of an XML text, or `undefined`. */
function elementText(xml, tag) {
  return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1]?.trim();
}

/**
 * What a module manifest declares, read as text: the module name, version and sources root, each `<Resource>`'s name and `Preload`
 * flag, and each `<Invoke>`'s class, method, phase, moment and `CheckStatus`. IPM re-serializes a manifest on export (attribute order,
 * defaults, the default `<Packaging>`), so the comparison is over declarations and never over bytes. An absent `Phase` is `Configure`,
 * an absent `When` is `After`, an absent `Preload` is `false`, and an absent `CheckStatus` is `undefined` (`true` or `1` is `true`).
 *
 * @param {string} xml
 * @returns {{ name?: string, version?: string, sourcesRoot?: string, resources: Array<{ name: string, preload: boolean }>, invokes: Array<{ class: string, method: string, phase: string, when: string, checkStatus?: boolean }> }}
 */
export function manifestDeclarations(xml) {
  const text = String(xml).replace(/<!--[\s\S]*?-->/g, '');
  const tags = (element) => [...text.matchAll(new RegExp(`<${element}(\\s[^>]*)?/?>`, 'g'))].map((match) => attributesOf(match[0]));
  return {
    name: elementText(text, 'Name'),
    version: elementText(text, 'Version'),
    sourcesRoot: elementText(text, 'SourcesRoot'),
    resources: tags('Resource').map((attributes) => ({ name: attributes.Name, preload: attributes.Preload === 'true' })),
    invokes: tags('Invoke').map((attributes) => ({
      class: attributes.Class,
      method: attributes.Method,
      phase: attributes.Phase ?? 'Configure',
      when: attributes.When ?? 'After',
      checkStatus: attributes.CheckStatus === undefined ? undefined : /^(true|1)$/i.test(attributes.CheckStatus),
    })),
  };
}

function escapeForXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The text of the root `module.xml` for a module: the preloaded guard first, then the classes in compile order, then the three invokes.
 *
 * @param {{ moduleName: string, version: string, classNames: readonly string[], guardName: string, sourcesRoot?: string }} options -
 *   `classNames` and `guardName` are document names (`ExecuteMCPv2.Utils.cls`).
 * @returns {string}
 */
export function renderModuleXml({ moduleName, version, classNames, guardName, sourcesRoot = IPM_SOURCES_ROOT }) {
  const guardClass = guardName.replace(/\.cls$/, '');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Export generator="IRIS" version="26">',
    `  <Document name="${escapeForXml(moduleName)}.ZPM">`,
    '    <Module>',
    // An XML comment holds no double hyphen, so the generator's flag is named in words here.
    '      <!-- GENERATED by scripts/gen-bootstrap.mjs in its ipm mode, from classes[] and the IPM install guard. DO NOT EDIT: pnpm gen:ipm writes it, and only the version step (pnpm run version) runs it.',
    `           ${classNames.length + 1} resources: the preloaded ${guardClass} and the ${classNames.length} classes of classes[], in compile order. -->`,
    `      <Name>${escapeForXml(moduleName)}</Name>`,
    `      <Version>${escapeForXml(version)}</Version>`,
    '      <Description>Server-side classes and REST service (/api/executemcp/v2) for the IRIS MCP server suite. An independent community project.</Description>',
    '      <Keywords>mcp model-context-protocol rest ai developer-tools</Keywords>',
    '      <Packaging>module</Packaging>',
    `      <SourcesRoot>${escapeForXml(sourcesRoot)}</SourcesRoot>`,
    `      <Resource Name="${guardClass}.CLS" Preload="true"/>`,
    ...classNames.map((name) => `      <Resource Name="${escapeForXml(name.replace(/\.cls$/, '.CLS'))}"/>`),
    // CheckStatus makes IPM 0.10.0 to 0.10.4 act on the %Status that Check returns; IPM 0.10.5 and later check a %Status by default
    // and mark the property [Deprecated], but still read it. The ipm proof holds the built archive's manifest to carry it.
    `      <Invoke Class="${guardClass}" Method="Check" Phase="Initialize" When="After" CheckStatus="true"/>`,
    '      <Invoke Class="ExecuteMCPv2.Setup" Method="Configure"/>',
    '      <Invoke Class="ExecuteMCPv2.Setup" Method="ConfigureMapping"/>',
    '    </Module>',
    '  </Document>',
    '</Export>',
  ];
  return `${lines.join('\n')}\n`;
}

// -- The tree ---------------------------------------------------------------------------

/**
 * The class files of the tree for an embed, by path relative to the repository root: one `ipm/src/cls/<package path>.cls` per class
 * and the guard at `preload/ipm/src/cls/<package path>.cls`, each with a final newline. `module.xml` is not among them
 * ({@link renderModuleXml} writes it). This is the one function that maps an embed to tree paths.
 *
 * @param {{ classes: Iterable<[string, string]>, guard: { name: string, content: string } }} embed
 * @returns {Map<string, string>}
 */
export function ipmTreeFiles(embed) {
  const files = new Map();
  for (const [name, content] of embed.classes) files.set(classTreePath(name), withNewline(content));
  files.set(guardTreePath(embed.guard.name), withNewline(embed.guard.content));
  return files;
}

/** Every file under `directory` (which may not exist), relative to it, with forward slashes, in sorted order. */
function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
      else found.push(relative);
    }
  };
  walk(directory, '');
  return found.sort();
}

/**
 * What the repository holds of the tree: the root manifest's text (or `undefined`), every file under `ipm/src` and under `preload`
 * (path relative to `root`, with its text), and whether a root `requirements.txt` exists.
 *
 * @param {string} root
 * @returns {{ manifest: string | undefined, sourceFiles: Map<string, string>, preloadFiles: Map<string, string>, hasRequirements: boolean }}
 */
export function readIpmTree(root) {
  const manifestFile = path.join(root, IPM_MANIFEST_FILE);
  const collect = (prefix) => new Map(filesUnder(path.join(root, ...prefix.split('/'))).map((relative) => [`${prefix}/${relative}`, readFileSync(path.join(root, ...prefix.split('/'), ...relative.split('/')), 'utf8')]));
  return {
    manifest: existsSync(manifestFile) ? readFileSync(manifestFile, 'utf8') : undefined,
    sourceFiles: collect(IPM_SOURCES_ROOT),
    preloadFiles: collect(IPM_PRELOAD_PREFIX),
    hasRequirements: existsSync(path.join(root, 'requirements.txt')),
  };
}

/** The marker the tree's install guard stamps, or `undefined` when the tree has no stamped guard. */
export function ipmTreeMarker(root) {
  for (const [file, text] of readIpmTree(root).preloadFiles) {
    if (file.endsWith('.cls')) return stampedMarker(text);
  }
  return undefined;
}

/**
 * What is wrong with the committed tree. Empty means it is unedited generator output at the shared version:
 *  - the root `module.xml` equals {@link renderModuleXml} of the classes and guard it declares, at {@link IPM_SOURCES_ROOT};
 *  - every non-preload resource maps to exactly one file under `ipm/src`, and no other file is there;
 *  - `preload/` holds exactly the guard;
 *  - no test or fixture class, no `dev` placeholder, no root `requirements.txt`;
 *  - Setup and the guard stamp the same marker, whose semver is the manifest's `<Version>`, which is the shared version;
 *  - the content hash of the unstamped files, in resource order with the guard last, is the marker's hash.
 *
 * @param {string} root - The repository root.
 * @param {{ sharedVersion?: string, moduleName?: string }} [options] - `sharedVersion` defaults to the version of
 *   `packages/shared/package.json`; `moduleName`, when given, is the name the manifest must carry.
 * @returns {string[]}
 */
export function ipmTreeProblems(root, options = {}) {
  const tree = readIpmTree(root);
  if (tree.manifest === undefined) return [`${IPM_MANIFEST_FILE} is missing from the repository root, so IPM finds no module. Run pnpm gen:ipm.`];
  const problems = [];
  const declared = manifestDeclarations(tree.manifest);

  let sharedVersion = options.sharedVersion;
  if (sharedVersion === undefined) {
    const sharedManifest = path.join(root, 'packages', 'shared', 'package.json');
    if (existsSync(sharedManifest)) sharedVersion = JSON.parse(readFileSync(sharedManifest, 'utf8')).version;
  }

  const named = declared.resources.filter((resource) => typeof resource.name === 'string' && resource.name !== '');
  if (named.length !== declared.resources.length) {
    problems.push(`${IPM_MANIFEST_FILE} declares ${declared.resources.length - named.length} <Resource> with no Name, which the generator never writes. ${REPAIR}`);
  }
  const preloaded = named.filter((resource) => resource.preload);
  const classResources = named.filter((resource) => !resource.preload);
  if (preloaded.length !== 1) problems.push(`${IPM_MANIFEST_FILE} declares ${preloaded.length} preloaded resources; the generator writes exactly one, the install guard.`);
  if (declared.name === undefined || declared.version === undefined) problems.push(`${IPM_MANIFEST_FILE} declares no <Name> or no <Version>.`);
  if (options.moduleName !== undefined && declared.name !== options.moduleName) {
    problems.push(`${IPM_MANIFEST_FILE} names the module ${JSON.stringify(declared.name)}, not ${JSON.stringify(options.moduleName)}.`);
  }
  if (sharedVersion !== undefined && declared.version !== sharedVersion) {
    problems.push(`${IPM_MANIFEST_FILE} is at ${declared.version}, not the shared version ${sharedVersion}. Run pnpm run version.`);
  }

  const toDocument = (resource) => resource.name.replace(/\.CLS$/, '.cls');
  const classNames = classResources.map(toDocument);
  const guardName = preloaded.length === 1 ? toDocument(preloaded[0]) : undefined;
  if (guardName !== undefined && declared.name !== undefined && declared.version !== undefined) {
    const rendered = renderModuleXml({ moduleName: declared.name, version: declared.version, classNames, guardName, sourcesRoot: IPM_SOURCES_ROOT });
    if (rendered !== tree.manifest) {
      problems.push(`${IPM_MANIFEST_FILE} is not what the generator writes for the tree it describes (SourcesRoot ${IPM_SOURCES_ROOT}). ${REPAIR}`);
    }
  }

  // The files: one per resource, no other under ipm/src, only the guard under preload/.
  const expectedClassPaths = new Map(classNames.map((name) => [classTreePath(name), name]));
  const guardPath = guardName === undefined ? undefined : guardTreePath(guardName);
  for (const file of tree.sourceFiles.keys()) {
    if (!expectedClassPaths.has(file)) problems.push(`${file} is not a resource of ${IPM_MANIFEST_FILE}: the tree holds a file the generator did not write. Remove it, or restore the tree from git.`);
  }
  for (const file of expectedClassPaths.keys()) {
    if (!tree.sourceFiles.has(file)) problems.push(`${file} is missing from the tree. ${REPAIR}`);
  }
  for (const file of tree.preloadFiles.keys()) {
    if (file !== guardPath) problems.push(`${file} is under ${IPM_PRELOAD_PREFIX}/, where nothing but the stamped guard may live: IPM imports everything under <module root>/preload.`);
  }
  if (guardPath !== undefined && !tree.preloadFiles.has(guardPath)) problems.push(`${guardPath} is missing from the tree. ${REPAIR}`);
  for (const file of [...tree.sourceFiles.keys(), ...tree.preloadFiles.keys()]) {
    if (/\.Tests\.|QAFixtures|\/Tests\//.test(file)) problems.push(`${file} is a test or fixture class: the tree never carries one.`);
  }
  for (const [file, text] of [...tree.sourceFiles, ...tree.preloadFiles]) {
    if (text.includes(VERSION_PLACEHOLDER_LINE)) problems.push(`${file} still holds the dev placeholder (${VERSION_PLACEHOLDER_LINE}): it was not stamped by pnpm gen:ipm.`);
    // The content hash reads a file after line-end and trailing-whitespace normalization, so the form the generator writes is checked on its own.
    if (text !== `${normalizeText(text)}\n`) problems.push(`${file} is not in the form the generator writes (LF line ends, no trailing whitespace, one final newline). ${REPAIR}`);
  }
  if (tree.hasRequirements) {
    problems.push('requirements.txt exists at the repository root: IPM runs pip install -r on it when the module is installed. Remove it.');
  }

  // The marker: Setup and the guard stamp one value, its semver is the manifest's, and its hash is the tree's.
  const setupPath = classTreePath(SETUP_DOCUMENT);
  const stamps = [];
  for (const [file, text] of [[setupPath, tree.sourceFiles.get(setupPath)], [guardPath, guardPath === undefined ? undefined : tree.preloadFiles.get(guardPath)]]) {
    if (file === undefined || text === undefined) continue;
    const marker = stampedMarker(text);
    if (marker === undefined) problems.push(`${file} carries no Parameter BOOTSTRAPVERSION line.`);
    else stamps.push([file, marker]);
  }
  const markers = new Set(stamps.map(([, marker]) => marker));
  if (markers.size > 1) problems.push(`Setup and the guard stamp different markers (${stamps.map(([file, marker]) => `${file}: ${marker}`).join('; ')}). ${REPAIR}`);
  if (markers.size === 1) {
    const [marker] = markers;
    const parsed = MARKER_PATTERN.exec(marker);
    if (parsed === null) {
      problems.push(`the marker ${JSON.stringify(marker)} stamped in the tree is not <semver>+<sequence>.<hash>. ${REPAIR}`);
    } else {
      if (declared.version !== undefined && parsed[1] !== declared.version) {
        problems.push(`the tree stamps ${marker}, whose version is not the ${IPM_MANIFEST_FILE} <Version> ${declared.version}. Run pnpm run version.`);
      }
      const destamp = (text) => normalizeText(text).replace(`Parameter BOOTSTRAPVERSION = "${marker}";`, VERSION_PLACEHOLDER_LINE);
      const contents = [];
      for (const file of expectedClassPaths.keys()) {
        const text = tree.sourceFiles.get(file);
        if (text !== undefined) contents.push(file === setupPath ? destamp(text) : normalizeText(text));
      }
      const guardText = guardPath === undefined ? undefined : tree.preloadFiles.get(guardPath);
      if (guardText !== undefined) contents.push(destamp(guardText));
      const complete = contents.length === expectedClassPaths.size + 1;
      if (complete && contentHash(contents) !== parsed[3]) {
        problems.push(`the tree under ${IPM_SOURCES_ROOT} and ${IPM_PRELOAD_PREFIX} does not hash to the marker ${marker} it carries: the tree was edited by hand. ${REPAIR}`);
      }
    }
  }
  return problems;
}
