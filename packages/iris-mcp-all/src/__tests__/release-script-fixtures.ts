/**
 * Fixtures of the release script's tests (`release-script.test.ts`): a fake GitHub API, a directory of synthetic release artifacts with
 * its manifest and hashes, and a synthetic repository for `prepare`. Everything lives under `os.tmpdir()` and is made by the test that
 * asks for it; nothing here runs a process or reaches a network.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { IPM_MODULE, IPM_TREE_GUARD_RELATIVE, NPM_PUBLISH_ORDER, OPEN_EXCHANGE_LISTING_URL, RELEASE_CHANNELS } from "../../../../scripts/lib/release-core.mjs";

export const SHA = "c".repeat(40);

// -- the fake GitHub API -------------------------------------------------------------------------------------------

/** The answer of one route: a status and a JSON body. */
export interface FakeAnswer {
  status: number;
  body?: unknown;
  /** When set, the request fails with this message instead of answering (a network error, or the stall guard of 30 seconds). */
  fail?: string;
  /** The answer's `Content-Type` (default `application/json`, the type of every GitHub, registry and store JSON answer). */
  contentType?: string;
  /** A body that is not JSON, sent as is in place of `body` (a vsix, an HTML page). */
  raw?: string;
  /** Binary bytes, sent as is in place of `raw` and `body` (a tarball). */
  bytes?: Uint8Array;
}

/** The `Response` of a fake answer: `bytes` or `raw` as is, else `body` as JSON, typed `contentType` or `application/json`. */
function responseOf(answer: FakeAnswer): Response {
  const body = answer.bytes ?? answer.raw ?? (answer.body === undefined ? null : JSON.stringify(answer.body));
  return new Response(body, { status: answer.status, headers: { "Content-Type": answer.contentType ?? "application/json" } });
}

/** The state of the fake GitHub API. */
export interface FakeGithub {
  /** The environment, its deployment rules and the runs the API answers with; replace any to change the answer. */
  environment: FakeAnswer;
  policies: FakeAnswer;
  runs: () => FakeAnswer;
  /** The answer of the compare of `main...<sha>`: the commit is main itself unless a test says otherwise. */
  compare: FakeAnswer;
  /** Every path (with its query) the API was asked for, in order. */
  requests: string[];
  /** The `Authorization` header of each request. */
  authorizations: string[];
}

/** A protected `release` environment: one reviewer, no admin bypass, one tag rule `v*`. */
export function protectedEnvironment(overrides: Record<string, unknown> = {}): FakeAnswer {
  return {
    status: 200,
    body: {
      name: "release",
      can_admins_bypass: false,
      protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: { login: "jbrandtmse" } }] }],
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      ...overrides,
    },
  };
}

/** The deployment rules of a protected environment: one tag rule `v*`. */
export const TAG_POLICIES: FakeAnswer = { status: 200, body: { total_count: 1, branch_policies: [{ id: 1, name: "v*", type: "tag" }] } };

/** One `ci.yml` run on `sha`. */
export function ciRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 7, html_url: "https://github.com/o/r/actions/runs/7", head_sha: SHA, event: "push", path: ".github/workflows/ci.yml", status: "completed", conclusion: "success", ...overrides };
}

/** The reduced body of a GitHub compare answer (`status`, `ahead_by`, `behind_by`, `total_commits`), the shape `story-42-6-qa-real-oracles.test.ts` captured. */
export function compareAnswer(status: string, counts: { ahead?: number; behind?: number } = {}): FakeAnswer {
  const ahead = counts.ahead ?? (status === "ahead" || status === "diverged" ? 3 : 0);
  const behind = counts.behind ?? (status === "behind" || status === "diverged" ? 2 : 0);
  return { status: 200, body: { status, ahead_by: ahead, behind_by: behind, total_commits: ahead } };
}

/** A fake GitHub API with a protected environment, one green CI run, and a commit that is on `main`. */
export function newFakeGithub(): FakeGithub {
  return {
    environment: protectedEnvironment(),
    policies: TAG_POLICIES,
    runs: () => ({ status: 200, body: { total_count: 1, workflow_runs: [ciRun()] } }),
    compare: compareAnswer("identical"),
    requests: [],
    authorizations: [],
  };
}

/** The answer of the fake API for a URL (path and query), recorded in `requests`. */
export function answerFor(github: FakeGithub, url: string, authorization = ""): FakeAnswer {
  const parsed = new URL(url, "http://github.test");
  const route = `${parsed.pathname}${parsed.search}`;
  github.requests.push(route);
  github.authorizations.push(authorization);
  if (parsed.pathname.endsWith("/deployment-branch-policies")) return github.policies;
  if (/\/environments\/release$/.test(parsed.pathname)) return github.environment;
  if (parsed.pathname.endsWith("/actions/runs")) return github.runs();
  if (/\/compare\/main\.\.\.[0-9a-f]+$/.test(parsed.pathname)) return github.compare;
  return { status: 404, body: { message: "Not Found" } };
}

/** The part of a `fetch` init that the fakes read. */
export interface FakeInit {
  headers?: Record<string, string>;
  signal?: unknown;
  /** `fetch` sends a GET when it is not given. */
  method?: string;
  body?: unknown;
}

/** A `fetch` that answers from the fake API; any other host is refused, so no test reaches a network. */
export function fakeFetch(github: FakeGithub, extra: (url: string, init?: FakeInit) => FakeAnswer | undefined = () => undefined): typeof fetch {
  return (async (input: unknown, init?: FakeInit) => {
    const url = String(input);
    const other = extra(url, init);
    const answer = other ?? (url.startsWith("https://api.github.com") ? answerFor(github, url, init?.headers?.["Authorization"] ?? "") : { status: 599, body: { message: `no route for ${url}` } });
    if (answer.fail !== undefined) throw new Error(answer.fail);
    return responseOf(answer);
  }) as unknown as typeof fetch;
}

/** The fake API on a loopback port, for a script run as a real process (`GITHUB_API_URL` points at it). */
export async function startGithubServer(github: FakeGithub): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const answer = answerFor(github, request.url ?? "/", String(request.headers["authorization"] ?? ""));
    response.writeHead(answer.status, { "Content-Type": "application/json" });
    response.end(answer.body === undefined ? "" : JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A loopback HTTP server that accepts connections and never answers, for the tests of a stalled connection. */
export async function startHangingServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// -- the fake extension stores -------------------------------------------------------------------------------------

/**
 * The state of the fake stores (Story 42.7): what the Marketplace and Open VSX answer to the read-only lookups of a version, and what
 * Open VSX answers for a namespace. The statuses are the ones the real stores answered on 2026-11-20 (captured in the header of
 * `release-core.test.ts`): 200 for a version that is there, 404 for one that is not, 404 for an unknown namespace.
 */
export interface FakeStores {
  marketplace: FakeAnswer;
  openVsx: FakeAnswer;
  namespace: FakeAnswer;
  /** The IPM registry's answer for the package (Story 42.8): 404 for a package it does not list. */
  ipmRegistry: FakeAnswer;
  /** The IPM registry's answer for a download of an archive (`/download/...`): the served `.tgz`; `undefined` is the unrouted 599. */
  ipmArchive?: FakeAnswer;
  /** The MCP Registry's answer for `name@version`: 404 (the real body) for a server it does not list. */
  mcpRegistry: (name: string, version: string) => FakeAnswer;
  /** npm's answer for `<package>@<version>`: 200 once npm serves it. */
  npmVersion: (name: string, version: string) => FakeAnswer;
  /** The answer for the `mcp-publisher` download; `undefined` is the unrouted 599. */
  publisher?: FakeAnswer;
  /** Every request the stores were asked: its URL, its headers, whether the caller gave it a signal of its own, its method (`GET` when none was given) and whether it carried a body. */
  requests: Array<{ url: string; headers: Record<string, string>; signal: boolean; method: string; hasBody: boolean }>;
}

/**
 * The Marketplace's answer for a version it holds: the vsix itself (a zip, `PK\u0003\u0004`), typed as the real store types it
 * (`application/vsix; api-version=7.2-preview.1`, read-only GETs of five extensions on 2026-11-21). `status` 206 is the one-byte read the
 * request asks for; the real store ignores the Range header and answers 200.
 */
export function marketplaceHit(status = 200): FakeAnswer {
  return { status, contentType: "application/vsix; api-version=7.2-preview.1", raw: "PK\u0003\u0004" };
}

/**
 * Open VSX's answer for a version it holds: JSON that names it (`namespace`, `name`, `version`, among about 40 other fields; read-only GET
 * of `intersystems-community/servermanager/3.10.2` on 2026-11-21, `application/json`).
 */
export function openVsxHit(version = "1.0.0", namespace = "iris-mcp", name = "iris-mcp-launcher"): FakeAnswer {
  return { status: 200, contentType: "application/json", body: { namespace, name, version, downloadable: true, targetPlatform: "universal" } };
}

/** A captive-portal or proxy page: 200, HTML, nothing of the store's. */
export const HTML_PAGE: FakeAnswer = { status: 200, contentType: "text/html; charset=utf-8", raw: "<!doctype html><title>Sign in to the network</title>" };

/** Fake stores on which the extension is not published and the namespace exists (the real 404 bodies, 2026-11-21). */
export function newFakeStores(): FakeStores {
  return {
    marketplace: { status: 404, contentType: "application/json; charset=utf-8", body: { $id: "1", innerException: null, message: "Resource not found", typeKey: "ExtensionAssetNotFoundException" } },
    openVsx: { status: 404, body: { deprecated: false, downloadable: false, error: "Extension not found: iris-mcp.iris-mcp-launcher 1.0.0" } },
    namespace: { status: 200, body: { extensions: {} } },
    ipmRegistry: IPM_REGISTRY_MISS,
    mcpRegistry: () => MCP_REGISTRY_MISS,
    npmVersion: () => ({ status: 200, body: {} }),
    requests: [],
  };
}

/**
 * The IPM registry's answer for a package it does not list: 404, `application/json; charset=utf-8`, an empty body (a read-only GET of
 * `https://pm.community.intersystems.com/packages/iris-execute-mcp-v2` on 2026-11-21).
 */
export const IPM_REGISTRY_MISS: FakeAnswer = { status: 404, contentType: "application/json; charset=utf-8", raw: "" };

/**
 * The IPM registry's answer for a package it lists: 200 JSON with `name`, `version` (the newest), `description`, `repository`, `size`,
 * `hash`, `url` (the newest version's download), `versions` (every version, sorted as text), `publishTS` and `deleted`. The shape is the
 * one a read-only GET of `https://pm.community.intersystems.com/packages/ocupilot` returned on 2026-11-21, with this module's own name.
 */
export function ipmRegistryHit(newest: string, older: string[] = []): FakeAnswer {
  return {
    status: 200,
    contentType: "application/json; charset=utf-8",
    body: {
      name: "iris-execute-mcp-v2",
      version: newest,
      description: "Server-side classes and REST service (/api/executemcp/v2) for the IRIS MCP server suite.",
      repository: "https://github.com/jbrandtmse/iris-execute-mcp-v2/",
      size: 13824770,
      hash: "d01d328f1d6b2c8a7f2a5e1b0c9d3e4f5a6b7c8d",
      url: `https://pm.community.intersystems.com/download/iris-execute-mcp-v2/-/iris-execute-mcp-v2-${newest}.tgz`,
      versions: [...older, newest].sort(),
      publishTS: 1795235429.719946,
      deleted: false,
    },
  };
}

/** The IPM registry's answer for a download: 200, `application/tar+gzip; charset=RAW` (a read-only GET of `.../download/ocupilot/-/ocupilot-1.0.18.tgz` on 2026-11-21), the archive's bytes. */
export function ipmArchiveAnswer(bytes: Uint8Array): FakeAnswer {
  return { status: 200, contentType: "application/tar+gzip; charset=RAW", bytes };
}

/** The MCP Registry's answer for a server it does not list (read-only GETs on 2026-11-21): 404 `{"title":"Not Found","status":404,"detail":"Server not found"}`. */
export const MCP_REGISTRY_MISS: FakeAnswer = { status: 404, body: { title: "Not Found", status: 404, detail: "Server not found" } };

/** The MCP Registry's answer for a server it lists: 200 `{"server":{...},"_meta":{...}}`, as for `io.github.upstash/context7@4.7.3`. */
export function mcpRegistryHit(name: string, version: string): FakeAnswer {
  return { status: 200, body: { server: { name, version, description: "x" }, _meta: {} } };
}

/** The answer of the fake stores for a URL, recorded in `requests`; `undefined` for a URL that is not a store's. */
export function storeAnswerFor(stores: FakeStores, url: string, init?: FakeInit): FakeAnswer | undefined {
  const parsed = new URL(url);
  const record = (): void => void stores.requests.push({ url, headers: { ...(init?.headers ?? {}) }, signal: init?.signal !== undefined, method: init?.method ?? "GET", hasBody: init?.body !== undefined });
  if (parsed.host === "marketplace.visualstudio.com") {
    record();
    return stores.marketplace;
  }
  if (parsed.host === "open-vsx.org") {
    record();
    return parsed.pathname.split("/").filter((part) => part !== "").length === 2 ? stores.namespace : stores.openVsx;
  }
  if (parsed.host === "pm.community.intersystems.com") {
    record();
    return parsed.pathname.startsWith("/download/") ? stores.ipmArchive : stores.ipmRegistry;
  }
  if (parsed.host === "registry.modelcontextprotocol.io") {
    record();
    const match = /^\/v0\.1\/servers\/([^/]+)\/versions\/([^/]+)$/.exec(parsed.pathname);
    return match === null ? undefined : stores.mcpRegistry(decodeURIComponent(match[1] as string), decodeURIComponent(match[2] as string));
  }
  if (parsed.host === "registry.npmjs.org") {
    record();
    const match = /^\/(@[^/]+(?:%2F|\/)[^/]+)\/([^/]+)$/i.exec(parsed.pathname);
    return match === null ? undefined : stores.npmVersion(decodeURIComponent(match[1] as string), decodeURIComponent(match[2] as string));
  }
  if (parsed.host === "github.com" && parsed.pathname.startsWith("/modelcontextprotocol/registry/releases/download/")) {
    record();
    return stores.publisher;
  }
  return undefined;
}

/** A `fetch` that answers the two stores from `stores` and refuses every other URL (status 599), for a run that reads no GitHub and no registry. */
export function fakeStoresFetch(stores: FakeStores = newFakeStores()): typeof fetch {
  return (async (input: unknown, init?: FakeInit) => {
    const answer = storeAnswerFor(stores, String(input), init) ?? { status: 599, body: { message: `no route for ${String(input)}` } };
    if (answer.fail !== undefined) throw new Error(answer.fail);
    return responseOf(answer);
  }) as unknown as typeof fetch;
}

// -- synthetic artifacts -------------------------------------------------------------------------------------------

/** What {@link makeArtifacts} writes. */
export interface ArtifactOptions {
  version?: string;
  sha?: string;
  mode?: string;
  event?: string;
  ref?: string;
  publisher?: string;
  /** The version the vsix is at (default: the release version, which a release requires). */
  vsixVersion?: string;
}

/** The manifest of an artifacts directory, as `prepare` writes it. */
export interface ArtifactManifest {
  schema: number;
  version: string;
  sha: string;
  mode: string;
  event: string;
  ref: string;
  channels: Array<Record<string, any>>;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

/**
 * Write synthetic artifacts into `dir` -- eight tarballs, a vsix and the registry listings -- and their `release-manifest.json` with the
 * real hashes. The IPM channel lists no file (decision #122): its entry is the one `prepare` writes. The tarballs are not archives; `publish` hands them to the stand-in `npm` and reads their bytes only for the hash.
 */
export function makeArtifacts(dir: string, options: ArtifactOptions = {}): ArtifactManifest {
  const version = options.version ?? "1.0.0";
  const write = (relative: string, text: string): void => {
    const file = path.join(dir, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const packages = NPM_PUBLISH_ORDER.map((name: string) => {
    const tarball = `npm/iris-mcp-${name.replace(/^@iris-mcp\//, "")}-${version}.tgz`;
    write(tarball, `synthetic tarball of ${name}@${version}\n`);
    return { name, version, tarball };
  });
  const vsixVersion = options.vsixVersion ?? version;
  const vsixFile = `vsix/iris-mcp-launcher-${vsixVersion}.vsix`;
  write(vsixFile, "synthetic vsix\n");
  const registryServers = SERVER_DIRS.map((dir) => {
    const file = `mcp-registry/${dir}.json`;
    write(file, `${JSON.stringify({ name: registryNameOf(dir), version, packages: [{ identifier: `@iris-mcp/${dir.replace(/^iris-|-mcp$/g, "")}`, version }] })}\n`);
    return { name: registryNameOf(dir), version, package: `@iris-mcp/${dir.replace(/^iris-|-mcp$/g, "")}`, file };
  });
  const vsix = { file: vsixFile, name: "iris-mcp-launcher", version: vsixVersion, publisher: options.publisher ?? "TBD-at-publish-time", files: ["package.json", "dist/extension.js"] };
  const details: Record<string, Record<string, unknown>> = {
    npm: { packages },
    "vscode-marketplace": vsix,
    "open-vsx": vsix,
    ipm: { module: IPM_MODULE, version, marker: `${version}+2.244fe8623c76`, listing: OPEN_EXCHANGE_LISTING_URL, manual: true },
    "mcp-registry": { servers: registryServers },
  };
  const files = [
    ...packages.map((entry) => entry.tarball),
    ...registryServers.map((server) => server.file),
    vsixFile,
  ].sort();
  const manifest: ArtifactManifest = {
    schema: 1,
    version,
    sha: options.sha ?? SHA,
    mode: options.mode ?? "release",
    event: options.event ?? "push",
    ref: options.ref ?? `refs/tags/v${version}`,
    channels: RELEASE_CHANNELS.map((channel: { id: string }) => ({ ...channel, ...details[channel.id] })),
    files: [],
  };
  manifest.files = files.map((relative) => {
    const content = readFileSync(path.join(dir, relative));
    return { path: relative, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
  });
  writeFileSync(path.join(dir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Rewrite the manifest of an artifacts directory after the test changed it. */
export function writeManifest(dir: string, manifest: ArtifactManifest): void {
  writeFileSync(path.join(dir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

// -- a synthetic repository for `prepare` --------------------------------------------------------------------------

/** The directory of each published package, as in the real repository. */
export const PACKAGE_DIRS: Record<string, string> = {
  "@iris-mcp/client-config": "client-config",
  "@iris-mcp/shared": "shared",
  "@iris-mcp/admin": "iris-admin-mcp",
  "@iris-mcp/data": "iris-data-mcp",
  "@iris-mcp/dev": "iris-dev-mcp",
  "@iris-mcp/interop": "iris-interop-mcp",
  "@iris-mcp/ops": "iris-ops-mcp",
  "@iris-mcp/all": "iris-mcp-all",
};

/** What {@link makeRepo} writes. */
export interface RepoOptions {
  /** The version of every package (default 1.0.0), and the exceptions by package name. */
  version?: string;
  versions?: Record<string, string>;
  /** The semver of the bootstrap marker and of the root `module.xml` (default: the version of `@iris-mcp/shared`). */
  markerSemver?: string;
  moduleVersion?: string;
  /** The whole marker the committed IPM tree stamps (default: the embed's marker), or `null` for a repository whose tree has no stamped guard. */
  ipmTreeMarker?: string | null;
  /** Pending changesets, by file name. */
  pending?: string[];
  /** The root scripts (default: the four `:check` scripts, `format:check`, hooks and the others of the real root). */
  scripts?: Record<string, string>;
  /** The extension's versions (default: the version of `@iris-mcp/shared`, the lockstep): its manifest, and the two version fields of its lock. */
  extensionVersion?: string;
  extensionLockVersion?: string;
  extensionLockRootVersion?: string;
  /** The extension's changelog text (default: a first heading `## [<the shared version>]`). */
  extensionChangelog?: string;
  /** The listings' versions (default: the shared version, the lockstep): the plugin manifest, the marketplace entry's ref (`v<version>`), and the `version` and `packages[0].version` of each server.json. */
  pluginVersion?: string;
  marketplaceRef?: string;
  serverVersion?: string;
  serverPackageVersion?: string;
}

/** The five server directories of the real repository, and the registry name of each. */
export const SERVER_DIRS = ["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"] as const;
export const registryNameOf = (dir: string): string => `io.github.jbrandtmse/${dir}`;

/** The root scripts of the real repository that matter to `prepare`. */
export const ROOT_SCRIPTS: Record<string, string> = {
  "gen:bootstrap": "node scripts/gen-bootstrap.mjs",
  "gen:ipm": "node scripts/gen-bootstrap.mjs --ipm",
  "gen:ipm:check": "node scripts/gen-bootstrap.mjs --ipm-check",
  "pregen:governance-baseline:check": "turbo run build --filter @iris-mcp/shared",
  "gen:governance-baseline:check": "node scripts/gen-governance-baseline.mjs --check",
  "gen:skills:check": "node scripts/gen-skills.mjs --check",
  "gen:pack:check": "node scripts/gen-pack.mjs --check",
  "gen:listings:check": "node scripts/gen-listings.mjs --check",
  "gen:tools-list-snapshot:check": "node scripts/gen-tools-list-snapshot.mjs --check",
  "format:check": "prettier --check .",
  "check:live-guards": "node scripts/check-live-guards.mjs",
  "check:provenance": "node scripts/check-provenance.mjs",
  "validate:prompts": "node scripts/validate-prompts.mjs",
  version: "node scripts/release-version.mjs",
  release: "node scripts/release.mjs",
};

/** The marker `prepare` reads from the embed. */
export const MARKER_TAIL = "2.244fe8623c76";

/** Write a synthetic repository under `root`: the eight packages, the changesets, the embed's marker line, the root `module.xml` and the tree's stamped guard, the extension and the LICENSE. */
export function makeRepo(root: string, options: RepoOptions = {}): { versionOf: (name: string) => string } {
  const version = options.version ?? "1.0.0";
  const versionOf = (name: string): string => options.versions?.[name] ?? version;
  const json = (relative: string, value: unknown): void => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  };
  const text = (relative: string, content: string): void => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  json("package.json", { name: "iris-mcp-suite", private: true, version: "0.0.0", scripts: options.scripts ?? ROOT_SCRIPTS });
  const SERVERS = ["@iris-mcp/admin", "@iris-mcp/data", "@iris-mcp/dev", "@iris-mcp/interop", "@iris-mcp/ops"];
  for (const [name, dir] of Object.entries(PACKAGE_DIRS)) {
    const dependencies: Record<string, string> = name === "@iris-mcp/all" ? Object.fromEntries(SERVERS.map((server) => [server, "workspace:*"])) : SERVERS.includes(name) ? { "@iris-mcp/shared": "workspace:*" } : {};
    const manifest: Record<string, unknown> = { name, version: versionOf(name), dependencies, files: ["dist"] };
    if (name === "@iris-mcp/shared") {
      manifest["exports"] = { ".": { types: "./src/index.ts", import: "./src/index.ts" } };
      manifest["publishConfig"] = { exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } };
    }
    if (name === "@iris-mcp/client-config") manifest["exports"] = { ".": "./dist/index.js" };
    json(`packages/${dir}/package.json`, manifest);
  }
  text(".changeset/README.md", "# Changesets\n");
  for (const name of options.pending ?? []) text(`.changeset/${name}`, '---\n"@iris-mcp/shared": patch\n---\n\nA change.\n');
  const sharedVersion = versionOf("@iris-mcp/shared");
  const marker = `${options.markerSemver ?? sharedVersion}+${MARKER_TAIL}`;
  text("packages/shared/src/bootstrap-classes.ts", `export const BOOTSTRAP_VERSION = "${marker}";\n`);
  text("module.xml", `<Export><Module><Name>iris-execute-mcp-v2</Name><Version>${options.moduleVersion ?? sharedVersion}</Version></Module></Export>\n`);
  // The tree's stamped guard carries the marker the registry serves for the module's version (the generator's `Parameter` line).
  if (options.ipmTreeMarker !== null) text(IPM_TREE_GUARD_RELATIVE, `Class ExecuteMCPv2.InstallGuard {\nParameter BOOTSTRAPVERSION = "${options.ipmTreeMarker ?? marker}";\n}\n`);
  // The extension follows the shared version (lockstep): its manifest, both version fields of its lock, and its changelog heading.
  const extensionVersion = options.extensionVersion ?? sharedVersion;
  json("extensions/iris-mcp-launcher/package.json", { name: "iris-mcp-launcher", version: extensionVersion, private: true, publisher: "iris-mcp" });
  json("extensions/iris-mcp-launcher/package-lock.json", {
    name: "iris-mcp-launcher",
    version: options.extensionLockVersion ?? extensionVersion,
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: "iris-mcp-launcher", version: options.extensionLockRootVersion ?? extensionVersion } },
  });
  text("extensions/iris-mcp-launcher/CHANGELOG.md", options.extensionChangelog ?? `# Changelog\n\n## [${sharedVersion}] \u2014 2026-01-01\n\n- A synthetic entry.\n`);
  text("LICENSE", "MIT License\n");
  // The listings follow the shared version (lockstep, Story 42.8): the plugin manifest, the marketplace ref and the five server.json files.
  json("packages/client-config/skills-pack/.claude-plugin/plugin.json", { name: "iris-mcp", version: options.pluginVersion ?? sharedVersion });
  json(".claude-plugin/marketplace.json", {
    name: "iris-mcp",
    owner: { name: "jbrandtmse" },
    plugins: [{ name: "iris-mcp", source: { source: "git-subdir", url: "https://github.com/jbrandtmse/iris-execute-mcp-v2.git", path: "packages/client-config/skills-pack", ref: options.marketplaceRef ?? `v${sharedVersion}` } }],
  });
  for (const dir of SERVER_DIRS) {
    json(`packages/${dir}/server.json`, {
      name: registryNameOf(dir),
      version: options.serverVersion ?? sharedVersion,
      packages: [{ registryType: "npm", identifier: `@iris-mcp/${dir.replace(/^iris-|-mcp$/g, "")}`, version: options.serverPackageVersion ?? options.serverVersion ?? sharedVersion }],
    });
  }
  return { versionOf };
}
