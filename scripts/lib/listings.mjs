// The generated listings of the Claude Code plugin and the MCP Registry (Story 42.8; AD-14, AD-28, AD-29): the five `server.json` files and
// the repository's `.claude-plugin/marketplace.json`, rendered from each server package's `package.json`, the plugin source and one
// constant, the connection variables. `scripts/gen-listings.mjs` owns the writes; `scripts/release.mjs` and the checks read the files.
//
// Every listing that carries a version carries the shared version, which `pnpm run version` regenerates (lockstep, decision #103).
// This module reads the file system and never writes it.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NO_ENDORSEMENT_SENTENCE } from './endorsement.mjs';
import { MARKETPLACE_NAME, PACK_DIR, PLUGIN_SOURCE_DIR, PLUGIN_SOURCE_MANIFEST } from './skills-pack.mjs';

export { MARKETPLACE_NAME };

/** The schema every `server.json` declares. */
export const SERVER_JSON_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';

/** The longest description the MCP Registry accepts, in characters. */
export const SERVER_DESCRIPTION_MAX_LENGTH = 100;

/** The repository the listings point at. */
export const REPOSITORY_URL = 'https://github.com/jbrandtmse/iris-execute-mcp-v2';
export const REPOSITORY_GIT_URL = `${REPOSITORY_URL}.git`;

/** The server packages the MCP Registry lists (decision #111), in release order, with the directory of each under `packages/`. */
export const SERVER_PACKAGES = Object.freeze([
  Object.freeze({ dir: 'iris-admin-mcp', npm: '@iris-mcp/admin' }),
  Object.freeze({ dir: 'iris-data-mcp', npm: '@iris-mcp/data' }),
  Object.freeze({ dir: 'iris-dev-mcp', npm: '@iris-mcp/dev' }),
  Object.freeze({ dir: 'iris-interop-mcp', npm: '@iris-mcp/interop' }),
  Object.freeze({ dir: 'iris-ops-mcp', npm: '@iris-mcp/ops' }),
]);

/** The path of a package's `server.json`, relative to the repository root. */
export const serverJsonPath = (dir) => `packages/${dir}/server.json`;

/** The marketplace file, relative to the repository root. */
export const MARKETPLACE_PATH = '.claude-plugin/marketplace.json';

/** The plugin source manifest, relative to the repository root. */
const PLUGIN_SOURCE_MANIFEST_PATH = `${PLUGIN_SOURCE_DIR}/${PLUGIN_SOURCE_MANIFEST}`;

/** The package whose version every listing carries. */
const VERSION_PACKAGE_PATH = 'packages/client-config/package.json';

/** What the marketplace says about itself. */
export const MARKETPLACE_DESCRIPTION = `The Claude Code plugin of the IRIS MCP Server Suite. ${NO_ENDORSEMENT_SENTENCE}`;

/** The marketplace's owner (its name is `MARKETPLACE_NAME`). */
export const MARKETPLACE_OWNER = 'jbrandtmse';

/**
 * The connection variables of a server, in the order the registry lists them: the name, what it is, its default or `required`, and the
 * `format`. They are pinned equal to `packages/shared/src/config.ts`'s defaults, to client-config's connection variables plus the
 * password, and to the plugin's six `userConfig` options.
 */
export const CONNECTION_VARIABLES = Object.freeze([
  Object.freeze({ name: 'IRIS_HOST', description: 'Host name of the IRIS web server (a bare host name, not a URL).', default: 'localhost' }),
  Object.freeze({ name: 'IRIS_PORT', description: 'Port of the IRIS web server (the Management Portal port).', default: '52773', format: 'number' }),
  Object.freeze({ name: 'IRIS_USERNAME', description: 'The IRIS user the server connects as.', required: true }),
  Object.freeze({ name: 'IRIS_PASSWORD', description: 'The password of that IRIS user.', required: true, secret: true }),
  Object.freeze({ name: 'IRIS_NAMESPACE', description: 'The namespace the server works in by default.', default: 'USER' }),
  Object.freeze({ name: 'IRIS_HTTPS', description: 'Connect to the IRIS web server over HTTPS.', default: 'false', format: 'boolean' }),
]);

/** The `environmentVariables` entry of the registry for one connection variable. */
function environmentVariable(entry) {
  return {
    name: entry.name,
    description: entry.description,
    ...(entry.required === true ? { isRequired: true } : {}),
    ...(entry.format === undefined ? {} : { format: entry.format }),
    ...(entry.secret === true ? { isSecret: true } : {}),
    ...(entry.default === undefined ? {} : { default: entry.default }),
  };
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** The `owner/repo` GitHub URL of a package manifest's `repository.url` (`git+https://github.com/o/r.git` becomes `https://github.com/o/r`). */
function repositoryUrl(manifest) {
  const raw = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  return String(raw ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
}

/**
 * The `server.json` of one server package.
 *
 * @param {Record<string, any>} manifest - The package's `package.json`.
 * @param {string} dir - The package's directory under `packages/`.
 * @returns {Record<string, any>}
 * @throws {Error} If the package has no `mcpName`, or its description is empty or longer than the registry accepts.
 */
export function renderServerJson(manifest, dir) {
  const name = manifest.mcpName;
  if (typeof name !== 'string' || name === '') throw new Error(`packages/${dir}/package.json has no mcpName. Add the registry name io.github.jbrandtmse/<bin>.`);
  const description = String(manifest.description ?? '');
  if (description === '' || description.length > SERVER_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`packages/${dir}/package.json has a description of ${description.length} characters. The registry takes 1 to ${SERVER_DESCRIPTION_MAX_LENGTH}; shorten it.`);
  }
  return {
    $schema: SERVER_JSON_SCHEMA,
    name,
    title: description,
    description,
    repository: { url: repositoryUrl(manifest), source: 'github', subfolder: `packages/${dir}` },
    version: manifest.version,
    websiteUrl: manifest.homepage,
    packages: [
      {
        registryType: 'npm',
        identifier: manifest.name,
        version: manifest.version,
        runtimeHint: 'npx',
        transport: { type: 'stdio' },
        environmentVariables: CONNECTION_VARIABLES.map(environmentVariable),
      },
    ],
  };
}

/**
 * The marketplace of the repository: one plugin, pinned to the release tag (`git-subdir`, `ref: v<version>`).
 *
 * @param {{ name: string, description: string }} plugin - The plugin source manifest.
 * @param {string} version - The shared version.
 */
export function renderMarketplace(plugin, version) {
  return {
    name: MARKETPLACE_NAME,
    owner: { name: MARKETPLACE_OWNER },
    metadata: { description: MARKETPLACE_DESCRIPTION },
    plugins: [
      {
        name: plugin.name,
        description: plugin.description,
        source: { source: 'git-subdir', url: REPOSITORY_GIT_URL, path: PACK_DIR, ref: `v${version}` },
      },
    ],
  };
}

/** A listing as the file holds it: 2-space JSON with a trailing newline. */
export const listingText = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Every listing file, keyed by its repository-relative path, with the text it must hold.
 *
 * @param {string} root - Repository root (absolute path).
 * @returns {Map<string, string>}
 */
export function renderListings(root) {
  const versionFile = join(root, VERSION_PACKAGE_PATH);
  if (!existsSync(versionFile)) throw new Error(`missing ${VERSION_PACKAGE_PATH}, which holds the shared version.`);
  const version = readJson(versionFile).version;
  const files = new Map();
  for (const { dir } of SERVER_PACKAGES) {
    const manifestFile = join(root, 'packages', dir, 'package.json');
    if (!existsSync(manifestFile)) throw new Error(`missing packages/${dir}/package.json.`);
    const manifest = readJson(manifestFile);
    if (manifest.version !== version) throw new Error(`packages/${dir}/package.json is at ${manifest.version}, not the shared version ${version}. Run pnpm run version.`);
    files.set(serverJsonPath(dir), listingText(renderServerJson(manifest, dir)));
  }
  const pluginFile = join(root, PLUGIN_SOURCE_MANIFEST_PATH);
  if (!existsSync(pluginFile)) throw new Error(`missing ${PLUGIN_SOURCE_MANIFEST_PATH}.`);
  files.set(MARKETPLACE_PATH, listingText(renderMarketplace(readJson(pluginFile), version)));
  return files;
}
